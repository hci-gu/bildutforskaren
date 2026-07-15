from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

import numpy as np
from flask import Blueprint, jsonify, request
from sklearn.cluster import DBSCAN, HDBSCAN, KMeans
from sklearn.metrics import silhouette_score


bp = Blueprint("clustering", __name__)

ClusteringAlgorithm = Literal["kmeans", "dbscan", "hdbscan"]
SUPPORTED_ALGORITHMS: tuple[ClusteringAlgorithm, ...] = (
    "kmeans",
    "dbscan",
    "hdbscan",
)

_DEFAULT_PARAMETERS: dict[ClusteringAlgorithm, dict[str, Any]] = {
    "kmeans": {
        "max_clusters": 9,
        "random_state": 1999,
    },
    "dbscan": {
        "eps": 0.5,
        "min_samples": 5,
    },
    "hdbscan": {
        "min_cluster_size": 5,
        "min_samples": None,
        "cluster_selection_epsilon": 0.0,
        "allow_single_cluster": False,
    },
}


def _integer_parameter(name: str, value: Any, *, minimum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"'{name}' must be an integer greater than or equal to {minimum}")
    return value


def _number_parameter(
    name: str,
    value: Any,
    *,
    minimum: float,
    inclusive: bool,
) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        comparator = "greater than or equal to" if inclusive else "greater than"
        raise ValueError(f"'{name}' must be a number {comparator} {minimum}")
    numeric_value = float(value)
    valid = numeric_value >= minimum if inclusive else numeric_value > minimum
    if not np.isfinite(numeric_value) or not valid:
        comparator = "greater than or equal to" if inclusive else "greater than"
        raise ValueError(f"'{name}' must be a number {comparator} {minimum}")
    return numeric_value


def _validated_parameters(
    algorithm: ClusteringAlgorithm,
    raw_parameters: dict[str, Any],
) -> dict[str, Any]:
    parameters = dict(_DEFAULT_PARAMETERS[algorithm])
    unknown = set(raw_parameters) - set(parameters)
    if unknown:
        names = ", ".join(sorted(str(name) for name in unknown))
        raise ValueError(f"Unsupported {algorithm} parameter(s): {names}")
    parameters.update(raw_parameters)

    if algorithm == "kmeans":
        parameters["max_clusters"] = _integer_parameter(
            "max_clusters",
            parameters["max_clusters"],
            minimum=2,
        )
        parameters["random_state"] = _integer_parameter(
            "random_state",
            parameters["random_state"],
            minimum=0,
        )
    elif algorithm == "dbscan":
        parameters["eps"] = _number_parameter(
            "eps",
            parameters["eps"],
            minimum=0.0,
            inclusive=False,
        )
        parameters["min_samples"] = _integer_parameter(
            "min_samples",
            parameters["min_samples"],
            minimum=1,
        )
    else:
        parameters["min_cluster_size"] = _integer_parameter(
            "min_cluster_size",
            parameters["min_cluster_size"],
            minimum=2,
        )
        min_samples = parameters["min_samples"]
        if min_samples is not None:
            parameters["min_samples"] = _integer_parameter(
                "min_samples",
                min_samples,
                minimum=1,
            )
        parameters["cluster_selection_epsilon"] = _number_parameter(
            "cluster_selection_epsilon",
            parameters["cluster_selection_epsilon"],
            minimum=0.0,
            inclusive=True,
        )
        if not isinstance(parameters["allow_single_cluster"], bool):
            raise ValueError("'allow_single_cluster' must be a boolean")

    return parameters


@dataclass(frozen=True)
class ClusteringConfig:
    algorithm: ClusteringAlgorithm = "kmeans"
    parameters: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.algorithm not in SUPPORTED_ALGORITHMS:
            supported = ", ".join(SUPPORTED_ALGORITHMS)
            raise ValueError(
                f"Unsupported clustering algorithm. Expected one of: {supported}"
            )
        if not isinstance(self.parameters, dict):
            raise ValueError("Clustering 'parameters' must be an object")
        object.__setattr__(
            self,
            "parameters",
            _validated_parameters(self.algorithm, self.parameters),
        )

    @property
    def method(self) -> str:
        return "single_run" if self.algorithm == "hdbscan" else "recursive"

    @classmethod
    def from_dict(cls, data: Any = None) -> "ClusteringConfig":
        if data is None:
            return cls()
        if not isinstance(data, dict):
            raise ValueError("'clustering' must be an object")

        algorithm_value = data.get("algorithm", "kmeans")
        if not isinstance(algorithm_value, str):
            raise ValueError("Clustering algorithm must be a string")
        algorithm = algorithm_value.strip().lower()
        if algorithm not in SUPPORTED_ALGORITHMS:
            supported = ", ".join(SUPPORTED_ALGORITHMS)
            raise ValueError(f"Unsupported clustering algorithm. Expected one of: {supported}")

        raw_parameters = data.get("parameters", {})
        if raw_parameters is None:
            raw_parameters = {}
        if not isinstance(raw_parameters, dict):
            raise ValueError("Clustering 'parameters' must be an object")

        return cls(algorithm=algorithm, parameters=raw_parameters)

    def to_dict(self) -> dict[str, Any]:
        return {
            "algorithm": self.algorithm,
            "method": self.method,
            "feature_space": "umap_2d",
            "parameters": dict(self.parameters),
        }


