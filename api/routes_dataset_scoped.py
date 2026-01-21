from __future__ import annotations

import logging
import pickle

import json
import re

import numpy as np
import torch
from flask import Blueprint, abort, jsonify, request, send_file
from PIL import Image

from api import atlas
from api import clip_service
from api import datasets
from api import indexing
from api import context as context_builder
from api import runtime


bp = Blueprint("dataset_scoped", __name__)

UMAP_CACHE_VERSION = 5


def _get_context(dataset_id: str):
    context_cache = runtime.get_context_cache()

    def _builder(ds_id: str):
        cfg = datasets.get_dataset_config(ds_id)
        return context_builder.build_context(cfg)

    return context_cache.get(dataset_id, _builder)


def _parse_image_ids(raw_ids):
    """Accept list, JSON string, or comma-separated string; return list[int] or None."""
    if raw_ids is None:
        return None

    try:
        if isinstance(raw_ids, str):
            raw_ids = raw_ids.strip()
            if not raw_ids:
                return None
            try:
                parsed = json.loads(raw_ids)
                if isinstance(parsed, list):
                    raw_ids = parsed
                else:
                    raw_ids = [parsed]
            except json.JSONDecodeError:
                raw_ids = [part for part in re.split(r"[\s,]+", raw_ids) if part]

        if isinstance(raw_ids, (list, tuple)):
            ids: list[int] = []
            for val in raw_ids:
                try:
                    ids.append(int(val))
                except (TypeError, ValueError):
                    continue
            return ids if ids else None

    except Exception:
        logging.exception("Failed to parse image_ids")
        return None

    return None


def _search_with_ids(ctx, query_vec: np.ndarray, k: int, image_ids: list[int] | None):
    if image_ids:
        valid_ids = [i for i in image_ids if isinstance(i, int) and 0 <= i < len(ctx.image_paths)]
        if not valid_ids:
            return []
        k = max(1, min(k, len(valid_ids)))
        subset = ctx.embeddings[valid_ids].cpu().numpy().astype("float32")
        q = query_vec.astype("float32").reshape(1, -1)
        diff = subset - q
        dists = np.sum(diff * diff, axis=1)
        order = np.argsort(dists)[:k]
        return [{"id": int(valid_ids[i]), "distance": float(dists[i])} for i in order]

    k = max(1, min(k, len(ctx.image_paths)))
    D, I = ctx.faiss_index.search(query_vec.reshape(1, -1), k)
    return [{"id": int(idx), "distance": float(dist)} for idx, dist in zip(I[0], D[0])]


def _save_umap_cache(cfg, cache: dict) -> None:
    try:
        cfg.umap_cache_file.parent.mkdir(parents=True, exist_ok=True)
        with cfg.umap_cache_file.open("wb") as fh:
            pickle.dump(cache, fh)
    except Exception as exc:
        logging.warning("Could not write UMAP cache: %s", exc)


@bp.route("/datasets/<dataset_id>/embeddings", methods=["GET"])
def get_embeddings(dataset_id: str):
    ctx = _get_context(dataset_id)
    full = request.args.get("full", "0") == "1"

    if full:
        embs = ctx.embeddings.numpy()
    else:
        embs = ctx.pca_embeddings_np

    return jsonify(
        [
            {
                "id": idx,
                "embedding": embs[idx].tolist(),
                "metadata": ctx.metadata[idx],
            }
            for idx in range(len(embs))
        ]
    )


@bp.route("/datasets/<dataset_id>/metadata", methods=["GET"])
def get_all_metadata(dataset_id: str):
    ctx = _get_context(dataset_id)
    return jsonify(ctx.metadata)


@bp.route("/datasets/<dataset_id>/embedding/<int:image_id>", methods=["GET"])
def get_embedding(dataset_id: str, image_id: int):
    ctx = _get_context(dataset_id)
    if 0 <= image_id < len(ctx.embeddings):
        return jsonify(ctx.embeddings[image_id].tolist())
    abort(404, description="Image ID not found")


@bp.route("/datasets/<dataset_id>/embedding-for-text", methods=["GET"])
def get_embedding_for_text(dataset_id: str):
    ctx = _get_context(dataset_id)

    query = request.args.get("query", "").strip()
    if not query:
        return jsonify({"error": "Missing 'query'"}), 400

    full = request.args.get("full", "0") == "1"
    txt_np = clip_service.embed_text([query]).astype("float32")

    if full:
        return jsonify(txt_np.reshape(-1).tolist())

    txt_pca = ctx.pca_model.transform(txt_np).astype("float32")
    return jsonify(txt_pca.reshape(-1).tolist())


