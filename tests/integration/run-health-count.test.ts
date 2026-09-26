// IT (DES-234, ARCH-146, TASK-236, REQ-207): `failedAgentCount` on `run-manager.status()`
// (`RunStatusView`) — a read-time fold over the agents `_mergeLive` already resolved (live OR
// restored), never a stored field. The designed ASYMMETRY: while a run is still `running`,
// `run_list` (SQL projection, snapshot-only) OMITS the count (no snapshot yet) but `run_status`
// (this file) reports it live. Written test-first (Gate 5, RED) — `RunStatusView` carries no
// `failedAgentCount` field today.
//
// Mock policy (integration): real RunManager + real sandbox; a fake `GatewayClient` (the
// third-party network boundary, legal to fake at IT tier) — one call fails immediately, a second
// never resolves within the test's lifetime (dag-masking-auth.test.ts's own precedent for "prove
// the run is still genuinely running without a real hung provider").
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { RunStatus, AgentRecord } from '../../src/types.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { registerPublished } from '../helpers/workflow-fixtures.js';

const clock = new FixedClock(new Date('2026-09-21T00:00:00.000Z'));

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'rwe-it234-'));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function waitForAgents(mgr: RunManager, runId: string, predicate: (a: AgentRecord[]) => boolean, maxIters = 120): Promise<AgentRecord[]> {
  let view = await mgr.status(runId);
  for (let i = 0; i < maxIters && !predicate(view.agents); i++) {
    await new Promise((r) => setTimeout(r, 25));
    view = await mgr.status(runId);
  }
  return view.agents;
}

async function waitForStatus(mgr: RunManager, runId: string, want: RunStatus, maxIters = 120): Promise<void> {
  for (let i = 0; i < maxIters; i++) {
    const view = await mgr.status(runId);
    if (view.status === want) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitForStatus: run ${runId} never reached ${want} in time`);
}

const TWO_AGENT_SCRIPT =
  "export const meta = { params: { agents: { a: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, " +
  "effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, " +
  "b: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } } };\n" +
  "phase('main');\n" +
  "const ra = await agent('a', {});\n" +
  "const rb = await agent('b', {});\n" +
  "return { ra, rb };";

describe('failedAgentCount on RunStatusView (DES-234, live fold, case iii)', () => {
  it('(iii) running, one agent already failed: run_status reports 1 (the designed asymmetry with run_list)', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    // 'a' fails immediately; 'b' never resolves within this test's lifetime — the run stays
    // genuinely `running` while we assert.
    const gateway: GatewayClient = {
      invoke: async (req) => {
        if (req.opts.label === 'a') return { ok: false, provider: 'fake', reason: 'terminal', detail: 'boom' };
        return new Promise(() => { /* never settles */ });
      },
    };
    const mgr = new RunManager({ store, clock, workRoot: dir, gateway } as never);
    const name = 'it234-running-one-failed';
    await registerPublished(mgr.catalog, name, TWO_AGENT_SCRIPT);
    const runId = await mgr.start({ origin: 'local', name });

    const agents = await waitForAgents(mgr, runId, (a) => a.some((r) => r.state === 'failed'));
    expect(agents.some((r) => r.state === 'failed')).toBe(true);
    const view = await mgr.status(runId) as unknown as { status: string; failedAgentCount?: number };
    expect(view.status).toBe('running'); // still genuinely running — 'b' never settled
    expect(view.failedAgentCount).toBe(1);

    await mgr.suspend(runId); // cleanup — don't leave a live run behind after the test
  });

  it('(ii) terminal, zero agents: OMITTED, never 0', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr = new RunManager({ store, clock, workRoot: dir } as never);
    const name = 'it234-zero-agents';
    await registerPublished(mgr.catalog, name, 'return 1;');
    const runId = await mgr.start({ origin: 'local', name });
    await waitForStatus(mgr, runId, 'completed');
    const view = await mgr.status(runId) as unknown as { failedAgentCount?: number };
    expect(view.failedAgentCount).toBeUndefined();
  });

  it('(i) terminal, mixed pass/fail: run_status and run_list AGREE, non-zero', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const gateway: GatewayClient = {
      invoke: async (req) => {
        if (req.opts.label === 'a') return { ok: false, provider: 'fake', reason: 'terminal', detail: 'boom' };
        return { ok: true, provider: 'fake', model: 'fake-model', tokens: { input: 1, output: 1 }, content: 'done' };
      },
    };
    const mgr = new RunManager({ store, clock, workRoot: dir, gateway } as never);
    const name = 'it234-mixed-terminal';
    await registerPublished(mgr.catalog, name, TWO_AGENT_SCRIPT);
    const runId = await mgr.start({ origin: 'local', name });
    await waitForStatus(mgr, runId, 'completed');

    const statusView = await mgr.status(runId) as unknown as { failedAgentCount?: number };
    const listRows = (await store.listRuns()) as Array<{ runId: string; failedAgentCount?: number }>;
    const listRow = listRows.find((r) => r.runId === runId);
    expect(statusView.failedAgentCount).toBe(1);
    expect(listRow?.failedAgentCount).toBe(1);
    expect(statusView.failedAgentCount).toBe(listRow?.failedAgentCount);
  });
});

describe('failedAgentCount on the RESTORED path after a restart (DES-234)', () => {
  it('a SECOND RunManager reading a persisted snapshot agrees with the pre-restart live count', async () => {
    const dir = tempDir();
    const store1 = new SqliteRunStore(join(dir, 'store'), clock);
    const gateway: GatewayClient = {
      invoke: async (req) => {
        if (req.opts.label === 'a') return { ok: false, provider: 'fake', reason: 'terminal', detail: 'boom' };
        return { ok: true, provider: 'fake', model: 'fake-model', tokens: { input: 1, output: 1 }, content: 'done' };
      },
    };
    const mgr1 = new RunManager({ store: store1, clock, workRoot: dir, gateway } as never);
    const name = 'it234-restored';
    await registerPublished(mgr1.catalog, name, TWO_AGENT_SCRIPT);
    const runId = await mgr1.start({ origin: 'local', name });
    await waitForStatus(mgr1, runId, 'completed');

    const store2 = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr2 = new RunManager({ store: store2, clock, workRoot: dir } as never);
    const view = await mgr2.status(runId) as unknown as { failedAgentCount?: number };
    expect(view.failedAgentCount).toBe(1);
  });

  it('a pre-v35 row (no snapshot failedAgentCount data) omits it, never crashes', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr = new RunManager({ store, clock, workRoot: dir } as never);
    const name = 'it234-pre-v35';
    await registerPublished(mgr.catalog, name, 'return 1;');
    const runId = await mgr.start({ origin: 'local', name });
    await waitForStatus(mgr, runId, 'completed');

    const store2 = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr2 = new RunManager({ store: store2, clock, workRoot: dir } as never);
    const view = await mgr2.status(runId) as unknown as { failedAgentCount?: number };
    expect(view.failedAgentCount).toBeUndefined();
  });
});
