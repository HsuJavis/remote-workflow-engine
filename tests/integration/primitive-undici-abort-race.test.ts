// IT-323 (DES-267 v41 delta, ARCH-183, REQ-227, TASK-276): the real-wire reproduction of issue
// #168 — the attempt timer's abort can land right after undici's `onComplete` (response fully
// received over the wire) but before the 200KB body reaches the reader. `diagnostics_channel`'s
// `undici:request:trailers` event fires at exactly that moment, so subscribing to it and firing the
// attempt's AbortSignal from inside the callback reproduces the race deterministically, 30 times,
// against a REAL Node http server and the REAL (Node-bundled) undici — no mock of the SUT boundary.
//
// Mock policy (integration): real `runDecide` (src/direct-models/call.ts), real `fetch`/undici, a
// real local `http.createServer`; only the test's own `attemptSignal` fake drives WHEN the abort
// fires (DES-267's own injectable seam) — the provider itself is a real local server, not a stub of
// `call.ts`'s fetch seam.
//
// Red reason: `readCapped` never races the body read against the attempt's AbortSignal, so once
// the signal fires after headers/trailers have already landed, the read hangs forever — every
// iteration below hangs past its bound today. Each iteration is itself bounded by a real
// `setTimeout` watchdog (never vitest's own test timeout) so a RED run finishes fast, failing on an
// assertion, not a "test timed out" message.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import dc from 'node:diagnostics_channel';
import type { Server } from 'node:http';
import { runDecide, toPiAiModel, defaultDirectDeps, type DirectDeps, type PiClassifierModel } from '../../src/direct-models/call.js';
import { ATTEMPT_SETTLE_GRACE_MS } from '../helpers/stub-fetch.js';

const QUESTIONS = { ok: { type: 'bool' as const, instructions: 'is it ready', criteria: { true: 'yes', false: 'no' } } };
const ITERATIONS = 30;
const TRAILERS_CHANNEL = 'undici:request:trailers';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    // A big-ish body (200KB padding) so there is a real window between trailers/completion and the
    // reader actually draining it — the exact shape #168 captured.
    res.end(JSON.stringify({ answers: { ok: { type: 'noul', noul: 0.8 } }, pad: 'x'.repeat(200_000) }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('IT-323: real undici abort-after-trailers race (DES-267 v41 delta, #168 repro)', () => {
  it(`settles within bound and fires the perturbation, over ${ITERATIONS} iterations`, async () => {
    const model = {
      ...(toPiAiModel({ id: 'typesafe/jev-1.13', modelType: 'decision' }) as PiClassifierModel),
      baseUrl,
    };
    const base = defaultDirectDeps({ resolve: () => 'test-key' } as never);

    for (let iter = 0; iter < ITERATIONS; iter++) {
      let fire: (() => void) | null = null;
      let firedThisIteration = false;
      const onTrailers = (): void => {
        const f = fire;
        fire = null;
        if (f) queueMicrotask(f);
      };
      dc.subscribe(TRAILERS_CHANNEL, onTrailers);
      try {
        const attemptSignal = (_ms: number): { signal: AbortSignal; fired(): boolean; clear(): void } => {
          const ctrl = new AbortController();
          let didFire = false;
          fire = () => {
            didFire = true;
            firedThisIteration = true;
            ctrl.abort();
          };
          return { signal: ctrl.signal, fired: () => didFire, clear: () => { fire = null; } };
        };
        const deps: DirectDeps = { ...base, attemptSignal, resolveKey: () => 'test-key' };

        const timeoutMs = 5000; // nominal — this attempt's abort is driven by the trailers hook, not a real wait
        let settled: 'HUNG' | { ok?: unknown; err?: unknown } = 'HUNG';
        const start = Date.now();
        await Promise.race([
          runDecide({ model, state: {}, questions: QUESTIONS, timeoutMs, retries: 0, runSignal: new AbortController().signal }, deps)
            .then((v) => { settled = { ok: v }; }, (e) => { settled = { err: e }; }),
          new Promise<void>((r) => setTimeout(r, ATTEMPT_SETTLE_GRACE_MS)),
        ]);
        expect(firedThisIteration, `iteration ${iter}: the trailers perturbation never fired — not a valid race`).toBe(true);
        expect(settled, `iteration ${iter}: hung past the ${ATTEMPT_SETTLE_GRACE_MS}ms bound — the body read never raced the abort signal`).not.toBe('HUNG');
        expect(Date.now() - start, `iteration ${iter}`).toBeLessThanOrEqual(ATTEMPT_SETTLE_GRACE_MS);
      } finally {
        dc.unsubscribe(TRAILERS_CHANNEL, onTrailers);
      }
    }
  }, (ITERATIONS + 2) * ATTEMPT_SETTLE_GRACE_MS);
});
