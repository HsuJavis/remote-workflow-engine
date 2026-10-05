// review L2: `resume()`'s own model-admission loop (run-manager.ts, right after the
// LEGACY_REREGISTER/UNKNOWN_MODEL checks) re-parses every reachable model as a syntax-only replay
// (owner decision 12's own rule: "refuse rather than dispatch an unresolvable name", never a live
// catalog existence re-check) — but it never re-checked the PROVIDER against this engine's current
// harness. A run admitted while this deployment ran gateway:"sdk" (harnessProviders undefined, so
// `checkModelRef` never refuses an anthropic/* pin at that admission) can be suspended, the
// deployment restarted under gateway:"pi" (harnessProviders:['openrouter','ollama']), and resumed —
// reaching pi-gateway-client.ts's own `invoke()`, whose own defense-in-depth comment says this
// "should have been refused at admission" and answers a raw gateway failure instead of a typed
// refusal. This pins the fix: resume() now re-applies the SAME harnessProviders gate
// `checkModelRef`'s provider check and `_refuseUnadmittableParams` (start()'s own admission) already
// apply, PROVIDER_UNSUPPORTED_BY_HARNESS, at resume's own admission door — before the run is ever
// handed back to a (pi) gateway that cannot dispatch it.
//
// Mock policy (unit tier): real RunManager + real in-memory RunStore + real on-disk WorkflowCatalog
// (temp dir, SHARED across two RunManager instances — same convention
// run-manager-service-account-admission.test.ts uses for "the deployment's own admission policy
// changed between suspend and resume", just via a second instance's own constructor option instead
// of a closure flag) + echo AgentSpawner.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { ModelBook } from '../../src/models/model-book.js';
import type { AgentSpawner } from '../../src/agent-executor.js';
import { startScript, registerPublished, DEFAULT_FIXTURE_MODEL } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

function echoSpawner(): AgentSpawner {
  return { async run(req) { return { kind: 'text', value: req.prompt }; } };
}

async function pollUntilSettled(mgr: RunManager, runId: string) {
  let view = await mgr.status(runId);
  for (let i = 0; i < 300 && (view.status === 'running' || view.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 25));
    view = await mgr.status(runId);
  }
  return view;
}

describe('RunManager.resume() re-checks the pinned model against THIS deployment\'s harness (review L2)', () => {
  let workRoot: string;
  beforeEach(() => { workRoot = mkdtempSync(join(tmpdir(), 'rwe-resume-harness-')); });
  afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it('refuses PROVIDER_UNSUPPORTED_BY_HARNESS resuming an sdk-admitted anthropic/* run once this process runs gateway:"pi"', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const store = new InMemoryRunStore(CLOCK);
    // Admitted under the sdk gateway (no harnessProviders) — DEFAULT_FIXTURE_MODEL is a static-table
    // anthropic ref, accepted with no catalog lookup by checkModelRef's anthropic arm.
    const sdkMgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner() });
    expect(DEFAULT_FIXTURE_MODEL.startsWith('anthropic/')).toBe(true);
    const runId = await startScript(sdkMgr, `phase('p'); return await agent('a', {});`, { principal: null });
    await sdkMgr.suspend(runId);
    expect((await sdkMgr.status(runId)).status).toBe('suspended');

    // The deployment restarts running gateway:"pi" — a fresh RunManager over the SAME store+catalog
    // (exactly what a real process restart looks like: new process, same on-disk state).
    const piMgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner(), harnessProviders: ['openrouter', 'ollama'] });
    await expect(piMgr.resume(runId)).rejects.toMatchObject({ code: 'PROVIDER_UNSUPPORTED_BY_HARNESS' });
    // Refused before dispatch — status is never flipped back to running.
    expect((await piMgr.status(runId)).status).toBe('suspended');
  });

  // issue #136 review L-136-1: resume's own PROVIDER_UNSUPPORTED_BY_HARNESS check used to pass
  // `checkModelRef` an EMPTY `entries` catalog (never a live one), so the refusal always carried the
  // generic "check models_list" hint, even when the deployment's REAL catalog has a specific,
  // catalog-linked OpenRouter ref to suggest instead — the fix now reads `this._modelBook` (the SAME
  // live, TTL'd snapshot `start()`'s own admission already uses), purely to build a better message;
  // it must NOT reintroduce existence re-verification on resume (rule 12's own standing ban) — this
  // loop still only ever throws for the PROVIDER_UNSUPPORTED_BY_HARNESS code, never UNKNOWN_MODEL.
  it('names a real catalog-linked OpenRouter ref in the resume refusal, when the live catalog has one', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const store = new InMemoryRunStore(CLOCK);
    const sdkMgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner() });
    expect(DEFAULT_FIXTURE_MODEL).toBe('anthropic/claude-haiku-4-5-20251001');
    const runId = await startScript(sdkMgr, `phase('p'); return await agent('a', {});`, { principal: null });
    await sdkMgr.suspend(runId);

    const modelBook = new ModelBook(
      async () => [
        { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', sameModelAs: ['openrouter/anthropic/claude-haiku-4.5'] },
        { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' },
      ],
      { clock: CLOCK },
    );
    const piMgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner(), harnessProviders: ['openrouter', 'ollama'], modelBook });
    await expect(piMgr.resume(runId)).rejects.toMatchObject({
      code: 'PROVIDER_UNSUPPORTED_BY_HARNESS',
      message: expect.stringContaining('"openrouter/anthropic/claude-haiku-4.5"'),
    });
    expect((await piMgr.status(runId)).status).toBe('suspended');
  });

  it('resumes normally when the pinned model\'s provider IS in the resuming deployment\'s harness', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const store = new InMemoryRunStore(CLOCK);
    const piMgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner(), harnessProviders: ['openrouter', 'ollama'] });
    const name = 'pi-ok-resume';
    await registerPublished(catalog, name, `phase('p'); return await agent('a', {});`, { model: 'openrouter/openai/gpt-4.1' });
    const runId = await piMgr.start({ name, origin: 'local', principal: null });
    await piMgr.suspend(runId);
    expect((await piMgr.status(runId)).status).toBe('suspended');
    await piMgr.resume(runId);
    const view = await pollUntilSettled(piMgr, runId);
    expect(view.status).toBe('completed');
  });

  it('resumes normally when harnessProviders is unset (sdk gateway) — zero behavior change there', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    const store = new InMemoryRunStore(CLOCK);
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner() });
    const runId = await startScript(mgr, `phase('p'); return await agent('a', {});`, { principal: null });
    await mgr.suspend(runId);
    await mgr.resume(runId);
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');
  });
});
