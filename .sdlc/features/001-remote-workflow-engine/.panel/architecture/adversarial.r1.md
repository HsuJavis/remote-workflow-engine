# Architecture panel — round 1 (independent proposal), v27 ADR-051 reversal delta

**Lens:** Adversarial architecture group — (a) Security, (b) Scalability/performance, (c) Testability,
with Karpathy simplicity-first as the tie-breaker.
**Scope of THIS dispatch:** the scoped delta run `gates:[architecture,design,tests]`,
`impactIds:[REQ-133, REQ-134, REQ-140]` — folding **Round v27b's owner ruling (「開 —— 撤銷遮罩」,
ADR-051 option (b))** into ADR-051 / ADR-055 and the ARCH/DES/TASK rows that carry the predicate.
**Not in scope:** REQ-131/132/135/136/141 (landed at Gates 2–5 and untouched by the ruling),
REQ-137/138/139/142/143 (never in Sprint A's closure).
**Baseline read:** `01-requirements.md` §Round v27b + REQ-133/134/140, `state.yaml` `tech_stack`,
`02-architecture.md` ARCH-126/130/131 + ADR-051/054/055, `04-design.md` DES-196/197/198,
`tests/integration/dag-masking-auth.test.ts` as it stands after Gate 5, and the live source at `07266be`.
Every claim below is anchored at file:line.
**Prior round preserved:** the full Sprint A proposal (REQ-131..136/140/141, 34KB) is at
`.panel/architecture/adversarial.r1.sprintA.md` — unchanged, still the reference for the altitude
table, the REQ-136 argument and the REQ-141 fold. This file supersedes only its §on ADR-051.

---

## 0. Altitude call (short — the long version is in the Sprint A file)

This delta is **system-altitude**: it changes what bytes leave an HTTP route, on a transport whose
auth posture is fixed. The agent-altitude thread is thin but real — what the predicted overlay
discloses is *the shape of an agent graph* (labels, lane membership, order), so observability and
consumability are being traded against disclosure at the agent altitude while the mechanism is
entirely system-altitude. Both are applied; neither is forced.

**Lens boilerplate that does NOT apply here, stated once so nobody looks for it:** brute-force
counters, JWT forgery and timing attacks are out of scope for this delta. The surface being widened
is **unauthenticated by construction** — `server.ts:1284-1294` dispatches `/api/*` to
`handleDashboardRequest` with no bearer check at all, on both auth-on and auth-off deployments, and
the perimeter is the Host/Origin allowlist at `server.ts:1051-1055` plus the bind address. There is
no credential on this path to brute-force, forge or time. The auth subsystem (`src/auth/*`,
`resolvePrincipal`, `TokenStore`) is not touched by this delta, and no failure-counting state is
introduced. Saying so is the finding: **the mask was never a perimeter, and retiring it does not
remove one.**

---

## 1. Summary (my position in six lines)

1. **The ruling is defensible on the evidence, and I verified the premise rather than trusting it.**
   Under auth, an anonymous GET already yields every workflow name/owner/description/version/param
   contract (`/api/workflows` → `catalog.list()`, `workflow-catalog.ts:807-830`), the full
   `workflow_describe` projection including `params.agents` and `toolSurface` — i.e. **every agent
   label**, derived from the script by the same `scanAgentCalls` (`mcp-facade.ts:483-490`) — the
   author's rendered diagram for **any version** (`/api/workflows/:name/diagram.svg?version=`,
   `server.ts:416-431`), the run list, and the labels of every agent that has already executed
   (`view.agents` was never masked, `server.ts:511-514`). The predicted overlay adds *order and lane
   membership of the not-yet-reached nodes*. That is a genuine but small delta — §4 names the exact
   residual.
2. **Delete the predicate; do not disable it.** The correct shape of this delta is four deletions,
   not four `false`s: `if (!authEnabled)` (`server.ts:520`), `McpFacadeDeps.maskPredictedOverlay`
   (DES-197), `deriveLanes`'s `masked` param (DES-196/ARCH-126), and `handleDashboardRequest`'s
   `authEnabled` parameter itself (`server.ts:334`, whose ONLY consumer is `:520`).
