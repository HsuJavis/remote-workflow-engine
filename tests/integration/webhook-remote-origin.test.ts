// IT-303 (DES-263, ARCH-182, ADR-086, TASK-258, REQ-218) — the WEBHOOK admission route: a webhook
// created by a REMOTE submission (`createdRemote`) is refused when the engine is measured
// `unconfined`, while a LOCALLY-created webhook still fires. Proves WebhookRegistry.deliver()
// correctly stamps `origin` from the already-loaded row's own `createdRemote` column and maps a
// thrown admission refusal into DeliverResult's typed failure shape. Per DES-262's own note, the
// delivery PEER is deliberately NOT part of this predicate — a webhook exists to be called from
// another machine, so gating on the caller's socket would refuse every legitimate webhook; what
// decides is who ATTACHED the trigger, written once at creation.
// Written test-first (RED): WebhookRegistry.create()'s param type carries no `createdRemote`, the
// `webhooks` table has no such column, and `deliver()` neither stamps `origin` on the spec it hands
// to `start()` nor wraps that call in a try/catch — a thrown coded error today escapes `deliver()`'s
// own Promise<DeliverResult> as a rejection instead of becoming a typed refusal.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { WebhookRegistry } from '../../src/webhook-registry.js';
import { codedError } from '../../src/errors.js';
import type { Clock } from '../../src/clock.js';

const ANCHOR = new Date('2024-06-01T12:00:00.000Z');
const CLOCK: Clock = { now: () => ANCHOR.getTime(), isoNow: () => ANCHOR.toISOString() };

function fakeCatalog() {
  return {
    async resolve() { return { script: '', version: 'v1' }; },
    declaresTrigger(): boolean { return false; },
  };
}

// Mirrors src/run-manager.ts's own admissionRefusal({posture:'unconfined', origin}) — proves the
// WIRING (does the registry stamp the right origin and map the refusal correctly), not the
// predicate itself (that is UT-329's job).
function fakeUnconfinedRunManager() {
  let n = 0;
  return {
    async start(spec: { origin: 'local' | 'remote' }) {
      if (spec.origin === 'remote') {
        throw codedError('CONFINEMENT_UNAVAILABLE', 'CONFINEMENT_UNAVAILABLE: refused on this unconfined host');
      }
      return `run-${++n}`;
    },
  };
}

function sign(secret: string, rawBody: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

describe('IT-303 webhook admission route (DES-263)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rwe-wh-remote-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function mk() {
    return new WebhookRegistry({ clock: CLOCK, runManager: fakeUnconfinedRunManager(), catalog: fakeCatalog(), dbPath: join(dir, 'wh.db') });
  }

  it('[LOAD-BEARING] a webhook created with createdRemote:true is refused when delivered to on an unconfined host', async () => {
    const reg = mk();
    const c = await reg.create({ workflow: 'deploy', createdRemote: true });
    if ('error' in c) throw new Error('unreachable: create failed');
    const body = '{}';
    const r = await reg.deliver(c.webhookId, { signature: sign(c.secret, body), timestamp: CLOCK.isoNow(), deliveryId: 'd-remote', rawBody: body, parsedBody: {} });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable: expected refusal');
    expect(r.reason).toContain('CONFINEMENT_UNAVAILABLE');
  });

  it('a webhook created WITHOUT createdRemote (local) still fires on the same unconfined host', async () => {
    const reg = mk();
    const c = await reg.create({ workflow: 'deploy' });
    if ('error' in c) throw new Error('unreachable: create failed');
    const body = '{}';
    const r = await reg.deliver(c.webhookId, { signature: sign(c.secret, body), timestamp: CLOCK.isoNow(), deliveryId: 'd-local', rawBody: body, parsedBody: {} });
    expect(r.ok).toBe(true);
  });
});
