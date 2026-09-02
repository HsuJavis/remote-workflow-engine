# Architecture panel — Adversarial group (Security × Scalability × Testability), round 2

**Iteration**: v23 (REQ-101..106).
**Read before writing**: `quality-dimensions.r1.md` (the only other r1 proposal in the panel dir) and my
own `adversarial.r1.md`.
**Posture**: converge. QD's r1 turns out to be largely *compatible* with mine — we independently reached
the same answer on the two structural questions (REQ-103 staleness; analyzer isolation), and most of the
rest integrates into mechanisms I already proposed rather than adding new ones. Below, every QD point
gets an explicit **rebut / concede / hold**, plus two **self-corrections** where QD's findings exposed
defects in *my* r1.

---

## 1. Responses to `quality-dimensions.r1.md`

### QD-1 — Altitude: v23 adds an "agent as internal engine subsystem" altitude → **concede (full agreement)**

Independently reached, same wording almost. No dispute. This is the framing both proposals should hand
to Gate 3.

### QD-2 (their HIGH) — The analyzer's own transcript is a mask bypass → **concede the finding, and my r1 architecture already forecloses it; sharpening it into an invariant**

This is QD's strongest contribution and it is correct: `workflow_agent_log` / the dashboard per-agent
drill-down would let a non-owner read the masked script back out of the analyzer's transcript. It is
REQ-100's own stated failure mode ("cannot be trivially side-stepped by asking a different endpoint")
reappearing through a surface v22 could not have known about.

My r1 §2.4 already routes the analyzer onto a dedicated `GatewayClient.invoke()` path *outside*
`AgentExecutor`, which means it is never enrolled in run listings, `workflow_status`, or per-agent
observability — QD's option (a). I argued that path from metric-pollution and admission-slot grounds;
QD supplies a second, stronger, *security* justification for the same boundary. Two lenses converging on
one structural line is the best evidence available that the line is in the right place.

Integrating QD's point as a stated invariant rather than an emergent property, because "emergent"
is how the ledger's nine deletion-drift instances happened:

> **INV-A (analyzer isolation).** The analyzer's prompt, its raw completion, and any provider payload
> are never persisted to, nor readable through, any surface that a non-owner principal can reach. The
> analyzer produces exactly two durable artifacts: a **gated** diagram and an **engine-authored**
> `noteCode`. There is no analyzer transcript record, so there is nothing to mask.

Choosing QD's (a) over their (b) deliberately: (b) — enrol the analyzer in generic per-agent logging and
then apply the non-owner mask to its transcript — creates a *second* place the mask must be implemented
correctly, and the ledger's own history is that a second implementation of a mask is a drift bug waiting
to be filed. Not storing the transcript is the smaller architecture and the stronger control. **Hold**
against (b).

### QD-3 — REQ-083 redact-at-capture does not reach script literals / prompt sentences → **concede, and it is a further argument for INV-A**

Correct and worth stating in the design doc so nobody assumes coverage. Note the direction it points:
redact-at-capture is scoped to *provisioned secrets*, so if the analyzer transcript existed, redaction
would not save it. Under INV-A the gap is moot for v23 — nothing is captured. Record the gap; do not
extend REQ-083 this iteration (that is a security-hardening iteration item, alongside the unwired
modules already tracked).

### QD-4 — Add a lightweight vocabulary-conformance check to catch "wired but degraded" → **concede the need, rebut the new mechanism: `gateDiagram` already is that check — but I am splitting its reason enum to serve QD's use case**

My r1 §2.1/§2.3 gate already performs exactly the check QD asks for: every diagram token must be a
member of `allowedLabels` ∪ `DIAGRAM_CODEPOINTS`. A weaker model that "degrades to prose" fails the gate
by construction. Adding a second conformance checker would be two implementations of one predicate —
declined on Karpathy grounds.

