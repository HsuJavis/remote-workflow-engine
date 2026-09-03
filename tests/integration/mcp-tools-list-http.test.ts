// IT-106 (DES-140, v24; rewrite target of mcp-tools-list-schema.test.ts per DES-159[T3]):
// tools/list over REAL MCP HTTP byte-equals projectToolsList() and contains no old tool name;
// workflow_run resolves to the unknown-tool error. Written test-first (Gate 5, RED): today's
// server still serves the pre-v24 tool set (workflow_run, workflow_get, blob_put, …), so both
// assertions below are genuinely red against the REAL booted engine, not a missing-module red.
// Mock policy: real HTTP MCP server, real tools/list round trip — no mock of the SUT boundary.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
// @ts-expect-error — src/tool-specs.ts does not exist yet (v24 DES-138)
import { projectToolsList } from '../../src/tool-specs.js';

describe('tools/list over real MCP HTTP — the v24 surface (IT-106, DES-140)', () => {
  let server: Server;

  beforeEach(async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1' });
  });

  afterEach(async () => {
    await server?.close();
  });

  async function fetchTools() {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const body = (await res.json()) as { result?: { tools: Array<{ name: string }> } };
    return body.result!.tools;
  }

  it('tools/list byte-equals projectToolsList() and carries no old tool name', async () => {
    const served = await fetchTools();
    expect(served).toEqual(projectToolsList());
    const names = served.map((t: { name: string }) => t.name);
    expect(names).not.toContain('workflow_run');
    expect(names).not.toContain('blob_put');
  });

  it('calling the retired workflow_run resolves to an unknown-tool JSON-RPC error', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'workflow_run', arguments: {} } }),
    });
    const body = (await res.json()) as { error?: { code: number } };
    expect(body.error?.code).toBe(-32601);
  });
});
