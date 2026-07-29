from __future__ import annotations

from typing import Any

import numpy as np
from scipy.spatial import ConvexHull, QhullError


EPSILON = 1e-12
AXIS_BOOTSTRAP_SAMPLES = 64
AXIS_HULL_INSET = 0.04


def _normalize_rows(values: np.ndarray) -> np.ndarray:
    rows = np.asarray(values, dtype=np.float32)
    norms = np.linalg.norm(rows, axis=1, keepdims=True)
    return rows / np.maximum(norms, EPSILON)


def _percentile_ranks(values: np.ndarray) -> np.ndarray:
    scores = np.asarray(values, dtype=np.float64)
    count = len(scores)
    if count <= 1:
        return np.ones(count, dtype=np.float64)

    order = np.argsort(scores, kind="mergesort")
    percentiles = np.empty(count, dtype=np.float64)
    start = 0
    while start < count:
        end = start + 1
        while end < count and scores[order[end]] == scores[order[start]]:
            end += 1
        average_rank = (start + end - 1) / 2.0
        percentiles[order[start:end]] = average_rank / (count - 1)
        start = end
    return percentiles


def _fit_linear_axis(
    projection_points: np.ndarray,
    target_scores: np.ndarray,
) -> tuple[np.ndarray, float] | None:
    points = np.asarray(projection_points, dtype=np.float64)
    scores = np.asarray(target_scores, dtype=np.float64)
    centered_points = points - points.mean(axis=0)
    centered_scores = scores - scores.mean()
    if (
        np.linalg.matrix_rank(centered_points) < points.shape[1]
        or float(np.linalg.norm(centered_scores)) <= EPSILON
    ):
        return None

    coefficients, *_ = np.linalg.lstsq(
        centered_points,
        centered_scores,
        rcond=None,
    )
    coefficient_norm = float(np.linalg.norm(coefficients))
    if coefficient_norm <= EPSILON:
        return None

    predictions = centered_points @ coefficients
    residual_sum = float(np.sum((centered_scores - predictions) ** 2))
    total_sum = float(np.sum(centered_scores**2))
    r_squared = 1.0 - residual_sum / max(total_sum, EPSILON)
    return coefficients / coefficient_norm, float(np.clip(r_squared, 0.0, 1.0))


def _clip_axis_to_cloud(
    projection_points: np.ndarray,
    direction: np.ndarray,
) -> tuple[np.ndarray, np.ndarray] | None:
    points = np.asarray(projection_points, dtype=np.float64)
    center = points.mean(axis=0)
    try:
        hull = ConvexHull(points)
    except QhullError:
        return None

    minimum_t = -np.inf
    maximum_t = np.inf
    for equation in hull.equations:
        normal = equation[:-1]
        offset = float(equation[-1])
        slope = float(normal @ direction)
        value_at_center = float(normal @ center + offset)
        if abs(slope) <= EPSILON:
            if value_at_center > 1e-9:
                return None
            continue
        boundary_t = -value_at_center / slope
        if slope > 0:
            maximum_t = min(maximum_t, boundary_t)
        else:
            minimum_t = max(minimum_t, boundary_t)

    if (
        not np.isfinite(minimum_t)
        or not np.isfinite(maximum_t)
        or maximum_t - minimum_t <= EPSILON
    ):
        return None

    inset = (maximum_t - minimum_t) * AXIS_HULL_INSET
    start_t = minimum_t + inset
    end_t = maximum_t - inset
    if end_t - start_t <= EPSILON:
        return None
    return center + start_t * direction, center + end_t * direction


def _axis_stability(
    projection_points: np.ndarray,
    target_scores: np.ndarray,
    reference_direction: np.ndarray,
) -> float:
    points = np.asarray(projection_points, dtype=np.float64)
    scores = np.asarray(target_scores, dtype=np.float64)
    rng = np.random.default_rng(0)
    similarities: list[float] = []
    for _ in range(AXIS_BOOTSTRAP_SAMPLES):
        indices = rng.integers(0, len(points), size=len(points))
        fitted = _fit_linear_axis(points[indices], scores[indices])
        if fitted is None:
            continue
        direction, _ = fitted
        similarities.append(
            float(np.clip(direction @ reference_direction, 0.0, 1.0))
        )
    if not similarities:
        return 0.0
    return float(np.mean(similarities))


