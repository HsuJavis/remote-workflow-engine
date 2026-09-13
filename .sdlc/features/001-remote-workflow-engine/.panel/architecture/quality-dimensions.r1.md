---
stage: architecture
lens: quality-dimensions
iteration: v27 Sprint B (REQ-137, REQ-138, REQ-139, REQ-142, REQ-143)
round: 1 (independent proposal)
inputs: 01-requirements.md §Iteration v27 (Round v27 log, REQ-131 as amended v27h, REQ-137..143), state.yaml (tech_stack; pending[0] "SPRINT B CARRY-FORWARD" ten items; pending[1] v27h owner ruling), 02-architecture.md v27 slice (ARCH-122..131, ADR-049..056, INV-V27-1..9, the v27 housekeeping note at :3690), 04-design.md DES-206/DES-207 + the v27/v27j design rationale, 07-review.md RE-REVIEW #5 §9 debt rows (QD-O4, QD-O5, QD-R2, QD-R3, QD-C2, QD-C3, D4-1), .sdlc/design-handoff/{README.md,PROVENANCE.md,Workflow Dashboard.dc.html:515-540,690-694}, src/dashboard/{ui,lib}/*.js, src/{server,system-info,static-assets,dashboard}.ts, src/models/{model-book,model-catalog}.ts, src/tool-specs.ts:956-968, tests/fixtures/dashboard-wire.ts, tests/integration/dashboard-disclosure.test.ts, tests/acceptance/val-202-ported-tabs.test.ts, one tsx probe (scratchpad/probe-modelbook.mts, output quoted in §1)
---
# Quality-dimensions proposal — v27 Sprint B (Observability / Replaceability / Consumability / Self-sustainability)

## summary

Sprint B is the five v27 rows Sprint A's architect left outside its closure (`02-architecture.md:3690`:
「the next Gate 2 touch should add rows to ARCH-124/125/130 rather than new modules」): the Models tab
(REQ-137), the System tab (REQ-138), the Issues tab re-themed (REQ-139), visibility-gated polling
(REQ-142) and the self-labelled demo dataset with a registered exit (REQ-143). No new service, no new
runtime dependency, no schema change. This lens's proposal is **one architectural decision and four
wire/lock obligations**, in descending weight:

1. **The three tabs must join the ONE data seam before anything is bolted onto them (B-R1, HIGH,
   measured).** `home.js:226`, `run.js:470` and `workflow.js:389-397` read `bodies[url]` from
   `app.js`'s single `tick()`; `models.js:52`, `system.js:72` and `issues.js:99` (plus the detail loader at `:78`) each call `getJSON`
   themselves inside `onTick` (grep, this pass). REQ-142 (park one timer), REQ-143 (one substitution
   point) and REQ-131's tag (one reducer) are correct **by construction** only through that seam; on
   the self-fetching shape each becomes three hook sites — the exact class that took six rounds and
   six guard repairs in Sprint A (carry-forward item 7). Sprint B rewrites all three files anyway.
2. **REQ-143's demo predicate must key on transport-unreachable, never on the tag's `offline`
   (B-S2, HIGH, read).** `GET /api/runs/<unknown>/dag` answers **404** (`server.ts:490`),
   `classifyResponse` folds every non-2xx into `fail` (`connection.js:46`), two such ticks reach
   `offline` (`connection.js:38`) — so a demo mode that triggers on `offline` swaps the whole page to
   fake data on a **healthy** engine the moment someone opens a stale `/dashboard/<runId>` link
   (QD-O4, recorded LOW debt, becomes a REQ-143 correctness bug). `getJSON` must report whether an
   HTTP response arrived at all (`reached`), and demo requires `offline ∧ nothing reached`.
3. **A catalog provider failure is invisible on `/api/models` (B-O1, HIGH, measured).** With Ollama
   and OpenRouter both refusing, `buildCatalog` answers 4 static Anthropic rows and **no marker**
   (`model-catalog.ts:303-306` `.catch(() => [])`); with the whole source throwing and nothing
   last-good, `ModelBook` answers `source:'static', entries:0` and the route serves `[]` as HTTP 200
   — the Models tab reads 「(no models)」 under a 「連線中」 tag. The owner's Round-1 complaint was
   「模型與系統資源不好查」; this is the seam that makes it queryable.
4. **`/api/system`, `/api/models` and `/api/issues` have no disclosure row and no wire fixture
   (B-C1, HIGH, measured: 0 hits in `dashboard-disclosure.test.ts` and `dashboard-wire.ts`).**
   Sprint B widens two of them (below), so INV-V27-7 / ADR-054's budget rule makes the rows owed
   this sprint, and the same fixture rows are what type-locks the demo dataset (B-R3).
5. **Two wire deltas the REQs imply but REQ-140 did not name (housekeeping, not decisions):**
   REQ-137's panel lists 「支援參數以 neutral tag」 but `enrichModelEntry` destructures
   `supported_parameters` away (`model-catalog.ts:429`, a deliberate v26 rule) — B-C2 proposes the
   named projection `supportedParameters` and states the MCP cost; REQ-138's 「儲存的工作流數 · 9 個
   版本 · 13 次執行記錄」 card has no source on `/api/system` (`{...view, auth}`, `server.ts:369-373`)
   — B-R6 composes COUNT accessors at the route, keeping `SystemInfoSampler` OS-only.

Memory metabolism and self-reflection/prompt calibration have no seam in this slice and are named
and dropped in §4; their one honest analogue — a dashboard tab left open all day — is B-S3.

## Altitude call (which system is this?)

