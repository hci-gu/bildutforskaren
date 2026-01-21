from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
API_ROOT = Path(__file__).resolve().parent

# Dataset / storage
DATASETS_ROOT = REPO_ROOT / "datasets"
IMAGE_TYPES = {".jpg", ".jpeg", ".png", ".webp"}

# Upload/processing
THUMB_MAX_SIZE = (336, 336)

# Indexing
PCA_DEFAULT_DIM = 50

# Atlas settings
ATLAS_SPRITE_SIZE = 128
ATLAS_PADDING = 1
ATLAS_MAX_SIZE = 4096

# Runtime tuning
CONTEXT_CACHE_MAX = 2
JOB_WORKERS = 1


def ensure_runtime_dirs() -> None:
    DATASETS_ROOT.mkdir(exist_ok=True)
