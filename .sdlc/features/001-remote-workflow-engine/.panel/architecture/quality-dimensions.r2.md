# Quality-Dimensions Panel — Round 2 (Architecture, v23)

**Lens**: Observability / Replaceability / Consumability / Self-sustainability.
**Counterpart this round**: `adversarial.r1.md` (Security × Scalability × Testability). No other panelist
filed r1 this iteration, so this is a two-way convergence, not a summary of many.

Adversarial's r1 is a concrete architecture (six components, one table, one config block) built directly
on top of the requirement text and the four dimensions in this lens — not a competing design. Most of
round 1's asks are already satisfied by it, several exactly in the form requested. This round: say so
explicitly where true, narrow to the one real disagreement, and take the positions both proposals invited
the other to take.

---

## Housekeeping: three predicted fights that aren't fights

Adversarial's §4 predicted four fights with this lens. Three don't exist — this lens's r1 never held the
position being rebutted, and saying so plainly is cheaper than letting a strawman stand into Gate 3.

- **"Richer diagrams vs A3 structure-only"** — no dispute. R1's Consumability section flagged ASCII-only
  as a *cost*, not a request to summarize agent behavior; it explicitly said A2 is owner-ratified and
  should not be reopened. A3 (structure-only) is a different, and stronger, ratification this lens never
  contested. **Concede fully, distinguish for the record**: "flagging a cost" and "asking to reopen" are
  different speech acts; this lens did the former.
- **"A prettier render vs A2 one-artifact"** — no dispute. R1's hedge ("retain the analyzer's
  pre-rendering output for a future structured export") is now moot on its own terms: adversarial's
  design has no intermediate representation to retain — the model emits ASCII directly (§2.1's allowlist
  gate operates on the rendered string, not a parsed tree). But the hedge's *goal* — a future consumer
  getting structure without a full re-analysis — is already met by material adversarial's design produces
  as a byproduct: `parseWorkflowSkeleton()`'s output and the `TriggerBindings` snapshot (§2.1, §2.5) are
  engine-owned structured data, computed fresh at generation time and re-derivable at describe time with
  zero LLM calls. A future Mermaid/JSON export builds from *those*, not from parsing the ASCII string.
  **Concede the render-path point, integrate the structural hedge**: record in the design doc that this
  is where a future structured export would source from, so A2 stays closed and the hedge is honored
  without adding anything to v23.
- **"A fallback vs A1 honest absence"** — no dispute. R1's self-sustainability ask was retry/regenerate
  *while `unavailable` still means unavailable* — never a degraded diagram shown in its place. Retrying
  generation and faking a result are different mechanisms with different risk profiles; only the second
  touches A1. **Concede fully.**

One predicted fight is real (analyzer `tools` default) but this lens never argued the other side —
covered under Self-sustainability below as a straight endorsement, not a hold.

---

## Observability

**Resolved: the analyzer-transcript/mask tension (r1's HIGH finding).** R1 flagged that if the analyzer's
run were observable through the same generic surfaces as a user's `agent()` call
(`workflow_agent_log`, dashboard drill-down), a non-owner could read the masked script back out through
the analyzer's own transcript — and asked for one of two fixes: exclude it from generic logging, or apply
the same mask to it. Adversarial's §2.4 independently arrives at the first option, for its own
(scalability/product-metrics) reasons: the analyzer bypasses `AgentExecutor` entirely and goes straight
to `GatewayClient.invoke()`, so it was never going to appear in `workflow_agent_log` or the per-workflow
success-rate cards. **Concede resolved** — this is the same design decision reached from two directions,
which is a stronger signal than either lens reaching it alone.

One residual requirement, additive not a disagreement: §2.4's "one journal line per analyzer run" needs
its field list pinned now, in the design doc, so it doesn't silently grow a transcript field later under
some future "let's just log everything" edit. Concretely: `model`, `promptTokens`/`completionTokens` (or
provider-reported cost equivalent), `durationMs`, `registering principal`, `noteCode`, `inputs_fp` —
**never** transcript text, never the raw analyzer output (gated or not), never the script. This also
closes r1's smaller point about REQ-083 (redact-at-capture doesn't reach script literals) — the answer
isn't "extend redact-at-capture," it's "this path never enters a surface redact-at-capture would need to
cover." State that explicitly so a future reader doesn't assume coverage that was actually avoidance.

