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
// Same self-rescheduling fetch+repaint caveat as `ui/run.js`: `app.js`'s own tick() does not yet
// dispatch a body to this view — see that file's banner and the implementer's needs_clarification.
import { paintSwimlane, renderLegend, initZoomable, currentLang } from './run.js';
import { endpointsFor, getJSON } from './poll.js';
import { historyRow } from '../lib/runlist.js';
import { t } from '../lib/strings.js';

const NS = 'http://www.w3.org/2000/svg';
const COLUMNS = {
  zh: ['執行ID', '狀態', '版本', '觸發者', '開始時間', '耗時', '節點數', 'Tokens', '費用'],
  en: ['Run ID', 'Status', 'Version', 'Triggered by', 'Started', 'Duration', 'Agents', 'Tokens', 'Cost'],
};

function nameFromPath() {
  const m = /^\/dashboard\/workflow\/([^/]+)\/?$/.exec(location.pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

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
  versionTag.className = 'pill';
  root.appendChild(versionTag);
  const execTag = document.createElement('span');
  execTag.className = 'pill';
  root.appendChild(execTag);
  const desc = document.createElement('p');
  desc.style.maxWidth = '720px';
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
    tag.className = 'pill';
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
    chip.className = 'pill';
    if (r.runId === selectedRunId) chip.dataset.selected = '1';
    const dot = document.createElement('span');
    dot.textContent = '●';
    dot.style.fontSize = '7px';
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(' ' + r.runId.slice(0, 8)));
    chip.addEventListener('click', () => onPick(r.runId));
    shell.chips.appendChild(chip);
  }

  shell.tbody.replaceChildren();
  const now = new Date().toISOString();
  for (const r of sorted) {
    const tr = document.createElement('tr');
    if (r.runId === selectedRunId) tr.style.background = 'rgba(159,184,214,.07)';
    for (const cell of historyRow(r, now, lang)) {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    }
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => onPick(r.runId));
    shell.tbody.appendChild(tr);
  }
}

function nameFilteredRuns(allRuns, name) {
  return (allRuns || []).filter((r) => r.name === name);
}

export function render(container, vm, handlers) {
  const name = nameFromPath();
  const lang = currentLang();
  const shell = buildShell(container);
  if (!name) return;

  let selectedRunId = null;
  let diagramKey = null;
  let diagramUrl = null;

  function hideDiagram() {
    diagramKey = null;
    shell.img.removeAttribute('src');
    shell.diagramZoom.style.display = 'none';
    shell.diagramFit.style.display = 'none';
    if (diagramUrl) { URL.revokeObjectURL(diagramUrl); diagramUrl = null; }
    shell.pre.style.display = 'none';
    shell.note.style.display = 'none';
  }

  async function loadDiagram(describe) {
    if (!describe.mermaid) {
      hideDiagram();
      shell.pre.style.display = 'block';
      shell.pre.textContent = describe.description || '';
      shell.note.style.display = 'block';
      shell.note.textContent = describe.mermaidNote || '';
      return;
    }
    const key = describe.name + '@' + describe.version;
    if (diagramKey === key) return; // fetched once per (name, version) — never once per tick.
    diagramKey = key;
    let res = null;
    try {
      res = await fetch('/api/workflows/' + encodeURIComponent(describe.name) + '/diagram.svg?version=' + encodeURIComponent(describe.version));
    } catch {
      res = null;
    }
    if (res && res.ok) {
      const blob = await res.blob();
      if (diagramUrl) URL.revokeObjectURL(diagramUrl);
      diagramUrl = URL.createObjectURL(blob);
      shell.img.src = diagramUrl;
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

  async function paintSelected(runs, describe) {
    if (runs.length === 0) {
      const { payload, anyAgentsKey } = predictedPayload(describe);
      paintSwimlane(shell.svgEl, payload, { lang });
      renderLegend(shell.legend, payload, null, lang);
      shell.predictedLabel.textContent = anyAgentsKey
        ? t(lang, 'predictedLayout')
        : t(lang, 'predictedLayout') + ' — ' + t(lang, 'predictedLayoutUnavailable');
      return;
    }
    shell.predictedLabel.textContent = '';
    if (!selectedRunId || !runs.some((r) => r.runId === selectedRunId)) {
      const active = runs.find((r) => r.status === 'running' || r.status === 'queued');
      selectedRunId = active ? active.runId : [...runs].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0].runId;
    }
    const [dagRes, viewRes] = await Promise.all([
      getJSON('/api/runs/' + encodeURIComponent(selectedRunId) + '/dag'),
      getJSON('/api/runs/' + encodeURIComponent(selectedRunId)),
    ]);
    const payload = dagRes.body || { cells: [], edges: [], warnings: [], lanes: [], current: null };
    paintSwimlane(shell.svgEl, payload, { lang });
    renderLegend(shell.legend, payload, viewRes.body, lang);
  }

  async function tick() {
    if (!shell.root.isConnected) return;
    const [describeUrl, runsUrl] = endpointsFor('workflow', { name });
    const [describeRes, runsRes] = await Promise.all([getJSON(describeUrl), getJSON(runsUrl)]);
    if (!shell.root.isConnected) return;
    const describe = describeRes.body;
    if (!describe) { setTimeout(tick, 3000); return; }
    const runs = nameFilteredRuns(runsRes.body, name);
    renderHeader(shell, describe, lang);
    function onPick(runId) {
      selectedRunId = runId;
      renderChipsAndTable(shell, runs, selectedRunId, lang, onPick);
      paintSelected(runs, describe);
    }
    renderChipsAndTable(shell, runs, selectedRunId, lang, onPick);
    await paintSelected(runs, describe);
    await loadDiagram(describe);
    if (!shell.root.isConnected) return;
    setTimeout(tick, 3000);
  }
  tick();
}
