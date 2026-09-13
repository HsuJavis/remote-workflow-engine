---
stage: review (Gate 8) — input to RE-REVIEW #4
lens: adversarial group — (a) security, (b) scalability/performance, (c) testability;
      Karpathy simplicity-first as the tie-breaker
iteration: v27 (closure REQ-131..136, REQ-140, REQ-141), after the v27k/v27l + BF-4/BF-5/BF-6 repairs
subject: 02-architecture.md §v27 (ARCH-122..131, ADR-049..056, INV-V27-1..9) as amended at v27b/v27h
         vs. the code named on the `files:` lines of 06-impl-log.md IMPL-221..281
measured at: HEAD `18b9c03` — every file:line below is a HEAD line number, NOT the architecture
             document's own (those are pinned at older shas and are stale by design)
verdict: NOT CONSISTENT — 4 deviations (0 HIGH, 2 MEDIUM, 2 LOW)
scope note: this is a DELTA pass. `git diff --stat ced73ff..HEAD -- src/ tests/` is 10 files
            (5 client `.js`, 5 test files, 256 insertions). IMPL-221..276 were re-verified at
            RE-REVIEW #2/#3 and are not re-derived here; what is re-derived is the defect CLASS
            those five rounds chased, because this pass finds it still open in two places.
---

# Adversarial review #4 — v27 architecture vs. implementation, after the BF-4/5/6 round

**Bottom line.** All five of the send-back repairs this round was convened to verify are genuinely
closed on disk, and I re-opened every one of them at HEAD rather than inheriting the IMPL rows:
`BF-1` (`lib/connection.js:39` is `consecutiveFails >= 2 ? 'offline' : 'degraded'`; `prev.status`
survives only inside the comment at `:36`), `BF-2` (`ui/home.js:231`, `ui/run.js:475`), `BF-4`
(`ui/system.js:78`), `BF-5` (`ui/run.js:512`), `BF-6` (`ui/workflow.js:326`/`:329`). `npx tsc
--noEmit` → exit 0. `tests/unit/dashboard-lib-connection.test.js` + `dashboard-lib-theme.test.js` →
17/17. The five real-Chromium acceptance files (`val-198`..`val-202`, `RWE_REQUIRE_BROWSER=1`,
cached Chrome 152) → **37 passed / 0 failed**, matching IMPL-281's own figure.

**What this pass finds is that the class is not closed.** IMPL-281 states 「the sweep is clean now,
all 16 sites are guarded」 and recommends a helper for the future. I re-ran the sweep against the
architecture clause rather than against the crash, and the two are not the same test. ARCH-125's
`api:` says a degraded response is 「**never rendered as data**」 — not 「never throws」 and not 「never
prints the word undefined」. Under that clause the sweep is **not** clean:

1. `ui/workflow.js`'s `paintSelected` answers a non-`ok` `/api/runs/:id/dag` by rendering a
   **fabricated empty payload**: the swimlane is erased and the run-summary line affirmatively
   states 「**0 個節點**」 for a run that has one. **Measured in a real browser at HEAD, with the run
   view as a control under the identical fault** (`A4-1`, MEDIUM). This is the same clause `BF-2`
   was raised under, in a view `BF-2`'s required shape did not name — the sixth repetition of
   「the repair scope should be the grep, not the line」.
2. The dashboard's shared degrade path serves the **raw exception message** as the wire's `degraded`
   value on every `/api/*` route, unauthenticated — `{"runs":[],"degraded":"URI malformed"}`,
   measured against a booted server — where ARCH-130's own amendment puts free text under the log
   line's separate `detail` key and the sibling catch-all 480 lines away already ships the fixed
   literal (`A4-2`, MEDIUM).
3. `ui/agent-panel.js` ignores its own `res.status` and paints `in 0 · out 0 · cache read 0 · cache
   write 0` for a fetch that returned nothing — a silent zero of the class ADR-046 / INV-V26-6
   forbids, beside a `Cost: —` that correctly says 「unknown」 (`A4-3`, LOW). It is the 17th site;
   IMPL-281's table rates it 「safe」.
4. No architecture or design row says what a view must **do** after a non-`ok` result. ARCH-125
   states only the negative, so six repairs produced **four** different visible behaviours for one
   fault (`A4-4`, LOW). This is the root cause of the loop, and it is the architect's lane, not
   impl's.

