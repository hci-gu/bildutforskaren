from __future__ import annotations

from flask import Blueprint, jsonify, request

from api import config
from api import datasets
from api import jobs
from api import runtime


bp = Blueprint("datasets", __name__)


@bp.route("/datasets", methods=["GET", "POST"])
def datasets_route():
    if request.method == "GET":
        return jsonify(datasets.list_datasets())

    payload = request.get_json(silent=True) or {}
    name = payload.get("name")
    data = datasets.create_dataset(name)
    return jsonify(data), 201


@bp.route("/datasets/<dataset_id>/status", methods=["GET"])
def dataset_status(dataset_id: str):
    try:
        meta = datasets.read_dataset_json(dataset_id)
    except FileNotFoundError:
        return jsonify({"error": "Dataset not found"}), 404

    meta = dict(meta)
    meta.setdefault("metadata_source", "none")
    meta["has_metadata_xlsx"] = (config.DATASETS_ROOT / dataset_id / "metadata.xlsx").exists()
    try:
        cfg = datasets.get_dataset_config(dataset_id)
        meta["embeddings_cached"] = cfg.cache_file.exists()
    except Exception:
        meta["embeddings_cached"] = False

    job = runtime.get_job_manager().get_state(dataset_id)
    if job:
        meta["job"] = job

    return jsonify(meta)


@bp.route("/datasets/<dataset_id>/metadata-source", methods=["GET", "POST"])
def dataset_metadata_source(dataset_id: str):
    if not datasets.is_safe_dataset_id(dataset_id):
        return jsonify({"error": "Invalid dataset_id"}), 400

    try:
        meta = datasets.read_dataset_json(dataset_id)
    except FileNotFoundError:
        return jsonify({"error": "Dataset not found"}), 404

    xlsx_path = config.DATASETS_ROOT / dataset_id / "metadata.xlsx"
    has_xlsx = xlsx_path.exists()

    if request.method == "GET":
        current = str(meta.get("metadata_source") or "none")
        available = ["none"] + (["legacy_xlsx"] if has_xlsx else [])
        return jsonify(
            {
                "dataset_id": dataset_id,
                "selected": current,
                "available": available,
                "has_metadata_xlsx": has_xlsx,
            }
        )

    payload = request.get_json(silent=True) or {}
    source = str(payload.get("source") or "none")

    allowed = {"none", "legacy_xlsx"}
    if source not in allowed:
        return jsonify({"error": "Invalid metadata source"}), 400

    if source == "legacy_xlsx" and not has_xlsx:
        return jsonify({"error": "metadata.xlsx not found for dataset"}), 409

    meta = dict(meta)
    meta["metadata_source"] = source
    datasets.write_dataset_json(dataset_id, meta)

    runtime.get_context_cache().invalidate(dataset_id)

    meta.setdefault("metadata_source", "none")
    meta["has_metadata_xlsx"] = has_xlsx
    return jsonify(meta)


@bp.route("/datasets/<dataset_id>/upload-zip", methods=["POST"])
def upload_zip(dataset_id: str):
    if not datasets.is_safe_dataset_id(dataset_id):
        return jsonify({"error": "Invalid dataset_id"}), 400

    try:
        meta = datasets.read_dataset_json(dataset_id)
    except FileNotFoundError:
        return jsonify({"error": "Dataset not found"}), 404

    if meta.get("status") != "created":
        return jsonify({"error": "Dataset is immutable and already uploaded/processed"}), 409

    if "file" not in request.files:
        return jsonify({"error": "Missing 'file' field"}), 400

    file = request.files["file"]

    try:
        extracted = datasets.extract_zip_to_originals(dataset_id, file.stream)
    except ValueError:
        return jsonify({"error": "Could not read zip"}), 400

    if extracted == 0:
        return jsonify({"error": "Zip contained no supported image files"}), 400

    meta["status"] = "uploaded"
    datasets.write_dataset_json(dataset_id, meta)

    jobs.submit_processing(dataset_id)

    return jsonify({"dataset_id": dataset_id, "status": "processing", "extracted": extracted}), 202


@bp.route("/datasets/<dataset_id>/resume-processing", methods=["POST"])
def resume_processing(dataset_id: str):
    if not datasets.is_safe_dataset_id(dataset_id):
        return jsonify({"error": "Invalid dataset_id"}), 400

    try:
        meta = datasets.read_dataset_json(dataset_id)
    except FileNotFoundError:
        return jsonify({"error": "Dataset not found"}), 404

    status = meta.get("status")
    cfg = datasets.get_dataset_config(dataset_id)
    embeddings_cached = cfg.cache_file.exists()

    job_state = runtime.get_job_manager().get_state(dataset_id)
    active_stages = {"queued", "thumbnails", "indexing", "embeddings", "atlas"}
    if job_state.get("stage") in active_stages:
        return jsonify({"error": "Processing already running"}), 409

    if status == "created":
        return jsonify({"error": "Dataset has no uploaded images yet"}), 409

    if status == "ready" and embeddings_cached:
        return jsonify({"error": "Dataset already processed"}), 409

    jobs.submit_processing(dataset_id)
    return jsonify({"status": "queued"}), 202
