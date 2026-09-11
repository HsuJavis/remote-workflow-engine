# Design panel — round 1 (independent proposal)

**Lens:** Adversarial design group — three lenses that trade off against each other:
**(a) Interface-contract** (API/function signatures, input/output types, compatibility),
**(b) Boundary/error** (failure modes, error codes, completeness of boundary conditions),
**(c) Testability** (every DES coverable by a UT; clock/storage injectable).
**Tie-breaker:** Karpathy simplicity-first — the minimum design that solves the problem, no needless
flexibility. Where my own three lenses pull apart I say so by name in §3 rather than silently picking one.

**Scope:** Gate 3+4 for v27. Architecture closure = **REQ-131..136, REQ-140, REQ-141** (ARCH-122..131,
ADR-049..056). `03-tasks.md` for v27 does not exist yet; where task splitting or task ORDER changes the
answer I say so in §4.

**Baseline read:** `01-requirements.md` §Iteration v27 (REQ-131..143 + C1..C4 + D1..D4),
`02-architecture.md` §v27 slice (lines 3312–3661), `state.yaml` `tech_stack` + `gates.architecture.note`,
and the live tree at `576a972`. Every claim below is anchored at `file:line` and was read, not recalled.

---

## 0. Altitude call — BOTH, and the design lens splits them differently from the architecture lens

`tech_stack` describes an **AI-agent system** (Claude Agent SDK harness, managed LiteLLM proxy, MCP tool
surface, agent transcripts, four-column tokens + USD) that is *delivered through* a **conventional
server-rendered web system** (hand-rolled JSON-RPC/HTTP `src/server.ts`; one served HTML string
`src/dashboard-page.ts`). Both altitudes apply. The design-stage split is not the architecture's split:

| My lens | System altitude (the shell + the wire) | Agent altitude (what an agent did / what may leave the process) |
|---|---|---|
| Interface-contract | route payload shapes, `RunSummary`'s four new optionals, `STATIC_ASSETS` keys, `lib/*.js` exports | `HarnessDescriptor` (the durable record of a dispatch), `AgentRecord` on the wire, the MCP `run_agent_log` contract a **cold model** parses |
| Boundary/error | 404 on an unknown asset key, `degraded` 200s, missing woff2, SQL `NULL`, `visibilitychange` | a **failed** call carries `unmapped` and no `tokens`; an **unpriced** call is `$0` **and flagged**; a **stripped** prompt vs a **never-applied** one |
| Testability | pure `.js` imported by vitest; puppeteer for the rest | the oracle for 「不含 system prompt 任何片段」 must be decidable, and it must be asserted on the **response body of both transports**, never on the decorator |

**What the altitude call changes for me, concretely.** REQ-136 and REQ-140's `record` are **not** UI work.
`server.ts:563` is literally `facade.runAgentLog(..., { kind: 'auth-disabled' }, false, null)` — the dashboard
route *is* the MCP call. So every contract I write for the agent panel is simultaneously a contract change
for a cold model reading `run_agent_log`, and for the cross-repo `rwe-mcp` plugin client. Conversely
REQ-131/132/133/134/137/138/139/142/143 are system-altitude only and must not be allowed to drag
agent-altitude shapes around with them.

---

## 1. Summary — my position in eight lines

1. **The dispatched closure is not shippable as a slice.** ARCH-122 empties `DASHBOARD_HTML` of executable
   JS; that one `<script>` (`dashboard-page.ts:241`) is what renders **Models** (`:410-415`), **System**
   (`:390-394`) and **Issues** (`:643-676`). No ARCH row rehomes them. Shipping REQ-131..136/140/141 alone
   **regresses REQ-067/076/077/078** — which REQ-139 forbids in as many words. §4.1 names both exits.
2. **~41 existing assertions across 5 test files grep `DASHBOARD_HTML` for client-JS content.** C1 named
   three. The dangerous half is not the reds — it is the **greens**: `expect(DASHBOARD_HTML).not.toContain('innerHTML')`
   (`dashboard-diagram-render.test.ts:106`) **passes trivially** once there is no JS in the string, so an
   XSS guard stops guarding with CI green. Fix = one new subject `clientCorpus()` + a positive non-vacuity
   anchor per file (D-DES-10).
3. **INV-V27-1 is unimplementable as literally written.** `/api/runs[i].costUSD === /api/runs/:id.usage.costUSD`
   is FALSE for a zero-record run: `sqlite-run-store.ts:277` always folds (`snap?.usage ?? foldUsage(...)`,
   never absent), while ARCH-127 omits the field. Corrected statement + the two positive cases in D-DES-7.
4. **Two folds exist and ARCH-127 step (3) names neither.** `foldUsage(events)` (`run-guard.ts:47`) and
   `foldUsageFromRecords(records)` (`run-manager.ts:242`) agree only because IT-156 makes them — v26 R-1 is
   what a comment promising agreement was worth. The backfill must call **`foldUsage` over the transcripts**,
   the exact expression `getRun` already uses, so it *memoizes* rather than *re-derives* (D-DES-6).
5. **REQ-136's strip must be prefix-VERIFIED, not a length slice.** `sys.length + 2` is right today
   (`params/resolve.ts:181-185` joins with `\n\n` and both gateways set `prompt: req.prompt` verbatim —
   `gateway/client.ts:501`, `claude-agent-sdk-client.ts:691`), and is wrong the day anything prepends. Three
   lines make it fail-closed (D-DES-1).
6. **`runAgentLog` has no named return type** (`mcp-facade.ts:664-666` — an inline
   `ResultEnvelope<TranscriptEvent[]> & {...}`), so ADR-049's `tests/fixtures/dashboard-wire.ts satisfies <routeType>`
   lock cannot be written for the one endpoint REQ-135/136/140 all land on. Export `AgentLogView` /
   `AgentLogError` (D-DES-9).
7. **`ui/*` has no UT tier at all** (ADR-049 refuses jsdom) and the puppeteer tier **skips** when Chrome is
   absent (`val-193:45`). Two cheap answers: push every branch into `lib/` (D-DES-11) and make
   `RWE_REQUIRE_BROWSER=1` flip skip→fail for Gate 7.5 (D-DES-14).
