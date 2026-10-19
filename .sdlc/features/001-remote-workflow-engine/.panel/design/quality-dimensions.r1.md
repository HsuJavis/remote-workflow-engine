# Quality-dimensions lens — Design stage, round 1 (independent proposal) — v41

**Scope:** iteration **v41 — issue #168 delta-gates** (gates `[design, tests, impl, verify, validation,
review]`, impactIds REQ-227 (v41 delta), REQ-231, REQ-232 and their closure; `01-requirements.md:3174-3261`).
QM. There is **no Gate 2 in this iteration**: the v40 architecture (`02-architecture.md:6512-6910`,
ARCH-183..194, ADR-087..095, INV-V40-1..7, the v41-candidates list) is the standing architecture, and
every architecture-level consequence below is written as an **in-place `iter: v41` amendment the design
synthesizer must record**, not as a new ARCH/ADR row. Inputs read in full: the v41 requirements section
and REQ-227's v41 addendum; the v40 architecture slice; `state.yaml` `tech_stack` and the v41
requirements gate note; the RED recipes and determination scripts (`evidence/v41/red/red-168.mts`,
`evidence/v41/det/{hold-body,undici-race,sweep,variants}.mjs`); the diagnosis logs in the session
scratchpad (`i168/logs/round3.cpuprofile`, `round3-instr.log`, the three `round3-status-*.json`); the
issue text and its reproduction comment (`gh issue view 168`); and — verified against source, not taken
from prose — `src/direct-models/call.ts` (the whole file), `src/run-manager.ts:240-275, 595-690,
3100-3290`, `src/agent-executor.ts:297-366, 760-793`, `src/run-store.ts:140-215`,
`src/gateway/claude-agent-sdk-client.ts:1325-1400, 1540-1600`, the installed
`@anthropic-ai/claude-agent-sdk@0.3.199` `sdk.mjs` (the `lI(e,t,r,o,n=D6())` lookup and `D6()`'s
`process.report.getReport()`; the `nh=u.pathToClaudeCodeExecutable; if(!nh){… lI(…) …}` short-circuit in
`query()`), `src/server.ts:1664-1690` (`/api/status`), `src/system-info.ts:92-121`,
`src/agent-semaphore.ts:42`, `src/authoring-guide.ts:938-982`, `docs/AUTHORING.md:114`,
`src/tool-specs.ts:797`, `src/params/contract.ts:83`, `tests/helpers/stub-fetch.ts`,
`tests/unit/primitive-record-failed.test.ts` (UT-358), `tests/integration/primitive-latency.test.ts`
(IT-314), and the v40 design rows DES-264/267/273/274 (`04-design.md:10417-10669`).

**Correction to the task text.** `03-tasks.md` exists (TASK-001..275; the v40 section is
`03-tasks.md:2522-2695`). What does not exist is its **v41 section**; §5 below is written for the
synthesizer who adds it. Likewise `04-design.md` already holds DES-264..279 for v40 — v41 rows are
deltas on those plus a small number of new rows.

**Supersession note.** This exact path held the v40 design-stage round-1 proposal, committed at
`ccda4c6` and removed with `.panel/` at the v40 Gate 8 close. `git show
ccda4c6:.sdlc/features/001-remote-workflow-engine/.panel/design/quality-dimensions.r1.md` reaches it per
CLAUDE.md. Nothing is checked out, restored or stashed; this file is a fresh write.

**Scope discipline.** No ADR is re-opened and none is minted. In particular I do **not** re-raise the
per-model circuit breaker or the `models_probe` (ADR-092 and the v41-candidates list both say they need
an owner ask, and #168's root cause was not provider health — a breaker would have *hidden* it: the
calls that hung never reached the wire-observable failure a breaker counts). No new `rwe.config.json`
key is proposed anywhere below (the `composeConfig()` wiring bug class has bitten three times; every
tunable here is an injectable seam with a constant default). Served text changes describe current
behaviour only, no history, no issue numbers. I do not mint DES/TASK/UT/IT/VAL ids; I cite the existing
ones a change flips or extends.

## Altitude call

Both altitudes apply, unevenly. The engine is a **system** that hosts **AI-agent** runs; the three v41
requirements sit at different heights:

- REQ-227 (delta) and REQ-231 are about `decide()`/`generateImage()`, which the v40 Gate 2 ruled are
  **not agents** (one HTTP request, a typed answer, no session, no chain-of-thought). Their agent-altitude
  reading is thin and already settled (REQ-229: metadata is the whole inspectable surface, inputs are
  forbidden). What #168 showed is that the **system-altitude** observability of that one HTTP request is
  where the engine went dark: a call that never ends, a record with no `kind`, a reason that reads
  `"no failure detail recorded"`.
- REQ-232 is about `agent()` *launch* — the SDK harness — and is pure system altitude: a synchronous
  `process.report.getReport()` inside the SDK's own `query()` setup stalls the engine's single event loop
  for seconds when the process holds dozens of sockets. Its agent-altitude counterpart is small but real:
  the cost of starting a harness must itself be a visible number, not a profile someone attaches once.
- **Memory metabolism is N/A** for this slice (nothing accumulates across calls); stated once so no round
  spends budget on it. Tool-liveness and self-reflection reduce to: the retry loop's bound is real, and
  the engine can see its own stalls.

## Summary — what the Design stage must settle (ranked)

Eight findings. Each is DES-row-sized; none reopens an ADR; each is written against the code as it is
today, not against the architecture's description of it.

1. **The attempt bound is not a bound.** `readCapped` (`call.ts:130-160`) awaits `reader.read()` with no
   race against the attempt signal; Node 22.22.3's bundled undici 6.24.1 drops an abort that lands between
   `onComplete` and body delivery (RED (B): 30/30 hang), and a provider that sends headers and never sends
   a body (RED (A)) hangs it forever. The `attemptSignal` timer fires, nobody listens, the slot is held,
   the call is `running` with `lastActivityAt: null` for the rest of the run (round 3: 60 later `decide`s
   queued behind it). **Design (S-1/O-1):** the inner race lives in `makeObservedFetch` — it has
   `init.signal` — every `reader.read()` is raced against that signal; on abort `reader.cancel()` is fired
   (not awaited) and the read rejects with `AbortError`; the seam records **which stage** the attempt was
   in (`request` / `body` / `done`). A per-attempt **settle grace** (`ATTEMPT_SETTLE_GRACE_MS`, constant,
   its own timer cancelled the moment the attempt settles) in `runWithRetry` is the belt for anything that
   still ignores abort; **where the grace sits is a Gate-5 interpretation item** (per-attempt vs per-call
   — see S-1) and I take per-attempt with the reason.
2. **`network` is classified non-retryable** (`call.ts:229`, `retryable: false`, DES-267's own text
   "V40-Q9 names only 429/5xx/timeout"). REQ-227 v41 reverses that. **Design (S-2):** one line flips;
   the seam additionally records a **token-only cause code** (`ETIMEDOUT`, `ECONNRESET`, `UND_ERR_SOCKET`
   — `/^[A-Z][A-Z0-9_]{1,31}$/`, else absent) so the `retry`/`failed` event says *which* network class,
   body-free by construction.
3. **The attempt timer is never cleared** (`call.ts:89`: `setTimeout(() => ctrl.abort(), ms)` with no
   handle). A successful 20 ms decide leaves a 5 s timer; a successful image call leaves a 120 s one.
   **Design (S-3):** `attemptSignal` returns `clear()`; the loop clears in `finally`; the composite signal
   stops using `AbortSignal.any` and forwards the run signal through an explicit listener removed in the
   same `finally`, so a 300-call run's listener count on `runSignal` is provably 0 after each call
   (`getEventListeners(runSignal, 'abort')` — `AbortSignal.any`'s dependants are invisible to it, which
   is why the explicit form is the testable one).
4. **Three failure vocabularies for one failure.** The script sees `network` (grammar, `call.ts:283-303`);
   `run_agent_log` sees `failReason: 'unreachable'` (`primitiveFailReasonFrom`, `run-manager.ts:252-262`
   collapses `network→unreachable`, everything else→`terminal`); `run_status.agentFailures` sees
   `reason: 'error', message: 'no failure detail recorded'` (`failureReason`/`failureMessage`,
   `run-manager.ts:630-661`, because `recordPrimitive` never writes `detail`). **Design (O-3/C-1):** ONE
   vocabulary — `AttemptReason` — reaches all three: the primitive record's `failReason` IS the reason word
   (union widened additively; the agent path still writes its four words), its `detail` IS the constructed
   grammar string (already body-free, ADR-093), and `agentFailures` for a `kind`-bearing record returns
   `{reason: failReason, message: detail}`. The restart path needs no new derivation: `deriveAgentRecords`
   already reads `data.reason` and `data.detail` on the failed branch (`run-store.ts:204, 208`) —
   `recordPrimitive` just has to write `detail` onto the usage event.
5. **A live primitive record is indistinguishable from an agent record until it terminates.**
   `markQueued` (`agent-executor.ts:297`) takes no `kind`/`model`/`provider`; the served text says
   "`kind` absent = `agent()`" — so the reporter's hung call read as an agent with `provider: ''`. The one
   record that most needed to say what it was could not. **Design (O-4):** `markQueued` gains
   `kind?`/`model?`/`provider?`; `markActivity` (exists, `agent-executor.ts:364`) is called per attempt
   from `onAttempt`, so a progressing retry loop and a hung call differ in `lastActivityAt` — the exact
   discriminator #20 built for agents.
6. **`getReport()` on every `agent()` launch.** The SDK's `query()` resolves the CLI binary per call
   unless `options.pathToClaudeCodeExecutable` is set, and that lookup's default parameter `n=D6()` calls
   `process.report.getReport()` synchronously to detect musl. The engine never sets the option
   (`claude-agent-sdk-client.ts:1346-1377`). Round-3 CPU profile: **23.4 s of 35.8 s non-idle time
   (65 %) is `getReport` self-time**; `spawn` is next at 4.7 s (~26 ms per launch, the residual tail).
   Event-loop lag in the same run's instrumentation log: max 7103 ms, with 6001, 857, 794 and 647 ms
   samples also present. **Design (R-1/S-5):** resolve
   the binary **once** at gateway construction through an injectable resolver anchored at the SDK package
   (`createRequire` of the SDK's own `package.json`, so a differently-hoisted copy cannot win), decide musl
   once, pass `pathToClaudeCodeExecutable`; emit one boot event naming the path; if unresolvable, leave
   the SDK's default and emit a warning event — the degrade is visible, never silent.
7. **The stall was invisible to the engine itself.** The 7.1 s stalls were found by CDP and an ad-hoc
   instrumented build; nothing the engine serves could have shown them. REQ-232's acceptance names the
   instrument ("以 event loop 延遲監看量測"). **Design (O-6):** make it permanent — a
   `monitorEventLoopDelay` sampler exposed as `eventLoop: {p50Ms, p99Ms, maxMs, windowMs}` on
   `/api/status`'s full branch (beside the two v40 gauges, `server.ts:1680-1684`) and on
   `system_info.process`, reset per sample window, plus a rate-limited `engine.loop_stall` event when a
   window's max crosses REQ-232's own ceiling. The REQ-232 integration test and the real-tier validation
   then read the **same module**, and the real-tier number is the engine's own, exactly as REQ-230's
   `engineMs` is.
8. **Served text and ledger drift.** The guide's worst-case formula (`authoring-guide.ts:979`,
   `AUTHORING.md:114`) gains the grace term and loses "only 429/5xx/timeout" as the retry set; the
   `run_status` description's `agentFailures.reason` enum (`tool-specs.ts:797`) widens; and the Gate 8
   round-2 drift (DES-264/267 enumerating `AttemptReason`/grammar without `write`, `07-review.md:15697`)
   is fixed by the v41 design delta because it rewrites those rows anyway.

## 1. Observability

### System altitude

- **O-1 — the seam records where an attempt died.** `SeamRecord` (`call.ts:98-105`) gains
  `stage: 'request' | 'body' | 'done'` and `cause?: string`. `stage` is set `'request'` on entry, `'body'`
  once `deps.fetch` resolves (headers in), `'done'` when `readCapped` returns. `cause` is the fetch
  rejection's `cause.code` (undici/errno) **only if** it matches `/^[A-Z][A-Z0-9_]{1,31}$/`; anything else
  (a message, a path, provider text) is dropped. `AttemptObservation` carries both; `_emitPrimitiveCall`
  forwards them on `retry`/`failed` events (ARCH-192 amendment, additive fields, `iter: v41`). Reading
  three lines then answers the questions the diagnosis needed CDP for: `reason:'timeout', stage:'body'`
  is the undici race or a stalled provider stream; `reason:'network', cause:'UND_ERR_SOCKET'` is a
  reused dead keep-alive; `reason:'timeout', stage:'request'` is a slow provider. The type still has no
  field that can hold `state`/`prompt`/questions/body (INV-V40-3 holds by construction; `cause` is a
  token by regex).
- **O-2 — the settle grace is itself an event.** When the per-attempt grace fires (the attempt promise
  did not settle within `ATTEMPT_SETTLE_GRACE_MS` of the abort), the attempt is classified
  `reason:'timeout'` with `stage` as recorded **and** `settled: false` on the event — an operator can
  count how often the engine had to abandon a promise rather than see it end. If that count is non-zero
  in production, the undici race is still live under the installed Node; if it is zero for a release,
  the belt did nothing and can stay a constant.
- **O-3 — one vocabulary, three surfaces (REQ-231).** `types.ts`:
  `AgentRecord.failReason?: 'timeout' | 'unreachable' | 'terminal' | 'aborted' | AttemptReason` (the
  agent path writes only the first four — INV-V40-1 untouched); `AgentRecord.failStatus?: number`
  (primitive `http` only; optional, mirrors `primitive.call.status` — the synthesizer may drop it, the
  message carries `HTTP <status>` regardless); `AgentFailureSummary.reason` widened with `AttemptReason`.
  `recordPrimitive` gains `detail: string` (the exact `PRIMITIVE_FAILED` message the script received) and
  `failStatus?` and writes both onto the record **and** the usage event (`data.detail`,
  `data.failStatus`); `primitiveFailReasonFrom` dies — replaced by
  `detail?.reason ?? (runAborted ? 'aborted' : 'terminal')` where `'terminal'` is only the no-`.detail`
  engine-fault fallback (that throw is not a `PRIMITIVE_FAILED` and REQ-231 does not bind it).
  `failureReason(a)`: a record with `kind !== undefined && failReason !== undefined` returns `failReason`
  verbatim before the agent mapping; `failureMessage(a)` already prefers `detail`. Result, for one
  network-exhausted decide: thrown `decide 'b' failed: network after 4 attempts`; `run_agent_log`
  `failReason:'network', detail:"decide 'b' failed: network after 4 attempts"`; `agentFailures`
  `{reason:'network', message:"decide 'b' failed: network after 4 attempts"}`. **The equality claim is on
  `e.message` — the grammar body.** The sandbox child rebuilds the throw as `new Error(message)` with
  `name = code` (`child-entry.ts:207`, DES-169), so `String(e)` renders `PRIMITIVE_FAILED: decide 'b'
  failed: …` — the prefix the issue quotes is that rendering, not part of the message, and is outside
  the three-surface equality. **Two image arms do not hold the rule today and the DES must name them:**
  the `no_output` arm (`run-manager.ts:3466`) hand-builds `PRIMITIVE_FAILED: generateImage('hero')
  produced no usable image output after N dropped` via `codedError` — not the grammar — and records
  `failReason:'terminal'`; it must throw through `primitiveFailedError('generateImage', label,
  'no_output', attempts, undefined, false, spend)` like every other arm. The `write` arm
  (`run-manager.ts:3452`) already throws the grammar but records `failReason:'terminal'`; both become the
  reason word (`'no_output'`/`'write'`) and carry `detail`. ARCH-187's failReason sentence is amended in
  place (`iter: v41`). Known asymmetry, recorded not fixed: an agent's `unreachable` and a primitive's
  `network` name the same class with two words; unifying the agent vocabulary is INV-V40-1's territory and
  not this slice's.
- **O-4 — the live record says what it is.** `markQueued(agentId, {label, agentKey, frame, phase,
  kind?, model?, provider?})`; both handlers pass `kind`, the provider-less `model` (R-34 form) and
  `'openrouter'` at step (5). `onAttempt` calls `markActivity(agentId, isoNow())` on every retry/failed
  observation (ARCH-187 amendment: the hung-vs-progressing discriminator #20 defined for agents applies
  to primitives). `run_status.agents[]` for an in-flight primitive then reads `kind:'decide',
  model:'typesafe/jev-1.13', provider:'openrouter', lastActivityAt:<advancing>` — the four facts the
  reporter could not get.
- **O-5 — the gateway says what it launches.** New `EngineEvent` kinds (additive to `event-log.ts:10+`,
  redacted by the sink like every kind): `{kind:'gateway.cli_resolved', path, musl, resolveMs}` once at
  `ClaudeAgentSdkGatewayClient` construction, and `{kind:'gateway.cli_unresolved', candidates:
  string[]}` when the resolver finds nothing (the SDK's per-call lookup is then left in place and will
  throw its own "Native CLI binary … not found" at the first `agent()` — the warning simply moves that
  knowledge to boot). Real-tier check: `ps aux` shows the spawned CLI's argv[0] equals the event's `path`
  (the same verification shape Gate 7.5 round 3 used for `--model`).
- **O-6 — the event loop is a served number (REQ-232).** `createLoopLagMonitor({resolutionMs: 20})`
  wraps `perf_hooks.monitorEventLoopDelay`; `sample()` returns `{p50Ms, p99Ms, maxMs, windowMs,
  stallCount}` and resets the histogram, where `windowMs` is time since the previous sample (the same
  prev/cur convention `SystemInfoSampler` uses for CPU utilisation, `system-info.ts:155-185`).
  Surfaces: `/api/status` full branch `eventLoop` (beside `decideSemaphore`/`imageSemaphore`, same
  operator-only rule, `server.ts:1680-1684`); `system_info.process.eventLoop`; and
  `{kind:'engine.loop_stall', maxLagMs, p99Ms, windowMs}` emitted from `sample()` when
  `maxMs > LOOP_STALL_EVENT_MS` (constant = REQ-232's 1000 ms), at most once per window. No config key.
  The REQ-232 acceptance test instantiates the **same** monitor in-process; the real-tier validation
  polls `/api/status.eventLoop` during the rerun (§4 S-6). Degrade: if `monitorEventLoopDelay` is
  unavailable (it is not, on Node ≥ 22.19 — `package.json` `engines`), the field is `{reason:
  'unavailable'}` in the existing `Degraded` shape, never absent.
- **O-7 — the sentinel sweep grows two cases (REQ-229 under REQ-231).** `detail` is a new string on a
  served record, so the IT sentinel sweep (DES-274 §Sentinel; VAL-287) adds: (a) a network-exhausted
  decide whose stub rejection `cause.code` is a free-text string containing a sentinel (must be dropped by
  the token regex); (b) a 4xx whose body echoes the sentinels (already there) now also asserted against
  `run_agent_log[].detail` and `agentFailures[].message`. Positive control unchanged: the stub's captured
  request bodies contain the sentinels.

### Agent altitude

For `decide()`/`generateImage()` nothing changes at this altitude: the `ok` event's `answers`/files and
tokens remain the whole reasoning surface (REQ-229). For `agent()`, REQ-232 adds the one number that was
missing about the harness itself: what launching it cost the engine, as `gateway.cli_resolved` at boot and
`eventLoop` at run time. An operator asking "why did every `decide` at 10:19 time out at `stage:'body'`"
reads `eventLoop.maxMs` for the same minute and sees the stall, without a profiler.

## 2. Replaceability

### System altitude

- **R-1 — the CLI path is resolved by the engine, once, through a seam.** New
  `src/gateway/claude-cli-path.ts` (pure given its deps):
  `resolveClaudeCliExecutable(deps: {resolve: (spec: string) => string; exists: (p: string) => boolean;
  platform: NodeJS.Platform; arch: string; musl: boolean}) → {path: string; candidates: string[]} | null`
  — the SDK's own candidate order (`@anthropic-ai/claude-agent-sdk-${platform}-${arch}[-musl]/claude[.exe]`,
  musl-first when `musl`), nothing else. `detectMusl(getReport: () => {header?: {glibcVersionRuntime?:
  unknown}} | null) → boolean` is called **once** at construction (cheap at boot: the process holds a
  handful of handles, the 7 s cost was the handle dump under load). `defaultCliPathDeps()` builds
  `resolve` from `createRequire(createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk/
  package.json'))` — anchored at the SDK package, which is where `sdk.mjs` itself resolves from — and
  `exists` from `fs.existsSync`. `ClaudeAgentSdkGatewayConfig.cliExecutable?: string | null` is the
  injection point: `undefined` → resolve once in the constructor; a string → use it; `null` → leave the
  SDK default (tests that want the SDK's own lookup). `options.pathToClaudeCodeExecutable` is set from the
  stored value at `claude-agent-sdk-client.ts:1346`'s `options` literal. This is the SDK's **documented**
  option, so the fix is a config-not-rewrite change on the engine's side and removes a per-call dependency
  on the SDK's lookup heuristics; a future `rwe.config.json` key, if an owner ever asks, lands on the same
  seam without touching the client. INV-V40-1 is unaffected (agent() behaviour: tool surface,
  confinement, gateway choice — REQ-232's own last clause — is unchanged; only one option is added), but
  the architecture row for the SDK gateway (ARCH-007 lineage, `tech_stack` "ClaudeAgentSdkGatewayClient")
  carries an `iter: v41` delta bullet naming the resolved-once path.
- **R-2 — the retry/timeout authority stays in one module.** Every v41 change to REQ-227 lands inside
  `src/direct-models/call.ts` and its `DirectDeps` (`attemptSignal` gains `clear()`; nothing else on the
  seam changes shape). pi-ai is still called with `maxRetries: 0` and no `timeoutMs` (DES-267's rule); the
  pin stays `1.0.0`; the real codec stays in every test (ADR-089). The undici race is a **runtime**
  property of Node 22.22.3 / undici 6.24.1: the engine-side guard is written so a future Node that fixes
  the race leaves the RED (B) lock green (abort → rejected read is also "ended within bound"), and a
  Node that reintroduces it is caught by the same lock. If the race proves hard to live with, the escape
  is already a seam: `deps.fetch` can be an undici `Agent`-backed fetch with `bodyTimeout` — named here as
  the option, **not** designed.
- **R-3 — the lag monitor is a module with one Node dependency.** `createLoopLagMonitor` imports
  `node:perf_hooks` only; `SystemInfoSampler` receives it as a dep (injected, like its clock), so unit
  tests pass a fake histogram and the integration tier uses the real one. Swapping the instrument (an
  OpenTelemetry exporter, later) is a second consumer of `sample()`, not a rewrite.
- **R-4 — vocabulary widened, not forked.** `AttemptReason` stays defined once (`event-log.ts:72`);
  `types.ts` imports the type for `AgentRecord.failReason`/`AgentFailureSummary.reason` rather than
  re-listing the words. One source, three consumers — a future reason word is one edit plus the grammar
  regex (`PRIMITIVE_FAILED_GRAMMAR`, already shared by `errors.ts`/the guide).

### Agent altitude

Backend swap is unchanged: `meta.params.decisions.<label>.model.default` or a run override. For `agent()`
the SDK remains the harness and the CLI binary remains the SDK's own optional dependency; R-1 only moves
*which process decides where it is* from per-call inside the SDK to once inside the engine. A different
harness (`gateway: 'pi'`) is untouched by this slice.

## 3. Consumability

### System altitude

- **C-1 — the script-facing contract does not change shape; it changes truth.** `e.code ===
  'PRIMITIVE_FAILED'` and the grammar `<primitive> '<label>' failed: <cause> after <n> attempt(s)` are
  byte-identical; the reason words are the existing closed set (now including `write`). What an author
  observes differently: a connection-level failure is retried up to `retries` (so `after 4 attempts`
  where it used to say `after 1 attempt`), and a body-never-ends attempt ends as `timeout` within the
  printed bound instead of never. Zero API change, so IT-317's R-8 grammar case and UT-342's grammar regex
  stay as they are; only UT-342's "network error → not retried" case and TASK-263's dod sentence flip.
- **C-2 — three surfaces, one answer (REQ-231 as a caller sees it).** A client that reads
  `run_status.agentFailures[].reason` can now branch on `'network' | 'timeout' | 'http' | …` exactly as
  the script branched on the message; `message` equals the thrown message, so a dashboard and a script
  log agree character-for-character. `tool-specs.ts:797`'s `run_status` description enumerates the
  widened `reason` set and says in one sentence that for a `kind`-bearing entry `reason` is the primitive
  failure class and `message` is the same text the script received. `run_agent_log`'s description does
  not enumerate `failReason` today (checked), so nothing there to update beyond `detail`'s presence on a
  failed primitive record.
- **C-3 — the guide's formula and retry set, corrected.** `authoring-guide.ts:979` (and the regenerated
  `AUTHORING.md:114` via `scripts/gen-authoring-md.ts`): "Worst-case wall time for one call (every attempt
  stalling) is bounded by `(retries+1) × (timeoutMs + 1s) + retries × 10s` — the 1 s is the fixed
  per-attempt settle grace, the 10 s the per-retry backoff cap." The retry set sentence states: "retried:
  429, 5xx, a per-attempt timeout, and a connection-level failure (connect timeout, reset, dead keep-alive)
  — anything where the provider sent no HTTP status; not retried: other 4xx, a malformed answer, an
  oversized body, a write failure." Both built from the constants (`ATTEMPT_SETTLE_GRACE_MS`,
  `RETRY_AFTER_CAP_MS`), never typed as numbers. `ERROR_CATALOG`'s `PRIMITIVE_FAILED` hint stays; no new
  code. `workflow_describe`'s `worstCaseMs` (`workflow-view.ts:107, 233`) is the agent harness ladder
  only (DES-278 boundary) and is not touched.
- **C-4 — the new operator surfaces are documented where their siblings are.** `system_info`'s
  description (`tool-specs.ts:1629+`) names `process.eventLoop {p50Ms, p99Ms, maxMs, windowMs,
  stallCount}` and what a stall means; README/DEPLOY's `/api/status` paragraph gains `eventLoop` beside
  the semaphore gauges; the engine log section names `gateway.cli_resolved` / `gateway.cli_unresolved` /
  `engine.loop_stall`. Current behaviour only.
- **C-5 — the RED recipes become the shipped tests, in the tiers they belong to.** RED (A) (stub body
  that never settles and ignores abort) is a `StubFetchStep` flag (`holdBody: true`) in
  `tests/helpers/stub-fetch.ts` and a UT-342 case — deterministic, zero wall-clock. RED (B) (real undici,
  abort on `undici:request:trailers` via `diagnostics_channel`) is its own integration test against a
  local `http.createServer` — it exercises the real `fetch` and must never be skipped: if the channel does
  not fire, the test fails loudly (a silent skip would be the opaque failure this lens exists to refuse).
  Both assert the attempt ends with `reason:'timeout'` within `timeoutMs + ATTEMPT_SETTLE_GRACE_MS + ε`.

### Agent altitude

The cold-client judge (REQ-224) is unchanged: a guide-only agent registers the same script. What improves
for the agent that *debugs* a run: `run_status` now names the failure class it should branch on, and the
hung-call signature (`kind` absent, `provider: ''`) that made the reporter guess "stuck before dispatch"
no longer exists — the record says `decide`, `openrouter`, `typesafe/jev-1.13`, and when it last moved.

## 4. Self-sustainability

### System altitude

- **S-1 — the attempt ends when the engine says it ends.** Two layers, one authority (`call.ts`).
  *Inner:* `makeObservedFetch` races every `reader.read()` against `init.signal` (`abortedPromise(signal)`
  → reject `AbortError`, fire-and-forget `reader.cancel().catch(() => {})` so the socket is released);
  the per-attempt seam instance (`call.ts:334` creates one per attempt) means a read that settles late
  cannot write into the next attempt's record — say so in the DES, it is load-bearing. *Outer:*
  `runWithRetry` races `attempt(…)` against `onAbort(signal).then(() => deps.sleep(ATTEMPT_SETTLE_GRACE_MS,
  settle.signal))`, where `settle` is a per-attempt `AbortController` aborted in the same `finally` that
  clears `attemptSignal` — so the grace timer **never outlives the attempt**: on the ordinary path
  (timer fires, inner race ends the read within milliseconds, loop retries) the grace sleep is cancelled
  at once, and REQ-227's third clause ("每次嘗試的計時器在該嘗試結束時清除") holds for timed-out attempts,
  not only successful ones. If the grace wins the attempt is classified `timeout` with `settled: false`
  (O-2) and the loop proceeds (retry or fail by the existing rules). **Interpretation item for Gate 5, flagged as
  REQ-230's was:** REQ-227 says the per-call total is the formula "再加一個小的固定寬限" (one grace). A
  per-attempt grace G gives `(retries+1) × (timeoutMs + G) + retries × 10s`, i.e. up to `(retries+1) × G`
  = 6 s extra at `MAX_PRIMITIVE_RETRIES = 5` (`contract.ts:83`). I take **per-attempt** because the
  alternative (one call-level deadline) turns a *transient* stall on attempt 1 — exactly the undici race,
  exactly the case where attempt 2 would succeed — into a terminal `timeout`, forfeiting the retry the
  REQ's first clause just made possible; the guide prints the per-attempt formula (C-3) so the author's
  bound is still exact. If the synthesizer reads the owner's sentence literally, the call-level deadline
  is the one-line alternative and the formula sentence is the only other change.
- **S-2 — the retry set.** `classifyAttempt` (`call.ts:229`): `network → retryable: true`. Everything
  else in the precedence table stands (`aborted` first, `timeout`, `response_too_large`, `http` by status,
  `network`, `malformed`, `no_output`). Image double-billing on a network retry is the same risk the v40
  guide already names for timeouts ("use 0–1 retries on images"); the guide sentence is extended to name
  network with it, and the author still declares `retries` per label (V40-Q14).
- **S-3 — no residue after an attempt ends, however it ends.** `attemptSignal(ms) → {signal, fired(),
  clear()}` (`clear` required on the type — the only fakes of this seam are UT-342's own in
  `tests/unit/direct-models-call.test.ts`; the handler-level tests pass partial `directDeps` merged over
  `defaultDirectDeps`, e.g. IT-314's `{fetch, resolveKey}`, and are unaffected); `runWithRetry` calls
  `clear()`, aborts the settle controller (S-1) and removes its run-abort forwarder in one `finally`
  around each attempt; `AbortSignal.any` is replaced by `ctrl.abort()` forwarded from `runSignal` via
  `addEventListener('abort', …, {once: true})` + `removeEventListener`. Locks (UT-342 extension): with
  `vi.useFakeTimers()`, `vi.getTimerCount() === 0` after (a) a successful call and (b) a
  timeout → retry → ok call — the second is the one the strict reading of the REQ's third clause
  needs, since a timed-out attempt is where a grace timer could otherwise linger; after 300 successful
  calls on one `runSignal`, `getEventListeners(runSignal, 'abort').length === 0`; the run-abort path still
  ends an in-flight attempt (`aborted`, no `failed` event) — the existing case re-run under the new
  wiring.
- **S-4 — the slot is released when the bound says so.** No change to `withSlot`/`finally` — the fix in
  S-1 is what releases it; the lock is at handler level: an IT through the real child with `decideSlots:
  2`, one `holdBody` stub step followed by 200s, and ten parallel decides: every call settles, max
  concurrent stub requests = 2, no record is `running` after the run is terminal, and the hung call's
  wall time ≤ `(retries+1) × (timeoutMs + grace) + retries × 10s + ε`. **I argue against a handler-level
  watchdog** (a second deadline in `_handleDecideRequest` racing `runDecide`): DES-267 made `call.ts` the
  only retry/timeout authority for a reason — two authorities mean two numbers in the guide and a record
  that can be finalised while a promise still runs. The handler asserts the bound in tests; it does not
  enforce a second one.
- **S-5 — the hot path stops dumping the process (REQ-232).** R-1's resolve-once removes `getReport`
  from every launch. Residual named, not engineered: `spawn` self-time was 4.7 s across ~180 launches
  (~26 ms each) — synchronous fork cost scales with open fds and is the floor REQ-232's p99 ≤ 200 ms sits
  on; it is well under the bound at today's socket counts and is the first suspect if the IT (S-6) fails
  after the fix. Locks: *UT* — a fake `queryImpl` receives `options.pathToClaudeCodeExecutable` equal to
  the injected resolver's value; `cliExecutable: null` leaves it undefined — this is the engine's wiring
  lock. *IT* — the **real** `sdkQuery` with a stub `spawnClaudeCodeProcess` that returns a fake child
  which closes immediately, a spy on `process.report.getReport`: 0 calls with the path set; the RED
  variant (option unset) counts ≥ 1. This IT is an **SDK-contract pin** (the v40 R-4 lineage: pin what
  the dependency does, so a bump that moves it fails CI, not production) — not redundant with the UT,
  which pins what the engine passes. Together they are the "equivalent measurement" REQ-232's second
  clause asks for, deterministic and profile-free.
- **S-6 — the stall bound, measured by the engine's own instrument.** IT: hold **≥ 60 real sockets**
  (keep-alive connections to a local `http.createServer` that never responds — the perturbation must land,
  otherwise `getReport` is cheap and the RED is not red; the test asserts the socket count before
  launching), launch 20 real `sdkQuery` sessions through the stub spawner in a burst, sample
  `createLoopLagMonitor` (the production module) across the burst: `p99Ms ≤ 200`, `maxMs ≤ 1000`. RED
  (option unset) shows `maxMs` in seconds on this class of host. Real tier: rerun `rwe168-repro@v2` ×3
  (`n: 60`, the shape in the issue's comment) against real OpenRouter under the owner's US$1 cap (the
  diagnosis measured ≈ $0.09 per 3-run round): 0 non-terminal records, every `agentFailures` entry's
  `reason` equal to its record's `failReason` and its `message` to the thrown text, `/api/status.eventLoop
  .maxMs ≤ 1000` on every poll during the burst, `ps aux` shows the CLI at `gateway.cli_resolved.path`,
  spend summed from `primitive.call ok` lines as in v40.
- **S-7 — fail posture per door, unchanged except where named.** Pre-flight refusals, `PRICE_UNKNOWN`,
  budget doors, journal rule (INV-V40-6's "journaled iff it returned") — all untouched; a thrown
  `PRIMITIVE_FAILED` still writes no journal row, so a resume re-runs it live (v40's ruling; not reopened).
  New posture: the CLI resolver's miss degrades to the SDK default with a warning (O-5) rather than
  refusing boot, because `gateway` may never be `'sdk'`-bound in a given process and the SDK's own error at
  first use is already typed.
- **S-8 — no breaker, no probe (ruled; and the evidence says they would not have helped).** The hung
  calls produced no wire failure to count; the network failures were self-inflicted by the stall. The
  liveness signals this slice adds instead are the ones that *would* have caught #168: `eventLoop.maxMs`,
  `primitive.call` with `stage`/`cause`/`settled`, and `lastActivityAt` on a live primitive.

### Agent altitude

Memory metabolism N/A (stated above). Tool liveness for `agent()` reduces to R-1/O-5: the harness binary is
located once, named once, and its launch cost is a number on `/api/status`. Self-reflection reduces to
the retry loop being honest about its own bound — which, after S-1/S-3, it is.

## 5. Task splitting — what the synthesizer should write into 03-tasks.md §v41

Ordering is forced by shared files and by the vocabulary-first rule TASK-260 set:

1. **Vocabulary first, blocking** — `src/types.ts` (`failReason`/`failStatus`/`AgentFailureSummary.reason`
   widening), `src/event-log.ts` (`primitive.call` += `stage?`, `cause?`, `settled?`; new kinds
   `gateway.cli_resolved`, `gateway.cli_unresolved`, `engine.loop_stall`), `src/tool-specs.ts` (`run_status`
   enum sentence). Everything else compiles against it.
2. **REQ-227 delta** — `src/direct-models/call.ts` (S-1/S-2/S-3, O-1/O-2), `tests/helpers/stub-fetch.ts`
   (`holdBody`), UT-342 extension (RED (A), timer count after success AND after timeout→retry→ok,
   listener count, network retried; its `attemptSignal` fakes gain `clear()`), one new IT for RED (B)
   (real undici). Shares nothing with 3–5.
3. **REQ-231** — `src/run-manager.ts` (handlers: `markQueued` fields, `markActivity` from `onAttempt`,
   `detail`/`failStatus` to `recordPrimitive`, `failureReason` kind branch, `primitiveFailReasonFrom`
   removed, the image `no_output` arm rerouted through `primitiveFailedError` and both image arms'
   `failReason`), `src/agent-executor.ts` (`markQueued`, `recordPrimitive`),
   `src/run-store.ts` (`data.failStatus` derivation only; `detail`/`reason` already derive). Tests: UT-358
   extension (detail + failStatus derive), a new three-surface IT through the real child (table over
   `network`, `timeout`, `http 429`, `http 400`, `malformed`, `no_output`, `write`), VAL-287/sentinel-sweep
   extension (O-7). **After 2** (it reads `AttemptObservation`'s new fields).
4. **REQ-232 fix** — new `src/gateway/claude-cli-path.ts`, `src/gateway/claude-agent-sdk-client.ts`
   (resolve-once, `options.pathToClaudeCodeExecutable`, the two boot events). Tests: UT (`queryImpl`
   options), IT (`getReport` spy, real `sdkQuery`, stub spawner). Shares nothing with 2–3.
5. **REQ-232 seam** — new `src/loop-lag.ts` (`createLoopLagMonitor`), `src/system-info.ts`
   (`process.eventLoop`), `src/server.ts` (`/api/status` full branch), `tool-specs.ts` `system_info`
   description. Tests: UT (fake histogram), IT lag-under-load (S-6; uses 4's stub spawner — so **after
   4**). Does not touch `run-manager.ts` or `call.ts`.
6. **Served text + ledger** — `src/authoring-guide.ts` (C-3), `docs/AUTHORING.md` regen, README/DEPLOY
   (C-4), `04-design.md` DES-264/267 `write` drift fix folded into the v41 delta rows. **Last**; its
   printed formula must match 2's constants and its enum 1's.

Concurrency: 2 ∥ 4 after 1; 3 after 2; 5 after 4; 6 last. No two concurrently-runnable tasks share a
`files:` entry. Validation (Gate 7.5) is S-6's real-tier row plus the v40 spend-ledger `jq` over
`primitive.call ok` lines.

**In-place `iter: v41` amendments the design must record (no Gate 2 to do it):** ARCH-183 (retry set +
wall-time bound + settle grace + timer/listener hygiene), ARCH-187 (failReason = `AttemptReason`;
`markQueued` fields; `markActivity` per attempt), ARCH-192 (`primitive.call` additive fields; three new
engine event kinds), ARCH-193 (`/api/status` `eventLoop` gauge beside the semaphores), the SDK gateway
row (resolve-once CLI path), INV-V40-1 (scope note: `_invokeOnce` gains one SDK option; agent() behaviour
unchanged, REQ-232's own clause), INV-V40-3 (the `cause` token regex and `detail` grammar are the two new
served strings and are body-free by construction).

## Risks

1. **Grace placement** (S-1) is an interpretation the owner's sentence does not settle; if Gate 5 reads
   "one fixed grace" literally, the per-call deadline variant must be substituted before implementation,
   and the guide formula with it. Flagged, not hidden.
2. **RED (B) is timing-sensitive across Node versions** (it depends on `undici:request:trailers` firing
   and on the microtask ordering that loses the abort). Mitigation: it asserts the *bound*, not the hang —
   green on a fixed undici too — and fails loudly if the channel never fires.
3. **`reader.cancel()` behaviour on undici's stream in the post-complete state is unverified.** The design
   does not await it (fire-and-forget) precisely so the attempt's end does not depend on it; what is
   unverified is only whether the socket is returned to the pool promptly. The S-4 IT's max-concurrency
   assertion is the canary.
4. **`spawn` cost** (~26 ms/launch today) is the residual p99 contributor after `getReport` goes; on a
   host with many more fds it could approach the 200 ms p99. Named, with S-6 as the measurement that would
   show it.
5. **Widening `AgentFailureSummary.reason`** is additive for JSON consumers but a closed-union change for
   TypeScript consumers of `types.ts`; the dashboard consumes `agentFailures` only as a count
   (`agentFailuresBadgeText`, `run.js:466`) and never renders `reason` — checked, no label table to
   extend.
6. **`detail` on a primitive record is a new served string.** It is the constructed grammar only (never
   pi-ai's `errorMessage`), but any future "add the provider hint" shortcut would break INV-V40-3; O-7's
   sweep extension is the lock.
7. **`eventLoop` on `/api/status`** is operator-only (full branch) by design; the public liveness branch
   stays version + agent gauge, so the deploy healthchecks are unaffected.
8. **The CLI resolver duplicates the SDK's candidate order.** A future SDK that renames its platform
   packages makes the resolver miss → `gateway.cli_unresolved` warning + SDK default (per-call lookup,
   with `getReport` back on the hot path). The IT in S-5 (0 `getReport` calls) is the regression lock that
   would catch that on a bump.

## Expected disagreements with other lenses

- **A handler-level watchdog as a second bound.** The adversarial lens will likely want
  `_handleDecideRequest` to race `runDecide` against the printed formula so the slot is released even if
  `call.ts` regresses. I hold the single-authority line (S-4): two deadlines are two formulas, and a
  record finalised under a still-running promise is the kind of inconsistency REQ-231 exists to remove.
  The handler *asserts* the bound in tests.
- **Per-attempt vs per-call grace.** I expect the other lens to read the owner's sentence literally
  (one grace per call). My reason for per-attempt is the retry it preserves; I concede if Gate 5 rules the
  text binding — the swap is one line and one sentence.
- **Network retries on images double-bill.** True, and the same as timeouts today; I keep the retry set
  uniform across the two primitives and let the declared `retries` and the guide carry it (S-2), rather
  than a per-primitive retry matrix.
- **`cause` codes as leakage.** An errno/undici token (`UND_ERR_SOCKET`) is engine-visible metadata about
  the engine's own socket, not provider text; the regex admits only `[A-Z0-9_]` tokens. If the other lens
  wants it dropped, the loss is diagnosability of the exact #168 network class, which the issue's own
  comment needed.
- **The lag monitor as scope creep.** REQ-232's acceptance names the instrument; the question is only
  whether it lives in a test or in the engine. My position is that a measurement which exists only in a
  test is the opaque failure this iteration is about — the 7 s stall shipped in v0.38.0 because nothing
  served could show it.
- **Widening `failReason` vs a new field.** A `primitiveReason` field would keep the agent union closed
  and avoid the `unreachable`/`network` asymmetry, at the cost of a fourth name for the same fact across
  surfaces. REQ-231 asks for one word in three places; the widened union is the smaller surface.
- **Resolver duplication vs leaving the SDK alone.** One could instead monkey-patch or pre-warm nothing
  and accept the stall; the profile (65 % of non-idle time in one synchronous call) says otherwise, and
  `pathToClaudeCodeExecutable` is the SDK's own documented opt-out.
