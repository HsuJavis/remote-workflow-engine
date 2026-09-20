// src/dashboard/ui/agent-panel.js
// DES-206/205, ARCH-125/131, TASK-211, REQ-135/136 — the agent slide-in panel. `render(container,
// vm, handlers)` follows DES-206's uniform view contract: `vm` is a pure projection built by
// `lib/agent.js`'s `panelModel`/`eventListModel`/`clipText` (DES-205) plus the identity/side
// fields this task adds (`agentId`, `label`, `state`, `phase`, `prompt`, `side`) — this module
// decides nothing `lib/` could decide, it only builds DOM and delegates the close/expand
// listeners.
//
// `openAgentPanel(runId, agentId, label, opts)` is the integration entry point a click on a real
// swimlane node calls: fetch `/api/runs/:id/agents/:agentId`, project it through `panelModel`,
// mount on `document.body` (so the panel survives `ui/run.js`'s own 3s rebuild of `#dag-graph`,
// which replaces only its own subtree). IMPL-224 wired this: `ui/run.js`'s own click handler
// (`ui/run.js:147`) invokes `layer.onSelectAgent(agentId, label, extra)`, and `render()`
// (`ui/run.js:410`) now defaults `handlers.onSelectAgent` to
// `(id, lbl, extra) => openAgentPanel(runId, id, lbl, { lang, ...extra })` when the caller
// (`ui/app.js`'s `mountLazy`) supplies none — option (a) of the two this banner used to weigh
// between; a caller-supplied `onSelectAgent` still wins, so option (b) is not shadowed. Verified
// end-to-end at val-201 (real Chromium).
//
// [v27 Gate 7.5 round 2 fix, REQ-135] `opts.nodeCenterX`/`opts.graphWidth` (fed into
// `lib/swimlane.js`'s `panelSide`) are now ALWAYS supplied by both real wirings (`ui/run.js`'s
// `ensureCellLayer` click listener and `ui/workflow.js`'s own `onSelectAgent`, both computed
// synchronously from the clicked cell's own `getBoundingClientRect()` at click time — never an id
// lookup, so it works on `/dashboard/:runId` AND `/dashboard/workflow/:name` alike). The previous
// fallback here read `window.event` AFTER the `await getJSON(...)` below, by which point the click
// event's dispatch had long finished and `window.event` was always `undefined` — silently forcing
// the 'right' default every time and never taking the left branch the README describes. Removed
// rather than reordered: even reading it before the `await` would still have missed on the
// workflow route, since it also looked up `#dag-graph` by id, an element that only exists on this
// file's `ui/run.js` sibling. A caller that supplies neither field still gets the safe 'right'
// default.
import { panelSide } from '../lib/swimlane.js';
// [v30, REQ-168] This file had its OWN `fmtClock`, which formatted with `toISOString()` — UTC —
// while the history table on the same page renders local time. That contradiction was created in
// v29 c1 by localising one surface and not the other; nothing in the ledger ever ruled these
// timestamps UTC. The private copy is deleted rather than patched: it was the FOURTH copy of this
// formatter in the client (app.js's `pad2`, runlist's `p2`, this one, and the models/system
// headers that would have made a fifth).
import { fmtClock } from '../lib/runlist.js';
import { kindLabel, stateLabel } from '../lib/strings.js';
import { panelModel, clipText } from '../lib/agent.js';
import { clockNow } from './clock.js';
import { getViewJSON } from './poll.js';

const EVENT_CLIP = 2048;

// Not imported from `./run.js`: wiring option (a) below has `run.js` import THIS module, and a
// two-line local duplicate is cheaper than the only cycle in `ui/` (`run.js` already exports the
// same one-liner for `ui/workflow.js`'s use, since imports run one direction there).
function currentLang() {
  return document.documentElement.lang === 'en' ? 'en' : 'zh';
}


function buildTag(text, variant) {
  const span = document.createElement('span');
  span.className = variant ? `tag ${variant}` : 'tag';
  span.textContent = text;
  return span;
}

function buildStatCard(label, value, meta) {
  const card = document.createElement('div');
  card.setAttribute('data-stat-card', '');
  const l = document.createElement('span');
  l.className = 'stat-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'stat-value';
  v.textContent = value;
  card.append(l, v);
  // [v32, REQ-199] optional third line — only the Duration card supplies one today (its start → end).
  if (meta) {
    const m = document.createElement('span');
    m.className = 'stat-meta';
    m.textContent = meta;
    card.appendChild(m);
  }
  return card;
}

// DES-209's REQ-135 row declares `.event-kind{.is-tool,.is-message,.is-log}` — three CSS
// categories for the wire's six `kind` values (`types.ts:559`); tool_call/tool_result share the
// tool look, message keeps its own, and the rest (usage/harness/refused) read as log lines. No
// design-doc oracle names this grouping; it is this task's own resolved-and-surfaced decision.
function eventKindCategory(kind) {
  if (kind === 'tool_call' || kind === 'tool_result') return 'tool';
  if (kind === 'message') return 'message';
  return 'log';
}

