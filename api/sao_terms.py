from __future__ import annotations

import csv
import difflib
import hashlib
import logging
import time
import unicodedata
from pathlib import Path

import numpy as np

from api import clip_service
from api import config

_TERMS: list[dict] | None = None
_LABELS_NORM: list[str] | None = None
_EMBEDDINGS: np.ndarray | None = None
_EMBEDDINGS_HASH: str | None = None

_PROMPT_TEMPLATE = "Ett fotografi som visar {label}."
_PROMPT_VERSION = "sao_prompt_v1"
_UMAP_VERSION = "sao_umap_v2"


def normalize_label(text: str) -> str:
    text = text.strip().lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = " ".join(text.split())
    return text


def _load_terms(path: Path) -> tuple[list[dict], list[str]]:
    terms: list[dict] = []
    labels_norm: list[str] = []
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            label = (row.get("prefLabel") or "").strip()
            if not label:
                continue
            scope = (row.get("scopeNote") or "").strip()
            term = {
                "id": (row.get("controlNumber") or "").strip(),
                "label": label,
                "scope_note": scope,
            "label_norm": normalize_label(label),
            "scope_norm": normalize_label(scope) if scope else "",
            }
            terms.append(term)
            labels_norm.append(term["label_norm"])
    return terms, labels_norm


def get_terms() -> tuple[list[dict], list[str]]:
    global _TERMS, _LABELS_NORM
    if _TERMS is None or _LABELS_NORM is None:
        path = config.REPO_ROOT / "sao_terms.csv"
        _TERMS, _LABELS_NORM = _load_terms(path)
    return _TERMS, _LABELS_NORM


def _labels_hash(terms: list[dict]) -> str:
    payload = "\n".join(t["label_norm"] for t in terms)
    payload = f"{_PROMPT_VERSION}\n{_PROMPT_TEMPLATE}\n{payload}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _cache_path() -> Path:
    return config.REPO_ROOT / ".cache" / "sao_terms_embeddings.npz"


def _umap_cache_path() -> Path:
    return config.REPO_ROOT / ".cache" / "sao_terms_umap.npz"


def _load_embeddings_from_cache(path: Path, expected_hash: str) -> np.ndarray | None:
    if not path.exists():
        return None
    try:
        data = np.load(path, allow_pickle=False)
        cached_raw = data.get("labels_hash")
        cached_hash = cached_raw.item() if cached_raw is not None else ""
        embeddings = data.get("embeddings")
        if cached_hash != expected_hash or embeddings is None:
            return None
        return embeddings.astype("float32", copy=False)
    except Exception:
        return None


def _save_embeddings_cache(path: Path, embeddings: np.ndarray, labels_hash: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, embeddings=embeddings, labels_hash=np.array(labels_hash))


def ensure_embeddings() -> np.ndarray:
    global _EMBEDDINGS, _EMBEDDINGS_HASH
    if _EMBEDDINGS is not None:
        return _EMBEDDINGS

    terms, _ = get_terms()
    labels_hash = _labels_hash(terms)
    cache_path = _cache_path()

    cached = _load_embeddings_from_cache(cache_path, labels_hash)
    if cached is not None:
        _EMBEDDINGS = cached
        _EMBEDDINGS_HASH = labels_hash
        logging.info("Loaded SAO term embeddings from cache (%s)", cache_path)
        return _EMBEDDINGS

    labels = [t["label"] for t in terms]
    if not labels:
        _EMBEDDINGS = np.empty((0, 0), dtype="float32")
        _EMBEDDINGS_HASH = labels_hash
        return _EMBEDDINGS

    prompts = [_PROMPT_TEMPLATE.format(label=label) for label in labels]
    logging.info("Computing SAO term embeddings (%s terms)…", len(prompts))
    batch_size = 256
    chunks: list[np.ndarray] = []
    for i in range(0, len(prompts), batch_size):
        batch = prompts[i : i + batch_size]
        chunks.append(clip_service.embed_text(batch))
    embeddings = np.vstack(chunks).astype("float32")
    _save_embeddings_cache(cache_path, embeddings, labels_hash)
    logging.info("Saved SAO term embeddings → %s", cache_path)

    _EMBEDDINGS = embeddings
    _EMBEDDINGS_HASH = labels_hash
    return _EMBEDDINGS


def get_embeddings() -> tuple[np.ndarray, list[dict]]:
    embeddings = ensure_embeddings()
    terms, _ = get_terms()
    return embeddings, terms


