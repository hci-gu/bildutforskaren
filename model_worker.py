from __future__ import annotations

import base64
import tempfile
import time
from pathlib import Path
from typing import Any

import torch
from fastapi import FastAPI
from pydantic import BaseModel

from api.model_backends import (
    CAPTION_MODEL,
    CAPTION_TASK,
    IP_ADAPTER_REPO,
    IP_ADAPTER_SUBFOLDER,
    IP_ADAPTER_WEIGHT_NAME,
    SDXL_MODEL,
    CaptionItem,
    IpAdapterEmbeddingItem,
    LocalModelBackend,
    SdxlEmbeddingItem,
    decode_embedding_payload,
    encode_embedding_payload,
)


app = FastAPI(title="Bildutforskaren model worker")
backend = LocalModelBackend()


class CaptionBatchItem(BaseModel):
    id: int
    image_base64: str
    max_new_tokens: int = 160


class CaptionBatchRequest(BaseModel):
    items: list[CaptionBatchItem]


class SdxlTextEmbeddingBatchItem(BaseModel):
    id: int
    prompt: str


class SdxlTextEmbeddingBatchRequest(BaseModel):
    items: list[SdxlTextEmbeddingBatchItem]


class IpAdapterImageEmbeddingBatchItem(BaseModel):
    id: int
    image_base64: str


class IpAdapterImageEmbeddingBatchRequest(BaseModel):
    items: list[IpAdapterImageEmbeddingBatchItem]


class SdxlImageRequest(BaseModel):
    embedding: str
    steps: int = 4
    cfg: float = 0.5
    size: int = 512
    seed: int = 1


class IpAdapterImageRequest(BaseModel):
    embedding: str
    prompt: str = ""
    negative_prompt: str = ""
    steps: int = 4
    cfg: float = 0.0
    size: int = 512
    seed: int = 1
    adapter_scale: float = 0.9


@app.get("/health")
def health() -> dict[str, Any]:
    if torch.cuda.is_available():
        device = "cuda"
        gpu = torch.cuda.get_device_name(0)
    elif torch.backends.mps.is_available():
        device = "mps"
        gpu = "Apple Metal"
    else:
        device = "cpu"
        gpu = None

    return {
        "ok": True,
        "device": device,
        "gpu": gpu,
        "models": {
            "caption": CAPTION_MODEL,
            "caption_task": CAPTION_TASK,
            "sdxl_text": SDXL_MODEL,
            "ip_adapter_repo": IP_ADAPTER_REPO,
            "ip_adapter_subfolder": IP_ADAPTER_SUBFOLDER,
            "ip_adapter_weight_name": IP_ADAPTER_WEIGHT_NAME,
        },
    }


@app.post("/caption/florence/batch")
def caption_florence_batch(request: CaptionBatchRequest) -> dict[str, Any]:
    started_at = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="bildutforskaren-worker-") as tmp_dir:
        caption_items = []
        item_errors = {}
        for item in request.items:
            try:
                raw = base64.b64decode(item.image_base64.encode("ascii"))
                path = Path(tmp_dir) / f"{item.id}.image"
                path.write_bytes(raw)
                caption_items.append(
                    CaptionItem(
                        id=item.id,
                        image_path=path,
                        max_new_tokens=item.max_new_tokens,
                    )
                )
            except Exception as exc:
                item_errors[item.id] = {
                    "id": item.id,
                    "ok": False,
                    "error": str(exc),
                }

        results = []
        if caption_items:
            for result in backend.caption_images(caption_items):
                results.append(
                    {
                        "id": result.id,
                        "ok": result.ok,
                        "description": result.description,
                        "error": result.error,
                        "duration_ms": result.duration_ms,
                    }
                )

        results.extend(item_errors.values())
        results_by_id = {int(item["id"]): item for item in results}

    return {
        "items": [
            results_by_id.get(item.id)
            or {"id": item.id, "ok": False, "error": "Missing worker result"}
            for item in request.items
        ],
        "model": CAPTION_MODEL,
        "device": health()["device"],
        "batch_duration_ms": int((time.monotonic() - started_at) * 1000),
    }


