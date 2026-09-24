// UT-324 (DES-262, ARCH-181, TASK-257, REQ-218, ADR-083 owner_decision posture C) — the
// remote-submission door: run_start/run_resume are refused BEFORE schema/authz when this engine's
// measured confinement posture is 'unconfined' AND the caller is not a loopback peer. A LOCAL
// submission on the SAME unconfined posture still reaches the facade (the owner's accepted cost:
// "本機發起的 run 仍不受限制" — a locally-submitted run stays unconfined, never refused).
// Written test-first (Gate 5b amendment, RED): ToolDeps carries no isRemoteSubmission/
// confinementPosture field yet, and callTool has no pre-dispatch check for them.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callTool } from '../../src/call-tool.js';
import type { ToolDeps } from '../../src/call-tool.js';
import { WebhookRegistry } from '../../src/webhook-registry.js';
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import type { Clock } from '../../src/clock.js';

function partialDeps(d: Record<string, unknown>): ToolDeps {
  return d as unknown as ToolDeps;
}
type ToolEnvelope = { code?: string; error?: { code?: string | number; message?: string } };

// v37 Gate-8 round-2 (finding B1) — a real store + a fake catalog/runManager (neither `create()`
// call reaches them): the trigger stores' own constructor/schema, not a mock of `.create()`.
const ANCHOR = new Date('2024-06-01T12:00:00.000Z');
const B1_CLOCK: Clock = { now: () => ANCHOR.getTime(), isoNow: () => ANCHOR.toISOString() };
function b1FakeCatalog() {
  return { async resolve() { return { script: '', version: 'v1' }; }, declaresTrigger(): boolean { return false; }, async exists() { return true; } };
}
function b1FakeRunManager() {
  return { async start() { return 'run-x'; } };
}

describe('UT-324 the confinement door — remote submissions refused when unconfined, local ones still run (DES-262)', () => {
  it('[LOAD-BEARING] run_start: remote + unconfined ⇒ refused before the facade is ever called', async () => {
    const runStart = vi.fn().mockResolvedValue({ runId: 'r1' });
    const authorizeSpy = vi.fn();
    const deps = partialDeps({
      facade: { runStart }, lookup: { workflowOwner: () => 'bob' }, audit: {}, authorize: authorizeSpy,
      confinementPosture: 'unconfined', isRemoteSubmission: true,
    });
    const result = (await callTool(deps, 'run_start', { name: 'wf' }, { kind: 'user', id: 'bob' })) as ToolEnvelope;
    expect(runStart).not.toHaveBeenCalled();
    expect(authorizeSpy).not.toHaveBeenCalled();
    expect(result.code).toBe('CONFINEMENT_UNAVAILABLE');
  });

  it('run_start: local (loopback) + unconfined ⇒ still reaches the facade (the accepted local-unconfined cost)', async () => {
    const runStart = vi.fn().mockResolvedValue({ runId: 'r1' });
    const deps = partialDeps({
      facade: { runStart }, lookup: { workflowOwner: () => 'bob' }, audit: {},
      confinementPosture: 'unconfined', isRemoteSubmission: false,
    });
    await callTool(deps, 'run_start', { name: 'wf' }, { kind: 'user', id: 'bob' });
    expect(runStart).toHaveBeenCalledTimes(1);
  });

  it('run_start: remote + confined ⇒ still reaches the facade (the door only closes when the posture is degraded)', async () => {
    const runStart = vi.fn().mockResolvedValue({ runId: 'r1' });
    const deps = partialDeps({
      facade: { runStart }, lookup: { workflowOwner: () => 'bob' }, audit: {},
      confinementPosture: 'confined', isRemoteSubmission: true,
    });
    await callTool(deps, 'run_start', { name: 'wf' }, { kind: 'user', id: 'bob' });
    expect(runStart).toHaveBeenCalledTimes(1);
  });

  it('run_start: remote + posture/flag omitted entirely (existing 252-callsite tests) ⇒ unaffected, still reaches the facade', async () => {
    const runStart = vi.fn().mockResolvedValue({ runId: 'r1' });
    const deps = partialDeps({ facade: { runStart }, lookup: { workflowOwner: () => 'bob' }, audit: {} });
    await callTool(deps, 'run_start', { name: 'wf' }, { kind: 'user', id: 'bob' });
    expect(runStart).toHaveBeenCalledTimes(1);
  });

  it('run_resume: remote + unconfined ⇒ refused the same way (resume also spawns agent() Bash calls)', async () => {
    const runResume = vi.fn().mockResolvedValue({ runId: 'r1' });
    const deps = partialDeps({
      facade: { runResume }, lookup: { runOwner: () => 'bob' }, audit: {},
      confinementPosture: 'unconfined', isRemoteSubmission: true,
    });
    const result = (await callTool(deps, 'run_resume', { runId: 'r1' }, { kind: 'user', id: 'bob' })) as ToolEnvelope;
    expect(runResume).not.toHaveBeenCalled();
    expect(result.code).toBe('CONFINEMENT_UNAVAILABLE');
  });

  it('run_status (a read, not a submission): remote + unconfined ⇒ NOT gated by the door', async () => {
    const runStatus = vi.fn().mockResolvedValue({ runId: 'r1' });
    const deps = partialDeps({
      facade: { runStatus }, lookup: { runOwner: () => 'bob' }, audit: {},
      confinementPosture: 'unconfined', isRemoteSubmission: true,
    });
    await callTool(deps, 'run_status', { runId: 'r1' }, { kind: 'user', id: 'bob' });
    expect(runStatus).toHaveBeenCalledTimes(1);
  });
});

