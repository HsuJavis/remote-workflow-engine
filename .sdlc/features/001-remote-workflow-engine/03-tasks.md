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
- **status:** done
- **traces:** ARCH-001
- **estimate:** M
- **iter:** v1

### TASK-002 — MCP tool dispatch + uniform result envelope
- **status:** done
- **traces:** ARCH-001
- **estimate:** M
- **iter:** v1

### TASK-003 — RunGuard: concurrency gate + agent counter + budget accounting
- **status:** done
- **traces:** ARCH-002
- **estimate:** M
- **iter:** v1

### TASK-004 — Run state machine + suspend/resume/stop lifecycle
- **status:** done
- **traces:** ARCH-002
- **estimate:** L
- **iter:** v1

### TASK-005 — Resume replay-from-cache orchestration (longest-unchanged-prefix)
- **status:** done
- **traces:** ARCH-002
- **estimate:** M
- **iter:** v1

### TASK-006 — Sandbox child process + restricted VM context (workflow API surface)
- **status:** done
- **traces:** ARCH-003
- **estimate:** L
- **iter:** v1

### TASK-007 — Determinism guards + parse/meta validation + size/nesting/item caps
- **status:** done
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
- **status:** done
- **traces:** ARCH-004
- **estimate:** L
- **iter:** v1

### TASK-010 — AgentTranscriptSink: agent-<id>.jsonl capture + token-delta accounting
- **status:** done
- **traces:** ARCH-004
- **estimate:** M
- **iter:** v1

### TASK-011 — Model Gateway: LiteLLM subprocess + GatewayClient.invoke + alias→provider config + key custody
- **status:** done
- **traces:** ARCH-005
- **estimate:** L
- **iter:** v1

### TASK-012 — Provider-down breaker (bounded timeout→retry→null) + correlation tagging
- **status:** done
- **traces:** ARCH-005
- **estimate:** S
- **iter:** v1

### TASK-013 — RunStore port: journal.jsonl append + transcript files + SQLite index
- **status:** done
- **traces:** ARCH-006
- **estimate:** M
- **iter:** v1

### TASK-014 — RunRecorder transition writer + boot-recovery re-hydration
- **status:** done
- **traces:** ARCH-006
- **estimate:** M
- **iter:** v1

### TASK-015 — Workflow Catalog: named registry (save/list/invoke-by-name, version pinning) + workflow(name) resolution
- **status:** done
- **traces:** ARCH-007
- **estimate:** M
- **iter:** v1

### TASK-016 — Per-workflow work folder + per-run workspace rooting + retention/cleanup policy
- **status:** done
- **traces:** ARCH-007
- **estimate:** M
- **iter:** v1

### TASK-017 — Submission Validator facade (meta shape · alias resolve · agentType exists) at run + register entry points
- **status:** done
- **traces:** ARCH-008
- **estimate:** S
- **iter:** v1

## v2/v3 extension tasks (ARCH-009..014) — coarse placeholders, attach at existing seams

### TASK-018 — Auth Middleware pluggable no-op seam (v3 OIDC resource-server swap)
- **status:** blocked
- **traces:** ARCH-009
- **estimate:** L
- **iter:** v3

> **v2 refinement (2026-07-04):** the coarse v2 placeholders below are split along their test seams
> (adversarial-group task-splitting note) into one-implementer-one-go tasks. TASK-019..023 refined in
> place; TASK-024..027 added for the split-out halves. All attach at existing v1 seams (Catalog/RunManager/
> RunStore/Clock/MCP-facade) with zero v1 rework. Design in `04-design.md` DES-016..023.

### TASK-019 — Schedule store + CRUD + `workflow_trigger` (resident) over Catalog+RunManager
- **status:** done
- **traces:** ARCH-010
- **estimate:** M
- **iter:** v2
- **note:** SQLite-persisted `Schedule` records (survive restart, like the catalog per REQ-014); `schedule_create/list/delete/setEnabled` + `workflow_trigger(name,args)` MCP tools returning `ResultEnvelope`; resident trigger starts a run via the SAME `RunManager.start` path as `workflow_run` (inherits per-run `budget` enforcement); disabled → `error{code:'SCHEDULE_DISABLED'}`, unknown workflow → `error{code:'WORKFLOW_NOT_FOUND'}`. cron/`at`/workflow-name validated at SUBMISSION (delegate to Catalog + DES-012). **Seam-consistency (Exit-Gate-5, KP-15 fix):** CRUD stamps `nextFire`/`lastFire` via the INJECTED `Clock` (never a bare `Date.now()`); the cron next-fire math itself is delegated to `computeNextFire` (TASK-024). The earlier "no clock needed" note was stale — `create` computes an initial `nextFire` so `tick()` has an immediately-usable due-time.

### TASK-024 — Cron/one-shot firing engine: pure `tick(now)` + `computeNextFire` over injected Clock+Ticker
- **status:** done
- **traces:** ARCH-010
- **estimate:** M
- **iter:** v2
- **note:** the clock/boundary-heavy half of the scheduler. Pure `tick(now)` returns due firings; pure `computeNextFire(cron,tz,after)`; injected `Ticker` port (real `setInterval`, fake `advance()`) + injected `Clock` (DES-014) — NO bare `Date.now()`/`setTimeout` in scheduler logic; every method that reads time takes the injected Clock (Exit-Gate-5 seam consistency). Missed-fire policy: cron = fire-once-on-catch-up-then-resume (never backfill every slot), one-shot past-`at` = fire-immediately then auto-complete (disable). Boot re-arm from persistence using the injected Clock. Overlap = allowed (each fire an independent run).

### TASK-020 — Dashboard pure render model `buildDashboardModel` over the RunStore port
- **status:** done
- **traces:** ARCH-011
- **estimate:** S
- **iter:** v2
- **note:** the UT-able data layer: pure `buildDashboardModel(runs, view?) → DashboardVM` shaping exactly the existing `RunSummary[]`/`RunStatusView`/`TranscriptEvent[]` (no parallel dashboard DTO). Fully covered by UT against the InMemory RunStore fake.

### TASK-025 — Dashboard read-only HTTP transport + live-tail (poll RunStore) + static renderer
- **status:** done
- **traces:** ARCH-011
- **estimate:** M
- **iter:** v2
- **note:** read-only HTTP endpoints serving the DES-018 VM as JSON; live update = poll the already-injectable RunStore port (reuse the test seam, no bespoke event bus); NO mutation/write endpoint (cannot perturb a run); degrade on store read error (partial view + error badge, never a 500 that takes the page down). Transport validated at integration/real-tier.

### TASK-021 — Asset Sync core: `asset_push/list/delete` + recursion-guard + path-safety predicates
- **status:** done
- **traces:** ARCH-012
- **estimate:** M
- **iter:** v2
- **note:** transport-agnostic, UT-heavy core writing into ARCH-007's workspace. `AssetPush{kind,name,files[{path,contentB64}]}`; recursion-guard predicate (D4): reject/strip self-MCP-config (endpoint resolves to this server's own bind addr/port) and this system's own plugin/guidance-skill identity (reserved name prefix), reporting every exclusion in the envelope `{stored[],excluded[{name,reason}]}`; path-safety predicate: every `files[].path` relative + normalizes INSIDE the target asset dir (reject `..`/absolute/symlink) — same rooting invariant as DES-011; partial-push atomicity (any file fails → reject whole push). All pure/UT-covered.

### TASK-026 — Asset MCP-config live-probe validator behind an injected `McpProbe` port
- **status:** done
- **traces:** ARCH-012
- **estimate:** S
- **iter:** v2
- **note:** the one network dependency, isolated behind an injected `McpProbe` port (fake accepts/rejects in UT; real probe exercised ONLY at real-tier). Classifies transport: remote-HTTP / npx-stdio = server-runnable → probed; non-runnable or interactively-authenticated-headless (compat-spec §5) → rejected with a machine-readable reason CODE (not just a human string; consumability). Rejection is at push time, before the asset lands.

### TASK-022 — Claude Code client plugin artifact (dir layout + MCP config + guidance skill)
- **status:** done
- **traces:** ARCH-013
- **estimate:** M
- **iter:** v2
- **note:** mostly non-code. Plugin dir layout: MCP connection config (points at the remote server) + a guidance skill (markdown) teaching agents the async `submit→poll workflow_status→fetch workflow_result` contract, the new v2 tools' envelope-not-exception gotchas, and local-Workflow-tool vs remote coexistence (no tool-namespace collision). Self-excluded from asset sync (D4). Keep DES thin — one collision-avoidance + one self-exclusion invariant, no over-engineering.

### TASK-023 — Deploy packaging: docker-compose + systemd unit + documented smoke check
- **status:** done
- **traces:** ARCH-014
- **estimate:** M
- **iter:** v2
- **note:** docker-compose (with a LiteLLM-optional profile so the already-more-reliable direct-fetch/SDK path can run without the LiteLLM subprocess — replaceability) + systemd unit (`Restart=on-failure`, the self-healing seam); LiteLLM path requires Python 3.11/3.12 (D-R3, documented); scripted non-interactive exit-code smoke check (submit a sample workflow → completes); DEPLOY.md leads with the dependency-free path and loudly documents the v2 no-auth caveat (`asset_push` = server-side code execution → require SSH-tunnel/VPN until v3 auth). Identical steps localhost + remote.

### TASK-027 — Deploy hardening: orphan-LiteLLM reap + configurable LiteLLM port + pre-bind check
- **status:** done
- **traces:** ARCH-014
- **estimate:** S
- **iter:** v2
- **note:** closes the real, repeatedly-Gate-7.5-reproduced operational hazards (both panels flagged binding): SIGTERM/SIGINT handler cascade-kills the LiteLLM child (process-group kill, not just `child.kill()` on the direct handle); LiteLLM port is configurable (not hard-coded 4000); pre-bind port ownership/liveness check fails fast with an actionable message instead of false-positive-attaching to a stale proxy. Verified inside the TASK-023 smoke check (boot→run→shutdown→assert no leaked child, no port clash).

## v3 slice (REQ-016..021 / ARCH-015..019 + amendments D-DOS/D-BIND/D-PROC)

### TASK-028 — MCP Provisioning Registry: SQLite store CRUD + typed errors + strict-by-name injection set
- **status:** done
- **traces:** ARCH-015
- **estimate:** M
- **iter:** v3
- **note:** Sibling catalog over the ARCH-006 store: `name → {kind:'stdio'|'http', config}`. Pure store-level CRUD (`register/get/list/delete`) + a pure `resolveInjectedMcps(referencedNames) → {configs, error?}` that returns ONLY the explicitly-referenced entries (`strictMcpConfig` preserved; host ambient MCP never inherited — VAL-003 invariant) and throws typed `MCP_NOT_PROVISIONED` on an unknown name (never a silent no-op). All UT with the InMemory store fake — no network. The `mcp_provision`/probe half is TASK-029.

### TASK-029 — `mcp_provision` admin tool + provision-time McpProbe wiring
- **status:** done
- **traces:** ARCH-015
- **estimate:** S
- **iter:** v3
- **note:** The admin-write tool (real `tools/list` JSON schema from day one — no placeholder-schema regression) that provisions a config after a live probe behind the existing injected `McpProbe` port: dead config → `MCP_PROBE_FAILED`, nothing persisted; live → row persisted. Reuses the v2 `McpProbe` seam (UT with fake prober). Write-authority guard (refuse when bind != loopback) is enforced via TASK-036's `isLoopback`.

### TASK-030 — Pure SecretResolver: `resolveConfig` (atomic) + `redact` + typed handle errors
- **status:** done
- **traces:** ARCH-016
- **estimate:** M
- **iter:** v3
- **note:** Two pure functions, exhaustive UTs, no fs/net/process: `resolveConfig(config, secretSource) → resolvedConfig` walks a config object replacing every `${secret:name}` from a preloaded source map — **atomic all-or-nothing** (a mixed good/missing config throws `SECRET_MISSING`, resolves nothing partial), `SECRET_HANDLE_INVALID` on malformed grammar (never literal-handle-passed-through); and `redact(event, secretValues) → event` for the capture path. Property test: given `${secret:x}`, no byte of x's resolved value appears in any transcript/SessionInitRecord. Source loading is TASK-031.

### TASK-031 — Secret source loader (startup) + two-layer parent-only containment hardening
- **status:** done
- **traces:** ARCH-016
- **estimate:** M
- **iter:** v3
- **note:** Thin adapter loading `${secret:name}` sources from systemd `LoadCredential`/process env into a parent-memory map at startup (synchronous `resolve(handle) → value | SECRET_MISSING`; NO async/vault impl until a real second backend — Karpathy). Layer 2: provider keys stay only in the LiteLLM proxy process env; MCP secrets never written to any workspace path; harden the ARCH-007 confinement callback to **realpath-based + argument-name-complete + `Bash`-deny-outside-root** so a tool-capable agent cannot `cat` the proxy config or a sibling run's journal. Target-tier: planted-symlink integration + agent-cannot-read-secret case. **Wiring `isPathContained`→`claude-agent-sdk-client.ts`'s `isInsideWorkspace` is done at the Gate-6 integrate step** (shared file, deferred out of parallel-impl to avoid collision).

### TASK-032 — Pure SDK Session-Options Builder + ProviderProfile config table + SessionInitRecord
- **status:** done
- **traces:** ARCH-017
- **estimate:** M
- **iter:** v3
- **note:** The master v3 test seam — a **pure** `buildSessionOptions(providerClass, alias, config, provisionedRefs, resolvedSecrets) → SDKOptions` that imports no fs/net/process/clock/env: sets `thinking:{type:'disabled'}` for non-Anthropic aliases (Anthropic at SDK default — D-F6 regression guard), the curated tool allowlist only, and the strict injected-MCP set. Capability is a flat **ajv-boot-validated** `ProviderProfile` row per alias (`providerClass, supportsExtendedThinking, timeoutMs, retries, effortMapping`; `supportsToolUse` CUT — no consumer) — single source of truth shared with the ARCH-008 alias validator; a typo'd profile field fails boot with `CONFIG_SCHEMA_ERROR`; unprofiled alias → fail-safe default (thinking disabled) + submission-time `ALIAS_PROFILE_MISSING`. Emits one `SessionInitRecord` (handle NAMES only, **+ `settingSources` + `resolvedProjectRoot`** for REQ-021 auditability) as the transcript head. **Session-init project-marker re-walk (R2, Adv#3):** at session-build re-run TASK-038's `findProjectMarkerAncestor(cwd, workRoot, existsImpl, realpathImpl)` from the run-workspace `cwd` up to (excluding) `workRoot`; on a marker hit refuse the build (typed error) — closes the intra-run REQ-021 leak an agent re-opens by writing `CLAUDE.md`/`.git` into its workspace (load-bearing precondition: ARCH-016 confines agent writes to the run-workspace subtree; if weakened the cross-run variant escalates to HIGH). Exhaustive table-driven UT matrix (providerClass × thinking × allowlist × MCP refs × secret handles × cwd-marker); purity UT (frozen input → deterministic); **`settingSources`-never-`user`/`local` regression UT** (R9 — the ternary guarding the `~/.claude/CLAUDE.md` global-memory leak class the workRoot walk cannot catch). Impure race is TASK-033.

### TASK-033 — Impure outer timeout race + kill-on-timeout + slot-free-exactly-once + FailureEnvelope
- **status:** done
- **traces:** ARCH-017
- **estimate:** M
- **iter:** v3
- **note:** `Promise.race(query, timeoutMs)` over the **injected Clock** (not real ms — UT time-travels the ~4-min CLI backoff), killing the CLI child on timeout via TASK-037's process-group primitive → `agent()` resolves `null` on BOTH gateway paths (bound observably applied, closing the v2 no-effect state). One `withSlot(fn)` try/finally frees the D-DOS slot **exactly once** keyed to race outcome (idempotent guard) across success/schema-exhausted/provider-error/timeout-kill/suspend/stop — UT with injected semaphore(max=1) asserts count returns to 0 on every branch. Writes one internal `FailureEnvelope{kind:timeout|provider_error|tool_error|schema_mismatch,...}` before `null` (never fake success text) and transitions the AgentRecord to a terminal `failed`(timeout)/`aborted`(suspend/stop) state — no phantom `running`.

### TASK-034 — Asset-Ingestion Policy: pure classifier (hooks-drop + MCP-config redirect)
- **status:** done
- **traces:** ARCH-018
- **estimate:** S
- **iter:** v3
- **note:** A pure classifier at the ARCH-012 asset boundary, one UT per asset kind: hook-kind → typed `HOOKS_UNSUPPORTED` reject by construction (closes the RCE vector; the engine's OWN internal `PreToolUse` boundary hook is unaffected); MCP-config-kind → redirect to ARCH-015 provisioning (not per-run materialized); skill-kind → continue to ARCH-012 materialization. No live probe here (that's provision-time, TASK-029). **Wiring `classifyAsset`→`server.ts`'s `asset_push` case is done at the Gate-6 integrate step** (shared file, deferred out of parallel-impl; makes IT-041/VAL-022 green).

### TASK-035 — D-DOS: global RunGuard agent semaphore (single injectable instance + gauge)
- **status:** done
- **traces:** ARCH-002
- **estimate:** S
- **iter:** v3
- **note:** Promote per-run concurrency to a **process-global** agent-slot semaphore rationing SDK-CLI subprocess spawns: ONE instance built at the composition root, passed by reference into every RunGuard (true global rationing, still injectable/resettable — never a module `static`). FIFO queue policy (single greedy `parallel()` can queue others — documented accepted single-node behavior). Exposes a gauge (total/in-use/queued) on the existing `workflow_status`/server-status response so starvation is observable, not "everything hangs, no error". Release invariant proven by TASK-033's `withSlot`.

### TASK-036 — D-BIND: `isLoopback` fail-closed bind guard + provision write-authority refuse
- **status:** done
- **traces:** ARCH-009
- **estimate:** S
- **iter:** v3
- **note:** One tested `isLoopback(bind)` predicate accepting `127.0.0.0/8` + `::1`, rejecting everything else (truth-table UT) — replaces any `=== '127.0.0.1'` string compare (both a false-reject of `::1` and a bypass risk). Fail-closed: a non-loopback bind requires explicit opt-in; and `mcp_provision` (RCE-grade write authority) refuses to serve when `bind != loopback` even if `insecureNoAuth:true` — stricter default than a read. The guard is NOT auth (D-BIND); real auth stays REQ-012/ARCH-009 v-future.

### TASK-037 — D-PROC: per-agent CLI subprocess lifecycle (process-group kill + temp-dir + race-safe port + probe-gate)
- **status:** done
- **traces:** ARCH-005
- **estimate:** M
- **iter:** v3
- **note:** The reusable spawn/kill primitive TASK-033 consumes: spawn the SDK CLI **detached in its own process group**, and kill(`-pgid`) with SIGTERM→SIGKILL escalation so the N stdio-MCP grandchildren are reaped too (a bare `child.kill()` orphans them — re-creating the orphan pathology at higher volume). Temp-dir cleanup on the same path. Proxy lifecycle: **race-safe** port selection (bind port 0 / retry-on-EADDRINUSE, not check-then-bind) and the health probe gates the FIRST agent call (not server boot) so a slow proxy degrades one run, not the engine. Restart/auto-recovery stays on systemd/docker (`Restart=on-failure`) — no in-process watchdog. Injected `spawnImpl`/`killImpl` seam so a UT asserts kill-called-once, never a real `claude` CLI.

