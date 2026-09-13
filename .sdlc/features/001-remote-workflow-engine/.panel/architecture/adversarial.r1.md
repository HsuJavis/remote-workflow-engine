---
stage: architecture
gate: 2
iteration: v27 (Sprint B)
scope: REQ-137 / REQ-138 / REQ-139 / REQ-142 / REQ-143
lens: adversarial (security × scalability/performance × testability; Karpathy simplicity as tie-breaker)
round: 1 (independent proposal)
author: adversarial panel member
date: 2026-09-14
---

# Adversarial architecture proposal — v27 Sprint B

## Altitude judgment

This product is **both** a conventional system and an AI-agent system: a Node/TS HTTP service
(`src/server.ts`) that also runs real Claude Agent SDK sessions (`tech_stack`, D1/D2). **Sprint B's
five REQs, however, sit almost entirely at the *system* altitude** — they are an operator console
over a service: tables, stat cards, a poll loop, a fallback dataset. No agent reads these surfaces
and no agent behaviour changes. I therefore apply the system altitude of
observability/consumability throughout, and I invoke the **agent altitude for exactly two
dimensions**, because there it is real and not forced:

- **Replaceability (agent altitude) — REQ-137.** The Models tab is where an operator decides *which
  model backs an alias* (`default`/`sonnet`/`haiku`…, REQ-004/REQ-078), i.e. how an agent gets
  replaced. Its columns are replacement-decision data, which makes the honesty rule (`—`, never `0`)
  a **correctness** property at the agent altitude, not cosmetics.
- **Self-sustainability (agent altitude) — REQ-139.** `/api/issues` lists `agent-reported` issues
  (`server.ts:461`): agents file defects about themselves and the operator triages them. REQ-139
  keeps that loop visible; a regression here silently severs the loop, which is why REQ-067's
  "degraded, not blank" clause is restated in it.

**What does NOT apply from my lens template, stated plainly:** brute force, JWT forgery, and timing
attacks. Sprint B introduces **no login surface, no token verification, no secret comparison**.
Proposing lockout counters or constant-time compares here would be speculative architecture and the
simplicity tie-breaker kills it. The authn facts that *do* bind are structural, not cryptographic:
all three tab endpoints sit **outside** the auth gate (`server.ts:1361-1370`), which is A-2 below.

## summary

Sprint B should add **zero new server routes and zero new server state** — with exactly one carve-out
(A-7). Every REQ in scope is client-side work over endpoints that already exist and are already
shaped. The adversarial value in this round is therefore not new structure; it is four things the
three lenses agree on and one they do not:

1. **The ported tabs fetch every endpoint twice per tick today** (`tick()` at `app.js:365-377`
   fetches the view's route, then each tab's `onTick` refetches the same URL:
   `models.js:52`, `system.js:72`, `issues.js:99`). One decision — *views consume `bodies`, they do
   not fetch* — simultaneously halves the poll load, closes the 7th/8th sites of the guard defect
   class, and makes both new tabs unit-testable as pure renderers. This is the single highest-value
   move in the sprint (A-1).
2. **REQ-138 promotes an unauthenticated host-recon surface to a first-class polled UI.** I do *not*
   propose re-gating it (that collides with v24 H-1 and the owner's Won't-have D1). I propose
   **bounding what the endpoint can ever say**, in code, with a test (A-2).
3. **Two data-contract gaps** behind REQ-137's drawing: `supported_parameters` is deliberately not on
   the wire (`model-catalog.ts:429`), and latency/benchmarks are Won't-have D2. Both must degrade
   honestly and — critically — be tested as *rules*, not as the current *state*, or they become
   poisoned SPEC_ROWs that go green forever (A-3, A-4).
4. **REQ-142 and REQ-143 interact through one shared counter.** `nextConnection`'s
   `consecutiveFails` (`lib/connection.js`) spans the visibility pause; if demo mode engages on
   `offline`, a stale `1` from an hour ago plus one transient miss on return flips the console into
   fiction. The rule must be decided at Gate 2 and pinned on the pure reducer (A-5, A-6).
5. The one genuine conflict I cannot resolve inside my own lens: the security-maximal answer to A-2
   is an auth gate the owner has explicitly excluded. I name it rather than override it.

