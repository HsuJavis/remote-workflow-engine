// IT-105 (DES-139, v24): OwnerLookup wired against the REAL store columns — runs.principal,
// workflows.owner, schedules.createdBy, webhooks.createdBy — asserting authz gets the SAME
// verdict it gets from a fake (catches a port wired to the wrong column).
// Mock policy: integration tier — real SQLite-backed stores, no mock of the SUT boundary.
//
// Gate 6.5+7 (verifier, v24): the shipped version of this file asserted only
// `typeof lookup.runOwner === 'function'` three times — it could not have caught a port wired to
// the wrong column, which is the one thing DES-139 says it exists to catch. Rewritten here against
// real stores per DES-139's own `tests:` line ("binds runs.principal / workflows.owner /
// schedules.createdBy / webhooks.createdBy and asserts the SAME verdicts"), wiring
// `createOwnerLookup` exactly the way the composition root does (server.ts:666-678).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { authorize, type OwnerLookup, type Principal } from '../../src/authz.js';
import { TOOL_SPECS } from '../../src/tool-specs.js';
import { createOwnerLookup } from '../../src/owner-lookup.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import { WebhookRegistry } from '../../src/webhook-registry.js';
import { FixedClock } from '../../src/clock.js';

const CLOCK = new FixedClock(new Date('2026-01-01T00:00:00Z'));
const ALICE: Principal = { kind: 'author', id: 'alice@x.com' };
const BOB: Principal = { kind: 'author', id: 'bob@x.com' };
const ADMIN: Principal = { kind: 'admin', id: 'root@x.com' };

// The four single-row tool shapes under test, copied from TOOL_SPECS' own rows (tool-specs.ts) so
// a row change there is visible here rather than silently diverging. The MODED tools are read
// straight off TOOL_SPECS further down (`realSpec`) — their `key`/`rows` pairing is the thing under
// test, so a hand-copy would defeat the point.
// NOTE (Gate 6.5+7 round 2): this is an AuthzRow FIXTURE, not a copy of `run_status`'s real row —
// the real one carries no `adminCrossRead` (correctly: `McpFacade.runStatus` ignores the flag; it is
// where `adminReads[]` is ATTACHED, not an audited read). It exercises `authorize()`'s cross-read
// arm. Which REAL rows carry the flag is pinned separately, against TOOL_SPECS, at the end of this
// file — the divergence this comment used to hide is exactly how `run_result` lost the flag.
const RUN_STATUS = { name: 'run_status', key: 'runId' as const, authz: { minRole: 'user' as const, ownership: 'run' as const, adminCrossRead: true as const } };
const WORKFLOW_DEREGISTER = { name: 'workflow_deregister', key: 'name' as const, authz: { minRole: 'author' as const, ownership: 'workflow' as const } };
const SCHEDULE_DELETE = { name: 'schedule_delete', key: 'id' as const, authz: { minRole: 'author' as const, ownership: 'trigger' as const } };
const WEBHOOK_DELETE = { name: 'webhook_delete', key: 'id' as const, authz: { minRole: 'author' as const, ownership: 'trigger' as const } };

/** The oracle: the SAME verdict `authorize` produces from a hand-written lookup that returns the
 *  value DES-139 says the column holds. A real-store row disagreeing with this is a port wired to
 *  the wrong column — exactly what this file exists to catch. */
function fakeLookup(over: Partial<OwnerLookup>): OwnerLookup {
  return { runOwner: () => undefined, workflowOwner: () => undefined, triggerOwner: () => undefined, ...over };
}

