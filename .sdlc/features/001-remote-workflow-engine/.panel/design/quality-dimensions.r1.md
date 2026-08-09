---
panel: design
lens: quality-dimensions
round: 1
scope: v11 Sprint 3 — n8n-style graph dashboard (REQ-071..073 / ARCH-041..045)
---

# Quality-Dimensions Design Review — Round 1

## Summary

This review applies the four cross-cutting quality dimensions to the **detailed design** of
ARCH-041 (`startedBy` provenance), ARCH-042 (`GraphPayload` + `layoutGraph` + skeleton overlay),
ARCH-043 (Morandi SVG renderer + pan/zoom), ARCH-044 (`kind:'harness'` transcript event +
`redactHarness`), and ARCH-045 (harness detail panel + two-tier no-secret proof). Gate-2 for Sprint
3 is PASSED. Settled decisions — SVG over flexbox (D6), poll over SSE, GraphPayload as internal
seam, capture-at-dispatch (D1), global semaphore — are confirmed below, not re-litigated.

**Altitude determination.** This project is definitively both **system-altitude** and
**agent-altitude**. System altitude: the MCP HTTP server, run manager, SQLite store, journal,
gateway router, and now the DAG renderer and `layoutGraph` function (ARCH-042/043). Agent altitude:
the Claude Agent SDK headless sessions spawned per `agent()` call, with LLM backends, tool
surfaces, skill injection, and MCP name resolution — all of which ARCH-044 captures for the first
time. Both altitudes are analysed in every dimension below.

**Primary quality concern for this sprint.** ARCH-044's harness capture is only as good as the
`deriveAgentRecords` fix it mandates. Five of the eight risks below touch this code path directly
or indirectly. Two design-gate leftovers explicitly handed to this panel are resolved in §1 and §2.

---

## Key Points by Dimension

### 1. Observability

**Agent altitude — harness capture closes the largest gap in project history (ARCH-044).**
For the first time each agent's resolved prompt, curated tool surface, skill list, and MCP server
names are durable in the journal. This converts the agent layer from a black box (inputs opaque,
outputs observable) to an almost-white box (inputs now observable, with one named bound on prompt
size). This is the most significant observability improvement since v1 shipped.

**The `deriveAgentRecords` fix is mandatory and load-bearing.**
ARCH-044 explicitly names this obligation: the current `if (!usage) continue` guard in `run-store.ts`
drops dispatched-but-unsettled agents on snapshot-less restart. If this fix is not shipped
atomically with ARCH-044, harness events from in-flight agents are invisible on any crash-resume
cycle — exactly the scenario where harness visibility matters most. The harness feature is
incomplete without it.

**Confirm homed items; add precision where the design leaves gaps.**

- `terminalAt?` on `RunStatusView` (ARCH-042): confirm this field lives on `RunStatusView` itself
  (not a separate HTTP DTO). Because ARCH-028 passes `RunStatusView` directly through to the MCP
  facade, `terminalAt` reaches `workflow_status` callers automatically — no gap. The dashboard
  polling benefit is homed; the MCP caller benefit is free.

- `warnings:string[]` in `GraphPayload` (ARCH-042): confirm warnings appear in **both** the SVG
  overlay (a small badge or legend) **and** in the `GET /api/runs/:id/dag` JSON response. Displaying
  in SVG only makes them invisible to non-browser callers; JSON only makes them invisible to
  operators watching the dashboard.

- 4 KB prompt cap (ARCH-044): the cap is correct to bound journal growth. Add precision: truncate
  **head+tail** (first 2 KB + last 2 KB) rather than head-only, so the tail — where task
  instructions typically land in a context-injection pattern — is always visible. Mark the
  truncation boundary explicitly in the captured string (e.g. `"…[truncated]…"`).

