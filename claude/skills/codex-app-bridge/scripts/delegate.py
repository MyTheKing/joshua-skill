#!/usr/bin/env python3
"""Run one bounded Codex CLI turn and print its final response."""

import argparse
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile


DEPTH = "CODEX_CLAUDE_DELEGATION_DEPTH"
GUARD = (
    "This is a delegated task from Claude Code. Work only in the specified project "
    "and task scope. Do not invoke Codex, Claude Code, or another agent runner. "
    "Do not access or disclose credentials or unrelated private data. Do not commit, "
    "push, or publish. Return findings, changes, and verification results to Claude."
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cwd", required=True, type=Path, help="The target project directory")
    parser.add_argument("--mode", choices=("review", "edit"), default="review")
    parser.add_argument("--model", help="An optional Codex model available to your account")
    parser.add_argument("--timeout-seconds", type=int, default=120)
    args = parser.parse_args()
    if not 1 <= args.timeout_seconds <= 1800:
        parser.error("--timeout-seconds must be between 1 and 1800")
    if not args.cwd.is_dir():
        parser.error("--cwd must be an existing directory")
    if os.name != "posix":
        return fail("Use the bridge in a POSIX environment such as macOS, Linux, or WSL.", 1)
    if os.environ.get(DEPTH, "0") not in ("", "0"):
        return fail("Recursive Codex/Claude delegation is disabled.", 78)
    executable = shutil.which("codex")
    if not executable:
        return fail("Codex CLI was not found on PATH.", 127)
    if sys.stdin.isatty():
        parser.error("pass the delegated prompt on stdin")
    prompt = sys.stdin.buffer.read(100001)
    if not prompt.strip() or len(prompt) > 100000:
        parser.error("the stdin prompt must contain 1–100000 bytes of text")

    sandbox = "workspace-write" if args.mode == "edit" else "read-only"
    with tempfile.TemporaryDirectory(prefix="claude-codex-") as directory:
        final = Path(directory) / "answer.txt"
        command = [
            executable, "--ask-for-approval", "never", "exec", "--sandbox", sandbox,
            "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "--color", "never",
            "--output-last-message", str(final),
        ]
        if args.model:
            command.append(f"--model={args.model}")
        command.append("-")
        with tempfile.TemporaryFile() as errors:
            try:
                process = subprocess.Popen(
                    command, cwd=args.cwd.resolve(), stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL, stderr=errors, start_new_session=True,
                    env={**os.environ, DEPTH: "1"},
                )
            except OSError as error:
                return fail(f"Could not launch Codex CLI: {error}", 1)

            try:
                signal.signal(signal.SIGTERM, interrupt)
                process.communicate(GUARD.encode() + b"\n\nTask:\n" + prompt, timeout=args.timeout_seconds)
            except (subprocess.TimeoutExpired, KeyboardInterrupt) as error:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
                if isinstance(error, KeyboardInterrupt):
                    return fail("Codex CLI was interrupted.", 130)
                return fail(f"Codex CLI timed out after {args.timeout_seconds} seconds.", 124)

            if process.returncode:
                errors.seek(max(0, errors.tell() - 4000))
                detail = errors.read().decode(errors="replace").strip()
                return fail(f"Codex CLI exited with status {process.returncode}.\n{detail}",
                            process.returncode if process.returncode > 0 else 1)
        if not final.is_file() or not (answer := final.read_text(encoding="utf-8").strip()):
            return fail("Codex CLI produced no final response.", 1)
        print(answer)
    return 0


def fail(message, code):
    print(message, file=sys.stderr)
    return code


def interrupt(_signal, _frame):
    raise KeyboardInterrupt


if __name__ == "__main__":
    sys.exit(main())
