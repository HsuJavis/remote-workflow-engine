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
import { registerPublished, startScript } from '../helpers/workflow-fixtures.js';

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
    // 'alice' owns and releases the child; 'bob' registers and runs the composing parent — the
    // same cross-principal shape the reported issue used (an admin-owned workflow, a different
    // author's script nesting it), reduced to what this unit tier can assert without a live
    // gateway: the refusal code and the absence of any child admission record.
    await registerPublished(catalog, 'c107-alice-secure', `export const meta = { params: { args: { x: { type: 'number' } } } };\nreturn 'alice-secret:' + args.x;`, { principal: 'alice' });
    const runId = await startScript(
      mgr,
      TRY_WORKFLOW(`workflow('c107-alice-secure', { x: 'HARMLESS-NOT-A-NUMBER' })`),
      { principal: 'bob' },
    );
    expect(await completedValue(mgr, runId)).toEqual({ code: 'PARAM_OUT_OF_RANGE' });
    expect((await mgr.status(runId)).workflowNodes).toEqual([]);
  });
});
