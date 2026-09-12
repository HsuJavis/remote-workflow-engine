# Handoff: Remote Workflow Engine — Dashboard

## Overview
A monitoring dashboard for `HsuJavis/remote-workflow-engine`. Three tabs:
1. **Workflows** — registered workflows grouped into Running / Registered / Other, with drill-in to a left-to-right swimlane graph of one run, run history, and a slide-in agent detail panel (prompt, model, effort, timeout, tools, MCP servers, skills, tokens, log).
2. **Models** — sortable, filterable catalog with a slide-in detail panel (capability, modalities, latency, stability, benchmarks, supported params).
3. **System** — CPU / memory / disk / stored-workflow counts, per-process table, engine self-process stats.

Bilingual (zh-TW / en), light / dark / follow-system, plus an accent-hue slider (Morandi palette, default 236°).

## About the Design Files
`Workflow Dashboard.dc.html` + `rwe-data.js` are **HTML design references**, not production code. Recreate them inside the engine repo's existing dashboard stack (`src/dashboard-page.ts` renders server-side HTML today; if you move to a client framework, pick one and keep these files as the visual/behavioral spec). Every REST route the design consumes already exists in `src/server.ts`.

## Fidelity
**High-fidelity.** Colors, type, spacing and interactions are final. Match them exactly.

## Data contract (all from `src/server.ts`)
| Screen | Endpoint | Notes |
| --- | --- | --- |
| Workflows home | `GET /api/home` | `{running, registered, other}` cards (`src/dashboard.ts buildHome`), `metrics.{successRate, avgDurationMs, terminalCount}`, `activeRunId`, `latestRunId` |
| Run list / history | `GET /api/runs` | `RunSummary[]`; design also reads optional `costUSD` or `usage.costUSD` per summary for the "avg cost" card metric (add to summary if you want that metric live) |
| Run view | `GET /api/runs/:id` | `RunStatusView` (`phases`, `agents`, `usage`) |
| Graph | `GET /api/runs/:id/dag` | `{cells, edges, warnings, lanes?}` — cell `{id, kind:'trigger'|'agent', col, row, label, state?, agentId?, tokens?, costUSD?}`; col 0 = trigger, col n = phase n. The design adds an optional `lanes:[{index,title}]`; fall back to `runView.phases[].title` |
| Agent detail | `GET /api/runs/:id/agents/:agentId` | design expects `{record: AgentRecord, harness: {model, provider, prompt, tools[], skills[], mcpServers[], effort, effortApplied, timeoutMs, phase}, events[]}`; if the route only returns events, take harness from the `harness` event `data` |
| Describe | `GET /api/workflows/:name/describe` | `version, description, runnable, triggers[], phases[], params.agents{label:{model,effort,timeoutMs}}` |
| Models | `GET /api/models` | plus optional `latency:{ttftMs,p50Ms}` and `benchmarks:{name:score}` (shown as "—" when absent) |
| System | `GET /api/system` | `src/system-info.ts` shape |

Poll every 3 s (`pollMs`). If the API is unreachable the reference falls back to a demo dataset in `rwe-data.js` — drop that in production.

## Screens

### 1. Workflows home
- Top bar: search input (`.input`, max-width 320) + segmented filter All / Running / Registered with counts.
- Sections: **Running** (h6 with pulsing 8 px accent dot), **Registered**, **Other** (opacity .75). Grid `repeat(auto-fill, minmax(280px,1fr))`, gap 16 px.
- Card (`.card`, bordered, no fill): kicker (`ACTIVE · a3f9c2e1` or `LAST RUN · 9/11 14:02`), title = workflow name, description (`text-wrap:pretty`), meta row: `Success 67% (2/3) · Avg duration 12m 4s · Avg cost $0.42 · 5 runs` (tabular figures, `white-space:nowrap` on the success item). Running cards: accent border + a 2 px accent bar sweeping left→right across the top (`rweSweep` 2.4 s linear infinite). Hover: 5–6 % accent tint.
- Click card → workflow detail (breadcrumb `Overview › name`).

