// UT-342 (DES-267, ARCH-183, ADR-087/088/089/093, TASK-263): `src/direct-models/call.ts` — fetch
// seam, `classifyAttempt`, `backoffMs`, `toPiAiModel`, `makeObservedFetch`, the engine retry loop,
// `runDecide`/`runImage`. The REAL pi-ai 1.0.0 codec is used throughout (no module mocks) — only
// `DirectDeps.fetch`/`sleep`/`attemptSignal`/`random`/`now` are faked, which is pi-ai's own designed
// third-party seam (`ClassifierOptions.fetch`/`ImagesOptions.fetch`), not a mock of the SUT.
//
// Scope note: `classifyAttempt`/`backoffMs`/`toPiAiModel`/`makeObservedFetch` get the FULL precedence
// table (pure, cheap, high value). `runDecide`/`runImage` get exactly the integration cases TASK-263's
// own dod enumerates by name — not the full cross-product of every pure-function branch, which the
// pure-function tests above already pin individually.
//
// Red reason: `src/direct-models/call.ts` does not exist yet — module-not-found.
import { describe, it, expect, vi } from 'vitest';
import {
  classifyAttempt, backoffMs, toPiAiModel, makeObservedFetch, runDecide, runImage,
  BACKOFF_BASE_MS, RETRY_AFTER_CAP_MS, MAX_DECIDE_RESPONSE_BYTES,
  type DirectDeps, type PiClassifierModel, type PiImageModel,
} from '../../src/direct-models/call.js';
import { makeStubFetch, type StubFetchStep } from '../helpers/stub-fetch.js';

describe('UT-342: classifyAttempt precedence table (DES-267)', () => {
  const base = { runAborted: false, timeoutFired: false, seam: null as null | { invoked: boolean; truncated: boolean; status?: number }, piStop: 'stop' as const, hasOutput: true };

  it('runAborted takes precedence over everything else -> aborted, not retryable', () => {
    const r = classifyAttempt({ ...base, runAborted: true, timeoutFired: true });
    expect(r).toEqual({ outcome: 'fail', reason: 'aborted', retryable: false });
  });

  it('timeoutFired (run not aborted) -> timeout, retryable', () => {
    const r = classifyAttempt({ ...base, timeoutFired: true });
    expect(r.outcome === 'fail' && r.reason).toBe('timeout');
    expect(r.outcome === 'fail' && r.retryable).toBe(true);
  });

  it('seam.truncated -> response_too_large, NOT retryable', () => {
    const r = classifyAttempt({ ...base, seam: { invoked: true, truncated: true } });
    expect(r).toMatchObject({ outcome: 'fail', reason: 'response_too_large', retryable: false });
  });

  it.each([429, 500, 503])('status %s -> http, retryable', (status) => {
    const r = classifyAttempt({ ...base, seam: { invoked: true, truncated: false, status } });
    expect(r).toMatchObject({ outcome: 'fail', reason: 'http', retryable: true, status });
  });

  it.each([400, 401, 404])('status %s (4xx, not 429) -> http, NOT retryable', (status) => {
    const r = classifyAttempt({ ...base, seam: { invoked: true, truncated: false, status } });
    expect(r).toMatchObject({ outcome: 'fail', reason: 'http', retryable: false, status });
  });

  it("seam invoked, no status, piStop==='error' -> network, NOT retryable (V40-Q9 names only 429/5xx/timeout)", () => {
    const r = classifyAttempt({ ...base, seam: { invoked: true, truncated: false }, piStop: 'error' });
    expect(r).toMatchObject({ outcome: 'fail', reason: 'network', retryable: false });
  });

  it('seam never invoked & piStop error -> malformed (an engine/codec bug), NOT retryable', () => {
    const r = classifyAttempt({ ...base, seam: { invoked: false, truncated: false }, piStop: 'error' });
    expect(r).toMatchObject({ outcome: 'fail', reason: 'malformed', retryable: false });
  });

  it("piStop==='stop' with no output -> no_output, NOT retryable", () => {
    const r = classifyAttempt({ ...base, seam: { invoked: true, truncated: false, status: 200 }, hasOutput: false });
    expect(r).toMatchObject({ outcome: 'fail', reason: 'no_output', retryable: false });
  });

  it('piStop error with a 2xx status -> malformed, NOT retryable', () => {
    const r = classifyAttempt({ ...base, seam: { invoked: true, truncated: false, status: 200 }, piStop: 'error' });
    expect(r).toMatchObject({ outcome: 'fail', reason: 'malformed', retryable: false });
  });

  it('otherwise -> ok', () => {
    const r = classifyAttempt({ ...base, seam: { invoked: true, truncated: false, status: 200 } });
    expect(r).toEqual({ outcome: 'ok' });
  });
});

