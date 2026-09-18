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

// [v28 Gate 5, DES-219, TASK-221, REQ-137/138] value anchors for the two new families the handoff
// README pins numerically (§4 Models, §5 System) — the class NAMES are Gate 5's proposed ones
// (`dashboard-classes.ts`'s own v28 note); Gate 6 may rename them as long as STYLE_HOOKS + this
// test travel together. `STYLE_HOOKS.length` already rose in the fixture edit above, so
// `.rule not found` is this section's own genuine red today (dashboard.css has none of these
// selectors yet), distinct from the pre-existing `.length >= 60` check above.
describe('value anchors — v28 Models/System families (DES-219, TASK-221, README §4/§5)', () => {
  it('.stat-card figure is 34px / weight 500 (README §5: "34 px / 500 figure")', () => {
    const body = ruleBody(CSS, '.stat-card');
    expect(body).toContain('font-size:34px');
    expect(body).toMatch(/font-weight:500\b/);
  });

  it('.stat-track is a 2px track; .stat-bar is a 4px accent bar (README §5)', () => {
    expect(ruleBody(CSS, '.stat-track')).toContain('height:2px');
    expect(ruleBody(CSS, '.stat-bar')).toContain('height:4px');
  });

  // [v28 Gate 6.5+7, verifier] closes the 9e10453 orchestrator ruling ("`.stat-bar` gets
  // `transform-origin:left`... without this the bar grows from its centre") that never reached
  // this file. Measured with a real Chromium page before this test existed: `left:0` alone (no
  // `right`/`width`) shrink-fits an EMPTY absolutely-positioned box to 0px regardless of
  // `transform-origin` — `right:0` (spanning the track) is equally load-bearing and not implied by
  // the ruling's own wording, so both are asserted here rather than the origin alone.
  it('.stat-bar spans its track (right:0) and scales from the left edge, not the centre', () => {
    const body = ruleBody(CSS, '.stat-bar');
    expect(body).toContain('right:0');
    expect(body).toMatch(/transform-origin:\s*left\b/);
  });

  it('.model-panel is 560px wide (README §4: "right slide-in panel (560 px)")', () => {
    expect(ruleBody(CSS, '.model-panel')).toContain('560px');
  });

  it('.bench-row is the benchmark grid 140px 1fr 48px (README §4)', () => {
    const body = ruleBody(CSS, '.bench-row');
    expect(body).toContain('140px 1fr 48px');
  });

  it('.models-table (reused, README §4: "min 960 px, horizontally scrollable") resolves at least 960px wide', () => {
    const body = ruleBody(CSS, '.models-table');
    const px = [...body.matchAll(/(\d+)px/g)].map((m) => Number(m[1]));
    expect(px.some((n) => n >= 960)).toBe(true);
  });
});

// ── v29 value anchors (REQ-146, REQ-147) ─────────────────────────────────────────────────────
// Authored from `.sdlc/design-handoff/README.md`, never read off the built CSS — DES-209's v28
// amendment, after three poisoned rows in one ledger year.
describe('v29 — the two rules the side-by-side audit measured wrong (REQ-146/147)', () => {
  it('.card .t is the HEADING face, not the mono one (README §1: title = workflow name, .card-title 17px)', () => {
    const body = ruleBody(CSS, '.card .t');
    // README reserves JetBrains Mono for ids, PIDs and tool calls; the workflow NAME is a title.
    expect(body).not.toMatch(/JetBrains Mono/);
    expect(body).toMatch(/font-family:\s*'Archivo'/);
    expect(body).toContain('font-size:17px');
    expect(body).toContain('font-weight:600');
  });

  it('.card .t drops word-break:break-all — it was there for the mono face and splits Archivo mid-word', () => {
    // `hypothesis-researcher` broke between glyphs at 13px mono; at 17px Archivo the same rule
    // would cut a real word in half. README gives the title `text-wrap: pretty`, not break-all.
    expect(ruleBody(CSS, '.card .t')).not.toContain('word-break:break-all');
  });

  it('[data-stat-card] is a CARD — README §3 gives the agent panel six bordered stat cards', () => {
    // The DOM was already right (`ui/agent-panel.js:59-70` emits the attribute and both spans);
    // this selector simply had NO rule, so label and value rendered as adjacent inline text
    // ("MODELhaiku — claude-agent-sdk · —") inside an otherwise-correct grid.
    const body = ruleBody(CSS, '[data-stat-card]');
    expect(body).toMatch(/border:\s*1px solid var\(--color-line\)/);
    expect(body).toContain('border-radius:var(--radius-md)');
    expect(body).toMatch(/padding:/);
  });

  it('.stat-label is a block, so the label sits ABOVE its value instead of against it', () => {
    expect(ruleBody(CSS, '.stat-label')).toContain('display:block');
  });

  it('the System page’s .stat-card is untouched — same word, different component', () => {
    // dashboard.css:345 is the System tab's 34px figure. It is NOT the agent panel's stat card and
    // must not be collateral damage of the rule above.
    const body = ruleBody(CSS, '.stat-card');
    expect(body).toContain('font-size:34px');
  });
});

