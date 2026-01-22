from __future__ import annotations

import logging

from flask import Flask
from flask_cors import CORS

from api import config
from api.runtime import init_runtime
from api.routes_datasets import bp as datasets_bp
from api.routes_dataset_scoped import bp as dataset_scoped_bp
from api.routes_terms import bp as terms_bp
from api import sao_terms


def create_app() -> Flask:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    config.ensure_runtime_dirs()
    init_runtime()
    try:
        sao_terms.ensure_embeddings()
    except Exception as exc:
        logging.warning("Failed to warm SAO term embeddings: %s", exc)

    app = Flask(__name__)
    CORS(app)

    app.register_blueprint(datasets_bp)
    app.register_blueprint(dataset_scoped_bp)
    app.register_blueprint(terms_bp)

    return app