## key_points

Each is *tension → resolution → falsifiable check*.

### A-1 — One timer, one fetcher: views render supplied data, they never fetch their own route
**Tension.** Scalability wants fewer requests; testability wants pure renderers; the guard defect
class wants one classification site. Today all three are violated in the same place: `activateTab`
sets `currentView = {name: 'models'|'system'|'issues'}` (`app.js:151-186`), so `tick()` fetches
`endpointsFor(name)` (`poll.js:15-27`) **and then** calls `view.onTick(container, bodies, ctx)`,
whose implementations ignore `bodies` and call `getJSON` on the same URL again
(`models.js:52`, `system.js:72`, `issues.js:99`). Every ported tab issues **2 GETs per 3 s**.
**Resolution.** `onTick(container, bodies, ctx)` **consumes `bodies[url]` plus the status `tick()`
already holds**; no view calls `getJSON` for its primary endpoint (on-demand secondary fetches, e.g.
`issues.js:78`'s click-to-expand, stay). First paint on tab activation reuses the existing
`scheduleTick()` (which fires immediately, `app.js:432`) instead of a module-local fetch.
**Check.** Assert the **ratio, not an absolute**: exactly **one GET per tick** to the tab's route —
i.e. half of today's — with the Playwright count `<= 10` over 30 s and strictly equal to the tick
count. (The timer is "3 s after the last tick SETTLED" (`app.js:6`), so the cadence is 3 s + fetch
latency; a SPEC_ROW pinned to a literal 10 would flake on a slow fetch, which is A-4's own poisoned-row
pattern.) Plus `grep -n "getJSON(" src/dashboard/ui/*.js` shows only click-driven calls. Same
instrument REQ-142's acceptance already mandates, so this costs no new test machinery.
**Known follow-on for Gate 3+4 (not a blocker on this decision).** `activateTab` leaves
`currentView.onTick: null` until the lazy `import()` resolves (`app.js:174-178`) and `tick()` skips a
null `onTick`, so on a cold tab load the first fetched body can arrive with no painter mounted. Two
minimal answers exist — arm `scheduleTick()` from inside `import().then(...)`, or have `tick()` keep
the last `bodies` so a late-joining `onTick` receives them. This is the answer to "A-1 makes first
paint 3 s slower"; it does not change the decision.

### A-2 — Bound the recon payload; do not re-gate `/api/system`
**Tension.** `/api/system`, `/api/models`, `/api/issues` are dispatched **outside** the auth gate
(`server.ts:1361-1370`); the v24 H-1 adjudication deliberately removed the one gate that stood in
this family because an unauthenticated browser client answered 401 and the pane went blank. REQ-138
turns that endpoint into a permanently polled, fully rendered surface: PIDs, process names, engine
PID/uptime/threads/fd count, disk path, core count, load average. Security wants a gate; the owner's
Won't-have **D1 (no per-principal dashboard authz)** forbids one this iteration.
**Resolution.** Do not re-litigate the gate at Gate 2 — constrain the **content**, as constants with
tests: (a) `topN` stays a **server-side constant** (recommend 20, up from the current
`server.ts:370` `{topN: 5}`), **never** a query parameter — a `?topN=` would be both a recon-widening
knob and a per-request cost knob; (b) the row shape stays **`comm` only — never argv, cwd, env or
uid** (already the shape at `system-info.ts:46`; make it an asserted invariant, not a habit); (c)
keep the full disk `path` (it is already on the wire; hiding it in the UI while the API serves it is
theatre) and instead record the deployment consequence: **with `bind: 0.0.0.0` the host process table
is world-readable** — an ADR consequence and a DEPLOY line, which is the honest control given D1.
**Check.** A test asserting the `/api/system` JSON key set is a **closed allowlist** (a new key fails
the test); `grep -n "topN" src/server.ts` shows a literal constant with no URL-derived value.

### A-3 — `supported_parameters` is not on the wire: project it, don't re-expose it
**Tension.** REQ-137's slide-in asks for 支援參數 as neutral tags. `enrichModelEntry` **deliberately
drops** the field (`model-catalog.ts:429`, with the stated v26/DES-179 reason: it is the RAW signal
that `toolUseDeclared`/`effortDeclared` project, and "the output must carry one name per fact").
**Resolution.** Render the **projected declared facts** (`toolUseDeclared`, `effortDeclared`,
`declaredSource`) as that tag row; do **not** re-expose the raw array. Re-exposing reverses a v26
decision, puts two names on one fact, and enlarges an unauthenticated payload — for a visual detail.
Record the deviation from the handoff drawing **explicitly** (the fidelity lens will object; see
disagreements).
**Check.** `grep -n "supported_parameters" src/models/ src/dashboard/` shows it never reaching the
client; a UT pins the tag row as derived from the `*Declared` fields.

### A-4 — Test the rule, not this iteration's absence (anti-poisoned-SPEC_ROW)
**Tension.** Latency and benchmarks are Won't-have D2, so REQ-137 says both columns render `—` **this
iteration**. A test that pins "the latency cell is `—`" encodes the absence and stays green forever
once D2 is lifted — carry-forward #3's exact failure mode ("a poisoned row is worse than a missing
one").
**Resolution.** Pin the **rule**: fixture row **without** `latency` → `—`; fixture row **with**
`latency` → `TTFT 900ms · p50 6.8s`. Both fixtures are client-side; no server change. Same for
`benchmarks`, and same for `cpuPct: null` on the System tab (`system-info.ts:65,73` already allow null).
**Check.** Two fixture rows per honesty column; `grep` shows no hardcoded `'—'` inside the cell
builder's happy path.

### A-5 — Failure counting across the visibility pause (ADR-grade)
**Tension.** This is my lens's "consistency of failure counting", mapped onto the real scope.
`nextConnection` carries `consecutiveFails` across ticks and only reports `offline` at ≥2 consecutive
all-fail ticks (`lib/connection.js`). REQ-142 pauses polling while hidden — so the two ticks
bracketing a pause can be an hour apart, and `consecutiveFails` is a claim about a 3 s cadence that
no longer holds.
**Resolution.** **On resume from hidden, reset `consecutiveFails` to 0 before the first tick.** The
streak means "consecutive observations at the polling cadence"; a pause breaks the cadence. Keep the
rule **inside the pure reducer** (an explicit reset input/action), never in the DOM layer.
**Check.** UT on `nextConnection` with no browser: `fail → pause → fail` ⇒ `degraded`;
`fail → fail` (no pause) ⇒ `offline`.

### A-6 — REQ-143 demo data: three structural constraints so fiction cannot be mistaken for fact
**Tension.** A demo dataset in an operator console is a deliberate fiction; the owner kept it on
purpose ("因為我要看有缺什麼") with a registered retirement condition. My security/integrity lens
cannot delete it, so it must be made **structurally unmistakable**.
**Resolution.** (a) **Engage only at `offline`** (≥2 consecutive all-fail) — reuses the existing
debounce, adds zero new state and no second threshold, and (with A-5) cannot be tripped by one
transient miss during a self-update restart. (b) The dataset lives in **its own client module, loaded
by lazy `import()` at engage time only** — while live it is not even downloaded, so no live view can
read it by accident, and its request is a positive Playwright observable. (c) **One emitter**: the
source state is derived from `connectionState` alone and passed into each view's view model; no tab
reads a global, and **no view model ever mixes demo and live fields**.
**Check.** With the API killed, `/static/dashboard/lib/demo-*.js` is requested exactly once and the
nav tag reads 示範資料 with no 連線中; while live that URL is **never** requested (request-count
assertion, same instrument as REQ-142). Plus: the new module is registered in `ASSET_KEYS`
(`static-assets.ts:18-26`) — the closed-map test enforces both directions.

### A-7 — The one carve-out to "zero new routes": REQ-138's fourth stat card has no source
**Tension.** `/api/system` returns host observables only (`system-info.ts:80-100`). REQ-138's
"儲存的工作流數 · `9 個版本 · 13 次執行記錄`" is catalog + run data.
**Rejected.** Extending `/api/system` with catalog counts — it breaks the host-observables module
boundary, grows an unauthenticated payload, and puts two unrelated failure modes behind one degrade
verdict.
**Resolution.** `ROUTES.system` (`poll.js:26`) gains the **existing** `/api/workflows` (version
counts), and the run-record count comes from the **same summary fold** `/api/runs` already uses —
never a second fold (REQ-141/R-1's lesson: two folds diverge).
**Cost, stated honestly.** +1 GET per 3 s while the System tab is visible — and because A-1 removes
a duplicate GET on that same tab, the **net is ≤ today**.
**Check.** `endpointsFor('system')` returns exactly the agreed set (UT, already this file's
contract); the `dispatchDashboard` condition in `server.ts:1361-1370` is **unchanged**.

### A-8 — Derivation in `lib/`, DOM in `ui/`
**Tension.** REQ-137/138 are mostly DOM, but each hides real logic: the sort comparator + filter
predicate + the `4 / 9` count string; the bar percentages + degrade selection + the
`總處理程序 312 · S 298 · R 7` header. Browser tests are the scarcest resource in this ledger.
**Resolution.** Pure functions in `lib/model.js` (exists) and a new `lib/system.js` over the API
shapes; `ui/models.js`/`ui/system.js` become DOM-only. The Playwright budget is then spent only on
what a browser alone can see (clipping, tab routing, request counts).
**Check.** `grep -n "document\." src/dashboard/lib/*.js` returns nothing; sort/filter/percentage UTs
run in node with fixture rows.

### A-9 — Test the route users open: these are tabs, not URLs
**Tension.** Models/System/Issues switch **without changing the URL** (`app.js:151` `TAB_MODULES`,
`activateTab`). val-201 was green for weeks while the real route was broken because the test opened
the legacy one (carry-forward #5).
**Resolution.** Every acceptance item starts at a **cold `/dashboard`** and **clicks**
`[data-tab="models"|"system"|"issues"]`, then asserts first paint — never a deep link, never a
pre-mounted panel.
**Check.** Each VAL item's selector chain begins with the tab click; a first-paint assertion follows
it within one tick.

### A-10 — One-line link invariant on the Issues tab
**Tension.** `issues.js:85` sets `href` from the API-supplied `data.url` with no constraint. CSP
(`script-src 'self'`, `server.ts:1332`) blocks `javascript:` navigation, so this is defence in depth,
not a live hole — but REQ-139 re-touches this code and the invariant costs one line.
**Resolution.** Accept only `https://` at the configured GitHub host; otherwise render the text with
no link. Add `rel="noopener noreferrer"` if it opens in a new tab.
**Check.** UT feeding `javascript:alert(1)` and `https://evil.example/` ⇒ no `href` set.

## risks

- **R1 — Silent bundle break (highest operational risk).** Sprint B adds at least two client modules
  (`lib/system.js`, the demo dataset). A module missing from `ASSET_KEYS` (`static-assets.ts:18-26`)
  breaks the whole served bundle while every unit test stays green — it has happened once here
  (acceptance went 0/12, carry-forward #6). Mitigation is already in the repo: the closed-map
  `readdirSync` diff test; the risk is forgetting to *run* it in the same pass.
- **R2 — Demo mode leaking into live rendering.** Any per-field fallback (rather than
  per-console) produces a mixed reality and makes REQ-143's registered retirement impossible to
  execute cleanly. The ledger's most-repeated defect class is "deleted but something still describes
  it" (REQ-105 / ADR-048 / UT-115) — and REQ-143 is scheduled to be deleted by construction.
- **R3 — The recon surface is permanent once shipped.** Raising `topN` is invisible; lowering it
  later is a visible regression an operator will file. The cap must be chosen at Gate 2, not at
  implementation time.
- **R4 — Poisoned SPEC_ROWs.** The two highest-risk cells are the always-`—` latency/benchmark cells
  (A-4) and the **default sort order** — one row was found this iteration passing by coincidence of
  default sort plus default selection. Any sort assertion must vary the sort key, not assume it.
- **R5 — The guard defect class has two open sites inside Sprint B's own files.** `models.js:52`
  keys on body shape (`!entries || !Array.isArray(entries)`); `issues.js:80` and `:102` key on
  `data.degraded`. `system.js:78` is already repaired (BF-4) and is the model to copy. **Subtlety
  worth recording:** `/api/issues` has *two different* 200-with-`{degraded}` bodies — the route's own
  REQ-067 "GitHub not configured" degrade (`server.ts:463`) and the server catch-all's.
  `classifyResponse` maps **both** to `degraded` (`lib/connection.js`), so keying on `res.status`
  is correct *and* preserves REQ-067's wording, as long as the wording is read from the body's
  `degraded` string **inside** the `status !== 'ok'` branch. A-1 deletes most of these call sites
  outright.
- **R6 — "Degrade, never pretend" on stat cards.** `cpuPct` is legitimately `null`
  (`system-info.ts:65,73`); a 0-length accent bar reads as a measurement of zero. REQ-138's own clause
  demands "無法取樣 / Unavailable" — the bar component, not just the number, must have an absent
  state.
- **R7 — Scheduling, not engineering (carry-forward #1).** The design panel's round-2+decide died on
  the session limit four consecutive times as the tail of a long chain. This proposal is deliberately
  short and decision-shaped so the synthesis step is cheap.

## expected disagreements with other lenses

- **vs. the fidelity / design-handoff lens (the owner's 99% bar).** It will want the process table,
  the raw `supported_parameters` tags, and the full disk path exactly as drawn. I concede the **disk
  path** (it is already on the wire — hiding it in the UI is theatre), and I hold **A-2's row cap**
  and **A-3's projection**. This must be recorded as a *named deviation with its clause*, not
  silently resolved in either direction. REQ-139 is explicitly exempt from the 99% bar (no design
  page), which is the right precedent for how to record a bounded deviation.
- **vs. a pure simplicity lens that would drop REQ-143.** I sympathise — a fabricated dataset in an
  operator console is the least defensible thing in Sprint B — but the owner kept it deliberately and
  registered its retirement condition. The debate is about its **shape** (A-6), not its existence.
  Anyone proposing deletion must route it through Gate 1, not Gate 2.
- **vs. a DRY / design-system lens.** It will propose a shared `okBody(res, fallback)`-style helper
  for the three tabs' degrade handling. **DES-206 forbids that by name**, and the carry-forward
  records the decision rather than the implementer's recommendation ("a helper that wraps the
  classifier is one more place to get the classifier wrong"). I side with DES-206 and go further:
  A-1 removes most of the call sites that would have used it.
- **vs. a performance-purist lens.** It may propose SSE, a configurable poll interval, or a
  SharedWorker/BroadcastChannel single poll shared across tabs. Reject: **D3 is an explicit
  Won't-have**, and a cross-tab channel is new surface (and new API data in transit between
  contexts) for a console that polls one endpoint set per visible view. **REQ-142 + A-1 get the same
  win in roughly five lines**, which is the simplicity tie-breaker applied literally.
- **vs. a security-maximalist reading of my own lens.** The maximal answer to A-2 is to put
  `/api/system` behind the auth gate whenever auth is enabled. I **do not** propose it: it collides
  with the v24 H-1 adjudication (the blank-pane failure that removal was meant to fix) and with
  Won't-have D1. Naming the conflict *is* the deliverable here; overriding an owner constraint from
  inside an architecture gate is not.
- **Internal conflict inside my own three lenses (testability vs. security).** Tests want an
  injectable `topN` to drive fixtures; security wants no knob at all. **Resolved at the composition
  root**, not over the wire: `SystemInfoSampler` already takes `probe`/`clock`/`ttlMs`
  (`system-info.ts:106` names the boundary "Injectable OS boundary — `StubSystemProbe` replaces
  it"), so fixtures come from the stub probe while the HTTP surface keeps a constant. This is the
  pattern the repo already uses; no new seam is needed.
- **Internal conflict (scalability vs. integrity) on REQ-142 + REQ-143.** Pausing polls while hidden
  saves load but lets the connection verdict age; engaging demo on a stale streak converts that
  staleness into fiction. A-5 resolves it by making the streak mean what its name says. A lens that
  optimises purely for request count will want a longer pause and a lazier resume; I hold the
  immediate resume tick that REQ-142 itself specifies ("切回立即輪詢一次").
