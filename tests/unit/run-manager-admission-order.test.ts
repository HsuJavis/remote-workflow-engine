// UT-330 (DES-263, ARCH-182, TASK-258, REQ-218) — RunManager.start() calls admissionRefusal() as the
// FIRST statement, ahead of every other check (RUN_ADMISSION_LIMIT, INLINE_SCRIPT_CLOSED): a
// submission that can never be admitted under this posture must not consume an admission slot and
// must not be answered with a RETRYABLE code when the true refusal is deterministic and permanent.
// Proved here via INLINE_SCRIPT_CLOSED as the ordering witness — an inline `spec.script` throws
// INLINE_SCRIPT_CLOSED the moment the admission gate does NOT fire, so "which code comes back"
// directly reveals which check ran first, without needing a full catalog/gateway/sandbox setup.
// Written test-first (RED): RunManagerDeps carries no `confinementPosture` and start() calls no
// admission predicate — every case below currently throws INLINE_SCRIPT_CLOSED regardless of
// posture/origin, so the [LOAD-BEARING] case is the one that is currently WRONG.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';

describe('UT-330 RunManager.start(): admissionRefusal fires FIRST (DES-263)', () => {
  it('[LOAD-BEARING] remote + unconfined => refused CONFINEMENT_UNAVAILABLE; INLINE_SCRIPT_CLOSED never reached even though spec.script is set', async () => {
    const rm = new RunManager({ confinementPosture: 'unconfined' });
    await expect(rm.start({ script: 'noop', origin: 'remote' })).rejects.toMatchObject({ code: 'CONFINEMENT_UNAVAILABLE' });
  });

  it('local + unconfined => the admission gate does NOT fire; the run proceeds to the NEXT check (INLINE_SCRIPT_CLOSED) — the owner\'s accepted local-unconfined cost, stated as code', async () => {
    const rm = new RunManager({ confinementPosture: 'unconfined' });
    await expect(rm.start({ script: 'noop', origin: 'local' })).rejects.toMatchObject({ code: 'INLINE_SCRIPT_CLOSED' });
  });

  it('remote + confined => the admission gate does NOT fire (sandbox measured working); reaches INLINE_SCRIPT_CLOSED next', async () => {
    const rm = new RunManager({ confinementPosture: 'confined' });
    await expect(rm.start({ script: 'noop', origin: 'remote' })).rejects.toMatchObject({ code: 'INLINE_SCRIPT_CLOSED' });
  });

  it('confinementPosture omitted entirely (every pre-existing RunManager test call site) => never gated regardless of origin', async () => {
    const rm = new RunManager({});
    await expect(rm.start({ script: 'noop', origin: 'remote' })).rejects.toMatchObject({ code: 'INLINE_SCRIPT_CLOSED' });
  });
});
