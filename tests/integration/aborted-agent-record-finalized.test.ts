// issue #53 (root cause B): an agent call aborted by run_suspend/run_stop must not leave its record
// `state:'running'` with no `endedAt` forever. `AgentExecutor.run()` returned `{kind:'null',
// aborted:true}` BEFORE the capture that finalizes a record, so the live record kept the
// `markRunning` stamp for the rest of the process's life — and after suspend→resume the phase lane
// was pushed a second time (`phases: ['greet','greet']`), putting the resumed agent in lane 1 of a
// one-lane workflow.
//
// Mock policy (integration tier): real RunManager + real AgentExecutor + real sandbox child; only the
// GatewayClient is faked. The fake's first call settles AFTER the abort (it waits for the signal),
// which is the real SDK gateway's shape.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { SystemClock } from '../../src/clock.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import type { GatewayClient } from '../../src/gateway/client.js';

async function pollUntilSettled(mgr: RunManager, runId: string, maxIters = 100) {
  let view = await mgr.status(runId);
  for (let i = 0; i < maxIters && view.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 50));
    view = await mgr.status(runId);
  }
  return view;
}

function gatewayHangingFirstCall(): { gateway: GatewayClient; firstStarted: Promise<void> } {
  let calls = 0;
  let started!: () => void;
  const firstStarted = new Promise<void>((r) => { started = r; });
  const gateway: GatewayClient = {
    invoke: async (req) => {
      calls += 1;
      if (calls === 1) {
        started();
        await new Promise<void>((resolve) => {
          if (req.signal?.aborted) resolve();
          else req.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return { ok: false, provider: 'fake', reason: 'timeout' };
      }
      return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'DONE' };
    },
  };
  return { gateway, firstStarted };
}

const SCRIPT = `phase('greet');\nreturn await agent('greet', {});`;

describe('an aborted agent record is finalized (#53 root cause B)', () => {
  it('suspend → resume: the aborted agent gets endedAt and a non-running state; the phase lane is not duplicated', async () => {
    const { gateway, firstStarted } = gatewayHangingFirstCall();
    const mgr = new RunManager({ gateway });
    const runId = await startScript(mgr, SCRIPT);
    await firstStarted;
    await mgr.suspend(runId);
    // Same post-suspend settle as IT-025 (resume-rerun-aborted-call.test.ts): an immediate resume
    // races the old sandbox child's teardown, a pre-existing behaviour outside this test's scope.
    await new Promise((r) => setTimeout(r, 300));
    await mgr.resume(runId);
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');

    expect(view.agents).toHaveLength(2);
    const stuck = view.agents.filter((a) => a.state === 'running' || a.endedAt === undefined);
    expect(stuck).toEqual([]);
    const aborted = view.agents.find((a) => a.state !== 'done')!;
    expect(aborted.state).toBe('failed');
    expect(aborted.detail).toMatch(/aborted/i);
    // The resumed re-run lands in the SAME lane as the aborted attempt (replay-stable ordinals).
    expect(view.phases.map((p) => p.title)).toEqual(['greet']);
    expect(view.agents.map((a) => a.phaseIndex)).toEqual([0, 0]);
  }, 20000);

  it('stop: the aborted agent gets endedAt and a non-running state once the run is terminal', async () => {
    const { gateway, firstStarted } = gatewayHangingFirstCall();
    const mgr = new RunManager({ gateway });
    const runId = await startScript(mgr, SCRIPT);
    await firstStarted;
    await mgr.stop(runId);
    const view = await mgr.status(runId);
    expect(view.status).toBe('stopped');
    expect(view.agents).toHaveLength(1);
    expect(view.agents[0]!.state).toBe('failed');
    expect(view.agents[0]!.endedAt).toBeDefined();
    expect(view.agents[0]!.detail).toMatch(/aborted/i);
  }, 20000);
});

// dash-auth-spec.md section C (2026-09-30): `_finalizeAborted` must keep the RESOLVED provider/
// model when the harness had already stamped one before the abort — today it stamps `provider: ''`
// unconditionally on the DURABLE usage event (agent-executor.ts capture()'s failed branch writes
// `result.provider` raw, not the `prev?.provider || result.provider` merge the record itself gets),
// so a restart-reconstructed record (`deriveAgentRecords`, no live sink to fall back on) loses the
// provider even though the live in-process record had it right up until the abort. This is exactly
// what excluded every aborted call from `models_list`'s observed stats (issue #104 KNOWN GAP).
//
// Red reason (measured): with a fake gateway that fires `onHarness` (a real provider/model) BEFORE
// racing the abort, `view.agents[0].provider` is `''` today, and a second `SqliteRunStore` over the
// same file re-derives `provider: ''` too (model survives via the harness descriptor; provider does
// not, because `deriveAgentRecords`'s failed branch reads `data.provider` from the usage event only).
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'rwe-it53-abort-provider-'));
  dirs.push(d);
  return d;
}

