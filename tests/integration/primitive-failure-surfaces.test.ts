// IT-324 (DES-273/274 v41 delta, ARCH-187, ARCH-192, REQ-231, TASK-277): for every failure class a
// decide()/generateImage() call can hit, the three surfaces a caller can read a failure from must
// name the SAME word and the SAME text:
//   - the script's own caught `e.message` (what the sandboxed script actually sees),
//   - `run_agent_log`'s `failReason`/`detail` (the AgentRecord, read here via `view.agents`), and
//   - `run_status.agentFailures[].reason`/`.message`.
// The REQ is deliberately not in any TASK `traces:` (DES-274 is shared with v40 IMPLs) — this test
// traces REQ-231 directly, per TASK-277's own note.
//
// Mock policy (integration): real RunManager/InMemoryRunStore/sandbox fork, exactly IT-322's own
// harness; only the OpenRouter wire is stubbed at `RunManagerDeps.directDeps`.
//
// Red reason: `failureReason()` (run-manager.ts) still collapses every non-timeout/non-aborted
// `failReason` to the generic `'error'` — so `agentFailures[].reason` never matches the script's own
// `e.message` word (`network`/`http`/`malformed`/`no_output`/`write`) the way `failReason` already
// does.
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

function pricedBook(): ModelBook {
  return new ModelBook(
    async () => [
      { provider: 'openrouter', model: 'typesafe/jev-1.13', modelType: 'decision', modelTypeSource: 'static', ratesPerM: { in: 1, out: 1, cacheRead: 1, cacheWrite: 1 } },
      { provider: 'openrouter', model: EXAMPLE_IMAGE_MODEL.replace(/^openrouter\//, ''), modelType: 'image-gen', modelTypeSource: 'static', ratesPerM: { in: 1, out: 1, cacheRead: 1, cacheWrite: 1 } },
    ],
    { clock: new FixedClock(new Date('2026-10-01T00:00:00Z')) },
  );
}

const QUESTIONS = `{ ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } }`;
function decideMeta(retries: number, timeoutMs = 2000): string {
  return `export const meta = { phases: [], params: { decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: ${timeoutMs} }, retries: { type: 'number', default: ${retries} } } } } };`;
}
function decideScript(retries: number, timeoutMs = 2000): string {
  return `
    ${decideMeta(retries, timeoutMs)}
    let msg = null;
    try { await decide('gate', { state: {}, questions: ${QUESTIONS} }); } catch (e) { msg = e.message; }
    return msg ?? 'DID_NOT_FAIL';
  `;
}

/** Asserts the three-surface equality this REQ requires. `expectedReasonWord` is the word
 *  `AttemptReason`/the grammar names (e.g. 'network', 'http', 'malformed', 'no_output', 'write') —
 *  NOT the old narrower `failReason` vocabulary (`'unreachable'`/`'terminal'`). */
async function expectThreeSurfacesAgree(mgr: RunManager, runId: string, expectedReasonWord: string, kind: 'decide' | 'image'): Promise<void> {
  // The script itself catches the error (so the RUN completes, carrying the caught message as its
  // return value) — this is what lets this test read the script's own `e.message` and compare it
  // against the engine-side surfaces, rather than only observing that it threw.
  const view = await pollStatus(mgr, runId);
  expect(view.status, JSON.stringify(view.error ?? null)).toBe('completed');
  const result = await mgr.result(runId);
  if (!result.ok) throw new Error(`run did not complete ok: ${JSON.stringify(result.error)}`);
  const scriptMessage = result.value as string;
  expect(scriptMessage, 'the script never caught a thrown error').not.toBe('DID_NOT_FAIL');
  // The message CAUSE clause is `HTTP <status>` for the http reason, else the reason word itself
  // (DES-267's own grammar) — the word checked against `agentFailures[].reason`/`failReason` below
  // is always the bare reason, never the HTTP-status-qualified text.
  const messageNeedle = expectedReasonWord === 'http' ? 'HTTP ' : `${expectedReasonWord} after`;
  expect(scriptMessage).toContain(messageNeedle);

  const agent = (view.agents ?? []).find((a: any) => a.kind === kind);
  expect(agent, 'no agent record for this call').toBeDefined();
  expect(agent.detail, 'run_agent_log detail').toBe(scriptMessage);
  expect(agent.failReason, 'run_agent_log failReason').toBe(expectedReasonWord);

  const failure = (view.agentFailures ?? []).find((f: any) => f.agentId === agent.agentId);
  expect(failure, 'no agentFailures entry for this agent').toBeDefined();
  expect(failure.message, 'agentFailures[].message').toBe(scriptMessage);
  expect(failure.reason, 'agentFailures[].reason').toBe(expectedReasonWord);
}

describe('IT-324: decide() failure classes — script/run_agent_log/agentFailures all name the same word+text', () => {
  it.each([
    { label: 'network (no status)', steps: [{ status: 0, networkError: true }], retries: 0, reason: 'network' },
    { label: 'HTTP 429 exhausted', steps: [{ status: 429 }], retries: 0, reason: 'http' },
    { label: 'HTTP 400 (not retryable)', steps: [{ status: 400 }], retries: 0, reason: 'http' },
    { label: 'malformed (unasked question in the answer)', steps: [{ status: 200, body: { answers: { wrong: { type: 'noul', noul: 0.8 } } } }], retries: 0, reason: 'malformed' },
  ])('$label', async ({ steps, retries, reason }) => {
    const stub = makeStubFetch(steps as never);
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-01T00:00:00Z')));
    const mgr = new RunManager({ store, modelBook: pricedBook(), directDeps: { fetch: stub.fetch, resolveKey: () => 'sk-test' } } as any);
    const runId = await startScript(mgr, decideScript(retries), {});
    await expectThreeSurfacesAgree(mgr, runId, reason, 'decide');
  });

  it('timeout (a hung provider that never answers within timeoutMs)', async () => {
    const stub = makeStubFetch([{ status: 200, neverResolves: true }]);
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-01T00:00:00Z')));
    const mgr = new RunManager({ store, modelBook: pricedBook(), directDeps: { fetch: stub.fetch, resolveKey: () => 'sk-test' } } as any);
    const runId = await startScript(mgr, decideScript(0, 30), {});
    await expectThreeSurfacesAgree(mgr, runId, 'timeout', 'decide');
  }, 5000);
});

describe('IT-324: generateImage() failure classes — same three-surface agreement', () => {
  it('no_output (the provider returns zero image blocks)', async () => {
    const stub = makeStubFetch([{ status: 200, body: { id: 'g1', choices: [{ message: { content: '', images: [] } }] } }]);
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-01T00:00:00Z')));
    const mgr = new RunManager({ store, modelBook: pricedBook(), directDeps: { fetch: stub.fetch, resolveKey: () => 'sk-test' } } as any);
    const script = `
      export const meta = { phases: [], params: { images: { hero: { model: { type: 'string', default: '${EXAMPLE_IMAGE_MODEL}' }, timeoutMs: { type: 'number', default: 2000 }, retries: { type: 'number', default: 0 } } } } };
      let msg = null;
      try { await generateImage('hero', { prompt: 'p' }); } catch (e) { msg = e.message; }
      return msg ?? 'DID_NOT_FAIL';
    `;
    const runId = await startScript(mgr, script, {});
    await expectThreeSurfacesAgree(mgr, runId, 'no_output', 'image');
  });

  it('write (a real EISDIR after the provider has already billed)', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-it324-'));
    try {
      const base = makeStubFetch([{ status: 200, body: { id: 'g1', usage: { cost: 0.5 }, choices: [{ message: { content: '', images: [{ image_url: 'data:image/png;base64,iVBORw0KGgoAAAAA' }] } }] } }]);
      let wsResolve!: (p: string) => void;
      const wsReady = new Promise<string>((r) => { wsResolve = r; });
      const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const ws = await wsReady;
        for (let seq = 0; seq < 4; seq++) mkdirSync(join(ws, 'generated', `hero-${seq}-0.png`), { recursive: true });
        return base.fetch(input, init);
      }) as typeof fetch;
      const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-01T00:00:00Z')));
      const mgr = new RunManager({ store, workRoot, modelBook: pricedBook(), directDeps: { fetch: fetchImpl, resolveKey: () => 'sk-test' } } as any);
      const script = `
        export const meta = { phases: [], params: { images: { hero: { model: { type: 'string', default: '${EXAMPLE_IMAGE_MODEL}' }, timeoutMs: { type: 'number', default: 2000 }, retries: { type: 'number', default: 0 } } } } };
        let msg = null;
        try { await generateImage('hero', { prompt: 'p' }); } catch (e) { msg = e.message; }
        return msg ?? 'DID_NOT_FAIL';
      `;
      const runId = await startScript(mgr, script, {});
      const ws = await mgr.workspacePath(runId);
      wsResolve(ws!);
      await expectThreeSurfacesAgree(mgr, runId, 'write', 'image');
    } finally {
      rmSync(workRoot, { recursive: true, force: true });
    }
  });
});
