#!/usr/bin/env python3
"""Exercise the CLI wrapper using a local fake Codex executable."""

import os
from pathlib import Path
import subprocess
import sys
import tempfile


delegate = Path(__file__).with_name("delegate.py")
with tempfile.TemporaryDirectory(prefix="claude bridge check ") as directory:
    codex = Path(directory) / "codex"
    codex.write_text(f"#!{sys.executable}\n" + """
import os
from pathlib import Path
import sys
import time

args = sys.argv[1:]
assert args[:3] == ['--ask-for-approval', 'never', 'exec']
assert args[args.index('--sandbox') + 1] == os.environ['CHECK_SANDBOX']
assert '--ephemeral' in args and '--ignore-user-config' in args and args[-1] == '-'
assert '--model=some-model' in args
assert os.getcwd() == os.environ['CHECK_PROJECT']
assert os.environ['CODEX_CLAUDE_DELEGATION_DEPTH'] == '1'
prompt = sys.stdin.buffer.read().decode('utf-8')
assert 'Do not invoke Codex, Claude Code, or another agent runner.' in prompt
assert prompt.endswith('复核 README.md\\n')
if os.environ.get('CHECK_FAILURE') == 'timeout':
    time.sleep(10)
if os.environ.get('CHECK_FAILURE') == 'login':
    print('Codex CLI needs login.', file=sys.stderr)
    sys.exit(3)
Path(args[args.index('--output-last-message') + 1]).write_text('read README', encoding='utf-8')
""", encoding="utf-8")
    codex.chmod(0o700)
    project = Path(directory).resolve()
    environment = {**os.environ, "PATH": f"{project}{os.pathsep}{os.environ.get('PATH', '')}",
                   "CHECK_PROJECT": str(project), "CODEX_CLAUDE_DELEGATION_DEPTH": "0"}

    def run(mode="review", depth="0", failure=""):
        timeout = "1" if failure == "timeout" else "10"
        return subprocess.run(
            [sys.executable, str(delegate), "--cwd", str(project), "--mode", mode,
             "--model", "some-model", "--timeout-seconds", timeout],
            input="复核 README.md\n", encoding="utf-8", capture_output=True, timeout=15,
            env={**environment, "CHECK_SANDBOX": "read-only" if mode == "review" else "workspace-write",
                 "CHECK_FAILURE": failure, "CODEX_CLAUDE_DELEGATION_DEPTH": depth},
        )

    for mode in ("review", "edit"):
        result = run(mode)
        assert result.returncode == 0 and result.stdout.strip() == "read README", result
    assert run(depth="1").returncode == 78
    assert run(failure="timeout").returncode == 124
    result = run(failure="login")
    assert result.returncode == 3 and "needs login" in result.stderr, result

print("Claude → Codex CLI checks passed: review, edit, recursion, timeout, CLI error.")
