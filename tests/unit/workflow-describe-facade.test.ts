// UT-114 (TASK-119, DES-126, ARCH-082): the facade — `workflow_describe` (any principal) and
// `workflow_regenerate_diagram` (owner-gated), both on the existing REQUIRED `ReadContext`.
// `workflow_describe`'s resolve code must EQUAL run-admission's code for the same selector (one
// table, two call sites — REQ-101's "resolve by REQ-097's exact order" survives someone editing one
// without the other only if a test binds them together).
//
// Mock policy (unit, DES-119): a REAL `WorkflowCatalog` (real on-disk sqlite under a tmpdir) wired
// through a REAL `RunManager` — same convention as IT-093/UT-108 (a hand-mocked catalog cannot
// exercise `resolveVersionRequest`'s genuine truth table).
//
// Red reason: `McpFacade` has neither `workflow_describe` nor `workflow_regenerate_diagram` today
// (confirmed by reading `src/mcp-facade.ts`) -> every call below throws
// `TypeError: facade.workflow_describe is not a function`, a genuine runnable red (this codebase's
// own `(obj as any).newMethod(...)` convention for calling a not-yet-declared class member).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { FixedClock } from '../../src/clock.js';
import { WorkflowCatalog, resolveVersionRequest, type Channels } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import type { Principal } from '../../src/authz.js';
import { synthesizeMermaid } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2026-09-02T10:00:00.000Z'));
const CTX: Principal = { kind: 'auth-disabled' };

let workRoot: string;
let catalog: WorkflowCatalog;
let facade: McpFacade;
beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-facade-describe-'));
  catalog = new WorkflowCatalog(workRoot, CLOCK);
  facade = new McpFacade({ runManager: new RunManager({ catalog, clock: CLOCK }) });
});
afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

