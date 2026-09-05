// UT-164 (v24 Gate 8 AF-3 / TASK-162, ARCH-087 + DES-137, adjudication (v24) #7 G-3): the closure
// of `ERROR_CATALOG` checked as a CLASS, not as the list of codes somebody remembered.
//
// The defect: `authz.ts` returns `PRINCIPAL_REQUIRED` (`authorize()`'s loopback-exempt refusal) and
// `call-tool.ts:136` copies `verdict.code` to the wire unremapped — the `?? 'FORBIDDEN_ROLE'`
// fallback only covers a verdict with NO code — yet the string was absent from `ERROR_CATALOG`.
// A code a client really receives, with no `see` pointer, in no generated documentation, and
// invisible to the existing closure tests.
//
// Why this file exists at all, given Gate 7.5 round 3 already fixed the identical defect for three
// trigger codes (D-14): that fix added the three keys. It did not add anything that would notice a
// FOURTH. `AuthzErrorCode` was a hand-typed union with no relationship to the catalog, so the two
// could drift silently and did. `src/authz.ts` now derives the union from `AUTHZ_ERROR_CODES`,
// which is `satisfies readonly ErrorCode[]` — a new member that is not a catalog key is a compile
// error at the declaration — and the array's enumerability is what lets the test below cover every
// member instead of a sample.
//
// THE OTHER DIRECTION is already locked elsewhere, and this file does not duplicate it:
// `tests/unit/tool-specs.test.ts` [C-6] asserts (a) every code a row has an error fixture for is
// declared in that row's own `errors[]` and (b) no row declares a code outside `ERROR_CATALOG`;
// the runtime half is `tests/acceptance/v24-tool-surface.test.ts`. Reported, not built here:
// DES-137 also specified "every catalog key is a member of `errors[]` u `INGRESS_CODES`" and that
// test does not exist in the tree.
//
// Mock policy: pure unit — `src/errors.ts` and the code array in `src/authz.ts` have no I/O.
import { describe, it, expect } from 'vitest';
import { ERROR_CATALOG, toErrorCode } from '../../src/errors.js';
import { AUTHZ_ERROR_CODES } from '../../src/authz.js';

describe('ERROR_CATALOG is closed over every code authz can put on the wire (UT-164, AF-3)', () => {
  it('EVERY member of AuthzErrorCode is a key of ERROR_CATALOG', () => {
    const orphans = (AUTHZ_ERROR_CODES as readonly string[]).filter((code) => !(code in ERROR_CATALOG));
    expect(orphans, 'an authz refusal code a client can receive is outside the closed catalog').toEqual([]);
  });

  it('PRINCIPAL_REQUIRED specifically — the code AF-3 found reaching the wire uncatalogued', () => {
    expect(Object.keys(ERROR_CATALOG)).toContain('PRINCIPAL_REQUIRED');
  });

  it('each one round-trips through toErrorCode() as itself, never degrading to INTERNAL_ERROR', () => {
    // The consumer-visible consequence of being absent: `toErrorCode` maps an unknown string to
    // INTERNAL_ERROR, so an uncatalogued authz code loses its identity the moment anything
    // normalizes it. This asserts the whole set, which is the point of the card.
    for (const code of AUTHZ_ERROR_CODES) {
      expect(toErrorCode(code), `${code} is not recognised as a catalog code`).toBe(code);
    }
  });

  it('every authz code carries the catalog\'s two fields, so it appears in generated documentation', () => {
    for (const code of AUTHZ_ERROR_CODES) {
      const row = (ERROR_CATALOG as Record<string, { see: unknown; hint: unknown }>)[code]!;
      expect(typeof row.hint).toBe('string');
      expect(row.see === 'workflow_authoring_guide' || row.see === null).toBe(true);
    }
  });
});
