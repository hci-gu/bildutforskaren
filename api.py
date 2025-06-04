import os
import sys
import logging
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
logging.basicConfig(level=logging.INFO, stream=sys.stdout,
                    format="%(asctime)s [%(levelname)s] %(message)s")

# ── Config ────────────────────────────────────────────────────────────────
IMAGE_ROOT    = Path("out")                  # thumbnails / working copies
ORIGINAL_ROOT = Path("/Volumes/T7/Riksarkivet")             # mirror tree with full-res originals
IMAGE_TYPES   = {".jpg", ".jpeg", ".png"}
BATCH_SIZE    = 32                               # embed N images at once
TOP_K         = 100                               # default search size

CACHE_DIR     = Path(".cache")                  # where we persist embeddings
CACHE_FILE    = CACHE_DIR / "clip_index.npz"     # compressed NumPy archive
CACHE_DIR.mkdir(exist_ok=True)

UMAP_CACHE_FILE = CACHE_DIR / "umap_cache.pkl"   # where every UMAP layout is kept
try:
    with UMAP_CACHE_FILE.open("rb") as fh:
        umap_cache: dict[tuple, list] = pickle.load(fh)
        logging.info("Loaded %s UMAP layouts from cache", len(umap_cache))
except FileNotFoundError:
    umap_cache = {}

# ── Load CLIP ─────────────────────────────────────────────────────────────
logging.info("Loading CLIP model …")

device     = "cuda" if torch.cuda.is_available() else "mps"
model      = CLIPModel.from_pretrained("openai/clip-vit-large-patch14").to(device)
processor  = CLIPProcessor.from_pretrained("openai/clip-vit-large-patch14")

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
    photographer_id = ''
    if parts[0] == 'Arnold Glöckners fotoarkiv':
        photographer_id = '1'
    else:
        if parts[1].startswith('K 1'):
            photographer_id = '2'
        elif parts[1].startswith('K 2'):
            photographer_id = '3'
        elif parts[1].startswith('K 3'):
            photographer_id = '4'

    meta = {
        "filename": path.name,
        "photographer": photographer_id,
    }

    stem = Path(path).stem
    digits = stem.split("_")[-1]  # assume last part is the image number
    # remove leading zeros
    image_id = digits.lstrip("0")
    sheet_data = EXCEL_METADATA.get(folder)
    if sheet_data is not None and image_id is not None:
        # if image_id only contains digits, convert to int
        if image_id.isdigit():
            image_id = int(image_id)
                    
        row_data = sheet_data[sheet_data[sheet_data.columns[0]] == image_id]
        date = row_data["Datering"].values[0] if "Datering" in row_data and not row_data["Datering"].empty else None
        description = row_data["Beskrivning"].values[0] if "Beskrivning" in row_data and not row_data["Beskrivning"].empty else None
        date_str = str(date) if date is not None else ""
        year = extract_year(date_str)
        if year is not None:
            decade = year[:3] + "0" if year and len(year) >= 3 else None
            meta['decade'] = decade

        meta['date'] = date_str
        meta['year'] = year
        meta['description'] = description

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
    embeddings   = torch.from_numpy(data["embeddings"])
    return cached_paths, embeddings

def build_index(emb: torch.Tensor) -> faiss.Index:
    emb_np = emb.numpy()
    dim = emb_np.shape[1]
    index = faiss.IndexFlatL2(dim)
    index.add(emb_np)
    return index

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
    # --- 1. collect indices by year --------------------------------------
    year_to_indices: dict[int, list[int]] = {}
    for idx, meta in enumerate(metadata):
        y = meta.get("year")
        if y and str(y).isdigit():
            y_int = int(y)
            year_to_indices.setdefault(y_int, []).append(idx)

    if not year_to_indices:
        logging.warning("No images with explicit year metadata found.")
        return

    # --- 2. build centroids ---------------------------------------------
    emb_np = embeddings.numpy()
    emb_np /= np.linalg.norm(emb_np, axis=1, keepdims=True)  # cosine unit length

    centroids, years = [], []
    for y, idxs in year_to_indices.items():
        if len(idxs) < min_samples_per_year:
            continue                    # skip very small classes – often noise
        c = emb_np[idxs].mean(axis=0)
        c /= np.linalg.norm(c)          # keep them on the unit sphere
        centroids.append(c.astype("float32"))
        years.append(y)

    if not centroids:
        logging.warning("No year had ≥%s samples; aborting inference.", min_samples_per_year)
        return

    centroids_np = np.stack(centroids).astype("float32")

    # --- 3. tiny FAISS index over centroids ------------------------------
    dim = centroids_np.shape[1]
    year_index = faiss.IndexFlatL2(dim)
    year_index.add(centroids_np)
    years_arr = np.array(years)         # so we can map FAISS ids → year ints

    # --- 4. annotate unlabelled images -----------------------------------
    for idx, meta in enumerate(metadata):
        if meta.get("year"):            # already has a ground-truth year
            continue

        q = emb_np[idx : idx + 1].astype("float32")   # shape (1, dim)
        D, I = year_index.search(q, 1)                # nearest centroid
        nearest_id = int(I[0, 0])
        meta["year_estimate"] = int(years_arr[nearest_id])
        meta["year_estimate_distance"] = float(D[0, 0])

    logging.info("Year inference complete. %s images were annotated.",
                 sum(1 for m in metadata if "year_estimate" in m))


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

