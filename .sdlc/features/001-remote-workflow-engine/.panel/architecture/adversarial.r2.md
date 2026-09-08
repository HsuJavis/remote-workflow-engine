# Architecture panel — adversarial group (Security × Scalability/Consistency × Testability), round 2

**Lens:** adversarial architecture group; three lenses argued per point, Karpathy simplicity-first as the
tie-breaker. **Round:** 2 (responses + final position). **Scope:** v26, REQ-121..130. **Numbering:** stable
with r1 — ARCH-110..121, ADR-037..045, G1..G14 keep their IDs; only the CHANGED clauses are restated here,
everything not mentioned stands as written in `adversarial.r1.md`. New gaps are G15+.
**Inputs this round:** `quality-dimensions.r1.md` (the only other proposal on disk), re-read in full;
`adversarial.r1.md`; `v26-gate1-working-notes.md` §擁有者答覆 (Q1–Q6 — none settles REQ-127's (i)/(ii) or
trigger budgets; Q5 says only "依各模型價格算花費"). **HEAD moved to fe35c48** (the Gate 1 commit) since r1;
every source line I cite below was re-checked there: `src/resume-cache.ts:14` (`sameKey` = `prompt` +
`JSON.stringify(opts)`), `src/run-manager.ts:844` (`guard.setSpent(sumUsageTokens(allEvents))`),
`:1065` (`markQueued(agentId, key.opts.label, key.opts.phase, framePath)` BEFORE `acquireSlot`),
`:1082-1088` (`assertBudget()` → `markRefused` on the SAME agentId), `src/agent-executor.ts:203-207`
(`markQueued` writes `label, phase, frame`), `:222-228` (`markRefused` MERGES onto the queued record —
"so label/phase/frame survive"), `src/types.ts:118` (`AgentRecord.phase?: string`, no writer), `:148-152`
(`PhaseView = {title, ts}`, no index), `:343` (`HarnessDescriptor.effortApplied` already persisted, DES-106),
`src/gateway/claude-agent-sdk-client.ts:379-389` (`extractEvents` allowlist), `src/gateway/client.ts:28-55`
(`EffortApplied`, `mapEffort`), `:165-241` (the five `case` arms), `src/gateway/litellm-proxy.ts:31-73`
(the only per-provider knowledge there is the `openrouter/*` wildcard route), `src/models/model-catalog.ts:18`
(`price` is a display string), `src/errors.ts:112-113` (`INVALID_SEED_SPEC` and `SEED_SOURCE_CONFLICT`
ALREADY exist, both `see: null`), `04-design.md:832` / `:1156` (D-V2h "Resolved", unbuilt).

---

## 0. Where the panel already agrees — merge, do not debate

Reached independently in both r1s; I list them so round 2 spends no time here.

