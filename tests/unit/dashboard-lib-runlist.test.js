// UT-246 (DES-204, ARCH-124/126, ADR-046, TASK-207, REQ-132/133/141): `lib/runlist.js` — the list
// projections and ONE money formatter. `fmtCost` is the single place the ledger's
// five-times-closed "confident $0.00" defect can regress: absent -> "—", unpricedCalls>0 -> a
// "≥ $x · N 未定價" form, else a plain dollar figure.
//
// Tier: unit, `.js`, pure.
//
// Red reason (measured): `src/dashboard/lib/runlist.js` does not exist (whole-file import
// failure).
import { describe, it, expect } from 'vitest';
import { matchCards, segmentCounts, sortRows, historyRow, fmtCost, sumTokens, fmtTok } from '../../src/dashboard/lib/runlist.js';

describe('lib/runlist.js: fmtCost (UT-246, DES-204, ADR-046)', () => {
  it('absent costUSD -> "—" (never $0.00)', () => {
    expect(fmtCost(undefined, undefined, 'en')).toBe('—');
  });

  it('unpricedCalls > 0 -> a "at least" form naming the unpriced count (never a confident $0.00)', () => {
    const s = fmtCost(0.42, 2, 'en');
    expect(s).toContain('0.42');
    expect(s).toMatch(/2/);
  });

  it('unpricedCalls === 0 (or absent) -> a plain dollar figure', () => {
    expect(fmtCost(0.42, 0, 'en')).toContain('0.42');
    expect(fmtCost(0.42, undefined, 'en')).toContain('0.42');
  });
});

describe('lib/runlist.js: sortRows (UT-246, DES-204)', () => {
  it('absent values sort LAST in BOTH directions, never as 0', () => {
    const rows = [{ id: 'a', v: 5 }, { id: 'b', v: undefined }, { id: 'c', v: 2 }];
    const asc = sortRows(rows, 'v', 'asc');
    expect(asc[asc.length - 1].id).toBe('b');
    const desc = sortRows(rows, 'v', 'desc');
    expect(desc[desc.length - 1].id).toBe('b');
  });
});

describe('lib/runlist.js: historyRow (UT-246, DES-204, REQ-133)', () => {
  it("a LIVE run's duration column reads '4m 12s 進行中', because now is a PARAMETER (never Date.now())", () => {
    const summary = { runId: 'abcdef01', status: 'running', createdAt: '2026-09-11T00:00:00.000Z' };
    const now = '2026-09-11T00:04:12.000Z';
    const row = historyRow(summary, now, 'zh');
    expect(row.some((cell) => /4m ?12s/.test(cell) && /進行中/.test(cell))).toBe(true);
  });

  it('every figure the summary OMITS renders as "—", never 0', () => {
    const summary = { runId: 'abcdef02', status: 'completed', createdAt: '2026-09-11T00:00:00.000Z', terminalAt: '2026-09-11T00:01:00.000Z' };
    const row = historyRow(summary, '2026-09-11T00:05:00.000Z', 'zh');
    expect(row.some((cell) => cell === '—')).toBe(true);
    expect(row.some((cell) => cell === '0')).toBe(false);
  });
});

describe('lib/runlist.js: matchCards / segmentCounts (UT-246, DES-204, REQ-132)', () => {
  const cards = [
    { name: 'alpha', description: 'first workflow', group: 'running' },
    { name: 'beta', description: 'searchable text here', group: 'registered' },
    { name: 'gamma', description: 'other', group: 'other' },
  ];

  it('matchCards keeps only name-or-description hits', () => {
    expect(matchCards(cards, 'alpha').map((c) => c.name)).toEqual(['alpha']);
    expect(matchCards(cards, 'searchable').map((c) => c.name)).toEqual(['beta']);
  });

  it('segmentCounts reports all/running/registered', () => {
    // [v30b, REQ-170 — ORACLE RE-DERIVED] `all: 3` was `cards.length`, i.e. the implementation's
    // own definition including the `other` group. The design computes `all = running + registered`
    // — the count answers "how many workflows do I have", and an `other` row is a run whose
    // workflow is gone. Re-derived from the handoff's home builder.
    expect(segmentCounts(cards)).toEqual({ all: 2, running: 1, registered: 1 });
  });
});

describe('lib/runlist.js: sumTokens (UT-246, DES-204)', () => {
  it('sums the four token columns', () => {
    expect(sumTokens({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 })).toBe(10);
  });
});

// [v27 README-fidelity closure] node-cell row 3: "52k tok · $0.31 · 2m 10s" — the "k"/"M"
// abbreviation this pass added.
describe('lib/runlist.js: fmtTok (v27 README-fidelity closure, REQ-134)', () => {
  it('below 1000 renders the plain count', () => {
    expect(fmtTok(0)).toBe('0');
    expect(fmtTok(342)).toBe('342');
  });

  it('a round thousand renders as the README\'s own example (52000 -> "52k")', () => {
    expect(fmtTok(52000)).toBe('52k');
  });

  it('a non-round thousand keeps one decimal place', () => {
    expect(fmtTok(52400)).toBe('52.4k');
  });

  it('at or above a million abbreviates to M', () => {
    expect(fmtTok(1200000)).toBe('1.2M');
    expect(fmtTok(3000000)).toBe('3M');
  });
});

