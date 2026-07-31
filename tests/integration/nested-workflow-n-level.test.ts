// v8 Slice 1 — N-level workflow() composition (REQ-041..044). TEST-FIRST (RED).
//
// Today `workflow()` nesting is hard-limited to ONE level: the nested run's SandboxHost is built with
// no onWorkflowRequest (src/run-manager.ts:353), so a second-level workflow() throws NESTING_ERROR
// (src/sandbox/host.ts:112, guards.ts:183). This suite pins the target behavior:
//   REQ-041  N levels up to a configurable maxWorkflowDepth (default 4); over-depth → NESTING_DEPTH_EXCEEDED
//   REQ-042  ancestor-cycle guard → NESTING_CYCLE; a legitimate diamond (same NON-ancestor twice) is allowed
//   REQ-043  total-descendant cap (maxWorkflowDescendants, default 256) → DESCENDANT_CAP_EXCEEDED
//   REQ-044  (a) nested agent() calls share the parent run's ONE RunGuard budget (no per-level reset);
//            (b) nested journal callSeq keys stay unique AND within MAX_SAFE_INTEGER at depth ≥3
//                (the current (parentCallSeq+1)*1e6+n multiply scheme overflows past ~depth 2).
//
// Mock policy (integration tier, mirrors IT-026 nested-workflow-callseq-resume.test.ts): real
// RunManager + real on-disk WorkflowCatalog + real sandbox child processes / IPC / node:vm. The
// budget case additionally uses a real AgentExecutor with only the GatewayClient faked (same seam as
// IT-019); the structural cases use the echo AgentSpawner override.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { AgentSpawner } from '../../src/agent-executor.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import type { JournalEntry } from '../../src/types.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

class CapturingStore extends InMemoryRunStore {
  readonly captured: JournalEntry[] = [];
  override async appendJournal(runId: string, entry: JournalEntry): Promise<void> {
    this.captured.push(entry);
    return super.appendJournal(runId, entry);
  }
}

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

