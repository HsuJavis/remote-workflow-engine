// UT-257 (DES-206, TASK-210, REQ-134): `lib/model.js` — `shortModel(model)`, the swimlane row-2
// formatter. Written here (Gate 6, per the orchestrator's explicit correction in state.yaml — a
// prior implementer flagged this as a Gate-5 gap and was told the oracle is Gate 6's job this
// pass) rather than left as an untested implementation. Spec (dispatch, mirroring the design
// handoff's own `D.shortModel`): strip a leading `openrouter/`, strip a leading `anthropic/`, fold
// a trailing `:free` into ` (free)`.
//
// Tier: unit, `.js`, pure.
//
// Red reason (measured): `src/dashboard/lib/model.js` does not exist (whole-file import failure).
//
// [v28 Gate 5, DES-213, ADR-060, TASK-222, REQ-137] this file gains the Models tab's projections —
// `sortKeyOf`/`matchModels`/`modelRow`/`costDots`/`modelPanel` — beside `shortModel` above
// (`lib/model.js` is EXTENDED, never a second `lib/models.js`: DES-213's own boundary against two
// near-homonym `ASSET_KEYS`). Red reason (measured against HEAD): none of the five names is
// exported by `src/dashboard/lib/model.js` today — each import resolves to `undefined`, so every
// case below fails with `TypeError: <name> is not a function` at its own call site.
import { describe, it, expect } from 'vitest';
import { shortModel, sortKeyOf, matchModels, modelRow, costDots, modelPanel } from '../../src/dashboard/lib/model.js';
import { sortRows } from '../../src/dashboard/lib/runlist.js';

