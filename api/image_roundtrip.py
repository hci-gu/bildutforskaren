from __future__ import annotations

import json
import logging
import os
import time
from collections import deque
from pathlib import Path

os.environ.setdefault(
    "HF_HOME",
    str(Path(__file__).resolve().parents[1] / ".cache" / "huggingface"),
)

import numpy as np
import torch
from transformers import AutoTokenizer

from api import datasets
from api import runtime
from api.models import DatasetContext
from api import context as context_builder
from api.model_backends import (
    CAPTION_MODEL,
    CAPTION_TASK,
    SDXL_MODEL,
    CaptionItem,
    CaptionResult,
    SdxlEmbeddingItem,
    SdxlEmbeddingResult,
    get_model_backend,
)


ETA_WINDOW_SIZE = 10
SDXL_MAX_TOKENS = 77
SDXL_CONTENT_TOKENS = 75
FLORENCE_BATCH_SIZE = int(os.environ.get("FLORENCE_BATCH_SIZE", "16"))
SDXL_TEXT_BATCH_SIZE = int(os.environ.get("SDXL_TEXT_BATCH_SIZE", "32"))
REQUIRED_ARTIFACTS = (
    "clip_embedding",
    "description",
    "sdxl_prompt",
    "sdxl_embedding",
    "metadata",
)
ARTIFACT_GROUPS = {
    "clip": ("clip_embedding",),
    "florence": ("description", "sdxl_prompt", "sdxl_embedding", "metadata"),
    "sdxl": ("sdxl_prompt", "sdxl_embedding", "metadata"),
}


_sdxl_tokenizer = None


def _artifact_root(ctx: DatasetContext) -> Path:
    return ctx.cfg.cache_dir / "image_roundtrip"


def _artifact_dir(ctx: DatasetContext, image_id: int) -> Path:
    return _artifact_root(ctx) / str(image_id)


def _artifact_paths(ctx: DatasetContext, image_id: int) -> dict[str, Path]:
    base = _artifact_dir(ctx, image_id)
    return {
        "clip_embedding": base / "clip_image_embedding.npy",
        "description": base / "description.txt",
        "sdxl_prompt": base / "sdxl_prompt.txt",
        "sdxl_embedding": base / "sdxl_text_embedding.pt",
        "metadata": base / "metadata.json",
    }


def _original_path(ctx: DatasetContext, image_id: int) -> Path:
    rel = ctx.image_paths[image_id].relative_to(ctx.cfg.thumb_root)
    return ctx.cfg.original_root / rel


def _get_context(dataset_id: str) -> DatasetContext:
    cache = runtime.get_context_cache()

    def _builder(ds_id: str):
        cfg = datasets.get_dataset_config(ds_id)
        return context_builder.build_context(cfg)

    return cache.get(dataset_id, _builder)


def _load_sdxl_tokenizer():
    global _sdxl_tokenizer
    if _sdxl_tokenizer is None:
        _sdxl_tokenizer = AutoTokenizer.from_pretrained(SDXL_MODEL, subfolder="tokenizer")
    return _sdxl_tokenizer


def _sentence_parts(text: str) -> list[str]:
    normalized = " ".join(text.replace("\n", " ").split())
    if not normalized:
        return []
    parts = []
    start = 0
    for idx, char in enumerate(normalized):
        if char in ".!?;":
            part = normalized[start : idx + 1].strip()
            if part:
                parts.append(part)
            start = idx + 1
    tail = normalized[start:].strip()
    if tail:
        parts.append(tail)
    return parts


def _token_count(tokenizer, text: str) -> int:
    return len(tokenizer(text, truncation=False, add_special_tokens=True).input_ids)


def _truncate_to_token_limit(tokenizer, text: str, max_tokens: int) -> str:
    encoded = tokenizer(
        text,
        truncation=True,
        max_length=max_tokens,
        add_special_tokens=True,
    )
    return tokenizer.decode(encoded.input_ids, skip_special_tokens=True).strip()


