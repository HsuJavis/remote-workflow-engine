// IT-126 (v24 Gate 7.5 defect D-8, REQ-111 / DES-156): the author-supplied diagram survives the
// WHOLE round trip — `workflow_register` → SQLite → `workflow_describe` (MCP) and
// `GET /api/workflows/:name/describe` (the dashboard's own read).
//
// The defect this pins: the version reader selected `script, defaults, params, triggers` and never
// `mermaid`, and the facade never forwarded it into the owner view — so the column was written on
// every registration and read by nothing. `workflow_describe(...).mermaid` was `null` +
// `mermaidNote:'LEGACY_NO_DIAGRAM'` for every v24 workflow and no dashboard showed a diagram,
// while `SELECT mermaid FROM workflow_versions` returned the text (08-validation.md D-8).
//
// UT-157 was green throughout, because it tests the pure projection against a HAND-BUILT row: the
// oracle problem — a test that verifies data it made up rather than what the system stored. Hence
// this file: nothing here constructs a row, and the expected value is the exact string handed to
// `workflow_register`.
//
// Mock policy: integration tier — real `createServer()`, real HTTP `/mcp` + `/api`, real SQLite
// catalog. No LLM is involved (the diagram is the AUTHOR's, ADR-025) and the script is pure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;
const base = () => `http://127.0.0.1:${server.port}`;
const WF = 'it126-diagram';

// A real diagram, not the minimal one the fixture helper synthesizes: a trigger trapezoid, the two
// stadium agent nodes the script dispatches, and a labelled edge — the shape an author actually
// draws, so a projection that dropped part of the text would be visible too.
// v26 (REQ-128): one subgraph lane per `phase()`. The dispatch sits behind `if (false)` (this file
// only round-trips the DIAGRAM, it never runs the workflow), so the lane is dynamic and its two
// nodes carry no predicted slot — they are still declared inside the lane, as an author would.
const MERMAID = [
  'graph LR',
  'trig[/"cron"/]',
  'subgraph "Plan"',
  'planner(["planner"])',
  'writer(["writer"])',
  'end',
  'trig-->planner',
  'planner-->|plan|writer',
].join('\n');

const SCRIPT = [
  "export const meta = { description: 'diagram round trip', params: { agents: {",
  "  planner: { model: { type: 'string', default: 'sonnet' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },",
  "  writer: { model: { type: 'string', default: 'sonnet' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },",
  '} } };',
  "phase('Plan');",
  "if (false) { await agent('planner', {}); await agent('writer', {}); }",
  "return 'ok';",
].join('\n');

async function call(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${base()}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } };
  if (body.error) throw new Error(`rpc error: ${body.error.message}`);
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it126-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  const reg = await call('workflow_register', { name: WF, script: SCRIPT, mermaid: MERMAID });
  expect(reg.error).toBeUndefined();
  const pub = await call('workflow_publish', { name: WF, version: `v${reg.version as number}`, channel: 'release' });
  expect(pub.error).toBeUndefined();
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

describe('the registered diagram is served back verbatim (IT-126, D-8, REQ-111)', () => {
  it('workflow_describe returns the EXACT string registered, with no LEGACY_NO_DIAGRAM note', async () => {
    const res = await call('workflow_describe', { name: WF });
    expect(res.error).toBeUndefined();
    expect(res.result.mermaid).toBe(MERMAID);
    expect(res.result.mermaidNote).toBeNull();
  });

  it('the dashboard read (GET /api/workflows/:name/describe) carries the same diagram', async () => {
    const res = await fetch(`${base()}/api/workflows/${WF}/describe`);
    expect(res.status).toBe(200);
    const body = await res.json() as { mermaid?: string | null };
    expect(body.mermaid).toBe(MERMAID);
  });

  it('an explicitly-selected version serves ITS diagram, not the release pointer\'s', async () => {
    // v26 (REQ-128): a DIFFERENT valid v2 diagram for the same script — the lane is required, the
    // trapezoid trigger node is not, which is exactly the "per-version, verbatim" difference this
    // case is about.
    const v2Mermaid = ['graph LR', 'subgraph "Plan"', 'planner(["planner"])', 'writer(["writer"])', 'end', 'planner-->writer'].join('\n');
    const reg2 = await call('workflow_register', { name: WF, script: SCRIPT, mermaid: v2Mermaid });
    expect(reg2.error).toBeUndefined();
    const v2 = await call('workflow_describe', { name: WF, version: `v${reg2.version as number}` });
    expect(v2.result.mermaid).toBe(v2Mermaid);
    // …and the release channel still answers with v1's diagram — the read is per-version.
    const rel = await call('workflow_describe', { name: WF });
    expect(rel.result.mermaid).toBe(MERMAID);
  });
});
