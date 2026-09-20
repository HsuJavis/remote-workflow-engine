// IT (DES-232, ARCH-142, TASK-236, REQ-205, REQ-005/055/117 re-proof): the failure reason survives
// a process restart — a SECOND `RunManager` over the SAME SQLite file answers `run_result` with the
// stored `{code,message}`, never `RUN_NOT_TERMINAL` for a genuinely terminal `failed` run. Also:
// redact-at-capture with a real secret, and the two honesty cases (a pre-v35 NULL-error row; a
// stale-column `interrupted` row). Written test-first (Gate 5, RED) — today `result()`
// unconditionally answers `RUN_NOT_TERMINAL` for any run absent from the in-process `_runs` map
// whose `getResult()` is empty, regardless of the stored row's actual (terminal) status.
//
// Mock policy (integration): real SqliteRunStore over a real temp file, real RunManager, real
// sandbox (script genuinely throws) — no mock of the SUT boundary.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { RunManager } from '../../src/run-manager.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { RunStatus } from '../../src/types.js';
import type { SecretValueProvider } from '../../src/secret-resolver.js';
import { registerPublished } from '../helpers/workflow-fixtures.js';

const clock = new FixedClock(new Date('2026-09-21T00:00:00.000Z'));

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'rwe-it232-restart-'));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function waitForStatus(mgr: RunManager, runId: string, want: RunStatus, maxIters = 120): Promise<void> {
  for (let i = 0; i < maxIters; i++) {
    const view = await mgr.status(runId);
    if (view.status === want) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitForStatus: run ${runId} never reached ${want} in time`);
}

describe('run_result after a restart answers the STORED reason, never RUN_NOT_TERMINAL for a terminal run (IT, DES-232)', () => {
  it('a SECOND RunManager over the same file answers the same {code,message} the first captured', async () => {
    const dir = tempDir();
    const store1 = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr1 = new RunManager({ store: store1, clock, workRoot: dir } as never);
    const name = 'it232-restart';
    await registerPublished(mgr1.catalog, name, "throw new Error('boom, IT-232 restart');");
    const runId = await mgr1.start({ name });
    await waitForStatus(mgr1, runId, 'failed');

    // fresh process simulation: a brand-new RunManager/store instance over the SAME file, with NO
    // in-memory `_runs` entry for this runId.
    const store2 = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr2 = new RunManager({ store: store2, clock, workRoot: dir } as never);
    const result = await mgr2.result(runId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).not.toBe('RUN_NOT_TERMINAL');
    expect(result.error.message).toMatch(/boom, IT-232 restart/);
  });

  it('a pre-v35 row (failed, error column NULL) answers RUN_FAILED — "no reason was recorded", never RUN_NOT_TERMINAL', async () => {
    const dir = tempDir();
    const store1 = new SqliteRunStore(join(dir, 'store'), clock);
    const runId = await store1.createRun({ script: 'return 1;' });
    const db = new Database(join(dir, 'store', 'index.db'));
    db.prepare("UPDATE runs SET status = 'failed' WHERE runId = ?").run(runId);
    db.close();

    const store2 = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr2 = new RunManager({ store: store2, clock, workRoot: dir } as never);
    const result = await mgr2.result(runId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RUN_FAILED');
    expect(result.error.message).toMatch(/no reason was recorded/i);
  });

  it('an `interrupted` row with a stale non-NULL error column still answers RUN_NOT_TERMINAL (gated read)', async () => {
    const dir = tempDir();
    const store1 = new SqliteRunStore(join(dir, 'store'), clock);
    const runId = await store1.createRun({ script: 'return 1;' });
    const db = new Database(join(dir, 'store', 'index.db'));
    db.prepare("UPDATE runs SET status = 'failed' WHERE runId = ?").run(runId);
    db.close();
    await (store1 as unknown as { recordError(r: string, e: unknown): Promise<void> }).recordError(runId, { code: 'SCRIPT_ERROR', message: 'stale' });
    const db2 = new Database(join(dir, 'store', 'index.db'));
    db2.prepare("UPDATE runs SET status = 'interrupted' WHERE runId = ?").run(runId); // REQ-060 reclassification
    db2.close();

    const store2 = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr2 = new RunManager({ store: store2, clock, workRoot: dir } as never);
    const result = await mgr2.result(runId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RUN_NOT_TERMINAL');
  });
});

describe('redact-at-capture with a REAL injected secret (IT, DES-232)', () => {
  it('the marker is PRESENT in runs.error and in journal.jsonl; the raw secret is ABSENT from both', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const SECRET_NAME = 'IT232_TOKEN';
    const SECRET_VALUE = 'it232-secret-tok-9f8e7d6c5b';
    const secretValueProvider: SecretValueProvider = { entries: () => [{ name: SECRET_NAME, value: SECRET_VALUE }] };
    const mgr = new RunManager({ store, clock, workRoot: dir, secretValueProvider } as never);
    const name = 'it232-redact';
    await registerPublished(mgr.catalog, name, `throw new Error('leaked: ${SECRET_VALUE}');`);
    const runId = await mgr.start({ name });
    await waitForStatus(mgr, runId, 'failed');

    const getError = (store as unknown as { getError(r: string): Promise<{ code: string; message: string } | null> }).getError.bind(store);
    const stored = await getError(runId);
    expect(stored).not.toBeNull();
    expect(stored?.message).toContain(`‹secret:${SECRET_NAME}›`);
    expect(stored?.message).not.toContain(SECRET_VALUE);

    const journalText = readFileSync(join(dir, 'store', 'runs', runId, 'journal.jsonl'), 'utf8');
    expect(journalText).toContain(`‹secret:${SECRET_NAME}›`);
    expect(journalText).not.toContain(SECRET_VALUE);
  });
});