describe('v37 Gate-8 round-2 (finding B1, INV-V37-5(d)) — ToolDeps.isRemoteSubmission stamps createdRemote at creation, read back through the REAL store', () => {
  it('[LOAD-BEARING] webhook_create with isRemoteSubmission:true stores createdRemote=1 on the created row', async () => {
    const webhooks = new WebhookRegistry({ clock: B1_CLOCK, runManager: b1FakeRunManager(), catalog: b1FakeCatalog(), dbPath: ':memory:' });
    const deps = partialDeps({ webhooks, isRemoteSubmission: true });
    const result = (await callTool(deps, 'webhook_create', {}, { kind: 'auth-disabled' })) as { result?: { webhookId: string } };
    expect(result.result?.webhookId).toBeTruthy();
    const row = webhooks.get(result.result!.webhookId);
    expect(row?.createdRemote).toBe(true);
  });

  it('schedule_create with isRemoteSubmission:true stores createdRemote=1 on the created row', async () => {
    const scheduler = new SqliteSchedulerPort({ clock: B1_CLOCK, catalog: b1FakeCatalog(), runManager: b1FakeRunManager(), dbPath: ':memory:' });
    const deps = partialDeps({ scheduler, isRemoteSubmission: true });
    const result = (await callTool(deps, 'schedule_create', { kind: 'cron', cron: '0 6 * * *' }, { kind: 'auth-disabled' })) as { result?: { id: string } };
    expect(result.result?.id).toBeTruthy();
    const row = scheduler.get(result.result!.id);
    expect(row?.createdRemote).toBe(true);
  });

  it('webhook_create/schedule_create WITHOUT isRemoteSubmission ⇒ createdRemote stays false (the existing, un-gated default)', async () => {
    const webhooks = new WebhookRegistry({ clock: B1_CLOCK, runManager: b1FakeRunManager(), catalog: b1FakeCatalog(), dbPath: ':memory:' });
    const scheduler = new SqliteSchedulerPort({ clock: B1_CLOCK, catalog: b1FakeCatalog(), runManager: b1FakeRunManager(), dbPath: ':memory:' });
    const whResult = (await callTool(partialDeps({ webhooks }), 'webhook_create', {}, { kind: 'auth-disabled' })) as { result?: { webhookId: string } };
    const schResult = (await callTool(partialDeps({ scheduler }), 'schedule_create', { kind: 'cron', cron: '0 6 * * *' }, { kind: 'auth-disabled' })) as { result?: { id: string } };
    expect(webhooks.get(whResult.result!.webhookId)?.createdRemote).toBe(false);
    expect(scheduler.get(schResult.result!.id)?.createdRemote).toBe(false);
  });
});

