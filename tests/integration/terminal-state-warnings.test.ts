// IT-133 (v25, issue #53, adjudication #9 I-2): two structured warnings on the terminal path.
//
// #53's evidence, run `3977b82d-5a01-4b37-a4db-d4ea4feca17a` (v24 Gate 7.5, real Ollama over real
// MCP HTTP): a run reached `failed` 8ms after a resume, `run_status`/`run_result`/the agent log all
// reported the failure with NO reason anywhere and NO `failed` row in the run's `transitions`,
// while the agent dispatched by that resume kept running for another ~36 seconds and produced real
// output nobody could ever read. Neither symptom left a single line behind.
//
// This file is deliberately NOT a fix for the race. The sequence is non-deterministic (the same
// steps with the suspend at +3s instead of +1s complete normally) and adjudication #9 I-2 rules
// against guessing at a fix on a concurrency path: "不猜著修,加觀測" — the goal is that the NEXT
// occurrence leaves evidence at the scene instead of being caught by coincidence again. No existing
// behaviour changes: a terminal state still does not abort the work it owns (that is a separate
// decision with its own tests), and nothing here alters control flow.
//
// Mock policy (integration tier): real RunManager, real RunGuard, real AgentExecutor, real sandbox
// child process, real SqliteRunStore. Only `GatewayClient` (third-party network) is faked, and it
// is faked in the ONE way that reproduces #53's orphan: it ignores the abort signal, so the agent
// is provably still `running` at the moment the run is written terminal. The second case needs no
// fake at all — it puts a REAL sqlite store into the exact on-disk state #53 was observed in
// (`runs.status = 'failed'`, no `failed` row in `transitions`) with one UPDATE, which is the state
// the incident presented and one no engine code path is supposed to be able to produce.
//
// RED before the fix: `RunManagerDeps.onWarning` does not exist (tsc), and with the sink stubbed
// out both `warnings` arrays stay empty — which is precisely what happened to run 3977b82d.
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

describe('a terminal state that leaves live work behind is recorded (IT-133, #53)', () => {
  it('run stopped while its agent is still running ⇒ one warning naming the run, the agent, its state and the terminal state', async () => {
    const warnings: EngineWarning[] = [];
    let releaseAgent!: () => void;
    const held = new Promise<void>((resolve) => { releaseAgent = resolve; });

    // The orphan, reproduced: a gateway call that does NOT observe `req.signal`. #53's agent kept
    // going for 36 seconds after its run was terminal, so a fake that aborts obediently would test
    // the case that never fails.
    const gateway: GatewayClient = {
      invoke: async () => {
        await held;
        return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'too late' };
      },
    };
    const mgr = new RunManager({ gateway, workRoot: tempDir(), onWarning: (w) => warnings.push(w) });

    const runId = await startScript(mgr, `return await agent('orphan', { prompt: 'hold' });`);
    const agents = await waitForAgents(mgr, runId, (a) => a.some((r) => r.state === 'running'));
    expect(agents.find((a) => a.label === 'orphan')?.state, 'the agent must be live BEFORE the terminal write, or this case proves nothing').toBe('running');

    await mgr.stop(runId);

    const orphaned = warnings.filter((w) => w.kind === 'agent_live_at_terminal');
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]).toMatchObject({
      runId,
      terminalState: 'stopped',
      agent: { label: 'orphan', state: 'running' },
    });
    expect(orphaned[0]?.ts, 'a warning with no timestamp cannot be correlated with anything').toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(orphaned[0]?.agent?.agentId).toBeTruthy();

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

  it('the default sink is console.warn — the warning reaches the engine log with no operator configuration', async () => {
    const lines: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const gateway: GatewayClient = { invoke: async () => { await held; return { ok: true, provider: 'f', model: 'm', tokens: { input: 1, output: 1 }, content: 'x' }; } };
      // No onWarning: this is the production wiring. A sink that only exists when someone remembers
      // to pass it is the composeConfig bug class this ledger has recorded twice.
      const mgr = new RunManager({ gateway, workRoot: tempDir() });
      const runId = await startScript(mgr, `return await agent('orphan', { prompt: 'hold' });`);
      await waitForAgents(mgr, runId, (a) => a.some((r) => r.state === 'running'));
      await mgr.stop(runId);
      release();
      expect(lines.some((l) => l.includes('agent_live_at_terminal') && l.includes(runId))).toBe(true);
    } finally {
      console.warn = original;
    }
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
});
