// IT-151 (DES-184, ARCH-119, ADR-043, TASK-189, v26): `workflow_versions.diagram_contract` — a v26
// registration writes `'v2'` and `workflow_describe` reports it; a pre-v26 (`NULL` -> `'v1'`) row is
// never re-checked and renders as before. Written test-first (Gate 5, RED): `workflow_describe`
// carries no `diagramContract` field at all today.
// Mock policy (integration, real adjacent components): real createServer(), real MCP HTTP, real
// SQLite catalog.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia, uniqueWorkflowName, synthesizeMeta } from '../helpers/workflow-fixtures.js';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let server: Server;
let tmpDir: string;

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it151-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

describe('workflow_describe reports diagramContract (IT-151, DES-184)', () => {
  it('a freshly-registered workflow reports diagramContract on workflow_describe', async () => {
    const name = uniqueWorkflowName('it151');
    await registerPublishedVia(mcpCall, name, `agent('a', { prompt: 'p' });`);
    const described = await mcpCall('workflow_describe', { name });
    expect('diagramContract' in (described.result ?? described)).toBe(true);
  });

  // v26 integration (REQ-128, DES-184): the stamp is now a VERIFIED FACT — `validateRegistration`
  // derives the script's ExpectedGraph and hands it to `checkMermaid`. Before the wiring every new
  // row was stamped 'v2' with nothing checked, so this pair is what tells the two apart.
  it("a v26 registration is stamped 'v2' AND was actually checked — a TD diagram is refused", async () => {
    const name = uniqueWorkflowName('it151-v2');
    await registerPublishedVia(mcpCall, name, `phase('one');\nawait agent('a', { prompt: 'p' });`);
    const described = await mcpCall('workflow_describe', { name });
    expect((described.result ?? described).diagramContract).toBe('v2');

    const refused = await mcpCall('workflow_register', {
      name: uniqueWorkflowName('it151-td'),
      script: synthesizeMeta(`phase('one');\nawait agent('a', { prompt: 'p' });`),
      mermaid: 'graph TD\na(["a"])',
    });
    expect(refused.error?.code ?? refused.code).toBe('DIAGRAM_DIRECTION');
  });

  it('an agent() before the first phase() is refused by its OWN code, not a bare SCAN_VIOLATION', async () => {
    // REQ-117's first-try bar: an author told only "scan violation" cannot find the missing phase().
    const refused = await mcpCall('workflow_register', {
      name: uniqueWorkflowName('it151-nophase'),
      script: synthesizeMeta(`await agent('a', { prompt: 'p' });`),
      mermaid: 'graph LR\nsubgraph "one"\na(["a"])\nend',
    });
    const err = refused.error ?? refused;
    expect(err.code).toBe('AGENT_BEFORE_PHASE');
    expect(err.see ?? err.detail?.see).toBe('workflow_authoring_guide');
    expect(err.detail?.line).toBeGreaterThan(0);
  });

  it('REQ-124: a GRANDFATHERED v1 run still renders its predicted cells — the layout falls back, it does not blank', async () => {
    // The v1-contract shape: a script with agent() calls and NO phase(). Registration refuses one
    // from v26 on, so this reaches the grandfathered state the way the other migration fixtures do
    // — by writing the row the pre-v26 engine would have written — and then asks the LIVE dag route
    // what it draws. `v1FallbackGraph` is the only thing standing between this and an empty graph.
    const name = uniqueWorkflowName('it151-v1run');
    const v1Script = "export const meta = { params: { agents: { a: { model: { type: 'string', default: 'default' },"
      + " effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },"
      + " timeoutMs: { type: 'number', default: 60000 } } } } };\n"
      + "await agent('a', { prompt: 'p' });\nawait agent('a', { prompt: 'q' });\nreturn 'ok';";
    // Register a v2-shaped sibling first so the name/version rows exist, then rewrite the stored
    // script + diagram to the v1 shape in place (a version row is immutable to the ENGINE; this is
    // the same direct-SQL technique tests/integration/catalog-versions.test.ts uses for migrations).
    await registerPublishedVia(mcpCall, name, `phase('one');\nawait agent('a', { prompt: 'p' });`);
    const db = new Database(join(tmpDir, 'catalog.db'));
    db.prepare('UPDATE workflow_versions SET script = ?, mermaid = ?, diagram_contract = NULL WHERE name = ?')
      .run(v1Script, 'graph TD;\na(["a"])', name);
    db.close();

    const started = await mcpCall('run_start', { name });
    const dag = await (await fetch(`http://127.0.0.1:${server.port}/api/runs/${started.runId}/dag`)).json() as
      { cells?: Array<{ id: string }>; warnings?: string[] };
    const ids = (dag.cells ?? []).map((c) => c.id);
    // Two predicted (inert) cells for the two agent() calls, plus the trigger — the pre-v26 render.
    expect(ids.filter((id) => id.startsWith('__skel_')).length).toBe(2);
    expect(ids).toContain('__trigger__');
    // REQ-124's own bar for existing production runs: no warnings at all.
    expect(dag.warnings ?? []).toEqual([]);
  }, 20000);
});
