// src/dashboard/ui/system.js
// [v28] DES-216, ARCH-133, ARCH-125, ARCH-123, TASK-223, REQ-138 — the System tab REWRITTEN from
// the pre-v28 flat key/value `.sys-table` to four stat cards, a process table (up to 20 rows,
// ARCH-135) and the engine's own `<dl>`. The pure projections (`sectionState`/`cpuUtilState`/
// `statCard`/`procRow`/`procTotals`/`fmtBytes`/`catalogCounts`) come from `lib/system.js`
// (DES-215, TASK-223) — this layer only builds/updates DOM and decides nothing a pure function
// could decide (ARCH-125's own boundary, same split as `ui/models.js`/DES-213-214).
//
// `render(container, vm, handlers)` builds the four card shells, the process `<table>` and the
// engine `<dl>` ONCE — unlike `ui/models.js`'s lazily-built chrome, this shell is fully static (no
// data-dependent columns/labels), so there is no "whole container replaced by the ONE Unavailable
// component" swap for this view: each card independently shows its own value/Unavailable text
// (DES-215's own warning against a single `if (worst !== 'ok')` blanking three good cards).
//
// The ONE genuine route-level V/K/U split (DES-206 rule (V)/(K)/(U), DES-216) is scoped to the
// THREE host cards + process table + engine `<dl>` — all four sourced from `/api/system` alone:
// before that route has EVER answered `ok` (`state.systemPainted === false`), those parts show the
// Unavailable marker; once it has, a later route failure KEEPS the last-known values (no flicker on
// a transient miss). The counts card is the opposite of "keep" ON PURPOSE — ADR-057's fold reads
// `/api/workflows` + `/api/runs` independently of `/api/system`, and the decisive acceptance case
// (val-204) is exactly that ONE of those two failing must blank ONLY the counts card, immediately,
// while the other three keep rendering live numbers from the still-healthy `/api/system` route.
import { sectionState, cpuUtilState, statCard, procRow, procTotals, fmtBytes, catalogCounts } from '../lib/system.js';
import { t } from '../lib/strings.js';
import { el, currentLang } from './dom.js';

const CARD_LABELS = {
  zh: { cpu: 'CPU 使用率', memory: '記憶體使用率', disk: '磁碟使用率', counts: '已儲存工作流程' },
  en: { cpu: 'CPU %', memory: 'Memory %', disk: 'Disk %', counts: 'Workflows stored' },
};

const PROC_HEAD_LABELS = {
  zh: ['PID', '名稱', 'CPU %', '記憶體'],
  en: ['PID', 'Name', 'CPU %', 'Memory'],
};

const ENGINE_DL_LABELS = {
  zh: ['PID', '運行時間', 'CPU %', '記憶體', '執行緒', '檔案描述符'],
  en: ['PID', 'Uptime', 'CPU %', 'Memory', 'Threads', 'File descriptors'],
};

