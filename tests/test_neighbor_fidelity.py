from __future__ import annotations

import unittest

import numpy as np

from api.neighbor_fidelity import analyze_neighbor_fidelity


def _unit_vectors(angles: list[float]) -> np.ndarray:
    radians = np.radians(np.asarray(angles, dtype=np.float32))
    return np.column_stack((np.cos(radians), np.sin(radians))).astype("float32")


class NeighborFidelityTests(unittest.TestCase):
    def analyze(self, points: list[list[float]], *, k: int = 2):
        return analyze_neighbor_fidelity(
            _unit_vectors([0, 10, 20, 90, 100]),
            [0, 1, 2, 3, 4],
            np.asarray(points, dtype=np.float32),
            0,
            k,
        )

    def test_perfect_retention(self):
        result = self.analyze(
            [[0, 0], [1, 0], [2, 0], [10, 0], [11, 0]]
        )
        self.assertEqual(result["retention"], 1.0)
        self.assertEqual(
            [item["image_id"] for item in result["neighbors"]["preserved"]],
            [1, 2],
        )
        self.assertEqual(result["neighbors"]["clip_only"], [])
        self.assertEqual(result["neighbors"]["projection_only"], [])

    def test_partial_and_zero_retention_categories(self):
        partial = self.analyze(
            [[0, 0], [1, 0], [10, 0], [2, 0], [11, 0]]
        )
        self.assertEqual(partial["retention"], 0.5)
        self.assertEqual(
            [item["image_id"] for item in partial["neighbors"]["preserved"]],
            [1],
        )
        self.assertEqual(
            [item["image_id"] for item in partial["neighbors"]["clip_only"]],
            [2],
        )
        self.assertEqual(
            [
                item["image_id"]
                for item in partial["neighbors"]["projection_only"]
            ],
            [3],
        )

        zero = self.analyze(
            [[0, 0], [10, 0], [11, 0], [1, 0], [2, 0]]
        )
        self.assertEqual(zero["retention"], 0.0)
        self.assertEqual(
            {item["image_id"] for item in zero["neighbors"]["clip_only"]},
            {1, 2},
        )
        self.assertEqual(
            {
                item["image_id"]
                for item in zero["neighbors"]["projection_only"]
            },
            {3, 4},
        )

    def test_supports_3d_points_and_clips_effective_k(self):
        result = self.analyze(
            [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]],
            k=10,
        )
        self.assertEqual(result["requested_k"], 10)
        self.assertEqual(result["effective_k"], 4)
        self.assertEqual(result["retention"], 1.0)

    def test_ties_are_deterministic_by_image_id(self):
        embeddings = np.asarray(
            [[1, 0], [0, 1], [0, 1], [0, 1]],
            dtype=np.float32,
        )
        points = np.asarray(
            [[0, 0], [1, 0], [-1, 0], [0, 1]],
            dtype=np.float32,
        )
        first = analyze_neighbor_fidelity(
            embeddings,
            [0, 3, 2, 1],
            points,
            0,
            2,
        )
        second = analyze_neighbor_fidelity(
            embeddings,
            [0, 3, 2, 1],
            points,
            0,
            2,
        )
        self.assertEqual(first, second)
        self.assertEqual(
            [item["image_id"] for item in first["neighbors"]["preserved"]],
            [1, 2],
        )

    def test_only_submitted_images_participate(self):
        embeddings = _unit_vectors([0, 1, 10, 20])
        result = analyze_neighbor_fidelity(
            embeddings,
            [0, 2, 3],
            np.asarray([[0, 0], [1, 0], [2, 0]], dtype=np.float32),
            0,
            2,
        )
        returned_ids = {
            item["image_id"]
            for values in result["neighbors"].values()
            for item in values
        }
        self.assertNotIn(1, returned_ids)


if __name__ == "__main__":
    unittest.main()
