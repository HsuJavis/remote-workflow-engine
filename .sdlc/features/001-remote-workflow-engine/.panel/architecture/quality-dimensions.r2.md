---
stage: architecture
lens: quality-dimensions
iteration: v27 Sprint B (REQ-137, REQ-138, REQ-139, REQ-142, REQ-143)
round: 2 (responses + final position)
inputs: adversarial.r1.md (all of A-1..A-10, R1..R7, its expected-disagreements list), quality-dimensions.r1.md, and re-verified this round: src/dashboard/ui/{poll,app,models,system,issues}.js, src/dashboard/lib/{connection,model,strings}.js, src/server.ts:355-400,455-494,1099,1361-1370, src/dashboard.ts:80-125, src/system-info.ts:18-100,200,256, src/workflow-catalog.ts:565,807, src/run-manager.ts:823-824, src/static-assets.ts:18-26, src/tool-specs.ts:990-1005, tests/fixtures/dashboard-wire.ts:128-147, tests/integration/dashboard-disclosure.test.ts:122-129, tests/unit/static-assets.test.ts:51-70, 01-requirements.md:1846-1945
---
# Quality-dimensions — round 2

## summary

The two lenses agree on the spine of Sprint B: **one timer, one fetcher, views render supplied data**
(A-1 ≡ B-R1); **decisions in `lib/`, DOM in `ui/`** (A-8 ≡ B-R4); **test the rule, not this
iteration's absence** (A-4); **closed key sets per route** (A-2's allowlist *is* B-C1's disclosure
row); **acceptance starts at a cold `/dashboard` and clicks the tab** (A-9 ≡ B-C6); and the demo
dataset is a **lazy-loaded module, one emitter, self-labelled, retired by tripwire** (A-6(b)(c) ≡
B-R3/B-O4/B-S4). I **concede four** of my r1 rows to the adversarial on evidence I re-verified this
round (`?topN=` → B-C4; `supportedParameters` → B-C2; typed-absent keys → B-C3; the counts card's
source → B-R6) and **integrate two** it raised that I had not (A-5 streak reset, A-10 link pin).

Two disagreements remain, both decidable by the code: **(H1) the demo trigger** — A-6(a)'s
「engage at `offline`」 fires on a healthy engine (`server.ts:488` answers 404 for a stale
`/dashboard/<runId>`; `connection.js:46` folds it to `fail`; `:39` declares `offline` at 2) — one
per-tick `reached` bit closes it and serves the adversarial's own goal; **(H2) `/api/models/status`**
— the only carrier for 「a provider returned nothing」 that leaves `models_list` byte-identical, and
it rides the `startsWith('/api/models')` dispatch already at `server.ts:1368`, so the auth-gate
condition A-7 pins stays unchanged. Everything else below is the converged position, written so
Gate 3/4 can copy it.

## Responses to adversarial r1 (rebut / concede / hold / converge)

