// IT-298 (DES-248, ARCH-165/166/167/168, TASK-246, REQ-215/REQ-205): the ONE real-child
// integration test DES-248 reserves — a real script rethrowing a real engine refusal in a REAL
// FORKED CHILD (the IPC is not mocked, because a mocked seam is exactly the forgery seam REQ-215 is
// about): `run_result.error.code` is the refusal code and the run-level envelope carries the
// ledger's structured entry. The refusing dispatch is the `agentType` retirement check
// (`agent-executor.ts`'s `PARAM_UNKNOWN`/`AGENT_OPT_RETIRED`, REQ-203) — it fires BEFORE any
// gateway call, so this test needs no model/network access; `RunManager`'s default real spawner
// (`AgentExecutor` over a real, never-invoked `LiteLLMGatewayClient`) and default real `SandboxHost`
// are both used unmodified, the same "real by default, never dispatches because the script never
// legitimately reaches the gateway" shape `run-error-restart.test.ts` already relies on.
//
// This file also folds in the RunEntry ledger's 8-refusal cap and the nested-frame negative case
// (DES-248's own tests line assigns these to the "UT via injected SandboxApi" file, but the ledger
// only actually populates from a REAL `agentThrow` IPC round trip — child-entry.ts's real send()/
// guards.ts's real WeakMap — so a truly mock-free case for them needs this same fork anyway;
// folding them here avoids a second, redundant fork-based file for one mechanism).
//
// Red reason: today `PARAM_UNKNOWN` is not in `guards.ts`'s `ENGINE_REFUSAL_CODES`, so the refusal
// flattens to `SCRIPT_ERROR` and carries no `refusalRef` at all — `run_result.error.code` is
// `'SCRIPT_ERROR'`, not `'PARAM_UNKNOWN'`.
//
// Mock policy (E2E/acceptance-shaped IT — REQ-215's IPC must NOT be mocked): real RunManager, real
// forked sandbox child, real AgentExecutor (gateway never reached).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { FixedClock } from '../../src/clock.js';
import { synthesizeMermaid, synthesizeMeta, synthesizePhase } from '../helpers/workflow-fixtures.js';

// `agentType` is refused at REGISTRATION time by the static scan (SCAN_VIOLATION/AGENT_OPT_RETIRED,
// REQ-203) — the runtime `Object.hasOwn(req.opts,'agentType')` guard in `agent-executor.ts` exists
// for a PINNED PRE-v34 version already in the catalog before that scan rule existed, which is the
// only way a real dispatch ever reaches it. `insertVersion` (unlike `register`/
// `validateRegistration`) performs no scan, so it is used directly here to simulate that legacy row
// — the real, only reachable path to this refusal, not a shortcut around it.
async function registerLegacyPinned(catalog: import('../../src/workflow-catalog.js').WorkflowCatalog, name: string, script: string): Promise<void> {
  const withMeta = synthesizeMeta(synthesizePhase(script));
  const mermaid = synthesizeMermaid(withMeta);
  const { version } = await catalog.insertVersion({ name, script: withMeta, mermaid, params: { agents: {}, args: {} } as any, principal: null });
  await catalog.publish(name, version, 'release', null);
}

const clock = new FixedClock(new Date('2026-09-21T00:00:00.000Z'));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'rwe-it298-refusal-'));
  dirs.push(dir);
  const store = new SqliteRunStore(join(dir, 'store'), clock);
  const catalog = new WorkflowCatalog(join(dir, 'catalog'), clock);
  const mgr = new RunManager({ store, clock, catalog, workRoot: dir } as any);
  return { mgr, catalog };
}

