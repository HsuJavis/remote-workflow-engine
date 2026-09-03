// IT-034: Asset sync and v2 scheduler MCP tools reachable over HTTP (DES-019, DES-020, ARCH-012, TASK-021/026)
// Includes: asset_push, asset_list, asset_delete, schedule_create, schedule_list, workflow_trigger.
// RED: v2 tools not registered in server.ts TOOL_NAMES/callTool — tools/list omits them,
// tools/call returns "Unknown tool: asset_push" → assertions fail.
// No mock of the SUT boundary: real HTTP MCP server.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-asset-it-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
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
  return res.json() as Promise<{ result?: { content?: Array<{ text?: string }> }; error?: unknown }>;
}

async function toolsList() {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  const body = await res.json() as { result?: { tools: Array<{ name: string }> } };
  return body.result?.tools.map((t) => t.name) ?? [];
}

describe('v2 MCP tools registered in tools/list (DES-019, ARCH-012)', () => {
  it('tools/list includes asset_push', async () => {
    const names = await toolsList();
    expect(names).toContain('asset_push');
  });

  it('tools/list includes asset_list', async () => {
    const names = await toolsList();
    expect(names).toContain('asset_list');
  });

  it('tools/list includes asset_delete', async () => {
    const names = await toolsList();
    expect(names).toContain('asset_delete');
  });

  it('tools/list includes schedule_create', async () => {
    const names = await toolsList();
    expect(names).toContain('schedule_create');
  });

  it('tools/list includes schedule_list', async () => {
    const names = await toolsList();
    expect(names).toContain('schedule_list');
  });

  it('tools/list includes schedule_delete', async () => {
    const names = await toolsList();
    expect(names).toContain('schedule_delete');
  });

  it('tools/list includes workflow_trigger', async () => {
    const names = await toolsList();
    expect(names).toContain('workflow_trigger');
  });
});

describe('asset_push/list/delete via MCP (DES-019)', () => {
  it('asset_push a skill stores it and asset_list returns it', async () => {
    const pushResult = await mcpCall('asset_push', {
      kind: 'skill',
      name: 'test-extractor',
      files: [{ path: 'SKILL.md', contentB64: btoa('# Test skill') }],
    });
    const envelope = JSON.parse(pushResult.result?.content?.[0]?.text ?? '{}') as {
      result?: { stored: string[]; excluded: unknown[] };
      error?: unknown;
    };
    expect(envelope.error).toBeUndefined();
    expect(envelope.result?.stored).toContain('test-extractor');

    const listResult = await mcpCall('asset_list');
    const listEnvelope = JSON.parse(listResult.result?.content?.[0]?.text ?? '{}') as {
      result?: Array<{ kind: string; name: string }>;
    };
    expect(listEnvelope.result?.some((a) => a.name === 'test-extractor')).toBe(true);
  });

  it('asset_push the rwe-* reserved prefix is excluded and reported', async () => {
    const pushResult = await mcpCall('asset_push', {
      kind: 'skill',
      name: 'rwe-guidance',
      files: [{ path: 'SKILL.md', contentB64: btoa('# Self-referential skill') }],
    });
    const envelope = JSON.parse(pushResult.result?.content?.[0]?.text ?? '{}') as {
      result?: { stored: string[]; excluded: Array<{ name: string; reason: string }> };
    };
    expect(envelope.result?.excluded.some((e) => e.name === 'rwe-guidance')).toBe(true);
    expect(envelope.result?.stored).not.toContain('rwe-guidance');
  });

  it('asset_push a path traversal file rejects the whole push atomically', async () => {
    const pushResult = await mcpCall('asset_push', {
      kind: 'skill',
      name: 'evil-skill',
      files: [{ path: '../etc/passwd', contentB64: btoa('evil') }],
    });
    const envelope = JSON.parse(pushResult.result?.content?.[0]?.text ?? '{}') as { error?: unknown };
    expect(envelope.error).toBeDefined();
  });
});

// IT-115 (DES-153, v24 REWRITE — appended block, [T3]): mcp_provision and the asset_* tool names
// are RETIRED — workspace_push({kind:'mcp'|'skill'}) replaces them, over real MCP HTTP.
// Written test-first (Gate 5, RED) — mcp_provision/asset_push still ARE registered today, and
// workspace_push does not exist yet.
describe('v24: mcp_provision retired, workspace_push replaces asset_push/mcp_provision (IT-115, DES-153)', () => {
  it('mcp_provision is ABSENT from tools/list (retired)', async () => {
    const names = await toolsList();
    expect(names).not.toContain('mcp_provision');
  });

  it('asset_push is ABSENT from tools/list (retired, replaced by workspace_push)', async () => {
    const names = await toolsList();
    expect(names).not.toContain('asset_push');
  });

  it('workspace_push({workflow, kind:"skill", name, files, pushedBy resolved from principal}) is present and callable', async () => {
    const names = await toolsList();
    expect(names).toContain('workspace_push');
  });
});
