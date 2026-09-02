# Quality-Dimensions Panel — Round 2 (Design, v23)

**Lens**: Observability / Replaceability / Consumability / Self-sustainability.
**Read this round**: `quality-dimensions.r1.md` (own prior stance) and `adversarial.r1.md` (Interface-
contract × Boundary/error × Testability, DES-120..134). Re-verified two load-bearing adversarial claims
against primary source before responding: `curateToolsForProvider`/`NON_ANTHROPIC_EXCLUDED_TOOLS`
(`src/gateway/claude-agent-sdk-client.ts:197,223-227`) and `providerOf`/`effectiveProvider`
(`:201,215-216`) — both confirmed exactly as quoted. No new file contradicts either r1 document; this
round is synthesis, not re-litigation of settled fact.

Structure: §1 responds point-by-point to `adversarial.r1.md` (every disagreement labelled **rebut /
concede / hold**), §2 states this lens's converged final position under all four dimension headings —
required even where the section is pure convergence, because a skipped dimension is itself a defect —
§3 lists what remains genuinely open.

---

## 1. Response to `adversarial.r1.md`

### 1.1 DES-120 (tools:[] curation fix) — **concede the fix, rebut the tie-break**

**Concede**: `curateToolsForProvider`'s missing `if (tools.length === 0) return [];` guard is the correct,
minimal, general-purpose fix — verified in source, not analyzer-specific, and it closes the *default*
`graphAnalyzer.tools:[]` path completely. This is a stronger and more general fix than anything my r1
proposed for the same failure mode; adopt it as-is.

**Rebut** the §5.1 tie-break conclusion that this makes the scratch-`cwd` proposal (my r1
Self-sustainability §1) "mostly moot." It moots the *default* path only. Adversarial's own residual
paragraph in §2.1 admits the counter-example: an operator who sets `graphAnalyzer.tools:['Read']` (the
exact ADR-020-accepted-risk state their own architecture round contemplates as reachable) still gets
`curateToolsForProvider(['Read'], 'ollama') === ['Bash']` after DES-120 lands — the empty-set guard does
not touch a *non-empty* configured set. And per their own §2.2/§2.3 table, when neither `workspace` is
passed nor a dedicated `cwd` is pinned, `canUseTool` jails that Bash session to `this._config.cwd`, which
they verify is **the server workRoot — the directory containing every other run's workspace and
journal**, not an empty scratch directory. So the residual state is: an attacker-authored script (via
`workflow_register`) drives a Bash-enabled session jailed to *all runs' data*, gated only by an operator
flipping one non-default config key. That is not "a belt whose suspenders are already on" — it is the
one config state where the belt is the only thing holding.

**Position held from r1, sharpened**: give the analyzer's gateway construction an explicit
`cwd: ${workRoot}/.graph-analyzer-scratch/` (created once, never written by any run) regardless of
whether `tools` is empty. Cost is one directory literal; it is free when tools are empty (nothing runs
there) and load-bearing exactly in the residual case DES-120 leaves open. **Integrate with DES-120's own
proposal**, don't compete with it: the boot warning DES-120 already asks for ("name the *effective
post-curation* set, not the configured one") should name the jail directory alongside the effective tool
set — one warning, two facts, same operational convention.

### 1.2 DES-121 (analyzer-owned retry loop) — **concede, fully integrate**

