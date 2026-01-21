from __future__ import annotations

import hashlib
import json
import logging
import re
import pickle
from pathlib import Path
from typing import List

import numpy as np
import torch
from sklearn.decomposition import PCA

try:
    import faiss  # type: ignore
except Exception:  # pragma: no cover
    faiss = None

from api import config
from api import clip_service
from api.models import DatasetConfig


def collect_image_paths(root: Path) -> List[Path]:
    return sorted(p for p in root.rglob("*") if p.suffix.lower() in config.IMAGE_TYPES)


def extract_metadata(cfg: DatasetConfig, path: Path) -> dict:
    return {
        "filename": path.name,
    }


def save_cache(cache_file: Path, emb: torch.Tensor, paths: List[Path]) -> None:
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        cache_file,
        embeddings=emb.numpy().astype("float32"),
        paths=np.array([str(p) for p in paths]),
    )
    logging.info("Saved %s embeddings → %s", len(paths), cache_file)


def load_cache(cache_file: Path):
    if not cache_file.exists():
        return None, None

    data = np.load(cache_file, allow_pickle=True)
    cached_paths = list(data["paths"].tolist())
    embeddings = torch.from_numpy(data["embeddings"])
    return cached_paths, embeddings


class NumpyIndex:
    def __init__(self, vectors: np.ndarray):
        self._vectors = vectors.astype("float32", copy=False)
        self.d = int(self._vectors.shape[1])
        self.ntotal = int(self._vectors.shape[0])

    def search(self, q: np.ndarray, k: int):
        q = q.astype("float32", copy=False).reshape(1, -1)
        diff = self._vectors - q
        dists = np.sum(diff * diff, axis=1)
        order = np.argsort(dists)[:k]
        I = np.array(order, dtype=np.int64).reshape(1, -1)
        D = np.array(dists[order], dtype=np.float32).reshape(1, -1)
        return D, I


def build_index(emb: torch.Tensor):
    emb_np = emb.numpy().astype("float32")

    if faiss is None:
        return NumpyIndex(emb_np)

    dim = emb_np.shape[1]
    index = faiss.IndexFlatL2(dim)
    index.add(emb_np)
    return index


def save_pca_cache(pca_cache_file: Path, pca_embeddings: np.ndarray, paths: List[Path]) -> None:
    pca_cache_file.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        pca_cache_file,
        embeddings=pca_embeddings.astype("float32"),
        paths=np.array([str(p) for p in paths]),
        dim=np.array([pca_embeddings.shape[1]], dtype=np.int32),
    )
    logging.info("Saved PCA(%s) embeddings → %s", pca_embeddings.shape[1], pca_cache_file)


def load_pca_cache(pca_cache_file: Path):
    if not pca_cache_file.exists():
        return None, None

    data = np.load(pca_cache_file, allow_pickle=True)
    cached_paths = list(data["paths"].tolist())
    pca_emb = data["embeddings"].astype("float32")
    return cached_paths, pca_emb


def compute_and_cache_pca(cfg: DatasetConfig, embeddings: torch.Tensor, paths: List[Path]) -> np.ndarray:
    X = embeddings.numpy().astype("float32")

    max_k = int(cfg.pca_dim)
    k = int(min(max_k, X.shape[0], X.shape[1]))
    if k < 1:
        raise ValueError("PCA requires at least 1 sample")

    pca = PCA(n_components=k, svd_solver="randomized", random_state=1)
    X_pca = pca.fit_transform(X).astype("float32")

    cfg.pca_model_file.parent.mkdir(parents=True, exist_ok=True)
    with cfg.pca_model_file.open("wb") as fh:
        pickle.dump(pca, fh)
    logging.info("Saved PCA model → %s", cfg.pca_model_file)

    save_pca_cache(cfg.pca_cache_file, X_pca, paths)
    return X_pca


def get_or_build_pca_embeddings(cfg: DatasetConfig, embeddings: torch.Tensor, paths: List[Path]) -> np.ndarray:
    cached_paths, pca_emb = load_pca_cache(cfg.pca_cache_file)
    if cached_paths == [str(p) for p in paths] and pca_emb is not None and pca_emb.shape[1] <= cfg.pca_dim:
        logging.info("Using cached PCA(%s) embeddings (cold-start avoided)", pca_emb.shape[1])
        return pca_emb

    logging.info("PCA cache missing/stale — computing PCA(up to %s) …", cfg.pca_dim)
    return compute_and_cache_pca(cfg, embeddings, paths)


