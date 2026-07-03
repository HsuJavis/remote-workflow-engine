---
stage: tests
status: green
---
# 05 Tests — Remote Workflow Engine

> Gate 5 test-first RED → Gate 7 regression GREEN.
> Files: `tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/acceptance/`.
> Run: `npm test` (vitest).  Gate 7 result: 161 pass / 0 fail / 35 files.
> Gate 5 RED confirmation (historical): 98 fail / 9 pass / 156 total.
> Gate 6 final route-back result (2026-07-03 12:55): 179 pass / 1 fail (IT-015, environment-specific
> test_defect, see its own note) / 47 files.
>
> **2026-07-03 route-back RED (validation-scope rework, D-V1..D-V7):** 10 new tests added across
> 7 new files for the 6 real-defects Gate 7.5 found (schema passthrough, agentType no-op,
> transcript-log stub, no artifact API, wrong scriptVersion metadata, catalog not persisted) —
> UT-016, UT-017, IT-009, IT-010, IT-011, IT-012, VAL-015. Confirmed RED: `npx vitest run` on the
> 7 new files = 10 fail / 0 pass; full suite = 161 pass (unchanged, all pre-existing) + 10 new fail
> = 171 total / 10 fail. No src/ changes made — RED confirmed against the current (unfixed)
> implementation.
> The 9 passing tests are pure-type/value-object utilities with no behavioral implementation:
>   UT-006 (6 IPC-protocol type assertions) and UT-014 FixedClock sub-tests (3, labelled
>   "value object — implemented"). These are intentionally pre-implemented seam helpers and
>   type contracts; their behavioral counterparts (SandboxHost IPC dispatch = IT-003,
>   RunStore clock usage = UT-014 RunStore sub-tests) are red.
>
> **2026-07-03 route-back RED, round 3 (D-R1..D-R5, production-wiring closeout):** the prior
> route-back round's implementer pass had already greened UT-016/UT-017/IT-009/IT-010/IT-011/
> IT-012/VAL-015 (verified independently here — `npx vitest run` on those 7 files = 10/10 pass —
> confirmed still testing real behavior, not weakened; statuses flipped green/pass below).
> Remaining production-wiring gaps closed with 3 new/retimed tests: IT-013 (new) pins D-R1 —
> `src/server.ts`'s default `LiteLLMGatewayClient` construction must route through the managed
> LiteLLM proxy path (observable via an injected `proxyManager` seam whose own `spawnImpl`/
> `fetchImpl` are faked — no real `litellm` binary spawned) without an explicit
> `useLiteLLMProxy:true` opt-in; RED today because `server.ts` never forwards `useLiteLLMProxy`/
> `proxyManager` at all. IT-005 (`tests/integration/gateway-provider-down.test.ts`) retimed per
> D-R1: previously exercised real network (Ollama/Anthropic) directly — non-deterministic and,
> once the proxy becomes the production default, would otherwise need a real Python subprocess
> cold start just to prove breaker semantics unrelated to Python startup time. Now injects
> `GatewayConfig.fetchImpl` + a `LiteLLMProxyManager` with faked `spawnImpl`/`fetchImpl` for all
> 3 cases (hung→timeout, retry-count, success shape); still GREEN (breaker logic itself already
> correctly implemented — this is a determinism/precision improvement, not a behavior change) but
> now deterministic and independent of Python cold-start, per D-R1's explicit ask. IT-014 (new)
> pins D-R4 — `workflow_artifacts` must be reachable over the real MCP JSON-RPC/HTTP surface
> (`server.ts` `TOOL_NAMES` + `callTool` dispatcher), not just the in-process facade already
> proven by IT-010; RED today because `TOOL_NAMES`/`callTool` have no `workflow_artifacts` case
> (`tools/list` omits it, `tools/call` returns `Unknown tool: workflow_artifacts`) even though
> `McpFacade.workflow_artifacts` itself works. Confirmed: `npx vitest run` full suite = 174 total /
> 171 pass (161 pre-existing + 10 prior route-back, all green, unchanged) / 3 fail (IT-013, both
> IT-014 cases) — correct-reason red, `tsc --noEmit` clean. No `src/` changes made.
>
> **2026-07-03 route-back RED, final round (D-F1/D-F2/D-F3, verifier standalone invocation):**
> user's D1 stands (twice confirmed) — the prior round's direct-fetch-to-proxy shape does not
> satisfy "genuine SDK sessions"; the accept-direct-fetch alternative was REJECTED. 6 new tests
> across 3 new files: UT-018 (`tests/unit/claude-agent-sdk-gateway.test.ts`, traces DES-007/DES-009)
> pins the new `ClaudeAgentSdkGatewayClient` — with no `queryImpl` override, `invoke()` must
> dispatch through the real `@anthropic-ai/claude-agent-sdk` `query` export (unit tier, `vi.mock`
> intercepts only the third-party SDK module) wired with `ANTHROPIC_BASE_URL`→the given local proxy
> URL + a dummy `ANTHROPIC_API_KEY`; RED because `src/gateway/claude-agent-sdk-client.ts` doesn't
> exist (3/3 fail, import error). IT-015 (`tests/integration/claude-agent-sdk-session.test.ts`,
> same traces) is the real-subprocess companion — a genuine SDK session pointed via
> `ANTHROPIC_BASE_URL` at a LOCAL stub `/v1/messages` server (real Anthropic-Messages streaming
> shape) completes an `agent()` round trip AND proves the SDK's own agent loop executes a real
> workspace-rooted file-read tool call (stub serves a `tool_use` turn, then a final-text turn once
> it observes the `tool_result`); guarded to skip-with-reason only if the SDK genuinely cannot reach
> the stub in this environment (CLI absent, or — empirically observed while authoring this test —
> a nested-agent sandbox intercepting `query()` with a synthetic canned response); RED today because
> the same module doesn't exist (1/1 fail, ~20ms, correct reason — the stub/skip-guard code is never
> reached). IT-016 (`tests/integration/agent-type-composition-root.test.ts`, traces DES-007/ARCH-004)
> pins D-F2 — the `agentType` composition-root loader: a real `agents/*.md` frontmatter file in a
> `agentDefinitionsDir` must populate the registry `AgentExecutor` already knows how to resolve
> (UT-017); RED today because `ServerConfig` has no such field and `createServer()`/`RunManagerDeps`
> never load or forward one at all — every `agentType` is "unknown" until this loader exists (the
> "known type applies prompt/model" case fails: `helper` resolves unknown, run status `failed` not
> `completed`); the "unknown type still fails fast" case is confirmed already GREEN today (since the
> registry is always empty, ANY name is correctly "unknown" per UT-017's existing D-V5 logic) —
> documented transparently as an intentional regression guard, not a false forcing red.
> D-F3: VAL-006/E2E-002 poll windows raised (20000/15000ms → 30000/25000ms) for the added host
> contention from these 3 new real-process-spawning integration files; the pre-suspend/pre-stop
> fixed sleep was replaced with an active `waitUntilRunning()` poll rather than simply raised — a
> naive raise (100ms→300ms) was tried first and measured to deterministically break both tests in
> this credential-less environment (run reaches `completed` in ~150-200ms, so a longer fixed wait
> always suspends too late) — see each item's own note for the measurement. Confirmed 3/3 green
> across 3 consecutive isolated runs plus the full suite.
> Full suite (`npx vitest run`): 47 files / 180 tests — 175 pass (174 pre-existing, unchanged + 1
> incidentally-green new sub-test) / 5 fail (UT-018 ×3, IT-015 ×1, IT-016 ×1) — all correct-reason
> red. No `src/` changes made.
>
> **2026-07-03 12:55 GATE 6 GREEN (final route-back, standalone implementer invocation):**
> `src/agent-definitions.ts` (D-F2 loader) + `src/gateway/claude-agent-sdk-client.ts` (D-F1
> `ClaudeAgentSdkGatewayClient`) implemented. UT-018 (3/3) and IT-016 (2/2) green. IT-015 stays RED
> for a documented, environment-specific, non-implementation reason (this sandboxed dev environment
> is itself a nested Claude Code agent host that intercepts `query()` — see IT-015's own note below
> and 06-impl-log.md IMPL-037's test_defect report); reported, not fudged. Full suite
> (`npx vitest run`): 47 files / 180 tests — 179 pass / 1 fail (IT-015 only). `tsc --noEmit` clean.
>
> Per-tier mock policy (DES-015):
>   unit — mocks freely (RunStore=InMemory, AgentSpawner=fake, GatewayClient=fake, Clock=Fixed).
>   integration — real adjacent components; only third-party network mocked.
>   e2e/acceptance — no mock of SUT boundaries; real server + real sandbox + real store;
>     LLM provider = real Ollama or test API key (individual tests guarded by HAS_PROVIDER env check,
>     but createServer() is always called so Gate 5 RED is triggered by the unimplemented server stub).
>
> **2026-07-03 Gate 7.5 real-run, round 2 (validator, post D-V1..D-V7/D-R1..D-R5/D-F1..D-F4):**
> booted the real product (`npm run start`, a genuine independent OS process) with a real managed
> `litellm[proxy]` Python subprocess (pinned Python 3.12 via `uv`, D-R3) and a real local Ollama
> model. Confirms round 1's 6 defects are FIXED (real schema validation+retry, real agentType,
> real transcript read-back, real `workflow_artifacts`, correct `scriptVersion`, SQLite-persisted
> catalog surviving restart — VAL-001/003/007/013/014/015 flipped green below where applicable).
> Found **3 NEW real defects**, 2 of them in the production-default `ClaudeAgentSdkGatewayClient`
> gateway itself (`opts.model`/alias never forwarded to the SDK session; a real upstream API error
> surfaces as fake success text instead of `null`) and 1 in script-visible budget accounting
> (`budget.spent()/remaining()` hard-coded stubs in `src/sandbox/child-entry.ts`, never reflect
> real usage) — plus a `workflow_suspend` gap (doesn't actually cancel the in-flight provider
> `fetch()`, only abandons waiting for it) and a restart-durability gap (`workflow_agent_log`
> becomes unreachable for pre-restart agents). VAL-002/003/004/006/007 flipped red below (`real:
> true`, `result: fail`) with full evidence + exact file/line root causes in `08-validation.md`.
> None of these are mock-only or unreachable-dependency findings — all reproduced against fully
> real wiring (`npx vitest run`: 179/180 unchanged, `tsc --noEmit` clean — these are real-run-only
> discoveries the automated suite's mocks/fakes could not have caught).
>
> **D-F5 route-back RED (verifier, standalone invocation):** 2 new files / 4 new tests pin the 2 real
> SDK-default-gateway defects Gate 7.5 round 2 found (`08-validation.md` VAL-003/VAL-004) —
> UT-019 (unit, mocks the SDK module) + IT-017 (integration, real local `/v1/messages` stub server +
> the real `claude` CLI subprocess, confirmed present on `PATH` in this environment, no paid
> endpoint). No `src/` changes made. Confirmed correct-reason red against current src (not import
> errors, not always-pass shells): `npx vitest run` = 49 files / 184 tests — 179 pass (180
> pre-existing minus the 1 pre-existing documented IT-015 environment-specific red, unchanged) / 5
> fail (IT-015 pre-existing + these 4 new, each failing on the exact forcing assertion — see
> UT-019/IT-017's own notes for exact expected-vs-received values). `tsc --noEmit` clean.
>
> **D-F6..D-F9 route-back RED (verifier, standalone invocation), pinning Gate 7.5 round-3's 2 new
> SDK-default findings plus the 3 not-yet-route-backed round-2 findings (`08-validation.md`
> VAL-002/003/004/006/007, `state.yaml` pending[] items 1-2):** 5 new files / 5 new tests, no `src/`
> changes. UT-020 (`tests/unit/claude-agent-sdk-gateway-thinking.test.ts`, D-F6, unit tier — mocks
> only the third-party SDK module) + UT-021 (`tests/unit/claude-agent-sdk-gateway-timeout.test.ts`,
> D-F7, unit tier) pin the 2 SDK-default-gateway gaps VAL-003/VAL-004 round 3 found. IT-018
> (`tests/integration/budget-live-accounting.test.ts`, D-F8, integration tier — real
> RunManager/RunGuard/AgentExecutor/sandbox, only GatewayClient faked) pins VAL-002's live-budget-view
> gap. IT-019 (`tests/integration/suspend-aborts-gateway-call.test.ts`, D-F9a, integration tier) pins
> VAL-006's in-flight-cancellation gap. IT-020
> (`tests/integration/agent-records-restart-survival.test.ts`, D-F9b, integration tier — real
> McpFacade/RunManager/SqliteRunStore, restart simulated the same way IT-006/IT-012 already do) pins
> VAL-007's restart-durability gap. Confirmed correct-reason red (not import/syntax errors, not
> always-pass shells): `npx vitest run` these 5 files alone = 6 tests, 5 fail / 1 pass (UT-020's
> Anthropic-alias case passes today by omission — documented as an intentional regression guard in
> its own file, same precedent as IT-016's "unknown agentType still fails fast" sub-case). Full suite
> (`npx vitest run`): 54 files / 190 tests — 184 pass (183 pre-existing unchanged + 1 new
> incidentally-green regression guard) / 6 fail (IT-015 pre-existing environment-specific + these 5
> new, each failing on its exact forcing assertion — see each item's own note). `npx tsc --noEmit`:
> 0 errors.
>
> **2026-07-03 Gate 8 review route-back RED (verifier, standalone invocation, pinning the 6
> BINDING D-G8-1..6 HIGH/MEDIUM review findings — `.panel/review/adversarial.md` +
> `.panel/review/quality-dimensions.md`, consolidated in `07-review.md`):** 6 new files / 11 new
> test cases (9 forcing red + 2 already-passing regression guards, same transparency precedent as
> UT-020/UT-025), no `src/` changes made. UT-026 (unit, mocks only the third-party SDK module) pins
> D-G8-5 (env allowlist, review V5). IT-026 (integration, real RunManager/WorkflowCatalog/sandbox
> child processes) pins D-G8-1 (nested workflow() callSeq namespacing + resume fidelity, review V3
> — the review's own HIGH-severity top finding). IT-027 (integration, real McpFacade/RunManager/
> AgentExecutor/ClaudeAgentSdkGatewayClient, only the third-party SDK `query` faked) pins D-G8-2
> (AgentTranscriptSink message/tool_call/tool_result capture, review O-1). IT-028 (integration,
> real HTTP MCP server, `real: true` — no mock of the SUT boundary) pins D-G8-3 (tools/list real
> descriptions/inputSchemas, review C-1). IT-029 (integration, real `composeConfig()`, only the SDK
> `query()`/LiteLLMProxyManager subprocess faked, same tier as IT-021) pins D-G8-4 (zero-config
> default-gateway hardcoded timeoutMs fallback, review S-1 — enforces decision D-G, user-reconfirmed
> 2026-07-03). IT-030 (integration, real RunManager/RunGuard/AgentExecutor/sandbox, only
> GatewayClient faked with a deterministic artificial delay) pins D-G8-6 (budget concurrency
> reserve-at-dispatch, review V2). Confirmed correct-reason red (not import/syntax errors, not
> always-pass shells, not a flaky race — see each item's own note for the exact expected-vs-received
> failure): `npx vitest run` these 6 files alone = 11 tests, 9 fail / 2 pass (the 2 passes are
> documented regression guards, not forcing cases). Full suite (`npx vitest run`): 69 files / 217
> tests — 205 pass (206 pre-existing minus the 1-2 pre-existing documented flaky/environment-specific
> reds — IT-015's own documented environment interception, IT-024's own documented ~1-in-6 real
> two-process IPC contention flake, see their own notes, unrelated to this round — plus these 11 new)
> / 12 fail (IT-015 + IT-024 pre-existing + the 10 new forcing reds). No `src/` changes made.

---

## Unit Tests

### UT-001 — MCP result envelope contract
- **status:** green
- **traces:** DES-001
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/unit/mcp-envelope.test.ts`.
Cases: workflow_run returns envelope (not throw); unknown runId → error envelope (not throw); workflow_list returns array.

### UT-002 — RunGuard: concurrency gate, budget, agent counter
- **status:** green
- **traces:** DES-002
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/unit/run-guard.test.ts`.
Cases: acquireSlot resolves under cap; third slot queues when cap=2; nextAgentId throws AgentCapError at 1001;
addTokens accumulates in budgetView().spent(); assertBudget throws BudgetExceededError; remaining()=Infinity when budget=null.

### UT-003 — Run state machine transitions
- **status:** green
- **traces:** DES-003
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

Gate 6.5 fix (verifier): the "start transitions run from queued to running" sub-test asserted on
a `store` instance never injected into `new RunManager()` (RunManager built its own private
InMemoryRunStore) — always read `undefined`. Fixed to assert via `mgr.status(runId)`, matching
the other sub-tests in this file. 5/5 green.

File: `tests/unit/state-machine.test.ts`.
Cases: start → queued/running; resume a running run throws IllegalTransitionError; suspend non-running throws;
stop → stopped; resume after stop succeeds (cached-prefix semantics).

### UT-004 — Resume cache replay (longest-unchanged-prefix)
- **status:** green
- **traces:** DES-004
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/unit/resume-cache.test.ts`.
Cases: same prompt+opts = cache hit; changed prompt = MISS; all entries after first MISS = MISS;
cachedThrough equals last matching callSeq.

### UT-005 — Sandbox VM guards (determinism, TS rejection, nesting, size caps)
- **status:** green
- **traces:** DES-005
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/unit/sandbox-guards.test.ts`.
Cases: Date.now() → DETERMINISM_GUARD; Math.random() → DETERMINISM_GUARD; new Date() → DETERMINISM_GUARD;
TS type annotation → PARSE_ERROR; script > 512 KB → SIZE_EXCEEDED; parallel() > 4096 → ITEM_CAP_EXCEEDED;
valid script → kind:done; second-level workflow() → NESTING_ERROR; fs/require/process not accessible.

### UT-006 — IPC message protocol discriminated union and callSeq correlation
- **status:** green
- **traces:** DES-006
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/unit/ipc-protocol.test.ts`.
Note: tests the pure TypeScript type contract (message shapes, discriminated union, correlation map simulation).
Types are defined in `src/ipc/protocol.ts` — no runtime implementation needed.
Behavioral IPC dispatch (routing messages over the child process channel) is tested in IT-003 (red).

### UT-007 — AgentExecutor outcomes: text / object / null
- **status:** green
- **traces:** DES-007
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

Gate 6.5 fix (verifier): the "no schema"/"schema present" sub-tests built a `fakeGateway` but
called `new AgentExecutor()` with no args, so the fake was never wired (always hit the
NULL_GATEWAY default). Fixed to `new AgentExecutor({ gateway: gw })`. 5/5 green.

File: `tests/unit/agent-executor.test.ts`.
Cases: no schema → kind:text; schema → kind:object; terminal gateway failure → kind:null;
timeout → kind:null; AbortSignal fires → null (never hangs).

### UT-008 — AgentTranscriptSink: token accounting feeds RunGuard
- **status:** green
- **traces:** DES-008
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

Gate 6.5 fix (verifier): both sub-tests built `gw`/`guard` fakes but called `new AgentExecutor()`
with no args. Fixed to `new AgentExecutor({ gateway: gw, guard })` / `{ gateway: gw }`. 2/2 green.

File: `tests/unit/transcript-sink.test.ts`.
Cases: usage event calls RunGuard.addTokens with combined delta (input+output);
AgentRecord has real provider/model from GatewayResult.

### UT-009 — GatewayClient alias mapping and provider-down null path
- **status:** green
- **traces:** DES-009
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

Gate 6.5 fix (verifier): the "sonnet"/"default" alias sub-tests hit the real anthropic branch,
which requires `ANTHROPIC_API_KEY` (none in this sandbox) before it will even call `fetchImpl`.
Fixed to inject the `fetchImpl` seam (GatewayConfig, added at Gate 6) with a canned response AND
a fake (never-real) `ANTHROPIC_API_KEY` env var for the duration of the test only — the fake key
is never sent anywhere real since fetchImpl fully intercepts the call. 4/4 green.

File: `tests/unit/gateway-client.test.ts`.
Cases: "sonnet" alias resolves to configured Anthropic model; omitted model → default alias;
provider unreachable → ok:false (not throws); invoke tags request with runId/agentId.

### UT-010 — RunStore port: create / append / transition / query
- **status:** green
- **traces:** DES-010
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/unit/run-store.test.ts`.
Cases: createRun returns string runId; getRun returns queued; getRun returns null for unknown;
appendJournal stored; recordTransition updates status; listRuns returns all; hydrateAll empty on fresh store.

### UT-011 — WorkflowCatalog: registry, workspace rooting, path-escape rejection
- **status:** green
- **traces:** DES-011
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/unit/workflow-catalog.test.ts`.
Cases: register → get (version pinned); update bumps version; get unknown → CatalogNotFoundError; list returns all;
runWorkspace differs per runId; workFolder stable; workFolders distinct across workflows;
resolveInWorkspace with "../" → WorkspaceEscapeError; safe path resolves correctly.

### UT-012 — SubmissionValidator: one error shape, delegates to modules
- **status:** green
- **traces:** DES-012
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/unit/submission-validator.test.ts`.
Cases: valid script → ok:true; TS syntax → PARSE_ERROR; unknown alias → UNKNOWN_ALIAS;
unknown workflow name → UNKNOWN_WORKFLOW; errors have code+message; no name+no script → MISSING_SCRIPT.

### UT-013 — Cross-cutting null semantics
- **status:** green
- **traces:** DES-013
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/unit/null-semantics.test.ts`.
Cases: parallel() throwing thunk → null slot (others complete); parallel() never rejects;
pipeline() throwing stage → item null (remaining stages skipped); pipeline() never rejects;
agent() terminal-error-via-IPC → null return.

### UT-014 — Clock/RNG determinism seam consistency
- **status:** green
- **traces:** DES-014
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/unit/clock-seam.test.ts`.
Sub-tests: FixedClock.now() returns anchor; FixedClock.isoNow() returns ISO string;
FixedClock is stable; InMemoryRunStore uses injected Clock not wall clock; recordTransition ts matches injected Clock.
All 5 pass (Gate 7 green).

### UT-015 — Workflow-script meta-literal validation
- **status:** green
- **traces:** DES-005, DES-013
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/unit/meta-literal.test.ts`.
Gate-6 gap (D-I4, journal 2026-07-03 06:55): `export const meta = {...}` must be a **pure object literal**
per compat-spec §1 — variables, function calls, spreads, and template interpolation are rejected.
Cases: valid literal meta (`{name, description}`) → `kind:'done'` with the script's own return value;
meta assigned from a variable → error `INVALID_META`; meta built via a function call (`Object.assign(...)`) →
`INVALID_META`; meta using a spread (`{...base, ...}`) → `INVALID_META`; meta using template interpolation
(`` `${n}` ``) → `INVALID_META`.
Red reason: `evaluateScript` currently wraps the whole script body in an async function and has no meta
extraction/validation step, so `export const meta = ...` (any form, including the valid literal) fails to
parse and returns the generic `PARSE_ERROR` from `vm.Script` compilation instead of the distinct `done`/
`INVALID_META` outcomes this test pins — confirmed red for the right reason (feature not yet built), not a
test-authoring mistake.

### UT-016 — AgentExecutor: schema outcome performs real validation with retry-on-mismatch (no passthrough)
- **status:** green
- **traces:** DES-007
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/unit/agent-executor-schema-retry.test.ts`.
Cases: nonconforming first response (JSON parses but violates `type:number`) → retry → second
response validated → `kind:'object'` with the genuinely parsed+validated value (not a raw-string
type-cast); still-nonconforming after the retry budget is exhausted → `kind:'null'` (never rejects),
bounded number of attempts (not an infinite loop).
2026-07-03 route-back round 3 (verifier, D-R5): confirmed GREEN — a prior route-back implementer
round landed real Ajv-based JSON-schema validation + bounded retry (`SCHEMA_RETRY_ATTEMPTS`) in
`src/agent-executor.ts` (D-V4). Re-ran standalone (`npx vitest run` this file: 2/2 pass) and
inspected the source to confirm the assertions are exercised for real (genuine `ajv.compile` +
`JSON.parse` + retry loop, not a weakened/loosened test) — not modified here.

### UT-017 — AgentExecutor: agentType resolution (known type applies definition; unknown type reported, not a hang)
- **status:** green
- **traces:** DES-007
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/unit/agent-executor-agent-type.test.ts`.
**Verifier-authored design extension (D-V5), not yet in `04-design.md` — flagged for Gate 6 to
finalize:** `AgentExecutorDeps` grows an optional `agentTypes?: Record<string, {systemPrompt}>`
seam (server-side agent-definition registry, faked by the test — unit tier mocks freely). A known
`opts.agentType` must observably apply its definition (test asserts the resolved `systemPrompt`
appears in what's sent to the gateway); an unknown `opts.agentType` must reject fast (reported
error, not a silent no-op) and must never call the gateway at all (proven via a fake `invoke` that
would hang forever if ever called, raced against a 500ms timeout).
2026-07-03 route-back round 3 (verifier, D-R5): confirmed GREEN — `src/agent-executor.ts` now
resolves `req.opts.agentType` against `AgentExecutorDeps.agentTypes` before any gateway dispatch:
a known type's `systemPrompt` is prepended to the outbound prompt, an unknown type throws
synchronously (`AgentExecutor.run()` rejects) before `gateway.invoke()` is ever called. Re-ran
standalone (`npx vitest run` this file: 2/2 pass), including the "never hangs" race against a
500ms timeout — not modified here.

### UT-018 — ClaudeAgentSdkGatewayClient: default production session factory is @anthropic-ai/claude-agent-sdk-backed
- **status:** green
- **traces:** DES-007, DES-009
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

**Gate 6 closure (IMPL-037):** `src/gateway/claude-agent-sdk-client.ts` implemented —
`ClaudeAgentSdkGatewayClient` dispatches through the real SDK `query` export by default, wires
`ANTHROPIC_BASE_URL`/dummy `ANTHROPIC_API_KEY`, and honors an injected `queryImpl` override. All 3
cases green (`npx vitest run tests/unit/claude-agent-sdk-gateway.test.ts`).

**Final route-back round (D-F1, user decision D1 stands — the accept-direct-fetch alternative was
REJECTED):** a raw `/v1/messages` `fetch()` shaped like an SDK session's request (the current
`LiteLLMGatewayClient` proxy path, D-V1/D-R1) is NOT capability-equivalent to a real
`@anthropic-ai/claude-agent-sdk` session — it has no tool-use agent loop, which REQ-003 and the
product core promise require. This test pins the new `ClaudeAgentSdkGatewayClient` (a `GatewayClient`
implementation), asserted in isolation at unit tier (DES-015 mocks freely): with no `queryImpl`
override, `invoke()` must dispatch through the real SDK's own `query` export (proven by `vi.mock`-
intercepting `@anthropic-ai/claude-agent-sdk` itself and asserting the mock was called — proves the
DEFAULT path is the real module, not a private duplicate); the session is wired with
`ANTHROPIC_BASE_URL` set to the given local proxy `baseUrl` and a dummy (non-empty, never-the-real-
env-key) `ANTHROPIC_API_KEY`; an injected `queryImpl` overrides the default (seam stays injectable
per the task).

File: `tests/unit/claude-agent-sdk-gateway.test.ts`.
Cases: default (no override) dispatches through the real SDK's `query` export + resolves the final
text; env wiring (`ANTHROPIC_BASE_URL`/dummy `ANTHROPIC_API_KEY`); injected `queryImpl` overrides.
Red reason: `src/gateway/claude-agent-sdk-client.ts` does not exist yet — import fails (3/3 fail,
confirmed `npx vitest run` this file).
Composition-root note for Gate 6 (guidance, non-binding on this test): intended to become
`RunManager`'s default `_gateway` (replacing/wrapping `LiteLLMGatewayClient` as the production
default), reusing `LiteLLMProxyManager` for the local proxy `baseUrl`. `AgentExecutor`'s own zero-arg
`NULL_GATEWAY` safe-default (relied on by several already-green unit tests, e.g.
`agent-executor.test.ts`'s bare `new AgentExecutor()` cases) is deliberately left alone — swapping
that bare convenience default is out of scope here.

### UT-019 — ClaudeAgentSdkGatewayClient: D-F5 route-back — opts.model forwarding + is_error handling
- **status:** green
- **traces:** DES-007, DES-009, DES-013
- **tier:** unit
- **real:** false
- **result:** pass
- **iter:** v1

Gate 6 fix (implementer, D-F5 route-back): `src/gateway/claude-agent-sdk-client.ts` `invoke()` now
sets `options.model: req.opts.model` (SDK's own `Options.model?: string` field, straight
passthrough) and widens the terminal-failure check to `msg.subtype !== 'success' || msg.is_error`.
2/2 green, no test changes.

**D-F5 route-back (verifier, standalone invocation):** pins the 2 real defects Gate 7.5 round 2 found
in the SDK-default gateway path (`08-validation.md` VAL-003/VAL-004, `state.yaml` `pending[]` item 1
sub-items 1/2). Unit tier (DES-015 mocks freely, same pattern as UT-018): `vi.mock`s only the
third-party `@anthropic-ai/claude-agent-sdk` module.

File: `tests/unit/claude-agent-sdk-gateway-defects.test.ts`.
Cases: (1) `invoke({opts:{model:'haiku-alias'}})` must set the SDK session's `options.model` to
`'haiku-alias'` — today's src never sets `options.model` at all (`call.options?.model` is
`undefined`). (2) a `{type:'result',subtype:'success',is_error:true,result:'API Error: ...'}` SDK
message (the real wire shape a real upstream API error produces — confirmed empirically against a
real local stub server + the real `claude` CLI while authoring this test, not a synthetic invention;
see `Query.readMessages`'s own `is_error` branch bundled in the SDK package) must resolve
`{ok:false, reason:'terminal'}` — today's src only checks `subtype !== 'success'`, so this falls
through to `ok:true` with the raw error text as `content`.
Red reason: confirmed `npx vitest run tests/unit/claude-agent-sdk-gateway-defects.test.ts` — 2/2
fail, both for the exact assertion above (`expected undefined to be 'haiku-alias'`;
`expected true to be false`), not an import/syntax error.

### UT-020 — ClaudeAgentSdkGatewayClient: thinking policy is alias-aware (D-F6)
- **status:** red
- **traces:** DES-009, REQ-004
- **tier:** unit
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/unit/claude-agent-sdk-gateway-thinking.test.ts`.
**D-F6 (binding):** the SDK gateway sets `options.thinking` per the alias mapping — DISABLED by
default for non-Anthropic-provider aliases (Ollama/OpenAI/Gemini via the LiteLLM proxy;
non-reasoning models 400 on `think:true`, `08-validation.md` round-3 VAL-003 finding 1), SDK default
preserved for Anthropic-provider aliases; per-alias config override allowed. Verifier-authored design
extension to `ClaudeAgentSdkGatewayConfig` (new `aliases: AliasMap` field, same shape
`LiteLLMGatewayClient` already takes) — not yet in `04-design.md`, flagged for Gate 6 to finalize,
same precedent as D-V5's `AgentExecutorDeps.agentTypes` (UT-017) and D-F2's
`ServerConfig.agentDefinitionsDir`. Unit tier (DES-015 mocks freely, same pattern as UT-018/UT-019):
`vi.mock`s only the third-party `@anthropic-ai/claude-agent-sdk` module.
Cases: (1) a non-Anthropic-mapped alias (`local` → `ollama`) → `options.thinking` must equal
`{type:'disabled'}`; (2) an Anthropic-mapped alias (`sonnet`) → `options.thinking` stays unset (SDK
default).
Red reason: `src/gateway/claude-agent-sdk-client.ts`'s `invoke()` never sets `options.thinking` at
all today, for any alias — case (1) is the forcing red (`expected undefined to deeply equal
{type:'disabled'}`, confirmed `npx vitest run` this file). Case (2) is confirmed already GREEN
today — NOT a false forcing test: since `options.thinking` is never set for ANY alias right now, the
Anthropic-alias case's expectation ("stays unset") holds trivially by omission, not by any
deliberate alias-aware decision — documented transparently as an intentional regression guard (must
stay green once D-F6's alias logic is wired), same precedent as IT-016's "unknown agentType still
fails fast" sub-case.

### UT-021 — ClaudeAgentSdkGatewayClient: bounded timeout/retry race (D-F7)
- **status:** red
- **traces:** DES-009, REQ-004
- **tier:** unit
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/unit/claude-agent-sdk-gateway-timeout.test.ts`.
**D-F7 (binding):** `ClaudeAgentSdkGatewayClient.invoke()` honors configured `timeoutMs`/`retries`
with an AbortController race exactly like `LiteLLMGatewayClient` (REQ-004's 4th acceptance clause; D-G
breaker must bind on the DEFAULT path). `08-validation.md` round-3 VAL-003 finding 2 / VAL-004:
unlike `LiteLLMGatewayClient` (`client.ts`'s `callProvider`/`callViaLiteLLMProxy`, each with a real
`AbortController` tied to `timeoutMs`), `invoke()` just `for await`s the session's own async
generator to its natural end with no timer/race of its own. Verifier-authored design extension to
`ClaudeAgentSdkGatewayConfig` (`timeoutMs?`/`retries?`, mirroring `GatewayConfig`'s own fields) — not
yet in `04-design.md`, flagged for Gate 6, same precedent as UT-020. Unit tier: the already-existing
injected `queryImpl` seam (used by UT-018/UT-019) stands in for a genuinely stuck real SDK session —
no real process/network involved.
Case: a hung session (never yields, never returns) with `timeoutMs:200, retries:1` — `invoke()` must
resolve `{ok:false}` within a bounded time (test races against a generous 3s test-level escape hatch
so the suite itself never hangs even though src is unbounded today).
Red reason: confirmed `npx vitest run tests/unit/claude-agent-sdk-gateway-timeout.test.ts` — the
test-level 3s escape hatch fires (`invoke()` never settles at all against a hung session), failing on
`expect(result).not.toBe(TEST_LEVEL_BOUND)` — not an import/syntax error, and not a fast failure
either (took the full ~3.1s of the test-level bound, confirming a genuine unbounded hang rather than
an early, unrelated rejection).

### UT-022 — ClaudeAgentSdkGatewayClient: real SDK cancellation hook wiring (D-F10c)
- **status:** red
- **traces:** DES-009, REQ-006
- **tier:** unit
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/unit/claude-agent-sdk-gateway-abort.test.ts`.
**D-F10(c) (binding, Gate 7.5 round 4 real defect):** `_invokeOnce`'s own local `AbortController`
(built to race `drain` vs a timeout/external-signal bound) is never assigned to
`options.abortController` — the SDK's own documented cancellation hook
(`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1275`: "Controller for cancelling the query.
When aborted, the query will stop and clean up resources."). Real repro (`08-validation.md` round 4):
`workflow_suspend` makes the local Promise race resolve early (state machine correct) but the real
spawned `claude` CLI subprocess is NOT killed — `ps aux` showed the same PID alive at t=4s
post-suspend, disappearing around t=12-14s, matching an unsuspended control run's own ~16s natural
completion, not an immediate cancellation. Mock policy (DES-015, unit tier): `vi.mock`s only the
third-party `@anthropic-ai/claude-agent-sdk` module (same pattern as UT-018..021) — a real subprocess
kill is unobservable at this tier by construction; that real-process proof is Gate 7.5's job (the
retro memo: "wiring gaps must be catchable at unit tier from now on").
Cases: (1) `invoke()` given a caller `signal` — the SAME `AbortController` object handed to
`options.abortController` must abort when the caller's external signal aborts; (2) `invoke()` bound
only by a configured `timeoutMs` (no external signal) — `options.abortController` must exist and be
aborted once the timeout fires.
Red reason: confirmed `npx vitest run tests/unit/claude-agent-sdk-gateway-abort.test.ts` — both cases
fail on `expect(call.options?.abortController).toBeInstanceOf(AbortController)` with `expected
undefined to be an instance of AbortController` (today's src never sets `options.abortController` at
all, confirmed by reading `src/gateway/claude-agent-sdk-client.ts`) — not an import/syntax error.

### UT-023 — LiteLLMGatewayClient (direct-fetch): invoke() forwards a caller signal into the in-flight fetch's AbortController (D-F10c)
- **status:** red
- **traces:** DES-009, REQ-006
- **tier:** unit
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/unit/gateway-client-suspend-abort.test.ts`.
**D-F10(c) (binding, carried-forward from Gate 7.5 round 3/4, never fixed):** `invoke()`'s own
declared parameter type omits `signal` entirely (`{prompt, opts, runId, agentId}` — confirmed by
reading `src/gateway/client.ts`), even though the `GatewayClient` interface itself declares
`signal?: AbortSignal` (D-F9a). Both `callProvider` and `callViaLiteLLMProxy` build their OWN local
`AbortController` tied only to `timeoutMs`'s own timer — a caller's abort signal is never listened to
at all, so the underlying `fetch` keeps running until the provider responds or `timeoutMs` elapses —
the same defect class UT-022 proves on the SDK-gateway path, for a different root cause, on the
"direct-fetch" opt-out path `08-validation.md` round 3/4 both flagged as still unfixed. Mock policy
(DES-015, unit tier): injects `GatewayConfig.fetchImpl` (the existing seam used by IT-005/UT-021) — no
real network.
Case: a caller-supplied `AbortSignal` given to `invoke()`, a hung transport with a deliberately long
`timeoutMs` (30s, so nothing else could cause the call to settle within this test's bound) — aborting
the caller's signal must genuinely abort the SAME `AbortSignal` object the transport was actually
invoked with, and `invoke()` must resolve `{ok:false}` promptly.
Red reason: confirmed `npx vitest run tests/unit/gateway-client-suspend-abort.test.ts` — the test's
own 1s escape-hatch sentinel fires (`invoke()` never settles at all; aborting the external signal has
no path into the fetch's own signal today), failing on `expect(result).not.toBe(TEST_LEVEL_BOUND)` —
not an import/syntax error, and not a fast failure either (took the full ~1s bound).

### UT-024 — ClaudeAgentSdkGatewayClient: curated options.allowedTools per call (D-F11)
- **status:** red
- **traces:** DES-009, REQ-003
- **tier:** unit
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/unit/claude-agent-sdk-gateway-allowed-tools.test.ts`.
**D-F11 (binding, Gate 7.5 round-5 real defect, ORCH ruling — fix the fixable part):** curate
`options.allowedTools` per call/agentType (agent definitions frontmatter `tools` field is
authoritative; default = a minimal core set e.g. Read/Write/Bash, configurable), so a small local
model is not overwhelmed by the SDK CLI's full, uncurated tool surface. `08-validation.md` round-5
VAL-003 root cause: `query()`'s `options` never restricts the tool surface at all today (no
`allowedTools`/`disallowedTools`) — every call sends the CLI's full tool list (dozens of tools,
including this shared host's own unrelated MCP plugin tools), confirmed via LiteLLM's own
`--detailed_debug` log; a direct SDK `query()` probe showed `num_turns:1`/zero `tool_use` messages
ever emitted by a real local Ollama model (qwen2.5:7b) against this payload, while the same model
correctly tool-called via Ollama's own native API with a single simple tool definition.
Verifier-authored design extension (same precedent as D-V5/D-F2/D-F6/D-F7 before it — not yet in
`04-design.md`, flagged for Gate 6 to finalize): `ClaudeAgentSdkGatewayConfig` grows
`defaultAllowedTools?: string[]` (the configurable minimal core set); the shared `req.opts` shape
grows `allowedTools?: string[]` (the per-call/per-agentType curated set — UT-025 proves
`AgentExecutor` threads a resolved agentType's frontmatter `tools:` field into this). Mock policy
(DES-015, unit tier): `vi.mock`s only the third-party `@anthropic-ai/claude-agent-sdk` module (same
pattern as UT-018..023).
Cases: (1) `req.opts.allowedTools` (agentType-derived curation) forwarded verbatim to
`options.allowedTools`; (2) a configured `defaultAllowedTools` is used when the call carries none of
its own; (3) never left unset — falls back to a non-empty built-in minimal core set even with no
config and no per-call override.
Red reason: confirmed `npx vitest run tests/unit/claude-agent-sdk-gateway-allowed-tools.test.ts` —
3/3 fail, `call.options?.allowedTools` is `undefined` in every case (confirmed by reading
`src/gateway/claude-agent-sdk-client.ts` — no `allowedTools` key anywhere in the built `Options`
object), not an import/syntax error.

### UT-025 — AgentExecutor: a resolved agentType's frontmatter `tools` field threads into opts.allowedTools (D-F11)
- **status:** red
- **traces:** DES-007, REQ-003
- **tier:** unit
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/unit/agent-executor-allowed-tools.test.ts`.
**D-F11 (binding):** "agent definitions frontmatter tools field is authoritative" for the curated
`options.allowedTools` UT-024 proves `ClaudeAgentSdkGatewayClient` applies. `src/agent-definitions.ts`
already PARSES a `tools:` frontmatter attribute (compat-spec §5) but its own file header documents it
as "parsed but not yet applied anywhere ... intentionally not stored" — no seam threads it from a
resolved `AgentTypeDef` into the outbound gateway request. Verifier-authored design extension (same
precedent as UT-024 — not yet in `04-design.md`, flagged for Gate 6): `AgentTypeDef` grows
`tools?: string[]`; a resolved definition's `tools` must apply to the outbound `opts.allowedTools`
the same way `model` already applies (DES-007's Gate-6 route-back note) — only when the caller
didn't already set their own `opts.allowedTools` (explicit caller value wins). Mock policy (DES-015,
unit tier): a fake `GatewayClient` captures the exact `req.opts` it receives.
Cases: (1) a known agentType's `tools` list is applied to the outbound `opts.allowedTools`; (2) an
explicit caller-supplied `opts.allowedTools` wins over the definition's own `tools` (regression
guard); (3) a definition with no declared `tools` leaves `opts.allowedTools` untouched (documented,
already-passing sub-case, not a forcing red — same transparency precedent as IT-016's "unknown
agentType still fails fast").
Red reason: confirmed `npx vitest run tests/unit/agent-executor-allowed-tools.test.ts` — 1/3 fail:
case (1) fails (`receivedOpts.allowedTools` is `undefined`, expected `['Read','Grep']`) — the only
forcing case, since no code path reads `AgentTypeDef.tools` at all today. Cases (2) and (3) both
pass today already, by trivial omission (nothing strips/overwrites a caller-supplied
`opts.allowedTools`, and nothing sets one when the definition declares none) — documented
transparently as regression guards rather than mislabelled as forcing reds. Overall item status is
`red` because case (1), the item's own core claim, genuinely fails today. Confirmed by reading
`src/agent-executor.ts` — the agentType-resolution block only ever reads `def.systemPrompt`/`def.model`, never a `tools` field
(which `AgentTypeDef` doesn't even declare today).

### UT-026 — ClaudeAgentSdkGatewayClient: spawned CLI subprocess env is an explicit allowlist, not full process.env (D-G8-5)
- **status:** red
- **traces:** ARCH-005, REQ-004
- **tier:** unit
- **real:** false
- **result:** fail
- **iter:** v1

Gate 8 review route-back (D-G8-5, adversarial.md finding V5, MEDIUM security). **Bug (review
evidence, `src/gateway/claude-agent-sdk-client.ts:129-133`):**
`env: { ...process.env, ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY: DUMMY_API_KEY }` — only
`ANTHROPIC_API_KEY` is actually overridden; every OTHER host variable (`OPENAI_API_KEY`,
`GEMINI_API_KEY`, cloud credentials, tokens, ...) is spread verbatim into the spawned `claude` CLI
subprocess, contradicting the file's own header comment ("this class never reads or forwards a real
host credential", D-R2) — true only for `ANTHROPIC_API_KEY`. Mock policy (DES-015, unit tier): mocks
the third-party SDK module itself via `vi.mock` (same seam UT-018 already uses) — everything else
(the real `ClaudeAgentSdkGatewayClient` under test) is real.
File: `tests/unit/claude-agent-sdk-gateway-env-allowlist.test.ts`.
Cases: (1) arbitrary host env vars set on `process.env` (e.g. `OPENAI_API_KEY`,
`SOME_UNRELATED_HOST_SECRET`) must NOT appear in the spawned session's `options.env`; (2) the
necessary allowlisted keys (`PATH`, `HOME`, the overridden `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`)
must still be forwarded (regression guard against over-correcting to an empty env).
Red reason: confirmed `npx vitest run tests/unit/claude-agent-sdk-gateway-env-allowlist.test.ts` —
case (1) fails (`env['OPENAI_API_KEY']` is `'sk-should-not-leak'`, expected `undefined`) since the
current implementation spreads the entire `process.env` unfiltered; case (2) already passes today
(trivially, by the same full-spread), documented transparently as a regression guard, not a forcing
red. Overall item status is `red` because case (1), the item's own core claim, genuinely fails
today.

---

## Integration Tests

### IT-001 — MCP facade: tools/list returns all v1 required tools
- **status:** green
- **traces:** ARCH-001
- **tier:** integration
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/integration/mcp-tools.test.ts`.
Cases: tools/list returns all 8 required tools; server binds to 127.0.0.1.
Red reason: createServer() throws NotImplementedError.
Gate-6 gap fix (D-I8): added missing `beforeEach`/`afterEach` import from vitest (`tsc --noEmit`
compile error `TS2304: Cannot find name`; test-side only, no behavior change).

### IT-002 — RunManager + RunGuard concurrency cap in IPC round-trip
- **status:** green
- **traces:** ARCH-002
- **tier:** integration
- **real:** false
- **result:** pass
- **iter:** v1

Gate 6.5 fix (verifier): both sub-tests built a `guard`/spy never injected into `new
RunManager()` (RunManager owns one RunGuard per run internally — DES-002 — with no `guard` seam
in RunManagerDeps) and the concurrency sub-test also read a `_maxObservedActive` field that
doesn't exist anywhere in RunGuard. Rewrote both to observe through seams RunManagerDeps *does*
expose: (1) concurrency — a fake `AgentSpawner` (`deps.spawner`) records max simultaneous
in-flight calls; RunGuard.acquireSlot() still gates entry to it regardless of which spawner is
wired. (2) budget accounting — a fake `GatewayClient` (`deps.gateway`) returns a fixed 30-token
result per call; budget:40 only allows a second agent() call to proceed if the first call's
tokens were added to RunGuard exactly once (not duplicated), observed via the script's own
try/catch outcome through `mgr.result()`. 4/4 green.

File: `tests/integration/run-manager-runguard.test.ts`.
Cases: at most N agents simultaneously; addTokens single accounting path; budget exceeded mid-run;
state machine start→running→stop→stopped→resume.
Red reason: RunManager.start() throws NotImplementedError.

### IT-003 — Sandbox child process with fake IPC parent (master test seam)
- **status:** green
- **traces:** ARCH-003
- **tier:** integration
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/integration/sandbox-child.test.ts`.
Cases: simple return-value script resolves; agent() calls use fake IPC parent (zero model calls);
throwing script returns error result (host stays up); abort resolves promptly; fs/require/process not accessible.
Red reason: SandboxHost.run() throws NotImplementedError.

### IT-004 — AgentExecutor wires GatewayClient and TranscriptSink
- **status:** green
- **traces:** ARCH-004
- **tier:** integration
- **real:** false
- **result:** pass
- **iter:** v1

Gate 6.5 fix (verifier): all 3 sub-tests built `gw`/`guard`/`store` fakes but called `new
AgentExecutor()` with a stale `// real impl injects gw/guard/store` comment — no such implicit
wiring exists. Fixed to `new AgentExecutor({ gateway: gw })` / `{ gateway: gw, guard }` / `{
gateway: gw, store }`. 3/3 green.

File: `tests/integration/agent-executor-wiring.test.ts`.
Cases: gateway.invoke receives prompt+runId+agentId; token delta added to RunGuard exactly once;
transcript appended to RunStore after completion.
Red reason: AgentExecutor.run() throws NotImplementedError.

### IT-005 — GatewayClient provider-down circuit breaker (D-G)
- **status:** green
- **traces:** ARCH-005
- **tier:** integration
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/integration/gateway-provider-down.test.ts`.
Cases: hung provider → ok:false within timeout (never hangs); retry count respected; successful call has correct shape.
Red reason (historical, Gate 5): LiteLLMGatewayClient.invoke() threw NotImplementedError.

2026-07-03 route-back round 3 (verifier, D-R1 retime): refactored to inject `GatewayConfig.fetchImpl`
(the actual outbound transport for all 3 cases) plus a `LiteLLMProxyManager` with its own
`spawnImpl`/`fetchImpl` faked (`useLiteLLMProxy: true`), replacing the prior real-network-dependent
version (real Ollama/Anthropic calls — non-deterministic, and would otherwise require a real
`litellm` Python subprocess cold start once the proxy becomes the production default per IT-013).
The "hung provider" case now uses a fetch fake that genuinely respects `AbortSignal` (rejects with
`AbortError` only once aborted) so the code's own bounded-timeout path is what's actually exercised,
not incidental network-refusal timing. The "retries" case now asserts an exact call count
(`toHaveBeenCalledTimes(3)` for `retries:2`) instead of only checking the final outcome. Re-ran:
3/3 still green — this is a determinism/precision fix, not a behavior change (the breaker logic was
already correctly implemented); it tests the breaker, not Python cold-start. Real-subprocess proof
belongs to Gate 7.5 with environment caveats (D-R3).

### IT-006 — RunStore journal.jsonl + SQLite survives restart simulation
- **status:** green
- **traces:** ARCH-006
- **tier:** integration
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/integration/run-store-persistence.test.ts`.
Cases: createRun persists across store instance restart; appendJournal survives restart;
hydrateAll enumerates runs; running runs re-hydrate as failed (not silently left running).
Red reason: SqliteRunStore not implemented (import fails).
Gate-6 gap fix (D-I8): the forward-declared `SqliteRunStore` constructor type used `clock: unknown`,
which no longer matched the real constructor's `clock: Clock` once implemented (`tsc --noEmit`
`TS2322` type-mismatch); narrowed to `clock: Clock` (imported from `src/clock.js`); test-side only.

### IT-007 — WorkflowCatalog workspace rooting and run-A/run-B isolation
- **status:** green
- **traces:** ARCH-007
- **tier:** integration
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/integration/catalog-workspaces.test.ts`.
Cases: run-A/run-B workspaces are distinct; file in run-A not visible in run-B path;
workflow-X and workflow-Y have distinct work folders; path traversal rejected;
runWorkspace rooted under workFolder.
Red reason: WorkflowCatalog.runWorkspace() throws NotImplementedError.

### IT-008 — SubmissionValidator at McpFacade entry point
- **status:** green
- **traces:** ARCH-008
- **tier:** integration
- **real:** false
- **result:** pass
- **iter:** v1

File: `tests/integration/submission-entry-point.test.ts`.
Cases: TS syntax → failed envelope with runId=''; unknown alias → UNKNOWN_ALIAS;
unknown workflow name → UNKNOWN_WORKFLOW; valid script → runId immediately.
Red reason: McpFacade.workflow_run() throws NotImplementedError.

### IT-009 — McpFacade.workflow_agent_log returns the real persisted transcript, never a hard-coded []
- **status:** red
- **traces:** ARCH-004
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/integration/agent-log-readback.test.ts`.
Real McpFacade + real RunManager + real InMemoryRunStore + real AgentExecutor/AgentTranscriptSink +
real sandbox child process; only GatewayClient (third-party network) is faked, per DES-015 integration
mock policy.
Case: `agent()` call completes → `workflow_agent_log({runId, agentId})` returns a non-empty
transcript-events array.
Red reason: `McpFacade.workflow_agent_log` (`src/mcp-facade.ts`) self-documents as a stub —
`return { ..., result: [] }` unconditionally — even though `AgentTranscriptSink.capture()` genuinely
calls `store.appendTranscript(...)` (already proven by the green IT-004 "transcript is appended to
RunStore" case). The gap is purely on the read-back path: `RunStore` has no accessor McpFacade can
read transcripts back through.

### IT-010 — Run-workspace artifacts listable/retrievable via the MCP API (workflow_artifacts)
- **status:** red
- **traces:** ARCH-007
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/integration/workspace-artifacts.test.ts`.
**Verifier-authored design extension (D-V7), not yet in `04-design.md`:** D-V7 allows either "a
listing tool or a status field" — this test targets the smaller of the two, a new
`McpFacade.workflow_artifacts({runId}): Promise<ResultEnvelope<string[]>>` returning relative paths
of files present in the run's workspace (no change to the widely-shared `RunStatusView`/`RunSummary`
shapes).
Case: a file written into a completed run's workspace (simulating an SDK-session tool write —
parent-side; the sandboxed script itself has no fs access, DES-005) is listed by
`workflow_artifacts`.
Red reason: `McpFacade.workflow_artifacts` does not exist — confirmed at Gate 7.5 real-run (no MCP
tool or status field exposes a run's workspace file listing today, see `08-validation.md` VAL-013);
calling it throws `TypeError: facade.workflow_artifacts is not a function`.

### IT-011 — scriptVersion fidelity: a run after a workflow update records the version it actually executed
- **status:** red
- **traces:** ARCH-006
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/integration/scriptversion-fidelity.test.ts`.
Real McpFacade + real RunManager + real WorkflowCatalog + real InMemoryRunStore; no network.
Case: register v1 → run → register v2 (same name) → run again → the second run's recorded
`scriptVersion` genuinely differs from the first's (not always `"v1"`).
Red reason: `RunManager.start()` (`src/run-manager.ts`) correctly resolves `scriptVersion` from the
catalog (`registered.version`) but never threads it into `this._store.createRun(spec)` —
`RunStore.createRun` (both `InMemoryRunStore` and `SqliteRunStore`) hardcodes `scriptVersion: 'v1'`
for every run regardless of which version actually executed — confirmed at Gate 7.5 real-run
(`08-validation.md` VAL-014).

### IT-012 — WorkflowCatalog registrations persist in the on-disk SQLite DB across instances
- **status:** red
- **traces:** ARCH-007
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/integration/catalog-persistence.test.ts`.
Mirrors IT-006's (`run-store-persistence.test.ts`) "new instance simulates restart, same on-disk
dir" pattern, applied to `WorkflowCatalog` (D-V2, user-confirmed).
Cases: a registration made by one `WorkflowCatalog` instance is retrievable (`get`/`list`) from a
second instance constructed against the same `workRoot`.
Red reason (historical, before Gate 6 rework): `WorkflowCatalog` (`src/workflow-catalog.ts`) kept
registrations in a private in-memory `Map` only.

2026-07-03 route-back round 3 (verifier): confirmed GREEN — `WorkflowCatalog` is now SQLite-backed
(`catalog.db` under `workRoot`, D-V2). Re-ran standalone: 2/2 pass — not modified here.

### IT-013 — server.ts default GatewayClient construction routes through the LiteLLM proxy path (D-R1)
- **status:** red
- **traces:** ARCH-005, DES-009
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/integration/server-default-litellm-proxy.test.ts`.
**Terminology note:** the route-back directive (D-R1) calls this "a forcing unit test", but per
DES-015's own tier definitions (unit mocks freely; integration = real adjacent components, only
third-party network mocked) this is more accurately integration tier — it's the only way to
observe `server.ts`'s own composition-root wiring decision, and only the litellm subprocess
boundary is faked (real HTTP server, real sandboxed child process, real McpFacade/RunManager/
AgentExecutor). Filed as integration/IT-013 rather than silently mislabelled as unit.

Real McpFacade + real RunManager + real sandbox child process (via `createServer()` + HTTP
`tools/call`); only the `LiteLLMProxyManager`'s own process boundary (`spawnImpl`/`fetchImpl`) is
faked — no real `litellm` binary is ever spawned (DES-015 / D-R2).
Case: `createServer({ aliases, proxyManager })` — **without** an explicit `useLiteLLMProxy: true`
opt-in — then a script calling `agent('ping')` is run to completion; the injected proxy manager's
`spawnImpl` must have been invoked, proving the default path routed through the proxy rather than
a direct per-provider fetch.
Red reason: `src/server.ts`'s `createServer()` constructs
`new LiteLLMGatewayClient({ aliases: config.aliases, timeoutMs, retries })` — it never forwards
`useLiteLLMProxy` or `proxyManager` from `ServerConfig` at all (neither field exists on
`ServerConfig` today), so `LiteLLMGatewayClient` always defaults to the direct-fetch path
(`_proxy` stays `undefined`); the injected `spawnImpl` fake is confirmed never called
(`expected "spy" to be called at least once` — 0 calls).

### IT-014 — workflow_artifacts reachable over the real MCP HTTP/JSON-RPC surface (D-R4)
- **status:** red
- **traces:** ARCH-007, REQ-013
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/integration/workflow-artifacts-http.test.ts`.
Companion to IT-010 (`tests/integration/workspace-artifacts.test.ts`, now green), which pins
`McpFacade.workflow_artifacts` directly at the facade level — D-R4 requires an HTTP-level test too,
since the facade-level test alone does not prove a real MCP client (which only ever sees the
`tools/list`/`tools/call` JSON-RPC surface) can actually reach it. Real `createServer()` + real
`fetch` HTTP calls against `/mcp` (no facade access) — no SUT-boundary mocks (matches
mcp-tools.test.ts/VAL-005's own HTTP-level pattern).
Cases: `tools/list` advertises `workflow_artifacts`; `tools/call workflow_artifacts` lists a file
written into a completed run's workspace.
Red reason: `src/server.ts`'s `TOOL_NAMES` const and `callTool()` switch have no
`'workflow_artifacts'` case — `tools/list` omits it (`names` = the 9 pre-existing tools only), and
`tools/call` for it falls through to `callTool`'s `default: throw new Error('Unknown tool: ...')`,
returned as a JSON-RPC `error` envelope (`{code:-32000, message:'Unknown tool: workflow_artifacts'}`)
— even though `McpFacade.workflow_artifacts` itself works correctly (proven by green IT-010).

### IT-015 — Real @anthropic-ai/claude-agent-sdk session against a local stub /v1/messages server completes an agent() round trip, including a real tool-use turn
- **status:** red
- **traces:** DES-007, DES-009
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

**Gate 6 closure (IMPL-037) — RED for a documented environment reason, reported as a test_defect,
not fixed here (Gate 6 rule 4: do not appease a wrong test):** `src/gateway/claude-agent-sdk-client.ts`
now exists and is fully implemented (UT-018 green). Running this test in THIS sandboxed dev
environment reaches `expect(sawToolResult).toBe(true)` = `false`: the local stub DOES receive
requests (`reachedStub` = true, so the skip-guard does not trigger), but they are not real Anthropic-
Messages-shaped requests from an independently-spawned CLI subprocess — confirmed via a throwaway
debug script (deleted after use, not shipped) that this dev environment is itself a nested Claude
Code agent host: `query()` here is intercepted by that outer host and answered with a live synthetic
response (the intercepted request bodies carry THIS repository's own system prompts and "Available
agent types for the Agent tool" listing, and a live model id such as `claude-opus-4-8`, never the
stub's `text/event-stream` bytes), even with `settingSources: []` set. This exact failure mode was
anticipated in this file's own prose above ("a nested/sandboxed nested-agent host that intercepts
query() with a synthetic canned response") but the skip-guard's literal condition
(`stub.requests.length > 0` within 20s) does not catch it, because the interception still causes
some (wrong-shaped) requests to reach the local port. **Recommended fix for the verifier (Gate 5):**
strengthen the skip-guard to positively verify a request is genuinely Anthropic-Messages-shaped
(e.g. its `model` field equals the stub's own `'stub-model'`, or its structure matches what the
stub itself would echo) before treating `reachedStub` as true — or gate the test behind an explicit
opt-in env var (e.g. `RWE_REAL_SDK_SUBPROCESS=1`, analogous to `HAS_PROVIDER`) that defaults off in
nested/sandboxed dev environments. Not a defect in `ClaudeAgentSdkGatewayClient` — UT-018 fully
proves its logic with the SDK module mocked out.

**Final route-back round (D-F1):** companion to UT-018 — proves the SDK integration for real (not
just a mocked module boundary). Mock policy (DES-015): only the third-party network (the real
Anthropic Messages API) is faked, replaced by a genuine local HTTP server on 127.0.0.1 implementing
the documented Anthropic Messages streaming (`text/event-stream`) shape; everything else (the real
`@anthropic-ai/claude-agent-sdk` package, its CLI subprocess if present) is genuine — no network
beyond localhost, no paid endpoint ever contacted.

File: `tests/integration/claude-agent-sdk-session.test.ts`.
Case: the stub's FIRST response is a `tool_use` turn asking the agent to read a file written into the
run workspace (`cwd`); the stub's SECOND response (once it observes a `tool_result` in the inbound
message history) is a final text turn — proving the SDK's own agent loop actually executed the tool
call rather than a single-shot request/response. Asserts `>=2` requests reached the stub, the second
carries a `tool_result`, and `client.invoke()` resolves the final text.
Hermeticity guard: if the local stub never receives any request within a bounded window (CLI
genuinely absent, or — empirically observed while authoring this test in this sandboxed nested-agent
host — `query()` short-circuits to a synthetic `"model":"<synthetic>"` canned response instead of
making a real outbound HTTP call, rather than spawning a genuinely isolated headless session), the
test SKIPS with an explicit `console.warn` reason instead of failing on an environment limitation
that is not the production code's fault; it never skips silently when the stub DOES receive traffic.
Red reason: `src/gateway/claude-agent-sdk-client.ts` does not exist yet (same gap as UT-018) — import
fails, caught and re-thrown with an explicit "not implemented yet" message (confirmed `npx vitest
run` this file: 1/1 fail, ~20ms, correct reason — the elaborate stub server/skip-guard code is never
even reached).
Caveat for Gate 6: the exact real-CLI wire contract (streaming event ordering, headers, tool-name
resolution for a built-in `Read` tool) was authored from the documented public Anthropic Messages API
shape, not validated against a real completed round trip (chicken-and-egg — the production code this
test drives doesn't exist yet). If Gate 6's real run reveals the stub's shape needs adjustment, that
is expected TDD ping-pong for a new external-SDK integration, not a test-authoring defect.

### IT-016 — agentType composition-root loader: agents/*.md frontmatter populates the registry at startup
- **status:** green
- **traces:** DES-007, ARCH-004
- **tier:** integration
- **real:** false
- **result:** pass
- **iter:** v1

**Gate 6 closure (IMPL-036):** `src/agent-definitions.ts` + `ServerConfig.agentDefinitionsDir` +
`RunManagerDeps.agentTypes` implemented. Both cases green (`npx vitest run
tests/integration/agent-type-composition-root.test.ts`).

**Final route-back round (D-F2):** closes the gap DES-007's Gate-6 route-back note flagged — "no
caller currently populates `agentTypes` from an actual on-disk registry ... every `agentType` is
'unknown' ... until that loader is built." Real `createServer()` + real McpFacade/RunManager/
AgentExecutor/sandbox child process + a real on-disk frontmatter file (real fs, unit/integration
policy precedent: `WorkflowCatalog`/UT-011 also uses real fs for a single component); only the
third-party LLM provider network is faked (a local HTTP server standing in for Ollama's
`/api/generate`, reached via `OLLAMA_BASE_URL`).

File: `tests/integration/agent-type-composition-root.test.ts`.
Cases: (1) a known `agentType` ('helper', loaded from `agents/helper.md`'s frontmatter) applies its
`systemPrompt` (present in the outbound prompt) AND its `model:` field (an alias name, resolved the
same way `opts.model` is — proven by a DIFFERENT alias/model reaching the stub than the run's
unrelated 'default' alias would); (2) an unknown `agentType` still fails fast — a catchable in-script
rejection (`try/await/catch`), never a silent no-op, never dispatched to the gateway at all.
Red reason: `ServerConfig` has no `agentDefinitionsDir` field and `createServer()` never loads or
forwards an `agentTypes` registry into `RunManager`/`AgentExecutor` (confirmed by reading
`src/server.ts`/`src/run-manager.ts` — `RunManagerDeps` has no `agentTypes` field either).
Confirmed `npx vitest run` this file: case (1) fails — `helper` resolves as "unknown" today so the
whole run fails (status `failed`, not `completed`), correct-reason red. Case (2) is confirmed GREEN
today — NOT a false forcing test: since the registry is always empty right now, ANY `agentType`
(including 'does-not-exist') is already correctly "unknown" and fails fast per `AgentExecutor`'s
existing D-V5 logic (UT-017) — this sub-case is an intentional regression guard (must stay green once
the loader is wired) rather than a driver of new work, documented transparently rather than
mislabelled as forcing-red.

### IT-017 — ClaudeAgentSdkGatewayClient: D-F5 route-back — real CLI + local stub, opts.model + is_error
- **status:** green
- **traces:** DES-007, DES-009, DES-013
- **tier:** integration
- **real:** false
- **result:** pass
- **iter:** v1

Gate 6 fix (implementer, D-F5 route-back): same 2-line fix as UT-019 (`options.model` forwarding +
`is_error` check widened). Case A: stub now receives `'haiku-alias'` in the outbound request body.
Case B: `AgentExecutor.run()` now resolves `{kind:'null'}` for an `is_error:true` upstream response.
2/2 green, no test changes.

**D-F5 route-back (verifier, standalone invocation):** real-CLI companion to UT-019. Mock policy
(DES-015): integration tier fakes only the third-party network boundary — a genuine local HTTP
server on 127.0.0.1 standing in for the real Anthropic Messages API; the real
`@anthropic-ai/claude-agent-sdk` package and its CLI subprocess (confirmed present on `PATH` in this
environment) run as-is, same pattern as IT-015/IT-016. No paid endpoint ever contacted.

File: `tests/integration/claude-agent-sdk-gateway-defects.test.ts`.
Case A (defect 1): `client.invoke({opts:{model:'haiku-alias'}})` against a local stub that always
answers a final text turn — asserts what the STUB ITSELF RECEIVES on the wire, i.e. the outbound
`/v1/messages` request body's own `model` field. Confirmed red: the stub receives the CLI's own
internal default (`'claude-fable-5'` in this environment), not `'haiku-alias'`
(`expected 'claude-fable-5' to be 'haiku-alias'`).
Case B (defect 2): the stub always answers HTTP 400 (an Anthropic-Messages-shaped error body) —
runs through `AgentExecutor.run()` (not just the bare `GatewayClient`), matching the task's own
framing "agent() resolves null after bounded retries". Confirmed red: `outcome.kind` is `'text'`
(the literal `"API Error: 400 ..."` string surfaced as if it were a successful response), not
`'null'`.
Hermeticity guard (same convention as IT-015): each case skips with an explicit `console.warn`
reason if the local stub never receives any request within 20s (CLI genuinely absent from `PATH`,
or a nested-agent host intercepting `query()` before any real outbound HTTP call) rather than
failing on an environment limitation that is not the production code's fault; confirmed NOT
triggered in this environment — both cases genuinely reached their stub and failed on the real
assertion.
Red reason: confirmed `npx vitest run tests/integration/claude-agent-sdk-gateway-defects.test.ts` —
2/2 fail, both for the exact assertions above (correct-reason red, ~10s, real CLI subprocess
round trip each — not a skip, not an import/syntax error). Full suite unaffected: `npx vitest run` =
49 files / 184 tests — 179 pass (180 pre-existing minus the 1 pre-existing documented IT-015
environment-specific red, unchanged) / 5 fail (IT-015 pre-existing + these 4 new). `tsc --noEmit`
clean.

### IT-018 — Live budget accounting observable in-script (D-F8)
- **status:** red
- **traces:** REQ-002, DES-005, DES-006, ARCH-003
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/integration/budget-live-accounting.test.ts`.
**D-F8 (binding, REQ-002 3rd acceptance — user-approved):** script-visible `budget.spent()`/
`remaining()` reflect live RunGuard accounting via IPC (piggyback usage on `agent()` IPC responses
and/or a budget query message); no hard-coded stubs. `08-validation.md` round-2/3 VAL-002:
`src/sandbox/child-entry.ts` lines 82-86 hard-code the script-facing budget accessors
(`spent: () => 0`, `remaining: () => total`), never threading the parent process's real live
`RunGuard._spent` counter back to the sandboxed child over IPC. Mock policy (DES-015, integration
tier): real `RunManager`/`RunGuard`/`AgentExecutor`/sandbox child process (real IPC, real OS
subprocess); only `GatewayClient` (third-party network) is faked, with a KNOWN fixed token cost (20
input + 10 output = 30) so the expected post-call value is exact and deterministic — no live
provider/credentials needed.
Case: a script reads `budget.spent()` before AND after a completed `agent()` call — `before` must be
0, `after` must equal the real accumulated token cost (30), `remaining` must equal `500 - 30`.
Red reason: confirmed `npx vitest run tests/integration/budget-live-accounting.test.ts` —
`expected +0 to be 30` (the hard-coded stub never changes regardless of real usage), not an
import/syntax error.

### IT-019 — workflow_suspend aborts an in-flight gateway call (D-F9a)
- **status:** red
- **traces:** REQ-006, DES-009, ARCH-002
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/integration/suspend-aborts-gateway-call.test.ts`.
**D-F9(a) (binding):** thread the run abort signal from `RunManager` through `AgentExecutor` into
gateway `invoke()` (REQ-006's own acceptance line: "in-flight agents are stopped" on suspend).
`08-validation.md` round-2/3 VAL-006: `RunManager` DOES abort its own `AbortController` on suspend
and `AgentExecutor._invokeOnce` DOES race the gateway promise against that same signal (the run
itself correctly transitions to `suspended`) — but the signal is never forwarded INTO the
`gateway.invoke()` request object at all, so a real `GatewayClient` has no way to actually cancel the
in-flight provider call (a real-money concern for a paid provider). Mock policy (DES-015, integration
tier): real `RunManager` + real `AgentExecutor` + real sandbox child process; only `GatewayClient`
(third-party network) is faked — observing whether a signal ever reaches it IS the seam contract this
integration test exists to prove (one level further out than what a unit test on `AgentExecutor`
alone, which already races its own local signal correctly, could show).
Case: a fake gateway records the `signal` field of its inbound request and listens for `abort`; the
test waits (via a resolved promise, not polling) for the gateway to have actually been invoked, then
calls `workflow_suspend`, then asserts the fake observed a real `AbortSignal` that fired.
Red reason: confirmed `npx vitest run tests/integration/suspend-aborts-gateway-call.test.ts` —
`expected undefined to be an instance of AbortSignal` (`AgentExecutor._invokeOnce` builds the gateway
request as `{prompt, opts, runId, agentId}` — no `signal` field at all), not an import/syntax error.

### IT-020 — Per-agent records survive a real server restart (D-F9b)
- **status:** red
- **traces:** REQ-007, DES-008, DES-010, ARCH-006, ARCH-004
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/integration/agent-records-restart-survival.test.ts`.
**D-F9(b) (binding):** per-agent records (`workflow_status.agents` / `workflow_agent_log`) survive
server restart — persist agent records in SQLite or rehydrate from the on-disk `agent-<id>.jsonl` /
journal at boot. `08-validation.md` round-2/3 VAL-007: `RunStore.getRun` (both `InMemoryRunStore` and
`SqliteRunStore`) hard-codes `agents: []` always (`AgentRecord` is only ever tracked in an in-process
`AgentExecutor`'s in-memory `Map`), and `McpFacade.workflow_agent_log` gates access on
`view.agents.find(...)` BEFORE ever calling `RunStore.getTranscript` — so the real transcript data
(which DOES survive on disk as `agent-<id>.jsonl`, per D-V6/IT-006's own persistence proof) becomes
unreachable through the documented API after any restart, even though the run's own top-level status
correctly survives. Mock policy (DES-015, integration tier): real `McpFacade` + real `RunManager` +
real `SqliteRunStore` (genuine on-disk `index.db` + journal/transcript files) + real sandbox child
process; only `GatewayClient` (third-party network) is faked, with a known fixed token cost. Restart
simulated the same way IT-006/IT-012 already do: fresh instances constructed against the SAME
on-disk data dir, no live in-process state carried over.
Case: complete a real run (fake gateway, real IPC/store) on a "before restart" `McpFacade`/
`RunManager`/`SqliteRunStore` instance set; construct a fresh set against the SAME data dir
("restart"); `workflow_status.agents` must be non-empty and `workflow_agent_log(runId,'agent-1')`
must return a non-empty transcript, not `AGENT_NOT_FOUND`.
Red reason: confirmed `npx vitest run tests/integration/agent-records-restart-survival.test.ts` —
`expected 0 to be greater than 0` (`statusAfterRestart.agents` is `[]`), not an import/syntax error;
the run's own top-level `status` correctly reads back as `completed` (sanity-checked in the same
test), isolating the failure to the per-agent-records gap specifically.

### IT-021 — src/main.ts composition-root wiring-completeness: aliases/timeoutMs/retries/agentDefinitionsDir/gateway-selection (D-F10a/b)
- **status:** red
- **traces:** ARCH-004, ARCH-005, REQ-003, REQ-004
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/integration/main-composition-root.test.ts`.
**D-F10 (binding, ORCH ruling on Gate 7.5 round 4's 3 new real defects, ALL in `src/main.ts`, none
caught by any of the prior 5 route-backs' tests):** `08-validation.md` round 4 / `state.yaml
pending[]`: `main.ts`'s real `new ClaudeAgentSdkGatewayClient({baseUrl, cwd})` construction never
passes `aliases`/`timeoutMs`/`retries` at all — real repro: a server booted with `timeoutMs:1500` in
its config file completed a real Ollama `agent()` call in 16.32s (10x the bound); the same omission
also degrades D-F6's alias-aware thinking policy to "always disabled" (safe-by-accident for Ollama,
not the intended per-alias design). STRUCTURAL RULE (binding): a composition-root test must construct
the server the way `main.ts` itself does (via `main.ts` itself or an exported composition helper it
trivially delegates to) and assert every relevant `ServerConfig` key actually reaches the constructed
components — this is that test, so this exact gap class is catchable at unit/integration tier from
now on, not only by a 45-minute real-run validation round.
Intended contract (verifier-authored, not yet in `04-design.md` — flagged for Gate 6 to finalize, same
precedent as D-F6/D-F7/UT-020/UT-021): `src/main.ts` exports `async function composeConfig(fileConfig,
deps?: {queryImpl?, proxyManager?}): Promise<ServerConfig>` — the exact `FileConfig` -> `ServerConfig`
translation `main()` performs today inline, with `main()` itself reduced to `const config = await
composeConfig(loadFileConfig(), {}); const server = await createServer(config);`. `deps` is a new test
seam (no existing `FileConfig` field can carry a function value, since `FileConfig` is JSON-parsed)
mirroring this codebase's existing injectable-seam convention (`ServerConfig.proxyManager`,
`ClaudeAgentSdkGatewayConfig.queryImpl`) — `main()`'s own real call site simply omits it. Mock policy
(DES-015, integration tier): real `ServerConfig`-building logic + a real constructed
`ClaudeAgentSdkGatewayClient`; only the third-party SDK `query()` call (injected `queryImpl`) and the
`LiteLLMProxyManager` subprocess (injected `proxyManager`, same fake as
`claude-agent-sdk-gateway-timeout.test.ts`/`gateway-provider-down.test.ts`) are faked. Also includes a
defensive import-safety harness (documented in the file's own header) neutralizing `src/main.ts`'s
current lack of an import-guard (its bottom-of-file `main().catch(...)` runs for real the instant the
module is evaluated) — `node:child_process.spawn` faked, ephemeral `RWE_PORT`, `process.exit`
neutered, so merely importing the module to check for the `composeConfig` export stays hermetic.
Cases: (1) `gateway:'sdk'` — a hung `queryImpl` session with `timeoutMs:150, retries:1` must resolve
`{ok:false}` within ~1.5s (not the 3s escape hatch, not an unbounded hang), with `queryImpl` called
exactly twice; (2) `gateway:'sdk'` — an Anthropic-mapped `default` alias must leave `options.thinking`
unset (proves `aliases` itself, not just its presence, reached the constructed client's thinking
policy); (3) `gateway:'direct-fetch'` — `config.gateway` must stay `undefined` (so `createServer()`'s
own aliases-driven `LiteLLMGatewayClient` construction applies) AND `config.agentDefinitionsDir` must
equal the input value regardless of gateway choice.
Red reason: confirmed `npx vitest run tests/integration/main-composition-root.test.ts` — all 3 cases
fail identically and immediately on `expect(typeof composeConfig).toBe('function')` (`expected
'undefined' to be 'function'`) since `src/main.ts` exports no such helper today; no unhandled
exceptions, no dangling process/port (the import-safety harness confirmed clean via a full-suite
`npx vitest run`, 189/197 passing, the only other failure being the pre-existing unrelated IT-015).

### IT-022 — src/main.ts composition-root: agentDefinitionsDir end-to-end through composeConfig()+createServer() (D-F10b)
- **status:** red
- **traces:** ARCH-004, REQ-003
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/integration/main-composition-root-agent-types.test.ts`.
**D-F10(b) (binding, Gate 7.5 round 4 real defect):** `08-validation.md` round 4 / `state.yaml
pending[]`: "`main.ts` never reads or forwards `agentDefinitionsDir` into the `ServerConfig` it
constructs, so D-F2's real, tested agentType composition-root loader is permanently unreachable via
the documented product entrypoint — every real agentType value resolves to `Unknown agentType` in
production regardless of any `agents/*.md` directory." IT-016 already proves
`loadAgentDefinitions()`/`createServer({agentDefinitionsDir})` work correctly in isolation via a
hand-built `ServerConfig`; this test proves the SAME thing reachable specifically THROUGH `main.ts`'s
own composition path (`composeConfig()`, same intended contract as IT-021), per D-F10's structural
rule. Mock policy (DES-015, integration tier): real `composeConfig` + real `createServer()` + real
`McpFacade`/`RunManager`/`AgentExecutor`/sandbox child process + a real on-disk frontmatter file (real
fs, matching IT-016's own convention); only the third-party SDK `query()` call and the
`LiteLLMProxyManager` subprocess are faked (same injected `deps` seams as IT-021). Same import-safety
harness as IT-021 (documented in the file's own header).
Case: `composeConfig({agentDefinitionsDir: <dir with helper.md>, gateway:'sdk', ...}, deps)` ->
`createServer(config)` -> `workflow_run({script: "return agent('respond', {agentType:'helper'})"})`
must complete, with the definition's own `systemPrompt` prepended to the outbound prompt and its own
`model:` alias (not the run's unrelated `default` alias) used to route the call.
Red reason: confirmed `npx vitest run tests/integration/main-composition-root-agent-types.test.ts` —
fails immediately on `expect(typeof composeConfig).toBe('function')` (`expected 'undefined' to be
'function'`), same reason as IT-021 — `src/main.ts` exports no such helper today; no unhandled
exceptions or dangling server/process (confirmed via the same full-suite run as IT-021).

### IT-023 — ClaudeAgentSdkGatewayClient + real CLI + local stub: curated allowedTools genuinely narrows the outbound wire tool surface (D-F11)
- **status:** red
- **traces:** DES-009, ARCH-005, REQ-003
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/integration/claude-agent-sdk-gateway-allowed-tools.test.ts`.
**D-F11 (binding), real-CLI companion to UT-024 (same pattern as IT-017's companion to UT-019):**
UT-024 proves `ClaudeAgentSdkGatewayClient` hands a curated `options.allowedTools` to `query()` at
the in-process options-object level; this test proves that curation genuinely narrows what the REAL
SDK CLI subprocess puts on the wire — the only signal that actually matters for round-5's root
cause (an in-process options object could be curated yet still have no effect if the CLI itself
ignores it). Mock policy (DES-015, integration tier): real `@anthropic-ai/claude-agent-sdk` package +
its CLI subprocess (confirmed present on PATH, same precedent as IT-015/IT-017); only the
third-party network boundary is faked — a genuine local HTTP server capturing the exact outbound
request body (including its own `tools` array).
Hermeticity guard (same convention as IT-015/IT-017): skips with an explicit `console.warn` reason if
the local stub never receives any request within 20s; confirmed NOT triggered in this environment —
the CLI genuinely reached the stub.
Case: a curated `defaultAllowedTools: ['Read','Write']` config — the stub-captured `tools` array in
the outbound request must be restricted to (at most) that 2-tool curated set.
Red reason: confirmed `npx vitest run tests/integration/claude-agent-sdk-gateway-allowed-tools.test.ts`
— the real CLI genuinely reached the stub (not a skip) and its captured `tools` array includes names
outside the curated 2-tool set (`expect(names.every(...)).toBe(true)` fails — `false` received), not
an import/syntax error.

### IT-024 — In-flight AgentRecord state ('queued'/'running') observable via workflow_status while an agent() call is in flight (D-F12)
- **status:** red
- **traces:** DES-008, ARCH-004, REQ-007, REQ-002
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/integration/in-flight-agent-state.test.ts`.
**D-F12 (binding, Gate 7.5 round-5 real defect):** AgentRecord persists queued/running state
transitions in real time so `workflow_status` shows in-flight agents, not only terminal states.
`08-validation.md` round-5 VAL-002/VAL-007 real repro: 3 real concurrent Ollama `agent()` calls
polled mid-flight (`status:"running"`) returned `agents:[]` — every record only appeared once
`status:"completed"`, all already `state:"done"`. Root cause: `src/agent-executor.ts`
`AgentTranscriptSink.capture()` only ever creates a record at call-RESOLUTION time; no code path
records a dispatched-but-unresolved ("running") or waiting-for-a-concurrency-slot ("queued") agent —
compounded by `RunManager._handleAgentRequest` only allocating an `agentId` at all AFTER
`RunGuard.acquireSlot()` resolves, so a genuinely-queued call has no id to record a "queued" entry
against today. Mock policy (DES-015, integration tier): real `RunManager`+`RunGuard`+`AgentExecutor`+
real sandbox child process; only `GatewayClient` (third-party network) is faked, with
test-controlled deferred resolution (no real timing dependency) so the in-flight window is
deterministic.
Case: `concurrency:1`, two `parallel()` agent() calls ("A"/"B") against a fake gateway A dispatches
into first — while A is in flight (before either resolves), `workflow_status.agents` must show A as
`"running"` and B (blocked on the concurrency slot) as `"queued"`; once A resolves and B is
dispatched, A must read `"done"` and B `"running"`; once both resolve, both read `"done"` and the
final script result deep-equals `["done-A","done-B"]`.
Red reason: confirmed `npx vitest run tests/integration/in-flight-agent-state.test.ts` —
`findByLabel(view.agents,'A')?.state` is `undefined` (expected `'running'`) at the very first
mid-flight poll — `view.agents` has no entry at all yet, exactly matching the real round-5 repro
(`agents:[]` while `status:"running"`), not an import/syntax error.

### IT-025 — workflow_resume re-runs an aborted-mid-flight agent() call live instead of replaying the journaled null (D-F13)
- **status:** red
- **traces:** DES-004, DES-010, ARCH-002, REQ-006
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

File: `tests/integration/resume-rerun-aborted-call.test.ts`.
**D-F13 (binding, Gate 7.5 round-5 real defect, only reachable now that D-F10c's real subprocess-kill
fix landed):** the journal must distinguish terminal-null (agent genuinely failed after retries —
replay from cache is correct) from aborted-null (suspend/stop interrupted it — MUST re-run live on
resume); `workflow_resume` must produce the same final result as an uninterrupted run (REQ-006's 1st
acceptance clause). `08-validation.md` round-5 VAL-006 real repro: suspending a real in-flight
`agent()` call then resuming returned `{"status":"completed"}`/`result:null` in well under 1s — no
real inference time elapsed. Root cause: the abort path journals `{value:null}`
(`src/run-manager.ts`'s `_handleAgentRequest`) indistinguishably from a genuinely-completed
terminal-provider-error null (`src/types.ts`'s `JournalEntry` has no distinguishing field) —
`ResumeCache.replay()` (correctly, per its own "same script+args -> 100% cache hit" contract) treats
ANY journaled entry as a completed cache hit and replays it, never re-invoking the gateway. Mock
policy (DES-015, integration tier): real `RunManager`+`RunGuard`+`AgentExecutor`+real sandbox child
process; only `GatewayClient` (third-party network) is faked — its first invocation hangs forever
(modeling the real subprocess an abort orphans, matching `AgentExecutor._invokeOnce`'s own
signal-race semantics) and its second invocation (the live re-run this test exists to force)
resolves for real with content distinguishable from the aborted null.
Case: suspend a run mid-`agent()`-call (fake gateway's first invocation never settles on its own);
resume it (same, unchanged script) — the fake gateway must be invoked a SECOND time, and the final
`workflow_result` must equal the second invocation's real content, never the aborted `null`.
Red reason: confirmed `npx vitest run tests/integration/resume-rerun-aborted-call.test.ts` —
`invokeCount` stays `1` (expected `2`) and the final result stays `null` (expected `'REAL-RESULT'`)
— the resumed run reaches `"completed"` in well under a second, exactly matching the real round-5
repro, not an import/syntax error and not a hang.

### IT-026 — Nested workflow() journal callSeq namespacing + resume fidelity (D-G8-1)
- **status:** red
- **traces:** ARCH-002, ARCH-006, REQ-006
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

Gate 8 review route-back (D-G8-1, adversarial.md finding V3, HIGH). **Bug (review evidence,
`src/sandbox/child-entry.ts:29,81` + `src/run-manager.ts:292-296`):** a nested `workflow()` call
spawns a NEW `SandboxHost`/child process for the nested script, and that child has its OWN
independent `nextCallSeq` counter starting at 0 again — but its `agent()` calls are journaled into
the SAME parent run's journal (`_handleWorkflowRequest`'s nested `SandboxHost`'s `onAgentRequest`
forwards to the SAME `this._handleAgentRequest(runId, ...)` as the outer script). So the parent
script's own callSeq 0 and the nested script's own callSeq 0 collide in one run's journal.
`ResumeCache.build()` keys entries in a `Map<callSeq, JournalEntry>` (`src/resume-cache.ts`), so a
collision silently drops one of the two entries (last-write-wins) and corrupts replay for BOTH
calls — once any callSeq's `replay()` misses, `Plan._missed` stays true for the rest of the run
(the "longest-unchanged-prefix" contract), forcing every later call (including ones never touched
by the interruption) to re-run live on resume. Fix must namespace nested journal entries (e.g. a
compound callSeq or a per-invocation sub-run id) so the per-run journal keyspace stays unique
across process boundaries — never fed to `resume-cache.ts` as a colliding key in the first place.
Mock policy (DES-015, integration tier): real `RunManager` + real `WorkflowCatalog` (real on-disk
SQLite) + real sandbox child processes (real IPC, real `node:vm`) for the namespacing case; the
resume-fidelity case additionally uses a real `AgentExecutor` with only the `GatewayClient`
(third-party network) faked — same tier/pattern as the already-established IT-019
(`suspend-aborts-gateway-call.test.ts`).
File: `tests/integration/nested-workflow-callseq-resume.test.ts`.
Cases: (1) a nested `workflow()`'s own `agent()` call gets a journal callSeq that never collides
with the parent script's own callSeq values in the same run (both entries independently
addressable by prompt); (2) resuming a run containing a nested `workflow()` replays the
already-journaled, unmodified parent-level call from cache instead of re-invoking the gateway live.
Red reason: confirmed `npx vitest run tests/integration/nested-workflow-callseq-resume.test.ts` —
case (1): `new Set(callSeqs).size` is `1` (expected `2`) — both journal entries carry `callSeq: 0`;
case (2): `gatewayCallCounts.get('A')` is `2` (expected `1`) — the already-cached, unmodified 'A'
call is forced to re-run live on resume because the collision corrupts the whole run's resume
cache. Both fail for the documented collision reason, not an import/syntax error.

### IT-027 — AgentTranscriptSink captures the SDK message/tool_call/tool_result stream (D-G8-2)
- **status:** red
- **traces:** ARCH-004, DES-007, DES-008, REQ-007
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

Gate 8 review route-back (D-G8-2, quality-dimensions.md finding O-1, HIGH). **Bug (review
evidence):** `src/types.ts:94` declares `TranscriptEvent.kind` as
`'message' | 'tool_call' | 'tool_result' | 'usage'`, but `AgentTranscriptSink.capture()`
(`src/agent-executor.ts`) only ever emits `kind: 'usage'` — never the other three.
`ClaudeAgentSdkGatewayClient._drain` (`src/gateway/claude-agent-sdk-client.ts:158-172`) iterates the
real SDK session's own async-generator message stream (assistant/tool_use/tool_result turns) and
explicitly discards every message except the final `type: 'result'` one
(`if (msg.type !== 'result') continue;`) — nothing forwards the intermediate messages anywhere.
Net effect: `workflow_agent_log` (built for exactly this purpose) can only ever show one summary
token-count line per agent call, never the actual reasoning/tool-call trace ARCH-004's own
rationale promised ("one capture path taps the SDK message/event stream ... feeds
`workflow_agent_log`, dashboard, and resume cache"). Mock policy (DES-015, integration tier): real
`McpFacade` + real `RunManager` + real `InMemoryRunStore` + real `AgentExecutor`/
`AgentTranscriptSink` + real sandbox child process + real `ClaudeAgentSdkGatewayClient`; only the
third-party `@anthropic-ai/claude-agent-sdk` `query` export is faked (same seam UT-018/IT-015
already use) — the fake session emits a realistic assistant-text -> tool_use -> tool_result ->
result message sequence, the exact shape a real tool-using agent turn produces.
File: `tests/integration/agent-transcript-message-stream.test.ts`.
Case: `workflow_agent_log` returns `message`/`tool_call`/`tool_result` events, in order (message
before its tool_call before its own tool_result), carrying real content (not empty stubs) — not
only a terminal `usage` line.
Red reason: confirmed `npx vitest run tests/integration/agent-transcript-message-stream.test.ts` —
`kinds` is `['usage']`, expected to contain `'message'`/`'tool_call'`/`'tool_result'` — the 3
intermediate SDK messages the fake session emits are never captured anywhere, only the final
`result` message's token summary. Not an import/syntax error.

### IT-028 — MCP tools/list serves real, non-placeholder tool metadata (D-G8-3)
- **status:** red
- **traces:** ARCH-001
- **tier:** integration
- **real:** true
- **result:** fail
- **iter:** v1

Gate 8 review route-back (D-G8-3, quality-dimensions.md finding C-1, HIGH). **Bug (review evidence,
`src/server.ts:147-149`):**
`const tools = TOOL_NAMES.map((name) => ({ name, description: name, inputSchema: { type: 'object' } }));`
— every tool's `description` is literally its own name, and every `inputSchema` is an empty
`{type:'object'}` with no `properties`/`required` — an MCP client cannot learn from the served
schema what fields any tool takes (e.g. that `workflow_run` takes `script`/`args`, or that
`workflow_agent_log` needs both `runId` and `agentId`). Violates ARCH-001's "uniform result
envelope ... so agent callers branch identically" consumability rationale. Mock policy (DES-015):
real HTTP MCP server, real `tools/list` JSON-RPC round trip over the actual Streamable HTTP
transport — no mock of the SUT's own boundary at all (`real: true`).
File: `tests/integration/mcp-tools-list-schema.test.ts`.
Cases: (1) every tool has a non-placeholder `description` (not equal to its own `name`); (2) every
tool has an `inputSchema` with real (non-empty) `properties`; (3) `workflow_run`'s schema documents
`script`/`args`; (4) `workflow_agent_log`'s schema documents `runId`/`agentId`.
Red reason: confirmed `npx vitest run tests/integration/mcp-tools-list-schema.test.ts` — 4/4 fail:
`tool.description` equals `tool.name` for every tool; `tool.inputSchema.properties` is `undefined`
for every tool; `workflow_run`/`workflow_agent_log`'s schemas have no properties at all. Exactly
matches the review's cited `server.ts:147-149` placeholder line, not an import/syntax error.

### IT-029 — src/main.ts composeConfig(): zero-config default gateway path has a hardcoded timeoutMs fallback (D-G8-4)
- **status:** red
- **traces:** ARCH-005, REQ-004
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

Gate 8 review route-back (D-G8-4, quality-dimensions.md finding S-1, HIGH — enforces decision D-G,
re-confirmed by the user 2026-07-03: "keep the minimal breaker in v1 ... so a dead/hung provider
cannot hang a whole run"). **Bug (review evidence, `src/main.ts:93,113`):** `composeConfig()`
forwards `timeoutMs: fileConfig.timeoutMs` with NO hardcoded fallback — contrast `bind`
(`?? '127.0.0.1'`) and `port` (`?? 8787`), which both DO have real defaults baked in.
`loadFileConfig()` returns `{}` when `rwe.config.json` doesn't exist on disk — the ordinary "just
run it" zero-config path this entrypoint exists to support. In that exact deployment shape, a
dead/unresponsive local provider hangs the `agent()` call — and, because RunGuard's concurrency
slot stays held for the duration, the whole run — indefinitely, with zero automatic recovery. The
legacy path already gets this right (`src/server.ts:120` hardcodes
`timeoutMs: config?.timeoutMs ?? 15000` for `LiteLLMGatewayClient`); the new D-F4 *default* SDK
gateway path does not. Mock policy (DES-015, integration tier): real `composeConfig()` + real
`ClaudeAgentSdkGatewayClient` construction; only the third-party SDK `query()` call (injected
`queryImpl`) and the `LiteLLMProxyManager` subprocess (its own pre-existing spawnImpl/fetchImpl
seams) are faked — same pattern as the already-established IT-021 (`main-composition-root.test.ts`).
File: `tests/integration/main-default-timeout-fallback.test.ts`.
Case: `composeConfig({})` (no `timeoutMs` key anywhere in the file config) constructs a gateway
whose `invoke()` against a genuinely hung session still resolves a bounded failure (not an
unbounded hang) well within a generous 20s test-level escape hatch.
Red reason: confirmed `npx vitest run tests/integration/main-default-timeout-fallback.test.ts` —
`invoke()` never settles at all; the assertion observes the 20s test-level escape-hatch sentinel
instead of a real bounded `GatewayResult` (test runs the full ~20.5s before failing, not a
crash/import error) — exactly matching the review's cited `timeoutMs !== undefined` gate at
`claude-agent-sdk-client.ts:78`.

### IT-030 — Concurrent parallel() dispatch against a near-exhausted budget cannot materially overshoot (D-G8-6)
- **status:** red
- **traces:** ARCH-002, REQ-002
- **tier:** integration
- **real:** false
- **result:** fail
- **iter:** v1

Gate 8 review route-back (D-G8-6, adversarial.md finding V2, MEDIUM cost). **Bug (review
evidence):** `src/run-manager.ts:314` calls `entry.guard.assertBudget()` (throws only if
`_spent >= total`) BEFORE dispatch, but tokens are only added AFTER the gateway returns
(`src/agent-executor.ts`'s `AgentTranscriptSink.capture()` -> `guard.addTokens(delta)`,
post-`invoke`). Under `parallel()`, many concurrent `agent()` calls all read the SAME stale
`_spent` (still 0) before any of them has had a chance to record its own spend — so all of them
pass the pre-dispatch check and all get dispatched, spending far more than the budget ceiling
("hard-throw at ceiling" never actually fires as a spend cap under concurrency). A minimal fix
consistent with ARCH-002's single-authority-per-run goal is to reserve/pre-charge an estimate at
`acquireSlot()` and reconcile in `capture()`, not a distributed-consensus mechanism. Mock policy
(DES-015, integration tier): real `RunManager` + real `RunGuard`/`AgentExecutor` + real sandbox
child process + real `parallel()` VM guard; only the `GatewayClient` (third-party network) is
faked, with an artificial resolve delay so the race is deterministic (not a timing coin-flip) — by
the time the FIRST call's token accounting could possibly land, every concurrent call has already
had its own pre-dispatch budget check evaluated.
File: `tests/integration/parallel-budget-concurrency.test.ts`.
Case: budget set to exactly one call's worth; a 10-item `parallel()` burst against it — at most 1-2
calls may actually succeed/dispatch (excess calls resolve to `null`, i.e. throw inside their own
thunk per `parallel()`'s own catch-and-null semantics), and the run's own live `budget.spent()`
must stay within one call's worth of the ceiling, never ~10x over.
Red reason: confirmed `npx vitest run tests/integration/parallel-budget-concurrency.test.ts` — all
10 concurrent calls succeed (`succeeded` is `10`, expected `<= 2`) — the stale pre-dispatch check
lets every one of them through before any records spend. Not an import/syntax error.

---

## End-to-End Tests

### E2E-001 — Full workflow lifecycle: submit → poll status → fetch result
- **status:** green
- **traces:** REQ-001, REQ-005, REQ-007
- **tier:** e2e
- **real:** true
- **result:** pass
- **iter:** v1

Gate 6.5 fix (verifier): "workflow_list includes the submitted run" treated the raw ResultEnvelope
as a bare array instead of unwrapping `.result` (DES-001; every tool returns a ResultEnvelope,
confirmed by UT-001). Fixed to `(await mcpCall(...)).result`. 4/4 green.

Gate 7.5 (validator): re-confirmed real (real server process + real HTTP client + real SQLite
store + real sandbox child, no SUT-boundary mock) via `npx vitest run tests/e2e/workflow-run-lifecycle.test.ts`
(4/4 green) and independently via `curl` against a standalone `npm run start` process — see
`08-validation.md` VAL-001/VAL-005. Note: this item does not exercise `workflow_agent_log`, so it
does not surface REQ-007's real transcript-stub defect (see VAL-007).

File: `tests/e2e/workflow-run-lifecycle.test.ts`.
Cases: workflow_run returns runId immediately; workflow_result deep-equals script return value;
workflow_status shows phase list; workflow_list includes submitted run.
Red reason: createServer() throws NotImplementedError.

### E2E-002 — Suspend → resume → cache replay
- **status:** green
- **traces:** REQ-006, REQ-002
- **tier:** e2e
- **real:** true
- **result:** pass
- **iter:** v1

Gate 7.5 (validator): re-confirmed real via `npx vitest run tests/e2e/suspend-resume-replay.test.ts`
(3/3 green) AND independently against a standalone, genuinely-restarted `npm run start` process
(`pkill` + fresh start, same workRoot; a `stopped` run's status survived) — see `08-validation.md`
VAL-006/VAL-002 for full evidence including a real 2-level `workflow()` nesting rejection and a
1000-item `parallel()` under the real concurrency cap.

Gate 6.5 fix (verifier): intermittent timeout (~3-4 of ~10 full-suite runs) on the suspend
sub-tests, always green in isolation — root cause was host-level scheduling contention from
15+ real-child_process-spawning test files running fully in parallel, occasionally pushing the
real child's start-to-suspend round trip past its fixed poll window. Not a logic defect (suspend
logic itself, exercised mock-free in state-machine.test.ts/run-manager-runguard.test.ts, was
never observed to fail). Fixed at the config root cause rather than padding individual poll
windows: `vitest.config.ts` now sets `fileParallelism: false`, removing the host-contention
source. Confirmed 3/3 green across 3 consecutive full-suite runs post-fix.

D-F3 fix (final route-back round, verifier): this route adds several more real-child-process/
real-HTTP-server integration files (IT-015/IT-016), further widening host contention beyond what
`fileParallelism:false` alone tolerates, so the POST-suspend/resume poll window (`pollUntil`) was
raised 15000ms→25000ms (assertion semantics unchanged, only the tolerance widened, per instruction).
The pre-suspend fixed sleep was NOT simply raised, though: raising it first (100ms→300ms, as a naive
reading of "raise ... pre-suspend waits" would do) was tried and measured empirically to
**deterministically break** these tests — in this environment (no `ANTHROPIC_API_KEY`/real provider),
a single/double `agent()` call rejects near-instantly, so the whole run reaches `completed` only
~150-200ms after `workflow_run` (measured via a standalone probe script, 5/5 runs within 197-204ms);
a 300ms fixed wait therefore always suspends AFTER the run has already finished (reproduced twice,
4/6 sub-tests red both times, not a flake). Replaced the fixed sleep with an active
`waitUntilRunning()` poll (bounded 10s, 20ms interval) that fires suspend the instant `running` is
observed — this genuinely adapts to however long host contention makes the child take to start,
without ever risking the overshoot a bigger constant causes; re-confirmed 3/3 files, 6/6 sub-tests
green across 3 consecutive isolated runs (~2s each) plus green in the full-suite run.

File: `tests/e2e/suspend-resume-replay.test.ts`.
Cases: suspend → status:suspended; resume replays cached calls without re-running;
suspended run survives server restart and can be resumed.

### E2E-003 — Named workflow register → invoke by name
- **status:** green
- **traces:** REQ-014, REQ-013
- **tier:** e2e
- **real:** true
- **result:** pass
- **iter:** v1

Gate 7.5 round 2 (validator): CONFIRMED FIXED — `npx vitest run tests/e2e/named-workflow-e2e.test.ts`
= 6/6 green (independently re-run standalone, not just trusted the full-suite count). The
`scriptVersion`/catalog-persistence defects noted below are fixed (D-V2 SQLite persistence,
scriptVersion threading) — flipping this item green/pass; status/result below were stale from the
round this defect was found and not updated until now.

Gate 7.5 (validator) update: the "workflow_register saves a workflow and workflow_list shows it"
sub-test noted RED below was fixed by IMPL-027 (`06-impl-log.md`) and is confirmed green for real
via `curl` against a standalone `npm run start` process (`workflow_list` now returns
`kind:"workflow"` entries before any run — see `08-validation.md` VAL-014). However, real-run
validation surfaced two NEW, previously-uncaught real defects for the "updating workflow → new
runs use new version" case: (1) `workflow_status`/`workflow_list`'s `scriptVersion` field is wrong
(always `"v1"`) for every run of a named workflow after its first registration, even though the
correct script content is genuinely executed; (2) `WorkflowCatalog` registrations do not survive a
real server restart (in-memory only), unlike run status which does. Full evidence in
`08-validation.md` VAL-014. Overall item flipped to `real:true` (genuinely run, no mock) / RED
(genuine failure) rather than left green-on-mock.

Gate 6.5 fix (verifier), 5/6 sub-tests now green: (2) "workflow(unknownName) inside a script
throws" was missing `await` before `workflow(...)` inside its own try/catch (ordinary JS async
semantics — the rejection arrives after the catch already returned) — fixed. (3) "run-A/run-B ...
cannot see it" called `require('fs')` directly inside a sandboxed script, which DES-005
intentionally disallows (confirmed green by sandbox-guards.test.ts) — rewritten to prove
independent per-run args/results through the documented script API instead (real directory-level
isolation is already covered server-side by IT-007/WorkflowCatalog.runWorkspace). REMAINING RED,
NOT a test defect: (1) "workflow_register saves a workflow and workflow_list shows it" — after
fixing the `.result` envelope-unwrap bug (matching UT-001's documented contract), this sub-test
still fails because `McpFacade.workflow_list()` only returns `store.listRuns()` (RunSummary[] of
runs), never `WorkflowCatalog.list()` (registered-but-not-yet-run catalog entries). REQ-014's own
acceptance line ("When a script is registered Then workflow_list shows it") requires a
catalog-registered workflow to appear before any run — DES-001 types `workflow_list` as
`RunSummary[]` only, which structurally cannot represent a never-run catalog entry (no runId/
status/scriptVersion/createdAt). This is a genuine REQ-014 vs DES-001/workflow_list contract gap
in the implementation, not a test-authoring bug — flagged back to implementation, see
needs_clarification. Left red rather than loosened.

File: `tests/e2e/named-workflow-e2e.test.ts`.
Cases: workflow_register saves; workflow_list shows it; workflow_run by name executes;
workflow(name) inside script runs inline; unknown workflow name throws catchable error;
run-A/run-B workspaces isolated; updating workflow → new runs use new version.
Red reason: createServer() throws NotImplementedError.

---

## Acceptance Tests

### VAL-001 — 100% workflow JS API compatibility
- **status:** green
- **traces:** REQ-001
- **tier:** acceptance
- **real:** true
- **result:** pass
- **iter:** v1

Gate 7.5 (validator): confirmed real via standalone `npm run start` + `curl` (independent OS
process, real HTTP client) covering every listed case, plus `npx vitest run tests/acceptance/val-001-compat.test.ts`
(6/6 green). Full evidence in `08-validation.md` VAL-001.

Gate 7.5 round 2 (validator): re-confirmed real, PLUS closed round 1's one open item on this REQ
("each `agent()` with a `schema` yields an object validating against that schema") — real Ajv
schema-validated success against local Ollama (`{"greeting":"hi","count":3}`), not the raw
un-parsed text round 1 found. Full evidence in `08-validation.md` VAL-001.

File: `tests/acceptance/val-001-compat.test.ts`.
Cases: return value deep-equals script return; args accessible; Date.now() → DETERMINISM_GUARD;
Math.random() → guard; pipeline() throwing stage → null; parallel() throwing thunk → null; phase() recorded.
Red reason: createServer() throws NotImplementedError.

### VAL-002 — Workflow semantics: nesting, concurrency caps, budget accounting
- **status:** red
- **traces:** REQ-002
- **tier:** acceptance
- **real:** true
- **result:** fail
- **iter:** v1

Gate 7.5 (validator): confirmed real via standalone `npm run start` + `curl`, additionally proving
the genuine 2-level `workflow()` nesting REJECTION (`NESTING_ERROR`) — beyond what val-002's own
level-1-only case covers — and a real 1000-item `parallel()` completing under the concurrency cap.
Full evidence in `08-validation.md` VAL-002.

Gate 7.5 round 2 (validator): found a real defect this test file's own "budget total/spent()/
remaining() in script match server accounting" case does NOT catch — it only checks the script's
budget object BEFORE any `agent()` call is made, where the invariant `remaining === total - spent`
holds trivially true even against a hard-coded stub (`spent()` always returns `0`). A real repro
that reads `budget.spent()` AFTER a real completed `agent()` call (real token usage confirmed
nonzero via `workflow_status`) shows `spent()` still returns `0` — `src/sandbox/child-entry.ts`
lines 82-86 hard-code the script-facing budget accessors and never thread the live parent-process
`RunGuard._spent` counter back to the child. Budget ENFORCEMENT itself (`RunGuard.assertBudget()`,
the "budget exceeded → subsequent calls throw" case below) is confirmed correctly wired to real
usage and unaffected — only the script-OBSERVABLE accessor values are wrong. Full evidence +
root cause in `08-validation.md` VAL-002. Flagged back to Gate 5/6 (needs the child-entry.ts budget
object to either poll the parent via IPC or receive push updates, plus a forcing test that reads
`budget.spent()` AFTER a real/faked `agent()` call, not only before).

Gate 6.5 fix (verifier): `runAndWait`'s shared helper returned `workflow_status`'s envelope
directly as `r`, so `r.result` was the RunStatusView, not the script's return value (DES-001;
`workflow_result` carries the payload — D-I2, confirmed correct by val-001's own `runAndWait`).
Fixed to mirror val-001: fetch `workflow_result` once terminal. Also fixed "budget exceeded:
subsequent agent() calls throw": `budget: 1` can never be exceeded by a single agent() call
(RunGuard.assertBudget() checks `spent >= total` BEFORE the call, and spent starts at 0) — changed
to `budget: 0`, which deterministically exceeds on the very first call regardless of whether a
live provider is configured. 4/4 green.

File: `tests/acceptance/val-002-caps.test.ts`.
Cases: second-level workflow() nesting guard; budget total/spent()/remaining() consistent in script;
budget exceeded → subsequent agent() throws; agent counter cap observable.
Red reason: createServer() throws NotImplementedError.

### VAL-003 — Real agent execution via Claude Agent SDK
- **status:** red
- **traces:** REQ-003
- **tier:** acceptance
- **real:** true
- **result:** fail
- **iter:** v1

Gate 7.5 (validator): actually run for real against a local Ollama model (`qwen2.5:7b`, reachable
at `http://localhost:11434`) — this test file's own `HAS_PROVIDER` guard was never true in any prior
CI/Gate 6/7 run (no `ANTHROPIC_API_KEY`), so its behavioral assertions were never exercised until
now. Result: **the no-schema text path is genuinely correct** (`agent()` → real model text, e.g.
`"PONG"`, with real token accounting), **but the schema-validation and agentType-validation paths
are real, unmocked defects**: `agent(prompt,{schema})` returns the raw un-parsed/un-validated
provider text string type-cast to `object` (no `JSON.parse`, no schema validation library anywhere
in `src/` or `package.json`, no retry-on-mismatch), and an unknown `agentType` is silently accepted
rather than erroring (the field is declared in `types.ts` but never read elsewhere). Full evidence,
root-cause line numbers, and why every existing mock/skip hid this in `08-validation.md` VAL-003.
Flagged back to Gate 5/6 for real design + TDD (JSON-schema validator + retry semantics; an actual
agent-definition resolution subsystem for `agentType`) — not fixed here (out of Gate 7.5 scope).

Gate 7.5 round 2 (validator): schema validation (real Ajv + retry, D-V4) and `agentType` resolution
(D-V5/D-F2) are both CONFIRMED FIXED — real schema-validated success against Ollama, real transcript
read-back (D-V6) also confirmed real (not the round-1 hard-coded `[]`). Still `red` this round for a
DIFFERENT, NEW reason: exercising REQ-003 through `main.ts`'s now-DEFAULT gateway
(`ClaudeAgentSdkGatewayClient`, per D-F4/user decision D1 — the mandated verification tier for this
specific wiring) found 2 real defects that were not present in the `gateway:"direct-fetch"` path the
"what works" evidence above uses: (1) `opts.model`/alias is never forwarded into the SDK session's
`options.model` (`claude-agent-sdk-client.ts:43-51`); (2) a real upstream API error (`is_error:true`
on a `subtype:'success'` SDK result message) is returned as literal error text and treated as a
successful `agent()` resolution instead of `null` (`claude-agent-sdk-client.ts:56-64`) — this
directly violates REQ-003's 3rd acceptance clause ("terminal API error → `agent()` resolves to
`null`, run continues") specifically on the SDK-default path. Full real-run evidence, exact repro,
and line numbers in `08-validation.md` VAL-003. Flagged back to Gate 5/6 (forcing tests: assert
`options.model` derives from `req.opts.model`; assert an `is_error:true` success-subtype result
maps to `{ok:false, reason:'terminal'}`) — not fixed here (Gate 7.5 observes, does not implement).

File: `tests/acceptance/val-003-agent.test.ts`.
Cases: agent() no-schema → string; schema → validated object; terminal error → null; transcript retrievable.
Red reason: createServer() throws NotImplementedError.
Note: individual test cases guarded by HAS_PROVIDER (ANTHROPIC_API_KEY or OLLAMA_BASE_URL);
server startup is always attempted so Gate 5 RED is correctly triggered. This guard is also why the
schema-validation defect above was never previously caught — `HAS_PROVIDER` was always false in CI.

### VAL-004 — Multi-model routing via LiteLLM alias
- **status:** red
- **traces:** REQ-004
- **tier:** acceptance
- **real:** true
- **result:** fail
- **iter:** v1

Gate 7.5 (validator): before this could be run for real at all, a composition-root wiring gap had
to be closed — `ServerConfig.aliases` was declared but never threaded into `RunManager`'s
`GatewayClient`/`SubmissionValidator` (see `08-validation.md` header). After the fix: confirmed real
routing to local Ollama (provider+model observable, real token accounting), no paid-provider
traffic for the local alias, omitted-model→default, UNKNOWN_ALIAS at submission, and BOTH
unreachable-provider variants (missing-credentials `terminal` path AND a genuinely unreachable host
with bounded timeout+retry→null) via standalone `npm run start` + `curl`. Full evidence in
`08-validation.md` VAL-004.

Gate 7.5 round 2 (validator): the evidence above is via the `gateway:"direct-fetch"` config path
(`LiteLLMGatewayClient`, unchanged this round, still fully real-verified GREEN). Flipped to `red`
because the SAME 2 defects found in VAL-003 (`claude-agent-sdk-client.ts` never forwards
`opts.model`, so no alias has any effect on the request) mean REQ-004's core acceptance clause —
"the request is served by the mapped provider model" — is FALSE for `main.ts`'s zero-config
DEFAULT gateway (`gateway:"sdk"`, D-F4/D1's mandated production path, exercised by simply running
`npm run start` with no config file at all). Per D-V3 (carried forward, not re-raised): the paid-
provider (anthropic/openai/gemini) SUCCESS path remains real-unverified in this environment (no
test credentials) — only Ollama has a full real success round trip; this is an accepted, unrelated
gap. Full evidence in `08-validation.md` VAL-003/VAL-004.

File: `tests/acceptance/val-004-routing.test.ts`.
Cases: haiku alias → correct provider+model in AgentRecord; omitted model → default alias;
unknown alias → UNKNOWN_ALIAS at submission; provider down → agent() null (run continues, D-G).
Red reason: createServer() throws NotImplementedError.
Note: individual test cases guarded by HAS_PROVIDER; server startup always attempted.

### VAL-005 — MCP Streamable HTTP interface
- **status:** green
- **traces:** REQ-005
- **tier:** acceptance
- **real:** true
- **result:** pass
- **iter:** v1

Gate 7.5 (validator): confirmed real via a standalone, independently-launched `npm run start`
process reached by `curl` from a separate shell — the genuine documented delivery interface, not an
in-process test harness. Also explicitly confirmed `bind:"0.0.0.0"` serves remote clients (reached
via the host's real LAN IP). Full evidence in `08-validation.md` VAL-005.

Gate 7.5 round 2 (validator): re-confirmed real; `tools/list` now shows 10 tools (D-R4's
`workflow_artifacts` addition present on the real HTTP surface, not just the facade). Full evidence
in `08-validation.md` VAL-005.

File: `tests/acceptance/val-005-mcp.test.ts`.
Cases: tools/list returns all 8 required tools; workflow_run returns runId immediately (async);
server binds to 127.0.0.1; workflow_result polled after completion returns script return value.
Red reason: createServer() throws NotImplementedError.

### VAL-006 — Lifecycle: suspend / resume / stop with durable state
- **status:** red
- **traces:** REQ-006
- **tier:** acceptance
- **real:** true
- **result:** fail
- **iter:** v1

Gate 7.5 (validator): confirmed real restart durability with a genuine process kill+restart
(`pkill` + fresh `npm run start`, same `workRoot`) — a `stopped` run's status survived; also
suspend→resume against the standalone server via `curl`. Full evidence in `08-validation.md` VAL-006.

Gate 7.5 round 2 (validator): status transitions (suspend/resume/stop, restart durability) all
re-confirmed real and correct. Flipped to `red` for a real defect this test file's fake-gateway
tier could not surface: REQ-006's 1st acceptance clause literally requires "in-flight agents are
stopped" on suspend — they are NOT. `src/gateway/client.ts`'s `callProvider()`/
`callViaLiteLLMProxy()` each build their own `AbortController` tied only to `timeoutMs`, never
connected to the run's actual abort signal (`run-manager.ts:152`'s `entry.abortController.abort()`)
— suspend only makes the PARENT stop *waiting* for the in-flight provider call; the real outbound
`fetch()` keeps running server-side until the provider responds or `timeoutMs` elapses regardless.
For a paid provider this means a "suspended" run keeps consuming billed tokens. Real repro + line
numbers in `08-validation.md` VAL-006. Flagged back to Gate 5/6 (thread `req.signal` into
`callProvider`/`callViaLiteLLMProxy`'s own `fetch()` `signal`, replacing/merging with the per-call
timeout controller).

Gate 6.5 fix (verifier): same intermittent-timeout root cause as E2E-002 (host contention from
fully-parallel real-child_process test files occasionally exceeding the suspend poll window).
Fixed via `vitest.config.ts` `fileParallelism: false`, not by loosening this test's assertions.
Confirmed 3/3 green across 3 consecutive full-suite runs post-fix.

D-F3 fix (final route-back round, verifier): same fix as E2E-002 — POST-suspend/stop poll window
(`pollStatus`) raised 20000ms→30000ms for the added contention from IT-015/IT-016. The pre-
suspend/pre-stop fixed 100ms sleep was replaced (not simply raised — see E2E-002's note for the
empirical measurement showing a naive raise to 300ms deterministically breaks this environment's
fast no-credential completion path, ~150-200ms) with the same `waitUntilRunning()` active-poll
helper. Re-confirmed 3/3 files, 6/6 sub-tests green across 3 consecutive isolated runs plus green in
the full-suite run.

File: `tests/acceptance/val-006-lifecycle.test.ts`.
Cases: suspend → suspended; resume → running; stop terminates;
resume with edited script re-runs from first changed agent() call; status survives server restart.

### VAL-007 — Per-agent observability via MCP tools
- **status:** red
- **traces:** REQ-007
- **tier:** acceptance
- **real:** true
- **result:** fail
- **iter:** v1

Gate 7.5 (validator): actually run for real against local Ollama. `workflow_status`'s per-agent
fields (agentId/label/state/provider/model/tokens) are genuinely correct. **`workflow_agent_log` is
a real, unmocked defect**: `src/mcp-facade.ts` hard-codes `return { ..., result: [] }` for it (a
self-documented stub — "returns an empty transcript until the store port grows one") for EVERY
call, including a real, completed, successful agent run — so this required v1 MCP tool never
actually returns a transcript regardless of provider. This is a no-op stub on the product's own
delivery interface (retro L-003), not an injectable external-model seam, and must fail this gate.
`val-007-observability.test.ts`'s own second case (asserting `transcript.length > 0`) would have
caught this had `HAS_PROVIDER` ever been true in CI. Full evidence in `08-validation.md` VAL-007.
Flagged back to Gate 5/6 (needs a real `RunStore` transcript read-back path wired to this tool).

Gate 7.5 round 2 (validator): the hard-coded-`[]` stub is CONFIRMED FIXED (D-V6) — real transcript
events returned for a completed agent, same-process. Stays `red` this round for a NEW,
previously-untested reason: after a genuine server restart, `workflow_agent_log` for an agent that
completed BEFORE the restart returns `AGENT_NOT_FOUND` (and `workflow_status.agents` for that run
comes back `[]`), even though the run's own top-level `status` correctly survives — the restart-
rehydration path (`run-manager.ts:214-244`) rebuilds a fresh, empty `AgentExecutor`, and
`mcp-facade.ts`'s `workflow_agent_log` (lines 131-144) gates access on that live-but-now-empty
`agents` list before ever querying `RunStore.getTranscript` directly by `agentId`. Full evidence +
line numbers in `08-validation.md` VAL-007. Flagged back to Gate 5/6 (query the store directly by
`(runId, agentId)` instead of pre-filtering through the live, restart-volatile `agents` list).

File: `tests/acceptance/val-007-observability.test.ts`.
Cases: workflow_status includes per-agent entries with agentId/label/state/provider/model/tokens;
workflow_agent_log returns full transcript events; phases appear in status with titles.
Red reason: createServer() throws NotImplementedError.
Note: first two cases guarded by HAS_PROVIDER; server startup always attempted.

### VAL-013 — Per-workflow work folder and per-run workspace isolation
- **status:** green
- **traces:** REQ-013
- **tier:** acceptance
- **real:** true
- **result:** pass
- **iter:** v1

Gate 7.5 (validator): the two cases this test file actually covers (distinct workspace dirs for
concurrent same-workflow runs; distinct work folders per workflow) are confirmed real via a
standalone `npm run start` + on-disk inspection (`workflows/<name>/runs/<runId>/` per run — real
filesystem evidence, not mocked). **However REQ-013's third acceptance bullet — "files produced by
[a completed run's] agents are retrievable" **via the API** (status/artifacts listing)" — has no
implementation at all**: no MCP tool lists/returns workspace files; `workflow_status`/`workflow_result`
never surface them. This criterion was never covered by any test in this file either (untested, not
just unmocked). Files ARE retained on disk (retention policy documented in `workflow-catalog.ts`),
but are not retrievable through the product's own delivery interface. Full evidence in
`08-validation.md` VAL-013. Flagged back to Gate 5/6 (needs an artifact-listing tool + test).

Gate 7.5 round 2 (validator): CONFIRMED FIXED (D-V7/D-R4) — the new `workflow_artifacts` MCP tool
is real, registered on the actual HTTP surface (`tools/list`), and genuinely reflects on-disk
workspace state: a file written into a completed run's workspace directory shows up via
`workflow_artifacts({runId})`; an empty workspace correctly returns `[]`. Full evidence in
`08-validation.md` VAL-013.

File: `tests/acceptance/val-013-workspace.test.ts`.
Cases: concurrent runs of same workflow get distinct workspaces; different workflows have distinct work folders.
Red reason: createServer() throws NotImplementedError.

### VAL-014 — Named workflow registry (save, list, invoke by name)
- **status:** green
- **traces:** REQ-014
- **tier:** acceptance
- **real:** true
- **result:** pass
- **iter:** v1

Gate 6.5 fix (verifier), 4/5 sub-tests now green: (4) "workflow(unknownName) throws a catchable
error naming the missing workflow" was missing `await` before `workflow(...)` inside its own
try/catch, AND used `e.code || e.message` — guards.ts's `makeWorkflow` intentionally normalizes
every workflow()-delegate failure's `.code`/`.name` to `NESTING_ERROR` (locked in by the passing
sandbox-guards.test.ts nesting case), so `e.code` is always truthy and shadowed the actual
error-naming info; fixed to `await` + `e.message` (which does carry the missing name — REQ-014's
"naming the missing workflow" lives in the message, not the normalized code).

Gate 7.5 (validator) update: the "workflow_register registers a workflow visible in workflow_list"
sub-test noted red above was fixed by IMPL-027 and is confirmed green for real (`curl` against a
standalone `npm run start` shows `kind:"workflow"` entries pre-run — `08-validation.md` VAL-014).
Real-run validation surfaced two NEW, previously-uncaught real defects instead: (1)
`workflow_status`/`workflow_list`'s `scriptVersion` is wrong (`"v1"` always) for every run of a
named workflow after its first registration, even though the correct script content genuinely
executes — `RunManager`'s correctly-resolved version is computed but never threaded into
`RunStore.createRun()`; (2) `WorkflowCatalog` registrations do not survive a real server restart
(in-memory only), confirmed via a genuine `pkill` + fresh `npm run start`. Full evidence, root
cause, and line numbers in `08-validation.md` VAL-014. Flagged back to Gate 5/6 — not fixed here
(beyond Gate 7.5's composition-root-wiring-only mandate).

Gate 7.5 round 2 (validator): BOTH defects CONFIRMED FIXED. `scriptVersion` is now correctly
threaded and observable (`workflow_run`/`workflow_status` show the right version after a real
`workflow()` invocation); `WorkflowCatalog` registrations are now SQLite-persisted (D-V2) and
confirmed to survive a genuine `pkill`+fresh `npm run start` on the same `workRoot` — see VAL-015.
`workflow(name)` inline nesting also confirmed real this round (`{"childRan":true,"x":1}`). Full
evidence in `08-validation.md` VAL-014.

File: `tests/acceptance/val-014-registry.test.ts`.
Cases: register visible in list; workflow_run by name executes with args; workflow(name) inside script runs inline;
unknown workflow(name) → catchable error naming the missing workflow; update → new runs use new version.
Red reason: createServer() throws NotImplementedError.

### VAL-015 — Named workflow registry survives a real server restart
- **status:** green
- **traces:** REQ-014
- **tier:** acceptance
- **real:** true
- **result:** pass
- **iter:** v1

Mirrors VAL-006's "same workRoot, fresh `createServer()`" restart pattern (D-V2, user-confirmed).
No mock of the SUT's own boundaries: real HTTP server, real MCP tool calls, real on-disk store.
Case: `workflow_register` a workflow → close the server → `createServer` a fresh instance on the
same `workRoot` → `workflow_list` still shows the registered workflow and `workflow_run(name)`
still executes it correctly.

Gate 7.5 round 2 (validator): CONFIRMED FIXED for real (D-V2, SQLite-persisted `WorkflowCatalog`).
Genuine `SIGTERM` shutdown (confirmed process fully exited via `ps aux`) + fresh `npm run start` on
the same `workRoot` → `workflow_list` still shows the registered workflow (same `createdAt`,
confirming it's the persisted row, not a re-registration) and `workflow_run(name)` still resolves
and executes correctly post-restart. Full evidence in `08-validation.md` VAL-015.

File: `tests/acceptance/val-015-registry-persistence.test.ts`.
Cases: registered workflow survives restart — workflow_list shows it and workflow_run(name) works.
Red reason: WorkflowCatalog has no persistence — see above.
