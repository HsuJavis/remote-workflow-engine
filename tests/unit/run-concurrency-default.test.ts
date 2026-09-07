// UT-171 (v25, DES-168, REQ-120, issue #61): the per-run fan-out cap is an EXPLICIT number, not a
// function of the host's CPU count.
//
// Why this exists: the owner's 3-wide `parallel()` ran 2 branches. The reservation arithmetic was
// the direct cause (removed — see run-guard.ts), but the ceiling underneath it was
// `Math.max(1, Math.min(16, cpus().length - 2))` — 14 on that host, and invisible to the author,
// the guide and the operator alike. How wide a workflow may fan out has nothing to do with how many
// cores the box has, so the default is now a stated 24 that `rwe.config.json` can change.
// Mock policy: pure unit — a constant and a constructor argument, no I/O.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RunManager, DEFAULT_RUN_CONCURRENCY } from '../../src/run-manager.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../src/run-manager.ts');

describe('per-run concurrency is an explicit, configurable cap (UT-171, DES-168)', () => {
  it('the default is 24', () => {
    expect(DEFAULT_RUN_CONCURRENCY).toBe(24);
  });

  it('it is not derived from the host CPU count — no cpus() call survives in run-manager.ts', () => {
    // A value oracle alone cannot catch a re-introduction (`min(24, cores)` would still be 24 on a
    // big box and silently smaller on the owner's), so the source is checked for the derivation
    // itself. Same technique as UT-161's front-end-mermaid grep guard.
    const src = readFileSync(SRC, 'utf-8');
    const uses = src.split('\n').filter((l) => /\bcpus\s*\(/.test(l) && !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'));
    expect(uses, 'the per-run fan-out ceiling must not be a function of the machine').toEqual([]);
  });

  it('an operator-supplied value is accepted, and an invalid one is refused at construction', () => {
    expect(() => new RunManager({ concurrency: 40 })).not.toThrow();
    expect(() => new RunManager({ concurrency: 0 })).toThrow(/runConcurrency must be a positive integer/);
    expect(() => new RunManager({ concurrency: -1 })).toThrow(/runConcurrency must be a positive integer/);
    expect(() => new RunManager({ concurrency: 2.5 })).toThrow(/runConcurrency must be a positive integer/);
  });
});
