from __future__ import annotations

import logging

from flask import Flask
from flask_cors import CORS

from api import config
from api.runtime import init_runtime
from api.routes_datasets import bp as datasets_bp
from api.routes_dataset_scoped import bp as dataset_scoped_bp


def create_app() -> Flask:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    config.ensure_runtime_dirs()
    init_runtime()

    app = Flask(__name__)
    CORS(app)

    app.register_blueprint(datasets_bp)
    app.register_blueprint(dataset_scoped_bp)

    return app
