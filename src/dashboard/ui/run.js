// src/dashboard/ui/run.js
// DES-206/203, ARCH-125/120, TASK-210, REQ-134/129 — the swimlane painter (`paintSwimlane`,
// exported so `ui/workflow.js` can reuse it for a workflow's own run figure and its never-run
// predicted overlay — DES-206: "the swimlane painter... reused by TASK-209") and the zoom/pan/fit
// contract ported VERBATIM from the pre-v27 inline script (`initZoomable`,
// dashboard-page.ts:693-716 at commit d8d5ef9) so REQ-129's real-mouse proof does not regress.
//
// [v27c] `onTick(container, bodies, ctx)` (DES-206) replaces this view's own `setTimeout` loop:
// `app.js`'s one timer fetches `endpointsFor('run', ctx)` (the `/dag` body) every ~3s and hands it
// here; the run's own `/api/runs/:id` (status + usage) is a second, state-INdependent fetch that
// `poll.js`'s `ROUTES.run` does not list (a design choice of that file, not editable here), so it
// is made here via `getJSON` and its status is returned for `app.js` to fold in.
//
// DEFERRED (reported — see the implementer's needs_clarification): DES-209's substrate migration —
// the lane headers / trigger / agent cells / legend moving off `#dag-graph`'s SVG onto an HTML
// `.cell-layer` sibling inside `#dag-zoom`, with the 12 hex literals / `letter-spacing` /
// `.toUpperCase()` / container px replaced by DES-209 STYLE_HOOKS classes — is NOT done in this
// commit. TASK-214 (the stylesheet: `.cell` `216px`/`74px`, `.cell.is-failed`, `.lane-head`, the
// `@keyframes`, …) has not landed on this tree yet (measured: `dashboard.css` is still the pre-v27c
// ported file, with a header comment naming this exact class layer "NOT built here"; no
// `tests/fixtures/dashboard-classes.ts` on disk). Migrating the DOM now would (a) size the new
// `.cell` divs against CSS rules that do not exist, sending val-200's 216×74 assertion red for a
// missing-dependency reason rather than a real defect, and (b) break val-193's own THIRD case
// (`#dag-graph text` — the per-cell token/cost line, D8/REQ-127's non-regression), which is scoped
// to text nodes inside the SVG and would need its own re-point that DES-209 does not authorize.
// The two `val-200` SELECTOR edits DES-209 does explicitly authorize (`#dag-zoom [data-node-cell]`,
// dropping the `[class*="lane-head"]` alternate) are applied below — both already match the current
// SVG markup (`#dag-graph` is a descendant of `#dag-zoom`; the header carries `data-lane-header`,
// never a `lane-head*` class), so they are safe ahead of the substrate change itself.
import { SWIMLANE_BOX, cellRect, svgBox, edgePath } from '../lib/swimlane.js';
import { sumTokens, fmtCost } from '../lib/runlist.js';
import { t, warningText } from '../lib/strings.js';
import { endpointsFor, getJSON } from './poll.js';

const NS = 'http://www.w3.org/2000/svg';

export function currentLang() {
  return document.documentElement.lang === 'en' ? 'en' : 'zh';
}