| Quality-dimensions r1 | Adversarial r1 | Merged statement |
|---|---|---|
| KP8 / S-1 option (ii), object budget, legacy number detectable | ADR-037 | `budget: {usd?, tokens?}`; bare number refused at `run_start`; a PERSISTED legacy number rehydrates as `{tokens: n}` |
| KP3 first half / O-2 live stamp at `host.ts` receipt, never in `opts` (QD-R2) | ARCH-114, R12 | phase snapshotted synchronously in `case 'agent'` BEFORE the `Promise.resolve().then` deferral; `CallKey` byte-identical to v25 (tested) |
| KP4 / O-5 `retryable` on the shared failure type, honoured by BOTH loops | ARCH-111 | `GatewayResult.retryable?: false`; `client.ts:362` and `claude-agent-sdk-client.ts:444` both break on it |
| KP5 / O-6 `{transport, provider, model, proxyModel?}` distinct fields | ARCH-115 | the harness stamp wins; `markDone` fills only what `markHarness` did not own |
| KP11 / S-5 explicit `diagram_contract` column | ADR-043 | `NULL` ⇒ `'v1'`; every v26 write `'v2'`; never inferred from `createdAt` |
| KP9 / O-8 / S-2 pinned prices, TTL'd last-good, fold STORED `costUSD` | ARCH-116, ARCH-118 (`foldUsage`) | pinned at admission (`runs.price_book`), computed once at capture, never re-priced on resume; legacy events fold as `unpriced += 1` |
| S-3 first two properties (last-good + TTL; `null` + counter, never zero) | ARCH-116, ARCH-118 | identical |
| R-6 effort = provider profile × MODEL capability | ARCH-117 `wireEffort(provider, caps, effort)` | identical |
| R-7 detection per transport, classification on the common type | ARCH-111 / ADR-040 | `classifyApiError` lives in the SDK client (it is over the SDK's union); the direct-fetch client sets the same `retryable:false` from its own status codes; no SDK vocabulary crosses into `client.ts` |
| QD-R5 pre-concession: subtype + count, no payload | ARCH-111, C10 | `meta.unmappedMessages: Record<subtype, count>` — see §1.1 for the one tightening this forces on my own text |
| KP10 / C-2 every emitted code has an `ERROR_CATALOG` row with `see:` | ARCH-121 drift locks, slice shape | a unit test over emitters × catalog, authoring-side codes `see: 'workflow_authoring_guide'` |
| C-6 view-layer viewBox/zoom for both figures; QD-R13 caution | ARCH-120 / ADR-044 | `createElementNS` + `textContent` kept; no library |
| QD-R7 loss of the self-hosted OpenAI-compatible path recorded in the ADR | ADR-041 / G6 | identical |
| QD-R12 nested frames share one phase timeline — document as approximation | R8 / G14 | identical |
| S-6 circuit breaker named and deferred | ARCH-111 Karpathy clause | identical — not v26 |
| S-8 no memory metabolism / self-calibration invented | Summary altitude split | identical |
| R-5 the swap surface concentrates from "provider" to "OpenRouter model id" — a concentration, not a loss | ADR-041 consequence / ARCH-112 Karpathy clause | stated in ADR-041's text: three direct paths, OpenRouter as the many-model front door; re-adding a provider is one union member plus the `Record` rows `tsc` demands |

---

## 1. Responses to quality-dimensions r1 — rebut / concede / hold

### 1.1 KP2 / O-4 — invert `extractEvents`' default; store a bounded, redacted payload of every unmapped SDK message
**HOLD on the payload, CONCEDE the fact — and TIGHTEN my own r1 to match.** Their QD-R5 already offers the
fallback I take: the subtype NAME and a COUNT. Security's reason stands unchanged: provider response bodies are
the one input stream the engine does not author; `redact()` (`secret-resolver.ts:101`) is value-exact over
secrets the engine was TOLD about, so it cannot protect a body that echoes something it was not told; a byte
bound limits damage, it does not remove the surface. Testability's irreducible part — "something was dropped,
here is its name" — is kept.

The tightening: r1's ARCH-111 said a retry-kind `api_retry` is "recorded as an event" without saying what the
event carries. Left like that, the retry path would store exactly the payload C10 declines. **Amended:** a
retry-kind `api_retry` yields `{kind:'message', data:{type:'api_retry', status, kind, attempt, max_retries}}` —
five scalars, NO error text; only the TERMINAL classification yields `{type:'error', detail, status, kind,
attempt}` where `detail` is redacted THEN capped at 1024 bytes (R-G9 order) and joins the `redact-sweep`
sink list (G13). Bound: rows, not bytes — the CLI's own `max_retries` (10, reported in the message) × (1 + configured engine
retries) rows of ~80 bytes per call — bounded by two values that already exist; no extra constant. Every other `system` subtype is counted,
never stored.

