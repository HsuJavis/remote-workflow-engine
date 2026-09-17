# Design panel — Adversarial design group, round 1 (independent proposal)

**Gate:** 3+4 (tasks + design), iteration **v28 / Sprint B**. Closure = REQ-137, REQ-138, REQ-139,
REQ-142, REQ-143 over ARCH-132..135 + ADR-057..060 + INV-V28-1..4, with ARCH-123/124/125/130 amended
in place.

**Lenses carried (all three, argued against each other):** (a) interface-contract — signatures,
input/output types, compatibility; (b) boundary/error — failure modes, error codes, completeness of
boundary conditions; (c) testability — every DES coverable by a UT, clock/storage injectable.
**Tie-breaker:** Karpathy simplicity-first — the minimum design that solves the problem, no needless
flexibility.

**Inputs read:** `01-requirements.md` REQ-137..REQ-143, `02-architecture.md:3857-4022` (the whole v28
slice: ARCH-132..135, ADR-057..060, the 4+1 delta, the contracts table, INV-V28-1..4),
`state.yaml:12-53` (`tech_stack`), plus the live tree — `src/dashboard/ui/{app,poll,models,system,issues}.js`,
`src/dashboard/lib/{connection,model,runlist,strings}.js`, `src/system-info.ts`,
`src/models/model-catalog.ts`, `src/static-assets.ts`, `src/server.ts:459-485,1360-1372`,
`tests/fixtures/dashboard-wire.ts`, `04-design.md`'s DES-206/DES-207.
`03-tasks.md` for v28 does not exist yet (the file on disk is v27's, closed) — where task-splitting
changes a verdict it is said so, and §6 is the dependency graph this proposal asks Gate 3 to adopt.

---

## Altitude call (done first, as the dispatch requires)

`tech_stack` describes **both** a plain system and an AI-agent system: a Node/TypeScript HTTP+MCP
server with SQLite, *and* an agent-execution substrate (two `GatewayClient`s, a sandbox, agent-type
definitions). **But this slice is not at that boundary.** Sprint B is browser-side view code plus one
server literal (`topN: 5 → 20`): zero new services, routes, wire fields, config keys or schema.

**Ruling: system altitude for all three of my lenses, throughout.** The two agent-altitude faces
ARCH's own 「Altitude split」 names are real and I keep them, but they raise the *correctness bar on a
rendering rule* — they do not change a signature, an error code or an oracle:

- **replaceability (agent altitude) on Models** — `provider`/`location`/`toolUseDeclared`/
  `effortDeclared`/`declaredSource` are what an operator reads to decide which model backs an alias,
  so 「`—`, never `0`」 is a correctness property. That is exactly why finding **K4** (sort order over
  absent values) is blocking rather than cosmetic.
- **self-sustainability (agent altitude) on Issues** — `/api/issues` lists `agent-reported` issues
  (`server.ts:461`), the loop by which agents file defects about themselves. That is why REQ-139
  restates REQ-067's 「degraded, not blank」 and why **K3** (the `(R)` contradiction) matters: a tick
  whose observations are dropped is a silently severed loop.

I do **not** manufacture an observability/consumability agent-altitude reading for the poller or the
demo dataset — nothing in this slice touches an agent's reasoning trace (that was Sprint A's
REQ-135/136), and forcing the altitude there would be checklist-completion.

---

## Summary

The v28 architecture is unusually tight — the refusals (no flag, no fourth route, no `?topN=`, no
`supportedParameters`, no `lib/views.js`, no second comparator) are the right shape and I attack none
of them. **Every finding below is an under-specification INSIDE ADR-057/058/059/060, not a case
against them.** The design gate's job here is to design *into* those ADRs.

Three of them are **blocking**. One (**K0**) is not an under-specification but a **joint
unsatisfiability between two rows** — REQ-143's mechanism as architected can never fire. The other two
are contract holes: if `04-design.md` transcribes ARCH's literal text, three tab modules get rewritten
against a seam contract that contradicts itself.

0. **The lazy `import()` fetches the dataset from the process ADR-058 says is dead.** ARCH-132: the
   dataset is 「loaded by `await import('../demo/dataset.js')` from `app.js` on the FIRST demo tick
   and never statically」. ADR-058: 「the page is served by the same process as `/api/*` … the ONLY
   real trigger is mid-session engine loss」. ARCH-123's v28 amendment: the key is served
   **`no-store`**. Verified: `/static/dashboard/*` (`server.ts:1288`) and the `/api/*` dispatch
   (`server.ts:1362-1372`) are arms of the **same request handler of the same `createServer`**. So
   the sequence is: engine dies → 2 ticks → `offline` + all-unreached → `demoTick` → `import()`
   issues a GET to the dead process → **rejects**. `no-store` rules out the HTTP cache; 「never
   statically」 rules out the module map. **The dataset is unreachable at exactly the moment it is
   needed, every time.** Two rows are each individually reasonable and jointly unsatisfiable.

1. **`tick.results` has two incompatible meanings on a demo tick.** ARCH-133(1) tells views to select
   the Unavailable component on `tick.results[url] !== 'ok'`; ADR-058 says the reducer runs on the
   REAL results, which on a demo tick are `fail` for **every** primary URL by construction (that IS
   the demo predicate). Read literally, every tab paints 「無法取樣」 on top of a perfectly good demo
   body — REQ-143 inert, the owner's 「我要看有缺什麼」 defeated, and INV-V28-2 satisfied vacuously.
2. **`nextConnection` is not idempotent, and ADR-058 forces a second call site.** It returns
   `prev.consecutiveFails + 1` (`connection.js:35`). ADR-058's `preview.status === 'offline'` must be
   evaluated *before* `onTick`; today the one call is *after* (`app.js:381`). Any implementation that
   commits the preview and then reduces again double-increments the streak — `offline` (and therefore
   demo) after **one** all-fail tick, breaking REQ-131's ≥2-tick rule and ADR-058's own 「≥2-tick
   entry」 mitigation. A browser request-count oracle cannot see this; it is precisely the class
   ADR-059 built `lib/` for.

K1 and K2 need no new mechanism — **one paragraph of sequence, written once, in the DES row that owns
the seam.** K0 cannot be fixed by a DES row at all: it is an **ARCH-132 `api:` amendment** and must be
routed as one. The remaining findings are `must-specify` (an implementer would otherwise
invent an answer) or `note`.

The through-line: **v28 is a seam change wearing three tabs as a costume.** Almost all its risk is in
`app.js`'s `tick()` and `poll.js` — ~40 lines that no unit tier covers and that five other modules
now depend on. Design accordingly: pin the seam's sequence and types first, then the tabs.

