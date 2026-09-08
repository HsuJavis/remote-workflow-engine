// UT-182 (DES-175, ARCH-114, TASK-186, v26): the phase is snapshotted at IPC RECEIPT — `case
// 'agent'` reads `SandboxHostConfig.currentPhase()` SYNCHRONOUSLY, before the `Promise.resolve()
// .then(handler)` deferral — and passed as a 4th argument to `AgentRequestHandler`. Reproduced
// against a REAL forked sandbox child (per ARCH-114: `case 'phase'` calls `onPhase` synchronously
// while `case 'agent'` defers to a microtask, and Node drains the nextTick queue — where both IPC
// messages land — before microtasks; a handler-time read would stamp the LATER phase). Written
// test-first (Gate 5, RED): `SandboxHostConfig` has no `currentPhase` field and `AgentRequestHandler`
// takes only 3 args today — the 4th `phase` argument is always `undefined`.
// Mock policy (unit, real subprocess per DES-006's own "master test seam" precedent — a fake IPC
// channel cannot reproduce Node's real nextTick/microtask ordering this item exists to test): a
// REAL SandboxHost spawning a REAL forked child process running a REAL script.
import { describe, it, expect } from 'vitest';
import { SandboxHost } from '../../src/sandbox/host.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORK_DIR = join(tmpdir(), 'rwe-ut182-phase-stamp');

describe('phase is snapshotted at IPC receipt, not handler time (UT-182, DES-175)', () => {
  it('an agent() call issued in the same script tick as an immediately-following phase() carries the EARLIER phase', async () => {
    let currentPhaseRef: { title: string; index: number } | undefined;
    let capturedPhase: unknown;
    const host = new SandboxHost({
      workspaceRoot: WORK_DIR,
      currentPhase: (() => currentPhaseRef) as any,
      onPhase: (title: string) => {
        currentPhaseRef = { title, index: currentPhaseRef ? currentPhaseRef.index + 1 : 0 };
      },
      onAgentRequest: ((_prompt: string, _opts: unknown, _callSeq: number, phase?: unknown) => {
        capturedPhase = phase;
        return 'ok';
      }) as any,
    });
    // Script order: phase('A') establishes the lane, then (WITHOUT awaiting) dispatches agent() and
    // immediately calls phase('B') before the agent() call's own IPC round trip completes — the
    // classic "the record must carry 'A', not 'B'" case.
    const script = `
      phase('A');
      const p = agent('x', {});
      phase('B');
      await p;
      return 'done';
    `;
    await host.run('ut182-run', script, undefined, null);
    expect(capturedPhase).toEqual({ title: 'A', index: 0 });
  });
});
