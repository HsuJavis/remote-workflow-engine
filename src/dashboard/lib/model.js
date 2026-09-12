// src/dashboard/lib/model.js
// DES-206, TASK-210, REQ-134 row 2 — `shortModel(model)`: strips wire-format routing prefixes so
// the swimlane's model column shows what an operator recognizes, not the raw routed id. Mirrors
// the design handoff's own `D.shortModel`. Pure, no DOM.
export function shortModel(model) {
  if (!model) return model;
  let m = model;
  if (m.startsWith('openrouter/')) m = m.slice('openrouter/'.length);
  if (m.startsWith('anthropic/')) m = m.slice('anthropic/'.length);
  if (m.endsWith(':free')) m = m.slice(0, -':free'.length) + ' (free)';
  return m;
}
