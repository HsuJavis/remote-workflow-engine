// issue #93 item 3 — workflow_describe/workflow_list used to report runnable:true for a version the
// caller cannot actually run (RunManager.start() would refuse it CONFINEMENT_UNAVAILABLE). This
// pins the corrected truthfulness end to end, through the REAL callTool()/McpFacade/WorkflowCatalog
// wiring — never a hand-built WorkflowOwnerView fixture (that half is
// tests/unit/workflow-describe-projection.test.ts).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callTool } from '../../src/call-tool.js';
import type { ToolDeps } from '../../src/call-tool.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import type { Clock } from '../../src/clock.js';
import Database from 'better-sqlite3';

const ANCHOR = new Date('2026-09-26T00:00:00.000Z');
const CLOCK: Clock = { now: () => ANCHOR.getTime(), isoNow: () => ANCHOR.toISOString() };
const AUTH_DISABLED = { kind: 'auth-disabled' } as const;
const SCRIPT = "export const meta = { phases: [] };\nreturn 1;";
const MERMAID = 'graph LR';

function partialDeps(d: Record<string, unknown>): ToolDeps {
  return d as unknown as ToolDeps;
}

let dir: string;
let facade: McpFacade;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwe-runnable-truthfulness-'));
  const catalog = new WorkflowCatalog(dir, CLOCK);
  const runManager = new RunManager({ clock: CLOCK, workRoot: dir, catalog, confinementPosture: 'unconfined' });
  facade = new McpFacade({ runManager, confinementPosture: 'unconfined' });
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

async function registerAndPublish(name: string, isRemoteSubmission = false): Promise<void> {
  const reg = await callTool(partialDeps({ facade, isRemoteSubmission }), 'workflow_register', { name, script: SCRIPT, mermaid: MERMAID }, AUTH_DISABLED) as { status?: string; result?: { version?: string } };
  expect(reg.status).toBe('completed');
  const pub = await callTool(partialDeps({ facade }), 'workflow_publish', { name, version: reg.result!.version!, channel: 'release' }, AUTH_DISABLED) as { status?: string };
  expect(pub.status).toBe('completed');
}

describe('issue #93 item 3 — workflow_describe runnable truthfulness (real callTool)', () => {
  it('[LOAD-BEARING] a locally-registered version, described by a REMOTE caller on an unconfined host => runnable:false, runnableReason:CONFINEMENT_UNAVAILABLE', async () => {
    const name = 'runnable-truth-describe-remote-caller';
    await registerAndPublish(name);
    const res = await callTool(partialDeps({ facade, isRemoteSubmission: true }), 'workflow_describe', { name }, AUTH_DISABLED) as { result?: { runnable?: boolean; runnableReason?: string } };
    expect(res.result?.runnable).toBe(false);
    expect(res.result?.runnableReason).toBe('CONFINEMENT_UNAVAILABLE');
  });

  it('[LOAD-BEARING] a REMOTELY-registered version, described by a LOCAL caller on an unconfined host => still runnable:false, CONFINEMENT_UNAVAILABLE', async () => {
    const name = 'runnable-truth-describe-remote-version';
    await registerAndPublish(name, true);
    const res = await callTool(partialDeps({ facade }), 'workflow_describe', { name }, AUTH_DISABLED) as { result?: { runnable?: boolean; runnableReason?: string; registeredRemote?: boolean } };
    expect(res.result?.registeredRemote).toBe(true);
    expect(res.result?.runnable).toBe(false);
    expect(res.result?.runnableReason).toBe('CONFINEMENT_UNAVAILABLE');
  });

  it('mirror: a locally-registered version, described by a LOCAL caller => runnable:true (the accepted local-unconfined cost)', async () => {
    const name = 'runnable-truth-describe-local-ok';
    await registerAndPublish(name);
    const res = await callTool(partialDeps({ facade }), 'workflow_describe', { name }, AUTH_DISABLED) as { result?: { runnable?: boolean; runnableReason?: string | null } };
    expect(res.result?.runnable).toBe(true);
    expect(res.result?.runnableReason).toBeNull();
  });
});

describe('issue #93 item 3 — workflow_list runnable truthfulness (real callTool)', () => {
  it('[LOAD-BEARING] a locally-registered version, listed by a REMOTE caller on an unconfined host => runnable:false, runnableReason:CONFINEMENT_UNAVAILABLE', async () => {
    const name = 'runnable-truth-list-remote-caller';
    await registerAndPublish(name);
    const res = await callTool(partialDeps({ facade, isRemoteSubmission: true }), 'workflow_list', {}, AUTH_DISABLED) as { result?: Array<{ name: string; runnable: boolean; runnableReason?: string }> };
    const row = res.result?.find((r) => r.name === name);
    expect(row).toBeTruthy();
    expect(row?.runnable).toBe(false);
    expect(row?.runnableReason).toBe('CONFINEMENT_UNAVAILABLE');
  });

  it('mirror: a locally-registered version, listed by a LOCAL caller => runnable:true, no runnableReason key', async () => {
    const name = 'runnable-truth-list-local-ok';
    await registerAndPublish(name);
    const res = await callTool(partialDeps({ facade }), 'workflow_list', {}, AUTH_DISABLED) as { result?: Array<{ name: string; runnable: boolean; runnableReason?: string }> };
    const row = res.result?.find((r) => r.name === name);
    expect(row).toBeTruthy();
    expect(row?.runnable).toBe(true);
    expect(row).not.toHaveProperty('runnableReason');
  });
});

