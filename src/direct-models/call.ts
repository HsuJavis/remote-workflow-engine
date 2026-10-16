// v40 (DES-267, ARCH-183, ADR-087/088/089/093, TASK-263): the ONE file that imports pi-ai's
// `/api/*` entrypoints directly (enforced by tests/unit/direct-models-import-boundary.test.ts). This
// module owns the engine-side fetch seam, outcome classification, backoff, and retry loop for
// decide()/generateImage() — pi-ai's own request is always made with `maxRetries: 0` and no
// `timeoutMs`/`maxRetryDelayMs`/`headers`, so this loop is the ONLY retry/timeout authority; pi-ai
// itself never throws (`classify`/`generateImages` both catch everything into `stopReason`), so the
// loop reads `res.stopReason`, never a try/catch around the provider call.
import { classify } from '@earendil-works/pi-ai/api/typesafe-system-one';
import { generateImages } from '@earendil-works/pi-ai/api/openrouter-images';
import type {
  ClassifierModel,
  ImageModel,
  ClassifierContext,
  ImagesContext,
  ImagesInputContent,
  Usage,
} from '@earendil-works/pi-ai';
import { codedError } from '../errors.js';
import type { ErrorCode } from '../errors.js';
import type { AttemptReason } from '../event-log.js';
import type { DecideAnswer, DecideQuestion, Tokens } from '../types.js';
import { checkAnswers } from './inputs.js';
import type { SecretSource } from '../secret-resolver.js';
import { resolveOpenrouterKey } from '../gateway/openrouter-key.js';

type JsonObject = Record<string, unknown>;

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'; // constant, never config/catalog/script
export const BACKOFF_BASE_MS = 250;
export const RETRY_AFTER_CAP_MS = 10_000;
export const MAX_DECIDE_RESPONSE_BYTES = 1_048_576;
export const MAX_IMAGE_RESPONSE_BYTES = 33_554_432;
export const IMAGE_USAGE_INCLUDE = true; // Gate 7.5 may flip; not a key

export interface AttemptObservation {
  attempt: number;
  outcome: 'ok' | 'retry' | 'failed';
  reason?: AttemptReason;
  status?: number;
  providerMs: number;
  backoffMs?: number;
}

export interface DirectDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  attemptSignal: (ms: number) => { signal: AbortSignal; fired(): boolean };
  random: () => number;
  resolveKey: () => string | undefined;
  onAttempt: (o: AttemptObservation) => void;
}

function abortError(): Error {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

/** Production `DirectDeps` — a real `setTimeout`-based `sleep`/`attemptSignal`, the real `fetch`,
 *  and the lifted `resolveOpenrouterKey`. `onAttempt` is a no-op here; a caller that wants the
 *  per-attempt observation (DES-274's handler, for its `retry`/`failed` events) overrides it. */
export function defaultDirectDeps(secretSource: SecretSource): DirectDeps {
  return {
    fetch: globalThis.fetch,
    now: () => Date.now(),
    sleep: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(abortError());
          return;
        }
        const onAbort = (): void => {
          clearTimeout(timer);
          reject(abortError());
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    attemptSignal: (ms) => {
      const ctrl = new AbortController();
      let fired = false;
      ctrl.signal.addEventListener('abort', () => {
        fired = true;
      });
      setTimeout(() => ctrl.abort(), ms);
      return { signal: ctrl.signal, fired: () => fired };
    },
    random: () => Math.random(),
    resolveKey: () => resolveOpenrouterKey(secretSource),
    onAttempt: () => {},
  };
}

export interface SeamRecord {
  invoked: boolean;
  status?: number;
  retryAfterMs: number | null;
  providerMs: number;
  truncated: boolean;
  wireCostUSD: number | null;
}

function parseRetryAfterMs(headers: Headers): number | null {
  const ms = headers.get('retry-after-ms');
  if (ms !== null) {
    const v = Number(ms);
    if (Number.isFinite(v)) return v;
  }
  const sec = headers.get('retry-after');
  if (sec !== null) {
    const asSeconds = Number(sec);
    if (Number.isFinite(asSeconds)) return asSeconds * 1000;
    const asDate = Date.parse(sec);
    if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  }
  return null;
}

/** Reads a `Response` body through a reader that stops the moment it would exceed `maxBytes`,
 *  cancelling the stream rather than buffering the rest — the caller treats a truncated read as a
 *  hard failure (never a partial body it tries to parse). */
async function readCapped(res: Response, maxBytes: number): Promise<{ buf: Uint8Array; truncated: boolean }> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return { buf, truncated: buf.byteLength > maxBytes };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total <= maxBytes ? total : 0);
  if (!truncated) {
    let offset = 0;
    for (const c of chunks) {
      buf.set(c, offset);
      offset += c.byteLength;
    }
  }
  return { buf, truncated };
}