**Design-gate leftover resolved: direct-fetch gateway harness.**
ARCH-044 notes the direct-fetch gateway path as a non-blocking leftover. Resolution: emit the
same `kind:'harness'` event on the direct-fetch path with fields truthfully empty
(`tools:[], skills:[], mcpServers:[]`). Distinguish **harness-absent (null)** from
**harness-with-empty-surface** so a consumer who receives `harness: { tools:[], ... }` understands
the agent ran with a genuinely empty tool surface, not that capture was never implemented for that
path. Harness-absent (null) must not occur for any agent dispatched after ARCH-044 ships — it is
a regression signal. If the truthfully-empty/absent distinction is ambiguous from array emptiness
alone, add a discriminant field (e.g. `surfaceType: 'curated' | 'none'`) to make it explicit.

**Silent degradation in the skeleton overlay is an observability defect.**
When a live `AgentRecord` cannot be matched to a `SkeletonNode` by `label+phase` key (loop
iterations, conditional branches, dynamic labels), the fallback to frame-based grouping is the
correct behaviour — no agent is ever dropped. But the fallback is currently silent: the operator
sees correct node positions and never learns that structural inference failed. Require the fallback
to emit a `warnings[]` entry ("agent `<id>` unmatched to skeleton: fell back to frame grouping")
when a live agent misses the `label+phase` match. This ties to the already-homed `warnings[]`
field in `GraphPayload` and has zero additional implementation cost. Opaque degradation is this
dimension's core defect class.

**Deferred items (endorse).** No distributed trace-ID across the four-process chain — endorsed as a
future-REQ candidate; a `runId`+`agentId` pair is adequate for the single-user single-instance
deployment context. No `GET /health` liveness endpoint — endorsed as a future-REQ candidate. Both
have been carried since Sprint 2 with no change in scope.

---

### 2. Replaceability

**Hand-rolled SVG is the correct replaceability call (ARCH-043); confirm the seam.**
No d3-dag, mermaid, or dagre dependency is introduced. The `layoutGraph` pure function is the
explicit replacement seam: layout algorithm changes are one-function swaps. Confirmed as settled.

**Morandi palette — confirm single source.**
The `morandiFrameHue(frame)` pure function is deterministic and unit-testable. Confirm that the
Morandi palette array lives in a single exported constant (or CSS custom property set), not
scattered as HSL literals through the renderer. A palette swap should be a single-source edit.
This is a design-stage precision item, not a new requirement.

**Skeleton-as-topology coupling — name the adapter.**
The overlay uses `SkeletonNode[]` from `parseWorkflowSkeleton` (REQ-062) as structural truth.
`layoutGraph` consuming `SkeletonNode` directly creates a coupling: if `parseWorkflowSkeleton`
evolves its output shape (new node kinds, renamed `kind:'parallel'`), `layoutGraph` breaks
silently. Introduce a local `LayoutNode` adapter type that `layoutGraph` consumes; the adapter
function normalises `SkeletonNode` to `LayoutNode`. The adapter is the replacement seam — if the
skeleton parser is ever swapped, only the adapter changes, not the layout algorithm. Naming the
seam is a design-stage obligation; the code is small.

**`startedBy` enum — extensibility under persistence (ARCH-041).**
The `chain` value must be wired in `ContinuationStore.fire`. Adding future trigger types is
schema-compatible: new string values do not break existing readers of the persisted `runs` row.
Confirm the display layer handles unknown `startedBy.type` values gracefully (unknown type →
generic "triggered by" label, never a crash or blank). This is a one-line guard with a
non-obvious correctness implication.

**Design-gate leftover resolved: `chain` display label.**
REQ-071 enumerates `client`, `webhook`, and `schedule` trigger sources but does not specify the
`chain` label. Proposal: the source node for a chained run displays "chain via
`<startedBy.id[0..7]>`" rendered via `textContent`. This is consistent with the `textContent`-only
invariant (REQ-067, extended to the graph path by ARCH-045), provides parent-run provenance without
exposing the full run ID in the node label, and survives gracefully when no `startedBy.id` is
available (label degrades to "chain").

**`GraphPayload` stability expectation confirmed.**
Not a frozen public contract (Gate-2 decision, endorsed as Karpathy-consistent). Document the
stability expectation inline — "internal type, may change without notice; callers building on
`GET /api/runs/:id/dag` accept that risk" — to prevent premature contract fossilisation.

