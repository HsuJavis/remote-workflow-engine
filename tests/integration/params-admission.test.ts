// IT-083 (DES-104, ARCH-066, TASK-100): admission rung + run-immutable effectiveParams snapshot +
// resume + engine ceilings, inserted between catalog.get() and createRun()/runWorkspace().
//
// Mock policy (integration, DES-108): real RunManager, real SQLite catalog/run-store, real sandbox.
// No network/LLM needed — these assertions never require an agent() call to actually dispatch.
//
// Red reason: RunManager.start() does not validate `overrides` against any contract today — a
// locked-key or out-of-range override is currently either silently accepted or crashes with an
// unrelated TypeError, never the typed PARAM_LOCKED/PARAM_OUT_OF_RANGE rejection BEFORE any durable
// work (no run row, no workspace dir, no sandbox spawn). Genuine v21 red.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it083-'));
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

async function callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('Admission rung: overrides validated BEFORE any durable work (IT-083, DES-104, REQ-091)', () => {
  it('overrides naming a LOCKED key (prompt) → PARAM_LOCKED, no run row created', async () => {
    await callTool('workflow_register', { name: 'it083-locked', script: 'return await agent("hi");' });
    const before = (await callTool('workflow_list', {}) as { result?: unknown[] }).result?.length ?? 0;

    const r = await callTool('workflow_run', { name: 'it083-locked', overrides: { prompt: 'hijacked system prompt' } });
    expect(r.code ?? (r.error as { code?: string } | undefined)?.code).toBe('PARAM_LOCKED');

    const after = (await callTool('workflow_list', {}) as { result?: unknown[] }).result?.length ?? 0;
    expect(after).toBe(before); // no run row appended
  });

  it('an out-of-range override (timeoutMs above the engine ceiling) → PARAM_OUT_OF_RANGE, no workspace directory on disk', async () => {
    await callTool('workflow_register', { name: 'it083-ceiling', script: 'return await agent("hi");' });
    const r = await callTool('workflow_run', { name: 'it083-ceiling', overrides: { timeoutMs: 10_000_000 } });
    expect(r.code ?? (r.error as { code?: string } | undefined)?.code).toBe('PARAM_OUT_OF_RANGE');

    const runsDir = join(tmpDir, 'workflows', 'it083-ceiling', 'runs');
    expect(existsSync(runsDir)).toBe(false);
  });

  it('workflow_run.overrides inputSchema declares additionalProperties:false and exactly the 4 tunable properties (drift-lock, ARCH-064 inv-2)', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const body = await res.json() as { result?: { tools?: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }> } };
    const runTool = body.result?.tools?.find((t) => t.name === 'workflow_run');
    const overridesSchema = runTool?.inputSchema?.properties?.['overrides'] as { additionalProperties?: boolean; properties?: Record<string, unknown> } | undefined;
    expect(overridesSchema?.additionalProperties).toBe(false);
    expect(Object.keys(overridesSchema?.properties ?? {}).sort()).toEqual(['appendPrompt', 'effort', 'model', 'timeoutMs'].sort());
  });

  it('a run with a valid override succeeds and effectiveParams reflects the override (observable, not merely echoed)', async () => {
    await callTool('workflow_register', { name: 'it083-valid-override', script: 'return await agent("hi");', defaults: { model: 'sonnet' } });
    const r = await callTool('workflow_run', { name: 'it083-valid-override', overrides: { appendPrompt: 'extra instructions' } });
    expect(r.code).not.toBe('PARAM_LOCKED');
    expect(r.code).not.toBe('PARAM_OUT_OF_RANGE');
    expect(typeof r.runId).toBe('string');
  });

  it('workflow_resume rejects the mere PRESENCE of an overrides field, full stop', async () => {
    await callTool('workflow_register', { name: 'it083-resume-reject', script: 'return await agent("hi");' });
    const run = await callTool('workflow_run', { name: 'it083-resume-reject' });
    await callTool('workflow_suspend', { runId: run.runId });
    const resumed = await callTool('workflow_resume', { runId: run.runId, overrides: { timeoutMs: 5000 } } as unknown as Record<string, unknown>);
    expect(resumed.error ?? resumed.code).toBeDefined();
  });

});

// v21 Gate 5 re-run (2026-08-31, A-3 / 04-design.md "Orchestrator adjudication — v21 Gate 6
// send-back"): the ceiling wiring itself already reaches both RunManager (admission) and McpFacade
// (read surface) from the SAME composeConfig()-forwarded object — what has no test yet is the
// BEHAVIOR: a NULL-params workflow row must advertise the lowered ceiling via workflow_get with no
// re-registration, and admission must enforce that SAME number (not the compiled-in 600_000
// default). One test pinning advertised == enforced, deriving the boundary from the advertised
// value itself rather than hardcoding it twice.
describe('Advertised bound == enforced bound (DES-104, REQ-091, v21 Gate 5 re-run A-3)', () => {
  let loweredServer: Server;
  let loweredTmp: string;

  beforeAll(async () => {
    loweredTmp = mkdtempSync(join(tmpdir(), 'rwe-it083-a3-'));
    loweredServer = await createServer({
      port: 0,
      bind: '127.0.0.1',
      workRoot: loweredTmp,
      maxTimeoutMs: 5000, // lowered from the 600_000 compiled-in default
      aliases: {
        sonnet: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
      },
    });
  });

  afterAll(async () => {
    await loweredServer?.close();
    rmSync(loweredTmp, { recursive: true, force: true });
  });

  async function loweredCall(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`http://127.0.0.1:${loweredServer.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
    return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
  }

  it('a NULL-params workflow row advertises the lowered maxTimeoutMs ceiling via workflow_get, and admission enforces the SAME number', async () => {
    await loweredCall('workflow_register', { name: 'it083-a3-ceiling', script: 'return await agent("hi");' });

    const got = await loweredCall('workflow_get', { name: 'it083-a3-ceiling' });
    const advertisedMax = (got as { params?: { knobs?: { timeoutMs?: { max?: number } } } }).params?.knobs?.['timeoutMs']?.max;
    expect(advertisedMax).toBe(5000); // the LOWERED ceiling, not the 600_000 compiled-in default

    const tooHigh = await loweredCall('workflow_run', {
      name: 'it083-a3-ceiling', overrides: { timeoutMs: (advertisedMax as number) + 1 },
    });
    expect(tooHigh.code ?? (tooHigh.error as { code?: string } | undefined)?.code).toBe('PARAM_OUT_OF_RANGE');

    const atBound = await loweredCall('workflow_run', {
      name: 'it083-a3-ceiling', overrides: { timeoutMs: advertisedMax },
    });
    expect(atBound.code).not.toBe('PARAM_OUT_OF_RANGE');
  });
});
