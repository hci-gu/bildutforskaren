from __future__ import annotations

import json
import logging
import re
import shutil
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Iterable

from api import config
from api import dataset_db
from api import runtime
from api.models import DatasetConfig


def _now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _dataset_dir(dataset_id: str) -> Path:
    return config.DATASETS_ROOT / dataset_id


def _dataset_json_path(dataset_id: str) -> Path:
    return _dataset_dir(dataset_id) / "dataset.json"


def is_safe_dataset_id(dataset_id: str) -> bool:
    return bool(re.fullmatch(r"[a-f0-9]{16,64}", dataset_id))


def read_dataset_json(dataset_id: str) -> dict:
    path = _dataset_json_path(dataset_id)
    if not path.exists():
        raise FileNotFoundError(f"Dataset {dataset_id!r} not found")
    return json.loads(path.read_text(encoding="utf-8"))


def write_dataset_json(dataset_id: str, data: dict) -> None:
    ddir = _dataset_dir(dataset_id)
    ddir.mkdir(parents=True, exist_ok=True)
    path = _dataset_json_path(dataset_id)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def list_datasets() -> list[dict]:
    datasets: list[dict] = []

    if not config.DATASETS_ROOT.exists():
        return datasets

    for entry in sorted(config.DATASETS_ROOT.iterdir()):
        if not entry.is_dir():
            continue

        dataset_id = entry.name
        if not is_safe_dataset_id(dataset_id):
            continue

        meta_path = entry / "dataset.json"
        if not meta_path.exists():
            continue

        try:
            data = json.loads(meta_path.read_text(encoding="utf-8"))
            data = dict(data)
            data.setdefault("metadata_source", "none")
            data["has_metadata_xlsx"] = (entry / "metadata.xlsx").exists()
            job = runtime.get_job_manager().get_state(dataset_id)
            if job:
                data["job"] = job
            datasets.append(data)
        except Exception:
            logging.exception("Failed to read dataset.json for %s", dataset_id)

    return datasets


def create_dataset(name: str | None) -> dict:
    dataset_id = uuid.uuid4().hex
    data = {
        "dataset_id": dataset_id,
        "name": (name or "Untitled dataset").strip() or "Untitled dataset",
        "status": "created",
        "immutable": True,
        "created_at": _now_iso(),
        "error": None,
        "metadata_source": "none",
    }

    ddir = _dataset_dir(dataset_id)
    (ddir / "original").mkdir(parents=True, exist_ok=True)
    (ddir / "thumb").mkdir(parents=True, exist_ok=True)
    (ddir / "cache").mkdir(parents=True, exist_ok=True)
    (ddir / "atlas").mkdir(parents=True, exist_ok=True)

    db_path = dataset_db.dataset_db_path(ddir)
    conn = dataset_db.init_dataset_db(db_path)
    conn.close()

    write_dataset_json(dataset_id, data)
    return data


def get_dataset_config(dataset_id: str) -> DatasetConfig:
    meta = read_dataset_json(dataset_id)
    status = meta.get("status")
    if status not in {"created", "uploaded", "processing", "ready", "error"}:
        raise ValueError("Invalid dataset status")

    ddir = _dataset_dir(dataset_id)
    cfg = DatasetConfig(
        dataset_id=dataset_id,
        thumb_root=ddir / "thumb",
        original_root=ddir / "original",
        cache_dir=ddir / "cache",
        atlas_dir=ddir / "atlas",
        metadata_source=str(meta.get("metadata_source") or "none"),
        immutable=True,
        pca_dim=config.PCA_DEFAULT_DIM,
    )

    cfg.thumb_root.mkdir(parents=True, exist_ok=True)
    cfg.original_root.mkdir(parents=True, exist_ok=True)
    cfg.cache_dir.mkdir(parents=True, exist_ok=True)
    cfg.atlas_dir.mkdir(parents=True, exist_ok=True)

    return cfg


def safe_zip_members(z: zipfile.ZipFile) -> Iterable[zipfile.ZipInfo]:
    for info in z.infolist():
        if info.is_dir():
            continue

        name = info.filename
        if not name or name.startswith("/") or name.startswith("\\"):
            continue

        parts = Path(name).parts
        if ".." in parts:
            continue

        # Skip macOS metadata files (e.g. __MACOSX/._foo.jpg)
        if "__MACOSX" in parts:
            continue
        if Path(name).name.startswith("._"):
            continue

        yield info


def extract_zip_to_originals(dataset_id: str, file_stream) -> int:
    """Persist zip stream to disk, then extract image files to original_root."""
    cfg = get_dataset_config(dataset_id)

    tmp_zip = cfg.cache_dir / "upload.zip"
    try:
        with tmp_zip.open("wb") as dst:
            shutil.copyfileobj(file_stream, dst, length=1024 * 1024)

        z = zipfile.ZipFile(tmp_zip)
    except Exception as exc:
        raise ValueError("Could not read zip") from exc

    extracted = 0
    try:
        for info in safe_zip_members(z):
            suffix = Path(info.filename).suffix.lower()
            if suffix not in config.IMAGE_TYPES:
                continue

            out_path = cfg.original_root / info.filename
            out_path.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, out_path.open("wb") as dst:
                shutil.copyfileobj(src, dst, length=1024 * 1024)
            extracted += 1
    finally:
        try:
            z.close()
        finally:
            try:
                tmp_zip.unlink(missing_ok=True)
            except Exception:
                logging.warning("Could not delete temp zip %s", tmp_zip)

    return extracted
