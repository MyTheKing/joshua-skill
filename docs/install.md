# 安装和升级

[返回目录](../README.md#目录) · [用法](usage.md) · [常见问题](troubleshooting.md)

## 从 ZIP 导入项目

从 [Releases](https://github.com/MyTheKing/joshua-skill/releases/latest) 下载对应的 ZIP，保留里面的目录结构。想双向联调，两个包都装上。

| 下载包 | 解压到项目根目录后 | 解压到个人主目录后 |
| --- | --- | --- |
| `codex-skill.zip` | `.agents/skills/claude-code-bridge/` | `~/.agents/skills/claude-code-bridge/` |
| `claude-skill.zip` | `.claude/skills/codex-app-bridge/` | `~/.claude/skills/codex-app-bridge/` |

确认对应文件夹里看得到 `SKILL.md`。打开项目，新建会话，在 Codex 输入 `$claude-code-bridge`，或在 Claude Code 输入 `/codex-app-bridge`，再告诉它你想让另一个 Agent 做什么。

在 macOS 或 Linux 上使用，准备 Python 3.10+，并登录本地 Codex CLI 和 Claude Code。Skill 会在调用时启动对方的 CLI。[Codex 技能目录](https://learn.chatgpt.com/docs/build-skills) · [Claude Code 技能目录](https://code.claude.com/docs/en/skills)

## 可选的桌面自启动

平时使用 CLI 联调，按上面的步骤安装即可。想在登录 Mac 时打开桌面 App，可以在「系统设置 → 通用 → 登录项与扩展」里添加它。[Apple 登录项说明](https://support.apple.com/guide/mac-help/open-items-automatically-when-you-log-in-mh15189/mac)

如果你在用 [Claude → Codex 桌面联动](../claude/skills/codex-app-bridge/desktop.md)，启动时需要本机调试端口。没有启动程序时，可以在 Automator 新建「应用程序」，加一项「运行 Shell 脚本」，填入下面这条命令，保存后把这个 Automator 应用添加到登录项。第一次试启动前，请先保存草稿并退出正在运行的 Codex 桌面 App。

```sh
/usr/bin/open -b com.openai.codex --args --remote-debugging-address=127.0.0.1 --remote-debugging-port=9229
```

## 升级或移除

升级时用新版文件夹替换对应 Skill，保留你自己的改动。移除时删除对应文件夹，再开一个新会话。
