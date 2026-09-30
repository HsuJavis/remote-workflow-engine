// v39 (owner decision 2026-09-30): `meta.phases` becomes REQUIRED on every NEW registration and
// must equal the script's own `phase()` call titles (same count/order; a non-literal title derives
// `null` and accepts any non-empty declared title at that position — mirrors `checkMermaid`'s
// `LANE_MISMATCH` rule, check-mermaid.ts:331). `checkMetaPhases(script, scriptTitles)` is the pure
// registration-time gate; `resolvePhases(script)` is the read-side helper that reads `meta.phases`
// back verbatim when it is validly declared, or derives it from the script's own `phase()` calls
// when it is absent/invalid (an EXISTING, immutable row registered before this rule existed).
//
// Mock policy (unit): pure functions, no I/O.
import { describe, it, expect } from 'vitest';
import { checkMetaPhases, resolvePhases } from '../../src/workflow-meta.js';

describe('checkMetaPhases — registration-time gate (v39)', () => {
  it('PHASES_REQUIRED: no meta at all, script has phase() calls', () => {
    const result = checkMetaPhases(`phase('a');\nreturn 1;`, ['a']);
    expect(result).toMatchObject({ ok: false, code: 'PHASES_REQUIRED' });
  });

  it('PHASES_REQUIRED: meta exists but declares no phases key', () => {
    const result = checkMetaPhases(`export const meta = { description: 'x' };\nphase('a');\nreturn 1;`, ['a']);
    expect(result).toMatchObject({ ok: false, code: 'PHASES_REQUIRED' });
  });

  it('PHASES_REQUIRED: meta.phases is not an array', () => {
    const result = checkMetaPhases(`export const meta = { phases: 'a' };\nphase('a');\nreturn 1;`, ['a']);
    expect(result).toMatchObject({ ok: false, code: 'PHASES_REQUIRED' });
  });

  it('PHASES_REQUIRED: meta.phases has an entry with no string title', () => {
    const result = checkMetaPhases(`export const meta = { phases: [{ title: 1 }] };\nphase('a');\nreturn 1;`, ['a']);
    expect(result).toMatchObject({ ok: false, code: 'PHASES_REQUIRED' });
  });

  it('PHASES_REQUIRED: an empty string title is not a valid declared title, even at a dynamic (null) position — mirrors checkMermaid\'s own SUBGRAPH_TITLE refusal of an empty title', () => {
    const result = checkMetaPhases(`export const meta = { phases: [{ title: '' }] };\nphase('tier:' + args.tier);\nreturn 1;`, [null]);
    expect(result).toMatchObject({ ok: false, code: 'PHASES_REQUIRED' });
  });

  it('passes: a script with no phase() calls must declare phases: [] explicitly', () => {
    const result = checkMetaPhases(`export const meta = { phases: [] };\nreturn 1;`, []);
    expect(result).toEqual({ ok: true });
  });

  it('PHASES_REQUIRED (not MISMATCH): a script with no phase() calls and no declared phases key at all', () => {
    const result = checkMetaPhases(`return 1;`, []);
    expect(result).toMatchObject({ ok: false, code: 'PHASES_REQUIRED' });
  });

  it('PHASES_MISMATCH: declared count differs from the script\'s phase() call count', () => {
    const script = `export const meta = { phases: [{ title: 'a' }] };\nphase('a');\nphase('b');\nreturn 1;`;
    const result = checkMetaPhases(script, ['a', 'b']);
    expect(result.ok).toBe(false);
    expect((result as { code?: string }).code).toBe('PHASES_MISMATCH');
    expect((result as { message?: string }).message).toContain('a');
    expect((result as { message?: string }).message).toContain('b');
  });

  it('PHASES_MISMATCH: same count, wrong order/title', () => {
    const script = `export const meta = { phases: [{ title: 'b' }, { title: 'a' }] };\nphase('a');\nphase('b');\nreturn 1;`;
    const result = checkMetaPhases(script, ['a', 'b']);
    expect(result).toMatchObject({ ok: false, code: 'PHASES_MISMATCH' });
  });

  it('passes: declared exactly matches script phase() calls in count/order/title', () => {
    const script = `export const meta = { phases: [{ title: 'a' }, { title: 'b' }] };\nphase('a');\nphase('b');\nreturn 1;`;
    const result = checkMetaPhases(script, ['a', 'b']);
    expect(result).toEqual({ ok: true });
  });

  it('a non-literal (dynamic) script phase title — null — accepts ANY non-empty declared title at that position', () => {
    const script = `export const meta = { phases: [{ title: 'whatever-the-author-wrote' }] };\nphase('tier:' + args.tier);\nreturn 1;`;
    const result = checkMetaPhases(script, [null]);
    expect(result).toEqual({ ok: true });
  });

  it('dynamic position still enforces COUNT — declaring two phases for one dynamic call is a mismatch', () => {
    const script = `export const meta = { phases: [{ title: 'x' }, { title: 'y' }] };\nphase('tier:' + args.tier);\nreturn 1;`;
    const result = checkMetaPhases(script, [null]);
    expect(result).toMatchObject({ ok: false, code: 'PHASES_MISMATCH' });
  });
});

describe('resolvePhases — read-side derivation for existing (immutable) rows (v39)', () => {
  it('declared: a valid meta.phases is read back verbatim, source "declared"', () => {
    const script = `export const meta = { phases: [{ title: 'Draft' }, { title: 'Verify' }] };\nphase('Draft');\nphase('Verify');\nreturn 1;`;
    expect(resolvePhases(script)).toEqual({
      phases: [{ title: 'Draft' }, { title: 'Verify' }],
      phasesSource: 'declared',
    });
  });

  it('derived: no meta.phases at all — derives from the script\'s own phase() calls, source "derived"', () => {
    const script = `phase('Draft');\nphase('Verify');\nreturn 1;`;
    const result = resolvePhases(script);
    expect(result.phasesSource).toBe('derived');
    expect(result.phases.map((p) => p.title)).toEqual(['Draft', 'Verify']);
  });

  it('derived: no phase() calls at all and nothing declared — derives to an empty array', () => {
    expect(resolvePhases(`return 1;`)).toEqual({ phases: [], phasesSource: 'derived' });
  });

  it('derived: a dynamic (non-literal) phase() title gets a placeholder string, never null/undefined', () => {
    const script = `phase('tier:' + args.tier);\nreturn 1;`;
    const result = resolvePhases(script);
    expect(result.phasesSource).toBe('derived');
    expect(result.phases).toHaveLength(1);
    expect(typeof result.phases[0]!.title).toBe('string');
    expect(result.phases[0]!.title.length).toBeGreaterThan(0);
  });

  it('declared, mismatched with the script (a legacy row this new rule never re-checks): still read back verbatim', () => {
    // The stored row predates v39 — its declared meta.phases may disagree with its own phase()
    // calls. `resolvePhases` is a pure read of what is stored; it is not a registration gate and
    // must never silently correct or discard a validly-shaped declaration.
    const script = `export const meta = { phases: [{ title: 'Old' }] };\nphase('New');\nreturn 1;`;
    expect(resolvePhases(script)).toEqual({ phases: [{ title: 'Old' }], phasesSource: 'declared' });
  });
});
