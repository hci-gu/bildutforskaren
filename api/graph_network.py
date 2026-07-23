from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import math
from typing import Any

import networkx as nx
import numpy as np


LAYOUT_SEED = 42
CROSS_LINK_NEIGHBORS = 2


@dataclass(frozen=True)
class GraphNetworkParameters:
    max_depth: int = 3
    neighbors_per_node: int = 4
    max_nodes: int = 60
    min_similarity: float = 0.75


def _cosine_from_squared_l2(distance: float) -> float:
    return float(np.clip(1.0 - distance / 2.0, -1.0, 1.0))


def _normalize_force_layout(
    positions: dict[int, np.ndarray],
    root_id: int,
) -> dict[int, list[float]]:
    root = np.asarray(positions[root_id], dtype=np.float64)
    centered = {
        node_id: np.asarray(position, dtype=np.float64) - root
        for node_id, position in positions.items()
    }
    extent = max(
        (
            float(np.max(np.abs(position)))
            for position in centered.values()
        ),
        default=0.0,
    )
    scale = 0.45 / extent if extent > 1e-12 else 0.0
    normalized = {
        node_id: [
            float(np.clip(0.5 + position[0] * scale, 0.05, 0.95)),
            float(np.clip(0.5 + position[1] * scale, 0.05, 0.95)),
        ]
        for node_id, position in centered.items()
    }
    normalized[root_id] = [0.5, 0.5]
    return normalized


def _build_layouts(
    node_records: dict[int, dict[str, Any]],
    edges: list[dict[str, Any]],
    root_id: int,
) -> tuple[dict[int, list[float]], dict[int, list[float]]]:
    graph = nx.Graph()
    graph.add_nodes_from(node_records)
    graph.add_weighted_edges_from(
        (
            int(edge["source"]),
            int(edge["target"]),
            max(1e-6, float(edge["similarity"])),
        )
        for edge in edges
    )

    shells = [
        [
            node_id
            for node_id, record in node_records.items()
            if int(record["depth"]) == depth
        ]
        for depth in range(
            max(int(record["depth"]) for record in node_records.values()) + 1
        )
    ]
    initial = nx.shell_layout(graph, nlist=shells)
    initial[root_id] = np.array([0.0, 0.0], dtype=np.float64)
    force_raw = nx.spring_layout(
        graph,
        pos=initial,
        fixed=[root_id],
        weight="weight",
        seed=LAYOUT_SEED,
        iterations=100,
    )
    force = _normalize_force_layout(force_raw, root_id)

    max_depth = max(int(record["depth"]) for record in node_records.values())
    concentric: dict[int, list[float]] = {root_id: [0.5, 0.5]}
    for depth in range(1, max_depth + 1):
        shell_nodes = [
            node_id
            for node_id, record in node_records.items()
            if int(record["depth"]) == depth
        ]
        shell_nodes.sort(
            key=lambda node_id: (
                math.atan2(
                    force[node_id][1] - 0.5,
                    force[node_id][0] - 0.5,
                ),
                node_id,
            )
        )
        if not shell_nodes:
            continue
        radius = 0.45 * depth / max_depth
        first_angle = math.atan2(
            force[shell_nodes[0]][1] - 0.5,
            force[shell_nodes[0]][0] - 0.5,
        )
        for index, node_id in enumerate(shell_nodes):
            angle = first_angle + 2.0 * math.pi * index / len(shell_nodes)
            concentric[node_id] = [
                float(np.clip(0.5 + math.cos(angle) * radius, 0.05, 0.95)),
                float(np.clip(0.5 + math.sin(angle) * radius, 0.05, 0.95)),
            ]

    return force, concentric