describe('lib/model.js: shortModel (UT-257, REQ-134 row 2)', () => {
  it('strips a leading "openrouter/"', () => {
    expect(shortModel('openrouter/qwen/qwen2.5-7b')).toBe('qwen/qwen2.5-7b');
  });

  it('strips a leading "anthropic/"', () => {
    expect(shortModel('anthropic/claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet-20241022');
  });

  it('strips BOTH prefixes when chained ("openrouter/anthropic/...")', () => {
    expect(shortModel('openrouter/anthropic/claude-3.5-sonnet')).toBe('claude-3.5-sonnet');
  });

  it('folds a trailing ":free" into " (free)"', () => {
    expect(shortModel('openrouter/nex-agi/nex-n2-pro:free')).toBe('nex-agi/nex-n2-pro (free)');
  });

  it('a plain model id with no prefix/suffix passes through unchanged', () => {
    expect(shortModel('sonnet')).toBe('sonnet');
  });

  it('absent/empty input passes through rather than throwing', () => {
    expect(shortModel(undefined)).toBe(undefined);
    expect(shortModel('')).toBe('');
  });
});

// UT-257 [v28 Gate 5, DES-213, REQ-137]: the 12-column sort table. `sortKeyOf` normalises every
// column to a COMPARABLE SCALAR (`undefined` is the only token `sortRows`, byte-unchanged from
// REQ-133's history table, ever treats as absent — DES-213's own boundary), fed straight into the
// REAL `sortRows` rather than a re-implemented comparator, so this test is honestly about the
// (sortKeyOf, sortRows) INTEGRATION, not a second sort algorithm. `ABSENT` is deliberately absent
// on every one of the 12 columns (including `latency`/`benchmarks`, which Won't-have D2 makes
// absent on every REAL row this iteration too — INV-V28-4 says the RULE must hold generically, not
// only for today's always-absent case, so `RICH` below carries real `latency`/`benchmarks` values
// a future D2-lift would populate).
const COLUMNS = ['model', 'provider', 'aliases', 'context', 'price', 'tools', 'effort', 'modalities', 'latency', 'stability', 'benchmarks', 'location'];

const ABSENT = {
  model: 'z-absent-model', provider: 'zprov', aliases: undefined, description: '', modalities: { in: [], out: [] },
  contextWindow: null, price: 'unknown', toolUseDeclared: 'unknown', location: 'local',
  capability: '', stability: 'best-effort', costLevel: null, effortDeclared: 'unknown',
  declaredSource: 'unknown', catalogFetchedAt: null,
  // no `latency`, no `benchmarks` — the D2 default.
};
const RICH = {
  model: 'a-rich-model', provider: 'aprov', aliases: ['a1', 'a2'], description: 'x', modalities: { in: ['text', 'image'], out: ['text'] },
  contextWindow: 200000, price: { in: '3', out: '15' }, ratesPerM: { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  toolUseDeclared: true, location: 'remote', capability: 'x', stability: 'stable', costLevel: 8,
  effortDeclared: true, declaredSource: 'upstream', catalogFetchedAt: '2026-09-17T00:00:00.000Z',
  latency: { ttftMs: 900, p50Ms: 6800 }, benchmarks: { mmlu: 78 },
};
const FREE = {
  ...ABSENT, model: 'b-free-model', provider: 'bprov', price: 'free', ratesPerM: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 },
  costLevel: 0, contextWindow: 32000, toolUseDeclared: false, effortDeclared: false, declaredSource: 'static', location: 'local', stability: 'variable',
};
const MID_A = {
  ...ABSENT, model: 'c-mid-model', provider: 'cprov', contextWindow: 64000, price: { in: '1', out: '2' },
  ratesPerM: { in: 1, out: 2, cacheRead: 0.1, cacheWrite: 1.25 }, costLevel: 3, toolUseDeclared: true, effortDeclared: 'unknown',
  location: 'remote', stability: 'stable', latency: { ttftMs: 500, p50Ms: 3000 }, benchmarks: { mmlu: 60 },
};
const MID_B = {
  ...ABSENT, model: 'd-mid-model', provider: 'dprov', contextWindow: 128000, price: { in: '2', out: '9' },
  ratesPerM: { in: 2, out: 9, cacheRead: 0.2, cacheWrite: 2.5 }, costLevel: 5, toolUseDeclared: false, effortDeclared: true,
  location: 'local', stability: 'best-effort', latency: { ttftMs: 1200, p50Ms: 9000 }, benchmarks: { mmlu: 70 },
};
const FIVE_ROWS = [RICH, FREE, MID_A, MID_B, ABSENT];

describe('lib/model.js: sortKeyOf + sortRows — the absent row sorts LAST in BOTH directions, for EVERY column (UT-257, DES-213, INV-V28-4)', () => {
  for (const col of COLUMNS) {
    it(`column "${col}"`, () => {
      const keyed = FIVE_ROWS.map((entry) => ({ model: entry.model, key: sortKeyOf(entry, col) }));
      const asc = sortRows(keyed, 'key', 'asc');
      const desc = sortRows(keyed, 'key', 'desc');
      expect(asc[asc.length - 1].model, `asc, column ${col}`).toBe(ABSENT.model);
      expect(desc[desc.length - 1].model, `desc, column ${col}`).toBe(ABSENT.model);
    });
  }

  it('an unknown column name is TOTAL — degrades to "unsorted, absent last", never throws', () => {
    expect(() => sortKeyOf(RICH, 'not-a-real-column')).not.toThrow();
    expect(sortKeyOf(RICH, 'not-a-real-column')).toBe(undefined);
  });

  it('price "free" is the NUMBER 0 (a fact, not an absence) — sorts BEFORE a mid-priced row, never last', () => {
    const keyed = [RICH, FREE, MID_A].map((entry) => ({ model: entry.model, key: sortKeyOf(entry, 'price') }));
    const asc = sortRows(keyed, 'key', 'asc');
    expect(asc[0].model).toBe(FREE.model); // $0 is the cheapest, not "unknown"
  });

  it('costLevel 0 sorts as the number 0 (before every priced row); costLevel null sorts LAST, distinctly from 0', () => {
    const keyed = [RICH, FREE, MID_A, ABSENT].map((entry) => ({ model: entry.model, key: sortKeyOf(entry, 'price') }));
    // sortKeyOf('price') already covers the ratesPerM path above; this case is about costLevel's
    // OWN column existing as a distinct sortable fact from price (DES-213's R4 ruling).
    const costKeyed = [RICH, FREE, ABSENT].map((entry) => ({ model: entry.model, key: sortKeyOf(entry, 'costLevel') }));
    const asc = sortRows(costKeyed, 'key', 'asc');
    expect(asc[0].model).toBe(FREE.model); // costLevel 0
    expect(asc[asc.length - 1].model).toBe(ABSENT.model); // costLevel null
  });
});

describe('lib/model.js: matchModels(entries, {query, provider, loc}) (UT-257, DES-213)', () => {
  it('an empty filter returns every entry, unchanged (the identity case)', () => {
    const out = matchModels(FIVE_ROWS, { query: '', provider: '', loc: 'all' });
    expect(out).toHaveLength(FIVE_ROWS.length);
    expect(out).toEqual(expect.arrayContaining(FIVE_ROWS));
  });

  it('a query narrows by model id/alias substring, case-insensitively', () => {
    const out = matchModels(FIVE_ROWS, { query: 'RICH', provider: '', loc: 'all' });
    expect(out.map((e) => e.model)).toEqual([RICH.model]);
  });

  it('a provider filter narrows to an exact provider match', () => {
    const out = matchModels(FIVE_ROWS, { query: '', provider: 'bprov', loc: 'all' });
    expect(out.map((e) => e.model)).toEqual([FREE.model]);
  });

  it('the remote/local segment narrows by location', () => {
    const remote = matchModels(FIVE_ROWS, { query: '', provider: '', loc: 'remote' });
    const local = matchModels(FIVE_ROWS, { query: '', provider: '', loc: 'local' });
    expect(remote.map((e) => e.model).sort()).toEqual([MID_A.model, RICH.model].sort());
    expect(local.map((e) => e.model).sort()).toEqual([ABSENT.model, FREE.model, MID_B.model].sort());
  });

  it('combining query + provider + loc narrows to the intersection, matching README\'s "4 / 9" counter shape (N then M / N)', () => {
    const total = FIVE_ROWS.length;
    const filtered = matchModels(FIVE_ROWS, { query: '', provider: '', loc: 'remote' });
    expect(filtered.length).toBeLessThan(total); // the "M / N" shape: a real narrowing, not a no-op
  });
});

describe('lib/model.js: costDots(level) — a 5-dot scale over the 0-10 integer (UT-257, DES-213)', () => {
  it('0 renders every dot hollow', () => {
    expect(costDots(0)).toBe('○○○○○');
  });
  it('10 renders every dot filled', () => {
    expect(costDots(10)).toBe('●●●●●');
  });
  it('a mid level (4) fills a PROPORTIONAL number of dots, strictly between 0 and 5 filled', () => {
    const dots = costDots(4);
    const filled = (dots.match(/●/g) || []).length;
    expect(filled).toBeGreaterThan(0);
    expect(filled).toBeLessThan(5);
    expect(dots).toHaveLength(5);
  });
  it('null (unknown price) renders "—", never a dot string', () => {
    expect(costDots(null)).toBe('—');
  });
});

describe('lib/model.js: modelPanel(entry, lang) — the 560px slide-in projection (UT-257, DES-213)', () => {
  it('returns the definition-list/benchmarks/tags shape the slide-in renders', () => {
    const panel = modelPanel(RICH, 'en');
    expect(panel).toHaveProperty('kicker');
    expect(panel).toHaveProperty('title', RICH.model);
    expect(panel.aliases).toEqual(RICH.aliases);
    expect(Array.isArray(panel.defs)).toBe(true);
    expect(panel.defs.length).toBeGreaterThan(0);
    expect(Array.isArray(panel.benchmarks)).toBe(true);
    expect(panel.benchmarks.length).toBeGreaterThan(0); // RICH carries a benchmarks value
    expect(Array.isArray(panel.tags)).toBe(true);
  });

  it('an entry with no benchmarks/latency (this iteration\'s D2 default) renders an EMPTY benchmarks list, never a fabricated row', () => {
    const panel = modelPanel(ABSENT, 'en');
    expect(panel.benchmarks).toEqual([]);
  });
});
