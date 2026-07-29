from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from api import sao_terms


CSV_HEADER = (
    "controlNumber,prefLabel,scopeNote,prefLabelEnglish,"
    "embeddingPromptEnglish,translationModel,translationPromptVersion\n"
)


class SaoTermsEnglishTests(unittest.TestCase):
    def tearDown(self) -> None:
        sao_terms._EMBEDDINGS = None
        sao_terms._EMBEDDINGS_HASH = None

    def test_loader_keeps_swedish_display_fields_and_english_analysis_fields(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "sao_terms_english.csv"
            path.write_text(
                CSV_HEADER
                + (
                    "123,hästdragen vagn,Fordon.,horse-drawn carriage,"
                    "A photograph depicting a horse-drawn carriage.,"
                    "translator,translation-v1\n"
                ),
                encoding="utf-8",
            )

            terms, labels_norm = sao_terms._load_terms(path)

        self.assertEqual(labels_norm, ["hastdragen vagn"])
        self.assertEqual(terms[0]["id"], "123")
        self.assertEqual(terms[0]["label"], "hästdragen vagn")
        self.assertEqual(terms[0]["scope_note"], "Fordon.")
        self.assertEqual(terms[0]["embedding_label"], "horse-drawn carriage")
        self.assertEqual(
            terms[0]["embedding_prompt"],
            "A photograph depicting a horse-drawn carriage.",
        )

    def test_loader_rejects_missing_english_analysis_text(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "sao_terms_english.csv"
            path.write_text(
                CSV_HEADER
                + "123,hästdragen vagn,Fordon.,,,translator,translation-v1\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "no English label"):
                sao_terms._load_terms(path)

    def test_embedding_uses_english_prompts_and_reuses_cache(self):
        terms = [
            {
                "id": "1",
                "label": "häst",
                "scope_note": "",
                "embedding_label": "horse",
                "embedding_prompt": "A photograph depicting a horse.",
                "translation_model": "translator",
                "translation_prompt_version": "translation-v1",
                "label_norm": "hast",
                "scope_norm": "",
                "embedding_label_norm": "horse",
            },
            {
                "id": "2",
                "label": "vagn",
                "scope_note": "",
                "embedding_label": "carriage",
                "embedding_prompt": "A photograph depicting a carriage.",
                "translation_model": "translator",
                "translation_prompt_version": "translation-v1",
                "label_norm": "vagn",
                "scope_norm": "",
                "embedding_label_norm": "carriage",
            },
        ]
        expected = np.asarray([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)

        with tempfile.TemporaryDirectory() as temporary_directory:
            cache_path = Path(temporary_directory) / "embeddings.npz"
            with (
                patch.object(sao_terms, "get_terms", return_value=(terms, [])),
                patch.object(sao_terms, "_cache_path", return_value=cache_path),
                patch.object(
                    sao_terms.clip_service,
                    "embed_text",
                    return_value=expected,
                ) as embed_text,
            ):
                first = sao_terms.ensure_embeddings()
                sao_terms._EMBEDDINGS = None
                sao_terms._EMBEDDINGS_HASH = None
                second = sao_terms.ensure_embeddings()

        embed_text.assert_called_once_with(
            [
                "A photograph depicting a horse.",
                "A photograph depicting a carriage.",
            ]
        )
        np.testing.assert_array_equal(first, expected)
        np.testing.assert_array_equal(second, expected)

    def test_embedding_hash_tracks_english_prompt_not_display_label(self):
        base = {
            "id": "1",
            "label": "svensk etikett",
            "embedding_prompt": "A photograph depicting a horse.",
            "translation_model": "translator",
            "translation_prompt_version": "translation-v1",
        }
        renamed_swedish = {**base, "label": "annan svensk etikett"}
        changed_english = {
            **base,
            "embedding_prompt": "A photograph depicting a carriage.",
        }

        self.assertEqual(
            sao_terms._labels_hash([base]),
            sao_terms._labels_hash([renamed_swedish]),
        )
        self.assertNotEqual(
            sao_terms._labels_hash([base]),
            sao_terms._labels_hash([changed_english]),
        )


if __name__ == "__main__":
    unittest.main()
