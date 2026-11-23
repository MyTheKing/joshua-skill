import { readFileSync } from 'node:fs';
import { BridgeError, ERR } from './errors.mjs';

const LABELS = JSON.parse(readFileSync(new URL('./labels.json', import.meta.url), 'utf8'));

const LABEL = {
  send: LABELS.send,
  stop: LABELS.stop,
  /** 把模板里的 {folder} / {connection} 占位符换成真实项目名，得到该项目「新建聊天」按钮的候选 */
  newInProject: (name) => [
    ...new Set(LABELS.newInProject.map((t) => t.split('{folder}').join(name).split('{connection}').join(name))),
  ],
  /** 项目下那个「展开显示」按钮的文案候选。它既没有 data-* 钩子也没有 aria-label，只能认可见文本 */
  showMore: LABELS.showMore,
};

/** 诊断用的候选 aria-label 条数上限：几十条足够认出改版，再多只会把错误信息刷爆 */
const MAX_CANDIDATE_LABELS = 40;

/**
 * 「展开显示」最多点几次。侧栏对每个项目默认只渲染最近 5 条会话，点一次增量放出约 10 条，
 * 点满 8 次能翻到 80 条开外——比 rollout 的 30 天回看窗口能覆盖的会话数还深，够用了。
 * 有上限是为了防死循环：万一按钮点不动（改版、被浮层挡住），不能在这儿一直转。
 */
const MAX_SHOW_MORE_CLICKS = 8;

/** 等一小会儿，给界面渲染留时间 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 每步操作之后等界面渲染的时长（毫秒），都是真机量出来的经验值：
 * 点完按钮 React 要挂载新视图、侧栏展开带动画、发完消息要等会话文件落盘。
 * 导出并做成可改的对象，是为了让单测把它们清零——否则跑一趟 ui 测试要空等九秒。
 */
export const DELAY = {
  newConversation: 1500, // 等新会话视图挂载
  openThread: 1200, // 等切换/展开之后的侧栏列表渲染
  beforeInsert: 300, // 等输入框真正拿到焦点
  afterInsert: 600, // 等 ProseMirror 消化完 insertText
  afterSend: 1500, // 等会话文件落盘，供后续 diff 出 threadId
};

/** 把字符串安全地嵌进页内 JS 表达式，避免项目名/标题里的引号打断语法 */
function jsStr(s) {
  return JSON.stringify(String(s));
}

/** 把字符串数组（aria-label 候选）安全地嵌进页内 JS 表达式 */
function jsArr(labels) {
  return JSON.stringify(labels.map(String));
}

/**
 * 取输入框元素的页内表达式片段（ProseMirror 的可编辑根）。
 * 它没有 data-* 钩子，只能认 class，但这个 class 与界面语言无关。
 * 页面可能同时存在多个 ProseMirror（快速聊天浮层、评论框、消息编辑框），
 * 第一个常常是不可见的，focus() 不上去。所以只在**可见**的里面挑，
 * 多个可见时取最宽的那个——主输入框横贯会话区，宽度必然压过侧栏小框。
 */
const COMPOSER_EXPR = `(() => {
  const boxes = [...document.querySelectorAll('.ProseMirror[role="textbox"]')]
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.height > 0);
  if (!boxes.length) return null;
  boxes.sort((a, b) => b.r.width - a.r.width);
  return boxes[0].e;
})()`;

/**
 * 生成「找输入区容器」的页内表达式，求值为一个 Element；找不到就退回 document。
 *
 * 为什么要收窄：候选表放宽到全语言后，页面别处的同名按钮更容易误中——「发送」还被
 * 评论浮层、「重发编辑过的消息」用着，「停止」还被下载浮层用着。先锁定输入框所在的
 * 容器，再在容器里找按钮，就绕开了这些同名货。
 *
 * 真机实测：从 .ProseMirror[role="textbox"] 向上第 4 层才是同时含发送/停止按钮的容器。
 * 层数会随 App 版本变，所以不写死——向上逐层找，取第一个真的含候选按钮的祖先。
 */
function composerScopeExpr(labels) {
  return `(() => {
    const want = new Set(${jsArr(labels)});
    let n = ${COMPOSER_EXPR};
    for (let i = 0; i < 8 && n; i++) {
      n = n.parentElement;
      if (!n) break;
      if ([...n.querySelectorAll('button[aria-label]')].some((b) => want.has(b.getAttribute('aria-label')))) return n;
    }
    return document;
  })()`;
}

