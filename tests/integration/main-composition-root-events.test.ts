// IT-294 (DES-243/244/245/246, TASK-241/242/243/244, REQ-213/212/211/086/087/114/014/095): the
// composition-root wiring guard for `src/event-log.ts` — DES-243's own ruling is that this IT, not
// a `compose-config-v2-wiring.test.ts` row, is the instrument (`eventSink` is composition-root
// constructed, not a `FileConfig` key). Real `WorkflowCatalog` + real `RunManager` over a real
// temp-dir SQLite pair, wired to a REAL `createEventSink` (from `src/event-log.ts`) with an
// injected `write` — one real `workflow_register` + `workflow_publish` (TASK-242), one real
// terminal run (TASK-243), one real `deregisterVersion` (TASK-244). Also re-proves REQ-086/087/114
// (ownership/attribution unchanged) and REQ-014/095 (the registry's own read/log surface) per
// 04-design.md's real-tier table — every existing ownership assertion here uses the SAME
// legacy-preserving expectations UT-300 pins.
//
// Seam this test asserts against: `WorkflowCatalog`'s constructor opts and `RunManagerDeps` both
// gain an optional `eventSink: EventSink` (DES-243's own text: "RunManagerDeps.eventSink,
// WorkflowCatalog's constructor"). `src/main.ts` is where DES-243 says the ONE sink is built and
// passed to both in production; this IT constructs the same real classes directly with the same
// sink, which is the adjacent-real-components shape an integration tier uses.
//
// Red reason: `src/event-log.ts` doesn't exist (import fails — suite-level red); even once
// stubbed, neither constructor accepts `eventSink` yet and `publish`/`insertVersion` still write
// via `console.log`/nothing, so no line is ever captured by the injected `write`.
//
// Mock policy (integration): real SQLite-backed WorkflowCatalog + RunManager, real event-log sink;
// no mock of either SUT boundary.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import { createEventSink } from '../../src/event-log.js';
import { registerPublished } from '../helpers/workflow-fixtures.js';

const clock = new FixedClock(new Date('2026-09-21T00:00:00.000Z'));
const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'rwe-it294-composition-'));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function waitForStatus(mgr: RunManager, runId: string, want: string, maxIters = 120): Promise<void> {
  for (let i = 0; i < maxIters; i++) {
    const v = await mgr.status(runId);
    if (v.status === want) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitForStatus: run ${runId} never reached ${want}`);
}

function boot(dir: string, lines: string[]) {
  const eventSink = createEventSink({ write: (l: string) => lines.push(l), now: () => clock.isoNow() });
  const catalog = new WorkflowCatalog(join(dir, 'catalog'), clock, { eventSink } as any);
  const store = new SqliteRunStore(join(dir, 'store'), clock);
  const mgr = new RunManager({ store, clock, catalog, workRoot: dir, eventSink } as any);
  return { catalog, mgr, eventSink };
}

describe('IT-294: the composition root — one real eventSink wired into WorkflowCatalog + RunManager', () => {
  it('a real workflow_register (insertVersion) + workflow_publish each emit ONE line, kinds and actor triple', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const { catalog } = boot(dir, lines);
    const actor = { id: 'alice', bypass: false, idSource: 'authenticated' as const };
    const { version } = await catalog.insertVersion({ name: 'it294-a', script: "meta = {description:'x'};\nreturn 1;", mermaid: 'flowchart LR\n', params: undefined, actor } as any);
    await catalog.publish('it294-a', version, 'release', actor as any);

    const kinds = lines.map((l) => JSON.parse(l).kind);
    expect(kinds).toContain('catalog.register');
    expect(kinds).toContain('catalog.publish');
    const registerLine = JSON.parse(lines.find((l) => JSON.parse(l).kind === 'catalog.register')!);
    expect(registerLine.actor).toEqual(actor);
  });

  it('catalog.publish no longer writes a bare console.log line (deleted, not duplicated)', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'src', 'workflow-catalog.ts'), 'utf8');
    expect(src).not.toMatch(/console\.log\(`catalog\.publish:/);
  });

  it('an admin publishing ANOTHER owner\'s workflow: succeeds (bypass unchanged, REQ-086/087/114), logs the ADMIN\'s OWN id with bypass:true', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const { catalog } = boot(dir, lines);
    const ownerActor = { id: 'owner-bob', bypass: false, idSource: 'authenticated' as const };
    const { version } = await catalog.insertVersion({ name: 'it294-admin', script: "meta = {description:'x'};\nreturn 1;", mermaid: 'flowchart LR\n', params: undefined, actor: ownerActor } as any);
    const adminActor = { id: 'root-admin', bypass: true, idSource: 'authenticated' as const };
    await catalog.publish('it294-admin', version, 'release', adminActor as any);

    const publishLine = JSON.parse(lines.find((l) => JSON.parse(l).kind === 'catalog.publish')!);
    expect(publishLine.actor).toEqual(adminActor);

    // REQ-086/087 unchanged: a NON-admin stranger still cannot publish someone else's workflow.
    const strangerActor = { id: 'mallory', bypass: false, idSource: 'authenticated' as const };
    await expect(catalog.publish('it294-admin', version, 'beta', strangerActor as any)).rejects.toThrow(/NOT_WORKFLOW_OWNER/);
  });

  it('a completed run AND a failed run both emit run.terminal (REQ-213 "any run reaching a terminal state")', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const { catalog, mgr } = boot(dir, lines);
    await registerPublished(catalog, 'it294-ok', "return 'done';");
    const okId = await mgr.start({ name: 'it294-ok', principal: 'alice' } as any);
    await waitForStatus(mgr, okId, 'completed');

    await registerPublished(catalog, 'it294-bad', "throw new Error('boom');");
    const badId = await mgr.start({ name: 'it294-bad', principal: 'alice' } as any);
    await waitForStatus(mgr, badId, 'failed');

    const terminals = lines.map((l) => JSON.parse(l)).filter((e) => e.kind === 'run.terminal');
    expect(terminals.some((e) => e.runId === okId && e.outcome === 'completed')).toBe(true);
    expect(terminals.some((e) => e.runId === badId && e.outcome === 'failed' && e.code === 'SCRIPT_ERROR')).toBe(true);
    expect(terminals.every((e) => e.principal === 'alice')).toBe(true);
  });

  it('deregisterVersion emits ONE catalog.deregister line with {name, version, actor}', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const { catalog } = boot(dir, lines);
    const actor = { id: 'alice', bypass: false, idSource: 'authenticated' as const };
    const { version } = await catalog.insertVersion({ name: 'it294-dereg', script: "meta = {description:'x'};\nreturn 1;", mermaid: 'flowchart LR\n', params: undefined, actor } as any);
    await (catalog as any).insertVersion({ name: 'it294-dereg', script: "meta = {description:'y'};\nreturn 2;", mermaid: 'flowchart LR\n', params: undefined, actor });
    await (catalog as any).deregisterVersion('it294-dereg', version, actor);

    const deregLine = lines.map((l) => JSON.parse(l)).find((e) => e.kind === 'catalog.deregister');
    expect(deregLine).toMatchObject({ name: 'it294-dereg', version });
  });
});