def _analyze_projection_axis(
    projection_points: np.ndarray | None,
    target_scores: np.ndarray,
    mode: str,
) -> dict[str, Any]:
    if projection_points is None:
        return {
            "available": False,
            "mode": mode,
            "reason": "Projection points were not supplied",
        }

    points = np.asarray(projection_points, dtype=np.float64)
    dimension = points.shape[1]
    if len(points) < dimension + 2:
        return {
            "available": False,
            "mode": mode,
            "dimension": dimension,
            "reason": "Too few images to fit a stable concept axis",
        }

    fitted = _fit_linear_axis(points, target_scores)
    if fitted is None:
        return {
            "available": False,
            "mode": mode,
            "dimension": dimension,
            "reason": "The projection or concept scores have insufficient variation",
        }
    direction, r_squared = fitted
    endpoints = _clip_axis_to_cloud(points, direction)
    if endpoints is None:
        return {
            "available": False,
            "mode": mode,
            "dimension": dimension,
            "reason": "The image cloud has no full-dimensional boundary",
        }

    start, end = endpoints
    return {
        "available": True,
        "mode": mode,
        "dimension": dimension,
        "start": start.tolist(),
        "end": end.tolist(),
        "direction": direction.tolist(),
        "r_squared": r_squared,
        "stability": _axis_stability(points, target_scores, direction),
        "bootstrap_samples": AXIS_BOOTSTRAP_SAMPLES,
        "boundary": "convex_hull_inset",
    }


def analyze_concept_lens(
    image_embeddings: np.ndarray,
    image_ids: list[int],
    concept_embeddings: np.ndarray,
    concepts: list[dict[str, Any]],
    concept_ids: list[str],
    projection_points: np.ndarray | None = None,
) -> dict[str, Any]:
    vectors = _normalize_rows(
        np.asarray(image_embeddings, dtype=np.float32)[image_ids]
    )
    concept_vectors = _normalize_rows(concept_embeddings)
    if len(concept_vectors) != len(concepts):
        raise ValueError("SAO concept metadata and embeddings do not match")

    concept_index = {
        str(concept.get("id") or ""): index
        for index, concept in enumerate(concepts)
    }
    missing = [concept_id for concept_id in concept_ids if concept_id not in concept_index]
    if missing:
        raise ValueError(f"Unknown SAO concept ID(s): {', '.join(missing)}")

    selected_indices = [concept_index[concept_id] for concept_id in concept_ids]
    selected_vectors = concept_vectors[selected_indices]
    similarities = vectors @ selected_vectors.T
    percentiles = np.column_stack(
        [
            _percentile_ranks(similarities[:, column])
            for column in range(len(concept_ids))
        ]
    )

    concept_records = []
    for concept_id, index in zip(concept_ids, selected_indices):
        concept = concepts[index]
        concept_records.append(
            {
                "concept_id": concept_id,
                "label": str(concept.get("label") or ""),
                "scope_note": str(concept.get("scope_note") or ""),
            }
        )

    image_records = []
    for row, image_id in enumerate(image_ids):
        scores = {
            concept_id: {
                "similarity": float(similarities[row, column]),
                "percentile": float(percentiles[row, column]),
            }
            for column, concept_id in enumerate(concept_ids)
        }
        record: dict[str, Any] = {
            "image_id": image_id,
            "scores": scores,
        }
        if len(concept_ids) == 2:
            record["comparison_delta"] = float(
                similarities[row, 0] - similarities[row, 1]
            )
        image_records.append(record)

    axis_scores = (
        similarities[:, 0] - similarities[:, 1]
        if len(concept_ids) == 2
        else similarities[:, 0]
    )
    return {
        "concepts": concept_records,
        "images": image_records,
        "axis": _analyze_projection_axis(
            projection_points,
            axis_scores,
            "contrast" if len(concept_ids) == 2 else "single",
        ),
    }
