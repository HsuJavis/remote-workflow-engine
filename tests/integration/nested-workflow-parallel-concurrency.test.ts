// issue #163 B1 — TEST-FIRST (RED). `_handleWorkflowRequest` built a brand-new `SandboxHost` and
// forked a real OS child process for EVERY nested `workflow()` call with NO concurrency gate at
// all — unlike `_handleAgentRequest`, which has always queued agent() dispatch at
// `entry.guard.acquireSlot()` (bounded by `runConcurrency`). A wide `parallel()` of nested
// `workflow()` calls therefore forked all N children essentially simultaneously, flooding Node's
// child_process IPC at high N and losing a child's own `process.send({t:'done',...})` message even
// though the child ran to completion — the exact `INTERNAL_ERROR "sandbox child process
// terminated before completion"` the issue reports.
//
// This is the DETERMINISTIC half of the fix's test coverage (no timing-dependent flake): it
// instruments the real `SandboxHost` class (vi.mock with `importOriginal`, a thin counting
// subclass — not a stub; every real fork/IPC/vm path still runs) and asserts the number of nested
// SandboxHost.run() calls concurrently in flight never exceeds the configured `concurrency`, for a
// parallel() fan-out wider than that cap. A second, separate stress-repro (N>=260, run several
// times) is evidence that the underlying Node IPC race is avoided in practice — not required here
// since this test asserts the actual causal mechanism (unbounded concurrent forks) directly.
//
// Mock policy (integration tier): real RunManager + real on-disk WorkflowCatalog + real sandbox
// child processes / IPC / node:vm — SandboxHost itself is the real class, merely wrapped to count
// concurrently-active nested `.run()` calls (identified by the `${runId}-nested` id every nested
// frame's own `nested.run()` call uses — see run-manager.ts). The top-level run's own
// `sandbox.run(runId, ...)` call (no `-nested` suffix) is deliberately excluded from the count: it
// is one single long-lived call for the whole test, not an instance of the fan-out under test.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentSpawner } from '../../src/agent-executor.js';

let activeNested = 0;
let peakNested = 0;

vi.mock('../../src/sandbox/host.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/sandbox/host.js')>();
  class CountingSandboxHost extends mod.SandboxHost {
    override async run(...args: Parameters<InstanceType<typeof mod.SandboxHost>['run']>) {
      const id = args[0];
      const isNested = typeof id === 'string' && id.endsWith('-nested');
      if (isNested) {
        activeNested += 1;
        peakNested = Math.max(peakNested, activeNested);
      }
      try {
        return await super.run(...args);
      } finally {
        if (isNested) activeNested -= 1;
      }
    }
  }
  return { ...mod, SandboxHost: CountingSandboxHost };
});

const { RunManager } = await import('../../src/run-manager.js');
const { WorkflowCatalog } = await import('../../src/workflow-catalog.js');
const { InMemoryRunStore } = await import('../../src/run-store.js');
const { FixedClock } = await import('../../src/clock.js');
const { startScript, registerPublished } = await import('../helpers/workflow-fixtures.js');

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));
const CONCURRENCY = 2;
const FANOUT = 10;

/** Every agent() dispatch takes a few ms — just enough that, with no gate on nested workflow()
 *  dispatch, several nested frames would genuinely overlap inside this spawner at once (proving
 *  the gate, not merely the absence of a crash). */
function delayedSpawner(): AgentSpawner {
  return {
    async run(req) {
      await new Promise((r) => setTimeout(r, 15));
      return { kind: 'text', value: req.prompt };
    },
  };
}

async function pollUntilSettled(mgr: InstanceType<typeof RunManager>, runId: string) {
  let view = await mgr.status(runId);
  for (let i = 0; i < 400 && (view.status === 'running' || view.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 25));
    view = await mgr.status(runId);
  }
  return view;
}

describe('issue #163 B1 — nested workflow() fan-out is throttled by a concurrency gate', () => {
  let workRoot: string;
  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-nested-concurrency-'));
    activeNested = 0;
    peakNested = 0;
  });
  afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it(`a ${FANOUT}-wide parallel() of nested workflow() calls never runs more than concurrency=${CONCURRENCY} nested SandboxHosts at once`, async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'leaf', `const x = await agent('a', {prompt:'a'}); return x;`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: delayedSpawner(), concurrency: CONCURRENCY });

    const runId = await startScript(
      mgr,
      `const rs = await parallel(Array.from({length: ${FANOUT}}, () => () => workflow('leaf', {}))); return rs.length;`,
    );
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');
    const result = await mgr.result(runId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toBe(FANOUT);

    // RED today: `_handleWorkflowRequest` has no gate, so all FANOUT nested forks start together —
    // peakNested observes up to FANOUT, not CONCURRENCY.
    expect(peakNested).toBeLessThanOrEqual(CONCURRENCY);
    // Sanity: the fixture actually exercised overlap (not an accidentally-serial fan-out) so a
    // peak of 1 would not silently pass for the wrong reason.
    expect(peakNested).toBeGreaterThan(1);
  });
});
