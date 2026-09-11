// src/dashboard/lib/runlist.js
// DES-204, ARCH-124/126, ADR-046, TASK-207, REQ-132/133/141 — the workflow-list projections and
// ONE money formatter. `fmtCost` is the single place the ledger's five-times-closed "confident
// $0.00" defect can regress; `historyRow`/the swimlane node/the home meta line all go through it.
// Pure: `now` is a parameter everywhere — never read from the system clock directly.

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

function fmtStartedAt(iso) {
  return iso ?? '—';
}

// REQ-133's nine history-table columns, in order.
export function historyRow(summary, now, lang) {
  const live = summary.status === 'running' || summary.status === 'queued';
  return [
    summary.runId,
    summary.status,
    summary.scriptVersion ?? '—',
    summary.startedBy?.type ?? '—',
    fmtStartedAt(summary.createdAt),
    summary.createdAt ? fmtDuration(summary.createdAt, summary.terminalAt, now, live, lang) : '—',
    summary.agentCount === undefined ? '—' : String(summary.agentCount),
    summary.tokensTotal === undefined ? '—' : String(summary.tokensTotal),
    fmtCost(summary.costUSD, summary.unpricedCalls, lang),
  ];
}

export function matchCards(cards, query) {
  const q = query.trim().toLowerCase();
  if (!q) return cards;
  return cards.filter((c) => (c.name ?? '').toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q));
}

export function segmentCounts(cards) {
  return {
    all: cards.length,
    running: cards.filter((c) => c.group === 'running').length,
    registered: cards.filter((c) => c.group === 'registered').length,
  };
}
