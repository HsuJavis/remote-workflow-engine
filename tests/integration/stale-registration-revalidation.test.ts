// Issue #154 B1-B4 (2026-10-07 reverify): every new static registration rule only gated FRESH
// registrations — an already-registered row never got re-checked, so it kept `runnable:true` and
// kept reproducing whatever bug the new rule exists to catch, forever. `WorkflowCatalog.
// validateStoredVersion` re-runs the SAME static checks against a resolved version's STORED
// script (workflow-catalog.test.ts covers it directly); this file proves the three real admission
// doors actually CALL it: run_start, run_resume, and a nested workflow() call.
//
// A real `register()`/`insertVersion` call always runs the CURRENT rule set, so it can never
// itself produce a "stale" row — exactly why the tester's own reverify and `validateStoredVersion`'s
// own unit tests seed one by mutating the stored script directly AFTER a healthy registration
// (simulating "a rule was added after this version was registered", the one shape `register()`
// cannot reach on its own).
//
// Mock policy (integration, mirrors nested-workflow-args-validation.test.ts / run-args-resume.
// test.ts): real RunManager + real on-disk WorkflowCatalog/SqliteRunStore; a trivial AgentSpawner
// (the subject here is admission, never agent() dispatch itself).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { RunManager } from '../../src/run-manager.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { RunStatus } from '../../src/types.js';
import type { AgentSpawner, AgentOutcome } from '../../src/agent-executor.js';
import { registerPublished, startScript } from '../helpers/workflow-fixtures.js';

const clock = new FixedClock(new Date('2026-10-07T00:00:00.000Z'));
const spawner: AgentSpawner = { run: async (): Promise<AgentOutcome> => ({ kind: 'text', value: 'ok' }) };

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'rwe-it154-'));
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

// The exact #154 NEW-HIGH repro: a literal `allowedTools:` key whose value is a variable —
// `scanAgentCalls` refuses this TODAY (AGENT_OPTS_VALUE_NOT_LITERAL), but a row that predates that
// rule (simulated here by mutating the stored script directly, since `register()` itself always
// runs the current rules and could never produce this row) has no OTHER way to ever be re-checked.
const STALE_SCRIPT =
  "export const meta = { phases: [] };\n" +
  "const tools = ['Bash', 'Write'];\n" +
  "return await agent('a', { prompt: 'x', allowedTools: tools });";

function mutateStoredScript(dir: string, name: string, version: string, script: string): void {
  const db = new Database(join(dir, 'catalog.db'));
  db.prepare('UPDATE workflow_versions SET script = ? WHERE name = ? AND version = ?').run(script, name, version);
  db.close();
}

describe('run_start re-validates an already-stored version against the CURRENT rule set (#154 B1-B4)', () => {
  it('a healthy registration still runs fine (no false positive)', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    const runId = await startScript(mgr, 'return 1;');
    await waitForStatus(mgr, runId, 'completed');
    expect(await mgr.result(runId)).toEqual({ ok: true, value: 1 });
  });

  it('a version that now fails the #154 NEW-HIGH scan rule is refused NOT_RUNNABLE at run_start, naming the violation', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    const name = 'it154-stale-start';
    const { version } = await registerPublished(mgr.catalog, name, 'return 1;');
    mutateStoredScript(dir, name, version, STALE_SCRIPT);
    await expect(mgr.start({ origin: 'local', name })).rejects.toMatchObject({
      code: 'NOT_RUNNABLE',
      detail: { violation: 'AGENT_OPTS_VALUE_NOT_LITERAL' },
    });
  });
});

