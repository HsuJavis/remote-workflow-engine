---
lens: adversarial (Security / Scalability / Testability, Karpathy simplicity as tie-breaker)
round: 2 (debate — responses + convergence)
author: adversarial architecture group
scope: v11 Sprint 3 — REQ-071 / REQ-072 / REQ-073 (n8n-style graph dashboard, Morandi theme, harness detail, no-secret rule)
date: 2026-08-09
---

# Architecture — Adversarial group — Round 2 (responses / convergence)

I read `quality-dimensions.r1.md` in full and re-ran the two empirical checks my own r1 left to
"the design gate." **Both checks moved my position.** The transcript cannot yield the harness, and the
live DAG cannot express parallel groups — so two of my r1 stances (K2 "derive-preferred", K1
"layoutGraph over DagModel") do not hold as written. I concede those and integrate Quality's G4 and
G2, with security/scalability refinements that make the merged design cheaper and restart-safe.

**Evidence gathered this round (grep + read of live code, not memory):**

- `TranscriptEvent.kind` (`src/types.ts:152`) = `'message' | 'tool_call' | 'tool_result' | 'usage'`.
  `extractEvents` (`claude-agent-sdk-client.ts:373`) captures only text/tool_use/tool_result. **The
  prompt and the granted tool/skill surface are never journaled.** REQ-073 asks for the *resolved
  harness* surface (`AgentOpts.mcp` + agent definition + curated tools) — i.e. tools *granted*, not
  tools *called*. Derive-from-transcript is therefore impossible: my r1 K2 branch is dead.
- `DagNode` (`dashboard.ts:27`) = `{kind, frame, depth, agents, children}` — **no parallel-group
  structure**; `buildDagModel` groups only by composite frame. `SkeletonNode` (`workflow-meta.ts:40`)
  carries `kind: parallel`. REQ-071 requires drawing "2 parallel agents → Verify" edges and names
  "a run (live or finished) **or a workflow skeleton**" as graph inputs. The skeleton is the *only*
  source of parallel topology. My r1 K1 (`layoutGraph(dagModel)`) was insufficient.
- The SDK gateway `_drain` (`claude-agent-sdk-client.ts:585`) **accumulates events into a local array
  returned at settle** — the transcript is persisted in a batch *after* the agent finishes, not live.
  `AgentTranscriptSink` (`agent-executor.ts:104`) already has `markQueued`, an *eager* pre-gateway
  write. This determines the harness write path (below).

---

## Responses to quality-dimensions (rebut / concede / hold)

### D1 — Harness capture: derive (my K2) vs capture-at-dispatch (their G4) → **CONCEDE, and integrate**
My r1 preferred deriving harness from the transcript. **The transcript carries neither the prompt nor
the granted surface** (evidence above), and REQ-073 wants the *resolved* surface. I concede: harness
**must be captured at dispatch**, as Quality's G4 says. Names-only for tools/skills/mcpServers (their
G4b == my K3) and a 4 KB prompt cap (their G4a == my K5, concretized) — agreed.

**But I hold my R3 (do not fatten the durable AgentRecord / runs table with prompts) and reconcile it
with G4 by changing the storage mechanism**: capture the harness as a **new `TranscriptEvent`
`kind: 'harness'`**, written as the agent's **first journaled event**, not as a new column on the
`runs` table and not as a fattened `AgentRecord` on the terminal snapshot. This is strictly better than
G4's "write to `AgentRecord`, ride the REQ-055 snapshot":

- **Restart-safe for in-progress runs.** Quality's own G1 notes the REQ-055 snapshot fires at
  *terminal* — too late. The append-only `agent-<id>.jsonl` journal replays on restart (REQ-059/060),
  so a harness journaled at dispatch survives a mid-run crash; a snapshot-borne one would not.
- **No new durable schema.** No `runs` column, no snapshot shape change — it rides the transcript path
  that already exists. Keeps harness a *pure projection of the transcript* (my K2 aesthetic survives,
  just via an explicitly-journaled event rather than a not-captured SDK init message).