3. **DES-197's fail-closed default inverts under the ruling and becomes a live defect generator.**
   「absent ⇒ `true` (masked)」 was safe while the mask was the decision; now a forgotten forward
   produces exactly the degradation the owner just refused, silently, on the deployment the owner
   described. This is the `composeConfig` forgot-to-forward class the ledger has already been bitten
   by twice (v11 `updateFlagPath`, v15 auth) and it is only ever caught by a real run. The cheapest
   fix is to have no dep to forget.
4. **What replaces the mask is a property, not a value:** the dashboard read surface becomes
   **auth-invariant**, and that is a stronger, cheaper oracle than the assertion it retires. One
   parity test over the two servers the IT-092 harness already boots.
5. **One real defect the reversal EXPOSES rather than causes** (§3, F-1): under the legacy-cohort
   fallback (`server.ts:495-508`) the predicted overlay can be derived from a **different script
   version than the run executed**. Auth deployments could not see this before; now every viewer can,
   unlabelled. Fix is one existing-array warning code, no new field.
6. **Cost:** the derivation now runs on every DAG poll on auth deployments too. I propose a measured
   budget at Gate 7.5 and a pre-agreed 5-line memo **only if** it is exceeded — not a cache now.

---

## 2. key_points

### K-1 (all three lenses agree) — retire the predicate in four places, and state the post-delta signatures

| # | What dies | Where | Why it is safe |
|---|---|---|---|
| 1 | `if (!authEnabled) { … }` wrapper | `server.ts:520` | The `try/catch` **inside** it stays: a parse/derivation fault must still degrade to an empty overlay, never a 500 (`server.ts:540-542`). Only the auth condition goes. |
| 2 | `McpFacadeDeps.maskPredictedOverlay?: boolean` | DES-197 signature (never implemented — Gate 5 stopped first) | It is a *new* dep whose only correct value is now constant. See K-2. |
| 3 | `deriveLanes(…, { masked })` | ARCH-126 / DES-196 | Post-delta signature: **`deriveLanes(phases, expectedGraph, { status })`** — `masked` dropped, `status` **kept**: Gate 5 already measured that `current` cannot be derived from `phases`/`expected` alone (a terminal run still carries non-empty `phases`), and recorded the gap rather than inventing a signature. This delta is where it gets reconciled literally. |
| 4 | `handleDashboardRequest(…, authEnabled = false, …)` | `server.ts:334`, forwarded as `!!authCfg` at the ONE dispatch site (`server.ts:1067-1069`) | `grep -n authEnabled src/**` → declaration `:334`, two comments (`:350`, `:819`), one consumer `:520`. After (1) the parameter is dead. Deleting a **positional** parameter is normally a silent-shift hazard; here it is type-safe because the two trailing parameters are disjoint types (`authAnnounce: {…}`, `diagrams: DiagramRenderer`) so `tsc --noEmit` fails on a mis-shift, **and** the v23 Gate 6.5 round-4 one-dispatch rule guarantees exactly one call site to edit. Keep `authAnnounce` — `/api/system` still reports `{enabled, principalsCount, defaultRole}` (ARCH-090), and *that* is how an operator learns auth is on. |

`ADR-051` is **amended in place** to decision (b) with the owner's ruling and its date; `ADR-055`'s
「masked exactly like the run-DAG predicted overlay」 clause becomes 「unconditional, for the same
reason」. Neither is superseded — the options analysis and the disclosure reasoning stay on the record,
because §4's residual is only readable against them.

### K-2 (security ∧ simplicity, against testability's instinct) — a seam whose only default is the wrong one is worse than no seam

DES-197 specified `maskPredictedOverlay?: boolean`, absent ⇒ masked, forwarded once from `server.ts`.
Under decision (a) that was correct defensive design. Under the ruling it inverts:

- the default is now **the refused behaviour**, so every unit-constructed facade, every future test
  helper and every forgotten forward degrades REQ-133/134 to lanes-only;
- the failure is **silent and only reachable with auth on** — precisely the Gate-7.5-only detection
  profile of the `composeConfig` wiring class (`MEMORY.md`: v11 `updateFlagPath`, v15 auth), which
  this ledger has a named guard test for *because* type-checking cannot see it;
- it buys nothing: there is no configuration in which `true` is wanted after the ruling.

Karpathy tie-break: the minimum architecture that satisfies REQ-140's Round v27b clause has **zero**
new deps, zero new parameters and one fewer branch than the code that exists today. Delete it.

### K-3 (testability, replacing what security loses) — one parity oracle, named precisely