// v37 P1 (ADR-086's THIRD owner ruling, 2026-09-25, DES-263's 第三次修訂) — this block used to pin
// the OPPOSITE fact (`claim()` re-stamping `createdRemote` to true). That rule is SUPERSEDED and
// DELETED: `createdRemote` is write-once at creation, never touched by `claim()`. The re-registration
// hole finding 7 named is now closed one row over — `workflow_versions.registeredRemote`, written
// once by `insertVersion` from the SAME `isRemoteSubmission` `workflow_register` already threads —
// so this block now pins BOTH halves: the trigger id stays untouched, and the version row is
// tainted. Losing either `isRemoteSubmission` at `call-tool.ts:212`, or the forward into
// `insertVersion` at `mcp-facade.ts`, must turn one of these RED.
describe('UT-336/UT-337 — workflow_register isRemoteSubmission:true, re-listing an EXISTING locally-owned trigger id: the trigger stays untouched, the NEW version is tainted (P1)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rwe-c2-restamp-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const SCRIPT = 'return 1;';
  // v26 (REQ-128): a plain LR swimlane with no agent() label — the same minimal fixture
  // `register-trigger-ownership.test.ts` (IT-123) uses, which registers clean.
  const MERMAID = 'graph LR';

  it('[LOAD-BEARING] UT-336 schedule: claim() leaves the existing schedule trigger local; the new version is registeredRemote:true', async () => {
    const catalog = new WorkflowCatalog(dir, B1_CLOCK);
    const scheduler = new SqliteSchedulerPort({ clock: B1_CLOCK, catalog: b1FakeCatalog() as never, runManager: b1FakeRunManager() as never, dbPath: join(dir, 'schedules.db') });
    const webhooks = new WebhookRegistry({ clock: B1_CLOCK, catalog: b1FakeCatalog() as never, runManager: b1FakeRunManager() as never, dbPath: join(dir, 'webhooks.db') });
    const facade = new McpFacade({
      runManager: new RunManager({ clock: B1_CLOCK, workRoot: dir, catalog }),
      schedulerClaims: scheduler, webhookClaims: webhooks,
    } as never);

    // Created LOCALLY (isRemoteSubmission:false / omitted), no `workflow` bound yet.
    const created = await scheduler.create({ kind: 'once', at: '2026-06-01T00:00:00Z', enabled: true } as never);
    const id = (created as { result?: { id: string } }).result!.id;
    expect(scheduler.get(id)?.createdRemote).toBe(false);

    const deps = partialDeps({ facade, scheduler, webhooks, isRemoteSubmission: true });
    const res = (await callTool(deps, 'workflow_register', { name: 'wf-c2-sched', script: SCRIPT, mermaid: MERMAID, triggers: [id] }, { kind: 'auth-disabled' })) as { status?: string; result?: { version?: string } };
    expect(res.status).toBe('completed');
    // The trigger row: write-once, untouched by this remote claim.
    expect(scheduler.get(id)?.createdRemote).toBe(false);
    // The version row: tainted by the SAME isRemoteSubmission — this is what actually closes the
    // re-registration hole under P1.
    const resolved = await catalog.resolve('wf-c2-sched', { version: res.result!.version });
    expect((resolved as { registeredRemote?: boolean }).registeredRemote).toBe(true);
  });

  it('[LOAD-BEARING] UT-337 webhook: claim() leaves the existing webhook trigger local; the new version is registeredRemote:true', async () => {
    const catalog = new WorkflowCatalog(dir, B1_CLOCK);
    const scheduler = new SqliteSchedulerPort({ clock: B1_CLOCK, catalog: b1FakeCatalog() as never, runManager: b1FakeRunManager() as never, dbPath: join(dir, 'schedules.db') });
    const webhooks = new WebhookRegistry({ clock: B1_CLOCK, catalog: b1FakeCatalog() as never, runManager: b1FakeRunManager() as never, dbPath: join(dir, 'webhooks.db') });
    const facade = new McpFacade({
      runManager: new RunManager({ clock: B1_CLOCK, workRoot: dir, catalog }),
      schedulerClaims: scheduler, webhookClaims: webhooks,
    } as never);

    // Created LOCALLY (isRemoteSubmission:false / omitted), unclaimed.
    const created = await webhooks.create({});
    const id = (created as { webhookId: string }).webhookId;
    expect(webhooks.get(id)?.createdRemote).toBe(false);

    const deps = partialDeps({ facade, scheduler, webhooks, isRemoteSubmission: true });
    const res = (await callTool(deps, 'workflow_register', { name: 'wf-c2-hook', script: SCRIPT, mermaid: MERMAID, triggers: [id] }, { kind: 'auth-disabled' })) as { status?: string; result?: { version?: string } };
    expect(res.status).toBe('completed');
    expect(webhooks.get(id)?.createdRemote).toBe(false);
    const resolved = await catalog.resolve('wf-c2-hook', { version: res.result!.version });
    expect((resolved as { registeredRemote?: boolean }).registeredRemote).toBe(true);
  });
});