**Recorded residuals are not re-reported and do not count.** F-4, F-5, F-6, F-7 ≡ QD-S2, QD-O4,
QD-O5, QD-R2, QD-R3, QD-R4, QD-C2, QD-C3, the previous pass's F-2 (the unpinned `clampHue` mirror —
re-checked: `ui/theme-init.js:24` still carries the second copy, `tests/unit/dashboard-lib-theme.test.js:18-23`
still pins only `lib/theme.js`'s) and F-3 (ARCH-123/ARCH-125's closed file enumerations — ARCH-125's
`api:` still omits `system.js`, `issues.js`, `models.js`, `dom.js`, `clock.js`), QD2-O2, DEBT-A,
DEBT-B, TOOL-FORK, DOC-H, DOC-UT245 and D3-1..D3-6 all still hold at HEAD. **D3-3** (a view that
throws inside `onTick` freezes the tag, `app.js:379-384`) and **D3-5** (the classifier's verdict is
dropped at `app.js:379` and three views re-derive it by hand) are the two I checked hardest, because
`A4-1` and `A4-4` sit next to them; both remain correctly filed where they are, and §1 says exactly
where my findings differ from them so the synthesis does not merge them by accident.

**Declared-and-owed is still not violation.** `tsconfig.server.json` does not exist, `package.json`'s
`typecheck`/`build` are still a bare `tsc --noEmit`, and the pre-v27 fossil body still stands at
`src/dashboard-page.ts:92-152`. Both ARCH rows say so in their own text and both have a TASK row
(`03-tasks.md:1837` TASK-215, `:1846` TASK-216). **Re-verified this pass, because an owed item
marked done WOULD count:** both are still `status: draft`.

---

## 1. Findings

### A4-1 (MEDIUM, security/observability × testability) — ARCH-125 `api:` 「never rendered as data」, ARCH-124's `classifyResponse` clause, REQ-134: on a non-`ok` `/api/runs/:id/dag`, `ui/workflow.js` wipes the swimlane and states 「0 個節點」 for a run that has one

**The clause.** ARCH-125 `api:` (`02-architecture.md:3368`) defines `getJSON` as the classifier that
marks 「a 200 body carrying a `degraded` string」 as `degraded`, 「never an exception **and never
rendered as data**」. ARCH-124 `api:` (`:3361`) carries the same words for `classifyResponse`, and
`src/dashboard/lib/connection.js:42-43` restates them in the code's own comment: 「never rendered as
data (the bug this guards: a degraded shape reaching a render function)」. RE-REVIEW #2 applied that
clause as a **blocking** MID (`BF-2`) to precisely this failure mode in the sibling views, and the
repair's own comment at `src/dashboard/ui/run.js:471-474` names the forbidden outcome in words:
「last-known render stays … **never an empty swimlane drawn over a live one**」.

**What HEAD does.** `src/dashboard/ui/workflow.js:326`:

```js
const payload = dagRes.status === 'ok' ? dagRes.body : { cells: [], edges: [], warnings: [], lanes: [], current: null };
```

and then, unconditionally, `:328` `paintSwimlane(shell.svgEl, payload, …)` and `:329`
`renderLegend(shell.legend, payload, viewRes.status === 'ok' ? viewRes.body : null, lang)`.
`paintSwimlane` is not a no-op on an empty payload — it erases first and asks questions later:
`src/dashboard/ui/run.js:219` `svgEl.replaceChildren();` and `:222` `layer.replaceChildren();` run
before anything is appended, and with `cells`/`lanes`/`edges` all `[]` (`:202-204`) nothing is
appended. `renderLegend` then derives `nodeCount` from that same fabricated payload
(`run.js:361`) while `view` comes from the **healthy** `/api/runs/:id`, so the summary line is
assembled from one real route and one invented one (`:367`).

**Measured, at HEAD `18b9c03`, real Chromium 152, one real run of a one-agent workflow.** Two views,
the identical injected fault on `/api/runs/:id/dag`, everything else untouched:

| view | before | after a degraded `/dag` (HTTP 200 `{runs:[],degraded:'…'}`) | after a DROPPED `/dag` request |
|---|---|---|---|
| `/dashboard/workflow/<name>` (`ui/workflow.js`) | svg children **2**, cells **3**, summary 「completed · **1 個節點** · 14 tok · ≥ $0.00 · 1 未定價」 | svg children **0**, cells **0**, summary 「completed · **0 個節點** · 14 tok · ≥ $0.00 · 1 未定價」, tag 「部分異常」, **0 page errors** | identical: **0 / 0 / 「0 個節點」** |
| `/dashboard/<runId>` (`ui/run.js`, the `BF-2` repair) | svg children 2, cells 3, summary 「1 個節點」 | **unchanged** — 2 / 3 / 「1 個節點」 | **unchanged** — 2 / 3 / 「1 個節點」 |

