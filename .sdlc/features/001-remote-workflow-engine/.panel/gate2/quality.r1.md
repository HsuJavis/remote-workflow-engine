# Gate-2 Quality-Dimensions Review — Remote Workflow Engine (001)

**Reviewer group**: Quality-Dimensions Panel
**Scope**: 01-requirements.md (REQ-001..015, D1–D11), state.yaml (v1=REQ-001..007,013,014; v2=REQ-008..011,015; v3=REQ-012; safety_class=QM), dynamic-workflow-compat-spec.md.

**Altitude judgment**: this project is **BOTH** a conventional system and an AI-agent platform.
- *System* layer: Node/TS MCP Streamable HTTP service, SQLite+journal persistence, LiteLLM gateway process, web dashboard, scheduler — REQ-005/006/007/008/011/013/014/015.
- *Agent* layer: the thing the system runs is itself agentic — Claude Agent SDK sessions spawned per `agent()` call, routed through a swappable LLM gateway, with per-agent transcripts and tool calls — REQ-001/002/003/004/007/009.

Each dimension below is judged at whichever altitude(s) the requirements actually justify. No speculative machinery is recommended where no REQ demands it — those gaps are called out explicitly rather than filled.

---

## 1. Observability (transparency of internal state; traceability)

### System altitude
The request path is: MCP client → `MCPX` (REQ-005) → `ENG` (workflow runtime) → `AG` (agent engine) → `GW` (LiteLLM gateway), with all state changes landing in `ST` (journal.jsonl + SQLite, D9). This single store is sufficient as the log/metrics/trace backbone for v1/v2 — no separate metrics stack (Prometheus/OTel) is justified by any REQ, and adding one would be speculative machinery for a single-node QM dev tool.

Recommended seams:
- **RunRecorder** (append-only journal.jsonl + SQLite index, already implied by D9/REQ-006): every state transition (queued→running→suspended/stopped/completed/failed) is written here with a timestamp and `runId` correlation key. This is the source of truth `workflow_status` (REQ-007) and the dashboard (REQ-008) both read — one writer, two readers, no duplication.
- **GatewayAccessLog correlation**: REQ-004's acceptance ("gateway logs show only the local backend") requires that calls to `GW` be tagged with `runId`/`agentId` correlation so LiteLLM's own request log can be joined back to `ST`. Concretely: `AG` must pass a correlation header/param through to every gateway call. Without this seam, REQ-004's acceptance criterion is unverifiable except by manual gateway-log reading.
- **Boot-recovery log line**: REQ-006 requires state to survive a restart, but no REQ requires the operator to be able to *see* what got recovered. Recommend one log line at startup enumerating runs re-hydrated from `ST` and their resulting status (e.g. `recovered 3 runs: 1 suspended, 2 stopped`). Cheap (one log statement in existing journal-replay code), high operability value, not a new module.

### Agent altitude
REQ-007's `workflow_agent_log(runId, agentId)` returning the "full message/tool-call transcript" is exactly the no-black-box requirement — this is already well-specified, not a gap.

Recommended seam:
- **AgentTranscriptSink**: a single module that taps the Claude Agent SDK's message/event stream per session and writes it synchronously to `agent-<id>.jsonl` (compat-spec §4). This one recorder feeds three consumers: `workflow_agent_log` (REQ-007), the dashboard transcript view (REQ-008), and resume/replay cache-hit logic (REQ-006) — do not build three separate capture paths.
- Token/budget deltas (REQ-002's `budget.total/spent()/remaining()`, REQ-007's per-agent token usage) should be emitted by the same sink, not computed twice (once for the in-script `budget` object, once for the status API) — one accounting path, two read views.

### Flag
No requirement calls for latency percentiles, error-rate SLOs, or alerting — appropriately out of scope for a QM self-hosted tool. The one real gap is the gateway-correlation seam above: without it, REQ-004's "gateway logs show only local backend" acceptance criterion has no architectural hook to be tested against.

---

## 2. Replaceability (decoupling & pluggability)

### System altitude
- **Run store**: `ST` (SQLite + journal) should sit behind a narrow `RunStore` interface (create/append/query run & agent records) used by `ENG`, `MCPX`, and `DASH`. This is recommended purely for testability/seam-clarity (unit tests against an in-memory fake), **not** for multi-DB portability — no REQ asks for swapping SQLite for Postgres, and building that abstraction now would be speculative for a single-node self-hosted product.
- **Sandbox backend**: D6 fixes process-level isolation (child process + restricted VM). No REQ asks for a pluggable sandbox (e.g. container-per-run). REQ-011's docker-compose/systemd deployment already gives host-level isolation; recommend *not* building a swappable sandbox-strategy interface — correctly out of scope.

