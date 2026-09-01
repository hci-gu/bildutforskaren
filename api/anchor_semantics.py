from __future__ import annotations

import math
from typing import Any

import numpy as np


EPSILON = 1e-8
ENDPOINT_LIMIT = 3
DELTA_LIMIT = 3


def _normalize_rows(values: np.ndarray) -> np.ndarray:
    rows = np.asarray(values, dtype=np.float32)
    norms = np.linalg.norm(rows, axis=1, keepdims=True)
    return rows / np.maximum(norms, EPSILON)


def _centroid(vectors: np.ndarray, image_ids: list[int]) -> np.ndarray:
    mean = vectors[image_ids].mean(axis=0)
    return mean / max(float(np.linalg.norm(mean)), EPSILON)


def _slerp(
    centroid_a: np.ndarray,
    centroid_b: np.ndarray,
    progress: float,
) -> np.ndarray:
    similarity = float(np.clip(centroid_a @ centroid_b, -1.0, 1.0))
    theta = math.acos(similarity)
    if theta < 1e-4:
        value = (1.0 - progress) * centroid_a + progress * centroid_b
        return value / max(float(np.linalg.norm(value)), EPSILON)
    sin_theta = math.sin(theta)
    value = (
        math.sin((1.0 - progress) * theta) / sin_theta * centroid_a
        + math.sin(progress * theta) / sin_theta * centroid_b
    )
    return value / max(float(np.linalg.norm(value)), EPSILON)


def _graph_progress(path: dict[str, Any]) -> list[tuple[int, float]]:
    image_ids = path.get("path_ids") or []
    if not path.get("connected") or not image_ids:
        return []
    edges = path.get("edges") or []
    total = float(path.get("total_length") or 0.0)
    if total <= EPSILON:
        denominator = max(1, len(image_ids) - 1)
        return [
            (int(image_id), index / denominator)
            for index, image_id in enumerate(image_ids)
        ]
    cumulative = 0.0
    result = [(int(image_ids[0]), 0.0)]
    for index, image_id in enumerate(image_ids[1:]):
        cumulative += float(edges[index]["distance"])
        result.append((int(image_id), cumulative / total))
    return result