Rewrite `tests/integration/dag-masking-auth.test.ts`'s inverted cases into **one auth-invariance
parity test** over the two servers the file already boots (`authServer` / `openServer`, same
`SCRIPT`, same `registerPublishedVia` helper — no new fixture, no new harness):

> For the same registered script and an equivalent run, the **structural** fields of
> `GET /api/runs/:id/dag` are equal on both servers: the **set** of `cells[].id`, `edges`,
> `lanes`, `current`; and `workflow_describe.phases[].agents` is equal.
>
> `cells[].id` — **not** `cells[].label`: `layoutGraph` is handed `startedByType`
> (`server.ts:544`), so the trigger cell's own label legitimately differs between a run started
> by a real principal and one started anonymously. An "improvement" to labels makes this flaky.

Naming the fields matters, or Gate 5 writes a flaky test: the payloads are **not** byte-identical —
`runId` differs, and `startedBy` differs (the auth run is started by a real principal, the open run
by the anonymous path). Parity is asserted on structure only. This oracle is strictly stronger than
the assertion it replaces, because it fails on *any* future disclosure divergence between the two
deployments, not just on the one branch that existed.

Two supporting controls, both already planned or nearly free:
- **ADR-054's golden key-set test** extends to the DAG payload and to `describe.phases[]`. That is
  now the only thing standing between a future field and a silent widening — it was a nice-to-have
  under the mask and is load-bearing after it. This is the one place I would spend new test budget.
- **The successor to what ADR-012 actually protected**: assert that no `/api/*` payload contains
  script **text**. `IT-092`'s first case can carry it — see K-4.

### K-4 (trace hygiene — this is not a weakened assertion)

`IT-092` traces to **REQ-100** (`workflow_get`/`workflow_source` masks the script for non-owners).
Its first case asserts `cells == ['__trigger__']` under auth; the ruling inverts it. The ledger rule
is 「不得以放寬斷言了事」, so the disposition must be explicit:

- REQ-100's real protection — **script text** — is verified by `IT-089`
  (`tests/integration/workflow-masking-http.test.ts`, `workflow_source`/`workflow_list` over a real
  bearer) and by `val-110-script-masking`. Both are untouched by this delta and neither weakens.
- `IT-092`'s cells assertion is therefore **re-traced**, not deleted: it becomes 「the DAG payload
  carries no script bytes」, and joins K-3's parity case, under REQ-133/REQ-140. **The sentinel
  must be a token the derivation cannot legitimately surface** — never an agent label, a phase
  title or a tool name, because those are exactly what the reversal now publishes on purpose.
  Concretely: add one line to the fixture `SCRIPT`
  (`const IT092_SENTINEL = 'never-leaves-the-engine';`) and assert that literal is absent from the
  response body. Written any other way this test is either red by construction or a false pass,
  depending on which token the verifier picks.
- `IT-168`'s 「`phases[].agents` ABSENT under auth」 case flips to 「present and equal to the open
  server's」. `tests/unit/dashboard-derive-lanes.test.ts` drops its `masked:true` case and keeps
  `status`.
- Everything in `val-111-phases-public-everywhere` is *reinforced* by this delta, not disturbed.

### K-5 (scalability — measure, don't cache)

With the branch gone, every DAG poll on an auth deployment now also runs `parseWorkflowSkeleton` +
`scanAgentCalls` + `deriveExpectedGraph` (two full regex scans of the script, `skeleton-graph.ts:8-20`)
on top of the `catalog.resolve` it already ran unconditionally (`server.ts:500-505`). The dashboard
polls at 3s (REQ-142) and the owner's deployment is 「我 + 團隊」 — several viewers, each with a run
page open.

- This is **not a new class of cost**: `/api/workflows` already `parseMeta`s every workflow's script
  on every call (`workflow-catalog.ts:820-832`), and the open-auth deployment has paid the DAG
  derivation per poll since v26.
- So I refuse a cache now — it would be speculative, and a memo keyed by anything but
  `(name, version)` would be wrong. **Proposal:** Gate 7.5 records ONE number (p95 wall time of
  `GET /api/runs/:id/dag` on the real box, auth on, with the largest script in the corpus). If it
  exceeds **50 ms**, a 5-line memo keyed `` `${name}@${version}` `` is pre-approved — safe because a
  registered version's script is immutable (v22 version history) and the derivation is pure. If it
  does not, nothing is built and the number is on the record for the next iteration.

