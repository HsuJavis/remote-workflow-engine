// Service accounts spec send-back D1 (HIGH): "trigger firings bypass SA state" — a schedule firing
// (Scheduler.trigger()/the ticker dispatch) and a webhook delivery both call RunManager.start()
// directly with `principal: row.createdBy` and NO bearer, so the bearer-layer re-check
// (server.ts's serviceAccountBearerRefusal) never runs for them. This file pins the fix at its one
// real chokepoint — RunManager.start()/resume() — independent of which caller reaches it; the
// webhook/schedule end-to-end repro lives in tests/integration/webhook-service-account-state.test.ts
// and tests/integration/schedule-service-account-state.test.ts.
//
// Cases:
//   start(): a disabled/expired sa: principal is refused SERVICE_ACCOUNT_DISABLED; a live one
//     outside its allowlist is refused WORKFLOW_NOT_ALLOWED; a live one inside it (or with no
//     allowlist) is admitted; a human principal and a bare caller (no serviceAccountStatus wired)
//     are never gated.
//   resume(): owner decision reversing the original "forward-only" call — a disabled account, or
//     one whose allowlist has since narrowed past the run's own workflow, cannot resume a run it
//     already started. A live, still-allowlisted account resumes normally.
//
// Red reason: before this change, RunManager.start()/resume() consult no serviceAccountStatus at
// all for the top-level admission (only the ALREADY-FIXED nested workflow() frame did).
//
// Mock policy (unit tier): real RunManager + real in-memory RunStore + real on-disk
// WorkflowCatalog (temp dir) + echo AgentSpawner — same convention as run-manager-disk-floor.test.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { AgentSpawner } from '../../src/agent-executor.js';
import { registerPublished, startScript } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

function echoSpawner(): AgentSpawner {
  return { async run(req) { return { kind: 'text', value: req.prompt }; } };
}

async function pollUntilSettled(mgr: RunManager, runId: string) {
  let view = await mgr.status(runId);
  for (let i = 0; i < 300 && (view.status === 'running' || view.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 25));
    view = await mgr.status(runId);
  }
  return view;
}

describe('RunManager.start() refuses an sa: principal that is not live, or outside its allowlist (service accounts spec send-back D1)', () => {
  let workRoot: string;
  beforeEach(() => { workRoot = mkdtempSync(join(tmpdir(), 'rwe-sa-admission-')); });
  afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it('refuses SERVICE_ACCOUNT_DISABLED for a disabled account — same shape a bearer-less trigger firing reaches', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'demo', `return 1;`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      serviceAccountStatus: () => ({ live: false }),
    });
    await expect(mgr.start({ name: 'demo', origin: 'local', principal: 'sa:ci-bot' })).rejects.toMatchObject({ code: 'SERVICE_ACCOUNT_DISABLED' });
  });

  it('refuses WORKFLOW_NOT_ALLOWED for a live account outside its allowlist', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'demo', `return 1;`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      serviceAccountStatus: () => ({ live: true, workflows: ['other'] }),
    });
    await expect(mgr.start({ name: 'demo', origin: 'local', principal: 'sa:ci-bot' })).rejects.toMatchObject({ code: 'WORKFLOW_NOT_ALLOWED' });
  });

  it('admits a live account inside its allowlist', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'demo', `return 1;`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      serviceAccountStatus: () => ({ live: true, workflows: ['demo'] }),
    });
    const runId = await mgr.start({ name: 'demo', origin: 'local', principal: 'sa:ci-bot' });
    expect(typeof runId).toBe('string');
  });

  it('admits a live account with no allowlist (unrestricted)', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'demo', `return 1;`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      serviceAccountStatus: () => ({ live: true }),
    });
    const runId = await mgr.start({ name: 'demo', origin: 'local', principal: 'sa:ci-bot' });
    expect(typeof runId).toBe('string');
  });

  it('never gates a human principal (serviceAccountStatus returns undefined for a non-sa: id)', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'demo', `return 1;`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      // Mirrors the real contract (PrincipalAdmin.serviceAccountStatus): undefined for a non-sa: id.
      serviceAccountStatus: (p) => (p.startsWith('sa:') ? { live: false } : undefined),
    });
    const runId = await mgr.start({ name: 'demo', origin: 'local', principal: 'alice@example.com' });
    expect(typeof runId).toBe('string');
  });

  it('never gates anyone when serviceAccountStatus is not wired at all (every pre-existing caller)', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'demo', `return 1;`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner() });
    const runId = await mgr.start({ name: 'demo', origin: 'local', principal: 'sa:ci-bot' });
    expect(typeof runId).toBe('string');
  });
});

