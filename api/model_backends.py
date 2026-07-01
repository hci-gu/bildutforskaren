from __future__ import annotations

import base64
import io
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

os.environ.setdefault(
    "HF_HOME",
    str(Path(__file__).resolve().parents[1] / ".cache" / "huggingface"),
)

import httpx
import torch
from PIL import Image
from transformers import AutoModelForCausalLM, AutoProcessor

from sd import SD


CAPTION_MODEL = "microsoft/Florence-2-large"
CAPTION_TASK = "<MORE_DETAILED_CAPTION>"
SDXL_MODEL = "stabilityai/sdxl-turbo"


@dataclass(frozen=True)
class CaptionItem:
    id: int
    image_path: Path
    max_new_tokens: int


@dataclass(frozen=True)
class CaptionResult:
    id: int
    ok: bool
    description: str | None = None
    error: str | None = None
    duration_ms: int | None = None


@dataclass(frozen=True)
class SdxlEmbeddingItem:
    id: int
    prompt: str


@dataclass(frozen=True)
class SdxlEmbeddingResult:
    id: int
    ok: bool
    embedding: dict[str, torch.Tensor] | None = None
    error: str | None = None
    duration_ms: int | None = None


@dataclass(frozen=True)
class SdxlImageResult:
    ok: bool
    image: bytes | None = None
    error: str | None = None
    duration_ms: int | None = None


def _torch_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _model_dtype(device: str) -> torch.dtype:
    return torch.float16 if device == "cuda" else torch.float32


def encode_embedding_payload(embedding: dict[str, torch.Tensor]) -> str:
    buffer = io.BytesIO()
    torch.save(
        {key: value.detach().cpu() for key, value in embedding.items()},
        buffer,
    )
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def decode_embedding_payload(payload: str) -> dict[str, torch.Tensor]:
    raw = base64.b64decode(payload.encode("ascii"))
    return torch.load(io.BytesIO(raw), map_location="cpu")


class LocalModelBackend:
    def __init__(self) -> None:
        self._caption_processor = None
        self._caption_model = None
        self._caption_device = None
        self._sd = None

    def _load_caption_model(self):
        if self._caption_processor is not None and self._caption_model is not None:
            return self._caption_processor, self._caption_model, self._caption_device

        device = _torch_device()
        torch_dtype = _model_dtype(device)
        self._caption_processor = AutoProcessor.from_pretrained(
            CAPTION_MODEL,
            trust_remote_code=True,
        )
        self._caption_model = AutoModelForCausalLM.from_pretrained(
            CAPTION_MODEL,
            torch_dtype=torch_dtype,
            trust_remote_code=True,
        ).to(device)
        self._caption_device = device
        return self._caption_processor, self._caption_model, self._caption_device

    def _load_sd(self) -> SD:
        if self._sd is None:
            self._sd = SD()
        return self._sd

    def caption_images(self, items: list[CaptionItem]) -> list[CaptionResult]:
        if not items:
            return []

        processor, model, device = self._load_caption_model()
        torch_dtype = _model_dtype(device)
        images = []
        valid_items = []
        results_by_id: dict[int, CaptionResult] = {}

        for item in items:
            try:
                with Image.open(item.image_path) as img:
                    images.append(img.convert("RGB").copy())
                valid_items.append(item)
            except Exception as exc:
                results_by_id[item.id] = CaptionResult(
                    id=item.id,
                    ok=False,
                    error=str(exc),
                )

        if valid_items:
            started_at = time.monotonic()
            texts = [CAPTION_TASK for _ in valid_items]
            inputs = processor(text=texts, images=images, return_tensors="pt").to(
                device,
                torch_dtype,
            )
            with torch.no_grad():
                generated_ids = model.generate(
                    input_ids=inputs["input_ids"],
                    pixel_values=inputs["pixel_values"],
                    max_new_tokens=max(item.max_new_tokens for item in valid_items),
                    num_beams=3,
                    do_sample=False,
                )

            generated_texts = processor.batch_decode(
                generated_ids,
                skip_special_tokens=False,
            )
            batch_duration_ms = int((time.monotonic() - started_at) * 1000)
            per_item_ms = int(batch_duration_ms / max(1, len(valid_items)))
            for item, image, generated_text in zip(valid_items, images, generated_texts):
                parsed = processor.post_process_generation(
                    generated_text,
                    task=CAPTION_TASK,
                    image_size=(image.width, image.height),
                )
                results_by_id[item.id] = CaptionResult(
                    id=item.id,
                    ok=True,
                    description=parsed.get(CAPTION_TASK, generated_text).strip(),
                    duration_ms=per_item_ms,
                )

        return [results_by_id[item.id] for item in items]

    def sdxl_text_embeddings(self, items: list[SdxlEmbeddingItem]) -> list[SdxlEmbeddingResult]:
        if not items:
            return []

        sd = self._load_sd()
        results = []
        for item in items:
            started_at = time.monotonic()
            try:
                prompt_embeds, pooled_prompt_embeds = sd.generate_embedding(item.prompt)
                results.append(
                    SdxlEmbeddingResult(
                        id=item.id,
                        ok=True,
                        embedding={
                            "prompt_embeds": prompt_embeds.detach().cpu(),
                            "pooled_prompt_embeds": pooled_prompt_embeds.detach().cpu(),
                        },
                        duration_ms=int((time.monotonic() - started_at) * 1000),
                    )
                )
            except Exception as exc:
                results.append(SdxlEmbeddingResult(id=item.id, ok=False, error=str(exc)))
        return results

    def sdxl_image_from_embedding(
        self,
        embedding: dict[str, torch.Tensor],
        *,
        steps: int = 4,
        cfg: float = 0.5,
        size: int = 512,
        seed: int = 1,
    ) -> SdxlImageResult:
        started_at = time.monotonic()
        try:
            sd = self._load_sd()
            image = sd.image_for_embeddings(
                (embedding["prompt_embeds"], embedding["pooled_prompt_embeds"]),
                steps=steps,
                cfg=cfg,
                size=size,
                seed=seed,
            )
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            return SdxlImageResult(
                ok=True,
                image=buffer.getvalue(),
                duration_ms=int((time.monotonic() - started_at) * 1000),
            )
        except Exception as exc:
            return SdxlImageResult(ok=False, error=str(exc))


