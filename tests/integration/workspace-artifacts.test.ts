// IT-010: run-workspace artifacts are listable/retrievable via the MCP API surface (ARCH-007,
// REQ-013 third acceptance bullet, D-V7).
// Integration tier (DES-015): real McpFacade + real RunManager + real WorkflowCatalog + real
// on-disk workspace; no network involved (script has no agent() calls).
//
// Design note (verifier-authored extension, not yet in 04-design.md — flagged for Gate 6 to
// finalize): D-V7 allows either "a listing tool or a status field". This test targets a new
// `McpFacade.workflow_artifacts({ runId })` tool returning the relative paths of files present
// in that run's workspace — the smaller of the two options (no change to the widely-shared
// RunStatusView/RunSummary shapes).
//
// Red reason (2026-07-03, before Gate 6 rework): no MCP tool or status field exposes a run's
// workspace file listing today (confirmed at Gate 7.5 real-run — see 08-validation.md VAL-013).
// `McpFacade.workflow_artifacts` does not exist, so calling it throws a TypeError.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpFacade } from '../../src/mcp-facade.js';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

async function pollUntilSettled(facade: McpFacade, runId: string) {
  let s = await facade.workflow_status({ runId });
  for (let i = 0; i < 60 && (s.status === 'running' || s.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 50));
    s = await facade.workflow_status({ runId });
  }
  return s;
}

describe('workflow_artifacts: run-workspace files retrievable via the API (IT-010, D-V7)', () => {
  it('a file written into a completed run\'s workspace is listed by workflow_artifacts', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runManager = new RunManager({ store, clock: CLOCK });
    const facade = new McpFacade({ clock: CLOCK, store, runManager });

    const run = await facade.workflow_run({ script: `return 'done';` });
    const runId = run.result!.runId;
    const status = await pollUntilSettled(facade, runId);
    expect(status.status).toBe('completed');

    // Simulate an agent's SDK-session tool call writing a file into the run's workspace
    // (parent-side; the sandboxed script itself has no fs access — DES-005).
    const workspace = runManager.catalog.runWorkspace('_adhoc', runId);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'output.txt'), 'artifact content');

    const artifacts = await (facade as unknown as {
      workflow_artifacts(a: { runId: string }): Promise<{ result?: Array<{ path: string; size: number; sha256: string }>; error?: unknown }>;
    }).workflow_artifacts({ runId });

    expect(artifacts.error).toBeUndefined();
    expect((artifacts.result ?? []).map((a) => a.path)).toContain('output.txt');
  }, 15000);

  it('R-3: RunManager owns the listing — listArtifacts is null for an unknown run (facade never touches fs)', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runManager = new RunManager({ store, clock: CLOCK });
    // No such run → no workspace → null (the facade maps this to an empty result, not an fs error).
    expect(await runManager.listArtifacts('no-such-run')).toBeNull();

    const facade = new McpFacade({ clock: CLOCK, store, runManager });
    const env = await facade.workflow_artifacts({ runId: 'no-such-run' });
    expect(env.error).toBeDefined(); // unknown run → RUN_NOT_FOUND envelope, never a thrown readdir error
  });
});
