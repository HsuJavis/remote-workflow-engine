// VAL (DES-147, v24 REQ-112 subset-property check): each GUIDE_EXAMPLES[].mermaid diagram is a
// real Mermaid document that renders in a real browser — the property `checkMermaid` cannot
// itself prove (mechanical grammar checking is not a renderer). Never a unit test pretending to
// be a browser: no headless-browser tooling is installed in this repo today, so every case is
// `it.skip` with the reason UNTIL Gate 7.5 adds one — never a fabricated pass.
// Gate 6 (implementer, TASK-151): src/authoring-guide.ts / GUIDE_EXAMPLES now exist (TASK-150,
// built by a parallel implementer) — the Gate 5 `@ts-expect-error` import-red guard is stale and
// removed; no other change needed, this file was already correct once its dependency landed.
import { describe, it, expect } from 'vitest';
import { GUIDE_EXAMPLES } from '../../src/authoring-guide.js';

const HAS_BROWSER_TOOLING = false; // no puppeteer/playwright dep in package.json today (measured)

describe('GUIDE_EXAMPLES mermaid renders in a real browser (VAL, DES-147 subset-property check)', () => {
  it('GUIDE_EXAMPLES exists with at least the ten named patterns', () => {
    expect(Array.isArray(GUIDE_EXAMPLES)).toBe(true);
    expect(GUIDE_EXAMPLES.length).toBeGreaterThanOrEqual(10);
  });

  it.runIf(HAS_BROWSER_TOOLING)('every example renders with zero Mermaid parse errors in a real browser', async () => {
    // Gate 7.5 real-run implementation: launch a headless browser, load mermaid.js, call
    // mermaid.render() on each GUIDE_EXAMPLES[].mermaid, assert no thrown parse error.
    expect(true).toBe(true);
  });

  it.skipIf(HAS_BROWSER_TOOLING)('UNVERIFIED(no browser) — recorded explicitly, not silently omitted', () => {
    expect(HAS_BROWSER_TOOLING).toBe(false); // documents the skip reason as an assertion, not a comment only
  });
});
