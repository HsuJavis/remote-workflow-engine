// IT-133 (v25, issue #53, adjudication #9 I-2): two structured warnings on the terminal path.
//
// #53's evidence, run `3977b82d-5a01-4b37-a4db-d4ea4feca17a` (v24 Gate 7.5, real Ollama over real
// MCP HTTP): a run reached `failed` 8ms after a resume, `run_status`/`run_result`/the agent log all
// reported the failure with NO reason anywhere and NO `failed` row in the run's `transitions`,
// while the agent dispatched by that resume kept running for another ~36 seconds and produced real
// output nobody could ever read. Neither symptom left a single line behind.
//
// Originally (2026-09-07, adjudication #9 I-2) this file was deliberately NOT a fix for the race:
// "不猜著修,加觀測" — add observability, don't guess at a fix on a concurrency path. The ORIGINAL
// first test below reproduced the orphan with a gateway that ignores `req.signal` and asserted the
// `agent_live_at_terminal` warning fires for it.
//
// issue #127 (2026-10-02 owner ruling — a NAMED, deliberate revisit of that stance, not a reopening
// of it): `RunManager.stop()`/`suspend()` now give every in-flight agent() call's own abort-triggered
// bookkeeping (`AgentExecutor.settleInflight`, called from `_finalizeAborted`/`capture()`) a bounded
// head start before the terminal/suspend snapshot is taken. Measured directly (see the git history of
// this file): the abort race inside `AgentExecutor._invokeOnce` resolves off the RUN's OWN
// `AbortSignal`, independent of whether the gateway itself ever observes it, and `capture()`'s
// `this._records.set(...)` runs SYNCHRONOUSLY in its own call stack, before any of `capture()`'s own
// `await`s — so the in-memory record flips to `failed` within the same microtask flush the abort
// triggers, which lands before `settleInflight`'s own `await` returns control to `_transition`
// REGARDLESS of the configured bound (even 0ms — Node drains every ready microtask before advancing
// to the next macrotask/timer phase). The orphan this file's first test used to reproduce can
// therefore no longer be reproduced via a signal-ignoring fake gateway: that WAS exactly the
// mechanism issue #127 fixes. The first test below now asserts the FIX directly — no orphan, no
// warning — and the `agent_live_at_terminal` detection code itself (run-manager.ts `_transition`,
// still present, unremoved) is left as a safety net for whatever genuinely never reaches `run()`'s own
// tracking at all (an operator's custom `AgentSpawner`, which `_transition` already treats as
// contributing an empty `agents` array either way) — not something this synthetic harness can still
// exercise honestly. No OTHER existing behaviour changes: a terminal state still does not abort the
// REAL external work it owns (the sandbox child, the gateway's own subprocess) — that remains a
// separate decision with its own tests; this file is only about the BOOKKEEPING catching up before
// the snapshot read.
//
// Mock policy (integration tier): real RunManager, real RunGuard, real AgentExecutor, real sandbox
// child process, real SqliteRunStore. Only `GatewayClient` (third-party network) is faked. The second
// warning kind needs no fake at all — it puts a REAL sqlite store into the exact on-disk state #53
// was observed in (`runs.status = 'failed'`, no `failed` row in `transitions`) with one UPDATE, which
// is the state the incident presented and one no engine code path is supposed to be able to produce.
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { SystemClock } from '../../src/clock.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import type { EngineWarning } from '../../src/types.js';
import type { AgentRecord } from '../../src/types.js';
import { startScript } from '../helpers/workflow-fixtures.js';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'rwe-warn-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Polls until `predicate(agents)` holds — the agent's dispatch crosses the sandbox IPC boundary,
 *  so a single-shot read after start() races that hop (the same reason IT-024 polls). */
async function waitForAgents(mgr: RunManager, runId: string, predicate: (a: AgentRecord[]) => boolean, maxIters = 80): Promise<AgentRecord[]> {
  let view = await mgr.status(runId);
  for (let i = 0; i < maxIters && !predicate(view.agents); i++) {
    await new Promise((r) => setTimeout(r, 25));
    view = await mgr.status(runId);
  }
  return view.agents;
}

describe('a terminal state no longer leaves live bookkeeping behind (IT-133 + issue #127)', () => {
  it('stop() while an agent is still at the gateway (ignoring the abort signal) still finalizes it to failed, no orphan warning', async () => {
    const warnings: EngineWarning[] = [];
    let releaseAgent!: () => void;
    const held = new Promise<void>((resolve) => { releaseAgent = resolve; });

    // The SAME signal-ignoring gateway #53's orphan used — the strongest setup available: it proves
    // the fix does not depend on the gateway's own cooperation at all, only on the run's own
    // AbortSignal (which the gateway never sees here).
    const gateway: GatewayClient = {
      invoke: async () => {
        await held;
        return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'too late' };
      },
    };
    const mgr = new RunManager({ gateway, workRoot: tempDir(), onWarning: (w) => warnings.push(w) });

    const runId = await startScript(mgr, `return await agent('orphan', { prompt: 'hold' });`);
    const agents = await waitForAgents(mgr, runId, (a) => a.some((r) => r.state === 'running'));
    expect(agents.find((a) => a.label === 'orphan')?.state, 'the agent must be live BEFORE stop(), or this case proves nothing').toBe('running');

    await mgr.stop(runId);

    // issue #127: the fix — finalized to failed, not left stuck running.
    const view = await mgr.status(runId);
    const orphan = view.agents.find((a) => a.label === 'orphan');
    expect(orphan?.state).toBe('failed');
    expect(orphan?.failReason).toBe('aborted');
    expect(orphan?.endedAt).toBeDefined();

    // ...so the orphan warning this exact scenario used to produce no longer fires.
    expect(warnings.filter((w) => w.kind === 'agent_live_at_terminal')).toEqual([]);

    releaseAgent();
  });

  it('a run whose agents all settled first produces NO warning (the positive control — a warning that always fires says nothing)', async () => {
    const warnings: EngineWarning[] = [];
    const gateway: GatewayClient = {
      invoke: async () => ({ ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'done' }),
    };
    const mgr = new RunManager({ gateway, workRoot: tempDir(), onWarning: (w) => warnings.push(w) });

    const runId = await startScript(mgr, `return await agent('quick', { prompt: 'go' });`);
    let view = await mgr.status(runId);
    for (let i = 0; i < 80 && (view.status === 'running' || view.status === 'queued'); i++) {
      await new Promise((r) => setTimeout(r, 25));
      view = await mgr.status(runId);
    }
    expect(view.status).toBe('completed');
    expect(warnings).toEqual([]);
  });
});

