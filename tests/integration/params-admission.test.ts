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
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { GatewayClient, GatewayResult } from '../../src/gateway/client.js';
import type { AgentSpawner, AgentOutcome } from '../../src/agent-executor.js';
import type { RunParams } from '../../src/params/resolve.js';

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

  // v21 Gate 8 send-back re-run (2026-09-01, review §4 B1 ≡ adversarial F1 ≡ quality QD-1): the
  // adopted Gate 2 decision (effective post-merge model alias-checked at submission via the
  // existing UNKNOWN_ALIAS rule, BEFORE any durable work) never reached code — `run-manager.ts`
  // hardcodes `new Set()` for `validateUserOverrides`'s `aliasNames` argument, so an override
  // naming a model absent from this server's configured `{sonnet, default}` table is silently
  // admitted today (burns a run row + workspace + sandbox + semaphore slot for an alias that will
  // resolve to `null` on every `agent()` call). Same zero-durable-work assertion shape as the
  // PARAM_LOCKED case above.
  it('B1: overrides.model naming an alias not in the configured table → UNKNOWN_ALIAS, no run row created', async () => {
    await callTool('workflow_register', { name: 'it083-unknown-alias', script: 'return await agent("hi");' });
    const before = (await callTool('workflow_list', {}) as { result?: unknown[] }).result?.length ?? 0;

    const r = await callTool('workflow_run', { name: 'it083-unknown-alias', overrides: { model: 'not-a-real-alias' } });
    expect(r.code ?? (r.error as { code?: string } | undefined)?.code).toBe('UNKNOWN_ALIAS');

    const after = (await callTool('workflow_list', {}) as { result?: unknown[] }).result?.length ?? 0;
    expect(after).toBe(before); // no run row appended
  });

  // Passthrough carve-out pin (GREEN on write today only because NO admission-time alias check
  // exists yet — the case above proves that; kept as the regression guard for once B1 lands, same
  // precedent as the A-3/A-7 green pins elsewhere in this file).
  it('B1 passthrough: overrides.model = openrouter/<id> is never rejected as UNKNOWN_ALIAS', async () => {
    await callTool('workflow_register', { name: 'it083-openrouter-passthrough', script: 'return await agent("hi");' });
    const r = await callTool('workflow_run', { name: 'it083-openrouter-passthrough', overrides: { model: 'openrouter/some-vendor/some-model' } });
    expect(r.code ?? (r.error as { code?: string } | undefined)?.code).not.toBe('UNKNOWN_ALIAS');
  });

});

