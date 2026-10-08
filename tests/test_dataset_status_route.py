from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask

from api.routes_datasets import bp


class DatasetStatusRouteTests(unittest.TestCase):
    def test_status_does_not_build_artifact_context(self):
        app = Flask(__name__)
        app.register_blueprint(bp)

        with tempfile.TemporaryDirectory() as directory:
            cfg = SimpleNamespace(
                cache_file=Path(directory) / "index.npz",
                cache_dir=Path(directory),
                embedding_model="openai/clip-vit-large-patch14",
            )
            with (
                patch("api.routes_datasets.config.DATASETS_ROOT", Path(directory)),
                patch("api.routes_datasets.datasets.read_dataset_json", return_value={"status": "ready"}),
                patch("api.routes_datasets.datasets.get_dataset_config", return_value=cfg),
                patch("api.routes_datasets.runtime.get_job_manager", return_value=SimpleNamespace(get_state=lambda _: None)),
                patch("api.routes_datasets.image_roundtrip.artifact_status") as roundtrip,
                patch("api.routes_datasets.cluster_previews.status") as previews,
            ):
                response = app.test_client().get("/datasets/example/status")

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json["image_roundtrip"])
        self.assertIsNone(response.json["cluster_previews"])
        roundtrip.assert_not_called()
        previews.assert_not_called()


if __name__ == "__main__":
    unittest.main()
