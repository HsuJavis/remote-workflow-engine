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
    // issue #160 BUG-4: this call was aborted before ANY usage streamed onto its record (the fake
    // gateway's first call never reports usage — it just waits on the abort signal), so
    // `getLiveAttemptUsage` is undefined. The record must still carry `partial:true` — "the known
    // spend is a lower bound, possibly 0" — matching the timeout/pi-gateway abort-branch contract
    // (issue #152), never silently reading as an exact, priced, zero-cost call.
    expect(view.agents[0]!.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(view.agents[0]!.partial).toBe(true);
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
        // issue #127: streams live usage before hanging — `_finalizeAborted` reads this off the
        // sink's live record (`markUsage`) once the abort race wins, independent of whether this
        // call's own Promise (below) is ever awaited to completion.
        req.onUsage?.({ input: 11, output: 4, cacheRead: 0, cacheWrite: 0 });
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
    // issue #127: the usage streamed before the abort survives finalization — priced (even if
    // unpriced:true with no catalog pin here) and marked `partial` (a lower bound, no finalized
    // `result.usage` ever arrived for this attempt).
    expect(aborted.tokens).toEqual({ input: 11, output: 4, cacheRead: 0, cacheWrite: 0 });
    expect(aborted.partial).toBe(true);

    // issue #127: `RunManager.stop()` now waits (bounded, `AgentExecutor.settleInflight`) for the
    // in-flight abort's `capture()` to land BEFORE the terminal snapshot — closing the race this
    // comment used to document as deliberately unfixed (#53/adjudication #9 I-2; see
    // `tests/integration/terminal-state-warnings.test.ts`'s own updated file-top comment for the
    // measured reason it closes). A second, FRESH `SqliteRunStore` over the SAME directory now
    // reliably reconstructs the identical record via `deriveAgentRecords` — proving the durable
    // snapshot/journal agrees with the live view, not just whichever one happened to win a race.
    const store2 = new SqliteRunStore(join(dir, 'store'), new SystemClock());
    const restarted = await store2.getRun(runId);
    const restartedAgent = restarted?.agents.find((a) => a.agentId === aborted.agentId);
    expect(restartedAgent?.state).toBe('failed');
    expect(restartedAgent?.failReason).toBe('aborted');
    expect(restartedAgent?.tokens).toEqual({ input: 11, output: 4, cacheRead: 0, cacheWrite: 0 });
    expect(restartedAgent?.partial).toBe(true);
  }, 20000);
});