**Both apply; Sprint B is system-altitude with an agent-altitude face.** From `state.yaml.tech_stack`:
a Node 22 / TypeScript ESM service (hand-rolled JSON-RPC-over-HTTP MCP, SQLite + journal, systemd
self-update, a plain-JS ESM dashboard served from the same port) dispatching real
`@anthropic-ai/claude-agent-sdk` sessions through a managed LiteLLM proxy to three providers.

*System altitude* — every Sprint B row is a read-only operator surface over existing `/api/*` routes:
tabs, tables, a slide-in, a polling scheduler, a fallback dataset. Read at that altitude: the
dashboard is the operator's observability surface; its `/api/*` is the engine's second public API;
"replaceability" means views, routes, strings and the demo source are data behind one seam.

*Agent altitude* — the Models tab is where **LLM-backend replaceability becomes visible**: provider,
`location`, `toolUseDeclared` / `effortDeclared` and their `declaredSource` (`upstream | static |
unknown`), `catalogFetchedAt`, and — after B-O1 — whether the row came from a live fetch or a
fallback. The System tab is the engine's **self-report** (`process.self`: pid, uptime, rss, cpu,
threads, fds — `system-info.ts:60-68`). Nothing in Sprint B touches an agent's reasoning trace; that
altitude was Sprint A's REQ-135/136 and is not re-litigated here.

## Method and blind spots (carry-forward item 8)

**Measured this pass:** `grep -n "bodies\[\|bodies\."` over `src/dashboard/ui/*.js` (three readers,
three self-fetchers); `grep -c 'api/system|api/models|api/issues'` over the disclosure test and the
wire fixture (0 / 0); one `tsx` probe over `ModelBook` + `buildCatalog` with throwing fetches
(output in §1 B-O1); `grep 'sendJson(res, 404'` over `server.ts` (ten arms, `:490` is the DAG one);
`grep -n 'getJSON(\|replaceChildren('` over the three tab modules (the cites in B-R1/B-O5/B-K1/B-K7);
`grep -i 'offline|離線'` over `tests/acceptance` and `tests/integration` (no REQ-131 Offline proof
exists — housekeeping (vi)); `git log` for the prior panel files (house style from `07266be`). **Read, not executed:** `poll.js`,
`connection.js`, `app.js:150-215,356-465`, the three tab modules in full, `system-info.ts:18-125,236-300`,
`model-catalog.ts:11-62,292-332,333-445`, `model-book.ts:23-179`, `strings.js`, `static-assets.ts`,
`server.ts:340-400,455-480`, `tool-specs.ts:956-968`, `dashboard-wire.ts:126-147`,
`val-202:1-60`, the handoff README §4/§5 and `.dc.html:515-540,690-694`. **Not done, and it matters:**
no browser was launched (so nothing here about layout is measured); I did **not** verify that headless
Chromium flips `document.visibilityState` to `hidden` when a sibling page is `bringToFront()`ed — B-S1
names it as the thing Gate 5/7.5 must measure first; I did not measure `/api/models`' payload size on
the production catalog (the 100-row estimate is `DEFAULT_LIMIT`); `run.js` and `agent-panel.js` were
read only at the lines the debt rows cite. The handoff's Models/System **markup** (`.dc.html`) was not
read line-by-line — per carry-forward item 2 the README §4/§5 prose is the oracle, and per item 3 no
SPEC_ROW may be transcribed from a build, this proposal's own reading of the `.dc.html` included.

---

## 1. Observability

**Sprint B's observability question is: when the Models or System tab shows a number, can the
operator tell whether it is live, stale, fallback, or fabricated — and when it shows nothing, why?**
Sprint A settled the run/agent side (four token columns, `record`, `lanes`, the `dashboard_api_degraded`
journal line). The two new tabs sit on routes whose failure modes are today silent.

**B-O1 — provider failure is invisible on the models wire (HIGH, measured).** Probe
(`scratchpad/probe-modelbook.mts`, `tsx`, this pass):

```
A source= static entries= 0 served rows= 0          # whole source throws, nothing last-good
B rows= 4 providers= [ 'anthropic' ]                 # ollama + openrouter fetches both reject
B keys on a row= provider,model,description,modalities,contextWindow,price,location,ratesPerM,
                 capability,stability,costLevel,toolUseDeclared,effortDeclared,declaredSource,catalogFetchedAt
B any marker that a provider failed? false
```

Case A reaches the browser as HTTP 200 `[]` → `classifyResponse` → `ok` → the tag says 連線中 and the
tab says 「(no models)」. Case B is worse because it looks complete: `catalogFetchedAt` is **fresh** on
every row (the fetch that "succeeded" is the one that swallowed both providers at `model-catalog.ts:303-306`),
and neither the journal nor the wire says Ollama was down. *The discriminating constraint:* provider
health can only move the nav tag if it reaches the reducer **as a route status**, and `/api/models`
is a bare array shared byte-for-byte with `models_list` — a wrapper is a breaking MCP change (DES-179's
boundary, still binding). Options against that constraint:

- (a) per-row `catalogSource: 'live' | 'last-good' | 'static'` — follows DES-179's per-row
  `catalogFetchedAt` precedent, costs one field, but cannot say 「ollama failed」 when there are no
  Ollama rows to carry it, and cannot move the tag.
