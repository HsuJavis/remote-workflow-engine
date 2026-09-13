# Design panel — Adversarial group (interface-contract · boundary/error · testability), round 1

- **stage:** Design (Gate 3/4), acting on the **v27 Gate 8 RE-REVIEW #2 send-back** (`07-review.md:7`, `send_back = ["impl","design"]`). I label this round **v27L** for reference only; the synthesizer coins the real id.
- **round:** 1 — independent proposal, written **without** reading this round's `quality-dimensions.r1.md`.
- **scope as I read it.** The send-back's design half is **BF-3** (`07-review.md:246-258`). It was **already closed by the implementer** in the v27k run (`b124430`, `state.yaml gates.design.note`: 「BF-3 — dispatched alongside the impl-owned BF-1/BF-2 rather than a separate designer pass」). So this gate's honest job is **not** to re-do BF-3; it is to re-open it at file:line and run the **induced-drift sweep on the row it touched** — which is exactly the job §10 of the same review says was skipped one round earlier (「the repair scope should be the grep, not the line」). I did that, and it found things.
- **supersedes:** this path held the v27j round-1 proposal. Preserved at `git show 8d3584b:.sdlc/features/001-remote-workflow-engine/.panel/design/adversarial.r1.md` (verified: `git log -1 -- <path>` → `8d3584b`, no later touch, so that sha reproduces the exact bytes I replaced). Never `git checkout` / `git restore` / `git stash` — CLAUDE.md.
- **two stale prompt clauses, flagged so the synthesizer is not misled:**
  1. 「`03-tasks.md` does NOT exist yet」 — it does: 240 KB, `TASK-216` at `:1846`. Anything I propose is an **amendment to a living file**, never a first authoring. (The v27j round-1 proposal flagged the same clause; it is a template artefact, not new information.)
  2. The dispatch implies the design half is unstarted. It is not: `04-design.md:6818` already carries the BF-3 amendment at `iter: v27k`.
- **I did not touch `04-design.md`, `03-tasks.md`, `src/` or `tests/`.** Round 1 writes only this file. Every edit below is a **proposal with exact text**, for the synthesizer to land or refuse.
- **everything numeric below was measured**, at HEAD `57ad237`, by the commands in §9 — no claim is inferred from prose.

---

## §0 Altitude judgement — which system is this, and does my lens read differently?

`state.yaml tech_stack`: Node 22.6 / TypeScript strict ESM / vitest / better-sqlite3 / hand-rolled JSON-RPC-over-HTTP MCP server / **two `GatewayClient` implementations driving real LLM sessions** (LiteLLM proxy + `@anthropic-ai/claude-agent-sdk`) / `node:vm` + `child_process` sandbox / ajv retry-on-mismatch.

**The project is both altitudes.** It is a conventional server *and* an AI-agent system: agents are the thing it runs, and replaceability-of-model / self-sustainability-of-loop are live quality questions elsewhere in this ledger.

**This round's delta is single-altitude, and it is the conventional-system one.** Everything in scope is the dashboard client: one pure reducer (`src/dashboard/lib/connection.js`, 49 lines), the `ui/` layer's poll seam, and the design rows that describe them. No model reads these bytes, no agent is replaced by them, no loop sustains itself on them. Forcing an agent-altitude reading here (「model replaceability」, 「loop self-sustainability」) would be the irrelevant altitude, and I do not apply it.

**One hop out, the agent altitude does enter — as observability, and it is why BF-1/BF-2/BF-3 were blocking at all.** The nav tag is the operator's only continuously-visible answer to 「is what I am looking at true right now」 while long agent runs are in flight. A tag that says 「連線中」 over a stale or empty view is the `degrade, never pretend` stance (REQ-131's owner ruling, `02-architecture.md:3365`) failing in the one widget whose entire job is to hold it. Every severity call I make below is anchored to that, not to tidiness.

---

## §1 Summary

**BF-3 holds for the two lines it names, and is incomplete for the row it lives in.** I re-opened `04-design.md:6815` (`boundary:`) and `:6816` (`tests:`) against the repaired tree: both now describe `src/dashboard/lib/connection.js:34-39` correctly, and `tests/unit/dashboard-lib-connection.test.js:49-58` asserts the stated case. The DEBT-C flip at `:6817` and `:7274` is real and reads SETTLED. **Nothing BF-3 was asked to do is unfinished.**

What the sweep finds is that **the line above the two it repaired is still false, and in the same way**:

> `04-design.md:6814` — DES-202's `signature:` — declares **`worstOf(perRoute) → 'live'|'degraded'|'fail'`**.
> Measured: `worstOf` returns **`'ok'|'degraded'|'fail'`**. `'live'` is **never** returned; `'ok'` is not declared.
> An implementer who types that signature writes a function whose output makes `connection.js:27`'s `worst === 'ok'` **permanently false** — the tag then never reaches `live` at all.

