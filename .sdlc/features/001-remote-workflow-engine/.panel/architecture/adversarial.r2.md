---
stage: architecture
lens: adversarial (security / scalability / testability, Karpathy simplicity-first as tie-breaker)
round: 2 (responses + final position)
scope: v27 Round v27b delta — gates [architecture, design, tests], impactIds REQ-133 / REQ-134 / REQ-140
read this round: .panel/architecture/quality-dimensions.r1.md (full), .panel/architecture/adversarial.r1.md (mine),
  .panel/architecture/adversarial.r1.sprintA.md (mine, Sprint A — unchanged, still the reference for
  REQ-131/132/135/136/141 and the altitude table)
new measurements this round (all at 07266be): src/server.ts:490-552, src/dashboard.ts:339-460 (:352),
  src/dashboard-page.ts:601-607, src/types.ts:322/:347-351, src/run-manager.ts:778-783/:830-838/:895-910,
  src/run-store.ts:253/:355/:366, src/store/sqlite-run-store.ts:283, src/mcp-facade.ts:590,
  tests/integration/dag-masking-auth.test.ts:1-140, tests/integration/dashboard-http.test.ts:138-152/:205-218,
  tests/integration/diagram-contract-grandfather.test.ts:85-101/:148-156,
  tests/integration/dag-warnings-empty.test.ts:1-45, tests/e2e/nested-frame-phase.test.ts:60-63,
  tests/unit/no-skeleton-surface.test.ts:54, 01-requirements.md REQ-105 (:1067-1070)
---

# Round 2 — adversarial lens: responses, corrections, final position

**Bottom line up front.** The two lenses converge on the whole of the headline and on the instrument.
Nothing blocking remains. What this round adds is (1) **three corrections to my own r1**, one of which
was wrong on the mechanism; (2) one **measured collision** neither r1 caught — three existing tests pin
`dag.warnings` to `[]`, which constrains where the new honesty warnings may be pushed; and (3) a
**strictly better fix for F-1 than either r1 proposed**: the engine already records the substitution
(`RunStatusView.legacySubstitution`, v22/DES-113), so the route can be made *correct* instead of merely
*apologetic*. §3 is the converged proposal; §4 is what is left, and it is two recorded boundaries, not a
dispute.

---

## 1. Corrections to my own r1 (before anything else — two of these would have cost Gate 5 a flaky test)

**C-1 — K-3's caveat was wrong on the mechanism. I withdraw it, and QD's S-Δ1 gets stronger for it.**
My r1 warned that a parity test must compare `cells[].id`, **not** `cells[].label`, because
「`layoutGraph` is handed `startedByType`, so the trigger cell's own label legitimately differs between a
run started by a real principal and one started anonymously」. That is false. `startedBy.type` is the
**trigger kind**, not an identity: `mcp-facade.ts:590` stamps `{ type: 'client' }` for every
`run_start`, `scheduler.ts:363` `'schedule'`, `webhook-registry.ts:305` `'webhook'`,
`run-store.ts:350` coalesces to `'unknown'`. The trigger cell's label is
`opts?.startedByType ?? 'trigger'` (`dashboard.ts:352`). In the IT-092 harness both runs are started
through `run_start` on `/mcp` (`dag-masking-auth.test.ts:98-100`), one with a minted bearer and one
without — **both are `'client'`, and both labels are equal**. So labels are parity-safe today, and
QD's S-Δ1 (「assert the labels, a negative assertion is weaker」) is right without my caveat. **Concede;
parity asserts labels too.**

**C-2 — my predicted disagreement D-4 did not happen. Dropping it.** I expected QD to want ADR-054's
golden key-set tests broadened across every `/api/*` endpoint. They did not ask for that; they wrote
that the key-set test 「sees no new top-level key because `lanes`/`current` were already planned」,
which is the same scoping rule I was going to argue for. The rule stands unopposed and needs no debate
line: **a key-set test is owed by the endpoint whose key set this delta changes** — here
`/api/runs/:id/dag` and `describe.phases[]`, nothing else.

