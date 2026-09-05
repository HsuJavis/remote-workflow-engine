// IT-094, v24 Gate 7.5 REWRITE (defect D-1, REQ-115's last clause) — the webhook twin of IT-093.
//
// What this file used to pin: H4's second site (07-review.md §8.1) — `WebhookRegistry.create()`
// refusing CHANNEL_UNPUBLISHED at CREATION for a registered-but-unpublished draft.
//
// Why it is rewritten rather than deleted: REQ-115 makes triggers create-then-claim, and its last
// clause moves the H4 check off the create door — "the check does not disappear, it changes site,
// and everything that described its old site must be updated with it". Gate 7.5 found the check
// still at the old site, which is what kept `workflow` REQUIRED on the `webhook_create` row and
// made `webhook_create({})` — the whole point of the model — an `INVALID_ARGUMENT` (D-1).
// Adjudication (v24) #5 E-4 ruled that a defect.
//
// The check's real site is DELIVERY, where the answer is still true when it matters:
// `deliver()` refuses UNCLAIMED / CLAIMED_WORKFLOW_MISSING / CHANNEL_UNPUBLISHED / NOT_IN_RELEASE
// and records the refusal on the row. Those four arms are pinned in
// `tests/integration/webhook-registry.test.ts`; this file pins the create door's new contract and
// the end-to-end sequence create → claim-at-registration → deliver.
//
// Mock policy (integration, DES-119): a REAL `WorkflowCatalog` on real sqlite (as before — a
// hand-mocked catalog could not tell an unpublished draft from a missing name), a real
// `WebhookRegistry` on a real db file. Only `RunManager` is faked; no delivery is dispatched here.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { WebhookRegistry } from '../../src/webhook-registry.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';

const CLOCK = new FixedClock(new Date('2020-03-01T10:00:00.000Z'));

function makeFakeRunManager() {
  return { async start() { return 'run-h4-webhook'; } };
}

let workRoot: string;
let dir: string;
beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-it094-catalog-'));
  dir = mkdtempSync(join(tmpdir(), 'rwe-it094-wh-'));
});
afterEach(() => {
  rmSync(workRoot, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

describe('webhook_create is a create-then-claim door, not a catalog check (IT-094 v24, REQ-115, D-1)', () => {
  it('create() with NO workflow returns an id and leaves the row UNCLAIMED — ADR-026 scenario S-5', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const reg = new WebhookRegistry({ clock: CLOCK, runManager: makeFakeRunManager(), catalog, dbPath: join(dir, 'wh.db') });

    const result = await reg.create({ createdBy: 'alice@example.com' });

    expect('error' in result).toBe(false);
    const { webhookId } = result as { webhookId: string };
    expect(reg.get(webhookId)?.workflow ?? null).toBeNull();
  });

  it("a webhook bound at creation to a REGISTERED but UNPUBLISHED workflow is ACCEPTED — REQ-097's draft state is not a creation error any more", async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await catalog.register({ name: 'h4-wh-unpublished', script: `return 1;`, mermaid: 'graph TD;' }); // on NO channel
    const reg = new WebhookRegistry({ clock: CLOCK, runManager: makeFakeRunManager(), catalog, dbPath: join(dir, 'wh.db') });

    const result = await reg.create({ workflow: 'h4-wh-unpublished' });

    expect('error' in result).toBe(false);
    // The refusal it used to get at creation is now delivered at DELIVERY time, on the row —
    // webhook-registry.test.ts pins CHANNEL_UNPUBLISHED / CLAIMED_WORKFLOW_MISSING / NOT_IN_RELEASE
    // / UNCLAIMED there, each with its recorded `lastRefusalReason`.
  });

  it('a workflow name that does not exist at all is likewise accepted at creation', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const reg = new WebhookRegistry({ clock: CLOCK, runManager: makeFakeRunManager(), catalog, dbPath: join(dir, 'wh.db') });

    const result = await reg.create({ workflow: 'h4-wh-never-registered' });

    expect('error' in result).toBe(false);
  });

  it('GREEN PIN: a PUBLISHED workflow still creates a webhook, and the claim door still works', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const { version } = await catalog.register({ name: 'h4-wh-published', script: `return 1;`, mermaid: 'graph TD;' });
    await catalog.publish('h4-wh-published', version, 'release', null);
    const reg = new WebhookRegistry({ clock: CLOCK, runManager: makeFakeRunManager(), catalog, dbPath: join(dir, 'wh.db') });

    const bound = await reg.create({ workflow: 'h4-wh-published' });
    expect('error' in bound).toBe(false);
    expect('webhookId' in bound && bound.webhookId).toBeTruthy();

    const unclaimed = (await reg.create({})) as { webhookId: string };
    expect(reg.claim(unclaimed.webhookId, 'h4-wh-published')).toBe('claimed');
    expect(reg.get(unclaimed.webhookId)?.workflow).toBe('h4-wh-published');
  });
});