/**
 * 生成「按 aria-label 候选列出所有可见按钮」的页内表达式片段，候选取任意一个命中即可。
 * rootExpr 是求值为容器元素的表达式片段，用来把搜索范围收窄；默认全页面找。
 * 可见性判据用 getBoundingClientRect().width > 0 而不是 offsetParent：
 * visibility:hidden / opacity:0 的按钮 offsetParent 非空却根本点不到，rect 判据两头都更准。
 */
function visibleButtonsExpr(labels, rootExpr = 'document') {
  // disabled 一并在选择器层面滤掉：置灰的按钮点了是 no-op，"存在"也不代表"能用"。
  // 两个消费者必须共用同一套「可用」定义——否则会出现 hasVisibleButton 说发送键在（判定空闲）、
  // clickButtonByLabel 却点不动的错位：turn 闸被绕过，会话已经切走了才在 typeAndSend 抛错。
  return `[...(${rootExpr}).querySelectorAll('button')]`
    + `.filter(e => ${jsArr(labels)}.includes(e.getAttribute('aria-label'))`
    + ` && e.getBoundingClientRect().width > 0 && !e.disabled)`;
}

/** 界面上有没有这些 aria-label 候选之一的可见且可用按钮（可用 rootExpr 收窄范围） */
async function hasVisibleButton(cdp, labels, rootExpr) {
  return !!(await cdp.evaluate(`(() => ${visibleButtonsExpr(labels, rootExpr)}.length > 0)()`));
}

/**
 * 点这些 aria-label 候选里第一个可见且可用的按钮，返回是否点到（可用 rootExpr 收窄范围）。
 * disabled 已由 visibleButtonsExpr 滤掉——「文本没插进去 → 发送键置灰 → 点了没反应」
 * 这条静默假发送的路径就是在那里堵死的。
 */
async function clickButtonByLabel(cdp, labels, rootExpr) {
  const r = await cdp.evaluate(`(() => {
    for (const b of ${visibleButtonsExpr(labels, rootExpr)}) {
      b.click();
      return 'clicked';
    }
    return null;
  })()`);
  return !!r;
}

/**
 * 收集页面上所有 button 的 aria-label（去重、截断），当 ELEMENT_NOT_FOUND / TURN_RUNNING
 * 的诊断线索用——规格 §7 要求「找不到按钮/输入框时附上实际找到的候选元素」。
 * 自身失败时返回空数组：诊断信息不能反过来把主错误吃掉。
 */
async function collectButtonLabels(cdp) {
  try {
    const labels = await cdp.evaluate(`(() => {
      const all = [...document.querySelectorAll('button')]
        .map(b => b.getAttribute('aria-label')).filter(Boolean);
      return [...new Set(all)].slice(0, ${MAX_CANDIDATE_LABELS});
    })()`);
    return Array.isArray(labels) ? labels : [];
  } catch {
    return [];
  }
}

/**
 * 输入框找不到时的额外诊断：页面里有几个 [role="textbox"]、它们的 class 长什么样。
 * 光有按钮 label 列表定位不了输入框改版，class 片段才能看出选择器该怎么改。
 * 同样是失败即返回空值，不能把主错误吃掉。
 */
async function probeTextboxes(cdp) {
  try {
    const r = await cdp.evaluate(`(() => {
      const els = [...document.querySelectorAll('[role="textbox"]')];
      return {
        textboxCount: els.length,
        textboxClasses: els.slice(0, 5).map(e => String(e.className || '').slice(0, 80)),
      };
    })()`);
    return r && typeof r === 'object' ? r : { textboxCount: 0, textboxClasses: [] };
  } catch {
    return { textboxCount: 0, textboxClasses: [] };
  }
}

/**
 * 是否有任务正在跑（规格 §6.6 第 1 条）。以界面为准：turn 运行期间发送按钮会变成停止态。
 * 返回结构化结果 `{ running, reason, candidates? }` 而不是裸 boolean——「找不到发送按钮」
 * 同时承载着四种现实（真在跑 / App 改版 / locale 没注入 / 可见性判据失效），
 * 塌缩成一个 boolean 会让报错把排查方向引到完全错的地方。
 * 判定结论仍完全遵从规格：找不到发送按钮就算运行中。
 */