function buildEventKindTag(kind, lang) {
  const span = document.createElement('span');
  // [v29, REQ-150] The CSS CATEGORY still comes from the raw wire `kind` (three looks for six
  // values); only the visible text is translated.
  span.className = `event-kind is-${eventKindCategory(kind)}`;
  span.textContent = kindLabel(lang, kind);
  return span;
}

function buildEventRow(ev, lang) {
  const row = document.createElement('div');
  row.className = 'event-row';
  const clock = document.createElement('span');
  clock.textContent = fmtClock(ev.ts);
  row.appendChild(clock);
  row.appendChild(buildEventKindTag(ev.kind, lang));
  const raw = typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data ?? {});
  const { shown, clipped } = clipText(raw, EVENT_CLIP);
  const content = document.createElement('code');
  content.textContent = shown;
  row.appendChild(content);
  if (clipped) {
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.setAttribute('data-expand-event', '');
    expand.textContent = lang === 'zh' ? '展開' : 'expand';
    expand.addEventListener('click', () => {
      content.textContent = raw;
      expand.remove();
    });
    row.appendChild(expand);
  }
  return row;
}

/** DES-206's uniform view contract. `container` is the element the panel + backdrop mount into
 *  (the integration entry point below always passes `document.body`). `handlers.onClose()`, if
 *  given, fires alongside the close button / Esc / backdrop click — never instead of removing the
 *  panel (val-201 asserts the element is gone, not merely hidden). Returns `{ close }` so a caller
 *  can dismiss it programmatically. */
