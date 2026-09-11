---
stage: design
lens: quality-dimensions
iteration: v27
round: 1 (independent proposal)
closure: REQ-131..136, REQ-140, REQ-141 (the eight REQs Gate 2 decomposed); REQ-137/138/139/142/143 are out of closure and only their attachment slot is named
inputs: 01-requirements.md §Iteration v27 (REQ-131..143 + Round v27 log), 02-architecture.md §v27 slice (ARCH-122..131, ADR-049..056, 4+1 views, data architecture, contract table, INV-V27-1..8, Decision rationale — v27), state.yaml tech_stack, v27-gate0-asis-map.md, .panel/architecture/{quality-dimensions,adversarial}.r1.md (the Gate-2 panel and what the synthesis adopted/declined from each), src/{dashboard-page,dashboard,server,mcp-facade,run-manager,run-store,run-guard,agent-executor,types,skeleton-graph,workflow-view,system-info}.ts, src/store/sqlite-run-store.ts, src/params/resolve.ts, src/update-types.ts, tests/unit/{no-skeleton-surface,no-retired-surface,dashboard-page-source}.test.ts, tests/integration/{dashboard-http,dag-masking-auth,usage-live-equals-fold}.test.ts, tests/acceptance/val-193-dag-fit-and-columns.test.ts, tests/fixtures/v26-public-shapes.ts, vitest.config.ts, tsconfig.json, package.json. The design handoff (README.md / rwe-data.js / .dc.html) is NOT on disk in this checkout; every handoff fact is taken from the REQ text and the Gate-2 files.
---
# Quality-dimensions proposal — v27 DESIGN (Observability / Replaceability / Consumability / Self-sustainability)

## summary

Gate 2 already settled the *shape* of v27 and adopted most of what this lens asked for at that gate:
one usage accessor with a stated precedence (ARCH-127/128, ADR-052), the system prompt removed at
capture with the FACT kept (ARCH-129, ADR-050), the five-state connection machine with a ≥2-tick
Offline threshold (ARCH-124), vendored fonts behind an exact-match map (ARCH-123), no bundler / no CDN
/ no framework (ADR-049), puppeteer plus a computed-style table instead of a pixel diff (ADR-053), the
event-window truncation made visible (ARCH-125), one `dashboard_api_degraded` line (ARCH-130), and
ARCH-040's update panel pinned by INV-V27-5. **This proposal does not re-litigate any of that.** Its
job is one altitude down: for each ARCH item, what the DES rows must pin (signature, boundary, the
test that is the oracle) so that the property the ARCH promises survives implementation — and where a
TASK boundary decides whether it survives.

**The single most important thing this proposal says: there are four places where a Gate-6
implementer can satisfy the ARCH sentence *literally* and still lose the quality it was written for.
Each one is a design decision, not a coding detail, and each is the lead of its section below.**

1. **Replaceability — `theme-init.js` cannot do what ARCH-125 says it does.** It is specified as a
   *classic* `<script>` (it must run before first paint, so it cannot be a deferred module) that
   "stamps `accentVars()`" from `lib/theme.js` — but a classic script cannot `import` an ESM module.
   The literal reading forces a copy of the OKLCH formula into `theme-init.js`, i.e. a NEW server/
   client mirror pair of exactly the class ARCH-124's note promises to shrink. The design must pick a
   mechanism: I propose **the ramp lives in CSS as `oklch(L C var(--rwe-hue))` literals** (one home,
   no formula in any JS, `theme-init.js` writes one custom property), with the JS-table form as the
   recorded runner-up (§2 R-1).
2. **Consumability — ADR-054's "exact set equality" breaks on `RunSummary`'s four optional fields.**
   `costUSD`/`unpricedCalls`/`tokensTotal`/`agentCount` are *omitted together* for a run with no
   records (ARCH-127), so an exact `Object.keys` equality on `/api/runs[i]` passes or fails depending
   on which row the test samples. The key-set test must be `REQUIRED ⊆ keys ⊆ ALLOWED` with `ALLOWED`
   the literal — additions still fail (INV-V27-7 intact), optionality does not — and it must be
   driven from the same fixture that `satisfies` the route types (§3 C-2).
3. **Self-sustainability — the no-external-host guard must read `dashboard.css`.** After the split,
   `@font-face { src: url(...) }` lives in the CSS file, not in `DASHBOARD_HTML`; INV-V27-8 names
   `.js` walkers, and the existing CDN greps (`dashboard-diagram-render.test.ts`) read the HTML
   string. The one place a `fonts.googleapis.com` URL can actually land after v27 is the one file no
   guard reads (§4 S-5).
4. **Consumability — ARCH-131's masking predicate has no seam to arrive through.** ARCH-131 says it is
   "handed to the facade explicitly (its existing config/constructor seam), never inferred from the
   caller's `Principal`" — but `McpFacadeDeps` (`mcp-facade.ts:88-118`) carries no auth field at
   all today. The DES must name the dep, default it **fail-closed (masked when absent)**, and pin it
   with one integration assertion per server (open / auth) so the twice-bitten "forgot to forward"
   class cannot recur silently (§3 C-4).

Beyond those four: `connection.js` needs a per-route state and a transition-table test (§1 O-1); the
`UpdateOutcome → text` projection is decidable and belongs in `lib/` with a test, and the data island
is read once at load so an open tab never sees a *later* update outcome — a `/api/status` read every
Nth tick closes that within ARCH-125 (§1 O-4); `stripFirstSegment` must be `startsWith`-guarded with a
fail-closed branch, not a blind `sys.length + 2` slice (§1 O-8); the tick scheduler must not overlap
itself when a tick exceeds 3 s (§4 S-1); the three log lines each need a DoD line and a
`console.warn`-capturing test or they are the first thing dropped (§1 O-3); and the page-source pin
migration is a TASK in its own right, with a table, or the first rewrite commit goes red for
non-defect reasons and the assertions get deleted instead of moved (§5).

## Altitude call

