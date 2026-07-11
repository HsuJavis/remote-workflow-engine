---
stage: architecture
status: reviewed
---
# 02 Architecture — Remote Workflow Engine

> Decomposition of REQ-001..020 into modules. Each `### ARCH-NNN`'s `traces` points back to the REQ(s) it realizes; matching verification is integration test IT-*.
> **Load-bearing decision**: a single **trust-boundary / IPC seam** splits an *untrusted child* (the Claude-generated orchestration JS, pure API surface only) from a *trusted parent* (budget/journal/agent-spawn/secrets). That one seam simultaneously minimizes the security blast radius (D6), is the master test seam (stub the agent executor → dry-run the real 641-line fixture with zero model calls), and is the natural single-authority point for budget/concurrency consistency.
> **Compat kernel vs extensions** (compat-spec §6): ARCH-001..008 are the v1 compat kernel + entry-point validation; ARCH-009..014 are deliberate extensions that attach at pre-existing v1 seams (auth-as-middleware, scheduler-over-catalog, dashboard-over-store, sync-over-workspace) with **zero v1 rework**. **v3 slice** ARCH-015..018 hang on the *same* untrusted-child ⟂ trusted-parent boundary (provisioning registry, secret store, SDK session-options builder + outer timeout race, asset-ingestion policy) — again zero v1 rework; the only v1/v2 module *amendments* are three fail-closed tightenings recorded in the rationale (global RunGuard semaphore, non-loopback bind guard, proxy-subprocess lifecycle).
> Panel provenance: `.panel/gate2/adversarial.r1.md` (security/scalability/testability, opus) + `.panel/gate2/quality.r1.md` (observability/replaceability/consumability/self-sustainability, sonnet-5). Decision rationale at the foot of this file.

## Compat kernel (v1) — 100%-compat baseline (compat-spec §1–§5)

### ARCH-001 — MCP Facade (Streamable HTTP interface)
- **status:** draft
- **traces:** REQ-005, REQ-007
- **note:** Streamable-HTTP transport; dispatches `workflow_run/status/result/suspend/resume/stop/list` + `workflow_agent_log`; binds `127.0.0.1` by default, `0.0.0.0` opt-in (D5); async `runId` return. Emits a **uniform result envelope** `{runId,status,result,error?}` from every tool so agent callers branch identically (consumability). No business logic (delegates to ARCH-002), no direct persistence (reads via ARCH-006), no auth *decision* (calls the ARCH-009 seam, a no-op in v1). Depends: ARCH-002, ARCH-006, ARCH-008, ARCH-009(no-op).
- **iter:** v1

### ARCH-002 — Run Manager / Lifecycle (single per-run authority · RunGuard)
- **status:** draft
- **traces:** REQ-002, REQ-006
- **note:** The single authority per run: state machine (`queued/running/suspended/stopped/completed/failed`), concurrency gate `min(16,cores−2)`, global agent counter (≤1000), **budget accounting** (`total/spent()/remaining()`, hard-throw at ceiling), serialized journal-append ordering, suspend/resume/stop, replay-from-cache orchestration. These three caps together form the shared **RunGuard** read by both orchestration and the agent spawner so they cannot drift (quality: self-sustainability bound). Does NOT run script code (ARCH-003) or call the model (ARCH-004) — owns policy & truth, not execution. Depends: ARCH-003, ARCH-004, ARCH-006, ARCH-007.
- **iter:** v1

### ARCH-003 — Sandbox Host (untrusted-child execution kernel)
- **status:** draft
- **traces:** REQ-001, REQ-002
- **note:** One Node child process per run; restricted **VM context** exposing ONLY the workflow API surface (`agent/parallel/pipeline/phase/log/args/budget/workflow`); determinism guards (`Date.now`,`Math.random`,argless `new Date()` throw); no fs/Node/network/`require` in-context; 512 KB cap; JS-not-TS parse rejection; `meta` literal validation; `parallel`/`pipeline` null-semantics; `workflow()` one-level nesting throw; 4096-item/call cap. Holds **no secrets, no store handle, no network** — marshals each `agent()`/`workflow()` over the IPC seam to ARCH-002; the in-script `budget` is a read-only view (ARCH-002 is source of truth). Depends: ARCH-002 (IPC only).
- **iter:** v1

