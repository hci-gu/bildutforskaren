from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from flask import Flask

from api.auth import install_api_key_auth


class ApiKeyAuthTests(unittest.TestCase):
    def make_client(self):
        app = Flask(__name__)
        with patch.dict(os.environ, {"BILDUTFORSKAREN_API_KEY": "test-secret-key"}):
            install_api_key_auth(app)
        app.add_url_rule("/example", view_func=lambda: {"ok": True})
        return app.test_client()

    def test_key_is_required_for_every_route(self):
        client = self.make_client()
        self.assertEqual(client.get("/example").status_code, 401)
        self.assertEqual(client.post("/example").status_code, 401)
        self.assertEqual(client.get("/missing").status_code, 401)
        self.assertEqual(client.get("/example", headers={"X-API-Key": "wrong"}).status_code, 401)
        self.assertEqual(
            client.get("/example", headers={"X-API-Key": "test-secret-key"}).json,
            {"ok": True},
        )

    def test_cors_preflight_does_not_require_key(self):
        client = self.make_client()
        self.assertEqual(client.options("/example").status_code, 200)

    def test_missing_configuration_fails_closed(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "BILDUTFORSKAREN_API_KEY"):
                install_api_key_auth(Flask(__name__))


if __name__ == "__main__":
    unittest.main()
