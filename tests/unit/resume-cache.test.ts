// UT-004: Resume cache replay — longest-unchanged-prefix (DES-004)
import { describe, it, expect } from 'vitest';
import { ResumeCache, MISS } from '../../src/resume-cache.js';
import type { JournalEntry } from '../../src/types.js';
import { FixedClock } from '../../src/clock.js';

const CLOCK = new FixedClock(new Date('2020-01-01T00:00:00Z'));
const TS = CLOCK.isoNow();

const ENTRY = (callSeq: number, prompt: string, value: unknown): JournalEntry => ({
  callSeq,
  key: { prompt, opts: {} },
  value,
  ts: TS,
  scriptVersion: 'v1',
});

describe('ResumeCache', () => {
  it('returns cached value for matching (prompt, opts) key', () => {
    const entries: JournalEntry[] = [
      ENTRY(0, 'summarize A', 'result-A'),
      ENTRY(1, 'translate B', 'result-B'),
    ];
    const plan = ResumeCache.build(entries, 'unchanged-script');
    expect(plan.replay(0, { prompt: 'summarize A', opts: {} })).toBe('result-A');
    expect(plan.replay(1, { prompt: 'translate B', opts: {} })).toBe('result-B');
  });

  it('returns MISS for a changed prompt at the same callSeq', () => {
    const entries: JournalEntry[] = [ENTRY(0, 'original prompt', 'result-X')];
    const plan = ResumeCache.build(entries, 'changed-script');
    const result = plan.replay(0, { prompt: 'DIFFERENT prompt', opts: {} });
    expect(result).toBe(MISS);
  });

  it('returns MISS for all entries after the first changed one', () => {
    const entries: JournalEntry[] = [
      ENTRY(0, 'same', 'cached-0'),
      ENTRY(1, 'same-too', 'cached-1'),
    ];
    const plan = ResumeCache.build(entries, 'script');
    // seq 0 unchanged
    expect(plan.replay(0, { prompt: 'same', opts: {} })).toBe('cached-0');
    // seq 1 changed → MISS
    expect(plan.replay(1, { prompt: 'CHANGED', opts: {} })).toBe(MISS);
    // seq 2 (new call) → MISS regardless
    expect(plan.replay(2, { prompt: 'same-too', opts: {} })).toBe(MISS);
  });

  it('cachedThrough equals the last sequential matching callSeq', () => {
    const entries: JournalEntry[] = [ENTRY(0, 'p', 'v'), ENTRY(1, 'q', 'w')];
    const plan = ResumeCache.build(entries, 'unchanged');
    expect(plan.cachedThrough).toBe(1);
  });
});
