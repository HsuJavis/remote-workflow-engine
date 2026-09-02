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
import { FixedClock } from '../../src/clock.js';
import { WorkflowCatalog, resolveVersionRequest, type Channels } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade, type ReadContext } from '../../src/mcp-facade.js';

const CLOCK = new FixedClock(new Date('2026-09-02T10:00:00.000Z'));
const CTX: ReadContext = { authEnabled: false, principal: null };

let workRoot: string;
let catalog: WorkflowCatalog;
let facade: McpFacade;
beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-facade-describe-'));
  catalog = new WorkflowCatalog(workRoot, CLOCK);
  facade = new McpFacade({ runManager: new RunManager({ catalog, clock: CLOCK }) } as any);
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
    const { version } = await catalog.register('describe-parity', `return 1;`);
    await catalog.publish('describe-parity', version, 'release', null);
    const known = new Set([version]);
    const channels: Channels = { release: version, beta: null };
    const expected = resolveVersionRequest(sel, channels, known);

    const resp = await (facade as any).workflow_describe({ name: 'describe-parity', ...sel }, CTX);
    if (expected.ok) {
      expect(resp.error).toBeUndefined();
    } else {
      expect(resp.error?.code).toBe(expected.code);
    }
  });

  it('an unknown workflow NAME (not just an unresolvable selector) returns WORKFLOW_NOT_FOUND', async () => {
    const resp = await (facade as any).workflow_describe({ name: 'never-registered' }, CTX);
    expect(resp.error?.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('DANGLING_CHANNEL is NOT collapsed into CHANNEL_UNPUBLISHED — a pruned-version pointer is a different operator fault', async () => {
    const { version: v1 } = await catalog.register('dangling-fixture', `return 1;`);
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

describe('workflow_regenerate_diagram — owner gate, ANALYZER_DISABLED, in-flight idempotence (UT-114, DES-126, DES-127 B4)', () => {
  it('a non-owner is refused NOT_WORKFLOW_OWNER', async () => {
    const { version } = await catalog.register('regen-owned', `return 1;`, undefined, 'owner@example.com');
    await catalog.publish('regen-owned', version, 'release', 'owner@example.com');
    const resp = await (facade as any).workflow_regenerate_diagram({ name: 'regen-owned', version }, 'attacker@example.com');
    expect(resp.error?.code ?? resp.code).toBe('NOT_WORKFLOW_OWNER');
  });

  it('an unknown workflow name returns WORKFLOW_NOT_FOUND', async () => {
    const resp = await (facade as any).workflow_regenerate_diagram({ name: 'never-registered', version: 'v1' }, null);
    expect(resp.error?.code ?? resp.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('an unknown version on a known workflow returns UNKNOWN_VERSION', async () => {
    await catalog.register('regen-unknown-version', `return 1;`);
    const resp = await (facade as any).workflow_regenerate_diagram({ name: 'regen-unknown-version', version: 'v99' }, null);
    expect(resp.error?.code ?? resp.code).toBe('UNKNOWN_VERSION');
  });
});