---

## 3. risks

**F-1 (HIGH, mine alone — a real defect the reversal EXPOSES, not one it causes).**
`server.ts:495-508` is a legacy-cohort fallback: resolve the run's **pinned** `(name, version)`, else
fall back to the current `release`, else empty. Under the mask, auth deployments never rendered a
predicted overlay at all, so a fallback-derived overlay was invisible there. After the reversal every
viewer sees a predicted structure that may have been derived from **a different script version than
the run executed** — different labels, different lanes, different edges — with nothing on the wire
saying so. That is an observability **lie** on the one surface REQ-134 exists to make honest, and it
lands on exactly the deployment the owner ruled for.
*Fix, cheapest form:* the payload already carries a `warnings[]` array from `layoutGraph`. Push
`PREDICTED_FROM_FALLBACK_VERSION` (with the version actually used) when the pinned resolve throws and
the fallback succeeds; the client greys the predicted overlay and says so. **Zero new wire fields.**
Precisely on the client side, measured rather than assumed: today's page consumes `warnings` as a
COUNT only (`dashboard-page.ts:601-607`, 「N warning(s)」), so the *text* is not rendered anywhere
yet — the rebuilt client (ARCH-125) owes that rendering regardless, because REQ-134's legend row is
the honesty surface for exactly this class. So: no new wire plumbing, and no client work beyond what
the rebuild already owes. The same sentence settles the
observed-vs-predicted conflict rule, which only arises in this case: **observed phases win for any
lane the run entered; the predicted overlay fills gaps only**, and a title conflict at the same lane
index emits the warning rather than silently overwriting.

**F-2 (MEDIUM — residual disclosure, belongs in ADR-051's note, NOT a blocker).**
The owner ruled; this is for the record so Gate 8 does not rediscover it as a finding. The anonymous
HTTP `/api/workflows/:name/describe` route takes **no `?version=`** (`server.ts:396-411`) — it always
resolves default-release — while `/api/workflows/:name/diagram.svg` **does** (`server.ts:416-431`).
So after the reversal the precise newly-anonymous information is: *the lane membership and edge order
of a **pinned, non-release** version whose author-supplied `mermaid` is `null`* — i.e. the pre-v26
grandfathered cohort, since REQ-128's diagram contract is enforced only for post-v26 registrations.
For every other version that structure is already anonymously public as a rendered diagram — and the
cohort boundary is exact, not hand-waved: the diagram route answers `404 DIAGRAM_UNAVAILABLE /
LEGACY_NO_DIAGRAM` precisely when `mermaid` is null (`server.ts:429-431`), i.e. for the same rows.
One sentence in ADR-051's note; no mitigation, because the mitigation the owner refused is the mask.

**F-3 (MEDIUM — the standing hazard the deletion makes harmless *this* round, not forever).**
`server.ts:563` and `:400-410` pass a **synthetic** `{kind:'auth-disabled'}` principal into the facade
on the dashboard's agent and describe routes whatever the real auth setting is. DES-197 correctly
warned that a `principal.kind`-based masking test would therefore unmask under auth. After K-1 there
is no masking decision left in the facade for these routes, so the hazard has no current instance —
but the **pattern** survives, and the next principal-dependent projection added to the facade will
re-create it silently. K-3's parity test is the empirical guard (it fails the moment any facade
projection starts differing by deployment), and that is sufficient; I do **not** propose a new
abstraction over the synthetic principal. Name it in ARCH-131's note so the next author sees it.

