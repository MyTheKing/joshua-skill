# Optional macOS desktop connection

Use this connection when a task depends on Codex desktop features. It requires Node.js 22 or newer, a running Codex desktop app with an existing loopback-only CDP endpoint, and the same project open in both apps. Desktop support uses the app's sidebar and session logs, so compatibility depends on the app version. The bundled sidebar labels cover English, Simplified Chinese, and Traditional Chinese.

From the project root, register the bundled server in Claude Code and use the port that your local app already provides.

```bash
claude mcp add --scope local codex-app-bridge \
  -e "CODEX_BRIDGE_PROJECT_ROOT=$PWD" -e CODEX_DEBUG_PORT=9229 \
  -- node "$PWD/.claude/skills/codex-app-bridge/desktop/server.mjs"
```

Start a new Claude Code session in the project and invoke `/codex-app-bridge` with a task that explicitly requires the desktop. Review the model's proposed actions. The desktop app applies its own current permissions. Register the server only in trusted projects. Keep the CDP port inaccessible from other machines.

1. Call `codex_new` with a bounded task. Retain the returned `threadId`. If the ID is missing, check the desktop before retrying because a message may already have been sent.
2. Call `codex_result` with that ID and `waitSeconds` up to 30 seconds. Poll until `completed`, `cancelled`, or `interrupted`. A completed result includes final text and can include up to three explicit Markdown image links to existing project files. Ask Codex to save shareable screenshots inside the authorized project if the user needs them.
3. After a turn ends, call `codex_send` with the same ID when a scoped follow-up is needed. `codex_threads` lists IDs opened by this MCP process. If Claude reconnects or restarts the MCP process, create a new desktop session.

Choose the CLI workflow when the desktop endpoint is unavailable, or when an app update changes its UI or logs. The MCP server only connects to an existing endpoint and will report an error if it is unavailable. Remove the registration from the same project with `claude mcp remove --scope local codex-app-bridge`.