**Why this is a violation and not a taste argument.** 「0 個節點」 is not a blank and not a
placeholder; it is a **number the page computed from a payload the server never sent**, printed in
the same sentence and the same styling as `14 tok` and `≥ $0.00`, which ARE real. An operator
reading it learns something false about the run — the exact failure ARCH-122's own boot-failure note
calls 「the most dangerous false statement an operator console can make」, here reached without the
page failing to boot at all. The connection tag is honest (部分異常), which makes it *worse*, not
better: the tag says 「partial fault」 while the panel beside it states a specific wrong quantity, so
the honest signal is contradicted by the confident one.

**Reachability is one lost request, not an engine fault.** The second column above is a whole-route
degrade; the third is a plain `abort()` — a dropped request, no server involvement at all. The
deployment is 「a tunnel to one team」 (ARCH-123 `note:`), and `/api/runs/:id/dag` is by far the
heaviest dashboard read (catalog resolve → `parseWorkflowSkeleton` → `deriveExpectedGraph` →
`layoutGraph`, `server.ts:505-575`), so it is also the route most likely to fault **alone** while
`/api/runs/:id` beside it stays healthy. That asymmetric case is the one that produces the false
number, and it is the one no test at any tier exercises.

**Why five sweeps missed it, stated plainly.** `BF-6`'s own falsifying test degrades **both** routes
together (`tests/acceptance/val-199-workflow-detail.test.ts:283-290`), so `view` is `null`, the
summary element is dropped entirely, and `expect(after).toBeNull()` passes — in a world where the
graph is blanked. The test file says so itself at `:268-271`: 「`paintSwimlane`'s own internal
`Array.isArray` guards already **neutralize** `:319`'s malformed `payload` for the swimlane itself
(**an empty repaint either way**)」. The word 「neutralize」 is where the two readings diverge: the
malformed payload is neutralized as a *crash*, and preserved as a *statement*. Every repair in this
loop has been falsified against the crash.

**Evidence:** `src/dashboard/ui/workflow.js:326`, `:328`, `:329`; `src/dashboard/ui/run.js:219`,
`:222`, `:202-204`, `:361`, `:367`; the forbidding comment at `src/dashboard/ui/run.js:471-474`;
the conceding comment at `tests/acceptance/val-199-workflow-detail.test.ts:268-271`;
`02-architecture.md:3368` (ARCH-125 `api:`), `:3361` (ARCH-124 `api:`).
**Severity: MEDIUM** — the same clause, the same class and the same user-visible consequence that
RE-REVIEW #2 rated blocking MID as `BF-2`, now with a fabricated *number* rather than an empty grid.
**Contradicts on the ledger:** IMPL-281's 「the sweep is clean now, all 16 sites are guarded, 2 by
this row」 and its table row `workflow.js:326 … THIS row's fix`.

**Repair shape, stated as a grep and not as a line** (this is the lesson the round already paid for
five times): *no view may pass a payload it constructed itself to a render function that erases
before it paints.* Concretely — `paintSelected` bails like its sibling does
(`if (dagRes.status !== 'ok') return { [dagUrl]: dagRes.status, [viewUrl]: viewRes.status };`,
placed before `:328`), which leaves the last-known graph and summary on screen — the same shape
`run.js:475` already ships. **One clause that shape needs and `run.js`'s does not, flagged so the
prescription does not ship a second honesty defect:** `run.js` renders ONE run for the life of the
page, while `workflow.js` has a *selection*. A bail on a POLL tick correctly keeps the last-known
graph; a bail on a tick that FOLLOWED a run-switch would leave the previous run's graph sitting
under the newly selected chip, which is a worse lie than a blank. So the bail must distinguish the
two — clear-and-show-unavailable when `state.selectedRunId` changed since the last successful paint,
keep-last-known otherwise. That is a DES-206/DES-209 decision, not an implementer's judgement call,
and it is the same decision `A4-4` says nothing currently owns. The falsifying test must degrade
**`/dag` alone** and assert the graph SURVIVES and the node count is unchanged — asserting
`.run-summary` is absent cannot catch this, because on the asymmetric tick it is present and wrong.

---

### A4-2 (MEDIUM, security) — ARCH-130 `api:` (4) as amended v27b Gate 4, and ADR-054 / INV-V27-7's ownership of 「disclosure」: the dashboard's shared degrade path serves the raw exception message on the wire

**The clause.** ARCH-130's v27b Gate 4 amendment ends: 「The degraded-log `reason` is the closed set
`{catalog-resolve-failed, derivation-failed, internal}` **with free text under a separate `detail`
key**」 (`02-architecture.md`, ARCH-130 `amended (2026-09-11, v27b Gate 4 — DES-198)`). The whole
degrade vocabulary of this slice is 「`TOKEN: detail`」 — a closed leading token the client maps
through `lib/strings.js`, with the free-form remainder placed where only an operator with journal
access reads it. The NFR-ownership paragraph (`:3332`) then assigns 「*disclosure of the widened
`/api/*` surface*」 to **ADR-054's golden key-set test**, and INV-V27-7 (`:3672`) defines that control
as exact **key-set** equality.

