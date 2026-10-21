"""Start local services once and open Bildutforskaren from a desktop shortcut."""

from __future__ import annotations

from contextlib import contextmanager
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
import webbrowser


PROJECT_ROOT = Path(__file__).resolve().parent.parent
LAUNCHER_DIR = PROJECT_ROOT / ".cache" / "desktop-launcher"
WEB_URL = "http://localhost:5173"
STARTUP_TIMEOUT = 600
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))
IS_WINDOWS = sys.platform == "win32"


@contextmanager
def launch_lock():
    # Keep a byte in the file: Windows locks byte ranges rather than whole files.
    with (LAUNCHER_DIR / "launch.lock").open("a+b") as lock:
        lock.seek(0, os.SEEK_END)
        if lock.tell() == 0:
            lock.write(b"\0")
            lock.flush()
        if IS_WINDOWS:
            import msvcrt

            while True:
                lock.seek(0)
                try:
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    time.sleep(0.2)
            try:
                yield
            finally:
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(lock, fcntl.LOCK_EX)
            yield


def show_error(message: str) -> None:
    if IS_WINDOWS:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, "Bildutforskaren could not open", 0x10)
    else:
        subprocess.run(
            [
                "osascript", "-e",
                'on run argv\ndisplay alert "Bildutforskaren could not open" '
                'message (item 1 of argv) as critical\nend run',
                message,
            ],
            check=False,
        )


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
        if IS_WINDOWS:
            # os.kill(pid, 0) can terminate a process on Windows. Query it instead.
            import ctypes
            from ctypes import wintypes

            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            kernel.OpenProcess.restype = wintypes.HANDLE
            kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
            kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            handle = kernel.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
            if not handle:
                return False
            try:
                return kernel.WaitForSingleObject(handle, 0) == 0x00000102  # WAIT_TIMEOUT
            finally:
                kernel.CloseHandle(handle)
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
                "Node.js is missing from the launcher PATH. Install Node.js and restart the launcher. "
                "On macOS, if you use NVM, "
                "install Node and set its default version with nvm alias default <version>."
            )
        command = [executable, "dev", "--host", "127.0.0.1", "--port", "5173", "--strictPort"]
        cwd = PROJECT_ROOT / "web"
    options = (
        {
            "creationflags": subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP,
            # pnpm is commonly installed as pnpm.cmd on Windows.
            "shell": executable.lower().endswith((".cmd", ".bat")),
        }
        if IS_WINDOWS else {"start_new_session": True}
    )
    with (LAUNCHER_DIR / f"{name}.log").open("ab") as log:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            **options,
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
        with launch_lock():
            print("Opening Bildutforskaren. Model startup can take a few minutes…", flush=True)
            ensure_services()
            if not webbrowser.open(WEB_URL):
                raise RuntimeError(f"Could not open your browser. Open {WEB_URL} manually.")
        print("Bildutforskaren is ready. You can close this window.", flush=True)
        return 0
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        message = str(exc)
        print(message, file=sys.stderr, flush=True)
        show_error(message)
        return 1


if __name__ == "__main__":
    sys.exit(main())
