// IT-122 (v24 integrator; adjudication (v24) #4 C-7 [28], DES-146/DES-156 boundary):
// resuming a run whose PERSISTED admission snapshot predates the per-agent parameter contract must
// answer LEGACY_REREGISTER, not silently continue on the run-wide flat fields.
//
// The defect this pins. Every v24 admission writes an `.agents` slice into `effective_params`
// (`{}` at minimum — `contract.agents` is always passed to defaultRunParams/mergeRunParams), so a
// snapshot with NO `agents` key is, by construction, a pre-v24 row. `_requireLive` read that row
// back and used it verbatim: the resumed run dispatched with no per-label model/effort/timeoutMs at
// all, silently degraded to whatever the run-wide fields happened to be, and the caller was told
// nothing. `LEGACY_REREGISTER` is the code the design already assigns to exactly this condition —
// `workflow_describe`/`workflow_list` report it as `runnableReason` for the same versions — so the
// refusal a resumer meets here now matches what the read surfaces were already saying.
//
// Written RED first against the tree: before the fix, `resume()` resolved and the run continued.
//
// Mock policy (integration): a REAL SqliteRunStore on disk and a REAL RunManager. The gateway is
// replaced by a trivial spawner so the test needs no provider — the subject is the readback
// decision, which happens before any dispatch. The legacy row is produced by WRITING the pre-v24
// column shape directly, because no v24 code path can produce one any more; that is the only
// honest way to fixture a row this version of the engine cannot create.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { RunManager } from '../../src/run-manager.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { AgentSpawner, AgentOutcome } from '../../src/agent-executor.js';
import { registerPublished } from '../helpers/workflow-fixtures.js';

const clock = new FixedClock(new Date('2024-01-01T00:00:00.000Z'));
const spawner: AgentSpawner = { run: async (): Promise<AgentOutcome> => ({ kind: 'text', value: 'ok' }) };

/** The pre-v24 flat snapshot shape, verbatim: tunable fields at the top level, `provenance`, and —
 *  the discriminator — NO `agents` key. */
const LEGACY_FLAT_PARAMS = JSON.stringify({
  model: 'default',
  effort: 'low',
  timeoutMs: 30_000,
  provenance: { model: 'default', effort: 'default', timeoutMs: 'default', appendPrompt: 'engine' },
});

