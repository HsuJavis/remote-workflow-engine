// UT-323 (DES-261, ARCH-181, TASK-257, REQ-218) — probeConfinement(): the boot-time nested-bwrap
// measurement that decides the engine's confinement POSTURE (ADR-083 owner_decision, posture C).
// Injected spawn — no real subprocess in this file (the real default is exercised for real by every
// composeConfig() call across the suite, and directly in confinement-probe-real.test.ts below).
import { describe, it, expect } from 'vitest';
import { probeConfinement } from '../../src/gateway/confinement-probe.js';

describe('UT-323 probeConfinement() — exit 0 on the nested bwrap probe means confined, anything else means unconfined with a reason', () => {
  it('nested bwrap exits 0 ⇒ confined, no reason', () => {
    const r = probeConfinement(() => ({ status: 0, stderr: '' }));
    expect(r).toEqual({ posture: 'confined' });
  });

  it('nested bwrap exits nonzero ⇒ unconfined, carrying stderr as reason', () => {
    const r = probeConfinement(() => ({ status: 1, stderr: 'No permissions to create a new namespace' }));
    expect(r.posture).toBe('unconfined');
    expect(r.reason).toContain('No permissions to create a new namespace');
  });

  it('bwrap missing entirely (ENOENT-shaped spawn error) ⇒ unconfined, carrying the spawn error as reason', () => {
    const r = probeConfinement(() => ({ status: null, error: new Error('spawnSync bwrap ENOENT'), stderr: '' }));
    expect(r.posture).toBe('unconfined');
    expect(r.reason).toContain('ENOENT');
  });

  it('a timeout (status:null, no error, no stderr) still resolves unconfined, never throws/hangs', () => {
    const r = probeConfinement(() => ({ status: null, stderr: '' }));
    expect(r.posture).toBe('unconfined');
    expect(r.reason).toBeTruthy();
  });
});

describe('UT-323b probeConfinement() default arg is a REAL spawnSync call (smoke, no mocking)', () => {
  it('runs against the real host without throwing and returns a well-formed result', () => {
    const r = probeConfinement();
    expect(['confined', 'unconfined']).toContain(r.posture);
    if (r.posture === 'unconfined') expect(typeof r.reason).toBe('string');
  });
});
