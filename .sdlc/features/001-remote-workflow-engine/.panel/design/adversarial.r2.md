# Design panel — Adversarial group (r2, responses) · v11 Sprint 3 (REQ-071..073 / ARCH-041..045)

> Lens: three sub-lenses that trade off — **(a) Interface-contract**, **(b) Boundary/error**,
> **(c) Testability** (every DES a UT can cover; clock/storage injectable). Tie-breaker =
> **Karpathy simplicity-first**. This round is a **delta over adversarial.r1.md** answering
> quality-dimensions.r1.md (the only other lens on record). I do not restate r1; I record what
> converged, what I concede/reshape/hold, and the final position as *changes to r1*.

## 0. This round reads as convergence, not capitulation

The two disagreements I flagged hottest in r1 were **pre-conceded** by quality before this round:

- **GraphPayload stays an internal seam** (my r1 §"Expected disagreements" #1). Quality §2 endorses
  it as "not a frozen public contract… Karpathy-consistent." **Closed, no dispute.**
- **Budget re-derivation as a separate ticket** is acceptable to quality ("If adversarial holds for a
  separate ticket, that is acceptable — but the fix must be gated to land before Gate 7.5"). We
  differ only on *mechanism*, not on whether/when. **Reshaped below, not disputed.**

So this is a **zero-hard-rebut round**. Every quality r1 item is a concede or a concede-with-reshape;
the only genuine open items are three points quality's r1 **did not address**, carried to the
synthesizer as open questions rather than conflicts.

## 1. Converged (concede, integrate verbatim into the DES set)

These quality r1 additions are correct under my lens and I adopt them:

- **maxNodes server cap on `layoutGraph`** (quality R4). Concede — this *is* the payload/DoS bound my
  r1 R3 wanted on the no-auth plane, at the model seam instead of only the renderer. **Pin the
  numbers equal:** server-side `maxNodes` default = client "N more" ceiling = **200**, one shared
  constant, `truncated:true` surfaced in `warnings[]`. Two protections, one number, no drift.
- **Silent-fallback → `warnings[]` entry** (quality R6). Concede — this is exactly my r1 DES-064
  divergence fallback made *observable*. A live agent that misses the skeleton join and falls to
  frame grouping must emit `warnings:["agent <id> unmatched to skeleton: frame-grouped"]`. Zero cost,
  closes the opaque-degradation gap.
- **`warnings[]` in both JSON and SVG** (quality §1). Concede — SVG-only hides it from MCP callers;
  JSON-only hides it from the operator watching the dashboard. Both surfaces.
- **head+tail 4KB truncation with a marked boundary** (quality R7). Concede over my r1 head-only cap —
  task instructions land at the tail in the context-injection pattern; 2KB head + 2KB tail +
  `"…[truncated]…"` marker keeps the ≤4KB DoS bound while preserving the observability payload.
- **Canonical-state serialization UT** (quality R5). Concede — reinforces my r1 DES-067/068 render-time
  alias map. `state` on **every** JSON response (`workflow_status`, `workflow_agent_log`,
  `GET /api/runs/:id`) carries only `queued|running|done|failed`; `idle`/`completed` exist **only** at
  render time. Enforce with a serialization-layer UT per response shape.
- **`hasMore` on the `workflow_agent_log` MCP tool** (quality §3). Concede — my r1 added `?limit&offset`
  to the HTTP path; the MCP tool needs the paired `hasMore` so a caller who gets 50 knows whether more
  exist. Same 50-cap on both surfaces.
- **`mcpServers` JSDoc caveat** (quality §4 / R8). Concede — annotate the field
  "configured-at-dispatch, names only (never URLs — URLs may carry tokens), not liveness-checked."
  Consistent with my r1 names-only `redactHarness` invariant.

## 2. Concede-with-reshape (I accept the goal; I change the mechanism on lens grounds)

### 2.1 Direct-fetch harness (quality R2, HIGH) — **CONCEDE, with a sharpened null contract**
I deferred this in r1 as "no REQ forces it." Quality is right that deferring leaves `harness:null`
**overloaded** — a consumer cannot tell "capture unimplemented on this path" from "agent ran with no
tool surface." That ambiguity is itself an observability defect, and the fix is cheap because it is
the **same `onHarness` hook** (my r1 seam). **I fold my defer.** Final contract, tighter than either
r1:

- **Rule:** every agent **dispatched** after ARCH-044 ships emits a non-null harness event.
  `harness === null` ⟺ **the agent was never dispatched** (queued/idle) — one meaning, unambiguous.
- **`surfaceType: 'curated' | 'none'`** on `HarnessDescriptor` distinguishes the SDK curated-tool path
  (`'curated'`) from the direct-fetch/LiteLLM path that has no tool loop (`'none'`, with
  `tools/skills/mcpServers = []`). `model` + status are always present on both.
- **Call-site correction to my r1.** My r1 said "one `onHarness` call site either way" — conceding R2
  makes it **one hook, two call sites**: `ClaudeAgentSdkGatewayClient` invokes it post-curation
  (`:483`), the direct-fetch client invokes it with `surfaceType:'none'` at its own model-resolution
  point. Same optional hook, same pure `redactHarness`, two callers.

### 2.2 Budget-on-crash-resume (quality R3, MED) — **CONCEDE the defect + this-sprint timing; REBUT the placement**
Quality's mechanism has `deriveAgentRecords` "re-hydrate `RunGuard.spent` while iterating usage
events." That makes a **pure read-model function mutate a live guard** — a direct hit on my testability
lens (the function stops being a pure fold you can UT with a fixture; it now has a side effect on
shared state). I concede the defect is real and worth closing this sprint; I reshape *where* it lands:

- The derive pass (or a sibling **pure fold** over the same journal events) **returns** an accumulated
  `spentTokens`; the **resume path** — not the read-model — hydrates `RunGuard`. Purity of the record
  builder is preserved; the guard mutation lives at the one impure resume seam that already exists.
- **Its own task, its own IT**, sharing the same journal read as the deriveAgentRecords change, **gated
  before Gate 7.5**. This is precisely the separation quality pre-accepted.
- **Boundary quality missed (my adversarial add):** a **double-count test across the snapshot+journal
  seam** — usage already reflected in a REQ-055 snapshot must **not** be re-added when journal events
  are replayed on resume. Without this the "fix" can over-count `spent` and *under*-run a resumed
  workflow. Name it in the DES.

### 2.3 `LayoutNode` adapter (quality §2) — **CONCEDE the narrow input type; REBUT the parser-swap framing**
Quality wants a `LayoutNode` adapter so a future `parseWorkflowSkeleton` swap touches only the adapter.
Karpathy tie-break: a **parser-swap abstraction is speculative** (one in-tree parser, no second one on
the horizon). But `layoutGraph` should consume **only the fields it actually uses**, not the whole
`SkeletonNode` — and that narrow structural input type **is** the adapter, with no framework attached.
This is quality's own stated minimum-acceptable outcome ("`layoutGraph`'s signature references [a
narrow type], coupling documented"). **So we converge:** narrow input type = the seam; no
future-proofing layer; coupling documented as an acknowledged design dependency. Closed.

### 2.4 `chain` display label (quality §2 leftover) — **CONCEDE** (I had deferred it)
My r1 kept the `chain` *enum value* required-now but **deferred its display label**. Quality resolved
the leftover concretely: source node shows `"chain via <startedBy.id[0..7]>"` via `textContent`,
degrading to `"chain"` when no id. That is one string template, honors my `textContent`-only invariant,
and closes a leftover more cheaply than carrying a deferral. **Adopt it.** (My r1 `{type:'unknown'}`
sentinel for *absent* `startedBy` stands and composes cleanly — `unknown` = no provenance at all;
`chain` = provenance present, parent id shown.)

## 3. Final position — net changes to adversarial.r1.md

Everything in r1 stands **except** these deltas:
1. Direct-fetch path **emits** a harness (was: deferred). Null now means "never dispatched" only;
   `surfaceType:'curated'|'none'` added to `HarnessDescriptor`; **two** hook call sites.
2. Prompt cap is **head+tail 2KB/2KB with a marked boundary** (was: head-only).
3. `layoutGraph` gains **`maxNodes` default 200 == client "N more" ceiling**, `truncated` in
   `warnings[]`; input is a **narrow structural type** (adapter-as-seam, no parser-swap layer).
4. Fallback and truncation both **populate `warnings[]`**, surfaced in **JSON and SVG**.
5. Budget re-derivation added **this sprint as a separate task** — pure fold returns `spentTokens`,
   resume path hydrates the guard, **plus a snapshot/journal double-count boundary test**.
6. `chain` node label adopted (`"chain via <id[0..7]>"`, `textContent`, degrades to `"chain"`).
7. `hasMore` on the MCP `workflow_agent_log`; canonical-state serialization UT; `mcpServers` JSDoc
   caveat — all adopted.

## 4. Remaining open items — **unaddressed in quality r1**, carried to the synthesizer

These are *not* disagreements (quality took no position); they are r1 adversarial findings still awaiting
a design-gate decision:

- **H1 — logical cells vs literal pixels (r1 DES-064).** ARCH specifies `{x,y,width,height}`; I hold
  that `layoutGraph` should emit `{col,row,laneSpan}` and a thin cell→pixel mapper (ARCH-043) does
  geometry, so the pure UT asserts topology/ordering, never pixels, and a box restyle breaks **zero**
  model tests. Composes with §2.3's narrow input type. **Synthesizer decision needed** (adopt cells, or
  require the UT to assert relative ordering only if pixels stay in the model).
- **H2 — SessionInitRecord vs `kind:'harness'` (r1 DES-066).** ARCH-017/DES-026's `SessionInitRecord`
  already carries allowlist/injectedMcpNames/secretHandleNames/modelId at build time. **One event, not
  two:** either the harness event *is* that record + prompt + skills, or `redactHarness` projects from
  the same resolved values. Emitting two overlapping records is an interface-cleanliness defect.
  **Synthesizer must pick the single source.**
- **H3 — run-status-aware `harness ⟹ running` derive rule (r1 DES-066).** The raw rule paints a live
  spinner on a **dead** run: after kill-9 a run reclassifies `running→interrupted`, but a
  dispatched-but-unsettled agent would still read `running`. The derive rule must be status-aware —
  on an `interrupted`/`suspended` parent a harness-without-usage agent reads **`queued`** (it
  re-dispatches on resume), only an in-process run shows `running`. This is a required refinement to
  quality R1's deriveAgentRecords fix (quality mandated the fix but not the status-awareness).

## 5. Risk delta (from r1)
- r1 **R1/R2/R3** (panel lies / running-empty / secret-to-DOM) unchanged — still the top three, still
  mitigated by the `onHarness` real-resolution seam + eager append + two-tier no-secret proof.
- **New (from §2.2): budget over-count on resume** — MED — if re-derivation double-counts across the
  snapshot/journal seam a resumed run under-runs its cap. *Mitigation:* the double-count boundary test.
- r1 **R4/R5/R6/R7** unchanged; R4 (vanishing parallel agent) now also carries the `warnings[]` signal
  from §1.