function readWireCostUSD(status: number, buf: Uint8Array): number | null {
  if (status < 200 || status >= 300) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(buf).toString('utf8'));
    const cost = (parsed as { usage?: { cost?: unknown } } | null)?.usage?.cost;
    if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) return cost;
  } catch {
    // not JSON / no usage.cost — wireCostUSD stays null, never guessed.
  }
  return null;
}

/** Wraps `deps.fetch` so every call it makes is OBSERVED: `invoked` is set before the underlying
 *  fetch settles (so a rejecting fetch — network error or abort — still reports `invoked:true`,
 *  `status:undefined`), the body is read through `readCapped`, and `wireCostUSD` is read from a 2xx
 *  JSON body's `usage.cost` only. One `SeamRecord` per call; `last()` answers the MOST RECENT one
 *  (`null` before any call this instance has made). */
export function makeObservedFetch(
  deps: Pick<DirectDeps, 'fetch' | 'now'>,
  maxBodyBytes: number,
): { fetch: typeof fetch; last(): SeamRecord | null } {
  let record: SeamRecord | null = null;
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const start = deps.now();
    try {
      const res = await deps.fetch(input, init);
      const { buf, truncated } = await readCapped(res, maxBodyBytes);
      const providerMs = deps.now() - start;
      if (truncated) {
        record = { invoked: true, status: res.status, retryAfterMs: parseRetryAfterMs(res.headers), providerMs, truncated: true, wireCostUSD: null };
        throw new Error('direct-models: response body exceeded the byte cap');
      }
      record = {
        invoked: true,
        status: res.status,
        retryAfterMs: parseRetryAfterMs(res.headers),
        providerMs,
        truncated: false,
        wireCostUSD: readWireCostUSD(res.status, buf),
      };
      return new Response(buf as ConstructorParameters<typeof Response>[0], { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (err) {
      if (record === null) {
        record = { invoked: true, status: undefined, retryAfterMs: null, providerMs: deps.now() - start, truncated: false, wireCostUSD: null };
      }
      throw err;
    }
  }) as typeof fetch;
  return { fetch: fetchImpl, last: () => record };
}

export function classifyAttempt(i: {
  runAborted: boolean;
  timeoutFired: boolean;
  seam: { invoked: boolean; truncated: boolean; status?: number } | null;
  piStop: 'stop' | 'error' | 'aborted';
  hasOutput: boolean;
}): { outcome: 'ok' } | { outcome: 'fail'; reason: AttemptReason; retryable: boolean; status?: number } {
  if (i.runAborted) return { outcome: 'fail', reason: 'aborted', retryable: false };
  if (i.timeoutFired) return { outcome: 'fail', reason: 'timeout', retryable: true };
  if (i.seam?.truncated) return { outcome: 'fail', reason: 'response_too_large', retryable: false };
  const status = i.seam?.status;
  if (status !== undefined) {
    if (status === 429 || status >= 500) return { outcome: 'fail', reason: 'http', retryable: true, status };
    if (status >= 400) return { outcome: 'fail', reason: 'http', retryable: false, status };
  }
  if (i.piStop === 'error') {
    if (i.seam?.invoked && status === undefined) return { outcome: 'fail', reason: 'network', retryable: false };
    return { outcome: 'fail', reason: 'malformed', retryable: false };
  }
  if (i.piStop === 'stop' && !i.hasOutput) return { outcome: 'fail', reason: 'no_output', retryable: false };
  return { outcome: 'ok' };
}

export function backoffMs(attempt: number, retryAfterMs: number | null, rand: number): number | 'over_cap' {
  if (retryAfterMs !== null) {
    if (retryAfterMs > RETRY_AFTER_CAP_MS) return 'over_cap';
    return retryAfterMs;
  }
  return Math.min(RETRY_AFTER_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1) * (0.75 + 0.25 * rand));
}

