---
stage: tasks
status: draft
---
# 03 Tasks

> Independently-implementable work items. Each `### TASK-NNN`'s traces point back to an ARCH.
> v1 kernel (ARCH-001..008) is broken into fine-grained, one-implementer-one-go tasks; v2/v3 extensions
> (ARCH-009..014) get coarser placeholder tasks tagged iter v2/v3 (attach at pre-built seams, zero v1 rework).

## v1 kernel tasks (ARCH-001..008)

### TASK-001 — MCP Streamable HTTP server bootstrap + bind config
- **status:** draft
- **traces:** ARCH-001
- **estimate:** M
- **iter:** v1

### TASK-002 — MCP tool dispatch + uniform result envelope
- **status:** draft
- **traces:** ARCH-001
- **estimate:** M
- **iter:** v1

### TASK-003 — RunGuard: concurrency gate + agent counter + budget accounting
- **status:** draft
- **traces:** ARCH-002
- **estimate:** M
- **iter:** v1

### TASK-004 — Run state machine + suspend/resume/stop lifecycle
- **status:** draft
- **traces:** ARCH-002
- **estimate:** L
- **iter:** v1

### TASK-005 — Resume replay-from-cache orchestration (longest-unchanged-prefix)
- **status:** draft
- **traces:** ARCH-002
- **estimate:** M
- **iter:** v1

### TASK-006 — Sandbox child process + restricted VM context (workflow API surface)
- **status:** draft
- **traces:** ARCH-003
- **estimate:** L
- **iter:** v1

### TASK-007 — Determinism guards + parse/meta validation + size/nesting/item caps
- **status:** draft
- **traces:** ARCH-003
- **estimate:** M
- **iter:** v1

### TASK-008 — IPC seam protocol (child↔parent marshalling of agent()/workflow(); read-only budget view)
- **status:** done
- **traces:** ARCH-003
- **estimate:** M
- **iter:** v1
- **note (D-I3, IMPL-008/IMPL-020):** the type contract (`src/ipc/protocol.ts`) was pre-implemented in
  Gate 5; the runtime marshalling (`src/sandbox/host.ts`, `src/sandbox/child-entry.ts`) was completed
  at Gate 6 once the parallel file-ownership window closed. Re-scoped IT-003 (already green from the
  child-process/agent() round trip) to also cover the `workflow()` round trip; a real bug was found and
  fixed here — `child-entry.ts`'s `agentThrow` handler only checked the `pendingAgent` map, so a
  `workflow()` rejection (unknown name / nesting) correlating through the separate `pendingWorkflow`
  map by the same `callSeq` was silently dropped and the child hung forever.

### TASK-009 — Agent Executor over Claude Agent SDK (schema→StructuredOutput retry, agentType, null-on-terminal)
- **status:** draft
- **traces:** ARCH-004
- **estimate:** L
- **iter:** v1

### TASK-010 — AgentTranscriptSink: agent-<id>.jsonl capture + token-delta accounting
- **status:** draft
- **traces:** ARCH-004
- **estimate:** M
- **iter:** v1

### TASK-011 — Model Gateway: LiteLLM subprocess + GatewayClient.invoke + alias→provider config + key custody
- **status:** draft
- **traces:** ARCH-005
- **estimate:** L
- **iter:** v1

### TASK-012 — Provider-down breaker (bounded timeout→retry→null) + correlation tagging
- **status:** draft
- **traces:** ARCH-005
- **estimate:** S
- **iter:** v1

### TASK-013 — RunStore port: journal.jsonl append + transcript files + SQLite index
- **status:** draft
- **traces:** ARCH-006
- **estimate:** M
- **iter:** v1

### TASK-014 — RunRecorder transition writer + boot-recovery re-hydration
- **status:** draft
- **traces:** ARCH-006
- **estimate:** M
- **iter:** v1

### TASK-015 — Workflow Catalog: named registry (save/list/invoke-by-name, version pinning) + workflow(name) resolution
- **status:** draft
- **traces:** ARCH-007
- **estimate:** M
- **iter:** v1