// ---- zoom/pan/fit — ported verbatim (var->const/let only) from the pre-v27 inline script. The
// transform lives on `el` (the WRAPPER); `el`'s own children are rebuilt wholesale by
// `paintSwimlane` every poll tick, so a user's zoom survives the rebuild (D6/INV-V27-6). ----
export function initZoomable(el, fitBtn) {
  let scale = 1, tx = 0, ty = 0;
  const apply = () => { el.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; };
  const fit = () => { scale = 1; tx = 0; ty = 0; apply(); };
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const next = Math.min(4, Math.max(0.25, scale * (e.deltaY < 0 ? 1.1 : 0.9)));
    tx = mx - (mx - tx) * (next / scale); ty = my - (my - ty) * (next / scale);
    scale = next; apply();
  }, { passive: false });
  let dragging = false, sx = 0, sy = 0, stx = 0, sty = 0;
  // v26 Gate 7.5 round 3 (D10): preventDefault() kills the browser's default press action (native
  // image drag, text/selection drag) without cancelling the later click — node cells stay clickable.
  el.addEventListener('mousedown', (e) => { e.preventDefault(); dragging = true; sx = e.clientX; sy = e.clientY; stx = tx; sty = ty; });
  window.addEventListener('mousemove', (e) => { if (!dragging) return; tx = stx + (e.clientX - sx); ty = sty + (e.clientY - sy); apply(); });
  window.addEventListener('mouseup', () => { dragging = false; });
  if (fitBtn) fitBtn.onclick = fit;
  window.addEventListener('resize', fit);
  fit();
}

// The server's `LayoutCell` carries `col`/`row` (col = laneIdx+1, trigger at col 0; row = the
// slot ordinal within that lane — `dashboard.ts`'s own `placeCell`), never `lane`/`slot` — the
// swimlane geometry lib (DES-203) is the client's own successor shape. Map before every
// `svgBox`/`cellRect` call.
function toSwimlaneCell(cell) {
  return { ...cell, lane: cell.col - 1, slot: cell.row };
}

function triggerRect(box) {
  return { x: box.PAD, y: box.PAD + box.HEAD_H + (box.CELL_H - 40) / 2, w: box.TRIG_W, h: 40 };
}

const STATE_FILL = { queued: '#3a3d33', running: '#2a3540', done: '#2c362b', completed: '#2c362b', failed: '#3a2b28', stopped: '#33322b', suspended: '#33322b', interrupted: '#3a3d33' };
const FAILED_COLOR = 'oklch(0.55 0.16 25)';

/** Paints one swimlane graph into `svgEl` (a `<svg>` element the caller owns — never looked up by
 *  id, so `ui/workflow.js` can reuse this for its own embedded figure). Pure DOM builder: no
 *  fetch, no I/O. `payload` is the `/api/runs/:id/dag` route's own shape ({cells, edges, warnings,
 *  lanes, current, startedBy}) OR a synthetic never-run overlay built the same way from
 *  `describe.phases[].agents` (TASK-209). A predicted cell is `kind==='agent' && agentId ===
 *  undefined` — never `agentId === undefined` alone (the trigger cell also carries no agentId) —
 *  and falls back to no label text rather than the kind word. */
