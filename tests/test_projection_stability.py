from __future__ import annotations

import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

from api.projection_stability import (
    StabilityAnalysisCancelled,
    alternative_seeds,
    analyze_projection_stability,
    match_clusters,
    summarize_cluster_stability,
)


class _FakeReducer:
    def __init__(self, **_kwargs):
        pass

    def fit_transform(self, vectors):
        return np.zeros((len(vectors), 2), dtype=np.float32)


class ProjectionStabilityTests(unittest.TestCase):
    def test_alternative_seeds_are_deterministic_unique_and_exclude_base(self):
        first = alternative_seeds(42)
        second = alternative_seeds(42)
        self.assertEqual(first, second)
        self.assertEqual(len(first), 8)
        self.assertEqual(len(set(first)), 8)
        self.assertNotIn(42, first)

    def test_cluster_matching_ignores_label_permutations(self):
        reference = np.asarray([0, 0, 0, 1, 1, 1, -1])
        candidate = np.asarray([8, 8, 8, 3, 3, 3, -1])
        matches = match_clusters(reference, candidate)
        self.assertEqual(matches[0], (8, 1.0))
        self.assertEqual(matches[1], (3, 1.0))

    def test_split_merge_and_unmatched_clusters_reduce_stability(self):
        reference = np.asarray([0, 0, 0, 0, 1, 1, 1, 1])
        split = np.asarray([4, 4, 5, 5, 6, 6, 6, 6])
        matches = match_clusters(reference, split)
        self.assertAlmostEqual(matches[0][1], 0.5)
        self.assertAlmostEqual(matches[1][1], 1.0)

        missing = match_clusters(reference, np.full(8, -1))
        self.assertEqual(missing[0], (None, 0.0))
        self.assertEqual(missing[1], (None, 0.0))

    def test_summary_tracks_membership_noise_and_ambiguity_inputs(self):
        reference = np.asarray([0, 0, 1, 1, -1])
        repeated = [
            np.asarray([4, 4, 7, 7, -1]),
            np.asarray([4, -1, 7, 7, 2]),
        ]
        result = summarize_cluster_stability(reference, repeated)
        np.testing.assert_allclose(
            result["image_stability"],
            np.asarray([1.0, 0.5, 1.0, 1.0, 0.5]),
        )
        self.assertAlmostEqual(result["overall_stability"], 0.8)

    def test_analysis_restricts_subset_reports_progress_and_swedish_concepts(self):
        image_embeddings = np.eye(12, dtype=np.float32)
        image_ids = list(range(2, 12))
        reference_points = np.column_stack(
            [np.arange(10, dtype=float), np.arange(10, dtype=float) % 2]
        )
        reference_labels = np.asarray([0] * 5 + [1] * 5)
        repeat_labels = [
            np.asarray(([9] * 5 + [3] * 5) if index % 2 else ([3] * 5 + [9] * 5))
            for index in range(8)
        ]
        progress: list[tuple[int, int]] = []
        concept_embeddings = np.eye(2, 12, dtype=np.float32)
        concepts = [
            {"id": "a", "label": "hästar", "scope_note": "Djur."},
            {"id": "b", "label": "vagnar", "scope_note": "Fordon."},
        ]

        with (
            patch.dict(sys.modules, {"umap": SimpleNamespace(UMAP=_FakeReducer)}),
            patch(
                "api.projection_stability._labels_from_projection",
                side_effect=[reference_labels, *repeat_labels],
            ),
        ):
            result = analyze_projection_stability(
                image_embeddings,
                image_ids,
                reference_points,
                {
                    "n_neighbors": 15,
                    "min_dist": 0.1,
                    "spread": 1.0,
                    "seed": 1,
                },
                concept_embeddings,
                concepts,
                progress_callback=lambda completed, total: progress.append(
                    (completed, total)
                ),
            )

        self.assertEqual(progress, [(index, 8) for index in range(1, 9)])
        self.assertEqual(result["overall_stability"], 1.0)
        self.assertEqual(result["ambiguous_images"], [])
        self.assertEqual(result["clusters"][0]["image_ids"], [2, 3, 4, 5, 6])
        self.assertEqual(
            result["clusters"][0]["concepts"][0]["label"],
            "hästar",
        )

    def test_analysis_supports_all_noise_and_cooperative_cancellation(self):
        image_embeddings = np.eye(10, dtype=np.float32)
        points = np.column_stack(
            [np.arange(10, dtype=float), np.zeros(10, dtype=float)]
        )
        labels = [np.full(10, -1, dtype=np.int32) for _ in range(9)]
        concepts = [{"id": "a", "label": "motiv", "scope_note": ""}]
        params = {
            "n_neighbors": 9,
            "min_dist": 0.1,
            "spread": 1.0,
            "seed": 1,
        }

        with (
            patch.dict(sys.modules, {"umap": SimpleNamespace(UMAP=_FakeReducer)}),
            patch(
                "api.projection_stability._labels_from_projection",
                side_effect=labels,
            ),
        ):
            result = analyze_projection_stability(
                image_embeddings,
                list(range(10)),
                points,
                params,
                np.asarray([[1.0] + [0.0] * 9], dtype=np.float32),
                concepts,
            )
        self.assertEqual(result["clusters"], [])
        self.assertEqual(result["noise_image_ids"], list(range(10)))
        self.assertEqual(result["overall_stability"], 1.0)

        with (
            patch.dict(sys.modules, {"umap": SimpleNamespace(UMAP=_FakeReducer)}),
            patch(
                "api.projection_stability._labels_from_projection",
                return_value=np.full(10, -1, dtype=np.int32),
            ),
            self.assertRaises(StabilityAnalysisCancelled),
        ):
            analyze_projection_stability(
                image_embeddings,
                list(range(10)),
                points,
                params,
                np.asarray([[1.0] + [0.0] * 9], dtype=np.float32),
                concepts,
                cancelled=lambda: True,
            )


if __name__ == "__main__":
    unittest.main()
