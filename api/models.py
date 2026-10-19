from __future__ import annotations

from dataclasses import dataclass
from functools import cached_property
import hashlib
from pathlib import Path
from typing import List

from api.embedding_config import CLIP_MODEL_ID, fingerprint


@dataclass(frozen=True)
class DatasetConfig:
    dataset_id: str
    thumb_root: Path
    original_root: Path
    cache_dir: Path
    atlas_dir: Path
    metadata_source: str = "none"
    immutable: bool = True
    pca_dim: int = 50
    embedding_model: str = CLIP_MODEL_ID

    @property
    def embedding_fingerprint(self) -> str:
        return fingerprint(self.embedding_model)

    @property
    def embedding_cache_dir(self) -> Path:
        return self.cache_dir / "embeddings" / self.embedding_fingerprint

    @property
    def context_key(self) -> str:
        return f"{self.dataset_id}:{self.embedding_fingerprint}"

    @property
    def dataset_dir(self) -> Path:
        return self.thumb_root.parent

    @property
    def metadata_xlsx_file(self) -> Path:
        return self.dataset_dir / "metadata.xlsx"

    @property
    def cache_file(self) -> Path:
        return self.embedding_cache_dir / "index.npz"

    @property
    def umap_cache_file(self) -> Path:
        return self.embedding_cache_dir / "umap_cache.pkl"

    @property
    def pca_cache_file(self) -> Path:
        return self.embedding_cache_dir / f"pca_{self.pca_dim}.npz"

    @property
    def pca_model_file(self) -> Path:
        return self.embedding_cache_dir / f"pca_{self.pca_dim}_model.pkl"


@dataclass
class DatasetContext:
    cfg: DatasetConfig
    image_paths: List[Path]
    metadata: list[dict]
    embeddings: "object"  # torch.Tensor
    pca_embeddings_np: "object"  # np.ndarray
    pca_model: "object"  # sklearn.decomposition.PCA
    faiss_index: "object"  # faiss.Index
    umap_cache: dict

    @cached_property
    def index_fingerprint(self) -> str:
        digest = hashlib.sha256(self.cfg.embedding_fingerprint.encode())
        for path in self.image_paths:
            digest.update(str(path.relative_to(self.cfg.thumb_root)).encode())
            digest.update(b"\0")
        digest.update(self.embeddings.numpy().tobytes())
        return digest.hexdigest()[:24]