export function paintSwimlane(svgEl, payload, opts) {
  const lang = (opts && opts.lang) || currentLang();
  const box = SWIMLANE_BOX;
  const cells = Array.isArray(payload.cells) ? payload.cells : [];
  const edges = Array.isArray(payload.edges) ? payload.edges : [];
  const lanes = Array.isArray(payload.lanes) ? payload.lanes : [];
  const current = payload.current ?? null;
  const agentSwimCells = cells.filter((c) => c.kind !== 'trigger').map(toSwimlaneCell);
  const laneCount = Math.max(lanes.length, agentSwimCells.reduce((m, c) => Math.max(m, c.lane + 1), 0));
  const dims = svgBox(agentSwimCells, laneCount, box);

  // Native-scale SVG: the wrapper is sized to the SAME pixels as the viewBox (1 svg unit === 1 CSS
  // px), so the pan/zoom transform on the wrapper (initZoomable) is the only thing that ever
  // scales the graph — a node's OWN rendered size stays REQ-134's 216x74 regardless of viewport.
  const wrap = svgEl.parentElement;
  if (wrap) { wrap.style.width = dims.width + 'px'; wrap.style.height = dims.height + 'px'; }
  svgEl.setAttribute('viewBox', '0 0 ' + dims.width + ' ' + dims.height);
  svgEl.setAttribute('width', '100%');
  svgEl.setAttribute('height', '100%');
  svgEl.setAttribute('preserveAspectRatio', 'xMinYMin meet');
  svgEl.replaceChildren();

  const rectOf = new Map();
  for (const c of cells) rectOf.set(c.id, c.kind === 'trigger' ? triggerRect(box) : cellRect(toSwimlaneCell(c), box));

  // Lane headers (uppercase, current lane accented + tagged) and one vertical hairline per lane.
  for (let i = 0; i < laneCount; i++) {
    const laneMeta = lanes[i];
    const x = box.PAD + box.TRIG_W + i * (box.LANE_W + box.LANE_GAP);
    const isCurrent = i === current;

    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', String(x)); line.setAttribute('x2', String(x));
    line.setAttribute('y1', String(box.PAD)); line.setAttribute('y2', String(dims.height - box.PAD));
    line.setAttribute('stroke', '#34363c'); line.setAttribute('stroke-width', '1');
    svgEl.appendChild(line);

    const head = document.createElementNS(NS, 'text');
    head.setAttribute('data-lane-header', '');
    head.setAttribute('x', String(x));
    head.setAttribute('y', String(box.PAD + box.HEAD_H / 2 + 4));
    head.setAttribute('font-size', '13');
    head.setAttribute('font-weight', '600');
    head.setAttribute('style', 'letter-spacing:.04em');
    head.setAttribute('fill', isCurrent ? '#9fb8d6' : '#8e97a3');
    const title = ((laneMeta && laneMeta.title) || t(lang, 'laneUntitled')).toUpperCase();
    head.textContent = isCurrent ? title + ' · ' + (lang === 'zh' ? '目前' : 'current') : title;
    svgEl.appendChild(head);
  }

  // Edges — a cubic bezier from the source's right-mid to the target's left-mid; dashed into a
  // pending/queued or predicted (inert) target.
  for (const e of edges) {
    const fr = rectOf.get(e.from), to = rectOf.get(e.to);
    if (!fr || !to) continue;
    const toCell = cells.find((c) => c.id === e.to);
    const pending = !!toCell && (toCell.state === 'queued' || (toCell.kind === 'agent' && toCell.agentId === undefined));
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', edgePath(fr, to));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-width', '1.2');
    path.setAttribute('stroke', pending ? '#5b6068' : '#8e97a3');
    if (pending) path.setAttribute('stroke-dasharray', '4 4');
    svgEl.appendChild(path);
  }

  // Nodes: the trigger cell (112x40, transparent), then every agent cell (216x74).
  for (const c of cells) {
    const r = rectOf.get(c.id);
    if (c.kind === 'trigger') {
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', String(r.x)); rect.setAttribute('y', String(r.y));
      rect.setAttribute('width', String(r.w)); rect.setAttribute('height', String(r.h));
      rect.setAttribute('rx', '3'); rect.setAttribute('fill', 'transparent'); rect.setAttribute('stroke', '#34363c');
      svgEl.appendChild(rect);
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', String(r.x + 8)); label.setAttribute('y', String(r.y + r.h / 2 + 4));
      label.setAttribute('font-size', '11'); label.setAttribute('fill', '#8e97a3');
      label.textContent = c.label || '';
      svgEl.appendChild(label);
      continue;
    }

    const predicted = c.kind === 'agent' && c.agentId === undefined;
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('data-node-cell', '');
    rect.setAttribute('x', String(r.x)); rect.setAttribute('y', String(r.y));
    rect.setAttribute('width', String(r.w)); rect.setAttribute('height', String(r.h));
    rect.setAttribute('rx', '3');
    rect.setAttribute('fill', predicted ? 'transparent' : (STATE_FILL[c.state] || '#292a2f'));
    rect.setAttribute('stroke', predicted ? '#4a4d55' : (c.state === 'failed' ? FAILED_COLOR : '#34363c'));
    if (predicted) { rect.setAttribute('stroke-dasharray', '4 4'); rect.setAttribute('opacity', '.65'); }
    if (c.agentId) {
      rect.style.cursor = 'pointer';
      const agentId = c.agentId, label = c.label;
      rect.addEventListener('click', () => { if (opts && opts.onSelectAgent) opts.onSelectAgent(agentId, label); });
    }
    svgEl.appendChild(rect);

    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', String(r.x + 12)); dot.setAttribute('cy', String(r.y + 14)); dot.setAttribute('r', '4');
    dot.setAttribute('fill', predicted ? 'none' : (c.state === 'failed' ? FAILED_COLOR : '#e7e9ec'));
    dot.setAttribute('stroke', predicted ? '#4a4d55' : 'none');
    svgEl.appendChild(dot);

    // A predicted cell renders its OWN label when present and falls back to NOTHING rather than
    // the kind word "agent" (DES-206's v27b rule).
    if (c.label) {
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', String(r.x + 22)); label.setAttribute('y', String(r.y + 18));
      label.setAttribute('font-size', '13.5'); label.setAttribute('font-weight', '600'); label.setAttribute('fill', '#e7e9ec');
      label.textContent = c.label;
      svgEl.appendChild(label);
    }
    // Per-call cost attribution (M-4 send-back repair, ARCH-118, REQ-127) — present only on a LIVE
    // agent cell that carries tokens, never on a predicted/inert cell (no dispatched call yet).
    if (!predicted && c.tokens) {
      const usageLine = document.createElementNS(NS, 'text');
      usageLine.setAttribute('x', String(r.x + 12)); usageLine.setAttribute('y', String(r.y + r.h - 10));
      usageLine.setAttribute('font-size', '10.5'); usageLine.setAttribute('fill', '#8e97a3');
      usageLine.textContent = sumTokens(c.tokens) + ' tok · ' + fmtCost(c.costUSD, c.unpriced ? 1 : 0, lang);
      svgEl.appendChild(usageLine);
    }
  }
}