**Both, exactly as Gate 2 split them; unchanged here.** System altitude: REQ-131 (shell, fonts, i18n,
connection tag), REQ-132/133 (views), REQ-134 (swimlane), REQ-140 (two serializations), REQ-141 (one
accessor). Agent altitude: REQ-135 (the slide-in panel IS the agent's inspectability), REQ-136 (what of
the agent's context may leave the process), REQ-140's `record` (the `AgentRecord` with
`provider`/`transport`/`proxyModel`/`phase`/`detail`/`unmapped`/`lastActivityAt`, `types.ts:215-291`).
*Memory metabolism* and *self-reflection* have no v27 requirement and no seam this slice touches;
named once in §4 S-8 and dropped.

---

## 1. Observability

**Design question for v27: does every state the wire can produce have a rendering, does every
silent path get a line in the journal, and is the agent panel a projection of the RECORD rather than
a reconstruction from the DOM?**

### System altitude

**O-1 — `lib/connection.js`: pin the state shape, the reducer, and the transition table.** ARCH-124
names `nextConnection(prev, tick)` over `'checking' | 'live' | 'degraded' | 'offline'` and a per-route
`ok | degraded | fail` classification, but a DES that leaves the state as a bare string loses the
≥2-tick rule and the "worst of the visible view's routes" rule at the first refactor. Proposal:

```
State = { status: 'checking'|'live'|'degraded'|'offline',
          consecutiveFails: number,            // all-fail ticks in a row; reset by any ok/degraded
          lastLiveAt: string|null,             // ISO of the last tick with ≥1 ok — the nav stamp
          perRoute: Record<Route, 'ok'|'degraded'|'fail'> }   // the visible view's routes only
nextConnection(prev: State, tick: { at: string; results: Record<Route, 'ok'|'degraded'|'fail'> }) → State
worstOf(perRoute) → 'live'|'degraded'|'fail'   // exported, pure — the nav tag reads THIS
```
Rules the transition table must enumerate (fixture is the oracle, never the function's own output):
any `ok` → `live`, `consecutiveFails = 0`, `lastLiveAt = tick.at`; a tick whose worst is `degraded`
→ `degraded` (the tag reads 「部分不可用」 only for the routes the visible view depends on — a run page
whose `/api/issues` would be degraded is still `live`); an all-`fail` tick → `consecutiveFails + 1`,
status stays `prev.status` at 1 and becomes `offline` at ≥ 2 (REQ-131 連續失敗 — one miss during a
self-update restart, ARCH-039/040, must not paint the team's tabs red); `checking` only before the
first tick. **The `demo` input slot** (REQ-143, out of closure) is reserved as a fourth tick field
(`demoEnabled?: boolean`) that this reducer ignores until its closure lands — which is why the reducer
is a pure function over inputs rather than `try { fetch } catch { offline }` (the ARCH scope paragraph
says exactly this). **The nav renders two things, not one:** the tag AND `lastLiveAt` formatted
`HH:MM:SS` — a green 「連線中 / Live」 tag over a stale stamp is the silent failure this lens forbids,
and the stamp is what makes REQ-142's later pause honest for free.

**O-2 — `ui/poll.js` `getJSON` is a classifier, and a degraded body is data with ONE rendering.**
Every `/api/*` fault is a 200 body carrying `degraded` (`server.ts:582-585` route-level,
`:1067-1071` dispatcher-level, `:462`/`:479` for issues; `system-info.ts:31-34` per section). Design:
`getJSON(url) → { kind:'ok', body } | { kind:'degraded', reason: string } | { kind:'fail', cause:
'network'|'http'|'parse', status?: number }` — never throws, never returns `null` (today's
`dashboard-page.ts:249` returns `null` for both a 404 and a network error, which is precisely how a
degraded shape reaches `h.running.filter(...)` and throws). The `degraded` kind renders the ONE
「無法取樣 / Unavailable」 component (REQ-138's wording, but the component is in closure because
`/api/home`'s degraded shape `{runs:[], degraded}` hits the home view today) in the region the route
feeds, and is never passed to a view's render function as if it were data. The classifier's inputs
are the response `status` and the parsed body; its output feeds `nextConnection` — so both are
testable in `node` with literal responses.

**O-3 — Three journal lines, each a DoD line with a test that captures `console.warn`.** The
existing convention is one structured line: `console.warn(JSON.stringify({ event: 'diagram_render_failed',
… }))` at `server.ts:440` — the ONLY structured event in the file today. v27 adds exactly three:
- `{event:'dashboard_api_degraded', route, reason, runId?, name?}` at BOTH catches (`server.ts:582-585`
  and `:1067-1071`) — the parameterised id when the route has one, so an operator whose team says
  「頁面顯示無法取樣」 can grep the journal for the run.
- `{event:'dashboard_asset_missing', key}` **once per key at boot** in `static-assets.ts` (ARCH-123),
  never per request — a font fetched by every page load would otherwise flood the journal every reload.
- `{event:'usage_backfill', healed: n, remaining: m}` **once per `listSummaries()` call that healed
  ≥ 1 run** (ARCH-127/128; §4 S-2 for the `remaining` mechanics) — the legacy cohort's migration is
  observable and self-reporting instead of silent.
Each line is a DoD bullet on its owning TASK and has a unit/integration test that installs a
`console.warn` spy and asserts the parsed JSON's `event` — otherwise "one log line" is the first
thing a time-boxed implementer drops, and the whole reason the ARCH wrote it is lost.

**O-4 — INV-V27-5: the `UpdateOutcome → display text` projection is decidable, so it is a `lib/`
function with a test; and the island is read once, so an open tab never sees a LATER outcome.**
Today `buildDashboardHtml(init)` (`dashboard-page.ts:58-87`) renders the panel inline from
`{lastUpdate:{tag,status,detail?,configCheck?}, interruptedRuns}` (`update-types.ts:13-19`). ARCH-122
moves the data to the `#rwe-init` JSON island; ARCH-125 says `ui/` decides nothing a pure function
could decide. So: `lib/status.js` → `updatePanelModel(init: {version, lastUpdate?, interruptedRuns?},
lang) → { version: string; update: { text, tone: 'pending'|'applied'|'failed'|'skipped' } | null;
configCheck: string | null; cta: string | null }` — the four branches `dashboard-page.ts:67-81` hard-
codes today (status colour map, `detail` `<pre>`, `configCheck` sentence, the `applied &&
interruptedRuns > 0` call-to-action) become four fixture rows. **Refinement inside ARCH-125, not new
scope:** the island is a load-time snapshot; after the systemd updater restarts the engine
(ARCH-039/040) a tab left open shows the OLD outcome (and runs the old `app.js` against the new
`/api/*`, exactly when REQ-140/141 change shapes). `/api/status` already serves
`{agentSemaphore, version, lastUpdate?, interruptedRuns?}` (`server.ts:1268-1281`) with no store read.
Proposal: `poll.js` includes `/api/status` in every view's fetch set **every 10th tick (30 s)**; the
same `updatePanelModel` re-renders the panel from it, and when `status.version !== init.version` the
nav shows 「引擎已更新至 vX,請重新整理 / engine updated — reload」. One fetch, two facts, the update
panel becomes live instead of load-time-only, and version skew is announced instead of discovered.
If the synthesizer rules this out of closure, the DES must at least record that INV-V27-5 is satisfied
at load time only.

**O-5 — REQ-141 on the page: the honesty qualifier travels with the number, as ONE formatter.**
`lib/runlist.js` gains `fmtCost(costUSD?: number, unpricedCalls?: number, lang) → string`: absent →
`—`; `unpricedCalls > 0` → `≥ $0.42 · 2 未定價` (the qualifier the current page already renders as a
"lower bound" note, `dashboard-page.ts:478-480`); else `$0.42`. Used by `historyRow` (REQ-133's 費用
column), the swimlane node's third row (REQ-134 `52k tok · $0.31 · 2m 10s`), and the home meta line —
where `metrics.avgCostUSD === null` renders `—` and `metrics.unpricedRuns > 0` appends 「(n 次未定價)」.
One formatter means one place the ledger's five-times-closed "confident $0.00" defect can regress,
and one fixture table locks it (ADR-046 / INV-V26-6).

**O-6 — The agent-panel truncation marker needs `hasMore` AND the window length, nothing else.**
`runAgentLog` windows at `limit ?? 50` and returns `hasMore` (`mcp-facade.ts:694-699`); ARCH-125
requests `?limit=500` and renders 「顯示 N / 共 M+」. Design: `eventListModel(events, hasMore) →
{ rows, marker: null | { shown: number, more: true } }` in `lib/`; the marker text is
「顯示 500 筆,尚有更多 / showing 500, more exist」 — the wire gives no total, so the panel must not
invent one (the ARCH's `M+` is exactly this). Per-row: `clipText(s, 2048) → { shown, clipped }` pure;
the click-to-expand swaps in the full string via `textContent` (D5).

### Agent altitude

**O-7 — REQ-135: the panel is a projection of `record` + `harness`, computed in `lib/`, and it shows
the three facts REQ-125 recorded, not one.** ARCH-131 puts `record: AgentRecord` on the wire so the
panel "stops reconstructing state, model, tokens and cost from the run view". The DES must make that
structural: `lib/agent-panel-model.js` → `panelModel(record, harness, events, hasMore, now, lang) →
PanelVM`, and `ui/agent-panel.js` renders the VM and nothing else. The VM's fields, every one an
existing wire field (`types.ts:215-291`, `:476-521`) except ARCH-129's `systemPrompt`:
- header: `label ?? agentId`, `state` tag, `phase` tag (+ `phaseIndex`), monospace `agentId`;
  `reasonCode` beside the tag on a `refused` record (REQ-120's record of a call that never dispatched).
- stat cards: **model card second line = `provider · transport (· proxyModel)`** — the v26
  REQ-125 triple exists so "which of the three paths broke" is answerable; `effortApplied` rendered on
  BOTH branches (`param = value` / `未套用:reason`), never only the happy one; timeout `15m 0s` with
  `900,000 ms`; duration from `startedAt`→`endedAt`, and while `state === 'running'` the **activity
  line**: `lastActivityAt` advancing past `startedAt` = progressing, `lastActivityAt` absent or equal
  to `startedAt` for > 60 s = 「無活動 / no activity」 — issue #20's hung-vs-progressing signal
  (`types.ts:284-290`), which today has no reader on the page; tokens as the four columns + sum;
  cost via `fmtCost(record.costUSD, record.unpriced ? 1 : 0)`.
- honest no-ops as tags: `harness.mcpUnresolved?.length` → 「1 個 MCP 伺服器未解析」; `record.unmapped?.length`
  → 「2 則未對應的供應商訊息」 — a capture with no reader is not observability.
- prompt pane: `harness.prompt` (the composed prompt minus segment 1) in the `<pre>`, and the
  **system-prompt fact sentence** (O-8).
- `record.detail` in the red block when present (redacted-then-capped at capture, `agent-executor.ts:646-681`).
The `tests/fixtures/dashboard-wire.ts` fixture (§3 C-1) supplies `record`/`harness`/`events` literals
for the four states, so `panelModel` is unit-tested in `node` against an external oracle.

**O-8 — REQ-136 at the decoration site: `stripFirstSegment` is `startsWith`-guarded with a fail-closed
branch, the order is strip → redact → cap, and the panel sentence is true on both cohorts.**
ARCH-129 specifies an exact prefix slice at `sys.length + 2` (the `\n\n` join, `params/resolve.ts:
181-183`) applied to `descriptor.prompt` at the one decoration site (`agent-executor.ts:646-681`). Two
design pins the ARCH text does not state:
- **Guard the slice.** `stripFirstSegment(prompt, sys)`: if `sys` is empty/undefined → return `prompt`
  unchanged, no `systemPrompt` field; if `prompt.startsWith(sys + '\n\n')` → slice; **else (the
  prefix is NOT where the composition put it) → persist NO prompt at all (`prompt: ''`) and emit
  `{event:'harness_prompt_prefix_mismatch', agentId, agentType}`**. "Guaranteed by construction" is
  one refactor of `composePrompt` or one third gateway away from false; a blind slice would then
  persist the system prompt's tail and cut the user's text, silently, with `val-082`'s non-empty
  assertion still green. Fail closed costs three lines and one log line.
- **Order.** `strip → redact() → capPrompt` — the strip cuts at a segment boundary so it cannot split a
  secret (R-G9 stays true); `redact` runs on the stripped text; the 4 KB cap last.
- **The fact and its wording.** `harness.systemPrompt?: { agentType, bytes }`, present iff a non-empty
  agentType prompt was applied (ARCH-129). The panel sentence: present → 「系統提示詞:已套用(agentType
  reviewer,1,204 bytes)— 不顯示」; **absent → 「無 system prompt 紀錄 / no system-prompt record」** — NOT
  「未套用」. On a post-v27 record absent means "not applied", but on a pre-v27 record (ARCH-129's
  accepted gap: the composed blob, no agentType name) absent means "unknown", and the client cannot
  tell the cohorts apart. The chosen wording is literally true on both; 「未套用」 would be a confident
  wrong statement on the legacy cohort, the same defect class as a confident `$0.00`.
- **INV-V27-2's test is a wire test on both surfaces** (ADR-054): an agentType whose system prompt
  contains a distinctive 64-byte marker, one real run through the facade, then assert that
  `JSON.stringify(body)` of BOTH `GET /api/runs/:id/agents/:agentId` and MCP `run_agent_log` contains
  no 32-byte window of the marker, AND that `harness.prompt` still contains the script prompt and the
  `USER_INSTRUCTIONS` framing (so `val-104:79-81` and `val-082:138-140` stay green unchanged).

---

## 2. Replaceability

**Design question for v27: is every piece of data the design tunes (theme, strings, geometry, the
asset list, the wire shapes) in exactly ONE home, and is the client's DOM layer thin enough that a
view can be rewritten without touching a formula?**

### System altitude

**R-1 — `theme-init.js` cannot import `accentVars`; put the OKLCH ramp in CSS and make the classic
script formula-free.** ARCH-125: `theme-init.js` is a classic script in `<head>` (it must run before
first paint — a `type="module"` script is deferred and would paint dark-then-light) that "stamps
`data-theme` / `lang` / `accentVars()` on `documentElement`"; ARCH-124 puts `accentVars(hue, dark)` in
`lib/theme.js`. A classic script has no `import`; the literal reading therefore copies the formula
into `theme-init.js` — a new server/client mirror pair (the class the as-is map lists five of, §A, and
ARCH-124's note promises not to grow). Two coherent designs:
- **(i) CSS-native ramp (proposed).** `dashboard.css` declares `--rwe-hue: 236` as the no-storage
  default and every accent token as an `oklch()` literal over it: `--color-accent: oklch(0.72 0.065
  var(--rwe-hue))` under `:root[data-theme="dark"]`, `oklch(0.56 0.065 var(--rwe-hue))` under
  `[data-theme="light"]`, and `--accent-100 … --accent-900` as `oklch(L_n C_n var(--rwe-hue))` with the
  README's L/C sequence as literals. `theme-init.js` then does exactly three things, none a formula:
  read `rwe-theme` / `rwe-lang` / `rwe-hue` from `localStorage` (each in `try/catch`), stamp
  `data-theme` + `lang` + `style.setProperty('--rwe-hue', h)`, and subscribe to
  `matchMedia('(prefers-color-scheme: dark)')` for the 「系統」 setting. The hue slider (module side)
  writes the same one property and `localStorage['rwe-hue']`. REQ-131's acceptance — `--color-accent`
  「依 OKLCH 公式重算」 and the value in `localStorage['rwe-hue']` — is met by the browser recomputing
  the token stream; ADR-053's computed-style row reads
  `getComputedStyle(root).getPropertyValue('--color-accent')` → `oklch(0.72 0.065 236)` (an
  unregistered custom property computes to its substituted token stream, deterministic and
  string-comparable), and C4(a) is settled by construction (no hex is ever copied). `lib/theme.js`
  shrinks to `PREF_KEYS = {theme:'rwe-theme', lang:'rwe-lang', hue:'rwe-hue'}`, `clampHue(h) → 0..359`,
  and `prefsFromStorage(get) → {theme, lang, hue}` (pure over an injected getter, so the module side
  and the tests share it).
- **(ii) JS ramp as ARCH-124 wrote it**, with the classic script duplicating `accentVars` and a
  `new Function` equality test pinning the copy against `lib/theme.js` — the Gate-2 R-2 fallback the
  synthesis dropped.
(i) has one home for the formula (the CSS), zero formula in JS, and one fewer mirror; (ii) honours
the ARCH-124 text literally at the cost of the mirror it was written to avoid. Either way **the DES
must choose and say why**; the swimlane box math (`lib/swimlane.js`) is unaffected because the
server needs none of it (Decision rationale, "the server/client mirror pairs").
**One source pin survives on purpose:** `theme-init.js` is the one client file vitest cannot import
(a classic script with side effects), so a unit test reads its text and asserts each `PREF_KEYS`
value occurs in it — the same kind of pin the page-source tests use today, kept only where an import
is impossible.

**R-2 — The mirror class ends this iteration; record what dies and what is merely dead.** After
ARCH-124/125 the browser computes `viewBox` via `svgBox` and the server emits logical `col`/`row`
only, so `DAG_BOX_DEFAULTS` / `dagBox` (`dashboard.ts:272-296`) lose their client interpolation
(`dashboard-page.ts:518`) and `cellToPixel` / `cellToPixelLocal` / `morandiFrameHue` / `stableHash`
(`dashboard-page.ts:20-48, 519-521`) lose their client copies. ADR-056 flags rather than deletes the
`buildDagModel` orphan; the DES should extend the same flag to these five server-side leftovers (still
exported, still unit-tested by `morandi-renderer.test.ts` / the `dagBox` test, zero production
consumer after v27) with one sentence each in 04-design, so the next reader does not re-derive why a
tested function has no caller. The new client has exactly ONE home per figure: `SWIMLANE_BOX`,
`laneX`, `cellRect`, `edgePath`, `svgBox` in `lib/swimlane.js`; `sumTokens` (client) reads
`record.tokens` and is the one four-column sum in `lib/runlist.js`.

**R-3 — `STATIC_ASSETS` is the seam for swapping bytes; make it closed in BOTH directions.** ARCH-123
builds the map from a literal key list. Design: the list is `as const`; a unit test asserts (a) every
listed key resolves to an existing file under `src/dashboard/` and (b) every `.js`/`.css`/`.woff2`
file under `src/dashboard/` is listed — a module renamed on disk but not in the map would 404 in
production while the unit tests (which import by path) stay green: "did you register the asset" is
the new "did you rebuild". (c) `fonts/SOURCE.md` and `fonts/OFL.txt` exist and `SOURCE.md` names a
sha256 per woff2 that matches the file. Adding a client module costs one map entry, one test row, and
nothing else — which is the consumability of the seam.

**R-4 — `ui/` renders VMs; a view is replaceable without touching a formula.** Every view function in
`ui/` takes `(container, vm, handlers)` where `vm` is the output of a `lib/` projection
(`homeModel`, `workflowModel`, `swimlaneModel`, `panelModel`, `updatePanelModel`, `eventListModel`)
and `handlers` are the delegated listeners on the stable wrapper. Invariants the DES pins as boundary
lines: `textContent` only (D5); the transform on `#dag-zoom`, children rebuilt (D6, INV-V27-6);
`initZoomable` moves verbatim (~40 lines, `dashboard-page.ts:693-718`) into `ui/run.js` and is
initialised once for both wrappers; listeners delegated on `#dag-graph` / the table / the card grid so
a tab open for days does not accumulate one handler per node per tick.

**R-5 — The wire fixture is the one typed artifact, and `.js` tests are the reason it is `.ts`.**
ADR-049's `tests/fixtures/dashboard-wire.ts` `satisfies` the server's route types so `tsc --noEmit`
fails on drift, and the `.js` tests import it (vitest transpiles the `.ts` import from a `.js` test;
the tests are `.js` because a `.test.ts` importing `src/dashboard/lib/*.js` would fail `tsc` with
TS7016 in the absence of `allowJs`, which ADR-049 refuses). The DES must state this pairing so a
well-meaning Gate-6 change to `.test.ts` does not reintroduce the tsconfig change ADR-049 declined.

### Agent altitude

**R-6 — The LLM-backend swap is untouched and the design keeps it that way.** REQ-136's split lives in
the executor's decoration site, not in either gateway (`gateway/client.ts:493-508`,
`claude-agent-sdk-client.ts:691` keep emitting `prompt: req.prompt`), so a third transport needs no
REQ-136 code; and the panel's `provider · transport · proxyModel` line (O-7) is where a swap stays
visible. No v27 DES row may add a gateway-specific branch to the descriptor.

---

## 3. Consumability

**Design question for v27: can the two consumers — a human in a browser and a cold model on MCP —
integrate against the v27 wire from one contract, one fixture, one documentation section, and does
every widening cost a visible line?**

**C-1 — One fixture, three checks.** `tests/fixtures/dashboard-wire.ts` (precedent
`tests/fixtures/v26-public-shapes.ts`, DES-189: literal expected JSON, not vitest-collected) carries,
per route, a literal response and an `EXPECTED_<ROUTE>_KEYS` tuple: `RunSummary` (with and without the
four optional fields), `GraphPayload & { lanes, current }`, `{ runId, status, record, harness, events,
result, hasMore }` with `harness.systemPrompt` present and absent, `HomeView` with `metrics.avgCostUSD`
/ `unpricedRuns`, and `WorkflowDescribeView & { diagramContract, toolSurface, phases[].agents? }` (the
TRUE describe shape, as-is §A). Check 1: `satisfies` the route types → `tsc`. Check 2: ADR-054's
key-set test imports the `EXPECTED_*_KEYS` → runtime. Check 3: the `.js` render tests import the
literals → runtime. One oracle; a wire change edits one file and three checks move together.

**C-2 — The key-set test's shape: `REQUIRED ⊆ keys ⊆ ALLOWED`, never bare equality.** ADR-054 says
"exact set equality that fails on additions". On `/api/runs[i]` the four summary fields are omitted
together for a run with no records (ARCH-127) and `agentCount` additionally for the legacy cohort;
`/api/runs/:id/agents/:agentId` omits `harness.systemPrompt` when none applied; `/api/runs/:id/dag`
omits `truncated`/`terminalAt`. Bare equality passes or fails by which row the test happens to
sample. Design: per route, `ALLOWED` (the literal, exact) and `REQUIRED ⊆ ALLOWED`; assert
`every key ∈ ALLOWED` (an addition fails — INV-V27-7's property, intact) and `every REQUIRED key
present`. The assertion's SHAPE is what may not be relaxed (ADR-054); its contents change by editing
the fixture. The same test file is where INV-V27-2's marker assertion (O-8) lives, so REQ-136 is
proven against the body on both transports next to the key set.

**C-3 — The MCP consumer needs the contract change in three places, not one.** `run_agent_log`'s
`harness.prompt` no longer carries the agentType segment and gains `record` + `harness.systemPrompt`
(ARCH-129/131, contract table row). Design DoD lines: (a) `tool-specs.ts`'s `run_agent_log` output
description names `record`, `harness.systemPrompt {agentType, bytes}`, and says in one sentence that
`harness.prompt` excludes the agentType system prompt — the guard `no-skeleton-surface.test.ts:90-93`
reads `projectToolsList()`, so the wording must not use the retired word; (b) the v24 tool-surface
table (`tests/acceptance/v24-tool-surface.test.ts` + `v24-tool-surface.md`, TASK-195 precedent) is
regenerated with the new row; (c) the cross-repo check in the contract table (the `rwe-mcp` plugin
reading `harness.prompt`) is one Gate 5 grep of the plugin repo recorded in the TASK's report, plus
one release-note line. Missing any of the three is how a cold model learns the change from a failed
call.

**C-4 — ARCH-131's masking predicate: name the dep, default fail-closed, pin both servers.**
`McpFacadeDeps` (`mcp-facade.ts:88-118`) has no auth field; ARCH-131 forbids inferring from
`principal.kind` (the dashboard passes `{kind:'auth-disabled'}` regardless of the real setting,
`server.ts:563`, `:400-410`). Design: `McpFacadeDeps.maskPredictedOverlay?: boolean` — **absent ⇒
`true` (masked)**, so a unit-constructed facade and a forgotten forward both degrade to lanes-only
(honest, visible in the open-server integration test that asserts `phases[].agents` PRESENT) rather
than unmasking under auth; `server.ts` forwards `maskPredictedOverlay: !!authCfg` at the ONE facade
construction. Two integration assertions, one per server (the `dag-masking-auth.test.ts` harness
already boots both): open → `describe.phases[].agents` present and `dag.lanes` includes unreached
lanes; auth → `agents` absent, `dag.lanes` = observed only, `dag.current` present, IT-092's
`['__trigger__']` assertion (`:114-126`) unchanged. When the owner answers ADR-051, the change is the
one forwarded boolean (or its removal) and IT-092's rewrite under its own ID — no arithmetic moves.

**C-5 — `deriveLanes`'s "omit when no records" rule and `agentCount`'s meaning, stated once.**
ARCH-127: the four summary fields are omitted together when the run has no agent record. Design
precision: SQLite gates the projection on `json_array_length(s.json,'$.agents') > 0` (a terminal run
whose script called no agent has a snapshot with `agents: []` and `usage` of zeros — it must render
`—`, not `$0.00`); the live overlay gates on `entry.records.length > 0`; `agentCount` counts records
of EVERY state (`queued`/`running`/`done`/`failed`/`refused`) because the swimlane draws them all —
「節點數」 is nodes drawn, not calls priced. `tokensTotal` is the four-column sum. All four are stated
in the contract row and in the fixture's two `RunSummary` literals.

**C-6 — The static route's headers are part of the contract.** `GET /static/dashboard/<key>`: fixed
`Content-Type` per extension, `Cache-Control` split (`immutable` woff2 / `no-store` js+css), `X-Content-
Type-Options: nosniff` (the diagram route sets it, `server.ts:444-454`; one line, consistent), 404 for
an unknown key, GET-only. The CSP row on `/dashboard` stays exactly the ARCH string — `blob:` in
`img-src` is test-pinned (`createObjectURL`), `'unsafe-inline'` for styles is the honest floor.

**C-7 — The human-facing doc is README.md:368 「Dashboard JSON REST API」, and it is a DoD line.**
Every v27 wire delta is one row there: `RunSummary`'s four optional fields and the omit rule;
`dag.lanes` / `current` and the masking sentence; `record` and `harness.systemPrompt` on the agent
route with the "prompt excludes the agentType system prompt" sentence; `describe.phases[].agents`;
`/static/dashboard/*`. DEPLOY.md is unchanged (the health check at `/api/status` survives). A
consumer who reads the README before the code is the consumability test.

**C-8 — Lanes render from either shape without a branch.** Under ADR-051(a) the auth server serves
observed lanes only; the client does not know the auth setting and must draw the same swimlane from
`lanes[]` of any length, with `current` from the wire (never `phases.length - 1` recomputed). The
predicted-layout view (REQ-133) reads `describe.phases[].agents` when present and falls back to
lanes-only with the 「尚無執行 / not run yet」 note when absent — the wording is `predictedLayout`, never
the C3 word, in `lib/strings.js`.

---

## 4. Self-sustainability

**Design question for v27: a team leaves the page open for days, the engine restarts itself on
release tags, the run table grows to a year of scheduled runs, the legacy cohort heals itself — does
the page keep telling the truth without a human touching it?**

### System altitude

**S-1 — One scheduler, and a tick never overlaps the previous one.** ARCH-125: `app.js` owns one
`setInterval(tick, 3000)`. Over a tunnel with N = 1 000 runs (ADR-052's own measurement case) a tick's
fetch set can exceed 3 s, and `setInterval` then stacks requests — the client itself becomes the
load. Design: `scheduleNext()` = `setTimeout(tick, 3000)` armed in `tick().finally(...)`, i.e. "3 s
after the last tick settled", still one timer, still ARCH-125's per-view `endpointsFor(view)`; and it
is exactly the seam REQ-142's visibility gate attaches to (skip arming while hidden, one immediate
tick on `visibilitychange` → visible). `tick` itself is `(view, tickNo) → Promise<void>`; the pure
decision `endpointsFor(view, tickNo)` (which includes `/api/status` on `tickNo % 10 === 0`, O-4) is
unit-tested in `node`.

**S-2 — `backfillUsage` heals the legacy cohort once, converges, reports, and stops probing.**
ARCH-127/128: `listSummaries()` folds ≤ `BACKFILL_PER_TICK = 25` snapshot-less terminal runs per call
via `store.getRun` and writes back `{usage}` only. Design pins: (a) idempotent — `backfillUsage` is a
no-op unless `status ∈ TERMINAL` and the snapshot row has no `usage` (re-check inside the store, not
only in the manager); (b) convergent — a `{usage}`-only row is behaviour-preserving because `getRun`
reads every other field through `??` (`sqlite-run-store.ts:270-277`), and `saveSnapshot`'s `INSERT OR
REPLACE` writes the whole object (`:287-289`); (c) `InMemoryRunStore` implements both halves
(`run-store.ts:340-360` is where its `usage` fallback lives today); (d) **progress is observable and
bounded**: the manager keeps `_backfillRemaining: number | null`; the first `listSummaries()` after
boot runs one indexed `COUNT(*)` over terminal runs whose snapshot lacks `usage`, emits
`{event:'usage_backfill', healed, remaining}` on every call that healed ≥ 1, and **stops issuing the
COUNT once `remaining` reaches 0** (a restart re-probes once). The migration therefore costs one COUNT
per tick only while there is something to heal, and the journal shows it finishing.

**S-3 — The list path stays O(1) statements as the table grows, and the N = 1 000 measurement is a
TASK deliverable, not a hope.** ARCH-128's single `LEFT JOIN run_snapshots` + `json_extract` is the
mechanism; the DES pins the proof: an integration test wraps `SqliteRunStore`'s `_db.prepare` in a
counting proxy and asserts `listRuns()` issues exactly ONE statement regardless of N (10 and 1 000
seeded runs), and `listSummaries()` issues ≤ 1 + `BACKFILL_PER_TICK` on the first call and 1 on the
second. ADR-052's measurement harness is defined now: a script under `scripts/` (or a Gate 7.5
acceptance test) seeds 1 000 synthetic terminal runs WITH snapshots into a temp SQLite, boots the real
`createServer()`, and records p50/p95 of `GET /api/runs` and `GET /api/home` into 08-validation.md.
That number — not an argument — is what decides whether v28 adds `?workflow=&limit=`.

**S-4 — Long-lived-tab hygiene, pinned where it can regress.** The transform on `#dag-zoom` with
children rebuilt (D6) — proven by val-193's real drag-then-Fit, not by a page-source pin (ADR-053);
delegated listeners on stable wrappers (R-4); the event window bounded (O-6); `renderDiagram`'s
`createObjectURL`/`revokeObjectURL` pair and `diagramKey` memoisation (fetch once per (name, version),
not once per tick) move to `ui/workflow.js` and their pins in `dashboard-diagram-render.test.ts` are
re-pointed to that file's bytes under their existing UT id (§5 table). No new pin is written against
`DASHBOARD_HTML` for client behaviour — it holds markup and CSS only after v27.

**S-5 — The offline stance must survive the file move: the no-external-host guard reads the CSS.**
After the split the only place an external host can enter is `dashboard.css` (`@font-face { src:
url(...) }`) and, secondarily, the `.js` modules (`fetch`/`import` of a foreign URL). The existing
CDN greps read `DASHBOARD_HTML` (`dashboard-diagram-render.test.ts`), which after v27 contains neither
fonts nor scripts, and INV-V27-8 names `.js` walkers only. Design: one guard test reads every
`src/dashboard/**/*.{css,js}` and asserts (a) no `https?://` occurs outside a comment, (b) every CSS
`url(` argument starts with `/static/dashboard/`, (c) no `@import`. Plus the runtime half: the CSP
(`font-src 'self'; connect-src 'self'; script-src 'self'`) — an acceptance row in the real browser
asserts `performance.getEntriesByType('resource')` lists only same-origin URLs after a full load of
each view. Build-time grep and runtime control, both.

**S-6 — Guards see the served bytes (INV-V27-8), and this lands BEFORE the first client file.**
`no-skeleton-surface.test.ts:61` and `no-retired-surface.test.ts:29` filter `entry.endsWith('.ts')`;
both walkers gain `|| entry.endsWith('.js') || entry.endsWith('.css')` (the CSS for the C3 word in a
class name or comment — the handoff's own i18n key is `skeleton`, C3). The six-file allowlist is not
widened; `src/dashboard/**` may not contain the word at all. §5 makes this a task-ordering rule.

**S-7 — Assets fail soft, wiring fails loud.** A missing woff2 → `font-display: swap` + the fallback
stack + one boot-time `dashboard_asset_missing` line (O-3); never a boot failure. No v27 config key is
added (the scope paragraph: theme/lang/hue are `localStorage`, not `composeConfig()`); the first key
that IS added (REQ-143's `demoEnabled`, out of closure) goes through `composeConfig()` and
`compose-config-v2-wiring.test.ts` — recorded here so the sentence is already in the ledger when that
closure is dispatched. The `maskPredictedOverlay` dep (C-4) is not a config key — it is derived from
the existing `auth` block at the facade's construction — but its fail-closed default is the same
lesson applied to a constructor.

### Agent altitude

**S-8 — Memory metabolism and self-reflection: not applicable, one sentence.** No v27 requirement asks
the dashboard to summarise, archive or calibrate anything; the agent panel reads what the engine
journaled. The only "metabolism" in scope is display-bounded: the 500-event window with its marker
and the 2 KB per-row clip (O-6). The one closed loop the page has with the agent runtime is money
(O-5), and its design rule is that an unknown price is a qualifier, never a zero.

**S-9 — The pending owner decision (ADR-051) must be a one-boolean change in either direction.**
`deriveLanes(phases, expected, { masked })` (ARCH-126) and `maskPredictedOverlay` (C-4) are the two
call sites; both take the same boolean derived from `!!authCfg`. If the owner reverses the mask, the
boolean becomes `false` everywhere and IT-092 is rewritten under its ID; if not, REQ-133/134's
acceptance is scoped as ADR-051 states. Either way the VAL row 「`auth.enabled:true`,one case,record
what degrades」 is named in 03-tasks now (ADR-051's own consequence), not discovered at Gate 7.5.

---

## 5. Where task-splitting decides whether a property survives (for the design synthesizer)

The dispatch asked each lens to say where task boundaries touch its dimension. Six rules:

1. **Guards first.** The `.js`/`.css` walker change (S-6) and the no-external-host CSS guard (S-5)
   land in the same TASK as, or before, the first file under `src/dashboard/` — a later task can
   otherwise ship the C3 word or a Google Fonts URL with CI green.
2. **The page-source pin migration is its own TASK, with a table.** Roughly twenty assertions across
   `dashboard-page-source.test.ts` (UT-191/222/224/227), `dashboard-zoom-source.test.ts`,
   `dashboard-diagram-render.test.ts`, `workflow-page-harness-table.test.ts`, `morandi-renderer.test.ts`
   read `DASHBOARD_HTML`'s client JS, which the rebuild deletes. Each row of the table says one of:
   **stays** (CSS/markup pins: `.fit-btn{position:relative;z-index:1;`, `#diagram-img{…-webkit-user-
   drag:none}`, `<img id="diagram-img" … draggable="false"`, the `/describe` fetch literal count —
   still in `DASHBOARD_HTML` or re-pointed to `dashboard.css` bytes); **moves** (behaviour pins
   re-pointed under the same UT id to the served file's bytes: `createObjectURL`/`revokeObjectURL` and
   `diagramKey` → `ui/workflow.js`, `viewBox`/`preserveAspectRatio`/no absolute width → `ui/run.js`,
   `(m.aliases||[]).forEach` → the alias index in `lib/runlist.js` as a real unit test); or **retires**
   (the `mousedown preventDefault` literal and `sumTokens`/`tokenCols` text pins → val-193/val-197's
   real-mouse proofs and the `lib/` unit tests, per ADR-053). Without this task the first rewrite
   commit turns them red for non-defect reasons and the cheapest "fix" is deletion.
3. **Fixture and key-set test first (Gate 5 RED).** `tests/fixtures/dashboard-wire.ts` + the ADR-054
   test are one TASK scheduled before every client-view task, because every view's unit test imports
   the fixture and every backend delta edits it.
4. **One backend TASK for REQ-141**: `listSummaries` + `listRuns` JOIN + `backfillUsage` (both stores)
   + the O(1)-statements assertion + the `usage_backfill` line + the N = 1 000 harness as DoD lines.
   Splitting the measurement off is how it becomes "later".
5. **One TASK for REQ-136 with four DoD lines**: the guarded strip at the decoration site; the
   both-surfaces marker test; `tool-specs.ts` + README:368 + the tool-surface table; the plugin-repo
   grep + release-note line. The doc lines are where a cold model's integration cost is paid.
6. **INV-V27-5 and the three log lines are DoD bullets with tests**, on the shell task (`updatePanelModel`
   + its unit test + the `/api/status` tick) and on the owning tasks for each `console.warn` line —
   never implicit in "rebuild the page".

---

## key_points

1. **`theme-init.js` cannot ESM-import; put the OKLCH ramp in CSS** (`oklch(L C var(--rwe-hue))`), make
   the classic script formula-free (three `localStorage` reads, three stamps, one `matchMedia`
   subscription), shrink `lib/theme.js` to `PREF_KEYS`/`clampHue`/`prefsFromStorage`; ADR-053's
   computed-style row reads the substituted token stream (R-1). Runner-up: JS ramp + `new Function` pin.
2. **`connection.js` state = `{status, consecutiveFails, lastLiveAt, perRoute}`**, reducer + `worstOf`
   pure, transition-table test with the fixture as oracle, nav renders tag AND stamp, `demo` input
   slot reserved (O-1). `getJSON` classifies `ok | degraded | fail`, never throws, never `null`;
   `degraded` renders the ONE Unavailable component (O-2).
3. **Key-set test shape is `REQUIRED ⊆ keys ⊆ ALLOWED`**, driven by `tests/fixtures/dashboard-wire.ts`
   (one fixture: `satisfies` for tsc, `EXPECTED_*_KEYS` for the runtime test, literals for the `.js`
   render tests); INV-V27-2's marker assertion lives in the same file (C-1, C-2).
4. **`McpFacadeDeps.maskPredictedOverlay?: boolean`, absent ⇒ masked**, forwarded as `!!authCfg` at the
   one construction; one integration assertion per server (open: `agents` present + unreached lanes;
   auth: absent + observed-only + IT-092 unchanged). ADR-051 either way = one boolean (C-4, S-9).
5. **`stripFirstSegment` is `startsWith`-guarded, fail-closed on mismatch** (persist no prompt, emit
   `harness_prompt_prefix_mismatch`); order strip → redact → cap; panel wording for an absent fact is
   「無 system prompt 紀錄」, true on both cohorts (O-8).
6. **REQ-135's panel is `panelModel(record, harness, events, hasMore, now, lang) → VM` in `lib/`**;
   renders `provider · transport · proxyModel`, both `effortApplied` branches, `mcpUnresolved`/`unmapped`
   counts, `lastActivityAt`-vs-`startedAt` for a running agent, `reasonCode`, `detail` (O-7).
7. **Three journal lines, each a DoD line with a `console.warn`-capturing test**: `dashboard_api_degraded`
   (both catches, with the parameterised id), `dashboard_asset_missing` (once per key at boot),
   `usage_backfill {healed, remaining}` (O-3, S-2).
8. **`updatePanelModel` in `lib/status.js` with a four-row test (INV-V27-5)**; `/api/status` read every
   10th tick re-renders the panel live and announces version skew — inside ARCH-125, no new endpoint
   (O-4).
9. **One formatter `fmtCost(costUSD?, unpricedCalls?, lang)`** for the history table, the swimlane node
   and the home meta line; absent → `—`, unpriced → `≥ $x · n 未定價` (O-5). Omit-together rule gated on
   `json_array_length(...'$.agents') > 0` / `records.length > 0`; `agentCount` counts every state (C-5).
10. **Scheduler = self-rescheduling `setTimeout` after settle**, one timer, per-view fetch set,
    `endpointsFor(view, tickNo)` pure; REQ-142 attaches here later (S-1).
11. **`backfillUsage`: idempotent, terminal-only, in-memory parity, ≤ 25/call, COUNT-probed until
    `remaining === 0` then stops** (S-2); **O(1)-statements assertion via a counting `prepare` proxy +
    the N = 1 000 seed/timing harness as DoD** (S-3).
12. **The no-external-host guard reads `src/dashboard/**/*.{css,js}`** (no `https?://`, every `url(`
    under `/static/dashboard/`, no `@import`) plus a real-browser resource-origin check (S-5); walkers
    gain `.js` and `.css` BEFORE the first client file (S-6).
13. **`STATIC_ASSETS` closed both ways** (listed ⇒ on disk, on disk ⇒ listed, `SOURCE.md` sha256 matches)
    (R-3); five server-side leftovers (`DAG_BOX_DEFAULTS`, `dagBox`, `cellToPixel`, `morandiFrameHue`,
    `stableHash`) flagged like ADR-056's orphan, one sentence each (R-2).
14. **MCP consumer: `tool-specs.ts` wording + tool-surface table + plugin grep + README:368 rows** are
    DoD lines on the REQ-136/140/141 tasks (C-3, C-7).
15. **Task order**: guards → pin-migration table → fixture + key-set → backend REQ-141 → REQ-136 → views;
    INV-V27-5 and the log lines are DoD bullets with tests, never implicit (§5).

## risks

| # | Risk | Severity | Where it lands |
|---|---|---|---|
| QD-D1 | **`theme-init.js` copies the OKLCH formula** because the ARCH text says "stamps `accentVars()`" and a classic script cannot import — a new mirror pair with no lock, and the hue slider and first paint drift apart on the first ramp tweak. | HIGH | ARCH-124/125, REQ-131 (R-1) |
| QD-D2 | **The key-set test is written as bare equality** and fails or passes by which `/api/runs` row it samples (four optional fields omitted together; `systemPrompt`, `truncated`, `terminalAt` optional) — the likely "fix" is relaxing the assertion, the one thing ADR-054 forbids. | HIGH | ADR-054, INV-V27-7 (C-2) |
| QD-D3 | **An external font host enters through `dashboard.css`** where no guard reads; the offline stance that is test-locked today becomes convention the day the CSS moves out of the HTML string. | HIGH (certainty) / LOW (cost) | REQ-131, INV-V27-3 (S-5) |
| QD-D4 | **The masking predicate is inferred from `principal.kind` or defaulted open**; the dashboard's synthetic `{kind:'auth-disabled'}` principal then unmasks `phases[].agents` under auth on exactly the route REQ-133 renders — every assertion green, ADR-051's deferral inverted. | HIGH | ARCH-131, ADR-051/055 (C-4) |
| QD-D5 | **`stripFirstSegment` slices blindly at `sys.length + 2`**; a future composition change or a third gateway persists the system prompt's tail and cuts user text, silently, with `val-082` still green. | MID | ARCH-129, INV-V27-2 (O-8) |
| QD-D6 | **The page-source pins are deleted rather than migrated** when the rewrite turns ~20 of them red for non-defect reasons; D8/D10/D11's reasons vanish with them. | MID | UT-191/222/224/227, ADR-053 (§5.2) |
| QD-D7 | **`setInterval` stacks requests** when a tick exceeds 3 s over a tunnel at N = 1 000 — the client becomes the load ADR-052 is measuring. | MID | ARCH-125, ADR-052 (S-1) |
| QD-D8 | **INV-V27-5 is satisfied at load time only**: the island is read once, so an open tab shows a stale update outcome and runs the old client against the new API after a self-update. | MID | ARCH-122, ARCH-040 (O-4) |
| QD-D9 | **The three log lines are dropped** as "nice to have" under time pressure; the dashboard's degrade paths stay silent 200s and the backfill migration is invisible. | MID | ARCH-130/123/127 (O-3) |
| QD-D10 | **`backfillUsage` re-probes forever or overwrites** — a COUNT per tick after convergence, or a write that touches a snapshot that already has `usage`. | LOW | ARCH-128 (S-2) |
| QD-D11 | **The panel says 「未套用」 for an absent `systemPrompt`** — a confident wrong statement on every pre-v27 record (ARCH-129's accepted gap). | LOW | REQ-135/136 (O-8) |
| QD-D12 | **A renamed client module 404s in production** while path-importing unit tests stay green — the asset map is open on the disk side. | LOW | ARCH-123 (R-3) |
| QD-D13 | **The `.js` tests get "upgraded" to `.test.ts`** at Gate 6 and `tsc` fails with TS7016, pulling the `allowJs`/`DOM`-lib change ADR-049 refused back in. | LOW | ADR-049 (R-5) |
| QD-D14 | **`agentCount` / omit-rule ambiguity** — a terminal run with `agents: []` renders `$0.00`, or 「節點數」 counts only `done` calls while the swimlane draws refused/queued nodes. | LOW | ARCH-127/128 (C-5) |

## expected disagreements with other lenses

- **vs. the adversarial / simplicity lens — on O-4 (the `/api/status` every-10th-tick read) and S-2's
  `remaining` COUNT.** They will call the first scope creep and the second an unnecessary query. On
  O-4: INV-V27-5 without it is load-time-only, the route already exists and costs no store read, and
  version skew after a self-update is the exact moment REQ-140/141's shape deltas bite — one fetch,
  two facts. On S-2: the COUNT is issued only while `remaining > 0` and stops at convergence; without
  the number the journal says "healed 25" forever with no way to tell when the migration is done. If
  they win on O-4, the DES must record INV-V27-5 as load-time-only; if they win on S-2, keep the
  `healed` count at least.
- **vs. the design synthesizer / architect — on R-1 (CSS-native ramp vs ARCH-124's literal
  `accentVars()`).** They may hold the ARCH text. My position is that both satisfy the ARCH's intent
  ("data with one home each") and only (i) satisfies its note ("the mirror class shrinks"); the
  classic-script constraint is a fact of the platform, not a preference. If they hold (ii), the
  `new Function` equality pin is the minimum and must be a named test, not a comment.
- **vs. the architect — on O-8's `startsWith` guard ("the prefix is guaranteed by construction").**
  It is guaranteed today by `composePrompt` (`params/resolve.ts:175-186`) and by the executor passing
  the composed string to `_invokeOnce`; it stops being guaranteed the day either changes, and the
  failure mode is a silent persist of the wrong half. Three lines plus one log line buy fail-closed.
- **vs. a UX lens — on S-1 (`setTimeout` after settle vs a strict 3 s cadence).** They will want the
  metronome. "3 s after the last tick settled" is indistinguishable at loopback and is the only
  behaviour that does not pile up requests over a slow tunnel; VAL-018's "SSE or polling" is
  unaffected.
- **vs. a testability lens — on C-2 (`⊆` instead of equality) and on keeping ONE source pin for
  `theme-init.js`.** They may say a subset assertion is weaker. It is not weaker on the property that
  matters (an addition fails); it is correct on optionality, which bare equality is not. The
  `theme-init.js` text pin is the one place an import is impossible, and it is pinned against
  `PREF_KEYS` constants, not free-hand strings.
- **vs. a security lens — on O-8's wording 「無 system prompt 紀錄」.** They may prefer the ARCH's
  「未套用」/「套用了但不顯示」 dichotomy. The dichotomy is exact only post-v27; the chosen wording is
  the one true statement on both cohorts, and the `{agentType, bytes}` fact is untouched.
- **vs. whoever schedules v27 as one "rebuild the page" task.** §5's six ordering rules are the
  argument: guards and the pin-migration table before the first client file, the fixture before the
  views, REQ-141 and REQ-136 as backend tasks with doc DoD lines. Expected to be uncontested once
  stated; recorded so it is not re-derived at Gate 6.
