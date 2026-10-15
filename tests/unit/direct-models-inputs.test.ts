// UT-341 (DES-266, ARCH-187/183, TASK-262): the pure input layer `src/direct-models/inputs.ts` —
// `validateDecideInput`, `validateImageInput`, `normalizeOutDir`, `canonicalJson`,
// `primitiveCallKey`, `checkAnswers`. No fs/network — pure functions, real inputs.
//
// Scope note (Karpathy: representative, not combinatorial): DES-266's boundary table has ~15 rows
// per validator; this file pins the SHAPE of every rule family (cap, closed-key-set, per-question-
// type criteria, path escape) with one or two cases each, plus the three cross-cutting invariants
// TASK-262's dod calls out by name (sentinel-free messages, outDir equivalence, canonicalJson key-
// order independence). Further per-row cases accrete at Gate 6.5/7 if a boundary proves under-
// covered; this is not the full combinatorial closure of the table.
//
// Red reason: `src/direct-models/inputs.ts` does not exist yet — module-not-found.
import { describe, it, expect } from 'vitest';
import {
  validateDecideInput, validateImageInput, normalizeOutDir, canonicalJson, primitiveCallKey, checkAnswers,
  MAX_DECIDE_QUESTIONS, MAX_DECIDE_STATE_BYTES, MAX_IMAGE_PROMPT_BYTES, MAX_INPUT_IMAGES, MAX_OUTDIR_BYTES,
} from '../../src/direct-models/inputs.js';

const SENTINEL = 'sentinel-7f3a9c';

describe('UT-341: validateDecideInput (DES-266)', () => {
  it('accepts a well-formed bool/choice/score question set and returns state+questions verbatim', () => {
    const { state, questions } = validateDecideInput('gate', {
      state: { order: 'pending' },
      questions: {
        order: { type: 'bool', instructions: 'is it ready', criteria: { true: 'yes', false: 'no' } },
        pick: { type: 'choice', instructions: 'which', criteria: { a: 'A', b: 'B' } },
        rate: { type: 'score', instructions: 'how good', criteria: ['1', '2', '3'] },
      },
    });
    expect(state).toEqual({ order: 'pending' });
    expect(Object.keys(questions)).toEqual(['order', 'pick', 'rate']);
  });

  it('rejects an unknown top-level opts key', () => {
    expect(() => validateDecideInput('gate', { state: {}, questions: {}, extra: 1 })).toThrow(/PRIMITIVE_INPUT_INVALID/);
  });

  it('rejects state over MAX_DECIDE_STATE_BYTES', () => {
    const big = 'x'.repeat(MAX_DECIDE_STATE_BYTES + 1);
    expect(() => validateDecideInput('gate', { state: { big }, questions: { q: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } }))
      .toThrow(/PRIMITIVE_INPUT_INVALID/);
  });

  it('rejects more than MAX_DECIDE_QUESTIONS questions', () => {
    const questions: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_DECIDE_QUESTIONS; i++) questions[`q${i}`] = { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } };
    expect(() => validateDecideInput('gate', { state: {}, questions })).toThrow(/PRIMITIVE_INPUT_INVALID/);
  });

  it('rejects a bool question whose criteria is not exactly {true,false}', () => {
    expect(() => validateDecideInput('gate', { state: {}, questions: { q: { type: 'bool', instructions: 'i', criteria: { true: 't' } } } }))
      .toThrow(/PRIMITIVE_INPUT_INVALID/);
  });

  it('rejects a choice question with fewer than 2 criteria entries', () => {
    expect(() => validateDecideInput('gate', { state: {}, questions: { q: { type: 'choice', instructions: 'i', criteria: { a: 'A' } } } }))
      .toThrow(/PRIMITIVE_INPUT_INVALID/);
  });

  it('rejects a question id that does not match the identifier format', () => {
    expect(() => validateDecideInput('gate', { state: {}, questions: { '1bad': { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } }))
      .toThrow(/PRIMITIVE_INPUT_INVALID/);
  });

  it('a sentinel placed in a state VALUE never appears in the PRIMITIVE_INPUT_INVALID message (field path is structural only)', () => {
    try {
      validateDecideInput('gate', { state: { a: SENTINEL }, questions: {}, bogus: 1 });
      throw new Error('expected a throw');
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(SENTINEL);
    }
  });

  it('a sentinel placed in a state KEY never appears in the PRIMITIVE_INPUT_INVALID message', () => {
    try {
      validateDecideInput('gate', { state: { [SENTINEL]: 'oversized-trigger', pad: 'x'.repeat(MAX_DECIDE_STATE_BYTES) }, questions: {} });
      throw new Error('expected a throw');
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(SENTINEL);
    }
  });
});

