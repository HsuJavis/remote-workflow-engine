// issue #107 (medium): nested workflow() skipped args type/enum/min/max validation — a caller
// script's `await workflow(name, args)` reached the CHILD's own run with no admission check at all,
// so any bound the child's `meta.params.args` declared (type/enum/min/max) was reachable ONLY via
// `run_start`, never via a sibling workflow composing it. Since the nested path has no ownership
// gate (a `workflow()` call resolves the named child's `release` channel regardless of who is
// running the calling script), this was a cross-principal prompt-injection door into another
// principal's released workflow.
//
// Fix: `_handleWorkflowRequest` (src/run-manager.ts) now applies the SAME materialize-defaults +
// `validateDeclaredArgs` admission `start()` already applied to a top-level `run_start` submission,
// against the CHILD's own contract, BEFORE the `WorkflowNodeView` sub-card is pushed or the nested
// `SandboxHost` is even constructed — so a refused call leaves `status.workflowNodes` empty (no
// child run/record of any kind) and the caller script's `workflow()` call rejects with the identical
// coded error `run_start` would have thrown for the same bad args.
//
// Mock policy (integration, mirrors nested-workflow-n-level.test.ts): real RunManager + real
// on-disk WorkflowCatalog; an `echoSpawner` AgentSpawner stand-in (none of these cases dispatch an
// agent() at all — the refusal fires before any agent() in the child script could run).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { AgentSpawner } from '../../src/agent-executor.js';
import { registerPublished, startScript, DEFAULT_FIXTURE_MODEL } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

function echoSpawner(): AgentSpawner {
  return { async run(req) { return { kind: 'text', value: req.prompt }; } };
}

async function pollUntilSettled(mgr: RunManager, runId: string) {
  let view = await mgr.status(runId);
  for (let i = 0; i < 300 && (view.status === 'running' || view.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 25));
    view = await mgr.status(runId);
  }
  return view;
}

