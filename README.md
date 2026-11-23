# My Skill

一组可以随项目分发的协作技能。首版让 **Codex 和 Claude Code 双向委派**，在同一个项目里互相做代码审查、方案复核，或按授权接手具体改动。

| 从哪里发起 | 交给谁 | 项目安装包 | 启动方式 |
| --- | --- | --- | --- |
| Codex | Claude Code | [codex-skill.zip](https://github.com/MyTheKing/my-skill/releases/latest/download/codex-skill.zip) | `$claude-code-bridge` |
| Claude Code | Codex | [claude-skill.zip](https://github.com/MyTheKing/my-skill/releases/latest/download/claude-skill.zip) | `/codex-app-bridge` |

## 目录

- [快速开始](#快速开始)
- [安装和升级](docs/install.md)
- [双向联动用法](docs/usage.md)
- [常见问题](docs/troubleshooting.md)
- [源码与打包](#源码与打包)
- [开源许可](#开源许可)

## 快速开始

使用 macOS 或 Linux，安装 Python 3.10+、Codex CLI 和 Claude Code，再按各自官方流程登录。要用两个方向，就把两份 ZIP 都解压到**同一个项目的根目录**。只用一个方向时，下载对应发起端的 ZIP 即可。两个包都会保留隐藏目录结构。

```sh
cd /path/to/your/project
unzip /path/to/codex-skill.zip
unzip /path/to/claude-skill.zip
```

从项目根目录打开 Codex 或 Claude Code，新建会话后试试下面任意一条。

- 在 Codex 里输入 `$claude-code-bridge 请让 Claude Code 复核 README 的安装步骤，只给建议。`
- 在 Claude Code 里输入 `/codex-app-bridge 让 Codex 复核 README 的安装步骤，只给建议。`

两个方向默认按只读任务运行，使用接收端已有的本地登录。安装包包含运行脚本，项目导入不需要额外注册 MCP。首次使用时，宿主可能要求你信任项目或允许执行本地脚本。参见官方技能目录说明。[Codex Skills](https://learn.chatgpt.com/docs/build-skills) · [Claude Code Skills](https://code.claude.com/docs/en/skills)

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
