import { t } from './strings.js';
// src/dashboard/lib/model.js
// DES-206, TASK-210, REQ-134 row 2 — `shortModel(model)`: strips wire-format routing prefixes so
// the swimlane's model column shows what an operator recognizes, not the raw routed id. Mirrors
// the design handoff's own `D.shortModel`. Pure, no DOM.
export function shortModel(model) {
  if (!model) return model;
  let m = model;
  if (m.startsWith('openrouter/')) m = m.slice('openrouter/'.length);
  if (m.startsWith('anthropic/')) m = m.slice('anthropic/'.length);
  if (m.endsWith(':free')) m = m.slice(0, -':free'.length) + ' (free)';
  return m;
}

// [v28, DES-213, ADR-060, TASK-222, REQ-137] the Models tab's projections — extends this file
// rather than a second `lib/models.js` (DES-213's own boundary against two near-homonym
// `ASSET_KEYS`). `EnrichedModelEntry`'s twelve REQ-137 columns, in order:
const COLUMNS = ['model', 'provider', 'aliases', 'context', 'price', 'tools', 'effort', 'modalities', 'latency', 'stability', 'benchmarks', 'location'];

// `null`, `'unknown'` and a missing nested path all normalise to `undefined` — the ONE token
// `sortRows` (`runlist.js:42`, reused byte-unchanged) ever treats as absent. `0`/`false` are FACTS,
// never absence (DES-213's own ruling: a `costLevel`/price of 0 is the cheapest, not unknown).
function isAbsent(v) {
  return v === null || v === undefined || v === 'unknown';
}

/** `sortKeyOf(entry, column)` — a COMPARABLE SCALAR for `column`, fed straight into `sortRows`
 *  (DES-213's boundary: this is an (sortKeyOf, sortRows) INTEGRATION, not a second sort
 *  algorithm). TOTAL: an unrecognised column degrades to `undefined` (unsorted, absent-last) rather
 *  than throwing. */
export function sortKeyOf(entry, column) {
  switch (column) {
    case 'model': return entry.model;
    case 'provider': return entry.provider;
    case 'aliases': {
      const a = entry.aliases;
      return Array.isArray(a) && a.length ? a[0] : undefined;
    }
    case 'context':
      return isAbsent(entry.contextWindow) ? undefined : entry.contextWindow;
    case 'price': {
      const r = entry.ratesPerM;
      return r == null ? undefined : r.out;
    }
    case 'tools': {
      const v = entry.toolUseDeclared;
      return v === true ? 1 : v === false ? 0 : undefined;
    }
    case 'effort': {
      const v = entry.effortDeclared;
      return v === true ? 1 : v === false ? 0 : undefined;
    }
    case 'modalities': {
      const m = entry.modalities;
      const ins = m && Array.isArray(m.in) ? m.in : [];
      const outs = m && Array.isArray(m.out) ? m.out : [];
      return ins.length || outs.length ? ins.join(',') + '→' + outs.join(',') : undefined;
    }
    case 'latency':
      return entry.latency ? entry.latency.ttftMs : undefined;
    case 'stability':
      return entry.stability;
    case 'benchmarks': {
      const vals = entry.benchmarks ? Object.values(entry.benchmarks) : [];
      return vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : undefined;
    }
    case 'location':
      return entry.location;
    case 'costLevel':
      return isAbsent(entry.costLevel) ? undefined : entry.costLevel;
    default:
      return undefined;
  }
}

/** `matchModels(entries, {query, provider, loc})` — the empty filter is the identity; `query`
 *  narrows by model id/alias substring case-insensitively, `provider` by exact match, `loc` by
 *  exact `location` match ('all' is a no-op). */
