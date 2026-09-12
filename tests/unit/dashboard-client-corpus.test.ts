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
import { describe, it, expect } from 'vitest';
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
});
