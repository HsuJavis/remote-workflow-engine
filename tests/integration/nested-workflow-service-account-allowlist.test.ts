// Service accounts spec (owner decision 2026-10-03), §Authorization: "nested workflow() calls from
// its runs" are workflow-scoped too. Found missing by a post-implementation architecture review: a
// SERVICE ACCOUNT's workflow() call composes a nested run purely by catalog resolve() + confinement
// + param-contract checks (`RunManager._handleWorkflowRequest`) — no owner/role/allowlist check at
// all (true for every principal, human or service account; `_handleWorkflowRequest`'s own comment at
// run-manager.ts:891-892 says a nested call "always resolves release regardless of owner"). Without
// this, a service account allowlisted to one workflow that itself (or an author willing to help)
// calls `workflow('other-name')` reaches ANY released workflow, defeating the allowlist's whole
// point. A HUMAN principal's nested calls are deliberately left unchanged (no ownership concept for
// nested composition exists for anyone today — fixing that generally is out of scope here); this is
// additive and conditioned on the run's principal being an `sa:` id.
//
// Mock policy (integration tier, mirrors nested-workflow-n-level.test.ts IT-026 lineage): real
// RunManager + real on-disk WorkflowCatalog + real sandbox child processes/IPC, echo AgentSpawner.
//
// Red reason: `RunManager` has no `serviceAccountWorkflows` dependency and `_handleWorkflowRequest`
// never consults one — a nested workflow() call from an sa:-owned run reaches any released name.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { AgentSpawner } from '../../src/agent-executor.js';
import { registerPublished, startScript } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

function echoSpawner(): AgentSpawner {
  return { async run(req) { return { kind: 'text', value: req.prompt }; } };
}

async function completedValue(mgr: RunManager, runId: string): Promise<unknown> {
  let view = await mgr.status(runId);
  for (let i = 0; i < 300 && (view.status === 'running' || view.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 25));
    view = await mgr.status(runId);
  }
  expect(view.status).toBe('completed');
  const result = await mgr.result(runId);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

describe('nested workflow() respects a service account\'s workflows allowlist (service accounts spec §Authorization)', () => {
  let workRoot: string;
  beforeEach(() => { workRoot = mkdtempSync(join(tmpdir(), 'rwe-nested-sa-')); });
  afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it('refuses a nested workflow() call to a name outside the run\'s sa: principal allowlist', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'leaf', `return 'L';`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      serviceAccountWorkflows: (principal) => (principal === 'sa:ci-bot' ? ['allowed-top'] : undefined),
    });

    const runId = await startScript(
      mgr,
      `try { const m = await workflow('leaf', {}); return { m }; } catch (e) { return { code: e && (e.code || e.name) }; }`,
      { name: 'allowed-top', principal: 'sa:ci-bot' },
    );
    expect(await completedValue(mgr, runId)).toEqual({ code: 'WORKFLOW_NOT_ALLOWED' });
  });

  it('allows a nested workflow() call to a name inside the allowlist', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'leaf', `return 'L';`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      serviceAccountWorkflows: (principal) => (principal === 'sa:ci-bot' ? ['allowed-top', 'leaf'] : undefined),
    });

    const runId = await startScript(
      mgr,
      `const m = await workflow('leaf', {}); return { m };`,
      { name: 'allowed-top', principal: 'sa:ci-bot' },
    );
    expect(await completedValue(mgr, runId)).toEqual({ m: 'L' });
  });

  it('a human (non sa:) principal is unaffected — no allowlist concept for nested calls today', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'leaf', `return 'L';`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      // Mirrors the real contract (PrincipalAdmin.workflowsFor): undefined for a non-`sa:` id.
      serviceAccountWorkflows: (principal) => (principal.startsWith('sa:') ? ['nothing-matches'] : undefined),
    });

    const runId = await startScript(
      mgr,
      `const m = await workflow('leaf', {}); return { m };`,
      { name: 'allowed-top', principal: 'alice@example.com' },
    );
    expect(await completedValue(mgr, runId)).toEqual({ m: 'L' });
  });

  it('no serviceAccountWorkflows dependency at all (e.g. every pre-existing RunManager test) never gates anyone', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'leaf', `return 'L';`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner() });

    const runId = await startScript(
      mgr,
      `const m = await workflow('leaf', {}); return { m };`,
      { name: 'allowed-top', principal: 'sa:ci-bot' },
    );
    expect(await completedValue(mgr, runId)).toEqual({ m: 'L' });
  });
});
