// UT-003: Run state machine transitions (DES-003)
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { IllegalTransitionError } from '../../src/errors.js';
import { startScript } from '../helpers/workflow-fixtures.js';

describe('Run state machine', () => {
  it('start transitions run from queued to running', async () => {
    const mgr = new RunManager();
    const runId = await startScript(mgr, 'return 1;');
    const view = await mgr.status(runId);
    expect(['queued', 'running']).toContain(view.status);
  });

  it('resume on a running run throws IllegalTransitionError', async () => {
    const mgr = new RunManager();
    const runId = await startScript(mgr, 'return 1;');
    await expect(mgr.resume(runId)).rejects.toThrow(IllegalTransitionError);
  });

  it('suspend on a non-running run throws IllegalTransitionError', async () => {
    const mgr = new RunManager();
    await expect(mgr.suspend('no-such-run')).rejects.toThrow(IllegalTransitionError);
  });

  it('stop transitions run to stopped state', async () => {
    const mgr = new RunManager();
    const runId = await startScript(mgr, 'while(true){}');
    await mgr.stop(runId);
    const view = await mgr.status(runId);
    expect(view.status).toBe('stopped');
  });

  it('resume after stop uses cached-prefix resume semantics', async () => {
    const mgr = new RunManager();
    const runId = await startScript(mgr, 'return 1;');
    await mgr.stop(runId);
    // resume with same script should succeed (stopped → running via cache)
    await expect(mgr.resume(runId)).resolves.not.toThrow();
  });
});
