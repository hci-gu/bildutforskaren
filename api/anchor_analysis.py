from __future__ import annotations

from dataclasses import dataclass
import heapq
import math
from typing import Any, Iterable

import numpy as np

try:
    import faiss  # type: ignore
except Exception:  # pragma: no cover - exercised on installations without FAISS
    faiss = None


EPSILON = 1e-8
ANTIPODAL_EPSILON = 1e-4


@dataclass(frozen=True)
class AnchorAnalysisParameters:
    path_steps: int = 11
    retrieval_count: int = 5
    graph_k: int = 10


def _normalize_rows(vectors: np.ndarray) -> np.ndarray:
    arr = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    return arr / np.maximum(norms, EPSILON)


def _group_summary(
    vectors: np.ndarray,
    member_ids: list[int],
) -> tuple[dict[str, Any], np.ndarray]:
    member_vectors = vectors[member_ids]
    mean = member_vectors.mean(axis=0)
    coherence = float(np.linalg.norm(mean))
    if coherence <= EPSILON:
        raise ValueError("An anchor group has a degenerate centroid")
    centroid = mean / coherence
    similarities = member_vectors @ centroid
    medoid_offset = min(
        range(len(member_ids)),
        key=lambda index: (-float(similarities[index]), member_ids[index]),
    )
    summary = {
        "ids": member_ids,
        "size": len(member_ids),
        "coherence": coherence,
        "medoid_id": member_ids[medoid_offset],
    }
    return summary, centroid.astype(np.float32, copy=False)


def _point_metrics(
    vectors: np.ndarray,
    candidate_ids: list[int],
    centroid_a: np.ndarray,
    centroid_b: np.ndarray,
) -> tuple[list[dict[str, Any]], dict[int, dict[str, Any]]]:
    candidate_vectors = vectors[candidate_ids]
    direction = centroid_b - centroid_a
    denominator = float(direction @ direction)
    if denominator <= EPSILON:
        raise ValueError("Anchor centroids are too similar to define an axis")

    sim_a = candidate_vectors @ centroid_a
    sim_b = candidate_vectors @ centroid_b
    raw_t = ((candidate_vectors - centroid_a) @ direction) / denominator
    clipped_t = np.clip(raw_t, 0.0, 1.0)
    line_projection = centroid_a + raw_t[:, None] * direction
    segment_projection = centroid_a + clipped_t[:, None] * direction
    line_residual = np.linalg.norm(candidate_vectors - line_projection, axis=1)
    segment_residual = np.linalg.norm(candidate_vectors - segment_projection, axis=1)

    points: list[dict[str, Any]] = []
    by_id: dict[int, dict[str, Any]] = {}
    for offset, image_id in enumerate(candidate_ids):
        point = {
            "image_id": image_id,
            "sim_a": float(sim_a[offset]),
            "sim_b": float(sim_b[offset]),
            "t": float(raw_t[offset]),
            "t_clipped": float(clipped_t[offset]),
            "line_residual": float(line_residual[offset]),
            "segment_residual": float(segment_residual[offset]),
            "contrast": float(sim_b[offset] - sim_a[offset]),
            "commonality": float((sim_a[offset] + sim_b[offset]) / 2.0),
        }
        points.append(point)
        by_id[image_id] = point
    return points, by_id


