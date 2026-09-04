// v9 — workflow discovery over the real server (REQ-061/062): register a workflow with a meta
// description, then query its purpose (workflow_list description + workflow_source) and its static DAG
// skeleton (workflow_source.skeleton + /api/workflows/:name/skeleton).
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

  it('REQ-061 workflow_source returns full detail; unknown → WORKFLOW_NOT_FOUND', async () => {
    const got = await call('workflow_source', { name: 'cs' });
    expect(got.result.description).toContain('two models draft');
    expect(got.result.phases.map((p: any) => p.title)).toEqual(['Draft', 'Verify']);
    expect(got.result.script).toContain('parallel');
    const missing = await call('workflow_source', { name: 'nope' });
    expect(missing.error.code).toBe('WORKFLOW_NOT_FOUND');
  });

  // [RETIRED v23, adjudication #2 R-3(a)] Both REQ-062 skeleton cases that lived here —
  // `workflow_source.skeleton` predicting the DAG, and `GET /api/workflows/:name/skeleton` serving it —
  // asserted a user-facing surface REQ-105 deliberately deletes (01-requirements.md REQ-062's own
  // partial-supersession note). `parseWorkflowSkeleton` itself survives internally (run-DAG layout
  // spine + analyzer grounding); only these two client-facing vehicles are gone, so the cases are
  // retired, not converted to absence pins — UT-115's grep guard already covers absence repo-wide.
  // The route's new replacement (`GET /api/workflows/:name/describe`) is proven by IT-098 + VAL-113.
});
