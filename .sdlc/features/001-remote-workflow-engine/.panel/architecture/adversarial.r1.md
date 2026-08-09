---
lens: adversarial (Security / Scalability / Testability, Karpathy simplicity as tie-breaker)
round: 1 (independent proposal)
author: adversarial architecture group
date: 2026-08-09
---

# Architecture — Adversarial group — Round 1 (independent)

**Scope under review:** v11 **Sprint 3 — REQ-071 / REQ-072 / REQ-073**: an n8n-style **graph
observability dashboard** on a Morandi light palette — a trigger source node → agent boxes → edges
(REQ-071), composed sub-workflows drawn as distinct tinted, labeled frames (REQ-072), and a
**clickable agent box → harness detail** panel (model, prompt, tool list, skill list, live status),
with the hard invariant **"NO secret/token VALUE is ever shown"** (REQ-073).

> Scope note for the synthesizer: I judged the current slice from the requirements (the Sprint-4
> staging comment scopes "the full-flow architecture gate … only to Sprint-3 graph-UI REQs
> (REQ-071..073)") and state.yaml (Sprint 2 REQ-068..070 already past Gate 5). This file
> **replaces** the Sprint-2-scoped residue that previously sat at this path — it is a fresh round for
> the graph-UI slice, not a stale Sprint-2 doc.

**Lens-template caveat (stated up front):** my lens carries auth-flavored examples (brute force, JWT
forgery, timing attacks, failure-count consistency). **None of them apply to this slice.** This is a
**read-only** dashboard increment; authentication stays deferred by user decision D5 (bind
127.0.0.1 + Host/Origin allowlist REQ-056 as the interim control). I deliberately do **not** invent
auth content. The real security surface here is **XSS + secret leakage on an unauthenticated read
plane**, and I judge the slice against that.

**Altitude judgment (system vs agent):** this slice spans **both** altitudes and they must be named
separately, because a reviewer who collapses them will miss the leak:

- **What is observed = agent altitude.** The payload is the agent harness itself — model, the prompt
  the agent ran, its resolved tool + skill surface, its live state/tokens. The dashboard's job is to
  make the *agent system* **observable** and **consumable** to a human operator. The quality that
  matters is agent-observability: can an operator understand what a sub-agent actually did.
- **How it is delivered = system altitude.** HTTP routes, DOM rendering, the net-guard, payload
  bounds. XSS, secret redaction, and DoS live here.

The single most dangerous consequence of this split: the **agent-altitude payload is the richest,
most sensitive data the dashboard has ever surfaced** (prompts + resolved harness), and it is being
piped onto the **system-altitude unauthenticated read plane**. Every risk below is a variant of that
one sentence.

---

## Summary

REQ-071..073 is, architecturally, **90% a render layer over data that already exists** and **10% two
small, security-load-bearing data additions**. The reusable substrate is real and should not be
rebuilt: `buildDagModel` (REQ-048, pure, in `src/dashboard.ts`), the frame model
`WorkflowNodeView{frame,parentFrame,depth}` (REQ-045/046), cross-restart persistence (REQ-055),
per-agent timing (REQ-050/051), and `AgentRecord{model,state,tokens,frame,label,phase,...}`
(`src/types.ts:51`). The global Host/Origin gate (`src/server.ts:1097`) already sits above all
routing, so new `/api/*` routes inherit it for free.

The minimum architecture is therefore: **(1)** a pure graph-model extension (add a *trigger source
node* + left-to-right edge/positions to the existing DAG model), **(2)** a pure Morandi
frame→hue assigner, **(3)** a pure **harness-detail mapper that redacts by construction** (serves
names + `${secret:}` handles only, never resolved values, payload-bounded), **(4)** thin GET routes
below the existing net-guard, **(5)** hand-rolled SVG/DIV rendering with every run-derived string set
via `textContent`. **No graph library, no SSE, no auth, no new persistence engine.** Two data
additions are unavoidable and both are decisions the design gate must pin, not hand-wave: **trigger
provenance** on the run record, and **where harness detail comes from** (derive-from-transcript vs.
capture-a-names-summary).

---

## key_points

### K1 — Reuse the pure DAG model; add only a source node + a deterministic layout (Karpathy)
`buildDagModel` already reconstructs the frame-nested tree. REQ-071's "trigger source node →
agent boxes → edges" is an *additive* transform on that tree: prepend one source node, assign
left-to-right column positions by phase → parallel-group → nesting depth. Keep this a **pure
function `layoutGraph(dagModel, trigger) → {nodes:[{id,x,y,kind,...}], edges}`** — no force-directed
physics, no DOM. This is unit-testable without a browser and is the Karpathy-minimum for the n8n
look. Rendering (SVG/DIV) is a dumb consumer of that pure layout.

### K2 — Harness-detail is a **pure redacting mapper**, and its data source is a *decidable* question
REQ-073 needs per-agent model + prompt + tool list + skill list + live status. `AgentRecord` today
carries none of prompt/tools/skills. Two options, and the choice is not a coin flip — it is settled
by one check the design gate must run:

- **Derive (preferred if it holds):** REQ-016 states the curated tool surface is "observable in the
  session init," and `workflow_agent_log(runId, agentId)` already returns the full transcript. **If
  the journaled transcript carries the session-init tool/skill surface + the prompt**, then harness
  detail is a *pure projection of the transcript* — **zero new persistence, zero REQ-055 snapshot
  schema change.** This is the Karpathy answer.
- **Capture (fallback):** if the transcript does *not* carry the init surface, add a **names-only**
  `harness?: {tools:string[], skills:string[]}` summary captured at dispatch. Names only — small,
  and it must ride the REQ-055 snapshot to survive a restart.

**Decision rule for the design gate:** inspect the persisted transcript for the session-init tool
surface; derive if present, capture-names-only if not. **Do NOT duplicate the full prompt into
`AgentRecord`** — prompts are unbounded, and duplicating them inflates every journal + snapshot
(see R3). The prompt is fetched from the transcript, windowed (K5).

### K3 — Redaction is an invariant, proven at two tiers (the core security control)
The harness-detail endpoint serves **names and `${secret:}` reference handles ONLY — never resolved
MCP env/config, never a provider key, never a resolved secret value** (extends REQ-018 / REQ-028
secret-separation onto the observability plane). Architecturally this is a **pure server-side
redactor**: resolved secrets never leave the process, so a client bug cannot render one. Prove it at
two tiers, and both are needed for distinct reasons:

1. a **unit test on the redactor** — given a harness config containing a resolved secret and a
   `${secret:}` handle, the mapper output contains the handle and never the plaintext (proves the
   *function*);
2. **one headless-browser real-run** asserting the rendered DOM contains no secret plaintext
   (proves the *whole path* — that nothing leaks between mapper and pixel).

### K4 — Every run-derived string renders via `textContent`, even inside SVG (XSS)
Agent labels, model ids, workflow names, tool/skill names, and especially the **prompt** are
attacker-influenceable (a workflow author, a webhook `args.event` payload, or agent-produced text).
The existing dashboard convention is textContent-only (REQ-067 established it). Extend it verbatim to
the graph: **no `innerHTML` of any run-derived string; SVG `<text>` and DIV labels set via
`textContent`.** This is the concrete resolution of the security-vs-richness tension (C1).

### K5 — Bound every payload (the prompt is the DoS vector, not the node count)
Prompts can be arbitrarily large. The harness-detail endpoint must **window/cap the prompt**
(reuse the REQ-023 artifact-windowing precedent — offset/length, size-capped), not stream a
megabyte into the panel. Cap the rendered **node** count with an **"N more" affordance** rather than
building virtualization (the REQ-002 ceiling is 1000 agents/run; typical runs are tiny — virtualize
is speculative). Keep the existing **3-second poll** (REQ-071 says so); **do not build SSE** — it is
the single biggest YAGNI temptation in this slice.

### K6 — Trigger provenance is a new field with an enumeration hole
REQ-071's source node needs the run to record *how it started*. No such field exists today (a grep of
`src` found no trigger-provenance field on the run record). Add a single `trigger` enum on the run
record, **set at `start()` by the caller.** But the enum `client | webhook | schedule` is
**incomplete**: `workflow_trigger` maps cleanly to `client`, but a **chain-spawned continuation
(REQ-053)** maps to none of the three. The design gate must decide: default unmapped starts to
`client`, or extend the enum (e.g. `chain`). Left unpinned, REQ-071's acceptance is ambiguous for
chained runs and could throw.

