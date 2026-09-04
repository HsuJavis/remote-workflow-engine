// E2E-009 (DES-151, v24, Gate 7.5 scenario S-4): an admin reads another principal's run
// workspace over real MCP HTTP; the read is AUDITED (owner sees adminReads[] on run_status; a
// non-owner sees the key ABSENT). Written test-first (Gate 5, RED) against a REAL booted engine
// with `principals` configured — `run_start`/`workspace_pull`/`run_status` do not exist as v24
// tools yet (only the pre-v24 tool set is served today), so the whole journey is red at the
// unknown-tool boundary.
// Mock policy: real HTTP MCP server, real `principals` config, no mock of the SUT boundary.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

describe('admin cross-read is audited (E2E-009, DES-151, S-4)', () => {
  let server: Server;

  beforeAll(async () => {
    server = await createServer({
      port: 0, bind: '127.0.0.1',
      principals: { 'bob@x.com': { role: 'user' }, 'admin@x.com': { role: 'admin' } },
    });
  });

  afterAll(async () => {
    await server?.close();
  });

  async function call(name: string, args: Record<string, unknown>, principal: string): Promise<{ result?: any; error?: any }> {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${principal}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    return res.json() as Promise<{ result?: any; error?: any }>;
  }

  it('admin workspace_pull on bob\'s run succeeds, and bob\'s own run_status shows adminReads[]', async () => {
    const started = await call('run_start', { name: 'v24-cross-read-fixture' }, 'bob@x.com');
    const runId = started.result?.runId;
    expect(runId).toBeDefined();

    await call('workspace_pull', { runId, path: 'a.txt' }, 'admin@x.com');
    const status = await call('run_status', { runId }, 'bob@x.com');
    expect(status.result?.adminReads?.length).toBeGreaterThan(0);
  });

  it('a NON-owner, non-admin principal never sees adminReads at all (key absent, not [])', async () => {
    const started = await call('run_start', { name: 'v24-cross-read-fixture-2' }, 'bob@x.com');
    const runId = started.result?.runId;
    const status = await call('run_status', { runId }, 'bob@x.com');
    expect(status.result ?? {}).not.toHaveProperty('adminReads');
  });
});
