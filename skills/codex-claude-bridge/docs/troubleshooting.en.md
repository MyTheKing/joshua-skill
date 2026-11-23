# Troubleshooting

[简体中文](troubleshooting.md) · **English**

[Contents](../README.en.md#contents) · [Installation](install.en.md) · [Usage](usage.en.md)

| Problem | What to check |
| --- | --- |
| The skill is missing | Confirm that you extracted it into the project root and that the hidden directory matches the [installation table](install.en.md#install-from-a-zip). Trust the project and try a new session. |
| `claude`, `codex`, or `python3` is missing | Check that the command is on the `PATH` in the initiating agent's environment. Reopen the agent after updating its CLI. |
| The receiving agent asks you to sign in | Start the corresponding CLI directly on your machine, complete its sign-in flow, and try again. |
| The initiating agent reports a permission error | Check which command, path, or network request the host blocked. If needed, follow the host's prompts to authorize this task. |
| A background Claude task has not returned a result yet | Call `claude_result` with its `threadId`, then check the returned status, permission errors, and `stderrPath`. |
| The background session is missing from Claude's interactive history | In the original project directory, run the `claude --resume <threadId>` command returned by the bridge. Exit that interactive session before resuming through the bridge again. |
| Codex reports that the model is unavailable | Check which models your account supports and use the Claude-side script's `--model` option to select one. |
| The local debugging port is unreachable | Use the CLI mode or check the prerequisites in the [desktop setup guide](../claude/skills/codex-app-bridge/desktop.md). |
| The bridge blocks a recursive call | Finish the work in the agent that started the current session, or start a new task from a separate session. |

Background records for Codex → Claude Code are stored in `~/.codex/claude-bridge/` by default. They contain task prompts and output. Check which files and data you can share before delegating sensitive work.
