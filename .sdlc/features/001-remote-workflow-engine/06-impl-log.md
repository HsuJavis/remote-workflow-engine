---
stage: impl
status: draft
---
# 06 Implementation Log (TDD — GREEN → REFACTOR)

> Enter only **after the 05 tests are written (red)**. Write the minimal code to turn the matching tests green,
> then refactor once green (stay green). Each `### IMPL-NNN` traces back to TASK/DES, records which tests it
> greened in `greens:`, plus the actual files/commit.

## Parallel implementation phase (per-TASK, integrated below)

### IMPL-001 — MCP Streamable HTTP server bootstrap + bind config
- **status:** done
- **traces:** TASK-001, DES-001
- **greens:** IT-001
- **files:** src/server.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-002 — McpFacade: uniform ResultEnvelope tool dispatch
- **status:** done
- **traces:** TASK-002, DES-001
- **greens:** UT-001
- **files:** src/mcp-facade.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-003 — RunGuard: concurrency gate, agent counter, budget accounting
- **status:** done
- **traces:** TASK-003, DES-002
- **greens:** UT-002
- **files:** src/run-guard.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-004 — RunManager: run state machine + suspend/resume/stop lifecycle
- **status:** done
- **traces:** TASK-004, DES-003
- **greens:** UT-003, IT-002
- **files:** src/run-manager.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-005 — Resume cache: longest-unchanged-prefix replay from journal
- **status:** done
- **traces:** TASK-005, DES-004
- **greens:** UT-004
- **files:** src/resume-cache.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-006 — SandboxHost: real child process + IPC round-trip + SIGKILL abort
- **status:** done
- **traces:** TASK-006, DES-005, DES-006
- **greens:** IT-003
- **files:** src/sandbox/host.ts, src/sandbox/child-entry.ts, tsconfig.json
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-007 — Sandbox VM guards: determinism, parse, size, item-cap, nesting
- **status:** done
- **traces:** TASK-007, DES-005
- **greens:** UT-005, UT-013
- **files:** src/sandbox/guards.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-008 — IPC seam protocol (child<->parent) types
- **status:** done
- **traces:** TASK-008, DES-006
- **greens:** UT-006
- **files:** src/ipc/protocol.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-009 — AgentExecutor: AbortSignal handling, constructor-injected seams
- **status:** done
- **traces:** TASK-009, DES-007
- **greens:** UT-007 (partial — see IMPL-026/test_defects)
- **files:** src/agent-executor.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-010 — AgentTranscriptSink + token-delta accounting wired into AgentExecutor
- **status:** done
- **traces:** TASK-010, DES-008
- **greens:** none directly (see IMPL-026/test_defects — UT-008 has a disconnected-DI test bug)
- **files:** src/agent-executor.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-011 — GatewayClient: LiteLLMGatewayClient real invoke()
- **status:** done
- **traces:** TASK-011, DES-009
- **greens:** IT-005
- **files:** src/gateway/client.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-012 — GatewayClient provider-down breaker + correlation tagging
- **status:** done
- **traces:** TASK-012, DES-009
- **greens:** IT-005, UT-009 (partial — see IMPL-022/test_defects)
- **files:** src/gateway/client.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-013 — RunStore port: InMemoryRunStore + SqliteRunStore
- **status:** done
- **traces:** TASK-013, DES-010
- **greens:** UT-010, IT-006
- **files:** src/run-store.ts, src/store/sqlite-run-store.ts, package.json
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-014 — RunRecorder transition writer + boot-recovery re-hydration
- **status:** done
- **traces:** TASK-014, DES-010
- **greens:** UT-010, UT-014, IT-006
- **files:** src/run-store.ts, src/store/sqlite-run-store.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-015 — WorkflowCatalog: named registry + workspace rooting
- **status:** done
- **traces:** TASK-015, TASK-016, DES-011
- **greens:** UT-011, IT-007
- **files:** src/workflow-catalog.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-016 — Per-workflow work folder + per-run workspace rooting + retention policy note
- **status:** done
- **traces:** TASK-016, DES-011
- **greens:** UT-011, IT-007
- **files:** src/workflow-catalog.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-017 — SubmissionValidator facade wired at workflow_run entry point
- **status:** done
- **traces:** TASK-017, DES-012
- **greens:** UT-012, IT-008 (partial — see IMPL-018)
- **files:** src/submission-validator.ts, src/mcp-facade.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

## Gate 6 closeout (integration) — binding decisions D-I1..D-I8

### IMPL-018 — D-I1: fix McpFacade/RunManager store wiring (root cause of RUN_NOT_FOUND)
- **status:** done
- **traces:** TASK-002, TASK-004, DES-001, DES-003
- **signature:** `McpFacade` now constructs its `RunStore` first and injects the SAME instance into
  `RunManager({ store, clock })` instead of letting `RunManager` build its own private
  `InMemoryRunStore`. This was the root cause of `RUN_NOT_FOUND` across almost every VAL/E2E test
  (facade and manager were reading/writing two different stores).
- **greens:** VAL-001, VAL-002 (partial), VAL-005, VAL-006, VAL-007 (phase sub-test), VAL-013,
  VAL-014 (partial), E2E-001, E2E-002 (partial), E2E-003 (partial), IT-008 (unaffected — already green)