---

## Key points

Each: **measured fact → which sub-lens → minimum fix → severity**. Severity is
`blocking` (DES must settle it or Gate 6 ships wrong code) / `must-specify` (an implementer will
otherwise guess) / `note`.

---

### K0 — the demo dataset is fetched from the dead engine; 「lazy, never statically」 is unsatisfiable under ADR-058's own trigger — **blocking, and it is an ARCH amendment, not a DES choice**

**Measured, three rows side by side plus one grep.**

| row | clause |
|---|---|
| ARCH-132 `api:` | 「loaded by `await import('../demo/dataset.js')` from `app.js` on the FIRST demo tick and **never statically**, so a Live deployment never fetches the bytes and that single request is REQ-143's positive browser observable」 |
| ADR-058 consequences | 「the page is served by the **same process** as `/api/*`, so a cold load with the API down is not a page at all — the **ONLY** real trigger is mid-session engine loss (a self-update restart, a tunnel drop)」 |
| ARCH-123 v28 amendment | the `demo/dataset.js` key takes the `.js` arm deliberately: **`no-store`** |

Grepped to confirm the first two are the same process and not two servers:
`server.ts:1288` `if (req.url?.startsWith('/static/dashboard/'))` and `server.ts:1362-1372`'s
`dispatchDashboard()` prefix test are **arms of one request handler in one `createServer`**
(`static-assets.ts`'s `lookupStaticAsset` is called from that same arm). There is no second listener,
no CDN, no service worker anywhere in the tree.

**The failing sequence, end to end:** engine dies (self-update restart / tunnel drop) → tick 1 all
`fail` → tick 2 all `fail` → `preview.status === 'offline'` and every primary unreached →
`demoTick` → `await import('../demo/dataset.js')` → the browser issues
`GET /static/dashboard/demo/dataset.js` **to the dead process** → rejects. `no-store` guarantees the
HTTP cache cannot answer; 「never statically」 guarantees the module map cannot. **The dataset is
unreachable at precisely the moment, and only at the moment, it is needed.** REQ-143's entire
mechanism never fires — and it fails *silently*, into the Offline tag, which is the state
ADR-058 designed as the correct-looking neighbour of demo mode. Nothing in the browser oracle
distinguishes 「demo engaged and the fiction is honest」 from 「demo could not load」.

There is a second, independent instance of the same circularity that survives even if the server were
somehow up: ADR-058's predicate has `AND the dataset loaded` as a conjunct, and loading is triggered
only on a tick where the predicate is already true. Written literally, first engagement never happens
regardless of the network. My own K2 step 3/step 4 and K6's `datasetLoaded` argument inherited that
circularity from the row — this finding corrects both.

**Sub-lens.** Boundary/error (a mechanism whose only trigger is the one condition that disables it) ×
interface-contract (two rows, each sound alone, jointly unsatisfiable) × testability (the failure is
invisible to every oracle ADR-058 names, because the failure state *is* the neighbouring correct
state).

**Minimum fix, chosen to disturb the fewest other rows.** **Import the dataset statically at
`app.js`'s top.** What survives untouched: one import site; `no-store`; the exact-match
`DEMO.get` map; ARCH-132's self-labelling-in-the-data; ADR-058's trigger, its whole-body
all-or-nothing substitution, its recovery rule and its refusal of a config flag; the
`demo-surface.test.ts` tripwire (a static import fails **louder**, not quieter, the moment the
directory is deleted — the retirement commit still turns it red until every describer retires).
`DEMO_AVAILABLE` becomes a boolean the boot sets once (the import resolved), exactly as ADR-058 says
it must be — 「a lazy `import()` resolving, never a setting」 becomes 「an import resolving」, which
is the same sentence minus the word that breaks it.

**What is withdrawn, and must be withdrawn explicitly rather than quietly:**
- ARCH-132's 「a Live deployment never fetches the bytes」 — **unachievable**; a live deployment now
  fetches `dataset.js` on every page load.
- REQ-143's positive browser observable changes from 「exactly one request, only after demo engages」
  to 「one request for `dataset.js` on page load」 — still a positive, still browser-visible, still
  falsifiable, but a **different** assertion, and Gate 5 must be told before it writes the test.
- The page-weight cost is real and should be stated with a number at Gate 6 rather than hand-waved
  (the dataset is ~7 typed bodies; if it lands large, that is an argument for trimming the fixture,
  not for reinstating the lazy import).

**Routing, stated plainly because it determines whether this bounces:** a design gate may not rewrite
an ARCH `api:` clause. This is an **ARCH-132 amendment** (and a one-line consequence note on
ARCH-123's cache arm, which is unchanged, and on ADR-058's 「consequences」 paragraph). The
synthesizer should either route it to the architect lane or amend ARCH-132 in place **with this
measurement attached**, and only then write the DES row against the amended clause.

**The alternative branch, stated so the owner's options are complete.** If a static import is judged
unacceptable (page weight on a Live deployment, or 「the bytes must never ship to production」 read as
a hard constraint), then under D3 (no polling tuning) and ADR-058's refusal of a config flag there is
**no remaining mechanism**: pre-caching needs a service worker (a new runtime mechanism, far past this
slice's 「zero new」 claim), eager-fetch-on-boot is the static import wearing a different hat, and a
flag is refused by name. In that branch **REQ-143 is unimplementable this iteration and returns to the
owner** — which is a legitimate outcome (D5 was settled the same way, in one round) and vastly cheaper
than discovering it at Gate 7.5. **My recommendation is the static import**; I record the second
branch so that choosing it is a decision rather than a surprise.

---

### K1 — `tick.results` is undefined on a demo tick; name the two maps separately — **blocking**

**Measured.** `app.js:363-380` builds one `results` map and one `bodies` map and passes only
`bodies` to `onTick`. ARCH-133(1): 「Views consume the degrade verdict from `tick.results[url]` …
`res.status !== 'ok'` selects the ONE Unavailable component」. ADR-058: 「The reducer still runs on
the REAL results」, and `demoTick` requires **every primary URL unreached**, so `classifyResponse`
never ran and `getJSON`'s outer catch returned `{status:'fail'}` for all of them (`poll.js:52-54`).
Same field name, two meanings, opposite outcomes.

**Sub-lens.** Interface-contract (a field with two meanings is not a contract) × boundary (the
failure is a *false* Unavailable, the mirror of the fabricated-body failure INV-V28-2 exists to
prevent).

**Minimum fix — the reading that matches ARCH's own other sentence, so this is a clarification, not
an override.** ARCH-133(5) already defines `getViewJSON`'s demo arm as `{status:'ok', body:…,
source:'demo'}`. Make the view-facing map agree with it:

```
// ONE type, TWO instances, both named in DES:
type RouteVerdict = 'ok' | 'degraded' | 'fail';
transportResults : Record<url, RouteVerdict>   // what actually happened on the wire.
                                               // PRIVATE to app.js. The ONLY input to nextConnection.
tick.results     : Record<url, RouteVerdict>   // what the VIEW should render.
                                               // === transportResults on a live tick;
                                               // 'ok' for every substituted url on a demo tick.
tick.source      : 'live' | 'demo'             // the whole-page state, per-tick, never per-url.
```

A view therefore needs **no demo branch at all** — it reads `tick.results[url]` and
`bodies[url]` and is source-agnostic, which is what keeps the demo dataset deletable in one commit
(ARCH-132's own exit criterion). `tick.source` exists for the banner/stamp, not for a render
decision.

**Why not the alternative** (views read `tick.source === 'demo'` and skip the verdict check): that
puts a demo branch in all three rewritten views plus every future one, and the tripwire
`demo-surface.test.ts` would then have to allowlist three more files — the opposite of ARCH-132's
mechanical retirement. Simplicity tie-break says one map, adjusted once, at the one substitution
point that already exists.

---

### K2 — the tick sequence, written once, because `nextConnection` increments — **blocking**

**Measured.** `connection.js:32-36`: `const consecutiveFails = prev.consecutiveFails + 1; … status =
consecutiveFails >= 2 ? 'offline' : 'degraded'`. Not idempotent. `app.js:381-384` commits it exactly
once, *after* `onTick`. ADR-058 needs the verdict *before* `onTick` (to decide substitution) and
ARCH-133(1) needs the extras excluded on a demo tick (to stop the oscillation it describes).

**Sub-lens.** Boundary/error (a two-tick guarantee silently becoming one-tick) × testability (a
counter defect is invisible to a request-count oracle taken 30 s later — the same argument ADR-059
used to justify `scheduler.js`, applied to the sibling it did not extract).

**Minimum fix — DES states this exact order, as prose an implementer can follow line by line:**

1. `urls = endpointsFor(view.name, view.ctx)`; fetch all → `transportResults`, `realBodies`,
   and per-url `reached`.
2. `preview = nextConnection(connectionState, { results: transportResults })` — **computed, NOT
   assigned to `connectionState`.**
3. `demoTick = preview.status === 'offline' && urls.every(u => !reached[u]) && DEMO_AVAILABLE`,
   where **`DEMO_AVAILABLE` is a boolean the boot set once** — per **K0**, the import resolved at
   load, not something this tick waits for. (Written as 「the dataset loaded *on this tick*」 the
   predicate is circular and never first-engages; K0 is where that is fixed.)
4. On `demoTick`: install the map into `poll.js` via the one setter, `source='demo'`, and
   **per URL**: `bodies[u] = DEMO.get(u)` and
   **`viewResults[u] = DEMO.has(u) ? 'ok' : 'fail'`** — *not* blanket-`ok`. This matters mid-session
   on `/dashboard/<a real run id>`: the map holds `demo0001…` and not that id, so the route must read
   `fail` under a Demo tag (→ the ONE Unavailable component) rather than `ok` with
   `bodies[u] === undefined`, which would hand a view an undefined body under an `ok` verdict —
   INV-V28-2's fabricated-body failure arriving through the back door. Same rule ARCH-133(5) already
   states for `getViewJSON`'s map miss; step 4 simply must not contradict it.
   Else `bodies = realBodies`, `viewResults = transportResults`, `source='live'`.
5. `extra = await view.onTick(container, bodies, ctx, { results: viewResults, source })`.
6. `merged = demoTick ? transportResults : { ...transportResults, ...extra }`.
7. **`connectionState = nextConnection(connectionState, { results: merged })` — the ONE commit, from
   the SAME `connectionState` step 2 read.** Then tag, then footer clock.

**The rule that must appear in words, not only in the listing:** *`nextConnection` is called at most
twice per tick and **always against the same `prev`**; only step 7's result is assigned.* Name the
failure so a reviewer can grep for it: committing step 2 makes `offline` (and demo) arrive after one
all-fail tick instead of two.

**Free consequence worth taking:** step 7's `merged` on a live tick is a superset of today's
`results`, and step 2 is pure computation — so the existing `Object.keys(results).length > 0` guard
(`app.js:381`) and every current `nextConnection` unit case stay green unchanged. This is additive.

---

### K3 — ARCH-133 contradicts DES-206's standing rule **(R)**; amend (R) with a named exception — **blocking-adjacent, cheap**

**Measured.** DES-206's v27m amendment, rule **(R)**: 「Every status observed reaches the reducer …
or the tick under-reports」. ARCH-133(1): 「on a demo tick the extras do not reach the reducer at
all」. Both are correct for their own reason; as written they are a silent contradiction, and
`04-design.md`'s own standing policy is that a clause the tree violates with no task is worse than
nothing.

**Sub-lens.** Interface-contract (two live rules, one behaviour) × boundary.

**Minimum fix.** One sentence appended to (R) rather than a new rule:

> **(R) exception — demo ticks only.** On a tick where `source === 'demo'`, the extras' statuses are
> discarded at the seam (`app.js`, step 6 above) and never merged, because a `getViewJSON` map answer
> is `ok` by construction and would report a health it did not observe. The primaries' REAL statuses
> are what the reducer receives, and they are all `fail` by the demo predicate — so the tick is fully
> reported, not under-reported. The discard happens at the seam; view modules keep returning their
> statuses unchanged, so (R) binds every view exactly as before.

That last clause matters for compatibility: `run.js`/`workflow.js`/`agent-panel.js` are **not**
rewritten this sprint, so the exception must live where the one change is.

---

### K4 — `sortRows` cannot deliver REQ-137's 「`—` sorts last」; `null` sorts **first** ascending — **blocking**

**Measured, by running it.** ARCH-134(4): 「`sortRows` is REUSED from `runlist.js:42`, which already
sorts absent values LAST in both directions — exactly what REQ-137's `—` columns need, so no second
comparator is written.」 `runlist.js:41-53` tests `=== undefined` only. Run against the shapes
`/api/models` actually serves:

```
$ node -e "import('./src/dashboard/lib/runlist.js').then(({sortRows})=>{
    const rows=[{k:5},{k:null},{k:1},{k:undefined},{k:'unknown'}];
    console.log('asc ',JSON.stringify(sortRows(rows,'k','asc')));
    console.log('desc',JSON.stringify(sortRows(rows,'k','desc')));})"
