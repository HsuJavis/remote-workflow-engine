// src/dashboard/ui/run.js
// DES-206/203/209, ARCH-125/120, TASK-210, REQ-134/129 — the swimlane painter (`paintSwimlane`,
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
// [v27c] DES-209 boundary (1) SUBSTRATE migration, now landed: `#dag-graph` keeps ONLY the lane
// hairlines and the edges (SVG, `viewBox` + native scale unchanged — val-193's fit/zoom proof,
// case 1, and val-200's own dims math are untouched); the lane headers, the trigger and every agent
// cell moved to HTML — a sibling `<div class="cell-layer">` inside `#dag-zoom`, found-or-created
// HERE (never by the caller), so `ui/workflow.js`'s own `paintSwimlane(shell.svgEl, ...)` call gets
// the substrate for free with NO edit to that file (out of this task's `files:`). Cells/headers are
// positioned via `style.transform: translate(x,y)` rather than `left`/`top`: an absolutely
// positioned element with no `top`/`left` collapses to (0,0) of its containing block, and `#dag-zoom`
// already carries a non-`none` transform from `initZoomable`'s own `fit()` (armed before first
// paint) — which is what makes it the containing block for `.cell-layer`'s `position:absolute`
// descendants, with no extra `position` write needed. This reads `style.transform` more broadly
// than DES-209(2)'s prose ("on `#dag-zoom`/`#diagram-zoom`") — recorded as an explicit
// interpretation in 06-impl-log.md, not a silent stretch. One delegated click listener on
// `.cell-layer` (DES-206: "listeners are delegated on stable wrappers, or a tab open for days
// accumulates one handler per node per 3-second rebuild"), attached once at creation and re-armed
// with the current `onSelectAgent` on every paint.
//
// [v27 seam closure] The two model/effort per-cell STYLE_HOOKS (DES-209's swimlane row) are now
// emitted — corrected per the orchestrator's binding note in `state.yaml` (a prior pass wrongly
// concluded this needed a new `AgentRecord` wire field; it needs a client-side JOIN instead, of two
// ALREADY-fetched things, never a wire shape change): the APPLIED model rides on the run view's own
// `agents[]` (`RunStatusView.agents`, `onTick` already fetches it for `renderUsageBox`), joined here
// by `c.agentId`; the DECLARED default (used as the model FALLBACK, and as the ONLY source for
// effort — `AgentRecord` carries no applied-effort field at all) comes from the workflow `describe`
// route's own `params.agents[label]` (`GET /api/workflows/:name/` + the describe segment). This
// route's own `ctx` carries no
// workflow name (a bookmarked `/dashboard/:runId` URL is legacy-compatible and name-free, `app.js`'s
// own routing comment) and neither the `/dag` nor the `/api/runs/:id` body carries one either — so
// `onTick` resolves it ONCE from the EXISTING `/api/runs` list (never a new field on any wire shape)
// and caches it, the same one-time-per-key pattern `ui/workflow.js`'s own `diagramKey` uses.
// `ui/workflow.js` already has `describe` in scope for its own call into `paintSwimlane`, so it
// passes `pAgents` straight through with no such resolution needed.
//
// The graph container's own inline sizing is also moved to the stylesheet this pass: a `.graph-
// frame` class (`dashboard.css`/`dashboard-classes.ts`, DES-209 boundary (2)) carries what
// `buildShell` used to set as element properties directly. No handoff spec exists for the actual
// numbers (measured: the handoff's own graph wrapper scrolls with the browser's native overflow and
// sizes itself from the live `gW`/`gH`, with no fixed box and no pan/zoom at all — it predates
// REQ-129), so the pre-existing per-view figures are kept verbatim, only relocated.
//
// REPORTED, not fixed here (outside this file's `files:` — see the implementer's report to the
// orchestrator for the full detail):
// 1. RESOLVED — `val-193-dag-fit-and-columns.test.ts`'s third case was re-pointed to `.cell-usage`
//    by the tests/verifier gate per the orchestrator's v27 authorization (state.yaml); confirmed on
//    disk, no longer open.
// 2. RESOLVED — `.cell-dot` now carries a per-state `background`/`border` (dashboard.css's own
//    comment above `.cell-dot`); no change needed in this file, the dot element already carries no
//    inline style and relies entirely on the `.cell.is-*` class already set by `cellClassName()`.
//
// [v27 Gate 6 fix pass, VAL-208] The row-grouping defect VAL-208 reported (`.cell`'s five children
// flex-shrunk into illegible slivers) is fixed this pass — see `.cell-head`/`.cell-meta` below and
// `dashboard.css`. Item 3 above (no `shortModel` formatter) is also fixed — see `lib/model.js` and
// its use in row 2 below.
import { SWIMLANE_BOX, cellRect, svgBox, edgePath } from '../lib/swimlane.js';
import { sumTokens, fmtCost, fmtTok } from '../lib/runlist.js';
import { t, warningText } from '../lib/strings.js';
import { shortModel } from '../lib/model.js';
import { endpointsFor, getJSON } from './poll.js';
import { openAgentPanel } from './agent-panel.js';
// `ui/home.js`'s own duration formatter (README "1. Workflows home" avg-duration meta line) — a
// SECOND private copy of `lib/runlist.js`'s `${m}m ${s}s` core; reused here rather than adding a
// third/fourth (v27 README-fidelity closure, node-cell row 3's duration).
import { formatDuration } from './home.js';

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

