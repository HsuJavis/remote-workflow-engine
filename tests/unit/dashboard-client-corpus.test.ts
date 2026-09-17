// UT-249 (DES-206/DES-208, ARCH-125, TASK-208, REQ-131..135): two independent pure-function tests
// bundled here per TASK-208's own file list — `poll.js`'s `endpointsFor(view)` (the visible view's
// fetch set only, DES-206) and the `clientCorpus()` anti-vacuity helper's own floor (DES-208): it
// must THROW on an empty/absent directory rather than silently returning '', or every re-pointed
// negative assertion in the TASK-213 disposition sweep would pass for the wrong reason.
//
// Tier: unit — pure.
//
// [v27 Gate 5 defect-queue item (1), fixed 2026-09-12] The original case asserted
// `clientCorpus()` throws against the REAL `src/dashboard/` root, true only while Gate 6 had not
// yet built the client. That premise is now stale — the client tree legitimately exists (TASK-204..
// 214 landed it), so the real root always has files and the case genuinely fails today, not because
// the floor is broken but because the oracle described a directory that no longer stays empty. The
// anti-vacuity GUARANTEE is a property of `clientCorpus()` given *any* empty directory, not a fact
// about today's `src/dashboard/` — re-pointed to a real, disposable empty temp dir so it stays true
// regardless of how large the real client tree grows.
//
// [v28 Gate 5, DES-210, ADR-057, TASK-217, REQ-137/138/139/142/143] two of this file's EXISTING
// cases are amended in place rather than superseded: `endpointsFor('system')` grows from one route
// to three (ADR-057) and `getJSON`'s result shape widens from `{status, body}` to `{status, body,
// reached, source}` (DES-210 — the ONE shape `getViewJSON` must also answer). Both are genuinely
// red against HEAD (measured below, at each case).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clientCorpus } from '../helpers/client-corpus.js';