@app.post("/embed/sdxl-text/batch")
def embed_sdxl_text_batch(request: SdxlTextEmbeddingBatchRequest) -> dict[str, Any]:
    started_at = time.monotonic()
    results = backend.sdxl_text_embeddings(
        [
            SdxlEmbeddingItem(
                id=item.id,
                prompt=item.prompt,
            )
            for item in request.items
        ]
    )
    return {
        "items": [
            {
                "id": result.id,
                "ok": result.ok,
                "embedding": encode_embedding_payload(result.embedding)
                if result.embedding is not None
                else None,
                "error": result.error,
                "duration_ms": result.duration_ms,
            }
            for result in results
        ],
        "model": SDXL_MODEL,
        "device": health()["device"],
        "batch_duration_ms": int((time.monotonic() - started_at) * 1000),
    }


@app.post("/embed/ip-adapter-image/batch")
def embed_ip_adapter_image_batch(
    request: IpAdapterImageEmbeddingBatchRequest,
) -> dict[str, Any]:
    started_at = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="bildutforskaren-worker-ip-adapter-") as tmp_dir:
        embedding_items = []
        item_errors = {}
        for item in request.items:
            try:
                raw = base64.b64decode(item.image_base64.encode("ascii"))
                path = Path(tmp_dir) / f"{item.id}.image"
                path.write_bytes(raw)
                embedding_items.append(
                    IpAdapterEmbeddingItem(
                        id=item.id,
                        image_path=path,
                    )
                )
            except Exception as exc:
                item_errors[item.id] = {
                    "id": item.id,
                    "ok": False,
                    "error": str(exc),
                }

        results = []
        if embedding_items:
            for result in backend.ip_adapter_image_embeddings(embedding_items):
                results.append(
                    {
                        "id": result.id,
                        "ok": result.ok,
                        "embedding": encode_embedding_payload(result.embedding)
                        if result.embedding is not None
                        else None,
                        "error": result.error,
                        "duration_ms": result.duration_ms,
                    }
                )

        results.extend(item_errors.values())
        results_by_id = {int(item["id"]): item for item in results}

    return {
        "items": [
            results_by_id.get(item.id)
            or {"id": item.id, "ok": False, "error": "Missing worker result"}
            for item in request.items
        ],
        "model": SDXL_MODEL,
        "ip_adapter_repo": IP_ADAPTER_REPO,
        "ip_adapter_subfolder": IP_ADAPTER_SUBFOLDER,
        "ip_adapter_weight_name": IP_ADAPTER_WEIGHT_NAME,
        "device": health()["device"],
        "batch_duration_ms": int((time.monotonic() - started_at) * 1000),
    }


@app.post("/generate/sdxl-image")
def generate_sdxl_image(request: SdxlImageRequest) -> dict[str, Any]:
    embedding = decode_embedding_payload(request.embedding)
    result = backend.sdxl_image_from_embedding(
        embedding,
        steps=request.steps,
        cfg=request.cfg,
        size=request.size,
        seed=request.seed,
    )
    return {
        "ok": result.ok,
        "image_base64": base64.b64encode(result.image).decode("ascii")
        if result.image is not None
        else None,
        "error": result.error,
        "duration_ms": result.duration_ms,
        "model": SDXL_MODEL,
        "device": health()["device"],
    }


@app.post("/generate/sdxl-image-from-ip-adapter")
def generate_sdxl_image_from_ip_adapter(request: IpAdapterImageRequest) -> dict[str, Any]:
    embedding = decode_embedding_payload(request.embedding)
    result = backend.sdxl_image_from_ip_adapter_embedding(
        embedding,
        prompt=request.prompt,
        negative_prompt=request.negative_prompt,
        steps=request.steps,
        cfg=request.cfg,
        size=request.size,
        seed=request.seed,
        adapter_scale=request.adapter_scale,
    )
    return {
        "ok": result.ok,
        "image_base64": base64.b64encode(result.image).decode("ascii")
        if result.image is not None
        else None,
        "error": result.error,
        "duration_ms": result.duration_ms,
        "model": SDXL_MODEL,
        "ip_adapter_repo": IP_ADAPTER_REPO,
        "ip_adapter_subfolder": IP_ADAPTER_SUBFOLDER,
        "ip_adapter_weight_name": IP_ADAPTER_WEIGHT_NAME,
        "device": health()["device"],
    }
