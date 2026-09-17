// src/dashboard/ui/workflow.js
// DES-206/204, ARCH-125/131, TASK-209, REQ-133 — the workflow detail view: version/executable
// tags, the TRIGGERS outline column, up to six run chips, the nine-column history table
// (`historyRow`, DES-204), a row/chip click switching the figure above to that run, and — for a
// workflow with no runs at all — the PREDICTED layout (never the retired word; `t(lang,
// 'predictedLayout'/'predictedLayoutUnavailable')`, DES-201/206), reusing `ui/run.js`'s swimlane
// painter (DES-206: "the swimlane painter... reused by TASK-209") for BOTH figures. The author's
// diagram (`createObjectURL`/`revokeObjectURL`, memoized per (name,version)) is ported verbatim
// from the pre-v27 inline script's `renderDiagram`/`hideDiagram` pair.
//
// [v27c] `onTick(container, bodies, ctx)` (DES-206) replaces this view's own `setTimeout` loop:
// `app.js`'s one timer fetches `endpointsFor('workflow', ctx)` (describe + /api/runs) and hands the
// bodies here every ~3s; the selected run's own `/dag` + `/api/runs/:id` fetch is state-dependent
// (which run is selected lives in THIS view, not in `ctx`), so it is made here via `getJSON` and its
// statuses are returned for `app.js` to fold into the connection reducer.
// [v28b, DES-220] `onTick` gains DES-210's 4th `tick` parameter — a demo-tick describe miss paints
// the `noDemoData` disclosure (`paintRouteUnfounded`) instead of leaving the last LIVE render frozen.
//
// [v27 seam closure] `buildShell`'s graph container now carries the `.graph-frame` class
// (`dashboard.css`/`dashboard-classes.ts`, DES-209 boundary (2)) instead of setting its sizing as
// element properties directly — see `ui/run.js`'s own banner for the full reasoning (no handoff
// spec exists for the actual numbers, so this view's pre-existing figures are kept, only relocated).
//
// REQ-134 row 2 (model short name + effort tag, `ui/run.js`'s `paintSwimlane`): this view already
// has `describe` in scope wherever it paints a figure, so it passes `pAgents` straight through with
// no extra fetch — see `ui/run.js`'s own banner for the join `paintSwimlane` performs with it.
//
// [v27 Gate 7.5 round 2 fix, REQ-135] Both `paintSwimlane` calls in `paintSelected` below now pass
// `onSelectAgent` — this view's own click-to-open-the-agent-panel wiring was simply missing before
// this pass (the ONLY route affected: `/dashboard/:runId`'s `ui/run.js` already wired it, per that
// file's own `render()`). Same pattern as `ui/run.js`'s default: a caller-supplied
// `handlers.onSelectAgent` still wins; absent one, clicking a real agent cell opens
// `openAgentPanel(state.selectedRunId, id, lbl, {lang, ...extra})`, where `extra` carries the
// clicked cell's own `{nodeCenterX, graphWidth}` (`ui/run.js`'s `ensureCellLayer` computes and
// forwards them synchronously — see its own banner).
import { paintSwimlane, renderLegend, initZoomable, currentLang } from './run.js';
import { openAgentPanel } from './agent-panel.js';
import { endpointsFor, getViewJSON } from './poll.js';
import { el } from './dom.js';
import { historyRow } from '../lib/runlist.js';
import { t } from '../lib/strings.js';
import { clockNow } from './clock.js';

const NS = 'http://www.w3.org/2000/svg';
const COLUMNS = {
  zh: ['執行ID', '狀態', '版本', '觸發者', '開始時間', '耗時', '節點數', 'Tokens', '費用'],
  en: ['Run ID', 'Status', 'Version', 'Triggered by', 'Started', 'Duration', 'Agents', 'Tokens', 'Cost'],
};

/** Best-effort one-line label for a resolved trigger claim — the shape is a closed union the
 *  dashboard has no import path to at this layer (scheduler claim / webhook claim / a bare
 *  `{id,status:'TRIGGER_NOT_FOUND'}`), so this reads only the fields common across all three. */
