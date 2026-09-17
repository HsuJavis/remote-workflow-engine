// src/dashboard/ui/models.js
// [v28] DES-214, ARCH-133, ARCH-125, TASK-222, REQ-137 — the Models tab rewritten to twelve
// sortable columns, three filters (search/provider/segment) and a 560px slide-in panel. Replaces
// the pre-v28 flat 6-column ported table. The pure projections (`matchModels`/`sortKeyOf`/
// `modelRow`/`modelPanel`) come from `lib/model.js` (DES-213, TASK-222) — this layer only builds/
// updates DOM and decides nothing a pure function could decide (ARCH-125's own boundary).
//
// `render(container, vm, handlers)` builds the chrome ONCE, lazily, on the first successful paint
// (DES-206 rule (V)/(K)/(U), no carve-out: before any real data has ever painted this container,
// the WHOLE container is the ONE Unavailable component — same convention `system.js`/`issues.js`
// use today). `onTick(container, bodies, ctx, tick)` owns the fetch verdict: the verdict is
// `tick.results['/api/models']`, never the body's shape (DES-210).
//
// Per-container state in a `WeakMap` (`home.js:199-217`'s pattern): `{ query, provider, loc, sort:
// {key, dir}, selected, fingerprint, painted, entries, lang }`. Repaint is fingerprint-gated
// (`catalogFetchedAt` + row count + `sort` + the three filter values + `selected`) — a blind
// repaint of a 12-column table every ~3s would close the operator's open panel and reset their
// sort/search every tick.
import { matchModels, sortKeyOf, modelRow, modelPanel } from '../lib/model.js';
import { sortRows } from '../lib/runlist.js';
import { t } from '../lib/strings.js';
import { el } from './dom.js';

// Not imported from `./agent-panel.js` (which duplicates the same two lines for the same reason,
// its own file banner): a cross-import here would be the only cycle in `ui/`.
function currentLang() {
  return document.documentElement.lang === 'en' ? 'en' : 'zh';
}

// Columns, in REQ-137's order (DES-213) — the header row's own labels; `key` must match a
// `sortKeyOf`/`modelRow` column name.
const COLUMNS = [
  { key: 'model', zh: '模型', en: 'Model' },
  { key: 'provider', zh: '供應商', en: 'Provider' },
  { key: 'aliases', zh: '別名', en: 'Aliases' },
  { key: 'context', zh: '上下文', en: 'Context' },
  { key: 'price', zh: '價格', en: 'Price' },
  { key: 'tools', zh: '工具', en: 'Tools' },
  { key: 'effort', zh: '推理', en: 'Effort' },
  { key: 'modalities', zh: '模態', en: 'Modalities' },
  { key: 'latency', zh: '延遲', en: 'Latency' },
  { key: 'stability', zh: '穩定性', en: 'Stability' },
  { key: 'benchmarks', zh: '基準', en: 'Benchmarks' },
  { key: 'location', zh: '位置', en: 'Location' },
];

const LABELS = {
  zh: { search: '搜尋模型…', allProviders: '全部供應商', all: '全部', remote: '遠端', local: '本地' },
  en: { search: 'Search models…', allProviders: 'All providers', all: 'All', remote: 'Remote', local: 'Local' },
};

function updateHeaderSort(theadEl, state) {
  theadEl.querySelectorAll('th').forEach((th) => {
    const active = th.dataset.col === state.sort.key;
    th.classList.toggle('sort-active', active);
    th.textContent = active ? `${th.dataset.label} ${state.sort.dir === 'asc' ? '▲' : '▼'}` : th.dataset.label;
  });
}

function updateProviderOptions(state) {
  const sel = state.providerSel;
  const providers = [...new Set(state.entries.map((e) => e.provider))].sort();
  const current = state.provider;
  sel.replaceChildren(el('option', undefined, LABELS[state.lang].allProviders));
  sel.options[0].value = '';
  for (const p of providers) {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    sel.appendChild(opt);
  }
  sel.value = current;
}

