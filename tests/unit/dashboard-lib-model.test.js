// UT-257 (DES-206, TASK-210, REQ-134): `lib/model.js` — `shortModel(model)`, the swimlane row-2
// formatter. Written here (Gate 6, per the orchestrator's explicit correction in state.yaml — a
// prior implementer flagged this as a Gate-5 gap and was told the oracle is Gate 6's job this
// pass) rather than left as an untested implementation. Spec (dispatch, mirroring the design
// handoff's own `D.shortModel`): strip a leading `openrouter/`, strip a leading `anthropic/`, fold
// a trailing `:free` into ` (free)`.
//
// Tier: unit, `.js`, pure.
//
// Red reason (measured): `src/dashboard/lib/model.js` does not exist (whole-file import failure).
import { describe, it, expect } from 'vitest';
import { shortModel } from '../../src/dashboard/lib/model.js';

describe('lib/model.js: shortModel (UT-257, REQ-134 row 2)', () => {
  it('strips a leading "openrouter/"', () => {
    expect(shortModel('openrouter/qwen/qwen2.5-7b')).toBe('qwen/qwen2.5-7b');
  });

  it('strips a leading "anthropic/"', () => {
    expect(shortModel('anthropic/claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet-20241022');
  });

  it('strips BOTH prefixes when chained ("openrouter/anthropic/...")', () => {
    expect(shortModel('openrouter/anthropic/claude-3.5-sonnet')).toBe('claude-3.5-sonnet');
  });

  it('folds a trailing ":free" into " (free)"', () => {
    expect(shortModel('openrouter/nex-agi/nex-n2-pro:free')).toBe('nex-agi/nex-n2-pro (free)');
  });

  it('a plain model id with no prefix/suffix passes through unchanged', () => {
    expect(shortModel('sonnet')).toBe('sonnet');
  });

  it('absent/empty input passes through rather than throwing', () => {
    expect(shortModel(undefined)).toBe(undefined);
    expect(shortModel('')).toBe('');
  });
});