function triggerLabel(tr) {
  if (!tr || typeof tr !== 'object') return String(tr);
  if (tr.status === 'TRIGGER_NOT_FOUND') return (tr.id || '?') + ' · not found';
  if ('cron' in tr) return 'schedule · ' + (tr.id || tr.cron);
  return 'webhook · ' + (tr.id || tr.webhookId || '?');
}

/** Builds a synthetic DAG-route-shaped payload from `describe.phases[].agents` for a workflow
 *  that has never run — `paintSwimlane` cannot tell this from a real (empty) run, which is the
 *  point: one painter, two producers. `agents` absent on EVERY phase means the predicted overlay
 *  itself is unavailable (DES-206's v27b rule) — the caller renders `predictedLayoutUnavailable`
 *  in that case instead of an empty graph. */
function predictedPayload(describe) {
  const phases = Array.isArray(describe.phases) ? describe.phases : [];
  const cells = [{ id: '__trigger__', kind: 'trigger', col: 0, row: 0, laneSpan: 1, label: 'trigger' }];
  let anyAgentsKey = false;
  phases.forEach((p, i) => {
    if (!Array.isArray(p.agents)) return;
    anyAgentsKey = true;
    p.agents.forEach((label, j) => {
      cells.push({ id: '__predicted_' + i + '_' + j + '__', kind: 'agent', col: i + 1, row: j, laneSpan: 1, label });
    });
  });
  const lanes = phases.map((p, i) => ({ index: i, title: p.title }));
  return { payload: { cells, edges: [], warnings: [], lanes, current: null }, anyAgentsKey };
}