export async function isTurnRunning(cdp) {
  // 只在输入区容器里找：发送/停止两组候选都传进去，因为 turn 跑起来时容器里只剩停止键，
  // 光拿其中一组当锚点会在另一半场景里认不出容器、白白退回全页面搜。
  const scope = composerScopeExpr([...LABEL.send, ...LABEL.stop]);
  // 停止按钮在场是「turn 真在跑」最直接的证据（规格 §6.6 第 1 条后半句，本次补齐）
  if (await hasVisibleButton(cdp, LABEL.stop, scope)) {
    return { running: true, reason: 'stop-button-visible' };
  }
  if (await hasVisibleButton(cdp, LABEL.send, scope)) {
    return { running: false, reason: 'send-button-visible' };
  }
  // App 26.9+：输入框为空时发送键被「开始新的语音聊天」取代，灌入文字后才出现。
  // 没有停止键 + 输入框为空 = 空闲；typeAndSend 灌完文本后仍会严格校验发送键。
  const composerText = await cdp.evaluate(composerTextExpr());
  if (composerText !== null && bareText(composerText) === '') {
    return { running: false, reason: 'composer-empty-no-stop' };
  }
  // 两个都没有：仍判运行中，但把实际扫到的 aria-label 带出去——那是分辨
  // 「真在跑」与「App 改版 / 换了 locale」的唯一线索。
  return { running: true, reason: 'send-button-missing', candidates: await collectButtonLabels(cdp) };
}

/**
 * 在指定项目里新建会话。
 * 必须点项目行的专属按钮——全局「新对话」不继承选中项目，建出来的会话是无项目的，
 * cwd 会落在 ~/Documents/Codex/<日期>/<任务名> 这种草稿目录里。
 */
export async function newConversationInProject(cdp, projectName) {
  const labels = LABEL.newInProject(projectName);
  // 项目行带 data-app-action-sidebar-project-label（与语言无关），比全局扫 aria-label 稳。
  // 行内有两个按钮（「X 的项目操作」和「在 X 中开始新聊天」），靠候选表挑出后者。
  // 属性值走 JSON.stringify 转成带引号的字面量，项目名里有空格或引号也不会把选择器打断。
  const rowSelector = `[data-app-action-sidebar-project-label=${JSON.stringify(projectName)}]`;
  const rowExpr = `(document.querySelector(${jsStr(rowSelector)}) || document)`;

  // 先在项目行里找；行内没有（App 把按钮挪到了行外）再全局兜一次，两次都空才算真找不到。
  const clicked = await clickButtonByLabel(cdp, labels, rowExpr)
    || await clickButtonByLabel(cdp, labels);
  if (!clicked) {
    throw new BridgeError(
      ERR.ELEMENT_NOT_FOUND,
      `界面上找不到「${labels[0]}」按钮`,
      {
        hint: '确认目标项目在侧栏可见，且 App 版本和语言受支持。',
        candidates: await collectButtonLabels(cdp), // 规格 §7：附上实际扫到的候选
      },
    );
  }
  await sleep(DELAY.newConversation);
}

/**
 * 生成「点目标项目那个『展开显示』」的页内表达式。
 *
 * 侧栏是**扁平**结构：项目行、它的会话行、它的「展开显示」按钮是同一层的兄弟，项目行
 * 并不是按钮的祖先（真机实测两者最近的共同祖先直接是整条侧栏，包着全部 9 个按钮）。
 * 所以只能按文档顺序认领——从目标项目行往后扫，撞见**别的**项目行就停，中间第一个
 * 文案命中候选表的按钮就是它的。停止条件不可省，否则会点到下一个项目头上；扫描范围还要
 * 先收进侧栏根，否则最后一个项目没有「下一个项目行」当刹车，会一路扫进正文区。
 *
 * 求值结果：'clicked' 点到了 / 'no-button' 这个项目已全展开 / 'no-project' 项目行不在侧栏。
 */
