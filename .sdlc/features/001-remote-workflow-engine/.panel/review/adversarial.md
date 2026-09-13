---
stage: review (Gate 8)
lens: adversarial group — (a) security, (b) scalability/performance, (c) testability;
      Karpathy simplicity-first as the tie-breaker
iteration: v27 (closure REQ-131..136, REQ-140, REQ-141)
subject: 02-architecture.md §v27 (ARCH-122..131, ADR-049..056, INV-V27-1..9)
         vs. the code named on the `files:` lines of 06-impl-log.md IMPL-221..268
measured at: HEAD ef0a400 — every file:line below is a HEAD line number, NOT the
             architecture document's own (those are pinned at 07266be and are stale)
verdict: NOT CONSISTENT — 8 deviations (1 HIGH, 2 MEDIUM, 5 LOW)
---

# Adversarial review — v27 architecture vs. implementation

**Bottom line.** The v27 slice is unusually faithful on the things this lens group normally
catches: the first path-traversal surface the engine has ever had is a closed `Map.get` with no
`join`/`normalize` anywhere (`src/static-assets.ts:60-62`), the CSP shipped byte-for-byte as
specified (`src/server.ts:1332`), REQ-136's system prompt is genuinely never captured (one
decoration site, strip → `redact()` → `capPrompt`, fails closed), and *nothing speculative was
built* — no ETag layer, no content-hash filenames, no compression, no `(runId,reason)` dedupe set,
no LRU derivation memo, no router library. The Karpathy tie-breaker was honoured, and both
measurement obligations the architecture substituted for mechanism were actually discharged at
Gate 7.5 (p95 6.33 ms for the per-poll derivation, p95 83.2 ms for `/api/runs` at N = 1 000,
`08-validation.md:10375`, `:10415`).

What this review finds instead is a cluster around **the guards, not the code**: the three controls
the architecture explicitly chose *in place of* building mechanism — ADR-054's golden key-set test,
ARCH-122's page-source pins, and ADR-052's single equality assertion — are the three that did not
land with the shape their own ADR/ARCH row promised. That is the failure mode this lens exists to
catch, because "simpler of two equals" (ADR-054's own words) is only true while the cheap half
actually delivers the property.

Recorded residuals are **not** re-reported as findings. ADR-051's F-2 (the newly-anonymous lane
membership of the pre-v26 grandfathered cohort), B-1 and B-2, ADR-052's deferred `?workflow=`
filter, ARCH-129's pre-v27 descriptor cohort and ADR-049's "client `.js` is not type-checked" are
all decisions on the record with their consequence stated; §4 argues the live lens conflicts among
them, but none of them counts toward the violation count.

---

## 1. Findings

### F-1 (HIGH, security × testability) — ADR-054 / INV-V27-7: the disclosure key-set control asserts a fixture against itself, and two endpoints this delta widened carry no row at all

**Violated:** INV-V27-7 (「every `/api/*` response's top-level key set is enumerated in one test
whose SHAPE — exact set equality that fails on additions — may not be relaxed」), ADR-054 decision
(b) (「`tests/integration/dashboard-disclosure.test.ts` enumerates the key set for every `/api/*`
route **including `GET /api/runs/:id/agents/:agentId`**」).

**Evidence:**
- `tests/integration/dashboard-disclosure.test.ts:36-43` — the one key-set case iterates
  `DISCLOSURE_TABLE` and computes `Object.keys(row.body)`. `row.body` is a **hand-written fixture**,
  not a response: `tests/fixtures/dashboard-wire.ts:125-131` builds all six rows from the local
  consts `AGENT_LOG_OK`, `AGENT_LOG_FACADE_ERROR`, `RUN_SUMMARY_PRICED`, `RUN_SUMMARY_NO_RECORDS`,
  `DAG_PAYLOAD`, `DEGRADED_BODY`. The test therefore asserts a fixture's keys against the allow-list
  sitting beside it in the same file. No production code is a subject of that assertion.
- The `satisfies` lock does not close it either: an *added* optional field on a route type leaves
  every fixture still satisfying it, so `tsc --noEmit` stays green too.