function buildShell(container) {
  const root = document.createElement('div');
  root.className = 'workflow-view';

  // v27c fix (REQ-129/VAL-197): the name + its two badges are ONE flex-column item, not three —
  // `.workflow-view`'s `gap:20px` (dashboard.css:184) gave each of `h2`/`versionTag`/`execTag` its
  // own row, pushing everything below (including `#diagram-zoom`) ~80px further down the page than
  // the pre-v27 single-line "Run <id> <status>" header ever did. `nameEl` carries the name text so
  // `renderHeader`'s per-tick write can't wipe the tags the way `h2.textContent = ...` would.
  const h2 = document.createElement('h2');
  const nameEl = document.createElement('span');
  h2.appendChild(nameEl);
  h2.appendChild(document.createTextNode(' '));
  const versionTag = document.createElement('span');
  versionTag.className = 'tag';
  h2.appendChild(versionTag);
  h2.appendChild(document.createTextNode(' '));
  const execTag = document.createElement('span');
  execTag.className = 'tag';
  h2.appendChild(execTag);
  root.appendChild(h2);
  const desc = document.createElement('p');
  desc.className = 'wf-desc'; // DES-209 STYLE_HOOKS — `max-width:720px` moves to the stylesheet.
  root.appendChild(desc);

  const triggers = document.createElement('div');
  triggers.setAttribute('data-triggers', '');
  root.appendChild(triggers);

  const predictedLabel = document.createElement('p');
  predictedLabel.setAttribute('data-predicted-label', '');
  root.appendChild(predictedLabel);

  const graphContainer = document.createElement('div');
  graphContainer.className = 'graph-frame'; // DES-209 boundary (2) — sizing lives in dashboard.css.
  const zoom = document.createElement('div');
  zoom.className = 'zoomable'; // see run.js's own comment: keeps the pan hit-area filling the
                                // visible container even when the painted graph is short.
  const svgEl = document.createElementNS(NS, 'svg');
  zoom.appendChild(svgEl);
  graphContainer.appendChild(zoom);
  root.appendChild(graphContainer);
  initZoomable(zoom, null);

  const legend = document.createElement('div');
  legend.setAttribute('data-legend', '');
  root.appendChild(legend);

  const chips = document.createElement('div');
  chips.setAttribute('data-run-chips', '');
  root.appendChild(chips);

  const table = document.createElement('table');
  table.className = 'table'; // DES-209 STYLE_HOOKS component layer.
  table.setAttribute('data-history-table', ''); // DES-209 TEST_ANCHORS.
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const lang = currentLang();
  for (const h of COLUMNS[lang] || COLUMNS.zh) {
    const th = document.createElement('th');
    th.textContent = h;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  const tbody = document.createElement('tbody');
  table.appendChild(thead);
  table.appendChild(tbody);
  root.appendChild(table);

  // The author's diagram — ported verbatim (DOM order + ids) from the pre-v27 shell/script pair.
  const diagramZoom = document.createElement('div');
  diagramZoom.id = 'diagram-zoom';
  diagramZoom.className = 'zoomable';
  diagramZoom.style.display = 'none';
  const img = document.createElement('img');
  img.id = 'diagram-img';
  img.alt = 'workflow diagram';
  img.draggable = false;
  diagramZoom.appendChild(img);
  root.appendChild(diagramZoom);
  const diagramFit = document.createElement('button');
  diagramFit.type = 'button';
  diagramFit.id = 'diagram-fit';
  diagramFit.className = 'fit-btn';
  diagramFit.style.display = 'none';
  diagramFit.textContent = 'Fit';
  root.appendChild(diagramFit);
  const pre = document.createElement('pre');
  pre.id = 'diagram';
  pre.style.display = 'none';
  root.appendChild(pre);
  const note = document.createElement('p');
  note.id = 'mermaidNote';
  note.style.display = 'none';
  root.appendChild(note);
  initZoomable(diagramZoom, diagramFit);

  container.replaceChildren(root);
  return { root, h2, nameEl, versionTag, execTag, desc, triggers, predictedLabel, svgEl, legend, chips, tbody, diagramZoom, img, diagramFit, pre, note };
}

function renderHeader(shell, describe, lang) {
  shell.nameEl.textContent = describe.name;
  shell.versionTag.textContent = (lang === 'zh' ? '版本 v' : 'v') + describe.version;
  shell.execTag.textContent = describe.runnable
    ? (lang === 'zh' ? '可執行' : 'executable')
    : (lang === 'zh' ? '不可執行' : 'not executable') + (describe.runnableReason ? ' · ' + describe.runnableReason : '');
  shell.desc.textContent = describe.description || '';
  shell.triggers.replaceChildren();
  for (const tr of describe.triggers || []) {
    const tag = document.createElement('span');
    tag.className = 'tag tag-outline'; // DES-209 STYLE_HOOKS — the "TRIGGERS outline tags".
    tag.textContent = triggerLabel(tr);
    shell.triggers.appendChild(tag);
  }
}

function renderChipsAndTable(shell, runs, selectedRunId, lang, onPick) {
  shell.chips.replaceChildren();
  const sorted = [...runs].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  for (const r of sorted.slice(0, 6)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'run-chip' + (r.runId === selectedRunId ? ' is-selected' : '');
    chip.setAttribute('data-run-chip', ''); // DES-209 TEST_ANCHORS.
    const dot = document.createElement('span');
    dot.textContent = '●';
    dot.className = 'status-dot'; // DES-209 STYLE_HOOKS — the 7px size moves to the stylesheet.
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(' ' + r.runId.slice(0, 8)));
    chip.addEventListener('click', () => onPick(r.runId));
    shell.chips.appendChild(chip);
  }

  shell.tbody.replaceChildren();
  const now = clockNow();
  for (const r of sorted) {
    const tr = document.createElement('tr');
    if (r.runId === selectedRunId) tr.className = 'is-selected'; // DES-209: `tr.is-selected` in the stylesheet.
    historyRow(r, now, lang).forEach((cell, i) => {
      const td = document.createElement('td');
      if (i === 0) td.className = 'mono'; // DES-209 STYLE_HOOKS — column 0 is `historyRow`'s runId.
      td.textContent = cell;
      tr.appendChild(td);
    });
    tr.addEventListener('click', () => onPick(r.runId));
    shell.tbody.appendChild(tr);
  }
}

function nameFilteredRuns(allRuns, name) {
  return (allRuns || []).filter((r) => r.name === name);
}

