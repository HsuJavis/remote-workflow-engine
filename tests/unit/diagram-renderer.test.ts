// UT-167 (v25, REQ-119, DES-166, TASK-166): the three defences REQ-119 makes acceptance clauses,
// pinned on the cache object itself.
//
// Why they exist: `GET /api/workflows/:name/describe` is ANONYMOUS (adjudication #8 H-1 removed its
// auth gate so a token-less browser could read it), and REQ-119 renders the diagram LAZILY — so
// without these three, an unauthenticated request could spawn a ~300MB headless Chrome, once per
// request, unmetered:
//   (a) cache-first  — a hit renders NOTHING (the counting fake proves the call count, not a timing);
//   (b) single-flight — N GENUINELY concurrent gets for the same (name, version) render ONCE;
//   (c) cap + hard timeout — over the cap the answer is RENDER_BUSY (the route falls back to source),
//       and a render that never settles is abandoned with RENDER_TIMEOUT rather than held forever.
//
// Mock policy (unit, DES-119): the render function is the injected seam — a COUNTING fake, never a
// real spawn. Counting renders is the whole oracle here, and 10 concurrent real Chromes in vitest
// would be the very resource exhaustion this file exists to prevent. The real spawn path is covered
// by UT-168 (a stub `mmdc`, real child process, no Chrome) and end-to-end by VAL-152 (real mmdc +
// real Chrome).
import { describe, it, expect } from 'vitest';
import { DiagramRenderer, type RenderFn, type RenderOutcome } from '../../src/diagram-render.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

/** A render fake that counts calls, records every AbortSignal it was handed, and lets a test decide
 *  when (or whether) each call settles. */
function countingFake(impl?: (n: number) => Promise<RenderOutcome>): {
  fn: RenderFn; calls: () => number; sources: string[]; signals: AbortSignal[];
} {
  let n = 0;
  const sources: string[] = [];
  const signals: AbortSignal[] = [];
  const fn: RenderFn = (src, signal) => {
    n++;
    sources.push(src);
    signals.push(signal);
    return impl ? impl(n) : Promise.resolve<RenderOutcome>({ ok: true, svg: SVG });
  };
  return { fn, calls: () => n, sources, signals };
}

describe('DiagramRenderer — (a) cache-first: a hit spawns nothing (UT-167, REQ-119)', () => {
  it('renders once for the first get and NEVER again for the same (name, version)', async () => {
    const fake = countingFake();
    const r = new DiagramRenderer({ render: fake.fn });

    const first = await r.get('wf', 'v1', 'graph TD;');
    const second = await r.get('wf', 'v1', 'graph TD;');
    const third = await r.get('wf', 'v1', 'graph TD;');

    expect(first).toEqual({ ok: true, svg: SVG, cached: false });
    // The assertion that matters: the SECOND request invoked no render at all.
    expect(second).toEqual({ ok: true, svg: SVG, cached: true });
    expect(third.ok).toBe(true);
    expect(fake.calls()).toBe(1);
  });

  it('is keyed by (name, version) — a different version and a different name each render once', async () => {
    const fake = countingFake();
    const r = new DiagramRenderer({ render: fake.fn });

    await r.get('wf', 'v1', 'a');
    await r.get('wf', 'v2', 'b');
    await r.get('other', 'v1', 'c');
    await r.get('wf', 'v1', 'a');

    expect(fake.calls()).toBe(3);
    expect(fake.sources).toEqual(['a', 'b', 'c']);
  });

  it('invalidate(name) drops every version of that name — the workflow_deregister path', async () => {
    // REQ-111 makes a version's mermaid immutable, so the cache never needs invalidating for an
    // EDIT. It does for a DELETE: `insertVersion` allocates `v${max+1}` over the name's OWN rows and
    // `deregister` deletes them all, so deregister → re-register hands the SAME (name, 'v1') key a
    // DIFFERENT diagram. Without this the next viewer would be served the deleted workflow's picture.
    const fake = countingFake();
    const r = new DiagramRenderer({ render: fake.fn });

    await r.get('wf', 'v1', 'old');
    await r.get('keep', 'v1', 'keep');
    r.invalidate('wf');
    await r.get('wf', 'v1', 'new');
    await r.get('keep', 'v1', 'keep');

    expect(fake.sources).toEqual(['old', 'keep', 'new']);
  });
});

describe('DiagramRenderer — (b) single-flight: N concurrent, ONE render (UT-167, REQ-119)', () => {
  it('ten genuinely concurrent gets for the same key render once and all receive that one result', async () => {
    let release!: (o: RenderOutcome) => void;
    const gate = new Promise<RenderOutcome>((res) => { release = res; });
    const fake = countingFake(() => gate);
    const r = new DiagramRenderer({ render: fake.fn });

    // Started, NOT awaited — all ten are in flight before any of them settles. (Sequential awaits
    // would be answered by the cache and would prove nothing about single-flight.)
    const inFlight = Array.from({ length: 10 }, () => r.get('wf', 'v1', 'graph TD;'));
    await Promise.resolve(); // let every get() reach its await
    expect(fake.calls()).toBe(1);

    release({ ok: true, svg: SVG });
    const results = await Promise.all(inFlight);

    expect(fake.calls()).toBe(1);
    expect(results).toHaveLength(10);
    for (const res of results) expect(res).toMatchObject({ ok: true, svg: SVG });
  });

  it('a follower does NOT consume a concurrency slot — 10 followers under a cap of 1 all succeed', async () => {
    let release!: (o: RenderOutcome) => void;
    const gate = new Promise<RenderOutcome>((res) => { release = res; });
    const fake = countingFake(() => gate);
    const r = new DiagramRenderer({ render: fake.fn, maxConcurrent: 1 });

    const inFlight = Array.from({ length: 10 }, () => r.get('wf', 'v1', 'graph TD;'));
    await Promise.resolve();
    release({ ok: true, svg: SVG });

    for (const res of await Promise.all(inFlight)) expect(res.ok).toBe(true);
    expect(fake.calls()).toBe(1);
  });
});

