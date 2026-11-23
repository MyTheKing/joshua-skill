# 双向联动用法

**简体中文** · [English](usage.en.md)

[返回目录](../README.md#目录) · [安装](install.md) · [常见问题](troubleshooting.md)

## Codex → Claude Code

```text
$claude-code-bridge 让 Claude 审查 src/parser.py，只报告带行号的边界问题。
```

Claude 在后台启动。Codex 可以按项目查询会话，用 `threadId` 获取进度、续跑或请求停止。续跑沿用原会话权限。发起端的会话保持运行时才能主动跟进结果。

默认 `review` 模式允许读取和搜索。用 `plan` 请求方案。需要改文件时，明确授权 `edit` 并给出允许修改的范围。Codex 会核对接收端结果及实际 diff。

### 可选的 Codex MCP 注册

ZIP 自带命令行入口。如果希望技能直接使用 `claude_new`、`claude_result` 等 MCP 工具，可在项目根目录执行下列命令，然后重新打开 Codex。此方式会增加一条**用户级** MCP 配置，项目移动时需要更新路径。

```sh
codex mcp add my-skill-claude -- python3 "$PWD/.agents/skills/claude-code-bridge/scripts/server.py"
```

移除配置时执行 `codex mcp remove my-skill-claude`。同名服务已存在时，先检查它指向的路径。

## Claude Code → Codex

```text
/codex-app-bridge 让 Codex 复核 src/parser.py 的异常处理，给出文件位置和复现条件。
```

默认调用本地 Codex CLI。接收端在指定项目里生成第二意见，Claude Code 汇报结果并独立核对。要委派改动，请给出明确文件范围和验收命令。

### 可选的 macOS 桌面联动

需要 Codex 桌面功能时，可按[桌面联动配置](../claude/skills/codex-app-bridge/desktop.md)连接已经启用的本机调试端口。桌面模式支持创建会话、跟进结果、继续任务，并可回传任务项目内的图片。CLI 模式适用于常规代码任务。

## 如何写委派任务

给接收端最小必要上下文，说明目标、项目目录、可读写范围和验收标准。两个包都限制继续调用对端，避免任务在两边循环转发。委派会使用接收端账户和额度。项目内容和提示词仍通过所用的模型服务处理。