function clickShowMoreExpr(projectId, labels) {
  return `(() => {
    const want = new Set(${jsArr(labels)});
    const ROW = '[data-app-action-sidebar-project-id]';
    const pid = (n) => n.getAttribute('data-app-action-sidebar-project-id');
    const target = [...document.querySelectorAll(ROW)].find((n) => pid(n) === ${jsStr(projectId)});
    if (!target) return 'no-project';

    // 先把范围收进侧栏：从项目行往上走，第一个「装得下全部项目行」的祖先就是侧栏列表根
    // （真机实测恒为第 5 层）。**最后一个**项目没有「下一个项目行」当刹车，不收范围就会
    // 一路扫进正文区——那儿也有同名按钮（简中是「显示更多」不撞车，别的语言未必）。
    const total = document.querySelectorAll(ROW).length;
    let root = document;
    for (let n = target; n.parentElement; ) {
      n = n.parentElement;
      if (n.querySelectorAll(ROW).length >= total) { root = n; break; }
    }

    const nodes = [...root.querySelectorAll(ROW + ', button')];
    const start = nodes.indexOf(target);
    for (let i = start + 1; i < nodes.length; i++) {
      const n = nodes[i];
      if (pid(n) && pid(n) !== ${jsStr(projectId)}) break;
      if (n.tagName === 'BUTTON' && want.has((n.textContent || '').trim())) { n.click(); return 'clicked'; }
    }
    return 'no-button';
  })()`;
}

export async function openThread(cdp, threadId, projectId = null) {
  // 用后缀匹配 ":<threadId>"，避开对 "local:" 这类 host 前缀的硬编码
  const suffixSelector = `[data-app-action-sidebar-thread-id$=${jsStr(`:${threadId}`)}]`;
  // 点一次目标会话行，行不在 DOM 里就返回 null。展开项目前后各调一次，所以做成函数。
  const clickRow = () => cdp.evaluate(`(() => {
    const e = document.querySelector(${jsStr(suffixSelector)});
    if (!e) return null;
    e.click();
    return 'clicked';
  })()`);

  /**
   * 点完并 settle 之后回读侧栏选中态，确认真的切过去了；没切过去就抛错。
   * 这是防「发错会话」的唯一闸门，必须在发消息之前过——click 没触发切换时
   * （handler 挂在内层元素、被动画遮罩吃掉等），typeAndSend 会把消息灌进当时正开着的
   * 那个会话，很可能是用户自己正在用的：额度照烧、会话被污染，而 codex_send 报成功。
   * 直接违反规格 §6.7「codex_send 只切到指定 threadId，不动用户正在看的会话」。
   */
  const confirmSelected = async () => {
    const sel = await cdp.evaluate(`(() => {
      const target = document.querySelector(${jsStr(suffixSelector)});
      const cur = document.querySelector('[data-app-action-sidebar-thread-selected="true"]');
      return {
        selected: target ? target.getAttribute('data-app-action-sidebar-thread-selected') === 'true' : false,
        current: ((cur && cur.getAttribute('data-app-action-sidebar-thread-id')) || '').split(':').pop() || null,
      };
    })()`);
    if (sel?.selected) return;
    throw new BridgeError(
      ERR.ELEMENT_NOT_FOUND,
      `点了会话 ${threadId} 的侧栏行，但它没有变成选中态——切换没生效，消息未发送。`,
      {
        threadId,
        projectId,
        currentSelected: sel?.current ?? null,
        hint: '多半是 App 改版（选中态属性改名/点击 handler 挪到了内层元素），或点击被浮层挡住了。',
      },
    );
  };

  if (await clickRow()) { await sleep(DELAY.openThread); await confirmSelected(); return; }

  if (projectId) {
    // 目标会话所属的项目行；点它是为了展开折叠的分组，把会话行渲染出来。
    // 但它是 toggle 不是「展开」：项目本来就展开、只是目标会话没渲染时，再点一下会把它
    // **收起来**——读失败还顺手弄乱了用户的侧栏。所以先读展开态，已展开就别点。
    // aria-expanded 未经真机验证；读不到该属性时按「没展开」处理，维持改动前的行为。
    const projectSelector = `[data-app-action-sidebar-project-id=${jsStr(projectId)}]`;
    const r = await cdp.evaluate(`(() => {
      const e = document.querySelector(${jsStr(projectSelector)});
      if (!e) return 'missing';
      if (e.getAttribute('aria-expanded') === 'true') return 'already-expanded';
      e.click();
      return 'expanded';
    })()`);
    if (r === 'expanded') await sleep(DELAY.openThread); // 只有真点了才等展开动画与列表渲染
    if (await clickRow()) { await sleep(DELAY.openThread); await confirmSelected(); return; }

    // 项目展开了也未必够：侧栏对每个项目只渲染最近 5 条会话，其余折在「展开显示」后面，
    // DOM 里压根没有。多窗口并发派活时，先派的那条很快被新会话挤下去——切不过去就等于
    // 那条线断了（正是「其他任务收不到回应」的成因）。展开是**增量**的（一次多放约 10 条），
    // 所以要一直点到目标出现、或按钮消失（已全展开）为止。
    for (let i = 0; i < MAX_SHOW_MORE_CLICKS; i += 1) {
      const more = await cdp.evaluate(clickShowMoreExpr(projectId, LABEL.showMore));
      if (more !== 'clicked') break; // no-button = 已全展开；no-project = 项目行都不在侧栏
      await sleep(DELAY.openThread);
      if (await clickRow()) { await sleep(DELAY.openThread); await confirmSelected(); return; }
    }
  }

  throw new BridgeError(
    ERR.ELEMENT_NOT_FOUND,
    `侧栏里找不到会话 ${threadId}`,
    {
      threadId,
      projectId,
      hint: projectId
        ? '已展开该项目并点满「展开显示」仍未渲染出这条会话，多半是它太旧、超出侧栏保留范围。'
        : '不知道会话属于哪个项目，没法展开对应分组；侧栏只渲染每个项目最近几条会话。',
    },
  );
}