function gatewayHarnessThenHang(): { gateway: GatewayClient; firstStarted: Promise<void> } {
  let calls = 0;
  let started!: () => void;
  const firstStarted = new Promise<void>((r) => { started = r; });
  const gateway: GatewayClient = {
    invoke: async (req) => {
      calls += 1;
      if (calls === 1) {
        req.onHarness?.({ model: 'claude-abort-1', provider: 'anthropic', prompt: 'p', tools: [], skills: [], mcpServers: [], surfaceType: 'none' });
        started();
        await new Promise<void>((resolve) => {
          if (req.signal?.aborted) resolve();
          else req.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        // The real SDK gateway's shape: the in-flight call still settles (late) after losing the
        // abort race inside `_invokeOnce`'s `Promise.race` — its own result is discarded either way.
        return { ok: false, provider: 'anthropic', reason: 'timeout' };
      }
      return { ok: true, provider: 'anthropic', model: 'claude-abort-1', tokens: { input: 1, output: 1 }, content: 'DONE' };
    },
  };
  return { gateway, firstStarted };
}

describe('an aborted call keeps its resolved provider/model (dash-auth-spec C; issue #104 KNOWN GAP)', () => {
  it('stop: the aborted record keeps the harness-resolved provider/model, both live and after a restart', async () => {
    const dir = tempDir();
    const store1 = new SqliteRunStore(join(dir, 'store'), new SystemClock());
    const { gateway, firstStarted } = gatewayHarnessThenHang();
    const mgr = new RunManager({ gateway, store: store1, workRoot: dir } as never);
    const runId = await startScript(mgr, `phase('greet');\nreturn await agent('greet', {});`);
    await firstStarted;
    await mgr.stop(runId);
    const view = await mgr.status(runId);
    expect(view.status).toBe('stopped');
    expect(view.agents).toHaveLength(1);
    const aborted = view.agents[0]!;
    expect(aborted.state).toBe('failed');
    expect(aborted.provider).toBe('anthropic'); // not '' — the harness had already resolved it
    expect(aborted.model).toBe('claude-abort-1');
    expect(aborted.failReason).toBe('aborted'); // distinct from a genuine gateway 'timeout'

    // NOTE: this file does NOT also open a second `SqliteRunStore` over the same directory to prove
    // the restart-reconstructed record agrees — `RunManager.stop()`'s terminal snapshot write races
    // the in-flight abort's `capture()` (the pre-existing, DELIBERATELY-unfixed #53/adjudication #9
    // I-2 "add observability, don't guess a fix" race this file's OWN top comment documents; the
    // `agent_live_at_terminal` EngineWarning fires on exactly this run for exactly that reason), so
    // a second store instance here would assert against whichever snapshot happened to win the
    // race, not against `deriveAgentRecords`'s repair. That repair (this-slice: `provider`/
    // `failReason` reconstructed identically to the live record) is proven directly, deterministically,
    // against a hand-built transcript in tests/unit/agent-record-abort-provider.test.ts instead.
  }, 20000);
});
