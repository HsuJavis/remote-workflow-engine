// VAL-237 (REQ-210): a cold MCP client's `initialize` states the double-JSON envelope and a guide
// size the client can compare against the bytes it then actually receives from
// `workflow_authoring_guide`. Written test-first (Gate 5, RED) — `initialize`'s result carries no
// `instructions` field today.
//
// The byte-figure/attempts wiring matrix is IT-tier (`initialize-instructions.test.ts`, DES-239's
// own `tests:` bullet); this file is the single real cold-client action REQ-210 names.
//
// Mock policy (acceptance): real createServer(), real MCP HTTP.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => { server = await createServer({ port: 0, bind: '127.0.0.1' }); baseUrl = `http://127.0.0.1:${server.port}`; });
afterAll(async () => { await server?.close(); });

describe('VAL-237 — a cold client\'s initialize discloses the envelope + a comparable guide size (REQ-210)', () => {
  it('initialize.instructions states the envelope and a byte figure equal to the guide result the client then actually receives', async () => {
    const initRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cold-client', version: '1' } } }),
    });
    const initBody = (await initRes.json()) as { result?: { instructions?: string } };
    const instructions = initBody.result?.instructions ?? '';
    expect(instructions).toMatch(/double|content\[0\]\.text/i);
    expect(instructions).toMatch(/JSON/i);

    const guideRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'workflow_authoring_guide', arguments: {} } }),
    });
    const guideBody = (await guideRes.json()) as { result: unknown };
    const actualBytes = Buffer.byteLength(JSON.stringify(guideBody.result));
    expect(instructions, `instructions should state the actual served size (${actualBytes} bytes)`).toContain(String(actualBytes));
  });
});