asc  [{"k":null},{"k":1},{"k":5},{"k":"unknown"},{}]
desc [{"k":5},{"k":1},{"k":null},{"k":"unknown"},{}]
```

`null` sorts **first** ascending (before `1`) and mid-pack descending. And `EnrichedModelEntry` uses
`null`, not `undefined`, for exactly the honest-absence fields: `costLevel: number | null`
(`model-catalog.ts:348`), `contextWindow: number | null` (`:22`), `catalogFetchedAt: string | null`
(`:359`), `ratesPerM?: FourRates | null` (`:39`). Worse, four of REQ-137's twelve columns have **no
scalar `a[key]` at all**: 價格 is `price: {in,out} | 'free' | 'unknown'` (`:23`) — a union of object
and string literals, so `av < bv` is `NaN`-grade nonsense; 模態 is `{in:string[],out:string[]}`;
延遲 and 基準 are nested-and-absent (D2). Sorting the *display* strings is equally wrong — `'1.2M'`
< `'900k'` lexically.

**Sub-lens.** Boundary (absence rendered as a position, i.e. the exact failure INV-V28-4 names) ×
interface-contract (a reuse claim that does not type-check against the data) × testability (the UT
that would have caught it is a 12-column table nobody is currently obliged to write).

**Minimum fix.** Keep `runlist.js` untouched (it is v27-closed and REQ-133 depends on it), add **one**
pure projection to `lib/model.js`:

```
sortKeyOf(entry, column) -> number | string | undefined
```

with three stated invariants: (i) **`undefined` is the ONLY absent token** — `null`, `'unknown'`,
`'free'`-as-absence and a missing nested path all normalise to `undefined` (`'free'` on the PRICE
column is the number `0`, a fact, not an absence — same ruling as `ZERO_RATES`,
`model-catalog.ts:96-99`); (ii) the key is a **comparable scalar**, so price sorts on
`ratesPerM.out` (numeric) while the cell *renders* `price` (string), and 模態 sorts on a stable
rendered token; (iii) `sortKeyOf` is total — an unknown column name returns `undefined` rather than
throwing, so a typo degrades to 「unsorted, absent-last」 instead of a blank tab.

Then `sortRows(rows.map(r => ({ ...r, _k: sortKeyOf(r, col) })), '_k', dir)` — or, marginally
cleaner, have `modelRow` carry the sort key beside the cells. Either way: **no second comparator**,
ARCH-134's refusal survives intact.

**UT (this is what makes it a design deliverable, not a code review note):** a 12-column × 2-direction
table over a fixture of ~5 entries including one all-absent row; the assertion is 「the absent row is
last in BOTH directions, for every column」. 24 assertions, one literal fixture, pure, `.js` tier —
the cheapest test in the sprint and the one that pins INV-V28-4 mechanically instead of by prose.

---

### K5 — `sectionState(section)` has no uniform input; the fourth stat card has no section at all — **must-specify**

**Measured.** ARCH-134(3) proposes `sectionState(section) → {kind:'ok'|'unavailable', reason?}` 「over
`SystemInfoView`'s own closed `Reason` set」. `SystemInfoView` (`system-info.ts:77-100`) is **not**
uniform:

| section | shape | where the degrade lives |
|---|---|---|
| `cpu` | `{cores, loadAvg, utilizationPct: number\|null, utilizationDegraded?: Degraded}` | a **sibling key**, and the section is otherwise fine (cores/loadAvg are always real) |
| `memory` | `{…} \| Degraded` | discriminated union |
| `disk` | `{…} \| Degraded` | discriminated union |
| `process.system` | `{total, byState} \| Degraded` | discriminated union |
| *counts card* | — | **not in `SystemInfoView` at all** (ADR-057: a client fold of `/api/workflows` + `/api/runs`) |

So one signature cannot serve all four of REQ-138's cards. `ui/system.js:60` today already
special-cases this by hand (`data.cpu.utilizationPct != null ? … : UNAVAILABLE`) while
`:63`/`:68` use `'reason' in data.memory`.

**Sub-lens.** Interface-contract × boundary (three of the five `Reason` values — `awaiting-second-sample`,
`unsupported-platform`, `sample-window-too-short`, `system-info.ts:25-30` — are **not faults**, and
ARCH-134 is right that they must be distinguishable; a signature that can't carry the reason loses
that).

**Minimum fix — two functions, not one, and the fourth card named as a different thing:**

```
sectionState(value: T | Degraded) -> {kind:'ok', value:T} | {kind:'unavailable', reason:Reason}
   // memory, disk, process.system — a plain union narrow. Total.
