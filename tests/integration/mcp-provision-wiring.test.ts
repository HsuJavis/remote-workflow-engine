// IT-038: mcp_provision admin tool wired into the real server + real McpRegistry persistence
// across instances (DES-024, TASK-028/TASK-029, ARCH-015).
// RED: today's server.ts has no 'mcp_provision' tool at all (tools/list omits it, tools/call
// throws "Unknown tool"), and src/mcp-registry.js does not exist yet for the persistence half.
// No mock of the SUT boundary for the wiring half: real HTTP server, real fetch.
// Mock policy (integration tier): the one THIRD-PARTY network dependency (the live MCP probe) is
// faked via the same injected McpProbe seam ServerConfig.mcpProbe already provides for asset_push.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { FakeMcpProbe } from '../../src/mcp-probe.js';
// Value import — causes module-not-found at load time when the module is absent.
import { McpRegistry } from '../../src/mcp-registry.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it-mcpprov-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, mcpProbe: new FakeMcpProbe(true) });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function rpc(method: string, params?: unknown) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return res.json() as Promise<{ result?: { content?: Array<{ text?: string }>; tools?: Array<{ name: string }> }; error?: { code: number; message: string } }>;
}

async function callTool(name: string, args: unknown) {
  const body = await rpc('tools/call', { name, arguments: args });
  // A JSON-RPC-level error (e.g. "Unknown tool: mcp_provision" — today's real shape for a tool
  // that doesn't exist yet) never reaches `result.content` — surface it so `out.error` is truthy
  // instead of silently unwrapping to `{}` (a false-green risk on the "provisioning succeeds" case).
  if (body.error) return { error: { code: String(body.error.code), message: body.error.message } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

describe('mcp_provision wired into tools/list with a real JSON schema (REQ-017, D-G8-3 no placeholder regression)', () => {
  it('tools/list includes mcp_provision with a real (non-empty) inputSchema.properties', async () => {
    const body = await rpc('tools/list');
    const tool = body.result?.tools?.find((t) => t.name === 'mcp_provision') as
      { name: string; inputSchema?: { properties?: Record<string, unknown> } } | undefined;
    expect(tool).toBeDefined();
    expect(Object.keys(tool?.inputSchema?.properties ?? {}).length).toBeGreaterThan(0);
  });
});

describe('mcp_provision end to end (REQ-017): provision once, later run references it by name', () => {
  it('provisioning a live-probed MCP config succeeds', async () => {
    const out = await callTool('mcp_provision', { name: 'search', kind: 'stdio', config: { command: 'npx', args: ['-y', 'search-mcp'] } });
    expect(out.error).toBeUndefined();
  });

  it('a workflow referencing an UNPROVISIONED MCP name gets a clear MCP_NOT_PROVISIONED error, not a silent no-op', async () => {
    const run = await callTool('workflow_run', { script: `return agent('use tool', { mcp: ['never-provisioned'] });` }) as { runId?: string };
    const runId = run.runId ?? '';
    let finalStatus: unknown;
    for (let i = 0; i < 20; i++) {
      finalStatus = await callTool('workflow_status', { runId });
      const status = (finalStatus as { status?: string }).status;
      if (status === 'completed' || status === 'failed') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const result = await callTool('workflow_result', { runId });
    // Either rejected at submission (workflow_run itself) or surfaced as a run-level error later
    // (workflow_status/workflow_result) — never silently ignored.
    expect(JSON.stringify({ run, finalStatus, result })).toMatch(/MCP_NOT_PROVISIONED/);
  }, 30000);
});

describe('McpRegistry real on-disk persistence across instances (DES-024, mirrors IT-031/IT-012 pattern)', () => {
  it('a row registered by one instance is visible from a second instance on the same dbPath', async () => {
    const dbPath = join(tmpDir, 'mcp-registry-standalone.db');
    const reg1 = new McpRegistry({ dbPath, probe: new FakeMcpProbe(true) });
    await reg1.register({ name: 'persisted-mcp', kind: 'http', config: { url: 'https://example.com/mcp' } });

    const reg2 = new McpRegistry({ dbPath, probe: new FakeMcpProbe(true) });
    expect(reg2.get('persisted-mcp')?.kind).toBe('http');
  });
});
