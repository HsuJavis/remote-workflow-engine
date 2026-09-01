# Design panel — Adversarial group (interface-contract / boundary-error / testability), round 2

**Feature:** 001-remote-workflow-engine · **Iteration:** v22 (REQ-096..100 → ARCH-071..076, ADR-009..014)
**Stage:** Gate 3+4 (Tasks + Detailed Design), debate round 2 — response to `quality-dimensions.r1.md`,
final position, residual disputes.
**Read this round:** `quality-dimensions.r1.md` (full, v22), my own `adversarial.r1.md` (v22),
`02-architecture.md` v22 slice (ARCH-071..076, ADR-009..014, 4+1 views, data architecture, decision
rationale), `01-requirements.md` REQ-096..100 + Round-v22 clarification.
**This document is the delta.** r1 items not mentioned here stand unchanged and are restated by ID in §6
for the synthesizer.
**Tie-breaker unchanged:** Karpathy simplicity-first — the minimum design that solves the problem.

Round 2 produced **two new primary-source findings** neither lens had in r1. One of them makes an
architecture decline (`lastError`) unsafe on its stated rationale; the other converts my `validation`
recommendation from a preference into a REQ-100 compliance requirement. They are §1. Round 2 also
produced **two reversals of my own r1 positions** (§2B.4 conceded, `createRun`'s `scriptVersion` made
required), and the first is load-bearing — it repairs the argument my highest-severity finding rests on.

**Convergence accounting up front:** of quality's 4 headline items and 12 design details, I **concede or
converge on 13**, hold 2, and reduce 1. Three items go to the synthesizer as live disputes (§7). The
friction quality predicted from my lens does not exist: they expected me to demand admission *enforce*
the environmental checks — I do not, I side with ADR-013's observe/refuse split exactly as they do.

---

## 1. New primary-source findings (round 2, verified this session)

### N-1 — the scheduler's failed-dispatch path is a 2 Hz hot loop, and its own code comment is false

`server.ts:1294-1309` is the driver loop. Each tick, `tick()` returns the due firings; each due firing
calls `runManager.start(...)`, and `scheduler.markFired(firing, runId)` runs **only in `.then()`**.
`markFired` (`scheduler.ts:258-272`) is the sole writer that **advances a schedule after a firing** —
`nextFire`, `lastFire` and the `once` auto-disable. (`create()` and `rearmAtBoot()` also write
`nextFire`, at creation and at boot; neither runs on the firing path.) The `.catch()` at `:1300-1308`
writes **nothing** — it logs and returns.

Consequence: a firing whose `start()` rejects leaves `nextFire` unchanged and in the past. The next tick
— **500 ms later** (`new RealTicker(500)`, `:1293`) — finds the same schedule due, dispatches again,
fails again, logs again. Forever, at 2 Hz, with no bound and no backoff. The comment sitting directly
above that catch says:

> *"A failed dispatch (e.g. the catalog entry was deleted after the schedule was created) must not wedge
> this schedule as permanently 'due' — a bare console.error surfaces it without crashing the driver loop"*

The comment states the requirement correctly and the code does the opposite of it. `lastFire` also never
advances, so `schedule_list` reports the schedule as if it had never fired — the operator's only
read surface shows *silence*, not failure, while the log fills at two lines per second.