### ARCH-004 — Agent Executor (Claude Agent SDK headless)
- **status:** draft
- **traces:** REQ-003, REQ-007
- **note:** Per `agent()` call: one Claude Agent SDK headless session; `schema`→StructuredOutput with retry-on-mismatch; `agentType` resolved from the server-side registry (unknown → reported error, not hang); `effort`/`isolation` applied; terminal failure after retries → resolves `null` (never rejects). Runs **parent-side** so untrusted script never touches the SDK or keys. **AgentTranscriptSink**: one capture path taps the SDK message/event stream → `agent-<id>.jsonl` (feeds `workflow_agent_log`, dashboard, and resume cache — not three paths). Token deltas emitted here feed both the `budget` view and the status API (one accounting path). Depends: ARCH-005, ARCH-006, ARCH-007.
- **iter:** v1

### ARCH-005 — Model Gateway (embedded LiteLLM behind GatewayClient)
- **status:** draft
- **traces:** REQ-004
- **note:** Manages the embedded **LiteLLM** subprocess; exposes it only through a narrow **`GatewayClient.invoke(prompt,opts)`** interface (one impl today, `LiteLLMGatewayClient` over `ANTHROPIC_BASE_URL`) so the gateway is replaceable per D2 without touching ARCH-004. Owns the alias→provider mapping (`sonnet/haiku/opus/default → Anthropic/OpenAI/Gemini/Ollama`) as **config**; **sole custody of provider API keys** (parent-only). Every call is **correlation-tagged** with `runId`/`agentId` so the LiteLLM request log joins back to the store (makes REQ-004 "local backend only" verifiable). Surfaces real provider+model id + token usage back to ARCH-002/004. **Provider-down handling**: bounded timeout → retry → `null` (reuses REQ-003 null semantics) so a dead/hung provider (e.g. local Ollama) cannot hang a whole run — see decision D-G below (user-confirmed: in v1).
- **iter:** v1

### ARCH-006 — Run Store (journal.jsonl + SQLite, RunStore port · RunRecorder)
- **status:** draft
- **traces:** REQ-006, REQ-007
- **note:** Durable persistence behind a narrow injectable **`RunStore`** port (create/append/query run & agent records): `journal.jsonl` per run (each `agent()` return in completion order — the resume cache keyed on `(prompt,opts)` longest-unchanged-prefix), `agent-<id>.jsonl` transcripts, SQLite **index** for `list/status`. Survives restart; single-writer *per run* (per-run files → no cross-run contention). **RunRecorder**: one writer of every state transition (timestamp + `runId`), two readers (status API, dashboard). Boot-recovery emits one log line enumerating re-hydrated runs. Port abstraction is for **testability** (in-memory fake), NOT multi-DB portability (no REQ asks to swap SQLite → deliberately not built).
- **iter:** v1

### ARCH-007 — Workflow Catalog (named registry + per-workflow/per-run workspaces)
- **status:** draft
- **traces:** REQ-013, REQ-014
- **note:** Named registry (save/list/invoke-by-name; version pinning so prior runs reference their version); `workflow(name)` resolution (unknown name → catchable throw). **Per-workflow persistent work folder** + **per-run workspace** rooting: agent file I/O confined to the run workspace, run A cannot see run B, workflow X's folder unreachable from Y via the API; documented retention/cleanup policy. Hands ARCH-004 a *rooted* workspace path and refuses to resolve outside it. Registry-version and work-folder are merged (one identity key = one module; splitting would be two modules over one PK). Depends: ARCH-006 (metadata).
- **iter:** v1

