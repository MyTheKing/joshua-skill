import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, relative, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CdpClient } from './lib/cdp.mjs';
import { BridgeError, ERR } from './lib/errors.mjs';
import { listProjects, readGlobalState } from './lib/globalState.mjs';
import { withUiLock } from './lib/lock.mjs';
import { serve } from './lib/mcp-stdio.mjs';
import { findSessionFile, listSessionFiles, parseTurn, threadIdFromFilename } from './lib/sessions.mjs';
import { isTurnRunning, newConversationInProject, openThread, typeAndSend } from './lib/ui.mjs';

if (process.platform !== 'darwin') throw new Error('The desktop bridge requires macOS. Use the CLI workflow on other platforms.');
const projectPath = process.env.CODEX_BRIDGE_PROJECT_ROOT || process.env.CLAUDE_PROJECT_DIR;
if (!projectPath || !isAbsolute(projectPath)) throw new Error('Set CODEX_BRIDGE_PROJECT_ROOT to the project directory.');
const projectRoot = realpathSync(projectPath);
if (!statSync(projectRoot).isDirectory()) throw new Error('The project root must be a directory.');
const DEPTH = 'CODEX_CLAUDE_DELEGATION_DEPTH';
const ownThreads = new Map();

const string = { type: 'string' };
const tools = [
  tool('codex_new', 'Send one task in a fresh Codex desktop session for the current project.', { message: string }, ['message']),
  tool('codex_send', 'Follow up in a desktop session created by this MCP process.', { message: string, threadId: string }, ['message', 'threadId']),
  tool('codex_threads', 'List desktop sessions created by this MCP process.', {}),
  tool('codex_result', 'Read the most recent delegated desktop turn.', { threadId: string, waitSeconds: { type: 'number' } }, ['threadId']),
];

function tool(name, description, properties, required = []) {
  return { name, description, inputSchema: { type: 'object', properties, required } };
}

function currentProject() {
  const projects = listProjects(readGlobalState());
  const matches = projects.filter((project) => project.rootPaths.some((path) => {
    try { return realpathSync(path) === projectRoot; } catch { return false; }
  }));
  if (matches.length !== 1 || projects.filter((project) => project.name === matches[0]?.name).length !== 1) {
    throw new BridgeError(ERR.PROJECT_NOT_FOUND, 'Open the current project in Codex desktop with a unique project name.');
  }
  return matches[0];
}

function owned(threadId) {
  const thread = ownThreads.get(threadId);
  if (!thread) throw new BridgeError(ERR.THREAD_NOT_FOUND, 'This MCP process did not create that session.');
  return thread;
}

function delegation(message) {
  if (typeof message !== 'string' || !message.trim() || message.length > 100000) {
    throw new BridgeError(ERR.INVALID_ARGS, 'message must contain 1–100000 characters.');
  }
  const marker = `[claude-code-handoff ${randomUUID()}]`;
  const text = [
    marker,
    'This is a delegated task from Claude Code. Stay in the current project and within the task scope.',
    'Do not invoke Codex, Claude Code, or another agent runner. Do not access credentials or unrelated private data.',
    'Do not commit, push, or publish. Report results to Claude.',
    '', 'Task:', message,
  ].join('\n');
  return { marker, text };
}

async function withDesktop(action) {
  return withUiLock(async () => {
    const cdp = await CdpClient.connect();
    try { return await action(cdp); } finally { cdp.close(); }
  });
}

async function sendIdle(cdp, text) {
  if ((await isTurnRunning(cdp)).running) {
    throw new BridgeError(ERR.TURN_RUNNING, 'The session is busy or its composer could not be verified.');
  }
  await typeAndSend(cdp, text);
}

function readTurn(path, marker) {
  // Bound heap use for unexpected desktop logs. A fresh session is the recovery path.
  if (statSync(path).size > 32 * 1024 * 1024) throw new Error('The desktop session log exceeds 32 MiB. Start a fresh session.');
  return parseTurn(readFileSync(path, 'utf8'), marker);
}

