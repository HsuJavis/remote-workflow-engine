// VAL-082 (REQ-073): clickable agent box → harness detail (model, prompt, tools, skills, live status).
//
// Acceptance tier — MUST NOT mock the SUT's own boundaries: real HTTP server, real createServer,
// real run_agent_log + HTTP endpoint. Gateway faked only for structure assertions.
//
// CI-safe assertion (this test, real:false):
//   - run_agent_log response carries `hasMore:boolean` at the top level; NOT the current
//     ResultEnvelope<TranscriptEvent[]> wrapping (which has no hasMore field)
//   - AgentRecord.state in run_status is canonical (queued|running|done|failed)
//
// Headless-browser DOM assertions + harness content (deferred to Gate 7.5 real-run, real:true):
//   - Click agent box → detail panel shows model, prompt, tools/skills, no secret plaintext
//   - Queued agent shows "idle", running shows "running" (live-updates), completed shows "completed · N tok"
//   - Real agent execution: run_agent_log carries harness.prompt + harness.tools + harness.model
//
// Note: DES-069's "two-tier no-secret proof": tier-1 (pure redactHarness) is UT-070;
//       tier-2 (headless DOM check) is deferred to Gate 7.5.
//
// Red reason (CI-testable): run_agent_log currently returns ResultEnvelope<TranscriptEvent[]>
//   which carries no `hasMore` field. The CI assertion `expect('hasMore' in log).toBe(true)` FAILS
//   because the current response is {error:{code:'AGENT_NOT_FOUND'}} or {result:[...events...]},
//   neither of which has hasMore. TASK-070 changes the shape to {harness:...,events:[],hasMore:bool}.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;
const HAS_PROVIDER = !!(process.env['ANTHROPIC_API_KEY'] || process.env['OLLAMA_BASE_URL'] || process.env['OPENAI_API_KEY'] || process.env['OPENROUTER_API_KEY']);

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val082-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

type AgentLogEnvelope = {
  harness?: unknown;
  events?: Array<{ kind?: string }>;
  hasMore?: boolean;
  error?: { code?: string };
};

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? 'null');
}

async function pollDone(runId: string, maxMs = 8000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const s = await callTool('run_status', { runId }) as { status?: string };
    if (s?.status !== 'queued' && s?.status !== 'running') return;
    await new Promise((r) => setTimeout(r, 40));
  }
}

describe('VAL-082: harness detail in run_agent_log (REQ-073)', () => {
  it('run_agent_log response carries hasMore:boolean field (CI-safe, TASK-070 shape change)', async () => {
    // TASK-070 changes the response shape from ResultEnvelope<TranscriptEvent[]>
    // to { harness:HarnessDescriptor|null, events:TranscriptEvent[], hasMore:boolean }.
    // The CI-testable RED: even for a ghost agentId, the response must carry hasMore in the new shape.
    // Currently returns {error:{code:'AGENT_NOT_FOUND'}} or {result:[...]} — neither has hasMore.
    const sub = await callTool('run_start', { script: 'return "val082";' }) as { runId?: string };
    const runId = sub?.runId!;
    await pollDone(runId, 8000);

    // Call with a ghost agentId — new shape must return {harness:null, events:[], hasMore:false}
    // (or AGENT_NOT_FOUND if this specific agentId was truly never registered).
    // Either way, the response must have hasMore as a property.
    const log = await callTool('run_agent_log', { runId, agentId: 'agent-1' }) as AgentLogEnvelope;
    // TASK-070: hasMore is a required field in the new response shape.
    expect('hasMore' in (log ?? {})).toBe(true);
  });

  it('AgentRecord.state in run_status is canonical — never idle/completed in JSON (CI-safe regression)', async () => {
    // Canonical state values (queued|running|done|failed) are already enforced.
    // This test ensures TASK-070 does NOT regress the canonical-state invariant.
    const sub = await callTool('run_start', { script: 'return "canonical-check";' }) as { runId?: string };
    const runId = sub?.runId!;
    await pollDone(runId, 8000);
    const status = await callTool('run_status', { runId }) as { agents?: Array<{ state?: string }> };
    for (const a of status?.agents ?? []) {
      expect(['queued', 'running', 'done', 'failed']).toContain(a.state);
      expect(a.state).not.toBe('idle');
      expect(a.state).not.toBe('completed');
    }
  });

  it('harness field shows model, prompt, tools/skills, no secret (LLM-gated; headless DOM at Gate 7.5)', async () => {
    // REQ-073 primary path: real agent execution → harness captures resolved model/prompt/tools.
    // Headless-browser click interaction deferred to Gate 7.5 real-run.
    if (!HAS_PROVIDER) return;

    const sub = await callTool('run_start', {
      script: `return await agent('Reply with PONG', {});`,
    }) as { runId?: string };
    const runId = sub?.runId!;
    await pollDone(runId, 60_000);

    const status = await callTool('run_status', { runId }) as {
      agents?: Array<{ agentId: string; state: string }>;
    };
    expect(status?.agents?.length).toBeGreaterThan(0);
    const agentId = status!.agents![0]!.agentId;

    const log = await callTool('run_agent_log', { runId, agentId }) as AgentLogEnvelope;

    // REQ-073: harness field present and contains the resolved surface
    expect(log.harness).not.toBeNull();
    expect(log.harness).toBeDefined();
    const h = log.harness as { prompt?: string; tools?: unknown[]; skills?: unknown[]; mcpServers?: unknown[] };
    expect(typeof h.prompt).toBe('string');
    expect(h.prompt!.length).toBeGreaterThan(0);
    expect(Array.isArray(h.tools)).toBe(true);
    expect(Array.isArray(h.skills)).toBe(true);
    // Tier-2 no-secret: no secret patterns in harness
    const harnessJson = JSON.stringify(log.harness);
    expect(harnessJson).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
    expect(harnessJson).not.toMatch(/ghp_[a-zA-Z0-9]{10,}/);
    // harness kind stripped from events
    expect((log.events ?? []).some((e) => e.kind === 'harness')).toBe(false);
  });
});
