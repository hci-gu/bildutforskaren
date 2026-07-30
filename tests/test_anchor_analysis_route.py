from __future__ import annotations

from types import SimpleNamespace
import unittest
from unittest.mock import patch

from flask import Flask
import numpy as np

from api.routes_dataset_scoped import bp


class FakeEmbeddings:
    def __init__(self):
        self.vectors = np.eye(4, dtype=np.float32)

    def __len__(self):
        return len(self.vectors)

    def cpu(self):
        return self

    def numpy(self):
        return self.vectors


class AnchorAnalysisRouteTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(bp)
        self.client = app.test_client()
        self.context = SimpleNamespace(embeddings=FakeEmbeddings())

    def post(self, payload):
        concepts = [
            {"id": str(index), "label": f"Concept {index}"}
            for index in range(4)
        ]
        with (
            patch(
                "api.routes_dataset_scoped._get_context",
                return_value=self.context,
            ),
            patch(
                "api.sao_terms.get_embeddings",
                return_value=(np.eye(4, dtype=np.float32), concepts),
            ),
        ):
            return self.client.post("/datasets/test/anchor-analysis", json=payload)

    def test_rejects_overlap_before_analysis(self):
        response = self.post(
            {
                "anchor_a_ids": [0, 1],
                "anchor_b_ids": [1, 2],
                "candidate_ids": [0, 1, 2],
            }
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("disjoint", response.get_json()["error"])

    def test_rejects_empty_invalid_and_out_of_range_ids(self):
        invalid_payloads = [
            {},
            {"anchor_a_ids": [], "anchor_b_ids": [1], "candidate_ids": [0, 1]},
            {
                "anchor_a_ids": [0],
                "anchor_b_ids": ["1"],
                "candidate_ids": [0, 1],
            },
            {
                "anchor_a_ids": [0],
                "anchor_b_ids": [1],
                "candidate_ids": [0, 5],
            },
        ]
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                self.assertEqual(self.post(payload).status_code, 400)

    def test_deduplicates_groups_and_adds_anchors_to_candidates(self):
        analysis_result = {
            "anchors": {},
            "points": [],
            "axis": {},
            "interpolation": {},
            "graph": {},
            "parameters": {},
        }
        with (
            patch(
                "api.routes_dataset_scoped._get_context",
                return_value=self.context,
            ),
            patch(
                "api.routes_dataset_scoped.analyze_anchor_paths",
                return_value=analysis_result,
            ) as analyze,
            patch(
                "api.sao_terms.get_embeddings",
                side_effect=FileNotFoundError,
            ),
        ):
            response = self.client.post(
                "/datasets/test/anchor-analysis",
                json={
                    "anchor_a_ids": [0, 0],
                    "anchor_b_ids": [2, 2],
                    "candidate_ids": [1],
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(analyze.call_args.args[1], [0])
        self.assertEqual(analyze.call_args.args[2], [2])
        self.assertEqual(analyze.call_args.args[3], [1, 0, 2])
        self.assertFalse(response.get_json()["semantics"]["available"])

    def test_valid_response_includes_semantics(self):
        response = self.post(
            {
                "anchor_a_ids": [0],
                "anchor_b_ids": [1],
                "candidate_ids": [0, 1, 2, 3],
                "parameters": {"graph_k": 2},
            }
        )
        self.assertEqual(response.status_code, 200)
        semantics = response.get_json()["semantics"]
        self.assertTrue(semantics["available"])
        self.assertIn("endpoint_a", semantics)
        self.assertIn("trajectories", semantics)

    def test_sao_failure_preserves_anchor_response(self):
        with (
            patch(
                "api.routes_dataset_scoped._get_context",
                return_value=self.context,
            ),
            patch(
                "api.sao_terms.get_embeddings",
                side_effect=FileNotFoundError,
            ),
        ):
            response = self.client.post(
                "/datasets/test/anchor-analysis",
                json={
                    "anchor_a_ids": [0],
                    "anchor_b_ids": [1],
                    "candidate_ids": [0, 1, 2, 3],
                    "parameters": {"graph_k": 2},
                },
            )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIn("axis", data)
        self.assertFalse(data["semantics"]["available"])

    def test_validates_parameter_ranges(self):
        base = {
            "anchor_a_ids": [0],
            "anchor_b_ids": [1],
            "candidate_ids": [0, 1, 2],
        }
        for parameters in [
            {"path_steps": 4},
            {"retrieval_count": 21},
            {"graph_k": 1},
        ]:
            with self.subTest(parameters=parameters):
                self.assertEqual(
                    self.post({**base, "parameters": parameters}).status_code,
                    400,
                )


if __name__ == "__main__":
    unittest.main()
