"""Start local services once and open Bildutforskaren from a macOS shortcut."""

from __future__ import annotations

import fcntl
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request


PROJECT_ROOT = Path(__file__).resolve().parent.parent
LAUNCHER_DIR = PROJECT_ROOT / ".cache" / "desktop-launcher"
WEB_URL = "http://localhost:5173"
STARTUP_TIMEOUT = 600
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def service_ready(name: str, port: int) -> bool:
    path = "/models/status" if name == "api" else "/"
    try:
        with HTTP.open(f"http://localhost:{port}{path}", timeout=2) as response:
            body = response.read()
            if name == "api":
                return json.loads(body).get("backend") in {"local", "remote"}
            return b"/@vite/client" in body
    except (OSError, urllib.error.URLError, ValueError, AttributeError):
        return False


def port_in_use(port: int) -> bool:
    try:
        with socket.create_connection(("localhost", port), timeout=1):
            return True
    except OSError:
        return False


def saved_process_running(name: str) -> bool:
    try:
        pid = int((LAUNCHER_DIR / f"{name}.pid").read_text())
        if pid <= 0:
            return False
        os.kill(pid, 0)
        return True
    except (OSError, ValueError):
        return False


def start_service(name: str) -> subprocess.Popen:
    executable = shutil.which("uv" if name == "api" else "pnpm")
    if executable is None:
        raise RuntimeError(
            f'{"uv" if name == "api" else "pnpm"} is missing. '
            "Please ask the person who installed Bildutforskaren to complete the setup."
        )
    if name == "api":
        if not (PROJECT_ROOT / ".venv").is_dir():
            raise RuntimeError("Backend setup is missing. Run uv sync --extra cpu first.")
        command = [executable, "run", "--no-sync", "api.py"]
        cwd = PROJECT_ROOT
    else:
        if not (PROJECT_ROOT / "web" / "node_modules").is_dir():
            raise RuntimeError("Web setup is missing. Run pnpm install in web first.")
        if shutil.which("node") is None:
            raise RuntimeError(
                "Node.js is missing from the launcher PATH. If you use NVM, "
                "install Node and set its default version with nvm alias default <version>."
            )
        command = [executable, "dev", "--host", "127.0.0.1", "--port", "5173", "--strictPort"]
        cwd = PROJECT_ROOT / "web"
    with (LAUNCHER_DIR / f"{name}.log").open("ab") as log:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    (LAUNCHER_DIR / f"{name}.pid").write_text(str(process.pid))
    return process


def ensure_services() -> None:
    pending = {}
    for name, port in (("api", 3000), ("web", 5173)):
        if service_ready(name, port):
            print(f"{name.upper()} is already running.", flush=True)
            continue
        process = None
        if not saved_process_running(name) and not port_in_use(port):
            print(f"Starting {name.upper()}…", flush=True)
            process = start_service(name)
        else:
            print(f"Waiting for {name.upper()} on port {port}…", flush=True)
        pending[name] = (port, process)

    deadline = time.monotonic() + STARTUP_TIMEOUT
    while pending:
        for name, (port, process) in list(pending.items()):
            if service_ready(name, port):
                del pending[name]
                continue
            if process is not None and process.poll() is not None:
                raise RuntimeError(f"{name.upper()} could not start. See {LAUNCHER_DIR / f'{name}.log'}")
        if pending and time.monotonic() >= deadline:
            names = ", ".join(pending).upper()
            raise RuntimeError(
                f"Timed out waiting for {names}. Another application may be using port 3000 or 5173. "
                f"Startup logs are in {LAUNCHER_DIR}."
            )
        if pending:
            time.sleep(1)


def main() -> int:
    LAUNCHER_DIR.mkdir(parents=True, exist_ok=True)
    try:
        # Hold the lock through readiness checks so repeated clicks cannot launch duplicates.
        with (LAUNCHER_DIR / "launch.lock").open("w") as lock:
            print("Opening Bildutforskaren. Model startup can take a few minutes…", flush=True)
            fcntl.flock(lock, fcntl.LOCK_EX)
            ensure_services()
            subprocess.run(["open", WEB_URL], check=True)
        print("Bildutforskaren is ready. You can close this window.", flush=True)
        return 0
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        message = str(exc)
        print(message, file=sys.stderr, flush=True)
        subprocess.run(
            [
                "osascript", "-e",
                'on run argv\ndisplay alert "Bildutforskaren could not open" '
                'message (item 1 of argv) as critical\nend run',
                message,
            ],
            check=False,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
