// UT-353 (DES-274, ARCH-187, TASK-271): `ResumePlan.invalidate()` — a PUBLIC method that sets the
// plan's internal `_missed` flag, so every LATER `replay()` call returns MISS, same as an ordinary
// cache miss. DES-274 step 3's own use: an image replay hit whose file no longer verifies calls
// `plan.invalidate()` and re-runs live, and every subsequent callSeq must miss too (the existing
// longest-unchanged-prefix rule, now externally triggerable for a reason replay() itself cannot see
// — file-system state, not journal content).
//
// Red reason: `ResumePlan` has no `invalidate` member — `plan.invalidate` is `undefined`, calling it
// throws TypeError.
import { describe, it, expect } from 'vitest';
import { ResumeCache, MISS } from '../../src/resume-cache.js';
import type { JournalEntry } from '../../src/types.js';

function entry(callSeq: number, prompt: string, value: unknown): JournalEntry {
  return { callSeq, key: { prompt, opts: {} }, value, aborted: false } as JournalEntry;
}

describe('UT-353: ResumePlan.invalidate() (DES-274)', () => {
  it('before invalidate(): a matching key replays its cached value', () => {
    const plan = ResumeCache.build([entry(1, 'decide:aaa', { answers: {} })], '');
    expect(plan.replay(1, { prompt: 'decide:aaa', opts: {} })).toEqual({ answers: {} });
  });

  it('invalidate() forces the NEXT replay() (any callSeq) to MISS, even with a matching key', () => {
    const plan = ResumeCache.build([entry(1, 'decide:aaa', { answers: {} }), entry(2, 'decide:bbb', { answers: {} })], '');
    plan.invalidate();
    expect(plan.replay(1, { prompt: 'decide:aaa', opts: {} })).toBe(MISS);
    expect(plan.replay(2, { prompt: 'decide:bbb', opts: {} })).toBe(MISS);
  });

  it('invalidate() called AFTER a successful replay still poisons every LATER callSeq', () => {
    const plan = ResumeCache.build([entry(1, 'decide:aaa', 'v1'), entry(2, 'decide:bbb', 'v2'), entry(3, 'decide:ccc', 'v3')], '');
    expect(plan.replay(1, { prompt: 'decide:aaa', opts: {} })).toBe('v1');
    plan.invalidate();
    expect(plan.replay(2, { prompt: 'decide:bbb', opts: {} })).toBe(MISS);
    expect(plan.replay(3, { prompt: 'decide:ccc', opts: {} })).toBe(MISS);
  });

  it('is idempotent — calling invalidate() twice has no further effect', () => {
    const plan = ResumeCache.build([entry(1, 'decide:aaa', 'v1')], '');
    plan.invalidate();
    plan.invalidate();
    expect(plan.replay(1, { prompt: 'decide:aaa', opts: {} })).toBe(MISS);
  });
});
