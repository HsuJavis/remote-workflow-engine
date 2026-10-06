// issue #163 B2 — TEST-FIRST (RED). A nested workflow()'s own script throw was re-wrapped as
// INTERNAL_ERROR at the parent, instead of surfacing as SCRIPT_ERROR like a direct (top-level) run
// does for the exact same throw. Root cause: `_handleWorkflowRequest` (run-manager.ts) runs the
// nested outcome's error code through `toErrorCode()`, which folds any string outside the closed
// `ERROR_CATALOG` to INTERNAL_ERROR — and `SCRIPT_ERROR` was never a catalog member (see
// tests/unit/error-catalog.test.ts's `[#163 B2]` case for the unit-level pin of that gap). The
// top-level completion path (`_runLive`) never runs a thrown error through `toErrorCode()` at all,
// so the SAME throw, same message, reaches `run_result.error.code` differently depending only on
// nesting depth.
//
// Mock policy (integration tier, mirrors nested-workflow-n-level.test.ts): real RunManager + real
// on-disk WorkflowCatalog + real sandbox child processes / IPC / node:vm. No model dispatch needed
// (the leaf script never calls agent()), so no spawner override needed beyond the default refusal
// path never being hit.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { startScript } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));
const LEAF_THROW = `const e = new Error('leaf-boom'); e.name = 'LEAF_CUSTOM'; throw e;`;

async function pollUntilSettled(mgr: RunManager, runId: string) {
  let view = await mgr.status(runId);
  for (let i = 0; i < 300 && (view.status === 'running' || view.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 25));
    view = await mgr.status(runId);
  }
  return view;
}

describe('issue #163 B2 — nested workflow() script throw surfaces as SCRIPT_ERROR, matching direct run', () => {
  let workRoot: string;
  beforeEach(() => { workRoot = mkdtempSync(join(tmpdir(), 'rwe-script-error-')); });
  afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it('a direct (top-level) uncaught throw surfaces as SCRIPT_ERROR with the script\'s own message', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog });

    const runId = await startScript(mgr, LEAF_THROW);
    await pollUntilSettled(mgr, runId);
    const result = await mgr.result(runId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('SCRIPT_ERROR');
    expect(result.error.message).toContain('leaf-boom');
  });

  it('the SAME throw, one level inside workflow(), surfaces identically — SCRIPT_ERROR, not INTERNAL_ERROR', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await import('../helpers/workflow-fixtures.js').then(({ registerPublished }) => registerPublished(catalog, 'leaf-throws', LEAF_THROW));
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog });

    const runId = await startScript(mgr, `const x = await workflow('leaf-throws', {}); return x;`);
    await pollUntilSettled(mgr, runId);
    const result = await mgr.result(runId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    // RED today: this is INTERNAL_ERROR (toErrorCode folds the uncatalogued SCRIPT_ERROR string).
    expect(result.error.code).toBe('SCRIPT_ERROR');
    expect(result.error.message).toContain('leaf-boom');
  });
});
