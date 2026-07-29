from __future__ import annotations

from typing import Any

import numpy as np


EPSILON = 1e-12


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


def analyze_concept_lens(
    image_embeddings: np.ndarray,
    image_ids: list[int],
    concept_embeddings: np.ndarray,
    concepts: list[dict[str, Any]],
    concept_ids: list[str],
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

    return {
        "concepts": concept_records,
        "images": image_records,
    }
