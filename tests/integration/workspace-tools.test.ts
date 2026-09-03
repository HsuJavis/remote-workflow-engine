// IT-117 (DES-155, v24; rewrite target of workspace-artifacts.test.ts per DES-159[T3]): the six
// workspace_* tools — workspace_diff/push/pull/list/delete/purge — per-mode closed schemas,
// all-or-nothing delete, RUN_NOT_TERMINAL while live. Written test-first (Gate 5, RED): none of
// these six tool names exist yet (only the pre-v24 nine-tool surface does).
// Mock policy: real HTTP MCP server, real CAS/workspace FS — no mock of the SUT boundary.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

describe('the six workspace_* tools (IT-117, DES-155)', () => {
  let server: Server;

  beforeEach(async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1' });
  });

  afterEach(async () => {
    await server?.close();
  });

  async function call(name: string, args: Record<string, unknown>) {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    return res.json() as Promise<{ error?: { code: number }; result?: unknown }>;
  }

  const TOOLS = ['workspace_diff', 'workspace_push', 'workspace_pull', 'workspace_list', 'workspace_delete', 'workspace_purge'];

  it.each(TOOLS)('%s is an unknown tool today (v24 tool set not yet registered)', async (name) => {
    const body = await call(name, {});
    expect(body.error?.code).toBe(-32601);
  });

  it('workspace_push with a runId arg is refused INVALID_ARGUMENT from the closed schema (a run workspace is immutable while live) — not just unknown-tool', async () => {
    const body = await call('workspace_push', { runId: 'r1', sha256: 'a'.repeat(64), contentB64: 'eA==' });
    const resultErr = (body.result as { error?: { code?: string } } | undefined)?.error;
    expect(resultErr?.code).toBe('INVALID_ARGUMENT');
  });

  it('workspace_delete deleting during a live run is refused RUN_NOT_TERMINAL', async () => {
    const body = await call('workspace_delete', { runId: 'r1', paths: ['a.txt'] });
    expect(body.result ?? {}).toMatchObject({ error: { code: 'RUN_NOT_TERMINAL' } });
  });
});
