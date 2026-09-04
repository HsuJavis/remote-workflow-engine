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
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpFacade } from '../../src/mcp-facade.js';
import { AUTH_DISABLED } from '../helpers/workflow-fixtures.js';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

// v22 (adjudication #2, L-6): this case asserts LITERAL 'v1'/'v2'. `new RunManager()` with no
// `workRoot` defaults its catalog to a SQLite file under `os.tmpdir()` that is SHARED by every test
// file and SURVIVES across suite runs, so a fixed workflow name accumulates versions there (observed:
// 'v9', 'v11'). A private workRoot per test is what makes a literal-version oracle meaningful.
let workRoot: string;
afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

async function pollUntilSettled(facade: McpFacade, runId: string) {
  let s = await facade.runStatus({ runId }, AUTH_DISABLED, false, null);
  for (let i = 0; i < 60 && (s.status === 'running' || s.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 50));
    s = await facade.runStatus({ runId }, AUTH_DISABLED, false, null);
  }
  return s;
}

describe('scriptVersion fidelity across a workflow update (IT-011, D-V7, v22 rewrite)', () => {
  it('two runs after two published versions report literal "v1"/"v2" — not merely "different"', async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it011-'));
    const store = new InMemoryRunStore(CLOCK);
    const runManager = new RunManager({ store, clock: CLOCK, workRoot });
    const facade = new McpFacade({ clock: CLOCK, store, runManager });

    const { version: v1 } = await runManager.catalog.register({ name: 'sv-fidelity', script: `return 'version-one';`, mermaid: 'graph TD;' });
    await runManager.catalog.publish('sv-fidelity', v1, 'release', null);
    const run1 = await facade.runStart({ name: 'sv-fidelity' }, AUTH_DISABLED);
    const status1 = await pollUntilSettled(facade, run1.result!.runId);
    expect(status1.status).toBe('completed');
    expect(status1.result!.scriptVersion).toBe('v1'); // literal, per v22 Rule 1

    const { version: v2 } = await runManager.catalog.register({ name: 'sv-fidelity', script: `return 'version-two';`, mermaid: 'graph TD;' });
    await runManager.catalog.publish('sv-fidelity', v2, 'release', null);
    const run2 = await facade.runStart({ name: 'sv-fidelity' }, AUTH_DISABLED);
    const status2 = await pollUntilSettled(facade, run2.result!.runId);
    expect(status2.status).toBe('completed');
    expect(status2.result!.scriptVersion).toBe('v2'); // literal, per v22 Rule 1

    // After a THIRD version is registered+published, run 1's own record is unchanged — still 'v1'.
    const { version: v3 } = await runManager.catalog.register({ name: 'sv-fidelity', script: `return 'version-three';`, mermaid: 'graph TD;' });
    await runManager.catalog.publish('sv-fidelity', v3, 'release', null);
    const stillStatus1 = await facade.runStatus({ runId: run1.result!.runId }, AUTH_DISABLED, false, null);
    expect(stillStatus1.result!.scriptVersion).toBe('v1');
  }, 15000);
});