@bp.route("/datasets/<dataset_id>/search", methods=["GET", "POST"])
def search(dataset_id: str):
    ctx = _get_context(dataset_id)
    top_k_default = 100

    if request.method == "GET":
        query = request.args.get("query", "").strip()
        try:
            k = int(request.args.get("top_k", top_k_default))
        except ValueError:
            return jsonify({"error": "'top_k' must be an integer"}), 400

        if not query:
            return jsonify({"error": "Missing 'query'"}), 400

        q = clip_service.embed_text([query]).reshape(1, -1)
        results = _search_with_ids(ctx, q, k, None)
        return jsonify(results)

    data = request.get_json(silent=True) or {}
    query = (data.get("query") or "").strip()
    try:
        k = int(data.get("top_k", top_k_default))
    except (TypeError, ValueError):
        return jsonify({"error": "'top_k' must be an integer"}), 400

    if not query:
        return jsonify({"error": "Missing 'query'"}), 400

    image_ids = _parse_image_ids(data.get("image_ids"))
    q = clip_service.embed_text([query]).reshape(1, -1)
    results = _search_with_ids(ctx, q, k, image_ids)
    return jsonify(results)


@bp.route("/datasets/<dataset_id>/search-by-image", methods=["POST"])
def search_by_image(dataset_id: str):
    ctx = _get_context(dataset_id)
    top_k_default = 100

    if "file" not in request.files:
        return jsonify({"error": "Missing 'file' field"}), 400

    file = request.files["file"]

    try:
        img = Image.open(file.stream).convert("RGB")
    except Exception:
        return jsonify({"error": "Could not read image"}), 400

    # Reuse CLIP processor directly
    model, processor, device = clip_service._load_clip()  # type: ignore[attr-defined]
    with torch.no_grad():
        inputs = processor(images=[img], return_tensors="pt").to(device)
        img_feat = model.get_image_features(**inputs)
        img_feat = img_feat / img_feat.norm(dim=-1, keepdim=True)

    if request.is_json:
        data = request.get_json(silent=True) or {}
        image_ids = _parse_image_ids(data.get("image_ids"))
        top_k_raw = data.get("top_k", top_k_default)
    else:
        image_ids = _parse_image_ids(request.form.get("image_ids"))
        top_k_raw = request.form.get("top_k", top_k_default)

    try:
        k = int(top_k_raw)
    except (TypeError, ValueError):
        return jsonify({"error": "'top_k' must be an integer"}), 400

    q = img_feat.cpu().numpy().astype("float32")
    results = _search_with_ids(ctx, q, k, image_ids)
    return jsonify(results)


@bp.route("/datasets/<dataset_id>/images", methods=["GET"])
def list_images(dataset_id: str):
    ctx = _get_context(dataset_id)
    return jsonify(list(range(len(ctx.image_paths))))