**F-4 (LOW — scope creep by sympathy).** The reversal is for the **predicted-overlay predicate only**.
`workflow_source`'s script masking (REQ-100), `run_agent_log`'s REQ-136 system-prompt strip (ARCH-129,
landed at Gates 2–5 and **not** in this delta's impact set), and the three `dbindExempt` auth gates
(blob/manifest/mcp, `server.ts:1123-1180`) all stand. A delta that touches any of them is out of
closure. Stated because 「撤銷遮罩」 reads broader than it is.

**F-5 (LOW — Gate 7.5 instruction flip).** ADR-051's standing instruction was 「run one
`auth.enabled:true` case and **record what degrades**」. Round v27b inverts it: 「run one
`auth.enabled:true` case and **prove the overlay IS visible**」. If the old sentence survives in
ADR-051 or in REQ-133/134's validation column, the validator will faithfully record a degradation
that must no longer exist and call it evidence.

---

## 4. expected disagreements with the other lens (quality-dimensions)

**D-1 — QD will want to keep the `maskPredictedOverlay` seam, for replaceability.**
The predictable argument: a configuration seam costs one optional field and preserves the option of a
per-principal disclosure tier later. **Pre-argument:** a seam whose only correct value is constant
buys no replaceability — it buys an unexercised branch that decays. The future thing QD is protecting
(D1's per-principal dashboard permission tier, explicitly refused again in Round v27b) would need a
*principal-aware* seam on a route that carries no principal at all (`server.ts:1284-1294`); it is a
different dep with a different default and different plumbing, and reviving this one would be the
wrong shape anyway. Replaceability is served by the derivation staying pure and single-sourced
(`deriveExpectedGraph`, three consumers, INV-V26-3), not by a boolean.

**D-2 — QD will likely prefer an explicit `masked: false` (or a documented contract row) over deletion**,
on the observability principle 「the decision should be visible on the wire/contract」. I agree with the
principle and disagree with the instrument: the decision becomes visible in **ADR-051's amended note
and the API-contract table**, which is where a reader looks, and in the parity test, which is where a
regression is caught. A `false` in code is a decision nobody can find and everybody can flip.

**D-3 — F-1's warning code.** I expect QD to propose a first-class field
(`predicted: {version, source}`) as the cleaner contract. It is cleaner; it is also a new wire field,
a new client branch, a new key-set-test entry and a new fixture shape for `dashboard-wire.ts`. The
`warnings[]` array exists, renders today, and is already the honest-degradation channel
(`kind:'run'` payload). Simplicity tie-break says reuse it. If QD shows that the client's warning
rendering cannot carry a version string, I concede to the field.

**D-4 — Test budget.** I expect QD to want the golden key-set tests broadened across every `/api/*`
endpoint now that the mask is gone (ADR-054's fuller form). I would hold it to the two endpoints this
delta actually widens (`/api/runs/:id/dag`, `describe.phases[]`) plus the parity test, and leave the
rest to the Sprint A closure's own Gate 6. The rule I would argue for: **a key-set test is owed by the
endpoint whose key set this delta changes**, not by every endpoint that exists.

**D-5 — Where I expect agreement, stated so the synthesis does not re-litigate it:** deleting the
`if (!authEnabled)` branch (both lenses argued for the reversal at round 1 — D-ADV-2 and QD's O-3
differed only on instrument), keeping the inner `try/catch` degradation, keeping `status` on
`deriveLanes`, and the IT-092 re-trace being a re-trace rather than a relaxation.

---

## 5. Appendix — the exact ledger edits this delta implies (for the synthesizer)

| Item | Edit |
|---|---|
| ADR-051 | amend in place → decision **(b)**, owner-ruled 2026-09-11 (Round v27b); keep the options analysis; add F-2's residual; flip the Gate 7.5 instruction (F-5) |
| ADR-055 | amend → `phases[].agents` unconditional, same predicate retirement; the 「(a) as the under-auth fallback」 clause retires |
| ARCH-126 | `deriveLanes(phases, expectedGraph, { status })` — `masked` dropped, `status` reconciled (Gate 5's recorded gap) |
| ARCH-130 | server wire: `if (!authEnabled)` retired, `handleDashboardRequest`'s `authEnabled` param and its `!!authCfg` forward retired; `warnings` gains `PREDICTED_FROM_FALLBACK_VERSION` (F-1) |
| ARCH-131 | facade: `maskPredictedOverlay` never exists; F-3's synthetic-principal note recorded. Confirmed by measurement, not assumption: `grep -rn maskPredictedOverlay src tests` → **0 hits** at `07266be`, so the dep was specified at Gate 4 and never implemented or tested — this delta deletes a line of design text, not code |
| DES-196/197/198 | signatures follow the three rows above |
| TASK-202/203 (+ the `deriveLanes` task) | scope lines follow; no new TASK id needed |
| `tests/integration/dag-masking-auth.test.ts` | IT-092 re-traced (no script bytes on the DAG payload) + IT-168 flipped + **one new parity case** (K-3) |
| `tests/unit/dashboard-derive-lanes.test.ts` | `masked` cases dropped; `status` cases kept |
| REQ-133/134/140 | acceptance already carries the Round v27b ruling — no requirement edit needed |
