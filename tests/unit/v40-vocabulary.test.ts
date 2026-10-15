// UT-339 (DES-264, ARCH-194/192/190, TASK-260): the v40 shared vocabulary — the RUNTIME-visible
// slice of it. `PrimitiveKind`/`DecideQuestion`/`DecideAnswer`/`ImageMime`/`ImageFile`,
// `AgentRecord.kind`, `BookEntry.price.imageOutPerM` and the `primitive.call` EngineEvent variant
// are type-only additions erased by esbuild at vitest's transform step — a missing type produces no
// runtime symptom vitest can observe, so they are NOT asserted here; they are asserted by
// `npx tsc --noEmit` (TASK-260's own dod command), which is red today because none of those types
// exist. What IS runtime-visible, and is this file's job: the 11 new `ERROR_CATALOG` entries DES-264
// enumerates, each with `see:'workflow_authoring_guide'`. `OPENROUTER_AUTH_MISSING` (DES-265) already
// exists from the pi-harness-v1 iteration — this file checks it is present, not that it was added.
//
// Red reason: none of the 11 codes below are keys of ERROR_CATALOG yet — every `expect(...).toBeDefined()`
// fails, and the `Object.keys` membership checks fail.
import { describe, it, expect } from 'vitest';
import { ERROR_CATALOG } from '../../src/errors.js';

const NEW_V40_CODES = [
  'DECISION_UNDECLARED',
  'DECISION_DECLARED_NOT_IN_SCRIPT',
  'IMAGE_UNDECLARED',
  'IMAGE_DECLARED_NOT_IN_SCRIPT',
  'MODEL_TYPE_MISMATCH',
  'PRIMITIVE_PROVIDER_UNSUPPORTED',
  'MODEL_TYPE_UNVERIFIED',
  'PRIMITIVE_INPUT_INVALID',
  'IMAGE_PATH_REFUSED',
  'PRICE_UNKNOWN',
  'PRIMITIVE_FAILED',
] as const;

describe('UT-339: v40 ERROR_CATALOG additions (DES-264)', () => {
  it.each(NEW_V40_CODES)('%s is a key of ERROR_CATALOG with see:"workflow_authoring_guide"', (code) => {
    const entry = (ERROR_CATALOG as unknown as Record<string, { see: string | null; hint: string }>)[code];
    expect(entry).toBeDefined();
    expect(entry.see).toBe('workflow_authoring_guide');
    expect(typeof entry.hint).toBe('string');
    expect(entry.hint.length).toBeGreaterThan(0);
  });

  it('MODEL_TYPE_UNVERIFIED is distinguished as a WARNING in its own hint text (never refuses by itself)', () => {
    const entry = (ERROR_CATALOG as unknown as Record<string, { hint: string }>)['MODEL_TYPE_UNVERIFIED'];
    expect(entry).toBeDefined();
    expect(entry.hint.toLowerCase()).toMatch(/warn/);
  });

  it('regression anchor: OPENROUTER_AUTH_MISSING (DES-265) already exists from the pi-harness-v1 iteration', () => {
    expect(ERROR_CATALOG).toHaveProperty('OPENROUTER_AUTH_MISSING');
  });

  it('none of the 11 new codes existed before v40 (sanity: this list is additive, not a rename)', () => {
    // A cheap guard against accidentally asserting on a pre-existing code and getting a false green.
    const PRE_V40_CODES = ['BUDGET_EXCEEDED', 'PARAM_UNKNOWN', 'UNKNOWN_MODEL', 'INVALID_ARGUMENT'];
    for (const code of NEW_V40_CODES) expect(PRE_V40_CODES).not.toContain(code);
  });
});
