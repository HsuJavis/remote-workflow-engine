# Quality-Dimensions Panel — Architecture, **Gate 2 RE-RUN**, Round 1 (v23)

> **This file replaces the v23 first-pass Gate 2 content of the same name.** That content is preserved
> in git (last version at `d294880`). This round is the **Gate 2 re-run demanded by the 2026-09-03
> Gate 8 review**, which returned `send_back: ["architecture","tests","impl"]`,
> `arch_consistent: false`, 10 deviations (3 HIGH / 3 MED / 4 LOW). Its `Next:` line assigns this gate
> "**A1 decision + the four ARCH amendments**", with A2/A3/A5/A6 routed onward to Gate 5 RED and
> Gate 6 — but A2's own text says "the re-run must address the **intent**, not just the line", so the
> two architectural invariants behind A2 and A3 are in scope here as well.

**Lens**: Observability / Replaceability / Consumability / Self-sustainability.
**Round**: 1 (independent proposal — written without reading the sibling `adversarial.r1` of this round).

**Citation provenance.** Every `file:line` below was re-read against the working tree this round unless
marked `[gr]`, meaning it is carried from the Gate 8 review panels, which state they re-verified
against `d294880`. Independently re-verified here: `server.ts:1173-1183`, `:1241-1245`, `:1902-1913`,
`:1918-1930`; `workflow-catalog.ts:236-242`; `graph-analyzer.ts:15-21`, `:120-146`, `:165-192`,
`:205-216`, `:300-345`; `grep -rn "unhandledRejection\|uncaughtException" src/` → **no match**;
`01-requirements.md:1016-1121`; and every `02-architecture.md` line cited below was located by grepping
its own quoted clause this round — note that three citations carried in the Gate 8 review panel are
**off by a few lines** (`ARCH-081` `api:` is `:1419` not `:1425`; `ARCH-080` `api:` is `:1410` not
`:1409`; `ADR-021`'s note is `:1507` not `:1508`), so the amending editor should trust the numbers
here over the review panel's.

---

## 0. Altitude determination (asked for explicitly, answered before anything else)

**This project is both a plain distributed system and an AI-agent system, and for the findings this
re-run exists to resolve, the agent altitude is the operative one — because v23 put an agent *inside
the engine's own boot path*.**

Reading `state.yaml`'s `tech_stack` and REQ-101..106:

- **Plain-system substrate**: Node 22.6+/TypeScript ESM, a hand-rolled JSON-RPC-over-HTTP server
  (`src/server.ts`, deliberately not `@modelcontextprotocol/sdk`), SQLite via `better-sqlite3`
  (RunStore + WorkflowCatalog + the new `workflow_diagrams` table), a browser dashboard, OAuth2,
  webhook ingress, systemd-driven self-update. All four dimensions apply here at **system altitude**.
- **Agent altitude, user-workload tier (v1–v22)**: `agent()` inside user-authored workflows, behind
  two `GatewayClient` implementations (`LiteLLMGatewayClient`, `ClaudeAgentSdkGatewayClient`), with a
  transcript, per-agent timing, and a run journal. This is the tier all prior iterations reasoned about.
- **Agent altitude, ENGINE tier (new in v23)**: the `graphAnalyzer` is the **first LLM call the engine
  makes on its own behalf**, unprompted by any user workflow — at registration
  (`graph-analyzer.ts:131-146`) and, critically, **at boot** (`sweepAtBoot`, `:165-192`, called from
  `server.ts:1505`).

That third tier is the whole story of this send-back. Three of the four HIGH/MED self-sustainability
and security findings (A1's payload, A2, A3) are not "the engine ran an agent badly" — they are
"**the engine's own lifecycle now depends on an agent, and the engine's lifecycle machinery was not
re-examined for that**". A model call on the boot path is a dependency on a remote, slow, fallible
service inside process startup; a fire-and-forget scheduler around it is a resource pool; an operator's
`enabled:false` is an **egress control**. None of those were true of `parseWorkflowSkeleton`, the pure
regex function v23 retired.

So: I apply **system altitude to the substrate** (routes, auth, config forwarding, SQLite invariants)
and **agent altitude to the analyzer** (liveness, egress control, token/cost observability, bounded
autonomy). I do **not** apply the user-workload agent tier — v23 changed nothing there.

---

## 1. Summary

The v23 design is, at the level of its written decisions, good: `ARCH-077..086` / `ADR-015..022` chose
one projection for two call sites, a closed engine-authored `noteCode` enum, an allowlist gate over
model output rather than a trusting prompt, honest absence instead of a degraded fallback, and a
`composeConfig()` wiring test for this repo's signature bug class. My Gate 8 pass confirmed most of
that is genuinely built.

**What the send-back exposes is a single pattern, repeated four times: an architectural claim that
the code does not honour, where the claim is the thing a future reader would audit against.**

- `ARCH-085` says `enabled:false` is "a first-class, tested state"; on the boot path it is not read at
  all, so the operator's only script-egress control silently does not apply (**A2 / SUS-1**).
- `ARCH-079` inv 2 says a full queue settling `QUEUE_FULL` is "honest absence working as designed";
  under a wedged slot that same code is emitted by a queue that is not full but dead (**A3 / SUS-2**).
- `ARCH-083` says the describe route is "auth-gated exactly as the route it replaces"; it makes no auth
  decision at all, and its sibling under the same URL prefix applies the opposite rule (**A1**).
- `ARCH-084` says the home-card mini-preview is "removed"; it survives as a dead call site issuing
  20N requests per minute per open tab (**A4 / SUS-3**).

Plus two vocabulary/contract items where a *duplicated declaration* is one edit away from the failure
this iteration already paid for once (**A5 / REP-1**, **A6 / CONS-1**), and four doc-only amendments
where `02-architecture.md` still describes a pre-adjudication shape.

My proposals are labelled **(i) required truth amendment** — the ARCH text is false and must be
corrected; **(ii) invariant the send-back demands** — a new or amended architectural rule; **(iii)
optional hardening, explicitly deferred** — considered and declined for v23, recorded so the referee
can see it was not overlooked. The referee can adopt all of (i) and (ii) cleanly and leave (iii).

**Not indicted.** For the record, my Gate 8 pass verified as clean and I am *not* reopening: the
derived-store deletion path and late-write guard (`workflow-catalog.ts:488-490`, `:265-289`); the
`noteCode` closed enum end-to-end with its SQL `CHECK`; `diagramStale` as the one `sha256` compare;
the `script`-absent-from-the-*type* projection and its two-sided `EXPECTED_DESCRIBE_KEYS` oracle;
registration never blocking on the analyzer; `graphAnalyzer` forwarded whole through `composeConfig()`
with three new wiring rows; `curateToolsForProvider` returning `[]`; the `<pre>`/`textContent` render
path; and `UNBOUND_ENTRY_LABEL`'s now-single declaration.

---

## 2. Observability — transparency of internal state (incl. traceability)

**Altitude: engine-tier agent.** The analyzer is a black box in exactly the way this lens forbids: its
only per-run signal is the journal line at `graph-analyzer.ts:287-296`, and that line is unreachable on
the failure path that matters most.

### QD-O1 — **(i)** amend `ARCH-079` invariant 6: the allowlist membership list is wrong in both directions

`ARCH-079` inv 6 (`02-architecture.md:1402`) defines the allowlist as
`parseWorkflowSkeleton(script)` ∪ resolved model aliases ∪ ARCH-078 trigger kinds/upstream ∪
`DIAGRAM_CODEPOINTS`. The implemented `_buildAllowlist` (`graph-analyzer.ts:225-247`) **adds four
members ARCH-079 does not name** — `meta.phases[].title` (`:231`), the literal `'default'` (`:233`),
the sentinel `'model:param'` (`:234`), `UNBOUND_ENTRY_LABEL` (`:241`) — and **omits
`DIAGRAM_CODEPOINTS`**, which is not a label token at all and is checked in the gate's own separate
codepoint pass (`diagram-gate.ts:39-43`).

This is not ordinary doc drift. **`ADR-015`'s entire security claim is "every token the diagram may
contain is already served on a masked surface today", and inv 6 is where a future reader checks that
claim's membership list.** An auditor reading the architecture would conclude the engine admits four
tokens it is not architecturally permitted to admit — and would not find the codepoint pass at all.
Amend in place citing adjudications #1 and #7. No code change; the code is correct.

### QD-O2 — **(i)** amend `ARCH-081` and the v23 interface table: `phases` is emitted

`ARCH-081` `api:` (`:1419`) pins `projectWorkflowDescribe` as emitting "exactly {…}" — a list with no
`phases`. The implementation emits it (`workflow-view.ts:94`, `:147`; `EXPECTED_DESCRIBE_KEYS` `:113`)
per adjudication #1 / DES-136 / IMPL-170, on the owner's 一律公開 ruling. The interface-contracts table
row for `workflow_describe` (`:1692`) omits it too. Amend both. No code change.

### QD-O3 — **(i)** strike the `maxWorkflowVersions` prune from `ARCH-077` and `ADR-021`

`ARCH-077` `api:`/inv 7 (`:1383`/`:1384`), the derived-store paragraph at `:1687` ("`maxWorkflowVersions`
prune. No sweep, no TTL, no GC"), and `ADR-021` (`:1507`) all assert a prune path that deletes
diagram rows. **There is no prune.** `maxWorkflowVersions` *refuses* the registration
(`workflow-catalog.ts:445`, `VERSION_CEILING_EXCEEDED`, per `ADR-014`), and the source says so at
`workflow-catalog.ts:231-233`. `DES-130` struck the clause at design level; the architecture was never
amended. The derived-store invariant is genuinely enforced by the single deletion path — only the text
is wrong. Strike it. No code change.

### QD-O4 — **(ii)** every exit from an analyzer job emits exactly one journal line, including the exceptional exit

Amend `ARCH-079` inv 5. Today the journal line is written inside `_attempt`; a throw from
`getTriggerBindings` (`:304`), `_buildAllowlist`, or `putDiagramResult` (`:326/329/334`) — or a
rejected `scriptPromise` — produces **no journal line, no `noteCode`, no boot line**. The subsystem
fails completely silently. That is this lens's definition of a design defect.

**Implementation shape — the middle path, chosen to avoid a store migration.** The persisted
`note_code` `CHECK` at `workflow-catalog.ts:240-241` pins **eight** values on a table with live rows;
adding a ninth is a schema migration on a shipped store. So: **settle the row with the existing
`RETRIES_EXHAUSTED`** (no migration), and carry the *distinct* engine-classified cause as a **field on
the journal line**, where there is direct precedent — `DES-129` ratified `gateFail` as the tenth field
one round ago. The alternative — a ninth persisted code (`JOB_FAILED`) plus a `CHECK` migration — is
more honest to a `workflow_describe` reader and I would take it in a hardening iteration; at a
send-back gate its cost is not justified. Referee should pick one explicitly; the failure mode to
avoid is picking neither.

**Bundled doc amendment, same invariant, easy to drop on the floor** — **(i)**: while inv 5 is open for
editing, `ARCH-079` **inv 4's provider-status clause** must also be struck in place. `DES-129` ratified
both that strike and `gateFail` as the tenth journal field, but only the *design* doc was amended; the
architecture still describes the pre-`DES-129` line shape. This is the second half of the Gate 8 LOW
that QD-O3 covers the first half of, and it is a text edit with no code change.

### QD-O5 — **(ii)** `QUEUE_FULL`'s honesty is *conditional*, and `ARCH-079` must say so

`ARCH-079` inv 2 calls a `QUEUE_FULL` settle "honest absence working as designed". Under a wedged slot
(QD-S2) it is emitted by a queue that is **not full but dead** — two distinct internal states collapsed
onto one user-visible code, which is precisely the opacity inv 4/5 built the journal line to prevent.
The right fix is to make the wedge unreachable (QD-S2), not to add a code; but inv 2 should state that
its honesty **depends on** the release invariant, so the two are never separated by a later reader.

### QD-O6 — **(ii, minimal seam)** an analyzer gauge on the existing `GET /api/status`

`ARCH-085` deliberately declined an effective-config readback surface, justifying it: *"ARCH-079's
journal line already carries the model per run, which is the same signal for free."* **SUS-2 falsifies
that justification** — the journal line is exactly what is absent when the subsystem breaks. A
justification that has been empirically falsified must be re-decided, not re-asserted.

Minimum seam, deliberately small: extend the **existing** `GET /api/status` handler
(`server.ts:1902-1913`, which already serves `agentSemaphore` via `semaphoreGauge()`) with
`graphAnalyzer: { enabled, running, queued, pending }`. **Counts only — never key names**, because
that route is unauthenticated (see QD-C1). This makes "the slot is wedged" a one-request question
instead of an unanswerable one, reusing an existing route and an existing gauge convention rather
than adding surface.

---

## 3. Replaceability — decoupling & pluggability

**Clean and worth stating**: the LLM backend genuinely is a config change here. The analyzer takes the
existing `GatewayClient` interface (`graph-analyzer.ts:94`), `graphAnalyzer.model` is an alias from the
same table `agent()` uses and is validated with the shared `isKnownAlias` (`server.ts:1492`), and the
composition root falls back to a real `LiteLLMGatewayClient` (`:1493-1494`) rather than an ad-hoc
narrower shape. All nine analyzer harness keys default at exactly one site (`server.ts:1472-1482`) and
every one is operator-overridable — `REQ-104`'s "no analyzer harness value is hard-coded" holds.

The defect is one level down: **the model-facing vocabulary is not decoupled, it is transcribed.**

### QD-R1 — **(i)** amend `ARCH-080`: the constant has one consumer, not three

`ARCH-080` `api:`/note (`:1410`/`:1411`) specifies `DIAGRAM_CODEPOINTS` as an exported constant with
"**exactly three consumers** — this gate, the shipped default `graphAnalyzer.systemPrompt`, and the
AUTHORING/tool-description text", and names that single-declaration rule as the control over both
failure directions. As shipped `[gr]`: `diagram-gate.ts:5` declares `VOCAB_GLYPHS` and `:22` exports
the constant; **nothing imports it**; `server.ts:306-311` re-types all 13 glyphs as prose literals;
`rwe.config.example.json:59` re-types them a third time; `docs/AUTHORING.md` carries no glyph
vocabulary at all, so the third named consumer is **absent** rather than duplicated; and
`server.ts:300` carries a comment falsely claiming to be that third consumer. Amend the text to the
truth, and delete the false comment.

### QD-R2 — **(ii)** elevate to an ADR: one declaration for any engine-instructs / engine-validates vocabulary

> **Proposed rule:** *any vocabulary the engine both instructs a model to produce and validates on the
> model's return has exactly one declaration in `src/`, and the prompt is built by **interpolation**,
> never by transcription. A second hand-typed copy — in source, in a shipped config template, or in
> docs — is a defect of the same class as a duplicated constant.*

This is architectural, not test debt, because it is the **third recurrence** of one class:
adjudication #7 / `IMPL-174` was two independently-typed copies of `UNBOUND_ENTRY_LABEL` disagreeing —
the engine instructed a token its own gate refused, and **every first diagram was lost** — fixed one
file away from this one, this iteration. And `08-validation.md`'s round-3 table records the live
failure mode as exactly `GATE_REJECTED_SHAPE` / `gateFail:"codepoint"`, i.e. prompt-vocabulary vs
gate-vocabulary disagreement.

The replaceability cost is concrete and named in `ARCH-085` itself: swapping to a model class that
needs a vocabulary edit — *`ARCH-085`'s own documented `qwen2.5:7b` case* — is today a three-place
hand-synchronised change with no test tying the places together. The third copy living in
`rwe.config.example.json` is **worse than a code copy**, because `ARCH-085` explicitly invites
operators to edit `systemPrompt` for their model class, and nothing tells them the vocabulary is
gate-checked.

Mechanism (small): export the ordered glyph list, interpolate it into
`DEFAULT_GRAPH_ANALYZER_SYSTEM_PROMPT`, and add one assertion that every glyph named in the shipped
prompt **and** in `rwe.config.example.json`'s `systemPrompt` is a member of `DIAGRAM_CODEPOINTS` — the
same one-declaration shape this codebase already applies to `ANALYZER_SCRATCH_SUBDIR` and
`UNBOUND_ENTRY_LABEL`.

### QD-R3 — **(iii) considered and declined** — boot-time glyph linting of an operator's `systemPrompt`

Tempting (it would close `REQ-104`'s operator loop), but "which characters count as vocabulary" is
fuzzy, a false boot warning on a legitimate prompt is worse than none, and QD-R2's membership assertion
plus interpolation already removes the hand-sync. Recorded as declined, not overlooked.

---

## 4. Consumability — ease of use & low integration cost

**Clean and worth stating**: `script` is absent from the `WorkflowDescribeView` **type**
(`workflow-view.ts:87-105`), so a leak is a `tsc` error; the two-sided `EXPECTED_DESCRIBE_KEYS` oracle
(`:110-117`) fails on both a leaked field and a dropped one; version resolution reuses
`resolveVersionRequest` so `CHANNEL_UNPUBLISHED`/`UNKNOWN_VERSION` are byte-identical with
run-admission's; `workflow_regenerate_diagram` is the fourth call site of the shared
`resolveWritePrincipal` helper rather than a re-implementation; and the advertised descriptions
themselves are genuinely good — `server.ts:493` enumerates every returned field and states "The raw
workflow script is deliberately NOT part of this response, on any principal".

### QD-C1 — **the A1 decision.** **(i)** `ARCH-083`'s auth clause is false as shipped; **(ii)** gate the transport, keep the projection singular

**The fact.** `ARCH-083` `api:` (`:1437`) — repeated verbatim in the v23 interface-contracts table
(`:1698`) — says `GET /api/workflows/:name/describe` is "**auth-gated exactly as the route it
replaces**". It is not. The route (`server.ts:1173-1183`) makes no auth decision — its own
comment says *"Unauthenticated with no owner branch to make … so `ctx` here makes no masking decision
either"* — and it passes `{ authEnabled, principal: null }` into the facade. `/api/workflows*` is
dispatched at `server.ts:1918-1930`, outside the `authHandlers` block. The replaced `/skeleton` route
**did** branch on `authEnabled` `[gr]`, and the sibling `/api/runs/:id/dag` at `server.ts:1241-1245`
applies the **opposite** rule today — `authEnabled ? [] : parseWorkflowSkeleton(skeletonScript)` — a
line `REQ-105` explicitly requires stay closed ("v22 finding H2 closed exactly this hole; v23 must not
re-open it"). `DES-132` overrode `ARCH-083` without amending it, which is carried-in rule 3 verbatim
("moving a check is not done until everything that described its old home points at the new one",
nine recorded instances).

**Honest counterweight, stated up front.** Unauthenticated `/api/*` is a **pre-existing posture** —
`/api/runs/:id` already serves `principal`. I am not claiming v23 invented the exposure. The
v23-incremental part is that this route serves `owner` + raw cron expression/timezone/upstream
`triggers[]` + `versions[]` + `diagram`, none of which are in `EXPECTED_NON_OWNER_KEYS`
(`workflow-view.ts:59-62`) `[gr]`.

**My lens's recommendation — a position, not a menu.** Gate it at the **transport**: under
`auth.enabled:true` on a non-loopback bind the route requires a bearer and answers 401. Do **not**
fork a second, HTTP-only masked projection.

The reasoning is derivable from this lens rather than borrowed from the security lens. My own Gate 8
pass listed "**one projection, two call sites**" as clean, and `REQ-101`'s acceptance is explicit that
the describe mask and the `workflow_get` mask "**cannot drift apart**". A field-level fork — serving a
thinner object over HTTP than over MCP — re-opens exactly the drift `REQ-101` exists to prevent, and
replaces one auditable projection with two that will disagree by v25. A transport gate leaves the
projection singular and costs one branch.

**Accepted cost, named not hidden**: an unauthenticated dashboard under `auth.enabled:true` loses the
workflow-detail diagram. That is honest absence — the same accepted-cost family `ARCH-083` already
records when it accepts that "the dashboard workflow-detail view loses its predicted-DAG preview until
a diagram is `ready`". And owner decision A1 already forbids a degraded fallback drawing on the
absence path, so no fallback may be introduced to soften this.

**Bounded, deliberately.** Auth across *all* of `/api/*` is a hardening iteration, not v23 — it touches
`/api/runs/:id`, `/api/issues`, `/api/system`, `/api/models` and the whole dashboard fetch layer. This
gate's obligation is the route v23 created plus the false sentence. **Whichever way the referee
decides, `ARCH-083`'s clause must be amended, because it is false under both outcomes.**

### QD-C2 — **(ii)** `ARCH-051`'s drift-lock membership must be a two-sided set equality, not a hand-maintained subset

`ARCH-082` (`:1429`) and `ARCH-086` (`:1465`) both assert "**Both new tool schemas join ARCH-051's
structured drift-lock test**", and `ARCH-086` calls the discoverability half "the load-bearing half".
The test does not exist: `tests/integration/mcp-tools-list-schema.test.ts:28-39` lists **ten** tools
and neither v23 tool `[gr]`. The only assertions reaching them are two generic loops a one-word
description would pass. `grep -rn "deliberately NOT" tests/` has no hit — deleting `REQ-101`'s
load-bearing sentence from `server.ts:493` turns nothing red.

**The architectural fix is the shape of the lock, not two more names.** A hand-maintained
`REQUIRED_TOOLS` will drift again at v24 — it just did, twice in one iteration, on an ARCH that
*claimed* membership. And the obvious repair is wrong: **deriving `REQUIRED_TOOLS` from the advertised
list would make an eleventh tool pass on the two generic loops**, which is the exact failure being
fixed. The correct shape is **two-sided set equality — advertised tool names == per-tool assertion-table
keys** — the same oracle shape as `EXPECTED_DESCRIBE_KEYS`, so adding a tool without writing its
per-tool row is a test failure rather than a silent omission.

**One-time cost, stated so it is not discovered at Gate 6 and mistaken for a regression**: this turns
the currently-uncovered advertised tools red until their assertion rows are backfilled. That backfill
is real work inside this iteration and should be budgeted at Gate 3, not absorbed.

### QD-C3 — **(i)** the grep allowlist is four entries, not three

`ARCH-083`'s note (`:1438`) and `ADR-022` (`:1513`) describe a **three**-entry internal allowlist for
the `skeleton` grep guard; the
test pins **four** (`tests/unit/no-skeleton-surface.test.ts:36`, the fourth added by adjudication #3)
`[gr]`. Amend the count in both. No code change. (Raised on the adversarial side at Gate 8; this
re-run owns it.)

---

## 5. Self-sustainability — closed-loop autonomy & lifecycle management

**Altitude: engine-tier agent.** This is where the send-back's two HIGHs live, and where the v23 design
did not follow its own agent into the engine's lifecycle.

**Clean and worth stating**: a failure never clobbers a prior `ready` row (both settle paths restore
it); registration never blocks and never fails on the analyzer; single-flight is keyed `name@version`;
`IMPL-172`'s zero-config fail-closed guard forces `tools: []` with a boot line when no `workRoot`
resolves; and adjudication #6 V-2's unguarded-spawn defect **was** fixed in
`gateway/litellm-proxy.ts` — which is what makes QD-S2 the *same class, one file away, one round later*.

### QD-S1 — **(ii)** `ARCH-085`: `enabled:false` is a **fail-closed egress control**, on every path

`sweepAtBoot()` (`graph-analyzer.ts:165-192`) never reads `this._config.enabled`. Its
`generated_at === null` branch (`:171-179`) calls `_startJob`, which schedules a real
`gateway.invoke()` **carrying the workflow script**. `server.ts:1505` calls the sweep unconditionally
and the comment at `:1502-1504` states that intent explicitly — which is why the amendment must
address the intent, not the line.

Why this is more than a missed `if`: **`enabled:false` is the only control `DES-134` offers an operator
for the fact that registration now performs an outbound LLM call whose payload is the workflow script
itself.** The realistic failure is an operator who accumulates a `pending` row, then reads DEPLOY.md,
learns the script is shipped to the provider, sets `enabled:false` *because of that*, restarts — and
the engine sends the script anyway. On the shipped zero-config path the provider is a local
LiteLLM/Ollama, but nothing in the design assumes that, and the DES-134 sentence exists for the
deployment where it is not.

**Proposed invariant:** *no `gateway.invoke()` occurs on any path — registration, regenerate, or boot
sweep — when `graphAnalyzer.enabled` is false.* **Precision matters in the remedy**: do **not** gate
the whole sweep on `enabled`, or prior-life `pending` rows are stranded forever — the sweep's *second*
branch (`:180-188`) is the zero-model-call settle that must keep running. Gate only the **requeue**
branch. The mechanical form is a spy gateway asserted never invoked across **all** entry points
including `sweepAtBoot`, not a unit row on one path.

**Secondary, same root, worth fixing together:** under `enabled:false` the facade refuses
`workflow_regenerate_diagram` (`mcp-facade.ts:462-464`) `[gr]`, so `ADR-017`'s single recovery action
is unavailable for exactly the row the sweep just requeued. Settle that row instead of leaving it
`pending` — and settle it `unavailable` with the **persisted** `RETRIES_EXHAUSTED`, **not** with
`DISABLED`: `DISABLED` is READ-SYNTHESIZED ONLY (`graph-analyzer.ts:15-21`) and is absent from the
persisted `CHECK` (`workflow-catalog.ts:240-241`), so writing it would be the very migration Risk #3
exists to avoid. No schema change is needed anyway, because the read layer already synthesizes
`DISABLED` at describe time whenever `enabled:false` (`workflow-view.ts:130-138`) — so the operator
sees `diagramStatus:'unavailable'` / `DISABLED` for free, which is exactly `REQ-104`'s last clause
("never an error") and `REQ-102`'s honest absence.

### QD-S2 — **(ii)** `ARCH-079` inv 2: pool release belongs in a `finally`, and no promise leaves engine source unterminated

There is **no `try`/`catch`/`finally` anywhere on the job path.** The single-flight key and the
concurrency slot are released only on the normal fall-through at the tail of `_runJob`
(`graph-analyzer.ts:337-343`) — `_pendingKeys.delete(key)`, `_runningCount--`, then drain the queue —
which sits *after* every statement that can throw. The production scheduler is
`setImmediate(() => { void job(); })` (`:127`), and `grep` finds **no `unhandledRejection` or
`uncaughtException` handler anywhere in `src/`** (verified this round).

To be clear about what is *not* wrong: the fire-and-forget scheduler is **correct** — `REQ-102`
requires registration never to block on the analyzer, and `enqueue` returning before the job runs is
the requirement, not a defect. What is missing is the **terminal handler**, not the async.

Throw sources that are not covered (the gateway's own errors *are* caught, at `:263-267`):
a rejected `scriptPromise` from `sweepAtBoot`'s `this._catalog.resolve(name, {version}).then(...)`
(`:177`) with no `.catch` — note the author **did** guard the analogous path in `regenerate` (`:160`)
and did not guard this one; `putDiagramPending` having no version-existence guard (unlike
`putDiagramResult`), so an `enqueue` racing a `deregister` leaves a `pending` row whose version row is
gone `[gr]`; `getTriggerBindings` (`:304`) reading three separate SQLite files; and `putDiagramResult`
(`:326/329/334`) taking `.immediate()` write locks on a database two processes can contend for.

**Accuracy correction I am making against my own Gate 8 write-up, because the fix should land on the
real mechanism.** The boot-crash case is **already bounded to one restart**: `sweepAtBoot` stamps every
`generated_at === null` row synchronously (`putDiagramPending(name, version, stamp)`, `:173`) *before*
any job fires, so a next boot settles those rows through the second branch with zero calls. There is no
"crashes forever on every boot" loop. The surviving core is therefore: **(a)** a mid-run throw, where
`finally` is the only fix; **(b)** the permanent-wedge case if the throw is swallowed by a host handler
— `_runningCount` stuck at 1, the key stuck in `_pendingKeys`, every later `enqueue` queued and never
drained, and after `maxQueueDepth` every registration settling the *designed-looking* `QUEUE_FULL`
(QD-O5); and **(c)** the total absence of a signal for either (QD-O4). This is a narrower claim than
"the engine dies on boot", and I would rather the invariant land on the accurate mechanism.

**Proposed invariant:** *a bounded resource pool releases its slot and its single-flight key in a
`finally`, never on the success path; and no promise is scheduled in engine source without a terminal
handler.* Adopting this also retro-covers the `litellm-proxy.ts` fix as an instance of a stated rule
rather than a one-off.

### QD-S3 — **(iii) deferred, and the item most likely to split the panel** — a process-level `unhandledRejection` handler

I want a long-running daemon to survive a defect in one subsystem. But the fail-fast counter-argument
is genuinely strong **here specifically**, and I will not pretend otherwise: this engine already ships
`REQ-059`/`REQ-060` resume-after-restart, so crash-only is a *designed capability*, not a hope, and a
global handler that swallows would hide the very defect class this proposal is arguing to expose.

My position: **QD-S2's `finally` plus QD-O4's journal line is the real fix and must land regardless.**
A global handler is defence-in-depth only, and only acceptable if it **logs with an engine-classified
code and never silently continues**. Deferred out of v23.

### QD-S4 — **(i)** `ARCH-084` is false; **(ii)** a deletion item enumerates **call sites**, not definitions

`ARCH-084` `api:` (`:1446`) and the v23 interface table (`:1699`) say the home-card mini-preview is
"**removed**, with no substitute drawing"; `DES-133` says it "renders **nothing**".
`renderMiniPreviewAsync` (`dashboard-page.ts:227-231`) survives as a function whose entire body is a
fetch whose callback returns immediately, still called per card (`:243`) inside `renderHomeGroup`,
which `loadHome` re-runs for all three groups (`:298-300`) on every tick of `setInterval(render, 3000)`
(`:496`) `[gr]`.

So an open dashboard on the home view issues **one `/api/workflows/:name/describe` per registered
workflow every 3 seconds — 20N requests per minute per tab — and discards every response.** That route
is the most expensive read v23 added: `resolveDetail` + `parseMeta` + `validateCurrent` + `getDiagram`
+ `getTriggerBindings` across three SQLite files plus a `RunStore` join `[gr]`. **A system that
generates its own load, scaling with N, on its newest and heaviest route, is a self-sustainability
defect** — and it is invisible because it is load, not error.

The architectural half: `ADR-022`'s grep guard is **word-specific** (`skeleton`) and structurally
cannot catch a dead call site whose name no longer contains the word. State in `ARCH-083`/`ADR-022`
that a deletion item enumerates **call sites**, not just definitions — `REQ-105`'s own words ("the
deletion is not finished while something still describes the deleted thing") extended with "…or still
calls it". Remedy is two lines deleted.

### QD-S5 — **(i, comment only)** `DES-127` B5 does not survive a restart

`graph-analyzer.ts:176-179`'s comment asserts the prior-row restore survives a restart; it does not
`[gr]`. Amend the comment. **Explicitly do not** add schema to persist a shadow copy of the prior
diagram — the reviewer classed this LOW, the window is narrow, and a shadow copy is real store cost
plus a new `CHECK` interaction for a cosmetic gain.

### QD-S6 — **(iii) named, not built** — the long-horizon metabolism gaps

Recorded because this lens's fourth clause is long-term autonomous survival, and both are real:
**(1) no metabolism** — diagram rows accumulate per `(name, version)` with no prune (QD-O3 confirms
none exists anywhere), and `maxWorkflowVersions` *refuses* registration rather than pruning, so a
long-running deployment eventually hits `VERSION_CEILING_EXCEEDED` and requires a human to deregister.
**(2) no tool-liveness probe** — the analyzer never checks its gateway is alive; during a provider
outage every registration settles `unavailable/RETRIES_EXHAUSTED` and the only aggregate signal is the
boot missing-diagram count (`server.ts:1521`), which is emitted at boot and never again (QD-O6 is the
cheap partial answer). Neither is v23 scope. Record; do not build.

---

## 6. Key points (referee adoption table)

| id | dim | class | ARCH/ADR touched | code? | ships at |
|---|---|---|---|---|---|
| QD-C1 | Consum. | (i)+(ii) | ARCH-083 | yes — one transport branch | **this gate decides**, Gate 6 fixes |
| QD-S1 | Self-sust. | (ii) | ARCH-085, DES-134 | yes — gate the requeue branch only | Gate 5 RED → Gate 6 |
| QD-S2 | Self-sust. | (ii) | ARCH-079 inv 2 | yes — `finally` + `.catch` at `:127` | Gate 5 RED → Gate 6 |
| QD-O4 | Observ. | (ii) | ARCH-079 inv 5 | yes — journal line on the throw path | Gate 5 RED → Gate 6 |
| QD-O5 | Observ. | (ii) | ARCH-079 inv 2 | no (text; depends on QD-S2) | this gate |
| QD-S4 | Self-sust. | (i)+(ii) | ARCH-084, ADR-022 | yes — delete 2 lines | this gate + Gate 6 |
| QD-R2 | Replace. | (ii) | ARCH-080 (+ new ADR) | yes — interpolate + 1 assertion | this gate + Gate 6 |
| QD-C2 | Consum. | (ii) | ARCH-051, ARCH-082, ARCH-086 | test-side, with backfill cost | Gate 3 budget → Gate 5 |
| QD-O6 | Observ. | (ii) | ARCH-085 | yes — 4 counts on an existing route | Gate 6 |
| QD-O1 | Observ. | (i) | ARCH-079 inv 6 | **no** | this gate |
| QD-O2 | Observ. | (i) | ARCH-081 + iface table | **no** | this gate |
| QD-O3 | Observ. | (i) | ARCH-077, ADR-021 | **no** | this gate |
| QD-R1 | Replace. | (i) | ARCH-080 | comment delete only | this gate |
| QD-C3 | Consum. | (i) | ADR-022, ARCH-083 | **no** | this gate |
| QD-S5 | Self-sust. | (i) | — (source comment) | comment only | this gate |
| QD-R3 / QD-S3 / QD-S6 | — | **(iii)** | — | — | **declined for v23** |

The doc-only amendments the reviewer's `Next:` line assigns this gate are **QD-O1**, **QD-O2**,
**QD-O3 + the inv-4 provider-status strike bundled under QD-O4**, **QD-C3**, **QD-R1**'s false-comment
delete and **QD-S5** — note that QD-C3 and QD-S5 originated on the adversarial side; this re-run owns
them regardless of which panel raised them. All are grep-verifiable at Gate 8.

---

## 7. Risks

1. **Scope creep at a send-back gate.** This gate's mandate is A1 + the amendments + the two
   invariants A2/A3 demand. QD-R3, QD-S3 and QD-S6 are labelled (iii) precisely so they cannot be
   silently promoted into v23 during synthesis. If the referee wants any of them, it should be an
   explicit ratification, not an absorption.
2. **A1 read too broadly kills the iteration.** "Authenticate `/api/*`" touches `/api/runs`,
   `/api/issues`, `/api/system`, `/api/models` and the dashboard fetch layer, and collides with a
   pre-existing posture decision. QD-C1 is deliberately bounded to the route v23 created. If the panel
   widens it, v23 does not close this week — that trade should be made consciously.
3. **A store migration smuggled in via a `noteCode`.** The `CHECK` at `workflow-catalog.ts:240-241`
   pins eight values on a table with live rows. QD-O4's middle path exists to avoid that; if the
   referee prefers a ninth persisted code, the migration is the cost and must be scheduled, not
   discovered at Gate 6.
4. **QD-S3 over-corrected into a swallow-everything handler.** A global `unhandledRejection` that
   catches and continues silently would *reduce* observability — the exact opposite of what sections 2
   and 5 argue for. This is why it is deferred rather than proposed with a caveat.
5. **QD-S1 fixed too bluntly.** Gating `sweepAtBoot` *as a whole* on `enabled` strands every prior-life
   `pending` row permanently, because the second branch is the zero-call settle. The remedy is one
   branch, and a reviewer skimming "gate the sweep on enabled" will implement the wrong one.
6. **QD-C2's backfill mistaken for a regression.** Two-sided set equality turns currently-green
   advertised tools red until their per-tool rows exist. Budget it at Gate 3.
7. **The meta-risk, and the one this iteration has actually realised six times.** Every (i) item is a
   *text edit whose only proof is that someone made it*. This ledger recorded **six ledger-honesty
   gaps in v23 alone**, and three of this send-back's findings are ARCH text that claims something the
   code does not do. An amendment that is announced but not made reproduces the exact defect this gate
   exists to repair. Gate 8 should re-verify each (i) item by grep, not by reading the gate note.

---

## 8. Expected disagreements with the other lenses

**With the adversarial lens — on A1's mechanism (not its severity).** We will agree it is HIGH and must
be resolved. I expect them to reach for the fix that most directly shrinks the payload: a thinner,
HTTP-only projection that drops `owner`/`triggers`/`versions`. **I will argue against that
specifically**, on this lens's own grounds — `REQ-101`'s acceptance says the masks "cannot drift
apart", my Gate 8 pass listed "one projection, two call sites" as the clean property, and a field-level
fork replaces one auditable projection with two that will disagree within two iterations. Transport
gate, singular projection. Expect a real argument here.

**With the adversarial lens — on QD-S3, fail-fast vs survive.** I expect them to argue that a global
`unhandledRejection` handler masks defects and that crash-only is correct. That argument is stronger
here than usual because `REQ-059`/`REQ-060` already make restart-and-resume a designed capability, and
I have conceded the ordering rather than fought it. Likely referee outcome, which I would accept: the
`finally` lands, the global handler is deferred.

**With the adversarial lens — on SUS-2's severity, where I am arguing *down* against my own Gate 8
text.** The attempt-marker at `graph-analyzer.ts:173` already bounds the boot case to one restart, so
"process death on every boot" is not the mechanism. I expect the adversarial lens to hold it at HIGH on
the process-death reading. I would rather the fix be justified by the wedge-plus-silence mechanism that
is actually real, because an invariant adopted on an overstated premise is the first thing a future
iteration deletes.

**With a simplicity/YAGNI reading — on QD-O6.** "New surface at a send-back gate" is a fair objection.
Pre-empting it: four integer counts, on a route that already exists and already serves a gauge of
exactly this shape, and it is the direct replacement for an `ARCH-085` justification that SUS-2 has
falsified. If the panel still cuts it, the falsified sentence in `ARCH-085` must at minimum stop
claiming the journal line is an adequate readback.

**With a simplicity reading — on QD-R2 and QD-C2 as "test debt, not architecture".** I hold both are
architectural: QD-R2 because it is the third recurrence of the engine-instructs/engine-validates
split-vocabulary class and round 3's live failure is literally that class; QD-C2 because the shape of
the lock — hand-maintained subset vs two-sided equality — is a design decision that determines whether
v24 drifts again, and `ARCH-082`/`ARCH-086` already staked a load-bearing claim on it.

**With the traceability/process reading — on churn.** QD-O4 changes `ARCH-079` inv 5's pinned-field
count for the **second time in one iteration** (`DES-129` added `gateFail` as the tenth). Expect
pushback that the invariant is being edited faster than it is being honoured. Fair; my answer is that
inv 5's *purpose* — no opaque failure — is precisely what the throw path violates, so the edit is the
invariant catching up to its own intent rather than accommodating the code.

**Where I expect no disagreement at all**: QD-O1, QD-O2, QD-O3, QD-C3, QD-S5 — five text corrections
where code and design are already right and only `02-architecture.md` is stale. These should be
adopted without debate and verified by grep at Gate 8.
