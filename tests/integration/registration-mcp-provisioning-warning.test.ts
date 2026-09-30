// issue #103(a): workflow_register declaring an unprovisioned mcp/skill name SUCCEEDS (the version
// registers, exactly as it always has) but now carries a non-fatal `result.warnings` entry naming
// the agent label + the missing name(s) — the same mechanism as the existing
// BASH_SUBSUMES_FILE_TOOLS warning, and the SAME resolver dispatch itself uses to materialize
// assets (AssetSyncService.resolveDeclaredAssets), so registration and admission can never disagree
// about what's provisioned.
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
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-reg-mcp-warn-'));
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

// `mcp`/`skills` are declared ONLY in `meta.params.agents.<label>` — that object literal is what
// `parseParamContract` actually reads (params/contract.ts); `skills` isn't even an accepted agent()
// CALL option (AGENT_OPT_KEYS, workflow-meta.ts — only `mcp` is, and writing it there would be a
// no-op for this test's purpose), so it must never be written at the call site.
function scriptDeclaring(mcp: string[], skills: string[]): string {
  return [
    "export const meta = { phases: [{ title: 'Work' }], params: { agents: { a: {",
    `  model: { type: 'string', default: ${JSON.stringify(DEFAULT_FIXTURE_MODEL)} },`,
    "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
    "  timeoutMs: { type: 'number', default: 60000 },",
    `  mcp: ${JSON.stringify(mcp)}, skills: ${JSON.stringify(skills)},`,
    "} } } };",
    "phase('Work');",
    "await agent('a', {});",
  ].join('\n');
}
const MERMAID = 'graph LR\nsubgraph "Work"\nn0(["a"])\nend';

describe('workflow_register: unprovisioned mcp/skill warns, never refuses (issue #103a)', () => {
  it('registers OK with a warning naming the label and the missing mcp name', async () => {
    const r = await call('workflow_register', { name: 'reg-mcp-warn', script: scriptDeclaring(['echo-mcp'], []), mermaid: MERMAID });
    expect(r['error']).toBeUndefined();
    const result = r['result'] as { warnings?: Array<{ code: string; label: string; names?: string[] }> };
    const w = (result.warnings ?? []).find((x) => x.code === 'MCP_NOT_PROVISIONED');
    expect(w, JSON.stringify(result.warnings)).toBeDefined();
    expect(w?.label).toBe('a');
    expect(w?.names).toEqual(['echo-mcp']);
  });

  it('registers OK with a warning naming the label and the missing skill name', async () => {
    const r = await call('workflow_register', { name: 'reg-skill-warn', script: scriptDeclaring([], ['reviewer']), mermaid: MERMAID });
    expect(r['error']).toBeUndefined();
    const result = r['result'] as { warnings?: Array<{ code: string; label: string; names?: string[] }> };
    const w = (result.warnings ?? []).find((x) => x.code === 'SKILL_NOT_PROVISIONED');
    expect(w, JSON.stringify(result.warnings)).toBeDefined();
    expect(w?.label).toBe('a');
    expect(w?.names).toEqual(['reviewer']);
  });

  it('a declared mcp name that IS provisioned (workspace_push first) carries no warning', async () => {
    // Issue #102 (asset squatting): `workspace_push` now requires the workflow scope to already be
    // registered (WORKFLOW_NOT_FOUND otherwise) — order is register first (unprovisioned, so this
    // warns, proving the warning path fires), THEN push the mcp, THEN register a new version, which
    // carries no warning because the name is now provisioned.
    const first = await call('workflow_register', { name: 'reg-mcp-ok', script: scriptDeclaring(['echo-mcp'], []), mermaid: MERMAID });
    expect(first['error']).toBeUndefined();
    const firstResult = first['result'] as { warnings?: Array<{ code: string }> };
    expect((firstResult.warnings ?? []).some((w) => w.code === 'MCP_NOT_PROVISIONED')).toBe(true);

    const pushed = await call('workspace_push', { scope: 'workflow', workflow: 'reg-mcp-ok', kind: 'mcp', name: 'echo-mcp', config: { type: 'http', url: 'https://example.com/mcp' } });
    expect(pushed['error']).toBeUndefined();

    const r = await call('workflow_register', { name: 'reg-mcp-ok', script: scriptDeclaring(['echo-mcp'], []), mermaid: MERMAID });
    expect(r['error']).toBeUndefined();
    const result = r['result'] as { warnings?: Array<{ code: string }> };
    expect((result.warnings ?? []).some((w) => w.code === 'MCP_NOT_PROVISIONED')).toBe(false);
  });

  it('a script declaring no mcp/skill names carries no provisioning warning at all', async () => {
    const r = await call('workflow_register', { name: 'reg-clean', script: scriptDeclaring([], []), mermaid: MERMAID });
    expect(r['error']).toBeUndefined();
    const result = r['result'] as { warnings?: Array<{ code: string }> };
    expect((result.warnings ?? []).some((w) => w.code === 'MCP_NOT_PROVISIONED' || w.code === 'SKILL_NOT_PROVISIONED')).toBe(false);
  });
});
