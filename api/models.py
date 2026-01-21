from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List


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

    @property
    def dataset_dir(self) -> Path:
        return self.thumb_root.parent

    @property
    def metadata_xlsx_file(self) -> Path:
        return self.dataset_dir / "metadata.xlsx"

    @property
    def cache_file(self) -> Path:
        return self.cache_dir / "clip_index.npz"

    @property
    def umap_cache_file(self) -> Path:
        return self.cache_dir / "umap_cache.pkl"

    @property
    def pca_cache_file(self) -> Path:
        return self.cache_dir / f"clip_pca_{self.pca_dim}.npz"

    @property
    def pca_model_file(self) -> Path:
        return self.cache_dir / f"clip_pca_{self.pca_dim}_model.pkl"


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