**What HEAD does.** `src/server.ts:615-616`:

```ts
console.warn(JSON.stringify({ event: 'dashboard_api_degraded', route: path, reason: 'internal', detail: (err as Error).message }));
sendJson(res, 200, buildDashboardModel([], undefined, undefined, (err as Error).message));
```

The log line is exactly right — closed `reason`, free text under `detail`. The line under it then
puts **the same free text on the wire**: `buildDashboardModel`'s fourth parameter is assigned
verbatim to `vm.degraded` (`src/dashboard.ts:84`, `:89`).

**Measured against a booted server (`createServer({port:0, workRoot:<tmp>})`, HEAD `18b9c03`):**

```
GET /api/workflows/%/describe -> 200 {"runs":[],"degraded":"URI malformed"}
GET /api/issues               -> 200 {"open":[],"resolved":[],"degraded":"GitHub not configured"}
```

`"URI malformed"` is `URIError.message`, passed through untouched. For this input the message is
harmless; the mechanism is not input-dependent. The catch at `:611` wraps the whole dashboard API
dispatch — `/api/home`, `/api/runs`, `/api/runs/:id`, `/api/runs/:id/dag`, `/api/workflows`,
`/api/models`, `/api/issues` — so any exception raised anywhere beneath those handlers (store,
catalog, GitHub client, MCP facade) has its `.message` published. This engine redacts everywhere
else it emits text it did not author (`redact()` at `run-manager.ts:630`, `:1113`, `:1446`,
`agent-executor.ts:228`, `:400`, `:685`, `:707`); this path applies none.

**Three facts that make it a deviation rather than a preference:**

1. **The sibling catch-all already ships the correct shape.** `src/server.ts:1103-1104` logs
   `detail: (err as Error)?.message` and sends the fixed literal `{ degraded: 'internal dashboard
   error' }`. Two catch-alls, one contract, two answers.