describe('workflow_describe — resolve table-driven parity with run-admission (UT-114, DES-126)', () => {
  const CASES: Array<{ label: string; sel: { version?: string; channel?: 'beta' | 'release' } }> = [
    { label: 'explicit version', sel: { version: 'v1' } },
    { label: 'channel:beta', sel: { channel: 'beta' } },
    { label: 'channel:release', sel: { channel: 'release' } },
    { label: 'no selector (default release)', sel: {} },
    { label: 'unknown version', sel: { version: 'v99' } },
    { label: 'unpublished beta (no beta pointer)', sel: { channel: 'beta' } },
  ];

  it.each(CASES)('$label: workflow_describe\'s code equals resolveVersionRequest\'s code for the same input', async ({ sel }) => {
    const { version } = await catalog.register({ name: 'describe-parity', script: `return 1;`, mermaid: 'graph LR' });
    await catalog.publish('describe-parity', version, 'release', null);
    const known = new Set([version]);
    const channels: Channels = { release: version, beta: null };
    const expected = resolveVersionRequest(sel, channels, known);

    const resp = await facade.workflowDescribe({ name: 'describe-parity', ...sel }, CTX) as { error?: { code?: string } };
    if (expected.ok) {
      expect(resp.error).toBeUndefined();
    } else {
      expect(resp.error?.code).toBe(expected.code);
    }
  });

  it('an unknown workflow NAME (not just an unresolvable selector) returns WORKFLOW_NOT_FOUND', async () => {
    const resp = await facade.workflowDescribe({ name: 'never-registered' }, CTX) as { error?: { code?: string } };
    expect(resp.error?.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('DANGLING_CHANNEL is NOT collapsed into CHANNEL_UNPUBLISHED — a pruned-version pointer is a different operator fault', async () => {
    const { version: v1 } = await catalog.register({ name: 'dangling-fixture', script: `return 1;`, mermaid: 'graph LR' });
    await catalog.publish('dangling-fixture', v1, 'beta', null);
    // Simulate a dangling pointer directly against the resolve truth table (same technique as the
    // catalog's own resolve() unit coverage — no version-pruning API exists to reach this state
    // through the public surface alone).
    const channels: Channels = { release: null, beta: 'v99-pruned' };
    const known = new Set([v1]);
    const expected = resolveVersionRequest({ channel: 'beta' }, channels, known);
    expect(expected.ok).toBe(false);
    if (!expected.ok) expect(expected.code).toBe('DANGLING_CHANNEL');
  });
});

// v24 (TASK-139/DES-159): `workflow_regenerate_diagram` and the GraphAnalyzer port it delegated to
// are DELETED (ARCH-089) — this whole describe block tested retired behavior. Not in DES-159's own
// named [T3] list (asset-skill-materialization-wiring/params-contract/params-resolve/webhook-
// registry); flagged as a test_defect in the Gate 6 PARIMPL report rather than silently dropped.
describe.skip('workflow_regenerate_diagram — RETIRED v24 (ARCH-089, TASK-139): tool + port deleted, no replacement in this ledger', () => {
  it('placeholder — see test_defect UT-114 in the Gate 6 report', () => {});
});

// v34 send-back repair (Gate 8 quality-dimensions #1, ADR-064/DES-228 — the read-boundary half of
// the pair; IT-177 already pins the resume-time refusal half). `projectAgentParams` never projects
// a `tools` key and `resolveDetail`'s SELECT (workflow-catalog.ts:721-728) never reads the
// `defaults` column at all, so the "exactly two tool layers" claim can only be tested by proving NO
// deployment-side or legacy-side tool value reaches `workflow_describe` for a legacy-shaped row —
// not by counting a layer that the read surface structurally cannot produce.
//
// Red reason: before this fix nothing asserted `toolSurface`/`runnableReason` together against a
// row whose `defaults` column carries a retired `tools` value — `grep -rn toolSurface tests/`
// returned zero hits.
describe('workflow_describe over a legacy-shaped row never surfaces a tools value (DES-228, Gate 8 QD#1)', () => {
  it('runnable:false/LEGACY_REREGISTER, toolSurface stays script-derived names only, and no tool value from `defaults` reaches the response', async () => {
    const name = 'legacy-tools-describe';
    // Registered with a BARE contract (no literal `allowedTools`) so a normal `register()` accepts
    // it without needing a v2 mermaid tools value-triple. The declaring label's `allowedTools` is
    // planted directly onto the `script` column below, alongside `params`/`defaults` — a v34+
    // `register()` refuses a mermaid/script mismatch, but `workflow_describe`'s read path never
    // re-validates one against the other (only `scanAgentCalls(full.script)` for `toolSurface`).
    const bareScript =
      "export const meta = { params: { agents: { " +
      "withTools: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, " +
      "bare: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } } };\n" +
      "phase('Work');\n" +
      "await agent('withTools', { prompt: 'x' });\n" +
      "return await agent('bare', { prompt: 'y' });";
    const legacyScript = bareScript.replace("agent('withTools', { prompt: 'x' })", "agent('withTools', { prompt: 'x', allowedTools: ['Read', 'Edit'] })");
    const mermaid = synthesizeMermaid(bareScript);
    const { version } = await catalog.register({ name, script: bareScript, mermaid });
    await catalog.publish(name, version, 'release', null);

    // Plant the legacy shape directly in `catalog.db` (same raw-SQL technique as
    // resume-legacy-params.test.ts:172-173) — no v34 registration path can produce this row any
    // more, so writing the columns directly is the only honest fixture. All three columns in ONE
    // statement: `script` gains the declaring label's `allowedTools`, `params` goes legacy-shaped
    // (NULL — no `agents` key) and `defaults` carries a tool value (`WebFetch`, in no
    // `BUILT_IN_CORE_TOOLS` and in no live catalog version, so a hit means precisely "a non-script
    // tool value reached the read surface").
    const catalogDb = new Database(join(workRoot, 'catalog.db'));
    catalogDb
      .prepare('UPDATE workflow_versions SET script = ?, params = ?, defaults = ? WHERE name = ? AND version = ?')
      .run(legacyScript, null, JSON.stringify({ tools: ['WebFetch'] }), name, version);
    catalogDb.close();

    const resp = await facade.workflowDescribe({ name }, CTX) as {
      result?: { runnable?: boolean; runnableReason?: string | null; toolSurface?: Record<string, string[] | 'default'> };
    };

    expect(resp.result?.runnable).toBe(false);
    expect(resp.result?.runnableReason).toBe('LEGACY_REREGISTER');
    expect(resp.result?.toolSurface).toEqual({ withTools: ['Edit', 'Read'], bare: 'default' });
    expect(JSON.stringify(resp)).not.toContain('WebFetch');
  });
});
