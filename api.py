import os
import sys
import logging
import umap
from pathlib import Path
from typing import List

import numpy as np
import torch
import faiss
from flask import Flask, request, jsonify, send_file, abort
from flask_cors import CORS
from PIL import Image
from transformers import CLIPProcessor, CLIPModel

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

# ── Load CLIP ─────────────────────────────────────────────────────────────
logging.info("Loading CLIP model …")

device     = "cuda" if torch.cuda.is_available() else "mps"
model      = CLIPModel.from_pretrained("openai/clip-vit-large-patch14").to(device)
processor  = CLIPProcessor.from_pretrained("openai/clip-vit-large-patch14")

# ── Flask app ─────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

# ── Helpers ───────────────────────────────────────────────────────────────
def extract_metadata(path: Path) -> dict:
    parts = path.relative_to(IMAGE_ROOT).parts
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

    return {
        "filename": path.name,
        "photographer": photographer_id,
    }

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

# ── Routes ────────────────────────────────────────────────────────────────
@app.route("/embeddings", methods=["GET"])
def get_embeddings():
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

@app.route("/images", methods=["GET"])
def list_images():
    return jsonify(list(range(len(image_paths))))

@app.route("/umap", methods=["GET"])
def get_umap():
    n_neighbors = int(request.args.get("n_neighbors", 15))
    min_dist    = float(request.args.get("min_dist", 0.1))
    n_components = int(request.args.get("n_components", 2))
    seed       = int(request.args.get("seed", 42))

    reducer = umap.UMAP(
        n_neighbors=n_neighbors,
        min_dist=min_dist,
        n_components=n_components,
        metric="cosine",
        transform_seed=seed
    )
    embedding = reducer.fit_transform(embeddings[:1000].numpy())

    return jsonify(embedding.tolist())

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