// UT-244 (DES-201, ARCH-124, TASK-206, REQ-131/133, C3): `lib/strings.js` — `STR = {zh:{...},
// en:{...}}` and `t(lang, key)`; the never-run key is `predictedLayout`, never the C3-forbidden
// word ("skeleton"). Both languages share the SAME key set (a drift here silently ships a blank
// label in one language). [Housekeeping fix while in this file: the header ID below was a
// copy-paste-off-by-one from UT-243/dashboard-lib-theme.test.js — corrected to UT-244, matching
// 05-tests.md.]
//
// [v27b amendment, Round v27b owner ruling, ADR-051, TASK-206]: `strings.js` also exports
// `warningText(lang, raw)` — argument order matches `t(lang, key)` in the same module (Decision
// rationale v27b, ruling 4: ONE export, no `parseDagWarning`; location here rather than `ui/run.js`
// because parsing is a DECISION and ADR-049 leaves `ui/` no unit tier). It splits `raw` on the FIRST
// `': '`; if the head is one of the two known TOKENs it returns `t(lang, key)` with the DETAIL
// interpolated (`predictedLayoutUnavailable`, `predictedLayoutFromFallback` — takes `resolved`);
// otherwise it returns `raw` UNCHANGED — never `undefined`, never the detail half alone (a prose
// line that would drop its subject). `STR.zh`/`STR.en` also gain `laneUntitled` (a `lanes[].title:
// null` on the wire); the existing key-parity case (below) covers all three new keys for free.
//
// Tier: unit, `.js`.
//
// Red reason (measured): `src/dashboard/lib/strings.js` does not exist (whole-file import failure)
// — same reason for every case in this file, including the new `warningText` ones below.
import { describe, it, expect } from 'vitest';
// `.ts` extension here, deliberately, unlike every `../../src/*.js` specifier below: the fixture is
// a genuine `.ts` file (DES-192) and this is a `.js` IMPORTER — a `.js` specifier resolving to a
// `.ts` file is a TypeScript `moduleResolution: bundler` convenience that only applies when the
// importer itself goes through the TS-aware transform (a `.ts` test file); a plain `.js` file is
// resolved by Vite's own loader map, which needs the real extension (measured: `.js` here 404s).
import { DAG_WARNING_EXAMPLES } from '../fixtures/dashboard-wire.ts';
import { STR, t, warningText } from '../../src/dashboard/lib/strings.js';

describe('lib/strings.js (UT-244, DES-201)', () => {
  it('zh and en share the exact same key set', () => {
    expect(Object.keys(STR.zh).sort()).toEqual(Object.keys(STR.en).sort());
  });

  it('carries a "predictedLayout" key and NEVER the C3-forbidden word in either language', () => {
    expect(STR.zh).toHaveProperty('predictedLayout');
    expect(STR.en).toHaveProperty('predictedLayout');
    const allText = JSON.stringify(STR);
    expect(/skeleton/i.test(allText)).toBe(false);
  });

  it('t(lang, key) reads the right table', () => {
    expect(t('en', 'predictedLayout')).toBe(STR.en.predictedLayout);
    expect(t('zh', 'predictedLayout')).toBe(STR.zh.predictedLayout);
  });
});

