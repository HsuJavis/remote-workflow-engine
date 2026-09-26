// VAL-102 (REQ-092): registered harness defaults actually take effect at run time (repairs the
// REQ-088 wiring gap — resolveHarnessParams had zero src/ callers).
//
// Mock policy (acceptance, DES-108): real server, real dispatch path. onHarness fires at
// session-build time regardless of whether the outbound network call ultimately succeeds (same
// precedent as IT-066, which passes today without a live LLM configured) — no HAS_PROVIDER gate
// is needed for the observability assertions below.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val102-'));
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
    // useLiteLLMProxy:false + 'ollama' provider: onHarness fires unconditionally at session-build
    // time (before the outbound fetch) without spawning the litellm subprocess or needing a live
    // backend/API key — the assertions below only need the DESCRIPTOR, not a completed call.
    // 2026-09-26 (alias mechanism removed): no alias table any more — the script below declares the
    // full ref directly as its `model.default`.
    useLiteLLMProxy: false,
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

async function pollUntilHarness(runId: string, label: string, maxMs = 8000): Promise<{ harness?: { model?: string; provenance?: Record<string, string> } }> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const log = await callTool('run_agent_log', { runId, label }) as { harness?: { model?: string; provenance?: Record<string, string> } };
    if (log.harness) return log;
    await new Promise((r) => setTimeout(r, 100));
  }
  return {};
}

// v24 (integrator): `run_agent_log`'s advertised schema is `{runId, label}` with BOTH required — an
// engine-minted `agentId` is not something a caller can learn from `tools/list`, which is why
// DES-161 put the script's own LABEL on the agent record. Addressing by `agentId` alone is now
// refused INVALID_ARGUMENT by ajv (missing `label`), so the poll below never saw a harness and this
// file timed out rather than failing on its real subject.
const SOLE_AGENT_LABEL = 'hi';

describe('REQ-092: registered defaults take effect at run time, observable in the harness descriptor (VAL-102)', () => {
  it('a call with NO per-call model dispatches with the registered default full ref, not silently ignored', async () => {
    // v24 (ADR-035): a flat registered `defaults` no longer exists — the same effect is now a
    // per-agent `meta.params.agents.<label>.model.default` declared inside the script itself.
    const script =
      `export const meta = { params: { agents: { hi: { ` +
      `model: { type: 'string', default: 'ollama/qwen2.5vl:7b' }, ` +
      `effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, ` +
      `timeoutMs: { type: 'number', default: 60000 } } } } };\n` +
      `return await agent("hi", {});`;
    await registerPublishedVia(callTool, 'val102-defaults', script);
    const run = await callTool('run_start', { name: 'val102-defaults' });
    const runId = run.runId as string;

    const { harness } = await pollUntilHarness(runId, SOLE_AGENT_LABEL);
    // v26 (DES-177, REQ-125, integrator) — 2026-09-26 (alias mechanism removed): the harness
    // descriptor's `model` is the bare id parsed off the full ref (`ollama/qwen2.5vl:7b`
    // -> `qwen2.5vl:7b`) — REQ-125 exists so the record names the backend that served
    // the call. Asserting that id pins the SAME property this case always pinned — the label's
    // registered `model.default` is what actually dispatched, not some other rung.
    expect(harness?.model).toBe('qwen2.5vl:7b');
    expect(harness?.provenance?.['model']).toBe('default');
  });

  // v24 (integrator): the `'call'` rung is RETIRED, not renamed. ARCH-095/DES-146 deleted it as
  // unreachable once `model.default` became required per label, and `scanAgentCalls` now REFUSES a
  // `model`/`effort`/`timeoutMs` written inside an `agent()` call (`PARAM_IN_SCRIPT`, surfaced as
  // SCAN_VIOLATION) so that the one place a value can be tuned is the contract a caller can read
  // and override. The case is therefore RE-POINTED at the same seam in its new form — the refusal —
  // rather than deleted: what must not silently change is that a per-call `model` cannot quietly
  // win over the declared default.
  it("the script writing agent({model:...}) is REFUSED at registration (the 'call' rung is retired, not silently ignored)", async () => {
    const script =
      `export const meta = { params: { agents: { hi: { ` +
      `model: { type: 'string', default: 'ollama/qwen2.5vl:7b' }, ` +
      `effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, ` +
      `timeoutMs: { type: 'number', default: 60000 } } } } };\n` +
      `return await agent("hi", {model:'default'});`;
    const reg = await callTool('workflow_register', { name: 'val102-percall-wins', script, mermaid: 'graph TD;\nn0(["hi"])' });
    const code = (reg['code'] as string | undefined) ?? (reg['error'] as { code?: string } | undefined)?.code;
    expect(code).toBe('SCAN_VIOLATION');
    const message = (reg['error'] as { message?: string } | undefined)?.message ?? '';
    // The refusal must NAME the key and where it belongs — a bare SCAN_VIOLATION would leave an
    // author with no way to act on it.
    expect(message).toContain('PARAM_IN_SCRIPT');
    expect(message).toContain('meta.params.agents.hi.model.default');
    // Nothing stored: the refusal is at registration, before any version row exists.
    const got = await callTool('workflow_source', { name: 'val102-percall-wins' });
    expect(got['code']).toBe('WORKFLOW_NOT_FOUND');
  });
});