**Reachability, stated honestly (this is a correction of my first framing).** I initially wrote that v22
makes this routine via fire-time `CHANNEL_UNPUBLISHED`. Walking the states, that is **wrong** and I
withdraw it: the ADR-011 migration publishes `release` for every pre-v22 name; `Scheduler.create`
(ARCH's own addition) requires the name to resolve on `release`; `publish` refuses `UNKNOWN_VERSION`;
there is **no unpublish tool**; and with my §2B.4 concession below there is no per-version delete. So
post-v22 a `release` pointer can never become NULL or dangle, and fire-time `CHANNEL_UNPUBLISHED` is
**unreachable by construction**. The honest statement is narrower and still sufficient:

- The hot loop is **pre-existing** and reachable **today** via name-granular `deregister`
  (`workflow-catalog.ts:227-238`) — exactly the case the false comment names.
- v22 does not create it, but v22 **keeps it live**: ARCH's interface table says each fire "resolves
  `release` again at fire time", so the fire path gains resolution failure modes rather than losing them.
- Its blast radius **grows to `CHANNEL_UNPUBLISHED` the moment a per-version delete lands** — which is
  precisely what quality's SUS-1 stages for a future iteration and what my own r1 §2B.4 proposed for
  *this* one.

**This is why it belongs in v22's design and not a bug ticket:** the architecture *declined* the fix on a
rationale this finding falsifies. The declined-list entry reads "a schedule `lastError` column for SUS-5
(closed instead at the front door: `Scheduler.create` requires the name to resolve on `release`)". A
front-door check cannot cover a name deregistered *after* creation, and the failure mode it leaves
behind is not the invisibility quality worried about — it is a retry storm. **I am reopening a recorded
architecture decline, explicitly, on new evidence (§7.2), not designing around it silently.**

### N-2 — `workflow_status` is not principal-gated, so the non-owner `validation` shape is decided by REQ-100, not by taste

I checked the gate my r1 instinct assumed. `mcp-facade.ts:152-154` surfaces `principal` in the
`workflow_status` envelope; nothing **gates** on it, and `server.ts:803` dispatches `workflow_status`
with no `ReadContext`. Run reads are ungated by principal today.

ARCH-072 puts the admission-time `validation` observation on the **run record**, and quality's OBS-1
(correctly) demands it be readable on `workflow_status` / `/api/runs/:id`. Compose that with quality's
lead recommendation — `validation: {ok, errors[]}` in the non-owner `workflow_get` view — and with the
alternative (owner-only `validation`) and the same conclusion falls out either way:

> If `errors[]` is script-derived detail worth withholding from a non-owner on `workflow_get`, then
> serving it on the ungated `workflow_status` of **any run of that workflow** side-steps the mask.

REQ-100's own last-but-one clause forbids exactly this: *"any other read surface that exposes script text
… is masked consistently, so masking cannot be trivially side-stepped by asking a different endpoint."*
So `validation`'s shape is **one decision across two surfaces**, not two independent ones — and it is a
requirement-compliance question, not a preference. That reframing is my substantive answer to quality's
lead finding (§2.1).

---

## 2. Responses to `quality-dimensions.r1.md` — rebut / concede / hold

| their item | disposition | one-line reason |
|---|---|---|
| **R1 / lead — `validation` unreconciled between ARCH-074 and ARCH-075** | **CONCEDE (the seam)** | Real contradiction between two ARCH items; must be decided in 04-design, not discovered red at Gate 5. |
| **…their recommendation: full `{ok, errors[]}` for non-owners** | **REDUCE → `{ok}`** | Consistency with Conflict-4's own precedent + N-2's side-step channel. Live dispute (§7.1). |
| **OBS-1 — pin/`requested`/`validation` on the wire** | **CONCEDE + strengthen** | It is my own bug class (stored-but-never-read); their oracle is right and I add the required-param teeth. |
| **OBS-2 — fire-time refusal must land observably** | **CONCEDE, mechanism reduced** | N-1 shows the defect is worse than they knew and the cheap fix also gives them their seam. |
| **OBS-3 — one structured publish log line** | **CONCEDE (already converged)** | ADR-009 already adopted it; my r1 §6.1 "concede half" is now the whole of it — with a field-level test. |
| **OBS-4 — migration boot-log contract + idempotent re-boot shape** | **CONCEDE** | A second boot logging `0 migrated` is a cheap, real oracle for idempotence. |
| **REP-1 — pin the injected port shapes (`mcpLookup: (name)=>boolean`)** | **CONCEDE** | Identical to my §2A.4 instinct; a predicate cannot grow a dependency on the registry class. |
| **REP-2 — one-predicate rule for the frame delimiter (grep test, no second regex)** | **CONCEDE** | Same family as my §2C oracle 6; costs one test. |
| **REP-3 — wiring is definition-of-done** | **CONCEDE (we wrote the same task)** | Their note 1 = my T7 (`TASK-111`). |
| **CONS-1 — one shared code→surface→trigger→message table** | **CONCEDE, merge with my §2A.6** | Their templates + my closed code set are the same artifact; one DES item. |
| **CONS-2 — list → get(name) errors → get(name, version) recovery** | **CONCEDE with one sharpening** | The message must not name a "newest" — see §3.2. |
| **CONS-3 — inputSchema descriptions state precedence** | **CONCEDE, assertion strength split** | Presence-asserted for prose, literal only for error messages — §3.3. |
| **CONS-4 — consumer-side restatement of the lead finding** | folded into §2.1 | — |
| **SUS-1 — ceiling message names both remedies; prune deferred, not designed** | **CONCEDE — this reverses my r1 §2B.4** | Their staging is right and my own boundary analysis proves it (§2.2). |
| **SUS-2 — degradation shapes test-pinned, not prose** | **CONCEDE + correct one bullet** | Their bullet 3 covers only the *inline* legacy cohort — §2.3. |
| **SUS-3 — `Scheduler.create` release check, error shape reused** | **CONCEDE** | Same taxonomy, no new code; pairs with N-1 for the standing case. |
| **R5 — `workflow_list` excluded from validation recompute** | **AGREE (both lenses, no action)** | My §6.2 predicted a fight that does not exist. |
| **their "adversarial will want admission to enforce"** | **PREDICTION FALSIFIED** | I side with ADR-013 exactly as they do; two enforcement gates that disagree is the defect REQ-099 deletes. |
| **their "adversarial may read CONS-1 detail as disclosure widening"** | **PREDICTION FALSIFIED** | Versions and channels are already on the everyone-visible `workflow_list` allowlist; they are right. |
| **my r1 §6.4 — I predicted they would want a GC sweep** | **MY PREDICTION FALSIFIED** | They asked for message text now + prune later, which is *more* conservative than what I proposed. Recorded. |

### 2.1 — The lead finding: concede the seam, reduce the shape

Quality is right that ARCH-074 ("`workflow_get` returns `validation:{ok,errors[]}`") and ARCH-075's
non-owner enumeration ("`{name, version, channels, description, params, owner, reportProblem,
scriptWithheld}` **and nothing else**") cannot both be satisfied, that S-5 does not say which viewer it
describes, and that leaving it to Gate 5 means the key-set oracle goes red "unexpectedly". That is a
genuine seam between two architecture items and I had not caught it. **Conceded, and it must be decided
in 04-design either way — this is the one item I would call a Gate-4 blocker.**

On the *shape*, I hold a reduced form, on the architecture's own precedent rather than on instinct:

**Ruling: `validation` joins the non-owner allowlist as `{ok: boolean}` — the boolean only. `errors[]` is
owner-only.**

1. **Conflict 4 already decided this class.** The architecture masks `skeleton`/`phases` from non-owners
   because "the skeleton is a decompiled outline of the agent graph". `errors[].code/message` name the
   MCP servers and model aliases the script references — that is a *partial decompiled outline of the
   same graph*, arrived at from the other side. Serving it while masking the skeleton is not a defensible
   line; it is the same disclosure through a different key.
2. **N-2: the mask is side-steppable if `errors[]` is served anywhere ungated.** Since `workflow_status`
   is not principal-gated, the run-record `validation` must carry the **same reduced shape whenever auth
   is enabled**, or REQ-100's "cannot be side-stepped by asking a different endpoint" clause is violated
   by the design as written.
3. **It buys quality the consumability property they actually named.** Their scenario is a user choosing
   between `beta` and `release` who cannot see that beta is unhealthy. `{ok:false}` tells them exactly
   that, and REQ-095's `reportProblem` — already on the allowlist — is the sanctioned next step. They do
   not need the MCP server's name to make the choice or to report it.
4. **Karpathy:** one boolean, zero new machinery, and it makes the disclosure decision a *type* rather
   than a review rule — which is quality's own REP-2 instinct applied one level down.

Interface-contract consequence, stated concretely so Gate 5 cannot drift:

```ts
export interface ValidationPublic { ok: boolean }                                  // non-owner
export interface ValidationFull extends ValidationPublic { errors: ValidationError[] }  // owner only
export const EXPECTED_NON_OWNER_KEYS = [
  'channels', 'description', 'name', 'owner', 'params',
  'reportProblem', 'scriptWithheld', 'validation', 'validation.ok', 'version',
] as const;   // ← amended DELIBERATELY, per quality's own request; `validation.errors` must be absent
```

This is a **deliberate amendment to ARCH-075's "and nothing else"**, flagged as such for the
synthesizer — not a design-stage reinterpretation of an architecture enumeration.

**Testability rider (this is why my r1 oracle 5 used `deepFlatten`):** a nested `errors[]` leaking inside
an otherwise-correct `validation` key is invisible to a top-level `Object.keys()` assertion. The
two-sided oracle must flatten, so `validation.errors` appearing fails the test. That mechanic is what
makes the reduced shape enforceable rather than aspirational.

**Residual I record honestly:** a run that already executed exposes its failure in the transcript
(REQ-007), which is also ungated. That is a **pre-existing** surface; v22's obligation is not to *widen*
it, and the reduced shape discharges that. Gating run reads is a separate iteration's work and I do not
smuggle it in here.

### 2.2 — SUS-1: I concede my §2B.4, and the concession is load-bearing

My r1 proposed `workflow_deregister({name, version?})` as the escape from the version ceiling. Quality
staged it as a future requirements decision and asked only for message text now. **I concede, and the
decisive argument is my own r1 §2B.6:** a per-version delete is what makes two of the three conflated
states *representable in the first place* — a name row with zero versions, and a channel pointer aimed at
a deleted version (`DANGLING_CHANNEL`). I proposed buying three new boundary conditions to escape a wedge
that `maxWorkflowVersions` — operator config, raisable — already unwedges for every deployment where
author and operator are the same person. That is not a simplicity tie-break I can win. Dropped.

Three consequences the synthesizer should take:

- **`DANGLING_CHANNEL` leaves the agent-facing error table.** With name-granular `deregister` only, a
  pointer can never outlive its version (the same statement removes all rows and both pointers). Keep the
  code as a **defensive internal mapping** — better than a silent `undefined` script — but it is not a
  documented outcome, and it is asserted **structurally** (unreachable) rather than behaviourally.
  My r1's truth-table row 5 becomes an invariant assertion, not a live path. The table gets *smaller*.
- **`VERSION_CEILING_EXCEEDED`'s message must name both remedies** (operator raises
  `maxWorkflowVersions`; owner deregisters, with its stated consequences). Quality's SUS-1(a), taken
  whole. At the agent altitude the error text is the runbook, so this is the actual mitigation.
- **Reopening per-version delete later must revisit §2B.1 (below) in the same change.** They are coupled,
  and the coupling is not obvious.

### 2.3 — SUS-2 bullet 3 covers a different cohort than my R1, which corroborates R1

Quality asks to test that "a pre-v22 suspended run **with persisted `spec.script`** resumes (ARCH-072
invariant 3 — the strand-avoidance floor)". Correct, and worth pinning. But that is the **inline** legacy
cohort. My R1 (HIGH) is the **named** cohort: a run started from a registered workflow stores an *empty*
`spec.script` (`run-manager.ts:385-392`), so invariant 3 does not reach it, and its pin can name a
version whose bytes were destroyed by `ON CONFLICT DO UPDATE` (`workflow-catalog.ts:210-220`) before the
migration ever ran.

**That both the architecture and the other lens modelled only the inline cohort is itself the evidence
that the named cohort is unmodelled.** Two independent readers wrote the strand-avoidance floor and
neither reached it. I therefore **hold R1 at HIGH**, unchanged, and I now state its guard exactly —
because §2.2 makes it exact:

> **Discriminator:** the `workflows` name row exists **∧** the run's pin is absent from
> `workflow_versions` ⇒ legacy cohort, and *only* the legacy cohort.

My r1 claimed the cohort "can never grow after the migration". With a per-version delete that claim was
**false** — a post-v22 run's pin could stop resolving, and the fallback would misfire on a run whose
version was deliberately deleted. **Conceding §2B.4 is what makes the claim true.** Without per-version
delete, the only way a version row disappears is name-granular `deregister`, which removes the name row
too — and then resolution fails at `WORKFLOW_NOT_FOUND` before the fallback question is ever asked.
So the two positions are one trade: **option (b)'s soundness depends on the absence of per-version
delete, and must be revisited together with it.** Recorded as an interlock, not two bullets.

**One named residual, stated rather than claimed away.** The discriminator is disjoint **except** for
this sequence: a post-v22 run suspends pinned at `v3` → the owner runs name-granular `deregister`
(permitted; ADR-014 accepts dangling pins) → the owner re-registers the **same name**, whose lineage
restarts at `v1`. The name row now exists and `v3` is absent, so a post-v22 run is classified as legacy
and the fallback resolves `release` on a lineage that merely shares the name. This does **not** change
the recommendation: today `resume` re-resolves through the name (`run-manager.ts:632-636`), so (b)
reproduces exactly current semantics for that sequence — the difference is that the substitution is
recorded on the run instead of happening silently. The claim is therefore "disjoint except this one
named residual", not "provably disjoint"; a per-version delete would turn the residual into a routine
path, which is the interlock above.

Position on R1 unchanged: **(b) narrow recorded fallback** — pin miss ⇒ resolve `release`, record the
substitution on the run's `validation` observation, log it. Strict option (a) remains a one-line
alternative and needs a decision, not an omission (§7.3).

---

## 3. Where I integrate their items with a sharpening

### 3.1 — OBS-2, mechanism reduced (and it fixes N-1 for the same money)

Quality asks for "a run-refused/trigger-failed journal entry attributable to the schedule id, surfaced in
the ARCH-046/047 home-dashboard reliability metrics". I **concede the requirement** and **reduce the
mechanism**, because N-1 shows the cheapest fix is also the more complete one:

> **Give the driver's `.catch()` a writer.** `scheduler.markFailed(firing, code)` performs exactly what
> `markFired` performs minus the `runId` — recompute `nextFire` for `cron`, auto-disable for `once` —
> and records `lastError: {code, at}` on the schedule row.

- It **fixes the hot loop**, which their journal-entry proposal does not (a journal entry that is written
  twice a second is a second symptom, not a fix).
- It **gives them their seam for free**: `lastError` + an advancing `lastFire` land on `schedule_list`,
  which the dashboard already reads. A 3 am refusal is visible at 9 am — their stated bar — with no
  metrics wiring, no new journal entry type, and no new read surface.
- It is **cheaper than my own first idea**, which was to write a terminal `refused` run record. That
  needs a `RunSpec` for a run that never existed and pollutes run history with non-runs. Withdrawn.
- Cost: one nullable column, one method, one `.catch()` line. **It reopens the recorded ADR decline
  (§7.2) — flagged, not smuggled.**

**Test (RED, must exist and must be a fake-clock unit, not an integration):** a schedule whose workflow
is deregistered, driven across **three** ticks; assert `start()` is attempted **once**, `nextFire`
advanced, `lastError.code` set. A single-tick test passes today and proves nothing — the defect is only
visible on tick 2.

### 3.2 — CONS-2, with the "newest" leak closed

Their list → `get(name)` errors → `get(name, version)` recovery is right. One sharpening from the
boundary lens: REQ-097 forbids the *engine* falling back to the newest script, and an error message that
hands an agent an ordered version list and says "try one" quietly delegates that same fallback to the
caller. It is acceptable **because it is visible and caller-chosen** — that is the distinction REQ-097
actually protects — but the message must therefore **list the versions and state that publication is
required**, and must **never name a recommended or newest version**. Assert the exact three-call
sequence, and assert the message does not contain a "newest"/"latest" recommendation token.

### 3.3 — CONS-3, with assertion strength split by kind

Descriptions on `version?`/`channel?` stating precedence: conceded, cheap, correct — a schema-reading
agent should not need DEPLOY.md. But joining them to the **literal** drift-lock the way error messages
join it makes every wording improvement a red test, and a test that punishes improving documentation gets
deleted. Interface-contract ruling:

- **Error messages are a recovery contract → asserted literally** against the CONS-1 template table.
- **Schema descriptions are prose → asserted for presence** (every new optional parameter has a
  non-empty description) in the structural drift-lock.

Different artifacts, different oracles. This is a genuine distinction, not a weakening: an agent recovers
from an error text mechanically; it reads a description for orientation.

### 3.4 — OBS-1, with the teeth my lens adds (and my second r1 reversal)

Their oracle — literal key assertions on the `workflow_status` response, not "the record has it" — is
exactly right for this repo's stored-but-never-read class. Two additions:

- **`workflow_run` returns `{runId, version, requested}`** (my r1 §2A.3). One field, and it is the only
  way a caller sees which of `version`/`channel` won, without a second call.
- **`createRun`'s `scriptVersion` becomes REQUIRED — I reverse my r1 here.** Both implementations default
  it (`run-store.ts:146`, `sqlite-run-store.ts:78`: `scriptVersion = 'v1'`). After v22 that default is a
  **lie**: a run whose version was not passed is recorded as having executed `v1`, which is a wrong answer
  to the exact question REQ-096 makes the pin authoritative for — worse than an absent one. I refused the
  options-object refactor on measured churn (33 call sites) and I apply the same discipline here: I
  grepped for positional omissions and found **one** (`createRun(x)`). One call site is not a churn
  argument. Make it required, delete both defaults, let `tsc` find the site.

The `admission?: {requested, validation}` fourth parameter and the deferred options-object refactor
stand as in r1 §2A.3.

---

## 4. Final position — what I ask the synthesizer to carry into 04-design

**Blocker-grade (decide in 04-design or Gate 5 discovers it):**

1. `validation` on the non-owner view — **decide**; my recommendation `{ok}` only, same shape on
   `workflow_status` while run reads stay ungated (§2.1, N-2). `EXPECTED_NON_OWNER_KEYS` amended in the
   design text, not in a test at Gate 5.
2. **R1 legacy named-run pin** (§2.3) — option (b), recorded fallback, with the exact discriminator and a
   hand-written legacy-SQL fixture. A decision, never an omission.
3. **N-1 hot loop** — `markFailed` in the driver's `.catch()`; reopens a recorded decline (§7.2).

**High-value, uncontested by the other lens (r1, unchanged):**

4. `resolveDetail` replaces `getFull` (rename, so call sites are compile errors) + `DROP COLUMN` inside
   the ADR-011 transaction + the `PRAGMA table_info(workflows)` absence assertion (r1 §2A.1, §2B.2).
5. `scriptSha256` leaves the wire with `script`, same task (r1 §2A.7).
6. `.immediate()` on `register`/`publish` + typed `REGISTRATION_CONFLICT` (r1 §2B.3).
7. `resolvedWorkflowVersion` as a distinct journal field + decouple `RunEntry.scriptVersion` from the
   catalog version (r1 §2A.5).
8. `MISSING_SCRIPT` → `MISSING_NAME`, message and code (r1 §2A.6).
9. `SubmissionValidatorDeps` shrinks to `{catalog}` (r1 §2A.4).
10. NULL-owner rows are masked from everyone under auth — intended, tested, with distinct remediation
    text (r1 §2B.5).

**Merged artifacts (one DES item each, jointly owned by both lenses):**

11. The **error table**: my closed code set (r1 §2A.6) × their message templates (CONS-1) × their
    per-surface trigger column. One table, referenced by every task that throws.
12. The **resolution truth table** as a pure total function with declared precedence (r1 §2A.2), now with
    row 5 demoted to an unreachable invariant (§2.2).

**Task-splitting — merged with theirs, no conflicts found:** my T1/T2/T4/T7 single-task groupings stand;
their note 1 (wiring travels with the constructor) is my T7; their note 2 (real-transport masking test is
DoD, not a later test task) is my R3 mitigation; their note 3 (pure units first) and my "legacy fixture
task first" are compatible and both precede implementation — the fixture must be **hand-written legacy
SQL**, never produced by instantiating the new `WorkflowCatalog` (r1 §2C oracle 2). Their note 5 asks for
a fixture from a pre-v22 checkout; a hand-written `CREATE TABLE` + `ALTER TABLE` triple is equivalent,
cheaper, and does not require a git checkout in a test — I take their requirement with my mechanism.

---

## 5. Internal conflicts between my own three lenses — updated

| # | conflict | r1 resolution | r2 status |
|---|---|---|---|
| i | contract "never a silent fallback" vs the stranded legacy run | (b), disjoint populations | **strengthened** — §2.2's concession makes the discriminator exact, so the populations are now provably disjoint rather than argued to be |
| ii | contract vs REQ-097 on `version`+`channel` together | obey the requirement, pay with the `requested` echo | unchanged |
| iii | testability vs Karpathy on a `Database` injection seam | refused; tmp-`workRoot` legacy file is simpler *and* stronger | unchanged |
| iv | contract vs testability on `createRun`'s positional growth | additive param, options-object as debt | **partially reversed** — `scriptVersion` becomes required (1 call site measured); the options-object refactor stays debt (33 sites) |
| v | boundary vs Karpathy on the per-version deregister | one optional param | **RESOLVED BY CONCEDING** — my own boundary analysis showed the escape hatch creates two of the three states it would have to guard (§2.2) |
| **vi (new)** | **boundary wants a `lastError` column vs Karpathy honouring a recorded ARCH decline** | — | **boundary wins on evidence:** the decline's stated rationale (a front-door check) cannot cover post-creation deregistration, and the residual is a 2 Hz retry storm, not the invisibility the decline assumed. Escalated as a reopening (§7.2), not decided unilaterally. |

---

## 6. r1 items that stand unchanged (restated by ID for the synthesizer)

`§2A.1` catalog surface · `§2A.2` truth table + precedence (row 5 demoted) · `§2A.3` `createRun` growth
(*amended*, §3.4) · `§2A.4` deps shrink · `§2A.5` three `scriptVersion` meanings · `§2A.6` closed error
table (*merged with CONS-1*) · `§2A.7` `scriptSha256` · `§2B.1` legacy pin (*discriminator sharpened*) ·
`§2B.2` DROP COLUMN + PRAGMA · `§2B.3` `.immediate()` · **`§2B.4` WITHDRAWN** · `§2B.5` NULL-owner ·
`§2B.6` three states (*row 5 now unreachable*) · `§2B.7` validation-before-ceiling ordering · `§2C`
oracles 1–6 (oracle 5's `deepFlatten` is now load-bearing for §2.1) · `§3` task groupings T1/T2/T4/T7 ·
`§4` risks R1–R10, minus **R6 (withdrawn with §2B.4)**, plus **R11 = N-1 (HIGH)**.

---

## 7. Remaining disagreements — for the synthesizer to adjudicate

1. **Non-owner `validation` shape.** Quality: `{ok, errors[]}`. Me: `{ok}` only, same shape on
   `workflow_status` while run reads are ungated. **Recommended default: `{ok}`** — it is consistent with
   Conflict-4's own skeleton-masking precedent and it is the only shape that satisfies REQ-100's
   no-side-stepping clause given N-2. Quality's counter is real and should be recorded: withholding
   `errors[]` moves discovery of a stale environment to a failed run. If the synthesizer takes
   `{ok, errors[]}`, that is coherent **only if** it is served on both surfaces and the disclosure is
   accepted as a deliberate widening relative to the masked skeleton.
2. **Reopening the `lastError` decline (N-1).** **Recommended default: reopen and take
   `markFailed`** — one nullable column, one method, one line in the driver's `.catch()`. The alternative
   (leave it) ships a known unbounded 2 Hz retry loop with a code comment that claims the opposite. If the
   synthesizer holds the decline, the comment at `server.ts:1300-1305` must be corrected in v22 so the
   next reader is not told the loop is handled.
3. **R1 strict vs recorded fallback.** Me: (b) recorded fallback. The strict alternative (a),
   `LEGACY_PIN_UNRESOLVABLE`, is one line and is the interface-contract lens's own preferred answer.
   Quality did not address the named cohort at all. **Recommended default: (b)**, with the §2.3 interlock
   noted — if per-version delete ever lands, (b) must be revisited in that change.

**Explicitly NOT in dispute** (recorded so the synthesizer does not re-litigate): ADR-009..014 as decided;
ADR-013's observe/refuse split; `workflow_list` excluded from validation recompute; no publish audit
table; no GC sweep; no `workflow_resume({runId, version})`; engine-assigned `v<n>`; `Scheduler.create`'s
release check; masked `skeleton`/`phases`; `get(name)` deleted outright.
