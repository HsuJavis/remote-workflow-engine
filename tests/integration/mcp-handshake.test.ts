// IT: MCP lifecycle handshake over Streamable HTTP (REQ-005, ARCH-001).
// Real-use gap: a spec-compliant MCP client (Claude Code) MUST call `initialize` before any
// tools call; the server only implemented tools/list + tools/call, so `initialize` returned
// -32601 "Method not found" and real clients failed to connect (raw stateless tools/list masked
// it during earlier validation). These tests pin the handshake so a compliant client can connect.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

async function post(port: number, payload: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(payload),
  });
}

describe('MCP lifecycle handshake (REQ-005, ARCH-001)', () => {
  let server: Server;
  beforeEach(async () => { server = await createServer({ port: 0, bind: '127.0.0.1' }); });
  afterEach(async () => { await server?.close(); });

  it('initialize returns a valid MCP init result (not -32601 Method not found)', async () => {
    const res = await post(server.port, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    });
    const body = await res.json() as { result?: { protocolVersion?: string; capabilities?: unknown; serverInfo?: { name?: string } }; error?: { code: number } };
    expect(body.error).toBeUndefined();
    expect(body.result).toBeDefined();
    expect(body.result!.protocolVersion).toBe('2025-06-18');
    expect(body.result!.capabilities).toBeDefined();
    expect(body.result!.serverInfo?.name).toBe('remote-workflow-engine');
  });

  it('notifications/initialized is accepted with no error body (202)', async () => {
    const res = await post(server.port, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    expect(res.status).toBe(202);
  });

  it('full handshake then tools/list succeeds (a compliant client can connect)', async () => {
    await post(server.port, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    await post(server.port, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    const res = await post(server.port, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const body = await res.json() as { result?: { tools: Array<{ name: string }> } };
    expect(body.result!.tools.map((t) => t.name)).toContain('workflow_run');
  });
});
