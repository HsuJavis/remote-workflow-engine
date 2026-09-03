// UT-127 (v23 Gate 2 re-run, send-back `d294880`, A5 ≡ adversarial P4 ≡ QD-R1): the diagram
// vocabulary glyph list (`◇ ⟲ ─ │ ┬ ┴ ├ ┤ ▶ ╭ ╮ ╰ ╯`) has exactly ONE declaration in `src/`
// (`diagram-gate.ts`'s ordered glyph array — the gate itself, ARCH-080) and every OTHER site that
// tells a model or a human about the vocabulary is built by INTERPOLATION from it, never a
// hand-typed transcription. Verified today (direct read): the array is a module-PRIVATE const, not
// exported, so it structurally cannot have a second consumer — `server.ts`'s shipped default
// `graphAnalyzer.systemPrompt` (DEFAULT_GRAPH_ANALYZER_SYSTEM_PROMPT) re-types all 13 glyphs as
// prose (`server.ts:308,310-312`), and `rwe.config.example.json:59` re-types them a third time.
// Either copy silently rotting out of sync with the gate's own vocabulary is exactly the class of
// bug this test exists to catch — asserted here as vocabulary MEMBERSHIP (the architecture's own
// chosen, cheaper oracle; a stronger "was it interpolated, not transcribed" structural check is
// explicitly NOT what this amendment asks for).
//
// Naming choice (not pinned by 02-architecture.md, decided here so Gate 6 inherits it rather than
// re-deriving it): the ordered glyph array is exported as `VOCAB_GLYPHS` from `diagram-gate.ts`
// (the identifier the private const already uses); the shipped default prompt is exported as
// `DEFAULT_GRAPH_ANALYZER_SYSTEM_PROMPT` from `server.ts` (the identifier the private const already
// uses there too) so both existing names travel unchanged, only their visibility changes.
//
// Red reason (measured): neither export exists today -> vitest's esbuild-transformed import
// resolves the missing named export to `undefined`, and `for (const glyph of VOCAB_GLYPHS)` throws
// `TypeError: VOCAB_GLYPHS is not iterable` in both cases — confirmed by
// `npx vitest run tests/unit/diagram-vocabulary-consistency.test.ts` (2/2 fail, this error).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VOCAB_GLYPHS } from '../../src/diagram-gate.js';
import { DEFAULT_GRAPH_ANALYZER_SYSTEM_PROMPT } from '../../src/server.js';

describe('the diagram vocabulary has one canonical source, consumed by membership everywhere (UT-127, ARCH-080, A5)', () => {
  it('every glyph in the canonical VOCAB_GLYPHS list appears in the shipped default graphAnalyzer.systemPrompt', () => {
    for (const glyph of VOCAB_GLYPHS as string[]) {
      expect(DEFAULT_GRAPH_ANALYZER_SYSTEM_PROMPT as string).toContain(glyph);
    }
  });

  it('every glyph in the canonical VOCAB_GLYPHS list appears in rwe.config.example.json\'s graphAnalyzer.systemPrompt (a file read, ARCH-085\'s own named rot risk)', () => {
    const configPath = join(process.cwd(), 'rwe.config.example.json');
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { graphAnalyzer: { systemPrompt: string } };
    for (const glyph of VOCAB_GLYPHS as string[]) {
      expect(parsed.graphAnalyzer.systemPrompt).toContain(glyph);
    }
  });
});
