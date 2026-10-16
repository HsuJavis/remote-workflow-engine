// IT-313 (REQ-229, DES-274, TASK-271): the sentinel sweep — a unique sentinel string in a `decide`
// `state` VALUE and another in a `generateImage` `prompt` must never appear anywhere observable
// (event log, run_status, run's own observed-stats output) after the run settles; each event's
// `data` carries only metadata (label/model/latency/cost/answers/file paths), never the raw
// state/questions/prompt/inputImages. POSITIVE CONTROL: the stub's own captured request bodies DO
// contain the sentinels (proves the sweep is actually exercising a real call path, not a vacuously
// clean "nothing happened" run).
//
// Mock policy (integration): real RunManager/InMemoryRunStore/sandbox fork; OpenRouter stubbed.
// Red reason: the feature is unimplemented, so the provider is NEVER called at all — the positive
// control (`stub.calls` containing the sentinel) fails FIRST, which is the right red: a sweep that
// found "no sentinel anywhere" because nothing ran proves nothing.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import { makeStubFetch } from '../helpers/stub-fetch.js';
// v40 Gate 6 ruling R-23: the retired FLUX 1.1 Pro id is replaced by the guide's single image constant.
import { EXAMPLE_IMAGE_MODEL } from '../../src/authoring-guide.js';

async function pollStatus(mgr: RunManager, runId: string, ms = 20, maxIter = 150): Promise<any> {
  for (let i = 0; i < maxIter; i++) {
    const v = await mgr.status(runId);
    if (['completed', 'failed', 'stopped'].includes(v.status)) return v;
    await new Promise((r) => setTimeout(r, ms));
  }
  return mgr.status(runId);
}

const STATE_SENTINEL = 'sentinel-state-9c7e21';
const PROMPT_SENTINEL = 'sentinel-prompt-4a1f88';

const META = `export const meta = { phases: [], params: {
  decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } },
  images: { hero: { model: { type: 'string', default: '${EXAMPLE_IMAGE_MODEL}' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } }
} };`;

const SCRIPT = `
  ${META}
  await decide('gate', { state: { secret: '${STATE_SENTINEL}' }, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });
  await generateImage('hero', { prompt: '${PROMPT_SENTINEL}' });
  return 'done';
`;

describe('IT-313: sentinel sweep with positive control (REQ-229)', () => {
  // ONE test, control first: a positive-control assertion that fails vacuously-green would let the
  // leak-free assertion below pass for the wrong reason ("nothing ran" instead of "ran clean") — the
  // control is asserted FIRST in the SAME test so a run that never reaches the provider fails here,
  // not silently passes the leak check on an empty transcript.
  it('POSITIVE CONTROL (stub received both sentinels) gates the leak-free sweep (REQ-229)', async () => {
    const stub = makeStubFetch([
      { status: 200, body: { answers: { ok: { type: 'noul', noul: 0.5 } } } },
      { status: 200, body: { id: 'g1', choices: [{ message: { content: '', images: [] } }] } },
    ]);
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-01T00:00:00Z')));
    const mgr = new RunManager({ store, directDeps: { fetch: stub.fetch, resolveKey: () => 'sk-test' } } as any);
    const runId = await startScript(mgr, SCRIPT, {});
    const view = await pollStatus(mgr, runId);

    const bodies = stub.calls.map((c) => String(c.init?.body ?? ''));
    expect(bodies.some((b) => b.includes(STATE_SENTINEL))).toBe(true);
    expect(bodies.some((b) => b.includes(PROMPT_SENTINEL))).toBe(true);

    const transcripts: unknown[] = [];
    for (const a of view.agents ?? []) transcripts.push(...(await store.getTranscript(runId, a.agentId)));
    const serialized = JSON.stringify(transcripts);
    expect(serialized).not.toContain(STATE_SENTINEL);
    expect(serialized).not.toContain(PROMPT_SENTINEL);
  });
});