function fmtUptime(sec) {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtCpuPct(cpuPct) {
  return cpuPct == null ? '—' : `${cpuPct.toFixed(1)}%`;
}

// The one fill mechanism the "no design values in JS" guard allows (`.style.transform` only, DES-
// 208/209) — same recipe `ui/models.js:219`'s benchmark bar uses. `pct === undefined` (INV-V28-4:
// the counts card has no denominator, an unavailable section has no number) renders `scaleX(0)`, an
// explicit ABSENT state — never a fabricated full bar, and never left to whatever a missing
// transform would default to.
function setBarPct(barEl, pct) {
  const frac = pct == null ? 0 : Math.max(0, Math.min(1, pct / 100));
  barEl.style.transform = `scaleX(${frac})`;
}

function buildCard(kind, lang) {
  const root = document.createElement('div');
  root.setAttribute('data-sys-stat-card', '');
  root.dataset.card = kind;
  root.appendChild(el('span', 'stat-label', CARD_LABELS[lang][kind]));
  const kicker = kind === 'disk' ? el('span', 'kicker', '') : null;
  if (kicker) root.appendChild(kicker);
  // `.stat-card` (34px/500, README §5) + `.stat-value` (the STYLE_HOOKS/TEST_ANCHORS emitter
  // anchor SPEC_ROWS key on, `[data-sys-stat-card] .stat-value`) on the SAME element: both classes
  // are single-class selectors of equal specificity, so the cascade's normal tie-break (source
  // order) applies — `.stat-card` is declared AFTER `.stat-value` in `dashboard.css` (the pre-
  // existing 18px/600 agent-panel figure, README §「REQ-135 agent panel」), so this figure renders
  // at 34px/500 while still matching the `.stat-value` selector every SPEC_ROW anchor here keys on.
  const value = el('div', 'stat-card stat-value', '—');
  root.appendChild(value);
  const track = el('div', 'stat-track');
  const bar = el('div', 'stat-bar');
  track.appendChild(bar);
  root.appendChild(track);
  const meta = el('div', 'meta', '');
  root.appendChild(meta);
  return { root, kicker, value, track, bar, meta };
}

function paintCard(card, vm) {
  card.value.textContent = vm.value;
  card.meta.textContent = vm.meta != null ? vm.meta : '';
  if (card.kicker) card.kicker.textContent = vm.kicker != null ? vm.kicker : '';
  setBarPct(card.bar, vm.pct);
}

function buildProcRowEls() {
  const tr = document.createElement('tr');
  const tdPid = el('td', undefined, '');
  const tdName = el('td', undefined, '');
  const tdCpu = document.createElement('td');
  const track = el('div', 'stat-track');
  const bar = el('div', 'stat-bar');
  track.appendChild(bar);
  const cpuText = el('span', 'mono', '');
  tdCpu.append(track, cpuText);
  const tdMem = el('td', undefined, '');
  tr.append(tdPid, tdName, tdCpu, tdMem);
  return { tr, tdPid, tdName, tdMem, bar, cpuText };
}

function paintProcRow(rowEls, row) {
  rowEls.tdPid.textContent = String(row.pid);
  // README §5: "the engine's own pid marked ★" — text content (the accent bar is `.proc-self`'s
  // own CSS, applied via the class below).
  rowEls.tdName.textContent = row.isSelf ? `★ ${row.name}` : row.name;
  setBarPct(rowEls.bar, row.cpuPct);
  rowEls.cpuText.textContent = fmtCpuPct(row.cpuPct);
  rowEls.tdMem.textContent = fmtBytes(row.memBytes);
  rowEls.tr.classList.toggle('proc-self', row.isSelf);
}

/** Reconciles `tbodyEl` against `topN` KEYED BY PID (DES-216: "a tick reorders rather than
 *  rebuilds") — an existing row's cells are updated in place and `appendChild`ed into its new
 *  position (which MOVES an already-attached node rather than duplicating it); a pid no longer
 *  present is removed from both the DOM and `procRows`. */
function paintProcTable(state, topN, selfPid) {
  const seen = new Set();
  for (const proc of topN) {
    const row = procRow(proc, selfPid);
    let rowEls = state.procRows.get(row.pid);
    if (!rowEls) {
      rowEls = buildProcRowEls();
      state.procRows.set(row.pid, rowEls);
    }
    paintProcRow(rowEls, row);
    state.tbodyEl.appendChild(rowEls.tr);
    seen.add(row.pid);
  }
  for (const [pid, rowEls] of state.procRows) {
    if (!seen.has(pid)) {
      rowEls.tr.remove();
      state.procRows.delete(pid);
    }
  }
}

function paintEngineDl(dlEl, self, lang) {
  const labels = ENGINE_DL_LABELS[lang];
  const values = [
    String(self.pid),
    fmtUptime(self.uptimeSec),
    fmtCpuPct(self.cpuPct),
    fmtBytes(self.rssBytes),
    self.threads == null ? '—' : String(self.threads),
    self.fdCount == null ? '—' : String(self.fdCount),
  ];
  dlEl.replaceChildren();
  for (let i = 0; i < labels.length; i++) {
    dlEl.appendChild(el('dt', undefined, labels[i]));
    dlEl.appendChild(el('dd', undefined, values[i]));
  }
}

function buildShell(container, lang) {
  container.replaceChildren();

  const cardsWrap = el('div', 'stat-cards');
  const cards = {};
  for (const kind of ['cpu', 'memory', 'disk', 'counts']) {
    const card = buildCard(kind, lang);
    cards[kind] = card;
    cardsWrap.appendChild(card.root);
  }
  container.appendChild(cardsWrap);

  const procSummary = el('p', 'meta', '');
  container.appendChild(procSummary);

  const table = document.createElement('table');
  table.className = 'table proc-table';
  table.setAttribute('data-proc-table', '');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of PROC_HEAD_LABELS[lang]) headRow.appendChild(el('th', undefined, label));
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  container.appendChild(table);

  const dl = document.createElement('dl');
  dl.className = 'engine-dl';
  dl.setAttribute('data-engine-dl', '');
  container.appendChild(dl);

  return {
    lang, cards, procSummaryEl: procSummary, tbodyEl: tbody, engineDlEl: dl,
    procRows: new Map(), systemPainted: false,
  };
}