### K7 — Layered module boundaries keep it testable
Keep five seams, four of them pure: `layoutGraph` (pure, K1) · `morandiFrameHue(frame,depth)` (pure,
deterministic per frame — REQ-072) · `harnessDetail(agent, transcript)` + redactor (pure, K2/K3) ·
thin GET routes (below net-guard) · browser render (headless-tested). Palette assignment must be a
**pure deterministic function of the frame** so REQ-072's "a Morandi hue assigned per frame" is
unit-testable and stable across polls (a frame must not flicker colors between refreshes).

---

## risks

| # | Sev | Lens | Risk | Mitigation |
|---|-----|------|------|-----------|
| R1 | HIGH | Security (agent payload) | Harness detail (REQ-073) leaks a resolved provider/MCP secret via the prompt, a tool/MCP env, or resolved config — on the **unauthenticated** read plane. This is the slice's defining risk. | Pure server-side redactor serving names + `${secret:}` handles only; two-tier proof (K3). Resolved secrets never enter the response object. |
| R2 | HIGH | Security (delivery) | Stored/agent-controlled strings (prompt, label, workflow name, tool name) rendered as HTML → **XSS** on a surface that may be reverse-proxy-forwarded (REQ-070 forwards a path via reverse-proxy). | textContent-only, no innerHTML, even inside SVG (K4); regression test extending the REQ-067 convention. |
| R3 | MED | Scalability / storage | Persisting full per-agent **prompt** to satisfy REQ-073 across restarts inflates every journal + REQ-055 snapshot; a large-prompt run bloats storage unboundedly. | Derive-from-transcript (K2); if capturing, **names-only** harness summary; window the prompt (K5). Never duplicate the prompt into `AgentRecord`. |
| R4 | MED | Security (attack surface) | A **new** `/api/runs/:id/graph` or harness route added **above** the line-1097 net-guard would bypass the Host/Origin defense (DNS-rebinding / cross-origin read of run internals + prompts). | Confirmed the gate is global and pre-routing (`server.ts:1097`); **regression test** that the new routes sit below it and 403 on a foreign Host / present-foreign Origin. (Downgraded from "bypass" to "keep-below-the-gate" per confirmed code.) |
| R5 | MED | Correctness / testability | REQ-071 source node has **no data to draw** — trigger provenance isn't recorded; and the enum omits chain-spawned runs (K6). Acceptance is ambiguous / could crash on a chained run. | Additive `trigger` field set at `start()`; design gate pins the unmapped-start default (K6). |
| R6 | LOW | Scalability / perf | A 1000-node run (REQ-002 ceiling) or a deep composite renders a huge SVG; 3s poll re-fetches the whole graph. | Reuse pure `buildDagModel` (already O(nodes)); cap rendered nodes with "N more" (K5); keep the poll, no SSE. |
| R7 | LOW | Consistency | Live poll renders a partially-settled graph (nodes flip queued→running→done between refreshes); frame colors could flicker if palette isn't deterministic. | Eventual consistency is acceptable for a dashboard; make `morandiFrameHue` a pure function of the frame so color is stable (K7). |

