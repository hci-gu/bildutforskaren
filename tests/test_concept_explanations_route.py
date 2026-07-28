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


class ConceptExplanationRouteTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(bp)
        self.client = app.test_client()
        self.context = SimpleNamespace(embeddings=FakeEmbeddings())
        self.concepts = [
            {"id": "a", "label": "Alpha", "scope_note": ""},
            {"id": "b", "label": "Beta", "scope_note": ""},
        ]
        self.concept_embeddings = np.asarray(
            [[1, 0, 0, 0], [0, 1, 0, 0]],
            dtype=np.float32,
        )

    def post(self, payload):
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
            return self.client.post(
                "/datasets/test/concept-explanations",
                json=payload,
            )

    def valid_payload(self):
        return {
            "image_ids": [0, 1, 2],
            "selected_image_id": 0,
        }

    def test_serializes_without_comparison(self):
        response = self.post(self.valid_payload())
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["dataset_id"], "test")
        self.assertEqual(data["selected_image_id"], 0)
        self.assertIsNone(data["comparison"])

    def test_serializes_with_comparison(self):
        payload = self.valid_payload()
        payload["comparison_image_id"] = 1
        response = self.post(payload)
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["comparison_image_id"], 1)
        self.assertIsNotNone(data["comparison"])

    def test_rejects_invalid_image_ids(self):
        for image_ids in [None, [], [0, 0], [0, "1"], [0, 9]]:
            with self.subTest(image_ids=image_ids):
                payload = self.valid_payload()
                payload["image_ids"] = image_ids
                self.assertEqual(self.post(payload).status_code, 400)

    def test_rejects_selected_id_outside_subset(self):
        payload = self.valid_payload()
        payload["selected_image_id"] = 3
        self.assertEqual(self.post(payload).status_code, 400)

    def test_rejects_invalid_comparison_id(self):
        for comparison_id in [0, 3, "1", True]:
            with self.subTest(comparison_id=comparison_id):
                payload = self.valid_payload()
                payload["comparison_image_id"] = comparison_id
                self.assertEqual(self.post(payload).status_code, 400)


if __name__ == "__main__":
    unittest.main()