export function toPiAiModel(row: {
  id: string;
  modelType: 'decision' | 'image-gen';
  modalitiesIn?: string[];
  contextWindow?: number;
}): PiClassifierModel | PiImageModel {
  const input: ('text' | 'image')[] = row.modalitiesIn?.includes('image') ? ['text', 'image'] : ['text'];
  const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  if (row.modelType === 'decision') {
    const m: PiClassifierModel = {
      id: row.id,
      name: row.id,
      api: 'typesafe-system-one',
      type: 'classifier',
      provider: 'openrouter',
      baseUrl: OPENROUTER_BASE_URL,
      input,
      cost,
      contextWindow: row.contextWindow ?? 32768,
    };
    return m;
  }
  const m: PiImageModel = {
    id: row.id,
    name: row.id,
    api: 'openrouter-images',
    type: 'image',
    provider: 'openrouter',
    baseUrl: OPENROUTER_BASE_URL,
    input,
    cost,
    output: ['image'],
  };
  return m;
}

export type PiClassifierModel = ClassifierModel<'typesafe-system-one'>;
export type PiImageModel = ImageModel<'openrouter-images'>;

function reasonWord(reason: AttemptReason, status?: number): string {
  return reason === 'http' ? `HTTP ${status}` : reason;
}

/** `label` is NOT on DES-267's `runDecide`/`runImage` signature (the caller — DES-274's handler —
 *  owns the author-chosen label); kept optional here so the grammar still degrades to
 *  `"decide failed: ..."` rather than guessing an identifier this module was never given. */
function primitiveFailedError(
  kind: 'decide' | 'generateImage',
  label: string | undefined,
  reason: AttemptReason,
  attempts: number,
  status: number | undefined,
  retryable: boolean,
): Error & { code: ErrorCode; detail?: Record<string, unknown> } {
  const who = label !== undefined ? ` '${label}'` : '';
  const plural = attempts === 1 ? 'attempt' : 'attempts';
  const message = `${kind}${who} failed: ${reasonWord(reason, status)} after ${attempts} ${plural}`;
  return codedError('PRIMITIVE_FAILED', message, { reason, status, attempts, retryable });
}

/** One attempt's outcome, shared by `runDecide`/`runImage`'s retry loop: `malformed` is the
 *  decide-only post-check (`checkAnswers`) folded in as if `classifyAttempt` itself had said so. */
interface AttemptResult<T> {
  piStop: 'stop' | 'error' | 'aborted';
  hasOutput: boolean;
  malformed: boolean;
  value: T;
}

async function runWithRetry<T>(
  kind: 'decide' | 'generateImage',
  label: string | undefined,
  timeoutMs: number,
  retries: number,
  runSignal: AbortSignal,
  deps: DirectDeps,
  maxBodyBytes: number,
  attempt: (fetchImpl: typeof fetch, signal: AbortSignal) => Promise<AttemptResult<T>>,
): Promise<{ value: T; seam: SeamRecord | null; attempts: number; providerMsTotal: number; backoffMsTotal: number }> {
  let providerMsTotal = 0;
  let backoffMsTotal = 0;
  for (let a = 1; ; a++) {
    const observed = makeObservedFetch({ fetch: deps.fetch, now: deps.now }, maxBodyBytes);
    const { signal: tSig, fired } = deps.attemptSignal(timeoutMs);
    const signal = AbortSignal.any([tSig, runSignal]);
    const { piStop, hasOutput, malformed, value } = await attempt(observed.fetch, signal);
    const seam = observed.last();
    providerMsTotal += seam?.providerMs ?? 0;
    let classification = classifyAttempt({
      runAborted: runSignal.aborted,
      timeoutFired: fired(),
      seam: seam ? { invoked: seam.invoked, truncated: seam.truncated, status: seam.status } : null,
      piStop,
      hasOutput,
    });
    if (classification.outcome === 'ok' && malformed) {
      classification = { outcome: 'fail', reason: 'malformed', retryable: false };
    }
    if (classification.outcome === 'ok') {
      return { value, seam, attempts: a, providerMsTotal, backoffMsTotal };
    }
    if (classification.reason === 'aborted') {
      throw primitiveFailedError(kind, label, classification.reason, a, classification.status, false);
    }
    if (!classification.retryable || a > retries) {
      deps.onAttempt({ attempt: a, outcome: 'failed', reason: classification.reason, status: classification.status, providerMs: seam?.providerMs ?? 0 });
      throw primitiveFailedError(kind, label, classification.reason, a, classification.status, classification.retryable);
    }
    const b = backoffMs(a, seam?.retryAfterMs ?? null, deps.random());
    if (b === 'over_cap') {
      deps.onAttempt({ attempt: a, outcome: 'failed', reason: classification.reason, status: classification.status, providerMs: seam?.providerMs ?? 0 });
      throw primitiveFailedError(kind, label, classification.reason, a, classification.status, true);
    }
    backoffMsTotal += b;
    deps.onAttempt({ attempt: a, outcome: 'retry', reason: classification.reason, status: classification.status, providerMs: seam?.providerMs ?? 0, backoffMs: b });
    await deps.sleep(b, runSignal);
  }
}

