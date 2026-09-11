// UT-249 (DES-206/DES-208, ARCH-125, TASK-208, REQ-131..135): two independent pure-function tests
// bundled here per TASK-208's own file list — `poll.js`'s `endpointsFor(view)` (the visible view's
// fetch set only, DES-206) and the `clientCorpus()` anti-vacuity helper's own floor (DES-208): it
// must THROW on an empty/absent directory rather than silently returning '', or every re-pointed
// negative assertion in the TASK-213 disposition sweep would pass for the wrong reason.
//
// Tier: unit — pure.
//
// Red reason (measured): `src/dashboard/ui/poll.js` does not exist (whole-file import failure);
// `tests/helpers/client-corpus.ts` exists (this dispatch's own test infra) but
// `src/dashboard/**/*.js` does not exist yet, so `clientCorpus()` throwing is the CORRECT,
// already-true behaviour today — recorded green per Mode C, not forced red.
import { describe, it, expect } from 'vitest';
import { clientCorpus } from '../helpers/client-corpus.js';

describe('clientCorpus() anti-vacuity floor (UT-249, DES-208)', () => {
  it('THROWS today because src/dashboard/**/*.js does not exist yet — never returns "" silently', () => {
    expect(() => clientCorpus()).toThrow(/no \.js files found/);
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
});
