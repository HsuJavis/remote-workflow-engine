// src/dashboard/ui/theme-init.js
// DES-201, ARCH-125, TASK-208, REQ-131 — the ONE classic (non-module) script, loaded BLOCKING in
// <head> so theme/lang/hue are stamped on <html> before first paint (a `type="module"` script is
// deferred and would paint dark-then-light). No `import`: a classic script cannot load an ESM
// module, so the three localStorage key literals below are a deliberate COPY of
// `lib/theme.js`'s PREF_KEYS values (DES-201's one surviving source pin — this is the only client
// file vitest cannot import as ESM, so its own unit test reads it as TEXT instead).
//
// Each localStorage read is wrapped on its own so a browser with storage disabled (a throwing
// getter) still paints the documented defaults rather than leaving <html> unattributed.
(function () {
  var KEY_THEME = 'rwe-theme';
  var KEY_LANG = 'rwe-lang';
  var KEY_HUE = 'rwe-hue';

  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function clampHue(h) {
    if (!isFinite(h)) return 0;
    return ((h % 360) + 360) % 360;
  }

  // dashboard.css has no [data-theme="system"] rule — 'system' (or an absent/corrupt value)
  // resolves to the OS's live preference instead of being written to the attribute verbatim.
  function resolveTheme(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    var mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    return mql && mql.matches ? 'dark' : 'light';
  }

  function currentThemePref() {
    return read(KEY_THEME) || 'dark'; // REQ-131: first load with no preference is dark.
  }

  function apply() {
    var lang = read(KEY_LANG) || 'zh';
    var hueRaw = read(KEY_HUE);
    var hue = hueRaw == null ? 236 : clampHue(Number(hueRaw));
    var root = document.documentElement;
    root.setAttribute('data-theme', resolveTheme(currentThemePref()));
    root.setAttribute('lang', lang === 'en' ? 'en' : 'zh-Hant');
    root.style.setProperty('--rwe-hue', String(hue));
  }

  apply();

  // REQ-131: a theme preference of "system" follows the OS live, with no reload.
  try {
    var mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mql && mql.addEventListener) {
      mql.addEventListener('change', function () {
        if (currentThemePref() === 'system') {
          document.documentElement.setAttribute('data-theme', resolveTheme('system'));
        }
      });
    }
  } catch (e) {
    // matchMedia unsupported — the one-shot apply() above already ran.
  }
})();
