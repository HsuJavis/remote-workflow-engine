# Quality-Dimensions Review — Gate 2 Architecture vs. Implementation

**Lens:** Quality-dimensions expert (Observability · Replaceability · Consumability · Self-sustainability)
**Scope:** Files listed on each `IMPL-*`'s `files:` in `06-impl-log.md` (v1 kernel + all route-back
rounds through IMPL-050), compared against `02-architecture.md`'s ARCH-001..014, the cross-component
invariants stated in its header, and the "Decision rationale" section (D-VAL, D-G, C1..C4).

Files read: `src/server.ts`, `src/mcp-facade.ts`, `src/run-guard.ts`, `src/run-manager.ts`,
`src/resume-cache.ts`, `src/sandbox/host.ts`, `src/sandbox/child-entry.ts`, `src/sandbox/guards.ts`,
`src/ipc/protocol.ts`, `src/agent-executor.ts`, `src/gateway/client.ts`, `src/gateway/litellm-proxy.ts`,
`src/gateway/claude-agent-sdk-client.ts`, `src/run-store.ts`, `src/store/sqlite-run-store.ts`,
`src/workflow-catalog.ts`, `src/submission-validator.ts`, `src/agent-definitions.ts`, `src/main.ts`,
`src/types.ts`, `src/errors.ts`, `rwe.config.example.json`.

---

## 1. Observability

### Finding O-1 — AgentTranscriptSink never captures the SDK message/event stream; only a single terminal `usage` event is ever emitted (chain-of-thought / tool-call sequence is a black box)
- **ARCH violated:** ARCH-004's own rationale: *"AgentTranscriptSink: one capture path taps the SDK message/event stream → `agent-<id>.jsonl` (feeds `workflow_agent_log`, dashboard, and resume cache — not three paths)."* Lens requirement: *"Agent: its chain-of-thought, token usage, and tool-call sequence must be inspectable — never a black box."*
- **Evidence:**
  - `src/types.ts:94` — `TranscriptEvent.kind` is declared as `'message' | 'tool_call' | 'tool_result' | 'usage'`, but a full-tree grep of every `appendTranscript`/emission call site (`src/agent-executor.ts:100-115`) shows the sink only ever emits `kind: 'usage'` — never `'message'`, `'tool_call'`, or `'tool_result'`.
  - `src/gateway/claude-agent-sdk-client.ts:158-172` (`_drain`) iterates the real SDK session's own async-generator message stream (`for await (const msg of session)`) — the genuine per-turn tool-use/tool-result/assistant messages a live agent loop produces — and explicitly discards every message except the final `type: 'result'` one (`if (msg.type !== 'result') continue;`). Nothing forwards the intermediate messages to `AgentTranscriptSink`.
  - Net effect: `workflow_agent_log` (the tool built for exactly this purpose) and the future dashboard (ARCH-011, read-only over ARCH-006) can only ever show one summary token-count line per agent call — never the actual reasoning/tool-call trace ARCH-004 promised to persist. A stuck or misbehaving agent is not diagnosable from the transcript at all.
- **Severity:** High — directly negates the module's own architectural rationale and the lens's core Agent-observability requirement.

### Finding O-2 — `RunStore.recordTransition` silently discards the `from` state and timestamp; no transition history/audit trail is persisted
- **ARCH violated:** ARCH-006's *"RunRecorder: one writer of every state transition (timestamp + `runId`), two readers (status API, dashboard)."* This implies a persisted, timestamped record per transition (an append-only history), not merely a mutable "current status" field.
- **Evidence:** Both `RunStore` implementations declare the full `recordTransition(runId, from, to, ts)` signature (`src/run-store.ts:35`) but the parameters are explicitly marked unused and dropped:
  - `src/run-store.ts:116-120` (`InMemoryRunStore`): `async recordTransition(runId, _from, to, _ts) { ...; run.status = to; }`
  - `src/store/sqlite-run-store.ts:114-116` (`SqliteRunStore`): `async recordTransition(runId, _from, to, _ts) { this._db.prepare('UPDATE runs SET status = ? WHERE runId = ?').run(to, runId); }`
  - There is no `RunRecorder` class/module anywhere in the codebase (`grep -rn "RunRecorder" src/` returns nothing) — the concept described in ARCH-006 was folded into `recordTransition` and then the very data (`from`, `ts`) that would make it a "recorder" was dropped at both implementations.
- **Impact:** After the fact, nobody can answer "when did this run start running?", "how long was it suspended?", or "what was the transition sequence?" — only the current status survives. This is the exact failure mode the lens calls out: *"internal state observable at any time... a bottleneck is locatable in seconds"* — it is not, because the timeline itself was never written down.
- **Severity:** Medium-High.

---

## 2. Replaceability