/** 生成「读输入框当前文本」的页内表达式；输入框不在时求值为 null */
function composerTextExpr() {
  return `(() => { const e = ${COMPOSER_EXPR}; return e ? (e.textContent || '') : null; })()`;
}

/**
 * 去掉全部空白后再比。ProseMirror 把换行拆成一串 `<p>`，`textContent` 读不回换行
 * （实测多行任务书回读少了 `\n`），逐字符相等会把每一条多行消息都误判成脏数据。
 */
const bareText = (s) => String(s ?? '').replace(/\s+/g, '');

export async function typeAndSend(cdp, text) {
  // 焦点必须回读 document.activeElement 确认，不能只看「元素在且调用过 focus()」：
  // 焦点没真落上 → insertText 无效 → 输入框是空的 → 发送键 disabled → 点击 no-op，
  // 整条链一路返回成功，消息根本没发出去（静默假发送）。
  const focus = await cdp.evaluate(`(() => {
    const e = ${COMPOSER_EXPR};
    if (!e) return 'missing';
    e.focus();
    return document.activeElement === e ? 'focused' : 'not-focused';
  })()`);
  if (focus !== 'focused') {
    throw new BridgeError(
      ERR.ELEMENT_NOT_FOUND,
      focus === 'missing'
        ? '界面上找不到输入框（.ProseMirror[role="textbox"]）'
        : '输入框拿不到焦点（调用 focus() 后 document.activeElement 不是它），消息未发送。',
      { reason: focus, ...(await probeTextboxes(cdp)), candidates: await collectButtonLabels(cdp) },
    );
  }

  await sleep(DELAY.beforeInsert);

  const draft = await cdp.evaluate(composerTextExpr());
  if (draft !== '') {
    throw new BridgeError(ERR.ELEMENT_NOT_FOUND, '输入框不可用或存在草稿，消息未发送。');
  }

  await cdp.insertText(text);
  await sleep(DELAY.afterInsert);

  // 发送前回读：框里必须**只有**这条消息。多窗口并发时这是最后一道闸——
  // 混进别人的草稿就整条一起发出去，Codex 那边会收到两份互相矛盾的任务书。
  const actual = await cdp.evaluate(composerTextExpr());
  if (bareText(actual) !== bareText(text)) {
    throw new BridgeError(
      ERR.INTERNAL,
      '发送前校验不通过：输入框内容与待发消息不一致。消息未发送，检查输入框中的草稿。',
      { expectedLength: text.length, actualLength: actual === null ? null : String(actual).length },
    );
  }

  // 与 isTurnRunning 同源的收窄：只点输入区里的那个发送键，不误点评论浮层/重发按钮
  const scope = composerScopeExpr([...LABEL.send, ...LABEL.stop]);
  if (!(await clickButtonByLabel(cdp, LABEL.send, scope))) {
    const candidates = await collectButtonLabels(cdp);
    throw new BridgeError(
      ERR.ELEMENT_NOT_FOUND,
      '界面上找不到可点的发送按钮（没有可见且未 disabled 的候选），消息未发送。',
      { tried: LABEL.send, candidates },
    );
  }
  await sleep(DELAY.afterSend); // 等会话文件落盘，供后续 diff 出 threadId
}
