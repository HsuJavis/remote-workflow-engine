// v27c (DES-209, TASK-214, ADR-053): the class lock — TASK-214's OWN green (the two halves that
// depend only on the stylesheet and the declared list; the emitter-dependent half lives in
// `dashboard-no-design-values.test.ts` and is the slice's own final green, re-run once every view
// task lands). Mock policy (unit, per-tier v27): pure static analysis over `dashboard.css`'s own
// bytes — no I/O beyond reading this repo's own files, no DOM, no jsdom (a `border-radius` computed
// value needs a real layout engine this tier does not have; the bytes-level regex below is what
// `dashboard-class-contract` can actually assert without one — the real-tier `getComputedStyle`
// oracle is `SPEC_ROWS`/val-198..202, a different tier entirely).
//
// Red reason (the pre-v27c file, read at this task's Gate 6, 2026-09-12): `dashboard.css` was still
// the 126-line pre-v27c port — zero matches for the `rweGlow|rweRing|rweSweep|rweSlideIn|rweFadeIn|
// rwePulse` family, no `.cell`/`.lane-head`/`.agent-panel`/etc, and the accent ramp descended under
// BOTH themes (DES-201's defect) — every assertion below would have failed against that file.
import { describe, it, expect } from 'vitest';
import { clientFile } from '../helpers/client-corpus.js';
import { STYLE_HOOKS } from '../fixtures/dashboard-classes.js';

const CSS = clientFile('dashboard.css');

/** Strip `/* ... *\/` comments — the ONLY thing standing between a bare regex and a false positive
 *  from a class name mentioned in prose (the file banner names several deleted classes). */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every class token that appears in a SELECTOR position (never inside a declaration body or an
 *  at-rule prelude). `/([^{}]+)\{/g` yields, for every `{` in the text, the run of non-brace text
 *  immediately before it — a keyframe's nested `0%`/`50%`/`100%` selectors and a font-face's
 *  declaration body (where a `url(....woff2)` lives) never produce a chunk that could contain a
 *  stray class-shaped token, because neither sits immediately before an opening brace. */
function extractClassTokens(css: string): Set<string> {
  const text = stripComments(css);
  const tokens = new Set<string>();
  for (const chunkMatch of text.matchAll(/([^{}]+)\{/g)) {
    const chunk = chunkMatch[1] ?? '';
    for (const tokenMatch of chunk.matchAll(/\.[a-zA-Z_][\w-]*/g)) {
      tokens.add(tokenMatch[0].slice(1));
    }
  }
  return tokens;
}

/** One selector's declaration body, matched by EXACT selector-chunk equality (never a literal
 *  `selector{` substring search): `.cell` must be its own whole comma-separated chunk, not merely
 *  a substring of a longer one — `.cell{` is also a literal substring of `.cell-layer .cell{`, so a
 *  bare string/regex search would silently return the WRONG rule's body (measured: it did, until
 *  this was written this way). No nested braces exist inside any of the rule bodies this helper is
 *  used against (keyframes are the only nested construct in this file and no lookup below targets
 *  one), so a non-greedy `[^{}]*` body capture per chunk is a complete, correct match. */
function ruleBody(css: string, selector: string): string {
  // Comments MUST be stripped first — a `/* ... */` block sits inside the same brace-free run as
  // its following selector (no braces of its own), so an un-stripped scan folds the comment's prose
  // into the "selector chunk" and an exact-equality match against `.cards` never fires (measured).
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const chunk = (m[1] ?? '').trim();
    if (chunk.split(',').map((s) => s.trim()).includes(selector)) return m[2] ?? '';
  }
  throw new Error(`rule not found: ${selector}{...} (as its own selector chunk)`);
}