### Finding R-1 — Three independent copies of the default model-alias table have drifted out of sync
- **ARCH violated:** ARCH-005 — *"Owns the alias→provider mapping ... as **config**"* (implying one source of truth) — and ARCH-008 — the Submission Validator *"delegates to each owning module's rule (... ARCH-005 alias table ...)"*, i.e. it should validate against the same table the gateway actually routes with.
- **Evidence:** Three separately hand-maintained `DEFAULT_ALIASES` constants, none imported from a shared module:
  - `src/run-manager.ts:26-31` and `src/main.ts:39-44` map `sonnet → "claude-3-5-sonnet-20241022"`, `opus → "claude-opus-4-5"`, etc.
  - `src/submission-validator.ts:12-17` maps the SAME alias names to *different* model id strings: `sonnet → "claude-sonnet"`, `opus → "claude-opus"`.
  - `main.ts:33-38`'s own comment even names the duplication explicitly ("Same shape as run-manager.ts's/submission-validator.ts's own DEFAULT_ALIASES fallback... matches the codebase's existing per-module duplication pattern") without noticing the values themselves have diverged.
- **Impact:** Whenever a caller omits an explicit `aliases` config (every default/local deployment), `SubmissionValidator`'s "alias resolves" pre-flight check passes/fails based on a table that is NOT the one the gateway will actually use to route the call — the fail-fast promise of ARCH-008 is validating against a fiction. This is also a Consumability defect (a submission can pass validation while still being routed against unexpected model ids).
- **Severity:** Medium.

### Finding R-2 — The two `GatewayClient` implementations silently diverge on secret custody, breaking the "swap without side effects" promise
- **ARCH violated:** ARCH-005 — *"exposes it only through a narrow `GatewayClient.invoke(prompt,opts)` interface... so the gateway is replaceable per D2 without touching ARCH-004"* and *"**sole custody of provider API keys** (parent-only)."*
- **Evidence:**
  - `src/gateway/client.ts`'s `LiteLLMGatewayClient.callProvider` reads exactly one named env var per provider (`process.env['ANTHROPIC_API_KEY']` etc.) in-process and never forwards it anywhere else.
  - `src/gateway/claude-agent-sdk-client.ts:129-133` builds the spawned SDK CLI subprocess's environment as `env: { ...process.env, ANTHROPIC_BASE_URL: this._config.baseUrl, ANTHROPIC_API_KEY: DUMMY_API_KEY }` — every OTHER variable in the parent's environment (any real `OPENAI_API_KEY`, `GEMINI_API_KEY`, cloud credentials, etc. an operator happens to have set) is forwarded verbatim into a new external subprocess. The file's own header comment (line 8) claims *"this class never reads or forwards a real host credential"* — true only for `ANTHROPIC_API_KEY`, false for everything else in `process.env`.
- **Impact:** `GatewayClient` is supposed to be a drop-in-swappable seam (D2); in practice selecting the "sdk" implementation (now the *default*, per D-F4) silently changes the security/custody model versus the "direct-fetch" implementation it replaces — a caller cannot treat the two as interchangeable the way ARCH-005 promises.
- **Severity:** Medium.