### 2. Workflow detail
- Header: h2 name, tag `Version v14`, tag Runnable / Not runnable, description (max 720 px); right column "TRIGGERS" list of outline tags (`webhook · gh-issue-labeled`).
- Run chips: outlined `.btn`s with 7 px status dot + 8-char run id; selected chip has accent border + accent-100 fill. Shows 6 most recent.
- **Swimlane graph** (scrollable box, border 1 px divider, radius 3 px). Constants: `PAD 16`, `TRIG_W 112`, `LANE_W 216`, `LANE_GAP 40`, `HEAD_H 48`, `CELL_H 74`, `GAP_Y 14`. Lane header: `01 REQUIREMENTS` uppercase 13 px / letter-spacing .04em semibold; current lane header colored accent with an accent bottom rule and a `Current` tag. Vertical hairlines at each lane x. Edges: cubic bezier from right-center to left-center, 1.2 px; stroke accent when target is running, neutral-500 when traversed, divider otherwise; dashed `4 4` into pending/queued.
- Node cell: 216×74, radius 3 px, surface fill, 1 px divider border, padding 8/12. Row 1: 9 px status dot + label (13.5 px semibold, ellipsis). Row 2: model short name (11 px, 70 %) + effort tag (`.tag-neutral`, 10 px). Row 3: `52k tok · $0.31 · 2m 10s` (10.5 px, 55 %).
  - running: fill accent-100, border accent-600, `box-shadow` md + `rweGlow` 1.8 s ring; dot `rweRing` 1.3 s.
  - done: dot = text color. failed: border + dot `oklch(0.55 0.16 25)`. queued/pending: dashed border, opacity .65, hollow dot.
  - Trigger cell: 112×40, transparent, label = trigger type.
- Legend row + right-aligned run summary `Running · 8 agents · 412k tok · $2.13`.
- **Run history** `.table` (min 720 px): Run ID (mono) · Status tag · Version · Started by · Started · Duration (`4m 12s in flight` while running) · Agents · Tokens · Cost. Selected row tinted 7 % accent. Row click switches the graph.

### 3. Agent panel (slide-in)
- Backdrop `rgba(8,12,9,.5)` fades in .2 s; click closes. Panel `position:fixed; top/bottom 0; width min(760px,100vw)`, bg, 1 px divider edge, shadow-lg, padding 16, gap 16. Slides in **from the right** unless the clicked node's center is in the right half of the graph — then from the left (`translateX(±40px) → 0`, .28 s `cubic-bezier(.2,.7,.2,1)`).
- Header: 32 px `.btn-icon` ×, h2 label, state tag, phase tag, mono agentId right-aligned.
- Six stat cards (`auto-fit minmax(150px,1fr)`): Model / Effort (`reasoning.effort = high`) / Timeout (`15m 0s`, `900,000 ms`) / Duration (start → end) / Tokens (total + `Input · Output · Cache read · Cache write`) / Cost.
- User prompt in `<pre>` (body font 13.5 px / 1.6, pre-wrap, max-height 420, bordered).
- Three columns: Allowed tools (`.tag-neutral`), MCP servers (`.tag-accent`), Skills (`.tag-outline`), each with count.
- Agent output list (max-height 420): `HH:MM:SS` · kind tag (tool call = accent tint, message = neutral, log = red outline, others = outline) · text (mono for tool_call / tool_result / log). Failure `detail` shown in a red-outlined box.

### 4. Models
- Filter row: search (max 280), provider `<select>`, segmented All / Remote / Local, hint "Click a column to sort".
- `.table` min 960 px, horizontally scrollable. Columns (all sortable, click toggles asc/desc, active header colored accent-700 with ▲/▼): Model (nowrap, min 170) · Provider · Alias · Context (right) · Price (in / out per M) · Tools · Effort · Modalities (`text+image → text`) · Latency (`TTFT 900ms · p50 6.8s`) · Stability tag · Benchmarks (`78 avg`) · Location.
- Count reads `9` or `4 / 9` when filtered.
- Row click → right slide-in panel (560 px): kicker provider · location, h2 model, alias line, description, definition list (capability, modalities, context, price, cost level as ●●●○○ in accent, latency, stability, tools, effort), **Benchmarks** with 2 px track / 4 px accent bar per score (grid `140px 1fr 48px`), supported parameters as neutral tags.