describe('a terminal status with no matching transition row is recorded (IT-133, #53)', () => {
  it('status() on a run whose stored status is terminal with no terminal row ⇒ a warning carrying the transitions that DO exist', async () => {
    const warnings: EngineWarning[] = [];
    const dir = tempDir();
    const store = new SqliteRunStore(dir, new SystemClock());
    const mgr = new RunManager({ store, workRoot: tempDir(), onWarning: (w) => warnings.push(w) });

    const runId = await store.createRun({ origin: 'local', script: 'return 1;', name: 'it133' });
    await store.recordTransition(runId, null, 'queued', new Date().toISOString());
    await store.recordTransition(runId, 'queued', 'running', new Date().toISOString());

    // #53's exact on-disk shape: the queryable status says `failed`, the audit trail never records
    // it. `recordTransition` is the only writer of a terminal status and writes both — so this state
    // is not reachable through the engine, which is what makes it worth a warning rather than a
    // status field.
    const db = new Database(join(dir, 'index.db'));
    db.prepare("UPDATE runs SET status = 'failed' WHERE runId = ?").run(runId);
    db.close();

    const view = await mgr.status(runId);
    expect(view.status).toBe('failed');
    expect(view.terminalAt, 'the symptom itself: a terminal run with no terminal transition to date it').toBeUndefined();

    const orphaned = warnings.filter((w) => w.kind === 'terminal_without_transition');
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]).toMatchObject({ runId, terminalState: 'failed' });
    // The recorded trail is part of the evidence — "which rows DID land" is the first question
    // anyone debugging 3977b82d would have asked, and nothing could answer it.
    expect(orphaned[0]?.transitions).toEqual(['null->queued', 'queued->running']);
  });

  it('a healthy terminal run produces NO such warning, and a repeat poll of a broken one does not flood the log', async () => {
    const warnings: EngineWarning[] = [];
    const dir = tempDir();
    const store = new SqliteRunStore(dir, new SystemClock());
    const mgr = new RunManager({ store, workRoot: tempDir(), onWarning: (w) => warnings.push(w) });

    const healthy = await store.createRun({ origin: 'local', script: 'return 1;', name: 'it133-ok' });
    await store.recordTransition(healthy, null, 'queued', new Date().toISOString());
    await store.recordTransition(healthy, 'queued', 'completed', new Date().toISOString());
    await mgr.status(healthy);
    await mgr.status(healthy);
    expect(warnings).toEqual([]);

    const broken = await store.createRun({ origin: 'local', script: 'return 1;', name: 'it133-bad' });
    await store.recordTransition(broken, null, 'queued', new Date().toISOString());
    const db = new Database(join(dir, 'index.db'));
    db.prepare("UPDATE runs SET status = 'failed' WHERE runId = ?").run(broken);
    db.close();
    await mgr.status(broken);
    await mgr.status(broken);
    await mgr.status(broken);
    expect(warnings.filter((w) => w.runId === broken), 'a terminal run is polled; one record per run is evidence, one per poll is noise').toHaveLength(1);
  });

  // issue #127: the DEFAULT sink (no `onWarning` passed — production wiring) still reaches
  // console.warn — moved here from the (now-fixed) agent-orphan scenario in the describe block
  // above, which no longer reproduces via a signal-ignoring gateway (see the file-top comment). This
  // `terminal_without_transition` path is untouched by issue #127 and stays fully reproducible, so it
  // is what proves the default-sink wiring without relying on timing at all.
  it('the default sink is console.warn — the warning reaches the engine log with no operator configuration', async () => {
    const lines: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
      const dir = tempDir();
      const store = new SqliteRunStore(dir, new SystemClock());
      // No onWarning: this is the production wiring. A sink that only exists when someone remembers
      // to pass it is the composeConfig bug class this ledger has recorded twice.
      const mgr = new RunManager({ store, workRoot: tempDir() });

      const runId = await store.createRun({ origin: 'local', script: 'return 1;', name: 'it133-default-sink' });
      await store.recordTransition(runId, null, 'queued', new Date().toISOString());
      const db = new Database(join(dir, 'index.db'));
      db.prepare("UPDATE runs SET status = 'failed' WHERE runId = ?").run(runId);
      db.close();

      await mgr.status(runId);
      expect(lines.some((l) => l.includes('terminal_without_transition') && l.includes(runId))).toBe(true);
    } finally {
      console.warn = original;
    }
  });
});
