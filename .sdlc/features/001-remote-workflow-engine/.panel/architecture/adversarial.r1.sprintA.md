# Architecture panel — round 1 (independent proposal)

**Lens:** Adversarial architecture group — (a) Security, (b) Scalability/performance, (c) Testability,
with Karpathy simplicity-first as the tie-breaker.
**Scope:** v27 / REQ-131..143 (operator dashboard rebuilt to the Claude Design handoff).
**Baseline read:** `01-requirements.md` §Iteration v27, `state.yaml` `tech_stack`, `v27-gate0-asis-map.md`,
and the live source at `576a972`. Every claim below is anchored at file:line.

---

## 0. Altitude call: this is BOTH, and v27 straddles the seam

`tech_stack` describes an **AI-agent system** (Claude Agent SDK harness, LiteLLM gateway, MCP tool
surface, agent transcripts, token/cost accounting) that is *delivered through* a **conventional
server-rendered web system** (hand-rolled JSON-RPC + HTTP server, `src/server.ts`; one served HTML
string, `src/dashboard-page.ts`).

For v27 the two altitudes split cleanly and I apply both:

| Quality dimension | System altitude (the shell) | Agent altitude (the payload) |
|---|---|---|
| Observability | page renders, poll succeeds, offline is visible (REQ-131/142/143) | *what the agent did* — prompt, tool surface, model, effort, four-column tokens, USD, failure `detail` (REQ-135/140/141) |
| Replaceability | swap the page/asset pipeline without touching the engine | swap a provider/model without the DAG lying about which lane a call ran in (REQ-134, inherited REQ-124/125) |
| Consumability | a human operator reads it (REQ-132/133/137/138) | a cold model reads the same data through MCP `run_agent_log` — the SAME facade call the HTTP route uses (`server.ts:563`) |
| Self-sustainability | demo-data exit condition, no CDN, no drift (REQ-143, REQ-131) | the disclosure rule must survive the next iteration adding a field (REQ-136) |

**Consequence I will keep returning to:** REQ-136 and REQ-140 are *not* UI requirements. They change
what the engine puts on the wire for **both** transports at once, because the dashboard's agent-detail
route is literally the MCP facade call with a synthetic principal
(`facade.runAgentLog({...}, { kind: 'auth-disabled' }, false, null)`, `server.ts:563`). A lens that
treats v27 as "a re-skin" will get these two wrong.

---

## 1. Summary (my position in six lines)

1. **The dashboard API is unauthenticated by construction** (`server.ts:1284-1294` dispatches
   `/api/*` before any bearer/principal check; the only guard is the Host/Origin allowlist at
   `server.ts:1051-1055`). v27 *widens* that public surface (`record`, `costUSD`, `lanes`). I am
   **not** proposing to add auth (owner ruled it out — D1; and the v24 adjudication #8 removed the one
   auth gate that existed there because the browser has no token). I am proposing the cheap
   substitute: **one disclosure projection with a golden key-set test per endpoint**, so what leaks is
   a decision, not an accident.
2. **REQ-136 must be fixed at capture, not at render.** Split `HarnessDescriptor` into
   `systemPrompt` + `prompt` where the composition happens (`agent-executor.ts:580`), strip at the one
   emission point (`mcp-facade.ts:699`). Pre-v27 persisted descriptors cannot be un-leaked — declare
   that as an accepted gap now, don't let Gate 6 find it.
3. **REQ-140 forces a decision nobody asked for**: under `auth.enabled` the predicted overlay is
   hard-empty (`server.ts:519-520`), so REQ-134's "5 lanes, 9 agents" silently degrades to
   reached-lanes-only. Deriving `lanes` from `view.phases` is *partial* relief. I recommend retiring
   the `!authEnabled` branch entirely, because `/describe` already publishes phase titles
   ("public to every principal", `workflow-view.ts:106`), the author's Mermaid diagram, and the
   per-label tool surface (`mcp-facade.ts:483-490`) — anonymously.
