# Codex ↔ Claude Code Bridge

[简体中文](README.md) · **English**

[Back to the skill catalog](../../README.en.md)

Current version [v0.1.0](https://github.com/MyTheKing/joshua-skill/releases/tag/v0.1.0)

These skills let **Codex and Claude Code hand off tasks and retrieve results in the same project**. For example, one agent can change the code and the other can review it.

- **Codex → Claude Code**. Use `$claude-code-bridge` in Codex to ask Claude Code to read code, review changes, or edit authorized files. You can also send follow-up tasks. [Download the Codex skill](https://github.com/MyTheKing/joshua-skill/releases/download/v0.1.0/codex-skill.zip)
- **Claude Code → Codex**. Use `/codex-app-bridge` in Claude Code to ask Codex to read the project, investigate an issue, or edit authorized files. Codex sends the result back to Claude Code. [Download the Claude Code skill](https://github.com/MyTheKing/joshua-skill/releases/download/v0.1.0/claude-skill.zip)

## Contents

- [Quick start](#quick-start)
- [Installation and upgrades](docs/install.en.md)
- [Using the bridge](docs/usage.en.md)
- [Troubleshooting](docs/troubleshooting.en.md)
- [Source and packaging](#source-and-packaging)
- [License](#license)

## Quick start

1. Download the ZIPs and extract them into the same project root. The Codex skill goes in `.agents/skills/`, and the Claude Code skill goes in `.claude/skills/`. The ZIPs already include these directories.
2. Open the project, start a new session, and invoke one of the skills above with the task for the other agent. For example, `/codex-app-bridge Ask Codex to check whether this change misses anything.`

Install Python 3.10+ on your machine and sign in to the Codex and Claude Code CLIs. Each skill starts the other CLI when invoked. The [installation guide](docs/install.en.md) also covers personal installations and optional desktop startup.

I'll keep improving these skills based on feedback from real projects. I'd love to hear how you use them. [GitHub Issues](https://github.com/MyTheKing/joshua-skill/issues)

## Source and packaging

| Path | Contents |
| --- | --- |
| [codex/](codex/) | Codex skill, background Claude Code sessions, and optional MCP server |
| [claude/](claude/) | Claude Code skill, Codex CLI launcher, and optional macOS desktop bridge |
| [docs/](docs/) | Installation, usage, and troubleshooting guides |
| [scripts/package.py](../../scripts/package.py) | Builds both ZIPs from a Git commit |

Run `python3 scripts/package.py` from the repository root. The ZIPs are written to `dist/`. You can also pass a tag, as in `python3 scripts/package.py v0.1.0`.

## License

[MIT License](../../LICENSE)
