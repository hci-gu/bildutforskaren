import os
import sys
import logging
import json
import hashlib
import umap
import re
import pickle
from datetime import datetime
from pathlib import Path
from typing import List

import pandas as pd
import numpy as np
import torch
import faiss
from flask import Flask, request, jsonify, send_file, abort
from flask_cors import CORS
from PIL import Image
from transformers import CLIPProcessor, CLIPModel

# ✅ NEW: PCA backend caching + reprojection
from sklearn.decomposition import PCA


METADATA_FILE = Path("metadata.xlsx")  # adjust path to your actual Excel file
EXCEL_METADATA = {}

if METADATA_FILE.exists():
    xl = pd.read_excel(METADATA_FILE, sheet_name=None, header=2)  # loads all sheets
    for sheet, df in xl.items():
        df = df.fillna("")  # optional: replace NaNs
        EXCEL_METADATA[sheet] = df
    logging.info("Loaded metadata for sheets: %s", list(EXCEL_METADATA.keys()))
else:
    logging.warning("Metadata file %s not found", METADATA_FILE)

# ── Logging ───────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    stream=sys.stdout,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

# ── Config ────────────────────────────────────────────────────────────────
IMAGE_ROOT = Path("out")  # thumbnails / working copies
ORIGINAL_ROOT = Path("images")  # mirror tree with full-res originals
IMAGE_TYPES = {".jpg", ".jpeg", ".png"}
BATCH_SIZE = 32  # embed N images at once
TOP_K = 100  # default search size

CACHE_DIR = Path(".cache")  # where we persist embeddings
CACHE_FILE = CACHE_DIR / "clip_index.npz"  # compressed NumPy archive
CACHE_DIR.mkdir(exist_ok=True)

UMAP_CACHE_FILE = CACHE_DIR / "umap_cache.pkl"  # where every UMAP layout is kept
UMAP_CACHE_VERSION = 4

# ✅ NEW: PCA cache config
PCA_DIM = 50
PCA_CACHE_FILE = CACHE_DIR / f"clip_pca_{PCA_DIM}.npz"
PCA_MODEL_FILE = CACHE_DIR / f"clip_pca_{PCA_DIM}_model.pkl"

try:
    with UMAP_CACHE_FILE.open("rb") as fh:
        umap_cache: dict = pickle.load(fh)
        logging.info("Loaded %s UMAP layouts from cache", len(umap_cache))
except FileNotFoundError:
    umap_cache = {}

# ── Load CLIP ─────────────────────────────────────────────────────────────
logging.info("Loading CLIP model …")

device = "cuda" if torch.cuda.is_available() else "cpu"
model = CLIPModel.from_pretrained("openai/clip-vit-large-patch14").to(device)
processor = CLIPProcessor.from_pretrained("openai/clip-vit-large-patch14", from_tf=True)

# ── Flask app ─────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

# ── Helpers ───────────────────────────────────────────────────────────────
def extract_year(date_str: str) -> str | None:
    if not date_str or not isinstance(date_str, str):
        return None

    date_str = date_str.strip().lower()

    # Try direct datetime parsing for known formats
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y"):
        try:
            dt = datetime.strptime(date_str, fmt)
            return str(dt.year)
        except ValueError:
            pass

    # Match years like '1905', '1946', '2022'
    m = re.search(r"\b(18|19|20)\d{2}\b", date_str)
    if m:
        return m.group(0)

    # Match ranges like '1914–1915' or '1914-1915' → take first year
    m = re.search(r"\b(18|19|20)\d{2}[-–](18|19|20)\d{2}\b", date_str)
    if m:
        return m.group(1)

    # Match numeric dates like '19370826' (yyyymmdd)
    m = re.match(r"^(18|19|20)\d{6}$", date_str)
    if m:
        return date_str[:4]

    # Match float representations like '1923.0'
    m = re.match(r"^(18|19|20)\d{2}\.0$", date_str)
    if m:
        return date_str.split(".")[0]

    # Match months in Swedish (e.g., "mars 1980", "oktober 1976")
    m = re.search(r"(18|19|20)\d{2}", date_str)
    if m:
        return m.group(0)

    return None


