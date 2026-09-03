// UT-111 (TASK-117, DES-131/121/122/123/127/129, ARCH-079): `GraphAnalyzer` — async queue,
// single-flight per (name,version), own retry loop, the closed 8-value persisted `DiagramNoteCode`
// set, the per-attempt journal line, and the three-shape `sweepAtBoot()`.
//
// Mock policy (unit, DES-119): a stub `GatewayClient` (`invoke()` resolves/rejects per test), a
// REAL `WorkflowCatalog` (real on-disk sqlite under a tmpdir — diagram-row assertions need the
// genuine transactional store, same rationale as UT-108/IT-093), plain-object `TriggerPorts`,
// `FixedClock`, and the `schedule: runInline` seam (fires the job without awaiting it, so `enqueue`
// itself returns immediately — exactly what the seam exists for, DES-131).
//
// Red reason: `src/graph-analyzer.ts` does not exist yet → MODULE NOT FOUND at collect time.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { GraphAnalyzer, type GraphAnalyzerConfig } from '../../src/graph-analyzer.js';
import type { GatewayClient, GatewayResult } from '../../src/gateway/client.js';
import type { TriggerPorts } from '../../src/trigger-bindings.js';
// v23 Gate 2 RE-RUN #2 (send-back `41e6382`), R-2(d): `AnalyzerCause` does not exist yet — this is
// a TYPE-ONLY import, erased at collect time regardless of whether the named export exists (no
// vitest/esbuild collection failure for the other 30+ tests in this file); the enforcement this
// import exists for is `npx tsc --noEmit`, not vitest (see UT-132's own type-level case below).
import type { AnalyzerCause } from '../../src/graph-analyzer.js';

const CLOCK = new FixedClock(new Date('2026-09-02T10:00:00.000Z'));
const ALIAS_NAMES = new Set(['sonnet-5']);
const NO_TRIGGERS: TriggerPorts = {
  schedules: { listByWorkflow: () => [] },
  webhooks: { listByWorkflow: () => [] },
  continuations: { listPendingByWorkflow: () => [] },
  runs: { getWorkflowName: () => null },
};

/** Fires `job` WITHOUT awaiting it — enqueue() must return before the job settles (REQ-102), and a
 *  test that awaits the schedule call itself would defeat the very property it exists to prove. */
const runInline = (job: () => Promise<void>): void => { void job(); };

function baseConfig(overrides: Partial<GraphAnalyzerConfig> = {}): GraphAnalyzerConfig {
  return {
    enabled: true, model: 'sonnet-5', systemPrompt: 'draw a diagram', tools: [],
    timeoutMs: 1000, retries: 0, maxBytes: 8192, maxLines: 120, maxQueueDepth: 8,
    ...overrides,
  };
}

function gatewayResolving(result: GatewayResult | (() => GatewayResult)): GatewayClient {
  return { invoke: async () => (typeof result === 'function' ? result() : result) };
}

function okResult(content: string): GatewayResult {
  return { ok: true, provider: 'anthropic', model: 'sonnet-5', tokens: { input: 10, output: 5 }, content };
}

let workRoot: string;
let catalog: WorkflowCatalog;
beforeEach(() => { workRoot = mkdtempSync(join(tmpdir(), 'rwe-analyzer-')); catalog = new WorkflowCatalog(workRoot, CLOCK); });
afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