def get_umap_points(
    *,
    n_neighbors: int = 15,
    min_dist: float = 0.1,
    seed: int = 42,
) -> np.ndarray:
    embeddings, terms = get_embeddings()
    if embeddings.size == 0:
        return np.empty((0, 2), dtype="float32")

    labels_hash = _labels_hash(terms)
    cache_path = _umap_cache_path()
    if cache_path.exists():
        try:
            data = np.load(cache_path, allow_pickle=False)
            cached_hash = data.get("labels_hash")
            cached_hash = cached_hash.item() if cached_hash is not None else ""
            cached_neighbors = data.get("n_neighbors")
            cached_min_dist = data.get("min_dist")
            cached_seed = data.get("seed")
            cached_version = data.get("version")
            points = data.get("points")
            if (
                cached_hash == labels_hash
                and points is not None
                and cached_neighbors is not None
                and cached_min_dist is not None
                and cached_seed is not None
                and cached_version is not None
                and int(cached_neighbors[0]) == int(n_neighbors)
                and float(cached_min_dist[0]) == float(min_dist)
                and int(cached_seed[0]) == int(seed)
                and str(cached_version[0]) == _UMAP_VERSION
            ):
                logging.info("Loaded SAO UMAP from cache (%s)", cache_path)
                return points.astype("float32", copy=False)
        except Exception:
            pass

    try:
        import umap  # type: ignore
    except Exception as exc:
        raise RuntimeError("UMAP dependency not available") from exc

    logging.info(
        "Computing SAO UMAP (%s terms, n_neighbors=%s, min_dist=%s, seed=%s)…",
        len(terms),
        n_neighbors,
        min_dist,
        seed,
    )
    started = time.time()
    reducer = umap.UMAP(
        n_neighbors=int(n_neighbors),
        min_dist=float(min_dist),
        n_components=2,
        metric="cosine",
        transform_seed=int(seed),
    )

    points = reducer.fit_transform(embeddings).astype("float32")
    min_xy = points.min(axis=0)
    max_xy = points.max(axis=0)
    span = np.maximum(1e-6, max_xy - min_xy)
    points = (points - min_xy) / span
    elapsed = time.time() - started
    logging.info("Computed SAO UMAP in %.1fs", elapsed)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        cache_path,
        points=points,
        labels_hash=np.array(labels_hash),
        n_neighbors=np.array([n_neighbors], dtype=np.int32),
        min_dist=np.array([float(min_dist)], dtype=np.float32),
        seed=np.array([seed], dtype=np.int32),
        version=np.array([_UMAP_VERSION]),
    )
    return points


def search_terms(query: str, limit: int = 50, include_scope: bool = False) -> list[dict]:
    query_norm = normalize_label(query)
    if not query_norm:
        return []

    terms, labels_norm = get_terms()

    matches: list[tuple[tuple[int, int, int, float, int], dict]] = []
    for term in terms:
        label_norm = term["label_norm"]
        scope_norm = term["scope_norm"]
        matched_label = query_norm in label_norm
        matched_scope = include_scope and query_norm in scope_norm
        prefix_len = 0
        for a, b in zip(query_norm, label_norm):
            if a != b:
                break
            prefix_len += 1
        min_prefix = 3 if len(query_norm) >= 3 else len(query_norm)
        matched_prefix = prefix_len >= min_prefix

        if matched_label or matched_scope or matched_prefix:
            prefix_rank = 0 if matched_prefix or label_norm.startswith(query_norm) else 1
            contains = 0 if matched_label else 1
            ratio = difflib.SequenceMatcher(None, query_norm, label_norm).ratio()
            length_delta = abs(len(label_norm) - len(query_norm))
            matches.append(((prefix_rank, -prefix_len, contains, -ratio, length_delta), term))

    matches.sort(key=lambda x: (x[0], x[1]["label"]))
    results = [term for _, term in matches[:limit]]

    if len(results) < limit and len(query_norm) >= 3:
        close = difflib.get_close_matches(query_norm, labels_norm, n=limit, cutoff=0.75)
        if close:
            existing = {t["label_norm"] for t in results}
            for label_norm in close:
                if label_norm in existing:
                    continue
                idx = labels_norm.index(label_norm)
                results.append(terms[idx])
                existing.add(label_norm)
                if len(results) >= limit:
                    break

    return [
        {
            "id": term["id"],
            "label": term["label"],
            "scope_note": term["scope_note"],
        }
        for term in results[:limit]
    ]