That is the identical 「an implementer reading it verbatim re-introduces the defect」 shape BF-3 itself invokes, one line higher in the same row, and it is the one item I would ship even if this round were cut to a single edit.

Three more, in descending confidence, all design-lane:

- **The renderability decision is computed by `lib/`, discarded by `app.js`, and then re-derived by hand in three `ui/` files.** `getJSON` (`poll.js:51`) already runs `classifyResponse` and returns `{status, body}`; `app.js:375-376` keeps `results[url]` **and** `bodies[url]`, then hands the view **only `bodies`** (`:379`). So the BF-2 repair had to re-detect, in `home.js:231`, `run.js:475` and `workflow.js:350`, a fact the pure layer had already established and thrown away. DES-206's own boundary forbids this in as many words (`:6849`: 「it may **not decide anything a pure function could decide**」). The fix needs **zero new exports** — it is a seam change in `app.js`, and design's deliverable is one amendment plus **one** task row.
- **`nextConnection` is fail-OPEN on a tick that observed nothing.** Measured: `nextConnection({status:'offline',consecutiveFails:5,…}, {results:{}})` → **`{status:'live', consecutiveFails:0}`**. Zero routes answered, tag says 連線中. It is unreachable at HEAD — and only because of `app.js:382`'s `if (Object.keys(results).length > 0)`, a guard that appears in **no** design or architecture row (grepped both; 0 hits) and lives in the one layer that by DES-206's own `tests:` line has **no unit tier by construction**. DES-202's boundary explicitly reserves this seam for REQ-142 (「a reserved slot」) — i.e. the next planned change adds the input that reaches it.
- **Two LOW prose deviations** in the same neighbourhood (`classifyResponse`'s key-presence test vs the 「a `degraded` **string**」 prose; and no row saying which views bail vs which render the degraded component).

**The tie-break discipline, stated once.** Every fix below is the smallest edit that makes a false sentence true or moves an existing decision to where it already belongs. I refuse, explicitly, in §6: a new `lib/` predicate export, a fourth tag state, a JSDoc/`satisfies` type lock on the client, and any per-view task split.

---

## §2 Findings

| id | lens | sev | routing | one line |
|---|---|---|---|---|
| **AD-1** | interface-contract | **MID — blocking candidate** | **design** (this gate) | `04-design.md:6814` declares `worstOf → 'live'\|'degraded'\|'fail'`; it returns `'ok'\|'degraded'\|'fail'`, and the row's own `boundary:`/`tests:` lines and UT-244:78 all contradict the signature. |
| **AD-2** | boundary/error + testability | MID — non-blocking (latent) | **design** decl. + 1 impl line, **inside E6** | `nextConnection` returns `live` for `{results:{}}` from **any** prior state. Held back only by `app.js:382`, a guard in no design row, in a layer with no unit tier. |
| **AD-3** | boundary/error | LOW — rider on AD-2 | impl 1 token | An unrecognised status token is ranked as `ok`: `worstOf({a:'bogus'})` → `'ok'` → `live`. Unreachable at HEAD; fail-open direction. |
| **AD-4** | interface-contract + testability + simplicity | MID — non-blocking | **design** amendment + **one** TASK row | The classification `poll.js:51` computes is dropped at `app.js:379`, forcing three hand-rolled guards in `ui/` — against DES-206:6849's own invariant, and into the layer that has no unit tier. |
| **AD-5** | interface-contract | LOW | design prose | `classifyResponse` tests key **presence** (`'degraded' in body`); DES-202:6815 and ARCH-124's `api:` both say 「a 200 whose body carries a `degraded` **string**」. `{degraded:null}` → `'degraded'`. Fail-**closed**, so prose moves, not code. |
| **AD-6** | interface-contract (consumability) | LOW | design prose | ARCH-125's 「never rendered as data」 now has **two** sanctioned realizations — bail (`home`/`run`/`workflow`) and render-the-degraded-component (`issues.js:102-104`, DES-207:6857) — and no row says which view takes which, or why. |

**Not re-litigated here** (recorded LOW in `07-review.md:§9`, unchanged by anything I found): F-2 (`clampHue` mirror), F-3 (the closed-enumeration `api:` rows, incl. ARCH-124's 「Five files」 against **8** on disk), QD2-O2 (the ported tabs' double fetch), QD-R3 (the string table). I cite F-3 and QD2-O2 below only where they change the cost of another finding.

---

## §3 The findings, with what was measured

### AD-1 — DES-202's `signature:` line declares a function that does not exist, and could not work

**Claim in the ledger** (`04-design.md:6814`, verbatim):

> `worstOf(perRoute) → 'live'|'degraded'|'fail'` (the nav tag reads THIS)

**Tree at HEAD** (`src/dashboard/lib/connection.js:6-15`): `RANK = { ok: 0, degraded: 1, fail: 2 }`; `worstOf` initialises `let worst = 'ok'` and returns a `RANK` key. Measured:

```
worstOf({a:'ok',b:'degraded',c:'fail'}) → 'fail'
worstOf({a:'ok'})                       → 'ok'      ← not in the declared union
worstOf({})                             → 'ok'
'live' is never returned on any input.
```

**Three independent witnesses in the ledger already agree with the code and against the signature:**

1. the row's own `boundary:` (`:6815`) — 「`worst === 'ok'` → `live`」 — which only type-checks if `worstOf` returns `'ok'`;
2. the code's only caller, `connection.js:27` — `if (worst === 'ok')`;
3. **the unit test BF-3's own `tests:` line points at** — `tests/unit/dashboard-lib-connection.test.js:78`: `expect(worstOf({ a: 'ok' })).toBe('ok')`.

**Why this is the blocking-shaped one.** BF-3's stated standard is 「an implementer reading it verbatim re-introduces the defect」. Apply it literally here: an implementer who writes `worstOf` to the signature returns `'live'` for a healthy tick, `connection.js:27`'s `worst === 'ok'` is then **never** true, and the tag can never report `live` at all — a strictly worse failure than the one BF-1 repaired, produced by reading the row's **first** line instead of its third. The two lines the review named were repaired exactly as instructed; this is §10's own lesson (「the grep, not the line」) applied to the **row** rather than to the finding.

**The parenthetical is false too, and separately.** 「(the nav tag reads THIS)」 — the tag reads `connectionState.status` (`app.js:115-121`: `textContent = L(prefs.lang, connectionState.status)`), which is `nextConnection`'s output, not `worstOf`'s. For the all-fail arm the two now differ by construction (`worstOf` → `'fail'`, status → `'degraded'` or `'offline'`) — **that divergence is precisely what BF-1 installed**, so BF-1 made this parenthetical false at the same moment it made `:6815` false, and only one of the two was repaired.

**Proposed edit — `04-design.md:6814`, in-place, no new DES id** (the ledger's `amended (…)` house style; strike-through the old, state the new):

> `worstOf(perRoute) → 'ok'|'degraded'|'fail'` (the reducer's input, not the tag's value: `nextConnection` maps `'ok'` → `live` and, since BF-1, an all-`fail` tick → `degraded`/`offline` by streak — the tag reads `State.status`, `app.js:115`)

**Rider, ARCH's lane — note, do not fix here.** `02-architecture.md:3361`'s `api:` carries the looser form of both errors (`worstOf(perRoute) → status`, and 「The tag is **`worstOf(perRoute)`**」). `status` is vague rather than false, so it is not a contradiction; the 「tag is worstOf」 sentence has the same post-BF-1 divergence. A panel may not amend an ARCH row (`02-architecture.md:3365`'s own precedent), so this is recorded for the architect, at LOW, and design states the precise version in its own row without contradicting ARCH.

---

### AD-2 — a tick that observed nothing reports `live`, and the only thing stopping it is undocumented and untestable

**Measured** (`node --input-type=module`, HEAD, §9):

| input | output |
|---|---|
| `nextConnection({status:'live',consecutiveFails:0}, {results:{}})` | `{status:'live', consecutiveFails:0, perRoute:{}}` |
| `nextConnection({status:'offline',consecutiveFails:5}, {results:{}})` | **`{status:'live', consecutiveFails:0, perRoute:{}}`** |

An `offline` page with a five-tick failure streak is restored to 「連線中 / Live」 by a tick in which **zero routes were consulted**. The path is `worstOf({})` → `'ok'` (the seed value survives an empty loop) → `connection.js:27`'s early return. Note the author *did* think about emptiness one branch later — `:31`'s `values.length > 0 && values.every(...)` — so the all-fail arm is guarded and the healthy arm is not.

**Reachability, stated honestly.** Not reachable at HEAD. `app.js:382` wraps the reducer call in `if (Object.keys(results).length > 0)`. I checked the two ways `results` could be empty: `endpointsFor` returns `[]` only for a view name absent from `ROUTES` (`poll.js:35-38`), and all six names `app.js` mounts (`:177`, `:185`, `:408`, `:416`) are present. So AD-2 is **latent**, in the F-2 sense.

**Why it still outranks F-2 — the distinguishing factor, offered before the other panel asks for it.** F-2 is two copies of a formula that agree today. AD-2 is a **fail-open default in the one function whose entire job is not to overstate health**, and three things make its latency thin:

1. **The guard is in the wrong layer and is written down nowhere.** `grep` for `Object.keys(results)` / `results).length` over `04-design.md` and `02-architecture.md` → **0 hits, both files**. DES-206's boundary enumerates 「five invariants it may not lose」 (`:6849`) and this is not among them. An invariant that is neither stated nor tested is not an invariant; it is a line someone can delete during a refactor with a green suite.
2. **It cannot be tested where it lives.** DES-206's `tests:` line (`:6850`) says the `ui/` layer 「has NO unit tier by construction (ADR-049 refuses jsdom)」. So the property 「an empty tick never paints Live」 has coverage at **zero** tiers today, while the reducer 12 lines away has a full literal-fixture transition table.
3. **The next planned change adds the input that reaches it.** DES-202's own boundary (`:6815`) reserves this exact seam: 「REQ-142's visibility gate and REQ-143's demo flag attach later as one more input」. A visibility gate is, by definition, a mechanism for producing ticks that observed nothing.

**Proposed shape — relocation, not behaviour change.** Identity-on-empty in the reducer produces *exactly* what `app.js:382` produces today (no state change, no repaint), so there is **no compatibility cost and no new state**:

```js
// connection.js, before the worstOf line
if (values.length === 0) return { ...prev, perRoute: tick.results };  // no observation → no claim
```

`app.js:382`'s guard then becomes redundant rather than load-bearing, and two cases join the UT that already imports the module.

**Two things I must not let this claim overreach.**
- **It does not fix the freeze.** With either the guard or the identity return, a view that polls nothing leaves the tag frozen at its last value — 「連線中」 forever, which is the BF-1 lie in slow motion. I am not proposing the reducer invent a status to cover that: a view with zero endpoints is a **routing** bug, caught by `endpointsFor`'s own per-view UT (DES-206:6850), not by the state machine. Saying otherwise would be scope creep dressed as safety.
- **It makes one freshly-written BF-3 sentence false, and I name the re-wording rather than let the synthesizer discover it.** `:6815` now says 「`status` is never carried forward from `prev`」. Identity-on-empty *is* carrying it forward. The clause must read 「**on a tick that observed at least one route**, `status` is never carried forward from `prev`」 — the same edit, in the same sentence, or this proposal re-opens BF-3 by accident.

---

### AD-3 — unrecognised status token ranks as `ok` (rider on AD-2, one token)

Measured: `worstOf({a:'bogus'})` → `'ok'`; `nextConnection(live, {results:{a:undefined}})` → `{status:'live'}`. Cause: `RANK[status]` is `undefined`, and `undefined > 0` is `false`, so the seed `'ok'` survives.

Unreachable at HEAD — every value entering `results` comes from `classifyResponse` (`poll.js:51`) or from an `onTick`'s `extra`, which is itself a `getJSON` status (`run.js:487`, `issues.js:109`). ARCH-124's `api:` nonetheless states these exports are 「pure and **total**」, and total-in-the-fail-open-direction is the one reading a health widget must not take.

One token, fail-closed: `const r = RANK[status] ?? RANK.fail;`. **This one IS a behaviour change** (open → closed) on an unreachable input, unlike AD-2's relocation. I offer it as a rider and do not fight for it: if the synthesizer wants a zero-behaviour-change round, drop AD-3 and keep AD-2.

---

### AD-4 — the pure layer decides renderability, `app.js` throws the answer away, and three `ui/` files re-derive it by hand

**The seam, measured at file:line.**

| where | what happens |
|---|---|
| `poll.js:51` | `return { status: classifyResponse(res.status, body), body }` — the decision is **already made**, by the pure module DES-202 owns. |
| `app.js:375-376` | `results[url] = res.status; bodies[url] = res.body;` — both kept. |
| `app.js:379` | `await view.onTick(view.container, bodies, view.ctx)` — **only `bodies` crosses the seam.** The status is retained solely to feed `nextConnection` at `:383`. |
| `home.js:231` | `if (!body \|\| body.degraded \|\| !Array.isArray(body.running)) return;` |
| `run.js:475` | `if (!dagBody \|\| dagBody.degraded \|\| !Array.isArray(dagBody.cells)) return {};` |
| `workflow.js:350` | `if (!describe \|\| describe.degraded \|\| !Array.isArray(bodies[runsUrl])) return {};` |

**This is not a new decision that needs a new home — it is an existing decision discarded one line before it is needed.** That reframing matters, because it kills the tempting answer (「add an `isRenderable()` export to `lib/connection.js`」): a new pure export would be a **second** implementation of what `classifyResponse` already computes, i.e. the mirror-pair class ARCH-124's note exists to shrink. Zero new exports is on the table; a new predicate is not the Karpathy answer here.

**The invariant it contradicts is DES-206's own** (`:6849`, verbatim): 「This layer may read the DOM and call `fetch`; it may **not decide anything a pure function could decide** — that is what keeps the mirror-pair class from growing.」 Three shipped call sites now take exactly such a decision.

**What it cost, in the tier it pushed the property into.** Because the decision sits in `ui/`, which has no unit tier (DES-206:6850), the falsifying evidence had to be written at the real-Chromium tier: `val-198-shell-and-home.test.ts:262` and `val-200-swimlane.test.ts:215`, both `itReal`, which **skips silently without Chromium**. (The v27k implementer did run them and recorded the runs in `57ad237` — this is a statement about *tier*, not about diligence.) The same property expressed at the seam is one `.js` UT.

**Two candidate shapes. I argue (a), and price (b) honestly.**

- **(a) `app.js` passes the statuses alongside the bodies** — `onTick(container, bodies, ctx, statuses)`, or the one-argument form `onTick(container, { bodies, statuses }, ctx)`. Each guard collapses to `if (statuses[url] !== 'ok') return;` plus its **own** shape check. Nothing is deleted; the answer that already exists simply crosses the seam. Cost: DES-206's `signature:` line changes (it specifies `onTick`), and six `onTick` implementations must accept the argument — three of which (`models`/`system`/`issues`) ignore `bodies` today anyway (QD2-O2).
- **(b) `app.js` omits non-`ok` bodies from `bodies`** — each guard collapses to `if (!body) return;` with no signature change at all. Cheaper, and tempting. **But it breaks DES-207 in principle**: `issues.js:102-104` renders the degraded **string** to the operator (`replaceChildren(el('div','degraded', data.degraded))`) — it *needs* the degraded body. It survives (b) today only because it re-fetches its own route (QD2-O2) instead of reading `bodies`; i.e. it is protected by a defect the same review recorded as debt. Building on that is exactly the 「protected by accident」 pattern this ledger keeps paying for.

**So: (a).** It is larger by one parameter and smaller by one hidden coupling.

**Be precise about what 「3 → 1」 means.** The **shared** part of the three guards is `!body || body.degraded` — that moves. The `Array.isArray(body.running)` / `.cells` / `bodies[runsUrl]` halves are genuine **per-view preconditions** and stay in their views. Three copies of a decision become one; three shape checks remain three. Claiming otherwise would overstate the win.

**Design's deliverable this round is not the code.** It is (i) DES-206's `signature:`/`boundary:` amendment naming the seam and re-stating the invariant it lost, (ii) DES-202's `signature:` noting that `classifyResponse`'s answer is the renderability answer and is not to be re-derived, and (iii) **one** task row. §5.

---

### AD-5 — `classifyResponse` tests key presence; both documents say 「a `degraded` **string**」 (LOW)

`connection.js:48`: `if (typeof body === 'object' && 'degraded' in body) return 'degraded';`. Measured: `classifyResponse(200, {degraded:null})` → `'degraded'`; `classifyResponse(200, 'oops')` → `'ok'` (a string body is not `typeof 'object'`).

`04-design.md:6815` and `02-architecture.md:3361` both say 「a 200 whose body **carries a `degraded` string**」. The deviation is **fail-closed** (a malformed degrade is still treated as degraded), and `server.ts:616`'s catch-all always writes a string, so the divergence is unreachable and harmless in the safe direction. **Move the prose, not the code** — 「a 200 whose body carries a `degraded` **key**」 — and say why in one clause: presence, not type, so a malformed degrade cannot be rendered as data. Tightening the code to `typeof … === 'string'` would convert a fail-closed deviation into a fail-open one, which is the wrong trade in this row of all rows.

---

### AD-6 — 「never rendered as data」 has two sanctioned realizations and no row says which view gets which (LOW)

- **Bail, keep last-known render:** `home.js:231`, `run.js:475`, `workflow.js:350` — the shape BF-2's required text specified.
- **Render a degraded component:** `issues.js:102-104` (the string, in a `.degraded` div) and `system.js:27-29` (「DES-207's ONE degraded-section component — every field this tab cannot sample renders THIS」).

Both satisfy ARCH-125's 「never rendered as data」; they are opposite answers to 「what does the operator see」. DES-207's `boundary:` (`:6857`) states the component rule for the three ported tabs; nothing states the bail rule as the *other* branch, or the reason (a ported tab has no prior render to keep; a polled view does). One sentence in DES-206's boundary, beside the five invariants, closes it. LOW because no shipped behaviour is wrong — only the next implementer's coin-flip is.

---

## §4 The design-lane edits, in full, as I would land them

Round 2 may trim; nothing below invents an id, moves a trace link, or edits `src/`.

| # | file:line | edit | id cost |
|---|---|---|---|
| **E1** | `04-design.md:6814` | `worstOf` return union `'live'…` → `'ok'|'degraded'|'fail'`; parenthetical re-stated (the tag reads `State.status`, `app.js:115`). | 0 new DES |
| **E2** | `04-design.md:6815` | 「`status` is never carried forward from `prev`」 → 「**on a tick that observed ≥ 1 route**, `status` is never carried forward from `prev`」; add the empty-tick clause (identity: no observation → no claim) and, if AD-3 is taken, the unrecognised-token clause (ranked as `fail`). **These two clauses describe the TARGET reducer, not HEAD** — they go false unless E6's one-line change lands with them, which is why both ride the same row (§5). | 0 new DES |
| **E3** | `04-design.md:6816` | `tests:` gains two cases: an empty `results` from `offline` stays `offline`; (AD-3) an unrecognised token ranks `fail`. Same literal-fixture oracle rule the line already states. **Both are RED at HEAD** — §9 measures the first one returning `live` today — i.e. these are the test-first cases E6's impl turns green, not a description of the current tree. | 0 new DES |
| **E4** | `04-design.md:6815` | AD-5: 「a `degraded` **string**」 → 「a `degraded` **key** (presence, not type — a malformed degrade must not become data)」. | 0 new DES |
| **E5** | `04-design.md:6848-6849` (DES-206) | AD-4: `onTick`'s signature gains the per-url statuses; the boundary re-states the lost invariant with the seam named — 「the renderability decision is `classifyResponse`'s, made once in `poll.js`; a view may check its own **shape** precondition and nothing else」. AD-6's one sentence lands here too. | 0 new DES |
| **E6** | `03-tasks.md` (after `:1846`) | **One** task row carrying **all** the impl this round declares: AD-4's `app.js` seam + the three call-site collapses + one `.js` UT, **and** AD-2's one-line identity return in `connection.js` with E3's two RED cases (**and** AD-3's `?? RANK.fail` token if the synthesizer takes the rider). `status: draft`, traces `DES-206, DES-202, ARCH-125, REQ-131`. One row, not two: the reducer line and the seam are both consequences of the same 「the pure layer decides, the DOM layer obeys」 contract, and §5's argument against splitting adjacent edits applies to them as much as to the prose. | 1 new TASK |
| **E7** | `04-design.md:6818` | One `amended (…)` line recording E1–E5 with the measured evidence, per house style. | 0 new DES |

**Trace impact, predicted and falsifiable:** E6 adds exactly **one** `TASK 未實作` LOW row (the TASK-215/216 precedent, `07-review.md:§3`), taking the gap count 35 → 36 with **zero** new 漂移 rows, because every amended row's `iter:` advances in the same commit as its text. If a re-run shows anything else, this prediction is wrong and the round should say so rather than re-baseline.

---

## §5 Where task-splitting touches my lens — say it now, because the split is the defect

The brief asks me to flag this, and here it is load-bearing rather than procedural.

**AD-4's impl is ONE row, not three.** The review's own §10 retro says the lesson of QD2-O1 is that 「IMPL-271 fixed the view the finding named and left the two sibling call sites of the identical pattern untouched」. A per-view split (`home`, `run`, `workflow`) reproduces that exact failure mode **by construction**: three rows, three dispatches, three chances for two to land and one to rot — on a guard whose whole point is that all copies agree. The seam change in `app.js` is also indivisible: it cannot half-land.

**Corollary for the synthesizer:** if capacity forces exactly one row to be deferred this round, defer **E6 entirely** (the code stays as it is, correct-but-triplicated, with the design row naming the debt) rather than landing part of it. A half-collapsed guard set is strictly worse than three consistent copies.

**And if E6 is deferred, E2/E3 must be deferred with it — or written as declared-and-owed, never as fact.** E2's empty-tick clause and E3's two cases describe the reducer E6 builds, not the reducer at HEAD (§9 measures the difference). Landing them as plain statements while the code stays put manufactures a fresh 「the row describes a function that does not exist」 defect — this round's own AD-1, by this round's own hand. The ledger already has the correct form for this: `ARCH-122`/`ADR-049`'s 「the property is UNGUARDED until TASK-B lands」, with `TASK-215`/`TASK-216` carrying the owed work and surfacing mechanically as LOW 未實作 rows. Use that phrasing verbatim, naming E6's row id. **E1, E4, E5 and E7 are unconditional** — they are true of HEAD today and land either way.

**AD-1's edit must not be split from AD-2's.** They are three adjacent lines of one row; splitting them means a second `amended (…)` entry on `:6818` within the same day, which is how the four-way amendment pile-up on DES-200 happened.

---

## §6 Where my own three lenses disagree — and the Karpathy tie-break

The brief demands these be explicit, not smoothed over. There are four, and one of them changed my recommendation.

**(1) Interface-contract wants types; simplicity refuses them.** The full interface-contract answer to AD-1 is 「stop writing unions in prose — put `@typedef`/JSDoc on the client and let `checkJs` verify」. ARCH-124's note already anticipates this and answers it: types are **relocated** to `tests/fixtures/dashboard-wire.ts`'s `satisfies` lock, deliberately, because a `.ts` client needs a build step and a build step reintroduces the 「did you rebuild?」 drift class (ADR-049). **Tie-break: simplicity wins, decisively.** The minimum edit that makes AD-1 true is four characters of prose. Proposing a type layer to catch a typo is the needless-flexibility move.

**(2) Boundary/error wanted a new state; interface-contract and the owner both forbid it.** My first instinct on AD-2 was a `'unknown'` status — honest, and it makes the empty tick unrepresentable-as-live. It is **wrong here for a reason already adjudicated**: ARCH-124's `owner_decision` (`:3365`) records that a three-state option was 「offered to the owner and **declined**」 because the vendored handoff defines exactly three source tags and 「a fourth would step outside the fidelity oracle DES-209 established」. A `'unknown'` state is that fourth tag with a different name. **Tie-break: the settled decision wins**, and identity-on-empty gets the same safety with zero new states.

**(3) Testability and boundary/error agree, which is itself the argument.** Normally testability pushes toward moving code and simplicity pushes back. Here they point the same way twice: AD-2's invariant is untestable *because* it sits in the layer ADR-049 left without a unit tier, and AD-4's guard needed `itReal` Chromium tests *for the same reason*. Both fixes move a property **into** the tier that already has a test file, deleting duplication on the way. **Tie-break: unnecessary — when both lenses and the line count agree, take it.** I record the dissent I would have made if AD-4 had been **one** call site rather than three: I would have left it alone, because moving code to make a single call site testable is the tail wagging the dog.

**(4) Boundary/error vs. the ledger's own freshly-written words.** AD-2's clause makes BF-3's brand-new 「never carried forward from `prev`」 sentence false (§3). A weaker version of me would drop AD-2 to avoid touching a sentence the review just blessed. **Tie-break: the sentence is a means, the property is the end.** BF-1's property is 「a tick with evidence of failure may not report `live`」; an empty tick has no evidence at all, and the absolutist phrasing over-reaches. State it precisely in the same edit, and say so out loud to the synthesizer — which §3 does.

---

## §7 Risks

| # | risk | likelihood | what it costs | pre-emption |
|---|---|---|---|---|
| **R1** | **AD-2's edit is read as re-opening BF-3.** A reviewer sees 「`status` is never carried forward」 modified one round after BF-3 installed it and reads it as a regression. | med | a spurious re-review round | §3 and §6(4) name the re-wording explicitly and give the property-vs-phrasing reason. The `amended (…)` line (E7) must repeat it in the ledger, not just here. |
| **R2** | **AD-4 grows.** 「While we are in `app.js`, let us also fix QD2-O2 / add a status-aware render component / unify the degraded UI.」 | **high** — it sits one line from both | the send-back loop gains a round | E6 is one row with a stated boundary: the seam, three call-site collapses, one UT. QD2-O2 and AD-6 are named as **out**. |
| **R3** | **E6 lands as design-only and the code stays triplicated**, joining TASK-215/216 as a third unlanded follow-up. | med | +1 LOW 未實作 row; the `ui/` invariant stays contradicted; **and, if E2/E3 land unconditionally beside it, a brand-new false design clause** | Priced, not hidden: §5 says defer-whole-or-land-whole, requires E2/E3 to take the declared-and-owed phrasing whenever E6 slips, and the row is honest debt either way. If exactly one of the three open follow-ups is dispatched, I rank **E6 above TASK-216 and below TASK-215**. |
| **R4** | **AD-1 is judged cosmetic** (「nobody re-implements a shipped function from a design row」). | med | a false contract survives in a row two send-backs have already touched | The consequence is measured, not asserted: reading it verbatim makes `worst === 'ok'` permanently false. That is BF-3's own standard, applied one line up. |
| **R5** | **My empty-tick claim is dismissed as unreachable**, per the F-2 precedent. | med-high | AD-2 drops to LOW debt | I concede reachability up front and argue the three distinguishers (undocumented cross-layer guard · zero test tiers · REQ-142 plans the input that reaches it). If the synthesizer still rules LOW, the **E2/E3 prose** should land anyway — it is free and it is true. |
| **R6** | **Two rounds of amendments pile on DES-202** (`:6817`, `:6818`, plus mine) until the row is unreadable. | med | consumability of the row itself | E7 is **one** consolidated `amended (…)` line for all of E1–E5. If round 2 wants a rewrite of `:6814-6816` with the amendment history compacted, I support it — but that is a separate decision, not a side effect. |
| **R7** | **I am wrong about the `issues.js` coupling in AD-4(b)** — if the synthesizer prefers (b) and re-points `issues.js` at `bodies`, the degraded string disappears from that tab. | low | a silent DES-207 regression | Stated in §3 with the file:line. Whoever takes (b) owes `issues.js` an explicit path for the degraded body. |

---

## §8 Expected disagreements with the quality-dimensions lens

I have not read `quality-dimensions.r1.md` this round. Predicted, from that lens's standing positions in `07-review.md:§9` and from the last two rounds' scoreboards:

1. **QD will nominate QD-R3 (the string table: five keys plus 17 `lang === 'zh'` copy sites) as this gate's headline** — the review itself calls it 「the strongest candidate for the next closure's first task」. **I disagree on routing, not on merit.** It is *closure* work, not *induced-drift* work: nothing in this send-back made it false. Opening 17 call sites inside a Gate 8 send-back loop is how a re-review becomes a re-implementation. Take it first in the next closure; not here. If QD produces a measurement showing it is smaller than I think, I concede — it is a count, and counts settle arguments.
2. **QD will likely want a new DES id for AD-4's seam** (its usual replaceability reading: a named contract is easier to swap). **I want zero new DES ids.** DES-206 already *is* the `ui/` layer contract and already states the invariant AD-4 restores; a new id splits one contract across two rows and adds trace links to re-verify. House style is amendment-in-place, and v27j/v27k both used it.
3. **QD may propose a fourth tag or an explicit `unknown`/`stale` state** for AD-2, on observability grounds — it is the more *informative* answer. **I pre-empt:** the owner declined a fourth source tag on the record (`02-architecture.md:3365`), and DES-209's fidelity oracle bounds it. Identity-on-empty buys the safety with zero new states. If QD wants the operator to *see* 「no data this tick」, that is REQ-142/143 content, not this round's.
4. **QD will probably rank AD-5/AD-6 above AD-1** (prose completeness and consumability are its native metrics; a wrong type union in a document reads as a typo). **I disagree on severity ordering:** AD-1 is the only one of the three where reading the line verbatim produces broken code, and this ledger has twice ruled that shape blocking (v27j on DES-202's `tests:` line; BF-3 on its `boundary:`). AD-5/AD-6 are true LOWs and I rank them there myself.
5. **QD may ask for AD-4's guard to be verified at the real tier as well as the unit tier** (「it is a rendering property」). **I half-agree:** `val-198:262` and `val-200:215` already exist and should be **kept, not replaced** — the UT proves the decision, the acceptance test proves the paint. What I refuse is a *third* `itReal` case for `workflow.js` to make the set symmetric; symmetry is not evidence, and `itReal` skips silently without Chromium.
6. **Where I expect to concede in advance:** if QD's sweep finds design rows outside DES-202/206/207 that BF-1/BF-2 made false — I bounded my grep to the reducer, the poll seam and the three views — its breadth beats my depth, exactly as it did on D-5 in the last round's scoreboard. I will take its row set and re-verify each at file:line rather than re-argue.

---

## §9 What was actually run (reproducible, HEAD `57ad237`)

```
git log -1 --oneline -- .../.panel/design/adversarial.r1.md      → 8d3584b  (supersedes sha, no later touch)
git show --stat b124430                                          → the v27k BF-1/BF-2/BF-3 commit, 3 test files touched

node --input-type=module -e "import {nextConnection,worstOf,classifyResponse} from './src/dashboard/lib/connection.js'; …"
  empty tick from live       → {"status":"live","consecutiveFails":0,"perRoute":{}}
  empty tick from offline(5) → {"status":"live","consecutiveFails":0,"perRoute":{}}
  worstOf({})                → ok
  worstOf({a:'bogus'})       → ok        nextConnection(live,{results:{a:'bogus'}})  → status live
  nextConnection(live,{results:{a:undefined}})                                       → status live
  classifyResponse(200,'oops')      → ok
  classifyResponse(200,['degraded'])→ ok
  classifyResponse(200,{degraded:null}) → degraded        (AD-5, fail-closed)

grep -rn "worstOf" src/ tests/        → 4 hits in src/ (all connection.js), 4 in the UT; no other consumer
grep -n  "mountLazy(\|TAB_MODULES" src/dashboard/ui/app.js
                                      → :151 {models,system,issues} · :440 'workflow' · :445 'run' · :177 'home'
                                        = the six view names mounted, ALL present in poll.js's ROUTES → `results`
                                        cannot be empty at HEAD (the reachability claim R5 hinges on)
grep -n  "results).length\|Object.keys(results)" 04-design.md 02-architecture.md   → 0 hits, both files  (AD-2)
grep -n  "degraded" src/dashboard/ui/{models,system,issues}.js                      → issues.js:102-104 renders the string (AD-6)
ls src/dashboard/lib/                 → 8 files (ARCH-124's api: says "Five files" — F-3, already recorded LOW)
sed -n on: connection.js:1-49 · poll.js:1-56 · app.js:364-385,113-121,160-200,396-420 ·
           home.js:215-235 · run.js:463-510 · workflow.js:340-365 · issues.js:75-110 ·
           04-design.md:6811-6819,6845-6859 · 02-architecture.md:3356-3365 · 01-requirements.md:1716-1745 ·
           07-review.md:7-305 · tests/unit/dashboard-lib-connection.test.js:1-90
```

**What I did not do:** run the full suite (no `src/`/`tests/` edit is proposed by this round), regenerate the dashboard, or read `quality-dimensions.r1.md`. The trace prediction in §4 is stated so that the synthesizer's own re-run can falsify it.