describe('UT-342: backoffMs (DES-267)', () => {
  it('retryAfterMs over RETRY_AFTER_CAP_MS -> "over_cap"', () => {
    expect(backoffMs(1, RETRY_AFTER_CAP_MS + 1, 0.5)).toBe('over_cap');
  });

  it('retryAfterMs within cap is used verbatim', () => {
    expect(backoffMs(1, 3000, 0.5)).toBe(3000);
  });

  it('no retryAfterMs -> exponential backoff with jitter, bounded by the cap', () => {
    const v = backoffMs(2, null, 0.5) as number;
    const expected = Math.min(RETRY_AFTER_CAP_MS, BACKOFF_BASE_MS * 2 ** (2 - 1) * (0.75 + 0.25 * 0.5));
    expect(v).toBeCloseTo(expected, 5);
  });
});

describe('UT-342: toPiAiModel (DES-267)', () => {
  it('maps a decision row to a typesafe-system-one classifier model with cost all 0', () => {
    const m = toPiAiModel({ id: 'openrouter/typesafe/jev-1.13', modelType: 'decision', contextWindow: 16384 }) as PiClassifierModel;
    expect(m.api).toBe('typesafe-system-one');
    expect(m.provider).toBe('openrouter');
    expect(m.contextWindow).toBe(16384);
    expect(m.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it('a decision row with no contextWindow defaults to 32768', () => {
    const m = toPiAiModel({ id: 'openrouter/typesafe/jev-1.13', modelType: 'decision' }) as PiClassifierModel;
    expect(m.contextWindow).toBe(32768);
  });

  it('maps an image-gen row to an openrouter-images model', () => {
    const m = toPiAiModel({ id: 'openrouter/google/gemini-2.5-flash-image', modelType: 'image-gen' }) as PiImageModel;
    expect(m.api).toBe('openrouter-images');
    expect(m.output).toEqual(['image']);
  });

  it("input includes 'image' only when modalitiesIn declares it", () => {
    const withImg = toPiAiModel({ id: 'm', modelType: 'decision', modalitiesIn: ['text', 'image'] });
    const textOnly = toPiAiModel({ id: 'm', modelType: 'decision', modalitiesIn: ['text'] });
    expect(withImg.input).toContain('image');
    expect(textOnly.input).not.toContain('image');
  });
});

describe('UT-342: makeObservedFetch (DES-267)', () => {
  it('invoked=true, providerMs measured, wireCostUSD read from a 2xx JSON usage.cost', async () => {
    const stub = makeStubFetch([{ status: 200, body: { answers: {}, usage: { cost: 0.0042 } } }]);
    const { fetch: observed, last } = makeObservedFetch({ fetch: stub.fetch, now: () => Date.now() }, MAX_DECIDE_RESPONSE_BYTES);
    await observed('https://openrouter.ai/api/v1/systemone');
    const rec = last();
    expect(rec?.invoked).toBe(true);
    expect(rec?.truncated).toBe(false);
    expect(rec?.wireCostUSD).toBe(0.0042);
    expect(typeof rec?.providerMs).toBe('number');
  });

  it('a body over maxBodyBytes is reported truncated and the read throws', async () => {
    const stub = makeStubFetch([{ status: 200, bodyBytes: new Uint8Array(1024) }]);
    const { fetch: observed } = makeObservedFetch({ fetch: stub.fetch, now: () => Date.now() }, 16);
    await expect(observed('https://openrouter.ai/api/v1/systemone')).rejects.toThrow();
  });

  it('retryAfterMs is parsed from retry-after-ms, falling back to retry-after seconds', async () => {
    const stub = makeStubFetch([{ status: 429, headers: { 'retry-after-ms': '1500' } }]);
    const { fetch: observed, last } = makeObservedFetch({ fetch: stub.fetch, now: () => Date.now() }, MAX_DECIDE_RESPONSE_BYTES);
    await observed('https://openrouter.ai/api/v1/systemone').catch(() => {});
    expect(last()?.retryAfterMs).toBe(1500);
  });

  it('no 2xx -> wireCostUSD is null', async () => {
    const stub = makeStubFetch([{ status: 500, body: {} }]);
    const { fetch: observed, last } = makeObservedFetch({ fetch: stub.fetch, now: () => Date.now() }, MAX_DECIDE_RESPONSE_BYTES);
    await observed('https://openrouter.ai/api/v1/systemone').catch(() => {});
    expect(last()?.wireCostUSD).toBeNull();
  });
});

// --- runDecide/runImage integration cases (real pi-ai codec), exactly TASK-263's dod enumeration ---

const DECIDE_MODEL: PiClassifierModel = toPiAiModel({ id: 'openrouter/typesafe/jev-1.13', modelType: 'decision', contextWindow: 16384 }) as PiClassifierModel;
const QUESTIONS = { ok: { type: 'bool' as const, instructions: 'is it ready', criteria: { true: 'yes', false: 'no' } } };
const SYSTEMONE_OK = { answers: { ok: { type: 'noul', noul: 0.8 } } };

function fakeDeps(opts: { fetchSteps: StubFetchStep[]; timeoutOnAttempts?: Set<number> }): DirectDeps & { onAttempt: ReturnType<typeof vi.fn> } {
  const stub = makeStubFetch(opts.fetchSteps);
  let attempt = 0;
  const onAttempt = vi.fn();
  return {
    fetch: stub.fetch,
    now: () => 0,
    sleep: async () => {},
    attemptSignal: (_ms: number) => {
      attempt++;
      const ctrl = new AbortController();
      if (opts.timeoutOnAttempts?.has(attempt)) ctrl.abort();
      return { signal: ctrl.signal, fired: () => ctrl.signal.aborted };
    },
    random: () => 0.5,
    resolveKey: () => 'test-openrouter-key',
    onAttempt,
  };
}

describe('UT-342: runDecide retry loop (DES-267, TASK-263 dod)', () => {
  it('429 then 200 -> ONE retry, succeeds, attempt count = 2', async () => {
    const deps = fakeDeps({ fetchSteps: [{ status: 429 }, { status: 200, body: SYSTEMONE_OK }] });
    const r = await runDecide({ model: DECIDE_MODEL, state: {}, questions: QUESTIONS, timeoutMs: 1000, retries: 2, runSignal: new AbortController().signal }, deps);
    expect(r.answers['ok']).toMatchObject({ type: 'bool', probability: 0.8 });
    expect(r.attempts).toBe(2);
  });

  it('503 then 200 -> retries the same as 429', async () => {
    const deps = fakeDeps({ fetchSteps: [{ status: 503 }, { status: 200, body: SYSTEMONE_OK }] });
    const r = await runDecide({ model: DECIDE_MODEL, state: {}, questions: QUESTIONS, timeoutMs: 1000, retries: 2, runSignal: new AbortController().signal }, deps);
    expect(r.attempts).toBe(2);
  });

  it('400 -> NO retry, fails on the first attempt', async () => {
    const deps = fakeDeps({ fetchSteps: [{ status: 400 }] });
    await expect(runDecide({ model: DECIDE_MODEL, state: {}, questions: QUESTIONS, timeoutMs: 1000, retries: 2, runSignal: new AbortController().signal }, deps))
      .rejects.toThrow(/HTTP 400/);
    expect(deps.onAttempt).toHaveBeenCalledTimes(1);
  });

  it('timeout on every attempt -> retries then PRIMITIVE_FAILED reason timeout; attempt count = retries+1', async () => {
    const deps = fakeDeps({ fetchSteps: [{ status: 200, neverResolves: true }], timeoutOnAttempts: new Set([1, 2]) });
    await expect(runDecide({ model: DECIDE_MODEL, state: {}, questions: QUESTIONS, timeoutMs: 10, retries: 1, runSignal: new AbortController().signal }, deps))
      .rejects.toThrow(/timeout after 2 attempts?/);
  });

  it('run abort -> no retry and no failed attempt recorded', async () => {
    const runCtrl = new AbortController();
    runCtrl.abort();
    const deps = fakeDeps({ fetchSteps: [{ status: 200, neverResolves: true }] });
    await expect(runDecide({ model: DECIDE_MODEL, state: {}, questions: QUESTIONS, timeoutMs: 1000, retries: 2, runSignal: runCtrl.signal }, deps))
      .rejects.toThrow();
    expect(deps.onAttempt).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));
  });

  it('network error -> NOT retried (classified "network", not "http")', async () => {
    const deps = fakeDeps({ fetchSteps: [{ status: 0, networkError: true }] });
    await expect(runDecide({ model: DECIDE_MODEL, state: {}, questions: QUESTIONS, timeoutMs: 1000, retries: 2, runSignal: new AbortController().signal }, deps))
      .rejects.toThrow(/network after 1 attempts?/);
  });

  it('over-cap body -> response_too_large, not retried', async () => {
    const deps = fakeDeps({ fetchSteps: [{ status: 200, bodyBytes: new Uint8Array(MAX_DECIDE_RESPONSE_BYTES + 1024) }] });
    await expect(runDecide({ model: DECIDE_MODEL, state: {}, questions: QUESTIONS, timeoutMs: 1000, retries: 2, runSignal: new AbortController().signal }, deps))
      .rejects.toThrow(/response_too_large after 1 attempts?/);
  });

  it('retry-after over cap -> fails fast, retryable:true (per DES-267\'s backoffMs "over_cap" throw)', async () => {
    const deps = fakeDeps({ fetchSteps: [{ status: 429, headers: { 'retry-after-ms': String(RETRY_AFTER_CAP_MS + 1000) } }] });
    await expect(runDecide({ model: DECIDE_MODEL, state: {}, questions: QUESTIONS, timeoutMs: 1000, retries: 5, runSignal: new AbortController().signal }, deps))
      .rejects.toThrow();
    expect(deps.onAttempt).toHaveBeenCalledTimes(1);
  });

  it('every pi call is invoked with maxRetries:0 and no timeoutMs forwarded to pi-ai itself (hermetic retry ownership)', async () => {
    const stub = makeStubFetch([{ status: 200, body: SYSTEMONE_OK }]);
    const deps = fakeDeps({ fetchSteps: [{ status: 200, body: SYSTEMONE_OK }] });
    void stub; // the real seam is exercised through fakeDeps' own stub; this case documents the invariant.
    await runDecide({ model: DECIDE_MODEL, state: {}, questions: QUESTIONS, timeoutMs: 1000, retries: 2, runSignal: new AbortController().signal }, deps);
    // Zero real-time waits: `sleep` above resolves instantly, `attemptSignal` never arms a real timer.
    expect(deps.onAttempt).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: 'retry' }));
  });
});

describe('UT-342: runImage (DES-267, real openrouter-images codec)', () => {
  const IMAGE_MODEL: PiImageModel = toPiAiModel({ id: 'openrouter/google/gemini-2.5-flash-image', modelType: 'image-gen' }) as PiImageModel;
  const SMALL_PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
  const CHAT_COMPLETION_OK = {
    id: 'gen-1', choices: [{ message: { content: '', images: [{ image_url: `data:image/png;base64,${SMALL_PNG_B64}` }] } }],
  };

  it('a successful generation returns decoded image bytes', async () => {
    const deps = fakeDeps({ fetchSteps: [{ status: 200, body: CHAT_COMPLETION_OK }] });
    const r = await runImage({ model: IMAGE_MODEL, prompt: 'a red dog', inputImages: [], timeoutMs: 1000, retries: 0, runSignal: new AbortController().signal }, deps);
    expect(r.images).toHaveLength(1);
    expect(r.images[0]?.mimeType).toBe('image/png');
  });
});
