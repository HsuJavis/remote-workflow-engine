// IT-132 (v24 Gate 8 AF-2 / TASK-161, ARCH-098 + ARCH-099 + ADR-026, adjudication (v24) #7 G-2):
// `triggers: []` stops being byte-identical to a pre-v24 `NULL`, so moving the `release` pointer
// can finally UN-declare a trigger.
//
// The defect: `workflow-catalog.ts:472` wrote `NULL` for any empty array. The facade always passes
// an array, so a v24 row declaring `triggers: []` was indistinguishable on disk from a legacy row
// that predates the column. Both the scheduler fire path (`server.ts:775`) and the webhook one
// (`webhook-registry.ts:279`) gate their membership check on `released.triggers !== undefined` —
// deliberately, so the pre-v24 create-time-binding door keeps working — so an empty declaration
// skipped the check entirely. Consequence: register v1 with `triggers:[t1]`, register v2 with
// `triggers:[]`, publish v2 to `release`, and t1 keeps firing v2 forever. `NOT_IN_RELEASE` was
// unreachable and the one direction that REMOVES a trigger was never versioned.
//
// ARCH-098's text ("both `NULL` **only on pre-v24 rows**") names the first test in the same
// sentence: no post-migration row is written `NULL`.
//
// Mock policy (integration, DES-119): a real SQLite `WorkflowCatalog` and a real `WebhookRegistry`
// over `:memory:`, wired to each other exactly as `server.ts` wires them. Only `RunManager` is a
// spy — the assertion "t1 does NOT run v2" is precisely "start() was never called", which needs a
// recording double and nothing else.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import type Database from 'better-sqlite3';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { WebhookRegistry } from '../../src/webhook-registry.js';
import { SystemClock } from '../../src/clock.js';

const SCRIPT = 'workflow(() => {});';
const MERMAID = 'flowchart TD';

let dir: string;
let catalog: WorkflowCatalog;
let registry: WebhookRegistry;
let started: string[];

