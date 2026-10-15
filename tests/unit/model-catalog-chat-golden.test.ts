// UT-345 (DES-269, ARCH-190, TASK-265): Mode C — a CHARACTERIZATION test, not test-first RED. It
// locks in what today's (pre-v40) `model-catalog.ts` parser produces for every row whose output
// modalities include 'text', over a fixture that already contains the v40 rows (jev-1.13 decision,
// a FLUX-style image-only row, and gemini-2.5-flash-image) — so TASK-266's upcoming change to the
// SAME parser has a committed "before" to diff against (DES-269's boundary: "golden must stay
// deep-equal" after the change). Per the verifier contract's Mode C: write it, confirm GREEN, commit
// the fixture + golden BEFORE TASK-266 starts.
//
// status: green (Mode C characterization, not RED) — this is the one item in this ledger entry that
// is not test-first-red by design; see `05-tests.md`'s v40 section note.
// Commit-hash note: the fixture + golden are intended to be committed at THIS Gate-5 WIP commit,
// before any TASK-266 code change — see the next `git log --oneline -1` after this file lands.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCatalog, type ModelEntry } from '../../src/models/model-catalog.js';

const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'models', 'openrouter-models-all.json');
const GOLDEN_PATH = join(__dirname, '..', 'fixtures', 'models', 'chat-rows-golden.json');

describe('UT-345: chat-rows golden (Mode C characterization, DES-269)', () => {
  it('today\'s parser output for every row whose outputs include "text" is deep-equal to the committed golden', async () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const golden: ModelEntry[] = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
    const fakeFetch = (async () => new Response(JSON.stringify(fixture), { status: 200 })) as typeof fetch;
    const entries = await buildCatalog({
      includeStatic: false,
      openrouterFetch: fakeFetch,
      ollamaFetch: (async () => { throw new Error('no ollama in this fixture run'); }) as typeof fetch,
    });
    const chatRows = entries.filter((e) => Array.isArray(e.modalities?.out) && e.modalities.out.includes('text'));
    expect(chatRows).toEqual(golden);
  });

  it('the fixture itself contains the three rows TASK-265/266 require (sanity on the fixture, not the parser)', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { data: { id: string }[] };
    const ids = fixture.data.map((d) => d.id);
    expect(ids).toContain('typesafe/jev-1.13');
    expect(ids).toContain('black-forest-labs/flux-1.1-pro');
    expect(ids).toContain('google/gemini-2.5-flash-image');
  });
});
