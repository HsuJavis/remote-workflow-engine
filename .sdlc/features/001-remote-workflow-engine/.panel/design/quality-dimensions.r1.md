# Quality-dimensions lens — Design stage, round 1 (independent proposal) — v40

**Scope:** iteration **v40 — `decide()` / `generateImage()` via pi-ai**, REQ-220..REQ-230
(`01-requirements.md:3026-3213`), Gate 3+4 (tasks + design) of the full path, QM. Inputs read in full:
the v40 requirements section with the V40-Q1..Q19 interview table; the v40 architecture slice
(`02-architecture.md:6511-6902` — ARCH-183..194, ADR-087..095, INV-V40-1..7, the v41 candidates and the
decision rationale); `state.yaml` tech_stack and the Gate-2 note; my own Gate-2 lens file
(`.panel/architecture/quality-dimensions.r1.md`, v40) so this proposal does not re-argue what that gate
ruled; the Gate 0 as-is map (`v40-gate0-asis-map.md`); and — verified directly against source, not taken
from the architecture's prose — pi-ai 1.0.0 (`dist/api/system-one-shared.js`, `api/typesafe-system-one.js`,
`api/openrouter-images.js`, `utils/provider-retry.js`, `types.d.ts:57-80, 430-497, 895-953`) and the engine
seams each dimension lands on (`src/run-manager.ts:2715-2983` `_handleAgentRequest`, `src/run-guard.ts:1-75`
`foldUsage`, `src/run-store.ts:46+` `deriveAgentRecords`, `src/agent-executor.ts:297-350, 560-600`,
`src/resume-cache.ts`, `src/agent-semaphore.ts`, `src/sandbox/{host,child-entry,guards}.ts` (the IPC error
envelope, `sanitizeThrownError`, `DETERMINISM_GUARDED`), `src/event-log.ts`, `src/models/observed-stats.ts`,
`src/models/model-book.ts:188-230`, `tests/unit/compose-config-v2-wiring.test.ts:459` (the UT-219 sweep),
`tests/integration/guide-examples-register.test.ts`, `src/dashboard/ui/agent-panel.js:290-320`).

**Supersession note.** This path held the v37 design-round-1 proposal; `git status --short` on it is clean
at `f36ed4e`, so `git show f36ed4e:<this path>` reaches that content per CLAUDE.md. Nothing is checked out,
restored or stashed.

**Scope discipline.** Gate 2 is closed. I re-open **no** ADR: no `DecisionBackend` port (ADR-089 — my own
Gate-2 proposal, conceded on the Karpathy tie-break; everything below is written for ONE module with
injected deps), no breaker / per-run fairness / decision probe (ADR-092 + v41 candidates), body-free error
text everywhere (ADR-093), `AgentRecord.kind` not a new node type (ADR-094), strict `image-gen` for
`images.<label>` until the owner answers ADR-095. The architecture left the exact constants, call-site
orderings, event-field semantics, test shapes and the task split to this gate ("exact values fixed at
Gate 4"). That is what this document is: **where the architecture's sentences meet the actual source**, the
places I found they do not yet meet, and how to split the work so each quality is testable in isolation.

**03-tasks.md** has no v40 section yet (the synthesizer writes it). Where splitting affects a dimension I say
so inline and collect it in §5.

## Altitude call

Both altitudes, with the Gate-2 correction standing: **`decide()` and `generateImage()` are not agents** —
one HTTP request, one typed answer or a few files, no session, no tool loop, no chain-of-thought. So at the
agent altitude: observability = the typed `answers` / file metadata + tokens + per-attempt wire facts (never
inputs, REQ-229 / V40-Q11); replaceability = the model is a declared parameter; consumability = typed I/O +
the guide ARE the SDK (V40-Q3: agents write these calls); self-sustainability = bounded retry, refuse-before-
spend, replay — memory metabolism is N/A (nothing accumulates across calls; stated once so no round spends
budget on it). System altitude applies throughout: IPC, budget folds, resume journal, catalog, config wiring,
dashboard, operator log.

## Summary — what the Design stage must settle (ranked)

Seven findings that the architecture's text does not yet make true against the code as it is. None reopens
an ADR; each is a DES-row-sized decision.

1. **pi-ai cannot tell the engine's timeout from a run stop.** Both codecs end with
   `output.stopReason = options?.signal?.aborted ? "aborted" : "error"` (`system-one-shared.js:177`,
   `openrouter-images.js:66`). ARCH-183 passes ONE composed signal, `AbortSignal.any([timeout, runAbort])`,
   so a per-attempt timeout arrives as `stopReason:'aborted'` — which ARCH-183 "maps onto the run-stop path",
   i.e. **never retried**. REQ-227's timeout retry would be silently dead. **Design (O-2):** a pure
   `classifyAttempt()` that reads the engine's own two signals first (`timeoutSignal.aborted`,
   `runAbort.aborted`), the fetch seam's status second, and pi-ai's `stopReason` last. Never pass pi-ai's own
   `timeoutMs` (it would start a second timer and throw its own `TimeoutError` string).
2. **`detail` does not cross the sandbox boundary.** `host.ts:440-444` sends `agentThrow` with
   `{code, message}` only; `sanitizeThrownError` (`guards.ts:169`) copies `name`/`message`/`code` only. ARCH-183's
   `PRIMITIVE_FAILED{detail:{status, attempts, retryable, reason}}` is host-side only — the script sees the
   code and the message. **Design (C-3):** the message grammar becomes a tested contract (P1); optionally a
   closed JSON-safe `detail` on the `agentThrow` envelope (P2; the agent path never sets it, so INV-V40-1 holds
   behaviourally). Pick one; I recommend both, P2 as a separate small task the synthesizer may drop.