@bp.route("/datasets/<dataset_id>/umap", methods=["GET", "POST"])
def get_umap(dataset_id: str):
    ctx = _get_context(dataset_id)

    if request.method == "POST":
        payload = request.get_json(silent=True) or {}
        params = payload.get("params", {})

        texts = payload.get("texts", []) or []
        if not isinstance(texts, list) or any(not isinstance(t, str) for t in texts):
            return jsonify({"error": "'texts' must be a list of strings"}), 400
        texts = [t.strip() for t in texts if t.strip()]

        image_ids = payload.get("image_ids")
        if image_ids is None:
            image_ids = list(range(len(ctx.pca_embeddings_np)))
        if not isinstance(image_ids, list) or any(not isinstance(i, int) for i in image_ids):
            return jsonify({"error": "'image_ids' must be a list of integers"}), 400
        if any(i < 0 or i >= len(ctx.pca_embeddings_np) for i in image_ids):
            return jsonify({"error": "One or more image_ids are out of range"}), 400

        if not image_ids and not texts:
            return jsonify({"error": "No image_ids or texts provided"}), 400

        key = indexing.umap_cache_key(image_ids, texts, params, UMAP_CACHE_VERSION)
        if key in ctx.umap_cache:
            return jsonify(ctx.umap_cache[key])

        try:
            import umap  # type: ignore
        except Exception:
            return jsonify({"error": "UMAP dependency not available"}), 500

        reducer = umap.UMAP(
            n_neighbors=int(params.get("n_neighbors", 15)),
            min_dist=float(params.get("min_dist", 0.1)),
            n_components=int(params.get("n_components", 2)),
            spread=float(params.get("spread", 1.0)),
            metric="cosine",
            transform_seed=int(params.get("seed", 42)),
        )

        image_vectors = ctx.embeddings.numpy()[image_ids].astype("float32")
        image_vectors = indexing.l2_normalize_rows(image_vectors)

        image_points = reducer.fit_transform(image_vectors).tolist()

        text_points = []
        if texts:
            text_vectors_full = clip_service.embed_text(texts)
            image_points_np = np.array(image_points, dtype="float32")
            id_to_point = {img_id: image_points_np[i] for i, img_id in enumerate(image_ids)}
            allowed_ids = set(image_ids)

            k = max(1, min(int(params.get("text_k", 25)), len(image_ids)))

            for tvec in text_vectors_full:
                q = tvec.reshape(1, -1).astype("float32")
                D, I = ctx.faiss_index.search(q, k)
                hit_ids = [int(i) for i in I[0].tolist() if i != -1]

                if allowed_ids:
                    hit_ids = [i for i in hit_ids if i in allowed_ids]
                    if not hit_ids:
                        hit_ids = [int(i) for i in I[0].tolist() if i != -1]

                points = [id_to_point[i] for i in hit_ids if i in id_to_point]
                if not points:
                    text_points.append(image_points_np.mean(axis=0).tolist())
                else:
                    avg = np.mean(points, axis=0)
                    text_points.append(avg.tolist())

        response = {
            "image_ids": image_ids,
            "image_points": image_points,
            "text_points": text_points,
            "params": params,
        }

        ctx.umap_cache[key] = response
        _save_umap_cache(ctx.cfg, ctx.umap_cache)

        return jsonify(response)

    # GET legacy image-only UMAP
    params = request.args

    key = (
        UMAP_CACHE_VERSION,
        int(params.get("n_neighbors", 15)),
        float(params.get("min_dist", 0.1)),
        int(params.get("n_components", 2)),
        int(params.get("seed", 42)),
        float(params.get("spread", 1.0)),
    )

    if key in ctx.umap_cache:
        return jsonify(ctx.umap_cache[key])

    try:
        import umap  # type: ignore
    except Exception:
        return jsonify({"error": "UMAP dependency not available"}), 500

    reducer = umap.UMAP(
        n_neighbors=int(params.get("n_neighbors", 15)),
        min_dist=float(params.get("min_dist", 0.1)),
        n_components=int(params.get("n_components", 2)),
        spread=float(params.get("spread", 1.0)),
        metric="cosine",
        transform_seed=int(params.get("seed", 42)),
    )

    base_vectors = indexing.l2_normalize_rows(ctx.embeddings.numpy().astype("float32"))
    embedding = reducer.fit_transform(base_vectors).tolist()

    ctx.umap_cache[key] = embedding
    _save_umap_cache(ctx.cfg, ctx.umap_cache)

    return jsonify(embedding)


@bp.route("/datasets/<dataset_id>/image/<int:image_id>", methods=["GET"])
def serve_image(dataset_id: str, image_id: int):
    ctx = _get_context(dataset_id)
    if not (0 <= image_id < len(ctx.image_paths)):
        abort(404, description="Image ID not found")

    path = ctx.image_paths[image_id]
    if not path.exists():
        abort(404, description="Image not found")

    try:
        return send_file(path)
    except FileNotFoundError:
        abort(404, description="Image not found")


@bp.route("/datasets/<dataset_id>/original/<int:image_id>", methods=["GET"])
def serve_original(dataset_id: str, image_id: int):
    ctx = _get_context(dataset_id)
    if 0 <= image_id < len(ctx.image_paths):
        try:
            rel = ctx.image_paths[image_id].relative_to(ctx.cfg.thumb_root)
        except ValueError:
            abort(404, description="Mapping error")

        original = ctx.cfg.original_root / rel
        if original.exists():
            try:
                return send_file(original)
            except FileNotFoundError:
                pass
        abort(404, description="Original image not found")

    abort(404, description="Image ID not found")


@bp.route("/datasets/<dataset_id>/atlas/meta", methods=["GET"])
def atlas_meta(dataset_id: str):
    ctx = _get_context(dataset_id)
    meta = atlas.ensure_atlas(ctx.cfg, ctx.image_paths)
    return jsonify(meta)


@bp.route("/datasets/<dataset_id>/atlas/sheet/<int:sheet_id>.png", methods=["GET"])
def atlas_sheet(dataset_id: str, sheet_id: int):
    cfg = datasets.get_dataset_config(dataset_id)
    path = cfg.atlas_dir / f"atlas_{sheet_id}.png"

    if path.exists():
        try:
            return send_file(path)
        except FileNotFoundError:
            # Cache entry disappeared between exists() and send_file().
            pass

    ctx = _get_context(dataset_id)
    atlas.ensure_atlas(ctx.cfg, ctx.image_paths)

    if path.exists():
        try:
            return send_file(path)
        except FileNotFoundError:
            pass

    abort(404, description="Atlas sheet not found")
