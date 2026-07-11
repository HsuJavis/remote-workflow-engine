// VAL-020: MCP tools provisioned server-side (registry), referenced by name, explicitly injected (REQ-017)
// Real entrypoint: the real mcp_provision admin tool + real McpRegistry + real workflow_run.
// No mock of the SUT's own boundaries (registry, resolveInjected).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { FakeMcpProbe } from '../../src/mcp-probe.js';
// Value import — module-not-found when absent, so this file is RED at collection regardless of
// any live-provider availability (mcp_provision/resolveInjected never need a real model call).
import { McpRegistry } from '../../src/mcp-registry.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val020-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, mcpProbe: new FakeMcpProbe(true) });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function mcpCall(name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> }; error?: { code: number; message: string } };
  if (body.error) return { error: body.error };
  // workflow_* tools return their own flat envelope directly; mcp_provision wraps its payload
  // under `.result` (server.ts's `{ result: ... }` shape) — callers check `.error` at THIS level
  // regardless (a thrown provision error also surfaces as `{error:...}` at this same level).
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('VAL-020: REQ-017 — provisioned once, later run references it by name', () => {
  it('an admin provisions an MCP server config once; provisioning succeeds', async () => {
    const out = await mcpCall('mcp_provision', { name: 'val020-search', kind: 'stdio', config: { command: 'npx', args: ['-y', 'search-mcp'] } });
    expect((out as { error?: unknown }).error).toBeUndefined();
  });

  it('a workflow referencing an unprovisioned MCP name gets a clear MCP_NOT_PROVISIONED error (never a silent no-op) — no live model needed, fails before any provider dial', async () => {
    const run = await mcpCall('workflow_run', { script: `return agent('use it', { mcp: ['val020-never-provisioned'] });` });
    const runId = run['runId'] as string;
    let finalStatus: Record<string, unknown> | undefined;
    for (let i = 0; i < 20; i++) {
      const s = await mcpCall('workflow_status', { runId });
      if (s['status'] === 'completed' || s['status'] === 'failed') { finalStatus = s; break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    const result = await mcpCall('workflow_result', { runId });
    // Rejection is allowed at submission time (workflow_run itself) OR as a later run-level error
    // (DES-024's explicitly-permitted boundary; mirrors sibling IT-038's own correct assertion) — so
    // include `run` in the matched surface, not just the post-run polls.
    expect(JSON.stringify({ run, finalStatus, result })).toMatch(/MCP_NOT_PROVISIONED/);
  }, 30000);
});

describe('VAL-020: REQ-017 — strict-by-name injection, both stdio and http kinds usable', () => {
  it('resolveInjected returns ONLY the referenced names — host ambient MCP never inherited (VAL-003 isolation invariant continues to hold)', async () => {
    const dbPath = join(tmpDir, 'val020-registry.db');
    const reg = new McpRegistry({ dbPath, probe: new FakeMcpProbe(true) });
    await reg.register({ name: 'val020-a', kind: 'stdio', config: { command: 'npx' } });
    await reg.register({ name: 'val020-b', kind: 'http', config: { url: 'https://example.com/mcp' } });
    const resolved = reg.resolveInjected(['val020-a']);
    expect(resolved).toEqual({ configs: { 'val020-a': { command: 'npx' } } });
  });

  it('both stdio and remote-http provisioned kinds are usable', async () => {
    const outStdio = await mcpCall('mcp_provision', { name: 'val020-stdio', kind: 'stdio', config: { command: 'npx', args: ['pkg'] } });
    const outHttp = await mcpCall('mcp_provision', { name: 'val020-http', kind: 'http', config: { url: 'https://example.com/mcp' } });
    expect((outStdio as { error?: unknown }).error).toBeUndefined();
    expect((outHttp as { error?: unknown }).error).toBeUndefined();
  });
});