describe('run_resume re-validates the version it would actually run (#154 B1-B4)', () => {
  it('a version mutated to fail the scan rule AFTER a run already started is refused NOT_RUNNABLE on resume, not silently dispatched', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    const name = 'it154-stale-resume';
    const SUSPENDABLE =
      "export const meta = { params: { agents: { worker: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, " +
      "effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, " +
      "timeoutMs: { type: 'number', default: 60000 } } } } };\n" +
      "phase('main');\n" +
      "await agent('worker', {});\n" +
      "return 'done';";
    const { version } = await registerPublished(mgr.catalog, name, SUSPENDABLE);
    const runId = await mgr.start({ origin: 'local', name });
    await mgr.suspend(runId);

    // Simulate "a rule was added after this version was registered": mutate the STORED script (the
    // one register() wrote) to one that fails the CURRENT scan rule — a fresh RunManager so its
    // validateStoredVersion cache starts empty for this key.
    mutateStoredScript(dir, name, version, STALE_SCRIPT);
    const mgr2 = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    await expect(mgr2.resume(runId)).rejects.toMatchObject({
      code: 'NOT_RUNNABLE',
      detail: { violation: 'AGENT_OPTS_VALUE_NOT_LITERAL' },
    });
  });
});

describe('a nested workflow() call re-validates the CHILD version it would actually run (#154 B1-B4)', () => {
  it("composing a child version mutated to fail the scan rule is refused NOT_RUNNABLE from the parent script's own try/catch, no child run ever created", async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    const childName = 'it154-stale-nested-child';
    const { version } = await registerPublished(mgr.catalog, childName, 'return 1;');
    mutateStoredScript(dir, childName, version, STALE_SCRIPT);
    // IPC error envelopes (sandbox/host.ts) carry {code, message} only — never `.detail` — so a
    // script-level catch (mirrors nested-workflow-args-validation.test.ts's own TRY_WORKFLOW
    // convention) asserts on `e.code` alone; `detail.violation` is asserted directly below via
    // the private `_handleWorkflowRequest` entry point, same as that file's own [LOW-2] case.
    const runId = await startScript(
      mgr,
      `try { const r = await workflow('${childName}', {}); return { ok: true, r }; } catch (e) { return { code: e && (e.code || e.name) }; }`,
    );
    await waitForStatus(mgr, runId, 'completed');
    const result = await mgr.result(runId);
    expect(result).toEqual({ ok: true, value: { code: 'NOT_RUNNABLE' } });
    expect((await mgr.status(runId)).workflowNodes).toEqual([]);
  });

  it('the refusal names the specific violation via the direct admission entry point', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    const childName = 'it154-stale-nested-detail';
    const { version } = await registerPublished(mgr.catalog, childName, 'return 1;');
    mutateStoredScript(dir, childName, version, STALE_SCRIPT);
    const parentRunId = await mgr.start({ origin: 'local' }); // ad-hoc no-op top-level run, just to own an entry
    const handle = (mgr as unknown as { _handleWorkflowRequest: (...a: unknown[]) => Promise<unknown> })._handleWorkflowRequest.bind(mgr);
    await expect(handle(parentRunId, childName, {}, '', 0, 1, new Set<string>())).rejects.toMatchObject({
      code: 'NOT_RUNNABLE',
      detail: { violation: 'AGENT_OPTS_VALUE_NOT_LITERAL' },
    });
  });
});

// Issue #154 B4 PARTIAL left open (2026-10-07 reverify): `_computeStoredVersionValidity` never
// re-checked name validity, so a stored row whose NAME predates `isValidBareName` (seeded directly
// — `register()` itself cannot produce such a row any more) stayed `runnable:true` and actually
// completed a `run_start`. The live reverify's own repro renamed a row to `../store` — the SAME
// name this file's own `workFolder()` fix (workflow-catalog.ts) now also refuses outright, since
// `join(workRoot, 'workflows', '../store')` used to resolve to `<workRoot>/store`, aliasing this
// very test file's own `SqliteRunStore` directory.
// 2026-10-08 integration (rv) fix (MINOR, reverify): `_computeStoredVersionValidity` used to
// short-circuit `scan.unscannable` straight to `{ok:true}` — the EXCEPTION meant to grandfather
// `AGENT_OPT_RETIRED` for the `agentType` retirement, but broadened by accident to the unscannable
// case too, which has no such grandfathering intent (it never shipped a per-call runtime guard the
// way `agentType` did). `workflow_describe` already reports this row `runnable:false`/
// `NOT_RUNNABLE` (`toolSurfaceUnscannable`), but every admission door below ADMITTED it anyway. The
// SAME `nonCodeOracle` parse failure `tests/unit/workflow-meta-scan.test.ts` uses.
const UNSCANNABLE_SCRIPT = "export const meta = {};\nconst x = ((((;";

