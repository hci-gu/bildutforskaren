from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

from api import dataset_activity


class JobManager:
    def __init__(self, *, max_workers: int):
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._state_lock = threading.Lock()
        self._state: dict[str, dict] = {}

    def set_state(self, dataset_id: str, **updates) -> None:
        with self._state_lock:
            state = self._state.get(dataset_id) or {}
            state.update(updates)
            self._state[dataset_id] = state

    def get_state(self, dataset_id: str) -> dict:
        with self._state_lock:
            return dict(self._state.get(dataset_id) or {})

    def submit(self, fn, dataset_id: str, *, kind: str = "processing", before_enqueue=None) -> None:
        with dataset_activity.LOCK:
            dataset_activity.reserve(dataset_id, kind)
            try:
                if before_enqueue:
                    before_enqueue()
                self.set_state(dataset_id, stage=kind if kind == "embedding-model" else "queued", progress=0, error=None)
                self._executor.submit(self._run, fn, dataset_id)
            except Exception:
                dataset_activity.release(dataset_id)
                raise

    def _run(self, fn, dataset_id: str) -> None:
        try:
            fn(dataset_id)
        finally:
            dataset_activity.release(dataset_id)