- (b) a response header — invisible to the MCP caller, and `getJSON` reads no headers.
- (c) **`GET /api/models/status`** → `{ fetchedAt, source, count, providers: { anthropic:'static',
  ollama: 'ok' | {reason}, openrouter: 'ok' | {reason} }, degraded?: 'provider-failed: ollama' }`.
  The `degraded` key appears exactly when any provider fetch failed, so the existing classifier marks
  the route `degraded` and the tag truthfully reads 降級 on the Models tab with no reducer change.
  **Recommended.** It also resolves the handoff's 「Models fetched once per session」 against the one
  timer (B-S3): the Models view polls **only** the small status body each tick (keeping REQ-131's tag
  fed — an empty tick is the AD-2 hazard the design rationale recorded) and re-fetches the list only
  when `fetchedAt` changes. Engine side: `buildCatalogReport(opts) → { entries, providers }` with
  `buildCatalog = (await buildCatalogReport(opts)).entries` (every caller and test unchanged);
  `ModelBook` caches `providers` beside `entries` under the same TTL and single-flight (its source
  type widens to accept `{entries, providers}`; a bare array still normalizes); `BookSnapshot.providers?`.
  Plus one journal line `model_catalog_provider_failed {provider, reason}` **on transition only**
  (ARCH-130's rule: faults log, states do not; a 1-hour TTL means "once per refresh" is already rare,
  but the transition form is what keeps a flapping Ollama from being 20 lines an hour). This is an
  amendment to ARCH-116 (ModelBook) and ARCH-130 (the wire), not a new module — the housekeeping note
  is honoured. **Fallback if the panel refuses a route:** (a) plus the journal line; the tag stays
  blind to provider loss and the proposal says so rather than pretending (a) is equivalent.

**B-O2 — REQ-138's 「無法取樣」 must be per SECTION and must say why (MID, read).** `SystemInfoView`
already models degrade per section with a closed `Reason` set (`system-info.ts:24-34`:
`awaiting-second-sample | sample-window-too-short | timeout | unsupported-platform | probe-error`),
and three of those are **not faults**: `awaiting-second-sample` is the expected state of the first
tick after boot, `unsupported-platform` is permanent, `sample-window-too-short` is a fast double-poll.
Today `system.js:29` renders one zh-only `UNAVAILABLE` string for all of them and hides the reason.
Proposal: a pure `sectionState(x) → { kind: 'ok' | 'unavailable', reason? }` in `lib/` (B-R4), each of
the four stat cards, the process table and the engine `<dl>` rendered independently through it, the
ONE Unavailable component (DES-206 (S), `t(lang,'unavailable')`) plus the reason as secondary text in
the card's meta line — so an operator can tell 「wait one tick」 from 「this host cannot report it」
without opening the journal. The whole-route arm stays `res.status !== 'ok'` (BF-4's fix, one token).

**B-O3 — the client's own state is a black box; make it DOM-visible (MID, zero new module).** The
scheduler's decision (firing / parked) and the reducer's verdict exist only in closures in `app.js`.
Proposal: `app.js` stamps `data-conn="checking|live|degraded|offline"`, `data-source="live|demo"` and
`data-poll="active|parked"` on `document.documentElement` at each transition. Cost: three
`setAttribute` calls at sites that already exist (`updateConnectionTag`, the scheduler). Benefit:
Gate 7.5 can assert REQ-142's park state and REQ-143's source **from inside the page** as well as by
request interception, a teammate can read it in devtools, and it composes with the existing footer
rule (「Updated HH:MM:SS」 must show the last **settled** tick — while parked no tick runs, so the clock
holds by construction; state that as the invariant rather than discovering a ticking clock over a
parked poller). Not an ARCH-125 `style` violation: `data-*` attributes are state, not design values.

**B-O4 — REQ-143's self-labelling lives in the DATA, not only in the chrome (HIGH).** REQ-143's title
is 「示範資料必須**自我標示**」. A banner can be cropped out of a screenshot; a run id pasted into an
issue cannot. Every identifier in the dataset carries an unmistakable prefix — workflow names
`demo-…`, run ids `demo0001…`, agent ids `demo-agent-…`, issue titles `[DEMO] …`, PIDs in a fixed
`99xxx` band — and the marker appears at THREE layers: the nav tag (「示範資料 / Demo data」, outline
style per the README chrome spec), a shell-level banner (B-R3 places it where `mountLazy`'s
`container.replaceChildren()` at `app.js:404` cannot kill it), and the data itself. **The two
non-live tags partition the failure space, they do not stack:** Demo = the reducer is `offline` AND
nothing in the last tick was *reached* (no HTTP response at all — engine gone, tunnel down); Offline =
the reducer is `offline` AND the engine *answered*, with errors on every visible route (the 404 case,
a 5xx storm). So REQ-131's 「離線 / Offline」 clause stays live and validatable while REQ-143 stands —
it just needs an HTTP-error offline, not a stopped engine — and the day the dataset is retired (B-S4)
the unreached case falls back to Offline with no other change. 「Demo never with Live」 holds because
demo requires `offline` (B-S2), a state that by ARCH-124 excludes `live` in the same tick.

**B-O5 — REQ-139: keep serving the reason, drop the shape guard (MID, read).** `/api/issues` degrades
to `{open:[], resolved:[], degraded:'GitHub not configured'}` (`server.ts:463`) — a body that a
truthiness guard renders as two empty lists under a Live tag. `issues.js:99-111` and its detail
loader (`:78-83`) are shape-based (`data && data.degraded`, `!data || data.degraded`) — the
carry-forward-7 class by name. Positive rule: `res.status !== 'ok'` → the ONE Unavailable component,
**with the server's `degraded` string as the secondary text when the body carries one** (the reason
is the observability; the server already wrote it). The 404 on `/api/issues/:number` (`:477`) is
`fail` → Unavailable in the detail box, never a hidden box that looks like 「nothing selected」.

**Named and dropped at this altitude:** a server-side log for demo mode (impossible — demo is the
client's reaction to the server being gone); distributed tracing (no multi-hop request path exists
in a read-only dashboard); a `dashboard_api_degraded` line for `/api/issues`' token-missing arm (a
configuration state, not a fault — ARCH-130's rule applies).

