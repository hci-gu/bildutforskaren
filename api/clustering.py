from __future__ import annotations

import numpy as np
from flask import Blueprint, jsonify, request
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score


bp = Blueprint("clustering", __name__)


# get 2D array (n,p) and perform clustering
def fit_model(X: np.ndarray):
    X = np.asarray(X)
    if X.ndim != 2:
        raise ValueError("X must be a 2D array")

    n_samples = X.shape[0]
    if n_samples == 0:
        raise ValueError("No samples given for X matrix")
    if n_samples < 3:
        return [[index] for index in range(n_samples)]

    best_labels = None
    best_score = -1.0
    max_k = min(9, n_samples - 1)

    for k in range(2, max_k + 1):
        knn_model = KMeans(
            n_clusters=k,
            random_state=1999,
            init="k-means++",
            n_init="auto",
        )
        labels = knn_model.fit_predict(X)
        if len(np.unique(labels)) < 2:
            continue

        score = silhouette_score(X, labels)
        if score > best_score:
            best_score = score
            best_labels = labels

    if best_labels is None:
        return [list(range(n_samples))]

    return [
        np.where(best_labels == cluster_index)[0].tolist()
        for cluster_index in sorted(np.unique(best_labels))
    ]


@bp.route("/clustering", methods=["POST"])
def clustering_route():
    payload = request.get_json(silent=True) or {}
    if "X" not in payload:
        return jsonify({"error": "Missing 'X'"}), 400

    try:
        clusters = fit_model(np.asarray(payload["X"], dtype=float))
    except (TypeError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify(clusters)
