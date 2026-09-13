// src/dashboard/ui/home.js
// DES-206, ARCH-125, TASK-208, REQ-132 — the Workflows tab: three groups (Running / Registered /
// Other), a search box, a segment filter with live counts, and the running card's meta line. The
// pure projections (`matchCards` / `segmentCounts` / `fmtCost`) come from `lib/runlist.js`
// (DES-204, TASK-207) — this layer only builds/updates DOM and decides nothing a pure function
// could decide (ARCH-125's own boundary).
//
// `render(container, vm, handlers)` follows DES-206's uniform view contract. Because the poll tick
// calls this again every ~3s, the static chrome (the search input, the segment tabs) is built ONCE
// per mount — rebuilding it every tick would blow away the input's value/focus mid-keystroke. A
// per-container state object (keyed by a WeakMap, so a re-mount into a fresh container starts
// clean) tracks whether the chrome already exists.

import { matchCards, segmentCounts, fmtCost } from '../lib/runlist.js';

const LABELS = {
  zh: {
    searchPlaceholder: '搜尋 workflow…',
    all: '全部',
    running: '執行中',
    registered: '已註冊',
    other: '其他',
    active: 'ACTIVE',
    lastRun: 'LAST RUN',
  },
  en: {
    searchPlaceholder: 'Search workflows…',
    all: 'All',
    running: 'Running',
    registered: 'Registered',
    other: 'Other',
    active: 'ACTIVE',
    lastRun: 'LAST RUN',
  },
};
function L(lang, key) {
  return (LABELS[lang] || LABELS.zh)[key];
}

