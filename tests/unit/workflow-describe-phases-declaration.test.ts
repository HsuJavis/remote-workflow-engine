// v39 (owner decision 2026-09-30) supersedes issue #98 item 8b's premise, pinned here previously:
// `meta.phases` used to be read back verbatim with no requirement to declare it at all, so an
// undeclared script quietly described `phases:[]`. From v39 (Part A) a NEW registration REQUIRES
// `meta.phases` and refuses PHASES_REQUIRED/PHASES_MISMATCH when it disagrees with the script's own
// `phase()` calls — `workflow_register`'s own gate, `WorkflowCatalog.validateRegistration` via
// `checkMetaPhases` (workflow-meta.ts). Part B: an EXISTING (pre-v39) row is immutable and never
// re-checked against this rule — `workflow_describe`/`workflow_source` DERIVE `phases` from that
// row's own stored `phase()` calls instead of reporting an empty array (`resolvePhases`,
// workflow-meta.ts), and report which happened via the new `phasesSource: 'declared' | 'derived'`
// field.
//
// Mock policy (unit): a REAL WorkflowCatalog + RunManager + McpFacade on a real tmp SQLite (same
// convention as this directory's `facade-refusal-arms.test.ts`) — a hand-mocked catalog cannot
// exercise the genuine `checkMetaPhases`/`resolvePhases`/projection path. The pre-v39 legacy row is
// simulated with `catalog.insertVersion(...)` directly (bypassing `validateRegistration`, same
// established pattern `registration-enforcement.test.ts`/`catalog-v24.test.ts` already use to write
// a row `validateRegistration` itself would refuse) — the only way to get a stored row this new
// registration-time rule would never itself produce.
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

describe('workflow_register (v39): meta.phases is required and must match phase() calls', () => {
  it('PHASES_REQUIRED: a script that calls phase() but declares no meta.phases is refused at registration', async () => {
    const script = `phase('Greet');\nreturn 1;`;
    await expect(catalog.register({ name: 'phases-undeclared', script, mermaid: 'graph LR\nsubgraph "Greet"\nend' }))
      .rejects.toMatchObject({ code: 'PHASES_REQUIRED' });
  });

  it('PHASES_MISMATCH: declared meta.phases disagrees with the script\'s own phase() calls', async () => {
    const script = `export const meta = { phases: [{ title: 'Wrong' }] };\nphase('Greet');\nreturn 1;`;
    await expect(catalog.register({ name: 'phases-mismatch', script, mermaid: 'graph LR\nsubgraph "Greet"\nend' }))
      .rejects.toMatchObject({ code: 'PHASES_MISMATCH' });
  });

  it('FIXTURE_SCRIPT (the happy fixture) declares meta.phases matching its one phase(\'Greet\') call and registers cleanly', async () => {
    await expect(catalog.register({ name: 'phases-happy', script: FIXTURE_SCRIPT, mermaid: FIXTURE_MERMAID })).resolves.toMatchObject({ version: 'v1' });
  });
});

describe('workflow_describe.phases (v39 Part B): declared verbatim for a v39 row, derived for a pre-v39 (legacy) row', () => {
  it('a v39-registered version reads meta.phases back verbatim — phasesSource:"declared" — and phases[].agents joins the predicted label', async () => {
    const { version } = await catalog.register({ name: 'phases-declared', script: FIXTURE_SCRIPT, mermaid: FIXTURE_MERMAID });
    const res = await facade.workflowDescribe({ name: 'phases-declared', version }, OPEN) as Record<string, unknown>;
    expect(res['status']).toBe('completed');
    const result = res['result'] as { phases?: Array<{ title: string; agents?: string[] }>; phasesSource?: string; toolSurface?: Record<string, unknown> };
    expect(result.phasesSource).toBe('declared');
    expect(result.phases).toHaveLength(1);
    expect(result.phases?.[0]?.title).toBe('Greet');
    expect(result.phases?.[0]?.agents).toEqual([FIXTURE_AGENT_LABEL]);
    expect(Object.keys(result.toolSurface ?? {})).toContain(FIXTURE_AGENT_LABEL);
  });

  it('a pre-v39 legacy row with no meta.phases at all DERIVES phases from its own phase() calls — phasesSource:"derived" — agents still join', async () => {
    // Simulates a row registered before v39 existed: written directly via insertVersion (bypassing
    // validateRegistration, which would now refuse PHASES_REQUIRED for this exact script), same
    // script shape FIXTURE_SCRIPT has minus the meta.phases declaration.
    const legacyScript =
      "export const meta = {\n" +
      "  params: { agents: { greet: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },\n" +
      "};\n" +
      "phase('Greet');\n" +
      "return await agent('greet', { prompt: 'Say hello' });";
    const { version } = await catalog.insertVersion({ name: 'phases-legacy', script: legacyScript, mermaid: FIXTURE_MERMAID, params: undefined as never });
    const res = await facade.workflowDescribe({ name: 'phases-legacy', version }, OPEN) as Record<string, unknown>;
    const result = res['result'] as { phases?: Array<{ title: string; agents?: string[] }>; phasesSource?: string };
    expect(result.phasesSource).toBe('derived');
    expect(result.phases).toHaveLength(1);
    expect(result.phases?.[0]?.title).toBe('Greet');
    expect(result.phases?.[0]?.agents).toEqual([FIXTURE_AGENT_LABEL]);
  });

  it('a pre-v39 legacy row with NO phase() calls at all derives to an empty array, not a throw', async () => {
    const { version } = await catalog.insertVersion({ name: 'phases-legacy-empty', script: 'return 1;', mermaid: 'graph LR', params: undefined as never });
    const res = await facade.workflowDescribe({ name: 'phases-legacy-empty', version }, OPEN) as Record<string, unknown>;
    const result = res['result'] as { phases?: unknown; phasesSource?: string };
    expect(result.phasesSource).toBe('derived');
    expect(result.phases).toEqual([]);
  });

  it('a pre-v39 legacy row whose declared meta.phases disagrees with its own phase() calls is read back VERBATIM, never corrected — phasesSource:"declared"', async () => {
    const legacyScript = `export const meta = { phases: [{ title: 'Old' }] };\nphase('New');\nreturn 1;`;
    const { version } = await catalog.insertVersion({ name: 'phases-legacy-stale', script: legacyScript, mermaid: 'graph LR', params: undefined as never });
    const res = await facade.workflowDescribe({ name: 'phases-legacy-stale', version }, OPEN) as Record<string, unknown>;
    const result = res['result'] as { phases?: Array<{ title: string }>; phasesSource?: string };
    expect(result.phasesSource).toBe('declared');
    // phases[].agents still joins BY POSITION against the script's own derived lane (lane 0, no
    // agent() calls in it) — the title mismatch is exactly what "never corrected" means: the join
    // is positional, not by title text.
    expect(result.phases).toEqual([{ title: 'Old', agents: [] }]);
  });
});
