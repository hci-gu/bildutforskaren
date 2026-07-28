from __future__ import annotations

import unittest

import numpy as np

from api.concept_explanations import analyze_concept_explanations


CONCEPTS = [
    {"id": "b", "label": "Beta", "scope_note": ""},
    {"id": "a", "label": "Alpha", "scope_note": "Alpha scope"},
    {"id": "c", "label": "Gamma", "scope_note": ""},
    {"id": "d", "label": "Delta", "scope_note": ""},
]


class ConceptExplanationTests(unittest.TestCase):
    def test_normalizes_vectors_and_returns_strongest_concepts(self):
        result = analyze_concept_explanations(
            np.asarray([[2, 0], [0, 3]], dtype=np.float32),
            [0, 1],
            0,
            np.asarray([[3, 0], [2, 0], [0, 4], [-1, 0]], dtype=np.float32),
            CONCEPTS,
            candidate_pool_size=4,
        )
        self.assertEqual(result["selected_concepts"][0]["concept_id"], "a")
        self.assertAlmostEqual(
            result["selected_concepts"][0]["selected_similarity"], 1.0
        )
        self.assertEqual(
            result["selected_concepts"][0]["selected_percentile"], 100.0
        )
        self.assertIsNone(result["comparison"])

    def test_candidate_pool_is_selected_before_subset_percentiles(self):
        result = analyze_concept_explanations(
            np.asarray([[1, 0], [0, 1]], dtype=np.float32),
            [0, 1],
            0,
            np.asarray([[0.9, 0.1], [0.8, 0.2], [0, 1], [-1, 0]], dtype=np.float32),
            CONCEPTS,
            candidate_pool_size=2,
        )
        self.assertEqual(
            {item["concept_id"] for item in result["selected_concepts"]},
            {"a", "b"},
        )

    def test_comparison_categories_use_current_subset_percentiles(self):
        result = analyze_concept_explanations(
            np.asarray([[1, 0], [0, 1], [1, 1]], dtype=np.float32),
            [0, 1, 2],
            0,
            np.asarray([[1, 0], [0, 1], [1, 1], [-1, 0]], dtype=np.float32),
            CONCEPTS,
            comparison_image_id=1,
            candidate_pool_size=4,
        )
        comparison = result["comparison"]
        self.assertIsNotNone(comparison)
        self.assertIn(
            "b",
            {
                item["concept_id"]
                for item in comparison["selected_distinctive"]
            },
        )
        self.assertIn(
            "a",
            {
                item["concept_id"]
                for item in comparison["comparison_distinctive"]
            },
        )
        shared_ids = {
            item["concept_id"] for item in comparison["shared"]
        }
        self.assertIn("c", shared_ids)

    def test_ties_are_deterministic_by_concept_identifier(self):
        result = analyze_concept_explanations(
            np.asarray([[1, 0]], dtype=np.float32),
            [0],
            0,
            np.asarray([[1, 0], [1, 0], [0, 1], [0, -1]], dtype=np.float32),
            CONCEPTS,
            candidate_pool_size=4,
        )
        self.assertEqual(
            [item["concept_id"] for item in result["selected_concepts"][:2]],
            ["a", "b"],
        )

    def test_baseline_is_restricted_to_submitted_images(self):
        embeddings = np.asarray([[1, 0], [1, 0], [-1, 0]], dtype=np.float32)
        result = analyze_concept_explanations(
            embeddings,
            [0, 2],
            0,
            np.asarray([[1, 0], [0, 1], [-1, 0], [0, -1]], dtype=np.float32),
            CONCEPTS,
            candidate_pool_size=4,
        )
        top = result["selected_concepts"][0]
        self.assertEqual(top["selected_percentile"], 100.0)
        self.assertEqual(result["baseline_image_count"], 2)


if __name__ == "__main__":
    unittest.main()