- Coverage, **scored against ADR-054's own v27b budget rule** (「a key-set test is owed by the
  endpoint whose key set THIS delta changes」) so the finding cannot be discounted by citing it:
  six rows cover `run_agent_log` (ok / facade-error), `RunSummary`, the DAG payload and the generic
  degraded body. Two endpoints **this delta widened** are still unpinned:
  - `/api/home` — ARCH-126 added `avgCostUSD` and `unpricedRuns` to its `WorkflowMetrics`
    (`src/dashboard.ts:101-102`, `:170-174`). No row, fixture or live.
  - the HTTP `GET /api/runs/:id/agents/:agentId` — the one route ADR-054 names by URL, widened with
    `record` (ARCH-131). Its body is shape-identical to `run_agent_log` by construction (the same
    facade call, `src/server.ts:563`), but *that is an argument, not an assertion*: no key check on
    the HTTP body exists, live or fixture, so the day the route stops being a pass-through nothing
    goes red.
  - Out of budget per the v27b amendment and therefore **noted, not counted**: `/api/workflows`,
    `/api/workflows/:name/describe`, `/api/runs/:id`, `/api/system`, `/api/models`, `/api/issues`,
    `/api/status`. INV-V27-7's 「every `/api/*` response」 wording and the budget rule disagree; the
    budget rule is the later and more specific text, so it wins.
- The one genuinely live key-set assertion in the repo is `tests/integration/dag-masking-auth.test.ts:318-319`,
  which checks the real DAG payload's keys against `ALLOWED_DAG_KEYS`/`REQUIRED_DAG_KEYS`. It exists
  because INV-V27-9's parity case needed it, not because the disclosure table provides it — and it
  covers exactly one of the four enumerated shapes.

**Failure scenario (concrete).** An author adds a field to `AgentRecord` — say the `principal` that
`RunStatusView` already carries, or a `workspace` path — and returns it through
`mcp-facade.ts:713`'s one return object (`record: agent`). `/api/runs/:id/agents/:agentId` is
dispatched *before* any auth check and is reachable by anyone who can reach the port
(`src/server.ts:1284-1294` posture, only the Host/Origin allowlist in front). The new field ships to
that anonymous surface, and the entire v27 test suite stays green: the fixture in
`dashboard-wire.ts` was not edited, so its key set is unchanged.

**The HIGH rests on the first bullet alone.** The fixture-vs-fixture subject is a defect of *shape*,
not of coverage: it holds for all six existing rows regardless of which endpoints are in or out of
the v27b budget, and no amendment addresses it. The coverage half above is the smaller, second
complaint.

**Why HIGH.** ADR-054 refused option (a) — a real `dashboard-disclosure.ts` projection every payload
passes through — on the explicit ground that (a) and (b) 「deliver the identical property」. They do
not, as built: (a) would have been in the request path and could not have been bypassed by *not*
editing a fixture. This is the *only* named control for a security property (「was the widening a
decision or an accident」) on a surface the architecture itself describes as answering anyone who can
reach the port, and v27 widened that surface three times. REQ-136's own confidentiality oracle in
the same file **is** asserted against the real response body on both transports
(`:114` onward) — which is exactly the shape the key-set half needed and did not get.

**Smallest correct repair** (stated so Gate 8 does not over-build): keep option (b), but make the
subject real — the disclosure test already boots a real server for the REQ-136 case; assert
`Object.keys(await res.json())` from that same booted instance for each route, and add the missing
rows. No new module, no projection layer.

---

### F-2 (MEDIUM, testability × module boundary) — ADR-049 / ARCH-124: `DOM` and `allowJs` were added to the root tsconfig, which ADR-049 refused by name

**Violated:** ADR-049 Consequences (「`allowJs`/`checkJs` and a `DOM` lib are **deliberately NOT
added** to the root tsconfig, because that would make `document` a known global in server code」) and
ARCH-124's note (「without adding `DOM` to a root `tsconfig.json` whose `"lib":["ES2022"]` is what
stops server code from thinking `document` exists」).

**Evidence:** `tsconfig.json:7` → `"lib": ["ES2022", "DOM", "DOM.Iterable"]`; `tsconfig.json:8` →
`"allowJs": true`. There is exactly one tsconfig in the repo (`ls tsconfig*.json`), `include` is
`["src","tests","vitest.config.ts"]`, and there are no project references, so the change applies to
the entire server tree. IMPL-229 (06-impl-log.md:4481-4547) landed it at `ddc4409` and disclosed the
trade honestly — 36 `tsc --noEmit` errors → 0 — but no ADR-049 amendment, no ARCH-124 amendment and
no `superseded_in_part:` marker was written, so the architecture still asserts a guard that no longer
exists.