/** Picks the active (running/queued) run, else the most recent — shared by `onTick` (so the
 *  FIRST paint already has a selection, not just the second tick 3s later) and `paintSelected`. */
function resolveSelectedRunId(state, runs) {
  if (!state.selectedRunId || !runs.some((r) => r.runId === state.selectedRunId)) {
    const active = runs.find((r) => r.status === 'running' || r.status === 'queued');
    state.selectedRunId = active ? active.runId : [...runs].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0].runId;
  }
}

const stateByContainer = new WeakMap();

function hideDiagram(state) {
  const shell = state.shell;
  state.diagramKey = null;
  shell.img.removeAttribute('src');
  shell.diagramZoom.style.display = 'none';
  shell.diagramFit.style.display = 'none';
  if (state.diagramUrl) { URL.revokeObjectURL(state.diagramUrl); state.diagramUrl = null; }
  shell.pre.style.display = 'none';
  shell.note.style.display = 'none';
}

async function loadDiagram(state, describe, lang) {
  const shell = state.shell;
  if (!describe.mermaid) {
    hideDiagram(state);
    shell.pre.style.display = 'block';
    shell.pre.textContent = describe.description || '';
    shell.note.style.display = 'block';
    shell.note.textContent = describe.mermaidNote || '';
    return;
  }
  const key = describe.name + '@' + describe.version;
  if (state.diagramKey === key) return; // fetched once per (name, version) — never once per tick.
  state.diagramKey = key;
  let res = null;
  try {
    res = await fetch('/api/workflows/' + encodeURIComponent(describe.name) + '/diagram.svg?version=' + encodeURIComponent(describe.version));
  } catch {
    res = null;
  }
  if (res && res.ok) {
    const blob = await res.blob();
    if (state.diagramUrl) URL.revokeObjectURL(state.diagramUrl);
    state.diagramUrl = URL.createObjectURL(blob);
    shell.img.src = state.diagramUrl;
    shell.diagramZoom.style.display = 'block';
    shell.diagramFit.style.display = 'inline-block';
    shell.pre.style.display = 'none';
    shell.note.style.display = 'none';
    return;
  }
  shell.img.removeAttribute('src');
  shell.diagramZoom.style.display = 'none';
  shell.diagramFit.style.display = 'none';
  shell.pre.style.display = 'block';
  shell.pre.textContent = describe.description || '';
  shell.note.style.display = 'block';
  shell.note.textContent = t(lang, 'predictedLayoutUnavailable');
}

/** DES-206 (U) [v27m] — the ONE Unavailable component for this view's figure. Clears the CHILDREN
 *  of the surfaces the `/dag` route feeds (the svg, the cell layer, the legend) and keeps their
 *  NODES: `[data-legend]` is a DES-209 TEST_ANCHOR and `.cell-layer` carries `ensureCellLayer`'s
 *  delegated click listener, so replacing either element would regress an anchor or the REQ-135
 *  click wiring. The text comes from the string table, never a per-file literal — `ui/system.js:29`'s
 *  zh-only const is the debt this must not duplicate (QD-R3). [v28b, DES-220] takes the rendered
 *  `text` directly (was `lang`) so `paintRouteUnfounded` can reuse it with a different string key. */
function paintFigureUnavailable(shell, text) {
  shell.svgEl.replaceChildren();
  const wrap = shell.svgEl.parentElement;
  const layer = wrap && wrap.querySelector(':scope > .cell-layer');
  if (layer) layer.replaceChildren();
  shell.legend.replaceChildren(el('div', 'empty', text));
}

/** [v28b, DES-220] the per-route disclosure for a demo tick on a route with no DEMO map entry
 *  (DES-212) — a STOPPED engine must not leave this view's LIVE render frozen on screen forever.
 *  Clears every surface `describe`/`/api/runs` feed (keeps NODES, per `paintFigureUnavailable`'s own
 *  rule) and resets `paintedRunId` so a later recovery tick cannot mistake this for a kept paint of
 *  the current run (B1). `shell.nameEl` is left alone — the workflow name is the page's subject from
 *  the URL, not route data. */