**Agent altitude — LLM backend decoupling unchanged by Sprint 3.**
ProviderProfile config table and `GatewayClient` port are unaltered. Harness capture is
gateway-agnostic: both SDK and direct-fetch paths emit the same `kind:'harness'` event (with the
empty-surface resolution above). Confirmed.

---

### 3. Consumability

**Extending `workflow_agent_log` (not a new route) is the right call (ARCH-045).**
`harness: HarnessDescriptor | null` added to the existing transcript response means MCP callers
receive harness data on a surface they already use. No new endpoint, no new auth, no new client
code. This is the consumability pattern the architecture has consistently applied and it is correct.

**Canonical `state` values must never cross the API boundary as display aliases.**
Canonical `AgentRecord.state` values are `queued`/`running`/`done`/`failed`. Display aliases
(`queued → "idle"`, `done → "completed"`) are render-only (ARCH-045, confirmed homed). Confirm:
the `state` field in **all** JSON API responses — `workflow_status`, `workflow_agent_log`,
`GET /api/runs/:id` — carries only the canonical value. An MCP caller who reads `state: "done"`
from `workflow_status` and then encounters `"completed"` in `workflow_agent_log` (or vice versa) has
a silent mismatch. The alias is a UI decision; a serialisation-layer unit test asserting canonical
values on every API response shape is the enforcement mechanism.

**50-message transcript cap and pagination — specify the MCP tool behaviour.**
`?limit=N&offset=M` is added to the HTTP endpoint (ARCH-045, homed). Specify: the MCP tool
`workflow_agent_log` also enforces the same cap and includes a `hasMore: boolean` (or equivalent)
in its response so callers know when to paginate. Without this, a caller who receives 50 messages
has no way to know whether the run produced exactly 50 or whether there are more. The design is
currently silent on the tool's cap behaviour — this is the consumability gap.

**Add a server-side node cap to `GET /api/runs/:id/dag` response.**
ARCH-043 adds a "N more" cap at the rendering layer. But `layoutGraph` itself is currently
uncapped: for a run at REQ-002's 1000-agent ceiling, the JSON response can be very large. Add a
`maxNodes` parameter to `layoutGraph` (with a documented default, e.g. 200) that truncates the
output and sets a `truncated: true` flag in `warnings[]`. The client-side "N more" rendering cap is
a second protection, not a substitute. A third-party client polling this endpoint for a large run
should not receive an arbitrarily large payload from the server.

