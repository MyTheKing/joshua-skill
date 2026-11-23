import { readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { BridgeError, ERR } from './errors.mjs';

/** Codex 把每个会话的完整过程写在这里，一行一个 JSON 事件 */
export const DEFAULT_SESSIONS_DIR = join(homedir(), '.codex', 'sessions');

/** 文件名形如 rollout-<时间戳>-<uuid>.jsonl，尾部 uuid 就是 threadId */
const ROLLOUT_RE = /^rollout-.*?-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

export function threadIdFromFilename(name) {
  const m = ROLLOUT_RE.exec(name);
  return m ? m[1] : null;
}

/** sessions 目录按 年/月/日 三级分层 */
function dayDir(baseDir, date) {
  const y = String(date.getFullYear());
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return join(baseDir, y, mo, d);
}

/** 列出某一天的会话文件，按修改时间倒序（最新在前） */
export function listSessionFiles(baseDir = DEFAULT_SESSIONS_DIR, date = new Date()) {
  const dir = dayDir(baseDir, date);
  if (!existsSync(dir)) return [];
  // 先一次性把 mtime 快照下来再排序（装饰-排序-还原）。快照是必需的：
  // 这个目录正被活着的 Codex App 并发写入——比较器里现 stat 有两个真实后果：
  // 1) 文件在 readdir 之后被删掉，statSync 抛出的裸 ENOENT 会逃出去，绕过本模块的
  //    BridgeError 错误契约；2) Codex 正往今天的 rollout 追加内容，mtime 排序中途变化
  //    会排出乱序。顺带把 O(n log n) 次 stat 降成 O(n) 次。
  return readdirSync(dir)
    .filter((n) => threadIdFromFilename(n))
    .map((n) => {
      const path = join(dir, n);
      let mtime;
      try { mtime = statSync(path).mtimeMs; } catch { mtime = 0; } // 已消失的条目按最旧处理，排到末尾
      return { path, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .map((entry) => entry.path);
}

/**
 * 按 threadId 找会话文件。会话可能是前几天建的，所以从今天往回翻。
 * lookbackDays 默认 30 天，够覆盖侧栏里能点到的绝大多数历史会话。
 */
export function findSessionFile(baseDir = DEFAULT_SESSIONS_DIR, threadId, lookbackDays = 30) {
  // 基准「今天」在循环外取一次：循环里现取的话，跨午夜时前后两次迭代的基准日不同，
  // 会重复扫某一天、同时整整漏掉另一天。
  const today = new Date();
  for (let i = 0; i < lookbackDays; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    for (const f of listSessionFiles(baseDir, d)) {
      if (threadIdFromFilename(basename(f)) === threadId) return f;
    }
  }
  throw new BridgeError(ERR.THREAD_NOT_FOUND, `找不到会话 ${threadId} 的记录文件`, { lookbackDays });
}

export function parseTurn(text, marker) {
  let found = false;
  let answer = '';

  for (const line of text.split('\n')) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const payload = row?.payload;
    if (!payload) continue;
    if (payload.type === 'user_message') {
      if (found) return { found, status: 'interrupted', answer };
      found = String(payload.message ?? '').startsWith(marker + '\n');
    }
    if (!found) continue;
    if (payload.type === 'agent_message' && payload.phase === 'final_answer') answer = String(payload.message ?? '');
    if (payload.type === 'turn_aborted') return { found, status: 'cancelled', answer };
    if (payload.type === 'task_complete') return { found, status: 'completed', answer: answer || String(payload.last_agent_message ?? '') };
  }
  return { found, status: 'running', answer };
}
