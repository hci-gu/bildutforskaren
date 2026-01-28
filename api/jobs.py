from __future__ import annotations

import logging

from PIL import Image

from api import config
from api import datasets
from api import dataset_db
from api import indexing
from api import atlas
from api import context
from api import runtime


def _set_job_state(dataset_id: str, **updates) -> None:
    runtime.get_job_manager().set_state(dataset_id, **updates)


def process_uploaded_dataset(dataset_id: str) -> None:
    cfg = datasets.get_dataset_config(dataset_id)

    try:
        _set_job_state(dataset_id, stage="thumbnails", progress=0)

        originals = indexing.collect_image_paths(cfg.original_root)
        total = len(originals)
        if total == 0:
            raise RuntimeError("No images found in uploaded dataset")

        processed = 0
        skipped = 0

        for idx, src in enumerate(originals):
            rel = src.relative_to(cfg.original_root)
            dst = cfg.thumb_root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)

            try:
                with Image.open(src) as img:
                    img = img.convert("RGB")
                    img.thumbnail(config.THUMB_MAX_SIZE)
                    img.save(dst, optimize=True)
                processed += 1
            except Exception as exc:
                skipped += 1
                try:
                    dst.unlink(missing_ok=True)
                except Exception:
                    pass
                logging.warning("Skipping unreadable image %s: %s", src, exc)

            if idx % 50 == 0:
                _set_job_state(
                    dataset_id,
                    stage="thumbnails",
                    progress=idx / total,
                    processed=processed,
                    skipped=skipped,
                )

        if processed == 0:
            raise RuntimeError("No valid images found in uploaded dataset")

        _set_job_state(dataset_id, stage="indexing", progress=0)

        image_paths = indexing.collect_image_paths(cfg.thumb_root)
        db_path = dataset_db.dataset_db_path(cfg.dataset_dir)
        if db_path.exists():
            conn = dataset_db.connect_dataset_db(db_path)
            try:
                dataset_db.ensure_images(conn, cfg.dataset_dir, image_paths)
                conn.commit()
            finally:
                conn.close()

        runtime.get_context_cache().invalidate(dataset_id)

        # Build caches (embeddings/PCA/FAISS)
        _set_job_state(dataset_id, stage="embeddings", progress=0, processed=0)

        def _embedding_progress(done: int, total: int) -> None:
            if total <= 0:
                return
            _set_job_state(
                dataset_id,
                stage="embeddings",
                progress=min(1.0, done / total),
                processed=done,
            )

        ctx = context.build_context(cfg, progress_cb=_embedding_progress)

        _set_job_state(dataset_id, stage="atlas", progress=0)
        atlas.ensure_atlas(cfg, ctx.image_paths)

        meta = datasets.read_dataset_json(dataset_id)
        meta["status"] = "ready"
        meta["error"] = None
        datasets.write_dataset_json(dataset_id, meta)

        _set_job_state(dataset_id, stage="ready", progress=1)

    except Exception as exc:
        logging.exception("Dataset processing failed for %s", dataset_id)
        try:
            meta = datasets.read_dataset_json(dataset_id)
            meta["status"] = "error"
            meta["error"] = str(exc)
            datasets.write_dataset_json(dataset_id, meta)
        except Exception:
            logging.exception("Failed to write error status for %s", dataset_id)

        _set_job_state(dataset_id, stage="error", error=str(exc))


def submit_processing(dataset_id: str) -> None:
    meta = datasets.read_dataset_json(dataset_id)
    meta["status"] = "processing"
    meta["error"] = None
    datasets.write_dataset_json(dataset_id, meta)

    runtime.get_job_manager().submit(process_uploaded_dataset, dataset_id)
