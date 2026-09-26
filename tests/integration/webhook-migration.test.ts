// v24 (DES-150, TASK-156). Self-authored test-first (precedent: IMPL-059/D-V2I-5 — the task's own
// DoD spells out this scenario and no Gate-5 item exercises it; flagged as needs_clarification at
// TASK-142 rather than silently patched). SQLite cannot drop a NOT NULL constraint via ALTER, so a
// pre-v24 on-disk `webhooks.db` (created back when `workflow TEXT NOT NULL`) must be rebuilt
// (create-copy-drop-rename) before `create({})` (no workflow) can insert an unclaimed row.
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { WebhookRegistry } from '../../src/webhook-registry.js';
import type { Clock } from '../../src/clock.js';

const ANCHOR = new Date('2024-06-01T12:00:00.000Z');
const CLOCK: Clock = { now: () => ANCHOR.getTime(), isoNow: () => ANCHOR.toISOString() };

function fakeRunManager() {
  return { async start() { return 'run-1'; } };
}
function fakeCatalog() {
  // v24 Gate 8 (AF-2, TASK-161): `declaresTrigger` is a required port member; this fake's `resolve`
  // returns no `triggers`, so the membership branch never reaches it.
  return { async resolve() { return { script: '', version: 'v1' }; }, declaresTrigger(): boolean { return false; } };
}

/** Hand-writes the pre-v24 schema (`workflow TEXT NOT NULL`, no refusal-accounting columns) and
 *  one pre-existing row directly with better-sqlite3 — bypassing WebhookRegistry entirely, since
 *  the whole point is to fabricate what an old on-disk db actually looked like. */
function seedPreV24Db(dbPath: string): { id: string; workflow: string; secret: string; createdAt: string } {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE webhooks (
      id TEXT PRIMARY KEY,
      workflow TEXT NOT NULL,
      secret TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE webhook_deliveries (
      deliveryId TEXT PRIMARY KEY,
      webhookId TEXT NOT NULL,
      ts TEXT NOT NULL
    );
  `);
  const row = { id: 'pre-v24-hook', workflow: 'legacy-deploy', secret: 'a'.repeat(64), createdAt: '2024-01-01T00:00:00.000Z' };
  db.prepare('INSERT INTO webhooks (id, workflow, secret, enabled, createdAt) VALUES (?, ?, ?, ?, ?)')
    .run(row.id, row.workflow, row.secret, 1, row.createdAt);
  db.close();
  return row;
}

describe('WebhookRegistry v24 migration: pre-v24 db (workflow NOT NULL) rebuilt to accept unclaimed rows (TASK-156, DES-150)', () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('opening a pre-v24 db then create({}) with no workflow succeeds, and the pre-existing row survives intact', async () => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-wh-mig-'));
    const dbPath = join(dir, 'wh.db');
    const seeded = seedPreV24Db(dbPath);

    const reg = new WebhookRegistry({ clock: CLOCK, runManager: fakeRunManager(), catalog: fakeCatalog(), dbPath });
    const created = await reg.create({});
    expect(created).toHaveProperty('webhookId');

    const rows = reg.list();
    const unclaimed = rows.find((r) => r.id === (created as { webhookId: string }).webhookId)!;
    expect(unclaimed.workflow).toBeNull();

    const survivor = rows.find((r) => r.id === seeded.id)!;
    expect(survivor.workflow).toBe(seeded.workflow); // pre-existing row's data intact
    expect(rows.length).toBe(2);
  });

  it('migration is idempotent: constructing the store twice over the same pre-v24 db causes no duplicate rows and no error', () => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-wh-mig-'));
    const dbPath = join(dir, 'wh.db');
    const seeded = seedPreV24Db(dbPath);

    expect(() => new WebhookRegistry({ clock: CLOCK, runManager: fakeRunManager(), catalog: fakeCatalog(), dbPath })).not.toThrow();
    let reg2: WebhookRegistry;
    expect(() => { reg2 = new WebhookRegistry({ clock: CLOCK, runManager: fakeRunManager(), catalog: fakeCatalog(), dbPath }); }).not.toThrow();

    const rows = reg2!.list();
    expect(rows.length).toBe(1); // no duplicate of the pre-existing row
    expect(rows[0]!.id).toBe(seeded.id);
    expect(rows[0]!.workflow).toBe(seeded.workflow);
  });
});

// Issue #88: `webhook_deliveries` gains outcome-tracking columns (`httpStatus`/`code`/`runId`) so a
// replay reproduces the ORIGINAL answer instead of an unconditional 200. A pre-fix on-disk db's
// `webhook_deliveries` predates those columns entirely (same three-column shape this file's own
// `seedPreV24Db` already writes for `webhooks`) — opening it must add them via a guarded ALTER TABLE
// (`CREATE TABLE IF NOT EXISTS` is a no-op against an existing table), and a pre-existing delivery
// row, having no recorded outcome, must be treated as an accepted delivery: replay 200, no re-fire.
describe('WebhookRegistry issue #88 migration: pre-fix webhook_deliveries (no outcome columns) gains them, and legacy rows still replay 200', () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  function fakeRunManagerTracking() {
    const started: Array<{ name?: string }> = [];
    return { started, async start(spec: { name?: string }) { started.push({ name: spec.name }); return 'run-legacy'; } };
  }

  it('opening a pre-fix db adds httpStatus/code/runId to webhook_deliveries, and a legacy delivery row replays 200 without re-firing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-wh-mig88-'));
    const dbPath = join(dir, 'wh.db');
    const seeded = seedPreV24Db(dbPath); // pre-existing "webhooks" (workflow NOT NULL) + old-shape webhook_deliveries

    // Hand-write a pre-existing delivery row in the OLD three-column shape (no outcome columns
    // exist yet at all — this is exactly what the pre-fix `INSERT OR IGNORE` used to write).
    const seedDb = new Database(dbPath);
    seedDb.prepare('INSERT INTO webhook_deliveries (deliveryId, webhookId, ts) VALUES (?, ?, ?)')
      .run('legacy-delivery-1', seeded.id, '2024-01-01T00:00:00.000Z');
    seedDb.close();

    const rm = fakeRunManagerTracking();
    const reg = new WebhookRegistry({ clock: CLOCK, runManager: rm, catalog: fakeCatalog(), dbPath });

    // The new columns exist after opening (guarded ALTER TABLE, not a silent no-op).
    const raw = new Database(dbPath);
    const cols = (raw.prepare('PRAGMA table_info(webhook_deliveries)').all() as Array<{ name: string }>).map((c) => c.name);
    raw.close();
    expect(cols).toEqual(expect.arrayContaining(['httpStatus', 'code', 'runId']));

    // Idempotent: opening a second time over the now-migrated db does not error or duplicate columns.
    expect(() => new WebhookRegistry({ clock: CLOCK, runManager: fakeRunManagerTracking(), catalog: fakeCatalog(), dbPath })).not.toThrow();

    // The pre-existing delivery row has no recorded outcome (`httpStatus IS NULL` after the ALTER,
    // since the column was added with no DEFAULT) — treated as accepted: replay 200, no second run.
    const body = '{}';
    const sig = 'sha256=' + createHmac('sha256', seeded.secret).update(body).digest('hex');
    const result = await reg.deliver(seeded.id, {
      signature: sig, timestamp: CLOCK.isoNow(), deliveryId: 'legacy-delivery-1', rawBody: body, parsedBody: {},
    });
    expect(result).toMatchObject({ ok: true, httpStatus: 200, replayed: true });
    expect(rm.started.length).toBe(0); // never re-fired
  });
});
