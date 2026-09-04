// VAL-103 (REQ-093): `effort` is a real end-to-end parameter, not a documented no-op.
//
// Mock policy (acceptance, DES-108): evidence plan pre-committed (Ollama has no reasoning dial —
// the wire assertion is not observable on the default local stack). Real-tier green =
//   (a) a real Ollama-backed run at effort:'max' completes with effortApplied recorded and no 400
//       (gated behind HAS_PROVIDER — needs an actual reachable backend);
//   (b) an UNGATED submission-time check: an out-of-enum effort value is refused before any
//       durable work, and the harness descriptor's `effortApplied` field exists in the schema
//       shape once a run's harness is read back (checked via the no-provider PARAM_OUT_OF_RANGE
//       path, which requires no live backend at all).
//
// v24 RETIREMENT (TASK-154, 2026-09-04): two of this file's original 4 cases exercised the
// workflow-wide `defaults.effort` registration door (`workflow_register({defaults:{effort}})`,
// HARNESS_DEFAULTS_INVALID) — that door is gone (DES-148/ADR-035); `effort` is now REQUIRED per
// declared agent in `meta.params.agents.<label>.effort.default` (REQ-110), whose registration-time
// ceiling coverage already lives in `tests/unit/params-contract.test.ts` (TASK-136) and
// `tests/integration/params-admission.test.ts` (TASK-137). The two per-call-override cases below
// (`overrides:{effort}` at admission, and the real Ollama per-call `agent(label,{effort})` run) are
// UNRELATED to that retired door — REQ-093's own subject — and are kept unchanged. Case count: 4
// (before) -> 2 (after).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

const HAS_PROVIDER = !!process.env['OLLAMA_BASE_URL'];

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val103-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    aliases: { local: { provider: 'ollama', model: 'qwen2.5:7b' }, default: { provider: 'ollama', model: 'qwen2.5:7b' } },
  });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

async function callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}


// v24 (integrator): `UserOverrides` is per-agent (DES-145) and an in-script `effort` is refused
// (`PARAM_IN_SCRIPT`) — the effort an agent runs at is declared on its label and overridden by
// label. `run_agent_log` is addressed by that same label (DES-161). Oracles unchanged.
const LABEL = 'speaker';
function declaredScript(effortDefault = 'low'): string {
  return [
    'export const meta = { params: { agents: { ' + LABEL + ': {',
    "  model: { type: 'string', default: 'default' },",
    "  effort: { type: 'enum', enum: ['low','medium','high','xhigh','max'], default: '" + effortDefault + "' },",
    "  timeoutMs: { type: 'number', default: 60000 } } } } };",
    "return await agent('" + LABEL + "', { prompt: 'say hi' });",
  ].join('\n');
}

describe('REQ-093: effort is real end-to-end, not a documented no-op (VAL-103)', () => {
  // UNGATED — requires no live backend at all (submission-time validation, admission rung).
  it('an out-of-enum effort override (outside low|medium|high|xhigh|max) is refused at submission, before any durable work', async () => {
    await registerPublishedVia(callTool, 'val103-bad-effort', declaredScript());
    const r = await callTool('run_start', { name: 'val103-bad-effort', overrides: { agents: { [LABEL]: { effort: 'super-max' } } } });
    expect(r.code ?? (r.error as { code?: string } | undefined)?.code).toBe('PARAM_OUT_OF_RANGE');
  });

  it.skipIf(!HAS_PROVIDER)('a real Ollama-backed run at effort:"max" completes with effortApplied recorded (no 400, honest no-op) [requires OLLAMA_BASE_URL] [UNVERIFIED here: no provider configured — set OLLAMA_BASE_URL]', async () => {
    await registerPublishedVia(callTool, 'val103-real-effort', declaredScript('max'));
    const run = await callTool('run_start', { name: 'val103-real-effort' });
    const runId = run.runId as string;

    const deadline = Date.now() + 20_000;
    let status: { status?: string } = {};
    while (Date.now() < deadline) {
      status = await callTool('run_status', { runId }) as { status?: string };
      if (status.status === 'completed' || status.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(status.status).toBe('completed');

    // A script with exactly one top-level agent() call always gets agentId 'agent-1' — same fixed
    // naming convention VAL-102/VAL-104 rely on. `run_status` nests agents under `.result.agents`,
    // not top-level `.agents` — polling/reading top-level `.agents` never resolves (test defect fixed
    // at Gate 7.5 v21: the prior version read `s.agents?.[0]?.agentId`, always undefined).
    const log = await callTool('run_agent_log', { runId, label: LABEL }) as { harness?: { effortApplied?: unknown } };
    expect(log.harness?.effortApplied).toBeDefined();
  }, 25_000);

});
