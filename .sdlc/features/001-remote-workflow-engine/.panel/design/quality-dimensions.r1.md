---
stage: design
lens: quality-dimensions
iteration: v27 — Gate 8 RE-REVIEW #2 SEND-BACK, the DESIGN half. I label it **v27l for reference only; the synthesizer coins the id.** The dispatch text says "round 1, `03-tasks.md` does NOT exist yet"; the tree says otherwise — `03-tasks.md` has TASK-196..216 (`:1837` TASK-215, `:1846` TASK-216, both `status: draft`), `04-design.md` has DES-191..209, `state.yaml` is `current_stage: review`, and `07-review.md:7` is RE-REVIEW #2 with `send_back = ["impl", "design"]`. This pass is the design entry on that list.
round: 1 (independent proposal — written without reading a sibling r1 for THIS round; the `adversarial.r1.md` on disk at 09:42 is the v27j round's)
closure: REQ-131..136, REQ-140, REQ-141 (unchanged); REQ-137/138/139/142/143 stay out
supersedes_on_disk: the v27j round-1 file at this path — `git show 8d3584b:.sdlc/features/001-remote-workflow-engine/.panel/design/quality-dimensions.r1.md` (read history with `git show`, never `checkout` / `restore` / `stash` — CLAUDE.md)
builds_on: my Gate 8 stance for RE-REVIEW #2 (`.panel/review/quality-dimensions.md`, QD2-O1/O2 and the uncounted "Footer freshness on a failed tick" observation at `:62`) and the v27j design r1/r2 — everything those settled stands; this file argues only from what BF-1/BF-2/BF-3 changed.
verified_this_round (HEAD `57ad237`; code last moved at `b124430`; every claim below is a file:line read EXCEPT QD3-O2/QD3-O3, which were reproduced for real — see `measured_this_round`): `04-design.md:6811-6819` (DES-202 as amended v27k), `:6845-6851` (DES-206), `:6853-6859` (DES-207), `:7275-7277` (the [SETTLED] paragraph); `02-architecture.md:3356-3366` (ARCH-124 incl. `owner_decision: answered`), `:3368-3378` (ARCH-125); `01-requirements.md:1716-1745` (REQ-131 as amended v27h); `07-review.md:7-305` (RE-REVIEW #2, §8 BF-1/2/3 verbatim); `06-impl-log.md:6531-6612` (IMPL-277/278); `src/dashboard/lib/connection.js:1-50`; `src/dashboard/ui/app.js:112-146, 355-400`; `ui/poll.js:1-55`; `ui/home.js:223-234`; `ui/run.js:466-500`; `ui/workflow.js:338-352`; `ui/system.js:20-80`; `ui/models.js:50-63`; `ui/issues.js:96-108`; `src/server.ts:1101-1105, 615`; `tests/unit/dashboard-lib-connection.test.js:1-100`; `tests/acceptance/val-199-workflow-detail.test.ts:222-250`; `val-198-shell-and-home.test.ts:257-284`; `val-200-swimlane.test.ts:209-234`; `val-202-ported-tabs.test.ts:104-118`; `05-tests.md:12159-12169, 12345, 12364, 12466, 12512`.
measured_this_round: ONE scratch reproduction, nothing under `src/`/`tests/` touched — `npx tsx <scratchpad>/repro-qd3-o2.mts` (real `createServer({port:0, bind:'127.0.0.1', workRoot:<mkdtemp under /tmp>})`, real Chromium 152 from `~/.cache/puppeteer`, `setRequestInterception` answering `/api/system` with `{degraded:'qd3-o2 injected degrade'}` at HTTP 200 — the `server.ts:1104` shape — then click `[data-tab="system"]`, wait 7.5 s ≥ two poll ticks). **Control (no fake):** tag `live`→`live`, `#system-panel` 6 rows, 0 `pageerror`. **Faked:** tag `live`→`live`, `#system-panel` **0 rows / empty text**, **3 `pageerror`** — `TypeError: Cannot read properties of undefined (reading 'cores')` at `buildTable (…/ui/system.js:49:53)`, once at mount and once per tick.
---

# Quality-dimensions — v27l DESIGN r1 (RE-REVIEW #2 send-back, design half): BF-3 is closed correctly; the same row still contradicts the tree on two other lines; BF-2's property has no design home and its grep missed a fourth view; and the footer stamps freshness on the very ticks the repair now skips

## summary

**BF-3 is closed, and closed the right way.** `04-design.md:6815` (boundary) and `:6816` (tests) now say what `src/dashboard/lib/connection.js:34-40` does — a unanimous-`fail` tick advances `consecutiveFails` and reports `degraded` at 1, `offline` at ≥ 2, never `prev.status` — and `tests/unit/dashboard-lib-connection.test.js:54-59` asserts exactly that. DEBT-C is settled at `:6817` and `:7275-7277` with the ledger's strikethrough-plus-marker style. No new DES id, no trace-link change, `iter: v27k`. The implementer did design's edit inside the impl dispatch; this pass's job is to verify it (done — it holds) and to do what the retro of RE-REVIEW #2 asked and nobody has yet done for this row: **close it with the grep, not the line.**

**The grep over DES-202 finds two more lines the tree contradicts — one token each, both repair-now.** (1) `:6814` `signature:` says `worstOf(perRoute) → 'live'|'degraded'|'fail'`; the function returns `'ok'` (`connection.js:6, 10`), `nextConnection:27` branches on `worst === 'ok'`, and UT `:75-79` asserts `'ok'`. An implementer who reads the signature verbatim writes a `worstOf` that returns `'live'` and a reducer that never enters its own `live` branch. (2) `:6816` `tests:` names the AC-4 falsifying case as "`/api/home` ok + `/api/runs` degraded" — no view fetches those two in one tick (`poll.js:15-27`); the case is `describe` ok + `/api/runs` degraded on the WORKFLOW page (`val-199:231`, UT `:29-34`). Both sit on the row BF-3 re-stated; both are BF-3's own line left incomplete, so no widening argument is needed to take them.

**BF-2's property — "a degraded body is never rendered as data; the view keeps its last-known render" — now exists three times in `ui/` and zero times in `04-design.md`.** `workflow.js:350`, `home.js:231`, `run.js:475` carry the identical guard, each with a real-browser falsifying case; DES-206's "five invariants it may not lose" (D5, D6, C2, C1, delegated listeners) do not include it, and the seam that makes each view responsible — `app.js:373-381` stores `bodies[url] = res.body` for EVERY status and hands the map to `view.onTick` BEFORE `nextConnection` runs — is stated nowhere. The tree satisfies the property today for the three `bodies`-fed views, so stating it as **D7** forbids nothing and needs no task. That is the design half of "the grep, not the line", and it is cheap.

**The grep BF-2 itself should have been run reaches a fourth view, and it is not a guard-shape question there — it throws.** `ui/system.js:74-77`: `if (!res.body) → UNAVAILABLE else buildTable(res.body)`. The server's catch-all (`server.ts:1101-1105`, the same one that mints BF-2's `{degraded:'internal dashboard error'}`) answers `/api/system` with that truthy object; `buildTable:49` reads `data.cpu.cores` and throws. Because `app.js:379` has no try/catch around `view.onTick`, that throw skips `nextConnection` (`:383`) and the tag freezes at whatever it last read — the exact symptom `val-199:228-230` describes for the pre-AC-4 crash ("the tag stuck at `checking` — `nextConnection` never even ran"). DES-207's `tests:` line (`:6858`) promises "a degraded `/api/system` section renders the Unavailable component rather than an empty panel"; `val-202:104-118` — whose title says the same — asserts only that `#system-panel` exists. **Measured this round, not inferred** (frontmatter `measured_this_round`): the System panel renders **0 rows** — the empty mount, never painted — `pageerror` fires **3×** at `system.js:49:53` (mount + one per tick), and the nav tag reads **`live` for the whole 7.5 s**, two poll ticks in which `app.js`'s own fetch had already classified the route `degraded`. Control without the fake: 6 rows, 0 errors, `live`. Routing: the code is Gate 6's; the DES-207 `tests:` line and D7's scope are design's; the test body is Gate 5's.

**The footer is the class's third instance, and BF-2 is what makes it a design question now.** `app.js:386` runs `updateFooterClock()` every tick "whether or not it changed anything" (`:131-135` → `Updated HH:MM:SS`). Before BF-2 a degraded tick repainted garbage under a fresh stamp; after BF-2 the skipped repaint is *designed*, so on those ticks the stamp is knowingly false beside a truthful `降級` tag. My Gate 8 lens recorded this uncounted (`.panel/review/quality-dimensions.md:62`) because no ARCH/DES clause decides it. A design pass can decide it. The tree does NOT satisfy any truthful rule today, so by the ledger's own precedent (`04-design.md:7285`: a clause the tree still violates with no task is worse than leaving both alone) it comes as **a stated clause + a priced task (TASK-217, draft, S) — or as recorded debt with no clause.** I recommend the former and say why in §1; the synthesizer chooses.

**Nothing blocks this gate's own edits** — the two DES-202 tokens are contradictions and one token each; the rest are omissions this pass closes by stating. **QD3-O2 does meet RE-REVIEW #2's §8 blocking definition** (a stated `api:`/`boundary:` clause contradicted by shipped behaviour, with an operator-visible consequence); the code is Gate 6's, not this file's, and the synthesis note should flag it to impl now rather than let RE-REVIEW #3 rediscover it.

## Altitude call

This project is both a conventional system (an HTTP/MCP server with a browser dashboard) and an AI-agent system (it runs LLM agents through a gateway). **This round's subject is a poll loop, a pure reducer, four view modules and the ledger rows that describe them — system altitude throughout.** The agent altitude (REQ-135's panel, REQ-136's prompt withholding) is untouched by BF-1/BF-2/BF-3 and is not re-argued; `02-architecture.md:3330`'s altitude split stands.

---

## 0. What this pass is, and what was verified

RE-REVIEW #2 (`07-review.md:203-251`) routed three blocking MIDs: BF-1 and BF-2 to impl, BF-3 to design, with the order "impl first, then design re-states from the repaired tree". The implementer (`b124430`, IMPL-277/278, journal `:4855`) landed all three in one dispatch, including design's BF-3 edit. The gate that was named still has to run, and running it means three things: confirm the edit, sweep the class, and decide whether the design now describes the tree the repair produced.

| Item | Where | Holds at `57ad237`? | Evidence |
|---|---|---|---|
| BF-1 code | `connection.js:34-40` | yes | `const status = consecutiveFails >= 2 ? 'offline' : 'degraded'`; no `prev.status` read anywhere in the function; counter advances as before |
| BF-1 test | `dashboard-lib-connection.test.js:54-59` | yes | `live -> degraded (consecutiveFails 1) on ONE all-fail tick`; `:61-66` second tick → `offline`; `:68-73` un-debounced recovery — unchanged |
| BF-2 code | `home.js:231`, `run.js:475` | yes | same three-token shape as `workflow.js:350`; `run.js`'s guard precedes its own second `getJSON` |
| BF-2 tests | `val-198:262`, `val-200:215` | present | `setRequestInterception` → `{runs:[], degraded:'…'}`; asserts last-known render survives ~7 s |
| BF-3 boundary | `04-design.md:6815` | yes | "reports `degraded` at 1 and becomes `offline` at ≥ 2 … `status` is never carried forward from `prev`" |
| BF-3 tests line | `:6816` | yes (for BF-1's case) | "`live→degraded (consecutiveFails 1)` on ONE all-fail tick, `→offline` on the second" |
| DEBT-C | `:6817`, `:7275-7277` | yes | strikethrough + `[SETTLED 2026-09-13 …]`; ARCH-124 `:3365` reads `answered 2026-09-13` |
| Amendment hygiene | `:6818` | yes | dated, names the finding, "No new DES id, no trace-link change", `iter: v27k`; the file:line cites (`:34-39`, `:49-58`) are one line short of the actual spans (`:34-40`, `:49-59`) — noted, not a finding |

Two things the confirmation does NOT establish, and the rest of this file is about: whether the *row* now describes the tree (it does not — §3), and whether the *class* BF-2 named has a design home (it does not — §1).

---

## 1. Observability — transparency of internal state

The owner's first motive for v27 is observability (`02-architecture.md` altitude split: 「以觀測性為主」), and RE-REVIEW #2 blocked on exactly one property: **the page must not tell the operator something untrue** (`07-review.md:77-84`). BF-1 fixed the tag; BF-2 fixed two views' bodies. Below are the four places where the same property is still unstated, unguarded, or false.

### QD3-O1 — MID (design omission; repair by stating) — BF-2's invariant has no design row, and the seam that makes every view responsible for it is undocumented

- **What ships:** `app.js:369-385` — `getJSON` never throws (`poll.js:42-55`), `results[url] = res.status` and `bodies[url] = res.body` are stored for **every** status, the whole `bodies` map is handed to `view.onTick` (`:379`), and only afterwards is `nextConnection` reduced (`:383`). So a view receives degraded bodies by construction, and each view must refuse them itself. Three do, identically: `workflow.js:350`, `home.js:231`, `run.js:475` — bail when the body is absent, carries `degraded`, or fails an `Array.isArray` check on its own array field; last-known render stays.
- **What the design says:** DES-206 `boundary:` (`04-design.md:6849`) lists five invariants (D5 `textContent`, D6 transform-on-wrapper, C2 anchors, C1 `draggable`, delegated listeners). DES-202's classifier clause says a degraded body is "never rendered as data", but `classifyResponse` is not what prevents rendering — it only labels. ARCH-125 `api:` says the same words about `getJSON`. **No row says "the view is the last line, and this is its shape."**
- **Why it matters for this dimension:** QD2-O1 was IMPL-271 fixing the named view and leaving two siblings; RE-REVIEW #2's retro (`07-review.md:291-297`) named that exact failure. The next author of a `bodies`-fed view — REQ-137's Models redesign, REQ-138's System redesign, both out of closure and both coming — has nothing to read but three comments in three files.
- **Proposed design edit (no new id; amend DES-206 in place, `iter: v27l`):** add **D7** to the invariant list, scoped to *the views `app.js` feeds through `bodies`*: 「a body that is absent, carries a `degraded` key, or fails the view's own shape check on the array it renders is never handed to a paint function (the view judges the BODY — `app.js:379` hands `bodies` only; the per-route statuses never reach a view); the tick's repaint is skipped and the last-known render stays; the tag (DES-202) is the operator's witness, not the view. Each such view carries one real-browser falsifying case that fakes its route at the browser edge (`setRequestInterception`, the `val-199:231` recipe) and asserts the prior render survives two poll intervals.」 And state the seam's *reason* in the same sentence: `bodies` carries every status **because `issues.js` renders its own degraded notice as the DES-207 component** — so filtering at `app.js` was refused, and the view is responsible. The `tests:` line of DES-206 gains the three cases by file (`val-198:262`, `val-199:231`, `val-200:215`).
- **Scope caveat (deliberate):** D7 is worded for the `bodies`-fed views only. The three ported tabs fetch for themselves (`models.js:52`, `system.js:72`, `issues.js:99` — the QD2-O2 double fetch, carried LOW) and DES-207 allows per-field degraded rendering (`system.js`'s `UNAVAILABLE` per row). A D7 that says "keep last-known" for them would contradict DES-207 and the tree. Their rule is DES-207's: **a degraded body renders the Unavailable component** — which brings us to the view that does neither.

### QD3-O2 — MID (code contradiction, route → impl; design owns the row) — `system.js` renders a whole-route degraded body as data and THROWS; the design row promises a component, the test asserts a selector

- **Evidence:** `system.js:74-78` — `if (!res.body) { UNAVAILABLE } else { buildTable(res.body) }`. `buildTable:49` begins `String(data.cpu.cores)`. A whole-route degrade — `server.ts:1101-1105`'s catch-all, `{ degraded: 'internal dashboard error' }`, HTTP 200 — is truthy and has no `cpu`, so this is `TypeError: Cannot read properties of undefined (reading 'cores')` inside `onTick`, once per 3-second tick while the tab is visible. `models.js:56` beside it is fine (`!Array.isArray(entries)` → `(unavailable)`); `issues.js:102` is fine (`data.degraded` → the component). `system.js` is the one of six that neither bails nor renders the component.
- **Clauses contradicted:** ARCH-125 `api:` 「never an exception and never rendered as data」; DES-207 `boundary:` 「a `degraded` section renders the ONE 「無法取樣」 component … instead of reaching a render function as data and throwing」 — the row's own words; DES-207 `tests:` 「a degraded `/api/system` section renders the Unavailable component rather than an empty panel」.
- **The test:** `val-202:104-118` is titled "…with a degraded section showing the Unavailable component (never 0)" and its body clicks the tab and waits for `#system-panel`. It fakes nothing and reads no cell. The title promises the DES-207 clause; the body proves tab existence. This is the "form without the property" shape RE-REVIEW #2 named for AC-1/AC-4/AC-6/AC-9 (`07-review.md` §8, BF-2).
- **Measured (frontmatter `measured_this_round`):** control `{tag: live→live, rows: 6, pageErrors: 0}`; faked `{tag: live→live, rows: 0, text: '', pageErrors: 3 — TypeError … (reading 'cores') at system.js:49:53}`. The operator-visible state is an EMPTY System panel under a `Live` tag, every 3 s, for as long as the route stays degraded. The falsifying recipe for the real test is the scratch script's shape: `val-199:231` verbatim with `/api/system`, asserting a `.sys-table` row reads `無法取樣`, `pageerror` is empty, and the tag reads `degraded`.
- **Routing:** the one-line code fix (`if (!res.body || res.body.degraded)`) and the test body are impl/tests lane — this file has no authority to make them and does not. **Design's part this pass:** DES-207's `tests:` line should name the fake (route-level `{degraded}` at the browser edge) so the next test author cannot satisfy it with a selector; and D7's scope sentence (QD3-O1) should say the ported tabs' rule is DES-207's component, so the two rows cover all six views between them with no gap and no overlap.

### QD3-O3 — LOW→MID (design omission; the silent-failure seam) — a view that throws inside `onTick` freezes the tag at its last value, and nothing in DES-206 says what a throwing view means

- **Evidence:** `app.js:378-386` — `const extra = await view.onTick(...)` is unguarded. A rejection propagates out of `tick()`; `scheduleTick`'s `.finally` (`:394`) still re-arms the 3 s timer, so the loop survives — but `nextConnection` (`:383`) and `updateConnectionTag` (`:384`) never run for that tick. The tag keeps its previous text. If it was `live`, it stays `live` for as long as the view keeps throwing. The only witness is an unhandled-rejection line in devtools.
- **Reachability — measured, not hypothetical:** in the QD3-O2 run `app.js`'s own `getJSON('/api/system')` classified the route `degraded` (`results` had it), yet the tag stayed `live` across two ticks because the throw at `:379` skipped `:383`. The pre-AC-4 workflow crash was the same door (`val-199:228-230` — "the tag stuck at `checking`"). BF-2's guards close the known repaint-time throws in three views; they do not define the behaviour of the next one — and the next one is already shipping.
- **Why it belongs to this dimension:** it is BF-1's defect through a different door — the tag claims a status the visible view cannot back, and the failure is opaque. A poll loop whose *scheduler* self-heals while its *truth-telling* silently stops is the exact "silent/opaque failure is a design defect" case the lens is asked to name.
- **Proposed design statement (DES-206, one sentence) + priced task:** 「a view exception inside `onTick` is folded into the tick as a `fail` under a synthetic key (e.g. `view:<name>`) so the reducer reports `degraded` (never counted toward the offline streak unless every route also failed), is logged ONCE per distinct message via `console.error`, and never prevents `nextConnection` from running.」 The tree does not do this, so the clause must ride with a task or not be written — see TASK-217 in §5.

### QD3-O4 — MID (design omission; false freshness) — the footer stamps `Updated HH:MM:SS` on the ticks BF-2 now designs to skip

- **Evidence:** `app.js:386` — `updateFooterClock()` runs at the end of every `tick()`, comment: "every tick, whether or not it changed anything"; `:131-135` writes the wall clock; the label comes from `app.js`'s private string table (`:32` `更新於` / `:37` `Updated` — QD-R3 territory, carried). After BF-2, on a tick where the visible view's body is degraded, the view keeps its last-known render **by design** and the footer advances anyway. An operator reads 「更新於 12:30:05」 under a table whose figures are from 12:29:xx, beside a `降級` tag that is telling the truth.
- **Why now and not at Gate 8:** my review lens listed this uncounted (`.panel/review/quality-dimensions.md:62`) because no ARCH/DES clause decides it and the footer is README-owned (IMPL-255). Two things changed: BF-2 made the skip a designed behaviour rather than a lucky one, and this is a design pass, which is where a missing clause gets written.
- **Proposed rule (simplest truthful one):** the footer advances **only on a tick whose reduced status is `live`**. A `live` tick always repaints (every route `ok`, every guard passes); on `degraded`/`offline` ticks the stamp freezes at the last `live` tick, which turns it into the staleness indicator the page currently lacks — 「更新於 12:29:58」 + `降級` reads as "what you see is from 12:29:58". One line in `app.js` (`if (connectionState.status === 'live') updateFooterClock()`), one clause in DES-206, and one assertion appended to `val-198:262`'s existing BF-2 case (footer text unchanged across the two degraded ticks it already waits through). The runner-up — relabel to 「最後輪詢 / Last poll」 — is refused because the handoff fixes the label (`.sdlc/design-handoff/README.md:70`) and DES-209's fidelity oracle would have to move for a wording change.
- **Ledger rule applies:** the tree does not satisfy this. Clause + TASK-217, or debt with no clause. Not both halves separately.

### Verified consistent (Observability)

- BF-1 semantics under the scenario the debounce was written for (a self-update restart): tick 1 all-fail → `degraded` (1), tick 2 → `offline` (2), first all-`ok` tick → `live` (0). The 3 s the debounce buys is unchanged; what changed is that the 3 s is no longer spent lying. `connection.js:24-41`, UT `:54-73`.
- Server-side witness for every degrade that reaches a view: `dashboard_api_degraded` at `server.ts:615` and `:1103` with the closed reason set — so the QD3-O2 path is at least *server*-observable today; it is the browser side that swallows it.
- `getJSON` (`poll.js:42-55`) genuinely never throws and never resolves `null`: outer `try` around `fetch`, inner `try` around `.json()`, both arms return a classified pair.

---

## 2. Replaceability — decoupling & pluggability

### QD3-R1 — LOW (next closure, not this pass) — the ×3 guard is a decidable predicate living in `ui/`, which DES-206's own boundary forbids

- DES-206 `boundary:` (`:6849`): 「This layer may read the DOM and call `fetch`; it may **not decide anything a pure function could decide**」. "Is this body renderable as a `HomeView` / a DAG payload / a runs array?" is a decision; it is taken three times in `ui/` with three hand-written shape checks (`body.running`, `dagBody.cells`, `bodies[runsUrl]`), and `ui/` has no unit tier by construction (ADR-049 refuses jsdom), so the three predicates are tested only through real Chromium.
- This is +3 sites for carried **QD-R2** (decidable logic in `ui/*.js`, excluded from the coverage denominator by IMPL-249). Recorded, not routed: BF-2's shape is correct and green, and the review contract repairs contradictions.
- **The replaceable design, for when REQ-137/138 open:** one pure predicate per wire shape in `lib/` (e.g. `lib/connection.js` grows `renderable(kind, body) → boolean`, or each DES-204/205 projection returns `null` on a degraded body and the view bails on `null`), unit-tested against the fixture in `tests/fixtures/dashboard-wire.ts` — the same `satisfies` lock ARCH-124's note already relies on. Then D7 becomes a one-line call in each view instead of a three-token idiom to copy.

### The seam choice, recorded so it can be re-chosen

`bodies` carrying every status (`app.js:377`) versus `app.js` filtering degraded bodies out before the view sees them: IMPL-271 chose the former so `issues.js` can render its own degraded notice (DES-207). The cost is that every `bodies`-fed view is a place the property can be lost, and one round later two of three had lost it. The alternative — hand views `{status, body}` pairs, or give `issues.js` the degraded *text* through `results` — puts the property in one place. **Not proposed for this pass** (it is a code change with no contradiction behind it); proposed as the first thing to weigh when a fourth `bodies`-fed view is designed. D7 (QD3-O1) should carry this paragraph's substance in one sentence so the next designer sees a choice, not a law.

### Verified consistent (Replaceability)

- The reducer is the pluggable piece and it is genuinely pure: no clock, no `fetch`, no DOM, no timestamp field (`connection.js:3-4`); the BF-1 change touched one expression and zero callers. `app.js:112, 383` is the only consumer.
- `poll.js`'s `ROUTES` table (`:15-27`) is the one place a view's fetch set lives; the comment at `:8-11` forbids sibling modules from editing call sites. The BF-2 repairs respected it.
- The ×4 `stateByContainer` are `WeakMap`s (`home.js:199`, `workflow.js:240`, `issues.js:43`, `run.js:438`) — view state is keyed to the mount element and dies with it; no module-level registry to swap or leak.

---

## 3. Consumability — ease of use & low integration cost

The consumers of a design row are implementers and test authors; a `signature:`/`tests:` line is read as the spec to type. RE-REVIEW #2 made BF-3 blocking on precisely that reading (「an implementer reading it verbatim re-introduces the defect」). The same reading finds two more lines on the same row.

### QD3-C1 — MID (contradiction, one token, repair now) — DES-202 `signature:` types `worstOf`'s return as `'live'|'degraded'|'fail'`; the function returns `'ok'`

- `04-design.md:6814`: `worstOf(perRoute) → 'live'|'degraded'|'fail'` (the nav tag reads THIS).
- `connection.js:6` `RANK = { ok: 0, degraded: 1, fail: 2 }`; `:10` `let worst = 'ok'`; `:14` returns a RANK key. `nextConnection:27` — `if (worst === 'ok')` is the `live` branch. UT `:75-79` asserts `worstOf({a:'ok'})` → `'ok'`. ARCH-124 `api:` (`:3361`) says `worstOf(perRoute) → status` — untyped, so the design row is the only place the alphabet is written, and it is written wrong.
- Consequence for a reader: a `worstOf` that returns `'live'` makes `nextConnection`'s first branch unreachable — every all-`ok` tick falls through to `degraded`. The parenthetical "(the nav tag reads THIS)" compounds it: the tag reads `State.status`, which is the reducer's output, not `worstOf`'s.
- **Fix:** `→ 'ok'|'degraded'|'fail'` and "(the reducer reads THIS; the nav tag reads `State.status`)". No id, no trace change, `iter: v27l`.

### QD3-C2 — LOW (contradiction, one token, repair now) — DES-202 `tests:` names a route pair no view fetches together

- `:6816` (end): 「UT/acceptance — `/api/home` ok + `/api/runs` degraded → the tag reads `degraded` and the view does not throw (the falsifying case the AC-4 repair added)」.
- The AC-4 case is `val-199:231-233`: the WORKFLOW page, `/api/runs` faked degraded, `describe` real and `ok`; the UT mirror is `:29-34` with `'/api/workflows/wf/describe': 'ok', '/api/runs': 'degraded'`. `poll.js:16` — `home` fetches `/api/home` only; `:20-23` — `workflow` fetches `describe` + `/api/runs`. There is no tick in which `/api/home` and `/api/runs` are both fetched.
- **Fix:** `describe` ok + `/api/runs` degraded (workflow view, `val-199:231`; UT `:29-34`).

### QD3-C3 — LOW (tests lane; route, do not edit) — the two BF-2 cases are invisible to the tests ledger, and three counts are stale

- `05-tests.md` rows are per file. VAL-206 (`:12345`, `val-198-shell-and-home.test.ts`) says "5 cases" (`:12364`); the file has 13 (IMPL-278 ran 13/13 — a raw `grep -c 'it('` reads 14 because it also matches the `itReal` helper at `:86`). VAL-208 (`:12466`, `val-200-swimlane.test.ts`) says "3 cases" + a 4th (`:12512`, `:12542`); the file has 6 (IMPL-278 ran 6/6; the same helper over-count applies). UT-245 (`:12159`) says "11 cases" (`:12169`); the file has 12 (the AC-4 mixed ok+fail case at `:36` was the 12th). The only ledger pointer to the two BF-2 cases is IMPL-278's `greens:` (`06-impl-log.md:6562-6566`), by title.
- Not a trace gap (the tool binds ids to files, not cases) and not design's lane. One 「case added — BF-2, IMPL-278」 line on VAL-206/VAL-208 and a count fix on UT-245 is Gate 5's, and RE-REVIEW #3 will otherwise read counts that the files contradict.
- Same lane, same shape, from QD3-O2: `val-202:104`'s title claims a degraded-section assertion its body does not make.

### Verified consistent (Consumability)

- The BF-3 amendment paragraph (`:6818`) is a model of the house style: dated, names the finding and the contradicted clause, states the new behaviour in one sentence, says what did NOT change, cites code and test. The two token fixes above should be appended to it as a second sentence, not as a new amendment block.
- DES-206's `render(container, vm, handlers)` + `onTick(container, bodies, ctx)` contract is what let IMPL-278 fix two views with the same three tokens; the contract is consumable — it is the *property* that was unstated, not the interface.

---

## 4. Self-sustainability — closed-loop autonomy & lifecycle

A dashboard tab is the long-lived process here: it must survive engine restarts, self-updates, days of polling, and its own mistakes without a human reloading it.

### Verified consistent (Self-sustainability)

- **The loop cannot stack or stall on latency:** `scheduleTick` (`app.js:389-399`) re-arms `setTimeout(loop, 3000)` in `tick().finally`, so a slow tick delays the next rather than overlapping it, and a route/mount change bumps `viewGeneration` so a superseded loop exits at its next check — the DES-206 amendment as built.
- **Recovery is never debounced:** one all-`ok` tick returns `live` from `offline` (`connection.js:27-29`, UT `:68-73`). BF-1 did not touch it.
- **The restart window is now truthful rather than merely bounded:** during a self-update the tag walks `live → degraded → offline → … → live` instead of `live → live → offline → … → live`; the operator sees the outage begin at its first tick.
- **No per-view leak vector added by BF-2:** the guards allocate nothing and register nothing; view state stays in `WeakMap`s. F-7 ≡ QD-S2 (`initZoomable`'s `window` listeners, the un-revoked blob URL) is unchanged and stays carried debt.
- **Memory metabolism at the agent altitude** is out of this round's subject (the 2 KB event-row clip and `?limit=500` + `hasMore` marker in DES-206 are the v27 answer and were verified at Gate 8).

### The one gap — the loop self-heals its *schedule* but not its *truth*

QD3-O3 is the self-sustainability defect: after a view throws, the timer keeps firing (good), the view keeps throwing (no re-mount, no back-off, no state reset), and the tag keeps saying what it said before the first throw. The system has entered a stable state in which it is alive, busy, and wrong, with no path back except a reload — the definition of a failure a self-sustaining design must not have. The folding rule in QD3-O3 turns that state into `degraded` + one console line, which is the minimum closed loop: the operator is told, and the tag corrects itself the tick the view stops throwing. A re-mount-on-repeated-throw policy is **not** proposed — it is machinery for a property the fold already gives.

---

## 5. What design should edit this pass — the proposed list, and the task question

Everything below is in-place amendment; **zero new DES ids**; `iter: v27l` (or whatever the synthesizer coins). Round 1 writes only this file — `04-design.md`/`03-tasks.md` are untouched by me.

| # | Row | Edit | Kind | Needs a task? |
|---|---|---|---|---|
| 1 | DES-202 `signature:` (`:6814`) | `worstOf → 'ok'\|'degraded'\|'fail'`; "(the reducer reads THIS; the tag reads `State.status`)" | contradiction (QD3-C1) | no |
| 2 | DES-202 `tests:` (`:6816`) | "`describe` ok + `/api/runs` degraded (workflow view)" | contradiction (QD3-C2) | no |
| 3 | DES-202 amendment (`:6818`) | one appended sentence naming 1–2 as the row-sweep BF-3 owed | hygiene | no |
| 4 | DES-206 `boundary:` (`:6849`) | **D7** for `bodies`-fed views + the seam's reason (issues.js) in one sentence; `tests:` (`:6850`) names `val-198:262`, `val-199:231`, `val-200:215` | omission, tree-satisfied (QD3-O1) | no |
| 5 | DES-207 `tests:` (`:6858`) | the degraded-`/api/system` case names its fake (route-level `{degraded}` at the browser edge) and its assertion (a `.sys-table` row reads `無法取樣`, zero `pageerror`) | row-level precision; the code half is impl's (QD3-O2) | routed to impl/tests, not a new task — it is a BF-2 residue |
| 6 | DES-206 `boundary:` | footer rule (advance only on a `live` tick) + view-throw fold | omission, **tree NOT satisfied** (QD3-O3/O4) | **yes — TASK-217, or write neither clause** |

**TASK-217 (proposed, draft, estimate S)** — 「the poll loop tells the truth on the ticks it skips」: `files:` `src/dashboard/ui/app.js`, `tests/acceptance/val-198-shell-and-home.test.ts`; `des:` DES-206; `dod:` (a) `updateFooterClock()` is called only when the reduced status is `live`, and `val-198:262`'s BF-2 case additionally asserts the footer text is unchanged across its two degraded ticks; (b) `view.onTick` is wrapped so a rejection folds a `fail` under a synthetic key into `results`, logs once, and `nextConnection` still runs — one falsifying case that makes a view throw at the browser edge and asserts the tag reads `degraded` and `pageerror` is empty. Cost of minting: +1 LOW 未實作 trace row, the same price TASK-215/216 paid; benefit: the third and fourth instances of RE-REVIEW #2's blocking class get a design clause and a scheduled close instead of a fourth re-review discovering them.

**If the synthesizer declines the task**, rows 1–5 still stand, and row 6's content goes to the next review's §9 as recorded debt **with no clause written** — per `04-design.md:7285`'s own rule. What must not happen is the clause without the task.

**Where task-splitting affects this lens:** the system.js fix (QD3-O2) and TASK-217 are both one-file `app.js`/`system.js` touches with a `val-198`/`val-202` case each; they should NOT be merged into one task — the first is a BF-2 residue the next re-review will route as a send-back item, the second is new scope the design is choosing to price. Merging them lets a send-back item hide inside a draft.

---

## key_points

1. **BF-3 holds** at `04-design.md:6815-6818` against `connection.js:34-40` and UT `:54-59`; DEBT-C is settled at `:6817`/`:7275-7277`. Confirmed at file:line, nothing taken on the implementer's word.
2. **Two more contradictions on the same row, one token each:** `worstOf`'s return alphabet (`'live'` vs `'ok'`, `:6814`) and the AC-4 case's route pair (`/api/home` vs `describe`, `:6816`). Repair now; this is BF-3's own sweep.
3. **BF-2's property has no design home** — three views, three identical guards, zero rows. State it as **D7** in DES-206 with the seam's reason; the tree satisfies it, so no task.
4. **BF-2's grep missed `system.js:74-77` — measured:** a whole-route `{degraded}` body reaches `buildTable` and throws on `data.cpu.cores` (3 `pageerror`, 0 rows, tag frozen `live` for two ticks); DES-207 promises a component, `val-202:104` asserts a selector. Code → impl, test body → Gate 5, row wording → design.
5. **An unguarded `view.onTick` freezes the tag** (`app.js:379-384`) — measured in the same run: route classified `degraded`, tag stayed `live`. The loop survives, the truth does not. Design states the fold; TASK-217 builds it.
6. **The footer stamps freshness on skipped ticks** (`app.js:386`); BF-2 made the skip designed, so the stamp is now knowingly false. Rule: advance only on `live`. Clause + TASK-217, or neither.
7. **Tests-ledger counts are stale** (VAL-206 5→14, VAL-208 3/4→7, UT-245 11→12) and the two BF-2 cases have no row-level pointer beyond IMPL-278's `greens:`. Gate 5's lane.
8. **Nothing blocks this gate's edits.** Item 2 is two contradictions, trivially closed in this pass; the rest are omissions closed by stating. **Item 4 (`system.js`) meets the review's blocking definition** and should be flagged to Gate 6 in the synthesis note, not left for RE-REVIEW #3 to find.

## risks

- **R1 — Widening.** The ledger's discipline is that send-back repairs are contradictions, not improvements. D7 (row 4) and the DES-207 precision (row 5) describe what the tree does or what a row already promises; they widen nothing. Row 6 is the only widening, which is why it is bound to a task or dropped. If the synthesizer reads D7 as scope creep, the fallback is rows 1–3 only — and the next `bodies`-fed view will re-teach the lesson.
- **R2 — D7 mis-scoped.** A D7 that says "keep last-known" for all six views contradicts DES-207 (component, not last-known) and `models.js`/`issues.js`'s shipped behaviour. The scope sentence must name the `bodies`-fed views and point the ported tabs at DES-207.
- **R3 — retired by measurement.** QD3-O2 was reproduced for real this round (frontmatter `measured_this_round`): a 200 `{degraded}` on `/api/system` produces the throw, the empty panel and the frozen `live` tag. What remains open is only how often the SERVER emits that shape for `/api/system` in production (a `handleDashboardRequest` rejection, `server.ts:1101-1105`) — the client's behaviour when it does is no longer in question.
- **R4 — Footer rule too conservative.** "Advance only on `live`" freezes the stamp on a mixed tick where `issues.js` DID repaint its degraded component. That is acceptable — the stamp then under-claims, never over-claims — and it is one line to revisit if REQ-139's closure wants finer semantics.
- **R5 — The implementer already did design's work once this round.** If the synthesizer also lands rows 1–5 without a design-side `amended` marker, the ledger loses the record that the design gate ran. Every edit should carry the v27l marker even where the change is one token.

## expected disagreements with other lenses

- **Blocking vs not for QD3-C1.** The adversarial lens may say a signature alphabet typo is not blocking because UT `:75-79` pins the real value. I agree it is not *review*-blocking — but this is the design gate, the row is the one BF-3 was sent back for, and RE-REVIEW #2's own standard for this row was 「an implementer reading it verbatim」. One token; take it.
- **Whether to mint TASK-217.** The adversarial lens (simplicity-first) will likely prefer debt over a new draft task (+1 LOW row). My position: the ledger's rule is binary — clause with task, or no clause — and the class has now cost three send-back rounds; a priced S task is cheaper than a fourth. If they win, row 6 is dropped entirely, not half-written.
- **D7 as amendment vs new DES id.** They may want a dedicated row for "degraded handling across views". BF-3's precedent and the row-count price (a new DES id needs traces and a task parent) argue for an in-place D7; DES-206 already owns "invariants this layer may not lose", and a sixth belongs beside the five.
- **Footer: rule change vs relabel.** They may prefer 「最後輪詢 / Last poll」 as the zero-code fix. Refused above on fidelity grounds (the handoff fixes the label; DES-209's oracle is the delivery), but it is a legitimate tie-break for the owner if the code rule is disliked.
- **Whether `system.js` is this round's business at all.** They may argue QD3-O2 is RE-REVIEW #3's to find and route. I agree the *code* is — I do not ask this pass to touch `system.js`. I ask it to fix DES-207's `tests:` line so the promise is precise, because the imprecise promise is what let `val-202:104` pass with a selector.
- **The seam choice (§2).** They may push the stronger fix now — filter degraded bodies in `app.js`. I refuse it for this pass (no contradiction, a code change across four files, and `issues.js` needs the text) and record it for the REQ-137/138 closure.
