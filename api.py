import os
from pathlib import Path
from typing import List

import numpy as np
import torch
import faiss
from flask import Flask, request, jsonify, send_file, abort
from flask_cors import CORS
from PIL import Image
from transformers import CLIPProcessor, CLIPModel

# ── Config ────────────────────────────────────────────────────────────────
IMAGE_ROOT   = Path("out")                  # root folder (may contain sub‑dirs)
IMAGE_TYPES  = {".jpg", ".jpeg", ".png"}
BATCH_SIZE   = 64                               # embed N images at once
TOP_K        = 10                               # default search size

CACHE_DIR    = Path(".cache")                  # where we persist embeddings
CACHE_FILE   = CACHE_DIR / "clip_index.npz"     # compressed NumPy archive
CACHE_DIR.mkdir(exist_ok=True)

# ── Load CLIP ─────────────────────────────────────────────────────────────
device     = "cuda" if torch.cuda.is_available() else "mps"
model      = CLIPModel.from_pretrained("openai/clip-vit-large-patch14").to(device)
processor  = CLIPProcessor.from_pretrained("openai/clip-vit-large-patch14")

# ── Flask app ─────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

# ── Helpers ───────────────────────────────────────────────────────────────

def collect_image_paths(root: Path) -> List[Path]:
    """Recursively gather all image files under *root*, sorted for stability."""
    return sorted(p for p in root.rglob("*") if p.suffix.lower() in IMAGE_TYPES)


def embed_images(paths: List[Path]) -> torch.Tensor:
    """Return a (N,512) tensor of CLIP embeddings for *paths* (batched)."""
    all_embeddings = []
    for i in range(0, len(paths), BATCH_SIZE):
        batch_paths = paths[i : i + BATCH_SIZE]
        print(f"   → embedding {i:,}..{i + len(batch_paths):,} images")
        imgs = [Image.open(p).convert("RGB") for p in batch_paths]
        inputs = processor(images=imgs, return_tensors="pt", padding=True).to(device)
        with torch.no_grad():
            feats = model.get_image_features(**inputs)
            feats /= feats.norm(dim=-1, keepdim=True)
        all_embeddings.append(feats.cpu())
    return torch.cat(all_embeddings, dim=0)


def save_cache(emb: torch.Tensor, paths: List[Path]):
    """Persist embeddings + corresponding paths to CACHE_FILE (compressed)."""
    np.savez_compressed(
        CACHE_FILE,
        embeddings=emb.numpy().astype("float32"),
        paths=np.array([str(p) for p in paths]),
    )
    print(f"💾  Saved {len(paths):,} embeddings → {CACHE_FILE}")


def load_cache():
    """Return (paths, embeddings) from disk if cache is present, else (None, None)."""
    if not CACHE_FILE.exists():
        return None, None
    data = np.load(CACHE_FILE, allow_pickle=True)
    cached_paths = list(data["paths"])
    embeddings   = torch.from_numpy(data["embeddings"])
    return cached_paths, embeddings


def build_index(emb: torch.Tensor) -> faiss.IndexIDMap2:
    dim   = emb.shape[1]
    base  = faiss.IndexFlatL2(dim)
    index = faiss.IndexIDMap2(base)           # keep our own IDs stable
    ids   = np.arange(len(emb)).astype("int64")
    index.add_with_ids(emb.numpy(), ids)
    return index

# ── One‑time start‑up ─────────────────────────────────────────────────────
print("📂  Scanning image tree…")
image_paths: List[Path] = collect_image_paths(IMAGE_ROOT)
print(f"   → found {len(image_paths):,} files")

cached_paths, embeddings = load_cache()

if cached_paths == [str(p) for p in image_paths]:
    print("✅  Using cached embeddings (cold‑start avoided)")
else:
    if cached_paths is None:
        print("🚀  No cache present — embedding images for the first time…")
    else:
        print("🔄  Image set changed — re‑embedding entire collection…")
    embeddings = embed_images(image_paths)
    save_cache(embeddings, image_paths)

faiss_index = build_index(embeddings)
print("🔍  FAISS index ready\n")

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

    # clamp k to [1, dataset size] to avoid FAISS crashes
    k = max(1, min(k, len(image_paths)))

    inputs = processor(text=[query], return_tensors="pt").to(device)
    with torch.no_grad():
        txt = model.get_text_features(**inputs)
        txt = txt / txt.norm(dim=-1, keepdim=True)

    q = txt.cpu().contiguous().numpy().astype("float32", copy=False)
    
    try:
        D, I = faiss_index.search(q, k)
    except Exception as e:
        logging.exception("FAISS search failed")
        return abort(500, description="Internal search error")

    return jsonify(I[0].tolist())


@app.route("/images", methods=["GET"])
def list_images():
    return jsonify(list(range(len(image_paths))))


@app.route("/image/<int:image_id>", methods=["GET"])
def serve_image(image_id):
    if 0 <= image_id < len(image_paths):
        return send_file(image_paths[image_id])
    abort(404, description="Image not found")


# ── Boot ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000)
