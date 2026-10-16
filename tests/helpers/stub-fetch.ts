// TASK-263 (DES-267): a configurable, hermetic fetch stub shared by direct-models-call.test.ts and
// its downstream integration tests (primitive-handlers/resume/sentinel-sweep/latency). Each call
// consumes the next queued step; the final step repeats once the queue is exhausted. A
// `neverResolves` step settles ONLY when the request's own AbortSignal fires — it never waits on a
// real timer, so a "timeout" scenario is driven entirely by the test's fake `attemptSignal`, never
// by the wall clock.
export interface StubFetchStep {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Overrides `body` when set — raw bytes, for response_too_large / malformed-body tests. */
  bodyBytes?: Uint8Array;
  /** Settles only on abort (simulates a hung provider). */
  neverResolves?: boolean;
  /** Rejects with a network-level TypeError instead of resolving (no status, no body). */
  networkError?: boolean;
}

export interface StubFetchHandle {
  fetch: typeof fetch;
  calls: { url: string; init: RequestInit | undefined }[];
}

function abortError(): Error {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

export function makeStubFetch(steps: StubFetchStep[]): StubFetchHandle {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  let i = 0;
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const step = steps[Math.min(i, steps.length - 1)]!;
    i++;
    calls.push({ url: String(input), init });
    const signal = init?.signal as AbortSignal | undefined;
    if (step.neverResolves) {
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) { reject(abortError()); return; }
        signal?.addEventListener('abort', () => reject(abortError()), { once: true });
      });
    }
    if (step.networkError) return Promise.reject(new TypeError('fetch failed'));
    const bytes = step.bodyBytes ?? new TextEncoder().encode(JSON.stringify(step.body ?? {}));
    // A real provider response declares its content-type; without it the OpenAI SDK (used by
    // pi-ai's openrouter-images codec) can't tell this is JSON and fails to parse the body. Only
    // stamped for a `body`-shaped (JSON) step — `bodyBytes` stays content-type-free, as a
    // malformed/oversized-body test wants.
    const headers = step.bodyBytes === undefined && step.headers?.['content-type'] === undefined
      ? { 'content-type': 'application/json', ...step.headers }
      : step.headers;
    return Promise.resolve(new Response(bytes.slice(), { status: step.status, headers }));
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}
