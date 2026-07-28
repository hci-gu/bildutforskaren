from __future__ import annotations

from typing import Any

import numpy as np


EPSILON = 1e-12
CANDIDATE_POOL_SIZE = 100
SELECTED_RESULT_LIMIT = 10
COMPARISON_RESULT_LIMIT = 5


def _normalize_rows(values: np.ndarray) -> np.ndarray:
    rows = np.asarray(values, dtype=np.float32)
    norms = np.linalg.norm(rows, axis=1, keepdims=True)
    return rows / np.maximum(norms, EPSILON)


def analyze_concept_explanations(
    image_embeddings: np.ndarray,
    image_ids: list[int],
    selected_image_id: int,
    concept_embeddings: np.ndarray,
    concepts: list[dict[str, Any]],
    comparison_image_id: int | None = None,
    candidate_pool_size: int = CANDIDATE_POOL_SIZE,
) -> dict[str, Any]:
    if not concepts or np.asarray(concept_embeddings).size == 0:
        return {
            "selected_image_id": selected_image_id,
            "comparison_image_id": comparison_image_id,
            "baseline_image_count": len(image_ids),
            "candidate_pool_size": candidate_pool_size,
            "selected_concepts": [],
            "comparison": (
                {
                    "shared": [],
                    "selected_distinctive": [],
                    "comparison_distinctive": [],
                }
                if comparison_image_id is not None
                else None
            ),
        }

    subset_vectors = _normalize_rows(
        np.asarray(image_embeddings, dtype=np.float32)[image_ids]
    )
    concept_vectors = _normalize_rows(concept_embeddings)
    selected_offset = image_ids.index(selected_image_id)
    comparison_offset = (
        image_ids.index(comparison_image_id)
        if comparison_image_id is not None
        else None
    )

    selected_scores = concept_vectors @ subset_vectors[selected_offset]
    comparison_scores = (
        concept_vectors @ subset_vectors[comparison_offset]
        if comparison_offset is not None
        else None
    )

    def concept_key(index: int) -> tuple[str, str, int]:
        concept = concepts[index]
        return (
            str(concept.get("id") or ""),
            str(concept.get("label") or "").casefold(),
            index,
        )

    def strongest(scores: np.ndarray) -> list[int]:
        ordered = sorted(
            range(len(concepts)),
            key=lambda index: (-float(scores[index]), concept_key(index)),
        )
        return ordered[: min(candidate_pool_size, len(ordered))]

    selected_candidates = strongest(selected_scores)
    candidate_indices = set(selected_candidates)
    if comparison_scores is not None:
        candidate_indices.update(strongest(comparison_scores))
    ordered_candidates = sorted(candidate_indices, key=concept_key)

    candidate_vectors = concept_vectors[ordered_candidates]
    baseline_scores = subset_vectors @ candidate_vectors.T
    selected_candidate_scores = baseline_scores[selected_offset]
    selected_percentiles = (
        np.mean(
            baseline_scores <= selected_candidate_scores.reshape(1, -1),
            axis=0,
        )
        * 100.0
    )
    comparison_candidate_scores = (
        baseline_scores[comparison_offset]
        if comparison_offset is not None
        else None
    )
    comparison_percentiles = (
        np.mean(
            baseline_scores <= comparison_candidate_scores.reshape(1, -1),
            axis=0,
        )
        * 100.0
        if comparison_candidate_scores is not None
        else None
    )
    candidate_position = {
        concept_index: position
        for position, concept_index in enumerate(ordered_candidates)
    }

    def record(concept_index: int) -> dict[str, Any]:
        position = candidate_position[concept_index]
        concept = concepts[concept_index]
        selected_percentile = float(selected_percentiles[position])
        comparison_percentile = (
            float(comparison_percentiles[position])
            if comparison_percentiles is not None
            else None
        )
        return {
            "concept_id": str(concept.get("id") or ""),
            "label": str(concept.get("label") or ""),
            "scope_note": str(concept.get("scope_note") or ""),
            "selected_similarity": float(selected_candidate_scores[position]),
            "selected_percentile": selected_percentile,
            "comparison_similarity": (
                float(comparison_candidate_scores[position])
                if comparison_candidate_scores is not None
                else None
            ),
            "comparison_percentile": comparison_percentile,
            "percentile_difference": (
                selected_percentile - comparison_percentile
                if comparison_percentile is not None
                else None
            ),
        }

    selected_results = [
        record(index)
        for index in sorted(
            selected_candidates,
            key=lambda index: (
                -float(selected_scores[index]),
                concept_key(index),
            ),
        )[:SELECTED_RESULT_LIMIT]
    ]

    comparison = None
    if comparison_scores is not None and comparison_percentiles is not None:
        def selected_percentile(index: int) -> float:
            return float(selected_percentiles[candidate_position[index]])

        def comparison_percentile(index: int) -> float:
            return float(comparison_percentiles[candidate_position[index]])

        shared = sorted(
            ordered_candidates,
            key=lambda index: (
                -min(selected_percentile(index), comparison_percentile(index)),
                -min(
                    float(selected_scores[index]),
                    float(comparison_scores[index]),
                ),
                concept_key(index),
            ),
        )[:COMPARISON_RESULT_LIMIT]
        selected_distinctive = sorted(
            (
                index
                for index in ordered_candidates
                if selected_percentile(index) > comparison_percentile(index)
            ),
            key=lambda index: (
                -(selected_percentile(index) - comparison_percentile(index)),
                -float(selected_scores[index]),
                concept_key(index),
            ),
        )[:COMPARISON_RESULT_LIMIT]
        comparison_distinctive = sorted(
            (
                index
                for index in ordered_candidates
                if comparison_percentile(index) > selected_percentile(index)
            ),
            key=lambda index: (
                -(comparison_percentile(index) - selected_percentile(index)),
                -float(comparison_scores[index]),
                concept_key(index),
            ),
        )[:COMPARISON_RESULT_LIMIT]
        comparison = {
            "shared": [record(index) for index in shared],
            "selected_distinctive": [
                record(index) for index in selected_distinctive
            ],
            "comparison_distinctive": [
                record(index) for index in comparison_distinctive
            ],
        }

    return {
        "selected_image_id": selected_image_id,
        "comparison_image_id": comparison_image_id,
        "baseline_image_count": len(image_ids),
        "candidate_pool_size": candidate_pool_size,
        "selected_concepts": selected_results,
        "comparison": comparison,
    }
