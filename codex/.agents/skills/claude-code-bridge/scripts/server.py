#!/usr/bin/env python3
"""Persistent Claude Code tasks over local stdio MCP or a one-shot JSON CLI."""
from __future__ import annotations

import fcntl
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(os.environ.get("CLAUDE_BRIDGE_STATE", Path.home() / ".codex/claude-bridge"))
CLAUDE = os.environ.get("CLAUDE_BRIDGE_EXECUTABLE", shutil.which("claude") or str(Path.home() / ".local/bin/claude"))
DEPTH = "CODEX_CLAUDE_DELEGATION_DEPTH"
ACTIVE = {"starting", "running"}
GUARD = (
    "Complete this bounded task delegated by Codex in the supplied working directory. "
    "Do not invoke Codex, Claude Code, another agent runner, or delegate this task. "
    "Never read or reveal credentials, tokens, or unrelated private data. "
    "Preserve existing unrelated changes. Do not commit, push, create a PR, or change "
    "branches unless this task explicitly requests it. Report changed paths, actual "
    "working directory, checks and results, and unresolved issues. If a required tool "
    "is denied, report the blocker; do not bypass permissions."
)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False, encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False)
        handle.write("\n")
        temp = handle.name
    os.replace(temp, path)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def valid_id(value):
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise ValueError("threadId must be a full lowercase UUID returned by claude_new")
    return value


def text_arg(value, name, limit=100000):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or "\x00" in value:
        raise ValueError(f"{name} must be nonempty text, at most {limit} characters, with no NUL")
    return value


