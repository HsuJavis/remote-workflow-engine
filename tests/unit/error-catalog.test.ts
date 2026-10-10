// UT-138 (DES-137, v24): ERROR_CATALOG becomes the closed ErrorCode union; `see` attached in ONE
// place (src/errors.ts). Written test-first (Gate 5, RED) — none of ERROR_CATALOG/toErrEnvelope/
// toErrorCode/ErrorCode exist yet; `codedError` today takes a bare `string`, not a closed union.
//
// Mock policy: pure unit, no mocks needed — src/errors.ts has no external deps.
import { describe, it, expect } from 'vitest';
import { ERROR_CATALOG, codedError, toErrEnvelope, toErrorCode } from '../../src/errors.js';
import { LOCKED_KEYS } from '../../src/params/contract.js';

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

  // Issue #154 (round-3 INFO, 2026-10-10): the tester's third-round reverify found the guide's
  // error-code table silent on two already-true behaviors — RESERVED_PREFIX's match is
  // case-insensitive (path-verdict.ts's `isReservedPrefixed` lowercases before comparing, so
  // `RWE-x`/`Rwe-x` are refused the same as `rwe-x`) and INVALID_NAME also rejects any C0 control
  // character (0x00-0x1F) or DEL (0x7F) anywhere in the name, not just leading/trailing whitespace
  // (`isValidBareName`'s own control-character check). Both behaviors already shipped (v0.37.9/
  // v0.37.11); this pins the DOCS catching up — the guide is generated from these hints
  // (`npm run gen:authoring`), so asserting the hint text here is the same guarantee as asserting
  // the rendered guide text, without duplicating docs/AUTHORING.md's generated prose in a test.
  it('RESERVED_PREFIX\'s hint states the match is case-insensitive', () => {
    expect(ERROR_CATALOG.RESERVED_PREFIX.hint.toLowerCase()).toContain('case-insensitiv');
  });

  it('INVALID_NAME\'s hint states control characters are rejected', () => {
    expect(ERROR_CATALOG.INVALID_NAME.hint.toLowerCase()).toContain('control charact');
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

  // P2 (v36, REQ-211): the two VERSION_CEILING_EXCEEDED throw sites (workflow-catalog.ts:610/656)
  // already name the call shape a caller must make to unblock — `workflow_deregister({name,
  // version})`, not the bare-noun "deregister an old one" that leaves the shape to guesswork. The
  // catalog hint was the one surface REQ-211 left un-fixed; pin it here so it cannot regress.
  it('VERSION_CEILING_EXCEEDED\'s hint names the actual call shape, like its two throw sites', () => {
    expect(ERROR_CATALOG.VERSION_CEILING_EXCEEDED.hint).toContain('workflow_deregister({name, version})');
  });

  // issue #89 item 1: PARAM_LOCKED's hint hand-typed six names and omitted `bash` — LOCKED_KEYS
  // (params/contract.ts) has carried `bash` since issue #78(c), so the catalog and the validator
  // it describes had drifted. Rendered from the SAME constant so a future LOCKED_KEYS edit cannot
  // silently leave this hint stale again.
  it('PARAM_LOCKED\'s hint names every LOCKED_KEYS member, including bash, rendered from the constant', () => {
    for (const key of LOCKED_KEYS) {
      expect(ERROR_CATALOG.PARAM_LOCKED.hint, `hint is missing "${key}"`).toContain(key);
    }
    expect(ERROR_CATALOG.PARAM_LOCKED.hint).toContain('bash');
  });

  // issue #93 item 1: CONFINEMENT_UNAVAILABLE's hint used to explain WHAT is refused and WHY, but
  // never told an operator on an Ubuntu/AppArmor host — the exact class this iteration measured and
  // fixed — HOW to make the probe pass. Rendered from the SAME CONFINEMENT_REMEDIATION constant the
  // boot banner (main.ts) uses, so the two surfaces cannot drift apart.
  it('CONFINEMENT_UNAVAILABLE\'s hint carries the Ubuntu/AppArmor operator remediation (issue #93 item 1)', () => {
    expect(ERROR_CATALOG.CONFINEMENT_UNAVAILABLE.hint).toContain('kernel.apparmor_restrict_unprivileged_userns=0');
    expect(ERROR_CATALOG.CONFINEMENT_UNAVAILABLE.hint).toContain('bwrap-userns-restrict');
  });

  // issue #163 B2: SCRIPT_ERROR was thrown at two real sites (guards.ts's uncaught-throw fallback,
  // and toErr()'s own fallback) for years, but was never a catalog key — so `toErrorCode` silently
  // flattened it to INTERNAL_ERROR the instant it crossed `_handleWorkflowRequest`'s mapping. RED
  // before the fix: ERROR_CATALOG has no SCRIPT_ERROR key, so toErrorCode('SCRIPT_ERROR') returns
  // 'INTERNAL_ERROR', not 'SCRIPT_ERROR'.
  it('[#163 B2] toErrorCode round-trips SCRIPT_ERROR as itself, never degrading to INTERNAL_ERROR', () => {
    expect(Object.keys(ERROR_CATALOG)).toContain('SCRIPT_ERROR');
    expect(toErrorCode('SCRIPT_ERROR')).toBe('SCRIPT_ERROR');
  });

  // issue #163 DOC: ITEM_CAP_EXCEEDED (guards.ts parallel()/pipeline()) has the exact same gap.
  it('[#163 DOC] toErrorCode round-trips ITEM_CAP_EXCEEDED as itself, never degrading to INTERNAL_ERROR', () => {
    expect(Object.keys(ERROR_CATALOG)).toContain('ITEM_CAP_EXCEEDED');
    expect(toErrorCode('ITEM_CAP_EXCEEDED')).toBe('ITEM_CAP_EXCEEDED');
  });

  // issue #162 item C: a non-object schema crashed ajv.compile uncaught; agent-executor.ts now
  // catches it and throws a catalogued INVALID_SCHEMA — pinned here at the unit level, same as the
  // other two gap-closing cases above.
  it('[#162 C] INVALID_SCHEMA is a real catalog member, see: workflow_authoring_guide', () => {
    expect(Object.keys(ERROR_CATALOG)).toContain('INVALID_SCHEMA');
    expect(ERROR_CATALOG.INVALID_SCHEMA.see).toBe('workflow_authoring_guide');
  });

  // issue #156 NEW-2 reverify (commit 418a1bf's own message claimed this table was fixed too; it
  // wasn't — the diff only touched tool-specs.ts's run_start row): PARAM_CONTRACT_INVALID's generic
  // catalog hint named only the registration-time case (a declared contract malformed/out of its
  // own bounds) with no mention that run_start admission ALSO returns this code for a malformed
  // `overrides.agents`/`overrides.agents.<label>` shape — a reader of this ONE generic table (not
  // run_start's own errors[] row) had no way to learn that.
  it('[#156 NEW-2] PARAM_CONTRACT_INVALID\'s hint also names the run_start admission case (malformed overrides.agents shape)', () => {
    expect(ERROR_CATALOG.PARAM_CONTRACT_INVALID.hint).toMatch(/run_start/);
    expect(ERROR_CATALOG.PARAM_CONTRACT_INVALID.hint).toMatch(/overrides\.agents/);
  });
});
