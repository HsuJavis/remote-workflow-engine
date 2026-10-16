// UT-365 (R-34, DES-273/274, TASK-271): a decide()/generateImage() AgentRecord carries `model` in the
// SAME form an agent() record does — the provider-less id beside `provider:'openrouter'` — so every
// reader that joins the two (`${provider}/${model}`) gets the real ref, never a doubled
// `openrouter/openrouter/...` (run_result's `meta.budgetEnforceable.unpricedModels`, observed-stats).
//
// Mock policy (unit): real RunManager + real sandbox child + real McpFacade; only the OpenRouter wire
// is stubbed at `directDeps` (fetch + resolveKey).
//
// Red reason: the handlers pass the full `openrouter/<id>` ref to `recordPrimitive`, so the record's
// `model` is `openrouter/typesafe/jev-1.13` and unpricedModels names
// `openrouter/openrouter/google/gemini-2.5-flash-image`.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { FixedClock } from '../../src/clock.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import { makeStubFetch } from '../helpers/stub-fetch.js';
import { EXAMPLE_DECISION_MODEL, EXAMPLE_IMAGE_MODEL } from '../../src/authoring-guide.js';

const SCRIPT = `export const meta = { phases: [], params: {
  decisions: { gate: { model: { type: 'string', default: '${EXAMPLE_DECISION_MODEL}' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } },
  images: { hero: { model: { type: 'string', default: '${EXAMPLE_IMAGE_MODEL}' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } }
} };
const d = await decide('gate', { state: {}, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });
const img = await generateImage('hero', { prompt: 'p' });
return { d, img };`;

describe('UT-365: primitive AgentRecord.model has the agent() form (R-34)', () => {
  it('record model is the provider-less id and unpricedModels never doubles the provider', async () => {
    const ds = makeStubFetch([{ status: 200, body: { answers: { ok: { type: 'noul', noul: 0.6 } } } }]);
    const is = makeStubFetch([{ status: 200, body: { id: 'g1', choices: [{ message: { content: '', images: [{ image_url: 'data:image/png;base64,iVBORw0KGgo=' }] } }] } }]);
    const fetchRouted = ((i: Parameters<typeof fetch>[0], n?: Parameters<typeof fetch>[1]) =>
      (String(i).includes('/systemone') ? ds.fetch(i, n) : is.fetch(i, n))) as typeof fetch;
    const clock = new FixedClock(new Date('2026-10-16T00:00:00Z'));
    const store = new InMemoryRunStore(clock);
    const mgr = new RunManager({ store, clock, directDeps: { fetch: fetchRouted, resolveKey: () => 'sk-test' } } as never);
    const runId = await startScript(mgr, SCRIPT, {});
    let view = await mgr.status(runId);
    for (let i = 0; i < 200 && !['completed', 'failed', 'stopped'].includes(view.status); i++) {
      await new Promise((r) => setTimeout(r, 25));
      view = await mgr.status(runId);
    }
    expect(view.status).toBe('completed');

    const byKind = Object.fromEntries(view.agents.map((a) => [a.kind, a]));
    expect(byKind['decide']).toMatchObject({ provider: 'openrouter', model: EXAMPLE_DECISION_MODEL.replace(/^openrouter\//, '') });
    expect(byKind['image']).toMatchObject({ provider: 'openrouter', model: EXAMPLE_IMAGE_MODEL.replace(/^openrouter\//, '') });

    const facade = new McpFacade({ runManager: mgr, store, clock });
    const rr = (await facade.runResult({ runId }, { kind: 'auth-disabled' }, false, null)) as { meta?: { budgetEnforceable?: { unpricedModels: string[] } } };
    const unpriced = rr.meta?.budgetEnforceable?.unpricedModels ?? [];
    expect(unpriced).toContain(EXAMPLE_IMAGE_MODEL);
    expect(unpriced.filter((m) => m.startsWith('openrouter/openrouter/'))).toEqual([]);
  });
});