// Issue #154 residual (2026-10-10 follow-up): the 2026-10-08 reverify's own INFO note flagged
// that a stored row's `workflow_describe` never NAMED which rule a staleness refusal was about —
// `runnable:false`/`runnableReason:'NOT_RUNNABLE'` alone, same generic shape for every cause.
// `runnableDetail` closes that for the one cause `catalog.validateStoredVersion()` CAN name
// (RESERVED_PREFIX here; same mechanism for any other B1-B4/B4-PARTIAL cause). Seeded the same way
// `tests/integration/stale-registration-revalidation.test.ts`'s own reserved-prefix case does:
// `register()` itself refuses any case of the prefix today, so a pre-fix row is simulated by
// registering under a valid placeholder name, then renaming the already-inserted row directly.
describe('issue #154 residual — workflow_describe names the reserved-prefix staleness cause (real callTool)', () => {
  it("a stored row renamed to 'RWE-x' (simulating a pre-v0.37.9 registration) describes runnable:false, runnableReason:'NOT_RUNNABLE', runnableDetail.violation:'RESERVED_PREFIX'", async () => {
    const placeholder = 'runnable-truth-reserved-placeholder';
    await registerAndPublish(placeholder);
    const db = new Database(join(dir, 'catalog.db'));
    db.prepare('UPDATE workflows SET name = ? WHERE name = ?').run('RWE-x', placeholder);
    db.prepare('UPDATE workflow_versions SET name = ? WHERE name = ?').run('RWE-x', placeholder);
    db.close();
    const res = await callTool(partialDeps({ facade }), 'workflow_describe', { name: 'RWE-x' }, AUTH_DISABLED) as {
      result?: { runnable?: boolean; runnableReason?: string | null; runnableDetail?: { violation: string; message: string } | null };
    };
    expect(res.result?.runnable).toBe(false);
    expect(res.result?.runnableReason).toBe('NOT_RUNNABLE');
    expect(res.result?.runnableDetail?.violation).toBe('RESERVED_PREFIX');
    expect(res.result?.runnableDetail?.message).toMatch(/rwe-/);
  });
});

// Issue #166 tail (tester's 2026-10-10 reverify comment, low item 2, owner decision): the SAME
// `runnableDetail` closure, for the OTHER staleness cause that now has sub-rules to name —
// INVALID_NAME. Seeded the same renamed-row idiom as the RESERVED_PREFIX case just above: register
// under a valid placeholder, then rename the already-inserted row directly to a byte-oversized (but
// character-limit-compliant) legacy name — `register()` itself would refuse this name today.
//
// RED before the fix: `runnableDetail` has no `rule`/`limit`/`actual` keys (undefined for all three).
describe('issue #166 tail — workflow_describe names the INVALID_NAME sub-rule a stored row now breaks (low item 2)', () => {
  it("a stored row renamed to a 201-UTF-8-byte legacy name describes runnable:false, runnableReason:'NOT_RUNNABLE', runnableDetail:{violation:'INVALID_NAME', rule:'maxBytes', limit:200, actual:201}", async () => {
    const placeholder = 'runnable-truth-invalid-name-placeholder';
    await registerAndPublish(placeholder);
    const legacyName = 'ñ'.repeat(100) + 'x'; // 101 chars (under 128), 201 UTF-8 bytes (over 200)
    const db = new Database(join(dir, 'catalog.db'));
    db.prepare('UPDATE workflows SET name = ? WHERE name = ?').run(legacyName, placeholder);
    db.prepare('UPDATE workflow_versions SET name = ? WHERE name = ?').run(legacyName, placeholder);
    db.close();
    const res = await callTool(partialDeps({ facade }), 'workflow_describe', { name: legacyName }, AUTH_DISABLED) as {
      result?: { runnable?: boolean; runnableReason?: string | null; runnableDetail?: { violation: string; message: string; rule?: string; limit?: number; actual?: number } | null };
    };
    expect(res.result?.runnable).toBe(false);
    expect(res.result?.runnableReason).toBe('NOT_RUNNABLE');
    expect(res.result?.runnableDetail?.violation).toBe('INVALID_NAME');
    expect(res.result?.runnableDetail?.rule).toBe('maxBytes');
    expect(res.result?.runnableDetail?.limit).toBe(200);
    expect(res.result?.runnableDetail?.actual).toBe(201);
  });
});