describe('N-level workflow() composition (v8 Slice 1, REQ-041..044)', () => {
  let workRoot: string;
  beforeEach(() => { workRoot = mkdtempSync(join(tmpdir(), 'rwe-nlevel-')); });
  afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

  // ── REQ-041: depth up to the configured cap ──────────────────────────────────────────────
  it('REQ-041 runs a composite as a NODE inside another composite up to maxWorkflowDepth', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await catalog.register('leaf', `return 'L';`);
    await catalog.register('mid', `const x = await workflow('leaf', {}); return 'M(' + x + ')';`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner(), maxWorkflowDepth: 2 });

    // top(0) → mid(1) → leaf(2): today mid's workflow('leaf') throws NESTING_ERROR; with depth 2 it runs.
    const runId = await mgr.start({ script: `const m = await workflow('mid', {}); return m;` });
    expect(await completedValue(mgr, runId)).toBe('M(L)');
  });

  it('REQ-041 rejects a workflow() call that would exceed maxWorkflowDepth with NESTING_DEPTH_EXCEEDED', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await catalog.register('leaf', `return 'L';`);
    await catalog.register('mid', `const x = await workflow('leaf', {}); return 'M(' + x + ')';`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner(), maxWorkflowDepth: 1 });

    // top(0) → mid(1) OK; mid → leaf(2) exceeds the cap of 1.
    const runId = await mgr.start({
      script: `try { const m = await workflow('mid', {}); return { m }; } catch (e) { return { code: e && (e.code || e.name) }; }`,
    });
    expect(await completedValue(mgr, runId)).toEqual({ code: 'NESTING_DEPTH_EXCEEDED' });
  });

  // ── REQ-042: ancestor-cycle guard, and diamond allowed ───────────────────────────────────
  it('REQ-042 refuses an ancestor cycle with NESTING_CYCLE', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await catalog.register('a', `const x = await workflow('b', {}); return x;`);
    await catalog.register('b', `const y = await workflow('a', {}); return y;`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner(), maxWorkflowDepth: 10 });

    // top → a(1,{a}) → b(2,{a,b}) → a: 'a' is already an ancestor → cycle, not depth.
    const runId = await mgr.start({
      script: `try { await workflow('a', {}); return { ok: true }; } catch (e) { return { code: e && (e.code || e.name) }; }`,
    });
    expect(await completedValue(mgr, runId)).toEqual({ code: 'NESTING_CYCLE' });
  });

  it('REQ-042 allows a diamond: the same NON-ancestor workflow called in two sibling branches', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await catalog.register('d', `return 'D';`);
    await catalog.register('fork', `const [x, y] = await parallel([() => workflow('d', {}), () => workflow('d', {})]); return x + y;`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner(), maxWorkflowDepth: 2 });

    const runId = await mgr.start({ script: `return await workflow('fork', {});` });
    expect(await completedValue(mgr, runId)).toBe('DD');
  });

  // ── REQ-043: total-descendant cap ────────────────────────────────────────────────────────
  it('REQ-043 caps total nested workflow() invocations per run with DESCENDANT_CAP_EXCEEDED', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await catalog.register('leaf', `return 'x';`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner(), maxWorkflowDepth: 4, maxWorkflowDescendants: 3 });

    // 5 sequential depth-1 calls; the 4th exceeds the total-descendant cap of 3.
    const runId = await mgr.start({
      script: `try { for (let i = 0; i < 5; i++) { await workflow('leaf', {}); } return { ok: true }; } catch (e) { return { code: e && (e.code || e.name) }; }`,
    });
    expect(await completedValue(mgr, runId)).toEqual({ code: 'DESCENDANT_CAP_EXCEEDED' });
  });

  // ── REQ-044(a): nested agent() shares the parent run's ONE budget ─────────────────────────
  it('REQ-044 a nested agent() at depth 2 shares the parent run budget (no per-level reset)', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    // leaf catches its own agent() failure and reports the code as a VALUE — so the shared-budget
    // block is observed directly (an uncaught agent throw flattens to SCRIPT_ERROR in evaluateScript).
    await catalog.register('leaf', `try { const l = await agent('L'); return { l }; } catch (e) { return { blocked: e && (e.name || e.code) }; }`);
    await catalog.register('mid', `const m = await agent('M'); const x = await workflow('leaf', {}); return { m, x };`);
    const store = new InMemoryRunStore(CLOCK);
    const gwCounts = new Map<string, number>();
    const gateway: GatewayClient = {
      async invoke(req) {
        gwCounts.set(req.prompt, (gwCounts.get(req.prompt) ?? 0) + 1);
        return { ok: true, provider: 'fake', model: 'fake', tokens: { input: 0, output: 1000 }, content: req.prompt };
      },
    };
    const mgr = new RunManager({ store, clock: CLOCK, catalog, gateway, maxWorkflowDepth: 2 });

    // Budget 2000 tokens @ 1000/call: T(top) then M(mid) spend it; L(leaf, depth 2) must be blocked by
    // the SHARED guard — proving the nested level did NOT get a fresh per-level budget.
    const runId = await mgr.start({
      script: `const t = await agent('T'); const w = await workflow('mid', {}); return { t, w };`,
      budget: 2000,
    });
    expect(await completedValue(mgr, runId)).toEqual({ t: 'T', w: { m: 'M', x: { blocked: 'BudgetExceededError' } } });
    expect(gwCounts.get('T')).toBe(1);
    expect(gwCounts.get('M')).toBe(1);
    expect(gwCounts.get('L')).toBeUndefined(); // never dispatched — shared budget already exhausted
  }, 20000);

  // ── REQ-044(b): journal callSeq unique + MAX_SAFE_INTEGER-safe at depth 3 ─────────────────
  it('REQ-044 keeps nested journal callSeq keys unique and within MAX_SAFE_INTEGER at depth 3', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await catalog.register('leaf', `const l = await agent('L'); return l;`);
    await catalog.register('mid', `const m = await agent('M'); const x = await workflow('leaf', {}); return { m, x };`);
    const store = new CapturingStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner(), maxWorkflowDepth: 3 });

    // top(0):agent(T) → mid(1):agent(M) → leaf(2):agent(L). Three agent() journal entries in ONE run.
    const runId = await mgr.start({ script: `const t = await agent('T'); const w = await workflow('mid', {}); return { t, w };` });
    const value = await completedValue(mgr, runId);
    expect(value).toEqual({ t: 'T', w: { m: 'M', x: 'L' } });

    expect(store.captured.length).toBe(3);
    const seqs = store.captured.map((e) => e.callSeq);
    expect(new Set(seqs).size).toBe(seqs.length); // all unique — no collision
    for (const s of seqs) {
      expect(Number.isSafeInteger(s)).toBe(true); // within MAX_SAFE_INTEGER — no multiply overflow
    }
  });
});
