# Quality-Dimensions Panel — Round 1 (Architecture, v23)

**Lens**: Observability / Replaceability / Consumability / Self-sustainability (cross-cutting quality
dimensions, system altitude + agent altitude).
**Scope**: Gate 2 architecture for iteration v23 (REQ-101..106 — `workflow_describe`, the analyzer-drawn
ASCII diagram, `graphAnalyzer` config separation, retiring the skeleton from user surfaces, AUTHORING.md).
Prior iterations (v1–v22) are treated as settled context; touched only where v23 changes their shape.

## Altitude determination

This project is **both** a plain distributed system and an AI-agent system, and v23 is the iteration
where that stops being an abstract framing and becomes concrete: **v23 embeds an agent inside the
engine itself.**

- **Plain-system surface**: Node/TS hand-rolled JSON-RPC-over-HTTP server, SQLite (`better-sqlite3`)
  catalog with version/channel history (v22), dashboard, OAuth2, webhook ingress, GitHub issue tooling.
  All four dimensions apply at "system" altitude to this substrate — REST-ish MCP surface, SQLite
  swap-ability, HTTP self-healing, etc.
- **Agent-system surface, user-workload altitude**: `agent()` calls inside *user-authored* workflows,
  routed through two GatewayClient implementations (LiteLLM-proxy / Claude Agent SDK), multi-model
  routing, per-agent observability (REQ-007). This is the altitude REQ-001..085 already live at.
- **Agent-system surface, engine-internal altitude — new in v23**: the `graphAnalyzer` (REQ-102/104) is
  an LLM call the *engine* makes about a *user's* script, on the engine's own initiative, whose output
  (the diagram) becomes a durable artifact served over a read-only MCP surface (REQ-101) to principals
  who are explicitly not allowed to see the input (the script, per REQ-100). This is a new
  altitude this codebase has not had before: an agent as an **internal engine subsystem with its own
  trust boundary**, not a user-invoked workload. Every dimension below treats this altitude separately
  because the failure modes differ from "a user's `agent()` call misbehaves" — here a misbehaving
  internal agent can leak the very thing v22 was built to hide, or silently cost money on every
  registration.

All four dimensions are addressed at whichever altitude(s) apply; where only one altitude is live for a
given point, that is stated rather than forcing a parallel "agent" bullet that would be padding.

---

## Observability

**System altitude.** REQ-104's own acceptance already names the sharpest system-observability gap: a
`graphAnalyzer` config block that is read but never forwarded through `composeConfig()` passes every
unit test and silently does nothing (the engine's recurring wiring-defect class — v11
`updateFlagPath`, v15 auth, v16 `workspaceTtlMs`). REQ-104 correctly makes this a Gate 7.5 real-run
acceptance, but that only closes the gap *once*, at ship time. Propose an **observable effective-config
seam**: expose the resolved `graphAnalyzer` block (model, timeoutMs, retries, enabled — not the
`systemPrompt` body, which may be large/sensitive) on an existing status surface (e.g. `workflow_status`
system section or a dashboard config panel), so a future regression is detectable by inspection in
seconds, not only by a full real-run validation cycle. This generalizes the same lesson to any future
config block in this engine, not just this one.

Second system point: when `diagramStatus:'unavailable'`, REQ-102 correctly makes this observable to the
*user* as an honest absence. But an operator diagnosing *why* generation keeps failing (bad prompt after
a `graphAnalyzer.systemPrompt` edit? timeout too tight? model unreachable?) needs a cause, not just a
status enum. Recommend the failure reason (error class, not raw model output) be captured on the
internal analyzer run record, inspectable via an admin/owner surface — distinct from the user-facing
`workflow_describe` note, which should stay generic.

**Agent altitude — user workload (unchanged).** REQ-007's per-agent observability (chain-of-thought,
token usage, tool-call sequence) already applies to workflow-authored `agent()` calls and is not
disturbed by v23.

