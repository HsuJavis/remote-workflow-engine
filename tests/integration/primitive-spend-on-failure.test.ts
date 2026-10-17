// IT-322 (Gate 8 r1 V40-C2, ARCH-187 v40b, ADR-094, REQ-225): a decide()/generateImage() call the
// provider already billed is COUNTED even when the call then fails —
//   (a) a malformed 2xx decide body that carried `usage.cost` (the catch arm used to drop it), and
//   (b) a generateImage() whose post-provider file write throws (writeImages ran outside any
//       try/catch: no addUsage, no terminal record, no failed event).
// Both assert the spend reaches the run's usage AND the live budget guard (a second call is refused
// BUDGET_EXCEEDED), and (b) also that the AgentRecord is terminal `failed`, the script sees a
// constructed PRIMITIVE_FAILED{reason:'write'} and no host path leaks into the error.
//
// Mock policy (integration): real RunManager/InMemoryRunStore/sandbox fork; the OpenRouter wire is
// stubbed at `RunManagerDeps.directDeps`; pricing via a real `ModelBook` with a fixed priced row.
// The write failure is a REAL fs failure (a directory planted at the engine-chosen final name ->
// `rename` EISDIR), not a mocked writeImages.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { ModelBook } from '../../src/models/model-book.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import { makeStubFetch } from '../helpers/stub-fetch.js';
import { EXAMPLE_IMAGE_MODEL } from '../../src/authoring-guide.js';

async function pollStatus(mgr: RunManager, runId: string, ms = 20, maxIter = 250): Promise<any> {
  for (let i = 0; i < maxIter; i++) {
    const v = await mgr.status(runId);
    if (['completed', 'failed', 'stopped'].includes(v.status)) return v;
    await new Promise((r) => setTimeout(r, ms));
  }
  return mgr.status(runId);
}

const IMAGE_MODEL_ID = EXAMPLE_IMAGE_MODEL.replace(/^openrouter\//, '');
const DECIDE_META = `export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } } } };`;
const IMAGE_META = `export const meta = { phases: [], params: { images: { hero: { model: { type: 'string', default: '${EXAMPLE_IMAGE_MODEL}' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } } } };`;
const QUESTIONS = `{ ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } }`;

function pricedBook(): ModelBook {
  return new ModelBook(
    async () => [
      { provider: 'openrouter', model: 'typesafe/jev-1.13', modelType: 'decision', modelTypeSource: 'static', ratesPerM: { in: 1, out: 1, cacheRead: 1, cacheWrite: 1 } },
      { provider: 'openrouter', model: IMAGE_MODEL_ID, modelType: 'image-gen', modelTypeSource: 'static', ratesPerM: { in: 1, out: 1, cacheRead: 1, cacheWrite: 1 } },
    ],
    { clock: new FixedClock(new Date('2026-10-01T00:00:00Z')) },
  );
}

describe('IT-322: a billed-but-failed primitive call is counted, not dropped (V40-C2)', () => {
  it('decide(): a 200 malformed body carrying usage.cost is charged to the run usage AND the live budget', async () => {
    // answers name a question that was never asked -> checkAnswers fails -> `malformed`, terminal.
    const stub = makeStubFetch([{ status: 200, body: { answers: { wrong: { type: 'noul', noul: 0.8 } }, usage: { cost: 0.5 } } }]);
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-01T00:00:00Z')));
    const mgr = new RunManager({ store, modelBook: pricedBook(), directDeps: { fetch: stub.fetch, resolveKey: () => 'sk-test' } } as any);
    const runId = await startScript(mgr, `
      ${DECIDE_META}
      let first = null;
      try { await decide('gate', { state: {}, questions: ${QUESTIONS} }); } catch (e) { first = e.code + ':' + e.message; }
      if (!first || !/^PRIMITIVE_FAILED:decide 'gate' failed: malformed after 1 attempt$/.test(first)) return 'unexpected-first:' + first;
      await decide('gate', { state: {}, questions: ${QUESTIONS} });
      return 'second-call-was-not-refused';
    `, { budget: { usd: 0.3 } });
    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('failed');
    // the first (billed) failure pushed spend past 0.3 -> the second call is refused pre-flight.
    expect(view.error?.code ?? view.code).toBe('BUDGET_EXCEEDED');
    expect(stub.calls).toHaveLength(1);
    expect(view.usage?.costUSD).toBeCloseTo(0.5, 6);
    const rec = (view.agents ?? []).find((a: any) => a.kind === 'decide');
    expect(rec?.state).toBe('failed');
    expect(rec?.costUSD).toBeCloseTo(0.5, 6);
    expect(rec?.unpriced).toBe(false);
  });

  it('generateImage(): a post-provider write failure finalizes the record failed, charges the spend, and surfaces PRIMITIVE_FAILED{write} with no host path', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-it316-'));
    try {
      const base = makeStubFetch([{ status: 200, body: { id: 'g1', usage: { cost: 0.5 }, choices: [{ message: { content: '', images: [{ image_url: 'data:image/png;base64,iVBORw0KGgoAAAAA' }] } }] } }]);
      let wsResolve!: (p: string) => void;
      const wsReady = new Promise<string>((r) => { wsResolve = r; });
      // plant a DIRECTORY at every plausible engine-chosen final name before the provider answers,
      // so writeImages' tmp+rename hits a real EISDIR after the provider has already billed.
      const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const ws = await wsReady;
        for (let seq = 0; seq < 4; seq++) mkdirSync(join(ws, 'generated', `hero-${seq}-0.png`), { recursive: true });
        return base.fetch(input, init);
      }) as typeof fetch;
      const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-01T00:00:00Z')));
      const mgr = new RunManager({ store, workRoot, modelBook: pricedBook(), directDeps: { fetch: fetchImpl, resolveKey: () => 'sk-test' } } as any);
      const runId = await startScript(mgr, `
        ${IMAGE_META}
        let first = null;
        try { await generateImage('hero', { prompt: 'p' }); } catch (e) { first = e.code + ':' + e.message; }
        if (!first || !/^PRIMITIVE_FAILED:generateImage 'hero' failed: write after 1 attempt$/.test(first)) return 'unexpected-first:' + first;
        if (first.includes('/')) return 'host-path-leaked:' + first;
        await generateImage('hero', { prompt: 'p' });
        return 'second-call-was-not-refused';
      `, { budget: { usd: 0.3 } });
      const ws = await mgr.workspacePath(runId);
      wsResolve(ws!);
      const view = await pollStatus(mgr, runId);
      expect(view.status).toBe('failed');
      expect(view.error?.code ?? view.code).toBe('BUDGET_EXCEEDED');
      expect(base.calls).toHaveLength(1);
      expect(view.usage?.costUSD).toBeCloseTo(0.5, 6);
      const rec = (view.agents ?? []).find((a: any) => a.kind === 'image');
      expect(rec?.state).toBe('failed');
      expect(rec?.costUSD).toBeCloseTo(0.5, 6);
    } finally {
      rmSync(workRoot, { recursive: true, force: true });
    }
  });
});
