from __future__ import annotations

from types import SimpleNamespace
import unittest
from unittest.mock import patch

from flask import Flask
import numpy as np

from api.routes_dataset_scoped import bp


class FakeEmbeddings:
    def __init__(self):
        self.vectors = np.eye(6, dtype=np.float32)

    def __len__(self):
        return len(self.vectors)

    def cpu(self):
        return self

    def numpy(self):
        return self.vectors


class XaiRouteTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(bp)
        self.client = app.test_client()
        self.context = SimpleNamespace(embeddings=FakeEmbeddings())
        self.concept_embeddings = np.eye(2, 6, dtype=np.float32)
        self.concepts = [
            {"id": "a", "label": "hästar", "scope_note": "Djur."},
            {"id": "b", "label": "vagnar", "scope_note": "Fordon."},
        ]

    def post(self, path: str, payload):
        with (
            patch(
                "api.routes_dataset_scoped._get_context",
                return_value=self.context,
            ),
            patch(
                "api.sao_terms.get_embeddings",
                return_value=(self.concept_embeddings, self.concepts),
            ),
        ):
            return self.client.post(path, json=payload)

    def test_concept_lens_serializes_swedish_metadata_and_scores(self):
        response = self.post(
            "/datasets/test/concept-lens",
            {
                "image_ids": [0, 1, 2, 3],
                "concept_ids": ["a", "b"],
                "projection_points": [
                    [0.0, 0.0],
                    [1.0, 0.0],
                    [0.0, 1.0],
                    [1.0, 1.0],
                ],
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["dataset_id"], "test")
        self.assertEqual(data["concepts"][0]["label"], "hästar")
        self.assertIn("comparison_delta", data["images"][0])
        self.assertIn("axis", data)

    def test_concept_lens_rejects_invalid_ids_and_concepts(self):
        invalid_payloads = [
            {"image_ids": [], "concept_ids": ["a"]},
            {"image_ids": [0, 0], "concept_ids": ["a"]},
            {"image_ids": [0, "1"], "concept_ids": ["a"]},
            {"image_ids": [7], "concept_ids": ["a"]},
            {"image_ids": [0], "concept_ids": []},
            {"image_ids": [0], "concept_ids": ["a", "a"]},
            {"image_ids": [0], "concept_ids": ["a", "b", "c"]},
            {"image_ids": [0], "concept_ids": ["missing"]},
            {
                "image_ids": [0, 1],
                "concept_ids": ["a"],
                "projection_points": [[0, 0]],
            },
            {
                "image_ids": [0, 1],
                "concept_ids": ["a"],
                "projection_points": [[0, 0], [1, 1, 1, 1]],
            },
            {
                "image_ids": [0, 1],
                "concept_ids": ["a"],
                "projection_points": [[0, 0], [1, float("inf")]],
            },
        ]
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                response = self.post("/datasets/test/concept-lens", payload)
                self.assertEqual(response.status_code, 400)

    def valid_cluster_payload(self):
        return {
            "image_ids": [0, 1, 2, 3, 4, 5],
            "projection_points": [
                [0.0, 0.0],
                [0.1, 0.0],
                [0.0, 0.1],
                [2.0, 2.0],
                [2.1, 2.0],
                [2.0, 2.1],
            ],
            "clustering": {
                "algorithm": "kmeans",
                "parameters": {"max_clusters": 2, "random_state": 7},
            },
        }

    def test_cluster_profiles_returns_members_and_semantics(self):
        response = self.post(
            "/datasets/test/cluster-profiles",
            self.valid_cluster_payload(),
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["dataset_id"], "test")
        self.assertEqual(data["clustering"]["feature_space"], "umap_2d")
        self.assertEqual(len(data["clusters"]), 2)
        self.assertIn("strongest", data["clusters"][0]["profile"])

    def test_cluster_profiles_rejects_invalid_payloads(self):
        invalid_changes = [
            {"image_ids": [0]},
            {"image_ids": [0, 0]},
            {"image_ids": [0, "1"]},
            {"image_ids": [0, 7]},
            {"projection_points": [[0, 0]]},
            {"projection_points": [[0, 0, 0]] * 6},
            {"projection_points": [[0, 0], [1, 0], [2, 0]]},
            {
                "projection_points": [
                    [0, 0],
                    [1, 0],
                    [2, 0],
                    [3, 0],
                    [4, 0],
                    [5, float("nan")],
                ]
            },
            {"clustering": {"algorithm": "unknown"}},
        ]
        for changes in invalid_changes:
            with self.subTest(changes=changes):
                payload = {**self.valid_cluster_payload(), **changes}
                response = self.post("/datasets/test/cluster-profiles", payload)
                self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