## 2. Replaceability

**B-R1 — one data seam for every view (HIGH, measured).** Contract, stated so Gate 4 can copy it:
(i) a view's `onTick(container, bodies, ctx)` **reads** `bodies[url]` for every URL its `ROUTES`
entry names and **never fetches those itself**; (ii) `getJSON` is imported by `app.js` (the reducer's
transport) and by nothing else — click-fetch sites (`agent-panel.js`, `issues.js`'s detail loader,
`workflow.js:269`'s diagram fetch) import `getViewJSON` (B-R3's demo-aware wrapper); (iii) a view
returns extra statuses only for genuinely state-dependent fetches (the pattern `run.js`/`workflow.js`
already follow); (iv) **tab activation is a scheduler event**: `activateTab` (`app.js:163-201`) sets
`currentView` but never fires the loop — today the three tabs hide that by self-fetching in
`render()`; once they read the seam, a switched-to tab would wait up to 3 s empty unless activation
emits `view-changed → fire` (B-S1). Guard: one unit test walks `src/dashboard/ui/**` and fails on any
`import { getJSON }` outside `app.js`/`poll.js` — mechanical, like the no-design-values guard.

**B-R2 — one view registry instead of three tables (MID).** A new tab today touches `TAB_MODULES`
(`app.js:151`), `ROUTES` (`poll.js:16-27`) and `ASSET_KEYS` (`static-assets.ts:19-27`); forgetting the
third broke the whole served bundle with every unit test green (carry-forward item 6). Proposal:
`lib/views.js` exports `VIEWS = { home:{routes}, run:{routes}, workflow:{routes}, models:{module:'./models.js',
routes:[…]}, system:{…}, issues:{…} }`, consumed by both `app.js` and `poll.js` (which lose their
private tables), plus a `.ts` unit test that cross-checks every `module` path against `STATIC_ASSETS`
keys. Against the 「no new modules」 note: this is a `lib/` file under ARCH-124's existing row (an
amendment), and it deletes two tables to add one — net fewer registries, and lesson 6 becomes a red
unit test instead of a 0/12 acceptance.

**B-R3 — the demo dataset is a pluggable RENDER SOURCE, never a transport swap (HIGH).** The handoff's
own state machine is the counter-example: `.dc.html:530-537` — once `source === 'demo'`, `call()`
returns `DEMO[name]` and **never calls the API again**, so REQ-143's third clause (「引擎恢復可達 →
下一次輪詢即切回真實資料」) is unsatisfiable on that shape. Here: `getJSON` stays the real transport
and feeds the reducer raw; `getViewJSON(url)` = `viewBody(await getJSON(url), url)` where `viewBody`
substitutes **only when `demoActive` and the real result is `fail`** — `{status:'ok', body: DEMO.get(url),
source:'demo'}` when the dataset has the URL, `{status:'fail', body:null}` otherwise (the Unavailable arm,
never a fabricated zero); an `ok` real body always passes through, which is what makes recovery
immediate. **This is not the `okBody(res, fallback)` helper DES-206 forbids by name**, and the row must
say why so the distinction survives Gate 4: that helper *re-derived the verdict from body shape* and
handed callers a fallback that erased the failure; `viewBody` never looks at a body at all — it reads
the classifier's verdict (`res.status`), substitutes the **source** only on `fail` and only while
`demoActive`, the reducer keeps receiving the raw transport status from `getJSON` untouched, and every
call site still keys on `res.status` exactly as DES-206's positive rule requires (a demo body is `ok`
because it *is* a complete, typed body — the tag and the banner, not the guard, carry the fact that it
is fake). The dataset is `src/dashboard/demo/dataset.js` — plain ESM (ADR-049), registered in
`ASSET_KEYS` (lesson 6), **lazy-`import()`ed only on entry to demo** so a Live deployment never
serves the bytes, an exact-match `Map<url, body>` (the closed-map idea `static-assets.ts` already
uses — no URL parsing, no path building), and **type-locked by `tests/fixtures/dashboard-wire.ts`**:
a `.ts` test imports the dataset and `satisfies`-checks each body against `HomeView`, `RunSummary[]`,
the DAG fixture type, `AgentLogView`, `EnrichedModelEntry[]`, `SystemInfoView & {auth, catalog}`, the
issues shape — so the demo cannot drift from the wire, and the same rows are B-C1's disclosure
fixtures. Coverage boundary, stated: tick routes for every view; parametric routes (`/dag`, `/describe`,
`/agents/:id`, `/api/issues/:n`) for the dataset's own ids only; `diagram.svg` is a `fetch`→blob
(`workflow.js:269-276`), so in demo the figure shows `paintFigureUnavailable` — acceptable and recorded,
not a defect. Why not vendor `rwe-data.js`: refused already at the design gate (it carries the C3
word; `PROVENANCE.md` states it is not vendored) — the dataset must be **authored from the engine's
own fixture**, which is also why REQ-143's 「交付包的示範資料集」 wording needs the orchestrator's
housekeeping (§ expected disagreements, item 5).

**B-R4 — the two tabs' decisions live in `lib/`, not `ui/` (MID, QD-R2 debt).** Reuse `sortRows`
(`runlist.js:42`, absent-last in both directions — REQ-137's 12 sortable columns need exactly that
for `—` latency/benchmarks cells); add `lib/models.js` — `matchModels(entries, {query, provider, loc})`,
`modelRow(entry, lang) → cells` (the `—` rule, `text+image → text`, `TTFT … · p50 …` formatting),
`costDots(level) → '●●●○○'`, `panelModel(entry)` for the 560 px slide-in — and `lib/system.js` —
`sectionState` (B-O2), `statCard(section) → {value, pct, meta}`, `procRow`, `fmtBytes` (moves out of
`ui/system.js:38`), the `Total processes 312 · S 298 · R 7` header from `process.system.byState`. Rule of
admission unchanged from the v27 rationale: *an export earns its place iff `ui/` would otherwise
contain a branch or an arithmetic*.

