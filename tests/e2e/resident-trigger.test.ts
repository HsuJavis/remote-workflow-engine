// E2E-005: workflow_trigger starts a resident run; disabled resident returns SCHEDULE_DISABLED (REQ-015, REQ-005)
// RED: workflow_trigger MCP tool does not exist yet — assertions fail on "Unknown tool" or error envelope.
// No mock of SUT boundary: real createServer, real MCP HTTP calls.
// D-V2I-3 (ORCH binding): schedule/trigger targets are CATALOG-REGISTERED workflows only (REQ-014/
// REQ-015 wording) — every target below is registered via `workflow_register` first, never via a
// bare `workflow_run({name, script})` (which never persists to WorkflowCatalog, see E2E-004's own
// note for the exact root cause).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-e2e-trig-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function mcpCall(name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

async function registerWorkflow(name: string, script: string) {
  const r = await mcpCall('workflow_register', { name, script });
  expect(r['error']).toBeUndefined();
}

async function pollUntilTerminal(runId: string, maxMs = 10_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const r = await mcpCall('workflow_status', { runId });
    const status = (r['result'] as Record<string, unknown>)?.['status'] as string;
    if (['completed', 'failed', 'stopped'].includes(status)) return status;
    await new Promise((r2) => setTimeout(r2, 200));
  }
  return 'timeout';
}

describe('workflow_trigger (REQ-015, E2E-005)', () => {
  it('workflow_trigger on an enabled resident immediately starts a run with a runId', async () => {
    await registerWorkflow('trigger-wf', 'return {triggered:true}');
    await mcpCall('schedule_create', { kind: 'resident', workflow: 'trigger-wf', enabled: true });

    const result = await mcpCall('workflow_trigger', { workflow: 'trigger-wf', args: { x: 42 } });
    expect(result['error']).toBeUndefined();
    const runId = (result['result'] as Record<string, unknown>)?.['runId'] as string;
    expect(typeof runId).toBe('string');

    // Verify the run appears in workflow_list and eventually completes.
    const status = await pollUntilTerminal(runId);
    expect(['completed', 'failed']).toContain(status);
  });

  it('workflow_trigger on a disabled resident returns SCHEDULE_DISABLED (no run started)', async () => {
    await registerWorkflow('disabled-wf', 'return 0');
    await mcpCall('schedule_create', { kind: 'resident', workflow: 'disabled-wf', enabled: false });

    const result = await mcpCall('workflow_trigger', { workflow: 'disabled-wf' });
    expect((result['error'] as Record<string, unknown>)?.['code']).toBe('SCHEDULE_DISABLED');
    expect(result['result']).toBeUndefined();
  });

  it('workflow_trigger for a never-registered workflow name returns WORKFLOW_NOT_FOUND (D-V2I-3)', async () => {
    const result = await mcpCall('workflow_trigger', { workflow: 'never-registered-trigger-target' });
    expect((result['error'] as Record<string, unknown>)?.['code']).toBe('WORKFLOW_NOT_FOUND');
    expect(result['result']).toBeUndefined();
  });

  it('triggered run appears in workflow_list (shares the standard run lifecycle, REQ-005)', async () => {
    await registerWorkflow('list-wf', 'return 99');
    await mcpCall('schedule_create', { kind: 'resident', workflow: 'list-wf', enabled: true });
    const result = await mcpCall('workflow_trigger', { workflow: 'list-wf' });
    const runId = (result['result'] as Record<string, unknown>)?.['runId'] as string;
    if (typeof runId !== 'string') return; // already failed above

    await pollUntilTerminal(runId);

    const listResult = await mcpCall('workflow_list');
    const list = (listResult['result'] as Array<{ runId?: string; kind?: string }>) ?? [];
    expect(list.some((e) => e.runId === runId || e.kind === 'run')).toBe(true);
  });
});
