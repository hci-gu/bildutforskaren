from __future__ import annotations

import re

from flask import Blueprint, jsonify, request, send_file

from api import config
from api import cluster_previews
from api import datasets
from api import image_roundtrip
from api import jobs
from api import model_backends
from api import runtime
from api.clustering import ClusteringConfig


bp = Blueprint("datasets", __name__)


@bp.route("/models/status", methods=["GET"])
def model_status():
    try:
        backend = model_backends.get_model_backend()
        if isinstance(backend, model_backends.RemoteHttpModelBackend):
            try:
                import httpx

                response = httpx.get(f"{backend.base_url}/health", timeout=5)
                response.raise_for_status()
                worker = response.json()
            except Exception as exc:
                worker = {"ok": False, "error": str(exc)}
            return jsonify(
                {
                    "backend": "remote",
                    "worker_url": backend.base_url,
                    "worker": worker,
                }
            )

        return jsonify(
            {
                "backend": "local",
                "models": {
                    "caption": model_backends.CAPTION_MODEL,
                    "caption_task": model_backends.CAPTION_TASK,
                    "sdxl_text": model_backends.SDXL_MODEL,
                },
            }
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@bp.route("/datasets", methods=["GET", "POST"])
def datasets_route():
    if request.method == "GET":
        return jsonify(datasets.list_datasets())

    # Frontent makes initial POST request when creating new dataset
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
    try:
        meta["image_roundtrip"] = image_roundtrip.artifact_status(dataset_id)
    except Exception:
        meta["image_roundtrip"] = None
    try:
        meta["cluster_previews"] = cluster_previews.status(dataset_id)
    except Exception:
        meta["cluster_previews"] = None

    job = runtime.get_job_manager().get_state(dataset_id)
    if job:
        meta["job"] = job

    return jsonify(meta)


@bp.route("/datasets/<dataset_id>", methods=["DELETE"])
def delete_dataset(dataset_id: str):
    if not datasets.is_safe_dataset_id(dataset_id):
        return jsonify({"error": "Invalid dataset_id"}), 400

    try:
        meta = datasets.mark_dataset_deleted(dataset_id)
    except FileNotFoundError:
        return jsonify({"error": "Dataset not found"}), 404

    runtime.get_context_cache().invalidate(dataset_id)
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
    """ Backend recieves a .zip file from frontend. We validate the data recieved

    Args:
        dataset_id (str): ID of dataset to upload

    Returns:
        _type_: _description_
    """

    # Check valid ID
    if not datasets.is_safe_dataset_id(dataset_id):
        return jsonify({"error": "Invalid dataset_id"}), 400

    # Read from local .json config
    try:
        meta = datasets.read_dataset_json(dataset_id)
    except FileNotFoundError:
        return jsonify({"error": "Dataset not found"}), 404

    # Try to send an already processed file
    if meta.get("status") != "created":
        return jsonify({"error": "Dataset is immutable and already uploaded/processed"}), 409

    # We either sent an empty .zip or something went wrong in transfer
    if "file" not in request.files:
        return jsonify({"error": "Missing 'file' field"}), 400

    # This contains the .zip file
    file = request.files["file"]

    # Extra zip contents to original/ folder 
    try:
        extracted = datasets.extract_zip_to_originals(dataset_id, file.stream)
    except ValueError:
        return jsonify({"error": "Could not read zip"}), 400

    if extracted == 0:
        return jsonify({"error": "Zip contained no supported image files"}), 400

    # Update status created -> uploaded
    meta["status"] = "uploaded"
    datasets.write_dataset_json(dataset_id, meta)

    # Start image pre-processing job in separate thread
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


@bp.route("/datasets/<dataset_id>/image-roundtrip/status", methods=["GET"])
def image_roundtrip_status(dataset_id: str):
    if not datasets.is_safe_dataset_id(dataset_id):
        return jsonify({"error": "Invalid dataset_id"}), 400

    try:
        meta = datasets.read_dataset_json(dataset_id)
    except FileNotFoundError:
        return jsonify({"error": "Dataset not found"}), 404

    if meta.get("status") != "ready":
        return jsonify({"error": "Dataset is not ready"}), 409

    return jsonify(image_roundtrip.artifact_status(dataset_id))


@bp.route("/datasets/<dataset_id>/image-roundtrip/generate", methods=["POST"])
def generate_image_roundtrip(dataset_id: str):
    if not datasets.is_safe_dataset_id(dataset_id):
        return jsonify({"error": "Invalid dataset_id"}), 400

    try:
        meta = datasets.read_dataset_json(dataset_id)
    except FileNotFoundError:
        return jsonify({"error": "Dataset not found"}), 404

    if meta.get("status") != "ready":
        return jsonify({"error": "Dataset is not ready"}), 409

    job_state = runtime.get_job_manager().get_state(dataset_id)
    active_stages = {
        "queued",
        "thumbnails",
        "indexing",
        "embeddings",
        "atlas",
        "image-roundtrip",
        "cluster-previews",
    }
    if job_state.get("stage") in active_stages:
        return jsonify({"error": "Processing already running"}), 409

    status = image_roundtrip.artifact_status(dataset_id)
    if status.get("missing", 0) <= 0:
        return jsonify({"error": "Image roundtrip artifacts already exist"}), 409

    payload = request.get_json(silent=True) or {}
    options = {
        "max_new_tokens": int(payload.get("caption_tokens") or 160),
    }
    image_roundtrip.submit(dataset_id, **options)

    return jsonify({"status": "queued", "image_roundtrip": status}), 202


@bp.route("/datasets/<dataset_id>/image-roundtrip/<artifact_group>", methods=["DELETE"])
def clear_image_roundtrip_artifacts(dataset_id: str, artifact_group: str):
    if not datasets.is_safe_dataset_id(dataset_id):
        return jsonify({"error": "Invalid dataset_id"}), 400

    try:
        meta = datasets.read_dataset_json(dataset_id)
    except FileNotFoundError:
        return jsonify({"error": "Dataset not found"}), 404

    if meta.get("status") != "ready":
        return jsonify({"error": "Dataset is not ready"}), 409

    job_state = runtime.get_job_manager().get_state(dataset_id)
    if job_state.get("stage") == "image-roundtrip":
        return jsonify({"error": "Image metadata generation is running"}), 409

    try:
        result = image_roundtrip.clear_artifacts(dataset_id, artifact_group)
    except ValueError:
        return jsonify({"error": "Invalid artifact group"}), 400

    return jsonify(result)


@bp.route("/datasets/<dataset_id>/cluster-previews/status", methods=["GET"])
def cluster_preview_status(dataset_id: str):
    if not datasets.is_safe_dataset_id(dataset_id):
        return jsonify({"error": "Invalid dataset_id"}), 400

    try:
        meta = datasets.read_dataset_json(dataset_id)
    except FileNotFoundError:
        return jsonify({"error": "Dataset not found"}), 404

    if meta.get("status") != "ready":
        return jsonify({"error": "Dataset is not ready"}), 409

    return jsonify(cluster_previews.status(dataset_id))


@bp.route("/datasets/<dataset_id>/cluster-previews/generate", methods=["POST"])
def generate_cluster_previews(dataset_id: str):
    if not datasets.is_safe_dataset_id(dataset_id):
        return jsonify({"error": "Invalid dataset_id"}), 400

    try:
        meta = datasets.read_dataset_json(dataset_id)
    except FileNotFoundError:
        return jsonify({"error": "Dataset not found"}), 404

    if meta.get("status") != "ready":
        return jsonify({"error": "Dataset is not ready"}), 409

    job_state = runtime.get_job_manager().get_state(dataset_id)
    active_stages = {
        "queued",
        "thumbnails",
        "indexing",
        "embeddings",
        "atlas",
        "image-roundtrip",
        "cluster-previews",
    }
    if job_state.get("stage") in active_stages:
        return jsonify({"error": "Processing already running"}), 409

    payload = request.get_json(silent=True) or {}
    try:
        levels = int(payload.get("levels") or cluster_previews.DEFAULT_LEVELS)
        size = int(payload.get("size") or 512)
        clustering_config = ClusteringConfig.from_dict(payload.get("clustering"))
    except (TypeError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400

    cluster_previews.submit(
        dataset_id,
        levels=levels,
        size=size,
        clustering_config=clustering_config,
    )
    return jsonify({"status": "queued", "cluster_previews": cluster_previews.status(dataset_id)}), 202


@bp.route("/datasets/<dataset_id>/cluster-previews", methods=["DELETE"])
def clear_cluster_previews(dataset_id: str):
    if not datasets.is_safe_dataset_id(dataset_id):
        return jsonify({"error": "Invalid dataset_id"}), 400

    try:
        meta = datasets.read_dataset_json(dataset_id)
    except FileNotFoundError:
        return jsonify({"error": "Dataset not found"}), 404

    if meta.get("status") != "ready":
        return jsonify({"error": "Dataset is not ready"}), 409

    job_state = runtime.get_job_manager().get_state(dataset_id)
    if job_state.get("stage") == "cluster-previews":
        return jsonify({"error": "Cluster preview baking is running"}), 409

    return jsonify(cluster_previews.clear(dataset_id))


@bp.route("/datasets/<dataset_id>/cluster-previews/manifest", methods=["GET"])
def cluster_preview_manifest(dataset_id: str):
    if not datasets.is_safe_dataset_id(dataset_id):
        return jsonify({"error": "Invalid dataset_id"}), 400

    try:
        return jsonify(cluster_previews.load_manifest(dataset_id))
    except FileNotFoundError:
        return jsonify({"error": "Cluster previews have not been baked"}), 404


@bp.route("/datasets/<dataset_id>/cluster-previews/images/<filename>", methods=["GET"])
def cluster_preview_image(dataset_id: str, filename: str):
    if not datasets.is_safe_dataset_id(dataset_id):
        return jsonify({"error": "Invalid dataset_id"}), 400
    if not re.fullmatch(r"[0-9_]+\.png", filename):
        return jsonify({"error": "Invalid cluster image"}), 400

    try:
        path = cluster_previews.image_file(dataset_id, filename[:-4])
    except FileNotFoundError:
        return jsonify({"error": "Cluster preview image not found"}), 404

    return send_file(path, mimetype="image/png")
