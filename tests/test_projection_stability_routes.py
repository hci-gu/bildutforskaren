from __future__ import annotations

from types import SimpleNamespace
import unittest
from unittest.mock import patch

from flask import Flask
import numpy as np

from api.projection_stability_jobs import ActiveStabilityJobError
from api.routes_dataset_scoped import bp


class _FakeEmbeddings:
    def __init__(self):
        self.vectors = np.eye(12, dtype=np.float32)

    def __len__(self):
        return len(self.vectors)

    def cpu(self):
        return self

    def numpy(self):
        return self.vectors


class _FakeManager:
    def __init__(self):
        self.start_error = None
        self.state = {
            "job_id": "job-1",
            "dataset_id": "test",
            "status": "running",
            "progress": 0.5,
        }

    def start(self, _dataset_id, _worker):
        if self.start_error:
            raise self.start_error
        return "job-1"

    def get(self, job_id, dataset_id):
        if job_id != "job-1" or dataset_id != "test":
            return None
        return self.state

    def cancel(self, job_id, dataset_id):
        return self.get(job_id, dataset_id)


class ProjectionStabilityRouteTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(bp)
        self.client = app.test_client()
        self.context = SimpleNamespace(embeddings=_FakeEmbeddings())
        self.manager = _FakeManager()
        self.concepts = [
            {"id": "a", "label": "hästar", "scope_note": "Djur."},
        ]

    def valid_payload(self):
        return {
            "image_ids": list(range(10)),
            "projection_points": [
                [float(index), float(index % 2)] for index in range(10)
            ],
            "params": {
                "n_neighbors": 9,
                "min_dist": 0.1,
                "spread": 1.0,
                "seed": 1,
            },
        }

    def request(self, method: str, path: str, payload=None):
        with (
            patch(
                "api.routes_dataset_scoped._get_context",
                return_value=self.context,
            ),
            patch(
                "api.routes_dataset_scoped.get_projection_stability_job_manager",
                return_value=self.manager,
            ),
            patch(
                "api.sao_terms.get_embeddings",
                return_value=(
                    np.asarray([[1.0] + [0.0] * 11], dtype=np.float32),
                    self.concepts,
                ),
            ),
        ):
            return self.client.open(path, method=method, json=payload)

    def test_start_status_and_cancel_lifecycle(self):
        start = self.request(
            "POST",
            "/datasets/test/projection-stability/jobs",
            self.valid_payload(),
        )
        self.assertEqual(start.status_code, 202)
        self.assertEqual(start.get_json()["job_id"], "job-1")

        status = self.request(
            "GET",
            "/datasets/test/projection-stability/jobs/job-1",
        )
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.get_json()["progress"], 0.5)

        cancelled = self.request(
            "DELETE",
            "/datasets/test/projection-stability/jobs/job-1",
        )
        self.assertEqual(cancelled.status_code, 202)

    def test_rejects_invalid_payloads(self):
        invalid_payloads = []
        payload = self.valid_payload()
        invalid_payloads.append({**payload, "image_ids": list(range(9))})
        invalid_payloads.append({**payload, "image_ids": [0] * 10})
        invalid_payloads.append(
            {**payload, "image_ids": [*range(9), 20]}
        )
        invalid_payloads.append(
            {**payload, "projection_points": [[0.0, 0.0]]}
        )
        invalid_payloads.append(
            {
                **payload,
                "projection_points": [
                    *payload["projection_points"][:-1],
                    [0.0, float("inf")],
                ],
            }
        )
        invalid_payloads.append({**payload, "params": {"seed": 1}})
        invalid_payloads.append(
            {
                **payload,
                "params": {**payload["params"], "n_neighbors": 1},
            }
        )
        invalid_payloads.append(
            {
                **payload,
                "params": {**payload["params"], "min_dist": 2.0},
            }
        )

        for invalid in invalid_payloads:
            with self.subTest(payload=invalid):
                response = self.request(
                    "POST",
                    "/datasets/test/projection-stability/jobs",
                    invalid,
                )
                self.assertEqual(response.status_code, 400)

    def test_duplicate_active_job_and_unknown_job(self):
        self.manager.start_error = ActiveStabilityJobError("active-job")
        response = self.request(
            "POST",
            "/datasets/test/projection-stability/jobs",
            self.valid_payload(),
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()["job_id"], "active-job")

        missing = self.request(
            "GET",
            "/datasets/test/projection-stability/jobs/missing",
        )
        self.assertEqual(missing.status_code, 404)


if __name__ == "__main__":
    unittest.main()