export function render(container, vm, handlers) {
  const lang = vm.lang === 'en' ? 'en' : 'zh';

  const backdrop = document.createElement('div');
  backdrop.setAttribute('data-agent-panel-backdrop', '');
  backdrop.className = 'agent-backdrop';

  const panel = document.createElement('aside');
  panel.setAttribute('data-agent-panel', '');
  const side = vm.side === 'left' ? 'left' : 'right';
  panel.className = side === 'left' ? 'agent-panel from-left' : 'agent-panel';

  function close() {
    backdrop.remove();
    panel.remove();
    document.removeEventListener('keydown', onKey);
    if (handlers && handlers.onClose) handlers.onClose();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  const header = document.createElement('header');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn-icon';
  closeBtn.setAttribute('data-panel-close', '');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', close);
  header.appendChild(closeBtn);

  const h2 = document.createElement('h2');
  h2.textContent = vm.label || vm.agentId || '';
  header.appendChild(h2);

  // [v29, REQ-150] the state tag read the raw wire word (`done`) in the zh panel.
  if (vm.state) header.appendChild(buildTag(stateLabel(lang, vm.state)));
  if (vm.phase) header.appendChild(buildTag(vm.phase));
  if (vm.reasonCode) header.appendChild(buildTag(vm.reasonCode));

  const idEl = document.createElement('code');
  idEl.textContent = vm.agentId || '';
  header.appendChild(idEl);
  panel.appendChild(header);

  const statsWrap = document.createElement('div');
  statsWrap.className = 'stat-cards';
  for (const s of vm.stats || []) statsWrap.appendChild(buildStatCard(s.label, s.value, s.meta));
  panel.appendChild(statsWrap);

  // [v30b, REQ-181] README §3 names this block and the log below it. Without headings the prompt
  // begins abruptly after the stat cards and the event list after it, with nothing saying what
  // either is.
  const promptHead = document.createElement('h6');
  promptHead.className = 'section-head';
  promptHead.textContent = lang === 'zh' ? '使用者提示詞' : 'User prompt';
  panel.appendChild(promptHead);

  const promptPre = document.createElement('pre');
  promptPre.className = 'prompt-pre';
  promptPre.setAttribute('data-agent-prompt', '');
  promptPre.textContent = vm.prompt || '';
  panel.appendChild(promptPre);

  const spNote = document.createElement('p');
  spNote.setAttribute('data-system-prompt-note', '');
  spNote.textContent = vm.systemPromptNote || '';
  panel.appendChild(spNote);

  // The three tag columns (ARCH-125): the curated session surface's own counts — a capture with
  // no reader is not observability, same rule as the mcpUnresolved/unmapped tags below. REQ-135's
  // own acceptance text pins one variant per column: 允許工具 `.tag-neutral`, MCP 伺服器
  // `.tag-accent`, 技能 `.tag-outline`.
  // [v30, REQ-167] Three COLUMNS that list their contents, each with its count — REQ-135's own
  // wording (三欄列出…各帶數量) and README §3's. What shipped was three bare count tags, so the
  // one question the panel exists to answer — WHICH tools did this agent have — was unanswerable.
  // Order is README's: tools → MCP servers → skills. The per-column tag variant is unchanged.
  const tagCols = document.createElement('div');
  tagCols.className = 'tag-columns';
  const COLS = [
    { items: vm.tools, count: vm.toolsCount, variant: 'tag-neutral', zh: '可用工具', en: 'Allowed tools' },
    { items: vm.mcpServers, count: vm.mcpCount, variant: 'tag-accent', zh: 'MCP 伺服器', en: 'MCP servers' },
    { items: vm.skills, count: vm.skillsCount, variant: 'tag-outline', zh: '技能', en: 'Skills' },
  ];
  for (const col of COLS) {
    const wrap = document.createElement('div');
    wrap.className = 'tag-column';
    const head = document.createElement('div');
    head.className = 'tag-column-head';
    head.textContent = (lang === 'zh' ? col.zh : col.en) + ' ' + (col.count ?? 0);
    wrap.appendChild(head);
    const items = Array.isArray(col.items) ? col.items : [];
    if (!items.length) {
      const none = document.createElement('span');
      none.className = 'muted';
      none.textContent = lang === 'zh' ? '(無)' : '(none)';
      wrap.appendChild(none);
    }
    for (const it of items) wrap.appendChild(buildTag(String(it), col.variant));
    tagCols.appendChild(wrap);
  }
  panel.appendChild(tagCols);

  if ((vm.mcpUnresolved || []).length || (vm.unmapped || []).length) {
    const unresolvedRow = document.createElement('div');
    unresolvedRow.className = 'tag-columns';
    for (const name of vm.mcpUnresolved || []) unresolvedRow.appendChild(buildTag(name));
    for (const name of vm.unmapped || []) unresolvedRow.appendChild(buildTag(name));
    panel.appendChild(unresolvedRow);
  }

  if (vm.detail) {
    const detailBlock = document.createElement('div');
    detailBlock.className = 'detail-block';
    detailBlock.setAttribute('data-agent-detail', '');
    detailBlock.textContent = vm.detail;
    panel.appendChild(detailBlock);
  }

  const logHead = document.createElement('h6');
  logHead.className = 'section-head';
  logHead.textContent = (lang === 'zh' ? '節點輸出 ' : 'Agent output ') + ((vm.rows || []).length);
  panel.appendChild(logHead);

  const eventsWrap = document.createElement('div');
  eventsWrap.className = 'event-list';
  for (const ev of vm.rows || []) eventsWrap.appendChild(buildEventRow(ev, lang));
  panel.appendChild(eventsWrap);

  if (vm.marker) {
    const marker = document.createElement('p');
    marker.setAttribute('data-events-marker', '');
    marker.textContent = lang === 'zh'
      ? `顯示 ${vm.marker.shown} / 共 ${vm.marker.shown}+`
      : `showing ${vm.marker.shown} / of ${vm.marker.shown}+`;
    panel.appendChild(marker);
  }

  container.appendChild(backdrop);
  container.appendChild(panel);
  return { backdrop, panel, close };
}

/** Integration entry point (see the module banner: `ui/run.js`'s `render()` wires a real node
 *  click to this, per IMPL-224). Fetches the agent's record/harness/events, projects them through
 *  `panelModel` (DES-205) and mounts on `document.body`. */
export async function openAgentPanel(runId, agentId, label, opts) {
  const lang = (opts && opts.lang) || currentLang();
  const res = await getViewJSON(`/api/runs/${encodeURIComponent(runId)}/agents/${encodeURIComponent(agentId)}?limit=500`);
  const body = res.body || {};
  // `state: ''` on the not-found/degraded path, never a guessed real state (DES-205 §6's rule
  // against a confident-but-wrong statement applies here too: "queued" would claim liveness this
  // response never reported).
  const record = body.record || { agentId, label, state: '', provider: '', model: '', tokens: { input: 0, output: 0 } };
  const harness = body.harness || null;
  const events = body.events || [];
  const hasMore = !!body.hasMore;
  const now = clockNow();
  // Both real wirings (`ui/run.js`'s `ensureCellLayer` click listener, `ui/workflow.js`'s own
  // `onSelectAgent`) compute `nodeCenterX`/`graphWidth` SYNCHRONOUSLY at click time, before this
  // function's own `await` above ever runs — see the module banner for why a post-await
  // `window.event` read (the previous approach) never worked. A caller that supplies neither still
  // gets the safe 'right' default.
  let side = 'right';
  if (opts && typeof opts.nodeCenterX === 'number' && typeof opts.graphWidth === 'number') {
    side = panelSide(opts.nodeCenterX, opts.graphWidth);
  }
  const vm = {
    ...panelModel(record, harness, events, hasMore, now, lang),
    lang,
    agentId: record.agentId,
    label: record.label || label,
    state: record.state,
    phase: record.phase,
    reasonCode: record.reasonCode,
    prompt: (harness && harness.prompt) || '',
    toolsCount: harness ? harness.tools.length : 0,
    skillsCount: harness ? harness.skills.length : 0,
    mcpCount: harness ? harness.mcpServers.length : 0,
    side,
  };
  return render(document.body, vm, opts && opts.handlers);
}