describe('authz OwnerLookup — wired to real store columns (IT-105, DES-139)', () => {
  let dir: string;
  let lookup: OwnerLookup;
  let aliceRunId: string;
  let legacyRunId: string;
  let aliceScheduleId: string;
  let claimedScheduleId: string;
  let aliceWebhookId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-it105-'));
    const runStore = new SqliteRunStore(join(dir, 'store'), CLOCK);
    const catalog = new WorkflowCatalog(dir, CLOCK);
    const scheduler = new SqliteSchedulerPort({
      clock: CLOCK,
      catalog: { resolve: async () => ({ ok: true }) } as never,
      runManager: { start: async () => ({ runId: 'r1' }) } as never,
      dbPath: join(dir, 'schedules.db'),
    });
    const webhooks = new WebhookRegistry({
      clock: CLOCK,
      runManager: { start: async () => ({ runId: 'r1' }) } as never,
      catalog: { resolve: async () => ({}) } as never,
      dbPath: join(dir, 'webhooks.db'),
    });

    // Real rows through the real write paths.
    aliceRunId = await runStore.createRun({ name: 'wf-a', principal: ALICE.id } as never);
    legacyRunId = await runStore.createRun({ name: 'wf-a' } as never); // pre-v15 row: principal NULL
    await catalog.register({ name: 'wf-a', script: 'export default {}', principal: ALICE.id } as never)
      .catch(() => { /* the registration validator is not under test here — the row below is */ });
    // A workflows row owned by alice, written the way the catalog's own INSERT does.
    new Database(join(dir, 'catalog.db'))
      .prepare('INSERT OR REPLACE INTO workflows (name, createdAt, owner) VALUES (?, ?, ?)')
      .run('wf-a', CLOCK.isoNow(), ALICE.id);

    const s1 = await scheduler.create({ kind: 'cron', cron: '0 0 * * *', enabled: true, createdBy: ALICE.id } as never);
    aliceScheduleId = (s1 as { result: { id: string } }).result.id;
    const s2 = await scheduler.create({ kind: 'cron', cron: '0 1 * * *', enabled: true, createdBy: ALICE.id } as never);
    claimedScheduleId = (s2 as { result: { id: string } }).result.id;
    await scheduler.claim(claimedScheduleId, 'wf-a');

    const w = await webhooks.create({ createdBy: ALICE.id });
    aliceWebhookId = (w as { webhookId: string }).webhookId;

    // The composition root's own wiring (server.ts:666-678) — raw handles over the same files.
    const runsOwnerDb = new Database(join(dir, 'store', 'index.db'));
    const catalogOwnerDb = new Database(join(dir, 'catalog.db'));
    lookup = createOwnerLookup({
      runOwner: (runId) => {
        const row = runsOwnerDb.prepare('SELECT principal FROM runs WHERE runId = ?').get(runId) as { principal: string | null } | undefined;
        return row ? row.principal : undefined;
      },
      workflowOwner: (name) => {
        const row = catalogOwnerDb.prepare('SELECT owner FROM workflows WHERE name = ?').get(name) as { owner: string | null } | undefined;
        return row ? row.owner : undefined;
      },
      scheduler, webhooks,
    });
  });

  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('runs.principal — the owner acts, a non-owner is refused NOT_RUN_OWNER (same verdict as the fake)', () => {
    expect(lookup.runOwner(aliceRunId)).toBe(ALICE.id);
    expect(authorize(ALICE, RUN_STATUS, { runId: aliceRunId }, lookup).ok).toBe(true);
    const real = authorize(BOB, RUN_STATUS, { runId: aliceRunId }, lookup);
    const fake = authorize(BOB, RUN_STATUS, { runId: aliceRunId }, fakeLookup({ runOwner: () => ALICE.id }));
    expect(real.ok).toBe(false);
    expect(real.code).toBe('NOT_RUN_OWNER');
    expect(real.code).toBe(fake.code);
  });

  it('runs.principal NULL (pre-v15 row) is admin-only, and an absent runId never leaks existence', () => {
    expect(lookup.runOwner(legacyRunId)).toBeNull();
    expect(authorize(ALICE, RUN_STATUS, { runId: legacyRunId }, lookup).code).toBe('NOT_RUN_OWNER');
    expect(authorize(ADMIN, RUN_STATUS, { runId: legacyRunId }, lookup).ok).toBe(true);
    expect(lookup.runOwner('00000000-0000-0000-0000-000000000000')).toBeUndefined();
    expect(authorize(BOB, RUN_STATUS, { runId: '00000000-0000-0000-0000-000000000000' }, lookup).ok).toBe(true);
  });

  it('admin cross-owner read of a real run is flagged crossPrincipalRead (the audit signal)', () => {
    const verdict = authorize(ADMIN, RUN_STATUS, { runId: aliceRunId }, lookup);
    expect(verdict.ok).toBe(true);
    expect(verdict.crossPrincipalRead).toBe(true);
  });

  it('workflows.owner — the owner acts, a non-owner is refused NOT_WORKFLOW_OWNER', () => {
    expect(lookup.workflowOwner('wf-a')).toBe(ALICE.id);
    expect(authorize(ALICE, WORKFLOW_DEREGISTER, { name: 'wf-a' }, lookup).ok).toBe(true);
    const real = authorize(BOB, WORKFLOW_DEREGISTER, { name: 'wf-a' }, lookup);
    expect(real.code).toBe('NOT_WORKFLOW_OWNER');
    expect(real.code).toBe(authorize(BOB, WORKFLOW_DEREGISTER, { name: 'wf-a' }, fakeLookup({ workflowOwner: () => ALICE.id })).code);
  });

  it('schedules.createdBy — the creator of an UNCLAIMED schedule may delete it', () => {
    expect(lookup.triggerOwner(aliceScheduleId)).toBe(ALICE.id);
    expect(authorize(ALICE, SCHEDULE_DELETE, { id: aliceScheduleId }, lookup).ok).toBe(true);
    const real = authorize(BOB, SCHEDULE_DELETE, { id: aliceScheduleId }, lookup);
    expect(real.code).toBe('NOT_TRIGGER_OWNER');
    expect(real.code).toBe(authorize(BOB, SCHEDULE_DELETE, { id: aliceScheduleId }, fakeLookup({ triggerOwner: () => ALICE.id })).code);
  });

  it('schedules.createdBy survives a claim — claiming a trigger for a workflow does not transfer its ownership', () => {
    expect(lookup.triggerOwner(claimedScheduleId)).toBe(ALICE.id);
    expect(authorize(ALICE, SCHEDULE_DELETE, { id: claimedScheduleId }, lookup).ok).toBe(true);
  });

  it('webhooks.createdBy — the creator may delete their own webhook', () => {
    expect(lookup.triggerOwner(aliceWebhookId)).toBe(ALICE.id);
    expect(authorize(ALICE, WEBHOOK_DELETE, { id: aliceWebhookId }, lookup).ok).toBe(true);
  });

  // The REAL rows, not hand-copied constants: a moded workspace_* tool declares
  // `ownership:'run'`/`'workflow'` on its resolved row, so the ownership check must actually run
  // against the real store — DES-139's subject rule is `args[spec.key]`.
  const realSpec = (name: string) => TOOL_SPECS.find((s) => s.name === name)! as unknown as { name: string; key: 'runId' | 'name' | 'id' | null; authz: unknown };

  it('workspace_list({runId}) in run mode enforces run ownership against the real store', () => {
    const verdict = authorize(BOB, realSpec('workspace_list') as never, { runId: aliceRunId }, lookup);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('NOT_RUN_OWNER');
  });

  it('workspace_delete({runId}) in run mode enforces run ownership against the real store', () => {
    const verdict = authorize(BOB, realSpec('workspace_delete') as never, { runId: aliceRunId }, lookup);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('NOT_RUN_OWNER');
  });

  it('workspace_push({workflow,kind}) in asset mode enforces workflow ownership against the real store', () => {
    const verdict = authorize(BOB, realSpec('workspace_push') as never, { workflow: 'wf-a', kind: 'skill', name: 'n', files: [] }, lookup);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('NOT_WORKFLOW_OWNER');
  });

  it('the REAL rows carrying adminCrossRead are exactly DES-151\'s audited set (minus run_status, which only attaches adminReads[])', () => {
    const flagged = (TOOL_SPECS as ReadonlyArray<{ name: string; authz: unknown }>)
      .flatMap((spec) => {
        const a = spec.authz as { adminCrossRead?: boolean; rows?: Record<string, { adminCrossRead?: boolean }> };
        const rows = a.rows ? Object.values(a.rows) : [a];
        return rows.some((r) => r.adminCrossRead === true) ? [spec.name] : [];
      })
      .sort();
    // DES-151: `AuditAction = Extract<ToolName, 'workspace_list'|'workspace_pull'|'run_agent_log'|'run_result'>`.
    expect(flagged).toEqual(['run_agent_log', 'run_result', 'workspace_list', 'workspace_pull']);
  });

  it('triggerOwner is total across BOTH stores — an id in neither is undefined (authz never leaks existence)', () => {
    expect(lookup.triggerOwner('00000000-0000-0000-0000-000000000000')).toBeUndefined();
    expect(authorize(BOB, SCHEDULE_DELETE, { id: '00000000-0000-0000-0000-000000000000' }, lookup).ok).toBe(true);
  });
});