def extract_metadata(path: Path) -> dict:
    parts = path.relative_to(IMAGE_ROOT).parts
    folder = parts[1]
    photographer_id = ""
    if parts[0] == "Arnold Glöckners fotoarkiv":
        photographer_id = "1"
    else:
        if parts[1].startswith("K 1"):
            photographer_id = "2"
        elif parts[1].startswith("K 2"):
            photographer_id = "3"
        elif parts[1].startswith("K 3"):
            photographer_id = "4"

    meta = {
        "filename": path.name,
        "photographer": photographer_id,
    }

    stem = Path(path).stem
    digits = stem.split("_")[-1]  # assume last part is the image number
    image_id = digits.lstrip("0")
    sheet_data = EXCEL_METADATA.get(folder)
    if sheet_data is not None and image_id is not None:
        if image_id.isdigit():
            image_id = int(image_id)

        row_data = sheet_data[sheet_data[sheet_data.columns[0]] == image_id]

        date = (
            row_data["Datering"].values[0]
            if "Datering" in row_data and not row_data["Datering"].empty
            else None
        )
        description = (
            row_data["Beskrivning"].values[0]
            if "Beskrivning" in row_data and not row_data["Beskrivning"].empty
            else None
        )
        date_str = str(date) if date is not None else ""
        year = extract_year(date_str)
        if year is not None:
            decade = year[:3] + "0" if year and len(year) >= 3 else None
            meta["decade"] = decade

        keywords = []
        for col in sheet_data.columns[12:]:
            if col in row_data and not row_data[col].empty:
                value = row_data[col].values[0]
                if isinstance(value, str) and value.strip():
                    keywords.append(value.strip())
        meta["keywords"] = keywords
        meta["date"] = date_str
        meta["year"] = year
        meta["description"] = description

    return meta


def collect_image_paths(root: Path) -> List[Path]:
    """Recursively gather all image files under *root*, sorted for stable IDs."""
    return sorted(p for p in root.rglob("*") if p.suffix.lower() in IMAGE_TYPES)


def embed_images(paths: List[Path]) -> torch.Tensor:
    """Return a (N,512/768) tensor of CLIP embeddings for *paths* (batched)."""
    all_embeddings = []
    for i in range(0, len(paths), BATCH_SIZE):
        logging.info("Embedding %s images (%s/%s)", BATCH_SIZE, i, len(paths))
        batch_paths = paths[i : i + BATCH_SIZE]
        imgs = [Image.open(p).convert("RGB") for p in batch_paths]
        inputs = processor(images=imgs, return_tensors="pt", padding=True).to(device)
        with torch.no_grad():
            feats = model.get_image_features(**inputs)
            feats = feats / feats.norm(dim=-1, keepdim=True)
        all_embeddings.append(feats.cpu())
    return torch.cat(all_embeddings, dim=0)


def save_cache(emb: torch.Tensor, paths: List[Path]):
    np.savez_compressed(
        CACHE_FILE,
        embeddings=emb.numpy().astype("float32"),
        paths=np.array([str(p) for p in paths]),
    )
    logging.info("Saved %s embeddings → %s", len(paths), CACHE_FILE)


def load_cache():
    if not CACHE_FILE.exists():
        return None, None
    data = np.load(CACHE_FILE, allow_pickle=True)
    cached_paths = list(data["paths"].tolist())
    embeddings = torch.from_numpy(data["embeddings"])
    return cached_paths, embeddings


def build_index(emb: torch.Tensor) -> faiss.Index:
    emb_np = emb.numpy()
    dim = emb_np.shape[1]
    index = faiss.IndexFlatL2(dim)
    index.add(emb_np)
    return index


# ✅ NEW: PCA cache helpers
def save_pca_cache(pca_embeddings: np.ndarray, paths: List[Path]):
    np.savez_compressed(
        PCA_CACHE_FILE,
        embeddings=pca_embeddings.astype("float32"),
        paths=np.array([str(p) for p in paths]),
        dim=np.array([pca_embeddings.shape[1]], dtype=np.int32),
    )
    logging.info("Saved PCA(%s) embeddings → %s", pca_embeddings.shape[1], PCA_CACHE_FILE)


def load_pca_cache():
    if not PCA_CACHE_FILE.exists():
        return None, None
    data = np.load(PCA_CACHE_FILE, allow_pickle=True)
    cached_paths = list(data["paths"].tolist())
    pca_emb = data["embeddings"].astype("float32")
    return cached_paths, pca_emb


