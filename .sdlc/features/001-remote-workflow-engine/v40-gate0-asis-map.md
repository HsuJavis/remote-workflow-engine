# Gate 0 as-is map — non-chat model primitives (`decide()` via pi-ai `classify`, `image()` via pi-ai `generateImages`)

Repo: /home/user/Documents/remote-workflow (HEAD 526db75 lineage). Read-only survey 2026-10-13. No files modified.
Paths are relative to the repo root unless absolute.

## 0. Headline blockers (evidence-backed)

1. **Registration refuses these model ids today (hard gate, not a warning).** `fetchOpenRouter` calls
   `https://openrouter.ai/api/v1/models` with NO query (`src/models/model-catalog.ts:410`). Live probe
   (2026-10-13): the default listing returns 459 rows and does **not** contain `typesafe/jev-1.13`,
   `respan/span-01`, `inception/mercury-decide`, or any FLUX/Seedream image-only row. They appear only
   under `?output_modalities=all` (662 rows) / `?output_modalities=image` (61 rows). Because openrouter
   rows exist and `source:'live'`, `checkModelRef` takes the "found?" arm and returns `UNKNOWN_MODEL`
   (`src/providers.ts:198-208`), raised through `checkModelRefOrErr` (`src/params/contract.ts:163-176`)
   from `validateOneAgentSpec` (`contract.ts:359`, enum `:365`). Same check at admission
   (`run-manager.ts:1207` → `_refuseUnadmittableParams` `:2322`), resume (`:2037`), nested (`:2606`).
2. **Classifier rows have no modelType.** OpenRouter reports `architecture.output_modalities:['decisions']`
   (`modality:'text->decisions'`). `openRouterModelType` (`model-catalog.ts:366-375`) has no branch for it →
   id heuristic → `'unknown'`. Engine `ModelType` union (`model-catalog.ts:26`) and the models_list enum
   (`src/tool-specs.ts:1528`) have no `classifier` value. Image-only rows → `'image-gen'` (`:371`);
   image+text rows (e.g. `google/gemini-2.5-flash-image`) → `'chat'` (`:369`).
3. **No modelType check exists anywhere at registration/admission — confirmed negative.** `modelType` is
   referenced only in `src/models/model-catalog.ts`, `src/models/models-query.ts` (filter `:92`),
   `src/tool-specs.ts`, `src/authoring-guide.ts`. `contract.ts`, `providers.ts`, `run-manager.ts`,
   `workflow-catalog.ts` never read it. "Only 'chat' models can drive an agent() call"
   (`tool-specs.ts:1461`, `authoring-guide.ts:1354`) is documentation, not enforcement.
4. **Two catalogs, two price sources.** pi-ai's `classify()` / `generateImages()` need a pi-ai model
   object (`ClassifierModel` / `ImageModel`: api, baseUrl, cost, ...), which comes from pi-ai's own
   static snapshot (`node_modules/@earendil-works/pi-ai/dist/providers/data/openrouter.json`). The
   engine's catalog of record is `ModelBook` (OpenRouter live). In pi-ai's snapshot, 37 of 57 image rows
   have cost all-zero. OpenRouter prices FLUX by `pricing.image_output` (e.g. flux.2-pro
   `image_output: 7.32e-6`, prompt/completion 0). Neither `ratesFromOpenRouterPricing` nor
   `openRouterPricingDetail` (`model-catalog.ts:240`, `:378-394`; the latter keeps `image` = input-image,
   not `image_output`) captures it. `priceCall` (`src/run-guard.ts:23`) is four-column token-rate based, so
   image calls would come out `unpriced`.

## 1. Full path of an `agent()` call, and where a sibling plugs in

**Child (sandbox process)** — `src/sandbox/child-entry.ts`
- Run by `node --experimental-transform-types` and excluded from tsconfig (`tsconfig.json` exclude). Its
  local imports use literal `.ts` extensions (`:7-18`).
- One shared `nextCallSeq` counter (`:59`) with two pending maps, `pendingAgent` and `pendingWorkflow`
  (`:60-61`).
- `api.agent` (`:250-262`) → `trySend({t:'agent', runId, callSeq, prompt, opts})`. A send failure rejects
  that one call with `RESULT_NOT_SERIALIZABLE`.
- Inbound `agentResult` (`:178-185`) updates `spentSoFar` and resolves. `agentThrow` (`:186-206`) looks the
  callSeq up in BOTH maps, builds an Error with `code` and `name`, calls `markEngineRefusal`, then rejects.