function paintHostUnavailable(state) {
  const lang = state.lang;
  for (const kind of ['cpu', 'memory', 'disk']) {
    paintCard(state.cards[kind], { value: t(lang, 'unavailable'), pct: undefined, meta: undefined });
  }
  state.procSummaryEl.textContent = t(lang, 'unavailable');
  state.tbodyEl.replaceChildren();
  state.procRows.clear();
  state.engineDlEl.replaceChildren();
}

function paintHost(state, body) {
  const lang = state.lang;
  const cpuState = cpuUtilState(body.cpu);
  paintCard(state.cards.cpu, statCard('cpu', { ...cpuState, cores: body.cpu.cores, loadAvg: body.cpu.loadAvg }, lang));
  paintCard(state.cards.memory, statCard('memory', sectionState(body.memory), lang));
  paintCard(state.cards.disk, statCard('disk', sectionState(body.disk), lang));

  const sysState = sectionState(body.process.system);
  state.procSummaryEl.textContent = sysState.kind === 'ok' ? procTotals(sysState.value, lang) : t(lang, 'unavailable');

  paintProcTable(state, body.process.topN, body.process.self.pid);
  paintEngineDl(state.engineDlEl, body.process.self, lang);
}

// [v28b, DES-220 (B7), TASK-226 widened] takes the rendered `text` directly — a LIVE degrade keeps
// the existing 「無法取樣」 wording byte-identical, a DEMO tick's version names its own route
// (`onTick`'s one caller below computes which, per `tick.source`); the return shape stays
// `{value, pct: undefined, meta: undefined}` unchanged.
function paintCountsUnavailable(state, text) {
  paintCard(state.cards.counts, { value: text, pct: undefined, meta: undefined });
}

function paintCounts(state, counts) {
  paintCard(state.cards.counts, statCard('counts', counts, state.lang));
}

const stateByContainer = new WeakMap();

/** [v28] DES-206's uniform view contract, poll half — `bodies`/`tick.results` are keyed by
 *  `poll.js`'s `endpointsFor('system')`: `/api/system`, `/api/workflows`, `/api/runs` (ADR-057's
 *  client fold needs the latter two with NO new server route). Returns all three verdicts so a
 *  caller folding them into `nextConnection` can do so like every other view (redundant with
 *  `app.js`'s own `transportResults` for these three urls, same as `ui/models.js`'s own return). */
export async function onTick(container, bodies, _ctx, tick) {
  if (!container.isConnected) return undefined;
  let state = stateByContainer.get(container);
  if (!state) {
    state = buildShell(container, currentLang());
    stateByContainer.set(container, state);
  }

  const results = (tick && tick.results) || {};
  const systemVerdict = results['/api/system'];
  const systemBody = bodies ? bodies['/api/system'] : undefined;
  if (systemVerdict === 'ok' && systemBody) {
    paintHost(state, systemBody);
    state.systemPainted = true;
  } else if (!state.systemPainted) {
    paintHostUnavailable(state);
  }
  // else: KEEP — a transient miss after a real paint leaves the last-known host numbers on screen.

  const workflowsVerdict = results['/api/workflows'];
  const runsVerdict = results['/api/runs'];
  const workflowsBody = bodies ? bodies['/api/workflows'] : undefined;
  const runsBody = bodies ? bodies['/api/runs'] : undefined;
  if (workflowsVerdict === 'ok' && runsVerdict === 'ok' && Array.isArray(workflowsBody) && Array.isArray(runsBody)) {
    paintCounts(state, catalogCounts(workflowsBody, runsBody));
  } else {
    // No "keep" here, ON PURPOSE (DES-215/216's decisive case): the counts card's own two routes
    // are independent of `/api/system`'s health, so a fault on either flips it immediately.
    // [v28b, DES-220 (B7)] a DEMO tick's miss names its own route; a LIVE miss keeps DES-215/216's
    // existing wording byte-identical — the route was tried and failed, the opposite of demo's
    // out-of-scope-by-design.
    const text = (tick && tick.source === 'demo') ? t(state.lang, 'noDemoData') + '/api/workflows' : t(state.lang, 'unavailable');
    paintCountsUnavailable(state, text);
  }

  return { '/api/system': systemVerdict, '/api/workflows': workflowsVerdict, '/api/runs': runsVerdict };
}

/** DES-206's uniform view contract — `vm`/`handlers` are unused (`app.js`'s `activateTab` mounts
 *  every tab module the same way, `mod.render(panel, {}, {})`); the shell is fully static, built
 *  here, and `onTick` owns the actual fetch verdict and value paint, called once here for first
 *  paint since nothing else has yet. */
export function render(container, _vm, _handlers) {
  container.id = 'system-panel';
  onTick(container, {}, {}, { results: {} });
}
