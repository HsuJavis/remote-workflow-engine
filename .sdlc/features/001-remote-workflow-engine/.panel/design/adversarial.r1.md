# Design panel — round 1 (independent proposal), iteration **v27b**

**Lens:** Adversarial design group — three lenses that trade against each other:
**(a) Interface-contract** (signatures, input/output types, compatibility),
**(b) Boundary/error** (failure modes, error codes, completeness of boundary conditions),
**(c) Testability** (every DES coverable by a UT; clock/storage injectable).
**Tie-breaker:** Karpathy simplicity-first — the minimum design that solves the problem, no needless
flexibility. Where my own three lenses pull apart I name the conflict in §3 instead of silently picking.

**Provenance.** This file REPLACES the v27 full-closure design panel that occupied this path
(round 1, 2026-09-11 18:23, committed — readable at `git show HEAD:.sdlc/features/001-remote-workflow-engine/.panel/design/adversarial.r1.md`).
Nothing in it is retracted; it covered a different closure (REQ-131..136/140/141) and the DES rows it
produced are on disk as DES-191..208. This round is the **v27b scoped delta**.

**Scope.** `impactIds = REQ-133 / REQ-134 / REQ-140`, the design+tests half of the owner ruling
(ADR-051: 開 —— 撤銷遮罩). Architecture landed at Gate 2 delta (2026-09-11) by amending ADR-051 /
ADR-054 / ADR-055 / ARCH-125 / ARCH-126 / ARCH-130 / ARCH-131 in place and adding INV-V27-9.
`03-tasks.md` **does exist** for v27 (TASK-196..213) — the generic dispatch line is wrong for this
iteration — so §4 states task *deltas and ordering*, not a task split.

**Baseline read (every claim below anchored at `file:line`, read this session, not recalled):**
`01-requirements.md:1657-1686` (Round v27b log), `:1730-1747` (REQ-133), `:1748-1771` (REQ-134),
`:1857-1870` (REQ-140); `02-architecture.md:3359-3378` (ARCH-125/126), `:3407-3426` (ARCH-130/131),
`:3441-3477` (ADR-051/054/055), `:3657` (INV-V27-9), `:3700-3763` (Decision rationale — v27b);
`04-design.md:6713-6719` (DES-192), `:6745-6767` (DES-196/197/198), `:6785-6791` (DES-201),
`:6825-6831` (DES-206); the live tree at `576a972` + working-tree edits.

---

## 0. Altitude call — a SYSTEM-altitude delta with exactly ONE agent-altitude touch

`tech_stack` describes an AI-agent system delivered through a conventional server-rendered web system.
The v27 closure as a whole straddles both. **This delta does not.** Deleting a route branch, threading a
version, pushing three warning strings and rendering them is system altitude end to end — observability
of a *server*, replaceability of a *route parameter*, consumability of an *HTTP payload*.

The single agent-altitude touch is real and must not be lost: `describe.phases[].agents` and the DAG
warning vocabulary are read by a **cold model** through MCP (`workflow_describe`, `workflow_get`), not
only by a browser. That changes exactly two things in my lenses:

| | System altitude (the wire + the view) | Agent altitude (the cold reader) |
|---|---|---|
| (a) contract | `deriveLanes` signature, `lanes[]` density, the four-deletion type-safety | `agents?: string[]`'s ABSENCE must have one machine-decidable meaning |
| (b) boundary | which arm pushes which warning, and where | `PREDICTED_OVERLAY_UNAVAILABLE` must not read to a model as *run* failure |
| (c) testability | pure `lib/` UT + the two-server harness | the oracle asserts the **response body of both transports**, never the projection function |

I do **not** force agent altitude onto the CSP, the static arm, or the parameter deletions. It would be
theatre.

---

## 1. Summary

The architecture delta is unusually well-specified and I endorse its spine: **four deletions, not four
`false`s**; observed-wins-predicted-fills-the-tail; `TOKEN: detail`; INV-V27-9 parity as the replacement
control. My proposal is not a counter-design. It is **twelve corrections and completions** the delta
needs before it can be implemented without a Gate 8 send-back, of which three are load-bearing:

1. **The control ADR-054 leans on cannot see the wire.** `tests/integration/dashboard-disclosure.test.ts:36`
   asserts the key set **"against the fixture itself"** — its own `it()` title says so. DES-192's own
   `tests:` line already required "one runtime assertion that the fixture's key set equals the live
   response's key set, or the fixture drifts into decoration" (`04-design.md:6718`) and **Gate 5 wrote
   only the fixture half**. So ADR-054's v27b budget rule ("the reversal costs nothing there") is true
   but is being checked by a test that only goes red when someone edits the fixture. Fix is in-closure
   and costs one call: IT-168 already boots both servers — feed the live DAG payload through the same
   `allowed/required` check.