function pickTokens(usage: Usage | undefined): Tokens | undefined {
  if (!usage) return undefined;
  return { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite };
}

export async function runDecide(
  req: {
    model: PiClassifierModel;
    state: JsonObject;
    questions: Record<string, DecideQuestion>;
    timeoutMs: number;
    retries: number;
    runSignal: AbortSignal;
    label?: string;
  },
  deps: DirectDeps,
): Promise<{ answers: Record<string, DecideAnswer>; tokens?: Tokens; wireCostUSD: number | null; attempts: number; providerMsTotal: number; backoffMsTotal: number }> {
  const context: ClassifierContext = { state: req.state as ClassifierContext['state'], questions: req.questions };
  const { value, seam, attempts, providerMsTotal, backoffMsTotal } = await runWithRetry(
    'decide',
    req.label,
    req.timeoutMs,
    req.retries,
    req.runSignal,
    deps,
    MAX_DECIDE_RESPONSE_BYTES,
    async (fetchImpl, signal) => {
      const res = await classify(req.model, context, { fetch: fetchImpl, apiKey: deps.resolveKey(), signal, maxRetries: 0 });
      const hasOutput = Object.keys(res.answers).length > 0;
      const malformed = res.stopReason === 'stop' && !checkAnswers(req.questions, res.answers);
      return { piStop: res.stopReason, hasOutput, malformed, value: res };
    },
  );
  return {
    answers: value.answers,
    tokens: pickTokens(value.usage),
    wireCostUSD: seam?.wireCostUSD ?? null,
    attempts,
    providerMsTotal,
    backoffMsTotal,
  };
}

export async function runImage(
  req: {
    model: PiImageModel;
    prompt: string;
    inputImages: { data: Buffer; mimeType: string }[];
    timeoutMs: number;
    retries: number;
    runSignal: AbortSignal;
    label?: string;
  },
  deps: DirectDeps,
): Promise<{ images: { data: Buffer; mimeType: string }[]; tokens?: Tokens; wireCostUSD: number | null; attempts: number; providerMsTotal: number; backoffMsTotal: number }> {
  const input: ImagesInputContent[] = [
    { type: 'text', text: req.prompt },
    ...req.inputImages.map((img) => ({ type: 'image' as const, data: img.data.toString('base64'), mimeType: img.mimeType })),
  ];
  const context: ImagesContext = { input };
  const { value, seam, attempts, providerMsTotal, backoffMsTotal } = await runWithRetry(
    'generateImage',
    req.label,
    req.timeoutMs,
    req.retries,
    req.runSignal,
    deps,
    MAX_IMAGE_RESPONSE_BYTES,
    async (fetchImpl, signal) => {
      const res = await generateImages(req.model, context, {
        fetch: fetchImpl,
        apiKey: deps.resolveKey(),
        signal,
        maxRetries: 0,
        onPayload: (p) => (IMAGE_USAGE_INCLUDE ? { ...(p as JsonObject), usage: { include: true } } : undefined),
      });
      const images = res.output.filter((o) => o.type === 'image');
      return { piStop: res.stopReason, hasOutput: images.length > 0, malformed: false, value: res };
    },
  );
  const images = value.output
    .filter((o) => o.type === 'image')
    .map((o) => ({ data: Buffer.from((o as { data: string }).data, 'base64'), mimeType: (o as { mimeType: string }).mimeType }));
  return {
    images,
    tokens: pickTokens(value.usage),
    wireCostUSD: seam?.wireCostUSD ?? null,
    attempts,
    providerMsTotal,
    backoffMsTotal,
  };
}