**B-R5 — backend replaceability made honest on the Models tab (agent altitude).** Beside Tools /
Effort the row renders `declaredSource` — a 「✓」 from the static Anthropic table (`declaredSource:'static'`)
and a 「✓」 from OpenRouter's `supported_parameters` (`'upstream'`) are different facts — and, after
B-O1, the catalog's `source` line (「目錄時間 HH:MM · live / last-good / static」) in the filter row's
hint slot. This is where 「GPT ↔ Claude ↔ Llama is a config change」 becomes visible to the person who
has to choose: `location`, `stability`, `besteffort`, declared capability, and provenance, all on
one row. No new data is captured; every field already exists on `EnrichedModelEntry`.

**B-R6 — `SystemInfoSampler` stays OS-only; the counts card composes at the route.** REQ-138's
fourth card needs workflow / version / run-record counts. Not in the sampler: `SystemProbe` is the
injectable OS boundary (`system-info.ts:106-109`), `StubSystemProbe` tests depend on it staying so,
and a catalog dependency inside a probe is the coupling this lens exists to refuse. Compose at the
route the way `auth` already is (`server.ts:372`: `{ ...view, auth: authAnnounce }`) →
`{ ...view, auth, catalog: { workflows, versions, runRecords } }` from three `COUNT(*)` accessors
(`WorkflowCatalog.counts()`, `RunStore.countRuns()`; `workflow-catalog.ts:565` already runs a
per-name COUNT, so the pattern exists) — never `list().length` (ADR-052's unbounded-list lesson, on a
3-second poll). The MCP `system_info` tool keeps its shape (it does not spread `auth` either); the
widening owes a disclosure row (B-C1).

## 3. Consumability

**B-C1 — three routes without a contract (HIGH, measured).** `DISCLOSURE_TABLE`
(`dashboard-wire.ts:137-147`) pins `run_agent_log`, `/api/runs[i]`, `/api/runs/:id/dag`, `/api/home`,
the agent route and the generic degraded body; **`/api/system`, `/api/models`, `/api/issues` appear
nowhere in the fixture or the test.** Sprint B widens `/api/system` (B-R6), `/api/models` (B-C2, and
the new status route under B-O1) and re-themes `/api/issues`' consumer, so under ADR-054's budget rule
the rows are owed now: `SYSTEM_VIEW_EXAMPLE satisfies SystemInfoView & {auth, catalog}` (plus its
per-section degraded variant), `MODEL_ENTRY_EXAMPLE satisfies EnrichedModelEntry`, `MODELS_STATUS_EXAMPLE`,
`ISSUES_LIST_EXAMPLE` + the token-missing degraded body, each with `allowed`/`required` key sets. One
fixture, three consumers: the disclosure lock, the `.js` unit tests' inputs, and the demo dataset's
type oracle (B-R3). In a repo with no OpenAPI, this table **is** the generated API doc — keep it that.

**B-C2 — `supportedParameters` back on the wire, deliberately (MID, decision).** REQ-137's acceptance
names 「支援參數以 neutral tag 列出」; the only source is OpenRouter's `supported_parameters`, which
`enrichModelEntry` drops at `model-catalog.ts:429` under v26's 「one name per fact」 (`toolUseDeclared`/
`effortDeclared` are its projections). Proposal: add `supportedParameters?: string[]` to
`EnrichedModelEntry` under its projected name — the two booleans stay, the list is the fuller fact
an **agent** choosing a model also needs (it is exactly what `wireEffort` reasons over server-side),
and it is absent for rows whose provider declares nothing (never `[]` for 「unknown」). Costs, stated:
`models_list` shares `enrichModelEntry`, so the MCP payload grows (~100 B on OpenRouter rows only);
`models_list`'s description enumerates its output fields (`tool-specs.ts:961-968`) and must name the
new one; `v24-tool-surface.md`'s row regen is owed in the same pass (lesson 9, QD-C3). Alternative,
so the choice is visible: render the panel's parameter list from the two booleans only (two tags) —
meets the clause in letter, not in substance; orchestrator/owner call.

**B-C3 — `latency?` / `benchmarks?` declared in the TYPE and the allowed key set, no producer (LOW,
decision).** D2 is Won't-have; REQ-137 requires `—` on absence. Declaring `latency?: {ttftMs, p50Ms}`
and `benchmarks?: Record<string, number>` on `EnrichedModelEntry` now costs one line, zero runtime,
and pins the shape a v28 producer must fill so it cannot invent a second one; the client's `—` rule
(`lib/models.js`) is independent of it either way. Expected pushback: speculative — see disagreements.

**B-C4 — `?topN=` on `/api/system` (LOW).** `server.ts:370` hardcodes `topN: 5` for the dashboard;
REQ-138's process table is a table, not a top-5 list. Proposal: `GET /api/system?topN=N` clamped by
the sampler's own `[1,50]` (clamp-not-reject already exists, `system-info.ts:120`), default 5
unchanged so `system_info` and every existing test are untouched; the dashboard asks for 15. Gate 4
may decide 5 is enough; the knob is one line and no config key.

