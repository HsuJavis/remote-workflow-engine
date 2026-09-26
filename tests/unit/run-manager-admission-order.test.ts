// UT-330 (DES-263, ARCH-182, TASK-258, REQ-218) — RunManager.start()'s confinement admission check.
//
// [更正 2026-09-26, issue #93 item 2] This file used to pin admissionRefusal() firing as the FIRST
// statement in start() — ahead of RUN_ADMISSION_LIMIT and INLINE_SCRIPT_CLOSED. That ordering was
// itself the defect issue #93 item 2 closed: call-tool.ts's own door mirrored the SAME "confinement
// first" precedence one layer up, so a remote+unconfined caller whose workflow did not exist, or
// whose args were malformed, was told CONFINEMENT_UNAVAILABLE instead of WORKFLOW_NOT_FOUND/
// VERSION_NOT_FOUND/INVALID_ARGUMENT — a permanent, migration-shaped refusal that told it nothing
// about its OWN mistake. The confinement check is now DEFERRED: both admission sources
// (`spec.origin`, the trigger's own provenance; `registered.registeredRemote`, the resolved
// version's) still measure at the same two points, but the THROW is deferred to the LAST pure
// check, immediately before the first durable write (`createRun`). `INLINE_SCRIPT_CLOSED` is kept
// as the cheap ordering witness this file always used — it needs no catalog/gateway/sandbox setup,
// and now proves the OPPOSITE fact: it fires BEFORE the confinement refusal, not after.
// The full "an otherwise-ADMISSIBLE remote+unconfined run_start still ends up refused
// CONFINEMENT_UNAVAILABLE" property is proved end-to-end (real catalog, real callTool) by
// `tests/integration/registered-remote-admission.test.ts` and
// `tests/integration/confinement-precedence.test.ts` (issue #93 item 2's own new coverage for the
// WORKFLOW_NOT_FOUND/INVALID_ARGUMENT/CONFINEMENT_UNAVAILABLE precedence ladder).
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';

describe('UT-330 RunManager.start(): the confinement refusal is DEFERRED past INLINE_SCRIPT_CLOSED (issue #93 item 2)', () => {
  it('[LOAD-BEARING] remote + unconfined + an inline spec.script => INLINE_SCRIPT_CLOSED, never CONFINEMENT_UNAVAILABLE — a more specific refusal always wins', async () => {
    const rm = new RunManager({ confinementPosture: 'unconfined' });
    await expect(rm.start({ script: 'noop', origin: 'remote' })).rejects.toMatchObject({ code: 'INLINE_SCRIPT_CLOSED' });
  });

  it('local + unconfined => the admission gate does NOT fire at all; INLINE_SCRIPT_CLOSED (the owner\'s accepted local-unconfined cost, stated as code)', async () => {
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

// issue #93 item 2: RUN_ADMISSION_LIMIT is a pure capacity READ (no durable write), and the
// deferred confinement throw now sits AFTER it (it used to sit ahead, by deliberate P1 design —
// see run-manager.ts's own comment on this trade-off) — a remote+unconfined submission arriving
// while the engine is already at `maxConcurrentRuns` is answered the RETRYABLE RUN_ADMISSION_LIMIT,
// not the PERMANENT CONFINEMENT_UNAVAILABLE. This is the accepted cost of moving
// existence/argument precedence ahead of confinement; needs one run occupying the single slot
// (`maxConcurrentRuns` must be >= 1) so a second submission actually observes the cap.
describe('UT-330b RUN_ADMISSION_LIMIT precedes the deferred confinement refusal when the cap is saturated (issue #93 item 2)', () => {
  it('[LOAD-BEARING] a live run occupies the one slot; the next remote+unconfined submission is refused RUN_ADMISSION_LIMIT, not CONFINEMENT_UNAVAILABLE', async () => {
    const rm = new RunManager({ confinementPosture: 'unconfined', maxConcurrentRuns: 1 });
    // Occupies the single slot: a LOCAL, no-name/no-script ad-hoc submission reaches
    // `_store.createRun` (the in-memory default store) and stays 'running'/'queued' (no agent()
    // calls to await), never reaching a terminal state within this test.
    await rm.start({ origin: 'local' });
    await expect(rm.start({ origin: 'remote' })).rejects.toMatchObject({ code: 'RUN_ADMISSION_LIMIT' });
  });
});
