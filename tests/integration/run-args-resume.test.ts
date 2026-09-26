// IT (DES-233, ARCH-144, ADR-071, TASK-236, REQ-206): `args` is resolved ONCE at admission
// (defaults materialized from `meta.params.args.<k>.default`), dispatched from `runs.args`/
// `entry.args` on every path (first dispatch, suspend→resume, restart-rehydrate→resume), and
// recorded (as the RESOLVED record) in `runs.effective_params.args`. Written test-first (Gate 5,
// RED) — a bare `run_start` gives the script `null` today (`spec.args ?? {}` is not yet in
// `start()`, and `materializeArgDefaults` does not exist), and a declared `args.<k>.default` is
// refused at registration outright (P6-3, see params-contract.test.ts).
//
// Mock policy (integration): real SqliteRunStore + real RunManager + real sandbox; a trivial
// spawner (no real gateway needed — legal per DES-091, the subject here is admission/dispatch of
// `args`, not agent() dispatch itself).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { RunManager } from '../../src/run-manager.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { RunStatus } from '../../src/types.js';
import type { AgentSpawner, AgentOutcome } from '../../src/agent-executor.js';
import type { SecretValueProvider } from '../../src/secret-resolver.js';
import { registerPublished } from '../helpers/workflow-fixtures.js';

const clock = new FixedClock(new Date('2026-09-21T00:00:00.000Z'));
const spawner: AgentSpawner = { run: async (): Promise<AgentOutcome> => ({ kind: 'text', value: 'ok' }) };

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'rwe-it233-'));
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

// A script with NO agent() calls and no meta — completes synchronously, no suspend needed. Proves
// the bare-run_start / declared-default cases without needing the suspend/resume machinery.
const BARE_SCRIPT = 'return args;';
const DEFAULT_SCRIPT =
  "export const meta = { params: { args: { url: { type: 'string', default: 'https://x' } } } };\n" +
  'return args;';

describe('args resolution at admission — the bare and declared-default cases (DES-233, IT)', () => {
  it('a bare run_start (no args) gives the script {}, not null', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    const name = 'it233-bare';
    await registerPublished(mgr.catalog, name, BARE_SCRIPT);
    const runId = await mgr.start({ origin: 'local', name });
    await waitForStatus(mgr, runId, 'completed');
    const result = await mgr.result(runId);
    expect(result).toEqual({ ok: true, value: {} });
  });

  it('a declared args.url.default reaches the script AND runs.effective_params.args', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    const name = 'it233-default';
    await registerPublished(mgr.catalog, name, DEFAULT_SCRIPT);
    const runId = await mgr.start({ origin: 'local', name });
    await waitForStatus(mgr, runId, 'completed');
    const result = await mgr.result(runId);
    expect(result).toEqual({ ok: true, value: { url: 'https://x' } });

    const effective = await store.getEffectiveParams(runId);
    expect((effective as unknown as { args?: Record<string, unknown> })?.args).toEqual({ url: 'https://x' });
  });

  it('a caller-supplied arg WINS over the declared default', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    const name = 'it233-override';
    await registerPublished(mgr.catalog, name, DEFAULT_SCRIPT);
    const runId = await mgr.start({ origin: 'local', name, args: { url: 'https://caller' } });
    await waitForStatus(mgr, runId, 'completed');
    const result = await mgr.result(runId);
    expect(result).toEqual({ ok: true, value: { url: 'https://caller' } });
  });
});

// A one-agent script so the run can be suspended mid-flight (the bare-return scripts above
// complete synchronously and have nothing to suspend across).
const SUSPENDABLE_SCRIPT =
  "export const meta = { params: { agents: { worker: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, " +
  "effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, " +
  "timeoutMs: { type: 'number', default: 60000 } } }, args: { url: { type: 'string', default: 'https://x' } } } };\n" +
  "phase('main');\n" +
  "const seen = args.url;\n" +
  "await agent('worker', {});\n" +
  "return seen;";

