from __future__ import annotations

import logging
import pickle
import re

from api.models import DatasetConfig, DatasetContext
from api import indexing
from api import clip_service
from api import legacy_metadata_xlsx
from api import dataset_db
from api import sao_terms


def load_umap_cache(cfg: DatasetConfig) -> dict:
    try:
        with cfg.umap_cache_file.open("rb") as fh:
            cache = pickle.load(fh)
            if isinstance(cache, dict):
                logging.info(
                    "Loaded %s UMAP layouts from cache (%s)",
                    len(cache),
                    cfg.umap_cache_file,
                )
                return cache
    except FileNotFoundError:
        return {}
    except Exception:
        logging.exception("Failed to read UMAP cache %s", cfg.umap_cache_file)
        return {}

    return {}


def _split_keywords(value: str) -> list[str]:
    if not value:
        return []
    parts = re.split(r"[;,/]+", value)
    return [p.strip() for p in parts if p.strip()]


def seed_metadata_keywords(
    cfg: DatasetConfig,
    metadata: list[dict],
    image_paths: list,
) -> dict:
    if cfg.metadata_source == "none":
        return {"inserted": 0, "skipped_manual": 0}

    db_path = dataset_db.dataset_db_path(cfg.dataset_dir)
    if not db_path.exists():
        return {"inserted": 0, "skipped_manual": 0}

    conn = dataset_db.connect_dataset_db(db_path)
    try:
        manual_rows = conn.execute(
            "SELECT DISTINCT image_id FROM image_tags WHERE source = 'manual'"
        ).fetchall()
        manual_ids = {int(r["image_id"]) for r in manual_rows}

        terms, _ = sao_terms.get_terms()
        lookup = {t["label_norm"]: t for t in terms}

        legacy_index = None
        if cfg.metadata_xlsx_file.exists():
            legacy_index = legacy_metadata_xlsx.load_legacy_xlsx_index(
                cfg.metadata_xlsx_file
            )

        labels_needed: set[str] = set()
        image_to_labels: list[tuple[int, str]] = []

        for image_id, meta in enumerate(metadata):
            if image_id in manual_ids:
                continue
            keywords = meta.get("keywords") or []
            if not keywords and legacy_index is not None and image_id < len(image_paths):
                filename = image_paths[image_id].name
                kw_meta = legacy_index.for_filename(filename)
                keywords = kw_meta.get("keywords") or []
            for kw in keywords:
                if not isinstance(kw, str):
                    continue
                for token in _split_keywords(kw):
                    norm = sao_terms.normalize_label(token)
                    term = lookup.get(norm)
                    if not term:
                        continue
                    label = term["label"]
                    labels_needed.add(label)
                    image_to_labels.append((image_id, label))

        if not labels_needed:
            return {"inserted": 0, "skipped_manual": len(manual_ids)}

        conn.executemany(
            "INSERT OR IGNORE INTO tags (label) VALUES (?)",
            [(label,) for label in sorted(labels_needed)],
        )

        label_to_id: dict[str, int] = {}
        labels_list = sorted(labels_needed)
        chunk = 500
        for i in range(0, len(labels_list), chunk):
            batch = labels_list[i : i + chunk]
            rows = conn.execute(
                f"SELECT id, label FROM tags WHERE label IN ({','.join('?' for _ in batch)})",
                tuple(batch),
            ).fetchall()
            for row in rows:
                label_to_id[row["label"]] = int(row["id"])

        image_tag_rows = []
        for image_id, label in image_to_labels:
            tag_id = label_to_id.get(label)
            if tag_id is None:
                continue
            image_tag_rows.append((image_id, tag_id, "legacy_xlsx"))

        inserted = 0
        if image_tag_rows:
            before = conn.total_changes
            conn.executemany(
                "INSERT OR IGNORE INTO image_tags (image_id, tag_id, source) VALUES (?, ?, ?)",
                image_tag_rows,
            )
            after = conn.total_changes
            inserted = after - before
            logging.info(
                "Seeded %s metadata tags (skipped %s images with manual tags)",
                inserted,
                len(manual_ids),
            )
            conn.commit()
        return {"inserted": inserted, "skipped_manual": len(manual_ids)}
    finally:
        conn.close()


def build_context(cfg: DatasetConfig) -> DatasetContext:
    logging.info("Loading dataset %s", cfg.dataset_id)

    image_paths = indexing.collect_image_paths(cfg.thumb_root)
    logging.info("Found %s files in %s", len(image_paths), cfg.thumb_root)

    legacy_index = None
    if cfg.metadata_source == "legacy_xlsx" and cfg.metadata_xlsx_file.exists():
        legacy_index = legacy_metadata_xlsx.load_legacy_xlsx_index(cfg.metadata_xlsx_file)

    metadata = []
    for p in image_paths:
        meta = indexing.extract_metadata(cfg, p)
        if legacy_index is not None:
            meta.update(legacy_index.for_filename(p.name))
        metadata.append(meta)

    db_path = dataset_db.dataset_db_path(cfg.dataset_dir)
    if db_path.exists():
        conn = dataset_db.connect_dataset_db(db_path)
        try:
            dataset_db.ensure_images(conn, cfg.dataset_dir, image_paths)
            conn.commit()
        finally:
            conn.close()
        seed_metadata_keywords(cfg, metadata, image_paths)

    cached_paths, embeddings = indexing.load_cache(cfg.cache_file)

    if cached_paths == [str(p) for p in image_paths] and embeddings is not None:
        logging.info("Using cached embeddings for dataset %s", cfg.dataset_id)
    else:
        if cached_paths is None:
            logging.info("No cache present — embedding images for dataset %s …", cfg.dataset_id)
        else:
            logging.info("Image set changed — re-embedding dataset %s …", cfg.dataset_id)

        embeddings = clip_service.embed_images(image_paths)
        indexing.save_cache(cfg.cache_file, embeddings, image_paths)

    pca_embeddings_np = indexing.get_or_build_pca_embeddings(cfg, embeddings, image_paths)
    with cfg.pca_model_file.open("rb") as fh:
        pca_model = pickle.load(fh)

    faiss_index = indexing.build_index(embeddings)
    logging.info(
        "Index ready for dataset %s (%s vectors of dim %s)",
        cfg.dataset_id,
        getattr(faiss_index, "ntotal", "?"),
        getattr(faiss_index, "d", "?"),
    )


    umap_cache = load_umap_cache(cfg)

    return DatasetContext(
        cfg=cfg,
        image_paths=image_paths,
        metadata=metadata,
        embeddings=embeddings,
        pca_embeddings_np=pca_embeddings_np,
        pca_model=pca_model,
        faiss_index=faiss_index,
        umap_cache=umap_cache,
    )