cpuUtilState(cpu) -> same shape
   // the ONE sibling-key case: reads utilizationPct + utilizationDegraded. Total.
```

and, for the counts card, an explicit sentence in DES: **its state is not `sectionState`'s.** It is
`tick.results['/api/workflows']` and `tick.results['/api/runs']` — a *route* verdict, not a
*section* reason. Per ADR-057 the counts card renders Unavailable when either is not `ok`, **while
the other three cards keep rendering live host numbers.** Without that sentence an implementer will
either fold `/api/system`'s verdict over all four cards (three cards wrongly blanked) or invent a
`Reason` the server never produces.

**Second must-specify, same card — the bar.** REQ-138 gives all four cards 「2px 軌 + 4px accent
長條」; three are percentages, the counts card is 「9 個版本 · 13 次執行記錄」 with **no
denominator**. INV-V28-4 says 「The bar has an absent state of its own, not only the number」, so DES
must say: `statCard` returns `pct: number | undefined`, the counts card returns `undefined`, and the
bar's absent state is the track alone. State it, or someone renders `pct: 100` and ships a full bar
that means nothing.

**Third, small:** `procTotals` reads `process.system.byState`, whose keys are **raw Linux state
letters** (`system-info.ts:323-326` counts `p.state` verbatim) — an open key set from `/proc`, not a
closed one. REQ-138's header 「總處理程序 312 · S 298 · R 7 …」 ends in 「…」, so: render the top-N
states by count with a stable tiebreak, never a hard-coded S/R pair, and never throw on a letter
nobody has seen. One sentence; one UT with an unexpected letter in the fixture.

---

### K6 — the demo predicate is a decision living where nothing can test it — **must-specify**

**Measured.** ARCH-125's constitution (carried into ARCH-133's `note:`): `ui/` 「may not decide
anything a pure function could decide」. ADR-059 extracted `nextPoll` to `lib/` for exactly this
reason, citing QD-R2 (「decidable logic in `ui/` has no unit tier at all」). ADR-058's predicate —
`preview.status === 'offline' && every primary unreached && DEMO_AVAILABLE` — is a three-term boolean
decision and ARCH-133(5) places it 「in `tick()`」, i.e. in `ui/app.js`, with no unit tier.

**Sub-lens.** Testability, straightforwardly. Also consistency: REQ-142's decision gets a pure module
and REQ-143's equally-decidable one does not, with no stated reason for the asymmetry.

**Minimum fix — and here my simplicity tie-breaker actively constrains the answer.** Do **not** mint
`lib/demo.js`: a file whose entire content is one predicate is a second describer of the dataset,
and ARCH-132's retirement checklist would grow a line. Put it in `lib/connection.js`, beside the two
functions it reasons about:

```
export function demoEngages(verdict, reachedFlags, datasetLoaded) {
  return verdict === 'offline' && reachedFlags.length > 0
      && reachedFlags.every(r => r === false) && datasetLoaded === true;
}
```

Total, pure, three arguments, no import. **`datasetLoaded` is the boot-time boolean of K0** — 「the
static import resolved」, evaluated once, never a per-tick await; with the lazy form it is a conjunct
that can only become true after it is already true. **UT table of 8 rows** (the 2³ corners) plus the one that
actually bites: `reachedFlags === []` (a view with an empty `ROUTES` entry) must be `false`, not
vacuously `true` — the same `values.length > 0` guard `nextConnection:30` already needed and the
exact shape of the AD-2 empty-tick hazard ADR-058 cites. `app.js` keeps the `import()`, the setter
and the stamps; it decides nothing.

Retirement cost: one export and one UT block, both already on `demo-surface.test.ts`'s allowlist
(`lib/connection.js` would need to be listed — note it, since that file must otherwise be
`demo`-free).

---

### K7 — `getJSON` / `getViewJSON` must be ONE result type — **must-specify**

**Measured.** Today `getJSON` returns `{status, body}` (`poll.js:40-55`). ARCH-133(5) gives it a new
`reached` boolean, and introduces `getViewJSON` returning `{status:'ok', body, source:'demo'}` or
`{status:'fail', body:null}`. That is three shapes across two functions, consumed by six modules
(`run.js:477,486`, `workflow.js:333`, `agent-panel.js:233`, `issues.js:78` after the swap, plus
`app.js`/`poll.js`), five of which are **not** rewritten this sprint and will keep destructuring
whatever they destructure today.

**Sub-lens.** Interface-contract × compatibility.

**Minimum fix.** One declared result type, every field always present:

```
{ status: 'ok'|'degraded'|'fail', body: unknown|null, reached: boolean, source: 'live'|'demo' }
```

- `getJSON`: `reached=false` **only** in the outer `catch` (`poll.js:52-54`) — any HTTP status is
  reached; `source:'live'` always.
- `getViewJSON` in demo, map hit: `{status:'ok', body, reached:true, source:'demo'}`. **`reached:true`
  is deliberate** — a map answer *was* answered; `reached` means 「a response was obtained」, not 「a
  socket was opened」. (See conflict **C3**: boundary wanted `reached` undefined here; interface won
  on 「every field always present」, and the field is never read on a `getViewJSON` result anyway
  because K3 keeps extras out of the reducer on demo ticks.)
- `getViewJSON` in demo, map miss: `{status:'fail', body:null, reached:true, source:'demo'}` →
  Unavailable, never a fabricated body (INV-V28-2 holds).
- `getViewJSON` outside demo: **is** `getJSON`, identically.

**And say the `okBody` distinction out loud in the DES row, not only in ARCH's `note:`.** DES-206's
rule **(N)** forbids 「a helper of the `okBody(res, fallback)` kind」 **by name** and withdraws
IMPL-281's recommendation for one. `getViewJSON` is a different animal — it never inspects a body and
takes no verdict from a response — but a Gate 8 reviewer greps for 「a helper between the fetch and
the consumer」 and finds one. ARCH-133 already anticipated this; DES must carry the sentence, or the
sprint spends a review round re-deriving it.

---

### K8 — the ARCH-132 type-lock names three types that are not in the fixture, and one that has no name — **must-specify**

**Measured.** ARCH-132's `note:` promises a `.ts` UT that `satisfies`-checks each demo body against
「the types in `tests/fixtures/dashboard-wire.ts` (`HomeView`, `RunSummary[]`, the DAG payload, the
agent-log view, `EnrichedModelEntry[]`, `SystemInfoView & {auth}`, the issues shapes)」. Grepped: the
fixture exports `AGENT_LOG_OK`, `RUN_SUMMARY_*`, `DAG_PAYLOAD`, `HOME_VIEW_EXAMPLE`, `DEGRADED_BODY`
and the `DISCLOSURE_TABLE` — **four** of the seven. Absent: `EnrichedModelEntry[]`,
`SystemInfoView & {auth}`, and the issues bodies.

And the issues bodies have **no named type anywhere**: `server.ts:466-468` builds `{open, resolved}`
inline from `IssueSummary[]`, and `:463` serves a third anonymous shape
`{open:[], resolved:[], degraded:'GitHub not configured'}`. (`IssueSummary`/`IssueView` do exist —
`github/issue-reporter.ts:76,87` — so this is implementable, it is just unnamed at the wire.)

**Sub-lens.** Testability (the oracle as written is unwritable) × interface-contract.

**Minimum fix.** DES names the three fixture rows to add and the one type to mint:

- `MODELS_OK: EnrichedModelEntry[]` + `ALLOWED/REQUIRED_MODEL_ENTRY_KEYS`
- `SYSTEM_OK: SystemInfoView & {auth: …}` + a **degraded-section** row (the contracts table already
  owes 「one for the ok body AND one for a per-section degraded body」)
- `ISSUES_OK: IssuesListView` and `ISSUES_DEGRADED`, where
  `export interface IssuesListView { open: IssueSummary[]; resolved: IssueSummary[]; degraded?: string }`
  is minted **in `src/github/issue-reporter.ts` beside the types it composes** and `server.ts:466`
  annotates against it. Zero wire change — it names a shape that already ships. Without the name,
  ADR-054's owed disclosure row for `/api/issues` is also unwritable.

**Bonus the architecture already flagged and DES should bank:** the same three fixture rows serve
**three** consumers (ARCH-132's type oracle, ADR-054's key-set disclosure locks, the new `.js` UTs'
input literals). One authoring cost, three obligations — worth stating so Gate 3 makes it one task.

---

### K9 — demo ids must be `encodeURIComponent`-identity, or the exact-match map silently misses — **must-specify, one line**

**Measured.** `poll.js:19,22` builds parametric URLs with `encodeURIComponent(ctx.runId)` /
`(ctx.name)`. ARCH-132 keys the map on 「the EXACT URLs `endpointsFor` produces … for the dataset's
own ids only」 with 「no URL parsing and no path building」. A demo id containing any character
`encodeURIComponent` escapes produces a key that never matches — and the failure mode is *silent*:
`Map.get` returns `undefined` → `getViewJSON` → `{status:'fail'}` → Unavailable. A tab that looks
「correctly degraded」 while the real cause is a typo in a fixture.

**Minimum fix.** One invariant sentence + one UT: **every demo id matches `/^[A-Za-z0-9._~-]+$/`, so
`encodeURIComponent(id) === id`**; the UT walks every parametric key in `DEMO` and asserts the
round-trip. Two lines of test, and it also pins ARCH-132's own 「self-labelling lives in the DATA」
naming (`demo-…`, `demo0001…`, `demo-agent-…`) as machine-checked rather than prose.

---

### K10 — REQ-142's browser oracle may not exist; decide the fallback ladder BEFORE Gate 5 writes tests — **must-specify**

**Measured.** ADR-059 already states the trap honestly (`setWebLifecycleState` passes vacuously,
`Object.defineProperty(document,'visibilityState',…)` fakes the platform) and says 「whether headless
Chromium fires `visibilitychange` on the backgrounded page is the FIRST thing Gate 5 must measure,
before any test is written on top of it」. That is right, and it is **not yet a decision** — it is a
deferral with no stated branch. REQ-142's acceptance explicitly forbids the escape hatch
(「以 Playwright 攔截請求計數為證,而非檢查原始碼是否含 `visibilitychange`」), and
`02-architecture.md:4041(ii)` already asks that clause be reworded to 「真實 Chromium(既有
puppeteer harness)」.

**Sub-lens.** Testability.

**Minimum fix.** DES writes the ladder now, so Gate 5's measurement has a pre-agreed consequence
instead of a negotiation:

1. **Primary:** two real pages, `browser.newPage()` + `bringToFront()`; count `/api/*` on the
   backgrounded page over 30 s → `0`; first `/api/*` within ~300 ms of re-show.
2. **If (1) does not fire `visibilitychange`:** drive visibility through CDP on the existing session
   rather than patching the DOM (a platform-level override is still the platform; a monkey-patched
   property is not). If the harness's Chromium build offers no such domain, do not substitute a
   patched property — go to (3).
3. **If neither exists:** REQ-142's browser clause is **unverifiable in this harness**, and that is
   an owner/requirements question, **not** a licence to downgrade to a source grep the REQ names as
   insufficient. The honest interim is: `nextPoll`'s UT table proves the decision, the source
   tripwire proves the wiring shape, and the REQ's browser clause is recorded as unverified.
   Recording it beats a green that proves nothing.

**Plus the tripwire, which is cheap and independent of all three rungs** (and which my testability
lens wants precisely because the *race* lives in the wiring, not in `nextPoll`): over
`clientCorpus()`, `setTimeout(` appears in `app.js` exactly once, inside the `arm` arm; `nextPoll` is
the only module that returns `'park'|'arm'|'fire'`. It is a tripwire, not a proof — same standing as
DES-206's constructed-fallback grep — and it makes INV-V28-3's 「no timer exists here」 something a
sweep can grep **for**.

**And keep the stamps secondary.** ARCH-133 is right that `data-poll`/`data-source` written by the
code under test pass vacuously. My position: they are legitimate as a **conjunct**
(`requests === 0 && data-poll === 'parked'`), never as the sole assertion. I expect the
quality-dimensions lens to push for them as primary — see §5.

---

### K11 — `ROUTES.system` growing to three routes needs its degrade split stated — **note (follows from K5)**

ADR-057 accepts that `/api/runs` or `/api/workflows` degrading makes the System tab's tag read 降級.
Fine. But `worstOf` is computed over the tab's whole route set, so DES must state the split
explicitly: **the tag is tab-wide; the Unavailable component is per-card.** CPU/memory/disk cards read
`tick.results['/api/system']`; the counts card reads the other two. Otherwise the natural
implementation (one `if (worst !== 'ok')` at the top of the view) blanks three cards that have perfect
data — a regression against 「degrade, never pretend」 in the *opposite* direction from the one the
rule usually guards.

---

### K12 — `ui/system.js:29`'s zh-only `UNAVAILABLE` retires in this rewrite; say so — **note**

DES-206 rule **(S)** says 「A per-file literal is forbidden … `system.js:29`'s zh-only `UNAVAILABLE`
const … moves onto the key when THAT site is repaired, not before」. Sprint B **rewrites that
file**. So the condition is met and `t(lang,'unavailable')` (already in both languages,
`strings.js:26,35`) replaces it — along with `models.js:56`'s literal, also rewritten. DES should
name both as closed by this sprint, so the v27m disclosure table shrinks by two rows on evidence
rather than by assumption. (`app.js:198`/`:414` stay open — `app.js` is edited but those two sites
are not in this closure.)

---

## Risks

**R1 — the seam is the whole sprint's risk, and it has no unit tier.** After K1–K3, `app.js`'s
`tick()` carries: two verdict maps, a non-idempotent reducer called twice against one `prev`, a
lazy-import-once, a setter into `poll.js`, an extras-discard branch and two `setAttribute`s — in a
file ADR-049 gives no unit tier. Mitigation is not 「add jsdom」 (rightly refused); it is
**(i)** push every decision out (`demoEngages`, `nextPoll`, `sortKeyOf`, `sectionState`) until
`tick()` is sequence-only, **(ii)** write the sequence as numbered prose in DES so a reviewer can
read the file against a list, **(iii)** one real-browser acceptance case per branch. If Gate 3 splits
the seam across two tasks, this risk roughly doubles — see §6.

**R2 — `getViewJSON` reads as the forbidden `okBody` helper at review time.** Not a defect; a
near-certain review round unless DES carries K7's distinction in its own words. Cost of prevention:
two sentences.

**R0 — K0 blocks T-DEMO entirely and must be routed before Gate 3 finalises tasks.** If the
ARCH-132 amendment does not happen, T-DEMO ships a mechanism that cannot fire and Gate 7.5 discovers
it by killing the engine — the most expensive possible place to find it. If the amendment is refused,
REQ-143 leaves the closure and the other four REQs are unaffected (the `getViewJSON` import swap is
the only piece of T-SEAM that exists *for* REQ-143, and it is inert-but-harmless without a dataset).
That is the whole reason §6 keeps T-DEMO as a leaf: **this sprint stays shippable with REQ-143
removed.**

**R3 — the demo path only ever executes during an engine outage, which is also when nobody is
watching the test suite.** ADR-058 states the consequence honestly (every self-update restart paints
demo to whoever is watching). The design risk is that the *recovery* edge is the untested one:
first reached `ok` must exit demo, clear `poll.js`'s map, restore `data-source="live"` and drop the
banner. Put the exit in the **same function** as the entry (one `if/else` on `demoTick`, not an entry
branch here and an exit branch there) — an asymmetric entry/exit is how a console gets stuck in
fiction after the engine comes back, which is the one failure REQ-143 cannot tolerate.

**R4 — `costLevel: 0` vs absent on the Models tab.** `ZERO_RATES` (`model-catalog.ts:96-99`) is an
explicit ruling that 「ollama's fixed rate and a genuinely free openrouter route both mean *this costs
$0*, which is a fact, not an absence」. K4's normalisation must not flatten that: `costLevel === 0`
renders `●○○○○` (or the agreed 0-dots form) and sorts as `0`; `costLevel === null` renders `—` and
sorts last. Getting this backwards makes every local model look unpriced — directly against the
replaceability (agent-altitude) reading above.

**R5 — the `—` columns and the poisoned-row trap.** ADR-060 is explicit: latency/benchmarks are
always `—` this iteration (D2), and a test pinning that absence 「goes green forever the day D2 is
lifted」. K4's UT must therefore be a **rule over fixtures** (one row with the datum, one without),
never an assertion about `/api/models`'s real content. Flagging it here because K4 is the row most
likely to be implemented as 「assert the cell is `—`」.

**R6 — shared-tree hazard during the implementation gate.** `CLAUDE.md` records ~20 implementers on
one working tree and two ledger-destroying incidents. `static-assets.test.ts:50-71` is closed
**both ways**, so a new `.js` file on disk without its `ASSET_KEYS` entry turns that test red **for
every other agent**, not just its author. Treated as a task-splitting constraint in §6, not a hope.

**R7 — ADR-060 / Won't-have D5 is owner-ruled and closed.** My K4/K5 findings are inside REQ-137's
和 REQ-138's closure (sort order, absent rendering, card state) and must not drift toward provider
health. I will not re-raise D5, and I flag in §5 that I will not join a re-litigation of it either.

---

## Internal conflicts between my three lenses (explicit, with the tie-break)

**C1 — testability wants the demo predicate extracted; simplicity refuses a new file.**
Testability: an untested three-term boolean at the seam is QD-R2 repeating itself, and ADR-059 set the
precedent one requirement earlier. Simplicity: a `lib/demo.js` holding one predicate is a *second
describer* of a dataset whose registered exit is deletion — precisely the defect class REQ-143 names
(「刪掉了卻還有東西在描述它」). **Tie-break: testability wins the extraction, simplicity wins the
location.** One exported function in `lib/connection.js`, beside `nextConnection`/`worstOf` — the two
things it reasons about. No new file, no new `ASSET_KEYS` entry, one extra line on the retirement
checklist. (K6.)

**C2 — boundary wants `sortRows` to understand `null`; interface wants `runlist.js` untouched;
simplicity refuses a second comparator.** Boundary: the absent-last guarantee is currently false for
the data (measured). Interface: `runlist.js` is v27-closed and REQ-133's history table depends on its
exact behaviour — widening 「absent」 to include `null` there could reorder a shipped table.
Simplicity: ARCH-134's 「no second comparator」 is a good refusal and I keep it. **Tie-break: normalise
at the projection, not at the comparator.** `sortKeyOf(entry, column) → scalar | undefined`, with
`undefined` as the ONLY absent token; `sortRows` unchanged; one 12×2 UT table. All three lenses get
what they actually needed. (K4.)

**C3 — interface wants one result type; boundary says `reached` is meaningless on a map answer.**
Boundary's objection is real: nothing was reached over the network, so `reached:true` is a small lie
about the transport. Interface's counter is stronger: an optional field on a union consumed by six
modules is how a `undefined`-vs-`false` bug enters, and five of those modules are not being rewritten.
**Tie-break: interface wins, with the field's meaning redefined rather than fudged** —
`reached` = 「a response was obtained」, not 「a socket was opened」. It is never read on a
`getViewJSON` result anyway (K3 keeps extras out of the reducer on demo ticks), so the lie is
unobservable and the type is uniform. State the definition in DES so nobody re-derives it as a bug.
(K7.)

**C4 — testability wants `app.js`'s scheduler WIRING unit-testable; ADR-049 refuses jsdom;
simplicity refuses a loop-driver abstraction.** The race ADR-059 correctly identifies
(`tick().finally(() => setTimeout(loop, 3000))` re-arming after the page went hidden mid-flight,
`app.js:394-396`) lives in the **wiring**, not in `nextPoll` — so the pure UT proves the decision
table and leaves the actual defect unproven. The tempting fix is to inject `{setTimeout, clearTimeout,
visibility, tick}` and drive the loop from node; that is a framework seam in a layer whose whole
constitution is 「no abstraction」. **Tie-break: refuse the abstraction; buy coverage with two cheap
instruments instead** — the real-browser count (K10's ladder) plus the source tripwire
(`setTimeout(` once in `app.js`, inside the `arm` arm). Accept honestly that the wiring's coverage is
weaker than the decision's, and record it rather than paper over it. If Gate 5's measurement kills
rung 1 **and** rung 2, C4 reopens and injection becomes the least-bad option — say so now so that
reopening is cheap.

---

## Expected disagreements with the other lens group (quality-dimensions: observability /
replaceability / consumability / self-sustainability)

**D1 — `data-poll` / `data-source` as a PRIMARY oracle.** I expect the observability lens to argue the
stamps are the operator-visible truth and should be asserted directly. I hold that a stamp written by
the code under test is a **vacuous** oracle (ARCH-133 says so itself) and may appear only as a
conjunct beside the request count. **Likely convergence:** stamps are a *product* requirement
(REQ-143's 「每個 tab 的可見區域都能看出處於示範模式」) and a *secondary* test signal. Both true; the
DES row should say both, in those words.

**D2 — the `lib/views.js` registry.** The consumability/self-sustainability lens has a real case
(one place to learn 「what is a tab」). ARCH-133 refused it with a fact I find decisive:
`tests/unit/static-assets.test.ts:50-71` is already closed both ways, so carry-forward lesson 6 is
already red-on-failure, and the registry would refactor `poll.js`'s documented extension point during
the one sprint that rewrites three of its consumers. **My position: refuse the module, accept the one
assertion** ARCH itself offers (every `TAB_MODULES` value is a registered `STATIC_ASSETS` key) —
one line, same guarantee, no refactor. I expect to concede nothing further here.

**D3 — provider-health on Models (ADR-060 / Won't-have D5).** I expect it to be re-raised as an
observability gap; it is real and measured (`model-catalog.ts:303-304`). **It is owner-ruled and
closed.** I will not join a re-litigation: reopening needs a new REQ, not a re-discovery, and
re-arguing it spends a round on a settled question. If the other lens raises it, my round-2 response
is one line pointing at ADR-060's `owner_decision:` and D5.

**D4 — where the fourth stat card's numbers come from.** The panel already cross-conceded on this at
the architecture gate (ADR-057, option (b)). I expect the quality lens to revisit it at design
altitude on consumability grounds (「three GETs to render one card」). I support (b) unchanged **and**
add the thing the architecture gate did not settle: **K5/K11's per-card degrade split.** That is the
design-altitude half of ADR-057, and I expect agreement rather than conflict once it is stated.

**D5 — how much of `ui/` the sprint is allowed to touch.** I expect the self-sustainability lens to
push for repairing `home.js:229` / `workflow.js:397`'s body-shape degrade now that `tick.results`
makes the positive rule reachable. I agree it is the right fix and **oppose doing it here**: ARCH's
scope paragraph excludes it explicitly, it buys no in-scope REQ, and the sprint already rewrites
three files and the seam they all hang from. **Compromise I will offer in round 2:** DES records the
one-line shape of the fix beside the now-available `tick.results`, so the day either file is next
opened it is a copy, not a re-derivation.

**D6 — demo mode's blast radius during self-update.** The self-sustainability lens may argue that
painting fiction during every self-update restart is worse than a blank. That is the owner's Q8 answer
and ADR-058's stated consequence; my contribution is **R3** (make entry and exit one symmetric
branch) rather than reopening the trigger.

**D7 — K0's fix trades a Live-deployment cost for a mechanism that works.** I expect the
consumability/observability lens to dislike shipping demo bytes on every page load of a healthy
deployment — it is a real cost and ARCH-132 explicitly claimed the opposite. My position: a mechanism
that never fires costs more than a few KB, and the two branches (static import, or REQ-143 returns to
the owner) are the complete option set under D3 + no-flag. If the other lens has a third mechanism I
have not found, K0 is the finding I most want contradicted — it is the one where being wrong is
cheapest to discover in round 2.

---

## Task-splitting (03-tasks.md does not exist yet — this is where my lens changes it)

A dependency graph, not a wish-list. The ordering constraint is **one**: the seam is a hard
prerequisite for everything else, and it must land **alone**.

```
T-SEAM  (blocks everything below)
  ui/app.js   — the K2 sequence, the two maps (K1), the extras discard (K3),
                the dataset import + setter (STATIC per K0, pending the ARCH-132
                amendment this proposal routes), the two data-* stamps
  ui/poll.js  — reached, getViewJSON, the demo-map setter, ROUTES.system = 3 urls
  one-line import swap in run.js / workflow.js / agent-panel.js  (getJSON -> getViewJSON)
                — the three NOT rewritten this sprint. issues.js's click-driven detail
                  loader takes getViewJSON too, but inside T-ISSUES, since that file is
                  rewritten whole; models.js and system.js stop importing either one.
  the INV-V28-1 guard test (walks src/dashboard/ui/**, fails on any other getJSON importer)
  DES-206 rule (R)'s demo exception clause
        |
        +-- T-SCHED   lib/scheduler.js + connection.js resumeReset + app.js wiring + UTs   (REQ-142)
        +-- T-MODELS  lib/model.js sortKeyOf/matchModels/modelRow/costDots/modelPanel
                      + ui/models.js rewrite + the 12x2 UT table                            (REQ-137)
        +-- T-SYSTEM  lib/system.js sectionState/cpuUtilState/statCard/procRow/procTotals/
                      fmtBytes/catalogCounts + ui/system.js rewrite + UTs                   (REQ-138)
        +-- T-ISSUES  lib/issues.js safeIssueHref + ui/issues.js rewrite + UTs              (REQ-139)
        +-- T-DEMO    demo/dataset.js + demoEngages in lib/connection.js + the fixture rows
                      + demo-surface.test.ts tripwire + the id-charset UT                   (REQ-143)
T-SERVER  (independent)  server.ts topN 5->20 + the four owed disclosure rows               (REQ-138)
```

Four constraints my lens asks Gate 3 to write into the tasks:

1. **T-SEAM is one task, lands first, and is not split by file.** Its five pieces are one contract:
   `poll.js`'s `reached` without `app.js`'s sequence is a dead field; the import swaps without
   `getViewJSON` break three working views; the INV-V28-1 guard is **red today** (`run.js:83`,
   `workflow.js:36`, `agent-panel.js:35` — ARCH-133 says so) and must go green in the same commit that
   makes it true. Splitting it means every tab task starts against a half-built seam.

2. **Every new `.js` file lands in the SAME task as its `ASSET_KEYS` entry.** `static-assets.ts:18-26`
   + `static-assets.test.ts:50-71` is closed both ways, so a registered-but-missing (or
   present-but-unregistered) file turns that test red **for all ~20 implementers on the shared tree**
   (`CLAUDE.md`'s recorded hazard). Four files are affected: `lib/scheduler.js`, `lib/system.js`,
   `lib/issues.js`, `demo/dataset.js`.

3. **The three fixture rows (K8) land in T-DEMO, before the three tab tasks consume them.** They serve
   three consumers (type oracle, ADR-054 disclosure locks, `.js` UT inputs). Authoring them three
   times in three tasks is how three subtly different 「the same」 fixture ends up on disk — this
   ledger's most expensive defect class (v26 R-1).

4. **Each tab task owns its `lib/` module AND its `ui/` module AND its UT.** Splitting 「pure」 from
   「DOM」 across two tasks produces a `lib/` export with no caller and a `ui/` file importing a
   function that does not exist yet — and, under ADR-049, the `ui/` half has no unit tier to catch
   the mismatch.

**DES row mapping** (no new ids minted here — that is the synthesizer's call):
amend **DES-206** for the seam (the K1/K2 sequence, the K7 result type, the K3 `(R)` exception,
and the K12 closure of two `(S)` rows); amend **DES-204** only by *reference* for the sort (K4's
`sortKeyOf` belongs to the model row, not to `runlist.js`); **DES-207** 「the three tabs are PORTED,
a mechanical move, no redesign」 is **superseded** by this sprint and should say so explicitly rather
than be left standing beside three rewritten files. New rows are needed for: the scheduler + resume
rule, the demo dataset + its tripwire, and the model/system/issues projections.
