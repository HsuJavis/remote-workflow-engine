// src/dashboard/ui/agent-panel.js
// DES-206/205, ARCH-125/131, TASK-211, REQ-135/136 — the agent slide-in panel. `render(container,
// vm, handlers)` follows DES-206's uniform view contract: `vm` is a pure projection built by
// `lib/agent.js`'s `panelModel`/`eventListModel`/`clipText` (DES-205) plus the identity/side
// fields this task adds (`agentId`, `label`, `state`, `phase`, `prompt`, `side`) — this module
// decides nothing `lib/` could decide, it only builds DOM and delegates the close/expand
// listeners.
//
// `openAgentPanel(runId, agentId, label, opts)` is the integration entry point a click on a real
// swimlane node is meant to call: fetch `/api/runs/:id/agents/:agentId`, project it through
// `panelModel`, mount on `document.body` (so the panel survives `ui/run.js`'s own 3s rebuild of
// `#dag-graph`, which replaces only its own subtree). NEEDS_CLARIFICATION (reported, not silently
// worked around): nothing currently calls this. `ui/run.js`'s own click handler
// (`ui/run.js:169`) invokes `opts.onSelectAgent(agentId, label)` only when the view's `render()`
// receives it via `handlers.onSelectAgent`, and `ui/app.js`'s `mountLazy` (the only caller of
// `run.js`'s `render`) passes `{}` — both files are outside TASK-211's file list. Wiring this
// needs ONE of: (a) `ui/run.js`'s `render()` defaulting `handlers.onSelectAgent` to
// `(id, lbl) => openAgentPanel(runId, id, lbl, { lang })`, or (b) `ui/app.js` passing that handler
// into `run.js`'s `render` call. Verified working end-to-end (val-201, real Chromium) against a
// scratch copy of the tree with (a) applied as a two-line patch; not applied here since it would
// touch a sibling task's file on a tree ~20 parallel implementers share.
// A second, smaller gap the same wiring exposes: REQ-135's slide-by-node-position needs the
// clicked node's on-screen center and the graph's width (`lib/swimlane.js`'s `panelSide`), and
// `onSelectAgent(agentId, label)` carries neither. `opts.nodeCenterX`/`opts.graphWidth` are
// accepted for a future wiring that supplies them directly; absent, `openAgentPanel` falls back to
// `window.event` (live at call time, since `onSelectAgent` fires synchronously from the swimlane's
// own click listener) to recover the click's real x — only defaulting to a bare 'right' if neither
// is available (val-201 does not assert a side, only that clicking the node opens the panel).
import { panelSide } from '../lib/swimlane.js';
import { panelModel, clipText } from '../lib/agent.js';
import { getJSON } from './poll.js';

const EVENT_CLIP = 2048;

// Not imported from `./run.js`: wiring option (a) below has `run.js` import THIS module, and a
// two-line local duplicate is cheaper than the only cycle in `ui/` (`run.js` already exports the
// same one-liner for `ui/workflow.js`'s use, since imports run one direction there).
function currentLang() {
  return document.documentElement.lang === 'en' ? 'en' : 'zh';
}

function fmtClock(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(11, 19);
}

function buildTag(text) {
  const span = document.createElement('span');
  span.className = 'tag';
  span.textContent = text;
  return span;
}

function buildStatCard(label, value) {
  const card = document.createElement('div');
  card.setAttribute('data-stat-card', '');
  const l = document.createElement('span');
  l.className = 'stat-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'stat-value';
  v.textContent = value;
  card.append(l, v);
  return card;
}