**B-C5 — the string table, one edit per key pair (MID, QD-R3).** `t()` has no fallback
(`strings.js:41`), so every Sprint B key (`demoData`, `catalogAsOf`, `processes`, `engineSelf`, the
twelve column headers, `open`/`resolved`/`openOnGitHub`, `noIssues`) lands in **both** languages in
one edit; `system.js:29`'s zh-only `UNAVAILABLE` copy is retired (strings.js's own comment defers it to
exactly this repair); `issues.js:34-77`'s literals move; the three rewritten files add **zero** to
QD-R3's 17 `lang`-conditional copy sites. The key-parity test grows by the same count.

**B-C6 — the validation anchors are part of the contract (read).** `val-202` keys on `.models-table`,
`#system-panel`, `#issues` and a 「degraded」 text; REQ-137/138 change those surfaces, so val-202 is
**re-authored under its own VAL id** (C2's rule, carry-forward item 5: exercise the tab the user opens,
via the tab strip, not a legacy route), never silently deleted; `getComputedStyle` cannot see a
flex-shrink clip — every 「text fits its box」 clause in the two new tables uses the `notClipped`
`SpecExpect` kind (`spec-rows.ts:93`; carry-forward item 4).

## 4. Self-sustainability

**B-S1 — REQ-142's scheduler is a pure state machine in `lib/`, not six lines in `app.js` (HIGH).**
`lib/scheduler.js`: `nextPoll(state, event) → { state, action }` over events `settled | hidden |
visible | view-changed` and actions `fire | arm(3000) | park`. `hidden → park` (**no timer at all** —
a parked poller produces no empty ticks, so the reducer's 「empty tick reports live」 hazard (AD-2,
design rationale item 2) is unreachable by construction; identity-on-empty lands in `nextConnection`
anyway as defence in depth); `visible → fire` once, then `arm` (REQ-142 clause 3: immediate, then the
3-second rhythm); `view-changed → fire` (B-R1 (iv)); `settled → arm` unless parked. `app.js` keeps
only the wiring: `document.addEventListener('visibilitychange', …)` and one injected
`visibility()` getter so the machine is unit-tested in node with a fake. Why a `lib/` file and not
an `if` in `app.js`: QD-R2 is the recorded finding that decidable logic in `ui/` has no unit tier, and
the last time a guard lived there it took six rounds; the generation counter (`viewGeneration`,
`app.js:357`) stays in `app.js` because it is wiring. **Oracle traps, named so Gate 5 does not build a
poisoned one (carry-forward item 3):** `Page.setWebLifecycleState({state:'frozen'})` stops JS and
passes vacuously; `Object.defineProperty(document, 'visibilityState', …)` fakes the platform. The
honest mechanism is a **real** hidden state — a sibling `browser.newPage()` + `bringToFront()` — and
whether headless Chromium fires `visibilitychange` on the backgrounded page is the first thing to
**measure**; if it does not, `--headless=new` vs old headless is the next variable, and only then a
documented fallback. The positive checks: `page.on('request')` counting `/api/*` for 30 s hidden = 0,
first `/api/*` request within ~300 ms of re-show, `data-poll="parked"` during the window (B-O3).
REQ-142's text says 「Playwright 攔截請求」; the repo's harness is puppeteer (ADR-053's housekeeping
already asked for that wording change on REQ-131/132) — flag, do not decide.

**B-S2 — demo mode is graceful degradation with truthful recovery, and it must not fire on a healthy
engine (HIGH).** Predicate: `demoActive = conn.status === 'offline' ∧ lastTick.allUnreached ∧
DEMO_AVAILABLE`, where `reached` is true iff an HTTP response arrived with any status. `getJSON`
(`poll.js:44-54`) gains `reached` — the outer `catch` is its only `false` arm; the reducer and
`classifyResponse` are **untouched** (QD-O4's 404 → offline tag stays recorded LOW debt, out of this
closure, and no longer poisons REQ-143). Ordering in `tick()` (`app.js:365-387`): extras from
`view.onTick` merge into `results` before `nextConnection` runs, so `demoActive` for **rendering** is
read from the **previous** tick's state when `viewBody` builds `bodies` — entry lag = the two unanimous
unreached ticks `offline` already needs + one tick ≈ 9 s; exit = the first tick whose real fetch is
`ok`, because `viewBody` passes any `ok` body through regardless of `demoActive` → REQ-143 clause 3
holds without a second probe. The real poll **never stops** in demo (3 s, D3 unchanged). Reality of
the trigger, stated plainly: the page is served by the same process as `/api/*`, so a cold load with
the API down is not a page at all — the only real trigger is **mid-session engine loss** (self-update
restart, tunnel drop). Consequences: Gate 7.5 must **stop the engine under an open page**, not
cold-load; and during every self-update restart a teammate watching a run will see demo workflows
for the restart's duration — the owner's Q8 choice (「先保留,因為我要看有缺什麼」), mitigated inside
the REQ by B-O4's three-layer marking, and one more reason B-S4's exit must be mechanical.

