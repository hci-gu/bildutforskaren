from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from flask import Blueprint, Flask, jsonify

from api import presentation, sao_terms
from api.routes_terms import bp


def vocabulary():
    return [
        {
            "id": "horse", "label": "hästar", "scope_note": "Djur.",
            "label_norm": "hastar", "scope_norm": "djur.",
            "embedding_label": "horses", "embedding_label_norm": "horses",
            "embedding_prompt": "A photograph depicting horses.",
            "translation_model": "translator", "translation_prompt_version": "v1",
        },
        {
            "id": "carriage", "label": "vagnar", "scope_note": "Fordon.",
            "label_norm": "vagnar", "scope_norm": "fordon.",
            "embedding_label": "carriages", "embedding_label_norm": "carriages",
            "embedding_prompt": "A photograph depicting carriages.",
            "translation_model": "translator", "translation_prompt_version": "v1",
        },
    ]


class PresentationTests(unittest.TestCase):
    def test_bilingual_lookup_returns_the_same_canonical_concept(self):
        terms = vocabulary()
        with patch.object(sao_terms, "get_terms", return_value=(terms, ["hastar", "vagnar"])):
            swedish = sao_terms.search_terms("hästar", limit=1)
            english = sao_terms.search_terms("horses", limit=1)
            fuzzy = sao_terms.search_terms("horsse", limit=1)
        self.assertEqual(swedish, english)
        self.assertEqual(fuzzy[0]["id"], "horse")
        self.assertEqual(english[0]["label"], "hästar")

    def test_response_adds_labels_without_changing_analysis_or_source(self):
        terms = vocabulary()
        cached = {
            "concepts": [{"concept_id": "horse", "label": "hästar", "score": 0.78}],
            "tags": [{"id": 7, "label": "hästar"}, {"id": 8, "label": "My own tag"}],
            "points": [[0.1, 0.2]],
        }
        before = copy.deepcopy(cached)
        with patch.object(sao_terms, "get_terms", return_value=(terms, [])):
            by_id, by_label = presentation.vocabulary_indexes()
            result = presentation.add_display_labels(cached, by_id, by_label)
        self.assertEqual(cached, before)
        self.assertEqual(result["points"], cached["points"])
        self.assertEqual(result["concepts"][0]["score"], 0.78)
        self.assertEqual(result["tags"][0]["labels"], {"sv": "hästar", "en": "horses"})
        self.assertEqual(result["tags"][0]["id"], 7)
        self.assertNotIn("labels", result["tags"][1])

    def test_ambiguous_custom_tag_is_not_translated(self):
        terms = vocabulary()
        terms[1]["embedding_label"] = "horses"
        with patch.object(sao_terms, "get_terms", return_value=(terms, [])):
            by_id, by_label = presentation.vocabulary_indexes()
            result = presentation.add_display_labels({"label": "horses"}, by_id, by_label)
            identified = presentation.add_display_labels(
                {"concept_id": "horse", "label": "hästar"}, by_id, by_label
            )
        self.assertIsNone(result["labels"])
        self.assertEqual(identified["labels"]["en"], "horses")

    def test_search_http_contract_keeps_canonical_labels_and_english_embeddings(self):
        app = Flask(__name__)
        app.register_blueprint(bp)
        terms = vocabulary()
        with (
            patch.object(sao_terms, "get_terms", return_value=(terms, ["hastar", "vagnar"])),
            patch.object(sao_terms.clip_service, "embed_text") as embed_text,
        ):
            response = app.test_client().get("/terms/sao?q=horses&limit=1")
        self.assertEqual(response.status_code, 200)
        item = response.get_json()[0]
        self.assertEqual(item["id"], "horse")
        self.assertEqual(item["label"], "hästar")
        self.assertEqual(item["labels"], {"sv": "hästar", "en": "horses"})
        self.assertEqual(item["scope_note"], "Djur.")
        embed_text.assert_not_called()

    def test_cluster_labels_and_reason_codes_are_presentation_only(self):
        result = presentation.add_display_labels({
            "label": "people indoors", "centroid_position": [0.1, 0.2],
            "axis": {"reason": "Projection points were not supplied"},
        }, {}, {})
        self.assertEqual(result["labels"], {"sv": "människor inomhus", "en": "people indoors"})
        self.assertEqual(result["axis"]["reason_code"], "missing_projection")

    def test_source_metadata_is_excluded_from_presentation_enrichment(self):
        app = Flask(__name__)
        routes = Blueprint("source_test", __name__)
        presentation.register_display_labels(routes, endpoints={"tags"})

        @routes.get("/metadata")
        def metadata():
            return jsonify({"label": "hästar", "description": "Original text"})

        @routes.get("/tags")
        def tags():
            return jsonify([{"id": 1, "label": "hästar"}])

        app.register_blueprint(routes)
        with patch.object(sao_terms, "get_terms", return_value=(vocabulary(), [])):
            client = app.test_client()
            self.assertEqual(client.get("/metadata").get_json(), {
                "label": "hästar", "description": "Original text",
            })
            self.assertEqual(client.get("/tags").get_json()[0]["labels"]["en"], "horses")


if __name__ == "__main__":
    unittest.main()
