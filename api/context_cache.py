from __future__ import annotations

import threading
from collections import OrderedDict

from api.models import DatasetContext


class ContextCache:
    def __init__(self, max_size: int):
        self._max_size = int(max_size)
        self._cache: "OrderedDict[str, DatasetContext]" = OrderedDict()
        self._cache_lock = threading.Lock()
        self._build_locks: dict[str, threading.Lock] = {}

    def _get_build_lock(self, dataset_id: str) -> threading.Lock:
        with self._cache_lock:
            lock = self._build_locks.get(dataset_id)
            if lock is None:
                lock = threading.Lock()
                self._build_locks[dataset_id] = lock
            return lock

    def get(self, dataset_id: str, builder):
        with self._cache_lock:
            ctx = self._cache.get(dataset_id)
            if ctx is not None:
                self._cache.move_to_end(dataset_id)
                return ctx

        build_lock = self._get_build_lock(dataset_id)
        with build_lock:
            with self._cache_lock:
                ctx = self._cache.get(dataset_id)
                if ctx is not None:
                    self._cache.move_to_end(dataset_id)
                    return ctx

            ctx = builder(dataset_id)

            with self._cache_lock:
                self._cache[dataset_id] = ctx
                self._cache.move_to_end(dataset_id)
                while len(self._cache) > self._max_size:
                    self._cache.popitem(last=False)

            return ctx

    def invalidate(self, dataset_id: str) -> None:
        with self._cache_lock:
            self._cache.pop(dataset_id, None)
