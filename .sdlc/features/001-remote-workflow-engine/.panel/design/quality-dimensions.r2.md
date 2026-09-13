---
stage: design
lens: quality-dimensions
iteration: v27 — Gate 8 RE-REVIEW #2 SEND-BACK, the DESIGN half (I labelled it **v27l for reference only; the synthesizer coins the id**; the adversarial lens wrote v27L — same round)
round: 2 (responses to `adversarial.r1.md` — THIS round's, the v27L one dated 2026-09-13 — plus my final position)
responds_to: `.panel/design/adversarial.r1.md` (295 lines, all nine sections, six findings AD-1..AD-6, seven edits E1..E7, seven risks, six predicted disagreements)
supersedes_on_disk: the v27j round-2 file at this path — `git show 8d3584b:.sdlc/features/001-remote-workflow-engine/.panel/design/quality-dimensions.r2.md` (verified: `git log -1 -- <path>` → `8d3584b`, on-disk bytes == committed). Read history with `git show`, never `checkout` / `restore` / `stash` — CLAUDE.md.
builds_on: my r1 at `quality-dimensions.r1.md` (this round's). Everything it verified and settled that this file does not name stands unchanged — BF-3 holds, QD3-C1/C2/O1/O2/O3/O4 as found; this file records what moved after reading the adversarial r1, one hole the round-2 review found in my own footer rule, and the merged edit list.
verified_this_round (HEAD `57ad237` unchanged; `src/`+`tests/` unchanged since `b124430`): `04-design.md:6811-6819` (DES-202 incl. both amended lines), `:6845-6851` (DES-206 — the `[v27c]` paragraph that states the seam), `:6853-6859` (DES-207), `:7270-7290` (the SETTLED paragraph and the 「clause with no task is worse than neither」 rule at `:7285`); `07-review.md:200-305` (§8 BF-1/2/3 verbatim — BF-2's required shape names `home.js` and `run.js` only; §9; §10 retro); `02-architecture.md:3356-3378` (ARCH-124/125 `api:`); `src/dashboard/lib/connection.js:1-50`; `ui/poll.js:1-55`; `ui/app.js:111-148, 355-400`; `ui/system.js:20-80`; `ui/issues.js:95-110`; `ui/models.js:48-65`; `ui/home.js:225-235`; `ui/run.js:468-490`; `ui/workflow.js:344-356`; `tests/unit/dashboard-lib-connection.test.js:1-90`; `val-198:257-285`; `val-199:222-250`; `val-202:104-117`; `src/server.ts:612-617, 1099-1106`; `03-tasks.md:1837-1853` (TASK-215/216 row format); `state.yaml:70`; `.sdlc/design-handoff/README.md:69-71`.
measured_this_round: (1) `node --input-type=module` over `connection.js` — the adversarial's AD-2/AD-3/AD-5 reproduce EXACTLY: `nextConnection({status:'offline',consecutiveFails:5},{results:{}})` → `{status:'live',consecutiveFails:0}`; `worstOf({})` → `ok`; `worstOf({a:'bogus'})` → `ok`; `classifyResponse(200,{degraded:null})` → `degraded`; `classifyResponse(200,'oops')` → `ok`. (2) **My fold's interaction with the reducer, which r1 asserted and did not measure:** `{'/api/home':'ok','view:home':'fail'}` → `degraded`/0; `{'/api/home':'fail','view:home':'fail'}` → `degraded`/1 — the fold needs NO reducer change. (3) `grep -rn perRoute src/dashboard/ | grep -v lib/connection.js` → `app.js:112` only (the initial state) — a synthetic key in `perRoute` has no consumer to break. (4) `grep 'Object.keys(results)\|results).length' 04-design.md 02-architecture.md` → 0 (confirms AD-2's point 1). (5) `grep TASK-217\|TASK-218 03-tasks.md 04-design.md` → none minted yet. QD3-O2's browser reproduction from r1 is not re-run; nothing under it moved.
---

# Quality-dimensions — v27l DESIGN r2: converged on the row sweep, the seam, zero new DES ids and 「clause with task or neither」; the adversarial's empty-tick finding is taken and it forces one fix to my own footer rule; the only live hold is whether the owed work is one task row or two

## summary

**Where the two r1s overlap, they agree to the token.** AD-1 and my QD3-C1 are the same finding (`04-design.md:6814`'s `worstOf → 'live'|…`), ranked top by both, with the same edit — I take the adversarial's fuller parenthetical. AD-6 and my D7 scope caveat are the same omission (two sanctioned realisations of 「never rendered as data」, no row saying which view takes which). Both of us refuse a new DES id, a fourth tag state, a `lib/` predicate export and a per-view task split; both of us keep the real-tier falsifying cases. Five of the adversarial's six predicted disagreements with me (§8.1–8.5) never materialised, because my r1 did not do the things they predicted — recorded in §0 so the synthesizer does not hunt for disputes that do not exist.

**Where they found what I did not, I concede on measurement.** AD-2 — a tick with `results: {}` returns `live` from ANY prior state, held back only by `app.js:382`'s undocumented guard — reproduces exactly. It is BF-1's defect through a third door (the reducer's seed value survives an empty loop the way `prev.status` survived an all-fail tick), and their identity-on-empty shape is the right one: zero new states, zero behaviour change at HEAD, and it composes with my QD3-O3 fold — the fold makes `results` non-empty whenever a view threw, so identity fires only on a tick that genuinely asked nothing. AD-3 (`?? RANK.fail`) and AD-5 (`degraded` **key**, not string) are taken as written. **AD-4 — the seam — I concede more than my r1 offered.** My r1 ranked the three re-derived guards LOW and deferred them to the REQ-137/138 closure; the adversarial is right that DES-206:6849's 「may not decide anything a pure function could decide」 is a clause the tree already violates with no task scheduled — which is exactly the state `04-design.md:7285` calls worse than nothing. So it gets a task now. I rebut two sub-claims narrowly (§2): the seam change reaches no new test tier (the seam is `ui/`; the three `itReal` cases remain the only oracle, which their §8.5 itself concedes), and 「3 → 1」 is three two-token checks becoming three one-token checks — the status check stays a per-view obligation, and D7's mandatory falsifying case, not the seam, is what guards it.

**Where I found what they did not, they pre-conceded breadth (§8.6) and I hold on evidence.** QD3-C2 sits on the same `:6816` line as AD-1. QD3-O2 corrects AD-6's own example: `system.js` renders the component per FIELD and **throws** on a whole-route degrade (measured in r1 — 3 `pageerror`, 0 rows, tag frozen `live`); the fix is AD-4's own principle applied where it is free — `system.js:72` already holds `res.status`. QD3-O3 (an unguarded `onTick` freezes the tag) and QD3-O4 (the footer stamps skipped ticks) ride the task with AD-2/AD-3, because all four are one property: **the tag and the footer may not claim what the tick did not observe.**

**One hole in my own r1, found this round.** My footer rule was 「advance only on a `live` tick」, conditioned on the reduced STATE. Under AD-2's identity-on-empty, `prev.status === 'live'` survives an empty tick, so that rule would stamp a tick that observed nothing — the same false-freshness class the rule exists to close, installed in the same task row. The rule is now conditioned on the TICK: advance only when this tick observed ≥ 1 route AND reduced to `live`. One `&&` in `app.js`; the acceptance assertion is unchanged.

**The one live hold is grouping, and it is minor.** The adversarial wants ONE task row (E6: seam + reducer). I want two, split by property rather than by contract: **TASK-217** (the loop tells the truth — AD-2, AD-3, the fold, the footer; `connection.js` + `app.js`, all S) and **TASK-218** (the renderability decision crosses the seam once — AD-4(a); six `ui/` files). Reason: E6 couples a one-line, safety-direction reducer fix to a six-file signature refactor, and by the adversarial's own R3 the refactor is the half likely to slip. The fallback is stated once in §5 and is unconditional.

## Altitude call

Unchanged and agreed with the adversarial §0: a reducer, a poll seam, six view modules and their ledger rows — **system altitude throughout**. The agent altitude enters one hop out, as the reason the tag matters at all (the operator's only continuous 「is what I see true」 while agent runs are in flight), and is otherwise N/A per dimension rather than manufactured.

---

## §0 Scoreboard — every disagreement, adjudicated

| # | Item | Adversarial r1 | My r1 | **Verdict** | Basis |
|---|---|---|---|---|---|
| D-1 | `:6814` `worstOf → 'live'\|…` | AD-1, MID blocking-candidate, E1 | QD3-C1, MID | **CONVERGED** — take AD's parenthetical text verbatim | same edit; `connection.js:6,10,14`, UT `:78` |
| D-2 | `:6816` names `/api/home` + `/api/runs` | not seen | QD3-C2, LOW | **HOLD** (pre-conceded by AD §8.6) — same line as D-1, same amended sentence | `poll.js:16,22`; UT `:31`; `val-199:231` |
| D-3 | empty tick → `live` from any state | AD-2, MID latent, identity-on-empty + E2/E3 | not seen | **CONCEDE** — reproduced; rides TASK-217; composes with the fold | measured (frontmatter 1, 2) |
| D-4 | unrecognised token ranks `ok` | AD-3, rider, `?? RANK.fail` | not seen | **CONCEDE as rider** — fail-closed is the only defensible default for a health widget; rides TASK-217 | measured |
| D-5 | three `ui/` guards re-derive `classifyResponse` | AD-4, MID, option (a), ONE task | QD3-R1, LOW, 「next closure」 | **CONCEDE the contradiction and the task now; WITHDRAW 「next closure」; REBUT two sub-claims** (§2) | `04-design.md:6849` violated with no task = the `:7285` state |
| D-6 | 「`degraded` string」 vs key-presence | AD-5, LOW, E4 | not seen | **CONCEDE** — fail-closed, prose moves; ARCH-124 rider for the architect | `connection.js:48`; `02-architecture.md:3361` says 「string」 too |
| D-7 | which view bails, which renders the component | AD-6, LOW, one sentence | QD3-O1 D7 + scope caveat | **CONVERGED** into one D7 — with two corrections of fact (§1, §3) | `system.js` throws on a whole-route degrade; the `itReal` set is already symmetric |
| D-8 | `system.js` whole-route degrade | not seen (AD-6 cites `system.js:27-29` as the component case) | QD3-O2, MID | **HOLD routing** (send-back item → impl, not a task; cost stated §1); **CONVERGE the fix** on AD-4's principle: `res.status !== 'ok'` at `system.js:74` | measured r1; `system.js:72` holds the status |
| D-9 | unguarded `view.onTick` freezes the tag | not seen | QD3-O3 | **HOLD** — rides TASK-217; no new state (pre-empts AD §8.3) | measured r1 and frontmatter 2 |
| D-10 | footer stamps skipped ticks | not seen | QD3-O4 | **HOLD, REFINED by D-3** — condition on the tick, not the state; rides TASK-217 | `app.js:386` |
| D-11 | task grouping | ONE row E6 (seam + reducer + rider) | TASK-217 (footer + fold) | **HOLD, minor** — two rows by property; fallback stated once (§5) | AD's own R3 |
| D-12 | new DES id for the seam | zero (AD §8.2 predicted I'd want one) | zero — D7 in place | **DISSOLVED** | both r1s |
| D-13 | fourth tag / `unknown` state | refused (AD §8.3 predicted I'd propose one) | never proposed — the fold uses `fail` → existing `degraded` | **DISSOLVED** | ARCH-124 `:3365` owner ruling |
| D-14 | QD-R3 string table as headline | predicted (AD §8.1) | carried LOW, not raised | **DISSOLVED** | my r1 §1 |
| D-15 | AD-5/AD-6 ranked above AD-1 | predicted (AD §8.4) | QD3-C1 MID, QD3-C2 LOW | **DISSOLVED** | my r1 §3 |
| D-16 | a third `itReal` for `workflow.js` | refused (AD §8.5) | never asked — `val-199:231` IS the workflow case | **DISSOLVED by fact** — the set (198 home / 199 workflow / 200 run) is already symmetric | files |
| D-17 | DES-207 `tests:` names the fake | not covered | QD3-O2 design half | **HOLD** — unconditional, one line | `val-202:104-117` asserts a selector |

**Net:** five concessions (D-3, D-4, D-5, D-6 and the fix to my own footer rule under D-10), two converged-to-the-token (D-1, D-7), five dissolved, four holds on findings the adversarial did not reach (D-2, D-8, D-9, D-17), one live hold (D-11, grouping). Nothing in either r1 survives as a contradiction between the lenses.

---

## 1. Observability — transparency of internal state

RE-REVIEW #2 blocked on one property — the page must not tell the operator something untrue — and after this round the property has a complete enumeration of the ways a tick can lie. That enumeration is the round's observability result, and it is joint work.

### Converged

- **D-1 (the alphabet).** Taken as the adversarial wrote it. Their consequence statement is sharper than mine and I adopt it: an implementer who types `:6814` verbatim makes `connection.js:27`'s `worst === 'ok'` permanently false, and the tag can never reach `live` — strictly worse than what BF-1 repaired, produced by the row's FIRST line.
- **D-3 (the empty tick) — conceded, and it completes a set.** After BF-1 the reducer is truthful on all-ok, mixed and all-fail input. It is not truthful on EMPTY input: `worstOf({})`'s seed `'ok'` survives an empty loop and `:27` returns `live` from `offline`/5 (measured). The adversarial's three distinguishers from F-2 all hold at file:line — the guard at `app.js:382` is in no design row (grep: 0), in a layer with no unit tier, and REQ-142 is the next planned input to this exact seam. Their honesty about reachability (none at HEAD) is matched by mine: MID latent, rides a task, never a clause alone.
- **How D-3 and QD3-O3 compose (measured, frontmatter 2).** The fold writes `results['view:<name>'] = 'fail'` when `onTick` throws; the reducer then reports `degraded`/0 beside `ok` routes and `degraded`/1 beside all-`fail` routes — no reducer change, and the synthetic key leaks nowhere (`perRoute` has no reader outside the module). So after TASK-217 the four ways a tick can lie are each closed by a named mechanism: **all routes failed** → BF-1; **a degraded body reached a paint** → BF-2 + D7; **the view threw** → the fold; **nothing was asked** → identity-on-empty. Identity fires only on the last, because the fold makes `results` non-empty on the third. That is the closed enumeration RE-REVIEW #2's retro asked for (「enumerate the states it now forbids and check each」), and it is why the four belong in one task row (§5).

### Held, with one fix to my own rule

- **D-10 (the footer) — the round-2 review found a hole in my r1's rule.** 「Advance only on a `live` tick」 was conditioned on the reduced state. Under identity-on-empty, an empty tick returns `{...prev}`, so a page that was `live` stays `live` and the state-conditioned rule stamps a tick that observed nothing — the same false-freshness class QD3-O4 exists to close, installed by the same task. **The rule is now conditioned on the tick:** `updateFooterClock()` runs only when this tick observed ≥ 1 route AND reduced to `live` — in `app.js`, `if (Object.keys(results).length > 0 && connectionState.status === 'live') updateFooterClock();`. The acceptance assertion is unchanged (footer text read after the first real tick equals the text after 7 s of degraded ticks). The relabel alternative (「最後輪詢 / Last poll」) stays refused on fidelity — the handoff fixes the label, DES-209's oracle is the delivery; the adversarial did not weigh in and it remains open for them.
- **D-9 (the fold) — held; the observable seam is the `console.error`.** A try/catch around `view.onTick` that swallows silently would trade a frozen tag for a silent view — worse for this dimension, not better. The wrapper must log (once per distinct message is enough; every tick is acceptable if simpler) so the browser side finally has the witness the server side already has (`dashboard_api_degraded`, `server.ts:615/1103`). No new state: the fold reports through the existing `degraded`, which pre-empts AD §8.3 exactly.
- **D-8 (`system.js`) — held on routing, converged on the fix, cost stated.** AD-6 offers `system.js:27-29` as the component realisation. Per field, yes; for a whole-route `{degraded}` body (`server.ts:1104`'s shape) `system.js:74-77` takes the `else` branch and `buildTable:49` throws on `data.cpu.cores` — r1 measured 3 `pageerror`, 0 rows, tag frozen `live` across two ticks. **The fix is the adversarial's own principle, free of charge:** `system.js:72` already holds `res.status`; `if (res.status !== 'ok')` subsumes `!res.body` (a `fail` has a null body) and routes the whole-route degrade to the component with no `fail`-path change. **Routing and its cost, plainly:** BF-2's required shape names `home.js` and `run.js` (`07-review.md` §8) — so this is new-by-letter, residue-by-retro. I route it as a send-back item to impl (no TASK id, the BF-1/BF-2 path: an IMPL entry with the falsifying run recorded). The cost of that routing is that it lands only if the orchestrator dispatches impl before RE-REVIEW #3; otherwise RE-REVIEW #3 finds it, ranks it blocking under its own §8 definition, and the loop pays a round. If the synthesizer prefers certainty over lane purity, the one-line fix and the `val-202:104` test body fit inside TASK-217's DoD as item (e) — I named the risk of a send-back item hiding in a draft in r1 §5 and I still prefer the send-back path, but the choice is theirs with the price visible.
- **A correction to my own r1 (QD3-O1).** I wrote that the seam 「is stated nowhere」. DES-206's `[v27c]` paragraph (`:6849`) DOES state its mechanics: 「`app.js`'s one tick keeps EVERY body, calls the mounted module's `onTick`, merges the statuses it returns into `results`, and only then reduces `nextConnection`」. What is missing is the **consequence** (a view therefore receives degraded bodies and is the last line) and the **reason** `bodies` is not filtered (`issues.js` renders the degraded text as DES-207's component). D7 states those two sentences; it does not restate the mechanics.

---

## 2. Replaceability — decoupling & pluggability

### Conceded: the seam (D-5), with two narrow rebuttals

- **The contradiction is real and my r1 under-ranked it.** `home.js:231`, `run.js:475`, `workflow.js:350` each re-derive `!body || body.degraded` — a decision `classifyResponse` made at `poll.js:51` and `app.js:379` discarded one line before handing `bodies` across. DES-206:6849 forbids exactly this. My r1 recorded it as QD3-R1 LOW 「for when REQ-137/138 open」 on the ground that the review contract repairs contradictions, not improvements; the adversarial's reframing is correct — it IS a contradiction, of a clause that exists today, with no task scheduled — and `04-design.md:7285`'s rule says that state is worse than nothing. **Withdrawn: 「next closure」. Taken: a clause re-statement and a task (TASK-218).** Option (a) over (b) for the reason both r1s gave independently: `issues.js:102-104` needs the degraded body's text, and (b) would leave it protected only by QD2-O2, a defect.
- **Rebut (i): the testability gain is nil, and the row should not claim it.** The adversarial's §3 says 「the same property expressed at the seam is one `.js` UT」 and its §6(3) says the fix moves a property 「into the tier that already has a test file」. For AD-2 that is true (`connection.js`). For AD-4 the seam is `app.js` and the collapsed guard is still in each view — both `ui/`, both without a unit tier by ADR-049 — and the adversarial explicitly refuses the one shape that WOULD reach a unit tier (a `lib/` predicate). Their own §8.5 concedes the `itReal` cases are 「kept, not replaced」. So TASK-218's oracle is the three existing real-browser cases re-run green, and its DoD must say 「no new UT is possible and none is claimed」 rather than promise one.
- **Rebut (ii): 「3 → 1」 overstates, by the adversarial's own accounting.** Their §3 concedes the shape checks stay; what collapses is `!body || body.degraded` → `statuses[url] !== 'ok'` — three two-token checks become three one-token checks. The property 「a degraded body is never painted」 remains a per-view obligation after the seam change (a view that omits the status check paints garbage under (a) exactly as it does today). What guards the property is not the seam but **D7's rule that every `bodies`-fed view carries one real-browser falsifying case** — which is why D7 is unconditional and TASK-218 is a refactor. The honest win of TASK-218 is the one the adversarial states best: the classification is computed once and crosses the seam, so the boundary clause is true again and the next view's author is handed the answer instead of an idiom to copy. That is enough to justify it; it does not need the coverage claim.
- **The ported tabs do not need the seam — they already hold the status.** `system.js:72`, `models.js:52`, `issues.js:99` each call `getJSON` themselves and receive `{status, body}`; AD-4's principle applied there is a one-token change per tab and is precisely the QD3-O2 fix (§1). When QD2-O2 closes (tabs read `bodies`), they take `statuses` from the same seam TASK-218 builds. Sequencing is therefore free either way.

### Verified consistent (unchanged from r1, restated for the record)

- The reducer stays the pluggable piece and stays pure after both concessions: identity-on-empty adds no clock and no state; `?? RANK.fail` adds no token to the alphabet. `app.js:112, 383` remains its only consumer.
- `poll.js`'s `ROUTES` table stays the single place a view's fetch set lives; neither task touches it.
- A synthetic `view:<name>` key in `perRoute` has no reader to break (frontmatter 3).

---

## 3. Consumability — ease of use & low integration cost

The consumers of these rows are the next implementer and the next test author, and the adversarial's R6 (amendment pile-up on DES-202) is the consumability risk of THIS round. Agreed, and the edit list is shaped for it.

### Converged text

- **`:6814` — the adversarial's E1 text, verbatim:** `worstOf(perRoute) → 'ok'|'degraded'|'fail'` (the reducer's input, not the tag's value: `nextConnection` maps `'ok'` → `live` and, since BF-1, an all-`fail` tick → `degraded`/`offline` by streak — the tag reads `State.status`, `app.js:115`).
- **`:6816` — my D-2, one clause:** the AC-4 falsifying case is `describe` ok + `/api/runs` degraded on the WORKFLOW view (`val-199:231`; UT `:29-34`) — no view fetches `/api/home` and `/api/runs` in one tick (`poll.js:16, 22`).
- **`:6815` — the adversarial's E4:** 「a 200 whose body carries a `degraded` **key** (presence, not type — `connection.js:48`; a malformed degrade must not become data)」. ARCH-124 `:3361` and ARCH-125 `:3373` say 「string」 too; a panel may not amend ARCH, so that is recorded for the architect at LOW alongside their AD-1 rider.
- **One consolidated `amended (…)` line on DES-202** carrying D-1, D-2, D-6 unconditionally, and D-3/D-4's clauses ONLY in the declared-and-owed form if TASK-217 is minted (「these describe the reducer TASK-217 builds; UNGUARDED until it lands」 — the `ARCH-122`/`ADR-049` phrasing the adversarial's §5 names). If round 3 or the synthesizer wants `:6814-6816` rewritten clean with the two existing amendment blocks compacted, I support it as the adversarial does — a separate decision, not a side effect.

### D7 — property-level, so it is true at HEAD and after TASK-218

One DES-206 `boundary:` addition, sixth in the invariant list, absorbing AD-6 and my scope caveat:

> **(D7)** A body the tick classified as anything but `ok` — absent, `fail`, or `degraded` — is never handed to a paint function by a view `app.js` feeds through `bodies`; the view skips this tick's repaint and its last-known render stays (ARCH-125's 「never rendered as data」, realised HERE — the classifier only labels). A view may additionally check its own shape precondition (`Array.isArray(body.running)` and its siblings) and nothing else. The tag (DES-202) is the operator's witness of the skipped tick; the view is not. Each such view carries ONE real-browser falsifying case that fakes its route at the browser edge and asserts the prior render survives two poll intervals — `val-198:262`, `val-199:231`, `val-200:215` today. `bodies` carries every status rather than being filtered in `app.js` because `issues.js` renders the degraded TEXT as DES-207's component; the ported tabs' rule is therefore DES-207's (the 「無法取樣」 component, not last-known) and is the other branch of the same invariant, not an exception to it. At HEAD the classification reaches a `bodies`-fed view only through the body's `degraded` key; TASK-218 hands it across the seam as `statuses[url]` — the property is identical either way, which is why it is stated as a property.

The adversarial's rationale for the two branches (「a ported tab has no prior render to keep; a polled view does」) is not adopted — a ported tab has a prior render after its first tick — in favour of citing DES-207's stated behaviour change, which is the actual reason on the record.

### DES-207 `tests:` — D-17, unconditional

> a degraded `/api/system` section renders the Unavailable component rather than an empty panel — **the fake is route-level** (`setRequestInterception` answering `/api/system` with `{degraded:'…'}` at HTTP 200, `server.ts:1104`'s shape, the `val-199:231` recipe) **and the assertion reads a cell** (`#system-panel` shows 「無法取樣」, `pageerror` is empty, the tag reads `degraded`) — never the panel's existence alone.

That line is what lets `val-202:104` be rewritten by Gate 5 without a coin-flip, and it is the design half of D-8 regardless of how the code half is routed.

### Lane items, unchanged

- QD3-C3 (VAL-206/VAL-208/UT-245 counts stale in `05-tests.md`) — Gate 5's; and if TASK-217 lands, UT-244's file gains two or three cases that the same ledger row should count.
- Task rows follow the TASK-215/216 house style exactly (status/traces/files/des/dod/estimate/iter; RED-first; pasted exit codes) — §5.

---

## 4. Self-sustainability — closed-loop autonomy & lifecycle

A dashboard tab is the long-lived process here. Round 1 verified the loop's SCHEDULE self-heals (`scheduleTick`'s `.finally` re-arm, generation check, un-debounced recovery); this round settles how its TRUTH self-heals.

- **After TASK-217 the loop cannot enter 「alive, busy, wrong」.** The state QD3-O3 named — timer firing, view throwing every 3 s, tag frozen at its last value, no path back but a reload — is closed by the fold: the tick the view stops throwing, the tag corrects itself, with no re-mount, no back-off, no reset. I still do not propose re-mount-on-repeated-throw; it is machinery for a property the fold already gives, and the adversarial's simplicity lens would refuse it for the same reason.
- **REQ-142's visibility gate is now safe to attach either way.** Whether it skips the tick (no `tick()` call while hidden) or runs it empty, the reducer is truthful on empty input (D-3) and the footer freezes at the last observed `live` tick (D-10 as refined) — so a tab shown again after an hour reads 「更新於 <an hour ago>」 + `checking`/`live` on its first real tick, which is the staleness indicator a hidden-then-shown tab needs and currently lacks. This is the 「reserved slot」 DES-202 names, kept reserved: nothing here builds the gate.
- **Fail-closed on the unknown (D-4).** A health widget that ranks an unrecognised token as healthy degrades in the wrong direction under a future refactor; `?? RANK.fail` costs one token. It is a behaviour change on an unreachable input, and I say so as the adversarial did — the synthesizer may drop it for a zero-behaviour-change round without disturbing anything else in TASK-217.
- **No leak vectors added** by any edit in either r1: the fold's dedupe set (if the implementer chooses to dedupe) is a `Set<string>` of error messages bounded by the number of distinct failures, not by ticks; the seam change allocates nothing per tick beyond the `statuses` map that `results` already is.
- **Agent altitude:** memory metabolism (the 2 KB event clip, `?limit=500` + `hasMore`) and prompt withholding (REQ-136) are untouched this round — N/A, not skipped.

---

## 5. Final position — the merged edit list, two task rows, and the fallback

Zero new DES ids. Every `04-design.md` edit is in-place with the synthesizer's `iter:` marker; one consolidated `amended (…)` line per touched row. Round 2 writes only this file.

| # | Row | Edit | Source | Condition |
|---|---|---|---|---|
| E1 | DES-202 `signature:` (`:6814`) | `worstOf → 'ok'\|'degraded'\|'fail'` + AD's parenthetical | D-1 | unconditional |
| E2 | DES-202 `tests:` (`:6816`) | AC-4 case is `describe` ok + `/api/runs` degraded (workflow view) | D-2 | unconditional |
| E3 | DES-202 `boundary:` (`:6815`) | 「`degraded` string」 → 「`degraded` key (presence, not type)」 | D-6 | unconditional |
| E4 | DES-202 `boundary:` + `tests:` | 「on a tick that observed ≥ 1 route, `status` is never carried forward; an empty tick returns `prev` with `perRoute: {}`」; 「an unrecognised token ranks `fail`」; two/three RED-first UT cases named | D-3, D-4 | **only with TASK-217**, in declared-and-owed form |
| E5 | DES-206 `boundary:` (`:6849`) | **D7** as worded in §3 | D-7 | unconditional (tree-satisfied at HEAD) |
| E6 | DES-206 `boundary:` | the fold clause and the footer clause (tick-conditioned) | D-9, D-10 | **only with TASK-217**, declared-and-owed |
| E7 | DES-206 `signature:` + `boundary:` | `onTick` carries per-url statuses across the seam; 「the renderability decision is `classifyResponse`'s, made once; a view checks its own shape and nothing else」 | D-5 | **only with TASK-218**; without it, `:6849`'s existing clause is annotated 「UNGUARDED at the three BF-2 call sites until a seam task lands」 (annotating an existing violated clause, not minting a new one) |
| E8 | DES-207 `tests:` (`:6858`) | the fake is route-level, the assertion reads a cell | D-17 | unconditional |
| E9 | DES-202 / DES-206 amendment lines | one consolidated `amended (…)` each, naming E1–E8 and the measured evidence | AD R6 | unconditional |
| — | `system.js:74` + `val-202:104` body | `res.status !== 'ok'` → component; test fakes the route and reads a cell | D-8 | send-back item → impl (preferred), or TASK-217 item (e) if the synthesizer wants certainty |

### TASK-217 (proposed, draft, S) — the poll loop tells the truth on the ticks that observed nothing, the ticks that threw, and the ticks it skipped

- **traces:** DES-202, DES-206, ARCH-124, ARCH-125, REQ-131
- **files:** `src/dashboard/lib/connection.js`, `src/dashboard/ui/app.js`, `tests/unit/dashboard-lib-connection.test.js`, `tests/acceptance/val-198-shell-and-home.test.ts`
- **des:** DES-202, DES-206
- **dod:** (a) [AD-2] `nextConnection(prev, { results: {} })` returns `{ ...prev, perRoute: {} }` for every `prev` — two UT cases RED first (from `offline`/5 stays `offline`/5; from `live` stays `live`/0), then green; `app.js:382`'s guard may stay, it is no longer load-bearing. (b) [AD-3, if taken] `worstOf({ a: 'bogus' })` → `'fail'` via `RANK[status] ?? RANK.fail` — one UT case. (c) [QD3-O3] `view.onTick` is wrapped: a rejection is folded into `results` as `'fail'` under `view:<name>`, logged via `console.error`, and `nextConnection`/`updateConnectionTag` still run — one real-browser case fakes a route with an `ok`-classified body that passes the view's guard and breaks its paint (the implementer picks the body — e.g. `/api/home` → `{ running: [null], registered: [], other: [] }` — and confirms it throws at HEAD before wrapping), asserting the tag reads `degraded` and `pageerror` is empty. (d) [QD3-O4] `updateFooterClock()` runs only when THIS tick observed ≥ 1 route AND reduced to `live`; `val-198:262`'s BF-2 case additionally reads the footer text after its first real tick and asserts it is unchanged after the 7 s of degraded ticks. Paste the `npx vitest run tests/unit/dashboard-lib-connection.test.js` result and the `RWE_REQUIRE_BROWSER=1` val-198 run (counts + exit codes); `npx tsc --noEmit` exit 0.
- **estimate:** S

### TASK-218 (proposed, draft, S) — the renderability decision crosses the `onTick` seam once, instead of being re-derived in three views

- **traces:** DES-206, DES-202, ARCH-125, REQ-131
- **files:** `src/dashboard/ui/app.js`, `ui/home.js`, `ui/run.js`, `ui/workflow.js`, `ui/models.js`, `ui/system.js`, `ui/issues.js`
- **des:** DES-206
- **dod:** `app.js` hands the per-url statuses across the seam (AD-4(a) — `onTick(container, bodies, ctx, statuses)` or the one-object form; DES-206's `signature:` line says which); `home.js:231`, `run.js:475`, `workflow.js:350` replace `!body || body.degraded` with `statuses[url] !== 'ok'` and KEEP their own shape check; the three ported tabs accept the argument and ignore it (they self-fetch — QD2-O2, out of scope). No new `lib/` export. **Oracle:** the three existing `itReal` cases (`val-198:262`, `val-199:231`, `val-200:215`) re-run green under `RWE_REQUIRE_BROWSER=1` — paste the run; no new UT is possible (`ui/`, ADR-049) and none is claimed. `grep -n "\.degraded" src/dashboard/ui/{home,run,workflow}.js` → 0 afterwards. No D7 re-wording is needed (it is stated as a property).
- **estimate:** S

### Why two rows and not the adversarial's one — and the fallback, once

E6 as proposed couples a one-line, safety-direction reducer fix (AD-2) to a six-file signature refactor (AD-4). The adversarial's own R3 rates the refactor's slip as medium; if it slips, the fail-open default slips with it. Split by property, TASK-217 carries everything about **what the tag and footer claim** (the RE-REVIEW #2 blocking class, so its dispatch priority is unambiguous) and TASK-218 carries the **boundary restoration** (no operator-visible consequence today). The adversarial's other grouping argument — 「AD-1's edit must not be split from AD-2's, three adjacent lines of one row」 — is about the AMENDMENT line, and I agree with it: E9 is one consolidated line per row regardless of how many task rows exist.

**Fallback, unconditional.** If the synthesizer mints ONE task: it is TASK-217, and it absorbs nothing from 218 — 218's clause is the annotation form in E7. If ZERO: E4, E6, E7 are not written (per `:7285`, a clause the tree violates with no task is worse than neither); E1, E2, E3, E5, E8, E9 land anyway, because they are true of HEAD today; D-3/D-4/D-9/D-10/D-5 go to RE-REVIEW #3's §9 as recorded debt with their measured consequences. **Ranking across the open follow-ups if only one is dispatched:** TASK-215 (the prior synthesis's ruling, a clause the tree contradicts today) > TASK-217 (the blocking class, one reachable-today item — the footer) > TASK-218 (a refactor) > TASK-216 (a disclosed red window). The adversarial ranked their E6 「above 216, below 215」 — consistent with 218's place here.

---

## key_points

1. **The two r1s contradict each other nowhere.** Same top finding (D-1), same edit text, same refusals (new DES id, fourth state, `lib/` predicate, per-view split), same oracle policy (real-tier cases kept). Five of the adversarial's predicted disputes dissolved on reading my r1.
2. **AD-2 is conceded on reproduction** and completes BF-1's enumeration: all-fail, degraded-painted, view-threw, nothing-asked — one mechanism each after TASK-217, and the fold and identity-on-empty compose without a reducer change (measured).
3. **AD-4 is conceded further than my r1 went:** DES-206:6849 is a clause the tree violates with no task — the `:7285` state — so it gets TASK-218 now, not the REQ-137/138 closure. Two sub-claims rebutted: no new test tier is reached (`ui/` both sides of the seam), and the status check stays a per-view obligation guarded by D7's mandatory falsifying case, not by the seam.
4. **My own footer rule had a hole once AD-2 lands** — a state-conditioned rule stamps an empty tick. Fixed: condition on the tick (observed ≥ 1 route AND `live`).
5. **`system.js` corrects AD-6's example** — it throws on a whole-route degrade (measured r1). The fix is AD-4's principle where the status is already in hand (`res.status !== 'ok'`). Routed as a send-back item; the cost (a RE-REVIEW #3 round if impl is not dispatched first) is stated so the synthesizer chooses with the price visible.
6. **D7 is worded as a property**, true at HEAD (key check) and after TASK-218 (status check); the ported tabs' component rule is its other branch, cited to DES-207, not to an invented rationale.
7. **The one live hold is grouping:** two task rows by property versus one by contract. Fallback stated once; a single ranking given.

## remaining disagreements

- **D-11 — one task row or two.** Held on the coupling argument above; minor, and the fallback is written so either choice is coherent.
- **D-4 — whether `?? RANK.fail` is taken** as a behaviour change on an unreachable input. Both lenses defer to the synthesizer; I lean take (fail-closed for a health widget), the adversarial offered it as a rider and does not fight for it.
- **D-10 — footer rule vs relabel.** The adversarial has not weighed in. My refusal of the relabel stands on fidelity (the handoff fixes the label; DES-209's oracle is the delivery); open for their r2.
- **D-8 — routing of the `system.js` fix.** Send-back item (my preference, lane-pure, one round at risk) versus TASK-217 item (e) (certain, but a send-back item inside a draft). Priced both ways; the synthesizer's call.

## risks

- **R1 — Widening, again.** This round mints two draft tasks in a send-back loop. Each is bound to a clause that would otherwise be false or already-violated, and each has an unconditional fallback; but the count is the count. If the synthesizer's discipline is 「contradictions only」, E1–E3, E5, E8, E9 are the contradiction set and land alone.
- **R2 — E4/E6/E7 land without their task.** The declared-and-owed phrasing must name the task id in the clause itself; if the ids are not minted, the clauses must not be written. The adversarial's §5 and my r1 §5 say the same thing; E9's amendment line should repeat it so the ledger, not this file, carries the rule.
- **R3 — The footer's tick-condition is read as a second guard on `results`.** It is not a guard on the reducer (AD-2's identity covers that); it is the footer's own truth condition and stays in `app.js` beside the clock. TASK-217's DoD (d) says so.
- **R4 — TASK-218 grows** (QD2-O2, a degraded-UI component, AD-6 unification). Its DoD names the ported tabs as accept-and-ignore and the grep as the completion check; the adversarial's R2 pre-empts the same growth and I adopt their boundary verbatim.
- **R5 — The fold's falsifying case is fragile** (it depends on a body that passes the guard and breaks the paint). The DoD makes the implementer confirm the throw at HEAD before wrapping; if no such body exists for `home`, `run.js`'s `cells` shape or `workflow.js`'s `describe` are the alternates — the case must exist, the view is the implementer's choice.