describe('the class lock (STYLE_HOOKS, DES-209)', () => {
  it('STYLE_HOOKS.length >= 60', () => {
    expect(STYLE_HOOKS.length).toBeGreaterThanOrEqual(60);
  });

  it('every STYLE_HOOKS entry appears as a selector in dashboard.css', () => {
    const found = extractClassTokens(CSS);
    const missing = STYLE_HOOKS.filter((hook) => !found.has(hook));
    expect(missing).toEqual([]);
  });

  it('every class selector dashboard.css defines is in STYLE_HOOKS (the anti-rot half — deleting a surface deletes its CSS)', () => {
    const found = extractClassTokens(CSS);
    const hookSet = new Set(STYLE_HOOKS);
    const extra = [...found].filter((cls) => !hookSet.has(cls)).sort();
    expect(extra).toEqual([]);
  });

  it('the dead ported rules whose emitters retired with the inline script are gone (.pill .st-* .grp .node .phase .ph-lbl #tree)', () => {
    const found = extractClassTokens(CSS);
    for (const dead of ['pill', 'st-queued', 'st-running', 'grp', 'grp-h', 'node', 'phase', 'ph-lbl']) {
      expect(found.has(dead)).toBe(false);
    }
    expect(CSS).not.toMatch(/#tree\{/);
  });
});

describe('value anchors — anti-vacuity (DES-209, 60 empty rules must not pass)', () => {
  it('all seven @keyframes are present by name', () => {
    for (const name of ['rwePulse', 'rweSweep', 'rweGlow', 'rweRing', 'rweSlideIn', 'rweSlideInL', 'rweFadeIn']) {
      expect(CSS).toContain(`@keyframes ${name}`);
    }
  });

  it('.cell is 216px / 74px, radius 3px', () => {
    const body = ruleBody(CSS, '.cell');
    expect(body).toContain('width:216px');
    expect(body).toContain('height:74px');
    expect(body).toContain('border-radius:3px');
  });

  it('.cell.is-failed carries oklch(0.55 0.16 25)', () => {
    expect(ruleBody(CSS, '.cell.is-failed')).toContain('oklch(0.55 0.16 25)');
  });

  it('.cell.is-queued carries opacity:.65 and a dashed border', () => {
    const body = ruleBody(CSS, '.cell.is-queued');
    expect(body).toContain('opacity:.65');
    expect(body).toContain('border-style:dashed');
  });

  it('.lane-head is 13px / 600 / letter-spacing:.04em / uppercase', () => {
    const body = ruleBody(CSS, '.lane-head');
    expect(body).toContain('font-size:13px');
    expect(body).toContain('font-weight:600');
    expect(body).toContain('letter-spacing:.04em');
    expect(body).toContain('text-transform:uppercase');
  });

  // REQ-132's own acceptance numbers land on `.cards` — the actual per-section auto-fill grid in
  // the landed `home.js` (measured: `.card-grid` is the outer vertical section stack `home.js`
  // nests `.cards` INSIDE) — not on `.card-grid` itself, which DES-209's prose names generically.
  it('.cards (REQ-132\'s auto-fill grid) is minmax(280px,1fr) with a 16px gap', () => {
    const body = ruleBody(CSS, '.cards');
    expect(body).toContain('minmax(280px,1fr)');
    expect(body).toContain('gap:16px');
  });

  it('.agent-panel resolves wide enough for three REQ-135 stat columns (>= 500px, derived from REQ-135\'s own numbers)', () => {
    const body = ruleBody(CSS, '.agent-panel');
    const widthDecl = /width:([^;]+);/.exec(body);
    expect(widthDecl).not.toBeNull();
    const pxValues = [...(widthDecl![1] ?? '').matchAll(/(\d+)px/g)].map((m) => Number(m[1]));
    expect(pxValues.length).toBeGreaterThan(0);
    expect(Math.max(...pxValues)).toBeGreaterThanOrEqual(500);
  });

  function themeRampL(theme: 'dark' | 'light'): number[] {
    const re = new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`);
    const block = re.exec(CSS);
    if (!block) throw new Error(`theme block not found: ${theme}`);
    const body = block[1] ?? '';
    const ls: number[] = [];
    for (let i = 100; i <= 900; i += 100) {
      const m = new RegExp(`--accent-${i}:\\s*oklch\\(([\\d.]+)\\s`).exec(body);
      if (!m) throw new Error(`--accent-${i} not found in ${theme} block`);
      ls.push(Number(m[1]));
    }
    return ls;
  }

  it('the dark accent ramp L values ASCEND 100->900 (DES-201\'s corrected direction)', () => {
    const ls = themeRampL('dark');
    for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeGreaterThan(ls[i - 1]!);
  });

  it('the light accent ramp L values DESCEND 100->900', () => {
    const ls = themeRampL('light');
    for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeLessThan(ls[i - 1]!);
  });
});