def compute_and_cache_pca(embeddings: torch.Tensor, paths: List[Path], k: int = PCA_DIM):
    """
    Fit PCA on full embeddings and cache BOTH:
      - PCA projected embeddings (N, k) in PCA_CACHE_FILE
      - PCA model in PCA_MODEL_FILE (so we can transform text query embeddings)
    """
    X = embeddings.numpy().astype("float32")

    # randomized PCA is fast and good enough here
    pca = PCA(n_components=k, svd_solver="randomized", random_state=1)
    X_pca = pca.fit_transform(X).astype("float32")

    with PCA_MODEL_FILE.open("wb") as fh:
        pickle.dump(pca, fh)
    logging.info("Saved PCA model → %s", PCA_MODEL_FILE)

    save_pca_cache(X_pca, paths)
    return X_pca


def get_or_build_pca_embeddings(embeddings: torch.Tensor, paths: List[Path], k: int = PCA_DIM):
    cached_paths, pca_emb = load_pca_cache()
    if cached_paths == [str(p) for p in paths] and pca_emb is not None and pca_emb.shape[1] == k:
        logging.info("Using cached PCA(%s) embeddings (cold-start avoided)", k)
        return pca_emb

    logging.info("PCA cache missing/stale — computing PCA(%s) …", k)
    return compute_and_cache_pca(embeddings, paths, k=k)


def infer_missing_years(
    embeddings: torch.Tensor,
    metadata: list[dict],
    min_samples_per_year: int = 5,
) -> None:
    """
    Annotate images whose metadata lacks 'year' with 'year_estimate'.

    Adds two keys to *metadata[i]* where applicable:
        year_estimate: int   – the most likely year
        year_estimate_distance: float – L2 distance to that year's centroid
    Works in-place; returns nothing.
    """
    year_to_indices: dict[int, list[int]] = {}
    for idx, meta in enumerate(metadata):
        y = meta.get("year")
        if y and str(y).isdigit():
            y_int = int(y)
            year_to_indices.setdefault(y_int, []).append(idx)

    if not year_to_indices:
        logging.warning("No images with explicit year metadata found.")
        return

    emb_np = embeddings.numpy()
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
        logging.warning("No year had ≥%s samples; aborting inference.", min_samples_per_year)
        return

    centroids_np = np.stack(centroids).astype("float32")

    dim = centroids_np.shape[1]
    year_index = faiss.IndexFlatL2(dim)
    year_index.add(centroids_np)
    years_arr = np.array(years)

    for idx, meta in enumerate(metadata):
        if meta.get("year"):
            continue

        q = emb_np[idx : idx + 1].astype("float32")
        D, I = year_index.search(q, 1)
        nearest_id = int(I[0, 0])
        meta["year_estimate"] = int(years_arr[nearest_id])
        meta["year_estimate_distance"] = float(D[0, 0])

    logging.info(
        "Year inference complete. %s images were annotated.",
        sum(1 for m in metadata if "year_estimate" in m),
    )


def _normalise_keyword(word: str) -> str:
    return re.sub(r"\s+", " ", word.strip().lower())


def _clip_text_embed(prompts: list[str]) -> np.ndarray:
    with torch.no_grad():
        inputs = processor(text=prompts, return_tensors="pt", padding=True).to(device)
        txt = model.get_text_features(**inputs)
        txt = txt / txt.norm(dim=-1, keepdim=True)
    return txt.cpu().numpy().astype("float32")


def _parse_umap_params(params: dict) -> dict:
    def _get(name: str, cast, default):
        val = params.get(name, default)
        try:
            return cast(val)
        except (TypeError, ValueError):
            raise ValueError(f"Invalid '{name}'")

    return {
        "n_neighbors": _get("n_neighbors", int, 15),
        "min_dist": _get("min_dist", float, 0.1),
        "n_components": _get("n_components", int, 2),
        "seed": _get("seed", int, 42),
        "spread": _get("spread", float, 1.0),
        "text_k": _get("text_k", int, 25),
    }


