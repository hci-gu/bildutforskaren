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

    def test_fits_single_concept_axis_inside_2d_image_cloud(self):
        points = np.asarray(
            [
                [0.0, 0.0],
                [0.0, 1.0],
                [1.0, 0.0],
                [1.0, 1.0],
                [0.5, 0.5],
            ],
            dtype=np.float64,
        )
        images = np.column_stack(
            [points[:, 0] + 1.0, np.ones(len(points))]
        ).astype(np.float32)
        result = analyze_concept_lens(
            images,
            list(range(len(points))),
            np.asarray([[1.0, 0.0]], dtype=np.float32),
            [{"id": "a", "label": "ett", "scope_note": ""}],
            ["a"],
            points,
        )

        axis = result["axis"]
        self.assertTrue(axis["available"])
        self.assertEqual(axis["mode"], "single")
        self.assertEqual(axis["dimension"], 2)
        self.assertGreater(axis["end"][0], axis["start"][0])
        self.assertGreaterEqual(min(axis["start"]), 0.0)
        self.assertLessEqual(max(axis["end"]), 1.0)
        self.assertGreater(axis["r_squared"], 0.8)
        self.assertGreater(axis["stability"], 0.8)

    def test_two_concepts_fit_contrast_axis_in_3d(self):
        points = np.asarray(
            [
                [-1.0, -1.0, -1.0],
                [-1.0, 1.0, 1.0],
                [1.0, -1.0, 1.0],
                [1.0, 1.0, -1.0],
                [0.0, 0.0, 0.0],
                [0.5, -0.5, 0.5],
            ],
            dtype=np.float64,
        )
        images = np.column_stack(
            [points[:, 2] + 2.0, 2.0 - points[:, 2]]
        ).astype(np.float32)
        result = analyze_concept_lens(
            images,
            list(range(len(points))),
            np.eye(2, dtype=np.float32),
            [
                {"id": "a", "label": "ett", "scope_note": ""},
                {"id": "b", "label": "två", "scope_note": ""},
            ],
            ["a", "b"],
            points,
        )

        axis = result["axis"]
        self.assertTrue(axis["available"])
        self.assertEqual(axis["mode"], "contrast")
        self.assertEqual(axis["dimension"], 3)
        self.assertGreater(axis["end"][2], axis["start"][2])

    def test_axis_is_unavailable_for_degenerate_cloud(self):
        result = analyze_concept_lens(
            np.asarray([[1.0, 0.0], [0.8, 0.2], [0.6, 0.4]], dtype=np.float32),
            [0, 1, 2],
            np.asarray([[1.0, 0.0]], dtype=np.float32),
            [{"id": "a", "label": "ett", "scope_note": ""}],
            ["a"],
            np.asarray([[0.0, 0.0], [0.5, 0.0], [1.0, 0.0]]),
        )
        self.assertFalse(result["axis"]["available"])


if __name__ == "__main__":
    unittest.main()
