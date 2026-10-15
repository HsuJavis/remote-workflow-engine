# Quality-dimensions lens — Architecture round 1 (independent proposal) — v40

**Scope:** iteration **v40 — 經 pi-ai 接上兩類非 chat 模型**, REQ-220..REQ-230
(`01-requirements.md:3026-3213`), full Gate 2→8 path, QM. Inputs read: the v40 requirements section and
its Round v40 interview table (V40-Q1..Q19), `state.yaml` tech_stack (`:47-140`), the Gate 0 as-is map
(`v40-gate0-asis-map.md`, all ten sections), and — verified directly, not taken from the as-is map —
the pi-ai 1.0.0 implementation this round builds on: `node_modules/@earendil-works/pi-ai/dist/api/
system-one-shared.js` (classify), `api/openrouter-images.js` (generateImages), `utils/provider-retry.js`,
`utils/error-body.js`, `types.d.ts:57-75, 289-310, 900-953`, `providers/data/openrouter.json`; and the
engine seams each dimension lands on: `src/run-guard.ts`, `src/resume-cache.ts`, `src/run-manager.ts:
445-460, 2915-2965`, `src/event-log.ts:1-55`, `src/models/{model-catalog,model-book,models-query,
observed-stats}.ts`, `src/providers.ts:159-209`, `src/agent-semaphore.ts`, `src/main.ts:145, 347,
595-630`, `src/server.ts:1650-1665`, `src/dashboard.ts:57-181`, `src/types.ts:125-204, 266, 734-758,
895-918`, `src/sandbox/host.ts:425-455`, `src/gateway/client.ts:248-285`, `src/tool-specs.ts:1444-1564`.

**Supersession note:** this path held the v37 round-1 proposal. `git status --short` on it is clean at
`764a48f`, so `git show 764a48f:<this path>` reaches that content per CLAUDE.md's read-a-commit rule.
Nothing is checked out, restored or stashed.

## Altitude call

Both altitudes apply, but with a correction the other lenses may not make: **`decide()` and
`generateImage()` are not agents.** They are stateless model function calls — one request, one typed
answer, no tool loop, no chain-of-thought, no session (`ClassifierResult.answers`, `AssistantImages.
output`; `types.d.ts:437-497`). So the agent-altitude reading of each dimension shifts:

- *Observability (agent):* "chain-of-thought must be inspectable" collides head-on with REQ-229 (只記
  中繼資料, never `state`/prompt, owner V40-Q11). The reconciliation is that a classifier's inspectable
  output **is** its `probabilities`/`confidence`, and an image call's **is** its file metadata; the owner
  chose input-privacy over input-transparency, and the design's job is to make metadata-only
  *sufficient* for diagnosis — which it is not today unless the engine records the facts pi-ai discards
  (§1, O-1/O-2).
- *Replaceability (agent):* applies in full — "GPT↔Claude↔local is a config change" is literally
  `meta.params.decisions.<label>.model.default`, and the owner's Won't list (Cloudflare / llama.cpp
  classifier providers) is exactly the next adapter.
- *Consumability (agent):* applies in full — V40-Q3 says agents write these calls, so the typed I/O +
  guide **are** the SDK.
- *Self-sustainability (agent):* memory metabolism is **N/A** (nothing accumulates across calls — flagged
  as a negative so no round re-spends budget on it); tool-liveness and bounded retry apply.

System altitude applies throughout: catalog, IPC, budget, resume journal, config wiring, dashboard.

## Summary

The owner's intent for all eleven requirements is sound and I do not re-open any V40 ruling. Four
findings change *how* Gate 2 must realize them, and one changes a requirement's stated premise:

1. **REQ-225's tier 1 ("先用 provider 回報 usage.cost") has no implementation in pi-ai 1.0.0.** Both
   `parseUsage` functions compute `usage.cost` from pi-ai's *own static snapshot* price
   (`system-one-shared.js` → `calculateCost(model, usage)`; `openrouter-images.js` → `(model.cost.input /
   1e6) * input` …), never from anything OpenRouter returned. 37 of the 57 image rows in that snapshot
   carry `cost: {0,0,0,0}` (`providers/data/openrouter.json`, counted), so trusting `usage.cost` would
   price 37 models as *known $0* — the exact v31/v32 "未量到的用量是缺席,不是零" violation REQ-225 itself
   cites. The owner's precedence (reported > estimated > refuse/absent) stands; only the **source
   mapping** needs correcting at Gate 2: "reported" can only mean a cost field the engine itself reads
   off the wire (unverifiable without a paid call — design so nothing depends on it), "estimated" means
   the engine's ModelBook pin, and pi-ai's `usage.cost` is used for nothing.
