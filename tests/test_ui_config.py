from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from flask import Flask

from api.routes_ui_config import bp, DEFAULT_CONFIG


class UiConfigTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "config.json"
        patcher = patch("api.routes_ui_config.CONFIG_PATH", self.path)
        patcher.start()
        self.addCleanup(patcher.stop)
        app = Flask(__name__)
        app.register_blueprint(bp)
        self.client = app.test_client()

    def test_missing_file_returns_enabled_defaults(self):
        self.assertEqual(self.client.get("/ui-config").get_json(), DEFAULT_CONFIG)

    def test_save_persists_and_reload_preserves_view_settings(self):
        response = self.client.put("/ui-config", json={
            "words": False,
            "viewTypeOptions": False,
            "views": {"umap": {"search": False}, "grid": {"imageSize": False}},
        })
        self.assertEqual(response.status_code, 200)
        saved = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertFalse(saved["words"])
        self.assertFalse(saved["views"]["umap"]["search"])
        self.assertTrue(saved["views"]["grid"]["search"])
        self.assertFalse(saved["views"]["grid"]["imageSize"])
        self.assertEqual(self.client.get("/ui-config").get_json(), saved)

    def test_invalid_settings_do_not_overwrite_file(self):
        self.client.put("/ui-config", json=DEFAULT_CONFIG)
        original = self.path.read_bytes()
        for payload in [[], {"words": 0}, {"views": {"umap": {"search": "false"}}}, {"unknown": True}]:
            with self.subTest(payload=payload):
                self.assertEqual(self.client.put("/ui-config", json=payload).status_code, 400)
                self.assertEqual(self.path.read_bytes(), original)

    def test_corrupt_file_is_reported(self):
        self.path.write_text("{", encoding="utf-8")
        self.assertEqual(self.client.get("/ui-config").status_code, 500)

    def test_view_visibility_is_persisted_separately_from_widgets(self):
        response = self.client.put("/ui-config", json={
            "views": {"umap": {"enabled": False, "search": True}},
        })
        self.assertEqual(response.status_code, 200)
        saved = self.client.get("/ui-config").get_json()
        self.assertFalse(saved["views"]["umap"]["enabled"])
        self.assertTrue(saved["views"]["umap"]["search"])
        self.assertTrue(saved["views"]["grid"]["enabled"])

    def test_legacy_file_defaults_view_visibility_to_enabled(self):
        self.path.write_text(json.dumps({"views": {"umap": {"search": False}}}), encoding="utf-8")
        saved = self.client.get("/ui-config").get_json()
        self.assertTrue(saved["views"]["umap"]["enabled"])
        self.assertFalse(saved["views"]["umap"]["search"])

    def test_selection_widget_settings_persist_independently_per_view(self):
        controls = {"tagPanel": False, "reprojectSelection": False, "createGraph": False, "setAnchorA": False}
        response = self.client.put("/ui-config", json={"views": {"umap": controls}})
        self.assertEqual(response.status_code, 200)
        saved = self.client.get("/ui-config").get_json()
        for control in controls:
            self.assertFalse(saved["views"]["umap"][control])
            self.assertTrue(saved["views"]["grid"][control])

    def test_open_on_selection_is_opt_in_and_persists(self):
        self.path.write_text(json.dumps({"words": False}), encoding="utf-8")
        self.assertFalse(self.client.get("/ui-config").get_json()["openImageOnSelection"])
        response = self.client.put("/ui-config", json={"openImageOnSelection": True})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.client.get("/ui-config").get_json()["openImageOnSelection"])


if __name__ == "__main__":
    unittest.main()