---

## expected disagreements

### With the quality-dimensions lens
1. **SSE / live-push vs. the 3s poll.** Quality will likely argue for push-based live updates as a
   consumability/observability upgrade. I hold the line: **poll, no SSE** — YAGNI, it's not in any
   REQ-071..073 acceptance, and it adds a stateful transport to an otherwise stateless read plane.
2. **Formal API contract / typed graph schema (OpenAPI) vs. extend `/dag`.** Quality may want a new,
   fully-specified `/api/runs/:id/graph` contract. I'd **extend the existing `/dag` shape** (REQ-048
   already backs it) and add one thin harness-detail route — minimum surface, minimum test burden.
3. **Rich harness capture (full prompt/tools/skills persisted, replaceable render engine) vs.
   derive-and-window.** Quality's replaceability instinct pushes toward a rich, persisted,
   fully-modeled harness record. My scalability+simplicity read (R3) says **derive from the
   transcript, window the prompt, names-only if you must capture** — do not grow the durable schema
   for an observability nicety.

### Internal conflicts *within* my own three lenses (surfaced per the task)
- **C1 — Security ⟂ Richness (Simplicity).** The n8n look tempts a vendored graph library and
  `innerHTML`-driven layout. Security demands textContent-only + no third-party JS on a
  self-contained page. **Resolution:** hand-rolled layered SVG via a pure `layoutGraph`; all text via
  textContent. Richness yields to security *and* to simplicity — they align here.
- **C2 — Security ⟂ Testability.** Server-side redaction (K3) is the *secure* choice, but a pure
  redactor unit test only proves the function, not that nothing leaks between mapper and pixel; the
  *whole-path* proof needs a slow headless real-run. **Resolution:** both tiers, and I name why each
  exists — fast invariant guard + one end-to-end DOM assertion. Testability doesn't get to skip the
  real-run.
- **C3 — Scalability ⟂ Simplicity.** A 1000-node graph argues for virtualization; simplicity argues
  render-all. **Resolution (Karpathy tie-break):** cap + "N more" affordance, not virtualization —
  bound the worst case cheaply, don't build a windowing engine for a case typical runs never hit.
- **C4 — Agent-altitude observability ⟂ the unauthenticated system plane.** Exposing prompts +
  harness is *good* agent-observability but *widens* what an unauthenticated loopback/forwarded
  reader sees beyond anything prior slices exposed. **Resolution:** redact secrets *regardless* of
  the "trusted loopback" assumption (defense-in-depth, because REQ-070 already forwards a path via
  reverse-proxy) — but do **not** gate the rest behind auth in this slice (D5 defers it; inventing
  auth here would violate scope and the Karpathy rule).

**Karpathy bottom line:** the defensible minimum is one pure layout function, one pure palette
function, one pure redacting mapper, two thin GET routes below the existing gate, and hand-rolled
textContent rendering — plus exactly two small durable additions (`trigger` enum; and *only if the
transcript can't yield it*, a names-only harness summary). Everything else — SSE, a graph library,
persisted prompts, virtualization, any auth — is speculative and out.
