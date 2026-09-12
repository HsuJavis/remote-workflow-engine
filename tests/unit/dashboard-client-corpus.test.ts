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

  it("the three ported tabs (issues/models/system) each fetch their own single endpoint", async () => {
    const { endpointsFor } = await import('../../src/dashboard/ui/poll.js');
    expect(endpointsFor('issues')).toEqual(['/api/issues']);
    expect(endpointsFor('models')).toEqual(['/api/models']);
    expect(endpointsFor('system')).toEqual(['/api/system']);
  });
});

// v27 Gate 6.5+7 (verifier, coverage gate): `getJSON` executes under Node whenever `poll.js` is
// imported (UT-249 already does) — its three branches (ok/degraded body, unparseable JSON body,
// `fetch` itself rejecting) had no case before this pass.
describe('poll.js: getJSON(url) always resolves {status, body}, never throws (UT-249, DES-202)', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('a 200 with a normal JSON body classifies ok', async () => {
    globalThis.fetch = async () => ({ status: 200, json: async () => ({ a: 1 }) }) as unknown as Response;
    const { getJSON } = await import('../../src/dashboard/ui/poll.js');
    const r = await getJSON('/x');
    expect(r).toEqual({ status: 'ok', body: { a: 1 } });
  });

  it('a 200 whose body is not valid JSON resolves body:null, never throws', async () => {
    globalThis.fetch = async () => ({ status: 200, json: async () => { throw new Error('bad json'); } }) as unknown as Response;
    const { getJSON } = await import('../../src/dashboard/ui/poll.js');
    const r = await getJSON('/x');
    expect(r).toEqual({ status: 'fail', body: null });
  });

  it('fetch() itself rejecting (network error) resolves {status:"fail", body:null}, never rejects', async () => {
    globalThis.fetch = async () => { throw new Error('network down'); };
    const { getJSON } = await import('../../src/dashboard/ui/poll.js');
    await expect(getJSON('/x')).resolves.toEqual({ status: 'fail', body: null });
  });
});
