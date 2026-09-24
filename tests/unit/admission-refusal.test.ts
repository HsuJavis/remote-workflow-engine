// [更正 2026-09-25, Gate 8 round-5 finding R5-F3] Wherever the header below implies that only a
// REMOTE submission is refused, or that call-tool.ts's door is the only control: since v37 P1 a run
// is also refused when its trigger was created remotely or when the version it resolves to was
// registered remotely — the latter refuses a LOCAL run_start too. See DES-263 第三次/第四次修訂.
//
// UT-329 (DES-263, ARCH-182, ADR-086, TASK-258, REQ-218) — admissionRefusal({posture, origin}): the
// ONE pure predicate every run admission passes at RunManager.start(). Closes the two admission
// routes (schedule, webhook) DES-262's isLoopbackPeer door does not cover, per ADR-086's ruling
// (keyed on the TRIGGER's own stored provenance, never the workflow version's registering author).
// Written test-first (RED): src/run-manager.ts exports no `admissionRefusal` — module-not-found on
// that named import.
import { describe, it, expect } from 'vitest';
import { admissionRefusal } from '../../src/run-manager.js';

describe('UT-329 admissionRefusal() — pure 2x2 predicate over {posture, origin} (DES-263)', () => {
  it('[LOAD-BEARING] unconfined + remote => CONFINEMENT_UNAVAILABLE (the exact class ADR-083 posture C exists to intercept)', () => {
    expect(admissionRefusal({ posture: 'unconfined', origin: 'remote' })).toBe('CONFINEMENT_UNAVAILABLE');
  });

  it('unconfined + local => null (the owner\'s accepted cost: 本機發起的 run 仍不受限制)', () => {
    expect(admissionRefusal({ posture: 'unconfined', origin: 'local' })).toBeNull();
  });

  it('confined + remote => null (the sandbox is measured working; nothing to refuse)', () => {
    expect(admissionRefusal({ posture: 'confined', origin: 'remote' })).toBeNull();
  });

  it('confined + local => null', () => {
    expect(admissionRefusal({ posture: 'confined', origin: 'local' })).toBeNull();
  });

  it('posture undefined ("never measured") => null regardless of origin — the same fail-open-for-the-existing-suite convention ToolDeps already uses for this field', () => {
    expect(admissionRefusal({ posture: undefined, origin: 'remote' })).toBeNull();
    expect(admissionRefusal({ posture: undefined, origin: 'local' })).toBeNull();
  });
});