describe('RunManager.resume() re-checks sa: liveness/allowlist on every resume (owner decision: no forward-only window)', () => {
  let workRoot: string;
  beforeEach(() => { workRoot = mkdtempSync(join(tmpdir(), 'rwe-sa-resume-')); });
  afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it('refuses to resume once the account is disabled, even though it was live at start()', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    let live = true;
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      serviceAccountStatus: (p) => (p === 'sa:ci-bot' ? { live, workflows: ['demo'] } : undefined),
    });
    const runId = await startScript(mgr, `phase('p'); return await agent('a', {});`, { name: 'demo', principal: 'sa:ci-bot' });
    await mgr.suspend(runId);
    expect((await mgr.status(runId)).status).toBe('suspended');

    live = false; // admin disables the account between suspend and resume
    await expect(mgr.resume(runId)).rejects.toMatchObject({ code: 'SERVICE_ACCOUNT_DISABLED' });
  });

  it('refuses to resume once the allowlist narrows past the run\'s own workflow', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    let workflows = ['demo', 'other'];
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      serviceAccountStatus: (p) => (p === 'sa:ci-bot' ? { live: true, workflows } : undefined),
    });
    const runId = await startScript(mgr, `phase('p'); return await agent('a', {});`, { name: 'demo', principal: 'sa:ci-bot' });
    await mgr.suspend(runId);

    workflows = ['other']; // admin narrows the allowlist to exclude 'demo' between suspend and resume
    await expect(mgr.resume(runId)).rejects.toMatchObject({ code: 'WORKFLOW_NOT_ALLOWED' });
  });

  it('resumes normally when the account is still live and still allowlisted', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      serviceAccountStatus: (p) => (p === 'sa:ci-bot' ? { live: true, workflows: ['demo'] } : undefined),
    });
    const runId = await startScript(mgr, `phase('p'); return await agent('a', {});`, { name: 'demo', principal: 'sa:ci-bot' });
    await mgr.suspend(runId);
    await mgr.resume(runId);
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');
  });

  it('a stopped run still answers ILLEGAL_TRANSITION, never SERVICE_ACCOUNT_DISABLED, even for a now-disabled account', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    let live = true;
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      serviceAccountStatus: (p) => (p === 'sa:ci-bot' ? { live } : undefined),
    });
    const runId = await startScript(mgr, `phase('p'); return await agent('a', {});`, { name: 'demo', principal: 'sa:ci-bot' });
    await mgr.suspend(runId);
    await mgr.stop(runId);
    live = false;
    await expect(mgr.resume(runId)).rejects.toThrow(/Illegal state transition/);
  });
});

