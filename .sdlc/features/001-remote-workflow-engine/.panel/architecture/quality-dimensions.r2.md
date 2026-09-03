# Quality-Dimensions Panel — Architecture, **Gate 2 RE-RUN**, Round 2 (v23)

> **This file replaces the v23 first-pass round-2 content of the same name**, which argued
> ARCH-077..086 into existence before the code was written. That content is preserved in git at
> `f886a45`. This round is the **Gate 2 re-run** for the 2026-09-03 Gate 8 send-back
> (`send_back: ["architecture","tests","impl"]`, `arch_consistent:false`, 3 HIGH / 3 MED / 4 LOW).

**Lens**: Observability / Replaceability / Consumability / Self-sustainability — all four sections
present below, in that order.
**Read this round**: `adversarial.r1.md` (Security × Scalability × Testability) in full, and my own
`quality-dimensions.r1.md`. Those are the only two r1 files in this directory, so this is a two-way
convergence.

**New verification done this round** (not carried from either r1, not from the review panel — each
command run against the working tree now): `src/workflow-view.ts:122-137`; `src/graph-analyzer.ts:100-160`,
`:165-215`, `:250-298`; `grep -n "console.log" src/graph-analyzer.ts` → **exactly one hit, `:288`**;
`grep -n "putDiagramPending" src/graph-analyzer.ts` → `:144`, `:173`; `src/server.ts:188-244`, `:317`,
`:1714-1722`, `:1856`, `:2050`; `tests/integration/mcp-tools-list-schema.test.ts:20-75`;
`grep -rn "timeoutMs" src/gateway/*.ts`.

That verification changed three positions — **one of mine is falsified, one of theirs is falsified, and
one finding is new to both of us.** They are stated as such below rather than buried.

---

## 0. Convergence ledger

Round 1 predicted a fight over A1's mechanism. **There was no fight**: both panels independently
reached "gate the transport, keep one projection", and the adversarial lens supplied a better wiring
for it than mine. Of the fourteen live items, twelve are now agreed.

| item | their r1 | my r1 | this round |
|---|---|---|---|
| **A1** mechanism | P1 — gate via `dbindExempt`, handler stays put | QD-C1 — gate the transport, singular projection | **CONCEDE to P1's wiring**, hold the shared conclusion |
| **A2** guard placement | P2 — choke point at `_startJob` | QD-S1 — gate the sweep's requeue branch | **CONCEDE placement**, **HOLD + extend** the settle's honesty (§4.1) |
| **A2** settle value | `RETRIES_EXHAUSTED`, no migration | same (`DISABLED` is unwritable) | agreed — **my r1's stated consequence was wrong** (§4.1) |
| **A3** release | P3 — `finally` + `.catch()` at the scheduler | QD-S2 — same | agreed verbatim |
| **A3** severity/mechanism | V-A: crash-loop bounded | QD-S2: same self-correction | **mutually confirmed** — neither panel carries the overclaim |
| **A4** mini-preview | P7 — delete | QD-S4 — delete + call-site rule | agreed; I hold the call-site rule (§4.4) |
| **A5** vocabulary | P4 — one constant, interpolate, assert both copies | QD-R2 — same + a new ADR | agreed; **CONCEDE the vehicle** (note on ARCH-080, not a new ADR) (§2.1) |
| **A5** vs REQ-104 | C4 — the asymmetry paragraph | not raised | **ADOPT** — genuine gap in my r1 (§2.2) |
| **A6** drift-lock | P5 — set equality, literal stays in the test | QD-C2 — two-sided equality vs an assertion table | **split: concede scope, hold shape** (§3.2) |
| **A7** allowlist | P6 — MED + per-member re-audit + widening rule | QD-O1 — (i) amendment | **CONCEDE severity to MED**, adopt the widening rule (§1.2) |
| **A10** / prior-row | P8 — state the window, `generated_at`'s double duty | QD-S5 — comment fix, no schema | agreed; adopt their structural cause (§4.5) |
| journal line coverage | C3/#5 — "a settle emits it"; argue against a third surface | QD-O4 — throw path is silent | **REBUT the premise (it is false), CONCEDE the conclusion** (§1.1, §1.5) |
| global `unhandledRejection` | §4 — refused | QD-S3 — deferred | agreed, no daylight |
| auto-retry / liveness probe | #4 — ADR-017 forbids it | QD-S6 — (iii), named not built | agreed; I never proposed it (§4.6) |
| **V-A / V-B / V-C** | new | — | **ADOPT all three**; V-C is this lens's argument in their words (§1.4) |