def _sdxl_prompt_from_description(description: str) -> tuple[str, int]:
    tokenizer = _load_sdxl_tokenizer()
    style_prefix = "archival documentary photograph, detailed composition"
    parts = _sentence_parts(description)
    selected = []

    for candidate in [style_prefix, *parts]:
        proposal = ", ".join([*selected, candidate])
        if _token_count(tokenizer, proposal) <= SDXL_CONTENT_TOKENS:
            selected.append(candidate)

    prompt = ", ".join(selected) if selected else description
    if _token_count(tokenizer, prompt) > SDXL_CONTENT_TOKENS:
        prompt = _truncate_to_token_limit(tokenizer, prompt, SDXL_CONTENT_TOKENS)

    return prompt, _token_count(tokenizer, prompt)


def _chunked(items: list, size: int):
    size = max(1, int(size))
    for idx in range(0, len(items), size):
        yield items[idx : idx + size]


def _caption_batch_resilient(backend, batch: list[CaptionItem]):
    try:
        return backend.caption_images(batch)
    except Exception as exc:
        if len(batch) <= 1:
            return [CaptionResult(id=batch[0].id, ok=False, error=str(exc))]
        midpoint = len(batch) // 2
        return [
            *_caption_batch_resilient(backend, batch[:midpoint]),
            *_caption_batch_resilient(backend, batch[midpoint:]),
        ]


def _sdxl_batch_resilient(backend, batch: list[SdxlEmbeddingItem]):
    try:
        return backend.sdxl_text_embeddings(batch)
    except Exception as exc:
        if len(batch) <= 1:
            return [SdxlEmbeddingResult(id=batch[0].id, ok=False, error=str(exc))]
        midpoint = len(batch) // 2
        return [
            *_sdxl_batch_resilient(backend, batch[:midpoint]),
            *_sdxl_batch_resilient(backend, batch[midpoint:]),
        ]


def _missing_for_image(ctx: DatasetContext, image_id: int) -> list[str]:
    paths = _artifact_paths(ctx, image_id)
    return [key for key in REQUIRED_ARTIFACTS if not paths[key].exists()]


def _missing_image_ids(ctx: DatasetContext) -> list[int]:
    return [
        image_id
        for image_id in range(len(ctx.image_paths))
        if _missing_for_image(ctx, image_id)
    ]


def artifact_status(dataset_id: str) -> dict:
    ctx = _get_context(dataset_id)
    total = len(ctx.image_paths)
    complete = 0
    missing_by_kind = {
        "clip_embedding": 0,
        "description": 0,
        "sdxl_prompt": 0,
        "sdxl_embedding": 0,
        "metadata": 0,
    }
    existing_by_kind = {key: 0 for key in missing_by_kind}

    for image_id in range(total):
        paths = _artifact_paths(ctx, image_id)
        missing = _missing_for_image(ctx, image_id)
        if not missing:
            complete += 1
        for key in missing:
            if key in missing_by_kind:
                missing_by_kind[key] += 1
        for key in existing_by_kind:
            if paths[key].exists():
                existing_by_kind[key] += 1

    existing_groups = {
        "clip": existing_by_kind["clip_embedding"],
        "florence": existing_by_kind["description"],
        "sdxl": min(existing_by_kind["sdxl_prompt"], existing_by_kind["sdxl_embedding"]),
    }

    return {
        "total": total,
        "complete": complete,
        "missing": max(0, total - complete),
        "missing_by_kind": missing_by_kind,
        "existing_by_kind": existing_by_kind,
        "existing_groups": existing_groups,
        "root": str(_artifact_root(ctx)),
    }


def clear_artifacts(dataset_id: str, artifact_group: str) -> dict:
    if artifact_group not in ARTIFACT_GROUPS:
        raise ValueError("Invalid artifact group")

    ctx = _get_context(dataset_id)
    artifact_keys = ARTIFACT_GROUPS[artifact_group]
    deleted = {key: 0 for key in artifact_keys}

    for image_id in range(len(ctx.image_paths)):
        paths = _artifact_paths(ctx, image_id)
        for key in artifact_keys:
            path = paths[key]
            if not path.exists():
                continue
            path.unlink()
            deleted[key] += 1

    status = artifact_status(dataset_id)
    return {
        "artifact_group": artifact_group,
        "deleted": deleted,
        "image_roundtrip": status,
    }


