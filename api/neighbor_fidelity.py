from __future__ import annotations

from typing import Any

import numpy as np


EPSILON = 1e-12


def _normalize_rows(vectors: np.ndarray) -> np.ndarray:
    values = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    return values / np.maximum(norms, EPSILON)


def analyze_neighbor_fidelity(
    embeddings: np.ndarray,
    image_ids: list[int],
    projection_points: np.ndarray,
    selected_image_id: int,
    k: int,
) -> dict[str, Any]:
    vectors = _normalize_rows(np.asarray(embeddings, dtype=np.float32)[image_ids])
    points = np.asarray(projection_points, dtype=np.float64)
    selected_offset = image_ids.index(selected_image_id)
    effective_k = min(k, len(image_ids) - 1)

    clip_similarities = vectors @ vectors[selected_offset]
    projection_distances = np.linalg.norm(
        points - points[selected_offset],
        axis=1,
    )
    candidate_offsets = [
        offset for offset in range(len(image_ids)) if offset != selected_offset
    ]
    clip_order = sorted(
        candidate_offsets,
        key=lambda offset: (-float(clip_similarities[offset]), image_ids[offset]),
    )
    projection_order = sorted(
        candidate_offsets,
        key=lambda offset: (float(projection_distances[offset]), image_ids[offset]),
    )

    clip_ranks = {
        offset: rank for rank, offset in enumerate(clip_order, start=1)
    }
    projection_ranks = {
        offset: rank for rank, offset in enumerate(projection_order, start=1)
    }
    clip_neighbors = set(clip_order[:effective_k])
    projection_neighbors = set(projection_order[:effective_k])
    preserved = clip_neighbors & projection_neighbors
    clip_only = clip_neighbors - projection_neighbors
    projection_only = projection_neighbors - clip_neighbors

    def record(offset: int) -> dict[str, Any]:
        return {
            "image_id": image_ids[offset],
            "clip_rank": clip_ranks[offset],
            "projection_rank": projection_ranks[offset],
            "clip_similarity": float(clip_similarities[offset]),
            "projection_distance": float(projection_distances[offset]),
        }

    return {
        "selected_image_id": selected_image_id,
        "requested_k": k,
        "effective_k": effective_k,
        "retention": (
            float(len(preserved) / effective_k) if effective_k else 0.0
        ),
        "neighbors": {
            "preserved": [
                record(offset)
                for offset in sorted(
                    preserved,
                    key=lambda offset: (clip_ranks[offset], image_ids[offset]),
                )
            ],
            "clip_only": [
                record(offset)
                for offset in sorted(
                    clip_only,
                    key=lambda offset: (clip_ranks[offset], image_ids[offset]),
                )
            ],
            "projection_only": [
                record(offset)
                for offset in sorted(
                    projection_only,
                    key=lambda offset: (
                        projection_ranks[offset],
                        image_ids[offset],
                    ),
                )
            ],
        },
    }
