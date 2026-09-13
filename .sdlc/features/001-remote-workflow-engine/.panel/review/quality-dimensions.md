# Gate 8 architecture-consistency review — Quality-dimensions lens (v27)

- **Lens:** Quality-dimensions expert — Observability / Replaceability / Consumability / Self-sustainability
- **Iteration:** v27 (REQ-131..136, REQ-140, REQ-141; ARCH-122..131, ADR-049..056, INV-V27-1..9)
- **Compared:** `02-architecture.md` §"v27 slice" (lines 3315–3766) against `06-impl-log.md` IMPL-221..268 and the files those entries list (plus `src/dashboard/lib/status.js`, which is on no IMPL `files:` line but is a key in `static-assets.ts:22`).
- **Method:** every in-scope file read in full; each claim below was re-checked against the working tree at `ef0a400` (line numbers are from that tree). Three claims were reproduced with `node` rather than read (QD-O1, QD-O4).
- **Verdict:** `consistent: no` — 15 numbered deviations (1 HIGH, 7 MEDIUM, 7 LOW). Findings without an ARCH/INV/ADR anchor are listed as uncounted observations.

Severity key: **HIGH** = an architecture decision's chosen control does not deliver the property the decision was taken for; **MEDIUM** = a stated `api:`/boundary/invariant clause is not what shipped, with an operator-visible or test-visible consequence; **LOW** = a clause deviation whose consequence is bounded or cosmetic.

---

## 1. Observability — transparency of internal state

The owner's stated first motive for v27 is observability (02-architecture.md §"Altitude split": 「以觀測性為主」), so this dimension is graded as the requirement, not a side-constraint. The engine-side seams the architecture asked for are present and correct (see "verified consistent"); the deviations are all on the client's *honesty* path — the places where a degraded or stale state must be shown as such.

### QD-O1 — MEDIUM — A degraded `/api/runs` body is handed to the view as data, throws before the connection reducer runs, and the tag freezes; the "worst state among the visible view's routes" clause has no implementation
- **Violates:** ARCH-124 `api:` (`connection.js`: "a route answering 200 with a `degraded` string → `degraded` for that route and for the tag when it is the worst state among the routes the visible view depends on"); ARCH-125 `api:` (`getJSON` classifies a degraded body "never an exception and never rendered as data"); NFR-ownership paragraph ("connection / degraded honesty → ARCH-124 … fed by ARCH-125's one `getJSON` classifier").
- **Evidence:**
  - `src/dashboard/ui/poll.js:42-55` — `getJSON` classifies correctly but returns the degraded body unchanged; `src/dashboard/ui/app.js:346-350` stores `bodies[url] = res.body` for every status and hands the whole map to the view at `:352` **before** `nextConnection` runs at `:356`.
  - `src/server.ts:615` — the degrade catch answers `/api/runs` with `buildDashboardModel([], undefined, undefined, msg)` = `{"runs":[],"degraded":"…"}` (an object, where the success path returns an array, `:389`).
  - `src/dashboard/ui/workflow.js:227-229` — `nameFilteredRuns(allRuns, name)` does `(allRuns || []).filter(...)`; on the object above this throws `TypeError: (allRuns || []).filter is not a function` (reproduced with `node`). The throw propagates out of `onTick` (`:345`), `tick()` rejects, `app.js:355-358` never executes, and the nav tag keeps whatever it said last (typically `live`).
  - `src/dashboard/lib/connection.js:26-31` — any `ok` in the tick returns `live` outright; `worstOf` (`:9-15`) has no caller, and `perRoute` is written at `app.js:112,356` but never read (`grep -rn worstOf\|perRoute src/dashboard` → only the initialiser). So on the workflow view, describe `ok` + runs `degraded` = tag `live` (reproduced: `nextConnection(s,{results:{a:'ok',b:'degraded'}}).status === 'live'`).
  - Milder sibling: `src/dashboard/ui/home.js:226-228` renders a degraded `/api/home` body as zero cards (`body.running || []`) — "no workflows" instead of "degraded".
- **Failure scenario:** the store read fails while a teammate has `/dashboard/workflow/<name>` open → the server logs `dashboard_api_degraded` (correct), the page silently stops updating, and the source tag still reads 連線中/Live. This is the exact "silent HTTP 200" the NFR-ownership paragraph says ARCH-124/125/130 exist to close — closed on the server, reopened on the client.
- **Note:** ARCH-124's `api:` line carries both "any `ok` → `live` immediately" and the worst-of clause; DES-202 implemented the first and left the second with no code. Either the ARCH clause or the implementation needs to change; the crash and the pre-reducer throw are defects regardless of which.

