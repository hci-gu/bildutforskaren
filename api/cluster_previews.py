from __future__ import annotations

import json
import logging
import shutil
import time
from collections import deque
from pathlib import Path

import numpy as np
import torch

from api import context as context_builder
from api import datasets
from api import indexing
from api import runtime
from api.clustering import ClusteringConfig, fit_model
from api.model_backends import (
    IP_ADAPTER_DEFAULT_SCALE,
    IP_ADAPTER_REPO,
    IP_ADAPTER_SUBFOLDER,
    IP_ADAPTER_WEIGHT_NAME,
    SDXL_MODEL,
    get_model_backend,
)
from api.models import DatasetContext


DEFAULT_LEVELS = 4
ETA_WINDOW_SIZE = 10
PREVIEW_METHOD = "average_ip_adapter_embedding"
UMAP_PARAMS = {
    "n_neighbors": 15,
    "min_dist": 0.1,
    "n_components": 2,
    "spread": 1.0,
    "seed": 1,
}


def _get_context(dataset_id: str) -> DatasetContext:
    cache = runtime.get_context_cache()

    def _builder(ds_id: str):
        cfg = datasets.get_dataset_config(ds_id)
        return context_builder.build_context(cfg)

    return cache.get(dataset_id, _builder)


def _root(ctx: DatasetContext) -> Path:
    return ctx.cfg.cache_dir / "cluster_previews"


def _manifest_path(ctx: DatasetContext) -> Path:
    return _root(ctx) / "manifest.json"


def _image_dir(ctx: DatasetContext) -> Path:
    return _root(ctx) / "images"


def _image_path(ctx: DatasetContext, cluster_id: str) -> Path:
    return _image_dir(ctx) / f"{cluster_id}.png"


def _ip_adapter_embedding_path(ctx: DatasetContext, image_id: int) -> Path:
    return (
        ctx.cfg.cache_dir
        / "image_roundtrip"
        / str(image_id)
        / "ip_adapter_image_embeds.pt"
    )


def _bounds(points: np.ndarray) -> dict:
    min_xy = points.min(axis=0)
    max_xy = points.max(axis=0)
    return {
        "min_x": float(min_xy[0]),
        "min_y": float(min_xy[1]),
        "max_x": float(max_xy[0]),
        "max_y": float(max_xy[1]),
        "width": float(max_xy[0] - min_xy[0]),
        "height": float(max_xy[1] - min_xy[1]),
    }


def _build_default_projection(ctx: DatasetContext) -> tuple[list[int], np.ndarray]:
    try:
        import umap  # type: ignore
    except Exception as exc:
        raise RuntimeError("UMAP dependency not available") from exc

    image_ids = list(range(len(ctx.embeddings)))
    image_vectors = ctx.embeddings.numpy().astype("float32")
    image_vectors = indexing.l2_normalize_rows(image_vectors)
    reducer = umap.UMAP(
        n_neighbors=int(UMAP_PARAMS["n_neighbors"]),
        min_dist=float(UMAP_PARAMS["min_dist"]),
        n_components=int(UMAP_PARAMS["n_components"]),
        spread=float(UMAP_PARAMS["spread"]),
        metric="cosine",
        random_state=int(UMAP_PARAMS["seed"]),
        transform_seed=int(UMAP_PARAMS["seed"]),
    )
    return image_ids, reducer.fit_transform(image_vectors).astype("float32")


def _build_cluster_records(
    *,
    points: np.ndarray,
    image_ids: list[int],
    max_levels: int,
    clustering_config: ClusteringConfig,
    parent_id: str | None = None,
    level: int = 1,
) -> list[dict]:
    if level > max_levels or len(image_ids) == 0:
        return []

    clustering_result = fit_model(points, clustering_config)
    clusters = clustering_result.clusters
    records: list[dict] = []
    can_subcluster = clustering_config.method == "recursive" and len(clusters) > 1

    for index, cluster in enumerate(clusters):
        local_indices = [
            idx for idx in cluster.point_indices if 0 <= idx < len(image_ids)
        ]
        if not local_indices:
            continue

        cluster_id = f"{parent_id}_{index}" if parent_id else str(index)
        cluster_points = points[local_indices]
        cluster_image_ids = [int(image_ids[idx]) for idx in local_indices]
        centroid = cluster_points.mean(axis=0)

        records.append(
            {
                "id": cluster_id,
                "parent_id": parent_id,
                "level": level,
                "image_ids": cluster_image_ids,
                "image_count": len(cluster_image_ids),
                "centroid": [float(centroid[0]), float(centroid[1])],
                "bounds": _bounds(cluster_points),
                "image_path": f"images/{cluster_id}.png",
                "has_image": False,
            }
        )

        if (
            can_subcluster
            and level < max_levels
            and len(cluster_image_ids) >= 3
            and len(cluster_image_ids) < len(image_ids)
        ):
            records.extend(
                _build_cluster_records(
                    points=cluster_points,
                    image_ids=cluster_image_ids,
                    max_levels=max_levels,
                    clustering_config=clustering_config,
                    parent_id=cluster_id,
                    level=level + 1,
                )
            )

    return records