describe('clientCorpus() anti-vacuity floor (UT-249, DES-208)', () => {
  it('throws on a genuinely empty directory — never returns "" silently', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'client-corpus-empty-'));
    try {
      expect(() => clientCorpus(tmp)).toThrow(/no \.js files found/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("poll.js: endpointsFor(view) is the VISIBLE view's fetch set only (UT-249, DES-206)", () => {
  it('the home view fetches /api/home and /api/workflows, not run- or agent-only endpoints', async () => {
    const { endpointsFor } = await import('../../src/dashboard/ui/poll.js');
    const eps = endpointsFor('home');
    expect(eps.some((e) => e.includes('/api/home'))).toBe(true);
    expect(eps.some((e) => e.includes('/agents/'))).toBe(false);
  });

  it('the run view fetches the dag endpoint, not /api/home', async () => {
    const { endpointsFor } = await import('../../src/dashboard/ui/poll.js');
    const eps = endpointsFor('run');
    expect(eps.some((e) => e.includes('/dag'))).toBe(true);
    expect(eps.some((e) => e.includes('/api/home'))).toBe(false);
  });

  it('the workflow view fetches describe + /api/runs, name-encoded when ctx.name is given', async () => {
    const { endpointsFor } = await import('../../src/dashboard/ui/poll.js');
    const eps = endpointsFor('workflow', { name: 'a b' });
    expect(eps).toContain('/api/workflows/a%20b/describe');
    expect(eps).toContain('/api/runs');
  });

  it("issues/models each fetch their own single endpoint; system fetches THREE (ADR-057's client fold, v28)", async () => {
    const { endpointsFor } = await import('../../src/dashboard/ui/poll.js');
    expect(endpointsFor('issues')).toEqual(['/api/issues']);
    expect(endpointsFor('models')).toEqual(['/api/models']);
    // [v28 Gate 5, DES-210, ADR-057, TASK-217, REQ-138] `ROUTES.system` grows from one route to
    // three so the System tab's counts card (「9 個版本 · 13 次執行記錄」) can fold `/api/workflows`
    // + `/api/runs` client-side with NO new server route (ADR-057's decision (b), the SAME fold
    // `/api/runs`'s own run-history table already reads, so the two can never disagree). Red reason
    // (measured against HEAD, `src/dashboard/ui/poll.js:23`): `ROUTES.system` is still
    // `() => ['/api/system']` today.
    expect(endpointsFor('system')).toEqual(['/api/system', '/api/workflows', '/api/runs']);
  });
});

// v27 Gate 6.5+7 (verifier, coverage gate): `getJSON` executes under Node whenever `poll.js` is
// imported (UT-249 already does) — its three branches (ok/degraded body, unparseable JSON body,
// `fetch` itself rejecting) had no case before this pass.
//
// [v28 Gate 5, DES-210, TASK-217, REQ-142/143] `getJSON`'s result widens from `{status, body}` to
// `{status, body, reached, source}` — every field always present (DES-210's ONE result shape used
// by both `getJSON` and `getViewJSON`). `reached` is what `demoEngages` (UT-245, DES-212) reasons
// over: `false` ONLY in the outer network-failure `catch` (a real drop, never a 4xx/5xx — those
// still "reached" a server), `source` is always `'live'` for this function (`getViewJSON` is the
// one that can answer `'demo'`). Red reason (measured against HEAD, `src/dashboard/ui/poll.js:42-
// 53`): `getJSON` returns exactly `{status, body}` today — a `toEqual` against the widened shape
// fails on the two missing keys in all three cases below.
describe('poll.js: getJSON(url) always resolves {status, body, reached, source}, never throws (UT-249, DES-202/DES-210)', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('a 200 with a normal JSON body classifies ok, reached:true, source:live', async () => {
    globalThis.fetch = async () => ({ status: 200, json: async () => ({ a: 1 }) }) as unknown as Response;
    const { getJSON } = await import('../../src/dashboard/ui/poll.js');
    const r = await getJSON('/x');
    expect(r).toEqual({ status: 'ok', body: { a: 1 }, reached: true, source: 'live' });
  });

  it('a 200 whose body is not valid JSON resolves body:null, reached:true (the SERVER answered, just not with JSON) — never throws', async () => {
    globalThis.fetch = async () => ({ status: 200, json: async () => { throw new Error('bad json'); } }) as unknown as Response;
    const { getJSON } = await import('../../src/dashboard/ui/poll.js');
    const r = await getJSON('/x');
    expect(r).toEqual({ status: 'fail', body: null, reached: true, source: 'live' });
  });

  it('fetch() itself rejecting (network error) resolves {status:"fail", body:null, reached:false} — the ONLY reached:false arm — never rejects', async () => {
    globalThis.fetch = async () => { throw new Error('network down'); };
    const { getJSON } = await import('../../src/dashboard/ui/poll.js');
    await expect(getJSON('/x')).resolves.toEqual({ status: 'fail', body: null, reached: false, source: 'live' });
  });
});

// [v28 Gate 6.5+7, verifier — coverage gate] `setDemoBodies`/`getViewJSON` (DES-210, TASK-217) had
// zero unit coverage — only exercised indirectly at the browser tier (VAL-216/VAL-217). Both are
// pure/Node-testable (no DOM; `getViewJSON` makes no network call while a demo map is installed),
// so per the coverage gate they must be unit-tested directly.
describe('poll.js: getViewJSON(url) answers from an installed demo map with NO network call; otherwise IS getJSON (UT-249, DES-210)', () => {
  afterEach(async () => {
    const { setDemoBodies } = await import('../../src/dashboard/ui/poll.js');
    setDemoBodies(null); // never leak the installed map into a later test/file.
  });

  it('with no map installed, getViewJSON delegates to a real fetch (source:live)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 200, json: async () => ({ a: 1 }) }) as unknown as Response;
    try {
      const { getViewJSON } = await import('../../src/dashboard/ui/poll.js');
      const r = await getViewJSON('/api/system');
      expect(r).toEqual({ status: 'ok', body: { a: 1 }, reached: true, source: 'live' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('a map hit resolves ok/reached/source:demo with the mapped body, no fetch call', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('must not be called while a demo map is installed'); };
    try {
      const { getViewJSON, setDemoBodies } = await import('../../src/dashboard/ui/poll.js');
      setDemoBodies(new Map([['/api/system', { fake: true }]]));
      const r = await getViewJSON('/api/system');
      expect(r).toEqual({ status: 'ok', body: { fake: true }, reached: true, source: 'demo' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('a map miss resolves fail/body:null but reached:true (the page WAS reached, just not this url), no fetch call', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('must not be called while a demo map is installed'); };
    try {
      const { getViewJSON, setDemoBodies } = await import('../../src/dashboard/ui/poll.js');
      setDemoBodies(new Map([['/api/system', {}]])); // installed, but '/api/issues' is not a key
      const r = await getViewJSON('/api/issues');
      expect(r).toEqual({ status: 'fail', body: null, reached: true, source: 'demo' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('setDemoBodies(null) clears the map — getViewJSON falls back to a real fetch again', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 200, json: async () => ({ real: true }) }) as unknown as Response;
    try {
      const { getViewJSON, setDemoBodies } = await import('../../src/dashboard/ui/poll.js');
      setDemoBodies(new Map([['/api/system', { fake: true }]]));
      setDemoBodies(null);
      const r = await getViewJSON('/api/system');
      expect(r).toEqual({ status: 'ok', body: { real: true }, reached: true, source: 'live' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