**B-S3 — a tab open all day: idempotent paint, stable state, small heartbeat (MID).** The one
client-side analogue of memory metabolism. Models: 100+ rows × 12 columns rebuilt every 3 s is
~1 200 nodes of churn for a catalog with a 1-hour TTL — B-O1's status heartbeat removes the list from
the tick, and the view repaints only when a fingerprint changes (`fetchedAt` + count + sort/filter/
selection); sort direction, active filter and the open slide-in live in per-container state
(`home.js:199-217`'s pattern) so a tick never closes a panel or resets a sort. System: `sampledAt`
changes every tick by design — repaint **values** in place (card figure, bar width via the one allowed
geometry write, `<dl>` cells), never the table skeleton; process rows are keyed by pid. Listeners stay
delegated on stable wrappers (ARCH-125's invariant). Not built: a virtual DOM, a diff library.

**B-S4 — REQ-143's exit is a tripwire, not a note (HIGH).** The REQ registers its own retirement and
names the ledger's most-recorded defect class (「刪掉了卻還有東西在描述它」). Proposal:
`tests/unit/demo-surface.test.ts`, a closed-both-ways allowlist of the files permitted to contain the
tokens `demo` / `示範` (`src/dashboard/demo/dataset.js`, `lib/strings.js`'s two keys, `app.js`'s one
`demoActive` arm, `lib/scheduler.js` if it references the source, the VAL/UT files) — the same
mechanism as `static-assets.test.ts:50-68`'s readdir diff and the C3 guard. Deleting `src/dashboard/demo/`
turns the 「listed ⇒ on disk」 half red until the allowlist, the strings, the arm, REQ-143 and its VAL
rows retire **together**; adding a mention elsewhere turns the other half red. Retirement then costs
one commit that removes a directory, three lines and a test, with nothing left describing it.

**B-S5 — tool liveness at the agent altitude: the catalog's fetch IS the probe (LOW).** `stability`
and `besteffort` are declared, never probed; B-O1's per-provider outcome is the only liveness signal
this slice has (a real fetch to Ollama and OpenRouter once per TTL). No new prober — D2 territory.

**Named and dropped:** autoscaling and circuit breakers (a single-process operator page over a
3-second poll; D3 excludes interval tuning and push); a server-side retention/GC for anything Sprint
B adds (it persists nothing); memory metabolism of agent context and prompt self-calibration (no seam
in five read-only UI rows — inventing one would be scope invention, as the v27 r1 also concluded).

---

## key_points

1. **One seam or three hook sites.** The three tabs read `bodies[url]` from the one `tick()`;
   `getJSON` is imported only by `app.js`/`poll.js`; tab activation is a scheduler event
   (B-R1). Everything below composes on this; without it each of REQ-142/143 is re-implemented per tab.
2. **Demo keys on unreachable, not on the tag.** `reached` on `getJSON`; `demoActive = offline ∧
   allUnreached`; substitution only for `fail`, only in `viewBody`; real poll never stops; exit on the
   first `ok` (B-S2). The handoff's own machine never re-probes — do not transcribe it.
3. **Provider failure becomes a route status.** `GET /api/models/status` with `degraded` on any
   provider failure, `buildCatalogReport`, `ModelBook.providers`, one transition-logged journal line;
   fallback per-row `catalogSource` if the route is refused (B-O1).
4. **Two wire deltas, both composed, neither a new config key:** `catalog` counts on `/api/system`
   at the route via COUNT accessors (B-R6); `supportedParameters` as a named projection on
   `EnrichedModelEntry` with the MCP cost and the tool-surface regen stated (B-C2).
5. **Three disclosure rows and three fixtures are owed now** (`/api/system`, `/api/models` +
   status, `/api/issues`), and the same fixture type-locks the demo dataset (B-C1, B-R3).
6. **The scheduler is a `lib/` state machine** (`park | fire | arm`) tested in node; the browser
   proof uses a real hidden page, never a frozen one or a patched `visibilityState` (B-S1).
7. **Self-labelling in the data, marker at three layers, exit by tripwire** — `demo-` prefixed
   ids, nav tag + shell banner + data, `demo-surface.test.ts` closed both ways (B-O4, B-S4).
8. **Positive `res.status` rule at every Sprint B site, every string in both languages in one edit,
   decisions in `lib/`** — `issues.js:79-83,99-111`, `models.js:54-58`, `system.js:29` are the named
   sites (B-O5, B-C5, B-R4).

## risks

| id | sev | risk | evidence | mitigation in this proposal |
|---|---|---|---|---|
| B-K1 | HIGH | The tabs keep self-fetching and REQ-142/143 are bolted on per tab — three visibility hooks, three demo hooks, three future BFs | measured: `models.js:52`, `system.js:72`, `issues.js:99` call `getJSON` in `onTick`; `home/run/workflow` read `bodies` | B-R1 + the `getJSON` import guard |
| B-K2 | HIGH | Demo swaps in on a healthy engine (stale `/dashboard/<runId>` → 404 → `fail` ×2 → `offline`) | read: `server.ts:490`, `connection.js:46,38` | B-S2's `reached` predicate |
| B-K3 | HIGH | Demo never recovers (transport swap, the handoff's shape) or flashes Unavailable→demo→real on restarts | read: `.dc.html:530-537`; ordering at `app.js:379-384` | B-S2 substitution only in `viewBody`, real poll continues, stated lag |
| B-K4 | HIGH | Ollama/OpenRouter loss invisible: full table, fresh `catalogFetchedAt`, Live tag | measured: probe A/B | B-O1 status route (fallback per-row source + log) |
| B-K5 | HIGH | Oracle poisoning on REQ-142 (frozen page or patched `visibilityState` passes vacuously) and on REQ-137/138 (SPEC_ROWS copied from the build) | carry-forward 3/4; not measured whether headless Chromium fires `visibilitychange` on `bringToFront` | B-S1 names the real mechanism and the measurement order; README §4/§5 is the only oracle |
| B-K6 | HIGH | Three routes widened with no key-set lock → accidental disclosure, INV-V27-7 breached by omission | measured: 0 rows for system/models/issues | B-C1 |
| B-K7 | MID | The Models tab repaints 1 200 nodes every 3 s and loses sort/panel state; or the view stops polling and the tag goes stale on the Models tab | read: `models.js:60` `replaceChildren(buildTable(entries))` per tick; AD-2 empty-tick hazard | B-S3 fingerprint + per-container state; B-O1's heartbeat keeps the tag fed |
| B-K8 | MID | `supportedParameters` grows every `models_list` reply and the tool-surface doc goes stale again | `tool-specs.ts:961-968`; QD-C3 | B-C2 names the regen as owed in the same pass |
| B-K9 | MID | A second `UNAVAILABLE`/literal copy per file; a key added in one language renders `undefined` | `strings.js:41` no fallback; `system.js:29`; QD-R3 | B-C5 |
| B-K10 | MID | The counts card is fed by `catalog.list()` + `listRuns()` on a 3-second poll | ADR-052's unbounded-list lesson | B-R6 COUNT accessors |
| B-K11 | MID | Demo dataset drifts from the wire, or ships to Live deployments | none yet — the module does not exist | B-R3 `satisfies` lock + lazy import |
| B-K12 | LOW | `val-202`'s anchors deleted instead of re-authored; flex-shrink clip in the new tables invisible to `getComputedStyle` | carry-forward 4/5 | B-C6 |
| B-K13 | LOW | Per-section reasons hidden behind one 「無法取樣」; first-tick `awaiting-second-sample` read as a fault | `system.js:29` | B-O2 |

## expected disagreements

The other lens is **adversarial** (security × scalability/performance × testability, Karpathy
simplicity-first as tie-breaker). Where I expect it to bite, and what I will and will not concede:

1. **`GET /api/models/status` is a new surface (B-O1).** Simplicity-first will prefer per-row
   `catalogSource` or nothing. I concede that (a) is cheaper; I do not concede it is equivalent —
   it cannot move the tag, and a tag that says 連線中 over a catalog missing a provider is the lie the
   owner already refused once (v27h ruling). The route is also the only shape that removes the 100-row
   list from every tick (their performance concern, my heartbeat). Fallback stated in the row.
2. **`supportedParameters` reverses a v26 boundary on the MCP surface (B-C2).** They may call it a
   dashboard nicety paid for by every MCP caller. The acceptance clause names it; the agent-side
   benefit is real; the byte cost is small and on OpenRouter rows only. If refused, the two-tag
   rendering must be recorded as meeting the clause in letter only.
3. **Typed-but-absent `latency`/`benchmarks` keys are speculative (B-C3).** Likely refused under the
   tie-breaker; I will not fight for it — the `—` rule stands either way. Recorded so v28 knows the
   shape question was seen.
4. **`lib/scheduler.js` is ceremony for `visibilitychange` (B-S1).** Expect 「six lines in `app.js`」.
   My answer is QD-R2 and six guard rounds: the decision table (`park/fire/arm` × four events, plus
   the tab-activation fire) is exactly the kind of logic the ledger has measured to rot untested in
   `ui/`. I would concede a smaller machine, not its location.
5. **The demo dataset's origin.** Three positions exist: vendor `rwe-data.js` (refused at Gate 4 —
   C3 word; PROVENANCE.md), author from the wire fixture (mine), or drop demo entirely (the owner
   refused, Q8). REQ-143's 「交付包的示範資料集」 wording cannot be met literally; the orchestrator
   should record the reading 「a demo dataset, engine-authored, type-locked to the wire」 as
   housekeeping — the panel may not edit acceptance text.
6. **Demo on `degraded`?** Someone may argue a tab whose only route failed is 「不可達」 for that
   tab. REQ-143 says the API is unreachable, REQ-131's three-tag oracle already assigns partial failure
   to 降級, and B-K2 shows why an HTTP error must never be enough. Not conceding.
7. **Where the counts card gets its numbers (B-R6).** Alternatives: client composition from
   `/api/workflows` + `/api/runs` (two unbounded lists per tick — refuse), a fourth route (refuse: a
   number the System tab already polls for lives on the System route), inside the sampler (refuse:
   OS boundary). Expect agreement; recorded because ADR-054's disclosure row rides on the choice.
8. **`?topN=` (B-C4) and `data-*` state stamps (B-O3).** Both may be called unasked-for; both are one
   line and no config key; the stamps are what lets the REQ-142 proof read the page instead of only
   counting requests. I would drop `?topN=` before the stamps.
9. **Testability lens on REQ-142's proof.** They will want request interception only (measure, do not
   read); I agree it is the primary oracle and add the in-page stamp as the second, not a replacement.

**Housekeeping for the orchestrator (not decisions of this panel):** (i) REQ-142's 「Playwright」 →
「真實 Chromium(既有 puppeteer harness)」, the ADR-053 wording; (ii) REQ-143's 「交付包的示範資料集」
reading per item 5; (iii) REQ-137's `/api/models` per-row `latency`/`benchmarks` are declared absent
this iteration — say so in the acceptance's own words, not only in D2; (iv) REQ-138's counts card and
REQ-137's parameter tags each imply a wire delta REQ-140 did not enumerate — either widen REQ-140's
list or let ARCH-130's amendment carry them, but name it; (v) the Sprint A architect's 「add rows to
ARCH-124/125/130」 holds for everything here except `demo/dataset.js` (a new asset under ARCH-123's
map, not a module) and the two `lib/` files (amendments to ARCH-124); (vi) **REQ-131 × REQ-143
interaction, measured:** no acceptance test proves REQ-131's 「離線 / Offline」 clause today
(`grep -i 'offline|離線' tests/acceptance/*.ts` hits only `val-089`, a seedref test; `val-198`'s only
failure case is the 200-`{degraded}` interception on `/api/home` at `:276-283`). When Gate 5 writes
the Offline proof it must induce an **HTTP-error** offline — interception answering 404/503 on every
route the visible view depends on (`reached ∧ all-fail`) — never a stopped engine or an aborted
request, or the case silently flips to Demo the day the dataset lands (B-O4's partition). Conversely
REQ-143's own proof is the stopped engine under an open page (B-S2). Two proofs, two mechanisms,
stated now so neither is built as the other.