No `retries` channel exists in `AgentOpts`/`invoke()`; retries live on the gateway instance and are shared
with every user-facing `agent()` call. This is a self-sustainability finding my r1 did not surface at
all — a real bounded-spend gap, not adjacent to my lens but squarely inside it (closed-loop autonomy
means the system's own resource consumption is bounded and legible, not "whatever composes out of two
independently-configured retry knobs"). Adopt without modification: the analyzer owns its own attempt
loop, `graphAnalyzer.retries` defaults to `0`, and the multiplicative worst case
`(1 + graphAnalyzer.retries) × (1 + gatewayConfig.retries)` is written into DEPLOY.md as a documented
cost formula, not discovered by an operator after the fact. This becomes part of my final
Self-sustainability position (§2.4).

### 1.3 DES-122 (isolation by omission, property table) — **concede, converge**

My r1 Self-sustainability §1 already established that omitting `workspace` yields `settingSources: []`
and that this — not the `cwd` fallback — is the actual guard against the CLAUDE.md/MEMORY.md leak class.
DES-122 states the same conclusion independently and adds the full omission→property table (`onEvent`/
`onHarness` ⇒ no transcript events exist to persist; synthetic `runId`/`agentId` ⇒ never joins a real
run's records). No disagreement — adopt the table as the design-doc artifact that makes each omission's
purpose explicit rather than looking like an oversight to a future maintainer, which was exactly my r1's
concern about an unstated default.

### 1.4 DES-123 (closed `DiagramNoteCode` enum + `noteCodeFor`) — **concede the decomposition, extend it**

My r1 proposed a 7-value enum (`TIMEOUT | RETRIES_EXHAUSTED | QUEUE_FULL | DISABLED |
GATE_REJECTED_CONTENT | GATE_REJECTED_SHAPE | MODEL_UNMAPPED`) that collapsed every `GatewayResult`
failure reason into a single `TIMEOUT` and had no code at all for `content: unknown` (a non-string /
empty completion). DES-123's 10-value enum decomposes `ok:false` into `TIMEOUT | PROVIDER_UNREACHABLE |
PROVIDER_ERROR` (matching the three actual `reason` values on the wire) and adds `MALFORMED_COMPLETION`
for the `content: unknown` state and `NOT_GENERATED` for the no-row case. This is strictly more complete
than my r1 enum and I concede the collapse was a real gap — a `PROVIDER_ERROR` and a `TIMEOUT` are
different operator-actionable signals (one says "check the provider," the other says "raise
`graphAnalyzer.timeoutMs`") and collapsing them would have made the per-run rate signal I asked for in my
r1 Observability §3 report the wrong rate.

**What I still hold**: `MODEL_UNMAPPED` (my r1 Self-sustainability §2) is not covered by DES-123's
`noteCodeFor` input union (`GatewayResult | {kind:'gate'} | {kind:'queue'} | {kind:'disabled'}`) because a
misconfigured alias means the model is **never called** — there is no `GatewayResult` to map. Proposed
integration: extend the union with a fifth variant, `{kind:'config'; reason:'model_unmapped'}`, so
`noteCodeFor` stays the single total mapping function DES-123 wants it to be, rather than gaining a
side-channel that writes `MODEL_UNMAPPED` outside the function's discipline. This reconciles cleanly with
DES-127 B2's rule ("a persisted row is written only by an attempt"): an enqueue that fails pre-call
alias validation *is* a settled attempt (it never got further, but it was attempted and it terminated),
so persisting the row through the same `noteCodeFor` path is consistent with B2, not an exception to it.

**Merged enum, final position** — 11 values:
`TIMEOUT | PROVIDER_UNREACHABLE | PROVIDER_ERROR | MALFORMED_COMPLETION | GATE_REJECTED_CONTENT |
GATE_REJECTED_SHAPE | QUEUE_FULL | RETRIES_EXHAUSTED | DISABLED | NOT_GENERATED | MODEL_UNMAPPED`.

One seam worth naming explicitly in the design doc so an implementer doesn't get it backwards:
`NOT_GENERATED` and `DISABLED` are **synthesized at read time** from "no row + `enabled` flag" (DES-127
B1/B2), never persisted; every other value in the enum is written to the row by an actual attempt. A
`workflow_diagrams` row whose `note_code` is `NOT_GENERATED` or `DISABLED` should never exist — those two
values only ever appear in the *describe projection*, not in the table. Worth a one-line CHECK-constraint
comment or a code comment at the write site, because the enum being flat hides this asymmetry.

### 1.5 DES-124 (gate tokenizer specification) — **no position, defer to adversarial/interface lens**

The four-pass tokenizer algorithm is an interface-contract/boundary concern with no direct quality-
dimensions stake. One convergence point, addressed together with §1.7 below: the *diagnostic residue*
question (what gets stored when the gate rejects something) does touch Observability, and that is where
I engage — see §1.7.

### 1.6 DES-125 (`projectWorkflowDescribe` signature, `EXPECTED_DESCRIBE_KEYS`) — **concede, converge**

This is exactly my r1 Consumability §2 ("one exported constant... not a duplicate literal per test
file"), independently reached and specified further: DES-125 exports `EXPECTED_DESCRIBE_KEYS` next to the
already-established `EXPECTED_NON_OWNER_KEYS` pattern from v22, and both the facade test and the route
test import it. No disagreement — this *is* my proposal, just with the concrete home named. I add nothing
except noting the pattern precedent makes this low-risk to implement correctly the first time.

### 1.7 DES-127 boundary states (B1–B5) — **concede B1 (with the boot-log compromise), concede B2–B5**

- **B1 (no boot backfill for pre-v23 versions)**: adversarial predicted (their §8.1) that I would want a
  backfill from consumability — an operator upgrading and finding every workflow's diagram
  `unavailable` has a bad first five minutes. **I do not hold that position.** A backfill is N model calls
  triggered by an upgrade with no principal to attribute the spend to — exactly the "every read/upgrade
  might trigger a model call" shape ADR-017 already rejected, and self-sustainability's "minimize human
  intervention" goal does not mean "maximize autonomous spend without asking." **Accept their offered
  compromise as the converged position**: a one-line boot log naming the count of versions with no
  diagram row and the exact recovery command (`workflow_regenerate_diagram`). Zero model calls at boot,
  full discoverability — this satisfies Consumability (the gap is visible, not silently discovered later)
  without violating Self-sustainability (no unbounded autonomous spend). Predicted disagreement resolves
  to convergence.
- **B2 (row written only by an attempt, `DISABLED` synthesized)**: concede — consistent with §1.4's
  `MODEL_UNMAPPED` reconciliation above.
- **B3 (`diagramStale` false unless `status==='ready'`)**: concede — this is the same "flag stops meaning
  anything if it fires on every absent diagram" argument I would have made from Observability; adversarial
  got there first and the reasoning is identical to my own carried-in-rule-1 discipline.
- **B4 (per-`(name,version)` single-flight on regenerate)**: concede — this is a self-sustainability point
  in different clothing (bounded spend under repeated owner action) and the "no new mechanism, correct
  implementation of an existing invariant" framing in their §5.3 is the right simplicity call.
- **B5 (failed regenerate leaves the prior `ready` row untouched)**: concede — a self-sustainability
  closed-loop property (a degraded dependency must not destroy previously-good state) stated better than
  I would have stated it.

None of B1–B5 requires a new dashboard mechanism: all four synthesized/persisted states flow through the
same `describe` → 3s-poll path my r1 Consumability §1 already confirmed needs no new refresh mechanism.
Worth stating explicitly so the task that implements B1–B5 doesn't also invent a boot-triggered dashboard
notification for the B1 log line — the log line is an operator-facing stdout convention (same channel as
DES-120's boot warning), not a dashboard feature.

### 1.8 DES-128 (`TriggerPorts` narrow interfaces) — **concede, endorse as reinforcing evidence**

This is a direct instantiation of my r1 Replaceability §1 principle (`GraphAnalyzer` takes the existing
`GatewayClient` interface, not a narrower ad hoc shape, so a future backend swap needs no analyzer-
specific code path) applied to a different seam: `getTriggerBindings(name, ports: TriggerPorts)` takes
four one-method structural interfaces instead of three SQLite store classes. Same design language, same
payoff (a unit test stands up plain object literals, no SQLite; a future fourth store type is a config
change to the port implementation, not a rewrite of the projection). No disagreement, and I fold this in
as supporting evidence that the slice's Replaceability posture is consistent across both the LLM-backend
seam and the data-source seam — worth saying explicitly in the design doc as one deliberate pattern
("narrow structural ports at every seam this slice touches"), not two coincidentally similar decisions.

### 1.9 DES-129 (typed journal record) — **concede, integrate one correction to the field-name question**

**Concede and integrate**: `principal` must be captured at **enqueue time** as a field on the queued job,
not read at completion — by the time an async job settles, the HTTP/MCP request that carried the
principal is long gone. This is an Observability *accuracy* bug my r1 §1/§3 didn't catch (I pinned the
sink and the enum but assumed the field values themselves were unproblematic to obtain). Fold this into my
final Observability position (§2.1).

**Flag, not silently adopt**: DES-129 proposes renaming `promptTokens`/`completionTokens` to
`tokens.{input,output}` on the journal line, on the grounds that `GatewayResult` already uses those names
internally. My r1 header treats ARCH-079 invariant 5's field list (`{name, version, principal, model,
promptTokens, completionTokens, durationMs, outcome, noteCode}`) as **ratified**, inherited from the
architecture round, not re-litigated here. I don't object to the rename on engineering grounds — one
fewer mapping to get backwards is a real observability-accuracy win, matching this lens's "no
opaque translation layer between internal state and the logged fact" instinct — but a pinned invariant's
literal field list changing is an ARCH-text amendment, not a design-round free choice. **Flagging
explicitly for the synthesizer**: either amend ARCH-079 invariant 5's field list to `tokens.input` /
`tokens.output` now (my preferred outcome, on observability-accuracy grounds), or keep `promptTokens`/
`completionTokens` on the wire and let the journal-line writer do the one-line rename from
`GatewayResult.tokens` at the log call site. Either is fine; a silent drift between what invariant 5 says
and what ships is not.

### 1.10 Response to adversarial §8's remaining predicted disagreements

- **§8.2 (analyzer diagnostics / raw-completion residue)** — **accept with one correction.** Adversarial
  offered: "store the rejected token for `GATE_REJECTED_SHAPE` only, never for `GATE_REJECTED_CONTENT`."
  But per their own DES-124 pass ordering, an `allowedLabels` miss (the "rejected token" case) is a **pass
  3** failure, which their own algorithm classifies as `GATE_REJECTED_CONTENT`, not `SHAPE` — `SHAPE`
  covers passes 1–2 (bad codepoints, oversize). As written the compromise asks to store, under `SHAPE`, a
  kind of value that cannot occur under `SHAPE`. **Corrected version, which I accept**: for
  `GATE_REJECTED_SHAPE`, store the engine-classified failure metric (which codepoint class was rejected,
  or the byte/line count that exceeded the ceiling) — safe by construction, since it's a fact about the
  input's *shape*, not its content, and it is exactly the signal needed to diagnose a shape-rejection
  storm after a model swap (e.g. a new model consistently emitting a disallowed Unicode box-drawing
  variant). For `GATE_REJECTED_CONTENT`, store nothing, ever — the rejected token *is* the thing ADR-016
  forbids storing. This gives Observability the degradation-diagnosis signal on the one failure class
  where it's safe and costs nothing on the one where it isn't.
- **§8.3 (`viewerIsOwner` parameter)** — **concede.** No quality-dimensions stake in keeping a parameter
  that provably cannot change the output; "extensibility for a future owner-only field" is not a
  consumability argument for a caller today, and adding it back together with a `workflow_get` change (as
  adversarial proposes) if the owner ever revisits A3 is the right shape for that future change anyway.
- **§8.4 (`inputs_fp`/cache)** — **no position; already settled.** My r1 header already lists "no
  `inputs_fp`" among the architecture-round decisions this design round inherits as ratified. Nothing to
  re-litigate.
- **§8.5 (where the "wired but degraded" signal lives)** — **full convergence, no disagreement.** This is
  precisely my r1 Observability §3 position (the per-run journal line carrying the split
  `GATE_REJECTED_CONTENT`/`GATE_REJECTED_SHAPE` code *is* the rate signal; no new metrics surface needed).
  Independently reached by both lenses from different starting points — strong signal this is the right
  call, not just a compromise.
- **§8.6 (phase-name disclosure framing, §3.3)** — **hold, out of lens.** Whether the phase-name residual
  disclosure is adequately controlled by AUTHORING.md alone is a security/interface-contract question
  about *what* is disclosed and to whom; quality-dimensions has no independent claim about the disclosure
  itself. The one place my lens touches this is already covered: DES-125's `EXPECTED_DESCRIBE_KEYS` oracle
  (§1.6) makes `workflow_describe` serving `meta.phases[].title` a two-sided, literally-asserted fact the
  moment the projection ships, so the "first surface to serve phases to non-owners" claim in their §3.3(1)
  is automatically observable in the test suite, not just in prose. No additional position needed.

### 1.11 Primary-source corrections (§3.1–3.4) — **acknowledge, minor Self-sustainability consequence**

§3.1 (no `maxWorkflowVersions` prune; `deregister()`'s transaction is the only diagram-row deletion path)
is a correction to architecture text, not a disagreement with my r1. Consequence for my final position:
the worst-case analyzer spend for one workflow name is bounded by `maxWorkflowVersions` initial
registrations **plus unbounded owner-initiated regenerates** — the "unbounded" half is exactly why DES-121
§1.2's retry cap and DES-127 B4's single-flight guard (both conceded above) matter more than a GC-shaped
mechanism would have. §3.4 is the same scratch-`cwd` point addressed in §1.1.

---

## 2. Final position, by dimension

### 2.1 Observability

- **Sink**: one `console.log('[remote-workflow-engine] graph-analyzer ' + JSON.stringify({...}))` line per
  analyzer attempt, on the project's one existing stdout/stderr convention (`DEPLOY.md §6`) — no new log
  file, no DB-only channel. (r1, unchanged.)
- **Journal fields**: `{name, version, principal, model, promptTokens, completionTokens, durationMs,
  outcome, noteCode}` per ARCH-079 invariant 5, with two design-round refinements: `principal` is captured
  **at enqueue time** and carried as a field on the queued job, not re-read at completion (§1.9, conceded
  from DES-129); and the `promptTokens`/`completionTokens` vs `tokens.{input,output}` naming question is
  flagged for the synthesizer as a proposed ARCH-079 amendment, not silently resolved at design altitude
  (§1.9).
- **Closed enum**: the merged 11-value `DiagramNoteCode` (§1.4) — `TIMEOUT | PROVIDER_UNREACHABLE |
  PROVIDER_ERROR | MALFORMED_COMPLETION | GATE_REJECTED_CONTENT | GATE_REJECTED_SHAPE | QUEUE_FULL |
  RETRIES_EXHAUSTED | DISABLED | NOT_GENERATED | MODEL_UNMAPPED` — asserted literally in its own test per
  carried-in rule 1, through a single total `noteCodeFor` function whose input union is extended with a
  `{kind:'config'; reason:'model_unmapped'}` variant so the boot-time alias-validation path stays inside
  the same mapping discipline as every gateway/gate/queue outcome. `NOT_GENERATED`/`DISABLED` are
  synthesized at read time and never appear in a persisted row; every other value is written by an actual
  attempt — call this out explicitly in the design doc.
- **Per-run granularity for the rate signal**: unchanged from r1 §3 — the terminal `workflow_diagrams` row
  holds only the latest outcome; the per-run journal line is what lets an operator see a
  `GATE_REJECTED_SHAPE` (or `PROVIDER_ERROR`) **rate** rising after a model swap. Full convergence with
  adversarial §8.5: this is the counter, no new metrics surface.
- **Diagnostic residue**: on `GATE_REJECTED_SHAPE` only, store the engine-classified failure metric
  (rejected codepoint class, or the byte/line count over ceiling) — never the content itself and never on
  `GATE_REJECTED_CONTENT`, where the rejected token is definitionally the thing ADR-016 forbids storing
  (§1.10, corrected from adversarial's §8.2 offer).
- **Boot-time visibility, two items, same convention**: (a) a misconfigured `graphAnalyzer.model` alias
  logs a loud boot warning on the `[remote-workflow-engine]` stdout channel (r1 §Self-sustainability-2,
  unchanged); (b) the pre-v23-versions-with-no-diagram count logs a one-line boot summary naming the count
  and the recovery command (conceded from adversarial §8.1/DES-127-B1, §1.7 above). Both are the same
  operational surface an operator already watches — not two new things, one convention used twice.

### 2.2 Replaceability

- **`GraphAnalyzer` takes the existing `GatewayClient` interface**, not a narrower ad hoc shape — unchanged
  from r1 §1, pinned as a design constraint so a future third gateway implementation needs no
  analyzer-specific code path.
- **`graphAnalyzer.model` resolves through the same shared `AliasMap`** `agent()` calls use (r1 §2,
  re-verified this round: `providerOf`/`effectiveProvider` at `claude-agent-sdk-client.ts:201,215-216`
  confirm an unmapped alias resolves to `undefined`, not a raw provider string) — this must be stated
  explicitly in the design doc, and its boot-time-validation consequence is now folded into the merged
  `MODEL_UNMAPPED` enum value (§2.1).
- **New this round, endorsed not authored here**: `TriggerPorts` (DES-128, §1.8) is the same decoupling
  principle applied at the trigger-binding seam — four one-method structural interfaces instead of three
  store classes. Recorded as reinforcing evidence that this slice applies "narrow structural interface at
  every backend/data-source seam" as one deliberate, consistent pattern, worth naming as such in the
  design doc rather than treating each seam's port as a local decision.

### 2.3 Consumability

Mostly convergence this round — no new disputes, one adopted specification.

- **Dashboard live-update needs no new mechanism** for `pending → ready`, nor for any of DES-127's B1–B5
  synthesized/persisted states (§1.7) — all flow through the existing `describe`-inside-the-3s-poll path
  (r1 §1, unchanged, and explicitly extended this round to cover the boundary states so no implementer
  invents a bespoke notification for the boot-log line).
- **`EXPECTED_DESCRIBE_KEYS` gets one exported home** — my r1 §2 proposal, and DES-125 (§1.6) specifies the
  concrete location (next to `EXPECTED_NON_OWNER_KEYS`, the v22-established pattern) that both the facade
  test and the route test import. Full convergence, nothing left to resolve.
- **`viewerIsOwner` parameter dropped** from `projectWorkflowDescribe` (§1.10, conceded) — one fewer
  parameter for a caller to reason about, and interface simplicity here is also a (mild) consumability win:
  a describe caller has no owner/non-owner branch to think about at all, matching REQ-101's "the same
  response shape for any principal" framing.

### 2.4 Self-sustainability

- **Scratch `cwd` under `workRoot`, defense-in-depth**: give the analyzer's gateway construction an
  explicit `cwd: ${workRoot}/.graph-analyzer-scratch/`, created once, never written by any run, regardless
  of whether `graphAnalyzer.tools` is empty. Closes the residual state DES-120's tools-curation fix leaves
  open (§1.1): an operator-accepted non-empty `tools` config, combined with `curateToolsForProvider`'s
  Bash-injection-for-non-Anthropic-providers behavior, still produces a Bash-enabled session; without a
  pinned scratch `cwd` that session is jailed to the server workRoot (all runs' data), not an empty
  directory. Cost is one directory literal, inherited-for-free `.git`/`CLAUDE.md`-non-reachability from the
  existing `workroot-guard` (REQ-021) boot invariant. Pair with DES-120's boot warning: name both the
  effective post-curation tool set and the jail directory in the same log line.
- **Retries are the analyzer's own attempt loop, capped and documented** (§1.2, conceded from DES-121):
  `graphAnalyzer.retries` defaults to `0`; the multiplicative worst case
  `(1 + graphAnalyzer.retries) × (1 + gatewayConfig.retries)`, each bounded by `graphAnalyzer.timeoutMs`,
  is written into DEPLOY.md as a documented cost formula.
- **`graphAnalyzer.model` alias validated once at boot**, loud warning on the existing stdout convention,
  `MODEL_UNMAPPED` on every subsequent affected row rather than a silent wrong-provider dispatch (r1 §2,
  unchanged, now integrated into the merged enum's total mapping via the `{kind:'config'}` variant).
- **No boot backfill for pre-v23 versions** (§1.7, conceded to adversarial's compromise): a one-line boot
  log naming the count and recovery command, zero autonomous model spend. Predicted disagreement resolved
  to convergence.
- **Per-`(name, version)` single-flight on regenerate, and failure leaves the prior `ready` row untouched**
  (DES-127 B4/B5, §1.7, conceded) — both are closed-loop properties (bounded spend under repeated action; a
  degraded dependency must not destroy previously-good state) that belong in this dimension and are
  correctly scoped as "no new mechanism," matching this slice's Karpathy discipline.
- **Row-lifecycle consequence of the no-prune correction** (§1.11): the only diagram-row deletion path is
  `deregister()`'s transaction; unbounded spend risk therefore comes entirely from owner-initiated
  regenerate calls, not from any GC mechanism — which is exactly why the retry cap and single-flight guard
  above are the load-bearing bounds, not a table-size argument.

---

## 3. What remains genuinely open

- **Field-name amendment to ARCH-079 invariant 5** (§1.9): `promptTokens`/`completionTokens` vs
  `tokens.{input,output}` on the journal line. I prefer the rename; either is engineering-fine; the open
  item is procedural — this needs an explicit ARCH-text amendment, not a silent design-round substitution,
  and I'm flagging it rather than resolving it unilaterally.
- **Scratch-`cwd` residual (§1.1, §2.4)**: this is the one place I hold a position adversarial's own
  tie-break (§5.1) explicitly argued against ("mostly moot"). I don't believe it's fully moot — the
  residual is real, narrow, and cheap to close (one directory literal) — but this is a judgment call about
  whether a low-probability, operator-opt-in, already-warned-about state justifies a design-doc line the
  other lens sees as unnecessary belt-and-suspenders. Flagging for the synthesizer/owner rather than
  claiming a unilateral win.
- **Everything else in §1 resolved to concede or full convergence** — no other disputed item remains open
  between this lens and adversarial's r1.
