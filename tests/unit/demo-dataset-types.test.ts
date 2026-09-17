// UT-259 (DES-212, ARCH-132, TASK-220, REQ-143): `src/dashboard/demo/dataset.js`'s `DEMO` map is
// authored FROM the engine's own wire fixture and type-locked to it (ARCH-132's own "the fiction
// cannot drift from the wire it imitates"), so this file is DES-212's "first test" — same
// convention as `dashboard-wire.ts`'s own header ("importing it before it exists is deliberate").
//
// Why this reuses `tests/fixtures/dashboard-wire.ts`'s ALLOWED_*/REQUIRED_* key-set tables rather
// than a compile-time `satisfies` cast: `DEMO: ReadonlyMap<string, unknown>` erases the value's
// type at the Map boundary, so a `satisfies` on a value PULLED OUT of the map only checks whatever
// shape the TEST asserts it has — it cannot catch the implementer writing a body that lies about
// its own shape. The SAME runtime key-set check `dashboard-disclosure.test.ts` (IT-165) already
// uses against REAL served bodies is reused here against DEMO's fabricated ones — one shape
// description, three consumers (the disclosure lock, this type lock, the UT input literals),
// exactly DES-212's own stated economy.
//
// Tier: unit — pure (no DOM, no fetch, no server).
//
// Red reason (measured): `src/dashboard/demo/dataset.js` does not exist — whole-file import
// failure.
import { describe, it, expect } from 'vitest';
import {
  ALLOWED_HOME_KEYS, REQUIRED_HOME_KEYS,
  ALLOWED_RUN_SUMMARY_KEYS, REQUIRED_RUN_SUMMARY_KEYS,
  ALLOWED_SYSTEM_KEYS, REQUIRED_SYSTEM_KEYS,
  ALLOWED_MODEL_ENTRY_KEYS, REQUIRED_MODEL_ENTRY_KEYS,
  ALLOWED_DAG_KEYS, REQUIRED_DAG_KEYS,
} from '../fixtures/dashboard-wire.js';

function assertKeySet(label: string, body: unknown, allowed: readonly string[], required: readonly string[]): void {
  expect(body, `${label}: DEMO has no body for this route`).toBeDefined();
  const keys = Object.keys(body as Record<string, unknown>);
  expect(keys.filter((k) => !allowed.includes(k)), `${label}: undeclared key(s)`).toEqual([]);
  expect(required.filter((k) => !keys.includes(k)), `${label}: missing required key(s)`).toEqual([]);
}

