---
stage: review (Gate 8) — RE-REVIEW #2
lens: adversarial group — (a) security, (b) scalability/performance, (c) testability;
      Karpathy simplicity-first as the tie-breaker
iteration: v27 (closure REQ-131..136, REQ-140, REQ-141), after the v27g/h/i/j send-back repairs
subject: 02-architecture.md §v27 (ARCH-122..131, ADR-049..056, INV-V27-1..9) as amended at v27b/v27h
         vs. the code named on the `files:` lines of 06-impl-log.md IMPL-221..276
measured at: HEAD ced73ff — every file:line below is a HEAD line number, NOT the architecture
             document's own (those are pinned at eb387a1/07266be and are stale by design)
verdict: NOT CONSISTENT — 3 deviations (0 HIGH, 1 MEDIUM, 2 LOW)
---

# Adversarial review #2 — v27 architecture vs. implementation, after the send-back

**Bottom line.** All thirteen first-pass blocking findings are genuinely closed, and I re-opened the
eight that live in code rather than in prose. The repairs are the *subject* changes the retro asked
for, not re-words: the disclosure key-set table now harvests eight real served bodies from a booted
server before it asserts anything (`tests/integration/dashboard-disclosure.test.ts:75-114`), the
usage-equality oracle now runs a script that really contains a terminally-failed call and an
unpriced call (`tests/integration/usage-live-equals-fold.test.ts:30-40`, `:81-94`), the tab switch
really moves the ONE poll timer's target (`src/dashboard/ui/app.js:185`), and the clock really left
the pure directory (`grep` over `src/dashboard/lib/` for `Date`/`document`/`window`/`fetch`/
`localStorage`/timers → **0 hits**). `tsc --noEmit` exits 0; the four files I ran directly are
27/27 green.

What this pass finds instead is **the residue of the repair round itself** — the same class the
round was convened to fix (「an architecture row asserting something the tree contradicts」), left
in three places the v27h synthesis did not re-open:

1. the v27h amendment to ARCH-124 installed a *necessary condition* on the connection tag
   (「`live` only when EVERY one of them is `ok`」) after reasoning only about the MIXED tick — and
   the shipped reducer breaks that condition on the UNANIMOUS-fail tick, in the direction the owner
   ruling explicitly outlawed (**F-1, MEDIUM**);
2. `ui/theme-init.js` carries a second copy of a `lib/` formula that no test pins, under a comment
   claiming a pin that does not exist (**F-2, LOW**);
3. two more ARCH rows enumerate closed file lists the tree has grown past; the round's own
   housekeeping acknowledged exactly one of the three (**F-3, LOW**).

**Recorded residuals are not re-reported.** F-4 (`endpointsFor` is no longer the whole run-view
budget), F-5 (`BACKFILL_PER_TICK` bounds a call, not the process; the memo is written after the
await), F-6 (ARCH-128's unstated single-synchronous-writer assumption), F-7 (`initZoomable`'s three
permanent `window` listeners), DEBT-A, DEBT-B and DEBT-C all still hold at HEAD — I re-checked each
— and all are on 07-review.md §9 with their consequence stated. §3 argues where they compose; none
counts toward the violation number.

**Declared-and-owed is not violation, and I am not counting it.** `tsconfig.server.json` does not
exist, `package.json:8` / `:11` are still a bare `tsc --noEmit`, and the pre-v27 fossil body still
stands at `src/dashboard-page.ts:92-152`. Both rows say so in their own text — ADR-049's 「the split
has NOT landed … the property is UNGUARDED」 and ARCH-122's 「removed by the TASK-A follow-up」 — and
both have a TASK row on the ledger (`03-tasks.md:1837` TASK-215, `:1846` TASK-216, both
`status: draft`, neither marked done). A row that tells the truth about the tree and names the work
is the correct shape for owed work; counting it would punish the honesty. **Verified, because an
owed item marked done WOULD count:** both statuses are `draft`.

---

## 1. Findings

### F-1 (MEDIUM, security/observability × testability) — ARCH-124 (as amended v27h) and REQ-131 (as amended by owner ruling): the connection tag reports 「連線中 / Live」 on a tick in which EVERY route the visible view depends on failed

