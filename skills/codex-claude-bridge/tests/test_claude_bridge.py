#!/usr/bin/env python3
"""Isolated integration checks: python3 test_bridge.py (never calls real Claude)."""
import json
import os
from pathlib import Path
import subprocess
import sys
import signal
import tempfile
import time
import unittest


SERVER = Path(os.environ.get(
    "BRIDGE_TEST_SERVER",
    Path(__file__).resolve().parents[1] / "codex/.agents/skills/claude-code-bridge/scripts/server.py",
)).resolve()


def fake_claude():
    args = sys.argv[1:]
    if args == ["agents", "--json"]:
        print(os.environ.get("BRIDGE_TEST_NATIVE_SESSIONS", "[]"), flush=True)
        return
    prompt = json.loads(sys.stdin.read())
    session = args[args.index("--session-id" if "--session-id" in args else "--resume") + 1]
    with open(os.environ["BRIDGE_TEST_CALLS"], "a", encoding="utf-8") as handle:
        handle.write(json.dumps({"args": args, "cwd": os.getcwd(), "session": session,
                                 "depth": os.environ.get("CODEX_CLAUDE_DELEGATION_DEPTH")}) + "\n")

    def emit(value):
        print(json.dumps(value), flush=True)

    emit({"type": "assistant", "message": {"content": [
        {"type": "text", "text": "partial:" + prompt["label"]},
        {"type": "thinking", "thinking": "PRIVATE_THINKING"},
        {"type": "tool_use", "name": "Read", "input": {"secret": "PRIVATE_ARGUMENT"}},
    ]}})
    time.sleep(prompt.get("delay", 0))
    if prompt.get("style") == "no_result":
        return
    emit({"type": "result", "subtype": "success", "result": prompt["label"],
          "session_id": "wrong-session" if prompt.get("style") == "wrong_session" else session,
          "is_error": prompt.get("style") == "error",
          "errors": ["simulated failure"] if prompt.get("style") == "error" else [],
          "permission_denials": [{"tool_name": "Edit"}] if prompt.get("style") == "denied" else [],
          "total_cost_usd": 0, "usage": {"input_tokens": 1, "output_tokens": 1}})
    sys.exit(2 if prompt.get("style") == "exit_failure" else 0)


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="claude-bridge-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / "project with spaces"
        self.project.mkdir()
        fake = self.root / "fake-claude"
        fake.write_text(f"#!{sys.executable}\nimport runpy\n"
                        f"runpy.run_path({str(Path(__file__).resolve())!r}, run_name='__fake_claude__')\n")
        fake.chmod(0o700)
        self.env = {**os.environ, "CLAUDE_BRIDGE_STATE": str(self.root / "state"),
                    "CLAUDE_BRIDGE_EXECUTABLE": str(fake),
                    "BRIDGE_TEST_CALLS": str(self.root / "calls.jsonl"),
                    "BRIDGE_TEST_NATIVE_SESSIONS": "[]",
                    "CODEX_CLAUDE_DELEGATION_DEPTH": "0"}
        self.addCleanup(self.stop_workers)

    def call(self, name, args=None, *, error=False, env=None):
        run = subprocess.run([sys.executable, str(SERVER), "call", name],
                             input=json.dumps(args or {}), text=True, capture_output=True,
                             env=env or self.env, timeout=10)
        self.assertEqual(run.returncode, 1 if error else 0, run.stdout + run.stderr)
        return json.loads(run.stdout)

    def new(self, label="answer", **options):
        behavior = {key: options.pop(key) for key in ("delay", "style") if key in options}
        return self.call("claude_new", {"project": str(self.project),
                         "message": json.dumps({"label": label, **behavior}), **options})

    def result(self, thread, wait=5):
        return self.call("claude_result", {"threadId": thread["threadId"], "waitSeconds": wait})

    def wait_for(self, thread, predicate):
        deadline = time.monotonic() + 5
        while True:
            result = self.result(thread, wait=0.1)
            if predicate(result):
                return result
            if time.monotonic() >= deadline:
                self.fail(f"Expected progress did not appear: {result}")

    def stop_workers(self):
        # Cleanup also runs after assertion failures; all paths are in this test's temp directory.
        for path in (self.root / "state").glob("*/thread.json"):
            thread = json.loads(path.read_text())
            self.call("claude_stop", {"threadId": thread["threadId"]})
            self.result(thread)

    def calls(self):
        return [json.loads(line) for line in (self.root / "calls.jsonl").read_text().splitlines()]

    def test_async_progress_concurrent_send_resume_and_isolated_turn_results(self):
        first = self.new("FIRST-RESULT", delay=2, mode="edit", name="Codex 可见会话测试")
        self.assertIn(first["status"], ("starting", "running"))
        rejection = self.call("claude_send", {"threadId": first["threadId"],
                              "message": '{"label":"unwanted"}'}, error=True)
        self.assertIn("TURN_RUNNING", rejection["error"])
        progress = self.wait_for(first, lambda item: "Read" in item["recentTools"])
        self.assertTrue(progress["running"])
        self.assertEqual(progress["turnId"], first["turnId"])
        self.assertIn("Read", progress["recentTools"])
        self.assertNotIn("PRIVATE_", json.dumps(progress))
        done = self.result(first)
        self.assertEqual((done["status"], done["result"]), ("completed", "FIRST-RESULT"))
        self.assertEqual(done["resumeCommand"], "claude --resume " + first["threadId"])
        self.assertIs(done["nativePickerVisible"], False)
        native = json.dumps([{"sessionId": first["threadId"], "pid": os.getpid()}])
        opened = self.call("claude_send", {"threadId": first["threadId"],
                           "message": '{"label":"must not overwrite native session"}'}, error=True,
                           env={**self.env, "BRIDGE_TEST_NATIVE_SESSIONS": native})
        self.assertIn("NATIVE_SESSION_OPEN", opened["error"])
        self.assertEqual(self.result(first, wait=0)["turnId"], first["turnId"])
        second = self.call("claude_send", {"threadId": first["threadId"],
                           "message": '{"label":"SECOND-RESULT","delay":0.5}'})
        self.assertNotEqual(second["turnId"], first["turnId"])
        self.assertEqual(second["threadId"], first["threadId"])
        self.assertNotIn("FIRST-RESULT", second["result"])
        done = self.result(second)
        self.assertEqual((done["status"], done["result"]), ("completed", "SECOND-RESULT"))
        calls = self.calls()
        self.assertEqual(len(calls), 2)
        self.assertIn("--session-id", calls[0]["args"])
        self.assertIn("--name", calls[0]["args"])
        self.assertEqual(calls[0]["args"][calls[0]["args"].index("--name") + 1], "Codex 可见会话测试")
        self.assertIn("--resume", calls[1]["args"])
        self.assertNotIn("--name", calls[1]["args"])
        for invocation in calls:
            self.assertEqual(invocation["session"], first["threadId"])
            self.assertEqual(invocation["cwd"], str(self.project.resolve()))
            self.assertEqual(invocation["depth"], "1")
            self.assertIn("acceptEdits", invocation["args"])
        self.assertEqual(json.loads(Path(first["eventsPath"]).read_text().splitlines()[-1])["result"], "FIRST-RESULT")
        listed = self.call("claude_threads", {"project": str(self.project)})["threads"]
        self.assertEqual([item["turnId"] for item in listed], [second["turnId"]])
        self.assertEqual(self.call("claude_threads", {"project": str(self.root)})["threads"], [])

    def test_cancel_and_timeout(self):
        task = self.new(delay=30)
        stopped = self.call("claude_stop", {"threadId": task["threadId"]})
        self.assertTrue(stopped["cancelRequested"])
        self.assertEqual(self.result(task)["status"], "cancelled")
        self.assertFalse(self.call("claude_stop", {"threadId": task["threadId"]})["cancelRequested"])
        timed = self.result(self.new(delay=30, timeoutSeconds=1))
        self.assertEqual(timed["status"], "timed_out")
        self.assertFalse(timed["running"])

    def test_orphaned_child_holds_lock_and_can_be_cancelled(self):
        task = self.new(delay=30)
        running = self.wait_for(task, lambda item: item.get("pid") and "Read" in item["recentTools"])

        def cleanup_fake():
            # Kill only this test's identified fake if an assertion prevents normal cancellation.
            process = subprocess.run(["ps", "-p", str(running["pid"]), "-o", "command="],
                                     capture_output=True, text=True, timeout=5)
            if str(self.root / "fake-claude") in process.stdout:
                try:
                    os.kill(running["pid"], signal.SIGTERM)
                except ProcessLookupError:
                    pass

        self.addCleanup(cleanup_fake)
        os.kill(running["workerPid"], signal.SIGKILL)
        orphaned = self.wait_for(task, lambda item: item.get("orphaned"))
        self.assertTrue(orphaned["running"])
        rejected = self.call("claude_send", {"threadId": task["threadId"],
                             "message": '{"label":"must not overlap"}'}, error=True)
        self.assertIn("TURN_RUNNING", rejected["error"])
        self.assertTrue(self.call("claude_stop", {"threadId": task["threadId"]})["cancelRequested"])
        stopped = self.result(task)
        self.assertEqual(stopped["status"], "cancelled")
        self.assertFalse(stopped["running"])

    def test_failure_and_permission_denial_classification(self):
        for style, expected in [("error", "failed"), ("exit_failure", "failed"),
                                ("no_result", "failed"), ("wrong_session", "failed"),
                                ("denied", "blocked")]:
            with self.subTest(style=style):
                result = self.result(self.new(style=style))
                self.assertEqual(result["status"], expected)
                self.assertFalse(result["running"])
                if style == "denied":
                    self.assertEqual(result["permissionDenials"], [{"tool_name": "Edit"}])
                if style == "error":
                    self.assertEqual(result["errors"], ["simulated failure"])

    def test_validation_and_recursion_do_not_launch_claude(self):
        valid = {"message": '{"label":"never"}', "project": str(self.project)}
        for extra in [{"message": ""}, {"message": "x\x00y"}, {"project": "relative"},
                      {"mode": "unrestricted"}, {"timeoutSeconds": True}, {"timeoutSeconds": 0},
                      {"timeoutSeconds": 10 ** 400},
                      {"maxBudgetUsd": -1}, {"unknown": "argument"}]:
            with self.subTest(extra=extra):
                self.assertIn("error", self.call("claude_new", {**valid, **extra}, error=True))
        self.call("claude_new", {"message": "missing project"}, error=True)
        self.call("claude_result", {"threadId": "../../outside"}, error=True)
        self.call("unknown_tool", error=True)
        recursive = self.call("claude_new", valid, error=True,
                              env={**self.env, "CODEX_CLAUDE_DELEGATION_DEPTH": "1"})
        self.assertIn("RECURSION_BLOCKED", recursive["error"])
        self.assertFalse((self.root / "calls.jsonl").exists())
        self.assertEqual(self.call("claude_threads")["threads"], [])

    def test_stdio_mcp_and_task_survives_server_restart(self):
        def exchange(process, method, params=None, request_id=1):
            process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": request_id,
                                           "method": method, "params": params or {}}) + "\n")
            process.stdin.flush()
            reply = json.loads(process.stdout.readline())
            self.assertEqual((reply["jsonrpc"], reply["id"]), ("2.0", request_id))
            return reply

        def start_server():
            return subprocess.Popen([sys.executable, str(SERVER)], env=self.env, text=True,
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        def close_server(process):
            process.stdin.close()
            process.wait(timeout=5)
            self.assertEqual(process.returncode, 0, process.stderr.read())
            process.stdout.close()
            process.stderr.close()

        process = start_server()
        try:
            initialized = exchange(process, "initialize", {"protocolVersion": "2025-06-18"})["result"]
            self.assertEqual(initialized["protocolVersion"], "2025-06-18")
            self.assertIn("tools", initialized["capabilities"])
            names = {tool["name"] for tool in exchange(process, "tools/list")["result"]["tools"]}
            self.assertEqual(names, {"claude_new", "claude_send", "claude_result", "claude_threads", "claude_stop"})
            args = {"project": str(self.project), "message": '{"label":"persistent","delay":0.8}'}
            result = exchange(process, "tools/call", {"name": "claude_new", "arguments": args})["result"]
            self.assertFalse(result["isError"])
            task = result["structuredContent"]
            self.assertEqual(json.loads(result["content"][0]["text"]), task)
            self.assertTrue(task["running"])
        finally:
            close_server(process)
        process = start_server()
        try:
            result = exchange(process, "tools/call", {"name": "claude_result", "arguments": {
                "threadId": task["threadId"], "waitSeconds": 5}})["result"]
            self.assertEqual(result["structuredContent"]["status"], "completed")
            self.assertEqual(result["structuredContent"]["result"], "persistent")
            bad = exchange(process, "tools/call", {"name": "claude_result", "arguments": {
                "threadId": "invalid"}})["result"]
            self.assertTrue(bad["isError"])
            self.assertEqual(bad["content"][0]["type"], "text")
            self.assertEqual(exchange(process, "unknown")["error"]["code"], -32601)
            self.assertEqual(exchange(process, "ping")["result"], {})
        finally:
            close_server(process)


if __name__ == "__fake_claude__":
    fake_claude()
elif __name__ == "__main__":
    unittest.main()