- **Plug-in:** add `api.decide` / `api.image`, either sharing `pendingAgent` or adding a new map. A new map
  must also join the `agentThrow` lookup at `:190`. The result message can reuse `agentResult` (it already
  carries `spent`) or add a new `t`. Keep everything inlined; no new local value imports.
- Return-size cap: only the FINAL script result is capped (10 MiB, `:72`). No cap was found on per-call
  `agentResult` values, so image bytes must not travel over IPC.

**Realm hardening** — `src/sandbox/guards.ts`
- Rules every new global must follow:
  - Build the exposed function with `wrap()` (`makeWrap` `:455-461`; context-native function).
  - Wrap the returned promise with `toCtxPromise(CtxPromise, …)` (`:475-479`).
  - Re-realm results with `reRealm` (`makeReRealm` `:192`).
  - Sanitize host errors with `sanitizeThrownError(CtxError, err)` (`:169`).
  - Template to copy: `makeAgent` (`:600-614`).
  - Register the global in the `Object.assign(sandbox, {...})` block (`:741-753`).
- `SandboxApi` interface (`:69-80`): add optional `decide?` / `image?`.
- `SANDBOX_GLOBALS` (`:90`) is data the authoring guide renders (`src/authoring-guide.ts:842`). Add new
  names there.
- `ENGINE_REFUSAL_CODES` (`:356`) is an inlined Set that decides whether parallel()/pipeline() re-throw or
  null-fold. Any new refusal code (e.g. a model-type refusal) must be added.
- `DETERMINISM_GUARDED[].why` (`:105`) describes agent() replay specifically. Its wording should
  generalize.
- **Value-import ban:** header note at `:7-13` and `:84-89`: guards.ts is loaded by the child (no
  `.js`→`.ts` resolution) AND type-checked by tsc, so it can take only type imports
  (`import type { Budget }`, `:5`). The same constraint applies to child-entry.ts (`:21-25` inlines
  `ZERO_SPEND`). This matches the memory note rwe-sandbox-child-ts-imports.

**IPC types** — `src/ipc/protocol.ts:5-28` holds pure discriminated unions (`ChildMsg`/`ParentMsg`). Add
`t:'decide'|'image'`.

**Host** — `src/sandbox/host.ts`
- `SandboxHostConfig` (`:125-160`): `onAgentRequest`, `onWorkflowRequest`, `onPhase`, `onBudgetSnapshot`,
  `currentPhase`.
- `child.on('message')` switch, `case 'agent'` (`:429-446`): snapshots `currentPhase()` synchronously, then
  calls the deferred handler, then sends `agentResult` + `spent`, or on error sends `agentThrow` with
  `ipcErrorCode(err,'AGENT_ERROR')`.
- **Plug-in:** add `onDecideRequest` / `onImageRequest` plus a new `case`, mirroring `case 'agent'`.
  Without a handler, fall back like `case 'workflow'` does (`:448-451`).

**RunManager** — `src/run-manager.ts`
- Top-level host is built in `_newSandbox` (`:2269-2291`): `onAgentRequest → _handleAgentRequest(runId,…,'',phase)`.
- Nested host is built in `_handleWorkflowRequest` (`:2636-2660`) with callSeq namespacing
  `frameBase + callSeq` (`:2649`).
- `_handleAgentRequest` (`:2715-2983`) runs these steps in order:
  1. label/positional split (`:2729-2730`)
  2. `CallKey` and `cachePlan.replay` (`:2736-2740`)
  3. `nextAgentId` + `markQueued` (`:2746-2756`)
  4. `guard.acquireSlot()` (`:2757`)
  5. `guard.assertBudget()` (`:2772`), which on refusal calls `markRefused(BUDGET_EXCEEDED)`
  6. tool-surface tamper check (`:2824-2843`, fails CLOSED for an unscanned positional)
  7. `markRunning`
  8. per-label `runParams` (`:2874-2880`)
  9. `_semaphore.withSlot(() => spawner.run(...))` (`:2896`)
  10. journal push + redacted `appendJournal` (`:2919-2943`)
  11. refusal ledger via `RECORDED_REFUSAL_CODES` (`:451`, `:2952-2958`)
