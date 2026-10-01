// Owner decision 2026-10-02 (disk floor): new run admissions — start() (run_start, webhook and
// schedule firings all go through it), resume(), and a nested workflow() frame — are refused
// DISK_LOW {freeBytes, floorBytes} while the disk is below the floor; runs already in flight
// continue. DISK_LOW is TRANSIENT: admissionErrorToOutcome maps it to 503 / permanent:false, so a
// webhook delivery id is released and a schedule firing records it in lastError.
import { describe, it, expect } from 'vitest';
import { RunManager, admissionErrorToOutcome, ADMISSION_PERMANENT_CODES } from '../../src/run-manager.js';
import { codedError } from '../../src/errors.js';

function floor() {
  const state = { low: false };
  return {
    state,
    assert(): void {
      if (state.low) throw codedError('DISK_LOW', 'DISK_LOW: free 1 < floor 2', { freeBytes: 1, floorBytes: 2 });
    },
  };
}

describe('RunManager disk-floor admission', () => {
  it('start() is refused DISK_LOW (with detail) while low, admitted otherwise', async () => {
    const f = floor();
    const rm = new RunManager({ diskFloor: f });
    f.state.low = true;
    await expect(rm.start({ origin: 'local' })).rejects.toMatchObject({ code: 'DISK_LOW', detail: { freeBytes: 1, floorBytes: 2 } });
    f.state.low = false;
    await expect(rm.start({ origin: 'local' })).resolves.toEqual(expect.any(String));
  });

  it('resume() is refused DISK_LOW', async () => {
    const f = floor();
    const rm = new RunManager({ diskFloor: f });
    const runId = await rm.start({ origin: 'local' });
    f.state.low = true;
    await expect(rm.resume(runId)).rejects.toMatchObject({ code: 'DISK_LOW' });
  });

  it('a nested workflow() frame is refused DISK_LOW; the parent run itself keeps running', async () => {
    const f = floor();
    const rm = new RunManager({ diskFloor: f });
    const runId = await rm.start({ origin: 'local' });
    f.state.low = true;
    const handle = (rm as unknown as { _handleWorkflowRequest: (...a: unknown[]) => Promise<unknown> })._handleWorkflowRequest.bind(rm);
    await expect(handle(runId, 'child', {}, '', 0, 1, new Set<string>())).rejects.toMatchObject({ code: 'DISK_LOW' });
    expect(['running', 'queued']).toContain((await rm.status(runId)).status);
  });

  // LOW-3 (owner decision 2026-10-02, verify-k): a nested frame refused DISK_LOW must not consume a
  // descendant slot — before this fix `entry.descendants` was incremented BEFORE the disk-floor
  // check, so a parent that loops/retries workflow() during a low-disk window burned its
  // maxWorkflowDescendants cap on attempts that never actually dispatched anything.
  it('a nested workflow() frame refused DISK_LOW does not consume a descendant slot', async () => {
    const f = floor();
    const rm = new RunManager({ diskFloor: f });
    const runId = await rm.start({ origin: 'local' });
    f.state.low = true;
    const handle = (rm as unknown as { _handleWorkflowRequest: (...a: unknown[]) => Promise<unknown> })._handleWorkflowRequest.bind(rm);
    await expect(handle(runId, 'child', {}, '', 0, 1, new Set<string>())).rejects.toMatchObject({ code: 'DISK_LOW' });
    const entry = (rm as unknown as { _runs: Map<string, { descendants: number }> })._runs.get(runId)!;
    expect(entry.descendants).toBe(0);
  });

  it('DISK_LOW is transient: 503, not permanent, and not in the replayed-409 family', () => {
    expect(admissionErrorToOutcome(codedError('DISK_LOW', 'x'))).toEqual({ code: 'DISK_LOW', httpStatus: 503, permanent: false });
    expect(ADMISSION_PERMANENT_CODES).not.toContain('DISK_LOW');
  });
});
