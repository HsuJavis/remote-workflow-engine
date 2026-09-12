// v27c (DES-209, DES-208, TASK-214, ADR-053): the slice's TWO deferred halves. Per TASK-214's own
// card: "the whole of dashboard-no-design-values.test.ts is the SLICE's final green, not this
// task's — it stays RED until TASK-212 lands and is re-run as its last check." TASK-214 writes this
// file and confirms it is red for the GENUINE unimplemented reason (the swimlane substrate migration
// is TASK-210's own deferred item; three TEST_ANCHORS names are declared but not yet emitted by the
// landed home.js/workflow.js — see the failure detail each `it` reports below), never fudged green
// and never left as an untested stub.
//
// Mock policy (unit, DES-208/209): pure static analysis over `clientCorpus()` (every
// src/dashboard/{lib,ui}/*.js concatenated) and `DASHBOARD_HTML` — no DOM, no server boot, same
// convention as `dashboard-no-external-host.test.ts`'s own `stripComments` (a hex/oklch/rgba/cssText
// literal mentioned in a comment is not a design value IN EFFECT — this guard follows the same
// precedent rather than inventing a second convention for the same problem).
//
// Red reason (measured against the tree at this task's Gate 6, 2026-09-12): `run.js` still builds
// the swimlane via `setAttribute('fill'|'stroke'|...)` with inline hex/oklch literals (its own file
// banner names this "DEFERRED... TASK-214... has not landed on this tree yet" — now landed, but the
// migration itself is TASK-210's, not TASK-214's, per DES-209 boundary (6): TASK-214 "edits no
// src/dashboard/{ui,lib}/*.js"). `home.js` sets no `data-section`; `workflow.js` sets
// `data-run-chips` (plural, on the CONTAINER) rather than `data-run-chip` (singular, per chip) and
// no `data-history-table` anywhere — both measured gaps, reported to the orchestrator for TASK-
// 208/209's owners rather than patched here.
import { describe, it, expect } from 'vitest';
import { clientCorpus } from '../helpers/client-corpus.js';
import { DASHBOARD_HTML } from '../../src/dashboard-page.js';
import { STYLE_HOOKS, TEST_ANCHORS } from '../fixtures/dashboard-classes.js';

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A class/attribute NAME is "set" if it occurs as a whole token — a hyphen counts as part of the
 *  token (CSS class-name convention), so `card` does not falsely match inside `card-grid`. */
function wholeTokenPresent(haystack: string, name: string): boolean {
  return new RegExp(`(^|[^\\w-])${escapeRegExp(name)}($|[^\\w-])`).test(haystack);
}

describe('the emitter half of the class lock — STYLE_HOOKS/TEST_ANCHORS actually set (DES-209)', () => {
  it('every STYLE_HOOKS entry is set by clientCorpus() or DASHBOARD_HTML', () => {
    const corpus = clientCorpus() + '\n' + DASHBOARD_HTML;
    const missing = STYLE_HOOKS.filter((hook) => !wholeTokenPresent(corpus, hook));
    expect(missing).toEqual([]);
  });

  it('every TEST_ANCHORS entry is emitted', () => {
    const corpus = clientCorpus() + '\n' + DASHBOARD_HTML;
    const missing = TEST_ANCHORS.filter((anchor) => {
      if (anchor.startsWith('#')) {
        const id = anchor.slice(1);
        return !(corpus.includes(`id="${id}"`) || corpus.includes(`id='${id}'`) || corpus.includes(`.id = '${id}'`));
      }
      if (anchor.startsWith('.')) {
        return !wholeTokenPresent(corpus, anchor.slice(1));
      }
      // a `data-*` attribute — either the literal HTML/setAttribute form, or the DOM `dataset`
      // camelCase form (`data-lane-header` -> `dataset.laneHeader`). A whole-token boundary check
      // is required here, not a bare substring one: `data-run-chip` is a substring of the
      // CONTAINER attribute `data-run-chips` (plural, `workflow.js`) without actually being it —
      // a bare `.includes()` would report the singular per-chip anchor as emitted when it is not.
      const camel = anchor
        .replace(/^data-/, '')
        .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      return !(wholeTokenPresent(corpus, anchor) || wholeTokenPresent(corpus, `dataset.${camel}`));
    });
    expect(missing).toEqual([]);
  });
});

describe('no design values in JS (DES-208/209) — colours, sizes and font facts are a class, not a client literal', () => {
  const corpus = stripComments(clientCorpus());

  it('zero hex colour literals', () => {
    expect(corpus.match(/#[0-9a-fA-F]{3,6}\b/g) ?? []).toEqual([]);
  });

  it('zero oklch()/rgba() literals', () => {
    expect(corpus.includes('oklch(')).toBe(false);
    expect(corpus.includes('rgba(')).toBe(false);
  });

  it('zero cssText assignments', () => {
    expect(corpus.includes('cssText')).toBe(false);
  });

  it("zero setAttribute('fill'|'stroke'|'stroke-width'|'stroke-dasharray'|'font-size'|'font-weight'|'opacity'|'style')", () => {
    const re = /setAttribute\(\s*['"](fill|stroke|stroke-width|stroke-dasharray|font-size|font-weight|opacity|style)['"]/g;
    expect(corpus.match(re) ?? []).toEqual([]);
  });

  it('every `.style.<prop>` write is display/transform/setProperty(\'--rwe-hue\'), or carries the // rwe-allow-style: svgBox marker', () => {
    // Positive anchor beside the negatives (DES-208's anti-vacuity rule): `.style.transform` MUST
    // be present (`ui/run.js`'s zoom/pan transform, D6/INV-V27-6) — a corpus with none at all would
    // make every assertion below pass vacuously.
    expect(clientCorpus()).toContain('style.transform');

    // Raw corpus, NOT the module-level `stripComments`-ed `corpus`: the `// rwe-allow-style: svgBox`
    // marker this check honours IS a `//` comment, so scanning the stripped text would delete the
    // marker before ever looking for it — a self-defeating check that could never see its own
    // documented exception (found + fixed at TASK-214's Gate 6; this file is this task's own).
    const violations: string[] = [];
    const lines = clientCorpus().split('\n');
    for (const line of lines) {
      for (const m of line.matchAll(/\.style\.(\w+)/g)) {
        const prop = m[1];
        if (prop === 'display' || prop === 'transform') continue;
        if (prop === 'setProperty' && /\.style\.setProperty\(\s*['"]--rwe-hue['"]/.test(line)) continue;
        if (line.includes('// rwe-allow-style: svgBox')) continue;
        violations.push(line.trim());
      }
    }
    expect(violations).toEqual([]);
  });
});