### 5. System
- Four stat cards: CPU %, Memory %, Disk % (path in kicker), Workflows stored — 34 px / 500 figure, 2 px track with 4 px accent bar, meta line (`16 cores · Load 5.2 / 4.87 / 3.91`, `26 GB of 64 GB · 38 GB free`, `9 versions · 13 run records`).
- Processes `.table`: PID · Name (mono, engine's own pid marked ★ and accent bar) · CPU % bar · Memory. Header shows `Total processes 312 · S 298 · R 7 …`.
- Engine process `<dl>` in a bordered box: PID, Uptime, CPU %, Memory, Threads, File descriptors.

## Header / chrome
`.nav` sticky, bg, brand "工作流引擎 / Workflow Engine" + source tag (`Live` accent tint · `Offline` red outline · `Demo data` outline). Tabs are underlined links (`aria-current="page"` → accent-700 text + accent underline). Right cluster: hue slider (150 px, gradient track of `oklch(0.68 0.07 h)` stops, 16 px accent thumb with bg ring, current degrees), lang seg 中 / EN, theme seg 系統 / 淺 / 深. Footer: API base left, `Updated HH:MM:SS` right, 11.5 px 50 %.

## Interactions & state
- `tab` workflows|models|system; `view` home|workflow|agent; `selectedName`, `selectedRunId`, `agent`, `panelSide`.
- `query`, `filter`; `modelQuery`, `modelProvider`, `modelLoc`, `modelSort {key, dir}`, `selectedModel` (null = panel closed).
- `lang`, `theme`, `hue` (persist `hue` in `localStorage['rwe-hue']`), `systemDark` from `prefers-color-scheme`.
- Poll loop refreshes home + runs every 3 s; when a run is open also refreshes run view + dag (+ agent if panel open). Models fetched once per session. Live/offline flip on fetch failure.
- Escape/close: click backdrop or × button.

## Design tokens
**Fonts** — `Archivo` 400/500/600 (headings & body), `JetBrains Mono` 400/500 (ids, PIDs, tool calls). Body 14 px / 1.55. Headings cap at 600.
**Radius** `--radius-md 3px`, `--radius-sm 2px`. **Spacing** DS scale (`--space-2 8`, `-3 12`, `-4 16`, `-8 32`).
**Hue-driven accent** (h = slider, default **236**), all in OKLCH:
- Dark: bg `oklch(.21 .006 h)`, surface `oklch(.25 .007 h)`, divider `oklch(.36 .01 h)`, text `#e2e6e5`, accent `oklch(.72 .065 h)`; accent-100…900 L = .30 .37 .45 .55 .65 .72 .80 .87 .93, C = .035 .045 .055 .06 .065 .065 .06 .05 .035.
- Light: bg `oklch(.955 .008 h)`, surface `oklch(.985 .005 h)`, divider `oklch(.82 .012 h)`, text `#1e2523`, accent `oklch(.56 .065 h)`; accent-100…900 L = .93 .87 .79 .68 .56 .48 .40 .33 .26, C = .03 .045 .06 .07 .075 .07 .06 .05 .04.
- Neutrals (zinc-teal base, fixed): dark 100→900 `#2a2d2a #363a36 #474c47 #626862 #858b85 #a2a8a2 #bfc4bf #d8dbd8 #eceeeb`; light `#e4e7e2 #d3d8d0 #b9c0b6 #969e93 #737b71 #5a6158 #444a42 #2f342e #1d211c`.
- Failure red `oklch(0.55 0.16 25)` (text variant `oklch(0.45 0.16 25)`).
**Shadows** dark: sm `0 1px 2px rgba(0,0,0,.5)`, md `0 3px 10px rgba(0,0,0,.55)`, lg `0 16px 40px rgba(0,0,0,.65)`; light: sm `0 1px 2px rgba(20,25,35,.12)`, md `0 4px 12px rgba(20,25,35,.14)`, lg `0 16px 40px rgba(20,25,35,.22)`.
**Keyframes** `rwePulse` (opacity 1→.35, scale 1→.7, 1.6 s), `rweRing` (box-shadow 0→9 px transparent, 1.3 s), `rweGlow` (2 px→6 px accent ring, 1.8 s), `rweSweep` (left −40 %→100 %, 2.4 s), `rweSlideIn`/`rweSlideInL` (.28 s), `rweFadeIn` (.2 s).

## Files
- `Workflow Dashboard.dc.html` — template + logic (layout constants in `layout()`, all view-model derivation in `renderVals()`).
- `rwe-data.js` — i18n strings (`STR.zh`, `STR.en`), formatters, REST client (`makeApi`), demo dataset, `buildHome` / `layoutFromView` / `skeletonFromDescribe` mirrors of the engine's builders.
- `_ds/classical-.../styles.css` — base component classes (`.card .tag .btn .table .seg .input .nav .hr`) the design leans on; tokens are overridden per theme as listed above.
