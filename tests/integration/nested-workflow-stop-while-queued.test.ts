// issue #163 B1 follow-up — TEST-FIRST (RED). Commit 539d2e3 added `workflowGuard.acquireSlot()`
// to throttle nested `workflow()` dispatch, but it registers the once-listener that kills a nested
// `SandboxHost` (`generation.addEventListener('abort', killNested, {once:true})`) BEFORE awaiting
// that (now potentially long) queue wait, and never rechecks `generation.aborted` after the wait
// resolves. This reintroduces the exact issue #53 "stop() doesn't kill nested children" bug for any
// frame still QUEUED on `workflowGuard` when stop()/suspend() fires:
//
//   1. frame is constructed, registers its once-listener, then awaits `acquireSlot()` (queued,
//      concurrency already exhausted by an earlier-dispatched sibling frame's in-flight nested.run())
//   2. stop() fires -> generation aborts -> the once-listener runs `nested.abort()` against a
//      SandboxHost that has forked no child yet (`SandboxHost.abort()` is a no-op when
//      `_active.get(runId)` is empty) -> the once-listener is now consumed
//   3. later, the earlier sibling finishes and releases its workflowGuard slot -> this frame's
//      queued `acquireSlot()` resolves -> `nested.run()` is called with NO listener left to kill it
//      and NO recheck of `generation.aborted` in between -> it forks a real child and runs to
//      completion after the run was supposed to be stopped.
//
// Mock policy (integration tier): real RunManager + real on-disk WorkflowCatalog + real sandbox
// child processes / IPC / node:vm — `SandboxHost` itself is the real class, merely wrapped (same
// technique as `nested-workflow-parallel-concurrency.test.ts`) to COUNT how many nested `.run()`
// calls (id ending `-nested`) are ever invoked. Detection must be at this level, not at the
// `AgentSpawner`: even under the bug, a wrongly-resumed queued frame's forked child DOES reach its
// own `agent()` call, but the EXISTING `onAgentRequest` check (`generation.aborted` → throw) catches
// it there and the spawner is never actually invoked — so counting spawner calls would false-negative
// on exactly the defect this test exists to catch. Counting `nested.run()` invocations instead
// observes the real symptom: a queued-at-stop-time frame forking a child process at all.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentSpawner } from '../../src/agent-executor.js';

let nestedRunInvocations = 0;

vi.mock('../../src/sandbox/host.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/sandbox/host.js')>();
  class CountingSandboxHost extends mod.SandboxHost {
    override async run(...args: Parameters<InstanceType<typeof mod.SandboxHost>['run']>) {
      const id = args[0];
      if (typeof id === 'string' && id.endsWith('-nested')) nestedRunInvocations += 1;
      return super.run(...args);
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
const CONCURRENCY = 1;
const FANOUT = 3;

async function pollUntilSettled(mgr: InstanceType<typeof RunManager>, runId: string) {
  let view = await mgr.status(runId);
  for (let i = 0; i < 400 && (view.status === 'running' || view.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 25));
    view = await mgr.status(runId);
  }
  return view;
}

describe('issue #163 B1 follow-up — stop() while a nested workflow() frame is queued on workflowGuard', () => {
  let workRoot: string;
  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-nested-stop-queued-'));
    nestedRunInvocations = 0;
  });
  afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it('a queued frame never forks/runs after stop() aborted it while still waiting for a workflowGuard slot', async () => {
    let callCount = 0;
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve; });

    // Exactly one call (the first-dispatched frame's own agent()) is held in flight until the test
    // explicitly releases it, well after stop() has already fired — this deterministically keeps
    // the other FANOUT-1 frames queued on workflowGuard (concurrency=1) at the moment stop() runs.
    const spawner: AgentSpawner = {
      async run(req) {
        callCount += 1;
        if (callCount === 1) await firstHeld;
        return { kind: 'text', value: req.prompt };
      },
    };

    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'leaf', `const x = await agent('a', {prompt:'a'}); return x;`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner, concurrency: CONCURRENCY });

    const runId = await startScript(
      mgr,
      `const rs = await parallel(Array.from({length: ${FANOUT}}, () => () => workflow('leaf', {}))); return rs.length;`,
    );

    // Let the first frame actually acquire its workflowGuard slot and reach its (now-held) agent()
    // call. With concurrency=1, the other FANOUT-1 frames are necessarily still queued on
    // workflowGuard at this point — none of them can have acquired a slot yet.
    for (let i = 0; i < 200 && callCount < 1; i++) await new Promise((r) => setTimeout(r, 10));
    expect(callCount).toBe(1);

    await mgr.stop(runId);

    // Release the held call well after stop() so the first frame's nested.run() finishes and its
    // workflowGuard slot is freed — exactly the moment the bug lets a queued sibling's acquireSlot()
    // resolve and fork/run with no recheck of generation.aborted.
    releaseFirst();

    // Give any wrongly-resumed queued frame ample time to fork a real child.
    await new Promise((r) => setTimeout(r, 500));
    await pollUntilSettled(mgr, runId);

    // The held call's own spawner.run() must never be joined by a second one — the existing
    // onAgentRequest check (generation.aborted) already refuses a wrongly-resumed frame's OWN
    // agent() call, so this alone would pass even under the bug (false negative).
    expect(callCount).toBe(1);
    // RED today: the queued siblings' `nested.run()` is invoked anyway (forking a real child) once
    // their `workflowGuard.acquireSlot()` resolves post-stop, with no recheck of
    // `generation.aborted` in between — nestedRunInvocations climbs past 1 even though the run was
    // stopped while they were still queued.
    expect(nestedRunInvocations).toBe(1);
  }, 20000);
});