def l2_normalize_rows(arr: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms = np.maximum(norms, 1e-12)
    return arr / norms


def umap_cache_key(image_ids: list[int], texts: list[str], params: dict, version: int) -> str:
    payload = {
        "image_ids": image_ids,
        "texts": texts,
        "params": params,
        "v": version,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return f"post:{hashlib.sha256(encoded.encode('utf-8')).hexdigest()}"


def infer_missing_years(
    embeddings: torch.Tensor,
    metadata: list[dict],
    min_samples_per_year: int = 5,
) -> None:
    year_to_indices: dict[int, list[int]] = {}
    for idx, meta in enumerate(metadata):
        y = meta.get("year")
        if y and str(y).isdigit():
            year_to_indices.setdefault(int(y), []).append(idx)

    if not year_to_indices:
        return

    emb_np = embeddings.numpy().astype("float32")
    emb_np /= np.linalg.norm(emb_np, axis=1, keepdims=True)

    centroids, years = [], []
    for y, idxs in year_to_indices.items():
        if len(idxs) < min_samples_per_year:
            continue
        c = emb_np[idxs].mean(axis=0)
        c /= np.linalg.norm(c)
        centroids.append(c.astype("float32"))
        years.append(y)

    if not centroids:
        return

    centroids_np = np.stack(centroids).astype("float32")
    years_arr = np.array(years)

    for idx, meta in enumerate(metadata):
        if meta.get("year"):
            continue

        q = emb_np[idx : idx + 1].astype("float32")

        if faiss is not None:
            dim = centroids_np.shape[1]
            year_index = faiss.IndexFlatL2(dim)
            year_index.add(centroids_np)
            D, I = year_index.search(q, 1)
            nearest_id = int(I[0, 0])
            dist = float(D[0, 0])
        else:
            diff = centroids_np - q
            dists = np.sum(diff * diff, axis=1)
            nearest_id = int(np.argmin(dists))
            dist = float(dists[nearest_id])

        meta["year_estimate"] = int(years_arr[nearest_id])
        meta["year_estimate_distance"] = dist


def _normalise_keyword(word: str) -> str:
    return re.sub(r"\s+", " ", word.strip().lower())


def infer_missing_keywords(
    embeddings: torch.Tensor,
    metadata: list[dict],
    *,
    min_images_per_kw: int = 5,
    max_keywords_per_image: int = 5,
    sim_threshold: float = 0.25,
    blend_text_prior: bool = False,
    text_prior_weight: float = 0.30,
) -> None:
    kw_to_indices: dict[str, list[int]] = {}
    for idx, meta in enumerate(metadata):
        kws = meta.get("keywords", [])
        if not kws:
            continue
        for kw in kws:
            kw_norm = _normalise_keyword(kw)
            kw_to_indices.setdefault(kw_norm, []).append(idx)

    if not kw_to_indices:
        return

    emb_np = embeddings.numpy().astype("float32")
    emb_np /= np.linalg.norm(emb_np, axis=1, keepdims=True)

    proto_vecs, proto_keywords = [], []
    text_prompts: list[str] = []

    for kw, idxs in kw_to_indices.items():
        if len(idxs) < min_images_per_kw:
            continue
        img_centroid = emb_np[idxs].mean(axis=0)
        img_centroid /= np.linalg.norm(img_centroid)

        proto_keywords.append(kw)
        proto_vecs.append(img_centroid.astype("float32"))
        if blend_text_prior:
            text_prompts.append(f"a photo of {kw}")

    if not proto_vecs:
        return

    if blend_text_prior and text_prompts:
        txt_emb = clip_service.embed_text(text_prompts)
        for i in range(len(proto_vecs)):
            v = (1.0 - text_prior_weight) * proto_vecs[i] + text_prior_weight * txt_emb[i]
            v /= np.linalg.norm(v)
            proto_vecs[i] = v.astype("float32")

    proto_mat = np.stack(proto_vecs).astype("float32")

    for idx, meta in enumerate(metadata):
        if meta.get("keywords"):
            continue

        q = emb_np[idx : idx + 1].astype("float32")

        if faiss is not None:
            dim = proto_mat.shape[1]
            kw_index = faiss.IndexFlatL2(dim)
            kw_index.add(proto_mat)
            D, I = kw_index.search(q, min(30, len(proto_keywords)))
            sims = 1.0 / (1.0 + D[0])
            pairs = [(proto_keywords[int(i)], float(s)) for i, s in zip(I[0], sims)]
        else:
            diff = proto_mat - q
            dists = np.sum(diff * diff, axis=1)
            order = np.argsort(dists)[: min(30, len(proto_keywords))]
            sims = 1.0 / (1.0 + dists[order])
            pairs = [(proto_keywords[int(i)], float(s)) for i, s in zip(order, sims)]

        picked = [(kw, s) for (kw, s) in pairs if s >= sim_threshold][:max_keywords_per_image]
        if picked:
            meta["keywords_estimate"] = [p[0] for p in picked]
            meta["keywords_estimate_scores"] = [p[1] for p in picked]
