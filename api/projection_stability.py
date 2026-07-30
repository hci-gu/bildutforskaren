from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
from scipy.optimize import linear_sum_assignment

from api.clustering import ClusteringConfig, fit_model
from api.indexing import l2_normalize_rows


STABILITY_RUNS = 8
AMBIGUITY_THRESHOLD = 0.60
_EPSILON = 1e-12
_SEED_MODULUS = 2_147_483_647
_SEED_STEP = 104_729


class StabilityAnalysisCancelled(Exception):
    pass


def alternative_seeds(base_seed: int, count: int = STABILITY_RUNS) -> list[int]:
    seeds: list[int] = []
    candidate = int(base_seed) % _SEED_MODULUS
    while len(seeds) < count:
        candidate = (candidate + _SEED_STEP) % _SEED_MODULUS
        if candidate != base_seed and candidate not in seeds:
            seeds.append(candidate)
    return seeds


def _labels_from_projection(points: np.ndarray) -> np.ndarray:
    result = fit_model(
        np.asarray(points, dtype=np.float64),
        ClusteringConfig(algorithm="hdbscan"),
    )
    labels = np.full(len(points), -1, dtype=np.int32)
    for cluster_id, cluster in enumerate(result.clusters):
        labels[np.asarray(cluster.point_indices, dtype=np.int64)] = cluster_id
    return labels


def _cluster_ids(labels: np.ndarray) -> list[int]:
    return sorted(int(label) for label in np.unique(labels) if label >= 0)


def match_clusters(
    reference_labels: np.ndarray,
    candidate_labels: np.ndarray,
) -> dict[int, tuple[int | None, float]]:
    reference = np.asarray(reference_labels, dtype=np.int32)
    candidate = np.asarray(candidate_labels, dtype=np.int32)
    reference_ids = _cluster_ids(reference)
    candidate_ids = _cluster_ids(candidate)
    matches = {cluster_id: (None, 0.0) for cluster_id in reference_ids}
    if not reference_ids or not candidate_ids:
        return matches

    similarities = np.zeros(
        (len(reference_ids), len(candidate_ids)),
        dtype=np.float64,
    )
    for row, reference_id in enumerate(reference_ids):
        reference_members = reference == reference_id
        for column, candidate_id in enumerate(candidate_ids):
            candidate_members = candidate == candidate_id
            intersection = int(np.count_nonzero(reference_members & candidate_members))
            union = int(np.count_nonzero(reference_members | candidate_members))
            similarities[row, column] = (
                intersection / union if union else 0.0
            )

    rows, columns = linear_sum_assignment(-similarities)
    for row, column in zip(rows.tolist(), columns.tolist()):
        reference_id = reference_ids[row]
        candidate_id = candidate_ids[column]
        matches[reference_id] = (
            candidate_id,
            float(similarities[row, column]),
        )
    return matches


def summarize_cluster_stability(
    reference_labels: np.ndarray,
    repeated_labels: list[np.ndarray],
) -> dict[str, Any]:
    reference = np.asarray(reference_labels, dtype=np.int32)
    if not repeated_labels:
        raise ValueError("At least one repeated clustering is required")
    if any(len(labels) != len(reference) for labels in repeated_labels):
        raise ValueError("All cluster label arrays must have equal length")

    reference_ids = _cluster_ids(reference)
    cluster_scores = {cluster_id: [] for cluster_id in reference_ids}
    image_hits = np.zeros(len(reference), dtype=np.float64)

    for labels in repeated_labels:
        candidate = np.asarray(labels, dtype=np.int32)
        matches = match_clusters(reference, candidate)
        for cluster_id in reference_ids:
            matched_id, jaccard = matches[cluster_id]
            cluster_scores[cluster_id].append(jaccard)
            members = reference == cluster_id
            if matched_id is not None:
                image_hits[members] += candidate[members] == matched_id
        noise = reference == -1
        image_hits[noise] += candidate[noise] == -1

    divisor = float(len(repeated_labels))
    image_stability = image_hits / divisor
    return {
        "overall_stability": float(np.mean(image_stability)),
        "cluster_stability": {
            cluster_id: float(np.mean(scores))
            for cluster_id, scores in cluster_scores.items()
        },
        "image_stability": image_stability,
    }


