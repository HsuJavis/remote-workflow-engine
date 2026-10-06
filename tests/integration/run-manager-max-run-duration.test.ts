// F-1 (sandbox robustness sweep): RunManager -> SandboxHost wiring for the run-wide wall-clock
// deadline, exercised end to end through a REAL forked sandbox child (no mocking of the sandbox
// boundary) — closes the gap between the unit-tier `sandbox-host-run-duration.test.ts` (mocked
// fork, proves the HOST's own timer/classification logic) and the composeConfig wiring test (proves
// the FileConfig key reaches ServerConfig) by proving the middle hop: RunManagerDeps.maxRunDurationMs
// really reaches the SandboxHost a run actually executes against.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { startScript } from '../helpers/workflow-fixtures.js';

async function pollUntilSettled(mgr: RunManager, runId: string) {
  let view = await mgr.status(runId);
  for (let i = 0; i < 100 && view.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 50));
    view = await mgr.status(runId);
  }
  return view;
}

describe('F-1 end-to-end: RunManagerDeps.maxRunDurationMs reaches the real SandboxHost a run executes against', () => {
  it('a script that spins forever (while(true){}) is terminated at its configured deadline with SCRIPT_TIMEOUT', async () => {
    const mgr = new RunManager({ maxRunDurationMs: 300 });
    const runId = await startScript(mgr, 'while(true){}');
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('failed');
    expect(view.error?.code).toBe('SCRIPT_TIMEOUT');
  }, 15000);

  it('a normal, fast-completing script is unaffected by a short-but-sufficient deadline', async () => {
    const mgr = new RunManager({ maxRunDurationMs: 60000 });
    const runId = await startScript(mgr, "return 'ok';");
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');
  }, 15000);

  it('an invalid maxRunDurationMs (not a positive integer) refuses construction', () => {
    expect(() => new RunManager({ maxRunDurationMs: 0 })).toThrow(/maxRunDurationMs/);
    expect(() => new RunManager({ maxRunDurationMs: -1 })).toThrow(/maxRunDurationMs/);
    expect(() => new RunManager({ maxRunDurationMs: 1.5 })).toThrow(/maxRunDurationMs/);
  });
});