2. **The reversal ships blank nodes on the deployment the owner actually runs.** A predicted cell is
   emitted as `{ id: '__skel_<i>__', kind: 'agent', col, row, laneSpan: 1 }` with **no `label`**
   (`src/dashboard.ts:425`), and the renderer falls back to `c.label || c.kind` — literally the text
   `agent` (`src/dashboard-page.ts:581`). Before the ruling, auth deployments never saw those cells, so
   the defect was invisible. After it, every unreached node on 「我 + 團隊,遠端連進來」 is an anonymous
   box — and REQ-134's 「5 lane、9 agent **一眼看出卡在哪**」 is not satisfiable from the DAG payload
   alone, because the run view's fetch set is `/dag` only (`tests/unit/dashboard-client-corpus.test.ts:30-35`).
3. **The token→string mapping, as ARCH-125 words it, is unreachable by any unit test.** ARCH-125's v27b
   amendment puts "split on the first `: `, map the TOKEN through `lib/strings.js`, fall back to raw"
   in `ui/run.js` — and ADR-049 refuses jsdom, so DES-206 states in as many words that the `ui/` layer
   "has NO unit tier by construction" (`04-design.md:6830`). Parsing is a decision a pure function can
   make, which DES-206's own boundary forbids the view from taking.

Everything else is precision: `current`'s status domain, `expected`'s optionality, `lanes[]` density,
the `pinned=` misnomer, where each warning is actually pushed, the parity oracle's stabilization
predicate and per-surface scoping, and the two ledger markers (DES-114/DES-115) the architect routed to
this gate.

**Headline:** endorse the four deletions and the parity control, but the delta is not implementable as
written — the disclosure control is fixture-only, the predicted node has no label, and the warning
mapping has no unit tier; fix all three inside the existing files and add no module, no config key and
no cache.

---

## 2. Key points — paste-ready row deltas

### 2a. Interface-contract lens

**A-1 — `deriveLanes`'s final signature (DES-196 `signature:`).** Replace with:

> `deriveLanes(phases: PhaseView[], expected: ExpectedGraph, opts: { status: RunStatus }) → { lanes: Array<{ index: number; title: string | null }>; current: number | null }`

Three changes, each with its reason: `masked` is **deleted** (ADR-051; a boolean whose only correct
value is constant is an unexercised branch, and its fail-closed default fails closed to the behaviour
the owner refused); `status` is the single `opts` member (`current` genuinely needs it — a terminal run
still carries non-empty `phases`); and **`| undefined` comes off `expected`**. Post-reversal the route
initialises `expectedGraph = { lanes: [], slots: [], edges: [] }` unconditionally (`src/server.ts:519`)
and every arm either replaces it or leaves it empty, so `undefined` can no longer arrive from
production. DES-196's stated reason for the optional (「`server.ts:519-520` populates it only
`if (!authEnabled)`」) dies with the branch. The body stays **garbage-tolerant** anyway — `layoutGraph`
already guards with `Array.isArray(expected?.lanes)` (`src/dashboard.ts:346`) and `deriveLanes` must
match it — but tolerance is a body property, not a type property. See §3 for the (a)/(c) conflict this
resolves.

**A-2 — `current`'s status domain: DES-196's seven-member table STANDS.** ARCH-126's v27b `api:` line
says 「`current` is the last observed phase index while `status === 'running'`, else `null`」
(`02-architecture.md:3370`). That is near-verbatim the **pre-refinement** v27 wording; DES-196 already
refined it to `running | suspended | interrupted` → last observed index, `null` for `queued` and the
three terminal states (`04-design.md:6746`), and UT-238's header records the refinement explicitly
(`tests/unit/dashboard-derive-lanes.test.ts:4-5`, `LIVE_STATUSES = {running, suspended, interrupted}`).
This is not a new conflict — the ledger already carries the precedent that a DES row may refine an ARCH
`api:` line at one altitude down. **Action:** keep DES-196's table verbatim; the synthesizer routes a
one-clause ARCH-126 correction (「while the run is live (`running | suspended | interrupted`)」).
Rationale for the refinement, restated so it is not re-narrowed a third time: `suspended` and
`interrupted` are precisely the runs an operator is staring at to decide whether to resume — showing
them no 「目前」 lane is the observability the ruling was about.

**A-3 — `lanes[]` density is an unstated contract (DES-196 `boundary:`, add).** `current` is consumed by
the client as 「one integer read rather than a recomputation」 (ARCH-126), and `layoutGraph` lays a lane
out at `col = lane.index + 1` (`src/dashboard.ts:363`). Nothing today says whether the returned array's
**position** equals its `index`. Add, as one sentence:

> The returned `lanes` is DENSE and ordered: `lanes[k].index === k` for every k, observed lanes first,
> unreached expected lanes appended in `index` order. `current` is `null` or an integer in
> `[0, lanes.length)`. A non-contiguous `expected.lanes` (defensive: nothing produces one today) is
> re-indexed on append, never copied through, because a hole makes array position and `index` disagree
> and every downstream join is by ordinal.

One UT case (`expected.lanes` = `[0,1,3]` → `lanes` = 0..2 with titles in order), and it is the cheapest
row in the delta.

**A-4 — the predicted cell needs a `label`, or REQ-134's acceptance must be scoped in writing.**
Evidence above (§1.2). The minimum fix is one property in an already-pure function:

> `04-design.md` DES-196 (or a one-line DES-198 clause, synthesizer's call): the inert predicted cell is
> emitted as `{ id: '__skel_<slot.index>__', kind: 'agent', label: <the slot's first label>, laneSpan: 1 }`
> — `label` taken from `ExpectedSlot.labels[0]`, absent when the slot declares none (a dynamic lane).
> `LayoutCell.label` already exists and is already inside the allowed nested shape, so this widens no
> top-level key set. The **fifth site** this touches is the type's own doc comment
> (`src/dashboard.ts:250`: 「present only on a LIVE agent cell (never on a predicted/inert `__skel_*` one」)
> — amend it in the same commit, or the next reader treats the label as a bug.

**Blast radius, checked rather than assumed:** `grep -rn "__skel_" tests/` returns 12 hits across four
files (`diagram-contract-grandfather:98/111/151`, `dashboard-http:215-217`, `dag-masking-auth:114-126`,
`layout-graph-phase:102-109`) and **every one of them asserts on cell IDs or COUNTS — not one asserts
`label` is `undefined` on a predicted cell**. So A-4 costs exactly two edits (the `placeCell` at
`src/dashboard.ts:425` and the `:250` comment) plus its own new UT case, and breaks no existing test.

**Disclosure check, because this is the one place the delta could over-widen:** it adds nothing ADR-055
does not already serve. ADR-055 publishes 「the agent labels expected in that lane in slot order」 as
`describe.phases[].agents` **unconditionally, to every caller** — the same labels, the same grouping,
the same ruling. Putting them on the DAG cell saves the run view a second endpoint per tick; withholding
them means either a blank graph or a per-run `describe` fetch and an ordinal join in the client, which is
strictly more machinery for strictly less honesty. **Honest fork, stated rather than smuggled:** if the
synthesizer rules this outside the REQ-133/134/140 impact set, then REQ-134's 「一眼看出卡在哪」 must be
amended in the same pass to say the unreached nodes are unlabelled — because shipping it silently is how
Gate 7.5 discovers it with a screenshot.

**A-5 — `__skel_` stays on the wire, and that is a decision, not an oversight (DES-198 `boundary:`, add
one sentence).** The predicted cell id has carried the string `__skel_` since v11 and is asserted by
`tests/integration/dag-masking-auth.test.ts` (IT-092). The reversal now exports it to auth deployments
for the first time, so the next reader will read it against C3 / `no-skeleton-surface` / REQ-133's
「不得出現 "skeleton"」 and reach for a rename. Write down why not: the guard forbids the literal word
「skeleton」, `__skel_` is not that word, the id is **never rendered** (`c.label || c.kind`, and with A-1
a real label arrives), and renaming it is a breaking change to a pinned payload plus three test files for
a lexical preference. Karpathy: keep, state, move on.

**A-6 — `pinned=` is a misnomer in the fallback warning (DES-198 `signature:`).** ARCH-130 (ii) emits
`PREDICTED_FROM_FALLBACK_VERSION: pinned=<the version (i) asked for> resolved=<release>` — but (i) now
asks for `legacySubstitution?.resolved ?? view.scriptVersion`, so when a substitution exists `pinned=`
carries the **substitute**, not the run's pin. The ADR is aware ("never the raw pin … or the string
itself would be the lie") and then names the field `pinned` anyway. Rename to **`requested=`**. Full
grammar, pinned as a contract because a client and a cold model both parse it:

> `WARNING := TOKEN (": " DETAIL)?` — `TOKEN` is one of exactly **two** literals
> (`PREDICTED_OVERLAY_UNAVAILABLE`, `PREDICTED_FROM_FALLBACK_VERSION`), or the string is raw prose from
> `layoutGraph` and carries no `TOKEN`. `DETAIL` is `k=v` pairs separated by one space, keys drawn from
> `{requested, resolved, reason}`, values `[A-Za-z0-9._-]+`. Never free text, never a version string
> with a space in it.

### 2b. Boundary/error lens

**B-1 — the four deletions: verified, and the type-safety claim holds.** I checked rather than trusted.
`authEnabled` occurs four times in `src/server.ts`: the parameter (`:334`), two comments (`:350`, `:819`)
and the single branch (`:520`); the sole call site is `:1068`
(`…, modelBook, !!authCfg, authAnnounce, diagrams)`), and the two trailing parameters are
`{enabled, principalsCount, defaultRole}` and `DiagramRenderer` — disjoint from `boolean`, so a forgotten
argument deletion is a `tsc --noEmit` error, not a silent shift. `authAnnounce` must survive (ARCH-090).
**Add to DES-198's boundary:** the two comments at `:331-334` and `:1064` are part of the deletion — a
comment that states a mask which no longer exists is the same defect as the mask, one gate later.

**B-2 — where each warning is pushed is a correctness condition, and one arm has no throw to catch.**
This is the completeness hole in the delta. Read the route as it stands (`src/server.ts:495-540`): the
version resolution's inner failure does **not** propagate — it assigns `skeletonScript = ''` and falls
through (`:504-506`), and `parseWorkflowSkeleton('')` does not throw; it yields an empty graph, which
`layoutGraph` renders as a trigger-only DAG **with `warnings: []`**. So an implementer who reads
ARCH-130's 「on a second throw, an empty overlay plus `PREDICTED_OVERLAY_UNAVAILABLE: catalog-resolve-failed`」
and puts the push downstream will push nothing, forever, and every test will be green. Write the four
arms **at their site**:

| arm | site | push |
|---|---|---|
| (i) resolved from `legacySubstitution?.resolved ?? view.scriptVersion` | `:500` success | nothing |
| (ii) first `catch` → `catalog.resolve(spec.name, {})` succeeds | inside that catch, **before** the fall-through | `PREDICTED_FROM_FALLBACK_VERSION: requested=<x> resolved=<y>` |
| (iii) second `catch` (`:504-506`, `skeletonScript = ''`) | **inside that catch** — nothing downstream throws | `PREDICTED_OVERLAY_UNAVAILABLE: reason=catalog-resolve-failed` |
| (iv) derivation `catch` (`:540`) **or** the FALSE arm of the `v1.ok ?` ternary (`:538`) | those two sites only | `PREDICTED_OVERLAY_UNAVAILABLE: reason=derivation-failed` |

and the standing negative: **no `spec.name`** (an inline-script run) resolves nothing and emits nothing,
and the legitimate `else` at `:534` (a v1-contract script with no `phase()` — REQ-124's grandfathered
cohort) emits nothing, or `diagram-contract-grandfather.test.ts:101` and `dag-warnings-empty.test.ts:37`
go red on a correct run. All pushes happen at the ROUTE into `routeWarnings`, never inside `layoutGraph`.

**B-3 — the degraded log line needs a closed reason vocabulary.** ARCH-130 (4) emits
`{event:'dashboard_api_degraded', route, reason}` from two existing catches, and the v27b amendment adds
the two `PREDICTED_OVERLAY_UNAVAILABLE` arms with `{route:'dag', runId, reason}`. If `reason` is
`(err as Error).message` on one path and a token on the other, no operator can group the journal.
**DES-198 boundary, add:** `reason` is a closed lowercase-kebab token set —
`catalog-resolve-failed | derivation-failed | internal` — and the free-form message, when there is one,
rides a separate `detail` key that is never grepped. Precedent is in the file (`diagram_render_failed`,
`src/server.ts:440`). The `PREDICTED_FROM_FALLBACK_VERSION` arm emits **no** log line: it is a state whose
durable record is `legacySubstitution`, not a fault — ARCH-130 is right and the reason belongs in the DES
row so nobody "improves" it into a per-poll journal flood.

**B-4 — `agents?: string[]`'s absence must be machine-decidable (DES-197 `boundary:`).** ADR-055 now says
absence means exactly one thing: 「the engine could not derive the predicted layout for that version」.
Two ways to break that without noticing, both currently unwritten:
- `projectWorkflowDescribe` builds `phases` from the **registered metadata** (`full.phases`,
  `src/workflow-view.ts:193`) while `predictedLanes(full.script)` **re-derives** from the script. The two
  can disagree in length. Rule: join by ordinal; a phase row with no derived lane gets **no `agents` key**
  (never `[]`); derived lanes beyond `phases.length` are dropped, not appended — `describe.phases` is the
  author's contract and this projection may not invent a row in it.
- A lane whose slots exist but declare no labels (a dynamic lane — `tests/unit/layout-graph-phase.test.ts:102`
  pins that such a lane emits no inert cells at all) emits **`agents: []`**. Two states, two shapes:
  **absent = the engine could not derive**, **`[]` = derivable but dynamic**. This is my call, not a
  question for the synthesizer — ADR-055's own option (a) 「survives only as the DERIVATION-FAILURE shape」,
  which is exactly what collapsing the two would destroy. It matters because the consumer is a cold model
  reading `workflow_describe`: 「absent」 vs 「empty」 is the whole message.
- Legacy row with no `script` at all: the projection is unchanged (no `agents` anywhere), and that is the
  same shape as derivation failure. Accepted and stated — inventing a third shape for a cohort that has no
  script is machinery for nothing.

**B-5 — a one-line honesty ceiling on `current`.** `current` is derived from `phases.length - 1`, which is
the last phase the run **entered**. For a loop-body `phase()` the runtime appends one `PhaseView` per
ENTRY (`src/run-manager.ts:1075`) while the predicted graph opens one lane per phase NODE
(`src/skeleton-graph.ts:111-112`), so `current` can legally exceed the predicted lane count. ARCH-126's
join rule already covers `lanes` (observed wins, predicted fills the tail); say the same for `current`
explicitly, or an implementer will clamp it to `expected.lanes.length - 1` and silently mislabel every
looping workflow.

### 2c. Testability lens

**C-1 — close DES-192's own missing runtime assertion, in IT-168, this delta.** Precise claim, so the
synthesizer can check it: only the **key-set half** is fixture-only
(`tests/integration/dashboard-disclosure.test.ts:36-44`, driven by `DISCLOSURE_TABLE`); the REQ-136 half
of that same file boots a real server with a real stub provider and asserts on a live body (`:47-62+`),
and it is fine. The rebuttal to "but the fixtures are `satisfies`-typed" is that `DagPayloadFixture` is a
**local interface in the fixture file** (`tests/fixtures/dashboard-wire.ts:73-84`), so `tsc` cannot see a
server-side addition at all; and even for the genuinely shared types (`AgentLogView`), typing a literal
does not force it to carry a newly-added **optional** field. **Action, ~6 lines, no new file:**

> IT-168 (`dag-masking-auth.test.ts`) already boots an auth server and an open server and reads
> `/api/runs/:id/dag` on both. Feed **both live payloads** through the same
> `keys ⊆ ALLOWED_DAG_KEYS && REQUIRED_DAG_KEYS ⊆ keys` check the fixture row uses, importing the two
> tuples from `tests/fixtures/dashboard-wire.ts`. The fixture row stays (it pins the intended shape); the
> live assertion is what makes it non-decorative. DES-192's `tests:` line is then satisfied as written.

**C-2 — INV-V27-9's parity oracle needs three things it does not have.**
1. **A stabilization predicate**, or it flakes by construction. Excluded fields are `runId`/`terminalAt`,
   so `cells[].state` is compared — and `state` transitions `queued → running` across an `await
   acquireSlot()` (`src/run-manager.ts:1240-1246`), so two independently started runs can legitimately be
   read one tick apart. `tokens`/`costUSD` are zero under the never-resolving gateway and `cells[].id` is
   deterministic (`agent-${n}`, `src/run-guard.ts:207`) — so the fix is narrow: **poll both servers until
   the same predicate holds on both, then compare.** Predicate below.
2. **The exclusion list as a named constant in the test**, e.g.
   `const PARITY_EXCLUDED = ['runId', 'terminalAt'] as const`, with a comment that adding a member is a
   disclosure decision. An inline `delete p.runId` is how a future author excludes the field that would
   have failed. Note while writing it: **`runId` is not a key of the DAG payload today** (`src/server.ts:546-551`
   builds `{kind, ...layout, startedBy}` + optional `terminalAt`) — the exclusion is a forward guard, not a
   current subtraction, and saying so prevents the next reader from inferring that a `runId` key exists.
3. **Per-surface scoping.** INV-V27-9 names two surfaces and one exclusion list. The list belongs to the
   DAG payload only: the describe parity must stay scoped to **`phases` exactly**, because the top-level
   describe view carries `owner` (`src/workflow-view.ts:199`), which legitimately differs by deployment —
   a whole-payload describe parity fails on the first run and would be "fixed" by adding `owner` to the
   shared exclusion list, which quietly weakens the DAG half too.

**The one predicate, used three times (this is the Karpathy):**

```
isPredictedCell = (c) => c.kind === 'agent' && /^__skel_\d+__$/.test(c.id)
```

- **IT-168's positive anchor** on the AUTH server: `payload.cells.some(isPredictedCell)` is **true** —
  the exact assertion IT-092 inverts today, so the flip is visible in one line rather than spread over a
  rewrite.
- **The parity stabilization gate:** poll both servers until each payload has ≥1 predicted cell **and**
  exactly one non-predicted agent cell in state `running`; then compare with the exclusion list.
- **VAL-204/VAL-199's Chromium oracle:** on an `auth.enabled:true` engine the swimlane paints a node for
  a predicted cell (dashed border, opacity .65, hollow dot per REQ-134) — and with A-1's label it carries
  the expected agent's name, which is what 「一眼看出卡在哪」 means. `mintBearer` trap per ADR-051:
  registration and `run_start` need the bearer; the page and the `/api/*` GETs need none — so the case
  cannot pass vacuously on 「找不到」.

**C-3 — `warningText` must be pure and live in `lib/` (DES-201 + DES-206).** ARCH-125's amendment puts
the split/map/fallback in `ui/run.js`, which has no unit tier (ADR-049 refuses jsdom; DES-206 says so at
`04-design.md:6830`). It is also a *decision*, which DES-206's own boundary forbids that layer from taking.
**Action:**

> `src/dashboard/lib/strings.js` gains `warningText(lang, raw) → string`: split `raw` on the FIRST `": "`;
> if the head is a known TOKEN, return `t(lang, key)` with the `DETAIL`'s `k=v` pairs interpolated
> (`predictedLayoutUnavailable`, `predictedLayoutFromFallback` — the latter takes `resolved`); otherwise
> return `raw` unchanged (that is `layoutGraph`'s existing prose, `src/dashboard.ts:393-442`). Pure, no
> DOM, no `Date`. `ui/run.js` calls it and does nothing else with warnings.
> `STR.zh` / `STR.en` gain the two keys — which keeps DES-201's existing
> `Object.keys(STR.zh).sort() === Object.keys(STR.en).sort()` test honest, and neither key may contain the
> C3 word (「預測結構不可用」 / 「預測結構來自替代版本 v{resolved}」).

UT cases: known token both languages; unknown token → raw passthrough; a raw prose warning → unchanged;
a `DETAIL` with no `=` → raw passthrough (never `undefined` in the UI). **No new module** — this is three
exports in a file the delta already touches.

**C-4 — UT-238's rewrite must be visibly non-relaxing.** The file exists and is RED for the right reason.
The delta deletes one of its three axes, which is exactly the shape of an accidental weakening.
Instruction for Gate 6, to be written into the test row:

> The 7 (status) × 2 (phases) table **survives intact** — 14 cases, same oracle. Only the `masked` axis
> dies (28 → 14). The `as { masked: boolean; status: RunStatus }` cast at
> `tests/unit/dashboard-derive-lanes.test.ts:34` **disappears**, and its disappearance IS the evidence the
> signature was reconciled literally rather than re-cast. The two lane-join cases become one
> (`lanes` extend with the unreached expected lane, unconditionally); the `expected: undefined` case
> (`:64-65`) either deletes or becomes a `@ts-expect-error`-guarded robustness case — it may not silently
> keep passing `undefined` to a non-optional parameter through a cast. Add A-3's density case.

**C-5 — IT-092: re-trace, keep the filename, and pick a sentinel the derivation cannot surface.** The
file name `dag-masking-auth.test.ts` and its whole header now describe the opposite of the truth
(`:1-15`), and its live assertion is that the auth server's `cells` contain **only** `__trigger__` —
which the reversal makes false by design. Three instructions:
- **Do not rename the file.** IT-092 and IT-168 both cite it by path, and the trace chain cites
  `file:line`. Rewrite the header comment; add a 「REVERSED v27b (ADR-051)」 paragraph. A rename costs a
  ledger sweep and buys a tidier name.
- **The surviving REQ-100 guard is 「no script BYTES」, and it must not be asserted as 「no script-derived
  text」** — the predicted cells legitimately carry author-chosen agent labels (A-4), and
  `describe.params.agents` publishes those labels anonymously already. The sentinel must therefore be a
  byte that **cannot legitimately reach any projection**: put a distinctive comment inside the fixture
  script (e.g. `// RWE-IT092-SCRIPT-BYTES-DO-NOT-LEAK`) and assert it is absent from `await res.text()`.
  A label-based sentinel would be a false red the day A-4 lands; a body-literal sentinel is a true guard.
- Its two pre-existing cases are green before and after; this is a re-trace, **not** this delta's red test.

**C-6 — the fixture's stale qualifier.** `DAG_PAYLOAD_OPEN` and the row label
`'GET /api/runs/:id/dag (open)'` (`tests/fixtures/dashboard-wire.ts:84`, `:112`) encode a distinction that
no longer exists. Rename to `DAG_PAYLOAD` / `'GET /api/runs/:id/dag'` in the same commit as C-1 — two
identifiers, one file, and leaving them is precisely the 「faithfully record a degradation that must no
longer exist」 failure ADR-051 warns about for the Gate 7.5 sentence.

### 2d. Ledger rows the architect routed to THIS gate

**DES-114** (`04-design.md:3484-3507`, 「DAG from the pin」, traces ARCH-073/TASK-109) and **DES-115**
(`:3508+`, `projectWorkflowForRead`, traces ARCH-075/TASK-110) are cited in the very comment being deleted
(`src/server.ts:331-334`, `:509-513`). Add one bullet each, in the house style the architecture used for
ARCH-073/075/ADR-012 — **marker, not rewrite; `iter:` stays v22**:

> - **superseded_in_part:** v27b (2026-09-11, owner ruling Round v27b → ADR-051) — the DAG route's
>   non-owner projection of the **predicted overlay** is reversed: `lanes`, the predicted cells and
>   `describe.phases[].agents` are served regardless of `auth.enabled`. Everything else in this row stands
>   — the pin-derived skeleton source, the `ReadContext` threading, `projectWorkflowForRead`'s allowlist,
>   script-text masking and `scriptWithheld`. History is marked, not rewritten.

---

## 3. Where my own three lenses pull apart (named, per the dispatch)

**(a) contract vs (c) testability — `expected: ExpectedGraph | undefined`.** Contract says non-optional:
the only caller always holds a value post-reversal, and an optional parameter is an input state no
production path can produce, i.e. an untested branch that decays. Testability says total: UT-238 already
pays for an `undefined` case and a pure function that throws on a bad input is a dashboard 500 waiting to
happen. **Resolution (A-1):** non-optional **type**, garbage-tolerant **body** (`Array.isArray(expected?.lanes)`,
matching `layoutGraph` at `src/dashboard.ts:346`), and the robustness case survives only behind
`@ts-expect-error`. Both lenses get what they actually wanted; neither gets a type that lies about the
call graph.

**(b) boundary vs (c) testability — the exclusion-form parity.** Boundary wants everything compared,
because the likeliest future leak is a NEW sibling field (`RunStatusView.principal` is one `...view`
spread away) and a pick-list never sees it. Testability observes that `cells[].state` is genuinely
timing-dependent across two independently started runs and will flake, and a flaky guard gets deleted or
`.skip`ped within two iterations — which is strictly worse than a pick-list. **Resolution (C-2):**
stabilize, never narrow. A bounded poll on an explicit predicate is ~8 lines; weakening the comparison is
permanent.

**(a)+Karpathy vs (c) — `warningText` as a new export.** Simplicity-first says a three-line split belongs
where it is used and a new exported function is a new surface. Testability says ADR-049 left `ui/` with
no unit tier at all, so "where it is used" is a place no unit test can reach, and DES-206's own boundary
forbids the view from deciding anything a pure function could decide. **I weighed inline-in-view and
rejected it on testability, not on taste** — and I hold the simplicity line where it still applies: it is
an export in an **existing** file, not a new `lib/warnings.js`.

**(b) vs Karpathy — A-4's label.** Boundary says the absence of a label is an unstated failure mode that
the reversal promotes from invisible to user-facing. Simplicity says the wire is already big. Boundary
wins on evidence: the alternative (a per-run `describe` fetch + an ordinal join in the client) is more
code in the layer with no unit tier, to publish data ADR-055 already publishes.

---

## 4. Task deltas and ORDER (03-tasks.md exists — TASK-196..213)

**No new TASK ids.** The delta lands on five existing rows, and one of them is not in the architecture's
own housekeeping list, which is how it would land unowned:

| task | `dod:` delta |
|---|---|
| TASK-201 (`dashboard.ts`) | `deriveLanes` per A-1/A-2/A-3; predicted cell gains `label` per A-4 |
| TASK-202 (facade) | `maskPredictedOverlay` never built; `agents` unconditional; B-4's absence/empty rule; README describe row loses its masking sentence |
| TASK-203 (server wire) | four deletions incl. the two comments (B-1); version resolution (i)–(iv); the four pushes at their sites (B-2); the closed `reason` vocabulary (B-3) |
| **TASK-206 (`lib/` I: strings)** | **`warningText` + the two `STR` keys (C-3) — NOT named in the v27b housekeeping list** |
| TASK-208/209 (`ui/`) | `ui/run.js` renders `warningText(...)` output as TEXT, replacing the `N warning(s)` count (`src/dashboard-page.ts:601-607`) |

**Ordering is a correctness condition, not a preference.** TASK-203 must land **before** TASK-208/209: if
the view ships first, it maps tokens that never arrive and its acceptance passes vacuously (the legend
renders nothing, which is also what a correct healthy run renders). TASK-206 must land before or with
TASK-208/209 for the same reason in the other direction. TASK-201's `label` must land before VAL-199/204
are judged, or the Chromium oracle photographs blank boxes and the evidence screenshot becomes the
accepted baseline.

**Test rows:** UT-238 (C-4), IT-168 (positive anchor + parity + the live key-set assertion, C-1/C-2),
IT-092 (re-trace, C-5), VAL-199/VAL-204 (the auth-on visible case + ADR-051's p95 number), plus the
fixture rename (C-6). All are edits to existing files; the delta adds **no new test file**.

---

## 5. Risks

1. **A-4 ruled out of closure.** Then REQ-134's 「一眼看出卡在哪」 is not met on any deployment and the
   requirement text must say so in the same pass. Risk is that neither happens and Gate 7.5 finds it by
   screenshot. *Mitigation: the honest fork is written into the DES row, so the synthesizer must pick.*
2. **The parity test is written before the stabilization rule is agreed** → intermittent red in CI →
   quarantined → the reversal's only empirical control is gone, and INV-V27-9 reads as satisfied.
   *Mitigation: C-2's predicate is concrete and testable today.*
3. **B-2's arm (iii) is implemented downstream of the catch.** Everything stays green and the engine never
   warns that it could not resolve a version. This is the single most likely silent failure in the delta,
   because nothing throws where the design implies a throw.
4. **REQ-105's acceptance marker (`01-requirements.md:1070`) is the orchestrator's**, not this gate's, and
   Gate 8 verifies REQs against code — left undone it fails by construction. Named here so the design pass
   does not assume someone else noticed.
5. **The p95 memo gets built preemptively.** ADR-051 pre-approves a BOUNDED memo **above 50 ms**. Building
   it before the measurement adds a cache, a key, an eviction rule and a staleness question to a delta whose
   whole Karpathy claim is "one fewer branch than today". *I refuse it at this gate.*
6. **UT-238's shrink reads as weakening at Gate 8.** *Mitigation: C-4 states the invariant (14 cases, same
   oracle, the cast disappears) so the reviewer can diff intent, not just count.*

---

## 6. Expected disagreements with the quality-dimensions lens

- **Structured warnings on the wire.** QD will likely re-propose `warnings: [{token, params}]` objects over
  `TOKEN: detail` strings, on consumability grounds for the cold-model reader. **I hold the string** — the
  architecture's r2 already settled it on a constraint QD itself raised (one string table, two languages),
  the `warnings: string[]` shape is pinned by `dag-warnings-empty.test.ts` and the grandfather test, and
  C-3's `warningText` makes the parse a tested pure function. Changing the array's element type is a wire
  break for a client that does not exist yet.
- **A nested key-set row for `describe.phases[]` now.** QD will want ADR-054's deferral overturned. **I hold
  the deferral and raise instead** — the fixture-only key-set test (C-1) is a bigger hole than the missing
  nested row, and fixing it costs less. If only one lands, land C-1.
- **A de-dup `Set` / rate limit on the journal line.** QD will want it for observability hygiene at k
  viewers × 3 s. ADR-051 pre-approves it *if Gate 7.5 sees the flood*. **Refuse at this gate**, measure at
  7.5 — same argument as the memo.
- **Keeping `masked` as a config knob "for replaceability".** If QD proposes any surviving switch, I refuse:
  ADR-051 ruled four deletions, a knob is not per-principal (so it does not buy D1's tier either), and it
  re-imports the `composeConfig` forwarding obligation this ledger has been bitten by twice.
- **A new `lib/warnings.js`.** If QD wants the parser as its own module for separation, I hold it as three
  exports in `lib/strings.js` — a new client file also means a new `STATIC_ASSETS` key, a new corpus entry
  and a new guard target.
- **Likely convergence, not conflict:** A-4 (the predicted label) — QD will reach it from consumability
  ("an anonymous node tells the operator nothing") while I reach it from boundary completeness. If we agree
  from two directions, the synthesizer should treat it as settled rather than as a single lens's ask.
- **Possible conflict I will concede if measured:** if QD shows that adding `label` to predicted cells
  materially changes the p95 ADR-051 asks for (it does not — it is a property read in an existing loop), I
  drop it to a describe-side join.

---

## 7. Karpathy check

Net change against the delta as architected: **+1 optional property** on a cell that already exists,
**+1 pure function and 2 string keys** in a file already being touched, **+1 live assertion** in a test
that already boots the servers it needs, **4 deletions** of branch/parameter/argument/comment, **2
renames** in a fixture, **2 marker bullets** in the ledger. No new module, no new file, no new route, no
new config key, no cache, no new fixture, no rename of any file the trace chain cites, and one *fewer*
axis on the only new pure function. Every proposal above is either a deletion, a line in a file the delta
already edits, or a sentence that prevents an implementer from guessing.