**`tools` in `HarnessDescriptor` are names only, not schemas.**
This is correct for the consumability goal (no secret/token exposure, bounded size). Document it
explicitly: callers who want tool schemas must consult the provisioned MCP registry (ARCH-015,
`mcp_provision`). The harness surface is a fingerprint ("these tool names were injected at
session-build"), not a schema catalogue. For `mcpServers`, note that names (not URLs) are surfaced
— URLs may carry auth tokens; names carry neither. This note belongs in the `HarnessDescriptor`
type's JSDoc, not only in DEPLOY.

---

### 4. Self-sustainability

**Budget-on-crash-resume — close it at the `deriveAgentRecords` seam.**
The defect: on crash/resume, `RunGuard.spent` is reconstructed from the journal but `budget.spent()`
starts at 0 because ARCH-034 does NOT re-derive it from journaled usage events. A resumed run can
exceed its budget cap silently. ARCH-044 already mandates changing `deriveAgentRecords` to fix the
`if (!usage) continue` guard. Budget re-derivation is one additional pass over the same usage events
visited by that fix — same code path, same journal read, same test fixture. Propose this as a
task-note on the ARCH-044 `deriveAgentRecords` implementation ticket: while iterating usage events
to build `AgentRecord[]`, also accumulate `spentTokens` and re-hydrate `RunGuard.spent`. This
closes a named real defect at near-zero incremental cost without opening a new code path.

**`terminalAt?` bounds polling cost for completed runs.**
Confirmed. The frontend stops polling once `terminalAt` is set. In-progress runs poll at 3s;
for a long-running scheduled workflow this is acceptable for the single-user, single-instance model.
The Gate-2 decision (poll over SSE) is not re-opened. Endorsed.

**ARCH-044 journal growth is bounded.**
The `kind:'harness'` event adds at most one capped record per agent (4 KB prompt field). At
REQ-002's 1000-agent ceiling this adds ≤4 MB to the journal per run — within an acceptable order
of magnitude for the existing journal-growth trajectory. Confirmed.

**Tool-liveness — `kind:'harness'` records what was configured, not what was reachable.**
Provisioned MCP servers are probed at provision time (D-PROBE). The harness event captures names
injected at session-build. If a provisioned MCP goes offline between provision and dispatch, the
harness records the configured name and the agent encounters a tool-call error at runtime. Adding a
per-agent liveness probe at session-build has cost (latency, failure paths). Deferred. Document the
`mcpServers` field as "configured-at-dispatch, not guaranteed reachable" — a future
`mcpLivenessCheckedAt?: number` field per entry closes this gap when warranted.

**CAS GC, journal archival, `GET /health` — deferred, endorsed.**
None are touched by ARCH-041..045. CAS store and agent transcript journals grow indefinitely;
`workspace_purge` (REQ-026) does not remove transcript journals by design. Confirm this is
documented in the purge command's help text so an operator does not assume purge frees all disk.
`GET /health` remains a future-REQ candidate. All three endorsed as-is.

**Agent altitude — one-shot sessions have no cross-session memory to metabolise.**
Each `agent()` invocation is a fresh headless session; the workflow JS manages inter-agent state
through return values. Cross-session memory metabolism is a non-issue here. The harness panel
surfaces the prompt for the first time, which may include accumulated retrieved context injected by
a prior agent; the 4 KB head+tail cap bounds its journal footprint regardless of how large that
context grows.

---

## Risks

| ID | Description | Severity | Owner hint |
|----|-------------|----------|------------|
| R1 | `deriveAgentRecords` fix (ARCH-044 obligation) not shipped atomically with harness capture → in-flight agents' harness events dropped on crash-resume | HIGH | single implementation ticket; cannot split |
| R2 | Direct-fetch gateway emits no `kind:'harness'` event → `harness: null` on those agents; consumers misread null as "not yet implemented" rather than "platform has no tool surface" | HIGH | resolve via truthfully-empty harness + `surfaceType` discriminant (see §1) |
| R3 | Budget-on-crash-resume: `spent()` not re-derived alongside `deriveAgentRecords` fix → resumed run can silently exceed budget cap | MEDIUM | bundle into ARCH-044 implementation ticket |
| R4 | Server-side DAG node cap absent → `GET /api/runs/:id/dag` returns unbounded JSON for large runs at REQ-002 ceiling | MEDIUM | add `maxNodes` param + `truncated` flag in `warnings[]` |
| R5 | Canonical `state` value (`done`, `queued`) leaks into rendered display as `completed`/`idle` and eventually into an API response → MCP callers see two state vocabularies | MEDIUM | enforce at serialisation layer; unit test each API response shape |
| R6 | Skeleton overlay `label+phase` fallback is silent → parallel structure quietly degrades to frame-based grouping with no observable signal | MEDIUM | require `warnings[]` entry on fallback (see §1) |
| R7 | 4 KB prompt cap is head-only → task instruction at the tail of a context-injection prompt is always truncated | LOW | switch to head+tail (2 KB each) with marked boundary |
| R8 | `mcpServers` in `HarnessDescriptor` presented without "configured, not guaranteed reachable" caveat → operators assume liveness was checked at dispatch | LOW | annotation in JSDoc + deferred `mcpLivenessCheckedAt` field |

---

## Task-Splitting Notes

Dimension-driven constraints on how the five ARCH units should be decomposed. Design-synthesis
writes the actual tasks; these notes flag what the dimension review requires to be atomic or
sequenced.

**ARCH-041 (`startedBy`).** Wire `chain` value in all `ContinuationStore.fire` call sites.
Persistence in the `runs` table (not snapshot-only) is load-bearing — schema migration must be
part of the ticket, not deferred. Regression test: all four `startedBy.type` values, plus one
unknown string value asserting the display-layer graceful fallback.

**ARCH-042 (`GraphPayload` + `layoutGraph`).** Introduce the `LayoutNode` adapter over `SkeletonNode`
as a named seam (see §2). `layoutGraph` takes `LayoutNode[]`, not `SkeletonNode[]` directly. Add
`maxNodes` parameter with documented default. `warnings[]` populated for: skeleton-fallback agents,
truncated node lists, and any other unmatched live agents. `terminalAt?` confirmed on `RunStatusView`
(not a separate DTO) so ARCH-028 pass-through covers MCP callers.

**ARCH-043 (SVG renderer).** `morandiFrameHue` unit test: same frame string → same hue across
calls; confirm palette defined in one location. "N more" cap: decide and document the ceiling value
(recommend 200 rendered nodes per viewport; document in ARCH or tasks so it matches the `maxNodes`
server-side default). Pan/zoom must not break the `textContent`-only invariant for any node label.

**ARCH-044 (harness capture).** Single implementation ticket covering atomically: (a) `deriveAgentRecords`
fix (drop `if (!usage) continue`; yield queued/running record from harness-without-usage event);
(b) budget re-derivation pass over usage events (R3); (c) `kind:'harness'` event on both SDK and
direct-fetch paths, with empty-surface vs. absent distinction (R2); (d) 4 KB head+tail cap with
marked truncation boundary; (e) latest-wins dedupe for bounded retry loop. Unit tests: each of
(a)–(e) independently verifiable.

**ARCH-045 (detail panel).** Two-tier no-secret proof is a first-class acceptance criterion, not
optional QA. Specify `workflow_agent_log` MCP tool cap behaviour (`hasMore` field or equivalent,
see §3). Canonical `state` in API responses enforced via serialisation unit test (see §3). `chain`
display label wired (see §2 design-gate leftover). Headless-browser DOM assertion (tier-2 proof)
must cover the `textContent`-only invariant for harness-panel content including tool names, skill
names, and MCP server names.

---

## Expected Disagreements with Other Lenses

**Adversarial lens on R3 (budget re-derivation).** May read this as scope creep into ARCH-034.
Pre-empt: the `deriveAgentRecords` change is already mandated by ARCH-044; budget re-derivation is
one additional pass over the same events in the same function. Cost is bounded; benefit is closure
of a named real defect that persists across every sprint. If adversarial holds for a separate
ticket, that is acceptable — but the fix must be gated to land before Gate 7.5.

**Adversarial lens on R4 (server-side node cap).** Will likely agree, possibly frame as a DoS
concern. This review frames it as a consumability + self-sustainability issue. Alignment on the
fix is expected; framing disagreement does not affect the task.

**Simplicity/Karpathy lens on the `LayoutNode` adapter proposal.** May read the adapter as
unnecessary abstraction (the skeleton shape is stable). Counter: the adapter is one type alias +
one mapping function, not a framework. It names the seam explicitly. If simplicity holds, the
minimum acceptable outcome is that `layoutGraph`'s type signature references `SkeletonNode` and
the coupling is documented as an acknowledged design-level dependency. The synthesizer must make a
conscious choice; leaving it implicit is the failure mode.

**Adversarial lens on R2 (direct-fetch harness).** May endorse the truthfully-empty harness
resolution without disagreement. If adversarial raises the concern that `tools:[]` is misleading
(direct-fetch path has no tool loop, so `[]` is structurally absent, not curated-empty), the
tiebreaker is the `surfaceType: 'curated' | 'none'` discriminant field — distinguishes the two
cases without relying on array emptiness alone.

**Any lens on poll-backoff.** `terminalAt?` already bounds the completed-run polling case. Poll
over SSE is a settled Gate-2 decision. Poll-backoff is not worth reopening for a single-user tool.
Not a blocker, not a proposal.