### ARCH-008 — Submission Validator (fail-fast at entry points)
- **status:** draft
- **traces:** REQ-001, REQ-004, REQ-014
- **note:** One validation facade invoked at both `workflow_run` and workflow-registration entry points so errors surface **at submission, not mid-run**: `meta` literal shape (compat-spec §1), model-alias mappings resolve (REQ-004 "missing mapping reported at submission"), `agentType` existence. Delegates to each owning module's rule (ARCH-003 parse/meta, ARCH-005 alias table, ARCH-007 registry) but presents **one error-reporting shape** — collapses three ad-hoc checks into one seam (consumability). Depends: ARCH-003, ARCH-005, ARCH-007.
- **iter:** v1

## Extension modules (v2/v3) — attach at existing v1 seams, zero v1 rework

### ARCH-009 — Auth Middleware (pluggable, no-op in v1)
- **status:** draft
- **traces:** REQ-012
- **note:** Wraps the ARCH-001 request pipeline; **ships v1 as a pass-through no-op** (D5), v3 swaps in an OIDC resource server (401 + resource metadata, PKCE; Keycloak dev / enterprise SSO / Entra ID). Auth-disabled config = v1 behavior (backward compatible). No ARCH-001 signature change → drop-in. Depends: ARCH-001.
- **iter:** v3

### ARCH-010 — Scheduler (cron / one-shot / resident-trigger)
- **status:** draft
- **traces:** REQ-015
- **note:** A driver **over ARCH-007 + ARCH-002**: cron schedules, one-shot-at-T (auto-completes; editable before firing), resident `workflow_trigger(name,args)` (rejected when disabled). Starts runs via the **same code path** as a manual `workflow_run` → scheduled runs appear in `workflow_list`/dashboard like any run. Pure consumer of existing surfaces; no kernel change. Depends: ARCH-007, ARCH-002.
- **iter:** v2

### ARCH-011 — Web Dashboard (read-only over the store)
- **status:** draft
- **traces:** REQ-008
- **note:** **Read-only over ARCH-006** (+ live tail): run list with status, drill-in to phase/agent tree with live-updating states + token usage, per-agent transcript view. Adds no write path — cannot perturb runs. Depends: ARCH-006.
- **iter:** v2

### ARCH-012 — Asset Sync (recursion-guarded upload)
- **status:** draft
- **traces:** REQ-009
- **note:** MCP tools `asset_push/asset_list/asset_delete` writing into ARCH-007's server-side workspace. **Recursion guard (D4)**: rejects/strips this system's own plugin/guidance skill/self-MCP-config, reporting the exclusion. **AssetValidator** with a *live probe* of pushed MCP configs (attempt connect/handshake) — server-runnable (remote HTTP / npx stdio) accepted; non-runnable or interactively-authenticated-headless (compat-spec §5 caveat) rejected with an actionable reason. Depends: ARCH-007, ARCH-001.
- **iter:** v2

### ARCH-013 — Claude Code Client Plugin (install + guidance skill)
- **status:** draft
- **traces:** REQ-010
- **note:** Client-side artifact: MCP connection config + guidance skill teaching agents when to use the remote service vs the built-in dynamic Workflow tool (incl. the async **submit→poll `workflow_status`→fetch `workflow_result`** pattern, since `workflow_run` returns `runId` immediately). Coexists conflict-free with the local Workflow tool; **excluded from its own sync** (D4). Depends: (client-side; consumes ARCH-001).
- **iter:** v2

### ARCH-014 — Deploy Packaging (local + remote Linux)
- **status:** draft
- **traces:** REQ-011
- **note:** docker-compose / systemd bring-up of ARCH-001..008 + the LiteLLM (ARCH-005) subprocess; documented smoke check (submit sample workflow → completes); identical steps on localhost and remote host. DEPLOY.md sets a **restart policy** (`Restart=on-failure`) — the self-healing seam v1/v2 need (no custom watchdog) — and loudly documents the **v2-without-auth caveat** (asset_push = server-side code execution; require SSH-tunnel/VPN until v3 auth). Depends: all ARCH-001..008 (+ v2 modules when present).
- **iter:** v2

## v3 slice modules (REQ-016..020) — attach at the existing trust boundary, zero v1 rework