describe('demo/dataset.js: DEMO is type-locked to the real wire shapes (UT-259, DES-212)', () => {
  it('DEMO is a ReadonlyMap (no function, no fetch, no DOM export — ARCH-132\'s own api)', async () => {
    const mod = await import('../../src/dashboard/demo/dataset.js') as Record<string, unknown>;
    expect(mod['DEMO']).toBeInstanceOf(Map);
    expect(Object.keys(mod)).toEqual(['DEMO']); // "nothing else"
  });

  it('/api/home matches HomeView\'s key set', async () => {
    const { DEMO } = await import('../../src/dashboard/demo/dataset.js');
    assertKeySet('/api/home', DEMO.get('/api/home'), ALLOWED_HOME_KEYS, REQUIRED_HOME_KEYS);
  });

  it('/api/runs is an array, each row matching RunSummary\'s key set', async () => {
    const { DEMO } = await import('../../src/dashboard/demo/dataset.js');
    const body = DEMO.get('/api/runs') as unknown[];
    expect(Array.isArray(body), '/api/runs must be an array').toBe(true);
    expect(body.length, '/api/runs must carry at least one demo run').toBeGreaterThan(0);
    for (const row of body) assertKeySet('/api/runs[i]', row, ALLOWED_RUN_SUMMARY_KEYS, REQUIRED_RUN_SUMMARY_KEYS);
  });

  it('/api/system matches SystemInfoView\'s key set, with process pids in the fixed 99xxx band', async () => {
    const { DEMO } = await import('../../src/dashboard/demo/dataset.js');
    const body = DEMO.get('/api/system');
    assertKeySet('/api/system', body, ALLOWED_SYSTEM_KEYS, REQUIRED_SYSTEM_KEYS);
    const topN = (body as { process: { topN: Array<{ pid: number }> } }).process.topN;
    for (const p of topN) {
      expect(p.pid, 'demo process pid must be in 99000-99999').toBeGreaterThanOrEqual(99000);
      expect(p.pid).toBeLessThanOrEqual(99999);
    }
  });

  it('/api/models is an array, each row matching EnrichedModelEntry\'s key set', async () => {
    const { DEMO } = await import('../../src/dashboard/demo/dataset.js');
    const body = DEMO.get('/api/models') as unknown[];
    expect(Array.isArray(body), '/api/models must be an array').toBe(true);
    expect(body.length).toBeGreaterThan(0);
    for (const row of body) assertKeySet('/api/models[i]', row, ALLOWED_MODEL_ENTRY_KEYS, REQUIRED_MODEL_ENTRY_KEYS);
  });

  it('/api/runs/demo0001/dag matches the DAG payload\'s key set (TASK-220\'s own pinned run id)', async () => {
    const { DEMO } = await import('../../src/dashboard/demo/dataset.js');
    assertKeySet('/api/runs/demo0001/dag', DEMO.get('/api/runs/demo0001/dag'), ALLOWED_DAG_KEYS, REQUIRED_DAG_KEYS);
  });
});

describe('demo/dataset.js: every parametric id round-trips encodeURIComponent (UT-259, DES-212)', () => {
  it('every key that looks like a parametric route (workflow name / run id / agent id / issue number) survives encodeURIComponent unchanged', async () => {
    const { DEMO } = await import('../../src/dashboard/demo/dataset.js');
    const paramPatterns: RegExp[] = [
      /^\/api\/runs\/([^/]+)\/dag$/,
      /^\/api\/runs\/([^/]+)$/,
      /^\/api\/workflows\/([^/]+)\/describe$/,
      /^\/api\/runs\/([^/]+)\/agents\/([^/]+)$/,
      /^\/api\/issues\/([^/]+)$/,
    ];
    const badIds: string[] = [];
    for (const key of DEMO.keys()) {
      for (const re of paramPatterns) {
        const m = re.exec(key);
        if (!m) continue;
        for (const id of m.slice(1)) {
          if (encodeURIComponent(id) !== id) badIds.push(`${key} -> "${id}"`);
        }
      }
    }
    expect(badIds, 'a parametric id that does not round-trip encodeURIComponent produces a key poll.js can never match').toEqual([]);
  });

  it('every run id in DEMO starts "demo0001" (self-labelling in the DATA, per ARCH-132/TASK-220)', async () => {
    const { DEMO } = await import('../../src/dashboard/demo/dataset.js');
    const runs = DEMO.get('/api/runs') as Array<{ runId: string }>;
    for (const r of runs) expect(r.runId.startsWith('demo0001'), `run id "${r.runId}" must self-label`).toBe(true);
  });

  it('every workflow name in DEMO starts "demo-" (self-labelling)', async () => {
    const { DEMO } = await import('../../src/dashboard/demo/dataset.js');
    const homeBody = DEMO.get('/api/home') as { running: Array<{ name: string }>; registered: Array<{ name: string }>; other: Array<{ name: string }> };
    const names = [...homeBody.running, ...homeBody.registered, ...homeBody.other].map((c) => c.name);
    expect(names.length, 'the demo dataset must register at least one workflow card').toBeGreaterThan(0);
    for (const name of names) expect(name.startsWith('demo-'), `workflow name "${name}" must self-label`).toBe(true);
  });
});
