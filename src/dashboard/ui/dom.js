// src/dashboard/ui/dom.js
// v27 Gate 6.5+7 (verifier, simplify): `el(tag, className, text)` was defined byte-identically in
// three of TASK-212's ported tabs (models.js, system.js, issues.js) — hoisted here rather than left
// triplicated. UI-tier, not lib/: it touches `document`, and `lib/*.js` is a strict pure-projection
// boundary (no `lib/*.js` file references `document` anywhere in this tree) — moving it there would
// blur that line for a one-off convenience helper.
export function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
