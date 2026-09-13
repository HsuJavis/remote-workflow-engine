---
stage: design (Gate 3/4), acting on the **v27 Gate 8 RE-REVIEW #4 send-back** (`07-review.md:7`, `send_back = ["design","impl"]`) — the design half is **BF-8**.
lens: adversarial group — (a) interface-contract · (b) boundary/error · (c) testability, with Karpathy simplicity-first as the tie-break.
round: 1 — independent proposal. Written WITHOUT reading this round's `quality-dimensions.r1.md` (the file at that path is still the v27l round's, mtime 12:44 vs this session at 17:36; I did not open it).
head: `2a738bd`. Every number, line and grep below was MEASURED at that sha by the commands in §10 — nothing is inferred from prose.
supersedes_on_disk: the v27l round-1 proposal held this path. Preserved at `git show 24797c5:.sdlc/features/001-remote-workflow-engine/.panel/design/adversarial.r1.md` (`git log -1 -- <path>` → `24797c5`, no later touch). Read history with `git show` — never `checkout` / `restore` / `stash` (CLAUDE.md).
touched: this file only. `04-design.md`, `03-tasks.md`, `src/`, `tests/` are untouched by me.
---

# Adversarial — round 1: BF-8's rule is right, and BF-8's own wording of it is not landable as written

## §0 Two stale prompt clauses, and one altitude judgement

**Stale clause 1.** The dispatch says 「`03-tasks.md` does NOT exist yet — the design synthesizer writes it」. It exists: 246 KB, `TASK-216` at `:1846`. Everything below is an **amendment to living rows**, never a first authoring. (The v27j and v27l round-1 proposals flagged the same clause; it is a template artefact.)

**Stale clause 2.** Nothing in this round is a decomposition question, so 「where task-splitting affects your lens」 has one answer and it is a refusal: **BF-8 forbids a new TASK id and I do not propose one.** The v27l panel conceded to mint `TASK-217` and it never landed (`grep -n 'TASK-217' 03-tasks.md` → 0 hits) — the synthesizer was right to refuse and I am not re-litigating it. §8 gives the landing path for the one piece of test code I propose, without a task row.

**Altitude.** `state.yaml tech_stack`: Node 22.6 / TS strict ESM / vitest / better-sqlite3 / hand-rolled JSON-RPC-over-HTTP MCP / **two `GatewayClient`s driving real LLM sessions** / `node:vm` + `child_process` sandbox. The project is **both** a conventional system and an AI-agent system. **This round's delta is single-altitude and it is the conventional one**: six client `.js` files, one design row, zero model bytes, zero agent loop. Forcing the agent altitude here (「model replaceability」, 「loop self-sustainability」) would be the irrelevant reading and I do not apply it.

One hop out the agent altitude *does* enter, as **observability**, and it is why this class has been ruled blocking three times: the dashboard is the operator's only continuously-visible answer to 「is what I am looking at true right now」 while multi-hour agent runs are in flight. Every severity call below is anchored to that, not to tidiness.

---

## §1 Summary

**I agree with BF-8 completely on the diagnosis and on the routing.** ARCH-125 states only the negative; no row states the positive; four incompatible behaviours ship for one fault; a sweep has nothing to grep for. Stating the positive rule on DES-206 is the correct and minimal repair, and it is worth the round.

**What I am here to report is that BF-8's own required shape, typed verbatim into DES-206, does not land.** Three findings, each re-derived at `file:line` at `2a738bd`:

1. **BF-8(b) — 「poll tick → no DOM write at all」 — is violated at HEAD by three of the four sites this same gate blessed, not by zero.** `system.js:78-82` clears the panel and paints 無法取樣 on **every** degraded tick (BF-4's own shape); `models.js:55-56` does the same; `issues.js:102-104` repaints both lists with the server's raw exception text on the degraded arm and writes nothing on the `fail` arm. A clause the tree violates the day it lands is the **BF-3 class** — the exact defect this row was sent back for one round ago. It must ship WITH the compliance table (§4), or it ships false.

2. **BF-8(b)'s other half — 「first paint → clear + the Unavailable component」 — is violated by `home.js:231` and `run.js:475`, and at `home` the consequence is a fabricated NUMBER on the product's primary page.** `app.js:429` first-paints Workflows as `renderHome(panel, { cards: [], lang })`; `home.js:153-159` turns that into the segment tabs 「全部 (0) · 執行中 (0) · 已註冊 (0)」. If `/api/home` is degraded or failing, `home.js:231` bails on **every** tick, so those three zeros stand indefinitely beside a truthful 降級 tag, for a tab that may have twelve workflows. That is **the same predicate BF-7 is blocking on** — 「a fabricated quantity in the same sentence and styling as the real ones」 (`07-review.md` §8) — on a bigger surface, and the review's own population table (§8) records `home.js:231` as 「**clean** (BF-2)」. It is clean on the tick arm only. **Rated MID / blocking-candidate**, with the honesty caveat that I have no browser in this session: this is derived at `file:line`, not measured in Chromium. §6 gives the six-line case that settles it either way.

3. **BF-7's prescribed fix, landed as written, turns `val-199-workflow-detail.test.ts:294-295` RED, and the send-back does not say so.** BF-7 requires `if (dagRes.status !== 'ok') return {…};` ahead of `workflow.js:328`. BF-6's own lock (`val-199:272-299`) degrades `/api/runs/:id` **and** `/api/runs/:id/dag` together, then asserts `expect(await page.$('.run-summary')).toBeNull()`. With BF-7's guard in place the bail happens **before** `renderLegend`, so the previous summary survives and `after` is not null. The implementer then either weakens the new guard to keep the old assertion green — re-opening BF-7 — or edits the old case without a mandate. One sentence in the row prevents a whole round.

**The rule I propose (§3)** is BF-8's rule with the two gaps closed and one refinement: **a composed element may OMIT a member whole, but never SUBSTITUTE a value for it.** That single distinction is what separates the three shipped repairs this gate blessed (`run.js:512`, `workflow.js:329` — omission, correct) from the three it condemned or recorded (`workflow.js:326`, `run.js:502`/`workflow.js:327`, `agent-panel.js:234-241` — substitution, wrong). Without it the rule either re-opens BF-5/BF-6 or fails to reach `run.js:502`.

**The testability half (§6–§8), which is my lens's real contribution.** This class has no unit tier by construction (ADR-049 refuses jsdom), and the three acceptance cases that pin it cover **one arm each, at one site each, and no case covers the other arm anywhere**. On top of the per-arm cases, I propose the one mechanical oracle this class can have: a **substitute-literal tripwire over `clientCorpus()`**. Measured at `2a738bd` it matches **exactly four lines** — `workflow.js:326` (this round's blocker) and `workflow.js:327`, `run.js:502`, `agent-panel.js:234` (the three recorded-debt substitutes) — and nothing else. That is the written inventory the loop has been missing: the thing a sweep can grep FOR.

**Tie-break discipline, stated once.** Every proposal below is either a sentence that makes a false row true, or a rule that moves a decision to where it already belongs. §9 lists what I refuse, by name: no `renderable()` predicate in `lib/`, no `okBody(res, fallback)` helper, no new DES/TASK/ADR id, no ARCH edit, no fourth connection state, no per-surface stale badge, no seam change to `app.js:379`.

---

## §2 Findings

| id | lens | sev | routing | one line |
|---|---|---|---|---|
| **A-1** | interface-contract | **MID — blocking candidate** | **impl (BF-7's own commit)** | `home.js:231` + `app.js:429` + `home.js:153-159`: a degraded/failed `/api/home` leaves 「全部 (0) · 執行中 (0) · 已註冊 (0)」 standing indefinitely on the primary page — a fabricated count, the same predicate BF-7 blocks on. The review's §8 table calls this site 「clean」; it is clean on the tick arm only. |
| **A-2** | testability | **MID — blocking for BF-7's commit** | **impl (BF-7) + a design sentence** | BF-7's required guard turns `val-199:294-295` (`expect(after).toBeNull()`, BF-6's own lock) RED, because that case degrades BOTH routes and the new bail precedes `renderLegend`. Not named in the send-back. |
| **A-3** | interface-contract | **MID** | **design (this gate)** | BF-8(b) verbatim is violated at HEAD by `system.js:78`, `models.js:55`, `issues.js:102` (tick arm) and by `home.js:231`, `run.js:475` (first-paint arm). Landing the clause without the compliance table reproduces the BF-3 defect inside the row that exists to end it. |
| **A-4** | interface-contract + simplicity | MID | **design (this gate)** | The rule needs the **omit ≠ substitute** distinction or it cannot both ratify `run.js:512`/`workflow.js:329` (blessed, pinned) and condemn `run.js:502`/`workflow.js:327` (recorded debt). BF-8's text has neither clause. |
| **A-5** | interface-contract (consumability) | LOW | **design prose, repairs are debt** | BF-8(e) says 「the only such component in the tree today is `system.js:79`」. Measured: **five** instances — `system.js:79` (zh-only), `models.js:56` (en-only), `issues.js:103-104` (the raw wire text), `app.js:198` and `:414`. Two of them are a live **REQ-131 acceptance** breach (「畫面不得散落字面值」), not merely `QD-R3` debt. |
| **A-6** | testability | MID (method, not code) | **design `tests:` line** | The three pins cover one arm each and no case covers the other arm at any site: `val-198:262`/`val-200:215` establish a healthy paint then degrade (KEEP arm); `val-202:130` degrades from load (UNAVAILABLE arm). No test at HEAD can distinguish 「clears once」 from 「clears every tick」 at `system.js`, or 「keeps」 from 「never painted」 at `home.js`. |
| **A-7** | boundary/error | LOW | design decl. + 1 impl line, inside BF-7 | `workflow.js:367`'s `onPick` calls `paintSelected(...)` without `await` and **discards its return**, so a degrade observed on a run-switch never reaches `nextConnection`; same at `system.js:90`, `models.js:68`, `issues.js:119` (`render()` discards `onTick`'s statuses). The tag lags the fault by up to one tick on exactly the path BF-8 says needs the UNAVAILABLE arm. |
| **A-8** | boundary/error | LOW | design prose | `models.js:55` and `issues.js:80`/`:102` re-derive the verdict from the body's shape while `res.status` is in hand two lines above. Fail-open in one direction: a **non-2xx** body carrying `degraded` is `fail` at `connection.js:46` but takes `issues.js:102`'s degraded branch and renders the wire text as if it were a sanctioned degrade. |
| **A-9** | boundary/error | LOW | recorded, not proposed | `app.js:386` stamps 「Updated HH:MM:SS」 on **every** tick, including one where every route failed and no view wrote a pixel. Not a `getJSON` consumer, so out of this rule's population — named so the synthesizer can see I considered and declined it (the remedy interacts with `app.js:146`'s pre-tick stamp and is not worth a clause this round). |

