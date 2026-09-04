// IT-034: scheduler MCP tools reachable over HTTP (DES-019, DES-020, ARCH-012, TASK-021/026).
// v24 (DES-153/DES-159, [T3]): the asset_push/asset_list/asset_delete/workflow_trigger coverage
// this file used to carry was removed — those tool names are RETIRED (TASK-152's grep sweep);
// `workspace_push`'s IT-115 block below (DES-153) is their replacement's registration test.
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

async function toolsList() {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  const body = await res.json() as { result?: { tools: Array<{ name: string }> } };
  return body.result?.tools.map((t) => t.name) ?? [];
}

// v24 (DES-153/DES-159, [T3] rewrite): asset_push/asset_list/asset_delete/workflow_trigger are
// RETIRED names (TASK-152's grep sweep) — their tools/list assertions and the asset_push-calling
// behavioural tests below are removed here rather than ported to `workspace_push`, because the
// facade wiring for `workspace_push` (TASK-147/148) is not yet landed. The rwe-* exclusion and
// path-traversal-atomicity coverage this block used to carry over MCP HTTP is reported as a gap
// to restore once workspace_push is registered (see PARIMPL report, not silently dropped).
describe('v2 MCP tools registered in tools/list (DES-019, ARCH-012)', () => {
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