**Failure scenario.** Server-side code in `src/` may now reference `document`, `window`,
`localStorage`, `HTMLElement` and `getComputedStyle` and type-check clean; the failure surfaces at
runtime in Node as `ReferenceError`, on the engine host, at whatever hour the branch is first taken.
The compile-time control ADR-049 named as the reason not to do this is simply gone, repo-wide, and
no replacement grep-guard was added (`no-skeleton-surface`/`no-retired-surface` walk `.js` for
forbidden *words*, not for DOM globals in server modules).

**Lens note.** This is the one place where testability and the module boundary genuinely fight:
the acceptance tier's `page.evaluate(() => document…)` callbacks are *source text in a `.ts` test
file* and do need DOM types. That is a real constraint, not an excuse — but the architecture's own
answer (the client is plain `.js`; type safety is *relocated* to `tests/fixtures/dashboard-wire.ts`)
was written precisely to avoid paying repo-wide for it. The scoped answer is a **second config** —
a `tsconfig.tests.json` that `extends` the root with `lib` widened and `allowJs` on, with
`npm run build` / `typecheck` running both (or a project-references pair), which is exactly the
「per-tree override」 IMPL-229 correctly observed does not exist *under one tsconfig*. What does **not**
work, stated so nobody tries it on this finding's authority: a `/// <reference lib="dom" />` in the
acceptance files — a lib reference is program-global in `tsc`, so it widens `src/**` identically to
the root config. Recording the deviation; the repair sketch is a sketch.

---

### F-3 (MEDIUM, testability) — ARCH-122: the served shell's markup is discarded by the client before first interaction, so the C1/C2 page-source pins assert bytes no browser ever renders

**Violated:** ARCH-122 `api:`/`note:` — the shell is specified as emitting 「the nav with the source
tag, the four tab shells, the `#dag-zoom` / `#dag-graph` / `#dag-fit` anchors, `#run-usage`,
`#diagram-zoom` / `#diagram-img[draggable="false"]`, the `.card` / `.t` / `.tag` / `.btn` component
classes, and the slide-in panel's empty container」, with C1's literal pins 「still assertable here」.

**Evidence:**
- `src/dashboard/ui/app.js:427` — `document.body.replaceChildren(nav, routeMount, buildFooter())`.
  Every server-rendered element is removed from the document on `mountApp()`; the route container
  the views mount into (`#app-view`, read at `app.js:376` and `:395`) is *client-built*, not part of
  the shell.
- `src/dashboard-page.ts:92-150` — what the shell actually emits is the **pre-v27 page body**:
  `<h1>Remote Workflow Engine — Live Dashboard</h1>`, the `Runs`/`Issues` links, and the
  `#home` / `#detail` / `#issues` sections with `#phases`, `#tree`, `#harness-table`, `#transcript`.
  There is no nav source tag, no four-tab shell, no slide-in panel container, and the component
  classes are the retired `.cards` / `.pill`, not `.card` / `.t` / `.tag` / `.btn`. The file's own
  header comment (`:1-8`) describes the intended shell.
- **Checked, not assumed, before calling it undisclosed:** the only row that owns this file is
  IMPL-222 (`06-impl-log.md:4083-4124`, TASK-205, `files: src/dashboard-page.ts`). Its verification
  enumerates the `<head>`/script/island clauses only — `data-theme="dark"`, exactly one
  `application/json` island, the three asset references, the `<style>` deletion — and never checks
  the emitted **body** against ARCH-122's list. `grep -n replaceChildren 04-design.md` → 0 hits, so
  DES-200/DES-201 do not sanction the swap either. The gap is undisclosed at both 02 and 04.
- Consequence for the pins: `tests/unit/dashboard-page-source.test.ts:38` asserts
  `DASHBOARD_HTML` matches `<img id="diagram-img"[^>]*draggable="false"` — on markup that
  `app.js:427` deletes. The live `<img>` is built at `src/dashboard/ui/workflow.js:151-154`
  (`img.draggable = false`), a file the pin does not read.

**Failure scenario.** Delete `img.draggable = false` from `workflow.js:154`. `dashboard-page-source.test.ts`
stays green (its subject still contains the attribute), and the REQ-129 / D10 defect VAL-189 recorded —
a default-draggable `<img>` hijacking the pan gesture — regresses. The same holds for `#dag-fit`,
`#dag-zoom`, `#dag-graph` and `#run-usage`: the page-source pin proves the shell string, the browser
uses the client-built element.

