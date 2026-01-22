from __future__ import annotations

from flask import Blueprint, jsonify, request

from api import sao_terms

bp = Blueprint("terms", __name__)


@bp.route("/terms/sao", methods=["GET"])
def sao_terms_search():
    query = (request.args.get("q") or "").strip()
    if not query:
        return jsonify([])

    try:
        limit = int(request.args.get("limit", 50))
    except ValueError:
        return jsonify({"error": "'limit' must be an integer"}), 400

    limit = max(1, min(limit, 200))
    include_scope = request.args.get("include_scope", "0") == "1"

    try:
        results = sao_terms.search_terms(query, limit=limit, include_scope=include_scope)
    except FileNotFoundError:
        return jsonify({"error": "sao_terms.csv not found"}), 404

    return jsonify(results)


@bp.route("/terms/sao/umap", methods=["GET"])
def sao_terms_umap():
    try:
        limit = int(request.args.get("limit", 0))
    except ValueError:
        return jsonify({"error": "'limit' must be an integer"}), 400

    try:
        n_neighbors = int(request.args.get("n_neighbors", 15))
    except ValueError:
        return jsonify({"error": "'n_neighbors' must be an integer"}), 400

    try:
        min_dist = float(request.args.get("min_dist", 0.1))
    except ValueError:
        return jsonify({"error": "'min_dist' must be a float"}), 400

    try:
        seed = int(request.args.get("seed", 42))
    except ValueError:
        return jsonify({"error": "'seed' must be an integer"}), 400

    try:
        points = sao_terms.get_umap_points(
            n_neighbors=n_neighbors, min_dist=min_dist, seed=seed
        )
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500

    terms, _ = sao_terms.get_terms()
    total = len(terms)
    n = total if limit <= 0 else min(limit, total)

    data = [
        {"id": terms[i]["id"], "label": terms[i]["label"], "point": points[i].tolist()}
        for i in range(n)
    ]
    return jsonify({"total": total, "items": data})
