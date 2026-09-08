# Design panel — adversarial group (Interface-contract × Boundary/error × Testability), round 2 — v26

**Read this round:** `quality-dimensions.r1.md` (2026-09-08 — O-9..O-14, R-8..R-11, C-8..C-12, S-9..S-12, the eight
task-splitting obligations, QD-R1..R9), my own `adversarial.r1.md`, and commit `eaf6546` — the two owner rulings that landed
AFTER r1 was written. **Every QD claim answered below was re-verified on HEAD before the verdict** (file:line in the table).
**For the synthesizer:** the `adversarial.r2.md` / `quality-dimensions.r2.md` dated 2026-09-05 were v25's design round, not
this one; this file replaces the former. A v26 QD r2, if written, carries today's date.

**What changed since r1 — two rulings, DECIDED 2026-09-08 (`eaf6546`):**
- **ADR-038 overruled.** No `PRICE_UNKNOWN`. An unpriced model is charged `costUSD: 0`; the agent record carries
  `unpriced: true`; `meta.unpricedCalls` counts; the price book can be adjusted later. → **DES-180 is withdrawn**; DES-179's
  `costUSD` is `number`, never `null`; every `PRICE_UNKNOWN` literal in DES-184/186 and the real-tier table goes.
- **ADR-047 (b).** Trigger-started runs carry no budget. AND the owner's standing principle now binds every budget-adjacent
  row: *a budget is optional (absent = unbounded); tracking, recording and later query of every run's spend are never
  optional.* → DES-185 collapses to the ledger amendment; the usage fold is **unconditional** — QD's O-11/S-9 stop being a
  lens preference and become the ruling's acceptance criterion.

---

## Summary

**Converged:** 17 of QD's 19 numbered items and 7 of 8 obligations are conceded or were already in r1. Most concessions are
verified holes on ONE seam my r1 did not walk end-to-end — the restart-reconstruction path (`deriveAgentRecords`,
`markRefused`, the nested `SandboxHost`) — and they collapse into one new item, **DES-187**, plus amendments to DES-175/179/
183. The two rulings delete one DES and reshape three. **Still open, all small:** S-10's fourth `source` word (rebut), O-12's
read-time-only counter (hold: two producers, one rule, one three-leg IT), and O-13's nullable cost (settled by the owner, not
by a lens — recorded so nobody re-argues it at Gate 8).

---

## Responses to quality-dimensions r1 — verdict, engineering reason, where it lands

