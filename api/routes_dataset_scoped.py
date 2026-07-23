from __future__ import annotations

import logging
import math
import pickle

import io
import json
import re

import numpy as np
import torch
from flask import Blueprint, abort, jsonify, request, send_file
from PIL import Image

from api import atlas
from api import clip_service
from api import dataset_db
from api import datasets
from api import image_roundtrip
from api import indexing
from api.anchor_analysis import AnchorAnalysisParameters, analyze_anchor_paths
from api.graph_network import GraphNetworkParameters, build_graph_network
from api import context as context_builder
from api import runtime
from api.clustering import ClusteringConfig, fit_model


bp = Blueprint("dataset_scoped", __name__)

UMAP_CACHE_VERSION = 6

TAG_SUGGESTION_MIN_NEIGHBOR_SUPPORT = 2
TAG_SUGGESTION_MIN_NEIGHBOR_SIMILARITY = 0.25
TAG_SUGGESTION_SEMANTIC_STDDEV_THRESHOLD = 1.0
TAG_SUGGESTION_NEIGHBOR_WEIGHT = 0.6
TAG_SUGGESTION_SEMANTIC_WEIGHT = 0.4
TAG_SUGGESTION_MIN_PREVALENCE_WEIGHT = 0.25
TAG_SUGGESTION_POOL_MULTIPLIER = 10

_CLUSTER_DESCRIPTION_CANDIDATES = [
    "portraits",
    "people indoors",
    "people outdoors",
    "groups of people",
    "children",
    "buildings",
    "city streets",
    "interiors",
    "landscapes",
    "nature scenes",
    "water views",
    "vehicles",
    "objects",
    "documents",
    "artworks",
    "text and signs",
    "black and white photos",
    "color photos",
    "close-up details",
    "wide scenes",
]
_CLUSTER_DESCRIPTION_EMBEDDINGS: np.ndarray | None = None


def _get_context(dataset_id: str):
    try:
        meta = datasets.read_dataset_json(dataset_id)
    except FileNotFoundError:
        abort(404, description="Dataset not found")

    status = meta.get("status")
    if status != "ready":
        abort(409, description=f"Dataset not ready (status: {status})")

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


def _get_dataset_db(dataset_id: str):
    cfg = datasets.get_dataset_config(dataset_id)
    db_path = dataset_db.dataset_db_path(cfg.dataset_dir)
    if not db_path.exists():
        return None, cfg, db_path
    return dataset_db.connect_dataset_db(db_path), cfg, db_path


def _get_cluster_description_embeddings() -> np.ndarray:
    global _CLUSTER_DESCRIPTION_EMBEDDINGS
    if _CLUSTER_DESCRIPTION_EMBEDDINGS is None:
        prompts = [
            f"a photo of {description}"
            for description in _CLUSTER_DESCRIPTION_CANDIDATES
        ]
        _CLUSTER_DESCRIPTION_EMBEDDINGS = clip_service.embed_text(prompts)
    return _CLUSTER_DESCRIPTION_EMBEDDINGS


def _label_for_embedding(embedding: np.ndarray) -> dict:
    description_embeddings = _get_cluster_description_embeddings()
    query = embedding.astype("float32", copy=False)
    norm = max(1e-12, float(np.linalg.norm(query)))
    query = query / norm
    scores = description_embeddings @ query
    best_idx = int(np.argmax(scores))
    return {
        "label": _CLUSTER_DESCRIPTION_CANDIDATES[best_idx],
        "score": float(scores[best_idx]),
    }


def _require_image_id(conn, image_id: int):
    row = conn.execute("SELECT 1 FROM images WHERE id = ?", (image_id,)).fetchone()
    return row is not None


def _resolve_tag_ids_or_labels(conn, *, tag_ids: list[int] | None, labels: list[str] | None):
    resolved: set[int] = set()
    if tag_ids:
        rows = conn.execute(
            f"SELECT id FROM tags WHERE id IN ({','.join('?' for _ in tag_ids)})",
            tuple(tag_ids),
        ).fetchall()
        found = {int(r[0]) for r in rows}
        missing = sorted(set(tag_ids) - found)
        if missing:
            return None, missing
        resolved.update(found)

    if labels:
        cleaned = [lbl.strip() for lbl in labels if isinstance(lbl, str) and lbl.strip()]
        if cleaned:
            conn.executemany(
                "INSERT OR IGNORE INTO tags (label) VALUES (?)",
                [(lbl,) for lbl in cleaned],
            )
            rows = conn.execute(
                f"SELECT id FROM tags WHERE label IN ({','.join('?' for _ in cleaned)})",
                tuple(cleaned),
            ).fetchall()
            resolved.update(int(r[0]) for r in rows)

    return sorted(resolved), []


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


@bp.route("/datasets/<dataset_id>/metadata/<int:image_id>", methods=["GET"])
def get_metadata_for_image(dataset_id: str, image_id: int):
    ctx = _get_context(dataset_id)
    if 0 <= image_id < len(ctx.metadata):
        return jsonify(ctx.metadata[image_id])
    abort(404, description="Image ID not found")


@bp.route("/datasets/<dataset_id>/embedding/<int:image_id>", methods=["GET"])
def get_embedding(dataset_id: str, image_id: int):
    ctx = _get_context(dataset_id)
    if 0 <= image_id < len(ctx.embeddings):
        return jsonify(ctx.embeddings[image_id].tolist())
    abort(404, description="Image ID not found")


def _anchor_id_list(payload: dict, name: str) -> list[int]:
    value = payload.get(name)
    if not isinstance(value, list) or not value:
        raise ValueError(f"'{name}' must be a non-empty list of image IDs")
    if any(isinstance(item, bool) or not isinstance(item, int) for item in value):
        raise ValueError(f"'{name}' must contain only integer image IDs")
    return list(dict.fromkeys(value))


def _anchor_parameter(
    parameters: dict,
    name: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    value = parameters.get(name, default)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"'{name}' must be an integer")
    if not minimum <= value <= maximum:
        raise ValueError(f"'{name}' must be between {minimum} and {maximum}")
    return value