// Independent-verifier finding (2026-10-10, reverify-r6-b): decision b requires EVERY
// authorization refusal to be audited — this gate's two codes (SERVICE_ACCOUNT_DISABLED,
// WORKFLOW_NOT_ALLOWED) wrote no row at all, on the TWO paths that never reach authorize() in the
// first place (a bearer-less schedule/webhook trigger firing calling start() directly, and a
// resumed run re-checked on every resume) — `audit_refusals_list({actor:'sa:<name>'})` showed
// nothing for a refusal that, for the SAME account's bearer-carrying POST /mcp, does get a row.
describe('RunManager service-account admission refusals are audited (issue #116 decision b, reverify-r6-b finding 4)', () => {
  let workRoot: string;
  beforeEach(() => { workRoot = mkdtempSync(join(tmpdir(), 'rwe-sa-audit-')); });
  afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it('start(): a disabled account writes exactly one audit row, whose requestId matches the thrown error.detail.requestId', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'demo', `return 1;`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      serviceAccountStatus: () => ({ live: false }),
    });
    let thrown: { code?: string; detail?: { requestId?: string } } | undefined;
    try {
      await mgr.start({ name: 'demo', origin: 'local', principal: 'sa:ci-bot' });
    } catch (err) { thrown = err as typeof thrown; }
    expect(thrown?.code).toBe('SERVICE_ACCOUNT_DISABLED');
    expect(typeof thrown?.detail?.requestId).toBe('string');
    const rows = store.queryRefusals({ actor: 'sa:ci-bot' });
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      actor: 'sa:ci-bot', authMethod: 'service-account', targetKind: 'workflow', targetId: 'demo',
      realReason: 'SERVICE_ACCOUNT_DISABLED', returnedCode: 'SERVICE_ACCOUNT_DISABLED',
      requestId: thrown?.detail?.requestId,
    });
  });

  it('start(): a live account outside its allowlist also writes a row (WORKFLOW_NOT_ALLOWED)', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'demo', `return 1;`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      serviceAccountStatus: () => ({ live: true, workflows: ['other'] }),
    });
    await expect(mgr.start({ name: 'demo', origin: 'local', principal: 'sa:ci-bot' })).rejects.toMatchObject({ code: 'WORKFLOW_NOT_ALLOWED' });
    const rows = store.queryRefusals({ actor: 'sa:ci-bot' });
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ targetKind: 'workflow', targetId: 'demo', realReason: 'WORKFLOW_NOT_ALLOWED', returnedCode: 'WORKFLOW_NOT_ALLOWED' });
  });

  it('resume(): the disabled-mid-flight refusal (the one real MCP-reachable chokepoint — run_resume skips authorize()\'s allowlist) also writes a row', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    let live = true;
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      serviceAccountStatus: (p) => (p === 'sa:ci-bot' ? { live, workflows: ['demo'] } : undefined),
    });
    const runId = await startScript(mgr, `phase('p'); return await agent('a', {});`, { name: 'demo', principal: 'sa:ci-bot' });
    await mgr.suspend(runId);
    const before = store.queryRefusals({ actor: 'sa:ci-bot' }).length;
    live = false;
    await expect(mgr.resume(runId)).rejects.toMatchObject({ code: 'SERVICE_ACCOUNT_DISABLED' });
    const rows = store.queryRefusals({ actor: 'sa:ci-bot' });
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ targetKind: 'workflow', targetId: 'demo', realReason: 'SERVICE_ACCOUNT_DISABLED', returnedCode: 'SERVICE_ACCOUNT_DISABLED' });
  });

  it('an audit-write FAILURE still refuses with the real code — never a success, never an unrelated crash', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'demo', `return 1;`);
    const store = new InMemoryRunStore(CLOCK);
    store.appendRefusal = () => { throw new Error('disk full'); };
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      serviceAccountStatus: () => ({ live: false }),
    });
    await expect(mgr.start({ name: 'demo', origin: 'local', principal: 'sa:ci-bot' })).rejects.toMatchObject({ code: 'SERVICE_ACCOUNT_DISABLED' });
  });

  it('never writes a row for a human principal or an unwired serviceAccountStatus (nothing to audit)', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'demo', `return 1;`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner() });
    await mgr.start({ name: 'demo', origin: 'local', principal: 'alice@example.com' });
    expect(store.queryRefusals().length).toBe(0);
  });
});