### 1.2 KP1 — "name the bug class once, design the counter-measure once"
**CONCEDE the discipline, REBUT the mechanism.** The observation is correct and well evidenced (five `??`/`[]`
defaults over external payloads, five silent drops). As a REVIEW rule it costs nothing and I want it in
04-design as a checklist line, proposed text: *"D-V26-projection — every default (`?? x`, `?.`, `: []`) applied
to an external payload (SDK message, provider response body, tool argument, catalog row) names in an adjacent
comment WHAT it drops and WHICH counter or code makes the drop visible; a bare `?? 0` / `?? ''` over such a
payload is a Gate 8 finding."* As a code-level abstraction it is the speculative machinery this lens's
tie-breaker exists to reject: the five seams have five different correct behaviours (refuse / terminal /
count / keep-previous / stamp) and share no type. Their r1 does not actually ask for the abstraction, so I read
this as converged on the discipline.

### 1.3 KP12 / O-3 — `run_result.meta.warnings: {code, count, detail?}[]` as the one home for run-level facts
**HOLD, by count.** Of the four "homeless facts" they list, two are not run-level facts under the merged
design: a legacy bare-number budget is REFUSED at `run_start` (ADR-037) so there is no run to warn on, and a
persisted legacy number rehydrates as `{tokens: n}` — its true v25 meaning, not a degradation, so nothing to
warn about; a v1-contract diagram is a per-VERSION fact reported by `workflow_describe.diagramContract`
(ADR-043), not a per-run one. That leaves two run-level counters — `meta.unpricedCalls` (REQ-127's literal
name) and `meta.unmappedMessages` — and two named, `tsc`-checked integers do not need an umbrella, a code
catalogue or a severity model. A cold model reads a named field without scanning an array. If a third counter
appears in a later iteration, the projection is a five-line change then; building it now for two is the
speculative branch.

### 1.4 KP3 second half / O-2 — `phaseAt(phases, ts) → {title, index}` for both the live stamp and the backfill
**CONCEDE the ordinal; HOLD on "no timestamp at live time".** They are right that the layout needs an INDEX,
and for two reasons stronger than the one they give: (a) titles repeat and collide — `phase('review')` called
twice, or two dynamic titles that evaluate equal — so r1's "position of its phase title in `phases`" is
ambiguous exactly where REQ-124's order-join matters; (b) on resume the re-run script RE-FIRES `phase()`
(run-manager.ts:766) in the same order with new timestamps, so the ordinal is the one join key the resumed run
reproduces exactly and a timestamp is the one it does not. So the stamp becomes `{phase: title, phaseIndex}`,
`AgentRecord` gains `phaseIndex?: number` beside the existing `phase?: string`, the harness event carries both,
and `layoutGraph` joins on the index. What I do not accept is one function "called at two times": at receipt
there is no timestamp and none is needed — the current phase is by definition `phases.at(-1)`, read
synchronously; only pre-v26 terminal snapshots are inferred by time. Two reads, ONE join key, ONE pure
inference function (`inferPhase` now returns the same `{title, index}` pair). Amended ARCH-114 in §2.

A bonus this closes: G8 (refused records). `markQueued` runs BEFORE `acquireSlot` and `assertBudget`
(run-manager.ts:1065 → :1082), and `markRefused` MERGES onto that record (agent-executor.ts:222-228), so a v26
`refused` call carries the exact stamp; only pre-v26 refused snapshots fall to `endedAt` inference.

### 1.5 KP8b / QD-R14 / S-1 — no trigger-started run carries a budget; D-V2h is an unimplemented "Resolved"
**AGREE on the fact (r1 R13, independently verified), HOLD on placement — and this is now converged, not
disputed.** Both lenses rate it HIGH and both say the same two things: it must not ship silently, and the fix
is wiring (the `composeConfig` bug class), not design. Where we differed — whether to design the trigger
budget inside v26 — their text says "Gate 2 owes one of two answers, in writing", and G12 IS that request,
with both answers drafted. Nothing in REQ-121..130 mentions triggers; putting a `budget` column on two trigger
tables and two tool schemas on my own authority is scope invention. One addition to G12 from this round: if
ruled IN, forward a per-trigger `budget: {usd?, tokens?}` and do NOT build D-V2h's "server-level default cap"
without its own ruling — a global USD default is an operator policy nobody has asked for and a second policy
source beside the per-run budget.

