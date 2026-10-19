"""Shared reservations for background jobs using a dataset's embedding space."""
from __future__ import annotations

import threading

LOCK = threading.RLock()
_ACTIVE: dict[str, str] = {}


class ActiveDatasetJobError(RuntimeError):
    pass


def reserve(dataset_id: str, kind: str) -> None:
    with LOCK:
        if dataset_id in _ACTIVE:
            raise ActiveDatasetJobError("A dataset job is already running")
        _ACTIVE[dataset_id] = kind


def release(dataset_id: str) -> None:
    with LOCK:
        _ACTIVE.pop(dataset_id, None)


def switching(dataset_id: str) -> bool:
    with LOCK:
        return _ACTIVE.get(dataset_id) == "embedding-model"
