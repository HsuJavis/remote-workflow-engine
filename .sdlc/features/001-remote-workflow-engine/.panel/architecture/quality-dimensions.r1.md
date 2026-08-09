---
lens: quality-dimensions
round: 1 (independent proposal)
author: quality-dimensions expert
date: 2026-08-09
---

# Quality-Dimensions Architecture Review — Remote Workflow Engine (v11)

## Project Altitude Classification

This is **both** a conventional distributed system and an AI-agent system.

- **System altitude**: the engine is a self-hosted, persistent MCP Streamable HTTP server
  orchestrating workflow runs, persisting journals, exposing a REST/dashboard surface, managing
  sandboxed child processes, and running scheduled/webhook-triggered jobs.
- **Agent altitude**: every `agent()` call spawns a real AI agent (Claude Agent SDK headless
  session) with tool use, MCP injection, skill loading, and a live LLM backend. The engine itself
  is the environment those agents run in.

Both altitudes are active in every run; the four dimensions below apply both faces simultaneously.

---

## Summary

The engine has a strong functional core (v1–v11 validated), but four cross-cutting quality gaps are
architecturally significant at the design level: (1) no distributed-trace threading across the
four-process boundary (MCP client → Node engine → SDK subprocess → LiteLLM Python → provider),
so a slow call is not pinpointable; (2) the agent harness is Anthropic-SDK-locked — LLM backends
are swappable but the tool-loop runtime is not; (3) the REST HTTP surface has no machine-readable
contract (no OpenAPI spec), raising integration friction for non-MCP callers and making API
evolution risky; (4) no proactive health probing for downstream dependencies (LiteLLM subprocess,
provider endpoints, Ollama), so the engine is only reactive to failures, not preventive.

These are design-level gaps, not implementation bugs; they are the right targets for architecture
decisions.

---

## (1) Observability

### What exists

REQ-007 mandates per-agent records (label / phase / state / model / provider / token usage) plus
full transcript retrieval via `workflow_agent_log`. REQ-047/049 build a live DAG from these
records. REQ-050/051 add phase timestamps and per-agent start/end timing. The journal (`journal.jsonl`)
is the ground truth; SQLite indexes it. The web dashboard (REQ-008/049) gives a browser-facing
view. This is a solid per-run observability layer.

### System gaps

- **No distributed trace ID.** A `workflow_run` MCP call crosses four process boundaries:
  Node.js engine → sandboxed child process (the workflow VM) → Claude Agent SDK subprocess
  (`@anthropic-ai/claude-agent-sdk` CLI) → managed LiteLLM proxy (Python subprocess) → external
  provider. Each boundary is a potential latency source. There is no `traceId`/`spanId` threaded
  through all four to let an operator answer "which hop is slow?" within seconds. Without it,
  diagnosing a 30-second `agent()` call requires correlating four independent logs manually.
- **LiteLLM proxy logs are opaque to the engine.** The Python subprocess writes its own logs, but
  there is no architecture decision on whether those logs are captured into the engine's
  observability layer (forwarded to the journal or a structured sink) or silently dropped. A
  provider-side 429 rate-limit or a connection reset would appear to the engine as a `null` result
  with no visibility into why.
- **No structured log levels or configurable sinks.** The architecture does not specify how
  operational log events (engine startup, run lifecycle transitions, SDK subprocess launch/exit,
  LiteLLM spawn) are structured or routed. Absence of a defined `logger` interface means each
  implementation team member picks their own, producing inconsistent, hard-to-grep output in
  production.
- **No health/liveness endpoint specified.** D7 mandates a web dashboard, but no `GET /health`
  liveness probe is in scope. A watchdog (systemd, Docker healthcheck, load balancer) needs a
  machine-readable liveness surface.

### Agent gaps

- **SDK subprocess is a black box for mid-flight observation.** The `ClaudeAgentSdkGatewayClient`
  spawns the SDK CLI and reads its terminal output. There is no defined protocol for forwarding
  the SDK's internal streaming events (tool-call decisions, partial outputs, token counts) back to
  the engine's journal in real time. Mid-flight agent state is therefore invisible until the
  subprocess exits; this is an opacity seam for agents that take minutes to complete.
