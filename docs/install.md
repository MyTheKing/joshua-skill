# 安装和升级

[返回目录](../README.md#目录) · [用法](usage.md) · [常见问题](troubleshooting.md)

## 运行环境

- macOS 或 Linux。项目默认路径使用 Python 3.10+，Codex → Claude Code 的后台进程依赖 POSIX 进程和文件锁。
- 在本机安装 `codex` 和 `claude`。启动接收端 CLI 并完成登录，可用 `codex --version` 和 `claude --version` 检查命令是否可用。
- 从目标项目的根目录启动发起端。使用 Codex 桌面时，请打开该本地项目。

## 从 ZIP 导入项目

从 [GitHub Releases](https://github.com/MyTheKing/my-skill/releases/latest) 下载所需的包。把 ZIP 解压到项目根目录，让已有的隐藏目录和包里的目录合并。

| 包 | 解压后的技能入口 |
| --- | --- |
| `codex-skill.zip` | `.agents/skills/claude-code-bridge/SKILL.md` |
| `claude-skill.zip` | `.claude/skills/codex-app-bridge/SKILL.md` |

将两个目录纳入项目 Git 后，协作者克隆项目即可获得技能文件。用户账号由各自的 CLI 管理。

## 从仓库导入项目

也可从仓库复制完整的技能子目录。把下面两个变量换成自己的目录。

```sh
repo=/path/to/my-skill
project=/path/to/your/project
mkdir -p "$project/.agents/skills" "$project/.claude/skills"
cp -R "$repo/codex/.agents/skills/claude-code-bridge" "$project/.agents/skills/"
cp -R "$repo/claude/skills/codex-app-bridge" "$project/.claude/skills/"
```

## 升级或移除

升级前先检查目标项目里的技能是否有本地改动。保留所需改动，再用新版替换对应的整个技能目录。移除时删除表里对应的技能目录并新开会话。如果另行注册了 MCP，移除技能时也可以移除对应的 MCP 配置。