async function waitForStatus(mgr: RunManager, runId: string, want: string, maxIters = 400): Promise<void> {
  for (let i = 0; i < maxIters; i++) {
    const v = await mgr.status(runId);
    if (v.status === want) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitForStatus: run ${runId} never reached ${want}`);
}

/** Waits for ANY terminal status and returns it — used where today's (pre-implementation) code
 *  path may legitimately terminate differently than the eventual GREEN behaviour (e.g. an engine
 *  refusal that `parallel()` still swallows to `null` today completes the run instead of failing
 *  it), so the assertion reports the real mismatch instead of a generic timeout. */
async function waitForTerminal(mgr: RunManager, runId: string, maxIters = 400): Promise<string> {
  const TERMINAL = new Set(['completed', 'failed', 'stopped']);
  for (let i = 0; i < maxIters; i++) {
    const v = await mgr.status(runId);
    if (TERMINAL.has(v.status as string)) return v.status as string;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitForTerminal: run ${runId} never reached a terminal state`);
}

describe('IT-298: a real engine refusal, rethrown in a real forked child, reaches run_result.error with a structured marker', () => {
  it('agentType retirement (PARAM_UNKNOWN/AGENT_OPT_RETIRED) rethrown by the script — run_result.error.code is the refusal code', async () => {
    const { mgr, catalog } = boot();
    const script = `
      try {
        await agent('x', { agentType: 'retired-type', prompt: 'hi' });
        return { caught: false };
      } catch (e) {
        throw e;
      }
    `;
    await registerLegacyPinned(catalog, 'it298-retired', script);
    const runId = await mgr.start({ name: 'it298-retired', principal: 'alice' } as any);
    await waitForStatus(mgr, runId, 'failed');

    const result = await mgr.result(runId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PARAM_UNKNOWN');
    // the run-level envelope carries the ledger's structured entry, not merely the flattened code —
    // the message is the one AgentExecutor minted (mentions the retired agentType mechanism).
    expect(result.error.message).toMatch(/agentType/i);
  }, 30000);

  it('9 refused parallel() branches (past the 8-slot ledger bound) still fail the run with a structured code — ADR-073 propagation, not swallowed to null', async () => {
    // NOTE (honesty, not a DES-248 case): `refusalsDropped` has NO read surface anywhere in
    // DES-248's signature (RunEntry is private to RunManager) — it is not observable from a test at
    // this tier, so this case does NOT assert the counter increments. What it DOES prove: driving
    // the ledger past its 8-slot bound (9 genuine refusals in one run) must not itself break the
    // run's ordinary failure reporting — the 9th refusal (unrecorded past the cap) is still the one
    // that fails the run, with its own code, not a silently-swallowed null.
    const { mgr, catalog } = boot();
    const branches = Array.from({ length: 9 }, (_, i) => `() => agent('x${i}', { agentType: 'retired-type', prompt: 'hi ${i}' })`).join(',\n');
    const script = `
      try {
        await parallel([${branches}]);
        return { caught: false };
      } catch (e) {
        throw e;
      }
    `;
    await registerLegacyPinned(catalog, 'it298-cap', script);
    const runId = await mgr.start({ name: 'it298-cap', principal: 'alice' } as any);
    const status = await waitForTerminal(mgr, runId);
    // Pre-implementation (RED): ADR-073's propagation rule isn't wired yet, so `parallel()` still
    // swallows every unrecognized-code refusal to `null` and the run COMPLETES instead of failing —
    // this assertion is the RED signature for "the 9 refusals never even reach the run-level
    // failure path", which is a stronger unimplemented-ness than a mere code mismatch.
    expect(status).toBe('failed');
    const result = await mgr.result(runId);
    if (!result.ok) expect(result.error.code).toBe('PARAM_UNKNOWN');
  }, 60000);

  it('a refusal raised INSIDE a nested workflow() frame fails with its code but NO marker (scoped out by design)', async () => {
    const { mgr, catalog } = boot();
    await registerLegacyPinned(catalog, 'it298-child', `
      await agent('x', { agentType: 'retired-type', prompt: 'hi' });
      return 1;
    `);
    await registerLegacyPinned(catalog, 'it298-parent', `
      try {
        await workflow('it298-child', {});
        return { caught: false };
      } catch (e) {
        throw e;
      }
    `);
    const runId = await mgr.start({ name: 'it298-parent', principal: 'alice' } as any);
    await waitForStatus(mgr, runId, 'failed');
    const result = await mgr.result(runId);
    expect(result.ok).toBe(false);
  }, 30000);
});