### 1.6 S-3 third property — stop-vs-warn on unpriced calls (my ADR-038 refused budgeted runs at the door)
**NARROW — converge on the door, drop everything mid-run.** Their liveness objection ("stop-on-unpriced turns a
catalog outage into a total outage") is aimed at a mid-run stop, and under the merged design a mid-run stop
cannot exist: every reachable model is resolved and pinned at admission (ADR-029 + REQ-091, run-manager.ts:498),
so after the door there is no new pricing information. The only decision point is admission, and there the
fail-closed instinct is right but was too wide. **Amended ADR-038:** refuse (`PRICE_UNKNOWN`) ONLY when the run
would have NO enforceable limit at all — `budget.usd` set, `budget.tokens` absent, and at least one reachable
model with `price: null`. If `budget.tokens` is also set, admit; the token limit still stops it and
`unpricedCalls` counts the USD blind spot. No USD budget → REQ literal (`costUSD: null` + count). The refusal
names the fix: *"openrouter/<id> has no price in the catalog; a USD-only budget cannot count it — add
`budget.tokens`, omit `budget.usd`, or retry when the catalog is reachable."* Consequence stated honestly and
narrowed: an OpenRouter listing outage AFTER a restart (the in-memory last-good is gone) refuses new
USD-ONLY-budgeted OpenRouter runs; unbudgeted, token-budgeted, anthropic and ollama runs are untouched. Still a
deviation from REQ-127's literal → G2 stands, narrower.

### 1.7 R-2 — one `PROVIDERS` descriptor table with `{id, keyEnv, litellmPrefix, effort, thinkingPolicy, pricing, catalogSource, toolSurface}`
**CONVERGE on their own fallback, and take it further than r1 did.** They wrote: "If they win, the fallback I
would accept is: no table, but a single module that owns all per-provider constants." That module is r1's
`src/providers.ts`. Reading my own r1 against their R-1 table exposed a defect in MINE: ARCH-112 had
`PROVIDER_CAPS` (with an `effort: 'native'|'declared'|'none'` column) and ARCH-117 kept `EFFORT_PROFILES:
Record<Provider, …>` in `client.ts` — two `Provider`-keyed tables carrying overlapping effort facts, the exact
shape ADR-045 attacks. **Amended:** `EFFORT_PROFILES` is DELETED as a separate table; the profile IS the
`effort` column: `PROVIDER_CAPS: Record<Provider, { tools: 'all'; effort: EffortProfile | null; thinking:
'sdk-default' | 'budget-when-declared' | 'disabled' }>`. One table, in one file, read by `wireEffort` (SDK
transport), `effortBodyFields` (direct-fetch transport), `validateAliases`, `models_list`'s declared columns
and the guide's alias table — five readers. What stays OUT of the table, and why: `keyEnv`, the request/response
shape (`client.ts`'s three surviving `case` arms), the catalog fetchers, the LiteLLM route emitter. Those are
CODE, and a `switch (provider)` over a three-member union with a `never` exhaustiveness check is the honest
form for code; `keyEnv` has exactly one reader (the direct-fetch arm — LiteLLM reads `OPENROUTER_API_KEY` from
its own env, litellm-proxy.ts:33/66). **Rule I propose the panel adopt:** a per-provider fact earns a column
when two or more readers need it; otherwise it stays beside its one reader. That is R-2's count argument turned
into a criterion, and it lands on the same module they were willing to accept.

### 1.8 C-7 / S-7 — provenance on declared flags: `source: 'upstream' | 'static' | 'unknown'` + `declaredAt`
**CONCEDE `source`, REBUT per-row `declaredAt`.** `source` is known at the exact point `caps` is computed
(static table vs `/models` row vs nothing) and it is what makes REQ-130(e)'s "declared, not probed" true IN
THE DATA rather than only in the description — a cold model filtering `models_list` can see it. `declaredAt`
per row is a pre-shaped slot for issue #73's deferred probe, and we do not pre-shape for deferred work; the
information it would carry already exists once per snapshot. **Amended ARCH-116/117:** `BookEntry.caps.source`,
`EnrichedModelEntry.declaredSource`, and ONE top-level `catalogFetchedAt: string | null` on the `models_list`
reply (the snapshot's fetch time; `null` when only static rows are present). When the probe is built it adds
its own field with its own name.

### 1.9 O-7 — "`effortApplied` belongs on the agent record and the dashboard harness table, not only in a computed return value"
**No concession needed — it is already there.** `HarnessDescriptor.effortApplied` (types.ts:343, DES-106) is
persisted on the harness event by agent-executor.ts:459 today. What v26 changes (ARCH-117) is its CONTENT for
openrouter: `{param:'thinking', value:{type:'enabled', budgetTokens}, restPath:['thinking','budget_tokens']}` —
the wire position their QD-R11 asks for, so a LiteLLM translation change is falsifiable against what was sent.
The dashboard harness table (ARCH-119) renders it. Converged by existing fact.

### 1.10 R-4 / QD-R6 — deploy ordering as a numbered DEPLOY.md step observed at Gate 7.5
**HOLD ADR-042 as the mechanical form; ACCEPT their step as its explicit fallback.** `--check-config` inside
the updater's `revert_and_fail` path turns "human removes the rows first" into "a stale config is a failed
update on the old version". But my own R5 admits the check runs only when `RWE_CONFIG_PATH` is in
`/etc/rwe/update.env` — a human step. So both: the numbered DEPLOY.md step with the failure mode spelled
("without `RWE_CONFIG_PATH` in `update.env` the updater cannot check the config; the restart then proceeds and
the service refuses to boot with the offending rows named"), AND Gate 7.5 observes the ORDER, not the end
state: drive the updater against a config still carrying a `gpt41*` row → `configCheck: 'failed'`, service
still on the prior version, then remove the rows → `applied`.

### 1.11 C-5 — `budget.spent()` is live but not resume-stable; KP13 — `state.yaml.tech_stack` calls it a stub
**CONCEDE both.** C-5 is a genuine finding I had not made: the value is real (`run-manager.ts:925` supplies
`onBudgetSnapshot`) but a branch on it changes the next prompt, misses the `CallKey`, and re-executes from
that call — resume-SAFE, not resume-efficient, and under REQ-127 the re-execution costs money. Folded into
ARCH-121(b) as a guide sentence beside the determinism guard, with the same WHY (`resume-cache.ts:14`). KP13
joins G10 housekeeping.

### 1.12 C-1 / O-1 — each seed `items` description carries the code it raises; C-3 — every checker rule has ≥1 registering `GUIDE_EXAMPLE`
**CONCEDE both — cheap, and one corrects my r1.** (a) The three `items` descriptions end with the code:
`seed` → `INVALID_SEED_SPEC`, any two sources together → `SEED_SOURCE_CONFLICT`. Correction to r1's slice shape:
`INVALID_SEED_SPEC` is NOT a new code — it exists at errors.ts:112 with `see: null` and a generic hint; v26
makes the `seed` path actually RAISE it for a non-string `contentB64`, rewrites its hint to name
`contentB64`/`seedManifest`, and sets `see: 'workflow_authoring_guide'` (authoring-side). (b) ARCH-119's
testability gains a coverage assertion: for each of the four v2 codes ≥1 negative fixture yields it, and for
each v2 construct (phase lane, `parallel` slot, `alt` slot, `tools: none`, `tools: default`, dynamic title) ≥1
`GUIDE_EXAMPLE` exercises it and registers green.

### 1.13 Their "expected disagreements" that did not materialise
- vs. a simplicity lens on R-2: this lens IS the simplicity lens on the panel, and it agrees (§1.7).
- vs. a data-model lens on option (ii): no such lens is on disk; both proposals chose (ii).
- vs. "whoever proposes the child-side phase stamp": nobody did; both proposals chose host-side receipt.
- vs. a performance lens on pinning prices per `usage` event: four numbers per call; agreed cheap.

---

## 2. Final position — amended entries (deltas only; unchanged text stands as in r1)

### ARCH-110 (amended) — `validateSeedSpec`
- `INVALID_SEED_SPEC` is an EXISTING catalog row (errors.ts:112) — v26 changes: the `seed` path raises it
  (today nothing does for a missing `contentB64`), hint → *"seed elements carry bytes inline as contentB64
  (string, base64); to seed by sha256 use seedManifest (blobs pushed via workspace_push) or seedManifestRef"*,
  `see: 'workflow_authoring_guide'`.
- Each `items` description names the code it raises (§1.12a). Everything else as r1.

### ARCH-111 (amended) — provider errors end the attempt
- Retry-kind `api_retry` → event `{type:'api_retry', status, kind, attempt, max_retries}`, NO body text.
  Terminal → `{type:'error', detail, status, kind, attempt}`, `detail` redacted then capped 1024 B. Unmapped
  `system` subtypes → `meta.unmappedMessages: Record<subtype, count>`, never a payload (§1.1).
- `classifyApiError` stays in `claude-agent-sdk-client.ts` (it is total over the SDK's closed union); the
  shared surface on `GatewayResult` is `retryable?: false` + `error?: {kind: string; status: number | null;
  attempt: number}`; the direct-fetch client sets them from its own status codes (R-7 honoured).

### ARCH-112 + ARCH-117 (merged amendment) — one provider table, two transport writers
- `src/providers.ts`: `PROVIDERS`, `Provider`, `validateAliases`, and `PROVIDER_CAPS: Record<Provider, { tools:
  'all'; effort: EffortProfile | null; thinking: 'sdk-default' | 'budget-when-declared' | 'disabled' }>` =
  `anthropic: { all, {param:'effort', restPath:['output_config','effort'], value: e => e}, 'sdk-default' }`,
  `openrouter: { all, {param:'thinking', restPath:['thinking','budget_tokens'], value: e => ({type:'enabled',
  budgetTokens: REASONING_BUDGET[e]}), requires:'caps.reasoning'}, 'budget-when-declared' }`, `ollama: { all,
  null, 'disabled' }`. `client.ts`'s `EFFORT_PROFILES` is deleted (not extended — r1 correction, §1.7).
- Two writers, one per transport, both reading the table: `wireEffort(provider, caps, effort)` in the SDK
  client is the SOLE writer of `options.thinking` and `options.effort` (as r1); `effortBodyFields` in the
  direct-fetch client reads `PROVIDER_CAPS[p].effort` for its body. Neither transport's vocabulary crosses
  into the other. `mapEffort`, `profileFor`, `thinkingFor`, `params/resolve.ts:191`'s table and
  `session-options-builder.ts:18`'s table are deleted and grep-guarded (ADR-045).
- Column criterion: a per-provider fact enters `PROVIDER_CAPS` only with ≥2 readers (§1.7). `keyEnv`, request
  shapes, fetchers, the LiteLLM route emitter stay as `switch (provider)` code with `never` exhaustiveness.
- Boot refusal, `--check-config`, updater step, grep guards: as r1, plus the DEPLOY.md numbered step and the
  Gate 7.5 ordering observation (§1.10).

### ARCH-114 (amended) — phase stamp is `{title, index}`, joined by index
- `SandboxHostConfig.currentPhase?: () => { title: string; index: number } | undefined`; RunManager supplies
  `() => { const p = this._runs.get(runId)?.phases; return p?.length ? { title: p[p.length-1].title, index:
  p.length-1 } : undefined; }` to the top-level host (:922) and every nested-frame host (:1017). Read
  synchronously in `case 'agent'` at receipt (before host.ts:107's deferral — the 5/5 probe from r1 stands).
- `AgentRequestHandler(prompt, opts, callSeq, phase?)` → `_handleAgentRequest(…, framePath, phase)` →
  `markQueued(agentId, label, phase?.title, framePath, phase?.index)`; `AgentRecord.phaseIndex?: number`
  beside `phase?: string`; the harness event descriptor carries `phase` AND `phaseIndex`;
  `buildRecordsFromTranscript` reads both plus `startedAt` from the event `ts`. `CallKey` unchanged (tested).
- `inferPhase(record, phases) → { title, index } | undefined` — index of the last `phases[i]` with `ts <=
  (record.startedAt ?? record.endedAt)`; no timestamps → last phase; no phases → `undefined`.
- `layoutGraph(expected, liveAgents, phases, opts)`: lane = `record.phaseIndex ?? inferPhase(…).index`;
  `index >= expected.lanes.length` → an appended lane with a warning (the nested-frame approximation, R8);
  slot within the lane by label against the expected slot's label set, as r1.
- Cohorts (G14) unchanged: (i) v26 runs exact — live stamp or harness event, INCLUDING `refused` records
  (§1.4, G8 narrowed); (ii) pre-v26 terminal snapshots — `inferPhase`; (iii) pre-v26 journals resumed across
  the upgrade — frame-grouped fallback WITH a warning.

### ARCH-116 / ARCH-117 (amended) — provenance
- `Caps = { reasoning: boolean | 'unknown'; tools: boolean | 'unknown'; source: 'upstream' | 'static' |
  'unknown' }`; `EnrichedModelEntry` gains `declaredSource`; the `models_list` reply gains top-level
  `catalogFetchedAt: string | null`. No per-row `declaredAt` (§1.8).

### ARCH-118 (amended) — admission rule for unpriced models
- `run_start` admission: `if (budget?.usd != null && budget.tokens == null && reachable.some(m =>
  pinned[m].price === null)) → refuse PRICE_UNKNOWN` with the message in §1.6; every other combination admits.
  No mid-run stop on unpriced exists or is possible after the pin. `unpricedCalls` increments only for a `done`
  call whose pinned rate is `null` (as r1; a `failed` call moves no counter).

### ARCH-119 (amended) — coverage assertion
- Unit test: each v2 code has ≥1 negative fixture producing it; each v2 construct has ≥1 `GUIDE_EXAMPLE`
  exercising it, and all examples register green against a booted engine (§1.12b). Otherwise as r1.

### ARCH-121 (amended) — guide content
- (b) gains, beside the determinism guard and with the same WHY: *"`budget.spent()`, `budget.remaining()`,
  `budget.tokens()` are live values, not resume-stable: read them for logging; a branch on them changes the next
  prompt, misses the replay key on resume, and re-executes from that call at real cost."* Otherwise as r1.

### ADR summary (deltas)
- **ADR-038 (narrowed):** refuse at admission ONLY when a USD-only budget meets an unpriced reachable model;
  with `budget.tokens` present, admit and count. No mid-run unpriced decision exists. Still needs G2.
- **ADR-045 (extended):** ONE effort table and it is `PROVIDER_CAPS[p].effort` in `providers.ts`; `client.ts`'s
  `EFFORT_PROFILES` joins the deletion list. Two transport-local writers read it; no table elsewhere.
- **ADR-042 (extended):** the DEPLOY.md numbered step with the named failure mode is the fallback when the
  updater's env lacks `RWE_CONFIG_PATH`; Gate 7.5 observes the ordering, not only the end state.
- **New design-gate item (not an ADR):** D-V26-projection checklist line (§1.2).

### Conflicts between my lenses — what changed this round
- **C1 (unpriced under USD budget):** security still wins at the door, but only where NOTHING else is armed;
  liveness (scale/self-sustainability) wins everywhere else, because the pin removes every mid-run case.
- **C10 (unmapped SDK traffic):** unchanged outcome; the retry-kind event's contents are now spelled so the
  retry path cannot smuggle the payload back in.
- **C11 (new) — phase join key:** *Simplicity:* title only (field exists). *Consistency:* index — titles repeat,
  timestamps do not survive resume, and REQ-124's order-join needs an ordinal. *Testability:* index — the
  ordering test becomes an integer equality. **Tie-break:** index, carried beside the title.
- **C12 (new) — provider table width:** *Consistency:* one row per provider for everything. *Simplicity:* only
  data with ≥2 readers; code stays code. **Tie-break:** the ≥2-readers criterion — it is also what keeps
  `providers.ts` free of SDK and fetch imports, so it stays pure and unit-testable.

---

## 3. Remaining disagreements (small, and named)

1. **`meta.warnings[]` umbrella (their KP12).** I hold two named counters; they may still want the list. Cost
   of either is small; this is a shape preference the orchestrator can settle without a ruling. If the
   umbrella is chosen it must be a PROJECTION of the named fields, and `meta.unpricedCalls` stays as REQ-127
   names it.
2. **Bug-class as code (their KP1).** Converged on the discipline; if anyone proposes a shared
   `Projection`/`Unmapped` type in 04-design, this lens objects on Karpathy grounds.
3. **Nothing else.** Every other divergence between the two r1s is merged above.

## 4. Rulings still needed / gaps (IDs stable with r1; new: G15–G17)

- **G1 (RULING)** — ADR-037 object budget vs REQ-127's literal `budget: number` (USD). Both lenses chose (ii);
  the owner's Q5 did not settle it. Fallback: REQ literal + guide sentence.
- **G2 (RULING, narrowed)** — ADR-038 as amended: `PRICE_UNKNOWN` at admission only for USD-only budgets over an
  unpriced reachable model. Fallback: REQ literal everywhere.
- **G3 (RULING-LIGHT)** — ADR-040 error-kind union (extends REQ-122's status set); the fast terminal must abort
  the CLI subprocess (a `ps` check at Gate 7.5).
- **G12 (RULING)** — trigger-started runs carry no budget (both lenses HIGH). Options (a)/(b) as r1; if (a),
  forward a per-trigger budget and do NOT build D-V2h's server default cap without its own ruling (§1.5).
- **G8 (narrowed)** — only PRE-v26 `refused` snapshots need `endedAt` inference; v26 refused records carry the
  stamp (agent-executor.ts:222-228).
- **G10 (extended)** — add: `state.yaml.tech_stack`'s "hard-coded stubs" sentence about `budget.spent()` /
  `remaining()` is stale (run-manager.ts:925 supplies the snapshot); rewrite to "live, not resume-stable".
- **G13** unchanged (the `detail` string is a new persisted, redacted, capped string in the sink sweep).
- **G15 (new, REQ-124)** — `AgentRecord.phaseIndex` and `descriptor.phaseIndex` are new fields; the REQ's
  acceptance should say the DAG joins by phase ORDINAL so a repeated title places correctly, and the ordering
  test asserts the integer.
- **G16 (new, REQ-126/130)** — `models_list` gains `declaredSource` per row and `catalogFetchedAt` at the top;
  the tool description states both are declarations and names the snapshot time as the only "as of".
- **G17 (new, REQ-121)** — `INVALID_SEED_SPEC` already exists with `see: null`; REQ-121's acceptance should
  require `see: 'workflow_authoring_guide'` and a hint naming `contentB64`/`seedManifest`, else the C-2
  catalog test passes on the existing generic row.

---

**Headline:** converged with quality-dimensions on the object budget, host-receipt phase stamp (now carrying
an ordinal), `retryable` on both loops, one `providers.ts` table (effort profile folded in, ≥2-readers column
rule), subtype+count for unmapped SDK traffic, provenance `source` on declared flags, and escalation of the
trigger-budget gap; ADR-038 narrowed to USD-only budgets at admission; still disputed only the `warnings[]`
umbrella vs two named counters, and G1/G2/G12 still need owner rulings.
