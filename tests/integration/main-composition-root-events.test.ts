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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import { createEventSink } from '../../src/event-log.js';
import { registerPublished, registerPublishedVia, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';
import { createServer, type Server } from '../../src/server.js';
import { FIXTURE_SCRIPT, FIXTURE_MERMAID } from '../../src/tool-specs.js';

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
    await (catalog as any).deregisterVersion('it294-dereg', version, actor, null);

    const deregLine = lines.map((l) => JSON.parse(l)).find((e) => e.kind === 'catalog.deregister');
    expect(deregLine).toMatchObject({ name: 'it294-dereg', version });
  });
});

// P1 (Gate-8 send-back): the ACTUAL production composition root, `src/server.ts`'s `createServer()`,
// never calls `createEventSink` at all — confirmed by reading the file (no `createEventSink` call
// site in server.ts or main.ts). `secretValueProvider` is built at server.ts:748 and handed to
// `RunManager` at :782, but no sink construction ever threads it in, so both `WorkflowCatalog` and
// `RunManager` fall back to their own `createEventSink({})` default (no secrets) — production writes
// UNREDACTED secret values into the audit log. The `boot()` helper above bypasses this entirely (it
// hand-builds an eventSink with a shared instance, the way `src/main.ts` is SUPPOSED to but doesn't);
// this describe block instead drives the real `createServer()` HTTP entry point, the only way to
// observe server.ts's own composition-root wiring rather than re-implementing the intended wiring in
// the test.
describe('P1: the REAL createServer() composition root wires a secrets-aware sink (Gate-8 send-back)', () => {
  const SECRET_NAME = 'IT294_P1_GUARD';
  let server: Server | undefined;
  let workRoot: string;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    delete process.env[`RWE_SECRET_${SECRET_NAME}`];
    if (workRoot) rmSync(workRoot, { recursive: true, force: true });
  });

  it('a workflow_register whose name carries a real env secret never appears raw in the audit log console output', async () => {
    const secretValue = 'p1guard7f3ac9';
    process.env[`RWE_SECRET_${SECRET_NAME}`] = secretValue;
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it294-p1-'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot });

    const name = `${uniqueWorkflowName('it294-p1')}-${secretValue}`;
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'workflow_register', arguments: { name, script: FIXTURE_SCRIPT, mermaid: FIXTURE_MERMAID } },
      }),
    });
    expect(res.status).toBe(200);

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    logSpy.mockRestore();
    const registerLine = lines.find((l) => { try { return JSON.parse(l).kind === 'catalog.register'; } catch { return false; } });
    expect(registerLine).toBeDefined(); // sanity: the audit line was actually emitted
    expect(registerLine).not.toContain(secretValue); // the raw secret must never reach the audit log
    expect(registerLine).toContain(`‹secret:${SECRET_NAME}›`); // the sink built here must carry the SAME secretValueProvider RunManager gets
  });

  // P1 gap (advisor review): the case above alone leaves the OTHER constructor uncovered — deleting
  // `eventSink` from the `RunManager` deps at server.ts's composition root would leave this case
  // green while `run.terminal` leaks. This case drives a real failed run through `run_start`/
  // `run_status` and inspects the `run.terminal` line specifically, so BOTH constructors (DES-243's
  // "either" requirement) are proven wired to the SAME secrets-aware sink.
  it('a run.terminal line for a failed run whose NAME carries a real env secret never appears raw either', async () => {
    const secretValue = 'p1guard-term-9c2e14';
    process.env[`RWE_SECRET_${SECRET_NAME}`] = secretValue;
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it294-p1-term-'));
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot });

    const name = `${uniqueWorkflowName('it294-p1-term')}-${secretValue}`;
    async function mcpCall(method: string, args: Record<string, unknown>): Promise<any> {
      const res = await fetch(`http://127.0.0.1:${server!.port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: method, arguments: args } }),
      });
      const json = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
      const text = json.result?.content?.[0]?.text;
      return text !== undefined ? JSON.parse(text) : json;
    }
    await registerPublishedVia(mcpCall, name, "throw new Error('boom');");

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const run = await mcpCall('run_start', { name });
    let status: any;
    for (let i = 0; i < 60; i++) {
      status = await mcpCall('run_status', { runId: run.runId });
      if (['completed', 'failed'].includes(status.status)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(status.status).toBe('failed');

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    logSpy.mockRestore();
    const terminalLine = lines.find((l) => { try { return JSON.parse(l).kind === 'run.terminal'; } catch { return false; } });
    expect(terminalLine).toBeDefined(); // sanity: the audit line was actually emitted
    expect(terminalLine).not.toContain(secretValue); // RunManager's sink must be the SAME secrets-aware instance
    expect(terminalLine).toContain(`‹secret:${SECRET_NAME}›`);
  });
});
