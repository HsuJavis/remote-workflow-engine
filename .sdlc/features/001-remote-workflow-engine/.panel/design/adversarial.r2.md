---
stage: design (Gate 3/4), v27 Gate 8 RE-REVIEW #2 send-back — design half
lens: adversarial (interface-contract · boundary/error · testability), Karpathy simplicity-first as tie-break
round: 2 — written AFTER reading `quality-dimensions.r1.md` in full. Verdicts below are rebut / concede / hold, per disagreement.
head: 57ad237 (code last moved at b124430). Every claim re-verified at file:line THIS round; §9 lists what was run.
supersedes_on_disk: the v27j round-2 file at this path — `git show 8d3584b:.sdlc/features/001-remote-workflow-engine/.panel/design/adversarial.r2.md`. Read history with `git show`, never `checkout` / `restore` / `stash` (CLAUDE.md).
my_r1: `adversarial.r1.md` (AD-1..AD-6). Findings are cited by id below, not re-derived.
touched: this file only. `04-design.md`, `03-tasks.md`, `src/`, `tests/` are untouched by me in both rounds.
---

# Adversarial — round 2: the panel converges on ten of thirteen; I concede my largest proposal; the headline is a finding neither of us owned at the start

## §0 Headline

**Both lenses now rank `system.js` (QD3-O2) as this round's most severe item, and both call it blocking.** QD measured it in real Chromium; I verified the throw path independently from source (§8). It contradicts `04-design.md:6857` **verbatim** — 「a `degraded` section renders the ONE 「無法取樣」 component … instead of reaching a render function as data and throwing」 — and the row's own acceptance case (`val-202:104-117`) asserts a selector, not the property. Two independent lenses converging on one blocking call is the strongest signal this panel can hand the synthesizer; put it at the top of the synthesis note rather than letting RE-REVIEW #3 rediscover it. The code is impl's lane and neither of us touches it.

**And I withdraw my round-1 headline remedy.** AD-4(a) — extend `onTick` so the per-route statuses cross the `app.js` seam — would have fixed **three views that work today and missed the one that is broken**. `system.js:72` does its own `getJSON`, so it has `res.status` **in hand** at `:74` and ignores it, testing `!res.body` instead. A seam change cannot reach a view that was never fed by the seam. That is the engineering reason, not politeness: my proposal was aimed one layer away from the defect.

---

## §1 Scoreboard — every disagreement, with the verdict

