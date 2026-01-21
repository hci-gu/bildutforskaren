from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor


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

    def submit(self, fn, dataset_id: str) -> None:
        self.set_state(dataset_id, stage="queued", progress=0)
        self._executor.submit(fn, dataset_id)
