from __future__ import annotations

from pathlib import Path
from typing import Callable, List

import numpy as np
import torch
from api import embedding_service
from api.embedding_config import CLIP_MODEL_ID

def embed_images(
    paths: List[Path],
    *,
    progress_cb: Callable[[int, int], None] | None = None,
) -> torch.Tensor:
    return embedding_service.embed_images(paths, CLIP_MODEL_ID, progress_cb=progress_cb)

def embed_text(prompts: list[str]) -> np.ndarray:
    return embedding_service.embed_text(prompts, CLIP_MODEL_ID)
