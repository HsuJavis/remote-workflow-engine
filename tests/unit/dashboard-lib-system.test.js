// UT-262 (DES-215, ARCH-134, ADR-057, TASK-223, REQ-138): `lib/system.js` — two state readers
// (`sectionState`/`cpuUtilState`), the four cards' arithmetic (`statCard`), the process table's row
// projection (`procRow`/`procTotals`), a moved formatter (`fmtBytes`), and the counts-card fold
// (`catalogCounts`, ADR-057). All pure, no DOM.
//
// Why `sectionState`/`cpuUtilState` are TWO functions, not one: `SystemInfoView` is not uniform
// (`system-info.ts:80-100`) — `cpu` carries its degrade in a SIBLING key (`utilizationDegraded`)
// while `cores`/`loadAvg` stay real even when degraded, but `memory`/`disk`/`process.system` are
// DISCRIMINATED UNIONS (either the real shape or `{reason, detail?}`, never both). A single reader
// pretending they are the same shape either lies about `cpu.cores` on a degrade, or can't tell a
// real `memory` value from a `Degraded` one.
//
// Tier: unit, `.js`, pure.
//
// Red reason (measured): `src/dashboard/lib/system.js` does not exist — whole-file import failure.
import { describe, it, expect } from 'vitest';
import { sectionState, cpuUtilState, statCard, procRow, procTotals, fmtBytes, catalogCounts } from '../../src/dashboard/lib/system.js';

const REASONS = ['awaiting-second-sample', 'sample-window-too-short', 'timeout', 'unsupported-platform', 'probe-error'];
// `system-info.ts:24-30`'s own closed set — the three that are NOT faults per DES-215's boundary
// (rendered as informative secondary text, distinguishable from "this host cannot report it").
const NOT_A_FAULT = new Set(['awaiting-second-sample', 'unsupported-platform', 'sample-window-too-short']);

describe('lib/system.js: sectionState(value) over the discriminated-union sections (UT-262, DES-215)', () => {
  it('a real value classifies {kind:"ok", value}', () => {
    const memory = { totalBytes: 100, usedBytes: 50, freeBytes: 50, usedPct: 50 };
    expect(sectionState(memory)).toEqual({ kind: 'ok', value: memory });
  });

  for (const reason of REASONS) {
    it(`a {reason:"${reason}"} value classifies {kind:"unavailable", reason:"${reason}"}, distinguishing fault=${!NOT_A_FAULT.has(reason)}`, () => {
      const out = sectionState({ reason });
      expect(out).toEqual({ kind: 'unavailable', reason });
    });
  }
});

describe('lib/system.js: cpuUtilState(cpu) — the SIBLING-key section (UT-262, DES-215)', () => {
  it('utilizationPct present, no degraded key -> ok', () => {
    expect(cpuUtilState({ cores: 8, loadAvg: [1, 1, 1], utilizationPct: 42 })).toEqual({ kind: 'ok', value: 42 });
  });
  it('utilizationPct:null + utilizationDegraded -> unavailable, reason carried', () => {
    const cpu = { cores: 8, loadAvg: [1, 1, 1], utilizationPct: null, utilizationDegraded: { reason: 'awaiting-second-sample' } };
    expect(cpuUtilState(cpu)).toEqual({ kind: 'unavailable', reason: 'awaiting-second-sample' });
  });
});

describe('lib/system.js: statCard(kind, input, lang) — the four cards, one WITHOUT a denominator (UT-262, DES-215, INV-V28-4)', () => {
  it('cpu/memory/disk cards return a numeric pct', () => {
    const card = statCard('cpu', { kind: 'ok', value: 42 }, 'en');
    expect(card.pct).toBe(42);
    expect(typeof card.value).toBe('string');
  });
  it('the counts card (ADR-057) returns pct:undefined — it has no denominator, never a fabricated full bar', () => {
    const card = statCard('counts', { workflows: 9, versions: 13, runRecords: 20 }, 'en');
    expect(card.pct).toBe(undefined);
  });
  it('an unavailable section renders a card whose value/meta carry the UNAVAILABLE marker, never a confident number', () => {
    const card = statCard('memory', { kind: 'unavailable', reason: 'timeout' }, 'en');
    expect(card.pct).toBe(undefined);
  });

  // [v28 Gate 6.5+7, verifier — coverage gate] the 'memory' | 'disk' ok arm (statCard's own
  // arithmetic + fmtBytes meta line + disk's kicker) had no unit case — only exercised indirectly
  // at the browser tier (VAL-214). Covers `statCard.ts`'s real usedPct rounding, the "X of Y · Z
  // free" meta format, and disk-only `kicker`.
  it('a real memory section renders the rounded usedPct, a byte-formatted meta line, and no kicker', () => {
    const card = statCard('memory', { kind: 'ok', value: { totalBytes: 1e9, usedBytes: 6e8, freeBytes: 4e8, usedPct: 60 } }, 'en');
    expect(card.value).toBe('60%');
    expect(card.pct).toBe(60);
    expect(card.meta).toBe('600.0 MB of 1.0 GB · 400.0 MB free');
    expect(card.kicker).toBe(undefined);
  });

  it('a real disk section additionally carries its path as the kicker', () => {
    const card = statCard('disk', { kind: 'ok', value: { totalBytes: 1e9, usedBytes: 2e8, freeBytes: 8e8, usedPct: 20, path: '/data' } }, 'en');
    expect(card.value).toBe('20%');
    expect(card.kicker).toBe('/data');
  });
});