def image_embedding_status(dataset_id: str, image_id: int) -> dict:
    ctx = _get_context(dataset_id)
    if not (0 <= image_id < len(ctx.image_paths)):
        raise IndexError("Image ID not found")

    paths = _artifact_paths(ctx, image_id)
    prompt = None
    if paths["sdxl_prompt"].exists():
        prompt = paths["sdxl_prompt"].read_text(encoding="utf-8").strip()

    return {
        "dataset_id": dataset_id,
        "image_id": image_id,
        "has_sdxl_embedding": paths["sdxl_embedding"].exists(),
        "has_sdxl_prompt": paths["sdxl_prompt"].exists(),
        "sdxl_prompt": prompt,
    }


def generate_image_from_saved_embedding(
    dataset_id: str,
    image_id: int,
    *,
    steps: int = 4,
    cfg: float = 0.5,
    size: int = 512,
    seed: int = 1,
) -> bytes:
    ctx = _get_context(dataset_id)
    if not (0 <= image_id < len(ctx.image_paths)):
        raise IndexError("Image ID not found")

    path = _artifact_paths(ctx, image_id)["sdxl_embedding"]
    if not path.exists():
        raise FileNotFoundError("SDXL embedding not found")

    embedding = torch.load(path, map_location="cpu")
    result = get_model_backend().sdxl_image_from_embedding(
        embedding,
        steps=steps,
        cfg=cfg,
        size=size,
        seed=seed,
    )
    if not result.ok or result.image is None:
        raise RuntimeError(result.error or "Image generation failed")
    return result.image


def _is_complete(ctx: DatasetContext, image_id: int) -> bool:
    return not _missing_for_image(ctx, image_id)


def _write_metadata(ctx: DatasetContext, image_id: int, max_new_tokens: int) -> bool:
    paths = _artifact_paths(ctx, image_id)
    required = ("clip_embedding", "description", "sdxl_prompt", "sdxl_embedding")
    if any(not paths[key].exists() for key in required):
        return False

    description = paths["description"].read_text(encoding="utf-8").strip()
    sdxl_prompt = paths["sdxl_prompt"].read_text(encoding="utf-8").strip()
    metadata = {
        "dataset_id": ctx.cfg.dataset_id,
        "image_id": image_id,
        "original_image": str(_original_path(ctx, image_id)),
        "description": description,
        "sdxl_prompt": sdxl_prompt,
        "sdxl_prompt_tokens": _token_count(_load_sdxl_tokenizer(), sdxl_prompt),
        "sdxl_prompt_token_limit": SDXL_MAX_TOKENS,
        "clip_model": "dataset clip index",
        "caption_model": CAPTION_MODEL,
        "caption_task": CAPTION_TASK,
        "caption_tokens": max_new_tokens,
        "sdxl_model": SDXL_MODEL,
        "outputs": {key: str(path) for key, path in paths.items()},
    }
    paths["metadata"].write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return True


