// H4 second site (07-review.md §8.1 adjudication #6, ARCH-072 note (1), REQ-097): `WebhookRegistry
// .create()` must upgrade its front-door check from "the name exists" to "the name resolves on
// `release`" — the exact same upgrade Scheduler.create() already got (IT-093,
// scheduler-create-channel-check.test.ts), applied to webhook-registry.ts's own `create()`
// (`webhook-registry.ts:88`, named as H4's second site in 07-review.md's original finding text).
// A registered-but-unpublished draft (REQ-097's normal author-loop state) must be refused
// CHANNEL_UNPUBLISHED here, not accepted and left to fail at every subsequent delivery with no
// operator signal at the point of the actual mistake.
//
// Mock policy (integration, DES-119): a REAL `WorkflowCatalog` (real on-disk sqlite, no fake) —
// mirrors IT-093's own diagnosis: a hand-mocked catalog implementing only `exists()` cannot
// exercise the missing `resolve()` call at all. Only `RunManager` is faked (irrelevant to
// `create()`, never invoked by it).
//
// Red reason (pre-fix): `webhook-registry.ts:88` called only `catalog.exists(spec.workflow)` —
// case 1 below observed `result.error` undefined (creation wrongly SUCCEEDED) where
// `CHANNEL_UNPUBLISHED` was required.
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

describe("WebhookRegistry.create() resolves `release` before accepting (H4 second site, 07-review.md §8.1)", () => {
  it('a REGISTERED but UNPUBLISHED workflow (REQ-097\'s normal draft state) is refused CHANNEL_UNPUBLISHED, not accepted-then-doomed', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await catalog.register('h4-wh-unpublished', `return 1;`); // registered, published to NO channel
    const reg = new WebhookRegistry({ clock: CLOCK, runManager: makeFakeRunManager(), catalog, dbPath: join(dir, 'wh.db') });

    const result = await reg.create({ workflow: 'h4-wh-unpublished' });

    expect('error' in result && result.error.code).toBe('CHANNEL_UNPUBLISHED');
    expect('webhookId' in result).toBe(false);
  });

  it('GREEN PIN: a PUBLISHED workflow still creates a webhook successfully', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const { version } = await catalog.register('h4-wh-published', `return 1;`);
    await catalog.publish('h4-wh-published', version, 'release', null);
    const reg = new WebhookRegistry({ clock: CLOCK, runManager: makeFakeRunManager(), catalog, dbPath: join(dir, 'wh.db') });

    const result = await reg.create({ workflow: 'h4-wh-published' });

    expect('error' in result).toBe(false);
    expect('webhookId' in result && result.webhookId).toBeTruthy();
  });

  it('GREEN PIN: an unknown workflow name is still refused WORKFLOW_NOT_FOUND (existing behavior, unaffected)', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const reg = new WebhookRegistry({ clock: CLOCK, runManager: makeFakeRunManager(), catalog, dbPath: join(dir, 'wh.db') });

    const result = await reg.create({ workflow: 'h4-wh-never-registered' });

    expect('error' in result && result.error.code).toBe('WORKFLOW_NOT_FOUND');
  });
});