describe('run_start/run_resume/nested workflow() refuse an unscannable stored row NOT_RUNNABLE, agreeing with workflow_describe (#157 agreement, unscannable case)', () => {
  it('a version mutated to an unscannable script is refused NOT_RUNNABLE at run_start', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    const name = 'it157-unscannable-start';
    const { version } = await registerPublished(mgr.catalog, name, 'return 1;');
    mutateStoredScript(dir, name, version, UNSCANNABLE_SCRIPT);
    await expect(mgr.start({ origin: 'local', name })).rejects.toMatchObject({ code: 'NOT_RUNNABLE' });
  });

  it('a version mutated to an unscannable script AFTER a run already started is refused NOT_RUNNABLE on resume, not silently dispatched', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    const name = 'it157-unscannable-resume';
    const SUSPENDABLE =
      "export const meta = { params: { agents: { worker: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, " +
      "effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, " +
      "timeoutMs: { type: 'number', default: 60000 } } } } };\n" +
      "phase('main');\n" +
      "await agent('worker', {});\n" +
      "return 'done';";
    const { version } = await registerPublished(mgr.catalog, name, SUSPENDABLE);
    const runId = await mgr.start({ origin: 'local', name });
    await mgr.suspend(runId);

    mutateStoredScript(dir, name, version, UNSCANNABLE_SCRIPT);
    const mgr2 = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    await expect(mgr2.resume(runId)).rejects.toMatchObject({ code: 'NOT_RUNNABLE' });
  });

  it("composing a child version mutated to an unscannable script is refused NOT_RUNNABLE from the parent script's own try/catch, no child run ever created", async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    const childName = 'it157-unscannable-nested-child';
    const { version } = await registerPublished(mgr.catalog, childName, 'return 1;');
    mutateStoredScript(dir, childName, version, UNSCANNABLE_SCRIPT);
    const runId = await startScript(
      mgr,
      `try { const r = await workflow('${childName}', {}); return { ok: true, r }; } catch (e) { return { code: e && (e.code || e.name) }; }`,
    );
    await waitForStatus(mgr, runId, 'completed');
    const result = await mgr.result(runId);
    expect(result).toEqual({ ok: true, value: { code: 'NOT_RUNNABLE' } });
    expect((await mgr.status(runId)).workflowNodes).toEqual([]);
  });
});

describe("run_start refuses a stored row whose NAME is no longer valid (#154 B4 PARTIAL)", () => {
  it("a stored row named '../store' is refused NOT_RUNNABLE at run_start, and its workspace is never created at the run store's own directory", async () => {
    const dir = tempDir();
    const storeDir = join(dir, 'store');
    const store = new SqliteRunStore(storeDir, clock);
    const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    const name = '../store';
    const placeholder = 'it154new-b4-placeholder';
    // `register()` itself refuses `../store` today (INVALID_NAME) — register under a VALID
    // placeholder name first, then simulate the pre-#154-B4 row a real registration can no longer
    // produce by renaming the already-inserted row directly (the same "already-migrated cohort"
    // technique this file's own STALE_SCRIPT cases use for the script column, applied to the name
    // column instead).
    const { version } = await registerPublished(mgr.catalog, placeholder, 'return 1;');
    const db = new Database(join(dir, 'catalog.db'));
    db.prepare('UPDATE workflows SET name = ? WHERE name = ?').run(name, placeholder);
    db.prepare('UPDATE workflow_versions SET name = ? WHERE name = ?').run(name, placeholder);
    db.close();

    await expect(mgr.start({ origin: 'local', name, version })).rejects.toMatchObject({
      code: 'NOT_RUNNABLE',
      detail: { violation: 'INVALID_NAME' },
    });

    // The engine's own run-store directory is untouched — no agent workspace was ever created
    // inside it (the collision the live reverify actually measured).
    expect(existsSync(storeDir)).toBe(true); // created by SqliteRunStore itself, not by this run
    expect(existsSync(join(storeDir, 'runs'))).toBe(false);
  });
});