**Folded, not dropped: the effective-config observability seam.** R1 asked for the resolved
`graphAnalyzer` config (model/timeoutMs/retries/enabled) to be inspectable outside a full Gate 7.5 run, so
a `composeConfig()` wiring regression is visible in seconds. Rather than a new status surface, the
journal line above already carries `model` per run — an operator watching the journal after an
`operator edits systemPrompt/model and re-registers` (REQ-104's own acceptance scenario) sees the new
model attributed immediately, or sees the *old* model still being logged, which is the wiring-gap
signature. **Smaller ask, same inspectability, no new surface** — merge into the journal-line design
rather than requesting a separate config panel.

**New, from adversarial's own R8: gate-rejection rate is an observability requirement, not just a
self-sustainability one.** §R8 notes a weak/local `graphAnalyzer.model` will raise the gate's rejection
rate, making `unavailable` common rather than exceptional. That is only a benign, working-as-designed
outcome if an operator can *see* it happening and distinguish "the analyzer is down" from "the analyzer
runs fine but the gate keeps rejecting its output." Endorse §R8's ask (count gate rejections in the
journal) and tie it to the `noteCode` enum in §1 (`GATE_REJECTED` distinct from `TIMEOUT`/
`RETRIES_EXHAUSTED`/`DISABLED`) — the enum already carries this distinction structurally; the journal just
needs to preserve it per-run rather than only in the terminal `workflow_diagrams` row, so an operator can
see a rejection *rate* over time, not just the latest row's final state.

---

## Replaceability

**R1's ask (vocabulary-conformance check so "wired but degraded" is distinguishable from "not wired") is
subsumed, not just addressed.** Adversarial's `gateDiagram` (§2.1) plus the `DIAGRAM_CODEPOINTS` allowlist
(§2.3) *is* the structural conformance check this lens asked for, and it is strictly stronger: r1 proposed
a check to run "at Gate 7.5 and ad hoc after a config edit"; adversarial's gate runs on **every single
generation**, as the security control, not an auditing convenience. A degraded swap (cheaper model,
vocabulary compliance drops to prose) doesn't wait for someone to notice — it produces `GATE_REJECTED`
immediately, which is exactly the "wired but degraded, distinguishable from not-wired-at-all" signal r1
wanted, for free. **Concede and merge**: withdraw the standalone conformance-check ask; it would duplicate
`gateDiagram`.

**Endorse §2.2 (note-channel closure) as a replaceability point this lens missed in r1.** R1's r1 didn't
consider the human-readable note as a place where model-specific text could leak through on a *provider
swap* specifically — e.g. swapping providers changes the shape of timeout/error text, and if that text
ever reached the note, replacing the backend would also mean auditing every provider's error-string
format for leakage. Fixing the note to a `noteCode`-driven fixed enum (§2.2) means the analyzer backend is
swappable without the note's *content contract* changing at all — a provider swap cannot regress
consumability or leak anything through the note, because the note doesn't derive from provider output.
This is "LLM backend as config change" applied one layer deeper than r1 saw it. No disagreement; recorded
as an additional point in this lens's favor of §2.2, not previously credited.

---

## Consumability

**REQ-101/102's enum: converge on adversarial's naming, keep r1's discipline.** R1 used `ready` for the
success state; adversarial's state machine (§1) uses `ok`. No engineering reason favors one string over
the other — **adopt `ok` for consistency with the rest of this proposal's naming** (`noteCode` values are
already `SCREAMING_CASE` engine vocabulary; `ok` matches that register better than `ready` would). What
r1 will not concede: the full enum (`ok | pending | unavailable`) must be written into the schema and
asserted **literally** in a test — not left inferable from the two failure branches, per the carried-in
rule ("a test whose oracle is the code under test cannot fail when the code is wrong"). This is a
documentation/testing discipline point, not an architecture disagreement, and adversarial's own §2.6
independently invokes the identical rule for the note string — so this is agreement on method, applied to
one more field.