**Mitigation that keeps this MEDIUM rather than HIGH** (measured, not assumed): the *behaviour* is
still guarded at the real tier exactly where ADR-053 says it should be —
`tests/acceptance/val-197-diagram-drag-pan.test.ts:119-123` drives a real press-and-move against the
LIVE `#diagram-img` in Chromium, and `val-193-dag-fit-and-columns.test.ts:114-140` hit-tests the live
`#dag-fit` with `elementFromPoint`. So the guarantee holds; what has failed is the *unit pin's*
claim to guard it. The two CSS pins were honestly re-pointed to `clientFile('dashboard.css')` at
v27c (`dashboard-page-source.test.ts:29`, `:42`, disclosed in IMPL-223); the markup pin was not, and
ARCH-122's note — which still says these stay 「assertable here」 — was never amended.

**Secondary, same root cause:** a `/static/dashboard/ui/app.js` that 404s (ARCH-123's own
missing-file degrade path) or is blocked leaves the operator looking at a fully-rendered *retired*
dashboard rather than at an error — the failure is silent and looks like a working product.

---

### F-4 (LOW, scalability × boundary) — ARCH-125 / `poll.js`: `endpointsFor(view)` is no longer the visible view's fetch set

**Violated:** ARCH-125 `api:` — 「`poll.js` — `endpointsFor(view) → string[]` (the fetch set of the
VISIBLE view only)」 and the note's 「Per-view fetch scoping **is** the polling budget」.

**Evidence:** `src/dashboard/ui/poll.js:17-19` declares the `run` view's set as the single
`/api/runs/:id/dag`. `src/dashboard/ui/run.js:471-489` (`onTick`) then issues its own
`getJSON('/api/runs/' + runId)` **every tick**, plus a one-time `/api/runs` and a one-time
`/api/workflows/:name/describe`. The run view's real steady-state budget is 2 requests per tick, not
1; the banner at `run.js:462-464` discloses it, but the architecture's single-source-of-truth
property is gone.

**Why it still matters (and why only LOW):** REQ-142's visibility gate attaches to `app.js`'s one
scheduler, and these fetches happen *inside* the tick it drives, so pausing the tick still pauses
them — the future attachment point survives. The cost is that no one can read the polling budget out
of one pure function any more, which was the testability half of the reason `endpointsFor` exists.
Note also that `/api/runs` — the unbounded list ADR-052 flagged — is now reachable from two views
(`poll.js:22` for `workflow`, `run.js:477` once per run-view mount).

---

### F-5 (LOW, scalability × concurrency) — ARCH-127: `BACKFILL_PER_TICK` bounds a *call*, not the process, and the memo that makes it one-time is written after the await

**Violated:** ARCH-127 `api:` — 「at most `BACKFILL_PER_TICK = 25` runs per call, **so the first list
after the upgrade is bounded** and the rest heal on later ticks」.

**Evidence:** `src/run-manager.ts:823-885`. `listSummaries()` is not single-flight; `_runs`-miss rows
are healed inside the loop, and `this._usageBackfillChecked.add(row.runId)` runs only *after*
`await this._store.getRun(...)` and `await this._store.backfillUsage(...)` resolve (`:866`, `:871`).

