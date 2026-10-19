from __future__ import annotations

import gc
import threading
from pathlib import Path
from typing import Callable

import numpy as np
import torch
from PIL import Image

from api.embedding_config import CLIP_MODEL_ID, GEMMA_MODEL_ID, MODEL_REVISIONS, validate_model

_LOCK = threading.RLock()
_PROVIDERS: dict[str, object] = {}


def normalized_vectors(values: object, count: int) -> np.ndarray:
    if isinstance(values, torch.Tensor):
        values = values.detach().cpu().float().numpy()
    vectors = np.asarray(values, dtype=np.float32)
    if vectors.shape != (count, 768) or not np.isfinite(vectors).all():
        raise ValueError("Embedding provider returned invalid vectors")
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    if not np.isfinite(norms).all() or np.any(norms <= 1e-12):
        raise ValueError("Embedding provider returned invalid vector norms")
    return vectors / norms


class ClipProvider:
    image_batch_size = 32
    text_batch_size = 256

    def __init__(self) -> None:
        from transformers import CLIPModel, CLIPProcessor

        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        revision = MODEL_REVISIONS[CLIP_MODEL_ID]
        self.model = CLIPModel.from_pretrained(CLIP_MODEL_ID, revision=revision).to(self.device).eval()
        self.processor = CLIPProcessor.from_pretrained(
            CLIP_MODEL_ID, revision=revision, use_fast=False,
        )

    def images(self, images: list[Image.Image]) -> object:
        inputs = self.processor(images=images, return_tensors="pt", padding=True).to(self.device)
        result = self.model.get_image_features(**inputs)
        return result.pooler_output if hasattr(result, "pooler_output") else result

    def texts(self, texts: list[str]) -> object:
        inputs = self.processor(
            text=texts, return_tensors="pt", padding=True, truncation=True,
            max_length=self.model.config.text_config.max_position_embeddings,
        ).to(self.device)
        result = self.model.get_text_features(**inputs)
        return result.pooler_output if hasattr(result, "pooler_output") else result


class GemmaProvider:
    image_batch_size = 8
    text_batch_size = 32

    def __init__(self) -> None:
        from sentence_transformers import SentenceTransformer

        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.bfloat16 if device == "cuda" and torch.cuda.is_bf16_supported() else torch.float32
        self.model = SentenceTransformer(
            GEMMA_MODEL_ID, revision=MODEL_REVISIONS[GEMMA_MODEL_ID], device=device,
            config_kwargs={"audio_config": None}, model_kwargs={"torch_dtype": dtype},
        )
        self.model.eval()

    def images(self, images: list[Image.Image]) -> object:
        return self.model.encode(
            [{"image": image} for image in images], batch_size=self.image_batch_size,
            prompt="", convert_to_tensor=True, normalize_embeddings=True, show_progress_bar=False,
        )

    def texts(self, texts: list[str]) -> object:
        return self.model.encode(
            texts, batch_size=self.text_batch_size, prompt="",
            convert_to_tensor=True, normalize_embeddings=True, show_progress_bar=False,
        )


def _provider(model_id: str):
    validate_model(model_id)
    if model_id not in _PROVIDERS:
        # One inference lock also prevents unloading a provider in use.
        _PROVIDERS.clear()
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        _PROVIDERS[model_id] = ClipProvider() if model_id == CLIP_MODEL_ID else GemmaProvider()
    return _PROVIDERS[model_id]


def unload_inactive(model_id: str) -> None:
    with _LOCK:
        for key in list(_PROVIDERS):
            if key != model_id:
                del _PROVIDERS[key]
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def embed_image_objects(images: list[Image.Image], model_id: str = CLIP_MODEL_ID) -> np.ndarray:
    if not images:
        return np.empty((0, 768), dtype=np.float32)
    with _LOCK, torch.inference_mode():
        provider = _provider(model_id)
        return normalized_vectors(provider.images([image.convert("RGB") for image in images]), len(images))


def embed_images(
    paths: list[Path], model_id: str = CLIP_MODEL_ID, *,
    progress_cb: Callable[[int, int], None] | None = None,
) -> torch.Tensor:
    chunks = []
    with _LOCK:
        batch_size = _provider(model_id).image_batch_size
    for start in range(0, len(paths), batch_size):
        batch = paths[start:start + batch_size]
        images = []
        try:
            for path in batch:
                with Image.open(path) as source:
                    images.append(source.convert("RGB"))
            # Yield between batches so the active dataset can still serve queries.
            with _LOCK, torch.inference_mode():
                chunks.append(normalized_vectors(_provider(model_id).images(images), len(batch)))
        finally:
            for image in images:
                image.close()
        if progress_cb:
            progress_cb(start + len(batch), len(paths))
    return torch.from_numpy(np.vstack(chunks) if chunks else np.empty((0, 768), dtype=np.float32))


def embed_text(
    texts: list[str], model_id: str = CLIP_MODEL_ID, *,
    progress_cb: Callable[[int, int], None] | None = None,
) -> np.ndarray:
    chunks = []
    with _LOCK:
        batch_size = _provider(model_id).text_batch_size
    for start in range(0, len(texts), batch_size):
        batch = texts[start:start + batch_size]
        with _LOCK, torch.inference_mode():
            chunks.append(normalized_vectors(_provider(model_id).texts(batch), len(batch)))
        if progress_cb:
            progress_cb(start + len(batch), len(texts))
    return np.vstack(chunks) if chunks else np.empty((0, 768), dtype=np.float32)
