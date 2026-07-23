from __future__ import annotations

import unittest

import numpy as np

from api.graph_network import GraphNetworkParameters, build_graph_network


def _unit_vectors(angles: list[float]) -> np.ndarray:
    radians = np.radians(np.asarray(angles, dtype=np.float32))
    return np.column_stack((np.cos(radians), np.sin(radians))).astype("float32")


class ExactIndex:
    def __init__(self, vectors: np.ndarray):
        self.vectors = vectors

    def search(self, query: np.ndarray, count: int):
        distances = np.sum((self.vectors - query.reshape(1, -1)) ** 2, axis=1)
        indices = np.argsort(distances)[:count]
        return distances[indices][None, :], indices[None, :]


class GraphNetworkTests(unittest.TestCase):
    def build(
        self,
        vectors: np.ndarray,
        *,
        root_id: int = 0,
        max_depth: int = 3,
        neighbors: int = 2,
        max_nodes: int = 20,
        min_similarity: float = 0.0,
    ):
        return build_graph_network(
            vectors,
            ExactIndex(vectors),
            root_id,
            GraphNetworkParameters(
                max_depth=max_depth,
                neighbors_per_node=neighbors,
                max_nodes=max_nodes,
                min_similarity=min_similarity,
            ),
        )

    def test_is_deterministic_and_keeps_root_centered(self):
        vectors = _unit_vectors([0, 5, 10, 15, 20, 25, 30])
        first = self.build(vectors)
        second = self.build(vectors)
        self.assertEqual(first, second)
        root = first["nodes"][0]
        self.assertEqual(root["id"], 0)
        self.assertEqual(root["positions"]["force"], [0.5, 0.5])
        self.assertEqual(root["positions"]["concentric"], [0.5, 0.5])

    def test_respects_depth_branch_and_node_limits(self):
        vectors = _unit_vectors(list(range(0, 100, 5)))
        result = self.build(
            vectors,
            max_depth=2,
            neighbors=2,
            max_nodes=6,
        )
        self.assertLessEqual(len(result["nodes"]), 6)
        self.assertLessEqual(max(node["depth"] for node in result["nodes"]), 2)
        child_counts: dict[int, int] = {}
        for edge in result["edges"]:
            if edge["kind"] == "tree":
                child_counts[edge["source"]] = child_counts.get(edge["source"], 0) + 1
        self.assertTrue(all(count <= 2 for count in child_counts.values()))

    def test_similarity_cutoff_can_return_only_the_root(self):
        vectors = _unit_vectors([0, 45, 90, 135])
        result = self.build(vectors, min_similarity=0.9)
        self.assertEqual([node["id"] for node in result["nodes"]], [0])
        self.assertEqual(result["edges"], [])

    def test_tree_is_rooted_and_cross_links_are_unique(self):
        vectors = _unit_vectors([0, 2, 4, 6, 8, 10, 12, 14])
        result = self.build(vectors, neighbors=3, min_similarity=0.5)
        nodes = result["nodes"]
        tree_edges = [edge for edge in result["edges"] if edge["kind"] == "tree"]
        self.assertEqual(len(tree_edges), len(nodes) - 1)
        self.assertEqual(
            {edge["target"] for edge in tree_edges},
            {node["id"] for node in nodes if node["id"] != 0},
        )

        pairs = []
        for edge in result["edges"]:
            self.assertNotEqual(edge["source"], edge["target"])
            self.assertGreaterEqual(edge["similarity"], 0.5)
            pairs.append(tuple(sorted((edge["source"], edge["target"]))))
        self.assertEqual(len(pairs), len(set(pairs)))

    def test_all_layout_points_stay_in_bounds(self):
        vectors = _unit_vectors(list(range(0, 180, 10)))
        result = self.build(vectors, neighbors=3)
        for node in result["nodes"]:
            for point in node["positions"].values():
                self.assertTrue(all(0.05 <= value <= 0.95 for value in point))


if __name__ == "__main__":
    unittest.main()