- **Per-agent chain-of-thought is not preserved in the architecture.** `workflow_agent_log`
  returns the "full message/tool-call transcript", but the architecture does not define whether
  this includes the SDK's internal reasoning/thinking traces. For non-Anthropic models where
  thinking is explicitly disabled (D-F6 / REQ-016), this is a non-issue; for Anthropic models it
  is an open question.

### Key design decisions needed

1. Define a `TraceContext { traceId, spanId }` propagated through all four process boundaries
   (inject into SDK subprocess as env var; inject into LiteLLM as a request header).
2. Capture LiteLLM subprocess stderr into the engine journal at log level `debug` (pipe
   `STDERR` → a bounded ring buffer → append to the run's journal on completion or timeout).
3. Specify a `Logger` interface with levels and a configurable sink (default: structured JSON to
   stdout, optionally a file). Gate: no `console.log` in production paths.
4. Add `GET /health` returning `{ status:"ok"|"degraded", version, uptime, liveRuns }`.

---

## (2) Replaceability

### What exists

The architecture defines two `GatewayClient` implementations (`LiteLLMGatewayClient` /
`ClaudeAgentSdkGatewayClient`) behind a common interface, switchable via `"gateway":"sdk"|"direct-fetch"`
in config. Model aliases map logical names (e.g. `haiku`, `default`) to provider+model, so
workflows are decoupled from provider specifics. LiteLLM abstracts provider HTTP APIs for the
non-Anthropic path. These are the right replaceability seams at the LLM-call level.

### System gaps

- **Persistence layer has no interface.** `RunStore` (SQLite + `journal.jsonl`) and
  `WorkflowCatalog` (SQLite) are concrete implementations with no abstract port/interface.
  Swapping SQLite for PostgreSQL (for multi-instance deployment) or replacing the journal format
  would require touching every consumer of those classes. At v11 scale (683 tests, 156 files),
  this is a non-trivial refactor.
- **MCP server is hand-rolled without a protocol SDK.** Tech_stack explicitly notes this as
  "drift" from the Gate 2/3 sketch. If the MCP protocol evolves (new session lifecycle methods,
  capability negotiation changes), the hand-rolled server must be updated manually with no SDK
  upgrade path. This is vendor-neutral but protocol-locked.
- **LiteLLM is a runtime transitive dependency, not an abstract gateway interface.** LiteLLM is
  a real external Python project; if it is abandoned or breaks its proxy API, the entire
  non-Anthropic path fails. The `LiteLLMGatewayClient` should have its Python management (spawn,
  healthcheck, restart) behind a `ProxyManager` interface so it can be replaced by, e.g.,
  LM Studio or a native Ollama SDK without restructuring the gateway.

### Agent gaps

- **The agent harness runtime is Anthropic-SDK-locked.** The Claude Agent SDK controls the tool
  loop, MCP session, skill injection, and agent output. For non-Anthropic models, this is
  mitigated by routing LLM calls through LiteLLM, but the harness mechanics (how tools are
  presented, how tool results are incorporated, how `strictMcpConfig` is passed) are SDK-internal
  behaviors. No interface abstraction exists above `sdk.query()`. Migrating to an OpenAI
  Assistants harness, LangGraph, or a local harness (e.g., for environments where the SDK CLI
  is unavailable) would require replacing `ClaudeAgentSdkGatewayClient` wholesale with no
  interface contract to guide the replacement.
- **Skill/asset materialization is coupled to the SDK's `.claude/` path conventions.** The
  workspace `.claude/skills/<name>/` layout is an SDK convention. If the SDK changes its
  skill-loading path, the materializer breaks silently (skills are present on disk but not loaded
  by the agent). There is no indirection layer between the abstract "skill" concept and the
  SDK's specific filesystem expectation.

### Key design decisions needed

1. Define `RunStorePort` and `CatalogPort` TypeScript interfaces; have the SQLite classes
   implement them. This costs ~1 hour now and avoids a weeks-long refactor at scale-out time.
2. Define `ProxyManagerPort` (start, healthcheck, stop) wrapping the LiteLLM subprocess
   lifecycle, so an alternative proxy implementation (e.g., native Ollama client) satisfies
   the same interface.
3. Document the SDK coupling explicitly as an accepted architectural risk in `02-architecture.md`,
   with a migration trigger condition (e.g., "if SDK drops non-Anthropic LiteLLM routing support,
   switch to a standalone harness implementing AgentHarnessPort").
4. Pin the `.claude/` skill path to a named constant injected into the materializer, so a
   path change requires a one-line update, not a grep-and-replace.

---

## (3) Consumability

### What exists

The primary integration surface is the MCP Streamable HTTP interface, which is a standard
protocol — callers integrate via any MCP-compatible client. REQ-005 specifies the tool list
(`workflow_run`, `workflow_status`, `workflow_result`, etc.). REQ-039/040 add a `models_list` tool
for model discovery. REQ-062 adds `workflow_get.skeleton` so callers can inspect a workflow's
shape before running it. The workflow JS DSL (`agent()`, `phase()`, `pipeline()`, `parallel()`) is
a clean, typed API surface for workflow authors. The client plugin (REQ-010) reduces the
integration cost for Claude Code users to a single install step.

### System gaps

- **No machine-readable contract for the REST/HTTP surface.** The `/api/*` routes (runs, agents,
  workflows, issues, version, health) are not covered by an OpenAPI/Swagger specification. A
  caller building a dashboard or CI integration against the HTTP API must read source code to
  understand endpoint shapes, error codes, and query parameters. This is a high integration cost
  for non-MCP consumers.
- **Async polling model without push.** `workflow_run` returns a `runId` immediately; callers
  must poll `workflow_status` / `workflow_result` to know when a run completes. SSE is explicitly
  deferred. For a caller running a blocking workflow (a human operator at a terminal), this means
  writing their own poll loop. The architecture should define a polling recommendation (backoff
  interval, max-wait), or designate SSE as a v12 gate-item rather than an indefinitely deferred
  gap.
- **Error envelope is informally defined.** Error codes (`WORKFLOW_NOT_FOUND`, `MISSING_BLOBS`,
  `RUN_ADMISSION_LIMIT`, etc.) are mentioned in individual REQs but there is no single canonical
  error-code registry in the architecture. Callers cannot enumerate all possible error codes or
  write exhaustive error handlers without reading requirements one by one.
- **No versioning strategy for the MCP tool API.** Adding a new required parameter to
  `workflow_run`, or removing a tool from the list, is a breaking change for connected clients.
  No version negotiation mechanism or deprecation policy is defined.

### Agent gaps

- **Agent I/O typing is per-call, not schema-first.** The `schema` option to `agent()` enables
  JSON Schema validation of agent output, which is the right mechanism. But there is no central
  schema registry or type library a workflow author can import to use well-known output shapes
  (e.g., `IssueReport`, `SearchResult`). Every workflow defines its schema inline, making reuse
  and cross-workflow type checking manual.
- **No SDK for non-MCP callers to invoke the engine programmatically.** The engine exposes MCP
  and HTTP, but a Node.js caller who wants to embed the engine (e.g., in a CI pipeline script)
  must either speak MCP JSON-RPC or call raw HTTP. A thin `RemoteWorkflowClient` TypeScript class
  wrapping the HTTP API with typed methods would reduce integration cost to a `npm install` + 3
  lines of code.

### Key design decisions needed

1. Generate an OpenAPI 3.1 spec from the HTTP routes (use `zod-to-openapi` or a similar tool;
   the existing Zod schemas on input/output already provide the type information). Publish at
   `GET /openapi.json`.
2. Define a canonical error code registry in the architecture document: a flat TypeScript `const`
   enum of all error codes, their HTTP status mappings, and retry-eligibility.
3. Define a polling recommendation for `workflow_result`: exponential backoff from 1s to 5s,
   max wait configurable, or a synchronous block option for short runs.
4. Adopt a tool-API versioning strategy: a `version` capability in the MCP initialize response,
   and a backwards-compatible "add optional params only" policy for minor changes.

---

## (4) Self-Sustainability

### What exists

The engine has significant self-sustainability features already:

- **Run lifecycle resilience**: REQ-059/060 (crash-resume), REQ-052/053 (onTerminal + durable
  continuation chaining), REQ-054 (admission counter / DoS gate), REQ-026 (workspace TTL GC).
- **DoS defenses**: REQ-024 (413 body cap), REQ-063 (gzip bomb cap), REQ-056 (Host/Origin
  allowlist), REQ-057/058 (HMAC-verified webhooks).
- **Self-update**: REQ-068..070 (GitHub tag webhook → privilege-separated updater → automatic
  apply with safe-fail), currently v11 draft — the architectural decision to keep the engine
  unprivileged (writes a flag; systemd unit does the actual git/build/restart) is the right
  privilege separation.
- **Execution modes**: cron, one-shot timed, resident user-triggered (REQ-015) reduce the need
  for human initiation of scheduled operations.
- **Context isolation**: REQ-021 (fail-fast at boot if workRoot is inside a project) prevents
  silent memory leaks into agent context — a self-protection invariant at startup.

### System gaps

- **No proactive health probing for downstream dependencies.** The engine discovers that LiteLLM
  is down only when an `agent()` call fails (reactive). There is no periodic probe that checks
  "is LiteLLM alive?" or "is the Ollama endpoint reachable?" before admitting a run that would
  require them. A run that sits in the queue for 60 seconds before discovering its only provider
  is down wastes concurrency slots and leaves the user confused.
- **No circuit-breaker at the provider level.** REQ-004 mandates a "D-G minimal circuit breaker"
  for provider timeouts. However, the architecture does not specify whether this is a true
  circuit-breaker (open/half-open/closed states with a failure threshold) or simply a
  per-call timeout. Without a real circuit-breaker, a provider that is flaking (slow, not fully
  down) will cause every `agent()` call to wait out its full timeout before resolving to `null`.
- **Journal/SQLite growth is unbounded.** There is no defined archival policy for old run
  journals. REQ-026 purges workspaces on TTL, but `journal.jsonl` files and SQLite run records
  accumulate indefinitely. A long-lived production engine running thousands of workflows per day
  will eventually exhaust disk or degrade SQLite query performance without an archival strategy.
- **No memory/disk metric surfacing.** The admission counter (REQ-054) bounds live run count, but
  there is no feedback loop from disk usage (workspace + journal size) or memory usage back to
  the engine's admission control. An operator has no in-engine signal that disk is filling up.

### Agent gaps

- **No journal compression or memory metabolism for long-running agents.** An `agent()` session
  running many tool-call rounds produces a large transcript. The journal records all of it
  indefinitely. There is no periodic compression or selective archival (e.g., "keep the last N
  tool calls in hot storage, archive the rest"). This means a workflow that runs thousands of
  agent calls (a long multi-day autonomous pipeline) will bloat the journal until disk runs out.
- **No tool-liveness probe before agent dispatch.** If a provisioned MCP server (REQ-017) is
  configured but its process is not running, the agent discovers this only during the tool-call
  round, deep inside an active SDK session. A pre-flight probe that checks MCP server reachability
  before creating the SDK session would fail fast with a clear `MCP_UNREACHABLE` error instead of
  spending tokens on a session that can only fail.
- **Budget tracking across crash-resume is not architecturally defined.** REQ-059 re-populates
  the `ResumeCache` from the journal, which covers result replay. But `budget.spent()` accounting
  after a crash-resume is not explicitly addressed in the requirements or architecture: is the
  token tally reconstructed from the journaled agent records, or does it start from zero? If from
  zero, a resumed run can exceed its budget by a full `spent()` amount before the guard fires.
- **No self-reflection or prompt calibration.** The system cannot detect that a model alias is
  producing lower-quality results (e.g., schema validation failures are increasing) and adjust
  routing. This is expected at v11 but should be noted as a self-sustainability ceiling for
  long-term autonomous operation.

### Key design decisions needed

1. Define a `DependencyProbe` service (checked at boot and before each run start for required
   providers): probes LiteLLM proxy health (`GET /health`) and, if configured, Ollama
   (`GET /api/tags`). Failures surface as `DEPENDENCY_UNAVAILABLE` in admission, not mid-run.
2. Upgrade the per-provider failure handling to a named circuit-breaker pattern with explicit
   states (`closed / open / half-open`) and a configurable failure threshold (e.g., 3 timeouts
   in 60 seconds → open for 120 seconds). Document this explicitly in the architecture.
3. Define a journal archival policy: runs older than a configurable TTL (default: 30 days) are
   compacted (token-level detail dropped, result kept) or moved to a cold archive path. Pair with
   a disk-usage metric exposed on `GET /health`.
4. Define budget-reconstruction semantics on crash-resume explicitly: `budget.spent()` after
   resume MUST be re-derived from the sum of token counts in the journaled agent records, not
   reset to zero. This should be a unit-test fixture in the v11 test suite.

---

## Risks

| # | Dimension | Risk | Severity |
|---|-----------|------|----------|
| R1 | Observability | Four-process boundary with no trace ID: a slow `agent()` call is undiagnosable in production | High |
| R2 | Observability | LiteLLM stderr swallowed by the engine: provider errors appear as opaque `null` results | High |
| R3 | Replaceability | Claude Agent SDK controls the tool-loop runtime: migrating to any other harness is a full rewrite of `ClaudeAgentSdkGatewayClient` with no interface contract | High |
| R4 | Replaceability | No `RunStorePort`/`CatalogPort` interface: adding multi-instance or PostgreSQL support requires pervasive refactor | Medium |
| R5 | Consumability | No OpenAPI spec for `/api/*`: HTTP callers must reverse-engineer the contract from source code | Medium |
| R6 | Consumability | No MCP tool API versioning: a required-param addition is a silent breaking change for all connected clients | Medium |
| R7 | Self-sustainability | No proactive dependency probe: a downed LiteLLM/Ollama is discovered mid-run, wasting slots and confusing users | High |
| R8 | Self-sustainability | Journal growth unbounded: long-lived engine will degrade or exhaust disk without archival | Medium |
| R9 | Self-sustainability | Budget accounting after crash-resume is architecturally unspecified: possible budget overrun by a full `spent()` amount | High |
| R10 | Observability | No `GET /health` endpoint: systemd/Docker/load-balancer cannot probe engine liveness | Low |

---

## Expected Disagreements with Other Lenses

- **Security lens** will likely prioritize REQ-068/069 (self-update HMAC verification, privilege
  separation) as a security risk, while this lens sees it primarily as a self-sustainability
  feature. The privilege-separation design (engine writes a flag, systemd unit acts) is already
  correct from a self-sustainability standpoint; the security lens may want additional controls
  on the flag content and the systemd unit's git-remote allowlist.

- **Performance / scalability lens** may challenge the single-SQLite persistence design as a
  scalability bottleneck (especially `journal.jsonl` fan-out under many concurrent runs). This
  lens agrees SQLite is a risk but frames it as a **replaceability** concern (no `RunStorePort`
  interface makes swapping it expensive), not just a throughput concern.

- **Security lens** and this lens agree on the `workRoot` isolation invariant (REQ-021) but may
  disagree on whether the fail-fast-at-boot check is sufficient or whether a runtime re-check
  is needed (this lens: boot check is sufficient for the current single-process model).

- **Cost/simplicity lens** may argue that OpenAPI generation and a `RunStorePort` interface add
  complexity without immediate user value. This lens's counter: the integration cost (R5) is paid
  by every future MCP-alternative caller, not by the current team; the interface cost (R4) is
  paid once now or many times later.

- **Extensibility lens** will likely echo the replaceability concerns here (SDK harness lock-in,
  SQLite lock-in) and may propose a plugin architecture for GatewayClients. This lens is
  aligned: a formal `AgentHarnessPort` interface is the right direction; the disagreement is
  likely in how far to abstract (full plugin vs. two-implementation interface).