def number(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not low <= value <= high or not math.isfinite(value):
        raise ValueError(f"{name} must be a number from {low} to {high}")
    return value


def thread_dir(thread_id):
    directory = ROOT / valid_id(thread_id)
    if not (directory / "thread.json").is_file():
        raise ValueError("Unknown bridge thread; existing interactive Claude sessions are not adopted")
    return directory


def lock_thread(directory):
    handle = (directory / "lock").open("a+")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.close()
        raise ValueError("TURN_RUNNING: wait for claude_result or cancel with claude_stop") from None
    return handle


def process_start(pid):
    if not isinstance(pid, int) or pid <= 0:
        return ""
    result = subprocess.run(["/bin/ps", "-p", str(pid), "-o", "lstart="], capture_output=True, text=True, timeout=3)
    return result.stdout.strip() if result.returncode == 0 else ""


def orphaned(state):
    return bool(state.get("workerStart")) and process_start(state.get("workerPid")) != state["workerStart"]


def events(path):
    if path.exists():
        with path.open(encoding="utf-8", errors="replace") as handle:
            for line in handle:
                try:
                    item = json.loads(line)
                    if isinstance(item, dict):
                        yield item
                except json.JSONDecodeError:
                    continue  # The writer may be halfway through its last line.


def output_details(turn_dir):
    result = None
    texts, tools = [], []
    for event in events(turn_dir / "events.jsonl"):
        if event.get("type") == "result":
            result = event
        if event.get("type") == "assistant":
            for block in event.get("message", {}).get("content", []):
                if block.get("type") == "text":
                    texts.append(block.get("text", ""))
                elif block.get("type") == "tool_use":
                    tools.append(block.get("name", "unknown"))
    # Only surface text and tool names, never thinking blocks or tool arguments.
    return result, "\n\n".join(texts)[-24000:], tools[-20:]


def snapshot(thread_id):
    directory = thread_dir(thread_id)
    thread = read_json(directory / "thread.json")
    turn_dir = directory / thread["turnId"]
    state = read_json(turn_dir / "state.json")
    if state["status"] in ACTIVE:
        try:
            handle = lock_thread(directory)
        except ValueError:
            pass
        else:
            # An inherited flock outlives the MCP connection and is released by a dead worker.
            try:
                state = read_json(turn_dir / "state.json")
                if state["status"] in ACTIVE:
                    state.update(status="cancelled" if (turn_dir / "cancel").exists() else "interrupted", endedAt=time.time(), error="Worker exited before recording a final result")
                    write_json(turn_dir / "state.json", state)
            finally:
                handle.close()
    final, partial, recent_tools = output_details(turn_dir)
    answer = {
        **thread, **state,
        "running": state["status"] in ACTIVE,
        "actualProject": thread["project"],
        "elapsedSeconds": round((state.get("endedAt") or time.time()) - state["startedAt"], 1),
        "result": final.get("result", partial) if final else partial,
        "recentTools": recent_tools,
        "permissionDenials": final.get("permission_denials", []) if final else [],
        "errors": final.get("errors", []) if final else [],
        "eventsPath": str(turn_dir / "events.jsonl"),
        "stderrPath": str(turn_dir / "stderr.log"),
        "resumeCommand": "claude --resume " + thread_id,
        "nativePickerVisible": False,
    }
    if answer["running"] and orphaned(state):
        answer.update(orphaned=True, error="Worker exited but Claude still holds the session lock; cancel or wait before resuming")
    if final:
        answer["costUsd"] = final.get("total_cost_usd")
        answer["usage"] = final.get("usage")
    return answer


def launch(thread, message, first):
    if os.environ.get(DEPTH, "0") != "0":
        raise ValueError("RECURSION_BLOCKED: delegated Claude tasks cannot delegate again")
    message = text_arg(message, "message")
    directory = ROOT / thread["threadId"]
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    handle = lock_thread(directory)
    try:
        if not first:
            active = subprocess.run([CLAUDE, "agents", "--json"], capture_output=True, text=True, timeout=10, check=True)
            sessions = json.loads(active.stdout)
            if not isinstance(sessions, list):
                raise ValueError("Cannot verify whether the Claude session is already open")
            if any(session.get("sessionId") == thread["threadId"] and session.get("pid") for session in sessions):
                raise ValueError("NATIVE_SESSION_OPEN: exit the interactive Claude session before continuing through the bridge")
        thread = {**thread, "turnId": str(uuid.uuid4())}
        turn_dir = directory / thread["turnId"]
        turn_dir.mkdir(mode=0o700)
        (turn_dir / "prompt.txt").write_text(message, encoding="utf-8")
        os.chmod(turn_dir / "prompt.txt", 0o600)
        state = {"status": "starting", "startedAt": time.time(), "first": first}
        write_json(turn_dir / "state.json", state)
        write_json(directory / "thread.json", thread)
        with (turn_dir / "worker.log").open("w") as log:
            try:
                subprocess.Popen(
                    [sys.executable, str(Path(__file__).resolve()), "_worker", thread["threadId"], thread["turnId"], str(handle.fileno())],
                    stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                    start_new_session=True, pass_fds=(handle.fileno(),),
                )
            except OSError as error:
                state.update(status="failed", endedAt=time.time(), error=str(error))
                write_json(turn_dir / "state.json", state)
                raise
    finally:
        # Do not LOCK_UN: the detached worker inherited this same flock.
        handle.close()
    return snapshot(thread["threadId"])


def command(thread, first):
    args = [CLAUDE, "--print", "--verbose", "--output-format", "stream-json", "--permission-prompts", "none",
            "--no-chrome", "--prompt-suggestions", "false", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
            "--append-system-prompt", GUARD,
            "--session-id" if first else "--resume", thread["threadId"]]
    mode = thread["mode"]
    args += ["--permission-mode", {"review": "dontAsk", "plan": "plan", "edit": "acceptEdits"}[mode],
             "--tools", "Read,Glob,Grep,Edit,Write,Bash" if mode == "edit" else "Read,Glob,Grep"]
    if first:
        args += ["--name", thread["name"]]
    if thread.get("model"):
        args += ["--model", thread["model"]]
    if thread.get("maxBudgetUsd") is not None:
        args += ["--max-budget-usd", str(thread["maxBudgetUsd"])]
    return args


def terminate(process):
    if process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()


def worker(thread_id, turn_id, lock_fd):
    directory = thread_dir(thread_id)
    thread = read_json(directory / "thread.json")
    turn_dir = directory / valid_id(turn_id)
    state = read_json(turn_dir / "state.json")
    process = None
    def interrupted(_signum, _frame):
        raise InterruptedError("Worker interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    try:
        if thread["turnId"] != turn_id:
            raise ValueError("Worker turn does not match current thread")
        state.update(workerPid=os.getpid(), workerStart=process_start(os.getpid()))
        write_json(turn_dir / "state.json", state)
        environment = {**os.environ, DEPTH: "1"}
        with (turn_dir / "prompt.txt").open() as prompt, (turn_dir / "events.jsonl").open("w") as output, (turn_dir / "stderr.log").open("w") as error:
            process = subprocess.Popen(command(thread, state["first"]), cwd=thread["project"], env=environment,
                                       stdin=prompt, stdout=output, stderr=error, start_new_session=True, pass_fds=(lock_fd,))
            state.update(status="running", pid=process.pid, pidStart=process_start(process.pid))
            write_json(turn_dir / "state.json", state)
            deadline = time.monotonic() + thread["timeoutSeconds"]
            while process.poll() is None:
                if (turn_dir / "cancel").exists() or time.monotonic() >= deadline:
                    state["status"] = "cancelled" if (turn_dir / "cancel").exists() else "timed_out"
                    terminate(process)
                    break
                time.sleep(0.2)
            state["exitCode"] = process.returncode
        if state["status"] == "running":
            final, _, _ = output_details(turn_dir)
            if not final or process.returncode != 0 or final.get("is_error"):
                state.update(status="failed", error="Claude failed; inspect errors and stderrPath" if final else "Claude exited without a structured result; inspect stderrPath")
            elif final.get("session_id") != thread_id:
                state.update(status="failed", error="Claude returned an unexpected session ID")
            else:
                state["status"] = "blocked" if final.get("permission_denials") else "completed"
    except BaseException as error:
        state.update(status="failed", error=f"{type(error).__name__}: {error}")
    finally:
        if process is not None:
            terminate(process)
        state["endedAt"] = time.time()
        write_json(turn_dir / "state.json", state)
        os.close(lock_fd)


def call_tool(name, args):
    if not isinstance(args, dict):
        raise ValueError("arguments must be a JSON object")
    schema = next((tool["inputSchema"] for tool in TOOLS if tool["name"] == name), None)
    if not schema:
        raise ValueError(f"Unknown tool: {name}")
    if set(args) - set(schema["properties"]) or set(schema.get("required", [])) - set(args):
        raise ValueError("Unknown or missing arguments; consult tools/list")
    if name == "claude_new":
        project = Path(text_arg(args["project"], "project", 4096)).expanduser()
        if not project.is_absolute() or not project.is_dir():
            raise ValueError("project must be an existing absolute directory")
        mode = args.get("mode", "review")
        if mode not in ("review", "plan", "edit"):
            raise ValueError("mode must be review, plan, or edit")
        thread = {"threadId": str(uuid.uuid4()), "project": str(project.resolve()), "mode": mode,
                  "name": text_arg(args.get("name", "Codex delegated task"), "name", 200),
                  "timeoutSeconds": number(args.get("timeoutSeconds", 1800), "timeoutSeconds", 1, 86400)}
        if "model" in args:
            thread["model"] = text_arg(args["model"], "model", 200)
        if "maxBudgetUsd" in args:
            thread["maxBudgetUsd"] = number(args["maxBudgetUsd"], "maxBudgetUsd", 0.01, 10000)
        return launch(thread, args["message"], True)
    if name == "claude_threads":
        project = str(Path(text_arg(args["project"], "project", 4096)).expanduser().resolve()) if "project" in args else None
        threads = []
        for path in ROOT.glob("*/thread.json"):
            thread = read_json(path)
            if project is None or thread["project"] == project:
                item = snapshot(thread["threadId"])
                threads.append({key: item[key] for key in ("threadId", "turnId", "name", "project", "mode", "status", "running", "startedAt", "elapsedSeconds")})
        return {"threads": sorted(threads, key=lambda x: x["startedAt"], reverse=True)}
    directory = thread_dir(args["threadId"])
    if name == "claude_send":
        thread = read_json(directory / "thread.json")
        return launch(thread, args["message"], False)
    if name == "claude_stop":
        item = snapshot(args["threadId"])
        if item["running"]:
            (directory / item["turnId"] / "cancel").touch(mode=0o600)
            if item.get("orphaned"):
                pid = item.get("pid")
                if not item.get("pidStart") or process_start(pid) != item["pidStart"]:
                    raise ValueError("ORPHAN_IDENTITY_UNKNOWN: cannot safely stop the child; session remains locked until it exits")
                try:
                    if os.getpgid(pid) != pid:
                        raise ValueError("ORPHAN_IDENTITY_UNKNOWN: child process group changed")
                    os.killpg(pid, signal.SIGTERM)
                    deadline = time.monotonic() + 5
                    while process_start(pid) == item["pidStart"] and time.monotonic() < deadline:
                        time.sleep(0.1)
                    if process_start(pid) == item["pidStart"] and os.getpgid(pid) == pid:
                        os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        return {**snapshot(args["threadId"]), "cancelRequested": item["running"]}
    wait = number(args.get("waitSeconds", 0), "waitSeconds", 0, 50)
    deadline = time.monotonic() + wait
    while True:
        item = snapshot(args["threadId"])
        if not item["running"] or time.monotonic() >= deadline:
            return item
        time.sleep(min(0.4, max(0, deadline - time.monotonic())))


STRING = {"type": "string"}
def tool(name, description, properties, required=()):
    return {"name": name, "description": description,
            "inputSchema": {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False}}


TOOLS = [
    tool("claude_new", "Start a persistent Claude Code task in the background without GUI. Review is read-only; use edit only for authorized changes. Returns threadId immediately.",
         {"message": STRING, "project": {"type": "string", "description": "Existing absolute working directory"}, "mode": {"type": "string", "enum": ["review", "plan", "edit"], "default": "review"},
          "name": STRING, "model": STRING, "timeoutSeconds": {"type": "number", "minimum": 1, "maximum": 86400, "default": 1800}, "maxBudgetUsd": {"type": "number", "minimum": 0.01, "maximum": 10000}}, ["message", "project"]),
    tool("claude_send", "Continue a bridge thread with its saved context and permissions. Rejects a running turn. Starts a new asynchronous turn.", {"threadId": STRING, "message": STRING}, ["threadId", "message"]),
    tool("claude_threads", "List this bridge's persisted tasks and current states, optionally filtered by project.", {"project": STRING}),
    tool("claude_result", "Read current progress, result, errors and permission denials. Optionally wait up to 50 seconds. A completed turn still needs Codex verification.",
         {"threadId": STRING, "waitSeconds": {"type": "number", "minimum": 0, "maximum": 50, "default": 0}}, ["threadId"]),
    tool("claude_stop", "Request cancellation of a bridge task. Keeps its transcript so it can be resumed. Check claude_result for the final cancellation state.", {"threadId": STRING}, ["threadId"]),
]


def serve():
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("JSON-RPC request must be an object")
            if "id" not in request:
                continue
            method = request.get("method")
            if method == "initialize":
                version = request.get("params", {}).get("protocolVersion")
                result = {"protocolVersion": version if version in ("2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25") else "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "claude-code-bridge", "version": "1.0.0"}}
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": TOOLS}
            elif method == "tools/call":
                try:
                    params = request.get("params", {})
                    payload = call_tool(params.get("name"), params.get("arguments", {}))
                    result = {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}], "structuredContent": payload, "isError": False}
                except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
                    result = {"content": [{"type": "text", "text": str(error)}], "isError": True}
            else:
                print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "error": {"code": -32601, "message": "Unknown method"}}), flush=True)
                continue
            response = {"jsonrpc": "2.0", "id": request["id"], "result": result}
        except (ValueError, TypeError, AttributeError) as error:
            response = {"jsonrpc": "2.0", "id": request.get("id") if isinstance(request, dict) else None, "error": {"code": -32700, "message": str(error)}}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    os.umask(0o077)
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    if len(sys.argv) > 1 and sys.argv[1] == "_worker":
        worker(sys.argv[2], sys.argv[3], int(sys.argv[4]))
    elif len(sys.argv) > 2 and sys.argv[1] == "call":
        try:
            arguments = json.loads(sys.argv[3] if len(sys.argv) > 3 else sys.stdin.read())
            print(json.dumps(call_tool(sys.argv[2], arguments), ensure_ascii=False, indent=2))
        except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
            print(json.dumps({"error": str(error)}, ensure_ascii=False))
            sys.exit(1)
    else:
        serve()
