// v40 Gate 6.5 (verifier, coverage gate): `RunManager._handleDecideRequest`/`_handleImageRequest`
// (DES-274, ARCH-187, TASK-271) scored 83.9%/70.9% statement coverage over tests/unit+tests/
// integration — every OTHER v40 test dispatches a decide()/generateImage() call whose model is
// EITHER priceable-and-under-budget (the happy path) OR deliberately unpriceable with a USD budget
// (VAL-283's own PRICE_UNKNOWN case) — no test exercises OPENROUTER_AUTH_MISSING for either
// primitive, nor a PRICED model whose USD budget is already exhausted (the pre-slot door, DES-274
// step 7). This file closes those branches, for BOTH primitives.
//
// NOT attempted here: the v25 load-bearing IN-SLOT `assertBudget()` re-check (DES-274 step 8,
// ADR-090's second gate) — a deliberate concurrency race (one decide() call holding the sole
// `decideSlots:1` slot while a second queues, budget exhausted by a concurrent call in between).
// Three independent constructions were tried (two decide() calls racing their own charges; a
// concurrent agent() call draining the budget via a separate semaphore with an explicit
// synchronization gate) — each flaked under either v8 coverage instrumentation or plain repeated
// runs (~15-25% failure rate), because the relative ordering of two DIFFERENT dispatch pathways'
// microtask chains through this host's real sandboxed-child IPC is not an invariant this engine's
// own design holds — DES-274 states the adjacent overshoot property itself as "documented, not
// engineered" (`src/run-manager.ts`'s own comment on the identical mechanism). Writing a test that
// passes most of the time is exactly the "fudged test" this ledger's own CLAUDE.md and the
// verifier contract forbid; left as a disclosed, accepted coverage gap in the gate report instead
// of a flaky green.
//
// Mock policy (integration): real RunManager/InMemoryRunStore/sandbox fork; the OpenRouter wire
// stubbed at `RunManagerDeps.directDeps`; pricing injected via a real `ModelBook` whose `source()`
// returns a fixed, already-priced row — no live catalog fetch.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { ModelBook } from '../../src/models/model-book.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import { makeStubFetch } from '../helpers/stub-fetch.js';
import { EXAMPLE_IMAGE_MODEL } from '../../src/authoring-guide.js';

async function pollStatus(mgr: RunManager, runId: string, ms = 20, maxIter = 150): Promise<any> {
  for (let i = 0; i < maxIter; i++) {
    const v = await mgr.status(runId);
    if (['completed', 'failed', 'stopped'].includes(v.status)) return v;
    await new Promise((r) => setTimeout(r, ms));
  }
  return mgr.status(runId);
}

