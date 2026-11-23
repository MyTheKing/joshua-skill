/**
 * 极简 MCP stdio 传输层：换行分隔的 JSON-RPC 2.0。
 *
 * 为什么不用 @modelcontextprotocol/sdk：整个包要做到零依赖，收件人解压即用，
 * 无需安装 npm 依赖。实际用到的协议面只有
 * initialize / tools/list / tools/call 三个方法，自己写比拖一整棵依赖树划算。
 */

/** 本服务端默认宣称的协议版本（客户端没给或给了不认识的版本时用这个）。 */
export const PROTOCOL_VERSION = '2025-06-18';

/** 认识的协议版本；客户端报的版本在表里就回显，保证向下兼容老客户端。 */
const KNOWN_PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);

/**
 * 把 stdin 收到的字节流切成一条条 JSON 消息。
 * stdin 是流，一次 data 事件可能只给半行、也可能一次给好几行，
 * 所以未消费完的尾巴要作为 rest 交回调用方，下次拼在前面。
 */
export function parseFrames(pending, chunk) {
  const buf = pending + chunk;
  const lines = buf.split('\n');
  const rest = lines.pop() ?? '';          // 最后一段没有换行结尾 = 还没收全
  const frames = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;                      // 空行直接跳过，不算解析错误
    try {
      frames.push(JSON.parse(s));
    } catch {
      frames.push({ __parseError: true, raw: s });
    }
  }
  return { frames, rest };
}

/** JSON-RPC 成功响应。 */
const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
/** JSON-RPC 错误响应。 */
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/**
 * 处理单条消息，返回要写回去的响应；通知（没有 id）返回 null。
 * ctx = { name, version, tools, callTool }
 */
export async function handleMessage(msg, ctx) {
  if (msg?.__parseError) return fail(null, -32700, 'JSON 解析失败');

  const { id, method, params } = msg ?? {};
  if (id === undefined || id === null) return null;

  switch (method) {
    case 'initialize': {
      const want = params?.protocolVersion;
      return ok(id, {
        protocolVersion: KNOWN_PROTOCOL_VERSIONS.has(want) ? want : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: ctx.name, version: ctx.version },
      });
    }
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: ctx.tools });
    case 'tools/call': {
      // 工具执行失败属于「业务失败」，要走 isError 让模型看得见，
      // 不能变成 JSON-RPC error——那会被客户端当成协议故障。
      try {
        return ok(id, await ctx.callTool(params?.name, params?.arguments ?? {}));
      } catch (err) {
        return ok(id, { content: [{ type: 'text', text: String(err?.message ?? err) }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `未知方法：${method}`);
  }
}

/**
 * 接上 stdin/stdout 跑起来。
 * 注意：stdout 是协议通道，**只能写 JSON-RPC 帧**，任何日志都必须走 stderr，
 * 否则会污染帧流让客户端解析失败。
 */
export async function serve({
  name, version, tools, callTool,
  input = process.stdin, output = process.stdout,
}) {
  const ctx = { name, version, tools, callTool };
  let pending = '';
  input.setEncoding('utf8');

  for await (const chunk of input) {
    const { frames, rest } = parseFrames(pending, chunk);
    pending = rest;
    for (const frame of frames) {
      const res = await handleMessage(frame, ctx);
      if (res) output.write(JSON.stringify(res) + '\n');
    }
  }
}
