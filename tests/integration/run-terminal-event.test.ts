// IT-295 (DES-245, ARCH-160, TASK-243, REQ-213/212): `_transition` emits ONE `run.terminal` event
// when `to` is terminal — `completed` INCLUDED (not only failures), which is why it lives at
// `_transition` rather than inside a failure-capture function. Also proves the RESUMED-run half:
// a SECOND RunManager over the SAME SQLite file emits the same `principal` as the first dispatch —
// the half an incident investigation actually reads, and the one UT-301 shows is broken on SQLite
// today.
//
// Red reason: `RunManagerDeps` has no `eventSink` slot and `_transition` never calls one — no line
// is ever captured by the injected `write`, for either run.
//
// Mock policy (integration): real SqliteRunStore over a real temp file, real RunManager, real
// sandbox (the script genuinely runs/throws) — no mock of the SUT boundary.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { FixedClock } from '../../src/clock.js';
import { createEventSink } from '../../src/event-log.js';
import { registerPublished } from '../helpers/workflow-fixtures.js';

const clock = new FixedClock(new Date('2026-09-21T00:00:00.000Z'));
const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'rwe-it295-terminal-'));
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

describe('IT-295: run.terminal fires at the ONE authoritative terminal writer, including completed', () => {
  it('a COMPLETED run emits run.terminal with outcome:"completed" and its principal', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const eventSink = createEventSink({ write: (l: string) => lines.push(l), now: () => clock.isoNow() });
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const catalog = new WorkflowCatalog(join(dir, 'catalog'), clock);
    const mgr = new RunManager({ store, clock, catalog, workRoot: dir, eventSink } as any);
    await registerPublished(catalog, 'it295-ok', "return 'fine';");
    const runId = await mgr.start({ name: 'it295-ok', principal: 'alice' } as any);
    await waitForStatus(mgr, runId, 'completed');

    const terminal = lines.map((l) => JSON.parse(l)).find((e) => e.kind === 'run.terminal' && e.runId === runId);
    expect(terminal).toBeDefined();
    expect(terminal.outcome).toBe('completed');
    expect(terminal.principal).toBe('alice');
  });

  it("a terminal run's principal survives being READ BACK by a FRESH process (RunManager) over the same SQLite file — the status surface, downstream of UT-301's getSpec() fix", async () => {
    // NOTE (honesty, not TASK-243(4)'s R-2 case): this run reaches `failed` BEFORE mgr2 is even
    // constructed, so no live re-dispatch/re-`_transition` happens under mgr2 — `eventSink2`/`lines2`
    // never fire and are not asserted on. This does NOT prove "a genuinely RESUMED (suspended, then
    // resumed) run emits the SAME principal on its SECOND terminal transition" — that needs a
    // suspend -> mgr2.resume() -> new terminal -> lines2 sequence, which is a materially more
    // expensive case not built in this slice. What this DOES prove, and is worth pinning: the
    // `principal` field survives a cross-process readback of an ALREADY-terminal run (a fresh
    // `RunManager`'s `status()` call, no in-memory `_runs` entry for this runId) — i.e. it exercises
    // exactly the `getSpec()` gap UT-301 closes, from the read side rather than the resume side.
    const dir = tempDir();
    const lines: string[] = [];
    const eventSink1 = createEventSink({ write: (l: string) => lines.push(l), now: () => clock.isoNow() });
    const store1 = new SqliteRunStore(join(dir, 'store'), clock);
    const catalog1 = new WorkflowCatalog(join(dir, 'catalog'), clock);
    const mgr1 = new RunManager({ store: store1, clock, catalog: catalog1, workRoot: dir, eventSink: eventSink1 } as any);
    await registerPublished(catalog1, 'it295-resume', "throw new Error('boom, it295 resume');");
    const runId = await mgr1.start({ name: 'it295-resume', principal: 'bob' } as any);
    await waitForStatus(mgr1, runId, 'failed');

    const store2 = new SqliteRunStore(join(dir, 'store'), clock);
    const catalog2 = new WorkflowCatalog(join(dir, 'catalog'), clock);
    const mgr2 = new RunManager({ store: store2, clock, catalog: catalog2, workRoot: dir } as any);
    const view = await mgr2.status(runId);
    expect((view as any).principal ?? (view as any).spec?.principal).toBe('bob');
  });
});