8. **Task ORDER is load-bearing, not cosmetic.** `vitest.config.ts:7` (`include: ['tests/**/*.test.ts']`)
   and the two `.js`-blind walkers (`no-skeleton-surface.test.ts:55-61`, `no-retired-surface.test.ts:23-29`)
   must be **TASK-1 of the slice**. Landing them after any `lib/*.js` means the new tests never run and the
   guards never look — green CI, unshipped tests, forbidden words in served bytes (D-DES-13).

I propose **no new module** beyond what ARCH-122..131 already names, and I actively refuse three that a
richer design would add (§6). Everything below is a signature, a boundary or a UT oracle.

---

## 2. Key points — candidate DES rows (signature / boundary / UT oracle only)

Format mirrors the v26 rows the synthesizer lifts: **sig** / **boundary** / **UT**. Reasoning lives in §3.

### Group A — REQ-136 / ARCH-129: what may leave the process (agent altitude)

**D-DES-1 — `stripSystemSegment`: a prefix-VERIFIED slice that fails closed.**
- **sig:** in `src/params/resolve.ts` beside `composePrompt` (its inverse, one file, no new module):
  `export function stripSystemSegment(composed: string, sys: string | undefined): { prompt: string; stripped: boolean }`.
- **boundary (total over six cases, all decidable):**
  (1) `sys === undefined` or `sys === ''` → `{ prompt: composed, stripped: false }` — nothing was applied.
  (2) `composed.startsWith(sys + '\n\n')` → `{ prompt: composed.slice(sys.length + 2), stripped: true }`.
  (3) `composed === sys` (the degenerate empty-script case) → `{ prompt: '', stripped: true }`.
  (4) prefix **absent** → `{ prompt: '', stripped: false }` — **fail closed**: if we no longer know where the
      boundary is, we ship nothing rather than guess. Never return `composed` here.
  (5) `sys` containing `\n\n` internally — irrelevant by construction, because (2) matches the whole `sys`.
  (6) non-BMP / multi-byte `sys`: the slice is by **UTF-16 code units** (`String.length`), while the reported
      `bytes` is `Buffer.byteLength(sys,'utf8')`. These are two different numbers **on purpose**; a design
      that uses one for the other corrupts the prompt on any CJK system prompt — and this repo's own agent
      definitions are Chinese.
- **UT:** six cases, one assertion each, pure — no clock, no store, no gateway. Plus one property test:
  `stripSystemSegment(composePrompt(s,a,p,ap), s).prompt === composePrompt(undefined,a,p,ap)` for a table of
  `(s,a,p,ap)` including `s=''`, `a=undefined`, `p=''`, `ap=undefined`. That property is the real contract;
  the six cases are its corners.

**D-DES-2 — the descriptor split, at the one decoration site, in a fixed order.**
- **sig:** `types.ts` — `HarnessDescriptor.systemPrompt?: { agentType: string; bytes: number; stripped: boolean }`.
  `agentType` is `req.opts.agentType` (`agent-executor.ts:543-545` — already in scope at the decoration site);
  `bytes = Buffer.byteLength(def.systemPrompt,'utf8')`; `stripped` is D-DES-1's flag.
  `_invokeOnce(req, prompt, opts, eff, sys?: string)` — a 5th **positional** param is acceptable here only
  because this method is `private` with exactly one call site (`agent-executor.ts:601`). If a second call
  site ever appears, it becomes an options object; state that now so the next reader does not add one silently.
- **boundary:** the persist order at `agent-executor.ts:672-676` is and stays **strip → `redact()` → `capPrompt`**.
  Strip must precede redact (a stripped segment cannot then be half-redacted) and cap must stay last (R-G9:
  capping first can split a secret across the 4 KB seam). `prompt` stays typed `string`, never `string | undefined`
  — `val-082:138-140` asserts non-empty and must keep passing, so case (4)'s `''` is the one input that would
  break it and the fixture for that val must keep a non-empty script prompt.
  The **wire** prompt is untouched: `composePrompt` still composes all four segments and `schemaPrompt`
  (`agent-executor.ts:594`) is still built from the composed string.
- **UT:** (i) a `def` with a non-empty `systemPrompt` → persisted `descriptor.prompt` does not start with it and
  `systemPrompt.stripped === true`; (ii) no `agentType` → `systemPrompt` key **absent** (not `null`, not
  `{bytes:0}`); (iii) `agentType` whose `systemPrompt` is `''` → key absent; (iv) a gateway stub that returns a
  descriptor whose `prompt` is NOT the string it was given → `prompt === ''`, `stripped === false`, and one
  `console.warn`-free structured log line. Store is already injectable (`AgentExecutorDeps.store`), clock too
  (`this._clock`), so all four are plain UTs.