---

## 1. Observability — transparency of internal state (incl. traceability)

### 1.1 New finding, verified this round: **every settle that does not run `_attempt` is silent today**

This is the most important thing either panel has established this round, and it is *larger* than my
r1's QD-O4, which only claimed the exceptional-throw path was silent.

`grep -n "console.log" src/graph-analyzer.ts` returns **exactly one hit: `:288`**, inside `_attempt`.
The ARCH-079 inv-5 journal line is emitted **only when a model call was actually attempted**. But
`_settleUnavailable` (`:194-201`) writes a store row and logs **nothing**, and it is called from:

- `:136` — **`MODEL_UNMAPPED`**, the short-circuit when `graphAnalyzer.model` is not a known alias;
- `:140` — **`QUEUE_FULL`**, the bounded-queue rejection;
- the boot sweep's zero-call settle branch (`:180-188`);
- and, under the adversarial's own P2, the **new `enabled:false` guard** would be a fourth.

So today, **three of the eight persisted note codes can be written to the durable store with no
operator-visible signal anywhere in the process** — not at the moment it happens, not aggregated. The
only adjacent signal is the boot-time missing-diagram count at `server.ts:1521`, which is emitted once
at startup and never again, and which reports a *count*, not a cause.

`MODEL_UNMAPPED` is the damning one. A `graphAnalyzer.model` that never reaches the analyzer — the
`composeConfig()` forwarding-gap class this repo has now paid for twice (v11 `updateFlagPath`, v15
auth) and built a dedicated wiring test for — **settles silently, per workflow, forever**. The
operator's only evidence is a `workflow_describe` note text they have to go looking for. Inv 5 exists
precisely to make that class loud.

**REBUT, on the code**: adversarial C3 answers my A2 objection with *"the journal line already carries
the outcome per run, and a settle emits it."* The second clause is false as shipped. Their #5
(“argue against a third surface”) rests on the same premise. I am not using this to reopen a new
surface — see §1.5, where I concede that — but the premise cannot stand, because the P2 guard they
propose would inherit exactly this silence.

**Amended invariant, replacing my r1's QD-O4** — and framed with *their own structural principle*,
which I accept:

> **ARCH-079 inv 5 (amended).** Exactly one journal line is emitted per **settle**, on every path that
> writes a terminal `workflow_diagrams` row — model-call settles, `MODEL_UNMAPPED`, `QUEUE_FULL`, the
> `enabled:false` guard, the boot-sweep settle, and the exceptional exit. The emitter therefore lives
> at the **settle choke point**, not inside `_attempt`; fields that only a model call can supply
> (`promptTokens`, `completionTokens`, `durationMs`, `gateFail`) are `null` on the paths that made no
> call, and the line carries an engine-classified `cause`.

The adversarial lens argued the `enabled` guard belongs at the `_startJob` choke point because a rule
enforced at callers is not a rule. **The identical argument applies to the emitter**: a journal line
written at one of six settle sites is not coverage. Adopting both puts the control and its observation
at the two choke points of the same state machine, which is a better architecture than either r1 had.

**No store migration.** The persisted `note_code` `CHECK` (`workflow-catalog.ts:240-241`) stays at
eight values; the *distinct* cause rides the journal line as a field, which `DES-129` already
established as the amendment shape when it ratified `gateFail` as the tenth field. This is my r1's
"middle path", now applied to a wider set of paths at no extra cost.

### 1.2 QD-O1 / their P6 — allowlist membership: **CONCEDE severity, adopt the widening rule**