- **Consumability for free (their G9).** `workflow_agent_log` already returns transcript events, so a
  `harness` event flows to programmatic MCP callers with **zero new tool and zero response-schema
  proliferation** — this satisfies G9 more cheaply than G9's own "extend the response with a separate
  harness field." Named as a win, not a concession.

Four mechanics I pin now so round 3 can't unpick them:

1. **`deriveAgentRecords` must change (required, not assumed).** `run-store.ts:18` does
   `if (!usage) continue` — a dispatched-but-unsettled agent is **dropped** on snapshot-less restart.
   The derive function must yield a `queued`/`running` record from a `harness` event that has no
   `usage` event yet. (Bonus: this also fixes the current fallback path silently losing in-flight
   agents on restart.)
2. **Capture point = the SDK gateway session-build, not the executor.** The executor knows
   `effectivePrompt` + frontmatter `allowedTools`, but the *resolved* surface only exists inside the
   gateway after `curateToolsForProvider` (`claude-agent-sdk-client.ts:214`) and MCP `resolveInjected`.
   REQ-073 says "resolved harness"; capturing pre-curation would show tools the provider filter
   removed. The gateway emits the `harness` event (post-curation `tools`, resolved MCP *names*, model,
   capped prompt) via the existing `AgentTranscriptSink`. The direct-fetch/LiteLLM gateway emits its
   own resolved surface, or emits harness-absent (panel shows model + status only) — design-gate pins
   which, but the seam is one sink call either way.
3. **Write eagerly at session-build (one `appendTranscript`), not batched at settle.** `_drain`
   returns events only when the agent finishes; a harness pushed into that local array would be
   invisible until settle — clicking a *running* agent would show nothing, and a crash would lose it.
   Emit the harness event eagerly (mirroring `markQueued`, `agent-executor.ts:116`) the moment the
   session is built. This is what makes REQ-073's "clicking a running agent shows `running` + harness"
   actually hold.
4. **Dedupe + queued state.** The executor's bounded retry loop (`agent-executor.ts:183`) can build a
   session more than once → multiple harness events per agent; **latest wins** at projection. A
   *queued* agent has no harness event yet — REQ-073's observable only requires `idle` for queued, so
   that is **intended**, not a gap.

### D2 — No-secret rule: capture-time (their G4b/G17) vs render-time redaction (my K3) → **CONVERGE**
Quality argues the strongest control is capture-time (store *names*, never configs → nothing to
scrub); I argued a server-side redactor + two-tier proof. These are complementary and Quality already
conceded a render-time scrub is "cheap to add." **Converged mechanism: capture-time is primary** — the
`harness` event contains only names + model + capped prompt, so resolved secrets never enter the
record and a client bug cannot render one. I concede capture-time (not render-time) is the primary
mechanism.

**I hold the two-tier PROOF regardless of mechanism** (my C2): (1) a unit test on the pure
`harness-event → API payload` mapper asserting no resolved config/plaintext, and (2) **one
headless-browser real-run asserting the rendered DOM contains no secret plaintext**. Capture-time
purity cannot catch a *future* `innerHTML` regression that reintroduces a leak between payload and
pixel; only the DOM assertion does. Testability does not get to skip the real-run.

**Prompt-smuggling limitation (their G17 / expected-disagreement) → CONCEDE as an accepted VM-sandbox
limit.** A workflow script *can* pass a secret VALUE as a prompt string; the harness prompt captures
whatever the script passed, at the same trust level as the transcript (which already echoes model
output). The 4 KB cap bounds volume. Precise invariant: **the engine never *substitutes* a REQ-018
`${secret:}` into a prompt** — script-authored plaintext is the author's own boundary, not an engine
leak. Agreed, not a novel gap.

### D3 — Trigger provenance `startedBy` (my K6/R5 vs their G1/G10) → **CONVERGE; my K6 hole dissolved**
Both flagged it. Quality's `startedBy: { type: client|webhook|schedule|chain, id? }` **includes
`chain`** — that resolves my r1 K6 enumeration hole (chain-spawned continuations mapped to none of
`client|webhook|schedule`). Accept in full: set at `RunManager.start()` by each caller, persisted in
the **`runs` table** (their G1 is right that the terminal snapshot is too late — the source node must
render for in-progress runs; this also matches my r1 "set at `start()`"), surfaced in
`workflow_status` + `GET /api/runs/:id` (their G10). REQ-071's source-node label only enumerates
client/webhook/schedule, so `chain` needs a display-label decision (design-gate), but the enum value
exists so a chained run **cannot throw** — my R5 risk is closed.

