/**
 * 统一错误类型。code 是机器可读的短标识，供 MCP 客户端分支处理；
 * message 是给人看的中文说明；details 放定位用的上下文（如可选项目列表）。
 */
export class BridgeError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

/** 错误码常量，对应规格 §7 的错误处理表 */
export const ERR = {
  NO_SERVICE: 'NO_SERVICE',               // 9229 端口连不上
  NO_TARGET: 'NO_TARGET',                 // 端口通但找不到 Codex 界面 target
  ELEMENT_NOT_FOUND: 'ELEMENT_NOT_FOUND', // 界面上找不到按钮/输入框/会话行（多半是 App 改版）
  TURN_RUNNING: 'TURN_RUNNING',           // 有任务正在跑，不抢占
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND', // project 参数在项目清单里不存在
  THREAD_NOT_FOUND: 'THREAD_NOT_FOUND',   // 给定 threadId 找不到对应 rollout 文件
  UNKNOWN_TOOL: 'UNKNOWN_TOOL',           // MCP 客户端调了没注册的工具
  // 必填参数没传/不是非空字符串。刻意不复用 INTERNAL：INTERNAL 是「未预期的异常」，
  // 而少传一个必填参数是完全可预期的调用方错误，混在一起客户端就没法分支处理了。
  INVALID_ARGS: 'INVALID_ARGS',
  INTERNAL: 'INTERNAL',                   // 兜底：未预期的异常
};
