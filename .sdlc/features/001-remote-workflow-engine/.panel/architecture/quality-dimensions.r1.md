---
lens: quality-dimensions
round: 1 (independent proposal)
date: 2026-08-15
iteration: v13
feature: 001-remote-workflow-engine
---

# Architecture Review — Quality Dimensions (R1)

## Project classification

This system operates at TWO altitudes simultaneously:

**System altitude** — a conventional Node.js / TypeScript service: hand-rolled MCP Streamable HTTP
server, SQLite persistence, cron scheduler, file-system journal, LiteLLM Python subprocess, process-
level sandbox runner, web dashboard.

**Agent altitude** — a multi-agent orchestration runtime: each `agent()` call spawns a real LLM
session via the Claude Agent SDK (`ClaudeAgentSdkGatewayClient`), with tool injection, MCP
provisioning, model-alias routing, concurrent budget tracking, and per-agent transcript capture.

Both altitudes are weight-bearing. All four dimensions are reviewed at both, explicitly.

---

## 1. Observability

### System altitude

**What is in place (strong)**

- Per-run `journal.jsonl` records every settled `agent()`/`workflow()` call with input/output — a
  durable trace of the script execution path.
- SQLite index enables listing, filtering, and run-status queries without re-scanning journals.
- `workflow_status` exposes per-phase timelines and per-agent state; `workflow_agent_log` returns the
  full message/tool-call transcript.
- `GET /api/system` + `system_info` MCP tool (v12) expose host CPU/memory/disk and process stats —
  a good operational signal tier.
- Run timing (`startedAt`/`endedAt` on agents and phases) and per-agent token accounting are fully
  surfaced through the MCP query layer.

**Gaps and risks**

1. **No end-to-end trace ID.** An MCP client call to `workflow_run` forks into: RunManager → sandbox
   child process → `ClaudeAgentSdkGatewayClient` → `claude` CLI subprocess → LiteLLM proxy → LLM
   provider. No structured trace ID is threaded across these five hops. When the CLI subprocess
   crashes or the LiteLLM proxy returns an unexpected error, the only observable is the terminal
   agent record; the path to the failure is not reconstructable without reading logs from three
   separate processes.

2. **Sandbox child stdout is ephemeral.** The workflow sandbox is a child process. Its stdout/stderr
   is the primary runtime signal. There is no mention of structured capture to a per-run log file
   that survives the child's exit. If the child exits non-zero before writing its terminal journal
   entry, the failure reason may be lost.

