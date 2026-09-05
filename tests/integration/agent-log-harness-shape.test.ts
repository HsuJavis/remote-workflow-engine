// IT-066: run_agent_log (v24 rename of workflow_agent_log — tool-specs.ts) returns harness field + harness stripped from events window +
// hasMore + ?limit&offset + canonical AgentRecord.state values (DES-067, ARCH-045, TASK-070)
//
// Mock policy (integration): real createServer + real SqliteRunStore + real McpFacade; gateway
// faked (fixed-response). Tests that the shaped response has:
//   1. harness: HarnessDescriptor|null at the top level (NOT buried in events[])
//   2. The `kind:'harness'` event is STRIPPED from the events array (sent once, not evicted by cap)
//   3. null for a never-dispatched agent (not yet started / idle)
//   4. hasMore:boolean present
//   5. AgentRecord.state stays canonical ('queued'|'running'|'done'|'failed') in JSON responses
//
// v24 migration: the tool surface was renamed (workflow_agent_log -> run_agent_log,
// workflow_status -> run_status; src/tool-specs.ts is authoritative) and agent() now takes a
// LITERAL label first with the prompt in the options object (ADR-029). Oracles unchanged.
//
// Red reason: run_agent_log currently returns a flat array of TranscriptEvent objects.
//   It does NOT have a top-level `harness` field, does not strip harness events from the events
//   array, does not have hasMore, and has no limit/offset windowing. All 5 cases fail.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it066-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

type MCPEnvelope = { result?: unknown; error?: { code?: string; message?: string } };
type AgentLogResult = {
  harness?: unknown;
  events?: Array<{ kind?: string }>;
  hasMore?: boolean;
};

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? 'null') as MCPEnvelope;
}

async function pollDone(runId: string, maxMs = 8000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const s = await callTool('run_status', { runId }) as { status?: string };
    if (s?.status !== 'queued' && s?.status !== 'running') return;
    await new Promise((r) => setTimeout(r, 40));
  }
}

/** v24 (tool-specs.ts): `run_agent_log`'s ADVERTISED input is `{runId, label}` — `agentId` is an
 *  engine-minted counter a caller has no way to learn, so the closed schema refuses it
 *  (INVALID_ARGUMENT). The HTTP dashboard route `/api/runs/:runId/agents/:agentId` still addresses
 *  by agentId, so both are returned here and each call site uses the one its transport takes. */
async function runAndGetAgentId(script: string): Promise<{ runId: string; agentId: string; label: string }> {
  const sub = await runScriptVia(callTool, script) as { runId?: string };
  const runId = sub?.runId!;
  await pollDone(runId);
  const status = await callTool('run_status', { runId }) as { agents?: Array<{ agentId: string; label?: string }>; result?: { agents?: Array<{ agentId: string; label?: string }> } };
  const agents = status?.agents ?? status?.result?.agents ?? [];
  const agentId = agents[0]?.agentId ?? 'agent-1';
  const label = agents[0]?.label;
  // Fail loudly rather than querying `label: ''`: an empty label answers AGENT_LOG_NOT_FOUND with
  // `harness: null, events: []`, which several cases below would then pass VACUOUSLY.
  if (!label) throw new Error(`run_status returned no label for the first agent of ${runId}`);
  return { runId, agentId, label };
}

describe('run_agent_log harness shape (IT-066, DES-067)', () => {
  it('returns top-level harness field alongside events (not embedded in events array)', async () => {
    const { runId, label } = await runAndGetAgentId(`return await agent('say', { prompt: 'say hi' });`);
    const log = await callTool('run_agent_log', { runId, label }) as AgentLogResult;

    // TASK-070: harness must be a top-level field, not absent
    expect('harness' in (log ?? {})).toBe(true);
    // Events array must NOT contain any kind:'harness' entry (stripped, not evicted)
    const harnessInEvents = (log.events ?? []).some((e) => e.kind === 'harness');
    expect(harnessInEvents).toBe(false);
  });

  it('harness field is null for a never-dispatched agent (no events)', async () => {
    // An agent in a parallel group that was queued but never dispatched has no harness event.
    // Since we can't easily create such an agent in integration, we use a non-existent agentId.
    const sub = await runScriptVia(callTool, 'return 1;') as { runId?: string };
    const runId = sub?.runId!;
    await pollDone(runId);

    // Fetch log for a non-existent (never-dispatched) agent ID
    const log = await callTool('run_agent_log', { runId, label: 'never-dispatched' }) as MCPEnvelope;
    // Either returns null harness or AGENT_NOT_FOUND; the harness field must not be a descriptor for a ghost agent
    if ('harness' in (log ?? {})) {
      expect((log as AgentLogResult).harness).toBeNull();
    } else {
      // AGENT_LOG_NOT_FOUND is acceptable for truly non-existent agents
      expect(log?.error?.code).toBe('AGENT_LOG_NOT_FOUND'); // v24 code name (mcp-facade runAgentLog)
    }
  });

  it('response includes hasMore:boolean', async () => {
    const { runId, label } = await runAndGetAgentId(`return await agent('hi', {});`);
    const log = await callTool('run_agent_log', { runId, label }) as AgentLogResult;
    // TASK-070: hasMore must be present as a boolean
    expect(typeof log.hasMore).toBe('boolean');
  });

  it('?limit parameter restricts the events window; hasMore:true when more events exist', async () => {
    const { runId, agentId } = await runAndGetAgentId(`return await agent('again', { prompt: 'hi again' });`);

    // Fetch with limit=1 — should return at most 1 event
    const res = await fetch(
      `http://127.0.0.1:${server.port}/api/runs/${runId}/agents/${agentId}?limit=1`,
    );
    expect(res.status).toBe(200);
    const log = await res.json() as AgentLogResult;
    // TASK-070: limit respected
    expect((log.events ?? []).length).toBeLessThanOrEqual(1);
    // hasMore field must be present
    expect('hasMore' in log).toBe(true);
  });

  it('AgentRecord.state in run_status is canonical: queued|running|done|failed, never idle/completed', async () => {
    const { runId } = await runAndGetAgentId(`return await agent('verify', { prompt: 'verify canonical' });`);
    const status = await callTool('run_status', { runId }) as {
      agents?: Array<{ state?: string }>;
    };
    for (const a of status?.agents ?? []) {
      expect(['queued', 'running', 'done', 'failed']).toContain(a.state);
      // ARCH-045: 'idle' and 'completed' are render-time-only aliases, never in JSON
      expect(a.state).not.toBe('idle');
      expect(a.state).not.toBe('completed');
    }
  });
});