function fmtCount(filtered, total) {
  return filtered === total ? String(total) : `${filtered} / ${total}`;
}

function buildChrome(container, state) {
  container.replaceChildren();

  const filters = document.createElement('div');
  filters.className = 'model-filters';

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'input';
  search.placeholder = LABELS[state.lang].search;
  search.value = state.query;
  search.addEventListener('input', () => {
    state.query = search.value;
    paint(container, state, true);
  });
  filters.appendChild(search);

  const providerSel = document.createElement('select');
  providerSel.className = 'input';
  providerSel.addEventListener('change', () => {
    state.provider = providerSel.value;
    paint(container, state, true);
  });
  filters.appendChild(providerSel);
  state.providerSel = providerSel;

  const seg = document.createElement('div');
  seg.className = 'seg';
  for (const loc of ['all', 'remote', 'local']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.loc = loc;
    btn.textContent = LABELS[state.lang][loc];
    btn.classList.toggle('active', loc === state.loc);
    seg.appendChild(btn);
  }
  seg.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn || !seg.contains(btn)) return;
    state.loc = btn.dataset.loc;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    paint(container, state, true);
  });
  filters.appendChild(seg);

  const count = el('span', 'mono', '');
  filters.appendChild(count);
  state.countEl = count;

  container.appendChild(filters);

  const table = document.createElement('table');
  table.className = 'table models-table';
  table.setAttribute('data-model-table', '');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const col of COLUMNS) {
    const th = document.createElement('th');
    const label = col[state.lang] || col.en;
    th.dataset.col = col.key;
    th.dataset.label = label;
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.addEventListener('click', (ev) => {
    const th = ev.target.closest('th');
    if (!th || !thead.contains(th)) return;
    const key = th.dataset.col;
    state.sort = { key, dir: state.sort.key === key && state.sort.dir === 'asc' ? 'desc' : 'asc' };
    paint(container, state, true);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  tbody.addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr');
    if (!tr || !tbody.contains(tr)) return;
    state.selected = state.selected === tr.dataset.model ? null : tr.dataset.model;
    paint(container, state, true);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  state.tableEl = table;
  state.theadEl = thead;
  state.tbodyEl = tbody;
  state.filtersEl = filters;
}

function renderRows(tbodyEl, entries, lang) {
  tbodyEl.replaceChildren();
  for (const entry of entries) {
    const { cells } = modelRow(entry, lang);
    const tr = document.createElement('tr');
    tr.dataset.model = entry.model;
    cells.forEach((c) => tr.appendChild(el('td', undefined, c != null ? String(c) : '—')));
    tbodyEl.appendChild(tr);
  }
}

function buildPanel(container, state, entry) {
  const vm = modelPanel(entry, state.lang);
  const panel = document.createElement('aside');
  panel.setAttribute('data-model-panel', '');
  panel.className = 'model-panel';

  const header = document.createElement('header');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn-icon';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    state.selected = null;
    paint(container, state, true);
  });
  header.appendChild(closeBtn);
  header.appendChild(el('h2', undefined, vm.title));
  panel.appendChild(header);

  if (vm.kicker) panel.appendChild(el('div', 'kicker', vm.kicker));
  if (vm.aliases && vm.aliases.length) panel.appendChild(el('p', 'mono', vm.aliases.join(', ')));
  if (vm.description) panel.appendChild(el('p', undefined, vm.description));

  const dl = document.createElement('dl');
  for (const [label, value] of vm.defs) {
    dl.appendChild(el('dt', undefined, label));
    dl.appendChild(el('dd', undefined, value != null ? String(value) : '—'));
  }
  panel.appendChild(dl);

  // `vm.benchmarks` is `[]` for every real entry this iteration (Won't-have D2, ADR-060) — this
  // loop renders nothing on a real page today, never a fabricated row (UT-257's own rule).
  for (const [name, value, pct] of vm.benchmarks) {
    const row = document.createElement('div');
    row.className = 'bench-row';
    row.appendChild(el('span', undefined, name));
    const track = document.createElement('div');
    track.className = 'stat-track';
    const bar = document.createElement('div');
    bar.className = 'stat-bar';
    bar.style.transform = `scaleX(${pct / 100})`; // legal write (guard allows display/transform only)
    track.appendChild(bar);
    row.appendChild(track);
    row.appendChild(el('span', 'mono', String(value)));
    panel.appendChild(row);
  }

  if (vm.tags && vm.tags.length) {
    const tagWrap = el('div', 'tag-columns');
    for (const tag of vm.tags) tagWrap.appendChild(el('span', 'tag', tag));
    panel.appendChild(tagWrap);
  }

  return panel;
}

