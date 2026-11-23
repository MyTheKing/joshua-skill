# Using the bridge

[简体中文](usage.md) · **English**

[Contents](../README.en.md#contents) · [Installation](install.en.md) · [Troubleshooting](troubleshooting.en.md)

## Codex → Claude Code

```text
$claude-code-bridge Ask Claude to review src/parser.py and report edge cases with line numbers.
```

Claude starts in the background. Codex can find sessions by project and use the `threadId` to check progress, resume a session, or request a stop. A resumed session uses its original permissions. Keep the initiating session running if you want it to follow up on results.

The default `review` mode allows reading and searching. Use `plan` to request a proposed approach. When you want Claude to edit files, explicitly authorize `edit` and specify which files it can change. Codex checks Claude's results and the actual diff.

### Optional Codex MCP registration

The ZIP includes a command-line entry point. To let the skill call MCP tools such as `claude_new` and `claude_result` directly, run the following command from the project root, then reopen Codex. This adds a **user-level** MCP configuration. Update its path if you move the project.

```sh
codex mcp add my-skill-claude -- python3 "$PWD/.agents/skills/claude-code-bridge/scripts/server.py"
```

Remove the configuration with `codex mcp remove my-skill-claude`. If a server already uses that name, check its configured path first.

## Claude Code → Codex

```text
/codex-app-bridge Ask Codex to review exception handling in src/parser.py and report file locations and reproduction conditions.
```

By default, the skill calls the local Codex CLI. Codex gives a second opinion on the specified project, and Claude Code reports and independently checks the result. To delegate edits, give it a clear scope and commands to verify the changes.

### Optional macOS desktop bridge

For Codex desktop features, follow the [desktop bridge setup](../claude/skills/codex-app-bridge/desktop.md) to connect to an enabled local debugging port. The desktop bridge can create sessions, follow up on results, continue tasks, and return images from the task's project directory. The CLI mode covers routine coding tasks.

## Writing a handoff

Give the receiving agent the context it needs. State the goal, project directory, what it can read or edit, and how to verify the result. Both skills limit further delegation to avoid passing tasks back and forth in a loop. Delegation uses the receiving agent's account and quota. The model service you use still processes project content and prompts.
