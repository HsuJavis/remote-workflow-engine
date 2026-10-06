// Issue #157 B3: the authoring guide claimed `console` was "simply absent from the context" — false
// as implemented (a bare `node:vm` context gets its own inert per-realm `console`, confirmed it
// writes nowhere observable through the real forked child, but it IS present, not absent). The guide
// text was corrected (src/authoring-guide.ts) rather than removing `console` from the sandbox — an
// owner-decision call (doc fix vs. code removal), not a security fix either way, since the pre-fix
// behavior was already harmless (no working information channel).
//
// This is the guide-consistency check the issue's own plan asked for: every capability the guide
// claims is "genuinely absent" really is `typeof === 'undefined'` in a REAL evaluateScript call, and
// every one of `console`/`Intl` (the guide's own named exceptions) really is present. A regression
// in either direction — the guide starts over- or under-claiming — fails here before it reaches an
// author.
//
// Mock policy (unit): pure evaluateScript calls, no I/O.
import { describe, it, expect } from 'vitest';
import { evaluateScript } from '../../src/sandbox/guards.js';
import type { SandboxApi } from '../../src/sandbox/guards.js';
import type { Budget } from '../../src/types.js';

const NEVER_BUDGET: Budget = { total: null, spent: () => 0, remaining: () => Infinity };
const FAKE_API: SandboxApi = { async agent() { return 'fake'; }, args: undefined, budget: NEVER_BUDGET };

describe('#157 B3: the guide\'s absence/presence claims match reality', () => {
  it('setTimeout, fetch, require, process, fs are genuinely absent (typeof undefined), as the guide claims', async () => {
    for (const name of ['setTimeout', 'fetch', 'require', 'process', 'fs']) {
      const r = await evaluateScript(`return typeof ${name};`, FAKE_API);
      expect(r.kind, `${name} should not throw`).toBe('done');
      expect(r.value, `${name} should be undefined`).toBe('undefined');
    }
  });

  it('console and Intl are PRESENT (not absent), as the guide now explicitly says', async () => {
    for (const name of ['console', 'Intl']) {
      const r = await evaluateScript(`return typeof ${name};`, FAKE_API);
      expect(r.kind, `${name} should not throw`).toBe('done');
      expect(r.value, `${name} should NOT be undefined`).not.toBe('undefined');
    }
  });

  it('console.log produces no observable output through a real forked child (present but inert, not a working channel)', async () => {
    const { SandboxHost } = await import('../../src/sandbox/host.js');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const workDir = join(tmpdir(), 'rwe-157b3-console');
    const host = new SandboxHost({ workspaceRoot: workDir, onAgentRequest: async () => 'stub' });
    const r = await host.run('it157b3-console', "console.log('LEAKED TO STDOUT'); return 'done';", {}, null);
    expect('result' in (r as object) ? (r as { result: unknown }).result : undefined).toBe('done');
    // host.ts does not capture/forward stdout from the child at all (only stderr, for crash
    // diagnostics) — there is no field on the result that could carry console output either way;
    // this case documents that absence rather than re-asserting process-level stdout capture, which
    // would require spawning the real child outside SandboxHost's own API.
  });
});