### ARCH-015 — MCP Provisioning Registry (admin-write, referenced-by-name)
- **status:** draft
- **traces:** REQ-017
- **note:** SQLite-backed `name → {kind: stdio|http, config}`, provisioned **out-of-band** from run submission via an admin-only `mcp_provision` tool (probes the server at provision time → `MCP_PROBE_FAILED` on a dead config; reject, not silent). At session build the run references MCPs **by name**; unknown name → typed `MCP_NOT_PROVISIONED` at submission/run (never silent no-op). Sibling of the ARCH-007 catalog over the ARCH-006 store; **read** by ARCH-017 which injects ONLY the explicitly-referenced entries with `strictMcpConfig` preserved (host ambient MCP never inherited — the VAL-003 isolation invariant). Admin-provisioned stdio is trusted **because** it is admin-provisioned, not per-run-uploaded — so the security-critical property is the *write authority* (see the non-loopback bind guard, D-BIND). Depends: ARCH-006, ARCH-001.
- **iter:** v3

### ARCH-016 — Secret Store + Resolver (parent-only, never workspace-reachable)
- **status:** draft
- **traces:** REQ-018
- **note:** Parent-only. Loads `${secret:name}` sources from systemd `LoadCredential`/process env into parent memory at startup; a narrow **`SecretResolver` port** resolves `${secret:name}` → value **at session-build time** and injects it into the MCP/provider config the parent hands the SDK. Registry/asset entries store **only the handle**, never plaintext; a missing handle → typed `SECRET_MISSING` / `SECRET_HANDLE_INVALID` (fail-closed — never a hang, never the literal handle smuggled through as a value). **Two-layer containment** to make REQ-018's stated invariant *true*, not just handle-shaped (see D-SEC): (1) provider keys live only in the LiteLLM proxy process env/memory — off every agent-reachable filesystem path; (2) MCP secrets resolved in parent memory, never written to any workspace path; and the ARCH-007 confinement callback is made **realpath-based + argument-name-complete + `Bash`-deny-outside-root** so a tool-capable agent cannot `cat` the proxy config or a sibling run's journal. **Redaction is part of this module, not an afterthought** (D-REDACT): resolved values never enter transcripts/dashboard/logs; SessionInitRecord logs handle *names* only. One concrete source today (env/`LoadCredential`) behind the resolver port — **no vault/KMS impl until a second backend is a real requirement** (Karpathy). Depends: ARCH-005, ARCH-015, ARCH-007.
- **iter:** v3

### ARCH-017 — SDK Session-Options Builder (pure) + outer timeout race
- **status:** draft
- **traces:** REQ-016, REQ-020
- **note:** Splits **policy** from **spawn** — the master v3 test seam. A **pure** builder `(providerClass, alias, config, provisionedRefs, resolvedSecrets) → SDKOptions` sets `thinking:{type:'disabled'}` for non-Anthropic aliases (Anthropic left at SDK default — the D-F6 regression guard), the **curated tool allowlist** (never the full built-in Claude Code surface, so small models are not drowned into text-only degradation), and the explicitly-referenced injected-MCP set (`strictMcpConfig`). Provider capability is a **config-driven `ProviderProfile`** per alias (`supportsExtendedThinking/supportsToolUse/timeoutMs/retries/effortMapping`), single source of truth shared with the alias validator — GLM/qwen/next-provider is a config row, not a gateway rewrite (D2 replaceability; also answers the open `effort`-mapping question). Impure half: `Promise.race(query, timeoutMs)` that **kills the CLI subprocess** on timeout (not a bare abandon — an orphan child burns tokens and holds a global slot for its ~4-min internal backoff) → `agent()` resolves `null`, bound observably applied on BOTH gateway paths. Both impls write one **`FailureEnvelope`** `{kind:timeout|provider_error|tool_error|schema_mismatch, attempts, elapsedMs, providerDetail}` before resolving `null` (never fake success text) and one **`SessionInitRecord`** at build (resolved alias→provider+model id, thinking mode, allowlist, injected-MCP names, secret-handle names, cwd) — makes REQ-016 c3 "curated surface observable in session init" auditable from the store. Real `tool_use` round-trip against local Ollama is the one unavoidable real-tier integration test; everything else (thinking flag, allowlist, strict-MCP, typed errors, secret-never-in-artifact) is a pure unit test. Lives **inside** the GatewayClient impls behind the unchanged `invoke(prompt,opts)` contract (SDK options never leak through ARCH-004 into orchestration). Depends: ARCH-004, ARCH-005, ARCH-015, ARCH-016.
- **iter:** v3

