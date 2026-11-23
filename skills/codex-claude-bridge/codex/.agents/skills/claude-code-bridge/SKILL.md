---
name: claude-code-bridge
description: Delegate a bounded task from Codex to local Claude Code, follow a background turn, and resume the same session. Use when the user asks Claude Code for a review, plan, or scoped implementation.
---

# Claude Code Bridge

Use the installed Claude Code CLI to run a separate background session in the target project. If the MCP tools below are available, use them. Otherwise, use the bundled [server.py](scripts/server.py) as a CLI. Use the script inside the directory of the loaded skill.

1. Read project rules and establish the allowed files, expected result, and verification. Give Claude only the relevant task context. Ask it to avoid other agent runners and recursive delegation.
2. Start with `claude_new` and retain its `threadId`. Use an existing absolute project path. Default to `review`; use `plan` for planning. Both limit Claude to reading and searching. Use `edit` only for authorized edits. Edits happen in the supplied directory, so coordinate any concurrent writes to the same files.
3. Use `claude_result` with `waitSeconds` up to 50 while the turn is active. Review `status`, `result`, `errors` and `permissionDenials`. Only `completed` indicates success. Verify the result and any actual file changes independently.
4. Use `claude_send` after the turn reaches a terminal state to continue with the same project and permissions. Use `claude_stop` to request cancellation and poll for the final state. Use `claude_threads` with the current project path to find tasks created by the bridge.

## CLI

Run from the project root after importing the Codex package. For arbitrary task text, write the JSON arguments to a file and pass it on stdin.

```sh
python3 .agents/skills/claude-code-bridge/scripts/server.py call claude_new <<'JSON'
{"project": "/absolute/path/to/project", "mode": "review", "message": "Review the README for unclear setup steps. Return findings only."}
JSON
```

Use the same `call` entry point for the following tools.

| Tool | JSON arguments |
| --- | --- |
| `claude_result` | `threadId`, optional `waitSeconds` |
| `claude_send` | `threadId`, `message` |
| `claude_threads` | optional absolute `project` |
| `claude_stop` | `threadId` |

A background session can be opened manually with the returned `resumeCommand` from `actualProject`. Close that interactive session before asking the bridge to continue it. Background sessions may be absent from Claude's interactive session picker.

Keep task and permission scope intact if the host denies a command or Claude reports a blocker. Diagnose authentication, timeout, or permission errors using the returned status and stderr path. Background completion does not wake a finished Codex conversation.