### TASK-016 — Per-workflow work folder + per-run workspace rooting + retention/cleanup policy
- **status:** draft
- **traces:** ARCH-007
- **estimate:** M
- **iter:** v1

### TASK-017 — Submission Validator facade (meta shape · alias resolve · agentType exists) at run + register entry points
- **status:** draft
- **traces:** ARCH-008
- **estimate:** S
- **iter:** v1

## v2/v3 extension tasks (ARCH-009..014) — coarse placeholders, attach at existing seams

### TASK-018 — Auth Middleware pluggable no-op seam (v3 OIDC resource-server swap)
- **status:** draft
- **traces:** ARCH-009
- **estimate:** L
- **iter:** v3

> **v2 refinement (2026-07-04):** the coarse v2 placeholders below are split along their test seams
> (adversarial-group task-splitting note) into one-implementer-one-go tasks. TASK-019..023 refined in
> place; TASK-024..027 added for the split-out halves. All attach at existing v1 seams (Catalog/RunManager/
> RunStore/Clock/MCP-facade) with zero v1 rework. Design in `04-design.md` DES-016..023.

### TASK-019 — Schedule store + CRUD + `workflow_trigger` (resident) over Catalog+RunManager
- **status:** draft
- **traces:** ARCH-010
- **estimate:** M
- **iter:** v2
- **note:** SQLite-persisted `Schedule` records (survive restart, like the catalog per REQ-014); `schedule_create/list/delete/setEnabled` + `workflow_trigger(name,args)` MCP tools returning `ResultEnvelope`; resident trigger starts a run via the SAME `RunManager.start` path as `workflow_run` (inherits per-run `budget` enforcement); disabled → `error{code:'SCHEDULE_DISABLED'}`, unknown workflow → `error{code:'WORKFLOW_NOT_FOUND'}`. cron/`at`/workflow-name validated at SUBMISSION (delegate to Catalog + DES-012). **Seam-consistency (Exit-Gate-5, KP-15 fix):** CRUD stamps `nextFire`/`lastFire` via the INJECTED `Clock` (never a bare `Date.now()`); the cron next-fire math itself is delegated to `computeNextFire` (TASK-024). The earlier "no clock needed" note was stale — `create` computes an initial `nextFire` so `tick()` has an immediately-usable due-time.

### TASK-024 — Cron/one-shot firing engine: pure `tick(now)` + `computeNextFire` over injected Clock+Ticker
- **status:** draft
- **traces:** ARCH-010
- **estimate:** M
- **iter:** v2
- **note:** the clock/boundary-heavy half of the scheduler. Pure `tick(now)` returns due firings; pure `computeNextFire(cron,tz,after)`; injected `Ticker` port (real `setInterval`, fake `advance()`) + injected `Clock` (DES-014) — NO bare `Date.now()`/`setTimeout` in scheduler logic; every method that reads time takes the injected Clock (Exit-Gate-5 seam consistency). Missed-fire policy: cron = fire-once-on-catch-up-then-resume (never backfill every slot), one-shot past-`at` = fire-immediately then auto-complete (disable). Boot re-arm from persistence using the injected Clock. Overlap = allowed (each fire an independent run).

### TASK-020 — Dashboard pure render model `buildDashboardModel` over the RunStore port
- **status:** draft
- **traces:** ARCH-011
- **estimate:** S
- **iter:** v2
- **note:** the UT-able data layer: pure `buildDashboardModel(runs, view?) → DashboardVM` shaping exactly the existing `RunSummary[]`/`RunStatusView`/`TranscriptEvent[]` (no parallel dashboard DTO). Fully covered by UT against the InMemory RunStore fake.

### TASK-025 — Dashboard read-only HTTP transport + live-tail (poll RunStore) + static renderer
- **status:** draft
- **traces:** ARCH-011
- **estimate:** M
- **iter:** v2
- **note:** read-only HTTP endpoints serving the DES-018 VM as JSON; live update = poll the already-injectable RunStore port (reuse the test seam, no bespoke event bus); NO mutation/write endpoint (cannot perturb a run); degrade on store read error (partial view + error badge, never a 500 that takes the page down). Transport validated at integration/real-tier.