### ARCH-018 — Asset-Ingestion Policy (hooks-drop by construction, MCP-config redirect)
- **status:** draft
- **traces:** REQ-019
- **note:** A pure classifier at the ARCH-012 asset boundary: **hook-kind assets rejected by construction** with a typed `HOOKS_UNSUPPORTED` reason (never silently materialized) — closes the arbitrary-server-side-code (RCE) vector by construction; the engine's OWN internal `PreToolUse` workspace-boundary hook is a fixed control (not user-uploadable) and is unaffected. **MCP-config-kind assets are redirected to ARCH-015 provisioning** rather than materialized per-run (the REQ-009 rescope); skill-kind continues to ARCH-012 materialization. One-line unit test per asset kind. Depends: ARCH-012, ARCH-015.
- **iter:** v3

## Decision rationale (contested / gap points)

- **D-VAL — centralized Validator vs per-module checks** (quality ⟂ adversarial): adversarial had each module validate its own inputs; quality wanted one Validator to avoid three ad-hoc entry-point checks. **Resolved (quality conceded the ownership, adversarial conceded the facade):** ARCH-008 is a thin *facade* at the two entry points that **delegates** to each module's rule — one fail-fast error shape without duplicating validation logic or inverting module ownership. Simplicity holds (no new rule engine).
- **D-G — gateway provider-down circuit breaker** (quality's one genuine gap; C4-adjacent): no REQ-004 criterion covers an unreachable/hung provider. **Resolved to the minimal option**: fold a bounded timeout→retry→`null` into ARCH-005's `GatewayClient` (reuses REQ-003's existing null-on-terminal-failure semantics; costs no new run-state). **USER CONFIRMED 2026-07-03: keep the minimal breaker in v1** (REQ-004 acceptance extended accordingly). No heavier circuit-breaker/bulkhead is proposed (speculative for a single-node QM tool).
- **C1 sandbox strength vs perf** → honor D6 exactly (process + restricted VM, secrets parent-only); no container/gVisor per run (QM class doesn't warrant it; trust split already removes keys/network/fs from blast radius).
- **C2 single writer vs horizontal scale** → a run is single-authority/single-host (ARCH-002); scale is across *runs*, not within one. No distributed budget consensus (needless flexibility; v1 is localhost).
- **C3 injectable seams vs simplicity** → inject only where non-deterministic/networked/costly: **ARCH-004 (SDK), ARCH-005 (Gateway), ARCH-006 (Store)** + the determinism guards as the clock/RNG seam. ARCH-001/003/007 stay concrete. The ARCH-004 stub alone unlocks full compat-suite dry-runs of `sdlc-run.js`.
- **C4 v2 asset_push RCE before v3 auth** → do not pull OIDC forward (respects D5 sequencing); ship the ARCH-009 no-op seam, gate exposure via tunnel/VPN deployment, document the caveat in ARCH-014.
- **Explicitly NOT built** (both groups agree, Karpathy): pluggable DB backend, pluggable sandbox strategy, pluggable agent-execution engine (D1 fixes the SDK), metrics/alerting stack, autoscaling, cross-run agent memory, prompt self-calibration.

### v3 slice (REQ-016..020) — panel convergence
- **D-SEC — how far to contain secrets (adversarial security ⟂ scalability/testability/simplicity, IC1).** Security wanted an OS filesystem jail per run (uid/mount-namespace/chroot) to make REQ-018's *"no secret on any sandbox-reachable path"* invariant hold generally; that needs elevated caps, complicates docker/systemd deploy, is hard to exercise in CI, and exceeds the QM warrant. Simplicity wanted the existing lexical `file_path` check. **Resolved to the minimal option that still makes the *stated* invariant true — two-layer containment** (ARCH-016): keys off every agent-reachable filesystem (env-only into the proxy) + a realpath/argument-complete/`Bash`-deny confinement callback. **Security conceded the full OS jail; simplicity conceded the lexical-only check** — because the review already ruled a lexical `file_path`-only check *under-builds* a stated invariant, and under-building an invariant is a defect, not a Karpathy win. Full uid-per-run jail noted as the robust alternative, deferred unless a HIGH re-escalates.
- **D-DOS — global RunGuard semaphore (amends ARCH-002, no new module).** v3's SDK harness spawns a CLI subprocess *per agent* plus N stdio-MCP children per session, and the scheduler launches runs autonomously → per-run caps multiply into a single-node exhaustion surface. **Both groups co-signed:** promote the concurrency gate + global agent counter to **one process-global semaphore shared by every `RunGuard`** (budget stays per-run — that is the REQ-002 per-run quantity C2 licenses; the *global* counter is not). REQ-020's timeout must FREE the slot on kill (D-KILL), or a hung provider starves the very resource the semaphore rations. Carried review finding V2, now acute — lands with v3, not after.
- **D-KILL — outer timeout kills the child (adversarial R3 ⟂ "configure the SDK's own retry knobs").** One side argued REQ-020 is met by tuning the CLI's internal retry/backoff. **Resolved to both, with the engine-owned outer bound non-negotiable** (ARCH-017): configure what the SDK exposes, but a black-box child's policy is not our contract — the outer `Promise.race` must **kill** the subprocess (not abandon the promise), else an orphan burns tokens and holds a global slot. Kill-on-timeout + per-attempt token attribution close the "REQ-020 passes its test while budget silently rots" hazard both groups flagged as highest-risk.
- **D-PROFILE — ProviderProfile config vs hardcoded if-Anthropic branch (quality replaceability ⟂ Karpathy "speculative structure").** Quality wanted a per-alias capability table; simplicity read it as speculative. **Resolved for the config table** (folded into ARCH-017): it is a reaction to a *confirmed real defect* (the D-F6 thinking-400 on Ollama), not imagined flexibility — debt already incurred. It also retires the open `effort`-mapping question as a config row instead of future code. Kept as a flat config table, **not** a formal provider SPI/plugin (that abstraction is the part Karpathy cuts).
- **D-REDACT — clear errors vs info-disclosure on the unauthenticated listener (IC4, security ⟂ consumability).** REQ-017/018 demand *clear* errors, but enumerating the provisioned-MCP inventory or the secret-name set to any caller on the no-auth listener is disclosure. **Resolved: clear *typed* error (reason-code taxonomy: `MCP_NOT_PROVISIONED/MCP_PROBE_FAILED/SECRET_MISSING/SECRET_HANDLE_INVALID/HOOKS_UNSUPPORTED/PROVIDER_TIMEOUT`) to the submitting client, but transcripts/dashboard/logs redact resolved secret values and do not enumerate the secret set.** Consumability conceded discoverability endpoints until auth (REQ-012) lands; security conceded that a clear typed error to the trusted-behind-tunnel submitter is fine.
- **D-BIND — non-loopback bind guard (amends ARCH-009, no new module).** v3 stacks an RCE-capable provisioning surface + a secret store on the same unauthenticated listener. **Resolved:** materialize the ARCH-009 no-op middleware in *code* (the review found only the deploy half of C4 shipped) and add a **fail-closed guard that refuses `bind != 127.0.0.1` unless an explicit `insecureNoAuth:true` is set.** Quality saw the guard as creep against the "OIDC deferred" decision; **it is not auth** — a one-`if` fail-closed default that makes the deferral safe. OIDC itself stays deferred (respects D5/scope).
- **D-PROC — proxy/CLI subprocess lifecycle (quality ManagedSubprocess supervisor ⟂ adversarial "let systemd/docker restart-policy do it").** Confirmed real defects: port-4000 collision, proxy never stopped on shutdown, mkdtemp config dirs leaked, and (once D-KILL lands) orphaned CLI children. **Resolved to the minimum that fixes the incurred debt, folded into ARCH-005 (proxy) + ARCH-017 (CLI kill-on-timeout), not a new self-heal subsystem:** derived/dynamic port selection, health probe before first use, SIGTERM→SIGKILL shutdown tied to engine lifecycle, temp-dir cleanup on session end/stop/timeout. **Restart/auto-recovery stays on the supervisor** (systemd `Restart=on-failure` / docker restart-policy per ARCH-014) — no in-process watchdog (adversarial won the "less code" point; quality won the lifecycle-cleanup point).
- **D-PROBE — MCP liveness at provision + submission, no background poller.** Run the existing `mcp-probe` at provision time (reject dead configs) and optionally at run-submission for referenced names (fail-fast). **No continuous background probing** (speculative on a single node) — both groups agree.
- **REQ-009 rescope acknowledged:** its acceptance now delegates hook-rejection and MCP-config-redirect to ARCH-018; ARCH-012 remains the skill-materialization + recursion-guard owner. No trace change to ARCH-012.
- **v3 "Explicitly NOT built"** (both groups, Karpathy): pluggable vault/KMS secret backend, provider-capability probe subsystem, MCP connection pool, background MCP health poller, per-run OS uid/namespace jail, in-process self-heal/watchdog, cross-run agent memory, OTel/metrics stack. All deferred until a real requirement or a re-escalated HIGH forces them.

## Architecture container diagram
```mermaid
flowchart TB
  subgraph CLIENT["Client (local)"]
    CC["MCP client / Claude Code"]
    PLG["ARCH-013 Client Plugin\n(guidance skill · v2)"]
    CC --- PLG
  end

  subgraph PARENT["Run-host parent (trusted)"]
    E1["ARCH-009 Auth Middleware\n(no-op v1 · OIDC v3)"]
    K1["ARCH-001 MCP Facade\n(127.0.0.1; result envelope)"]
    VAL["ARCH-008 Submission Validator\n(meta · alias · agentType)"]
    K2["ARCH-002 Run Manager / RunGuard\n(state · budget · caps · resume)"]
    K4["ARCH-004 Agent Executor\n(Claude Agent SDK · transcript sink)"]
    K5["ARCH-005 Model Gateway\n(GatewayClient → LiteLLM · keys)"]
    K6["ARCH-006 Run Store\n(journal.jsonl + SQLite · RunStore port)"]
    K7["ARCH-007 Workflow Catalog\n(registry + workspaces)"]
    SCH["ARCH-010 Scheduler\n(cron/one-shot/resident · v2)"]
    DASH["ARCH-011 Dashboard (read-only · v2)"]
    ASYNC["ARCH-012 Asset Sync\n(recursion-guarded · v2)"]
  end

  subgraph CHILD["Sandbox child per run (untrusted)"]
    K3["ARCH-003 Sandbox Host\nVM ctx: agent/parallel/pipeline/\nphase/log/args/budget/workflow"]
  end

  CC -->|Streamable HTTP| E1 --> K1
  K1 --> VAL
  K1 --> K2
  K2 -->|"spawn child + IPC"| K3
  K3 -->|"agent()/workflow() over IPC"| K2
  K2 --> K4 --> K5 -->|LiteLLM subprocess| PROV["Anthropic / OpenAI / Gemini / Ollama"]
  K2 --> K6
  K4 --> K6
  K4 --- K7
  K2 --> K7
  VAL -.-> K3
  VAL -.-> K5
  VAL -.-> K7
  SCH --> K7
  SCH --> K2
  DASH --> K6
  ASYNC --> K7
  ASYNC --> K1
  DEP["ARCH-014 Deploy Packaging\n(compose/systemd · v2)"] -.->|brings up| PARENT
```