describe('lib/strings.js: warningText(lang, raw) (UT-244, DES-201, Round v27b)', () => {
  it('the FALLBACK token, both languages: renders via the string table, carrying the substitute version', () => {
    for (const lang of ['zh', 'en']) {
      const out = warningText(lang, DAG_WARNING_EXAMPLES.fallback);
      expect(out).not.toBe(DAG_WARNING_EXAMPLES.fallback); // mapped, not passed through
      expect(out).toContain('v1'); // the resolved= version from the fixture literal
      expect(/skeleton/i.test(out)).toBe(false);
    }
  });

  it('the UNAVAILABLE token, both languages: renders its own text (no interpolated detail to check)', () => {
    for (const lang of ['zh', 'en']) {
      const out = warningText(lang, DAG_WARNING_EXAMPLES.unavailable);
      expect(out).not.toBe(DAG_WARNING_EXAMPLES.unavailable);
      expect(out).toBe(STR[lang].predictedLayoutUnavailable);
    }
  });

  it('a layoutGraph PROSE warning (which also contains ": ") passes through RAW — the head is not a known token', () => {
    expect(warningText('en', DAG_WARNING_EXAMPLES.prose)).toBe(DAG_WARNING_EXAMPLES.prose);
    expect(warningText('zh', DAG_WARNING_EXAMPLES.prose)).toBe(DAG_WARNING_EXAMPLES.prose);
  });

  it('an unknown head, a detail with no "=", and a known token with a malformed detail all return raw — never undefined, never the detail half', () => {
    expect(warningText('en', 'SOME_OTHER_TOKEN: reason=x')).toBe('SOME_OTHER_TOKEN: reason=x');
    expect(warningText('en', 'PREDICTED_OVERLAY_UNAVAILABLE: not-a-kv-pair')).toBe('PREDICTED_OVERLAY_UNAVAILABLE: not-a-kv-pair');
    expect(warningText('en', 'PREDICTED_FROM_FALLBACK_VERSION: pinned=v2')).toBe('PREDICTED_FROM_FALLBACK_VERSION: pinned=v2'); // no resolved=
  });

  it('a string with no ": " at all (no split point) returns raw, never undefined', () => {
    expect(warningText('en', 'no colon-space here')).toBe('no colon-space here');
  });

  it('the key-parity case above already covers the three new keys — asserted directly here too, so a partial rename is caught locally', () => {
    expect(STR.zh).toHaveProperty('predictedLayoutUnavailable');
    expect(STR.zh).toHaveProperty('predictedLayoutFromFallback');
    expect(STR.zh).toHaveProperty('laneUntitled');
    expect(STR.en).toHaveProperty('predictedLayoutUnavailable');
    expect(STR.en).toHaveProperty('predictedLayoutFromFallback');
    expect(STR.en).toHaveProperty('laneUntitled');
  });
});

// [v28b, DES-220, TASK-226, REQ-143 amended clause] `noDemoData` — the「此路由無示範資料」disclosure
// the owner's 2026-09-17 ruling names for the three routes with no demo entry. The key-parity case
// above already guards it against a one-language landing by construction; this pins the two exact
// literals, so a typo in either language is caught here rather than only downstream in the
// acceptance run.
//
// [widened v28b, owner ruling 2026-09-18] the owner declined to just flag "nothing here" and asked
// for the missing ROUTE itself to be shown, on all three surfaces. `noDemoData` becomes a
// colon-terminated PREFIX, not a complete sentence — each of the three call sites appends its OWN
// literal route right after it (asserted at the acceptance tier, not here).
//
// Red reason (measured, widened v28b): `STR.zh.noDemoData` is `'此路由無示範資料'` (no trailing
// colon) and `STR.en.noDemoData` is `'No demo data for this route'` (no trailing space) — the key
// exists (landed at 87eee96 for the pre-widened sentence) but is missing exactly the suffix the
// widened ruling requires.
describe('lib/strings.js: noDemoData (UT-244, DES-220, v28b)', () => {
  it('pins both languages\' exact literal — a colon-terminated PREFIX (widened v28b), not a complete sentence', () => {
    expect(STR.zh.noDemoData).toBe('此路由無示範資料:');
    expect(STR.en.noDemoData).toBe('No demo data for this route: ');
    expect(t('zh', 'noDemoData')).toBe(STR.zh.noDemoData);
    expect(t('en', 'noDemoData')).toBe(STR.en.noDemoData);
  });
});

// v35 (DES-240, ARCH-153, TASK-238, REQ-205): a new i18n key for the failure-reason label rendered
// next to a failed run's status (detail view + list row) — no literal in a view file (`workflow.js`/
// `run.js` read this key through `t()`), both languages present in the SAME edit. Written
// test-first (Gate 5, RED) — no such key exists in `STR` today.
describe('lib/strings.js: failureReason (UT, DES-240, v35, REQ-205)', () => {
  it('both languages define a failureReason label, through t()', () => {
    expect(typeof STR.zh.failureReason).toBe('string');
    expect(STR.zh.failureReason.length).toBeGreaterThan(0);
    expect(typeof STR.en.failureReason).toBe('string');
    expect(STR.en.failureReason.length).toBeGreaterThan(0);
    expect(t('zh', 'failureReason')).toBe(STR.zh.failureReason);
    expect(t('en', 'failureReason')).toBe(STR.en.failureReason);
  });
});
