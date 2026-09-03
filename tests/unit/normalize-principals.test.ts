// UT-143 (DES-141, v24): normalizePrincipals(raw) — validated role map with a typed boot refusal
// for an invalid role string. Written test-first (Gate 5, RED) — src/main.ts has no
// normalizePrincipals export yet.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — normalizePrincipals does not exist yet (v24 DES-141/TASK-146)
import { normalizePrincipals } from '../../src/main.js';

describe('normalizePrincipals (UT-143, DES-141)', () => {
  it('a well-formed map normalizes ok:true with each role preserved', () => {
    const result = normalizePrincipals({ 'alice@x.com': { role: 'admin' } });
    expect(result).toEqual({ ok: true, value: { 'alice@x.com': { role: 'admin' } } });
  });

  it('"*" is a legal principal key', () => {
    const result = normalizePrincipals({ '*': { role: 'user' } });
    expect(result.ok).toBe(true);
  });

  it('an invalid role string yields ok:false naming the key and the bad role (boot refusal, never a silent default)', () => {
    const result = normalizePrincipals({ 'bob@x.com': { role: 'admn' } });
    expect(result).toEqual({ ok: false, key: 'bob@x.com', role: 'admn' });
  });

  it('email-shaped keys are stored verbatim (exact equality, no normalization/lowercasing)', () => {
    const result = normalizePrincipals({ 'Alice@X.com': { role: 'user' } });
    expect(result.ok).toBe(true);
    expect(Object.keys((result as { value: Record<string, unknown> }).value)).toEqual(['Alice@X.com']);
  });
});