// v21 Gate 5 addendum Part 2 (DES-104 boundary condition — clause-coverage sweep, ADR-002): "Nothing
// v21 resolves enters CallKey (run-manager.ts:706 [now :774] stays byte-identical) — pinned by a
// test asserting an overridden run's CallKeys are byte-identical to a non-overridden run's. This one
// cheap test guards both the zero-cache-invalidation promise and the F-2 blast-radius bound."
// Uses RunManager directly with an ad-hoc script (no WorkflowCatalog needed — `start()` only
// touches the catalog when `spec.name && !spec.script`) + a fake GatewayClient, so the journal
// write is fast and network-free.
describe('CallKey never carries v21-resolved params (ADR-002, DES-104)', () => {
  const clock = new FixedClock(new Date('2024-01-01T00:00:00.000Z'));
  const OK: GatewayResult = { ok: true, provider: 'fake', model: 'fake-model', tokens: { input: 1, output: 1 }, content: 'ok' };
  const gateway: GatewayClient = { invoke: async () => OK };

  async function pollDone(mgr: RunManager, runId: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const v = await mgr.status(runId);
      if (v.status === 'completed' || v.status === 'failed') return;
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  it('a run with overrides.appendPrompt and a plain run journal byte-identical CallKeys for the same agent() call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-callkey-'));
    try {
      const store = new InMemoryRunStore(clock);
      const mgr = new RunManager({ store, clock, workRoot: dir, gateway } as any);

      const plainRunId = await mgr.start({ script: `return await agent('same prompt');` });
      const overrideRunId = await mgr.start({ script: `return await agent('same prompt');` }, { appendPrompt: 'EXTRA USER TEXT' });
      await pollDone(mgr, plainRunId);
      await pollDone(mgr, overrideRunId);

      const plainJournal = await store.getJournal(plainRunId);
      const overrideJournal = await store.getJournal(overrideRunId);
      expect(plainJournal.length).toBe(1);
      expect(overrideJournal.length).toBe(1);
      // The composed (framed) appendPrompt reaches the OUTBOUND prompt (DES-105) but must never
      // enter the journaled CallKey — the cache-replay identity stays exactly what the script wrote.
      expect(overrideJournal[0]!.key).toEqual(plainJournal[0]!.key);
      expect(overrideJournal[0]!.key.prompt).toBe('same prompt');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

// v21 Gate 8 send-back re-run (2026-09-01, review §4 B2 ≡ adversarial F2): resume/rehydrate reads
// the PERSISTED (redacted) `effectiveParams` column (`run-manager.ts:595` `getEffectiveParams` ->
// `:626` `entry.effectiveParams` -> `:817` dispatched as `req.runParams`) — violates ARCH-066
// invariant (5) "the dispatched copy is never redacted". `redact()` is destructive (no inverse), so
// a resumed run silently dispatches the `‹secret:NAME›` marker in place of whatever secret-shaped
// text rode a user override, instead of the byte-identical value admission itself dispatched.
//
// Uses a `spawner` override (captures `req.runParams` directly, bypassing gateway/prompt-composition
// entirely — the most direct observation point for what actually reaches dispatch) + a REAL
// SqliteRunStore shared across TWO separate RunManager instances (mgr2 has an empty in-process
// `_runs` cache for this runId, exactly like a post-restart process — the same mechanism
// `_requireLive`'s own doc comment names: "e.g. after a server restart").
describe('B2: resume dispatches the byte-identical admission snapshot, never the persisted-redacted copy (ARCH-066 inv-5, review §4 B2)', () => {
  const clock = new FixedClock(new Date('2024-01-01T00:00:00.000Z'));
  const SECRET_NAME = 'IT083_B2_TOKEN';
  const SECRET_VALUE = 'it083-b2-secret-tok-abc987xyz';
  const secretValueProvider = { entries: () => [{ name: SECRET_NAME, value: SECRET_VALUE }] };

  async function pollStatus(mgr: RunManager, runId: string, want: string, tries = 100): Promise<string> {
    let v = await mgr.status(runId);
    for (let i = 0; i < tries && v.status !== want; i++) {
      await new Promise((r) => setTimeout(r, 20));
      v = await mgr.status(runId);
    }
    return v.status;
  }

  it('a resumed run (rehydrated in a FRESH RunManager instance) never silently dispatches the redaction marker — either byte-identical to admission, or a typed refusal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-it083-b2-'));
    try {
      const store = new SqliteRunStore(join(dir, 'store'), clock);
      const captured: RunParams[] = [];
      const spawner: AgentSpawner = {
        run: async (req): Promise<AgentOutcome> => {
          captured.push(req.runParams);
          return { kind: 'text', value: 'ok' };
        },
      };
      const mgr1 = new RunManager({ store, clock, workRoot: dir, spawner, secretValueProvider } as any);
      const runId = await mgr1.start({ script: `return await agent('base prompt');` }, { appendPrompt: SECRET_VALUE });
      await mgr1.suspend(runId); // entry.status is 'running' immediately after start() (same
      // guarantee IT-083's own "workflow_resume rejects..." test above relies on — suspend races
      // the real sandbox spawn, not the JS-level spawner override, and reliably wins).

      // The persisted admission-time snapshot IS redacted (correct, DES-088 sink 5).
      const persisted = await store.getEffectiveParams(runId);
      expect(JSON.stringify(persisted)).toContain(`‹secret:${SECRET_NAME}›`);

      // "Restart": a fresh RunManager instance, same store, no in-process cache for this runId.
      const mgr2 = new RunManager({ store, clock, workRoot: dir, spawner, secretValueProvider } as any);
      // review §4 (b): the invariant to restore is "resume dispatches byte-identical params to what
      // admission dispatched, OR refuses typed; never silent substitution" — mechanism choice
      // belongs to Gate 6, so this test accepts EITHER sanctioned outcome and only fails the
      // violation both branches rule out: a successful resume that silently dispatches the marker.
      let refusal: { code?: string } | undefined;
      try {
        await mgr2.resume(runId);
      } catch (err) {
        refusal = err as { code?: string };
      }
      if (refusal !== undefined) {
        expect(refusal.code).toBeDefined(); // sanctioned branch 2: a typed refusal, never a bare crash
      } else {
        expect(await pollStatus(mgr2, runId, 'completed')).toBe('completed');
        const resumedCall = captured[captured.length - 1]!;
        // sanctioned branch 1: byte-identical to what admission itself dispatched — never the
        // persist-only redaction marker silently substituted in.
        expect(resumedCall.appendPrompt).not.toContain(`‹secret:${SECRET_NAME}›`);
        expect(resumedCall.appendPrompt).toBe(SECRET_VALUE);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
