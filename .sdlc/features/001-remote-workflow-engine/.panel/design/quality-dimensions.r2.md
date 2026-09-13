---
stage: design
lens: quality-dimensions
iteration: v27 — Gate 8 RE-REVIEW #4 SEND-BACK, the DESIGN half (`BF-8`). I label it **v27m for reference only; the synthesizer coins the id.**
round: 2 (responses to `adversarial.r1.md` AND `adversarial.r2.md` — THIS round's, both at HEAD `2a738bd`; r2 is the one that read my r1, and it already supersedes its own r1 in two places — `run.js:512` and the tripwire's comment-line claim — which I answer at the r2 position, not the r1 one)
responds_to: `.panel/design/adversarial.r1.md` (230 lines, A-1..A-9, §3 rule text, §7 tripwire, §12 predictions) and `.panel/design/adversarial.r2.md` (416 lines, §1 table, §R1–§R5, §3 merged rule, §4 merged table, §5 tests, §7 remaining)
supersedes_on_disk: the v27l round-2 file at this path — `git show 24797c5:.sdlc/features/001-remote-workflow-engine/.panel/design/quality-dimensions.r2.md`. Read history with `git show`, never `checkout` / `restore` / `stash` — CLAUDE.md.
builds_on: my r1 at `quality-dimensions.r1.md` (this round's). Everything it verified that this file does not name stands unchanged — the population greps, the four literal families, the `undefined` hazard, P1–P3, DES-205's inherited text, the DES-207 sentence, the anchors clause, task-by-lane.
tree: HEAD `2a738bd`, `src/`+`tests/` clean. **Touched: this file only.** `04-design.md`, `03-tasks.md`, `src/`, `tests/` untouched by me.
position_changes_from_my_r1 (six, five against me — flagged so this file is not read as a silent rewrite):
  1. **「`home.js:226-231` is fully conforming today」 — FALSE, and measured false.** I cited `home.js:205` as painting from the `#rwe-init` island; `readIsland()` (`app.js:72`) feeds the UPDATE panel, and `app.js:429` first-paints Workflows as `renderHome(panel, { cards: [], lang })`, whose `updateCounts` (`home.js:153-159`) renders `(0)` three times. See `measured_this_round` (1).
  2. **`state.lastView` (my row 4's 「feed the last-known body」) — WITHDRAWN.** The adversarial's (N)-aged argument holds and my own Self-sustainability lens gives the second reason (§4.1).
  3. **Row 3's absolute (「an `ok` result ALWAYS repaints」) — SOFTENED** to the adversarial's bounded form; BF-7's own mandated guard violates the absolute (§R3).
  4. **The interim predicate — CONCEDED to one positive test of the declared success shape**, with a guard-rail I hold (§2.1): the tested key must come from `dashboard-wire.ts`'s `REQUIRED_*_KEYS` row, and `describe` has none.
  5. **My P2 grep — REPLACED** by the adversarial's regex: mine misses `workflow.js:326` (my r1 conceded 「by eye」); theirs hits all four, and comment-stripping is load-bearing (5 raw → 4).
  6. **「Region」 — DROPPED as normative vocabulary**; kept as the non-normative route→subtree map (their Table B). 「Subject」 stays — both r2s use it.
measured_this_round (nothing under `src/`/`tests/` touched; the probe lives in the session scratchpad and its recipe is pasted here because the scratchpad does not outlive the session):
  (1) **The `home.js` first-paint arm, in real Chromium** (`~/.cache/puppeteer/chrome/linux-152.0.7977.75`, real `createServer({port:0, workRoot: tmp, gateway: never-resolves})`, `workflow_register`+`workflow_publish`+`run_start` for `qdr2-running`, `workflow_register`+`workflow_publish` for `qdr2-registered`):
      - **A, control** — `goto /dashboard`, `networkidle0` + 4 s → `.segment-tabs button` = `["全部 (2)","執行中 (1)","已註冊 (1)"]`, 2 cards, `.rwe-connection[data-status]` = `live`, `pageerror` = `[]`.
      - **B, the disputed arm** — `setRequestInterception(true)` BEFORE `goto`; `/api/home` → 200 `{runs:[], degraded:'qd-r2 injected degrade'}`; `networkidle0` + 7 s (≥ 2 ticks) → `.segment-tabs button` = **`["全部 (0)","執行中 (0)","已註冊 (0)"]`**, 0 cards, `.card-grid` text `""`, tag **`degraded`**, `pageerror` = `[]`.
      - **C, the KEEP arm (BF-2's lock)** — healthy paint `(2)/(1)/(1)` `live`, THEN the same interception, 7 s → `(2)/(1)/(1)` unchanged, tag `degraded`, `pageerror` = `[]`.
      The adversarial's A-1 is **confirmed by measurement**: three fabricated counts on the primary page, in the real tabs' own styling, beside a truthful tag, for as long as the degrade lasts. My r1's disclosure list was wrong about the one site it called clean.
  (2) `grep -rnE "([Rr]es\.(body|status))" src/dashboard/ui/*.js | grep -E "(\|\||: )[[:space:]]*[\{\[]"` → **5 raw** (`workflow.js:321` is a comment) → **4 after comment-stripping**: `workflow.js:326`, `:327`, `run.js:502`, `agent-panel.js:234`. My r1's P2 regex → 3 (misses `:326`). The adversarial's §M1 self-correction reproduces.
  (3) `node -e "import('./src/dashboard/lib/strings.js').then(m=>console.log(m.t('zh','unavailable'), m.t('en','unavailable')))"` → `undefined undefined`. Unchanged.
  (4) `grep -n "REQUIRED_[A-Z_]*_KEYS = " tests/fixtures/dashboard-wire.ts` → `AGENT_LOG_OK`, `AGENT_LOG_ERROR`, `RUN_SUMMARY`, `DAG`, `DEGRADED`, `HOME` — **no `describe` row.** `REQUIRED_HOME_KEYS = ['running','registered','other']`; `REQUIRED_DAG_KEYS` includes `cells`; `REQUIRED_DEGRADED_KEYS = ['runs','degraded']`.
  (5) `poll.js:42-55`: `getJSON` parses the body on EVERY HTTP status (`res.json()` inside its own try) and classifies afterwards — so a non-2xx body carrying `degraded` reaches `issues.js:102` as `{status:'fail', body:{…degraded}}` and takes the degraded branch. A-8 is reachable, not theoretical.
verified_this_round (file:line reads, HEAD `2a738bd`): `app.js:60-80, 370-435`; `home.js:145-235`; `run.js:195-235, 300-320, 345-380, 440-515` (erase-before-append at `:219`/`:222`; `renderLegend` erases at `:354`, bails at `:360`; `:512`/`:513`); `workflow.js:290-375` (`:307-308` predicted branch, `:326-329`, `onPick` `:364-367` un-awaited and return discarded, `:370`); `system.js:68-91`; `models.js:45-69`; `issues.js:70-120`; `connection.js:1-50`; `val-199:255-300` (`:272` title 「drops the run-summary line」, `:282` `expect(before).not.toContain('undefined')`, `:295` `expect(after).toBeNull()`, `:297`); `val-202:125-167` (interception at `:137-144`, BEFORE `goto` at `:145`); `val-198` (grep `segment-tabs|全部|\([0-9]\)` over the whole file → 1 hit, `:155`'s `toBeGreaterThanOrEqual(0)`, not a count assertion — the home fix moves no lock); `dashboard-wire.ts:54-146`; `client-corpus.ts:20-35`; `dashboard-diagram-render.test.ts:95-116` (the corpus block the tripwire rides); `07-review.md:278-446` (§8 BF-7/BF-8 verbatim, §9 debt ids).
---

# Quality-dimensions — v27m DESIGN r2: converged on the whole rule — including the `home.js` first-paint arm, which I measured against myself; `state.lastView` withdrawn; two corrections held against the adversarial's r2 at file:line, both small

## summary

**The two r1s were one rule written twice, and the adversarial's r2 already merged them.** I adopt their §3 text as the base of the amendment rather than write a third copy: verdict-keyed; KEEP on a tick with the subject unchanged; clear-children + the ONE Unavailable component on a first paint or a subject change; no constructed payload; one string key in both languages; no `okBody`; no seam change; no new DES/TASK id; no ARCH edit; DES-205 inherits; DES-207 inherits; the ported tabs disclosed, not carved out; the disclosure table as the part that must not be cut. Where they took my wording (P3 whole, DES-205's panel text, the DES-207 sentence, the anchors clause, the `undefined` hazard, task-by-lane, the four literal families, D3-4's acknowledgment) I do not re-argue it.

**The one hard rebuttal in their r2 was against me, and I measured it rather than argue it.** §R1 said my 「`home.js` is fully conforming」 is false. It is: `app.js:429` first-paints `{cards: []}` and `home.js:231` bails every tick after. Real Chromium at `2a738bd` (frontmatter (1)): a deployment with two workflows reads **`全部 (0) · 執行中 (0) · 已註冊 (0)`** under a `degraded` tag for ≥ 2 ticks when `/api/home` is degraded from load, and `(2)/(1)/(1)` when it degrades after a healthy paint. That is the same predicate BF-7 blocks on — a fabricated quantity in the real element's own styling — on the product's primary page, and the review's §8 row 「`home.js:231` clean (BF-2)」 is true on the tick arm only. **Conceded at MID, measured.** The sentence that turns it from a severity argument into a rule is theirs and I adopt it verbatim: *paint memory is set ONLY by an `ok` route result reaching a paint function — never by `render()`, never by the island, never by an empty-shell default; a skeleton is not a paint.* §1.1 says why that sentence is an observability invariant and not just a rule.

**Three concessions on engineering grounds, one of them lens-native.** `state.lastView` is withdrawn: a remembered `agents[]` handed to `paintSwimlane` in the slot of THIS tick's value renders an APPLIED model with unlabelled provenance beside cells that just repainted from a fresh `/dag` — the (N) class aged instead of invented — and, from my own fourth dimension, a cache is state with a lifecycle (which subject, how stale, what clears it) that the split/skip shapes do not have (§4.1). Row 3's absolute is softened to their bounded form because BF-7's own mandated guard skips the composite whole on a degraded `/dag` with an `ok` `/api/runs/:id`, and a clause that contradicts the impl row it specifies is BF-3 again. The interim predicate becomes one positive test of the declared success shape — it is fail-closed for `degraded` and `fail` alike and it is one test where mine was two.

**Two corrections I hold against their r2, both at file:line, both small — the only live items left:**
1. **(V)'s stand-in has no fixture row for `describe`.** The positive-shape test must test the key the wire fixture DECLARES (`REQUIRED_*_KEYS`, ADR-054's control) or it is an ad-hoc coupling with a better name; the fixture has rows for `/api/home`, `/dag`, `/api/runs[i]`, the degrade envelope — and **none for `describe`** (frontmatter (4)), although the route's shape IS declared elsewhere (DES-132's parity with the `workflow_describe` response, `server.ts:398`) and the tree already reads it positively (`describe.params` at `workflow.js:299`, `run.js:495`). `workflow.js:357`'s describe half is `describe.degraded` — a truthiness sniff with no positive test beside it — so under the adversarial's own (V) wording the site their §7 calls 「conforming under both」 is not. The reconciliation is one sentence (§2.1): the key comes from the route's fixture row; where no row exists yet, a PRESENCE test of the declared degrade envelope (`'degraded' in body`, `REQUIRED_DEGRADED_KEYS`) is the sanctioned interim — a positive test of the other declared shape, not a sniff — and adding `REQUIRED_DESCRIBE_KEYS` (mirroring the `workflow_describe` response, with `params` as the tested key) is the exit.
2. **Split does not reach the swimlane's row 2.** Split is right for the legend (`run.js:354` erases, `:360` bails; warnings ← `/dag`, `.run-summary` ← `/api/runs/:id`) and for `#run-usage` (whole-sourced → under KEEP the call is simply not made). But `paintSwimlane` `replaceChildren()`s the svg (`run.js:219`) and the cell layer (`:222`) before appending — the cells are REBUILT every paint, so row 2's APPLIED model has no subtree to leave unwritten. For `run.js:502` / `workflow.js:327` the operative arm is their own (O) fallback, skip-whole: BF-7's guard extended to the sibling. Their disclosure row names 「split」 as the fix shape for `:502`; it should say skip-whole (§1.3).

**A-2, A-7, A-8 — unaddressed by my r1, conceded as filed.** A-2 is the one most likely to cost a round: BF-7's guard placed before `workflow.js:328` leaves the previous `.run-summary` standing on BF-6's both-routes case, so `val-199:295`'s `expect(after).toBeNull()` goes RED. Their remedy — the invariant `expect(after?.textContent).toBe(before)` plus renaming `:272` — holds under both arms (both degraded → KEEP → unchanged; view-only degraded under split → summary subtree untouched) and it must travel in BF-7's dispatch text, not be discovered by the implementer.

**Nothing in this file needs a new DES id, a new TASK id, an ARCH edit or a line of code.** The edit list is my r1's six rows, with the amendment text now the adversarial's §3 plus five named amendments (§5).

## Altitude call

Unchanged and agreed with both adversarial rounds: a poll loop, a classifier, seven view modules and their ledger rows — **system altitude throughout**. The agent altitude enters one hop out (the dashboard is the operator's only continuous 「is what I see true」 while agent runs are in flight) and at one site (`agent-panel.js`, DES-205's inherited clause). Nothing else at the agent altitude is touched, and I do not manufacture a per-dimension agent reading where there is none.

---

## §0 Scoreboard — every disagreement, adjudicated

| # | Item | Adversarial (r2 position) | My r1 | **Verdict** | Basis |
|---|---|---|---|---|---|
| S-1 | `home.js` first paint — 「fully conforming」 | REBUT (§R1), MID, derived not measured | conforming | **CONCEDE — MEASURED** (frontmatter (1)): `(0)/(0)/(0)` under `degraded`, ≥ 2 ticks | `app.js:429`, `home.js:153-159`, `:231`; the probe |
| S-2 | `state.lastView` for two-route paints | REBUT the remedy (§R2) | row 4 | **CONCEDE — WITHDRAWN**; (N)-aged + lifecycle (§4.1) | `run.js:313` renders `rec.model` identically to `declared` |
| S-3 | `run.js:512` erases `.run-summary`; not exempt | CONCEDED to me (§R2) | §1.3 | **CONVERGED** — line is `:354` (they wrote `:353`) | `renderLegend` erases at `:354`, bails at `:360` |
| S-4 | split vs skip for an unsplit composite | 「split the element」 as the fix shape incl. `:502` | — | **HOLD a correction**: split for legend + usage; **skip-whole for `paintSwimlane`** (§1.3) | `run.js:219`/`:222` rebuild cells every paint |
| S-5 | row 3 「`ok` ALWAYS repaints」 | REBUT as absolute (§R3) | row 3 | **CONCEDE** — their bounded text adopted | BF-7's guard skips the composite whole |
| S-6 | interim predicate: one positive test vs classifier predicate + optional shape | HOLD (§R4) | §2.1 | **CONCEDE the single positive test; HOLD the source guard-rail** — key from `REQUIRED_*_KEYS`; `describe` has no row (§2.1) | frontmatter (4); `workflow.js:357` |
| S-7 | 「region」 as normative vocabulary | CONCEDE substance, HOLD wording (Table B non-normative) | §1.1 | **CONCEDE** — 「derived from the non-`ok` resource」 + (O) is the normative test; map kept as aid | — |
| S-8 | A-2 — BF-7's guard turns `val-199:294` RED | HOLD (§R5) | not addressed | **CONCEDE as filed; remedy adopted; travels with BF-7** | `val-199:272, :295` |
| S-9 | A-7 — `onPick` and the tabs' `render()` discard statuses | HOLD | not addressed | **CONCEDE** — LOW, ≤ 1 tick lag; the (R) clause (§1.2) | `workflow.js:367` un-awaited; `system.js:90`, `models.js:68`, `issues.js:119` |
| S-10 | A-8 — `issues.js:102` degraded branch on a non-2xx body | HOLD | not addressed | **CONCEDE** — reachable: `getJSON` parses every status (frontmatter (5)) | `poll.js:44-49`, `connection.js:46` |
| S-11 | tripwire regex vs my P2 grep | theirs; comment-stripping load-bearing (§M1) | §1.2 greps | **CONCEDE** — mine misses `:326`; 5 → 4 reproduces | frontmatter (2) |
| S-12 | marker literal families: four, not five | CONCEDED to me | §1.2 | **CONVERGED** | `issues.js:103` is P3's 2nd clause |
| S-13 | ported tabs: disclosed LOW, `painted` flag, no carve-out, BF-4 closed | CONCEDED (「we already agreed」); verified safe vs `val-202` | §1.4 | **CONVERGED** — I re-verified: interception at `val-202:137-144` precedes `goto` `:145` | file |
| S-14 | string key: both languages, same commit; zh `無法取樣` | CONCEDED + adopted | §3.2 | **CONVERGED**; one rider — en is REQ-138's `Unavailable` (`01-requirements.md:1874`), not the implementer's | frontmatter (3) |
| S-15 | DES-205 inherited text; DES-207 sentence; anchors-not-children; `okBody`; seam; ARCH pointer; task-by-lane; D3-4 acknowledgment | CONCEDED + adopted | mine | **CONVERGED** — not re-argued | — |
| S-16 | `issues.js:80` hides the detail box on a subject change | (U), LOW | not seen | **CONCUR** | `issues.js:80-83` |
| S-17 | routing of the `home.js` repair | synthesizer's call | — | **NOT A HOLD** — one recommendation (§6) | BF-7's 「scope is exactly this」 |

**Net:** eight concessions (S-1, S-2, S-5, S-6's main clause, S-7, S-8, S-9, S-10, S-11), five converged, one concur, **two held corrections** (S-4, S-6's guard-rail), one recommendation. No contradiction between the lenses survives on the rule itself.

---

## 1. Observability — transparency of internal state

### 1.1 The invariant the measurement exposes: a skeleton is not an observation

The owner's first motive for v27 is observability, and every round of this loop has blocked on one property — the page must not tell the operator something untrue. The probe (frontmatter (1)) shows the property has a fourth way of failing that neither BF-2's bail nor my r1's row 1 sees: **a render that happened before any route answered is treated as 「last-known」 by the KEEP arm, and last-known of NOTHING is a skeleton's defaults rendered as data.** `app.js:429`'s `{cards: []}` is honest as a skeleton and a lie the moment `home.js:231` decides it is worth keeping. The tag beside it says `degraded` — truthful — and the operator, who reads the number and not the tag, sees three zeros.

So the adversarial's sentence is the observability invariant of this round and goes in the clause as normative text: **paint memory is set ONLY by an `ok` route result reaching a paint function.** Never by `render()`, never by `readIsland()`, never by an empty-shell default. The reason it is an observability rule and not merely a correctness one: the KEEP arm's whole justification is that the region is a WITNESS of a prior observation (「here is what it was」) while the tag witnesses the staleness (「it is from before」). A skeleton witnessed nothing, so keeping it is not preserving evidence — it is fabricating it.

**The fix shape for `home.js`, so impl has it and the clause is not a bare demand:** `state.painted` is set in `onTick`'s `ok` path only. Until it is set, `updateCounts` renders each segment label WITHOUT the parenthetical — `全部` not `全部 (0)` — because an omitted count states nothing while `(0)` states a falsehood ((O)'s own test, applied to the one composed element on this page); and the grid holds the ONE Unavailable component under (U). The first `ok` tick repaints both and sets the memory (row 3). The `ok` path is unchanged, so `val-198`'s healthy-path assertions and its KEEP lock (`:262`) do not move (verified: no count assertion in `val-198` at all). The falsifying case is the probe's page B, written out in §3.1.

### 1.2 Every observed status reaches the reducer — the (R) clause is mine to carry

A-7 is squarely this lens and my r1 missed it. `workflow.js:367`'s `onPick` calls `paintSelected(...)` without `await` and discards the statuses it returns; `system.js:90`, `models.js:68`, `issues.js:119`'s `render()` call `onTick` and discard its return. A degrade observed on exactly the path BF-8 says needs the UNAVAILABLE arm (a run-switch, a tab's first paint) does not reach `nextConnection` until the NEXT scheduled tick re-fetches — a lag of at most one tick (≤ 3 s), which is why it is LOW. The clause states the obligation ((R): a KEEP or UNAVAILABLE disposition still returns the statuses of the fetches it made) and discloses the four callers; the fold is one `await` + one `Object.assign` when the debt is dispatched, and it should ride the same lane as the tabs' `painted` flag.

One interaction to record: the fold at `onPick` makes the tag react within the click's own paint rather than the next tick — which is the ONLY way the operator learns, at the moment of switching runs, that the marker they are looking at is a fault and not a slow load. That is the observability value of (R); the reducer needs no change for it.

### 1.3 The composed-element correction — split where a subtree exists, skip-whole where the composite is rebuilt

The adversarial's §R2 is right about the legend and I concede the cache; but their disclosure row prescribes 「split」 for `run.js:502` and the code does not allow it. `paintSwimlane` erases the svg (`run.js:219`) and the cell layer (`:222`) and rebuilds every cell; row 2's model text (`:313`) is written fresh into a fresh element on every paint. There is no `/api/runs/:id`-owned subtree to leave unwritten. Three honest options exist for that composite and only one needs no new question answered:
- **skip-whole** (their own (O) fallback): `if (dagRes.status !== 'ok' || viewRes.status !== 'ok') return {…statuses}` on the KEEP arm — BF-7's guard extended to the sibling. Writes nothing; bounded by the next tick on which both routes are `ok`; the tag is the witness. **This is the fix shape for `run.js:502` / `workflow.js:327`.**
- render row 2 as the marker glyph per cell: (U) at cell granularity — consistent, noisy, and a `paintSwimlane` signature change (`agentsById: null` meaning UNKNOWN vs `new Map()` meaning NONE). Optional future refinement; not this clause's demand.
- the cache — withdrawn (§4.1).

The price of skip-whole is that an `ok` `/dag`'s state colours are withheld while `/api/runs/:id` is non-`ok`. That is the same price BF-7 already pays in the other direction and it is bounded the same way. On the (U) arm an unsplit composite takes the marker whole — a figure whose row 2 would lie is not painted. For the legend (`:354`/`:360`) and `#run-usage` (`:513`) split is right and costs ~4 lines and zero state; the disclosure table (§5) now says which shape applies to which line.

### Verified consistent (Observability)

- The classifier is total and fail-closed (`connection.js:45-50`); `getJSON` never throws and parses on every status (`poll.js:42-55`) — which is what makes A-8 reachable and (V)'s 「verdict where in hand」 non-negotiable at `issues.js:102` and `models.js:55`.
- The KEEP arm holds where it was pinned: frontmatter (1)(C) is BF-2's lock re-measured — `(2)/(1)/(1)` survives the degrade, tag `degraded`, no page error.
- Server witness unchanged: every client-visible degrade has a `dashboard_api_degraded` journal line with `route` + closed `reason` (`server.ts:615`, `:1103`).
- Still debt, unchanged by the clause: `D3-3` (an `onTick` throw freezes the tag — `app.js:379` unguarded); `D3-4` (the footer stamps a skipped tick — now KNOWINGLY false under KEEP; the clause says so, per both r2s); `QD2-O2` (the tabs double-fetch).

---

## 2. Replaceability — decoupling & pluggability

### 2.1 (V)'s stand-in — conceded to one positive test, with the source named (the held correction)

My r1 argued the classifier's predicate on the body because a view that re-derives 「is this ok?」 from body shape is coupled to the server's degrade envelope. The adversarial's answer is better on my own terms: a positive test of the route's SUCCESS shape couples the view to the contract it must already know to render, is fail-closed for `degraded` (no `running` key) and `fail` (`null` body) alike, and is one test where mine was two. **Conceded.**

But 「the declared success shape」 must name WHO declares it, or the next implementer invents one per view — which is coupling with a better name. The tree already has the declaration: `tests/fixtures/dashboard-wire.ts`'s `REQUIRED_*_KEYS` rows are ADR-054's key-set control, read by the server-side disclosure oracle. So the clause says: **the key a stand-in tests is the one the route's `REQUIRED_*_KEYS` row declares** — `REQUIRED_HOME_KEYS` → `Array.isArray(body.running)` (`home.js:231`), `REQUIRED_DAG_KEYS` → `Array.isArray(dagBody.cells)` (`run.js:475`), the `/api/runs` array → `Array.isArray(bodies[runsUrl])` (`workflow.js:357`). Then a wire change is one fixture row, and the client's stand-in and the server's oracle fail together and loudly — the replaceability property both r1s wanted from the seam, obtained without the seam.

And the fixture has **no row for `describe`** (frontmatter (4)) — the route's shape is declared by DES-132's parity with the `workflow_describe` response (`server.ts:398`), and `workflow.js:299` / `run.js:495` already read `describe.params` positively, so the declaration exists and only the fixture row is missing. `workflow.js:357`'s describe half is `!describe || describe.degraded` — a truthiness sniff for the degrade shape with no positive test beside it, i.e. exactly the form the adversarial's (V) says 「never」, at a site their §7 lists as conforming under both wordings. Two ways out, and the clause should pick the cheap one now and name the other: **where the fixture declares no success row, a PRESENCE test of the declared degrade envelope (`'degraded' in body` — `REQUIRED_DEGRADED_KEYS`, `connection.js:48`'s own predicate) is the sanctioned interim** — it is a positive test of the OTHER declared shape, not a sniff — and adding `REQUIRED_DESCRIBE_KEYS` to the fixture (mirroring the `workflow_describe` response, with `params` as the tested key) is the exit, after which the test moves onto it. `:357`'s truthiness form (`{degraded:null}` slips; measured `degraded` by the classifier at v27l) is the redundant-sniff class, LOW, corrected when the site is next touched. This keeps `:357` conforming as written and gives the next author a rule with no gap in it.

### 2.2 Why no cache, in replaceability terms

`state.lastView` would have put a per-view staleness policy in six `ui/` files with no shared owner — the exact 「four incompatible behaviours」 shape this round exists to end, one hop later. Skip-whole has no policy; split has no state. Either survives a wire change untouched.

### Verified consistent (Replaceability)

- No helper: `okBody(res, fallback)` refused by both lenses and the reviewer; a helper cannot fix a site whose bug IS the fallback it returns.
- The marker is one component, one class (`.empty`, `dashboard-classes.ts:28`), one key in one table; four literal families become one key; en `Unavailable` is REQ-138's pair, not a per-implementer choice.
- `poll.js`'s `ROUTES` table and the reducer are untouched; the paint-memory field is view-private state in the existing `WeakMap`s.
- The ARCH row should later carry a one-line pointer to the clause, never a copy (`D3-6`, architect's lane) — both lenses.

---

## 3. Consumability — ease of use & low integration cost

### 3.1 The `tests:` line, merged — and the home case now has a measured recipe

The adversarial's §5 is the `tests:` line I want, with three things added from this round:

- **Invariant across the fault, never presence/absence.** `expect(after).toBe(before)` on a counted DOM property. A-2 is the proof it matters: `val-199:295` asserts `toBeNull()` on an element that BF-7's guard correctly preserves. The remedy — `expect(after?.textContent).toBe(before)` and retitle `:272` (it says 「drops the run-summary line」; under the rule it KEEPS it) — holds under both arms and **must be stated in BF-7's dispatch text**, or the implementer softens the guard to keep the old assertion green and BF-7 re-opens. BF-5/BF-6 stay closed: their `not.toContain('undefined')` assertions at `:282`/`:297` are untouched.
- **A new case targets the arm its site does not pin.** In severity order: **`home` first paint** — the probe's page B verbatim: `setRequestInterception(true)` before `goto`, `/api/home` → 200 `{runs:[], degraded}`, `networkidle0` + 7 s; assert no `.segment-tabs button` text matches `/\(\d+\)/`, exactly one `.empty` inside `.card-grid`, `.rwe-connection[data-status] === 'degraded'`, `pageerror` empty. Then `system` tick (flip `val-202`'s handler behind a boolean so the first load succeeds; assert `.sys-table tr` count unchanged after the degrade); `run`/`workflow` first paint; and BF-7's own asymmetric case (`/dag` alone; `[data-node-cell]` count UNCHANGED; `.run-summary` still true; `pageerror` empty ≥ 2 ticks).
- **The tripwire, as the adversarial specified it** — regex `[Rr]es\.(body|status)` ∧ `(\|\||: )\s*[{[]`, the test strips comments itself (load-bearing: 5 → 4, frontmatter (2)), allowlist keyed on `(file, matched line text)` via a per-file walk over `listJsFiles` (never a line number), `expect(clientCorpus().length).toBeGreaterThan(5000)` beside it (DES-208's anti-vacuity anchor), `toBe(3)` after BF-7 with each entry carrying its debt id, may only shrink. It rides BF-7's impl dispatch (which already edits test files, ~12 lines in `dashboard-diagram-render.test.ts:95-116`'s corpus block) or is written as OWED in the 未實作 form — never as if it exists. My r1's greps are what it replaces; they were the same artefact at a lower maturity.

### 3.2 The row as the next implementer reads it

The base text is the adversarial's r2 §3 — (V), (K)/(U) with the paint-memory sentence, (O), (N), (S), (R), section≠route, DES-205 verbatim, DES-207 inherits, the D3-4 acknowledgment, Table B non-normative. My amendments (§5) are five sentences, each placed inside the clause it refines, so the implementer reads one rule, not two. The disclosure table is the last thing to cut — both lenses, three times now.

### Verified consistent (Consumability)

- DES-206's `render(container, vm, handlers)` + `onTick(container, bodies, ctx)` contract is unchanged; `painted` and the split subtrees are view-private.
- The five BF locks reuse one fixture shape (`{runs:[], degraded}`, `dashboard-wire.ts:116`) and one recipe (`setRequestInterception`); the new cases add no machinery — the probe used nothing the tests do not already import.
- `04-design.md:7285` is honoured by disclosure with an owner per row, as both r1s argued and the adversarial's r2 restated.

---

## 4. Self-sustainability — closed-loop autonomy & lifecycle

### 4.1 Why the cache loses on lifecycle — the lens-native reason for withdrawing `state.lastView`

A dashboard tab is this round's long-lived process; anything it remembers it must also metabolise. `state.lastView` would have been state with three unanswered lifecycle questions — which subject was it for, how stale is too stale, what clears it — in six files, on a round whose purpose is to stop minting unstated arms. Skip-whole remembers nothing; split remembers nothing; the `painted` flag is one boolean whose only transition is set-on-`ok`. A design that can run for hours without a human should carry the minimum state that has a lifecycle, and here the minimum is one bit per view.

### 4.2 Convergence and recovery under the softened row 3

With KEEP and the bounded skip, a tab left open through a sustained degrade reaches a truthful fixed point after one tick: last-known subtrees + a `degraded`/`offline` tag, no churn (today `workflow.js:326-328` re-erases and re-draws an empty figure every 3 s — the 「alive, busy and wrong」 loop), no growth. A tab OPENED during the fault reaches its fixed point after one tick too: the marker, and the same tag. Recovery: the first tick on which every contributing route is `ok` repaints its subtree (split) or the composite (skip), replaces the marker, sets the memory, and the reducer's un-debounced recovery (`connection.js:27-29`) turns the tag `live` in the same tick. The bounded exception in row 3 does not weaken this — it names the one case (an unsplit composite) where recovery waits for BOTH routes rather than one, and it is bounded by the next all-`ok` tick, never by a reload.

### 4.3 The `painted` flag on the ported tabs is safe against its own lock

`val-202` installs its interception at `:137-144`, before `goto` at `:145` — `system.js` never has a successful paint in that case, so a `painted` flag that gates the marker leaves the BF-4 lock green (the adversarial verified this; I re-read it). After the flag, a transient catch-all degrade no longer erases a populated table every 3 s — the tabs get the same fixed point as the views.

### 4.4 What the rule does NOT close

`D3-3` (a throwing `onTick` freezes the tag; the fold shape agreed at v27l stands), `D3-4` (the footer; the tick-conditioned rule from v27l stands, still zero-task), `QD2-O2` (the tabs' second fetch path), `F-7 ≡ QD-S2` (`initZoomable`'s `window` listeners). Memory metabolism at the agent altitude is out of this round's subject; the 2 KB event-row clip and `?limit=500` + `hasMore` remain the v27 answer.

---

## 5. Final position — what design should edit this pass

Zero new DES ids, zero new TASK ids, zero ARCH edits, zero lines of code. `iter: v27m` (or whatever the synthesizer coins). Round 2 writes only this file.

| # | Row | Edit | Needs a task? |
|---|---|---|---|
| 1 | DES-206 `boundary:` (`04-design.md:6850`) | **the adversarial's r2 §3 text as the base**, with amendments A–E below placed inside the clauses they refine | no — disclosed debt with ids; BF-7 applies it at the blocking site |
| 2 | DES-206 `tests:` (`:6851`) | §3.1 — invariant-across-fault; the per-arm cases with the home case's measured recipe; the tripwire spec (or OWED) | no |
| 3 | DES-206 dated `amended (2026-09-13, v27 Gate 8 RE-REVIEW #4 — BF-8)` line | names the finding, the four behaviours it replaces, what did NOT change, the disclosure table | no |
| 4 | DES-205 `boundary:` + `tests:` + dated line | inherits verbatim — my r1 §1.5 text as the adversarial adopted it | no — `QD-O5` debt for the fix |
| 5 | DES-207 `boundary:` | one sentence: section ≠ route; inherits (V)/(K)/(S) | no |
| 6 | `lib/strings.js` key named IN the clause | `unavailable: { zh: '無法取樣', en: 'Unavailable' }` — both languages, BF-7's commit | no — lands with BF-7 |

**Amendments to the adversarial's r2 §3 text (verbatim, placement named):**

> **A — into (V), after 「positive test of the declared success shape, null-guarded」:** The key the stand-in tests is the one `tests/fixtures/dashboard-wire.ts` declares in that route's `REQUIRED_*_KEYS` row (ADR-054): `running` for `/api/home` (`home.js:231`), `cells` for `/dag` (`run.js:475`), the array itself for `/api/runs` (`workflow.js:357`). Where the fixture declares no success row for a route — `describe` at v27m — the interim is a PRESENCE test of the declared degrade envelope (`'degraded' in body`, `REQUIRED_DEGRADED_KEYS`), never a truthiness test (`describe.degraded`, `workflow.js:357`, LOW); the exit is adding `REQUIRED_DESCRIBE_KEYS` (mirroring the `workflow_describe` response — DES-132 parity, `server.ts:398` — with `params` as the tested key, already read at `workflow.js:299` / `run.js:495`), after which the test moves onto it.

> **B — into (K)/(U), as the normative sentence the adversarial already wrote, kept verbatim:** Paint memory is set ONLY by an `ok` route result reaching a paint function — never by `render()`, never by the `#rwe-init` island, never by an empty-shell or `{cards: []}` default. A skeleton is not a paint. **Measured at v27m:** `/api/home` degraded from load renders 「全部 (0) · 執行中 (0) · 已註冊 (0)」 for a deployment with two workflows, ≥ 2 ticks, tag `degraded`, no page error.

> **C — into (O), replacing 「split it so each route owns a subtree; where it is not split, skip the composite paint whole」:** Split where the element already has per-route subtrees — the legend (`run.js:354` erases, `:360` bails: warnings ← `/dag`, `.run-summary` ← `/api/runs/:id`) and `#run-usage` (whole-sourced: under KEEP the call is not made). Where the composite is REBUILT whole on every paint — `paintSwimlane` erases the svg (`run.js:219`) and the cell layer (`:222`) before appending, so row 2 has no subtree to leave unwritten — the arm is skip-whole: BF-7's guard extended to the sibling (`dagRes.status !== 'ok' || viewRes.status !== 'ok'`), bounded by the next tick on which both are `ok`; under (U) the composite takes the marker whole. A finer split (row 2 as a subtree the cell keeps) is optional future work, not this clause's demand.

> **D — into (U), the `home.js` shape:** until `painted` is set, `updateCounts` renders the segment label WITHOUT the parenthetical (an omitted count states nothing; `(0)` states a falsehood) and the grid holds the ONE Unavailable component; the first `ok` tick repaints both.

> **E — into (S):** the en value is `Unavailable` — REQ-138's own pair (`01-requirements.md:1874`) — so both halves of the key are pinned by a REQ, not chosen per implementer.

**The merged disclosure table** — the adversarial's §4 with three changes in bold (home row MEASURED; `:502`/`:327` fix shape corrected; `describe` row added):

| site | arm | rule | HEAD | disposition |
|---|---|---|---|---|
| `workflow.js:326` | any | (N) | synthesizes the empty DAG payload, prints 「0 個節點」 | **BF-7 — blocking, impl, this round** |
| `home.js:231` + `app.js:429` + `home.js:153-159` | first paint | (U) | bails → 「全部 (0) · 執行中 (0) · 已註冊 (0)」 stands indefinitely | **MID — MEASURED in Chromium at `2a738bd` (frontmatter (1)); the review's §8 「clean (BF-2)」 row is true on the tick arm only. Fix shape: §1.1. Routing: §6.** |
| `agent-panel.js:234-241` | first paint | (U),(N) | synthesizes a zeroed record; false system-prompt sentence | MID — `QD-O5` ≡ `A4-3`, DES-205's lane |
| `run.js:512` + `:513` | tick | (O) | `renderLegend(…, null)` erases `.run-summary` (`:354` before `:360`); `renderUsageBox` clears `#run-usage` | LOW — `QD3-O2`; not exempt; fix = split the legend subtree, do not call `renderUsageBox`; BF-5 stays closed |
| `run.js:502`, `workflow.js:327` | any | (N) | APPLIED model silently replaced by DECLARED | **LOW — `QD3-O2` class; fix shape = skip-whole (BF-7's guard extended to `viewRes.status`), NOT split — `paintSwimlane` rebuilds cells (`run.js:219`/`:222`)** |
| `run.js:475`, `workflow.js:357` | first paint | (U) | bails → empty shell, no marker | LOW — (U)'s cost, disclosed |
| **`workflow.js:357`** (describe half) | — | (V) | **`describe.degraded` truthiness sniff; no positive test; no `REQUIRED_DESCRIBE_KEYS` row exists** | **LOW — interim = presence test of the degrade envelope; exit = add `REQUIRED_DESCRIBE_KEYS` (`params`)** |
| `system.js:78`, `models.js:55`, `issues.js:102` | tick | (K) | no paint memory → last-known erased every non-first non-`ok` tick | LOW, disclosed, no carve-out; fix = `painted` flag (safe vs `val-202`); BF-4 stays closed |
| `models.js:55`, `issues.js:80`/`:102` | — | (V) | verdict re-derived from body while `res.status` is in hand | LOW ×3 (A-8; reachable — `getJSON` parses every status) |
| `issues.js:80` | subject change | (U) | hides the detail box silently | LOW |
| `system.js:29`, `models.js:56`, `app.js:198`, `:414` | — | (S) | four literal families, two single-language | LOW — `QD-R3`, REQ-131 acceptance |
| `issues.js:103-104` | — | (S) 2nd clause | renders the wire's `degraded` value (REQ-067's designated field) | LOW — `A4-2`, architect's lane |
| `workflow.js:367`, `system.js:90`, `models.js:68`, `issues.js:119` | — | (R) | observed statuses discarded | LOW (A-7) |
| `app.js:379` | — | (V) | drops the statuses at the seam | LOW — `D3-5`, out of scope by ruling |
| `app.js:386` | — | — | stamps freshness on a tick KEEP designed to skip | LOW — `D3-4`, now knowingly false |

**Where task-splitting affects this lens** — converged with the adversarial: no TASK id this round (BF-8 forbids it). When the disclosed sites are dispatched: ONE task per LANE (DES-206 sweep / DES-205 panel), DoD = the tripwire count and the P3 grep reaching their expected values plus one real-browser case per arm per view — never one task per site.

---

## 6. Remaining disagreements — short, and honestly so

1. **Two corrections the adversarial has not seen** (their r2 predates this file): **(V)'s fixture-sourced key and the `describe` gap** (§2.1); **split's reach stops at `paintSwimlane`** (§1.3). Both are file:line (`dashboard-wire.ts` has no describe row; `run.js:219`/`:222` rebuild cells) and I expect them to be taken, not fought. If the synthesizer lands only one, land the (O) correction — a disclosure row that prescribes an impossible fix shape is the thing the next implementer trips on.
2. **Routing of the `home.js` repair — a recommendation, not a hold.** Both lenses defer to the synthesizer/reviewer. My recommendation: it rides BF-7's commit. Same predicate the review used to rank BF-7 blocking (a fabricated quantity in the real element's styling), a bigger surface (the primary page), the same two-arm fix, a six-line case, and a measured run already in hand; leaving a MID fabricated count on the primary page while closing one on a sub-page is a RE-REVIEW #5 the retro at `07-review.md` §10 already predicts (「the scope must be the class, not the line」). If the reviewer holds BF-7 to 「exactly this」, then the row heads the next dispatch at MID with the recipe in §3.1.

**Not disagreements, listed so the synthesizer does not hunt:** the rule text (theirs, with A–E), `state.lastView` (withdrawn), row 3 (softened), the interim predicate's main clause (one positive test), 「region」 (non-normative), A-2's remedy, A-7, A-8, the tripwire, the ported tabs, the string key, DES-205/207, the anchors, `okBody`, the seam, the ARCH pointer, task-by-lane, D3-4's acknowledgment, and the disclosure table — **the last thing to cut**, for the fourth time in writing.

## key_points

1. **`home.js` first paint is a MID, measured**: `(0)/(0)/(0)` under `degraded` for ≥ 2 ticks with two workflows registered; `(2)/(1)/(1)` when the degrade follows a healthy paint. My r1 was wrong; the review's 「clean (BF-2)」 row is true on the tick arm only.
2. **Paint memory is set only by an `ok` paint** — a skeleton is not an observation. Normative, in (K)/(U).
3. **`state.lastView` withdrawn** — (N)-aged, and state with a lifecycle the split/skip shapes do not have.
4. **Split reaches the legend and `#run-usage`; not the swimlane** — `paintSwimlane` rebuilds cells (`run.js:219`/`:222`); `run.js:502`/`workflow.js:327` take skip-whole, BF-7's guard extended to `viewRes.status`.
5. **(V)'s stand-in tests the key the wire fixture declares** (`REQUIRED_*_KEYS`, ADR-054); `describe` has no row (its shape is DES-132's, read at `workflow.js:299`/`run.js:495`), so its interim is a presence test of the degrade envelope and the exit is `REQUIRED_DESCRIBE_KEYS` with `params` as the key.
6. **A-2 must travel with BF-7**: `expect(after?.textContent).toBe(before)` and retitle `val-199:272`, or the guard gets softened to keep a wrong assertion green.
7. **The tripwire is the adversarial's**, comment-stripping load-bearing (5 → 4), `(file, text)` allowlist, anti-vacuity anchor, `toBe(3)` after BF-7.
8. **Zero new ids, zero code**; six in-place edits; one task per lane when the debt is dispatched, DoD = the greps.

## risks

- **R1 — Amendment C's price is visible on the run page.** Skip-whole withholds an `ok` `/dag` repaint while `/api/runs/:id` is degraded. Bounded by the next all-`ok` tick and witnessed by the tag; the alternative (a per-cell marker) is a signature change and is named as optional.
- **R2 — Amendment A adds a dependency from `ui/` prose to a test fixture.** It is a dependency on a DECLARATION the server side already reads (ADR-054), not on a test; if the synthesizer prefers, the sentence can name the keys inline and cite the fixture as their source.
- **R3 — The home fix's 「label without a count」 may read as a regression to someone comparing screenshots.** It is (O)'s own test applied; the alternative — a marker inside the tab button — is noisier and states the same thing.
- **R4 — Routing.** If the home repair neither rides BF-7 nor heads the next dispatch, the primary page keeps a measured MID lie under a clause that names it. Disclosure prevents the silent case; it does not prevent the slow one.
