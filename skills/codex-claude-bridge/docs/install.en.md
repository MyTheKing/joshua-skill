# Installation and upgrades

[简体中文](install.md) · **English**

[Contents](../README.en.md#contents) · [Usage](usage.en.md) · [Troubleshooting](troubleshooting.en.md)

## Install from a ZIP

Download the ZIP you need from the [releases page](https://github.com/MyTheKing/joshua-skill/releases/tag/v0.1.0) and keep its directory structure when extracting it. Install both ZIPs to send tasks in both directions.

| Download | Extracted under the project root | Extracted under your home directory |
| --- | --- | --- |
| `codex-skill.zip` | `.agents/skills/claude-code-bridge/` | `~/.agents/skills/claude-code-bridge/` |
| `claude-skill.zip` | `.claude/skills/codex-app-bridge/` | `~/.claude/skills/codex-app-bridge/` |

Check that the skill directory contains `SKILL.md`. Open your project and start a new session. Enter `$claude-code-bridge` in Codex or `/codex-app-bridge` in Claude Code, followed by the task you want the other agent to handle.

On macOS or Linux, install Python 3.10+ and sign in to the local Codex and Claude Code CLIs. The skill starts the other CLI when invoked. [Codex skill directories](https://learn.chatgpt.com/docs/build-skills) · [Claude Code skill directories](https://code.claude.com/docs/en/skills)

## Optional desktop startup

For CLI use, follow the installation steps above. To open a desktop app when you log in to your Mac, add it under System Settings → General → Login Items & Extensions. [Apple's guide to login items](https://support.apple.com/guide/mac-help/open-items-automatically-when-you-log-in-mh15189/mac)

The [Claude Code → Codex desktop bridge](../claude/skills/codex-app-bridge/desktop.md) needs a local debugging port when Codex launches. If you need a launcher, create an Application in Automator, add a Run Shell Script action with the command below, and save the Automator app. Add that app to your login items. Before testing the launcher, save any drafts and quit the running Codex desktop app.

```sh
/usr/bin/open -b com.openai.codex --args --remote-debugging-address=127.0.0.1 --remote-debugging-port=9229
```

## Upgrade or remove a skill

To upgrade, replace the skill directory with the new version and preserve any local changes you want to keep. To remove it, delete the skill directory and start a new session.
