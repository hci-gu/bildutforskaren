import os
import sys
import logging
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

# ◼️  FAISS stability toggles — adjust if you still see segfaults ----------
FAISS_THREADS = 1        # safest setting; raise if you need more speed
FORCE_FLAT32  = True     # ensure contiguous float32 everywhere

# ── Load CLIP ─────────────────────────────────────────────────────────────
logging.info("Loading CLIP model …")

device     = "cuda" if torch.cuda.is_available() else "mps"
model      = CLIPModel.from_pretrained("openai/clip-vit-large-patch14").to(device)
processor  = CLIPProcessor.from_pretrained("openai/clip-vit-large-patch14")

# ── Set FAISS threads early ───────────────────────────────────────────────
try:
    faiss.omp_set_num_threads(FAISS_THREADS)
    logging.info("FAISS will use %s thread(s)", FAISS_THREADS)
except AttributeError:
    logging.warning("Could not set FAISS thread count; continuing with default")

# ── Flask app ─────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

# ── Helpers ───────────────────────────────────────────────────────────────

def collect_image_paths(root: Path) -> List[Path]:
    """Recursively gather all image files under *root*, sorted for stable IDs."""
    return sorted(p for p in root.rglob("*") if p.suffix.lower() in IMAGE_TYPES)


def to_float32(x: np.ndarray) -> np.ndarray:
    """Ensure *x* is contiguous float32 (FAISS crashes otherwise)."""
    if not FORCE_FLAT32:
        return x
    if x.dtype != np.float32:
        x = x.astype("float32", copy=False)
    if not x.flags["C_CONTIGUOUS"]:
        x = np.ascontiguousarray(x)
    return x


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
    emb_np = to_float32(emb.numpy())
    dim = emb_np.shape[1]
    index = faiss.IndexFlatL2(dim)
    index.add(emb_np)
    return index

# ── One-time start-up ─────────────────────────────────────────────────────
logging.info("Scanning image tree …")
image_paths: List[Path] = collect_image_paths(IMAGE_ROOT)
logging.info("Found %s files in %s", len(image_paths), IMAGE_ROOT)

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
        {"id": idx, "embedding": emb.tolist()} for idx, emb in enumerate(embeddings.numpy())
    ])


@app.route("/embedding/<int:image_id>", methods=["GET"])
def get_embedding(image_id):
    if 0 <= image_id < len(embeddings):
        return jsonify(embeddings[image_id].tolist())
    abort(404, description="Image ID not found")


@app.route("/search", methods=["GET"])
def search():
    query = request.args.get("query", "").strip()
    k     = int(request.args.get("top_k", TOP_K))

    if not query:
        return jsonify({"error": "Missing 'query'"}), 400

    k = max(1, min(k, len(image_paths)))  # keep k sane

    inputs = processor(text=[query], return_tensors="pt").to(device)
    with torch.no_grad():
        txt = model.get_text_features(**inputs)
        txt = txt / txt.norm(dim=-1, keepdim=True)

    q = to_float32(txt.cpu().numpy().reshape(1, -1))

    # Safety check to avoid silent shape mismatches — these often cause segfaults
    dim_index = faiss_index.d
    if q.shape[1] != dim_index:
        logging.error("Query dim (%s) != index dim (%s)", q.shape[1], dim_index)
        return abort(500, description="Dimension mismatch between query and index")

    try:
        print("q dtype:", q.dtype)
        print("q shape:", q.shape)
        print("q flags:", q.flags)
        print("index dim:", faiss_index.d)
        D, I = faiss_index.search(q, k)
    except Exception:
        logging.exception("FAISS search failed — falling back to single-thread")
        # last-chance fallback: try again with one thread
        faiss.omp_set_num_threads(1)
        D, I = faiss_index.search(q, k)
    print("return D:", I[0].tolist())
    return jsonify(I[0].tolist())


@app.route("/images", methods=["GET"])
def list_images():
    return jsonify(list(range(len(image_paths))))


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