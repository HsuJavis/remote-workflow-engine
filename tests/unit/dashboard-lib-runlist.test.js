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
import { matchCards, segmentCounts, sortRows, historyRow, fmtCost, sumTokens } from '../../src/dashboard/lib/runlist.js';

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
    expect(segmentCounts(cards)).toEqual({ all: 3, running: 1, registered: 1 });
  });
});

describe('lib/runlist.js: sumTokens (UT-246, DES-204)', () => {
  it('sums the four token columns', () => {
    expect(sumTokens({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 })).toBe(10);
  });
});