**R5 (owner-email / webhook-id exposure) — support adversarial's proposed resolution from the consumability
side.** Adversarial correctly escalated this rather than deciding it unilaterally (masking it would
contradict REQ-101's literal text; showing it raw is a PII surface opened to every principal). This
lens's stake: REQ-101's acceptance is written from the *consumer's* side ("everything a user needs to run
the workflow responsibly") — a user does not need the owner's raw email to run a workflow responsibly,
they need a way to attribute/contact, which a masked handle equally serves. **Endorse §R5's proposal**
(kind always visible; identifier masked unless caller is owner/admin, reusing the `secretFingerprint`
idiom) as satisfying this dimension's "minimize learning curve" goal without the PII cost. This is support
for an owner-escalated item, not a new disagreement.

**REQ-106/AUTHORING.md — no change from r1, cross-reference added.** Adversarial's §2.3 note that a
secret in a *phase name* still passes the gate (because phase names are already exposed via masked
`workflow_get`) belongs in AUTHORING.md as the authoring smell it already recommends. This lens's r1 asked
for REQ-106 to be reachable from the MCP surface; adversarial's placement (documentation, not gate logic)
is consistent with that and adds a concrete example to document. No disagreement, cross-reference only.

---

## Self-sustainability

**Endorse §R3 (analyzer `tools` default `[]`) without qualification.** R1 never asked for a tool-enabled
analyzer; this dimension's "minimize human intervention" goal is better served by a narrower blast radius
by default, not a richer one. An `agent()`-style tool surface on an internal, engine-triggered,
attacker-influenced-input call is a self-sustainability risk in its own right (a hung or runaway tool call
inside registration, on every register, with no owner principal to hold accountable) independent of the
security argument adversarial leads with. **Full endorsement**, not a hold — this strengthens rather than
merely accepts §R3.

**The one real disagreement: is `unavailable` allowed to be terminal per `(name, version)`?**

R1's self-sustainability section called this the sharpest gap: since diagrams are pinned to an immutable
`(name, version)` and versions never mutate, a version whose one generation attempt exhausted retries is
`unavailable` forever unless the owner mints a new version — which changes channel resolution, not a
transparent retry. R1 asked for both an automatic-retry-with-backoff policy *and* an explicit
owner/admin `workflow_regenerate_diagram` action.

Adversarial's design, read in full, already closes most of this without saying so:
- REQ-104's `retries` config **is** the bounded-retry mechanism r1 was asking for at the initial-attempt
  level — a separate "retry policy with backoff distinct from the initial attempt" would duplicate a knob
  that already exists. **Concede: drop the auto-retry-with-backoff ask.**
- The boot sweep (§1, §R7) already handles the crash-mid-generation case, which is a different failure
  mode from "the analyzer ran, retried per config, and still failed" — r1's r1 conflated these two under
  one "no recovery path" heading; they need to stay separate because their fixes are different (sweep
  handles the orphan; something else needs to handle the exhausted-retries terminal state).

What's left, narrowed: **after `retries` is exhausted and the boot sweep has run, a `(name, version)` row
sits at `unavailable` with no path back to `ok` short of registering a new version.** Adversarial's own
§R8 supplies the scenario that makes this concrete and non-hypothetical: swap to a weaker/local model,
gate-rejection rate rises, `unavailable` becomes the *common* outcome (§R8's own words) — and then the
operator does the obviously-correct thing, fixes `systemPrompt`/`model` back to something the gate
accepts. Under the current state machine, every version registered during the misconfigured window stays
`unavailable` forever; the fix only helps versions registered *after* the fix. That is a human forced to
notice and manually re-register to recover from what was the engine's own transient misconfiguration —
precisely this dimension's definition of a closed-loop gap.

The fix costs almost nothing in adversarial's own architecture, which is why this lens narrows to it
rather than dropping it: `workflow_diagrams` is explicitly *derived and mutable* (§1, point 1 — "the
diagram is derived, mutable, and therefore must not live in the immutable row"), and `inputs_fp` already
exists to detect exactly the condition ("operator changed the analyzer config") that should justify a
regeneration. **Proposed for Gate 3, narrowed from r1's original two-part ask to one action**: a single
owner/admin `workflow_regenerate_diagram(name, version)` action that re-runs the analyzer against the
stored script for that exact immutable version, using the *current* `graphAnalyzer` config, and overwrites
that version's `workflow_diagrams` row in place (the row is mutable by design; the `workflow_versions` row
it's keyed to is untouched, so REQ-102's "never served against a different version" is not disturbed —
the version doesn't change, only its derived diagram does, which is the same category of update
`inputs_fp`-driven cache-busting already performs automatically on the *forward* path).

**Explicitly not proposed, to pre-empt the R4 fight**: no automatic background retry-forever, and no
lazy regeneration triggered by a `workflow_describe` call — both would turn a bounded, admin-initiated
action into unbounded background spend or into "every read might trigger a model call," reopening
exactly the cost-amplification risk §R4 already mitigates. The action is explicit, owner/admin-gated, and
one-shot per invocation — same trust tier and same cost shape as re-registering, but without minting a
version or disturbing channel semantics.

**S-1 cost-compounding: converged.** R1's ask was "attribute analyzer cost to the registering principal
observably, even if a hard ceiling is deferred." The journal line design (Observability, above) already
carries the registering principal per run. **No remaining gap** — this is satisfied by the journal-line
field list, not a separate mechanism. Endorse §R4's position that no new rate-limiter subsystem is
warranted this iteration; record (as both proposals already do, independently) that v23 raises S-1's
severity without requiring S-1 be fixed in v23.

**REQ-103 staleness: full convergence.** Both proposals independently landed on live-bindings-plus-
timestamp over regenerate-on-binding-change, for the same reason (trigger bindings are structured
engine-owned data; an LLM call on every schedule/webhook/chain edit buys nothing and risks flapping).
Adversarial's concrete mechanism (`bindingsFp` computed by the same `getTriggerBindings()` function that
feeds the analyzer; mismatch at describe time serves the diagram with `generatedAt` + `diagramStale: true`
alongside the live field) is the specific design r1's r1 left unspecified. **Endorse the mechanism as the
one true source** — one function, two call sites, no drift, which also structurally satisfies this
dimension's anti-duplication instinct.

**Idempotence-vs-"generated fresh" (§2.5): take the invited position.** Adversarial explicitly asked the
panel to weigh in: does REQ-102's "a new version is generated fresh" require re-invoking the model, or
just require the new version to get its own row? This lens reads REQ-102's acceptance text the same way
adversarial does — the guarantee being protected is *per-version isolation* ("its diagram is generated
fresh and the prior version's diagram is unchanged"), not *the model must literally re-run on byte-
identical input*. Since `inputs_fp` already covers script ‖ bindings ‖ analyzer-fingerprint, a fingerprint
match means nothing about the diagram's determinants has changed — re-running would be spending a model
call to (most likely) reproduce the same output. **Keep the skip.** Flag alongside adversarial's own
flag for explicit owner ratification at Gate 3, since it is a literal-text reading call, not an
engineering one — but this lens's engineering judgment agrees with adversarial's.

---

## Final position

Converged with adversarial's r1 on all four dimensions:
- **Observability**: dedicated non-`AgentExecutor` path resolves the mask-leak tension; effective-config
  visibility folds into the journal line rather than a separate surface; gate-rejection rate added as a
  journal field (new, endorsing §R8).
- **Replaceability**: `gateDiagram` + `DIAGRAM_CODEPOINTS` subsumes r1's conformance-check ask; §2.2's
  note-channel closure additionally protects backend-swap consumability, a point this lens hadn't
  credited it for.
- **Consumability**: adopt `ok`/`pending`/`unavailable` as the literal, fully-written enum; support the
  R5 masked-owner/webhook-id resolution as the consumability-side answer to an owner-escalated question.
- **Self-sustainability**: full endorsement of `tools: []` default; full convergence on live-bindings-
  plus-timestamp for REQ-103; S-1 attribution satisfied by the journal line; idempotence-skip kept per
  this lens's independent reading of REQ-102.

**Remaining disagreement (one, narrowed from r1's two-part ask): terminal `unavailable`.** Propose a
single owner/admin `workflow_regenerate_diagram(name, version)` action overwriting the mutable diagram
row in place for an already-registered, immutable version — scoped explicitly to exclude auto-retry-
forever and lazy describe-time regeneration, so it does not reopen §R4's cost-amplification concern this
lens otherwise fully endorses.

**Escalations to owner, not disputes between panelists** (carried forward from adversarial, this lens
concurs and adds no new ones): R3's tools-default (this lens says ratify `[]` as a hard default, not just
document it), R5's owner/webhook masking, and the idempotence-skip's literal-text reading.