function buildEventRow(ev, lang) {
  const row = document.createElement('div');
  row.className = 'event-row';
  const clock = document.createElement('span');
  clock.textContent = fmtClock(ev.ts);
  row.appendChild(clock);
  row.appendChild(buildTag(ev.kind));
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
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(8,12,9,.5);z-index:40;';

  const panel = document.createElement('aside');
  panel.setAttribute('data-agent-panel', '');
  const side = vm.side === 'left' ? 'left' : 'right';
  panel.dataset.side = side;
  panel.style.cssText = `position:fixed;top:0;bottom:0;${side}:0;width:420px;max-width:90vw;overflow-y:auto;z-index:41;`;

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
  closeBtn.setAttribute('data-panel-close', '');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', close);
  header.appendChild(closeBtn);

  const h2 = document.createElement('h2');
  h2.textContent = vm.label || vm.agentId || '';
  header.appendChild(h2);

  if (vm.state) header.appendChild(buildTag(vm.state));
  if (vm.phase) header.appendChild(buildTag(vm.phase));
  if (vm.reasonCode) header.appendChild(buildTag(vm.reasonCode));

  const idEl = document.createElement('code');
  idEl.textContent = vm.agentId || '';
  header.appendChild(idEl);
  panel.appendChild(header);

  const statsWrap = document.createElement('div');
  statsWrap.className = 'stat-cards';
  for (const s of vm.stats || []) statsWrap.appendChild(buildStatCard(s.label, s.value));
  panel.appendChild(statsWrap);

  const promptPre = document.createElement('pre');
  promptPre.setAttribute('data-agent-prompt', '');
  promptPre.textContent = vm.prompt || '';
  panel.appendChild(promptPre);

  const spNote = document.createElement('p');
  spNote.setAttribute('data-system-prompt-note', '');
  spNote.textContent = vm.systemPromptNote || '';
  panel.appendChild(spNote);

  // The three tag columns (ARCH-125): the curated session surface's own counts — a capture with
  // no reader is not observability, same rule as the mcpUnresolved/unmapped tags below.
  const tagCols = document.createElement('div');
  tagCols.className = 'tag-columns';
  tagCols.appendChild(buildTag((lang === 'zh' ? '工具 ' : 'tools ') + (vm.toolsCount ?? 0)));
  tagCols.appendChild(buildTag((lang === 'zh' ? '技能 ' : 'skills ') + (vm.skillsCount ?? 0)));
  tagCols.appendChild(buildTag('MCP ' + (vm.mcpCount ?? 0)));
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
    detailBlock.setAttribute('data-agent-detail', '');
    detailBlock.style.cssText = 'background:oklch(0.3 0.12 25);color:#fff;padding:10px;border-radius:6px;margin:10px 0;';
    detailBlock.textContent = vm.detail;
    panel.appendChild(detailBlock);
  }

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

/** Integration entry point (see the module banner's needs_clarification: nothing wires this to a
 *  real node click yet). Fetches the agent's record/harness/events, projects them through
 *  `panelModel` (DES-205) and mounts on `document.body`. */
export async function openAgentPanel(runId, agentId, label, opts) {
  const lang = (opts && opts.lang) || currentLang();
  const res = await getJSON(`/api/runs/${encodeURIComponent(runId)}/agents/${encodeURIComponent(agentId)}?limit=500`);
  const body = res.body || {};
  // `state: ''` on the not-found/degraded path, never a guessed real state (DES-205 §6's rule
  // against a confident-but-wrong statement applies here too: "queued" would claim liveness this
  // response never reported).
  const record = body.record || { agentId, label, state: '', provider: '', model: '', tokens: { input: 0, output: 0 } };
  const harness = body.harness || null;
  const events = body.events || [];
  const hasMore = !!body.hasMore;
  const now = new Date().toISOString();
  // `onSelectAgent` fires synchronously from the swimlane's own click listener (`run.js:169`), so
  // `window.event` (still live in every Chromium build though formally deprecated) carries the
  // real click coordinates when neither `opts.nodeCenterX` nor `opts.graphWidth` was threaded
  // through — closes REQ-135's slide-by-position dod item without widening `onSelectAgent`'s
  // signature or touching `run.js`.
  let side = 'right';
  if (opts && typeof opts.nodeCenterX === 'number' && typeof opts.graphWidth === 'number') {
    side = panelSide(opts.nodeCenterX, opts.graphWidth);
  } else {
    const clickEvent = typeof window !== 'undefined' ? window.event : null;
    const graph = typeof document !== 'undefined' ? document.getElementById('dag-graph') : null;
    if (clickEvent && graph && typeof clickEvent.clientX === 'number') {
      const rect = graph.getBoundingClientRect();
      if (rect.width > 0) side = panelSide(clickEvent.clientX - rect.left, rect.width);
    }
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
