from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Callable, List

import numpy as np
import torch
from PIL import Image
from transformers import CLIPProcessor, CLIPModel

@lru_cache(maxsize=1)
def _load_clip():
    logging.info("Loading CLIP model …")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = CLIPModel.from_pretrained("openai/clip-vit-large-patch14").to(device)
    processor = CLIPProcessor.from_pretrained(
        "openai/clip-vit-large-patch14",
        from_tf=True,
        use_fast=False,
    )
    return model, processor, device

def embed_images(
    paths: List[Path],
    *,
    progress_cb: Callable[[int, int], None] | None = None,
) -> torch.Tensor:
    model, processor, device = _load_clip()

    all_embeddings = []
    batch_size = 32
    total = len(paths)
    for i in range(0, len(paths), batch_size):
        logging.info("Embedding %s images (%s/%s)", batch_size, i, len(paths))
        batch_paths = paths[i : i + batch_size]
        imgs = [Image.open(p).convert("RGB") for p in batch_paths]
        inputs = processor(images=imgs, return_tensors="pt", padding=True).to(device)
        with torch.no_grad():
            feats = model.get_image_features(**inputs)
            feats = feats / feats.norm(dim=-1, keepdim=True)
        all_embeddings.append(feats.cpu())
        if progress_cb is not None:
            done = min(i + len(batch_paths), total)
            progress_cb(done, total)

    return torch.cat(all_embeddings, dim=0)

def embed_text(prompts: list[str]) -> np.ndarray:
    model, processor, device = _load_clip()

    with torch.no_grad():
        inputs = processor(text=prompts, return_tensors="pt", padding=True).to(device)
        txt = model.get_text_features(**inputs)
        txt = txt / txt.norm(dim=-1, keepdim=True)

    return txt.cpu().numpy().astype("float32")