def _average_tensor_lists(
    embeddings: list[dict],
    key: str,
) -> list[torch.Tensor]:
    first = embeddings[0][key]
    sums = [torch.zeros_like(tensor, dtype=torch.float32) for tensor in first]
    dtypes = [tensor.dtype for tensor in first]
    for embedding in embeddings:
        values = embedding[key]
        if len(values) != len(sums):
            raise ValueError(f"IP-Adapter embedding list length mismatch for {key}")
        for idx, tensor in enumerate(values):
            if tensor.shape != sums[idx].shape:
                raise ValueError(f"IP-Adapter embedding shape mismatch for {key}[{idx}]")
            sums[idx].add_(tensor.to(dtype=torch.float32))
    return [
        (tensor_sum / len(embeddings)).to(dtype=dtypes[idx])
        for idx, tensor_sum in enumerate(sums)
    ]


def _average_ip_adapter_embedding(ctx: DatasetContext, image_ids: list[int]) -> dict:
    embeddings = []
    for image_id in image_ids:
        path = _ip_adapter_embedding_path(ctx, image_id)
        if not path.exists():
            raise FileNotFoundError(f"IP-Adapter embedding not found for image {image_id}")
        embeddings.append(torch.load(path, map_location="cpu"))

    if not embeddings:
        raise ValueError("No image IDs provided")

    return {
        "format": "diffusers_ip_adapter_image_embeds",
        "format_version": 1,
        "sdxl_model": SDXL_MODEL,
        "ip_adapter_repo": IP_ADAPTER_REPO,
        "ip_adapter_subfolder": IP_ADAPTER_SUBFOLDER,
        "ip_adapter_weight_name": IP_ADAPTER_WEIGHT_NAME,
        "positive": _average_tensor_lists(embeddings, "positive"),
        "classifier_free_guidance": _average_tensor_lists(
            embeddings,
            "classifier_free_guidance",
        ),
    }


def _write_manifest(ctx: DatasetContext, manifest: dict) -> None:
    root = _root(ctx)
    root.mkdir(parents=True, exist_ok=True)
    _manifest_path(ctx).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def load_manifest(dataset_id: str) -> dict:
    ctx = _get_context(dataset_id)
    path = _manifest_path(ctx)
    if not path.exists():
        raise FileNotFoundError("Cluster previews have not been baked")
    return json.loads(path.read_text(encoding="utf-8"))


def image_file(dataset_id: str, cluster_id: str) -> Path:
    ctx = _get_context(dataset_id)
    path = _image_path(ctx, cluster_id)
    if not path.exists():
        raise FileNotFoundError("Cluster preview image not found")
    return path


def status(dataset_id: str) -> dict:
    ctx = _get_context(dataset_id)
    manifest_path = _manifest_path(ctx)
    if not manifest_path.exists():
        return {
            "exists": False,
            "levels": 0,
            "clusters": 0,
            "images": 0,
            "root": str(_root(ctx)),
        }

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    clusters = manifest.get("clusters") or []
    images = sum(1 for cluster in clusters if _image_path(ctx, cluster["id"]).exists())
    levels = max((int(cluster.get("level", 0)) for cluster in clusters), default=0)
    return {
        "exists": True,
        "levels": levels,
        "requested_levels": manifest.get("requested_levels"),
        "clusters": len(clusters),
        "images": images,
        "root": str(_root(ctx)),
        "created_at": manifest.get("created_at"),
        "params": manifest.get("params"),
        "clustering": manifest.get("clustering"),
        "image_generation": manifest.get("image_generation"),
    }


def clear(dataset_id: str) -> dict:
    ctx = _get_context(dataset_id)
    root = _root(ctx)
    existed = root.exists()
    if existed:
        shutil.rmtree(root)
    return {"deleted": existed, "cluster_previews": status(dataset_id)}