// ── v29 ramp + ground anchors (REQ-144, REQ-145) ────────────────────────────────────────────
// Direction was already anchored (DES-201). These pin the VALUES, which DES-201 explicitly left
// to `.sdlc/design-handoff/README.md` via DES-209's owner_decision — answered at 7039586.
describe('v29 — the ramp and the ground come from the README, not from a one-hue snapshot', () => {
  const DARK_L = ['.3', '.37', '.45', '.55', '.65', '.72', '.8', '.87', '.93'];
  const DARK_C = ['.035', '.045', '.055', '.06', '.065', '.065', '.06', '.05', '.035'];
  const LIGHT_L = ['.93', '.87', '.79', '.68', '.56', '.48', '.4', '.33', '.26'];
  const LIGHT_C = ['.03', '.045', '.06', '.07', '.075', '.07', '.06', '.05', '.04'];
  const norm = (v: string) => v.replace(/^0(?=\.)/, '');

  function ramp(theme: string): Array<[string, string]> {
    const body = ruleBody(CSS, `:root[data-theme="${theme}"]`);
    return [100, 200, 300, 400, 500, 600, 700, 800, 900].map((n) => {
      const m = new RegExp(`--accent-${n}:\\s*oklch\\(([^ ]+) ([^ ]+) `).exec(body);
      if (!m) throw new Error(`--accent-${n} not found under ${theme}`);
      return [norm(m[1]!), norm(m[2]!)] as [string, string];
    });
  }

  it('the dark ramp is the README\u2019s L/C sequence (REQ-144)', () => {
    const r = ramp('dark');
    expect(r.map((x) => x[0])).toEqual(DARK_L);
    expect(r.map((x) => x[1])).toEqual(DARK_C);
  });

  it('the light ramp is the README\u2019s L/C sequence (REQ-144)', () => {
    const r = ramp('light');
    expect(r.map((x) => x[0])).toEqual(LIGHT_L);
    expect(r.map((x) => x[1])).toEqual(LIGHT_C);
  });

  it('bg / panel / line are formulas over --rwe-hue, never frozen hexes (REQ-145)', () => {
    for (const theme of ['dark', 'light']) {
      const body = ruleBody(CSS, `:root[data-theme="${theme}"]`);
      for (const tok of ['--color-bg', '--color-panel', '--color-panel2', '--color-line']) {
        const m = new RegExp(`${tok}:\\s*([^;]+);`).exec(body);
        expect(m, `${tok} missing under ${theme}`).toBeTruthy();
        expect(m![1]).toContain('var(--rwe-hue)');
        expect(m![1]).not.toMatch(/#[0-9a-fA-F]{3,6}/);
      }
    }
  });

  it('the stale "pending in-repo" note is gone — the decision was answered at 7039586 (REQ-144)', () => {
    // This ledger's most repeated defect is deleting a thing and leaving prose that still
    // describes it (REQ-105 / ADR-048).
    expect(CSS).not.toMatch(/still pending in-repo/);
  });
});
