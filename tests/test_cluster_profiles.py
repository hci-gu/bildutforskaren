from __future__ import annotations

import unittest

import numpy as np

from api.cluster_profiles import analyze_cluster_profiles
from api.clustering import ClusteringConfig


class ClusterProfilesTests(unittest.TestCase):
    def setUp(self):
        self.image_vectors = np.asarray(
            [
                [1.0, 0.0],
                [0.98, 0.02],
                [0.96, 0.04],
                [0.0, 1.0],
                [0.02, 0.98],
                [0.04, 0.96],
            ],
            dtype=np.float32,
        )
        self.points = np.asarray(
            [
                [0.0, 0.0],
                [0.05, 0.0],
                [0.0, 0.05],
                [2.0, 2.0],
                [2.05, 2.0],
                [2.0, 2.05],
            ],
            dtype=np.float64,
        )
        self.concept_vectors = np.vstack(
            [
                np.asarray([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32),
                np.zeros((12, 2), dtype=np.float32),
            ]
        )
        self.concepts = [
            {"id": "a", "label": "hästar", "scope_note": ""},
            {"id": "b", "label": "vagnar", "scope_note": ""},
        ] + [
            {"id": f"z{index}", "label": f"noll {index}", "scope_note": ""}
            for index in range(12)
        ]

    def analyze(self, config: ClusteringConfig):
        return analyze_cluster_profiles(
            self.image_vectors,
            [0, 1, 2, 3, 4, 5],
            self.points,
            config,
            self.concept_vectors,
            self.concepts,
        )

    def test_kmeans_profiles_full_clip_centroids_against_subset(self):
        result = self.analyze(
            ClusteringConfig(
                algorithm="kmeans",
                parameters={"max_clusters": 2, "random_state": 7},
            )
        )
        self.assertEqual(len(result["clusters"]), 2)
        first = result["clusters"][0]
        self.assertEqual(first["image_count"], 3)
        strongest = first["profile"]["strongest"][0]
        self.assertIn(strongest["concept_id"], {"a", "b"})
        self.assertIn(strongest["label"], {"hästar", "vagnar"})
        self.assertGreater(strongest["cluster_score"], strongest["baseline_score"])
        self.assertEqual(
            first["profile"]["more_prominent"][0]["concept_id"],
            strongest["concept_id"],
        )
        opposite = {"a": "b", "b": "a"}[strongest["concept_id"]]
        self.assertEqual(
            first["profile"]["less_prominent"][0]["concept_id"],
            opposite,
        )

    def test_dbscan_and_hdbscan_reuse_existing_algorithms(self):
        dbscan = self.analyze(
            ClusteringConfig(
                algorithm="dbscan",
                parameters={"eps": 0.2, "min_samples": 2},
            )
        )
        hdbscan = self.analyze(
            ClusteringConfig(
                algorithm="hdbscan",
                parameters={
                    "min_cluster_size": 2,
                    "min_samples": 2,
                    "cluster_selection_epsilon": 0.0,
                    "allow_single_cluster": False,
                },
            )
        )
        self.assertEqual(len(dbscan["clusters"]), 2)
        self.assertEqual(
            sorted(
                image_id
                for cluster in dbscan["clusters"]
                for image_id in cluster["image_ids"]
            ),
            [0, 1, 2, 3, 4, 5],
        )
        self.assertGreaterEqual(len(hdbscan["clusters"]), 1)

    def test_noise_ids_are_mapped_back_to_dataset_ids(self):
        points = self.points.copy()
        points[-1] = [10.0, 10.0]
        result = analyze_cluster_profiles(
            self.image_vectors,
            [0, 1, 2, 3, 4, 5],
            points,
            ClusteringConfig(
                algorithm="dbscan",
                parameters={"eps": 0.2, "min_samples": 2},
            ),
            self.concept_vectors,
            self.concepts,
        )
        self.assertEqual(result["noise_image_ids"], [5])

    def test_deterministic_concept_ties_use_control_number(self):
        concepts = [
            {"id": "b", "label": "samma", "scope_note": ""},
            {"id": "a", "label": "samma", "scope_note": ""},
        ]
        result = analyze_cluster_profiles(
            self.image_vectors,
            list(range(6)),
            self.points,
            ClusteringConfig(
                algorithm="kmeans",
                parameters={"max_clusters": 2, "random_state": 7},
            ),
            np.asarray([[1.0, 0.0], [1.0, 0.0]], dtype=np.float32),
            concepts,
        )
        self.assertEqual(
            [
                item["concept_id"]
                for item in result["clusters"][0]["profile"]["strongest"][:2]
            ],
            ["a", "b"],
        )


if __name__ == "__main__":
    unittest.main()