### Agent altitude
This is the dimension the requirements most explicitly demand, via D2 and REQ-004: the LLM backend must be swappable by config (Anthropic/OpenAI/Gemini/Ollama), and "the gateway interface [must be] abstracted so it can be replaced later."

Recommended seam:
- **GatewayClient interface**: `AG` must never call LiteLLM specifics directly. It should call a `GatewayClient.invoke(prompt, opts)` interface with exactly one implementation today (`LiteLLMGatewayClient`, talking over `ANTHROPIC_BASE_URL`). If the embedded gateway is later swapped for something else, only this implementation changes — `AG` and everything above it is untouched.
- **Model-alias mapping** (REQ-004) is config, not code: a single alias→provider-model table, validated at submission time (REQ-004: "an alias with no mapping — submission-time validation reports the missing mapping instead of failing mid-run"). This is the actual pluggability lever end users touch; it should live in one config file/table, not scattered per-call defaults.
- **Agent execution engine itself is intentionally not a seam**: D1 fixes Claude Agent SDK as the sole engine. No REQ asks for an alternate agent framework. Do not build an `AgentEngine` abstraction with only one implementation "for future flexibility" — that is exactly the speculative machinery Karpathy-simplicity rules out here.

### Flag
D2 asserts the gateway interface is "abstracted so it can be replaced later," but no REQ-004 acceptance criterion actually exercises that — every test is "swap *models* via LiteLLM," none is "swap the *gateway* itself." Recommend Gate 5 add one cheap unit test that `GatewayClient` is exercised through a fake implementation (proving the seam is real and not accidentally leaked LiteLLM-specific types into `AG`), without needing to stand up a second real gateway.

---

## 3. Consumability (ease of use & low integration cost)

### System altitude
REQ-005 (MCP Streamable HTTP, `tools/list` exposing `workflow_run/status/result/suspend/resume/stop/list`) is the system-level "standard REST + docs" analog here. Recommend the MCP tool schemas (whatever schema library backs the tool definitions) double as the documentation source — REQ-011's DEPLOY.md smoke check ("submit a sample workflow → completes") should literally be generated from/tested against those schemas rather than hand-maintained separately.

REQ-014's named registry (register once, then `workflow_run` by name, no inline script transport needed) is a concrete low-integration-cost win worth calling out as already well-designed — it turns a "paste 512KB of JS every call" integration into a "call by name" one.

### Agent altitude
The interface here is explicitly MCP tools + a Claude Code client plugin (D8, REQ-010) — this *is* the "structured JSON I/O + SDK" analog for an agent consumer, not a human one.