2. **One seam serves three dimensions.** pi-ai returns failure as `stopReason:'error'` + a *string*
   `errorMessage` (`formatProviderError(normalizeProviderError(error))`); the HTTP status survives only
   inside that string, and `onResponse` fires only on success. An engine-owned `fetch` wrapper passed via
   `ProviderRequestOptions.fetch` (`types.d.ts:62-67`; both call paths forward it) recovers status,
   `retry-after`, wall-clock provider latency and the raw body. That is the observable seam (REQ-227's
   429/5xx discrimination, REQ-230 measurable in production), the replaceability seam (no regex over a
   vendor message), and the only place a genuinely *reported* cost could ever be read.
3. **The engine must own the retry loop.** pi-ai retries internally: classify defaults to `maxRetries ??
   2`, generateImages to `0` (`retryProviderRequest`'s `options.maxRetries ?? 0`), and its retryable set
   (`x-should-retry` header, undefined status, 408/409/429/≥500 — `provider-retry.js`) differs from
   REQ-227's (429/5xx/timeout only). Unless the engine passes `maxRetries: 0` and loops itself, REQ-227's
   "每次重試…都出現在事件 log" is unimplementable and the p95 the owner cares about hides up to three
   silent attempts.
4. **Two seams the as-is map found but did not connect to REQ-223/225:** `reachableModels` pins only
   `params.model` and `agents[*].model` (`model-book.ts:194-197`), and `toModelCatalogSnapshot` drops
   `modelType` before `checkModelRef` sees a row (`:210-227`). The pre-flight price check and the type
   check have nothing to read until the admission pin covers `decisions.*`/`images.*` and carries type.
5. **Journal key as digest.** `CallKey.prompt` is the raw prompt and `sameKey` compares it byte-for-byte
   (`resume-cache.ts:13-15`); a decide keyed on raw `state` puts the very string REQ-229 forbids into
   `journal.jsonl`. `run-manager.ts:2938-2940` already names the fix as "Future option, not built:
   persist a keyHash". v40 is where it stops being future.

The load-bearing recommendation is #2 + #3 together: **own the HTTP boundary, own the retry loop.**
Everything in §1 and §4 either follows from it or is impossible without it.

## 1. Observability

### System altitude

- **O-1 — the `fetch` seam.** Both pi-ai call paths accept `options.fetch` and use it for the actual
  request (`system-one-shared.js`: `const requestFetch = options.fetch ?? globalThis.fetch`;
  `openrouter-images.js`: `createClient(model, apiKey, headers, fetch)` → `new OpenAI({fetch})`). An
  engine wrapper records per attempt: `t0/t1` (→ `providerMs`), `response.status`, `retry-after`,
  request/response byte counts, and — via `response.clone().json()` — the raw body so any `usage.cost`
  OpenRouter does return can be read. This is the ONLY faithful source for three things the
  requirements need: the status class for REQ-227 (pi-ai's `errorMessage` is `"System One API error
  (429): <body>"` — parseable only by regex), `providerMs` for REQ-230's "(script 端耗時 − provider 端耗
  時)" — which the wrapper makes a *production* metric (`engineOverheadMs = totalMs − Σ providerMs`),
  not just a stub-test quantity — and the wire-level cost for REQ-225 tier 1. **Design:** `src/direct-
  models/observed-fetch.ts`, pure, injectable, unit-tested without pi-ai.
- **O-2 — per-attempt events require engine-owned retries.** With `maxRetries: 0` passed to pi-ai, each
  attempt is one wrapper observation and one engine event. REQ-227's acceptance ("每次重試與最終失敗都
  出現在事件 log") is then a direct consequence of the loop, not a separate feature. Also required for
  REQ-230: pi-ai's internal backoff (`0.5·2^i`s capped 8s, or server `retry-after` up to 60s —
  `provider-retry.js` `DEFAULT_MAX_RETRY_DELAY_MS`) would otherwise sit *inside* "provider time" and
  make the p95 meaningless.
- **O-3 — the event shape.** `EngineEvent` is a closed union by design ("a v37 kind is a v37 edit",
  `event-log.ts:1-4`); add ONE kind, `primitive.call`, not two, with a `primitive: 'decide' | 'image'`
  discriminator:
  `{kind:'primitive.call', runId, callSeq, primitive, label, model, attempt, outcome:'ok'|'retry'|
  'failed'|'refused', status?, errorCode?, providerMs, engineMs, tokens?, costUSD: number|null,
  costSource:'reported'|'estimated'|'absent', answers? (decide, the typed answers object), files?
  (image, `[{path, mimeType, bytes, sha256}]`)}`. Never `state`, `questions.instructions`, `prompt`,
  or input-image bytes/paths' content. It rides `createEventSink`'s redaction like every other kind.
  The REQ-229 sentinel test is then a property of the type, not of discipline at eight emit sites.
  **One more leak path the type alone does not close:** pi-ai's `errorMessage` embeds up to 4000 chars
  of the provider's error *body* (`error-body.js` `MAX_PROVIDER_ERROR_BODY_CHARS`), and a 400
  validation body can echo request fields — i.e. `state`. Provider error bodies are therefore untrusted
  for privacy: the O-3 event, `PRIMITIVE_FAILED`'s script-facing message, and the refusals ledger
  (`captureFailure`, `run-manager.ts:2952-2958`) carry `status` + a bounded, body-free message; the raw
  body goes nowhere durable — the same posture `agent.stderr` takes (bounded tail, redacted,
  failure-only).
- **O-4 — journal key as digest.** `CallKey.prompt := 'decide:' + sha256(canonicalJSON({state,
  questions}))` and `'image:' + sha256(canonicalJSON({prompt, inputImages:[{path, sha256}]}))`, `opts`
  := the per-call tunables actually applied (model, timeoutMs, retries). `sameKey` works unchanged on
  a digest; REQ-226 equality holds; REQ-229's at-rest constraint holds for `journal.jsonl`; the
  DES-088 caveat (a redacted key MISSes on hard-crash resume) disappears for these two primitives
  because a digest has nothing to redact. Input-image sha256s in the key make "same path, different
  bytes" a MISS — the correct answer.
- **O-5 — the at-rest record.** Persist one `kind:'usage'` transcript event per settled call (the
  shape `foldUsage` reads, `run-guard.ts:47+`) with `tokens` (System One returns
  `input_tokens`/`output_tokens`; images return completions `usage`), `costUSD`, `unpriced`, plus a
  `primitive` field — so the resume-time fold (`run-manager.ts:2058-2067`) re-arms the USD limit with
  decide/image spend included (REQ-225 "計入 run 用量"), and `deriveAgentRecords` reconstructs a record
  after a restart. **No `kind:'message'` events** for these calls (that is where an agent's prompt lives
  today and the only transcript route by which `state` could reach `run_agent_log`). Add
  `AgentRecord.kind?: 'agent'|'decide'|'image'` (absent = agent, same "absent, never defaulted"
  convention as `agentKey`, `types.ts:266-296`). `buildDagModel` groups `view.agents` by frame
  (`dashboard.ts:57-85`), so decide/image nodes appear in the swimlane for free — desirable — while
  `WorkflowMetrics` folds per *run* (`:132-181`), so home-card success/avg-duration do **not** inflate.
  What does change: `run_status.agents[]` and the agent slide-in panel (REQ-135's six cards assume a
  harness) — the `kind` field is what lets those consumers filter (see C-6).
- **O-6 — observed stats.** `loadFacts` buckets by `kind: descriptorTools.length > 0 ? 'tools' :
  'prose'` (`observed-stats.ts:171-176`); a decide record has no harness event and would land in
  `prose`, mixing 200ms classifier latencies into chat statistics — the thing REQ-225's last clause
  forbids. Add `'decide' | 'image'` to `AgentCallFact.kind`, read from the record's `kind` (O-5), and
  give `ObservedForRef` matching buckets; a decision model's row in `models_list` then shows *its*
  success rate and p95, which is the only "calibration" signal an author has for picking one.
- **O-7 — make the type check and the price check able to see.** (a) `reachableModels` must include
  `decisions[*].model` and `images[*].model` so the admission pin (`run-manager.ts:1260-1266`) holds
  their price and type; (b) `toModelCatalogSnapshot` must carry `modelType`+`modelTypeSource` through
  (`model-book.ts:210-227`) so `checkModelRef`'s successor can return the REQ-223 verdict. (c) The
  warning arm already exists in shape (`providers.ts:189-197` returns `{ok:true, warning}`); REQ-223's
  `unknown`/`id-heuristic` → "放行並附警告" reuses it, and the warning must name label, model, type and
  `modelTypeSource` so a cold client can see *why* it was not refused. (d) Add `image_output` to
  `openRouterPricingDetail`/`ratesFromOpenRouterPricing` (`model-catalog.ts:240, 378-394` — today
  `image` there is the *input*-image price) so an image model's estimate exists at all.
- **O-8 — gauges and the Gate 7.5 ledger.** Two new `createSemaphore` instances (REQ-228) expose
  `gauge()` exactly like `agentSemaphore` on `/api/status` (`server.ts:1659-1665`) and in
  `system_info`'s engine section. V40-Q19 requires the real-tier spend to be *recorded*: the
  `primitive.call` events with `costUSD`/`costSource` ARE that record — the validation gate sums them,
  no side ledger.

### Agent altitude

Per-call inspectability without inputs: O-3's `answers` (choice → `{choice, probabilities,
confidence}`, score → `{score, confidence}`, bool → `{probability}`) is the classifier's whole
reasoning surface and the owner asked for it in the log (V40-Q11 "答案"). Token usage: both paths
report tokens, O-5 records them. "Tool-call sequence" is N/A — there is none. The one agent-altitude
gap worth naming: when a `decide()` fails after retries, the script gets a named error, but the
*operator* must be able to answer "which status, how many attempts, how long each" from the events
alone — O-1/O-2 are what make a `primitive.call failed` line sufficient without ever logging `state`.

## 2. Replaceability

### System altitude

- **R-1 — an engine-owned port, pi-ai behind it.** `GatewayClient` is a chat-session port
  (`invoke({prompt, opts, …})`, `gateway/client.ts:248-285`) and does not fit; the as-is map rightly
  says bypass it. But "call pi-ai directly from `_handleDecideRequest`" re-creates the coupling the
  gateway abstraction exists to avoid. **Design:** `src/direct-models/port.ts` with
  `DecisionBackend { classify(req: DecideRequest, io: BackendIO): Promise<DecideOutcome> }` and
  `ImageBackend { generate(req: ImageRequest, io): Promise<ImageOutcome> }`, engine-owned request /
  outcome types; `src/direct-models/pi-ai-backend.ts` is the one adapter. The stub backend REQ-228
  ("以 stub provider 計數證明") and REQ-230 ("provider 以固定延遲回應的 stub") both *require* is then a
  second implementation of the same port — the port is not speculative abstraction, it is the test seam
  the acceptance criteria already demand.
- **R-2 — one catalog of record; build the pi-ai model object from it.** `getModelOfType('classifier',
  'openrouter', id)` reads pi-ai's frozen snapshot (9 classifiers, 57 images at 1.0.0). `BaseModel`
  needs only `id, name, api, provider, baseUrl, input, cost` (`types.d.ts:900-911`); `ClassifierModel`
  adds `contextWindow`, `ImageModel` adds `output` (`:936-945`). The adapter can construct that object
  from the engine's own ModelBook row (`contextWindow`, `modalities.in/out` already present —
  `model-catalog.ts:409-470`) with `api` chosen by an adapter-owned map (`decision → 'typesafe-system-
  one'`, `image-gen → 'openrouter-images'`), `baseUrl = 'https://openrouter.ai/api/v1'`, `cost` zeroed
  (pi-ai's cost is ignored per Summary #1), and call `classify`/`generateImages` from
  `@earendil-works/pi-ai/api/*` directly (exported subpath, Gate 0 §9). Result: a classifier OpenRouter
  lists live but pi-ai's snapshot lacks still works; REQ-222's `?output_modalities=all` listing and the
  executable set are the same set. **What is lost and must move to config:** the snapshot's
  `inputLimits.images.resize.maxBytes` (4718592 on the image rows) — REQ-221's size cap must be an
  engine config key, not inherited.
- **R-3 — vocabulary stays engine-owned at the boundary.** pi-ai: `'classifier' | 'image'`
  (`types.d.ts:947-953`); engine: `'decision' | 'image-gen'` (REQ-222, extending `ModelType` at
  `model-catalog.ts:26` and the `models_list` enum at `tool-specs.ts:1528`). The adapter maps; nothing
  outside `src/direct-models/` imports a pi-ai type. Same for results: `DecideResult`/`ImageResult` are
  engine types that *mirror* `ClassifierAnswer`/`ImageContent` today, so a pi-ai 2.0 rename reaches one
  adapter file, never a registered script.
- **R-4 — key resolution shared, not re-typed.** `resolveOpenrouterKey` is module-private in
  `pi-gateway-client.ts:528-530`; lift it to `src/gateway/openrouter-key.ts` and pass `apiKey`
  explicitly (`ProviderRequestOptions.apiKey`). Never pi-ai's `env?: ProviderEnv` or any credential
  discovery of its own (V40-Q6: 走同一把 key, 不新增 secret).
- **R-5 — independent of `GatewayChoice`, dependent on the engine's primitives.** The primitives must
  work under `gateway:"sdk"` (production) where `PiGatewayClient` does not exist (REQ-220 "不論 gateway
  設為 sdk 或 pi"). They reuse, not reimplement: `createSemaphore` (`agent-semaphore.ts`), `codedError`/
  `ERROR_CATALOG`, `redact`, `isPathContained`, `RunGuard.assertBudget/addUsage`, the journal site.
- **R-6 — retry policy decoupled from a vendor's.** pi-ai's `isRetryableProviderError` "mirrors the
  pinned OpenAI/Anthropic SDK retry policy; review when either SDK is upgraded" (its own comment). With
  `maxRetries: 0` the engine's REQ-227 policy (429/5xx/timeout, caller-set count) cannot drift when
  pi-ai or the SDK it mirrors changes.
- **R-7 — price source decoupled from the snapshot.** `FourRates` is token-only (`types.ts:176-181`,
  `priceCall` `run-guard.ts:23`); image models price per output image. Add an optional
  `perImage?: number` column (absent ≠ 0, same rule as `rates: null`) and a `priceImageCall(n, rates)`
  beside `priceCall`. Precedence per call: (1) wire-reported cost read by O-1's wrapper, if the body has
  one; (2) ModelBook pin estimate (tokens × rates, or images × perImage), flagged `estimated`; (3)
  `absent` → `unpriced` (REQ-225 clause 4) or, with a USD budget armed, pre-flight refusal
  `PRICE_UNKNOWN` before the provider is called (clause 3).

### Agent altitude

Backend swap is a config change by construction: the model is `meta.params.decisions.<label>.model.
default`, overridable per run within the contract (REQ-091/110 machinery, unchanged). The Won't-listed
Cloudflare / llama.cpp classifiers are pi-ai apis (`cloudflare-workers-ai-system-one`, `llama-cpp-
classify` exist in `dist/api/`) — a later round adds a `provider → api` row to R-2's map and a key
resolver; the script contract does not move. Scripts never see pi-ai's `noul` wire type (pi-ai hides it;
the engine keeps `bool`).

## 3. Consumability

### System altitude

- **C-1 — a declaration type of its own.** `AgentParamSpec` requires `effort` and allows `appendPrompt`/
  `skills`/`mcp` (`params/contract.ts:62-69`); none applies here. Define `PrimitiveParamSpec = {model,
  timeoutMs, retries}` (each required with `.default`, per V40-Q14), `ParamContract.decisions?` /
  `.images?`, and `parsePrimitiveContract` with the same two refusals as agents (undeclared label /
  declared-not-used), under their own names (`DECISION_UNDECLARED`, `IMAGE_UNDECLARED`, …) rather than
  reusing `AGENT_UNDECLARED` with a `kind` detail — a cold client reading an error must not have to
  read `detail` to learn which primitive it misdeclared. Static side: `scanPrimitiveCalls` with the same
  literal-label + literal-options rule as `scanAgentCalls`; `CALLABLE_API_NAMES` gains both names
  (`script-checks.ts:96`, REQ-224's alias refusal); `SANDBOX_GLOBALS` gains both (`guards.ts:90`) and the
  guide's sandbox-API sentence updates itself (`authoring-guide.ts:842`).
- **C-2 — the error vocabulary, in one place.** New `ERROR_CATALOG` keys, each with `see:
  'workflow_authoring_guide'`: `MODEL_TYPE_MISMATCH` (register, REQ-223 — message names label, model,
  its type, the type required), `DECISION_UNDECLARED` / `DECISION_DECLARED_NOT_IN_SCRIPT` and the
  `IMAGE_*` pair (C-1), `DECIDE_QUESTIONS_INVALID` (pre-flight schema), `DECIDE_STATE_TOO_LARGE`,
  `IMAGE_INPUT_ESCAPE` (or reuse `WorkspaceEscapeError`'s code, `errors.ts:550`), `IMAGE_INPUT_TOO_LARGE`,
  `IMAGE_NO_OUTPUT` (stopReason `stop` with zero image blocks — real for text-capable image models),
  `PRICE_UNKNOWN` (REQ-225 clause 3), `PRIMITIVE_FAILED` with `detail: {primitive, status, attempts,
  retryable}` (REQ-227 terminal), and `BUDGET_EXCEEDED` reused as-is (REQ-225 clause 5, "與 agent 相
  同"). Which of these fold to `null` inside `parallel()`/`pipeline()` vs re-throw is decided ONCE and
  written into all three sets — `guards.ts` `ENGINE_REFUSAL_CODES`, `run-manager.ts` `RECORDED_REFUSAL_
  CODES` (`:451`), `errors.ts` — with `tests/unit/sandbox-refusal-provenance.test.ts` already pinning
  the first two equal. Recommendation: `BUDGET_EXCEEDED`, `PRICE_UNKNOWN`, `MODEL_TYPE_MISMATCH` are
  *engine refusals* (fold); `PRIMITIVE_FAILED` is a *provider outcome* (re-throw so the script can
  degrade, REQ-227's own words).
- **C-3 — `models_list` grows, and that is fine.** `?output_modalities=all` lifts the OpenRouter listing
  from 459 to 662 rows (Gate 0 §0.1). `models-query.ts` pages by `limit` (clamped, `:146`) AND by
  `PAGE_BYTE_BUDGET` (`:8-9`) with a cursor, so REQ-210's response-size contract holds — more pages, no
  cliff. The schema text at `tool-specs.ts:1528` ("Use 'chat' for agent() models") must become "'chat'
  for agent(), 'decision' for decide(), 'image-gen' for generateImage()", and the enum gains
  `'decision'`.
- **C-4 — every explain surface shows the new contract.** `workflow_describe`/`workflow_get` project
  `params.agents` (`workflow-view.ts:204, 336`); they must project `decisions`/`images` the same way,
  or a user who may run-but-not-read (REQ-100/101) cannot see what a decide label accepts. The guide's
  worked `decide` example must be one that registers — REQ-209's "印出來的範例必須是真的註冊得過的" test
  already exists; the new examples join it, not a prose promise.
- **C-5 — config keys through the known-key list and `composeConfig`.** `decideSlots`, `imageSlots`
  (mirroring `agentSlots`), `imageInputMaxBytes`, `decideStateMaxBytes` go into `KNOWN_FILE_CONFIG_KEYS`
  (`main.ts:145`) and are forwarded in `composeConfig` (`:347`, `:595-630`). This is the thrice-bitten
  bug class (`:610-616`'s own comment); UT-219 (`tests/unit/compose-config-v2-wiring.test.ts`) "sweeps
  the whole key list", so a key added to the list but not forwarded fails a test — the implementer
  should rely on that, and the design should say so.
- **C-6 — `run_status.agents[]` consumers.** With O-5's `kind`, a consumer that today assumes every
  entry has a harness can filter; without it, the agent slide-in panel (REQ-135/166's six cards) renders
  empty tool/MCP/skill columns for a decide node. The dashboard needs a `kind`-aware panel variant
  (model, latency, cost, answers summary / file list) — small, but it is a consumability regression if
  skipped.

### Agent altitude

The SDK is the typed I/O plus the guide:
- `await decide(label, {state, questions})` → `{answers: Record<id, Answer>, model: string, latencyMs:
  number}`; `questions` validated **pre-flight** against an engine JSON schema (choice/score/bool,
  `instructions`, `criteria` shapes — `types.d.ts:448-466`) so a cold agent gets `DECIDE_QUESTIONS_
  INVALID` naming the question id and field, not a provider 400 string after a network round-trip.
  The guide must show the bool idiom (`answers.order.probability >= 0.7`) because REQ-220 returns a
  probability, not a boolean, and a cold author will otherwise write `if (answers.order)`.
- `await generateImage(label, {prompt, inputImages?, outDir?})` → `{files: [{path, mimeType, bytes,
  sha256}], text?: string}` — `sha256` so a consumer can verify against `workspace_list` without a
  second read; `text` because text-capable image models (e.g. `google/gemini-2.5-flash-image`, `output:
  ['image','text']`) return text blocks pi-ai preserves (`openrouter-images.js` pushes both). Paths are
  workspace-relative in and out (V40-Q15). `state` crosses IPC child→host (fine, small); image bytes
  never do (host writes the file, V40-Q4).
- REQ-224's cold-client acceptance ("一個只讀過 guide 的冷客端 agent 能寫出一次註冊成功的 decide workflow")
  is the acceptance test of this entire dimension; nothing here should be judged by review alone.

## 4. Self-sustainability

### System altitude

- **S-1 — the engine retry loop, bounded.** `maxRetries: 0` to pi-ai; engine loop up to `retries`
  (declared default, run-overridable — REQ-227); retry only on wrapper-observed 429/≥500/timeout
  (`AbortSignal.timeout(timeoutMs)` composed with the run's abort via `AbortSignal.any`, exactly as
  `system-one-shared.js` does internally — suspend/stop cancels an in-flight call, D-F9a); honour
  `retry-after` but cap backoff (e.g. `min(retryAfter, 5s)`, config) so one 60-second server hint
  cannot hold a semaphore slot for a minute under V40-Q5's per-DM load; every attempt emits O-3's event.
- **S-2 — refuse before you call.** Four pre-flight checks that spend nothing: price-known (REQ-225
  clause 3), `state` size vs `decideStateMaxBytes` (default derived from the row's `contextWindow`,
  32000 for jev), `inputImages` containment (`isPathContained` + realpath, REQ-221) and size vs
  `imageInputMaxBytes`, and the `BUDGET_EXCEEDED` door (`RunGuard.assertBudget`, the one door —
  `run-guard.ts:266-272`). Each is a named refusal (C-2), each is an O-3 `outcome:'refused'` event.
- **S-3 — two more semaphores, same semantics.** `createSemaphore(decideSlots)` / `(imageSlots)`
  (REQ-228: 不佔 agent semaphore); `acquireSlot` *queues* at the cap rather than refusing
  (`run-guard.ts:177`) — keep that for the primitives, so a burst of webhook runs degrades to latency,
  not to failures. Note the per-run `RunGuard.concurrency` slot is a *separate* cap: decide calls should
  **not** take a per-run agent slot either (REQ-228's intent extends to it), so `_handleDecideRequest`
  calls `assertBudget` without `acquireSlot`. Gauges per O-8.
- **S-4 — resume that verifies, and writes that cannot half-succeed.** `Plan.replay(callSeq, key)` has
  no value-validation hook (`resume-cache.ts:30-38`); REQ-226's "圖檔不在 → 視為未命中" needs
  `replay(callSeq, key, validate?: (value) => boolean)` where the image validator checks existence AND
  sha256 of every `files[i]`, then sets `_missed` exactly as a key mismatch does (the existing
  "first miss → all miss" rule, V40-Q18). Write images to `<path>.tmp` and `rename` — a crash mid-write
  then leaves a sha mismatch (→ MISS, regenerate), never a plausible-looking truncated file served as a
  hit. Workspace growth from images is already covered by REQ-026 TTL GC.
- **S-5 — catalog degradation stays graceful.** Switching to `?output_modalities=all` is still one
  fetch; `ModelBook` keeps last-good on failure (`model-book.ts:105-136`), and REQ-223's
  `unknown`→warn rule means a catalog outage can never *block* registration of a decide workflow —
  only downgrade it to a warning. That is the right fail posture for a registration door.
- **S-6 — a per-model breaker (bounded, config-off).** Under V40-Q5 (每則私訊一個 run) a provider outage
  becomes N runs × `retries` × backoff, all queued on one semaphore, each ending in `PRIMITIVE_FAILED`
  after the maximum delay. A breaker keyed on `provider/model` for primitives only (open after K
  consecutive retryable failures in a window, half-open probe, `PROVIDER_CIRCUIT_OPEN` + an event) makes
  the failure fast and the fallback (`try/catch` → `agent()`, REQ-227's own "降級") immediate. I
  propose it as a small module, default off, and list it under expected disagreements rather than
  letting it dominate — S-1's capped backoff is the uncontroversial half.

### Agent altitude

- **Memory metabolism: N/A.** Nothing accumulates across calls; the journal grows by one digest+answer
  entry per call, bounded by the run.
- **Tool-liveness.** `models_probe` exists for chat (`tool-specs.ts:1564`, `toolUseVerified`). A decision
  probe is cheap (jev: $0.042/M input); an image probe is not. Owner ruled "不做 recommend/uptime" at
  #104, so: no periodic prober for these types; an *admin-manual* `models_probe({modelType:'decision'})`
  is defensible and I would accept its deferral. The breaker (S-6) is the runtime liveness signal if
  the owner takes it.
- **Self-calibration.** The analogue here is O-6: per-decision-model observed success/latency on its
  `models_list` row, so authors (agents, per V40-Q3) pick a model that is *measured* to work. No prompt
  calibration applies — there is no prompt.
- **Budget overshoot bound.** The "stop-dispatching, overshoot ≤ concurrency × one call" rule
  (`run-guard.ts` header) holds; decide calls are small, image calls are the ones to watch —
  `imageSlots` default should be low (2–4).

## Key points (ranked)

1. **Own the HTTP boundary (O-1) and the retry loop (O-2/S-1):** `options.fetch` wrapper + `maxRetries:
   0`. Without both, REQ-227's per-retry events and REQ-230's measurement are not implementable.
2. **Correct REQ-225's tier-1 source** (Summary #1): pi-ai `usage.cost` is a snapshot estimate (37/57
   image rows zero); "reported" = wire body via O-1 only; "estimated" = ModelBook pin with a new
   `perImage` column (R-7); never $0 for unknown.
3. **Extend the admission pin and carry `modelType`** (O-7): `reachableModels` + `toModelCatalogSnapshot`
   are the two seams REQ-223/225 silently depend on.
4. **Journal key as digest** (O-4): the only design under which REQ-226 and REQ-229 are both true.
5. **Engine-owned port with a pi-ai adapter** (R-1..R-3); build the pi-ai model object from the engine's
   catalog, not pi-ai's snapshot (R-2); vocabulary mapped at the adapter.
6. **One `primitive.call` event kind** through the redacting sink (O-3); `AgentRecord.kind` + `usage`
   event per call (O-5); own observed-stats buckets (O-6).
7. **Resume `validate` hook + atomic file writes** (S-4).
8. **Named pre-flight refusals before any provider call** (S-2, C-2), with the three refusal sets and
   their drift test updated in one commit.
9. **Config keys via `KNOWN_FILE_CONFIG_KEYS` + `composeConfig`, relying on UT-219's sweep** (C-5);
   gauges on `/api/status` (O-8).
10. **Separate `PrimitiveParamSpec`, own error names, explain surfaces updated, guide example that
    registers** (C-1, C-4).

## Risks

- **Unverified wire behaviour of `/systemone`** (Gate 0 "Unknowns"): whether its body carries any cost
  field, and whether OpenRouter's error bodies/`retry-after` arrive as the wrapper assumes. Mitigation:
  precedence (R-7) never *requires* tier 1; Gate 7.5's US$1 real-tier budget (V40-Q19) exercises jev +
  one cheap image model and the events record what actually came back.
- **Image pricing semantics.** OpenRouter prices FLUX by `pricing.image_output` (Gate 0 §0.4); whether
  every image row uses that field, and whether text-capable image models bill tokens *and* images, is
  not known. `perImage` + token rates together, with `estimated` flagged, is the honest shape; a wrong
  estimate is still better labelled than a confident zero.
- **Constructing pi-ai model objects (R-2) against pi-ai's typed `api` unions.** `ClassifierApi`/
  `ImageApi` are closed string unions; the adapter must satisfy them exactly and a pi-ai minor bump
  could tighten `BaseModel`. Pin pi-ai (already `1.0.0` exact) and cover the adapter with a
  construct-and-call test against the stub backend.
- **`AgentRecord` reuse** (O-5): swimlane, `run_status.agents[]`, slide-in panel, `run_agent_log`
  consumers all see new `kind`s. Run-level metrics do not inflate (verified, `dashboard.ts:132-181`),
  but any fold I did not read (`src/dashboard/ui` was not read by Gate 0 either) might assume harness
  fields. A fold audit belongs in Gate 3 tasks.
- **Catalog growth** (C-3): 459→662 rows is paginated, but any consumer that calls `models_list` with
  no filter and iterates to exhaustion now does ~45% more pages. Documented, not blocking.
- **Breaker scope creep** (S-6): if accepted, it must be config-off and primitives-only, or it becomes
  the uptime feature the owner declined at #104.
- **IPC payload**: no explicit per-call cap on `agentResult` values (Gate 0 §1). `answers` are small;
  `files[]` metadata is small; the risk is a future "return the text block too" growing unbounded —
  cap `text` at a few KB in the host.

## Expected disagreements with other lenses

- **Adversarial / security lens** will push harder than I do on `inputImages` containment (symlink
  races, realpath at open time, not at check time) and on writing generated images into the
  git-baselined workspace (diff noise, `workspace-git.ts:47`). I agree with both and defer to them on
  mechanism. They may question putting `answers` into the event log at all (an answer derived from
  private `state` can be sensitive); the owner asked for it explicitly (V40-Q11 "答案"), so I keep it
  and expect the ruling to stand.
- **Simplicity / performance lens** will call owning the retry loop YAGNI ("pi-ai already retries") and
  the `DecisionBackend` port speculative. Counter: REQ-227's per-attempt events are *impossible* with
  pi-ai's internal loop, and REQ-228/230's stub providers *are* a second port implementation — the
  abstraction is paid for by the acceptance criteria, not by future hopes. They may also prefer regexing
  the status out of `errorMessage`; that couples the engine to a vendor's display-string format.
- **Catalog / data lens** may prefer `getModelOfType` from pi-ai's snapshot for simplicity. Counter: two
  catalogs of record (ModelBook live vs a frozen 9/57-row snapshot), 37 zero-cost rows, and a type
  vocabulary mismatch — the engine already has every field `BaseModel` needs.
- **Dashboard / UX lens** may want a distinct node type rather than `AgentRecord.kind`. I prefer the
  discriminator because `buildDagModel`/`run_status` consumers get swimlane placement for free; the
  cost is the panel variant in C-6, which they would own either way.
- **Owner-level**: the breaker (S-6) and the manual decision probe (agent-altitude S) sit near the
  "no uptime/recommend" ruling (#104). I present both as optional and config-off; if either is
  declined, nothing else in this proposal depends on them.
