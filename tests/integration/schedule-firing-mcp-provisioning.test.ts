// issue #103(a): a schedule firing dispatches through RunManager.start() — the SAME admission door
// run_start uses — so a claimed once-trigger whose workflow declares an unprovisioned mcp name is
// refused BEFORE any side effect (no run starts) exactly as run_start is. This file verifies that
// end of the claim (advisor-flagged: "covered for free" via start() needed an OBSERVED check, not
// just an architectural argument).
//
// Residual note this test also DOCUMENTS rather than fixes (see the PR/report): the ticker's
// generic `.catch()` classifies ANY start() throw the same way it always has —
// `scheduler.markFailed(firing, code)`, which for a `once` trigger sets `enabled = 0` (consumed).
// This is PRE-EXISTING behaviour for every start()-thrown code during a firing (a bad model ref
// behaves identically), not something this slice introduces — but it does mean a once-trigger
// refused MCP_NOT_PROVISIONED is spent: pushing the missing asset afterwards does not make it
// retry. Only `lastError`, never `lastRefusalReason` (that field is `markRefused`'s, for the four
// pre-dispatch policy reasons UNCLAIMED/CLAIMED_WORKFLOW_MISSING/CHANNEL_UNPUBLISHED/NOT_IN_RELEASE
// — MCP_NOT_PROVISIONED is a `start()` throw, not one of those).
// Mock policy (integration): real createServer, real MCP HTTP, real production ticker.
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
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-sched-mcp-provisioning-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    mcpEgressAllowlist: ['https://example.com/'], mcpProbe: new FakeMcpProbe(true),
  });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

async function call(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

// `mcp` declared ONLY in `meta.params.agents.<label>` — see registration-mcp-provisioning-warning
// .test.ts's own note for why it must never also be an agent() call option.
function scriptDeclaringMcp(mcp: string[]): string {
  return [
    "export const meta = { phases: [{ title: 'Work' }], params: { agents: { a: {",
    `  model: { type: 'string', default: ${JSON.stringify(DEFAULT_FIXTURE_MODEL)} },`,
    "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
    "  timeoutMs: { type: 'number', default: 60000 },",
    `  mcp: ${JSON.stringify(mcp)},`,
    "} } } };",
    "phase('Work');",
    "await agent('a', {});",
    "return 'ok';",
  ].join('\n');
}
const MERMAID = 'graph LR\nsubgraph "Work"\nn0(["a"])\nend';

describe('a claimed once-schedule firing refuses an unprovisioned mcp name (issue #103a)', () => {
  it('no run starts; the schedule row carries lastError.code MCP_NOT_PROVISIONED', async () => {
    const pastAt = new Date(Date.now() - 5000).toISOString();
    const created = await call('schedule_create', { kind: 'once', at: pastAt, enabled: false });
    expect(created['error']).toBeUndefined();
    const id = (created['result'] as Record<string, unknown>)['id'] as string;

    const reg = await call('workflow_register', { name: 'sched-mcp-refuse', script: scriptDeclaringMcp(['echo-mcp']), mermaid: MERMAID, triggers: [id] });
    expect(reg['error'], JSON.stringify(reg)).toBeUndefined();
    const version = (reg['result'] as { version?: string }).version;
    const pub = await call('workflow_publish', { name: 'sched-mcp-refuse', version, channel: 'release' });
    expect(pub['error']).toBeUndefined();
    expect(await call('schedule_setEnabled', { id, enabled: true })).toMatchObject({});

    const rowFor = async () => ((await call('schedule_list'))['result'] as Array<Record<string, unknown>>).find((x) => x['id'] === id);
    let row: Record<string, unknown> | undefined;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      row = await rowFor();
      if (row?.['lastError']) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect((row?.['lastError'] as { code?: string } | undefined)?.code).toBe('MCP_NOT_PROVISIONED');
    expect(row?.['lastRunId']).toBeUndefined();
    expect((await call('run_list', { workflow: 'sched-mcp-refuse' }))['result']).toEqual([]);
  }, 15000);
});