export function matchModels(entries, filter) {
  const { query, provider, loc } = filter || {};
  const q = (query || '').trim().toLowerCase();
  return entries.filter((e) => {
    if (provider && e.provider !== provider) return false;
    if (loc && loc !== 'all' && e.location !== loc) return false;
    if (q) {
      const hay = [e.model, ...(Array.isArray(e.aliases) ? e.aliases : [])].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** `costDots(level)` — a 5-dot scale over the 0-10 integer cost tier. `null` (unknown price) is
 *  never rendered as a dot string (DES-213). */
export function costDots(level) {
  if (isAbsent(level)) return '—';
  const filled = Math.max(0, Math.min(5, Math.round((level / 10) * 5)));
  return '●'.repeat(filled) + '○'.repeat(5 - filled);
}

function fmtContext(contextWindow) {
  if (isAbsent(contextWindow)) return '—';
  const unit = contextWindow >= 1e6 ? 1e6 : contextWindow >= 1e3 ? 1e3 : 1;
  const suffix = contextWindow >= 1e6 ? 'M' : contextWindow >= 1e3 ? 'k' : '';
  return unit === 1 ? String(contextWindow) : (contextWindow / unit).toFixed(1).replace(/\.0$/, '') + suffix;
}

function fmtPrice(price, lang) {
  // [v29, REQ-150] beyond the enumerated token list, same defect class on the same table.
  if (price === 'free') return t(lang, 'free');
  if (isAbsent(price)) return '—';
  return `${price.in} / ${price.out}`;
}

function fmtModalities(modalities) {
  const ins = modalities && Array.isArray(modalities.in) ? modalities.in : [];
  const outs = modalities && Array.isArray(modalities.out) ? modalities.out : [];
  if (!ins.length && !outs.length) return '—';
  return `${ins.join(',')} → ${outs.join(',')}`;
}

// `TTFT 900ms · p50 6.8s` (TASK-222's own pinned literal) — `latency`/`benchmarks` are always
// absent on every real row this iteration (Won't-have D2, ADR-060); the RULE holds generically so
// a future D2 lift needs no code change here.
function fmtLatency(latency) {
  if (!latency) return '—';
  const p50s = (latency.p50Ms / 1000).toFixed(1).replace(/\.0$/, '');
  return `TTFT ${latency.ttftMs}ms · p50 ${p50s}s`;
}

// `78 avg` (TASK-222's own pinned literal) — the mean of every declared benchmark score.
function fmtBenchmarks(benchmarks) {
  const vals = benchmarks ? Object.values(benchmarks) : [];
  if (!vals.length) return '—';
  const avg = vals.reduce((a, c) => a + c, 0) / vals.length;
  return `${Number.isInteger(avg) ? avg : avg.toFixed(1)} avg`;
}

// `tools ✓ upstream` / `reasoning ✓ static` (DES-213) — the engine's OWN projection with its
// provenance; `'unknown'` (no declaration at all) renders the same as absent, never a fabricated
// claim either way.
function fmtDeclared(value, source) {
  if (value === true) return `✓ ${source}`;
  if (value === false) return '✕';
  return '—';
}

/** `modelRow(entry, lang) → { cells: string[12], sortKeys }` — the twelve REQ-137 cells, in
 *  column order, plus each column's own `sortKeyOf` value (so a caller holding an already-sorted
 *  row never needs to re-derive a key from the raw entry).
 *
 *  [v29, REQ-150] `lang` was accepted "for a FUTURE locale-varying cell"; two of the twelve are
 *  locale-varying and shipped showing the raw wire words (`stable`, `remote`) in the zh table.
 *  Only the DISPLAYED cell is translated — `sortKeys` keeps the raw value, so switching language
 *  never reorders the table. An unrecognised wire value passes through unchanged rather than
 *  rendering the literal string `undefined` (the BF-5/BF-6 class). */
const STABILITY_KEY = { stable: 'stable', variable: 'variable', 'best-effort': 'bestEffort' };
const LOCATION_KEY = { remote: 'remote', local: 'local' };
function word(map, raw, lang) {
  if (raw === undefined || raw === null || raw === '') return '—';
  const key = map[String(raw)];
  return key ? t(lang, key) : String(raw);
}

export function modelRow(entry, lang) {
  const cells = [
    entry.model,
    entry.provider,
    Array.isArray(entry.aliases) && entry.aliases.length ? entry.aliases.join(', ') : '—',
    fmtContext(entry.contextWindow),
    fmtPrice(entry.price, lang),
    fmtDeclared(entry.toolUseDeclared, entry.declaredSource),
    fmtDeclared(entry.effortDeclared, entry.declaredSource),
    fmtModalities(entry.modalities),
    fmtLatency(entry.latency),
    word(STABILITY_KEY, entry.stability, lang),
    fmtBenchmarks(entry.benchmarks),
    word(LOCATION_KEY, entry.location, lang),
  ];
  const sortKeys = {};
  for (const col of COLUMNS) sortKeys[col] = sortKeyOf(entry, col);
  return { cells, sortKeys };
}

const DEF_LABELS = {
  zh: ['能力', '模態', '上下文', '價格', '成本', '延遲', '穩定性', '工具', '推理'],
  en: ['Capability', 'Modalities', 'Context', 'Price', 'Cost', 'Latency', 'Stability', 'Tools', 'Effort'],
};

/** `modelPanel(entry, lang)` — the 560px slide-in projection. `defs` order (dashboard.css's own
 *  comment, DES-213): capability, modalities, context, price, cost level, latency, stability,
 *  tools, effort — cost level is fixed at defs[4] (the CSS's `dd:nth-of-type(5)` accent rule).
 *  `benchmarks` is `[]`, never a fabricated row, when the entry carries none (D2 default). */
export function modelPanel(entry, lang) {
  const labels = DEF_LABELS[lang] || DEF_LABELS.zh;
  const values = [
    entry.capability,
    fmtModalities(entry.modalities),
    fmtContext(entry.contextWindow),
    fmtPrice(entry.price, lang),
    costDots(entry.costLevel),
    fmtLatency(entry.latency),
    entry.stability,
    fmtDeclared(entry.toolUseDeclared, entry.declaredSource),
    fmtDeclared(entry.effortDeclared, entry.declaredSource),
  ];
  const benchmarks = entry.benchmarks
    ? Object.entries(entry.benchmarks).map(([name, value]) => [name, value, Math.max(0, Math.min(100, value))])
    : [];
  return {
    kicker: entry.provider,
    title: entry.model,
    aliases: entry.aliases,
    description: entry.description,
    defs: labels.map((label, i) => [label, values[i]]),
    benchmarks,
    tags: [entry.location, entry.stability].filter(Boolean),
  };
}
