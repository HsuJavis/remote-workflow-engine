// pi harness v1 — env hermeticity (spec "Env rule", design change 3, safety-critical; pi-spike-
// report.md "Extra — env-leak canary"). Pure unit tier: no srt, no bwrap, no child process. Proves
// the canary rule with a FAKE processEnv/sandboxEnv — the real-srt/real-bwrap canary (gated like
// val-253-bash-confinement.test.ts) is a separate, host-gated test.
import { describe, it, expect } from 'vitest';
import { buildBashEnv, isWrapped, PI_BASH_ENV_ALLOWLIST } from '../../src/gateway/pi-child/bash-env.js';

describe('pi harness: buildBashEnv (env hermeticity canary, unit tier)', () => {
  it('never leaks RWE_SECRET_* or provider keys even when sandboxEnv is the naive wide spread of callerEnv', () => {
    const callerEnv = {
      PATH: '/usr/bin:/bin',
      HOME: '/home/rwe',
      SHELL: '/bin/bash',
      LANG: 'C.UTF-8',
      TMPDIR: '/tmp',
      TERM: 'xterm',
      RWE_SECRET_CANARY: 'CANARY-SHOULD-NOT-LEAK-12345',
      RWE_SECRET_OPENROUTER_API_KEY: 'sk-or-should-not-leak',
      OPENROUTER_API_KEY: 'sk-or-should-not-leak-either',
      SOME_OTHER_HOST_VAR: 'leak-me-not',
    };
    // The exact hazard the spike caught: srt's returned env is `{...callerEnv, +its own additions}`.
    const sandboxEnv = { ...callerEnv, SANDBOX_RUNTIME: '1', HTTP_PROXY: 'http://127.0.0.1:1234', TMPDIR: '/tmp/srt-xyz' };

    const result = buildBashEnv(callerEnv, sandboxEnv);

    expect(result.RWE_SECRET_CANARY).toBeUndefined();
    expect(result.RWE_SECRET_OPENROUTER_API_KEY).toBeUndefined();
    expect(result.OPENROUTER_API_KEY).toBeUndefined();
    expect(result.SOME_OTHER_HOST_VAR).toBeUndefined();
    // Allowlisted keys still reach the child.
    expect(result.PATH).toBe('/usr/bin:/bin');
    expect(result.HOME).toBe('/home/rwe');
    // srt's own additions (not present in callerEnv at all) are kept.
    expect(result.SANDBOX_RUNTIME).toBe('1');
    expect(result.HTTP_PROXY).toBe('http://127.0.0.1:1234');
    // srt's own OVERRIDE of an allowlisted key (TMPDIR) wins over the plain allowlist copy.
    expect(result.TMPDIR).toBe('/tmp/srt-xyz');
  });

  it('a naive "spread sandboxEnv as base" implementation WOULD leak the canary (documents why the fix is necessary)', () => {
    const callerEnv = { PATH: '/usr/bin', RWE_SECRET_CANARY: 'LEAKED' };
    const sandboxEnv = { ...callerEnv, SRT_X: '1' };
    const naive = { ...sandboxEnv, PATH: callerEnv.PATH, HOME: '/home/rwe' };
    expect(naive.RWE_SECRET_CANARY).toBe('LEAKED'); // the bug the spike found
    // The real helper does not reproduce it.
    expect(buildBashEnv(callerEnv, sandboxEnv).RWE_SECRET_CANARY).toBeUndefined();
  });

  it('omits an allowlisted key entirely when callerEnv does not have it set', () => {
    const result = buildBashEnv({ PATH: '/bin' }, {});
    expect('HOME' in result).toBe(false);
    expect(result.PATH).toBe('/bin');
  });

  it('PI_BASH_ENV_ALLOWLIST matches the SDK gateway allowlist keys', () => {
    expect([...PI_BASH_ENV_ALLOWLIST].sort()).toEqual(['HOME', 'LANG', 'LC_ALL', 'PATH', 'SHELL', 'TERM', 'TMPDIR'].sort());
  });
});

describe('pi harness: isWrapped (honest confinement-enforced check, design change 2)', () => {
  it('is false for the SDK-shaped argv[0]==="bwrap" check (the wrong, research-brief check)', () => {
    // wrapWithSandboxArgv's REAL argv[0] is always 'bash', never 'bwrap' — this test documents the
    // bug the spike found in the research brief's own fail-open check.
    const argv = ['bash', '-c', 'bwrap --unshare-user --unshare-pid -- /bin/true'];
    expect(argv[0] === 'bwrap').toBe(false);
    expect(isWrapped(argv)).toBe(true);
  });

  it('is true for a real nested bwrap invocation embedded in argv[2]', () => {
    const argv = ['bash', '-c', 'exec bwrap --unshare-user --unshare-pid --ro-bind / / -- /bin/sh -c "echo hi"'];
    expect(isWrapped(argv)).toBe(true);
  });

  it('is false for an unwrapped plain command (no bwrap at all)', () => {
    expect(isWrapped(['bash', '-c', 'echo hi'])).toBe(false);
  });

  it('is false when "bwrap" merely appears in echoed text with no --unshare (cannot be forged)', () => {
    const argv = ['bash', '-c', 'echo "bwrap is a sandboxing tool"'];
    expect(isWrapped(argv)).toBe(false);
  });
});