3. **Journal is file-based and non-queryable in aggregate.** Aggregate observability ("all runs in
   the last hour that hit a token budget limit", "all agent calls that resolved to null") requires
   SQLite index entries for those fields. The current acceptance criteria do not enumerate which
   events are indexed, making it unclear whether structured aggregate queries are possible without
   scanning journals.

4. **seedRef network fetch (v13) has no observable latency/size record.** REQ-080 adds an outbound
   HTTP fetch (repo pull). There is no accepted requirement that the fetch latency, bytes transferred,
   or the resolved commit SHA are written to the run's observable record. A slow or silently-wrong
   fetch would be invisible to the operator.

5. **Dashboard uses 3-second poll; SSE explicitly deferred.** For a running multi-agent workflow
   (dozens of `agent()` calls), the dashboard state can be up to 3 seconds stale. This is documented
   as a conscious deferral but is noted as a quality risk for operational use during active debug.

### Agent altitude

**What is in place (strong)**

- `workflow_agent_log` returns the full message/tool-call sequence per agent — the agent's chain-of-
  thought is not a black box.
- `AgentRecord` carries actual model+provider used, token usage, `startedAt`/`endedAt`, phase, and
  frame — sufficient to reconstruct the execution path for a completed run.
- The harness detail panel (REQ-073) exposes the tool list, skill list, and prompt injected into
  each session — session construction is inspectable.

**Gaps and risks**

6. **Session-init context is not audited at runtime.** REQ-021 adds a boot-time check for
   `WORKROOT_INSIDE_PROJECT`. However, what CLAUDE.md files and memory files were actually loaded
   into an agent session is only observable by reading the agent transcript — there is no structured
   session-init audit record (distinct from the transcript) that names the resolved project root,
   the CLAUDE.md files found, and the `settingSources` used. A silent workRoot misconfiguration that
   passes the boot check could still leak operator context in edge cases (e.g., a symlinked workRoot
   that resolves inside a project). Without a structured audit record, this is invisible.

7. **MCP provisioning resolution is not traced per run.** When a workflow references an MCP server
   by name (REQ-017), the engine resolves it from the server-side registry and injects it into the
   SDK session. Whether the MCP server connected successfully, how many tools it exposed, and which
   were actually available to the model is not explicitly part of the run's observable record.

**Verdict**: Strong agent-level transcript observability. The system-level trace gaps (no trace ID,
ephemeral child stdout, non-queryable journal aggregates) are the primary concerns. The seam between
the engine and its subprocess chain is opaque.

---

## 2. Replaceability

### System altitude

**What is in place (strong)**

- `GatewayClient` interface: two concrete implementations (`LiteLLMGatewayClient`,
  `ClaudeAgentSdkGatewayClient`), selected by config (`"gateway":"sdk"|"direct-fetch"`). Swapping
  the gateway path is a config change. This is the most visible pluggability seam.
- LiteLLM proxy is a managed subprocess — replacing it with a different OpenAI-compat proxy (e.g.
  LiteLLM v2, Portkey, a local proxy) requires only changing the subprocess command and the URL
  injected as `ANTHROPIC_BASE_URL`. No application code change.
- The model-alias config layer (`model → provider/real-model`) is fully externalised in config,
  making provider-level substitution a config-file edit.

**Gaps and risks**

8. **RunStore and WorkflowCatalog have no formal port/interface.** Both use `better-sqlite3`
   directly (confirmed in tech_stack). There is no `RunStorePort` or `CatalogPort` interface that
   would let a future deployment substitute a different persistence backend (PostgreSQL, DynamoDB,
   an external store for multi-node scale-out). State.yaml notes "RunStorePort ... deferred as
   future-REQ candidates" — but the absence of even a thin interface today creates a deeper coupling
   that grows harder to extract with each added query shape.

9. **Hand-rolled MCP server (vs official SDK) creates a protocol-drift maintenance burden.** The
   `@modelcontextprotocol/sdk` was explicitly NOT used; the server is hand-rolled JSON-RPC-over-HTTP.
   If the MCP protocol evolves (new negotiation fields, auth handshake changes, capability
   advertising), the hand-rolled impl must track those changes manually. Replaceability with an
   upstream-maintained SDK is blocked until a refactor of `src/server.ts`.

10. **CasStore is a concrete implementation without an abstraction seam.** The content-addressed
    blob store (v10) added `CasStore` as a direct concrete class. For multi-node deployments or
    cloud object-store backends (S3-compatible), this would need an interface-first refactor.

### Agent altitude

**What is in place (strong)**

- Model alias routing means switching an alias from `anthropic/claude-opus-4` to `openai/gpt-4o` or
  `ollama/qwen2.5:7b` is a single config line. The workflow script does not encode provider names.
- The `ClaudeAgentSdkGatewayClient` uses the `ANTHROPIC_BASE_URL` override trick so non-Anthropic
  models run through the same SDK entry-point — this sidesteps a provider-per-client proliferation.

**Gaps and risks**

11. **`ClaudeAgentSdkGatewayClient` has an implicit structural coupling to the Anthropic SDK.**
    The agent runtime is the Claude Agent SDK's `query()` API. This is not behind a generic
    "AgentRunnerPort" — it IS the implementation. If Anthropic breaks `query()` semantics, changes
    the `ANTHROPIC_BASE_URL` override behavior, or if this system needs to support a non-SDK agent
    runner (e.g., a LangGraph harness, an OpenAI Assistants runner), a new gateway client class
    must be written and the entire harness initialization path (tools injection, MCP resolution,
    thinking-disabled flag, curated surface) must be replicated. The two-gateway design is good; the
    fact that only one of them has the full harness path (the SDK client) is the replication risk.

12. **Curated tool allowlist is code-embedded, not config-driven.** REQ-016 requires that non-
    Anthropic models see only the curated tool surface. This allowlist appears to be a code constant.
    Changing it (adding a new tool, tuning the surface for a new model class) requires a code change
    and redeploy, not a config change.

**Verdict**: Gateway-level replaceability is well-designed. Persistence and protocol layers lack
interface abstractions. The SDK coupling at the agent execution layer is the highest-risk
replaceability gap — it is load-bearing and deep.

---

## 3. Consumability

### System altitude

**What is in place (strong)**

- MCP Streamable HTTP is a standard protocol; any MCP client connects without custom SDK.
- Tool schema precision (REQ-079) mandates self-describing parameter docs with units, defaults,
  allowed values, and effect statements — good for schema-only consumers.
- Typed error envelopes (code, field, hint) across all tools enable structured error handling by
  callers.
- The 37-tool surface covers the full workflow lifecycle: run, status, result, suspend, resume, stop,
  list, register, trigger, chain, schedule, webhook, asset, blob, system, models.

**Gaps and risks**

13. **No OpenAPI/Swagger spec for the `/api/*` REST endpoints.** The web dashboard and any third-
    party HTTP integrator must reverse-engineer `src/server.ts` to learn the shape of
    `GET /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/dag`, `GET /api/system`, etc. The MCP
    `tools/list` covers the MCP surface; the REST surface is undocumented.

14. **37 tools with no namespace or grouping strategy.** As the tool count grew (each slice adds
    2–4 tools), the flat `tools/list` namespace becomes harder to navigate. An MCP client or an
    agent writing a workflow must scan all 37 to discover relevant tools. There is no grouping
    (lifecycle / observability / scheduling / assets / provisioning / github / system) visible in
    the schema.

15. **The guidance skill (REQ-010) is the primary integration onboarding path, but its scope is
    narrow.** It teaches "when to use remote vs local Workflow tool" but does not teach a caller how
    to compose the 37-tool surface (e.g., the blob_put → seed_plan → workflow_run CAS seeding
    sequence is a 3-step protocol with its own invariants). A caller discovering the system for the
    first time via MCP must learn the multi-step protocols from trial-and-error.

16. **seedRef (v13) adds a new protocol variant not reflected in the consumability surface.**
    REQ-080 introduces `workflow_run({seedRef:{repoUrl,sha}})` as a mutually-exclusive alternative
    to `seed`/`seedManifest`. The error `SEED_SOURCE_CONFLICT` is correct, but the tool description
    must make the mutual-exclusion rule and the egress allowlist requirement explicit — otherwise
    callers will invoke `seedRef` without configuring the allowlist and receive a non-actionable
    `SEEDREF_DISABLED` error.

### Agent altitude

**What is in place (strong)**

- The workflow JS API (`phase`, `agent`, `pipeline`, `parallel`, `budget`, `args`) is fully
  documented via the dynamic-workflow-compat-spec (100% compat target). A Claude-generated workflow
  script runs unmodified — zero integration cost from the script author's perspective.
- `workflow_get` (REQ-061) and the skeleton endpoint (REQ-062) let an agent discover a registered
  workflow's shape before invoking it — reducing the caller's guesswork.
- `models_list` with filtering (REQ-039/040) and enrichment (REQ-078) lets a caller discover what
  model aliases are available and their capability/cost profile before writing a workflow.

**Gaps and risks**

17. **Agent-facing errors at harness-init time (missing MCP, missing secret, workRoot violation) are
    not structured for programmatic recovery.** REQ-018's missing-secret error and REQ-017's unknown-
    MCP-name error are typed at submission time, but errors that emerge during SDK session
    initialization (e.g., an MCP server that fails to connect) surface as agent-record failures, not
    as submission-time typed rejections. A caller cannot distinguish "the MCP server was never
    reachable" from "the model rejected the tool call" without reading the transcript.

**Verdict**: MCP-surface consumability is strong. The REST API is a dark surface. The 37-tool flat
namespace and the absence of protocol-level documentation for multi-step patterns (CAS seeding,
seedRef deployment) create non-trivial integration cost for new callers.

---

## 4. Self-sustainability

### System altitude

**What is in place (strong)**

- Run-admission counter `maxConcurrentRuns` (REQ-054): bounds sandbox fork rate and workspace
  materialization cost — a hard DoS chokepoint that the global agent semaphore does not provide.
- Body-size cap + typed 413 (REQ-024, REQ-063): defends against body-size DoS including gzip
  bombs (decompressed-output cap, not just compressed-input cap).
- Host/Origin allowlist (REQ-056): CSRF and DNS-rebinding defense at the HTTP boundary.
- Crash durability (REQ-059/060): `hydrateAll` reclassifies interrupted runs as resumable; journal
  replay replays already-settled calls — the engine self-recovers from a crash without data loss.
- Tag-triggered self-update (REQ-068-070): privilege-separated (engine writes flag only; systemd
  path-unit does git/npm/restart); safe-fail (bad build never leaves service down). This is the
  most complete self-sustainability feature in the system.
- Workspace TTL GC (REQ-026): opt-in, passive cleanup of terminal run workspaces.
- The LiteLLM proxy timeout+retry per REQ-004/020 bounds hung provider calls — `agent()` resolves
  to null on provider failure, run continues.

**Gaps and risks**

18. **No stateful circuit-breaker for LLM providers.** The current bounded timeout + retry per
    REQ-004/020 is described as a "D-G minimal circuit breaker." It is per-call: each new `agent()`
    call retries a failing provider independently. There is no circuit-breaker STATE (closed →
    open → half-open) that prevents a cascade of `parallel()` agent calls from all hammering a
    transiently-down provider simultaneously. Under a flapping provider, a `parallel([a,b,c,d,e])`
    call will attempt five independent timeout-bounded retries in parallel, consuming the full retry
    window five times over before all five resolve to null.

19. **No GET /health for systemd watchdog / load balancer.** State.yaml notes GET /health as
    "deferred." Without it, the systemd unit's `WatchdogSec` or a reverse-proxy health check cannot
    distinguish a responsive engine from a hung one (e.g., a deadlocked RunManager or a blocked
    SQLite write). The self-update safe-fail behavior relies on systemctl — if the process is live
    but internally hung, systemd will not restart it.

20. **seedRef fetch (v13) adds an unbounded-latency network egress path without explicit timeout.**
    REQ-080 specifies SSRF guards and egress allowlist but does not carry a `timeoutMs` for the repo
    fetch. A slow or stalled git/HTTP response on a large repo would block the run-start path for the
    duration of the fetch, potentially consuming an admission slot and blocking the caller. The same
    bounded-timeout commitment that applies to LLM gateway calls must apply here.

21. **Journal files grow unboundedly per run with no compaction.** Each `agent()` call appends to
    `journal.jsonl`. A long-running resident workflow (REQ-015, triggered repeatedly) accumulates
    call entries across all runs in a single per-workflow path. For workflows with hundreds of agent
    calls and large output schemas, this file will grow to problematic size. No archival or rotation
    policy is specified.

22. **MCP server provisioning liveness is not checked before run start.** A provisioned MCP server
    (REQ-017) that becomes unreachable between provisioning time and run time is only detected when
    the SDK session attempts to connect mid-run. A pre-run liveness probe (even a simple TCP
    connect) would allow `workflow_run` to fail fast with a typed error before spawning the sandbox,
    improving self-correcting behavior.

### Agent altitude

**What is in place (strong)**

- Agent calls are session-scoped (each `agent()` is a headless SDK session); there is no long-lived
  agent context that can blow up. The per-call token budget and the run-level token cap prevent
  runaway spending.
- The workRoot boot check (REQ-021) is a self-protection mechanism — the engine refuses to start in
  a configuration that would leak operator context to agent sessions.
- The tool allowlist curated for non-Anthropic models (REQ-016) prevents model degradation from
  an overwhelming tool surface — a form of self-adaptation for smaller models.

**Gaps and risks**

23. **No tool-liveness probe for provisioned MCP servers before session init.** As noted above: a
    dead MCP server is discovered at session-init time (mid-run), not at workflow-submission time.
    The agent session logs the failure, but the run may have already consumed significant work
    (workspace seeding, prior agents) before the dead MCP is discovered on the agent call that first
    needed it.

24. **No prompt-calibration or self-reflection path for failed agent sessions.** When `agent()`
    resolves to null (REQ-003 terminal-error semantics), the workflow script continues. There is no
    built-in retry-with-modified-prompt or schema-mismatch-retry at the workflow level (schema
    mismatch retry is within the SDK path, not the workflow level). A workflow whose agent strategy
    is systematically failing (e.g., the chosen model cannot produce tool calls for this prompt) will
    produce null results silently through all agent calls, completing the run with a null-filled
    output — no alarm, no escalation.

25. **Memory metabolism for long-running resident workflows is unaddressed.** A resident workflow
    (REQ-015) that is triggered hundreds of times accumulates run records, workspace directories
    (until TTL GC fires), and journal entries. The workspace TTL GC (REQ-026) handles directories.
    The journal and SQLite run records have no archival policy. A high-frequency resident workflow
    will grow the SQLite `runs` table and journal files without bound — eventually affecting query
    latency and disk availability.

**Verdict**: Self-sustainability is the system's most developed quality area (crash durability,
self-update, admission cap, body-size guard, workspace GC). The primary gaps are the absent circuit-
breaker state, the missing /health endpoint, the unbounded journal/SQLite growth, and the v13
seedRef timeout gap.

