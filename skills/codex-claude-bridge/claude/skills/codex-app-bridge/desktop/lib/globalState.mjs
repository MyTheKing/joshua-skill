import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Codex 桌面 App 的全局状态文件，项目清单与会话归属都在里面 */
export const DEFAULT_STATE_PATH = join(homedir(), '.codex', '.codex-global-state.json');

/**
 * 同一层的值既吃对象也吃 JSON 字符串，统一在这里抹平；解析失败返回 null 而不是抛错。
 * 注意这是**防御，不是已观测事实**：初稿写过「同一层有的是字符串有的是对象」，
 * 2026-08-07 复查未能复现——`local-projects` 与 `thread-project-assignments` 全是对象
 * （规格 §6.5 已按这个口径改过）。两种都吃只是为了 App 换写法时不炸。
 */
function maybeParse(v) {
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string') return null;
  try { return JSON.parse(v); } catch { return null; }
}

/** 读并解析全局状态。文件约 600KB，整份 parse 无妨，但别把整份回传给客户端。 */
export function readGlobalState(path = DEFAULT_STATE_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * 项目清单：id / 名字 / 根目录。
 * id 有两种格式（老项目是裸 uuid，新项目是 local-<hex>），属历史遗留；
 * 它与界面 DOM 上的 data-app-action-sidebar-project-id 同源，原样保留、不做任何转换。
 */
export function listProjects(state) {
  const raw = state['local-projects'] || {};
  const out = [];
  for (const [id, v] of Object.entries(raw)) {
    const p = maybeParse(v);
    if (!p) continue;
    out.push({ id: p.id || id, name: p.name || '', rootPaths: p.rootPaths || [] });
  }
  return out;
}