async function settle(): Promise<void> {
  // Drains microtask/macrotask queues so a runInline-scheduled job (fire-and-forget) has settled
  // before the assertion reads the catalog row back.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('GraphAnalyzer.enqueue — never awaits the job (UT-111, DES-131, REQ-102)', () => {
  it('enqueue() returns BEFORE the job runs, having already written the pending row', async () => {
    await catalog.register('ga-a', `return 1;`);
    const gateway = gatewayResolving(okResult('╭─Draft─╮'));
    const analyzer = new GraphAnalyzer({
      gateway, catalog, ports: NO_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-a', 'v1', `export const meta = { phases: [{title:'Draft'}] };`, null);
    const row = await (catalog as any).getDiagram('ga-a', 'v1');
    expect(row?.status).toBe('pending');
  });
});

describe('GraphAnalyzer — the 8 persisted DiagramNoteCode values, each from its own literal input row (UT-111, DES-123)', () => {
  it('TIMEOUT — a gateway result {ok:false, reason:"timeout"}', async () => {
    await catalog.register('ga-timeout', `return 1;`);
    const analyzer = new GraphAnalyzer({
      gateway: gatewayResolving({ ok: false, provider: 'anthropic', reason: 'timeout' }),
      catalog, ports: NO_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-timeout', 'v1', `return 1;`, null);
    await settle();
    expect((await (catalog as any).getDiagram('ga-timeout', 'v1'))?.noteCode).toBe('TIMEOUT');
  });

  it('PROVIDER_UNREACHABLE — a gateway result {ok:false, reason:"unreachable"}', async () => {
    await catalog.register('ga-unreach', `return 1;`);
    const analyzer = new GraphAnalyzer({
      gateway: gatewayResolving({ ok: false, provider: 'anthropic', reason: 'unreachable' }),
      catalog, ports: NO_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-unreach', 'v1', `return 1;`, null);
    await settle();
    expect((await (catalog as any).getDiagram('ga-unreach', 'v1'))?.noteCode).toBe('PROVIDER_UNREACHABLE');
  });

  it('PROVIDER_ERROR — a gateway result {ok:false, reason:"terminal"}', async () => {
    await catalog.register('ga-terminal', `return 1;`);
    const analyzer = new GraphAnalyzer({
      gateway: gatewayResolving({ ok: false, provider: 'anthropic', reason: 'terminal', detail: 'provider 500' }),
      catalog, ports: NO_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-terminal', 'v1', `return 1;`, null);
    await settle();
    expect((await (catalog as any).getDiagram('ga-terminal', 'v1'))?.noteCode).toBe('PROVIDER_ERROR');
  });

  it('GATE_REJECTED_CONTENT — a completion whose token is not in the allowlist (a script-derived secret)', async () => {
    await catalog.register('ga-gatecontent', `return 1;`);
    const analyzer = new GraphAnalyzer({
      gateway: gatewayResolving(okResult('sk-live-abc123')),
      catalog, ports: NO_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-gatecontent', 'v1', `return 1;`, null);
    await settle();
    const row = await (catalog as any).getDiagram('ga-gatecontent', 'v1');
    expect(row?.noteCode).toBe('GATE_REJECTED_CONTENT');
    expect(row?.diagram).toBeNull();
  });

  it('GATE_REJECTED_SHAPE — an empty completion (unexpected 200-shape from the provider)', async () => {
    await catalog.register('ga-gateshape', `return 1;`);
    const analyzer = new GraphAnalyzer({
      gateway: gatewayResolving(okResult('')),
      catalog, ports: NO_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-gateshape', 'v1', `return 1;`, null);
    await settle();
    expect((await (catalog as any).getDiagram('ga-gateshape', 'v1'))?.noteCode).toBe('GATE_REJECTED_SHAPE');
  });

  it('QUEUE_FULL — a full queue (concurrency 1, maxQueueDepth 0) settles the SECOND enqueue as unavailable/QUEUE_FULL, honest absence not an error', async () => {
    await catalog.register('ga-q1', `return 1;`);
    await catalog.register('ga-q2', `return 1;`);
    let resolveFirst!: (r: GatewayResult) => void;
    const hung = new Promise<GatewayResult>((r) => { resolveFirst = r; });
    const analyzer = new GraphAnalyzer({
      gateway: { invoke: async () => hung },
      catalog, ports: NO_TRIGGERS, clock: CLOCK, config: baseConfig({ maxQueueDepth: 0 }), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-q1', 'v1', `return 1;`, null); // occupies the single in-flight slot
    await settle();
    analyzer.enqueue('ga-q2', 'v1', `return 1;`, null); // queue depth 0 -> refused immediately
    await settle();
    expect((await (catalog as any).getDiagram('ga-q2', 'v1'))?.noteCode).toBe('QUEUE_FULL');
    resolveFirst(okResult('╭─Draft─╮'));
    await settle();
  });

  it('RETRIES_EXHAUSTED — sweepAtBoot() settles a pending row STAMPED BEFORE the boot instant, with ZERO model calls', async () => {
    await catalog.register('ga-sweep-exhausted', `return 1;`);
    await (catalog as any).putDiagramPending('ga-sweep-exhausted', 'v1', '2026-09-01T00:00:00.000Z'); // stamped by a previous, now-dead process
    const invoke = vi.fn(async () => okResult('╭─Draft─╮'));
    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: NO_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.sweepAtBoot();
    await settle();
    const row = await (catalog as any).getDiagram('ga-sweep-exhausted', 'v1');
    expect(row?.noteCode).toBe('RETRIES_EXHAUSTED');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('MODEL_UNMAPPED — graphAnalyzer.model is not a known alias: enqueue short-circuits with ZERO model calls', async () => {
    await catalog.register('ga-unmapped', `return 1;`);
    const invoke = vi.fn(async () => okResult('╭─Draft─╮'));
    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig({ model: 'not-a-real-alias' }), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-unmapped', 'v1', `return 1;`, null);
    await settle();
    expect((await (catalog as any).getDiagram('ga-unmapped', 'v1'))?.noteCode).toBe('MODEL_UNMAPPED');
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('GraphAnalyzer — the retry loop is REAL, not a silent no-op (UT-111, DES-121)', () => {
  it('retries:2, every attempt fails -> EXACTLY 1+retries=3 invoke() calls, settling unavailable/RETRIES_EXHAUSTED', async () => {
    await catalog.register('ga-retry-count', `return 1;`);
    const invoke = vi.fn(async () => ({ ok: false, provider: 'anthropic', reason: 'unreachable' }) as GatewayResult);
    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig({ retries: 2 }), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-retry-count', 'v1', `return 1;`, null);
    await settle();
    // DES-121: AgentOpts has timeoutMs but NO retries field — retries are expressible ONLY as this
    // class's own loop count. If Gate 6 forwards `cfg.retries` into `opts` instead of looping, this
    // is a silent no-op (this repo's own recurring wiring-defect class) and `invoke` is called once.
    // The call count is the load-bearing assertion here (TASK-117's own dod: "exactly 1+retries
    // calls"); it is decoupled below from the noteCode question DES-121's prose leaves genuinely
    // ambiguous (every `GatewayResult{ok:false}` carries a specific `reason`, so it is unclear from
    // the design text alone whether a same-reason-every-attempt exhaustion persists the generic
    // RETRIES_EXHAUSTED or the last attempt's own specific code — Gate 6's implementer call, flagged
    // here rather than silently guessed at twice).
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it('the LAST attempt\'s specific reason (timeout) wins over the generic exhaustion code when it is ALSO the final attempt', async () => {
    await catalog.register('ga-retry-precedence', `return 1;`);
    let call = 0;
    const invoke = vi.fn(async () => {
      call++;
      return { ok: false, provider: 'anthropic', reason: call === 2 ? 'timeout' : 'unreachable' } as GatewayResult;
    });
    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig({ retries: 1 }), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-retry-precedence', 'v1', `return 1;`, null);
    await settle();
    expect(invoke).toHaveBeenCalledTimes(2); // 1 + retries(1)
    const row = await (catalog as any).getDiagram('ga-retry-precedence', 'v1');
    expect(row?.noteCode).toBe('TIMEOUT'); // the LAST attempt's own reason, not a generic RETRIES_EXHAUSTED
  });
});

describe('GraphAnalyzer — success path (UT-111, DES-124/131)', () => {
  it('a gate-passing completion settles status:"ready" with the diagram stored verbatim', async () => {
    await catalog.register('ga-ready', `export const meta = { phases: [{title:'Draft'}] };\nreturn 1;`);
    const analyzer = new GraphAnalyzer({
      gateway: gatewayResolving(okResult('╭─Draft─╮')),
      catalog, ports: NO_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-ready', 'v1', `export const meta = { phases: [{title:'Draft'}] };\nreturn 1;`, null);
    await settle();
    const row = await (catalog as any).getDiagram('ga-ready', 'v1');
    expect(row?.status).toBe('ready');
    expect(row?.diagram).toBe('╭─Draft─╮');
  });
});

describe('GraphAnalyzer — the live trigger snapshot joins the diagram allowlist (UT-111, DES-128/131, Gate 6.5+7 coverage gate)', () => {
  // Written at Gate 6.5+7: `_buildAllowlist`'s `for (const b of bindings)` arm had ZERO coverage —
  // every existing case ran with NO_TRIGGERS, so a diagram naming a real trigger kind or a real
  // chain-upstream workflow was never gate-checked. That arm is the reason DES-128's snapshot is
  // fed to the analyzer at all, and it is a SECURITY-shaped arm: too narrow and every live-trigger
  // diagram is rejected; the same code path is what decides which strings a model may echo back.
  const LIVE_TRIGGERS: TriggerPorts = {
    schedules: { listByWorkflow: () => [{ cron: '0 9 * * *', tz: 'UTC', enabled: true }] },
    webhooks: { listByWorkflow: () => [{ enabled: true }] },
    continuations: { listPendingByWorkflow: () => [{ afterRunId: 'run-upstream' }] },
    runs: { getWorkflowName: (runId) => (runId === 'run-upstream' ? 'upstream-wf' : null) },
  };

  it('a diagram naming the live binding kinds AND the chain upstream workflow passes the gate', async () => {
    const script = `export const meta = { phases: [{title:'Draft'}] };\nreturn 1;`;
    await catalog.register('ga-bindings-ok', script);
    const analyzer = new GraphAnalyzer({
      gateway: gatewayResolving(okResult('cron webhook chain upstream-wf ╭─Draft─╮')),
      catalog, ports: LIVE_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-bindings-ok', 'v1', script, null);
    await settle();
    const row = await (catalog as any).getDiagram('ga-bindings-ok', 'v1');
    expect(row?.status).toBe('ready');
    expect(row?.diagram).toBe('cron webhook chain upstream-wf ╭─Draft─╮');
  });

  it('a workflow name that is NOT this snapshot\'s upstream is still refused GATE_REJECTED_CONTENT', async () => {
    // The allowlist widens by exactly the live upstream name and no further — a model that invents
    // a neighbouring workflow name is still refused, which is what makes the widening safe.
    const script = `export const meta = { phases: [{title:'Draft'}] };\nreturn 1;`;
    await catalog.register('ga-bindings-strict', script);
    const analyzer = new GraphAnalyzer({
      gateway: gatewayResolving(okResult('chain some-other-wf')),
      catalog, ports: LIVE_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-bindings-strict', 'v1', script, null);
    await settle();
    const row = await (catalog as any).getDiagram('ga-bindings-strict', 'v1');
    expect(row?.status).toBe('unavailable');
    expect(row?.noteCode).toBe('GATE_REJECTED_CONTENT');
  });

  it('an UNNAMED chain upstream (purged run) adds no label — a null is never stringified into the allowlist', async () => {
    const script = `export const meta = { phases: [{title:'Draft'}] };\nreturn 1;`;
    await catalog.register('ga-bindings-null', script);
    const PURGED: TriggerPorts = { ...LIVE_TRIGGERS, runs: { getWorkflowName: () => null } };
    const analyzer = new GraphAnalyzer({
      gateway: gatewayResolving(okResult('null')),
      catalog, ports: PURGED, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-bindings-null', 'v1', script, null);
    await settle();
    const row = await (catalog as any).getDiagram('ga-bindings-null', 'v1');
    expect(row?.noteCode).toBe('GATE_REJECTED_CONTENT');
  });
});

describe('GraphAnalyzer.regenerate — single-flight + no-clobber (UT-111, DES-127 B4/B5)', () => {
  it('a second regenerate() while the row is still "pending" enqueues NO second job', async () => {
    await catalog.register('ga-inflight', `return 1;`);
    let calls = 0;
    const hung = new Promise<GatewayResult>(() => {}); // never resolves within this test
    const analyzer = new GraphAnalyzer({
      gateway: { invoke: async () => { calls++; return hung; } },
      catalog, ports: NO_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-inflight', 'v1', `return 1;`, null);
    await settle();
    const second = analyzer.regenerate('ga-inflight', 'v1', null);
    expect(second).toEqual({ queued: false, status: 'pending' });
    expect(calls).toBe(1);
  });

  it('a FAILED regenerate leaves a prior "ready" row untouched (only success overwrites)', async () => {
    await catalog.register('ga-preserve', `return 1;`);
    await (catalog as any).putDiagramResult('ga-preserve', 'v1', {
      status: 'ready', diagram: '╭─OldDiagram─╮', generatedAt: '2026-09-01T00:00:00.000Z', bindingsFp: 'fp-old',
    });
    const analyzer = new GraphAnalyzer({
      gateway: gatewayResolving({ ok: false, provider: 'anthropic', reason: 'timeout' }),
      catalog, ports: NO_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.regenerate('ga-preserve', 'v1', 'owner@example.com');
    await settle();
    const row = await (catalog as any).getDiagram('ga-preserve', 'v1');
    expect(row?.status).toBe('ready');
    expect(row?.diagram).toBe('╭─OldDiagram─╮');
  });
});

describe('GraphAnalyzer.sweepAtBoot — the three row shapes (UT-111, DES-131, DES-127 B7)', () => {
  it('unstamped pending (generated_at IS NULL) -> requeue once AND stamp clock.now() via putDiagramPending', async () => {
    // The script MUST declare the phase the stubbed completion draws, or `_buildAllowlist` will not
    // contain 'Draft' and `gateDiagram` correctly rejects it -> status 'unavailable', never 'ready'.
    // (The success case at :222 already registers exactly this shape; this fixture had `return 1;`
    // and was red for that reason alone. The gate was right; the fixture was wrong. Do NOT "fix"
    // this by loosening the label gate — it is what stops an analyzer summary leaking script text
    // to principals REQ-100 forbids from reading the script.)
    await catalog.register('ga-sweep-unstamped', `export const meta = { phases: [{title:'Draft'}] };\nreturn 1;`);
    await (catalog as any).putDiagramPending('ga-sweep-unstamped', 'v1'); // never stamped — a crash mid-generation
    const invoke = vi.fn(async () => okResult('╭─Draft─╮'));
    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: NO_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.sweepAtBoot();
    await settle();
    expect(invoke).toHaveBeenCalledTimes(1); // exactly one requeue
    const row = await (catalog as any).getDiagram('ga-sweep-unstamped', 'v1');
    expect(row?.status).toBe('ready');
  });

  it('pending stamped AT/AFTER the boot instant -> a live job in THIS process, left alone (no requeue, no settle)', async () => {
    await catalog.register('ga-sweep-live', `return 1;`);
    await (catalog as any).putDiagramPending('ga-sweep-live', 'v1', '2026-09-02T10:00:00.000Z'); // == boot instant
    const invoke = vi.fn(async () => okResult('╭─Draft─╮'));
    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: NO_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.sweepAtBoot();
    await settle();
    expect(invoke).not.toHaveBeenCalled();
    const row = await (catalog as any).getDiagram('ga-sweep-live', 'v1');
    expect(row?.status).toBe('pending');
  });
});

describe('GraphAnalyzer — journal line never carries provider/model text (UT-111, DES-129, ADR-016)', () => {
  it('a provider error whose message contains the secret literal produces an emitted journal STRING that does NOT contain it', async () => {
    await catalog.register('ga-journal', `return 1;`);
    const secret = 'sk-live-verySecretToken9F2A';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const analyzer = new GraphAnalyzer({
      gateway: { invoke: async () => { throw new Error(`upstream 500: request body contained ${secret}`); } },
      catalog, ports: NO_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-journal', 'v1', `return 1;`, null);
    await settle();
    const emitted = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(emitted).not.toContain(secret);
    logSpy.mockRestore();
  });
});

// UT-119 (v23 orchestrator adjudication #6, V-1 — REQ-103, DES-131, DES-128, ARCH-078/079): the
// bindings ARE computed (`getTriggerBindings` at graph-analyzer.ts:297) and already reach
// `_buildAllowlist`, but never reach the PROMPT itself (`:299` builds it from
// `systemPrompt + script` only). Proven live by the validator: the identical `(name,version)`
// analyzed with and without a live cron binding reported the IDENTICAL `promptTokens:297` both
// times. This is the specific defect 04-design.md's REQ-103 validation row silently dropped with
// no adjudication recording the narrowing — adjudication #6 rules it back in.
//
// Red reason: `_runJob` builds `prompt` with no binding text in it — verified by reading
// `graph-analyzer.ts:299` before writing these assertions, not assumed.
describe('GraphAnalyzer — the analyzer prompt itself must carry the live trigger bindings (UT-119, DES-131, DES-128, ARCH-078, ARCH-079, REQ-103)', () => {
  const CRON_EXPR = '*/5 * * * *';
  const UPSTREAM_NAME = 'upstream-flow';

  function cronBoundPorts(): TriggerPorts {
    return {
      schedules: { listByWorkflow: () => [{ cron: CRON_EXPR, enabled: true }] },
      webhooks: { listByWorkflow: () => [] },
      continuations: { listPendingByWorkflow: () => [] },
      runs: { getWorkflowName: () => null },
    };
  }

  function chainBoundPorts(): TriggerPorts {
    return {
      schedules: { listByWorkflow: () => [] },
      webhooks: { listByWorkflow: () => [] },
      continuations: { listPendingByWorkflow: () => [{ afterRunId: 'run-1' }] },
      runs: { getWorkflowName: (runId: string) => (runId === 'run-1' ? UPSTREAM_NAME : null) },
    };
  }

  it('a live cron binding makes the prompt sent to the gateway DIFFERENT from the identical script with no binding, and names the cron expression', async () => {
    const script = `return 1;`;
    await catalog.register('ga-trig-cron', script); // v1: no trigger bound
    await catalog.register('ga-trig-cron', script); // v2: same script, now cron-bound

    const capturedPrompts: string[] = [];
    const gateway: GatewayClient = {
      invoke: async (req) => { capturedPrompts.push(req.prompt); return okResult('╭─Draft─╮'); },
    };

    const unbound = new GraphAnalyzer({
      gateway, catalog, ports: NO_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    unbound.enqueue('ga-trig-cron', 'v1', script, null);
    await settle();

    const bound = new GraphAnalyzer({
      gateway, catalog, ports: cronBoundPorts(), clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    bound.enqueue('ga-trig-cron', 'v2', script, null);
    await settle();

    expect(capturedPrompts).toHaveLength(2);
    // TODAY these are byte-identical (the validator's own live oracle: identical promptTokens with
    // and without a cron binding) — this is the exact bug adjudication #6 orders fixed.
    expect(capturedPrompts[1]).not.toBe(capturedPrompts[0]);
    expect(capturedPrompts[1]).toContain(CRON_EXPR);
  });

  it('a live chain binding names the upstream workflow in the prompt', async () => {
    const script = `return 1;`;
    await catalog.register('ga-trig-chain', script);

    const capturedPrompts: string[] = [];
    const gateway: GatewayClient = {
      invoke: async (req) => { capturedPrompts.push(req.prompt); return okResult('╭─Draft─╮'); },
    };
    const analyzer = new GraphAnalyzer({
      gateway, catalog, ports: chainBoundPorts(), clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-trig-chain', 'v1', script, null);
    await settle();

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toContain(UPSTREAM_NAME);
  });
});

// UT-123 (v23 orchestrator adjudication #7 — REQ-103): the engine must not instruct a token its own
// gate rejects. `describeTriggerBindings` tells the model to label an UNBOUND workflow's entry node
// `workflow_run`, and the shipped default systemPrompt says the same — so an OBEDIENT model's output
// must survive `gateDiagram`. Gate 7.5 found this live: every workflow is unbound at v1 (schedule
// and webhook creation are both refused CHANNEL_UNPUBLISHED before publish), so an obedient model
// lost EVERY first diagram.
//
// Red reason before the fix: `_buildAllowlist` added only 'default' and 'model:param' as
// engine-authored sentinels — verified by reading graph-analyzer.ts:225-240, not assumed.
describe('GraphAnalyzer — an obedient unbound diagram survives the gate (UT-123, adjudication #7, REQ-103)', () => {
  it('a diagram labelling the entry node `workflow_run` on an UNBOUND workflow settles ready, not gate-rejected', async () => {
    const script = `return 1;`;
    await catalog.register('ga-unbound-obedient', script);
    const analyzer = new GraphAnalyzer({
      gateway: gatewayResolving(okResult('╭─workflow_run─╮')),
      catalog, ports: NO_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-unbound-obedient', 'v1', script, null);
    await settle();
    const row = await (catalog as any).getDiagram('ga-unbound-obedient', 'v1');
    // The oracle is the ENGINE'S OWN INSTRUCTION (describeTriggerBindings + the shipped
    // systemPrompt both say `workflow_run`), not whatever the allowlist happens to contain.
    expect(row?.status).toBe('ready');
    expect(row?.diagram).toBe('╭─workflow_run─╮');
  });
});

// UT-128 (v23 Gate 8 send-back's ARCH-079 inv 5 amendment, Gate-2-re-run `d294880`): "exactly one
// journal line is emitted per SETTLE, on every path that writes a terminal `workflow_diagrams` row"
// — not just per model-call attempt. Verified against primary source: `grep -n "console.log"
// src/graph-analyzer.ts` returns exactly ONE hit, inside `_attempt` — so `_settleUnavailable` and the
// boot-sweep's zero-call settle branch persist a terminal row and log NOTHING. Two settle paths
// therefore have no operator-visible signal at all today: MODEL_UNMAPPED and the boot-sweep
// zero-call settle (QUEUE_FULL below is the third — the same `_settleUnavailable` call site).
// `MODEL_UNMAPPED` is this repo's own recurring `composeConfig`-forwarding-gap signature (v11/v15/
// v16) settling per workflow, forever, invisibly — the exact class this invariant exists to make
// loud.
//
// Scope note, two items deliberately NOT encoded here: (1) the amendment's V-C falsifiability case
// ("a throwing `putDiagramResult` must still produce exactly one journal line") exercises the
// try/finally SHAPE Gate 6 has not written yet, so pinning it now would test a mechanism rather than
// a requirement; (2) the new `enabled:false` guard settle (UT-124, A2) is NOT independently testable
// for the journal-line count YET — today, with no guard, `enqueue()` on a disabled config still
// reaches `_attempt` for real, which already logs once (unconditionally), so a pre-fix assertion on
// that path cannot be red for the RIGHT reason (it would be red or green by accident of the crash
// timing, not by the invariant). Both are named debt for a Gate 6.5+7 coverage-gate addition once
// A2's guard exists (same convention as UT-122's own not-yet-reachable-branch precedent), not
// silently dropped.
//
// Mock policy (unit, DES-119): a `console.log` spy (same convention as UT-111's own journal-line
// assertion).
//
// Red reason (verified against graph-analyzer.ts before writing): neither settle path below calls
// `console.log` today.
describe('GraphAnalyzer — exactly one journal line per SETTLE, even with zero model calls (UT-128, ARCH-079 inv 5)', () => {
  it('MODEL_UNMAPPED settle emits exactly one journal line', async () => {
    await catalog.register('ga-journal-unmapped', `return 1;`);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const analyzer = new GraphAnalyzer({
      gateway: { invoke: vi.fn() }, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig({ model: 'not-a-real-alias' }), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-journal-unmapped', 'v1', `return 1;`, null);
    await settle();
    expect(logSpy).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });

  it('QUEUE_FULL settle emits exactly one journal line', async () => {
    await catalog.register('ga-journal-q1', `return 1;`);
    await catalog.register('ga-journal-q2', `return 1;`);
    const hung = new Promise<GatewayResult>(() => {});
    const analyzer = new GraphAnalyzer({
      gateway: { invoke: async () => hung }, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig({ maxQueueDepth: 0 }), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-journal-q1', 'v1', `return 1;`, null); // occupies the slot, no settle yet
    await settle();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    analyzer.enqueue('ga-journal-q2', 'v1', `return 1;`, null); // refused immediately -> QUEUE_FULL settle
    await settle();
    expect(logSpy).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });

  // ADDED at v23 Gate 6.5+7 round 4 (verifier), closing the coverage debt this describe block's own
  // docblock names: "the new `enabled:false` guard settle (UT-124/A2) is deliberately NOT covered
  // here ... named as Gate 6.5+7 coverage debt once A2's guard exists, not silently dropped".
  // A2's guard now exists (IMPL-175), so the two settle paths it added are the two paths inv 5's
  // count was never asserted over. Both also pin `gateway.invoke` untouched, so a future "fix" that
  // restores the line by letting the disabled path reach `_attempt` cannot pass this.
  it('the DISABLED-guard settle in enqueue() emits exactly one journal line, with zero model calls', async () => {
    await catalog.register('ga-journal-disabled', `return 1;`);
    const invoke = vi.fn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig({ enabled: false }), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-journal-disabled', 'v1', `return 1;`, 'alice');
    await settle();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('the DISABLED-guard settle in sweepAtBoot() (never-stamped row) emits exactly one journal line, with zero model calls', async () => {
    await catalog.register('ga-journal-sweep-disabled', `return 1;`);
    // A never-stamped pending row: generatedAt === null — the branch that requeues when enabled.
    await (catalog as any).putDiagramPending('ga-journal-sweep-disabled', 'v1');
    const invoke = vi.fn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig({ enabled: false }), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.sweepAtBoot();
    await settle();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('the boot-sweep ZERO-CALL settle (stamped before the boot instant) emits exactly one journal line', async () => {
    await catalog.register('ga-journal-sweep-exhausted', `return 1;`);
    await (catalog as any).putDiagramPending('ga-journal-sweep-exhausted', 'v1', '2026-09-01T00:00:00.000Z');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const analyzer = new GraphAnalyzer({
      gateway: { invoke: vi.fn() }, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.sweepAtBoot();
    await settle();
    expect(logSpy).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });
});

// UT-124 (v23 Gate 2 re-run, send-back `d294880`, A2 ≡ quality SUS-1 HIGH ≡ adversarial P2): NO
// `GraphAnalyzer` code path may reach `this._gateway` when `config.enabled === false` — verified
// (ARCH-079 inv 11) across all THREE callers of `_startJob`: `enqueue`, `sweepAtBoot`, `regenerate`.
// `enabled:false` is the operator's only documented script-egress control (DEPLOY §1b); today
// nothing in `enqueue`/`sweepAtBoot`/`regenerate` reads `this._config.enabled` at all (confirmed by
// direct read of graph-analyzer.ts), so the script still ships to the provider with the knob off.
//
// Red reason (measured, pre-fix): `npx vitest run tests/unit/graph-analyzer.test.ts -t 'UT-124'`
// fails 4/4 — three on the spied `gateway.invoke`'s `not.toHaveBeenCalled()` assertion
// (`enqueue`/`sweepAtBoot`/`regenerate` all reach it with `config.enabled:false`), one (the
// prior-ready clobber case) on the row-stays-ready assertion instead (`putDiagramPending`'s
// `ON CONFLICT ... SET diagram=NULL` runs unconditionally, ahead of any guard).
//
// Deliberately NOT asserted: which persisted `noteCode` the disabled-guard settle uses — the
// architecture leaves that unpinned (V-D's read-layer DISABLED override makes it moot for the
// user-facing text), so pinning one here would over-specify Gate 6's implementation.
describe('GraphAnalyzer — the enabled:false guard, all three entry points (UT-124, ARCH-079 inv 11, A2)', () => {
  it('enqueue(): the gateway is never invoked; the row settles (does not stay pending forever)', async () => {
    await catalog.register('ga-disabled-enqueue', `return 1;`);
    const invoke = vi.fn(async () => okResult('╭─Draft─╮'));
    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig({ enabled: false }), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-disabled-enqueue', 'v1', `return 1;`, null);
    await settle();
    expect(invoke).not.toHaveBeenCalled();
    const row = await (catalog as any).getDiagram('ga-disabled-enqueue', 'v1');
    expect(row?.status).not.toBe('pending');
  });

  // Gate-2-re-run's own text on inv 11: "the enqueue/regenerate row may be ready, so
  // _settleUnavailable's ready-check returns early and a prior good diagram survives" — that
  // property depends on the durable putDiagramPending() write moving BEHIND the guard, not just the
  // in-memory claim; a guard placed one level too deep would trade a known bug for a latent one.
  it('enqueue() with a PRIOR ready row leaves it untouched — the durable write must move BEHIND the guard, not just the in-memory claim', async () => {
    await catalog.register('ga-disabled-clobber', `return 1;`);
    await (catalog as any).putDiagramResult('ga-disabled-clobber', 'v1', {
      status: 'ready', diagram: '╭─PriorGood─╮', generatedAt: '2026-09-01T00:00:00.000Z', bindingsFp: 'fp-prior',
    });
    const invoke = vi.fn(async () => okResult('╭─Draft─╮'));
    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig({ enabled: false }), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-disabled-clobber', 'v1', `return 1;`, null);
    await settle();
    expect(invoke).not.toHaveBeenCalled();
    const row = await (catalog as any).getDiagram('ga-disabled-clobber', 'v1');
    // TODAY: putDiagramPending's ON CONFLICT unconditionally nulls diagram/status before the
    // (nonexistent) guard ever runs — this assertion is the red.
    expect(row?.status).toBe('ready');
    expect(row?.diagram).toBe('╭─PriorGood─╮');
  });

  it('sweepAtBoot(): a never-stamped pending row for a REGISTERED workflow does not reach the gateway on restart', async () => {
    await catalog.register('ga-disabled-sweep', `return 1;`);
    (catalog as any).putDiagramPending('ga-disabled-sweep', 'v1'); // never-stamped: generatedAt omitted -> NULL
    const invoke = vi.fn(async () => okResult('╭─Draft─╮'));
    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig({ enabled: false }), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.sweepAtBoot();
    await settle();
    expect(invoke).not.toHaveBeenCalled();
    const row = await (catalog as any).getDiagram('ga-disabled-sweep', 'v1');
    expect(row?.status).not.toBe('pending'); // nothing left stranded (QD Risk #5)
  });

  it('regenerate(): resolves the current script off the catalog but never reaches the gateway', async () => {
    await catalog.register('ga-disabled-regen', `return 1;`);
    const invoke = vi.fn(async () => okResult('╭─Draft─╮'));
    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig({ enabled: false }), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.regenerate('ga-disabled-regen', 'v1', null);
    await settle();
    expect(invoke).not.toHaveBeenCalled();
  });
});

// UT-125 (v23 Gate 2 re-run, send-back `d294880`, A3/N-1): a bound is a bound only if the claim
// (`_pendingKeys.add`) and the slot (`_runningCount++`) are released on EVERY exit path of the
// scheduled closure, including the one reachable throw: `scriptPromise` rejecting (an "orphan
// pending" row — `sweepAtBoot`'s never-stamped branch resolving a (name, version) that no longer
// exists in the catalog, e.g. a partially-seeded DB). Today's `_startJob` has no
// try/catch/finally around the scheduled closure, so on that rejection the closure never reaches
// `_runJob`'s own cleanup (`_pendingKeys.delete` / `_runningCount--` / queue drain at the tail of
// `_runJob`) and the slot leaks permanently — every future job for ANY (name, version) queues
// behind a running-count that never returns to 0.
//
// Mock policy note: `schedule` here is a TEST-SIDE seam (not the module's `runInline`) that
// captures any rejection from `job()` into `rejections` rather than letting it escape as an
// unhandled promise rejection (which would fail the whole file with a process-level error, not a
// clean assertion) — `rejections.length === 0` IS part of the invariant being proven ("the closure
// never rejects", A3's own stated fix shape).
//
// Red reason (measured, pre-fix): `rejections.length` is 1 (the orphan's `CatalogNotFoundError`
// escapes `job()` uncaught), `_runningCount` stays at 1 forever, and the third case's freshly
// enqueued valid job never runs (queued behind a slot that is never released) —
// `npx vitest run tests/unit/graph-analyzer.test.ts -t 'UT-125'` fails at assertion (1)
// (`rejections.length === 0`); vitest stops there, so (2)/(3) go unreached behind it, not
// independently confirmed red.
//
// **AMENDED v23 Gate 2 RE-RUN #2 (send-back `41e6382`), O3/inv 8 (quality QD-O4.2): this oracle was
// enumerated with THREE assertions — (a) no unhandled rejections, (b) the row settles, (c) the next
// enqueued job still runs — and this file shipped only (a) and (c), dropping (b). That is how a
// 33/33-green `graph-analyzer.test.ts` coexisted with an orphan row stuck `pending` forever (the
// row settling is a DIFFERENT thing from the slot/claim being released — a leaked slot release
// alone does not put the row itself into a terminal state, and nothing else in this file pinned
// it). Restored below as its own numbered assertion, per inv 8's new rule: an enumerated oracle
// satisfied only in part is a send-back item, not a judgement call.
//
// Red reason for the restored assertion (measured): today `_startJob`'s scheduled closure has no
// `catch` that settles the row on the `scriptPromise` rejection path — it only releases the claim/
// slot (once Gate 6 stops leaking them) — so `ga-orphan@v1` stays `status:'pending'` forever;
// `expect(row?.status).toBe('unavailable')` fails, `pending !== unavailable`.
describe('GraphAnalyzer — an orphan-pending row must not wedge the queue (UT-125, ARCH-079 A3/N-1)', () => {
  it('a rejecting scriptPromise (orphan pending row) still releases the claim and the slot, settles the row, and the next enqueued job still runs', async () => {
    // Orphan: a pending diagram row for a name NEVER registered (no FK on workflow_diagrams) —
    // sweepAtBoot's never-stamped branch will call catalog.resolve(), which rejects
    // CatalogNotFoundError for an unknown name, reproducing A3's "one reachable throw".
    (catalog as any).putDiagramPending('ga-orphan', 'v1');

    const rejections: unknown[] = [];
    const capturingSchedule = (job: () => Promise<void>): void => {
      void job().catch((e: unknown) => { rejections.push(e); });
    };
    const invoke = vi.fn(async () => okResult('╭─Draft─╮'));
    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: capturingSchedule,
    });

    analyzer.sweepAtBoot();
    await settle();

    // 1: the closure itself never rejects (A3's stated fix shape).
    expect(rejections).toHaveLength(0);
    // 2 (RESTORED, O3/inv 8): the row itself settles — it does not stay `pending` forever. The
    // orphan's script never resolved, so this is the `script_unresolved` shape of a zero-model-call
    // settle; the specific persisted noteCode is deliberately not pinned here (see UT-124's own
    // note on the same point), only that it is no longer `pending`.
    const orphanRow = await (catalog as any).getDiagram('ga-orphan', 'v1');
    expect(orphanRow?.status).toBe('unavailable');
    // 3: the claim and the slot are released, not stranded on the orphan key.
    expect((analyzer as any)._pendingKeys.has('ga-orphan@v1')).toBe(false);
    expect((analyzer as any)._runningCount).toBe(0);

    // 4: the next enqueued job (a genuinely valid, registered one) still runs to completion —
    // proving the queue is not wedged behind the leaked slot.
    // The follow-up script must DECLARE the phase its stub draws, or `_buildAllowlist` has no
    // 'Draft' and `gateDiagram` correctly refuses it -> 'unavailable', which would fail assertion
    // 4 for a reason that has nothing to do with the queue. Same fixture shape as UT-111 and the
    // success case at :222. (Assertions 1 and 3 — the claim and the slot — are what the ORIGINAL
    // A3/N-1 round proved; do not "fix" a red here by loosening the gate.)
    const afterScript = `export const meta = { phases: [{title:'Draft'}] };\nreturn 1;`;
    await catalog.register('ga-after-orphan', afterScript);
    analyzer.enqueue('ga-after-orphan', 'v1', afterScript, null);
    await settle();
    const row = await (catalog as any).getDiagram('ga-after-orphan', 'v1');
    expect(row?.status).toBe('ready');
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

// UT-129 (v23 Gate 2 RE-RUN #2, send-back `41e6382`, R-1/inv 2 — oracle O1): the closure-level
// try/catch/finally ARCH-079 inv 2 requires must also cover a throw from `ports.getTriggerBindings`
// — not just the `scriptPromise` await UT-125 exercises — because `_runJob` calls
// `getTriggerBindings(name, this._ports)` directly (`graph-analyzer.ts:355`, building the
// allowlist/prompt) OUTSIDE any try today. Every enumerated assertion (inv 8's own new rule):
// (a) zero unhandled rejections, (b) the row settles unavailable, (c) exactly one journal line,
// (d) the next enqueued job still runs, (e) `_runningCount === 0`.
//
// Fixture note: the injected `ports.schedules.listByWorkflow` throws ONCE, not permanently — the
// same `getTriggerBindings` call is reached a SECOND time by the settle path's own `bindingsFp`
// lookup once Gate 6 builds the closure wrap, and a permanently-throwing port would make the
// settle itself fail too (the different, dedicated `settle_failed` shape UT-132 exercises
// separately). One throw is what reproduces "a job that reaches `_runJob`" without also breaking
// the recovery this oracle exists to prove.
//
// Red reason (measured): today `_startJob`'s scheduled closure has no try/catch around the
// `_runJob` call — only around the `scriptPromise` await (UT-125's own scope) — so the thrown
// error escapes `job()` uncaught: `npx vitest run tests/unit/graph-analyzer.test.ts -t 'UT-129'`
// fails at assertion (a), `rejections.length` is 1 not 0; (b)-(e) go unreached behind it (same
// "vitest stops at the first failing expect" shape as UT-125).
describe('GraphAnalyzer — a throwing ports.getTriggerBindings inside _runJob must not wedge the queue (UT-129, ARCH-079 inv 2, oracle O1)', () => {
  it('one-shot throw from getTriggerBindings: zero unhandled rejections, the row settles unavailable, exactly one journal line, the next job still runs, and the slot is released', async () => {
    await catalog.register('ga-o1', `return 1;`);
    let bindingsCalls = 0;
    const throwOncePorts: TriggerPorts = {
      schedules: {
        listByWorkflow: (name: string) => {
          bindingsCalls++;
          if (bindingsCalls === 1) throw new Error('boom-bindings');
          return NO_TRIGGERS.schedules.listByWorkflow(name);
        },
      },
      webhooks: NO_TRIGGERS.webhooks,
      continuations: NO_TRIGGERS.continuations,
      runs: NO_TRIGGERS.runs,
    };

    const rejections: unknown[] = [];
    const capturingSchedule = (job: () => Promise<void>): void => {
      void job().catch((e: unknown) => { rejections.push(e); });
    };
    const invoke = vi.fn(async () => okResult('╭─Draft─╮'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: throwOncePorts, clock: CLOCK,
      config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: capturingSchedule,
    });

    analyzer.enqueue('ga-o1', 'v1', `return 1;`, null);
    await settle();

    // (a)
    expect(rejections).toHaveLength(0);
    // (b)
    const row = await (catalog as any).getDiagram('ga-o1', 'v1');
    expect(row?.status).toBe('unavailable');
    // (c) — exactly one line for THIS name (the spy is shared across the whole test).
    const linesForThis = logSpy.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('"name":"ga-o1"'));
    expect(linesForThis).toHaveLength(1);
    // (e)
    expect((analyzer as any)._runningCount).toBe(0);
    logSpy.mockRestore();

    // (d) — the next enqueued job (a genuinely valid, registered one) still runs to completion.
    const afterScript = `export const meta = { phases: [{title:'Draft'}] };\nreturn 1;`;
    await catalog.register('ga-after-o1', afterScript);
    analyzer.enqueue('ga-after-o1', 'v1', afterScript, null);
    await settle();
    const afterRow = await (catalog as any).getDiagram('ga-after-o1', 'v1');
    expect(afterRow?.status).toBe('ready');
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

// UT-130 (v23 Gate 2 RE-RUN #2, send-back `41e6382`, R-1/inv 2 — oracle O2): the SAME
// try/catch/finally must also cover `catalog.putDiagramResult` throwing on the terminal `ready`
// write (`_runJob:377` today) — inv 8's V-C case, named as debt in UT-128's own docblock and never
// picked up. Every enumerated assertion, "the same five" as O1 (02-architecture.md's own words).
//
// Fixture note: `putDiagramResult` throws on its FIRST call only (`vi.spyOn` +
// `mockImplementationOnce`, falling through to the real store on every later call) — a job that
// genuinely drew a diagram but could not PERSIST it must still leave the operator an honest
// `unavailable` row, not a silent crash and a forever-`pending` one. A PERMANENTLY throwing store
// is the different, dedicated `settle_failed` case (no row ever written, named debt out of O5's
// relational scope) exercised in UT-132.
//
// Red reason (measured): today `_runJob`'s ready branch calls `this._catalog.putDiagramResult(...)`
// with no try around it at all (`:377`), so the injected throw escapes `job()` uncaught exactly
// like O1 — `npx vitest run tests/unit/graph-analyzer.test.ts -t 'UT-130'` fails at assertion (a),
// `rejections.length` is 1 not 0.
describe('GraphAnalyzer — a throwing catalog.putDiagramResult on the ready branch must not wedge the queue (UT-130, ARCH-079 inv 2, oracle O2)', () => {
  it('one-shot throw from putDiagramResult(ready): zero unhandled rejections, the row settles unavailable, exactly one journal line, the next job still runs, and the slot is released', async () => {
    const draftScript = `export const meta = { phases: [{title:'Draft'}] };\nreturn 1;`;
    await catalog.register('ga-o2', draftScript);
    const writeSpy = vi.spyOn(catalog, 'putDiagramResult').mockImplementationOnce(() => { throw new Error('boom-write'); });

    const rejections: unknown[] = [];
    const capturingSchedule = (job: () => Promise<void>): void => {
      void job().catch((e: unknown) => { rejections.push(e); });
    };
    const invoke = vi.fn(async () => okResult('╭─Draft─╮'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: capturingSchedule,
    });

    analyzer.enqueue('ga-o2', 'v1', draftScript, null);
    await settle();

    // (a)
    expect(rejections).toHaveLength(0);
    // (b) — the diagram was drawn but the FIRST write attempt failed; the row must still settle
    // unavailable rather than being stuck pending forever with a lost result.
    const row = await (catalog as any).getDiagram('ga-o2', 'v1');
    expect(row?.status).toBe('unavailable');
    // (c)
    const linesForThis = logSpy.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('"name":"ga-o2"'));
    expect(linesForThis).toHaveLength(1);
    // (e)
    expect((analyzer as any)._runningCount).toBe(0);
    logSpy.mockRestore();
    writeSpy.mockRestore();

    // (d)
    const afterScript = `export const meta = { phases: [{title:'Draft'}] };\nreturn 1;`;
    await catalog.register('ga-after-o2', afterScript);
    analyzer.enqueue('ga-after-o2', 'v1', afterScript, null);
    await settle();
    const afterRow = await (catalog as any).getDiagram('ga-after-o2', 'v1');
    expect(afterRow?.status).toBe('ready');
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

// UT-131 (v23 Gate 2 RE-RUN #2, send-back `41e6382`, R-1/inv 2 FLOOR 2a — oracle O4): "a bound is a
// bound only if the claim and the slot are released on every exit path" — this is the burst that
// makes FLOOR 2a's release-idempotence floor falsifiable BEFORE Gate 6 writes the `finally`: one
// throwing job (the SAME `_runJob`-internal reachable throw as UT-129/O1 — the scriptPromise-reject
// path UT-125/O3 exercises is a DIFFERENT reachable throw that today's `_startJob` ALREADY wraps
// and releases, so it would not leak the slot here), then `maxQueueDepth + 3` valid, distinct,
// registered jobs. Two families of assertion: the FLOORS themselves (`_runningCount` never
// negative, never exceeds 1; concurrent `gateway.invoke()` calls never overlap) — both true TODAY,
// as green pins, precisely because nothing in today's code ever decrements `_runningCount` more
// than once per settle (the double-release failure mode FLOOR 2a exists to catch has no live
// instance yet; this test is the falsifier a future partial fix must survive) — and the DRAIN
// outcome, which is genuinely red today.
//
// Red reason (measured): the leaking job's throw escapes `_startJob`'s scheduled closure uncaught
// (no try/catch around the `_runJob` call today) — `_runningCount` never returns to 0, so the first
// `maxQueueDepth` (8) valid jobs queue behind it and never run: `npx vitest run
// tests/unit/graph-analyzer.test.ts -t 'UT-131'` fails on the first queued job's
// `row?.status === 'ready'` assertion (`pending` instead).
describe('GraphAnalyzer — slot-accounting floor over a mixed burst: one throwing job then maxQueueDepth+3 valid ones (UT-131, ARCH-079 inv 2 FLOOR 2a, oracle O4)', () => {
  it('_runningCount never negative and never exceeds 1, concurrent invoke() never overlaps, and every queued valid job eventually settles ready with the count drained to 0', async () => {
    // Throws ONLY for the leaking job's own name — the 11 valid jobs below must build their
    // allowlist/prompt normally once queued, or a future fix that stops the leak would still fail
    // this test for an unrelated reason (the same trap UT-129's own docblock names).
    const leakOnceForOneName: TriggerPorts = {
      schedules: {
        listByWorkflow: (name: string) => {
          if (name === 'ga-o4-leak') throw new Error('boom-leak');
          return NO_TRIGGERS.schedules.listByWorkflow(name);
        },
      },
      webhooks: NO_TRIGGERS.webhooks,
      continuations: NO_TRIGGERS.continuations,
      runs: NO_TRIGGERS.runs,
    };
    await catalog.register('ga-o4-leak', `return 1;`);

    // capturingSchedule (same as UT-125/UT-129's own convention): `job()`'s own rejection — the
    // leaking job's uncaught throw — must not escape as an unhandled process-level rejection and
    // fail this file with a process-level error rather than a clean assertion.
    const rejections: unknown[] = [];
    const capturingSchedule = (job: () => Promise<void>): void => {
      void job().catch((e: unknown) => { rejections.push(e); });
    };

    let inFlight = 0;
    let maxInFlight = 0;
    const invoke = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return okResult('╭─Draft─╮');
    });

    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: leakOnceForOneName, clock: CLOCK,
      config: baseConfig({ maxQueueDepth: 8 }), aliasNames: ALIAS_NAMES, schedule: capturingSchedule,
    });

    // Sample `_runningCount` at every settle this burst produces (every terminal `putDiagramResult`
    // write) — the FLOOR must hold at each one, not just at the end.
    const runningCountSamples: number[] = [];
    const originalPutDiagramResult = catalog.putDiagramResult.bind(catalog);
    const writeSpy = vi.spyOn(catalog, 'putDiagramResult').mockImplementation((...args: Parameters<typeof catalog.putDiagramResult>) => {
      runningCountSamples.push((analyzer as any)._runningCount);
      return (originalPutDiagramResult as any)(...args);
    });

    analyzer.enqueue('ga-o4-leak', 'v1', `return 1;`, null); // leaks the slot today (unwrapped `_runJob` throw)
    await settle();

    const validNames = Array.from({ length: 11 }, (_, i) => `ga-o4-valid-${i}`);
    const validScript = `export const meta = { phases: [{title:'Draft'}] };\nreturn 1;`;
    for (const name of validNames) { await catalog.register(name, `return 1;`); }
    for (const name of validNames) { analyzer.enqueue(name, 'v1', validScript, null); }
    await settle();
    await settle();
    await settle();

    // FLOOR (green pin today): the slot count never goes negative and never exceeds 1, at every
    // settle sampled (only the 3 QUEUE_FULL settles fire while the queue is wedged).
    expect(runningCountSamples.every((n) => n >= 0)).toBe(true);
    expect(runningCountSamples.every((n) => n <= 1)).toBe(true);
    // FLOOR (green pin today, becomes load-bearing once concurrency is real): invoke() never
    // overlaps itself.
    expect(maxInFlight).toBeLessThanOrEqual(1);

    // RED (measured): the first `maxQueueDepth` (8) valid jobs are queued behind the leaked slot
    // and never drain; `_runningCount` never returns to 0.
    for (const name of validNames.slice(0, 8)) {
      const row = await (catalog as any).getDiagram(name, 'v1');
      expect(row?.status).toBe('ready');
    }
    expect((analyzer as any)._runningCount).toBe(0);

    writeSpy.mockRestore();
  });
});

// UT-132 (v23 Gate 2 RE-RUN #2, send-back `41e6382`, R-2b, inv 5(f) — oracle O5): "the one [oracle]
// to keep if only one could be kept — for every path that writes a terminal row (all five, including
// the B5 restore), assert the journal line's `outcome` EQUALS the status of the row read back from
// the catalog." A RELATIONAL oracle (it compares two things the code produces, not a literal), so it
// cannot be satisfied by editing an expected value to match shipped behaviour — the v22 `val-107`/
// IT-080 test-drift class this ledger already named.
describe('GraphAnalyzer — the relational settle oracle O5: the journal line\'s outcome must equal the row it actually wrote (UT-132, ARCH-079 inv 5, oracle O5)', () => {
  it('B5 restore: the row is written ready (a good prior diagram is kept) but the ONLY journal line for this settle says unavailable — the store and the log disagree about one event', async () => {
    await catalog.register('ga-o5-b5', `return 1;`);
    const draftScript = `export const meta = { phases: [{title:'Draft'}] };\nreturn 1;`;
    // First pass: a real ready diagram, becoming the priorRow the B5 branch must protect.
    const firstAnalyzer = new GraphAnalyzer({
      gateway: gatewayResolving(okResult('╭─Draft─╮')), catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    firstAnalyzer.enqueue('ga-o5-b5', 'v1', draftScript, null);
    await settle();
    expect((await (catalog as any).getDiagram('ga-o5-b5', 'v1'))?.status).toBe('ready');

    // Second pass: every attempt fails at the provider, retries:0 -> exactly one failed attempt ->
    // the B5 branch restores the prior ready row instead of clobbering it.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const secondAnalyzer = new GraphAnalyzer({
      gateway: gatewayResolving({ ok: false, provider: 'anthropic', reason: 'unreachable' }),
      catalog, ports: NO_TRIGGERS, clock: CLOCK, config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    secondAnalyzer.enqueue('ga-o5-b5', 'v1', draftScript, null);
    await settle();

    const row = await (catalog as any).getDiagram('ga-o5-b5', 'v1');
    expect(row?.status).toBe('ready'); // the B5 protection itself already works today (green pin)
    const linesForThis = logSpy.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('"name":"ga-o5-b5"'));
    expect(linesForThis).toHaveLength(1); // the SECOND settle's own line (first pass's own line predates the spy)
    const parsed = JSON.parse(linesForThis[0].replace(/^.*graph-analyzer /, ''));
    // O5's relational oracle: the journal line's outcome must equal the row status just read back.
    expect(parsed.outcome).toBe(row?.status);
    logSpy.mockRestore();
  });
});

// UT-133 (v23 Gate 2 RE-RUN #2, send-back `41e6382`, R-2b(c) — inv 5's aggregation clause): "moving
// the emitter loses nothing" — a real multi-attempt retry loop (`retries:1`, both attempts fail)
// must still settle with EXACTLY one journal line, and the new `attempts` field must carry the
// count the move destroys ("the only information the move destroys"). Complements UT-128's own
// "exactly one line per SETTLE" oracle (already green, zero-model-call paths only): this is the
// REAL multi-attempt case UT-128's own docblock named as scope it deliberately did not cover.
//
// Red reason (measured): today's `_attempt` journals once PER ATTEMPT (`graph-analyzer.ts:339`),
// not once per settle — `npx vitest run tests/unit/graph-analyzer.test.ts -t 'UT-133'` fails at the
// line-count assertion, 2 lines not 1; the `attempts` field assertion (unreached behind it) is
// independently red too — the field does not exist in the emitted JSON at all yet.
describe('GraphAnalyzer — exactly one journal line per SETTLE across a real multi-attempt retry loop, plus the `attempts` field (UT-133, ARCH-079 inv 5(c))', () => {
  it('exactly one journal line per SETTLE even across a real multi-attempt retry loop (retries:1, both attempts fail) — today logs once PER ATTEMPT, and the new `attempts` field does not exist yet', async () => {
    await catalog.register('ga-o5-retries', `return 1;`);
    const invoke = vi.fn(async () => ({ ok: false, provider: 'anthropic', reason: 'unreachable' }) as GatewayResult);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig({ retries: 1 }), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-o5-retries', 'v1', `return 1;`, null);
    await settle();

    expect(invoke).toHaveBeenCalledTimes(2); // 1 + retries(1) — the retry loop is real (UT-111 precedent)
    const linesForThis = logSpy.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('"name":"ga-o5-retries"'));
    // RED: one line per SETTLE, not per attempt.
    expect(linesForThis).toHaveLength(1);
    const parsed = JSON.parse(linesForThis[0].replace(/^.*graph-analyzer /, ''));
    // RED: the twelfth field, carrying the only information moving the emitter destroys.
    expect(parsed.attempts).toBe(2);
    logSpy.mockRestore();
  });
});

// UT-134 (v23 Gate 2 RE-RUN #2, send-back `41e6382`, R-2b(b), inv 5): "Twelve fields, wire order
// pinned ... Gate 5 pins it with `expect(Object.keys(JSON.parse(line)).sort()).toEqual([…].sort())`
// — set equality, never `toContain`: a one-sided check lets a thirteenth field grow silently, the
// same A6 ruling one file away." A hand-written literal, never imported from source (IT-102's own
// convention one file away — the whole point is that the test does not compute its own oracle from
// the code under test).
//
// Red reason (measured): `npx vitest run tests/unit/graph-analyzer.test.ts -t 'UT-134'` — the
// emitted line has TEN keys today (`gateFail`'s own predecessor amendment already shipped it, per
// `graph-analyzer.ts:223-233`); `attempts` and `cause` do not exist, so the sorted-set comparison
// fails.
describe('GraphAnalyzer — the journal line is a TWELVE-key SET EQUALITY, wire order pinned (UT-134, v23 Gate 2 RE-RUN #2, R-2b(b))', () => {
  it('the 12-key wire format is a SET EQUALITY (name, version, principal, model, promptTokens, completionTokens, durationMs, outcome, noteCode, gateFail, attempts, cause), never a one-sided toContain', async () => {
    await catalog.register('ga-o5-keys', `return 1;`);
    const draftScript = `export const meta = { phases: [{title:'Draft'}] };\nreturn 1;`;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const analyzer = new GraphAnalyzer({
      gateway: gatewayResolving(okResult('╭─Draft─╮')), catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: runInline,
    });
    analyzer.enqueue('ga-o5-keys', 'v1', draftScript, null);
    await settle();
    const line = logSpy.mock.calls.map((c) => c.join(' ')).find((l) => l.includes('"name":"ga-o5-keys"'));
    logSpy.mockRestore();
    const parsed = JSON.parse((line ?? '').replace(/^.*graph-analyzer /, ''));
    const expectedKeys = [
      'name', 'version', 'principal', 'model', 'promptTokens', 'completionTokens', 'durationMs',
      'outcome', 'noteCode', 'gateFail', 'attempts', 'cause',
    ].sort();
    expect(Object.keys(parsed).sort()).toEqual(expectedKeys); // RED today: only 10 keys, no attempts/cause
  });
});

// UT-135 (v23 Gate 2 RE-RUN #2, send-back `41e6382`, R-2(d) — the `cause` VALUE domain, inv 5(d)'s
// table): "so Gate 5 asserts VALUES and not presence (the `RETRIES_EXHAUSTED` overload was accepted
// ON THE CONDITION that the distinct cause rides this field; `cause:null` on those paths would
// satisfy an `Object.keys` assertion and leave the overload exactly as opaque as before)." Five
// zero-model-call paths, each already reachable in today's code (only the `cause` FIELD is new):
// `disabled`, `boot_abandoned`, `model_unmapped`, `queue_full` (enqueue()/sweepAtBoot()'s existing
// zero-model-call settles), plus `script_unresolved` (the orphan-pending scriptPromise rejection
// UT-125/O3 also exercises — folded in here as its own case rather than a second file asserting the
// same setup, per this send-back's own inv 8 rule against duplicate coverage of one defect).
//
// Red reason (measured): `cause` does not exist anywhere in `src/graph-analyzer.ts` today (verified
// by the architecture synthesizer's own primary-source re-check) — every case below reads
// `parsed.cause === undefined`, never the expected literal; the `script_unresolved` case is
// ADDITIONALLY red for UT-125/O3's own reason (zero journal lines are emitted at all today, since
// the closure's throw escapes uncaught before any settle is attempted).
describe('GraphAnalyzer — the `cause` VALUE domain over the five zero-model-call settle paths (UT-135, ARCH-079 inv 5(d), R-2(d))', () => {
  it('cause value domain over the four zero-model-call settle paths already reachable today (disabled / boot_abandoned / model_unmapped / queue_full)', async () => {
    const cases: Array<{ name: string; cause: AnalyzerCause; setup: (a: GraphAnalyzer) => void; refusedName?: string }> = [
      {
        name: 'ga-o5-cause-disabled', cause: 'disabled',
        setup: (a) => { a.enqueue('ga-o5-cause-disabled', 'v1', `return 1;`, null); },
      },
      {
        name: 'ga-o5-cause-boot-abandoned', cause: 'boot_abandoned',
        setup: (a) => { a.sweepAtBoot(); },
      },
      {
        name: 'ga-o5-cause-model-unmapped', cause: 'model_unmapped',
        setup: (a) => { a.enqueue('ga-o5-cause-model-unmapped', 'v1', `return 1;`, null); },
      },
      {
        // Two DISTINCT names, mirroring UT-128's own established pattern (:533-548): enqueue()'s
        // single-flight guard (DES-127 B4) keys on (name, version) and no-ops a second call for the
        // SAME key before it ever reaches the queue-depth check, so the slot-occupying call and the
        // refused call must be different registered workflows.
        name: 'ga-o5-cause-queue-full', cause: 'queue_full', refusedName: 'ga-o5-cause-queue-full-2',
        setup: (a) => { a.enqueue('ga-o5-cause-queue-full', 'v1', `return 1;`, null); },
      },
    ];
    for (const c of cases) {
      await catalog.register(c.name, `return 1;`);
      if (c.refusedName) await catalog.register(c.refusedName, `return 1;`);
    }
    // boot_abandoned needs a pending row stamped by a DEAD (previous) process.
    (catalog as any).putDiagramPending('ga-o5-cause-boot-abandoned', 'v1', '2026-09-01T00:00:00.000Z');

    for (const c of cases) {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const isDisabled = c.cause === 'disabled';
      const isUnmapped = c.cause === 'model_unmapped';
      const isQueueFull = c.cause === 'queue_full';
      const gateway = isQueueFull
        ? { invoke: async () => new Promise<GatewayResult>(() => {}) } // never resolves -> occupies the slot
        : { invoke: vi.fn() };
      const analyzer = new GraphAnalyzer({
        gateway, catalog, ports: NO_TRIGGERS, clock: CLOCK,
        config: baseConfig({
          enabled: !isDisabled,
          model: isUnmapped ? 'not-a-real-alias' : 'sonnet-5',
          maxQueueDepth: isQueueFull ? 0 : 8,
        }),
        aliasNames: ALIAS_NAMES, schedule: runInline,
      });
      if (isQueueFull) {
        // Occupy the single slot with c.name first, then refuse a DIFFERENT registered name
        // (c.refusedName) -> QUEUE_FULL settle for that second name (see the case's own comment above).
        analyzer.enqueue(c.name, 'v1', `return 1;`, null);
        await settle();
        logSpy.mockClear();
        analyzer.enqueue(c.refusedName!, 'v1', `return 1;`, null);
      } else {
        c.setup(analyzer);
      }
      await settle();
      const targetName = isQueueFull ? c.refusedName! : c.name;
      const line = logSpy.mock.calls.map((call) => call.join(' ')).find((l) => l.includes(`"name":"${targetName}"`));
      logSpy.mockRestore();
      // RED for every case: `cause` does not exist in the emitted line at all yet.
      const parsed = JSON.parse((line ?? '{}').replace(/^.*graph-analyzer /, ''));
      expect(parsed.cause).toBe(c.cause);
    }
  });

  it('an orphan-pending row\'s scriptPromise rejection carries cause:"script_unresolved" once it settles (today it never settles at all — see UT-125)', async () => {
    (catalog as any).putDiagramPending('ga-o5-cause-orphan', 'v1');
    const rejections: unknown[] = [];
    const capturingSchedule = (job: () => Promise<void>): void => {
      void job().catch((e: unknown) => { rejections.push(e); });
    };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const analyzer = new GraphAnalyzer({
      gateway: { invoke: vi.fn() }, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: capturingSchedule,
    });
    analyzer.sweepAtBoot();
    await settle();
    const linesForThis = logSpy.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('"name":"ga-o5-cause-orphan"'));
    logSpy.mockRestore();
    // RED (today, for the SAME reason as UT-125's restored assertion): zero lines at all, because
    // the closure's own throw escapes uncaught before any settle is even attempted.
    expect(linesForThis).toHaveLength(1);
    const parsed = JSON.parse(linesForThis[0].replace(/^.*graph-analyzer /, ''));
    expect(parsed.cause).toBe('script_unresolved');
    void rejections; // captured only so this schedule matches UT-125's own convention; not re-asserted here
  });
});

// UT-136 (v23 Gate 2 RE-RUN #2, send-back `41e6382`, R-2(d) + O5's own carve-out — FLOOR 2b / V-F):
// "a failed settle → `'settle_failed'`, NO ROW WRITTEN ... `settle_failed` is explicitly OUT of O5's
// scope and takes its own case (no row is written, the row stays `pending`, exactly one line with
// `cause:'settle_failed'`) — stated here because an unscoped O5 would either be weakened by Gate 5
// or file a false defect." Named debt, not smuggled: a PERMANENTLY throwing store (every
// `putDiagramResult` call fails, not just the first attempted write) is genuinely different from
// UT-130/O2's one-shot fixture (whose recovery write succeeds) — this is the case where the
// RECOVERY itself has nothing left to try.
//
// Red reason (measured): today `_runJob`'s (and `_settleUnavailable`'s) write call has no `try`
// around it at all, so the injected permanent throw escapes `job()` uncaught — same failure shape as
// O1/O2: `npx vitest run tests/unit/graph-analyzer.test.ts -t 'UT-136'` fails at the
// zero-unhandled-rejections assertion, `rejections.length` is 1 not 0.
describe('GraphAnalyzer — settle_failed: a permanently-failing store, O5\'s own carve-out (UT-136, ARCH-079 inv 2 FLOOR 2b / V-F)', () => {
  it('settle_failed: a permanently-failing store writes NO row, releases the slot anyway, and logs exactly one line with cause:"settle_failed"', async () => {
    const draftScript = `export const meta = { phases: [{title:'Draft'}] };\nreturn 1;`;
    await catalog.register('ga-o5-settle-failed', draftScript);
    const writeSpy = vi.spyOn(catalog, 'putDiagramResult').mockImplementation(() => { throw new Error('boom-permanent'); });
    const rejections: unknown[] = [];
    const capturingSchedule = (job: () => Promise<void>): void => {
      void job().catch((e: unknown) => { rejections.push(e); });
    };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const invoke = vi.fn(async () => okResult('╭─Draft─╮'));
    const analyzer = new GraphAnalyzer({
      gateway: { invoke }, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: baseConfig(), aliasNames: ALIAS_NAMES, schedule: capturingSchedule,
    });
    analyzer.enqueue('ga-o5-settle-failed', 'v1', draftScript, null);
    await settle();

    expect(rejections).toHaveLength(0); // RED today: the write's throw escapes job() uncaught
    const row = await (catalog as any).getDiagram('ga-o5-settle-failed', 'v1');
    expect(row?.status).toBe('pending'); // no row is EVER written on this path — left pending on purpose
    const linesForThis = logSpy.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('"name":"ga-o5-settle-failed"'));
    expect(linesForThis).toHaveLength(1);
    const parsed = JSON.parse(linesForThis[0].replace(/^.*graph-analyzer /, ''));
    expect(parsed.cause).toBe('settle_failed');
    expect((analyzer as any)._runningCount).toBe(0); // the finally still releases
    logSpy.mockRestore();
    writeSpy.mockRestore();
  });
});

// UT-137 (v23 Gate 2 RE-RUN #2, send-back `41e6382`, R-2(d) — the type-level closed-union check):
// Type-level, compile-time-only (same convention as trigger-bindings.test.ts's DES-128 case):
// `AnalyzerCause` must be a CLOSED UNION of engine-authored literals, never `string` — ADR-016's
// "engine-classified class, never raw provider/model text" must be a compile error, not a matter
// of care (a provider error payload can echo the request, and the request carries the masked
// script). Vitest itself shows this trivially green (esbuild strips the type-only import and the
// `@ts-expect-error` comment regardless of whether the annotation type-checks) — the real
// enforcement is `npx tsc --noEmit`.
//
// Red reason (measured via `npx tsc --noEmit`, NOT vitest — confirmed by direct run): TWO errors
// today, both from the same root cause (the type does not exist yet): TS2305 "Module
// '../../src/graph-analyzer.js' has no exported member 'AnalyzerCause'" on the type-only import at
// the top of this file, AND TS2578 "Unused '@ts-expect-error' directive" on the assignment below
// (an unresolvable type suppresses the assignability check the comment expects to suppress, so the
// directive itself has nothing to catch — a DIFFERENT reason than the one it is written for). Once
// Gate 6 exports the closed union, TS2305 disappears and the `@ts-expect-error` starts doing its
// real, INTENDED job: if `AnalyzerCause` ever widens to include `string`, tsc reports the
// assignment as NOT an error and TS2578 fires again — red for the opposite (regression) reason.
describe('GraphAnalyzer — AnalyzerCause is a closed union, never string (UT-137, ARCH-079 inv 5(d)/R-2)', () => {
  it('AnalyzerCause is a closed union, never string (ARCH-079 inv 5(d)/R-2) — compile-time only, see docblock', () => {
    // @ts-expect-error — AnalyzerCause must reject an arbitrary string; if this ever type-checks,
    // ADR-016's "never raw provider/model text" invariant has regressed to a runtime-only convention.
    const bad: AnalyzerCause = 'anything the provider echoed';
    expect(bad).toBeDefined();
  });
});