**Agent altitude — engine-internal analyzer (new, and the finding I'd flag HIGH going into debate).**
The analyzer is itself an agent call, and per this lens's own agent-altitude rule its
transcript/tool-calls/tokens should be inspectable, not a black box. But the analyzer's *input* is the
user's script — the exact artifact REQ-100 masks from non-owners, and REQ-101 explicitly re-asserts
("the response contains no script text at all... asserted by the same secret-bearing-script test
REQ-102 uses, so the two masks cannot drift apart"). If the analyzer's run is observable through the
*same* generic surfaces as a normal `agent()` call — `workflow_agent_log`, the dashboard's per-agent
drill-down — then a non-owner principal who cannot call `workflow_get` for the script can instead read
it out of the analyzer's own transcript. This is REQ-100's own stated failure mode ("masking cannot be
trivially side-stepped by asking a different endpoint") reappearing through a surface v22 didn't know
would exist. REQ-102 pins *the diagram's contents* against secret leakage; it does not yet pin *the
analyzer's own transcript/logs*. Design requirement to add at Gate 3: the analyzer's run must either
(a) not be enrolled in the general-purpose per-agent observability surface at all (a dedicated,
owner/admin-only internal log), or (b) be enrolled but with the same non-owner masking applied to its
transcript as to `workflow_get`/`workflow_describe`. Note this is a place REQ-007 (observability) and
REQ-100/101 (the mask) are in direct tension — that tension needs an explicit resolution in the design
doc, not a default inherited from the generic agent-logging code path.

Related, smaller: REQ-083 (redact-at-capture) covers *provisioned secrets* (API keys etc.) in
transcripts. It does not cover script literals or prompt sentences — a different class of sensitive
content that REQ-102's diagram-content test catches but that redact-at-capture was never scoped to
catch in a transcript. State this gap explicitly so it isn't assumed covered by an existing mechanism
that doesn't reach it.

---

## Replaceability

**System altitude.** No new system-level coupling introduced by v23; SQLite/version-channel model from
v22 is unaffected.

**Agent altitude — analyzer swappability (endorse REQ-104, sharpen the contract).** REQ-104's
config-separated `graphAnalyzer` (model/systemPrompt/tools/timeoutMs/retries, no hard-coded harness
value) is the correct shape for this dimension — it is exactly "LLM backend as config change, not
rewrite" applied to an internal subsystem. What needs sharpening at Gate 3: **what contract must a
swapped-in model/prompt satisfy to be a valid replacement?** Today the only test is the Gate 7.5
"the diagram visibly changes" real-run check (good for catching the wiring-gap, insufficient for
catching a *regression in quality* — e.g. an operator swaps to a cheaper model and the vocabulary
compliance (REQ-102's fixed symbol set: rounded box / square box / ◇ / ⟲ / fan-out/fan-in glyphs)
silently degrades to prose). Recommend a lightweight structural conformance check on the analyzer's
output (vocabulary-membership check, not semantic grading) runnable both at Gate 7.5 and ad hoc after an
operator edits the config — this is cheap and catches "wired but degraded," a different failure mode
than "not wired at all."

**Expected tension with A1/A2/A3 (owner-ratified, not proposing to overturn).** A2 commits to a single
ASCII rendering with no intermediate structured representation. This is a legitimate, owner-ratified
simplicity/consistency call ("a single source of truth cannot disagree with itself") and this proposal
does not recommend reopening it. Flagging for the record only: it does mean the analyzer's *rendering*
choice and its *structural analysis* are fused into one LLM call, so replacing "how the diagram looks"
still costs a full re-analysis rather than a cheap re-render step. This is an accepted tradeoff, not a
defect — noted because it is the kind of thing a later "add a Mermaid export" request would run into,
and the design doc should say so explicitly rather than leaving a future reader to rediscover it.

---

## Consumability

**System altitude — REQ-079 schema self-description.** `workflow_describe`'s tool schema is the primary
consumability surface for a cold MCP client (REQ-101's own acceptance: "a schema-only MCP client with no
prior knowledge... the tool description alone is sufficient to learn... that the script is deliberately
not among it"). This needs the same literal-assertion discipline the ledger calls out repeatedly (rule
1, carried from v21/v22: "a test whose oracle is the code under test cannot fail when the code is
wrong"). Concretely: the response shape — `diagram`, `diagramStatus: 'pending'|'unavailable'` (note:
REQ-102's acceptance also implies a third success state where a diagram *is* present; the enum should be
written out completely, e.g. `'ready'|'pending'|'unavailable'`, not left to be inferred — a schema
gap here is exactly the kind of thing that "passes because nothing pins it" later), locked keys named
as locked, available versions/channels, owner, and the report-a-problem pointer (REQ-095) — should all
be asserted against the literal contract in a test, not derived from whatever the implementation happens
to emit.

**Agent altitude — the ASCII-only decision is a consumability cost for machine consumers, and this is
the strongest "expected disagreement" seed.** REQ-101/A2 gives a human-readable artifact designed for a
dashboard and an MCP client's text display. A *programmatic* consumer (another agent, a CI check, a
future feature wanting to reason about workflow shape) gets a string it must parse with a bespoke ASCII
grammar to recover structure — the opposite of "structured, well-typed I/O so other software can invoke
its reasoning like an ordinary function," which is this dimension's own agent-altitude goal. This is not
a recommendation to add a structured field in v23 (A2 is owner-ratified and adding a second
representation this iteration would be exactly the "second render path... scope the owner did not ask
for" A2 already declined). It is flagged as a **debatable point for this round**: if a future consumer
need is anticipated, the cheapest hedge is for the analyzer's internal (pre-rendering) output to be
retained in a form that could later be re-exposed structurally without a full re-analysis — a note for
the design doc's "future extension" section, not a v23 deliverable.

**REQ-106 discoverability (agent altitude, cold-client consumability).** Correctly scoped as
documentation-only ("no new rejection is added at registration"), and correctly required to be reachable
from the MCP surface itself since the plugin ships no guidance skills. No change proposed; noting it
satisfies this dimension's "minimize the caller's learning curve" goal at the one altitude where this
engine's own constraint (schema-only cold clients) actually lives.

---

## Self-sustainability

**Agent altitude — the sharpest gap: an `unavailable` diagram has no recovery path.** Diagrams are
pinned to the exact `(name, version)` they were derived from (REQ-102) and versions are immutable once
registered (v22's whole point — a registration bumps the version rather than mutating history). If the
analyzer times out or errors at registration and no reconcile mechanism exists beyond "generate async,
reconcile," a version whose one generation attempt failed is `unavailable` **forever** unless the owner
re-registers (which mints a new version, changing what users see resolve on a channel — not a
transparent retry). This is exactly the kind of closed-loop gap this dimension exists to catch: no
human should need to notice and manually work around a transient analyzer failure. Recommend a bounded
**regenerate** path at Gate 3 design — either an automatic retry policy with backoff distinct from the
initial attempt (self-healing, no human involved) and/or an explicit `workflow_regenerate_diagram`
owner/admin action for the case automatic retries exhaust — scoped narrowly (does not reopen A1's "no
degraded fallback"; the honest-absence contract holds until a *real* diagram exists, it just stops being
a dead end).

**Agent altitude — unbounded analyzer spend, tied to a debt already named in the ledger.** Every
registration now triggers an LLM call (the analyzer). v22's own named debt S-1 records that
`WorkflowCatalog` enforces no registration ceiling. Pre-v23 that debt was cost-free (registration was
cheap); v23 changes its cost profile — a register-loop (malicious or a buggy author script/CI) now
converts directly into unbounded analyzer LLM spend, on top of whatever storage growth. This wasn't S-1's
problem when it was filed and shouldn't block v23, but the design doc should record that **v23 raises
S-1's severity** rather than let two independently-filed, individually-low-severity items (no
registration ceiling; every registration costs an LLM call) combine into a real cost/availability risk
nobody connected. Minimum ask for Gate 3: attribute analyzer cost to the registering principal
observably (ties to Observability above) even if a hard ceiling is deferred.

**Self-healing, retention (system altitude, minor).** Diagram artifacts accumulate one per version
forever, same growth shape as REQ-026's run-workspace retention problem already solved for workspaces.
Not urgent for v23 (diagrams are text, not blobs) but worth a one-line note in the design doc so it
isn't rediscovered as a surprise once version history is a year deep.

**REQ-103 staleness (self-sustainability angle, taking a position for the debate).** Between the two
options REQ-103 leaves open — regenerate the diagram when trigger bindings change, vs. report bindings
as a live field alongside a diagram stamped with its generation time — this proposal favors the
**live-field-plus-timestamp** design: it is deterministic, costs no LLM call on every
schedule/webhook/chain edit, and cannot flap or fail (an LLM regeneration attempt on every binding change
reopens the same "what happens on analyzer failure" question above, for no benefit — trigger bindings
are structured data the engine already owns and can render without an agent call at all). Regeneration
should be reserved for script changes (new version), where the diagram's *structural* content, not just
its entry-node label, may actually differ.

---

## Summary

v23 is architecturally sound in its four owner-ratified decisions (A1 honest-absence, A2 ASCII-only, A3
structure-only, the skeleton-retirement scope). The material risk this review adds is that v23 is this
engine's first **internal** agent — the graphAnalyzer runs on the engine's own behalf, over content
(the user's script) that a sibling requirement (REQ-100/101) has just gone to considerable lengths to
hide from the same principal who might read it back out through the analyzer's own observability
surface. That is a genuine, previously-undiscussed cross-requirement interaction (REQ-007 vs
REQ-100/101) and belongs in the design doc as an explicit resolution, not an inherited default. The
other three dimensions are in good shape by design (REQ-104 replaceability, REQ-101 consumability) with
one closed-loop gap (unavailable-forever diagrams) worth a bounded fix at Gate 3, and one cost-visibility
note (analyzer spend compounding the already-named S-1 debt) worth carrying forward rather than
re-discovering later.

## Key points
1. Altitude: both system and agent; v23 adds a new altitude — an agent as an internal engine subsystem
   with its own trust boundary, distinct from user-invoked `agent()` workloads.
2. Observability/security tension (HIGH, cross-requirement): the analyzer reads the masked script;
   generic per-agent observability surfaces (`workflow_agent_log`, dashboard drill-down) could leak that
   script's content to non-owners through the analyzer's own transcript, undermining REQ-100/101's mask.
   Needs an explicit resolution: exclude from generic logging, or apply the same non-owner mask to the
   analyzer's transcript.
3. REQ-083 redact-at-capture does not reach script literals/prompt sentences — a distinct sensitivity
   class from provisioned secrets; state the gap rather than assume coverage.
4. Replaceability: endorse REQ-104's config separation; add a lightweight vocabulary-conformance check
   so a "wired but degraded" swap is distinguishable from "not wired" (which Gate 7.5 already catches).
5. Consumability: `diagramStatus` enum should be written out completely (`ready|pending|unavailable`)
   and asserted literally per the ledger's own carried-in testing rule; ASCII-only is a real cost to
   machine consumers, accepted per A2 but worth a forward-looking note.
6. Self-sustainability gap: an `unavailable` diagram for a given immutable version has no recovery path
   today beyond re-registering (which mints a new version). Recommend bounded automatic retry and/or an
   explicit regenerate action.
7. Self-sustainability cost risk: v23 turns every registration into an LLM call; combined with v22's
   named debt S-1 (no registration ceiling), this compounds into unbounded analyzer spend. Recommend at
   minimum attributing analyzer cost to the registering principal.
8. REQ-103 staleness: favor live-field-plus-timestamp over regenerate-on-binding-change (deterministic,
   no LLM flapping, trigger bindings are already structured engine-owned data).

## Risks
- If the analyzer-transcript leak (point 2) is not resolved before implementation, v23 ships REQ-101 as
  a mask that is provably bypassable via a surface (`workflow_agent_log`) the requirement's own authors
  did not anticipate — a repeat of the ledger's most expensive pattern (a mask that can be side-stepped
  by a different endpoint), this time introduced by v23 itself rather than inherited debt.
- If no regenerate path exists, an analyzer outage during a registration burst permanently
  `unavailable`-flags every version registered during the outage window, with no way to retry without
  minting new versions and disturbing channel semantics.
- If analyzer cost is not attributed, a debugging or CI loop that registers the same workflow repeatedly
  (a realistic accident, not just an attack) becomes a silent, unattributed LLM cost sink.

## Expected disagreements with other lenses
- **Security/adversarial lens**: likely goes further than this proposal on point 2 — may argue the
  analyzer should default to `enabled:false` until the transcript-masking question is resolved, or that
  the analyzer's process boundary needs the same sandboxing as a user's `agent()` call, since it reads
  arbitrary (if trusted-author) script text.
- **Simplicity lens**: likely pushes back on the vocabulary-conformance check (replaceability, point 4)
  and the cost-attribution ask (self-sustainability, point 7) as scope creep beyond v23's stated REQs —
  worth debating whether these are Gate-2-blocking or backlog items, consistent with this ledger's own
  "CONVERGENCE RULE" precedent for non-blocking improvement ideas.
- **Consumability-maximalist position** (if raised by another lens): may argue for a structured
  intermediate representation now rather than deferred, directly contesting A2. This proposal takes the
  position that A2 is owner-ratified and should not be reopened this round; disagreement here should
  surface as a forward-looking note, not a Gate-2 blocker.
- **A synchronous-generation lens**: may argue registration should block until the diagram is ready
  (simpler mental model, no `pending` state) rather than REQ-102's async-generate-then-reconcile — this
  proposal did not evaluate that tradeoff and would defer to whichever lens owns registration latency.
