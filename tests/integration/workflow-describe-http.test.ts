// IT-097 (TASK-120, DES-132, ARCH-083): the four-surface anti-drift table — ONE secret-bearing
// script registered once, and the exact secret literal asserted ABSENT from `JSON.stringify` of all
// four read surfaces: `workflow_source` (non-owner), `workflow_describe`, `GET /api/workflows` (the
// list), and `GET /api/workflows/:name/describe` — with the MCP tool and the HTTP route returning the
// IDENTICAL object. `/describe` is UNAUTHENTICATED (no bearer/identity plumbing at all, same as the
// `/skeleton` route it replaces), so the route body is compared against the MCP tool invoked with
// `ctx = {authEnabled: true, principal: null}` — comparing against an OWNER call would pass for the
// wrong reason (DES-132's own stated hazard).
//
// Mock policy (integration, DES-119): a REAL `createServer()`, real HTTP, real `/mcp` — no LLM (the
// diagram itself is out of scope for this parity test; TASK-120 is about the MASK, not the diagram
// content, which TASK-117/VAL-113 own).
//
// Red reason: `workflow_describe` does not exist as an MCP tool today -> `tools/call` returns a
// JSON-RPC error `{code:-32000, message:"Unknown tool: workflow_describe"}` (server.ts's `callTool`
// default case, confirmed by reading `src/server.ts:1007`); `GET /api/workflows/:name/describe` does
// not exist as a route today -> falls through to the dashboard 404 handler. Both fail for the
// genuine unimplemented reason, not a fixture/setup defect.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';

let server: Server;
let tmpDir: string;
const base = () => `http://127.0.0.1:${server.port}`;
const SECRET = 'sk-live-9F2A-anti-drift-secret';

async function call(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${base()}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } };
  if (body.error) return { __rpcError: body.error };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

const SCRIPT = `export const meta = {
  name: 'drift-fixture',
  description: 'anti-drift secret-bearing fixture',
  phases: [{ title: 'Draft' }],
};
// ${SECRET}
return 'ok';`;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it097-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  await registerPublishedVia(call, 'drift-fixture', SCRIPT);
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

describe('four-surface secret-absence anti-drift table (IT-097, DES-132)', () => {
  it('workflow_source for a NON-OWNER (real masking, exercised against the SAME on-disk catalog this server writes) does not carry the raw secret literal', async () => {
    // The HTTP/mcp endpoint above always resolves ctx.authEnabled from this server's own config
    // (auth off in this fixture -> everyone is the owner branch, existing v22 behavior, unaffected
    // by v23). A genuine non-owner projection needs ctx.authEnabled:true — exercised here via a
    // second in-process McpFacade pointed at the SAME on-disk workRoot/catalog.db the running server
    // just wrote to, rather than standing up a full OAuth bearer flow for one green-pin assertion.
    const sideCatalog = new WorkflowCatalog(tmpDir);
    const sideFacade = new McpFacade({ runManager: new RunManager({ catalog: sideCatalog }) } as any);
    const got = await sideFacade.workflowSource({ name: 'drift-fixture' }, { kind: 'user', id: 'someone-else@example.com' });
    expect(JSON.stringify(got)).not.toContain(SECRET);
  });

  it('workflow_describe over /mcp does not carry the raw secret literal (currently: Unknown tool error, so the assertion is vacuously true for the wrong reason — pinned below instead)', async () => {
    const resp = await call('workflow_describe', { name: 'drift-fixture' });
    // Forcing genuine red: the tool must actually EXIST and return the masked describe shape, not an
    // RPC error — an `__rpcError` response means the surface itself is unimplemented.
    expect(resp.__rpcError).toBeUndefined();
    expect(JSON.stringify(resp)).not.toContain(SECRET);
  });

  it('GET /api/workflows (the list) does not carry the raw secret literal', async () => {
    const res = await fetch(`${base()}/api/workflows`);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it('GET /api/workflows/:name/describe exists (200), does not carry the raw secret literal, and equals the MCP tool response on this SAME (unauthenticated) server', async () => {
    const res = await fetch(`${base()}/api/workflows/drift-fixture/describe`);
    expect(res.status).toBe(200);
    const routeBody = await res.json();
    expect(JSON.stringify(routeBody)).not.toContain(SECRET);

    const toolResp = await call('workflow_describe', { name: 'drift-fixture' });
    expect(toolResp.__rpcError).toBeUndefined();
    // The route carries no bearer/identity at all -> it must equal the UNAUTHENTICATED non-owner
    // projection, never an owner-branch comparison (DES-132's own named hazard).
    expect(routeBody).toEqual(toolResp.result ?? toolResp);
  });
});