- **Plug-in:** add a NEW `_handleDecideRequest` / `_handleImageRequest`. Do not route through
  `_handleAgentRequest`: the tamper check would refuse any positional that `scanAgentCalls` never saw.
  Reuse the pieces: replay, `guard` slot + `assertBudget`, the process semaphore, journal, refusal ledger,
  and a record that `foldUsageFromRecords` sees.
- That gives three refusal-code sets to keep in sync: guards.ts `ENGINE_REFUSAL_CODES`, run-manager.ts
  `RECORDED_REFUSAL_CODES`, and the `errors.ts` catalog.

**Executor → gateway** — `src/agent-executor.ts`
- `AgentExecutor.run` → `_runTracked` (`:923+`). It validates effort, the retired `agentType`, and the
  schema; composes the prompt; then loops `_invokeOnce`.
- `_invokeOnce` (`:1084-1208`, gateway call at `:1203`) calls `this._gateway.invoke({prompt, opts, …, onHarness, onEvent, onUsage, caps})`.
- `AgentTranscriptSink.capture` (`:428-750`) prices via `priceCall(tokens, priceBook.pinned[provider/model].price)`
  (`:488`), calls `guard.addUsage` (`:501`), and journals `kind:'usage'` transcript events (`:581`, `:728`).
- `GatewayClient` interface: `src/gateway/client.ts:248-285`. It takes a prompt/opts chat session only, so
  it does not fit classify/images.
- Gateway choice is engine-wide (`src/main.ts:56-60`, `GatewayChoice = 'sdk'|'direct-fetch'|'pi'`):
  - `pi` → `PiGatewayClient` (`main.ts:702-722`)
  - `sdk` (production default) → `ClaudeAgentSdkGatewayClient` via LiteLLM proxy (`main.ts:723+`)
- **Plug-in:** the new primitives call pi-ai directly from the host process, so they bypass
  `GatewayClient` entirely. Do this in a new module (e.g. `src/direct-models.ts`) that is independent of
  `GatewayChoice`. This is correct because production runs `sdk`, where `PiGatewayClient` does not exist.

## 2. params contract and static label discovery

- Vocabulary (`src/params/contract.ts`): `LOCKED_KEYS` (`:31`), `TUNABLE_KEYS = model/effort/timeoutMs/appendPrompt` (`:32`).
- `AgentParamSpec` (`:62-69`): model/effort/timeoutMs are REQUIRED, each with `.default`; appendPrompt,
  skills and mcp are optional. Effort and appendPrompt are meaningless for a classifier, and appendPrompt
  is meaningless for image generation.
- `ParamContract = {agents, args}` (`:71-74`).
- `parseParamContract(metaParams, scriptLabels, catalog)` (`:457-536`):
  - every script label must be declared → `AGENT_UNDECLARED` (`:488-492`)
  - every declared label must appear in the script → `AGENT_DECLARED_NOT_IN_SCRIPT` (`:493-502`)
  - each spec goes through `validateOneAgentSpec` (`:342-450`), which includes the model ref check at `:359`/`:365`
- `parseMetaParams` (`src/workflow-meta.ts:174-208`) gets labels from `scanAgentCalls(script).labels` and
  evaluates the meta literal.
- Registration call site: `WorkflowCatalog` (`src/workflow-catalog.ts:746-751`) uses a fresh
  `_catalogSnapshot()`. Then come the pi tool gate (`:760-772`), `checkMetaPhases` (`:774-780`),
  `deriveExpectedGraph` (`:794`), and `checkMermaid(mermaid, scan.labels, agentDefaults, …)` (`:801`).
- `scanAgentCalls` (`src/workflow-meta.ts:726+`, re-exported by `src/scan-agent-calls.ts:6`):
  - `AGENT_CALL_RE = /(?<!\.)\bagent\s*\(/g` (`:357`)
  - requires a literal label (`AGENT_LABEL_FORMAT_RE`) and a literal options object
  - closed option-key set `AGENT_OPT_KEYS` (`:374-377`, typed `Record<keyof AgentOpts|'prompt',true>`)
  - tunables written in the script → `PARAM_IN_SCRIPT`
  - records `allowedTools`/`bash` per call (the tamper-check source) plus parallel/alt groups
- `script-checks.ts` `CALLABLE_API_NAMES = {agent, phase, parallel, pipeline, workflow}` (`:96`) refuses
  aliasing a sandbox API (`const d = decide`). New names must be added, or aliasing evades every
  text scanner.