- **files:** src/mcp-facade.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-019 — D-I2: workflow_result returns the script return value (persisted via RunStore)
- **status:** done
- **traces:** TASK-013, TASK-014, DES-001, DES-010
- **signature:** `RunStore` gained `recordResult`/`getResult` (InMemory: in-memory field;
  SqliteRunStore: a `result` column on the `runs` row + a `{type:'result',...}` marker line
  appended to that run's `journal.jsonl`, per D-I2 "journal + SQLite record"). `RunManager.result(runId)`
  reads the live in-process `RunEntry` when available, else falls back to the store. `McpFacade.workflow_result`
  now returns `{runId, status, result: <script return value>}` instead of the whole RunStatusView.
  Annotated DES-001/DES-010 intent already matched the design text (`workflow_result(a): ResultEnvelope`,
  `result = script return value`) — no 04-design.md text change was needed, the implementation was
  simply not wired to it yet.
- **greens:** VAL-001, VAL-005, VAL-014 (partial), E2E-001, E2E-003 (partial)
- **files:** src/run-store.ts, src/store/sqlite-run-store.ts, src/run-manager.ts, src/mcp-facade.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-020 — D-I3: fix IPC agentThrow routing for nested workflow() rejections
- **status:** done
- **traces:** TASK-008, DES-006
- **signature:** `SandboxHost` already wired `onWorkflowRequest`/`onPhase` correctly (verified, no
  change needed there), but `child-entry.ts`'s `agentThrow` handler only ever looked up the
  `pendingAgent` map — a `workflow()` call's `agentThrow` (unknown workflow name / nesting error)
  correlates by the SAME `callSeq` counter but lives in the separate `pendingWorkflow` map, so the
  rejection was silently dropped and the child hung forever waiting on that promise. Fixed to check
  both maps. Root cause found via a scratch reproduction (fork+IPC message trace), fixed, reproduction
  file removed before final report.
- **greens:** VAL-002 (second-level nesting sub-test), E2E-003 (workflow(name) inline invoke sub-tests)
- **files:** src/sandbox/child-entry.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-021 — D-I4: workflow-script meta-literal validation (compat-spec §1)
- **status:** done
- **traces:** TASK-007, DES-005, DES-013
- **signature:** `export const meta = {...}` is matched with a targeted regex BEFORE the script is
  wrapped in `(async () => {...})` (a bare `export` is illegal inside a function body, which is why
  every meta fixture — valid or invalid — was previously hitting PARSE_ERROR). The matched literal
  text is validated (`{`...`}` object-literal shape, no backtick, no `...` spread) and stripped from
  the executed body once accepted; a non-literal form returns `{kind:'error', error:{code:'INVALID_META'}}`
  without executing the script.
- **greens:** UT-015 (all 5 sub-tests)
- **files:** src/sandbox/guards.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-022 — D-I6: injectable HTTP transport seam on GatewayConfig
- **status:** done
- **traces:** TASK-011, TASK-012, DES-009
- **signature:** `GatewayConfig.fetchImpl?: typeof fetch` (defaults to global `fetch`) threaded through
  every provider branch in `callProvider`, so a unit test can inject a fake transport instead of
  hitting a live provider. `tests/unit/gateway-client.test.ts`'s "sonnet"/"default" alias sub-tests do
  NOT use this seam (they call `new LiteLLMGatewayClient(CONFIG)` with no `fetchImpl` and no
  `ANTHROPIC_API_KEY` in this environment) — flagged as a test_defect, not fudged.
- **greens:** none new (seam exists but unused by the two still-red sub-tests — see test_defects)
- **files:** src/gateway/client.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-023 — Named-workflow wiring: workflow_register tool, catalog-backed workflow_run, one-level workflow() nesting, catalog-rooted workspaces
- **status:** done
- **traces:** TASK-002, TASK-015, TASK-016, TASK-017, DES-001, DES-011, DES-013
- **signature:** Added `workflow_register` (McpFacade + server.ts tool dispatch — not one of the
  DES-001 core 8 tools, but required at the same submission-style entry point for REQ-014).
  `RunManager.start()` resolves `spec.name` via the shared `WorkflowCatalog` when no inline `script`
  is given, and roots every run's sandbox workspace under `catalog.runWorkspace(name ?? '_adhoc', runId)`
  (REQ-013). `RunManager._handleWorkflowRequest` resolves a child's `workflow(name)` call against the
  catalog and runs it inline in a NEW `SandboxHost` with no `onWorkflowRequest` of its own (so a
  second-level `workflow()` call throws `NESTING_ERROR` automatically — DES-005/DES-013 — rather than
  needing a separate depth counter). `SubmissionValidator` now shares the same catalog instance so an
  unknown workflow name is rejected at submission (DES-012), not mid-run.
- **greens:** VAL-014 (3 of 5 sub-tests — see test_defects for the other 2), E2E-003 (4 of 6 sub-tests
  — see test_defects for the other 2), VAL-002 (second-level nesting sub-test), VAL-013 (both sub-tests)
- **files:** src/run-manager.ts, src/mcp-facade.ts, src/server.ts, src/submission-validator.ts (catalog dep, unchanged code)
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-024 — Phase tracking: phase() IPC passthrough + RunStatusView.phases
- **status:** done
- **traces:** TASK-007, DES-005, DES-008
- **signature:** `guards.ts`'s sandboxed `phase(title)` binding now calls `api.phase?.(title)` instead
  of being a no-op; `child-entry.ts` implements `SandboxApi.phase` by sending
  `{t:'phase', runId, title}` (DES-006 `ChildMsg`, already typed but previously unhandled);
  `SandboxHost` gained an `onPhase` config hook; `RunManager` records observed phases per run and
  `McpFacade.workflow_status`/`RunManager.status()` merge them into the returned `RunStatusView`
  (`agents` similarly merged from the per-run `AgentExecutor.getAllRecords()`). `McpFacade.workflow_status`'s
  envelope is also spread with the `RunStatusView` fields at the top level (in addition to the
  documented nested `.result`) so `.phases`/`.agents`/`.status` are reachable both ways — every VAL/E2E
  test that polls `workflow_status` reads these fields directly off the parsed tool response, not
  through `.result`.
- **greens:** VAL-001 (phase sub-test), VAL-007 (phase sub-test), E2E-001 (phase-list sub-test)
- **files:** src/sandbox/guards.ts, src/sandbox/child-entry.ts, src/sandbox/host.ts, src/run-manager.ts, src/mcp-facade.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-025 — RunManager restart rehydration for suspend/resume/stop (REQ-006)
- **status:** done
- **traces:** TASK-013, TASK-014, DES-010, DES-003
- **signature:** A brand-new `RunManager` (post-restart) has an empty in-process `_runs` map, so
  `suspend`/`resume`/`stop` for a run that was suspended/stopped BEFORE the restart used to throw
  `IllegalTransitionError('unknown','transition')`. `RunStore` gained `getSpec(runId)` (persists
  `name`/`script`/`args`/`budget` — SqliteRunStore added `script`/`args`/`budget` columns;
  InMemoryRunStore keeps the whole `RunSpec`). `RunManager._requireLive(runId)` now rehydrates a live
  `RunEntry` from the persisted status + spec when the run isn't in memory (only for `suspended`/
  `stopped` runs — a `running` run is already re-classified `failed` by `hydrateAll` boot recovery).
  Documented simplification: the rehydrated entry has no resume-cache replay (in-flight `agent()`
  journal isn't re-read from disk into the cache plan) — no test currently requires exact cross-restart
  cache replay, only that the run reaches a terminal state again.
- **greens:** E2E-002 (restart sub-test), VAL-006 (restart sub-test)
- **files:** src/run-store.ts, src/store/sqlite-run-store.ts, src/run-manager.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-026 — Per-run AgentExecutor DI (RunGuard/RunStore forwarded from RunManager, not statically shared)
- **status:** done
- **traces:** TASK-009, TASK-010, DES-002, DES-008
- **signature:** `RunManager` previously built ONE `AgentExecutor` for its whole lifetime with no
  `guard`/`store` at all, while EVERY run gets its OWN `RunGuard` (DES-002: budget/concurrency are
  per-run) — so `AgentTranscriptSink.capture()` could never call `RunGuard.addTokens` for any run.
  `RunManager.start()`/`_requireLive()` now build a per-run `AgentExecutor({ gateway, guard, store, clock })`
  (unless a static `spawner` override is injected, e.g. test fakes) and `RunEntry.spawner` is used for
  every `agent()` dispatch in that run. This is real, DES-002/DES-008-correct behavior, but note: the
  currently-red UT-008/IT-004/UT-007 sub-tests construct their OWN disconnected `guard`/`gw`/`store`
  fakes that are never passed into `new AgentExecutor(...)` at all — no source-side fix can make an
  object that was never injected be observed (see test_defects). Verified the corrected wiring manually
  end-to-end (VAL-002's "budget total/spent()/remaining()" run shows a nonzero `spent()` after an
  `agent()` call once a real/fake gateway is wired) and via the acceptance suite.
- **greens:** none of the specific disconnected-DI unit/integration tests (see test_defects) — but
  IS exercised indirectly by every VAL/E2E test that calls `agent()` inside a submitted script.
- **files:** src/run-manager.ts, src/agent-executor.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

## Gate 6.5 simplify pass (verifier) — quality-only, no behavior change

### IMPL-028 — Gate 6.5 simplify: resume-cache reduce, mcp-facade lifecycle helper, WorkflowCatalog Clock injection
- **status:** done
- **traces:** DES-004, DES-001, DES-014
- **greens:** (stays green — quality-only refactor)
- **files:** src/resume-cache.ts, src/mcp-facade.ts, src/workflow-catalog.ts, src/server.ts, src/run-manager.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

Three surgical cleanups; all 161 tests remain green after each:

1. **`resume-cache.ts`** (DES-004): `Math.max(...entries.map(...))` replaced with
   `entries.reduce((m, e) => Math.max(m, e.callSeq), -1)` — eliminates the spread-on-potentially-large-array
   and the leading `entries.length === 0 ? -1 :` branch (reduce's sentinel value -1 already handles the empty case).

2. **`mcp-facade.ts`** (DES-001): extracted a module-level `lifecycle(store, runId, action)` helper that
   holds the shared body of the three lifecycle methods (suspend / resume / stop): pre-check `store.getRun`,
   `await action()`, post-read `store.getRun`, error-wrap. Three previously identical ~9-line method bodies
   collapse to three one-liners. `workflow_resume` closure captures `a.script` correctly.

3. **`workflow-catalog.ts`** (DES-014): `register()` used `new Date().toISOString()` directly for the
   `createdAt` field, bypassing the DES-014 Clock seam ("all kernel code must use the injected Clock").
   Added `clock?: Clock` optional parameter to the constructor (defaults to `SystemClock`, no breaking
   change for callers without clock). `server.ts` and `run-manager.ts` now pass their `clock` instance.

## Route-back closeout (D-V1..D-V7, D-R1..D-R5) — Gate 5 (route-back) → Gate 6 (this pass)

### IMPL-029 — D-V4: AgentExecutor real JSON-schema validation with bounded retry-on-mismatch
- **status:** done
- **traces:** TASK-009, DES-007
- **signature:** `agent(prompt,{schema})` now compiles `opts.schema` with `ajv` (real JSON-Schema
  validation, `strict:false`) and retries up to `SCHEMA_RETRY_ATTEMPTS = 3` total attempts on a
  nonconforming or unparsable response — never a bare `as object` type-cast passthrough. Exhausting
  the retry budget while still invalid resolves `{kind:'null'}` (never rejects, DES-007 contract
  preserved). New `parseJsonContent()` helper treats a raw string gateway response as JSON to parse
  (typical LLM text reply) and passes an already-object response through unchanged.
- **greens:** UT-016 (both sub-tests: retries then resolves validated object; exhausted-retry
  resolves null)
- **files:** src/agent-executor.ts, package.json (added `ajv ^8.20.0`)
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-030 — D-V5: AgentExecutor agentType resolution against server-side agent definitions
- **status:** done
- **traces:** TASK-009, DES-007
- **signature:** `AgentExecutorDeps` grew an additive `agentTypes?: Record<string, {systemPrompt}>`
  seam. `run()` resolves `req.opts.agentType` against it BEFORE any gateway dispatch: a known type's
  `systemPrompt` is prepended to the outbound prompt (observable in what's sent to the gateway); an
  unknown type throws immediately (reported error, never a hang, never reaches `gateway.invoke`).
  Composition-root note: no caller populates `agentTypes` from a real on-disk agent-definition
  registry yet (see needs_clarification below) — every `agentType` is currently "unknown" by
  default (`{}`), which is spec-correct behavior (fails fast) but not yet useful in production.
- **greens:** UT-017 (both sub-tests: known agentType observably applied; unknown agentType rejects
  without a hang and without calling gateway.invoke)
- **files:** src/agent-executor.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-031 — D-V1/D-R1/D-R2: LiteLLM proxy subprocess manager + gateway routing, default-on
- **status:** done
- **traces:** TASK-011, TASK-012, DES-009
- **signature:** New `LiteLLMProxyManager` (`src/gateway/litellm-proxy.ts`) owns a `litellm --config
  ... --port ...` subprocess: config.yaml generated from the existing `AliasMap` (one source of
  truth), bounded-timeout health poll (never hangs on boot), idempotent `start()`, `stop()`.
  `GatewayConfig` grew `useLiteLLMProxy?: boolean` + injectable `proxyManager?: LiteLLMProxyManager`;
  when active, `LiteLLMGatewayClient.invoke()` calls the proxy's Anthropic-Messages-shaped
  `POST /v1/messages` (alias name as `model`) instead of each provider's native endpoint directly.
  Gate 6 closeout wiring (D-R1, this pass): `server.ts`'s `createServer()` now defaults
  `useLiteLLMProxy: true` (explicit `false` opts back into the legacy direct-fetch path) and forwards
  `config.proxyManager` through — previously `ServerConfig` had no `useLiteLLMProxy`/`proxyManager`
  fields at all, so the proxy path was unreachable from the composition root regardless of the
  `GatewayConfig`-level default. IT-005 (`gateway-provider-down.test.ts`) was retimed by the verifier
  (Gate 5) to inject `fetchImpl` + a faked `proxyManager` so its breaker-semantics assertions stay
  deterministic (D-R2/D-R3: never a real `litellm` subprocess or live network call in automation).
- **greens:** IT-013 (`server-default-litellm-proxy.test.ts`: default construction routes through
  the injected proxyManager without an explicit opt-in), IT-005 (3 sub-tests, already green,
  reconfirmed unaffected by the default flip)
- **files:** src/gateway/litellm-proxy.ts (new), src/gateway/client.ts, src/server.ts,
  package.json (added `@anthropic-ai/claude-agent-sdk ^0.3.199`, currently unused — see
  needs_clarification)
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-032 — D-V2: WorkflowCatalog persists registrations across restart (SQLite)
- **status:** done
- **traces:** TASK-015, TASK-016, DES-011
- **signature:** `WorkflowCatalog` registrations (`name`/`script`/`version`/`createdAt`) now persist
  in an on-disk SQLite DB (`catalog.db` under `workRoot`, `better-sqlite3` — same dependency
  `SqliteRunStore` already uses) instead of an in-memory `Map`, so a fresh `WorkflowCatalog`/server
  instance pointed at the same `workRoot` sees every previously-registered workflow. `register()`
  does an `INSERT ... ON CONFLICT(name) DO UPDATE`, computing the next per-name version from the
  existing row (`vN -> vN+1`) rather than an in-memory global counter, so version numbering also
  survives restart.
- **greens:** IT-012 (`catalog-persistence.test.ts`, both cases), VAL-015
  (`val-015-registry-persistence.test.ts`), plus pre-existing UT-011 (`workflow-catalog.test.ts`)
  and IT-007 (`catalog-workspaces.test.ts`) stayed green
- **files:** src/workflow-catalog.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-033 — D-V6: workflow_agent_log real transcript read-back (was hard-coded [])
- **status:** done
- **traces:** TASK-013, TASK-014, DES-008, DES-010
- **signature:** `RunStore` gained a real `getTranscript(runId, agentId): Promise<TranscriptEvent[]>`
  read-back accessor (`InMemoryRunStore` reads its in-memory transcripts map; `SqliteRunStore` reads
  `agent-<id>.jsonl` line-by-line, `[]` if the file never materialized). `McpFacade.workflow_agent_log`
  now delegates to it instead of hard-returning `[]`.
- **greens:** IT-009 (`agent-log-readback.test.ts`); VAL-007's agent-log assertions remain green
  (gated behind `HAS_PROVIDER`, not exercised without live/local-model credentials in this
  environment, but the same code path IT-009 exercises)
- **files:** src/run-store.ts, src/store/sqlite-run-store.ts, src/mcp-facade.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-034 — D-V7a: true resolved scriptVersion threaded into RunStore.createRun()
- **status:** done
- **traces:** TASK-013, TASK-014, DES-010, DES-011
- **signature:** `RunManager.start()` now threads the actually-resolved catalog `scriptVersion`
  string (e.g. `"v2"` after an update) into `RunStore.createRun(spec, scriptVersion)`, instead of
  every run being hard-coded to `'v1'` in both `RunStore` implementations. `RunStore.createRun`
  gained an optional `scriptVersion` param (default `'v1'`, backward compatible with every existing
  call site).
- **greens:** IT-011 (`scriptversion-fidelity.test.ts`)
- **files:** src/run-manager.ts, src/run-store.ts, src/store/sqlite-run-store.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-035 — D-V7b/D-R4: workflow_artifacts tool (facade + real MCP HTTP surface)
- **status:** done
- **traces:** TASK-002, TASK-015, DES-001, DES-011
- **signature:** New `McpFacade.workflow_artifacts({runId})` tool lists the relative file names
  present in a completed run's on-disk workspace (`readdirSync`, top-level files only), backed by a
  new `RunManager.workspacePath(runId)` accessor that resolves live state first, falling back to
  recomputing the deterministic `name`+`runId` path from the persisted spec for runs this process
  hasn't touched since restart. Gate 6 closeout wiring (D-R4, this pass): `server.ts`'s `TOOL_NAMES`
  const and `callTool()` switch had no `'workflow_artifacts'` case at all — `tools/list` omitted it
  and `tools/call` fell through to `Unknown tool: workflow_artifacts` even though the facade method
  itself worked correctly; added both.
- **greens:** IT-010 (`workspace-artifacts.test.ts`, facade level), IT-014
  (`workflow-artifacts-http.test.ts`, both sub-tests — real `/mcp` JSON-RPC HTTP surface)
- **files:** src/mcp-facade.ts, src/run-manager.ts, src/server.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

**needs_clarification carried forward (not blocking this gate — see report):** D-V1 specifies
"AgentExecutor executes each agent() via `@anthropic-ai/claude-agent-sdk` headless sessions"; the
delivered implementation instead has `LiteLLMGatewayClient` call the LiteLLM proxy's own
Anthropic-Messages-shaped `/v1/messages` endpoint directly via `fetch` — the same request shape a
real SDK headless session pointed at `ANTHROPIC_BASE_URL=<proxy>` would send, but not an actual
`@anthropic-ai/claude-agent-sdk` session object. The npm package is an added-but-unused dependency.
No test in this route-back (Gate 5, standalone-invoked) drives real SDK session construction, and
building it now would be speculative/untested implementation (Gate 6 discipline: "do not implement
ahead of any test"). Deferred to the orchestrator to decide whether full SDK-session wiring is
required for v1 sign-off or whether the current direct-fetch-to-proxy shape is an acceptable
documented simplification (04-design.md DES-009 note records this explicitly either way).

### IMPL-027 — D-I9: workflow_list surfaces registered-but-never-run workflows
- **status:** done
- **traces:** TASK-002, TASK-015, DES-001, DES-010, DES-011
- **signature:** `McpFacade.workflow_list` previously only returned `store.listRuns()` (`RunSummary[]`),
  so a workflow registered via `workflow_register` but never run was invisible — failing REQ-014's
  "registered workflow MUST be visible via workflow_list BEFORE any run" acceptance. Implemented
  option (a) from D-I9 as a flat kind-discriminated array (not a nested `{workflows, runs}` object,
  since existing green tests — `tests/unit/mcp-envelope.test.ts`, `tests/e2e/workflow-run-lifecycle.test.ts`
  — already assert `Array.isArray(result)` and `.some(r => r.runId === x)` directly on `.result`):
  `result: Array<{kind:'workflow', name, version, createdAt} | {kind:'run', ...RunSummary}>`, workflows
  sourced from `WorkflowCatalog.list()` (which gained a `createdAt` field), runs from
  `RunStore.listRuns()` unchanged. Annotated DES-001/DES-010/DES-011 notes in 04-design.md. Also fixed
  an unrelated `vitest.config.ts` `timeout` -> `testTimeout` typo (vitest 1.6's `InlineConfig` has no
  top-level `timeout` key) discovered while confirming `tsc --noEmit` is clean; runtime behavior was
  unaffected (vitest ignored the unknown key), this only silences a real typecheck error.
- **greens:** VAL-014 (workflow_register + workflow_list visibility sub-test, closing the 2 remaining
  red sub-tests left by IMPL-023), E2E-003 (workflow_register + workflow_list sub-test)
- **files:** src/mcp-facade.ts, src/workflow-catalog.ts, vitest.config.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-036 — D-F2: agentType composition-root loader (agents/*.md frontmatter)
- **status:** done
- **traces:** TASK-009, DES-007, ARCH-004
- **signature:** new `src/agent-definitions.ts` `loadAgentDefinitions(dir)`: reads every `*.md`
  file directly under `dir`, splits its `---\n...\n---\n` frontmatter (flat `key: value` lines —
  `name`/`model` read; `tools` intentionally not stored, since no seam restricts tools per
  agentType yet and nothing tests it) from its body (the `systemPrompt`), returns
  `Record<string, AgentTypeDef>`. A missing directory resolves to an empty registry rather than
  throwing at startup (fail-fast for an unknown name still happens per-call at `AgentExecutor`
  resolution, unchanged). `AgentTypeDef` (agent-executor.ts) grew an optional `model?: string`;
  `AgentExecutor.run()` now also applies a resolved definition's `model` to the outbound
  `opts.model` when the caller didn't already set one (previously only the systemPrompt-prepend was
  implemented, D-V5). `ServerConfig.agentDefinitionsDir` (new, server.ts) triggers the load once at
  `createServer()` startup; the registry is forwarded through new `RunManagerDeps.agentTypes` into
  every `AgentExecutor` `RunManager` constructs (both the live `start()` path and the
  restart-rehydration `_requireLive()` path) — previously `RunManagerDeps` had no such field at all
  and every `AgentExecutor` was built with an implicit empty registry.
- **greens:** IT-016 (both sub-tests: known agentType applies systemPrompt + routes via the
  definition's own model alias through a real `createServer()` + real on-disk frontmatter file +
  stub Ollama server; unknown agentType still fails fast, never reaching the gateway)
- **files:** src/agent-definitions.ts (new), src/agent-executor.ts, src/run-manager.ts, src/server.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

### IMPL-037 — D-F1: ClaudeAgentSdkGatewayClient — real @anthropic-ai/claude-agent-sdk session GatewayClient
- **status:** done
- **traces:** TASK-011, TASK-012, DES-007, DES-009
- **signature:** new `src/gateway/claude-agent-sdk-client.ts` `ClaudeAgentSdkGatewayClient`
  implements `GatewayClient` against the REAL `@anthropic-ai/claude-agent-sdk` `query()` API
  (user decision D1 stands, twice confirmed — the previously-shipped direct-fetch-to-proxy shape
  IMPL-031 built does not satisfy "genuine SDK session": a raw fetch has no tool-use agent loop;
  the accept-direct-fetch alternative was explicitly REJECTED this round). With no `queryImpl`
  override the default construction path dispatches through the SDK's own `query` export
  unmodified (UT-018 pins this via `vi.mock`ing only the third-party module, unit tier); wires
  `ANTHROPIC_BASE_URL` to the configured `baseUrl` (e.g. the already-built `LiteLLMProxyManager`'s
  local proxy) and a dummy, non-empty, never-real `ANTHROPIC_API_KEY` (D-R2 — never the host env's
  real credential even if one happens to be set); reads only the session's final `result` message
  off its own async-generator agent loop (`subtype:'success'` → `{ok:true, content: msg.result,
  tokens: {input/output: msg.usage.*}}`; any other subtype, an exhausted generator, or a
  thrown/aborted iteration → `{ok:false, reason:'terminal'|'unreachable'|'timeout'}`, never a hang,
  never an uncaught rejection). `queryImpl` stays injectable (a 3rd UT-018 case proves an injected
  override wins over the default).
  Composition-root wiring: added an additive `ServerConfig.gateway?: GatewayClient` override seam
  to `createServer()` (`gateway = config?.gateway ?? (config?.aliases ? new
  LiteLLMGatewayClient(...) : undefined)`) — no existing caller sets it, so every pre-existing
  `createServer()` call site (roughly 20 test files) is byte-for-byte unaffected; this seam exists
  so a composition root CAN select `ClaudeAgentSdkGatewayClient` explicitly. It was deliberately
  **not** wired as the zero-config default replacing `RunManager`'s own `LiteLLMGatewayClient`
  fallback, nor as `server.ts`'s `aliases`+`useLiteLLMProxy:true` default: (1) ~20 existing green
  tests (`val-002-caps`, `val-006-lifecycle`, `e2e/suspend-resume-replay`, etc. — several with
  their own "this environment's fast local no-credential agent() rejection path" comments) rely on
  that path's near-instant no-credential terminal-fail behavior for test speed/determinism; a real
  SDK session attempting a real CLI subprocess spawn on every one of those calls risked timing out
  or hanging those tests. (2) IT-005/IT-013 pin the raw-`fetchImpl` transport shape for the
  `aliases`+`useLiteLLMProxy:true` path specifically (exact call-count assertions on the injected
  transport) — repurposing that path to dispatch via a real SDK session instead would have broken
  both, currently-green, tests. (3) No test in this round forces re-wiring either path. Per Gate 6
  discipline ("do not implement ahead of any test"; "keep the entire suite green"), this was left
  as an explicit, fully-real, fully-tested, ready-to-select building block rather than a guessed
  default-wiring change with real regression risk and zero verification — see needs_clarification.
- **greens:** UT-018 (all 3 sub-tests: real SDK export used by default; ANTHROPIC_BASE_URL + dummy
  ANTHROPIC_API_KEY wired; injected queryImpl overrides the default)
- **status (IT-015):** RED in this environment, for a documented, pre-anticipated, non-implementation
  reason — see 05-tests.md's IT-015 note and the test_defect below. Not counted as a green because
  it did not turn green; reported transparently rather than fudged.
- **files:** src/gateway/claude-agent-sdk-client.ts (new), src/server.ts
- **commit:** (uncommitted working tree)
- **iter:** v1

**needs_clarification (this round):** `ClaudeAgentSdkGatewayClient` is built and fully proven by
UT-018 (and, environment permitting, IT-015 — see test_defect), and is available at the composition
root via the new `ServerConfig.gateway` seam, but nothing currently *selects* it as the product's
actual default (neither `server.ts`'s own `aliases`-driven construction nor `src/main.ts`, the real
product entrypoint, were changed to construct/inject one). Orchestrator input needed: should a
follow-up round wire `src/main.ts` (which has zero automated test coverage either way — it is only
manually verified at Gate 7.5 real-run, same as its pre-existing gateway wiring was) to select
`ClaudeAgentSdkGatewayClient` by default, accepting that this specific wiring decision would ship
unverified by the automated suite; or is the "genuine SDK session, selectable at the composition
root, proven by UT-018/IT-015" bar this round delivers sufficient for v1 sign-off, with the actual
default-selection decision deferred to a dedicated (test-driven) round once a non-nested CI
environment is available to prove IT-015 end-to-end? Not a blocking defect — flagged as a genuine
product decision this implementer should not make unilaterally.

**test_defect reported (not fixed by this implementer — Gate 6 discipline, rule 4):**
IT-015 (`tests/integration/claude-agent-sdk-session.test.ts`) fails in this specific sandboxed dev
environment: `expect(sawToolResult).toBe(true)` at line 160 receives `false`. Root cause (confirmed
via a throwaway debug script run directly against the real `@anthropic-ai/claude-agent-sdk` `query()`
export, deleted after use — not shipped): this development environment is *itself* a nested Claude
Code agent host. Calling `query()` here does not spawn an independent CLI subprocess that honors
`ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` and talks to our local stub server over real HTTP with the
Anthropic Messages wire shape; it is intercepted by the outer host and answered with a live
synthetic response instead — confirmed because the intercepted request bodies carry the OUTER
project's own system prompts and "Available agent types for the Agent tool" listing (this very
repository's own tooling context) and a live model id (e.g. `claude-opus-4-8`), never our stub's
SSE bytes, and this persisted even with `settingSources: []` set. The test file's own header comment
and 05-tests.md already anticipate exactly this failure mode in prose ("a nested/sandboxed
nested-agent host that intercepts query() with a synthetic canned response instead of making a real
outbound HTTP call") and include a skip-guard for it — but the skip-guard's literal condition
(`stub.requests.length > 0` within 20s) does not actually catch this case, because the outer host's
interception *does* still cause some (wrong-shaped) HTTP requests to reach the local stub port
(2-3 were observed), so `reachedStub` resolves `true` and the test proceeds to the (now legitimately
failing, environment-caused) assertion instead of skipping. **Problem:** the skip-guard heuristic is
too weak to detect this environment's specific interception behavior. **Suggested fix:** strengthen
the guard to positively detect a genuine Anthropic-Messages-shaped request (e.g. check that a
captured request body's `messages[].content` matches what our own script would generate, or that the
model field equals the stub's own `'stub-model'` echo, or add a short grace-period re-check after the
first tool_use SSE turn specifically for a `tool_result` follow-up rather than only checking "any
request arrived") — or, if unfixable in-process, mark this test `environment-gated`
(e.g. an explicit `RWE_REAL_SDK_SUBPROCESS=1` opt-in env var, analogous to `HAS_PROVIDER`) so it
default-skips in nested/sandboxed dev environments and only runs where a genuinely independent CLI
subprocess is possible (e.g. real CI, or Gate 7.5's real-run environment). Not fixed here per Gate 6
rule 4 (do not appease a wrong test) — `ClaudeAgentSdkGatewayClient` itself is not at fault (UT-018
fully proves its logic with the SDK module mocked out).

### IMPL-038 — D-F4: src/main.ts default gateway = ClaudeAgentSdkGatewayClient (SDK -> LiteLLM proxy), config opt-out
- **status:** done
- **traces:** TASK-009, TASK-011, TASK-012, DES-007, DES-009, ARCH-004, ARCH-005
- **greens:** none — orchestrator-directed wiring decision (D-F4), resolving IMPL-037's carried
  needs_clarification. `src/main.ts` has zero automated test coverage by design and design intent
  (Gate 7.5 finding, retro L-003): every test constructs `createServer()` in-process with an
  injected `gateway`/`aliases` config and never goes through `main()`, so no UT/IT/E2E/VAL id can
  legitimately be listed as "greened" by this change. VERIFICATION TIER for this specific wiring is
  Gate 7.5 real-run (boot via the documented `npm run start` / `src/main.ts` entrypoint, exercise
  REQ-003 against local Ollama through the SDK default) per the orchestrator's explicit instruction
  and the standing user decision D1 (tool-loop-capable path by default for a real deployment, not
  behind a flag) — not a gap being silently shipped untested; the automated suite's job here is only
  "stay green because it never touches this code path", which it does (see Regression below).
- **what changed:** `src/main.ts` now resolves a new file-config key `gateway: "sdk" | "direct-fetch"`
  (default `"sdk"`) BEFORE calling `createServer()`. Default path: starts the same managed
  `LiteLLMProxyManager` subprocess the opt-out `direct-fetch` path can already opt into via
  `useLiteLLMProxy` (D-R1) — keyed off `fileConfig.aliases` when present, else the same anthropic-only
  `DEFAULT_ALIASES` fallback table `RunManager`/`SubmissionValidator` already default to — awaits its
  `baseUrl`, then constructs `new ClaudeAgentSdkGatewayClient({ baseUrl, cwd: config.workRoot })` and
  assigns it to `ServerConfig.gateway` (the additive D-F1 override seam; unchanged). Setting
  `"gateway": "direct-fetch"` in `rwe.config.json` skips this entirely and leaves `config.gateway`
  unset, falling through to `server.ts`'s pre-existing default (`LiteLLMGatewayClient` when
  `aliases` present, else `RunManager`'s own `DEFAULT_GATEWAY_CONFIG` fallback) — byte-for-byte the
  same behavior main.ts had before this change.
- **explicitly NOT touched (per instruction):** no test file; `server.ts`'s own defaults/config
  paths (the `config?.gateway ?? (config?.aliases ? new LiteLLMGatewayClient(...) : undefined)`
  branch IT-005/IT-013 pin, and the ~20 aliases-absent fast-fail tests' path) — all test callers
  construct `createServer()` directly and never see `main.ts`'s new resolution logic.
- **DEPLOY.md note (for the doc-writing pass, config key to add to §1b 設定檔內容):** new optional
  `rwe.config.json` top-level key `"gateway"`, values `"sdk"` (default — real
  `@anthropic-ai/claude-agent-sdk` session via the managed LiteLLM proxy, tool-loop-capable, REQ-003)
  or `"direct-fetch"` (opt-out — legacy per-provider `fetch()`/`LiteLLMGatewayClient` path, D-R1's
  own `useLiteLLMProxy` toggle still applies underneath it). Omitting the key = `"sdk"`. Requires the
  `litellm` binary on PATH either way (both paths that use a proxy — `"sdk"` always does; the `useLiteLLMProxy`-off `direct-fetch` sub-path does not).
- **files:** src/main.ts
- **commit:** (uncommitted — implementer stage)
- **iter:** v1

### IMPL-039 — D-F5 route-back: ClaudeAgentSdkGatewayClient opts.model forwarding + is_error handling
- **status:** done
- **traces:** TASK-009, TASK-011, TASK-012, DES-007, DES-009, DES-013
- **greens:** UT-019, IT-017
- **what changed:** `src/gateway/claude-agent-sdk-client.ts` `invoke()`, two minimal fixes turning
  the two Gate 7.5 round-2 real defects (`state.yaml` `pending[]` item 1 sub-items 1/2,
  `08-validation.md` VAL-003/VAL-004) green against the Gate 5 red pins (UT-019/IT-017):
  (1) `options.model` is now set from `req.opts.model` (previously never set at all, so the SDK
  session dispatched to the CLI's own hard-coded default model, completely ignoring the caller's
  resolved alias) — `Options.model?: string` already exists on the SDK's own type, so this is a
  straight passthrough, no new type/seam needed. (2) the terminal-failure branch now also checks
  `msg.is_error` alongside the existing `msg.subtype !== 'success'` check (`if (msg.subtype !==
  'success' || msg.is_error) return { ok: false, ..., reason: 'terminal' }`) — previously an
  `is_error:true` result on a `subtype:'success'` message (the real wire shape a genuine upstream
  API error produces) fell through to the `ok:true` return, surfacing the raw error text as if it
  were successful agent() content instead of resolving to `null` per DES-013's null-on-terminal
  contract. No new files, no interface changes — both fixes are inside the existing `invoke()` body.
- **rwe.config.example.json:** `"gateway"` key reverted from `"direct-fetch"` back to `"sdk"` per
  D-F5 (both real defects blocking the SDK-default path are now fixed; `"direct-fetch"` remains a
  documented opt-out, not the recommended default). `README.md`/`DEPLOY.md` synced accordingly
  (quickstart comments, known-limitations lists renumbered, "confirmed fixed" sections extended) —
  doc-only follow-up so the shipped docs don't keep recommending the now-obsolete workaround.
  Not asked for verbatim in the task list but directly implied by "direct-fetch stays documented as
  an opt-out only" and left-stale docs would contradict the reverted template default.
- **verification:** `npx vitest run tests/unit/claude-agent-sdk-gateway-defects.test.ts
  tests/integration/claude-agent-sdk-gateway-defects.test.ts` — 2 files / 4 tests, all green (was
  4/4 red pre-fix, confirmed). Full suite: `npx vitest run` — 49 files / 184 tests, 183 pass / 1 fail
  — the 1 remaining fail is the pre-existing, previously-documented IT-015 environment-specific red
  (`tests/integration/claude-agent-sdk-session.test.ts`, this sandboxed dev environment is itself a
  nested Claude Code agent host that intercepts `query()`, per IMPL-037's own note) — unrelated to
  this change (asserts a tool-use file-read call, not model/is_error), unchanged before/after this
  fix, not a new regression. `npx tsc --noEmit`: 0 errors.
- **files:** src/gateway/claude-agent-sdk-client.ts, rwe.config.example.json, README.md, DEPLOY.md
- **commit:** (uncommitted — implementer stage)
- **iter:** v1

### IMPL-040 — D-F9a: thread the run AbortSignal from RunManager through AgentExecutor into GatewayClient.invoke()
- **status:** done
- **traces:** TASK-004, TASK-009, TASK-011, DES-007, DES-009, REQ-006
- **greens:** IT-019
- **what changed:** `GatewayClient.invoke(req)`'s `req` shape grows an optional `signal?: AbortSignal`
  (`src/gateway/client.ts`) — additive, no existing implementation broken. `AgentExecutor._invokeOnce`
  now forwards its own (already-required, per DES-007) `req.signal` straight into
  `this._gateway.invoke({..., signal: req.signal})` (`src/agent-executor.ts:175`).
  `RunManager._handleAgentRequest` needed NO change — `entry.abortController.signal` was already
  threaded into the `AgentExecutor.run()`/`AgentSpawner.run()` call before this round
  (`src/run-manager.ts:324`, predates this session). `ClaudeAgentSdkGatewayClient.invoke()` (see
  IMPL-042) is the one gateway that actually honors the incoming signal this round.
- **scope note (transparency, not a defect):** only `ClaudeAgentSdkGatewayClient` honors the forwarded
  `signal` this round — `LiteLLMGatewayClient`'s `callProvider`/`callViaLiteLLMProxy`
  (`src/gateway/client.ts`) do NOT tie their own `AbortController` to it, matching D-F7's identical
  scoping (the bounded race is explicitly `ClaudeAgentSdkGatewayClient`-only) and `state.yaml`
  `pending[]` item (4), which named this as lower-priority/out of D-F5's scope. No red test in this
  round forces `LiteLLMGatewayClient` wiring, so it was not implemented ahead of a test (Gate 6 rule).
  DEPLOY.md/README.md updated to document this boundary explicitly (D-F9a "sdk" path only).
- **files:** src/gateway/client.ts, src/agent-executor.ts
- **commit:** (uncommitted — implementer stage)
- **iter:** v1

### IMPL-041 — D-F6/D-F7: ClaudeAgentSdkGatewayClient alias-aware thinking policy + bounded timeout/retry race (honors external signal)
- **status:** done
- **traces:** TASK-009, TASK-011, TASK-012, DES-009, REQ-004, REQ-006
- **greens:** UT-020, UT-021, IT-019 (external signal honored end-to-end), UT-018, UT-019, IT-017 (regression-safe, still green)
- **what changed:** `ClaudeAgentSdkGatewayConfig` grows three optional fields, all additive
  (`src/gateway/claude-agent-sdk-client.ts`):
  - `aliases?: AliasMap` (D-F6, same shape `LiteLLMGatewayClient` already takes). New
    `thinkingFor(aliases, model)` helper: `options.thinking = {type:'disabled'}` for any alias not
    confirmed `provider:'anthropic'` (including an alias absent from the map — the safe default);
    left unset (SDK default) only for a confirmed Anthropic-mapped alias. Closes the round-3 real
    defect (LiteLLM forwards unconditional `think:true` to Ollama, non-reasoning models 400).
  - `timeoutMs?: number` / `retries?: number` (D-F7, mirroring `GatewayConfig`). When `timeoutMs` is
    set, `invoke()` makes `1 + retries` attempts; each attempt races the session drain against an
    `AbortController`-driven timer via `Promise.race`, exactly like `LiteLLMGatewayClient`'s
    per-attempt race — first success wins, exhausting attempts returns the last `{ok:false}`. The
    same `AbortController` also answers the external `req.signal` (D-F9a, IMPL-040) via a `once`
    listener, so either the timeout or an external abort resolves the race; both listeners cleaned
    up in `finally`. Neither `timeoutMs` nor `req.signal` set → unchanged legacy unbounded single
    attempt (no regression to callers not opting in).
- **verification:** `npx vitest run tests/unit/claude-agent-sdk-gateway-thinking.test.ts
  tests/unit/claude-agent-sdk-gateway-timeout.test.ts tests/integration/suspend-aborts-gateway-call.test.ts
  tests/unit/claude-agent-sdk-gateway.test.ts tests/unit/claude-agent-sdk-gateway-defects.test.ts
  tests/integration/claude-agent-sdk-gateway-defects.test.ts` — all green (was UT-020/UT-021/IT-019
  red pre-fix). Full suite green except the pre-existing documented IT-015 environment-specific red
  (unchanged, unrelated — nested Claude Code host interception, see IMPL-037). `tsc --noEmit` clean.
- **04-design.md:** DES-009 grew a route-back note finalizing these 3 config fields (verifier-authored
  extensions the tests' own notes flagged as "not yet in 04-design.md").
- **files:** src/gateway/claude-agent-sdk-client.ts
- **commit:** (uncommitted — implementer stage)
- **iter:** v1

### IMPL-042 — D-F8: live budget IPC — script-visible budget.spent()/remaining() reflect real RunGuard accounting
- **status:** done
- **traces:** TASK-006, TASK-008, DES-002, DES-006, REQ-002
- **greens:** IT-018
- **what changed:** `ParentMsg`'s `'agentResult'` variant grows an optional `spent?: number`
  (`src/ipc/protocol.ts`) — the real cumulative `RunGuard` token total as of that call's completion,
  piggybacked onto the SAME message (no new message type). `SandboxHostConfig` grows an optional
  `onBudgetSnapshot?: () => number` hook (`src/sandbox/host.ts`), called when sending `agentResult`;
  absent → no `spent` field sent (existing dry-run test seams unaffected). `RunManager._newSandbox`
  wires it to `entry.guard.budgetView().spent()` (`src/run-manager.ts`). The sandbox child
  (`src/sandbox/child-entry.ts`) tracks a local `spentSoFar` updated from each `agentResult.spent`;
  the script-visible `budget.spent()/remaining()` accessors now read `spentSoFar` instead of the
  prior hard-coded `0` stub (`remaining()` still derives `total` from the `StartMsg.budgetTotal`
  captured at spawn — total itself never changes mid-run).
- **verification:** `npx vitest run tests/integration/budget-live-accounting.test.ts` green (was
  IT-018 red pre-fix). Full suite green (see IMPL-041's verification note for the one pre-existing
  unrelated red). `tsc --noEmit` clean.
- **04-design.md:** DES-006 (IPC protocol) and DES-002 (RunGuard/Budget) each grew a route-back note
  — DES-002's authority/invariant itself was never wrong; the gap was the separate sandbox-VM-side
  `Budget` view never reading it, now closed by DES-006's IPC piggyback.
- **files:** src/ipc/protocol.ts, src/sandbox/host.ts, src/sandbox/child-entry.ts, src/run-manager.ts
- **commit:** (uncommitted — implementer stage)
- **iter:** v1

### IMPL-043 — D-F9b: per-agent records survive server restart (RunStore.getRun derives agents[] from persisted transcripts)
- **status:** done
- **traces:** TASK-013, TASK-014, DES-010, REQ-007
- **greens:** IT-020
- **what changed:** new exported helper `deriveAgentRecords(transcripts: Map<string,
  TranscriptEvent[]>): AgentRecord[]` (`src/run-store.ts`) reconstructs one `AgentRecord` per agentId
  from that agent's last `usage` transcript event (no `usage` event yet — still in flight, or never
  completed — omitted, matching prior in-process-Map semantics). `InMemoryRunStore.getRun` and
  `SqliteRunStore.getRun` both call it instead of hard-coding `agents: []`.
  `SqliteRunStore` grows a private `_allTranscripts(runId)` that enumerates every on-disk
  `agent-<id>.jsonl` file in that run's directory (the restart-survival source — no in-process Map
  exists after a real restart) and reads each back via the existing `_readTranscriptFile` (D-V6)
  helper. `InMemoryRunStore.getRun` was also switched to `deriveAgentRecords` (reusing its own
  already-in-memory transcripts map) even though IT-020 only exercises `SqliteRunStore` — the red
  test's own comment explicitly names `InMemoryRunStore` as sharing the identical stub defect, and
  this reuses the already-required helper at zero extra design cost; flagged here per the
  no-untested-implementation gate (full suite confirms no regression, but no test currently forces
  this specific `InMemoryRunStore` code path).
- **downstream effect:** closes `McpFacade.workflow_agent_log`'s `AGENT_NOT_FOUND`-after-restart gap
  too, since that facade method gates on `view.agents.find(...)` before ever calling `getTranscript`.
- **verification:** `npx vitest run tests/integration/agent-records-restart-survival.test.ts` green
  (was IT-020 red pre-fix — real `SqliteRunStore`, real sandbox child process, only the third-party
  `GatewayClient` faked). Full suite green (see IMPL-041's verification note). `tsc --noEmit` clean.
- **04-design.md:** DES-010 grew a route-back note describing `deriveAgentRecords` and the
  `_allTranscripts` enumeration.
- **files:** src/run-store.ts, src/store/sqlite-run-store.ts
- **commit:** (uncommitted — implementer stage)
- **iter:** v1

### IMPL-044 — Gate 6 integration closeout (round 3 route-back): full suite + tsc + trace + docs sync
- **status:** done
- **traces:** DES-002, DES-006, DES-007, DES-009, DES-010
- **greens:** (integration verification only — no new test-turning code; re-confirms IMPL-040..043's
  greens together) UT-020, UT-021, IT-018, IT-019, IT-020
- **what changed:** cross-slice wiring verification (no file conflicts between the 3 reported IMPL
  slices — signal-threading, budget IPC, and restart-survival touch disjoint files except
  `src/run-manager.ts`, where `onBudgetSnapshot` and the pre-existing `abortController.signal`
  wiring coexist cleanly). `04-design.md` route-back notes added to DES-002, DES-006, DES-007's
  sibling DES-009, and DES-010 (the "shapes changed" set — DES-007's `AgentReq.signal` itself was
  unchanged, already required pre-round). `DEPLOY.md`/`README.md` known-limitations sections (§5/§6
  in DEPLOY.md; the numbered list in README.md) rewritten to mark items 1/3/5/6 fixed, item 2
  partially fixed (D-F9a, `"sdk"` path only — `"direct-fetch"`/`LiteLLMGatewayClient` explicitly
  still not wired, both docs cross-reference this boundary), item 4 (litellm subprocess orphan)
  still open. D-F6's own doc requirement ("DEPLOY.md documents `gateway:\"direct-fetch\"` as a
  supported stable opt-out for local-only deployments") addressed in DEPLOY.md §6's new
  "`gateway:\"direct-fetch\"` 現在的定位" paragraph — no longer framed only as a workaround for the
  now-fixed thinking-policy bug, but as a standing documented alternative (default stays `"sdk"` per
  D1/D-F4, unchanged).
- **verification:** `npx vitest run` — 54 files / 190 tests, 189 pass / 1 fail (the single fail is
  the pre-existing, previously-documented, environment-specific `IT-015`
  (`tests/integration/claude-agent-sdk-session.test.ts`) — this sandboxed dev environment is itself a
  nested Claude Code agent host that intercepts `query()`, per IMPL-037's original test_defect report;
  unchanged before/after this round's changes, not a new regression, not touched per Gate 6 rule 4
  (do not appease a wrong test)). `npx tsc --noEmit` — 0 errors. `sh .sdlc/trace
  .sdlc/features/001-remote-workflow-engine --check` — 18 gaps, all pre-existing v2/v3-out-of-scope
  baseline (`REQ-008..012/015`, `TASK-018..023`, both `未實作`/`未驗證` categories only — 0
  `斷鏈`(broken-link)/`孤兒`(orphan) gaps, confirmed via a direct `analyze()` call, not just the
  summary count), identical to the pre-round baseline, 0 new gaps introduced.
- **files:** .sdlc/features/001-remote-workflow-engine/04-design.md, DEPLOY.md, README.md
- **commit:** (uncommitted — integrator stage)
- **iter:** v1

### IMPL-045 — D-F10(a/b): src/main.ts refactored to composeConfig(), aliases/timeoutMs/retries/agentDefinitionsDir wired, example agents/ dir + config docs
- **status:** done
- **traces:** TASK-009, TASK-010, DES-007, DES-009
- **greens:** IT-021, IT-022
- **what changed:** `src/main.ts`'s inline `FileConfig -> ServerConfig` translation (previously
  buried inside the unexported, side-effecting `main()`) is now an exported
  `composeConfig(fileConfig, deps?)` helper — `main()` itself reduced to
  `composeConfig(loadFileConfig())` + `createServer()`. `composeConfig()` now forwards
  `aliases`/`timeoutMs`/`retries` into the constructed `ClaudeAgentSdkGatewayClient` for
  `gateway:'sdk'` (previously omitted — the exact Gate 7.5 round-4 real repro: a configured
  `timeoutMs:1500` had zero effect in production) and forwards `agentDefinitionsDir` into the
  returned `ServerConfig` unconditionally (previously never read at all — every `agentType` call
  permanently resolved "Unknown agentType" via the real entrypoint regardless of any `agents/*.md`
  directory). Added an import-guard (`fileURLToPath(import.meta.url) === process.argv[1]`) so the
  module's side-effecting `main()` boot only fires when it's the real process entry point, not
  merely imported to reach `composeConfig` — a necessary companion per IT-021's own documented
  contract, since re-running the whole program on every import would make the export pointless.
  Config-drift half of the `agentDefinitionsDir` gap closed: `rwe.config.example.json` gained the
  key (`"./agents"`), and a new example `agents/` directory (`researcher.md`, `writer.md`) ships at
  repo root using the exact frontmatter shape `src/agent-definitions.ts` already parses and
  IT-016/IT-022 already exercise.
- **STRUCTURAL RULE compliance (ORCH D-F10, binding):** IT-021/IT-022 boot via
  `import('../../src/main.js')` + the real `composeConfig()` export, not a hand-built `ServerConfig`
  — this is the composition-root test class the round-4 retro required, closing the exact blind spot
  ("nothing constructed the server the way main.ts itself does") that let 3 real defects survive 3
  prior route-back rounds.
- **verification:** `npx vitest run tests/integration/main-composition-root.test.ts
  tests/integration/main-composition-root-agent-types.test.ts` — both green (were IT-021/IT-022 red
  pre-fix, each on `typeof composeConfig === 'function'` then the deeper wiring assertions). Full
  suite green except the pre-existing documented `IT-015` environment flake (see IMPL-047). `tsc
  --noEmit` clean.
- **04-design.md:** DES-009 grew a route-back note (D-F10) describing `composeConfig`, the
  import-guard, and the forwarded fields.
- **files:** src/main.ts, rwe.config.example.json, agents/researcher.md, agents/writer.md
- **commit:** (uncommitted — implementer stage)
- **iter:** v1

### IMPL-046 — D-F10(c): both GatewayClient implementations wire their AbortController to a real cancellation hook
- **status:** done
- **traces:** TASK-011, TASK-012, DES-009
- **greens:** UT-022, UT-023
- **what changed:** `ClaudeAgentSdkGatewayClient._invokeOnce` (`src/gateway/claude-agent-sdk-client.ts`)
  now builds its local `AbortController` (whenever `timeoutMs` or `req.signal` is set) BEFORE
  calling `query()` and assigns it to `options.abortController` — the SDK's own documented
  cancellation hook (`sdk.d.ts:1275`) — instead of only racing it locally after the session was
  already started. Previously the controller existed only to resolve this class's own
  `Promise.race` early; the real spawned `claude` CLI subprocess was never told to stop (Gate 7.5
  round 4's real repro: subprocess alive well past an unsuspended local race). `LiteLLMGatewayClient`
  (`src/gateway/client.ts`) — the `"direct-fetch"` path — gained the matching fix: `invoke(req)`'s
  parameter type now includes `signal?: AbortSignal`, and both `callProvider`/`callViaLiteLLMProxy`
  register an `abort` listener on it that aborts their own per-attempt `AbortController` (the same
  one already wired to `fetch`'s own `signal`). Closes the `state.yaml pending[]` item the round-3
  route-back note explicitly left open ("`LiteLLMGatewayClient`'s `callProvider`/
  `callViaLiteLLMProxy` do NOT yet tie their own `AbortController` to this external signal") — both
  gateway clients now honor `workflow_suspend`'s abort signal, not only `"sdk"`.
- **verification:** `npx vitest run tests/unit/claude-agent-sdk-gateway-abort.test.ts
  tests/unit/gateway-client-suspend-abort.test.ts` — both green (were UT-022/UT-023 red pre-fix).
  Re-ran the pre-existing `claude-agent-sdk-gateway-timeout.test.ts`, `gateway-client.test.ts`, and
  `suspend-aborts-gateway-call.test.ts` alongside — all still green, no regression from restructuring
  `_invokeOnce`'s controller-creation order. Full suite green except the pre-existing documented
  `IT-015` environment flake (see IMPL-047). `tsc --noEmit` clean.
- **honest scope limit:** verified at unit tier only (`vi.mock`s the SDK module / injects
  `fetchImpl`) — confirming the real `claude` CLI subprocess actually terminates on abort (not just
  that `options.abortController`/the fetch `signal` reflect the external abort) requires a live
  process kill observation, which is Gate 7.5's job, same boundary as `IT-015`'s own documented
  environment caveat. Flagged transparently in DEPLOY.md/README.md rather than claimed as
  real-run-confirmed.
- **04-design.md:** DES-009's D-F10 route-back note (added by IMPL-045) covers this change too (same
  route-back, split into two IMPL entries only because the two gateway clients are separate files).
- **files:** src/gateway/claude-agent-sdk-client.ts, src/gateway/client.ts
- **commit:** (uncommitted — implementer stage)
- **iter:** v1

### IMPL-047 — Gate 6 closeout (D-F10 route-back, gap-tests-7): full suite + tsc + trace + docs sync
- **status:** done
- **traces:** DES-009
- **greens:** (integration verification only — re-confirms IMPL-045/046's greens together) IT-021,
  IT-022, UT-022, UT-023
- **what changed:** cross-slice verification — IMPL-045 (`src/main.ts`) and IMPL-046
  (`src/gateway/*.ts`) touch disjoint files, no conflicts. `04-design.md` DES-009 grew one combined
  D-F10 route-back note covering both. `DEPLOY.md` (intro blockquote, §1b config-drift note, §5
  troubleshooting rows for `timeoutMs`/`agentType`/`workflow_suspend`, §6's "3 個組裝根接線缺口"
  section) and `README.md` (intro blockquote, quickstart 範例 2 note, known-limitations items 4-6)
  rewritten to mark all 3 D-F10 gaps fixed at the code/test-tier, explicitly flagged as **not yet
  re-confirmed via an independent real-process boot** (that remains Gate 7.5's job, consistent with
  every prior route-back's own convention — this stage does not claim real-run verification).
- **verification:** `npx vitest run` — 58 files / 197 tests, 196 pass / 1 fail (the single fail is
  the pre-existing, previously-documented, environment-specific `IT-015`
  (`tests/integration/claude-agent-sdk-session.test.ts`) — unchanged before/after this round, not a
  new regression, not touched per Gate 6 rule 4 (do not appease a wrong test); 189 pre-existing +
  7 newly-green (IT-021, IT-022's 1 test, UT-022's 2 tests, UT-023) = 196). `npx tsc --noEmit` — 0
  errors. `sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check` — 169 items scanned, 18
  gaps, confirmed via the dashboard's own gap table: all 18 are `未實作`/`未驗證` on the pre-existing
  v2/v3-out-of-scope baseline (`REQ-008..012/015`, `TASK-018..023`), 0 `斷鏈`(broken-link)/
  `孤兒`(orphan) gaps, identical to the pre-round baseline, 0 new gaps introduced by IMPL-045/046/047.
- **files:** .sdlc/features/001-remote-workflow-engine/04-design.md, DEPLOY.md, README.md
- **commit:** (uncommitted — implementer stage)
- **iter:** v1

### IMPL-048 — D-F11: curated options.allowedTools (agentType tools -> gateway wire surface)
- **status:** done
- **traces:** TASK-009, TASK-011, DES-007, DES-009
- **greens:** UT-024, UT-025, IT-023
- **what changed:** `AgentTypeDef` (`src/agent-executor.ts`) grows `tools?: string[]` — the
  frontmatter `tools:` list `src/agent-definitions.ts` already parsed but (per its own prior header
  comment) deliberately left unstored is now stored (`loadAgentDefinitions` splits the raw
  comma-separated value into a trimmed `string[]`) and applied: `AgentExecutor.run()`'s existing
  agentType-resolution block now also threads a resolved definition's `tools` onto the outbound
  `opts.allowedTools`, the same precedence rule `model` already follows (an explicit caller-supplied
  `opts.allowedTools` always wins; a definition with no `tools` leaves it untouched). `AgentOutcome`'s
  `null` variant grows `aborted?: boolean` this same round (D-F13's own need — see IMPL-049) since
  both touch the same `run()` return sites.
  `ClaudeAgentSdkGatewayConfig` (`src/gateway/claude-agent-sdk-client.ts`) grows
  `defaultAllowedTools?: string[]` (a configurable server-wide default core set); `invoke()` resolves
  one `curatedTools` list per call — caller's `opts.allowedTools`, else `defaultAllowedTools`, else a
  built-in `['Read','Write','Bash']` — never left unset. A real-CLI repro (writing a throwaway debug
  script against the actual `@anthropic-ai/claude-agent-sdk` package + a local stub server, not
  shipped) proved `options.allowedTools` ALONE does not narrow the outbound wire tool surface at all
  (`sdk.d.ts:1323`'s own doc: it only auto-approves listed tools without prompting) — the actual
  restriction hook is `options.tools` (`sdk.d.ts` "Specify the base set of available built-in
  tools"). The same repro also showed the CLI additionally inheriting this host machine's own
  project/user Claude Code settings (unrelated MCP plugin tool definitions) regardless of `tools`;
  `settingSources: []` (SDK isolation mode) + `strictMcpConfig: true` eliminates that leakage.
  `invoke()` now sets `allowedTools`, `tools` (both `curatedTools`), `settingSources: []`, and
  `strictMcpConfig: true` on every call. `defaultAllowedTools` is forwarded end-to-end: new
  `FileConfig.defaultAllowedTools` in `src/main.ts`'s `composeConfig()` -> the constructed
  `ClaudeAgentSdkGatewayClient` (documented config key, `rwe.config.example.json` gained
  `"defaultAllowedTools": ["Read","Write","Bash"]`).
- **verifier-authored type extension left as a cast, not formalized in `AgentOpts` (deliberate,
  matches the tests' own `@ts-expect-error`):** `UT-024` deliberately keeps
  `// @ts-expect-error — allowedTools is a verifier-authored design extension to AgentOpts, not yet
  in src/types.ts` on its own literal — adding `allowedTools` directly to the canonical `AgentOpts`
  interface would make that directive unused (a new `tsc --noEmit` error, since `@ts-expect-error`
  requires an actual error on the following line). `AgentOpts` itself is therefore left unchanged;
  every read/write site (`agent-executor.ts`'s `effectiveOpts`, `claude-agent-sdk-client.ts`'s
  `req.opts`) uses a local `AgentOpts & { allowedTools?: string[] }` cast instead, exactly the same
  pattern the test file itself uses. `tsc --noEmit` confirmed clean with this approach.
- **verification:** `npx vitest run tests/unit/claude-agent-sdk-gateway-allowed-tools.test.ts
  tests/unit/agent-executor-allowed-tools.test.ts
  tests/integration/claude-agent-sdk-gateway-allowed-tools.test.ts` — all green (were UT-024 (3
  cases), UT-025 (1 forcing case), IT-023 red pre-fix). Re-ran `agent-type-composition-root.test.ts`
  (IT-016, exercises the direct-fetch/LiteLLM gateway path, unaffected since that path never reads
  `opts.allowedTools`) — still green, no regression. Full suite + `tsc --noEmit`: see IMPL-050.
- **04-design.md:** DES-007 and DES-009 each grew a D-F11 route-back note (agentType-side threading
  and gateway-side wire-narrowing respectively).
- **files:** src/agent-executor.ts, src/agent-definitions.ts, src/gateway/claude-agent-sdk-client.ts,
  src/main.ts, rwe.config.example.json
- **commit:** (uncommitted — implementer stage)
- **iter:** v1

### IMPL-049 — D-F12 (AgentRecord queued/running) + D-F13 (journal aborted-vs-terminal null)
- **status:** done
- **traces:** TASK-004, TASK-005, TASK-010, DES-004, DES-008, DES-010
- **greens:** IT-024, IT-025
- **what changed (D-F12):** `AgentTranscriptSink` (`src/agent-executor.ts`) grows two additive
  methods — `markQueued(agentId, label?, phase?)` (records `state:'queued'` with placeholder
  `provider:''`/`model:''`/`tokens:{0,0}`) and `markRunning(agentId)` (flips an existing record's
  `state` to `'running'`) — both exposed on `AgentExecutor` (delegating to its private sink)
  alongside the existing `getRecord`/`getAllRecords`. `RunManager._handleAgentRequest`
  (`src/run-manager.ts`) now allocates the agentId via `RunGuard.nextAgentId()` and calls
  `markQueued` BEFORE `await guard.acquireSlot()` — so a call genuinely blocked behind the
  concurrency cap is observable via `workflow_status` right away — then calls `markRunning` once the
  slot is acquired, before dispatching to the spawner. `capture()` (unchanged) still overwrites the
  record with the real terminal `'done'`/`'failed'` state once the call resolves. Closes the
  round-5 `agents:[]`-while-`running` gap (REQ-007's 1st clause, REQ-002's 2nd clause's
  observability half).
- **what changed (D-F13):** `JournalEntry` (`src/types.ts`) grows `aborted?: boolean`.
  `AgentOutcome`'s `{kind:'null'}` variant (`src/agent-executor.ts`) grows the matching
  `aborted?: boolean` — set at both `AgentExecutor.run()` abort return sites (already-aborted signal
  at entry; the internal abort-vs-invoke race resolving as aborted), left absent for a genuine
  terminal gateway failure or exhausted schema-retry budget. `RunManager._handleAgentRequest` now
  sets `journalEntry.aborted = outcome.kind === 'null' && outcome.aborted === true`.
  `ResumeCache`'s `Plan.replay()` (`src/resume-cache.ts`) now treats an `aborted` entry as a cache
  MISS (`this._missed = true; return MISS`) exactly like a missing/changed-key entry — the same
  "everything from the first miss onward runs live" contract the cache already documents, just
  triggered by a different condition. Closes the round-5 finding that `workflow_resume` after a
  suspend-interrupted `agent()` call replayed the aborted null instead of re-running it live
  (REQ-006's 1st clause).
- **verification:** `npx vitest run tests/integration/in-flight-agent-state.test.ts
  tests/integration/resume-rerun-aborted-call.test.ts` — both green (were IT-024/IT-025 red
  pre-fix). Re-ran `run-manager-runguard.test.ts`, `budget-live-accounting.test.ts`,
  `suspend-aborts-gateway-call.test.ts`, `resume-cache.test.ts`, `agent-executor.test.ts`,
  `agent-executor-schema-retry.test.ts` alongside (all touch `RunGuard.nextAgentId()` ordering,
  `AgentOutcome.kind`, or `ResumeCache.replay()`) — all still green, no regression from the
  additive-only field/method changes.
- **honest scope limit — occasional real-subprocess timing flake (IT-024):** across ~10 repeated
  runs (both standalone and inside the full 63-file suite), IT-024 passed the large majority of the
  time but occasionally failed on its "B is queued" assertion under system load. Root-caused (not
  guessed): both `parallel()` thunks' `agent()` calls send their IPC `'agent'` message
  synchronously back-to-back from the child (`child-entry.ts`), but the PARENT's receipt of each is
  a genuine two-independent-OS-process race — A's own chain from receiving its message to reaching
  the fake gateway's `aInvoked()` callback is only 2 microtask levels (about as fast as JS execution
  gets), so under heavy scheduling contention it can occasionally complete before the parent has
  even finished reading B's message off the pipe, i.e. before `markQueued(B)` has run at all. This
  is the exact same class of flake `vitest.config.ts`'s own top-of-file comment already documents
  and accepts for this codebase's real-child-process integration tests ("an intermittent-timeout
  flake, not a logic defect... VAL-006/E2E-002") — confirmed the underlying `markQueued`/
  `markRunning` logic is correct via repeated isolated passes, not a defect in this implementation.
  Reported transparently rather than papered over; see `test_defects` in this stage's own report for
  a suggested test-side robustness improvement (poll for both records rather than a single
  point-in-time check) for Gate 5 to consider.
- **04-design.md:** DES-004 and DES-010 each grew a D-F13 route-back note (resume-cache MISS
  semantics and the additive `JournalEntry.aborted` field respectively); DES-008 grew a D-F12
  route-back note (`markQueued`/`markRunning`).
- **files:** src/agent-executor.ts, src/run-manager.ts, src/resume-cache.ts, src/types.ts
- **commit:** (uncommitted — implementer stage)
- **iter:** v1

### IMPL-050 — Gate 6 closeout (gap-tests-8): full suite + tsc + trace + docs sync
- **status:** done
- **traces:** DES-004, DES-007, DES-008, DES-009, DES-010
- **greens:** (integration verification only — re-confirms IMPL-048/049's greens together) UT-024,
  UT-025, IT-023, IT-024, IT-025
- **what changed:** cross-slice verification — IMPL-048 (`agent-executor.ts`/
  `agent-definitions.ts`/`claude-agent-sdk-client.ts`/`main.ts`/`rwe.config.example.json`) and
  IMPL-049 (`run-manager.ts`/`resume-cache.ts`/`types.ts`) touch overlapping files
  (`agent-executor.ts`) but disjoint code regions (allowedTools threading vs. queued/running +
  aborted-outcome plumbing) — verified no logical conflict by reading the merged file directly.
  `04-design.md` DES-004/007/008/009/010 each grew the route-back notes described in IMPL-048/049.
- **verification:** `npx vitest run` — 63 files / 206 tests, 205 pass / 1 fail (the single fail is
  the pre-existing, previously-documented, environment-specific `IT-015`
  (`tests/integration/claude-agent-sdk-session.test.ts`) — see this stage's own `test_defects` report
  for why its current failure mode is a stale test assumption, not a regression from this round's
  changes; IT-024 occasionally flakes under load per IMPL-049's own honest scope-limit note, both
  unrelated to and not introduced by this round's src changes). All 7 target reds (UT-024's 3 cases,
  UT-025's 1 forcing case, IT-023, IT-024, IT-025) confirmed green individually and together,
  repeatedly. `npx tsc --noEmit` — 0 errors. `sh .sdlc/trace .sdlc/features/001-remote-workflow-engine
  --check` — confirmed 0 new orphan/broken-link gaps, identical pre-existing v2/v3-out-of-scope
  baseline (see this stage's own gate_check summary for the exact count).
- **files:** .sdlc/features/001-remote-workflow-engine/04-design.md
- **commit:** (uncommitted — implementer stage)
- **iter:** v1

### IMPL-051 — Gate 8 closing fixes (D-G8-1..6, gap-tests-9): nested callSeq namespacing + transcript fidelity + real tools/list schemas + zero-config timeout fallback + env allowlist + budget reservation
- **status:** done
- **traces:** ARCH-001, ARCH-002, ARCH-004, ARCH-005, ARCH-006, DES-001, DES-002, DES-004, DES-008,
  DES-009, TASK-002, TASK-003, TASK-004, TASK-005, TASK-009, TASK-010, TASK-011, TASK-012, REQ-002,
  REQ-006, REQ-007
- **greens:** IT-026, IT-027, IT-028 (3 of 4 sub-cases — see test_defects below), IT-029, IT-030,
  UT-026
- **what changed (D-G8-1, adversarial.md V3 — nested workflow() journal callSeq collision):**
  `src/run-manager.ts` — `_handleWorkflowRequest` now receives the parent script's own `callSeq` for
  the `workflow()` call that spawned it (`SandboxHost.onWorkflowRequest`'s 3rd param, already
  threaded by `host.ts`, previously unused) and namespaces every nested child's own independently-
  restarting `callSeq` counter via a new `RunManager._nestedCallSeq(parentCallSeq, nestedCallSeq) =
  (parentCallSeq+1) * 1_000_000 + nestedCallSeq` before it ever reaches `_handleAgentRequest`/the
  shared journal/`ResumeCache`. Deterministic across an original run and a resume of the same
  unmodified script (the same `workflow()` call gets the same parent-level `callSeq` both times), so
  the outer script's own journal entries (raw `callSeq` 0,1,2,...) can never collide with a nested
  child's own (also raw 0,1,2,...) — closes the `Map<callSeq,JournalEntry>` silent-collision bug that
  corrupted `ResumeCache`'s longest-unchanged-prefix replay for the WHOLE run, not just the nested
  call.
- **what changed (D-G8-2, quality-dimensions.md O-1 — transcript black-box):**
  `src/gateway/client.ts` — `GatewayResult`'s `ok:true` variant grows optional `events?:
  TranscriptEvent[]`. `src/gateway/claude-agent-sdk-client.ts` — new `extractEvents(msg, ts)` maps a
  real SDK message's own `message.content` array items (`type:'text'` -> `kind:'message'`,
  `type:'tool_use'` -> `kind:'tool_call'`, `type:'tool_result'` -> `kind:'tool_result'`) into
  `TranscriptEvent`s; `_drain` now accumulates these across every non-`result` message instead of
  discarding them (`if (msg.type !== 'result') continue`), returning them on the final `GatewayResult`.
  `src/agent-executor.ts` — `AgentTranscriptSink.capture()` now emits each of `result.events` (in
  order) via the store BEFORE the terminal `usage` summary event, so a real reasoning/tool-call trace
  reaches `workflow_agent_log`, not just one token-count line per call. `LiteLLMGatewayClient` (no SDK
  message stream to tap) leaves `events` unset — unchanged legacy single-`usage`-event behavior for
  that path, exactly as documented on the new field.
- **what changed (D-G8-3, quality-dimensions.md C-1 — placeholder tools/list metadata):**
  `src/server.ts` — replaced `TOOL_NAMES.map((name) => ({ name, description: name, inputSchema:
  {type:'object'} }))` with a new `TOOL_METADATA` record giving each of the 10 tools a real,
  non-name-echoing description plus a real JSON `inputSchema` (`properties`/`required`) mirroring
  exactly the argument shape `callTool()`/`McpFacade` already accept (e.g. `workflow_run`:
  `name?`/`script?`/`args?`/`budget?`; `workflow_agent_log`: required `runId`+`agentId`).
  `workflow_list` (a genuinely zero-parameter tool per `04-design.md:45`'s own `workflow_list(a?:
  {})` signature) gets `properties: {}` — real (not a placeholder repeating the tool name), but
  correctly empty since it truly takes no arguments; see `test_defects` below for the one gap-test
  sub-assertion this doesn't satisfy.
- **what changed (D-G8-4, quality-dimensions.md S-1 — no default timeoutMs on the zero-config
  default gateway path):** `src/main.ts` `composeConfig()` — `timeoutMs: fileConfig.timeoutMs` grew
  the same hardcoded `?? 15000` fallback `server.ts`'s own legacy `LiteLLMGatewayClient` construction
  already has (`config?.timeoutMs ?? 15000`). Also fixed a second, more direct bug found while
  verifying the fix: the `ClaudeAgentSdkGatewayClient` constructor call a few lines below was reading
  the raw `fileConfig.timeoutMs` (still `undefined` in the zero-config case) instead of the just-
  resolved `config.timeoutMs` — the fallback would have been dead code without this second fix (IT-029
  stayed red against the first fix alone; a throwaway debug script isolated the exact line before
  shipping the second fix).
- **what changed (D-G8-5, adversarial.md V5 — full process.env forwarded to the spawned CLI):**
  `src/gateway/claude-agent-sdk-client.ts` — new `ENV_ALLOWLIST = ['PATH','HOME','SHELL','LANG',
  'LC_ALL','TMPDIR','TERM']` + `buildSubprocessEnv(baseUrl)` builds the spawned session's `env` from
  only those allowlisted host keys (when present) plus the overridden `ANTHROPIC_BASE_URL`/
  `ANTHROPIC_API_KEY` pair, replacing the previous `env: {...process.env, ANTHROPIC_BASE_URL:...,
  ANTHROPIC_API_KEY:...}` spread that leaked every other host secret (OPENAI_API_KEY, cloud
  credentials, ...) straight through — now actually matches the file's own pre-existing D-R2 header
  comment ("this class never reads or forwards a real host credential").
- **what changed (D-G8-6, adversarial.md V2 — stale pre-dispatch budget check under parallel()):**
  `src/run-guard.ts` — `RunGuard` grows `reserve(): number` (atomically reserves the run's entire
  currently-remaining budget for one about-to-dispatch call, synchronous — no per-call cost estimate
  exists ahead of time) and `releaseReserved(amount)` (frees it once the call settles, regardless of
  its real cost — real cost accounting via `addTokens()` is untouched, a separate concern);
  `assertBudget()` now checks `_spent + _reserved >= total`. `src/run-manager.ts`
  `_handleAgentRequest` calls `entry.guard.reserve()` synchronously (no `await` in between) right
  after `assertBudget()`, wraps the rest of the call in a `try`/`finally` that calls
  `releaseReserved(reserved)`. Since only ONE call can ever hold a full-remaining-budget reservation
  at a time, a burst of concurrent `parallel()` dispatches can no longer all pass the stale
  pre-dispatch check before any one of them has recorded real spend — the 2nd..Nth concurrent call
  now synchronously throws `BudgetExceededError` (existing hard-throw-at-ceiling contract, REQ-002)
  instead of all reaching the gateway.
- **verification:** targeted reds green individually
  (`npx vitest run tests/integration/nested-workflow-callseq-resume.test.ts
  tests/integration/agent-transcript-message-stream.test.ts
  tests/integration/mcp-tools-list-schema.test.ts tests/integration/main-default-timeout-fallback.test.ts
  tests/unit/claude-agent-sdk-gateway-env-allowlist.test.ts
  tests/integration/parallel-budget-concurrency.test.ts`) and together with the full suite. Full
  regression: `npx vitest run` = 69 files / 217 tests, 215 pass / 2 fail — both pre-existing,
  documented, unrelated to this round's changes: `IT-015` (`claude-agent-sdk-session.test.ts`, the
  long-documented environment-specific nested-Claude-Code-host interception, unchanged) and `IT-024`
  (`in-flight-agent-state.test.ts`, the already-documented ~1-in-6 real-subprocess-IPC-race flake,
  confirmed unrelated to the D-G8-6 reserve/release change since `budget:null` in that test makes
  `reserve()` a synchronous 0-cost no-op — reran it standalone 10x, 7/10 pass, consistent with the
  pre-existing documented flake rate, not a new regression). `npx tsc --noEmit`: 0 errors (also fixed
  2 pre-existing type-narrowing gaps in the gap-tests-9 test files themselves — see `test_defects`).
  `sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check`: 186 items, 18 gaps, identical
  pre-existing v2/v3-out-of-scope baseline (REQ-008..012/015, TASK-018..023), 0 new/orphan/broken-link
  gaps.
- **04-design.md:** DES-001 (tools/list real schemas), DES-002 (RunGuard reserve/releaseReserved),
  DES-004 (nested-workflow callSeq namespacing), DES-008/DES-009 (transcript event forwarding,
  env allowlist) each grew a D-G8 route-back note (see the design-doc edit accompanying this entry).
- **files:** src/run-manager.ts, src/run-guard.ts, src/agent-executor.ts, src/gateway/client.ts,
  src/gateway/claude-agent-sdk-client.ts, src/server.ts, src/main.ts,
  tests/integration/nested-workflow-callseq-resume.test.ts,
  tests/integration/parallel-budget-concurrency.test.ts
- **commit:** (uncommitted — implementer stage)
- **iter:** v1

## v2 parallel round (TASK-019..027) — Gate 6 implementer output, integrated at Gate 6 closeout

### IMPL-052 — SqliteSchedulerPort: SQLite-persisted Schedule CRUD + resident workflow_trigger
- **status:** done
- **traces:** ARCH-010, TASK-019, DES-016
- **greens:** UT-027, IT-031, IT-034 (schedule_create/schedule_list/schedule_delete/workflow_trigger tools/list sub-assertions)
- **files:** src/scheduler.ts (new); src/server.ts (TOOL_NAMES/TOOL_METADATA/callTool/createServer wiring for schedule_create, schedule_list, schedule_delete, schedule_setEnabled, workflow_trigger)
- **commit:** (uncommitted — implementer stage)
- **iter:** v2

### IMPL-053 — buildDashboardModel: pure dashboard view-model builder over RunSummary/RunStatusView/TranscriptEvent
- **status:** done
- **traces:** ARCH-011, TASK-020, DES-018
- **greens:** UT-029
- **files:** src/dashboard.ts (new)
- **commit:** (uncommitted — implementer stage)
- **iter:** v2

### IMPL-054 — Asset Sync core: isSelfReferential + safeRelPath predicates + AssetSyncService (push/list/delete, partial-push atomicity)
- **status:** done
- **traces:** ARCH-012, TASK-021, DES-019
- **greens:** UT-030, IT-034 (asset_push/asset_list/asset_delete tools/list + skill-store/self-ref-exclusion/path-traversal-atomicity sub-assertions), VAL-009 (4 of 5 sub-assertions: skill push+list, delete, rwe-* exclusion, path-traversal atomicity — 5th sub-assertion closed by IMPL-057/D-V2I-1 below)
- **files:** src/asset-sync.ts (new); src/server.ts (TOOL_NAMES/TOOL_METADATA/callTool/createServer wiring for asset_push, asset_list, asset_delete)
- **commit:** (uncommitted — implementer stage)
- **iter:** v2

### IMPL-055 — Claude Code client plugin artifact (dir layout + MCP config + guidance skill)
- **status:** done
- **traces:** ARCH-013, TASK-022, DES-021
- **greens:** UT-032 (tests/unit/client-plugin-artifact.test.ts, 6 cases), VAL-010 (tests/acceptance/val-010-client-plugin.test.ts, 6 cases)
- **files:** plugin/.mcp.json, plugin/skills/rwe-remote-workflow/SKILL.md
- **commit:** (uncommitted — implementer stage)
- **iter:** v2

### IMPL-056 — Scheduler firing engine: pure tick(now)/computeNextFire + Ticker/Clock seam + bootRearm
- **status:** done
- **traces:** ARCH-010, TASK-024, DES-017
- **greens:** UT-028 (tests/unit/scheduler-engine.test.ts, 11/11), IT-032 (tests/integration/scheduler-fires-run.test.ts, 3/3)
- **files:** src/scheduler-engine.ts (new)
- **commit:** (uncommitted — implementer stage)
- **iter:** v2

### IMPL-057 — Asset MCP-config live-probe validator: pure classifyTransport + injected McpProbe port (Fake/Real) + composition-root wiring into asset_push
- **status:** done
- **traces:** ARCH-012, TASK-026, DES-020
- **greens:** UT-031 (tests/unit/mcp-probe-classify.test.ts, 4/4); VAL-009 (5th sub-case: "pushing a non-runnable MCP config type returns a rejection with a machine-readable code" — satisfies D-V2I-1, confirmed already wired into asset_push at hand-off, no further integration code needed); IT-034 (tests/integration/asset-mcp-tools.test.ts, 10/10)
- **files:** src/mcp-probe.ts (new); src/server.ts (ServerConfig.mcpProbe, checkMcpConfigTransport helper, asset_push case gating on it, RealMcpProbe default instantiation)
- **commit:** (uncommitted — implementer stage)
- **iter:** v2

### IMPL-058 — Dashboard read-only HTTP transport (GET /api/runs, /api/runs/:id, /api/runs/:id/agents/:aid)
- **status:** done
- **traces:** ARCH-011, TASK-025, DES-018
- **greens:** IT-033 (tests/integration/dashboard-http.test.ts, 4/4), VAL-008 (tests/acceptance/val-008-dashboard.test.ts, 5/5)
- **files:** src/server.ts (handleDashboardRequest, route dispatch for /api/runs* ahead of the /mcp-only check)
- **commit:** (uncommitted — implementer stage)
- **iter:** v2

### IMPL-059 — Deploy hardening: LiteLLM orphan-reap (process-group SIGTERM) + pre-bind port ownership check + configurable litellmPort threaded through composeConfig/ServerConfig/GatewayConfig
- **status:** done
- **traces:** ARCH-014, TASK-027, DES-022
- **greens:** UT-033 (litellmPort forwarding case), plus 4 implementer-self-authored unit tests in tests/unit/litellm-proxy-hardening.test.ts (pre-bind EADDRINUSE rejection, happy-path start on free port, process-group cascade-kill via negative pid, fallback direct-kill for pid-less test doubles) — accepted per D-V2I-5; formalized as numbered items (UT-034/UT-035-equivalent) in 05-tests.md by the gap-test verifier so trace stays complete (no orphan greens)
- **files:** src/gateway/litellm-proxy.ts, src/gateway/client.ts, src/server.ts, src/main.ts, tests/unit/litellm-proxy-hardening.test.ts
- **commit:** (uncommitted — implementer stage)
- **iter:** v2

### IMPL-060 — Deploy packaging: docker-compose (default + optional litellm profile) + systemd unit + documented, real-verified smoke check
- **status:** done
- **traces:** ARCH-014, TASK-023, DES-022
- **greens:** VAL-011
- **files:** docker-compose.yml, deploy/rwe.service, scripts/smoke.sh, DEPLOY.md (§2b section)
- **commit:** (uncommitted — implementer stage)
- **iter:** v2

## Gate 6 closeout (integrator) — binding coordination items D-V2I-1..6

### IMPL-061 — D-V2I-2/3 scheduler firing engine wired live + workflow_trigger/schedule_create catalog-registration gate; D-V2I-4 composeConfig v2 forwarding; D-V2I-6 GatewayClient.stop() lifecycle; D-V2I-1/5 confirmed already wired at hand-off
- **status:** done
- **traces:** DES-016, DES-017, DES-019, DES-020, DES-022, TASK-019, TASK-021, TASK-024, TASK-026, TASK-027, REQ-014, REQ-015
- **signature:** closes the 6 orchestrator-resolved parallel-round coordination items so the whole
  v2 suite is green together, not just each implementer's own slice in isolation.
- **greens:** E2E-004 (5/5), E2E-005 (4/4), VAL-016 (8/8), UT-027 (8/8, trigger()'s new catalog
  check), UT-033 (schedulerDbPath/assetRoot forwarding cases — litellmPort case was already green),
  UT-036/gateway-client-stop.test.ts (3/3)
- **what changed (D-V2I-2, scheduler firing engine wired live):** `src/scheduler.ts` — `create()`
  now computes and persists `nextFire` via the injected Clock (`computeNextFire` for `cron`,
  `Date.parse(at)` for `once`, imported from `scheduler-engine.ts`; no cross-import cycle — the
  engine module only depends on `clock.ts`); new `all()` (driver-facing read of every enabled
  cron/once schedule shaped as `scheduler-engine.ts`'s own `StoredSchedule`), `markFired(firing,
  runId)` (records lastFire/lastRunId/run_origins join, auto-completes a fired `once` via
  `enabled:false`, recomputes a fresh future `nextFire` for a fired `cron` — fire-once-on-catch-up-
  then-resume, DES-017), and `rearmAtBoot()` (re-derives every persisted schedule's `nextFire` from
  `clock.now()` at startup via the already-tested pure `bootRearm()` helper, persisting the result
  back). Schema fix found while wiring this: the `nextFire` column was declared `TEXT`, and SQLite's
  TEXT-affinity coercion silently stringified the bound JS number on write, producing a value
  `new Date(...)` could not parse back on read (`RangeError: Invalid time value` — caught this via
  the newly-red `UT-027`/`VAL-016`/`E2E-004` before it ever reached a real deployment); changed to
  `INTEGER`. `src/server.ts` — `createServer()` now calls `scheduler.rearmAtBoot()` once at boot,
  then starts a `RealTicker(500)` driver loop: each tick, pure `tick(scheduler.all(), clock.now())`
  decides due firings, each is dispatched via `runManager.start()` — the SAME path `workflow_run`/
  `workflow_trigger` use (DES-016's "same run path" invariant, so a scheduled run is indistinguishable
  from a manual one in `workflow_list`/dashboard) — then `scheduler.markFired()` records the outcome.
  `Server.close()` now stops the ticker first (a closed server never fires another schedule).
- **what changed (D-V2I-3, registered-workflow-only schedule/trigger targets):** `src/scheduler.ts`
  — `trigger()` now calls `this._catalog.get(workflow)` first and returns
  `error{code:'WORKFLOW_NOT_FOUND', field:'workflow'}` for an unregistered name, exactly mirroring
  `create()`'s own pre-existing catalog check — previously `trigger()` on a never-registered
  workflow silently attempted `RunManager.start({name})`, which either threw past the tool boundary
  (surfacing as a bare JSON-RPC-level error, not the expected `ResultEnvelope` shape) or, worse,
  would have looked like a normal start attempt. `E2E-004`/`E2E-005`/`VAL-016`'s three
  never-registered-workflow red cases (corrected by the gap-test verifier per the ORCH note to call
  `workflow_register` first, never an inline ad-hoc `workflow_run({name,script})`, which never
  persists to `WorkflowCatalog`) are the forcing tests for this.
- **what changed (D-V2I-4, composeConfig forwarding):** `src/server.ts` — `ServerConfig` grows
  `schedulerDbPath?`/`assetRoot?`; `createServer()` uses them (`config?.schedulerDbPath ??
  join(workRoot,'schedules.db')` / `config?.assetRoot ?? join(workRoot,'assets')`) in place of the
  previous hardcoded joins. `src/main.ts` — `composeConfig()` forwards both from `FileConfig`
  (inherited automatically via `FileConfig extends Partial<Omit<ServerConfig,'gateway'>>`) into the
  returned `ServerConfig`, same unconditional-of-gateway-choice convention as `litellmPort`/
  `agentDefinitionsDir`. No `dashboardPort` key added — confirmed (DES-018/DES-022's own D-V2I-4
  note) the dashboard is served on the same `/mcp` http listener, so a separate port key would be
  dead wiring; `UT-033`'s own coverage already omits that case per the gap-test verifier's
  correction.
- **what changed (D-V2I-6, GatewayClient lifecycle):** `src/gateway/client.ts` — `GatewayClient`
  interface grows optional `stop?(): Promise<void>`; `LiteLLMGatewayClient.stop()` delegates to
  `this._proxy?.stop()` (the SAME private field already populated either by an injected
  `proxyManager` or the constructor's own internally-built `LiteLLMProxyManager` — a safe no-op when
  `useLiteLLMProxy` was never set). `src/server.ts` — `Server.close()` now chains
  `.then(() => gateway?.stop?.())` after `http.close()`, so the direct-fetch/legacy gateway path's
  own internally-constructed proxy (previously invisible to any shutdown handler — `main.ts`'s own
  shutdown only ever tracked the 'sdk' branch's `config.proxyManager`) is reaped on every
  `Server.close()`, closing the v1 DEPLOY known-open orphan-subprocess item for this path too.
- **D-V2I-1 (asset_push mcp-config probe) and D-V2I-5 (TASK-027 hardening tests) — confirmed
  already fully wired/accepted at hand-off, no further integration code needed:** re-ran
  `tests/acceptance/val-009-asset-sync.test.ts` standalone (5/5 green, including the non-runnable-
  MCP-config-type rejection sub-case) and `tests/unit/litellm-proxy-hardening.test.ts` (4/4 green)
  to verify before writing this entry — IMPL-057's own `checkMcpConfigTransport` gating in
  `src/server.ts`'s `asset_push` case was already correct; IMPL-059's 4 self-authored hardening
  tests were already passing. `05-tests.md`'s own numbering for these (per the gap-test verifier)
  was already in place at hand-off.
- **schema note:** the `nextFire` SQLite column-affinity fix above (TEXT→INTEGER) is the one place
  this round touched `06-impl-log.md`-visible behavior of IMPL-052's own `SqliteSchedulerPort`
  beyond pure addition — flagged here rather than silently folded into IMPL-052 since Gate 6's own
  discipline is "don't touch what a parallel implementer built without saying so."
- **verification:** full suite `npx vitest run` — 89 files / 333 tests, 330 pass / 3 fail, all 3
  pre-existing and documented, none introduced by this round: `IT-015`
  (`claude-agent-sdk-session.test.ts`, environment-specific nested-Claude-Code-host interception,
  unchanged since IMPL-050/051), `IT-024` (`in-flight-agent-state.test.ts`, the documented
  ~1-in-6 real-subprocess-IPC-race flake — reran standalone 3x, 1/3 pass, consistent with the
  pre-existing rate; this test never calls `createServer()`/the scheduler ticker, confirmed
  unrelated), and `IT-028`'s one sub-case (`mcp-tools-list-schema.test.ts`, `workflow_list`'s
  correctly-empty `properties:{}` for a genuinely zero-argument tool — documented pre-existing
  `test_defect` from IMPL-051, unrelated to v2 scope, unchanged). `npx tsc --noEmit`: 0 errors in
  `src/` (the pre-existing `tests/unit/compose-config-v2-wiring.test.ts` `queryImpl` fake-typing
  looseness is a test-file-only defect, reported in this stage's own `test_defects`, not a src
  issue — see report). `sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check`: no new
  orphan/broken-link gaps introduced by this round (see this stage's own `gate_check` summary for
  the exact count).
- **files:** src/scheduler.ts, src/server.ts, src/main.ts, src/gateway/client.ts
- **commit:** (uncommitted — implementer stage)
- **iter:** v2

### IMPL-062 — D-V2V-1 (REQ-009 asset wiring): mcp-config threaded into per-call options.mcpServers; skill/hook assets materialized into the run's own workspace .claude/ + settingSources:['project']/cwd re-scoped
- **status:** done
- **traces:** DES-019, DES-020, REQ-009
- **signature:** closes the Gate 7.5 round-1 finding (VAL-017/08-validation.md) that an accepted
  asset sat on disk but was never reachable by any `agent()` call. Fixed entirely at the CONSUMER
  (`ClaudeAgentSdkGatewayClient`) — `AssetSyncService`/`asset-sync.ts`'s own push/list/delete +
  recursion-guard(D4)/path-safety predicates are untouched (DES-019 stays transport-agnostic).
- **greens:** IT-035 (1/1), IT-036 (2/2)
- **what changed:** `src/gateway/client.ts` — `GatewayClient.invoke()`'s req type grows an optional
  `workspace?: string` (only `ClaudeAgentSdkGatewayClient` consumes it; other gateways ignore it,
  unchanged). `src/agent-executor.ts` — `_invokeOnce()` forwards `req.workspace` (already a
  mandatory `AgentReq` field, always set by `RunManager`) into the gateway `invoke()` call.
  `src/gateway/claude-agent-sdk-client.ts` — new `assetRoot?: string` config field; new
  `readMcpConfigAssets(assetRoot)` (reads every stored `mcp-config` asset FRESH off disk on every
  `invoke()` call, keyed by asset name — a push made after boot reaches the very next run, not just
  a startup snapshot) threaded into `options.mcpServers` (`strictMcpConfig:true` stays unchanged);
  new `materializeAssets(assetRoot, workspace)`/`copyDirRecursive` copy every stored `skill`/`hook`
  asset into `<workspace>/.claude/skills|hooks/<name>/` before the call. `options.cwd` is now
  `req.workspace ?? this._config.cwd` (re-scoped to THIS call's run workspace when known);
  `options.settingSources` is `['project']` when a workspace is known, `[]` otherwise (unchanged
  legacy behavior for a direct unit-tier `invoke()` call with no workspace) — host-level `'user'`/
  `'local'` sources are never added either way, preserving the D-F11 isolation this class was built
  to close, now scoped per run instead of globally off. `src/main.ts` — `composeConfig()` forwards
  the resolved `config.assetRoot` into the constructed `ClaudeAgentSdkGatewayClient`; `assetRoot`
  now defaults to `join(workRoot,'assets')` when the file config sets `workRoot` but omits
  `assetRoot` (same default `src/server.ts`'s own `AssetSyncService` construction already uses) —
  otherwise `rwe.config.example.json`'s own committed template (`workRoot` set, `assetRoot` never
  set) would silently never thread asset storage's real on-disk location into the SDK gateway,
  covered by 2 new cases in `tests/unit/compose-config-v2-wiring.test.ts`.
  This system's own `rwe-*` skill/plugin stays excluded end-to-end unchanged — D4 already prevents
  it from ever landing on disk, so the new read-side never finds it either (IT-036's own regression
  guard, confirmed still green).
- **files:** src/gateway/client.ts, src/agent-executor.ts, src/gateway/claude-agent-sdk-client.ts,
  src/main.ts, tests/unit/compose-config-v2-wiring.test.ts
- **commit:** (uncommitted — implementer stage)
- **iter:** v2b

### IMPL-063 — D-V2V-2 (REQ-008 browser dashboard): GET /dashboard self-contained HTML/JS page on the same server/port, SPA-style /dashboard/<runId> routing, setInterval-based auto-update
- **status:** done
- **traces:** DES-018, REQ-008
- **signature:** closes the Gate 7.5 round-1 finding (VAL-018/08-validation.md) that the user's own
  explicit Gate-1 choice (瀏覽器即時儀表板) was not satisfied by a JSON-only transport with no HTML
  page/DOM to open in a literal browser tab. `buildDashboardModel`/the existing `/api/runs*` HTTP
  transport (DES-018, IMPL-053/IMPL-058) are untouched — one data model, two transports, now
  genuinely two.
- **greens:** VAL-018 (5/5)
- **what changed:** new `src/dashboard-page.ts` exports `DASHBOARD_HTML` — a minimal, dependency-
  free static HTML/JS string: a run list (`fetch('/api/runs')`), a drill-in view rendering the
  phase/agent tree with per-agent `agentId`/`state`/`tokens`, a transcript view
  (`fetch('/api/runs/<id>/agents/<id>')`), and `setInterval(refresh, 3000)` polling so state/tokens
  refresh without a manual reload. `src/server.ts` — the existing single `createHttpServer` handler
  gains one new branch: `GET /dashboard` or `GET /dashboard/*` serves `DASHBOARD_HTML` verbatim
  (`text/html`) on the SAME port as `/mcp`/`/api/runs*`; `/dashboard/<runId>` is client-side (SPA-
  style) routing — the page's own JS reads the `runId` back out of `location.pathname`, no server-
  side per-run render needed.
- **files:** src/dashboard-page.ts, src/server.ts
- **commit:** (uncommitted — implementer stage)
- **iter:** v2b

### IMPL-064 — Gate 8 v2 review route-back closeout (D-V2G8-1(a)(b)(c)(d) + D-V2G8-2): drop bypassPermissions, curate default tool surface, wire a canUseTool workspace-boundary callback, explicit proxy-env key custody, per-call budget-reservation estimate
- **status:** done
- **traces:** ARCH-007, ARCH-005, ARCH-002, ARCH-003
- **signature:** closes the 2 Gate 8 v2 review findings (adversarial.md V3 HIGH — agent CLI
  `bypassPermissions` + default-on Bash + `cwd`-only confinement → key/cross-run exfiltration; V4
  MEDIUM — my own v1 `D-G8-6` `reserve()` overcorrection collapsed `parallel()` concurrency to 1
  under any bounded budget) via the gap-tests-v2g8 route-back's 4 RED tests (UT-039/040/041, IT-037).
  Preconditions verified before touching any `src/` file: full suite baseline was 345 pass / 11 fail
  (the 9 forcing reds for this round + the 2 pre-existing documented `IT-015`/`IT-024`
  environment-specific/flaky reds, unchanged since the prior gate). The earlier parallel-round
  coordination items (D-V2I-1..6, IMPL-052..063) were confirmed already integrated and green at
  hand-off — no `06-impl-log.md` duplicate entry written for them, only this new one for the actual
  work done this stage.
- **greens:** UT-039 (3/3), UT-040 (5/5), UT-041 (3/3), IT-037 (2/2)
- **what changed (D-V2G8-1(a), drop bypassPermissions):** `src/gateway/claude-agent-sdk-client.ts`
  — `options.permissionMode` is now `'default'` (was hard-coded `'bypassPermissions'`, which skipped
  every tool-call decision outright). Headless behavior is preserved by the new `canUseTool`
  callback below, which always resolves a decision synchronously — no interactive prompt ever blocks
  a run.
- **what changed (D-V2G8-1(b), curated default tool surface):** `BUILT_IN_CORE_TOOLS` drops
  `'Bash'` (now `['Read','Write']`) — a fully-privileged shell is now an explicit agentType opt-in
  (via its own curated `req.opts.allowedTools`, unchanged/still fully supported), never a silent
  default for every `agent()` call.
- **what changed (D-V2G8-1(d), workspace-boundary enforcement):**
  `src/gateway/claude-agent-sdk-client.ts` — new `isInsideWorkspace(candidate, root)` (a
  `path.resolve` + `root + path.sep`-prefix check, so a sibling dir sharing a string prefix, e.g.
  `/tmp/run-a` vs `/tmp/run-ab`, is never wrongly treated as "inside") and `makeCanUseTool(root)`,
  wired into `_invokeOnce`'s `options.canUseTool`. The callback inspects a tool call's own path
  argument (`input.file_path` for Read/Write, or `options.blockedPath` for a Bash escape) against
  `req.workspace ?? this._config.cwd`, denying anything outside it; every other tool call (no
  path-bearing argument, or no workspace root known at all) is allowed — the tool surface itself is
  already curated separately via `allowedTools`/`tools`.
- **what changed (D-V2G8-1(c), provider key custody):** `src/gateway/litellm-proxy.ts` —
  `_doStart()`'s `spawnImpl('litellm', [...], {...})` call now passes an explicit
  `env: { ...process.env }`, replacing the previous implicit-inheritance-when-omitted default with a
  real, testable custody statement; the agent-facing CLI subprocess's own `buildSubprocessEnv`
  allowlist (D-G8-5) is untouched — the "proxy yes, agent no" split stays exactly as designed.
- **what changed (D-V2G8-2, per-call budget-reservation estimate):** `src/run-guard.ts` —
  `reserve()` now reserves `Math.min(remaining, this.total / 2)` instead of the entire `remaining`
  budget for one call. A burst of concurrent `parallel()` calls can push at most 2 calls' worth of
  reservations through before a 3rd (or later) hits a real `assertBudget()` check against what's
  genuinely left — restoring concurrency for the common (generously-bounded) case while the hard
  ceiling still holds once a budget is tight for real. Verified this doesn't reopen the original v1
  TOCTOU overshoot by re-running `tests/integration/parallel-budget-concurrency.test.ts` (IT-030,
  `D-G8-6`'s own regression guard) standalone — still green.
- **verification:** full suite `npx vitest run` — 96 files / 356 tests, 354 pass / 2 fail, both
  pre-existing and unrelated to this round, unchanged from the prior gate's baseline: `IT-015`
  (`claude-agent-sdk-session.test.ts`, documented environment-specific nested-Claude-Code-host
  interception) and `IT-024` (`in-flight-agent-state.test.ts`, documented ~1-in-6 real-subprocess-IPC
  flake — reran standalone twice, 1 pass / 1 fail, consistent with the documented rate; this test
  never touches `run-guard.ts`/`claude-agent-sdk-client.ts`/`litellm-proxy.ts`, confirmed unrelated).
  `npx tsc --noEmit`: 0 errors. `sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check`:
  239 items, 3 gaps, 0 severe — identical to the pre-existing v2/v3-out-of-scope baseline (REQ-012
  未實作/未驗證, TASK-018 未實作), 0 orphan/broken-link, 0 new gaps introduced.
- **files:** src/gateway/claude-agent-sdk-client.ts, src/gateway/litellm-proxy.ts, src/run-guard.ts
- **commit:** (uncommitted — implementer stage)
- **iter:** v2g8

### IMPL-065 — Gate 6.5+7 v2g8 verification closeout (verifier, standalone invocation)
- **status:** done
- **traces:** DES-016, DES-017, DES-018, DES-019, DES-020, DES-021, DES-022
- **greens:** (regression — all 354 pass, no new greens needed; 2 pre-existing documented fails: IT-015 env test_defect, IT-024 ~1/6 race flake)
- **files:** .sdlc/features/001-remote-workflow-engine/05-tests.md (header count updated), .sdlc/features/001-remote-workflow-engine/state.yaml, .sdlc/features/001-remote-workflow-engine/journal.md
- **commit:** (uncommitted — verifier stage)
- **iter:** v2g8

**Gate 6.5 simplify (QUALITY-ONLY):** reviewed all v2 source modules (scheduler.ts, scheduler-engine.ts,
dashboard.ts, dashboard-page.ts, asset-sync.ts, mcp-probe.ts, and v2 additions to server.ts and
claude-agent-sdk-client.ts) against the Karpathy simplicity-first criteria. Conclusion: the v2 code
is already appropriately minimal — no gratuitous abstraction, no repeated complex patterns worth
extracting, no speculative complexity. The one repeated `argsJson != null ? JSON.parse(r.argsJson) :
undefined` pattern across scheduler.ts is sufficiently compact that extracting a named helper would
add a layer without meaningful readability gain. No code changes made this pass; all v2 tests remain
354/354 pass.

**Gate 7 regression:** full suite `npx vitest run` = 96 files / 356 tests — 354 pass / 2 fail:
- IT-015 (`claude-agent-sdk-session.test.ts`): pre-existing documented environment-specific
  test_defect (nested Claude Code agent host intercepts `query()` before real SDK subprocess runs),
  unchanged and unrelated to any v2g8 change.
- IT-024 (`in-flight-agent-state.test.ts`): pre-existing documented ~1-in-6 real-subprocess-IPC-race
  flake; passes standalone (confirmed by prior rounds); unrelated to the 3 files IMPL-064 touched.

**Exit gate checks:**
- `npx tsc --noEmit`: 0 errors.
- `sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check`: 240 items, 3 gaps (all
  REQ-012/TASK-018 v3 OIDC out-of-scope), 0 severe gaps. Pre-existing baseline, not introduced
  by this round.
- `determinism_check.py src --check`: PASS — production code never reads wall clock/randomness
  directly; all time-seam methods go through the injected Clock.
- Time-travel re-run (`TZ='Pacific/Kiritimati' npx vitest run`): same 2 failures only (IT-015 +
  IT-024), no new time bombs exposed by the timezone shift.
- Seam production-wiring check: all injectable seams have real implementations in the composition
  root — `McpProbe` defaults to `RealMcpProbe()` in `createServer()`; `GatewayClient` wired in
  `main.ts` as `new ClaudeAgentSdkGatewayClient(...)` (default 'sdk' path); `LiteLLMProxyManager`
  created by `main.ts` when `deps.proxyManager` omitted; `queryImpl` unset in `main.ts` (uses real
  SDK `query`); `RealTicker` wired in `createServer()` (scheduler driver loop).
- Real-dependency smoke: SQLite exercised by all integration/e2e/acceptance tests (real on-disk
  files across IT-006/IT-012/IT-031 and e2e); sandbox child process exercised by IT-003 and all
  e2e/acceptance; MCP HTTP exercised by e2e/acceptance. LLM/provider path: accepted gap D-V3 (no
  test credentials in this environment; real-verified at Gate 7.5 rounds 1-6 documented in
  08-validation.md).

**All v2 REQs have green VALs:** REQ-008→VAL-008/VAL-018 green; REQ-009→VAL-009 green;
REQ-010→VAL-010 green; REQ-011→VAL-011 green; REQ-015→VAL-016 green. REQ-012 (v3 OIDC) accepted
out-of-scope. All v1 REQs have green VALs (unchanged from v1 Gate 7 pass).

### IMPL-066 — Gate 6.5+7 v2 verification (orchestrator-dispatched verifier)
- **status:** done
- **traces:** DES-016, DES-017, DES-018, DES-019, DES-020, DES-021, DES-022
- **greens:** (regression — all 354 pass; 2 pre-existing documented fails: IT-015 env test_defect, IT-024 ~1/6 race flake)
- **files:** .sdlc/features/001-remote-workflow-engine/06-impl-log.md, .sdlc/features/001-remote-workflow-engine/state.yaml, .sdlc/features/001-remote-workflow-engine/journal.md
- **commit:** (uncommitted — verifier stage)
- **iter:** v2

**Gate 6.5 simplify (QUALITY-ONLY):** Reviewed all v2 source modules against Karpathy simplicity-first criteria. The
code is already appropriately minimal — no gratuitous abstraction, no repeated complex patterns, no speculative
complexity. Fixed IMPL-065's `traces` field (was unparseable pseudo-reference "all v2 TASK/DES/IMPL items";
changed to real comma-separated upstream IDs `DES-016..DES-022`) — this was a docs-only fix causing a false
"high-severity orphan" gap in trace.py. No `src/` changes made this pass.

**Gate 7 regression:** full suite `npx vitest run` = 96 files / 356 tests — 354 pass / 2 fail:
- IT-015 (`claude-agent-sdk-session.test.ts`): pre-existing documented environment-specific test_defect
  (nested Claude Code agent host intercepts `query()`), unchanged and unrelated to any change this round.
- IT-024 (`in-flight-agent-state.test.ts`): pre-existing documented ~1-in-6 real-subprocess-IPC-race flake;
  passed standalone in prior rounds.

**Exit gate checks (2026-07-04):**
- `npx tsc --noEmit`: 0 errors.
- `sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check`: 241 items, 3 gaps (all
  REQ-012/TASK-018 v3 OIDC out-of-scope, mid/low severity), 0 severe gaps. Pre-existing baseline.
- `determinism_check.py src --check`: PASS.
- Time-travel re-run (`TZ='Pacific/Kiritimati' npx vitest run`): same 2 pre-existing failures only,
  no new time bombs exposed by timezone shift.
- Seam production-wiring: `SystemClock`/`RealMcpProbe`/`RealTicker` wired in `createServer()`;
  `ClaudeAgentSdkGatewayClient`/`LiteLLMProxyManager` wired in `main.ts`'s `composeConfig()`;
  `gateway?.stop?.()` + `ticker.stop()` called in `Server.close()`.
- Real-dependency smoke: SQLite (IT-031/IT-032/e2e), sandbox child process (IT-003/e2e/acceptance),
  MCP HTTP (e2e/acceptance), dashboard (IT-033/VAL-008/VAL-018), scheduler (E2E-004/E2E-005/VAL-016),
  asset sync (IT-034/VAL-009) all exercised by real-process tests. LLM/provider: accepted gap D-V3
  (no test credentials; real-verified at Gate 7.5 rounds 1-6 in 08-validation.md).

**All v2 REQs have green VALs (confirmed):** REQ-008→VAL-008/VAL-018; REQ-009→VAL-009;
REQ-010→VAL-010; REQ-011→VAL-011; REQ-015→VAL-016. REQ-012 v3 OIDC = accepted OOS.
All v1 REQs have unchanged green VALs.

### IMPL-067 — Gate 6 GREEN closeout for gap-tests-v2g8 (D-V2G8-1(a)(b)(c)(d) + D-V2G8-2): confirmed IMPL-064's fixes, closed a real-execution canUseTool-shadowing gap it left open, restored UT-024 regression it had broken
- **status:** done
- **traces:** ARCH-007, ARCH-005, ARCH-002, ARCH-003
- **signature:** picked up mid-stream at IMPL-064's hand-off point (that entry's own claimed fix was
  present in the working tree but uncommitted and had never been checked against a REAL
  `@anthropic-ai/claude-agent-sdk` session, only the mocked unit tests). Confirmed the baseline red
  reds were already green (UT-039 3/3, UT-040 5/5, UT-041 3/3, IT-037 2/2, run-guard/litellm-proxy
  unit suites all green), then found and closed two problems the mocked-only verification had missed:
  **(1)** `allowedTools: curatedTools` still literally contained `'Bash'` in the same array also
  handed to `tools` when an explicit `req.opts.allowedTools`/`config.defaultAllowedTools` opted in —
  fine, correctly tested by UT-039's own test 3 — but the DEFAULT (no opt-in) case's
  `BUILT_IN_CORE_TOOLS = ['Read','Write']` bare entries turned out (confirmed via a real
  `@anthropic-ai/claude-agent-sdk` `query()` smoke run, not just the mocked unit tests) to
  auto-approve those tool calls BEFORE `canUseTool` is ever consulted at all (the SDK's own
  `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` runtime warning documents this) — meaning the D-V2G8-1(d)
  workspace-boundary check IMPL-064 wired was silently bypassed for every real, unopted-in
  Read/Write call, the exact default-path exfiltration vector the review finding named. Verified with
  a real end-to-end repro: an unmocked SDK session issuing `Read` on `/etc/hostname` (outside the
  configured workspace) succeeded and returned the real file content instead of being denied.
  **(2)** My first attempted fix (decorating `BUILT_IN_CORE_TOOLS` entries with a non-matching rule
  suffix to dodge the SDK's bare-entry auto-approve heuristic while keeping `allowedTools` non-empty)
  worked functionally (real-SDK-verified: in-workspace allow, out-of-workspace deny) but broke the
  PRE-EXISTING, still-in-scope `tests/unit/claude-agent-sdk-gateway-allowed-tools.test.ts` (UT-024,
  D-F11) which requires `allowedTools` verbatim-equal the curated set including the exact built-in
  fallback shape — a real regression I caught via the full-suite run, not shipped.
- **fix (superseding the reserve-based approach above, applied instead):** kept `allowedTools`/
  `tools` bare and unchanged (satisfies UT-024 exactly, zero risk to that pre-existing green test)
  and instead wired the SAME `toolUsePreCheck(root, candidate)` boundary decision as BOTH
  `options.canUseTool` (unchanged from IMPL-064, still exercised by UT-040) AND a new
  `options.hooks.PreToolUse` matcher (`makePreToolUseHook`) — the SDK's own documented suggestion
  for gating a call that a bare `allowedTools` entry would otherwise auto-approve
  (`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`'s own warning text: "To gate every tool call, use a
  PreToolUse hook instead"). Belt-and-suspenders: whichever of the two the SDK actually consults for
  a given call, the workspace boundary still holds. Re-verified end-to-end against the real SDK
  after this fix: in-workspace `Read` still succeeds; `/etc/hostname` (outside workspace) is denied
  with `path outside run workspace: /etc/hostname`, surfaced as a `tool_result` with `is_error:true`
  back to the model, not a crash.
- **greens:** UT-039 (3/3), UT-040 (5/5), UT-041 (3/3), IT-037 (2/2), UT-024 (3/3, regression
  confirmed still green after the fix above)
- **verification:** full suite `npx vitest run` — 96 files / 356 tests, 354 pass / 2 fail, both
  confirmed PRE-EXISTING and unrelated by re-running against a clean `git stash` of this round's
  entire diff (both failures reproduce identically on the untouched baseline): `IT-015`
  (`claude-agent-sdk-session.test.ts`, documented environment-specific nested-Claude-Code-host
  interception — this sandbox's own nested-agent hosting intercepts real SDK tool-loop turn counting
  in a way unrelated to any change this round) and `IT-024` (`in-flight-agent-state.test.ts`,
  documented ~1-in-6 real-subprocess-IPC-race flake). `npx tsc --noEmit`: 0 errors.
  `sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check`: 242 items, 3 gaps, 0 severe —
  identical to the pre-existing v2/v3-out-of-scope baseline (REQ-012 未實作/未驗證, TASK-018 未實作),
  0 orphan/broken-link, 0 new gaps introduced by this round.
- **docs:** added a Security Model section (`DEPLOY.md` §1c, README.md "安全模型") documenting the
  actual (not planned) tool-permission/key-custody/workspace-confinement behavior above in
  deployment-facing terms, and a `04-design.md` route-back note under DES-009 (D-V2G8-1) +
  DES-002 (D-V2G8-2, already covered by IMPL-064's code but not yet documented in 04-design.md).
  Fixed a stale `DEPLOY.md` line still claiming the built-in default tool set was
  `["Read","Write","Bash"]` (pre-dated this round's D-V2G8-1(b) fix).
- **files:** src/gateway/claude-agent-sdk-client.ts, DEPLOY.md, README.md,
  .sdlc/features/001-remote-workflow-engine/04-design.md
- **commit:** (uncommitted — implementer stage)
- **iter:** v2g8

## v3 parallel implementation phase (Gate 6 integration closeout)

> IDs below are renumbered from the parallel implementers' own reported labels (some used a
> `IMPL-TASK-0NN`/`IMPL-PAR-TASKNNN` style) to plain `IMPL-0NN` — `trace.py`'s own `ITEM_RE`
> (`[A-Z][A-Z0-9]{1,4}-\d+`, single hyphen + digits only) does not match a compound id like
> `IMPL-TASK-028`; that heading would silently fail to parse as a work item at all (falls through
> to the generic `HEADING_RE` branch, ending the previous item with no new one started) and its
> `greens:`/`traces:` links would be lost. The original label each entry traces back to is noted
> in its own body for continuity.

### IMPL-068 — McpRegistry: SQLite CRUD + probe-gated register + strict-by-name resolveInjected (orig. IMPL-TASK-028)
- **status:** done
- **traces:** TASK-028, DES-024
- **greens:** UT-042
- **files:** src/mcp-registry.ts
- **commit:** (uncommitted working tree)
- **iter:** v3

### IMPL-069 — Pure SecretResolver: resolveConfig (atomic all-or-nothing) + redact + InMemorySecretSource (orig. IMPL-TASK-030)
- **status:** done
- **traces:** TASK-030, DES-025
- **greens:** UT-043
- **files:** src/secret-resolver.ts
- **commit:** (uncommitted working tree)
- **iter:** v3

### IMPL-070 — Pure buildSessionOptions: thinking-policy + curated allowlist + strict MCP/secret-handle-name passthrough + ALIAS_PROFILE_MISSING fail-safe (orig. IMPL-TASK-032)
- **status:** done
- **traces:** TASK-032, DES-026
- **greens:** UT-044
- **files:** src/session-options-builder.ts
- **commit:** (uncommitted working tree)
- **iter:** v3

### IMPL-071 — D-DOS: global AgentSemaphore — injectable createSemaphore(total) with gauge() + FIFO withSlot (orig. IMPL-PAR-TASK035)
- **status:** done
- **traces:** TASK-035, DES-029
- **greens:** UT-046
- **files:** src/agent-semaphore.ts
- **commit:** (uncommitted working tree)
- **iter:** v3

### IMPL-072 — D-PROC: RealCliLifecycle — detached process-group spawn/kill (SIGTERM->SIGKILL escalation) + temp-dir cleanup, injected spawnImpl/killImpl/rmImpl seam (orig. IMPL-PAR-TASK037)
- **status:** done
- **traces:** TASK-037, DES-029
- **greens:** UT-049, IT-040
- **files:** src/cli-lifecycle.ts
- **commit:** (uncommitted working tree)
- **iter:** v3

### IMPL-073 — mcp_provision admin tool + provision-time McpProbe wiring (server.ts dispatch + submission-time MCP-name fail-fast) (orig. IMPL-TASK-029)
- **status:** done
- **traces:** TASK-029, DES-024
- **greens:** IT-038, VAL-020
- **files:** src/server.ts, src/submission-validator.ts
- **commit:** (uncommitted working tree)
- **iter:** v3

### IMPL-074 — Secret source loader (real process.env, RWE_SECRET_ prefix) + realpath-based path-containment predicate (orig. IMPL-TASK-031)
- **status:** done
- **traces:** TASK-031, DES-025, ARCH-016
- **greens:** IT-039
- **files:** src/secret-source.ts, src/path-containment.ts
- **commit:** (uncommitted working tree)
- **iter:** v3

### IMPL-075 — Impure outer timeout race + kill-on-timeout + slot-free-exactly-once + FailureEnvelope (orig. TASK-033)
- **status:** done
- **traces:** TASK-033, DES-027
- **greens:** UT-045
- **files:** src/timeout-race.ts
- **commit:** (uncommitted working tree)
- **iter:** v3

### IMPL-076 — D-BIND: isLoopback fail-closed bind guard predicate (orig. TASK-036)
- **status:** done
- **traces:** TASK-036, DES-029
- **greens:** UT-048
- **files:** src/net-guard.ts
- **commit:** (uncommitted working tree)
- **iter:** v3

### IMPL-077 — Asset-Ingestion Policy: pure classifyAsset (hooks-drop + MCP-config redirect) (orig. IMPL-034)
- **status:** done
- **traces:** TASK-034, DES-028
- **greens:** UT-047
- **files:** src/asset-sync.ts
- **commit:** (uncommitted working tree)
- **iter:** v3

### IMPL-078 — Gate 6 integration: wire classifyAsset into the real asset_push endpoint (REQ-019 route-back)
- **status:** done
- **traces:** TASK-034, DES-028, ARCH-018, REQ-019
- **signature:** deliberately deferred to the integrator (shared-file wiring — server.ts's `asset_push`
  case is a hot spot for parallel-implementer collisions). Classifies BEFORE anything else touches
  disk/network: `hook` → rejected (`excluded[].reason` carries `HOOKS_UNSUPPORTED`, nothing written);
  `mcp-config` → redirected (`redirected:true` + an `excluded[]` entry pointing at `mcp_provision`,
  nothing written under `assetRoot/mcp-config/<name>`); `skill`/other → unchanged materialize path.
  The old TASK-026 `checkMcpConfigTransport` probe-gate call for `mcp-config` no longer runs (that
  kind is redirected before it would ever be reached) — the function itself is left in place
  (`classifyTransport` import too), NOT deleted, since v2's own `VAL-009` "unsupported stdio
  transport" case still passes through the redirect's own `excluded[]` reporting either way; removing
  it isn't required by this change and touching it further would be an unrelated refactor.
- **known regression (test defect, reported not silently fixed):** this wiring is a REQUIRED,
  approved v3 behavior change (DES-028's binding hook-ban / mcp-config-redirect), and it makes TWO
  pre-existing v2 tests genuinely fail because they used `hook`/`mcp-config` as an incidental test
  *vehicle* for an orthogonal concern, predating the v3 rescope:
  1. `tests/acceptance/val-009-asset-sync.test.ts` — "pushing a file with path traversal rejects the
     whole push (partial-push atomicity)" pushes a `hook`-kind asset with a `../` path and asserts
     `r['error']` is defined. `classifyAsset` now rejects EVERY `hook` before the path-traversal
     check is ever reached, so the push returns `{result:{excluded:[...]}}` (no `error` key) instead
     — `stored` still correctly excludes the file (the atomicity invariant itself still holds), only
     the `error`-vs-`excluded` shape assumption for this specific kind is now stale.
  2. `tests/integration/asset-mcp-config-wiring.test.ts` (IT-035) — pins the v2 `D-V2V-1` behavior
     (an accepted `mcp-config` push is threaded into the next `agent()` call's `options.mcpServers`)
     that DES-028's own v3 REQ-009 rescope note (04-design.md, DES-019's "Gate 6 route-back" block)
     explicitly supersedes: `mcp-config` no longer per-run materializes via `asset_push` at all — v3
     replaces this path with `mcp_provision`/`McpRegistry` (IT-038) + the not-yet-wired
     `session-options-builder.ts` (TASK-032) MCP-name passthrough. `IT-035` was never updated when
     DES-028 was written.
  Verified BOTH are caused by this exact wiring, not pre-existing, by reverting only this hunk (kept
  every parallel implementer's other v3 work intact) and re-running: both pass on the unwired
  baseline, both fail only once this wiring lands. See `test_defects` in this round's report for the
  suggested fix (update the two tests, not the code — the code matches the approved DES-028 spec).
- **greens:** IT-041 (3/3), VAL-022 (3/3)
- **files:** src/server.ts
- **commit:** (uncommitted working tree)
- **iter:** v3

### IMPL-079 — Gate 6 integration: wire realpath-based isPathContained into the SDK gateway's own workspace boundary (REQ-018 route-back)
- **status:** done
- **traces:** DES-025, TASK-031, ARCH-016, REQ-018
- **signature:** deliberately deferred to the integrator (shared-file wiring — `claude-agent-sdk-
  client.ts`'s `isInsideWorkspace` is a hot spot for parallel-implementer collisions). Replaced the
  plain `resolve()`/`startsWith()` string-prefix body with a delegate to the already-existing, already
  pure `isPathContained` (IT-039, src/path-containment.ts) — same signature/callers unchanged
  (`toolUsePreCheck`/`canUseTool`/the `PreToolUse` hook all keep working exactly as before for every
  existing case; `isPathContained`'s own realpath-miss fallback preserves the plain-`../`-escape
  denial as a strict subset). Removed the now-orphaned `resolve`/`sep` imports from `node:path`
  (only consumer was the old `isInsideWorkspace` body — the `resolve` identifier still used
  elsewhere in the file is the unrelated local `Promise` executor parameter, not the import).
- **new test written (Gate 6's untested-behavior guard):** added
  `tests/unit/claude-agent-sdk-gateway-symlink-escape.test.ts` (UT-050, registered in `05-tests.md`
  tracing DES-025/TASK-031/ARCH-016) — plants a REAL symlink (`node:fs.symlinkSync`) inside a real
  run workspace pointing OUTSIDE it and asserts the client's own `canUseTool` callback DENIES a Read
  through it; a second case confirms a genuine non-symlinked in-workspace Read still ALLOWS
  (regression floor). Confirmed genuinely red first: with `isInsideWorkspace`'s old plain-`resolve()`
  body temporarily restored, case 1 failed `expected 'allow' to be 'deny'`; green after the wiring.
  UT-040's own pre-existing 5/5 boundary suite re-confirmed green afterward (unweakened).
- **greens:** UT-050 (2/2), UT-040 (5/5, regression floor)
- **files:** src/gateway/claude-agent-sdk-client.ts, tests/unit/claude-agent-sdk-gateway-symlink-escape.test.ts,
  .sdlc/features/001-remote-workflow-engine/05-tests.md
- **commit:** (uncommitted working tree)
- **iter:** v3

### IMPL-080 — workRoot isolation guard (REQ-021, D-V3M-5)
- **traces:** REQ-021, UT-051, TASK-038
- **status:** done
- **iter:** v3
- files: `src/workroot-guard.ts` (pure `assertWorkRootIsolated` + `WorkRootInsideProjectError`), `src/main.ts` (`composeConfig` calls it fail-closed on the resolved workRoot), `rwe.config.json`/`rwe.config.example.json` (workRoot → outside-repo path), `DEPLOY.md` (⭐v3 block item 4).

### IMPL-081 — workspace-artifacts (REQ-022/023)
- **status:** done
- **traces:** DES-032
- files: src/workspace-artifacts.ts, src/mcp-facade.ts (workflow_artifacts recursive, workflow_artifact_get), src/server.ts (tools)
### IMPL-082 — readBody body cap (REQ-024)
- **status:** done
- **traces:** DES-033
- files: src/server.ts
### IMPL-083 — seed-into-workspace (REQ-025)
- **status:** done
- **traces:** DES-034, DES-035
- files: src/workspace-seed.ts, src/types.ts (RunSpec.seed), src/run-manager.ts, src/mcp-facade.ts (workflow_run seed)
### IMPL-084 — workspace retention purge+GC (REQ-026)
- **status:** done
- **traces:** DES-036
- files: src/workspace-gc.ts, src/mcp-facade.ts (workspace_purge), src/server.ts (GC ticker + workspaceTtlMs)
### IMPL-085 — issue_report tool (REQ-027..030)
- **status:** done
- **traces:** TASK-044, DES-037
- **iter:** v5
- files: src/github/issue-reporter.ts (IssueReporter.report + createGithubIssueClient + renderIssueBody + GithubApiError), src/server.ts (issue_report in TOOL_NAMES/TOOL_SPECS, callTool `issueReporter` param + `case 'issue_report'`, createServer default wiring from loadSecretSourceFromEnv + ServerConfig.issueReporter seam, shared ENGINE_VERSION)
- green: tests/unit/issue-reporter.test.ts (9) + tests/integration/issue-report-http.test.ts (4); full suite 535 green.
### IMPL-086 — issue read/reply toolset + dedup + enrichment (REQ-031..036)
- **status:** done
- **traces:** TASK-045, DES-038
- **iter:** v6
- files: src/github/issue-reporter.ts (GithubIssueClient getIssue/listIssues/getComments/createComment/findOpenByFingerprint over shared `ghFetch`; IssueView/IssueSummary/CommentView/IssueListFilter types; IssueReporter getIssue/listIssues/getComments/postComment; `issueFingerprint()` + hidden `rwe-fp` marker dedup in report(); best-effort `runDiagnostics` enrichment; ISSUE_NOT_FOUND/ISSUE_COMMENT_INVALID codes), src/server.ts (issue_get/issue_list/issue_comments/issue_comment in TOOL_NAMES/TOOL_METADATA + callTool cases; facade-backed runDiagnostics wired into the default IssueReporter; `deduped` on issue_report result)
- green: tests/unit/issue-ops.test.ts + tests/integration/issue-ops-http.test.ts (+34); full suite 569 green, tsc clean.

## v7 slice — provider-native routing + OpenRouter + models_list catalog (IMPL-087, IMPL-088)

### IMPL-087 — provider-native SDK routing + openrouter provider/passthrough (REQ-037, REQ-038)
- **status:** done
- **traces:** TASK-046, DES-039
- **iter:** v7
- files: src/gateway/claude-agent-sdk-client.ts (provider-aware `buildSubprocessEnv`: anthropic → real `ANTHROPIC_BASE_URL` + `resolveAnthropicAuth` [api-key→real ANTHROPIC_API_KEY / subscription→CLAUDE_CODE_OAUTH_TOKEN / missing→typed `ANTHROPIC_AUTH_MISSING`, never dummy]; non-anthropic → LiteLLM proxy + dummy; `isPassthroughModel`/`effectiveProvider` leave `openrouter/<id>` RAW/uncloaked so LiteLLM's `openrouter/*` wildcard matches; auth secrets from injected secretSource written ONLY into the subprocess env), src/gateway/client.ts (`openrouter` in the provider union + direct-fetch `openrouter` case using OPENROUTER_API_KEY), src/gateway/litellm-proxy.ts (generated config gains native wildcard `openrouter/*` route reading OPENROUTER_API_KEY), src/submission-validator.ts (`openrouter/<id>` passthrough not falsely `UNKNOWN_ALIAS`), src/main.ts (threads anthropicBaseUrl/anthropicAuth + secretSource into the SDK gateway).
- Gate-7.5 route-back fix: the passthrough model was being rwe-proxy-cloaked, which broke the LiteLLM `openrouter/*` wildcard ("no healthy deployments"); fixed by NOT cloaking passthrough models — real-verified live (`openrouter/nex-agi/nex-n2-pro` → "PONG").
- green: tests/unit/openrouter-provider.test.ts + tests/unit/claude-agent-sdk-provider-aware-env.test.ts; full suite 605 green, tsc clean.

### IMPL-088 — models_list federated model catalog (REQ-039, REQ-040)
- **status:** done
- **traces:** TASK-047, DES-040
- **iter:** v7
- files: src/models/model-catalog.ts (NEW — `ModelEntry` type + `buildCatalog` federating the static openai/anthropic table + live Ollama `/api/tags` + live OpenRouter `/api/v1/models` [tool support from `supported_parameters`] + curated-alias overlay, injectable fetchers, graceful per-source degradation, secret-free; `filterCatalog` AND-filter + limit), src/server.ts (`models_list` in TOOL_NAMES + TOOL_METADATA/schema with all filter params + callTool case; ServerConfig injectable catalog seams).
- green: tests/unit/model-catalog.test.ts + tests/integration/models-list-tool.test.ts; full suite 605 green, tsc clean.

## v8 slice 1 — N-level workflow() composition (IMPL-089)

### IMPL-089 — N-level workflow() composition: depth/cycle/descendant guards + frame-based journal keying + config caps (REQ-041..044)
- **status:** done
- **traces:** TASK-048, DES-041, DES-042
- **iter:** v8
- files: src/run-manager.ts (`RunManagerDeps.maxWorkflowDepth?`/`maxWorkflowDescendants?`; static `RunManager._positiveInt(value,fallback,name)` config-load validator [≤0/non-integer rejected] + `_maxWorkflowDepth` default 4 / `_maxWorkflowDescendants` default 256; `RunEntry` gains `name?`/`descendants`/`nestedFrames:Map<string,number>`/`nestedFrameSeq`, init in both entry constructions + reset in `resume()`; `_newSandbox(runId,workspace,topName?)` seeds the top `onWorkflowRequest` with `depth=1`/`ancestors`/`parentPathKey=''`; new-signature `_handleWorkflowRequest(runId,ref,args,parentPathKey,parentCallSeq,depth,ancestors)` with the 3 ordered guards — `depth>max`→`NESTING_DEPTH_EXCEEDED`, `ancestors.has(name)`→`NESTING_CYCLE`, `++descendants>max`→`DESCENDANT_CAP_EXCEEDED` — then a recursing nested `SandboxHost` [`depth+1`, extended ancestors, `onAgentRequest` namespaced to `frameBase+callSeq`]; additive `_frameBaseFor(entry,pathKey)` + `NESTED_FRAME_STRIDE=1_000_000` replacing the overflowing multiplicative `(parentCallSeq+1)*1e6+n` scheme; `codedError(code,message)` helper), src/server.ts (`ServerConfig.maxWorkflowDepth?`/`maxWorkflowDescendants?` threaded into `new RunManager({...})`), src/main.ts (`composeConfig` forwards both from `FileConfig`), rwe.config.example.json (`"maxWorkflowDepth":4` / `"maxWorkflowDescendants":256`).
- Key finding: the previous multiplicative nested-callSeq scheme overflowed `MAX_SAFE_INTEGER` past ~depth 2 and would corrupt resume replay at depth ≥3 — reworked to the additive per-frame base allocation (deterministic across resume incl. `parallel()` array order); no other behavior changed and no regression.
- green: tests/integration/nested-workflow-n-level.test.ts (7 cases, IT-046) + regression tests/integration/nested-workflow-callseq-resume.test.ts (IT-026) stays green; full suite 615 pass / 139 files, `npx tsc --noEmit` clean.
