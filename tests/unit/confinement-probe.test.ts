// UT-323 (DES-261, ARCH-181, TASK-257, REQ-218) — probeConfinement(): the boot-time nested-bwrap
// measurement that decides the engine's confinement POSTURE (ADR-083 owner_decision, posture C).
// Injected spawn — no real subprocess in this file (the real default is exercised for real by every
// composeConfig() call across the suite, and directly in confinement-probe-real.test.ts below).
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { probeConfinement } from '../../src/gateway/confinement-probe.js';

function hasBubblewrap(): boolean {
  try {
    execSync('which bwrap', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

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

// issue #93 item 1: the pre-fix probe args gave a FALSE `unconfined` reading on a host whose OUTER
// layer needs `--proc /proc --dev /dev` for the INNER `bwrap` to set up its own uid map at all — the
// Claude CLI's own sandbox invocation carries both on every layer. Asserted via the injected
// SpawnImpl (no real subprocess): both the outer arg list AND the args after the inner `bwrap --`
// separator must carry the pair.
describe('UT-339 probeConfinement() nested bwrap args mirror the CLI: both layers carry --proc/--dev (issue #93 item 1)', () => {
  it('[LOAD-BEARING] the OUTER bwrap invocation is called with --proc /proc --dev /dev', () => {
    let seenArgs: string[] = [];
    probeConfinement((_cmd, args) => {
      seenArgs = args;
      return { status: 0, stderr: '' };
    });
    const idx = seenArgs.indexOf('--proc');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(seenArgs[idx + 1]).toBe('/proc');
    const devIdx = seenArgs.indexOf('--dev');
    expect(devIdx).toBeGreaterThanOrEqual(0);
    expect(seenArgs[devIdx + 1]).toBe('/dev');
  });

  it('[LOAD-BEARING] the INNER (nested) bwrap invocation — the args after its own "bwrap" token — also carries --proc /proc --dev /dev', () => {
    let seenArgs: string[] = [];
    probeConfinement((_cmd, args) => {
      seenArgs = args;
      return { status: 0, stderr: '' };
    });
    const bwrapIdx = seenArgs.indexOf('bwrap');
    expect(bwrapIdx).toBeGreaterThanOrEqual(0);
    const inner = seenArgs.slice(bwrapIdx);
    const idx = inner.indexOf('--proc');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(inner[idx + 1]).toBe('/proc');
    const devIdx = inner.indexOf('--dev');
    expect(devIdx).toBeGreaterThanOrEqual(0);
    expect(inner[devIdx + 1]).toBe('/dev');
  });
});

// issue #93 item 1: real-tier — the owner applied and re-verified a persistent host fix
// (kernel.apparmor_restrict_unprivileged_userns=0 + bwrap-userns-restrict AppArmor profile
// disabled) under which a REAL nested bwrap (CLI-shaped: both layers carrying --proc/--dev) exits
// 0 on this host. Skipped with a clear reason when bwrap itself is absent (same convention as
// val-253-bash-confinement.test.ts's HAS_SANDBOX_RUNTIME gate) — never silently green on a host
// that cannot possibly prove this.
describe('UT-340 probeConfinement() real-tier — this host measures confined (issue #93 item 1)', () => {
  it.skipIf(!hasBubblewrap())(
    'the REAL default spawnSync call returns posture:confined on this host' +
      ' [UNVERIFIED here: needs bubblewrap on PATH]',
    () => {
      const r = probeConfinement();
      expect(r).toEqual({ posture: 'confined' });
    },
  );
});