// Literal-string lookups only (DES-208's whole-token guard reads the SOURCE text, not a runtime
// concatenation — `'is-' + state` would never spell "is-done" out as contiguous characters here).
const CELL_STATE_CLASS = { running: 'is-running', done: 'is-done', failed: 'is-failed', queued: 'is-queued' };
const EDGE_STATE_CLASS = { running: 'is-active', done: 'is-walked' };

function cellClassName(c, predicted) {
  if (predicted) return 'cell is-predicted';
  const modifier = CELL_STATE_CLASS[c.state];
  // `refused` (AgentRecord.state) and any other unmapped state get the base `.cell` — DES-206's
  // "no third node style" rule: REQ-134 names running/done/failed/queued, nothing else.
  return modifier ? 'cell ' + modifier : 'cell';
}

function edgeClassName(toCell, predictedTarget) {
  if (predictedTarget || (toCell && toCell.state === 'queued')) return 'edge is-pending';
  const modifier = toCell && EDGE_STATE_CLASS[toCell.state];
  return modifier ? 'edge ' + modifier : 'edge';
}

/** Finds or creates the `.cell-layer` HTML sibling of `svgEl` inside its own parent (`#dag-zoom`).
 *  Created ONCE per shell (never per tick, so the single click listener stays single — DES-206). */
function ensureCellLayer(wrap) {
  if (!wrap) return null;
  let layer = wrap.querySelector(':scope > .cell-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'cell-layer';
    layer.addEventListener('click', (e) => {
      const cellEl = e.target.closest('[data-node-cell]');
      if (!cellEl || !layer.contains(cellEl) || !cellEl.dataset.agentId) return;
      if (layer.onSelectAgent) layer.onSelectAgent(cellEl.dataset.agentId, cellEl.dataset.agentLabel || '');
    });
    wrap.appendChild(layer);
  }
  return layer;
}

/** Paints one swimlane graph into `svgEl` (a `<svg>` element the caller owns — never looked up by
 *  id, so `ui/workflow.js` can reuse this for its own embedded figure). Pure DOM builder: no
 *  fetch, no I/O. `payload` is the `/api/runs/:id/dag` route's own shape ({cells, edges, warnings,
 *  lanes, current, startedBy}) OR a synthetic never-run overlay built the same way from
 *  `describe.phases[].agents` (TASK-209). A predicted cell is `kind==='agent' && agentId ===
 *  undefined` — never `agentId === undefined` alone (the trigger cell also carries no agentId) —
 *  and falls back to no label text rather than the kind word. `opts.agentsById` (agentId ->
 *  AgentRecord) and `opts.pAgents` (`describe.params.agents`, by label) are both optional and drive
 *  REQ-134 row 2 — see the file banner. */