def _axis_path(
    point_by_id: dict[int, dict[str, Any]],
    anchor_a_ids: set[int],
    anchor_b_ids: set[int],
    medoid_a: int,
    medoid_b: int,
    path_steps: int,
) -> dict[str, Any]:
    interior_count = path_steps - 2
    bins: list[dict[str, Any]] = []
    representatives: list[int] = []
    excluded = anchor_a_ids | anchor_b_ids

    for index in range(interior_count):
        start = index / interior_count
        end = (index + 1) / interior_count
        candidates = [
            point
            for image_id, point in point_by_id.items()
            if image_id not in excluded
            and point["t"] >= start
            and (point["t"] < end or (index == interior_count - 1 and point["t"] <= end))
        ]
        representative = min(
            candidates,
            key=lambda point: (
                point["segment_residual"],
                abs(point["t"] - (start + end) / 2.0),
                point["image_id"],
            ),
            default=None,
        )
        image_id = representative["image_id"] if representative else None
        if image_id is not None:
            representatives.append(image_id)
        bins.append(
            {
                "index": index + 1,
                "t_start": float(start),
                "t_end": float(end),
                "image_id": image_id,
                "residual": (
                    float(representative["segment_residual"])
                    if representative
                    else None
                ),
            }
        )

    ordered = [medoid_a, *representatives, medoid_b]
    path_ids: list[int] = []
    for image_id in ordered:
        if not path_ids or path_ids[-1] != image_id:
            path_ids.append(image_id)
    return {"bins": bins, "path_ids": path_ids}


def _slerp(
    centroid_a: np.ndarray,
    centroid_b: np.ndarray,
    t: float,
    theta: float,
) -> np.ndarray:
    if theta < 1e-4:
        query = (1.0 - t) * centroid_a + t * centroid_b
        return query / max(float(np.linalg.norm(query)), EPSILON)
    sin_theta = math.sin(theta)
    query = (
        math.sin((1.0 - t) * theta) / sin_theta * centroid_a
        + math.sin(t * theta) / sin_theta * centroid_b
    )
    return query / max(float(np.linalg.norm(query)), EPSILON)


def _interpolation(
    vectors: np.ndarray,
    candidate_ids: list[int],
    anchor_a_ids: set[int],
    anchor_b_ids: set[int],
    centroid_a: np.ndarray,
    centroid_b: np.ndarray,
    medoid_a: int,
    medoid_b: int,
    parameters: AnchorAnalysisParameters,
) -> dict[str, Any]:
    centroid_similarity = float(
        np.clip(centroid_a @ centroid_b, -1.0, 1.0)
    )
    theta = math.acos(centroid_similarity)
    if math.pi - theta < ANTIPODAL_EPSILON:
        raise ValueError("Anchor centroids are nearly antipodal; SLERP is ambiguous")

    excluded = anchor_a_ids | anchor_b_ids
    interior_ids = [image_id for image_id in candidate_ids if image_id not in excluded]
    interior_vectors = vectors[interior_ids] if interior_ids else np.empty((0, vectors.shape[1]))
    steps: list[dict[str, Any]] = []
    selected_path: list[int] = []

    for index, t in enumerate(np.linspace(0.0, 1.0, parameters.path_steps)):
        query = _slerp(centroid_a, centroid_b, float(t), theta)
        if index == 0:
            retrievals = [
                {
                    "image_id": medoid_a,
                    "similarity": float(vectors[medoid_a] @ query),
                }
            ]
        elif index == parameters.path_steps - 1:
            retrievals = [
                {
                    "image_id": medoid_b,
                    "similarity": float(vectors[medoid_b] @ query),
                }
            ]
        elif not interior_ids:
            retrievals = []
        else:
            similarities = interior_vectors @ query
            ranked_offsets = sorted(
                range(len(interior_ids)),
                key=lambda offset: (-float(similarities[offset]), interior_ids[offset]),
            )[: parameters.retrieval_count]
            retrievals = [
                {
                    "image_id": interior_ids[offset],
                    "similarity": float(similarities[offset]),
                }
                for offset in ranked_offsets
            ]

        if retrievals:
            selected_id = int(retrievals[0]["image_id"])
            if not selected_path or selected_path[-1] != selected_id:
                selected_path.append(selected_id)
        steps.append(
            {
                "index": index,
                "t": float(t),
                "angle": float(theta * t),
                "retrievals": retrievals,
                "best_similarity": (
                    float(retrievals[0]["similarity"]) if retrievals else None
                ),
            }
        )

    return {
        "angle": float(theta),
        "steps": steps,
        "path_ids": selected_path,
    }