// `lib/runlist.js`'s own duration formatter is not exported (it is a private helper of
// `historyRow`) — this is a small, deliberate duplication rather than a change to TASK-207's file.
// Exported (v27 README-fidelity closure) so `ui/run.js`'s node-cell row 3 reuses THIS convention
// instead of adding a third/fourth copy of the same `${m}m ${s}s` formula.
export function formatDuration(ms) {
  if (ms === null || ms === undefined) return '—';
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s}s`;
}

// README "1. Workflows home": `LAST RUN · 9/11 14:02` — a date+time, distinct from ACTIVE's run
// id. No existing formatter in this codebase produces "M/D HH:MM" (unlike the duration case above).
function fmtLastRunAt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function metaLine(card, lang) {
  const m = card.metrics;
  const rateText = m.successRate === null ? '—' : `${Math.round(m.successRate * 100)}%`;
  const completed = m.successRate === null ? 0 : Math.round(m.successRate * m.terminalCount);
  const dur = formatDuration(m.avgDurationMs);
  const cost = fmtCost(m.avgCostUSD, m.unpricedRuns, lang);
  // WorkflowMetrics carries terminalCount, not a total-runs field — a still-running execution is
  // counted here from `activeRunId`'s presence, the only other run-count signal on the card.
  const runs = m.terminalCount + (card.activeRunId ? 1 : 0);
  return lang === 'zh'
    ? `成功率 ${rateText} (${completed}/${m.terminalCount}) · 平均耗時 ${dur} · 平均費用 ${cost} · ${runs} 次執行`
    : `success ${rateText} (${completed}/${m.terminalCount}) · avg ${dur} · avg cost ${cost} · ${runs} runs`;
}

function buildCard(card, lang, handlers) {
  const el = document.createElement('div');
  el.className = 'card' + (card.group === 'running' ? ' running' : '') + (card.group === 'other' ? ' other' : '');
  el.dataset.workflow = card.name;

  const kicker = document.createElement('div');
  kicker.className = 'kicker';
  // README "1. Workflows home": ACTIVE takes the run id (`ACTIVE · a3f9c2e1`); LAST RUN takes a
  // timestamp (`LAST RUN · 9/11 14:02`), not the id — `WorkflowCard.latestRunAt` (v27
  // README-fidelity closure) now carries that run's `terminalAt`/`createdAt`.
  if (card.activeRunId) {
    kicker.textContent = `${L(lang, 'active')} · ${card.activeRunId.slice(0, 8)}`;
  } else if (card.latestRunAt) {
    const at = fmtLastRunAt(card.latestRunAt);
    if (at) kicker.textContent = `${L(lang, 'lastRun')} · ${at}`;
  }
  el.appendChild(kicker);

  const title = document.createElement('div');
  title.className = 't';
  title.textContent = card.name;
  el.appendChild(title);

  if (card.description) {
    const desc = document.createElement('div');
    desc.className = 's';
    desc.textContent = card.description;
    el.appendChild(desc);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = metaLine(card, lang);
  el.appendChild(meta);

  el.addEventListener('click', () => {
    if (handlers.onSelect) handlers.onSelect(card);
  });
  return el;
}

function groupLabel(lang, group) {
  return L(lang, group);
}

function renderGrid(container, state, handlers) {
  const grid = container.querySelector('.card-grid');
  if (!grid) return;
  const bySegment = state.segment === 'all' ? state.cards : state.cards.filter((c) => c.group === state.segment);
  const filtered = matchCards(bySegment, state.query);
  grid.replaceChildren();
  const groups = state.segment === 'all' ? ['running', 'registered', 'other'] : [state.segment];
  for (const g of groups) {
    const groupCards = filtered.filter((c) => c.group === g);
    if (groupCards.length === 0) continue;
    const section = document.createElement('section');
    section.className = 'card-section' + (g === 'other' ? ' other' : '');
    section.setAttribute('data-section', '');
    const h = document.createElement('h3');
    // README "1. Workflows home": "Running (h6 with pulsing 8 px accent dot)" — the Running
    // group's own heading only; Registered/Other get no dot.
    if (g === 'running') {
      const dot = document.createElement('span');
      dot.className = 'running-dot';
      dot.setAttribute('data-running-dot', '');
      h.appendChild(dot);
    }
    h.appendChild(document.createTextNode(groupLabel(state.lang, g)));
    section.appendChild(h);
    const cardsEl = document.createElement('div');
    cardsEl.className = 'cards';
    for (const c of groupCards) cardsEl.appendChild(buildCard(c, state.lang, handlers));
    section.appendChild(cardsEl);
    grid.appendChild(section);
  }
}

function updateCounts(container, state) {
  const counts = segmentCounts(state.cards);
  container.querySelectorAll('.segment-tabs button').forEach((btn) => {
    const seg = btn.dataset.segment;
    btn.textContent = `${L(state.lang, seg)} (${counts[seg]})`;
    btn.classList.toggle('active', seg === state.segment);
  });
}

function buildChrome(container, state, handlers) {
  container.replaceChildren();

  const toolbar = document.createElement('div');
  toolbar.className = 'home-toolbar';

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = L(state.lang, 'searchPlaceholder');
  search.className = 'home-search input';
  search.addEventListener('input', () => {
    state.query = search.value;
    renderGrid(container, state, handlers);
  });
  toolbar.appendChild(search);

  const tabs = document.createElement('div');
  tabs.className = 'segment-tabs seg';
  for (const seg of ['all', 'running', 'registered']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.segment = seg;
    btn.addEventListener('click', () => {
      state.segment = seg;
      renderGrid(container, state, handlers);
      updateCounts(container, state);
    });
    tabs.appendChild(btn);
  }
  toolbar.appendChild(tabs);
  container.appendChild(toolbar);

  const grid = document.createElement('div');
  grid.className = 'card-grid';
  container.appendChild(grid);
}

const stateByContainer = new WeakMap();

/** DES-206's uniform view contract. `vm = { cards: WorkflowCard[], lang }` — `cards` is the
 *  flattened `{running, registered, other}` HomeView (each card already carries its own `group`).
 *  `handlers.onSelect(card)` fires on a card click (workflow-detail navigation is the caller's
 *  concern, not this layer's). */
export function render(container, vm, handlers) {
  handlers = handlers || {};
  let state = stateByContainer.get(container);
  if (!state) {
    state = { query: '', segment: 'all', lang: vm.lang || 'zh', cards: [], handlers };
    stateByContainer.set(container, state);
    buildChrome(container, state, handlers);
  }
  state.handlers = handlers;
  state.cards = vm.cards || [];
  state.lang = vm.lang || state.lang;
  renderGrid(container, state, handlers);
  updateCounts(container, state);
}

/** DES-206 [v27c] — the poll-tick half of the same view contract: `app.js`'s one timer calls this
 *  every ~3s with `/api/home`'s freshly-fetched body (never a second fetch of its own). No status
 *  to hand back beyond what `app.js`'s own base fetch already recorded for `/api/home`. */
export function onTick(container, bodies) {
  const state = stateByContainer.get(container);
  if (!state) return;
  const body = bodies['/api/home'];
  // [BF-2 Gate 8 repair] a degraded body is `{runs:[], degraded:'...'}` (server.ts's catch-all) —
  // never a HomeView, which always carries `running` as an array. Bail before touching the grid:
  // last-known render stays (ARCH-125's "never rendered as data"), never an empty grid painted
  // over a live one beside a truthful degrade tag. Same guard shape as `ui/workflow.js`'s onTick.
  if (!body || body.degraded || !Array.isArray(body.running)) return;
  state.cards = [...(body.running || []), ...(body.registered || []), ...(body.other || [])];
  renderGrid(container, state, state.handlers);
  updateCounts(container, state);
}