describe('lib/runlist.js: historyRow column formatting (UT-265, v29, REQ-148)', () => {
  // Five of the nine columns were raw wire values on the page: the full 36-char UUID, an
  // untranslated `completed`, an untranslated `client`, the raw ISO string (`fmtStartedAt` was a
  // `return iso ?? '—'` stub), and `String(19426)`. The delivery README's own history table reads
  // `431df640 │ 完成 │ 客戶端 │ 9/7 18:25:26 │ 19.4k`.
  const summary = {
    runId: '431df640-129e-46b6-a53d-b168116b5739',
    status: 'completed',
    scriptVersion: 'v2',
    startedBy: { type: 'client' },
    createdAt: '2026-09-07T10:25:26.314Z',
    terminalAt: '2026-09-07T10:28:25.000Z',
    agentCount: 4,
    tokensTotal: 19426,
    costUSD: 0,
  };
  const NOW = '2026-09-07T11:00:00.000Z';

  it('the run id column is the first 8 characters, never the whole UUID', () => {
    const row = historyRow(summary, NOW, 'zh');
    expect(row).toContain('431df640');
    expect(row.some((c) => String(c).includes('-129e-'))).toBe(false);
  });

  it('status and trigger read in the viewer\u2019s language', () => {
    const zh = historyRow(summary, NOW, 'zh');
    expect(zh).toContain('\u5b8c\u6210');
    expect(zh).toContain('\u5ba2\u6236\u7aef');
    expect(zh.some((c) => c === 'completed' || c === 'client')).toBe(false);
    const en = historyRow(summary, NOW, 'en');
    expect(en.some((c) => /completed/i.test(String(c)))).toBe(true);
  });

  it('the started-at column is a local clock reading, never the ISO string', () => {
    const row = historyRow(summary, NOW, 'zh');
    expect(row.some((c) => String(c).includes('T10:25:26.314Z'))).toBe(false);
    expect(row.some((c) => /\d{1,2}\/\d{1,2} \d{2}:\d{2}:\d{2}/.test(String(c)))).toBe(true);
  });

  it('the token column is humanised the same way every other token figure on the page is', () => {
    const row = historyRow(summary, NOW, 'zh');
    expect(row).toContain(fmtTok(19426));
    expect(row.some((c) => c === '19426')).toBe(false);
  });

  it('an absent figure is still \u2014, never a formatted zero', () => {
    const bare = { runId: 'abcdef0123456789', status: 'queued', createdAt: '2026-09-07T10:00:00.000Z' };
    const row = historyRow(bare, NOW, 'zh');
    expect(row.filter((c) => c === '\u2014').length).toBeGreaterThanOrEqual(3);
    expect(row.some((c) => c === '0')).toBe(false);
  });
});

describe('lib/runlist.js: segmentCounts (UT-275, v30b, REQ-170)', () => {
  // The design computes `countAll = countRunning + countRegistered` (its own home builder), and
  // recomputes every count against the CURRENT query. The build counted every card including the
  // `other` group and ignored the search box entirely, so 「全部 (10)」 stayed put while four cards
  // matched — a count that describes a set the viewer is not looking at.
  const cards = [
    { name: 'a', group: 'running' },
    { name: 'b', group: 'registered' },
    { name: 'probe-c', group: 'registered' },
    { name: 'probe-d', group: 'other' },
    { name: 'e', group: 'other' },
  ];

  it('all = running + registered — the `other` group is not counted', () => {
    const c = segmentCounts(cards);
    expect(c.running).toBe(1);
    expect(c.registered).toBe(2);
    expect(c.all).toBe(3);
  });

  it('the counts describe the CURRENT query, not the whole catalogue', () => {
    const c = segmentCounts(matchCards(cards, 'probe'));
    expect(c.registered).toBe(1);
    expect(c.all).toBe(1);
  });

  it('a query nothing matches counts zero rather than freezing at the catalogue size', () => {
    expect(segmentCounts(matchCards(cards, 'zzzz')).all).toBe(0);
  });
});

describe('lib/runlist.js: fmtTok is total over an absent figure (UT-276, v31, REQ-186)', () => {
  // R30-A1's client half. A running agent has no usage event yet, so its token figure is ABSENT.
  // `fmtTok` had no absent branch at all: `fmtTok(undefined)` fell through to `String(undefined)`
  // and would have printed the literal word — the same class this ledger keeps closing, latent
  // only because every caller happened to hand it a zero-filled object.
  it('absent renders —, never 0 and never the literal word', () => {
    expect(fmtTok(undefined)).toBe('—');
    expect(fmtTok(null)).toBe('—');
    expect(fmtTok(NaN)).toBe('—');
  });

  it('a real zero still reads 0 — a failed call that moved no counter is a MEASURED zero', () => {
    expect(fmtTok(0)).toBe('0');
  });

  it('sumTokens says ABSENT for an absent object, and 0 for a zero-filled one', () => {
    expect(sumTokens(undefined)).toBe(undefined);
    expect(sumTokens({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(0);
    expect(sumTokens({ input: 2, output: 3 })).toBe(5);
  });
});