function paintRouteUnfounded(state, text) {
  const shell = state.shell;
  shell.versionTag.textContent = '';
  shell.execTag.textContent = '';
  shell.desc.textContent = '';
  shell.triggers.replaceChildren();
  shell.predictedLabel.textContent = '';
  shell.chips.replaceChildren();
  shell.tbody.replaceChildren();
  hideDiagram(state);
  paintFigureUnavailable(shell, text);
  state.paintedRunId = null;
}

/** Paints the selected (or predicted) figure; returns the state-dependent fetch statuses (the
 *  selected run's own `/dag` + `/api/runs/:id`) for `onTick` to fold into the connection reducer —
 *  `{}` for the no-runs/predicted branch, which makes no such fetch. */
async function paintSelected(state, runs, describe, lang) {
  const shell = state.shell;
  // REQ-134 row 2 (`ui/run.js`'s `paintSwimlane`, see its own banner) — `describe` is already in
  // scope on both branches here, so the declared model/effort defaults need no extra fetch.
  const pAgents = (describe && describe.params && describe.params.agents) || {};
  // REQ-135 (see this file's own banner) — a caller-supplied handler still wins; the default opens
  // the panel against WHICHEVER run is currently selected, read at CLICK time (never captured
  // early), since `state.selectedRunId` can change between paints via the run chips/history table.
  const onSelectAgent = state.handlers.onSelectAgent
    || ((id, lbl, extra) => openAgentPanel(state.selectedRunId, id, lbl, { lang, ...(extra || {}) }));
  if (runs.length === 0) {
    const { payload, anyAgentsKey } = predictedPayload(describe);
    paintSwimlane(shell.svgEl, payload, { lang, pAgents, onSelectAgent });
    renderLegend(shell.legend, payload, null, lang);
    shell.predictedLabel.textContent = anyAgentsKey
      ? t(lang, 'predictedLayout')
      : t(lang, 'predictedLayout') + ' — ' + t(lang, 'predictedLayoutUnavailable');
    return {};
  }
  shell.predictedLabel.textContent = '';
  resolveSelectedRunId(state, runs);
  const dagUrl = '/api/runs/' + encodeURIComponent(state.selectedRunId) + '/dag';
  const viewUrl = '/api/runs/' + encodeURIComponent(state.selectedRunId);
  const [dagRes, viewRes] = await Promise.all([getViewJSON(dagUrl), getViewJSON(viewUrl)]);
  const statuses = { [dagUrl]: dagRes.status, [viewUrl]: viewRes.status };
  // [BF-7 Gate 8 repair — DES-206's (V)/(K)/(U)/(N) clause, v27m] BF-6's own fix stopped the
  // degraded BODY reaching the painters and then handed them a SYNTHESIZED one instead
  // (`{cells:[],edges:[],warnings:[],lanes:[],current:null}`): `paintSwimlane` `replaceChildren()`s
  // the svg and the cell layer BEFORE appending (`run.js:219`/`:222`), so the live figure, lane
  // headers and legend were erased, and `renderLegend` then computed `nodeCount` off the invented
  // `cells` and printed 「0 個節點」 — a fabricated quantity in the same sentence and styling as two
  // real ones. (N) forbids constructing a payload for a route that delivered none; the disposition
  // is decided by `dagRes.status` (the classifier's verdict, `poll.js:51`), never re-derived from
  // the body, and NO `okBody(res, fallback)` helper may be introduced — its natural call here is
  // byte-for-byte the defect. Two arms, and the one question that picks between them is whether
  // this surface already holds a successful paint of the CURRENT subject (`state.selectedRunId`).
  if (dagRes.status !== 'ok') {
    // (K) poll tick, subject unchanged since the last successful paint → no DOM write derived from
    // the non-`ok` route at all: the last-known figure and summary stay on screen and the nav tag
    // is what reports the fault (ARCH-124). Both statuses still reach `nextConnection`.
    if (state.paintedRunId === state.selectedRunId) return statuses;
    // (U) first paint, or the selection changed → clear and paint the explicit component. Keeping
    // the PREVIOUS run's graph under a newly selected chip is a worse lie than a blank, which is
    // why a bare copy of `run.js:475`'s bail is wrong here (that view renders ONE run for the life
    // of the page and has no selection).
    paintFigureUnavailable(shell, t(lang, 'unavailable'));
    return statuses;
  }
  const payload = dagRes.body;
  const agentsById = new Map(((viewRes.body && viewRes.body.agents) || []).map((a) => [a.agentId, a]));
  paintSwimlane(shell.svgEl, payload, { lang, pAgents, agentsById, onSelectAgent });
  renderLegend(shell.legend, payload, viewRes.status === 'ok' ? viewRes.body : null, lang);
  // Paint memory, DES-206: set ONLY by an `ok` route result reaching a paint function — never by
  // `render()`, whose first paint is an EMPTY SHELL, and an empty shell is not a paint. Without
  // that rule the (K) arm above would "keep" something no route ever produced. (The clause's own
  // wording for this uses the C3 word, which may not appear anywhere under `src/**` — UT-115.)
  state.paintedRunId = state.selectedRunId;
  return statuses;
}