export function paintSwimlane(svgEl, payload, opts) {
  const lang = (opts && opts.lang) || currentLang();
  // REQ-134 row 2 — `agentsById` (an agentId -> AgentRecord map, from the run's own already-fetched
  // `/api/runs/:id`'s `agents[]`) gives the APPLIED model; `pAgents` (`describe.params.agents`, keyed
  // by LABEL) gives the DECLARED default that backstops it and is the only source for effort at all
  // (no AgentRecord field carries applied effort). Both optional: a caller with neither (there is no
  // real-tier fixture for this yet) still gets '—'/'—' rather than a thrown error.
  const agentsById = (opts && opts.agentsById) || new Map();
  const pAgents = (opts && opts.pAgents) || {};
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
  if (wrap) { wrap.style.width = dims.width + 'px'; wrap.style.height = dims.height + 'px'; } // rwe-allow-style: svgBox
  svgEl.setAttribute('viewBox', '0 0 ' + dims.width + ' ' + dims.height);
  svgEl.setAttribute('width', '100%');
  svgEl.setAttribute('height', '100%');
  svgEl.setAttribute('preserveAspectRatio', 'xMinYMin meet');
  svgEl.replaceChildren();

  const layer = ensureCellLayer(wrap);
  if (layer) { layer.onSelectAgent = opts && opts.onSelectAgent; layer.replaceChildren(); }

  const rectOf = new Map();
  for (const c of cells) rectOf.set(c.id, c.kind === 'trigger' ? triggerRect(box) : cellRect(toSwimlaneCell(c), box));

  // Lane headers (HTML, `.cell-layer`) and one vertical hairline per lane (SVG, `#dag-graph`).
  for (let i = 0; i < laneCount; i++) {
    const laneMeta = lanes[i];
    const x = box.PAD + box.TRIG_W + i * (box.LANE_W + box.LANE_GAP);
    const isCurrent = i === current;

    const line = document.createElementNS(NS, 'line');
    line.setAttribute('class', 'lane-hairline');
    line.setAttribute('x1', String(x)); line.setAttribute('x2', String(x));
    line.setAttribute('y1', String(box.PAD)); line.setAttribute('y2', String(dims.height - box.PAD));
    svgEl.appendChild(line);

    if (layer) {
      const head = document.createElement('div');
      head.className = isCurrent ? 'lane-head is-current' : 'lane-head';
      head.setAttribute('data-lane-header', '');
      head.style.transform = 'translateX(' + x + 'px)';
      // `.lane-head`'s own `text-transform:uppercase` does the case fold — never `.toUpperCase()`.
      const title = (laneMeta && laneMeta.title) || t(lang, 'laneUntitled');
      head.textContent = isCurrent ? title + ' · ' + (lang === 'zh' ? '目前' : 'current') : title;
      layer.appendChild(head);
    }
  }

  // Edges — a cubic bezier from the source's right-mid to the target's left-mid; a class carries
  // colour/dash (`.edge`/`.is-active`/`.is-walked`/`.is-pending`), only `d` stays an attribute
  // (geometry from DATA, not design).
  for (const e of edges) {
    const fr = rectOf.get(e.from), to = rectOf.get(e.to);
    if (!fr || !to) continue;
    const toCell = cells.find((c) => c.id === e.to);
    const predictedTarget = !!toCell && toCell.kind === 'agent' && toCell.agentId === undefined;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('class', edgeClassName(toCell, predictedTarget));
    path.setAttribute('d', edgePath(fr, to));
    svgEl.appendChild(path);
  }

  // Nodes: the trigger cell (112x40), then every agent cell (216x74) — all HTML, `.cell-layer`.
  if (layer) {
    for (const c of cells) {
      const r = rectOf.get(c.id);
      if (c.kind === 'trigger') {
        const cellEl = document.createElement('div');
        cellEl.className = 'cell cell-trigger';
        cellEl.style.transform = 'translate(' + r.x + 'px,' + r.y + 'px)';
        const label = document.createElement('span');
        label.className = 'cell-label';
        label.textContent = c.label || '';
        cellEl.appendChild(label);
        layer.appendChild(cellEl);
        continue;
      }

      const predicted = c.kind === 'agent' && c.agentId === undefined;
      const cellEl = document.createElement('div');
      cellEl.className = cellClassName(c, predicted);
      cellEl.setAttribute('data-node-cell', '');
      cellEl.style.transform = 'translate(' + r.x + 'px,' + r.y + 'px)';
      if (c.agentId) {
        cellEl.dataset.agentId = c.agentId;
        cellEl.dataset.agentLabel = c.label || '';
      }

      // Row 1 — status dot + label, grouped (VAL-208 fix: was 5 flat `.cell` column siblings,
      // REQ-134 specifies 3 grouped rows — see dashboard.css's `.cell-head` comment).
      const head = document.createElement('div');
      head.className = 'cell-head';
      cellEl.appendChild(head);

      const dot = document.createElement('span');
      dot.className = 'cell-dot';
      head.appendChild(dot);

      // A predicted cell renders its OWN label when present and falls back to NOTHING rather than
      // the kind word "agent" (DES-206's v27b rule).
      if (c.label) {
        const label = document.createElement('span');
        label.className = 'cell-label';
        label.textContent = c.label;
        head.appendChild(label);
      }

      // Row 2 — model short name + effort tag (see this file's own banner for the join).
      const rec = c.agentId ? agentsById.get(c.agentId) : null;
      const declared = pAgents[c.label] || {};
      const model = (rec && rec.model) || (declared.model && declared.model.default);
      const effort = declared.effort && declared.effort.default;
      const meta = document.createElement('div');
      meta.className = 'cell-meta';
      cellEl.appendChild(meta);
      const modelEl = document.createElement('span');
      modelEl.className = 'cell-model';
      modelEl.textContent = model ? shortModel(model) : '—';
      meta.appendChild(modelEl);
      const effortEl = document.createElement('span');
      effortEl.className = 'tag tag-neutral cell-effort';
      effortEl.textContent = effort || '—';
      meta.appendChild(effortEl);

      // Per-call cost attribution (M-4 send-back repair, ARCH-118, REQ-127) — present only on a
      // LIVE agent cell that carries tokens, never on a predicted/inert cell (no dispatched call
      // yet).
      if (!predicted && c.tokens) {
        const usageLine = document.createElement('span');
        usageLine.className = 'cell-usage';
        // README node-cell row 3: `52k tok · $0.31 · 2m 10s` — duration appended only once both
        // endpoints exist (`durationMs`, v27 README-fidelity closure); omitted rather than a
        // fabricated "—" for a call still in flight, same convention row 3's own tokens/cost gate
        // already follows above.
        const duration = c.durationMs === undefined ? '' : ' · ' + formatDuration(c.durationMs);
        usageLine.textContent = fmtTok(sumTokens(c.tokens)) + ' tok · ' + fmtCost(c.costUSD, c.unpriced ? 1 : 0, lang) + duration;
        cellEl.appendChild(usageLine);
      }

      layer.appendChild(cellEl);
    }
  }
}

