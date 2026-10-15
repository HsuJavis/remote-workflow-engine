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
    const r = checkPrimitiveModelType('image', 'hero', 'openrouter/black-forest-labs/flux-1.1-pro', { modelType: 'image-gen', modelTypeSource: 'openrouter-modalities' }, true);
    expect(r).toEqual({ ok: true });
  });
});

describe('UT-347: reachableModels covers decisions[*]/images[*] (DES-270)', () => {
  it('includes declared defaults for decisions and images blocks', () => {
    const models = reachableModels({
      model: 'openrouter/anthropic/claude-sonnet-5',
      decisions: { gate: { model: 'openrouter/typesafe/jev-1.13', timeoutMs: 5000, retries: 2 } },
      images: { hero: { model: 'openrouter/black-forest-labs/flux-1.1-pro', timeoutMs: 120000, retries: 0 } },
    } as never);
    expect(models).toContain('openrouter/typesafe/jev-1.13');
    expect(models).toContain('openrouter/black-forest-labs/flux-1.1-pro');
  });

  it('includes a run-level override of a decisions/images model, not just the declared default', () => {
    const models = reachableModels({
      model: 'openrouter/anthropic/claude-sonnet-5',
      decisions: { gate: { model: 'openrouter/typesafe/jev-override', timeoutMs: 5000, retries: 2 } },
    } as never);
    expect(models).toContain('openrouter/typesafe/jev-override');
  });
});
