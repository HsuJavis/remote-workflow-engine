// v8 Defer A — crash durability (REQ-059 journal read-back replay + REQ-060 crash-resumable).
// TEST-FIRST (RED).
//
// REQ-059: after a restart, a resumed run replays its already-journaled agent() calls from the
//   persisted journal (a new getJournal read-back populating the ResumeCache) — the gateway is NOT
//   re-invoked for a journaled call. Today _requireLive hard-codes journal:[] so resume re-runs
//   everything live.
// REQ-060: a run that was `running` when the engine crashed comes back RESUMABLE (not `failed`) at
//   boot (hydrateAll), and resuming it completes, serving the pre-crash agent() from the journal.
//
// Mock policy (integration tier, mirrors IT-025/IT-026 + suspend-resume-replay): real RunManager +
// real on-disk SqliteRunStore + real sandbox child; only the GatewayClient faked. A gateway that
// resolves 'A' immediately but BLOCKS on 'B' lets us catch the run mid-second-call (A journaled, B
// in flight). "restart" = fresh RunManager/store on the SAME data dir.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { RunManager } from '../../src/run-manager.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { registerPublished, startScript } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));
const SCRIPT = `const a = await agent('A', {}); const b = await agent('B', {}); return { a, b };`;

/** Process-1 gateway: resolves 'A' immediately, BLOCKS 'B' forever (never released), counts calls.
 *  `bReached` resolves once 'B' is first dispatched (so the run is caught mid-second-call). */
function blockingGateway() {
  const counts = new Map<string, number>();
  let bReachedResolve: () => void = () => {};
  const bReached = new Promise<void>((r) => { bReachedResolve = r; });
  const gateway: GatewayClient = {
    async invoke(req) {
      counts.set(req.prompt, (counts.get(req.prompt) ?? 0) + 1);
      if (req.prompt === 'B') { bReachedResolve(); await new Promise<void>(() => {}); } // block B forever
      return { ok: true, provider: 'fake', model: 'fake', tokens: { input: 1, output: 1 }, content: req.prompt };
    },
  };
  return { gateway, counts, bReached };
}

/** Process-2 gateway: resolves EVERY prompt immediately, counts calls (proves which calls the resumed
 *  process actually dispatched vs served from the journal). */
function countingGateway() {
  const counts = new Map<string, number>();
  const gateway: GatewayClient = {
    async invoke(req) {
      counts.set(req.prompt, (counts.get(req.prompt) ?? 0) + 1);
      return { ok: true, provider: 'fake', model: 'fake', tokens: { input: 1, output: 1 }, content: req.prompt };
    },
  };
  return { gateway, counts };
}

async function pollStatus(mgr: RunManager, runId: string, want: string, tries = 200) {
  let v = await mgr.status(runId);
  for (let i = 0; i < tries && v.status !== want; i++) { await new Promise((r) => setTimeout(r, 20)); v = await mgr.status(runId); }
  return v;
}

