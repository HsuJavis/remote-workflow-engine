// src/dashboard/lib/theme.js
// DES-201, ARCH-124, ADR-049, TASK-206, REQ-131 — the viewer-preference layer.
// PREF_KEYS + clampHue + prefsFromStorage. NOT accentVars(): ARCH-124's own amendment moves the
// OKLCH ramp into dashboard.css — a classic script (ui/theme-init.js) cannot `import` an ESM
// module, so there is no formula to mirror here.
//
// This file is served to the browser byte-for-byte (no build step) and is also imported directly
// by its unit test — plain ESM, no framework, no bundler-only syntax.

export const PREF_KEYS = { theme: 'rwe-theme', lang: 'rwe-lang', hue: 'rwe-hue' };

// Total over every number, including NaN and out-of-range values — a corrupt/edited
// localStorage value must still paint a valid hue rather than a broken custom property.
export function clampHue(h) {
  if (!Number.isFinite(h)) return 0;
  return ((h % 360) + 360) % 360;
}

// Pure over an INJECTED getter (e.g. `localStorage.getItem`) so the browser and the test share
// the same function. A throwing getter (storage disabled, SecurityError) must still yield the
// defaults rather than propagate — a browser with storage disabled still has to paint.
export function prefsFromStorage(get) {
  let theme = 'dark'; // REQ-131: first load with no preference is dark, deterministically.
  let lang = 'zh'; // matches the SSR default.
  let hue = 236; // dashboard.css's own no-storage default.
  try {
    const storedTheme = get(PREF_KEYS.theme);
    const storedLang = get(PREF_KEYS.lang);
    const storedHue = get(PREF_KEYS.hue);
    if (storedTheme != null) theme = storedTheme;
    if (storedLang != null) lang = storedLang;
    if (storedHue != null) hue = clampHue(Number(storedHue));
  } catch {
    // storage disabled — fall through with the defaults above, never throw.
  }
  return { theme, lang, hue };
}
