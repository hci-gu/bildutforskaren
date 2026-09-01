from __future__ import annotations

import copy
import unittest

import numpy as np

from api.anchor_analysis import AnchorAnalysisParameters, analyze_anchor_paths
from api.anchor_semantics import analyze_anchor_semantics


def _unit_vectors(angles: list[float]) -> np.ndarray:
    radians = np.radians(np.asarray(angles, dtype=np.float32))
    return np.column_stack((np.cos(radians), np.sin(radians))).astype("float32")


class AnchorSemanticsTests(unittest.TestCase):
    def analyze(
        self,
        vectors: np.ndarray,
        concepts: np.ndarray,
        terms: list[dict],
        *,
        anchor_a: list[int] | None = None,
        anchor_b: list[int] | None = None,
        graph_k: int = 2,
    ):
        anchor_a = anchor_a or [0]
        anchor_b = anchor_b or [len(vectors) - 1]
        result = analyze_anchor_paths(
            vectors,
            anchor_a,
            anchor_b,
            list(range(len(vectors))),
            AnchorAnalysisParameters(
                path_steps=7,
                retrieval_count=2,
                graph_k=graph_k,
            ),
        )
        semantics = analyze_anchor_semantics(
            vectors,
            anchor_a,
            anchor_b,
            result,
            concepts,
            terms,
        )
        return result, semantics

    def test_endpoint_profiles_normalize_and_allow_delta_overlap(self):
        vectors = _unit_vectors([0, 30, 60, 90])
        concepts = np.vstack(
            [
                _unit_vectors([0, 90, 20, 70]),
                np.zeros((12, 2), dtype=np.float32),
            ]
        )
        terms = [
            {"id": f"{index:02d}", "label": f"Concept {index}"}
            for index in range(len(concepts))
        ]
        _, semantics = self.analyze(vectors * 3, concepts * 4, terms)

        self.assertEqual(semantics["endpoint_a"][0]["concept_id"], "00")
        self.assertEqual(semantics["endpoint_b"][0]["concept_id"], "01")
        increasing_ids = {
            item["concept_id"] for item in semantics["increasing"]
        }
        decreasing_ids = {
            item["concept_id"] for item in semantics["decreasing"]
        }
        self.assertIn("01", increasing_ids)
        self.assertIn("00", decreasing_ids)
        self.assertTrue(semantics["endpoint_a"][0]["in_trajectory"])
        self.assertAlmostEqual(
            semantics["endpoint_a"][0]["score_a"],
            1.0,
            places=5,
        )

    def test_adaptive_gate_excludes_irrelevant_and_returns_fewer(self):
        vectors = _unit_vectors([0, 45, 90])
        concepts = np.vstack(
            [
                _unit_vectors([0, 90]),
                np.zeros((30, 2), dtype=np.float32),
            ]
        )
        terms = [
            {"id": str(index), "label": str(index)}
            for index in range(len(concepts))
        ]
        _, semantics = self.analyze(vectors, concepts, terms)
        trajectory_ids = {
            item["concept_id"]
            for item in [
                *semantics["increasing"],
                *semantics["decreasing"],
            ]
        }
        self.assertEqual(trajectory_ids, {"0", "1"})
        self.assertEqual(len(semantics["increasing"]), 1)
        self.assertEqual(len(semantics["decreasing"]), 1)

    def test_strict_delta_order_and_deterministic_ties(self):
        vectors = _unit_vectors([0, 45, 90])
        concepts = np.vstack(
            [
                _unit_vectors([90, 90, 70, 20, 0, 0]),
                np.zeros((30, 2), dtype=np.float32),
            ]
        )
        terms = [
            {"id": value, "label": value}
            for value in ["b", "a", "c", "d", "f", "e"]
        ] + [
            {"id": f"z{index}", "label": f"z{index}"}
            for index in range(30)
        ]
        _, semantics = self.analyze(vectors, concepts, terms)
        self.assertEqual(
            [item["concept_id"] for item in semantics["increasing"][:2]],
            ["a", "b"],
        )
        self.assertEqual(
            [item["concept_id"] for item in semantics["decreasing"][:2]],
            ["e", "f"],
        )

    def test_ideal_observed_and_graph_trajectories(self):
        vectors = _unit_vectors([0, 15, 30, 45, 60, 75, 90])
        concepts = np.vstack(
            [
                _unit_vectors([0, 90]),
                np.zeros((20, 2), dtype=np.float32),
            ]
        )
        terms = [
            {"id": str(index), "label": str(index), "scope_note": ""}
            for index in range(len(concepts))
        ]
        result, semantics = self.analyze(vectors, concepts, terms)
        trajectory = semantics["trajectories"][0]
        concept = next(
            item
            for item in [*semantics["increasing"], *semantics["decreasing"]]
            if item["concept_id"] == trajectory["concept_id"]
        )
        self.assertAlmostEqual(
            trajectory["ideal"][0]["score"],
            concept["score_a"],
            places=5,
        )
        self.assertAlmostEqual(
            trajectory["ideal"][-1]["score"],
            concept["score_b"],
            places=5,
        )
        for step, point in zip(
            result["interpolation"]["steps"],
            trajectory["interpolation"],
        ):
            self.assertEqual(
                point["image_id"],
                step["retrievals"][0]["image_id"],
            )
            self.assertAlmostEqual(
                point["gap"],
                point["score"] - point["ideal_score"],
                places=6,
            )
        point_by_id = {
            point["image_id"]: point for point in result["points"]
        }
        for point in trajectory["axis"]:
            self.assertAlmostEqual(
                point["progress"],
                point_by_id[point["image_id"]]["t_clipped"],
                places=6,
            )
        graph = trajectory["graph_supported"]
        self.assertEqual(graph[0]["progress"], 0.0)
        self.assertAlmostEqual(graph[-1]["progress"], 1.0)
        if len(graph) > 2:
            self.assertGreater(graph[1]["progress"], 0.0)
            self.assertLess(graph[1]["progress"], 1.0)

    def test_preserves_missing_retrievals_and_disconnected_graphs(self):
        vectors = _unit_vectors([0, 1, 2, 100, 101, 102])
        concepts = np.vstack(
            [
                _unit_vectors([0, 102]),
                np.zeros((20, 2), dtype=np.float32),
            ]
        )
        terms = [
            {"id": str(index), "label": str(index)}
            for index in range(len(concepts))
        ]
        result = analyze_anchor_paths(
            vectors,
            [0],
            [5],
            list(range(len(vectors))),
            AnchorAnalysisParameters(
                path_steps=7,
                retrieval_count=2,
                graph_k=2,
            ),
        )
        result = copy.deepcopy(result)
        result["interpolation"]["steps"][3]["retrievals"] = []
        semantics = analyze_anchor_semantics(
            vectors,
            [0],
            [5],
            result,
            concepts,
            terms,
        )
        trajectory = semantics["trajectories"][0]
        self.assertIsNone(trajectory["interpolation"][3]["image_id"])
        self.assertIsNone(trajectory["interpolation"][3]["score"])
        self.assertEqual(trajectory["graph_supported"], [])


if __name__ == "__main__":
    unittest.main()
