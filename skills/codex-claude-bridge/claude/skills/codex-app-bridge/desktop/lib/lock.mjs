/**
 * 跨进程的界面互斥锁 · cross-process UI mutex
 *
 * 为什么需要：每个 Claude 窗口都会拉起一个**独立的** MCP server 进程，而它们共用同一个
 * Codex 桌面 App 的界面——只有一个侧栏、一个输入框。两个进程同时「切会话 → 打字 → 发送」，
 * 字就会落进别人的会话里。所以这段几秒钟的界面操作必须全局串行。
 *
 * 锁文件放 os.tmpdir()（macOS 上是每用户私有的 /var/folders/.../T/），粒度正好是
 * 「这个用户的那一个 Codex 界面」——同机不同用户各锁各的，互不干扰。
 */
import { openSync, closeSync, writeSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** 锁文件路径：一个用户一个界面，所以固定单文件。导出仅供单测清场用 */
export const LOCK_PATH = join(tmpdir(), 'codex-app-bridge-ui.lock');

/** 等锁最多多久。界面操作本身只要几秒，60s 足够排在两三个窗口后面 */
const DEFAULT_WAIT_MS = 60_000;
/** 抢锁失败后的重试间隔 */
const POLL_MS = 150;
/** 锁存在多久算陈旧：持有者崩溃、没来得及删锁时靠它兜底解围 */
const STALE_MS = 120_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 进程还活着吗——signal 0 只做存在性探测，不真的发信号 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 原子地抢一次锁：抢到返回 true，已被别人占着返回 false */
function tryAcquire() {
  let fd;
  try {
    fd = openSync(LOCK_PATH, 'wx'); // wx = 文件已存在就失败；这一步由内核保证原子
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    return false;
  }
  try {
    writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
  } finally {
    closeSync(fd);
  }
  return true;
}

/** 锁的持有者已经死了或超期就把锁清掉；清掉了返回 true */
function clearIfStale() {
  let info = null;
  try {
    info = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
  } catch {
    // 读不出来或内容坏掉（写到一半被杀），一律按陈旧处理
  }
  const stale = !info
    || !Number.isFinite(info.at) || Date.now() - info.at > STALE_MS
    || !Number.isInteger(info.pid) || !isAlive(info.pid);
  if (!stale) return false;
  try {
    unlinkSync(LOCK_PATH);
    return true;
  } catch {
    return false; // 别人抢先删了，下一轮 tryAcquire 自然会拿到
  }
}

/**
 * 拿到界面锁后执行 fn，无论成败都释放。
 * 等不到锁就抛 onTimeout() 返回的错误——错误语义由调用方决定，本模块不绑定 BridgeError。
 */
export async function withUiLock(fn, { waitMs = DEFAULT_WAIT_MS, onTimeout } = {}) {
  const deadline = Date.now() + waitMs;
  let held = tryAcquire();
  while (!held) {
    if (Date.now() >= deadline) break;
    clearIfStale(); // 死进程留下的锁不该让后来者干等到超时
    await sleep(POLL_MS);
    held = tryAcquire();
  }
  if (!held) {
    throw onTimeout ? onTimeout() : new Error(`等待 Codex 界面锁超时（${waitMs}ms）`);
  }
  try {
    return await fn();
  } finally {
    // 只删自己的锁：万一自己这把被当成陈旧锁清掉、又被别人抢走，不能顺手误删别人的
    try {
      const info = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
      if (info?.pid === process.pid) unlinkSync(LOCK_PATH);
    } catch {
      // 锁文件已经不在了，没什么可做的
    }
  }
}
