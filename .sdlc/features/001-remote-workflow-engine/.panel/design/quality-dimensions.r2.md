---
panel: design
lens: quality-dimensions
round: 2
scope: v11 Sprint 3 — n8n-style graph dashboard (REQ-071..073 / ARCH-041..045)
---

# Quality-Dimensions Design Review — Round 2

## Preamble: Point-by-Point Rebuttal / Concede / Hold against Adversarial r1

The adversarial r1 is one of the strongest lens contributions this panel has seen: five concrete
hazards, each grounded in a specific code location and a stated invariant that breaks. My round-2
begins by adjudicating each against quality-dimensions obligations before restating the final
cross-cutting position per dimension.

### Adversarial finding 1 — the `onHarness` hook is the only seam that preserves harness truthfulness
**Status: CONCEDE (replaces quality r1 §1 directional assumption).**

Quality r1 named the ARCH-044 `deriveAgentRecords` obligation but was silent on the capture seam
shape, leaving open the possibility that the executor re-derives `curatedTools`/`mergedMcp`.
The adversarial closes this: the executor does NOT hold the gateway config (`defaultAllowedTools`,
`baseTools` fallback chain) so a re-derivation diverges from what the model actually saw. An
observability panel that misreports the harness is a correctness defect under the Observability
dimension's own definition ("internal state observable at any time" — not an approximate of internal
state). Concede. The `onHarness?(h: HarnessDescriptor): Promise<void>` hook injected into
`GatewayClient.invoke` options, called post-curation at `:483`, is the only capture point that
satisfies both observability (truthful) and the eager-emission requirement (running-agent + crash-safe).