function rawDb(c: WorkflowCatalog): Database.Database {
  return (c as unknown as { _db: Database.Database })._db;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwe-it132-'));
  catalog = new WorkflowCatalog(dir);
  started = [];
  registry = new WebhookRegistry({
    clock: new SystemClock(),
    runManager: { start: async (spec: { name?: string }) => { started.push(spec.name ?? '?'); return 'run-it135'; } },
    catalog,
    dbPath: ':memory:',
  });
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A correctly signed delivery — the claim checks sit AFTER HMAC + timestamp verification
 *  (ARCH-100), so an unsigned probe would be refused 401 and prove nothing about membership. */
async function deliverSigned(id: string, secret: string) {
  const rawBody = JSON.stringify({ hello: 'world' });
  return registry.deliver(id, {
    signature: createHmac('sha256', secret).update(rawBody).digest('hex'),
    timestamp: new Date().toISOString(),
    deliveryId: `d-${Math.random().toString(36).slice(2)}`,
    rawBody,
    parsedBody: { hello: 'world' },
  });
}

describe('a v24 row is never written with NULL triggers (IT-132, AF-2, TASK-161)', () => {
  it('ARCH-098\'s own specified test: no post-migration row is written NULL', async () => {
    for (let i = 0; i < 10; i++) {
      await catalog.register({ name: `it132-nulls-${i}`, script: SCRIPT, mermaid: MERMAID });
    }
    await catalog.register({ name: 'it132-explicit-empty', script: SCRIPT, mermaid: MERMAID, triggers: [] });
    await catalog.register({ name: 'it132-with-trigger', script: SCRIPT, mermaid: MERMAID, triggers: ['t-abc'] });
    const nullCount = (rawDb(catalog).prepare('SELECT COUNT(*) AS n FROM workflow_versions WHERE triggers IS NULL').get() as { n: number }).n;
    expect(nullCount, 'a v24 registration wrote NULL — indistinguishable from a pre-v24 row').toBe(0);
  });

  it('an empty declaration reaches a reader as [] — the exact contract server.ts:775 branches on', async () => {
    await catalog.register({ name: 'it132-contract', script: SCRIPT, mermaid: MERMAID, triggers: [] });
    await catalog.publish('it132-contract', 'v1', 'release', null);
    const released = await catalog.resolve('it132-contract', { channel: 'release' });
    expect(released.triggers, '`triggers !== undefined` is what enables the membership check').toEqual([]);
  });

  it('a genuine pre-v24 row still reads as undefined, so the legacy create-time door is untouched', async () => {
    await catalog.register({ name: 'it132-legacy', script: SCRIPT, mermaid: MERMAID, triggers: ['t-legacy'] });
    // Simulate the ONLY rows ARCH-098 permits to be NULL: ones written before the column existed.
    rawDb(catalog).prepare('UPDATE workflow_versions SET triggers = NULL WHERE name = ?').run('it132-legacy');
    await catalog.publish('it132-legacy', 'v1', 'release', null);
    const released = await catalog.resolve('it132-legacy', { channel: 'release' });
    expect(released.triggers).toBeUndefined();
  });
});

describe('moving `release` to a version that declares no triggers un-declares them (IT-132, AF-2)', () => {
  const WF = 'it132-fire';

  it('v1 declares [t1], v2 declares [], release moves to v2 => NOT_IN_RELEASE and NO run', async () => {
    const created = await registry.create({});
    expect('webhookId' in created).toBe(true);
    const { webhookId, secret } = created as { webhookId: string; secret: string };

    await catalog.register({ name: WF, script: SCRIPT, mermaid: MERMAID, triggers: [webhookId] });
    await catalog.publish(WF, 'v1', 'release', null);
    // The webhook is claimed by the workflow, exactly as workflow_register's claim step leaves it.
    await registry.claim(webhookId, WF);

    // Control: while v1 is released, the delivery fires for real. Without this, the refusal below
    // could be green for any reason at all (bad signature, unclaimed row, missing workflow).
    const admitted = await deliverSigned(webhookId, secret);
    expect(admitted.httpStatus).toBe(202);
    expect(started).toEqual([WF]);

    // v2 declares NO triggers, and becomes the released version.
    await catalog.register({ name: WF, script: SCRIPT, mermaid: MERMAID, triggers: [] });
    await catalog.publish(WF, 'v2', 'release', null);

    const refused = await deliverSigned(webhookId, secret);
    expect(refused.httpStatus, 'the trigger still fired a version that no longer declares it').toBe(409);
    expect((refused as { code?: string }).code).toBe('NOT_IN_RELEASE');
    expect(started, 't1 started a run for a version that un-declared it').toEqual([WF]); // still only the admitted one
    expect(registry.get(webhookId)?.refusalCount).toBe(1);
  });

  // The other half of the same rule, and the reason the storage fix alone is not the whole fix.
  // A trigger BOUND AT CREATION (`webhook_create({workflow})` / `schedule_create({workflow})` — the
  // door ARCH-099 says was removed, which v24 adjudication #8 (H-2, issue #56) finally closed on the
  // tool surface; the pre-v24 rows it bound survive, which is why this half still matters) never enters ANY version's
  // `triggers[]`. Before this change the fire path used "the version list is NULL" as its proxy for
  // "this trigger did not come through the claim door"; once `[]` is stored honestly that proxy is
  // gone, and a naive membership check refuses every create-time-bound trigger on every v24
  // workflow. The honest discriminator is the trigger id itself: was it ever DECLARED by a version
  // of this workflow? If no version ever named it, the release list has no jurisdiction over it.
  it('a trigger BOUND AT CREATION still fires — no version ever declared it, so membership does not apply', async () => {
    const WF2 = 'it132-create-door';
    const created = await registry.create({ workflow: WF2 });
    const { webhookId, secret } = created as { webhookId: string; secret: string };

    await catalog.register({ name: WF2, script: SCRIPT, mermaid: MERMAID }); // declares NO triggers
    await catalog.publish(WF2, 'v1', 'release', null);

    const result = await deliverSigned(webhookId, secret);
    expect(result.httpStatus, 'a create-time-bound trigger was refused by a list it was never in').toBe(202);
    expect(started).toEqual([WF2]);
  });

  it('MIXED: a claimed-then-undeclared trigger is refused while a create-time-bound one on the SAME workflow fires', async () => {
    const WF3 = 'it132-mixed';
    const claimedHook = await registry.create({}) as { webhookId: string; secret: string };
    const createDoorHook = await registry.create({ workflow: WF3 }) as { webhookId: string; secret: string };

    await catalog.register({ name: WF3, script: SCRIPT, mermaid: MERMAID, triggers: [claimedHook.webhookId] });
    await registry.claim(claimedHook.webhookId, WF3);
    await catalog.register({ name: WF3, script: SCRIPT, mermaid: MERMAID, triggers: [] }); // v2 un-declares it
    await catalog.publish(WF3, 'v2', 'release', null);

    const refused = await deliverSigned(claimedHook.webhookId, claimedHook.secret);
    expect(refused.httpStatus).toBe(409);
    expect((refused as { code?: string }).code).toBe('NOT_IN_RELEASE');

    const admitted = await deliverSigned(createDoorHook.webhookId, createDoorHook.secret);
    expect(admitted.httpStatus).toBe(202);
    expect(started).toEqual([WF3]);
  });
});
