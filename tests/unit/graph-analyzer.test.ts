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
describe('GraphAnalyzer — an orphan-pending row must not wedge the queue (UT-125, ARCH-079 A3/N-1)', () => {
  it('a rejecting scriptPromise (orphan pending row) still releases the claim and the slot, and the next enqueued job still runs', async () => {
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
    // 2: the claim and the slot are released, not stranded on the orphan key.
    expect((analyzer as any)._pendingKeys.has('ga-orphan@v1')).toBe(false);
    expect((analyzer as any)._runningCount).toBe(0);

    // 3: the next enqueued job (a genuinely valid, registered one) still runs to completion —
    // proving the queue is not wedged behind the leaked slot.
    // The follow-up script must DECLARE the phase its stub draws, or `_buildAllowlist` has no
    // 'Draft' and `gateDiagram` correctly refuses it -> 'unavailable', which would fail assertion
    // 3 for a reason that has nothing to do with the queue. Same fixture shape as UT-111 and the
    // success case at :222. (Assertions 1 and 2 — the claim and the slot — are what this test
    // exists to prove, and they pass; do not "fix" a red here by loosening the gate.)
    const afterScript = `export const meta = { phases: [{title:'Draft'}] };\nreturn 1;`;
    await catalog.register('ga-after-orphan', afterScript);
    analyzer.enqueue('ga-after-orphan', 'v1', afterScript, null);
    await settle();
    const row = await (catalog as any).getDiagram('ga-after-orphan', 'v1');
    expect(row?.status).toBe('ready');
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
