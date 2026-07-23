from __future__ import annotations

import math
import unittest

import numpy as np

from api.anchor_analysis import AnchorAnalysisParameters, analyze_anchor_paths


def _unit_vectors(angles: list[float]) -> np.ndarray:
    radians = np.radians(np.asarray(angles, dtype=np.float32))
    return np.column_stack((np.cos(radians), np.sin(radians))).astype("float32")


class AnchorAnalysisTests(unittest.TestCase):
    def analyze(
        self,
        vectors: np.ndarray,
        anchor_a: list[int],
        anchor_b: list[int],
        *,
        candidates: list[int] | None = None,
        path_steps: int = 7,
        retrieval_count: int = 3,
        graph_k: int = 2,
    ):
        return analyze_anchor_paths(
            vectors,
            anchor_a,
            anchor_b,
            candidates or list(range(len(vectors))),
            AnchorAnalysisParameters(
                path_steps=path_steps,
                retrieval_count=retrieval_count,
                graph_k=graph_k,
            ),
        )

    def test_group_centroid_coherence_medoid_and_dedicated_endpoints(self):
        vectors = _unit_vectors([0, 10, 20, 60, 70, 80])
        result = self.analyze(vectors, [0, 1, 2], [3, 4, 5], graph_k=3)
        self.assertEqual(result["anchors"]["a"]["size"], 3)
        self.assertEqual(result["anchors"]["a"]["medoid_id"], 1)
        self.assertEqual(result["anchors"]["b"]["medoid_id"], 4)
        self.assertGreater(result["anchors"]["a"]["coherence"], 0.9)
        self.assertEqual(result["axis"]["path_ids"][0], 1)
        self.assertEqual(result["axis"]["path_ids"][-1], 4)

    def test_rejects_overlap_and_degenerate_axis(self):
        vectors = _unit_vectors([0, 20, 40, 0])
        with self.assertRaisesRegex(ValueError, "disjoint"):
            self.analyze(vectors, [0, 1], [1, 2])
        with self.assertRaisesRegex(ValueError, "too similar"):
            self.analyze(vectors, [0], [3])

    def test_axis_projection_includes_outside_values_and_minimal_residual(self):
        vectors = np.asarray(
            [
                [-1.0, 0.0],
                [1.0, 0.0],
                [-0.8, 0.6],
                [0.0, 1.0],
                [0.8, 0.6],
            ],
            dtype=np.float32,
        )
        result = self.analyze(vectors, [2], [4], graph_k=2)
        points = {point["image_id"]: point for point in result["points"]}
        self.assertLess(points[0]["t"], 0.0)
        self.assertGreater(points[1]["t"], 1.0)
        self.assertAlmostEqual(points[3]["t"], 0.5, places=5)
        self.assertLessEqual(
            points[3]["line_residual"],
            float(np.linalg.norm(vectors[3] - vectors[2])),
        )

    def test_affinity_contrast_matches_axis_coordinate(self):
        vectors = _unit_vectors([0, 15, 30, 45, 60, 75, 90])
        result = self.analyze(vectors, [0], [6], graph_k=2)
        endpoint_similarity = result["anchors"]["similarity"]
        for point in result["points"]:
            expected = 0.5 + point["contrast"] / (
                2.0 * (1.0 - endpoint_similarity)
            )
            self.assertAlmostEqual(point["t"], expected, places=5)

    def test_slerp_has_equal_angles_and_excludes_anchor_members_inside(self):
        vectors = _unit_vectors(list(range(0, 91, 15)))
        result = self.analyze(
            vectors,
            [0],
            [6],
            path_steps=7,
            retrieval_count=2,
            graph_k=2,
        )
        steps = result["interpolation"]["steps"]
        angle_deltas = [
            steps[index + 1]["angle"] - steps[index]["angle"]
            for index in range(len(steps) - 1)
        ]
        self.assertTrue(
            all(math.isclose(delta, angle_deltas[0]) for delta in angle_deltas)
        )
        for step in steps[1:-1]:
            ids = {item["image_id"] for item in step["retrievals"]}
            self.assertFalse(ids & {0, 6})
        self.assertEqual(result["interpolation"]["path_ids"][0], 0)
        self.assertEqual(result["interpolation"]["path_ids"][-1], 6)

    def test_graph_returns_shortest_and_supported_paths(self):
        vectors = _unit_vectors([0, 15, 30, 45, 60, 75, 90])
        result = self.analyze(vectors, [0], [6], graph_k=2)
        graph = result["graph"]
        self.assertTrue(graph["shortest"]["connected"])
        self.assertTrue(graph["supported"]["connected"])
        self.assertEqual(graph["shortest"]["path_ids"][0], 0)
        self.assertEqual(graph["shortest"]["path_ids"][-1], 6)
        self.assertGreater(len(graph["supported"]["path_ids"]), 2)
        self.assertLessEqual(
            graph["supported"]["maximum_jump"],
            graph["shortest"]["maximum_jump"],
        )

    def test_graph_reports_disconnected_without_relaxing_k(self):
        vectors = _unit_vectors([0, 1, 2, 100, 101, 102])
        result = self.analyze(vectors, [0], [5], graph_k=2)
        self.assertFalse(result["graph"]["shortest"]["connected"])
        self.assertFalse(result["graph"]["supported"]["connected"])
        self.assertEqual(result["graph"]["k"], 2)

    def test_is_deterministic(self):
        vectors = _unit_vectors(list(range(0, 121, 10)))
        first = self.analyze(vectors, [0, 1], [10, 11, 12], graph_k=3)
        second = self.analyze(vectors, [0, 1], [10, 11, 12], graph_k=3)
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