**Failure scenario.** k dashboard tabs poll `/api/home` and `/api/runs` every 3 s. On the first list
after an upgrade with a large legacy cohort, all k callers see the same un-memoized rows and each
performs the same up-to-25 `getRun` (a full transcript read for a snapshot-less run) plus a
`backfillUsage` write. The work is k × 25 per tick, not 25; correctness survives only because
`backfillUsage` is idempotent (ARCH-128's convergence property) — the bound the architecture claims
does not.

**Second, smaller half:** `_usageBackfillChecked` (`run-manager.ts:323`) is an unbounded `Set<string>`
that only ever grows, for the lifetime of the process, at one entry per terminal run ever listed.
ADR-051 wrote the rule for exactly this shape in the neighbouring case — 「a memo keyed
`` `${name}@${version}` `` is pre-approved **with a bound** (LRU 64, or evict on REQ-026 catalog GC)
… **an unbounded map is not**」. The same bound is owed here and was not applied. (It is LOW because
growth is O(runs) and each entry is a run id — a 100 k-run engine pays single-digit MB, not a leak
that ends the process.)

---

### F-6 (LOW, consistency) — ARCH-128: the convergence argument rests on an unstated single-process / synchronous-driver assumption

**Violated:** ARCH-128 note (1) — 「**Convergence:** in either order the row ends identical」.

**Evidence:** `src/store/sqlite-run-store.ts:310-322`. `backfillUsage` is a three-statement
read-modify-write — `SELECT status FROM runs`, `SELECT json FROM run_snapshots`, then
`INSERT OR REPLACE INTO run_snapshots` — with **no transaction**. It is safe today for one reason
the architecture never states: better-sqlite3 is synchronous and the function body contains no
`await`, so nothing can interleave inside a single process.

**Failure scenario (the one the claim does not cover).** Two engine processes on the same database
file — the shape the 「horizontal scaling」 question asks about, and one the architecture nowhere rules
out. Process A's `saveSnapshot` writes the full authoritative snapshot between process B's second
`SELECT` (which saw no row, or a usage-less row) and B's `INSERT OR REPLACE`. B then replaces the
authoritative snapshot with a `{usage}`-only object, and `getRun`'s `??` fallbacks silently
re-derive `agents`/`phases` from transcripts from then on. Wrapping the three statements in
`this._db.transaction(...)` is a one-line close; alternatively the architecture should state the
single-writer assumption the claim actually depends on. Recorded rather than escalated because the
product is a single self-hosted process today.

---

### F-7 (LOW, long-lived-tab hygiene) — ARCH-125: `initZoomable` adds three permanent `window` listeners per shell build and removes none

**Violated:** ARCH-125 note — 「**listeners are delegated** on the stable wrappers — a tab left open
for days must not accumulate one handler per node per 3-second rebuild」, and the NFR-ownership
paragraph's 「page weight and long-lived-tab hygiene → **ARCH-125**」.

**Evidence:** `src/dashboard/ui/run.js:115`, `:116`, `:118` — `window.addEventListener('mousemove'…)`,
`('mouseup'…)`, `('resize', fit)`, inside `initZoomable`, with no teardown. `initZoomable` is called
once per shell build: `run.js:434` (run view), `workflow.js:119` and `workflow.js:172` (the workflow
view builds **two** zoomables).

**What is NOT wrong, measured:** the per-tick accumulation the architecture actually names does not
happen — `render()` builds the shell once (`run.js:449`) and `onTick` never rebuilds it, and every
per-node handler in `run.js:169` is delegated on the stable `.cell-layer`. `home.js:111` /
`workflow.js:207`/`:222` attach to freshly created elements that are discarded with their parent, so
nothing accumulates there either.

**Failure scenario.** An operator navigating home → workflow → run → home for a day adds 3 (run) or
6 (workflow) `window` listeners per mount, none removed, each closing over a detached `el`, so the
whole discarded subtree stays reachable. Bounded by navigations, not by time — hence LOW.

---

### F-8 (LOW, testability) — INV-V27-1 / ADR-052: the lock's specified oracle substitutes a *priced* call for the *terminally-failed* one, at both tiers

**Violated:** INV-V27-1 (「The lock is an integration assertion that `/api/runs[i].costUSD ===
/api/runs/:id.usage.costUSD` **for a run containing both a terminally-failed call and an unpriced
call**」) and ADR-052's identical Consequences sentence (「the acceptance test is the equality
assertion over a run containing both a terminally-failed call and an unpriced call — the two cases
that split the folds last time (v26 R-1)」).

**Evidence:**
- Integration tier: `tests/integration/usage-live-equals-fold.test.ts:25-31` — the injected
  `FAKE_GATEWAY` returns `ok: true` on **both** branches; the `unpriced` label differs only by an
  unrecognized model name. The fixture's own comment (`:23-24`) reads 「One **priced** (known model)
  + one deliberately unpriced (unrecognized model) call per run — the two cases that split the folds
  last time (v26 R-1)」, i.e. the substitution was made knowingly and the invariant's phrase was
  rewritten around it. Neither of the file's two cases (`:72`, `:88`) produces a terminally-failed
  agent record.
- Real tier: VAL-205's evidence (`08-validation.md:10403-10409`) records the IEEE-754-identical
  `costUSD` across both routes — a genuine and valuable proof — but on a run with
  `unpricedCalls: 0` on both, so neither the unpriced nor the failed branch was exercised there
  either.

**Failure scenario.** A terminally-failed `agent()` call whose partial `usage` is counted by the
live fold and dropped by (or double-counted against) the at-rest projection ships with CI green —
which is the *exact* class of v26's R-1, the defect ADR-052 names as the reason this oracle exists.

**Why only LOW.** ARCH-127's design makes the equality structural rather than arithmetic: both
routes overlay `foldUsageFromRecords` (`run-manager.ts:242`, called at `:833` and at `_mergeLive`
`:940`), and the terminal path reads back the snapshot the *same* fold wrote at `:1117`. So the
divergence the missing case would catch is hard to reach by construction — which is the architecture
working. The deviation is that the named oracle is not the one implemented, so the "by construction"
claim is asserted rather than witnessed. One-line repair: give `FAKE_GATEWAY` a third label that
returns `ok:false`, and add it to the existing case's script.

