// src/dashboard/lib/strings.js
// DES-201, ARCH-124, ADR-049, TASK-206, REQ-131/133 — the zh/en string table and t(lang, key).
// C3: neither language may carry the retired UI term that the repo-wide mechanical grep guard
// (ADR-022, REQ-105) forbids across src/** -- the same term this project always calls "the C3 word".
//
// [v27b, ADR-051] warningText(lang, raw) maps the DAG route's warning grammar
// (`WARNING := TOKEN (': ' DETAIL)?`, DES-198) to a rendered sentence for the two known TOKENs,
// or passes an unrecognized string through UNCHANGED — a `layoutGraph` prose warning carries no
// token and must reach the viewer verbatim, in either language.

// [v27 README-fidelity build] `brand` (README "Header / chrome": nav brand text next to the source
// tag) is the SAME literal in both languages — the design shows zh/en side by side always, it does
// not swap on the lang toggle — but it still lives here, not as a hard-coded literal in `ui/app.js`,
// so REQ-131's "both languages come from one source" holds even for a string that happens not to
// vary by language today.
export const STR = {
  zh: {
    predictedLayout: '預測結構',
    predictedLayoutUnavailable: '預測結構不可用',
    predictedLayoutFromFallback: '預測結構來自替代版本 v{resolved}',
    laneUntitled: '未命名 lane',
    // [v27m, DES-206 (S)] the ONE Unavailable component's text, for EVERY view — the zh/en pair is
    // REQ-138's own (01-requirements.md:1874). It lands in both languages in the same edit on
    // purpose: `t()` has no fallback, so a one-language key renders the literal string `undefined`
    // (the BF-5/BF-6 defect class, inside the repair for it). `ui/system.js:29`'s zh-only
    // `UNAVAILABLE` const is the pre-existing second copy — QD-R3 debt, retired when that site is
    // repaired, not before, or the two diverge.
    unavailable: '無法取樣',
    brand: '工作流引擎 / Workflow Engine',
    // [v28, DES-212, TASK-220, REQ-143] `demoData` is the nav tag's text while demo mode is
    // engaged (`ui/app.js`'s `demoEngages` arm); `demoBanner` is the shell banner painted OUTSIDE
    // `mountLazy`'s per-route `replaceChildren()` reach, so it survives every tab/route switch for
    // as long as demo mode stays engaged.
    demoData: '示範資料',
    demoBanner: '示範資料 — 引擎目前無法連線,以下畫面為示範內容',
    // [v28b, DES-220, TASK-226, REQ-143 amended clause] the per-route disclosure for a route with
    // no DEMO map entry (DES-212) — shown instead of a frozen/synthesized paint on a demo tick.
    noDemoData: '此路由無示範資料',
  },
  en: {
    predictedLayout: 'predicted layout',
    predictedLayoutUnavailable: 'predicted layout unavailable',
    predictedLayoutFromFallback: 'predicted layout from substitute version v{resolved}',
    laneUntitled: 'untitled lane',
    unavailable: 'Unavailable',
    brand: '工作流引擎 / Workflow Engine',
    demoData: 'Demo data',
    demoBanner: 'Demo data — the engine is unreachable; this view is showing demo content',
    noDemoData: 'No demo data for this route',
  },
};

export function t(lang, key) {
  return STR[lang][key];
}

// The two TOKEN literals DES-198's grammar allows — anything else is layoutGraph prose.
const TOKEN_KEYS = {
  PREDICTED_FROM_FALLBACK_VERSION: 'predictedLayoutFromFallback',
  PREDICTED_OVERLAY_UNAVAILABLE: 'predictedLayoutUnavailable',
};

// DETAIL := k=v (' ' k=v)* — returns null (malformed) rather than a partial object, so a
// caller can tell "no detail parsed" from "detail parsed with an unexpected key set".
function parseDetail(detail) {
  const kv = {};
  for (const part of detail.split(' ')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq === -1) return null;
    kv[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return kv;
}

export function warningText(lang, raw) {
  const splitAt = raw.indexOf(': ');
  if (splitAt === -1) return raw;
  const head = raw.slice(0, splitAt);
  const key = TOKEN_KEYS[head];
  if (!key) return raw; // unknown head — layoutGraph prose, pass through raw.

  const kv = parseDetail(raw.slice(splitAt + 2));
  if (!kv) return raw; // malformed detail — never render a guess.

  if (key === 'predictedLayoutFromFallback') {
    if (!kv.resolved) return raw; // required key missing — never the detail half alone.
    return t(lang, key).replace('{resolved}', kv.resolved.replace(/^v/, ''));
  }
  return t(lang, key);
}