async function createThread(message) {
  const { marker, text } = delegation(message);
  return withDesktop(async (cdp) => {
    const project = currentProject();
    const before = new Set(listSessionFiles());
    await newConversationInProject(cdp, project.name);
    await sendIdle(cdp, text);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      for (const path of listSessionFiles()) {
        const threadId = threadIdFromFilename(basename(path));
        if (before.has(path) || !threadId || !readTurn(path, marker).found) continue;
        ownThreads.set(threadId, { marker, projectId: project.id });
        return { threadId };
      }
      await sleep(500);
    }
    return { threadId: null, warning: 'The message was sent, but its session could not be identified. Check Codex desktop before retrying.' };
  });
}

async function followUp(threadId, message) {
  const thread = owned(threadId);
  const { marker, text } = delegation(message);
  return withDesktop(async (cdp) => {
    const project = currentProject();
    if (thread.projectId !== project.id) throw new BridgeError(ERR.PROJECT_NOT_FOUND, 'The original project has changed.');
    if (readTurn(findSessionFile(undefined, threadId), thread.marker).status === 'running') {
      throw new BridgeError(ERR.TURN_RUNNING, 'The previous delegated turn is running.');
    }
    await openThread(cdp, threadId, thread.projectId);
    await sendIdle(cdp, text);
    thread.marker = marker;
    return { threadId };
  });
}

function encodeImage(link) {
  try {
    if (!isAbsolute(link)) return null;
    const path = realpathSync(link);
    const fromRoot = relative(projectRoot, path);
    if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return null;
    const extension = /\.(png|jpe?g|gif|webp)$/i.exec(path)?.[1].toLowerCase();
    if (!extension) return null;
    const file = statSync(path);
    if (!file.isFile() || file.size > 2 * 1024 * 1024) return null;
    const mimeType = `image/${extension === 'jpg' ? 'jpeg' : extension}`;
    return { type: 'image', mimeType, data: readFileSync(path).toString('base64') };
  } catch {
    return null;
  }
}

async function result(threadId, waitSeconds) {
  const { marker } = owned(threadId);
  const path = findSessionFile(undefined, threadId);
  const wait = typeof waitSeconds === 'number' && Number.isFinite(waitSeconds) ? waitSeconds : 0;
  const deadline = Date.now() + Math.min(Math.max(wait, 0), 30) * 1000;
  let turn = readTurn(path, marker);
  while (turn.status === 'running' && Date.now() < deadline) {
    await sleep(Math.min(1000, Math.max(0, deadline - Date.now())));
    turn = readTurn(path, marker);
  }
  const content = asText({ threadId, status: turn.status, answer: turn.answer });
  if (turn.status === 'completed') {
    const links = new Set(Array.from(turn.answer.matchAll(/!\[[^\]\n]*\]\(([^)\n]+)\)/g), (match) => match[1]));
    for (const link of links) {
      const block = encodeImage(link);
      if (block) content.push(block);
      if (content.length === 4) break;
    }
  }
  return content;
}

function asText(data) {
  return [{ type: 'text', text: JSON.stringify(data) }];
}

async function callTool(name, args) {
  try {
    if (!['', '0'].includes(process.env[DEPTH] ?? '0')) {
      throw new BridgeError(ERR.INVALID_ARGS, 'Recursive Codex/Claude delegation is disabled.');
    }
    switch (name) {
      case 'codex_new': return { content: asText(await createThread(args.message)) };
      case 'codex_send': return { content: asText(await followUp(args.threadId, args.message)) };
      case 'codex_threads': return { content: asText({ threads: Array.from(ownThreads.keys()) }) };
      case 'codex_result': return { content: await result(args.threadId, args.waitSeconds) };
      default: throw new BridgeError(ERR.UNKNOWN_TOOL, 'Unknown tool.');
    }
  } catch (error) {
    const code = error instanceof BridgeError ? error.code : ERR.INTERNAL;
    return { isError: true, content: asText({ code, message: error.message }) };
  }
}

await serve({ name: 'codex-app-bridge', version: '0.1.0', tools, callTool });
