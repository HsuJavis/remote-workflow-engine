---
stage: architecture
gate: 2
iteration: v27 (Sprint B)
scope: REQ-137 / REQ-138 / REQ-139 / REQ-142 / REQ-143
lens: adversarial (security × scalability/performance × testability; Karpathy simplicity as tie-breaker)
round: 2 (responses + final position)
read this round: quality-dimensions.r1.md in full; my own adversarial.r1.md
measured this round (7 greps/reads, all cited inline): src/dashboard/lib/connection.js, src/dashboard/ui/poll.js, src/dashboard/ui/app.js:145-200,350-440, src/dashboard/ui/models.js:45-70, src/dashboard/ui/dom.js, src/server.ts:340-400,455-500,1320-1375, src/dashboard.ts:80-92, src/run-manager.ts:823-860, src/system-info.ts:100-130,236-300, src/models/model-catalog.ts:292-335,415-450, tests/unit/static-assets.test.ts:50-72, 01-requirements.md:1846-1892 (REQ-137/138/139 acceptance verbatim)
author: adversarial panel member
date: 2026-09-14
---

# Adversarial architecture — round 2

## summary

The quality lens and I converged on the load-bearing decision independently: **one data seam, one
timer, views render supplied bodies** (their B-R1 = my A-1). That is the sprint's spine and it is no
longer in dispute. Round 2 moved four more things, in both directions:

- **I concede three of my own positions**, each on evidence I did not have in r1: demo must key on
  *unreachable*, not on the `offline` tag (their B-S2 — I verified the false positive is real and
  ~6 seconds away on a healthy engine); the counts card composes at the route from COUNT accessors
  (their B-R6 — I verified my "same fold" objection dissolves); the scheduler's decision table earns
  a `lib/` home (their B-S1, with a scope bound).
- **I rebut one thing that would have shipped a defect**: B-R3's demo substitution is **per URL**,
  so a two-route view mid-recovery renders live and fabricated data **in the same paint**. That is
  their own B-O4 partition and my A-6(c) violated by construction. Fix: all-or-nothing per tick,
  substituted in `tick()`, not in a per-call wrapper.
- **I hold two, now on requirement text rather than taste**: REQ-137's acceptance contains **no
  provider-health clause** (read verbatim this round), so B-O1's new route is a real gap but not a
  Sprint B requirement — the honest minimum is one additive per-row field plus a journal transition
  line; and 「支援參數以 neutral tag 列出」 does not name the upstream array, so A-3's projection meets
  it in substance, not merely in letter.
- **Two of my r1 constraints survive but changed shape**: `?topN=` is settled without either of us
  conceding anything (the sampler applies `topN` at shape time per call — so a **different constant
  per caller** costs nothing and no URL knob is needed); and my A-5 streak reset is **not** subsumed
  by their `reached` predicate — the two close different false positives and both are needed.

Net wire delta for Sprint B after this round: **one additive field on `/api/models`, one composed
`catalog` block on `/api/system`, zero new routes, zero new config keys.**

## verdicts on quality-dimensions.r1.md