**What quality adds on top:** the hook must be called on BOTH the SDK gateway path AND the
direct-fetch path (see #5 below). The adversarial defers the direct-fetch call site; quality holds
a minimal emission is required on every path (see §1 below).

### Adversarial finding 2 — logical `{col, row, laneSpan}` from `layoutGraph`, not device pixels
**Status: CONCEDE (testability win, no fidelity loss; replaces r1's pixel-agnostic endorsement).**

Quality r1 did not contest the ARCH's `x/y/width/height` coordinates because the settled D6 decision
(SVG over flexbox) was treated as geometry-in-model. The adversarial is correct on the sharper claim:
baking pixels into the pure `layoutGraph` function couples topology tests to the Morandi box-width
constant. A spacing restyle then breaks a topology UT, which is the testability dimension's core
defect class. The `LayoutNode` adapter proposal from quality r1 (§2) now integrates cleanly: the
adapter maps `SkeletonNode → LayoutNode` (replaceability seam for the input) and `layoutGraph`
emits `{id, col, row, laneSpan}` logical cells (testability seam for the output). A deterministic
cell→pixel mapper in ARCH-043 completes the chain. The two proposals are orthogonal — input adapter
(quality) + logical output cells (adversarial) — and their union is the correct design.

**Remaining disagreement on `LayoutNode`:** the adversarial did not explicitly endorse the input
adapter (`SkeletonNode → LayoutNode`). Quality holds it: if `parseWorkflowSkeleton` evolves its
output shape, `layoutGraph`'s contract breaks silently. The adapter is one type alias + one mapping
function; the Karpathy argument that "the skeleton shape is stable" is an empirical bet, not an
engineering invariant. A synthesizer must make a conscious choice; implicit coupling is the failure
mode.

### Adversarial finding 3 — join key `(label+phase)` is not unique for parallel agents
**Status: CONCEDE (closes quality r1 R6 at the root cause, not the symptom).**

Quality r1's R6 named silent degradation in the skeleton overlay (severity MEDIUM) and asked for a
`warnings[]` entry on fallback. The adversarial identifies the root cause: the join contract itself
is wrong for the parallel case — two `AgentRecord`s sharing a `label+phase` collapse into one box,
causing one live agent to vanish silently. Quality's R6 was treating the downstream symptom; the
adversarial fix is upstream. Concede: the join contract must be stated as **phase → parallel-group →
ordered set of AgentRecords (ordered by `startedAt`/dispatch sequence), not a 1:1 label lookup.**
Quality's `warnings[]` emission on fallback is still required (a frame-based-fallback agent is an
observable signal) but it no longer substitutes for a correct join contract. Both are required; the
adversarial fixes the model, quality fixes the observability of degradation.

### Adversarial finding 4 — double-send hazard: harness projected twice / evictable by 50-msg cap
**Status: CONCEDE (gap in quality r1; adversarial closes it).**

Quality r1 §3 named the 50-msg cap and `hasMore` gap but did not address the double-send. The
adversarial is correct: `workflow_agent_log`'s shaping layer must project the `kind:'harness'` event
to the top-level `harness: HarnessDescriptor | null` field AND strip it from the returned `events`
window, so it is (a) sent exactly once, (b) never evicted by the 50-message display cap (since it is
the first event and a naive cap-last-N would drop it), and (c) accessible without scanning the event
stream. Concede and incorporate. The `hasMore: boolean` (or equivalent) on the windowed events
remains a quality-required addition for pagination completeness (§3 below).

### Adversarial finding 5 — direct-fetch gateway: harness-absent (null) vs truthfully-empty harness
**Status: HOLD (observability dimension cannot endorse permanent null for a post-ARCH-044 agent).**

The adversarial defers the non-SDK gateway emission as a non-blocking design-gate leftover. Quality
holds this deferral creates a permanent observability gap: after ARCH-044 ships, `harness: null` on
a direct-fetch agent is indistinguishable from "not yet implemented" vs "this agent ran without a
curated tool surface." The adversarial's own R1 ("a panel that misreports the harness is worse than
none") applies symmetrically — a null that a consumer must interpret as "direct-fetch, tool-surface
unknown" is a misreport of exactly the kind the adversarial named as HIGH severity.

**Quality's position (unchanged from r1):** emit the same `kind:'harness'` event on the
direct-fetch path with `tools:[], skills:[], mcpServers:[]` (truthfully empty — direct-fetch has
no curation loop) and add a `surfaceType: 'curated' | 'none'` discriminant so a consumer knows
whether the empty array means "curation ran and produced nothing" vs "no curation ran." The
`onHarness` hook is ONE call site either way (adversarial's own concession). The one-call-site cost
of truthful empty emission is negligible; the permanent observability debt of a null sentinel is not.

**Tiebreaker if synthesizer defers:** the `surfaceType` discriminant must be specified in the type
now, even if the direct-fetch call site ships in a follow-on. A discriminant field absent from
the initial type definition requires a future breaking change to add; a field present but
`'none'`-valued by default is additive.

### Adversarial finding on `startedBy` absent-value sentinel — `{ type: 'unknown' }` vs coerce-to-`client`
**Status: CONCEDE (explicit sentinel beats silent coercion; aligns with quality r1 §2 intent).**

Quality r1 §2 named the graceful-fallback requirement ("unknown type → generic 'triggered by' label,
never a crash or blank") but proposed it as a display-layer guard. The adversarial is more precise:
the read model must coalesce absent → an explicit `{ type: 'unknown' }` sentinel so a historical or
internal-test run is never mislabeled as `client`. This is the better observability choice — under-
labeling (unknown) is transparent; mislabeling (client) is silently wrong. Concede. The type
remains a closed discriminated union; `'unknown'` is the legal sentinel value for pre-migration rows.
The display-layer guard (quality r1 §2) is unchanged but is now downstream of a model-level
sentinel, not its substitute.

### Adversarial finding on `SessionInitRecord` reconciliation
**Status: ENDORSE (quality r1 missed this; adversarial closes a duplication hazard).**

The adversarial flags that `kind:'harness'` must not overlap with the existing `SessionInitRecord`
(ARCH-017/DES-026) that already carries allowlist/injectedMcpNames/secretHandleNames/modelId. Quality
r1 did not address this. Endorse the reconciliation requirement: either `kind:'harness'` IS the
SessionInitRecord-plus-prompt-plus-skills (supersedes it), or `redactHarness` projects exclusively
from the same resolved values with no field duplication. One event, not two.

### Adversarial `deriveAgentRecords` — run-status-aware agent state (harness ⟹ running vs interrupted)
**Status: ENDORSE and ADD (quality r1 R1 named the atomic-fix requirement; adversarial sharpens the derive rule).**

Quality r1 §4 named the budget-on-crash-resume gap (R3) and bundled it into the ARCH-044 ticket.
The adversarial adds precision on the derive rule: `harness ⟹ running` must be qualified by parent
run status — on an `interrupted`/`suspended` parent, a harness-without-usage agent reads `queued`
(re-dispatches on resume), not `running`. Quality endorses this clarification. The quality-required
budget re-derivation pass (R3) remains: while iterating usage events to build `AgentRecord[]`, also
accumulate `spentTokens` to re-hydrate `RunGuard.spent()`. The adversarial did not contest R3; it
stands.

---

## Final Position by Dimension

### 1. Observability

**Converged points.**

- Harness capture is the most significant observability improvement since v1. The `onHarness` hook
  at the actual curation site (post-`:483` in `claude-agent-sdk-client.ts`) is the only truthful
  emission point. (Quality concedes; adversarial proposed.)
- The `deriveAgentRecords` fix is load-bearing and mandatory-atomic with ARCH-044. The derive rule
  is now: `harness ⟹ running` (if parent run is in-process); `harness ⟹ queued` (if parent is
  `interrupted`/`suspended`); `usage ⟹ done/failed`; neither ⟹ queued (never dispatched).
- Budget re-derivation (quality R3) bundles into the same code path: one pass over usage events,
  two accumulators (`AgentRecord[]` + `spentTokens`). Near-zero incremental cost, closes a named
  real defect.
- Skeleton overlay fallback must emit a `warnings[]` entry when `label+phase` matching fails, even
  after the join contract is corrected (parallel agents may still produce frame-based fallbacks
  in dynamic-label scenarios).
- `warnings[]` appears in BOTH the SVG overlay badge AND the `GET /api/runs/:id/dag` JSON response.
- 4 KB prompt cap uses head+tail (first 2 KB + last 2 KB) with an explicit `"…[truncated]…"` marker.
- `terminalAt?` lives on `RunStatusView` (not a separate DTO); confirmed pass-through to MCP callers
  via ARCH-028.

**Remaining open item (quality holds; adversarial defers).**

Direct-fetch gateway must emit a `kind:'harness'` event with `tools:[], skills:[], mcpServers:[]`
and `surfaceType: 'none'`. The `surfaceType` discriminant field must appear in `HarnessDescriptor`
from the initial type definition, even if the direct-fetch call site ships later. `harness: null`
must not be a persistent post-ARCH-044 outcome for any dispatched agent.

**Deferred (endorsed).**

No distributed trace-ID, no `GET /health` — future-REQ candidates. Both unchanged from r1.

---

### 2. Replaceability

**Converged points.**

- `layoutGraph` input: `SkeletonNode[]` → `LayoutNode[]` via a local adapter function.
  `LayoutNode` is the named seam; if `parseWorkflowSkeleton` evolves, only the adapter changes.
  (Quality holds; adversarial did not contest.)
- `layoutGraph` output: logical `{id, col, row, laneSpan}` grid cells (not device pixels). A
  deterministic cell→pixel mapper in ARCH-043 converts to SVG coordinates. (Adversarial proposed;
  quality concedes and integrates.)
- Morandi palette array lives in a single exported constant or CSS custom-property set — one-source
  swap. `morandiFrameHue(frame: string)` is a pure function: `palette[stableHash(frame) % palette.length]`.
- `GraphPayload` is an internal type — "may change without notice; callers building on
  `GET /api/runs/:id/dag` accept that risk." NOT elevated to a frozen public contract. (Both lenses
  converged at r1; confirmed.)
- `startedBy` enum: adding future trigger types is schema-compatible (new string values do not break
  existing readers). `'unknown'` sentinel for pre-migration rows is a legal union member, not a
  breaking change.
- LLM backend decoupling (`GatewayClient` port, `ProviderProfile` config table) unchanged by Sprint 3.
  Harness capture is gateway-agnostic via the `onHarness` hook.

---

### 3. Consumability

**Converged points.**

- Extending `workflow_agent_log` (not a new route) remains the right call. MCP callers receive
  harness data on a surface they already use. (Both lenses agree.)
- `kind:'harness'` event is projected to `harness: HarnessDescriptor | null` at the shaping layer
  AND stripped from the returned `events` window. Not sent twice; never evictable by the 50-message
  cap. (Adversarial found; quality concedes.)
- `workflow_agent_log` MCP tool enforces the same cap as the HTTP endpoint and includes
  `hasMore: boolean` so callers know when to paginate. (Quality r1 gap, restated; adversarial did
  not contest.)
- Canonical `AgentRecord.state` values (`queued`/`running`/`done`/`failed`) must never cross any
  API boundary as display aliases. `idle`/`completed` are render-time only. Enforced via a
  serialisation-layer unit test for every API response shape.
- Server-side node cap: `layoutGraph` accepts a `maxNodes` parameter (default 200). Output exceeding
  this limit sets `truncated: true` in `warnings[]`. The client-side "N more" affordance is a second
  protection, not a substitute for a bounded server response.
- `HarnessDescriptor.tools` contains tool names only (not schemas). `HarnessDescriptor.mcpServers`
  contains names only (not URLs, which may carry auth tokens). Document in JSDoc: "configured-at-
  dispatch fingerprint, not a schema catalogue; for schemas consult the provisioned MCP registry."
- `surfaceType: 'curated' | 'none'` distinguishes an empty-array-from-curation from empty-array-
  because-no-curation-ran. This is a consumability invariant, not just an observability one: a
  caller who reads `mcpServers:[]` must know whether the gateway ran a curation pass or bypassed it.

---

### 4. Self-sustainability

**Converged points.**

- Budget-on-crash-resume (quality R3, restated): `deriveAgentRecords` fix also accumulates
  `spentTokens` from usage events and re-hydrates `RunGuard.spent()`. Same code path, same
  journal read, same test fixture — near-zero incremental cost.
- `terminalAt?` bounds polling cost for completed runs. Frontend stops polling. Endorsed.
- ARCH-044 journal growth is bounded (≤4 MB per run at 1000-agent ceiling). Confirmed.
- `mcpServers` in `HarnessDescriptor` documented as "configured-at-dispatch, not guaranteed
  reachable." Future `mcpLivenessCheckedAt?: number` field deferred. JSDoc annotation required.
- One-shot sessions have no cross-session memory to metabolise. 4 KB head+tail cap bounds prompt
  footprint regardless of injected context size.
- CAS GC, journal archival, `GET /health` — deferred; `workspace_purge` help text must note that
  purge does NOT free transcript journals.

**Additional self-sustainability note on the `onHarness` hook.**
The hook is an optional callback (`onHarness?`) so it degrades gracefully: a caller that omits it
gets no harness event (the system does not crash; observability simply reverts to the pre-ARCH-044
baseline). This is correct for dry-run test harnesses and the direct-fetch path during any deferral
window. Self-sustainability requires that the absence of the hook never causes a failure — and it
doesn't. The discriminant `surfaceType` and the `harness: null` handling in downstream consumers
must therefore be resilient to null (null is not a regression signal until the hook is wired on all
paths).

---

## Revised Risk Register

Changes from r1: R6 root-cause corrected (not just downstream symptom); R2 surface-type discriminant
now required at type-definition time; new R9 added.

| ID | Description | Severity | Change from r1 |
|----|-------------|----------|----------------|
| R1 | `deriveAgentRecords` fix not shipped atomically with ARCH-044 → in-flight harness events dropped on crash-resume | HIGH | Unchanged |
| R2 | Direct-fetch gateway emits no harness → `harness: null` post-ARCH-044; `surfaceType` discriminant absent from initial type | HIGH | `surfaceType` now required in type even if direct-fetch call site defers |
| R3 | Budget re-derivation not bundled into ARCH-044 `deriveAgentRecords` fix → resumed run silently exceeds cap | MEDIUM | Unchanged |
| R4 | Server-side DAG node cap absent → `GET /api/runs/:id/dag` returns unbounded JSON at 1000-agent ceiling | MEDIUM | Unchanged |
| R5 | Canonical `state` value leaks into API response as display alias → MCP callers see two state vocabularies | MEDIUM | Unchanged |
| R6 | Join contract `(label+phase)` is 1:1 → two same-label parallel agents collapse into one box, one vanishes | MEDIUM | Root cause corrected: join must be phase→group→ordered-set, not 1:1; `warnings[]` on fallback is still required downstream |
| R7 | 4 KB prompt cap is head-only → task instruction at tail always truncated | LOW | Unchanged |
| R8 | `mcpServers` presented without reachability caveat | LOW | Unchanged |
| R9 | `kind:'harness'` event not stripped from `events` window → double-sent + evictable by 50-msg cap | MEDIUM | New from adversarial finding 4 |

---

## Remaining Disagreements After Round 2

**One live disagreement:**

**R2 / Direct-fetch gateway harness** — Quality holds that `harness: null` must not be a permanent
post-ARCH-044 outcome; adversarial defers the direct-fetch call site. Tiebreaker for the synthesizer:
the `surfaceType` discriminant field must appear in `HarnessDescriptor` from the initial type
definition regardless of which emission schedule wins. This is the minimum that keeps both options
open without a future breaking change.

**Converged everywhere else:**
- `onHarness` hook at the real curation site (concede from quality).
- Logical grid cells from `layoutGraph` + `LayoutNode` input adapter (integrated from both).
- `{ type: 'unknown' }` sentinel for absent `startedBy` (concede from quality).
- Double-send / cap-eviction fix: project-to-top-level + strip-from-events (concede from quality).
- Parallel join contract: phase→group→ordered-set (concede from quality; root cause not symptom).
- `SessionInitRecord` reconciliation: one event, not two (endorse from quality).
- Budget re-derivation (quality R3): adversarial did not contest; quality holds.

---

## Task-Splitting Notes (updated)

These augment r1's task-splitting notes with round-2 resolutions.

**ARCH-041.** Schema migration must include a nullable `startedBy` column with default NULL.
Read model coalesces NULL → `{ type: 'unknown' }` sentinel. Display layer handles `'unknown'` as
"triggered by (unknown)" — never a crash or blank. Regression test includes one pre-migration row
asserting the sentinel coalescion.

**ARCH-042.** `layoutGraph` signature: `(nodes: LayoutNode[], opts?: { maxNodes?: number }) =>
{ cells: LayoutCell[]; edges: LayoutEdge[]; warnings: string[]; truncated?: boolean }`. `LayoutNode`
is the adapter type over `SkeletonNode`. `LayoutCell` carries `{ id, col, row, laneSpan }`, not
pixels. Join contract is explicitly stated as phase→group→ordered-set in the implementation comment.

**ARCH-043.** Cell→pixel mapper is a pure function in the renderer module: `cellToPixel(cell:
LayoutCell, boxSize: BoxSize): Rect`. `morandiFrameHue` is pure and unit-tested. All run-derived
strings set via `textContent`, including SVG `<text>` elements.

**ARCH-044.** Single implementation ticket, now six atomic concerns: (a) `deriveAgentRecords` fix
(drop `if (!usage) continue`; apply run-status-aware state rule); (b) budget re-derivation pass;
(c) `onHarness` hook wired on SDK path; (d) 4 KB head+tail cap with marked boundary; (e) latest-
wins dedupe by agentId; (f) `SessionInitRecord` reconciliation (one event, not two). Direct-fetch
`onHarness` call site is a required follow-on (not a blocker) — but `surfaceType` discriminant
must appear in `HarnessDescriptor` from this ticket.

**ARCH-045.** `workflow_agent_log` shaping: project `kind:'harness'` to top-level `harness` field,
strip from events window, never evictable by cap. Add `hasMore: boolean`. Canonical state in all
API responses enforced by serialisation UT. Headless DOM assertion covers harness panel including
tool names, skill names, MCP server names — all via `textContent`.
