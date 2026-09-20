// VAL-233 (REQ-206): a real, cold MCP client registers a script declaring `meta.params.args.url.
// default`, then a BARE `run_start({name})` over real MCP HTTP — the script must read the default,
// `run_result` must return it, and it must survive round-trip. Written test-first (Gate 5, RED) —
// today the registration itself is refused PARAM_CONTRACT_INVALID ("never applied", the P6-3 ban).
// The suspend/resume/legacy-null/secret-arg edge matrix is IT-tier (`run-args-resume.test.ts`,
// DES-233's own `tests:` bullet); this file is the single real MCP HTTP action REQ-206 names.
//
// Mock policy (acceptance): real createServer(), real MCP HTTP.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia, type ToolCaller } from '../helpers/workflow-fixtures.js';

let server: Server;
let baseUrl: string;

function call(): ToolCaller {
  return async (name, args) => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0]!.text);
  };
}

beforeAll(async () => { server = await createServer({ port: 0, bind: '127.0.0.1' }); baseUrl = `http://127.0.0.1:${server.port}`; });
afterAll(async () => { await server?.close(); });

describe('VAL-233 — a declared args default reaches a bare run_start over real MCP HTTP (REQ-206)', () => {
  it('registers, bare-starts, and run_result returns the declared default', async () => {
    const c = call();
    const script =
      "export const meta = { params: { args: { url: { type: 'string', default: 'https://x' } } } };\n" +
      'return args;';
    await registerPublishedVia(c, 'val233-default', script);
    const started = (await c('run_start', { name: 'val233-default' })) as { runId: string };
    let status = 'queued';
    let result: { ok: boolean; value?: unknown } | undefined;
    for (let i = 0; i < 100 && status !== 'completed'; i++) {
      await new Promise((r) => setTimeout(r, 40));
      status = ((await c('run_status', { runId: started.runId })) as { status: string }).status;
    }
    result = (await c('run_result', { runId: started.runId })) as { ok: boolean; value?: unknown };
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ url: 'https://x' });
  });
});
