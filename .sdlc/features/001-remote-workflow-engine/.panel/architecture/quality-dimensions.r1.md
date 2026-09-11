---
stage: architecture
lens: quality-dimensions
iteration: v27
round: 1 (independent proposal)
inputs: 01-requirements.md §Iteration v27 (REQ-131..143 + Round v27 log), state.yaml tech_stack, v27-gate0-asis-map.md, the handoff `.dc.html` (scratchpad copy; README.md and rwe-data.js were NOT on disk — README rows are taken from the REQ text), src/{dashboard-page,dashboard,server,mcp-facade,run-store,run-manager,run-guard,system-info,workflow-view,types}.ts, src/models/*, src/store/sqlite-run-store.ts, the test pins named in the as-is map
---
# Quality-dimensions proposal — v27 (Observability / Replaceability / Consumability / Self-sustainability)

## summary

v27 rebuilds the ONE served dashboard page (`src/dashboard-page.ts:98-737`, a 640-line template
literal holding CSS + HTML + client JS) to a high-fidelity Claude Design handoff, and adds three small
API deltas (REQ-140 `dag.lanes` + agent `record`, REQ-141 `RunSummary.costUSD`) plus one wire-level
redaction (REQ-136: the agentType system prompt leaves the agent-detail response). The owner's stated
first motive is **observability** ("以觀測性為主,但三者都要") — so this lens is not a side-constraint
in v27, it is the requirement, and the rebuild's success is measured by whether an operator can
answer "which agent is stuck, in which lane, on which backend, at what cost" in seconds.

**The single most important thing this proposal says: the handoff's client logic is a design-time
prototype, and three of its behaviours contradict the v27 acceptance text or the engine's own wire
contract. They must be re-derived at Gate 2/4, not transcribed.** (1) `Component.call()` in the
`.dc.html` never calls the API again once `source === 'demo'` — REQ-143's third clause ("引擎恢復可達
→ 下一次輪詢即切回真實資料") cannot be met by that state machine. (2) Every `/api/*` route in this
engine degrades to **HTTP 200 with a `degraded` string** (DES-018, `server.ts:1067-1071` and the
per-route catch the as-is map documents), never a 500 — the design has no `degraded` state, so a
degraded `/api/home` body (`{runs:[], degraded}`) reaches `h.running.filter(...)` and throws. (3) The
design flips the nav tag to Offline on ONE failed fetch; REQ-131 says 連續失敗 — one transient miss
during an engine restart must not paint the whole team's tabs red.

Four further calls, in descending confidence. **(a) REQ-141 is v26 R-1 again unless one accessor
serves both routes.** Today there are three usage producers — `foldUsage` over transcripts
(`run-guard.ts:47-72`), `foldUsageFromRecords` over live records (`run-manager.ts:242-258`), and the
terminal snapshot's stored `usage` (`run-manager.ts:1014`, read at `sqlite-run-store.ts:265-279`) —
and `listRuns` (`sqlite-run-store.ts:295-307`) is pure SQL with no usage at all. The list path must
read the same value `/api/runs/:id` reads, by construction, and carry `unpricedCalls` beside
`costUSD` (INV-V26-6: never a silent zero). **(b) REQ-136 should remove the CONTENT and keep the
FACT.** The descriptor should say "an agentType system prompt of N bytes was applied" so an operator
can distinguish "not shown" from "not applied"; the three tests that read `harness.prompt`
(`val-082:138-140`, `val-104:79-81`, `redact-sweep:309-340`) assert non-emptiness, ordering and
redaction — none asserts system-prompt presence, so no assertion needs weakening, but `val-104`
settles the open question: `appendPrompt` must stay visible. **(c) Two v27 gaps the REQs do not
name:** `supported_parameters` is deliberately destructured away at `model-catalog.ts:429` (v26 "one
name per fact"), so the design's "支援參數 tag" column has no wire source; and REQ-070's update panel
(version / last update / interrupted runs, injected by `buildDashboardHtml(init)` at
`dashboard-page.ts:58-87`) is named by no v27 REQ, so the rebuild can regress ARCH-040 without any
red test. **(d) The monolith should be split as DATA, not as a framework:** strings, theme ramps,
layout constants and the demo dataset become typed TS modules interpolated into one served page —
the pattern `MORANDI_PALETTE` / `DAG_BOX_DEFAULTS` already use (`dashboard-page.ts:514,518`) — with
no bundler and no CDN, which keeps every existing page-source test valid.

Five HIGH risks: demo mode as a mid-session replacement for real data (QD-R1), the `degraded` state
the client does not model (QD-R2), a second fold path for cost on the list route (QD-R3), the
REQ-070 panel regressing silently (QD-R4), and `no-skeleton-surface` breaking on a transcribed i18n
key or the `skeletonFromDescribe` name (QD-R5, mechanical but a guaranteed red CI).

## Altitude call (which system is this?)

**Both apply; v27 is predominantly system-altitude with an agent-altitude core.**

From `state.yaml.tech_stack`: a Node 22 / TypeScript ESM service — hand-rolled JSON-RPC-over-HTTP MCP
server, SQLite, filesystem journal, systemd self-update, a web dashboard served from the same port —
that dispatches genuine `@anthropic-ai/claude-agent-sdk` sessions through a managed LiteLLM proxy to
three providers and meters them. v27 touches the *dashboard* of that service.

*System altitude* — REQ-131 (theme/fonts/i18n/connection tag), REQ-132/133 (home and detail views),
REQ-134 (swimlane rendering), REQ-137/138/139 (Models, System, Issues tabs), REQ-140 (two
serialization additions), REQ-142/143 (polling hygiene, demo data). These are conventional UI + read-API
requirements and are read at that altitude: the dashboard is the *operator's* observability surface,
its `/api/*` routes are the *second public API* of the engine (the first being `/mcp`), and
"replaceability" here means the page's theme, strings, layout and data source are data, not code.

*Agent altitude* — REQ-135 (the agent slide-in panel IS the agent's inspectability: prompt, tools,
MCP servers, skills, token columns, cost, event stream, failure detail), REQ-136 (what of the
agent's reasoning context may leave the process), REQ-140's `record` (the `AgentRecord` with
`provider`/`transport`/`proxyModel`/`phase`/`detail`/`unmapped`, `types.ts:215-291`), REQ-141 (real
money per run), and REQ-137's Models tab, which is where backend substitutability becomes *visible*
(provider, location, declared tool/effort support, `catalogFetchedAt`).

**Named once and dropped:** *memory metabolism* and *self-reflection / prompt calibration* have no
v27 requirement and no seam this slice touches; inventing them would be scope invention. *Tool
liveness* survives only as what the catalog already declares (`stability`, `catalogFetchedAt`) and as
the typed slots REQ-137 reserves for D2 (`latency?`, `benchmarks?`).

---

## 1. Observability

**v27's observability question is not "does the engine capture enough" — v26 answered that (four
token columns, pinned prices, `detail`, `unmapped`, `transport`, `phaseIndex`). It is "does the page
show everything the engine already knows, and does it say so when it cannot".** Every finding below
is one of those two.

### System altitude

**O-1 — The client's data-source state machine must model every state the wire can produce, and
`degraded` is missing.** The engine's contract for the whole `/api/*` surface is "never a 500":
the dispatcher's catch (`server.ts:1067-1071`) answers `200 {degraded:'internal dashboard error'}`,
the route-level catch answers `200 {runs:[], degraded:<message>}` via `buildDashboardModel` (as-is
§A), `/api/issues` answers `200 {open:[],resolved:[],degraded:'GitHub not configured'}`
(`server.ts:459-468`), and `/api/system` carries per-section `Degraded {reason, detail?}` unions
(`system-info.ts:24-36, 80-103`). The handoff models `checking | live | offline | demo` only, with
`getJSON`-style "throw → offline". A 200 body with `degraded` is neither an exception nor a valid
view: `h.running` is `undefined` and the render throws. Proposal: five states —
`checking | live | degraded | offline | demo` — with `degraded` set per **route** (a run page whose
`/api/issues` is degraded is still live), rendered per tab as the REQ-138 "無法取樣 / Unavailable"
component already demands for `/api/system`, and the nav tag showing the *worst* state of the routes
the visible tab depends on. **Offline requires ≥ 2 consecutive failed ticks** (REQ-131: 連續失敗);
one success returns to Live immediately (REQ-143 third clause). This is the "observable seam" for the
page itself: a viewer must never see stale numbers with a green tag.

**O-2 — REQ-141: one accessor, two routes, and the honesty counter travels with the number.**
Evidence of the three producers: `foldUsage(events)` at rest (`run-guard.ts:47-72`),
`foldUsageFromRecords(records)` live (`run-manager.ts:242-258`, overlaid at `:830-838`), and the
stored terminal snapshot `usage` (`run-manager.ts:1014` → `sqlite-run-store.ts:265-279`, read as
`snap?.usage ?? foldUsage(...)`). v26's R-1 was exactly these two folds disagreeing on one column; the
lock is IT-156's deep-equal. `listRuns` (`sqlite-run-store.ts:295-307`) is a single SELECT with a
correlated `terminalAt` subquery and knows nothing of usage. Proposal:
- The list path reads cost from the SAME source order the detail path uses: live overlay (RunManager
  entry) → snapshot `usage` → transcript fold — as one accessor on the `RunStore` interface
  (`run-store.ts:191-217`), implemented by both the SQLite store and the in-memory store
  (`run-store.ts:349` is the latter's own fallback today). Concretely, for SQLite: `LEFT JOIN run_snapshots` and
  `json_extract(json, '$.usage.costUSD')` / `'$.usage.unpricedCalls'` in the list SQL for terminal
  runs that have a snapshot; the RunManager overlays its live entries (it already does this per run in
  `_mergeLive`); the snapshot-less legacy terminal run is the only case that needs a transcript fold on
  the list path, and it should be **backfilled once** into a snapshot (self-sustainability, S-4) rather
  than folded on every tick.
- `RunSummary` gains `costUSD?: number` (REQ-141's literal name) **and** `unpricedCalls?: number`.
  Without the counter, a run whose calls were all unpriced reports `costUSD: 0` and the card's
  "平均費用 $0.00" is the confident wrong value ADR-046 exists to forbid. The handoff already reads
  `r.usage?.costUSD ?? r.costUSD`, so either spelling renders.
- **"完全無用量時省略該欄":** `foldUsage([])` returns zeros, not `undefined`, so "no usage" needs a
  rule. Propose: omit both fields when the run has **no agent records at all** (no `usage` and no
  `refused` events, and no live records); a run with records but zero priced tokens carries
  `costUSD: 0` + `unpricedCalls: n`. State it in the contract row so the card code and the test share
  one definition.
- The card's average moves server-side into `computeWorkflowMetrics` (`dashboard.ts:126-166`), which
  already folds `RunSummary[]` into `successRate` / `avgDurationMs`: add `avgCostUSD: number | null`
  (mean over terminal runs that carry `costUSD`) and `unpricedRuns: number`. That satisfies REQ-132's
  meta line and REQ-141's "由這些 summary 計算" (the server computes it from the summaries), is unit-
  testable without a browser, and removes a second cost arithmetic from the client.
- Acceptance: one integration test asserts `GET /api/runs[i].costUSD === GET /api/runs/:id.usage.costUSD`
  for a run containing a terminally-failed call **and** an unpriced call — the two cases that split
  the folds last time.

**O-3 — REQ-140 `lanes`: say which lanes, under which masking.** `expectedGraph` — the only server-side
`{index, title}` lane list (`skeleton-graph.ts:25-30`) — is populated only `if (!authEnabled)`
(`server.ts:519-520`), so serializing it verbatim goes empty exactly when auth is on (as-is E-1).
`view.phases` (`types.ts:293-298`) is present regardless and is what `/api/runs/:id` already
discloses to everyone. Proposal: `lanes[]` = the observed phases (ordinal = array index, matching
`col = lane.index + 1` at `dashboard.ts:363`) **extended** by the expected lanes the run has not
entered yet when the overlay is unmasked. Under auth the future lanes are withheld — that is the
documented non-owner projection (ADR-012), not a silent drop, and the contract row must say so. Add
`current: number | null` (the last observed phase index while `status === 'running'`) so the client's
"目前" tag is one integer read, not a recomputation from `phases.length - 1` that the handoff does
inline. Keep `{kind, cells, edges, warnings, truncated?, startedBy, terminalAt?}` byte-compatible
(`dashboard-http.test.ts:140-150` pins it; extend that test, do not replace it).

**O-4 — The engine's own view of its dashboard is one log line short.** `grep` finds exactly one
structured log event in `src/server.ts` (`diagram_render_failed`, `:440`). The dashboard degrade
catches are silent 200s: an operator whose team reports "the page says Unavailable" has nothing in
the journal. Proposal: the two catches emit `{event:'dashboard_api_degraded', route, reason}` — one
line each, same convention as `:440`. Cheap, and it is the difference between a silent failure and a
designed one.

**O-5 — Traceability fold: REQ-070 / ARCH-040's panel has no v27 requirement and can regress
silently.** `buildDashboardHtml(init)` injects `lastUpdate` (tag/status/detail/configCheck) and the
`interruptedRuns` call-to-action (`dashboard-page.ts:58-87`); `/api/status` serves
`{agentSemaphore, version, lastUpdate?, interruptedRuns?}` (`server.ts:1268-1281`) and `/api/version`
serves the engine version (`:1261-1264`). The handoff's `refresh()` fetches neither route. REQ-138's
"引擎自身" `<dl>` is the natural home: PID / uptime / CPU / memory / threads / fds (all present on
`ProcessInfoView.self`, `system-info.ts:60-68`) **plus** `version`, `lastUpdate`, `agentSemaphore`
gauge and the interrupted-runs line. Gate 2 should trace ARCH-040 → the new System tab explicitly so
Gate 8 has a row to check; otherwise the first evidence of the regression is an operator not seeing
that an update failed.

**O-6 — Visibility pause must be observable, not just implemented.** REQ-142's proof is a request
count under Playwright/puppeteer, good. Add the page-side seam: the nav shows `lastUpdated` (the
handoff has `fmtClock(lastUpdated)`) and, while hidden-then-resumed, the first tick fires immediately
so the stamp never sits >3 s stale on a visible tab. A paused poll with a green "Live" tag and a
30-second-old stamp is the exact silent failure this lens forbids.

### Agent altitude

**O-7 — REQ-135's event list silently truncates today, and the design keeps the truncation.**
`runAgentLog` windows events at `limit ?? 50` with `offset`, returning `hasMore`
(`mcp-facade.ts:694-699`); `/api/runs/:id/agents/:id` passes `?limit&offset` through
(`server.ts:555-570`). The handoff reads `events` and ignores `hasMore`. An agent that made 60 tool
calls shows 50 with no indication. Proposal: the panel requests a larger window (`?limit=500`, the
engine's cap decides), renders "顯示 N / M" when `hasMore`, and offers a load-more. Event `data`
rendering: the design does `JSON.stringify(e.data)` for objects — a `tool_result` can be hundreds of
KB; cap per-row text with an expand affordance, `textContent` only (as-is D5).

**O-8 — REQ-136: withhold the content, keep the fact, and let the composition prove the split.**
`composePrompt(def?.systemPrompt, runParams.prompt, req.prompt, appendPrompt)`
(`agent-executor.ts:580`, `params/resolve.ts:175-186`) joins four segments; the descriptor's `prompt`
is that string, 4 KB-capped after `redact()` (`agent-executor.ts:676-686`). Proposal:
- The wire prompt is unchanged. The descriptor prompt is `composePrompt(undefined, runParams.prompt,
  req.prompt, appendPrompt)` — the same function, segment 1 omitted — so "everything except the
  system prompt, in the same order" holds by construction, and `val-104`'s script-before-append
  assertion (`:79-81`) keeps passing. The place to apply it is the executor's single descriptor
  decoration site (`agent-executor.ts:646`, the object `capPrompt`/`redact` then persist at `:672`):
  both gateways emit `prompt: req.prompt` eagerly (`gateway/client.ts:493-508`), so replacing the
  field once at decoration covers both transports without touching either client.
- The descriptor gains `systemPrompt?: { agentType: string; bytes: number }` — present iff a non-empty
  agentType system prompt was applied. Absence of content must be distinguishable from absence of a
  system prompt: the panel renders "系統提示詞:已套用(agentType X,1,204 bytes)— 不顯示". The
  bytes figure is what makes a "why did this agent behave differently" post-mortem answerable
  without shipping the text: the operator can open `agents/X.md` locally.
- **The open question (`appendPrompt`, `runParams.prompt`):** keep both. `appendPrompt` is the
  caller's own text (REQ-094) and `val-104` reads it from `harness.prompt`; `runParams.prompt` is the
  author's default, already discoverable to every principal via `workflow_describe`'s `params.agents`
  defaults. The system prompt is the only segment whose owner is the *operator* (files on the engine
  host), which is why it is the only one that leaves.
- The three tests need no weakening: `val-082:138-140` asserts a non-empty string, `val-104` asserts
  order, `redact-sweep:309-340` asserts a secret in `descriptor.prompt` is redacted — all still true.
  The REQ-136 red test is new: an agentType with a system prompt, run once, `run_agent_log` +
  the HTTP route both lack any 32-byte window of it.
- `/api/*` carries no bearer (as-is D2; Host/Origin still apply to every route, `server.ts:1044-1055`),
  so REQ-136 is the ONLY control between the system prompt and anyone who can reach the port. Make
  it a wire test on both surfaces, not a frontend `if`.

**O-9 — Show REQ-125's three facts, not one.** The handoff's stat card shows `model` + `provider`.
`AgentRecord` and `HarnessDescriptor` carry `transport` and `proxyModel` (`types.ts:235-239,
482-491`) precisely so "which of the three paths broke" is answerable. The model card's second line
should read `provider · transport (· proxyModel)`; `effortApplied` (`types.ts:511`) is already
rendered by the design as `param = value` — keep it, it is the falsifiability record for the effort
dial.

**O-10 — The Models tab must carry its own "as of", and the design never refreshes it.** The handoff
fetches `/api/models` only when `!this.state.models` — once per tab lifetime — while `ModelBook`'s
snapshot has a 1 h TTL (`model-book.ts:81-170`) and each row carries `catalogFetchedAt`
(`model-catalog.ts:355-359`, v26 decided per-row on purpose). Proposal: refetch on tab activation and
at most once per snapshot TTL; render `catalogFetchedAt` in the tab header. A catalog that says
"stable" from six hours ago is a claim with a date, and the date is what makes it honest.

---

## 2. Replaceability

**What must be swappable after v27: the theme (data), the strings (data), the layout constants
(data), the demo dataset (one module), the fonts (files), the polling transport (one scheduler), and
the browser driver for acceptance (the one already installed). What must NOT be introduced: a
bundler, a component framework, a CDN, a second browser driver.** The handoff README instructs
"在既有的 `src/dashboard-page.ts` server-side HTML stack 裡重做" and the offline/no-CDN stance is
test-locked (as-is D4); the proposals below stay inside that.

### System altitude

**R-1 — Split the monolith into typed data modules interpolated into ONE served page.** Today the
page is one 640-line literal. The v27 page will be larger (three tabs, a panel, a swimlane, i18n) and
the acceptance is a per-row spec. Proposal — `src/dashboard/` with:
- `strings.ts`: `export const STR = { zh: {...}, en: {...} } as const` plus a type lock
  `satisfies Record<'zh'|'en', Record<keyof typeof STR.zh, string>>` (tsc refuses a key present in one
  language only). Interpolated as JSON into the page (REQ-131: "同源於單一字串表"). The `<html lang>`
  attribute is written by the client from the same table. **C3:** the handoff's `skeleton:` key and
  its `skeletonFromDescribe` function name both put the literal word into a file that is not on the
  six-file allowlist (`no-skeleton-surface.test.ts:53,82`); the key becomes `predictedLayout`, the
  function `predictedFromDescribe`.
- `theme.ts`: the OKLCH ramps as arrays — the handoff's `aL`/`aC` sequences in `renderVals` and the
  README's formula (`dark oklch(.72 .065 h)`, `light oklch(.56 .065 h)`) — and one pure
  `accentVars(hue, dark) → Record<string,string>`. Server-side it emits the default-hue inline
  style for first paint; client-side the same function (mirrored, see R-2) re-applies after reading
  `localStorage['rwe-hue']`. C4(a) is settled by construction: the static hex in the `.dc.html`
  (`:24-37`) is never copied; a unit test pins the arrays against the README rows.
- `layout.ts` (or on `dashboard.ts` beside `DAG_BOX_DEFAULTS`, `:272`): `SWIMLANE_BOX = { PAD:16,
  TRIG_W:112, LANE_W:216, LANE_GAP:40, HEAD_H:48, CELL_H:74, GAP_Y:14 }` and a pure
  `swimlaneRect(cell, box)` — the v26 ADR-044 split unchanged: the server owns box math, the client
  constructs DOM.
- `demo-data.ts`: the REQ-143 dataset, **typed against the same route types the live client
  consumes** (C-1) — see S-3 for its retirement mechanics.
- `client.js` or `client.ts`-exported string: the browser code. Two honest options: (i) keep it a
  template-literal string in `client.ts` (zero mechanism change, no syntax highlighting, the page-
  source tests keep working unchanged); (ii) a plain `client.js` read at boot with
  `readFileSync(new URL('./client.js', import.meta.url))` — real JS tooling, and the same mechanism
  the fonts need (R-4). Note `npm start` is `tsx src/main.ts` and `build` is `tsc --noEmit`
  (`package.json`), so there is no `dist/` asset-copy step to worry about; (ii) costs nothing at
  runtime. I lean (ii) but will not fight for it.
- `dashboard-page.ts` remains the assembler: `buildDashboardHtml(init)` concatenates the pieces and
  keeps the `window.__RWE_INIT__` seam (`:60-61`) for `version`, `lastUpdate`, `interruptedRuns` and
  a `demoEnabled` flag (S-3).

**R-2 — The server/client mirror pairs: single-source them or pin them, but decide.** The as-is map
lists five deliberate duplicates (`cellToPixel`/`cellToPixelLocal`, `stableHash`, `sumTokens`,
`dagBox`/`svgW`, `capsFromRow`). v27 adds at least `swimlaneRect`, `accentVars` and `sumTok`. Two
options with their real cost: (a) `src/dashboard/pure.js` — one plain-JS file with the pure functions,
imported by the server (`dashboard.ts`) and inlined verbatim into the page; requires `"allowJs": true`
in `tsconfig.json` (it has none today) plus a sibling `pure.d.ts` or JSDoc types, and the file must
stay import-free. (b) Keep mirrors and add ONE unit test that evaluates the client function text with
`new Function` against the same fixture table as the server function. (a) removes the class; (b)
detects the drift. Either is acceptable; silently adding an eighth mirror is not.

**R-3 — Fonts: vendored files behind an allowlisted route, not base64 in a TypeScript module.**
`find` shows no `.woff2` anywhere outside `node_modules`, and `server.ts` has no static-file route
(`readFile`/`createReadStream` do not occur on a GET path). Two options: (i) base64 `@font-face` data
URIs in the CSS string — zero new routes, but Archivo ×3 weights + JetBrains Mono ×2 ≈ 250–400 KB
of base64 inside a `.ts` module, re-sent on every `/dashboard` GET, and every page-source
test's `DASHBOARD_HTML` grows by that; (ii) `assets/fonts/{archivo-400,500,600,jbmono-400,500}.woff2`
+ `OFL.txt` (both families are SIL OFL; the licence text must ship beside them), read into memory at
boot, served at `GET /dashboard/fonts/<name>` from a **fixed map** (the URL selects a key, never a
filesystem path — no traversal surface), `Content-Type: font/woff2`,
`Cache-Control: public, max-age=31536000, immutable`. Every `@font-face` carries a system fallback
stack and `font-display: swap`, so a missing file degrades to readable text with a logged warning
(`{event:'dashboard_asset_missing', name}`), never a blank page. I recommend (ii). Either way the
REQ-131 grep guard is "no `fonts.googleapis.com`, no external host in `DASHBOARD_HTML`".

**R-4 — The polling transport is ONE scheduler.** REQ-142 (pause when hidden) and D3 (no SSE, no
configurable interval this round) are both satisfied by a single `Poller` object owning the timer,
the visibility gate, the tab-scoped fetch set, and the source state machine (O-1). If D3 is
reversed later (SSE), only that object changes; every render function keeps its
full-refetch-per-tick contract (as-is D9). `val-018:66` accepts "SSE or polling" and stays green.

**R-5 — One browser driver.** `val-193`/`val-197` launch **puppeteer** (`val-193:105-106`), and
`puppeteer` is already an `optionalDependency` (`package.json`). REQ-131/132's "Playwright 截圖" should
be read as "a real Chromium screenshot"; the automated evidence uses the existing harness and the
existing Chrome probe. Adding Playwright as a second driver for screenshots is a second thing to
install, cache and skip-guard — the Playwright MCP the owner has is fine for the *human* side-by-side.

**R-6 — Retire the orphan and re-justify the dead branch.** `buildDagModel`/`DagNode`
(`dashboard.ts:18-71`) has zero production callers (as-is §B); the client's `renderNode` legacy tree
(`dashboard-page.ts:505-511`) is fed by a `kind !== 'run'` branch the server never takes
(`server.ts:546-552`). The swimlane replaces the DAG view wholesale, so v27 is the iteration to
delete both and `tests/unit/dashboard-dag-model.test.ts`, with an ADR line — not to carry a
third renderer into the new page. `LayoutCell.frame?/depth?` (`dashboard.ts:246-247`) are declared and
never populated on the live path; REQ-134 does not mention nested frames and the nested-lane
question was routed to requirements at v26 close — record it as an open requirement, do not invent
a frame renderer.

### Agent altitude

**R-7 — The backend swap is untouched by v27 and the Models tab is where it shows.** No v27
requirement changes `GatewayClient`, `providers.ts` or `ModelBook`. What the rebuild must do is keep
the swap *visible*: provider, location (`local | remote`), `toolUseDeclared` / `effortDeclared` /
`declaredSource`, `stability`, `catalogFetchedAt` — every row already carries them
(`model-catalog.ts:341-360`).

**R-8 — Reserve D2's slots as typed optionals now.** `latency?: { ttftMs: number; p50Ms: number }` and
`benchmarks?: Record<string, number>` on `EnrichedModelEntry`, never populated in v27, rendered as
`—` (REQ-137). This is the same argument as v26's C-7 (`declaredSource`): the field exists so the
future probe has a shape to write into, and the sort comparator treats "absent" as last rather than
as `0` or `Infinity` mixed with real numbers (the handoff's `latency: m.latency?.p50Ms ?? Infinity`
sorts absent rows *first* in descending order — the wrong direction for a column that is entirely
absent this iteration).

---

## 3. Consumability

**Two consumers are being designed for at once: the operator (and team) reading the page, and the
page itself reading `/api/*`. The second is the one that gets shortchanged when a design is
transcribed: the handoff's REST client was written against an *assumed* API (as-is C4(b)), and this
is the iteration to make the real one explicit.**

**C-1 — The `/api/*` surface is the engine's second API; give it one typed contract and let the demo
dataset be its fixture.** The handoff reads nine routes (`home, runs, run, dag, agent, describe,
models, system, workflows`); v27 changes the shape of three. Proposal: one module
(`src/dashboard/api-types.ts` or re-exports on `dashboard.ts`) that names the response type of every
route — `HomeView`, `RunSummary[]`, `Omit<RunStatusView,'principal'>`, `GraphPayload & {lanes,
current}`, `{runId, status, record, harness, events, hasMore}`, `WorkflowDescribeView &
{diagramContract, toolSurface}` (the true describe shape, as-is §A), `EnrichedModelEntry[]`,
`SystemInfoView & {auth}`, the catalog list row — and the v26-style contract table in
`02-architecture.md` with one row per route stating the v27 delta and the masking rule. The REQ-143
demo dataset is declared `satisfies` those types, so the fixture cannot drift from the wire and
doubles as the unit-test fixture for every render function. `dashboard-http.test.ts` is extended, not
replaced.

**C-2 — The `degraded` contract is part of the API and must be consumed (O-1).** Restated here
because it is a consumability defect as much as an observability one: a client that can crash on a
documented 200 body has not integrated the API.

**C-3 — REQ-133's "預測結構" for a never-run workflow needs a wire source, and the honest one is a
projection of the author's own public diagram.** `WorkflowDescribeView.phases` is `Array<{title}>`
(`workflow-view.ts:106`) — no agent→phase membership on the wire; the handoff's
`skeletonFromDescribe(desc)` cannot place agents in lanes from that. `deriveExpectedGraph` knows the
slots (`skeleton-graph.ts:25-30`) but its consumer is internal. Proposal: `describe.phases[]` gains
`agents: string[]` (labels expected in that phase, from the same derivation the run-DAG overlay uses,
INV-V26-3), under the wording "predicted", no new route. **REQ-105 / ADR-048 sensitivity, stated
plainly:** this is the same information the v26 run-DAG overlay already ships as `__skel_` cells on
every unauthenticated run page, and the same membership the author's REQ-128 v2 Mermaid (already in
`describe.mermaid`, public) draws as subgraphs — it is a projection to the author's own contract, not
the retired script skeleton surface. The adversarial lens may disagree; see expected disagreements.
Under auth, apply the same withholding as O-3 (`agents` omitted, `predicted: false` on the view).

**C-4 — REQ-137: three columns have no wire source, and the REQ names two.** `latency`/`benchmarks`
are D2 (R-8). The third is "支援參數以 neutral tag 列出": `enrichModelEntry` deliberately drops
`supported_parameters` (`model-catalog.ts:429`, v26 "one name per fact — the two `*Declared` fields
project it"). Gate 2 must rule: re-expose the full list under `supportedParameters?: string[]` (a
different fact — the whole list, not the two projections) or render `—`. My lens says expose it: the
list is exactly what a caller choosing between two OpenRouter rows needs, and it is upstream-declared
data with a `declaredSource` already beside it.

**C-5 — REQ-135's panel is the agent's SDK; make its inputs the record, not the DOM.** The handoff's
`loadAgent` falls back to reconstructing `record` from `runView.agents` when `raw.record` is absent —
REQ-140 makes that fallback dead; delete it rather than keep two code paths. The panel reads
`record.{state, phase, phaseIndex, model, provider, transport, proxyModel, tokens, costUSD, unpriced,
startedAt, endedAt, detail, reasonCode, unmapped}` and `harness.{prompt, tools, mcpServers, skills,
effort, effortApplied, timeoutMs, provenance, mcpUnresolved, systemPrompt}` — every one an existing
field (`types.ts:215-291, 476-521`) except O-8's `systemPrompt`. `mcpUnresolved` and `unmapped` are
the two "honest no-op" records v22/v26 added; the panel should show them (a tag "1 MCP server
unresolved", "2 unmapped provider messages") — a capture with no reader is not observability.

**C-6 — No-flash theme init is a consumability nicety with a one-line cost.** REQ-131's first
acceptance reads `data-theme="dark"` and `--color-bg` on first load. A `<head>` inline script that
reads `localStorage` for theme/lang/hue and stamps `data-theme`/`lang`/the accent vars **before**
first paint avoids a light→dark flash on every reload for a team that set light mode. The
server-emitted default (dark, hue 236) is the no-storage fallback.

**C-7 — The page can now carry a CSP, and should.** With fonts vendored and no external host, the
served page's dependencies are all `'self'`: `default-src 'none'; script-src 'nonce-<per-response>';
style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' blob:; connect-src 'self'`. Today
`GET /dashboard` sets no CSP at all (as-is D3); the nonce is trivial in `buildDashboardHtml`. This is
the adversarial lens's turf — recorded here as support, and as a reason to move the handoff's
hundreds of inline `style="…"` attributes to classes (which the `.card .tag .btn` component classes
already encourage).

**C-8 — "99% 相似" needs a mechanism, and pixel-diff is the wrong one.** Font rasterization differs
across OS/GPU; a pixel threshold is either too loose to catch a wrong colour or too tight to pass on
CI. Proposal: (i) the README's colour/size/animation rows become a **table-driven computed-style
test** in the real browser (`getComputedStyle(el).getPropertyValue(...)` per row: `--color-bg`
`#18191b`, node `216×74`, lane header `13px` uppercase, edge `1.2px`, `rweSweep 2.4s`, …); (ii) the
dark/light screenshots go to `evidence/v27/` for the owner's side-by-side. (i) is what Gate 7.5 can
re-run; (ii) is what the owner asked for. Both use the puppeteer harness (R-5).

**C-9 — REQ-139's Issues tab consumes a degraded body by design.** `{open:[],resolved:[],degraded:
'GitHub not configured'}` (`server.ts:459-468`) must render as the same "Unavailable" component as
REQ-138's, in the v27 tokens — the REQ says "仍顯示 degraded 而非空白"; O-1's per-route state is the
mechanism.

**C-10 — The C2 selector anchors are an interface, treat them as one.** `#dag-fit #dag-graph
#dag-zoom #run-usage #diagram-img #diagram-zoom .card .t` are pinned by real-mouse tests. Keep the
IDs on the new elements (a swimlane `<svg id="dag-graph">` inside a `#dag-zoom` wrapper with a
`#dag-fit` button is exactly the design's shape). Where the design has no equivalent (`.t` on a
card title), rewrite under the same VAL ID as the REQ instructs — and list every re-anchored selector
in the contract table so the rewrite is reviewable.

---

## 4. Self-sustainability

**v27's self-sustainability question: a team leaves this page open for days, the engine restarts
itself on release tags (REQ-070), the run table grows, and the demo dataset is scheduled to be
deleted. Does the page keep telling the truth without anyone touching it?**

### System altitude

**S-1 — REQ-142 is the polling budget; keep the per-tab fetch scoping the handoff already has.** The
design's `refresh()` fetches `home+runs` on the Workflows tab, `system` on System, `models` once —
good; keep it, and add the visibility gate to the ONE scheduler (R-4). On resume, one immediate tick.

**S-2 — A self-update with a tab open is a version skew, and the page can detect it for free.**
`ENGINE_VERSION` is served in `/api/version` and `/api/status` (`server.ts:1261-1281`) and can be
embedded in `window.__RWE_INIT__`. After the systemd updater restarts the engine (ARCH-039/040), an
open tab keeps running the OLD client against the NEW `/api/*` — the exact moment a shape delta
(REQ-140/141) bites. Proposal: the client compares the embedded version with `/api/status.version`
on the ticks that fetch it (System tab, or every Nth tick) and shows a "engine updated to vX —
reload" banner. It also carries `lastUpdate` (O-5) — one fetch, two facts.

**S-3 — REQ-143 demo mode: the safe transition rule, and the exit mechanics the REQ itself demands.**
- **Reachability fact:** `/dashboard` and `/api/*` are served by the same process on the same port
  (`server.ts:1251-1257, 1284-1294`). "API unreachable at first load" is therefore essentially the
  restart window; the transition that can actually happen mid-session is **live → unreachable**
  (engine restarting). Replacing a team's real run list with fictitious workflows and costs at that
  moment — even with a tag — is the dangerous case.
- **Rule:** demo data may be shown only when the page has **never** been live in this session
  (first-load failure, the owner's "我要看有缺什麼" case) or when explicitly requested
  (`/dashboard?demo=1`, for the design comparison). Once live, unreachable means **Offline with the
  last live data frozen and its `lastUpdated` stamp visible** — never a swap to demo. Every tab
  renders its demo watermark (REQ-143: "每個 tab 的可見區域都能看出"), and the tag can never read
  Live and Demo together. This narrows REQ-143's first clause and is listed under expected
  disagreements for the owner to keep or overrule.
- **Re-probe:** the handoff's `call()` never contacts the API again once in demo; the rebuild probes
  `/api/home` every tick while in demo and switches to Live on the first success (REQ-143 clause 3).
- **Exit mechanics (the REQ's registered retirement condition):** one module `demo-data.ts`, one
  boolean `DEMO_ENABLED` in `__RWE_INIT__`, and a **`demo-surface` allowlist test in the
  `no-skeleton-surface` family**: an enumerated set of files may contain the token `demo` (the
  module, the strings table, the client's state machine, the REQ-143 tests). Retirement is: delete
  the module, flip the flag, shrink the allowlist — and the test names every leftover description of
  the deleted thing, which is precisely the defect class the REQ cites (REQ-105 / ADR-048 / UT-115).
  The typed dataset survives as `tests/fixtures/dashboard-demo.ts` (C-1), so "delete the demo" does
  not also delete the render tests' fixture.

**S-4 — The list route is unbounded per tick per viewer; do not add a per-run fold to it.**
`/api/home` (`server.ts:360-368`) and `/api/runs` (`:386-389`) each call `store.listRuns()` — a full
`runs` scan with a correlated `terminalAt` subquery per row — every 3 s per viewer, and the handoff
fetches both on every Workflows tick. Today's table is small (13 runs); with a team polling and a
year of scheduled runs it is not. Two obligations: (i) REQ-141's cost column must not turn the list
into N transcript folds (O-2: snapshot `json_extract` + live overlay; a one-time backfill for
snapshot-less legacy terminal runs, done lazily on first read and persisted via the existing
`saveSnapshot`); (ii) Gate 7.5 measures `/api/runs` + `/api/home` latency at N = 1 000 synthetic runs
and records it — a number, not a hope. A `?limit` on the list is NOT proposed (D3 excluded polling
tuning; the history table wants all runs of a workflow), but the measurement decides whether v28 needs
one.

**S-5 — Long-lived tab hygiene.** Every 3 s the swimlane, cards and tables are rebuilt. The
existing invariant — the transform lives on the `.zoomable` WRAPPER, children are rebuilt (as-is D6,
`dashboard-page.ts:687-692`) — must survive the rewrite or zoom resets every tick. Event listeners
are attached per node per rebuild: use delegation on the stable wrapper, or the tab leaks handlers
for days. `renderDiagram`'s `createObjectURL`/`revokeObjectURL` pair is test-pinned
(`dashboard-diagram-render.test.ts`); keep it. The agent panel's event list is bounded (O-7).

**S-6 — Assets fail soft, config fails closed.** A missing vendored font is a packaging defect that
degrades to the fallback stack with one logged event (R-3), never a boot failure — fonts are
cosmetic. Any NEW config key v27 adds (a fonts directory override, `demoEnabled`) goes through
`composeConfig()` and its wiring probe (`compose-config-v2-wiring.test.ts`; the twice-bitten class in
`MEMORY.md`), or it silently no-ops — the fourth time would be unforgivable.

### Agent altitude

**S-7 — The page's closed loop with the agent runtime is the money line, and it must not lie when
the price is unknown.** REQ-132's "平均費用" and REQ-134's per-node `$0.31` are read by someone
deciding whether to let a scheduled workflow keep running. `unpriced` (per record, `types.ts:252`)
and `unpricedCalls` (per run/summary, O-2) must render as a qualifier ("≥ $0.42, 2 unpriced"), the way
the current page already does with its "lower bound" note (`dashboard-page.ts:479`). Zero with a
qualifier is honest; zero without one is the failure mode this ledger has closed five times.

**S-8 — Memory metabolism and self-reflection: not applicable, and one sentence on why the page
does not become one.** No v27 requirement asks the dashboard to summarize or archive transcripts;
the agent panel reads what the engine journaled. The only "metabolism" in scope is the event window
(O-7) and the bounded per-row text — display bounds, not memory policy.

---

## key_points

1. **Model the wire's states, not the prototype's:** `checking | live | degraded | offline | demo`,
   `degraded` per route (every `/api/*` throw is a 200 with `degraded`), Offline only after ≥2
   consecutive failed ticks, Live on the first success (O-1, C-2).
2. **REQ-141 = one accessor for both routes** (live overlay → snapshot → fold), `costUSD` +
   `unpricedCalls` on `RunSummary`, `avgCostUSD`/`unpricedRuns` in `computeWorkflowMetrics`, a stated
   "omit when no records" rule, and an equality test over a run with a failed and an unpriced call
   (O-2, S-4, S-7).
3. **REQ-136 removes content, keeps the fact:** descriptor prompt = `composePrompt` minus segment 1,
   plus `systemPrompt?: {agentType, bytes}`; `appendPrompt` and the author default stay; wire test on
   both surfaces; no existing assertion weakened (O-8).
4. **REQ-140 `lanes`** = observed phases extended by unmasked expected lanes, plus `current`; the
   masking rule is in the contract row; `record` is the same `AgentRecord` `/api/runs/:id` serves
   (O-3, C-5).
5. **Trace REQ-070/ARCH-040 into the System tab explicitly** (version, lastUpdate, interruptedRuns,
   agentSemaphore) — no v27 REQ names it and the handoff fetches neither `/api/status` nor
   `/api/version` (O-5, S-2).
6. **Split the page into typed data modules** — `strings.ts` (key-parity type lock), `theme.ts`
   (OKLCH ramps from the README, static hex ignored), `SWIMLANE_BOX` + `swimlaneRect` server-side,
   `demo-data.ts` typed against the route types — assembled by `buildDashboardHtml`; no bundler, no
   framework, no CDN (R-1, C-1).
7. **Mirror pairs: single-source via an import-free `pure.js` (+`allowJs`) or pin with a
   `new Function` equality test — decide, do not add an eighth silently** (R-2).
8. **Fonts: vendored woff2 + OFL.txt, allowlisted fixed-map route, immutable cache, fallback stack
   + one logged event on a missing file** (R-3, S-6).
9. **Keep puppeteer as the only browser driver; "Playwright" in the REQ means "real Chromium"**;
   acceptance for "99%" = table-driven computed-style checks + evidence screenshots, not pixel diff
   (R-5, C-8).
10. **Demo mode: first-load or explicit only; live → unreachable is Offline-with-frozen-data, never a
    swap to fiction; re-probe every tick; retirement = delete module + shrink a `demo-surface`
    allowlist test; the dataset survives as a typed test fixture** (S-3).
11. **Silent truncations become visible:** agent events "N / M" with paging (`limit ?? 50`,
    `hasMore` ignored by the design), Models tab refetch on activation with `catalogFetchedAt` shown,
    `lastUpdated` beside the Live tag, one `dashboard_api_degraded` log line server-side (O-4, O-6,
    O-7, O-10).
12. **Gaps the REQs do not name, for Gate 2 to rule:** `supportedParameters` (dropped at
    `model-catalog.ts:429`), `describe.phases[].agents` for REQ-133's predicted layout (REQ-105
    sensitivity), `latency?`/`benchmarks?` as typed optionals sorted last, retiring `buildDagModel`
    and the dead `renderNode` branch, `LayoutCell.frame/depth` as an open requirement (C-3, C-4, R-6,
    R-8).
13. **C3 is mechanical and will go red on transcription:** the `skeleton` i18n key and
    `skeletonFromDescribe` both violate `no-skeleton-surface` — rename before the first commit.
14. **Housekeeping for the orchestrator:** VAL-179/189/191/196 have no located test files (as-is §C);
    `state.yaml.tech_stack` still carries the "hard-coded stubs" caveat about the sandbox budget
    accessors that v26's panel showed to be stale (`run-manager.ts` really supplies
    `onBudgetSnapshot`); the handoff README and `rwe-data.js` are not in the repo or scratchpad — Gate 2 should
    pin the exact package revision it designed against (PROVENANCE.md warns "上游會變動").

## risks

| # | Risk | Severity | Where it lands |
|---|---|---|---|
| QD-R1 | **Demo data replacing real data mid-session.** The handoff enters `demo` on a failed probe and never leaves it (`Component.call()`: once `source==='demo'` the API is not called again); REQ-143's literal first clause would let an engine restart swap a team's live run list for fictitious workflows and costs. Rule: demo only when never-live or explicit; otherwise Offline with frozen data + stamp; re-probe every tick. | HIGH | REQ-143, REQ-131 (S-3) |
| QD-R2 | **The client has no `degraded` state.** Every `/api/*` fault is a 200 body with `degraded` (`server.ts:1067-1071`, `:459-468`, `system-info.ts:31-34`); the design's render would throw on `/api/home`'s degraded shape and paint Offline on a single transient miss. Five-state machine, per route, ≥2-tick Offline threshold. | HIGH | REQ-131/138/139 (O-1, C-2) |
| QD-R3 | **A second cost fold on the list route.** `listRuns` is pure SQL (`sqlite-run-store.ts:295-307`); `/api/runs/:id` reads live overlay → snapshot → `foldUsage`. A list-side arithmetic that differs on a failed or unpriced call reproduces v26 R-1 on the card the owner reads to decide spend. One accessor, `unpricedCalls` beside `costUSD`, equality test over both edge cases. | HIGH | REQ-141, REQ-132 (O-2) |
| QD-R4 | **REQ-070's observable-update panel regresses silently.** Injected by `buildDashboardHtml(init)` (`dashboard-page.ts:58-87`); no v27 REQ names it; the handoff never fetches `/api/status`. Gate 8 has no row to fail on unless Gate 2 traces ARCH-040 into the System tab. | HIGH | REQ-070 / ARCH-040 → REQ-138 (O-5) |
| QD-R5 | **`no-skeleton-surface` goes red on transcription.** The i18n key `skeleton:` and the function `skeletonFromDescribe` land in files off the six-file allowlist (`no-skeleton-surface.test.ts:53,82`). Mechanical, certain, and cheap only if renamed before the first commit. | HIGH (certainty) / LOW (cost) | REQ-133, C3 |
| QD-R6 | **System prompt still on the wire via a second path.** REQ-136 targets `HarnessDescriptor.prompt`; `/api/*` carries no bearer (as-is D2). Both gateways emit a descriptor with `prompt: req.prompt` eagerly (`gateway/client.ts:493-508`), and the executor has ONE decoration site (`agent-executor.ts:646`, persisted at `:672`) — the split belongs there, so a descriptor that bypasses decoration (a future third gateway, a test double) is the leak path. Lock it with a wire test on both the MCP and HTTP surfaces, not a unit test on the decorator. | MID | REQ-136 (O-8) |
| QD-R7 | **Unbounded list per tick per viewer.** `/api/home` and `/api/runs` each full-scan `runs` with a correlated subquery every 3 s per viewer; REQ-141 must not add N transcript folds to that path, and Gate 7.5 must measure at N=1 000. | MID | REQ-141/132/142 (S-4) |
| QD-R8 | **Silent event truncation in the agent panel.** `limit ?? 50` + `hasMore` (`mcp-facade.ts:694-699`); the design ignores `hasMore`. An operator post-mortem sees 50 of 60 tool calls with no marker. | MID | REQ-135 (O-7) |
| QD-R9 | **Version skew after self-update.** An open tab runs the old client against the new `/api/*` right when REQ-140/141 change shapes; no detection exists. Embed `ENGINE_VERSION`, compare on poll, prompt reload. | MID | REQ-070 / REQ-140 / REQ-141 (S-2) |
| QD-R10 | **Fonts as base64 in a `.ts` module.** 250–400 KB inside `dashboard-page.ts`, re-sent per page load, inflating every page-source test's subject; and OFL licence text must ship with the files either way. Allowlisted static route instead. | MID | REQ-131 (R-3) |
| QD-R11 | **The mirror-pair class grows by three with no lock.** `swimlaneRect`, `accentVars`, `sumTok` join five existing server/client duplicates; drift between the server's tested box math and the browser's copy is exactly the D8/D10 defect family. Single-source or pin. | MID | REQ-134/131 (R-2) |
| QD-R12 | **Stale catalog forever.** The handoff fetches `/api/models` once per tab life; `ModelBook` TTL is 1 h; `catalogFetchedAt` is per row for this reason. Refetch on tab activation; show the date. | LOW | REQ-137 (O-10) |
| QD-R13 | **Three Models columns have no source.** `latency`/`benchmarks` (D2) and `supported_parameters` (dropped at `model-catalog.ts:429`). Absent must sort last, render `—`, and never be `0`. | LOW | REQ-137 (C-4, R-8) |
| QD-R14 | **The predicted layout for a never-run workflow re-opens REQ-105 unless framed as the author's-diagram projection.** `describe.phases` is title-only; a new route or a `skeleton`-named field would re-litigate ADR-022/048. `phases[].agents` under "predicted" wording, withheld under auth like O-3. | LOW | REQ-133 (C-3) |
| QD-R15 | **New config keys not forwarded by `composeConfig()`.** Any fonts-dir or demo flag added to `FileConfig` must be probed by `compose-config-v2-wiring.test.ts` or it silently no-ops (the twice-bitten class). | LOW | REQ-131/143 (S-6) |

## expected disagreements with other lenses

- **vs. the adversarial / "do what the REQ says" lens — on S-3 (demo mode only when never-live).**
  REQ-143's first clause reads "引擎 API 不可達 → 以示範資料集渲染", full stop, and the owner ruled
  to keep the dataset. My narrowing (never-live or explicit; otherwise Offline with frozen real data)
  is a safety rule about a *transition*, not a refusal of the dataset. If they hold to the literal
  text, the minimum I need is: the demo watermark on every tab (the REQ already says so), the
  `lastUpdated` stamp visible, and the exit mechanics — because the literal reading makes every
  self-update restart a few seconds of fiction on every open tab. Either way the re-probe defect in
  the handoff (`call()` never leaves demo) is not negotiable; it contradicts clause 3 outright.
- **vs. a security lens — on C-3 (`describe.phases[].agents`).** They will say REQ-105 retired the
  skeleton from every user-facing surface and this is it, back under another name. My counter is the
  information, not the name: the run-DAG overlay already serializes `__skel_` cells to anonymous run
  pages (`server.ts:519-544`), and the REQ-128 v2 Mermaid — public in `describe.mermaid` — draws the
  same lane membership as subgraphs. The projection is of the author's own contract, not of script
  text. If they win, the fallback is the handoff's own approach: lanes from `phases`, agents unplaced
  in a single "predicted" row — honest, uglier, and REQ-133's "標明尚無執行" still holds.
- **vs. a simplicity lens — on R-1/R-2 (module split, `allowJs`).** They will say: one file worked
  for 26 iterations; a `pure.js` with a `.d.ts` and a tsconfig change is ceremony. The count is the
  argument: the page triples in surface, gains an i18n table whose key parity is otherwise a runtime
  bug, a theme formula whose fidelity is a Gate 7.5 spec row, and three more mirror pairs. If they win
  on `allowJs`, I take option (b) — the `new Function` equality test — and hold the data-module split,
  which adds no mechanism at all (it is `MORANDI_PALETTE`'s pattern, five times).
- **vs. a performance lens — on S-4 (no `?limit`, measure instead).** They will want the bound now.
  D3 excluded polling tuning this round and the history table wants every run of a workflow; a
  measured number at N=1 000 is what lets v28 add the bound with a threshold instead of a guess. If
  the measurement is bad at Gate 7.5, the cheapest fix is on the server (cache the list for the
  sampler's 1.5 s TTL, the way `/api/system` already does) — not on the client's interval.
- **vs. a UX lens — on C-8 (computed-style table over pixel diff) and O-7 (paging the event list).**
  They may want pixel similarity as the number the owner asked for, and an infinite-scroll event list.
  Pixel diff across OS font rasterizers is either meaningless or flaky; the README rows *are* the
  spec, and a row-by-row computed-style check is what "規格逐條核" literally says. On events: a
  "N / M" line plus load-more is what the wire supports today (`limit/offset/hasMore`); an
  infinite-scroll is a client detail on top of the same seam, fine if someone wants to build it.
- **vs. whoever proposes fetching `/api/runs/:id` per card for cost.** REQ-141 forbids it in so many
  words; O-2's server-side `avgCostUSD` is the alternative that also keeps the client free of cost
  arithmetic. Expected to be uncontested; recorded so it is not re-derived.
- **vs. the architect on O-8's "keep `appendPrompt` and the author default visible".** The REQ leaves
  it open; a stricter reading drops both. `val-104:79-81` reads the append marker from
  `harness.prompt` and the author default is already public via `describe.params.agents`, so dropping
  them buys no confidentiality and costs a passing test plus the panel's only reason to exist. If the
  owner wants them hidden anyway, it must be a `systemPrompt`-style fact record for each, not a bare
  deletion.