| their id | mine | verdict | engineering reason | integrated form |
|---|---|---|---|---|
| **B-R1** one data seam | A-1 | **concede/converge** | Same decision, arrived at independently, same three cites (`models.js:52`, `system.js:72`, `issues.js:99`). Verified the duplicate: `models.js:60-62` fetches `/api/models` itself and returns `{'/api/models': res.status}` as `extra`, which `tick()` merges over the status it already had for the same URL (`app.js:378-380`) — 2 GETs, and the tag reads the second one. | Their clauses (i)-(iii) adopted verbatim. Their `getJSON`-import guard test adopted (cheaper than my grep check). |
| **B-R1 (iv)** activation is a scheduler event | A-1 follow-on | **concede — and upgrade its severity** | I filed this as a "known follow-on, not a blocker". Wrong: `activateTab` (`app.js:163-201`) never calls `scheduleTick()`, so once views stop self-fetching a tab switch shows an empty panel for up to 3 s. It is a **blocker for the seam**, not a follow-on. It is also one line — `scheduleTick()` already fires immediately (`app.js:432`) and bumps `viewGeneration`. | `activateTab` ends with `scheduleTick()`; the cold-tab case (`onTick: null` until `import()` resolves, `app.js:186-195`) fires it again from inside `.then(...)`. |
| **B-S2** demo keys on `reached`, not on `offline` | A-6(a) | **concede, fully** | Measured, not argued: `ROUTES.run` is **one** URL (`poll.js:19` — the DAG), and an unknown runId answers 404 (`server.ts:490`). `classifyResponse` → `fail` (`connection.js:46`), one route so `allFail` (`connection.js:30`) is trivially true, `>= 2` → `offline` (`connection.js:39`). A stale `/dashboard/<runId>` link therefore reaches `offline` in ~6 s **on a healthy engine**, and my A-6(a) would have swapped the console to fiction there. My "reuse the existing debounce, add no second threshold" was the cheaper design and the wrong one. | `reached` on `getJSON` (its outer `catch` is the only `false` arm) — one field, no change to `classifyResponse` or the tag. |
| **B-K2 / B-K3** the two demo hazards | R2 | **concede** | Both verified as above; their transport-swap critique of the handoff's own machine (`.dc.html:530-537` never re-probes) is correct and is why recovery must ride the real poll. | Real poll never stops in demo; exit on the first reached `ok`. |
| **B-R3** `getViewJSON`/`viewBody` per-URL substitution | A-6(c) | **REBUT the form, concede the location** | The per-URL rule mixes realities in one paint. `ROUTES.workflow` returns **two** URLs (`poll.js:21-24`). Recovery sequence: tick N all-unreached → `demoActive`; tick N+1 `describe` returns `ok`, `/api/runs` still `fail` → `viewBody` passes the real body through **and** substitutes a demo body beside it. One view, live row + fabricated row, same frame — their own B-O4 partition ("Demo never with Live") and my A-6(c) both broken by construction, and the operator has no way to tell which half is which. | **All-or-nothing per tick**, and substituted **in `tick()`**, not in a per-call wrapper: if any route in this tick reached, nothing is substituted (failed routes render Unavailable). `tick()` already awaits every primary fetch before calling `view.onTick` (`app.js:370-376`), so the decision is available at the seam — which also means **no view imports a demo-aware fetch at all**, preserving B-R1 (ii) exactly. Click-driven extras use one `demoBody(url)` lookup on the same Map; a URL absent from the Map is Unavailable, never fabricated. |
| **B-S2** entry lag from statement order (~9 s) | new | **rebut the mechanism, keep the margin** | Their 9 s margin is an **emergent property of where `demoActive` is read relative to `nextConnection`**. A future reorder of `tick()` deletes the safety margin silently and no test fails. A safety threshold must be a number in a pure function, not an accident of statement order. | Explicit `consecutiveUnreached >= N` in the pure predicate. N pinned at Gate 7.5 by **measuring a real self-update restart** (`run-manager.ts`'s restart path): N must exceed it, or every self-update paints demo workflows for a teammate watching a run. |
| **B-O1** `GET /api/models/status` | A-3 / "zero new routes" | **hold the route, concede the defect** | Their probe finding is real and I do not dispute it (`model-catalog.ts:303-306` `.catch(() => [])` swallows both providers; the 4 static rows then carry a **fresh** `catalogFetchedAt` from the snapshot that "succeeded"). But I read REQ-137's acceptance verbatim this round (`01-requirements.md:1850-1860`): columns, sorting, the `—` rule, the counter, the 560px panel. **No clause mentions provider health, catalog source, or the tag.** A new unauthenticated route, a `buildCatalogReport` refactor, a `ModelBook` widening and a `BookSnapshot` field, to satisfy no acceptance clause, is exactly what the tie-breaker exists to refuse. | **Their own stated fallback, taken as the sprint's answer:** additive per-row `catalogSource: 'live' \| 'last-good' \| 'static'` (follows DES-179's per-row `catalogFetchedAt` precedent, no wrapper, no MCP break) — which also feeds their B-R5 provenance line, which REQ-137's 供應商 · 位置 kicker *does* ask for. Plus the transition-only journal line (zero wire). Recorded as a **named v28 row** with the discriminating fact stated, so nobody re-derives it: *a per-row field cannot report a provider that contributed zero rows.* |
| **B-O1's performance half** (list out of the tick) | A-1 | **rebut — solved client-side for free** | Their heartbeat is justified partly by "100 rows × 12 columns rebuilt every 3 s". That is a **repaint** cost, and their own B-S3 fingerprint fixes it with **zero wire change** (`/api/models` is capped at 100 by `DEFAULT_LIMIT`, `model-catalog.ts:92,447`). Once the repaint is fingerprinted, the only residual is bandwidth on a 1-hour-TTL body — not enough to buy a route. | B-S3's fingerprint (`catalogFetchedAt` + count + sort/filter/selection) adopted; the heartbeat dropped. |
| **B-C2** `supportedParameters` back on the wire | A-3 | **hold** | I read the clause: 「支援參數以 neutral tag 列出」. It does **not** name `supported_parameters` and does not say "the upstream list". The wire's declared-parameter facts are `toolUseDeclared` / `effortDeclared` / `declaredSource` — rendering those as neutral tags **with provenance** (`tools ✓ upstream`, `reasoning ✓ static`) is one tag per known parameter and satisfies the clause in substance. Their "letter only" framing assumes a reading the text does not force. | Held — *with the escape hatch pre-stated so a later owner ruling is cheap:* if the clause is read as the upstream list, it is one additive field, and it must then ship **bounded** (max item count, max per-item length, closed charset). Reason: it is uncontrolled vendor-supplied text entering an unauthenticated payload **and** every `models_list` agent context. `dom.js:10` is `textContent`-only so the DOM is safe; the MCP echo and the payload are not free. Their QD-C3 tool-surface regen obligation stands either way. |
| **B-C3** typed-but-absent `latency` / `benchmarks` | A-4 | **hold (they conceded)** | Declaring fields with no producer is speculative shape. The value they want — v28 cannot invent a second shape — is obtainable at zero code cost. | Record the intended shape in the ADR row, not in `EnrichedModelEntry`. My A-4 rule-based test (fixture with / fixture without) stands unchanged and is independent of this. |
| **B-C4** `?topN=` | A-2 | **both positions dissolve — measured** | I refused a query param (recon + per-request cost knob on an unauthenticated route); they wanted 15 rows. Neither is needed: `SystemInfoSampler.get()` caches the **raw** snapshot + proc view and calls `buildSystemInfo(..., {topN}, ...)` **per call** (`system-info.ts:256-290`). `topN` is applied at shape time, so two callers with different N inside one TTL both get correct output. | `/api/system` passes a raised **constant** (recommend 20, `server.ts:370`); `system_info` keeps 5. No URL knob, no config key, no cache interaction. My A-2 check stands: `grep -n "topN" src/server.ts` shows literals only. |
| **B-R6** counts composed at the route | A-7 | **concede — my objection was wrong twice** | (1) Boundary: I objected to extending `/api/system`; they compose **at the route**, not in the sampler (`{...view, auth}` at `server.ts:372` is the existing precedent) — `SystemProbe`/`StubSystemProbe` stay untouched, which is the boundary I was actually defending. (2) Divergence: my A-7 insisted on "the same fold as `/api/runs`, never a second fold". Verified it dissolves — `buildDashboardModel` is `{ runs: [...runs] }` with **no filter** (`dashboard.ts:86`) and `listSummaries()` pushes **every** row from `listRuns()` on all three branches (`run-manager.ts:823-860`; the backfill budget bounds *healing*, never membership). So `COUNT(*)` and the list length agree by construction. (3) My own A-7 was worse on scalability: it put `catalog.list()` — full rows carrying a `versions: string[]` each (`workflow-catalog.ts:807`) — on a 3-second poll to render one integer. | Their B-R6 adopted, and **my A-7 carve-out (`/api/workflows` added to `ROUTES.system`) is withdrawn** — Sprint B now adds zero new routes with no carve-out at all. **One condition, which is R-1's lesson landing as a definition rather than a rejection:** each COUNT accessor must be defined as *the same predicate its list counterpart reads*, and 「9 個版本」 / 「13 次執行記錄」 must have their definitions written into the ADR row (total versions across workflows; store rows, not displayed rows) — a card whose number disagrees with the tab beside it is the defect class, whichever way it is computed. |
| **B-S1** `lib/scheduler.js` state machine | A-5 | **concede location, bound the scope** | I would have written "six lines in `app.js`". The line that changes my mind is not ceremony, it is a **race**: `scheduleTick()`'s `tick().finally(() => setTimeout(loop, 3000))` (`app.js:394-396`) re-arms after an in-flight tick **even if the page went hidden while that tick was in the air**. That is a real leak of REQ-142's guarantee, it lives in `ui/` where QD-R2 records there is no unit tier, and it is invisible to a request count taken 30 s later. | Adopted, with a bound: the machine owns **only** `{parked, armed} × {settled, hidden, visible, view-changed}`. It does **not** own `viewGeneration` (wiring), the demo predicate (below), or any fetch. **One UT they did not name, and it is the one that matters: `hidden` arriving between `fire` and `settled` must yield `park`, not `arm`.** |
| **B-S1** oracle traps (frozen page / patched `visibilityState`) | A-9 | **concede, adopt** | Both named traps pass vacuously. Their "measure first whether headless Chromium fires `visibilitychange` on a backgrounded page" is the right order of work. | Adopted verbatim, and it composes with my A-9: the proof starts at a cold `/dashboard`, **clicks** the tab, then backgrounds a real page. |
| **B-R2** `lib/views.js` single view registry | (new) | **rebut** | Its stated justification is carry-forward lesson 6 — and that lesson is **already a red unit test**: `tests/unit/static-assets.test.ts:50-71` is closed **both ways**, including a `readdirSync` walk asserting every on-disk `.js` is a registered key. A `models.js` missing from `ASSET_KEYS` fails today. What remains is a refactor that moves `ROUTES` out of `poll.js` — whose own header says sibling modules "must not edit it; extend ROUTES below" (`poll.js:8-11`) — during a sprint that rewrites three other files. Net risk up, net defect coverage unchanged. | Refused. If the cross-check they want is wanted anyway, it is one assertion, not a module: a UT that every `TAB_MODULES` value is a registered `STATIC_ASSETS` key. |
| **B-O2** per-section degrade with the reason | R6 | **concede, adopt** | Verified the closed `Reason` set exists (`system-info.ts:24-34`) and that three of the five are not faults. REQ-138's clause 「不得顯示 0 假裝有值」 is satisfied only if the absent state is per section. | Adopted. Their `sectionState()` in `lib/` is also exactly my A-8 (derivation in `lib/`, DOM in `ui/`) — converged. My R6 addition stands: the **accent bar** needs the absent state too, not only the number; a 0-length bar reads as a measurement of zero. |
| **B-O3** `data-conn` / `data-source` / `data-poll` stamps | (new) | **concede as a SECONDARY oracle only** | A stamp written by the same code path under test can pass vacuously — the identical trap they correctly named for `visibilityState`. | Adopted for debugging and as a secondary assertion. **Rule: no SPEC_ROW may assert the stamp alone.** REQ-142's primary oracle stays request counting; REQ-143's stays the lazy-import request plus the rendered marker. |
| **B-O4** self-labelling in the data, three layers | A-6(b)(c) | **concede, adopt — it is stronger than mine** | "A banner can be cropped out of a screenshot; a run id pasted into an issue cannot" is correct and is a better answer to my R2 than mine was. Their banner-placement detail (outside the container `mountLazy`'s `replaceChildren()` clears, `app.js:404`) is a real cite I did not have. | Adopted whole: `demo-` prefixed ids, `99xxx` PID band, `[DEMO]` titles; marker at nav tag + shell banner + data. |
| **B-S4** `demo-surface.test.ts` retirement tripwire | A-6 / R2 | **concede, adopt — strictly better** | My r1 offered "a registered retirement condition"; a closed-both-ways allowlist test makes retirement mechanical and turns the ledger's most-repeated defect class ("deleted but something still describes it") red on both sides. | Adopted, same mechanism as `static-assets.test.ts`. |
| **B-O5 / B-C5 / B-C6** positive `res.status` rule, both-language strings, re-authored VAL id | R5 / A-9 | **concede, adopt** | B-O5 goes one step past my R5 by keeping the server's `degraded` string as secondary text — the reason is the observability, and `server.ts:463` already wrote it. B-C6's `notClipped` point is right: `getComputedStyle` cannot see a flex-shrink clip. | Adopted. My R5 subtlety stands as the implementation note: `/api/issues` has **two** different 200-`{degraded}` bodies and `classifyResponse` maps both to `degraded`, so keying on `res.status` is correct *and* preserves REQ-067's wording, provided the wording is read from the body **inside** the `status !== 'ok'` branch. |
| **B-C1** disclosure rows + wire fixtures for the three routes | A-2 check | **concede — it IS my check** | My A-2 asked for "a test asserting the `/api/system` key set is a closed allowlist". Their `DISCLOSURE_TABLE` row is that test, in the mechanism the repo already uses, extended to all three routes, and the same fixture type-locks the demo dataset. Two lenses, one artefact. | Adopted. The `catalog` block (B-R6) and `catalogSource` (B-O1 fallback) each owe a row in the same pass — that is ADR-054's budget rule and it is what keeps the recon surface bounded without an auth gate. |
| **B-S2 / housekeeping (vi)** two offline proofs, two mechanisms | A-9 | **concede, adopt** | Sharp and correct: REQ-131's Offline proof must be induced by **HTTP errors on every visible route** (reached ∧ all-fail), REQ-143's by a **stopped engine under an already-open page**. Build either as the other and one silently stops testing anything. | Adopted as a Gate 5 constraint. |

## my final position (Sprint B, as it now stands)

1. **One seam, one timer.** Views render `bodies`; no view fetches its own tick route; `getJSON` is
   imported by `app.js`/`poll.js` only, enforced by a unit test. State-dependent extras keep the
   existing `run.js`/`workflow.js` pattern (`tick()` merges them before the reducer, `app.js:378-380`).
2. **Tab activation fires the loop.** `activateTab` → `scheduleTick()`, and again from the lazy
   `import().then(...)` for a cold tab. Blocker for (1), one line, no new machinery.
3. **Polling is a bounded pure machine in `lib/`** — `{parked, armed} × {settled, hidden, visible,
   view-changed}` — with the in-flight-hide race as a named UT. Timers, generation counter and DOM
   stay in `app.js`.
4. **Demo mode: one predicate, one substitution point, all-or-nothing.**
   `demoActive = allUnreached(thisTick) ∧ consecutiveUnreached >= N ∧ DEMO_AVAILABLE`.
   **`offline` is deliberately NOT a conjunct** — it is *implied* (an unreached route classifies as
   `fail`, so all-unreached is all-fail), and naming it would be worse than redundant: it would read
   as the guard when `allUnreached` is the thing actually doing the guarding, and it would bind the
   demo decision to a **second counter** (`consecutiveFails >= 2`) that can disagree with
   `consecutiveUnreached` after a resume reset. One decision, one counter — which is this lens's own
   "consistency of failure counting" applied to itself. Substitution happens in `tick()` over the
   whole `bodies` set or not at all; the real poll never stops; exit is the first reached `ok`. Dataset is a lazy-`import()`ed exact-match `Map`,
   registered in `ASSET_KEYS`, `satisfies`-locked to the wire fixture, `demo-`marked in the data,
   with the retirement tripwire test. N is pinned at Gate 7.5 by measuring a real self-update restart.
5. **Failure counting means what its name says.** `nextConnection`'s tick gains one optional
   `resumed` input (a visibility pause breaks the 3 s cadence the streak is a claim about); demo
   state lives in a **sibling** pure `nextDemo(prev, tick)`, not inside `nextConnection`, and
   `nextDemo` takes the **same `resumed` flag and resets `consecutiveUnreached` too** — a reset that
   moves one counter and not the other is the defect this item exists to prevent. Two reasons
   for the sibling: `nextConnection` is REQ-131's three-tag oracle and every tag test pins it, and
   REQ-143 is scheduled for deletion — a sibling function is deleted in one line, a widened reducer
   has to be un-widened, which is the exact defect class B-S4 exists to prevent.
6. **`/api/system`: constant `topN` raised to 20 at the route** (`system_info` keeps 5 — free,
   measured); row shape stays `comm`-only, never argv/cwd/env/uid; full disk `path` kept (already on
   the wire; hiding it in the UI is theatre); counts composed at the route from COUNT accessors with
   their definitions written down. The unauthenticated-recon consequence of `bind: 0.0.0.0` is an ADR
   consequence + a DEPLOY line, **not** a re-litigated auth gate (Won't-have D1, v24 H-1).
7. **`/api/models`: one additive per-row `catalogSource`**, no new route, no `supported_parameters`
   re-export; the `—` honesty columns are tested as a **rule** (fixture with / fixture without), never
   as this iteration's absence.
8. **Derivation in `lib/`, DOM in `ui/`, disclosure rows for all three routes, every string in both
   languages in one edit, one-line `https:`-only link invariant on the Issues tab** (A-10, unchallenged).

## remaining disagreements (with the fact that decides each)

1. **`GET /api/models/status` (their B-O1).** *Discriminating fact:* REQ-137's acceptance text, read
   verbatim, contains no provider-health, catalog-source or tag clause. If the orchestrator or owner
   rules that 「模型與系統資源不好查」 (Round-1) is a live acceptance obligation rather than context,
   the route is justified and I withdraw. **If it is added, two amendments are not optional:**
   (a) the failure `reason` must be a **closed token set**, never the upstream error string — that
   string can carry the LiteLLM base URL, an internal host, or a key-bearing query; (b) prefer
   amending the **existing** unauthenticated `/api/status` (`server.ts:1346-1356`) over a new route —
   with the cost stated honestly: `/api/status` is also the self-update health surface and a
   `degraded` key there is read by `classifyResponse` as a route degrade, so `val-079` and the
   self-update path must be checked first.
2. **`supportedParameters` on the wire (their B-C2).** *Discriminating fact:* whether 「支援參數」 in
   REQ-137 means "the parameters this model supports, as the wire knows them" (my reading — the
   `*Declared` projection, which the clause's own neighbours 工具/effort already name) or "OpenRouter's
   `supported_parameters` array" (theirs). This is a text reading, not an engineering call: the
   orchestrator should rule. Both shapes are one field apart; only the bounded form may ship.
3. **`lib/views.js` registry (their B-R2).** *Discriminating fact:* `tests/unit/static-assets.test.ts:50-71`
   is already closed both ways, so lesson 6 is already red-on-failure. Unless someone shows a lesson-6
   variant that test does **not** catch, the registry is refactor scope inside a sprint that already
   rewrites three files.
4. **Per-URL vs per-tick demo substitution.** I consider this settled by the mixed-paint sequence
   above, but it is their clause, so I name it: if they hold the per-URL form, the discriminating
   test is `{describe: ok, runs: fail}` under `demoActive` — it must produce **zero** demo bodies.
5. **Unresolved inside my own lens, carried from r1 unchanged.** The security-maximal answer to the
   unauthenticated `/api/system` recon surface is an auth gate, and Won't-have D1 plus the v24 H-1
   adjudication forbid one this iteration. Naming the conflict is the deliverable; overriding an
   owner constraint from inside an architecture gate is not. Bounding the content (item 6) is the
   honest control that remains, and B-C1's closed key-set row is what keeps it bounded over time.

## risk delta from r1

- **R1 (silent bundle break)** — unchanged in severity, but now covered on both sides: the existing
  closed-both-ways asset test plus B-S4's demo allowlist. The residual risk is forgetting to *run*
  them in the same pass.
- **R2 (demo leaking into live rendering)** — **raised to the sprint's top correctness risk** and
  given a concrete trigger this round (two-route view mid-recovery, per-URL substitution). Mitigated
  by all-or-nothing-per-tick, and by the fact that in demo mode every surface is demo or Unavailable.
- **New: demo on a healthy engine** — the 404 path, conceded to B-S2, closed by `reached`; the
  transient-blip-across-a-pause path stays open unless my `resumed` reset ships **as well**. Their
  predicate and my reset close different false positives; neither subsumes the other.
- **New: an emergent safety margin.** The ~9 s demo entry lag derived from statement order in
  `tick()` is not an invariant. Replaced by an explicit `N`, measured against a real self-update
  restart at Gate 7.5.
- **R3 (recon surface permanent once shipped)** — unchanged; `topN` is now settled as a constant per
  caller, so the cap is chosen at Gate 2 as R3 demands, with no knob to widen later.
- **R4 (poisoned SPEC_ROWs)** — extended by two new instances found this round: a stamp-only
  assertion (B-O3) and the frozen-page visibility oracle (B-S1). Both are now explicitly demoted to
  secondary/forbidden.
- **R7 (scheduling)** — this round is deliberately table-shaped so the synthesis step is cheap.