describe('args survive suspend->resume and restart-rehydrate->resume with the SAME value (DES-233, IT)', () => {
  it('suspend then resume (same process): the resumed script sees the SAME resolved args', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    const name = 'it233-suspend-resume';
    await registerPublished(mgr.catalog, name, SUSPENDABLE_SCRIPT);
    const runId = await mgr.start({ origin: 'local', name });
    await mgr.suspend(runId);

    const mgr2 = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    await mgr2.resume(runId);
    await waitForStatus(mgr2, runId, 'completed');
    const result = await mgr2.result(runId);
    expect(result).toEqual({ ok: true, value: 'https://x' });
  });

  it('restart-rehydrate then resume (fresh store instance): the resumed script sees the SAME resolved args', async () => {
    const dir = tempDir();
    const store1 = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr1 = new RunManager({ store: store1, clock, workRoot: dir, spawner } as never);
    const name = 'it233-restart-resume';
    await registerPublished(mgr1.catalog, name, SUSPENDABLE_SCRIPT);
    const runId = await mgr1.start({ origin: 'local', name });
    await mgr1.suspend(runId);

    const store2 = new SqliteRunStore(join(dir, 'store'), clock);
    await store2.hydrateAll(); // boot recovery pass, mirroring a real process restart
    const mgr2 = new RunManager({ store: store2, clock, workRoot: dir, spawner } as never);
    await mgr2.resume(runId);
    await waitForStatus(mgr2, runId, 'completed');
    const result = await mgr2.result(runId);
    expect(result).toEqual({ ok: true, value: 'https://x' });
  });

  it('a planted legacy args=\'null\' row resumes to {} (never a crash, never literal null)', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const mgr = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    const name = 'it233-legacy-null';
    await registerPublished(mgr.catalog, name, "await agent('worker', {});\nreturn args;");
    const runId = await mgr.start({ origin: 'local', name });
    await mgr.suspend(runId);

    const db = new Database(join(dir, 'store', 'index.db'));
    db.prepare("UPDATE runs SET args = 'null' WHERE runId = ?").run(runId);
    db.close();

    const mgr2 = new RunManager({ store, clock, workRoot: dir, spawner } as never);
    await mgr2.resume(runId);
    await waitForStatus(mgr2, runId, 'completed');
    const result = await mgr2.result(runId);
    expect(result).toEqual({ ok: true, value: {} });
  });

  it('an arg carrying a provisioned secret value still resumes, with the RAW value dispatched (marker scan excludes args)', async () => {
    const dir = tempDir();
    const store = new SqliteRunStore(join(dir, 'store'), clock);
    const SECRET_NAME = 'IT233_TOKEN';
    const SECRET_VALUE = 'it233-secret-abc123xyz';
    const secretValueProvider: SecretValueProvider = { entries: () => [{ name: SECRET_NAME, value: SECRET_VALUE }] };
    const mgr = new RunManager({ store, clock, workRoot: dir, spawner, secretValueProvider } as never);
    const name = 'it233-secret-arg';
    const script =
      "export const meta = { params: { agents: { worker: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, " +
      "effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, " +
      "timeoutMs: { type: 'number', default: 60000 } } } } };\n" +
      "phase('main');\n" +
      "const seen = args.token;\n" +
      "await agent('worker', {});\n" +
      "return seen;";
    await registerPublished(mgr.catalog, name, script);
    const runId = await mgr.start({ origin: 'local', name, args: { token: SECRET_VALUE } });
    await mgr.suspend(runId);

    const mgr2 = new RunManager({ store, clock, workRoot: dir, spawner, secretValueProvider } as never);
    await expect(mgr2.resume(runId)).resolves.not.toThrow();
    await waitForStatus(mgr2, runId, 'completed');
    const result = await mgr2.result(runId);
    expect(result).toEqual({ ok: true, value: SECRET_VALUE }); // raw value dispatched, not a marker
  });
});