describe('UT-341: validateImageInput (DES-266)', () => {
  it('accepts a minimal prompt-only call; inputImages defaults to []; outDir stays undefined', () => {
    const { prompt, inputImages, outDir } = validateImageInput('hero', { prompt: 'a red dog' });
    expect(prompt).toBe('a red dog');
    expect(inputImages).toEqual([]);
    expect(outDir).toBeUndefined();
  });

  it('rejects an empty prompt', () => {
    expect(() => validateImageInput('hero', { prompt: '' })).toThrow(/PRIMITIVE_INPUT_INVALID/);
  });

  it('rejects a prompt over MAX_IMAGE_PROMPT_BYTES', () => {
    expect(() => validateImageInput('hero', { prompt: 'x'.repeat(MAX_IMAGE_PROMPT_BYTES + 1) })).toThrow(/PRIMITIVE_INPUT_INVALID/);
  });

  it('rejects more than MAX_INPUT_IMAGES entries', () => {
    const inputImages = Array.from({ length: MAX_INPUT_IMAGES + 1 }, (_, i) => `ref/${i}.png`);
    expect(() => validateImageInput('hero', { prompt: 'p', inputImages })).toThrow(/PRIMITIVE_INPUT_INVALID/);
  });

  it('rejects an empty-string outDir', () => {
    expect(() => validateImageInput('hero', { prompt: 'p', outDir: '' })).toThrow(/PRIMITIVE_INPUT_INVALID/);
  });

  it('rejects an outDir over MAX_OUTDIR_BYTES', () => {
    expect(() => validateImageInput('hero', { prompt: 'p', outDir: 'x'.repeat(MAX_OUTDIR_BYTES + 1) })).toThrow(/PRIMITIVE_INPUT_INVALID/);
  });

  it.each(['/abs/path', '../escape', 'a/../b', '.hidden/x'])('rejects an outDir that escapes the workspace: %s', (outDir) => {
    expect(() => validateImageInput('hero', { prompt: 'p', outDir })).toThrow(/IMAGE_PATH_REFUSED/);
  });

  it('"." normalizes to the workspace root', () => {
    const { outDir } = validateImageInput('hero', { prompt: 'p', outDir: '.' });
    expect(outDir).toBe('.');
  });
});

describe('UT-341: normalizeOutDir equivalence (DES-266, TASK-262 dod)', () => {
  it('"out/ig", "out/ig/", and "./out/ig" all normalize to the same key', () => {
    const a = normalizeOutDir('out/ig');
    const b = normalizeOutDir('out/ig/');
    const c = normalizeOutDir('./out/ig');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('undefined stays undefined (no default substitution at this pure layer)', () => {
    expect(normalizeOutDir(undefined)).toBeUndefined();
  });
});

describe('UT-341: canonicalJson (DES-266, TASK-262 dod: key-order independence)', () => {
  it('two objects with the same keys in different order canonicalize identically', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('is recursive over nested objects', () => {
    expect(canonicalJson({ x: { d: 1, c: 2 } })).toBe(canonicalJson({ x: { c: 2, d: 1 } }));
  });

  it('produces no whitespace', () => {
    expect(canonicalJson({ a: 1 })).not.toMatch(/\s/);
  });
});

describe('UT-341: primitiveCallKey (DES-266)', () => {
  it('decide: key.opts carries {label, model}; key.prompt is a decide:<sha256hex> string', () => {
    const key = primitiveCallKey('decide', 'gate', 'openrouter/typesafe/jev-1.13', { state: {}, questions: {} });
    expect(key.opts).toEqual({ label: 'gate', model: 'openrouter/typesafe/jev-1.13' });
    expect(key.prompt).toMatch(/^decide:[0-9a-f]{64}$/);
  });

  it('image: outDir normalization happens BEFORE hashing — equivalent outDir forms produce the same key', () => {
    const inputs = { prompt: 'p', inputImages: [], outDir: null as string | null };
    const k1 = primitiveCallKey('image', 'hero', 'm', { ...inputs, outDir: 'out/ig' });
    const k2 = primitiveCallKey('image', 'hero', 'm', { ...inputs, outDir: 'out/ig/' });
    expect(k1.prompt).toBe(k2.prompt);
  });

  it('decide and image keys for the same label/model/inputs never collide (kind-prefixed)', () => {
    const decideKey = primitiveCallKey('decide', 'x', 'm', { same: 1 });
    const imageKey = primitiveCallKey('image', 'x', 'm', { same: 1 });
    expect(decideKey.prompt).not.toBe(imageKey.prompt);
    expect(decideKey.prompt.startsWith('decide:')).toBe(true);
    expect(imageKey.prompt.startsWith('image:')).toBe(true);
  });
});

describe('UT-341: checkAnswers (DES-266)', () => {
  const questions = {
    ok: { type: 'bool' as const, instructions: 'i', criteria: { true: 't', false: 'f' } },
    pick: { type: 'choice' as const, instructions: 'i', criteria: { a: 'A', b: 'B' } },
  };

  it('accepts a complete, in-range answer set', () => {
    expect(checkAnswers(questions, {
      ok: { type: 'bool', probability: 0.7 },
      pick: { type: 'choice', choice: 'a', probabilities: { a: 0.9, b: 0.1 }, confidence: 0.9 },
    })).toBe(true);
  });

  it('rejects a missing asked id', () => {
    expect(checkAnswers(questions, { ok: { type: 'bool', probability: 0.5 } })).toBe(false);
  });

  it('rejects a choice outside the declared criteria', () => {
    expect(checkAnswers(questions, {
      ok: { type: 'bool', probability: 0.5 },
      pick: { type: 'choice', choice: 'z', probabilities: { a: 0.5, b: 0.5 }, confidence: 0.5 },
    })).toBe(false);
  });

  it('rejects a bool probability outside [0,1]', () => {
    expect(checkAnswers(questions, {
      ok: { type: 'bool', probability: 1.5 },
      pick: { type: 'choice', choice: 'a', probabilities: { a: 1, b: 0 }, confidence: 1 },
    })).toBe(false);
  });
});