| # | item | their position | mine (r1) | verdict | one-line reason |
|---|---|---|---|---|---|
| 1 | **QD3-C1 ≡ AD-1** — `worstOf` return alphabet, `:6814` | fix to `'ok'\|'degraded'\|'fail'` | identical | **converged** | Same finding, same token, found independently. Take **their** parenthetical — 「(the reducer reads THIS; the tag reads `State.status`)」 — it is shorter than mine and says the same thing. |
| 2 | **QD3-O2** — `system.js` renders a whole-route degrade as data and throws | MID/blocking; row wording is design's, code is impl's | **I missed it entirely** | **concede + adopt, ranked #1** | `:6857` is contradicted in its own words, with a measured operator-visible consequence (0 rows under a `Live` tag). My r1 §8.6 said QD's breadth would beat my depth and I would take its row set. It did; I do. |
| 3 | **QD3-C2** — `:6816`'s AC-4 case names `/api/home` + `/api/runs` | fix to `describe` ok + `/api/runs` degraded | **I missed it** | **concede + adopt** | Verified: `poll.js:16` home fetches `/api/home` alone; `:20-23` workflow fetches `describe` + `/api/runs`. No tick fetches the named pair. One token, on the row BF-3 was sent back for. |
| 4 | **AD-4(a)** — `onTick` gains the statuses, + 1 TASK | refuse for this pass (QD3-R1: record, defer to REQ-137/138) | propose it, one task row | **CONCEDE — withdrawn entirely** | §0. It fixes three correct views and misses the broken one. Karpathy: the minimum design that solves the problem is QD's D7 (state the rule) + the one-line `system.js` fix. My remedy was needless machinery. |
| 5 | **QD3-O1 (D7)** — state BF-2's property as DES-206's sixth invariant | amend in place, no task, tree-satisfied | AD-6 asked for the same sentence, worse-worded | **concede the frame, integrate one clause** | §3. D7 as QD words it covers 3 of 6 views and hands the other 3 to DES-207; one added clause makes it cover all six and *produces* QD3-O2's fix from the row. Not a disagreement — a merge. |
| 6 | **QD3-O3** — an unguarded `onTick` throw freezes the tag | state the fold + price it in TASK-217 | **AD-2** — an empty tick reports `live` | **hold both, MERGED** | §4. They are the same defect from opposite ends: a tick with no valid observation must not produce a claim. One reducer line + one seam line, same two files, one task. |
| 7 | **QD3-O4** — the footer stamps freshness on skipped ticks | rule: advance only on a `live` tick; clause + TASK-217 | not found by me | **concede the rule, amend it** | §5. As worded it ships a **false first stamp** (`app.js:146`) and then freezes it forever. Boundary lens earns its seat here: the fix is one token. |
| 8 | **TASK-217** — mint a draft task, or write no clause | mint it (+1 LOW 未實作 row) | r1 §8.2/R3 predicted I would prefer debt | **CONCEDE — mint one task** | §6. The class has cost three send-back rounds; with AD-2 merged in, one S task closes four instances at once. The ledger's binary rule (`04-design.md:7285`) is right and I was arguing the wrong side of it. |
| 9 | **New DES id for the `ui/` degraded contract** | zero new ids, amend DES-206 in place | zero new ids | **my r1 §8.2 prediction was wrong** — stated so it is on the record | QD never wanted a new id. Retracted. |
| 10 | **QD3-R1** — a pure `renderable()` predicate in `lib/` | record, defer to REQ-137/138's closure | r1 §3 refused it as a `classifyResponse` mirror | **agreed, different reasons, same answer** | Both refusals stand and reinforce: it duplicates an answer that already exists. Deferred, not adopted. |
| 11 | **QD3-C3** — stale `05-tests.md` counts | Gate 5's lane, route don't edit | — | **agree** | Not design's. Add `val-202:104`'s title-vs-body gap to the same routing note (§2). |
| 12 | **AD-5** — `classifyResponse` tests key presence, prose says 「string」 | not addressed | move the prose, not the code | **hold** | §3. Free, true of HEAD, fail-closed. Tightening the code would flip it fail-open in the one row that must not. |
| 13 | **AD-3** — an unrecognised token ranks `ok` | not addressed | LOW rider, explicitly droppable | **hold, still droppable** | §3. |

**Predictions from my r1 §8 that were wrong, stated plainly:** #2 (QD wanted a new DES id — it did not), and #1 (I expected QD-R3's string table to be its headline — it was not; QD carried it as debt, correctly). Prediction #3 (a fourth tag state) never materialised either; QD proposed no new status.

---

## §2 The concession that matters — QD3-O2, and design's precise version of the fix

`system.js:74` reads `if (!res.body)`. `res.status` is already `classifyResponse`'s answer for the same response (`:72`). The server's catch-all (`server.ts:1101-1105`) returns HTTP 200 `{degraded:'…'}` — truthy, no `cpu` — so `:77` calls `buildTable`, `:49` reads `data.cpu.cores`, and it throws.