const DECIDE_META = `export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } } } };`;
const IMAGE_META = `export const meta = { phases: [], params: { images: { hero: { model: { type: 'string', default: '${EXAMPLE_IMAGE_MODEL}' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } } } };`;
const [IMAGE_PROVIDER, IMAGE_MODEL_ID] = EXAMPLE_IMAGE_MODEL.split('/').length === 2
  ? ['openrouter', EXAMPLE_IMAGE_MODEL.slice('openrouter/'.length)]
  : ['openrouter', EXAMPLE_IMAGE_MODEL.replace(/^openrouter\//, '')];
const DECIDE_OK = { status: 200, body: { answers: { ok: { type: 'noul', noul: 0.8 } } } };
const IMAGE_OK = { status: 200, body: { id: 'g1', choices: [{ message: { content: '', images: [{ image_url: 'data:image/png;base64,iVBORw0KGgo=' }] } }] } };

/** A `ModelBook` whose one row is already priced (`ratesPerM` given directly — `priceFromRow`
 *  uses it verbatim, no live fetch needed) — `decide`/`image` typed so `primitivePriceKnowable`
 *  passes for both. */
function pricedBook(): ModelBook {
  return new ModelBook(
    async () => [
      { provider: 'openrouter', model: 'typesafe/jev-1.13', modelType: 'decision', modelTypeSource: 'static', ratesPerM: { in: 1, out: 1, cacheRead: 1, cacheWrite: 1 } },
      { provider: IMAGE_PROVIDER, model: IMAGE_MODEL_ID, modelType: 'image-gen', modelTypeSource: 'static', ratesPerM: { in: 1, out: 1, cacheRead: 1, cacheWrite: 1 } },
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', modelType: 'chat', modelTypeSource: 'static', ratesPerM: { in: 1, out: 1, cacheRead: 1, cacheWrite: 1 } },
    ],
    { clock: new FixedClock(new Date('2026-10-01T00:00:00Z')) },
  );
}

describe('decide()/generateImage() OPENROUTER_AUTH_MISSING (DES-274 step 4) — no test anywhere injects a missing key for either primitive', () => {
  it('decide(): no OpenRouter key configured -> OPENROUTER_AUTH_MISSING, provider never called', async () => {
    const stub = makeStubFetch([DECIDE_OK]);
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-01T00:00:00Z')));
    const mgr = new RunManager({ store, directDeps: { fetch: stub.fetch, resolveKey: () => undefined } } as any);
    const runId = await startScript(mgr, `
      ${DECIDE_META}
      await decide('gate', { state: {}, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });
      return 'x';
    `, {});
    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('failed');
    expect(view.error?.code ?? view.code).toBe('OPENROUTER_AUTH_MISSING');
    expect(stub.calls).toHaveLength(0);
  });

  it('generateImage(): no OpenRouter key configured -> OPENROUTER_AUTH_MISSING, provider never called', async () => {
    const stub = makeStubFetch([IMAGE_OK]);
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-01T00:00:00Z')));
    const mgr = new RunManager({ store, directDeps: { fetch: stub.fetch, resolveKey: () => undefined } } as any);
    const runId = await startScript(mgr, `
      ${IMAGE_META}
      await generateImage('hero', { prompt: 'p' });
      return 'x';
    `, {});
    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('failed');
    expect(view.error?.code ?? view.code).toBe('OPENROUTER_AUTH_MISSING');
    expect(stub.calls).toHaveLength(0);
  });
});

describe('decide()/generateImage() PRICE_UNKNOWN (DES-274 step 6) — VAL-283 covers decide(); generateImage() has no equivalent', () => {
  it('generateImage(): an unpriced model under a USD budget is refused PRICE_UNKNOWN, provider never called', async () => {
    const stub = makeStubFetch([IMAGE_OK]);
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-01T00:00:00Z')));
    // no modelBook injected -> every ref is unpriced by default (bare RunManager's own `new
    // ModelBook(async () => [], ...)` fallback).
    const mgr = new RunManager({ store, directDeps: { fetch: stub.fetch, resolveKey: () => 'sk-test' } } as any);
    const runId = await startScript(mgr, `
      ${IMAGE_META}
      await generateImage('hero', { prompt: 'p' });
      return 'x';
    `, { budget: { usd: 1 } });
    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('failed');
    expect(view.error?.code ?? view.code).toBe('PRICE_UNKNOWN');
    expect(stub.calls).toHaveLength(0);
  });
});

describe('decide()/generateImage() BUDGET_EXCEEDED, pre-slot (DES-274 step 7) — a PRICED model with an already-exhausted budget', () => {
  it('decide(): budget.usd:0 refuses BEFORE any provider call (spent(0) >= total(0))', async () => {
    const stub = makeStubFetch([DECIDE_OK]);
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-01T00:00:00Z')));
    const mgr = new RunManager({ store, modelBook: pricedBook(), directDeps: { fetch: stub.fetch, resolveKey: () => 'sk-test' } } as any);
    const runId = await startScript(mgr, `
      ${DECIDE_META}
      await decide('gate', { state: {}, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });
      return 'x';
    `, { budget: { usd: 0 } });
    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('failed');
    expect(view.error?.code ?? view.code).toBe('BUDGET_EXCEEDED');
    expect(stub.calls).toHaveLength(0);
  });

  it('generateImage(): budget.usd:0 refuses BEFORE any provider call (spent(0) >= total(0))', async () => {
    const stub = makeStubFetch([IMAGE_OK]);
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-01T00:00:00Z')));
    const mgr = new RunManager({ store, modelBook: pricedBook(), directDeps: { fetch: stub.fetch, resolveKey: () => 'sk-test' } } as any);
    const runId = await startScript(mgr, `
      ${IMAGE_META}
      await generateImage('hero', { prompt: 'p' });
      return 'x';
    `, { budget: { usd: 0 } });
    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('failed');
    expect(view.error?.code ?? view.code).toBe('BUDGET_EXCEEDED');
    expect(stub.calls).toHaveLength(0);
  });
});
