// issue #162 A/B — TEST-FIRST (RED). A non-serializable (circular/BigInt) or very large
// agent()/workflow() return value used to crash the sandbox child before it could send 'done', and
// leaked the engine's own internal file paths + Node version into the caller-visible ABORTED
// message's stderr tail. Real repro, no mocking of the sandbox boundary: a real fork, real
// child-entry.ts, real node:vm script evaluation (same tier as sandbox-child.test.ts).
import { describe, it, expect } from 'vitest';
import { SandboxHost } from '../../src/sandbox/host.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORK_DIR = join(tmpdir(), 'rwe-sandbox-result-serialization-test');

describe('issue #162 A/B — sandbox child result serialization boundary', () => {
  it('a circular-reference return value resolves RESULT_NOT_SERIALIZABLE, not an ABORTED crash', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    const r = await host.run('run-circular', 'const o = {}; o.self = o; return o;', undefined, null);
    expect('error' in r).toBe(true);
    if (!('error' in r)) throw new Error('unreachable');
    const err = r.error as { code: string; message: string };
    expect(err.code).toBe('RESULT_NOT_SERIALIZABLE');
    // No internal engine implementation detail crosses the trust boundary.
    expect(err.message).not.toMatch(/node:internal/);
    expect(err.message).not.toMatch(/\/home\//);
    expect(err.message).not.toMatch(/\bv\d+\.\d+\.\d+\b/);
  });

  it('an oversized return value resolves RESULT_TOO_LARGE, not a silent ABORTED', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    // 11_000_000-char string, comfortably over the 10MB cap, built from inside the sandboxed script
    // (the vm context's own String.prototype.repeat — no host-side literal needed).
    const r = await host.run('run-huge', `return 'x'.repeat(11000000);`, undefined, null);
    expect('error' in r).toBe(true);
    if (!('error' in r)) throw new Error('unreachable');
    const err = r.error as { code: string; message: string };
    expect(err.code).toBe('RESULT_TOO_LARGE');
  });

  it('an ordinary (small, JSON-safe) return value is unaffected', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    const r = await host.run('run-ok', `return { a: 1, b: 'x' };`, undefined, null);
    expect('result' in r).toBe(true);
    if (!('result' in r)) throw new Error('unreachable');
    expect(r.result).toEqual({ a: 1, b: 'x' });
  });
});

// issues #162 B / #163 B1 — TEST-FIRST (RED, now fixed). `child-entry.ts`'s final `send({t:'done',
// ...})` used to fire `process.exit(0)` immediately after, with no guarantee the IPC write had
// actually reached the kernel first — Node's own `process.send()` writes to the fork IPC socket
// ASYNCHRONOUSLY once a message doesn't fit in one syscall (empirically, anything past roughly
// 160-200KB on a typical Linux box's default socket buffer; deterministically confirmed with a bare
// `fork()` + `process.send(300KBpayload); process.exit(0)` — the parent's 'message' listener never
// fires at all, 0/N over repeated runs). `process.exit()` tore the process down mid-write, silently
// DROPPING the message — the caller-visible `ABORTED "sandbox child process terminated before
// completion (exit 0, signal null)"`. Needs NO concurrency to reproduce (payload size alone is
// sufficient and deterministic); #163 B1's purely-concurrent, smaller-payload failures are the SAME
// mechanism — CPU contention under load delays the same flush a large payload does, widening the
// same race window. Fixed by awaiting `process.send()`'s own completion callback before every
// `process.exit()` in `child-entry.ts`.
describe('issues #162 B / #163 B1 — a large return value is not lost to the send-then-exit race', () => {
  it('a 300KB return value resolves {result}, not ABORTED — repeated 6x (no concurrency needed, payload size alone triggers it)', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    for (let i = 0; i < 6; i++) {
      const r = await host.run(`run-300kb-${i}`, `return 'y'.repeat(300000);`, undefined, null);
      expect('result' in r).toBe(true);
      if (!('result' in r)) throw new Error(`run ${i} did not complete: ${JSON.stringify(r)}`);
      expect((r.result as string).length).toBe(300000);
    }
  });

  it('a 1MB return value (comfortably under the 10MB cap) also resolves {result}, not ABORTED', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    const r = await host.run('run-1mb', `return 'z'.repeat(1000000);`, undefined, null);
    expect('result' in r).toBe(true);
    if (!('result' in r)) throw new Error(`run did not complete: ${JSON.stringify(r)}`);
  });

  it('40 concurrent runs each returning 150KB all resolve {result} (production-shaped concurrent load)', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => host.run(`run-conc-${i}`, `return 'q'.repeat(150000);`, undefined, null)),
    );
    const failed = results.filter((r) => 'error' in r);
    expect(failed).toEqual([]);
  });
});