### Finding R-3 — `workflow_artifacts` bypasses the `RunStore` port and reads the filesystem directly
- **ARCH violated:** ARCH-001 — *"No business logic (delegates to ARCH-002), **no direct persistence (reads via ARCH-006)**."*
- **Evidence:** `src/mcp-facade.ts:4` imports `readdirSync` from `node:fs`, and `workflow_artifacts` (`src/mcp-facade.ts:149-163`) calls `readdirSync(workspace, { withFileTypes: true })` directly against the on-disk workspace path instead of going through the `RunStore` port.
- **Impact:** Every other facade read goes through `RunStore`/`RunManager`; this one hard-codes the assumption that the run workspace is reachable via a local synchronous `fs` call from the parent process. If `RunStore`/workspace storage is ever swapped for something else (ARCH-006's whole reason for being a "narrow injectable port"), this call site is the one place that will not follow — a module-boundary break, not just an omission.
- **Severity:** Medium.

---

## 3. Consumability

### Finding C-1 — `tools/list` serves placeholder metadata for all 10 tools: no real descriptions, no parameter schemas
- **ARCH violated:** ARCH-001's consumability rationale (*"Emits a uniform result envelope... so agent callers branch identically"*) and the lens's own Consumability definition: *"System: standardized REST/GraphQL API with generated docs (OpenAPI/Swagger) so callers integrate fast... minimize the caller's learning curve & integration cost."*
- **Evidence:** `src/server.ts:147-149`:
  ```
  const tools = TOOL_NAMES.map((name) => ({ name, description: name, inputSchema: { type: 'object' } }));
  ```
  Every tool's `description` is literally its own name, and every `inputSchema` is an empty `{type:'object'}` with no `properties`/`required` — for `workflow_run`, `workflow_resume`, `workflow_agent_log`, etc., none of which document what fields they take.
- **Impact:** `tools/list` is this system's equivalent of OpenAPI/Swagger docs (the MCP discovery surface an agent caller uses to learn how to invoke a tool without reading source). It currently carries zero usable information — a caller cannot learn from the served schema that `workflow_run` needs `name` XOR `script`, that `budget` is `number | null`, or that `workflow_agent_log` needs both `runId` and `agentId`. This directly contradicts the architecture's own stated consumability goal.
- **Severity:** High.

### Finding C-2 — Structured error codes are discarded at the sandbox IPC boundary; every agent()/workflow() failure collapses to one of two generic codes
- **ARCH violated:** ARCH-001's *"uniform result envelope... so agent callers branch identically"* and the lens's *"Agent: structured, well-typed I/O (JSON)... so other software can invoke its reasoning like an ordinary function."*
- **Evidence:** `src/sandbox/host.ts`:
  - The `'agent'` message handler (lines 74-86) wraps **every** rejection from `onAgentRequest` — which can be `BudgetExceededError`, `AgentCapError`, or an "Unknown agentType" `Error`, each with its own distinguishing `.name` (see `src/errors.ts`) — into a single hardcoded `{ code: 'AGENT_ERROR', message: ... }` (line 83), discarding the real error's identity.
  - The `'workflow'` message handler (lines 88-104) does the same for **every** rejection from `onWorkflowRequest` — including `CatalogNotFoundError` ("Unknown workflow: X", `.name === 'CatalogNotFoundError'`) thrown by `RunManager._handleWorkflowRequest` (`src/run-manager.ts:290`) when a script calls `workflow('nonexistent-name')` — and force-labels it `code: 'NESTING_ERROR'` (line 100), even though the actual failure has nothing to do with nesting depth.
  - `child-entry.ts` then re-throws these into the script as `Object.assign(new Error(msg.error.message), { name: msg.error.code })` (line 59), so the script-visible error's `.name` is one of only two values regardless of cause.
- **Impact:** A workflow script (or any caller inspecting the resulting error code) cannot programmatically distinguish "budget exceeded" from "unknown agentType" from "agent cap exceeded", nor "workflow name doesn't exist" from "nesting too deep" — only by string-matching the free-text `message`, which is exactly the fragile pattern structured error codes exist to avoid.
- **Severity:** Medium-High.

### Finding C-3 — `workflow_status`'s envelope is not actually uniform with the other 9 tools
- **ARCH violated:** ARCH-001 — *"Emits a **uniform** result envelope `{runId,status,result,error?}` from every tool so agent callers branch identically."*
- **Evidence:** `src/mcp-facade.ts:87-92`:
  ```ts
  async workflow_status(a): Promise<ResultEnvelope<RunStatusView> & Partial<RunStatusView>> {
    ...
    const merged = await this.runManager.status(a.runId).catch(() => view);
    return { ...merged, result: merged };
  }
  ```
  Every other tool returns exactly `{runId, status, result?, error?}`; `workflow_status` additionally spreads `phases`, `agents`, and `scriptVersion` onto the **top level** of the response (in addition to the documented nested `.result`), per IMPL-024's own note ("so `.phases`/`.agents`/`.status` are reachable both ways").
- **Impact:** A caller that generically branches on the envelope shape across tools (the entire point of "uniform... branch identically") will observe a tool-specific extra shape only for this one tool. Minor in isolation, but a real deviation from the stated invariant, and it is the one tool most callers poll in a loop.
- **Severity:** Low-Medium.

---

## 4. Self-sustainability

### Finding S-1 — The just-reconfirmed D-G circuit breaker is not wired into the actual production default path; a hung/dead provider can hang a run forever with zero automatic recovery
- **ARCH violated:** D-G (Decision rationale, `02-architecture.md:103`): *"fold a bounded timeout→retry→null into ARCH-005's `GatewayClient`... **USER CONFIRMED 2026-07-03: keep the minimal breaker in v1**"* and ARCH-005's rationale: *"so a dead/hung provider (e.g. local Ollama) cannot hang a whole run."* Lens requirement: *"System: ...circuit-breaker/graceful degradation... Goal: minimize human intervention."*
- **Evidence:**
  - `ClaudeAgentSdkGatewayClient` — the D-F4 **default production gateway** (per `src/main.ts`'s `composeConfig()`, `gatewayChoice = fileConfig.gateway ?? 'sdk'`) — only creates a bounded timer when `this._config.timeoutMs !== undefined` (`src/gateway/claude-agent-sdk-client.ts:78`, `93-94`).
  - `src/main.ts:93` and `:113` forward `timeoutMs: fileConfig.timeoutMs` with **no hardcoded fallback** — contrast this with `bind` (`?? '127.0.0.1'`, line 89) and `port` (`?? 8787`, line 90), which both have real defaults baked into `composeConfig()`.
  - `loadFileConfig()` (`src/main.ts:61-69`) returns `{}` when `rwe.config.json` doesn't exist on disk — the ordinary "just run it" zero-config path this entrypoint exists to support.
  - Contrast with the legacy path: `src/server.ts:120` DOES hardcode `timeoutMs: config?.timeoutMs ?? 15000` for `LiteLLMGatewayClient` — i.e. the *old, no-longer-default* path has the safety net; the *new default* path does not. Only `rwe.config.example.json` sets `"timeoutMs": 15000` (line 5), and that file is never read unless an operator manually copies it to `rwe.config.json`.
  - The only remaining bound on a hung `agent()` call in the zero-config default deployment is the run's own `AbortController`, which fires only on an explicit human `workflow_suspend`/`workflow_stop` call (`src/run-manager.ts:333`) — i.e., the "automatic" breaker is not automatic at all without operator configuration.
- **Impact:** In the exact deployment shape `src/main.ts` was built to support (no config file, defaults only — the entrypoint's own header comment frames this file as "before this file existed... there was no documented, standalone way to launch the MCP server"), a dead/unresponsive local Ollama (REQ-004/REQ-003's own motivating scenario) hangs the `agent()` call — and, because `RunGuard`'s concurrency slot stays held for the duration, the whole run — indefinitely, requiring a human to notice and intervene. This contradicts a decision the user re-confirmed on today's date (2026-07-03) specifically to avoid this outcome.
- **Severity:** High.

### Finding S-2 — `LiteLLMProxyManager` has no ongoing liveness/restart supervision once started; a mid-run crash of the now-default-path's only always-on subprocess is permanent for the life of the server process
- **ARCH violated:** ARCH-014's self-healing framing: *"DEPLOY.md sets a restart policy (`Restart=on-failure`) — the self-healing seam v1/v2 need (no custom watchdog)."* Lens requirement: *"System: autoscaling, self-healing (restart a bad instance)... Agent: tool-liveness checks (probe an API still works)."*
- **Evidence:** `src/gateway/litellm-proxy.ts` polls the health endpoint only during `_doStart()` (lines 88-104, bounded by `_startupTimeoutMs`); after `start()` resolves and caches `this._baseUrl`, nothing re-checks the child process's liveness (`this._proc.exitCode`) or restarts it if the subprocess dies mid-run. Every subsequent `GatewayClient.invoke()` (both `LiteLLMGatewayClient.useLiteLLMProxy` and the `ClaudeAgentSdkGatewayClient` default path, both of which route through this SAME managed proxy per `main.ts`'s own comment) would then just fail per-call as "unreachable" forever, with no self-repair.
- **Note:** IMPL-044 (`06-impl-log.md:782`) itself documents a closely-related still-open gap ("item 4 (litellm subprocess orphan) still open") — the orphan case (parent dies, child survives) is the mirror image of this one (child dies, parent survives and keeps routing to it) and is equally unaddressed; ARCH-014's restart-policy-as-self-healing story only covers the outer server process, not the inner subprocess the default gateway path now structurally depends on for every model call.
- **Severity:** Medium.

---

## Summary

| # | Dimension | Finding | Severity |
|---|---|---|---|
| O-1 | Observability | AgentTranscriptSink never captures message/tool_call/tool_result — only terminal `usage` | High |
| O-2 | Observability | `recordTransition` drops `from`/`ts` — no transition history in either store impl | Medium-High |
| R-1 | Replaceability | 3 drifted copies of the default alias table (submission-validator.ts uses different model ids) | Medium |
| R-2 | Replaceability | `ClaudeAgentSdkGatewayClient` forwards full `process.env` to a subprocess; `LiteLLMGatewayClient` doesn't | Medium |
| R-3 | Replaceability | `workflow_artifacts` reads the filesystem directly, bypassing the `RunStore` port | Medium |
| C-1 | Consumability | `tools/list` schemas are placeholders (`description: name`, empty `inputSchema`) | High |
| C-2 | Consumability | Sandbox IPC boundary collapses all agent/workflow errors into 2 generic codes | Medium-High |
| C-3 | Consumability | `workflow_status` envelope isn't uniform with the other 9 tools | Low-Medium |
| S-1 | Self-sustainability | D-G circuit breaker has no default `timeoutMs` on the new default SDK gateway path | High |
| S-2 | Self-sustainability | `LiteLLMProxyManager` subprocess has no post-start liveness/restart supervision | Medium |

**Consistent overall? No.** 10 violations found, several (O-1, C-1, S-1) directly contradicting explicit
architecture rationale text rather than merely under-building a nice-to-have — S-1 in particular
contradicts a decision the user re-confirmed on today's date.