### QD-O2 — MEDIUM — The three ported tabs poll once at mount while the hidden Workflows panel keeps polling; the new footer clock says "Updated HH:MM:SS" every 3 s over data that has not been refetched
- **Violates:** ARCH-125 `api:`/`note:` ("`endpointsFor(view)` — the fetch set of the VISIBLE view only"; "Per-view fetch scoping is the polling budget: the visible view's endpoints only, on the one timer"); README "Header / chrome" as implemented by IMPL-255 (the footer's freshness claim).
- **Evidence:**
  - `src/dashboard/ui/app.js:163-174` — `activateTab` lazy-imports the tab module and calls `mod.render(panel, {}, {})` exactly once (`panel.dataset.mounted` guard); `currentView` is not changed, so `tick()` (`:338-341`) keeps calling `endpointsFor('home')` → `/api/home` for the now-hidden Workflows panel and never `/api/models`/`/api/system`/`/api/issues`.
  - `src/dashboard/ui/models.js:67-69`, `system.js:84-87`, `issues.js:114-120` — `render()` calls `onTick()` once "for first paint since nothing else calls it yet"; each file's own banner admits the join to the app-wide tick is pending. `poll.js:24-26` lists their routes but nothing selects them.
  - `src/dashboard/ui/app.js:131-135,359` — `updateFooterClock()` runs at the end of every tick unconditionally ("whether or not it changed anything").
- **Failure scenario:** an operator opens the System tab to watch memory during a run; the table is the mount-time sample forever, while the footer advances `Updated 14:02:33 → 14:02:36 → …`. The freshness signal is false for three of four tabs. Clause (a) is the ARCH-125 budget rule; clause (b) is a v27-introduced observability lie — neither is REQ-137/138/139 scope (those are the tabs' *content*; the poll owner is ARCH-125's).

### QD-O3 — MEDIUM — INV-V27-5's lock covers the data island and the pure model, not the rendered panel
- **Violates:** INV-V27-5 ("the v27 shell renders `version`, the last-update outcome and the interrupted-runs call-to-action from the data island … One test asserts all three are reachable in the rebuilt page"); ARCH-122 `note:` (1).
- **Evidence:** the render path is `src/dashboard/ui/app.js:81-109` (`buildUpdatePanel`) over `src/dashboard/lib/status.js:22-39` (`updatePanelModel`). `tests/unit/update-outcome-config-check.test.ts` (UT-241) asserts the pure model and, per IMPL-223, the JSON island emitted by `buildDashboardHtml()`. No test in `tests/` references `.rwe-update-panel`, `.rwe-version`, `.rwe-update-outcome` or `.rwe-update-cta` except the class fixture (`grep -rln` → `tests/fixtures/dashboard-classes.ts` only); `val-198` asserts theme/hue/lang/segments/search/sweep, not the update panel; `val-079` reads `/api/status`, not the page.
- **Failure scenario:** the exact one INV-V27-5 names — `buildUpdatePanel` regresses (e.g. a future `buildChrome` rewrite drops the `nav.appendChild(buildUpdatePanel(...))` at `app.js:198`), every test stays green, and the first person to notice is an operator who does not see that a self-update failed.

### QD-O4 — LOW — A 404 is classified as a connection failure; two 404 ticks paint the nav tag "Offline" while the engine is up
- **Violates:** ARCH-124 `api:` (`offline` "only after ≥ 2 consecutive all-`fail` ticks — REQ-131 says 連續失敗; one transient miss during a self-update restart must not paint the whole team's tabs red") — the clause's semantics are connectivity, and a 404 is a successful round-trip.
- **Evidence:** `src/dashboard/lib/connection.js:40` (`status < 200 || status >= 300 → 'fail'`), reproduced: `classifyResponse(404, {error:'Run not found'}) === 'fail'`, and two such ticks → `status === 'offline'`. Reachable from the shipped page: a bookmarked or shared `/dashboard/<runId>` (the legacy-compatible route `app.js:415` keeps on purpose) whose run has since been swept by catalog/run GC, or a mistyped id → `/api/runs/<id>/dag` and `/api/runs/<id>` answer 404 (`server.ts:490`, `:604`) → two ticks → 離線/Offline. The run view also shows nothing for a missing run (`run.js:495-500` paints an empty graph; no "Run not found" text).
- **Consequence:** the tag tells the team the engine is unreachable when it answered; the two states an operator most needs to tell apart are merged.

### QD-O5 — LOW — The agent panel discards the fetch status and the server's error text; a failed detail fetch renders an empty-but-plausible panel
- **Violates:** ARCH-125 `api:` (`agent-panel.js` "REQ-135: … the red `detail` block") read with the Altitude-split paragraph ("the slide-in panel IS the agent's inspectability") and this lens's rule that a silent failure is a design defect.
- **Evidence:** `src/dashboard/ui/agent-panel.js:233-241` — `res.status` is never read; on a 404 the server's `{error:'Agent not found: …'}` (`server.ts:594-597`) is dropped and a synthetic `record` with `state:''` is rendered; `body.degraded` is never rendered either. Six stat cards of `—` are indistinguishable from an agent with no data.

### Observations (uncounted — no ARCH clause decides them)
- ARCH-129/DES-195: when the gateway echoes something other than the composed prompt, `stripFirstSegment` fails closed to `prompt: ''` and the only witness is a server-side `harness_prompt_prefix_mismatch` log line (`src/agent-executor.ts:651-654`); the persisted descriptor carries no field saying the prompt was withheld, so the panel cannot distinguish "empty prompt" from "prompt withheld on mismatch". Fail-closed is the right default; the seam is observable only in the journal.
- `predictedLanes` (`src/dashboard.ts:292-302`) returns `[]` on `!derived.ok` with no log line, so a describe-side derivation failure has no journal witness (the DAG route's equivalent arm logs `dashboard_api_degraded`, `server.ts:557`). ARCH-131/ADR-055 deliberately give absence one meaning; noting the asymmetry only.

### Verified consistent (Observability)
- ARCH-130 (4): `dashboard_api_degraded` emitted at both degrade catches (`server.ts:615`, `:1103`) and at the two `PREDICTED_OVERLAY_UNAVAILABLE` arms (`:524`, `:557`, `:565`) with the closed reason set; the FALLBACK arm does not log (`:517`), as specified.
- ARCH-125 v27b amendment: warnings rendered as TEXT via `warningText` (`run.js:352-359`, `lib/strings.js:56-71`); `?limit=500` + 「顯示 N / 共 N+」 marker (`agent-panel.js:233`, `:214-221`); 2 KB per-row clip with expand (`:37`, `:96-111`).
- ARCH-123: `dashboard_asset_missing` logged once at module load (`static-assets.ts:51-53`).
- ARCH-127: `usage_backfill` / `usage_backfill_failed` lines (`run-manager.ts:876`, `:873`).
- Agent altitude: the panel is a projection of the RECORD — `record.provider`/`transport`/`proxyModel` reach the model line (`lib/agent.js:28-34`), hung-vs-progressing from `lastActivityAt` (`:47-57`), `effortApplied` on both branches (`:38-42`), and the system-prompt FACT sentence distinguishes "applied, N bytes" from "no record" (`:62-70`). The agent's tool-call sequence is inspectable through the same facade call on both transports (`server.ts:592`, MCP `run_agent_log`).

---

## 2. Replaceability — decoupling and pluggability

v27's replaceability decision is a *boundary*: `src/dashboard/lib` is the pure, vitest-imported core holding "every decidable behaviour in the client", and `src/dashboard/ui` is "left with nothing but wiring" (ARCH-124 `note:`, ARCH-125 `note:`). The LLM-backend seam is untouched by this slice (no gateway file is on any v27 `files:` line) and remains config-selected; the findings below are all about where that client boundary actually fell.

### QD-R1 — MEDIUM — `lib/clock.js` puts an impure wall-clock read inside the directory ARCH-124 declares pure and total
- **Violates:** ARCH-124 `api:` ("every export pure and total, no DOM, no `fetch`, no import outside this directory"); ARCH-125 `note:` (I/O belongs to the layer that "may read the DOM and call `fetch`").
- **Evidence:** `src/dashboard/lib/clock.js:10` — `export const clockNow = () => new Date().toISOString();`, added by IMPL-247 as the "named clock seam" and imported by `ui/agent-panel.js:34,242` and `ui/workflow.js:39,212`. IMPL-243 records that TASK-207's DoD command is `grep -rn "Date\.now()\|new Date()" src/dashboard/lib` and that it was scrubbed to 0 hits by rewording a comment; that same command now returns `clock.js:10`. `lib/connection.js:2-4` still advertises "no system-clock read" for the directory.
- **Consequence:** the property that made `lib/` swappable and deterministic (import the shipped bytes into vitest, no mocking) now has one exception the guard grep was written to forbid. The seam is correct in kind; it belongs in `ui/` (the composition-root layer), one directory up.

### QD-R2 — MEDIUM — Decidable logic lives in `ui/*.js`, and IMPL-249 excluded those files from the coverage denominator on ARCH-124's premise that none does
- **Violates:** ARCH-124 `note:` ("after v27 that is *every decidable behaviour in the client* — the DOM layer above it (ARCH-125) is left with nothing but wiring"); ARCH-125 `note:` ("it may not decide anything a pure function could decide — every formula it needs is imported from ARCH-124"); ADR-049 consequence ("the client modules are not type-checked … accepted — they are small, pure and unit-tested").
- **Evidence (decisions and formulas with no `lib/` home, hence no unit tier):**
  - `src/dashboard/ui/workflow.js:62-75` `predictedPayload` (describe → DAG-shaped payload, including the "agents absent on every phase = unavailable" rule), `:227-229` `nameFilteredRuns`, `:233-238` `resolveSelectedRunId` (active-else-newest selection), `:50-55` `triggerLabel`.
  - `src/dashboard/ui/home.js:44-50` `formatDuration` (a second copy of `lib/runlist.js:54-63`'s private formatter, now *exported and imported by `run.js:88`*), `:54-60` `fmtLastRunAt`, `:62-74` `metaLine` (the `runs = terminalCount + (activeRunId ? 1 : 0)` arithmetic).
  - `src/dashboard/ui/run.js:126-128` `toSwimlaneCell` (server `col/row` → client `lane/slot`), `:139-151` `cellClassName`/`edgeClassName` (state → class decisions), `:311-314` the REQ-134 row-2 join rule (`rec.model || declared.model.default`; effort from declared only).
  - `src/dashboard/ui/agent-panel.js:46-50` `fmtClock`, `:76-80` `eventKindCategory` (six wire kinds → three CSS categories, a decision the file's own comment calls "this task's own resolved-and-surfaced decision"); `src/dashboard/ui/system.js:38-43` `fmtBytes`.
  - `06-impl-log.md` IMPL-249: "`src/dashboard/ui/{…}.js` are EXCLUDED from the UT/IT line-coverage denominator. These files' own module banners already state their contract is DOM construction with no server-testable logic of their own (`lib/*.js` carries every pure decision, ARCH-125's boundary)".
- **Consequence:** the boundary the architecture drew is not where the code is, and the coverage gate's exclusion rests on the ARCH sentence rather than on the files. QD-O1's crash (`nameFilteredRuns`) lives in exactly this untested layer. Replacing the DOM layer (or the swimlane substrate again, as v27c did) means re-deriving these rules, which is the mirror/drift class ADR-049 was chosen to shrink.

### QD-R3 — MEDIUM — The "one string table in two languages" decision shipped as a five-key table plus literals in nine files, including zh-only and en-only strings
- **Violates:** ARCH-124 `api:` (`strings.js` — `STR = { zh, en }` and `t(lang, key)`; key-parity test); ARCH-125 v27b amendment ("REQ-131 forbids literals scattered across the view"); Decision rationale — v27b, "Warning spelling" ("REQ-131 requires every visible string to come from ONE string table in two languages").
- **Evidence:** `src/dashboard/lib/strings.js:16-31` holds five keys. Outside it, in files inside this closure: 17 `lang`-conditional UI-copy sites (counted after excluding the `currentLang()` normalisers, the `lang` attribute stamp and the 中/EN button label) — `run.js:246,367,390`, `agent-panel.js:105,188,189,217`, `workflow.js:180,182,183`, `home.js:71`, `lib/runlist.js:21,62`, `lib/agent.js:55,56,65,69`; per-file private tables `app.js:28-42 LABELS`, `home.js:16-38 LABELS`, `workflow.js:42-45 COLUMNS`, `lib/status.js:13-16 CTA`; and English-only fallbacks at `app.js:170,387` (`"… unavailable"`). CJK literals appear in nine files in all. The ported tabs add untranslated copy too (`system.js:29` `UNAVAILABLE = '無法取樣'` zh-only; `models.js:56,58`, `issues.js:24,70,72` en-only) but those files belong to REQ-137/138/139, outside this closure, and are listed for completeness, not as this finding's evidence. The ARCH-124 key-parity test therefore guards 5 of the page's strings.
- **Consequence:** swapping or adding a language is an edit across ten files with no lock; the C3 guard that made `strings.js` the safe home for the retired word has no reach over the other nine.

### QD-R4 — LOW — The nine-column history table is a two-file mirror pair (headers in `ui/`, values in `lib/`)
- **Violates:** Decision rationale — v27, "The server/client mirror pairs" ("an eighth mirror must not appear silently"; "the mirror class shrinks instead of growing").
- **Evidence:** `src/dashboard/ui/workflow.js:42-45` `COLUMNS` (zh/en header arrays) must stay in positional lockstep with `src/dashboard/lib/runlist.js:70-83` `historyRow` (value array); nothing ties the two lengths or orders together.

### QD-R5 — LOW — The shell ships pre-v27 markup that `app.js` discards wholesale; the real shell is built in JS
- **Violates:** ARCH-122 `api:` (the shell "now holds markup and CSS only: … the nav with the source tag, the four tab shells, the `#dag-zoom`/`#dag-graph`/`#dag-fit` anchors, `#run-usage`, … and the slide-in panel's empty container"); ARCH-122 `note:` ("this module assembles bytes; it decides nothing").
- **Evidence:** `src/dashboard-page.ts:92-151` emits a `<header>` with "Runs"/"Issues" links (`/dashboard/issues` — see QD-O4), `#home-running/#home-registered/#home-other`, `#system-panel`, `#models-panel`, a `#detail` section with `#tree`, `#transcript`, `#harness-table`, and a `#issues` section — none populated by any v27 module. `src/dashboard/ui/app.js:427` runs `document.body.replaceChildren(nav, routeMount, buildFooter())`, so the served markup is visible only when the module script fails. The tab shells, the C2 anchors and the panel container ARCH-122 attributes to the shell are all created in `run.js:395-436`, `workflow.js:77-176`, `agent-panel.js:120-226`.
- **Consequence:** two shells, one dead; page-source pins on `DASHBOARD_HTML` assert markup no user sees, and a no-JS fallback that links to a route the SPA misreads.

### Verified consistent (Replaceability)
- ADR-049: plain ESM served from the map, `vitest` imports `src/dashboard/lib/*.js` directly (`tests/unit/dashboard-lib-*.test.js`); `tests/fixtures/dashboard-wire.ts` exists, `satisfies` the route types, and is imported by the `.js` tests (`dashboard-lib-agent.test.js`, `dashboard-lib-strings.test.js`).
- ARCH-124 amendment: no `accentVars()` JS mirror; the ramp is CSS-native over `--rwe-hue` (`dashboard.css:38-82`); `theme-init.js`'s three key literals are the one accepted, text-tested mirror (`theme-init.js:5-7`).
- Decision rationale — v27 "mirror pairs": `SWIMLANE_BOX` has one home (`lib/swimlane.js:6`); the server emits logical `col`/`row` only (`dashboard.ts:436-438`).
- ARCH-127/128 seam: the manager owns live, the store owns at rest, joined only in `listSummaries()` (`run-manager.ts:823-877`); `InMemoryRunStore` parity (`run-store.ts:372-379`, `:416-428`).
- Agent altitude: v27 touches no gateway; `_invokeOnce` still dispatches through `this._gateway.invoke(...)` (`agent-executor.ts:718`) with the backend chosen by config; the descriptor decoration is gateway-agnostic (ARCH-129 `note:` — "the split belongs to the executor, not to a gateway").

---

## 3. Consumability — interface friendliness and integration cost

Every v27 wire delta is typed (`AgentLogView`, the four `RunSummary` fields, `HarnessDescriptor.systemPrompt`, `types.ts:358-376`, `:483-550`, `:569-576`), the MCP tool descriptions name the new fields (`tool-specs.ts:335`, `:614-615`), and the same facade call serves both transports (`server.ts:592`). The one HIGH in this review is here: the control ADR-054 chose *instead of* a projection module does not check what it says it checks.

### QD-C1 — HIGH — The ADR-054 / INV-V27-7 key-set lock is asserted against a fixture literal, never against a served body
- **Violates:** ADR-054 (decision (b): "the key-set test alone makes a widening a decision … `tests/integration/dashboard-disclosure.test.ts` enumerates the key set for every `/api/*` route … the test's SHAPE (an exact set equality that fails on additions) is the thing that may not be relaxed"); INV-V27-7 ("every `/api/*` response's top-level key set is enumerated in one test whose SHAPE … may not be relaxed"); INV-V27-9's own scoping sentence ("a field that leaks identically on both servers is INV-V27-7's job").
- **Evidence:**
  - `tests/integration/dashboard-disclosure.test.ts:36-43` — the `it` is titled "… against the fixture itself"; it iterates `DISCLOSURE_TABLE` and checks `Object.keys(row.body)` where `row.body` is a **static literal** from `tests/fixtures/dashboard-wire.ts:47-131` (`AGENT_LOG_OK`, `RUN_SUMMARY_PRICED`, `DAG_PAYLOAD`, `DEGRADED_BODY` …). No HTTP call and no facade call feeds this block; the server booted at `:71+` serves only the REQ-136 body check.
  - The fixture rows are typed `satisfies`/annotated against the route types (`dashboard-wire.ts:3,47,55,66`), so `tsc` catches a *type* drift; an **optional** field added to `AgentLogView`/`RunSummary` and populated at runtime never touches the fixture, and a field that reaches the wire without a type change (a `...view` spread in `server.ts`) is invisible to both.
  - Live top-level key-set assertions exist only for `GET /api/runs/:id/dag` (`tests/integration/dag-masking-auth.test.ts:261`, INV-V27-9's parity block) and, as a transport-parity (HTTP ≡ MCP, not an allowlist) check, for describe (`tests/integration/workflow-describe-auth-gate.test.ts:289`). `grep -rnE "expect\(Object\.keys" tests/integration` finds no other.
  - IMPL-233's own caveat describes what the table proves as the types ("this entry's own scope is the TYPES only").
- **Failure scenario:** add `principal?: string` to `AgentLogView` and set it from `stored.principal` in `runAgentLog` → `tsc` green (optional), `dashboard-disclosure.test.ts` green (the fixture never gained the key), no other test reads that route's key set → the widening ADR-054 promised to make "a decision" ships silently on an anonymous route. ADR-054 rejected the projection module because the test "deliver[s] the identical property"; as shipped it does not.
- **What does hold, stated fairly:** the six rows match ADR-054's v27b budget rule (only the widened endpoints owe a row), `keys ⊆ ALLOWED` does fail on an undeclared addition *to the fixture*, and the REQ-136 half of the file is a real-body check on both transports (`:114-129`). The gap is precisely "fixture, not served body".

### QD-C2 — LOW — The HTTP agent-detail `limit` is uncapped, and the MCP schema does not advertise the paging the response's `hasMore` implies
- **Violates:** ARCH-125 `note:` ("the agent panel requests `?limit=500` (the engine's own cap decides)") — no engine cap exists.
- **Evidence:** `src/server.ts:588-590` passes any positive `limit` through; `src/mcp-facade.ts:706` `const cap = a.limit ?? 50;` with no upper bound. `src/tool-specs.ts:616` advertises `run_agent_log` as `{runId, label}` only, so a cold model that receives `hasMore: true` has no advertised way to fetch more (pre-existing shape; the v27 `?limit=500` client and the ARCH sentence assume a cap that was never built).

### QD-C3 — LOW — The regenerated tool-surface document's `run_agent_log` row does not show the v27 fields
- **Violates:** ARCH-131 / the v27 API-contracts table (the `record` and `harness.systemPrompt` delta is "one facade call, two transports, same delta"); IMPL-241's own recorded, unwaived DoD gap.
- **Evidence:** `.sdlc/features/001-remote-workflow-engine/v24-tool-surface.md:22` (regenerated at `9812645`) truncates the observed body at ~300 chars inside `harness`, before `record`/`systemPrompt` would serialise; `grep -oE '"record"|"systemPrompt"'` on that line → none. The only generated, machine-readable description of the tool surface therefore does not document the v27 contract change that ADR-050 calls "breaking for any caller that read it".

### Verified consistent (Consumability)
- ARCH-131: `record` on the success branch only (`mcp-facade.ts:713`); `phases[].agents` unconditional, joined by ordinal, absent only when no lane derived (`:498-503`).
- ARCH-129/ADR-050/INV-V27-2: content never captured — strip (`agent-executor.ts:651`) → `redact()` (`:684`) → `capPrompt` (`:687`); `systemPrompt {agentType, bytes}` (`:666`); the wire prompt to the model unchanged (`composePrompt`, `:580`); proven against the response BODY on both transports (`dashboard-disclosure.test.ts:71-129`); tool description updated (`tool-specs.ts:614-615`).
- ARCH-127/ADR-052: the four `RunSummary` fields omitted together (`run-manager.ts:269-280`, `sqlite-run-store.ts:264-270`); `agentCount` omitted for the legacy cohort (`run-manager.ts:869`); README rows per IMPL-231/241.
- ADR-049: the `.js` client's inputs are pinned by a TS fixture the tests import (above).
- Agent altitude: structured, typed I/O — `AgentLogView` is one declared type consumed by MCP and HTTP alike; the panel VM is a pure function of it (`lib/agent.js:72-92`).

---

## 4. Self-sustainability — closed-loop autonomy and lifecycle

v27 adds no new service and no new state (ADR-051 rationale: "adds NO state … only per-request CPU"); its self-sustainability decisions are the one-time bounded backfill, `no-store` on client bytes so a self-update cannot strand a stale client, immutable caching for the vendored fonts, and long-lived-tab hygiene. The first two hold; the last two do not.

### QD-S1 — MEDIUM — The vendored fonts are served with `Cache-Control: immutable` alone, which is not the policy ARCH-123 wrote
- **Violates:** ARCH-123 `api:` ("Cache policy is split on purpose: **woff2 → `public, max-age=31536000, immutable`** (the bytes never change under a name); **JS/CSS → `no-store`**").
- **Evidence:** `src/static-assets.ts:42-44` yields `cache: 'immutable' | 'no-store'`, and `src/server.ts:1312` writes `'Cache-Control': entry.cache` verbatim, so a woff2 response carries the bare token `Cache-Control: immutable`. RFC 8246 defines `immutable` as a modifier of an explicit freshness lifetime; with no `max-age` (and no `public`) there is no lifetime for it to modify, so the header does not express the year-long immutable policy the ARCH specified. `tests/integration/static-assets-route.test.ts:70` asserts `toContain('immutable')` and `tests/unit/static-assets.test.ts:38` asserts the literal `'immutable'`, which is what let the bare token through.
- **Consequence:** the ~300 KB of fonts ARCH-123 vendored "behind a fixed map" are refetched on every navigation/reload subject to heuristic caching rather than the stated policy; over the one-team tunnel this is the cost ARCH-123's split was designed to avoid. The `no-store` half (JS/CSS never stale after a self-update) is correct.

### QD-S2 — LOW — Every route mount adds window-level listeners and a blob URL that are never released; the view contract has no teardown
- **Violates:** ARCH-125 `note:` ("listeners are delegated on the stable wrappers — a tab left open for days must not accumulate one handler per node per 3-second rebuild"; "page weight and long-lived-tab hygiene → ARCH-125").
- **Evidence:** `src/dashboard/ui/run.js:114-118` — `initZoomable` registers `mousemove`/`mouseup`/`resize` on `window`, each closing over the zoom element; it runs on every `render()` (`:434`), and `workflow.js` runs it twice per mount (`:119`, `:172`). `app.js:375-392` `mountLazy` does `container.replaceChildren()` with no unmount hook (DES-206's contract is `render`/`onTick` only), and the language toggle remounts the whole app (`app.js:274`). `workflow.js:248,274` revoke the diagram blob URL only when it is replaced, never on navigation away. Per-tick rebuilds are fine (old nodes and their listeners are collected); the leak is per navigation/remount, which over days of use is the class the clause names.

### Verified consistent (Self-sustainability)
- ARCH-127/128: `BACKFILL_PER_TICK = 25` (`run-manager.ts:285`, `:825-841`); a zero-record legacy row is memoised so it is not re-walked forever (`:317-328`, `:850-857`); a failed heal is retried, never memoised (`:872-875`); `backfillUsage` is a no-op unless terminal and usage-less, re-checked inside both stores (`sqlite-run-store.ts:310-321`, `run-store.ts:372-379`); one `LEFT JOIN` per list, never N+1 (`sqlite-run-store.ts:326-357`).
- ARCH-123: JS/CSS `no-store` so a self-update restart cannot leave a cached old client against a new `/api/*`; `readStaticAsset` cache bounded by the closed key set (`static-assets.ts:63-75`).
- ARCH-125 amendment: one self-rescheduling `setTimeout` armed in `tick().finally` with a generation guard against stale loops (`app.js:362-373`); the `workflow` view's two independent fetches overlap (`:346-350`).
- ARCH-130 (2)/(4): a derivation fault degrades to an empty overlay plus a warning and a journal line, never a 500 (`server.ts:519-566`); the pre-approved once-per-`(runId, reason)` flood guard is not built and was not required.
- Agent altitude: memory metabolism, tool-liveness probes and prompt self-calibration are not in this closure and no v27 ARCH row claims them; the run-level self-healing that is in closure (the usage backfill) converges by construction (ARCH-128 `note:` (1)).

---

## Summary table

| # | Sev | Dimension | Anchor | Where |
|---|---|---|---|---|
| QD-C1 | HIGH | Consumability | ADR-054, INV-V27-7 (and INV-V27-9's scoping) | `tests/integration/dashboard-disclosure.test.ts:36-43`, `tests/fixtures/dashboard-wire.ts:125-131` |
| QD-O1 | MEDIUM | Observability | ARCH-124 `api:`, ARCH-125 `api:` | `ui/app.js:346-358`, `ui/workflow.js:227-229`, `lib/connection.js:9-31`, `server.ts:615` |
| QD-O2 | MEDIUM | Observability | ARCH-125 per-view polling; IMPL-255 footer | `ui/app.js:163-174,338-360,359`, `ui/models.js:67-69`, `ui/system.js:84-87`, `ui/issues.js:114-120` |
| QD-O3 | MEDIUM | Observability | INV-V27-5, ARCH-122 note (1) | `ui/app.js:81-109`; no test references the rendered panel |
| QD-R1 | MEDIUM | Replaceability | ARCH-124 purity | `lib/clock.js:10` |
| QD-R2 | MEDIUM | Replaceability | ARCH-124 note, ARCH-125 note, ADR-049 | `ui/workflow.js:62-75,227-238`, `ui/home.js:44-74`, `ui/run.js:126-151,311-314`, `ui/agent-panel.js:46-80`; IMPL-249 |
| QD-R3 | MEDIUM | Replaceability | ARCH-124 `strings.js`, ARCH-125 v27b amendment | `lib/strings.js:16-31` vs 17 lang-conditional copy sites / 9 files; `ui/app.js:28-42`, `ui/home.js:16-38`, `ui/workflow.js:42-45,180-183`, `lib/agent.js:55-69` |
| QD-S1 | MEDIUM | Self-sustainability | ARCH-123 cache policy | `static-assets.ts:42-44`, `server.ts:1312`, `static-assets-route.test.ts:70` |
| QD-O4 | LOW | Observability | ARCH-124 `offline` semantics | `lib/connection.js:40`, `dashboard-page.ts:95`, `ui/app.js:415` |
| QD-O5 | LOW | Observability | ARCH-125 REQ-135 inspectability | `ui/agent-panel.js:233-241` |
| QD-R4 | LOW | Replaceability | v27 rationale "mirror pairs" | `ui/workflow.js:42-45` vs `lib/runlist.js:70-83` |
| QD-R5 | LOW | Replaceability | ARCH-122 `api:` | `dashboard-page.ts:92-151`, `ui/app.js:427` |
| QD-C2 | LOW | Consumability | ARCH-125 "engine's own cap decides" | `server.ts:588-590`, `mcp-facade.ts:706`, `tool-specs.ts:616` |
| QD-C3 | LOW | Consumability | ARCH-131 contract; IMPL-241 caveat | `v24-tool-surface.md:22` |
| QD-S2 | LOW | Self-sustainability | ARCH-125 long-lived-tab hygiene | `ui/run.js:114-118,434`, `ui/workflow.js:119,172,248,274`, `ui/app.js:274,375-392` |

**Counts:** 15 violations — 1 HIGH, 7 MEDIUM, 7 LOW. Two uncounted observations.

**Invariants verified consistent:** INV-V27-1 (`run-manager.ts:823-877`; lock `usage-live-equals-fold.test.ts:71`), INV-V27-2 (`agent-executor.ts:651-687`; live both-transport lock), INV-V27-3 (`dashboard-page.ts:88-89,153-154`, `server.ts:1332`, `dashboard.css:89-93`, `static-assets.ts:59-61`), INV-V27-4 (`dashboard.ts:292-302`, `mcp-facade.ts:498`), INV-V27-6 (`run.js:99-120`), INV-V27-8 (IMPL-238), INV-V27-9 (`dag-masking-auth.test.ts:261+`). **Partially held:** INV-V27-5 (data half only, QD-O3), INV-V27-7 (fixture only, QD-C1).

**Suggested routing (not decisions):** QD-C1 → Gate 5/6 (turn the six fixture rows into live-body assertions against the booted server the same file already starts; keep the fixture as the allowlist). QD-O1 → Gate 6 (`app.js` should hand a view only `ok` bodies, or views must guard; `worstOf` either wired or the ARCH-124 clause struck). QD-R1/R2/R3 → Gate 2 amendment or Gate 6, owner's choice: either the boundary sentences in ARCH-124/125 are corrected to what shipped, or `clock.js` moves to `ui/`, the listed formulas move to `lib/` with tests, and the string table absorbs the nine files. QD-S1 → one-line fix in `static-assets.ts` plus tightening the two `immutable` assertions to the full directive.