**D-DES-3 — the REQ-136 oracle: make 「不含任何片段」 decidable.**
- **sig:** no production symbol; this is the test contract REQ-136's acceptance needs in order to be assertable.
- **boundary:** "contains no fragment" is unbounded as stated. Decidable form, three conjuncts:
  (1) the response body (`JSON.stringify`) does **not** contain the full `systemPrompt` string;
  (2) it does not contain a **planted distinctive marker sentence** that exists only inside the test
      agentType's `systemPrompt` (the `val-104:79-81` pattern — script marker / user marker ordering);
  (3) it **does** contain the script-supplied prompt, so the assertion cannot pass by emptying everything
      (the anti-vacuity half REQ-136's second Given asks for).
- **UT/IT:** asserted against the **real response body** on **both** transports — HTTP
  `GET /api/runs/:id/agents/:agentId` and MCP `run_agent_log` — never against the decorator's return value.
  ADR-054's disclosure test is the right home (one file, two requests).

### Group B — REQ-141 / ARCH-127/128: one usage number, and absence as a value

**D-DES-4 — `summarizeUsage`: the absence rule lives in ONE named function, not in four `if`s.**
- **sig:** `run-manager.ts` (module-private, beside `foldUsageFromRecords`):
  `type SummaryUsage = { costUSD: number; unpricedCalls: number; tokensTotal: number; agentCount?: number }`
  `function summarizeUsage(u: RunUsage | undefined, agentCount: number | undefined): SummaryUsage | undefined`.
  `RunSummary` gains exactly the four optionals ARCH-127 names; they are spread from this one return value
  (`...(s !== undefined ? s : {})`), so "omitted together" is structural rather than remembered.
- **boundary — the trap this design walks straight into:** `foldUsageFromRecords([])` returns
  `{tokens:{0,0,0,0}, costUSD:0, unpricedCalls:0, unmappedMessages:{}}` — a **fully populated zero**, not
  `undefined` (`run-manager.ts:242-260`). REQ-141 says 完全無用量時省略該欄而非填 0. So absence must be keyed on
  **`records.length === 0`**, decided *before* the fold, and never on `costUSD === 0`.
  Explicitly: a run with **one unpriced `done` call** is `{costUSD: 0, unpricedCalls: 1, tokensTotal: n}` —
  **present**, and `$0.00` there is honest only because `unpricedCalls` rides beside it (ADR-046 / INV-V26-6).
  `agentCount` is `undefined` for the legacy cohort and the field is then dropped while the other three stay.
- **UT:** (i) 0 records → `undefined`; (ii) 1 `done` unpriced record at `costUSD: 0` → present, `unpricedCalls: 1`;
  (iii) 1 terminally-failed record (carries `unmapped`, no `tokens`) → present, `tokensTotal: 0`, `costUSD: 0`;
  (iv) legacy cohort → three fields present, `agentCount` absent. All four pure.

**D-DES-5 — the SQL projection: three `NULL` traps, each one line.**
- **sig:** `sqlite-run-store.ts` `listRuns()` / `list(filter)` gain one
  `LEFT JOIN run_snapshots s ON s.runId = r.runId` projecting `json_extract(s.json,'$.usage.*')`.
- **boundary:**
  (1) **`NULL` poisons a sum.** `a+b+c+d` is `NULL` in SQLite if any term is `NULL`, so a `usage` written
      without `cacheWrite` yields `tokensTotal = NULL` → the field is omitted **while `costUSD` is present**,
      breaking "all four omitted together". Every term must be `COALESCE(json_extract(...),0)`; the row's
      **presence** is keyed on
      `json_extract(s.json,'$.usage') IS NOT NULL AND COALESCE(json_array_length(s.json,'$.agents'), 1) > 0`,
      never on the arithmetic.
  (1b) **The live key and the at-rest key must agree across the terminal transition — they do not by default.**
      `run-manager.ts:1014` writes `usage: foldUsageFromRecords(agents)` **unconditionally**, so a run that
      completes having made **zero `agent()` calls** (a script that just returns) lands a snapshot with
      `agents: []` and a fully-populated zero `usage`. A bare `usage IS NOT NULL` key would then report
      `costUSD: 0, agentCount: 0` for a run that reported **absent** thirty seconds earlier while it was
      running under D-DES-4's `records.length === 0` rule. That flip at the terminal transition is R-1's shape
      inside this very proposal, which is why the `json_array_length(...) > 0` conjunct is load-bearing; the
      `COALESCE(...,1)` is what keeps D-DES-6's `{usage}`-only backfilled row (no `$.agents` key at all)
      **present**.
  (2) **`0` is falsy in JS.** `if (row.costUSD)` drops a legitimate `$0` run. The mapping must test
      `row.costUSD !== null && row.costUSD !== undefined`.
  (3) **`json_array_length` on a missing path** returns `NULL`, which is exactly the `agentCount`-absent
      signal for a `{usage}`-only backfilled row — that is correct and should be asserted, not coalesced.
- **UT:** against a real `better-sqlite3` temp DB (the store's existing test pattern), four rows: no snapshot /
  full snapshot / `{usage}`-only snapshot / snapshot whose `usage.tokens` lacks `cacheWrite`. Plus the
  `InMemoryRunStore` parity test running the **same table** through both implementations — ARCH-128 promises
  parity and nothing enforces it. **Fifth row, the one this section exists for:** a full snapshot whose
  `agents` is `[]` → **all four fields absent**, matching what the live path reported while the run was running.

**D-DES-6 — `backfillUsage`: which fold, and it is a WRITE on a READ path.**
- **sig:** `RunStore.backfillUsage(runId: string, usage: RunUsage): Promise<void>` on the interface
  (`run-store.ts:191-217` neighbourhood), implemented by both stores.
- **boundary — the row ARCH-127 leaves open:** step (3) of the precedence chain says "a one-time backfilled
  fold" without saying **which** fold. It must be **`foldUsage(this._allTranscripts(runId))`** — the exact
  expression `getRun` already evaluates at `sqlite-run-store.ts:277`. Then the backfill *memoizes a number the
  detail route already returns*, ARCH-128's 「in either order the row ends identical」 becomes true by
  construction, and no third arithmetic is minted. Using `foldUsageFromRecords(deriveAgentRecords(...))` instead
  would make a run's reported cost **change the moment the backfill runs** — the v26 R-1 shape, again.
  Three more boundaries: the write is a **no-op unless the run is terminal AND `snap?.usage === undefined`
  AND the run's transcript carries at least one `kind: 'usage'` event** (`transcripts.some(e => e.kind === 'usage')`)
  — that third conjunct is what makes D-DES-5's `COALESCE(json_array_length(...), 1)` honest: a `{usage}`-only row
  then always implies ≥ 1 record, so treating its missing `$.agents` as "present" can never resurrect a
  zero-record run;
  it is wrapped in `try/catch` and a failure emits one structured log line and **never fails the list request**
  (a list route must not 500 because a cache write lost a race); and `BACKFILL_PER_TICK = 25` bounds it.
- **UT:** (i) terminal + no `usage` → written, and the written value deep-equals `getRun().usage`;
  (ii) terminal + existing `usage` → **no write** (spy on the store); (iii) non-terminal → no write;
  (iv) an injected store whose `backfillUsage` rejects → `listSummaries()` still resolves with the folded
  values and logs once; (v) idempotence: two consecutive `listSummaries()` calls produce one write.
  Storage is injectable at `RunManagerDeps.store`; the clock is already injected.

**D-DES-7 — INV-V27-1 restated so a test can assert it.**
- **sig:** none; this corrects an invariant.
- **boundary:** as written the invariant is falsifiable. `getRun` returns `usage: snap?.usage ?? foldUsage(...)`
  (`sqlite-run-store.ts:277`) — **always a `RunUsage`**, never absent. ARCH-127 omits `costUSD` for the
  zero-record run. `undefined === 0` is `false`. Corrected:
  > **INV-V27-1:** for every run, **if** `/api/runs[i].costUSD` is present **then** it equals
  > `/api/runs/:id.usage.costUSD` exactly; **if** it is absent **then** `/api/runs/:id.usage` folds over zero
  > agent records (`tokens` all `0`, `costUSD === 0`, `unpricedCalls === 0`).
  The second clause is what makes the absence a *claim* rather than a hole.
- **IT:** the ADR-052 case (one terminally-failed call + one unpriced call) for the equality clause, and a
  run that **completed having made zero `agent()` calls** for the absence clause — *not* a registered-but-never-ran
  workflow, which has no run row and therefore never appears in `/api/runs` at all, so the assertion would be
  vacuous. That same fixture is what proves D-DES-5's `json_array_length(...) > 0` conjunct. Both through the
  HTTP surface, both routes in one test.

### Group C — REQ-140 / ARCH-126/131: lanes, `current`, `record`

**D-DES-8 — `deriveLanes`: `current` must be defined for all seven `RunStatus` members.**
- **sig:** `dashboard.ts` —
  `deriveLanes(phases: PhaseView[], expected: ExpectedGraph | undefined, opts: { masked: boolean }) → { lanes: Array<{index:number;title:string|null}>; current: number | null }`.
  Note `expected` must be typed `| undefined`: `server.ts:519-520` populates it only `if (!authEnabled)`, so the
  parameter is genuinely optional and a non-optional signature would force a fake empty object at the call site.
- **boundary:** `RunStatus` is a **seven**-member union (`types.ts:13`): `queued | running | suspended | stopped |
  completed | failed | interrupted`. ARCH-126 defines `current` only for `running` → `null`. That silently
  blanks the 「目前」 tag for `suspended` and `interrupted` — **the two runs an operator is staring at precisely
  to decide whether to resume**. My rule: `current = last observed phase index` for `running | suspended |
  interrupted`; `null` for `queued` (nothing observed) and for the three terminal states (`stopped | completed |
  failed` — a finished run has no current lane). Empty `phases` → `current: null` in every state.
  Ordinal, never title: `layoutGraph` lays out `col = lane.index + 1` (`dashboard.ts:363`); a title join would
  break on two phases sharing a name, which the v26 ordinal ruling already settled.
- **UT:** a 7×2 table (each status × `phases` empty/non-empty) + `masked: true/false`, pure, no I/O.
  Seven rows of table, one `expect` — this is the cheapest DES in the slice and the one most likely to be
  written as `status === 'running' ? … : null` if nobody writes the table down.

**D-DES-9 — name the agent-detail wire types, or ADR-049's fixture lock is fiction.**
- **sig:** `types.ts` gains
  `export interface AgentLogView extends ResultEnvelope<TranscriptEvent[]> { harness: HarnessDescriptor | null; events: TranscriptEvent[]; hasMore: boolean; record?: AgentRecord }`
  and `export type AgentLogError = AgentLogView & { error: ErrEnvelope }` (or a discriminated pair).
  `mcp-facade.ts:664-666` currently declares an **inline intersection literal** with no name.
- **boundary:** ADR-049 makes `tests/fixtures/dashboard-wire.ts` — a TS fixture `satisfies` the server's own
  route types — the *entire* type safety story for the untyped `.js` client. That lock **cannot be written**
  against an anonymous inline type. Without the name, the agent panel (REQ-135) is the one view with no
  compile-time tie to its wire shape, on the endpoint carrying REQ-136's whole point.
  Second boundary: `record` must be **optional** in the type, because the error branch
  (`mcp-facade.ts:681`) returns without it.
- **UT:** `tsc --noEmit` is the test (the fixture `satisfies AgentLogView`), plus one runtime assertion that the
  fixture's key set equals the live response's key set — otherwise the fixture drifts into decoration.

### Group D — ARCH-123/124/125: the client, and the guards that must see it

**D-DES-10 — `clientCorpus()`: re-point every source-grep, and make an empty corpus RED.**
- **sig:** `tests/helpers/client-corpus.ts` —
  `export function clientCorpus(): string` (concatenation of every `src/dashboard/{lib,ui}/**/*.js`) and
  `export function clientFile(rel: string): string`.
- **boundary — this is the slice's biggest silent failure:** **~41 assertions in 5 files** take `DASHBOARD_HTML`
  (or `buildDashboardHtml(...)`) as their subject and grep it for **client-JS content**. Once ARCH-122 makes that
  string "markup and CSS only", the **negative** ones go vacuous — they pass because the subject is empty:
  | file | assertions on JS content | what goes vacuous |
  |---|---|---|
  | `dashboard-diagram-render.test.ts` | ~20 (`:22-141`) | `not.toContain('innerHTML')` `:106`, `not.toContain('<object')` / `'<embed')` `:94-95`, the mermaid-CDN greps `:69,98`, `renderMiniPreviewAsync` `:47` |
  | `dashboard-page-source.test.ts` | ~11 (`:11-76`) | `not.toContain('a.tokens||0')` `:12`, `not.toContain('if(m.alias)')` `:70` |
  | `dashboard-zoom-source.test.ts` | 4 (`:12-26`) | the `viewBox` / no-absolute-`width=` pins |
  | `workflow-page-harness-table.test.ts` | 2 (`:11-15`) | the harness-table marker |
  | `update-outcome-config-check.test.ts` | 4 (`:16-34`) | `not.toContain('undefined')` `:34` — INV-V27-5's only current proof |
  C1 named **three**. Disposition must be **per assertion**, one of exactly three: **(re-point)** subject becomes
  `clientCorpus()`; **(move)** becomes a `lib/*.js` UT on a real function; **(retire)** deleted with a one-line
  reason and its REQ re-proven in the Chromium tier under its own VAL id (C2's rule).
  **Anti-vacuity is mandatory and cheap:** each re-pointed file gains one **positive** anchor
  (`expect(clientCorpus()).toContain('createObjectURL')`, `toContain('revokeObjectURL')`) plus
  `expect(clientCorpus().length).toBeGreaterThan(5000)`. A negative grep with no positive anchor beside it is,
  in this ledger, a vacuous survivor (adjudication (v23) #4 named that exact class).
- **UT:** the corpus helper itself gets one test — a deliberately empty directory makes it throw, not return `''`.

**D-DES-11 — the `lib/` surface: six more exports, and the rule that stops a seventh.**
- **sig:** ARCH-124 names five files (`theme` `strings` `connection` `swimlane` `runlist`) tracing REQ-131..134.
  REQ-135/137/138/142/143 have no pure home, so their logic lands in `ui/*` where **no UT can reach it**
  (ADR-049 refuses jsdom). The rule I propose, stated once: **an export earns its place iff `ui/*` would
  otherwise contain a branch or an arithmetic.** Formatting a string is a branch. Appending a child is not.
  By that rule exactly six more exports are earned:
  | export | file | why `ui/*` would otherwise branch |
  |---|---|---|
  | `panelSide(nodeCenterX, graphWidth) → 'left' \| 'right'` | `swimlane.js` | REQ-135's slide direction is a comparison, and 「右半」 at exactly `width/2` is a boundary somebody must pick |
  | `pollDecision(prev, {visible, now, lastTickAt}) → {fetch: boolean; nextDelayMs: number}` | `connection.js` | REQ-142 is 3 branches (hidden→skip, hidden→visible→immediate, steady 3 s) — the only REQ-142 logic a UT can ever see |
  | `sourceTag(state, demo) → {key: 'live'\|'offline'\|'demo'\|'checking'; tone}` | `connection.js` | REQ-143's 「不得與 Live 同時出現」 is a **mutual exclusion** — one function, one UT, or it is three render sites agreeing |
  | `statCards(record, harness) → Array<{key, value, sub?}>` | new `agent.js` | REQ-135's six cards incl. 逾時 rendered twice (`15m 0s` **and** `900,000 ms`) and four token columns |
  | `eventRow(ev) → {time, kindKey, tone, text, mono: boolean}` | new `agent.js` | REQ-135 maps 4 event kinds → 4 tones and picks the mono font for 3 of them |
  | `barPct(value, total) → number` / `sortRows` reuse | `runlist.js` | REQ-137/138's bars and the `—`-sorts-last rule (already in `sortRows`) |
  **Karpathy check:** I add exactly **one** new lib file (`agent.js`), not five. `models`/`system` reuse
  `runlist.sortRows` and `barPct`; nothing else in those tabs is a decision.
- **boundary:** every one of these is **pure and total** — no `Date.now()` inside (`now` is a parameter, which is
  how `pollDecision` stays clock-injectable in a file that cannot import the engine's `clock.ts`), no `document`,
  no `fetch`, no import outside `lib/`.
- **UT:** one `.js` test file per lib file; `pollDecision` gets the three-branch table plus the
  「切回立即輪詢一次」 case that REQ-142's acceptance names.

**D-DES-12 — `STATIC_ASSETS` is a CLOSED literal, so its key list is a design decision, not a detail.**
- **sig:** ARCH-123's literal array must enumerate, in this slice: `ui/{app,theme-init,poll,home,workflow,run,agent-panel}.js`
  **plus** `ui/{models,system,issues}.js` (see §4.1), `lib/{theme,strings,connection,swimlane,runlist,agent}.js`,
  `dashboard.css`, and the five woff2. **`lookupStaticAsset` must be exact `Map.get` and nothing else** — no
  `join`, no `normalize`, no decode.
- **boundary:** (1) a key present in the map whose **file is missing at boot** → log `dashboard_asset_missing`
  **once** and 404 thereafter; a missing woff2 degrades to the CSS fallback stack, never a blank page, never a
  boot failure. (2) An unknown key → 404 with no body echo of the key (an echoed key is a reflected-content
  surface for free). (3) The `/static/` arm must be registered **before** the `/dashboard` catch-all
  (`server.ts:1251`), or every asset returns the HTML page with a 200 and the browser silently renders nothing.
  (4) Method: GET only; anything else 405.
- **UT:** (i) every key in the literal resolves to an existing file **at test time** (this is the test that
  catches a typo'd key in review, and it is one `readdirSync` diff); (ii) a traversal table —
  `../../etc/passwd`, `%2e%2e%2f`, `ui/../lib/theme.js`, `ui/app.js%00.png`, `//etc/passwd` — every one → `null`;
  (iii) `no-store` on js/css and `immutable` on woff2, asserted by extension; (iv) route-order test: a request
  for a known key returns `text/javascript`, not `text/html`.

**D-DES-13 — the three enabling edits are TASK-1, and a test proves they landed first.**
- **sig:** `vitest.config.ts:7` `include: ['tests/**/*.test.{ts,js}']`;
  `no-skeleton-surface.test.ts:55-61` `listTsFiles` → also `.js`;
  `no-retired-surface.test.ts:23-29` `walk` → also `.js` (its comment-stripper at `:20` is regex-based and works
  unchanged on `.js`).
- **boundary:** ordering is the boundary. If any `lib/*.js` test lands before the `include` change, **it never
  runs** and its absence is indistinguishable from a pass. If any `src/dashboard/**/*.js` lands before the
  walkers change, the C3 guard is blind to the served bytes and the delivery's `skeleton:` i18n key
  (C3, `rwe-data.js`) ships green. The six-file allowlist is **not** widened; no `src/dashboard/**` file may
  contain the word at all.
- **UT:** one meta-test — `listTsFiles(SRC_ROOT)`/`walk(SRC_ROOT)` returns at least one path ending `.js`, and
  a deliberately-planted fixture `.js` containing the forbidden word makes the guard **red**. Without the
  planted-violation half, "the walker was widened" is itself an unproven claim.

**D-DES-14 — the browser tier must be able to FAIL, not only skip.**
- **sig:** `val-193:45` (and every sibling) computes `const reason = chrome ? null : 'SKIPPED: no puppeteer Chrome found'`.
  Add: `if (!chrome && process.env.RWE_REQUIRE_BROWSER === '1') throw new Error('browser tier required but no Chrome found')`.
- **boundary:** ADR-049 removes jsdom, so **every** `ui/*` behaviour, the C1 `mousedown`/`draggable` pins, C2's
  anchors and the whole 「99% 相似」 proof live on a tier that **skips silently** without Chrome. A skipped tier
  and a passing tier are the same colour in CI. This is three lines and it is the difference between "Gate 7.5
  verified the rebuild" and "Gate 7.5 did not notice it could not".
- **UT:** none needed; Gate 7.5's runbook sets the variable and DEPLOY/README record it.

### Group E — ADR-054: the disclosure key-set test, keyed properly

**D-DES-15 — one key set per (endpoint × outcome), not per endpoint.**
- **sig:** `tests/integration/dashboard-disclosure.test.ts` — a table
  `Array<{route, outcome: 'ok'|'error'|'degraded', keys: string[]}>` asserted with **exact set equality**.
- **boundary:** ARCH-131's 「one facade call, two transports, same delta」 is **false on the error path** and the
  test must say so: the MCP surface returns `{runId,status,error,harness:null,events:[],hasMore:false}`
  (`mcp-facade.ts:681`) while the HTTP route maps it to `{error: string}` with a 404 (`server.ts:565-568`).
  Three further shape dimensions the table must carry or it is wrong rather than strict:
  (1) `ResultEnvelope.principal?` is present only under auth with an attributed run (`types.ts:73`);
  (2) `ResultEnvelope.meta?` rides `run_result` only (`types.ts:77`);
  (3) the degraded 200 (`server.ts:582-585`, `:1067-1071`) is a **third** shape, `{degraded: string}`.
  And the assertion's **shape** may not be relaxed: set-equality that fails on additions is the whole mechanism;
  editing the expected list when a field is added deliberately is the intended cost.
- **IT:** one file, one table, plus REQ-136's three-conjunct oracle (D-DES-3) asserted against the **bodies**
  returned in that same table — so the disclosure test and the confidentiality test cannot drift apart.

---

## 3. Where my own three lenses conflict — and how Karpathy breaks the tie

### C-1 — REQ-136's strip: whose string is the truth?
- **Interface-contract** wants `descriptor.prompt` to stay **derived from what the gateway echoed**, because the
  descriptor's documented meaning is "the record of what was actually dispatched" (`types.ts:475`, and
  `agent-executor.ts:630-633` explicitly refuses to overwrite the gateway's `model`/`provider` for that reason).
- **Testability** wants the executor to compute a `visiblePrompt` itself and assign it — deterministic, no
  dependence on gateway behaviour, trivially unit-testable with a stub gateway.
- **Boundary** wants fail-closed on a prefix mismatch — but fail-closed means `prompt: ''`, which **starves
  REQ-135's panel** (the panel's whole reason to exist) and would break `val-082:138-140`'s non-empty assertion.
- **Resolution (Karpathy):** the **prefix-verified slice with fail-closed** (D-DES-1 case 4). It keeps the
  interface-contract meaning (still the gateway's string), it is three lines rather than a parallel
  prompt-composition path, and its testability cost is one stub-gateway UT. I verified the belt-and-braces
  question the advisor raised: **both** gateways today set `prompt: req.prompt` verbatim
  (`gateway/client.ts:501`, `claude-agent-sdk-client.ts:691`), so case (4) is **unreachable in v27** — which is
  exactly why it must be written now, with a log line, rather than after a third transport makes it reachable.
  The starvation risk is real and bounded: it can only fire in a state where we do not know what we are holding.

### C-2 — the `lib/` surface: testability wants more exports, contract and Karpathy want fewer
- **Testability** would push *every* `ui/*` decision into `lib/` — ADR-049 left `ui/*` with **no UT tier at all**,
  so an unexported branch is an untested branch, permanently.
- **Interface-contract** answers that every export is one more `STATIC_ASSETS` key (D-DES-12), one more fixture
  pin, and one more thing two files must agree about.
- **Karpathy** answers "minimum design", which naively means "don't add lib files".
- **Resolution:** the **rule**, not a count: *an export earns its place iff `ui/*` would otherwise contain a
  branch or an arithmetic*. Under that rule I add **one** file (`agent.js`) and six exports (D-DES-11) and
  refuse the rest. The rule is the deliverable — a count would be re-argued every iteration; a rule is applied.

### C-3 — ADR-054's key-set test: strict, or correct?
- **Interface-contract** wants one key set per endpoint (that is what ADR-054 says), because one list per route
  is the simplest thing that fails on an accidental addition.
- **Boundary** proves one list per route is **wrong**: the same endpoint has three shapes (ok / facade-error /
  HTTP-mapped `{error}`), plus two conditional keys (`principal?`, `meta?`) and a degraded shape.
- **Testability** observes that the fix is free — three rows instead of one, same assertion.
- **Resolution:** key it **per (endpoint × outcome)** (D-DES-15). Simpler is not the same as shorter: a
  single-list test would be relaxed the first time a 404 hit it, and a relaxed set-equality is the failure mode
  ADR-054 exists to prevent. This is the one place I make ADR-054 *bigger*, and it costs two table rows.

### C-4 — INV-V27-1: the invariant I cannot implement
- **Interface-contract** reads ARCH-127 and sees four optional fields, omitted together. Correct.
- **Boundary** reads `sqlite-run-store.ts:277` and sees `usage` is **never** absent on the detail route. Also correct.
- The two are **jointly unsatisfiable** with a bare `===`. This is not a re-litigation of ADR-052 (I accept
  "one accessor, no list bound, no aggregate" entirely) — it is that the invariant's *sentence* is false.
- **Resolution:** restate it as **present ⇒ equal; absent ⇒ the detail fold is over zero records** (D-DES-7),
  and write both clauses as assertions. The alternative — making `/api/runs/:id.usage` absent for a
  zero-record run — would change a v26 contract (`types.ts:355` says `usage` is absent *only* for a pre-field
  row, "never re-derived as 0") for the benefit of one test sentence. Refused on simplicity grounds.

### C-5 — the backfill: a write on a read path
- **Interface-contract** wants `backfillUsage` narrow and typed (`RunUsage` in, `void` out) — fine.
- **Testability** wants it deterministic and injectable — fine, the store is already a dependency.
- **Boundary** raises two things neither of the others sees: (i) **which fold** feeds it, and (ii) a list route
  that now performs up to 25 writes can **fail for a reason that has nothing to do with listing**.
- **Resolution:** feed it `foldUsage(transcripts)` — the expression `getRun` already uses — so it memoizes
  rather than re-derives (this is also the *simplest*: no `deriveAgentRecords` walk); and wrap it so a write
  failure logs once and is swallowed. A list that 500s because a cache write raced is a worse bug than a
  summary that renders `—` for another tick.

---

## 4. Task-splitting — two findings that belong to the synthesizer, not to me

### 4.1 The dispatched closure cannot ship on its own (interface-contract)
ARCH-122's `api:` line says `DASHBOARD_HTML` 「now holds **markup and CSS only**」 and INV-V27-3 says the page
contains **no executable inline script**. The single `<script>` at `dashboard-page.ts:241` is what renders:
- **Models** — `renderModels`, `.models-table` (`:410-415`) → REQ-078
- **System** — `renderSystem`, `#system-panel` (`:390-394`) → REQ-076/077
- **Issues** — `renderIssueList` / `loadIssues` (`:643-676`) → REQ-067, and REQ-139 says REQ-067 的行為**不得回歸**

No ARCH row rehomes them; `STATIC_ASSETS`'s literal key list (ARCH-123) has no `ui/models.js`, `ui/system.js`
or `ui/issues.js`; ARCH-125's file list has no view module for them. So the closure as scoped **deletes three
shipped surfaces**. Two exits, both legitimate, and I deliberately do not pick:

- **(a) Port, don't redesign.** Three DES rows — `ui/models.js`, `ui/system.js`, `ui/issues.js` — that are a
  **mechanical move** of the existing functions into modules, re-themed by inheriting the new tokens and
  component classes, with **no** new sorting/filtering/slide-in (those are REQ-137/138's content, still out of
  closure). Cost: three files, three map keys, ~zero new logic; REQ-067/076/077/078 keep their current
  acceptance and their current tests, re-pointed at `clientCorpus()` per D-DES-10. Risk: three tabs briefly
  look v27-themed but behave v12, which REQ-139 explicitly blesses for Issues and nobody has blessed for the
  other two.
- **(b) Escalate to widen the closure** to REQ-137/138/139 and design them properly here. Cost: the slice grows
  by roughly the Models tab's sort/filter/slide-in and the System tab's cards/bars/process table — real work,
  and it re-opens Gate 2 for three ARCH rows. Benefit: no interim regression and no second pass over the same
  three files.

**My recommendation is (a) with (b) escalated in the same breath**, because (a) is reversible and (b) is not
the design stage's call to make unilaterally. What is *not* acceptable is the third option nobody will write
down: shipping the shell and leaving three tabs blank.

### 4.2 Task ORDER (testability)
Three edits are not "chores", they are **TASK-1**, and the tasks file must say so: `vitest.config.ts`'s
`include`, and the two `.js`-blind walkers. Every `.js` test authored before the `include` change is a test
that **does not run**; every `src/dashboard/**/*.js` landed before the walker change is bytes **no guard sees**.
Both failure modes are green. D-DES-13's planted-violation meta-test is what proves the order was honoured
after the fact.

Secondary ordering note: D-DES-9's named wire types must land **before** `tests/fixtures/dashboard-wire.ts`,
or the fixture gets written against the anonymous shape and the `satisfies` lock is skipped "for now".

---

## 5. Risks

- **R-1 (high, testability) — the vacuous-green.** ~41 assertions lose their subject; the negatives pass
  silently. If D-DES-10's disposition table is not written per-assertion, the most likely outcome is that
  someone deletes the reds and keeps the greens, and the repo ends the slice with an XSS guard and two
  CDN guards that assert nothing. Mitigation: the table + a positive anchor per file + a corpus-size floor.
- **R-2 (high, boundary) — the fold triples.** `foldUsage`, `foldUsageFromRecords`, and whatever the backfill
  does. v26 R-1 is this exact defect and cost an iteration. Mitigation: D-DES-6 names the expression, and
  the IT deep-equals the backfilled value against `getRun().usage`.
- **R-3 (medium, contract) — the 4 KB cap now cuts a different string.** `capPrompt` (2048 head + 2048 tail)
  runs after the strip, so the visible window **moves** for every agent with a system prompt. Any test or
  operator habit anchored on 「the first 2048 chars of the prompt」 changes meaning silently. Not a defect —
  but it must be stated, and `val-104:79-81`'s marker-ordering fixture should be re-checked against a
  system-prompt-bearing agentType, not only a bare one.
- **R-4 (medium, contract) — cross-repo.** `run_agent_log().harness.prompt` is a **breaking** change for the
  `rwe-mcp` plugin client (separate repo, no ledger). ARCH's contract table already flags "one Gate 5 read +
  one release-note line"; the design must give it a **task id**, or it is a sentence nobody owns.
- **R-5 (medium, boundary) — `?limit=500` doubles an already-doubled payload.** `runAgentLog` returns
  `result: window` **and** `events: window` — the same array twice (`mcp-facade.ts:699`). ARCH-125 proposes
  raising the window from 50 to 500. At 2 KB/row that is ~2 MB of which half is redundant, on a 3-second
  poller. **Flag, do not fix** (ADR-056's own discipline): `result` predates v27 and removing it is a second
  breaking change on the same endpoint in the same slice. Record it as v28 debt with the number attached.
- **R-6 (medium, scope) — the JOIN lands on four callers, not two.** ARCH-128 changes `store.listRuns()` itself,
  so besides `/api/runs` (`server.ts:387`) and `/api/home` (`:363`) it also hits boot recovery (`:773`,
  which then N+1s `getRun` per run) and the GC sweep (`:975`), neither of which wants usage. Not a redesign —
  a measured note for ADR-052's Gate 7.5 N=1000 measurement, which should sample **boot** as well as the two routes.
- **R-7 (low, boundary) — `current` for `suspended`/`interrupted`.** D-DES-8. If ARCH-126's sentence is
  implemented literally, the 「目前」 tag vanishes on exactly the runs REQ-135's 即時介入 half is about.
- **R-8 (low, contract) — ADR-051's pending owner decision is a *design* fork, not just a product one.**
  `deriveLanes(..., {masked})` and `describe.phases[].agents` must be written so the ruling changes **one call
  site and zero arithmetic**. My `masked` boundary: when `true`, lanes = observed only, and `agents` is
  **absent** (not `[]` — an empty array reads as "this lane has no agents", which is a lie).

---

## 6. Expected disagreements with the quality-dimensions design lens

1. **They will want a telemetry/observer hook on `connection.js` state transitions** (observability: an
   operator should be able to see the offline flaps). **I refuse in this slice.** `connection.js` is specified
   as a pure function precisely so REQ-142/143 can attach to it later without a rewrite; an observer callback
   makes it stateful-by-interface and untestable-as-a-table. The server-side half already exists in ARCH-130's
   `dashboard_api_degraded` log line, which is where a flap belongs — on the engine, not in a browser tab.
   *Concession available:* `nextConnection` may return `{state, changed: boolean}`; that is data, not a hook.
2. **They will re-propose a `dashboard-disclosure.ts` projection module** (replaceability/self-sustainability:
   one place that knows what may leave). ADR-054 already refused it and I **hold the line** — the key-set test
   delivers the identical property for zero production code, and the payloads are already built by pure
   projections. *But* I expect them to be right about something adjacent: the projection they actually want is
   **named types** (D-DES-9), which costs nothing and gives `tsc` the same job.
3. **They will want a richer demo dataset** (consumability: REQ-143's 「我要看有缺什麼」). I will argue the
   opposite from testability: the demo dataset is the one thing in v27 that can make **every** screenshot and
   **every** computed-style assertion pass without the engine working at all. Whatever it becomes, `sourceTag`
   must make demo and live **mutually exclusive by construction** (D-DES-11) and the Chromium evidence
   screenshots must be taken against the **real** engine, with the demo path exercised in a separate, labelled
   pair. Otherwise Gate 7.5 proves the delivery renders, not that the engine does.
4. **They will likely want `systemPrompt` to carry a hash** (replaceability: correlate a record with the
   `agents/<type>.md` that produced it). I would accept `sha256`-prefix **only** if someone names the reader.
   `{agentType, bytes}` already distinguishes 「未套用」 from 「套用了但不顯示」, which is the operator question
   ADR-050 identified. A hash with no reader is the flexibility Karpathy's rule exists to refuse.
5. **Probable agreement, worth recording:** both lenses will independently demand that the `.js` guards widen
   (D-DES-13) and that the never-run view's wording avoid the forbidden word. If they also land on the
   closure-not-shippable finding (§4.1), that is convergence and the synthesizer should treat it as settled.

---

## 7. Evidence index — what I actually read

| Claim | Anchor |
|---|---|
| the one inline `<script>`; Models/System/Issues render there | `src/dashboard-page.ts:241`, `:390-394`, `:410-415`, `:643-676` |
| `composePrompt` filters `undefined` only, joins `\n\n`, frames `appendPrompt` | `src/params/resolve.ts:175-186` |
| the composition call; `agentType` resolution; the attempt loop; the ONE decoration site | `src/agent-executor.ts:543-545`, `:577`, `:596-616`, `:617`, `:645-681` |
| both gateways set `prompt: req.prompt` verbatim | `src/gateway/client.ts:493-508`, `src/gateway/claude-agent-sdk-client.ts:681-700` |
| `runAgentLog`'s **anonymous** return type; the error branch; `result` duplicates `events` | `src/mcp-facade.ts:664-666`, `:681`, `:699` |
| the dashboard agent route IS the MCP call (synthetic principal) | `src/server.ts:563` |
| `usage` is **never** absent on the detail route | `src/store/sqlite-run-store.ts:270-283` (`:277`) |
| the two folds | `src/run-guard.ts:47-72`, `src/run-manager.ts:242-260` |
| live overlay; `saveSnapshot` fires only at the terminal transition | `src/run-manager.ts:830-838`, `:1014` |
| four `store.listRuns()` callers | `src/server.ts:363`, `:387`, `:773`, `:975` |
| `RunSummary` has no cost field; `RunStatus` is 7 members; `ResultEnvelope`'s optional keys | `src/types.ts:358-369`, `:13`, `:66-78` |
| `expectedGraph` populated only `if (!authEnabled)`; `col = lane.index + 1` | `src/server.ts:519-520`, `src/dashboard.ts:363` |
| vitest include is `.ts`-only | `vitest.config.ts:7` |
| both guard walkers are `.ts`-blind; the six-file allowlist | `tests/unit/no-skeleton-surface.test.ts:53-61`, `tests/unit/no-retired-surface.test.ts:23-29` |
| the ~41 `DASHBOARD_HTML` source-greps | `tests/unit/dashboard-diagram-render.test.ts:21-141`, `dashboard-page-source.test.ts:11-76`, `dashboard-zoom-source.test.ts:12-26`, `workflow-page-harness-table.test.ts:11-15`, `update-outcome-config-check.test.ts:16-34` |
| puppeteer is the driver and the tier SKIPS without Chrome; C2 anchors | `tests/acceptance/val-193-dag-fit-and-columns.test.ts:28-45`, `:105-141`, `:155-184` |
| the pinned `/api/runs/:id/dag` shape the delta must stay compatible with | `tests/integration/dashboard-http.test.ts:140-160` |
| v27 architecture: scope paragraph, ARCH-122..131, ADR-049..056, INV-V27-1..8 | `02-architecture.md:3312-3661` |
| v27 requirements: REQ-131..143, C1–C4, D1–D4 | `01-requirements.md:1583-1873` |
| the closure excludes REQ-137/138/139/142/143 | `state.yaml` `gates.architecture.note`; `02-architecture.md:3317` |