| QD item | verdict | reason (verified on HEAD) | lands in |
|---|---|---|---|
| **O-9** `deriveAgentRecords` is a hand-written whitelist; ARCH-114's `buildRecordsFromTranscript` does not exist | **CONCEDE** | `run-store.ts:24-66`: three object literals emit `{agentId,state,provider,model,tokens,label}` and drop `startedAt`/`endedAt`/`frame`/`phase`/`lastActivityAt` today; the failed branch fabricates `model:''`. `grep -rn buildRecordsFromTranscript src tests` → nothing. r1 DES-175 touched two branches for `phase` only and would have left `costUSD`/`transport`/`detail` write-only on this path. | DES-187 (new) |
| **O-10** `markRefused` never journals; a `refused` record dies with the process | **CONCEDE — journal it** | `agent-executor.ts:222-228` writes `_records` only; `saveSnapshot` fires at terminal only (`run-manager.ts:885`); the derive path omits an agent with neither event. One `kind:'refused'` transcript event (~8 lines + one derive branch) against a permanent hole in v25's REQ-120 guarantee — the write wins my simplicity tie-break, because the alternative ("cohort caveat in three ledger places") is a silent drop with a sentence on it, which INV-V26-6 forbids. Replay is untouched: `ResumeCache.build(entry.journal, …)` (`run-manager.ts:653`) reads the JOURNAL, not transcripts. | DES-187 |
| **O-11** `run_result.meta` does not exist; fold at read; `outputSchema`; the budget gate must not be inherited | **CONCEDE** (r1 item 6 already had `meta`; sharpened) | `types.ts:66` verified. The fold at `run-manager.ts:840-844` is gated on `spec.budget` — deleted, the fold runs for every resumed run (ruling). `outputSchema`: `run_result` uses the shared generic `OUT` (`tool-specs.ts:419`); specialising it for one tool is a fourth byte-baseline re-pin row for one sentence's worth of discoverability — the declaration goes in the tool DESCRIPTION plus the REQ-118 fixture (`v26-tool-surface`), which is what the cold model and the drift test both read. | DES-179 / DES-186 |
| **O-12** counters die with the process; derive `unpricedCalls` from the stored field | **CONCEDE persistence; HOLD two producers** | r1 DES-176 already puts `unmapped` on the usage EVENT (persisted) — I state now that the event, not `GatewayResult`, is the reader's source. One rule — *`unpriced === true` on a `done` usage event* — applied by the guard live and by `foldUsage` at rest, locked by the equality IT. Why not read-time only: `status()` → `_mergeLive` (`run-manager.ts:675/730`) overlays IN-PROCESS records for a live run; a `usage` folded from transcripts beside them would disagree by exactly one capture write. | DES-179 |
| **O-13** the two dashboard readers; three-valued cost | **CONCEDE readers; REBUT nullable cost** | `dashboard.ts:56` flattens `input+output`; `dashboard-page.ts:359` is `(a.tokens\|\|0)+' tok'` — both verified, both named in DES-183 with a RENDERED assertion. The `0`-vs-`null` distinction is now carried by `unpriced: true` (owner ruling); the renderer prints `$0.0000 (unpriced)`. | DES-183 |
| **O-14** nested `phase()` is silently dropped | **CONCEDE the finding; choose (b′), not (a)** | `run-manager.ts:1011` nested host passes neither `onPhase` nor `onBudgetSnapshot` — verified. But (a) is not one line: DES-175's `currentPhase` reads the PARENT timeline, so `phase('A'); await workflow('sub' /* calls phase('B') */); agent('x')` would stamp `x` with `B` → appended lane WITH a warning on a legal parent script. (b′): the nested host's `onPhase` pushes the title onto that frame's own `WorkflowNodeView.phases[]` (persisted in the snapshot, rendered on the existing sub-card) — named, with a reader, no lane, no parent pollution. QD's "registration-time warning" is not implementable: nesting is a runtime fact of the CALLER, not a property of the nested workflow's registration — said here so it is not left hanging. | DES-175 |
| **R-8** `maxPricePerMOf` parses the display string | **CONCEDE** | `model-catalog.ts:250-260`: `/\$([0-9.]+)\/1M/` over `price.in/out`. Re-pointed at `FourRates`; the scalar is `max(in,out)` per M; cache rates do not enter `costLevel` (stated in the doc comment, as QD asks). | DES-177 |
| **R-9** `toolUse` is a filter too; extend the description | converged (r1 item 10) | — | DES-178 |
| **R-10** a grep proves absence, not totality | **CONCEDE — one file** | I was going to argue "`never` arms + `satisfies` are the totality test". They are — at BUILD time; `npm test` is `vitest run` and `tsc --noEmit` is `build`, so vitest never sees a `never`. One `providers-totality.test.ts` iterating `PROVIDERS` over the enumerated sites is cheaper than the argument. Not per-site files. | DES-172 |
| **R-11** say "why no `openai` row" to the caller | **CONCEDE** | one sentence in the alias table | DES-184 |
| **C-8** `budget.total === null` is the `Infinity` class | **CONCEDE, with dedup** | `child-entry.ts:97-100` verified. `limits: {usd, tokens}` is the named reader; `total` stays as the alias ADR-037 already fixes as USD; r1's `tokens().limit` is DROPPED (a duplicate of `limits.tokens`) and `tokens().total` is renamed `sum` (a `total` inside `tokens()` beside a USD `total` is a naming collision). | DES-179 |
| **C-9** the IPC budget wire is three fields; nested host has no `onBudgetSnapshot` | **CONCEDE** | `host.ts:52/103/109`, `run-manager.ts:1023` verified. Both hosts get the same closure; the callback returns `{usd, tokens}`. | DES-175 / DES-179 |
| **C-10** one constant behind description + hint; hold `required:['path']`; `errors[]` needs no change | **CONCEDE all three** | A missing `path` has no REQ-121-specific hint, so ajv's generic refusal loses nothing there and the schema stays truthful about the one unconditional key. `SEED_ITEM_HINT` rendered into both. `run_start.errors[]` (`tool-specs.ts:394`) already lists both codes — the v24 `Errors:` line was advertising a refusal the path never gave; ARCH-110's `see:` is the whole delta. | DES-170 |
| **C-11** a migration paragraph; `budget: <number>` answered ahead of ajv | **CONCEDE** | `call-tool.ts:94-100` precedent verified. No new code: `INVALID_ARGUMENT` with a message that names the old meaning and the new shape, `detail.migration`. Three release-note lines. | DES-179 |
| **C-12** mark conditional surfaces conditional | **MOOT** | both rulings landed; no gated task remains | — |
| **S-9** reuse `modelsToCheck`; same row read at resume; pre-v26 row has no pin | **CONCEDE** | `run-manager.ts:498/834` verified. `reachableModels(params)` is the one derivation both the alias check and the pin use. Pre-v26 row → `priceBook: undefined` → every call `{costUSD:0, unpriced:true}`, never re-priced. | DES-177 |
| **S-10** a fourth `price_book.source` value for "never fetched" | **REBUT** | `fetchedAt === null` already ⇔ never fetched; `'last-good'` with an old `fetchedAt` ⇔ stale. With the refusal gone, no decision reads `source`; a fourth word encodes a state two existing fields already express. If QD holds, it costs one string and one test row — I would not block on it. | — |
| **S-11** `configCheck` has four moving parts | **CONCEDE** | `rwe-update.sh:39-60` fixed four-key `printf`; `dashboard-page.ts:57-65` verified. One task; `skipped` rendered explicitly because it is the silent outcome. | DES-172 |
| **S-12** claim ARCH-111 as the liveness answer | **CONCEDE** | one paragraph | DES-171 |
| **Obligations 1–8** | 1 concede (merge) · 2 concede (the two untyped dashboard sites become named sub-bullets; every other four-column site is typed and the build gate catches it) · 3 concede · 4 concede · 5 concede (matches r1) · 6 concede (matches r1 ordering) · 7 moot · 8 concede (scheduled FIRST) | | §Task partition |