// v21 (ARCH-068, DES-105, TASK-101): the harness descriptor gains per-key provenance — the
// self-diagnosing tripwire for the next wiring miss (a knob that silently falls through shows up
// as provenance.<key>:'engine' where a rung was expected).
//
// Separate server: the shared `server` above is built with NO aliases, so its gateway is the
// NULL_GATEWAY stub (never calls onHarness at all — `harness` stays permanently null regardless of
// v21). Reaching onHarness needs an aliased gateway; `useLiteLLMProxy:false` + the 'ollama' provider
// reaches onHarness (called unconditionally before the outbound fetch) without spawning the litellm
// subprocess or needing any live backend/API key.
describe('run_agent_log harness provenance (IT-066 v21, DES-105)', () => {
  let provServer: Server;
  let provTmpDir: string;

  beforeAll(async () => {
    provTmpDir = mkdtempSync(join(tmpdir(), 'rwe-it066-prov-'));
    provServer = await createServer({
      port: 0, bind: '127.0.0.1', workRoot: provTmpDir,
      aliases: { default: { provider: 'ollama', model: 'qwen2.5:7b' } },
      useLiteLLMProxy: false,
    });
  });
  afterAll(async () => { await provServer?.close(); rmSync(provTmpDir, { recursive: true, force: true }); });

  async function provCallTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`http://127.0.0.1:${provServer.port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
    return JSON.parse(body.result?.content?.[0]?.text ?? 'null');
  }

  it('harness descriptor carries per-key provenance (model/effort/timeoutMs/appendPrompt)', async () => {
    const sub = await runScriptVia(provCallTool, `return await agent('say', { prompt: 'say hi' });`) as { runId?: string };
    const runId = sub.runId!;
    // v24: address the agent by its script LABEL — `run_agent_log`'s advertised input is
    // `{runId, label}` and the engine-minted `agent-1` counter is no longer accepted on the wire.
    // onHarness fires at session-build time — poll briefly for it, don't wait for full completion
    // (the outbound fetch to a non-existent local Ollama will itself fail/timeout).
    const label = 'say';

    let harness: { provenance?: Record<string, string> } | undefined;
    for (let i = 0; i < 60 && !harness; i++) {
      const log = await provCallTool('run_agent_log', { runId, label }) as { harness?: { provenance?: Record<string, string> } };
      harness = log.harness ?? undefined;
      if (!harness) await new Promise((r) => setTimeout(r, 100));
    }
    expect(harness?.provenance).toBeDefined();
    for (const key of ['model', 'effort', 'timeoutMs', 'appendPrompt']) {
      expect(['call', 'agentType', 'override', 'default', 'engine']).toContain(harness?.provenance?.[key]);
    }
  }, 10_000);

  // IT-120 (DES-160, v24 REWRITE — appended case, [T3]): the decorated HarnessDescriptor gains
  // `label` (from opts.label) and `materialized: {skills, mcp, missing}`. Written test-first
  // (Gate 5, RED) — neither field exists on the harness descriptor today. Reuses THIS block's
  // aliased provServer (the shared top-level `server` has no alias and would fail registration
  // for an unrelated reason — UNKNOWN_ALIAS — before ever reaching the harness assertion).
  it('v24: harness carries label and materialized on a curated dispatch', async () => {
    const sub = await runScriptVia(provCallTool, "return await agent('plan', {});") as { runId?: string };
    const runId = sub.runId!;
    const label = 'plan'; // v24: run_agent_log addresses by script label, not the minted agentId
    let harness: { label?: string; materialized?: unknown } | undefined;
    for (let i = 0; i < 60 && !harness?.label; i++) {
      const log = await provCallTool('run_agent_log', { runId, label }) as { harness?: { label?: string; materialized?: unknown } };
      harness = log.harness ?? undefined;
      if (!harness?.label) await new Promise((r) => setTimeout(r, 100));
    }
    expect(harness?.label).toBe('plan');
    expect(harness?.materialized).toBeDefined();
  }, 10_000);
});
