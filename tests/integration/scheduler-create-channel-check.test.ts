// IT-093 (H4 send-back, 07-review.md §4.2 — ARCH-072 note(1), DES-113, DES-117, REQ-097):
// `Scheduler.create()` must upgrade its front-door check from "the name exists" to "the name
// resolves on `release`" — ARCH-072 prices this at "one line" and the v22 interface table lists
// `CHANNEL_UNPUBLISHED` as a `schedule_create`-time error. REQ-097 makes "registered but on no
// channel" the NORMAL state of a fresh draft (register-draft → publish-later is the sanctioned
// author loop), so a schedule created against a drafted-but-unpublished workflow is accepted at
// creation today and fails at EVERY subsequent fire with no operator signal at the point of the
// actual mistake.
//
// Mock policy (integration, DES-119): a REAL `WorkflowCatalog` (real on-disk sqlite, no fake) —
// per the send-back's own diagnosis (`grep -rn "CHANNEL_UNPUBLISHED" tests/` found zero hits
// against `Scheduler.create()`), a hand-mocked catalog that only implements `exists()` cannot
// exercise the missing `resolve()` call at all; only a real catalog keeps this red for the
// genuine runtime reason (create() never calls `resolve()`) rather than a type-shape artifact.
// Only `RunManager` is faked (irrelevant to `create()`, never invoked by it).
//
// Red reason: `scheduler.ts:153-156` calls ONLY `catalog.exists(s.workflow)` — confirmed by direct
// read, no `resolve(name, {channel:'release'})` call anywhere in `create()`. `grep -rn
// "CHANNEL_UNPUBLISHED" src/scheduler.ts` finds nothing. The first case below observes
// `result.error` undefined (creation wrongly SUCCEEDED) where `CHANNEL_UNPUBLISHED` is required.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { SqliteSchedulerPort } from '../../src/scheduler.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';

const CLOCK = new FixedClock(new Date('2020-03-01T10:00:00.000Z'));

function makeFakeRunManager() {
  return { start: async () => 'run-h4' };
}

let workRoot: string;
beforeEach(() => { workRoot = mkdtempSync(join(tmpdir(), 'rwe-it093-')); });
afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

describe("Scheduler.create() resolves `release` before accepting (H4 send-back, 07-review.md §4.2)", () => {
  it('a REGISTERED but UNPUBLISHED workflow (REQ-097\'s normal draft state) is refused CHANNEL_UNPUBLISHED, not accepted-then-doomed', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await catalog.register({ name: 'h4-unpublished', script: `return 1;`, mermaid: 'graph TD;' }); // registered, published to NO channel
    const port = new SqliteSchedulerPort({ clock: CLOCK, catalog, runManager: makeFakeRunManager(), dbPath: ':memory:' });

    const result = await port.create({ kind: 'cron', workflow: 'h4-unpublished', cron: '0 3 * * *', enabled: true });

    expect(result.error?.code).toBe('CHANNEL_UNPUBLISHED');
    expect(result.result).toBeUndefined();
  });

  it('GREEN PIN: a PUBLISHED workflow still creates a schedule successfully', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const { version } = await catalog.register({ name: 'h4-published', script: `return 1;`, mermaid: 'graph TD;' });
    await catalog.publish('h4-published', version, 'release', null);
    const port = new SqliteSchedulerPort({ clock: CLOCK, catalog, runManager: makeFakeRunManager(), dbPath: ':memory:' });

    const result = await port.create({ kind: 'cron', workflow: 'h4-published', cron: '0 3 * * *', enabled: true });

    expect(result.error).toBeUndefined();
    expect(result.result?.id).toBeTruthy();
  });

  it('GREEN PIN: an unknown workflow name is still refused WORKFLOW_NOT_FOUND (existing behavior, unaffected)', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const port = new SqliteSchedulerPort({ clock: CLOCK, catalog, runManager: makeFakeRunManager(), dbPath: ':memory:' });

    const result = await port.create({ kind: 'cron', workflow: 'h4-never-registered', cron: '0 3 * * *', enabled: true });

    expect(result.error?.code).toBe('WORKFLOW_NOT_FOUND');
  });
});
