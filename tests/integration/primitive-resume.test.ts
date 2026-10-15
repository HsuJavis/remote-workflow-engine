// IT-312 (REQ-226, DES-274, ADR-090/092/093/094, TASK-271): resume replays decide/generateImage,
// never re-calling the provider. 2x decide + 1x generateImage, stop, resume -> 0 further provider
// calls, same answers/file paths as the original run.
//
// Mock policy (integration): real RunManager/InMemoryRunStore/sandbox fork; the OpenRouter wire
// stubbed at `RunManagerDeps.directDeps`.
//
// Red reason: the whole feature is unimplemented — the FIRST run never even completes (decide/
// generateImage are not sandbox globals), so `status === 'completed'` is false today. This is a
// non-vacuous assertion (unlike "fetch was never called", which a crash would satisfy for free):
// resume semantics cannot even be exercised until the run can complete once.
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

const META = `export const meta = { phases: [], params: {
  decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } },
  images: { hero: { model: { type: 'string', default: 'openrouter/black-forest-labs/flux-1.1-pro' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } }
} };`;

const SCRIPT = `
  ${META}
  const d1 = await decide('gate', { state: { s: 1 }, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });
  const d2 = await decide('gate', { state: { s: 2 }, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });
  const img = await generateImage('hero', { prompt: 'a red dog' });
  return { d1, d2, img };
`;

describe('IT-312: decide/generateImage resume replay (REQ-226)', () => {
  it('a 2x-decide + 1x-image run completes on the first attempt (precondition the feature does not meet today)', async () => {
    const stub = makeStubFetch([
      { status: 200, body: { answers: { ok: { type: 'noul', noul: 0.7 } } } },
      { status: 200, body: { answers: { ok: { type: 'noul', noul: 0.3 } } } },
      { status: 200, body: { id: 'g1', choices: [{ message: { content: '', images: [{ image_url: 'data:image/png;base64,iVBORw0KGgo=' }] } }] } },
    ]);
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-01T00:00:00Z')));
    const mgr = new RunManager({ store, directDeps: { fetch: stub.fetch } } as any);
    const runId = await startScript(mgr, SCRIPT, {});
    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('completed');
    expect(stub.calls).toHaveLength(3);
  });
});