def analyze_anchor_semantics(
    image_embeddings: np.ndarray,
    anchor_a_ids: list[int],
    anchor_b_ids: list[int],
    anchor_result: dict[str, Any],
    concept_embeddings: np.ndarray,
    concepts: list[dict[str, Any]],
) -> dict[str, Any]:
    if not concepts or np.asarray(concept_embeddings).size == 0:
        return {
            "available": True,
            "error": None,
            "relevance_threshold": None,
            "endpoint_a": [],
            "endpoint_b": [],
            "increasing": [],
            "decreasing": [],
            "trajectories": [],
        }

    vectors = _normalize_rows(image_embeddings)
    concept_vectors = _normalize_rows(concept_embeddings)
    if len(concept_vectors) != len(concepts):
        raise ValueError("SAO concept metadata and embeddings do not match")

    centroid_a = _centroid(vectors, anchor_a_ids)
    centroid_b = _centroid(vectors, anchor_b_ids)
    scores_a = concept_vectors @ centroid_a
    scores_b = concept_vectors @ centroid_b
    deltas = scores_b - scores_a
    relevance = np.maximum(scores_a, scores_b)
    relevance_threshold = float(relevance.mean() + relevance.std())

    def stable_key(index: int) -> tuple[str, str, int]:
        concept = concepts[index]
        return (
            str(concept.get("id") or ""),
            str(concept.get("label") or "").casefold(),
            index,
        )

    endpoint_a_indices = sorted(
        range(len(concepts)),
        key=lambda index: (-float(scores_a[index]), stable_key(index)),
    )[:ENDPOINT_LIMIT]
    endpoint_b_indices = sorted(
        range(len(concepts)),
        key=lambda index: (-float(scores_b[index]), stable_key(index)),
    )[:ENDPOINT_LIMIT]
    eligible = [
        index
        for index in range(len(concepts))
        if float(relevance[index]) >= relevance_threshold
    ]
    increasing_indices = sorted(
        (index for index in eligible if float(deltas[index]) > 0.0),
        key=lambda index: (-float(deltas[index]), stable_key(index)),
    )[:DELTA_LIMIT]
    decreasing_indices = sorted(
        (index for index in eligible if float(deltas[index]) < 0.0),
        key=lambda index: (float(deltas[index]), stable_key(index)),
    )[:DELTA_LIMIT]

    endpoint_a_rank = {
        index: rank for rank, index in enumerate(endpoint_a_indices, start=1)
    }
    endpoint_b_rank = {
        index: rank for rank, index in enumerate(endpoint_b_indices, start=1)
    }
    increasing_rank = {
        index: rank for rank, index in enumerate(increasing_indices, start=1)
    }
    decreasing_rank = {
        index: rank for rank, index in enumerate(decreasing_indices, start=1)
    }
    trajectory_indices = [*increasing_indices, *decreasing_indices]
    trajectory_set = set(trajectory_indices)

    def concept_id(index: int) -> str:
        concept = concepts[index]
        return str(
            concept.get("id")
            or f"label:{concept.get('label') or index}:{index}"
        )

    def concept_record(index: int) -> dict[str, Any]:
        direction = (
            "increasing"
            if index in increasing_rank
            else "decreasing"
            if index in decreasing_rank
            else None
        )
        concept = concepts[index]
        return {
            "concept_id": concept_id(index),
            "label": str(concept.get("label") or ""),
            "scope_note": str(concept.get("scope_note") or ""),
            "score_a": float(scores_a[index]),
            "score_b": float(scores_b[index]),
            "delta": float(deltas[index]),
            "endpoint_a_rank": endpoint_a_rank.get(index),
            "endpoint_b_rank": endpoint_b_rank.get(index),
            "delta_direction": direction,
            "delta_rank": (
                increasing_rank.get(index)
                if direction == "increasing"
                else decreasing_rank.get(index)
                if direction == "decreasing"
                else None
            ),
            "in_endpoint_a": index in endpoint_a_rank,
            "in_endpoint_b": index in endpoint_b_rank,
            "in_trajectory": index in trajectory_set,
        }

    interpolation_steps = anchor_result["interpolation"]["steps"]
    ideal_queries = {
        float(step["t"]): _slerp(
            centroid_a,
            centroid_b,
            float(step["t"]),
        )
        for step in interpolation_steps
    }

    point_by_id = {
        int(point["image_id"]): point for point in anchor_result["points"]
    }
    axis_positions = [
        (
            int(image_id),
            float(point_by_id[int(image_id)]["t_clipped"]),
        )
        for image_id in anchor_result["axis"]["path_ids"]
        if int(image_id) in point_by_id
    ]
    graph_positions = {
        "graph_supported": _graph_progress(
            anchor_result["graph"]["supported"]
        ),
    }

    def ideal_score(concept_index: int, progress: float) -> float:
        query = ideal_queries.get(progress)
        if query is None:
            query = _slerp(centroid_a, centroid_b, progress)
        return float(concept_vectors[concept_index] @ query)

    def observed_point(
        concept_index: int,
        image_id: int,
        progress: float,
    ) -> dict[str, Any]:
        score = float(concept_vectors[concept_index] @ vectors[image_id])
        expected = ideal_score(concept_index, progress)
        return {
            "progress": progress,
            "image_id": image_id,
            "score": score,
            "ideal_score": expected,
            "gap": score - expected,
        }

    trajectories: list[dict[str, Any]] = []
    for index in trajectory_indices:
        ideal = [
            {
                "progress": float(step["t"]),
                "score": ideal_score(index, float(step["t"])),
            }
            for step in interpolation_steps
        ]
        interpolation: list[dict[str, Any]] = []
        for step in interpolation_steps:
            progress = float(step["t"])
            retrievals = step.get("retrievals") or []
            if retrievals:
                interpolation.append(
                    observed_point(
                        index,
                        int(retrievals[0]["image_id"]),
                        progress,
                    )
                )
            else:
                interpolation.append(
                    {
                        "progress": progress,
                        "image_id": None,
                        "score": None,
                        "ideal_score": ideal_score(index, progress),
                        "gap": None,
                    }
                )

        trajectory = {
            "concept_id": concept_id(index),
            "ideal": ideal,
            "interpolation": interpolation,
            "axis": [
                observed_point(index, image_id, progress)
                for image_id, progress in axis_positions
            ],
        }
        for name, positions in graph_positions.items():
            trajectory[name] = [
                observed_point(index, image_id, progress)
                for image_id, progress in positions
            ]
        trajectories.append(trajectory)

    return {
        "available": True,
        "error": None,
        "relevance_threshold": relevance_threshold,
        "endpoint_a": [
            concept_record(index) for index in endpoint_a_indices
        ],
        "endpoint_b": [
            concept_record(index) for index in endpoint_b_indices
        ],
        "increasing": [
            concept_record(index) for index in increasing_indices
        ],
        "decreasing": [
            concept_record(index) for index in decreasing_indices
        ],
        "trajectories": trajectories,
    }
