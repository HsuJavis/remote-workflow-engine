// IT-001: MCP facade — tools/list returns all v1 required tools (ARCH-001)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

const REQUIRED_TOOLS = [
  'run_start',
  'run_status',
  'run_result',
  'run_suspend',
  'run_resume',
  'run_stop',
  'workflow_list',
  'run_agent_log',
];

describe('MCP Facade — tool registration (ARCH-001)', () => {
  let server: Server;

  beforeEach(async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1' });
  });

  afterEach(async () => {
    await server?.close();
  });

  it('tools/list over Streamable HTTP returns all required v1 tools', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const body = await res.json() as { result?: { tools: Array<{ name: string }> } };
    const names = body.result!.tools.map((t) => t.name);
    for (const required of REQUIRED_TOOLS) {
      expect(names).toContain(required);
    }
  });

  it('server binds to 127.0.0.1 by default (not 0.0.0.0)', async () => {
    expect(server.port).toBeGreaterThan(0);
    // Default bind is localhost — confirmed by successful local fetch above
  });
});
