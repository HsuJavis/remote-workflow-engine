# Quality-Dimensions Review — Gate 2 Architecture vs. Implementation (updated pass)

**Lens:** Quality-dimensions expert (Observability · Replaceability · Consumability · Self-sustainability)
**Scope:** Files listed on each `IMPL-*`'s `files:` in `06-impl-log.md` through the Gate 8 v2 review
route-back closeout (IMPL-001..066), compared against `02-architecture.md`'s ARCH-001..014, its header
invariants, and its "Decision rationale" (D-VAL, D-G, C1..C4). This supersedes an earlier pass of this
same file (findings O-1/C-1/S-1/R-2 below were raised then and are now re-verified against the current
tree — IMPL-051's own log entries claim they were fixed; each is re-checked here, not taken on faith).

**IMPL-064..066 re-check (this pass):** IMPL-064 (D-V2G8-1/2, adversarial-lens route-back: drop
`bypassPermissions`, curb default tool surface, `canUseTool` workspace-boundary callback, explicit
proxy-env custody, budget-reservation cap fix) touches `src/gateway/claude-agent-sdk-client.ts`,
`src/gateway/litellm-proxy.ts`, `src/run-guard.ts` — all three already in this review's file list.
Re-read against all 4 dimensions: none of these changes add or remove a transition-history writer
(O-2), reconcile the 3 alias tables (R-1), route `workflow_artifacts` through `RunStore` (R-3),
differentiate the 2 generic IPC error codes (C-2), unify `workflow_status`'s envelope (C-3), or add
post-start liveness/restart supervision to `LiteLLMProxyManager` (S-2) — confirmed by direct
`grep`/read of the current file contents, not just the log's claim. IMPL-065/066 are verifier-only
regression/doc passes with no `src/` changes. **No new violations introduced by IMPL-064..066 within
this lens's 4 dimensions; all 6 previously-open findings remain open, unchanged in evidence location.**

Files read: `src/server.ts`, `src/mcp-facade.ts`, `src/run-guard.ts`, `src/run-manager.ts`,
`src/resume-cache.ts`, `src/sandbox/host.ts`, `src/sandbox/child-entry.ts`, `src/sandbox/guards.ts`,
`src/ipc/protocol.ts`, `src/agent-executor.ts`, `src/gateway/client.ts`, `src/gateway/litellm-proxy.ts`,
`src/gateway/claude-agent-sdk-client.ts`, `src/run-store.ts`, `src/store/sqlite-run-store.ts`,
`src/workflow-catalog.ts`, `src/submission-validator.ts`, `src/agent-definitions.ts`, `src/main.ts`,
`src/scheduler.ts`, `src/scheduler-engine.ts`, `src/asset-sync.ts`, `src/mcp-probe.ts`,
`src/dashboard.ts`, `src/dashboard-page.ts`, `src/types.ts`, `src/errors.ts`, `rwe.config.example.json`.

---

## Carried-forward findings — re-verified status

| Prior ID | Verified this pass | Evidence |
|---|---|---|
| O-1 (transcript black box) | **RESOLVED** | `src/gateway/claude-agent-sdk-client.ts:150-164,272-295` (`extractEvents`/`_drain` now capture `message`/`tool_call`/`tool_result` turns); `src/agent-executor.ts:108-113` (`capture()` forwards `result.events` before the terminal `usage` event) |
| C-1 (`tools/list` placeholders) | **RESOLVED** | `src/server.ts:121-264` (`TOOL_METADATA`: real per-tool descriptions + real `inputSchema.properties/required`) |
| S-1 (no default `timeoutMs` on SDK default path) | **RESOLVED** | `src/main.ts:100` (`timeoutMs: fileConfig.timeoutMs ?? 15000`) threaded into `ClaudeAgentSdkGatewayClient` at `src/main.ts:145` (`timeoutMs: config.timeoutMs`, the resolved value, not the raw undefined) |
| R-2 (full `process.env` forwarded to SDK subprocess) | **RESOLVED** | `src/gateway/claude-agent-sdk-client.ts:129-148` (`ENV_ALLOWLIST` + `buildSubprocessEnv`, no `...process.env` spread) |
| O-2 (`recordTransition` drops `from`/`ts`) | **STILL OPEN** | see O-2 below |
| R-1 (3 drifted alias tables) | **STILL OPEN** | see R-1 below |
| R-3 (`workflow_artifacts` bypasses `RunStore`) | **STILL OPEN** | see R-3 below |
| C-2 (IPC errors collapse to 2 generic codes) | **STILL OPEN** | see C-2 below |
| C-3 (`workflow_status` envelope not uniform) | **STILL OPEN** | see C-3 below |
| S-2 (no post-start liveness/restart for the LiteLLM proxy) | **STILL OPEN** | see S-2 below |

---

## 1. Observability

### Finding O-2 — `recordTransition` still silently discards `from`/timestamp in both `RunStore` implementations; no transition-history audit trail exists anywhere
- **ARCH violated:** ARCH-006's rationale: *"RunRecorder: one writer of every state transition (timestamp + `runId`), two readers (status API, dashboard)."* Lens: *"internal state observable at any time... a bottleneck is locatable in seconds."*
- **Evidence:**
  - `src/run-store.ts:116-120` — `InMemoryRunStore.recordTransition(runId, _from, to, _ts)`: both `_from` and `_ts` are prefixed `_` (declared-unused) and only `run.status = to` is written.
  - `src/store/sqlite-run-store.ts:114-116` — `SqliteRunStore.recordTransition(runId, _from, to, _ts)`: `UPDATE runs SET status = ? WHERE runId = ?` — same drop.
  - No `RunRecorder` type/class exists anywhere in `src/` (the concept named in ARCH-006 was never materialized as its own module, and the two call sites that could carry its data throw the data away instead).
  - Unchanged since the prior review pass; not addressed by any of IMPL-051..063.
- **Impact:** Nobody can reconstruct "when did this run start running," "how long was it suspended," or the transition sequence/timeline after the fact — only the current status survives. `workflow_status`/the dashboard can show a run's current state but never its history.
- **Severity:** Medium-High.

---

## 2. Replaceability

### Finding R-1 — Three independently hand-maintained default alias tables have drifted to different model-id values, still unreconciled
- **ARCH violated:** ARCH-005 — *"Owns the alias→provider mapping ... as **config**"* (one source of truth) — and ARCH-008's delegation to *"the ARCH-005 alias table"* for validation.
- **Evidence:**
  - `src/run-manager.ts:26-31` `DEFAULT_ALIASES`: `sonnet → "claude-3-5-sonnet-20241022"`, `opus → "claude-opus-4-5"`.
  - `src/main.ts:40-45` `DEFAULT_ALIASES`: identical values to run-manager.ts (own comment at `src/main.ts:34-39` explicitly names this as intentional per-module duplication).
  - `src/submission-validator.ts:12-17` `DEFAULT_ALIASES`: same alias *names* but different model-id *values* — `sonnet → "claude-sonnet"`, `opus → "claude-opus"`.
  - All three are used with no explicit `aliases` config, which is exactly the shape `createServer()`/`composeConfig()` fall back to when nothing is configured (`src/server.ts:432-433`'s `RunManager`/`SubmissionValidator` construction with `config?.aliases` possibly `undefined`).
- **Impact:** In the default/no-config deployment, `SubmissionValidator`'s "alias resolves" pre-flight check (ARCH-008's fail-fast promise) passes/fails against a table whose entries are NOT the ones the gateway will actually route with. Today the alias *names* still line up (so validation doesn't reject a name the gateway would accept), but the moment either table gains/loses/renames an alias independently — which the very existence of 3 unlinked copies invites — validation and routing silently diverge. This is exactly the config-drift risk ARCH-005 (config, singular) and ARCH-008 (delegates to "each owning module's rule," implying one such rule) were designed to prevent.
- **Severity:** Medium.

### Finding R-3 — `workflow_artifacts` still bypasses the `RunStore` port and reads the filesystem directly from the facade
- **ARCH violated:** ARCH-001 — *"No business logic (delegates to ARCH-002), **no direct persistence (reads via ARCH-006)**."*
- **Evidence:** `src/mcp-facade.ts:4` imports `readdirSync` from `node:fs`; `workflow_artifacts` (`src/mcp-facade.ts:149-163`) calls `readdirSync(workspace, { withFileTypes: true })` directly against the on-disk workspace path (via `RunManager.workspacePath`), never through `RunStore`.
- **Impact:** Every other facade read (`workflow_status`, `workflow_result`, `workflow_agent_log`, `workflow_list`) goes through the injectable `RunStore` port; this one call site hard-codes "the run workspace is a local filesystem path reachable via synchronous `fs` from the parent process." If workspace storage is ever swapped behind the `RunStore` port (the entire reason ARCH-006 calls it a "narrow injectable port"), this is the one place that silently keeps assuming local disk.
- **Severity:** Medium.

---

## 3. Consumability

### Finding C-2 — The sandbox IPC boundary still collapses every distinct agent()/workflow() failure into one of two generic codes, discarding the real error identity
- **ARCH violated:** ARCH-001's *"uniform result envelope... so agent callers branch identically"*; lens: *"Agent: structured, well-typed I/O (JSON)... so other software can invoke its reasoning like an ordinary function."*
- **Evidence:** `src/sandbox/host.ts`:
  - Lines 74-86 (the `'agent'` message handler): every rejection from `onAgentRequest` — `BudgetExceededError`, `AgentCapError`, an "Unknown agentType" `Error` (each with its own `.name`, `src/errors.ts`) — is wrapped into one hardcoded `{ code: 'AGENT_ERROR', message: ... }` (line 83).
  - Lines 88-104 (the `'workflow'` handler): every rejection from `onWorkflowRequest` — including a genuine `CatalogNotFoundError` (`.name === 'CatalogNotFoundError'`) thrown by `RunManager._handleWorkflowRequest` (`src/run-manager.ts:304`) when a script calls `workflow('nonexistent-name')` — is force-labelled `code: 'NESTING_ERROR'` (line 100), even though the failure has nothing to do with nesting depth.
  - `child-entry.ts` re-throws these into the script with `.name` set to whichever of the two generic codes was used, so the script-visible error identity is one of only two values regardless of the real cause.
- **Impact:** A workflow script (or any external caller) cannot programmatically distinguish "budget exceeded" from "unknown agentType" from "agent cap exceeded," nor "unknown workflow name" from "nesting too deep" — only by parsing the free-text `message`. Unchanged since the prior review pass; not addressed by IMPL-051..063 despite that round explicitly reworking adjacent IPC/journal code (D-G8-1's nested-callSeq fix touches the same file).
- **Severity:** Medium-High.

### Finding C-3 — `workflow_status`'s envelope is still not uniform with the other tools, contradicting ARCH-001's stated invariant
- **ARCH violated:** ARCH-001 — *"Emits a **uniform** result envelope `{runId,status,result,error?}` from every tool so agent callers branch identically."*
- **Evidence:** `src/mcp-facade.ts:87-92`:
  ```ts
  async workflow_status(a): Promise<ResultEnvelope<RunStatusView> & Partial<RunStatusView>> {
    const merged = await this.runManager.status(a.runId).catch(() => view);
    return { ...merged, result: merged };
  }
  ```
  Every other tool (including the 6 new v2 tools — `schedule_list`, `asset_list`, etc.) returns `{runId, status, result?, error?}` (or the scheduler's own distinct-but-consistent `{result?, error?}` shape); `workflow_status` additionally spreads `phases`, `agents`, `scriptVersion` onto the top level in addition to the documented nested `.result` (IMPL-024's own note: "reachable both ways").
- **Impact:** A caller generically branching on the envelope shape across tools — the entire stated purpose of "uniform... branch identically" — sees a tool-specific extra shape for exactly the one tool most callers poll in a loop.
- **Severity:** Low-Medium.

---

## 4. Self-sustainability

### Finding S-2 — `LiteLLMProxyManager` still has no post-start liveness/restart supervision; a mid-run crash of the default gateway path's only always-on subprocess is permanent for the life of the server process
- **ARCH violated:** ARCH-014's self-healing framing: *"DEPLOY.md sets a restart policy (`Restart=on-failure`) — the self-healing seam v1/v2 need (no custom watchdog)."* Lens: *"System: autoscaling, self-healing (restart a bad instance)... Agent: tool-liveness checks (probe an API still works)."*
- **Evidence:** `src/gateway/litellm-proxy.ts` — the health-endpoint poll only runs inside `_doStart()` (lines 103-119, bounded by `_startupTimeoutMs`). After `start()` resolves and caches `this._baseUrl` (line 112), nothing re-checks `this._proc.exitCode` or restarts the subprocess if it dies mid-run. IMPL-059's own hardening this round (`_assertPortFree`, `_killProcessGroup`) only covers the startup race and the shutdown path (`stop()`, `Server.close()` via D-V2I-6) — neither adds an ongoing liveness loop. Every subsequent `invoke()` on both gateway paths that route through this SAME managed proxy (`LiteLLMGatewayClient.useLiteLLMProxy` and the now-default `ClaudeAgentSdkGatewayClient`, per `main.ts`'s own comment) would fail per-call as "unreachable" forever with no self-repair once the proxy dies.
- **Impact:** Unchanged from the prior review pass — this is the mirror image of the orphan-subprocess hazard IMPL-044/059 did fix (parent-dies-child-survives); child-dies-parent-survives remains open. ARCH-014's restart-policy story covers only the outer server process, not the inner subprocess the default gateway path now structurally depends on for every model call.
- **Severity:** Medium.

---

## Summary

| # | Dimension | Finding | Status | Severity |
|---|---|---|---|---|
| O-1 | Observability | Transcript stream discarded, only terminal `usage` emitted | **Resolved** (IMPL-051/D-G8-2) | — |
| O-2 | Observability | `recordTransition` drops `from`/`ts` in both store impls — no transition history | **Open** | Medium-High |
| R-1 | Replaceability | 3 drifted default alias tables (submission-validator.ts uses different model ids) | **Open** | Medium |
| R-2 | Replaceability | Full `process.env` forwarded to SDK subprocess | **Resolved** (IMPL-051/D-G8-5) | — |
| R-3 | Replaceability | `workflow_artifacts` bypasses `RunStore`, reads fs directly | **Open** | Medium |
| C-1 | Consumability | `tools/list` placeholder metadata | **Resolved** (IMPL-051/D-G8-3) | — |
| C-2 | Consumability | Sandbox IPC boundary collapses all errors to 2 generic codes | **Open** | Medium-High |
| C-3 | Consumability | `workflow_status` envelope not uniform with other tools | **Open** | Low-Medium |
| S-1 | Self-sustainability | No default `timeoutMs` on the SDK default gateway path | **Resolved** (IMPL-051/D-G8-4) | — |
| S-2 | Self-sustainability | `LiteLLMProxyManager` has no post-start liveness/restart supervision | **Open** | Medium |

**Consistent overall? No.** 4 of the 10 originally-found violations are now genuinely resolved
(O-1, C-1, S-1, R-2 — each verified against the current source, not just the log's claim). 6 remain
open (O-2, R-1, R-3, C-2, C-3, S-2), none newly introduced this pass, none touched by the v2/v2b
scheduler/dashboard/asset-sync work (which introduces no new violations of its own within this
lens's four dimensions on the files read).