def _knn_offsets(vectors: np.ndarray, k: int) -> list[list[int]]:
    count = len(vectors)
    effective_k = min(k, max(0, count - 1))
    if effective_k == 0:
        return [[] for _ in range(count)]

    if faiss is not None:
        contiguous = np.ascontiguousarray(vectors, dtype=np.float32)
        index = faiss.IndexFlatIP(contiguous.shape[1])
        index.add(contiguous)
        similarities, offsets = index.search(contiguous, effective_k + 1)
        result: list[list[int]] = []
        for source, (row_similarities, row_offsets) in enumerate(
            zip(similarities, offsets)
        ):
            neighbors = [
                (int(offset), float(similarity))
                for offset, similarity in zip(row_offsets, row_similarities)
                if int(offset) != source and int(offset) >= 0
            ]
            neighbors.sort(key=lambda item: (-item[1], item[0]))
            result.append([offset for offset, _ in neighbors[:effective_k]])
        return result

    result: list[list[int]] = []
    block_size = 512
    for start in range(0, count, block_size):
        similarities = vectors[start : start + block_size] @ vectors.T
        for local_index, row in enumerate(similarities):
            source = start + local_index
            row[source] = -np.inf
            if effective_k < count - 1:
                offsets = np.argpartition(row, -effective_k)[-effective_k:]
            else:
                offsets = np.arange(count)
                offsets = offsets[offsets != source]
            ranked = sorted(offsets.tolist(), key=lambda offset: (-float(row[offset]), offset))
            result.append(ranked[:effective_k])
    return result


def _mutual_graph(
    vectors: np.ndarray,
    candidate_ids: list[int],
    k: int,
) -> dict[int, list[tuple[int, float, float]]]:
    offsets = _knn_offsets(vectors, k)
    neighbor_sets = [set(row) for row in offsets]
    adjacency: dict[int, list[tuple[int, float, float]]] = {
        image_id: [] for image_id in candidate_ids
    }
    for source_offset, targets in enumerate(offsets):
        for target_offset in targets:
            if source_offset >= target_offset:
                continue
            if source_offset not in neighbor_sets[target_offset]:
                continue
            source_id = candidate_ids[source_offset]
            target_id = candidate_ids[target_offset]
            similarity = float(
                np.clip(vectors[source_offset] @ vectors[target_offset], -1.0, 1.0)
            )
            distance = float(math.acos(similarity))
            adjacency[source_id].append((target_id, distance, similarity))
            adjacency[target_id].append((source_id, distance, similarity))
    for neighbors in adjacency.values():
        neighbors.sort(key=lambda item: item[0])
    return adjacency


def _reconstruct_path(
    parent: dict[int, int | None],
    target: int,
) -> list[int]:
    result: list[int] = []
    current: int | None = target
    while current is not None:
        result.append(current)
        current = parent[current]
    result.reverse()
    return result


def _find_graph_path(
    adjacency: dict[int, list[tuple[int, float, float]]],
    source_ids: Iterable[int],
    target_ids: set[int],
    mode: str,
) -> list[int] | None:
    costs: dict[int, tuple[float, float, int]] = {}
    parent: dict[int, int | None] = {}
    heap: list[tuple[float, float, int, int]] = []

    for source_id in sorted(set(source_ids)):
        costs[source_id] = (0.0, 0.0, 0)
        parent[source_id] = None
        heapq.heappush(heap, (0.0, 0.0, 0, source_id))

    while heap:
        first, second, hops, node_id = heapq.heappop(heap)
        queued_cost = (first, second, hops)
        if costs.get(node_id) != queued_cost:
            continue
        if node_id in target_ids:
            return _reconstruct_path(parent, node_id)

        for neighbor_id, edge_distance, _ in adjacency.get(node_id, []):
            if mode == "shortest":
                next_cost = (first + edge_distance, 0.0, hops + 1)
            else:
                next_cost = (
                    max(first, edge_distance),
                    second + edge_distance,
                    hops + 1,
                )
            previous = costs.get(neighbor_id)
            if previous is None or next_cost < previous:
                costs[neighbor_id] = next_cost
                parent[neighbor_id] = node_id
                heapq.heappush(heap, (*next_cost, neighbor_id))
    return None


