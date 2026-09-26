// issue #93 item 2 — the confinement refusal (call-tool.ts's old early door, now removed) used to
// fire BEFORE argument validation, authorization, and workflow/version existence resolution: a
// remote+unconfined run_start with a NONEXISTENT workflow, or with malformed args, was answered a
// blanket CONFINEMENT_UNAVAILABLE — a permanent, migration-shaped refusal that told the caller
// nothing about its OWN mistake. This file pins the corrected precedence, end to end through the
// REAL `callTool()` (never a direct RunManager call): INVALID_ARGUMENT and WORKFLOW_NOT_FOUND both
// win over CONFINEMENT_UNAVAILABLE, and only an otherwise-ADMISSIBLE remote+unconfined submission
// is refused CONFINEMENT_UNAVAILABLE — with nothing created either way.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callTool } from '../../src/call-tool.js';
import type { ToolDeps } from '../../src/call-tool.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import type { Clock } from '../../src/clock.js';

const ANCHOR = new Date('2026-09-26T00:00:00.000Z');
const CLOCK: Clock = { now: () => ANCHOR.getTime(), isoNow: () => ANCHOR.toISOString() };
const AUTH_DISABLED = { kind: 'auth-disabled' } as const;
const SCRIPT = 'return 1;';
const MERMAID = 'graph LR';

function partialDeps(d: Record<string, unknown>): ToolDeps {
  return d as unknown as ToolDeps;
}

let dir: string;
let store: InMemoryRunStore;
let catalog: WorkflowCatalog;
let facade: McpFacade;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwe-confinement-precedence-'));
  store = new InMemoryRunStore(CLOCK);
  catalog = new WorkflowCatalog(dir, CLOCK);
  // Store shared between RunManager and McpFacade (D-I1 — otherwise every facade lookup 404s
  // against RunManager's own private default store).
  const runManager = new RunManager({ clock: CLOCK, workRoot: dir, catalog, confinementPosture: 'unconfined', store });
  facade = new McpFacade({ runManager, store });
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('issue #93 item 2 — remote+unconfined run_start precedence (real callTool)', () => {
  it('[LOAD-BEARING] a nonexistent workflow => WORKFLOW_NOT_FOUND, never CONFINEMENT_UNAVAILABLE', async () => {
    const deps = partialDeps({ facade, isRemoteSubmission: true, confinementPosture: 'unconfined' });
    const run = await callTool(deps, 'run_start', { name: 'does-not-exist' }, AUTH_DISABLED) as { status?: string; error?: { code?: string } };
    expect(run.status).toBe('failed');
    expect(run.error?.code).toBe('WORKFLOW_NOT_FOUND');
    expect(await store.listRuns()).toEqual([]);
  });

  it('[LOAD-BEARING] malformed args (name is not a string) => INVALID_ARGUMENT, never CONFINEMENT_UNAVAILABLE', async () => {
    const deps = partialDeps({ facade, isRemoteSubmission: true, confinementPosture: 'unconfined' });
    const run = await callTool(deps, 'run_start', { name: 123 }, AUTH_DISABLED) as { status?: string; error?: { code?: string } };
    expect(run.status).toBe('failed');
    expect(run.error?.code).toBe('INVALID_ARGUMENT');
    expect(await store.listRuns()).toEqual([]);
  });

  it('[LOAD-BEARING] a valid, existing, published, locally-registered workflow => CONFINEMENT_UNAVAILABLE (the submission itself is remote) — nothing created', async () => {
    const name = 'confinement-precedence-valid';
    const reg = await callTool(partialDeps({ facade }), 'workflow_register', { name, script: SCRIPT, mermaid: MERMAID }, AUTH_DISABLED) as { status?: string; result?: { version?: string } };
    expect(reg.status).toBe('completed');
    const pub = await callTool(partialDeps({ facade }), 'workflow_publish', { name, version: reg.result!.version!, channel: 'release' }, AUTH_DISABLED) as { status?: string };
    expect(pub.status).toBe('completed');

    const deps = partialDeps({ facade, isRemoteSubmission: true, confinementPosture: 'unconfined' });
    const run = await callTool(deps, 'run_start', { name }, AUTH_DISABLED) as { status?: string; error?: { code?: string } };
    expect(run.status).toBe('failed');
    expect(run.error?.code).toBe('CONFINEMENT_UNAVAILABLE');
    expect(await store.listRuns()).toEqual([]);
  });

  it('mirror: the SAME valid workflow, submitted LOCALLY (isRemoteSubmission omitted) => actually runs', async () => {
    const name = 'confinement-precedence-local-ok';
    const reg = await callTool(partialDeps({ facade }), 'workflow_register', { name, script: SCRIPT, mermaid: MERMAID }, AUTH_DISABLED) as { status?: string; result?: { version?: string } };
    const pub = await callTool(partialDeps({ facade }), 'workflow_publish', { name, version: reg.result!.version!, channel: 'release' }, AUTH_DISABLED) as { status?: string };
    expect(pub.status).toBe('completed');

    const run = await callTool(partialDeps({ facade, confinementPosture: 'unconfined' }), 'run_start', { name }, AUTH_DISABLED) as { status?: string; error?: unknown; result?: { runId?: string } };
    expect(run.error).toBeUndefined();
    expect(run.result?.runId).toBeTruthy();
  });
});