- **Gap:** `decide(` / `image(` are invisible to AGENT_CALL_RE, to skeleton `CALL_RE`
  (`workflow-meta.ts:224`), and to the checkMermaid label diff (`check-mermaid.ts:237+`). A diagram node
  for them would currently be an unknown label. A parallel `scan*Calls` and a contract section (e.g.
  `meta.params.decisions.<label>` / `images.<label>` with only `model` + `timeoutMs`) are needed, or the
  new labels must join `agents` with a per-kind spec.

## 3. Model resolution at register time

- `parseModelRef` (`src/providers.ts:61-69`): `<provider>/<id>`, split at the first `/`; providers are
  `anthropic|openrouter|ollama` (`:18`).
- `checkModelRef` (`providers.ts:159-209`):
  - syntax → `UNKNOWN_MODEL` (`:163`)
  - `harnessProviders` gate → `PROVIDER_UNSUPPORTED_BY_HARNESS` (`:174`)
  - anthropic → static table, accepted with a warning if unknown
  - openrouter/ollama: catalog unavailable or static → accepted with a warning (`:189-197`); otherwise
    absent → **`UNKNOWN_MODEL` (`:198-207`)**
- Catalog build: `buildCatalog` (`model-catalog.ts:473+`) = static anthropic table (`:176`, modelType
  `'chat'` static `:212`) + Ollama `/api/tags`+`/api/show` (`:309-345`, modelType from capabilities `:322-330`)
  + OpenRouter `/api/v1/models` (`:409-470`, `openRouterModelType` `:366`). Each source degrades
  independently.
- `ModelBook` (`src/models/model-book.ts:99+`): TTL 1h (`:111`), single-flight, last-good fallback.
  `toModelCatalogSnapshot` (`:210-227`) projects to `{provider, model, sameModelAs}`, so **modelType is
  dropped before checkModelRef ever sees a row.**
- Admission price pin: `run-manager.ts:1260-1266`, `pinned[provider/model] = bookSnapshot.lookup(...)`,
  stored with the run (`createRun(..., priceBook)`). `reachableModels` (`model-book.ts:194-197`) covers
  `params.model` and `agents[*].model` only.
- **Confirmed: there is no modelType check at registration or admission** (see §0.3).

## 4. Provider / gateway gating, keys, authz

- **OpenRouter key:**
  - pi gateway: `resolveOpenrouterKey` (`src/gateway/pi-gateway-client.ts:528-530`, module-private,
    not exported) reads `secretSource.resolve('OPENROUTER_API_KEY')`, then
    `process.env.RWE_SECRET_OPENROUTER_API_KEY`, then `process.env.OPENROUTER_API_KEY`. Missing →
    `OPENROUTER_AUTH_MISSING` (`:716-718`; catalog entry `src/errors.ts:155-157`).
  - sdk gateway (production): the LiteLLM proxy subprocess gets `env: {...process.env}`
    (`src/gateway/litellm-proxy.ts:177`) and routes `openrouter/*` (`:50-52`). LiteLLM reads
    `OPENROUTER_API_KEY` from env itself.
  - direct-fetch reads `process.env.OPENROUTER_API_KEY` (`src/gateway/client.ts:407-409`).
  - The env comes from `~/.config/rwe.env` (systemd `EnvironmentFile=`; DEPLOY.md:30, :2183). Per memory,
    rwe.env is the only key source.
- `loadSecretSourceFromEnv` (`src/secret-source.ts:12-28`): `RWE_SECRET_<NAME>` → name.
- **Plug-in:** a host-side pi-ai call should pass `options.apiKey` explicitly (pi-ai
  `ProviderRequestOptions.apiKey`, `types.d.ts:61`) using the same resolution order, factored out of
  pi-gateway-client.ts. Never rely on pi-ai's own credential store / env discovery.
- **Provider allowlist:** the only one is `harnessProviders`, set solely under `gateway:"pi"` to
  `['openrouter','ollama']` (`main.ts:51-54`, `:699`) and enforced in `checkModelRef`. Under sdk
  (production) all three providers are allowed.
- **Authz:** `src/authz.ts` is role × kind × ownership × mode per MCP tool (`:1-3`, `authorize` `:327`).
  There is **no per-provider or per-model rule**. Anyone allowed to register/run a workflow may name any
  model.

## 5. Usage / cost / budget

