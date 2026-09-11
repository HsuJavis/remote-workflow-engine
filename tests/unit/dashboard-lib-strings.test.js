// UT-243 (DES-201, ARCH-124, TASK-206, REQ-131/133, C3): `lib/strings.js` — `STR = {zh:{...},
// en:{...}}` and `t(lang, key)`; the never-run key is `predictedLayout`, never the C3-forbidden
// word ("skeleton"). Both languages share the SAME key set (a drift here silently ships a blank
// label in one language).
//
// Tier: unit, `.js`.
//
// Red reason (measured): `src/dashboard/lib/strings.js` does not exist (whole-file import failure).
import { describe, it, expect } from 'vitest';
import { STR, t } from '../../src/dashboard/lib/strings.js';

describe('lib/strings.js (UT-243, DES-201)', () => {
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
