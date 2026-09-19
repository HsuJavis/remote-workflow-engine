// src/dashboard/lib/runlist.js
// DES-204, ARCH-124/126, ADR-046, TASK-207, REQ-132/133/141 — the workflow-list projections and
// ONE money formatter. `fmtCost` is the single place the ledger's five-times-closed "confident
// $0.00" defect can regress; `historyRow`/the swimlane node/the home meta line all go through it.
// Pure: `now` is a parameter everywhere — never read from the system clock directly.
import { stateLabel, triggerLabel } from './strings.js';

// A costUSD that rounds to "$0.00" at 2dp is still a REAL nonzero cost (e.g. a single cheap
// call) — showing "$0.00" there is the exact confident-zero defect this function exists to kill,
// so it floors to "< $0.01" instead. A genuine `costUSD === 0` stays "$0.00": a known zero is
// truthful (DES-194's omit-together rule means ABSENCE, not zero, is the lie).
function fmtDollar(costUSD) {
  const fixed = costUSD.toFixed(2);
  if (costUSD > 0 && fixed === '0.00') return '< $0.01';
  return '$' + fixed;
}

export function fmtCost(costUSD, unpricedCalls, lang) {
  if (costUSD === undefined || costUSD === null) return '—';
  const amount = fmtDollar(costUSD);
  if (unpricedCalls) {
    const suffix = lang === 'zh' ? `${unpricedCalls} 未定價` : `${unpricedCalls} unpriced`;
    return `≥ ${amount} · ${suffix}`;
  }
  return amount;
}

export function sumTokens(tokens) {
  if (!tokens) return 0;
  return (tokens.input || 0) + (tokens.output || 0) + (tokens.cacheRead || 0) + (tokens.cacheWrite || 0);
}

// v27 README-fidelity closure: node-cell row 3 (`52k tok · $0.31 · 2m 10s`) shipped the raw sum
// unabbreviated. Below 1000 the plain count stands; above it, one decimal place with a trailing
// ".0" stripped, so a round number (52000) reads exactly as the README's own example does (52k).
export function fmtTok(n) {
  const unit = n >= 1e6 ? 1e6 : n >= 1e3 ? 1e3 : 1;
  const suffix = n >= 1e6 ? 'M' : n >= 1e3 ? 'k' : '';
  return unit === 1 ? String(n) : (n / unit).toFixed(1).replace(/\.0$/, '') + suffix;
}

// Absent values sort LAST regardless of direction — never coerced to `0`.
export function sortRows(rows, key, dir) {
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === undefined && bv === undefined) return 0;
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    return av < bv ? -sign : av > bv ? sign : 0;
  });
}

function fmtDuration(startedAt, endedAt, now, live, lang) {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt ?? now);
  const totalSec = Math.max(0, Math.round((end - start) / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const base = `${m}m ${s}s`;
  if (!live) return base;
  return lang === 'zh' ? `${base} 進行中` : `${base} running`;
}

// [v29d, REQ-156/157] ONE clock formatter. Before this there were two private copies (this file's
// own `p2` and `ui/app.js:166`'s `pad2`), and the models/system headers would have made a third.
// `null` in, `'—'` out — never the literal word (the BF-5/BF-6 class).
export function fmtClock(iso) {
  if (!iso) return '—';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

// [v29, REQ-148] Was `return iso ?? '—'` — a stub that put the raw ISO string on the page
// (`2026-09-07T10:25:26.314Z`). The handoff's history table reads `9/7 18:25:26`, a LOCAL clock
// reading, which is also the only form that lines up with the run chips beside it.
function fmtStartedAt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso; // an unparseable wire value is shown, never swallowed
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

// [v29, REQ-148] The 8-character run id the whole UI already uses — `ui/workflow.js` had this as an
// inline `.slice(0, 8)` for the run chips while the table beside it printed the full 36-char UUID.
// One name, one length, both surfaces.
export function shortId(runId) {
  return String(runId ?? '').slice(0, 8);
}

// [v29, REQ-148] `status` and `startedBy.type` arrived on the wire in English and went straight to
// the page. `t()` has no fallback by design, so an unknown value must pass through UNCHANGED
// rather than render the literal string `undefined` (the BF-5/BF-6 defect class).
// [v29 c3] The two maps this file defined in c1 moved to `lib/strings.js` — `ui/agent-panel.js`
// needs the same vocabulary, and a second copy is how two surfaces drift apart.

// REQ-133's nine history-table columns, in order.
export function historyRow(summary, now, lang) {
  const live = summary.status === 'running' || summary.status === 'queued';
  return [
    shortId(summary.runId),
    stateLabel(lang, summary.status),
    summary.scriptVersion ?? '—',
    triggerLabel(lang, summary.startedBy?.type),
    fmtStartedAt(summary.createdAt),
    summary.createdAt ? fmtDuration(summary.createdAt, summary.terminalAt, now, live, lang) : '—',
    summary.agentCount === undefined ? '—' : String(summary.agentCount),
    summary.tokensTotal === undefined ? '—' : fmtTok(summary.tokensTotal),
    fmtCost(summary.costUSD, summary.unpricedCalls, lang),
  ];
}

export function matchCards(cards, query) {
  const q = query.trim().toLowerCase();
  if (!q) return cards;
  return cards.filter((c) => (c.name ?? '').toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q));
}

// [v30b, REQ-170] `all` is running + registered, matching the design's own home builder — the
// `other` group (runs whose workflow is no longer registered) is shown under 全部 but not counted,
// because the count answers "how many workflows do I have", not "how many rows are on screen".
// The caller passes the QUERY-FILTERED list: counts that ignore the search box describe a set the
// viewer is not looking at.
export function segmentCounts(cards) {
  const running = cards.filter((c) => c.group === 'running').length;
  const registered = cards.filter((c) => c.group === 'registered').length;
  return { all: running + registered, running, registered };
}
