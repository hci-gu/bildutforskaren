from __future__ import annotations

import tempfile
import threading
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import numpy as np
import torch
from flask import Flask
from PIL import Image

from api import context, dataset_activity, dataset_db, datasets, embedding_service, indexing, jobs, sao_terms
from api.context_cache import ContextCache
from api.embedding_config import CLIP_MODEL_ID, GEMMA_MODEL_ID, fingerprint
from api.job_manager import JobManager
from api.models import DatasetConfig
from api.projection_stability_jobs import ActiveStabilityJobError, ProjectionStabilityJobManager


class FakeProvider:
    image_batch_size = 2
    text_batch_size = 2

    def __init__(self):
        self.colors = []

    def images(self, images):
        values = np.zeros((len(images), 768), dtype=np.float32)
        for index, image in enumerate(images):
            color = image.getpixel((0, 0))[0]
            self.colors.append(color)
            values[index, color] = 2
        return values

    def texts(self, texts):
        return np.eye(len(texts), 768, dtype=np.float32) * 3


class EmbeddingServiceTests(unittest.TestCase):
    def test_active_model_queries_can_run_between_target_batches(self):
        results = []
        query_thread = threading.Thread(
            target=lambda: results.append(embedding_service.embed_text(["horse"], CLIP_MODEL_ID)),
            daemon=True,
        )

        def progress(done, _total):
            if done == 2:
                query_thread.start()
                query_thread.join(timeout=2)
                self.assertFalse(query_thread.is_alive(), "Target preparation blocked the active model")

        with patch.object(embedding_service, "_provider", return_value=FakeProvider()):
            embedding_service.embed_text(["a", "b", "c"], GEMMA_MODEL_ID, progress_cb=progress)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].shape, (1, 768))

    def test_both_models_preserve_order_dtype_and_uploaded_image_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = []
            for color in (5, 2, 9):
                path = Path(directory) / f"{color}.png"
                Image.new("RGB", (4, 4), (color, 0, 0)).save(path)
                paths.append(path)
            for model in (CLIP_MODEL_ID, GEMMA_MODEL_ID):
                provider = FakeProvider()
                progress = []
                with patch.object(embedding_service, "_provider", return_value=provider):
                    result = embedding_service.embed_images(paths, model, progress_cb=lambda *args: progress.append(args))
                    uploaded = embedding_service.embed_image_objects([Image.new("RGB", (4, 4), (5, 0, 0))], model)
                    text_progress = []
                    texts = embedding_service.embed_text(["häst", "horse", "vagn"], model, progress_cb=lambda *args: text_progress.append(args))
                self.assertEqual(result.dtype, torch.float32)
                self.assertEqual(result.device.type, "cpu")
                self.assertEqual(result.shape, (3, 768))
                self.assertEqual(result.argmax(dim=1).tolist(), [5, 2, 9])
                self.assertEqual(progress, [(2, 3), (3, 3)])
                self.assertEqual(text_progress, [(2, 3), (3, 3)])
                np.testing.assert_array_equal(uploaded, result[:1].numpy())
                np.testing.assert_allclose(np.linalg.norm(texts, axis=1), 1)

    def test_invalid_vectors_are_rejected(self):
        for vectors in (np.zeros((1, 768)), np.full((1, 768), np.nan), np.ones((1, 512))):
            with self.assertRaises(ValueError):
                embedding_service.normalized_vectors(vectors, 1)

    def test_gemma_loads_no_audio_and_never_fp16(self):
        factory = Mock()
        with (
            patch.dict("sys.modules", {"sentence_transformers": SimpleNamespace(SentenceTransformer=factory)}),
            patch.object(torch.cuda, "is_available", return_value=False),
        ):
            provider = embedding_service.GemmaProvider()
            provider.texts(["horse"])
            provider.images([Image.new("RGB", (1, 1))])
        kwargs = factory.call_args.kwargs
        self.assertEqual(kwargs["config_kwargs"], {"audio_config": None})
        self.assertEqual(kwargs["model_kwargs"]["torch_dtype"], torch.float32)
        self.assertEqual(kwargs["revision"], embedding_service.MODEL_REVISIONS[GEMMA_MODEL_ID])
        for call in factory.return_value.encode.call_args_list:
            self.assertEqual(call.kwargs["prompt"], "")