| item | verdict | engineering reason (file:line that decides it) |
|---|---|---|
| **A-1** one timer, views consume `bodies` | **converge** (= B-R1) | Same measured sites (`models.js:52`, `system.js:72`, `issues.js:99`). I add the first-paint answer to A-1's own follow-on: `activateTab` leaves `onTick: null` until `import()` resolves (`app.js:182-186`) **and** the cached path returns without firing (`:186`) — so tab activation is a scheduler event (`view-changed → fire`, B-S1) and `tick()` keeps `lastTick = {name, bodies, source}` so a late-mounting `onTick` paints from it with the same `ctx.source` (`import().then` at `:189`). Zero duplicate GETs; A-1's ratio check (one GET per tick, count == ticks) holds unchanged. |
| **A-2** bound the recon payload, no `?topN=` | **concede B-C4; converge on the check** | `system_info` already exposes `topN` 1-50 to *authenticated* MCP callers (`tool-specs.ts:999-1004`); the unauthenticated HTTP route needs no knob. Named constant at the route (`server.ts:370`, today `5`; 20 per A-2, decided here per R3). A-2's 「closed allowlist of `/api/system` keys」 is exactly a `DISCLOSURE_TABLE` row (`dashboard-wire.ts:128-147`, test at `dashboard-disclosure.test.ts:122-129`) — **one mechanism**, not two. The `bind: 0.0.0.0` consequence goes in the ADR + a DEPLOY line, as A-2 says. |
| **A-3** project `supported_parameters`, don't re-expose | **concede B-C2** | Three reasons outweigh mine: it reverses a recorded v26 rule (`model-catalog.ts:429`), it grows *every* `models_list` reply for a slide-in detail, and — my own lens — the dashboard would show a fact the MCP caller cannot get (consumability parity broken). Tag row = `toolUseDeclared` / `effortDeclared` / `declaredSource`. **But the acceptance text literally says 「支援參數以 neutral tag 列出」 (`01-requirements.md:1858`)**; the panel may not edit it → housekeeping item (i), with B-C2 recorded as the alternative if the owner insists. |
| **A-4** test the rule, not the absence | **converge; concede B-C3** | Two client fixtures per honesty column (no `latency` → `—`; with → `TTFT … · p50 …`). The TS-typed `latency?`/`benchmarks?` keys I proposed are dropped — the JS fixture already pins the shape a v28 producer must match; record that in the ADR, not in the type. |
| **A-5** reset `consecutiveFails` on resume | **concede the principle; refine the rule** | Two facts constrain it: demo requires `offline` (B-S2), so a naive reset on an already-offline console produces a demo → Unavailable → demo flash on the first resumed tick; and resetting `status` to `checking` would paint 「連線中…」 (`app.js:31`) over a dead engine — one ellipsis from Live. Rule: **the pause invalidates a *partial* streak, never a declared verdict** — `resumeReset(prev) = prev.status === 'offline' ? prev : {…prev, consecutiveFails: 0}`, a named export of `connection.js`, driven by the scheduler's `visible` action. UTs: `fail → pause → fail ⇒ degraded` (A-5's); `fail → fail → pause → fail ⇒ offline` (no flash); `fail → fail → pause → ok ⇒ live`. |
| **A-6(a)** demo engages at `offline` | **hold (H1)** | Reproducible on a healthy engine: `ROUTES.run` is the single URL `/api/runs/:id/dag` (`poll.js:17-19`); unknown id → 404 (`server.ts:488`); `classifyResponse` → `fail` (`connection.js:46`); two ticks → `offline` (`:39`) → the console renders fiction over a working engine 6 s after someone opens a stale link. Fix is **A-6(a) + one discriminator**: `getJSON` reports `reached` (its outer `catch` at `poll.js:52-54` is the only `false` arm); `demoTick = offline ∧ allUnreached`. Not a second threshold, not new state — one boolean per tick. The reducer and REQ-131's tag are untouched (QD-O4 stays LOW debt). |
| **A-6(b)** dataset lazy-imported, in `ASSET_KEYS` | **converge** | Identical to B-R3; the closed-map test (`static-assets.test.ts:51-70`) enforces both directions. |
| **A-6(c)** one emitter, no view model mixes demo + live | **converge; tighten my r1** | Checked my per-URL `viewBody` against a partial-recovery tick (one route reached, one not): it mixes. Replaced by **per-tick all-or-nothing** — `tick()` hands `onTick` either the real `bodies` or the dataset's, never a blend, and passes `source` in `ctx` (no global). This also shrinks the DES-206 concern: there is no helper wrapping the classifier, only a branch in `tick()` choosing which map to hand over. |
| **A-7** counts card from `/api/workflows` + the runs fold, not a wider `/api/system` | **concede B-R6** | Re-measured: no `countRuns()` exists (`run-store.ts:191,386`); `buildDashboardModel(runs).runs` is `[...runs]` unsliced (`dashboard.ts:86`) so `length` **is** the same fold `/api/home` pays for every tick (`server.ts:358-366`); `catalog.list()` carries `versions: string[]` per entry (`workflow-catalog.ts:807`). Two already-served lists beat two new store accessors. Honest cost: A-7 says +1 GET but its shape needs **both** `/api/workflows` and `/api/runs` → +2 on the System tick, net +1 after A-1. Revisit trigger recorded: the day `/api/runs` gets a list bound (ADR-052 says none this round), the count moves server-side — and my COUNT-accessor shape is the recorded alternative. |
| **A-8** derivation in `lib/`, DOM in `ui/` | **converge; fix a name** | `lib/model.js` exists with only `shortModel` (`lib/model.js:5`); my r1's `lib/models.js` would be a near-duplicate asset key. **Extend the existing file**; `lib/system.js` is new (an ARCH-124 amendment). |
| **A-9** click the tab, never deep-link | **converge** (= B-C6) | val-202 re-authored under its own VAL id; `notClipped` for every 「fits its box」 clause. |
| **A-10** `https:` pin on issue links | **integrate** | One branch → `lib/` by A-8's own rule of admission; `https:` protocol pin is the load-bearing line (CSP already blocks `javascript:`), `rel="noopener noreferrer"`; host pin only if the island already carries the repo — do not add island data for it. UT with A-10's two inputs. |
| **R5** `/api/issues` has two 200-`{degraded}` bodies | **converge** (= B-O5) | `server.ts:463` and the catch-all; key on `res.status`, read the reason from the body **inside** the non-ok branch. A-1 deletes `issues.js:99-104`'s shape guard outright. |
| **R6** `cpuPct: null` bar must have an absent state | **converge** (= B-O2) | Per-section, with the reason (below). |
| **R1/R2/R3/R4/R7** | **agree** | R7 is why this file is half the length of r1. |

