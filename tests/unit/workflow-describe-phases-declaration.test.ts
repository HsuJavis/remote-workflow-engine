// Issue #98 item 8b: `workflow_describe`'s `phases` is `meta.phases` — a literal the AUTHOR
// declares in the script's own `export const meta = {...}` block (workflow-meta.ts:parseMeta),
// read back VERBATIM. It is NOT derived from the script's `phase()` CALLS (those only feed the
// separate static predicted-graph/toolSurface derivation — `deriveExpectedGraph`/`predictedLanes`),
// and not from the mermaid diagram either. `FIXTURE_SCRIPT` (tool-specs.ts) — the SAME happy
// fixture registered across this whole test suite — is exactly this shape: it calls `phase('Greet')`
// and dispatches an agent under it, but its `meta` declares no `phases` key at all. This file pins
// that as the CURRENT, MEASURED mechanism (matching the dag-masking-auth.test.ts and
// val-199-workflow-detail.test.ts comments that independently document the same fact) — not an
// endorsement that it is the only sensible design; see this task's report for the one-line
// alternative (deriving `phases` from `phase()` call titles when `meta.phases` is absent) and the
// evidence for why that was NOT applied here without a product decision.
//
// Mock policy (unit): a REAL WorkflowCatalog + RunManager + McpFacade on a real tmp SQLite (same
// convention as this directory's `facade-refusal-arms.test.ts`) — a hand-mocked catalog cannot
// exercise the genuine `parseMeta`/projection path.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { FIXTURE_SCRIPT, FIXTURE_MERMAID, FIXTURE_AGENT_LABEL } from '../../src/tool-specs.js';
import type { Principal } from '../../src/authz.js';

const CLOCK = new FixedClock(new Date('2026-09-28T10:00:00.000Z'));
const OPEN: Principal = { kind: 'auth-disabled' };

let workRoot: string;
let catalog: WorkflowCatalog;
let facade: McpFacade;
beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-it98-phases-'));
  catalog = new WorkflowCatalog(workRoot, CLOCK);
  facade = new McpFacade({ runManager: new RunManager({ catalog, clock: CLOCK }), clock: CLOCK });
});
afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

describe('workflow_describe.phases reads meta.phases verbatim, not phase() call structure (issue #98 item 8b)', () => {
  it('a registered script that calls phase() and dispatches an agent, but declares no meta.phases, describes phases:[] — while its agent still projects normally', async () => {
    const { version } = await catalog.register({ name: 'phases-undeclared', script: FIXTURE_SCRIPT, mermaid: FIXTURE_MERMAID });
    // describe the just-registered version directly — it was never published, so a bare {name} call
    // would answer CHANNEL_UNPUBLISHED (unrelated to this file's subject) rather than a projection.
    const res = await facade.workflowDescribe({ name: 'phases-undeclared', version }, OPEN) as Record<string, unknown>;
    expect(res['status']).toBe('completed');
    const result = res['result'] as { phases?: unknown; toolSurface?: Record<string, unknown> };
    // the measured, current behaviour: no meta.phases declared -> phases:[], not derived from the
    // phase('Greet') call the script actually makes.
    expect(result.phases).toEqual([]);
    // this is NOT the same thing as "the script has no agents" — toolSurface (a SEPARATE, script-scan
    // derived projection) still sees the agent() call fine, proving the emptiness is specific to the
    // meta.phases field and not a blanket failure to read the script.
    expect(Object.keys(result.toolSurface ?? {})).toContain(FIXTURE_AGENT_LABEL);
  });

  it('the SAME script, with meta.phases declared to match its phase() call, describes that title — and phases[].agents joins in the predicted label', async () => {
    const scriptWithPhases = FIXTURE_SCRIPT.replace(
      "params: { agents: { greet:",
      "phases: [{ title: 'Greet' }], params: { agents: { greet:",
    );
    const { version } = await catalog.register({ name: 'phases-declared', script: scriptWithPhases, mermaid: FIXTURE_MERMAID });
    const res = await facade.workflowDescribe({ name: 'phases-declared', version }, OPEN) as Record<string, unknown>;
    const result = res['result'] as { phases?: Array<{ title: string; agents?: string[] }> };
    expect(result.phases).toHaveLength(1);
    expect(result.phases?.[0]?.title).toBe('Greet');
    expect(result.phases?.[0]?.agents).toEqual([FIXTURE_AGENT_LABEL]);
  });
});