async function completedValue(mgr: RunManager, runId: string): Promise<unknown> {
  const view = await pollUntilSettled(mgr, runId);
  expect(view.status).toBe('completed');
  const result = await mgr.result(runId);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

// Every caller script below wraps its own `workflow()` call in try/catch and returns `{code}` —
// the same shape `nested-workflow-n-level.test.ts` already uses for its own coded-refusal cases.
const TRY_WORKFLOW = (expr: string) => `try { const r = await ${expr}; return { ok: true, r }; } catch (e) { return { code: e && (e.code || e.name) }; }`;

describe('issue #107: nested workflow() applies the CHILD contract\'s args validation before any child run exists', () => {
  let workRoot: string;
  let catalog: WorkflowCatalog;
  let mgr: RunManager;

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-nested-args-'));
    catalog = new WorkflowCatalog(workRoot, CLOCK);
    const store = new InMemoryRunStore(CLOCK);
    mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner() });
  });
  afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it('a wrong-type arg is refused PARAM_OUT_OF_RANGE and no child run/record is ever created', async () => {
    await registerPublished(catalog, 'c107-badtype', `export const meta = { params: { args: { x: { type: 'number' } } } };\nreturn 'child-ran:' + args.x;`);
    const runId = await startScript(mgr, TRY_WORKFLOW(`workflow('c107-badtype', { x: 'HARMLESS-NOT-A-NUMBER' })`));
    expect(await completedValue(mgr, runId)).toEqual({ code: 'PARAM_OUT_OF_RANGE' });
    // No WorkflowNodeView sub-card was ever pushed — the refusal fired before the child's own
    // admission record (and therefore before its SandboxHost/prompt) was built at all.
    expect((await mgr.status(runId)).workflowNodes).toEqual([]);
  });

  // Review send-back LOW-1: a non-record args value against a declared contract used to throw an
  // uncoded TypeError (`key in obj` on a primitive) on BOTH doors that share `validateDeclaredArgs`
  // — a nested `workflow(name, 'a-string')` call AND a direct `run_start({args:'a-string'})`. Pinned
  // on both here since the fix lives in the one shared function.
  it('[LOW-1] a non-record (string) arg via nested workflow() is a coded PARAM_OUT_OF_RANGE, never an uncaught TypeError', async () => {
    await registerPublished(catalog, 'c107-string-args', `export const meta = { params: { args: { x: { type: 'number' } } } };\nreturn args.x;`);
    const runId = await startScript(mgr, TRY_WORKFLOW(`workflow('c107-string-args', 'just-a-string')`));
    expect(await completedValue(mgr, runId)).toEqual({ code: 'PARAM_OUT_OF_RANGE' });
  });

  it('[LOW-1] a non-record (string) arg via a DIRECT run_start is likewise a coded PARAM_OUT_OF_RANGE, never INTERNAL_ERROR', async () => {
    await registerPublished(catalog, 'c107-string-args-direct', `export const meta = { params: { args: { x: { type: 'number' } } } };\nreturn args.x;`);
    await expect(mgr.start({ origin: 'local', name: 'c107-string-args-direct', args: 'just-a-string' })).rejects.toMatchObject({ code: 'PARAM_OUT_OF_RANGE' });
  });

  // Review send-back LOW-2: a nested frame refused by args validation still incremented
  // `entry.descendants` BEFORE the check ran (run-manager.ts, the same counter LOW-3's disk-floor
  // ruling already protects) — a parent that loops/retries a refused workflow() call could exhaust
  // `maxWorkflowDescendants` on attempts that never created a child run at all.
  it('[LOW-2] an args-validation refusal does not consume a maxWorkflowDescendants slot', async () => {
    await registerPublished(catalog, 'c107-slot-refuse', `export const meta = { params: { args: { x: { type: 'number' } } } };\nreturn args.x;`);
    const runId = await mgr.start({ origin: 'local' }); // ad-hoc no-op top-level run, just to own an entry
    const handle = (mgr as unknown as { _handleWorkflowRequest: (...a: unknown[]) => Promise<unknown> })._handleWorkflowRequest.bind(mgr);
    await expect(handle(runId, 'c107-slot-refuse', { x: 'bad' }, '', 0, 1, new Set<string>())).rejects.toMatchObject({ code: 'PARAM_OUT_OF_RANGE' });
    const entry = (mgr as unknown as { _runs: Map<string, { descendants: number }> })._runs.get(runId)!;
    expect(entry.descendants).toBe(0);
  });

  it('a value outside the declared enum is refused PARAM_OUT_OF_RANGE', async () => {
    await registerPublished(catalog, 'c107-enum', `export const meta = { params: { args: { mode: { type: 'string', enum: ['a', 'b'] } } } };\nreturn args.mode;`);
    const runId = await startScript(mgr, TRY_WORKFLOW(`workflow('c107-enum', { mode: 'z' })`));
    expect(await completedValue(mgr, runId)).toEqual({ code: 'PARAM_OUT_OF_RANGE' });
    expect((await mgr.status(runId)).workflowNodes).toEqual([]);
  });

  it('a numeric value outside the declared min/max is refused PARAM_OUT_OF_RANGE', async () => {
    await registerPublished(catalog, 'c107-range', `export const meta = { params: { args: { n: { type: 'number', min: 1, max: 10 } } } };\nreturn args.n;`);
    const runId = await startScript(mgr, TRY_WORKFLOW(`workflow('c107-range', { n: 999 })`));
    expect(await completedValue(mgr, runId)).toEqual({ code: 'PARAM_OUT_OF_RANGE' });
    expect((await mgr.status(runId)).workflowNodes).toEqual([]);
  });

  it('a declared default is materialized into the child\'s args when the caller omits the key', async () => {
    await registerPublished(catalog, 'c107-default', `export const meta = { params: { args: { greeting: { type: 'string', default: 'hi' } } } };\nreturn args.greeting;`);
    const runId = await startScript(mgr, `return await workflow('c107-default', {});`);
    expect(await completedValue(mgr, runId)).toBe('hi');
  });

  // Issue #161 B2 (2026-10-07 reverify — the exact repro, run end-to-end through a REAL forked
  // sandbox child on both hops: parent script -> host -> nested child): `workflow(name, {n:
  // undefined})` must leave `n` as an explicit `undefined` in the CHILD's own `args` — the
  // declared default must NOT silently apply, and the key must not simply vanish. Before the fix,
  // Node's IPC 'json' serialization alone dropped the `n` key on the parent-child->host hop
  // (`JSON.stringify({n: undefined}) === '{}'`), so the host saw `args: {}` — indistinguishable
  // from the caller never having mentioned `n` at all — and `materializeArgDefaults`'s OLD
  // `=== undefined` check would have filled the default even if the key HAD survived.
  it('issue #161 B2: an explicit `undefined` for a declared args key WINS — the default is NOT applied, the key is NOT silently dropped', async () => {
    await registerPublished(
      catalog,
      'c161-explicit-undefined',
      `export const meta = { params: { args: { n: { type: 'number', default: 3 } } } };\n` +
        `return { receivedN: args.n === undefined ? 'UNDEFINED' : args.n, hasOwnN: Object.hasOwn(args, 'n') };`,
    );
    const runId = await startScript(mgr, `return await workflow('c161-explicit-undefined', { n: undefined });`);
    expect(await completedValue(mgr, runId)).toEqual({ receivedN: 'UNDEFINED', hasOwnN: true });
  });

  // Companion case: a key the caller genuinely never mentions is UNAFFECTED by the #161 B2 fix —
  // still filled from its declared default, same as the existing 'a declared default is
  // materialized' case above, just phrased as a direct contrast with the explicit-undefined case.
  it("issue #161 B2 companion: a key the caller TRULY never mentions is still filled from its default (unaffected by the fix)", async () => {
    await registerPublished(
      catalog,
      'c161-truly-absent',
      `export const meta = { params: { args: { n: { type: 'number', default: 3 } } } };\n` +
        `return { receivedN: args.n, hasOwnN: Object.hasOwn(args, 'n') };`,
    );
    const runId = await startScript(mgr, `return await workflow('c161-truly-absent', {});`);
    expect(await completedValue(mgr, runId)).toEqual({ receivedN: 3, hasOwnN: true });
  });

  // Issue #161 B2 (2026-10-09 reverify — the NOT-FIXED half, run end-to-end through a REAL forked
  // sandbox child on both hops): before this fix, a function value anywhere in a nested
  // workflow()'s args was silently DROPPED by Node's own IPC JSON serialization — the child saw a
  // key that looked genuinely absent, its declared default silently filled in, and the script got
  // no error at all for passing a value that can never legitimately cross a process boundary.
  it('issue #161 B2: a top-level function value in nested workflow() args is refused PARAM_OUT_OF_RANGE, never silently dropped', async () => {
    await registerPublished(catalog, 'c161-fn-top', `export const meta = { params: { args: { n: { type: 'number', default: 3 } } } };\nreturn args.n;`);
    const runId = await startScript(mgr, TRY_WORKFLOW(`workflow('c161-fn-top', { n: 1, f: () => 1 })`));
    expect(await completedValue(mgr, runId)).toEqual({ code: 'PARAM_OUT_OF_RANGE' });
    // No child run was ever created — refused before the nested SandboxHost existed, same as every
    // other args-validation refusal in this file.
    expect((await mgr.status(runId)).workflowNodes).toEqual([]);
  });

  it('issue #161 B2: the exact reverify repro — a function value NESTED inside args is refused, never silently stripped', async () => {
    await registerPublished(catalog, 'c161-fn-nested', `export const meta = {};\nreturn args.zzz ? args.zzz.k : null;`);
    const runId = await startScript(mgr, TRY_WORKFLOW(`workflow('c161-fn-nested', { zzz: { a: undefined, f: () => 1, k: 1 } })`));
    expect(await completedValue(mgr, runId)).toEqual({ code: 'PARAM_OUT_OF_RANGE' });
  });

  it('issue #161 B2: an undefined value NESTED inside args (not the top-level own-key case) is refused, not silently dropped', async () => {
    await registerPublished(catalog, 'c161-undef-nested', `export const meta = {};\nreturn args.zzz ? args.zzz.k : null;`);
    const runId = await startScript(mgr, TRY_WORKFLOW(`workflow('c161-undef-nested', { zzz: { a: undefined, k: 1 } })`));
    expect(await completedValue(mgr, runId)).toEqual({ code: 'PARAM_OUT_OF_RANGE' });
  });

  // Companion: the one LEGITIMATE shape (a top-level own-key explicit undefined, #161 B2's
  // already-fixed half above) is completely unaffected by this new check — still passes through.
  it('issue #161 B2 companion: a top-level explicit undefined is still accepted, unaffected by the new function/nested-undefined check', async () => {
    await registerPublished(catalog, 'c161-regression-guard', `export const meta = { params: { args: { n: { type: 'number', default: 3 } } } };\nreturn args.n === undefined ? 'UNDEFINED' : args.n;`);
    const runId = await startScript(mgr, `return await workflow('c161-regression-guard', { n: undefined });`);
    expect(await completedValue(mgr, runId)).toBe('UNDEFINED');
  });

  it('valid args still pass through to the child unchanged', async () => {
    await registerPublished(catalog, 'c107-valid', `export const meta = { params: { args: { x: { type: 'number' } } } };\nreturn args.x * 2;`);
    const runId = await startScript(mgr, `return await workflow('c107-valid', { x: 21 });`);
    expect(await completedValue(mgr, runId)).toBe(42);
  });

  it('an undeclared arg key is not refused — it passes through unchanged (same backward-compat rule run_start already applies)', async () => {
    await registerPublished(catalog, 'c107-passthrough', `export const meta = { params: { args: { x: { type: 'number' } } } };\nreturn { x: args.x, extra: args.extra };`);
    const runId = await startScript(mgr, `return await workflow('c107-passthrough', { x: 1, extra: 'untouched' });`);
    expect(await completedValue(mgr, runId)).toEqual({ x: 1, extra: 'untouched' });
  });

  it('[cross-principal regression] a non-owner nesting another principal\'s released workflow with a wrong-type arg is refused, no child run ever created', async () => {
    // 'alice' owns and releases the child — which, like the reported issue's admin-owned workflow,
    // actually dispatches an agent() interpolating the declared arg into its prompt; 'bob' registers
    // and runs the composing parent. A recording spawner (not the shared `mgr`'s echoSpawner) lets
    // this witness the ACTUAL claim: the child's prompt is never built, not merely that no
    // WorkflowNodeView was recorded.
    const dispatchedPrompts: string[] = [];
    const recordingSpawner: AgentSpawner = { async run(req) { dispatchedPrompts.push(req.prompt); return { kind: 'text', value: req.prompt }; } };
    const mgr2 = new RunManager({ store: new InMemoryRunStore(CLOCK), clock: CLOCK, catalog, spawner: recordingSpawner });
    await registerPublished(
      catalog,
      'c107-alice-secure',
      `export const meta = { params: { agents: { echoer: { model: { type: 'string', default: ${JSON.stringify(DEFAULT_FIXTURE_MODEL)} }, effort: { type: 'enum', enum: ['low', 'medium', 'high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } }, args: { x: { type: 'number' } } } };\nphase('Work');\nreturn await agent('echoer', { prompt: 'alice-secret:' + args.x });`,
      { principal: 'alice' },
    );
    const runId = await startScript(
      mgr2,
      TRY_WORKFLOW(`workflow('c107-alice-secure', { x: 'HARMLESS-NOT-A-NUMBER' })`),
      { principal: 'bob' },
    );
    expect(await completedValue(mgr2, runId)).toEqual({ code: 'PARAM_OUT_OF_RANGE' });
    expect((await mgr2.status(runId)).workflowNodes).toEqual([]);
    // The actual pin: the child's agent() never dispatched, so its prompt (which would have carried
    // the caller's raw string into an owner's agent) was never even built.
    expect(dispatchedPrompts).toEqual([]);
  });
});