3. **A primitive record does not survive a restart as designed.** `deriveAgentRecords` sources
   `label/agentKey/phase/phaseIndex/frame` from the **harness** event and `startedAt` from the first harness
   `ts` (`run-store.ts:56-100`); `observed-stats.loadFacts` reads `kind` from the harness descriptor
   (`observed-stats.ts:171-176`). A primitive has no harness event. **Design (O-5/O-6):** the primitive's one
   `usage` transcript event carries `primitive, label, agentKey, phase, phaseIndex, frame, startedAt` (plus
   `provider, model, tokens?, costUSD, unpriced`), and the usage branch reads them when no harness event
   exists; the DES-188 derived≡snapshot lock is extended with one decide + one image record.
4. **The two usage folds will disagree on a tokenless priced call.** At-rest `foldUsage` has
   `if (!data.tokens) continue;` BEFORE it counts `costUSD`/`unpricedCalls` (`run-guard.ts:63`); live
   `foldUsageFromRecords` sums `r.costUSD` regardless (`run-manager.ts`). An image call whose wire body
   reports `usage.cost` but no token counts (or none at all) is counted live and **dropped at rest**, so the
   USD arm re-arms low on resume — exactly IT-156's bug class. **Design (O-5):** `foldUsage`'s guard becomes
   "skip only if neither `tokens` nor a numeric `costUSD` is present"; agent events always carry both, so
   agent arithmetic is unchanged; the lock test gets the primitive case. One task, one commit.
5. **INV-V40-5's wording vs the capture-site convention.** `priceCall`'s doc fixes the convention: unknown
   price collapses to `{costUSD: 0, unpriced: true}` at the capture site, never upstream (`run-guard.ts:19-22`);
   both folds need a number. ARCH-191 says "no number". **Design (O-5):** the **record and usage event**
   follow the existing collapse (`unpriced:true` is the marker — identical to `agent()`), the **`primitive.call`
   event** carries `costUSD: null, costSource:'absent'` (the human-facing line), and `assertBudget`'s USD arm
   never sees a fabricated zero as spend. Said explicitly so the implementer is not torn between two texts.
6. **`Plan.replay` is synchronous; `verifyFiles` touches the filesystem.** ARCH-187's
   `replay(callSeq, key, validate?: … | Promise<boolean>)` would change the return type at the agent call
   site (`run-manager.ts:2739`, `if (cached !== MISS) return cached`). **Design (S-4):** a second method
   `replayValidated(callSeq, key, validate): Promise<ReplayResult>` sharing the private `_missed` logic;
   `replay`'s signature stays byte-identical (INV-V40-1).