/** The legend row below the graph: `warnings` rendered as TEXT (`warningText`, D5 — replacing the
 *  old `N warning(s)` badge), plus a right-aligned run summary. `view` is `/api/runs/:id`'s own
 *  body (status + usage) — absent for a never-run workflow's predicted overlay, which renders no
 *  summary. Sets its own `.legend` class on `legendEl` (idempotent) so `ui/workflow.js`'s own
 *  legend div — built without the class, out of this file's `files:` — gets it too. */
export function renderLegend(legendEl, payload, view, lang) {
  legendEl.className = 'legend';
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
  summary.className = 'run-summary';
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
  usage.className = 'usage-row'; // VAL-208 fix: separates the three sibling spans (dashboard.css).
  root.appendChild(usage);

  const graphContainer = document.createElement('div');
  graphContainer.className = 'graph-frame'; // DES-209 boundary (2) — sizing lives in dashboard.css.

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
  // 2-lane fixture's own svgBox is far shorter than the frame) — `paintSwimlane` sets an exact
  // `height` per graph, but the stylesheet's own minimum for `.zoomable` here still wins when it's
  // the larger of the two, and `preserveAspectRatio="xMinYMin meet"` never upscales past the smaller
  // of the two axis scales, so a short graph keeps its native 1:1 node size and simply top-aligns
  // within the taller box.
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
//
// Wiring (TASK-210/TASK-211 gap, closed here per DES-206): `app.js`'s `mountLazy` is the only
// caller of this `render()` and passes an empty `handlers` object (nothing wires a node click to
// the agent panel yet). `agent-panel.js`'s own header comment names two options; this applies
// option (a) — default `onSelectAgent` here, to `openAgentPanel`, rather than threading it through
// `app.js` (option (b), which is outside this file's scope). A caller-supplied `onSelectAgent`
// still wins, so a future explicit wiring is not shadowed.
export function render(container, vm, handlers) {
  const runId = (vm && vm.runId) || null;
  const lang = currentLang();
  const shell = buildShell(container);
  if (!runId) return;
  const onSelectAgent = (handlers && handlers.onSelectAgent) || ((id, lbl) => openAgentPanel(runId, id, lbl, { lang }));
  stateByContainer.set(container, {
    shell, runId, lang, handlers: { ...(handlers || {}), onSelectAgent },
    // REQ-134 row 2's declared-effort join (see file banner): resolved lazily in `onTick` and
    // cached, since a run's own workflow name never changes over the page's lifetime.
    name: null, pAgents: {}, describeFor: null,
  });
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
  const extra = { [viewUrl]: viewRes.status };

  // REQ-134 row 2's declared-effort join (see file banner) — resolved once, then cached: this
  // route's own `ctx` and both fetched bodies above carry no workflow name, so it comes from the
  // EXISTING `/api/runs` list (never a new field on either wire shape).
  if (!state.name) {
    const runsUrl = '/api/runs';
    const runsRes = await getJSON(runsUrl);
    extra[runsUrl] = runsRes.status;
    const match = Array.isArray(runsRes.body) ? runsRes.body.find((r) => r.runId === state.runId) : null;
    if (match && match.name) state.name = match.name;
  }
  if (state.name && state.describeFor !== state.name) {
    const describeUrl = '/api/workflows/' + encodeURIComponent(state.name) + '/describe';
    const describeRes = await getJSON(describeUrl);
    extra[describeUrl] = describeRes.status;
    if (describeRes.body && describeRes.body.params && describeRes.body.params.agents) {
      state.pAgents = describeRes.body.params.agents;
      state.describeFor = state.name;
    }
  }

  const payload = bodies[dagUrl] || { cells: [], edges: [], warnings: [], lanes: [], current: null };
  const agentsById = new Map(((viewRes.body && viewRes.body.agents) || []).map((a) => [a.agentId, a]));
  paintSwimlane(state.shell.svgEl, payload, {
    lang: state.lang, onSelectAgent: state.handlers.onSelectAgent, agentsById, pAgents: state.pAgents,
  });
  renderLegend(state.shell.legend, payload, viewRes.body, state.lang);
  renderUsageBox(state.shell.usage, viewRes.body && viewRes.body.usage, state.lang);
  return extra;
}