def build_graph_network(
    embeddings: np.ndarray,
    search_index: Any,
    root_id: int,
    parameters: GraphNetworkParameters,
) -> dict[str, Any]:
    vectors = np.asarray(embeddings, dtype=np.float32)
    image_count = int(vectors.shape[0])
    if image_count == 0:
        raise ValueError("Cannot build a graph for an empty dataset")
    if not 0 <= root_id < image_count:
        raise IndexError("Root image ID not found")

    node_records: dict[int, dict[str, Any]] = {
        root_id: {
            "id": root_id,
            "depth": 0,
            "parent_id": None,
            "similarity_to_parent": None,
            "similarity_to_root": 1.0,
        }
    }
    tree_edges: list[dict[str, Any]] = []
    frontier: deque[int] = deque([root_id])

    while frontier and len(node_records) < parameters.max_nodes:
        parent_id = frontier.popleft()
        parent_depth = int(node_records[parent_id]["depth"])
        if parent_depth >= parameters.max_depth:
            continue

        query_size = min(
            image_count,
            max(17, parameters.neighbors_per_node * 4 + 1),
        )
        candidates: list[tuple[int, float]] = []
        while True:
            distances, indices = search_index.search(
                vectors[parent_id].reshape(1, -1),
                query_size,
            )
            candidates = sorted(
                (
                    (int(candidate_id), _cosine_from_squared_l2(float(distance)))
                    for candidate_id, distance in zip(indices[0], distances[0])
                    if int(candidate_id) != parent_id
                    and int(candidate_id) not in node_records
                ),
                key=lambda item: (-item[1], item[0]),
            )
            eligible_count = sum(
                similarity >= parameters.min_similarity
                for _, similarity in candidates
            )
            weakest_similarity = (
                _cosine_from_squared_l2(float(distances[0][-1]))
                if len(distances[0])
                else -1.0
            )
            if (
                eligible_count >= parameters.neighbors_per_node
                or query_size >= image_count
                or weakest_similarity < parameters.min_similarity
            ):
                break
            query_size = min(image_count, query_size * 2)

        added = 0
        for candidate_id, similarity in candidates:
            if similarity < parameters.min_similarity:
                break
            if candidate_id in node_records:
                continue
            root_similarity = float(np.dot(vectors[root_id], vectors[candidate_id]))
            node_records[candidate_id] = {
                "id": candidate_id,
                "depth": parent_depth + 1,
                "parent_id": parent_id,
                "similarity_to_parent": similarity,
                "similarity_to_root": float(np.clip(root_similarity, -1.0, 1.0)),
            }
            tree_edges.append(
                {
                    "source": parent_id,
                    "target": candidate_id,
                    "similarity": similarity,
                    "kind": "tree",
                }
            )
            frontier.append(candidate_id)
            added += 1
            if (
                added >= parameters.neighbors_per_node
                or len(node_records) >= parameters.max_nodes
            ):
                break

    selected_ids = list(node_records)
    selected_vectors = vectors[selected_ids]
    similarities = selected_vectors @ selected_vectors.T
    np.fill_diagonal(similarities, -np.inf)
    mutual_neighbors: list[set[int]] = []
    for row_index in range(len(selected_ids)):
        ranked = sorted(
            range(len(selected_ids)),
            key=lambda column_index: (
                -float(similarities[row_index, column_index]),
                selected_ids[column_index],
            ),
        )
        mutual_neighbors.append(set(ranked[:CROSS_LINK_NEIGHBORS]))

    existing_pairs = {
        tuple(sorted((int(edge["source"]), int(edge["target"]))))
        for edge in tree_edges
    }
    cross_edges: list[dict[str, Any]] = []
    for source_index, source_id in enumerate(selected_ids):
        for target_index in mutual_neighbors[source_index]:
            if source_index >= target_index:
                continue
            if source_index not in mutual_neighbors[target_index]:
                continue
            target_id = selected_ids[target_index]
            pair = tuple(sorted((source_id, target_id)))
            similarity = float(similarities[source_index, target_index])
            if pair in existing_pairs or similarity < parameters.min_similarity:
                continue
            existing_pairs.add(pair)
            cross_edges.append(
                {
                    "source": source_id,
                    "target": target_id,
                    "similarity": similarity,
                    "kind": "cross",
                }
            )

    edges = [*tree_edges, *cross_edges]
    force, concentric = _build_layouts(node_records, edges, root_id)
    nodes = []
    for node_id, record in node_records.items():
        nodes.append(
            {
                **record,
                "positions": {
                    "force": force[node_id],
                    "concentric": concentric[node_id],
                },
            }
        )

    return {
        "root_image_id": root_id,
        "parameters": {
            "max_depth": parameters.max_depth,
            "neighbors_per_node": parameters.neighbors_per_node,
            "max_nodes": parameters.max_nodes,
            "min_similarity": parameters.min_similarity,
        },
        "nodes": nodes,
        "edges": edges,
    }
