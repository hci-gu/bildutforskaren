"""Build a Finder launcher that bypasses Terminal and shell startup files."""

from pathlib import Path
import shlex
import subprocess


PROJECT_ROOT = Path(__file__).resolve().parent.parent


def build_app() -> Path:
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
    print(build_app())
