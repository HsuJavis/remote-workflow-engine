// Issue #157 B1 (CRITICAL): `<injected>.constructor.constructor` reaches the sandbox child's REAL
// process/fetch/env — not a neutered context copy. Reproduced end-to-end through the real
// SandboxHost (the actual fork() boundary), not just in-process against evaluateScript, because the
// evidence that mattered was that the forked child inherits the engine's full process.env (where
// provider API keys live, per main.ts) with no `env:` override on fork() — an in-process-only test
// cannot observe that at all.
//
// Root cause (confirmed by code inspection before this fix): guards.ts's `sandbox` object literal
// assigned host-realm-created functions/objects (`api.agent.bind(api)`, the Math/Date guards, etc.)
// directly as vm context globals. `vm.createContext()` does not re-realm an externally-created
// object's prototype chain, so `<injected>.constructor` resolves to the HOST Function constructor
// regardless of what the injected value's OWN logic does — `agent.constructor.constructor('return
// process')()` returns the live process object because `agent`'s prototype chain (via
// Function.prototype, set when `.bind()` ran in the embedding realm) was never severed from that
// realm. The control case (`Function('return process')()`, no injected object involved) correctly
// throws ReferenceError, proving the context's OWN realm has always been isolated — the leak was
// specifically through objects CREATED in the host realm and handed into the context as properties.
//
// RED before the fix: every "process leaks" / "fetch leaks" case below resolves with a live handle
// (a real pid, a callable fetch) instead of throwing/being unreachable.
//
// Mock policy (integration, DES-015): the REAL SandboxHost forks the REAL child process and runs
// the REAL vm guards — nothing about the sandbox is faked. `onAgentRequest` is stubbed (dry-run,
// DES-006's documented seam) since no agent dispatch is needed to exercise the escape — the escape
// fires at script evaluation, before any agent() call completes.
import { describe, it, expect } from 'vitest';
import { SandboxHost } from '../../src/sandbox/host.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORK_DIR = join(tmpdir(), 'rwe-157b1-realm-escape');
const SENTINEL = 'RWE_157_SENTINEL_SECRET';

function freshHost(): SandboxHost {
  return new SandboxHost({ workspaceRoot: WORK_DIR, onAgentRequest: async () => 'stub' });
}

function resultOf(r: unknown): unknown {
  if (!(r && typeof r === 'object' && 'result' in r)) {
    throw new Error(`script did not complete cleanly: ${JSON.stringify(r)}`);
  }
  return (r as { result: unknown }).result;
}

describe('#157 B1: .constructor.constructor cannot reach the real child process (real fork boundary)', () => {
  it('agent.constructor.constructor("return process")() does not yield a live process object', async () => {
    const script = `
      try {
        const proc = agent.constructor.constructor('return process')();
        return { escaped: true, hasPid: typeof proc === 'object' && proc !== null && typeof proc.pid === 'number' };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-agent-process', script, {}, null);
    const dump = resultOf(r) as { escaped: boolean; hasPid?: boolean; errorName?: string };
    expect(dump.escaped).toBe(false);
  });

  it('args.constructor.constructor("return process")() does not yield a live process object either — not limited to agent', async () => {
    const script = `
      try {
        const proc = args.constructor.constructor('return process')();
        return { escaped: true, hasPid: typeof proc === 'object' && proc !== null && typeof proc.pid === 'number' };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-args-process', script, { k: 1 }, null);
    const dump = resultOf(r) as { escaped: boolean };
    expect(dump.escaped).toBe(false);
  });

  it('budget.constructor.constructor("return process")() does not yield a live process object', async () => {
    const script = `
      try {
        const proc = budget.constructor.constructor('return process')();
        return { escaped: true };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-budget-process', script, {}, 500);
    const dump = resultOf(r) as { escaped: boolean };
    expect(dump.escaped).toBe(false);
  });

  it('agent.constructor.constructor("return fetch")() does not yield a callable fetch (no network reachable via the escape)', async () => {
    const script = `
      try {
        const f = agent.constructor.constructor('return fetch')();
        return { escaped: true, isFunction: typeof f === 'function' };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-agent-fetch', script, {}, null);
    const dump = resultOf(r) as { escaped: boolean };
    expect(dump.escaped).toBe(false);
  });

  it('even IF the escape fired, the sentinel set only in THIS test process must not be readable (defense in depth / env scrub)', async () => {
    process.env[SENTINEL] = 'leaked-if-you-can-read-this';
    try {
      const script = `
        try {
          const proc = agent.constructor.constructor('return process')();
          return { sawSentinel: !!(proc && proc.env && proc.env.${SENTINEL}) };
        } catch (e) {
          return { sawSentinel: false, blocked: true };
        }
      `;
      const r = await freshHost().run('it157-sentinel', script, {}, null);
      const dump = resultOf(r) as { sawSentinel: boolean };
      expect(dump.sawSentinel).toBe(false);
    } finally {
      delete process.env[SENTINEL];
    }
  });

  it('Math.constructor.constructor("return process")() does not yield a live process object (same root cause, not just agent/args)', async () => {
    const script = `
      try {
        const proc = Math.constructor.constructor('return process')();
        return { escaped: true };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-math-process', script, {}, null);
    const dump = resultOf(r) as { escaped: boolean };
    expect(dump.escaped).toBe(false);
  });

  it('control case: the bare Function global (no injected object) stays isolated, as before the fix', async () => {
    const script = `
      try {
        const proc = Function('return process')();
        return { escaped: true };
      } catch (e) {
        return { escaped: false, errorName: e.name };
      }
    `;
    const r = await freshHost().run('it157-control', script, {}, null);
    const dump = resultOf(r) as { escaped: boolean; errorName?: string };
    expect(dump.escaped).toBe(false);
    expect(dump.errorName).toBe('ReferenceError');
  });

  it('a normal script (no escape attempt) still runs and returns its value — the fix does not break ordinary scripts', async () => {
    const r = await freshHost().run('it157-sanity', 'return 1 + 1;', {}, null);
    expect(resultOf(r)).toBe(2);
  });
});