describe('crash durability (v8 Defer A, REQ-059/060)', () => {
  it('REQ-059 resume-after-restart replays a journaled agent() from the journal (gateway NOT re-invoked)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-crash-'));
    try {
      // process 1: A resolves + journals, B blocks → suspend while B in flight
      const store1 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      const g1 = blockingGateway();
      const mgr1 = new RunManager({ store: store1, clock: CLOCK, workRoot: dir, gateway: g1.gateway });
      const runId = await startScript(mgr1, SCRIPT);
      await g1.bReached;                    // A already journaled; B in flight
      expect(g1.counts.get('A')).toBe(1);
      await mgr1.suspend(runId);
      await new Promise((r) => setTimeout(r, 100));

      // "restart": fresh store + manager on the SAME dir; a gateway that would resolve BOTH.
      const store2 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      await store2.hydrateAll();
      const g2 = countingGateway();                          // don't block B this time
      const mgr2 = new RunManager({ store: store2, clock: CLOCK, workRoot: dir, gateway: g2.gateway });

      await mgr2.resume(runId);
      const done = await pollStatus(mgr2, runId, 'completed');
      expect(done.status).toBe('completed');
      const result = await mgr2.result(runId);
      expect(result.ok && result.value).toEqual({ a: 'A', b: 'B' });
      // RED today: g2 re-invokes 'A' because the rehydrated journal is empty. After the read-back fix,
      // 'A' is served from the persisted journal and only 'B' is dispatched in process 2.
      expect(g2.counts.get('A')).toBeUndefined();
      expect(g2.counts.get('B')).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30000);

  it('REQ-060 a run interrupted by a crash comes back RESUMABLE (not failed) and resumes to completion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-crash2-'));
    try {
      // process 1: reach B (A journaled, run still 'running'), then CRASH — abandon mgr1 without suspend.
      const store1 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      const g1 = blockingGateway();
      const mgr1 = new RunManager({ store: store1, clock: CLOCK, workRoot: dir, gateway: g1.gateway });
      const runId = await startScript(mgr1, SCRIPT);
      await g1.bReached;
      const midRun = await store1.getRun(runId);
      expect(midRun?.status).toBe('running'); // genuinely running at the "crash" instant

      // "restart": boot recovery on the same dir. RED today: hydrateAll marks it 'failed'.
      const store2 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      await store2.hydrateAll();
      const recovered = await store2.getRun(runId);
      expect(recovered?.status).not.toBe('failed'); // must be resumable, not a dead 'failed'

      const g2 = countingGateway();
      const mgr2 = new RunManager({ store: store2, clock: CLOCK, workRoot: dir, gateway: g2.gateway });
      await mgr2.resume(runId);               // must be accepted (interrupted → resumable)
      const done = await pollStatus(mgr2, runId, 'completed');
      expect(done.status).toBe('completed');
      expect(g2.counts.get('A')).toBeUndefined(); // pre-crash agent served from the journal
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30000);

  it('REQ-060 a NAMED-workflow run resumes to the CORRECT result after a crash (script re-resolved from catalog)', async () => {
    // Regression: a named run stores no inline script on its spec, so a naive rehydrate ran an empty
    // script → undefined result. The resumed run must re-resolve the script from the catalog.
    const dir = mkdtempSync(join(tmpdir(), 'rwe-crash-named-'));
    try {
      const catalog = new WorkflowCatalog(join(dir, 'wf'), CLOCK);
      await registerPublished(catalog, 'two-step', SCRIPT); // `const a=agent('A', {}); const b=agent('B', {}); return {a,b}`
      const store1 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      const g1 = blockingGateway();
      const mgr1 = new RunManager({ store: store1, clock: CLOCK, workRoot: dir, catalog, gateway: g1.gateway });
      const runId = await mgr1.start({ name: 'two-step' }); // NAMED run — no inline script on the spec
      await g1.bReached;

      const store2 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      await store2.hydrateAll();
      const g2 = countingGateway();
      const mgr2 = new RunManager({ store: store2, clock: CLOCK, workRoot: dir, catalog: new WorkflowCatalog(join(dir, 'wf'), CLOCK), gateway: g2.gateway });
      await mgr2.resume(runId);
      const done = await pollStatus(mgr2, runId, 'completed');
      expect(done.status).toBe('completed');
      const result = await mgr2.result(runId);
      expect(result.ok && result.value).toEqual({ a: 'A', b: 'B' }); // NOT undefined — script re-resolved
      expect(g2.counts.get('A')).toBeUndefined();                     // A replayed from journal
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30000);

  it('REQ-059 getJournal returns settled entries (not the result marker); unknown run → []', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-gj-'));
    try {
      const store = new SqliteRunStore(join(dir, 'store'), CLOCK);
      const g = countingGateway();
      const mgr = new RunManager({ store, clock: CLOCK, workRoot: dir, gateway: g.gateway });
      const runId = await startScript(mgr, SCRIPT);
      await pollStatus(mgr, runId, 'completed');
      const entries = await store.getJournal(runId);
      expect(entries.map((e) => e.key.prompt).sort()).toEqual(['A', 'B']); // the two settled agent calls
      expect(entries.every((e) => typeof e.callSeq === 'number')).toBe(true);
      expect(await store.getJournal('no-such-run')).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 20000);

  // v22 adjudication #2 (L-2) + adjudication #1 (K-4): `RunSpec.script` was RETAINED precisely for
  // the PRE-v22 persisted-spec read-back — a run suspended before REQ-098 shipped still has to get
  // its own script back on resume (`run-manager.ts`: `let script = spec.script ?? ''`, taken whenever
  // the spec carries a script and no name). Every other case in this file now starts a NAMED run, so
  // without this one the retained field has zero coverage and reads as dead code next iteration.
  // `start()` can no longer PRODUCE that shape, so the spec is seeded straight against the store —
  // the same store-level pattern `run-store-persistence.test.ts` uses (and which is green).
  it('REQ-060/K-4 a PRE-v22 persisted spec (inline script, no name) resumes FROM that persisted script', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-crash-legacy-spec-'));
    try {
      const store1 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      const runId = await store1.createRun({ script: `const a = await agent('A', {}); return { a };` });
      await store1.recordTransition(runId, null, 'queued', CLOCK.isoNow());
      await store1.recordTransition(runId, 'queued', 'running', CLOCK.isoNow());

      // "crash + restart": hydrateAll re-classifies the running run as interrupted (resumable).
      const store2 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      await store2.hydrateAll();
      const recovered = await store2.getRun(runId);
      expect(recovered?.status).not.toBe('failed');

      const g2 = countingGateway();
      const mgr2 = new RunManager({ store: store2, clock: CLOCK, workRoot: dir, gateway: g2.gateway });
      await mgr2.resume(runId);
      const done = await pollStatus(mgr2, runId, 'completed');
      expect(done.status).toBe('completed');
      const result = await mgr2.result(runId);
      // The PERSISTED script really executed. An empty script resolves to `undefined` here — the
      // exact failure mode the named-workflow case above was written for, one branch over.
      expect(result.ok && result.value).toEqual({ a: 'A' });
      expect(g2.counts.get('A')).toBe(1); // nothing journaled pre-crash, so 'A' is genuinely dispatched
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30000);
});
