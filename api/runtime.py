from __future__ import annotations

from typing import Optional

from api import config
from api.context_cache import ContextCache
from api.job_manager import JobManager


context_cache: Optional[ContextCache] = None
job_manager: Optional[JobManager] = None


def init_runtime() -> None:
    global context_cache
    global job_manager

    if context_cache is None:
        context_cache = ContextCache(max_size=config.CONTEXT_CACHE_MAX)

    if job_manager is None:
        job_manager = JobManager(max_workers=config.JOB_WORKERS)


def get_context_cache() -> ContextCache:
    init_runtime()
    assert context_cache is not None
    return context_cache


def get_job_manager() -> JobManager:
    init_runtime()
    assert job_manager is not None
    return job_manager