def bake(
    dataset_id: str,
    *,
    levels: int = DEFAULT_LEVELS,
    size: int = 512,
    clustering_config: ClusteringConfig | None = None,
) -> None:
    levels = max(1, int(levels))
    size = max(128, int(size))
    clustering_config = clustering_config or ClusteringConfig()
    effective_levels = 1 if clustering_config.algorithm == "hdbscan" else levels
    ctx = _get_context(dataset_id)
    manager = runtime.get_job_manager()
    durations: deque[float] = deque(maxlen=ETA_WINDOW_SIZE)

    def eta_seconds(remaining: int) -> float | None:
        if not durations:
            return None
        return (sum(durations) / len(durations)) * remaining

    def set_progress(processed: int, total: int, *, skipped: int = 0) -> None:
        remaining = max(0, total - processed)
        seconds_per_item = (sum(durations) / len(durations)) if durations else None
        manager.set_state(
            dataset_id,
            stage="cluster-previews",
            progress=1.0 if total == 0 else min(1.0, processed / total),
            processed=processed,
            skipped=skipped,
            remaining=remaining,
            total_work=total,
            eta_seconds=eta_seconds(remaining),
            seconds_per_item=seconds_per_item,
            eta_window=len(durations),
        )

    try:
        manager.set_state(
            dataset_id,
            stage="cluster-previews",
            progress=0,
            processed=0,
            total_work=0,
        )
        image_ids, points = _build_default_projection(ctx)
        clusters = _build_cluster_records(
            points=points,
            image_ids=image_ids,
            max_levels=effective_levels,
            clustering_config=clustering_config,
        )

        clustering_manifest = clustering_config.to_dict()
        image_generation_manifest = {
            "method": PREVIEW_METHOD,
            "size": size,
        }
        manifest = {
            "dataset_id": dataset_id,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "requested_levels": levels,
            "effective_levels": effective_levels,
            "params": UMAP_PARAMS,
            "clustering": clustering_manifest,
            "image_generation": image_generation_manifest,
            "projection": {
                "image_ids": image_ids,
                "image_points": points.tolist(),
            },
            "clusters": clusters,
        }

        manifest_path = _manifest_path(ctx)
        if manifest_path.exists():
            previous_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            configuration_changed = (
                previous_manifest.get("clustering") != clustering_manifest
                or previous_manifest.get("image_generation")
                != image_generation_manifest
                or previous_manifest.get("params") != UMAP_PARAMS
            )
            if configuration_changed and _image_dir(ctx).exists():
                shutil.rmtree(_image_dir(ctx))
        _write_manifest(ctx, manifest)

        _image_dir(ctx).mkdir(parents=True, exist_ok=True)
        backend = get_model_backend()
        processed = 0
        skipped = 0
        total = len(clusters)
        set_progress(processed, total)

        for cluster in clusters:
            output_path = _image_path(ctx, cluster["id"])
            if output_path.exists():
                cluster["has_image"] = True
                processed += 1
                skipped += 1
                set_progress(processed, total, skipped=skipped)
                continue

            started_at = time.monotonic()
            embedding = _average_ip_adapter_embedding(ctx, cluster["image_ids"])
            result = backend.sdxl_image_from_ip_adapter_embedding(
                embedding,
                steps=4,
                cfg=0.0,
                size=size,
                seed=1,
                adapter_scale=IP_ADAPTER_DEFAULT_SCALE,
            )
            if not result.ok or result.image is None:
                raise RuntimeError(result.error or "Cluster image generation failed")
            output_path.write_bytes(result.image)
            cluster["has_image"] = True
            processed += 1
            durations.append(time.monotonic() - started_at)
            if processed % 3 == 0:
                _write_manifest(ctx, manifest)
            set_progress(processed, total, skipped=skipped)

        _write_manifest(ctx, manifest)
        manager.set_state(
            dataset_id,
            stage="ready",
            progress=1,
            processed=processed,
            skipped=skipped,
            remaining=0,
            total_work=total,
            eta_seconds=0,
        )
    except Exception as exc:
        logging.exception("Failed to bake cluster previews for %s", dataset_id)
        manager.set_state(dataset_id, stage="error", error=str(exc))
        raise


def submit(
    dataset_id: str,
    *,
    levels: int = DEFAULT_LEVELS,
    size: int = 512,
    clustering_config: ClusteringConfig | None = None,
) -> None:
    effective_config = clustering_config or ClusteringConfig()
    runtime.get_job_manager().submit(
        lambda ds_id: bake(
            ds_id,
            levels=levels,
            size=size,
            clustering_config=effective_config,
        ),
        dataset_id,
    )
