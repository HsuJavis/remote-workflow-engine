// IT-311 (DES-274, ARCH-187, ADR-090/092/093/094, TASK-271): `RunManager._handleDecideRequest` /
// `_handleImageRequest` — the accountable call order: pre-flight validation BEFORE any spend. A
// refusal at validation (step 1) must leave the provider fetch UNCALLED and the semaphore's `inUse`
// unchanged.
//
// Mock policy (integration, real adjacent components): real RunManager + real InMemoryRunStore +
// real sandbox fork; the OpenRouter wire is the one genuinely un-runnable third party, stood in by
// `tests/helpers/stub-fetch.ts` injected at `RunManagerDeps.directDeps` (DES-274's own seam).
//
// Red reason: `decide`/`generateImage` are not sandbox globals yet (see UT-350) — the script throws
// a ReferenceError before any handler/validation logic is reached at all. Every case below fails on
// that uniform cause today; once TASK-269+271 land, each becomes a real validation-order assertion.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import { makeStubFetch } from '../helpers/stub-fetch.js';

async function pollStatus(mgr: RunManager, runId: string, ms = 20, maxIter = 150): Promise<any> {
  for (let i = 0; i < maxIter; i++) {
    const v = await mgr.status(runId);
    if (['completed', 'failed', 'stopped'].includes(v.status)) return v;
    await new Promise((r) => setTimeout(r, ms));
  }
  return mgr.status(runId);
}

const DECIDE_META = `export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 1 } } } } };`;

describe('IT-311: pre-flight refusal leaves the provider fetch uncalled (DES-274 step 1)', () => {
  it('an oversized state object is refused BEFORE any provider fetch', async () => {
    const stub = makeStubFetch([{ status: 200, body: { answers: { ok: { type: 'noul', noul: 0.5 } } } }]);
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-01T00:00:00Z')));
    const mgr = new RunManager({ store, directDeps: { fetch: stub.fetch } } as any);
    const runId = await startScript(mgr, `
      ${DECIDE_META}
      const big = 'x'.repeat(200000);
      await decide('gate', { state: { big }, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });
      return 'done';
    `, {});
    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('failed');
    // This is the assertion that actually distinguishes "the feature works" from "the whole script
    // crashed before reaching it" — a bare ReferenceError (today's SCRIPT_ERROR) satisfies the
    // "fetch never called" check below VACUOUSLY, so the error CODE is the one that must be exactly
    // PRIMITIVE_INPUT_INVALID, never SCRIPT_ERROR, for this case to mean what it claims.
    expect(view.error?.code ?? view.code).toBe('PRIMITIVE_INPUT_INVALID');
    expect(stub.calls).toHaveLength(0);
  });
});