**C-3 — QD's predicted disagreement with *me* also did not happen, and the synthesizer should not
invent it.** QD anticipated friction 「(a) keeping `maskPredictedOverlay` as a global kill-switch for
defence in depth」. **There is no such friction.** My r1 K-2 argued for deleting the dep on security ∧
simplicity grounds, in the same terms as their R-Δ1/S-Δ3: a seam whose only correct value is constant
is an unexercised branch that decays, and its fail-closed default now fails closed to the refused
behaviour. Both lenses independently reached 「delete the axis, do not flip its default」. That is the
single most important converged item in this delta and it should be recorded as **unanimous**, not as
a resolved dispute.

---

## 2. Rebut / concede / hold, one row per disagreement

| # | Their position | Mine (r1) | Verdict | Engineering reason |
|---|---|---|---|---|
| 1 | **R-Δ1 / key_point 2** — delete `maskPredictedOverlay`, `opts.masked`, `handleDashboardRequest`'s `authEnabled` param and the `!!authCfg` argument; no stump | K-1/K-2 — identical, four deletions | **Agree (unanimous)** | Not a disagreement. Both lenses measured the same three facts: `grep` → `maskPredictedOverlay` has 0 hits in `src` and `tests`; `authEnabled` has exactly one consumer (`server.ts:520`) and one caller (`:1068`); the fail-closed default now defaults to the overruled behaviour. Record as unanimous so a later reader does not read the parameter's absence as an oversight. |
| 2 | **QD-Δ-R2 / key_point 1** — REQ-105's acceptance still says the DAG route 「stays **behind the auth gate** (v22 finding H2 closed exactly this hole; v23 must not re-open it)」; needs `[PARTIALLY SUPERSEDED v27, Round v27b]` | my r1 was silent on REQ-105 | **Concede, and upgrade it from HIGH to blocking-for-Gate-8** | Verified verbatim at `01-requirements.md:1070`. My r1's F-5 flagged the *same class* one document lower (ADR-051's Gate 7.5 instruction still says 「record what degrades」). Both are the same defect: a surviving sentence that instructs a later gate to prove the opposite of the ruling. REQ-105 is worse because Gate 8 verifies REQs against code, so it fails **by construction**, not by judgement. Orchestrator item; this run's gates cannot do it. |
| 3 | **O-Δ4 (b)** — supersession markers on ADR-012 / ARCH-073 / ARCH-075 / DES-114 / 07-review H2 and the three comment sites | my r1 scoped the sweep tighter (「a delta that touches REQ-100's rows is out of closure」, F-4) | **Concede the sweep; hold the boundary** | The two are not in conflict once the rule is named: a **marker** is the trace chain's own consistency; a **rewrite of a v22 decision** is scope creep. QD's partition (b) is all markers. And the sweep is not taste — it is REQ-105's own last clause: 「**the deletion is not finished while something still describes the deleted thing** … nine recorded instances」. This delta deletes the mask, so that clause now governs the mask's own descriptions. F-4's boundary still holds for *behaviour*: REQ-100's script masking, REQ-136's system-prompt strip and the three `dbindExempt` gates do not move. |
| 4 | **O-Δ1 / O-Δ2** — push `predicted overlay unavailable: <reason>` into `warnings[]` for the two silent arms, and emit `dashboard_api_degraded {route:'dag'}` from the inner catch | F-1 — push `PREDICTED_FROM_FALLBACK_VERSION` for the fallback-version arm | **Hold the arm, concede the form, integrate into one vocabulary — and their reason list is incomplete** | The strings are the right instrument (existing `layoutGraph` convention, `dashboard.ts:393/397/434/442` are all prose). But QD's `reason ∈ {catalog-resolve-failed, derivation-failed}` covers only the cases where the overlay is **missing**. The dangerous case is the one where it is **present and wrong**: the pinned resolve throws, the release fallback *succeeds* (`server.ts:502-505`), and the payload looks perfect while being derived from a different script version than the run executed. A missing overlay is visibly missing; a wrong one is not. §3 merges both into three reasons and fixes the third. |
| 5 | **C-Δ1 / O-Δ1's premise** — 「the same `warnings[]` the client already renders」 | my r1 D-3 made the same claim more carefully | **Both of us were loose; correcting with a measurement** | `dashboard-page.ts:601-607` renders `warnings.length+' warning(s)'` — a **count**. No warning *text* is rendered anywhere today. So as of `07266be` every warning either of us proposes is **write-only**. This is not a reason to drop them; it is a DoD line, and §3 places it. |
| 6 | **S-Δ1** — the regression guard is a *positive* assertion on the auth server (labels present), file `describe` titles renamed to state the ruling | K-3 — one auth-invariance parity test | **Concede theirs; hold mine as well; they are different oracles** | Positive assertion pins the shape we want **today** and is what a future hardening reviewer reads first. Parity catches **tomorrow's** divergence on fields nobody has thought of. Parity costs one `it()` in a file that already boots both servers with the same `SCRIPT` and the same `registerPublishedVia` — no new fixture, no new harness. Keep both; §3 names the field set. |
| 7 | **S-Δ1's rename** — QD renames the `describe` titles but not the file `dag-masking-auth.test.ts` | my r1 did not raise it | **Hold the filename, concede the titles** | Under item 3's own rule a file named `dag-masking-auth.test.ts` that asserts the *absence* of masking is a stump. But the filename is cited by `file:line` across `05-tests.md`'s IT-092 and IT-168 rows and by 07-review H2; renaming it churns the trace chain for a cosmetic gain. Titles and the header comment carry the ruling; the filename stays and earns one line in the header saying why. State it explicitly so the synthesizer is not left with an unstated ambiguity. |
| 8 | **key_point 9 / UT-238** — reconcile `{ masked, status }` → `{ status }` here rather than at Gate 6 | K-1 row 3 — same | **Agree** | Measured: `dashboard-derive-lanes.test.ts:34, :37, :65` pass `{ masked, status }` today with a `as { masked: boolean; status: RunStatus }` cast, because ARCH-126 typed only `{ masked }`. The cast is the tell. Delete `masked` from the signature and the cast goes with it. |
| 9 | **Scalability** | K-5 — measure at Gate 7.5, 50 ms budget, pre-approved 5-line memo **only if** exceeded; no cache now | **Hold, unopposed** | QD's file has no performance section (honestly so — their lens is observability/replaceability/consumability/self-sustainability). Stating it so the synthesizer does not read silence as agreement *or* as an omission: the reversal makes the derivation run on every DAG poll on auth deployments too (3 s poll, REQ-142, 「我 + 團隊」). It adds **no state** — the mask was stateless and so is the derivation — so there is **no horizontal-scaling or consistency delta at all**; the only axis is per-request CPU. That is why measurement, not a cache, is the right answer now. |
| 10 | **C-Δ2** — inert cells detected by `cell.agentId === undefined`, never by the `__skel_` id prefix | not raised in my r1 | **Concede, and reinforce from my lens** | Testability: a prefix test couples served client bytes to a retired word, and `no-skeleton-surface.test.ts:54` pins a six-file allowlist that `.js` client modules are not on. `agentId === undefined` is the v11 DES-064 contract and needs no string. |
| 11 | **R-Δ2 / QD-Δ-R8** — a future policy is a per-principal projection through the auth layer, never a global `dashboard.predictedOverlay` knob | my r1 D-1 pre-argued the same | **Agree (unanimous)** | Same reasoning from both ends: a global knob is not per-principal, so it does not buy the D1 tier either, and it re-imports the `composeConfig` forwarding obligation to protect a state the owner refused. |

---

## 3. Final position — the converged proposal (differences from both r1s marked ▲)

### 3.1 Delete the axis (unanimous, unchanged)

Four deletions, not four `false`s: `if (!authEnabled)` (`server.ts:520`), `McpFacadeDeps.maskPredictedOverlay`
(DES-197, never implemented), `deriveLanes(…, { masked })` (ARCH-126/DES-196 → `deriveLanes(phases,
expected, { status })`), and `handleDashboardRequest`'s `authEnabled` parameter (`server.ts:334`) with
its `!!authCfg` argument (`:1068`) and both comments. The inner `try/catch` stays — a derivation fault
still degrades to an empty overlay, never a 500 (DES-018). `authAnnounce` stays: `/api/system` is how
an operator learns auth is on (ARCH-090). Deleting the positional parameter is type-safe because the
two trailing parameters are disjoint types, so `tsc --noEmit` catches a mis-shift, and the v23 one-dispatch
rule guarantees a single call site.

### 3.2 ▲ Make the overlay CORRECT before making it apologetic — `legacySubstitution` already exists

This supersedes my r1's F-1 fix and completes QD's O-Δ1. The engine **already records** when a run
executed a different version than its pin:

```
RunStatusView.legacySubstitution?: { pinned: string; resolved: string }   // types.ts:347-351 (v22, DES-113, TASK-108)
```

written by `run-manager.ts:907-909` when `_requireLive`'s pinned resolve throws `VERSION_NOT_FOUND` and
`release` answers instead; persisted by both stores (`run-store.ts:355`, `sqlite-run-store.ts:283`);
and it survives onto the route's `view`, because `status()` is `_mergeLive(store.getRun(...))` and
`_mergeLive` spreads `...view` first (`run-manager.ts:778-783`, `:830-838`). It is therefore already in
hand at `server.ts:490` and **nobody reads it there**.

So the DAG route's version resolution becomes, in order:

1. `catalog.resolve(spec.name, { version: view.legacySubstitution?.resolved ?? view.scriptVersion })`
   — ▲ **one expression change that makes the overlay correct for the entire v22 legacy cohort**,
   instead of labelling it wrong. Today `server.ts:500` asks for the pin the run did *not* execute,
   gets `VERSION_NOT_FOUND`, and falls through to a **floating** `release` that may have moved again
   since. Reading the recorded `resolved` asks for the script that actually ran.
2. if that throws → `catalog.resolve(spec.name, {})` (release) **and push**
   `predicted layout derived from version <release>; this run's script version <requested> is no longer
   in the catalog` — where `<requested>` is the SAME `legacySubstitution?.resolved ?? view.scriptVersion`
   expression step (1) asked for, never the literal pin. (When a substitution exists but its `resolved`
   is also gone, the run executed `resolved`, not the pin, so a string saying 「this run executed
   `<pinned>`」 would itself be the lie this warning exists to prevent.) Overlay present, honestly labelled.
3. if that also throws → empty overlay + `predicted layout unavailable: catalog-resolve-failed`.
4. derivation throws (`server.ts:540`) → empty overlay + `predicted layout unavailable: derivation-failed`,
   **plus** QD's O-Δ2 journal line `{event:'dashboard_api_degraded', route:'dag', runId, reason}` on the
   existing convention (`server.ts:582-585`, `diagram_render_failed` at `:440`).

Four rules, three warning strings, **zero new wire fields**, one existing field finally read.

▲ **Rule (1) is a separable line item, and the synthesizer should be able to take it or defer it on its
own.** §3.1 deletes a mask; rule (1) *changes what the route resolves*, which is a behaviour change to
the overlay's correctness. It is in closure via REQ-134 (「一眼看出卡在哪」 is false if the lanes come from
a script the run never ran), but it stands or falls independently of the deletion — deferring it leaves
rules (2)–(4) intact and merely keeps labelling what rule (1) would have fixed. Consequently the r1
appendix's **ARCH-130** and **TASK-203** rows are now stale on three points — the resolution order, the
three warning strings, and §3.3's render-strings DoD — and should be taken from this file rather than
from that table; nothing else in the appendix moves.

D-3 from my r1 dissolves: QD wanted a first-class record of *which version the overlay came from*, I wanted no new
field — the field already exists upstream, so both get what they argued for.

**▲ Vocabulary constraints, from measurement:**

- **Push at the ROUTE, never inside `layoutGraph`.** `tests/integration/dag-warnings-empty.test.ts:37`
  calls `layoutGraph` directly and asserts `warnings: []` as REQ-124's acceptance. Compose the payload
  as `warnings: [...layout.warnings, ...routeWarnings]` and `layoutGraph` stays pure — which is also the
  testability answer: the route's honesty is testable over HTTP, the layout's arithmetic stays unit-testable
  with no server.
- **Never the word 「skeleton」** in a warning string. `no-skeleton-surface.test.ts` walks `src/**` against a
  six-file allowlist, these strings are served bytes, and REQ-134's legend will render them. Use
  `layoutGraph`'s own vocabulary — 「predicted layout」 — which is why every string above says that and not
  the other word.
- **Trigger on the catch arm EXECUTING, not on `skeletonScript === ''`.** An unnamed run with an empty
  inline script reaches `:498` with `''` legitimately (`spec?.script ?? ''`, no catalog resolve at all) and
  must emit nothing. QD's O-Δ1 phrasing (「the `''`-script arm」) would make that run apologize for itself.
- **Stable leading phrase.** `predicted layout unavailable: ` / `predicted layout derived from version ` —
  so a test asserts a prefix, not a sentence, and the tail can carry the version without churning the test.

**▲ Measured: this breaks no existing test, and one of them is the free RED fixture.**
`grep` for empty-`warnings` assertions finds five sites; three are on the `/dag` payload:
`diagram-contract-grandfather.test.ts:101` and `:156` (registered, pin resolves → no arm fires),
`nested-frame-phase.test.ts:62` (same), and `dag-warnings-empty.test.ts:37` (direct `layoutGraph`, which
the route-side push does not touch). **And** `dashboard-http.test.ts:205-218` deregisters the workflow so
that *both* resolves throw — it is already the live fixture for reason (3), and it asserts only 「no
`__skel_*` cells」, never `warnings: []`. So reason (3)'s RED test is one added line in an existing `it()`.
This corrects QD's partition (c), which files `dashboard-http.test.ts:213-217` as 「untouched」: it is
untouched by the *auth* flip and is simultaneously the cheapest fixture this delta has.

### 3.3 ▲ The warning channel is write-only today — the rendering is IN closure, not deferred

`dashboard-page.ts:601-607` renders a **count**. Both r1s assumed text. REQ-134 is in this run's
`impactIds`, and REQ-134's legend row is the honesty surface for exactly this class, so the rendering is
inside the closure, not a Sprint A leftover: **TASK-203's `dod:` gains 「the run page renders the warning
STRINGS, not a count」**, and the rebuilt client (ARCH-125 / DES-206) owes it. Without that line, §3.2 and
QD's O-Δ1 are both a `push` into an array nobody displays, and Gate 8 would be right to call that an
unverified honesty claim.

### 3.4 The two test oracles, with the field set named

**(a) Positive shape on the auth server (QD's S-Δ1 — the guard against re-masking).** Auth ON, anonymous
GET: `__skel_*` cells present with their **labels**, `lanes` include the unreached lane, `describe.phases[].agents`
present with labels. `describe` titles state the ruling. C-1 withdrew my objection to asserting labels.

**(b) Auth-invariance parity (my K-3 — the guard against tomorrow's divergence).** One `it()` in the same
file, over the two servers it already boots. ▲ **Assert it as an EXCLUSION, not a pick-list:**

```
expect(omit(authDag, ['runId','terminalAt'])).toEqual(omit(openDag, ['runId','terminalAt']));
expect(authDescribe.phases).toEqual(openDescribe.phases);
```

so the compared set is 「everything on the payload」 — `cells` (id, kind, col, row, laneSpan, **label**),
`edges`, `lanes`, `current`, `warnings`, `startedBy`, and whatever a later iteration adds — minus the row's
own identity and its timing. A pick-list is the weaker oracle and would have misstated the limit below:
the likeliest future leak is not a field already on the list but a **new sibling**. `RunStatusView.principal?:
string` (`types.ts:343-345`, v15/DES-096) is already on `view` at `server.ts:490`, is
`'it092-owner@example.com'` on the auth server and absent on the open one, and is one `...view` spread away
from the payload built at `server.ts:546-550`. A pick-list never sees it; the exclusion form goes red the
first time it appears.

▲ Two mechanics that make it non-flaky, both measured: **register the SAME workflow name on both
servers** (separate `workRoot`s, so there is no collision — IT-092 uses `it092-masked` / `it092-open`
today, and any future name-derived field would false-red); and use the same `SCRIPT` and the same
`run_start` path, which the harness already does.

▲ **Why `startedBy` is IN the parity set, stated precisely so it is not oversold.** It is not
identity-bearing today: `StartedBy.id` is unset on the `client` path (`mcp-facade.ts:590`) and is a
workflow name or webhook id on the others — no principal anywhere. The claim is narrower and forward-looking:
the type *admits* an `id`, `server.ts:549` publishes the whole object on an ungated route, and v24 DES-162
already states the convention (`server.ts:577`: 「`/api/runs/:id` is ungated — no identity field leaves on
this route」). Parity makes that convention **executable**: the day someone stamps `startedBy.id = principal.id`
under auth, the auth run and the open run stop matching and this test goes red. **Honest limit:** it catches
only leaks that *differ by deployment*; a field that leaks identically on both servers is ADR-054's
key-set test's job, not this one's. That is the security lens's actual replacement for the retired mask —
a stronger oracle than the assertion it retires, because the mask only ever checked one branch.

**(c) IT-092's re-trace stands as my r1 wrote it** (the ledger rule is 「不得以放寬斷言了事」): the cells
assertion becomes 「the DAG payload carries no script bytes」 under REQ-133/REQ-140, with the sentinel a
token the derivation *cannot* legitimately surface (`const IT092_SENTINEL = 'never-leaves-the-engine';` in
the fixture) — **never** an agent label, phase title or tool name, because those are exactly what the
reversal now publishes on purpose. REQ-100's real protection (script text) remains verified by IT-089 and
`val-110-script-masking`, both untouched.

### 3.5 Gate 7.5 (both lenses, merged)

One `auth.enabled:true` case proving the overlay **IS** visible (QD's S-Δ2: one Chromium case under
VAL-199 — the never-run predicted layout is cheapest, no gateway needed — plus the wire under VAL-204),
with QD's `mintBearer` trap named in the VAL's own comment so the case cannot be vacuous. ADR-051's
standing instruction 「run one case and **record what degrades**」 must be flipped in the same edit (my
F-5) or the validator faithfully records a degradation that must no longer exist. Plus K-5's one number:
p95 of `GET /api/runs/:id/dag`, auth on, largest script in the corpus; > 50 ms pre-approves a 5-line memo
keyed `` `${name}@${version}` `` (safe: a registered version's script is immutable), ≤ 50 ms builds nothing
and leaves the number on the record.

---

## 4. What is left — two recorded boundaries, no blocking dispute

I am not manufacturing a disagreement to fill this section. After §2 the count is: **zero blocking
disagreements**, one stylistic split settled in the open (row 7, the filename), and two boundaries that
belong in ADR-051's note so Gate 8 does not rediscover them as findings.

**B-1 — the fourth, unlabelled arm.** `server.ts:532-538`: when `derived.ok` is false the route re-derives
with `contract:'v1'`, and if *that* refuses it assigns an empty graph with **no throw and no catch** — so
neither §3.2 (4)'s `derivation-failed` nor (3)'s `catalog-resolve-failed` fires. The code's own comment says
`contract:'v1'` 「never refuses on L2 (its only refusal rule today)」 and keeps the branch 「defensive rather
than assuming that invariant with a cast」. Correct call; but after the reversal an unlabelled empty overlay
is exactly the silence this delta exists to remove. **Cheapest resolution: fold it into `derivation-failed`
(same honesty failure, no new string), and write the invariant into ADR-051's note so it is a stated
boundary rather than a fourth silent arm.**

▲ **The placement is exact, and getting it wrong goes red on REQ-124.** The push belongs in the **false arm
of the `v1.ok ? v1.graph : { lanes: [], slots: [], edges: [] }` ternary at `:538`, and nowhere else** — NOT
in the `else` at `:534`. That `else` is the *legitimate* v1-contract path taken by every script with no
`phase()` at all, which includes IT-092's own `SCRIPT` (`dag-masking-auth.test.ts:34-39`) and
`diagram-contract-grandfather.test.ts`'s `v1Script` — and the latter asserts `warnings: []` at `:101` as
REQ-124's own bar. A push in the `else` warns on every v1 script and turns that assertion red.

▲ **REQ-124 reconciled explicitly, so Gate 8 does not read it literally against §3.2.** REQ-124's
「existing production runs show zero warnings」 covers runs whose pin resolves **and** whose derivation
succeeds — the v1 re-derive included, since it yields a real graph and REQ-124 requires those runs to draw
as before. All three fault strings fire strictly outside that cohort by construction: (2) only when a
requested version is absent from the catalog, (3) only when both resolves throw, (4) only on a throw or on
a v1 refusal that the code's own comment says cannot happen today. No healthy grandfathered run reaches any
of them — which is why §3.2's measured survey found the three `/dag` empty-`warnings` assertions untouched.

**B-2 — the cohort §3.2 still cannot label.** A run whose pin resolved fine at execution time and is
purged (REQ-026 GC) or deregistered *afterwards*, with no `legacySubstitution` record, lands on §3.2 (2)
and IS labelled. But a run in the **pre-v22 cohort** that never recorded a substitution and whose name
row still resolves its pinned version normally is indistinguishable from a healthy run — correctly so,
because it *is* one. The residual is only this: the label in (2) says what the overlay was derived from and
what the run's pin said; it cannot prove the *pin* is what executed for rows written before v22's
substitution record existed. One sentence in ADR-051's note. **No code, no mitigation** — inventing one
would be the speculative architecture the tie-breaker forbids.

**Carried from my r1, undisputed, one line each so the synthesizer has them in one place:**
- **F-2** (MEDIUM, record-only): the precise newly-anonymous information is the lane membership and edge
  order of a *pinned, non-release* version whose author `mermaid` is `null` — the pre-v26 grandfathered
  cohort, and the boundary is exact, since the diagram route answers `404 DIAGRAM_UNAVAILABLE /
  LEGACY_NO_DIAGRAM` for precisely those rows (`server.ts:429-431`). One sentence in ADR-051; no mitigation,
  because the mitigation the owner refused is the mask. QD said they support recording it.
- **F-3** (MEDIUM, note-only): the synthetic `{kind:'auth-disabled'}` principal at `server.ts:563` / `:402` / `:419`
  has no current instance of the hazard after §3.1 (no masking decision left in the facade on these routes),
  but the *pattern* survives; §3.4 (b)'s parity test is the empirical guard and no new abstraction is
  proposed. Name it in ARCH-131's note.
- **F-4** (LOW, boundary): 「撤銷遮罩」 reads broader than it is. REQ-100's script masking, REQ-136's
  system-prompt strip and the three `dbindExempt` auth gates (`server.ts:1126`, `:1146`, `:1183`) all stand. A delta
  touching any of them is out of closure.

**Internal conflict between my own three lenses, surfaced as the dispatch asks:** the only real one this
round was **testability vs security on the parity oracle**, and it resolved by measurement rather than by
trade-off. Testability's r1 instinct (「compare ids, labels will be flaky」) was wrong on the mechanism
(C-1); once that is corrected, security gets the stronger oracle it wanted — labels and `startedBy` in the
parity set — at no cost to test stability. **Scalability had nothing to trade**: the delta adds no state,
so it contributes only the per-request CPU number in §3.5 and does not compete with either. And
simplicity-first, as tie-breaker, is what kills every remaining candidate abstraction in this delta:
no dep, no config key, no new wire field, no cache, no new fixture, no rename of a file the trace chain cites.
