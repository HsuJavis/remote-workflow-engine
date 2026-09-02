// VAL-117 (REQ-106, DES-135, ARCH-086, ARCH-051): on a real `tools/list` over `/mcp`,
// `workflow_register`'s `script` description contains the four authoring rules and the
// `docs/AUTHORING.md` pointer — i.e. a cold schema-only client can read them without fetching
// anything else.
//
// Mock policy (acceptance, DES-119): real `createServer`, real `/mcp` `tools/list`. No LLM needed.
//
// Red reason: `workflow_register`'s advertised `script` parameter description does not mention
// `AUTHORING.md`, `meta.params`, "locked", or "phase title" today (confirmed by direct read of
// `src/server.ts`'s `SCRIPT_DSL_DOC`) -> every assertion below fails against the real advertised
// schema.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let workRoot: string;

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-val117-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot });
});
afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

describe('REQ-106: workflow_register.script description is a cold client\'s ONLY guidance source (VAL-117)', () => {
  it('the real tools/list advertises the four authoring rules + the AUTHORING.md pointer in workflow_register.script', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const body = await res.json() as { result?: { tools?: Array<{ name: string; inputSchema?: { properties?: Record<string, { description?: string }> } }> } };
    const registerTool = body.result?.tools?.find((t) => t.name === 'workflow_register');
    const scriptDesc = registerTool?.inputSchema?.properties?.['script']?.description ?? '';
    expect(scriptDesc).toMatch(/AUTHORING\.md/);
    expect(scriptDesc).toMatch(/meta\.params/);
    expect(scriptDesc.toLowerCase()).toContain('locked');
    expect(scriptDesc.toLowerCase()).toContain('phase title');
  });
});
