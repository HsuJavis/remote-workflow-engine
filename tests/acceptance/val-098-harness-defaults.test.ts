// VAL-098 (REQ-088, TASK-154, v24 RETIREMENT): REQ-088's own doc entry is now marked
// `superseded-by: REQ-110 (v24, ADR-035)` in 01-requirements.md — "the workflow-wide `defaults`
// object is removed ... read the acceptance below as history, not as a live interface contract."
// The mechanism this file's 6 cases exercised (`workflow_register({defaults})`, HARNESS_DEFAULTS_
// INVALID) is gone: `workflow_register` takes no `defaults` field at all (DES-148), and every knob
// it bound is now REQUIRED per declared agent in `meta.params.agents.<label>` (REQ-110), whose own
// acceptance coverage already lives in VAL-121 (REQ-110) — `tests/integration/
// params-admission.test.ts` + `tests/integration/agent-log-harness-shape.test.ts` per 04-design.md's
// REQ-118 live-engine table. Nothing here has a v24 successor to port: REQ-088's "registered
// defaults actually take effect" promise is REQ-110's promise now, and VAL-121 is where it's pinned.
//
// Retired 2026-09-04 (TASK-154). Case count: 6 (before) -> 1 (after) — the 1 remaining case is a
// real-HTTP regression pin (real server + real SQLite catalog, this file's original mock policy)
// that the retired door answers DEFAULTS_RETIRED, not silently accepting or re-purposing the old
// HARNESS_DEFAULTS_INVALID code.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val098-'));
  server = await createServer({
    port: 0,
    bind: '127.0.0.1',
    workRoot: tmpDir,
    aliases: {
      sonnet: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
      default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
    },
  });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function callTool(name: string, args: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('REQ-088 superseded by REQ-110 (VAL-098 retirement, TASK-154)', () => {
  it('a workflow-wide meta.params.knobs default is DEFAULTS_RETIRED, not HARNESS_DEFAULTS_INVALID — REQ-088\'s door is gone, REQ-110\'s per-agent contract (VAL-121) is the live one', async () => {
    const script = `export const meta = { params: { knobs: { model: { type: 'string', default: 'sonnet' } } } };\nreturn 1;`;
    const r = await callTool('workflow_register', { name: 'val098-retired', script, mermaid: 'graph TD;' });
    expect((r.error as { code?: string } | undefined)?.code ?? r.code).toBe('DEFAULTS_RETIRED');

    const check = await callTool('workflow_source', { name: 'val098-retired' });
    expect(check.code).toBe('WORKFLOW_NOT_FOUND');
  });
});
