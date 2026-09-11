// src/dashboard/lib/strings.js
// DES-201, ARCH-124, ADR-049, TASK-206, REQ-131/133 — the zh/en string table and t(lang, key).
// C3: neither language may carry the retired word ("skeleton").
//
// [v27b, ADR-051] warningText(lang, raw) maps the DAG route's warning grammar
// (`WARNING := TOKEN (': ' DETAIL)?`, DES-198) to a rendered sentence for the two known TOKENs,
// or passes an unrecognized string through UNCHANGED — a `layoutGraph` prose warning carries no
// token and must reach the viewer verbatim, in either language.

export const STR = {
  zh: {
    predictedLayout: '預測結構',
    predictedLayoutUnavailable: '預測結構不可用',
    predictedLayoutFromFallback: '預測結構來自替代版本 v{resolved}',
    laneUntitled: '未命名 lane',
  },
  en: {
    predictedLayout: 'predicted layout',
    predictedLayoutUnavailable: 'predicted layout unavailable',
    predictedLayoutFromFallback: 'predicted layout from substitute version v{resolved}',
    laneUntitled: 'untitled lane',
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
