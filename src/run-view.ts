// src/run-view.ts (v24 DES-162, ARCH-091, ADR-027, TASK-147): the one projection an ungated
// `/api/*` dashboard route applies before serializing a RunStatusView — no identity field leaves
// the server on a route nobody authenticated to reach.
import type { RunStatusView } from './types.js';

/** `principal` is the only identity field `RunStatusView` itself carries (DES-151 attaches
 *  `adminReads` at the MCP facade's own projection — it is never a field of `RunStatusView`, so
 *  this function has nothing to strip for it by construction, not by a strip rule someone must
 *  remember). The general rule (DES-162 boundary) is stated once: `principal`/`adminReads`/
 *  `pushedBy`/`createdBy`/`claimedBy` never serialize on an ungated `/api/*` route. */
export function toPublicRunView(view: RunStatusView): Omit<RunStatusView, 'principal'> {
  const { principal: _principal, ...rest } = view;
  return rest;
}
