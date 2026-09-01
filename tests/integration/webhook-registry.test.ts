// v8 Defer B — WebhookRegistry: durable ingress, HMAC verify, dedup, fire pre-bound (REQ-057/058).
// TEST-FIRST (RED). Mirrors continuation-store.test.ts: real SQLite, fake RunManagerPort/CatalogPort.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { WebhookRegistry } from '../../src/webhook-registry.js';
import type { Clock } from '../../src/clock.js';

// An advancing-free clock anchored at a real "now" so the ±300s timestamp window is meaningful.
const ANCHOR = new Date('2024-06-01T12:00:00.000Z');
const CLOCK: Clock = { now: () => ANCHOR.getTime(), isoNow: () => ANCHOR.toISOString() };

// v22 (DES-111): CatalogPort shrank to the existence-only shape webhook-registry.ts actually needs.
function fakeCatalog(known: Set<string>) {
  return { async exists(name: string) { return known.has(name); } };
}
function fakeRunManager() {
  const started: Array<{ name?: string; args?: unknown }> = [];
  let n = 0;
  return { started, async start(spec: { name?: string; args?: unknown }) { started.push({ name: spec.name, args: spec.args }); return `run-${++n}`; } };
}

function sign(secret: string, rawBody: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

describe('WebhookRegistry (v8 Defer B, REQ-057/058)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rwe-wh-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function mk(rm = fakeRunManager(), known = new Set(['deploy'])) {
    return { rm, reg: new WebhookRegistry({ clock: CLOCK, runManager: rm, catalog: fakeCatalog(known), dbPath: join(dir, 'wh.db') }) };
  }

  it('create returns a secret once + list shows only a fingerprint (never the secret)', async () => {
    const { reg } = mk();
    const c = await reg.create({ workflow: 'deploy' });
    expect('webhookId' in c && c.webhookId).toBeTruthy();
    if (!('secret' in c)) throw new Error('unreachable');
    expect(c.secret.length).toBeGreaterThanOrEqual(32);
    const list = reg.list();
    expect(list[0]!.workflow).toBe('deploy');
    expect(list[0]!.secretFingerprint.length).toBe(16);
    expect(JSON.stringify(list)).not.toContain(c.secret); // secret never exposed via list
  });

  it('create rejects an unknown workflow with WORKFLOW_NOT_FOUND', async () => {
    const { reg } = mk();
    const c = await reg.create({ workflow: 'nope' });
    expect('error' in c && c.error.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('deliver: a correctly-signed fresh delivery fires the PRE-BOUND workflow with args.event → 202', async () => {
    const { rm, reg } = mk();
    const c = await reg.create({ workflow: 'deploy' });
    if (!('secret' in c)) throw new Error('unreachable');
    const body = JSON.stringify({ hello: 'world' });
    const r = await reg.deliver(c.webhookId, { signature: sign(c.secret, body), timestamp: ANCHOR.toISOString(), deliveryId: 'd1', rawBody: body, parsedBody: { hello: 'world' } });
    expect(r).toMatchObject({ ok: true, httpStatus: 202 });
    expect(rm.started).toEqual([{ name: 'deploy', args: { event: { hello: 'world' } } }]); // pre-bound name, body→event
  });

  it('deliver: a bad signature → 401 and NO run', async () => {
    const { rm, reg } = mk();
    const c = await reg.create({ workflow: 'deploy' });
    if (!('secret' in c)) throw new Error('unreachable');
    const body = '{}';
    const r = await reg.deliver(c.webhookId, { signature: 'sha256=deadbeef', timestamp: ANCHOR.toISOString(), deliveryId: 'd1', rawBody: body, parsedBody: {} });
    expect(r).toMatchObject({ ok: false, httpStatus: 401 });
    expect(rm.started.length).toBe(0);
  });

  it('deliver: a stale timestamp (outside ±300s) → 401 and NO run', async () => {
    const { rm, reg } = mk();
    const c = await reg.create({ workflow: 'deploy' });
    if (!('secret' in c)) throw new Error('unreachable');
    const body = '{}';
    const stale = new Date(ANCHOR.getTime() - 600_000).toISOString(); // 10 min ago
    const r = await reg.deliver(c.webhookId, { signature: sign(c.secret, body), timestamp: stale, deliveryId: 'd1', rawBody: body, parsedBody: {} });
    expect(r).toMatchObject({ ok: false, httpStatus: 401 });
    expect(rm.started.length).toBe(0);
  });

  it('deliver: a replayed deliveryId → 200 idempotent, NO second run', async () => {
    const { rm, reg } = mk();
    const c = await reg.create({ workflow: 'deploy' });
    if (!('secret' in c)) throw new Error('unreachable');
    const body = '{}';
    const d = { signature: sign(c.secret, body), timestamp: ANCHOR.toISOString(), deliveryId: 'dup', rawBody: body, parsedBody: {} };
    const first = await reg.deliver(c.webhookId, d);
    const second = await reg.deliver(c.webhookId, d);
    expect(first).toMatchObject({ ok: true, httpStatus: 202 });
    expect(second).toMatchObject({ ok: true, httpStatus: 200, replayed: true });
    expect(rm.started.length).toBe(1); // fired exactly once
  });

  it('deliver: an unknown id → 404; a disabled webhook → 403; both start NO run', async () => {
    const { rm, reg } = mk();
    const unknown = await reg.deliver('nope', { rawBody: '{}', parsedBody: {} });
    expect(unknown).toMatchObject({ ok: false, httpStatus: 404 });
    const c = await reg.create({ workflow: 'deploy', enabled: false });
    if (!('webhookId' in c)) throw new Error('unreachable');
    const disabled = await reg.deliver(c.webhookId, { rawBody: '{}', parsedBody: {} });
    expect(disabled).toMatchObject({ ok: false, httpStatus: 403 });
    expect(rm.started.length).toBe(0);
  });

  it('DURABLE: a webhook created on one instance verifies on a fresh instance (same db)', async () => {
    const dbPath = join(dir, 'wh.db');
    const rm1 = fakeRunManager();
    const reg1 = new WebhookRegistry({ clock: CLOCK, runManager: rm1, catalog: fakeCatalog(new Set(['deploy'])), dbPath });
    const c = await reg1.create({ workflow: 'deploy' });
    if (!('secret' in c)) throw new Error('unreachable');

    const rm2 = fakeRunManager();
    const reg2 = new WebhookRegistry({ clock: CLOCK, runManager: rm2, catalog: fakeCatalog(new Set(['deploy'])), dbPath });
    const body = '{}';
    const r = await reg2.deliver(c.webhookId, { signature: sign(c.secret, body), timestamp: ANCHOR.toISOString(), deliveryId: 'd1', rawBody: body, parsedBody: {} });
    expect(r).toMatchObject({ ok: true, httpStatus: 202 }); // registration + secret persisted
    expect(rm2.started.length).toBe(1);
  });
});