class EmbeddingCacheTests(unittest.TestCase):
    def test_pca_rebuilds_for_changed_vectors_or_corrupt_transform(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cfg = DatasetConfig("pca", root / "thumb", root / "original", root / "cache", root / "atlas")
            paths = [root / f"{i}.png" for i in range(3)]
            values = torch.from_numpy(np.eye(3, 768, dtype=np.float32))
            indexing.get_or_build_pca_embeddings(cfg, values, paths)
            previous_vectors = cfg.pca_cache_file.read_bytes()
            with patch.object(indexing, "compute_and_cache_pca", wraps=indexing.compute_and_cache_pca) as build:
                indexing.get_or_build_pca_embeddings(cfg, values, paths)
                build.assert_not_called()
                indexing.get_or_build_pca_embeddings(cfg, values.roll(1, dims=1), paths)
                self.assertEqual(build.call_count, 1)
                # Simulate interruption after the new transform was written.
                cfg.pca_cache_file.write_bytes(previous_vectors)
                indexing.get_or_build_pca_embeddings(cfg, values.roll(1, dims=1), paths)
                self.assertEqual(build.call_count, 2)
                cfg.pca_model_file.write_bytes(b"corrupt")
                indexing.get_or_build_pca_embeddings(cfg, values, paths)
                self.assertEqual(build.call_count, 3)

    def test_cache_rejects_other_model_and_changed_images(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "a.png"
            Image.new("RGB", (2, 2)).save(path)
            cache = Path(directory) / "index.npz"
            values = torch.from_numpy(np.eye(1, 768, dtype=np.float32))
            indexing.save_cache(cache, values, [path], fingerprint(CLIP_MODEL_ID))
            self.assertIsNotNone(indexing.load_cache(cache, fingerprint(CLIP_MODEL_ID))[1])
            self.assertIsNone(indexing.load_cache(cache, fingerprint(GEMMA_MODEL_ID))[1])
            Image.new("RGB", (9, 9)).save(path)
            self.assertIsNone(indexing.load_cache(cache, fingerprint(CLIP_MODEL_ID))[1])
            for contents in (b"", b"PK\x03\x04incomplete"):
                cache.write_bytes(contents)
                self.assertIsNone(indexing.load_cache(cache, fingerprint(CLIP_MODEL_ID))[1])
                self.assertIsNone(indexing.load_pca_cache(cache, fingerprint(CLIP_MODEL_ID))[1])

    def test_context_cache_is_separate_and_invalidation_covers_both_models(self):
        cache = ContextCache(2)
        builder = Mock(side_effect=lambda dataset: object())
        clip = cache.get("dataset", builder, fingerprint(CLIP_MODEL_ID))
        gemma = cache.get("dataset", builder, fingerprint(GEMMA_MODEL_ID))
        self.assertIsNot(clip, gemma)
        self.assertIs(clip, cache.get("dataset", builder, fingerprint(CLIP_MODEL_ID)))
        cache.invalidate("dataset")
        self.assertIsNot(clip, cache.get("dataset", builder, fingerprint(CLIP_MODEL_ID)))

    def test_legacy_clip_cache_is_migrated_but_never_used_for_gemma(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            thumbs = root / "thumb"
            thumbs.mkdir()
            path = thumbs / "a.png"
            Image.new("RGB", (2, 2)).save(path)
            cfg = DatasetConfig("test", thumbs, root / "original", root / "cache", root / "atlas")
            values = torch.from_numpy(np.eye(1, 768, dtype=np.float32))
            indexing.save_cache(cfg.cache_dir / "clip_index.npz", values, [path])
            with patch.object(embedding_service, "embed_images", return_value=values) as embed:
                context.build_context(cfg, prepare_only=True)
                embed.assert_not_called()
                context.build_context(replace(cfg, embedding_model=GEMMA_MODEL_ID), prepare_only=True)
                embed.assert_called_once()
            self.assertTrue(cfg.cache_file.exists())

    def test_sao_uses_fixed_prompts_with_separate_memory_and_disk_caches(self):
        term = {"id": "1", "label": "häst", "embedding_prompt": "A photograph depicting a horse.",
                "translation_model": "fixed", "translation_prompt_version": "v1"}
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(sao_terms.config, "REPO_ROOT", Path(directory)),
            patch.object(sao_terms, "get_terms", return_value=([term], [])),
            patch.object(embedding_service, "embed_text", side_effect=[np.eye(1, 768, dtype=np.float32), np.eye(2, 768, dtype=np.float32)[1:]]) as embed,
            patch.object(sao_terms, "_EMBEDDINGS", {}),
        ):
            clip = sao_terms.ensure_embeddings(CLIP_MODEL_ID)
            gemma = sao_terms.ensure_embeddings(GEMMA_MODEL_ID)
            sao_terms._EMBEDDINGS.clear()
            np.testing.assert_array_equal(sao_terms.ensure_embeddings(CLIP_MODEL_ID), clip)
            np.testing.assert_array_equal(sao_terms.ensure_embeddings(GEMMA_MODEL_ID), gemma)
            self.assertEqual(embed.call_count, 2)
            self.assertEqual(embed.call_args_list[1].args, ([term["embedding_prompt"]], GEMMA_MODEL_ID))
            self.assertNotEqual(sao_terms._cache_path(CLIP_MODEL_ID), sao_terms._cache_path(GEMMA_MODEL_ID))


class ModelSwitchTests(unittest.TestCase):
    def test_analysis_releases_reservation_if_model_changes_before_enqueue(self):
        manager = ProjectionStabilityJobManager()
        try:
            with patch.object(manager._executor, "submit") as submit:
                def validate():
                    raise ActiveStabilityJobError("model changed")
                with self.assertRaises(ActiveStabilityJobError):
                    manager.start(self.dataset_id, lambda *_: {}, before_enqueue=validate)
                submit.assert_not_called()
                dataset_activity.reserve(self.dataset_id, "embedding-model")
                dataset_activity.release(self.dataset_id)
        finally:
            manager._executor.shutdown(wait=True)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.root_patch = patch.object(datasets.config, "DATASETS_ROOT", self.root)
        self.root_patch.start()
        self.data = datasets.create_dataset("sample")
        self.dataset_id = self.data["dataset_id"]
        self.manager = JobManager(max_workers=1)
        self.queue = []
        self.submit_patch = patch.object(self.manager._executor, "submit", side_effect=lambda *args: self.queue.append(args))
        self.submit_patch.start()
        self.manager_patch = patch.object(jobs.runtime, "get_job_manager", return_value=self.manager)
        self.manager_patch.start()

    def tearDown(self):
        dataset_activity.release(self.dataset_id)
        self.manager._executor.shutdown(wait=True)
        self.manager_patch.stop()
        self.submit_patch.stop()
        self.root_patch.stop()
        self.temporary.cleanup()

    def ready(self):
        data = datasets.read_dataset_json(self.dataset_id)
        data["status"] = "ready"
        datasets.write_dataset_json(self.dataset_id, data)

    def run_queued(self):
        fn, *args = self.queue.pop(0)
        fn(*args)

    def test_switch_keeps_active_model_until_prepared_and_can_switch_back(self):
        self.ready()
        prepared = []

        def build(cfg, **kwargs):
            self.assertEqual(datasets.read_dataset_json(self.dataset_id)["embedding_model"], CLIP_MODEL_ID if cfg.embedding_model == GEMMA_MODEL_ID else GEMMA_MODEL_ID)
            self.assertTrue(kwargs["prepare_only"])
            prepared.append(cfg.embedding_model)

        with patch.object(jobs.context, "build_context", side_effect=build), patch.object(sao_terms, "ensure_embeddings"), patch.object(embedding_service, "unload_inactive"):
            for model in (GEMMA_MODEL_ID, CLIP_MODEL_ID):
                jobs.submit_model_switch(self.dataset_id, model)
                with self.assertRaises(dataset_activity.ActiveDatasetJobError):
                    self.manager.submit(lambda _: None, self.dataset_id)
                self.run_queued()
                self.assertEqual(datasets.read_dataset_json(self.dataset_id)["embedding_model"], model)
        self.assertEqual(prepared, [GEMMA_MODEL_ID, CLIP_MODEL_ID])
        self.assertFalse(dataset_activity.switching(self.dataset_id))

    def test_failed_switch_keeps_previous_model_and_records_error(self):
        self.ready()
        with patch.object(jobs.context, "build_context", side_effect=RuntimeError("model unavailable")), patch.object(embedding_service, "unload_inactive"):
            jobs.submit_model_switch(self.dataset_id, GEMMA_MODEL_ID)
            self.run_queued()
        data = datasets.read_dataset_json(self.dataset_id)
        self.assertEqual(data["embedding_model"], CLIP_MODEL_ID)
        self.assertEqual(data["status"], "ready")
        self.assertEqual(data["embedding_switch"]["status"], "error")
        self.assertIn("model unavailable", data["embedding_switch"]["error"])

    def test_cleanup_failure_does_not_relabel_a_published_switch_as_failed(self):
        self.ready()
        with (
            patch.object(jobs.context, "build_context"),
            patch.object(sao_terms, "ensure_embeddings"),
            patch.object(embedding_service, "unload_inactive", side_effect=RuntimeError("cleanup failed")),
        ):
            jobs.submit_model_switch(self.dataset_id, GEMMA_MODEL_ID)
            self.run_queued()
        data = datasets.read_dataset_json(self.dataset_id)
        self.assertEqual(data["embedding_model"], GEMMA_MODEL_ID)
        self.assertEqual(data["embedding_switch"]["status"], "complete")
        self.assertIsNone(data["embedding_switch"]["error"])
        self.assertEqual(self.manager.get_state(self.dataset_id)["stage"], "ready")

    def client(self):
        from api.routes_datasets import bp

        app = Flask(__name__)
        app.register_blueprint(bp)
        return app.test_client()

    def test_api_model_validation_and_idempotence(self):
        self.ready()
        client = self.client()
        endpoint = f"/datasets/{self.dataset_id}/embedding-model"
        for value in (None, "unknown", [], {}):
            response = client.post(endpoint, json={"embedding_model": value})
            self.assertEqual(response.status_code, 400)
        response = client.post(endpoint, json={"embedding_model": CLIP_MODEL_ID})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.queue, [])
        response = client.post(endpoint, json={"embedding_model": GEMMA_MODEL_ID})
        self.assertEqual(response.status_code, 202)
        self.assertEqual(datasets.read_dataset_json(self.dataset_id)["embedding_model"], CLIP_MODEL_ID)
        self.assertEqual(client.post(f"/datasets/{self.dataset_id}/resume-processing").status_code, 409)
        self.assertEqual(client.delete(f"/datasets/{self.dataset_id}").status_code, 409)

    def test_switch_rejects_running_analysis_and_creation_accepts_model_choice(self):
        self.ready()
        client = self.client()
        dataset_activity.reserve(self.dataset_id, "analysis")
        response = client.post(f"/datasets/{self.dataset_id}/embedding-model", json={"embedding_model": GEMMA_MODEL_ID})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.queue, [])
        created = client.post("/datasets", json={"name": "gemma", "embedding_model": GEMMA_MODEL_ID})
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.get_json()["embedding_model"], GEMMA_MODEL_ID)

    def test_real_switch_reuses_each_model_cache_and_preserves_image_ids(self):
        self.ready()
        cfg = datasets.get_dataset_config(self.dataset_id)
        for number in range(3):
            Image.new("RGB", (4, 4), (number, 0, 0)).save(cfg.thumb_root / f"{number}.png")
        conn = dataset_db.connect_dataset_db(dataset_db.dataset_db_path(cfg.dataset_dir))
        dataset_db.ensure_images(conn, cfg.dataset_dir, indexing.collect_image_paths(cfg.thumb_root))
        conn.execute("INSERT INTO tags (id, label) VALUES (1, 'manuell etikett')")
        conn.execute("INSERT INTO image_tags (image_id, tag_id, source) VALUES (1, 1, 'manual')")
        conn.commit()
        before_images = [tuple(row) for row in conn.execute("SELECT * FROM images ORDER BY id")]
        before_tags = [tuple(row) for row in conn.execute("SELECT * FROM image_tags")]
        values = torch.from_numpy(np.eye(3, 768, dtype=np.float32))
        with patch.object(embedding_service, "embed_images", return_value=values) as embed, patch.object(sao_terms, "ensure_embeddings"), patch.object(embedding_service, "unload_inactive"):
            original = context.build_context(cfg, prepare_only=True)
            for model in (GEMMA_MODEL_ID, CLIP_MODEL_ID):
                jobs.submit_model_switch(self.dataset_id, model)
                self.run_queued()
            returned = context.build_context(datasets.get_dataset_config(self.dataset_id), prepare_only=True)
        self.assertEqual(embed.call_count, 2)
        self.assertEqual(original.image_paths, returned.image_paths)
        np.testing.assert_array_equal(original.embeddings.numpy(), returned.embeddings.numpy())
        self.assertEqual(before_images, [tuple(row) for row in conn.execute("SELECT * FROM images ORDER BY id")])
        self.assertEqual(before_tags, [tuple(row) for row in conn.execute("SELECT * FROM image_tags")])
        conn.close()


if __name__ == "__main__":
    unittest.main()
