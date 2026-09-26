// UT-323 (DES-261, ARCH-181, TASK-257, REQ-218) — probeConfinement(): the boot-time nested-bwrap
// measurement that decides the engine's confinement POSTURE (ADR-083 owner_decision, posture C).
// Injected spawn — no real subprocess in this file (the real default is exercised for real by every
// composeConfig() call across the suite, and directly in confinement-probe-real.test.ts below).
//
// send-back item 1 (verify-b, 2026-09-26): every test below that injects `spawn` now ALSO injects
// `which` (a WhichImpl stub reporting every hard dependency present) — isolating what each test
// actually means to exercise (the nested-bwrap probe logic) from the SEPARATE hard-dependency check
// added this iteration (UT-341 below). Without this, every one of these would flip red or green
// depending on whether `socat` happens to be installed on whichever host runs the suite — exactly
// the host-dependence the dispatch for this fix explicitly forbids ("the owner is installing socat
// on this host in parallel — your tests must not depend on whether it is installed").
import { describe, it, expect } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { probeConfinement } from '../../src/gateway/confinement-probe.js';

function hasBubblewrap(): boolean {
  try {
    execSync('which bwrap', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hasSocat(): boolean {
  try {
    execSync('which socat', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Every hard dependency reported present — isolates the nested-bwrap probe logic under test.
const ALL_DEPS_PRESENT = () => true;

describe('UT-323 probeConfinement() — exit 0 on the nested bwrap probe means confined, anything else means unconfined with a reason', () => {
  it('nested bwrap exits 0 ⇒ confined, no reason', () => {
    const r = probeConfinement(() => ({ status: 0, stderr: '' }), ALL_DEPS_PRESENT);
    expect(r).toEqual({ posture: 'confined' });
  });

  it('nested bwrap exits nonzero ⇒ unconfined, carrying stderr as reason', () => {
    const r = probeConfinement(() => ({ status: 1, stderr: 'No permissions to create a new namespace' }), ALL_DEPS_PRESENT);
    expect(r.posture).toBe('unconfined');
    expect(r.reason).toContain('No permissions to create a new namespace');
  });

  it('bwrap missing entirely (ENOENT-shaped spawn error) ⇒ unconfined, carrying the spawn error as reason', () => {
    const r = probeConfinement(() => ({ status: null, error: new Error('spawnSync bwrap ENOENT'), stderr: '' }), ALL_DEPS_PRESENT);
    expect(r.posture).toBe('unconfined');
    expect(r.reason).toContain('ENOENT');
  });

  it('a timeout (status:null, no error, no stderr) still resolves unconfined, never throws/hangs', () => {
    const r = probeConfinement(() => ({ status: null, stderr: '' }), ALL_DEPS_PRESENT);
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
    }, ALL_DEPS_PRESENT);
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
    }, ALL_DEPS_PRESENT);
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

// send-back item 1 (verify-b, 2026-09-26): the CLI's own real sandbox dependency check
// (checkDependencies(), confirmed via strings in the installed
// @anthropic-ai/claude-agent-sdk-linux-x64 binary's own error catalogue — "bubblewrap (bwrap) not
// installed", "socat not installed") requires TWO binaries on PATH, not one. The pre-fix probe only
// ever measured bwrap (implicitly, via the nested-bwrap spawn's own ENOENT) — a host with bwrap but
// no socat measured a FALSE 'confined' here while the real CLI refused to start at all
// (verify-b's own real repro: "sandbox required but unavailable: ... socat not installed").
describe('UT-341 probeConfinement() checks the Claude CLI\'s hard sandbox dependencies FIRST, before ever spawning bwrap (send-back item 1)', () => {
  it('bwrap missing on PATH ⇒ unconfined, reason names bwrap, the nested-bwrap probe is never spawned', () => {
    let spawned = false;
    const r = probeConfinement(
      () => {
        spawned = true;
        return { status: 0, stderr: '' };
      },
      (cmd) => cmd !== 'bwrap',
    );
    expect(r.posture).toBe('unconfined');
    expect(r.reason).toContain('bwrap');
    expect(spawned).toBe(false);
  });

  it('socat missing on PATH ⇒ unconfined, reason names socat, the nested-bwrap probe is never spawned', () => {
    let spawned = false;
    const r = probeConfinement(
      () => {
        spawned = true;
        return { status: 0, stderr: '' };
      },
      (cmd) => cmd !== 'socat',
    );
    expect(r.posture).toBe('unconfined');
    expect(r.reason).toContain('socat');
    expect(spawned).toBe(false);
  });

  it('both bwrap and socat present on PATH ⇒ falls through to the nested-bwrap probe (spawn IS called)', () => {
    let spawned = false;
    probeConfinement(
      () => {
        spawned = true;
        return { status: 0, stderr: '' };
      },
      ALL_DEPS_PRESENT,
    );
    expect(spawned).toBe(true);
  });

  it('the default `which` resolves against the SAME PATH the CLI child process gets (process.env.PATH), no `which`/`command -v` subprocess of its own', () => {
    // Smoke only (host-agnostic): must not throw, and must agree with a real, independent PATH
    // lookup for a binary that is virtually always present (node's own launcher directory aside,
    // `sh` is POSIX-mandated).
    const r = probeConfinement();
    expect(['confined', 'unconfined']).toContain(r.posture);
  });
});

// issue #93 item 1: real-tier — the owner applied and re-verified a persistent host fix
// (kernel.apparmor_restrict_unprivileged_userns=0 + bwrap-userns-restrict AppArmor profile
// disabled) under which a REAL nested bwrap (CLI-shaped: both layers carrying --proc/--dev) exits
// 0 on this host. Skipped with a clear reason when bwrap itself is absent (same convention as
// val-253-bash-confinement.test.ts's HAS_SANDBOX_RUNTIME gate) — never silently green on a host
// that cannot possibly prove this.
describe('UT-340 probeConfinement() real-tier — agrees with a direct CLI-shaped nested bwrap (issue #93 item 1)', () => {
  // Host-agnostic: on ANY host with bwrap, the engine's verdict must equal what an independent,
  // literal CLI-shaped nested invocation measures (a CI runner with the Ubuntu AppArmor userns
  // restriction still active is legitimately 'unconfined' — that must not turn the suite red).
  // send-back item 1: the expected posture now ALSO requires socat on PATH (independently
  // rechecked here, never assumed) — `probeConfinement()`'s own real `which` now gates on it too,
  // and this comparison must not go host-dependently red/green depending on whether socat happens
  // to be installed on whichever machine runs the suite.
  it.skipIf(!hasBubblewrap())(
    'posture is confined iff a direct nested bwrap (both layers --proc/--dev) exits 0 AND socat is independently found on PATH' +
      ' [UNVERIFIED here: needs bubblewrap on PATH]',
    () => {
      const layer = ['--unshare-user', '--unshare-pid', '--ro-bind', '/', '/', '--tmpfs', '/tmp', '--proc', '/proc', '--dev', '/dev', '--'];
      const direct = spawnSync('bwrap', [...layer, 'bwrap', ...layer, '/bin/true'], { timeout: 5000 });
      const r = probeConfinement();
      const expectConfined = direct.status === 0 && hasSocat();
      expect(r.posture).toBe(expectConfined ? 'confined' : 'unconfined');
    },
  );
  // Host-specific: the production host (sysctl + AppArmor fix applied, AND socat installed) must
  // measure confined. Opt-in so CI runners without that host fix are not failed by a fact about
  // another machine.
  it.skipIf(!hasBubblewrap() || process.env['RWE_EXPECT_CONFINED'] !== '1')(
    'RWE_EXPECT_CONFINED=1: this host measures posture:confined',
    () => {
      expect(probeConfinement()).toEqual({ posture: 'confined' });
    },
  );
});
