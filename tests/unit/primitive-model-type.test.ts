// UT-347 (DES-270, ARCH-189, ADR-095, TASK-267): `checkPrimitiveModelType` (pure, src/providers.ts)
// + `reachableModels` covering `decisions[*]`/`images[*]`. The full truth table from DES-270's
// boundary: catalog-unavailable warn, row-undefined (unknown-model path) unchanged, unknown/
// id-heuristic warn, mismatch refuse, ok.
//
// Red reason: `checkPrimitiveModelType` does not exist (`src/providers.ts` exports no such symbol)
// — module import fails to resolve the name; `reachableModels` does not yet read
// `decisions[*]`/`images[*]`.
import { describe, it, expect } from 'vitest';
import { checkPrimitiveModelType } from '../../src/providers.js';
import { reachableModels } from '../../src/models/model-book.js';
// v40 Gate 6 ruling R-23: the retired FLUX 1.1 Pro id is replaced by the guide's single image constant.
import { EXAMPLE_IMAGE_MODEL } from '../../src/authoring-guide.js';
// (the image-gen truth-table row above uses the live image-ONLY flux-3-image id, matching its modelType.)

describe('UT-347: checkPrimitiveModelType truth table (DES-270)', () => {
  it('ok: known row, type matches required', () => {
    const r = checkPrimitiveModelType('decision', 'gate', 'openrouter/typesafe/jev-1.13', { modelType: 'decision', modelTypeSource: 'openrouter-modalities' }, true);
    expect(r).toEqual({ ok: true });
  });

  it('mismatch: known row, type does not match required -> refuses naming label/model/actual/required', () => {
    const r = checkPrimitiveModelType('decision', 'gate', 'openrouter/some/embedding-model', { modelType: 'embedding', modelTypeSource: 'openrouter-modalities' }, true);
    expect(r).toMatchObject({ ok: false, code: 'MODEL_TYPE_MISMATCH', label: 'gate', model: 'openrouter/some/embedding-model', actual: 'embedding', required: 'decision' });
  });

  it('unknown modelType -> ok with a MODEL_TYPE_UNVERIFIED warning', () => {
    const r = checkPrimitiveModelType('image', 'hero', 'openrouter/some/mystery', { modelType: 'unknown', modelTypeSource: 'unknown' }, true);
    expect(r.ok).toBe(true);
    expect((r as { warning?: { code: string } }).warning?.code).toBe('MODEL_TYPE_UNVERIFIED');
  });

  it('id-heuristic source -> ok with a MODEL_TYPE_UNVERIFIED warning (even if the type happens to match)', () => {
    const r = checkPrimitiveModelType('decision', 'gate', 'openrouter/typesafe/jev-1.13', { modelType: 'decision', modelTypeSource: 'id-heuristic' }, true);
    expect(r.ok).toBe(true);
    expect((r as { warning?: { code: string } }).warning?.code).toBe('MODEL_TYPE_UNVERIFIED');
  });

  it('catalog unavailable -> existing warning arm, never refuses', () => {
    const r = checkPrimitiveModelType('agent', 'x', 'openrouter/anything', undefined, false);
    expect(r.ok).toBe(true);
  });

  it('row undefined (unknown model, catalog available) -> existing unknown-model path, never refuses here', () => {
    const r = checkPrimitiveModelType('agent', 'x', 'openrouter/does-not-exist', undefined, true);
    expect(r.ok).toBe(true);
  });

  it('agent() requires "chat"; a decision-typed model refuses it', () => {
    const r = checkPrimitiveModelType('agent', 'x', 'openrouter/typesafe/jev-1.13', { modelType: 'decision', modelTypeSource: 'openrouter-modalities' }, true);
    expect(r).toMatchObject({ ok: false, code: 'MODEL_TYPE_MISMATCH', required: 'chat' });
  });

  it('generateImage() requires "image-gen"', () => {
    const r = checkPrimitiveModelType('image', 'hero', 'openrouter/black-forest-labs/flux-3-image', { modelType: 'image-gen', modelTypeSource: 'openrouter-modalities' }, true);
    expect(r).toEqual({ ok: true });
  });
});

describe('UT-347: reachableModels covers decisions[*]/images[*] (DES-270)', () => {
  it('includes declared defaults for decisions and images blocks', () => {
    const models = reachableModels({
      model: 'openrouter/anthropic/claude-sonnet-5',
      decisions: { gate: { model: 'openrouter/typesafe/jev-1.13', timeoutMs: 5000, retries: 2 } },
      images: { hero: { model: EXAMPLE_IMAGE_MODEL, timeoutMs: 120000, retries: 0 } },
    } as never);
    expect(models).toContain('openrouter/typesafe/jev-1.13');
    expect(models).toContain(EXAMPLE_IMAGE_MODEL);
  });

  it('includes a run-level override of a decisions/images model, not just the declared default', () => {
    const models = reachableModels({
      model: 'openrouter/anthropic/claude-sonnet-5',
      decisions: { gate: { model: 'openrouter/typesafe/jev-override', timeoutMs: 5000, retries: 2 } },
    } as never);
    expect(models).toContain('openrouter/typesafe/jev-override');
  });
});

// UT-361 (DES-270 v40 Gate 6 delta, owner decision OD-1, ADR-095, TASK-267): `images.<label>`
// accepts any row whose catalog OUTPUT modalities include `image`, whatever its `modelType` — the
// row passed to the gate gains `modalitiesOut` (carried on the ModelCatalogSnapshot entry).
// `decisions` stays strictly `decision`; `agents` stays "not a known non-chat type".
// Red reason: the image rule is still `modelType === 'image-gen'`, so a gemini-style `chat` row with
// output ['text','image'] is refused MODEL_TYPE_MISMATCH today.
describe('UT-361: OD-1 — images accept any image-output row (DES-270 delta)', () => {
  const GEMINI = { modelType: 'chat' as const, modelTypeSource: 'openrouter-modalities' as const, modalitiesOut: ['text', 'image'] };
  const EMBED = { modelType: 'embedding' as const, modelTypeSource: 'openrouter-modalities' as const, modalitiesOut: ['embeddings'] };

  it('image: a chat row whose output includes image is ok (no warning)', () => {
    expect(checkPrimitiveModelType('image', 'hero', 'openrouter/google/gemini-2.5-flash-image', GEMINI as never, true)).toEqual({ ok: true });
  });

  it('image: an embedding row is refused MODEL_TYPE_MISMATCH naming label/model/actual', () => {
    expect(checkPrimitiveModelType('image', 'hero', 'openrouter/acme/embed-1', EMBED as never, true))
      .toMatchObject({ ok: false, code: 'MODEL_TYPE_MISMATCH', label: 'hero', model: 'openrouter/acme/embed-1', actual: 'embedding' });
  });

  it('decision stays strict: the same image-capable chat row is refused for decisions', () => {
    expect(checkPrimitiveModelType('decision', 'gate', 'openrouter/google/gemini-2.5-flash-image', GEMINI as never, true))
      .toMatchObject({ ok: false, code: 'MODEL_TYPE_MISMATCH', required: 'decision' });
  });

  it('agent: the image-capable chat row is fine for agent() (chat is not a non-chat type)', () => {
    expect(checkPrimitiveModelType('agent', 'x', 'openrouter/google/gemini-2.5-flash-image', GEMINI as never, true)).toEqual({ ok: true });
  });
});