def _path_result(
    path: list[int] | None,
    adjacency: dict[int, list[tuple[int, float, float]]],
) -> dict[str, Any]:
    if not path:
        return {
            "connected": False,
            "path_ids": [],
            "edges": [],
            "total_length": None,
            "maximum_jump": None,
        }

    edges: list[dict[str, Any]] = []
    total = 0.0
    maximum = 0.0
    for source, target in zip(path, path[1:]):
        edge = next(item for item in adjacency[source] if item[0] == target)
        _, distance, similarity = edge
        total += distance
        maximum = max(maximum, distance)
        edges.append(
            {
                "source": source,
                "target": target,
                "distance": float(distance),
                "similarity": float(similarity),
            }
        )
    return {
        "connected": True,
        "path_ids": path,
        "edges": edges,
        "total_length": float(total),
        "maximum_jump": float(maximum),
    }


def _graph_paths(
    vectors: np.ndarray,
    candidate_ids: list[int],
    anchor_a_ids: set[int],
    anchor_b_ids: set[int],
    graph_k: int,
) -> dict[str, Any]:
    candidate_vectors = vectors[candidate_ids]
    adjacency = _mutual_graph(candidate_vectors, candidate_ids, graph_k)
    shortest = _find_graph_path(adjacency, anchor_a_ids, anchor_b_ids, "shortest")
    supported = _find_graph_path(adjacency, anchor_a_ids, anchor_b_ids, "supported")
    return {
        "k": min(graph_k, max(0, len(candidate_ids) - 1)),
        "shortest": _path_result(shortest, adjacency),
        "supported": _path_result(supported, adjacency),
    }


def analyze_anchor_paths(
    embeddings: np.ndarray,
    anchor_a_ids: list[int],
    anchor_b_ids: list[int],
    candidate_ids: list[int],
    parameters: AnchorAnalysisParameters,
) -> dict[str, Any]:
    vectors = _normalize_rows(embeddings)
    anchor_a_set = set(anchor_a_ids)
    anchor_b_set = set(anchor_b_ids)
    overlap = anchor_a_set & anchor_b_set
    if overlap:
        raise ValueError("Anchor groups A and B must be disjoint")

    summary_a, centroid_a = _group_summary(vectors, anchor_a_ids)
    summary_b, centroid_b = _group_summary(vectors, anchor_b_ids)
    centroid_similarity = float(
        np.clip(centroid_a @ centroid_b, -1.0, 1.0)
    )
    if 1.0 - centroid_similarity <= EPSILON:
        raise ValueError("Anchor centroids are too similar to define an axis")

    points, point_by_id = _point_metrics(
        vectors,
        candidate_ids,
        centroid_a,
        centroid_b,
    )
    summary_a["similarity_to_other"] = centroid_similarity
    summary_b["similarity_to_other"] = centroid_similarity

    axis = _axis_path(
        point_by_id,
        anchor_a_set,
        anchor_b_set,
        summary_a["medoid_id"],
        summary_b["medoid_id"],
        parameters.path_steps,
    )
    interpolation = _interpolation(
        vectors,
        candidate_ids,
        anchor_a_set,
        anchor_b_set,
        centroid_a,
        centroid_b,
        summary_a["medoid_id"],
        summary_b["medoid_id"],
        parameters,
    )
    graph = _graph_paths(
        vectors,
        candidate_ids,
        anchor_a_set,
        anchor_b_set,
        parameters.graph_k,
    )
    return {
        "anchors": {
            "a": summary_a,
            "b": summary_b,
            "similarity": centroid_similarity,
        },
        "points": points,
        "axis": axis,
        "interpolation": interpolation,
        "graph": graph,
        "parameters": {
            "path_steps": parameters.path_steps,
            "retrieval_count": parameters.retrieval_count,
            "graph_k": parameters.graph_k,
        },
    }
