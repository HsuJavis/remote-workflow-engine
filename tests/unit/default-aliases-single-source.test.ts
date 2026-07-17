// R-1 regression (Gate 8 v2 review, quality-dimensions): DEFAULT_ALIASES had drifted across three
// modules (run-manager / main / submission-validator). They now all import the ONE table in
// src/default-aliases.ts. This pins that (a) the shared table is the real-Anthropic-ID version and
// (b) SubmissionValidator, with no injected aliases, resolves exactly those default keys — proving
// it validates against the same source the gateway routes through, not a stale private copy.
import { describe, it, expect } from 'vitest';
import { DEFAULT_ALIASES } from '../../src/default-aliases.js';
import { SubmissionValidator } from '../../src/submission-validator.js';

describe('DEFAULT_ALIASES single source (R-1)', () => {
  it('exposes the 4 documented anthropic default aliases with real model IDs (no stale placeholders)', () => {
    expect(Object.keys(DEFAULT_ALIASES).sort()).toEqual(['default', 'haiku', 'opus', 'sonnet']);
    for (const alias of Object.values(DEFAULT_ALIASES)) {
      expect(alias.provider).toBe('anthropic');
    }
    // The stale copy used bare `claude-sonnet`/`claude-haiku`/`claude-opus`; the canonical table
    // carries the pinned real IDs the gateway actually routes.
    expect(DEFAULT_ALIASES.sonnet.model).toBe('claude-3-5-sonnet-20241022');
    expect(DEFAULT_ALIASES.haiku.model).toBe('claude-3-5-haiku-20241022');
    expect(DEFAULT_ALIASES.opus.model).toBe('claude-opus-4-5');
    expect(DEFAULT_ALIASES.default.model).toBe('claude-3-5-sonnet-20241022');
  });

  it('SubmissionValidator (no injected aliases) accepts every default alias key', async () => {
    const v = new SubmissionValidator();
    for (const alias of Object.keys(DEFAULT_ALIASES)) {
      const result = await v.validate({ script: `return agent('t', {model:'${alias}'});` });
      expect(result.ok, `alias '${alias}' should resolve against the shared default table`).toBe(true);
    }
  });
});
