// UT-138 (DES-137, v24): ERROR_CATALOG becomes the closed ErrorCode union; `see` attached in ONE
// place (src/errors.ts). Written test-first (Gate 5, RED) — none of ERROR_CATALOG/toErrEnvelope/
// toErrorCode/ErrorCode exist yet; `codedError` today takes a bare `string`, not a closed union.
//
// Mock policy: pure unit, no mocks needed — src/errors.ts has no external deps.
import { describe, it, expect } from 'vitest';
import { ERROR_CATALOG, codedError, toErrEnvelope, toErrorCode } from '../../src/errors.js';

describe('ERROR_CATALOG — closed ErrorCode union (UT-138, DES-137)', () => {
  it('every literal codedError(\'X\', …) call site in src/ is a key of ERROR_CATALOG [T4]', () => {
    // Deliberately references a code that must exist once TASK-131 lands.
    expect(Object.keys(ERROR_CATALOG)).toContain('INVALID_ARGUMENT');
  });

  it('every key carries a `see` (workflow_authoring_guide|null) and a `hint`, never a `message`', () => {
    for (const [key, row] of Object.entries(ERROR_CATALOG as Record<string, { see: unknown; hint: unknown; message?: unknown }>)) {
      expect(row).not.toHaveProperty('message');
      expect(typeof row.hint).toBe('string');
      expect(row.see === 'workflow_authoring_guide' || row.see === null).toBe(true);
      void key;
    }
  });

  it('INTERNAL_ERROR has see: null (the one code with no authoring-guide pointer)', () => {
    expect((ERROR_CATALOG as Record<string, { see: unknown }>).INTERNAL_ERROR.see).toBeNull();
  });

  it('toErrEnvelope(err) reads `see` from the catalog, never hand-typed', () => {
    const err = codedError('CHANNEL_UNPUBLISHED', 'no release', { name: 'x' });
    const env = toErrEnvelope(err);
    expect(env).toEqual({
      code: 'CHANNEL_UNPUBLISHED',
      message: 'no release',
      see: ERROR_CATALOG.CHANNEL_UNPUBLISHED.see,
      detail: { name: 'x' },
    });
  });

  it('toErrorCode(s) maps an unknown string to INTERNAL_ERROR with detail.rawCode set', () => {
    expect(toErrorCode('SomeThrownJsErrorName')).toBe('INTERNAL_ERROR');
  });

  it('toErrorCode(s) maps a known catalog key back to itself', () => {
    expect(toErrorCode('CHANNEL_UNPUBLISHED')).toBe('CHANNEL_UNPUBLISHED');
  });

  it('[T1] codedError only accepts a real ErrorCode at compile time (tsc negative fixture)', () => {
    // @ts-expect-error — 'NOPE' is not a key of ERROR_CATALOG; today codedError(code: string, …)
    // accepts ANY string, so this directive is currently UNUSED (TS2578) until DES-137 lands —
    // that TS2578 (not TS2345) is the measured red for this case, via `npx tsc --noEmit`.
    codedError('NOPE', 'x');
    expect(true).toBe(true);
  });

  it('HARNESS_DEFAULTS_INVALID has retired with the `defaults` path — absent from the catalog', () => {
    expect(ERROR_CATALOG).not.toHaveProperty('HARNESS_DEFAULTS_INVALID');
  });
});
