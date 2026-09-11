// UT-242 (DES-201, ARCH-124, TASK-206, REQ-131): `lib/theme.js` — `PREF_KEYS`, `clampHue(h)`,
// `prefsFromStorage(get)` (pure over an INJECTED getter, so a browser with storage disabled still
// paints). NOT `accentVars()` — ARCH-124's own amendment moves the OKLCH ramp into CSS (a classic
// script cannot `import` an ESM module, DES-201's boundary).
//
// Tier: unit, `.js` — imports the EXACT bytes the browser is served (ADR-049, no jsdom, no
// transpile). Requires vitest.config.ts's widened `include` (this dispatch's own TASK-196 half).
//
// Red reason (measured): `src/dashboard/lib/theme.js` does not exist (whole-file import failure).
import { describe, it, expect } from 'vitest';
import { PREF_KEYS, clampHue, prefsFromStorage } from '../../src/dashboard/lib/theme.js';

describe('lib/theme.js (UT-242, DES-201)', () => {
  it('PREF_KEYS names the three localStorage keys', () => {
    expect(PREF_KEYS).toEqual({ theme: 'rwe-theme', lang: 'rwe-lang', hue: 'rwe-hue' });
  });

  it('clampHue is total over -1 / 0 / 359 / 360 / NaN', () => {
    expect(clampHue(-1)).toBe(359);
    expect(clampHue(0)).toBe(0);
    expect(clampHue(359)).toBe(359);
    expect(clampHue(360)).toBe(0);
    expect(clampHue(NaN)).toBe(0);
  });

  it('prefsFromStorage is pure over an injected getter', () => {
    const get = (key) => ({ 'rwe-theme': 'light', 'rwe-lang': 'en', 'rwe-hue': '200' })[key] ?? null;
    expect(prefsFromStorage(get)).toEqual({ theme: 'light', lang: 'en', hue: 200 });
  });

  it('a getter that THROWS (storage disabled) still yields defaults, never throws itself', () => {
    const throwingGet = () => { throw new Error('SecurityError: storage disabled'); };
    expect(() => prefsFromStorage(throwingGet)).not.toThrow();
  });

  it('missing keys default to theme:"dark" (REQ-131: first load with no preference is dark, deterministically — not "system"), lang:"zh" (matches the SSR default), hue:236 (dashboard.css\'s own no-storage default)', () => {
    const get = () => null;
    expect(prefsFromStorage(get)).toEqual({ theme: 'dark', lang: 'zh', hue: 236 });
  });
});
