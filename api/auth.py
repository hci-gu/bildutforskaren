from __future__ import annotations

import hmac
import os

from flask import Flask, jsonify, request


API_KEY_ENV = "BILDUTFORSKAREN_API_KEY"


def install_api_key_auth(app: Flask) -> None:
    api_key = os.environ.get(API_KEY_ENV, "")
    if not api_key or api_key != api_key.strip():
        raise RuntimeError(f"Set {API_KEY_ENV} to a nonempty API key before starting the API")

    @app.before_request
    def require_api_key():
        # Browser CORS preflights contain no credentials and expose no route data.
        if request.method == "OPTIONS":
            return None

        supplied_key = request.headers.get("X-API-Key", "")
        if not hmac.compare_digest(supplied_key, api_key):
            return jsonify(error="Invalid or missing API key"), 401

        return None
