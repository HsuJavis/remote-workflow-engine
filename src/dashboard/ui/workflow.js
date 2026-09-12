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
import { paintSwimlane, renderLegend, initZoomable, currentLang } from './run.js';
import { endpointsFor, getJSON } from './poll.js';
import { historyRow } from '../lib/runlist.js';
import { t } from '../lib/strings.js';

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

  const h2 = document.createElement('h2');
  root.appendChild(h2);
  const versionTag = document.createElement('span');
  versionTag.className = 'tag';
  root.appendChild(versionTag);
  const execTag = document.createElement('span');
  execTag.className = 'tag';
  root.appendChild(execTag);
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
  graphContainer.style.overflow = 'hidden';
  graphContainer.style.height = '340px';
  graphContainer.style.margin = '10px 0';
  const zoom = document.createElement('div');
  zoom.className = 'zoomable';
  zoom.style.minHeight = '300px'; // see run.js's own comment: keeps the pan hit-area filling the
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
  return { root, h2, versionTag, execTag, desc, triggers, predictedLabel, svgEl, legend, chips, tbody, diagramZoom, img, diagramFit, pre, note };
}

function renderHeader(shell, describe, lang) {
  shell.h2.textContent = describe.name;
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
    const dot = document.createElement('span');
    dot.textContent = '●';
    dot.className = 'status-dot'; // DES-209 STYLE_HOOKS — the 7px size moves to the stylesheet.
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(' ' + r.runId.slice(0, 8)));
    chip.addEventListener('click', () => onPick(r.runId));
    shell.chips.appendChild(chip);
  }

  shell.tbody.replaceChildren();
  const now = new Date().toISOString();
  for (const r of sorted) {
    const tr = document.createElement('tr');
    if (r.runId === selectedRunId) tr.className = 'is-selected'; // DES-209: `tr.is-selected` in the stylesheet.
    for (const cell of historyRow(r, now, lang)) {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    }
    tr.addEventListener('click', () => onPick(r.runId));
    shell.tbody.appendChild(tr);
  }
}

function nameFilteredRuns(allRuns, name) {
  return (allRuns || []).filter((r) => r.name === name);
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

/** Paints the selected (or predicted) figure; returns the state-dependent fetch statuses (the
 *  selected run's own `/dag` + `/api/runs/:id`) for `onTick` to fold into the connection reducer —
 *  `{}` for the no-runs/predicted branch, which makes no such fetch. */
async function paintSelected(state, runs, describe, lang) {
  const shell = state.shell;
  if (runs.length === 0) {
    const { payload, anyAgentsKey } = predictedPayload(describe);
    paintSwimlane(shell.svgEl, payload, { lang });
    renderLegend(shell.legend, payload, null, lang);
    shell.predictedLabel.textContent = anyAgentsKey
      ? t(lang, 'predictedLayout')
      : t(lang, 'predictedLayout') + ' — ' + t(lang, 'predictedLayoutUnavailable');
    return {};
  }
  shell.predictedLabel.textContent = '';
  if (!state.selectedRunId || !runs.some((r) => r.runId === state.selectedRunId)) {
    const active = runs.find((r) => r.status === 'running' || r.status === 'queued');
    state.selectedRunId = active ? active.runId : [...runs].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0].runId;
  }
  const dagUrl = '/api/runs/' + encodeURIComponent(state.selectedRunId) + '/dag';
  const viewUrl = '/api/runs/' + encodeURIComponent(state.selectedRunId);
  const [dagRes, viewRes] = await Promise.all([getJSON(dagUrl), getJSON(viewUrl)]);
  const payload = dagRes.body || { cells: [], edges: [], warnings: [], lanes: [], current: null };
  paintSwimlane(shell.svgEl, payload, { lang });
  renderLegend(shell.legend, payload, viewRes.body, lang);
  return { [dagUrl]: dagRes.status, [viewUrl]: viewRes.status };
}

export function render(container, vm, handlers) {
  const name = (vm && vm.name) || null;
  const lang = currentLang();
  const shell = buildShell(container);
  if (!name) return;
  stateByContainer.set(container, { shell, name, lang, selectedRunId: null, diagramKey: null, diagramUrl: null });
}

/** DES-206 [v27c] — `app.js`'s one timer calls this every ~3s with `endpointsFor('workflow', ctx)`'s
 *  freshly-fetched bodies (describe + `/api/runs`); the selected run's own `/dag` + `/api/runs/:id`
 *  fetch is made here (state-dependent — which run is selected lives in this view) and its statuses
 *  are returned for the caller to fold in. */
export async function onTick(container, bodies, ctx) {
  const state = stateByContainer.get(container);
  if (!state || !state.shell.root.isConnected) return {};
  const lang = state.lang;
  const [describeUrl, runsUrl] = endpointsFor('workflow', ctx);
  const describe = bodies[describeUrl];
  if (!describe) return {};
  const runs = nameFilteredRuns(bodies[runsUrl], state.name);
  renderHeader(state.shell, describe, lang);
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
