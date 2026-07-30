from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from api.projection_stability import StabilityAnalysisCancelled


class ActiveStabilityJobError(Exception):
    pass


class ProjectionStabilityJobManager:
    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="projection-stability",
        )
        self._lock = threading.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}
        self._cancel_events: dict[str, threading.Event] = {}
        self._active_by_dataset: dict[str, str] = {}

    def start(
        self,
        dataset_id: str,
        worker: Callable[
            [Callable[[int, int], None], Callable[[], bool]],
            dict[str, Any],
        ],
    ) -> str:
        with self._lock:
            active_id = self._active_by_dataset.get(dataset_id)
            if active_id is not None:
                active = self._jobs.get(active_id, {})
                if active.get("status") in {"queued", "running"}:
                    raise ActiveStabilityJobError(active_id)

            stale_ids = [
                job_id
                for job_id, state in self._jobs.items()
                if state.get("dataset_id") == dataset_id
            ]
            for stale_id in stale_ids:
                self._jobs.pop(stale_id, None)
                self._cancel_events.pop(stale_id, None)

            job_id = uuid.uuid4().hex
            self._jobs[job_id] = {
                "job_id": job_id,
                "dataset_id": dataset_id,
                "status": "queued",
                "progress": 0.0,
                "completed_runs": 0,
                "total_runs": 8,
                "result": None,
                "error": None,
            }
            self._cancel_events[job_id] = threading.Event()
            self._active_by_dataset[dataset_id] = job_id

        self._executor.submit(self._run, job_id, dataset_id, worker)
        return job_id

    def _run(
        self,
        job_id: str,
        dataset_id: str,
        worker: Callable[
            [Callable[[int, int], None], Callable[[], bool]],
            dict[str, Any],
        ],
    ) -> None:
        event = self._cancel_events[job_id]
        self._update(job_id, status="running")

        def progress(completed: int, total: int) -> None:
            self._update(
                job_id,
                completed_runs=completed,
                total_runs=total,
                progress=completed / max(1, total),
            )

        try:
            result = worker(progress, event.is_set)
        except StabilityAnalysisCancelled:
            self._update(job_id, status="cancelled", result=None)
        except Exception as exc:
            logging.exception(
                "Projection stability job %s failed for dataset %s",
                job_id,
                dataset_id,
            )
            self._update(job_id, status="error", error=str(exc), result=None)
        else:
            if event.is_set():
                self._update(job_id, status="cancelled", result=None)
            else:
                self._update(
                    job_id,
                    status="complete",
                    progress=1.0,
                    completed_runs=8,
                    result=result,
                )
        finally:
            with self._lock:
                if self._active_by_dataset.get(dataset_id) == job_id:
                    self._active_by_dataset.pop(dataset_id, None)

    def _update(self, job_id: str, **updates: Any) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                job.update(updates)

    def get(self, job_id: str, dataset_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.get("dataset_id") != dataset_id:
                return None
            return dict(job)

    def cancel(self, job_id: str, dataset_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.get("dataset_id") != dataset_id:
                return None
            event = self._cancel_events.get(job_id)
            if event is not None:
                event.set()
            if job.get("status") == "queued":
                job["status"] = "cancelled"
            return dict(job)


_MANAGER = ProjectionStabilityJobManager()


def get_projection_stability_job_manager() -> ProjectionStabilityJobManager:
    return _MANAGER
