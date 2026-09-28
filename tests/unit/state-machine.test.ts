// UT-003: Run state machine transitions (DES-003)
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { IllegalTransitionError } from '../../src/errors.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { SystemClock } from '../../src/clock.js';
import { startScript } from '../helpers/workflow-fixtures.js';

describe('Run state machine', () => {
  it('start transitions run from queued to running', async () => {
    const mgr = new RunManager();
    const runId = await startScript(mgr, 'return 1;');
    const view = await mgr.status(runId);
    expect(['queued', 'running']).toContain(view.status);
  });

  it('resume on a running run throws IllegalTransitionError', async () => {
    const mgr = new RunManager();
    const runId = await startScript(mgr, 'return 1;');
    await expect(mgr.resume(runId)).rejects.toThrow(IllegalTransitionError);
  });

  it('suspend on a non-running run throws IllegalTransitionError', async () => {
    const mgr = new RunManager();
    await expect(mgr.suspend('no-such-run')).rejects.toThrow(IllegalTransitionError);
  });

  it('stop transitions run to stopped state', async () => {
    const mgr = new RunManager();
    const runId = await startScript(mgr, 'while(true){}');
    await mgr.stop(runId);
    const view = await mgr.status(runId);
    expect(view.status).toBe('stopped');
  });

  // issue #94 (owner decision): `stopped` is a TRUE terminal state — resume must refuse it, not
  // revive it. Superseded by suspend/resume's own cached-prefix replay coverage elsewhere
  // (resume-legacy-substitution-admission.test.ts, IT-056); this file only needs to pin the refusal.
  it('resume after stop is refused ILLEGAL_TRANSITION "stopped → running" (issue #94), never revives the run', async () => {
    const mgr = new RunManager();
    const runId = await startScript(mgr, 'return 1;');
    await mgr.stop(runId);
    await expect(mgr.resume(runId)).rejects.toMatchObject({
      code: 'ILLEGAL_TRANSITION',
      message: expect.stringContaining('stopped → running'),
    });
    // no state change: the run stays stopped, not silently revived.
    const view = await mgr.status(runId);
    expect(view.status).toBe('stopped');
  });
});

// issue #92 item 2: `_requireLive`'s ('unknown', 'transition') hardcode (shared by suspend/resume/
// stop) used to render every one of these refusals as the same meaningless "Illegal state
// transition: unknown → transition" no matter which run, which status, or which operation was
// asked for. The real current status (or 'not found') and the real intended target are threaded
// through instead — these tests read the MESSAGE, not just the error class the tests above already
// pin, since the class alone cannot tell "completed → suspended" apart from "unknown → transition".
describe('IllegalTransitionError message names the real status and target (issue #92 item 2)', () => {
  const dirs: string[] = [];
  function tempDir(): string {
    const d = mkdtempSync(join(tmpdir(), 'rwe-state-msg-'));
    dirs.push(d);
    return d;
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('suspend on a run whose stored status is terminal (completed) names BOTH sides: "completed → suspended"', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(dir, new SystemClock());
    const mgr = new RunManager({ store, workRoot: tempDir() });
    const runId = await store.createRun({ origin: 'local', script: 'return 1;', name: 'msg-suspend' });
    await store.recordTransition(runId, null, 'queued', new Date().toISOString());
    await store.recordTransition(runId, 'queued', 'completed', new Date().toISOString());

    await expect(mgr.suspend(runId)).rejects.toMatchObject({
      code: 'ILLEGAL_TRANSITION',
      message: expect.stringContaining('completed → suspended'),
    });
  });

  it('resume on a run whose stored status is terminal (failed) names "failed → running"', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(dir, new SystemClock());
    const mgr = new RunManager({ store, workRoot: tempDir() });
    const runId = await store.createRun({ origin: 'local', script: 'return 1;', name: 'msg-resume' });
    await store.recordTransition(runId, null, 'queued', new Date().toISOString());
    await store.recordTransition(runId, 'queued', 'failed', new Date().toISOString());

    await expect(mgr.resume(runId)).rejects.toMatchObject({
      code: 'ILLEGAL_TRANSITION',
      message: expect.stringContaining('failed → running'),
    });
  });

  it('stop on a run whose stored status is already terminal (stopped) names "stopped → stopped"', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(dir, new SystemClock());
    const mgr = new RunManager({ store, workRoot: tempDir() });
    const runId = await store.createRun({ origin: 'local', script: 'return 1;', name: 'msg-stop' });
    await store.recordTransition(runId, null, 'queued', new Date().toISOString());
    await store.recordTransition(runId, 'queued', 'stopped', new Date().toISOString());

    await expect(mgr.stop(runId)).rejects.toMatchObject({
      code: 'ILLEGAL_TRANSITION',
      message: expect.stringContaining('stopped → stopped'),
    });
  });

  it('a genuinely nonexistent run names "not found", never the literal "unknown"', async () => {
    const mgr = new RunManager();
    await expect(mgr.suspend('does-not-exist-at-all')).rejects.toMatchObject({
      code: 'ILLEGAL_TRANSITION',
      message: expect.stringContaining('not found → suspended'),
    });
    await expect(mgr.resume('does-not-exist-at-all')).rejects.toMatchObject({
      message: expect.stringContaining('not found → running'),
    });
    await expect(mgr.stop('does-not-exist-at-all')).rejects.toMatchObject({
      message: expect.stringContaining('not found → stopped'),
    });
  });
});