describe('resume readback of a pre-v24 params snapshot (IT-122, C-7 [28])', () => {
  it('a stored FLAT (pre-v24) effective_params refuses LEGACY_REREGISTER on resume instead of silently degrading', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it122-'));
    try {
      const store = new SqliteRunStore(join(dir, 'store'), clock);
      const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
      const name = 'it122-legacy-params';
      await registerPublished(mgr.catalog, name, "return await agent('worker', { prompt: 'go' });");
      const runId = await mgr.start({ name });
      await mgr.suspend(runId);

      // Overwrite this run's snapshot with the pre-v24 shape — the state a database written by a
      // v23 engine is actually in after an upgrade.
      const db = new Database(join(dir, 'store', 'index.db'));
      db.prepare('UPDATE runs SET effective_params = ? WHERE runId = ?').run(LEGACY_FLAT_PARAMS, runId);
      db.close();

      // A FRESH RunManager over the same store: no in-process entry for this runId, so resume must
      // go through the readback path (`_requireLive`) — exactly the post-restart case.
      const mgr2 = new RunManager({ store, clock, workRoot: dir, spawner } as never);
      await expect(mgr2.resume(runId)).rejects.toMatchObject({ code: 'LEGACY_REREGISTER' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  it('a v24 snapshot (an `agents` slice present, even empty) resumes normally — the check keys off the shape, not on "params exist"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it122b-'));
    try {
      const store = new SqliteRunStore(join(dir, 'store'), clock);
      const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
      const name = 'it122-v24-params';
      await registerPublished(mgr.catalog, name, "return await agent('worker', { prompt: 'go' });");
      const runId = await mgr.start({ name });
      await mgr.suspend(runId);

      const stored = await store.getEffectiveParams(runId);
      expect(stored?.agents, 'a v24 admission must always persist an agents slice').toBeDefined();

      const mgr2 = new RunManager({ store, clock, workRoot: dir, spawner } as never);
      await expect(mgr2.resume(runId)).resolves.not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  // IT-177 (DES-228, ARCH-140, TASK-229, REQ-204, ADR-064 baseline (A)): a stored `effective_params`
  // snapshot carrying BOTH `.agents` (v24-shaped) AND a `tools` key (the retired `RunParams.tools`
  // rung, `resolve.ts:50`) must be refused `LEGACY_REREGISTER` on resume, same as the `.agents`-
  // absent case above — a resumed run silently widening its tool surface via a dead field is a
  // security-relevant capability EXPANSION, not mere content loss. Red reason: today's resume guard
  // discriminates purely on `.agents` presence (`run-manager.ts:1038`) — a `tools` key alongside a
  // present `.agents` resumes normally.
  it('a stored effective_params carrying BOTH .agents (present) AND a legacy `tools` key refuses LEGACY_REREGISTER on resume (DES-228 baseline A)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it177-'));
    try {
      const store = new SqliteRunStore(join(dir, 'store'), clock);
      const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
      const name = 'it177-legacy-tools';
      await registerPublished(mgr.catalog, name, "return await agent('worker', { prompt: 'go' });");
      const runId = await mgr.start({ name });
      await mgr.suspend(runId);

      const stored = await store.getEffectiveParams(runId);
      expect(stored?.agents, 'a v24 admission must always persist an agents slice').toBeDefined();
      const widened = JSON.stringify({ ...stored, tools: ['Read'] });
      const db = new Database(join(dir, 'store', 'index.db'));
      db.prepare('UPDATE runs SET effective_params = ? WHERE runId = ?').run(widened, runId);
      db.close();

      const mgr2 = new RunManager({ store, clock, workRoot: dir, spawner } as never);
      await expect(mgr2.resume(runId)).rejects.toMatchObject({ code: 'LEGACY_REREGISTER' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});

// IT-176 (DES-226, ARCH-137, ADR-063, TASK-229, REQ-203/REQ-096): a STORED pre-v34 script re-run
// through the REAL run-manager (not a unit-level `executor.run()` call — TASK-229's own DoD names
// this distinction: "observable through workflow_status, not merely a unit-level throw") is refused
// at dispatch rather than dispatching with a silently-inert `agentType`.
//
// The legacy row is produced by WRITING the pre-v34 script text directly into `catalog.db`, same
// technique as `LEGACY_FLAT_PARAMS` above: no v34-and-later `workflow_register` can produce a
// stored script carrying `agentType:` any more (DES-224 refuses it at registration), so this is the
// only honest way to fixture a row this version of the engine cannot create — exactly the shape a
// pre-v34 catalog migrated forward actually holds.
//
// Red reason: today `agentType` resolves against `this._agentTypes` (empty here) inside
// `AgentExecutor.run()` and throws a PLAIN, uncoded `Error('Unknown agentType: reviewer')` — the run
// still reaches a failed terminal state (this part is NOT red), but the per-agent record's `detail`
// never mentions v34 retirement or the guide, because that message does not exist yet.
//
// NOTE on `detail.violation` (DES-226's THROWN error's `.detail` object, distinct from the STRING
// passed to `_sink.capture`): `run-manager.ts`'s `toErr()` (:153-159) keeps only `{code, message}`
// off a caught error and drops `.detail` entirely, so the structured `AGENT_OPT_RETIRED` marker is
// NOT reachable through `mgr.status()`'s run-level `error` today — only the per-agent record's
// `detail` STRING is (via `_sink.capture`, before the throw). This test asserts against that
// string, matching DES-226's own literal wording, not the thrown object's `.detail.violation`
// field (UT-273 asserts that one directly). Flagged in this gate's report as a `files:`/DoD
// question for the implementer: TASK-229's DoD says `detail.violation` must be "observable through
// workflow_status", which is true of the per-agent string's CONTENT but not of a structured field
// at the run level unless `toErr` is widened to forward `.detail`.
import { AgentExecutor } from '../../src/agent-executor.js';
import type { GatewayClient } from '../../src/gateway/client.js';

describe('a pre-v34 pinned script carrying agentType is refused at DISPATCH, not silently degraded (IT-176, DES-226)', () => {
  it('run reaches a FAILED terminal state; the agent record detail names the v34 retirement and points at the guide, visible through workflow_status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it176-'));
    try {
      const store = new SqliteRunStore(join(dir, 'store'), clock);
      const neverDispatched: GatewayClient = { invoke: async () => { throw new Error('must not be called — refused pre-dispatch'); } };
      const executor = new AgentExecutor({ gateway: neverDispatched, store });
      const mgr = new RunManager({ store, clock, workRoot: dir, spawner: executor } as never);
      const name = 'it176-pinned-agenttype';
      const cleanScript =
        `export const meta = { params: { agents: { a: { ` +
        `model: { type: 'string', default: 'default' }, ` +
        `effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, ` +
        `timeoutMs: { type: 'number', default: 60000 } } } } };\n` +
        `phase('Work');\n` +
        `return await agent('a', {});`;
      await registerPublished(mgr.catalog, name, cleanScript);

      // Rewrite the stored script to the pre-v34 shape DIRECTLY — the only honest fixture, since no
      // v34+ registration can produce this row any more (DES-224 refuses it at registration time).
      const pinnedScript = cleanScript.replace("agent('a', {})", "agent('a', { agentType: 'reviewer' })");
      const catalogDb = new Database(join(dir, 'catalog.db'));
      catalogDb.prepare('UPDATE workflow_versions SET script = ? WHERE name = ?').run(pinnedScript, name);
      catalogDb.close();

      const runId = await mgr.start({ name });
      let terminal: { status?: string; agents?: Array<{ state?: string; detail?: string }> } | undefined;
      for (let i = 0; i < 50; i++) {
        const s = await mgr.status(runId) as unknown as { status?: string; agents?: Array<{ state?: string; detail?: string }> };
        if (s.status !== 'queued' && s.status !== 'running') { terminal = s; break; }
        await new Promise((r) => setTimeout(r, 40));
      }
      expect(terminal?.status).toBe('failed');
      const agentDetail = terminal?.agents?.map((a) => a.detail).join(' | ') ?? '';
      // DES-226's literal signature: "PARAM_UNKNOWN: 'agentType' was retired at v34 — … See
      // workflow_authoring_guide, 'prompt layering'." — matched loosely (retirement + guide
      // pointer), not word-for-word, so a small copy-edit doesn't false-red this pin.
      expect(agentDetail).toMatch(/agentType[\s\S]*retired at v34/);
      expect(agentDetail).toContain('workflow_authoring_guide');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
