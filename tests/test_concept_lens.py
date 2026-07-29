from __future__ import annotations

import unittest

import numpy as np

from api.concept_lens import analyze_concept_lens


class ConceptLensTests(unittest.TestCase):
    def test_scores_percentiles_ties_and_swedish_metadata(self):
        images = np.asarray(
            [[2.0, 0.0], [0.0, 2.0], [0.0, 1.0]],
            dtype=np.float32,
        )
        concept_vectors = np.asarray(
            [[3.0, 0.0], [0.0, 4.0]],
            dtype=np.float32,
        )
        concepts = [
            {"id": "a", "label": "hästar", "scope_note": "Djur."},
            {"id": "b", "label": "vagnar", "scope_note": "Fordon."},
        ]

        result = analyze_concept_lens(
            images,
            [0, 1, 2],
            concept_vectors,
            concepts,
            ["a", "b"],
        )

        self.assertEqual(result["concepts"][0]["label"], "hästar")
        first = result["images"][0]
        self.assertAlmostEqual(first["scores"]["a"]["similarity"], 1.0)
        self.assertAlmostEqual(first["scores"]["a"]["percentile"], 1.0)
        self.assertAlmostEqual(first["comparison_delta"], 1.0)
        self.assertAlmostEqual(
            result["images"][1]["scores"]["a"]["percentile"],
            0.25,
        )
        self.assertAlmostEqual(
            result["images"][2]["scores"]["a"]["percentile"],
            0.25,
        )

    def test_restricts_scoring_to_submitted_images(self):
        result = analyze_concept_lens(
            np.eye(3, dtype=np.float32),
            [2, 0],
            np.asarray([[1.0, 0.0, 0.0]], dtype=np.float32),
            [{"id": "a", "label": "ett", "scope_note": ""}],
            ["a"],
        )
        self.assertEqual(
            [record["image_id"] for record in result["images"]],
            [2, 0],
        )
        self.assertEqual(result["images"][1]["scores"]["a"]["percentile"], 1.0)

    def test_rejects_unknown_concept_and_misaligned_metadata(self):
        with self.assertRaisesRegex(ValueError, "Unknown SAO concept"):
            analyze_concept_lens(
                np.eye(2, dtype=np.float32),
                [0],
                np.eye(2, dtype=np.float32),
                [{"id": "a"}, {"id": "b"}],
                ["missing"],
            )
        with self.assertRaisesRegex(ValueError, "do not match"):
            analyze_concept_lens(
                np.eye(2, dtype=np.float32),
                [0],
                np.eye(2, dtype=np.float32),
                [{"id": "a"}],
                ["a"],
            )


if __name__ == "__main__":
    unittest.main()
