// IT-011: a run started after a workflow update records the scriptVersion it actually executed,
// not a hardcoded "v1" (ARCH-006, REQ-014, D-V7).
// Integration tier (DES-015): real McpFacade + real RunManager + real WorkflowCatalog + real
// InMemoryRunStore; no network.
//
// Red reason (2026-07-03, before Gate 6 rework): RunManager.start() (src/run-manager.ts)
// correctly resolves `scriptVersion` from the catalog (`registered.version`) but never threads it
// into `this._store.createRun(spec)` — RunStore.createRun (both InMemoryRunStore and
// SqliteRunStore) hardcodes `scriptVersion: 'v1'` for every run regardless of which version
// actually executed (confirmed at Gate 7.5 real-run — see 08-validation.md VAL-014). This test
// pins the case Gate 7.5 found: register twice (v1, v2), run twice, and check the SECOND run's
// recorded scriptVersion is genuinely "v2", not "v1" again.
import { describe, it, expect } from 'vitest';
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

describe('scriptVersion fidelity across a workflow update (IT-011, D-V7)', () => {
  it('a run after an update records the actually-executed version, not always v1', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runManager = new RunManager({ store, clock: CLOCK });
    const facade = new McpFacade({ clock: CLOCK, store, runManager });

    await runManager.catalog.register('sv-fidelity', `return 'version-one';`);
    const run1 = await facade.workflow_run({ name: 'sv-fidelity' });
    const status1 = await pollUntilSettled(facade, run1.result!.runId);
    expect(status1.status).toBe('completed');
    const v1 = status1.result!.scriptVersion;

    await runManager.catalog.register('sv-fidelity', `return 'version-two';`);
    const run2 = await facade.workflow_run({ name: 'sv-fidelity' });
    const status2 = await pollUntilSettled(facade, run2.result!.runId);
    expect(status2.status).toBe('completed');
    const v2 = status2.result!.scriptVersion;

    // The script content genuinely executes correctly (already green — VAL-014); what this test
    // pins is the METADATA: the second run's recorded scriptVersion must differ from the first's.
    expect(v2).not.toBe(v1);
  }, 15000);
});
