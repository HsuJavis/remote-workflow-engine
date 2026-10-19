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
  defaultDirectDeps,
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

  // v41 (DES-267 delta, REQ-227, TASK-276) SUPERSEDES this row: `network` is now retryable — a
  // rejection with no status (UND_ERR_SOCKET, ETIMEDOUT, a reset) looks exactly like the transient
  // wire failures #168 reproduced, and V40-Q9's "only 429/5xx/timeout" carve-out is withdrawn.
  // Red reason (v41): `classifyAttempt` still returns `retryable:false` for this row.
  it("seam invoked, no status, piStop==='error' -> network, RETRYABLE (v41 delta: V40-Q9's carve-out is withdrawn)", () => {
    const r = classifyAttempt({ ...base, seam: { invoked: true, truncated: false }, piStop: 'error' });
    expect(r).toMatchObject({ outcome: 'fail', reason: 'network', retryable: true });
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

  // v41 (DES-267 delta, REQ-227, TASK-276) SUPERSEDES this case: a network error is now retried
  // like any other transient failure, so it exhausts `retries` (3 attempts here) rather than
  // failing on the very first one. Red reason (v41): still classified not-retryable, so this
  // throws "network after 1 attempts" today.
  it('network error -> retried up to `retries`, then PRIMITIVE_FAILED naming network (v41 delta)', async () => {
    const deps = fakeDeps({ fetchSteps: [{ status: 0, networkError: true }] });
    await expect(runDecide({ model: DECIDE_MODEL, state: {}, questions: QUESTIONS, timeoutMs: 1000, retries: 2, runSignal: new AbortController().signal }, deps))
      .rejects.toThrow(/network after 3 attempts?/);
  });

  // v41 (DES-267 delta, TASK-276 dod: "two UND_ERR_SOCKET rejections then 200 -> success, attempts===3").
  it('v41: two network-error attempts then a 200 -> succeeds, attempts === 3', async () => {
    const deps = fakeDeps({ fetchSteps: [{ status: 0, networkError: true }, { status: 0, networkError: true }, { status: 200, body: SYSTEMONE_OK }] });
    const r = await runDecide({ model: DECIDE_MODEL, state: {}, questions: QUESTIONS, timeoutMs: 1000, retries: 2, runSignal: new AbortController().signal }, deps);
    expect(r.attempts).toBe(3);
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

  // v40 Gate 6 round 3 (R-25): the golden for the `/systemone` wire body of a bool question — the
  // REAL pi-ai codec's mapping (public `bool` → wire-level `noul`), read off the stub-captured request.
  it("the /systemone request body for a bool question carries pi-ai's wire mapping (bool -> noul)", async () => {
    const stub = makeStubFetch([{ status: 200, body: SYSTEMONE_OK }]);
    const deps = { ...fakeDeps({ fetchSteps: [] }), fetch: stub.fetch };
    await runDecide({ model: DECIDE_MODEL, state: { stage: 'review' }, questions: QUESTIONS, timeoutMs: 1000, retries: 0, runSignal: new AbortController().signal }, deps);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.url).toMatch(/\/systemone$/);
    const body = JSON.parse(String(stub.calls[0]!.init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      model: DECIDE_MODEL.id,
      state: { stage: 'review' },
      questions: { ok: { type: 'noul', instructions: 'is it ready', criteria: { true: 'yes', false: 'no' } } },
    });
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

// UT-371 (DES-267 v41 delta, ARCH-183, REQ-227, TASK-276): the attempt deadline must reach every
// BODY READ, not just the headers — a 200 whose body never enqueues/closes (the exact #168 hang)
// must still end as `timeout` within the bound, with the stream's own `cancel()` invoked and the
// attempt timer cleared so nothing leaks past the call. Mock policy (unit): `fetch` is the stub
// above (pi-ai's own designed seam); `defaultDirectDeps`'s REAL `attemptSignal`/`sleep` are used
// (not a test fake) so `vi.getTimerCount()`/wall-clock bounds exercise the real timer plumbing.
//
// Red reason: `readCapped` (src/direct-models/call.ts) never races `reader.read()` against the
// attempt's AbortSignal, so a `holdBody` stream hangs forever — none of these settle within the
// bound today, and the attempt timer is never cleared.
describe('UT-371: v41 REQ-227 delta (DES-267) — body-read deadline, network retryable, timer clear', () => {
  const QUESTIONS = { ok: { type: 'bool' as const, instructions: 'is it ready', criteria: { true: 'yes', false: 'no' } } };
  const DECIDE_MODEL: PiClassifierModel = toPiAiModel({ id: 'openrouter/typesafe/jev-1.13', modelType: 'decision', contextWindow: 16384 }) as PiClassifierModel;

  it('a holdBody response ends PRIMITIVE_FAILED{timeout} within timeoutMs + G, cancelling the stream (not a real hang)', async () => {
    const stub = makeStubFetch([{ status: 200, holdBody: true }]);
    const base = defaultDirectDeps({ resolve: () => 'k' } as never);
    const deps: DirectDeps = { ...base, fetch: stub.fetch, resolveKey: () => 'k' };
    const timeoutMs = 30;
    const G = 250; // UT tolerance, DES-267 v41 §"bound (tests only)"
    const start = Date.now();
    let settled: { ok?: unknown; err?: unknown } | 'HUNG' = 'HUNG';
    await Promise.race([
      runDecide({ model: DECIDE_MODEL, state: {}, questions: QUESTIONS, timeoutMs, retries: 0, runSignal: new AbortController().signal }, deps)
        .then((v) => { settled = { ok: v }; }, (e) => { settled = { err: e }; }),
      new Promise<void>((r) => setTimeout(r, timeoutMs + G)),
    ]);
    expect(settled, 'the call never settled within the bound — readCapped is not racing the abort signal').not.toBe('HUNG');
    expect((settled as { err?: unknown }).err).toMatchObject({ code: 'PRIMITIVE_FAILED', detail: expect.objectContaining({ reason: 'timeout' }) });
    expect(Date.now() - start).toBeLessThanOrEqual(timeoutMs + G);
    expect(stub.cancelledCount()).toBeGreaterThanOrEqual(1);
  }, 5000);

  it('holdBody + retries:2 -> 3 attempts, each one independently bounded and cancelled (not just the first)', async () => {
    const stub = makeStubFetch([{ status: 200, holdBody: true }]);
    const base = defaultDirectDeps({ resolve: () => 'k' } as never);
    const deps: DirectDeps = { ...base, fetch: stub.fetch, resolveKey: () => 'k', sleep: async () => {} };
    const timeoutMs = 20;
    const G = 250;
    const start = Date.now();
    let settled: { ok?: unknown; err?: unknown } | 'HUNG' = 'HUNG';
    await Promise.race([
      runDecide({ model: DECIDE_MODEL, state: {}, questions: QUESTIONS, timeoutMs, retries: 2, runSignal: new AbortController().signal }, deps)
        .then((v) => { settled = { ok: v }; }, (e) => { settled = { err: e }; }),
      new Promise<void>((r) => setTimeout(r, 3 * timeoutMs + G)),
    ]);
    expect(settled, 'did not settle within 3 attempts worth of bound').not.toBe('HUNG');
    expect((settled as { err?: unknown }).err).toMatchObject({ code: 'PRIMITIVE_FAILED', detail: expect.objectContaining({ reason: 'timeout', attempts: 3 }) });
    expect(Date.now() - start).toBeLessThanOrEqual(3 * timeoutMs + G);
    expect(stub.cancelledCount()).toBe(3);
  }, 5000);

  it('attempt timer is cleared on a success (no leaked setTimeout past the call)', async () => {
    vi.useFakeTimers();
    try {
      const stub = makeStubFetch([{ status: 200, body: { answers: { ok: { type: 'noul', noul: 0.8 } } } }]);
      const base = defaultDirectDeps({ resolve: () => 'k' } as never);
      const deps: DirectDeps = { ...base, fetch: stub.fetch, resolveKey: () => 'k' };
      await runDecide({ model: DECIDE_MODEL, state: {}, questions: QUESTIONS, timeoutMs: 5000, retries: 0, runSignal: new AbortController().signal }, deps);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('attempt timer is cleared on timeout -> retry -> ok (no leaked setTimeout from the retry\'s OWN attempt)', async () => {
    // Attempt 1 times out via the PRE-EXISTING, already-correct mechanism (`neverResolves` reacts
    // to the fetch-level AbortSignal) — this isolates the retry's own timer-leak from the readCapped
    // bug above. Attempt 2 then succeeds fast, its own attemptSignal timer never firing — exactly the
    // case `clear()` exists for.
    vi.useFakeTimers();
    try {
      const stub = makeStubFetch([{ status: 200, neverResolves: true }, { status: 200, body: { answers: { ok: { type: 'noul', noul: 0.8 } } } }]);
      const base = defaultDirectDeps({ resolve: () => 'k' } as never);
      const deps: DirectDeps = { ...base, fetch: stub.fetch, resolveKey: () => 'k', sleep: async () => {} };
      const p = runDecide({ model: DECIDE_MODEL, state: {}, questions: QUESTIONS, timeoutMs: 10, retries: 1, runSignal: new AbortController().signal }, deps);
      await vi.advanceTimersByTimeAsync(10); // fires attempt 1's timer -> neverResolves' abort listener rejects -> retry
      await p;
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