@dataclass
class Cluster:
    centroid_position: list[float]
    num_points: int
    points: list[list[float]]
    point_indices: list[int]
    label: str | None = None
    label_score: float | None = None

    @classmethod
    def from_points(cls, points: np.ndarray, point_indices: np.ndarray) -> "Cluster":
        centroid = np.mean(points, axis=0)
        return cls(
            centroid_position=centroid.tolist(),
            num_points=int(points.shape[0]),
            points=points.tolist(),
            point_indices=[int(index) for index in point_indices.tolist()],
        )

    def to_dict(self) -> dict:
        data = {
            "centroid_position": self.centroid_position,
            "num_points": self.num_points,
            "points": self.points,
            "point_indices": self.point_indices,
        }
        if self.label is not None:
            data["label"] = self.label
            data["label_score"] = self.label_score
        return data


@dataclass
class ClusteringResult:
    config: ClusteringConfig
    clusters: list[Cluster]
    noise_indices: list[int] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "clustering": self.config.to_dict(),
            "clusters": [cluster.to_dict() for cluster in self.clusters],
            "ignored_noise_point_indices": self.noise_indices,
        }


def _fit_kmeans(X: np.ndarray, config: ClusteringConfig) -> np.ndarray:
    n_samples = X.shape[0]
    if n_samples < 3:
        return np.arange(n_samples, dtype=int)

    best_labels = None
    best_score = -1.0
    max_k = min(int(config.parameters["max_clusters"]), n_samples - 1)

    for k in range(2, max_k + 1):
        model = KMeans(
            n_clusters=k,
            random_state=int(config.parameters["random_state"]),
            init="k-means++",
            n_init="auto",
        )
        labels = model.fit_predict(X)
        if len(np.unique(labels)) < 2:
            continue

        score = silhouette_score(X, labels)
        if score > best_score:
            best_score = score
            best_labels = labels

    if best_labels is None:
        return np.zeros(n_samples, dtype=int)
    return best_labels


def _fit_dbscan(X: np.ndarray, config: ClusteringConfig) -> np.ndarray:
    model = DBSCAN(
        eps=float(config.parameters["eps"]),
        min_samples=int(config.parameters["min_samples"]),
    )
    return model.fit_predict(X)


def _fit_hdbscan(X: np.ndarray, config: ClusteringConfig) -> np.ndarray:
    min_cluster_size = int(config.parameters["min_cluster_size"])
    min_samples = config.parameters["min_samples"]
    required_samples = max(
        min_cluster_size,
        int(min_samples) if min_samples is not None else min_cluster_size,
    )
    if X.shape[0] < required_samples:
        return np.full(X.shape[0], -1, dtype=int)

    model = HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        cluster_selection_epsilon=float(
            config.parameters["cluster_selection_epsilon"]
        ),
        allow_single_cluster=bool(config.parameters["allow_single_cluster"]),
    )
    return model.fit_predict(X)


# Get a 2D array (n, p) and perform visual clustering.
def fit_model(
    X: np.ndarray,
    config: ClusteringConfig | None = None,
) -> ClusteringResult:
    X = np.asarray(X)
    if X.ndim != 2:
        raise ValueError("X must be a 2D array")
    if X.shape[1] != 2:
        raise ValueError("X must contain 2D UMAP points")
    if X.shape[0] == 0:
        raise ValueError("No samples given for X matrix")
    if not np.isfinite(X).all():
        raise ValueError("X must contain only finite values")

    effective_config = config or ClusteringConfig()
    if effective_config.algorithm == "kmeans":
        labels = _fit_kmeans(X, effective_config)
    elif effective_config.algorithm == "dbscan":
        labels = _fit_dbscan(X, effective_config)
    else:
        labels = _fit_hdbscan(X, effective_config)

    clusters = [
        Cluster.from_points(
            X[labels == cluster_label],
            np.where(labels == cluster_label)[0],
        )
        for cluster_label in sorted(
            int(label) for label in np.unique(labels) if label >= 0
        )
    ]
    noise_indices = [int(index) for index in np.where(labels == -1)[0].tolist()]
    return ClusteringResult(
        config=effective_config,
        clusters=clusters,
        noise_indices=noise_indices,
    )


@bp.route("/clustering", methods=["POST"])
def clustering_route():
    payload = request.get_json(silent=True) or {}
    if "X" not in payload:
        return jsonify({"error": "Missing 'X'"}), 400

    try:
        config = ClusteringConfig.from_dict(payload.get("clustering"))
        result = fit_model(np.asarray(payload["X"], dtype=float), config)
    except (TypeError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify(result.to_dict())
