// IT-132 (v24 Gate 8 AF-2 / TASK-161, ARCH-098 + ARCH-099 + ADR-026, adjudication (v24) #7 G-2):
// `triggers: []` stops being byte-identical to a pre-v24 `NULL`, so the per-version declaration
// honestly says what each version claims.
//
// The defect: `workflow-catalog.ts:472` wrote `NULL` for any empty array. The facade always passes
// an array, so a v24 row declaring `triggers: []` was indistinguishable on disk from a legacy row
// that predates the column. ARCH-098's text ("both `NULL` **only on pre-v24 rows**") names the
// first test in the same sentence: no post-migration row is written `NULL`.
//
// issue #160 (owner-approved 2026-10-07): the second `describe` below used to pin the OLD
// release-channel-membership gate (`NOT_IN_RELEASE`) — "moving `release` off the declaring version
// un-declares the trigger". That is retired: a trigger claimed through a version's `triggers[]` is
// now PINNED to the HIGHEST version that still declares it (`WorkflowCatalog.boundVersionFor`) and
// fires THAT version directly, regardless of what `release` points at (or whether anything is
// published to `release` at all). See `errors.ts`'s retired `NOT_IN_RELEASE` entry and
// `webhook-registry.ts`'s `deliver()` for the replacement logic.
//
// Mock policy (integration, DES-119): a real SQLite `WorkflowCatalog` and a real `WebhookRegistry`
// over `:memory:`, wired to each other exactly as `server.ts` wires them. Only `RunManager` is a
// spy — it records both `name` and `version` so a test can prove WHICH version actually ran.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import type Database from 'better-sqlite3';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { WebhookRegistry } from '../../src/webhook-registry.js';
import { SystemClock } from '../../src/clock.js';

const SCRIPT = "export const meta = { phases: [] };\nworkflow(() => {});";
// v26 (REQ-128): a new registration must be an LR swimlane. This script declares no agent()
// labels at all, so the header is the whole contract here.
const MERMAID = 'flowchart LR';

let dir: string;
let catalog: WorkflowCatalog;
let registry: WebhookRegistry;
let started: string[];
let startedVersions: Array<string | undefined>;

function rawDb(c: WorkflowCatalog): Database.Database {
  return (c as unknown as { _db: Database.Database })._db;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwe-it132-'));
  catalog = new WorkflowCatalog(dir);
  started = [];
  startedVersions = [];
  registry = new WebhookRegistry({
    clock: new SystemClock(),
    runManager: { start: async (spec: { name?: string; version?: string }) => { started.push(spec.name ?? '?'); startedVersions.push(spec.version); return 'run-it135'; } },
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

describe('issue #160: a version-claimed trigger fires the version it is BOUND to, never the release channel', () => {
  const WF = 'it132-fire';

  it('v1 declares [t1], v2 declares [], release moves to v2 => t1 still fires v1 (its bound version), NOT v2', async () => {
    const created = await registry.create({});
    expect('webhookId' in created).toBe(true);
    const { webhookId, secret } = created as { webhookId: string; secret: string };

    await catalog.register({ name: WF, script: SCRIPT, mermaid: MERMAID, triggers: [webhookId] });
    await catalog.publish(WF, 'v1', 'release', null);
    // The webhook is claimed by the workflow, exactly as workflow_register's claim step leaves it.
    await registry.claim(webhookId, WF);

    // Control: while v1 is released, the delivery fires for real.
    const admitted = await deliverSigned(webhookId, secret);
    expect(admitted.httpStatus).toBe(202);
    expect(started).toEqual([WF]);
    expect(startedVersions).toEqual(['v1']);

    // v2 declares NO triggers and becomes the released version — but v1 is still the HIGHEST
    // version that ever declared this id, so the trigger stays bound to v1 and keeps firing it.
    await catalog.register({ name: WF, script: SCRIPT, mermaid: MERMAID, triggers: [] });
    await catalog.publish(WF, 'v2', 'release', null);

    const second = await deliverSigned(webhookId, secret);
    expect(second.httpStatus, 'a version-bound trigger must keep running its bound version, not the release channel').toBe(202);
    expect(started).toEqual([WF, WF]);
    expect(startedVersions, 'fired v1 (its bound version) again, never v2').toEqual(['v1', 'v1']);
    expect(registry.get(webhookId)?.refusalCount).toBe(0);
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

  it('MIXED: a version-claimed trigger keeps firing its bound version while a create-time-bound one on the SAME workflow fires the release channel', async () => {
    const WF3 = 'it132-mixed';
    const claimedHook = await registry.create({}) as { webhookId: string; secret: string };
    const createDoorHook = await registry.create({ workflow: WF3 }) as { webhookId: string; secret: string };

    await catalog.register({ name: WF3, script: SCRIPT, mermaid: MERMAID, triggers: [claimedHook.webhookId] }); // v1
    await registry.claim(claimedHook.webhookId, WF3);
    await catalog.register({ name: WF3, script: SCRIPT, mermaid: MERMAID, triggers: [] }); // v2 declares nothing new
    await catalog.publish(WF3, 'v2', 'release', null);

    // claimedHook is bound to v1 (the highest version that ever declared it) — it fires v1, not the
    // v2 release, and is NOT refused.
    const bound = await deliverSigned(claimedHook.webhookId, claimedHook.secret);
    expect(bound.httpStatus).toBe(202);
    expect(startedVersions).toEqual(['v1']);

    // createDoorHook was bound at creation (never declared by any version) — it keeps resolving the
    // release channel (currently v2) itself; no explicit `version` is passed to `start()` for it
    // (same as before this fix — `undefined` lets admission resolve `release` on its own).
    const admitted = await deliverSigned(createDoorHook.webhookId, createDoorHook.secret);
    expect(admitted.httpStatus).toBe(202);
    expect(started).toEqual([WF3, WF3]);
    expect(startedVersions).toEqual(['v1', undefined]);
  });
});