function renderPanel(container, state) {
  const existing = container.querySelector('[data-model-panel]');
  if (existing) existing.remove();
  if (!state.selected) return;
  const entry = state.entries.find((e) => e.model === state.selected);
  if (!entry) return;
  container.appendChild(buildPanel(container, state, entry));
}

function fingerprintOf(state) {
  const catalogFetchedAt = state.entries[0] ? state.entries[0].catalogFetchedAt : null;
  return JSON.stringify([catalogFetchedAt, state.entries.length, state.sort, state.query, state.provider, state.loc, state.selected]);
}

/** `force` bypasses the fingerprint gate for a direct user interaction (typing/sorting/filtering/
 *  selecting), where the state just changed and a repaint is always warranted; the fingerprint
 *  check exists only to skip a redundant rebuild on an UNCHANGED periodic tick. */
function paint(container, state, force) {
  const fp = fingerprintOf(state);
  if (!force && state.painted && fp === state.fingerprint) return;
  state.fingerprint = fp;

  if (!state.tableEl) buildChrome(container, state);
  updateProviderOptions(state);

  const filtered = matchModels(state.entries, { query: state.query, provider: state.provider, loc: state.loc });
  const keyed = filtered.map((entry) => ({ entry, key: sortKeyOf(entry, state.sort.key) }));
  const sorted = sortRows(keyed, 'key', state.sort.dir).map((r) => r.entry);

  renderRows(state.tbodyEl, sorted, state.lang);
  updateHeaderSort(state.theadEl, state);
  state.countEl.textContent = fmtCount(filtered.length, state.entries.length);
  renderPanel(container, state);
  state.painted = true;
}

const stateByContainer = new WeakMap();

function initialState(lang) {
  return {
    query: '', provider: '', loc: 'all', sort: { key: 'model', dir: 'asc' }, selected: null,
    fingerprint: null, painted: false, entries: [], lang,
  };
}

/** [v28] DES-206's uniform view contract, poll half — reads `bodies['/api/models']` and the
 *  verdict off `tick.results['/api/models']` (DES-210: the verdict is the transport result, never
 *  the body's shape). First paint (`state.painted === false`) with no verdict yet ⇒ the ONE
 *  Unavailable component; after a successful paint ⇒ KEEP, no DOM write derived from a failed
 *  tick. */
export async function onTick(container, bodies, _ctx, tick) {
  let state = stateByContainer.get(container);
  if (!state) {
    state = initialState(currentLang());
    stateByContainer.set(container, state);
  }
  const verdict = tick && tick.results ? tick.results['/api/models'] : undefined;
  const body = bodies ? bodies['/api/models'] : undefined;
  if (verdict === 'ok' && Array.isArray(body)) {
    state.entries = body;
    paint(container, state, false);
  } else if (!state.painted) {
    container.replaceChildren(el('div', 'empty', t(state.lang, 'unavailable')));
  }
  return { '/api/models': verdict };
}

/** DES-206's uniform view contract — `vm`/`handlers` are unused (`app.js`'s `activateTab` mounts
 *  every tab module the same way, `mod.render(panel, {}, {})`); `onTick` owns the actual fetch
 *  verdict and paint, called once here for first paint since nothing else has yet. */
export function render(container, _vm, _handlers) {
  onTick(container, {}, {}, { results: {} });
}
