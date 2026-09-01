// IT-011: a run started after a workflow update records the scriptVersion it actually executed,
// not a hardcoded "v1" (ARCH-006, REQ-014, D-V7).
// Integration tier (DES-015): real McpFacade + real RunManager + real WorkflowCatalog + real
// InMemoryRunStore; no network.
//
// v22 rewrite (DES-113, ARCH-072, TASK-108): the ORIGINAL case ("v2 !== v1") is a relative oracle
// that passes when both are wrong (v22 Rule 1, 01-requirements.md Round v22) — rewritten to LITERAL
// 'v1'/'v2' assertions, plus a third clause: after a THIRD version is registered+published, run 1
// still reports 'v1' literally (not merely "not v3"). v22 also requires an explicit `publish` to
// `release` — registration alone no longer makes a version runnable by name (REQ-097).
//
// Red reason: `WorkflowCatalog.publish` does not exist yet (register() still overwrites in place,
// so there is no "second, distinct v2 row" to publish) — MODULE-level red on `catalog.publish is
// not a function`, and even once stubbed, `run-manager.ts:391/635` resolve via the deleted
// `catalog.get()`'s "newest row" semantics, not a literal 'v1'/'v2' pin.
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

describe('scriptVersion fidelity across a workflow update (IT-011, D-V7, v22 rewrite)', () => {
  it('two runs after two published versions report literal "v1"/"v2" — not merely "different"', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runManager = new RunManager({ store, clock: CLOCK });
    const facade = new McpFacade({ clock: CLOCK, store, runManager });

    const { version: v1 } = await runManager.catalog.register('sv-fidelity', `return 'version-one';`);
    await runManager.catalog.publish('sv-fidelity', v1, 'release', null);
    const run1 = await facade.workflow_run({ name: 'sv-fidelity' });
    const status1 = await pollUntilSettled(facade, run1.result!.runId);
    expect(status1.status).toBe('completed');
    expect(status1.result!.scriptVersion).toBe('v1'); // literal, per v22 Rule 1

    const { version: v2 } = await runManager.catalog.register('sv-fidelity', `return 'version-two';`);
    await runManager.catalog.publish('sv-fidelity', v2, 'release', null);
    const run2 = await facade.workflow_run({ name: 'sv-fidelity' });
    const status2 = await pollUntilSettled(facade, run2.result!.runId);
    expect(status2.status).toBe('completed');
    expect(status2.result!.scriptVersion).toBe('v2'); // literal, per v22 Rule 1

    // After a THIRD version is registered+published, run 1's own record is unchanged — still 'v1'.
    const { version: v3 } = await runManager.catalog.register('sv-fidelity', `return 'version-three';`);
    await runManager.catalog.publish('sv-fidelity', v3, 'release', null);
    const stillStatus1 = await facade.workflow_status({ runId: run1.result!.runId });
    expect(stillStatus1.result!.scriptVersion).toBe('v1');
  }, 15000);
});
