# Joshua Skill

当前版本 [v0.1.0](https://github.com/MyTheKing/joshua-skill/releases/tag/v0.1.0)

Joshua Skill 是一个开源 Skill 仓库。第一组 Skill 让 **Codex 和 Claude Code 在同一个项目里互相派任务、取回结果**。比如让一个 Agent 改代码，再请另一个 Agent 检查。

- **Codex → Claude Code**。在 Codex 中调用 `$claude-code-bridge`，让 Claude Code 读代码、做审查或按授权改文件，还可以接着追问。[下载 Codex Skill](https://github.com/MyTheKing/joshua-skill/releases/latest/download/codex-skill.zip)
- **Claude Code → Codex**。在 Claude Code 中调用 `/codex-app-bridge`，让 Codex 读项目、查问题或按授权改文件，结果会回到 Claude Code。[下载 Claude Code Skill](https://github.com/MyTheKing/joshua-skill/releases/latest/download/claude-skill.zip)

## 目录

- [快速开始](#快速开始)
- [安装和升级](docs/install.md)
- [双向联动用法](docs/usage.md)
- [常见问题](docs/troubleshooting.md)
- [源码与打包](#源码与打包)
- [开源许可](#开源许可)

## 快速开始

1. 下载上面的 ZIP，解压到同一个项目的根目录。Codex Skill 放到 `.agents/skills/`，Claude Code Skill 放到 `.claude/skills/`。ZIP 已经带好目录。
2. 打开项目，新建会话，输入上面的 Skill 命令，再说你想交给对方做什么。比如 `/codex-app-bridge 请让 Codex 帮我看一下这次改动有没有遗漏`。

本机装好 Python 3.10+，并登录 Codex CLI 和 Claude Code 后，Skill 会在调用时启动对方的 CLI。个人目录安装和可选的桌面自启动见[安装说明](docs/install.md)。

如果这组 Skill 帮到了你，欢迎点一下仓库右上角的 ⭐ Star，给项目一点支持。

## 源码与打包

| 路径 | 内容 |
| --- | --- |
| [codex/](codex/) | Codex 技能、Claude Code 后台会话与可选 MCP 服务 |
| [claude/](claude/) | Claude Code 技能、Codex CLI 调用脚本和可选的 macOS 桌面联动 |
| [docs/](docs/) | 安装、用法、排查 |
| [scripts/package.py](scripts/package.py) | 从指定 Git 提交生成两份 ZIP |

执行 `python3 scripts/package.py`，压缩包会写入 `dist/`。也可传入标签，例如 `python3 scripts/package.py v0.1.0`。

## 开源许可

[MIT License](LICENSE)