faiss_index = build_index(embeddings)
logging.info("Index has %s vectors of dim %s", faiss_index.ntotal, faiss_index.d)
logging.info("FAISS index ready\n")

infer_missing_years(embeddings, metadata)

# ── Routes ────────────────────────────────────────────────────────────────
@app.route("/embeddings", methods=["GET"])
def get_embeddings():
    print("Serving embeddings for", len(embeddings), "images")
    return jsonify([
        {
            "id": idx,
            "embedding": emb.tolist(),
            "metadata": metadata[idx],
        } for idx, emb in enumerate(embeddings.numpy())
    ])

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
    query = request.args.get("query", "").strip()
    if not query:
        return jsonify({"error": "Missing 'query'"}), 400

    inputs = processor(text=[query], return_tensors="pt").to(device)
    with torch.no_grad():
        txt = model.get_text_features(**inputs)
        txt = txt / txt.norm(dim=-1, keepdim=True)

    return jsonify(txt.cpu().numpy().reshape(-1).tolist())


@app.route("/search", methods=["GET"])
def search():
    query = request.args.get("query", "").strip()
    k = int(request.args.get("top_k", TOP_K))

    if not query:
        return jsonify({"error": "Missing 'query'"}), 400

    # keep k sane
    k = max(1, min(k, len(image_paths)))

    # -------- encode query --------
    inputs = processor(text=[query], return_tensors="pt").to(device)
    with torch.no_grad():
        txt = model.get_text_features(**inputs)
        txt = txt / txt.norm(dim=-1, keepdim=True)

    # -------- search --------
    q = txt.cpu().numpy().reshape(1, -1)
    D, I = faiss_index.search(q, k)          # D: distances, I: indices

    # -------- format result --------
    results = [
        {"id": int(idx), "distance": float(dist)}
        for idx, dist in zip(I[0], D[0])
    ]

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

    # -------- embed query image --------
    with torch.no_grad():
        inputs = processor(images=[img], return_tensors="pt").to(device)
        img_feat = model.get_image_features(**inputs)
        img_feat = img_feat / img_feat.norm(dim=-1, keepdim=True)

    # -------- determine k --------
    try:
        k = int(request.form.get("top_k", TOP_K))
    except ValueError:
        return jsonify({"error": "'top_k' must be an integer"}), 400

    k = max(1, min(k, len(image_paths)))

    # -------- FAISS search --------
    q = img_feat.cpu().numpy().astype("float32")
    D, I = faiss_index.search(q, k)  # D = distances, I = indices

    # -------- format & return --------
    results = [
        {"id": int(idx), "distance": float(dist)}
        for idx, dist in zip(I[0], D[0])
    ]

    return jsonify(results)

@app.route("/images", methods=["GET"])
def list_images():
    return jsonify(list(range(len(image_paths))))

@app.route("/umap", methods=["GET"])
def get_umap():
    # ----- read & normalise parameters -----
    params = {
        "n_neighbors" : int(request.args.get("n_neighbors", 15)),
        "min_dist"    : float(request.args.get("min_dist", 0.1)),
        "n_components": int(request.args.get("n_components", 2)),
        "seed"        : int(request.args.get("seed", 42)),
    }
    key = (params["n_neighbors"],
           params["min_dist"],
           params["n_components"],
           params["seed"])

    # ----- return immediately if we already have it -----
    if key in umap_cache:
        logging.info("UMAP cache hit %s", key)
        return jsonify(umap_cache[key])

    logging.info("UMAP cache miss %s – computing layout …", key)

    # ----- compute fresh layout -----
    reducer = umap.UMAP(
        n_neighbors=params["n_neighbors"],
        min_dist=params["min_dist"],
        n_components=params["n_components"],
        metric="cosine",
        transform_seed=params["seed"],
    )
    embedding = reducer.fit_transform(embeddings.numpy()).tolist()

    # ----- persist in RAM & on disk -----
    umap_cache[key] = embedding
    try:
        with UMAP_CACHE_FILE.open("wb") as fh:
            pickle.dump(umap_cache, fh)
        logging.info("UMAP layout stored – cache size now %s", len(umap_cache))
    except Exception as exc:
        logging.warning("Could not write UMAP cache: %s", exc)

    return jsonify(embedding)

@app.route("/image/<int:image_id>", methods=["GET"])
def serve_image(image_id):
    if 0 <= image_id < len(image_paths):
        return send_file(image_paths[image_id])
    abort(404, description="Image not found")


# ▲▲ Serve full-resolution original ---------------------------------------
@app.route("/original/<int:image_id>", methods=["GET"])
def serve_original(image_id):
    if 0 <= image_id < len(image_paths):
        try:
            rel = image_paths[image_id].relative_to(IMAGE_ROOT)
        except ValueError:
            abort(404, description="Mapping error")
        print("rel:", rel)
        original = ORIGINAL_ROOT / rel
        if original.exists():
            return send_file(original)
        abort(404, description="Original image not found")
    abort(404, description="Image ID not found")


# ── Boot ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Disable multithreaded fork-safety issues in Flask's reloader
    app.run(host="0.0.0.0", port=3000, debug=False)