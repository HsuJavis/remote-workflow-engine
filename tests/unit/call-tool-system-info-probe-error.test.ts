// Round-3 reverify (#166 decision 3, low): `system_info`'s own catch (call-tool.ts, the
// 'system_info' case) answered `{status:'error', error:{code:'PROBE_ERROR', message:String(err)}}`
// directly — NOT through `errors.ts`'s `toErrEnvelope`, the ONE place decision 3 funnels every
// other MCP-facing envelope through specifically so a raw fs/probe error's message (which can
// carry this engine's absolute host path) never reaches the wire. Not reachable today (every fs
// read inside `SystemInfo.get()` already has its own try/catch), but a latent bypass of the
// central scrub all the same — this file forces the branch directly via a `systemInfo.get` that
// throws, bypassing whether anything inside `SystemInfo.get()` itself can currently throw.
//
// Fix: `toErrorCode('PROBE_ERROR')` is a real, catalogued `ErrorCode` now (errors.ts), and
// `toErrEnvelope` scrubs its message exactly the way it already scrubbed `INTERNAL_ERROR`'s — so
// the CODE the caller sees is still `PROBE_ERROR` (never folded to `INTERNAL_ERROR`), but the
// MESSAGE is the same catalogued, path-free hint, with the real message (and any host path it
// carries) logged server-side only.
//
// RED before the fix: `result.error.message` is `String(err)` verbatim, containing the injected
// absolute host path.
//
// Mock policy (unit): `partialDeps` (same pattern as call-tool-order.test.ts) — only `systemInfo`
// is relevant to this case; `principal: {kind:'auth-disabled'}` so authorize() never needs a real
// lookup.
import { describe, it, expect, vi } from 'vitest';
import { callTool } from '../../src/call-tool.js';
import type { ToolDeps } from '../../src/call-tool.js';

function partialDeps(d: Record<string, unknown>): ToolDeps {
  return d as unknown as ToolDeps;
}

describe('callTool("system_info") — a probe failure never leaks a raw/host-path-bearing message (#166 decision 3)', () => {
  it('a systemInfo.get() throw carrying an absolute host path answers code:PROBE_ERROR with a scrubbed, path-free message', async () => {
    const leakyPath = '/home/rwe/.local/share/rwe-data/some-probe-path';
    const deps = partialDeps({
      systemInfo: { get: vi.fn(async () => { throw new Error(`EACCES: permission denied, stat '${leakyPath}'`); }) },
      lookup: {}, audit: {},
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = (await callTool(deps, 'system_info', {}, { kind: 'auth-disabled' })) as {
        status?: string; error?: { code?: string; message?: string };
      };
      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('PROBE_ERROR');
      expect(result.error?.message ?? '').not.toContain('/home/');
      expect(result.error?.message ?? '').not.toContain(leakyPath);
      // The real message IS still logged server-side — decision 3's own convention, not dropped.
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes(leakyPath))).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });
});