---

## 2. Verified-clean (stated so the next reviewer does not re-derive it)

| Architecture row | Status at ef0a400 |
|---|---|
| ARCH-123 (closed asset map, never a path join) | **Clean.** `src/static-assets.ts:18-27` is a literal `ASSET_KEYS` array; `lookupStaticAsset` (`:60-62`) is a bare `Map.get`; no `join`/`normalize`/`decodeURIComponent` in the module. Key set is closed in both directions and `tests/unit/static-assets.test.ts` diffs it against `readdirSync`. woff2 → `immutable`, js/css → `no-store` (`:38-44`). Missing file → 404, never a throw (`server.ts:1296-1307`). |
| ARCH-130 (1) route posture | **Clean.** `server.ts:1288` sits after the Host/Origin gate (`:1084`) and before the `/dashboard` catch-all (`:1322`); non-GET → 405 (`:1289-1292`); the 404 never echoes the requested key. `X-Content-Type-Options: nosniff` was added beyond spec — a hardening, not a deviation. |
| ARCH-130 (2) mask reversal | **Clean.** `if (!authEnabled)` is gone; `deriveLanes(view.phases, expectedGraph, { status: view.status })` at `server.ts:570`; one shared `PREDICTED_OVERLAY_UNAVAILABLE` const (`:502`, used at `:523`/`:556`/`:564`); every push is inside its own catch; `PREDICTED_FROM_FALLBACK_VERSION` (`:517`) carries `pinned=${view.scriptVersion}` per the DES-198 correction and emits **no** journal line, as specified. |
| ARCH-130 (3)(4) CSP + degraded log | **Clean.** `server.ts:1332` is the specified string byte-for-byte, `blob:` included. `dashboard_api_degraded` at `:524`, `:557`, `:565`, `:615`, `:1103`, with `reason` in the closed set and free text under `detail`. |
| ARCH-129 / INV-V27-2 | **Clean, and better than specified.** One decoration site (`agent-executor.ts:651-667`); order is strip → `redact()` → `capPrompt` (`:685-687`); `stripFirstSegment` (`params/resolve.ts:195-201`) **fails closed** — a gateway echoing something else yields `prompt: ''` plus a `harness_prompt_prefix_mismatch` line, never the composed blob. `grep "kind: 'harness'" src/` → one writer. Proven against the real response body on both transports (`dashboard-disclosure.test.ts:114`). |
| ARCH-124 purity | **Clean.** No `document`/`window`/`fetch`/`localStorage` in `src/dashboard/lib/**` (only the word in comments); one intra-directory import (`agent.js:5`). `theme.js` carries `PREF_KEYS`/`clampHue`/`prefsFromStorage(get)` per the amendment, never `accentVars`. Eight of nine lib modules have a `.js` unit test; `status.js`'s is UT-241 in `tests/unit/update-outcome-config-check.test.ts`. |
| ARCH-125 D5/D6/C2 + amendments | **Clean.** `grep innerHTML|insertAdjacentHTML|outerHTML|new Function|eval(` over `src/dashboard/` and `src/dashboard-page.ts` → **0 hits**. `grep setInterval src/dashboard/` → 0 (only the comment explaining its absence). Transform on the wrapper (`run.js:101`), children rebuilt. `warningText` lives in `lib/strings.js:56`, and `ui/` contains no `split(': ')`. Predicted-cell predicate is `kind === 'agent' && agentId === undefined` (`run.js:258`, `:281`). Agent panel: `?limit=500` (`agent-panel.js:233`), `hasMore` read (`:241`), `EVENT_CLIP = 2048` (`:37`). C2 `.card`/`.t` survive on the client-built elements (`home.js:78`, `:95`). |
| ARCH-126 | **Clean.** `deriveLanes` (`dashboard.ts:267-282`) has no `masked`, returns a dense re-indexed `lanes`, never clamps `current`, and gates `current` on the live-status set. `avgCostUSD` is `null` and never `0` (`:170-174`). `predictedLanes` lives in `dashboard.ts` (`:292`), not the facade — the C3/ADR-048 lexical reason holds. |
| ARCH-127/128 (correctness half) | **Clean.** Precedence chain live → snapshot → one-time fold → absent, in that order, in one method (`run-manager.ts:828-884`); both `/api/home` and `/api/runs` read it (`server.ts:362`, `:388`). Store side is ONE `LEFT JOIN` with `json_extract` (`sqlite-run-store.ts:330-348`, reused verbatim by `list()` at `:375`), presence keyed on `usage IS NOT NULL AND COALESCE(agentCount,1) > 0` rather than on arithmetic (`:265`) — never a silent `costUSD: 0`. `backfillUsage` re-checks terminal ∧ no-usage in the store itself (`:311-317`). INV-V27-1's lock exists as IT-167/VAL-205 and is real (real SQLite + real HTTP, equality asserted on the same run) — **but see F-8: its fixture is not the run the invariant specifies.** |
| ARCH-131 | **Clean.** `record: agent` on the one return object (`mcp-facade.ts:713`); `phases[].agents` unconditional; `maskPredictedOverlay` absent from `src` and `tests`. |
| INV-V27-3 | **Clean.** Three `<script>` tags, one classic + one module + one `application/json`; `<` escaped in the island (`dashboard-page.ts:81`); `tests/unit/dashboard-no-external-host.test.ts` walks `src/dashboard/**/*.{css,js}` for hosts and `url()` targets. |
| INV-V27-5 | **Clean.** `app.js:70-106` reads `#rwe-init` and renders version, update outcome, `configCheck` and the interrupted-runs CTA; UT-241 covers the four branches. `configCheck` is an enum outcome (`update-types.ts:18`), not a filesystem path — no secret-adjacent string on the anonymous page. |
| INV-V27-8 | **Clean.** Both guards walk `.ts`, `.js` **and** `.css` (`no-skeleton-surface.test.ts:62`, `no-retired-surface.test.ts:30`), each with a planted-`.js`-violation self-case. |
| INV-V27-9 | **Clean, and the strongest control in the slice.** `dag-masking-auth.test.ts:298-338` — exclusion-form parity minus `[runId, terminalAt]` with `current` compared, plus positive anchors on the AUTH server (`:324-326`) so it cannot pass vacuously, plus the scoped `describe.phases` parity at `:240-252`. |
| Karpathy tie-breaker | **Honoured.** Every "Not built" list held: no ETag/304, no content hashing, no compression, no build step, no framework/router, no `runs.cost_usd` column, no SQL metrics aggregate, no `(runId,reason)` dedupe Set, no derivation memo. Both pre-approvals stayed un-exercised **because the number was actually taken**, which is the discipline working. |

