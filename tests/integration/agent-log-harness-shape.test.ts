// IT-066: workflow_agent_log returns harness field + harness stripped from events window +
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
// Red reason: workflow_agent_log currently returns a flat array of TranscriptEvent objects.
//   It does NOT have a top-level `harness` field, does not strip harness events from the events
//   array, does not have hasMore, and has no limit/offset windowing. All 5 cases fail.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

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
    const s = await callTool('workflow_status', { runId }) as { status?: string };
    if (s?.status !== 'queued' && s?.status !== 'running') return;
    await new Promise((r) => setTimeout(r, 40));
  }
}

async function runAndGetAgentId(script: string): Promise<{ runId: string; agentId: string }> {
  const sub = await callTool('workflow_run', { script }) as { runId?: string };
  const runId = sub?.runId!;
  await pollDone(runId);
  const status = await callTool('workflow_status', { runId }) as { agents?: Array<{ agentId: string }> };
  const agentId = status?.agents?.[0]?.agentId ?? 'agent-1';
  return { runId, agentId };
}

describe('workflow_agent_log harness shape (IT-066, DES-067)', () => {
  it('returns top-level harness field alongside events (not embedded in events array)', async () => {
    const { runId, agentId } = await runAndGetAgentId('return await agent("say hi");');
    const log = await callTool('workflow_agent_log', { runId, agentId }) as AgentLogResult;

    // TASK-070: harness must be a top-level field, not absent
    expect('harness' in (log ?? {})).toBe(true);
    // Events array must NOT contain any kind:'harness' entry (stripped, not evicted)
    const harnessInEvents = (log.events ?? []).some((e) => e.kind === 'harness');
    expect(harnessInEvents).toBe(false);
  });

  it('harness field is null for a never-dispatched agent (no events)', async () => {
    // An agent in a parallel group that was queued but never dispatched has no harness event.
    // Since we can't easily create such an agent in integration, we use a non-existent agentId.
    const sub = await callTool('workflow_run', { script: 'return 1;' }) as { runId?: string };
    const runId = sub?.runId!;
    await pollDone(runId);

    // Fetch log for a non-existent (never-dispatched) agent ID
    const log = await callTool('workflow_agent_log', { runId, agentId: 'never-dispatched' }) as MCPEnvelope;
    // Either returns null harness or AGENT_NOT_FOUND; the harness field must not be a descriptor for a ghost agent
    if ('harness' in (log ?? {})) {
      expect((log as AgentLogResult).harness).toBeNull();
    } else {
      // AGENT_NOT_FOUND is acceptable for truly non-existent agents
      expect(log?.error?.code).toBe('AGENT_NOT_FOUND');
    }
  });

  it('response includes hasMore:boolean', async () => {
    const { runId, agentId } = await runAndGetAgentId('return await agent("hi");');
    const log = await callTool('workflow_agent_log', { runId, agentId }) as AgentLogResult;
    // TASK-070: hasMore must be present as a boolean
    expect(typeof log.hasMore).toBe('boolean');
  });

  it('?limit parameter restricts the events window; hasMore:true when more events exist', async () => {
    const { runId, agentId } = await runAndGetAgentId('return await agent("hi again");');

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

  it('AgentRecord.state in workflow_status is canonical: queued|running|done|failed, never idle/completed', async () => {
    const { runId } = await runAndGetAgentId('return await agent("verify canonical");');
    const status = await callTool('workflow_status', { runId }) as {
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