/** The legend row below the graph: `warnings` rendered as TEXT (`warningText`, D5 — replacing the
 *  old `N warning(s)` badge), plus a right-aligned run summary. `view` is `/api/runs/:id`'s own
 *  body (status + usage) — absent for a never-run workflow's predicted overlay, which renders no
 *  summary. */
export function renderLegend(legendEl, payload, view, lang) {
  legendEl.replaceChildren();
  for (const w of (payload.warnings || [])) {
    const span = document.createElement('span');
    span.textContent = warningText(lang, w);
    legendEl.appendChild(span);
  }
  if (!view) return;
  const nodeCount = (payload.cells || []).filter((c) => c.kind === 'agent' && c.agentId !== undefined).length;
  const usage = view.usage;
  const tok = usage ? sumTokens(usage.tokens) : 0;
  const cost = usage ? fmtCost(usage.costUSD, usage.unpricedCalls, lang) : '—';
  const summary = document.createElement('span');
  summary.style.float = 'right';
  summary.textContent = view.status + ' · ' + nodeCount + (lang === 'zh' ? ' 個節點 · ' : ' nodes · ') + tok + ' tok · ' + cost;
  legendEl.appendChild(summary);
}

/** The `#run-usage` line: the four-column token breakdown (never just the sum, D8/REQ-127) plus
 *  cost, through the one shared `fmtCost` formatter (DES-204). */
export function renderUsageBox(usageEl, runUsage, lang) {
  usageEl.replaceChildren();
  if (!runUsage) return;
  const total = document.createElement('span');
  total.textContent = sumTokens(runUsage.tokens) + ' tok';
  usageEl.appendChild(total);
  const tk = runUsage.tokens || {};
  const cols = document.createElement('span');
  cols.className = 'usage-cols';
  cols.textContent = 'in ' + (tk.input || 0) + ' · out ' + (tk.output || 0) + ' · cache read ' + (tk.cacheRead || 0) + ' · cache write ' + (tk.cacheWrite || 0);
  usageEl.appendChild(cols);
  const cost = document.createElement('span');
  cost.textContent = fmtCost(runUsage.costUSD, runUsage.unpricedCalls, lang);
  usageEl.appendChild(cost);
  if (runUsage.unpricedCalls > 0) {
    const lb = document.createElement('span');
    lb.className = 'usage-lowerbound';
    lb.textContent = lang === 'zh' ? '(下限)' : '(lower bound)';
    usageEl.appendChild(lb);
  }
}

