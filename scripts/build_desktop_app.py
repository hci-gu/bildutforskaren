"""Build a clickable macOS or Windows launcher without a terminal window."""

import argparse
from pathlib import Path
import shlex
import subprocess
import sys


PROJECT_ROOT = Path(__file__).resolve().parent.parent


def build_windows_app() -> Path:
    output = PROJECT_ROOT / ".cache" / "desktop-launcher" / "Bildutforskaren.vbs"
    output.parent.mkdir(parents=True, exist_ok=True)
    python = PROJECT_ROOT / ".venv" / "Scripts" / "pythonw.exe"
    launcher = PROJECT_ROOT / "scripts" / "launch_desktop.py"
    # Escape both command-line arguments and VBScript string literals.
    command = f'"{python}" "{launcher}"'.replace('"', '""')
    python_literal = str(python).replace('"', '""')
    script = (
        'Set files = CreateObject("Scripting.FileSystemObject")\n'
        'Set shell = CreateObject("WScript.Shell")\n'
        f'If Not files.FileExists("{python_literal}") Then\n'
        '  MsgBox "Backend setup is missing. Run uv sync --extra cpu in the repository first.", '
        '16, "Bildutforskaren could not open"\n'
        '  WScript.Quit 1\n'
        'End If\n'
        f'shell.Run "{command}", 0, False\n'
    )
    # UTF-16 preserves repository paths containing non-ASCII characters in WScript.
    output.write_text(script, encoding="utf-16")
    return output


def build_app(target_os: str | None = None) -> Path:
    target_os = target_os or ("windows" if sys.platform == "win32" else "mac")
    if target_os == "windows":
        return build_windows_app()
    if target_os != "mac":
        raise ValueError(f"Unsupported OS: {target_os}")
    if sys.platform != "darwin":
        raise RuntimeError("The macOS .app must be built on a Mac (it requires osacompile).")
    output = PROJECT_ROOT / ".cache" / "desktop-launcher" / "Bildutforskaren.app"
    output.parent.mkdir(parents=True, exist_ok=True)
    command = "/bin/zsh -f " + shlex.quote(str(PROJECT_ROOT / "Start Bildutforskaren.command"))
    # Escape for an AppleScript string after quoting the shell argument.
    literal = command.replace("\\", "\\\\").replace('"', '\\"')
    script = f'''on run
    try
        with timeout of 1200 seconds
            do shell script "{literal}"
        end timeout
    on error errorMessage
        display alert "Bildutforskaren could not open" message errorMessage as critical
    end try
end run
'''
    subprocess.run(["/usr/bin/osacompile", "-o", str(output), "-"], input=script, text=True, check=True)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--os", choices=("windows", "mac"), help="Default: the current OS")
    args = parser.parse_args()
    try:
        print(build_app(args.os))
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f"{exc}\n")
