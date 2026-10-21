"""Regression checks for shortcut startup and service reuse."""

import unittest
from pathlib import Path
import os
import subprocess
import sys
import tempfile
from unittest.mock import patch

from scripts import launch_desktop as launcher
from scripts import build_desktop_app as builder


class DesktopLauncherTests(unittest.TestCase):
    @patch.object(launcher.subprocess, "Popen")
    @patch.object(launcher.Path, "is_dir", return_value=True)
    @patch.object(launcher.shutil, "which", side_effect=["/bin/pnpm", None])
    def test_missing_node_reports_setup_error_before_spawning(self, which, is_dir, spawn):
        with self.assertRaisesRegex(RuntimeError, "Node.js is missing"):
            launcher.start_service("web")
        spawn.assert_not_called()

    @unittest.skipUnless(sys.platform == "darwin", "Requires macOS zsh")
    def test_shortcut_loads_nvm_default_without_shell_startup_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shortcut = root / "Start Bildutforskaren.command"
            shortcut.write_text((launcher.PROJECT_ROOT / shortcut.name).read_text())
            python = root / ".venv" / "bin" / "python"
            python.parent.mkdir(parents=True)
            python.write_text('#!/bin/zsh -f\nprint -r -- "$PATH"\n')
            python.chmod(0o755)
            nvm = root / "custom-nvm"
            nvm.mkdir()
            (nvm / "nvm.sh").write_text(
                '[[ "$1" == "--no-use" ]] || exit 2\n'
                'nvm() {\n'
                '  [[ "$*" == "use --silent default" ]] || return 3\n'
                '  export PATH="$NVM_DIR/versions/node/test/bin:$PATH"\n'
                '}\n'
            )
            # Force the missing-Node case even on hosts with a system installation.
            script = (
                'command() {\n'
                '  if [[ "$*" == "-v node" ]]; then return 1; fi\n'
                '  builtin command "$@"\n'
                '}\n'
                'source "$1"\n'
            )
            result = subprocess.run(
                ["/bin/zsh", "-f", "-c", script, "test-shortcut", str(shortcut)],
                env={**os.environ, "HOME": str(root), "NVM_DIR": str(nvm), "PATH": "/usr/bin:/bin"},
                capture_output=True,
                text=True,
                check=True,
            )
            self.assertTrue(result.stdout.startswith(f"{nvm}/versions/node/test/bin:"))

    @patch.object(launcher, "start_service")
    @patch.object(launcher, "service_ready", return_value=True)
    def test_running_services_are_reused(self, ready, start):
        launcher.ensure_services()
        start.assert_not_called()

    @patch.object(launcher.time, "sleep")
    @patch.object(launcher, "port_in_use", return_value=False)
    @patch.object(launcher, "saved_process_running", return_value=False)
    @patch.object(launcher, "start_service")
    @patch.object(launcher, "service_ready", side_effect=[True, False, False, True])
    def test_only_missing_service_starts_and_waits(self, ready, start, saved, port, sleep):
        start.return_value.poll.return_value = None
        launcher.ensure_services()
        start.assert_called_once_with("web")
        sleep.assert_called_once_with(1)

    @patch.object(launcher, "port_in_use", return_value=False)
    @patch.object(launcher, "saved_process_running", return_value=True)
    @patch.object(launcher, "start_service")
    @patch.object(launcher, "service_ready", side_effect=[False, True, True])
    def test_starting_service_is_not_started_twice(self, ready, start, saved, port):
        launcher.ensure_services()
        start.assert_not_called()

    @patch.object(launcher, "port_in_use", return_value=False)
    @patch.object(launcher, "saved_process_running", return_value=False)
    @patch.object(launcher, "start_service")
    @patch.object(launcher, "service_ready", side_effect=[False, True, False])
    def test_failed_process_reports_log(self, ready, start, saved, port):
        start.return_value.poll.return_value = 1
        with self.assertRaisesRegex(RuntimeError, "api.log"):
            launcher.ensure_services()

    @patch.object(launcher, "STARTUP_TIMEOUT", 0)
    @patch.object(launcher, "port_in_use", return_value=True)
    @patch.object(launcher, "saved_process_running", return_value=False)
    @patch.object(launcher, "start_service")
    @patch.object(launcher, "service_ready", side_effect=[False, True, False])
    def test_occupied_port_does_not_spawn_another_server(self, ready, start, saved, port):
        with self.assertRaisesRegex(RuntimeError, "Timed out"):
            launcher.ensure_services()
        start.assert_not_called()

    def test_windows_builder_quotes_paths_and_preserves_unicode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "Bild utforskaren å"
            with patch.object(builder, "PROJECT_ROOT", root):
                output = builder.build_app("windows")
            script = output.read_text(encoding="utf-16")
            self.assertEqual(output.suffix, ".vbs")
            self.assertIn(f'""{root / ".venv" / "Scripts" / "pythonw.exe"}""', script)
            self.assertIn(f'""{root / "scripts" / "launch_desktop.py"}""', script)
            self.assertIn('0, False', script)
            self.assertIn('files.FileExists', script)

    def test_launch_lock_can_be_reacquired(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(launcher, "LAUNCHER_DIR", Path(directory)):
                with launcher.launch_lock():
                    pass
                with launcher.launch_lock():
                    pass

    @unittest.skipUnless(sys.platform == "win32", "Requires Windows process APIs")
    def test_windows_process_check_does_not_call_os_kill(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "api.pid").write_text(str(os.getpid()))
            with patch.object(launcher, "LAUNCHER_DIR", root), patch.object(launcher.os, "kill") as kill:
                self.assertTrue(launcher.saved_process_running("api"))
                (root / "api.pid").write_text("0")
                self.assertFalse(launcher.saved_process_running("api"))
                kill.assert_not_called()

    @unittest.skipUnless(sys.platform == "win32", "Requires Windows creation flags")
    @patch.object(launcher.subprocess, "Popen")
    @patch.object(launcher.Path, "is_dir", return_value=True)
    @patch.object(launcher.shutil, "which", side_effect=[r"C:\Program Files\pnpm\pnpm.cmd", "node.exe"])
    def test_windows_pnpm_cmd_starts_hidden(self, which, is_dir, spawn):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(launcher, "LAUNCHER_DIR", Path(directory)):
                spawn.return_value.pid = 123
                launcher.start_service("web")
        options = spawn.call_args.kwargs
        self.assertTrue(options["shell"])
        self.assertTrue(options["creationflags"] & subprocess.CREATE_NO_WINDOW)
        self.assertNotIn("start_new_session", options)

    @patch.object(launcher, "ensure_services")
    @patch.object(launcher.webbrowser, "open", return_value=True)
    def test_main_opens_browser_after_services_are_ready(self, browser, services):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(launcher, "LAUNCHER_DIR", Path(directory)):
                self.assertEqual(launcher.main(), 0)
        services.assert_called_once_with()
        browser.assert_called_once_with(launcher.WEB_URL)


if __name__ == "__main__":
    unittest.main()