function buildShell(container) {
  const root = document.createElement('div');
  root.className = 'run-view';

  const usage = document.createElement('div');
  usage.id = 'run-usage';
  root.appendChild(usage);

  const graphContainer = document.createElement('div');
  graphContainer.style.overflow = 'hidden';
  graphContainer.style.height = '420px';
  graphContainer.style.margin = '10px 0';

  const fitBtn = document.createElement('button');
  fitBtn.type = 'button';
  fitBtn.id = 'dag-fit';
  fitBtn.className = 'fit-btn';
  fitBtn.textContent = 'Fit';
  graphContainer.appendChild(fitBtn);

  const zoom = document.createElement('div');
  zoom.id = 'dag-zoom';
  zoom.className = 'zoomable';
  // The pannable hit-area must cover the container's visible height even for a small graph (a
  // 2-lane fixture's own svgBox is far shorter than 420px) — `paintSwimlane` sets an exact
  // `height` per graph, but `min-height` still wins when it's the larger of the two, and
  // `preserveAspectRatio="xMinYMin meet"` never upscales past the smaller of the two axis scales,
  // so a short graph keeps its native 1:1 node size and simply top-aligns within the taller box.
  zoom.style.minHeight = '380px';
  const svgEl = document.createElementNS(NS, 'svg');
  svgEl.id = 'dag-graph';
  zoom.appendChild(svgEl);
  graphContainer.appendChild(zoom);
  root.appendChild(graphContainer);

  const legend = document.createElement('div');
  legend.setAttribute('data-legend', '');
  root.appendChild(legend);

  container.replaceChildren(root);
  initZoomable(zoom, fitBtn);
  return { root, usage, svgEl, legend };
}

const stateByContainer = new WeakMap();

// container -> the shell's own root element, so a stale poll loop (an old route's) can detect it
// was superseded once app.js replaces #app-view's children — `root.isConnected` goes false then.
export function render(container, vm, handlers) {
  const runId = (vm && vm.runId) || null;
  const lang = currentLang();
  const shell = buildShell(container);
  if (!runId) return;
  stateByContainer.set(container, { shell, runId, lang, handlers: handlers || {} });
}

/** DES-206 [v27c] — `app.js`'s one timer calls this every ~3s with `endpointsFor('run', ctx)`'s
 *  freshly-fetched `/dag` body; `/api/runs/:id` (status + usage) is a second fetch made here (see
 *  this file's banner) and its status is returned for the caller to fold in. */
export async function onTick(container, bodies, ctx) {
  const state = stateByContainer.get(container);
  if (!state || !state.shell.root.isConnected) return {};
  const [dagUrl] = endpointsFor('run', ctx);
  const viewUrl = '/api/runs/' + encodeURIComponent(state.runId);
  const viewRes = await getJSON(viewUrl);
  if (!state.shell.root.isConnected) return { [viewUrl]: viewRes.status };
  const payload = bodies[dagUrl] || { cells: [], edges: [], warnings: [], lanes: [], current: null };
  paintSwimlane(state.shell.svgEl, payload, { lang: state.lang, onSelectAgent: state.handlers.onSelectAgent });
  renderLegend(state.shell.legend, payload, viewRes.body, state.lang);
  renderUsageBox(state.shell.usage, viewRes.body && viewRes.body.usage, state.lang);
  return { [viewUrl]: viewRes.status };
}
