from __future__ import annotations

from typing import Any

import numpy as np

from api.clustering import ClusteringConfig, fit_model


EPSILON = 1e-12
PROFILE_LIMIT = 5


def _normalize_rows(values: np.ndarray) -> np.ndarray:
    rows = np.asarray(values, dtype=np.float32)
    norms = np.linalg.norm(rows, axis=1, keepdims=True)
    return rows / np.maximum(norms, EPSILON)


def _normalized_centroid(values: np.ndarray) -> np.ndarray:
    centroid = np.asarray(values, dtype=np.float32).mean(axis=0)
    return centroid / max(float(np.linalg.norm(centroid)), EPSILON)


def analyze_cluster_profiles(
    image_embeddings: np.ndarray,
    image_ids: list[int],
    projection_points: np.ndarray,
    clustering_config: ClusteringConfig,
    concept_embeddings: np.ndarray,
    concepts: list[dict[str, Any]],
) -> dict[str, Any]:
    clustering_result = fit_model(projection_points, clustering_config)
    vectors = _normalize_rows(
        np.asarray(image_embeddings, dtype=np.float32)[image_ids]
    )
    concept_vectors = _normalize_rows(concept_embeddings)
    if len(concept_vectors) != len(concepts):
        raise ValueError("SAO concept metadata and embeddings do not match")

    baseline = _normalized_centroid(vectors)
    baseline_scores = concept_vectors @ baseline

    def stable_key(index: int) -> tuple[str, str, int]:
        concept = concepts[index]
        return (
            str(concept.get("id") or ""),
            str(concept.get("label") or "").casefold(),
            index,
        )

    cluster_records = []
    for cluster_id, cluster in enumerate(clustering_result.clusters):
        local_indices = [
            index
            for index in cluster.point_indices
            if 0 <= index < len(image_ids)
        ]
        if not local_indices:
            continue

        cluster_centroid = _normalized_centroid(vectors[local_indices])
        cluster_scores = concept_vectors @ cluster_centroid
        deltas = cluster_scores - baseline_scores
        relevance = np.maximum(cluster_scores, baseline_scores)
        relevance_threshold = float(relevance.mean() + relevance.std())

        strongest = sorted(
            range(len(concepts)),
            key=lambda index: (-float(cluster_scores[index]), stable_key(index)),
        )[:PROFILE_LIMIT]
        eligible = [
            index
            for index in range(len(concepts))
            if float(relevance[index]) >= relevance_threshold
        ]
        more_prominent = sorted(
            (index for index in eligible if float(deltas[index]) > 0.0),
            key=lambda index: (-float(deltas[index]), stable_key(index)),
        )[:PROFILE_LIMIT]
        less_prominent = sorted(
            (index for index in eligible if float(deltas[index]) < 0.0),
            key=lambda index: (float(deltas[index]), stable_key(index)),
        )[:PROFILE_LIMIT]

        strongest_ranks = {
            index: rank for rank, index in enumerate(strongest, start=1)
        }
        more_ranks = {
            index: rank for rank, index in enumerate(more_prominent, start=1)
        }
        less_ranks = {
            index: rank for rank, index in enumerate(less_prominent, start=1)
        }

        def concept_record(index: int) -> dict[str, Any]:
            concept = concepts[index]
            direction = (
                "more"
                if index in more_ranks
                else "less"
                if index in less_ranks
                else None
            )
            return {
                "concept_id": str(concept.get("id") or ""),
                "label": str(concept.get("label") or ""),
                "scope_note": str(concept.get("scope_note") or ""),
                "cluster_score": float(cluster_scores[index]),
                "baseline_score": float(baseline_scores[index]),
                "delta": float(deltas[index]),
                "strongest_rank": strongest_ranks.get(index),
                "delta_direction": direction,
                "delta_rank": (
                    more_ranks.get(index)
                    if direction == "more"
                    else less_ranks.get(index)
                    if direction == "less"
                    else None
                ),
            }

        cluster_records.append(
            {
                "cluster_id": cluster_id,
                "centroid_position": cluster.centroid_position,
                "image_ids": [image_ids[index] for index in local_indices],
                "image_count": len(local_indices),
                "relevance_threshold": relevance_threshold,
                "profile": {
                    "strongest": [
                        concept_record(index) for index in strongest
                    ],
                    "more_prominent": [
                        concept_record(index) for index in more_prominent
                    ],
                    "less_prominent": [
                        concept_record(index) for index in less_prominent
                    ],
                },
            }
        )

    return {
        "clustering": clustering_result.config.to_dict(),
        "clusters": cluster_records,
        "noise_image_ids": [
            image_ids[index]
            for index in clustering_result.noise_indices
            if 0 <= index < len(image_ids)
        ],
    }
