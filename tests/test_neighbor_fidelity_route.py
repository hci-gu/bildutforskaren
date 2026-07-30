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


class NeighborFidelityRouteTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(bp)
        self.client = app.test_client()
        self.context = SimpleNamespace(embeddings=FakeEmbeddings())

    def post(self, payload):
        with patch(
            "api.routes_dataset_scoped._get_context",
            return_value=self.context,
        ):
            return self.client.post(
                "/datasets/test/neighbor-fidelity",
                json=payload,
            )

    def valid_payload(self):
        return {
            "image_ids": [0, 1, 2],
            "projection_points": [[0, 0], [1, 0], [2, 0]],
            "selected_image_id": 0,
            "k": 2,
        }

    def test_valid_response_includes_dataset_and_categories(self):
        response = self.post(self.valid_payload())
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["dataset_id"], "test")
        self.assertEqual(data["selected_image_id"], 0)
        self.assertEqual(data["effective_k"], 2)
        self.assertEqual(
            set(data["neighbors"]),
            {"preserved", "clip_only", "projection_only"},
        )

    def test_rejects_invalid_image_ids(self):
        invalid_values = [
            [],
            [0],
            [0, 0],
            [0, "1"],
            [0, 10],
        ]
        for image_ids in invalid_values:
            with self.subTest(image_ids=image_ids):
                payload = self.valid_payload()
                payload["image_ids"] = image_ids
                self.assertEqual(self.post(payload).status_code, 400)

    def test_rejects_invalid_points(self):
        invalid_values = [
            None,
            [[0, 0]],
            [[0], [1], [2]],
            [[0, 0], [1, 0, 0], [2, 0]],
            [[0, 0, 0, 0], [1, 0, 0, 0], [2, 0, 0, 0]],
            [[0, 0], [1, "0"], [2, 0]],
            [[0, 0], [1, True], [2, 0]],
            [[0, 0], [1, float("nan")], [2, 0]],
        ]
        for points in invalid_values:
            with self.subTest(points=points):
                payload = self.valid_payload()
                payload["projection_points"] = points
                self.assertEqual(self.post(payload).status_code, 400)

    def test_rejects_invalid_selected_id_and_k(self):
        payload = self.valid_payload()
        payload["selected_image_id"] = 3
        self.assertEqual(self.post(payload).status_code, 400)

        for k in [1, 51, 2.5, True]:
            with self.subTest(k=k):
                payload = self.valid_payload()
                payload["k"] = k
                self.assertEqual(self.post(payload).status_code, 400)

    def test_accepts_3d_points(self):
        payload = self.valid_payload()
        payload["projection_points"] = [
            [0, 0, 0],
            [1, 0, 0],
            [2, 0, 0],
        ]
        self.assertEqual(self.post(payload).status_code, 200)


if __name__ == "__main__":
    unittest.main()
