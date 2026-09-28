// issue #103(a): a declared-but-unprovisioned mcp/skill name registers fine (warns — see
// registration-mcp-provisioning-warning.test.ts) but is REFUSED at admission, BEFORE any side
// effect: run_start, a schedule/webhook firing (both dispatch through RunManager.start(), the one
// admission door every fire path shares), and a nested workflow() call. Resolved against the SAME
// asset catalog dispatch itself materializes from (AssetSyncService.resolveDeclaredAssets).
// Mock policy (integration): real createServer, real MCP HTTP, real AssetSyncService/catalog.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { FakeMcpProbe } from '../../src/mcp-probe.js';
import { DEFAULT_FIXTURE_MODEL } from '../helpers/workflow-fixtures.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-run-start-provisioning-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    mcpEgressAllowlist: ['https://example.com/'], mcpProbe: new FakeMcpProbe(true),
  });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

// `mcp`/`skills` are declared ONLY in `meta.params.agents.<label>` — see
// registration-mcp-provisioning-warning.test.ts's own note for why they must never also be written
// as agent() call options.
function scriptDeclaring(mcp: string[], skills: string[]): string {
  return [
    "export const meta = { params: { agents: { a: {",
    `  model: { type: 'string', default: ${JSON.stringify(DEFAULT_FIXTURE_MODEL)} },`,
    "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
    "  timeoutMs: { type: 'number', default: 60000 },",
    `  mcp: ${JSON.stringify(mcp)}, skills: ${JSON.stringify(skills)},`,
    "} } } };",
    "phase('Work');",
    "await agent('a', {});",
    "return 'ok';",
  ].join('\n');
}
const MERMAID = 'graph LR\nsubgraph "Work"\nn0(["a"])\nend';

async function registerAndPublish(name: string, script: string): Promise<void> {
  const reg = await call('workflow_register', { name, script, mermaid: MERMAID });
  expect(reg['error'], JSON.stringify(reg)).toBeUndefined();
  const version = (reg['result'] as { version?: string }).version;
  const pub = await call('workflow_publish', { name, version, channel: 'release' });
  expect(pub['error'], JSON.stringify(pub)).toBeUndefined();
}

describe('run_start refuses an unprovisioned mcp/skill name before any side effect (issue #103a)', () => {
  it('run_start is refused MCP_NOT_PROVISIONED naming the label and missing name; no run is created', async () => {
    await registerAndPublish('run-mcp-refuse', scriptDeclaring(['echo-mcp'], []));
    const r = await call('run_start', { name: 'run-mcp-refuse' });
    expect((r['error'] as { code?: string } | undefined)?.code).toBe('MCP_NOT_PROVISIONED');
    expect((r['error'] as { message?: string } | undefined)?.message).toContain('a');
    expect((r['error'] as { message?: string } | undefined)?.message).toContain('echo-mcp');
    expect((await call('run_list', { workflow: 'run-mcp-refuse' }))['result']).toEqual([]);
  });

  it('run_start is refused SKILL_NOT_PROVISIONED naming the label and missing name; no run is created', async () => {
    await registerAndPublish('run-skill-refuse', scriptDeclaring([], ['reviewer']));
    const r = await call('run_start', { name: 'run-skill-refuse' });
    expect((r['error'] as { code?: string } | undefined)?.code).toBe('SKILL_NOT_PROVISIONED');
    expect((r['error'] as { message?: string } | undefined)?.message).toContain('reviewer');
    expect((await call('run_list', { workflow: 'run-skill-refuse' }))['result']).toEqual([]);
  });

  it('a provisioned mcp name (workspace_push first) admits the run — no refusal', async () => {
    await registerAndPublish('run-mcp-ok', scriptDeclaring(['echo-mcp'], []));
    const pushed = await call('workspace_push', { scope: 'workflow', workflow: 'run-mcp-ok', kind: 'mcp', name: 'echo-mcp', config: { type: 'http', url: 'https://example.com/mcp' } });
    expect(pushed['error']).toBeUndefined();
    const r = await call('run_start', { name: 'run-mcp-ok' });
    expect(r['error']).toBeUndefined();
    expect(typeof r['runId']).toBe('string');
    expect((r['runId'] as string).length).toBeGreaterThan(0);
  });

  it('a script declaring no mcp/skill names is unaffected (no provisioning check at all)', async () => {
    await registerAndPublish('run-clean', scriptDeclaring([], []));
    const r = await call('run_start', { name: 'run-clean' });
    expect(r['error']).toBeUndefined();
  });
});
