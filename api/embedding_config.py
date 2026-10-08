from __future__ import annotations

import hashlib
import json

CLIP_MODEL_ID = "openai/clip-vit-large-patch14"
GEMMA_MODEL_ID = "google/embeddinggemma-2"
# Immutable Hugging Face revisions; changing these creates new cache namespaces.
MODEL_REVISIONS = {
    CLIP_MODEL_ID: "32bd64288804d66eefd0ccbe215aa642df71cc41",
    GEMMA_MODEL_ID: "914f7f89142e33e77833254d9c9b90c3cef7303b",
}


def validate_model(model_id: str) -> str:
    if model_id not in MODEL_REVISIONS:
        raise ValueError("Unsupported embedding model")
    return model_id


def fingerprint(model_id: str = CLIP_MODEL_ID) -> str:
    validate_model(model_id)
    payload = {
        "model": model_id,
        "revision": MODEL_REVISIONS[model_id],
        "dimension": 768,
        "preprocessing": "rgb-thumbnail-336-v1",
        "provider": "clip-v2" if model_id == CLIP_MODEL_ID else "sentence-transformers-v1",
        "normalization": "l2-float32-v1",
        "text_policy": "unprefixed-v1",
        "modalities": ["text", "image"],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:24]