7. **Pre-flight order and the slot.** ARCH-187 lists `withSlot` (4) before `assertBudget`/`PRICE_UNKNOWN` (5).
   The v25 comment at `run-manager.ts:2760-2775` says `assertBudget` AFTER the slot is load-bearing (the
   overshoot bound) — keep that. But the **no-spend, pure** refusals (`PRIMITIVE_INPUT_INVALID`,
   `IMAGE_PATH_REFUSED`, `PRICE_UNKNOWN` — decidable from the pin) must run BEFORE the slot, and `markQueued`
   before the slot too (D-F12 visibility; the `queued` gauge is ADR-092's own starvation signal). A refused
   call must never consume the contended resource REQ-228 protects.

Two further design facts the stage must write down, not discover in Gate 6: a thrown `PRIMITIVE_FAILED` needs a
journal row or the first-miss rule re-runs every later `agent()` on resume (S-5); and `onPayload` is the hook
that turns REQ-225 tier 1 from "unverified" into a designed path for images (O-4).

## 1. Observability

### System altitude

- **O-1 — the fetch seam, concretely.** `src/direct-models/fetch-seam.ts` (or a section of `call.ts`):
  `makeObservedFetch(deps: {fetch, now}, caps: {maxBodyBytes}) → {fetch: FetchFunction, last(): SeamRecord | null}`.
  Both codecs call it as a standard `fetch(input, init)` — classify directly (`system-one-shared.js:141,
  147`), images through the OpenAI SDK client (`openrouter-images.js:73-80`, `new OpenAI({fetch})`, SDK
  `maxRetries: 0` per request at `:30`). Per call it records
  `SeamRecord = {invoked: boolean, status, retryAfterMs: number | null, providerMs, requestBytes,
  responseBytes, truncated, wireCostUSD: number | null}` (`invoked` flips the moment the codec calls the
  seam — O-2 uses it to tell "fetch threw" from "pi-ai never fetched"):
  - `providerMs` = injected monotonic `now()` (`performance.now`, never `Date.now`) around the awaited
    fetch **including** the body read — that is "provider time" for REQ-230.
  - Body read **once** through a stream reader that stops at `maxBodyBytes` (never `arrayBuffer()` then
    check — the cap must bound memory, not just report). On overflow: `truncated: true`, the seam throws a
    seam-owned `SeamBodyTooLarge`; pi-ai catches it into `stopReason:'error'`, and O-2 classifies from the
    seam record, never from pi-ai's string.
  - The codec gets `new Response(buf, {status, statusText, headers})` — pi-ai's classify path calls
    `next.text()` on a non-OK and `next.json()` on OK (`:154-155`); the OpenAI SDK parses JSON itself. One
    copy, one stub, real codec under test (ADR-088/089).
  - `retryAfterMs`: parse `retry-after-ms`, then `retry-after` as seconds or HTTP-date — engine-owned
    (mirrors `provider-retry.js:33-44` semantics so behaviour is familiar, but no import from pi-ai utils).
  - `wireCostUSD`: only when status 2xx and the body is JSON with a finite `usage.cost ≥ 0`; else `null`.
- **O-2 — `classifyAttempt()` — the one place that decides retry/fail/ok.** Pure:
  `classifyAttempt(in: {timeoutFired, runAborted, seam: SeamRecord | null, pi: {stopReason, hasOutput}})
  → {outcome:'ok'} | {outcome:'fail', reason, retryable, status?}` with
  `reason ∈ 'http' | 'timeout' | 'aborted' | 'network' | 'no_output' | 'malformed' | 'response_too_large'`.
  Order of precedence, each a UT case: `runAborted` → `aborted` (not retryable, run-stop path);
  `timeoutFired` → `timeout` (retryable); `seam.truncated` → `response_too_large` (not retryable);
  `seam.status === 429 || ≥ 500` → `http` retryable; other `4xx` → `http` not retryable; seam **invoked**
  but no response (fetch threw: DNS, ECONNRESET) and pi `stopReason:'error'` → `network`; seam **never
  invoked** and `stopReason:'error'` (pi-ai threw before fetching: `No API key`, `Unsupported classifier
  API`, an `onPayload` throw — an engine bug, not a provider fault) → `malformed`, **not retryable**, so a
  misconfiguration is never retried `retries` times; `stopReason:'stop'` with zero image blocks →
  `no_output`; `stopReason:'error'` with a 2xx seam → `malformed` (pi-ai's own `parseAnswers` rejected the
  body). The seam therefore records `invoked: boolean` alongside the response facts (O-1). **Interpretation
  flagged, not decided silently:** REQ-227 names 429 / 5xx / timeout. I propose `network` as **retryable**
  (a connection reset is a timeout's sibling, not a 4xx) and mark it as one line in `classifyAttempt` the
  synthesizer can flip; pi-ai itself treats an undefined status as retryable (`provider-retry.js:15-16`).
  **`failReason` map** (the `AgentRecord.failReason` union is closed — `timeout | unreachable | terminal |
  aborted` — and widening it touches agent types; mapping does not): `timeout→timeout`, `network→unreachable`,
  `aborted→aborted`, every other reason → `terminal`; the exact reason stays on the `primitive.call` event.
- **O-3 — event semantics, filled in.** One `primitive.call` kind (ARCH-192); additive fields I ask Gate 4 to
  fix: `agentId` (correlation with `run_status.agents[]` and `run_agent_log`), `attempt` 1-based (`0` on a
  `refused` event), `reason` (O-2's), `backoffMs` on `retry` events (the sleep the engine is about to
  take), `engineMs` on the **terminal** event only, defined as
  `totalMs − Σ providerMs − Σ backoffMs` where `totalMs` runs from host IPC receipt (`case 'decide'`) to the
  reply `child.send`. Without the subtraction a retried call reports two seconds of "engine overhead" and
  REQ-230's production number is noise. `costUSD`/`costSource`/`tokens` present on the `ok` event only
  (optional on the type — on `retry`/`failed`/`refused` nothing was priced). `answers` on `ok` for decide
  (owner V40-Q11), `files` metadata on `ok` for image. The type still has **no field** that can hold
  `state`, `questions`, `prompt`, input-image bytes or a provider body (INV-V40-3), and it rides
  `createEventSink`'s redaction like every kind.
- **O-4 — make tier 1 reachable for images.** pi-ai exposes `options.onPayload(payload, model)`
  (`types.d.ts:74`; both paths await it before sending). For the image request (OpenAI chat-completions
  shape) the engine sets `payload.usage = {include: true}` — OpenRouter's documented usage accounting
  returns `usage.cost` in the body when asked. A constant `IMAGE_USAGE_INCLUDE = true`, **not** a config
  key, flipped only by Gate 7.5 evidence (if the route rejects the field, the constant goes false and the
  design is unchanged). The `/systemone` payload is left untouched (unknown endpoint schema); its
  `usage.cost` is read if present. This is the first design under which REQ-225's owner-ordered tier 1
  ("先用 provider 回報") can actually fire.
- **O-5 — the record, the usage event, and the two folds.**
  - Live: `markQueued(agentId, {label, agentKey: label, frame, phase})` BEFORE the slot (same D-F12
    reasoning as agents — a decide waiting on `decideSlots` is visible in `run_status.agents[]`);
    `markRunning` after the slot; terminal via `AgentExecutor.recordPrimitive({agentId, kind, model,
    tokens?, costUSD, unpriced, state:'done'|'failed', failReason?, startedAt, endedAt})` which writes the
    record (`provider:'openrouter'`) and emits ONE `kind:'usage'` transcript event whose `data` carries
    `primitive, label, agentKey, phase, phaseIndex, frame, startedAt` in addition to the agent fields.
    **No `kind:'message'` event ever** (INV-V40-3).
  - `tokens`: present when the wire reported a usage object (all-zero is then a KNOWN zero — v31's rule is
    about unmeasured, not about zero); omitted when the body had no usage. That is why finding #4 matters:
    `foldUsage` must count `costUSD`/`unpriced` on a tokenless event. New guard:
    `if (!data.tokens && typeof data.costUSD !== 'number') continue;` — agent events always carry both, so
    IT-156's existing cases are unchanged; one new case: tokenless priced primitive event folds identically
    live and at rest.
  - Price collapse: `pricePrimitiveCall` → `{costUSD, source}` or `{absent:true}`; the handler collapses
    `absent` to `guard.addUsage(tokens ?? ZERO_TOKENS, 0, true)` (`addUsage` takes a required `Tokens`;
    the zero is numerically neutral on the token arm — the "unmeasured" marker is the **omitted** `tokens`
    on the record and usage event, never the guard's scalar) and `recordPrimitive({costUSD: 0, unpriced:
    true})`, exactly as `agent()`'s capture site does — INV-V40-5 is satisfied by `unpriced:true`, and the
    `primitive.call` event is where `costUSD: null` lives. `costSource:'estimated'` stays on the event
    (REQ-225 "標示為估算" is satisfied there; an `AgentRecord.costSource` would be scope creep because every
    `agent()` cost is also an estimate from the pin).
- **O-6 — restart reconstruction and the stats bucket.** `deriveAgentRecords`'s usage branch: when no
  harness event exists, read `label/agentKey/phase/phaseIndex/frame` from `data` and `startedAt` from
  `data.startedAt`; set `kind` from `data.primitive`. `observed-stats.loadFacts`: `kind` from
  `data.primitive` when present (before the harness-descriptor rule); the bucket is per
  `AgentCallFact.kind ∈ 'prose'|'tools'|'decide'|'image'` and `ObservedForRef` gains the two buckets
  (ARCH-192). Lock: the DES-188 derived≡snapshot test gets a decide and an image record; a models_list row
  for `openrouter/typesafe/jev-1.13` shows measured success/p95 after the first real run — the only
  calibration signal an author has.
- **O-7 — the REQ-229 sentinel test, specified.** Integration tier, **real forked child**, stub `fetch`
  injected at the composition root. Three sentinels: one in `state`, one in `prompt`, one in a question's
  `instructions`. The stub's first attempt returns **400 with a body echoing all three** (the ADR-093 case),
  then 200. Two runs: one whose script catches, one whose script does not (so `runs.error` is populated by
  the v35 failure capture). After both: grep every sink for the three strings — the operator event log
  lines, `journal.jsonl`, `run_snapshots`, `runs.error`, `run_status`, `run_agent_log`, `/api/runs/:id`,
  `/api/runs/:id/agents/:agentId`, the observed-stats facts, `workspace_list` (file names are engine-chosen,
  so a prompt can never name a file), and the IPC `agentThrow.message` captured on the host side.
  **Mandatory positive control:** the three sentinels ARE present in the stub's captured request body —
  otherwise a green sentinel test proves only that nothing ran.
- **O-8 — REQ-230, where it is measured.** `Date.now()`/`new Date()`/`performance` are determinism-guarded
  inside a script (`guards.ts:102+`), so "script 端觀測到的耗時" cannot be a script-side timer. Design: the
  measurement point is the host IPC boundary — per-call `engineMs` on the terminal event (O-3, a production
  number) — and the acceptance test adds a per-call end-to-end figure through the **real forked child**:
  100 sequential `decide()`s against a stub `fetch` with fixed latency `L`; the host timestamps every IPC
  receipt and reply-send, so per call `e2e_i = engineMs_i + gap_i` where `gap_i` is host time from the
  reply-send of call *i−1* to the receipt of call *i* (IPC round trip + child dispatch + the script's own
  loop — the part a host-only timer cannot see); assert `p95(e2e_i) ≤ 200` (a real p95, not a mean) and
  `p95(engineMs) ≤ 200` as the production-comparable number. **Gate-5 interpretation item, flagged so the
  verifier does not rediscover it:** REQ-230's "script 端觀測到的耗時" is unimplementable as literally written
  (the script's clock is guarded); the host-side `e2e_i` is the faithful reading. Hot-path rules from
  ARCH-187 (model object cached per run, no ModelBook await, one sync journal write) are what make it pass;
  the test is what keeps it true.
- **O-9 — gauges and the Gate 7.5 spend ledger.** `/api/status` and `system_info` gain `decideSemaphore`,
  `imageSemaphore` as `{total, inUse, queued}` (`agent-semaphore.ts` `gauge()` — already shaped). `queued`
  is the starvation signal ADR-092 declined to engineer around; it must be visible before anyone asks for
  fairness. V40-Q19's "花費需記錄": the validator sums the operator log —
  `jq -s 'map(select(.kind=="primitive.call" and .outcome=="ok")) | {usd: (map(.costUSD // 0) | add),
  absent: (map(select(.costSource=="absent")) | length), reported: (map(select(.costSource=="reported")) |
  length)}'` — and 08-validation.md records which fields `/systemone` and the image route actually returned
  (`usage.cost`? `retry-after`?), feeding R-4's fixtures.

