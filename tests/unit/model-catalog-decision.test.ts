// UT-346 (DES-269, ARCH-190, TASK-266): catalog additions over TASK-265's SAME fixture —
// `?output_modalities=all` on the fetch URL, `ModelType` += 'decision', `imageOutPerM` from
// `pricing.image_output`, `models_list`/`models_query` filtering by `modelType:'decision'`.
//
// Red reason: `openRouterModelType` has no 'decisions' branch yet (jev-1.13 comes back
// modelType:'unknown'/'id-heuristic', not 'decision'); `imageOutPerM` does not exist on `ModelEntry`
// (never set); the fetch URL carries no query string yet.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCatalog, filterCatalog, type ModelEntry } from '../../src/models/model-catalog.js';

const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'models', 'openrouter-models-all.json');

async function buildFromFixture(): Promise<{ entries: ModelEntry[]; calledUrl: string }> {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  let calledUrl = '';
  const fakeFetch = (async (url: string | URL) => {
    calledUrl = String(url);
    return new Response(JSON.stringify(fixture), { status: 200 });
  }) as typeof fetch;
  const entries = await buildCatalog({
    includeStatic: false, openrouterFetch: fakeFetch,
    ollamaFetch: (async () => { throw new Error('no ollama in this fixture run'); }) as typeof fetch,
  });
  return { entries, calledUrl };
}

describe('UT-346: catalog decision type + imageOutPerM (DES-269)', () => {
  it('fetches with ?output_modalities=all', async () => {
    const { calledUrl } = await buildFromFixture();
    expect(calledUrl).toContain('output_modalities=all');
  });

  it('typesafe/jev-1.13 is modelType:"decision", modelTypeSource:"openrouter-modalities"', async () => {
    const { entries } = await buildFromFixture();
    const jev = entries.find((e) => e.model === 'typesafe/jev-1.13');
    expect(jev).toBeDefined();
    expect(jev?.modelType as unknown as string).toBe('decision');
    expect(jev?.modelTypeSource).toBe('openrouter-modalities');
  });

  it('the FLUX image-only row stays modelType:"image-gen" (unchanged)', async () => {
    const { entries } = await buildFromFixture();
    const flux = entries.find((e) => e.model === 'black-forest-labs/flux-3-image'); // R-23: live image-only row replaced the retired FLUX 1.1 Pro row
    expect(flux?.modelType).toBe('image-gen');
  });

  it('gemini-2.5-flash-image gets imageOutPerM from pricing.image_output (×1e6), stays modelType:"chat"', async () => {
    const { entries } = await buildFromFixture();
    const gemini = entries.find((e) => e.model === 'google/gemini-2.5-flash-image');
    expect(gemini?.modelType).toBe('chat');
    // v40 Gate 6 delta (DES-279, R-4): TOP-LEVEL `ModelEntry.imageOutPerM`, never inside the display `price`.
    expect((gemini as unknown as { imageOutPerM?: number }).imageOutPerM).toBeCloseTo(30, 5);
    expect((gemini as unknown as { price: Record<string, unknown> }).price).not.toHaveProperty('imageOutPerM');
  });

  it('a row with no pricing.image_output never gets imageOutPerM (absent, never 0)', async () => {
    const { entries } = await buildFromFixture();
    const sonnet = entries.find((e) => e.model === 'anthropic/claude-sonnet-5');
    expect((sonnet as unknown as { price: { imageOutPerM?: number } }).price).not.toHaveProperty('imageOutPerM');
    expect(sonnet).not.toHaveProperty('imageOutPerM');
  });

  it('models_query/filterCatalog({modelType:"decision"}) returns only decision rows', async () => {
    const { entries } = await buildFromFixture();
    const decisions = filterCatalog(entries, { modelType: 'decision' } as never);
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every((e) => (e.modelType as unknown as string) === 'decision')).toBe(true);
  });

  it('TASK-265\'s chat-rows golden is unaffected by this change (still deep-equal)', async () => {
    const { entries } = await buildFromFixture();
    const golden: ModelEntry[] = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'models', 'chat-rows-golden.json'), 'utf8'));
    const chatRows = entries.filter((e) => Array.isArray(e.modalities?.out) && e.modalities.out.includes('text'));
    // v40 Gate 6 delta (DES-269/DES-279): same rule as UT-345 — only the additive top-level
    // `imageOutPerM` key is stripped; every pre-existing key/value must still be deep-equal.
    const withoutAdditive = chatRows.map((e) => {
      const { imageOutPerM: _additive, ...rest } = e as typeof e & { imageOutPerM?: number };
      return rest;
    });
    expect(withoutAdditive).toEqual(golden);
  });
});