What QD is right about is that my r1 collapsed two *different* operator signals into one
`GATE_REJECTED` code. Integrating their point by splitting the reason, which costs one enum entry and
no new component:

- `GATE_REJECTED_CONTENT` — a token appeared that is not in `allowedLabels`, i.e. the model tried to
  emit script-derived text. **Security event.** Should be ~0 in steady state; a nonzero rate is an
  attempted mask bypass (or an author's script shaped to induce one).
- `GATE_REJECTED_SHAPE` — vocabulary/structure violation: prose instead of glyphs, oversize, disallowed
  codepoints. **Replaceability event.** A rising rate after a `graphAnalyzer.model` swap is precisely
  QD's "wired but degraded", and it is now readable off the same counter that already had to exist.

Counted separately in the journal (my r1 R8 already asked for gate-rejection counts; this makes the
count *diagnostic*). This is the cleanest integration point in the whole round: QD's dimension is served
without a new module, and my security control gains an operator-facing meaning.

### QD-5 — Write the `diagramStatus` enum out completely as `ready|pending|unavailable` and assert it literally → **concede, adopting QD's naming over mine**

My r1 used `pending → ok | unavailable`. QD's `ready` is better: REQ-102's text only enumerates the
*absence* states (`'pending'|'unavailable'`), so the success state's name is unpinned by the requirement
and will otherwise be whatever the implementation happens to emit — the exact shape carried-in rule 1
forbids. Adopt `ready | pending | unavailable`, and pin all three in the schema/contract test literally.
Dropping `ok` in favour of `ready` at no cost.

### QD-6 — An `unavailable` diagram on an immutable version has no recovery path → **concede; this changes my r1 position, and it exposed a bug in my own fingerprint design (see self-correction SC-1)**

My r1 §1 made `unavailable` **terminal** for a `(name, version)`. QD is right that this is a closed-loop
gap: a transient analyzer outage during a registration burst permanently flags every version registered
in the window, and the only user recourse is re-registering — which mints a new version and disturbs
channel semantics. That is a human-in-the-loop workaround for a transient fault, which is exactly what
this dimension exists to catch.

**Concede, with a bounded scope** (this is where my adversarial lens constrains QD's):

1. `unavailable` becomes **non-terminal but not self-healing on a timer.** No backoff scheduler, no
   retry daemon — that is speculative machinery and it also turns a provider outage into a spend loop.
2. One new action: **`workflow_regenerate_diagram({name, version})`, owner/admin only**, single-flight
   through the same concurrency-1 queue. Authz-bounded so it is not a cost-amplification primitive (my
   r1 R4), and it is a *user-initiated* retry, so an outage cannot make it loop.
3. The existing boot sweep (r1 R7) keeps handling orphan `pending` rows from a crashed process — one
   requeue, then `unavailable`, now recoverable via (2).

QD floated "automatic retry with backoff **and/or** an explicit action". Taking only the explicit
action: **rebut** the automatic-backoff half, because it is unbounded engine-initiated spend against a
failing provider, and the failure it covers is now covered by (2) plus SC-1 below.

### QD-7 — Attribute analyzer cost to the registering principal; v23 raises v22's S-1 severity → **concede in full; it is one field on a line I already proposed**

My r1 §2.4 already requires one journal line per analyzer run (so engine-initiated LLM spend is not
invisible). QD's ask costs nothing on top: that line carries `principal`, `workflow name`, `version`,
`model`, token counts, outcome, and the gate-reason code from QD-4. Concede.

Also concede QD's meta-point, which is the more valuable half: **record in the design doc that v23
raises S-1's severity.** Two independently-filed LOW items (no registration ceiling; every registration
now costs an LLM call) compose into a real cost/availability risk that neither filing owns. Recording
the composition is free; **rebut** building a rate limiter in v23 (QD did not ask for one — agreed
posture). My r1 R4's already-owned mechanisms (concurrency 1 + queue-depth cap, `maxWorkflowVersions`,
`timeoutMs`, and the fingerprint no-op) remain the mitigation.