### TASK-038 — WorkRoot Project-Isolation Guard: pure `findProjectMarkerAncestor` + boot fail-fast wrapper + `realpathSync` + boot wiring
- **status:** done
- **traces:** ARCH-019
- **estimate:** S
- **iter:** v3
- **note:** Extract the one pure predicate `findProjectMarkerAncestor(path, stopAt, existsImpl, realpathImpl) → string | null` — `realpathSync` the start path (NOT bare `resolve`: `resolve` misses a symlinked workRoot whose target lives in a git repo — Adv#5), then walk existing ancestors up to (excluding) `stopAt` returning the first carrying `.git`/`CLAUDE.md` (as file OR dir), else `null`. `assertWorkRootIsolated(workRoot, existsImpl, realpathImpl)` is the throwing boot wrapper (`stopAt = filesystem root`) raising `WORKROOT_INSIDE_PROJECT` naming the offending ancestor + marker type + remedy; a marker-free data dir returns void. Non-existent `workRoot` does NOT early-return (checks existing ancestors) → warn+proceed on a clean chain, never bypass. Boot wiring stays in `main.ts` `composeConfig` (fail-closed). The SAME predicate is reused at session-build by TASK-032 (second call site, no throw). Both `existsImpl`/`realpathImpl` injected — all pure UTs, no live fs, no real model. Truth-table UTs: marker at workRoot; marker at mid-ancestor; `.git`-file vs `.git`-dir (both trip); clean-to-`/` (no false positive, no infinite loop); `~/.claude` alone does not trip; symlink-into-project trips only via `realpathSync`; session-init variant: marker written in workspace → build refused / clean → proceeds.

## Template (reference — not a work item)
<!-- TEMPLATE EXAMPLE (uncommented by the stage agent when writing real items)
    ### TASK-001 — <the concrete thing to do>
- **status:** draft
- **traces:** ARCH-001
- **estimate:** <S/M/L or hours>
- **iter:** v1
-->

### TASK-039 — recursive workflow_artifacts + sha256 (REQ-023)
- **status:** done
- **traces:** ARCH-020
### TASK-040 — workflow_artifact_get chunked/capped/realpath-contained (REQ-022)
- **status:** done
- **traces:** ARCH-020
### TASK-041 — readBody body-size cap → 413 (REQ-024)
- **status:** done
- **traces:** ARCH-020
### TASK-042 — seed materialization into run workspace + .claude strip (REQ-025)
- **status:** done
- **traces:** ARCH-021
### TASK-043 — workspace_purge + TTL GC (REQ-026)
- **status:** done
- **traces:** ARCH-022
### TASK-044 — implement issue_report tool + IssueReporter/GithubIssueClient (REQ-027..030)
- **status:** done
- **traces:** ARCH-023
- **iter:** v5
### TASK-045 — implement issue read/reply tools + dedup + enrichment
- **status:** done
- **traces:** ARCH-024
- **iter:** v6

### TASK-046 — provider-native SDK routing + OpenRouter provider/passthrough
- **status:** done
- **traces:** ARCH-025
- **iter:** v7

### TASK-047 — models_list federated model catalog + filtering
- **status:** done
- **traces:** ARCH-026
- **iter:** v7

### TASK-048 — N-level workflow() composition: depth/cycle/descendant guards + depth-safe frame-based journal keying + config caps
- **status:** done
- **traces:** ARCH-027
- **iter:** v8

### TASK-049 — surface the composite call-tree in the read-model: frame-tag agents + record nested workflow() boundary nodes + expose via workflow_status / GET /api/runs/:id
- **status:** done
- **traces:** ARCH-028
- **iter:** v8

### TASK-050 — dashboard UI: pure buildDagModel + /api/{workflows,runs/:id/dag} endpoints + rewritten nested-group SPA (cards → live DAG → agent log)
- **status:** done
- **traces:** ARCH-029
- **iter:** v8

### TASK-051 — live execution detail: stamp phase timestamps + per-agent started/ended timing, expose durationMs on the dag node, render the phase timeline + current step + per-node duration
- **status:** done
- **traces:** ARCH-030
- **iter:** v8

### TASK-052 — cross-trigger chaining + run-admission: fire an authoritative onTerminal from _transition, add a maxConcurrentRuns admission gate to start(), build a durable ContinuationStore (chain_create/chain_list) reconciled at boot, wire it into server composition via a late-bound closure
- **status:** done
- **traces:** ARCH-031
- **iter:** v8

### TASK-053 — cross-restart DAG persistence: add a RunDagSnapshot + saveSnapshot to the RunStore port, capture it once at the terminal _transition (phases + workflowNodes + full agent records), overlay it on getRun read-back (both InMemory + Sqlite stores), migration-free run_snapshots side table
- **status:** done
- **traces:** ARCH-032
- **iter:** v8

### TASK-054 — external-ingress security: add Host/Origin allowlist helpers to net-guard + a 403 guard at the top of the HTTP handler, build a durable WebhookRegistry (HMAC verify + timestamp window + delivery dedup + fire pre-bound), add POST /hooks/:id ingress route and webhook_create/list/delete tools
- **status:** done
- **traces:** ARCH-033
- **iter:** v8

### TASK-055 — crash durability (Option X): add `interrupted` to the RunStatus union, reclassify boot-time `running`→`interrupted` in hydrateAll, add `RunStore.getJournal` read-back (both stores, crash-truncation-robust), accept `interrupted` in resume()/_requireLive and populate the rehydrated journal from getJournal + re-resolve a named workflow's script from the catalog, add the `.st-interrupted` dashboard color
- **status:** done
- **traces:** ARCH-034
- **iter:** v8

### TASK-056 — workflow discovery: add `src/workflow-meta.ts` (`parseMeta` reusing `checkMeta` + `parseWorkflowSkeleton` static scan), extend WorkflowCatalog (`list()` returns `description`, new `getFull(name)`), add the `workflow_get({name})` MCP tool (full detail + skeleton, `WORKFLOW_NOT_FOUND` for unknown) + widen `workflow_list` with `description`, add `GET /api/workflows/:name/skeleton`, and surface the description + clickable predicted DAG on the dashboard workflow card
- **status:** done
- **traces:** ARCH-035
- **iter:** v9

## v10 — efficient large-codebase seeding (TASK-057, TASK-058)

### TASK-057 — compressed request bodies + typed too-large error: add `MAX_DECOMPRESSED_BYTES` + a typed `BodyTooLargeError{code,cap,phase,hint}`, split `readBody` into a raw capped `readBodyBuffer` + a new `readBodyDecoded` (honors `Content-Encoding: gzip|deflate` with a bounded decompressed output), route the `/mcp` handler through `readBodyDecoded`, and emit the typed 413 from both the `/mcp` and webhook 413 catch blocks (webhook keeps the RAW un-decoded body for its HMAC)
- **status:** done
- **traces:** ARCH-036
- **iter:** v10

### TASK-058 — the CAS substrate: add `src/cas-store.ts` (`CasStore` — immutable blob pool + per-namespace SQLite refset, byte-verify `putBlob`, per-namespace `missing`/`hasRef`, `readBlob`/`readBlobSync`), extract a shared `seedPathVerdict` + add `materializeManifest` (CAS-bytes assemble + masked exec bit) in `src/workspace-seed.ts`, thread a `cas?` dep into `RunManager` (fail-fast `MISSING_BLOBS`/`CAS_UNAVAILABLE` before `createRun` + assemble from CAS), add `seedManifest`/`seedNamespace` to `RunSpec` + `workflow_run`, fix `toErrEnvelope` to prefer a coded error's `.code`, and construct the `CasStore` + add the `blob_put`/`seed_plan` tools + a `casDir` config in `src/server.ts`
- **status:** done
- **traces:** ARCH-037
- **iter:** v10

## v11 — issue observability: version field + read-only Issues dashboard (TASK-059, TASK-060)

### TASK-059 — every filed issue carries a version: add optional `version` to `IssueReportInput`, add a `resolveEngineVersion()` seam (`package.json` version + best-effort `git describe`, computed once at the composition root to replace the hardcoded `ENGINE_VERSION`), apply the effective-version rule (`input.version?.trim() || cfg.engineVersion`) in `report()`, and make `renderIssueBody` always emit a labelled `Version:` line plus all five report fields (repro/version/severity/analysis/log) with a placeholder when absent
- **status:** done
- **traces:** ARCH-023
- **iter:** v11

### TASK-060 — read-only Issues dashboard: add `GET /api/issues` (one `issue_list({labels:['agent-reported'],state:'all'})` partitioned into open/resolved, degrading to `{open:[],resolved:[],degraded}` on token-missing/API-error, HTTP 200 never 500) + `GET /api/issues/:number` (issue detail via `getIssue`) to `handleDashboardRequest` (thread the `issueReporter` param in), widen the top-level router predicate at `src/server.ts` to also match `/api/issues`, and add a read-only Issues view to `src/dashboard-page.ts` (Open/Resolved groups linking to GitHub, click-to-detail, `textContent`/`JSON.stringify` only, route disambiguated from `/dashboard/<runId>`)
- **status:** done
- **traces:** ARCH-024
- **iter:** v11

<!-- ── v11 Sprint 2 (REQ-068..070 / ARCH-038..040): tag-triggered, privilege-separated, fully-automatic self-update. TASK-061..065. ── -->

### TASK-061 — pure GitHub tag-webhook verifier (`src/self-update-webhook.ts`): `extractTag(event, body)` (per-event-shape: `ping`→null, `create` ref_type tag→ref, `create` branch→null, `push` `refs/tags/<t>` deleted:false→`<t>`, `push` deleted:true / `refs/heads`→null) + `verifyTagWebhook(input, deps)→TagVerdict` (HMAC-SHA256 over the RAW `Buffer` never `.toString`, constant-time compare after stripping `sha256=`, anchored tag pattern `^v[0-9][0-9A-Za-z.\-+]*$`) — no fs/net/process, clock-free by design (GitHub signs no timestamp). Exhaustive UT over the boundary table.
- **status:** done
- **traces:** ARCH-038
- **iter:** v11

### TASK-062 — engine-side wiring + flag-writer (`src/self-update.ts` + `src/server.ts`): the `POST /github/webhook` route reading via `readBodyBuffer` (RAW, never `readBodyDecoded`) and Host-exempted before the REQ-056 allowlist (HMAC is its auth, Origin stays fail-open); provisioned `RWE_SECRET_GITHUB_WEBHOOK_SECRET` via `loadSecretSourceFromEnv` (server-side only, never logged/dashboard); delivery-id dedup (`update_deliveries` side table, `INSERT OR IGNORE`); on `arm` upsert a `pending` `update_outcome` row then `writeUpdateFlag(tag)` (atomic temp+rename, mode `0600`) and answer 202; the 200/401/503 no-flag responses; a boot guard `assertUpdatePathsOutsideWorkRoot` (realpath-outside every `workRoot`, else `UPDATE_FLAG_INSIDE_WORKROOT`, reusing the ARCH-019 pattern); `ServerConfig.updateFlagPath?`/`updateResultPath?`/`selfUpdateDbPath?`. Feature-off when secret+flag-path both unset (503).
- **status:** done
- **traces:** ARCH-038
- **iter:** v11

### TASK-063 — privileged updater deploy artifacts (`deploy/rwe-update.sh` + `deploy/rwe-update.path` + `deploy/rwe-update.service` + shared `src/update-types.ts`): a dumb bash helper carrying ALL logic behind env seams (`RWE_UPDATE_FLAG`/`RWE_UPDATE_RESULT`/`RWE_UPDATE_LOCK`/`RWE_OFFICIAL_REMOTE`/`GIT`/`NPM`/`SYSTEMCTL`), distinct exit codes (0/10/20/30/40), flag-absent→exit 0 no-op, read-flag-within-flock→consume→re-validate T→`git fetch --tags` official remote→resolve T to an existing tag SHA (reject foreign/nonexistent)→already-on-SHA skip→`git checkout <SHA>` via array-args (never `sh -c`)→`npm ci && npm run build`→ safe-fail abort-BEFORE-restart on any failure→ write `applied` result atomically and FLUSH before `systemctl restart rwe`; logic-free `.path` (`PathExists=`/`PathChanged=`, not `PathModified=`) + `.service` units; `update-types.ts` is the single home of `UpdateStatus`/`UpdateOutcome`. Child-process integration harness (mkdtemp git repo + fake `NPM`/`SYSTEMCTL` shims), safe-fail is a first-class test.
- **status:** done
- **traces:** ARCH-039
- **iter:** v11

### TASK-064 — observable version + last-update outcome (`src/server.ts` + `src/dashboard-page.ts`): `GET /api/version → {version}` (reuse `resolveEngineVersion`/`ENGINE_VERSION`) + `version` and `lastUpdate?: UpdateOutcome` (+ `interruptedRuns?`) fields on `GET /api/status`; single-row `update_outcome(id CHECK(id=1), json)` store; `readUpdateResult(path, readFileImpl?)→UpdateOutcome|null` (tolerant: absent/malformed/half-written→null, never throws, 4 KB `detail` cap head+tail); ingest at boot (applied case) AND lazily on `/api/status` (failed case), with a stale-result guard (a result overwrites a `pending` row only when tags match); dashboard update panel rendering pending/applied/failed/skipped + the interrupted-run call-to-action, `textContent`/`JSON.stringify` only.
- **status:** done
- **traces:** ARCH-040
- **iter:** v11

### TASK-065 — DEPLOY doc for self-update (`DEPLOY.md`): GitHub webhook config (content-type `application/json` — the HIGH-severity omission, event subscription create+push-tags, `RWE_SECRET_GITHUB_WEBHOOK_SECRET` sourcing), reverse-proxy snippet forwarding ONLY `POST /github/webhook` to loopback, the Host-allowlist exemption note, the flag/result/lock path convention (engine-user-owned `0700`, OUTSIDE every workRoot), systemd-only self-update scope (docker-compose updates manually — the documented Option A), and the deferred-hardening + single-instance-ceiling notes.
- **status:** done
- **traces:** ARCH-039
- **iter:** v11

<!-- ── v11 Sprint 3 (REQ-071..073) — n8n-style Morandi graph dashboard: TASK-066..071 / DES-063..069 ── -->

### TASK-066 — trigger provenance `startedBy` on the durable run record: add `startedBy:{type,id?}` to `RunSpec`, set it at the four `RunManager.start()` call sites (MCP facade→`client`, `WebhookRegistry.deliver`→`webhook`+id, `SchedulerEngine`→`schedule`+name, `ContinuationStore.fire`→`chain`+parentRunId), add a **nullable** `started_by` column to the `runs` table (additive migration, no backfill), read-model coalesces absent→`{type:'unknown'}` sentinel, and surface `startedBy` on `RunStatusView`, `RunSummary`, `workflow_status` (MCP) and `GET /api/runs/:id`
- **status:** done
- **traces:** ARCH-041
- **estimate:** M
- **iter:** v11

### TASK-067 — pure graph model + layout (the master UT seam): add the internal `GraphPayload` envelope on `GET /api/runs/:id/dag`, a `SkeletonNode→LayoutNode` adapter, and a **pure `layoutGraph(nodes, opts?) → { cells:LayoutCell[]; edges:LayoutEdge[]; warnings:string[]; truncated? }`** emitting logical `{id,col,row,laneSpan}` cells (never pixels), the phase→parallel-group→ordered-set skeleton-overlay join (tie-order by `startedAt`/dispatch seq) with an unmatched-live-agent frame-grouping fallback that pushes a `warnings[]` entry, a `maxNodes` cap (default 200, `truncated` in `warnings[]`), and `terminalAt?` on `RunStatusView`
- **status:** done
- **traces:** ARCH-042
- **estimate:** L
- **iter:** v11

### TASK-068 — Morandi n8n SVG renderer (dumb browser projection): a pure `cellToPixel(cell,boxSize)→Rect` mapper + pure `morandiFrameHue(frame)=palette[stableHash(frame)%len]` (palette as scoped CSS custom properties), hand-rolled inline SVG (`<g>` pan/zoom root, edge layer, node boxes, per-frame depth-nested tinted background containers labeled by sub-workflow name), the `textContent`-only invariant for every run-derived string **including SVG `<text>`**, a client "N more" cap == 200 (shared constant with `maxNodes`), page-body-never-scrolls-horizontally, and `warnings[]` surfaced as an SVG badge
- **status:** done
- **traces:** ARCH-043
- **estimate:** L
- **iter:** v11

### TASK-069 — harness capture at dispatch (the security core): add `HarnessDescriptor` + `TranscriptEvent.kind:'harness'`, a pure `redactHarness(resolved)→HarnessDescriptor` (names only, `surfaceType:'curated'|'none'`, 4KB head+tail prompt cap with `…[truncated]…` marker), an optional `onHarness?` hook on `GatewayClient.invoke` wired at the SDK post-curation site (`:483`, `surfaceType:'curated'`) AND the direct-fetch site (`surfaceType:'none'`, empty arrays) → eager `appendTranscript`, latest-wins dedupe by agentId, and the **required** run-status-aware `deriveAgentRecords` fix (drop `if(!usage)continue`; harness-without-usage⟹`running` on an in-process parent / `queued` on an `interrupted`/`suspended` parent; `usage`⟹terminal; neither⟹never-dispatched)
- **status:** done
- **traces:** ARCH-044
- **estimate:** L
- **iter:** v11

### TASK-070 — clickable agent box → harness detail panel + `workflow_agent_log` shaping: project the `kind:'harness'` event to a top-level `harness:HarnessDescriptor|null` field AND strip it from the returned `events` window (sent once, never evicted by the 50-msg cap), add `hasMore:boolean` + optional `?limit&offset` on both the MCP tool and HTTP surfaces, enforce canonical `AgentRecord.state` (`queued|running|done|failed`) on **every** JSON response with render-time-only `idle`/`completed` aliases, render the on-click detail panel (`textContent`-only, on-click fetch not on-poll), and both tiers of the no-secret proof (pure `redactHarness` UT + Gate-7.5 headless DOM assertion)
- **status:** done
- **traces:** ARCH-045
- **estimate:** M
- **iter:** v11

### TASK-071 — budget re-derivation on crash-resume (separate ticket, must land before Gate 7.5): a **pure fold** over the same journal usage events read by TASK-069's `deriveAgentRecords` that **returns** an accumulated `spentTokens`; the impure **resume path** (not the read-model) hydrates `RunGuard.spent`; plus a snapshot/journal **double-count boundary test** (usage already reflected in a REQ-055 terminal snapshot must not be re-added when journal events replay on resume)
- **status:** done
- **traces:** ARCH-044
- **estimate:** S
- **iter:** v11

<!-- ── v11 F1 (REQ-074/075) — home dashboard: grouped cards + reliability metrics ── -->

### TASK-072 — home dashboard view: pure `buildHomeView` 3-way grouping (RUNNING/REGISTERED/OTHER) over catalog `list()` + `RunStore.listRuns()`, additive `GET /api/home` returning `HomeView`, and the dashboard home render — each card shows `description` + avg-metrics (from TASK-073) + a MINI non-interactive skeleton preview (reuse `GET /api/workflows/:name/skeleton` → `layoutGraph` → `cellToPixel` at a small box), `textContent`-only for every card/preview string, click → open the full graph view (active run graph if running, else predicted-skeleton graph); OTHER card (no catalog script) → placeholder preview, never a throw
- **status:** done
- **traces:** ARCH-046
- **estimate:** M
- **iter:** v11

### TASK-073 — per-workflow reliability metrics: a pure `computeWorkflowMetrics(runs) → Map<name, {successRate, avgDurationMs, terminalCount}>` fold grouped by workflow name (terminal set {completed,failed,stopped}; successRate=completed/terminalCount; avgDurationMs=mean(Date.parse(terminalAt)−Date.parse(createdAt)); zero-terminal → both null, never NaN; reads no clock), plus the additive `terminalAt?` field on `RunSummary` populated by `RunStore.listRuns()` in BOTH the InMemory and SQLite stores (from the first terminal transition ts, no migration), wired into `GET /api/home` so cards render the numbers
- **status:** done
- **traces:** ARCH-047
- **estimate:** S
- **iter:** v11

<!-- ── v12 (REQ-076..079) — system_info host+process metrics · enriched models_list · precise self-describing schemas ── -->

### TASK-074 — `system_info` host + process metrics via one injectable `SystemProbe` (048+049 fused): the untestable OS-boundary port (returns raw counters only), a stateful lazy-TTL `SystemInfoSampler` taking `{probe, clock}` (triggers a fresh sample unless a within-TTL snapshot exists; caches full raw + previous snapshot + previous per-pid jiffies keyed by pid, wholesale-replaced each sample), and a pure `buildSystemInfo` shaper holding ALL delta math + per-section degrade-to-null-never-throw; wired as `ServerConfig.systemInfo?` feeding BOTH the `system_info` MCP tool case and the additive `GET /api/system` route from one shared sample, plus the dashboard System panel (`textContent`-only) and the DEPLOY recon-surface note coupled to REQ-005. Real probe reads in-process cheap APIs only (`os.*` + `fs.promises.statfs(workRoot)` + a bounded async `/proc` pass under `Promise.race(~150ms)`), NEVER shells out and NEVER opens `/proc/<pid>/cmdline` (process `name` = `comm`, argv structurally absent from the record type).
- **status:** done
- **traces:** ARCH-048, ARCH-049
- **estimate:** L
- **iter:** v12

### TASK-075 — enriched `models_list`: pure `enrichModelEntry(ModelEntry) → EnrichedModelEntry` applied AFTER `filterCatalog` (exported pure helpers `classifyStability` / `computeCostLevel` / promoted `maxPricePerMOf`; `capability` curated-table ∪ source description capped 200, never null; `costLevel` integer|null over `COST_LEVEL_BANDS` named table on the existing `maxPricePerMOf` scalar; `modalities` surfaced explicitly), fields additive/optional/computed-at-call-time-never-persisted; PLUS the additive `GET /api/models` route returning `EnrichedModelEntry[]` in the uniform envelope (same builder as the tool) and a `textContent`-only dashboard Models section (columns provider/model/capability/stability/costLevel/modalities) — closes REQ-078's dashboard-observable gap.
- **status:** done
- **traces:** ARCH-050
- **estimate:** M
- **iter:** v12

### TASK-076 — precise self-describing schemas + one structured drift-lock test: extend the declarative `TOOL_DEFS` object literals so `system_info` (exactly one param `topN` integer/default 5/range 1–50/clamped/effect-named; `cpuPct` window semantics; null-section + call-motivation prose) and the enriched `models_list` (`capability`/`stability` enum/`costLevel` 0–10 + null-means-unknown) fully self-describe; add `test/schema-drift.test.ts` asserting STRUCTURED FACTS (name/default/range-or-enum/unit-keyword/effect + a "null" keyword for the null-section caveat) over the served `tools/list` for both tools — not a golden-string snapshot.
- **status:** done
- **traces:** ARCH-051
- **estimate:** S
- **iter:** v12

## v13 — REQ-080 engine-pull `seedRef:{repoUrl,sha}` behind a fail-closed egress allowlist (ARCH-052, ARCH-053)

### TASK-077 — pure egress gate + seed-source mutual-exclusion + config-load allowlist/byte/timeout validation + injectable `SeedRefFetcher` interface (ARCH-052, reject-before-network, zero-I/O)
- **status:** done
- **traces:** ARCH-052
- **estimate:** M
- **iter:** v13
- Pure `isEgressAllowed(repoUrl, allowlist) → EgressVerdict` (`src/seedref-egress.ts`) + `normalizeSeedRefAllowlist(raw)` config-load normalizer/validator; the `seedRef`-branch of the submission validator (mutual-exclusion → `SEED_SOURCE_CONFLICT`, sha/url shape → `INVALID_SEED_SPEC`, `CAS_UNAVAILABLE`, `SEEDREF_DISABLED`) with the pinned precedence; `RunSpec.seedRef?` + `SeedRefRequest`/`SeedRefResult`/`SeedRefFetcher` type declarations (no impl); config keys `seedRefAllowlist`/`seedRefTimeoutMs`/`seedRefMaxTotalBytes`/`seedRefMaxFileBytes` validated at load. Entire SSRF matrix lands here as deterministic UTs — zero network, zero clock. Design: DES-079, DES-080, DES-081.

### TASK-078 — `SeedRefFetcher` hardened-git impl + `buildGitInvocation` + sha-verify + CAS-assemble wiring + fetch-outcome observability (ARCH-053, post-`createRun`, one skippable network IT)
- **status:** done
- **traces:** ARCH-053
- **estimate:** L
- **iter:** v13
- Real `SeedRefFetcher` (`src/seedref-fetcher.ts`): pure `buildGitInvocation(req)` (hardened env/args, UNIT-asserted), killable git child (`--depth 1`) + temp-dir cleanup on every exit path, `ls-tree -l` byte-cap enforcement BEFORE blob read, symlink/gitlink drop → `dropped[]`, two-step sha-verify, `putBlob`-callback streaming into CAS → `ManifestEntry[]`. RunManager post-`createRun` step: `await fetch` → fall into the EXISTING `materializeManifest` + `initGitBaseline` tail; stamp `RunStatusView.seedRef` (resolvedSha/bytes/latencyMs/fetchedAt + failCode/failDetail + dropped) via the injected `Clock`; typed `SEEDREF_TOO_LARGE`/`SEEDREF_SHA_MISMATCH`/`SEEDREF_FETCH_FAILED` (thrown/`resultError`). One skippable IT pulls a pinned public repo. Design: DES-081, DES-082, DES-083.

### TASK-079 — `workflow_run` TOOL_DEFS `seedRef` schema + actionable error-hint payloads + `schema-drift.test.ts` extension (ARCH-052, consumability)
- **status:** done
- **traces:** ARCH-052
- **estimate:** S
- **iter:** v13
- Extend the declarative `TOOL_DEFS` `workflow_run` entry with the `seedRef:{repoUrl,sha}` object schema (mutual-exclusion + `seedRefAllowlist`-required + pre-run/post-run error-split prose naming `SEEDREF_DISABLED`); attach the `SEEDREF_DISABLED` config-key hint + `SEEDREF_EGRESS_DENIED` `attempted:{scheme,host}` (never enumerate the allowlist) to the coded errors; extend `test/schema-drift.test.ts` with structured-fact assertions for the new param. Design: DES-084.

### TASK-080 — streaming raw-body blob ingest: `CasStore.putBlobStream` seam + pure `isValidSha256Hex`/`isValidNamespace` + `POST /assets/blob/:sha` route BEHIND the net-guard (ARCH-054, the one genuine new I/O path)
- **status:** done
- **traces:** ARCH-054
- **estimate:** L
- **iter:** v14
- New `CasStore.putBlobStream(namespace, declaredSha, body: Readable, opts) → {sha256, bytes}` (`src/cas-store.ts`): temp-file sink + incremental sha256, mid-stream abort at `opts.maxBytes` → `BLOB_TOO_LARGE`, idle/read timeout (reset-on-chunk) via `opts.readTimeoutMs` + injectable `opts.timer` → `BLOB_UPLOAD_TIMEOUT`, verify computed==declared → `BLOB_SHA_MISMATCH` (unlink, store nothing), atomic rename → `blobs/<sha[0:2]>/<sha>`, THEN record namespace ref; `finally`-unlink on EVERY exit; no-exists-shortcut (fully consume+verify even if blob present). Exported pure `isValidSha256Hex`/`isValidNamespace` run BEFORE any fd. Thin `server.ts` handler registered AFTER the `isAllowedHost`/`isAllowedOrigin` gate (NOT like `/github/webhook`), reads UNDECODED bytes, 200 → `{sha256,bytes,namespace}` + one INFO line. Config `maxBlobBytes` (default 256 MiB, min 1 MiB) + `blobUploadTimeoutMs` (default 120 s, min 10 s) validated at load. `blob_put` description cross-references `POST /assets/blob/`. Net-guard 403-on-foreign-Host IT rides THIS task (route placement is the guard). Design: DES-086.

### TASK-081 — server-side seed manifest ref = a CAS blob: `POST /assets/manifest` + `seedManifestRef` run-load path + 4-way `SEED_SOURCE_CONFLICT` ladder extension + `RunStatusView.seedManifestRef` (ARCH-055, sequence after TASK-080)
- **status:** done
- **traces:** ARCH-055
- **estimate:** M
- **iter:** v14
- `POST /assets/manifest?namespace=<ns>` (raw-body, behind the net-guard): parse manifest bytes → `INVALID_SEED_SPEC` on unparseable, validate every referenced blob present → `MISSING_BLOBS` (naming absent shas), store the manifest bytes as an ordinary CAS blob, return `{seedManifestRef, namespace}` (`seedManifestRef = sha256(manifestBytes)`). `RunSpec.seedManifestRef?` load path: on `workflow_run({seedManifestRef, seedNamespace})`, load the blob, parse (→ `INVALID_SEED_SPEC`), re-validate referenced blobs (`MISSING_BLOBS` stays the security boundary), assemble via the EXISTING `materializeManifest` (verbatim, inline+ref cannot diverge). Extend the top ladder rung to 4-way exclusion (`seed`/`seedManifest`/`seedRef`/`seedManifestRef` >1 → `SEED_SOURCE_CONFLICT`). Add `RunStatusView.seedManifestRef?: string`. `workflow_run`/`seed_plan` descriptions cross-reference `/assets/manifest` + name `SEED_SOURCE_CONFLICT`; drift-locked. Depends on TASK-080 (blobs must upload first). Design: DES-087.

### TASK-082 — redact-at-capture wiring: `SecretValueProvider` port + `redact({name,value}[])` extension + EVERY transcript persist sink + journal `value` sink through `redact()`, on the persist write only (ARCH-056, the load-bearing security REQ — ONE task, sweep IT is definition-of-done)
- **status:** done
- **traces:** ARCH-056
- **estimate:** L
- **iter:** v14
- Extend `redact(event, secrets: {name,value}[])` (marker `‹secret:${name}›`, value-exact substring, `src/secret-resolver.ts`); new `SecretValueProvider.entries(): ReadonlyArray<{name,value}>` port reading the server-side secret source (`loadSecretSourceFromEnv`), injected into `RunManager` and passed to the capture chokepoint AND the `appendJournal` site — the sandbox never receives values. Route through `redact()` on the persist write for EVERY sink: (1) per-agent transcript store (`workflow_agent_log`), (2) terminal snapshot BEFORE `saveSnapshot` (run-manager.ts:508), (3) SDK-gateway `kind:'message'|'tool_call'|'tool_result'|'usage'` capture, (4) `JournalEntry.value` at the `appendJournal` build site (run-manager.ts:680). Invariants (each a named test): redact ONLY on `kind!=='harness'` and `redactHarness` ONLY on harness (mutually exclusive, no double-redaction); live in-memory `messages` array UNTOUCHED (persist-only); the completeness SWEEP IT (grep every on-disk artifact + `workflow_agent_log` for the raw secret) is the definition-of-done; negative control (same-shape different-value NOT redacted); journal replay-divergence unit. `workflow_agent_log` description gains the `‹secret:NAME›` asymmetry sentence; `workflow_run` description + authoring guidance state the hermeticity contract. Design: DES-088.

### TASK-083 — honest `asset_push` `kind` schema + drift-lock (ARCH-057, static only, no behavior change)
- **status:** done
- **traces:** ARCH-057
- **estimate:** S
- **iter:** v14
- Rewrite the `asset_push` `kind` description (server.ts:435) so both non-materializing values self-describe IN-BAND: `hook` → rejected `HOOKS_UNSUPPORTED`; `mcp-config` → use `mcp_provision`. Keep the enum values (dropping breaks the redirect caller); behavior unchanged (pushing `hook` still returns typed `HOOKS_UNSUPPORTED`). Extend `tests/integration/schema-drift.test.ts` to assert BOTH `"HOOKS_UNSUPPORTED"` and `"mcp_provision"` appear in the `kind` field description. Design: DES-089.

### TASK-084 — pure `assertScriptIntegrity` + `SCRIPT_SHA_MISMATCH` rung + `scriptSha256` schema/drift-lock (ARCH-058, one rung in the existing pre-`createRun` ladder)
- **status:** done
- **traces:** ARCH-058
- **estimate:** S
- **iter:** v14
- Pure `assertScriptIntegrity(script, sha?)`: `sha` present and `sha256(utf8Bytes(script)) !== sha` → throw `codedError('SCRIPT_SHA_MISMATCH', …)`; absent → no-op (64-char lowercase hex). New top rung in the `workflow_run` pre-`createRun` ladder (before the admission counter at run-manager.ts:230, no durable work either way): `scriptSha256` with a NAMED run (no inline `script`) → typed `SCRIPT_SHA_WITHOUT_SCRIPT` (clear reject, never silent). `TOOL_DEFS.workflow_run` gains `scriptSha256` param (description names `UTF-8` bytes + `SCRIPT_SHA_MISMATCH` + default-absent=no-check); drift-locked in `tests/integration/schema-drift.test.ts`. Reject any store/registry/signing framing. Design: DES-090.

## v15 Slice B — per-caller identity (OAuth2/Google), workflow ownership, harness-param binding, fail-closed bind (REQ-012 + REQ-086..089 → ARCH-059..063)

### TASK-085 — auth pure/injectable core under `src/auth/`: `oauth-metadata.ts` builders + `token-store.ts` (constructor-injected clock+CSPRNG, 3 SQLite tables) + `google-verifier.ts` (injected JWKS+clock+base) — UT-only, NO server wiring (ARCH-059, RED→GREEN before any route)
- **status:** done
- **traces:** ARCH-059
- **estimate:** M
- **iter:** v15
- Three files, all pure or injectable so every security-critical branch is a zero-network UT (adversarial A1, task-split note): `oauth-metadata.ts` — pure `buildProtectedResourceMetadata(cfg)` / `buildAuthServerMetadata(cfg)` (PKCE `code_challenge_methods_supported:["S256"]`) / `wwwAuthenticateHeader(cfg)`; `token-store.ts` — opaque **sha256-at-rest** bearer + single-use ≤60s auth-code + single-use oauth_state, `issue/verifyByHash/mintAuthCode/consumeAuthCode/putState/consumeState/gcExpired`, **constructor-injected `clock` + `csprng`** (Exit-Gate-5 seam — every time/random read goes through the injected port, no `Date.now()`/`randomBytes` in the module); `google-verifier.ts` — `verifyIdToken(idToken, deps)` gating `iss`/`aud`/`exp`(injected `now`)/JWKS-signature/`nonce` + **`email_verified===true` BEFORE adopting `email`**. Design: DES-092, DES-093, DES-094.

### TASK-086 — auth route wiring: `auth-service.ts` (`startAuthorize`/`handleGoogleCallback`/`tokenExchange`/`resolvePrincipal`) + 4 `server.ts` routes (`/.well-known/*`, `/authorize`, `/oauth/google/callback`, `/token`) + running-server discovery integration (ARCH-059, sequence AFTER TASK-085)
- **status:** done
- **traces:** ARCH-059
- **estimate:** M
- **iter:** v15
- Thin orchestration over the TASK-085 core; `resolvePrincipal(req)` returns a **discriminated union `{principal}` | `{status:401, wwwAuthenticate}`** (does NOT throw — the caller is type-forced to emit 401-before-side-effect). RFC-8252 loopback redirect for the Claude-Code "跳出瀏覽器網址" login; Google `client_id`/`client_secret`+pepper from the REQ-018 secret store only, never client-visible. Impl notes (quality r2): `gcExpired()` wrapped try/catch→log+continue (reuses the workspace-TTL GC cadence, never throws into the scheduler); one DEBUG `auth.resolve: {outcome: expired|unknown|malformed|ok}` internal log (no token value, no wire change). Design: DES-095.

### TASK-087 — per-caller principal resolved once at the HTTP edge, threaded as an explicit param, attributed on the control-plane row, kept OFF every sandbox-reachable path (ARCH-060, sequence AFTER TASK-086; hermeticity sweep IT is definition-of-done)
- **status:** done
- **traces:** ARCH-060
- **estimate:** M
- **iter:** v15
- Wire `resolvePrincipal` at the edge of the protected surfaces — `/mcp` (headers-only, BEFORE `readBodyDecoded`, gating `initialize`/`tools/list`/`ping` too) + `POST /assets/blob/:sha` (before `putBlobStream` consumes `req`) + `POST /assets/manifest` (before body read) — 401+`WWW-Authenticate` before any side effect. Append one nullable `principal: string | null` to `callTool`/facade **mutation+attribution** methods (`workflow_run`, `workflow_register`, `workflow_deregister`) and the two asset handlers; **do NOT** thread it into `workflow_get`/`workflow_list`/`workflow_status` (reads open by absence-of-parameter). Record principal on the control-plane run record (`principal:<email>`, surfaced via existing `workflow_status`) + CAS namespace first-writer (record-only, no enforcement); **NEVER** into child-process env or run workspace [D-AUTH-4]. **DoD:** the paired hermeticity sweep IT (I-2) — one fixture, two assertions: `principal:<email>` PRESENT on `workflow_status` AND ABSENT from sandbox child env + run workspace. Design: DES-096.

### TASK-088 — D-BIND fail-closed net-guard extension: pure `isLoopbackPeer(remoteAddress, headers)` + protected-surface refuse when auth-enabled + non-loopback peer + no valid bearer; loopback exempt (ARCH-063, extends the existing `net-guard.ts` chokepoint — no new module)
- **status:** done
- **traces:** ARCH-063
- **estimate:** S
- **iter:** v15
- New **pure sibling** `isLoopbackPeer(remoteAddress, headers)` (NOT a change to the existing `isLoopback(bind)` — different fail-closed semantics) with its own exhaustive UT suite [D-AUTH-3, the sharpest predicate]: `127/8`→exempt, `::1`→exempt, **`::ffff:127.0.0.1`(IPv4-mapped)→exempt** (empirically the dual-stack `::` bind form — missing it breaks the self-update rescue path), `undefined`→NOT exempt, **any forwarded/tunnel client-IP header (`x-forwarded-for`/`cf-connecting-ip`/`forwarded`/`x-real-ip`) present ⇒ NEVER exempt** regardless of socket peer, keys on the **raw socket `remoteAddress` ONLY**. Auth-disabled ⇒ guard dormant (pre-v15 open-LAN preserved); `POST /github/webhook` unaffected (own HMAC). Design: DES-097.

### TASK-089 — catalog ownership + harness-defaults on ONE `workflows` row: `owner` column + idempotent boot backfill + `NOT_WORKFLOW_OWNER` gate; `defaults` column + register-time validation depth + pure per-param `resolveHarnessParams` merge (ARCH-061 + ARCH-062 merged — same primary key, same owner gate, same migration path)
- **status:** done
- **traces:** ARCH-061, ARCH-062
- **estimate:** L
- **iter:** v15
- `ALTER TABLE workflows ADD COLUMN owner TEXT` + `ADD COLUMN defaults TEXT`. `register(name, script, defaults, principal)` records owner on first registration and **gates only MUTATION** (register-overwrite/`deregister`) → typed `NOT_WORKFLOW_OWNER` with definition unchanged; `run`/`get`/`list` ungated. `null` principal ⇒ ungated mutation (auth-disabled = byte-for-byte pre-v15). Idempotent boot backfill `UPDATE workflows SET owner='hsuhungjung@gmail.com' WHERE owner IS NULL` (once/boot, self-limiting; one boot log line `auth.migrate: N workflows backfilled`); auth-disabled ⇒ store NULL owner (not a sentinel) [D-AUTH-6]. **Named validation-depth assertions [D-AUTH-5, must not be simplified away]:** shape + model-alias resolvable (ARCH-005 table) + every `tool` in the curated static allowlist → typed `HARNESS_DEFAULTS_INVALID` + **stores nothing** (no partial write); **`skills` deferred to run time** (mutable per-run assets). Pure `resolveHarnessParams(registered, overrides)` = per-param merge (per-run value wins for that key only). Single exported `HarnessDefaults` type consumed by register-validation + `workflow_get` output + run-time merge (no schema drift). `TOOL_DEFS.workflow_register` gains optional `defaults` (backward-compat: absent ⇒ pre-v15 shape); `workflow_get` output gains `owner`+`defaults`; drift-locked in `tests/integration/schema-drift.test.ts`. Design: DES-098, DES-099.

## v16 Gate-8 fix (F1) — auth hardening: /authorize open-redirect + gcExpired wiring (REQ-012 → ARCH-059)

### TASK-090 — /authorize redirect_uri loopback-only validation (HIGH-1 open-redirect) + wire `TokenStore.gcExpired()` into the periodic maintenance sweep (MED-2 unbounded auth tables)
- **status:** done
- **traces:** ARCH-059
- **estimate:** S
- **iter:** v16
- Two surgical changes in the shipped v15 auth code, both in the ARCH-059 closure. **(HIGH-1)** in `src/auth/auth-service.ts`: add exported pure `isLoopbackRedirectUri(uri)` (RFC 8252: `http:` scheme + host ∈ {`127.0.0.1`,`localhost`,`[::1]`}, any port/path; parse-in-try/catch→false) and call it in `authorize()` **before `tokenStore.putState(...)`** — non-loopback/missing/unparseable → `400 invalid_request`, no state row written. **(MED-2)** in `src/server.ts` (~line 1259 sweep): call `tokenStore.gcExpired()` each tick wrapped try/catch→log+continue, and create the sweep interval when `workspaceTtlMs>0` **OR** auth enabled (so auth-enabled/no-TTL still bounds tables). Both keep auth-disabled behavior byte-for-byte unchanged. Design: DES-095, DES-093. Right-side: UT-only for `isLoopbackRedirectUri`; IT-078 gains a 400/no-state-row case + a gc-sweep-prunes-expired case (verifier), IT-079 unaffected.

### TASK-091 — RFC 7591 Dynamic Client Registration: advertise `registration_endpoint` + public `POST /register` (loopback-clamped, metadata-clamped, persisted+GC'd) + `/authorize` registered-client redirect binding (port-agnostic)
- **status:** done
- **traces:** ARCH-059
- **estimate:** M
- **iter:** v17
- Closes the observed live-connect failure ("Incompatible auth server: does not support dynamic client registration") — a spec-only MCP client (`@modelcontextprotocol/sdk`) with no pre-registered `client_id` cannot start the flow. Four coordinated edits, all inside the ARCH-059 closure. **(1)** `src/auth/oauth-metadata.ts` (DES-092): add `registration_endpoint: `${base}/register`` to `buildAuthServerMetadata`. **(2)** `src/auth/token-store.ts` (DES-093): add `registered_clients(client_id PK, redirect_uris JSON, client_id_issued_at, expires_at)` table + `registerClient({redirectUris, ttlMs})` (client_id from `this.csprng()`, issued-at `Math.floor(this.clock()/1000)` — seam-consistent) + `getClient(clientId)`; extend `gcExpired()` to sweep this 4th table too. **(3)** `src/auth/auth-service.ts` (DES-095): add `register(req,res)` handler — parse JSON body (bad JSON→400 `invalid_client_metadata`), every `redirect_uri` must pass `isLoopbackRedirectUri` else 400 `invalid_redirect_uri`, clamp grant/response/auth-method, `201 {client_id, client_id_issued_at, redirect_uris, grant_types, response_types, token_endpoint_auth_method:"none"}` (no secret); and in `authorize()` add the registered-client redirect binding (client_id present+registered ⇒ request redirect_uri must match a registered one by scheme+host+**pathname, port-ignored** RFC 8252 §7.3; else 400; absent/unregistered client_id ⇒ existing loopback-only path). **(4)** `src/server.ts`: dispatch `POST /register` in the pre-guard `if (authHandlers)` block after `/token` (~line 1408) — public, bypasses D-BIND. Design: DES-092, DES-093, DES-095. Right-side (verifier): UT for metadata field + `registerClient`/`getClient` seam + port-agnostic binding; IT-078 gains register-201 / non-loopback-400 / binding positive(diff-port→proceeds)+negative(wrong-path→400) / unregistered-client_id→302 (9a-9c untouched) / persistence-survives-reopen cases. Real-tier (VAL-095 @ 7.5): real MCP SDK auth drives register→authorize→token against the live engine.

## v18 real-consent fix (F1) — Google's 3 OAuth endpoints on 3 distinct hosts, not one `googleBase` (REQ-012 → ARCH-059)

### TASK-092 — split the conflated single `googleBase` into three separately-injectable Google endpoint URLs (authorize / token / JWKS), each with a correct exported production default + a static regression guard
- **status:** done
- **traces:** ARCH-059
- **estimate:** S
- **iter:** v18
- Closes the observed live-connect failure: a REAL Google consent succeeded (code+state returned) but `/oauth/google/callback` 502'd because v15..v17 used one `googleBase` (default `accounts.google.com`) for all three Google endpoints, while token exchange lives at `oauth2.googleapis.com/token` and JWKS at `www.googleapis.com/oauth2/v3/certs` — `accounts.google.com/token` + `/oauth2/v3/certs` do not exist. Invisible to tests because the fake IdP double served all three off one base. Two edits, both inside the ARCH-059 closure. **(1)** `src/auth/auth-service.ts` (DES-095): export `GOOGLE_AUTHORIZE_URL='https://accounts.google.com/o/oauth2/v2/auth'`, `GOOGLE_TOKEN_URL='https://oauth2.googleapis.com/token'`, `GOOGLE_JWKS_URL='https://www.googleapis.com/oauth2/v3/certs'`; `AuthConfig` drops `googleBase?` and gains `googleAuthorizeUrl?`/`googleTokenUrl?`/`googleJwksUrl?` (test-injectable, default to the constants via `??`); `createAuthRouteHandlers` uses the three resolved URLs (authorize `new URL(authorizeUrl)`, token `fetch(tokenUrl,…)`, default `jwksFetch` fetches the full `jwksUrl`); pass `jwksUri: jwksUrl` into `verifyIdToken` deps; update `server.ts:149`'s stale `googleBase+jwksFetch` comment. **(2)** `src/auth/google-verifier.ts` (DES-094): rename deps `googleBase`→`jwksUri` and `JwksPort` arg `googleBase`→`jwksUri`; call site `deps.jwksFetch(deps.jwksUri)` — rename-only, zero behavior change. Design: DES-094, DES-095. Right-side (verifier): a static UT importing `GOOGLE_TOKEN_URL`/`GOOGLE_JWKS_URL` and asserting their exact production values (the ONLY tier that catches this fake-double class); UT-094 fixture rename `googleBase:`→`jwksUri:`; IT-078 v18 points the fake at `googleAuthorizeUrl`+`googleTokenUrl` (distinct hosts) with `jwksFetch` injected as today; VAL-095 real-tier drives a real Google consent that completes the callback → 302 to loopback with an engine auth-code. Sanctioned fallout: removing `AuthConfig.googleBase` compile-breaks the VAL-095 fake-Google setup + UT-094 fixtures — mechanical renames owned by Gate 5/7.5, not new scope.

### TASK-093 — echo the client's OAuth2 `state` (RFC 6749 §4.1.2) + RFC 9207 `iss` back to the client at the final `/oauth/google/callback` redirect; persist client state across the Google round-trip, kept separate from the engine's own Google-leg state
- **status:** done
- **traces:** ARCH-059
- **estimate:** S
- **iter:** v19
- Closes the observed real-client connect failure: a real Claude Code MCP OAuth connect hit **"OAuth state mismatch - possible CSRF attack"** because the engine dropped the CLIENT's `state` — it only generated/handled its OWN Google-leg `state` (its CSRF token to Google, PK of `oauth_state`) and never echoed the client's `state` back to the client's `redirect_uri`. Per RFC 6749 §4.1.2 the AS MUST return the client's exact `state` on the authorization response. Two edits, both inside the ARCH-059 closure. **(1)** `src/auth/token-store.ts` (DES-093): `oauth_state` gains a nullable `client_state TEXT` column (in `CREATE TABLE IF NOT EXISTS` AND an idempotent `try { ALTER TABLE oauth_state ADD COLUMN client_state TEXT } catch {}` migration — same pattern as `sqlite-run-store.ts:64`); `putState` accepts an optional `clientState: string | null`; `consumeState` returns it in its payload. **(2)** `src/auth/auth-service.ts` (DES-095): `authorize()` captures `url.searchParams.get('state')` (the client's state; `null` when absent, `''` when `state=` — both stored as null) and passes it to `putState`; `googleCallback()` reads `clientState` from `consumeState` and, in the absolute-URL (try) branch of the final client redirect, sets `state=<clientState>` ONLY when non-null/non-empty and unconditionally sets `iss=<effectiveIssuer>` (RFC 9207 — byte-equal to the AS metadata `issuer`, which is the RAW `effectiveIssuer` per `oauth-metadata.ts:38`, NOT the slash-stripped `b`). The engine's Google-leg `state` (the `oauth_state` PK) is unchanged and never confused with the client's. The catch branch (relative-URI fallback, ~line 257) is unreachable post-v16 loopback validation and is NOT touched (flag-don't-remove, per DES-095 v16). Design: DES-093, DES-095. Right-side (verifier, IT-078 v19 cases): `/authorize?...&state=ABC123&redirect_uri=http://127.0.0.1:P/cb` drives the flow to a final client redirect carrying `state=ABC123` unchanged; omitted/empty client state → NO `state` param on the client redirect (no spurious `state=`); `iss` param present on the client redirect and byte-equal to the AS metadata `issuer`; engine-leg `state` still generated+consumed independently (regression). Full REQ-012 v19 end-to-end (spell out or the verifier under-tests): a real `@modelcontextprotocol/sdk` client with a fake IdP completes register→authorize→callback→**token exchange→bearer→authenticated `/mcp`** with its `state` accepted at every step. Real tier = VAL-095-style real Claude Code connect completing the whole loop against the running engine.

### TASK-094 — refresh tokens end-to-end (RFC 6749 §6 / MCP `offline_access`): advertise scopes/refresh in AS metadata, thread client-requested scope across the Google round-trip, issue a rotating sha256-at-rest refresh_token when offline_access granted, add a `grant_type=refresh_token` branch, widen the DCR grant-types clamp
- **status:** done
- **traces:** ARCH-059
- **estimate:** M
- **iter:** v20
- Closes the user-requested improvement: a real Claude Code MCP client currently must re-auth in a browser on every access-token expiry because the engine issues no refresh token. Four coordinated edits, all inside the ARCH-059 closure. **(1)** `src/auth/oauth-metadata.ts` (DES-092): `buildAuthServerMetadata` adds `scopes_supported:["openid","email","offline_access"]`, `token_endpoint_auth_methods_supported:["none"]`, `authorization_response_iss_parameter_supported:true`, and widens `grant_types_supported` to `["authorization_code","refresh_token"]` (Claude Code auto-appends `offline_access` ONLY when it sees it advertised). **(2)** `src/auth/token-store.ts` (DES-093): new 5th table `refresh_tokens(token_hash PK, principal, scope, client_id/*nullable*/, issued_at, expires_at)`; new nullable `scope TEXT` on BOTH `oauth_state` and `auth_codes` (idempotent `ALTER … catch {}` migrations, sqlite-run-store.ts:64 pattern); `putState`/`mintAuthCode` accept `scope`, `consumeState`/`consumeAuthCode` return it; new `issueRefresh(principal, scope, clientId, ttlMs)` (opaque, sha256-at-rest, csprng+clock seams) + `consumeRefresh(rawToken)` (single-use atomic DELETE-RETURNING); `gcExpired()` now sweeps all FIVE tables. **(3)** `src/auth/auth-service.ts` (DES-095): `authorize()` captures `scope` from the query (client-requested, SEPARATE from the hard-coded Google-leg `openid email`, NEVER forwarded to Google) → `putState`; `tokenExchange()` authorization_code grant response becomes `{access_token, token_type, expires_in, scope, refresh_token?}` with `expires_in` ALWAYS present (issue #26281) and `scope` ALWAYS echoed (`""` when none), issuing a refresh_token IFF space-split membership of `offline_access` in the granted scope; new `grant_type=refresh_token` branch (no PKCE) → `consumeRefresh` (rotate: new bearer + new refresh, sliding `REFRESH_TTL_MS` ~90d), `client_id` binding enforce-if-stored, `400 invalid_grant` on unknown/expired/consumed/mismatched; export `REFRESH_TTL_MS`. **(4)** the v17 DCR `/register` grant-types clamp widens from `["authorization_code"]` to `["authorization_code","refresh_token"]` (else a registered client is never told the refresh grant exists — defeats the fix for the exact target client). Design: DES-092, DES-093, DES-095. Right-side (verifier): UT — offline_access→refresh issued / absent→omitted, expires_in+scope always present, space-split (not substring) membership, rotation yields a DIFFERENT token; IT-078 v20 — real server+SQLite, `/authorize?...&scope=...%20offline_access`→callback→`/token` yields refresh_token, then `grant_type=refresh_token` yields fresh access + different refresh + re-use→`invalid_grant`, plus a no-offline_access flow yielding none; real tier = VAL-095 real client staying connected across an access-token expiry with no new browser sign-in.

### TASK-095 — callback success page: `/oauth/google/callback` returns a 200 HTML success page (copyable redirect URL + one-click copy + meta/JS auto-forward) instead of a bare 302, so a headless/`--no-browser` connect no longer sees a broken-loopback browser error
- **status:** done
- **traces:** ARCH-059
- **estimate:** S
- **iter:** v20
- Closes the user-requested UX improvement: on a machine WITHOUT a loopback listener (headless `--no-browser` paste flow) the current bare 302 shows a "can't connect" browser error. One edit inside the ARCH-059 closure. `src/auth/auth-service.ts` (DES-095): `handleGoogleCallback()`, in the absolute-URL (try) branch that builds the client redirect `location` (the v19 touchpoint), responds `200` `text/html; charset=utf-8` with a minimal page instead of `302 Location:` — the page shows the full `redirect_uri?code=…&state=…&iss=…` URL with a one-click copy control (raw URL as copyable text) AND auto-forwards via `<meta http-equiv="refresh" content="0;url=<escaped>">` + a JS `location.replace` fallback (a same-machine loopback listener still auto-catches). Attribute-context HTML-escaping (`&`→`&amp;`) because the URL carries multiple query params; the raw URL ALSO appears in an `id="callback-url"` element as a stable extraction anchor for the IT. The catch branch (relative-URI fallback) is NOT touched (flag-don't-remove, unreachable post-v16). Design: DES-095. Right-side (verifier): UT — status 200, `text/html; charset=utf-8`, page carries the URL with code/state/iss and an attribute-escaped `&amp;` in the meta tag; IT-078 v20 — the v19 `state`/`iss` assertions move from scraping the 302 `Location` to parsing `id="callback-url"` (sanctioned fallout, TASK-092 pattern), status assertion 302→200; VAL-095's automated SDK+fake-IdP harness (which simulated the browser by following the 302) now parses `id="callback-url"`/the meta URL from the 200 page and GETs the loopback URL itself (sanctioned harness fallout — an SDK harness does not execute meta/JS) while the REAL interactive-browser path is genuinely unchanged (browser executes the meta/JS redirect so the loopback listener still auto-completes).

---

## v21 — Author/user separation part 1: the tunable-parameter contract (REQ-090..095 → ARCH-064..070, ADR-001..008)

> Dependency edges (the partitioner batches on `files:`): TASK-096 → {TASK-099, TASK-100};
> TASK-097 → TASK-098 → {TASK-099, TASK-100, TASK-101, TASK-102}; TASK-100 → TASK-101;
> TASK-101 ∥ TASK-102 (they meet only at `onHarness`); TASK-103 independent;
> TASK-104 last (delete `resolveHarnessParams` only after TASK-098+101 subsume its author-side path).

### TASK-096 — catalog row widening: `params TEXT` column + `get()` returns `{script, version, defaults, params}` (lands FIRST, alone)
- **status:** done
- **traces:** ARCH-067
- **files:** src/workflow-catalog.ts, tests/integration/catalog-persistence.test.ts
- **des:** DES-103
- **dod:** `npx vitest run tests/integration/catalog-persistence.test.ts` green — a pre-v21 `catalog.db` opens, migrates, and `get(name)` returns `{script, version, defaults, params: undefined}` for a row registered before v21.
- **estimate:** S
- **iter:** v21
- Zero-dependency schema+read change that every later task compiles against. Today `get()` is `SELECT script, version` (`workflow-catalog.ts:136`) while `defaults` is only reachable via `getFull()`, so ARCH-066's "the row the run path already reads carries the contract and defaults" is not implementable and `start()`/`resume()` would each need a second query. Widen `get()` (option (a), not "point start() at getFull()" — `getFull()` additionally returns `owner`, which the run path has no business carrying, and two row-read shapes is where `defaults`-vs-`params` drift starts); `getFull()` then delegates to `get()` + owner. Includes the idempotent `ALTER TABLE workflows ADD COLUMN params TEXT` migration (reuse the `workflow-catalog.ts:58–67` PRAGMA/try-catch pattern verbatim). **No contract.ts import** — `get()` returns the stored JSON parsed as `ParamContract | undefined`; canonicalization of `undefined` belongs to the consumers (TASK-099/100).

### TASK-097 — pure `src/params/contract.ts`: locked/tunable vocabulary, `parseParamContract`, `validateUserOverrides`, the total rejection table
- **status:** done
- **traces:** ARCH-064
- **files:** src/params/contract.ts, tests/unit/params-contract.test.ts
- **des:** DES-101
- **dod:** `npx vitest run tests/unit/params-contract.test.ts` green — the 8-row condition→code→payload table of DES-101 is a table-driven test with one case per row, plus the canonical-contract and `EFFORT_RANK` cases.
- **estimate:** M
- **iter:** v21
- The single place that knows the contract vocabulary (registration, submission and v23's describe surface all consume it, so the locked-key list cannot drift into three copies). Pure: no I/O, no clock, no VM — the post-eval structural bounds live here, the pre-eval source-size bound lives in `workflow-meta.ts` (TASK-099), because `parseParamContract(metaParams: unknown, …)` by its own signature only sees a value that already survived evaluation. Test-first in the strictest sense; this task carries the majority of the slice's coverage.

### TASK-098 — pure `src/params/resolve.ts`: two-moment merge, per-key provenance, five-segment `composePrompt`, `mapEffort`
- **status:** done
- **traces:** ARCH-065
- **files:** src/params/resolve.ts, tests/unit/params-resolve.test.ts
- **des:** DES-102
- **dod:** `npx vitest run tests/unit/params-resolve.test.ts` green — 5 rungs × 4 keys provenance table (20 cases), the `composePrompt(system, undefined, prompt, undefined)` byte-identity pin, the separate five-segment order pin, and `mapEffort` applied/no-op/absent tri-state.
- **estimate:** M
- **iter:** v21
- Depends on TASK-097's types only. Provenance is emitted by the function that computes the value (one pass, `{value, rung}` per key) — a second function inferring provenance by comparing values lies whenever two rungs hold the same value (registered default and engine default both `sonnet`), which is exactly the case a wiring-miss test must distinguish. `mapEffort` is pure and provider-keyed; it is *called* inside the gateways (TASK-102), never here.

### TASK-099 — registration stores the normalized contract: pre-eval source bound, cross-validated defaults, `ON CONFLICT … params = excluded.params`, ceiling-bounded read surfaces
- **status:** done
- **traces:** ARCH-067
- **files:** src/workflow-catalog.ts, src/workflow-meta.ts, src/mcp-facade.ts, src/server.ts, tests/unit/meta-literal.test.ts, tests/integration/harness-defaults-validation.test.ts
- **des:** DES-103, DES-101
- **dod:** `npx vitest run tests/integration/harness-defaults-validation.test.ts tests/unit/meta-literal.test.ts` green — register→re-register with a **changed** `params` block ⇒ `workflow_get` returns the NEW contract (and `owner` still unchanged); a `params` block naming a locked key stores nothing; a NULL-`params` row + a lowered `maxTimeoutMs` config ⇒ `workflow_get` reflects the lowered bound without a re-register.
- **estimate:** M
- **iter:** v21
- **`files:` corrected (2026-09-01, same stale-pointer class as TASK-104's correction below):** this line named `src/sandbox/workflow-meta.ts`, a path that has never existed — `src/sandbox/` holds only `child-entry.ts`, `guards.ts` and `host.ts`. The real module carrying this task's pre-eval `meta.params` source bound is `src/workflow-meta.ts` (imported as `./workflow-meta.js` by `src/mcp-facade.ts`); the `files:` line now names it, so the partitioner and any impact analysis resolve to a file that exists.
- Depends on TASK-096 + TASK-097. **The `ON CONFLICT` clause is the trap:** `workflow-catalog.ts:110–114` updates script/version/createdAt/defaults and *deliberately omits* `owner`; an implementer adding `params` by pattern-copy leaves a stale contract on re-register — silent, no error, and exactly the drift class v21 exists to close. Also: `list()` reads `params` from the column (never a script re-parse — v22/D15 masks the script); `workflow_get`/`workflow_list` serve `min(author bound, engine ceiling)` computed at read time; MCP tool descriptions/inputSchema generated from the ARCH-064 types under the existing ARCH-051 drift-lock (the `effort` no-op being repaired here WAS a docs/behaviour split — the fix must not mint a new one). The `meta.description` re-parse in `list()` stays as-is: inherited debt, v22 owner.

### TASK-100 — admission rung + run-immutable snapshot + resume, with the three config keys and their `composeConfig()` wiring rows IN THIS TASK
- **status:** done
- **traces:** ARCH-066
- **files:** src/run-manager.ts, src/run-store.ts, src/store/sqlite-run-store.ts, src/mcp-facade.ts, src/server.ts, src/main.ts, tests/unit/compose-config-v2-wiring.test.ts, tests/integration/params-admission.test.ts
- **des:** DES-104
- **dod:** `npx vitest run tests/integration/params-admission.test.ts tests/unit/compose-config-v2-wiring.test.ts` green — a `PARAM_LOCKED` submission leaves `store.listRuns()` count unchanged, creates no directory under `catalog.workFolder(name)/runs/`, and spawns zero sandboxes; and the three new keys appear in the wiring test.
- **estimate:** L
- **iter:** v21
- Depends on TASK-096 + TASK-098. **One task by decree** (ARCH-066 inv-6): admission rung + snapshot persist + `redact()` routing + REQ-083 sweep row + config-key forwarding + the `compose-config-v2-wiring.test.ts` rows. A separate "config plumbing" task is how a **fifth** instance of that bug class ships (v11 `updateFlagPath`, v15 `auth`, v16 `workspaceTtlMs`, now `resolveHarnessParams`). Carries the MCP surface too: `workflow_run` gains `overrides` (inputSchema `additionalProperties:false`, exactly four properties) threaded to `start(spec, overrides?)` — **`overrides` never hangs off `RunSpec`** (a second persist sink carrying caller text that the REQ-083 sweep would miss, plus a standing temptation to re-merge on resume); `workflow_resume` rejects the *presence* of an `overrides` field outright. Includes the legacy NULL-`effectiveParams` resume fallback — no ARCH clause owns it and it breaks every in-flight suspended run on deploy day if omitted.

### TASK-101 — dispatch wiring: required `runParams` on `AgentReq`, single-site descriptor decoration, five-segment prompt, observable pre-dispatch rejection
- **status:** done
- **traces:** ARCH-068
- **files:** src/agent-executor.ts, src/run-manager.ts, src/types.ts, src/gateway/client.ts, tests/unit/agent-executor-params.test.ts, tests/integration/agent-executor-wiring.test.ts, tests/integration/agent-log-harness-shape.test.ts
- **des:** DES-105
- **dod:** `npx vitest run tests/integration/agent-executor-wiring.test.ts tests/unit/agent-executor-params.test.ts` green — a run registered with `defaults:{model:'M'}` and no overrides dispatches with `M` and the descriptor reports `provenance.model:'default'`; the overridden run's `CallKey`s are byte-identical to the non-overridden run's.
- **estimate:** L
- **iter:** v21
- Depends on TASK-098 + TASK-100. **The `tsc` lever goes on `AgentReq`, not the constructor:** `AgentExecutorDeps = {}` is an all-optional bag constructed at ~30 sites across 12 test files, and the executor instance is not where params semantically live; `AgentReq` is built at exactly ONE production site (`run-manager.ts:_handleAgentRequest`), which also means `_spawnerOverride` carries the field automatically instead of bypassing the lever. Also folds the REQ-092 locked trio (`defaults.prompt/tools/skills`) into the snapshot and the composition — that clause has no ARCH-064..070 home today and would otherwise ship still-inert, repeating the exact class this iteration exists to close.

### TASK-102 — effort on the wire: one shared `mapEffort` imported by both gateway clients, `thinkingFor` stays sole writer
- **status:** done
- **traces:** ARCH-069
- **files:** src/gateway/client.ts, src/gateway/claude-agent-sdk-client.ts, tests/unit/gateway-effort.test.ts, tests/unit/claude-agent-sdk-gateway-thinking.test.ts
- **des:** DES-106
- **dod:** `npx vitest run tests/unit/gateway-effort.test.ts tests/unit/claude-agent-sdk-gateway-thinking.test.ts` green — the same contract test parameterized over BOTH `GatewayClient` impls (`low` vs `max` differ at `body[param]` / on `Options`), plus the regression pin: a non-Anthropic alias at `effort:'max'` leaves `options.thinking` byte-identical to today.
- **estimate:** M
- **iter:** v21
- Depends on TASK-098. **Top risk in the slice:** `thinkingFor()` (`claude-agent-sdk-client.ts:325`, wired at `:527`) is the SOLE writer of `options.thinking` and exists *because* unconditional extended thinking made every real SDK+local-Ollama call fail with a 400 after ~4 minutes (Gate 7.5 round 3). An effort mapper that assigns `options.thinking` from a second site re-opens that shipped defect on the default path. Mapping runs **inside** the gateway (the provider is only resolvable there — `gateway/client.ts:281`) and the applied object travels back up via `onHarness(descriptor, applied?)`; no `resolveTarget` interface method is invented.

### TASK-103 — workflow-bound problem reports: `workflow:<name>` label, `name@version` + runId in the body, label-filtered `issue_list`, fingerprint extension
- **status:** done
- **traces:** ARCH-070
- **files:** src/github/issue-reporter.ts, src/mcp-facade.ts, src/server.ts, tests/unit/issue-reporter.test.ts, tests/integration/issue-report-http.test.ts
- **des:** DES-107
- **dod:** `npx vitest run tests/unit/issue-reporter.test.ts tests/integration/issue-report-http.test.ts` green — two workflows reporting the same title produce two issues (not one comment), and with `workflow` ABSENT `issueFingerprint()` is byte-identical to its pre-v21 output.
- **estimate:** S
- **iter:** v21
- Independent of every other v21 task. Reuses the registration-name charset/length predicate minus the existence check (transcription of the regex is drift); a just-deregistered workflow must still be reportable, so the name is never existence-checked.

### TASK-104 — cleanup: delete `resolveHarnessParams` once `mergeRunParams` owns the author-side path
- **status:** done
- **traces:** ARCH-065
- **files:** src/harness-defaults.ts, tests/unit/params-resolve.test.ts
- **des:** DES-102
- **dod:** `rg -n "resolveHarnessParams" src/ | wc -l` returns 0 and `npx vitest run` is green.
- **estimate:** S
- **iter:** v21
- **`files:` corrected at the v21 Gate 6 integrator closeout (2026-09-01, adjudication B-8):** this line named `tests/unit/harness-defaults.test.ts`, a file that never existed under that name — a stale pointer to the deleted `tests/unit/resolve-harness-params.test.ts`. The real files this task touched are `src/harness-defaults.ts` (where `resolveHarnessParams` was removed) and the deleted `tests/unit/resolve-harness-params.test.ts`, whose coverage is now carried by `tests/unit/params-resolve.test.ts` (UT-099) — that replacement is what the `files:` line names, since a deleted path is not a partitionable file. See IMPL-137.
- Runs LAST (after TASK-098 + TASK-101). Leaving a `Partial<HarnessDefaults>`-shaped merge function (three of whose five keys are D12-locked) next to the new closed-type one is a standing invitation for a future implementer to "finally wire the one that was never wired" — reintroducing exactly the ADR-001 escalation. Deleting the shape is cheaper than documenting why not to use it.

---

## v22 — Author/user separation part 2: version history, channels, closing inline script (REQ-096..100 → ARCH-071..076, ADR-009..014)

> Dependency edges (the partitioner batches on `files:`): TASK-105 → {TASK-107, TASK-108, TASK-109, TASK-111};
> TASK-106 → TASK-107; TASK-110 → TASK-111; TASK-108 → TASK-109 (the DAG reads the pin);
> TASK-112 independent. Pure-first TDD order: TASK-106 + TASK-110 units and DES-110's truth table are the
> first RED tests written; they are database-free and pin the two external contracts v22 Rule 1 names.

### TASK-105 — versioned catalog: `workflow_versions` table, transactional idempotent boot migration, `resolve`/`resolveDetail`/`exists`/`listVersions`/`publish`, and every converted call site in ONE commit
- **status:** done
- **traces:** ARCH-071
- **files:** src/workflow-catalog.ts, src/run-manager.ts, src/scheduler.ts, src/webhook-registry.ts, src/submission-validator.ts, src/mcp-facade.ts, src/server.ts, tests/integration/catalog-versions.test.ts
- **des:** DES-109, DES-110, DES-111
- **dod:** `npx vitest run tests/integration/catalog-versions.test.ts` green — a **hand-written** pre-v22 `catalog.db` migrates (rows copied, `release_version` set, second boot logs `0 migrated`), `PRAGMA table_info(workflows)` no longer lists `script`/`version`/`defaults`/`params`, both versions of a twice-registered name are retrievable, and the file's own structural case asserts `rg "catalog\.get\(|\.getFull\("` over `src/` finds nothing.
- **estimate:** L
- **iter:** v22
- **`get()` and `getFull()` are deleted, not left beside `resolve()`/`resolveDetail()`** — after this commit the compiler, not a reviewer, finds a missed call site. Splitting the accessor change from its six call sites (`run-manager.ts:391,635,801`; `scheduler.ts:148,209`; `webhook-registry.ts:89`; `submission-validator.ts:83`) leaves a legacy "newest row" read alive for a review cycle, which is exactly how this repo's stored-but-never-wired class survives (four documented recurrences). Registration is mechanical here (INSERT a new row, no channel) — enforcement and the ceiling land in TASK-107 so this task stays reviewable.

### TASK-106 — pure `src/script-checks.ts`: `validateScriptEntry` with injected ports + the shared frame-delimiter predicate
- **status:** done
- **traces:** ARCH-074
- **files:** src/script-checks.ts, tests/unit/script-checks.test.ts
- **des:** DES-112
- **dod:** `npx vitest run tests/unit/script-checks.test.ts` green — one case per code (`PARSE_ERROR`, `UNKNOWN_ALIAS`, `MCP_NOT_PROVISIONED`, frame-delimiter forgery), the `openrouter/<id>` passthrough accepted unchanged, multiple errors returned in one call, and the structural case asserting exactly one frame-delimiter regex exists under `src/`.
- **estimate:** M
- **iter:** v22
- Lifted **verbatim** out of `submission-validator.ts:92-124`'s `if (spec.script)` block into a new tiny pure module — not a call into `submission-validator.ts`, because `workflow-catalog.ts` becomes the enforcement site and that file already type-imports the catalog (a cycle). The delimiter predicate is **imported** from `params/contract.ts`, never transcribed (P6-2's registration half; v21 QD-REP-1 precedent).

### TASK-107 — registration ENFORCES: `validateScriptEntry` before any write, the per-name version ceiling, and the `main.ts` threading + `compose-config-v2-wiring.test.ts` rows IN THIS TASK
- **status:** done
- **traces:** ARCH-071, ARCH-074
- **files:** src/workflow-catalog.ts, src/main.ts, src/server.ts, tests/unit/compose-config-v2-wiring.test.ts, tests/integration/registration-enforcement.test.ts
- **des:** DES-111, DES-112, DES-117
- **dod:** `npx vitest run tests/integration/registration-enforcement.test.ts tests/unit/compose-config-v2-wiring.test.ts` green — a script failing each of the three checks is refused with the same typed code the engine produced at submission and `listVersions(name)` is unchanged (**nothing stored**); an (N+1)th registration is refused `VERSION_CEILING_EXCEEDED` whose message names both remedies; and `maxWorkflowVersions` + the catalog's new alias/MCP deps appear in the wiring test.
- **estimate:** M
- **iter:** v22
- Depends on TASK-105 + TASK-106. **One task by decree** — a new config key plus a widened constructor is the exact trigger of this repo's five-instance `composeConfig` wiring bug class (v11 `updateFlagPath`, v15 `auth`, v16 `workspaceTtlMs`, v21 `resolveHarnessParams`); a separate "config plumbing" task is how the sixth ships. `maxWorkflowVersions` goes into the **existing** `WorkflowCatalogOpts.ceilings` object (`workflow-catalog.ts:57`) — no new plumbing. Order inside `register`: `validateScriptEntry` first, ceiling second (DES-117).

### TASK-108 — resolve once at admission, pin the version on the run, resume/nested/legacy through the pin, and the `SubmissionValidator` shrink
- **status:** done
- **traces:** ARCH-072, ARCH-074
- **files:** src/run-manager.ts, src/run-store.ts, src/store/sqlite-run-store.ts, src/submission-validator.ts, src/types.ts, tests/integration/run-version-pin.test.ts, tests/integration/scriptversion-fidelity.test.ts
- **des:** DES-113, DES-112, DES-117
- **dod:** `npx vitest run tests/integration/run-version-pin.test.ts tests/integration/scriptversion-fidelity.test.ts` green — start `foo@v1` (script returns marker `A`) → suspend → register+publish `v2` (marker `B`) → resume → the run's **result is `A`**; run 1 reports `'v1'` and run 2 `'v2'` **literally** after a third version is registered; a hand-written legacy DB whose run pin is absent from `workflow_versions` resumes with the substitution recorded; and `submission-validator.ts` contains zero `if (spec.script)` branches.
- **estimate:** L
- **iter:** v22
- Depends on TASK-105. **The pin is a correctness fix, not decoration** — today `resume` re-reads the catalog and continues *whatever is registered now* (`run-manager.ts:632-636`), so the marker test is RED against current code. Carries the three `scriptVersion`-meaning rulings (DES-113), the legacy-cohort fallback, `SubmissionValidatorDeps` shrinking to `{catalog}` and `MISSING_SCRIPT` → `MISSING_NAME` — the shrink lives **here**, with the checks it orphans, because dead wiring left in `main.ts` is a standing invitation to grow the second enforcement site ADR-013 exists to prevent.

### TASK-109 — the wire surface: `script` + `scriptSha256` removed from the schemas and `RunSpec`, `workflow_publish`, `version`/`channel` parameters with descriptions, drift-lock rows, DAG from the pin
- **status:** done
- **traces:** ARCH-073
- **files:** src/server.ts, src/mcp-facade.ts, src/types.ts, src/run-manager.ts, tests/integration/schema-drift-v22.test.ts, tests/integration/inline-script-closed.test.ts
- **des:** DES-114, DES-117
- **dod:** `npx vitest run tests/integration/schema-drift-v22.test.ts tests/integration/inline-script-closed.test.ts` green — `tools/list` advertises neither `script` nor `scriptSha256` on `workflow_run` and no `script` on `workflow_resume`, advertises `workflow_publish` with the `beta|release` enum, every new optional parameter has a non-empty description; and a hand-rolled `/mcp` body carrying `script` is refused `INLINE_SCRIPT_CLOSED` with the two-call migration recipe in the message.
- **estimate:** L
- **iter:** v22
- Depends on TASK-105 + TASK-108. **Closure is schema-level AND runtime-level and the two are asserted separately** — `/mcp` accepts arbitrary JSON, so removal from the advertised schema is not a refusal. `scriptSha256` leaves in the **same** task as `script` (`run-manager.ts:292-294` refuses it whenever there is no inline script, i.e. always after REQ-098 — an advertised parameter whose every use errors teaches a schema-reading agent a lie). The DAG route derives its skeleton from the pinned `(name, version)`; `server.ts:1044-1046`'s `spec?.script` read is empty for every named run today.

### TASK-110 — pure `src/workflow-view.ts`: `projectWorkflowForRead`, the two view types, `EXPECTED_NON_OWNER_KEYS`
- **status:** done
- **traces:** ARCH-075
- **files:** src/workflow-view.ts, tests/unit/workflow-view.test.ts
- **des:** DES-115
- **dod:** `npx vitest run tests/unit/workflow-view.test.ts` green — `Object.keys(deepFlatten(projectWorkflowForRead(full, false))).sort()` equals `EXPECTED_NON_OWNER_KEYS` **literally** (so a new leaked field fails AND a missing `scriptWithheld` fails, and `validation.errors` is absent), and the owner branch returns the script byte-identically.
- **estimate:** S
- **iter:** v22
- Pure, no I/O, no auth — the *shape* is built here, the *policy* is evaluated in TASK-111, split so each is testable without the other. The non-owner branch is **constructed** from an explicit field list, never a `delete` on a full row (`script` is returned **twice** today, `mcp-facade.ts:220/232`, so a delete-based fix leaks `result.script` — v21's fragment-leak defect verbatim).

### TASK-111 — masked reads: **required** `ReadContext` on `workflow_get`/`workflow_list`, every call site, `/api/*` masked while auth is on, and the real-transport non-owner test
- **status:** done
- **traces:** ARCH-076, ARCH-073
- **files:** src/mcp-facade.ts, src/server.ts, tests/integration/workflow-masking-http.test.ts
- **des:** DES-116, DES-115
- **dod:** `npx vitest run tests/integration/workflow-masking-http.test.ts` green — an authenticated **non-owner** driven through `/mcp` with a real bearer minted via `TokenStore` gets exactly `EXPECTED_NON_OWNER_KEYS`; passing `{principal:'<owner-email>'}` in the arguments does **not** unmask; the owner gets the script; auth disabled returns the pre-v22 surface; and a NULL-owner row is masked from everyone with the distinct remediation text.
- **estimate:** M
- **iter:** v22
- Depends on TASK-105 + TASK-110. **One task by decree** — the whole value of a required `ctx` is that an unwired call site is a `tsc` error; a task that adds it with a `= null` default "to unblock the next task" deletes the entire protection and reproduces the `composeConfig` class verbatim. A facade-level unit test with an injected principal **cannot** see the `server.ts:823` hole, which is why the transport test is this task's DoD and not a later test task.

### TASK-112 — scheduler failed dispatch gets a writer: `markFailed` + `lastError`, the driver's `.catch()`, and the false comment corrected
- **status:** done
- **traces:** ARCH-072
- **files:** src/scheduler.ts, src/server.ts, tests/unit/scheduler-failed-dispatch.test.ts
- **des:** DES-118
- **dod:** `npx vitest run tests/unit/scheduler-failed-dispatch.test.ts` green — a schedule whose workflow resolution fails, driven across **three** fake-clock ticks, attempts `start()` exactly **once**, has `nextFire` advanced (or is auto-disabled for `once`), and reports `lastError:{code, at}` on `schedule_list`.
- **estimate:** S
- **iter:** v22
- Independent of every other v22 task. **Reopens a recorded architecture decline on new primary-source evidence** (see Decision rationale D3): `server.ts:1294-1309`'s `.catch()` writes nothing, `markFired` is the sole writer that advances a schedule after a firing, and the ticker is 500 ms — so a failed dispatch re-fires at 2 Hz forever while `schedule_list` shows silence, directly under a comment claiming the opposite. A single-tick test passes today and proves nothing; the defect is only visible on tick 2.

---

## v23 — Author/user separation part 3: `workflow_describe`, the analyzer-drawn ASCII diagram, retiring the skeleton (REQ-101..106 → ARCH-077..086, ADR-015..022)

**Landing order (edges are load-bearing, not preferences):**
`113 → 114 → 115 → 116 → 125 → 117 → 118 → 119 → 120 → 121`, with `122` after `117`, `123` any time before `120`,
and `124` last (it is a Gate 7.5 item, not a code item). Rationale for each edge is on the card.
**`125` (adjudication #1, phases go public) lands before `117` and `118`**: the diagram's `allowedLabels`
must point at a field that is *already* public, and `118` edits the same file — landing them in the other
order opens a window in which one response's key oracle rejects what its own `diagram` string renders.

### TASK-113 — `src/diagram-gate.ts`: the pure allowlist gate and `DIAGRAM_CODEPOINTS`
- **status:** done
- **traces:** ARCH-080
- **files:** src/diagram-gate.ts, tests/unit/diagram-gate.test.ts
- **des:** DES-124
- **dod:** `npx vitest run tests/unit/diagram-gate.test.ts` green — the hostile-input table returns the **exact** reason code for each row: the bare secret literal → `GATE_REJECTED_CONTENT`; the secret glued to a glyph (`╭─sk-live-abc123─╮`) → `GATE_REJECTED_CONTENT`; an ANSI/CSI escape, a zero-width space, `\t`, `\r`, a `<` → `GATE_REJECTED_SHAPE`; over `maxBytes`/`maxLines` → `GATE_REJECTED_SHAPE`; a non-string and an empty string → `GATE_REJECTED_SHAPE`; a valid diagram whose every token is in `allowedLabels` → `{ok:true, diagram}` **byte-identical to the input**.
- **estimate:** S
- **iter:** v23
- Lands **first and alone**: pure, `deps: —`, and it carries REQ-102/A3's security invariant, so it must be green before `GraphAnalyzer` exists (both panel groups, independently). Per the ledger's carried-in rule 1 every assertion names the literal secret, never `not.toContain(wholeScript)`.

### TASK-114 — `workflow_diagrams`: the table, the four accessors, and the one deletion path
- **status:** done
- **traces:** ARCH-077
- **files:** src/workflow-catalog.ts, tests/unit/workflow-diagrams-store.test.ts
- **des:** DES-130, DES-127
- **dod:** `npx vitest run tests/unit/workflow-diagrams-store.test.ts` green against an in-memory `Database` — `putDiagramPending`/`putDiagramResult`/`getDiagram`/`listPendingDiagrams` round-trip; a `v3` read never returns the `v4` row; `deregister('n')` removes the workflow **and** its diagram rows in one transaction (assert: a mid-transaction throw leaves *both* present); `getDiagram` on a version registered before v23 returns `null`; **`putDiagramResult` for a `(name, version)` with no surviving `workflow_versions` row is a silent no-op** (assert `getDiagram` is `null` **and** `SELECT COUNT(*) FROM workflow_diagrams` is `0`); `putDiagramPending(n, v, at)` stamps `generated_at` while `putDiagramPending(n, v)` leaves it `NULL`.
- **estimate:** S
- **iter:** v23
- **ARCH-077's "`maxWorkflowVersions` prune" does not exist** — the ceiling *refuses* registration (`VERSION_CEILING_EXCEEDED`, `workflow-catalog.ts:342-346`). `deregister()`'s transaction is the **only** deletion path. Do not implement a prune hook (see DES-130).

### TASK-115 — `src/trigger-bindings.ts`: `getTriggerBindings` over four narrow ports, plus the canonical fingerprint
- **status:** done
- **traces:** ARCH-078
- **files:** src/trigger-bindings.ts, tests/unit/trigger-bindings.test.ts
- **des:** DES-128
- **dod:** `npx vitest run tests/unit/trigger-bindings.test.ts` green with **plain object-literal ports and no SQLite** — cron + webhook + chain compose into one array; the same rows returned in a different order produce the **identical** `bindingsFp` and adding a schedule changes it; a `runs` port returning `null` still emits `{kind:'chain', upstreamWorkflow:null}`; and `tsc` rejects a `webhooks` port whose element type carries `secret` or `id`.
- **estimate:** M
- **iter:** v23
- Lands before **both** consumers (the analyzer and the describe projection) — one normalization feeding both is what makes `diagramStale` a real signal instead of a formatting artifact.

### TASK-116 — `curateToolsForProvider` preserves an intentionally-empty tool set (latent security fix, gateway-level proof)
- **status:** done
- **traces:** ARCH-079
- **files:** src/gateway/claude-agent-sdk-client.ts, tests/unit/claude-agent-sdk-gateway-allowed-tools.test.ts
- **des:** DES-120
- **dod:** `npx vitest run tests/unit/claude-agent-sdk-gateway-allowed-tools.test.ts` green — a `queryImpl`-mocked `invoke()` with `opts.allowedTools: []` and a **non-Anthropic** alias builds `options` with `tools: []` **and** `allowedTools: []` (today it builds `['Bash']`); the existing UT-024 non-empty *fallback* assertion still passes unchanged.
- **estimate:** S
- **iter:** v23
- **Lands strictly before TASK-117.** ADR-020's "the default blast radius is nil" is **falsified** on this deployment's own default path: `curateToolsForProvider([], 'ollama') === ['Bash']`, so `graphAnalyzer.tools: []` would ship a Bash-enabled session whose prompt is attacker-authored script text. The fix is one line (`if (tools.length === 0) return [];`) and is a general fix, not analyzer-specific.

### TASK-117 — `src/graph-analyzer.ts`: the analyzer — queue, single-flight, own retry loop, note enum, journal line, isolation, boot validation
- **status:** done
- **traces:** ARCH-079
- **files:** src/graph-analyzer.ts, src/main.ts, tests/unit/graph-analyzer.test.ts, tests/unit/graph-analyzer-wire.test.ts, tests/integration/graph-analyzer-late-write.test.ts
- **des:** DES-131, DES-121, DES-122, DES-123, DES-129, DES-127
- **dod:** `npx vitest run tests/unit/graph-analyzer.test.ts tests/unit/graph-analyzer-wire.test.ts` green — with a stub `GatewayClient` and `runInline`: `enqueue()` returns **before** the job runs and writes the `pending` row; each of the ten `DiagramNoteCode` values is produced by its own literal input row; a never-resolving `queryImpl` + fake timers settles `unavailable/TIMEOUT` after **exactly** `1 + retries` calls; a provider error whose message contains the secret literal produces a journal **string** that does not contain it; a second `regenerate` while `pending` enqueues **no** second job; a failed regenerate leaves a prior `ready` row untouched; and `sweepAtBoot()` under a `FixedClock` produces **all three** shapes from DES-131 (unstamped ⇒ requeue **and** stamp; stamped before the boot instant ⇒ settle `unavailable/RETRIES_EXHAUSTED` with **no** model call; stamped at/after the boot instant ⇒ untouched). And in `graph-analyzer-wire.test.ts`, at `queryImpl` level with a **non-Anthropic alias**, the built `options` object literally equals `tools: []`, `allowedTools: []`, `settingSources: []`, `strictMcpConfig: true`, empty `mcpServers`, thinking disabled, `cwd` = `<workRoot>/.graph-analyzer-scratch`. And `npx vitest run tests/integration/graph-analyzer-late-write.test.ts` green on the **real `setImmediate`** path (DES-130): enqueue → `deregister(name)` → release the gateway fake → `getDiagram()` is `null` and `SELECT COUNT(*) FROM workflow_diagrams` is `0`.
- **estimate:** L
- **iter:** v23
- Depends on TASK-113 (gate), TASK-114 (table), TASK-115 (bindings), TASK-116 (curation), TASK-125 (`phases` public before the allowlist points at them). **The late-write test must stay on the real `setImmediate` path** — the `schedule` seam that makes every other analyzer test deterministic would make this one vacuous; a later "make the suite faster" pass must not seam it. **The `main.ts` scratch-`cwd` repoint, the no-`workRoot` forced-`tools:[]` downgrade, and the two boot lines land inside THIS task**, not as follow-ups **[AMENDED v23 adjudication #5 U-2 — SUPERSEDED for two of the three: adjudication #2 R-1 moved the two boot lines to TASK-126 and #4 T-1 moved the forced-`tools:[]` downgrade to TASK-127, both because the construction site they attach to is in `server.ts`, outside this task's `files:`. TASK-127 landed it at `server.ts:1471-1476` with the boot line at `:1483`. Only the scratch-`cwd` repoint remained here. The clause is kept rather than deleted so the reasoning trail survives.]** — they are constructor-time properties of the class this task builds (both panel groups). The wire test is **not optional next to the stub tests**: TASK-116's bug lives inside the SDK client's `options` builder and no stub can see a `cfg.tools → opts.tools` mis-map.

### TASK-118 — `projectWorkflowDescribe` + `WorkflowDescribeView` + `EXPECTED_DESCRIBE_KEYS`
- **status:** done
- **traces:** ARCH-081
- **files:** src/workflow-view.ts, tests/unit/workflow-describe-projection.test.ts
- **des:** DES-125, DES-127
- **dod:** `npx vitest run tests/unit/workflow-describe-projection.test.ts` green — `Object.keys(deepFlatten(view)).sort()` equals the **literal** `EXPECTED_DESCRIBE_KEYS`, which **includes `phases`** (two-sided: an added field fails, a dropped `phases`/`lockedKeys`/`diagramStatus` fails); `diagramGeneratedAt` is `null` for every non-`ready` row **including a swept `pending` row whose `generated_at` is stamped**; all three `diagramStatus` values are asserted literally; `lockedKeys` is `LOCKED_KEYS` imported from `src/params/contract.ts`, not six re-typed strings; `diagramStale` is `true` only for a `ready` row whose `bindings_fp` differs from the live fp, and `false` for `pending`/`unavailable`/no-row; `tsc` rejects assigning a `script` field.
- **estimate:** M
- **iter:** v23
- Depends on TASK-115 and TASK-125 (same file; `phases` must already be on the public allowlist). Pure — no clock, no I/O, no auth, **no `viewerIsOwner`** (a parameter that cannot change the output is one that will eventually be made to; both groups agreed to drop it).

### TASK-119 — the facade: `workflow_describe` (any principal) and `workflow_regenerate_diagram` (owner-gated)
- **status:** done
- **traces:** ARCH-082
- **files:** src/mcp-facade.ts, tests/unit/workflow-describe-facade.test.ts
- **des:** DES-126
- **dod:** `npx vitest run tests/unit/workflow-describe-facade.test.ts` green — a table-driven UT over the resolve truth table (`{version}`, `{channel:'beta'}`, `{channel:'release'}`, `{}`, unknown version, unpublished beta, dangling pointer, both selectors) asserts `workflow_describe`'s code **equals** run-admission's code for the same input, `DANGLING_CHANNEL` is not collapsed into `CHANNEL_UNPUBLISHED`, and `workflow_regenerate_diagram` returns `NOT_WORKFLOW_OWNER` for a non-owner (via the existing `resolveWritePrincipal`), `ANALYZER_DISABLED` when `graphAnalyzer.enabled === false`, and `{queued:false, status:'pending'}` when a job is already in flight.
- **estimate:** M
- **iter:** v23
- Depends on TASK-117 + TASK-118. `ctx: ReadContext` stays **required with no default** (ADR-012) — an optional `principal = null` reproduces this repo's `composeConfig` wiring-bug class verbatim.

### TASK-120 — the server wire: two tool schemas, `/describe` replaces `/skeleton`, every skeleton deletion, and the mechanical guard
- **status:** done
- **traces:** ARCH-083, ARCH-051
- **files:** src/server.ts, src/mcp-facade.ts, src/workflow-view.ts, tests/unit/no-skeleton-surface.test.ts, tests/integration/workflow-describe-http.test.ts
- **des:** DES-132, DES-125
- **dod:** `npx vitest run tests/unit/no-skeleton-surface.test.ts tests/integration/workflow-describe-http.test.ts` green — the guard greps `src/**` case-insensitively for `skeleton` and fails on any hit outside the **exactly four** allowlisted internal sites (`workflow-meta.ts` `parseWorkflowSkeleton`, `dashboard.ts` `layoutGraph`, `server.ts`'s `/api/runs/:id/dag` branch, and `graph-analyzer.ts`'s use of `parseWorkflowSkeleton` as analyzer grounding — added by Orchestrator adjudication (v23) #3), a fifth entry fails the test, and **no** advertised tool description or input-schema string contains the word; and the four-surface anti-drift table registers ONE secret-bearing script and asserts the **exact secret literal** absent from `JSON.stringify` of `workflow_get` (non-owner), `workflow_describe`, `GET /api/workflows` (the list — **there is no `GET /api/workflows/:name` route in this codebase**, verified `server.ts:1035-1039`) and `GET /api/workflows/:name/describe`, with the MCP tool and the HTTP route returning the **identical** object — the route body compared against the MCP tool invoked with `ctx = {authEnabled: true, principal: null}` (the route is **unauthenticated**; comparing against an *owner* call passes for the wrong reason and hides the divergence the test exists to catch).
- **estimate:** L
- **iter:** v23
- Depends on TASK-119. **Write the guard with its three-entry allowlist FIRST, watch it fail on the current tree, then delete** — a guard written after the deletion is a guard fitted to whatever the deletion happened to leave, which is how this ledger's most-repeated defect (nine instances across v21/v22) stayed at nine. `GET /api/runs/:id/dag` is **untouched** and keeps its `authEnabled ? [] : parseWorkflowSkeleton(...)` line (v22 finding H2 closed that hole; v23 must not re-open it). The parity test is **one** test spanning both files — split by file it becomes two tests each proving half a property.

### TASK-121 — the dashboard: skeleton previews out, the ASCII diagram into a `<pre>` via `textContent`
- **status:** done
- **traces:** ARCH-084
- **files:** src/dashboard-page.ts, tests/unit/dashboard-diagram-render.test.ts
- **des:** DES-133
- **dod:** `npx vitest run tests/unit/dashboard-diagram-render.test.ts` green — the workflow-detail view fetches `/api/workflows/:name/describe` from inside the existing ticked `render()` (`:505`'s single 3s `setInterval`, no new timer), renders `diagram` into a `<pre>` via **`textContent`** (a diagram string containing `<script>` appears as literal text, never a node), renders `diagramNote` when `diagramStatus !== 'ready'`, and the home-card mini-preview renders **nothing** when no diagram exists.
- **estimate:** S
- **iter:** v23
- Depends on TASK-120, separate from it: this is the first model-authored string this renderer has ever received, and a `textContent`-by-convention file is not a control when the input's author is a language model.

### TASK-122 — the `graphAnalyzer` config block: `composeConfig()` forward + wiring-test row + example config + DEPLOY.md, in ONE change
- **status:** done
- **traces:** ARCH-085
- **files:** src/main.ts, rwe.config.example.json, DEPLOY.md, tests/unit/compose-config-v2-wiring.test.ts
- **des:** DES-134
- **dod:** `npx vitest run tests/unit/compose-config-v2-wiring.test.ts` green — the new rows prove a `graphAnalyzer` block in `rwe.config.json` reaches `ServerConfig` **through `composeConfig()`**, each of the **nine** keys (`enabled`, `model`, `systemPrompt`, `tools`, `timeoutMs`, `retries`, **`maxBytes`, `maxLines`, `maxQueueDepth`**) defaulted at exactly one place, and `enabled:false` still yields a successful registration; `rwe.config.example.json` carries the block and DEPLOY.md documents the nine keys, the `(1 + graphAnalyzer.retries) × (1 + gateway retries)` worst-case call formula, the model class the shipped default `systemPrompt` assumes, and the one sentence saying registration now sends the **workflow script itself** to the configured provider.
- **estimate:** M
- **iter:** v23
- Depends on TASK-117. **All four artifacts in one task by decree** — this engine's recurring defect (v11 `updateFlagPath`, v15 `auth`, v16 `workspaceTtlMs`) is exactly "the config-forward and its wiring-test row landed in different changes". A unit test alone does **not** close REQ-104; that is TASK-124.

### TASK-123 — `docs/AUTHORING.md` and the same rules on the MCP surface a cold client sees
- **status:** done
- **traces:** ARCH-086
- **files:** docs/AUTHORING.md, src/server.ts, tests/unit/tool-schema-drift.test.ts
- **des:** DES-135
- **dod:** `npx vitest run tests/unit/tool-schema-drift.test.ts` green — `workflow_register`'s `script` parameter description contains the four authoring rules in condensed form plus the `docs/AUTHORING.md` pointer, and the new string is pinned by ARCH-051's structured drift-lock; `docs/AUTHORING.md` exists and states all four rules including rule (4) in its post-adjudication wording (**phase titles are visible to every principal who can see the workflow** — keep secrets and distinctive prose out of them), plus the standing note that registration sends the script to the configured LLM provider and `graphAnalyzer.enabled:false` is the control.
- **estimate:** S
- **iter:** v23
- Independent of every other v23 task and **must not be scheduled last**: rule (4) is the *sole* control over a disclosure the owner has now ruled deliberate (adjudication #1, 2026-09-02 — the escalation is **resolved**, not open). Registration gains **no** new rejection — this is documentation, deliberately not enforcement.

### TASK-124 — REQ-104's Gate 7.5 real run: an operator edits the analyzer config and the diagram visibly changes with no redeploy
- **status:** done
- **traces:** ARCH-085
- **files:** 08-validation.md, DEPLOY.md
- **des:** DES-134
- **dod:** On a real booted engine with a real provider: register a workflow → `workflow_describe` shows a `ready` diagram; edit `graphAnalyzer.systemPrompt` **and** `graphAnalyzer.model` in `rwe.config.json`; restart the process (no rebuild, no code change); re-register a new version → the emitted diagram is **visibly different** and the `[remote-workflow-engine] graph-analyzer` journal line names the **new** model. Evidence pasted into 08-validation.md.
- **estimate:** S
- **iter:** v23
- Its own task line at Gate 7.5, not a bullet inside TASK-122. **No unit test may be written that claims to prove REQ-104** — a unit assertion reads its value off the same path that would be broken, which is the defect this requirement is named after.

### TASK-125 — adjudication #1: `phases` joins the public allowlist on every surface (amends v22's shipped REQ-100 projection)
- **status:** done
- **traces:** ARCH-075, ARCH-081
- **files:** src/workflow-view.ts, tests/unit/workflow-view.test.ts
- **des:** DES-136
- **dod:** `npx vitest run tests/unit/workflow-view.test.ts` green — `WorkflowPublicView` carries `phases: Array<{title: string}>`, `EXPECTED_NON_OWNER_KEYS` contains the literal `'phases'` as **one** entry (the test's own `deepFlatten` does not recurse into arrays — `workflow-view.test.ts:29`), the two-sided oracle still fails on both a leaked extra field and a dropped one, and a non-owner projection of a row whose `meta.phases[0].title` is `SEKRIT-9F2A` **does** contain that literal while a secret in the *script body* is still absent (two distinct fixtures, not one).
- **estimate:** S
- **iter:** v23
- **Lands before TASK-117 and TASK-118.** Owner ruling 一律公開 (2026-09-02; recorded in 04-design.md "Orchestrator adjudication (v23) #1" and as REQ-100's `[AMENDED v23]` block): serving phase titles inside the diagram while `workflow_get` withheld them is REQ-100's own "cannot be side-stepped by asking a different endpoint" clause violated in mirror image. **`server.ts` is deliberately not in `files:`** — the only other masking site is the `/api/workflows/:name/skeleton` branch (`:1075-1084`), which TASK-120 **deletes** whole; patching a route to unmask and then deleting it is work with no surviving artifact. The window between the two tasks leaves that dying route *stricter* than the ruling, never looser. Its stale "phases are masked" comment dies with it, and DES-132 carries the one sentence that stops anyone re-adding masking to its successor.


### TASK-126 — construct and wire the v23 subsystem in `createServer()`, and make both new seams REQUIRED
- **status:** done
- **traces:** ARCH-079, ARCH-078, ARCH-081
- **files:** src/server.ts, src/mcp-facade.ts, src/graph-analyzer.ts, tests/acceptance/val-114-trigger-bindings-live.test.ts
- **des:** DES-125, DES-127, DES-131, DES-134
- **dod:** `grep -rn "new GraphAnalyzer" src/` returns the ONE construction site in `createServer()` (today it returns nothing); `new McpFacade(...)` at server.ts:1398 passes real `triggerPorts` (composed from the THREE separate trigger stores per ARCH-078 — scheduler, webhook, continuation — not one batched read) and the real analyzer satisfying `McpFacadeDeps`' structural `{enabled, regenerate()}` shape; VAL-113/114/115 go green over live HTTP. **Both seams become REQUIRED in `McpFacadeDeps`** (adjudication #2 R-2) so an unwired call site is a `tsc` error rather than a silent degrade — `triggerPorts ?? NO_TRIGGER_PORTS` is deleted and tests that do not care pass `NO_TRIGGER_PORTS` explicitly; `npx tsc --noEmit` clean proves every call site was updated. Also lands TASK-117's two deferred boot lines (effective post-curation tool set + jail dir; B1's missing-diagram count + recovery command), which were blocked on exactly this construction site.
- **estimate:** L

### TASK-127 — build DES-122's zero-config fail-closed guard, which the design specifies and no code implements
- **status:** done
- **traces:** ARCH-079, ARCH-085
- **files:** src/server.ts, tests/integration/graph-analyzer-composition-root.test.ts
- **des:** DES-122
- **dod:** Gate 5 writes the RED case FIRST (a guard shipped without a test asserting it is exactly how DES-122 reached Gate 6 unbuilt and unnoticed). With `graphAnalyzer.enabled: true` and NO resolvable `workRoot`, `graphAnalyzer.tools` is forced to `[]` regardless of what the operator configured, and the boot line states the downgrade and its reason. Lands at `server.ts:1462-1475` — the ONE site where every `graphAnalyzer` key defaults — NOT `main.ts`, whose own convention at `:178-183` is "No defaults applied here". Rationale: with no `workRoot` the SDK gateway's `cwd` is `undefined` and that client's docblock records "nothing to enforce against, allow", i.e. no jail for an agent the architecture classifies as running on attacker-influenced input (ADR-016). Narrow exposure (the operator must BOTH set non-empty `graphAnalyzer.tools` AND run with no `workRoot`; the default is `[]`) bounds severity — it does not make an unbuilt guard acceptable.
- **estimate:** S

### TASK-128 — A1: the `workflow_describe` auth gate must run BEFORE any store read
- **status:** done
- **traces:** ARCH-076, ADR-012
- **files:** src/server.ts, src/mcp-facade.ts, README.md, DEPLOY.md, tests/integration/workflow-describe-auth-gate.test.ts
- **des:** DES-125
- **dod:** IT-101's four-row parameterized route oracle green, `{authEnabled:false} → 200` FIRST per 02-architecture.md's handoff. Today rows 3a/3b return **404 instead of 401**, which proves the gate does not run before the store read — an unauthenticated caller learns whether a name exists. Per ADJ-A1 the gate is at the TRANSPORT, a single projection, loopback-exempt. README/DEPLOY edits land in this task, not as a follow-up.
- **estimate:** M

### TASK-129 — A2/A3/A10: the analyzer must not call the gateway when disabled, must not strand a pending row, and must stop describing what it no longer does
- **status:** done
- **traces:** ARCH-079, ARCH-085
- **files:** src/graph-analyzer.ts, tests/unit/graph-analyzer.test.ts
- **des:** DES-127, DES-131
- **dod:** UT-124 (4 cases incl. a prior `ready` row surviving a disabled `enqueue()` — inv 11's latent-clobber text), UT-125 and UT-128 green. A2: the guard plus the moved write, so `enabled:false` never reaches `_attempt` at ANY entry point. A3: the closure handler, whose third assertion is that **the next enqueued job still runs** — a boot sweep that strands the queue is not a fix. A10: delete the false comment at `graph-analyzer.ts:176-179`.
- **estimate:** M

### TASK-130 — A4/A5/V-D: the diagram vocabulary is one declaration, and the projection is total over {row} × {analyzerEnabled}
- **status:** done
- **traces:** ARCH-080, ARCH-085
- **files:** src/workflow-view.ts, src/server.ts, src/trigger-bindings.ts, rwe.config.example.json, tests/unit/workflow-describe-projection.test.ts, tests/unit/diagram-vocabulary-consistency.test.ts
- **des:** DES-129, DES-130, DES-132
- **dod:** UT-126's two red cells (`unavailable+RETRIES_EXHAUSTED × disabled`, `pending × disabled`) and UT-127 green. A5: the vocabulary becomes an export the shipped prompt AND `rwe.config.example.json:59` are interpolated from, so a membership assertion can hold over both — plus delete the false comment at `server.ts:299-300`. A4: the two deleted lines and the UT-116 re-point. The four green pins in UT-126 stay as regression guards; do not weaken them to make the two red cells pass.
- **estimate:** M
- **closeout (Gate 6.5+7 round 4, 2026-09-03):** V-D and A5 landed in `a39c0e7` (IMPL-175); **A4 did not**, despite that commit's subject naming it — closed by the verifier as IMPL-176. Two `files:` entries needed no edit and this is why: `rwe.config.example.json`'s prompt already contains all 13 glyphs, so UT-127's membership oracle (the architecture's own chosen, cheaper check) holds over it unmodified; `src/trigger-bindings.ts` states no glyph of its own. `src/dashboard-page.ts` and `tests/unit/dashboard-diagram-render.test.ts` — A4's real targets — were missing from this list, which is part of why A4 was the item that slipped.

---

## v24 slice — TASK-131..153 (ARCH-087..108 / REQ-107..118)

> **Panel provenance:** synthesized from `.panel/design/` r1+r2 (adversarial 18-row partition + quality-dimensions'
> 7 split rules, both rounds). **Ordering constraints (binding):** TASK-139 (deletion) BEFORE TASK-147/148 (a facade
> written while the analyzer still compiles keeps a dead port "for now"); TASK-140..145 (stores/gateway) BEFORE
> TASK-147/148; TASK-146 BEFORE TASK-147/148; TASK-152 (rename sweep) is the LAST code task and lands as ONE
> mechanical commit whose message carries the `grep -c` before/after counts — running it earlier buries the genuine
> Gate 6 reds under 113 rename failures. **One WIP commit per task** (the window between 139 and 148 is a deliberately
> red tree; this ledger has already lost an iteration to an agent diffing an unclean tree — CLAUDE.md 2026-08-31).
> TASK-153 is external (separate repo, owner-scheduled) and blocks the REQ-117 probe, not Gate 6.

### TASK-131 — `ERROR_CATALOG` becomes the closed `ErrorCode` union; `see` is attached in one place
- **status:** draft
- **traces:** ARCH-087, ARCH-107
- **files:** src/errors.ts, src/params/contract.ts, src/seedref-egress.ts, src/workflow-catalog.ts, src/run-manager.ts, tests/unit/error-catalog.test.ts
- **des:** DES-137
- **dod:** `npx vitest run tests/unit/error-catalog.test.ts && npx tsc --noEmit` → ≥7 cases green (every `codedError('X'` literal in `src/` is a catalog key; every key ∈ some `TOOL_SPECS[].errors` ∪ `INGRESS_CODES`; `toErrEnvelope` attaches `see`; an uncatalogued string lands in `detail.rawCode`) and tsc clean with the four upstream unions constrained to `ErrorCode`.
- **estimate:** M
- **iter:** v24

### TASK-132 — `src/tool-specs.ts`: the 35-row array, the mode resolver, `projectToolsList()`
- **status:** draft
- **traces:** ARCH-087
- **files:** src/tool-specs.ts, tests/unit/tool-specs.test.ts
- **des:** DES-138
- **dod:** `npx vitest run tests/unit/tool-specs.test.ts` → ≥12 green incl. `TOOL_SPECS.length === 35`, the REQ-107 prefix rule, none of the 15 old names present, "a description containing /admin/i has `minRole:'admin'`", `run_start`'s two REQ-117 trap sentences as literals, and every `fixture` arg-set resolving to a named mode (never `'invalid'`). Restore `seed`, `seedManifest`, `seedRef` and `seedManifestRef` to the `run_start` row's `inputSchema` with the `SEED_*` errors — only `seedNamespace` was meant to go (ADR-028 derives it from the principal). Leaving them out makes the TASK-153 plugin doc advertise `run_start({seedManifestRef})` against an engine that rejects it, and pins the REQ-117 seed probe at UNVERIFIED (adjudication v24 #2 A-2). B-1 (adjudication #3): `version` is `{type:'string'}` on workflow_publish, workflow_source and run_start — NOT number. The catalog stores the string 'v1', so today number reaches the catalog and returns UNKNOWN_VERSION while the correct string is rejected by ajv first: NO argument shape succeeds. The field's `description` must state the format ('v1', from workflow_register's return) — a cold model reads the schema description and nothing else, so REQ-117 turns on that one line. Test both tools end to end with the exact value workflow_register returned.
- **estimate:** L
- **iter:** v24

### TASK-133 — `src/authz.ts`: `Principal`, `resolveRole`, `authorize()` total over the matrix
- **status:** draft
- **traces:** ARCH-088
- **files:** src/authz.ts, tests/unit/authz.test.ts, tests/integration/authz-owner-lookup.test.ts
- **des:** DES-139
- **dod:** `npx vitest run tests/unit/authz.test.ts tests/integration/authz-owner-lookup.test.ts` → ≥40 generated unit rows green WITH the `cases.length === N` pin (a partially-written table is red, not green) and ≥6 integration rows binding the real store columns to the port with the same verdicts.
- **estimate:** L
- **iter:** v24

### TASK-134 — `src/path-verdict.ts`: lexical verdict pure, containment through an injected `realpath`
- **status:** draft
- **traces:** ARCH-093
- **files:** src/path-verdict.ts, src/path-containment.ts, src/workspace-seed.ts, src/asset-sync.ts, tests/unit/path-verdict.test.ts
- **des:** DES-142
- **dod:** `npx vitest run tests/unit/path-verdict.test.ts` → ≥30 table rows green: every former `STRIP_RE` and `safeRelPath` case (copied as LITERAL rows, not imported) lands on the same verdict, a fake `realpath` returning an escaping target ⇒ `SYMLINK`, Windows separators and NUL rejected; `grep -c "STRIP_RE\|safeRelPath" src/workspace-seed.ts src/asset-sync.ts` → 0 (private copies gone).
- **estimate:** M
- **iter:** v24

### TASK-135 — `scanAgentCalls(script)`: literal labels, refused in-script params, line numbers
- **status:** draft
- **traces:** ARCH-096
- **files:** src/scan-agent-calls.ts, src/workflow-meta.ts, tests/unit/scan-agent-calls.test.ts
- **des:** DES-143
- **dod:** `npx vitest run tests/unit/scan-agent-calls.test.ts` → ≥25 green: one case per violation code with its expected 1-based `line`, nested `workflow(` argument lists NOT scanned, duplicate labels legal and de-duplicated in `labels`.
- **estimate:** M
- **iter:** v24

### TASK-136 — `params/contract.ts` v24: `agents.<label>` required defaults, `knobs`/`defaults` refused by name
- **status:** draft
- **traces:** ARCH-094
- **files:** src/params/contract.ts, tests/unit/params-contract.test.ts, tests/unit/params-overrides.test.ts
- **des:** DES-144, DES-145
- **dod:** `npx vitest run tests/unit/params-contract.test.ts tests/unit/params-overrides.test.ts` → ≥30 + ≥20 green (each new code; every ceiling REFUSED at registration, never clamped; `DEFAULTS_RETIRED` from both `meta.params.knobs` and `meta.defaults`; `UNKNOWN_AGENT_LABEL.detail.known` listed) and `grep -cE "^\\s*knobs\\??:" src/params/contract.ts` → 0 — the ban is on `knobs` as a TYPE FIELD, not on the substring: DES-144 REQUIRES `raw.knobs !== undefined` to return `DEFAULTS_RETIRED`, so the literal word must appear for the retirement check to exist at all. The original bare-substring dod could only be satisfied by deleting that check or obfuscating the identifier; the implementer refused both and reported the contradiction (adjudication v24 #2 A-1).
- **estimate:** L
- **iter:** v24

### TASK-137 — `params/resolve.ts`: three rungs (`override › default › engine`), per-key provenance
- **status:** draft
- **traces:** ARCH-095
- **files:** src/params/resolve.ts, tests/unit/params-resolve.test.ts
- **des:** DES-146
- **dod:** `npx vitest run tests/unit/params-resolve.test.ts` → ≥15 green (ladder + provenance per key; an undeclared label at dispatch THROWS `INTERNAL_ERROR`, never silently uses engine defaults) and `grep -c "'call'\|agentType" src/params/resolve.ts` → 0.
- **estimate:** M
- **iter:** v24

### TASK-138 — `diagram-gate.ts` → `checkMermaid`: fixed grammar, bidirectional label diff, value triple
- **status:** draft
- **traces:** ARCH-097
- **files:** src/check-mermaid.ts, tests/unit/check-mermaid.test.ts
- **des:** DES-147
- **dod:** `npx vitest run tests/unit/check-mermaid.test.ts` → ≥60 green: one case per code × rule with the expected `line`, `UNDECLARED_NODE` and `DUPLICATE_NODE`, CRLF accepted, the SCC cycle set (`<-->` is not a cycle), `120s ≡ 120000`, BOTH diff sets on one mismatch, and every `GUIDE_EXAMPLES[].mermaid` passing against its own script's labels.
- **estimate:** L
- **iter:** v24

### TASK-139 — the deletion, with its own definition of done (3+1 source files, 15 test files, 3 grep guards)
- **status:** draft
- **traces:** ARCH-089, ARCH-096, ARCH-101, ARCH-106
- **files:** src/graph-analyzer.ts (DELETE), src/continuation-store.ts (DELETE), src/mcp-registry.ts (DELETE), src/trigger-bindings.ts (DELETE), src/server.ts, src/mcp-facade.ts, src/main.ts, src/workflow-view.ts, src/gateway/claude-agent-sdk-client.ts, tests/unit/no-retired-surface.test.ts (NEW), tests/acceptance/val-113-graph-analyzer-diagram.test.ts (DELETE), tests/acceptance/val-020-mcp-provisioning.test.ts (DELETE), tests/integration/continuation-store.test.ts (DELETE), tests/integration/graph-analyzer-composition-root.test.ts (DELETE), tests/integration/graph-analyzer-late-write.test.ts (DELETE), tests/integration/mcp-provision-wiring.test.ts (DELETE), tests/integration/mcp-provision-injection-wiring.test.ts (DELETE), tests/unit/diagram-gate.test.ts (DELETE), tests/unit/diagram-vocabulary-consistency.test.ts (DELETE), tests/unit/graph-analyzer-wire.test.ts (DELETE), tests/unit/graph-analyzer.test.ts (DELETE), tests/unit/mcp-registry.test.ts (DELETE), tests/unit/trigger-bindings.test.ts (DELETE), tests/e2e/mcp-provision-secret-tooluse-journey.test.ts (DELETE)
- **des:** DES-159
- **note:** SCOPE — in the five CONSUMER files listed above (`server.ts`, `mcp-facade.ts`, `main.ts`, `workflow-view.ts`, `gateway/claude-agent-sdk-client.ts`) remove ONLY the import and the code that used it: the `GraphAnalyzer`/`ContinuationStore` constructions and their `case` arms, the `graphAnalyzer` boot warn and config field, `ANALYZER_SCRATCH_SUBDIR`, `noteTextFor`, the `TriggerBinding`/`getTriggerBindings` reads (`server.ts:1458-1459`, `mcp-facade.ts:24-25/436`), and the `McpRegistry` import — replacing `resolveProvisionedMcp`'s registry read with DES-154's injected `resolveMcp` port left UNBOUND (resolves nothing) so the final seam shape exists without a throwaway stub. NO replacement wiring here: `describe.triggers[]` by id is TASK-149, the catalog-backed `resolveMcp` is TASK-145, the new `callTool`/facade are TASK-147/148 — which is exactly why this task precedes them. The in-file symbol deletions (`gateDiagram`/`VOCAB_GLYPHS`/`DIAGRAM_CODEPOINTS`, `resolveCallParams`, `knobs`, the no-meta branch) belong to TASK-138/137/136, which rewrite those files.
- **dod:** `npx vitest run tests/unit/no-retired-surface.test.ts && npx tsc --noEmit` → the three source-text guards green (no `mermaid` import/CDN in `src/`; none of the 15 old tool names in `src/`; no `Date.now()`/`new Date()` outside `clock.ts` in the four new files) and tsc clean after the deletions — i.e. no surviving import of a deleted module. B-2 (adjudication #3): also drop the `workflow_diagrams` table, `putDiagramPending` and every accessor from workflow-catalog.ts, and DELETE tests/unit/workflow-diagrams-store.test.ts — v24 stores the author's mermaid verbatim on the version row (workflow-view.ts:35-37 already says there is no separate diagram row) so async diagram generation has no reason to exist. dod asserts the file is GONE (`test ! -f tests/unit/workflow-diagrams-store.test.ts`) and `grep -rn workflow_diagrams src/` is empty. Leaving a green test for a retired mechanism is the failure this ledger keeps recording: the green light tells the next reader the mechanism is both alive and protected, and neither is true.
- **estimate:** L
- **iter:** v24

### TASK-140 — run store: filtered `list` + its index, `getOwner`, the `audit_events` table and its reader
- **status:** draft
- **traces:** ARCH-092
- **files:** src/store/sqlite-run-store.ts, src/run-store.ts, src/types.ts, tests/integration/run-list.test.ts, tests/integration/run-store-audit.test.ts, tests/unit/audit-order.test.ts
- **des:** DES-151, DES-152
- **dod:** `npx vitest run tests/integration/run-list.test.ts tests/integration/run-store-audit.test.ts tests/unit/audit-order.test.ts` → ≥10 + ≥8 + ≥4 green incl. `EXPLAIN QUERY PLAN` naming `runs_name_status_created`, `InMemoryRunStore.list` parity against a hand-written expected array, and the recording-fake order `['appendAudit','readArtifactChunk']`. The shipped `run-list.test.ts` (3 cases) and `run-store-audit.test.ts` (4 cases) fall short of this dod's own ≥10 and ≥8. Fill them — the /goal makes test COUNT and depth this iteration's primary defence against the lower executor tier, so half the cases is half the defence (adjudication v24 #2 A-6).
- **estimate:** L
- **iter:** v24

### TASK-141 — scheduler: the five columns, `claim`/`release`/`ownerOf`, `markRefused`, the H4 check moved out of `create`
- **status:** draft
- **traces:** ARCH-099
- **files:** src/scheduler.ts, src/types.ts, tests/unit/scheduler-refusal.test.ts
- **des:** DES-149, DES-150
- **dod:** `npx vitest run tests/unit/scheduler-refusal.test.ts` → ≥10 green under a FixedClock and `:memory:`, incl. TWO ticks at the same instant ⇒ `refusalCount === 1` AND `nextFire > now` (the tight-loop trap), a refused `once` consumed, `markFired` resetting `refusalCount` to 0, `lastError` untouched by a refusal.
- **estimate:** L
- **iter:** v24

### TASK-142 — webhooks: the same claim model; HMAC/timestamp/dedup BEFORE the claim checks
- **status:** draft
- **traces:** ARCH-100
- **files:** src/webhook-registry.ts, tests/integration/webhook-registry.test.ts
- **des:** DES-149, DES-150
- **dod:** `npx vitest run tests/integration/webhook-registry.test.ts` → ≥12 green incl. a wrong HMAC on an UNCLAIMED webhook ⇒ 401 (never 409 — an unauthenticated caller must not learn claim state), the same `deliveryId` twice while unclaimed ⇒ 409/409 with `refusalCount === 2` and NO dedup record, then claimed ⇒ 202 with a real run.
- **estimate:** M
- **iter:** v24

### TASK-143 — catalog: `validateRegistration`/`insertVersion` split, `mermaid`+`triggers` columns, the `assets` table, migrations, `deregister`
- **status:** draft
- **traces:** ARCH-098
- **files:** src/workflow-catalog.ts, src/workspace-gc.ts, tests/integration/catalog-v24.test.ts
- **des:** DES-148
- **dod:** `npx vitest run tests/integration/catalog-v24.test.ts` → ≥25 green: after EVERY refusal code the `workflow_versions` row count is unchanged (validation writes nothing); the migration over a v23 fixture db runs twice with an identical end state; no post-migration row is written with `mermaid NULL`; `deregister` deletes `assets` rows and returns the union of `triggers[]` over all versions; an orphan `<workRoot>/<name>/assets/` tree is reclaimed by the GC sweep while a live workflow's tree is not.
- **estimate:** L
- **iter:** v24

### TASK-144 — `asset-sync.ts` v24: two scopes, `pushedBy` on every row, `kind:'mcp'` behind the egress gate
- **status:** draft
- **traces:** ARCH-102
- **files:** src/asset-sync.ts, tests/unit/asset-sync-v24.test.ts, tests/integration/asset-mcp-tools.test.ts
- **des:** DES-153
- **dod:** `npx vitest run tests/unit/asset-sync-v24.test.ts tests/integration/asset-mcp-tools.test.ts` → ≥20 + rewrite green incl. an `http` MCP config outside the allowlist ⇒ `EGRESS_DENIED` with the probe spy asserting ZERO probe calls, FS-written-then-row order proven by a recording catalog fake, and `pushedBy` present on every stored row. Build on the `pathVerdict(targetDir, path, undefined, 'asset-tree')` wiring TASK-134 already landed; do NOT reintroduce the private `safeRelPath` copy it deleted (adjudication v24 #2 A-7). The per-file `rwe-` first-segment rejection is INTENTIONAL defence in depth and stays (A-5) — a file named `rwe-notes.txt` inside an otherwise-allowed asset is refused, and `workflow_authoring_guide` says so.
- **estimate:** L
- **iter:** v24

### TASK-145 — selective materialization inside the SDK gateway + `label`/`materialized` on the descriptor + `deriveAgentRecords` reads `label`
- **status:** draft
- **traces:** ARCH-103, ARCH-104
- **files:** src/gateway/claude-agent-sdk-client.ts, src/agent-executor.ts, src/run-store.ts, src/types.ts, tests/unit/materialize-assets.test.ts, tests/unit/derive-agent-records-v24.test.ts, tests/integration/agent-log-harness-shape.test.ts, tests/integration/asset-skill-materialization-wiring.test.ts
- **des:** DES-154, DES-160, DES-161
- **dod:** `npx vitest run tests/unit/materialize-assets.test.ts tests/unit/derive-agent-records-v24.test.ts tests/integration/agent-log-harness-shape.test.ts tests/integration/asset-skill-materialization-wiring.test.ts` → ≥12 + ≥6 + the two rewrites green, incl. the `surfaceType:'none'` fixture (`materialized = {skills:[],mcp:[],missing:declared}`, nothing copied) and a `run_status` read from the store with the `RunManager` dropped still showing each agent's `label`.
- **estimate:** L
- **iter:** v24

### TASK-146 — `composeConfig()` forwards `principals` + `mcpEgressAllowlist`; unknown-key warn; the auth announcement
- **status:** draft
- **traces:** ARCH-090
- **files:** src/main.ts, src/server.ts, rwe.config.example.json, README.md, DEPLOY.md, tests/unit/compose-config-v2-wiring.test.ts, tests/unit/normalize-principals.test.ts, tests/integration/main-composition-root.test.ts
- **des:** DES-141
- **dod:** `npx vitest run tests/unit/compose-config-v2-wiring.test.ts tests/unit/normalize-principals.test.ts tests/integration/main-composition-root.test.ts` → the wiring test GAINS rows for `principals` and `mcpEgressAllowlist` and LOSES the `graphAnalyzer` row; ≥5 normalize cases incl. a malformed role refusing boot; the boot line `auth: enabled=… principals=… defaultRole=…` and `system_info.auth` asserted, with a stale `graphAnalyzer` key warned once naming ADR-025.
- **estimate:** M
- **iter:** v24

### TASK-147 — the server wire: `Principal` at the edge, `callTool(deps, …)`, `tools/list` as a projection, no identity on ungated `/api/*`
- **status:** draft
- **traces:** ARCH-089
- **files:** src/server.ts, tests/unit/call-tool-order.test.ts, tests/integration/mcp-tools-list-http.test.ts, tests/integration/namespace-derivation.test.ts, tests/integration/api-runs-public-projection.test.ts
- **des:** DES-140, DES-142, DES-162
- **dod:** `npx vitest run tests/unit/call-tool-order.test.ts tests/integration/mcp-tools-list-http.test.ts tests/integration/namespace-derivation.test.ts tests/integration/api-runs-public-projection.test.ts` → ≥5 order cases (schema BEFORE authz, short-circuit proven), `tools/list` over real HTTP byte-equal to `projectToolsList()` and containing none of the 15 old names, ≥4 namespace cases (all three caller-typed sites refused; the derived namespace equals the principal id), ≥3 projection cases (`/api/runs` and `/api/runs/:id` carry no `principal`, MCP `run_status` still carries `adminReads` for the owner).
- **estimate:** L
- **iter:** v24

### TASK-148 — the facade: 35 handlers, the register→claim→insert→compensate sequence, the six `workspace_*` modes, the audited cross-read
- **status:** draft
- **traces:** ARCH-091
- **files:** src/mcp-facade.ts, src/run-manager.ts, tests/integration/workspace-tools.test.ts, tests/integration/trigger-claims.test.ts, tests/e2e/admin-cross-read.test.ts, tests/e2e/register-crash-window.test.ts
- **des:** DES-149, DES-151, DES-152, DES-155
- **dod:** `npx vitest run tests/integration/workspace-tools.test.ts tests/integration/trigger-claims.test.ts` → ≥25 + ≥20 green incl. every `workspace_*` mode's happy and refusal path, `runId` on push refused BY THE SCHEMA, all-or-nothing `workspace_delete`, `RUN_NOT_TERMINAL` against a live sandbox run, and the compensation releasing ONLY the ids this call claimed (an id already `'held'` by an earlier version stays claimed). Also fix `tests/integration/trigger-claims.test.ts` lines 29/41/52, which destructure `const { id } = await port.create(...)` off a `{result, error}` envelope — `id` is `undefined` so every `claim()` resolves NOT_FOUND. That is a test defect, not a scheduler defect: the claim/release/ownerOf implementation was verified against DES-149 independently (adjudication v24 #2 A-7).
- **estimate:** L
- **iter:** v24

### TASK-149 — the read projections and the dashboard: `params.agents`, `mermaid`, `runnable`; the `diagramStatus` family gone
- **status:** draft
- **traces:** ARCH-105, ARCH-106
- **files:** src/workflow-view.ts, src/dashboard-page.ts, tests/unit/workflow-describe-projection.test.ts, tests/unit/dashboard-diagram-render.test.ts
- **des:** DES-156
- **dod:** `npx vitest run tests/unit/workflow-describe-projection.test.ts tests/unit/dashboard-diagram-render.test.ts` → `EXPECTED_DESCRIBE_KEYS` re-pinned by a HAND-TYPED array (the four `diagram*` keys gone, `mermaid`/`mermaidNote`/`runnable`/`runnableReason` present), a ≥6-row `runnable` truth table, `describe.params.agents.<label>` reporting range = author ∩ ceiling, and the dashboard writing `describe.mermaid` into `<pre>` via `textContent` with no polling branch.
- **estimate:** M
- **iter:** v24

### TASK-150 — `workflow_authoring_guide` built from the enforcement constants; `GUIDE_EXAMPLES`; generated `docs/AUTHORING.md`
- **status:** draft
- **traces:** ARCH-107
- **files:** src/authoring-guide.ts, scripts/gen-authoring-md.ts, docs/AUTHORING.md, package.json, tests/unit/authoring-guide.test.ts, tests/unit/authoring-md-generated.test.ts, tests/integration/guide-examples-register.test.ts
- **des:** DES-157
- **dod:** `npx vitest run tests/integration/guide-examples-register.test.ts tests/unit/authoring-guide.test.ts tests/unit/authoring-md-generated.test.ts` → one `it` PER example (≥10) registering over real MCP HTTP against a booted engine and returning `{version}`; the fake-ceiling test proving interpolation (a non-default `maxTimeoutMs` appears in the text); every `[A-Z_]{6,}` token in the guide is an `ERROR_CATALOG` key and every tool name is in `TOOL_SPECS`; `docs/AUTHORING.md` byte-equal to the builder's output.
- **estimate:** L
- **iter:** v24

### TASK-151 — the REQ-118 live-engine table (generated) and the REQ-117 cold-model runbook
- **status:** draft
- **traces:** ARCH-108
- **files:** tests/acceptance/v24-tool-surface.test.ts, tests/acceptance/val-mermaid-renders.test.ts, .sdlc/features/001-remote-workflow-engine/v24-tool-surface.md, .sdlc/features/001-remote-workflow-engine/08-validation.md
- **des:** DES-158, DES-147
- **dod:** `npx vitest run tests/acceptance/v24-tool-surface.test.ts` → one `it` per `TOOL_SPECS` happy fixture and one per constructible `errors[]` entry, all green or `UNVERIFIED(reason)` as a ROW; the generated `v24-tool-surface.md` is written ONLY on a full 35/35 run and carries a `rows: N/35` stamp, with the per-array-entry assertion failing on a short table.
- **estimate:** L
- **iter:** v24

### TASK-152 — the rename sweep: 113 test files, one mechanical commit, grep target zero
- **status:** draft
- **traces:** ARCH-087, ARCH-089
- **files:** tests/** (113 files referencing an old tool name or `params.knobs`)
- **des:** DES-159
- **dod:** `grep -rlE "workflow_run|workflow_get|workflow_artifacts|workflow_artifact_get|blob_put|seed_plan|asset_push|asset_list|asset_delete|chain_create|chain_list|workflow_trigger|run_trigger|mcp_provision|workflow_regenerate_diagram|issue_comments\b|issue_comment\b|params\.knobs" src tests | grep -v "tests/unit/tool-specs.test.ts"` → EMPTY, and `npx vitest run` fully green; the commit message carries the before/after `grep -c` counts. B-3 (adjudication #3): this sweep also owns the FIXTURE migration, which is one job and not three: 39 remaining positional `catalog.register('name', script, …)` call sites across 7 test files, the now-required `mermaid`, and the now-required `meta.params.agents.<label>` (today's suite fails with AGENT_UNDECLARED label "plan" and SCAN_VIOLATION AGENT_LABEL_REQUIRED). Do it at the LEVERAGE POINT: make tests/helpers/workflow-fixtures.ts synthesize a minimal valid mermaid and params.agents from the script's own labels, so the 67 files that go through registerPublishedVia fix themselves instead of being edited one by one. dod: files routed through the helper that still fail → 0, and `grep -rn "\.register('" tests/` → empty.
- **estimate:** M
- **iter:** v24

### TASK-153 — client plugin v24 sync (EXTERNAL repo, owner-scheduled; blocks the REQ-117 probe, not Gate 6)
- **status:** draft
- **traces:** ARCH-013
- **files:** (external) iso-rwe client plugin: guidance skill text, push_workspace.py
- **des:** DES-138, DES-142
- **dod:** From a checkout of the plugin: `grep -rlE "workflow_run|workflow_get|blob_put|mcp_provision|namespace=" .` → EMPTY; the guidance skill lists exactly the 35 `TOOL_SPECS` names. Recorded as the REQ-117 probe precondition in 08-validation.md; if unmet at Gate 7.5 the probe is `UNVERIFIED(client plugin not synced)`, never run against a stale surface.
- **estimate:** M
- **iter:** v24

### TASK-154 — retire the three v15-era harness-`defaults` test files that `DEFAULTS_RETIRED` invalidates
- **status:** draft
- **traces:** ARCH-094, ADR-035
- **files:** tests/integration/harness-defaults-validation.test.ts, tests/acceptance/val-098-harness-defaults.test.ts, tests/acceptance/val-103-effort-real.test.ts, src/errors.ts
- **des:** DES-144, DES-148
- **dod:** Every assertion that exercised the v15 `defaults`/`knobs` registration path is DELETED or rewritten against `meta.params.agents.<label>` — none is left asserting `HARNESS_DEFAULTS_INVALID` as a live code. A test that named a retired mechanism and still passes is worse than a red one: `grep -rn "HARNESS_DEFAULTS_INVALID" tests/` → only rows asserting it is GONE. `src/errors.ts`'s header comment, which forewarned exactly this breakage, is updated to say it happened. Run the three files → green, and state the case count before/after in 06-impl-log.md so a silent mass-deletion is visible.
- **estimate:** M
- **iter:** v24

### TASK-155 — `TOOL_SPECS` as const, `AuditAction` via `Extract<ToolName,…>`, and the `errors[]` reconciliation
- **status:** draft
- **traces:** ARCH-087, ARCH-092
- **files:** src/tool-specs.ts, src/types.ts
- **des:** DES-137, DES-151
- **dod:** `TOOL_SPECS` is `as const` so `ToolName` is a literal union, and `AuditAction` becomes DES-151's `Extract<ToolName, …>` form — verify it did NOT silently resolve to `never` by asserting a value of the type compiles AND that an invalid member is a type error (a type that is `never` accepts nothing and would pass a shallow check). `UNKNOWN_VERSION` → `VERSION_NOT_FOUND` and `SEEDREF_EGRESS_DENIED` → `EGRESS_DENIED` everywhere including tests (`grep -rn "UNKNOWN_VERSION\|SEEDREF_EGRESS_DENIED" src/ tests/` → empty). Every code thrown by live `src/` appears in the `errors[]` of the row whose tool can throw it — at minimum SEEDREF_*, CAS_UNAVAILABLE, NESTING_*, DESCENDANT_CAP_EXCEEDED, REGISTRATION_CONFLICT, VERSION_CEILING_EXCEEDED, PARAM_SECRET_UNAVAILABLE, RUN_ADMISSION_LIMIT, INVALID_SEED_SPEC, SEED_SOURCE_CONFLICT, each justified by the call site that throws it. B-7 (adjudication #3): also constrain `ScriptCheckCode`/`ScriptCheckError.code` in src/script-checks.ts to `Extract<ErrorCode, …>` — it is still a bare literal union, the last hole in DES-137's type-level net. Its three values are valid catalog keys today so nothing is broken; the point is that the net catches the next one.
- **estimate:** M
- **iter:** v24

### TASK-156 — webhook store: rebuild the table so a pre-v24 db accepts an unclaimed row
- **status:** draft
- **traces:** ARCH-100
- **files:** src/webhook-registry.ts, tests/integration/webhook-migration.test.ts
- **des:** DES-150
- **dod:** A test that CREATES a pre-v24 schema (`workflow` NOT NULL), writes a row, then opens the store and calls `create({})` with no workflow → succeeds, and the pre-existing row survives with its data intact. SQLite cannot drop NOT NULL via ALTER, so this is a create-copy-drop-rename rebuild; the test must fail against today's code first. Migration is idempotent: run the constructor twice, assert no duplicate rows and no error.
- **estimate:** M
- **iter:** v24

### TASK-157 — reconcile `AuditReadStore.readArtifactChunk` with the real `workspace-artifacts` signature
- **status:** draft
- **traces:** ARCH-092
- **files:** src/audited-read.ts, src/mcp-facade.ts, tests/unit/audit-order.test.ts
- **des:** DES-151
- **dod:** One signature, not two: the port matches `workspace-artifacts.ts`'s real `readArtifactChunk(workspace, path, offset, length)` (the invented `{runId, owner, path}` object shape was the implementer's own admission — adjudication v24 #2 A-7). `workspace_pull`, `run_agent_log` and `run_result` go through the audited path in the facade, and audit-order.test.ts still pins `['appendAudit','readArtifactChunk']` — the audit row is written BEFORE bytes are read (ARCH-091 note 2: an audit row for a read that did not happen is acceptable, the reverse is not).
- **estimate:** M
- **iter:** v24

### TASK-158 — admission-time param merge reconciled with the nested `UserOverrides`
- **status:** draft
- **traces:** ARCH-095
- **files:** src/params/resolve.ts, src/run-manager.ts, src/run-store.ts, src/store/sqlite-run-store.ts, tests/unit/params-resolve.test.ts
- **des:** DES-145, DES-146
- **dod:** `mergeRunParams`/`defaultRunParams` (DES-102, admission time) accept DES-145's `{agents?: Record<label, Partial<…>>}` instead of the flat pre-v24 shape; `npx tsc --noEmit` reports ZERO errors in these files. A test pins that a per-agent override reaches admission for that label ONLY and does not leak to a sibling agent — the flat shape's whole defect (REQ-110) was that one value applied to every agent, so a merge that silently broadcasts must fail.
- **estimate:** L
- **iter:** v24

### TASK-159 — `workflow-meta.ts`: the three 2-arg calls into the 3-arg `parseParamContract`
- **status:** draft
- **traces:** ARCH-094
- **files:** src/workflow-meta.ts
- **des:** DES-144
- **dod:** HIGHEST SEVERITY of the Gate 5 batch — `:55`, `:69` and `:72` pass `aliasNames` into the `scriptLabels` slot, so EVERY registration whose script omits `meta.params` throws `AGENT_UNDECLARED` naming label "undefined". All three call sites pass `scanAgentCalls(script).labels`. **CORRECTED by adjudication (v24) #4 C-7 [17] — the sentence that stood here was WRONG and must not be restored:** it said "a test registers a script with `agent()` calls and NO `meta.params` and asserts it REGISTERS". DES-144 rules the opposite — one or more UNDECLARED labels ⇒ `AGENT_UNDECLARED` — and the shipped test follows DES-144, correctly. The defect this task fixes is the label NAMED in that refusal ("undefined" instead of the real label), not the refusal itself. The dod is therefore: a script with `agent('x', {})` and no `meta.params` is refused `AGENT_UNDECLARED` **naming `x`**, and the same script WITH `meta.params.agents.x` registers. Nobody may later "fix" the test toward the retracted sentence.
- **estimate:** S
- **iter:** v24