- Live fold: `foldUsageFromRecords(records)` (`run-manager.ts:515+`) over
  `AgentExecutor.getAllRecords()` → `RunUsage`.
- `_budgetSnapshotFor` (`:2262-2267`) gives `{usd, tokens}`, piggybacked to the child as `spent`.
- Persisted fold: `foldUsage(events)` (`run-guard.ts:47+`) over `kind:'usage'` transcript events (used on
  resume, `run-manager.ts:2058-2067`).
- `RunGuard` (`run-guard.ts:135+`):
  - `addUsage(tokens, costUSD, unpriced)` (`:224`)
  - `assertBudget()` (`:266-272`) throws `BudgetExceededError` (usd or tokens), called only from
    `_handleAgentRequest:2772` (post-slot)
  - concurrency via `acquireSlot` (`:177`)
  - process-wide `_semaphore.withSlot`
- Pricing: `priceCall(tokens, rates)` (`run-guard.ts:23`). Rates come from the admission pin; there is no
  per-image or per-request component.
- pi-ai results carry their own `usage?: Usage` with cost computed at pi's catalog price
  (`ClassifierResult.usage` docstring, `types.d.ts:488-497`). The design must pick ONE price source.
- Observed per-model stats: `src/models/observed-stats.ts`. `loadFacts` (`:157-188`) reads per-agent
  transcripts through `deriveAgentRecords`, drops aborted/no-model records, and buckets by `ref` ×
  `kind` = `'tools'|'prose'`, where kind comes from the harness event's `descriptor.tools` (`:171-176`;
  `aggregateFacts` `:232`). A classify/image record with no harness event lands in `prose`. That mixes
  latency/cost with chat calls unless a new bucket or kind is added. Window 30d, TTL cache.

## 6. resume-cache

- `src/resume-cache.ts`: `ResumeCache.build(journal)` → `Plan.replay(callSeq, key)`, longest unchanged
  prefix.
- Hit = same `callSeq`, `sameKey` (`a.prompt === b.prompt && JSON.stringify(a.opts) === JSON.stringify(b.opts)`,
  `:13-15`), and not `aborted`. The first miss makes everything after it a miss (`:30-38`).
- Keyed by `callSeq` (shared counter across agent/workflow; nested frames namespaced `frameBase+n`,
  `run-manager.ts:2293-2300`) plus `CallKey {prompt, opts}`. Journal written at `:2919-2943` (persisted
  copy redacted).
- **Plug-in:** decide/image calls draw callSeq from the same child counter, so they MUST be journaled,
  or replay misalignment cascades (a later agent() would miss).
- `CallKey.prompt` is a string. Decide would key `{prompt: JSON(state+questions) or label, opts:{label, kind:'decide', ...}}`.
- Images: the replayed value must be the workspace path(s), and the files must still exist (the resumed
  run reuses the workspace).

## 7. Events / diagram / dashboard

- `src/event-log.ts`: the `EngineEvent` closed union (`:7-55`) covers catalog.*, run.terminal, and
  agent.confinement/stderr/mcp_not_connected/... (gateway-attempt facts). There is no per-call "agent
  started/done" operator event. Per-call history lives in per-agent transcripts: `harness`, `usage`,
  `refused`, and live `onEvent` events via `store.appendTranscript` (`agent-executor.ts:1084-1200`).
  Records are rebuilt by `deriveAgentRecords` (run-store.ts).
- Skeleton:
  - `parseWorkflowSkeleton` (`workflow-meta.ts:210-270`, `CALL_RE = /\b(phase|agent|parallel|workflow)\s*\(/g`)
  - `deriveExpectedGraph(nodes, scan)` (`src/skeleton-graph.ts:110+`) joins positionally with
    `scan.calls`. `AGENT_BEFORE_PHASE` (`:173-187`): every agent must be inside a phase.
  - `SkeletonKind = 'phase'|'agent'|'workflow'` (`workflow-meta.ts:210`).
- `meta.phases`: `checkMetaPhases` (`workflow-meta.ts:102-137`) compares only phase() titles
  (count/order/text). New primitives do not affect it unless they open lanes.
- Mermaid: `checkMermaid` (`src/check-mermaid.ts`) does a bidirectional label diff against `scan.labels`
  (`:237+`), uses `agentDefaults` (`:268`) for model text, and checks lanes/slots/edges against the
  derived graph. `diagram-render.ts` only renders mermaid to SVG (mmdc, cache); it is kind-agnostic.
