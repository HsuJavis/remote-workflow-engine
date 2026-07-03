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

### TASK-019 — Scheduler over catalog+run-manager (cron / one-shot / resident-trigger)
- **status:** draft
- **traces:** ARCH-010
- **estimate:** L
- **iter:** v2

### TASK-020 — Web Dashboard (read-only over the store, live tail)
- **status:** draft
- **traces:** ARCH-011
- **estimate:** L
- **iter:** v2

### TASK-021 — Asset Sync recursion-guarded upload + AssetValidator live probe
- **status:** draft
- **traces:** ARCH-012
- **estimate:** L
- **iter:** v2

### TASK-022 — Claude Code client plugin (MCP config + guidance skill, conflict-free)
- **status:** draft
- **traces:** ARCH-013
- **estimate:** M
- **iter:** v2

### TASK-023 — Deploy packaging (docker-compose / systemd + documented smoke check)
- **status:** draft
- **traces:** ARCH-014
- **estimate:** M
- **iter:** v2

## Template (reference — not a work item)
<!-- TEMPLATE EXAMPLE (uncommented by the stage agent when writing real items)
    ### TASK-001 — <the concrete thing to do>
- **status:** draft
- **traces:** ARCH-001
- **estimate:** <S/M/L or hours>
- **iter:** v1
-->
