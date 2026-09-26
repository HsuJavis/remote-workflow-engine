// v9 — workflow discovery over the real server (REQ-061/062): register a workflow with a meta
// description, then query its purpose (workflow_list description + workflow_source) and its static DAG
// skeleton (workflow_source.skeleton + /api/workflows/:name/skeleton).
//
// v24 (batch B migration) — TWO changes, both fixture/spelling, oracle unchanged:
//  (a) SCRIPT: `agent('draft 1', {})` labels are not v24 labels (`AGENT_LABEL_FORMAT`: a label must
//      match /^[A-Za-z_][\w-]*$/) and every label now needs a `meta.params.agents.<label>`
//      declaration + a matching stadium node in an author-supplied `mermaid` (REQ-111). The script
//      already declares its own `meta`, so `synthesizeMeta` returns it untouched — the contract and
//      the diagram are written out by hand here.
//  (b) REQ-061's "purpose" oracle MOVED, it did not disappear: v24 `workflow_list` rows are
//      `{name, owner, versions, channels, runnable}` (DES-156) — no `kind`, no `description` — and
//      the human-readable purpose is served by `workflow_describe` (REQ-101), which every principal
//      may call. The case therefore asks describe for the purpose and keeps `workflow_list` pinned
//      on what it does carry (the row exists and reports `runnable`).
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

const AGENT_SPEC = (effort: string, timeoutMs: number) =>
  `{ model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: '${effort}' }, timeoutMs: { type: 'number', default: ${timeoutMs} } }`;

const SCRIPT = `export const meta = {
  name: 'cs',
  description: 'two models draft in parallel, a stronger model verifies',
  phases: [{ title: 'Draft' }, { title: 'Verify' }],
  params: { agents: {
    draft_1: ${AGENT_SPEC('low', 60000)},
    draft_2: ${AGENT_SPEC('low', 60000)},
    verify: ${AGENT_SPEC('medium', 90000)},
  } },
};
phase('Draft');
const drafts = await parallel([ () => agent('draft_1', { prompt: 'draft one' }), () => agent('draft_2', { prompt: 'draft two' }) ]);
phase('Verify');
const final = await agent('verify', { prompt: 'verify: ' + drafts.join(', ') });
const extra = await workflow('log-it', {});
return final;`;

// The nested `workflow('log-it')` call is drawn as the black-box rectangle the guide prescribes;
// only stadium nodes are matched against the script's agent labels (both directions).
// v26 (REQ-128): the LR swimlane — the meta's own two phases are now real `phase()` calls, so the
// diagram carries one subgraph per lane. The nested `workflow('log-it')` stays the black-box
// rectangle the guide prescribes and is transparent to the derivation (rule S4).
const MERMAID = `graph LR
subgraph "Draft"
draft_1(["draft_1"])
draft_2(["draft_2"])
end
subgraph "Verify"
verify(["verify"])
end
logit["workflow: log-it (black box)"]
draft_1-->verify
draft_2-->verify`;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-disc-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  await registerPublishedVia(call, 'cs', SCRIPT, { mermaid: MERMAID });
});
afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('workflow discovery (v9, REQ-061/062)', () => {
  it('REQ-061 the workflow purpose is discoverable — workflow_describe carries it, workflow_list lists the workflow', async () => {
    const list = await call('workflow_list', {});
    const cs = (list.result as any[]).find((e) => e.name === 'cs');
    expect(cs).toBeDefined();
    expect(cs.runnable).toBe(true);
    // v24: the purpose text moved from the list row onto workflow_describe (REQ-101).
    const described = await call('workflow_describe', { name: 'cs' });
    expect(described.result.description).toBe('two models draft in parallel, a stronger model verifies');
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