---

## Self-corrections forced by the rulings

- **DES-180 withdrawn entirely:** `priceVerdict`, the `PRICE_UNKNOWN` catalog row, its `run_start.errors[]` entry, the guide
  sentence, `price-verdict.test.ts`, and the refusing half of `run-start-price-unknown.test.ts`. The ADMITTED half survives,
  renamed `tests/integration/run-start-unpriced-model.test.ts`: an injected catalog lacking one openrouter row → `run_start`
  admitted → the call lands `costUSD: 0`, `unpriced: true`, `run_status.usage.unpricedCalls === 1`, and the run page renders the
  counter. That IS the ruling's acceptance and the ADR-046 named-reader assertion.
- **The boundary hole the ruling opens — stated, not discovered:** a USD-only budget can never stop an unpriced model (its calls
  add $0 forever). Three places must say so or T4 fires on the one field REQ-127 is about: the `run_start.budget.usd` schema
  description (*"an unpriced model adds 0 to this limit — pair with `tokens` if the run can reach one"*), the guide's budget
  section, and the doc comment on `AgentRecord.unpriced`. `tool-specs.test.ts` asserts the description literal.
- **DES-179:** `costUSD: number` on every `done` record; `unpriced?: true` (present only when true — the conditional-spread
  convention every other optional record field uses); `priceCall(tokens, rates | null): { costUSD: number; unpriced: boolean }`;
  `RunUsage.unpricedCalls` = the count of `done` usage events with `unpriced: true`; `foldUsage`: a pre-v26 two-column event →
  `cacheRead = cacheWrite = 0`, `costUSD 0`, `unpriced` (+1). A `failed` call has no usage and no `unpriced`.
- **DES-185 → "the D-V2h ledger amendment":** docs only — `04-design.md:814-815/:832/:1156` and the overlap accepted risk say
  *"no such control exists; unattended runs have no spend ceiling; every run's spend is recorded and queryable
  (DES-179/DES-187)"*. No code, no tests beyond the review-checklist grep. Scheduled first.