4. **REQ-141 is the only backend-shaped requirement in the iteration** and the naive implementation
   (fold each run's transcripts on every list) turns a 3-second poll into a full-table scan.
   One resolver, three sources, fixed precedence: **live entry → snapshot → absent**; batched, never
   N+1; and workflow metrics move to a SQL aggregate rather than being computed over a truncated list.
5. **Testability is the binding constraint on how the page is built.** Today the client is a 640-line
   template literal tested by grepping its own source (`tests/unit/dashboard-page-source.test.ts`).
   v27 roughly triples the client logic. REQ-142's own acceptance clause already rejects the
   source-grep regime ("以 Playwright 攔截請求計數為證,而非檢查原始碼是否含 `visibilitychange`").
   My answer: **logic in plain-JS ESM modules served as static assets and imported directly by
   vitest; wiring stays in the page; no bundler, no jsdom.**
6. **REQ-143 contradicts REQ-138 in the same iteration.** REQ-138 says "degrade, never pretend";
   REQ-143 says render fabricated data when the engine is unreachable. The owner ruled demo data in,
   so the architecture's job is to make it *structurally unable to masquerade*: one isolated module,
   the marker carried at the data layer, a three-state connection machine, and a dated exit test.

---

## 2. Key points — eight decisions Gate 2 should record

Numbered `D-ADV-n` (panel-local; ARCH/ADR IDs get assigned at the gate).

### D-ADV-1 — One disclosure projection for the dashboard API, with a golden key-set test per endpoint

- **Security:** the entire `/api/*` surface answers anyone who can reach the port with an allowlisted
  `Host` (`server.ts:1051-1055`, `server.ts:1284-1294`; DEPLOY.md:808 states it plainly). v27 adds
  `AgentRecord` (REQ-140) — which carries `detail`, the provider-authored failure text
  (`types.ts:271-278`) — and `costUSD` on every run summary (REQ-141), i.e. the operator's spend,
  publicly. `detail` is redact-then-cap'd at capture (`agent-executor.ts:646-681`), so I am **not**
  calling it a leak; I am calling it an *un-audited widening*.
- **Scalability:** neutral. A projection is a pure map over a payload already being serialized.
- **Testability:** strongly positive — it gives one importable pure function per endpoint and turns
  "what does this route disclose" into an assertion over a key set instead of a prose review.
- **Karpathy tie-break:** one module (`src/dashboard-disclosure.ts`), one test file, no new concepts.
  Cheaper than the alternative (per-route review every iteration, forever).
- **Decision to record:** every dashboard payload passes through one projection module; one test
  enumerates the exact allowed top-level key set per endpoint and fails on additions. Adding a field
  costs one line in the projection *and* one line in the test — which is the point.

### D-ADV-2 — `lanes` derive from `view.phases`; and the `!authEnabled` predicted-overlay mask should be retired

- **The forced decision:** `server.ts:519-520` populates `expectedGraph` only `if (!authEnabled)`;
  otherwise it stays `{lanes:[],slots:[],edges:[]}`. REQ-140 demands `lanes` "在啟用 auth 時同樣回傳".
  Serializing `expectedGraph.lanes` therefore returns `[]` exactly when auth is on.
- **Minimum fix (safe, do it regardless):** derive `lanes` from `view.phases`
  (`types.ts:293-298`), which is present regardless of auth and is REQ-128's own "one lane per phase"
  rule. No masking decision is reversed.
- **But that is only partial:** REQ-134's acceptance ("5 lane、9 agent"), REQ-133's
  「預測結構」 view for a never-run workflow, and the dashed edges to `pending/queued` nodes all come
  from the *predicted* overlay. Under auth those vanish. So "lanes-from-phases" satisfies REQ-140's
  letter and leaves REQ-133/134 degraded on exactly the deployment the owner described
  (「我 + 團隊,遠端連進來」 — the deployment most likely to have auth on).
- **Security position — the mask protects nothing:** the predicted overlay is script-derived, and the
  script's structure is *already* public through the unauthenticated `/api/workflows/:name/describe`:
  phase titles (`workflow-view.ts:106`, commented "adjudication #1 — public to every principal"), the
  author's Mermaid diagram (`mcp-facade.ts:460`), and `toolSurface` per label
  (`mcp-facade.ts:483-490`). `workflow_source` — the surface that actually carries script text — keeps
  its own protection and is untouched.
- **The test the reversal must rewrite (name it, don't loosen it):** `IT-092`,
  `tests/integration/dag-masking-auth.test.ts:114-126`, asserts that with auth on the DAG carries ONLY
  `__trigger__` and no `__skel_*` cell. If the panel accepts the reversal, that test is **rewritten
  under its own ID** to assert the new contract — the same rule C2 imposes on `val-193`/`val-197`, and
  the same rule REQ-136 imposes on the `harness.prompt` assertions. Relaxing it is not an option.
- **Decision to record (reversal, so it needs an explicit adjudication):** retire the `!authEnabled`
  branch at `server.ts:520`, citing the same reasoning the v24 orchestrator adjudication #8 already
  used to remove the `/describe` auth gate (`server.ts:1236-1244`). The reversal target is v22
  send-back H2 / DES-114 / ARCH-073/075 / ADR-012. If the panel refuses the reversal, then REQ-133/134
  acceptance must be explicitly scoped to `auth.enabled:false` and a VAL must say so — **not deciding
  is deciding to degrade under auth**, silently.

### D-ADV-3 — REQ-136: split the descriptor at capture, strip at the one emission point, and declare the legacy cohort

- **Where it leaks today (Gate 1 verified, I re-verified):** `agent-executor.ts:580` composes
  `[agentType systemPrompt][defaults.prompt][script prompt][appendPrompt]` into ONE string;
  `gateway/client.ts:494-501` puts it verbatim on `HarnessDescriptor.prompt`;
  `agent-executor.ts:674-681` redacts then caps it and persists it as a `harness` transcript event;
  `mcp-facade.ts:689-699` returns the last such descriptor. That return is the **only** producer of
  `harness` on any surface (grepped: `mcp-facade.ts:699` is the sole emission site), which is good
  news — one choke point.
- **Security:** a render-side hide is not a control (REQ-136 says so itself: 「這是線上不傳,不是前端隱藏」).
  Because the API is unauthenticated (D-ADV-1), "don't put it on the wire" is the *only* enforceable
  control available in v27.
- **A second consumer, safe today only by accident:** `runDiagnostics` (`server.ts:827-852`) calls the
  same `facade.runAgentLog` (`server.ts:841`) and pastes the transcript tail into a **GitHub issue
  body** (REQ-036 auto-enrichment). It does not leak the prompt today *only* because `events` excludes
  `harness` events (`mcp-facade.ts:694`). If a later change folds the descriptor — or REQ-140's new
  `record` — into `events`, the agentType system prompt travels to a public issue tracker. This is the
  concrete reason the rule belongs in one projection with a key-set test (D-ADV-1), not in a render.
- **Where the split goes — one decoration site, not two gateways:** a gateway never sees segments. The
  executor hands it one already-composed string (`_invokeOnce(req, prompt, …)`,
  `agent-executor.ts:601`, where `prompt` already carries the schema suffix and the retry nudge), and
  there are **two** gateway implementations (`LiteLLMGatewayClient`, `ClaudeAgentSdkGatewayClient` —
  the default per `tech_stack`), each building its own descriptor. So the seam is the executor's own
  decoration step (`agent-executor.ts:646`), the ONE site both gateways' `onHarness` callbacks flow
  through and the only one where `def?.systemPrompt` is in scope (it must be threaded into, or closed
  over by, `_invokeOnce`). Fixing it in the gateways would be two places, one of them the wrong layer.
- **Proposal:** make `HarnessDescriptor` carry two fields — `systemPrompt?: string` (the agentType
  segment) and `prompt: string` (defaults + script + append, i.e. what REQ-135 calls 使用者提示詞).
  Compose for the model as today; record the two separately. Redact-first-then-cap applies per field
  (preserving the v21 R-G9 ordering rule at `agent-executor.ts:19-32`). The emission point omits
  `systemPrompt`, and D-ADV-1's key-set test is what stops a future field from re-adding it.
- **Answering REQ-136's open question ("do `appendPrompt` / `runParams.prompt` go too?"):** no — strip
  the agentType segment only. `appendPrompt` is the *user's own* text and `runParams.prompt` is the
  workflow author's registered default; both are the observability REQ-135 exists to deliver. This
  also keeps `val-104-append-prompt.test.ts:79-81` (REQ-094's ordering proof, which indexes
  `SCRIPT-PROMPT-MARKER` and `USER-TEXT-MARKER` inside `harness.prompt`) valid **unchanged** — no
  loosened assertion, which is what REQ-136 demanded. A segmented descriptor also makes a later
  reversal a one-line policy change instead of a re-architecture.
- **The gap nobody has named yet (raise it now, not at Gate 6):** descriptors persisted before v27
  hold the composed blob with no recoverable segment boundary — `capPrompt` may have cut the middle
  out (`agent-executor.ts:28-32`) — so strip-at-read cannot find the system prompt in an old record.
  REQ-136's red test runs a *new* agent and will pass while old runs still leak. **Record this as an
  accepted gap**, scope the VAL to post-v27 records, and offer the only real remedy for anyone who
  wants it: a one-shot purge of `harness` events from pre-v27 transcripts (my recommendation: don't —
  it destroys post-mortem evidence for a non-secret, operator-authored string).

### D-ADV-4 — REQ-141: one usage resolver, three sources, fixed precedence; metrics as aggregates; the list gets bounded

- **The trap:** `/api/runs` calls `store.listRuns()` (`server.ts:387`), which is **unbounded** —
  every run ever, no limit (`run-store.ts:369`; the capped `list(filter)` at `run-store.ts:378` is the
  *MCP* path, 50/500). `/api/home` does the same plus `catalog.list()` (`server.ts:361-366`). Per-run
  cost lives only on the detail route (`RunUsage`, `types.ts:92-97`), resolved as
  `snap?.usage ?? foldUsage(all transcripts)` (`sqlite-run-store.ts:277`). Attaching cost per row the
  obvious way = fold every run's every transcript, every 3 s, per viewer.
- **The second trap (the one REQ-141 is actually about):** `saveSnapshot` fires at the terminal
  transition (`run-manager.ts:1014`), so a **running** run has no snapshot — while
  `/api/runs/:id` live-overlays via `foldUsageFromRecords` (`run-manager.ts:242`, `:837`). A snapshot-only
  list would omit `costUSD` for exactly the rows REQ-133's history table renders as
  「4m 12s 進行中 · 費用」. That is v26's R-1 defect re-created with new spelling.
- **Proposal:** one resolver used by BOTH routes, with an explicit precedence chain:
  **(1) live entry** — `RunManager._runs` (`run-manager.ts:293`) → `foldUsageFromRecords`;
  **(2) at-rest snapshot** — `run_snapshots.json`'s `usage`;
  **(3) absent** — omit the field (never `0`, matching `AgentRecord.costUSD`'s own documented
  convention at `types.ts:243-246`). `/api/runs` and `/api/home` therefore move off
  `store.listRuns()` onto a new `RunManager.listSummaries(filter)` (~15 lines: `store.list(filter)`
  + overlay from `_runs`), which is what makes equality hold *by construction* rather than by
  matching arithmetic in two places.
  The at-rest half is read **batched** — one `SELECT runId, json_extract(json,'$.usage') FROM
  run_snapshots WHERE runId IN (…)` — never N+1.
- **The legacy cohort (decide it explicitly):** a terminal run with transcripts but no snapshot
  (pre-v26, or a crash before `saveSnapshot`) makes the detail route fold and the list route omit —
  a presence divergence REQ-141's equality clause won't tolerate. Two coherent options:
  (a) **memoize** the detail route's fold back into the snapshot's `usage` via a *narrow* store method
  that writes usage only, **for terminal runs only** (writing a full derived `RunDagSnapshot` would
  freeze derived `agents`/`phases` — a real regression for any run still receiving transcripts);
  (b) accept the divergence and document the cohort. I recommend (a); it self-heals and keeps one
  number. Someone will propose a `runs.cost_usd` column instead — workable, but it creates a second
  at-rest home for the same fact, which is the exact failure REQ-141 cites.
- **Bounding the list needs a filter, or REQ-133 breaks:** `store.list()` already takes
  `workflow`/`status`/`limit` (`RunListFilter`, `run-store.ts:378`) but the HTTP route accepts no query
  parameters (`server.ts:386-389`). A bare global limit of 50 would leave an older workflow's
  「執行歷史表」 empty. So `/api/runs` grows `?workflow=&status=&limit=` mirroring `RunListFilter`, and
  the workflow-detail view fetches with `workflow=`. Without this, bounding the list ships a bug.
- **Metrics honesty (scalability lens's own addition):** if the list is bounded (and it should be —
  an unbounded scan every 3 s per viewer is a slow-motion DoS on a long-lived engine), then
  `computeWorkflowMetrics` (`dashboard.ts:126-159`) silently changes meaning: 「成功率 67% (2/3)
  · 5 次執行」 becomes "of the last N". Either compute the card metrics as a **SQL aggregate over all
  runs** (`GROUP BY name`, `SUM(status='completed')`, `AVG`, and `SUM(json_extract(...))` for cost) and
  keep the pure `computeWorkflowMetrics` as the in-memory store's parity implementation, or change the
  card's wording. I recommend the aggregate: it is both cheaper and more honest.

### D-ADV-5 — Logic in modules, wiring in the page: plain-JS ESM served static, imported by vitest. No bundler. No jsdom.

- **The problem:** `DASHBOARD_HTML` is one 640-line template literal (`dashboard-page.ts:98-737`) and
  the only unit tests available are regex pins over its own source text
  (`dashboard-page-source.test.ts`, `dashboard-zoom-source.test.ts`, `dashboard-diagram-render.test.ts`).
  v27 adds theme/hue computation, a string table, search+filter, column sorting, slide-in side
  selection, a connection state machine, visibility-gated polling and swimlane geometry. Source-grep
  cannot test any of that meaningfully — REQ-142's acceptance says so out loud.
- **Proposal:** the served page becomes a thin shell (markup + `<script type="module"
  src="/dashboard/app.js">`); every decidable behavior lives in plain-JS ESM modules under
  `src/dashboard/client/` served by a static route and **imported directly by vitest in `node`
  environment** — real unit tests over the real shipped bytes, zero DOM, zero build step, zero drift.
  Type safety is kept with JSDoc + a `tsconfig.client.json` (`allowJs`+`checkJs`+`"lib":["DOM"]`) and a
  two-target `typecheck` script — **do not** add `DOM` to the root tsconfig (`tsconfig.json:6` is
  `"lib":["ES2022"]`), or server code gains `document` as a known global and a whole class of mistake
  stops being a compile error.
- **Where the seam goes (pick one, or the design tweaks become server changes):** the server already
  owns *topology* — `layoutGraph` emits `col/row` cells (`dashboard.ts:334-461`) and
  `tests/integration/dashboard-http.test.ts` pins that shape. Keep it there and add `lanes`. Keep
  REQ-134's **pixel constants** (`LANE_W 216`, `CELL_H 74`, …) and the bezier path builder in a pure
  *client* module. Otherwise a spacing tweak becomes a server change entangled with REQ-140's wire-shape pins.
- **The URL prefix is already taken — twice.** `server.ts:1251` serves the HTML page for
  **any** `GET /dashboard/...` (SPA catch-all), so `<script src="/dashboard/app.js">` would be answered
  with HTML; and `/assets/...` is the auth-gated upload namespace (`server.ts:1146`). Serve the client
  modules, the fonts and the CSS from a distinct read-only prefix (`/static/…`), and let D-ADV-8's
  fixed filename→path map cover the JS as well as the woff2 — one route, one map, no path joins.
- **Three guards this decision must carry (all verified, all easy to miss):**
  1. `tests/unit/no-skeleton-surface.test.ts:61` filters `entry.endsWith('.ts')` — **plain-JS client
     modules escape the C3 guard entirely**, so the forbidden word could ship in served bytes with CI
     green. Extend the walk to `.js` (and to the served asset dir) as part of *this* decision.
  2. C1's three literal pins are *behaviors*, not text (`.fit-btn{position:relative;z-index:1;`,
     `draggable="false"`, `preventDefault()`). They are already proven by real-mouse Chromium tests
     (`val-193-dag-fit-and-columns.test.ts:111-184`, `val-197-diagram-drag-pan.test.ts:97-117`).
     Retire the text pins in favour of those proofs — do not port string pins into new files.
  3. C2's selectors (`#dag-fit #dag-graph #dag-zoom #run-usage #diagram-img #diagram-zoom .card .t`)
     are cheap to keep. Keep them; the rebuild has no reason to rename them.
- **Two things this buys for free:**
  - **CSP on `/dashboard`.** Today the page sets none (`server.ts:1255`); only the diagram route does
    (`server.ts:444-454`). With JS external and fonts self-served, `script-src 'self'` becomes
    achievable — which converts the no-CDN stance and the `textContent`-only invariant from
    grep-enforced convention into a runtime control. Honest caveat: the handoff leans on inline
    styles, so `style-src 'self' 'unsafe-inline'` is the realistic floor; say so rather than claiming
    a stricter policy than ships.
  - **Retiring `buildDashboardHtml(init)`'s server-side injection** (`dashboard-page.ts:58-87`):
    `/api/status` already returns `lastUpdate` and `interruptedRuns` (`server.ts:1268-1281`), so the
    page can fetch them and become genuinely static and cacheable.

### D-ADV-6 — Connection state is a three-state machine, and the demo dataset is quarantined by construction

- **The internal contradiction:** REQ-138 requires 「不得顯示 0 假裝有值」 ("degrade, never pretend");
  REQ-143 requires rendering a fabricated dataset when the API is unreachable. Both are v27.
  REQ-131 adds a third state (Live / Offline) that REQ-143's Demo state would otherwise make
  unreachable — if demo renders whenever the API fails, 「離線 / Offline」 never appears.
- **Proposal:** one pure module computing `Live | Offline | Demo` from (last success timestamp,
  consecutive failure count, demo-enabled flag), unit-tested in node with no DOM — exactly the shape
  D-ADV-5 argues for. The flag is an INPUT, which is what reconciles REQ-143 with REQ-131: while the
  demo flag is on, unreachable → **Demo**; once the flag is off (REQ-143's registered exit condition),
  unreachable → **Offline**. Without the flag as an input, REQ-131's Offline state is unreachable code
  the day REQ-143 lands.
- **Quarantine rules (the architecture's job, since the owner ruled the feature in):** the demo
  dataset lives in exactly one module with no importer other than the state machine; every demo record
  carries its marker **at the data layer**, so any view that forgets the banner still cannot render a
  demo number as real; a guard test asserts no demo value reaches a Live-state render; and the exit
  condition REQ-143 already registers gets a **test that names it** — because this ledger's
  most-recorded defect class is 「刪掉了卻還有東西在描述它」 (REQ-105 / ADR-048 / UT-115).
- **Security note:** the hazard here is operational truth, not confidentiality — demo mode activates
  precisely when the engine is down, i.e. the moment an operator most needs to not be reassured by a
  green dashboard.

### D-ADV-7 — Poll only the visible tab; REQ-142's visibility gate is necessary, not sufficient

- **Today:** one unconditional `setInterval(render, 3000)` (`dashboard-page.ts:733`), and the home
  view already fetches three endpoints per tick (`/api/home`, `/api/system`, `/api/models` —
  `dashboard-page.ts:394,411,436`). v27 has four tabs plus Issues: a naive rebuild makes every viewer
  ~5 requests / 3 s, each one (for `/api/home`, `/api/runs`) an unbounded run scan (D-ADV-4).
- **Proposal:** the poll scheduler is a pure decision function — `(visibility, activeTab, lastTick) →
  endpoints[]` — so it is unit-testable in node, and it fetches **only the active tab's endpoints**.
  Zero new mechanism, and it composes with REQ-142's `visibilitychange` gate rather than competing.
  `/api/models` and `/api/system` are already TTL'd + single-flight server-side
  (`server.ts:376-384`, `system-info.ts`), so this is about request count, not upstream load.
- **Explicitly deferred (not proposed for v27):** ETag/`If-None-Match` on `/api/runs`, SSE. The owner
  declined the transport work (Won't-have D3); bounded lists + per-tab polling carry the load.

### D-ADV-8 — Vendored fonts: a fixed filename→path map, never a path join

- REQ-131 requires Archivo + JetBrains Mono from repo-vendored woff2 and forbids any external host.
  That introduces the engine's first **static file route**, which is a path-traversal surface. This
  repo already has the machinery to avoid it (`path-containment.ts`), but the simplest correct answer
  is smaller: a hard-coded `Map<filename, absolute path>` with a fixed `Content-Type` and a long
  immutable `Cache-Control` — **never** `join(fontDir, req.url)`.
- Supply chain: record source URL + sha256 + license (both families are OFL) beside the binaries; two
  weights per family, latin subset, so the repo doesn't gain a megabyte of unattributed binary.
- Prefer separate font files over base64 data: URIs in the CSS — the requirement is "no external
  host", not "one file"; data: URIs cost ~33% inflation on every page load and defeat caching.

---

## 3. Risks

**R1 — REQ-134's acceptance silently degrades under `auth.enabled`.** (D-ADV-2.) The likeliest bad
outcome of this iteration: Gate 7.5 validates the swimlane against a loopback, auth-off engine,
everything is green, and the team's real remote deployment shows a graph with only the lanes that have
already run. *Mitigation:* the VAL for REQ-134 must run at least one case with `auth.enabled:true`.

**R2 — REQ-136 lands as a render-side hide.** The cheap edit (delete a key in the dashboard's client
render) makes the red test go green while the MCP tool keeps serving the system prompt to every cold
model that calls `run_agent_log`. *Mitigation:* the red test must assert against the **HTTP/MCP
response body** (REQ-136 already words it that way), and D-ADV-1's key-set test must cover
`/api/runs/:id/agents/:agentId`.

**R3 — REQ-141 implemented as a per-row fold.** Correct output, and a 3-second full-table-plus-
transcripts scan per viewer. It will not show up in tests (small fixtures) and will show up on the
owner's real engine, which has months of runs. *Mitigation:* a test that asserts the list route
issues O(1) store reads, not O(runs) — and a bounded list.

**R4 — "99% 相似" pulls the team toward a framework + build step.** A bundler reintroduces the
"did you rebuild?" drift class, which is this ledger's most-recorded defect family, and collides with
the test-locked no-CDN stance (`dashboard-diagram-render.test.ts`'s CDN greps). *Mitigation:* D-ADV-5;
fidelity is a CSS/markup problem, not a framework problem.

**R5 — the C3 guard goes blind.** (D-ADV-5 guard 1.) `.js` client modules are outside
`no-skeleton-surface.test.ts`'s walk; the handoff's own i18n table ships a `skeleton:` key (C4/C3),
so the word is *actively trying* to enter the tree this iteration.

**R6 — three "prompt" concepts get conflated.** `systemPrompt` (agentType), `runParams.prompt`
(registered author default), script `prompt`, and `appendPrompt` (user) are four segments
(`agent-executor.ts:580`); REQ-135 shows 「使用者提示詞」 and REQ-136 hides one of them. If the design
keeps one string, every future policy question re-opens the same surgery.

**R7 — the demo dataset outlives its exit condition.** (D-ADV-6.) It is the single most likely thing
in v27 to still be in the tree in v30, describing a UI that no longer exists.

**R8 — key-set tests calcify.** D-ADV-1's golden test is deliberately annoying; if a future iteration
finds it obstructive, the failure mode is someone relaxing the assertion instead of updating it. State
in the ADR that relaxing the *shape* of the assertion (rather than its contents) is the thing that is
forbidden — the same rule REQ-136 already applies to `harness.prompt` tests.

---

## 4. Expected disagreements with the other lenses

**vs. a DX / consumability / fidelity lens — "use Vite (or esbuild) + a component framework; 99%
fidelity demands real components."** I expect this and I oppose it for v27. A build step adds a
drift class this ledger has been bitten by repeatedly, and the offline/no-CDN posture is enforced by
tests, not convention (as-is D.4). Plain ESM modules served static give the same modularity with no
artifact to go stale. If the panel adopts a bundler anyway, I want a CI check that the built asset
matches its source — that is the cost, and it should be named.

**vs. a testing-strategy lens — "add jsdom (or happy-dom) for a middle tier."** I oppose. The
requirements already mandate real Chromium (REQ-132/139 screenshots, REQ-142's request counting,
REQ-129's preserved real-mouse proofs). A jsdom tier duplicates maintenance against a DOM that
diverges from the browser the acceptance tier uses. My counter-offer is D-ADV-5: make the DOM layer so
thin that there is nothing left for jsdom to test.

**vs. a continuity / conservative lens — "a dashboard iteration must not reverse v22 send-back H2."**
I expect this on D-ADV-2 and I take the opposite position: REQ-140 and REQ-134 together make the
choice unavoidable, and the reasoning that removed the sibling gate (adjudication #8,
`server.ts:1236-1244`) applies verbatim. If we refuse the reversal we must say out loud that REQ-133/134
are accepted only with auth off.

**vs. a security-maximalist reading of my own lens — "then authenticate `/api/*`."** I concede the
principle and refuse the scope: the owner ruled it out (D1), and the browser client has no token, which
is precisely why the previous gate *removed* the one gate that existed. Raising it here would be
re-litigating a closed decision while shipping nothing. The in-scope security work is D-ADV-1 + D-ADV-3
+ D-ADV-8. I would, however, support one line in DEPLOY.md and a boot-time warning: on a non-loopback
bind, the dashboard's data surface is public to anyone who can reach the port, so the port belongs
behind the tunnel's own access control.

**vs. a purist — "cut the demo data."** Ruled in by the owner. The disagreement worth having is about
*how* (D-ADV-6: isolated module, marker at the data layer, three-state machine, dated exit test), not
*whether*.

**vs. a data-modeling lens — "add a `runs.cost_usd` column; it's simpler than `json_extract`."**
Defensible, and I'd accept it if the panel prefers it, but I argue against: the snapshot already holds
`usage`, written by the one fold REQ-141 names, and a second at-rest home for the same number is the
divergence the requirement was written to prevent.

**vs. a "just do the UI" reading of the iteration.** REQ-136, REQ-140 and REQ-141 are engine changes
that reach the MCP tool surface and the persisted descriptor shape. Any plan that schedules v27 as
front-end-only work will discover this at Gate 6.

---

## 5. Evidence index (what I actually read)

| Claim | Anchor |
|---|---|
| `/api/*` dispatched before any auth | `src/server.ts:1284-1294`; guard is Host/Origin only, `src/server.ts:1051-1055`; stated in `DEPLOY.md:808` |
| dashboard agent route = MCP facade with a synthetic principal | `src/server.ts:563` |
| predicted overlay masked under auth | `src/server.ts:519-520`; rationale `src/server.ts:509-520` |
| phase titles already public to every principal | `src/workflow-view.ts:106`; describe projection `src/mcp-facade.ts:455-490` |
| adjudication #8 removed the sibling auth gate | `src/server.ts:1236-1244` |
| prompt composition (4 segments) | `src/agent-executor.ts:580`; descriptor `src/gateway/client.ts:494-501`; persist `src/agent-executor.ts:646-681`; emit `src/mcp-facade.ts:689-699` |
| redact-then-cap ordering rule | `src/agent-executor.ts:19-32` |
| REQ-094 ordering proof indexes `harness.prompt` | `tests/acceptance/val-104-append-prompt.test.ts:79-81` |
| masking-under-auth is test-pinned (IT-092) | `tests/integration/dag-masking-auth.test.ts:114-126` |
| composed prompt reaches the gateway as ONE string; one decoration site | `src/agent-executor.ts:601`, `:646` |
| `/dashboard/*` SPA catch-all; `/assets/*` is the auth-gated upload namespace | `src/server.ts:1251`, `src/server.ts:1146` |
| issue-report enrichment reuses `run_agent_log` | `src/server.ts:827-852,841`; safe only because `events` excludes harness, `src/mcp-facade.ts:694` |
| unbounded list on the dashboard path | `src/server.ts:360-366,386-389`; `src/run-store.ts:369` vs capped `:378` |
| usage at rest / live | `src/store/sqlite-run-store.ts:277`; `src/run-manager.ts:242,837,1014`; live map `src/run-manager.ts:293` |
| `RunSummary` has no cost field | `src/types.ts:358-369` |
| `AgentRecord.detail` is redacted + capped | `src/types.ts:271-278` |
| pure metrics over summaries | `src/dashboard.ts:126-159` |
| page is one template literal, 3 s unconditional poll | `src/dashboard-page.ts:98-737,733` |
| client polls 3 endpoints on home | `src/dashboard-page.ts:394,411,436` |
| C3 guard walks `.ts` only, allowlist pinned at 6 | `tests/unit/no-skeleton-surface.test.ts:53,61,82` |
| real-mouse proofs for C1 behaviors | `tests/acceptance/val-193-dag-fit-and-columns.test.ts:111-184`; `tests/acceptance/val-197-diagram-drag-pan.test.ts:97-117` |
| no CSP on `/dashboard`; diagram route has one | `src/server.ts:1255` vs `src/server.ts:444-454` |
| root tsconfig has no DOM lib | `tsconfig.json:6` |
| vitest is node-env, no DOM harness | `vitest.config.ts` |
