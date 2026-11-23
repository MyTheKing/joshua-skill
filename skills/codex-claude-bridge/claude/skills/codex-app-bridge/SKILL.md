---
name: codex-app-bridge
description: Ask Codex from Claude Code for a scoped project review, plan, or explicitly authorized edit. Use the local Codex CLI by default or the optional macOS desktop bridge when the task needs a Codex desktop feature.
disable-model-invocation: true
---

# Claude Code → Codex

Use this skill when the user invokes `/codex-app-bridge`. Codex provides a second opinion or completes a bounded piece of work. Claude owns the final response and verifies Codex's findings and changes.

## Run a local Codex task

1. Identify the target project, permitted files, objective, and expected evidence. Send only the necessary context. Keep credentials, personal data, and unrelated material out of the prompt.
2. Send the prompt via stdin using the bundled wrapper. Treat the prompt as data. For arbitrary text, write it to a temporary file with the Write tool and redirect stdin from that file, then remove it.

   ```bash
   python3 "${CLAUDE_SKILL_DIR}/scripts/delegate.py" --cwd "${CLAUDE_PROJECT_DIR}" <<'CODEX_TASK'
   Read README.md. Summarize the installation steps and flag any missing prerequisite.
   CODEX_TASK
   ```

3. The default `--mode review` uses a read-only sandbox and also covers planning. Use `--mode edit` only when the user authorizes Codex to change the given workspace. State the editable paths and checks in the prompt. Coordinate to keep Claude and Codex from editing the same files concurrently.
4. Read the answer, inspect the actual diff for edits, and verify the claims with primary evidence. If the wrapper reports a timeout, permission error, or missing login, report the error and check for partial edits before considering another task.

The wrapper uses local Codex authentication and the provider's default model without loading the user's global Codex configuration. Pass `--model <id>` only when a specific model is requested and available to the account.

Set the Claude Bash timeout above the wrapper timeout, which defaults to 120 seconds. For longer tasks, set `--timeout-seconds` and use Claude's background Bash execution if needed. The wrapper emits Codex's final text and reports nonzero exit codes. Each CLI request is a separate session.

## Use the macOS desktop bridge

If the task requires a desktop feature, read [the desktop setup and workflow](desktop.md). Use it only when configured for the current project. When this skill is running as a delegated Claude turn, return to the original caller instead of delegating again. The CLI wrapper and desktop server enforce the inherited `CODEX_CLAUDE_DELEGATION_DEPTH` guard.