describe('DiagramRenderer — (c) concurrency cap + hard timeout (UT-167, REQ-119)', () => {
  it('a DIFFERENT key over the cap is refused RENDER_BUSY instead of spawning', async () => {
    let release!: (o: RenderOutcome) => void;
    const gate = new Promise<RenderOutcome>((res) => { release = res; });
    const fake = countingFake(() => gate);
    const r = new DiagramRenderer({ render: fake.fn, maxConcurrent: 1 });

    const first = r.get('wf', 'v1', 'a');
    await Promise.resolve();
    const second = await r.get('other', 'v1', 'b'); // over the cap — must not wait, must not spawn

    expect(second).toEqual({ ok: false, reason: 'RENDER_BUSY' });
    expect(fake.calls()).toBe(1);

    release({ ok: true, svg: SVG });
    expect((await first).ok).toBe(true);
  });

  it('frees the slot when a render settles — a busy refusal is never permanent', async () => {
    let release!: (o: RenderOutcome) => void;
    const gate = new Promise<RenderOutcome>((res) => { release = res; });
    const fake = countingFake((n) => (n === 1 ? gate : Promise.resolve<RenderOutcome>({ ok: true, svg: SVG })));
    const r = new DiagramRenderer({ render: fake.fn, maxConcurrent: 1 });

    const first = r.get('wf', 'v1', 'a');
    await Promise.resolve();
    expect((await r.get('other', 'v1', 'b')).ok).toBe(false);
    release({ ok: true, svg: SVG });
    await first;

    expect((await r.get('other', 'v1', 'b')).ok).toBe(true);
  });

  it('abandons a render that never settles: RENDER_TIMEOUT, the signal is aborted, the slot is freed', async () => {
    const fake = countingFake(() => new Promise<RenderOutcome>(() => { /* never settles */ }));
    const r = new DiagramRenderer({ render: fake.fn, timeoutMs: 30, maxConcurrent: 1 });

    const out = await r.get('wf', 'v1', 'a');

    expect(out).toEqual({ ok: false, reason: 'RENDER_TIMEOUT' });
    // The signal is how the spawn wrapper learns to kill the process GROUP (mmdc + its Chrome):
    // a timeout that only abandons the promise leaks a ~300MB browser per hung render.
    expect(fake.signals[0]!.aborted).toBe(true);
    // The slot is not held by the abandoned render.
    expect((await r.get('other', 'v1', 'b')).ok).toBe(false); // this one times out too...
    expect(fake.calls()).toBe(2); //  …but it was ALLOWED to start, so the cap was released.
  });
});

describe('DiagramRenderer — failures degrade, and are never cached (UT-167, REQ-119)', () => {
  it('passes the underlying reason through instead of inventing a success', async () => {
    const fake = countingFake(() => Promise.resolve<RenderOutcome>({ ok: false, reason: 'RENDERER_MISSING', detail: 'mmdc not installed' }));
    const r = new DiagramRenderer({ render: fake.fn });

    expect(await r.get('wf', 'v1', 'a')).toMatchObject({ ok: false, reason: 'RENDERER_MISSING' });
  });

  it('a failed render is NOT negative-cached — a transient failure does not blank the picture until restart', async () => {
    const fake = countingFake((n) => Promise.resolve<RenderOutcome>(n === 1 ? { ok: false, reason: 'RENDER_FAILED' } : { ok: true, svg: SVG }));
    const r = new DiagramRenderer({ render: fake.fn });

    expect((await r.get('wf', 'v1', 'a')).ok).toBe(false);
    expect((await r.get('wf', 'v1', 'a'))).toEqual({ ok: true, svg: SVG, cached: false });
    expect((await r.get('wf', 'v1', 'a'))).toEqual({ ok: true, svg: SVG, cached: true });
    expect(fake.calls()).toBe(2);
  });

  it('a render that THROWS is a RENDER_FAILED answer, not a rejected get()', async () => {
    const fake = countingFake(() => Promise.reject(new Error('boom')));
    const r = new DiagramRenderer({ render: fake.fn });

    expect(await r.get('wf', 'v1', 'a')).toMatchObject({ ok: false, reason: 'RENDER_FAILED' });
    // and the slot survived the throw
    expect(await r.get('wf', 'v1', 'a')).toMatchObject({ ok: false, reason: 'RENDER_FAILED' });
  });

  it('the cache is BOUNDED — an unbounded Map of ~60KB SVGs is itself a memory sink', async () => {
    const fake = countingFake();
    const r = new DiagramRenderer({ render: fake.fn, maxEntries: 2 });

    await r.get('a', 'v1', 'a');
    await r.get('b', 'v1', 'b');
    await r.get('c', 'v1', 'c'); // evicts the oldest ('a')
    expect(r.size()).toBe(2);

    await r.get('a', 'v1', 'a');
    expect(fake.calls()).toBe(4);
  });
});
