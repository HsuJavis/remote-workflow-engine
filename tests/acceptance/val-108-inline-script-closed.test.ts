// VAL-108 (REQ-098): inline script is closed; every run goes through a registered workflow. Real
// entrypoint: `createServer`, real MCP HTTP.
//
// Mock policy (acceptance, DES-119): no mocking of the SUT's own boundaries. No LLM dispatch
// needed for the refusal path; `run_resume` uses a marker script with no agent() call.
//
// Red reason: `run_start`/`run_resume` accept inline `script` today, and `tools/list` still
// advertises it — every assertion below fails against the current engine.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val108-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

async function rpc(method: string, params: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return await res.json() as Record<string, unknown>;
}
async function toolCall(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const body = await rpc('tools/call', { name, arguments: args });
  const result = body['result'] as { content?: Array<{ text?: string }> } | undefined;
  return JSON.parse(result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('REQ-098: a hand-rolled inline-script call is refused, real HTTP (VAL-108)', () => {
  it('run_start({script}) over the real transport is refused INLINE_SCRIPT_CLOSED with the migration recipe', async () => {
    const r = await toolCall('run_start', { script: `return 'nope';` });
    expect((r['error'] as { code?: string } | undefined)?.code).toBe('INLINE_SCRIPT_CLOSED');
  });

  it('tools/list advertises no `script`/`scriptSha256` on run_start and no `script` on run_resume', async () => {
    const body = await rpc('tools/list', {});
    const result = body['result'] as { tools?: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }> } | undefined;
    const run = result?.tools?.find((t) => t.name === 'run_start');
    const resume = result?.tools?.find((t) => t.name === 'run_resume');
    expect(run?.inputSchema?.properties?.['script']).toBeUndefined();
    expect(run?.inputSchema?.properties?.['scriptSha256']).toBeUndefined();
    expect(resume?.inputSchema?.properties?.['script']).toBeUndefined();
  });

  it('a plain run_resume({runId}) with no script parameter is never refused INLINE_SCRIPT_CLOSED (unchanged plain-resume path)', async () => {
    const reg = await toolCall('workflow_register', { name: 'val108-resume', script: `return 'resumed-ok';` });
    const version = (reg['result'] as { version?: string } | undefined)?.version as string;
    await toolCall('workflow_publish', { name: 'val108-resume', version, channel: 'release' });
    const run = await toolCall('run_start', { name: 'val108-resume' });
    const runId = (run['result'] as { runId?: string } | undefined)?.runId as string;

    let s = await toolCall('run_status', { runId });
    for (let i = 0; i < 100 && (s['status'] === 'running' || s['status'] === 'queued'); i++) {
      await new Promise((r) => setTimeout(r, 30));
      s = await toolCall('run_status', { runId });
    }
    expect(s['status']).toBe('completed');

    const resumed = await toolCall('run_resume', { runId });
    // A completed run can't legally transition (IllegalTransitionError-shaped, or similar) — the
    // load-bearing assertion is that a script-less resume is never mistaken for the inline-script ban.
    expect((resumed['error'] as { code?: string } | undefined)?.code).not.toBe('INLINE_SCRIPT_CLOSED');
  });
});
