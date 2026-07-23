from __future__ import annotations

from types import SimpleNamespace
import unittest
from unittest.mock import patch

from flask import Flask
import numpy as np

from api.routes_dataset_scoped import bp


class FakeEmbeddings:
    def __len__(self):
        return 3

    def cpu(self):
        return self

    def numpy(self):
        return np.eye(3, dtype=np.float32)


class GraphNetworkRouteTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(bp)
        self.client = app.test_client()
        self.context = SimpleNamespace(
            embeddings=FakeEmbeddings(),
            faiss_index=object(),
        )

    def post(self, payload):
        with patch(
            "api.routes_dataset_scoped._get_context",
            return_value=self.context,
        ):
            return self.client.post("/datasets/test/graph-network", json=payload)

    def test_rejects_missing_or_invalid_root(self):
        self.assertEqual(self.post({}).status_code, 400)
        self.assertEqual(self.post({"root_image_id": "1"}).status_code, 400)
        response = self.post({"root_image_id": 10})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json()["error"], "Root image ID not found")

    def test_rejects_out_of_range_parameters(self):
        invalid_payloads = [
            {"root_image_id": 0, "max_depth": 0},
            {"root_image_id": 0, "neighbors_per_node": 11},
            {"root_image_id": 0, "max_nodes": 1},
            {"root_image_id": 0, "min_similarity": 1.1},
        ]
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                self.assertEqual(self.post(payload).status_code, 400)

    def test_uses_defaults_and_returns_dataset_id(self):
        graph_result = {
            "root_image_id": 1,
            "parameters": {},
            "nodes": [],
            "edges": [],
        }
        with (
            patch(
                "api.routes_dataset_scoped._get_context",
                return_value=self.context,
            ),
            patch(
                "api.routes_dataset_scoped.build_graph_network",
                return_value=graph_result,
            ) as builder,
        ):
            response = self.client.post(
                "/datasets/test/graph-network",
                json={"root_image_id": 1},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["dataset_id"], "test")
        parameters = builder.call_args.args[3]
        self.assertEqual(parameters.max_depth, 3)
        self.assertEqual(parameters.neighbors_per_node, 4)
        self.assertEqual(parameters.max_nodes, 60)
        self.assertEqual(parameters.min_similarity, 0.75)


if __name__ == "__main__":
    unittest.main()