We agree on the facts and on the text: inv 6 gains `meta.phases[].title`, `'default'`, `'model:param'`,
`UNBOUND_ENTRY_LABEL`, and loses `DIAGRAM_CODEPOINTS` to the separate codepoint pass. I filed this as
a documentary `(i)`; **they escalate LOW→MED on the ground that inv 6 is ADR-015's audit input. I
concede the escalation** — my own r1 argued exactly that ("not ordinary doc drift… inv 6 is where a
future reader checks that claim's membership list") and then filed it a category too low. Their P6
also does something mine did not: it records the **re-audit result per member**, and adds

> *"adding an author-controlled member requires that member to be independently non-owner-visible."*

**Adopt verbatim.** That clause is what makes the amendment an audit rather than a rubber stamp, and
it is the only new *rule* in their proposal I would defend on my own lens's grounds: it makes the next
widening observable as a decision instead of a one-line diff.

### 1.3 QD-O2 / QD-O3 / their P8's prune strike — no disagreement

`phases` is emitted and ARCH-081 + the interface table must say so; the `maxWorkflowVersions` **prune**
does not exist and must be struck from ARCH-077 inv 7, the derived-store paragraph and ADR-021 (the
ceiling *refuses registration*). Both panels reached these independently. Text edits, no code. The
inv-4 provider-status strike (`DES-129`, never carried into the architecture) is bundled with the inv-5
edit in §1.1 so it cannot be dropped while that row is open.

### 1.4 Their V-C — **adopt; this is my lens stated in their vocabulary**

> *"a seam added for happy-path determinism must also admit the failure the invariant claims to
> survive; otherwise the invariant is prose."*

ARCH-079 inv 8's `schedule` seam exists so tests can run the job deterministically; there is no seam
that makes `getTriggerBindings` or `putDiagramResult` throw, which is *why* A3 shipped untested. This
is the observability lens applied to the test harness rather than to production, and it costs nothing —
`ports` and `catalog` are already injected. **Adopt as an ARCH-079 clause.** It is also the mechanism
that makes §1.1's amended inv 5 falsifiable: a throwing `putDiagramResult` must still produce one
journal line.

### 1.5 QD-O6 (analyzer gauge on `/api/status`) — **CONCEDE to (iii) deferred, on my own verification**

My r1 proposed four counts on the existing `GET /api/status`, arguing ARCH-085's justification ("the
journal line is the same signal for free") had been empirically falsified. The adversarial lens
opposed a third surface. **I checked the premise instead of re-asserting it, and it does not survive:**

- `graph-analyzer.ts:259` passes `timeoutMs` into every `gateway.invoke`, and **both** gateway
  implementations enforce it with a real `AbortController` + `setTimeout`
  (`gateway/client.ts:151`, `:292`; `claude-agent-sdk-client.ts:472-473`). So there is no unbounded
  hang: the invoke always settles or aborts.
- With P3's `finally` releasing the slot on every exit, and §1.1's inv 5 emitting a line on every
  settle, the permanent wedge that the gauge existed to detect **becomes unreachable, and any
  approach to it is already loud**.

A monitoring surface whose only justification is a failure mode two other adopted fixes eliminate is
not worth new surface at a send-back gate. **Withdrawn to (iii), recorded as declined-with-reason.**

**What I hold**, and it is one sentence: ARCH-085's justification is only true *conditionally*, so the
amendment must say what it depends on —

> *"the journal line is an adequate readback **because** inv 2 releases in a `finally` and inv 5 emits
> on every settle; if either is weakened, this justification lapses with it."*

Without that, a future iteration deletes the `finally` and keeps the sentence, and the subsystem is
silently opaque again. That is the same "moving a check is not done until everything describing its
old home points at the new one" rule this send-back has now caught four times.

### 1.6 QD-O5 — `QUEUE_FULL`'s honesty is conditional (unchanged, and now jointly held)

Their P3 states it in nearly my words ("a wedged slot reports itself with the same string, so a lost
release is *indistinguishable from correct operation* at the surface"). Inv 2 must record that its
honesty **depends on** the release invariant. No daylight; noting the convergence so the writer takes
one sentence, not two.

---

## 2. Replaceability — decoupling & pluggability

The clean finding from my r1 stands and neither panel contests it: the LLM backend genuinely is a
config change (`GatewayClient` interface, shared alias table, `isKnownAlias` validation, real
`LiteLLMGatewayClient` fallback at the composition root), and all nine analyzer harness keys default at
exactly one site with operator override. The defect is one level down — the model-facing *vocabulary*
is transcribed, not decoupled.

### 2.1 A5 / their P4 vs my QD-R2 — **agree on mechanism, CONCEDE the vehicle**

Identical mechanism, reached independently: export the ordered glyph list from `diagram-gate.ts`,
interpolate it into the default `systemPrompt`, delete the false "third consumer" comment at
`server.ts:300`, and assert membership over **both** the shipped prompt string and
`rwe.config.example.json:59` (a file read — the copy that rots silently).

My r1 asked to elevate the general rule to a **new ADR**: *any vocabulary the engine both instructs a
model to produce and validates on the model's return has exactly one declaration in `src/`, built by
interpolation, never transcription.* **I concede the vehicle and keep the rule**: it lands as a note on
**ARCH-080**, not a new ADR row. Reasons, in order: (a) a new ADR at a send-back gate is ledger churn
this iteration can least afford — six ledger-honesty gaps are already on the board; (b) ARCH-080 is
where a future reader is already looking when they touch the vocabulary, which is the only place the
rule can actually fire; (c) the Karpathy tie-break in their §5 is right that the minimum artifact that
closes the deviation wins.

**What I hold and will not trade**: the rule must be written as a *class*, not as this instance. It is
the third recurrence — `IMPL-174`'s two independently-typed copies of `UNBOUND_ENTRY_LABEL` lost every
first diagram, one file away from this one, this iteration; and round 3 of `08-validation.md` records
the live failure as `GATE_REJECTED_SHAPE` / `gateFail:"codepoint"`, which *is* prompt-vs-gate vocabulary
disagreement. An amendment that only names the 13 glyphs will be re-litigated at v25 with a different
constant.

### 2.2 Their C4 — the REQ-104 asymmetry: **ADOPT; a real gap in my r1**

REQ-104 says *"no analyzer harness value is hard-coded in engine source"*, and interpolating the gate
vocabulary into the default prompt puts vocabulary in source. My r1 proposed the interpolation without
noticing the collision. Their resolution is correct and belongs in ARCH-080's note as written:

> the **default** prompt is source; an operator override replaces it **wholesale**; the **gate constant
> is unoverridable either way** — so an override can never *widen* the vocabulary, and an override
> carrying a wrong vocabulary self-diagnoses as `GATE_REJECTED_SHAPE`.

This is ADR-015's "the prompt is a hint, the gate is the control" restated at config level, and it is
the replaceability property that matters: swapping model class stays a config change, and the failure
mode of a bad swap is a *named note code*, not a silent wrong diagram. It also retires my QD-R3
(boot-time glyph linting of an operator's prompt) more cleanly than my own "declined, too fuzzy"
reasoning did — the override self-diagnoses at first use, so a boot-time lint buys nothing.

### 2.3 QD-R1 — ARCH-080's "exactly three consumers" (unchanged, jointly held)

One consumer, not three; the third named consumer (`docs/AUTHORING.md`) is **absent** rather than
duplicated; `server.ts:300`'s comment falsely claims to be it. Amend the text, delete the comment.

### 2.4 Their V-B — per-process bounds: **ADOPT, and it is a replaceability item too**

`_runningCount` / `_queue` / `_pendingKeys` are in-memory; `workflow_diagrams` is durable and shared;
ARCH-079 says "concurrency: 1" with no qualifier. One clause — *"these bounds are per-process; the
durable row is the only cross-process state and it has no lock; multi-instance over one catalog is out
of scope (DEPLOY §multi-instance)"* — costs a sentence and stops a future deployment topology from
silently doubling a bound the document presents as absolute. I explicitly **do not** want a distributed
lock here, for the same reason they don't: writing the constraint down *is* the fix.

---

## 3. Consumability — ease of use & low integration cost

Clean and unchanged: `script` is absent from the `WorkflowDescribeView` **type** so a leak is a `tsc`
error; the two-sided `EXPECTED_DESCRIBE_KEYS` oracle fails on both a leaked and a dropped field;
version-resolution error codes are byte-identical with run-admission's; `workflow_regenerate_diagram`
reuses `resolveWritePrincipal`.

### 3.1 A1 — **CONCEDE to P1's wiring; the predicted fight did not happen**

My r1 predicted the adversarial lens would reach for a thinner HTTP-only projection and pre-argued
against it at length. **They did not** — their P1 rejects the second projection on the same two grounds
I did (REQ-101's "the two masks cannot drift apart", plus an argument mine lacked: an anonymous caller
receiving `triggers: []` when three are bound is a *silent lie* under this iteration's own
honest-absence rule, so a `triggersWithheld` marker is the forbidden second shape wearing a hat). Both
panels independently reached **transport gate, singular projection**. That is the strongest signal this
round produces and the referee should treat A1's mechanism as settled.

**Where I concede to them**: their wiring is more precise than mine and I verified it —

- I wrote "under `auth.enabled:true` on a non-loopback bind". The real predicate is
  `dbindExempt = isLoopbackPeer(peer) && !isLoopback(bind)` (`server.ts:1719`), which is about the
  *peer* on a non-loopback bind. Their `!authEnabled ‖ loopback-peer ‖ resolvePrincipal → else 401` is
  the correct formulation and reuses REQ-089/D-BIND rather than inventing a per-surface policy.
- Their placement argument is one I had not made and which I confirmed: `dbindExempt` is computed at
  `:1719`, **outside** `if (authHandlers)` at `:1722`, and `authHandlers` is `authCfg && authTokenStore`
  — so the whole block is skipped when auth is off. A route *moved* into that block would 404 on every
  no-auth deployment, which is this product's majority posture. Their split — **gate joins
  `authHandlers` as the fourth `dbindExempt` member (401 or fall through), handler stays at
  `:1918-1930`** — is right, and it is why their R3 correctly downgrades the dispatcher-edit risk.

**Where I hold, and it is bounded**: auth across all of `/api/*` is a hardening iteration, not v23.
Their P1 is already scoped to the one route; I record the boundary explicitly so synthesis does not
widen it. And — whichever way `ADJ-A1` is ruled — **ARCH-083's clause is false under both outcomes and
must be amended**. Their R1 says the same thing from the other side ("the one outcome I will argue
against is leaving the documents claiming a gate that does not exist"). Jointly held.

I also adopt their two contingent doc edits (README §使用範例 「任何人都能問」, DEPLOY's describe-route
description), which my r1 missed entirely, and their testability oracle for P1 — including the
**parity assertion** that the HTTP 200 body is key-identical to the MCP tool's `result` under
`EXPECTED_DESCRIBE_KEYS`. That assertion is the direct mechanical guarantee of the singular-projection
property both of us are defending; without it, "one projection" is prose.

### 3.2 A6 drift-lock — **CONCEDE scope, HOLD shape**, and both panels understated the gap

Measured this round: `TOOL_NAMES` (`server.ts:188-242`) declares **39** tools, all 39 advertised via
`TOOL_NAMES.map(...)` at `:1856` and `:2050`. The drift-lock's `REQUIRED_TOOLS`
(`mcp-tools-list-schema.test.ts:28-39`) lists **10** — and the identifier appears exactly twice in the
file: its declaration, and `expect(tools.length).toBeGreaterThanOrEqual(REQUIRED_TOOLS.length)` at
`:64`. **It is a length floor. The names are never compared at all.** So it is weaker than their
"subset assertion" framing and weaker than my "hand-maintained membership" framing: `tools/list` could
rename every tool and this test stays green.

**Concede on scope.** My r1 implied a full two-sided assertion table now, and priced it as "a Gate 3
budget item". At 39-vs-10 that is a 29-row backfill inside a send-back gate — real scope creep, and my
own Risk #1 forbids it. Right-sized for v23, which is also all ARCH-082/ARCH-086 ever claimed:

1. **name set equality now** — `expect([...advertised].sort()).toEqual([...literal].sort())`, the
   literal list hand-written in the test (their P5, adopted);
2. **per-tool assertion rows for the two v23 tools only** — `workflow_describe`,
   `workflow_regenerate_diagram`;
3. **one literal assertion on `server.ts:493`'s served sentence** (today `grep -rn "deliberately NOT"
   tests/` has no hit — deleting REQ-101's load-bearing sentence turns nothing red).

**Hold on shape**, because the target shape determines whether v24 drifts again. State in ARCH-051 that
the lock's target is a **total per-tool table** — `Record<ToolName, Assertions>` — with the 29
uncovered tools recorded as a **named backfill debt with an owner**, not silently absorbed.

**Their objection answered head-on.** P5 rules that "the literal expectation stays in the test and is
never imported from `server.ts`", per the carried-in rule that a test whose oracle is the code under
test cannot fail when the code is wrong. I agree with the rule and my shape does not violate it: what a
total `Record<ToolName, …>` imports is a **type**, and a type cannot supply expected *content* — every
description, every required-field list stays hand-written. What the type buys is that adding a tool to
`TOOL_NAMES` makes the test **fail to compile** until its row exists, which is a stronger and earlier
lock than a runtime list that a one-word edit restores to green. Keep their runtime literal-list
equality **as well**: it is the assertion that survives a `tsc`-less run and it costs one line.

### 3.3 QD-C3 — grep allowlist is four entries, not three (unchanged)

Both panels filed it; they add "say the test pins the size so the number cannot re-drift". Adopt.

---

## 4. Self-sustainability — closed-loop autonomy & lifecycle management

### 4.1 A2 — **CONCEDE the placement; my r1's stated consequence was FALSE; the fix needs one more line**

**Concede placement.** Their P2 puts the guard at `_startJob` rather than on `sweepAtBoot`'s requeue
branch, and they are right for a reason I accept as architectural rather than stylistic: `_startJob` is
the single point at which this subsystem decides to spend a model call, reached from all three callers,
so a future fourth caller is covered by construction. A flag consulted at callers is not a control —
which is the same principle §1.1 uses to move the journal emitter. My r1's remedy would have closed
today's hole and left the shape that produced it.

My r1's stated *concern* about that placement is also resolved: gating `_startJob` does **not** strand
prior-life `pending` rows, because the sweep's zero-call settle branch (`:180-188`) never calls
`_startJob`. The concern applied only to gating the sweep wholesale, which nobody proposes.

**Self-correction — my r1 asserted something false, and it changes the remedy.** QD-S1 claimed that
settling `RETRIES_EXHAUSTED` was harmless because *"the read layer already synthesizes `DISABLED` at
describe time whenever `enabled:false` (`workflow-view.ts:130-138`), so the operator sees
`unavailable`/`DISABLED` for free."* **That is wrong.** `projectWorkflowDescribe` (`:129-137`)
synthesizes `DISABLED` **only in the `diagram === null` branch**; a row with
`status:'unavailable'` and a persisted `noteCode` takes the next branch and prints that note's text.
The adversarial lens described this correctly ("applied at `workflow-view.ts:131-133` for the *no-row*
case"); I did not.

And with the guard at `_startJob`, a row **always exists** by guard time — I verified both paths:
`enqueue` writes `putDiagramPending` at `:144` immediately before `_startJob` at `:145`, and
`sweepAtBoot` stamps `putDiagramPending(name, version, stamp)` at `:173` before its requeue. So the
`enabled:false` outcome an operator actually reads would be:

> `diagramStatus: 'unavailable'`, note text **"the diagram model could not be reached after several
> attempts"** — for a subsystem that made **zero** attempts because the operator switched it off.

That is a lie told by the honest-absence machinery, and it is the same defect class as `QUEUE_FULL`
being emitted by a dead queue (QD-O5): two internal states collapsed onto one user-visible string.

**QD-S1b — the completion, and it is one line.** The zero-migration A2 remedy is a package of four,
three of which are already agreed:

1. guard at `_startJob` (their P2) — no `gateway.invoke` on any path when `enabled:false`;
2. it **settles**, never returns leaving `pending` (their P2, ADR-017's property);
3. it settles the **persisted** `RETRIES_EXHAUSTED`, staying inside the eight-value `CHECK`
   (`workflow-catalog.ts:240-241`) — no migration, both panels agree;
4. **new**: the read layer synthesizes `DISABLED` for an `unavailable` row when
   `analyzerEnabled === false`, exactly symmetric with the existing no-row branch that already prefers
   the *current* flag over history:
   ```
   } else if (diagram.status === 'unavailable' && (diagram.noteCode || !analyzerEnabled)) {
     diagramNote = noteTextFor(analyzerEnabled ? diagram.noteCode : 'DISABLED');
   }
   ```
   (The existing `&& diagram.noteCode` guard is kept deliberately: a null `noteCode` must still fall
   through to `''` when the analyzer is enabled. The amendment widens the branch by exactly one
   disjunct; it does not relax it.)

**Scope class, stated so this is not read as creep** (my own Risk #1): this is **(ii)-adjacent — one
line in `workflow-view.ts`, inside the A2 remedy, not a new capability**. It adds no schema, no note
code, no surface. Without it, the agreed items (1)-(3) *ship a false note*, so it is part of finishing
A2 rather than an addition to it.

Semantics worth stating in the amendment: while `enabled:false`, "the analyzer is off" **is** the
present-tense true answer to "why is there no diagram" — the recovery action is refused too
(`mcp-facade.ts:462-464`) — and the persisted history is not lost, it is in the store and (after §1.1)
in the journal. This is REQ-104's "never an error" and REQ-102's honest absence, delivered honestly.

**Their R2, adopted**: with the guard at `_startJob`, an `enabled:false` *regenerate* on a `ready` row
would run `putDiagramPending` (nulling the diagram) before the guard settles, and that path is
unreachable **only because** `mcp-facade.ts:462-464` short-circuits to `ANALYZER_DISABLED`. That
short-circuit is now load-bearing and needs an assertion, not a comment. Agreed without reservation —
it is the same "a compensation standing in for an invariant" class as A10.

**Their C3, resolved by §1.1**: they expected me to object that a guard inside a private method is less
observable than one at a call site, and answered "a settle emits the journal line". It does not
(§1.1). With the amended inv 5, it will — and then the objection genuinely dissolves. The observability
requirement was never per-caller *code*; it was that the settle be visible, which is now an explicit
invariant rather than an assumed property.

### 4.2 A3 — no daylight, and both panels corrected the same overclaim

Their P3 and my QD-S2 are the same fix in the same words: releases in a `finally`, catch settles
`unavailable` **and emits the journal line**, `.catch()` at the `setImmediate` site, and no
`void promise` on an engine-owned path. Their V-A and my QD-S2 independently withdrew the same
overclaim — the crash-loop **is** bounded, because `sweepAtBoot` stamps at `:173` before scheduling, so
the next boot takes the zero-model-call branch. **Adopt V-A as ARCH-079 inv 9**: that ordering is
load-bearing and currently unwritten, and a refactor that moves the stamp after the requeue converts a
bounded cost into a restart-driven billing loop under `Restart=on-failure`.

Two panels independently retracting the same overclaim is the reason the surviving claim should be
believed: the real mechanism is **mid-run throw → lost slot → permanent wedge → every later
registration settling a designed-looking `QUEUE_FULL`, with no signal for any of it**.

### 4.3 QD-S3 — global `unhandledRejection`: **fully conceded, no fight**

Their §4 refuses it ("a global handler converts a crash into silent corruption everywhere"); my r1
already deferred it and conceded the ordering. `REQ-059`/`REQ-060` make restart-and-resume a *designed*
capability, so crash-only is a real posture here, not a hope. The `.catch()` at the one scheduler site
is the fix. Closed.

### 4.4 A4 — delete the mini-preview; **hold the call-site rule**

Agreed on the deletion and on the numbers (20N requests/min/tab, discarded, on the heaviest read v23
added). Their P7 adds the convergence observation I endorse: A1 removes the anonymous vector, A4
removes the amplifier, and either alone leaves half the hole open.

**Hold**, because they did not take it up: ADR-022's grep guard is **word-specific** (`skeleton`) and
structurally cannot catch a dead call site whose name no longer contains the word — which is exactly
how this survived. State in ARCH-083/ADR-022 that **a deletion item enumerates call sites, not just
definitions**: REQ-105's own "the deletion is not finished while something still describes the deleted
thing", extended with "…or still calls it". One sentence, and it is the rule that would have caught
this class rather than this instance.

### 4.5 A10 — adopt their structural cause; the remedy is unchanged

Both panels land on "state the window, correct the false comment, no schema". Their P8 supplies the
*cause* my QD-S5 lacked: **`generated_at` serves two state machines at once** — provenance stamp on
`ready`/`unavailable` rows, boot-sweep attempt marker on `pending` rows — which is why preserving a
prior diagram through `pending` needs `prior_*` columns and a migration, not a one-line `ON CONFLICT`
change. Adopt the cause into the ADR-017 amendment; it converts "we chose the cheap option" into "we
know why the expensive option is expensive". I am content to carry the schema variant as a named,
costed alternative rather than argue it — the loss degrades to `unavailable`, never to
stale-but-wrong, which is consistent with owner decision A1.

### 4.6 QD-S6 — long-horizon metabolism, still (iii), and I never proposed auto-retry

Their #4 expected this lens to want background self-healing of `unavailable`. It did not: my r1 filed
**no metabolism** (diagram rows accumulate; `maxWorkflowVersions` refuses rather than prunes, so a
long-running deployment eventually needs a human to deregister) and **no tool-liveness probe** as
explicitly **named, not built**. I side with ADR-017 against background retry for their reason — an
unbounded cost loop against a paid provider — and add mine: a module that cannot yet release its own
slot on a throw has not earned an unattended loop. Both remain (iii). QD-O3's finding that no prune
exists anywhere is the same fact from the documentary side, and the amendment should not accidentally
read as promising one.

---

## 5. Final position — what I ask the referee to adopt

| id | dim | class | ARCH/ADR | code? | status vs r1 |
|---|---|---|---|---|---|
| A1 = their **P1** | Consum. | (i)+(ii) | ARCH-083 (+README/DEPLOY, `ADJ-A1`) | gate joins `authHandlers` as 4th `dbindExempt` member | **conceded to their wiring** |
| A2 = their **P2** + **QD-S1b** | Self-sust. | (ii) | ARCH-085, ARCH-079 | guard at `_startJob`, settles; **+1 line in `workflow-view.ts`** | placement conceded, **remedy completed** |
| A3 = their **P3** / QD-S2 | Self-sust. | (ii) | ARCH-079 inv 2 | `finally` + `.catch()` | unchanged, jointly held |
| **inv 5 (amended)** — one line per **settle**, emitter at the settle choke point | Observ. | (ii) | ARCH-079 inv 5 (+ inv 4 strike) | move + widen the emitter | **widened; their C3 premise rebutted** |
| **V-A** inv 9 — stamp before schedule | Self-sust. | (ii) | ARCH-079 | none | **adopted from them** |
| **V-B** — bounds are per-process | Replace. | (ii) | ARCH-079 | none | **adopted from them** |
| **V-C** — a determinism seam must admit the failure | Observ. | (ii) | ARCH-079 inv 8 | none | **adopted from them** |
| A5 = their **P4** + **C4** | Replace. | (ii) | ARCH-080 note (**not** a new ADR) | interpolate + membership assertion | **vehicle conceded, rule + asymmetry held** |
| A6 = their **P5** + QD-C2 shape | Consum. | (ii) | ARCH-051, ARCH-082/086 | name equality + 2 v23 rows now; typed table as target; 29-row debt named | **scope conceded, shape held** |
| A4 / QD-S4 | Self-sust. | (i)+(ii) | ARCH-084, ADR-022 | delete 2 lines | + call-site rule held |
| A7 = their **P6** | Observ. | (i)→**MED** | ARCH-079 inv 6 | none | **severity conceded, widening rule adopted** |
| A10 = their **P8** / QD-S5 | Self-sust. | (i) | ADR-017 + comment | none | + their structural cause |
| QD-O2, QD-O3, QD-C3, QD-R1 | mixed | (i) | ARCH-081/077/083, ADR-021/022, iface table | comment delete only | unchanged, uncontested |
| QD-O5 | Observ. | (ii) | ARCH-079 inv 2 | none | unchanged, jointly held |
| ARCH-085's conditional justification (§1.5) | Observ. | (i) | ARCH-085 | none | **replaces QD-O6** |
| QD-O6, QD-R3, QD-S3, QD-S6 | — | **(iii)** | — | — | **declined for v23** |

**Net new mechanism across everything I now ask for**: their five (one predicate reuse, one `finally`,
one `.catch()`, one `if`, one exported constant), plus **one moved-and-widened `console.log`** and
**one line in `workflow-view.ts`**. Everything else is amendment text.

---

## 6. Remaining disagreements

1. **A6 backfill shape — the only live architectural disagreement.** They want the literal expectation
   kept out of anything imported from `server.ts`; I want a **total `Record<ToolName, …>`** as the
   *target* shape so `tsc` refuses an unasserted tool. My answer to their rule is that importing a
   **type** cannot supply expected content, so the oracle stays hand-written — but I acknowledge the
   rule they are protecting is sound and this is a judgement call about where "the code under test"
   ends. **If the referee sides with them, I lose little**: their sorted-name `toEqual` plus the two
   v23 rows closes this send-back's finding either way; what is lost is the guarantee against v24's
   eleventh tool. **The part I do not concede is the 29-row debt being recorded with an owner**, in
   either shape — an unrecorded gap is how a "load-bearing" claim (ARCH-086's own words) got made
   against a length-floor assertion.
2. **QD-S1b's read-layer line.** They have not seen it (it rests on facts I verified after their r1). I
   expect agreement on the defect — the false "retries exhausted" note is not defensible — but they may
   prefer settling *without writing a row* so the existing no-row branch synthesizes `DISABLED`
   naturally. **I considered that and reject it**: on both entry paths a row already exists by guard
   time (`:144`, `:173`), so "no row" now means a *deletion*, which is new destructive API on a derived
   store whose single deletion path is a verified-clean invariant. One read-layer line beats a second
   writer.
3. **A5's rule as a class vs as an instance** (§2.1). Conceded the ADR; still hold that the ARCH-080
   note must state the general rule. Low heat — I do not expect this to be contested, only skimmed, and
   skimming is how it becomes glyph-specific.
4. **A7 severity** is *resolved*, not disputed — I conceded to their MED. Recorded here only because
   their r1 listed it as an expected disagreement.
5. **Meta, and the risk I rate highest.** Every `(i)` item is a text edit whose only proof is that
   someone made it, and three of this send-back's ten deviations *are* ARCH text claiming behaviour the
   code does not have. Both panels now converge on the same list. **Gate 8 must re-verify each `(i)`
   item by grep, not by reading this gate's note** — otherwise the re-run reproduces the exact defect
   it exists to repair, which this ledger has recorded six times in v23 alone.
