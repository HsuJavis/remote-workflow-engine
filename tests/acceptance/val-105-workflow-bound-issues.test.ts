// VAL-105 (REQ-095): problem reports are bound to a specific workflow and filterable by it.
//
// Mock policy (acceptance, DES-108): E2E/acceptance must not mock the SUT's own boundaries —
// GitHub uses a real repo with a real token (RWE_SECRET_GITHUB_TOKEN), never a double. The
// network-bound assertions are gated behind that env var (HAS_TOKEN); one ungated assertion (the
// self-describing tool schema) requires no network at all.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

const HAS_TOKEN = !!process.env['RWE_SECRET_GITHUB_TOKEN'];

let server: Server;

beforeAll(async () => { server = await createServer({ port: 0, bind: '127.0.0.1' }); });
afterAll(async () => { await server?.close(); });

async function rpc(method: string, params: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return res.json();
}
async function toolCall(name: string, args: Record<string, unknown>): Promise<any> {
  const body = await rpc('tools/call', { name, arguments: args });
  if (body.error) return { error: body.error };
  return JSON.parse(body.result.content[0].text);
}

describe('REQ-095: problem reports bound to a workflow, filterable by it (VAL-105)', () => {
  // UNGATED — a schema-only consumer must be able to discover the `workflow` parameter without a
  // live GitHub call at all.
  it('issue_report tool schema declares a `workflow` parameter (self-describing, ARCH-051 discipline)', async () => {
    const body = await rpc('tools/list', {});
    const tool = (body.result.tools as Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>).find((t) => t.name === 'issue_report');
    expect(tool?.inputSchema?.properties?.['workflow']).toBeDefined();
  });

  it('issue_report({workflow}) creates an issue labelled workflow:<name> with name@version + runId in the body [requires RWE_SECRET_GITHUB_TOKEN]', async () => {
    if (!HAS_TOKEN) return;
    const res = await toolCall('issue_report', {
      title: `v21 VAL-105 probe ${Date.now()}`, reproSteps: 'n/a (automated acceptance probe)',
      analysis: 'n/a', workflow: 'val105-probe-workflow', version: 'v1', runId: 'val105-run',
    });
    expect(res.error).toBeUndefined();
    expect(typeof res.result?.issueNumber).toBe('number');

    const listed = await toolCall('issue_list', { workflow: 'val105-probe-workflow' });
    expect(listed.error).toBeUndefined();
    expect((listed.result ?? []).some((i: { number: number }) => i.number === res.result.issueNumber)).toBe(true);
  }, 30_000);

  it('issue_report WITHOUT workflow behaves exactly as today (unlabelled) [requires RWE_SECRET_GITHUB_TOKEN]', async () => {
    if (!HAS_TOKEN) return;
    const res = await toolCall('issue_report', { title: `v21 VAL-105 unlabelled ${Date.now()}`, reproSteps: 'n/a', analysis: 'n/a' });
    expect(res.error).toBeUndefined();
    expect(typeof res.result?.issueNumber).toBe('number');
  }, 30_000);
});