export function render(container, vm, handlers) {
  const name = (vm && vm.name) || null;
  const lang = currentLang();
  const shell = buildShell(container);
  if (!name) return;
  // `paintedRunId` is DES-206's paint memory: null here because `render()` paints an EMPTY SHELL,
  // and an empty shell is not a paint — only `paintSelected`'s `ok` branch may write it.
  stateByContainer.set(container, { shell, name, lang, handlers: handlers || {}, selectedRunId: null, paintedRunId: null, diagramKey: null, diagramUrl: null });
}

/** DES-206 [v27c] — `app.js`'s one timer calls this every ~3s with `endpointsFor('workflow', ctx)`'s
 *  freshly-fetched bodies (describe + `/api/runs`); the selected run's own `/dag` + `/api/runs/:id`
 *  fetch is made here (state-dependent — which run is selected lives in this view) and its statuses
 *  are returned for the caller to fold in. */
export async function onTick(container, bodies, ctx, tick) {
  const state = stateByContainer.get(container);
  if (!state || !state.shell.root.isConnected) return {};
  const lang = state.lang;
  const [describeUrl, runsUrl] = endpointsFor('workflow', ctx);
  const describe = bodies[describeUrl];
  // [v27c AC-4 Gate 8 repair] a degraded body is `{runs:[], degraded: '...'}` on EITHER route
  // (server.ts:611-617's shared catch-all) — an object, never the array `/api/runs` answers on
  // success. Bail before touching either body: DES-018's "never rendered as data" for this view
  // means skipping this tick's repaint (last-known render stays), not painting an empty/predicted
  // state over a transient degrade. Without the `Array.isArray` guard, `nameFilteredRuns` fed that
  // object threw `TypeError: allRuns.filter is not a function` (ARCH-124's api, AC-4).
  if (!describe || describe.degraded || !Array.isArray(bodies[runsUrl])) {
    if (tick && tick.source === 'demo') paintRouteUnfounded(state, t(lang, 'noDemoData'));
    return {};
  }
  const runs = nameFilteredRuns(bodies[runsUrl], state.name);
  renderHeader(state.shell, describe, lang);
  // Resolve the default selection BEFORE the first chip/table render — otherwise tick 1 paints
  // with no `.is-selected` at all and a caller reading the page between tick 1 and 2 (val-199's
  // SPEC_ROWS case) sees no selected chip/row.
  if (runs.length > 0) resolveSelectedRunId(state, runs);
  function onPick(runId) {
    state.selectedRunId = runId;
    renderChipsAndTable(state.shell, runs, state.selectedRunId, lang, onPick);
    paintSelected(state, runs, describe, lang);
  }
  renderChipsAndTable(state.shell, runs, state.selectedRunId, lang, onPick);
  const extra = await paintSelected(state, runs, describe, lang);
  if (!state.shell.root.isConnected) return extra;
  await loadDiagram(state, describe, lang);
  return extra;
}
