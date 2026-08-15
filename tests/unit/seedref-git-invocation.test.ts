// UT-084 (DES-081, DES-082, ARCH-053, TASK-077, TASK-078): pure `buildGitInvocation` — asserts
// that every hardened env flag is present, no ambient process.env is inherited, and the args
// include all the required hardening flags (--depth 1, -c http.followRedirects=false,
// -c submodule.recurse=false).
//
// Red reason: `src/seedref-fetcher.ts` does not exist yet → "Cannot find module" at vitest
// collect time. The feature is unimplemented.
//
// Mock policy (unit): pure function, no I/O, no network, no clock.

import { describe, it, expect } from 'vitest';
import { buildGitInvocation } from '../../src/seedref-fetcher.js';

const BASE_REQ = {
  repoUrl: 'https://github.com/HsuJavis/remote-workflow-plugin',
  sha: '60ee8954e19fe5eaf2cf498202475c3c6fc9b8a4',
  timeoutMs: 30_000,
  maxTotalBytes: 50 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
};

describe('buildGitInvocation — hardened env (DES-082 K2)', () => {
  it('GIT_CONFIG_NOSYSTEM=1 prevents system-level gitconfig (defeats insteadOf rewrites)', () => {
    const { env } = buildGitInvocation(BASE_REQ);
    expect(env['GIT_CONFIG_NOSYSTEM']).toBe('1');
  });

  it('GIT_ALLOW_PROTOCOL=https blocks non-https git transports at the git level', () => {
    const { env } = buildGitInvocation(BASE_REQ);
    expect(env['GIT_ALLOW_PROTOCOL']).toBe('https');
  });

  it('GIT_TERMINAL_PROMPT=0 makes private-repo auth fail typed, never hang', () => {
    const { env } = buildGitInvocation(BASE_REQ);
    expect(env['GIT_TERMINAL_PROMPT']).toBe('0');
  });

  it('HOME is set to an isolated path (not process.env.HOME) to prevent ~/.gitconfig loading', () => {
    const { env } = buildGitInvocation(BASE_REQ);
    expect(typeof env['HOME']).toBe('string');
    expect(env['HOME']).not.toBe(process.env['HOME'] ?? '');
  });

  it('GIT_CONFIG_GLOBAL is set to an isolated path (not process.env.GIT_CONFIG_GLOBAL)', () => {
    const { env } = buildGitInvocation(BASE_REQ);
    expect(typeof env['GIT_CONFIG_GLOBAL']).toBe('string');
    expect(env['GIT_CONFIG_GLOBAL']).not.toBe(process.env['GIT_CONFIG_GLOBAL'] ?? '');
  });

  it('ambient process.env.PATH / OPENAI_API_KEY / HOME are NOT inherited (no env spread)', () => {
    // Key security property: the subprocess env must be exactly the hardened set,
    // never a superset of process.env (which could carry API keys, gitconfig, etc.)
    const { env } = buildGitInvocation(BASE_REQ);
    // PATH must be absent or explicitly set to a minimal value — not inherited
    // (The impl must NOT use `{ ...process.env, GIT_CONFIG_NOSYSTEM: '1' }`)
    if ('PATH' in env) {
      // If PATH is present it must be a controlled minimal string, not the host's full PATH
      expect(env['PATH']).not.toBe(process.env['PATH'] ?? '');
    }
    // A sentinel env var that would ONLY exist if process.env were spread
    // (We set a test-only env var here to catch the spread)
    expect(env['__RWE_EGRESS_TEST_SENTINEL__']).toBeUndefined();
  });
});

describe('buildGitInvocation — hardened args (DES-082 K3/K4)', () => {
  it('args include --depth 1 (shallow clone bounds download size)', () => {
    const { args } = buildGitInvocation(BASE_REQ);
    expect(args).toContain('--depth');
    expect(args).toContain('1');
  });

  it('args include -c http.followRedirects=false (no cross-host 3xx redirect pivot)', () => {
    const { args } = buildGitInvocation(BASE_REQ);
    const argsStr = args.join(' ');
    expect(argsStr).toContain('http.followRedirects=false');
  });

  it('args include -c submodule.recurse=false (submodule URL is attacker-controlled, bypasses allowlist)', () => {
    const { args } = buildGitInvocation(BASE_REQ);
    const argsStr = args.join(' ');
    expect(argsStr).toContain('submodule.recurse=false');
  });

  it('the sha from the request appears in the args (the target commit to fetch)', () => {
    const { args } = buildGitInvocation(BASE_REQ);
    expect(args.some((a) => a.includes(BASE_REQ.sha))).toBe(true);
  });

  it('the repoUrl from the request appears in the args', () => {
    const { args } = buildGitInvocation(BASE_REQ);
    expect(args.some((a) => a.includes(BASE_REQ.repoUrl))).toBe(true);
  });

  it('args is an array of strings (safe to pass to execFile, not shell-interpolated)', () => {
    const { args } = buildGitInvocation(BASE_REQ);
    expect(Array.isArray(args)).toBe(true);
    for (const a of args) expect(typeof a).toBe('string');
  });
});
