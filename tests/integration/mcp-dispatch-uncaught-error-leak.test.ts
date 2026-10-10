// Issue #166 decision 3 (second envelope path): `mcp-facade.ts`'s own methods each wrap their
// business logic in `try { … } catch (err) { toErrEnvelope(err) }` (errors.ts) — the fix already
// covers every coded/uncoded error a FACADE method itself throws. But `server.ts`'s `tools/call`
// dispatch has its OWN, OUTER `catch (err)` around the entire `callTool(...)` call (two near-
// identical copies: the auth-gated branch and the auth-disabled/loopback-exempt fallback) that —
// before this fix — built the JSON-RPC error from `(err as Error).message` VERBATIM. Anything that
// escapes a facade method's own try/catch (a bug in dispatch itself, before a handler's internal
// catch is even reached) would have reached THIS catch and echoed a raw message — including an
// absolute host path — straight onto the wire, bypassing `toErrEnvelope`'s scrub entirely.
//
// This is a genuinely rare path in production (every current tool handler catches internally), so
// it is exercised here by mocking `callTool` itself to throw directly — proving the OUTER catch,
// not any one handler's inner one.
//
// Mock policy (integration): a REAL `createServer()` over real HTTP; only `call-tool.ts`'s
// `callTool` export is replaced (the one function this dispatch catch sits directly around).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LEAKY_PATH = '/home/rwe/.local/share/rwe-data/assets/some-workflow-name';

vi.mock('../../src/call-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/call-tool.js')>();
  return {
    ...actual,
    callTool: vi.fn(async () => {
      throw Object.assign(new Error(`ENAMETOOLONG: name too long, unlink '${LEAKY_PATH}'`), { code: 'ENAMETOOLONG' });
    }),
  };
});

describe('server.ts tools/call dispatch — the OUTER catch around callTool() never echoes a raw path either (#166 decision 3)', () => {
  let server: import('../../src/server.js').Server;
  let tmpDir: string;

  beforeAll(async () => {
    const { createServer } = await import('../../src/server.js');
    tmpDir = mkdtempSync(join(tmpdir(), 'rwe-166-dispatch-leak-'));
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  });
  afterAll(async () => {
    await server?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('a throw escaping callTool() entirely still answers a JSON-RPC error with no absolute host path in its message', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workflow_deregister', arguments: { name: 'whatever' } } }),
    });
    const body = (await res.json()) as { error?: { code?: number; message?: string } };
    expect(body.error).toBeDefined();
    expect(body.error?.message ?? '').not.toContain('/home/');
    expect(body.error?.message ?? '').not.toContain(LEAKY_PATH);
  });
});