**Violated:**
- **ARCH-124 `api:` (amended 2026-09-13, v27h — AC-4's induced drift):** 「The tag is
  `worstOf(perRoute)` over the routes the VISIBLE view depends on: **`live` only when EVERY one of
  them is `ok`**」. The v27h amendment STRUCK the old 「any `ok` → `live` immediately」 half and left
  this one standing as the surviving clause.
- **REQ-131 acceptance (`01-requirements.md:1729-1731`, amended `:1732` by the owner ruling of
  2026-09-13):** 「目前分頁所依賴的 `/api/*` 路由**全部**取得成功 **Then** … 顯示「連線中 / Live」;
  **Given** 其中任一路由降級 … **Then** 顯示「降級」而**非**「連線中」」.

**Evidence (HEAD):**

```
src/dashboard/lib/connection.js:24-37   nextConnection(prev, tick)
  :27-29   worst === 'ok'            -> { status: 'live',     consecutiveFails: 0 }
  :30-33   !allFail                  -> { status: 'degraded', consecutiveFails: 0 }
  :34-36   allFail                   -> consecutiveFails = prev.consecutiveFails + 1
           status = consecutiveFails >= 2 ? 'offline' : prev.status     <-- HERE
```

On the first UNANIMOUS-`fail` tick the reducer returns `prev.status`. When the predecessor is
`live`, the nav tag keeps reading 「連線中 / Live」 for a full 3-second poll interval while **zero**
of the visible view's routes answered. `worst` is `'fail'` on that tick, so ARCH-124's own necessary
condition (`live` ⟹ every route `ok`) is false of the shipped state.

The behaviour is **test-pinned**, so it cannot self-correct:
`tests/unit/dashboard-lib-connection.test.js:49-54` — 「`live -> live` (not offline) after ONE
all-fail tick」, `expect(next.status).toBe('live')`.

**Why the debounce does not license it.** ARCH-124's other clause — 「`offline` only after ≥ 2
consecutive UNANIMOUS-`fail` ticks (REQ-131 says 連續失敗 — one transient miss during a self-update
restart must not paint the whole team's tabs red)」 — constrains the transition to **offline**, i.e.
to the RED tag. It does not require retaining `live`. The state machine already carries the state
that satisfies both clauses at once: `degraded` on tick 1, `offline` on tick 2. That is a one-branch
change (`prev.status` → `'degraded'`, and the counter keeps advancing), no new state, no new
mechanism — which is what the Karpathy tie-break asks for when two shapes deliver equal value and
one of them is already in the union type.

**Why this is the owner's own case, argued harder.** The ruling that KEPT the narrowing
(ARCH-124 `owner_decision:`, `01-requirements.md:1732`) grounds it in one sentence: 「tag 顯示
「連線中」而使用者正在看的那張表所依賴的路由其實正在降級,等於對操作者說謊 —— 與本 repo 既有的
「degrade, never pretend」立場一致」. The case this finding names is the same lie in its strictly
worse form: not one degraded route behind a healthy sibling, but **nothing answered at all**. The
narrowing was adopted to close a smaller hole than the one left open beside it.

**How it survived.** The v27h amendment says outright 「the two halves cannot both hold **for a
mixed tick**, so the review had already chosen which half survives; this amendment strikes the one
it left standing」. The analysis is correct and complete *for the mixed tick*. The unanimous-fail
tick was never re-read against the clause the amendment installed, and the AC-4 repair
(IMPL-271) did not touch `:34-36` — `git show ef0a400:src/dashboard/lib/connection.js:32-34` shows
the identical `prev.status` retention pre-repair. So this is not a regression the repair caused; it
is a pre-existing behaviour that the repair's new wording turned into a contradiction.

**Blast radius, stated so the severity is arguable rather than asserted.** One poll interval (3 s),
one nav tag, no data loss, no wrong number rendered — the tables themselves show stale data, which
is correct. It is MEDIUM and not HIGH because nothing durable is wrong; it is MEDIUM and not LOW
because the misstatement is the precise subject of the requirement, it contradicts a clause amended
**this round**, and the wrong expectation is locked into a unit test.

**Cheapest honest close (advisory, not a demand):** change `:35` to
`const status = consecutiveFails >= 2 ? 'offline' : 'degraded';` and flip
`dashboard-lib-connection.test.js:49-54` to expect `'degraded'` with `consecutiveFails === 1`.
If instead the behaviour is wanted, then ARCH-124's `api:` owes the third clause it is missing —
「a unanimous `fail` holds the previous tag for one tick」 — and REQ-131's middle clause owes the
same carve-out; either way one of the two must move, because today they disagree.

---

### F-2 (LOW, testability × replaceability) — ARCH-125 `note:` / ARCH-124: an undeclared, unpinned mirror — `clampHue` has two textually independent implementations, under a comment claiming a pin that does not exist

**Violated:**
- **ARCH-125 `note:`** — 「it may not decide anything a pure function could decide — **every formula
  it needs is imported from ARCH-124**, which is what keeps the mirror-pair class (five today,
  `as-is §A`) from growing by three」.
- **Decision rationale — v27, 「The server/client mirror pairs」** — 「The synthesis **removes the
  class instead of managing it** … So `SWIMLANE_BOX`, `accentVars` and the token sum have exactly
  one home each」, taken against QD R-2's single stated condition that 「an eighth mirror must not
  appear silently」.

**Evidence (HEAD):**

| fact | `lib/` home | `ui/theme-init.js` copy |
|---|---|---|
| `clampHue` | `src/dashboard/lib/theme.js:14-17` (`Number.isFinite`) | `src/dashboard/ui/theme-init.js:24-27` (global `isFinite`) |
| the three key literals | `theme.js:10` `PREF_KEYS` | `theme-init.js:12-14` |
| the `lang` and `hue` defaults (`zh` / `236`) | `theme.js:24-25` | `theme-init.js:42`, `:44` |

**Deliberately excluded from that table:** the *theme* value is NOT a mirror and must not be read as
one. `theme-init.js:31-35` runs the stored preference through `resolveTheme()`, so `'system'` (or a
corrupt value) resolves against live `matchMedia`, while `lib/theme.js:30` returns `storedTheme`
verbatim. Only the shared `'dark'`-when-absent default coincides; the rules around it genuinely
differ, because the pre-paint script has to answer a question the pure function is never asked.
That is a separate — and defensible — boundary fact, not a second copy of one rule, and counting it
would inflate this finding.

`src/dashboard/ui/theme-init.js:4-7` declares the duplication, but names **only the key literals**:
「the three localStorage key literals below are a deliberate COPY of `lib/theme.js`'s `PREF_KEYS`
values (DES-201's one surviving source pin — this is the only client file vitest cannot import as
ESM, **so its own unit test reads it as TEXT instead**)」.

**There is no such unit test.** `grep -rn "theme-init" tests/` returns exactly one line at HEAD:
`tests/unit/dashboard-page-source.test.ts:66`, which asserts that the *shell references the file*
(`expect(DASHBOARD_HTML).toContain('/static/dashboard/ui/theme-init.js')`) — it never opens
`theme-init.js`. So the one mitigation the architecture named for a duplication it could not remove
is absent, and the duplication is wider than the comment admits.

**Why this is not merely cosmetic, and why it is still only LOW.** The forced part is real —
ARCH-125's own amendment establishes that a classic blocking script cannot `import` an ESM module,
so the copy cannot be deleted, only *pinned*. What is left is the exact shape that shipped v21's
`effort` no-op and v22's forgeable frame: two implementations of one rule with no assertion tying
them together. The two already differ (`isFinite('236')` is `true`, `Number.isFinite('236')` is
`false`) — harmless today because the only call site passes `Number(hueRaw)` (`theme-init.js:44`),
i.e. the divergence is currently unreachable. LOW because the divergence is unreachable and the
worst outcome is a wrong accent hue, not a wrong number or a leak.

**Security note, recorded as clean rather than as part of the finding:** both copies are
*hardening*, and both do it correctly. `theme-init.js:44-48` coerces the stored hue with `Number()`,
clamps it to `[0,360)`, and writes it through `String(hue)` into `--rwe-hue`; `:47` normalizes
`lang` to the closed set `{en, zh-Hant}`. A hostile `localStorage['rwe-hue']` therefore cannot
inject a CSS token. That is the property that must not drift, which is why the missing pin matters
more than the missing prose.

**Cheapest honest close:** four lines in an existing `.test.ts` — read `clientFile('ui/theme-init.js')`
as text and assert it contains each of `PREF_KEYS`' three values and the same `((h % 360) + 360) % 360`
expression `lib/theme.js` uses. That is DES-201's own named mechanism, written down once.

---

### F-3 (LOW, consumability) — ARCH-123 `api:` and ARCH-125 `api:` enumerate closed file lists the tree has grown past; the v27h round acknowledged exactly one of the three rows carrying this defect

**Violated:** ARCH-123 `api:` — 「`STATIC_ASSETS: ReadonlyMap<…>` built once at module load from a
**LITERAL array of relative keys** — `ui/app.js`, `ui/theme-init.js`, `ui/poll.js`, `ui/home.js`,
`ui/workflow.js`, `ui/run.js`, `ui/agent-panel.js`, `lib/theme.js`, `lib/strings.js`,
`lib/connection.js`, `lib/swimlane.js`, `lib/runlist.js`, `dashboard.css`, `fonts/…`」 — and
ARCH-125 `api:` — 「`theme-init.js` … `app.js` … `poll.js` … `home.js` … `workflow.js` … `run.js` …
`agent-panel.js`」.

**Evidence (HEAD), measured rather than eyeballed:**

```
ARCH-123 enumerates 18 keys.  src/static-assets.ts:18-26 declares 26.
In the tree, absent from the row:  ui/models.js  ui/system.js  ui/issues.js  ui/dom.js
                                   ui/clock.js   lib/agent.js  lib/status.js lib/model.js
In the row, absent from the tree:  (none)

ARCH-125 names 7 files under src/dashboard/ui/.  The directory holds 12
(+ clock.js, dom.js, issues.js, models.js, system.js).
```

Every addition is legitimate and traced — `ui/clock.js` is the AC-7 repair itself (IMPL-274),
`ui/dom.js` is IMPL-248's de-triplication, `lib/model.js` is IMPL-251, and the three ported tabs are
TASK-212 (`03-tasks.md:1810-1817`, traced to ARCH-125 / ARCH-123 and the pre-v27 REQ-067/076/077/078,
**not** to the out-of-closure REQ-137/138/139 — I checked, the trace chain is intact and this is
non-regression work, not smuggled scope). Nothing here is a module that should not exist.

**The defect is that two `api:` lines state a closed set the tree contradicts** — AC-3a's exact
class, which this ledger just spent a send-back round blocking on. The v27h housekeeping note (6)
records the third instance and only the third: 「ARCH-124's `api:` still opens 「Five files」 while
`src/dashboard/lib/` holds **eight** … The count is named here so the next Gate 2 touch closes it
deliberately.」 ARCH-123 was **amended in this same round** (for the `cache` type literal) with its
stale key list left untouched; ARCH-125 was not re-opened at all.

**Why LOW and not lower.** Both directions of the map are mechanically locked by
`tests/unit/static-assets.test.ts` (a `readdirSync` diff: every listed key has a file, every file on
disk is a listed key), so nothing can ship unserved or unlisted — the *property* is enforced even
though the *prose* is stale. The cost is a reader's: ARCH-123 is the row a future contributor opens
to learn what the first path-traversal surface serves, and it under-reports it by eight files.

**Cheapest honest close:** stop enumerating. Replace both lists with 「the keys are exactly the
`.js`/`.css`/`.woff2` files under `src/dashboard/`, closed in both directions by
`tests/unit/static-assets.test.ts`'s `readdirSync` diff」 — one sentence that cannot go stale,
instead of a list that must be re-edited on every module split. That also retires ARCH-124's
「Five files」 debt in the same stroke.

---

## 2. Verified-clean (stated with evidence, so re-review #3 does not re-derive it)

**The eight code-side repairs, re-opened at HEAD rather than trusted from IMPL prose:**

| ID | Verified how |
|---|---|
| **AC-1** | `tests/integration/dashboard-disclosure.test.ts:75-114` boots a real server (`createServer`, real MCP over HTTP, real store; only the model provider is a stub at `:44-46`), drives two real runs, and harvests **eight** real bodies into `realBodies` — including the two endpoints the delta widened with no prior row (`GET /api/home` at `:105-106`, HTTP agent detail at `:92-93`). `:121-131` iterates `DISCLOSURE_TABLE` against those bodies with `expect(body).toBeDefined()` at `:124`, so a row with no captured body FAILS rather than passing vacuously. The allow/require sets are **hand-written string literals** (`tests/fixtures/dashboard-wire.ts:53-54`, `:62-63`, `:76-77`, `:96-97`, `:117-118`, `:124-125`), not derived from the route types — the oracle is independent of the code under test. REQ-136's three-conjunct proof (`:201-223`) asserts on the real BODY of both transports. |
| **AC-3b** | `tests/unit/dashboard-page-source.test.ts:43` pins `img.draggable = false` on `clientFile('ui/workflow.js')`; the element really is built at `src/dashboard/ui/workflow.js:151-154`. |
| **AC-4** | `worstOf` is exported AND called (`src/dashboard/lib/connection.js:9-15`, `:26`); the mixed tick returns `degraded` (`:30-32`) and resets the counter; the falsifying case exists at `tests/unit/dashboard-lib-connection.test.js:29-34`. *(The unanimous-fail arm is F-1 above — a different clause of the same row.)* |
| **AC-5** | `src/dashboard/ui/app.js:177` and `:185` set `currentView` on **every** tab activation; `tick()` reads `endpointsFor(view.name, view.ctx)` at `:368`; `src/dashboard/ui/poll.js:15-27` gives `issues`/`models`/`system` their own single-route sets. One timer only: a self-rescheduling `setTimeout` armed in `tick().finally(...)` (`app.js:394-397`) with a generation guard at `:393`/`:395` — no `setInterval` anywhere in `src/dashboard/`. |
| **AC-6** | INV-V27-5's three anchors are asserted against the **rendered** nav in real Chromium (`tests/acceptance/val-198-shell-and-home.test.ts:311-322`), not against the island. |
| **AC-7** | `grep -rnE "new Date|Date\.now|document\.|window\.|fetch\(|localStorage|setTimeout|setInterval" src/dashboard/lib/` → **0 executable hits** (three prose mentions in comments only). No `lib/` file imports outside `./`. `ui/clock.js` is registered in the asset map (`src/static-assets.ts:20`), so the 404-on-missing-key boot class is not re-armed. |
| **AC-8** | `src/static-assets.ts:33` types the value as the exact header; `:47-49` returns the full directive; `src/server.ts:1312` writes `entry.cache` verbatim. Ran it: `tests/integration/static-assets-route.test.ts` + `tests/unit/static-assets.test.ts` → 10/10 green. |
| **AC-9** | `tests/integration/usage-live-equals-fold.test.ts:35-37` makes the `failed` label return `ok:false` (a **terminal** provider failure, not a priced call wearing its name), and `:81-85` runs `priced` → `unpriced` → `failed` in ONE script, which is INV-V27-1's named v26-R-1 shape. The detail side is anchored non-vacuously at `:89`. |

**Architecture rows walked against code, one each:**

- **ARCH-123 (the first path-traversal surface).** `src/static-assets.ts:53` builds every path from a
  **literal** key, never from caller input; `:64-66` is a bare `Map.get`. No `join`, no `normalize`,
  no `decodeURIComponent`, no `..` handling anywhere in the module — correctly, because none is
  reachable. The route (`src/server.ts:1288-1316`) is GET-gated at `:1289`, strips the query at
  `:1293`, reads before writing the head (`:1298-1309`, so a listed-but-deleted file still 404s
  cleanly), never echoes the requested key in the 404 body (`:1307`), adds `X-Content-Type-Options:
  nosniff` (`:1313`, additive to spec), and sits **before** the `/dashboard` SPA catch-all at
  `:1322` — the ordering ARCH-123's `note:` calls a correctness condition. It also sits **after** the
  Host/Origin DNS-rebinding + CSRF guard at `src/server.ts:1074-1084`, so it inherits that floor.
- **ARCH-126.** `src/dashboard.ts:267-282` — `lanes` is dense and re-indexed on append (`:278`),
  `current` uses `LIVE_LANE_STATUSES` (`:280`, the DES-196 widening to `running|suspended|interrupted`),
  and is never clamped to the predicted count. No `masked` parameter exists. `predictedLanes`
  (`:292-302`) returns `[]` on a derivation refusal and lives in the allowlisted file.
  `avgCostUSD` is `null`-never-`0` (`:170-174`).
- **ARCH-127.** `src/run-manager.ts:823-885` implements the precedence chain in order and only once:
  (1) live entry `:830-835`, (2) store projection pass-through `:838`, (3) bounded one-time backfill
  `:848-876`, (4) absent `:882`. `agentCount` is deliberately omitted on the legacy arm (`:865-869`)
  with the flip-flop reasoning written down. Both routes moved onto it.
- **ARCH-128.** One `LEFT JOIN run_snapshots` with `json_extract`/`json_array_length`
  (`src/store/sqlite-run-store.ts:330-338`), applied on **both** read paths (`:348`, `:375`) —
  never N+1, never a per-row transcript fold. `backfillUsage` (`:310-320`) **re-checks** terminality
  (`:311-314`) and usage-absence (`:317`) itself rather than trusting the caller, which is what makes
  the convergence claim hold. `InMemoryRunStore` has real parity (`src/run-store.ts:372`, `:420-427`).
- **ARCH-129 / INV-V27-2 / ADR-050.** ONE decoration site. The order is exactly
  **strip → `redact()` → `capPrompt`**: `src/agent-executor.ts:651` → `:684-686` → `:687`, so a
  secret can no longer be split across the cap seam. `stripFirstSegment`
  (`src/params/resolve.ts:195-201`) is an exact prefix slice and **fails closed** — an unrecognised
  prefix returns `{ prompt: '', stripped: false }` (`:200`) plus a warning line
  (`agent-executor.ts:652-654`), never the untouched composed blob. The `systemPrompt: {agentType,
  bytes}` fact rides at `:666`, present iff a non-empty segment applied.
- **ARCH-130.** The CSP at `src/server.ts:1332` is **byte-identical** to the ARCH row. The degraded
  journal line exists on both catches (`:615`, `:1103`) and on both DAG fault arms (`:524`, `:557`/`:565`)
  with the closed `reason` set; the `PREDICTED_FROM_FALLBACK_VERSION` arm correctly emits none.
- **ARCH-131.** `record: agent` on the ONE return object (`src/mcp-facade.ts:713`), so MCP and HTTP
  gain it in the same edit. `phases[].agents` (`:498-502`) is served with **no** predicate of any
  kind; `grep -rn maskPredictedOverlay src tests` → 0 hits, as ADR-051 said.
- **ARCH-125's two disclosed truncations are both real**, not aspirational:
  `src/dashboard/ui/agent-panel.js:233` requests `?limit=500`, `src/dashboard/lib/agent.js:96-99`
  builds the 「shown N / more」 marker from `hasMore`, and `agent-panel.js:37` caps each event row at
  `EVENT_CLIP = 2048` with a real click-to-expand at `:102-110`.

**Invariants:**

- **INV-V27-1** — the equality assertion is over one real run holding all three call shapes
  (`usage-live-equals-fold.test.ts:94`), with the zero-record omit-all-four case beside it (`:97-110`).
- **INV-V27-3** — exactly ONE inline `<script>` survives and it is the `application/json` island
  (`src/dashboard-page.ts:153`); the other two are `src=` references (`:89`, `:154`). The build half is
  enforced over `src/dashboard/**/*.{css,js}` by `tests/unit/dashboard-no-external-host.test.ts:64-65`,
  **with an anti-vacuity planted-fixture proof at `:68-74`** — the detector is proven, not assumed.
- **INV-V27-4** — exactly three consumers of the one derivation: the registration checker
  (`src/workflow-catalog.ts:540`), the run-DAG route (`src/server.ts:538`, `:549`) and `predictedLanes`
  (`src/dashboard.ts:295`). No fourth implementation anywhere in `src/`.
- **INV-V27-8** — both guards walk `.js` **and** `.css`, not just `.ts`
  (`tests/unit/no-skeleton-surface.test.ts:62`, `tests/unit/no-retired-surface.test.ts:30`), each with
  a planted-fixture proof. The six-file allowlist is still exactly six and a seventh is asserted to
  fail (`no-skeleton-surface.test.ts:79-83`). Note the walker does **not** strip comments for `.js`
  (`no-retired-surface.test.ts:109`) — that is stricter than the `.ts` path, not weaker.
- **INV-V27-9** — `tests/integration/dag-masking-auth.test.ts:298-338` is the shape the invariant
  specifies and not a weaker one: exclusion-form deep equality across the two booted servers minus
  `[runId, terminalAt]` with `current` explicitly compared (`:338`), **plus** two positive anchors on
  the AUTH server (`:324-326`: a `__skel_*` predicted cell exists, and `lanes` is exactly
  `['one','two','three']`, `current === 0`). Parity alone would pass vacuously when both engines
  degrade identically; the anchors are what stop that.

**Security sweep this lens owes on a client rebuild:**

- `grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|document\.write|cssText" src/dashboard/ui/` →
  **0 hits.** D5 holds by construction, not by review.
- The only three URL sinks in the client are `src/dashboard/ui/app.js:235` (a constant),
  `src/dashboard/ui/workflow.js:276` (a `createObjectURL` blob), and
  `src/dashboard/ui/issues.js:85` (`data.url` from `/api/issues`, i.e. GitHub's own `html_url`, on
  ported REQ-078 code). The last is the only one a hostile value could reach, and the CSP this slice
  added is what neutralizes it: `script-src 'self'` with no `unsafe-inline` blocks `javascript:`
  navigation. That is the added control earning its keep on code it was not written for — worth
  recording, because ARCH-130 justified `img-src blob:` and `style-src 'unsafe-inline'` at length and
  never claimed this one.
- `style-src 'unsafe-inline'` is the honest floor ARCH-130 says it is, and it is **not** load-bearing
  against an attribute-injection sink, because there is no such sink (0 `cssText`, 0 `setAttribute('style'`
  over run- or author-derived values — `tests/unit/dashboard-no-design-values.test.ts` locks that
  negatively over the whole client corpus with a positive anchor beside it).
- **Lens applicability, stated rather than force-fitted:** brute force, JWT forgery and timing attacks
  have **no surface in this slice**. The `/api/*` surface carries no bearer at all — it is dispatched
  before any auth check by owner decision D1, with the Host/Origin allowlist as the only floor — so
  there is no credential to guess, forge or time. The one authorization change v27 makes is ADR-051's
  owner-ruled mask reversal, which *deliberately widens* anonymous disclosure; its exact residual
  (F-2 in ADR-051: the lane membership of a pinned, non-release, `mermaid: null` pre-v26 version) is
  on the record with the boundary drawn precisely, and I did not find it drawn wrong.

**Build state at HEAD:** `npx tsc --noEmit` → **exit 0**. Targeted run of the four files this review
leans on hardest (`dashboard-lib-connection`, `static-assets`, `static-assets-route`,
`dashboard-lib-theme`) → **27/27 passed**.

---

## 3. Where the three lenses genuinely conflict (argued, not smoothed over)

**(a) Security/observability vs. UX-simplicity, on F-1.** The debounce exists for a real reason the
security lens must concede: the engine restarts itself on release tags (ARCH-039/040), so a single
all-fail tick is an *expected* event, and painting every viewer's tag red on it trains operators to
ignore the tag — which destroys more observability than it buys. The testability lens then points out
that the current resolution buys that at the price of an affirmative false statement, and the
scalability lens has no stake either way. **The conflict dissolves rather than trades**, which is why
I rated it MEDIUM instead of arguing it as a judgment call: `degraded` is a state the machine already
has, already renders, and already reaches on a strictly *less* broken tick. Choosing it costs nothing
any lens values and satisfies both clauses. Where two shapes deliver equal value, take the one that
adds no state — and here one of them is already in the union.

**(b) Testability vs. simplicity, on F-2.** Simplicity says: `theme-init.js` is 66 lines of guarded
localStorage reads, the copy is forced by the classic-script constraint, and a parity harness for it
is ceremony — exactly the reasoning that (correctly) killed the `node --check` proposal at v27h.
Testability answers that the thing at risk is not the file's size but a *security-relevant
normalization* (the hue clamp and the `lang` closed set), and that this ledger's own closing lesson
is 「where a clause names an external contract or a security property, assert against that property」.
**Testability wins narrowly**, and only because the cost is four lines of text assertions in a file
that already exists — the same Karpathy arithmetic that rejected the second parser rejects a new
harness here too. What I would *not* endorse is the runner-up the v27 synthesis already refused: a
`new Function` equality pin over the two implementations.

**(c) Scalability vs. consistency, on the composition of F-5 and F-6 (both recorded debt — argued,
not re-counted).** These two are usually reported separately and they are worth reading together
once. F-5 says `BACKFILL_PER_TICK = 25` bounds a *call*, not the process, and the memo
(`src/run-manager.ts:861`, `:872`) is written after two awaits — so k polling tabs each do up to 25
`getRun` transcript reads and 25 writes on the same rows. F-6 says ARCH-128's convergence argument
rests on an unstated single-synchronous-writer assumption. **Composed, they could read as a
lost-update hazard — and they are not.** I checked the reason at HEAD rather than assuming it:
`backfillUsage` (`src/store/sqlite-run-store.ts:310-320`) re-derives its own preconditions —
terminality at `:311-314` and usage-absence at `:317` — inside the same synchronous
better-sqlite3 body as the write at `:319`, with no `await` between them. So a duplicate racer's
write is a **no-op**, not a clobber; the cost is wasted CPU and I/O, which is what F-5 already says.
The two LOWs stay two LOWs. The bound ARCH-127 *claims* is still not the bound the tree *has*, and
`_usageBackfillChecked` (`run-manager.ts:323`) is still the unbounded `Set` that ADR-051 forbade in
its neighbouring case — both correctly filed, neither escalated by this composition.

**(d) Where the simplicity tie-breaker cut against my own lens, recorded for balance.** The
adversarial position would normally want a `dashboard-disclosure.ts` projection module (D-ADV-1), a
`?workflow=&status=&limit=` bound on `/api/runs` (D-ADV-4) and a second tsconfig as a first-class
program. All three were refused by ADR-054/ADR-052/ADR-049 in favour of a test, a measurement and an
additive eight-line config — and **all three refusals have now been discharged on the record**:
the key-set test asserts real served bodies (AC-1), the measurement exists
(`08-validation.md` p95 83.2 ms at N = 1 000), and the tsconfig is a named TASK with a written DoD
rather than a hope. I have no residual objection to any of the three. Nothing speculative was built
this round either: still no ETag layer, no content-hash filenames, no compression, no router library,
no bundler, no framework, no `(runId, reason)` dedupe set, no LRU memo — every one of them pre-approved
in the architecture *conditionally*, and every condition still unmet.

---

## 4. Summary

| # | Severity | ARCH / INV violated | Evidence (HEAD `ced73ff`) |
|---|---|---|---|
| **F-1** | **MEDIUM** | ARCH-124 `api:` (v27h amendment) + REQ-131 acceptance (owner-amended) | `src/dashboard/lib/connection.js:34-36`; pinned by `tests/unit/dashboard-lib-connection.test.js:49-54` |
| **F-2** | LOW | ARCH-125 `note:` (「every formula it needs is imported from ARCH-124」) + v27 Decision rationale 「mirror pairs」 | `src/dashboard/ui/theme-init.js:24-27` vs. `src/dashboard/lib/theme.js:14-17`; claimed pin absent — `grep -rn theme-init tests/` → only `tests/unit/dashboard-page-source.test.ts:66` |
| **F-3** | LOW | ARCH-123 `api:` and ARCH-125 `api:` (closed enumerations) | `src/static-assets.ts:18-26` has 26 keys vs. the row's 18; `src/dashboard/ui/` holds 12 files vs. the row's 7 |

**Not counted, verified as correctly declared:** TASK-215 (`03-tasks.md:1837`) and TASK-216 (`:1846`),
both `status: draft`; `tsconfig.server.json` absent and `package.json:8`/`:11` bare, exactly as
ADR-049 states; the fossil shell body at `src/dashboard-page.ts:92-152`, exactly as ARCH-122 states.

**Not counted, re-confirmed still accurate at HEAD:** F-4, F-5, F-6, F-7, DEBT-A, DEBT-B, DEBT-C and
ADR-051's own residuals F-2/B-1/B-2 — all on 07-review.md §9 with their consequence written down.

**Consistent: NO — 3 violations (0 HIGH, 1 MEDIUM, 2 LOW).**

None of the three blocks a closure decision on its own; F-1 is the only one where the tree and a
clause amended *this round* disagree about behaviour a user sees, and it is a one-branch change plus
a one-expectation test flip. F-2 and F-3 are prose-vs-tree contradictions of the class this round was
convened to repair, found in the rows the round did not re-open. Whether that clears the bar for a
third send-back or is carried as named debt is the orchestrator's call, not this panel's — what this
panel owes is that all three are stated with a falsifiable line number and a cheapest-close that
costs no new mechanism.