class RemoteHttpModelBackend:
    def __init__(self, *, base_url: str, timeout: float = 120.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(f"{self.base_url}{path}", json=payload)
            response.raise_for_status()
            return response.json()

    def caption_images(self, items: list[CaptionItem]) -> list[CaptionResult]:
        payload_items = []
        for item in items:
            raw = item.image_path.read_bytes()
            payload_items.append(
                {
                    "id": item.id,
                    "image_base64": base64.b64encode(raw).decode("ascii"),
                    "max_new_tokens": item.max_new_tokens,
                }
            )

        data = self._post_json("/caption/florence/batch", {"items": payload_items})
        by_id = {
            int(item["id"]): CaptionResult(
                id=int(item["id"]),
                ok=bool(item.get("ok")),
                description=item.get("description"),
                error=item.get("error"),
                duration_ms=item.get("duration_ms"),
            )
            for item in data.get("items", [])
        }
        return [
            by_id.get(item.id)
            or CaptionResult(id=item.id, ok=False, error="Missing result from remote worker")
            for item in items
        ]

    def sdxl_text_embeddings(self, items: list[SdxlEmbeddingItem]) -> list[SdxlEmbeddingResult]:
        payload = {
            "items": [
                {
                    "id": item.id,
                    "prompt": item.prompt,
                }
                for item in items
            ]
        }
        data = self._post_json("/embed/sdxl-text/batch", payload)
        by_id = {}
        for item in data.get("items", []):
            item_id = int(item["id"])
            if item.get("ok"):
                by_id[item_id] = SdxlEmbeddingResult(
                    id=item_id,
                    ok=True,
                    embedding=decode_embedding_payload(item["embedding"]),
                    duration_ms=item.get("duration_ms"),
                )
            else:
                by_id[item_id] = SdxlEmbeddingResult(
                    id=item_id,
                    ok=False,
                    error=item.get("error") or "Remote worker failed",
                )
        return [
            by_id.get(item.id)
            or SdxlEmbeddingResult(id=item.id, ok=False, error="Missing result from remote worker")
            for item in items
        ]

    def sdxl_image_from_embedding(
        self,
        embedding: dict[str, torch.Tensor],
        *,
        steps: int = 4,
        cfg: float = 0.5,
        size: int = 512,
        seed: int = 1,
    ) -> SdxlImageResult:
        data = self._post_json(
            "/generate/sdxl-image",
            {
                "embedding": encode_embedding_payload(embedding),
                "steps": steps,
                "cfg": cfg,
                "size": size,
                "seed": seed,
            },
        )
        if not data.get("ok"):
            return SdxlImageResult(ok=False, error=data.get("error") or "Remote worker failed")
        return SdxlImageResult(
            ok=True,
            image=base64.b64decode(data["image_base64"].encode("ascii")),
            duration_ms=data.get("duration_ms"),
        )


def get_model_backend() -> LocalModelBackend | RemoteHttpModelBackend:
    backend = os.environ.get("MODEL_BACKEND", "local").strip().lower()
    if backend == "remote":
        url = os.environ.get("MODEL_WORKER_URL", "").strip()
        if not url:
            raise RuntimeError("MODEL_BACKEND=remote requires MODEL_WORKER_URL")
        timeout = float(os.environ.get("MODEL_BACKEND_TIMEOUT", "120"))
        return RemoteHttpModelBackend(base_url=url, timeout=timeout)
    return LocalModelBackend()
