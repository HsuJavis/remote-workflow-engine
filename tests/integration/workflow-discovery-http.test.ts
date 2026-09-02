// v9 — workflow discovery over the real server (REQ-061/062): register a workflow with a meta
// description, then query its purpose (workflow_list description + workflow_get) and its static DAG
// skeleton (workflow_get.skeleton + /api/workflows/:name/skeleton).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

let server: Server;
let tmpDir: string;
const base = () => `http://127.0.0.1:${server.port}`;

async function call(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${base()}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

const SCRIPT = `export const meta = {
  name: 'cs',
  description: 'two models draft in parallel, a stronger model verifies',
  phases: [{ title: 'Draft' }, { title: 'Verify' }],
};
const drafts = await parallel([ () => agent('draft 1'), () => agent('draft 2') ]);
const final = await agent('verify');
const extra = await workflow('log-it', {});
return final;`;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-disc-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  await registerPublishedVia(call, 'cs', SCRIPT);
});
afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('workflow discovery (v9, REQ-061/062)', () => {
  it('REQ-061 workflow_list surfaces each workflow purpose (description)', async () => {
    const list = await call('workflow_list', {});
    const cs = (list.result as any[]).find((e) => e.kind === 'workflow' && e.name === 'cs');
    expect(cs.description).toBe('two models draft in parallel, a stronger model verifies');
  });

  it('REQ-061 workflow_get returns full detail; unknown → WORKFLOW_NOT_FOUND', async () => {
    const got = await call('workflow_get', { name: 'cs' });
    expect(got.result.description).toContain('two models draft');
    expect(got.result.phases.map((p: any) => p.title)).toEqual(['Draft', 'Verify']);
    expect(got.result.script).toContain('parallel');
    const missing = await call('workflow_get', { name: 'nope' });
    expect(missing.error.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('REQ-062 workflow_get.skeleton predicts the DAG (parallel group + workflow node)', async () => {
    const got = await call('workflow_get', { name: 'cs' });
    const skel = got.result.skeleton as Array<any>;
    const agents = skel.filter((n) => n.kind === 'agent');
    expect(agents.length).toBe(3);
    expect(new Set(agents.slice(0, 2).map((a) => a.parallel)).size).toBe(1); // two drafts share a group
    expect(skel.find((n) => n.kind === 'workflow').workflow).toBe('log-it');
  });

  it('REQ-062 GET /api/workflows/:name/skeleton serves the skeleton for the dashboard', async () => {
    const res = await fetch(`${base()}/api/workflows/cs/skeleton`);
    expect(res.status).toBe(200);
    const body = await res.json() as { skeleton?: unknown[]; description?: string };
    expect(Array.isArray(body.skeleton)).toBe(true);
    expect(body.description).toContain('two models draft');
    const missing = await fetch(`${base()}/api/workflows/none/skeleton`);
    expect(missing.status).toBe(404);
  });
});