def _umap_cache_key(image_ids: list[int], texts: list[str], params: dict) -> str:
    payload = {
        "image_ids": image_ids,
        "texts": texts,
        "params": params,
        "v": UMAP_CACHE_VERSION,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return f"post:{hashlib.sha256(encoded.encode('utf-8')).hexdigest()}"


def _l2_normalize_rows(arr: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms = np.maximum(norms, 1e-12)
    return arr / norms


def infer_missing_keywords(
    embeddings: torch.Tensor,
    metadata: list[dict],
    *,
    min_images_per_kw: int = 5,
    max_keywords_per_image: int = 5,
    sim_threshold: float = 0.25,
    blend_text_prior: bool = True,
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
        logging.warning("No ground-truth keywords available; aborting inference.")
        return

    emb_np = embeddings.numpy()
    emb_np /= np.linalg.norm(emb_np, axis=1, keepdims=True)

    proto_vecs, proto_keywords = [], []
    text_prompts = []

    for kw, idxs in kw_to_indices.items():
        if len(idxs) < min_images_per_kw:
            continue
        img_centroid = emb_np[idxs].mean(axis=0)
        img_centroid /= np.linalg.norm(img_centroid)

        if blend_text_prior:
            text_prompts.append(f"a photo of {kw}")
            proto_keywords.append(kw)
            proto_vecs.append(img_centroid)
        else:
            proto_keywords.append(kw)
            proto_vecs.append(img_centroid.astype("float32"))

    if not proto_vecs:
        logging.warning("No keyword met min_images_per_kw=%s", min_images_per_kw)
        return

    if blend_text_prior:
        txt_emb = _clip_text_embed(text_prompts)
        for i in range(len(proto_vecs)):
            v = (1.0 - text_prior_weight) * proto_vecs[i] + text_prior_weight * txt_emb[i]
            v /= np.linalg.norm(v)
            proto_vecs[i] = v.astype("float32")

    proto_mat = np.stack(proto_vecs).astype("float32")

    dim = proto_mat.shape[1]
    kw_index = faiss.IndexFlatL2(dim)
    kw_index.add(proto_mat)

    for idx, meta in enumerate(metadata):
        if meta.get("keywords"):
            continue

        q = emb_np[idx : idx + 1].astype("float32")
        D, I = kw_index.search(q, 30)
        sims = 1.0 / (1.0 + D[0])

        picked = [
            (proto_keywords[int(i)], float(s))
            for i, s in zip(I[0], sims)
            if s >= sim_threshold
        ][:max_keywords_per_image]

        if picked:
            meta["keywords_estimate"] = [p[0] for p in picked]
            meta["keywords_estimate_scores"] = [p[1] for p in picked]

    logging.info(
        "Keyword inference complete. %s images received estimates.",
        sum(1 for m in metadata if "keywords_estimate" in m),
    )


# ── One-time start-up ─────────────────────────────────────────────────────
logging.info("Scanning image tree …")
image_paths: List[Path] = collect_image_paths(IMAGE_ROOT)
logging.info("Found %s files in %s", len(image_paths), IMAGE_ROOT)
metadata = [extract_metadata(p) for p in image_paths]

cached_paths, embeddings = load_cache()

if cached_paths == [str(p) for p in image_paths]:
    logging.info("Using cached embeddings (cold-start avoided)")
else:
    if cached_paths is None:
        logging.info("No cache present — embedding images for the first time …")
    else:
        logging.info("Image set changed — re-embedding entire collection …")
    embeddings = embed_images(image_paths)
    save_cache(embeddings, image_paths)

# ✅ NEW: build/load PCA embeddings + model (for text route)
pca_embeddings_np = get_or_build_pca_embeddings(embeddings, image_paths, k=PCA_DIM)
with PCA_MODEL_FILE.open("rb") as fh:
    pca_model = pickle.load(fh)
logging.info("Loaded PCA model from %s", PCA_MODEL_FILE)

faiss_index = build_index(embeddings)
logging.info("Index has %s vectors of dim %s", faiss_index.ntotal, faiss_index.d)
logging.info("FAISS index ready\n")

infer_missing_years(embeddings, metadata)
infer_missing_keywords(
    embeddings,
    metadata,
    min_images_per_kw=5,
    max_keywords_per_image=3,
    sim_threshold=0.25,
    blend_text_prior=False,
    text_prior_weight=0.30,
)

# ── Routes ────────────────────────────────────────────────────────────────
@app.route("/embeddings", methods=["GET"])
def get_embeddings():
    """
    By default returns PCA embeddings (PCA_DIM) for speed.
    Use ?full=1 to return original embeddings.
    """
    full = request.args.get("full", "0") == "1"

    if full:
        embs = embeddings.numpy()
        logging.info("Serving FULL embeddings (%s dims) for %s images", embs.shape[1], len(embs))
    else:
        embs = pca_embeddings_np
        logging.info("Serving PCA embeddings (%s dims) for %s images", embs.shape[1], len(embs))

    return jsonify(
        [
            {
                "id": idx,
                "embedding": embs[idx].tolist(),
                "metadata": metadata[idx],
            }
            for idx in range(len(embs))
        ]
    )


@app.route("/metadata", methods=["GET"])
def get_all_metadata():
    return jsonify(metadata)


@app.route("/embedding/<int:image_id>", methods=["GET"])
def get_embedding(image_id):
    if 0 <= image_id < len(embeddings):
        return jsonify(embeddings[image_id].tolist())
    abort(404, description="Image ID not found")


@app.route("/embedding-for-text", methods=["GET"])
def get_embedding_for_text():
    """
    By default returns PCA_DIM vector to match /embeddings.
    Use ?full=1 to return original text embedding dimension.
    """
    query = request.args.get("query", "").strip()
    if not query:
        return jsonify({"error": "Missing 'query'"}), 400

    full = request.args.get("full", "0") == "1"

    inputs = processor(text=[query], return_tensors="pt", padding=True).to(device)
    with torch.no_grad():
        txt = model.get_text_features(**inputs)
        txt = txt / txt.norm(dim=-1, keepdim=True)

    txt_np = txt.cpu().numpy().astype("float32")  # (1, D)

    if full:
        return jsonify(txt_np.reshape(-1).tolist())

    txt_pca = pca_model.transform(txt_np).astype("float32")  # (1, PCA_DIM)
    return jsonify(txt_pca.reshape(-1).tolist())


@app.route("/search", methods=["GET"])
def search():
    query = request.args.get("query", "").strip()
    k = int(request.args.get("top_k", TOP_K))

    if not query:
        return jsonify({"error": "Missing 'query'"}), 400

    k = max(1, min(k, len(image_paths)))

    inputs = processor(text=[query], return_tensors="pt").to(device)
    with torch.no_grad():
        txt = model.get_text_features(**inputs)
        txt = txt / txt.norm(dim=-1, keepdim=True)

    q = txt.cpu().numpy().reshape(1, -1)
    D, I = faiss_index.search(q, k)

    results = [{"id": int(idx), "distance": float(dist)} for idx, dist in zip(I[0], D[0])]
    return jsonify(results)


@app.route("/search-by-image", methods=["POST"])
def search_by_image():
    if "file" not in request.files:
        return jsonify({"error": "Missing 'file' field"}), 400

    file = request.files["file"]

    try:
        img = Image.open(file.stream).convert("RGB")
    except Exception:
        return jsonify({"error": "Could not read image"}), 400

    with torch.no_grad():
        inputs = processor(images=[img], return_tensors="pt").to(device)
        img_feat = model.get_image_features(**inputs)
        img_feat = img_feat / img_feat.norm(dim=-1, keepdim=True)

    try:
        k = int(request.form.get("top_k", TOP_K))
    except ValueError:
        return jsonify({"error": "'top_k' must be an integer"}), 400

    k = max(1, min(k, len(image_paths)))

    q = img_feat.cpu().numpy().astype("float32")
    D, I = faiss_index.search(q, k)

    results = [{"id": int(idx), "distance": float(dist)} for idx, dist in zip(I[0], D[0])]
    return jsonify(results)


@app.route("/images", methods=["GET"])
def list_images():
    return jsonify(list(range(len(image_paths))))


@app.route("/umap", methods=["GET", "POST"])
def get_umap():
    """
    GET: legacy image-only UMAP (returns list of points).
    POST: {image_ids: int[], texts: string[], params: {...}} -> returns points for both.
    """
    if request.method == "POST":
        payload = request.get_json(silent=True) or {}
        try:
            params = _parse_umap_params(payload.get("params", {}))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        texts = payload.get("texts", [])
        if texts is None:
            texts = []
        if not isinstance(texts, list) or any(not isinstance(t, str) for t in texts):
            return jsonify({"error": "'texts' must be a list of strings"}), 400
        texts = [t.strip() for t in texts if t.strip()]

        image_ids = payload.get("image_ids")
        if image_ids is None:
            image_ids = list(range(len(pca_embeddings_np)))
        if not isinstance(image_ids, list) or any(not isinstance(i, int) for i in image_ids):
            return jsonify({"error": "'image_ids' must be a list of integers"}), 400
        if any(i < 0 or i >= len(pca_embeddings_np) for i in image_ids):
            return jsonify({"error": "One or more image_ids are out of range"}), 400

        if not image_ids and not texts:
            return jsonify({"error": "No image_ids or texts provided"}), 400

        key = _umap_cache_key(image_ids, texts, params)
        if key in umap_cache:
            logging.info("UMAP cache hit %s", key)
            return jsonify(umap_cache[key])

        logging.info("UMAP cache miss %s - computing layout …", key)

        reducer = umap.UMAP(
            n_neighbors=params["n_neighbors"],
            min_dist=params["min_dist"],
            n_components=params["n_components"],
            spread=params["spread"],
            metric="cosine",
            transform_seed=params["seed"],
        )

        # ✅ IMPORTANT: run UMAP on PCA space (much faster)
        image_vectors = embeddings.numpy()[image_ids].astype("float32")
        image_vectors = _l2_normalize_rows(image_vectors)

        embedding = reducer.fit_transform(image_vectors).tolist()
        image_points = embedding

        text_points = []
        if texts:
            text_vectors_full = _clip_text_embed(texts)  # (T, D)
            image_points_np = np.array(image_points, dtype="float32")
            id_to_point = {img_id: image_points_np[i] for i, img_id in enumerate(image_ids)}
            allowed_ids = set(image_ids)

            k = max(1, min(params["text_k"], len(image_ids)))

            for tvec in text_vectors_full:
                q = tvec.reshape(1, -1).astype("float32")
                D, I = faiss_index.search(q, k)
                hit_ids = [int(i) for i in I[0].tolist() if i != -1]

                if allowed_ids:
                    hit_ids = [i for i in hit_ids if i in allowed_ids]
                    if not hit_ids:
                        # fallback to global hits if filter excludes all
                        hit_ids = [int(i) for i in I[0].tolist() if i != -1]

                points = [id_to_point[i] for i in hit_ids if i in id_to_point]
                if not points:
                    text_points.append(image_points_np.mean(axis=0).tolist())
                else:
                    avg = np.mean(points, axis=0)
                    text_points.append(avg.tolist())

        response = {
            "image_ids": image_ids,
            "image_points": image_points,
            "text_points": text_points,
            "params": params,
        }

        umap_cache[key] = response
        try:
            with UMAP_CACHE_FILE.open("wb") as fh:
                pickle.dump(umap_cache, fh)
            logging.info("UMAP layout stored - cache size now %s", len(umap_cache))
        except Exception as exc:
            logging.warning("Could not write UMAP cache: %s", exc)

        return jsonify(response)

    try:
        params = _parse_umap_params(request.args)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    key = (
        UMAP_CACHE_VERSION,
        params["n_neighbors"],
        params["min_dist"],
        params["n_components"],
        params["seed"],
        params["spread"],
    )

    if key in umap_cache:
        logging.info("UMAP cache hit %s", key)
        return jsonify(umap_cache[key])

    logging.info("UMAP cache miss %s - computing layout …", key)

    reducer = umap.UMAP(
        n_neighbors=params["n_neighbors"],
        min_dist=params["min_dist"],
        n_components=params["n_components"],
        spread=params["spread"],
        metric="cosine",
        transform_seed=params["seed"],
    )

    # ✅ IMPORTANT: run UMAP on PCA space (much faster)
    base_vectors = _l2_normalize_rows(embeddings.numpy().astype("float32"))
    embedding = reducer.fit_transform(base_vectors).tolist()

    umap_cache[key] = embedding
    try:
        with UMAP_CACHE_FILE.open("wb") as fh:
            pickle.dump(umap_cache, fh)
        logging.info("UMAP layout stored - cache size now %s", len(umap_cache))
    except Exception as exc:
        logging.warning("Could not write UMAP cache: %s", exc)

    return jsonify(embedding)


@app.route("/image/<int:image_id>", methods=["GET"])
def serve_image(image_id):
    if 0 <= image_id < len(image_paths):
        return send_file(image_paths[image_id])
    abort(404, description="Image not found")


@app.route("/original/<int:image_id>", methods=["GET"])
def serve_original(image_id):
    if 0 <= image_id < len(image_paths):
        try:
            rel = image_paths[image_id].relative_to(IMAGE_ROOT)
        except ValueError:
            abort(404, description="Mapping error")
        original = ORIGINAL_ROOT / rel
        if original.exists():
            return send_file(original)
        abort(404, description="Original image not found")
    abort(404, description="Image ID not found")


# ── Boot ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000, debug=False)