Rows the adversarial did not touch — **unopposed in r1, held**: B-O3 (`data-*` stamps), B-R2 (view
registry, MID — Gate 4 may defer), B-C5 (strings in both languages), B-S3 (idempotent paint), B-S4
(tripwire), B-S5 (catalog fetch is the liveness probe).

---

## 1. Observability — final position

**O-1 (was B-O1, HELD as H2, shape amended).** Provider loss is invisible on `/api/models`: with both
remote providers refusing, `buildCatalog` serves the 4 static rows with **fresh** `catalogFetchedAt`
and no marker (r1 probe, `model-catalog.ts:303-306`). Amendment after this round: **do not move the
nav tag** — the tag reports hop 1 (browser → engine); a provider is hop 2 (engine → Ollama/OpenRouter),
and folding hop 2 into hop 1's tag would make a bottleneck *less* locatable, which is the opposite of
this dimension. So `GET /api/models/status` → `{ fetchedAt, source: 'live'|'last-good'|'static',
count, providers: { anthropic: 'static', ollama: 'ok' | {error, at}, openrouter: … } }`, HTTP 200
with **no `degraded` key on provider failure** (only the catch-all's, like every route); the Models
tab renders the provider line in its own chrome (「目錄 HH:MM · live · ollama: 無法取得 (ECONNREFUSED)」).
Why a route and not a per-row field: a provider with zero rows has no row to carry the fact, and a
per-row field would grow `models_list` (the exact cost A-3 refuses for `supportedParameters`) while
the route leaves the MCP payload byte-identical. Why it is not a new dispatch surface: `server.ts:1368`
already dispatches `startsWith('/api/models')`; A-7's check that `:1361-1370` is unchanged still passes.
Engine side unchanged from r1: `buildCatalogReport → {entries, providers}`, `buildCatalog` = its
`.entries`, `ModelBook` caches `providers` under the same TTL/single-flight, one journal line
`model_catalog_provider_failed` **on transition only** (ARCH-130's faults-not-states rule). Client:
`ROUTES.models = ['/api/models/status']` every tick (the small heartbeat that keeps REQ-131's tag fed);
`/api/models` re-fetched as a state-dependent secondary only when `fetchedAt` changes — the pattern
`run.js`/`workflow.js` already use, its status merged into the tick. **Fallback if the panel refuses
the route:** journal line only + 「目錄時間 HH:MM」 from `catalogFetchedAt`; what is lost is stated —
a provider that returned nothing is visible in the journal and nowhere on the tab.

**O-2 (B-O2, converged with R6).** `SystemInfoView` degrades per section with a closed `Reason`
(`system-info.ts:24-34`: `awaiting-second-sample | sample-window-too-short | timeout |
unsupported-platform | probe-error`), three of which are not faults. `sectionState(x) → {kind, reason?}`
in `lib/system.js`; each stat card, the process table and the engine `<dl>` render through it; the
bar component has an absent state; the reason is the card's secondary text so 「wait one tick」 and
「this host cannot report it」 are distinguishable without the journal. `system.js:29`'s zh-only
`UNAVAILABLE` literal retires into `t(lang,'unavailable')` (`strings.js:28,36` already has both).

**O-3 (B-O3, held).** `data-conn`, `data-source`, `data-poll` on `documentElement`, stamped at
`updateConnectionTag` (`app.js:113`) and the scheduler. One `setAttribute` each; the second oracle for
REQ-142/143 beside request counting (A-9's testability preference is primary; this is additive).

**O-4 (B-O4, converged with A-6(c)).** Self-labelling at three layers: nav tag, shell banner (placed
where `mountLazy`'s `replaceChildren()` at `app.js:404` cannot kill it), and the data (`demo-` ids,
`[DEMO]` titles, PIDs in a fixed `99xxx` band). The two non-live tags **partition**: Demo =
`offline ∧ allUnreached`; Offline = `offline ∧ something reached` (404/5xx storm). REQ-131's Offline
clause stays validatable while REQ-143 stands; retiring the dataset collapses the unreached case back
to Offline with no other change.

**O-5 (B-O5 = R5).** Positive `res.status !== 'ok'` at `issues.js:80,102`; server reason as secondary
text; the 404 on `/api/issues/:number` (`server.ts:477`) renders Unavailable, never a hidden box.

**O-6 (new, LOW).** `app.js:31/36`: `checking: '連線中…'` vs `live: '連線中'` — the *unknown* state is
one ellipsis from the *healthy* one, and the table lives in `app.js`, not `strings.js` (a QD-R3 site).
Housekeeping (ii): move the table; reword `checking`. This is also why A-5's reset must not touch `status`.

## 2. Replaceability — final position

**R-1 (B-R1 = A-1).** Contract for Gate 4: (i) `onTick(container, bodies, ctx)` reads `bodies[url]`
for every URL its `ROUTES` entry names, never fetches those; (ii) `getJSON` is imported by
`app.js`/`poll.js` only — click-fetch sites import `getViewJSON` (demo-aware, §4); (iii) extra
statuses only for state-dependent fetches, and always the **real** transport status — never a substituted body's; (iv) `activateTab` emits `view-changed`; `tick()` keeps
`lastTick`. Guard: a unit test walks `src/dashboard/ui/**` and fails on `import { getJSON }` elsewhere.

**R-2 (B-R2, unopposed, MID).** `lib/views.js` replaces `TAB_MODULES` (`app.js:151`) + `ROUTES`
(`poll.js:15-27`) with one registry cross-checked against `ASSET_KEYS` by a `.ts` test. Net one
table fewer; Gate 4 may defer if the sprint is tight — lesson 6 is already covered by the closed-map test.

**R-3 (B-R3, tightened per A-6(c)).** The dataset is a **render source chosen per tick**, never a
transport swap (the handoff's `.dc.html:530-537` machine never re-probes — do not transcribe it).
`src/dashboard/demo/dataset.js`: plain ESM, in `ASSET_KEYS`, lazy-`import()`ed on first demo tick,
an exact-match `Map<url, body>`, **type-locked** by a `.ts` test that `satisfies`-checks each body
against the wire types in `dashboard-wire.ts` (the same rows as C-1). Coverage boundary as r1
(parametric routes for the dataset's own ids only; `diagram.svg` → `paintFigureUnavailable`, recorded).

**R-4 (B-R4 = A-8).** `lib/model.js` gains `matchModels`, `modelRow` (the `—` rule, `text+image → text`,
latency formatting), `costDots`, `panelModel`; `sortRows` reused from `runlist.js:42` (absent-last both
directions — exactly what `—` cells need). New `lib/system.js`: `sectionState`, `statCard`, `procRow`,
`fmtBytes` (out of `system.js:38`), the `總處理程序 N · S · R` header from `process.system.byState`
(`system-info.ts:76`), and **`catalogCounts(workflows, runs) → {workflows, versions, runRecords}`**
(A-7's fold, pure: `entries.length`, `Σ versions.length`, `runs.length`). Rule of admission unchanged.

**R-5 (B-R5, agent altitude, unchanged).** Beside Tools/Effort the row shows `declaredSource`; after
O-1 the catalog `source` line. This is where 「GPT ↔ Claude ↔ Llama is a config change」 is visible
to the person choosing — and, after A-3, the dashboard shows **exactly** what `models_list` returns.

**R-6 (conceded to A-7).** `ROUTES.system = ['/api/system', '/api/workflows', '/api/runs']`;
`SystemInfoSampler` and `/api/system`'s shape untouched; the two extra routes join `worstOf` like any
other (no special-casing); the card renders Unavailable if either is not `ok`.

## 3. Consumability — final position

**C-1 (B-C1 = A-2's allowlist).** Rows owed now in `DISCLOSURE_TABLE`: `GET /api/system` (ok +
per-section degraded), `GET /api/models[i]` (`satisfies EnrichedModelEntry`), `GET /api/models/status`
(if H2 lands), `GET /api/issues` (ok + `{open:[],resolved:[],degraded}`), and — newly on a poll
path via R-6 — `GET /api/workflows[i]`. INV-V27-7's shape rule (`02-architecture.md:3672`) binds:
exact set equality, additions fail. One fixture, three consumers (disclosure lock, `.js` unit inputs,
the demo dataset's type oracle). In a repo with no OpenAPI, this table **is** the API doc.

**C-2 (conceded to A-3).** Tag row from the projected declared facts; deviation recorded (housekeeping (i)).

**C-3 (conceded to A-4).** No typed-absent keys; the JS fixture with `latency` pins the shape.

**C-4 (conceded to A-2).** `DASHBOARD_PROCESS_ROWS = 20`, a constant beside the route; `system_info`
keeps its 1-50 argument; `grep topN src/server.ts` shows no URL-derived value.

**C-5 (B-C5, unopposed).** Every Sprint B key lands in both languages in one edit; `issues.js:61-72`'s
literals and `system.js:29` move; zero new `lang`-conditional copy sites; key-parity test grows by the count.

**C-6 (B-C6 = A-9).** Re-author val-202 under its own VAL id; tab click first; `notClipped` for clipping.

**C-7 (new, from A-10).** `safeIssueHref(url) → string | null` in `lib/`; `issues.js:85` sets `href`
only from a non-null result.

## 4. Self-sustainability — final position

**S-1 (B-S1, location held, size conceded).** `lib/scheduler.js`: `nextPoll(state, event) → {state,
action}` over `settled | hidden | visible | view-changed` → `fire | arm(3000) | park`. `hidden → park`
(no timer, so AD-2's empty-tick hazard is unreachable); `visible → resumeReset` then `fire` then `arm`
(REQ-142 clause 3 + A-5); `view-changed → fire` (A-1's follow-on); `settled → arm` unless parked.
`app.js` keeps only the `visibilitychange` listener, the injected `visibility()` getter and
`viewGeneration` (`app.js:357`, wiring). ~25 lines; its value is the decision table tested in node —
QD-R2 is the recorded finding that this class rots untested in `ui/`. Oracle traps and the real-hidden
mechanism as r1 (sibling page + `bringToFront()`; measure `visibilitychange` first; never a frozen
page or a patched `visibilityState`). Positive checks: 0 `/api/*` requests over 30 s hidden; first
request within ~300 ms of re-show; `data-poll="parked"` during the window.

**S-2 (B-S2, held as H1, mechanism simplified).** In `tick()` (`app.js:365-386`), after the primary
fetches: `allUnreached = urls.every(u => !reached[u])`; `preview = nextConnection(connectionState,
{results})` (pure — calling it early costs nothing and does not commit); `demoTick = preview.status
=== 'offline' ∧ allUnreached ∧ DEMO_AVAILABLE`. If `demoTick`: lazy-load the dataset once, hand
`onTick` the dataset's bodies for `urls` with `ctx.source = 'demo'`; else hand the real `bodies`.
The reducer then runs **on the real `results` as today** (`:379-383` ordering kept, extras included),
so the tag is `offline` and its label is chosen as Demo iff `demoTick`. Entry: the 2nd consecutive
unreached tick (the same tick Offline would have been declared, 3-6 s). Exit: the first tick with any
route reached → `demoTick=false` → real bodies (ok ones live, failed ones Unavailable — never a blend)
→ REQ-143 clause 3 holds with no second probe. `getViewJSON(url)` for click fetches: real fetch;
substitute only if `!reached ∧ demoActive ∧ DEMO.has(url)`. **Substitution touches `body` only — the status a view returns as an `extra` is always the real transport verdict** (a substituted secondary that reported `ok` would take the reducer to `degraded`, flip `demoTick` off next tick, and oscillate demo every other tick — the exact violation of O-4's partition). Trigger reality unchanged: the page is
served by the same process, so the only real trigger is **mid-session engine loss**; Gate 7.5 stops the
engine under an open page; every self-update restart shows demo for its duration — the owner's Q8
choice, mitigated by O-4 and made reversible by S-4.

**S-3 (B-S3, unopposed).** Fingerprint repaint on the Models tab (`fetchedAt` + count + sort/filter/
selection); per-container UI state so a tick never closes the slide-in; System repaints values in
place, rows keyed by pid. With O-1 the 100-row list leaves the 3-s tick entirely; without it, the
fingerprint is what bounds the churn.

**S-4 (B-S4 = R2's mitigation).** `tests/unit/demo-surface.test.ts`: a closed-both-ways allowlist of
files permitted to contain `demo` / `示範`. Retirement = one commit removing a directory, three lines
and a test, with nothing left describing it — REQ-143's own exit clause made mechanical.

**S-5 (B-S5).** The catalog fetch is the only liveness probe this slice has; O-1 makes its outcome visible.

**Named and dropped (unchanged):** autoscaling, circuit breakers, interval tuning/push (D3), server
retention for anything Sprint B adds, memory metabolism of agent context, prompt self-calibration.

---

## key_points

1. **Converged spine:** one seam (A-1/R-1) with `view-changed → fire` + `lastTick`; `lib/` for
   decisions (A-8/R-4, extending the existing `lib/model.js`); rule-not-absence fixtures (A-4);
   closed key sets = disclosure rows (A-2/C-1); tab-click acceptance (A-9/C-6).
2. **Conceded to the adversarial:** `?topN=` (constant 20), `supportedParameters` (projected facts +
   housekeeping), typed-absent keys, the counts card (client fold of two already-served lists,
   +2 GETs on System, net +1, ADR-052 revisit trigger).
3. **Integrated from the adversarial:** A-5 as `resumeReset` — partial streak resets, a declared
   `offline` does not (no demo flash, no 「連線中…」 over a dead engine); A-10 as `safeIssueHref`.
4. **Held on evidence (H1):** `demoTick = offline ∧ allUnreached` — `server.ts:488` → `connection.js:46,39`
   is a reproducible healthy-engine false positive for 「engage at `offline`」. One bit, no new state.
5. **Held on evidence (H2):** `GET /api/models/status`, amended to report hop 2 in the tab, not the
   tag; rides `server.ts:1368`'s prefix dispatch; leaves `models_list` byte-identical; fallback stated.
6. **Demo substitution is per tick, all-or-nothing** (A-6(c)); source travels in `ctx`; three-layer
   marking; tripwire exit.
7. **Scheduler stays a `lib/` reducer** (size conceded to ~25 lines); real-hidden oracle only.

## risks (delta from r1)

| id | sev | risk | mitigation |
|---|---|---|---|
| B-K2' | HIGH | If H1 is overruled, a stale run link puts the console in demo on a healthy engine | the `reached` bit; if refused, record QD-O4 as HIGH, not LOW |
| B-K4' | HIGH | If H2 is refused, provider loss with zero rows is journal-only | say so in the ADR; do not let the tab imply completeness |
| B-K14 | MID | R-6's two list bodies per 3 s grow with run history | ADR-052 revisit trigger; COUNT accessors recorded as the alternative |
| B-K15 | MID | A-5 done naively (reset `status`, or reset an `offline` streak) flashes demo/Unavailable or shows 「連線中…」 | `resumeReset` touches the counter only, never a declared `offline` |
| B-K16 | LOW | `lib/models.js` + `lib/model.js` both in `ASSET_KEYS` | one file (R-4) |

## remaining disagreements (for the orchestrator)

1. **H1 — demo trigger.** Adversarial: `offline` alone (zero new state). Mine: `offline ∧ allUnreached`
   (one per-tick bit from `getJSON`'s outer catch). Tie-breaker I propose: the stale-link reproduction
   is a Gate 7.5-runnable fact; whichever is chosen, Gate 5 must build the two proofs separately
   (REQ-131 Offline = HTTP-error storm; REQ-143 Demo = stopped engine under an open page).
2. **H2 — `/api/models/status`.** Adversarial's frame is 「zero new routes」; mine is that it is a new
   handler arm on an existing dispatch prefix, the only carrier for zero-row provider loss, and the
   one shape that spares the MCP payload. Fallback if refused is written into O-1 with its loss stated.
3. **Housekeeping the panel cannot perform (acceptance text, plus one code item):** (i) REQ-137 「支援參數以 neutral tag 列出」
   → reading 「= the engine's projected declared facts (tools / effort / source)」, deviation named;
   (ii) `app.js:31-36`'s connection labels move to `strings.js`, `checking` reworded;
   (iii) REQ-142 「Playwright」 → 「真實 Chromium(既有 puppeteer harness)」 (ADR-053 wording);
   (iv) REQ-143 「交付包的示範資料集」 → 「engine-authored, type-locked to the wire」 (PROVENANCE.md:
   `rwe-data.js` is not vendored); (v) REQ-138's counts card and REQ-137's tag row are now wire-neutral
   after A-7/A-3 — only O-1's status route (if accepted) is a wire delta REQ-140 did not enumerate.
