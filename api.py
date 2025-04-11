import os
import torch
import faiss
from flask import Flask, request, jsonify, send_file, abort
from flask_cors import CORS
from PIL import Image
from transformers import CLIPProcessor, CLIPModel

# ---- Config ----
IMAGE_FOLDER = "images"  # Replace with actual folder
TOP_K = 5

# ---- Load CLIP ----
device = "cuda" if torch.cuda.is_available() else "mps"
model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to(device)
processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")

# ---- App setup ----
app = Flask(__name__)
CORS(app) 

# ---- Memory store ----
image_paths = []
embedding_index = None

# ---- Embed images ----
def embed_images_from_folder(folder_path):
    global image_paths
    embeddings = []
    image_paths = []

    for filename in os.listdir(folder_path):
        if filename.lower().endswith((".jpg", ".jpeg", ".png")):
            path = os.path.join(folder_path, filename)
            image = Image.open(path).convert("RGB")
            inputs = processor(images=image, return_tensors="pt").to(device)

            with torch.no_grad():
                image_features = model.get_image_features(**inputs)
                image_features /= image_features.norm(dim=-1, keepdim=True)
                embeddings.append(image_features.cpu().numpy())
                image_paths.append(path)

    return torch.cat([torch.from_numpy(e) for e in embeddings]).numpy()

def build_faiss_index(embeddings):
    dim = embeddings.shape[1]
    index = faiss.IndexFlatL2(dim)
    index.add(embeddings)
    return index

# ---- Load on startup ----
print("Embedding images and building FAISS index...")
embeddings = embed_images_from_folder(IMAGE_FOLDER)
embedding_index = build_faiss_index(embeddings)
print(f"Loaded {len(image_paths)} images into memory.")
print(image_paths[:5])  # Print first 5 image paths for verification

# ---- Routes ----

@app.route("/embeddings", methods=["GET"])
def get_embeddings():
    # Note: embeddings is a (N, 512) NumPy array
    embeddings_list = [
        {"id": idx, "embedding": embedding.tolist()}
        for idx, embedding in enumerate(embeddings)
    ]
    return jsonify(embeddings_list)

@app.route("/search", methods=["GET"])
def search():
    query = request.args.get("query")
    top_k = int(request.args.get("top_k", TOP_K))

    if not query:
        return jsonify({"error": "Missing 'query'"}), 400

    # Encode text
    inputs = processor(text=[query], return_tensors="pt").to(device)
    with torch.no_grad():
        text_features = model.get_text_features(**inputs)
        text_features /= text_features.norm(dim=-1, keepdim=True)

    text_embedding = text_features.cpu().numpy()
    distances, indices = embedding_index.search(text_embedding, top_k)
    
    return jsonify(indices[0].tolist())


@app.route("/images", methods=["GET"])
def list_images():
    print(f"Listing {len(image_paths)} images.")
    return jsonify(list(range(len(image_paths))))


@app.route("/image/<int:image_id>", methods=["GET"])
def serve_image(image_id):
    if 0 <= image_id < len(image_paths):
        return send_file(image_paths[image_id], mimetype='image/jpeg')
    else:
        return abort(404, description="Image not found")


# ---- Start app ----
if __name__ == "__main__":
    app.run(app.run(host='0.0.0.0', port=3000))