---

## 3. Where the three lenses genuinely conflict (argued, not smoothed over)

**(i) `style-src 'unsafe-inline'` — security concedes to fidelity, and the architecture is right to
say so out loud.** ARCH-130's own note calls it 「the honest floor, not an oversight」. My security
lens wants it gone: with `'unsafe-inline'` on styles, an injected `style` attribute is still a
usable exfiltration primitive on a page that renders operator-authored workflow names, agent labels
and provider `detail` strings. The counter that decides it is empirical, not rhetorical: every one
of those strings reaches the DOM through `textContent` (0 `innerHTML` in the whole client tree), and
the delivery genuinely leans on inline `style="…"` (`workflow.js:150`, `run.js:272`). Claiming
`style-src 'self'` while shipping inline styles would be a *false* policy — strictly worse than a
true weak one, because the next reader would trust it. **Security concedes, on the condition the
`textContent`-only rule stays mechanically checkable.** It currently is (one grep); that grep is not
in CI as a test. Cheapest hardening available, if Gate 8 wants one: promote the `innerHTML` grep to
a unit guard beside `no-external-host`.

**(ii) The mask reversal (ADR-051) — security conceded to observability, by the owner, with the
residual named.** This is not a finding and I will not relitigate it: the owner ruled 「開 —— 撤銷遮罩」,
the reversal was implemented as four *deletions* rather than four `false`s (which is the correct
shape — a constant-valued branch decays), and the replacement control (INV-V27-9 parity) is strictly
stronger than what it replaced, because it goes red on *any* field that starts differing by
deployment, not just the one that was masked. My lens's only remaining unease is the honest limit
the invariant states itself: parity catches leaks that differ *by deployment*; a field that leaks
identically on both servers is INV-V27-7's job — **and INV-V27-7 is F-1**. That is the real cost of
F-1 and the reason I graded it HIGH rather than MEDIUM: the two disclosure controls were designed as
a pair covering complementary halves, and one of the two halves is a fixture asserting against
itself. The synthetic `{kind:'auth-disabled'}` principal on `server.ts:563` remains a correctly
*recorded* pattern with no current instance — leave it recorded.