- **DES-184:** `PRICE_UNKNOWN` out of the guide/catalog assertions; the budget section carries the owner's principle in the
  guide's own words: *"A budget is optional; absent means unbounded. Every run's spend is recorded and queryable regardless of
  budget or how the run was started — `run_status.usage`, `run_result.meta.usage`, the run page."* `error-catalog-closed`'s
  emitter list is `validateSeedSpec` + `RULE_CODE` (two, not three).
- **DES-186:** `EXPECTED_AGENT_RECORD_KEYS` gains `unpriced`; `EXPECTED_RUN_USAGE_KEYS = ['tokens','costUSD','unpricedCalls',
  'unmappedMessages']`; `run_result` envelope keys unchanged (`meta` was already listed).
- **DES-177:** mechanics unchanged — `lookup` still answers `price: null` for an unlisted model (the BOOK reports what it knows;
  the PRICING charges 0 and flags — two facts, two fields, no conflation).
- **Real-tier table, REQ-127 row:** a real run on an alias whose model the catalog does not list → `costUSD: 0`,
  `unpriced: true`, `meta.unpricedCalls === 1`, rendered; PLUS a trigger-started (`once`) run with no budget → `run_status.usage`
  non-zero after completion (the ruling's "however started" clause, observed).

---

## Amendments by DES id (r1 stands wherever a DES is not named here)

### DES-170 (seed validator) — amended
`required: ['path']` on both item schemas (only `path`; `contentB64`/`sha256` stay validator-decided so `INVALID_SEED_SPEC` is
reachable). `export const SEED_ITEM_HINT` in `workspace-seed.ts` is interpolated into `TOOL_SPECS.run_start`'s `contentB64`
description AND returned as the validator's `hint`; `tool-specs.test.ts` asserts the description contains the constant,
`workspace-seed-spec.test.ts` asserts the refusal does. `run_start.errors[]` is NOT touched (both codes already listed).

### DES-171 (terminal provider errors) — amended
Boundary gains the liveness paragraph: this is the REACTIVE tool-liveness answer — `classifyApiError` recognises *cannot
succeed*, the `finally` abort ends the CLI's own retries, and the RunGuard slot plus host semaphore are released in seconds
rather than `timeoutMs × (1 + retries)`; on a 24-wide `parallel()` that is a degraded run versus a dead host. The PROACTIVE
probe (#73) is deferred by owner ruling and attaches to `declaredSource`/`catalogFetchedAt`; Gate 7.5's `ps` is the evidence
that the subprocess is gone.

### DES-172 (`providers.ts`, `--check-config`) — amended
(i) **`configCheck` is four parts in ONE task:** `write_result` gains a fifth key `"configCheck":"passed|skipped|failed"`
(absent on results written by older updaters); `UpdateOutcome.configCheck?: 'passed'|'skipped'|'failed'`; the ingestion at
`server.ts:157`/`main.ts:217` passes it through untouched; the header banner renders it, `skipped` included. Test:
`tests/unit/update-outcome-config-check.test.ts` — a result file with and without the key → banner text / no banner change.
(ii) **`tests/unit/providers-totality.test.ts`:** for every `p ∈ PROVIDERS`, each enumerated provider-keyed site returns
without throwing — `PROVIDER_CAPS[p]`, `litellmModelName({provider: p, model: 'x'})` (`litellm-proxy.ts:35`), the direct-fetch
request builder, the catalog fetcher map, and `DEFAULT_ALIASES` typed `satisfies Record<string, { provider: Provider; model:
string }>` (`default-aliases.ts:16-19`). The `never` arms remain the compile-time proof; this file is what vitest sees. The
site list lives in the test as a `const SITES` array so a sixth site is a one-line addition.

### DES-175 (phase stamp, both hosts) — amended
(i) **`markQueued(agentId, opts: { label?: string; frame?: string; phase?: PhaseStamp })`** — an options object, not r1's
positional reorder of today's `(agentId, label?, phase?, frame?)` (`agent-executor.ts:203`): a reorder of two optional
parameters is a T1 trap a mid-tier implementer walks into silently.
(ii) **The nested host (`run-manager.ts:1011`) gains THREE config fields:** `currentPhase` (r1 — a nested frame's agents take
the parent's current lane); `onBudgetSnapshot` (C-9 — the same closure the top-level host gets at `:921`); and `onPhase:
(title) => node.phases.push(title)` where `node` is the `WorkflowNodeView` pushed at `:1009`. `WorkflowNodeView.phases?:
string[]` (`types.ts:158`; additive; persisted with the snapshot; the sub-card renders *"phases (not lanes): a, b"*). Why not
the parent timeline: see O-14 — a legal parent script would get a warning. Why not a documented no-op: INV-V26-6. On the
snapshot-less path `workflowNodes` stay `[]` today — pre-existing, not v26's, stated. The guide (DES-184 (b)) gains one
sentence. `tests/e2e/nested-frame-inherits-phase.test.ts` (E2E-010) gains the case: a nested `phase('B')` → parent lanes
unchanged, zero warnings, the sub-card carries `B`.
(iii) The `refused` record's `phase`/`phaseIndex` (stamped by `markQueued` before `assertBudget`, r1) now survive a restart via
DES-187.

### DES-177 (`ModelBook`, the pin) — amended
(i) `export function reachableModels(params: RunParams): string[]` — the `modelsToCheck` expression at `run-manager.ts:498`,
extracted, used by BOTH the alias check and `pin()` (INV-V26-4 is exactly as strong as this set, so there is one).
(ii) `maxPricePerMOf(rates: FourRates | null): number | null` — `null` → `null`; else `max(in, out) × 1e6`; `computeCostLevel`
follows; cache rates do not enter the level (doc comment). The `'free' | 'unknown'` string arms and the regex are deleted;
`model-catalog.test.ts`'s string-price cases are rewritten (T3).
(iii) A pre-v26 run row reads `priceBook: undefined` → `AgentExecutorDeps.priceBook` undefined → `priceCall(tokens, null)` →
`{ costUSD: 0, unpriced: true }` for every call; never re-priced against a live book — the same rule as pre-v26 usage events.
(iv) The pin is read back through `getSpec` (r1) — the same `runs` row `getEffectiveParams` reads at `:834`; one row, two
typed reads, no second policy source.

### DES-179 (four-column tokens, cost, two-limit guard) — amended (the largest delta)
- **Cost:** as in §Self-corrections — `costUSD: number`, `unpriced?: true`, `priceCall` returns the pair,
  `RunGuard.addUsage(tokens, costUSD, unpriced, unmapped?)`.
- **Sandbox `Budget`:** `{ limits: { usd: number|null; tokens: number|null }; total: number|null /* = limits.usd (ADR-037) */;
  spent(): number /* USD */; remaining(): number|null; tokens(): Tokens & { sum: number } }`. The guide's honesty line names
  which accessor answers which limit.
- **IPC:** `start.budget: BudgetSpec|null`; `agentResult.spent: { usd: number; tokens: Tokens }`; `onBudgetSnapshot: () =>
  { usd; tokens }` on BOTH hosts.
- **`RunStatusView.usage` has THREE producers, and the store gets the third:** store `getRun` → `usage: snap?.usage ??
  foldUsage(allTranscripts)` — mirroring `snap?.agents ?? deriveAgentRecords(…)` at `run-store.ts:243` /
  `sqlite-run-store.ts:260` (an interrupted-then-restarted run has neither a live guard nor a snapshot — QD-R2's state);
  `_mergeLive` (`run-manager.ts:730`) overlays `entry.guard.usage()` for an in-process run, beside the in-process records it
  already overlays; the terminal snapshot's `usage` is written from `guard.usage()` beside `agents` (`:885`). The equality IT
  (`usage-live-equals-fold.test.ts`) becomes three-leg: live ≡ fold ≡ snapshot on a completed run, plus a snapshot-less
  fixture read from a fresh store.
- **Resume fold is UNCONDITIONAL:** `guard.setUsage(foldUsage(allEvents))` for every resumed run; the `if (spec.budget …)` at
  `run-manager.ts:840` is deleted (owner principle; a trigger-started run never has a budget and must still report spend).
- **Migration answer ahead of ajv** (`call-tool.ts:94-100` precedent, no new code): `run_start` with `typeof a.budget ===
  'number'` → `INVALID_ARGUMENT`, message *"budget is an object since v26: `{usd?: <USD>, tokens?: <tokens>}`; a bare number
  was a TOKEN limit — send `{tokens: N}`"*, `detail: { param: 'budget', supplied: N, migration: { tokens: N } }`. Test:
  `tests/unit/call-tool-budget-migration.test.ts`. Release notes: three lines — budget shape; `toolUse` → `toolUseDeclared`;
  `agents[].tokens` two → four columns.
- **`run_result.meta.usage`:** declared in the tool description sentence and the REQ-118 fixture (not a specialised
  `outputSchema` — O-11 above).
- Schema description for `usd` carries the unpriced clause (§Self-corrections).

### DES-183 (DAG scaling) — amended: the two readers, named
`DagAgentNode.tokens: Tokens; costUSD: number; unpriced?: true` (`dashboard.ts:22`; the `input + output` flatten at `:56`
goes). `renderAgent` (`dashboard-page.ts:359`) renders `sumTokens(a.tokens) + ' tok · $' + a.costUSD.toFixed(4) + (a.unpriced
? ' (unpriced)' : '')` with `sumTokens` inlined into the page script (client JS cannot import). `meta.unpricedCalls` and
`meta.unmappedMessages` are rendered beside ARCH-119's harness table (the ADR-046 reader). Tests: `dashboard-page-source.test.ts`
gains *`a.tokens||0` absent, `unpriced` literal present*; the VAL-018 Playwright pass renders a four-column fixture and asserts
the cell TEXT — the `[object Object]` trap is a rendered assertion, not a grep.

### DES-184 (the guide) — amended
(b) + *"`phase()` inside a nested `workflow()` is recorded on that sub-workflow's card, not as a lane."* (d) + *"There is no
`openai` row: OpenRouter is the many-model door, so swapping the model — or the transport — stays a config change."* Budget
section per §Self-corrections. QD-R9 accepted: `authoring-guide.test.ts` pins a byte ceiling on `buildGuide()` (T4 on growth),
and the alias table is generated, never enumerated.

### DES-185 → the D-V2h ledger amendment (docs only; see §Self-corrections)

### DES-186 (shape pins) — amended
Keys per §Self-corrections. The derived-≡-snapshot lock that makes DES-187's whitelist un-droppable lives in DES-187.

### DES-187 — NEW: the restart-reconstruction seam — `deriveAgentRecords` carries the whole record on four branches, a refusal is journaled, and derived ≡ snapshot is a test (QD O-9 / O-10, credited)
- **traces:** ARCH-114, ARCH-115, ARCH-118, ARCH-111, REQ-124, REQ-125, REQ-127, REQ-120, REQ-008, REQ-083
- **signature:** `src/run-store.ts` — `deriveAgentRecords(transcripts, parentStatus)` is the REAL function (ARCH-114's
  `buildRecordsFromTranscript` exists in neither `src/` nor `tests/`; the ledger row should name this one). Four branches,
  each built through ONE local `base(agentId, harness)` helper so no branch can forget a field: **(1) usage/done** — `tokens`
  four columns (a two-column legacy event → zeros in the cache columns), `costUSD` (legacy → `0` + `unpriced`), `unpriced`,
  `provider`/`model`/`transport`/`proxyModel` from the usage event, `startedAt` = the first harness event's `ts`, `endedAt` =
  the usage `ts`, `phase`/`phaseIndex`/`frame`/`label` from the LATEST harness descriptor; **(2) usage/failed** — same, with
  `tokens: ZERO_TOKENS`, `costUSD: 0`, no `unpriced`, `detail` from the event, `model` from the harness descriptor (not `''`);
  **(3) refused** — from a `kind:'refused'` event: `state:'refused'`, `reasonCode`, `endedAt` = event `ts`, `label`/`phase`/
  `phaseIndex`/`frame` from the event's own data (a refused call never has a harness event), `tokens: ZERO_TOKENS`, `costUSD: 0`;
  **(4) harness-only** — as today plus `startedAt` from the event `ts` and the phase fields. Precedence: usage > refused >
  harness. `src/agent-executor.ts` — `markRefused(runId, agentId, reasonCode, endedAt): Promise<void>` updates `_records` as
  today AND emits `{ ts: endedAt, kind: 'refused', data: { reasonCode, label?, frame?, phase?, phaseIndex? } }` through the
  existing `_emit` (redact-at-capture sink); the call site (`run-manager.ts:1088`) awaits it before `throw err`.
  `TranscriptEvent.kind` (`types.ts:364`) gains `'refused'`. `foldUsage` ignores `refused` events (no usage; not an unpriced
  call).
- **boundary:** Replay is untouched by construction — the resume cache is built from the journal, not transcripts
  (`run-manager.ts:653`), so a new transcript kind cannot alter a `CallKey` match (INV-V26-1). The `refused` event carries no
  provider-authored text — a closed `ErrorCode`, a script label, a phase title: the same classes the harness event already
  persists — so REQ-083's sweep gains a row and no new class. `tests/acceptance/val-007-observability.test.ts:72` pins the
  transcript kind list as `['message','tool_call','tool_result','usage']` (already missing `harness`); it is extended to include
  `harness` and `refused` IN THE SAME COMMIT as the union member (T3). `workflowNodes` on the snapshot-less path stay `[]`
  today — pre-existing and out of scope, stated so Gate 7.5 does not read it as a v26 regression.
- **tests:** `tests/unit/derive-agent-records.test.ts` (new; one hand-written expected record per branch — T2; the legacy
  two-column usage event; a harness-less refused event; `startedAt` from the harness `ts`; a `failed` event keeping the
  harness model), `tests/integration/derived-equals-snapshot.test.ts` (new — THE lock: a fake-gateway workflow with one done,
  one failed and one budget-refused call runs to completion; `deriveAgentRecords(allTranscripts)` deep-equals
  `run_snapshots.agents` minus `lastActivityAt`; any field one writer has and the other lacks fails here, whichever task added
  it), `tests/integration/refused-survives-restart.test.ts` (new; a budget refusal, then `getRun` from a FRESH store instance
  over the same SQLite file with no snapshot → the `refused` record with its `reasonCode` and `phase`; `GET /api/runs/:id/dag`
  → `warnings: []` — QD-R2's mitigation fixture), `tests/acceptance/val-007-observability.test.ts` (the kind list).

---

## Task partition — amendments to r1's table

- **Tasks 10 + the record half of 11 → ONE task, "the AgentRecord surface"** (obligation 1): DES-175 + DES-187 + DES-186's key
  pin + DES-183's two dashboard reader sites. Single-owner; the derived-≡-snapshot IT is its exit criterion.
- **Task 2** (types + guard) names the two untyped dashboard sites as sub-bullets (obligation 2); every other four-column site
  is typed and the build gate catches it — the two template-string sites are the ones `tsc` cannot see.
- **Task 11 (remainder):** `costUSD` once, `addUsage`, usage-event shape, `detail`, `foldUsage`, `getRun`'s fold,
  `_mergeLive`'s usage, snapshot `usage`, `run_result.meta` + description — one task (obligation 3).
- **Task 13** gains the four `configCheck` parts (obligation 4).
- **Task 17 → "the D-V2h ledger amendment"**, docs only, scheduled FIRST (obligation 8). No gated task remains (obligation 7).
- **DES-180's rows are deleted** from task 2 and task 18; `run-start-unpriced-model.test.ts` moves to task 11.
- **New ordering constraints:** task 10′ (the record surface) after task 2 (`Tokens`/`ZERO_TOKENS`) and after task 3 (phase
  stamp types); the `val-007` kind-list extension in the same commit as the `'refused'` union member; `providers-totality`
  lands WITH `PROVIDER_CAPS` in task 1 (obligation 5/6 — a lock landing later is green against the wrong baseline).

---

## Flags for the synthesizer — ledger text now stale (not mine to edit)

1. **`02-architecture.md` v26 interface table:** the `run_start` admission row still says *"may refuse `PRICE_UNKNOWN` …
   pending the owner ruling"* — the ruling deleted it. The `models_list` row says *"one top-level `catalogFetchedAt`"* — both
   panels' r1 hold per-row (my R8; QD's R-9 lists it among the row's fields).
2. **ARCH-114** names `buildRecordsFromTranscript`; the function is `deriveAgentRecords` (`run-store.ts:24`).
3. **ARCH-114's nested-frame cohort** (*"`k ≥ lanes.length` — nested frames pushing onto the parent timeline — appends a lane
   WITH a warning"*) cannot occur after DES-175 (b′): nested phases never enter the parent timeline. The rule's remaining
   reachable case is a TOP-LEVEL script whose `phase()` count at runtime exceeds the skeleton's (a `dynamic` loop) — still
   valid, narrower; the sentence should say so.
4. **REQ-124's** *"nested `workflow()` frames share the same phase timeline (a known approximation)"* is not an approximation
   today (it is a drop) and after v26 should read *"a nested frame's agents take the parent's current phase; its own `phase()`
   calls are recorded on its card, not as lanes"*.
5. **REQ-127's** amended clause says `costUSD: 0` + `unpriced: true`; the interface table's `run_status.agents[]` row should
   list `unpriced?` beside `costUSD`.
6. Guide example 7's reshaping (r1 DES-182) stands and remains the one owner-visible change.

---

## Remaining disagreements (short)

1. **S-10 — a fourth `price_book.source` value.** REBUT: `fetchedAt === null` and `'last-good'` + an old `fetchedAt` already
   distinguish "never" from "stale", and nothing decides on `source` any more. One string if QD holds; not worth a round.
2. **O-13 — nullable `costUSD`.** Settled by the owner, not by a lens: `0` + `unpriced: true`. Recorded here so it is not
   re-argued at Gate 8 as a design choice.
3. **O-12 — read-time-only `unpricedCalls`.** HOLD: one rule, two producers, one three-leg equality IT — because `_mergeLive`
   already serves in-process records for a live run and a `usage` from anywhere but the guard would disagree with them by one
   capture write.
4. **`tools: default` — literal vs skip.** Compatible, not conflicting: neither compares a resolved list; mine additionally
   requires the WORD so `tools: Read` cannot stand on a default-surface agent. Keep the literal (r1 R9).
5. **R-10 scope.** Conceded to ONE file with an enumerated site array; not per-site test files.

---

## Internal lens conflicts new this round (argued; Karpathy tie-break)

1. **A new transcript event kind** (boundary: the refusal must survive a restart) **vs no new write path** in a slice whose ten
   REQs ask for none (simplicity). **Tie-break: write it** — eight lines and one branch against a permanent hole in a v25
   guarantee; the "cohort caveat" is a silent drop with a sentence on it, and INV-V26-6 exists to forbid exactly that.
2. **Nested `phase()` onto the parent timeline** (interface: one timeline; ARCH-114's sentence becomes true) **vs onto the
   sub-card** (boundary: no mis-stamped parent agent). **Tie-break: sub-card** — the timeline wiring fires a warning on a
   CORRECT script, which is the T1 shape inverted; the sub-card is one additive field with an existing reader.
3. **Three producers of `RunUsage`** (testability risk) **vs one fold everywhere** (interface purity). **Tie-break: three, one
   shape, one three-leg IT** — the snapshot-less restarted run is a real state, the in-process overlay already exists for
   records, and the IT is the contract (r1 conflict 10, extended by one leg).
4. **Keep `Budget.total`** (interface: ADR-037 fixes it as USD) **vs drop it** (simplicity: `limits.usd` is the same fact).
   **Tie-break: keep** — ADR-037 is settled, and a v25 script reading `total` gets a value rather than `undefined`; the guide
   names which accessor answers which limit.

**Test-count delta vs r1:** −2 files (DES-180) · +4 (DES-187: `derive-agent-records`, `derived-equals-snapshot`,
`refused-survives-restart`, `val-007` extension) · +3 (`providers-totality`, `call-tool-budget-migration`,
`update-outcome-config-check`) · +1 IT rename (`run-start-unpriced-model`) · the three-leg extension of
`usage-live-equals-fold` · E2E-010's nested-phase case.
