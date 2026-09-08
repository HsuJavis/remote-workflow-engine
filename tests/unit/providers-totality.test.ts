// UT-179 (DES-172, ARCH-112, TASK-171, v26): `PROVIDER_CAPS` is total over `PROVIDERS` — every
// provider-keyed site answers for all three members without reaching a `never`/undefined arm.
// vitest never sees a `tsc` compile-time exhaustiveness failure (`npm test` is `vitest run`; `tsc
// --noEmit` is the separate `build` script), so this is the RUNTIME lock. Written test-first
// (Gate 5, RED): src/providers.ts does not exist yet — whole-file import failure.
// Mock policy (unit): pure, no I/O.
import { describe, it, expect } from 'vitest';
import { PROVIDERS, PROVIDER_CAPS } from '../../src/providers.js';

describe('PROVIDER_CAPS totality over PROVIDERS (UT-179, DES-172)', () => {
  it('every provider has a PROVIDER_CAPS row', () => {
    for (const p of PROVIDERS) {
      expect(PROVIDER_CAPS[p]).toBeDefined();
      expect(PROVIDER_CAPS[p].tools).toBe('all');
    }
  });

  it('Object.keys(PROVIDER_CAPS) is exactly PROVIDERS, no more no less', () => {
    expect(Object.keys(PROVIDER_CAPS).sort()).toEqual([...PROVIDERS].sort());
  });

  it('each row has a well-formed thinking policy value', () => {
    const allowed = new Set(['sdk-default', 'budget-when-declared', 'disabled']);
    for (const p of PROVIDERS) {
      expect(allowed.has(PROVIDER_CAPS[p].thinking)).toBe(true);
    }
  });
});
