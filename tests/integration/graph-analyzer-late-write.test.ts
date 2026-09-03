// IT-096 (TASK-117, DES-130 late-write guard, DES-127 B6): a diagram job that settles AFTER its
// workflow was deregistered writes NOTHING (no orphan row) — `putDiagramResult` runs inside a
// `db.transaction()` and writes only where a `workflow_versions` row for `(name, version)` still
// exists.
//
// Deliberately on the REAL `setImmediate` path (NOT `schedule: runInline`) — the whole point of this
// test is the RACE between an in-flight async job and a synchronous `deregister()` that lands while
// the job is still awaiting the gateway. A `runInline`-seamed test cannot exercise this race at all
// (per TASK-117's own dod note: "a later 'make the suite faster' pass must not seam it").
//
// Mock policy (integration, DES-119): a REAL `WorkflowCatalog` (real on-disk sqlite), a stub
// `GatewayClient` (the only network-shaped dependency — never mocked at unit tier only), the
// PRODUCTION default `schedule` (`setImmediate`, i.e. omitted from the constructor deps).
//
// Red reason: `src/graph-analyzer.ts` does not exist yet -> MODULE NOT FOUND at collect time.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { GraphAnalyzer } from '../../src/graph-analyzer.js';
import type { GatewayResult } from '../../src/gateway/client.js';
import type { TriggerPorts } from '../../src/trigger-bindings.js';

const CLOCK = new FixedClock(new Date('2026-09-02T10:00:00.000Z'));
const NO_TRIGGERS: TriggerPorts = {
  schedules: { listByWorkflow: () => [] },
  webhooks: { listByWorkflow: () => [] },
  continuations: { listPendingByWorkflow: () => [] },
  runs: { getWorkflowName: () => null },
};

let workRoot: string;
let catalog: WorkflowCatalog;
beforeEach(() => { workRoot = mkdtempSync(join(tmpdir(), 'rwe-it096-')); catalog = new WorkflowCatalog(workRoot, CLOCK); });
afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

describe('the late write: enqueue -> deregister commits -> putDiagramResult lands (IT-096, DES-130, DES-127 B6)', () => {
  it('getDiagram() is null and the row count is 0 after the job settles on a deregistered workflow', async () => {
    await catalog.register('late-write-wf', `return 1;`);
    let releaseGateway!: (r: GatewayResult) => void;
    const gatewayDone = new Promise<GatewayResult>((r) => { releaseGateway = r; });
    const analyzer = new GraphAnalyzer({
      gateway: { invoke: async () => gatewayDone },
      catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: { enabled: true, model: 'sonnet-5', systemPrompt: 'draw', tools: [], timeoutMs: 5000, retries: 0, maxBytes: 8192, maxLines: 120, maxQueueDepth: 8 },
      aliasNames: new Set(['sonnet-5']),
      // schedule omitted -> production default (setImmediate) — the real async race this test exists for.
    });

    analyzer.enqueue('late-write-wf', 'v1', `return 1;`, null);
    // Let the real setImmediate-scheduled job START (reach its awaited gateway call) before deregistering.
    await new Promise((r) => setImmediate(r));
    await catalog.deregister('late-write-wf'); // commits WHILE the analyzer job is still in flight

    releaseGateway({ ok: true, provider: 'anthropic', model: 'sonnet-5', tokens: { input: 1, output: 1 }, content: '╭─Draft─╮' });
    // Drain past the job's own .then/putDiagramResult continuation.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const row = await (catalog as any).getDiagram('late-write-wf', 'v1');
    expect(row).toBeNull();
    const count = (catalog as any)._db.prepare('SELECT COUNT(*) AS c FROM workflow_diagrams').get().c;
    expect(count).toBe(0);
  });
});