- Dashboard: `buildDagModel(view)` (`src/dashboard.ts:57-85`) groups `view.agents` by frame.
  `predictedLanes` (`:330-347`) uses deriveExpectedGraph. `run-view.ts` is a public projection only.
  Records from new primitives appear automatically if they are `AgentRecord`s; otherwise the dashboard
  needs a new node kind.

## 8. Workspace artifacts (where images would land)

- Workspace dir: `WorkflowCatalog.runWorkspace(name, runId)` = `<workFolder(name)>/runs/<runId>`
  (`src/workflow-catalog.ts:1596-1600`). It is held as `entry.workspace` and git-baselined by
  `initGitBaseline` (`src/workspace-git.ts:47`).
- `src/workspace-artifacts.ts`: `listArtifacts(workspace)` (`:78`, recursive, sha256,
  realpath-contained, hides 0-byte mount placeholders), and `readArtifactChunk(...)` (`:130`, 1 MiB
  chunks, `DEFAULT_MAX_CHUNK :65`).
- MCP exposure: `workspace_list` / `workspace_pull` (`src/tool-specs.ts:1051`; `src/mcp-facade.ts:1452`,
  `:1482`).
- **Plug-in:** the host decodes `AssistantImages.output[i].data` (base64) and writes
  `<workspace>/<dir>/<label>-<callSeq>-<i>.<ext>` with the mime→ext mapping. It returns only metadata
  (`{path, mimeType, bytes, sha256}` plus any text blocks) to the script. Containment uses
  `isPathContained`. The sandbox child has no fs access by design (child-entry.ts:1-5).

## 9. pi-ai usage today and host importability

- Engine source imports only `@earendil-works/pi-coding-agent`, in `src/gateway/pi-child/session-runner.ts:12-19`.
  That child is a separate process spawned by `PiGatewayClient` (`pi-gateway-client.ts:98` ENTRY_PATH).
  There is no `@earendil-works/pi-ai` import anywhere in `src/`; it is mentioned only in comments.
- `package.json`: `"type":"module"`; `@earendil-works/pi-ai: 1.0.0` and `pi-coding-agent: 1.0.0` are both
  direct deps; the host runs on `tsx src/main.ts`. tsconfig is `module: ESNext`,
  `moduleResolution: bundler`. pi-ai is ESM-only (`"type":"module"`, import-only `exports`).
- Live probe from the repo root (node ESM) worked:
  - Root `@earendil-works/pi-ai` exports `createModels` but NOT `classify`, `generateImages` or `getModels`.
  - `@earendil-works/pi-ai/images` → `ERR_PACKAGE_PATH_NOT_EXPORTED`. `images.js` exists but is not an
    exported subpath.
  - Works:
    ```js
    import { createModels } from '@earendil-works/pi-ai';
    import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
    const ms = createModels(); ms.setProvider(openrouterProvider());
    ms.getModelOfType('classifier','openrouter','typesafe/jev-1.13') // -> {id, api:'typesafe-system-one', ...}
    ms.getModelsOfType('image','openrouter').length                    // -> 57 (37 with zero cost)
    ms.getModel('openrouter','typesafe/jev-1.13')                      // -> undefined (chat-only accessor)
    ms.getProvider('openrouter').classify / .generateImages            // -> functions
    ```
  - Also directly: `@earendil-works/pi-ai/api/typesafe-system-one` → `classify`, and
    `@earendil-works/pi-ai/api/openrouter-images` → `generateImages` (`exports "./api/*"`).
  - `Models.generateImages` / `Models.classify` **never reject** (`models.d.ts:186-192`). Failure is
    `stopReason:'error'` + `errorMessage`.
- pi-ai catalog `providers/data/openrouter.json` is keyed by api:
  - `anthropic-messages` 15
  - `openai-completions` 384
  - `openrouter-images` 57 (`image:<id>`)
  - `typesafe-system-one` 9 (`classifier:<id>`): `~typesafe/jev-latest`, `typesafe/jev-1.13`,
    `inception/mercury-decide:free`, `jaredpalmer/kev-4b`, `respan/span-01`, `respan/span-01-lite`,
    `respan/span-01-lite:free`, `togethercomputer/tev1-4b-experimental`, ...
  - Example cost for jev-1.13: input $0.042/M, output 0, ctx 32000.