### Agent altitude

Per-call inspectability without inputs: the `ok` event's `answers` (choice → `{choice, probabilities,
confidence}`, score → `{score, confidence}`, bool → `{probability}`) is the classifier's entire reasoning
surface; `tokens` when reported; attempts, status, `providerMs`, `backoffMs` per attempt. An operator
answering "why did `gate` fail at 14:02" reads three `primitive.call` lines and needs nothing else — which
is the design goal REQ-229 forces: metadata must be *sufficient*, because inputs are forbidden.

## 2. Replaceability

### System altitude

- **R-1 — one module, injected deps, as ADR-089 ruled — and the deps spelled out.**
  `DirectDeps = {fetch, now: () => number, sleep: (ms, signal) => Promise<void>, random: () => number,
  resolveKey: () => string | undefined, onAttempt: (obs: AttemptObservation) => void}`. `random` is
  injected so backoff/jitter tests are deterministic; `sleep` is injected so retry tests take 0 ms and so it
  can be made abortable (S-1). Production wires `globalThis.fetch`, `performance.now`, an abortable sleep,
  `Math.random`, `resolveOpenrouterKey(secretSource)` (ARCH-184).
- **R-2 — the api map is data.** `PRIMITIVE_API = {decision: {api:'typesafe-system-one', call: classify},
  'image-gen': {api:'openrouter-images', call: generateImages}} as const`. The owner's Won't-listed
  Cloudflare / llama.cpp classifiers become rows (`cloudflare-workers-ai-system-one`, `llama-cpp-classify`
  exist in `dist/api/`) plus a key resolver per provider — not a layer (ADR-089's own consequence).
  `toPiAiModel(row: BookRowLike, kind): ClassifierModel<'typesafe-system-one'> | ImageModel<'openrouter-images'>`
  is pure and `satisfies` pi-ai's closed unions, so a pi-ai bump that tightens `BaseModel` fails `tsc`, not a
  run. `baseUrl` is the constant `https://openrouter.ai/api/v1`; `cost` zeroed; `headers` **never set**
  (ARCH-184: the key goes in `options.apiKey` only).
- **R-3 — the import boundary, enforced.** `tests/unit/direct-models-import-boundary.test.ts`: no file
  outside `src/direct-models/` imports `@earendil-works/pi-ai/api/*` or names `ClassifierModel | ImageModel
  | ClassifierAnswer | ClassifierQuestion | AssistantImages | ImagesContext` (source-text scan, the same
  mechanism UT-304 uses for the refusal sets). Engine-owned types `DecideQuestions`, `DecideAnswers`,
  `ImageFile` live in `src/types.ts` (type-only imports are allowed in `guards.ts`). A pi-ai 2.0 rename
  reaches one adapter file, never a registered script.
