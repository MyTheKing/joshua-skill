import { BridgeError, ERR } from './errors.mjs';

/**
 * Codex 桌面 App 的本地 CDP 端口。CODEX_DEBUG_PORT 必须与现有 CDP 监听端口一致。
 */
function envPort() {
  const n = Number(process.env.CODEX_DEBUG_PORT);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 9229;
}
export const CDP_PORT = envPort();

/** Codex 主界面的页面地址；带 initialRoute 的是头像浮层等附属窗口，要排除 */
const MAIN_URL_PREFIX = 'app://-/index.html';

/** 从 /json/list 结果里挑出 Codex 主界面。纯函数，便于单测。 */
export function pickTarget(list) {
  const hit = (list || []).find(
    (t) => t?.type === 'page'
      && String(t.url || '').split('?')[0] === MAIN_URL_PREFIX
      && !String(t.url || '').includes('initialRoute'),
  );
  if (!hit) {
    throw new BridgeError(
      ERR.NO_TARGET,
      '连上了调试端口，但找不到 Codex 主界面窗口',
    );
  }
  return hit;
}

export function loopbackDebuggerUrl(value, port) {
  const endpoint = new URL(value);
  if (endpoint.protocol !== 'ws:' || endpoint.username || endpoint.password
      || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
      || Number(endpoint.port || '80') !== port || !endpoint.pathname.startsWith('/devtools/page/')) {
    throw new BridgeError(ERR.NO_SERVICE, '拒绝非本地或与已配置端口不符的调试地址。');
  }
  return endpoint;
}

/** 单次 CDP 调用的等待上限。Codex 界面卡住时宁可报错，也不能把 MCP 调用挂死。 */
export const CDP_TIMEOUT_MS = 15000;

/** 一条到 Codex 界面的 CDP 连接 */
export class CdpClient {
  #ws;
  #id = 0;
  // id → { resolve, reject, timer, method }：在途请求登记表，断线/超时时要能全部弹掉
  #pending = new Map();
  // 连接是否已死（断线或主动关闭）。WebSocket.send() 在 CLOSING/CLOSED 下是静默丢弃，
  // 不抛错也不报 error，没这个标记就只能等超时才发现连接早没了。
  #dead = false;