**(iii) Unbounded `/api/runs`, polled by two views every 3 s — scalability conceded to simplicity,
and the concession was paid for.** ADR-052 deferred the `?workflow=&status=&limit=` surface and
substituted a measurement. The measurement was actually taken (`08-validation.md:10415`:
`/api/runs` p50 = 68.3 ms / p95 = 83.2 ms, `/api/home` p50 = 64.9 ms / p95 = 73.9 ms at N = 1 000).
At k = 5 viewers on a 3-second timer that is ~1.7 req/s and ~140 ms/s of server CPU — comfortable,
and the right call: shipping a bare global limit without the per-workflow filter would have emptied
an older workflow's REQ-133 history table, i.e. shipped a bug to fix a non-problem. **Scalability
concedes, and says so with a number.** Two riders, both already in the record: the complexity class
is unchanged since v8, and F-4 quietly added a second view to that endpoint's caller set.

**(iv) Plain-JS client vs. type safety — testability won the trade, then F-2 spent the winnings
repo-wide.** ADR-049's bargain was coherent: give up `tsc` over the client, buy real unit tests over
the exact bytes the browser runs (eight `.js` unit suites now import `src/dashboard/lib/*` directly —
this genuinely works, and it is the single biggest testability gain in the slice). The bargain
explicitly *priced in* keeping the server program DOM-free. F-2 then paid a second time, on the
server's behalf, for a problem that belongs to four acceptance files. The conflict is real and the
tie-breaker settles it: the minimum architecture that solves 「acceptance tests need DOM types」 is a
DOM lib scoped to those tests — not to `src/**`.

**(v) The meta-conflict this review is really about.** Three times in v27 the architecture chose the
cheap half of a pair on the argument that it delivers an identical property — ADR-054 (key-set test
over a projection module), ARCH-122/ADR-053 (page-source pins + real-Chromium proofs over
server-rendered truth), and ARCH-127/ADR-052 (one shared fold plus a single equality assertion, over
a second at-rest column). Each time the code shipped the *form* of the cheap half without its
load-bearing property: the key-set test's subject is a fixture (F-1), the pins' subject is markup the
client deletes (F-3), and the equality assertion's subject is not the run the invariant names (F-8).
That is
not an argument against simplicity-first — F-1's and F-3's repairs are both smaller than the options
the ADRs refused. It is an argument that 「simpler of two equals」 needs one line at Gate 6 naming
**what the cheap control's subject must be**, because the cheap control is exactly the one whose
subject is easy to get wrong while every test stays green.

---

## 4. Summary

| # | Severity | Lens | ARCH / INV | Evidence (HEAD ef0a400) |
|---|---|---|---|---|
| F-1 | HIGH | security × testability | ADR-054, INV-V27-7 | `tests/integration/dashboard-disclosure.test.ts:36-43`; `tests/fixtures/dashboard-wire.ts:125-131` |
| F-2 | MEDIUM | testability × boundary | ADR-049, ARCH-124 | `tsconfig.json:7-8` |
| F-3 | MEDIUM | testability | ARCH-122 (C1/C2 pins) | `src/dashboard/ui/app.js:427`; `src/dashboard-page.ts:92-150`; `tests/unit/dashboard-page-source.test.ts:38` |
| F-4 | LOW | scalability × boundary | ARCH-125 | `src/dashboard/ui/poll.js:17-19` vs `src/dashboard/ui/run.js:471-489` |
| F-5 | LOW | scalability × concurrency | ARCH-127 (+ADR-051's bound rule) | `src/run-manager.ts:823-885`, `:323` |
| F-6 | LOW | consistency | ARCH-128 note (1) | `src/store/sqlite-run-store.ts:310-322` |
| F-7 | LOW | performance / hygiene | ARCH-125 | `src/dashboard/ui/run.js:115-118`, `:434`; `src/dashboard/ui/workflow.js:119`, `:172` |
| F-8 | LOW | testability | INV-V27-1, ADR-052 | `tests/integration/usage-live-equals-fold.test.ts:23-31`; `08-validation.md:10409` |

**consistent: no — 8 violations (1 HIGH, 2 MEDIUM, 5 LOW).**
Recorded residuals deliberately excluded from the count: ADR-051 F-2 / B-1 / B-2, ADR-052's deferred
list bound, ARCH-129's pre-v27 descriptor cohort, ADR-049's un-type-checked client internals.