def _strongest_concepts(
    member_vectors: np.ndarray,
    concept_embeddings: np.ndarray,
    concepts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    centroid = np.asarray(member_vectors, dtype=np.float32).mean(axis=0)
    centroid /= max(float(np.linalg.norm(centroid)), _EPSILON)
    concept_vectors = l2_normalize_rows(
        np.asarray(concept_embeddings, dtype=np.float32)
    )
    scores = concept_vectors @ centroid
    order = sorted(
        range(len(concepts)),
        key=lambda index: (
            -float(scores[index]),
            str(concepts[index].get("id") or ""),
            str(concepts[index].get("label") or ""),
        ),
    )[:3]
    return [
        {
            "concept_id": str(concepts[index].get("id") or ""),
            "label": str(concepts[index].get("label") or ""),
            "scope_note": str(concepts[index].get("scope_note") or ""),
            "similarity": float(scores[index]),
        }
        for index in order
    ]


def analyze_projection_stability(
    image_embeddings: np.ndarray,
    image_ids: list[int],
    reference_points: np.ndarray,
    params: dict[str, Any],
    concept_embeddings: np.ndarray,
    concepts: list[dict[str, Any]],
    *,
    progress_callback: Callable[[int, int], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    try:
        import umap  # type: ignore
    except Exception as exc:
        raise RuntimeError("UMAP dependency not available") from exc

    points = np.asarray(reference_points, dtype=np.float64)
    vectors = l2_normalize_rows(
        np.asarray(image_embeddings, dtype=np.float32)[image_ids]
    )
    reference_labels = _labels_from_projection(points)
    repeated_labels: list[np.ndarray] = []
    seeds = alternative_seeds(int(params["seed"]))
    effective_neighbors = min(int(params["n_neighbors"]), len(image_ids) - 1)

    for completed, seed in enumerate(seeds, start=1):
        if cancelled is not None and cancelled():
            raise StabilityAnalysisCancelled()
        reducer = umap.UMAP(
            n_neighbors=effective_neighbors,
            min_dist=float(params["min_dist"]),
            n_components=2,
            spread=float(params["spread"]),
            metric="cosine",
            random_state=seed,
            transform_seed=seed,
        )
        repeated_points = reducer.fit_transform(vectors)
        repeated_labels.append(_labels_from_projection(repeated_points))
        if progress_callback is not None:
            progress_callback(completed, len(seeds))

    if cancelled is not None and cancelled():
        raise StabilityAnalysisCancelled()

    summary = summarize_cluster_stability(reference_labels, repeated_labels)
    image_stability = np.asarray(summary["image_stability"], dtype=np.float64)
    clusters = []
    for cluster_id in _cluster_ids(reference_labels):
        offsets = np.where(reference_labels == cluster_id)[0]
        member_ids = [image_ids[int(offset)] for offset in offsets]
        centroid = points[offsets].mean(axis=0)
        clusters.append(
            {
                "cluster_id": cluster_id,
                "image_ids": member_ids,
                "image_count": len(member_ids),
                "centroid_position": centroid.tolist(),
                "stability": summary["cluster_stability"][cluster_id],
                "concepts": _strongest_concepts(
                    vectors[offsets],
                    concept_embeddings,
                    concepts,
                ),
            }
        )

    image_records = [
        {
            "image_id": image_id,
            "reference_cluster_id": (
                int(reference_labels[offset])
                if reference_labels[offset] >= 0
                else None
            ),
            "stability": float(image_stability[offset]),
        }
        for offset, image_id in enumerate(image_ids)
    ]
    ambiguous = sorted(
        (
            record
            for record in image_records
            if record["stability"] < AMBIGUITY_THRESHOLD
        ),
        key=lambda record: (record["stability"], record["image_id"]),
    )
    return {
        "runs": STABILITY_RUNS,
        "ambiguity_threshold": AMBIGUITY_THRESHOLD,
        "overall_stability": summary["overall_stability"],
        "clusters": clusters,
        "images": image_records,
        "ambiguous_images": ambiguous,
        "noise_image_ids": [
            image_ids[int(offset)]
            for offset in np.where(reference_labels == -1)[0]
        ],
        "clustering": {
            "algorithm": "hdbscan",
            "feature_space": "umap_2d",
        },
        "params": {
            "n_neighbors": int(params["n_neighbors"]),
            "min_dist": float(params["min_dist"]),
            "spread": float(params["spread"]),
            "seed": int(params["seed"]),
        },
    }