// g2 minor (sandbox robustness sweep, item 4): child-entry.ts's generic `send()` catch used to treat
// ANY outbound message that fails to serialize as run-terminating — including an agent()/workflow()
// REQUEST (not the run's own final 'done'/'error'), whose `opts`/`args` are themselves script-
// authored values that can carry a circular reference or a BigInt. That is a bug IN THE SCRIPT the
// script itself should be able to catch and recover from (exactly like a BUDGET_EXCEEDED refusal,
// IT-140) — not a reason to end the whole run. Only the final 'done' result (covered by the suite
// above, via child-entry.ts's own JSON.stringify pre-check) keeps the run-terminating behaviour.
//
// Mock policy: same as the suite above — a real forked child, real guards.ts VM evaluation. No
// onAgentRequest/onWorkflowRequest handler is needed: serialization fails inside the CHILD before
// the IPC message is ever sent, so the host-side handler is never reached.
describe('g2 minor item 4 — a non-serializable agent()/workflow() call argument is catchable in the script', () => {
  it('a circular `opts` passed to agent() rejects THAT call with RESULT_NOT_SERIALIZABLE — the run still completes', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    const script = `
      const o = {};
      o.self = o;
      try {
        await agent('x', { circular: o });
        return { caught: false };
      } catch (e) {
        return { caught: true, code: e.code, name: e.name, isError: e instanceof Error };
      }
    `;
    const r = await host.run('run-circular-agent-opts', script, undefined, null);
    expect('result' in r).toBe(true);
    if (!('result' in r)) throw new Error(`run did not complete: ${JSON.stringify(r)}`);
    expect(r.result).toEqual({ caught: true, code: 'RESULT_NOT_SERIALIZABLE', name: 'RESULT_NOT_SERIALIZABLE', isError: true });
  });

  it('a circular `args` passed to workflow() rejects THAT call with RESULT_NOT_SERIALIZABLE — the run still completes', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR, onWorkflowRequest: async () => 'unreachable' });
    const script = `
      const o = {};
      o.self = o;
      try {
        await workflow('child', { circular: o });
        return { caught: false };
      } catch (e) {
        return { caught: true, code: e.code, name: e.name, isError: e instanceof Error };
      }
    `;
    const r = await host.run('run-circular-workflow-args', script, undefined, null);
    expect('result' in r).toBe(true);
    if (!('result' in r)) throw new Error(`run did not complete: ${JSON.stringify(r)}`);
    expect(r.result).toEqual({ caught: true, code: 'RESULT_NOT_SERIALIZABLE', name: 'RESULT_NOT_SERIALIZABLE', isError: true });
  });

  it('a non-serializable phase() title rejects THAT call too — the run still completes (not just agent()/workflow())', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    // `phase(title)` is typed `string` at compile time only — nothing stops a script handing it a
    // circular object at runtime, and `phase()` is synchronous (void), not an awaited call.
    const script = `
      const o = {};
      o.self = o;
      try {
        phase(o);
        return { caught: false };
      } catch (e) {
        return { caught: true, code: e.code };
      }
    `;
    const r = await host.run('run-circular-phase-title', script, undefined, null);
    expect('result' in r).toBe(true);
    if (!('result' in r)) throw new Error(`run did not complete: ${JSON.stringify(r)}`);
    expect(r.result).toEqual({ caught: true, code: 'RESULT_NOT_SERIALIZABLE' });
  });

  it('a BigInt inside `opts` passed to agent() is equally catchable (not just circular references)', async () => {
    const host = new SandboxHost({ workspaceRoot: WORK_DIR });
    const script = `
      try {
        await agent('x', { huge: 1n });
        return { caught: false };
      } catch (e) {
        return { caught: true, code: e.code };
      }
    `;
    const r = await host.run('run-bigint-agent-opts', script, undefined, null);
    expect('result' in r).toBe(true);
    if (!('result' in r)) throw new Error(`run did not complete: ${JSON.stringify(r)}`);
    expect(r.result).toEqual({ caught: true, code: 'RESULT_NOT_SERIALIZABLE' });
  });
});