def process_dataset(dataset_id: str, *, max_new_tokens: int = 160) -> None:
    manager = runtime.get_job_manager()
    ctx = _get_context(dataset_id)
    total = len(ctx.image_paths)
    work_image_ids = _missing_image_ids(ctx)
    total_work = len(work_image_ids)
    durations = deque(maxlen=ETA_WINDOW_SIZE)
    backend = get_model_backend()

    def _eta_seconds(remaining: int) -> float | None:
        if not durations or remaining <= 0:
            return None
        return (sum(durations) / len(durations)) * remaining

    def _completed_work_count() -> int:
        return sum(1 for image_id in work_image_ids if _is_complete(ctx, image_id))

    def _set_progress(processed: int | None = None, skipped: int | None = None) -> None:
        if processed is None:
            processed = _completed_work_count()
        if skipped is None:
            skipped = total - total_work
        remaining = max(0, total_work - processed)
        eta = _eta_seconds(remaining)
        seconds_per_item = (sum(durations) / len(durations)) if durations else None
        manager.set_state(
            dataset_id,
            stage="image-roundtrip",
            progress=1.0 if total_work == 0 else min(1.0, processed / total_work),
            processed=processed,
            skipped=skipped,
            remaining=remaining,
            total_work=total_work,
            eta_seconds=eta,
            seconds_per_item=seconds_per_item,
            eta_window=len(durations),
        )

    def _record_batch_duration(started_at: float, item_count: int) -> None:
        if item_count <= 0:
            return
        seconds_per_item = (time.monotonic() - started_at) / item_count
        for _ in range(min(item_count, ETA_WINDOW_SIZE)):
            durations.append(seconds_per_item)

    try:
        _set_progress()

        clip_started_at = time.monotonic()
        clip_written = 0
        for image_id in work_image_ids:
            paths = _artifact_paths(ctx, image_id)
            paths["metadata"].parent.mkdir(parents=True, exist_ok=True)
            if not paths["clip_embedding"].exists():
                embedding = ctx.embeddings[image_id].cpu().numpy().astype("float32")
                norm = max(1e-12, float(np.linalg.norm(embedding)))
                np.save(paths["clip_embedding"], embedding / norm)
                clip_written += 1
        _record_batch_duration(clip_started_at, clip_written)
        _set_progress()

        caption_items = [
            CaptionItem(
                id=image_id,
                image_path=_original_path(ctx, image_id),
                max_new_tokens=max_new_tokens,
            )
            for image_id in work_image_ids
            if not _artifact_paths(ctx, image_id)["description"].exists()
        ]
        for batch in _chunked(caption_items, FLORENCE_BATCH_SIZE):
            started_at = time.monotonic()
            results = _caption_batch_resilient(backend, batch)
            successes = 0
            for result in results:
                if not result.ok or not result.description:
                    logging.warning(
                        "Caption failed for dataset=%s image_id=%s: %s",
                        dataset_id,
                        result.id,
                        result.error,
                    )
                    continue
                paths = _artifact_paths(ctx, result.id)
                paths["description"].write_text(result.description + "\n", encoding="utf-8")
                successes += 1
            _record_batch_duration(started_at, successes)
            _set_progress()

        prompt_created = set()
        for image_id in work_image_ids:
            paths = _artifact_paths(ctx, image_id)
            if not paths["description"].exists():
                continue
            if paths["sdxl_prompt"].exists():
                continue
            description = paths["description"].read_text(encoding="utf-8").strip()
            sdxl_prompt, _ = _sdxl_prompt_from_description(description)
            paths["sdxl_prompt"].write_text(sdxl_prompt + "\n", encoding="utf-8")
            prompt_created.add(image_id)

        embedding_items = []
        for image_id in work_image_ids:
            paths = _artifact_paths(ctx, image_id)
            if not paths["sdxl_prompt"].exists():
                continue
            if paths["sdxl_embedding"].exists() and image_id not in prompt_created:
                continue
            embedding_items.append(
                SdxlEmbeddingItem(
                    id=image_id,
                    prompt=paths["sdxl_prompt"].read_text(encoding="utf-8").strip(),
                )
            )

        for batch in _chunked(embedding_items, SDXL_TEXT_BATCH_SIZE):
            started_at = time.monotonic()
            results = _sdxl_batch_resilient(backend, batch)
            successes = 0
            for result in results:
                if not result.ok or result.embedding is None:
                    logging.warning(
                        "SDXL text embedding failed for dataset=%s image_id=%s: %s",
                        dataset_id,
                        result.id,
                        result.error,
                    )
                    continue
                torch.save(result.embedding, _artifact_paths(ctx, result.id)["sdxl_embedding"])
                successes += 1
            _record_batch_duration(started_at, successes)

            metadata_written = 0
            for item in batch:
                if _write_metadata(ctx, item.id, max_new_tokens):
                    metadata_written += 1
            _record_batch_duration(started_at, metadata_written)
            _set_progress()

        for image_id in work_image_ids:
            _write_metadata(ctx, image_id, max_new_tokens)
        _set_progress()

        completed = _completed_work_count()
        remaining = max(0, total_work - completed)
        manager.set_state(
            dataset_id,
            stage="ready",
            progress=1.0 if total_work == 0 else min(1.0, completed / total_work),
            processed=completed,
            skipped=total - total_work,
            remaining=remaining,
            total_work=total_work,
            eta_seconds=0 if remaining == 0 else None,
            seconds_per_item=(sum(durations) / len(durations)) if durations else None,
            eta_window=len(durations),
        )

    except Exception as exc:
        logging.exception("Image roundtrip generation failed for %s", dataset_id)
        manager.set_state(dataset_id, stage="error", error=str(exc))


def submit(dataset_id: str, **options) -> None:
    runtime.get_job_manager().submit(
        lambda ds_id: process_dataset(ds_id, **options),
        dataset_id,
    )
