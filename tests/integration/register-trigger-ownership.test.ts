// IT-123 (DES-139, DES-149 step 2, v24, Gate 6.5+7 round 2): `McpFacade.workflowRegister`'s
// TRIGGER-OWNERSHIP arm — `TRIGGER_NOT_FOUND` / `NOT_TRIGGER_OWNER` / `TRIGGER_ALREADY_CLAIMED`.
// Round 1's send-back found this arm (mcp-facade.ts, step 2 of the register sequence) reached by
// NO test at all — `grep -rn 'TRIGGER_ALREADY_CLAIMED|NOT_TRIGGER_OWNER' tests/` returned nothing —
// which is why the ownership defect it enforces survived Gate 6.
// Mock policy: integration tier — real file-backed WorkflowCatalog + SqliteSchedulerPort +
// WebhookRegistry + RunManager, the real facade. Nothing about the SUT boundary is mocked.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import { WebhookRegistry } from '../../src/webhook-registry.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { FixedClock } from '../../src/clock.js';
import type { Principal } from '../../src/authz.js';

const ALICE: Principal = { kind: 'author', id: 'alice@x.com' };
const BOB: Principal = { kind: 'author', id: 'bob@x.com' };
const ADMIN: Principal = { kind: 'admin', id: 'root@x.com' };
const SCRIPT = 'return 1;';
// v26 (REQ-128): a new registration must be an LR swimlane; this script has no agent() labels.
const MERMAID = 'graph LR';

describe('workflowRegister trigger ownership (IT-123, DES-139/DES-149 step 2)', () => {
  let dir: string;
  let scheduler: SqliteSchedulerPort;
  let webhooks: WebhookRegistry;
  let facade: McpFacade;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-it123-'));
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const catalog = new WorkflowCatalog(dir, clock);
    scheduler = new SqliteSchedulerPort({
      clock,
      catalog: { resolve: async () => ({ ok: true }) } as never,
      runManager: { start: async () => ({ runId: 'r1' }) } as never,
      dbPath: join(dir, 'schedules.db'),
    });
    webhooks = new WebhookRegistry({
      clock,
      runManager: { start: async () => ({ runId: 'r1' }) } as never,
      catalog: { resolve: async () => ({}) } as never,
      dbPath: join(dir, 'webhooks.db'),
    });
    facade = new McpFacade({
      runManager: new RunManager({ clock, workRoot: dir, catalog }),
      schedulerClaims: scheduler,
      webhookClaims: webhooks,
    } as never);
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const newSchedule = async (createdBy?: string) => {
    const { result } = await scheduler.create({ kind: 'once', at: '2026-06-01T00:00:00Z', enabled: true, ...(createdBy !== undefined ? { createdBy } : {}) });
    return result!.id;
  };
  const register = (name: string, principal: Principal, triggers: string[]) =>
    facade.workflowRegister({ name, script: SCRIPT, mermaid: MERMAID, triggers }, principal);

  it('the CREATOR of an unclaimed trigger may register a workflow declaring it, and the claim lands', async () => {
    const id = await newSchedule(ALICE.id);
    const res = await register('wf-alice', ALICE, [id]);
    expect(res['status']).toBe('completed');
    expect(scheduler.get(id)?.claimedBy).toBe('wf-alice');
    // The claim does NOT transfer ownership — `ownerOf` still answers the creating principal.
    expect(scheduler.ownerOf(id)).toBe(ALICE.id);
  });

  it('a NON-creator declaring someone else\'s trigger is refused NOT_TRIGGER_OWNER, and nothing is claimed', async () => {
    const id = await newSchedule(ALICE.id);
    const res = await register('wf-bob', BOB, [id]);
    expect(res['status']).toBe('failed');
    expect(res['code']).toBe('NOT_TRIGGER_OWNER');
    expect(scheduler.get(id)?.claimedBy).toBeNull();
  });

  it('an OWNERLESS trigger (a migrated pre-v24 row, createdBy NULL) is admin-only — DES-139\'s stated operator consequence', async () => {
    const id = await newSchedule(); // no createdBy
    expect(scheduler.ownerOf(id)).toBeNull();
    const refused = await register('wf-bob', BOB, [id]);
    expect(refused['code']).toBe('NOT_TRIGGER_OWNER');
    const allowed = await register('wf-admin', ADMIN, [id]);
    expect(allowed['status']).toBe('completed');
    expect(scheduler.get(id)?.claimedBy).toBe('wf-admin');
  });

  it('a trigger already claimed by ANOTHER workflow is refused TRIGGER_ALREADY_CLAIMED at step 3', async () => {
    const id = await newSchedule(ALICE.id);
    expect((await register('wf-one', ALICE, [id]))['status']).toBe('completed');
    const res = await register('wf-two', ALICE, [id]);
    expect(res['status']).toBe('failed');
    expect(res['code']).toBe('TRIGGER_ALREADY_CLAIMED');
    expect(scheduler.get(id)?.claimedBy).toBe('wf-one'); // the working claim survives the refusal
  });

  it('an id in NEITHER store is TRIGGER_NOT_FOUND (step 2 runs before any claim)', async () => {
    const res = await register('wf-alice', ALICE, ['00000000-0000-0000-0000-000000000000']);
    expect(res['status']).toBe('failed');
    expect(res['code']).toBe('TRIGGER_NOT_FOUND');
  });

  it('the ownership check spans BOTH stores — a webhook created by alice is refused to bob', async () => {
    const w = await webhooks.create({ createdBy: ALICE.id });
    const id = (w as { webhookId: string }).webhookId;
    expect(webhooks.ownerOf(id)).toBe(ALICE.id);
    expect((await register('wf-bob', BOB, [id]))['code']).toBe('NOT_TRIGGER_OWNER');
    expect((await register('wf-alice', ALICE, [id]))['status']).toBe('completed');
    expect(webhooks.get(id)?.workflow).toBe('wf-alice');
  });
});