### D4 — Shared graph input / `GraphPayload` (their G5/G11) + skeleton overlay (their G2) → **PARTIAL CONCEDE**
My r1 said "extend `/dag`, minimum surface." REQ-071 **names the skeleton as a first-class graph
input**, and the skeleton is the **only** source of parallel-group topology (evidence above), which
REQ-071's acceptance *requires*. So the renderer genuinely must consume both skeleton and live-run —
**not speculative**. I concede:

- **CONCEDE the shared internal type + single `renderGraph(payload)`** consuming both a skeleton and a
  live-run payload. This is the minimum that satisfies "a run **or** a workflow skeleton."
- **CONCEDE their G2 Option A (skeleton-as-topology overlay)**: use `SkeletonNode[]` for structure
  (phases, parallel groups, edges) and annotate with live `AgentRecord` state by a `label+phase` key.
  My r1 `layoutGraph(dagModel)` couldn't draw parallel edges; the skeleton can.
  - **Adversarial check Quality skipped (my lens's job):** the skeleton is a *static scan* — runtime
    diverges (loops, conditionals, args-dependent agent counts, dynamic labels break the `label+phase`
    match). **Pin the fallback so Option A has no correctness hole:** unmatched *live* agents fall back
    to frame-based DAG grouping (`buildDagModel`) and still render; unmatched *skeleton* nodes render
    inert (predicted, not-yet-run). Never drop a live agent because the skeleton didn't predict it.
- **HOLD against G11's "make `GET /api/runs/:id/dag` *become* `GraphPayload` as a stable contract +
  migrate."** Karpathy: keep `GraphPayload` an **internal render seam**, one shared type behind one
  `renderGraph`. Do **not** freeze it as a versioned public API contract or migrate the existing
  `/dag` shape for consumability this sprint. Internal seam, not public contract.

### D5 — SSE vs 3s poll → **already converged.** Both say poll for Sprint 3, SSE deferred. No dispute.

### D6 — Layout: CSS flexbox tree (their G7) vs SVG (my r1) → **REBUT with citation, then converge**
This is a rebut, not a preference. REQ-071 acceptance requires **edges** ("connected by edges") *and*
**pan/zoom** ("the canvas pans/zooms"). **CSS flexbox draws neither** diagonal edges nor a pan/zoom
canvas — G7 as written **fails REQ-071 acceptance**. Converge on the cheap middle: a **pure,
flex-like position computation** (columns by phase → parallel-group → nesting; no force-directed
physics, no external lib) feeding an **SVG edge + `<text>` layer**, with **every run-derived string
set via `textContent`** (my K4/R2, uncontested — reaffirmed). This keeps Quality's "simple layout, no
Cytoscape/D3" (their G7 == my C1) *and* satisfies the edges/pan-zoom acceptance.

### D7 — Self-sustainability nits
- **G16 deterministic frame color → CONVERGE** (their G16 == my K7/R7): `stableHash(frame) %
  paletteLength`, pure, no flicker across polls. Morandi palette as CSS custom properties (their G6) —
  fine, harmless, makes a swap one-file.
- **G15 (client-side `buildDagModel` recompute + topology cache) → HOLD.** Speculative for Sprint 3:
  typical dev has 1-2 tabs on loopback, and the poll already replaces the prior (no queue builds).
  Moving DAG construction into the browser duplicates server logic and costs testability. Keep
  `buildDagModel` **server-authoritative**. Quality themselves demoted this to "a gate-2 decision" —
  so: not architecture-load-bearing, defer. `terminalAt?` to stop polling completed runs (their G12) —
  accept, trivially cheap.
- **G3 `warnings[]` for unattached agents → ACCEPT as cheap.** Harmless observability aid; add it
  since `buildDagModel` already detects the unattached case. Not load-bearing.

---

## Final position (the converged minimum)

1. **`trigger`/`startedBy: { type: client|webhook|schedule|chain, id? }`** on the run record,
   persisted in the `runs` table at `start()`, surfaced in status + `/api/runs/:id`. (D3)
2. **Harness captured at gateway session-build as a `kind:'harness'` `TranscriptEvent`**, written
   **eagerly** (one `appendTranscript`, mirroring `markQueued`), **names-only** tools/skills/mcp,
   **4 KB-capped** prompt, **latest-wins** dedupe. `deriveAgentRecords` updated to yield a
   queued/running record from a harness-without-usage event. No `runs` column, no snapshot bloat. (D1)
3. **No-secret = capture-time primary + two-tier proof** (pure-mapper unit test + one headless DOM
   no-plaintext assertion). (D2)
4. **One shared internal `GraphPayload` + `renderGraph`** consuming skeleton *or* live-run;
   **skeleton-as-topology overlay** for parallel groups, with the static-vs-runtime divergence
   fallback pinned (live agents always render; unmatched skeleton nodes render inert). Internal seam,
   not a frozen public contract; no `/dag` migration. (D4)
5. **Pure flex-like layout → SVG edge/text layer, `textContent` throughout**, no external graph lib;
   3s poll, no SSE; deterministic per-frame Morandi hue; cap rendered nodes with "N more" (my r1 K5,
   uncontested). (D6, D5, D7)

## Internal conflicts within my three lenses (restated for round 2)

- **C1 — Security ⟂ Richness (Simplicity).** n8n look tempts a vendored graph lib + `innerHTML`.
  **Resolved:** hand-rolled SVG over a pure layout; all text via `textContent`. Richness yields; here
  security, simplicity, and Quality's G7 "no external lib" all align.
- **C2 — Security ⟂ Testability.** Capture-time redaction proves the *function*, not the *whole path*.
  **Resolved:** keep both proof tiers; the headless DOM assertion is the only thing that catches a
  future `innerHTML` regression capture-time purity cannot.
- **C3 — Scalability ⟂ Simplicity.** 1000-node ceiling argues virtualization; typical runs are tiny.
  **Resolved (Karpathy):** cap + "N more", not a windowing engine; and reject G15's client-side DAG
  recompute as speculative.
- **C4 — Agent-observability ⟂ the unauthenticated read plane.** Harness (prompt + resolved surface)
  is the richest, most sensitive payload the dashboard has ever exposed, on an unauthenticated,
  reverse-proxy-forwardable (REQ-070) plane. **Resolved:** redact at capture *regardless* of the
  trusted-loopback assumption (defense-in-depth); do **not** invent auth here (D5 defers it — inventing
  it violates scope and Karpathy).
- **C5 (new this round) — Security ⟂ Testability, at the capture seam.** Security wants *post-curation*
  capture, which lives inside the impure SDK gateway (`curateToolsForProvider` + `resolveInjected`);
  testability wants a pure seam. **Resolved:** accept the impure emission point (the gateway, via the
  existing `AgentTranscriptSink` — one eager sink call), but keep the *projection* `harness event → API
  payload` a **pure, unit-tested mapper**. Impurity is confined to one line at session-build; the
  security-load-bearing transform stays pure and testable.

## Remaining disagreements (unconverged)

1. **G15 client-side `buildDagModel` recompute + topology caching.** I **hold**: server stays the
   authoritative DAG source for Sprint 3; the optimization is speculative for a 1-2-tab loopback dev
   and costs testability. Quality already demoted it to "gate-2" — likely resolvable there, not a
   direction conflict.
2. **`GraphPayload` as a public, versioned API contract with a `/dag` migration (their G11).** I
   **hold**: internal render seam only this sprint. Small-stakes, scoping disagreement — I concede the
   *type exists and is shared*; I dispute *elevating and freezing it as public API* now.

Everything else (harness capture, skeleton overlay, `startedBy` enum incl. `chain`, no-secret,
poll/no-SSE, no external lib, SVG-not-flexbox, deterministic hue, `terminalAt`, `warnings[]`) is
**converged**.
