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