Recommended seams:
- **Uniform result envelope**: `workflow_result` should return a consistent shape regardless of outcome — `{runId, status, result, error?}` — so a calling agent (or the plugin's guidance skill) can treat every call site identically instead of branching on ad hoc response shapes. REQ-005/006/007 between them define enough result/status/error paths that this envelope should be nailed down once, centrally, rather than left to emerge per-tool.
- **Guidance skill as the "docs"** (REQ-010): since `workflow_run` is async (returns `runId` immediately per REQ-005), a naive agent caller needs to know to poll `workflow_status`/`workflow_result` rather than assume synchronous completion. Recommend the guidance skill installed by the client plugin include the submit→poll→fetch sequence as a concrete example — this is the actual "SDK ergonomics" lever for an agent consumer, cheaper than building a blocking-wait convenience tool that isn't requested by any REQ.
- **Recursion guard as a consumability boundary, not just safety** (D4, REQ-009): excluding this system's own plugin/skill/MCP-config from sync keeps the "call it like a function" abstraction from becoming self-referential. Already correctly scoped in REQ-009's acceptance criteria — no additional seam needed.

### Flag
No single validation entry point is specified. REQ-004 requires submission-time validation of model-alias mappings; separately, script `meta` literal shape needs validation (compat-spec §1); separately REQ-014 implies registered-workflow validation. Recommend collapsing these into **one Validator module** invoked at both `workflow_run` and workflow-registration entry points (covering: meta shape, model-alias mappings, `agentType` existence), rather than three ad hoc checks duplicated across entry points. This is the one concrete architectural ask under this dimension — it directly improves integration cost (fail fast, one error-reporting shape) and is justified by REQ-004 + REQ-014 + compat-spec §1 together, not speculative.

---

## 4. Self-Sustainability (closed-loop autonomy)

### System altitude
- **Autoscaling**: not justified — single self-hosted Linux box, QM safety class, no REQ calls for horizontal scaling. Correctly out of scope.
- **Self-healing**: REQ-006's crash-restart-recover guarantee (state survives restart, suspended runs remain resumable) is the real self-healing property here — but it is *state* recovery, not an automated *process* watchdog. The process-liveness half of self-healing is already covered for free by REQ-011's deployment path: systemd/docker-compose restart policies (`Restart=on-failure`). Recommend DEPLOY.md explicitly configure that restart policy — this is the entire self-healing seam v1/v2 need; a custom supervisor/watchdog module is not justified.
- **Circuit breaker (gateway-down case)**: this is the clearest gap. REQ-004 tests routing correctness and local-only egress but no acceptance criterion covers a configured provider being unreachable or timing out (e.g. local Ollama down, or a paid API rate-limited/hanging). As written, nothing prevents a dead provider from hanging a whole run indefinitely. Recommend either pulling a minimal timeout+fail-fast behavior into v1's `GatewayClient` seam (§2 above), or explicitly recording this as an accepted v1 risk in 01-requirements.md's open-questions list — right now it's silently absent rather than deliberately deferred.

### Agent altitude
- **Tool-liveness checks**: REQ-009 (v2) already requires this in substance — "a config that cannot run server-side is rejected with a reason, not silently accepted." Recommend the `AssetValidator` behind this actually *probe* server-side-runnable MCP configs (attempt a connect/handshake) rather than only static shape-checking, and specifically detect the compat-spec §5 caveat (interactively-authenticated MCP servers absent headless) as one of the rejection reasons — this turns a generic "invalid config" error into the actionable one REQ-009's acceptance text implies.
- **Runaway-loop backstops as closed-loop bounds**: REQ-002's token-budget hard ceiling, concurrency cap, and 1000-agent lifetime cap are together the actual "autonomy bound" mechanism for this product — an agent-spawning workflow cannot run away unbounded. Recommend these three caps be enforced by one shared **RunGuard** read by both `ENG` (orchestration) and `AG` (spawner), so the two can't drift out of sync (e.g. `ENG` thinking budget remains while `AG` has already exhausted it). This is a direct architectural consequence of REQ-002's three acceptance criteria, not new scope.
- **Memory metabolism**: not required. Workflows are stateless orchestration scripts; context flows through files/args only (compat-spec §5, "no shared memory"). No cross-run agent memory exists to metabolize. Correctly out of scope.
- **Self-reflection/prompt calibration**: not required by any REQ. Agents run fixed, script-authored prompts; the engine has no mandate to adapt or calibrate them. Explicitly flagged here as *intentionally absent* — building an auto-calibration layer would be exactly the kind of speculative machinery this review is meant to catch.

### Flag
The one substantive gap in this dimension is the gateway-unavailability circuit breaker described above. Everything else self-sustainability would ask of an agent platform (runaway bounds, tool-liveness, restart recovery) is already backed by an existing REQ; this is the one case where the requirement set is silent rather than deliberately scoping out.

---

## Summary of concrete architectural asks (REQ-traced)

| Seam | Dimension | Traces |
|---|---|---|
| RunRecorder (journal+SQLite, single writer) | Observability (system) | REQ-006, REQ-007, REQ-008 |
| Gateway-call correlation (runId/agentId tagging) | Observability (system) | REQ-004, REQ-007 |
| Boot-recovery log line | Observability (system) | REQ-006 |
| AgentTranscriptSink (single capture path) | Observability (agent) | REQ-002, REQ-006, REQ-007, REQ-008 |
| RunStore interface (testability seam, not multi-DB) | Replaceability (system) | REQ-006, REQ-013, REQ-014 |
| GatewayClient interface + one LiteLLM impl | Replaceability (agent) | D2, REQ-004 |
| Model-alias mapping as config, submission-validated | Replaceability (agent) | REQ-004 |
| Uniform result envelope on workflow_result | Consumability (agent) | REQ-005, REQ-006, REQ-007 |
| Guidance skill documents async poll pattern | Consumability (agent) | REQ-010 |
| Single Validator at run + registration entry points | Consumability (system) | REQ-004, REQ-014, compat-spec §1 |
| Systemd/docker restart policy documented in DEPLOY.md | Self-sustainability (system) | REQ-006, REQ-011 |
| Gateway timeout/fail-fast on provider-down (gap) | Self-sustainability (system) | REQ-004 (uncovered) |
| AssetValidator with live probe + reason codes | Self-sustainability (agent) | REQ-009 |
| RunGuard shared by ENG+AG for budget/concurrency/count caps | Self-sustainability (agent) | REQ-002 |

Explicitly out of scope (do not build): pluggable DB backend, pluggable sandbox strategy, pluggable agent-execution engine, metrics/alerting stack, cross-run agent memory, prompt self-calibration.