### QD-8 — REQ-103: live-bindings-field + generated-at timestamp, not regenerate-on-binding-change → **concede (independent convergence)**

Both proposals reached this from opposite lenses — QD from determinism/no-LLM-flapping, mine (r1 §2.5)
from `bindingsFp` staleness detection and not coupling three subsystems to the analyzer. No dispute.
Combined form for Gate 3: serve **live** bindings computed at describe time from the single
`getTriggerBindings()` reader, plus `generatedAt`, plus `diagramStale: true` when the recomputed
`bindingsFp` differs from the stored one. QD's version omits the staleness *flag*; mine adds it for one
`sha256` compare and it is what makes "a stale diagram never silently contradicts the live bindings"
(REQ-103's literal words) machine-checkable rather than left to the reader's eye. Ask QD to take the
flag; nothing in their argument opposes it.

### QD's observability ask — expose the resolved `graphAnalyzer` block on a status surface → **hold, with two security conditions attached**

Good idea, wrong blast radius as written. Conditions:

- **Admin/owner-gated only.** `workflow_status`'s system section is not universally safe for effective
  config: model identity and timeout values are reconnaissance (they tell an attacker which model to
  shape a prompt-injection payload for, and how long a request must stall to force the timeout path).
- **Never the `systemPrompt` body** (QD already says this) — and I would add: never even a hash that
  could be probed. Expose `enabled`, `model`, `timeoutMs`, `retries`, `tools.length`, and
  `promptConfigured: true|false`.
- **Supplements, never replaces, REQ-104's Gate 7.5 real run.** A status field that reports the value
  `composeConfig()` *returned* can itself be wired off the same broken path; a real run is the only
  thing that proves the value reached the analyzer. Both, not either.

### QD's "structured intermediate representation" → **concede the note, and pin its condition**

QD explicitly asked only for a design-doc "future extension" note, not retention in v23 — I am not
manufacturing a fight here. Agreed: nothing is retained in v23 (A2 is owner-ratified and a retained
pre-render representation would be a *second, ungated* copy of analyzer output, i.e. my r1 R2's
second-channel defect). The note should therefore carry its own condition: **any future structured
export must pass its own gate derived from the same `allowedLabels` set** — a structured field is easier
to exfiltrate through than ASCII, not harder, because it removes the rendering constraint.

### QD's prediction about my lens (analyzer `enabled:false` by default; sandbox the analyzer like a user `agent()`) → **rebut both**

- **Not** demanding `enabled:false` by default. QD predicted I would gate the whole feature on the
  transcript question; INV-A resolves that question structurally, so the feature ships enabled. Gating a
  requirement's headline behaviour off by default would be security theatre that also fails REQ-102.
- **Not** demanding process sandboxing for the analyzer. It runs no user code — it *reads* a script as
  text and calls a model. The relevant boundary is data-flow (INV-A + the gate + `tools: []`), not
  process isolation. Adding sandbox machinery here would be speculative.

### QD's unowned "synchronous-generation lens" → **adjudicating: async, settled by requirement text**

QD deferred this to "whichever lens owns registration latency". No lens owns it, so I close it:
REQ-102's acceptance says registration "**never blocks on the analyzer** (generate async, reconcile)".
It is not an open architectural tradeoff; it is pinned. Additionally, synchronous generation would make
registration latency a function of provider health and would let a slow provider hold an admission path
open — a security/availability regression on top of a requirement violation. Settled: async, with
`pending` as a first-class state.

---

## 2. Self-corrections QD's review forced on my r1

### SC-1 — my fingerprint cache defeats the very retry path QD-6 needs (a real bug in r1 §2.5)

r1 §2.5 said re-registering byte-identical inputs "reuses the stored result instead of making a second
model call". If the stored result is `unavailable` from a transient outage, **my own optimization caches
the failure** and a re-registration returns the cached failure forever. Fix, and it is one predicate:

> Fingerprint reuse applies **only when the stored row's status is `ready`**. An identical-`inputs_fp`
> registration against a `pending` or `unavailable` row regenerates.

This makes the failure path naturally self-correcting for the one case where the author re-registers
anyway, and leaves `workflow_regenerate_diagram` (QD-6) as the answer for the case where they should
*not* have to mint a version. Both are needed; neither is redundant.

### SC-2 — my r1 §2.2 routed provider error detail to the journal, which is a third output channel

r1 §2.2 correctly closed the user-facing note as an ungated channel, then said "provider error detail
goes to the journal/log". Under QD-2's finding that is inconsistent: a provider error payload can echo
the request, and the request contains the script. I was closing one leak and opening a quieter one.

Corrected rule, which now makes the invariant complete:

> **Everything analyzer-adjacent is either gate-passed or engine-authored, on every channel.**
> diagram → `gateDiagram`; user note → fixed `noteCode` enum; **journal → engine-classified error class
> + provider HTTP status + token counts only, never raw provider or model text**; nothing else persists.

If an operator genuinely needs raw provider text to debug, that is an explicit, admin-only, off-by-
default diagnostic — not the default path, and out of v23 scope.

---

## 3. Final position (round 2)

Unchanged from r1 except where marked. Six components, one table, one config block, one new
owner/admin action; no new subsystems.

1. **`DiagramStore`** — `workflow_diagrams(name, version, status, diagram, note_code, generated_at,
   inputs_fp, bindings_fp, PRIMARY KEY(name, version))` in `catalog.db`; `workflow_versions` stays
   immutable (ADR-009). Rows deleted with `workflow_deregister` and inside the same transaction as
   `maxWorkflowVersions` pruning (r1 §2.7 — a derived store must not outlive its source).
2. **`getTriggerBindings(name)`** — one reader, two call sites (analyzer input; describe-time live
   field), returning a snapshot + `bindingsFp`. One function is what prevents generated-view /
   served-view drift.
3. **`GraphAnalyzer`** — dedicated `GatewayClient.invoke()` path, never `AgentExecutor`. Own
   `timeoutMs`/`retries`, single-flight concurrency 1 with a queue-depth cap, no secret provider, no
   seeded workspace, no CLAUDE.md-reachable cwd, `tools: []` by default. Governed by **INV-A**: no
   transcript is persisted anywhere *(strengthened, per QD-2)*.
4. **`gateDiagram(raw, allowedLabels, limits)`** — pure; the single security control. Allowlist, not
   denylist: `allowedLabels` derived only from what the engine already serves on masked surfaces (phase
   names, agent count/order, child workflow names, resolved model aliases, trigger kinds + upstream
   name, vocabulary glyphs) plus the `DIAGRAM_CODEPOINTS` constant and `maxBytes`/`maxLines` caps.
   Reason enum now **splits `GATE_REJECTED_CONTENT` (security) from `GATE_REJECTED_SHAPE`
   (replaceability/degradation)** *(new, per QD-4)*.
5. **`projectWorkflowDescribe()`** — one projection serving both the `workflow_describe` MCP tool and
   the auth-gated `GET /api/workflows/:name/describe` route that replaces the dying `/skeleton` route;
   one test asserting both call sites emit the identical object.
6. **`graphAnalyzer` config block** forwarded in `composeConfig()`, with a row in
   `compose-config-v2-wiring.test.ts` **and** REQ-104's Gate 7.5 real run (both — the unit test cannot
   prove the wiring class). Effective-config readback exposed **admin/owner-gated only**, minus the
   prompt body *(new, per QD's observability ask, narrowed)*.

**States**: `pending → ready | unavailable`; `unavailable` is **recoverable** via owner/admin
`workflow_regenerate_diagram`, not terminal *(changed from r1, per QD-6)*. Boot sweep maps orphan
`pending` to one requeue then `unavailable`. Fingerprint reuse only against `ready` rows *(SC-1)*.
`inputs_fp = sha256(script ‖ bindingsSnapshot ‖ analyzerFingerprint{model, systemPrompt, tools,
vocabulary})` — so a `systemPrompt`/`model` edit is a cache miss by construction and REQ-104's
"no-redeploy" acceptance cannot be broken by an optimization.

**Output channels, all closed**: diagram → gate; note → engine-authored enum; journal → engine-authored
class + counters + `principal`/`name`/`version` for cost attribution *(SC-2 + QD-7)*; nothing else.

**Testability spine** (unchanged, all three cheap and all three catch a named ledger defect class):
`gateDiagram` is pure so the REQ-102/A3 security invariant is unit-testable with no model involved;
a mechanical grep-based REQ-105 guard that fails CI on any `skeleton` occurrence outside an explicit
internal allowlist (converting the ledger's most-repeated defect from review discipline into a build
failure); the `composeConfig()` wiring row. Injected seams: `GatewayClient`, `Clock`, and a `schedule`
seam so the async job runs inline in tests rather than being raced.

**Design-doc records (no code):** REQ-083 does not reach script literals (QD-3); v23 raises S-1's
severity (QD-7); A2's fused analysis+render means a future structured export costs a re-analysis *and*
must pass its own gate (QD's note, conditioned); the shipped default `systemPrompt` assumes a model
class, so DEPLOY.md must name it and `GATE_REJECTED_SHAPE` rate is the signal when it is swapped (r1 R8);
`chain_create` validates nothing, so a diagram may faithfully draw a trigger to a non-existent upstream —
render verbatim, do not "correct" (r1 R10).

---

## 4. Remaining disagreements / open items

Only two survive the round, and neither is a lens-vs-lens deadlock I can resolve alone.

**O-1 (was r1 R5) — owner email and webhook ids in a universally-callable response. Live disagreement,
owner call.** REQ-101's text puts **the owner** in a response any principal may call; owner is an email
by this deployment's convention, so `workflow_describe` becomes a PII / principal-enumeration surface.
QD's consumability lens implicitly pushes the other way — their reading is that REQ-101's field list is
the contract and a cold client should get all of it — so this is a genuine three-lens conflict, not just
my escalation: security wants masking, consumability wants the literal contract, and simplicity says
don't build two projections. My proposal for ratification: owner shown full to owner/admin, an opaque
stable handle otherwise; trigger **kind** always shown, webhook id masked (`****3f2`, reusing the
existing `secretFingerprint` idiom) unless owner/admin. I will not architect around REQ-101's own words
without the owner saying so.

**O-2 (was r1 R3) — `graphAnalyzer.tools` is admin-tunable by REQ-104's letter.** A tool-enabled agent
whose input is attacker-authored script text is an execution primitive; with `defaultAllowedTools`
including `Read`/`Write`/`Bash` in some configs, that is read/write in the engine's own process context
reachable by registering a workflow. The requirement mandates the key, so I do not forbid it. Position:
**default `[]`**, loud boot warning when non-empty, ADR recording a non-empty analyzer tool surface as an
accepted-risk operator decision. Flagged for owner ratification. QD did not contest this and predicted I
would raise it; it is open only because it needs a ratification signature, not because it is disputed.

*Everything else in QD's r1 is resolved above.* Items where a lens lost: cross-workflow script-hash
dedupe (scalability lost to security — cross-principal oracle, and the load it optimizes does not
exist); automatic retry-with-backoff (self-sustainability partially lost to security/simplicity —
replaced by the authz-bounded explicit regenerate action); a second vocabulary-conformance checker
(replaceability lost to simplicity — the gate already is one, now with a split reason code that serves
the replaceability signal); enrolling the analyzer in generic per-agent observability with masking
applied (observability lost to security — a second mask implementation is a drift bug waiting to be
filed; not storing the transcript is both smaller and stronger).
