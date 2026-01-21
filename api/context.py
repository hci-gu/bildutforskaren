from __future__ import annotations

import logging
import pickle

from api.models import DatasetConfig, DatasetContext
from api import indexing
from api import clip_service
from api import legacy_metadata_xlsx


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