2. **The ledger saw the passthrough and never asked the question.** `tests/fixtures/dashboard-wire.ts:110-116`
   is explicit — its v27c AC-1 comment records that the shape is
   `buildDashboardModel([], undefined, undefined, message)`, 「measured against the real server」 —
   and then keeps `degraded: 'internal dashboard error'` as 「the documentation literal」. So the
   value's provenance was *known* at v27c. What is missing is any row anywhere that asks whether
   free-form exception text belongs on an anonymous wire at all: ARCH-130 answered the adjacent
   question (free text → the log line's `detail` key) and no row carried that answer across to the
   body. The illustrative literal in the fixture is the shape the architecture implies; the code is
   what diverged from it, not the comment.
3. **The named owner of this quality structurally cannot see it.** ADR-054's test asserts
   `keys ⊆ ALLOWED` and `REQUIRED ⊆ keys` and nothing else
   (`tests/integration/dashboard-disclosure.test.ts:120-130`); the degraded row's allow-set is
   `['runs','degraded']` (`dashboard-wire.ts:117`). Every possible value passes. INV-V27-7 says so
   honestly — it is a key-set invariant — which means the disclosure quality ARCH's own NFR table
   assigns to it is, for this one field, unowned.

**The surface it is published on.** The `/api/*` routes carry no bearer at all (owner decision D1;
the previous adversarial pass verified this and recorded it in its §2), so this is anonymous
disclosure to anyone who reaches the host. And the string does not merely sit in a body: on the
Issues tab it is painted into the page — `src/dashboard/ui/issues.js:103-104`,
`el('div','degraded', data.degraded)` — which is the *correct* behaviour for the fixed literals
(`'GitHub not configured'`) the route was designed around and an amplifier for the one value that
is not fixed.

**Severity: MEDIUM.** Not HIGH: I did not find a secret-bearing message actually reachable on these
routes today, and I am not going to claim one I did not measure. It is not LOW either, because the
value is unbounded by construction, the surface is anonymous, the architecture explicitly routed
free text elsewhere, and the correct shape already exists 488 lines away.
**Karpathy check (the tie-breaker cuts toward the fix, not away):** the repair is to change one
expression to `'internal dashboard error'`. It adds no module, no redaction pass and no config — the
`detail` the operator needs is already in the log line on the line above, which is precisely the
argument ARCH-130's `note:` makes for that log line existing at all.

---

### A4-3 (LOW, observability × consumability) — ADR-046 / INV-V26-6 「never a silent zero」: `ui/agent-panel.js` ignores its own `res.status` and paints four zero token columns for a fetch that returned nothing

`src/dashboard/ui/agent-panel.js:233` fetches the agent detail through `getJSON`, which returns
`{status, body}`. `:234` reads `const body = res.body || {};` — **`res.status` is never consulted
anywhere in the function**. `:238` then substitutes a fabricated record:

```js
const record = body.record || { agentId, label, state: '', provider: '', model: '', tokens: { input: 0, output: 0 } };
```

On any non-`ok` response (a whole-route degrade → `{runs:[],degraded:'…'}`; a 404 →
`{error:'Not found'}`; a dropped request → `body: null`) the panel opens and renders six stat cards
from that literal. `src/dashboard/lib/agent.js:73-80` maps them: `Cost` → `fmtCost(undefined, …)` →
`'—'` (correct — `runlist.js:18` returns the dash for absent), `Model` → `'—'`, `Effort`/`Timeout` →
harness-absent dashes, and `Tokens` → `tokenCols({input:0, output:0})` → **`in 0 · out 0 · cache
read 0 · cache write 0`** (`agent.js:21-23`, which only returns `'—'` when `tokens` is falsy, and
this object is not).

So the panel is internally inconsistent about the same failed fetch: the cost card says 「unknown」
and the token card says 「zero」. ADR-046 / INV-V26-6's rule is 「never a silent zero」, and ARCH's own
v27 NFR table (`02-architecture.md:3332`) carries it forward unchanged as this slice's cost-honesty
obligation. The author clearly reasoned about exactly this hazard one field over — `:236-237`'s
comment says `state: ''` is chosen 「never a guessed real state … 『queued』 would claim liveness this
response never reported」 — and the four token columns are the same claim in numbers.

**Relation to the sweep.** IMPL-281's 16-site table lists this site as
`agent-panel.js:234 … shape: destructure-with-defaults (body.record || {...}, **safe** — a degraded
body has none of record/harness/events)`. That reasoning is right about crashes and is the reason
the site renders defaults: having none of those keys is what makes the fallback fire. Counted under
ARCH-125's clause rather than under 「does it throw」, it is a 17th site, and the only one where the
verdict is in scope and simply unread.

**Severity: LOW** — the panel is click-triggered rather than polled, it is not the surface an
operator watches, and four of six cards do say 「—」. Not measured in a browser by this pass; the
code path is unambiguous and I state it as a code reading.
**Repair, with the reachable non-`ok` shapes checked rather than assumed:** the HTTP agent-detail
route maps every facade error to a **404** `{error: message}` (`src/server.ts:592-596`) — it is the
MCP transport, not this one, that returns the facade-error shape under HTTP 200 — so
`classifyResponse` answers `'fail'` on not-found, `'degraded'` on the catch-all body and `'fail'` on
a dropped request, and a 200 on this route always carries `record` (`REQUIRED_AGENT_LOG_OK_KEYS`,
`dashboard-wire.ts:53`). A single `if (res.status !== 'ok')` rendering the `empty`/UNAVAILABLE
affordance the ported tabs already use (`ui/system.js:78-79`) therefore covers every path. The
even smaller alternative, which needs no verdict at all: drop `tokens` from the fallback literal at
`:238` so `tokenCols` returns `'—'` like every other card.

---

### A4-4 (LOW, testability × simplicity) — ARCH-125 `note:` 「it may not decide anything a pure function could decide」: what a view does after a non-`ok` result is a decision, and `ui/` has taken it four incompatible ways

**The clause.** ARCH-125's `note:` opens with the boundary: 「this layer may read the DOM and call
`fetch`; **it may not decide anything a pure function could decide** — every formula it needs is
imported from ARCH-124, which is what keeps the mirror-pair class … from growing」. DES-206:6849
carries the same rule, and the v27b Gate 4 amendment to ARCH-125 enforced it once already, moving
the warning split/map/fallback out of `ui/run.js` into `lib/strings.js` with the reason stated:
「parsing is a DECISION, and this layer's own boundary forbids it from taking one a pure function
could take」. 「What do I show when this route did not answer」 is a decision of exactly that kind — it
is total over the verdict, needs no DOM to state, and is the one decision every view in this
directory has to take.

**What HEAD does.** Each view takes it locally, and they do not agree. ARCH-125's degrade contract
supplies only the negative (「never an exception and never rendered as data」), so six repairs, each
correct against that negative, chose four different positive answers — all live at HEAD, all
test-pinned to whatever was chosen:

| site | behaviour on a non-`ok` result | pinned by |
|---|---|---|
| `ui/home.js:231`, `ui/run.js:475` (`BF-2`) | skip the whole tick — last-known stays | `val-198:276`, `val-200:226` |
| `ui/system.js:78-79` (`BF-4`) | replace the panel with the UNAVAILABLE affordance | `val-202` BF-4 case |
| `ui/run.js:512` (`BF-5`) | drop the `.run-summary` element; the rest of the tick still repaints | `val-200` BF-5 case |
| `ui/workflow.js:326-329` (`BF-6`) | repaint from a fabricated empty payload (→ `A4-1`) | `val-199` BF-6 case |
| `ui/models.js:55-56` | 「(unavailable)」, untranslated, where every sibling string goes through `lib/strings.js` | — |
| `ui/issues.js:102-104` | render the `degraded` reason text itself (deliberate, correct for this route) | — |

**This is not D3-5, and the synthesis should not merge them.** D3-5 is about *how the check is
written* — the classifier's verdict is dropped at `app.js:379` and callers re-derive
`!body || body.degraded` by hand. This finding is about *what happens after the check passes*, and
it is the half that actually hurt: `A4-1` is a site where the verdict **is** correctly consulted
(BF-6 used `dagRes.status === 'ok'`, the blessed idiom) and the behaviour chosen behind it is still
wrong. A helper that answers 「is this ok?」 cannot fix a site whose bug is the fallback it returns.

**Severity: LOW** — no single site is wrong *today* because of it (the site that IS wrong is counted
once, as `A4-1`), and the breach is of a boundary rather than of a behaviour. But it is the
highest-leverage item in this report: it is the standing generator of the class, and closing it
costs one clause of prose, not a module.
**Repair shape:** one clause in ARCH-125's `api:`, e.g. 「A non-`ok` result for a route the visible
view depends on SKIPS that view's repaint for the tick (last-known stays). Only a view whose ENTIRE
fetch set is non-`ok` replaces its panel with the unavailable affordance. No view may substitute a
payload of its own construction.」 Three sentences; `run.js`'s existing bail already implements
sentence one, `system.js`'s already implements sentence two, and sentence three is what `A4-1`
needs.

---

## 2. Verified-clean (stated with evidence, so RE-REVIEW #4 does not re-derive it)

**The five send-back repairs, re-opened on disk at HEAD, not inherited:**

| finding | required shape | status at `18b9c03` | evidence |
|---|---|---|---|
| **BF-1** | `connection.js` reports what THIS tick observed; no `prev.status` carry-forward; counter still advances | **CLOSED** | `src/dashboard/lib/connection.js:39` `const status = consecutiveFails >= 2 ? 'offline' : 'degraded';`; `:34` still `prev.consecutiveFails + 1`; `grep -n "prev.status"` → one hit, `:36`, inside the comment. `tests/unit/dashboard-lib-connection.test.js` 12/12 green (run this pass) |
| **BF-2** | degraded body never reaches the render path on home / the run swimlane | **CLOSED** | `ui/home.js:231`, `ui/run.js:475`; measured in the browser this pass — the run view's graph and summary are **unchanged** under both a degraded and a dropped `/dag` (table in `A4-1`) |
| **BF-4** | no `onTick` passes a non-`ok` body to a render function — System tab | **CLOSED** | `ui/system.js:78` `if (res.status !== 'ok')`; `val-202` 5/5 green |
| **BF-5** | `run.js`'s legend takes the verdict, not the body shape | **CLOSED** | `ui/run.js:512` `viewRes.status === 'ok' ? viewRes.body : null`; `val-200` 7/7 green |
| **BF-6** | `workflow.js`'s `paintSelected` stops rendering 「undefined」 | **CLOSED for the clause it was written against**; the same call site fails a *different* clause → `A4-1` | `ui/workflow.js:326`, `:329`; `val-199` 6/6 green |

**Build and test state at HEAD, run by this pass (not inherited from the IMPL rows):**
- `npx tsc --noEmit` → **exit 0**.
- `npx vitest run tests/unit/dashboard-lib-connection.test.js tests/unit/dashboard-lib-theme.test.js` → **17/17**.
- `RWE_REQUIRE_BROWSER=1 PUPPETEER_EXECUTABLE_PATH=<chrome 152> npx vitest run val-198 val-199 val-200 val-201 val-202` → **37 passed / 0 failed (5 files)**, identical to IMPL-281's figure.
- Two throwaway probes against a booted `createServer` (both written to a scratch dir outside the
  repo, never into `tests/`): the degraded-body value measurement in `A4-2`, and the two-view
  browser measurement in `A4-1`. **Tree state, stated rather than claimed:** `git status --short` at
  completion shows exactly two modified files — this report and `.panel/review/quality-dimensions.md`
  (the sibling lens's own report, written by the other panel agent, not by me). No source, test or
  ledger file was touched; no `git checkout`, no `restore`, no `stash` — and the acceptance run left
  no dirty evidence artefacts behind.

**Checked and genuinely clean, with the reason (so it is not re-derived):**
- **The connection reducer's honesty is now end-to-end.** The tag read 「部分異常」 in both browser
  measurements, including the one where the view beside it lied — the reducer is doing its job and
  `A4-1` is not a `BF-1` regression.
- **`getJSON` is total and correct.** `poll.js:42-53` never throws and never returns `null`;
  `classifyResponse` (`connection.js:44-49`) fails closed on a non-2xx, on a null body, and on any
  object carrying a `degraded` key. Every defect in this class is downstream of a correct classifier,
  which is exactly why `A4-4` is filed against the architecture rather than against this module.
- **The `lib/` purity rule holds, stated precisely.** `grep -nE "Date\.now|new Date|document\.|window\.|fetch\(|localStorage|setTimeout|setInterval" src/dashboard/lib/*.js` → three hits, **all inside prose comments** (`theme.js:13`, `:19`, `status.js:10`); zero in code. The only `Date` in executable `lib/` code is `Date.parse()` over a string the caller passed in (`runlist.js:55-56`, `agent.js:49-51`) — parsing an argument, not reading the clock, which is exactly what AC-7's relocation left behind (`now` is injected). `grep -n "getJSON\|fetch(" src/dashboard/lib/*.js` → none.
- **INV-V27-1 (one usage number).** The usage figures in both browser measurements came through
  unchanged on every tick, including the degraded ones (`14 tok · ≥ $0.00 · 1 未定價` — note the
  lower-bound marker rendering correctly for the unpriced call). No second arithmetic appeared.
- **INV-V27-3 (one origin, no inline execution).** The served shell at HEAD carries exactly one
  inline `<script>` (the JSON island) and three same-origin asset references; the probe's page dump
  confirms `<link rel=stylesheet href="/static/dashboard/dashboard.css">` and
  `<script src="/static/dashboard/ui/theme-init.js">` and no external host.
- **INV-V27-5 (the update panel survives).** The probe's own page dump shows
  `<div class="rwe-update-panel"><span class="rwe-version">v0.1.0 (v0.20.0-339-g18b9c03)</span>` in
  the rebuilt nav — the one non-regression this slice could have lost silently, observed live rather
  than asserted from a test name.
- **Lens applicability, stated rather than force-fitted.** Brute force, JWT forgery and timing
  attacks still have **no surface in this delta**: the five changed client files add no credential,
  no comparison against a secret and no new route. The one security-relevant change in this delta is
  that more responses are now *rejected* than before, which is the right direction. `A4-2` is the
  only finding in this report that is about disclosure, and it is about a field, not a mechanism.

---

## 3. Where the three lenses genuinely conflict (argued, not smoothed over)

**(a) On `A4-1`: security/observability vs. simplicity, and simplicity loses on its own terms.**
The simplicity case for the fabricated fallback is real: `{cells:[],edges:[],…}` is one literal, it
makes `paintSwimlane` total, and it means the function has one exit. The security lens answers that
a total function is not the goal — a *true* page is — and that the literal buys totality by
manufacturing the input. What settles it is that **the simpler code is also the safer code here**:
`run.js:475`'s bail is one `if` and one `return`, it deletes the literal rather than adding a guard
beside it, and it is already written, already reviewed and already test-pinned in a sibling file.
There is no trade to make. When the same fault has two answers in two files and one of them is both
shorter and true, the disagreement is a bug, not a design tension.

**(b) On IMPL-281's `okBody(res, fallback)` recommendation — I argue against it as stated, and for
something cheaper.** The proposal is good diagnosis and the wrong prescription. Three facts:
`okBody` collapses 「did this call site remember to check」 into one grep-able helper, which the
testability lens wants; it would have to be threaded through ~12 call sites, which the simplicity
lens resists for a class the round believes closed; and — decisively — **it would not have prevented
`A4-1`.** Written as `okBody(res, fallback)`, the natural call at `workflow.js:326` is
`okBody(dagRes, { cells: [], edges: [], … })`, which is byte-for-byte the defect. The helper
standardizes the *question* and leaves the *answer* at the call site, and the answer is where the
last two rounds went wrong. **My position:** take `A4-4`'s three-sentence clause first (it costs
prose, binds every future view, and makes the fallback the reviewable decision), and add the helper
only if a seventh site appears after the clause exists. If the helper is built anyway, its signature
should be `okBodyOrBail(res)` returning `null` with no caller-supplied fallback at all — a shape that
cannot express the bug.

**(c) On `A4-2`: disclosure vs. debuggability, where the architecture already ruled.** The honest
case for shipping `err.message` is that an operator reading a degraded dashboard wants to know why,
and the fixed literal tells them nothing. That case is real and the architecture already answered
it: ARCH-130's whole `dashboard_api_degraded` line exists so that 「an operator whose team reports
「無法取樣」 has … something in the journal to look at」. The debuggability need is met on the line
*above*, at a surface that requires journal access; meeting it a second time on an anonymous wire is
not a trade, it is a duplicate with a cost. The scalability lens abstains. Simplicity mildly favours
the fix (one literal, and it deletes a value-flow rather than adding a redaction pass).

**(d) Where the simplicity tie-breaker cut against my own lens, recorded for balance.** The
adversarial reflex on `A4-3` is to demand an unavailable affordance in the agent panel with its own
VAL case and a string-table entry. I rated it LOW and explicitly did **not** ask for that: the panel
is click-triggered, four of its six cards already read 「—」, and a new real-tier browser case for a
one-card honesty defect is exactly the ceremony this ledger's own closing lesson warns about. Two
lines in `agent.js`'s fallback literal discharge it. Likewise I am not re-raising `endpointsFor`'s
budget (F-4), the `BACKFILL_PER_TICK` bound (F-5) or `initZoomable`'s listeners (F-7) — all three are
recorded with their consequences, all three still hold, and none of them moved this round. Nothing
speculative was built in this delta either: still no bundler, no framework, no ETag layer, no
dedupe set, no LRU memo.

**(e) The meta-conflict this loop keeps paying for, stated once.** Six blocking findings (`BF-1`..
`BF-6`) and now a seventh site, all of one class, found one or two at a time. Each round's scope was
narrowed — correctly, because widening a repair is how earlier rounds lost time — and each narrow
scope was defined by the *line*, so the next site survived by letter. `A4-1` is the seventh
repetition. The scope discipline is not the problem; the missing clause (`A4-4`) is, because without
a positive rule there is nothing for a sweep to grep FOR, only crashes to grep for, and this class
does not crash.

---

## 4. Summary

| # | severity | lens | violated | evidence (HEAD `18b9c03`) |
|---|---|---|---|---|
| **A4-1** | **MEDIUM** | security/observability × testability | ARCH-125 `api:` 「never rendered as data」; ARCH-124 `api:` (`classifyResponse`); REQ-134 | `src/dashboard/ui/workflow.js:326`/`:328`/`:329` + `src/dashboard/ui/run.js:219`/`:222`/`:361`/`:367`; measured: graph 2→0, cells 3→0, summary 「1 個節點」→「**0 個節點**」, 0 page errors, on both a degraded and a dropped `/dag`; the run view under the identical fault is unchanged |
| **A4-2** | **MEDIUM** | security | ARCH-130 `api:` (4) as amended v27b Gate 4 (free text under the log's `detail` key); the NFR-ownership assignment of 「disclosure」 to ADR-054 / INV-V27-7 | `src/server.ts:616` (vs. the correct sibling at `:1104`); `src/dashboard.ts:84`/`:89`; measured `{"runs":[],"degraded":"URI malformed"}`; documented as a literal at `tests/fixtures/dashboard-wire.ts:116`; rendered into the DOM at `src/dashboard/ui/issues.js:103-104`; key-set-only control at `tests/integration/dashboard-disclosure.test.ts:120-130` |
| **A4-3** | LOW | observability × consumability | ADR-046 / INV-V26-6 「never a silent zero」, carried into v27 at `02-architecture.md:3332` | `src/dashboard/ui/agent-panel.js:233-238` (`res.status` never read) → `src/dashboard/lib/agent.js:21-23`, `:75` → `in 0 · out 0 · cache read 0 · cache write 0` beside `Cost: —` |
| **A4-4** | LOW | testability × simplicity | ARCH-125 `note:` 「it may not decide anything a pure function could decide」 (and DES-206:6849) — the degrade decision is taken locally in `ui/`, four incompatible ways | `ui/home.js:231` / `ui/system.js:78-79` / `ui/run.js:512` / `ui/workflow.js:326` / `ui/models.js:55-56` / `ui/issues.js:102-104`, each test-pinned or unpinned to whatever was chosen |

**consistent: NO — 4 violations (0 HIGH, 2 MEDIUM, 2 LOW).**

**Routing, for the synthesis to decide rather than for this panel to assert:** `A4-1` and `A4-3` are
impl's lane; `A4-2` is impl's lane with an architecture row that is already correct (nothing in
ARCH-130 needs to move — the code needs to match it); `A4-4` is the architect's. `A4-1` is the only
one I would argue is blocking, and the argument is narrow: it is not 「a new bug」 but the seventh
instance of the class whose closure this gate has already sent back three times, it prints a false
number rather than a blank, and its repair is a copy of a line that already ships in a sibling file.

**One ledger correction owed to the synthesis, not made here** (review prose is not this panel's
lane): `07-review.md:185` states 「`system.js` is the only view at HEAD that passes a non-`ok` body to
a render function」. IMPL-280 already flagged that sentence as false when written; `A4-1` makes it
false a second way. The next pass should correct the wording rather than re-assert it.
