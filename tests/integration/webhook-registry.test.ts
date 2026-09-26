// v8 Defer B — WebhookRegistry: durable ingress, HMAC verify, dedup, fire pre-bound (REQ-057/058).
// TEST-FIRST (RED). Mirrors continuation-store.test.ts: real SQLite, fake RunManagerPort/CatalogPort.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { WebhookRegistry } from '../../src/webhook-registry.js';
import type { Clock } from '../../src/clock.js';
import { CatalogNotFoundError } from '../../src/errors.js';

// An advancing-free clock anchored at a real "now" so the ±300s timestamp window is meaningful.
const ANCHOR = new Date('2024-06-01T12:00:00.000Z');
const CLOCK: Clock = { now: () => ANCHOR.getTime(), isoNow: () => ANCHOR.toISOString() };

// H4 second site (07-review.md §8.1): CatalogPort widened from exists() to resolve() — `create()`
// now checks the name resolves on `release`, not merely that it exists. This fake only tracks
// existence (`known`), so a known name always resolves; it is not modeling channel state.
function fakeCatalog(known: Set<string>) {
  return {
    async resolve(name: string) {
      if (!known.has(name)) throw new CatalogNotFoundError(name);
      return { script: '', version: 'v1' };
    },
    // v24 Gate 8 (AF-2, TASK-161): the port's new REQUIRED member. This fake's `resolve` returns no
    // `triggers` at all, so the membership branch short-circuits on `triggers === undefined` and
    // this is never consulted; `false` is the honest answer regardless — a fake catalog holding no
    // version rows has never declared any trigger. The NOT_IN_RELEASE path is covered against the
    // REAL catalog in tests/integration/trigger-release-versioning.test.ts.
    declaresTrigger(): boolean { return false; },
  };
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

  // v24 Gate 7.5 (D-1, REQ-115's last clause): create() no longer resolves the catalog at all —
  // a trigger is created FIRST and claimed by a workflow at registration, so a name that does not
  // exist yet is the NORMAL case, not an error. The verdict moved to DELIVERY, where the four
  // refusal arms below (UNCLAIMED / CLAIMED_WORKFLOW_MISSING / CHANNEL_UNPUBLISHED /
  // NOT_IN_RELEASE) each record `lastRefusalReason` on the row.
  it('create ACCEPTS a workflow name that does not exist yet, and the refusal lands at delivery instead', async () => {
    const { reg } = mk();
    const c = await reg.create({ workflow: 'nope' });
    expect('error' in c).toBe(false);
    const { webhookId, secret } = c as { webhookId: string; secret: string };
    const body = '{}';
    const r = await reg.deliver(webhookId, { signature: sign(secret, body), timestamp: CLOCK.isoNow(), deliveryId: 'd-nope', rawBody: body, parsedBody: {} });
    expect(r).toMatchObject({ ok: false, code: 'CLAIMED_WORKFLOW_MISSING' });
    expect(reg.get(webhookId)?.lastRefusalReason).toBe('CLAIMED_WORKFLOW_MISSING');
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

// IT-112 (DES-150, v24 REWRITE — appended block, [T3]): webhooks created UNCLAIMED
// (create({}), no `workflow`); wrong HMAC on an unclaimed hook ⇒ 401 never 409; the same
// deliveryId delivered twice while unclaimed ⇒ 409/409 + refusalCount 2, then claimed ⇒ 202.
// Written test-first (Gate 5, RED) — today's create({workflow}) shape REQUIRES workflow at
// creation (the exact retired shape DES-159 names for this file).
describe('v24: webhooks created unclaimed, claimed at registration (IT-112, DES-150)', () => {
  it('create({}) with no workflow creates an UNCLAIMED webhook, returning its id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-wh-v24-'));
    try {
      const reg = new WebhookRegistry({ clock: CLOCK, runManager: fakeRunManager(), catalog: fakeCatalog(new Set()), dbPath: join(dir, 'wh.db') });
      const created = await reg.create({});
      expect(created).toHaveProperty('webhookId');
      expect(reg.list()[0]!.workflow).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('wrong HMAC on an UNCLAIMED hook is 401, never 409 (signature checked before claim state)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-wh-v24-'));
    try {
      const reg = new WebhookRegistry({ clock: CLOCK, runManager: fakeRunManager(), catalog: fakeCatalog(new Set()), dbPath: join(dir, 'wh.db') });
      const created = await reg.create({});
      const body = '{}';
      const result = await reg.deliver((created as { webhookId: string }).webhookId, {
        signature: 'sha256=wrong', timestamp: CLOCK.isoNow(), deliveryId: 'd1', rawBody: body, parsedBody: {},
      });
      expect(result).toMatchObject({ ok: false, httpStatus: 401 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('same deliveryId delivered twice while unclaimed ⇒ 409 both times with refusalCount 2 and NO dedup record, and once claimed the SAME id fires for real (202)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-wh-v24-'));
    try {
      const reg = new WebhookRegistry({ clock: CLOCK, runManager: fakeRunManager(), catalog: fakeCatalog(new Set(['deploy'])), dbPath: join(dir, 'wh.db') });
      const created = await reg.create({});
      const { webhookId, secret } = created as { webhookId: string; secret: string };
      const body = '{}';
      const req = { signature: sign(secret, body), timestamp: CLOCK.isoNow(), deliveryId: 'dup-1', rawBody: body, parsedBody: {} };
      const first = await reg.deliver(webhookId, req);
      const second = await reg.deliver(webhookId, req);
      expect(first).toMatchObject({ ok: false, httpStatus: 409, code: 'UNCLAIMED' });
      expect(second).toMatchObject({ ok: false, httpStatus: 409, code: 'UNCLAIMED' });
      const afterRefusals = reg.list().find((w) => w.id === webhookId)!;
      expect(afterRefusals.refusalCount).toBe(2); // DES-150 dod: two refusals coalesce, not double-count a dedup record
      expect(afterRefusals.lastRefusalReason).toBe('UNCLAIMED');

      const claimed = reg.claim(webhookId, 'deploy');
      expect(claimed).toBe('claimed');
      const third = await reg.deliver(webhookId, req); // dedup record was NEVER written for a refused delivery
      expect(third).toMatchObject({ ok: true, httpStatus: 202 });
      // The admitted delivery must not touch the refusal counter (DES-150: lastError vs
      // lastRefusalReason are mutually exclusive per firing; a fire is neither).
      expect(reg.list().find((w) => w.id === webhookId)!.refusalCount).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('release() un-claims, and a delivery to the now-unclaimed hook refuses UNCLAIMED again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-wh-v24-'));
    try {
      const reg = new WebhookRegistry({ clock: CLOCK, runManager: fakeRunManager(), catalog: fakeCatalog(new Set(['deploy'])), dbPath: join(dir, 'wh.db') });
      const { webhookId, secret } = (await reg.create({})) as { webhookId: string; secret: string };
      expect(reg.claim(webhookId, 'deploy')).toBe('claimed');
      reg.release(webhookId, 'deploy');
      expect(reg.get(webhookId)?.workflow).toBeNull();
      const body = '{}';
      const result = await reg.deliver(webhookId, { signature: sign(secret, body), timestamp: CLOCK.isoNow(), deliveryId: 'd-rel', rawBody: body, parsedBody: {} });
      expect(result).toMatchObject({ ok: false, httpStatus: 409, code: 'UNCLAIMED' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the claim is tri-state: no such id, unclaimed (null), the workflow name once claimed — and ownerOf answers the CREATOR, not the claimant', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-wh-v24-'));
    try {
      const reg = new WebhookRegistry({ clock: CLOCK, runManager: fakeRunManager(), catalog: fakeCatalog(new Set(['deploy'])), dbPath: join(dir, 'wh.db') });
      expect(reg.ownerOf('nope')).toBeUndefined();
      expect(reg.get('nope')).toBeNull();
      const { webhookId } = (await reg.create({ createdBy: 'alice@x.com' })) as { webhookId: string };
      expect(reg.get(webhookId)?.workflow).toBeNull();
      reg.claim(webhookId, 'deploy');
      expect(reg.get(webhookId)?.workflow).toBe('deploy');
      // DES-139/DES-149 step 2 (Gate 6.5+7 round 2): claiming a trigger for a workflow does NOT
      // transfer its ownership — `ownerOf` is the creating principal throughout.
      expect(reg.ownerOf(webhookId)).toBe('alice@x.com');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('claim() is idempotent for the SAME claimant ("held") and refuses a second, different claimant ("ALREADY_CLAIMED")', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-wh-v24-'));
    try {
      const reg = new WebhookRegistry({ clock: CLOCK, runManager: fakeRunManager(), catalog: fakeCatalog(new Set(['deploy', 'other'])), dbPath: join(dir, 'wh.db') });
      const { webhookId } = (await reg.create({})) as { webhookId: string };
      expect(reg.claim(webhookId, 'deploy')).toBe('claimed');
      expect(reg.claim(webhookId, 'deploy')).toBe('held');
      expect(reg.claim(webhookId, 'other')).toBe('ALREADY_CLAIMED');
      expect(reg.get(webhookId)?.workflow).toBe('deploy'); // untouched by the refused claimant
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Gate 6.5+7 round 2 (verifier): `deliver` was 50/58 — three of `RefusalReason`'s four members
  // (`CHANNEL_UNPUBLISHED`, `CLAIMED_WORKFLOW_MISSING`, `NOT_IN_RELEASE`) were produced by no test,
  // which is the same blind spot that let the fire-path gate ship answering only `UNCLAIMED`.
  const deliverTo = async (reg: WebhookRegistry, webhookId: string, secret: string, deliveryId: string) => {
    const body = '{}';
    return reg.deliver(webhookId, { signature: sign(secret, body), timestamp: CLOCK.isoNow(), deliveryId, rawBody: body, parsedBody: {} });
  };

  it('a claimed workflow that no longer resolves refuses CLAIMED_WORKFLOW_MISSING and records the refusal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-wh-v24-'));
    try {
      const known = new Set(['deploy']);
      const reg = new WebhookRegistry({ clock: CLOCK, runManager: fakeRunManager(), catalog: fakeCatalog(known), dbPath: join(dir, 'wh.db') });
      const { webhookId, secret } = (await reg.create({ createdBy: 'alice@x.com' })) as { webhookId: string; secret: string };
      reg.claim(webhookId, 'deploy');
      known.delete('deploy'); // the workflow is deregistered out from under the claim
      const result = await deliverTo(reg, webhookId, secret, 'd-missing');
      expect(result).toMatchObject({ ok: false, httpStatus: 409, code: 'CLAIMED_WORKFLOW_MISSING' });
      expect(reg.get(webhookId)?.refusalCount).toBe(1);
      expect(reg.get(webhookId)?.lastRefusalReason).toBe('CLAIMED_WORKFLOW_MISSING');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a claimed workflow whose release channel is unpublished refuses CHANNEL_UNPUBLISHED, distinct from missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-wh-v24-'));
    try {
      // Bound at creation while the release pointer exists, then the pointer goes away underneath
      // the live claim — the real-world sequence. (v24 Gate 7.5/D-1: `create()` no longer runs a
      // release-channel check of its own; this arm IS the site that check moved to.)
      let published = true;
      const catalog = { async resolve() {
        if (!published) throw Object.assign(new Error('no release'), { code: 'CHANNEL_UNPUBLISHED' });
        return { script: '', version: 'v1' };
      } };
      const reg = new WebhookRegistry({ clock: CLOCK, runManager: fakeRunManager(), catalog: catalog as never, dbPath: join(dir, 'wh.db') });
      const { webhookId, secret } = (await reg.create({ workflow: 'deploy', createdBy: 'alice@x.com' })) as { webhookId: string; secret: string };
      published = false;
      const result = await deliverTo(reg, webhookId, secret, 'd-unpub');
      expect(result).toMatchObject({ ok: false, httpStatus: 409, code: 'CHANNEL_UNPUBLISHED' });
      expect(reg.get(webhookId)?.lastRefusalReason).toBe('CHANNEL_UNPUBLISHED');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a released version that no longer declares this id refuses NOT_IN_RELEASE — but a version declaring NO triggers still fires', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-wh-v24-'));
    try {
      let triggers: string[] | undefined = [];
      // v24 Gate 8 (AF-2, TASK-161): `declaresTrigger` answers "did ANY version of this workflow
      // ever declare this trigger id". `true` is what this case models and what its own title says
      // — a release that "no longer declares" an id is one that once DID, i.e. the id arrived
      // through the registration claim door. The third phase below flips it to model the OTHER
      // door, which this fake previously could not express at all (it used `as never`, so the
      // missing member was not even a compile error).
      let everDeclared = true;
      const catalog = {
        async resolve() { return { script: '', version: 'v1', ...(triggers !== undefined ? { triggers } : {}) }; },
        declaresTrigger(): boolean { return everDeclared; },
      };
      const runManager = fakeRunManager();
      const reg = new WebhookRegistry({ clock: CLOCK, runManager, catalog, dbPath: join(dir, 'wh.db') });
      const { webhookId, secret } = (await reg.create({ workflow: 'deploy', createdBy: 'alice@x.com' })) as { webhookId: string; secret: string };

      expect(await deliverTo(reg, webhookId, secret, 'd-notin'))
        .toMatchObject({ ok: false, httpStatus: 409, code: 'NOT_IN_RELEASE' });
      expect(runManager.started).toEqual([]); // nothing was dispatched

      // A version that declares NO trigger list at all is the pre-v24 shape and must still fire.
      triggers = undefined;
      expect(await deliverTo(reg, webhookId, secret, 'd-pre-v24')).toMatchObject({ ok: true, httpStatus: 202 });
      expect(runManager.started).toHaveLength(1);

      // v24 Gate 8 (AF-2, TASK-161): the OTHER door. The released version declares a NON-EMPTY
      // trigger list that omits this id, but no version ever declared it either — it was bound at
      // creation (`webhook_create({workflow})` — AF-5's door, closed on the tool surface by
      // adjudication #8; this file drives the PORT directly, which still accepts it exactly as a
      // pre-v24 row does). A list it was never in has
      // no jurisdiction over it, so it fires. Before TASK-161 this case was indistinguishable from
      // the first one, because an empty declaration was persisted as NULL.
      triggers = ['some-other-trigger-id'];
      everDeclared = false;
      expect(await deliverTo(reg, webhookId, secret, 'd-create-door')).toMatchObject({ ok: true, httpStatus: 202 });
      expect(runManager.started).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Issue #88: a webhook delivery refused AFTER the dedup claim used to consume its deliveryId
// anyway — the sender's retry (same x-rwe-delivery) then got 200 {replayed:true}, and since
// senders (GitHub/Stripe style) stop retrying on 2xx, the event was silently lost. Fix: the
// dedup record now stores the ORIGINAL outcome and a replay reproduces THAT answer; a transient
// admission failure (503/500) does not poison the id at all, so a retry actually reprocesses.
describe('issue #88: replay reproduces the ORIGINAL outcome (not a bare 200)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rwe-wh-88-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function mk(rm: ReturnType<typeof fakeRunManager> | ReturnType<typeof scriptedRunManager> | ReturnType<typeof deferredRunManager>) {
    return new WebhookRegistry({ clock: CLOCK, runManager: rm as never, catalog: fakeCatalog(new Set(['deploy'])), dbPath: join(dir, 'wh.db') });
  }
  async function createAndClaim(reg: WebhookRegistry) {
    const c = (await reg.create({})) as { webhookId: string; secret: string };
    expect(reg.claim(c.webhookId, 'deploy')).toBe('claimed');
    return c;
  }
  function req(secret: string, deliveryId: string) {
    const body = '{}';
    return { signature: sign(secret, body), timestamp: ANCHOR.toISOString(), deliveryId, rawBody: body, parsedBody: {} };
  }
  function codedErr(code: string): Error {
    return Object.assign(new Error('boom'), { code });
  }
  /** `start()` runs each scripted outcome in order — throws to simulate an admission failure,
   *  returns a runId string on success. Running out of outcomes is a test-authoring bug, not a
   *  code path under test, so it throws loudly rather than silently returning `undefined`. */
  function scriptedRunManager(outcomes: Array<() => string>) {
    const started: Array<{ name?: string; args?: unknown }> = [];
    let i = 0;
    return {
      started,
      async start(spec: { name?: string; args?: unknown }) {
        const fn = outcomes[i++];
        if (!fn) throw new Error('scriptedRunManager: ran out of scripted outcomes');
        const result = fn();
        started.push({ name: spec.name, args: spec.args });
        return result;
      },
    };
  }
  /** `start()` blocks on an externally-released gate — used to hold a delivery "in flight" (claimed,
   *  outcome not yet recorded) so a concurrent duplicate can be observed mid-flight. */
  function deferredRunManager() {
    const started: Array<{ name?: string; args?: unknown }> = [];
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    let n = 0;
    return {
      started,
      release,
      async start(spec: { name?: string; args?: unknown }) {
        await gate;
        started.push({ name: spec.name, args: spec.args });
        return `run-${++n}`;
      },
    };
  }

  it('a PERMANENT refusal (403 CONFINEMENT_UNAVAILABLE) is recorded, and a replay gets back the SAME 403 — never 2xx', async () => {
    const rm = scriptedRunManager([() => { throw codedErr('CONFINEMENT_UNAVAILABLE'); }]);
    const reg = mk(rm);
    const { webhookId, secret } = await createAndClaim(reg);
    const first = await reg.deliver(webhookId, req(secret, 'd-403'));
    expect(first).toMatchObject({ ok: false, httpStatus: 403, code: 'CONFINEMENT_UNAVAILABLE' });
    expect(reg.get(webhookId)?.refusalCount).toBe(1);

    const replay = await reg.deliver(webhookId, req(secret, 'd-403'));
    expect(replay).toMatchObject({ ok: false, httpStatus: 403, code: 'CONFINEMENT_UNAVAILABLE' });
    expect(rm.started.length).toBe(0); // start() was never called a second time
    expect(reg.get(webhookId)?.refusalCount).toBe(1); // a replay is not a new admission decision
  });

  it('a TRANSIENT 503 (RUN_ADMISSION_LIMIT) does NOT poison the id — a retry actually reprocesses and can succeed', async () => {
    const rm = scriptedRunManager([() => { throw codedErr('RUN_ADMISSION_LIMIT'); }, () => 'run-ok']);
    const reg = mk(rm);
    const { webhookId, secret } = await createAndClaim(reg);
    const first = await reg.deliver(webhookId, req(secret, 'd-503'));
    expect(first).toMatchObject({ ok: false, httpStatus: 503 });
    expect(rm.started.length).toBe(0);

    const retry = await reg.deliver(webhookId, req(secret, 'd-503')); // SAME deliveryId
    expect(retry).toMatchObject({ ok: true, httpStatus: 202, runId: 'run-ok' }); // actually processed, not "200 replayed"
    expect(rm.started.length).toBe(1);
  });

  it('a TRANSIENT 500 does NOT poison the id — a retry actually reprocesses and can succeed', async () => {
    const rm = scriptedRunManager([() => { throw new Error('unclassified boom'); }, () => 'run-ok']);
    const reg = mk(rm);
    const { webhookId, secret } = await createAndClaim(reg);
    const first = await reg.deliver(webhookId, req(secret, 'd-500'));
    expect(first).toMatchObject({ ok: false, httpStatus: 500 });

    const retry = await reg.deliver(webhookId, req(secret, 'd-500'));
    expect(retry).toMatchObject({ ok: true, httpStatus: 202, runId: 'run-ok' });
    expect(rm.started.length).toBe(1);
  });

  it('an accepted delivery replays 200 {replayed:true, runId} — the compatible shape, with runId added back', async () => {
    const rm = fakeRunManager();
    const reg = mk(rm);
    const { webhookId, secret } = await createAndClaim(reg);
    const first = await reg.deliver(webhookId, req(secret, 'd-ok'));
    expect(first).toMatchObject({ ok: true, httpStatus: 202 });
    const firstRunId = (first as { runId: string }).runId;

    const replay = await reg.deliver(webhookId, req(secret, 'd-ok'));
    expect(replay).toMatchObject({ ok: true, httpStatus: 200, replayed: true, runId: firstRunId });
    expect(rm.started.length).toBe(1);
  });

  it('a concurrent duplicate that finds the claim in flight gets a non-2xx, not "200 replayed" — then the real outcome replays once it lands', async () => {
    const rm = deferredRunManager();
    const reg = mk(rm);
    const { webhookId, secret } = await createAndClaim(reg);

    const inFlight = reg.deliver(webhookId, req(secret, 'd-race')); // NOT awaited — blocked on the gate
    // Flush the microtask queue (catalog.resolve() + the synchronous claim INSERT that follows it)
    // so `inFlight` has definitely claimed the row and is now parked awaiting the gate, before the
    // duplicate below is sent. A macrotask boundary (setImmediate), not a fixed number of
    // `Promise.resolve()` ticks, is what makes this robust to the exact microtask chain length.
    await new Promise((r) => setImmediate(r));
    const duplicate = await reg.deliver(webhookId, req(secret, 'd-race'));
    expect(duplicate).toMatchObject({ ok: false, httpStatus: 503 }); // "delivery in progress" — never 2xx

    rm.release();
    const first = await inFlight;
    expect(first).toMatchObject({ ok: true, httpStatus: 202 });
    expect(rm.started.length).toBe(1); // exactly one run, despite the concurrent duplicate

    const afterward = await reg.deliver(webhookId, req(secret, 'd-race'));
    expect(afterward).toMatchObject({ ok: true, httpStatus: 200, replayed: true });
    expect(rm.started.length).toBe(1); // still exactly once
  });

  it('6 parallel identical deliveries start EXACTLY ONE run; the other 5 get a non-2xx in-flight answer', async () => {
    const rm = deferredRunManager();
    const reg = mk(rm);
    const { webhookId, secret } = await createAndClaim(reg);

    // Fire all 6 synchronously, in the same JS turn — none has claimed the row yet (each is parked
    // at its own `await catalog.resolve()`). Releasing the gate now (also synchronously, before any
    // microtask runs) just means whichever call eventually wins the claim resolves as soon as it
    // reaches `start()`; it does not affect who wins.
    const calls = Array.from({ length: 6 }, () => reg.deliver(webhookId, req(secret, 'd-parallel')));
    rm.release();
    const results = await Promise.all(calls);

    const accepted = results.filter((r) => r.httpStatus === 202);
    const others = results.filter((r) => r.httpStatus !== 202);
    expect(accepted.length).toBe(1); // exactly-once, despite 6 identical concurrent deliveries
    expect(others.length).toBe(5);
    for (const r of others) {
      expect(r.ok).toBe(false);
      expect(r.httpStatus).not.toBe(200); // none of the 5 losers is told "replayed" for work that may not have happened
    }
    expect(rm.started.length).toBe(1);
  });
});