@bp.route("/datasets/<dataset_id>/anchor-analysis", methods=["POST"])
def create_anchor_analysis(dataset_id: str):
    ctx = _get_context(dataset_id)
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Expected a JSON object"}), 400

    try:
        anchor_a_ids = _anchor_id_list(payload, "anchor_a_ids")
        anchor_b_ids = _anchor_id_list(payload, "anchor_b_ids")
        if set(anchor_a_ids) & set(anchor_b_ids):
            raise ValueError("Anchor groups A and B must be disjoint")

        candidate_ids = _anchor_id_list(payload, "candidate_ids")
        candidate_ids = list(
            dict.fromkeys([*candidate_ids, *anchor_a_ids, *anchor_b_ids])
        )
        image_count = len(ctx.embeddings)
        all_ids = [*anchor_a_ids, *anchor_b_ids, *candidate_ids]
        if any(image_id < 0 or image_id >= image_count for image_id in all_ids):
            raise ValueError("One or more image IDs are out of range")

        raw_parameters = payload.get("parameters", {})
        if not isinstance(raw_parameters, dict):
            raise ValueError("'parameters' must be an object")
        parameters = AnchorAnalysisParameters(
            path_steps=_anchor_parameter(
                raw_parameters, "path_steps", 11, 5, 31
            ),
            retrieval_count=_anchor_parameter(
                raw_parameters, "retrieval_count", 5, 1, 20
            ),
            graph_k=_anchor_parameter(raw_parameters, "graph_k", 10, 2, 50),
        )
        result = analyze_anchor_paths(
            ctx.embeddings.cpu().numpy().astype("float32"),
            anchor_a_ids,
            anchor_b_ids,
            candidate_ids,
            parameters,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify({"dataset_id": dataset_id, **result})


def _graph_integer_parameter(payload: dict, name: str, default: int, minimum: int, maximum: int):
    value = payload.get(name, default)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"'{name}' must be an integer")
    if not minimum <= value <= maximum:
        raise ValueError(f"'{name}' must be between {minimum} and {maximum}")
    return value


def _graph_similarity_parameter(payload: dict) -> float:
    value = payload.get("min_similarity", 0.75)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("'min_similarity' must be a number")
    value = float(value)
    if not math.isfinite(value) or not 0.0 <= value <= 1.0:
        raise ValueError("'min_similarity' must be between 0 and 1")
    return value