Not re-litigated: `A4-2` (the raw exception on the wire — architect's lane, correctly recorded as debt), `D3-5`/`QD3-R1` (the `app.js:379` seam — the review ruled it out of scope and I agree, see §5), `F-3`, `QD-R3`, `DEBT-A/B`, `TOOL-FORK`.

---

## §3 The proposal — exact text for the DES-206 amendment

Append as one `amended (…)` bullet in the row's house style, `iter: v27m`. **No new DES id, no new TASK id, no trace-link change, no ARCH edit, no code.**

> **amended (2026-09-13, v27 Gate 8 RE-REVIEW #4 — BF-8): the POSITIVE rule for a non-`ok` result, over the whole `getJSON`-consumer population.**
> This row carried ARCH-125's negative only (「never rendered as data」). Ten sites consume a `getJSON` result and **four** incompatible positive behaviours ship for one fault, so six repairs each fixed the named line and the seventh survived by letter. The rule below is total over `classifyResponse`'s three outcomes and is stated over the whole population; the table at the end names every HEAD site that does not yet satisfy it, so no sentence here is silently false.
>
> **(V) The verdict is `res.status`, never the body's shape.** A consumer holding the `{status, body}` pair decides on `status !== 'ok'` and does not re-derive the classification at the call site (`!body`, `body.degraded`, `!Array.isArray(…)`). Re-derivation is the habit that produced every instance of this class and it is wrong in **both** directions: a 200 `{degraded:null}` is `degraded` at `connection.js:48` but falsy at a call site, and a **non-2xx** body carrying a `degraded` key is `fail` at `:46` yet takes a 「degraded」 branch written against the body. Shape guards on an **`ok`** body are unaffected — they run after the verdict, never instead of it. Where the body crosses `app.js`'s tick seam **without** its status (`app.js:373-379` builds `results` and `bodies` and passes only `bodies` — `D3-5`, deliberately out of scope), the stand-in is a **positive test of the declared success shape** (`Array.isArray(body.running)`), which is fail-closed for `degraded` and `fail` alike; the `body.degraded` sniff beside it is redundant and a positive-shape test alone is the form to write.
>
> **(K)/(U) What the consumer does is decided by ONE question: does this surface already hold a successful paint of the CURRENT identity?** A surface's identity is (view, route params, and the selection the surface is keyed to — `state.selectedRunId` for the workflow page's figure, `agentId` for the agent panel).
> &nbsp;&nbsp;**yes → KEEP.** No DOM write derived from the non-`ok` resource: no `replaceChildren`, no `textContent`, no style, no further fetch. The last-known render stays, and the nav tag is the surface that reports the fault (ARCH-124).
> &nbsp;&nbsp;**no → UNAVAILABLE.** Clear the part of the surface derived from that resource and paint the one Unavailable component in its place. **This arm is mandatory, not an optimisation.** A view that bails on a first paint leaves whatever its `render()` skeleton wrote, and that skeleton is itself a constructed payload: `app.js:429` first-paints Workflows as `renderHome(panel, { cards: [], lang })`, which `home.js:153-159` renders as 「全部 (0) · 執行中 (0) · 已註冊 (0)」 — three fabricated counts that stand for as long as the degrade lasts, because `home.js:231` bails on every subsequent tick. A blank surface is the least this arm may produce; a **zero is not blank**.
> &nbsp;&nbsp;Never the previous identity's content under a new identity: a bail on the tick after a run-switch leaves the previous run's graph under the newly-selected chip, which is a worse lie than a blank.
>
> **(O) A COMPOSED part may OMIT a member whole; it may never SUBSTITUTE a value for one.** Where one element is built from several resources — `run.js:352`'s legend is the `/dag` warnings plus the `/api/runs/:id` summary — the members sourced from the non-`ok` resource are omitted **whole** and the `ok`-sourced members repaint. `renderLegend(…, viewRes.status === 'ok' ? viewRes.body : null, …)` (`run.js:512`, `workflow.js:329`) **is** that form and is correct. Omission is permitted only where the member's absence states nothing; a **count, a total, a state word or a money figure** may not be omitted and re-derived — those take KEEP or UNAVAILABLE. **(O) reaches only a genuinely composed element.** The legend repaints because its warnings come from the still-`ok` `/dag`; `#run-usage` (`run.js:513`) has **no** `ok` input — it is whole-sourced from `/api/runs/:id` — so it falls under (K) and is not touched at all, never cleared.
>
> **(N) A consumer may never construct a payload, record or row and hand it to a render function, a `lib/` projection, or a geometry function.** The prohibited shape, by name: `dagRes.status === 'ok' ? dagRes.body : { cells: [], edges: [], warnings: [], lanes: [], current: null }` (`workflow.js:326`) — `paintSwimlane` erases before it appends (`run.js:219`/`:222`), so the fabricated payload wipes the live figure, and `renderLegend` computes `nodeCount` from the invented `cells` (`run.js:361`) and prints 「0 個節點」 for a run that has one (`:367`). A substitute **value** is the same prohibition: `((viewRes.body && viewRes.body.agents) || [])` (`run.js:502`, `workflow.js:327`) silently swaps every node's APPLIED model for the DECLARED default, and `res.body || {}` → `body.record || { …, tokens:{input:0,output:0} }` (`agent-panel.js:234-241`) paints six stat cards of zeros under DES-205's own 「no confident wrong statement」 rule. **No helper of the `okBody(res, fallback)` kind may be introduced**: its natural call at any of these sites is byte-for-byte the defect.
>
> **(S) One component, one string source.** The Unavailable component is `el('div', 'empty', t(lang, 'unavailable'))` — the `.empty` hook DES-209's STYLE_HOOKS already declares (shell/ported row), and **one** key added to `lib/strings.js` in both languages. Never a per-file literal, and **never the server's own `degraded` text**: that value is an unformatted exception message on an unauthenticated wire (`server.ts:616`), written for the log line beside it, not for the operator. REQ-131's acceptance is explicit — 「兩種語言的字串同源於單一字串表,畫面不得散落字面值」 — and the tree carries **five** instances of this component under other names, listed in the table below.
> &nbsp;&nbsp;**The zh value is `'無法取樣'`, verbatim** — it is MOVED out of `system.js:29`, not chosen anew: `val-202:154` asserts `expect(panelText).toContain('無法取樣')` on the BF-4 lock, so a key minted with any other zh string turns a blessed test red and invites someone to edit it. The `en` value is the implementer's, and `system.js:29`'s `UNAVAILABLE` const is deleted in favour of `t(lang,'unavailable')` when that site is repaired (LOW, below) — not before, or the two diverge.
>
> **(R) Every status observed reaches the reducer.** A KEEP or UNAVAILABLE disposition still returns the statuses of the fetches it already made (`return { [dagUrl]: dagRes.status, [viewUrl]: viewRes.status };`), or the tick under-reports and, with `app.js:382`'s `Object.keys(results).length > 0` guard, a tick that observed only failures can produce no observation at all. A caller that invokes a paint outside the tick (`workflow.js:367`'s `onPick`, `system.js:90`/`models.js:68`/`issues.js:119`'s `render()`) discards that return today; until it folds it, the tag lags such a fault by at most one tick.
>
> **DES-205 inherits this rule verbatim.** `openAgentPanel` is not an `onTick` view, and every open is a **first paint of a new identity**, so the UNAVAILABLE arm always applies: the panel renders the component, not a record of zeros. **DES-207 inherits it** for the three ported tabs; its own sentence 「a `degraded` section renders the ONE 「無法取樣」 component … instead of reaching a render function as data」 is this rule's UNAVAILABLE arm, unchanged in substance and now carrying (V), (K) and (S).
>
> **What HEAD does not yet satisfy** (so this clause is not silently false — every row is a DECLARED debt item with an owner, not a drift row a later gate discovers):
>
> | site | arm | rule | HEAD | disposition |
> |---|---|---|---|---|
> | `workflow.js:326` | any | (N) | synthesizes the empty DAG payload | **BF-7, blocking, this round** |
> | `home.js:231` + `app.js:429` | first paint | (U) | bails → 「全部 (0)」 stands indefinitely | **MID** — nominated for BF-7's commit |
> | `run.js:475` | first paint | (U) | bails → empty `#dag-graph` | LOW |
> | `workflow.js:357` | first paint | (U) | bails → unbuilt header/chips | LOW |
> | `system.js:78` | tick | (K) | clears + repaints the component every tick | LOW, declared deviation (note below) |
> | `models.js:55` | tick + (V) + (S) | (K),(V),(S) | clears every tick, decides on `!Array.isArray`, `'(unavailable)'` en-only | LOW ×3, declared deviation |
> | `issues.js:102` | tick + (V) + (S) | (K),(V),(S) | repaints both lists with the raw wire text | LOW ×3, declared deviation |
> | `issues.js:80` | identity change | (U) | hides the detail box silently | LOW |
> | `run.js:513` | tick | (K) | `renderUsageBox(usage, viewRes.body && viewRes.body.usage)` clears `#run-usage` on every degraded tick — the box is WHOLE-sourced from `/api/runs/:id`, so KEEP applies and the call is simply not made | LOW (`QD3-O2`), declared deviation |
> | `run.js:502`, `workflow.js:327` | any | (N) | APPLIED model silently replaced by DECLARED | LOW (`QD3-O2`), declared deviation |
> | `agent-panel.js:234-241` | first paint | (U),(N) | synthesizes a zeroed record | **MID** (`QD-O5`, DES-205's lane) |
> | `system.js:29`/`:79`, `models.js:56`, `issues.js:103-104`, `app.js:198`/`:414` | — | (S) | five per-file literals, two of them single-language | LOW, REQ-131 acceptance |
> | `app.js:379` | — | (V) | drops the statuses at the seam | LOW (`D3-5`) |
>
> **One declared DEVIATION — owed, not granted:** the three ported tabs (DES-207) replace their panel on **every** degraded tick rather than keeping the last-known table. This contradicts (K). The rule does **not** carve an exception for them; the deviation is recorded LOW and left standing *for this round only*, because it is BF-4's just-landed shape, pinned by `val-202:130-166`, and re-opening it inside a send-back round would be this gate churning its own repairs. Whoever closes it closes `system.js:78`, `models.js:55` and `issues.js:102` in one edit.

---

## §4 Why the compliance table is part of the amendment, not of this panel file (A-3)

The v27l repair was sent back one round earlier for **exactly** this: a row whose prose an implementer could type verbatim and thereby write the defect. BF-8's clause has the same property in the other direction — an implementer who reads 「poll tick → no DOM write at all」 and greps for violations finds **five** at sites the same document's §8 table calls 「clean」, and has no way to tell 「this is debt the row knows about」 from 「this is drift I must fix now」. Two outcomes, both bad: scope explodes into four closed BFs, or the sweep is skipped and the clause is decorative.

The table costs twelve lines and closes both. It is also the deliverable BF-8(d) actually asks for — 「stated over the WHOLE population … so the three non-blocking sites have a rule to be measured against even though they are debt this round」. The three sites BF-8 names are `run.js:513`/`:502` and `agent-panel.js:234`; the honest population is thirteen arms, and I measured them rather than accepting the count.

---

## §5 The one place BF-8(a) is not satisfiable, said out loud

BF-8(a) requires the rule 「in terms of `res.status`, never of the body's shape」. **Three consumers structurally cannot see `res.status`**: `home.js:231`, `run.js:475` and `workflow.js:357` are fed `bodies` by `app.js:379`, which keeps `results` for itself. Closing that is `D3-5`/`QD3-R1`, and the review rules it out of scope by name (§8: 「`app.js:379`'s unguarded `await` and dropped statuses stay out of scope」).

So (V) is written in two halves — the verdict where it is in hand, and a **positive success-shape test** as the declared stand-in where it is not. This is not a weakening: `Array.isArray(body.running)` is fail-closed for `degraded` (no `running` key) **and** for `fail` (body `null`), which the negative sniff `body.degraded` alone is not. When the seam is eventually closed the stand-in collapses into the primary form and **nothing else in the rule moves** — which is the argument for stating it this way now rather than waiting for the seam.

**I refuse to propose the seam change this round**, and I want the reason on the record because the v27l panel proposed it and withdrew it: a seam change fixes the three views that already work and cannot reach `workflow.js:326`, `agent-panel.js:234` or `system.js:72`, all of which call `getJSON` themselves and already hold the verdict. The defect is not upstream of the check; it is in what is written after the check passes.

---

## §6 Testability — the three pins cover one arm each, and nothing covers the cross (A-6)

Measured, not read:

| case | fault injected | when | arm it pins | arm it cannot see |
|---|---|---|---|---|
| `val-198:262` | `/api/home` → 200 `{runs:[],degraded}` | **after** a healthy card grid (`:272-275` waits for `val198-running`) | KEEP at `home.js` | first paint — the 「全部 (0)」 case (A-1) |
| `val-200:215` | `/api/runs/:id/dag` | **after** `before = $$eval(…).length > 0` | KEEP at `run.js` | first paint |
| `val-202:130` | `/api/system` | **from page load** (`setRequestInterception` before `goto`) | UNAVAILABLE at `system.js` | tick — cannot distinguish 「clears once」 from 「clears every tick」 |
| `val-199:272` | `/api/runs/:id` **and** `/dag` together | after a healthy `.run-summary` | omission at `workflow.js:329` | the asymmetric fault; and it is what A-2 turns red |

Two consequences the `tests:` line must state.

**(1) An assertion in this class must be an invariant ACROSS the fault.** `expect(after).toBe(before)` on a counted DOM property, never a bare `toBeNull()` / 「non-zero」. `val-199`'s BF-6 case is the proof: its own comment at `:268-270` concedes 「an empty repaint either way」, and it passes over a blanked graph because degrading both routes makes `view` null and drops the element the assertion looks for. BF-7's new case must assert the `[data-node-cell]` count **unchanged** and the `.run-summary` node count **still true** — which the send-back already says, and which should be stated once as the rule rather than per case.

**(2) A new case must target the arm its site does not already pin.** Writing a fourth 「healthy then degrade」 case adds nothing. The missing cases, in severity order: `home` first-paint degrade (A-1, six lines — move `setRequestInterception` before `goto` in a copy of `val-198:262` and assert the segment tabs do **not** read `(0)`); `system` tick (flip `val-202`'s handler behind a boolean so the first load succeeds, assert `.sys-table tr` ≥ 1, then degrade and assert the disposition the row DECLARES); `run`/`workflow` first paint.

---

## §7 The one mechanical oracle this class can have

BF-8's own diagnosis is 「without a positive rule there is nothing to grep FOR, only crashes — and this class does not crash」. A rule in prose does not fix that; a rule plus an inventory does.

**The tripwire.** Every line in `src/dashboard/ui/**/*.js` matching **both** `/[Rr]es\.(body|status)/` and `/(\|\||: )\s*[{[]/`, **with comment lines stripped by the test itself**, must appear in a closed allowlist keyed on **(file, matched line text)** — never on a line number, which every repair shifts. Two mechanics the spec must name or it is not implementable as written: `clientCorpus()` (`tests/helpers/client-corpus.ts:27-31`) concatenates raw file text and is **not** comment-stripped, so the test strips comments itself; and the concatenation loses file boundaries, so the allowlist's `(file, text)` key needs the per-file walk — `clientFile(rel)` over the same `listJsFiles` enumeration, with `clientCorpus()` kept beside it only as DES-208's anti-vacuity anchor. At `2a738bd` no comment line matches, so the four-hit measurement below is unaffected either way. Measured at `2a738bd`:

```
src/dashboard/ui/agent-panel.js:234:  const body = res.body || {};
src/dashboard/ui/workflow.js:326:  const payload = dagRes.status === 'ok' ? dagRes.body : { cells: [], edges: [], warnings: [], lanes: [], current: null };
src/dashboard/ui/workflow.js:327:  const agentsById = new Map(((viewRes.body && viewRes.body.agents) || []).map((a) => [a.agentId, a]));
src/dashboard/ui/run.js:502:  const agentsById = new Map(((viewRes.body && viewRes.body.agents) || []).map((a) => [a.agentId, a]));
```

Four hits: **this round's blocker, and the three substitutes already recorded as debt.** Zero false positives. After BF-7 lands the allowlist is three entries, each carrying its debt id, and it may only shrink — `toBe(3)` on the count, with DES-208's mandatory positive anchor beside it (`expect(clientCorpus().length).toBeGreaterThan(5000)`), because a negative grep with no positive anchor is this ledger's named vacuous-survivor class.

**Stated honestly: it is a tripwire, not a proof.** `const EMPTY_DAG = {…}` at module scope evades it; so does a fallback built in a helper. That is precisely why (N) is stated as a rule and the allowlist is stated as its inventory — the grep's job is to make the class *visible*, not to decide it. It is also the only UT-tier evidence this layer can have at all (ADR-049 leaves `ui/` no unit tier), and the precedent already exists in the same corpus: `dashboard-diagram-render.test.ts:114` runs three corpus-wide negatives with exactly this discipline.

---

## §8 Landing path (no new task row)

BF-8 forbids a new TASK id and forbids the design gate touching code. The tripwire is test code. Three options, in my order of preference:

1. **It rides BF-7's impl dispatch.** BF-7 already adds a `val-199` case and edits test files, and the send-back already says 「If BF-8's DES-206 clause lands first and differs in any detail, the clause wins and this row is its application.」 The tripwire is one `it()` in `dashboard-diagram-render.test.ts`'s existing corpus block, ~12 lines, and it is the falsification BF-7's own guard is otherwise unprotected by after the next repair moves the line.
2. If the orchestrator will not widen BF-7's commit by one test: the `tests:` line names the tripwire **as owed**, in the 未實作 form, with the owner and the measured four-line hit set inline, so the next Gate 5 dispatch has the spec. It must NOT be written as if it exists — DES-208's own 「dangerous green」.
3. What I will not accept: dropping it and leaving the `tests:` line as the current 「no unit tier by construction」 sentence alone. That sentence is why six rounds of repair produced six greps of six different things.

**Same commit, same edit, per BF-8:** DES-205 gains the inheriting sentence; DES-207 gains (V)/(K)/(S) and keeps its own declared UNAVAILABLE-always disposition; `IMPL-281`'s 「all 16 sites are guarded」 is corrected by the population table (the review already requires this on the impl side — the design row should not restate it).

---

## §9 What I refuse, and why (Karpathy tie-break)

| refused | why |
|---|---|
| a pure `renderable(res)` / `okBody(res, fallback)` in `lib/` | It answers 「is this ok?」, which `classifyResponse` already answered and `res.status` already carries. Its natural call at `workflow.js:326` **is** the defect (the review reaches the same conclusion independently; `IMPL-281` proposed it). A helper cannot fix a site whose bug is the fallback it returns. |
| a new DES id for the degrade contract | DES-206 is the `ui/` layer contract. A second row describing the same layer is the mirror-pair class this repo shrinks on principle. |
| a new TASK id (`TASK-217` redux) | BF-8 forbids it; the v27l concession never landed; §8 gives the landing path without one. |
| any ARCH edit | `02-architecture.md:3361`'s looser `worstOf`/「degraded string」 forms are `D3-6`, the architect's lane. A design row may not amend an ARCH row and I do not. |
| a fourth connection state, or a per-surface 「stale」 badge | The owner ruled on exactly this on 2026-09-13 (`ARCH-124 owner_decision`): three source tags only, a fourth steps outside DES-209's fidelity oracle. The KEEP arm's staleness is reported by the tag that exists. |
| closing the `app.js:379` seam | §5. Out of scope by the review's ruling, and it cannot reach the three sites that matter. |
| touching `run.js:512` / `workflow.js:329` | They are the (O) omission form and they are **correct**. Re-opening two freshly-pinned repairs to satisfy a stricter reading of (K) is churn, and §3's (O) clause exists to say so in writing. |
| a per-view split of the rule | 「Four incompatible behaviours」 is the disease. One rule, one declared exception (DES-207's tabs), priced in the table. |

---

## §10 Verification — every command run, at `2a738bd`

```
git rev-parse --short HEAD                                  -> 2a738bd
git log -1 --format=%h -- .panel/design/adversarial.r1.md   -> 24797c5   (supersedes line)
grep -rn "getJSON(" src/dashboard/ --include=*.js           -> 13 hits: 1 def (poll.js:42), 2 comments, 10 consumption sites
grep -rn "\.status !== 'ok'\|\.status === 'ok'" src/dashboard --include=*.js
                                                            -> 4 code hits: system.js:78, run.js:512, workflow.js:326, :329
grep -rnE "([Rr]es\.(body|status))" src/dashboard/ui/*.js | grep -E "(\|\||: )[[:space:]]*[\{\[]"
                                                            -> 4 hits (§7, verbatim)
grep -rn "el('div'" src/dashboard/ui/*.js                   -> issues.js:24,:103,:104  models.js:56,:58  system.js:79
grep -rn "unavailable|無法" src/dashboard/{ui,lib}/*.js      -> app.js:198,:414  models.js:56  system.js:29  strings.js:26
grep -n "TASK-217" 03-tasks.md                              -> 0 hits
```

Read at `file:line` (not summarised from a gate note): `poll.js:15-55`, `lib/connection.js:1-50`, `app.js:111-160`, `:185-200`, `:360-419`, `:429`, `home.js:120-235`, `run.js:195-235`, `:350-369`, `:460-515`, `workflow.js:255-374`, `system.js:20-91`, `models.js:45-69`, `issues.js:70-120`, `agent-panel.js:215-267`, `lib/strings.js:1-71`, `dashboard.css:136-137`, `val-198:250-293`, `val-199:262-300`, `val-200:205-284`, `val-202:125-167`, `04-design.md:6811-6821` (DES-202), `:6838-6845` (DES-205), `:6846-6861` (DES-206/207), `:6862-6870` (DES-208), `:6871+` (DES-209 STYLE_HOOKS), `02-architecture.md:3355-3380` (ARCH-124/125), `01-requirements.md:1716-1744` (REQ-131), `07-review.md` §0-§9.

**Not measured, and I say so:** no browser tool in this session. A-1's user-visible consequence is derived from `app.js:429` + `home.js:153-159` + `home.js:231`, not observed in Chromium. §6 gives the case that settles it; if the synthesizer can run it, that evidence outranks my derivation in either direction.

---

## §11 Risks in my own proposal

1. **The rule declares ~13 non-compliant arms at once.** A later reviewer could read the row as 13 new deviations. This is the price of a uniform rule and I judge it worth paying — the alternative (a rule parameterised per site) is the disease. Mitigation is the table: every arm is declared, severity-rated and owned, so `trace`'s drift detector and the next reviewer both see a ledger entry, not a discovery. **If the synthesizer lands only part of my proposal, land the table.**
2. **A-1 may be wrong about severity.** If `/api/home` degrades only transiently, the zeros are a sub-second flash. The blocking-candidate rating assumes a sustained degrade, which is the condition every other finding in this loop was rated under (`val-198`'s own case waits 7 s). If the browser case shows the counts are repainted from some path I did not find, A-1 drops to LOW and nothing else in §3 moves.
3. **A-2 is the finding most likely to be actioned wrongly.** The correct response is to strengthen `val-199:294-295` into the invariant form (`expect(after?.textContent).toBe(before)`), **not** to soften BF-7's guard. If the synthesizer passes this to impl, pass the remedy with it.
4. **The tripwire's regex is mine, not a standard.** It is tuned to a four-line hit set I measured; a differently-written substitute evades it. It buys visibility, not proof, and §7 says so. If the synthesizer thinks the false-negative rate makes it worse than nothing, drop it and keep §3 — but then the `tests:` line owes a different mechanical oracle, because 「no unit tier by construction」 alone is how this loop got here.
5. **I did not re-verify the nine `INV-V27-*` invariants or the server side.** Out of this round's delta; the review did it at `18b9c03` and nothing since touches `src/*.ts`.

---

## §12 Expected disagreements with the other lens (quality-dimensions), stated before I read it

1. **The `app.js:379` seam.** QD has carried it as `QD3-R1`/`D3-5` for three rounds and observability is its lens; I expect it to propose closing it now, as the 「real」 root cause. **My position:** §5. Out of scope by the review's explicit ruling, and structurally unable to reach the three sites that hold their own verdict. If QD's argument is 「the rule is ugly in two halves」, I concede the aesthetics and hold the scope. Prediction: we converge on 「stated in two halves now, collapses to one when the seam closes」.
2. **A per-surface staleness affordance.** Consumability will want the operator to see *which* panel is frozen, not just a nav tag. I expect a 「stale」 badge or a dimmed surface. **My position:** refused (§9) — the owner ruled three source tags on 2026-09-13 and a fourth affordance steps outside DES-209's fidelity oracle. This is the disagreement most likely to need the synthesizer rather than us.
3. **`agent-panel.js` (QD-O5) severity.** QD upgraded it to MID this round and owns it; I expect it to argue for repairing it inside BF-8's edit. **My position:** the RULE must cover it (my §3 makes DES-205 inherit, and the UNAVAILABLE arm always applies there), the REPAIR is debt — it changes the panel's rendering shape, which is a DES-205 dispatch, not a clause. Expect to converge on 「specified now, repaired next」.
4. **The string table.** QD carries `QD-R3` as debt. I am raising two of its instances to a **REQ-131 acceptance** breach (A-5), which is a promotion QD may resist as scope. **My position:** the promotion is textual — the clause is one key — and I am not dispatching the other four sites.
5. **The tripwire.** I expect QD to prefer a `lib/` predicate with real unit tests (it proposed `renderable()` last round) over a source grep. **My position:** §9's first row. Both of us refused the predicate last round for different reasons; if QD proposes it again, the refusal is that the defect is downstream of the check, not in it.
6. **Where I expect to be told I am wrong:** A-1's severity (see §11.2), and possibly A-3 — QD may argue the compliance table belongs in this panel file rather than in the design row, to keep the row short. I would concede a shortened table (site + arm + severity, no prose) but not its removal: a clause HEAD violates silently is the BF-3 class, and that is the one thing this round exists to stop repeating.