**Design's statement of the fix is one token, and it is not the two-token form.** The gate is `if (res.status !== 'ok')`, **not** `if (!res.body || res.body.degraded)`. `classifyResponse` already maps a null body, a non-2xx and a parse failure to `'fail'`, so the status check **subsumes** the `!res.body` arm it replaces — one predicate, zero re-derivation, and it reads the answer DES-207's own clause points at (「DES-202's classifier」). Anything longer re-implements the classifier at the call site, which is the habit that produced the defect.

**Routing, unchanged from QD:** code → impl (a BF-2 residue, not new scope); test body → Gate 5 (`val-202:104-117` verified this round: title promises the Unavailable component, body clicks the tab and `waitForSelector('#system-panel')` — it fakes nothing and reads no cell); row wording → design, this pass (E5).

---

## §3 Where I hold, and the one clause I add to D7

**D7 — integrate, don't dispute.** QD's §2 already says D7 should carry the seam choice 「so the next designer sees a choice, not a law」; that *is* my objection, so it is a merge. But D7 as drafted says 「the view judges the BODY — the per-route statuses never reach a view」, and stated flatly that sentence **blesses the hand-rolled shape sniff** that broke `system.js`. One added clause fixes it and makes D7 cover all six views with no seam between D7 and DES-207:

> …and **where the status is already in the view's hand — the ported tabs call `getJSON` themselves (`models.js:52`, `system.js:72`, `issues.js:99`) — that status IS the gate; a view never re-derives renderability by sniffing the body's shape when `classifyResponse` has already answered.**

That clause, alone, produces QD3-O2's fix from the row. Without it, DES-206 says 「sniff the body」 and DES-207 says 「render the component」 and nobody is told which applies to a tab that fetches for itself.

**AD-5 (hold, LOW, free).** `connection.js:48` tests `'degraded' in body`; `:6815` and `02-architecture.md:3361` both say a `degraded` **string**. Measured: `classifyResponse(200,{degraded:null})` → `'degraded'`. The deviation is **fail-closed**, so the prose moves: 「a `degraded` **key** (presence, not type — a malformed degrade must not become data)」. Tightening the code to `typeof === 'string'` converts a fail-closed deviation into a fail-open one; refused.

**AD-3 (hold at LOW, still droppable).** `worstOf({a:'bogus'})` → `'ok'`, because `RANK[status]` is `undefined` and `undefined > 0` is false. One token, fail-closed: `const r = RANK[status] ?? RANK.fail;`. It is the only item in this round that is a **behaviour** change on an unreachable input; if the synthesizer wants a zero-behaviour-change round, drop it and keep everything else. I do not fight for it.

**AD-6 — folded into D7 (QD3-O1) and dropped as a separate item.** QD's version assigns the two realizations to the two rows; mine only observed that both exist. Theirs is strictly better.

---

## §4 The merge that changes both proposals — AD-2 + QD3-O3 are one property

QD3-O3: `app.js:379`'s `await view.onTick(...)` is unguarded, so a throw skips `:383-384` and the tag keeps its last text — **measured** by QD as `live` across two ticks while `results` already held `degraded` for the same route.
AD-2: `nextConnection(anything, {results:{}})` → `{status:'live', consecutiveFails:0}` — an `offline` page with a five-tick streak is restored to 連線中 by a tick that consulted **zero** routes. Latent at HEAD, held back only by `app.js:382`, a guard that appears in **0** lines of `04-design.md` or `02-architecture.md` (grepped both) and lives in the layer with no unit tier.

**One property covers both:** *a tick that produced no valid observation must not produce a claim; a tick whose view failed must produce the claim that says so.* Three one-liners, two files:

```js
// (a) app.js:378-381 — a throwing view is an observation, not a hole in the loop
try { const extra = await view.onTick(view.container, bodies, view.ctx); if (extra) Object.assign(results, extra); }
catch (e) { results[`view:${view.name}`] = 'fail'; console.error(e); }  // once per distinct message, ~5 lines

// (b) connection.js, before the worstOf line — no observation → no claim (identity, NOT reset)
if (values.length === 0) return { ...prev, perRoute: tick.results };

// (c) app.js:382 — the `Object.keys(results).length > 0` guard stops gating the reducer (identity
//     makes it redundant there) and starts gating the FOOTER stamp instead — see §5. Not deleted: moved.
```

**Three things this merge lets both of us delete from our own proposals:**

1. **QD3-O3's parenthetical rule is free — drop it.** QD wrote 「never counted toward the offline streak unless every route also failed」. The reducer already does exactly that: a synthetic `fail` beside any non-`fail` route makes `allFail` false (`connection.js:30`) → `degraded`, streak untouched. **No new reducer rule is needed for the fold.** State the fold; do not state a semantics the existing `allFail` branch already gives you.
2. **The fold's only boundary risk is nil, and I checked rather than assumed.** `grep -rn perRoute src/ tests/` → the field is written in three places and **read by nobody**. A synthetic `view:<name>` key cannot reach the operator.
3. **(b) is what frees the guard, and (a) alone is not.** The fold does not empty-proof the loop — `results` is still `{}` for a view name absent from `ROUTES` (`poll.js:37`). Identity-on-empty does, with **zero** behaviour change (identity produces exactly what the guard produces: no state change, no repaint), moving the property from an untestable layer into the module that already has a literal-fixture transition table. Price honestly: +2 files on QD's list (`connection.js` and its UT), refactor-not-behaviour. **And the guard is not deleted — §5 gives it a new job**, which is the interaction I nearly shipped past.

**The clause I owe, unchanged from r1 §3 and repeated so it cannot be missed:** identity-on-empty makes BF-3's brand-new 「`status` is never carried forward from `prev`」 sentence false. It must read 「**on a tick that observed at least one route**, `status` is never carried forward from `prev`」 — in the same edit, or this round re-opens BF-3 by accident. Identity preserves `consecutiveFails` too, which is the property that distinguishes it from a reset and is the UT case: `offline(5)` + empty tick → still `offline(5)`, **RED at HEAD**.

---

## §5 The footer — concede the rule, and the defect in it that my lens exists to find

QD3-O4's rule (advance `updateFooterClock()` only on a `live` tick) is right: a truthful under-claim beats a false stamp, and 「更新於 12:29:58」 beside `降級` becomes the staleness indicator the page lacks. I withdraw the relabel alternative QD pre-refused; its fidelity argument holds.

**But as worded the rule ships a false FIRST stamp and then freezes it forever.** `app.js:146` calls `updateFooterClock()` at footer **build** time, before any tick has run. Under QD's rule, a page that loads while degraded stamps the page-load wall clock and never moves it again — strictly worse than today, where at least the lie is recent. Today's code hides this; the rule exposes it.

**And my own §4 makes the rule insufficient by one condition — I found this against myself and say so here rather than let the synthesizer find it.** Identity-on-empty returns `live` for an empty tick from a `live` page. Under QD3-O4 as worded (`if (status === 'live') updateFooterClock()`), that tick **advances the stamp** — 「更新於 12:30:05」 on a tick that fetched nothing, the exact class the rule exists to close. Unreachable at HEAD for the same reason AD-2 is, and reachable in the same REQ-142 future I cite as the reason to do identity-on-empty at all; I may not invoke that future for one half of the merge and ignore it for the other. **The rule needs one qualifier: the footer advances on a tick that observed ≥ 1 route AND reduced to `live`.** Consequence, priced: `app.js:382`'s `Object.keys(results).length > 0` guard is **repurposed, not deleted** — identity makes it redundant at the reducer, and nothing else can supply the 「observed ≥ 1 route」 half of the stamp's condition. The merge moves one guard; it does not remove one.

**Fix for the first stamp — one token, zero new string-table keys, DES-209-safe:** the build-time call writes the label with a placeholder instead of a time — `L(prefs.lang,'updated') + ' —'`. The handoff's 「Footer: API base left, `Updated HH:MM:SS` right」 (`README.md:70`) keeps its form for the fidelity oracle, and the page never claims a freshness it has not earned. **Verified cost: zero.** No acceptance test asserts the footer text at all (grepped `tests/acceptance/*.ts` → 0 hits for footer/Updated/更新於), so nothing breaks and QD's proposed assertion on `val-198:262` is the first one.

---

## §6 The converged edit list — what design lands this pass

Zero new DES ids; in-place amendment, `iter:` as the synthesizer coins. **E1–E6 are unconditional** (true of HEAD, or pure row precision). **E7 is the only clause that describes a tree we do not have, and it rides TASK-217 or is not written** — `04-design.md:7285`'s binary rule.

| # | row | edit | source |
|---|---|---|---|
| **E1** | `04-design.md:6814` | `worstOf → 'ok'\|'degraded'\|'fail'`; 「(the reducer reads THIS; the tag reads `State.status`)」 | AD-1 ≡ QD3-C1 |
| **E2** | `:6816` | the AC-4 case reads `describe` ok + `/api/runs` degraded (workflow view, `val-199:231`; UT `:29-34`) | QD3-C2 |
| **E3** | `:6815` | 「a `degraded` **key** (presence, not type)」 | AD-5 |
| **E4** | `:6849` DES-206 | **D7** as QD drafted it, **plus §3's status-in-hand clause**; `tests:` names `val-198:262`, `val-199:231`, `val-200:215` | QD3-O1 + AD-6 |
| **E5** | `:6858` DES-207 | the degraded-`/api/system` case names its **fake** (route-level `{degraded}` at the browser edge, the `val-199:231` recipe) and its **assertion** (a `.sys-table` row reads 無法取樣, zero `pageerror`) — a selector must no longer satisfy it | QD3-O2 |
| **E6** | `:6818` | **one** appended sentence recording E1–E5 as the row sweep BF-3 owed. Not a new amendment block — `:6817`/`:6818` are already two deep. | both |
| **E7** | `:6849` DES-206 | the truth-telling clauses: the `onTick` fold, identity-on-empty, and the footer rule. **Conditional on TASK-217.** | §4, §5 |

**TASK-217 — one row, three units, a stated trim order.** `files:` `src/dashboard/ui/app.js`, `src/dashboard/lib/connection.js`, `tests/unit/dashboard-lib-connection.test.js`, `tests/acceptance/val-198-shell-and-home.test.ts`. `des:` DES-206, DES-202. `traces:` ARCH-125, REQ-131. `status: draft`, S.

- **(a) the fold** — always. `onTick` wrapped; a rejection folds `view:<name>: 'fail'`, logs once per distinct message, `nextConnection` still runs. One real-browser case: a view throws, tag reads `degraded`, `pageerror` non-empty is *expected* and the tag is the assertion.
- **(b) identity-on-empty; `app.js:382` repurposed** — one unit. The guard stops gating `nextConnection` (identity makes it redundant) and becomes the 「observed ≥ 1 route」 half of (c)'s condition. Two UT cases, both RED at HEAD: empty tick from `offline(5)` stays `offline(5)`; empty tick from `live` stays `live`.
- **(c) the footer rule + the first-paint placeholder (§5)** — one unit. `updateFooterClock()` runs only on a tick that observed ≥ 1 route AND reduced to `live`; `app.js:146` writes `L(lang,'updated') + ' —'`. `val-198:262`'s existing BF-2 case gains one assertion: the footer text is unchanged across its two degraded ticks.
- **If capacity forces a trim, drop (b) first** — it is the only latent one — and E7's identity clause and its two UT cases drop with it. (c) survives the trim unchanged: without identity, `app.js:382` keeps its original job and the stamp reads the same two-condition rule off `results` and `connectionState` directly. **(a) and (c) are both measured or free.**

**`system.js` is NOT in this task.** It is a BF-2 residue routed to impl as a send-back item; merging it into a draft task lets a send-back item hide inside new scope. QD said this first and is right.

**Trace prediction, falsifiable:** +1 LOW `TASK 未實作` row (35 → 36), zero 漂移 rows, provided every amended row's `iter:` advances in the same commit as its text. If a re-run shows otherwise, this prediction is wrong and the round should say so.

---

## §7 My three lenses, round 2 — what the debate changed

- **Interface-contract lost its biggest proposal to testability's own evidence.** AD-4(a) was the interface answer (widen the seam so the contract carries the decision). The measured defect was at a view that does not use the seam. **The tie-break is not simplicity here — it is relevance:** a contract change that cannot reach the defect is not a small fix, it is the wrong fix. Simplicity only decided what replaced it (one token at `system.js:74`, one clause in D7).
- **Boundary/error and testability still agree, and that is still the argument.** AD-2 and QD3-O3 both move a property out of the layer ADR-049 left with no unit tier and into the module that has a transition table. Two lenses and the line count point the same way; take it.
- **Boundary/error against a proposal I am conceding** is the round's cleanest example of the lens working: I accept QD3-O4's rule *and* find that it ships a false first stamp (§5). Conceding a proposal is not the same as not reading it.
- **Simplicity as tie-break, applied against myself twice:** withdraw AD-4(a); refuse the two-token `system.js` gate in favour of the one-token one. Applied against QD once: drop QD3-O3's parenthetical streak rule, because `allFail` already gives it free.

## §8 Remaining disagreements — three, all small, all stated for the synthesizer to settle

1. **D7's wording.** QD's draft says the per-route statuses never reach a view. I need §3's status-in-hand clause appended or D7 sanctions the shape sniff that broke `system.js`. **This is a wording merge, not a split** — I expect QD to take it, since its own §2 asks for the same thing.
2. **AD-2 / unit (b).** QD has not seen it (it is not in `quality-dimensions.r1.md`). If QD rules it LOW-and-latent on the F-2 precedent, **the code half drops and E7's identity clause drops with it** — but E1's signature fix and the prose stay, because they are true of HEAD either way. I hold that (b) is cheap and belongs with (a), and I concede the reachability point up front: it is unreachable at HEAD.
3. **AD-3.** One token, the round's only behaviour change on an unreachable input. Drop it if the synthesizer wants a zero-behaviour-change round.

Everything else on the scoreboard is converged.

## §9 What was run this round (HEAD `57ad237`)

```
cat -n src/dashboard/lib/connection.js            → RANK{ok,degraded,fail}; worst='ok' seed; 'live' never returned (AD-1/QD3-C1 ✔)
                                                    :30 allFail guarded, :27 healthy arm NOT guarded (AD-2 ✔)
cat -n src/dashboard/ui/poll.js                   → :16 home=['/api/home']; :20-23 workflow=[describe,'/api/runs']
                                                    → the :6816 pair is never co-fetched (QD3-C2 ✔)
                                                    :37 `return fn ? fn(ctx) : []` — the empty-results door (AD-2 reachability)
sed -n app.js:360-400                             → :379 onTick unguarded; :382 the undocumented guard; :386 footer every tick (QD3-O3/O4 ✔)
sed -n app.js:110-127, :128-147                   → :115 tag reads State.status (AD-1 parenthetical ✔)
                                                    :146 updateFooterClock() at BUILD time — the false first stamp (§5, NEW)
sed -n system.js:40-85                            → :72 own getJSON → res.status in hand; :74 tests !res.body; :77 buildTable;
                                                    :49 data.cpu.cores → throws on a 200 {degraded} (QD3-O2 ✔, from source)
sed -n val-202-ported-tabs.test.ts:104-118        → title promises the Unavailable component; body clicks the tab and
                                                    waitForSelector('#system-panel'). Fakes nothing, reads no cell (QD3-O2 ✔)
grep -rn perRoute src/ tests/                     → written 3×, read 0× — a synthetic view:<name> key cannot leak (§4.2)
grep -rn "footer|Updated|更新於" tests/acceptance/ → 0 hits; the footer has no assertion at any tier (§5 cost = zero)
sed -n 04-design.md:6811-6819, :6845-6859         → DES-202/206/207 as amended v27k; :6857's verbatim clause (§0)
git log -1 --format=%h -- <this path>             → 8d3584b (supersedes sha, captured before overwrite)
```

**Not done:** I did **not** re-run QD's Chromium repro. The throw is deducible from source without a browser (`system.js:74` → `:77` → `:49`), which is what I verified; QD's measurement is the operator-visible confirmation of the same path, and I rely on it for the 「0 rows, 3 `pageerror`, tag `live`」 numbers rather than re-measuring them. No suite was run — no `src/`/`tests/` edit is proposed by design this round.