@bp.route("/datasets/<dataset_id>/graph-network", methods=["POST"])
def create_graph_network(dataset_id: str):
    ctx = _get_context(dataset_id)
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Expected a JSON object"}), 400

    root_image_id = payload.get("root_image_id")
    if isinstance(root_image_id, bool) or not isinstance(root_image_id, int):
        return jsonify({"error": "'root_image_id' must be an integer"}), 400
    if not 0 <= root_image_id < len(ctx.embeddings):
        return jsonify({"error": "Root image ID not found"}), 404

    try:
        parameters = GraphNetworkParameters(
            max_depth=_graph_integer_parameter(payload, "max_depth", 3, 1, 5),
            neighbors_per_node=_graph_integer_parameter(
                payload, "neighbors_per_node", 4, 1, 10
            ),
            max_nodes=_graph_integer_parameter(payload, "max_nodes", 60, 2, 200),
            min_similarity=_graph_similarity_parameter(payload),
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    result = build_graph_network(
        ctx.embeddings.cpu().numpy().astype("float32"),
        ctx.faiss_index,
        root_image_id,
        parameters,
    )
    return jsonify({"dataset_id": dataset_id, **result})


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


@bp.route("/datasets/<dataset_id>/tags", methods=["GET", "POST"])
def tags_collection(dataset_id: str):
    conn, _, db_path = _get_dataset_db(dataset_id)
    if conn is None:
        return jsonify({"error": f"Dataset DB not found at {db_path}"}), 409

    try:
        if request.method == "GET":
            rows = conn.execute(
                """
                SELECT t.id, t.label, COUNT(it.image_id) AS count
                FROM tags t
                LEFT JOIN image_tags it ON t.id = it.tag_id
                GROUP BY t.id
                ORDER BY lower(t.label)
                """
            ).fetchall()
            return jsonify(
                [
                    {"id": int(r["id"]), "label": r["label"], "count": int(r["count"])}
                    for r in rows
                ]
            )

        data = request.get_json(silent=True) or {}
        label = (data.get("label") or "").strip()
        if not label:
            return jsonify({"error": "Missing 'label'"}), 400

        conn.execute("INSERT OR IGNORE INTO tags (label) VALUES (?)", (label,))
        row = conn.execute("SELECT id, label FROM tags WHERE label = ?", (label,)).fetchone()
        conn.commit()
        return jsonify({"id": int(row["id"]), "label": row["label"]}), 201
    finally:
        conn.close()


@bp.route("/datasets/<dataset_id>/tags/<int:tag_id>", methods=["DELETE"])
def delete_tag(dataset_id: str, tag_id: int):
    conn, _, db_path = _get_dataset_db(dataset_id)
    if conn is None:
        return jsonify({"error": f"Dataset DB not found at {db_path}"}), 409

    try:
        cur = conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        conn.commit()
        if cur.rowcount == 0:
            return jsonify({"error": "Tag not found"}), 404
        return ("", 204)
    finally:
        conn.close()


@bp.route("/datasets/<dataset_id>/images/<int:image_id>/tags", methods=["GET", "POST", "DELETE"])
def image_tags(dataset_id: str, image_id: int):
    conn, _, db_path = _get_dataset_db(dataset_id)
    if conn is None:
        return jsonify({"error": f"Dataset DB not found at {db_path}"}), 409

    try:
        if not _require_image_id(conn, image_id):
            return jsonify({"error": "Image ID not found"}), 404

        if request.method == "GET":
            rows = conn.execute(
                """
                SELECT t.id, t.label, it.source, it.created_at
                FROM image_tags it
                JOIN tags t ON t.id = it.tag_id
                WHERE it.image_id = ?
                ORDER BY lower(t.label)
                """,
                (image_id,),
            ).fetchall()
            return jsonify(
                [
                    {
                        "id": int(r["id"]),
                        "label": r["label"],
                        "source": r["source"],
                        "created_at": r["created_at"],
                    }
                    for r in rows
                ]
            )

        data = request.get_json(silent=True) or {}
        tag_ids = data.get("tag_ids")
        labels = data.get("labels")
        source = (data.get("source") or "manual").strip() or "manual"

        if tag_ids is not None and (
            not isinstance(tag_ids, list) or any(not isinstance(t, int) for t in tag_ids)
        ):
            return jsonify({"error": "'tag_ids' must be a list of integers"}), 400
        if labels is not None and (
            not isinstance(labels, list) or any(not isinstance(t, str) for t in labels)
        ):
            return jsonify({"error": "'labels' must be a list of strings"}), 400

        resolved, missing = _resolve_tag_ids_or_labels(conn, tag_ids=tag_ids or [], labels=labels or [])
        if missing:
            return jsonify({"error": "Unknown tag_ids", "missing": missing}), 400
        if not resolved:
            return jsonify({"error": "No tags provided"}), 400

        if request.method == "POST":
            conn.executemany(
                "INSERT OR IGNORE INTO image_tags (image_id, tag_id, source) VALUES (?, ?, ?)",
                [(image_id, tag_id, source) for tag_id in resolved],
            )
            conn.commit()
            return jsonify({"image_id": image_id, "tag_ids": resolved, "source": source}), 201

        # DELETE
        if source.lower() == "any":
            conn.executemany(
                "DELETE FROM image_tags WHERE image_id = ? AND tag_id = ?",
                [(image_id, tag_id) for tag_id in resolved],
            )
        else:
            conn.executemany(
                "DELETE FROM image_tags WHERE image_id = ? AND tag_id = ? AND source = ?",
                [(image_id, tag_id, source) for tag_id in resolved],
            )
        conn.commit()
        return ("", 204)
    finally:
        conn.close()


@bp.route("/datasets/<dataset_id>/images/<int:image_id>/tag-suggestions", methods=["GET"])
def tag_suggestions(dataset_id: str, image_id: int):
    conn, _, db_path = _get_dataset_db(dataset_id)
    if conn is None:
        return jsonify({"error": f"Dataset DB not found at {db_path}"}), 409

    ctx = _get_context(dataset_id)
    if not (0 <= image_id < len(ctx.embeddings)):
        conn.close()
        return jsonify({"error": "Image ID not found"}), 404

    try:
        try:
            limit = int(request.args.get("limit", 3))
        except ValueError:
            return jsonify({"error": "'limit' must be an integer"}), 400
        limit = max(1, min(limit, 20))
        try:
            k = int(request.args.get("k", 25))
        except ValueError:
            return jsonify({"error": "'k' must be an integer"}), 400
        k = max(1, min(k, 200))

        from api import sao_terms

        rows = conn.execute(
            """
            SELECT t.label
            FROM image_tags it
            JOIN tags t ON t.id = it.tag_id
            WHERE it.image_id = ?
            """,
            (image_id,),
        ).fetchall()
        existing = {
            sao_terms.normalize_label(r["label"])
            for r in rows
            if r["label"]
        }

        # Propagate manually curated tags from visual neighbors. Evidence is
        # normalized by support and global prevalence so common tags do not win
        # merely because they occur often.
        neighbor_evidence: dict[str, dict] = {}
        q = ctx.embeddings[image_id].cpu().numpy().astype("float32")
        q = q.reshape(1, -1)
        D, I = ctx.faiss_index.search(q, min(k + 1, len(ctx.embeddings)))
        neighbor_ids = [int(i) for i in I[0].tolist() if i != -1 and i != image_id]
        neighbor_ids = neighbor_ids[:k]

        if neighbor_ids:
            placeholder = ",".join("?" for _ in neighbor_ids)
            tag_rows = conn.execute(
                f"""
                SELECT DISTINCT it.image_id, t.label
                FROM image_tags it
                JOIN tags t ON t.id = it.tag_id
                WHERE it.source IN ('manual', 'legacy_xlsx') AND it.image_id IN ({placeholder})
                """,
                tuple(neighbor_ids),
            ).fetchall()
            id_to_dist = {int(i): float(d) for i, d in zip(I[0].tolist(), D[0].tolist()) if i != -1}

            for row in tag_rows:
                label = (row["label"] or "").strip()
                if not label:
                    continue
                label_key = sao_terms.normalize_label(label)
                if label_key in existing:
                    continue
                dist = id_to_dist.get(int(row["image_id"]), 2.0)
                sim = max(0.0, 1.0 - dist / 2.0)
                evidence = neighbor_evidence.setdefault(
                    label_key,
                    {
                        "label": label,
                        "max_similarity": 0.0,
                        "image_similarities": {},
                    },
                )
                neighbor_image_id = int(row["image_id"])
                evidence["image_similarities"][neighbor_image_id] = max(
                    sim,
                    evidence["image_similarities"].get(neighbor_image_id, 0.0),
                )
                evidence["max_similarity"] = max(evidence["max_similarity"], sim)

        frequency_rows = conn.execute(
            """
            SELECT t.label, COUNT(DISTINCT it.image_id) AS frequency
            FROM image_tags it
            JOIN tags t ON t.id = it.tag_id
            WHERE it.source IN ('manual', 'legacy_xlsx')
            GROUP BY t.id
            """
        ).fetchall()
        global_frequency: dict[str, int] = {}
        for row in frequency_rows:
            label_key = sao_terms.normalize_label(row["label"] or "")
            if label_key:
                global_frequency[label_key] = max(
                    global_frequency.get(label_key, 0), int(row["frequency"])
                )

        total_tagged_row = conn.execute(
            """
            SELECT COUNT(DISTINCT image_id) AS count
            FROM image_tags
            WHERE source IN ('manual', 'legacy_xlsx')
            """
        ).fetchone()
        total_tagged = int(total_tagged_row["count"]) if total_tagged_row else 0

        neighbor_candidates: list[dict] = []
        for label_key, evidence in neighbor_evidence.items():
            similarities = evidence["image_similarities"].values()
            support = len(evidence["image_similarities"])
            max_similarity = float(evidence["max_similarity"])
            if support < TAG_SUGGESTION_MIN_NEIGHBOR_SUPPORT:
                continue
            if max_similarity < TAG_SUGGESTION_MIN_NEIGHBOR_SIMILARITY:
                continue

            average_similarity = sum(similarities) / support
            frequency = max(support, global_frequency.get(label_key, support))
            if total_tagged > 1:
                inverse_frequency = math.log(
                    (total_tagged + 1) / (frequency + 1)
                ) / math.log(total_tagged + 1)
            else:
                inverse_frequency = 0.0
            prevalence_weight = TAG_SUGGESTION_MIN_PREVALENCE_WEIGHT + (
                1.0 - TAG_SUGGESTION_MIN_PREVALENCE_WEIGHT
            ) * max(0.0, min(1.0, inverse_frequency))
            support_confidence = support / (support + 2.0)
            raw_score = average_similarity * support_confidence * prevalence_weight
            neighbor_candidates.append(
                {
                    "key": label_key,
                    "label": evidence["label"],
                    "raw_score": raw_score,
                    "support": support,
                    "frequency": frequency,
                }
            )

        neighbor_candidates.sort(
            key=lambda item: (-item["raw_score"], item["label"].lower())
        )

        # Score SAO on every request instead of using it only as a fallback. A
        # dataset-adaptive threshold suppresses terms that are not meaningfully
        # above the image's baseline similarity to the vocabulary.
        semantic_candidates: list[dict] = []
        embeddings, terms = sao_terms.get_embeddings()
        if embeddings.size:
            query = ctx.embeddings[image_id].cpu().numpy().astype("float32")
            query /= max(1e-12, float((query * query).sum()) ** 0.5)
            semantic_scores = embeddings @ query
            allowed_indices = np.array(
                [
                    i
                    for i, term in enumerate(terms)
                    if sao_terms.normalize_label(term["label"]) not in existing
                ],
                dtype=np.int64,
            )
            if allowed_indices.size:
                allowed_scores = semantic_scores[allowed_indices]
                semantic_threshold = float(
                    allowed_scores.mean()
                    + TAG_SUGGESTION_SEMANTIC_STDDEV_THRESHOLD
                    * allowed_scores.std()
                )
                confident_mask = allowed_scores >= semantic_threshold
                confident_indices = allowed_indices[confident_mask]
                pool_size = min(
                    max(limit * TAG_SUGGESTION_POOL_MULTIPLIER, 25),
                    len(confident_indices),
                )
                if pool_size:
                    confident_scores = semantic_scores[confident_indices]
                    top = np.argpartition(-confident_scores, pool_size - 1)[:pool_size]
                    top = top[np.argsort(-confident_scores[top])]
                    for position in top:
                        term_idx = int(confident_indices[int(position)])
                        term = terms[term_idx]
                        semantic_candidates.append(
                            {
                                "key": sao_terms.normalize_label(term["label"]),
                                "id": term["id"],
                                "label": term["label"],
                                "raw_score": float(semantic_scores[term_idx]),
                            }
                        )

        # Rank calibration makes the two score families comparable without
        # assuming that neighbor confidence and CLIP cosine have the same scale.
        candidates: dict[str, dict] = {}
        neighbor_pool_size = min(
            max(limit * TAG_SUGGESTION_POOL_MULTIPLIER, 25),
            len(neighbor_candidates),
        )
        for rank, item in enumerate(neighbor_candidates[:neighbor_pool_size]):
            candidate = candidates.setdefault(
                item["key"],
                {"id": None, "label": item["label"]},
            )
            candidate["neighbor_confidence"] = (
                neighbor_pool_size - rank
            ) / neighbor_pool_size
            candidate["neighbor_score"] = float(item["raw_score"])
            candidate["support"] = int(item["support"])
            candidate["frequency"] = int(item["frequency"])

        semantic_pool_size = len(semantic_candidates)
        for rank, item in enumerate(semantic_candidates):
            candidate = candidates.setdefault(
                item["key"],
                {"id": item["id"], "label": item["label"]},
            )
            candidate["id"] = item["id"]
            candidate["label"] = item["label"]
            candidate["semantic_confidence"] = (
                semantic_pool_size - rank
            ) / semantic_pool_size
            candidate["semantic_score"] = float(item["raw_score"])

        ranked: list[dict] = []
        for candidate in candidates.values():
            neighbor_confidence = float(candidate.get("neighbor_confidence", 0.0))
            semantic_confidence = float(candidate.get("semantic_confidence", 0.0))
            candidate["score"] = (
                TAG_SUGGESTION_NEIGHBOR_WEIGHT * neighbor_confidence
                + TAG_SUGGESTION_SEMANTIC_WEIGHT * semantic_confidence
            )
            if neighbor_confidence and semantic_confidence:
                candidate["source"] = "auto_hybrid"
            elif neighbor_confidence:
                candidate["source"] = "auto_neighbors"
            else:
                candidate["source"] = "auto_sao"
            candidate.pop("neighbor_confidence", None)
            candidate.pop("semantic_confidence", None)
            ranked.append(candidate)

        ranked.sort(key=lambda item: (-item["score"], item["label"].lower()))

        # When both sources have confident candidates, reserve a place for each
        # before filling the remaining slots by the blended score.
        selected: list[dict] = []
        selected_labels: set[str] = set()

        def add_best(source_field: str) -> None:
            for candidate in ranked:
                label_key = sao_terms.normalize_label(candidate["label"])
                if label_key in selected_labels or source_field not in candidate:
                    continue
                selected.append(candidate)
                selected_labels.add(label_key)
                return

        if limit >= 2 and neighbor_candidates and semantic_candidates:
            add_best("neighbor_score")
            add_best("semantic_score")

        for candidate in ranked:
            if len(selected) >= limit:
                break
            label_key = sao_terms.normalize_label(candidate["label"])
            if label_key in selected_labels:
                continue
            selected.append(candidate)
            selected_labels.add(label_key)

        selected.sort(key=lambda item: (-item["score"], item["label"].lower()))
        return jsonify(selected[:limit])
    finally:
        conn.close()


@bp.route("/datasets/<dataset_id>/images/<int:image_id>/sdxl-generation-status", methods=["GET"])
def sdxl_generation_status(dataset_id: str, image_id: int):
    try:
        return jsonify(image_roundtrip.image_embedding_status(dataset_id, image_id))
    except IndexError:
        return jsonify({"error": "Image ID not found"}), 404


@bp.route("/datasets/<dataset_id>/images/<int:image_id>/generate-from-sdxl-embedding", methods=["POST"])
def generate_from_sdxl_embedding(dataset_id: str, image_id: int):
    payload = request.get_json(silent=True) or {}
    try:
        image = image_roundtrip.generate_image_from_saved_embedding(
            dataset_id,
            image_id,
            steps=int(payload.get("steps") or 4),
            cfg=float(payload.get("cfg") if payload.get("cfg") is not None else 0.5),
            size=int(payload.get("size") or 512),
            seed=int(payload.get("seed") or 1),
        )
    except IndexError:
        return jsonify({"error": "Image ID not found"}), 404
    except FileNotFoundError:
        return jsonify({"error": "SDXL embedding not found"}), 404
    except Exception as exc:
        logging.exception("Failed to generate image for %s/%s", dataset_id, image_id)
        return jsonify({"error": str(exc)}), 500

    return send_file(io.BytesIO(image), mimetype="image/png")


@bp.route("/datasets/<dataset_id>/images/<int:image_id>/generate-from-ip-adapter-embedding", methods=["POST"])
def generate_from_ip_adapter_embedding(dataset_id: str, image_id: int):
    payload = request.get_json(silent=True) or {}
    try:
        image = image_roundtrip.generate_image_from_saved_ip_adapter_embedding(
            dataset_id,
            image_id,
            prompt=str(payload.get("prompt") or ""),
            negative_prompt=str(payload.get("negative_prompt") or ""),
            steps=int(payload.get("steps") or 4),
            cfg=float(payload.get("cfg") if payload.get("cfg") is not None else 0.0),
            size=int(payload.get("size") or 512),
            seed=int(payload.get("seed") or 1),
            adapter_scale=float(
                payload.get("adapter_scale")
                if payload.get("adapter_scale") is not None
                else 0.9
            ),
        )
    except IndexError:
        return jsonify({"error": "Image ID not found"}), 404
    except FileNotFoundError:
        return jsonify({"error": "IP-Adapter embedding not found"}), 404
    except Exception as exc:
        logging.exception("Failed to generate IP-Adapter image for %s/%s", dataset_id, image_id)
        return jsonify({"error": str(exc)}), 500

    return send_file(io.BytesIO(image), mimetype="image/png")


@bp.route("/datasets/<dataset_id>/sdxl-average-generation-status", methods=["POST"])
def sdxl_average_generation_status(dataset_id: str):
    payload = request.get_json(silent=True) or {}
    image_ids = _parse_image_ids(payload.get("image_ids")) or []
    try:
        return jsonify(image_roundtrip.average_embedding_status(dataset_id, image_ids))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except IndexError:
        return jsonify({"error": "Image ID not found"}), 404


@bp.route("/datasets/<dataset_id>/generate-from-average-sdxl-embedding", methods=["POST"])
def generate_from_average_sdxl_embedding(dataset_id: str):
    payload = request.get_json(silent=True) or {}
    image_ids = _parse_image_ids(payload.get("image_ids")) or []
    try:
        image = image_roundtrip.generate_image_from_average_embedding(
            dataset_id,
            image_ids,
            steps=int(payload.get("steps") or 4),
            cfg=float(payload.get("cfg") if payload.get("cfg") is not None else 0.5),
            size=int(payload.get("size") or 512),
            seed=int(payload.get("seed") or 1),
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except IndexError:
        return jsonify({"error": "Image ID not found"}), 404
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 404
    except Exception as exc:
        logging.exception("Failed to generate average image for %s", dataset_id)
        return jsonify({"error": str(exc)}), 500

    return send_file(io.BytesIO(image), mimetype="image/png")


@bp.route("/datasets/<dataset_id>/generate-from-average-ip-adapter-embedding", methods=["POST"])
def generate_from_average_ip_adapter_embedding(dataset_id: str):
    payload = request.get_json(silent=True) or {}
    image_ids = _parse_image_ids(payload.get("image_ids")) or []
    try:
        image = image_roundtrip.generate_image_from_average_ip_adapter_embedding(
            dataset_id,
            image_ids,
            prompt=str(payload.get("prompt") or ""),
            negative_prompt=str(payload.get("negative_prompt") or ""),
            steps=int(payload.get("steps") or 4),
            cfg=float(payload.get("cfg") if payload.get("cfg") is not None else 0.0),
            size=int(payload.get("size") or 512),
            seed=int(payload.get("seed") or 1),
            adapter_scale=float(
                payload.get("adapter_scale")
                if payload.get("adapter_scale") is not None
                else 0.9
            ),
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except IndexError:
        return jsonify({"error": "Image ID not found"}), 404
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 404
    except Exception as exc:
        logging.exception("Failed to generate average IP-Adapter image for %s", dataset_id)
        return jsonify({"error": str(exc)}), 500

    return send_file(io.BytesIO(image), mimetype="image/png")


@bp.route("/datasets/<dataset_id>/seed-tags-from-metadata", methods=["POST"])
def seed_tags_from_metadata(dataset_id: str):
    conn, cfg, db_path = _get_dataset_db(dataset_id)
    if conn is None:
        return jsonify({"error": f"Dataset DB not found at {db_path}"}), 409

    if cfg.metadata_source == "none" or not cfg.metadata_xlsx_file.exists():
        conn.close()
        return jsonify({"error": "metadata.xlsx not configured for this dataset"}), 409

    try:
        ctx = _get_context(dataset_id)
        result = context_builder.seed_metadata_keywords(cfg, ctx.metadata, ctx.image_paths)
        return jsonify({"status": "ok", **result})
    finally:
        conn.close()


@bp.route("/datasets/<dataset_id>/images", methods=["GET"])
def list_images(dataset_id: str):
    ctx = _get_context(dataset_id)
    return jsonify(list(range(len(ctx.image_paths))))


@bp.route("/datasets/<dataset_id>/tag-stats", methods=["GET"])
def tag_stats(dataset_id: str):
    conn, _, db_path = _get_dataset_db(dataset_id)
    if conn is None:
        return jsonify({"error": f"Dataset DB not found at {db_path}"}), 409

    try:
        total = conn.execute("SELECT COUNT(1) AS cnt FROM images").fetchone()
        tagged = conn.execute(
            "SELECT COUNT(DISTINCT image_id) AS cnt FROM image_tags"
        ).fetchone()
        total_count = int(total["cnt"]) if total else 0
        tagged_count = int(tagged["cnt"]) if tagged else 0
        percent = round((tagged_count / total_count) * 100, 2) if total_count else 0.0
        return jsonify(
            {
                "total_images": total_count,
                "tagged_images": tagged_count,
                "tagged_percent": percent,
            }
        )
    finally:
        conn.close()


@bp.route("/datasets/<dataset_id>/tagged-images", methods=["GET"])
def tagged_images(dataset_id: str):
    conn, _, db_path = _get_dataset_db(dataset_id)
    if conn is None:
        return jsonify({"error": f"Dataset DB not found at {db_path}"}), 409

    try:
        all_rows = conn.execute("SELECT id FROM images").fetchall()
        tagged_rows = conn.execute(
            "SELECT DISTINCT image_id AS id FROM image_tags"
        ).fetchall()
        all_ids = [int(r["id"]) for r in all_rows]
        tagged_set = {int(r["id"]) for r in tagged_rows}
        untagged = [i for i in all_ids if i not in tagged_set]
        tagged = [i for i in all_ids if i in tagged_set]
        return jsonify({"tagged": tagged, "untagged": untagged})
    finally:
        conn.close()


@bp.route("/datasets/<dataset_id>/tags/with-images", methods=["GET"])
def tags_with_images(dataset_id: str):
    conn, _, db_path = _get_dataset_db(dataset_id)
    if conn is None:
        return jsonify({"error": f"Dataset DB not found at {db_path}"}), 409

    try:
        rows = conn.execute(
            """
            SELECT t.id AS tag_id, t.label AS label, it.image_id AS image_id
            FROM tags t
            JOIN image_tags it ON t.id = it.tag_id
            ORDER BY lower(t.label)
            """
        ).fetchall()
        grouped: dict[int, dict] = {}
        for row in rows:
            tag_id = int(row["tag_id"])
            label = row["label"]
            image_id = int(row["image_id"])
            entry = grouped.get(tag_id)
            if entry is None:
                entry = {"tag_id": tag_id, "label": label, "image_ids": []}
                grouped[tag_id] = entry
            entry["image_ids"].append(image_id)
        return jsonify(list(grouped.values()))
    finally:
        conn.close()


@bp.route("/datasets/<dataset_id>/tags/images", methods=["GET"])
def images_for_tag(dataset_id: str):
    conn, _, db_path = _get_dataset_db(dataset_id)
    if conn is None:
        return jsonify({"error": f"Dataset DB not found at {db_path}"}), 409

    label = (request.args.get("label") or "").strip()
    tag_id_raw = request.args.get("tag_id")
    try:
        limit = int(request.args.get("limit", 48))
    except ValueError:
        limit = 48
    limit = max(1, min(limit, 500))

    try:
        tag_id = None
        if tag_id_raw is not None:
            try:
                tag_id = int(tag_id_raw)
            except ValueError:
                return jsonify({"error": "'tag_id' must be an integer"}), 400

        if tag_id is None and not label:
            return jsonify({"error": "Missing 'label' or 'tag_id'"}), 400

        if tag_id is None:
            resolved = _resolve_existing_tag_ids(conn, [label])
            if not resolved:
                return jsonify({"label": label, "tag_id": None, "image_ids": []})
            tag_id = int(resolved[0])

        rows = conn.execute(
            "SELECT image_id FROM image_tags WHERE tag_id = ? LIMIT ?",
            (tag_id, limit),
        ).fetchall()
        image_ids = [int(r["image_id"]) for r in rows]
        return jsonify({"label": label, "tag_id": tag_id, "image_ids": image_ids})
    finally:
        conn.close()


@bp.route("/datasets/<dataset_id>/tags/suggestions", methods=["GET"])
def suggested_images_for_tag(dataset_id: str):
    conn, _, db_path = _get_dataset_db(dataset_id)
    if conn is None:
        return jsonify({"error": f"Dataset DB not found at {db_path}"}), 409

    label = (request.args.get("label") or "").strip()
    tag_id_raw = request.args.get("tag_id")
    try:
        limit = int(request.args.get("limit", 48))
    except ValueError:
        limit = 48
    limit = max(1, min(limit, 500))

    try:
        tag_id = None
        if tag_id_raw is not None:
            try:
                tag_id = int(tag_id_raw)
            except ValueError:
                return jsonify({"error": "'tag_id' must be an integer"}), 400

        if tag_id is None and not label:
            return jsonify({"error": "Missing 'label' or 'tag_id'"}), 400

        if tag_id is None:
            resolved = _resolve_existing_tag_ids(conn, [label])
            if not resolved:
                return jsonify({"label": label, "tag_id": None, "image_ids": []})
            tag_id = int(resolved[0])

        tagged_rows = conn.execute(
            "SELECT image_id FROM image_tags WHERE tag_id = ?",
            (tag_id,),
        ).fetchall()
        tagged_ids = [int(r["image_id"]) for r in tagged_rows]
        if not tagged_ids:
            return jsonify({"label": label, "tag_id": tag_id, "image_ids": []})

        ctx = _get_context(dataset_id)
        tagged_vecs = ctx.embeddings[tagged_ids].cpu().numpy().astype("float32")
        mean_vec = tagged_vecs.mean(axis=0)
        norm = float((mean_vec * mean_vec).sum()) ** 0.5
        if norm > 1e-12:
            mean_vec = mean_vec / norm

        k = min(len(ctx.image_paths), max(limit * 5, limit))
        D, I = ctx.faiss_index.search(mean_vec.reshape(1, -1), k)

        tagged_set = set(tagged_ids)
        results: list[int] = []
        for idx in I[0].tolist():
            if idx == -1:
                continue
            if idx in tagged_set:
                continue
            results.append(int(idx))
            if len(results) >= limit:
                break

        return jsonify({"label": label, "tag_id": tag_id, "image_ids": results})
    finally:
        conn.close()


def _resolve_existing_tag_ids(conn, labels: list[str]) -> list[int]:
    if not labels:
        return []
    clean = [lbl.strip() for lbl in labels if isinstance(lbl, str) and lbl.strip()]
    if not clean:
        return []

    from api import sao_terms

    rows = conn.execute("SELECT id, label FROM tags").fetchall()
    norm_to_id = {}
    for row in rows:
        label = row["label"]
        if not label:
            continue
        norm = sao_terms.normalize_label(label)
        norm_to_id.setdefault(norm, int(row["id"]))

    resolved = []
    for lbl in clean:
        norm = sao_terms.normalize_label(lbl)
        tag_id = norm_to_id.get(norm)
        if tag_id is not None:
            resolved.append(tag_id)
    return resolved


@bp.route("/datasets/<dataset_id>/tags/images-multi", methods=["POST"])
def images_for_tags_multi(dataset_id: str):
    conn, _, db_path = _get_dataset_db(dataset_id)
    if conn is None:
        return jsonify({"error": f"Dataset DB not found at {db_path}"}), 409

    data = request.get_json(silent=True) or {}
    labels = data.get("labels") or []
    raw_limit = data.get("limit")
    if raw_limit is None:
        limit = None
    else:
        try:
            limit = int(raw_limit)
        except (TypeError, ValueError):
            limit = 48
        limit = max(1, min(limit, 1000))

    if not isinstance(labels, list) or any(not isinstance(l, str) for l in labels):
        conn.close()
        return jsonify({"error": "'labels' must be a list of strings"}), 400

    try:
        tag_ids = _resolve_existing_tag_ids(conn, labels)
        if not tag_ids:
            return jsonify({"labels": labels, "tag_ids": [], "image_ids": []})

        placeholders = ",".join("?" for _ in tag_ids)
        sql = f"""
            SELECT image_id
            FROM image_tags
            WHERE tag_id IN ({placeholders})
            GROUP BY image_id
            HAVING COUNT(DISTINCT tag_id) = ?
            """
        params = [*tag_ids, len(tag_ids)]
        if limit is not None:
            sql += " LIMIT ?"
            params.append(limit)
        rows = conn.execute(sql, tuple(params)).fetchall()
        image_ids = [int(r["image_id"]) for r in rows]
        return jsonify({"labels": labels, "tag_ids": tag_ids, "image_ids": image_ids})
    finally:
        conn.close()


@bp.route("/datasets/<dataset_id>/tags/suggestions-multi", methods=["POST"])
def suggested_images_for_tags_multi(dataset_id: str):
    conn, _, db_path = _get_dataset_db(dataset_id)
    if conn is None:
        return jsonify({"error": f"Dataset DB not found at {db_path}"}), 409

    data = request.get_json(silent=True) or {}
    labels = data.get("labels") or []
    try:
        limit = int(data.get("limit", 24))
    except (TypeError, ValueError):
        limit = 24
    limit = max(1, min(limit, 1000))

    if not isinstance(labels, list) or any(not isinstance(l, str) for l in labels):
        conn.close()
        return jsonify({"error": "'labels' must be a list of strings"}), 400

    try:
        tag_ids = _resolve_existing_tag_ids(conn, labels)
        if not tag_ids:
            return jsonify({"labels": labels, "tag_ids": [], "image_ids": []})

        placeholders = ",".join("?" for _ in tag_ids)
        rows = conn.execute(
            f"""
            SELECT image_id
            FROM image_tags
            WHERE tag_id IN ({placeholders})
            GROUP BY image_id
            HAVING COUNT(DISTINCT tag_id) = ?
            """,
            (*tag_ids, len(tag_ids)),
        ).fetchall()
        tagged_ids = [int(r["image_id"]) for r in rows]
        if not tagged_ids:
            return jsonify({"labels": labels, "tag_ids": tag_ids, "image_ids": []})

        ctx = _get_context(dataset_id)
        tagged_vecs = ctx.embeddings[tagged_ids].cpu().numpy().astype("float32")
        mean_vec = tagged_vecs.mean(axis=0)
        norm = float((mean_vec * mean_vec).sum()) ** 0.5
        if norm > 1e-12:
            mean_vec = mean_vec / norm

        k = min(len(ctx.image_paths), max(limit * 5, limit))
        D, I = ctx.faiss_index.search(mean_vec.reshape(1, -1), k)

        tagged_set = set(tagged_ids)
        results: list[int] = []
        for idx in I[0].tolist():
            if idx == -1:
                continue
            if idx in tagged_set:
                continue
            results.append(int(idx))
            if len(results) >= limit:
                break

        return jsonify({"labels": labels, "tag_ids": tag_ids, "image_ids": results})
    finally:
        conn.close()


@bp.route("/datasets/<dataset_id>/tags/suggestions-steered", methods=["POST"])
def suggested_images_for_tags_steered(dataset_id: str):
    conn, _, db_path = _get_dataset_db(dataset_id)
    if conn is None:
        return jsonify({"error": f"Dataset DB not found at {db_path}"}), 409

    data = request.get_json(silent=True) or {}
    labels = data.get("labels") or []
    seed_image_ids = data.get("seed_image_ids") or []
    blend_alpha = data.get("blend_alpha")
    try:
        limit = int(data.get("limit", 24))
    except (TypeError, ValueError):
        limit = 24
    limit = max(1, min(limit, 1000))

    if not isinstance(labels, list) or any(not isinstance(l, str) for l in labels):
        conn.close()
        return jsonify({"error": "'labels' must be a list of strings"}), 400
    if not isinstance(seed_image_ids, list) or any(
        not isinstance(i, int) for i in seed_image_ids
    ):
        conn.close()
        return jsonify({"error": "'seed_image_ids' must be a list of integers"}), 400

    try:
        tag_ids = _resolve_existing_tag_ids(conn, labels) if labels else []
        alpha: float | None = None
        if blend_alpha is not None:
            try:
                alpha = float(blend_alpha)
            except (TypeError, ValueError):
                alpha = None
        if alpha is not None:
            alpha = max(0.0, min(2.0, alpha))
        tagged_ids: list[int] = []
        if tag_ids:
            placeholders = ",".join("?" for _ in tag_ids)
            rows = conn.execute(
                f"""
                SELECT image_id
                FROM image_tags
                WHERE tag_id IN ({placeholders})
                GROUP BY image_id
                HAVING COUNT(DISTINCT tag_id) = ?
                """,
                (*tag_ids, len(tag_ids)),
            ).fetchall()
            tagged_ids = [int(r["image_id"]) for r in rows]
            if not tagged_ids and alpha is not None:
                rows = conn.execute(
                    f"""
                    SELECT DISTINCT image_id
                    FROM image_tags
                    WHERE tag_id IN ({placeholders})
                    """,
                    tuple(tag_ids),
                ).fetchall()
                tagged_ids = [int(r["image_id"]) for r in rows]

        ctx = _get_context(dataset_id)
        valid_seed_ids = [
            int(i)
            for i in seed_image_ids
            if 0 <= int(i) < len(ctx.embeddings)
        ]
        if not valid_seed_ids:
            return jsonify({"labels": labels, "tag_ids": tag_ids, "image_ids": []})

        seed_vecs = ctx.embeddings[valid_seed_ids].cpu().numpy().astype("float32")
        mean_vec = seed_vecs.mean(axis=0)

        if alpha is not None and tagged_ids:
            tagged_vecs = ctx.embeddings[tagged_ids].cpu().numpy().astype("float32")
            tagged_mean = tagged_vecs.mean(axis=0)
            mean_vec = (1 - alpha) * tagged_mean + alpha * mean_vec
        norm = float((mean_vec * mean_vec).sum()) ** 0.5
        if norm > 1e-12:
            mean_vec = mean_vec / norm

        k = min(len(ctx.image_paths), max(limit * 5, limit))
        D, I = ctx.faiss_index.search(mean_vec.reshape(1, -1), k)

        exclude = set(tagged_ids)
        exclude.update(valid_seed_ids)
        results: list[int] = []
        for idx in I[0].tolist():
            if idx == -1:
                continue
            if idx in exclude:
                continue
            results.append(int(idx))
            if len(results) >= limit:
                break

        return jsonify({"labels": labels, "tag_ids": tag_ids, "image_ids": results})
    finally:
        conn.close()


@bp.route("/datasets/<dataset_id>/tags/cooccurrence", methods=["POST"])
def tag_cooccurrence_for_selected(dataset_id: str):
    conn, _, db_path = _get_dataset_db(dataset_id)
    if conn is None:
        return jsonify({"error": f"Dataset DB not found at {db_path}"}), 409

    data = request.get_json(silent=True) or {}
    labels = data.get("labels") or []
    try:
        limit = int(data.get("limit", 20))
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 1000))

    if not isinstance(labels, list) or any(not isinstance(l, str) for l in labels):
        conn.close()
        return jsonify({"error": "'labels' must be a list of strings"}), 400

    try:
        tag_ids = _resolve_existing_tag_ids(conn, labels)
        if not tag_ids:
            return jsonify({"labels": labels, "items": []})

        placeholders = ",".join("?" for _ in tag_ids)
        image_rows = conn.execute(
            f"""
            SELECT image_id
            FROM image_tags
            WHERE tag_id IN ({placeholders})
            GROUP BY image_id
            HAVING COUNT(DISTINCT tag_id) = ?
            """,
            (*tag_ids, len(tag_ids)),
        ).fetchall()
        image_ids = [int(r["image_id"]) for r in image_rows]
        if not image_ids:
            return jsonify({"labels": labels, "items": []})

        image_placeholders = ",".join("?" for _ in image_ids)
        exclude_placeholders = ",".join("?" for _ in tag_ids)
        rows = conn.execute(
            f"""
            SELECT t.label AS label, COUNT(DISTINCT it.image_id) AS count
            FROM image_tags it
            JOIN tags t ON t.id = it.tag_id
            WHERE it.image_id IN ({image_placeholders})
              AND it.tag_id NOT IN ({exclude_placeholders})
            GROUP BY t.id
            ORDER BY count DESC, lower(t.label)
            LIMIT ?
            """,
            (*image_ids, *tag_ids, limit),
        ).fetchall()

        items = [
            {"label": row["label"], "count": int(row["count"])} for row in rows
        ]
        return jsonify({"labels": labels, "items": items})
    finally:
        conn.close()


@bp.route("/datasets/<dataset_id>/tags/assign", methods=["POST", "OPTIONS"])
def assign_tag_to_images(dataset_id: str):
    if request.method == "OPTIONS":
        return ("", 204)
    conn, _, db_path = _get_dataset_db(dataset_id)
    if conn is None:
        return jsonify({"error": f"Dataset DB not found at {db_path}"}), 409

    data = request.get_json(silent=True) or {}
    tag_id = data.get("tag_id")
    label = (data.get("label") or "").strip()
    labels = data.get("labels") or []
    image_ids = data.get("image_ids") or []
    source = (data.get("source") or "manual").strip() or "manual"

    if tag_id is None and not label and not labels:
        conn.close()
        return jsonify({"error": "Missing 'tag_id' or 'label'"}), 400
    if not isinstance(image_ids, list) or any(not isinstance(i, int) for i in image_ids):
        conn.close()
        return jsonify({"error": "'image_ids' must be a list of integers"}), 400

    try:
        if labels:
            tag_ids = _resolve_existing_tag_ids(conn, labels)
            if not tag_ids:
                return jsonify({"tag_ids": [], "assigned": 0})
        elif tag_id is None:
            conn.execute("INSERT OR IGNORE INTO tags (label) VALUES (?)", (label,))
            row = conn.execute(
                "SELECT id FROM tags WHERE lower(label) = lower(?)", (label,)
            ).fetchone()
            if not row:
                return jsonify({"error": "Could not resolve tag"}), 400
            tag_id = int(row["id"])
            tag_ids = [tag_id]
        else:
            tag_ids = [int(tag_id)]

        if not image_ids:
            return jsonify({"tag_ids": tag_ids, "assigned": 0})

        before = conn.total_changes
        for t_id in tag_ids:
            rows = [(img_id, t_id, source) for img_id in image_ids]
            conn.executemany(
                "INSERT OR IGNORE INTO image_tags (image_id, tag_id, source) VALUES (?, ?, ?)",
                rows,
            )
        after = conn.total_changes
        conn.commit()
        return jsonify({"tag_ids": tag_ids, "assigned": after - before})
    finally:
        conn.close()


@bp.route("/datasets/<dataset_id>/clustering", methods=["POST"])
def cluster_dataset_projection(dataset_id: str):
    ctx = _get_context(dataset_id)
    payload = request.get_json(silent=True) or {}
    if "X" not in payload:
        return jsonify({"error": "Missing 'X'"}), 400

    image_ids = payload.get("image_ids")
    if not isinstance(image_ids, list) or any(not isinstance(i, int) for i in image_ids):
        return jsonify({"error": "'image_ids' must be a list of integers"}), 400
    if any(i < 0 or i >= len(ctx.embeddings) for i in image_ids):
        return jsonify({"error": "One or more image_ids are out of range"}), 400

    try:
        points = np.asarray(payload["X"], dtype=float)
        clustering_config = ClusteringConfig.from_dict(payload.get("clustering"))
        clustering_result = fit_model(points, clustering_config)
    except (TypeError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400

    if points.shape[0] != len(image_ids):
        return jsonify({"error": "'X' and 'image_ids' must have the same length"}), 400

    embeddings = ctx.embeddings.cpu().numpy().astype("float32")
    for cluster in clustering_result.clusters:
        cluster_image_ids = [
            image_ids[index]
            for index in cluster.point_indices
            if 0 <= index < len(image_ids)
        ]
        if not cluster_image_ids:
            continue
        avg_embedding = embeddings[cluster_image_ids].mean(axis=0)
        label = _label_for_embedding(avg_embedding)
        cluster.label = label["label"]
        cluster.label_score = label["score"]

    return jsonify(clustering_result.to_dict())


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
            random_state=int(params.get("seed", 42)),
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