- **R-4 — pinned codec, golden wire.** pi-ai stays exactly `1.0.0`. The stub-fetch helper
  (`tests/helpers/stub-fetch.ts`: scripted `{status, headers, body, latencyMs}` sequences, a captured-request
  log) keeps the real codec in every test; two golden assertions pin the wire the codec speaks: the
  `/systemone` request body for a `bool` question (pi-ai's `bool`→`noul` mapping) and the chat-completions
  body `buildParams` produces for an image request. Gate 7.5's recorded response bodies (sanitized) become
  the stub bodies afterwards — the stub speaks what the real wire spoke. A pi-ai bump that moves the wire
  fails CI in the fixture, not in production.
- **R-5 — negative decision, recorded: no `baseUrl` config key.** It would be the one knob that redirects
  the bearer token; the stub fetch intercepts regardless of URL, so neither tests nor Gate 7.5 need it.
- **R-6 — the seam is standard `fetch`-shaped.** `(input: string | URL | Request, init?: RequestInit) =>
  Promise<Response>`; the classify path passes a `URL` object, the OpenAI SDK a string — the seam handles
  both. Swapping undici dispatchers or inserting a recording proxy is a `deps.fetch` change.
  `AbortSignal.any`/`AbortSignal.timeout` are Node ≥ 20.3 — the engine requires 22.6+.
- **R-7 — the price source stays pluggable.** `pricePrimitiveCall({wireCostUSD?, tokens?, entry, kind})`
  pure beside `priceCall` (untouched, INV-V40-1); `imageOutPerM` from `pricing.image_output` with the
  "absent ≠ 0" rule (ARCH-190); a future per-image rate is one more optional `BookEntry.price` field.

### Agent altitude

Backend swap is `meta.params.decisions.<label>.model.default` or a run override (`RunParams.decisions`,
REQ-091 machinery). The override must reach the admission pin: `reachableModels` adds
`decisions[*].model`/`images[*].model` **including run overrides** (ARCH-189) — otherwise an overridden
model has no pinned rate, `PRICE_UNKNOWN` fires under a USD budget, and the "config change" is not a
config change. Scripts never see pi-ai's `noul`; the engine keeps `bool`.

## 3. Consumability

### System altitude

- **C-1 — the contract types and their bounds.** `PrimitiveParamSpec = {model:{default}, timeoutMs:{default},
  retries:{default}}` (ARCH-188). Bounds: `timeoutMs` through the existing `boundMax(..., ceilings.maxTimeoutMs)`;
  `retries` through a **new ceiling** `DEFAULT_CEILINGS.maxRetries = 5` (`ceilingKey` union gains
  `'maxRetries'`), bounding the declared default AND the run override — a declared `retries:{default:50}`
  is otherwise admitted and REQ-227's worst-case wall time `(retries+1)×timeoutMs + Σbackoff` is unbounded.
  Refusal through the existing bounds path, message naming the ceiling like `maxTimeoutMs` does today.
- **C-2 — pre-flight validation that names the field, never the value.** `DECIDE_QUESTIONS_SCHEMA` (ajv, the
  D-V4 dependency) mirrors pi-ai's three shapes exactly: `choice {instructions, criteria: Record<string,
  string>}`, `score {instructions, criteria: string[]}`, `bool {instructions, criteria: {true, false}}`
  (`types.d.ts:448-466`). `PRIMITIVE_INPUT_INVALID` carries `field` as a path (`questions.order.criteria.true`)
  and `expected` as a type word — **never the received value** (a value from `state` would be REQ-229's
  sentinel). Constants (Gate 4 owns them; my proposal with one-line reasons): `MAX_DECIDE_QUESTIONS = 32`,
  `MAX_DECIDE_STATE_BYTES = 131072` (jev's 32k-token context ≈ 128 KiB; anything larger fails at the
  provider as a 400 anyway, so refusing first saves a round trip), `MAX_IMAGE_PROMPT_BYTES = 16384`,
  `MAX_INPUT_IMAGES = 4`, `MAX_DECIDE_RESPONSE_BYTES = 1 MiB`, `MAX_IMAGE_RESPONSE_BYTES = 32 MiB` (four
  1024² PNGs base64'd fit; peak memory `imageSlots × 32 MiB × ~2.3` ≈ 150 MB at the default 2 slots),
  `outDir` ≤ 255 bytes, lexically no `..`/absolute (then ARCH-185's realpath rule).
- **C-3 — the script-facing error contract.** (P1) the message grammar is fixed and tested:
  `<primitive> '<label>' failed: <cause> after <n> attempt(s)` where `<cause>` renders as `HTTP <status>`
  when the reason is `http` (the reason word is dropped — the status IS the cause) and as the reason word
  otherwise (`timeout`, `network`, `no_output`, `malformed`, `response_too_large`, `aborted`) — e.g.
  `decide 'gate' failed: HTTP 429 after 3 attempts`, `generateImage 'hero' failed: timeout after 1 attempt`.
  One regex in the UT matches every example the guide prints. `e.code === 'PRIMITIVE_FAILED'` is what a
  script branches on (REQ-227's named error); the grammar is what a human reads in `runs.error`. (P2, separable task) `agentThrow.error.detail?: {status?, attempts, retryable,
  reason}` — closed, JSON-safe, body-free by type — carried through `host.ts`'s envelope, assigned in
  `child-entry.ts`, re-realmed in `sanitizeThrownError`. The agent path never sets it, so every existing
  envelope is byte-identical. A degrade policy that wants `retryable` (fall back to `agent()` vs give up)
  needs P2; REQ-227's acceptance needs only P1. Host fallback code for an uncoded primitive throw:
  `ipcErrorCode(err, 'INTERNAL_ERROR')`, never `'AGENT_ERROR'` (`host.ts:443`), plus a UT that every throw
  path in the two handlers is `codedError`.
- **C-4 — return shapes, as the contract table has them.** `decide → {answers}`;
  `generateImage → {files:[{path, mimeType, bytes, sha256}]}`. No base64, no provider text. (Any additive
  `model`/`latencyMs` on the decide result is the synthesizer's call; I do not push it — the event log has
  both and the tie-break favours the smaller surface.)
- **C-5 — served text and explain surfaces, one list.** `tools/list`: `workflow_register` mentions the two
  declaration blocks; `models_list` enum gains `'decision'` with the three-way description; `run_status`
  documents `agents[].kind` ("absent = agent()"); `system_info` documents the two gauges.
  `workflow_describe`/`workflow_get` project `decisions`/`images` like `agents` (model/timeoutMs/retries, no
  effort). The guide: declaration block, both call signatures, return shapes, the full error table, the bool
  idiom `answers.order.probability >= 0.7`, the wall-time formula, "retries on images can double-bill a
  timed-out generation — use 0–1", "a changed or missing image file regenerates that call and every later
  one on resume", "an error message never contains the provider's response body", and (S-7) "with a USD
  budget, a model the catalog could not price at admission is refused `PRICE_UNKNOWN` — set
  `budget.tokens` or re-admit when the catalog is reachable". Current behaviour only, no history, no issue
  numbers. `GUIDE_EXAMPLES` gains a `decide` gate example (bool → fallback to `agent()`) and an image
  example, both registered by IT-118 against the real booted engine — and asserted to register **without**
  `MODEL_TYPE_MISMATCH` (in CI the catalog is static/unavailable, so the type gate takes the warning arm;
  the test must not mistake a warning for a refusal). README/DEPLOY document `decideSlots`, `imageSlots`,
  `imageInputMaxBytes`.
- **C-6 — registration warnings reach the cold client.** `MODEL_TYPE_UNVERIFIED` rides the register
  response's existing `warnings[]` naming label, model and `modelTypeSource` — so the client sees *why* a
  decision it did not expect was made. The ADR-095 refusal message states the current rule in one sentence
  ("`images.hero` requires a model catalogued `image-gen`; `google/gemini-2.5-flash-image` is catalogued
  `chat`") so an owner flip changes `checkPrimitiveModelType` and that sentence, nothing else.
- **C-7 — `run_status.agents[]` consumers.** `kind` lets them filter. The dashboard slide-in panel renders
  `toolsCount: 0 / skillsCount: 0 / mcpCount: 0` and an empty prompt for a harness-less record
  (`agent-panel.js:305-308`) — honest-ish but misleading for a primitive node. The kind-aware panel is a filed
  v41 candidate; the three-line honest degrade (hide the harness cards when `record.kind` is set) is what I
  would pull in if the task budget allows — one line here, not a key point.

### Agent altitude

The SDK is the typed I/O plus the guide, and REQ-224's cold-client acceptance (a guide-only agent registers
a decide workflow in one try, proven over real MCP at Gate 7.5) is the judge of this whole dimension — not
review. Everything in C-1..C-6 exists to make that first attempt succeed: the error names say which
primitive was misdeclared, the pre-flight says which field is wrong, the warning says why a model was let
through, and the example that is printed is the example that registers.

## 4. Self-sustainability

### System altitude

- **S-1 — the retry loop, line by line.** For `attempt = 1 … retries+1`: `timeoutSignal =
  AbortSignal.timeout(timeoutMs)`; `signal = AbortSignal.any([timeoutSignal, runAbort])`; call the codec with
  `{fetch: seam, maxRetries: 0, apiKey, signal}` and **no** `timeoutMs`/`maxRetryDelayMs`; `classifyAttempt`
  (O-2); on `ok` → price/record/journal; on non-retryable or `attempt > retries` → throw `PRIMITIVE_FAILED`;
  else `backoffMs = min(RETRY_AFTER_CAP_MS, retryAfterMs ?? BACKOFF_BASE_MS × 2^(attempt−1) × (0.75 + 0.25·random()))`;
  a `retryAfterMs > RETRY_AFTER_CAP_MS` fails fast with `retryable: true` (ARCH-183); emit the `retry` event
  with `backoffMs`; `await sleep(backoffMs, runAbort)`. Constants: `BACKOFF_BASE_MS = 250`,
  `RETRY_AFTER_CAP_MS = 10000` (V40-Q5 realtime: a 60-second server hint must not hold a slot for a minute).
  Guide defaults: decide `timeoutMs 5000, retries 2`; image `timeoutMs 120000, retries 0`.
- **S-2 — slot discipline.** The slot is held across the attempts of ONE call (a 429 means the shared key
  is throttled — releasing would let the next call hit the same limit; holding is the backpressure) and
  released in `finally`. It is **not** held across replay or pre-flight (finding #7). The backoff `sleep`
  **must race `runAbort`** — otherwise a stopped run holds a `decideSlots` slot for up to 10 s. Order of one
  call: validate (C-2) → `readContainedInput` (ARCH-185) → replay (`replayValidated`) → `markQueued` →
  `resolveKey` (missing → `OPENROUTER_AUTH_MISSING`, the existing code, as a pre-flight refusal — ARCH-184
  says the caller throws it; this is where) → `primitivePriceKnowable` (pure, from the pin; with
  `budget.usd` → `PRICE_UNKNOWN`) → `withSlot` → `assertBudget` (v25 position) → `markRunning` → S-1 loop →
  price → `addUsage` → `recordPrimitive` → journal → reply with `spent` (the host already piggybacks
  `onBudgetSnapshot()` on `agentResult`, so the script's `budget.spent()` view includes primitive spend for
  free). **The two refusals that fire before `markQueued`** (`PRIMITIVE_INPUT_INVALID`, `IMAGE_PATH_REFUSED`)
  must not recreate v25's gap ("a refused call had no record at all"): replay has to stay ahead of
  `markQueued` (a hit must not leave a stuck `queued` record), so at those two refusal sites the handler
  allocates the agentId and calls `markQueued` + `markRefused(code)` itself before throwing — a refused
  primitive is visible in `run_status.agents[]` with its code, exactly like a budget refusal.
- **S-3 — abort semantics.** `workflow_stop`/`workflow_suspend` aborts the in-flight fetch and the backoff
  via `runAbort`; `classifyAttempt` → `aborted`; the record ends `failed` with `failReason:'aborted'`; the
  journal row is `{value: null, aborted: true}` exactly like D-F13's agent row, so resume re-runs it live;
  the event is `failed` with `reason:'aborted'` (an operator must be able to see that a stop killed N
  in-flight calls).
- **S-4 — resume that verifies (`replayValidated`).** `replayValidated(callSeq, key, validate: (v) =>
  Promise<boolean>)`: same `_missed` state, same `sameKey`, then `await validate(entry.value)`; `false` sets
  `_missed` (first-miss rule, V40-Q18). The image validator is ARCH-185's `verifyFiles` (exists, regular,
  contained, sha256 matches). Deterministic file names `<label>-<callSeq>-<i>.<ext>` mean a regenerated
  image `rename`s over the stale one — resume is idempotent on disk. `replay` itself is untouched.
- **S-5 — what gets a journal row, and why.** Journal rows exist for: a settled `ok` (`{answers}` /
  `{files}`), an abort (`{value:null, aborted:true}`), and — **my recommendation, flagged for the
  synthesizer** — a terminal `PRIMITIVE_FAILED` after retries, as `JournalEntry.thrown?: {code, message}`
  (additive, optional; `agent()` never writes it), replayed by re-throwing the same coded error through
  `replayValidated`. Rationale: `agent()`'s terminal failure IS journaled (as the null the script saw) and
  replays deterministically; a thrown primitive with no row would MISS, and the first-miss rule then re-runs
  **every later `agent()` live** — paying twice for agents because a 200 ms classifier failed once, which is
  the opposite of REQ-226's intent. The cost of journaling it: a transient failure is frozen into that run's
  replay — for webhook-per-DM runs (V40-Q5) a new run is the natural retry, so I accept it. Pre-flight
  refusals (`BUDGET_EXCEEDED`, `PRICE_UNKNOWN`, `PRIMITIVE_INPUT_INVALID`, `IMAGE_PATH_REFUSED`) get **no**
  row — exactly `agent()`'s `BUDGET_EXCEEDED` gap — so a resume with a raised budget or a fixed catalog
  re-attempts them. Either way INV-V40-6 ("journaled exactly as agent() is") is what resolves the question;
  the DES should say which reading it took.
- **S-6 — memory and disk bounds.** Response caps (C-2) bound the seam; `writeImages` decodes base64 to a
  Buffer and writes tmp+rename (ARCH-185) — tmp name `.<final>.tmp-<pid>-<rand>` in the same contained
  directory (a `workspace_list` racing a write may list the tmp file for milliseconds; acceptable, named).
  Workspace growth rides REQ-026's TTL GC; the git baseline is only `workspace_diff`'s base, so generated
  images appear there as new files — correct, they are deliverables.
- **S-7 — fail posture per door.** Registration: catalog outage → `unknown` → warn, never block (ARCH-189,
  the right posture for a door). Admission under outage: the pin holds `null` rates → with `budget.usd`
  every primitive is refused `PRICE_UNKNOWN` **deterministically** for that run (`refused` events, named
  code) — the correct fail-closed-on-money posture (V40-Q12), and a NEW failure mode the guide must name
  (C-5) and the event's `errorCode` must show. Without a USD budget the run proceeds unpriced
  (`unpricedCalls` in the summary).
- **S-8 — no breaker, no probe (ruled).** The liveness signals that exist instead: the `queued` gauge
  (O-9), the per-model observed bucket (O-6), the `retry-after` cap + semaphore as backpressure. A provider
  outage costs at most `(retries+1)×timeoutMs + retries×RETRY_AFTER_CAP_MS` per call, the number the guide
  prints.

### Agent altitude

Memory metabolism: N/A (stated once). Liveness: the measured success/p95 on the model's `models_list` row
(O-6). Calibration: an author picks a decision model that is *measured* to work; there is no prompt to
calibrate. Budget: overshoot ≤ `slots × maxPerCallCost` (ADR-092), negligible for decide, bounded by
`imageSlots = 2` for images.

## 5. Task-splitting — where the cut changes whether a quality is testable

Suggested order (the synthesizer owns the numbering):

- **T-A foundation first:** `src/direct-models/{call,fetch-seam}.ts` (seam, `classifyAttempt`, backoff,
  `toPiAiModel`, `PRIMITIVE_API`), `src/gateway/openrouter-key.ts` lift, and `tests/helpers/stub-fetch.ts`.
  Every later task's RED tests (REQ-227 per-attempt events, REQ-230 p95, REQ-229 sentinel) run through this
  helper, so it cannot be parallel with them.
- **T-B catalog:** `?output_modalities=all`, `'decision'`, `imageOutPerM`, enum text — with the **golden
  snapshot of the pre-change chat rows written BEFORE the URL changes** (RED first, REQ-222 last clause).
- **T-C registration:** contract + scanners + mermaid + `CALLABLE_API_NAMES` + type gate + pin reach
  (`reachableModels`, `toModelCatalogSnapshot` carrying `modelType`) + the registration refusal codes in
  `ERROR_CATALOG`. One task: `parsePrimitiveContract` needs the type gate's verdict shape.
- **T-D sandbox surface:** `guards.ts`/`child-entry.ts`/`host.ts`/`protocol.ts` — no local value imports;
  P2 `detail` passthrough lives here if taken.
- **T-E handlers (split E1 decide / E2 image if needed, E1 first):** `_handleDecideRequest`,
  `recordPrimitive`, `replayValidated`, `pricePrimitiveCall`, event kind, **and in the same task**
  `foldUsage` guard + `deriveAgentRecords` usage branch + `observed-stats` kind + the extended IT-156/DES-188
  locks — the two folds and the reconstruction agree only if edited together. E2 adds `image-files.ts`
  (with the planted-symlink cases ARCH-185 demands) and `_handleImageRequest`.
- **T-F config:** `decideSlots`/`imageSlots`/`imageInputMaxBytes` → `KNOWN_FILE_CONFIG_KEYS` +
  `composeConfig` + gauges; the UT-219 sweep (`compose-config-v2-wiring.test.ts:459`) gets them as
  **probed** entries, never "excluded". Tiny and separate because of the thrice-bitten class.
- **T-G served text:** `ERROR_CATALOG` runtime rows + `ENGINE_REFUSAL_CODES` + `RECORDED_REFUSAL_CODES` in
  ONE commit (UT-304's drift guard; extend it to assert each new code's set membership), guide sections,
  the two `GUIDE_EXAMPLES`, `workflow_describe`/`workflow_get` projection, README/DEPLOY.
- **Cross-cutting, scheduled last:** the REQ-229 sentinel (needs every emit site to exist — scheduled
  earlier it is green for the wrong reason) and the REQ-230 end-to-end bound.
- **T-H validation artefact:** the US$1 real run — records what the wire returned, flips
  `IMAGE_USAGE_INCLUDE` if needed, and hands sanitized bodies back to R-4's fixtures.

## Key points (ranked)

1. **`classifyAttempt()` reads the engine's signals first** (O-2) — the only design under which REQ-227's
   timeout retry exists at all given pi-ai's `aborted`/`error` collapse.
2. **Primitive records survive restart and both folds agree** (O-5/O-6, finding #3/#4): usage event carries
   the harness-less fields; `foldUsage` counts a tokenless priced event; locks extended.
3. **The script contract is code + message grammar** (C-3 P1), `detail` passthrough optional (P2); host
   fallback `INTERNAL_ERROR`.
4. **Pre-flight before the slot, budget after it, `markQueued` before both** (finding #7, S-2); the slot is
   held across one call's retries; backoff races `runAbort`.
5. **`replayValidated` beside `replay`** (S-4) and **a journal row for a terminal `PRIMITIVE_FAILED`**
   (S-5, flagged) so a failed classifier does not re-run every later agent on resume.
6. **`onPayload → usage.include` for images** (O-4) as a Gate-7.5-flipped constant — REQ-225 tier 1 by design.
7. **Event fields fixed:** `agentId`, `reason`, `backoffMs`, `engineMs = total − Σprovider − Σbackoff`,
   cost fields on `ok` only (O-3); gauges with `queued` (O-9).
8. **Constants proposed with reasons** (C-2, S-1) including the new `maxRetries` ceiling (C-1).
9. **Three test shapes specified:** sentinel with positive control (O-7), REQ-230 through the real child
   (O-8), golden wire fixtures fed back from Gate 7.5 (R-4).
10. **Task cuts that preserve testability** (§5): folds+reconstruction in one task; refusal sets in one
    commit; config keys probed in UT-219; sentinel last.

## Risks

- **Timeout/abort conflation** if an implementer reads `stopReason` (finding #1). Mitigation: `classifyAttempt`
  is pure with a UT per signal combination; the REQ-227 timeout test uses a stub `fetch` that never resolves.
- **`foldUsage` guard change** touches the at-rest fold every run reads on resume. Mitigation: the guard is a
  strict widening (agent events always carry `tokens`), and IT-156's deep-equal lock gains the primitive case.
- **`usage.include` on the image route** is OpenRouter-documented for chat completions but unverified on an
  image model; if rejected, the constant flips and nothing else moves. The `/systemone` body may carry no
  cost at all — the precedence never requires it (ADR-091).
- **`detail` passthrough (P2)** widens the shared `agentThrow` envelope; if refused, P1's grammar is the whole
  contract and the guide says so.
- **`deriveAgentRecords` usage-branch extension** is a hot reconstruction path; protected by the existing
  DES-188 lock for agents and its extension for primitives.
- **Journaling a thrown `PRIMITIVE_FAILED`** (S-5) freezes a transient failure into a resumed run; the
  alternative re-runs every later agent live. Flagged, not silent.
- **`network` as retryable** is an interpretation beyond REQ-227's literal set; one line to flip.
- **Catalog outage at admission + USD budget** refuses every primitive of that run (S-7) — correct and
  deterministic, but new; named in the guide and visible as `refused` events.
- **`AbortSignal.timeout` per attempt** at webhook volume: Node 22 registers weak listeners for
  `AbortSignal.any`; no leak expected, but the REQ-230 100-call test is also the place a MaxListeners warning
  would surface — assert `stderr` is empty there.
- **Stub fidelity before Gate 7.5:** the 429 body / `retry-after` shapes are assumed; the per-attempt event's
  `status` is seam-observed so it is real regardless, and T-H closes the loop.

## Expected disagreements with other lenses

- **Adversarial / security:** may want `network` non-retryable (strict owner set) and will scrutinize the
  P2 `detail` field as new surface across the sandbox boundary; I present P1 as sufficient for REQ-227 and
  P2 as separable. They may call `usage.include` an unverified wire change — hence a constant, not a key,
  flipped by evidence. On pre-flight-before-slot they may prefer "everything after the slot" for simplicity;
  my counter is REQ-228's contended resource: a refused call must not queue on the key's semaphore. We agree
  on body caps as stream bounds, engine-chosen file names, and the planted-symlink tests.
- **Simplicity / performance:** `classifyAttempt` as a separate pure function, `backoffMs`/`agentId`/`reason`
  on the event, and `replayValidated` as a second method will read as more surface. Each is tied to an
  acceptance line: REQ-227 (timeout retry), REQ-230 (a meaningful `engineMs`), REQ-226 (image validation
  without changing `replay`'s type). I conceded the port at Gate 2; I am not re-arguing it.
- **Testability lens:** may prefer the REQ-230 measurement host-only (`engineMs` alone). I keep the
  end-to-end bound through the real child because the script-side clock is guarded and host-only numbers
  cannot see IPC/child dispatch — the two together are the honest reading of "script 端觀測到的耗時".
- **Dashboard / UX:** the kind-aware panel is v41; the three-line honest degrade is optional here.
- **Owner-level:** nothing new. ADR-095 stays pending; S-5 (journal the thrown terminal failure) and O-2
  (`network` retryable) are flagged for the synthesizer, and both are one-line reversals.
