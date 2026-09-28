// issue #103(b): workspace_push kind:'mcp' MCP_PROBE_FAILED used to carry no detail at all —
// `{code: r.error, message: r.error}` (the bare code repeated as the message). Fixed to include
// the probe's own code/message/transport/timeoutMs in `error.detail` and a readable `error.message`
// — with the probe message's own URL query string (which may carry a token) stripped.
// Mock policy (integration): real HTTP MCP server + real AssetSyncService; only the network probe
// itself is faked (the SUT boundary this file exercises is the facade's error-shape wiring, not the
// real TCP/process probe — that's mcp-probe.ts's own real-tier coverage).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import type { McpProbe, McpProbeResult } from '../../src/mcp-probe.js';

let server: Server;
let tmpDir: string;

class RejectingProbe implements McpProbe {
  async probe(): Promise<McpProbeResult> {
    return {
      ok: false,
      code: 'UNREACHABLE',
      message: 'MCP HTTP endpoint unreachable: fetch failed for https://mcp.example.com/sse?token=SECRETVALUE',
    };
  }
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-mcp-probe-detail-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir, mcpProbe: new RejectingProbe(),
    mcpEgressAllowlist: ['https://mcp.example.com/'],
  });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown>): Promise<{ code?: string; body: any }> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const json = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  const text = json.result?.content?.[0]?.text;
  const body = text !== undefined ? JSON.parse(text) : json;
  return { code: body?.error?.code, body };
}

describe('workspace_push kind:"mcp" MCP_PROBE_FAILED detail (issue #103b)', () => {
  it('carries the probe\'s own code/transport/timeoutMs in error.detail, and a redacted message', async () => {
    const r = await call('workspace_push', {
      scope: 'global', kind: 'mcp', name: 'srv',
      config: { type: 'http', url: 'https://mcp.example.com/sse' },
    });
    expect(r.code).toBe('MCP_PROBE_FAILED');
    expect(r.body.error.detail).toMatchObject({ code: 'UNREACHABLE', transport: 'remote-http', timeoutMs: 5000 });
    // the query string (potential token) is stripped from both detail.message and the top message
    expect(r.body.error.detail.message).not.toContain('SECRETVALUE');
    expect(r.body.error.message).not.toContain('SECRETVALUE');
    expect(r.body.error.message).toContain('transport');
  });
});