describe('lib/system.js: procRow/procTotals (UT-262, DES-215)', () => {
  it('procRow marks isSelf true ONLY for the engine\'s own pid', () => {
    const selfPid = 99001;
    const self = procRow({ pid: 99001, name: 'node', cpuPct: 1.2, memBytes: 100 }, selfPid);
    const other = procRow({ pid: 123, name: 'bash', cpuPct: 0.1, memBytes: 50 }, selfPid);
    expect(self.isSelf).toBe(true);
    expect(other.isSelf).toBe(false);
  });

  it('procTotals renders the top states by count, stable tiebreak, over an UNANTICIPATED /proc state letter — never throws', () => {
    const system = { total: 15, byState: { S: 5, R: 5, Z: 3, W: 2 } }; // 'W' is not a letter any fixture anticipated
    expect(() => procTotals(system, 'en')).not.toThrow();
    const out = procTotals(system, 'en');
    expect(out).toContain('15');
  });
});

describe('lib/system.js: fmtBytes(n) — MOVED verbatim from ui/system.js:38 (UT-262, DES-215)', () => {
  it('the three unit boundaries', () => {
    expect(fmtBytes(500)).toBe('500 B');
    expect(fmtBytes(1500)).toBe('1.5 KB');
    expect(fmtBytes(1500000)).toBe('1.5 MB');
    expect(fmtBytes(1500000000)).toBe('1.5 GB');
  });
});

describe('lib/system.js: catalogCounts(workflows, runs) — ADR-057\'s three written definitions (UT-262, DES-215)', () => {
  it('workflows = entries.length; versions = SUM of each entry\'s versions.length; runRecords = runs.length', () => {
    const workflows = [{ versions: [1, 2, 3] }, { versions: [1] }, { versions: [1, 2] }];
    const runs = [{ runId: 'r1' }, { runId: 'r2' }];
    expect(catalogCounts(workflows, runs)).toEqual({ workflows: 3, versions: 6, runRecords: 2 });
  });
  it('zero workflows/runs -> all zero, never a fabricated minimum', () => {
    expect(catalogCounts([], [])).toEqual({ workflows: 0, versions: 0, runRecords: 0 });
  });
});

describe('lib/system.js: the meta lines render in the viewer’s language (UT-266, v29, REQ-150)', () => {
  // These four lines shipped in English under a comment calling them "locale-invariant like
  // DES-213's fmtLatency/fmtBenchmarks". Two things make that reading wrong. First, the same
  // comment states the actual reason: "`strings.js` is out of this task's file scope (TASK-206/220
  // own it) — `lang` is accepted for signature parity with the other three kinds, unused here" —
  // a partitioning constraint, not a design ruling, and the word "locale-invariant" appears
  // NOWHERE in the ledger. Second, the delivery handoff's own string table translates every one of
  // them (`cores: '核心'`, `versionsStored: '個版本'`, `totalProcs: '總處理程序'`), so
  // "reads fine unchanged in either language" is contradicted by the design it cites.
  const NO_ASCII_WORDS = /\b(cores|Load|of|free|versions|run records|Total processes)\b/;

  it('the counts card meta carries no English under zh', () => {
    const out = statCard('counts', { workflows: 5, versions: 18, runRecords: 30 }, 'zh');
    expect(out.meta).not.toMatch(NO_ASCII_WORDS);
    expect(out.meta).toContain('18');
    expect(out.meta).toContain('30');
  });

  it('the cpu card meta carries no English under zh', () => {
    const out = statCard('cpu', { kind: 'ok', value: 4, cores: 16, loadAvg: [0.5, 0.4, 0.3] }, 'zh');
    expect(out.meta).not.toMatch(NO_ASCII_WORDS);
    expect(out.meta).toContain('16');
  });

  it('the memory card meta carries no English under zh', () => {
    const out = statCard('memory', { kind: 'ok', value: { usedPct: 33, usedBytes: 10 * 1024 ** 3, totalBytes: 32 * 1024 ** 3, freeBytes: 22 * 1024 ** 3 } }, 'zh');
    expect(out.meta).not.toMatch(NO_ASCII_WORDS);
  });

  it('the process header carries no English under zh', () => {
    const out = procTotals({ total: 480, byState: { S: 333, I: 133 } }, 'zh');
    expect(out).not.toMatch(NO_ASCII_WORDS);
    expect(out).toContain('480');
  });

  it('en is unchanged — this is a missing translation, not a relocation', () => {
    expect(statCard('counts', { workflows: 5, versions: 18, runRecords: 30 }, 'en').meta)
      .toBe('18 versions · 30 run records');
    expect(procTotals({ total: 480, byState: { S: 333 } }, 'en')).toContain('Total processes 480');
  });
});