### TASK-021 — Asset Sync core: `asset_push/list/delete` + recursion-guard + path-safety predicates
- **status:** draft
- **traces:** ARCH-012
- **estimate:** M
- **iter:** v2
- **note:** transport-agnostic, UT-heavy core writing into ARCH-007's workspace. `AssetPush{kind,name,files[{path,contentB64}]}`; recursion-guard predicate (D4): reject/strip self-MCP-config (endpoint resolves to this server's own bind addr/port) and this system's own plugin/guidance-skill identity (reserved name prefix), reporting every exclusion in the envelope `{stored[],excluded[{name,reason}]}`; path-safety predicate: every `files[].path` relative + normalizes INSIDE the target asset dir (reject `..`/absolute/symlink) — same rooting invariant as DES-011; partial-push atomicity (any file fails → reject whole push). All pure/UT-covered.

### TASK-026 — Asset MCP-config live-probe validator behind an injected `McpProbe` port
- **status:** draft
- **traces:** ARCH-012
- **estimate:** S
- **iter:** v2
- **note:** the one network dependency, isolated behind an injected `McpProbe` port (fake accepts/rejects in UT; real probe exercised ONLY at real-tier). Classifies transport: remote-HTTP / npx-stdio = server-runnable → probed; non-runnable or interactively-authenticated-headless (compat-spec §5) → rejected with a machine-readable reason CODE (not just a human string; consumability). Rejection is at push time, before the asset lands.

### TASK-022 — Claude Code client plugin artifact (dir layout + MCP config + guidance skill)
- **status:** draft
- **traces:** ARCH-013
- **estimate:** M
- **iter:** v2
- **note:** mostly non-code. Plugin dir layout: MCP connection config (points at the remote server) + a guidance skill (markdown) teaching agents the async `submit→poll workflow_status→fetch workflow_result` contract, the new v2 tools' envelope-not-exception gotchas, and local-Workflow-tool vs remote coexistence (no tool-namespace collision). Self-excluded from asset sync (D4). Keep DES thin — one collision-avoidance + one self-exclusion invariant, no over-engineering.

### TASK-023 — Deploy packaging: docker-compose + systemd unit + documented smoke check
- **status:** draft
- **traces:** ARCH-014
- **estimate:** M
- **iter:** v2
- **note:** docker-compose (with a LiteLLM-optional profile so the already-more-reliable direct-fetch/SDK path can run without the LiteLLM subprocess — replaceability) + systemd unit (`Restart=on-failure`, the self-healing seam); LiteLLM path requires Python 3.11/3.12 (D-R3, documented); scripted non-interactive exit-code smoke check (submit a sample workflow → completes); DEPLOY.md leads with the dependency-free path and loudly documents the v2 no-auth caveat (`asset_push` = server-side code execution → require SSH-tunnel/VPN until v3 auth). Identical steps localhost + remote.

### TASK-027 — Deploy hardening: orphan-LiteLLM reap + configurable LiteLLM port + pre-bind check
- **status:** draft
- **traces:** ARCH-014
- **estimate:** S
- **iter:** v2
- **note:** closes the real, repeatedly-Gate-7.5-reproduced operational hazards (both panels flagged binding): SIGTERM/SIGINT handler cascade-kills the LiteLLM child (process-group kill, not just `child.kill()` on the direct handle); LiteLLM port is configurable (not hard-coded 4000); pre-bind port ownership/liveness check fails fast with an actionable message instead of false-positive-attaching to a stale proxy. Verified inside the TASK-023 smoke check (boot→run→shutdown→assert no leaked child, no port clash).

## Template (reference — not a work item)
<!-- TEMPLATE EXAMPLE (uncommented by the stage agent when writing real items)
    ### TASK-001 — <the concrete thing to do>
- **status:** draft
- **traces:** ARCH-001
- **estimate:** <S/M/L or hours>
- **iter:** v1
-->
