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
// Red reason (original): `RunManager` had no service-account dependency at all and
// `_handleWorkflowRequest` consulted none — a nested workflow() call from an sa:-owned run reached
// any released name. Send-back D1 later renamed/widened that dependency to `serviceAccountStatus`
// (adding liveness alongside the allowlist) — this file's cases were updated to match, in place.
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
      serviceAccountStatus: (principal) => (principal === 'sa:ci-bot' ? { live: true, workflows: ['allowed-top'] } : undefined),
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
      serviceAccountStatus: (principal) => (principal === 'sa:ci-bot' ? { live: true, workflows: ['allowed-top', 'leaf'] } : undefined),
    });

    const runId = await startScript(
      mgr,
      `const m = await workflow('leaf', {}); return { m };`,
      { name: 'allowed-top', principal: 'sa:ci-bot' },
    );
    expect(await completedValue(mgr, runId)).toEqual({ m: 'L' });
  });

  // Send-back D1: the nested-call guard shares the SAME admission helper as start()/resume(), so a
  // disabled account is refused SERVICE_ACCOUNT_DISABLED here too, before the allowlist is even
  // consulted — a disabled SA's already-running top-level script cannot keep composing new work via
  // workflow() once the account goes dark mid-run.
  it('refuses a nested workflow() call once the sa: principal is disabled mid-run, even inside its own allowlist', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'leaf', `return 'L';`);
    const store = new InMemoryRunStore(CLOCK);
    // Live for the top-level start() (so the run actually begins), disabled by the time the
    // script's OWN nested workflow() call reaches this same admission check — simulates an admin
    // disabling the account while the run is already in flight.
    let calls = 0;
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      serviceAccountStatus: (principal) => (principal === 'sa:ci-bot' ? { live: (calls++ === 0), workflows: ['allowed-top', 'leaf'] } : undefined),
    });

    const runId = await startScript(
      mgr,
      `try { const m = await workflow('leaf', {}); return { m }; } catch (e) { return { code: e && (e.code || e.name) }; }`,
      { name: 'allowed-top', principal: 'sa:ci-bot' },
    );
    expect(await completedValue(mgr, runId)).toEqual({ code: 'SERVICE_ACCOUNT_DISABLED' });
  });

  it('a human (non sa:) principal is unaffected — no allowlist concept for nested calls today', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'leaf', `return 'L';`);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({
      store, clock: CLOCK, catalog, spawner: echoSpawner(),
      // Mirrors the real contract (PrincipalAdmin.serviceAccountStatus): undefined for a non-`sa:` id.
      serviceAccountStatus: (principal: string) => (principal.startsWith('sa:') ? { live: true, workflows: ['nothing-matches'] } : undefined),
    });

    const runId = await startScript(
      mgr,
      `const m = await workflow('leaf', {}); return { m };`,
      { name: 'allowed-top', principal: 'alice@example.com' },
    );
    expect(await completedValue(mgr, runId)).toEqual({ m: 'L' });
  });

  it('no serviceAccountStatus dependency at all (e.g. every pre-existing RunManager test) never gates anyone', async () => {
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