---

## Summary

| Dimension | Strongest asset | Highest-priority gap |
|---|---|---|
| Observability | Per-agent transcript capture + system_info | No end-to-end trace ID across engine / subprocess / LiteLLM / provider |
| Replaceability | Gateway config-switch (sdk\|direct-fetch) | No RunStore/CatalogPort interface; SDK coupling is load-bearing and non-abstract |
| Consumability | Self-describing MCP tool schemas (REQ-079) | /api/* REST surface has no spec; 37-tool flat namespace; seedRef protocol undocumented |
| Self-sustainability | Privilege-separated self-update + crash durability | No stateful circuit-breaker; no /health; seedRef fetch has no timeout; journal grows unbounded |

---

## Key points for the panel

1. The trace-ID gap is structural: five process hops with no shared trace context means a
   production failure will require log-grepping across engine, sandbox child, SDK CLI subprocess,
   LiteLLM proxy, and the provider. This should be a named architectural concern (a `traceId`
   threaded from `RunSpec` into every log emission and child process env).

2. `RunStorePort` / `CatalogPort` interfaces belong in the architecture even if the only
   implementation today is SQLite. The seam cost is low now; it grows with every new query shape.

3. The `ClaudeAgentSdkGatewayClient` carries the full harness (tools, MCP, curated surface,
   thinking-disabled, provider routing). `LiteLLMGatewayClient` does not. This asymmetry means
   the two gateways are not truly interchangeable — they implement different capability contracts.
   Either the interfaces must be aligned (harness-capable vs. non-harness-capable), or the
   `LiteLLMGatewayClient` should be deprecated in favor of the SDK path.

4. The seedRef feature (v13) requires an explicit timeout commitment at the architecture level, not
   deferred to implementation, or it will arrive without one (as happened with the SDK gateway
   timeout gap fixed in D-F5).

5. A GET /health endpoint with engine-internal checks (RunManager responsiveness, SQLite write
   latency, LiteLLM proxy reachability) is a prerequisite for reliable systemd watchdog
   integration and for any future load-balanced deployment.

---

## Risks

| # | Risk | Severity | Affected REQs |
|---|---|---|---|
| R1 | No trace ID across process chain — production failures undiagnosable without multi-process log grep | HIGH | REQ-003, REQ-016, REQ-080 |
| R2 | RunStore/Catalog without port interface — persistence swap or multi-node scale-out requires deep rewrite | HIGH | REQ-006, REQ-013, REQ-014 |
| R3 | No stateful circuit-breaker — parallel() with a flapping provider retries N×timeout in parallel | HIGH | REQ-004, REQ-020 |
| R4 | seedRef fetch (v13) has no timeout — can block an admission slot indefinitely on a slow repo | HIGH | REQ-080 |
| R5 | SDK coupling non-abstract — full harness path lives only in ClaudeAgentSdkGatewayClient; any harness change must be replicated to a future alternative runner | MEDIUM | REQ-016, REQ-017 |
| R6 | No /health — systemd watchdog cannot detect a live-but-hung engine; self-update safe-fail blind to internal deadlock | MEDIUM | REQ-070 |
| R7 | Journal and SQLite run records grow without archival policy — disk exhaustion and query-latency creep for high-frequency resident workflows | MEDIUM | REQ-015, REQ-026 |
| R8 | /api/* REST surface undocumented — third-party dashboard integrators and API callers have no contract | LOW-MEDIUM | REQ-008 |
| R9 | MCP provisioned-server liveness not probed at run-start — dead MCP discovered mid-run after expensive workspace setup | LOW-MEDIUM | REQ-017 |

---

## Expected disagreements with other lenses

- **Adversarial lens** will likely raise additional security concerns about the seedRef SSRF surface
  (R4 above is safety-adjacent but primarily a DoS concern; the adversarial lens will likely add
  redirect-following and content-type confusion vectors). This dimension concurs that the seedRef
  timeout gap is an architecture-level omission.

- **Simplicity / correctness lenses** may push back on the RunStorePort proposal (R2) as
  over-engineering for a single-node use case. This dimension's position: the interface costs one
  afternoon at architecture time and an unknown number of weeks at rewrite time. The precedent
  (GatewayClient is already an interface with two impls) supports doing this consistently.

- **Performance lens** (if present) may note that the 3-second dashboard poll is a negligible load.
  This dimension agrees but notes it is an observability quality concern, not a load concern.

- **Security lens** will likely agree on the circuit-breaker gap (R3) and the /health gap (R6) but
  may reframe R3 as a resource-exhaustion attack vector (an attacker who can cause provider
  timeouts can exhaust the admission pool). This dimension agrees with both framings.