  constructor(ws) {
    this.#ws = ws;
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        // 丢弃而不是抛：这里是 WebSocket 回调，没有上层调用栈能接住，抛出去就是
        // uncaughtException，整个 MCP 服务进程陪葬。坏帧顶多让对应请求走超时。
        return;
      }
      // msg?. 不能省：JSON.parse('null') 是合法的，裸 msg.id 会在这个回调里抛 TypeError，
      // 又绕回 uncaughtException——上面 try/catch 防的就是这类整进程陪葬。
      const p = this.#pending.get(msg?.id);
      if (!p) return; // 事件通知（无 id）与超时后迟到的回包都落在这里，直接丢弃
      this.#pending.delete(msg.id);
      clearTimeout(p.timer);
      // 协议级错误（方法名写错、参数非法）落在 msg.error 里，不进 result。
      // 不 reject 的话上层只会拿到 undefined，错得无声无息。
      if (msg.error) {
        p.reject(new BridgeError(ERR.INTERNAL, `CDP 调用失败：${msg.error.message}`, {
          method: p.method, cdpCode: msg.error.code,
        }));
      } else {
        p.resolve(msg);
      }
    };
    // App 被关掉 / 界面窗口销毁时，在途请求必须立刻失败，否则 MCP 调用永远不返回
    ws.onclose = () => this.#failAllPending('Codex 界面的 CDP 连接已断开');
  }

  /** 把所有在途请求以同一个原因弹掉（断线、主动关闭），并把连接标记为已死 */
  #failAllPending(reason) {
    this.#dead = true;
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(new BridgeError(ERR.NO_SERVICE, reason, { method: p.method }));
    }
    this.#pending.clear();
  }

  /** 探测调试端口、挑出主界面 target、握上 WebSocket，成功才返回可用的连接 */
  static async connect(port = CDP_PORT) {
    let list;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(3000),
        redirect: 'error',
      });
      list = await res.json();
      // 9229 也是 Node --inspect 的默认端口，端口通不代表对面就是 Codex。真 inspector
      // 会返回合法数组（后面降级成 NO_TARGET），但别的服务可能返回任意 JSON——不校验的话
      // pickTarget 里的 list.find 会抛裸 TypeError，破坏本模块「只抛 BridgeError」的契约。
      if (!Array.isArray(list)) throw new Error(`/json/list 返回的不是数组：${typeof list}`);
    } catch (cause) {
      // 端口不通就是找不到服务：不自动拉起 App、不自动开调试端口（规格 §7）
      throw new BridgeError(
        ERR.NO_SERVICE,
        `找不到 Codex 服务（127.0.0.1:${port} 连不上）。请确认 Codex 桌面 App 正在运行。`,
        { port, cause: String(cause) },
      );
    }
    const target = pickTarget(list);
    const ws = new WebSocket(loopbackDebuggerUrl(target.webSocketDebuggerUrl, port));
    // 握手也要有上限：既不 open 也不 error 的半死连接会把 connect 挂住
    await new Promise((resolve, reject) => {
      // 两条失败路径都必须先 close 再 reject：抛出去之后没人再持有这个 ws，
      // 不关的话 libuv handle 一直活着（进程退不干净），而且超时后它要是才真的 open，
      // 就留下一条永远没人管、还连着 Codex App 的活连接。
      const timer = setTimeout(() => {
        ws.close();
        reject(new BridgeError(ERR.NO_SERVICE, 'CDP WebSocket 握手超时', { target: target.url }));
      }, 5000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      // 握手成功后这个 onerror 仍挂着，那之后它只剩 ws.close() 一件实事：对已 settle 的
      // Promise 调 reject 是空操作，所以连接期之后的 error 不会向上报，但强制 close 会引出
      // onclose → #failAllPending，把连接标记为死。别删这行，否则「error 而非 close 断的连接」
      // 就没人收尾了。
      ws.onerror = () => {
        clearTimeout(timer);
        ws.close();
        reject(new BridgeError(ERR.NO_SERVICE, 'CDP WebSocket 连接失败', { target: target.url }));
      };
    });
    return new CdpClient(ws);
  }

  /** 发一条 CDP 命令，resolve 的是整条回包（含 result 字段） */
  send(method, params = {}, { timeoutMs = CDP_TIMEOUT_MS } = {}) {
    // 连接已死就别再发了：帧会被静默丢弃，登记 pending 只会白等满 timeoutMs，
    // 还把「App 被关了」误报成超时。对长活的 MCP 进程来说这是常态，必须立刻失败。
    if (this.#dead) {
      return Promise.reject(new BridgeError(ERR.NO_SERVICE, `CDP 连接已断开，无法调用 ${method}`, { method }));
    }
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new BridgeError(ERR.INTERNAL, `CDP 调用超时（${timeoutMs}ms）：${method}`, { method, timeoutMs }));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer, method });
      try {
        this.#ws.send(JSON.stringify({ id, method, params }));
      } catch (cause) {
        // socket 还在 CONNECTING 时 send() 会抛 InvalidStateError。不接住的话，
        // 既会以裸 DOMException reject，那条 pending 和它的活定时器还要白留满 timeoutMs。
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(new BridgeError(ERR.NO_SERVICE, `CDP 帧发送失败：${method}`, { method, cause: String(cause) }));
      }
    });
  }

  /** 在页面上下文求值。页内抛异常时转成 BridgeError，避免静默拿到 undefined。 */
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    const ex = r.result?.exceptionDetails;
    if (ex) throw new BridgeError(ERR.ELEMENT_NOT_FOUND, `页内求值失败：${ex.text}`, { expression });
    return r.result?.result?.value;
  }

  /** 输入框是 ProseMirror，必须用 Input.insertText 触发真实输入事件，直接改 DOM 不生效 */
  async insertText(text) {
    await this.send('Input.insertText', { text });
  }

  close() {
    this.#failAllPending('CDP 连接已主动关闭');
    this.#ws.close();
  }
}