- Type shapes (`dist/types.d.ts`):
  - `ClassifierContext { state: JsonObject; questions: Record<string, ClassifierQuestion> }` (`:467-470`)
  - `ClassifierQuestion` =
    - `{type:'choice', instructions, criteria: Record<string,string>}`
    - `{type:'score', instructions, criteria: string[]}`
    - `{type:'bool', instructions, criteria:{true,false}}` (`:448-466`)
  - `ClassifierResult { api, provider, model, answers: Record<string, ClassifierAnswer>, usage?: Usage, stopReason:'stop'|'error'|'aborted', errorMessage?, timestamp }` (`:488-497`)
  - `ClassifierAnswer` =
    - `{type:'choice', choice, probabilities: Record<string,number>, confidence}`
    - `{type:'score', score, confidence}`
    - `{type:'bool', probability}` (`:471-486`)
  - `ClassifierOptions` extends `ProviderRequestOptions` with `temperature?` (`:221-228`)
  - `ProviderRequestOptions { signal?, telemetryContext?, apiKey?, fetch?, ... }` (`:57+`)
  - `ImagesContext { input: (TextContent|ImageContent)[] }` (`:433-435`)
  - `ImageContent {type:'image', data: base64, mimeType}` (`:275-279`)
  - `AssistantImages { api, provider, model, output: (TextContent|ImageContent)[], responseId?, usage?, stopReason:'stop'|'error'|'aborted', errorMessage?, timestamp }` (`:437-447`)
  - `ImagesOptions` extends `ProviderRequestOptions` with `metadata?` (`:229-235`)
  - Models: `ImageModel {type:'image', output:('text'|'image')[]}` and
    `ClassifierModel {type:'classifier', contextWindow}` (`:936-946`). pi-ai has
    `ModelType = 'chat'|'image'|'classifier'` (`:947-953`), a different vocabulary from the engine's
    `'image-gen'` etc.

## 10. SDLC ledger (`.sdlc/features/001-remote-workflow-engine/`)

- Highest ids:
  - REQ-219 (01-requirements.md), ARCH-182 / ADR-086 (02-architecture.md), DES-263 (04-design.md),
    TASK-259 (03-tasks.md)
  - UT-338, IT-307, VAL-259, IMPL-390
- `state.yaml`: `iteration: v37`, `current_stage: closed` (line 6-7). Code comments mention v38/v39 work
  (e.g. `workflow-meta.ts:46` "v39 ... meta.phases"; `main.ts:511` "filed for v38"), but the ledger was
  not updated for those (consistent with memory: post-v37 fixes were "TDD+real-run, ledger not recorded").
  The next ledger iteration should be chosen deliberately: v38 by state.yaml, or a later number to avoid
  colliding with the v39 label already used in code comments.
- `01-requirements.md` structure: front-matter `stage: requirements / status: reviewed`, then "Clarification
  log" with `### Round vNN — date` entries, then per-iteration sections. The latest pattern (v33+) is:
  ```
  ## 迭代 v37 — 2026-09-22:安全硬化(需要架構辯論)      (line 2971)
  <para on why this round / path>
  ### REQ-218 — <title>
  - **status:** draft
  - **traces:** REQ-018, REQ-037, REQ-117
  - **證據/根因/現況**: ...
  - **acceptance:** **Given** … **Then** … **And** …
  - **iter:** v37
  ...
  **路徑**:<full 7-gate vs fix, panel or not>
  ```
- Older iterations use `## Iteration vNN — ...` (English); v35–v37 use `## 迭代 vNN — date:title`.
- RTM rows: `rtm.md:240-241` format
  `| REQ | title (vNN) | ARCH… | DES… | TASK… | IMPL… | tests… | ✅ |`.
- Architecture slices: `## vNN slice — 「…」 (REQ-…): ARCH-a..b + ADR-x..y, with … amended in place`
  (`02-architecture.md:5205`).

## Unknowns / not verified

- Whether OpenRouter's classifier endpoint behaviour (typesafe-system-one wire format, "noul" mapping)
  works with the deployment key. No paid call was made.
- Whether `ModelBook` should fetch `?output_modalities=all`. That would change row counts for models_list
  and every existence check. It is a design decision, not measured.
- Per-call `agentResult` IPC payload limits beyond Node's IPC serialization (no explicit cap found).
- Dashboard UI files under `src/dashboard/ui` were not read. Only the `dashboard.ts` model builders were
  read.
