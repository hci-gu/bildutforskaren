from __future__ import annotations

import json
import os
import tempfile
from copy import deepcopy
from threading import Lock

from flask import Blueprint, jsonify, request

from api.config import REPO_ROOT

bp = Blueprint("ui_config", __name__)
CONFIG_PATH = REPO_ROOT / "config.json"
_lock = Lock()
_common = [
    "enabled", "search", "imageSize", "advanced", "filter", "colorPhotographer",
    "clusterImages", "tagPanel", "reprojectSelection", "createGraph", "setAnchorA",
]
DEFAULT_CONFIG = {
    "words": True,
    "viewTypeOptions": True,
    "views": {
        view: dict.fromkeys(_common + extra, True)
        for view, extra in {
            "umap": ["dimension", "stability", "fidelity", "projectionParameters", "explanation", "minimap"],
            "grid": [],
            "tagged": ["groupTagged", "datasetStatus"],
            "graph": ["graphLayout"],
            "year": [],
        }.items()
    },
}


def _merge_config(value: object, defaults: dict) -> dict:
    if not isinstance(value, dict):
        raise ValueError("Configuration must be an object")
    if value.keys() - defaults.keys():
        raise ValueError("Unknown configuration setting")
    result = deepcopy(defaults)
    for key, item in value.items():
        if isinstance(defaults[key], dict):
            result[key] = _merge_config(item, defaults[key])
        elif type(item) is not bool:
            raise ValueError(f"{key} must be a boolean")
        else:
            result[key] = item
    return result


@bp.route("/ui-config", methods=["GET", "PUT"])
def ui_config():
    with _lock:
        try:
            if request.method == "GET":
                if not CONFIG_PATH.exists():
                    return jsonify(DEFAULT_CONFIG)
                return jsonify(_merge_config(json.loads(CONFIG_PATH.read_text(encoding="utf-8")), DEFAULT_CONFIG))

            try:
                settings = _merge_config(request.get_json(), DEFAULT_CONFIG)
            except ValueError as exc:
                return jsonify({"error": str(exc)}), 400

            # Replace atomically so readers never observe a partially written file.
            temporary_path = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=CONFIG_PATH.parent, delete=False) as temporary:
                    temporary_path = temporary.name
                    json.dump(settings, temporary, indent=2)
                    temporary.write("\n")
                os.replace(temporary_path, CONFIG_PATH)
            finally:
                if temporary_path and os.path.exists(temporary_path):
                    os.unlink(temporary_path)
            return jsonify(settings)
        except (OSError, ValueError):
            return jsonify({"error": "Could not read or save config.json"}), 500
