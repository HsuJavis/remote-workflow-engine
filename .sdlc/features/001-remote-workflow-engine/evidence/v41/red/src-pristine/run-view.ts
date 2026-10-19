// src/run-view.ts (v24 DES-162, ARCH-091, ADR-027, TASK-147): the one projection an ungated
// `/api/*` dashboard route applies before serializing a RunStatusView — no identity field leaves
// the server on a route nobody authenticated to reach.
import type { RunStatusView, RunSummary } from './types.js';

/** `principal` is the only identity field `RunStatusView` itself carries (DES-151 attaches
 *  `adminReads` at the MCP facade's own projection — it is never a field of `RunStatusView`, so
 *  this function has nothing to strip for it by construction, not by a strip rule someone must
 *  remember). The general rule (DES-162 boundary) is stated once: `principal`/`adminReads`/
 *  `pushedBy`/`createdBy`/`claimedBy` never serialize on an ungated `/api/*` route. */
export function toPublicRunView(view: RunStatusView): Omit<RunStatusView, 'principal'> {
  const { principal: _principal, ...rest } = view;
  return rest;
}

/** v35 (DES-240 rationale item 9): `RunSummary.failedAgentCount` is deliberately declined on the
 *  `/api/runs` list surface — the panel's ruling was "no dashboard surface for `failedAgentCount`"
 *  (REQ-207's acceptance is about the CALLER, i.e. `run_status`/`run_list`; a later iteration may
 *  add it to the run DETAIL pane, never the list row, where DES-231's terminal-only fold would
 *  leave it blank for exactly the run an operator is watching). `run_list` (the MCP tool) keeps the
 *  field — this projection applies ONLY at the ungated dashboard route, not to `RunSummary` itself. */
export function toPublicRunSummary(summary: RunSummary): Omit<RunSummary, 'failedAgentCount'> {
  const { failedAgentCount: _failedAgentCount, ...rest } = summary;
  return rest;
}
