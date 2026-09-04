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
    aliases: {
      'alias-b': { provider: 'ollama', model: 'qwen2.5:7b-haiku-stand-in' },
      default: { provider: 'ollama', model: 'qwen2.5:7b' },
    },
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

async function pollUntilHarness(runId: string, agentId: string, maxMs = 8000): Promise<{ harness?: { model?: string; provenance?: Record<string, string> } }> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const log = await callTool('run_agent_log', { runId, agentId }) as { harness?: { model?: string; provenance?: Record<string, string> } };
    if (log.harness) return log;
    await new Promise((r) => setTimeout(r, 100));
  }
  return {};
}

// A script with exactly one top-level agent() call always gets agentId 'agent-1' — same fixed
// naming convention IT-066's `runAndGetAgentId` relies on (run_status nests agents under
// `.result.agents`, not top-level; polling top-level `.agents` would never resolve).
const SOLE_AGENT_ID = 'agent-1';

describe('REQ-092: registered defaults take effect at run time, observable in the harness descriptor (VAL-102)', () => {
  it('a call with NO per-call model dispatches with the registered default (alias-b), not silently ignored', async () => {
    await registerPublishedVia(callTool, 'val102-defaults', 'return await agent("hi");', { defaults: { model: 'alias-b' } });
    const run = await callTool('run_start', { name: 'val102-defaults' });
    const runId = run.runId as string;

    const { harness } = await pollUntilHarness(runId, SOLE_AGENT_ID);
    expect(harness?.model).toBe('alias-b');
    expect(harness?.provenance?.['model']).toBe('default');
  });

  it('the script itself calling agent({model:...}) wins over the registered default (per-call more specific)', async () => {
    await registerPublishedVia(callTool, 'val102-percall-wins', `return await agent("hi", {model:'default'});`, { defaults: { model: 'alias-b' } });
    const run = await callTool('run_start', { name: 'val102-percall-wins' });
    const runId = run.runId as string;

    const { harness } = await pollUntilHarness(runId, SOLE_AGENT_ID);
    expect(harness?.model).toBe('default');
    expect(harness?.provenance?.['model']).toBe('call');
  });
});
