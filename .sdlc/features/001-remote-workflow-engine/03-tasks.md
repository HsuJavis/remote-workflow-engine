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
- **status:** done
- **traces:** ARCH-087, ARCH-107
- **files:** src/errors.ts, src/params/contract.ts, src/seedref-egress.ts, src/workflow-catalog.ts, src/run-manager.ts, tests/unit/error-catalog.test.ts
- **des:** DES-137
- **dod:** `npx vitest run tests/unit/error-catalog.test.ts && npx tsc --noEmit` → ≥7 cases green (every `codedError('X'` literal in `src/` is a catalog key; every key ∈ some `TOOL_SPECS[].errors` ∪ `INGRESS_CODES`; `toErrEnvelope` attaches `see`; an uncatalogued string lands in `detail.rawCode`) and tsc clean with the four upstream unions constrained to `ErrorCode`.
- **estimate:** M
- **iter:** v24

### TASK-132 — `src/tool-specs.ts`: the 35-row array, the mode resolver, `projectToolsList()`
- **status:** done
- **traces:** ARCH-087
- **files:** src/tool-specs.ts, tests/unit/tool-specs.test.ts
- **des:** DES-138
- **dod:** `npx vitest run tests/unit/tool-specs.test.ts` → ≥12 green incl. `TOOL_SPECS.length === 35`, the REQ-107 prefix rule, none of the 15 old names present, "a description containing /admin/i has `minRole:'admin'`", `run_start`'s two REQ-117 trap sentences as literals, and every `fixture` arg-set resolving to a named mode (never `'invalid'`). Restore `seed`, `seedManifest`, `seedRef` and `seedManifestRef` to the `run_start` row's `inputSchema` with the `SEED_*` errors — only `seedNamespace` was meant to go (ADR-028 derives it from the principal). Leaving them out makes the TASK-153 plugin doc advertise `run_start({seedManifestRef})` against an engine that rejects it, and pins the REQ-117 seed probe at UNVERIFIED (adjudication v24 #2 A-2). B-1 (adjudication #3): `version` is `{type:'string'}` on workflow_publish, workflow_source and run_start — NOT number. The catalog stores the string 'v1', so today number reaches the catalog and returns UNKNOWN_VERSION while the correct string is rejected by ajv first: NO argument shape succeeds. The field's `description` must state the format ('v1', from workflow_register's return) — a cold model reads the schema description and nothing else, so REQ-117 turns on that one line. Test both tools end to end with the exact value workflow_register returned.
- **estimate:** L
- **iter:** v24

### TASK-133 — `src/authz.ts`: `Principal`, `resolveRole`, `authorize()` total over the matrix
- **status:** done
- **traces:** ARCH-088
- **files:** src/authz.ts, tests/unit/authz.test.ts, tests/integration/authz-owner-lookup.test.ts
- **des:** DES-139
- **dod:** `npx vitest run tests/unit/authz.test.ts tests/integration/authz-owner-lookup.test.ts` → ≥40 generated unit rows green WITH the `cases.length === N` pin (a partially-written table is red, not green) and ≥6 integration rows binding the real store columns to the port with the same verdicts.
- **estimate:** L
- **iter:** v24

### TASK-134 — `src/path-verdict.ts`: lexical verdict pure, containment through an injected `realpath`
- **status:** done
- **traces:** ARCH-093
- **files:** src/path-verdict.ts, src/path-containment.ts, src/workspace-seed.ts, src/asset-sync.ts, tests/unit/path-verdict.test.ts
- **des:** DES-142
- **dod:** `npx vitest run tests/unit/path-verdict.test.ts` → ≥30 table rows green: every former `STRIP_RE` and `safeRelPath` case (copied as LITERAL rows, not imported) lands on the same verdict, a fake `realpath` returning an escaping target ⇒ `SYMLINK`, Windows separators and NUL rejected; `grep -c "STRIP_RE\|safeRelPath" src/workspace-seed.ts src/asset-sync.ts` → 0 (private copies gone).
- **estimate:** M
- **iter:** v24

### TASK-135 — `scanAgentCalls(script)`: literal labels, refused in-script params, line numbers
- **status:** done
- **traces:** ARCH-096
- **files:** src/scan-agent-calls.ts, src/workflow-meta.ts, tests/unit/scan-agent-calls.test.ts
- **des:** DES-143
- **dod:** `npx vitest run tests/unit/scan-agent-calls.test.ts` → ≥25 green: one case per violation code with its expected 1-based `line`, nested `workflow(` argument lists NOT scanned, duplicate labels legal and de-duplicated in `labels`.
- **estimate:** M
- **iter:** v24

### TASK-136 — `params/contract.ts` v24: `agents.<label>` required defaults, `knobs`/`defaults` refused by name
- **status:** done
- **traces:** ARCH-094
- **files:** src/params/contract.ts, tests/unit/params-contract.test.ts, tests/unit/params-overrides.test.ts
- **des:** DES-144, DES-145
- **dod:** `npx vitest run tests/unit/params-contract.test.ts tests/unit/params-overrides.test.ts` → ≥30 + ≥20 green (each new code; every ceiling REFUSED at registration, never clamped; `DEFAULTS_RETIRED` from both `meta.params.knobs` and `meta.defaults`; `UNKNOWN_AGENT_LABEL.detail.known` listed) and `grep -cE "^\\s*knobs\\??:" src/params/contract.ts` → 0 — the ban is on `knobs` as a TYPE FIELD, not on the substring: DES-144 REQUIRES `raw.knobs !== undefined` to return `DEFAULTS_RETIRED`, so the literal word must appear for the retirement check to exist at all. The original bare-substring dod could only be satisfied by deleting that check or obfuscating the identifier; the implementer refused both and reported the contradiction (adjudication v24 #2 A-1).
- **estimate:** L
- **iter:** v24

### TASK-137 — `params/resolve.ts`: three rungs (`override › default › engine`), per-key provenance
- **status:** done
- **traces:** ARCH-095
- **files:** src/params/resolve.ts, tests/unit/params-resolve.test.ts
- **des:** DES-146
- **dod:** `npx vitest run tests/unit/params-resolve.test.ts` → ≥15 green (ladder + provenance per key; an undeclared label at dispatch THROWS `INTERNAL_ERROR`, never silently uses engine defaults) and `grep -c "'call'\|agentType" src/params/resolve.ts` → 0.
- **estimate:** M
- **iter:** v24

### TASK-138 — `diagram-gate.ts` → `checkMermaid`: fixed grammar, bidirectional label diff, value triple
- **status:** done
- **traces:** ARCH-097
- **files:** src/check-mermaid.ts, tests/unit/check-mermaid.test.ts
- **des:** DES-147
- **dod:** `npx vitest run tests/unit/check-mermaid.test.ts` → ≥60 green: one case per code × rule with the expected `line`, `UNDECLARED_NODE` and `DUPLICATE_NODE`, CRLF accepted, the SCC cycle set (`<-->` is not a cycle), `120s ≡ 120000`, BOTH diff sets on one mismatch, and every `GUIDE_EXAMPLES[].mermaid` passing against its own script's labels.
- **estimate:** L
- **iter:** v24

### TASK-139 — the deletion, with its own definition of done (3+1 source files, 15 test files, 3 grep guards)
- **status:** done
- **traces:** ARCH-089, ARCH-096, ARCH-101, ARCH-106
- **files:** src/graph-analyzer.ts (DELETE), src/continuation-store.ts (DELETE), src/mcp-registry.ts (DELETE), src/trigger-bindings.ts (DELETE), src/server.ts, src/mcp-facade.ts, src/main.ts, src/workflow-view.ts, src/gateway/claude-agent-sdk-client.ts, tests/unit/no-retired-surface.test.ts (NEW), tests/acceptance/val-113-graph-analyzer-diagram.test.ts (DELETE), tests/acceptance/val-020-mcp-provisioning.test.ts (DELETE), tests/integration/continuation-store.test.ts (DELETE), tests/integration/graph-analyzer-composition-root.test.ts (DELETE), tests/integration/graph-analyzer-late-write.test.ts (DELETE), tests/integration/mcp-provision-wiring.test.ts (DELETE), tests/integration/mcp-provision-injection-wiring.test.ts (DELETE), tests/unit/diagram-gate.test.ts (DELETE), tests/unit/diagram-vocabulary-consistency.test.ts (DELETE), tests/unit/graph-analyzer-wire.test.ts (DELETE), tests/unit/graph-analyzer.test.ts (DELETE), tests/unit/mcp-registry.test.ts (DELETE), tests/unit/trigger-bindings.test.ts (DELETE), tests/e2e/mcp-provision-secret-tooluse-journey.test.ts (DELETE)
- **des:** DES-159
- **note:** SCOPE — in the five CONSUMER files listed above (`server.ts`, `mcp-facade.ts`, `main.ts`, `workflow-view.ts`, `gateway/claude-agent-sdk-client.ts`) remove ONLY the import and the code that used it: the `GraphAnalyzer`/`ContinuationStore` constructions and their `case` arms, the `graphAnalyzer` boot warn and config field, `ANALYZER_SCRATCH_SUBDIR`, `noteTextFor`, the `TriggerBinding`/`getTriggerBindings` reads (`server.ts:1458-1459`, `mcp-facade.ts:24-25/436`), and the `McpRegistry` import — replacing `resolveProvisionedMcp`'s registry read with DES-154's injected `resolveMcp` port left UNBOUND (resolves nothing) so the final seam shape exists without a throwaway stub. NO replacement wiring here: `describe.triggers[]` by id is TASK-149, the catalog-backed `resolveMcp` is TASK-145, the new `callTool`/facade are TASK-147/148 — which is exactly why this task precedes them. The in-file symbol deletions (`gateDiagram`/`VOCAB_GLYPHS`/`DIAGRAM_CODEPOINTS`, `resolveCallParams`, `knobs`, the no-meta branch) belong to TASK-138/137/136, which rewrite those files.
- **dod:** `npx vitest run tests/unit/no-retired-surface.test.ts && npx tsc --noEmit` → the three source-text guards green (no `mermaid` import/CDN in `src/`; none of the 15 old tool names in `src/`; no `Date.now()`/`new Date()` outside `clock.ts` in the four new files) and tsc clean after the deletions — i.e. no surviving import of a deleted module. B-2 (adjudication #3): also drop the `workflow_diagrams` table, `putDiagramPending` and every accessor from workflow-catalog.ts, and DELETE tests/unit/workflow-diagrams-store.test.ts — v24 stores the author's mermaid verbatim on the version row (workflow-view.ts:35-37 already says there is no separate diagram row) so async diagram generation has no reason to exist. dod asserts the file is GONE (`test ! -f tests/unit/workflow-diagrams-store.test.ts`) and `grep -rn workflow_diagrams src/` is empty. Leaving a green test for a retired mechanism is the failure this ledger keeps recording: the green light tells the next reader the mechanism is both alive and protected, and neither is true.
- **estimate:** L
- **iter:** v24

### TASK-140 — run store: filtered `list` + its index, `getOwner`, the `audit_events` table and its reader
- **status:** done
- **traces:** ARCH-092
- **files:** src/store/sqlite-run-store.ts, src/run-store.ts, src/types.ts, tests/integration/run-list.test.ts, tests/integration/run-store-audit.test.ts, tests/unit/audit-order.test.ts
- **des:** DES-151, DES-152
- **dod:** `npx vitest run tests/integration/run-list.test.ts tests/integration/run-store-audit.test.ts tests/unit/audit-order.test.ts` → ≥10 + ≥8 + ≥4 green incl. `EXPLAIN QUERY PLAN` naming `runs_name_status_created`, `InMemoryRunStore.list` parity against a hand-written expected array, and the recording-fake order `['appendAudit','readArtifactChunk']`. The shipped `run-list.test.ts` (3 cases) and `run-store-audit.test.ts` (4 cases) fall short of this dod's own ≥10 and ≥8. Fill them — the /goal makes test COUNT and depth this iteration's primary defence against the lower executor tier, so half the cases is half the defence (adjudication v24 #2 A-6).
- **estimate:** L
- **iter:** v24

### TASK-141 — scheduler: the five columns, `claim`/`release`/`ownerOf`, `markRefused`, the H4 check moved out of `create`
- **status:** done
- **traces:** ARCH-099
- **files:** src/scheduler.ts, src/types.ts, tests/unit/scheduler-refusal.test.ts
- **des:** DES-149, DES-150
- **dod:** `npx vitest run tests/unit/scheduler-refusal.test.ts` → ≥10 green under a FixedClock and `:memory:`, incl. TWO ticks at the same instant ⇒ `refusalCount === 1` AND `nextFire > now` (the tight-loop trap), a refused `once` consumed, `markFired` resetting `refusalCount` to 0, `lastError` untouched by a refusal.
- **estimate:** L
- **iter:** v24

### TASK-142 — webhooks: the same claim model; HMAC/timestamp/dedup BEFORE the claim checks
- **status:** done
- **traces:** ARCH-100
- **files:** src/webhook-registry.ts, tests/integration/webhook-registry.test.ts
- **des:** DES-149, DES-150
- **dod:** `npx vitest run tests/integration/webhook-registry.test.ts` → ≥12 green incl. a wrong HMAC on an UNCLAIMED webhook ⇒ 401 (never 409 — an unauthenticated caller must not learn claim state), the same `deliveryId` twice while unclaimed ⇒ 409/409 with `refusalCount === 2` and NO dedup record, then claimed ⇒ 202 with a real run.
- **estimate:** M
- **iter:** v24

### TASK-143 — catalog: `validateRegistration`/`insertVersion` split, `mermaid`+`triggers` columns, the `assets` table, migrations, `deregister`
- **status:** done
- **traces:** ARCH-098
- **files:** src/workflow-catalog.ts, src/workspace-gc.ts, tests/integration/catalog-v24.test.ts
- **des:** DES-148
- **dod:** `npx vitest run tests/integration/catalog-v24.test.ts` → ≥25 green: after EVERY refusal code the `workflow_versions` row count is unchanged (validation writes nothing); the migration over a v23 fixture db runs twice with an identical end state; no post-migration row is written with `mermaid NULL`; `deregister` deletes `assets` rows and returns the union of `triggers[]` over all versions; an orphan `<workRoot>/<name>/assets/` tree is reclaimed by the GC sweep while a live workflow's tree is not.
- **estimate:** L
- **iter:** v24

### TASK-144 — `asset-sync.ts` v24: two scopes, `pushedBy` on every row, `kind:'mcp'` behind the egress gate
- **status:** done
- **traces:** ARCH-102
- **files:** src/asset-sync.ts, tests/unit/asset-sync-v24.test.ts, tests/integration/asset-mcp-tools.test.ts
- **des:** DES-153
- **dod:** `npx vitest run tests/unit/asset-sync-v24.test.ts tests/integration/asset-mcp-tools.test.ts` → ≥20 + rewrite green incl. an `http` MCP config outside the allowlist ⇒ `EGRESS_DENIED` with the probe spy asserting ZERO probe calls, FS-written-then-row order proven by a recording catalog fake, and `pushedBy` present on every stored row. Build on the `pathVerdict(targetDir, path, undefined, 'asset-tree')` wiring TASK-134 already landed; do NOT reintroduce the private `safeRelPath` copy it deleted (adjudication v24 #2 A-7). The per-file `rwe-` first-segment rejection is INTENTIONAL defence in depth and stays (A-5) — a file named `rwe-notes.txt` inside an otherwise-allowed asset is refused, and `workflow_authoring_guide` says so.
- **estimate:** L
- **iter:** v24

### TASK-145 — selective materialization inside the SDK gateway + `label`/`materialized` on the descriptor + `deriveAgentRecords` reads `label`
- **status:** done
- **traces:** ARCH-103, ARCH-104
- **files:** src/gateway/claude-agent-sdk-client.ts, src/agent-executor.ts, src/run-store.ts, src/types.ts, tests/unit/materialize-assets.test.ts, tests/unit/derive-agent-records-v24.test.ts, tests/integration/agent-log-harness-shape.test.ts, tests/integration/asset-skill-materialization-wiring.test.ts
- **des:** DES-154, DES-160, DES-161
- **dod:** `npx vitest run tests/unit/materialize-assets.test.ts tests/unit/derive-agent-records-v24.test.ts tests/integration/agent-log-harness-shape.test.ts tests/integration/asset-skill-materialization-wiring.test.ts` → ≥12 + ≥6 + the two rewrites green, incl. the `surfaceType:'none'` fixture (`materialized = {skills:[],mcp:[],missing:declared}`, nothing copied) and a `run_status` read from the store with the `RunManager` dropped still showing each agent's `label`.
- **estimate:** L
- **iter:** v24

### TASK-146 — `composeConfig()` forwards `principals` + `mcpEgressAllowlist`; unknown-key warn; the auth announcement
- **status:** done
- **traces:** ARCH-090
- **files:** src/main.ts, src/server.ts, rwe.config.example.json, README.md, DEPLOY.md, tests/unit/compose-config-v2-wiring.test.ts, tests/unit/normalize-principals.test.ts, tests/integration/main-composition-root.test.ts
- **des:** DES-141
- **dod:** `npx vitest run tests/unit/compose-config-v2-wiring.test.ts tests/unit/normalize-principals.test.ts tests/integration/main-composition-root.test.ts` → the wiring test GAINS rows for `principals` and `mcpEgressAllowlist` and LOSES the `graphAnalyzer` row; ≥5 normalize cases incl. a malformed role refusing boot; the boot line `auth: enabled=… principals=… defaultRole=…` and `system_info.auth` asserted, with a stale `graphAnalyzer` key warned once naming ADR-025.
- **estimate:** M
- **iter:** v24

### TASK-147 — the server wire: `Principal` at the edge, `callTool(deps, …)`, `tools/list` as a projection, no identity on ungated `/api/*`
- **status:** done
- **traces:** ARCH-089
- **files:** src/server.ts, tests/unit/call-tool-order.test.ts, tests/integration/mcp-tools-list-http.test.ts, tests/integration/namespace-derivation.test.ts, tests/integration/api-runs-public-projection.test.ts
- **des:** DES-140, DES-142, DES-162
- **dod:** `npx vitest run tests/unit/call-tool-order.test.ts tests/integration/mcp-tools-list-http.test.ts tests/integration/namespace-derivation.test.ts tests/integration/api-runs-public-projection.test.ts` → ≥5 order cases (schema BEFORE authz, short-circuit proven), `tools/list` over real HTTP byte-equal to `projectToolsList()` and containing none of the 15 old names, ≥4 namespace cases (all three caller-typed sites refused; the derived namespace equals the principal id), ≥3 projection cases (`/api/runs` and `/api/runs/:id` carry no `principal`, MCP `run_status` still carries `adminReads` for the owner).
- **estimate:** L
- **iter:** v24

### TASK-148 — the facade: 35 handlers, the register→claim→insert→compensate sequence, the six `workspace_*` modes, the audited cross-read
- **status:** done
- **traces:** ARCH-091
- **files:** src/mcp-facade.ts, src/run-manager.ts, tests/integration/workspace-tools.test.ts, tests/integration/trigger-claims.test.ts, tests/e2e/admin-cross-read.test.ts, tests/e2e/register-crash-window.test.ts
- **des:** DES-149, DES-151, DES-152, DES-155
- **dod:** `npx vitest run tests/integration/workspace-tools.test.ts tests/integration/trigger-claims.test.ts` → ≥25 + ≥20 green incl. every `workspace_*` mode's happy and refusal path, `runId` on push refused BY THE SCHEMA, all-or-nothing `workspace_delete`, `RUN_NOT_TERMINAL` against a live sandbox run, and the compensation releasing ONLY the ids this call claimed (an id already `'held'` by an earlier version stays claimed). Also fix `tests/integration/trigger-claims.test.ts` lines 29/41/52, which destructure `const { id } = await port.create(...)` off a `{result, error}` envelope — `id` is `undefined` so every `claim()` resolves NOT_FOUND. That is a test defect, not a scheduler defect: the claim/release/ownerOf implementation was verified against DES-149 independently (adjudication v24 #2 A-7).
- **estimate:** L
- **iter:** v24

### TASK-149 — the read projections and the dashboard: `params.agents`, `mermaid`, `runnable`; the `diagramStatus` family gone
- **status:** done
- **traces:** ARCH-105, ARCH-106
- **files:** src/workflow-view.ts, src/dashboard-page.ts, tests/unit/workflow-describe-projection.test.ts, tests/unit/dashboard-diagram-render.test.ts
- **des:** DES-156
- **dod:** `npx vitest run tests/unit/workflow-describe-projection.test.ts tests/unit/dashboard-diagram-render.test.ts` → `EXPECTED_DESCRIBE_KEYS` re-pinned by a HAND-TYPED array (the four `diagram*` keys gone, `mermaid`/`mermaidNote`/`runnable`/`runnableReason` present), a ≥6-row `runnable` truth table, `describe.params.agents.<label>` reporting range = author ∩ ceiling, and the dashboard writing `describe.mermaid` into `<pre>` via `textContent` with no polling branch.
- **estimate:** M
- **iter:** v24

### TASK-150 — `workflow_authoring_guide` built from the enforcement constants; `GUIDE_EXAMPLES`; generated `docs/AUTHORING.md`
- **status:** done
- **traces:** ARCH-107
- **files:** src/authoring-guide.ts, scripts/gen-authoring-md.ts, docs/AUTHORING.md, package.json, tests/unit/authoring-guide.test.ts, tests/unit/authoring-md-generated.test.ts, tests/integration/guide-examples-register.test.ts
- **des:** DES-157
- **dod:** `npx vitest run tests/integration/guide-examples-register.test.ts tests/unit/authoring-guide.test.ts tests/unit/authoring-md-generated.test.ts` → one `it` PER example (≥10) registering over real MCP HTTP against a booted engine and returning `{version}`; the fake-ceiling test proving interpolation (a non-default `maxTimeoutMs` appears in the text); every `[A-Z_]{6,}` token in the guide is an `ERROR_CATALOG` key and every tool name is in `TOOL_SPECS`; `docs/AUTHORING.md` byte-equal to the builder's output.
- **estimate:** L
- **v33 pointer (REQ-201, TASK-227):** this card still owns `src/authoring-guide.ts` + the generated `docs/AUTHORING.md`; the v33 edit to the guide's `Registration and versioning` section (the normal version loop first, the three exceptions verbatim after) is carried by **TASK-227**, and the `dod:` above stays the same command — the byte lock and the example-registration run must both still be green after it.
- **iter:** v33

### TASK-151 — the REQ-118 live-engine table (generated) and the REQ-117 cold-model runbook
- **status:** done
- **traces:** ARCH-108
- **files:** tests/acceptance/v24-tool-surface.test.ts, tests/acceptance/val-mermaid-renders.test.ts, .sdlc/features/001-remote-workflow-engine/v24-tool-surface.md, .sdlc/features/001-remote-workflow-engine/08-validation.md
- **des:** DES-158, DES-147
- **dod:** `npx vitest run tests/acceptance/v24-tool-surface.test.ts` → one `it` per `TOOL_SPECS` happy fixture and one per constructible `errors[]` entry, all green or `UNVERIFIED(reason)` as a ROW; the generated `v24-tool-surface.md` is written ONLY on a full 35/35 run and carries a `rows: N/35` stamp, with the per-array-entry assertion failing on a short table.
- **estimate:** L
- **iter:** v24

### TASK-152 — the rename sweep: 113 test files, one mechanical commit, grep target zero
- **status:** done
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
- **status:** done
- **traces:** ARCH-094, ADR-035
- **files:** tests/integration/harness-defaults-validation.test.ts, tests/acceptance/val-098-harness-defaults.test.ts, tests/acceptance/val-103-effort-real.test.ts, src/errors.ts
- **des:** DES-144, DES-148
- **dod:** Every assertion that exercised the v15 `defaults`/`knobs` registration path is DELETED or rewritten against `meta.params.agents.<label>` — none is left asserting `HARNESS_DEFAULTS_INVALID` as a live code. A test that named a retired mechanism and still passes is worse than a red one: `grep -rn "HARNESS_DEFAULTS_INVALID" tests/` → only rows asserting it is GONE. `src/errors.ts`'s header comment, which forewarned exactly this breakage, is updated to say it happened. Run the three files → green, and state the case count before/after in 06-impl-log.md so a silent mass-deletion is visible.
- **estimate:** M
- **iter:** v24

### TASK-155 — `TOOL_SPECS` as const, `AuditAction` via `Extract<ToolName,…>`, and the `errors[]` reconciliation
- **status:** done
- **traces:** ARCH-087, ARCH-092
- **files:** src/tool-specs.ts, src/types.ts
- **des:** DES-137, DES-151
- **dod:** `TOOL_SPECS` is `as const` so `ToolName` is a literal union, and `AuditAction` becomes DES-151's `Extract<ToolName, …>` form — verify it did NOT silently resolve to `never` by asserting a value of the type compiles AND that an invalid member is a type error (a type that is `never` accepts nothing and would pass a shallow check). `UNKNOWN_VERSION` → `VERSION_NOT_FOUND` and `SEEDREF_EGRESS_DENIED` → `EGRESS_DENIED` everywhere including tests (`grep -rn "UNKNOWN_VERSION\|SEEDREF_EGRESS_DENIED" src/ tests/` → empty). Every code thrown by live `src/` appears in the `errors[]` of the row whose tool can throw it — at minimum SEEDREF_*, CAS_UNAVAILABLE, NESTING_*, DESCENDANT_CAP_EXCEEDED, REGISTRATION_CONFLICT, VERSION_CEILING_EXCEEDED, PARAM_SECRET_UNAVAILABLE, RUN_ADMISSION_LIMIT, INVALID_SEED_SPEC, SEED_SOURCE_CONFLICT, each justified by the call site that throws it. B-7 (adjudication #3): also constrain `ScriptCheckCode`/`ScriptCheckError.code` in src/script-checks.ts to `Extract<ErrorCode, …>` — it is still a bare literal union, the last hole in DES-137's type-level net. Its three values are valid catalog keys today so nothing is broken; the point is that the net catches the next one.
- **estimate:** M
- **iter:** v24

### TASK-156 — webhook store: rebuild the table so a pre-v24 db accepts an unclaimed row
- **status:** done
- **traces:** ARCH-100
- **files:** src/webhook-registry.ts, tests/integration/webhook-migration.test.ts
- **des:** DES-150
- **dod:** A test that CREATES a pre-v24 schema (`workflow` NOT NULL), writes a row, then opens the store and calls `create({})` with no workflow → succeeds, and the pre-existing row survives with its data intact. SQLite cannot drop NOT NULL via ALTER, so this is a create-copy-drop-rename rebuild; the test must fail against today's code first. Migration is idempotent: run the constructor twice, assert no duplicate rows and no error.
- **estimate:** M
- **iter:** v24

### TASK-157 — reconcile `AuditReadStore.readArtifactChunk` with the real `workspace-artifacts` signature
- **status:** done
- **traces:** ARCH-092
- **files:** src/audited-read.ts, src/mcp-facade.ts, tests/unit/audit-order.test.ts
- **des:** DES-151
- **dod:** One signature, not two: the port matches `workspace-artifacts.ts`'s real `readArtifactChunk(workspace, path, offset, length)` (the invented `{runId, owner, path}` object shape was the implementer's own admission — adjudication v24 #2 A-7). `workspace_pull`, `run_agent_log` and `run_result` go through the audited path in the facade, and audit-order.test.ts still pins `['appendAudit','readArtifactChunk']` — the audit row is written BEFORE bytes are read (ARCH-091 note 2: an audit row for a read that did not happen is acceptable, the reverse is not).
- **estimate:** M
- **iter:** v24

### TASK-158 — admission-time param merge reconciled with the nested `UserOverrides`
- **status:** done
- **traces:** ARCH-095
- **files:** src/params/resolve.ts, src/run-manager.ts, src/run-store.ts, src/store/sqlite-run-store.ts, tests/unit/params-resolve.test.ts
- **des:** DES-145, DES-146
- **dod:** `mergeRunParams`/`defaultRunParams` (DES-102, admission time) accept DES-145's `{agents?: Record<label, Partial<…>>}` instead of the flat pre-v24 shape; `npx tsc --noEmit` reports ZERO errors in these files. A test pins that a per-agent override reaches admission for that label ONLY and does not leak to a sibling agent — the flat shape's whole defect (REQ-110) was that one value applied to every agent, so a merge that silently broadcasts must fail.
- **estimate:** L
- **iter:** v24

### TASK-159 — `workflow-meta.ts`: the three 2-arg calls into the 3-arg `parseParamContract`
- **status:** done
- **traces:** ARCH-094
- **files:** src/workflow-meta.ts
- **des:** DES-144
- **dod:** HIGHEST SEVERITY of the Gate 5 batch — `:55`, `:69` and `:72` pass `aliasNames` into the `scriptLabels` slot, so EVERY registration whose script omits `meta.params` throws `AGENT_UNDECLARED` naming label "undefined". All three call sites pass `scanAgentCalls(script).labels`. **CORRECTED by adjudication (v24) #4 C-7 [17] — the sentence that stood here was WRONG and must not be restored:** it said "a test registers a script with `agent()` calls and NO `meta.params` and asserts it REGISTERS". DES-144 rules the opposite — one or more UNDECLARED labels ⇒ `AGENT_UNDECLARED` — and the shipped test follows DES-144, correctly. The defect this task fixes is the label NAMED in that refusal ("undefined" instead of the real label), not the refusal itself. The dod is therefore: a script with `agent('x', {})` and no `meta.params` is refused `AGENT_UNDECLARED` **naming `x`**, and the same script WITH `meta.params.agents.x` registers. Nobody may later "fix" the test toward the retracted sentence.
- **estimate:** S
- **iter:** v24

### TASK-160 — the ARCH-098 boot migration, and a GC that cannot run before it (AF-1)
- **status:** done
- **traces:** ARCH-098, ARCH-102
- **files:** src/asset-sync.ts, src/workspace-gc.ts, src/server.ts, src/workflow-catalog.ts, tests/integration/legacy-asset-migration.test.ts
- **des:** DES-153, DES-155
- **dod:** A pre-v24 deployment must not lose data on upgrade. Three parts, all pinned by tests that FAIL first. (1) A boot migration moves the pre-v24 global tree at `<workRoot>/assets/<kind>/<name>` into `_global_assets` and writes `assets(workflow='', pushedBy='legacy')` rows — transactional and idempotent (run the boot twice: no duplicate rows, no error). (2) It ALSO migrates `mcp_provisions` rows — read them from the ON-DISK database, not from code: `grep -rn "mcp_provisions" src/` is empty only because v24 deleted the module, and a pre-v24 db still has the table. A test builds a real pre-v24 db with both a global skill directory and an `mcp_provisions` row and asserts both survive as v24 rows with `pushedBy='legacy'`. (3) ORDERING IS THE POINT: a test must prove the GC sweep cannot delete the pre-v24 tree because the migration has already emptied it — arrange a workRoot with a legacy `assets/skill/<name>`, boot with `workspaceTtlMs > 0`, and assert the skill still resolves afterwards. `workspace-gc.ts:66-88` deletes every child of `<assetRoot>/` that is not a live workflow, wired unconditionally at `server.ts:847`, so getting the order wrong destroys the operator's skills on the first sweep. ARCH-102 is amended to the shipped `_global_assets` path (adjudication #7 G-1: the code's deviation is the safer one and the document follows it).
- **estimate:** L
- **iter:** v24

### TASK-161 — `triggers: []` stops being indistinguishable from a legacy NULL (AF-2)
- **status:** done
- **traces:** ARCH-098, ARCH-099
- **files:** src/workflow-catalog.ts, tests/integration/trigger-release-versioning.test.ts
- **des:** DES-148, DES-149
- **dod:** `workflow-catalog.ts:472` writes `NULL` for any empty array, so a v24 row declaring `triggers: []` is byte-identical to a pre-v24 row and `server.ts:775`'s `!== undefined` check skips membership entirely. Store `'[]'` for a v24 row; `NULL` stays reserved for pre-v24 rows, which is what ARCH-098 said. The test ARCH-098 itself specifies in the same sentence: no post-migration row is written `NULL`. Plus the behaviour that is currently impossible — register v1 with `triggers:[t1]`, register v2 with `triggers:[]`, publish v2 to `release`, then assert the fire path refuses `NOT_IN_RELEASE` and t1 does NOT run v2. Removing a trigger is the one direction that was never versioned.
- **estimate:** M
- **iter:** v24

### TASK-162 — `PRINCIPAL_REQUIRED` joins the closed catalog, and the lock checks BOTH directions (AF-3)
- **status:** done
- **traces:** ARCH-087, ARCH-088
- **files:** src/errors.ts, tests/unit/error-catalog-closed.test.ts
- **des:** DES-137
- **dod:** `authz.ts:89` returns `PRINCIPAL_REQUIRED` and `call-tool.ts:136` copies it to the wire unremapped (`?? 'FORBIDDEN_ROLE'` only covers a verdict with NO code), yet it is absent from `ERROR_CATALOG` — so a code a client really receives carries no `see` pointer, appears in no generated documentation, and is invisible to the closure tests. Add it with its pointer. Then close the class rather than the instance: a test asserts EVERY member of `AuthzErrorCode` is a key of `ERROR_CATALOG`, and the existing orphan lock is confirmed to check the reverse direction too. Gate 7.5 round 3 fixed exactly this for three trigger codes (D-14) and left this one a function away — the narrow fix is what let it recur, and adjudication #2 A-4 already recorded one-directional locking once.
- **estimate:** S
- **iter:** v24

### TASK-163 — backfill the missing IMPL entries, and make the omission detectable (DR-1)
- **status:** done
- **traces:** ARCH-087
- **files:** .sdlc/features/001-remote-workflow-engine/06-impl-log.md
- **dod:** Three commits after IMPL-187 touched `src/` with no IMPL entry; the reviewer counts this as the TENTH occurrence. Backfill the three with their real commit shas and what they changed. Ten repetitions is not forgetfulness, it is a missing enforcement point, so ALSO record in the v25 debt section that the durable fix is to make "src changed without an IMPL row" mechanically checkable — a Gate 7 check or a trace.py rule — rather than something a person has to remember. Ledger-only task: no src changes, and it belongs to whoever writes the ledger, not to a parallel implementer.
- **estimate:** S
- **iter:** v24

### TASK-164 — the tool-surface option gets a name an author can find, and `agent()` stops accepting keys it drops (#55)
- **status:** done
- **traces:** ARCH-096, ARCH-107, ARCH-095
- **files:** src/types.ts, src/agent-executor.ts, src/gateway/claude-agent-sdk-client.ts, src/params/contract.ts, src/errors.ts, src/tool-specs.ts, src/workflow-meta.ts, src/authoring-guide.ts, docs/AUTHORING.md, tests/unit/agent-opts-unknown-key.test.ts, tests/unit/scan-agent-calls.test.ts, tests/unit/params-contract.test.ts, tests/unit/authoring-guide.test.ts
- **des:** DES-163, DES-164 (amending DES-143, DES-157), adjudication (v24) #9 I-1
- **dod:** #55 is a NAMING defect, not a missing capability — the orchestrator verified on a live engine before ruling that `agent('a', {prompt, allowedTools: []})` already works (`harness.tools = []`, `surfaceType "curated"`, 162 input tokens against 1722 with a surface). Four things close around it. (1) `AgentOpts` DECLARES `allowedTools?: string[]` and BOTH `as AgentOpts & {allowedTools}` casts are deleted — `agent-executor.ts:359` (named in the adjudication) and `claude-agent-sdk-client.ts:470` (not named, and the one that decides what the session actually receives). The two `@ts-expect-error` directives that suppressed the field in the gateway tests — whose own comments read "not yet in src/types.ts (flagged for Gate 6)" — go with them. (2) `LOCKED_KEYS`'s `tools` becomes `allowedTools`: the list moves, not the pipeline, because `allowedTools` is the name that already works at every rung and renaming the pipeline would have had to move the agentType frontmatter key and the precedence chain to satisfy a list that reaches nothing. Everything that transcribed the old spelling moves with it (`errors.ts`'s `PARAM_LOCKED` hint; `tool-specs.ts`'s `run_start.overrides` description, now INTERPOLATED from `LOCKED_KEYS` so it cannot fall behind again). (3) `workflow_authoring_guide` teaches the option, the three layers by their real names (per-call `allowedTools` > agentType frontmatter `tools` > config `defaultAllowedTools`) AND the lesson the cold model had to derive alone: a small model handed a tool surface answers with a tool call instead of prose, so a prose-only task empties the surface. `docs/AUTHORING.md` is regenerated from the same builder. (4) THE CORE: an unknown `agent()` option key is REFUSED at registration (`SCAN_VIOLATION: PARAM_UNKNOWN`), naming the key, listing the accepted ones and pointing `tools` at `allowedTools` — had that existed, the cold subject would have found the option in thirty seconds instead of spending fifteen minutes and three registrations unwrapping tool-call envelopes in script. The accepted set is a `Record<keyof AgentOpts | 'prompt', true>`, so a field added to `AgentOpts` without being added there is a COMPILE error (the `AUTHZ_ERROR_CODES` move from TASK-162, for the fourth instance of the same drift). UT-145's "an unrelated key is NOT a violation" case is REWRITTEN toward the new ruling, never deleted — that sentence was the defect, and `appendPrompt`, its example, turned out to be the fourth `TUNABLE_KEYS` member the scanner's hard-coded triple never knew about.
- **estimate:** M
- **iter:** v25

### TASK-165 — two structured warnings on the terminal path, so the next #53 leaves evidence (#53)
- **status:** done
- **traces:** ARCH-002, ARCH-006
- **files:** src/types.ts, src/run-manager.ts, tests/integration/terminal-state-warnings.test.ts
- **des:** DES-165 (amending DES-003), adjudication (v24) #9 I-2
- **dod:** OBSERVABILITY ONLY, and the scope boundary is the point: run `3977b82d` is NOT reproducible (the same sequence with the suspend at +3s instead of +1s completes normally), and adjudication #9 I-2 rules against guessing at a fix on a concurrency path. NO existing behaviour changes — in particular a terminal state still does not abort the work it owns, which is a separate decision with its own tests. Two detections, each with a test that DRIVES the condition rather than asserting on a stub. (1) A run reaching ANY terminal state while one of its agents is still `queued`/`running` records `runId`, the agent's `label` and `agentId`, that agent's state, the terminal state, its reason (the run's error, or `null` — and `null` is itself the #53 finding) and an ISO timestamp. Driven by a gateway fake that IGNORES the abort signal, which is what makes the agent provably live at the terminal write, exactly as #53's ran on for ~36 seconds. Emitted from the REDACTED agent array so this new route cannot become a secret sink (DES-088). (2) A terminal status with no matching `transitions` row records the same identity plus the rows that DID land. Checked on the READ (`status()`), not after the write: `recordTransition` INSERTs the row before it UPDATEs the status, so a check straight after the write would be near-vacuous for the store production uses, while the read side is where the broken state was actually observed — and the test puts a REAL SQLite store into #53's exact on-disk shape with one `UPDATE runs SET status='failed'`, no fault injection into engine code. Once per runId (a terminal run gets polled; one record is evidence, one per poll buries it). The sink defaults to `console.warn`, so it reaches the engine log with NO composition-root wiring — a sink that only works when someone remembers to pass it is the `composeConfig` bug class this ledger has recorded twice. Both positive controls are pinned: a run whose agents all settled first, and a healthy terminal run, produce no warning at all.
- **estimate:** M
- **iter:** v25

### TASK-166 — the dashboard draws the diagram: server-side SVG, lazily rendered, cached, and safe to be anonymous (REQ-119)
- **status:** done
- **traces:** ARCH-109, ADR-036, REQ-119
- **files:** src/diagram-render.ts, src/server.ts, src/mcp-facade.ts, src/main.ts, src/dashboard-page.ts, package.json, package-lock.json, tests/unit/diagram-renderer.test.ts, tests/unit/diagram-render-spawn.test.ts, tests/unit/dashboard-diagram-render.test.ts, tests/integration/diagram-svg-route.test.ts, tests/acceptance/val-169-diagram-render.test.ts
- **des:** DES-166 (amending ARCH-106, overruling ADR-033's display half)
- **dod:** A viewer sees the PICTURE, rendered on the server, loaded as an `<img>` from `GET /api/workflows/:name/diagram.svg`; the `<pre>` source display survives as the fallback and UT-161's no-front-end-mermaid guard is untouched. Rendering is lazy (first view) and cached on `(name, version)`, which REQ-111's immutability makes permanent — `workflow_deregister` is the only invalidation, and it is a correctness requirement because the version allocator reuses `v1` for a re-registered name. Because adjudication #8 H-1 made this route anonymous, the three defences are acceptance and each has its own test at a tier that can observe it: cache-first (the second request invokes NO render — asserted by count, over real HTTP), single-flight (ten GENUINELY concurrent requests, one render), cap + hard timeout (over the cap an immediate `RENDER_BUSY` and a fall-back to source; a hung render is abandoned AND its process GROUP killed, proven with a stub renderer that spawns a grandchild). Every degradation — no mermaid-cli, no Chrome, timeout, malformed output — answers a typed reason and shows the source; nothing ever fakes a success or leaves the pane blank. Plus the red test adjudication #11 required regardless of the option chosen: a workflow whose free-text diagram nodes carry `<img src=x onerror=…>` and a `<script>` payload, rendered by the REAL renderer, asserting the served document contains no script, no event handler, no `<img>` and no `<foreignObject>` and shows the payload as escaped text.
- **estimate:** M
- **iter:** v25

### TASK-167 — delete the budget reservation, and make a refusal something the caller can see (#61, REQ-120)
- **status:** done
- **traces:** ARCH-002, ARCH-003, REQ-120
- **files:** src/run-guard.ts, src/run-manager.ts, src/errors.ts, src/types.ts, src/agent-executor.ts, src/sandbox/guards.ts, tests/unit/run-guard.test.ts, tests/integration/parallel-budget-fanout-width.test.ts, tests/integration/parallel-budget-concurrency.test.ts, tests/integration/parallel-budget-bounded-fanout.test.ts, tests/integration/nested-workflow-n-level.test.ts
- **des:** DES-167 (repealing D-G8-6 + D-V2G8-2), owner ruling 2026-09-07
- **dod:** Reproduced FIRST: a 3-wide `parallel()` under a 1.5M budget returned two results and invoked the gateway twice ("expected [ 'ok', 'ok' ] to have a length of 3 but got 2"); a 6-wide one also returned exactly two — the ceiling was literally 2 — and the exhausted-budget case reported `completed` with no trace of the lost branch. Then: `RESERVATION_FRACTION`/`reserve()`/`releaseReserved()`/`_reserved` DELETED (not re-tuned — the owner's ruling and its reasoning are recorded verbatim in `run-guard.ts`'s header so the next person cannot reinstate it by accident); `assertBudget()` is `spent >= total` and is called INSIDE the concurrency slot, immediately before dispatch, which is what makes the guide's "overshoot ≤ one concurrency window" true rather than aspirational. Visibility, the half the report cared about most: `BUDGET_EXCEEDED` is a catalog key with `see: workflow_authoring_guide`, `BudgetExceededError` carries it (so a script reads a code, not a class name — the v24 fix for the other three classes), a refused call is an `AgentRecord{state:'refused', reasonCode}` in `run_status.agents` with zero tokens and no `startedAt`, and `parallel()`/`pipeline()` RE-THROW engine refusals while still nulling an author's own throwing thunk — the two are now distinguishable, which REQ-120 requires in those words. `evaluateScript` keeps the code instead of flattening it to `SCRIPT_ERROR`, so `run_result.error.code === 'BUDGET_EXCEEDED'` reaches the client. Three rewrites, no deletions: IT-030's `succeeded <= 2` (it pinned `1/RESERVATION_FRACTION`, never a budget property), IT-037's `succeeded < CALLS` (it pinned the very behaviour #61 reported as a bug) and the nested test's `blocked: 'BudgetExceededError'` (now the catalog code) — each with the reason written where the assertion is.
- **estimate:** M
- **iter:** v25

### TASK-168 — the per-run fan-out cap becomes a stated 24, configurable, and documented (#61, REQ-120)
- **status:** done
- **traces:** ARCH-002, REQ-120
- **files:** src/run-manager.ts, src/server.ts, src/main.ts, src/mcp-facade.ts, src/authoring-guide.ts, scripts/gen-authoring-md.ts, docs/AUTHORING.md, DEPLOY.md, tests/unit/run-concurrency-default.test.ts, tests/unit/compose-config-v2-wiring.test.ts, tests/unit/authoring-guide.test.ts, tests/unit/authoring-md-generated.test.ts
- **des:** DES-168, owner ruling 2026-09-07
- **dod:** `DEFAULT_RUN_CONCURRENCY = 24`, validated by the existing `_positiveInt` door under the name operators will type (`runConcurrency`), replacing `min(16, cores-2)`. Wired the whole way — `FileConfig` → `KNOWN_FILE_CONFIG_KEYS` → `composeConfig()` → `ServerConfig` → `new RunManager({concurrency})` — WITH a wiring-test row, because this repo has twice paid an iteration for a config key that was declared and never forwarded (v11 `updateFlagPath`, v15 `auth`). UT-171 pins the value AND greps the source for a surviving `cpus()` derivation: a value oracle alone cannot catch `min(24, cores)`, which would read 24 on a big box and silently smaller on the owner's. The guide teaches what no author could previously learn: how wide a `parallel()` actually runs (interpolated from THIS deployment's resolved cap, never a literal — the same purity rule the numeric ceilings already have, enforced by a compile error since `GuideCeilings` gained the field), that past the cap calls QUEUE rather than being dropped, that a budget is a stop-dispatching signal whose overshoot is bounded by one concurrency window, and that an engine refusal propagates while an author's thunk still nulls. `docs/AUTHORING.md` regenerated from the same builder; DEPLOY.md's config table gains the key.
- **estimate:** S
- **iter:** v25

### TASK-169 — the refusal a script catches carries `.code`, so the guide's own example stops rethrowing (#63, REQ-120)
- **status:** done
- **traces:** ARCH-003, REQ-120
- **files:** src/sandbox/child-entry.ts, src/sandbox/guards.ts, src/authoring-guide.ts, docs/AUTHORING.md, tests/integration/sandbox-refusal-error-code.test.ts, tests/acceptance/val-170-budget-fanout.test.ts
- **des:** DES-169 (amending DES-167)
- **dod:** The unfinished half of #61. Reproduced FIRST, at both tiers: IT-140's dump of what a script really catches returned `code: undefined` (`ownKeys: ["stack","message","name"]`, matching the owner's live probe byte for byte), and VAL-170's new case — the guide's recovery snippet EXTRACTED from the live `workflow_authoring_guide` output and run under `budget: 0` on a real booted engine — ended `failed`, because `if (e.code !== 'BUDGET_EXCEEDED') throw e;` is always true when nothing sets `code`. Then one line in `child-entry.ts` writes the catalog code to `code` AND `name`; `name` stays because it has been the only handle scripts had, `String(e)` renders from it and `refusalCode()` reads it. Every code that can reach a script through this seam is fixed at once (`BUDGET_EXCEEDED` from `agent()`; `NESTING_DEPTH_EXCEEDED`/`NESTING_CYCLE`/`DESCENDANT_CAP_EXCEEDED` from `workflow()`) — verified by grepping every `new Error` reconstruct site in `src/` rather than trusting the report's list, which found exactly one. The SECOND source named in the report needed nothing and that was established empirically: `GuardError` already carries an own `code` (its TS parameter property survives type-stripping), which is also why `workflow()` was never broken. `e instanceof Error` is DOCUMENTED, not fixed — see DES-169 for the reasoning and the measurement (`args instanceof Object` is false too; the realm boundary is not about errors) — and the guide now tells authors to branch on `e.code` and use realm-safe checks. `docs/AUTHORING.md` regenerated from the same builder. The v23 lesson is built in: the guide's example is not read, it is lifted out of the SERVED text at test time and executed, so changing the guide's predicate changes what the test runs.
- **estimate:** S
- **iter:** v25


## v26 slice — TASK-170..195 (ARCH-110..121 / ADR-037..047 / REQ-121..130)

**Ordering constraints (they are the design, not advice).** Lower id = earlier; six edges are hard:
(1) **TASK-171 (`providers.ts`) lands first** — six later tasks import `PROVIDER_CAPS`/`Provider`/`resolveAlias`.
(2) **TASK-173 (test rewrites) lands before TASK-174 (the deletion)** — reversed, the suite goes red and the cheapest
green is deleting the tests, which is the exact trap the GATE 3+ directive names.
(3) **TASK-180's four-column `Tokens` widening must include `dashboard.ts:56` in the SAME commit** — every other
consumer of `Tokens` fails to compile; that one silently keeps compiling and drops the two cache columns.
(4) **TASK-184 (the fixture corpus) precedes TASK-185 and TASK-189** — the checker and the layout consume ONE corpus;
arriving late, each grows its own and INV-V26-3 becomes a promise instead of a test.
(5) **TASK-189's `RULE_CODE` map lands before TASK-193's catalog drift-lock** — a lock authored while the four v2 names
are still rule strings is minted blind against a vocabulary it cannot see and reports green forever.
(6) **TASK-178 (the pin) precedes TASK-180 (cost) precedes TASK-181/182/183 (limits, wire, read path)** — each needs the
previous task's type to exist.
Money rule for every task below, stated once (owner ruling 2026-09-08, `eaf6546`): **an unpriced call is charged 0 and
recorded `unpriced: true`; there is no admission refusal and no `PRICE_UNKNOWN`; the price book is pinned in
`RunManager.start()` so trigger-started runs are tracked; the resume fold is unconditional.** See 04-design.md
§"v26 corrected money rule".

### TASK-170 — the ADR-047 ledger amendment: three rows stop asserting a trigger budget that does not exist
- **status:** done
- **traces:** ADR-047, REQ-127, REQ-015
- **files:** .sdlc/features/001-remote-workflow-engine/04-design.md
- **des:** DES-190
- **dod:** Doc-only, executed at Gate 4 by the designer (no code, no test): `grep -n "ADR-047(b)" .sdlc/features/001-remote-workflow-engine/04-design.md` → the three v2-era rows carry the marker (the `Schedule` union comment, DES-017's KP-9 + overlap accepted risk, D-V2h), and `grep -c "the server-level default cap applies" .sdlc/features/001-remote-workflow-engine/04-design.md` → 0 — each row now states that trigger-started runs carry NO spend ceiling by owner ruling and that the compensating control is spend RECORDING and post-hoc query, not a cap.
- **estimate:** S
- **iter:** v26

### TASK-171 — `providers.ts`: a closed three-member union, one capability table, `validateAliases`, `resolveAlias`
- **status:** done
- **traces:** ARCH-112, ADR-041, ADR-045, REQ-123
- **files:** src/providers.ts, src/default-aliases.ts, src/main.ts, src/types.ts, tests/unit/providers.test.ts, tests/unit/providers-totality.test.ts
- **des:** DES-172
- **dod:** `npx vitest run tests/unit/providers.test.ts tests/unit/providers-totality.test.ts` → green, including a four-offender `validateAliases` message that names ALL FOUR aliases plus the allowed list interpolated from `PROVIDERS`, `resolveAlias` returning `{provider, model, proxyModel?}` (or `undefined`), and a `SITES` loop proving every provider-keyed site answers for all three members without reaching its `never` arm.
- **estimate:** M
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-203 (06-impl-log.md, `traces:` cites TASK-171); DoD re-run green today: `npx vitest run tests/unit/providers.test.ts tests/unit/providers-totality.test.ts`.

### TASK-172 — `--check-config` before the restart, and `configCheck` all the way to the banner
- **status:** done
- **traces:** ARCH-112, ADR-042, REQ-123, REQ-070
- **files:** src/main.ts, src/update-types.ts, src/server.ts, src/dashboard-page.ts, deploy/rwe-update.sh, DEPLOY.md, package.json, tests/integration/check-config-cli.test.ts, tests/unit/update-outcome-config-check.test.ts
- **des:** DES-172
- **dod:** `npx vitest run tests/integration/check-config-cli.test.ts tests/unit/update-outcome-config-check.test.ts` → exit 0 on a clean temp config and exit 1 naming a `gpt41` row, with NO port bound and NO proxy spawned in either case (a post-call port probe asserts it); and an update-result file with `configCheck` `passed`/`skipped`/`failed` — and one written by an older updater without the key — each render the banner correctly, `skipped` visibly.
- **estimate:** M
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-204 (06-impl-log.md, `traces:` cites TASK-172); DoD re-run green today: `npx vitest run tests/integration/check-config-cli.test.ts tests/unit/update-outcome-config-check.test.ts`.

### TASK-173 — re-point every test that names the retired surface (BEFORE the deletion)
- **status:** done
- **traces:** ARCH-112, ADR-041, ADR-045, REQ-123
- **files:** tests/unit/no-retired-surface.test.ts, plus every file the dod grep enumerates (v25 count: the `curateToolsForProvider` / `EFFORT_PROFILES` / `thinkingFor` / `sumUsageTokens` families)
- **des:** DES-173
- **dod:** `grep -rln "curateToolsForProvider\|NON_ANTHROPIC_EXCLUDED_TOOLS\|EFFORT_PROFILES\|thinkingFor\|mapEffort\|profileFor\|STATIC_OPENAI\|ProviderEffortProfile\|effortMapping\|sumUsageTokens" tests/` → the enumerated list is pasted in the commit message and every file on it either asserts the REPLACEMENT behaviour or is deleted with its REQ trace re-pointed in the same commit; `npx vitest run` stays green with the old source still present.
- **estimate:** M
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-204 (06-impl-log.md, `traces:` cites TASK-173); DoD re-run green today: `npx vitest run tests/unit/no-retired-surface.test.ts`.

### TASK-174 — the deletion: `openai`, `gemini`, tool curation and three effort tables leave the tree
- **status:** done
- **traces:** ARCH-112, ADR-041, ADR-045, REQ-123
- **files:** src/gateway/client.ts, src/gateway/claude-agent-sdk-client.ts, src/gateway/litellm-proxy.ts, src/models/model-catalog.ts, src/params/resolve.ts, src/session-options-builder.ts, src/default-aliases.ts, DEPLOY.md, README.md, rwe.env.example, rwe.config.example.json, tests/unit/no-retired-surface.test.ts, tests/unit/litellm-config-generate.test.ts, tests/integration/ollama-tools-verbatim.test.ts
- **des:** DES-173
- **dod:** `npx vitest run tests/unit/no-retired-surface.test.ts tests/unit/litellm-config-generate.test.ts tests/integration/ollama-tools-verbatim.test.ts` → the grep guard is green over 10 identifiers, the two provider literals and the three env names (comment-stripped for `src/`, raw for docs), `generateLiteLLMConfig` emits no `openai` route on a three-provider config, and an **ollama** `agent({allowedTools:['Read','Bash']})` reaches the session with `Read` present and nothing added — the paired behavioural assertion, without which the grep proves only that a name is gone.
- **estimate:** L
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-204 (06-impl-log.md, `traces:` cites TASK-174); DoD re-run green today: `npx vitest run tests/unit/no-retired-surface.test.ts tests/unit/litellm-config-generate.test.ts tests/integration/ollama-tools-verbatim.test.ts`.

### TASK-175 — `validateSeedSpec`: one door for `INVALID_SEED_SPEC`, before the first byte
- **status:** done
- **traces:** ARCH-110, ADR-046, REQ-121
- **files:** src/workspace-seed.ts, src/run-manager.ts, src/tool-specs.ts, src/errors.ts, tests/unit/workspace-seed-spec.test.ts, tests/unit/tool-specs.test.ts, tests/integration/run-start-seed-refusal.test.ts
- **des:** DES-170
- **dod:** `npx vitest run tests/unit/workspace-seed-spec.test.ts tests/integration/run-start-seed-refusal.test.ts` → ≥12 table rows green and `run_start({seed:[{path:'a.txt',sha256:'…'}]})` over the real facade refuses `INVALID_SEED_SPEC` naming `a.txt`, pointing at `seedManifest`, carrying `see:'workflow_authoring_guide'` — while `readdirSync(<workspace>)` throws ENOENT (a filesystem oracle, never a spy on `mkdirSync`).
- **estimate:** M
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-204, IMPL-207 (06-impl-log.md, `traces:` cites TASK-175); DoD re-run green today: `npx vitest run tests/unit/workspace-seed-spec.test.ts tests/integration/run-start-seed-refusal.test.ts`.

### TASK-176 — provider errors end the attempt: `classifyApiError`, the `api_retry` arms, the always-created controller
- **status:** done
- **traces:** ARCH-111, ADR-040, ADR-046, REQ-122
- **files:** src/gateway/claude-agent-sdk-client.ts, src/gateway/client.ts, src/types.ts, src/agent-executor.ts, tests/unit/classify-api-error.test.ts, tests/unit/sdk-drain-api-retry.test.ts, tests/integration/gateway-terminal-no-retry.test.ts
- **des:** DES-171
- **dod:** `npx vitest run tests/unit/classify-api-error.test.ts tests/unit/sdk-drain-api-retry.test.ts tests/integration/gateway-terminal-no-retry.test.ts` → a fake session emitting `api_retry(401)` and never a `result` settles `{ok:false, reason:'terminal', retryable:false}` within 1 s of FAKE-clock time with exactly ONE error event (streamed **or** accumulated, never both), `queryImpl` invoked once under a configured timeout, `abort()` observed with NO timeout configured, and a 14-row classifier table including a garbage kind string.
- **estimate:** L
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-203 (06-impl-log.md, `traces:` cites TASK-176); DoD re-run green today: `npx vitest run tests/unit/classify-api-error.test.ts tests/unit/sdk-drain-api-retry.test.ts tests/integration/gateway-terminal-no-retry.test.ts`.

### TASK-177 — the terminal record keeps what the harness resolved; `transport` is a new field
- **status:** done
- **traces:** ARCH-115, ADR-046, REQ-125
- **files:** src/gateway/claude-agent-sdk-client.ts, src/gateway/client.ts, src/agent-executor.ts, src/types.ts, tests/unit/agent-record-resolution.test.ts
- **des:** DES-177
- **dod:** `npx vitest run tests/unit/agent-record-resolution.test.ts` → `markHarness('openrouter','google/gemini-3.8-flash')` then `markDone({provider:'claude-agent-sdk', model:'gem'})` leaves `provider:'openrouter'`, `model:'google/gemini-3.8-flash'`, `transport:'claude-agent-sdk'`; `harness ≡ record ≡ usage-event` for provider AND model on both gateways (asserted with a resolved provider that is NOT the transport name); a pre-harness terminal takes the gateway's value without crashing on `prev === undefined`.
- **estimate:** M
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-200, IMPL-209 (06-impl-log.md, `traces:` cites TASK-177); DoD re-run green today: `npx vitest run tests/unit/agent-record-resolution.test.ts`.

### TASK-178 — `ModelBook`, `reachableModels`, and the pin written in `RunManager.start()`
- **status:** done
- **traces:** ARCH-116, ADR-038, REQ-127, REQ-126
- **files:** src/models/model-book.ts, src/models/model-catalog.ts, src/run-manager.ts, src/store/sqlite-run-store.ts, src/types.ts, src/main.ts, src/server.ts, tests/unit/model-book.test.ts, tests/unit/max-price-per-m.test.ts, tests/integration/price-book-pinned-by-trigger.test.ts
- **des:** DES-178
- **dod:** `npx vitest run tests/unit/model-book.test.ts tests/unit/max-price-per-m.test.ts tests/integration/price-book-pinned-by-trigger.test.ts` → 24 concurrent `snapshot()` calls invoke `source` ONCE (single-flight), the TTL/last-good/static rows are green on a FAKE clock and a FAKE source, `lookup` prices ollama at all-zero (never `null`) and an unlisted model at `null`, `maxPricePerMOf` reads `FourRates` (not the display string), and a run started through the **webhook** path has a non-null `runs.price_book`.
- **estimate:** L
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-197, IMPL-199, IMPL-211, IMPL-214, IMPL-216, IMPL-217 (06-impl-log.md, `traces:` cites TASK-178); DoD re-run green today: `npx vitest run tests/unit/model-book.test.ts tests/unit/max-price-per-m.test.ts tests/integration/price-book-pinned-by-trigger.test.ts`.

### TASK-179 — `wireEffort` is the single writer of `thinking`/`effort`; `models_list` declares per row
- **status:** done
- **traces:** ARCH-117, ADR-045, REQ-126
- **files:** src/gateway/client.ts, src/gateway/claude-agent-sdk-client.ts, src/providers.ts, src/models/model-catalog.ts, src/tool-specs.ts, src/agent-executor.ts, tests/unit/wire-effort.test.ts, tests/unit/models-list-declared.test.ts
- **des:** DES-179
- **dod:** `npx vitest run tests/unit/wire-effort.test.ts tests/unit/models-list-declared.test.ts` → an 8-row `wireEffort` table green (anthropic keeps `output_config.effort`; openrouter with `caps.reasoning === true` gets `thinking.budgetTokens`; the two distinct non-reasoning reasons; ollama and `provider === undefined` both land on `{type:'disabled'}`), `applied` present on EVERY arm, UT-101's anthropic request composition still byte-identical, and every `models_list` row carrying `toolUseDeclared`/`effortDeclared`/`declaredSource`/`catalogFetchedAt` with the input filter renamed in the same commit.
- **estimate:** M
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-199, IMPL-205, IMPL-213 (06-impl-log.md, `traces:` cites TASK-179); DoD re-run green today: `npx vitest run tests/unit/wire-effort.test.ts tests/unit/models-list-declared.test.ts`.

### TASK-180 — four-column `Tokens`, `priceCall`, and the `costUSD`/`unpriced` collapse at the one capture site
- **status:** done
- **traces:** ARCH-118, ADR-046, REQ-127
- **files:** src/types.ts, src/gateway/claude-agent-sdk-client.ts, src/gateway/client.ts, src/agent-executor.ts, src/run-guard.ts, src/dashboard.ts, src/dashboard-page.ts, tests/unit/price-call.test.ts, tests/unit/token-extraction.test.ts, tests/unit/dashboard-page-source.test.ts
- **des:** DES-180
- **dod:** `npx vitest run tests/unit/price-call.test.ts tests/unit/token-extraction.test.ts tests/unit/dashboard-page-source.test.ts` → four columns extracted from `result.usage` AND from the camelCase `modelUsage[*]` fallback, `priceCall(t, null) → null` collapsing at capture into `{costUSD: 0, unpriced: true}`, an ollama zero-rate call yielding `costUSD: 0, unpriced: false`, 1000 calls of ~1e-3 USD summing correct to 2dp, and the DAG cell rendering `sumTokens()` + `$0.0000` + an `(unpriced)` badge — never `300 tok`, never `[object Object] tok`.
- **estimate:** L
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-204 (06-impl-log.md, `traces:` cites TASK-180); DoD re-run green today: `npx vitest run tests/unit/price-call.test.ts tests/unit/token-extraction.test.ts tests/unit/dashboard-page-source.test.ts`.

### TASK-181 — `parseBudget`, a schema that still accepts `null`, `RunGuard`'s two limits, the migration answer ahead of ajv
- **status:** done
- **traces:** ARCH-118, ADR-037, REQ-127, REQ-120
- **files:** src/run-guard.ts, src/run-manager.ts, src/tool-specs.ts, src/call-tool.ts, src/types.ts, tests/unit/parse-budget.test.ts, tests/unit/run-guard-two-limits.test.ts, tests/unit/call-tool-budget-migration.test.ts
- **des:** DES-181
- **dod:** `npx vitest run tests/unit/parse-budget.test.ts tests/unit/run-guard-two-limits.test.ts tests/unit/call-tool-budget-migration.test.ts` → `run_start({budget: null})` is ACCEPTED and unbounded, `{}` is refused by `minProperties`, a wire `budget: 200000` is refused AHEAD of ajv with a message naming the old token meaning and `detail.migration.tokens`, a STORED legacy number rehydrates as `{tokens: n}`, `addUsage` accumulates with BOTH limits absent (the negative test), and the two-limit matrix names which limit the `BudgetExceededError` carries.
- **estimate:** M
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-198 (06-impl-log.md, `traces:` cites TASK-181); DoD re-run green today: `npx vitest run tests/unit/parse-budget.test.ts tests/unit/run-guard-two-limits.test.ts tests/unit/call-tool-budget-migration.test.ts`.

### TASK-182 — the sandbox budget wire: three IPC fields, both hosts, the script-visible accessors
- **status:** done
- **traces:** ARCH-118, ARCH-114, REQ-127, REQ-120, REQ-001
- **files:** src/sandbox/host.ts, src/sandbox/child-entry.ts, src/sandbox/guards.ts, src/run-manager.ts, src/types.ts, tests/unit/sandbox-budget-api.test.ts, tests/integration/nested-frame-budget.test.ts
- **des:** DES-182
- **dod:** `npx vitest run tests/unit/sandbox-budget-api.test.ts tests/integration/nested-frame-budget.test.ts` → inside a nested `workflow()` frame `budget.spent()` reports the parent run's real USD spend (0 forever today), `limits`/`total`/`remaining()` are `null` when no USD limit exists while `limits.tokens` is a number, `tokens().sum` equals the four columns, and `Object.keys(createSandboxContext(...))` still deep-equals `SANDBOX_GLOBALS`. No new local value import may enter `guards.ts`/`child-entry.ts` (the sandbox child does not resolve `.js`→`.ts` value imports).
- **estimate:** M
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-203 (06-impl-log.md, `traces:` cites TASK-182); DoD re-run green today: `npx vitest run tests/unit/sandbox-budget-api.test.ts tests/integration/nested-frame-budget.test.ts`.

### TASK-183 — the run's usage read path: `RunUsage`, three producers, an unconditional fold, `run_result.meta`
- **status:** done
- **traces:** ARCH-118, ADR-046, ADR-047, REQ-127
- **files:** src/run-manager.ts, src/run-store.ts, src/store/sqlite-run-store.ts, src/types.ts, src/mcp-facade.ts, src/tool-specs.ts, src/dashboard-page.ts, tests/integration/usage-live-equals-fold.test.ts, tests/integration/run-result-meta.test.ts
- **des:** DES-183
- **dod:** `npx vitest run tests/integration/usage-live-equals-fold.test.ts tests/integration/run-result-meta.test.ts` → live ≡ fold ≡ snapshot on a completed run AND on an **unbudgeted, resumed** run (the `if (spec.budget …)` gate at `run-manager.ts:840` deleted), `run_result.meta.usage` / `unpricedCalls` / `unmappedMessages` / `budgetEnforceable` present after a restart with no live guard, and the run page rendering the two counters and the lower-bound qualifier.
- **estimate:** L
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-198, IMPL-212, IMPL-220 (06-impl-log.md, `traces:` cites TASK-183); DoD re-run green today: `npx vitest run tests/integration/usage-live-equals-fold.test.ts tests/integration/run-result-meta.test.ts`.

### TASK-184 — `AgentCallScan` learns three facts, and the shared `(script, expectedGraph)` corpus ships with it
- **status:** done
- **traces:** ARCH-113, ADR-039, REQ-128, REQ-124
- **files:** src/workflow-meta.ts, src/scan-agent-calls.ts, tests/fixtures/expected-graph-fixtures.ts, tests/unit/agent-call-scan.test.ts
- **des:** DES-174
- **dod:** `npx vitest run tests/unit/agent-call-scan.test.ts` → `calls[]` carries `allowedTools` (the literal array, or `'absent'`), the regex match `index`, and `group:{kind:'parallel'|'alt', id}` for both arms of one ternary; the 14 fixtures are HAND-WRITTEN literals in one exported module (never produced by running the function and pasting its output).
- **estimate:** M
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-204 (06-impl-log.md, `traces:` cites TASK-184); DoD re-run green today: `npx vitest run tests/unit/agent-call-scan.test.ts`.

### TASK-185 — `deriveExpectedGraph`: total, discriminated, two consumers, one derivation
- **status:** done
- **traces:** ARCH-113, ADR-039, REQ-128, REQ-124
- **files:** src/skeleton-graph.ts, src/types.ts, tests/unit/skeleton-graph.test.ts
- **des:** DES-174
- **dod:** `npx vitest run tests/unit/skeleton-graph.test.ts` → every fixture produces its literal `ExpectedGraph`, an `agent()` before the first `phase()` returns `{ok:false, rule:'AGENT_BEFORE_PHASE', line}`, two identically-labelled calls in different phases land in different slots (the character-offset join, not the label), and no input — `null`, empty, truncated — throws.
- **estimate:** M
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-204, IMPL-206 (06-impl-log.md, `traces:` cites TASK-185); DoD re-run green today: `npx vitest run tests/unit/skeleton-graph.test.ts`.

### TASK-186 — the phase stamp: read at IPC receipt, on both hosts, never in the replay key
- **status:** done
- **traces:** ARCH-114, REQ-124, REQ-008
- **files:** src/sandbox/host.ts, src/run-manager.ts, src/agent-executor.ts, src/types.ts, tests/unit/phase-stamp-ordering.test.ts, tests/integration/call-key-byte-identity.test.ts, tests/e2e/nested-frame-phase.test.ts
- **des:** DES-175
- **dod:** `npx vitest run tests/unit/phase-stamp-ordering.test.ts tests/integration/call-key-byte-identity.test.ts tests/e2e/nested-frame-phase.test.ts` → an `{agent}` and a `{phase}` message delivered in ONE IPC chunk stamp the EARLIER phase; a nested frame with no `phase()` inherits `{title,index}`; a nested frame that DOES call `phase()` records it on its own `WorkflowNodeView.phases[]` and leaves the parent lanes unchanged with zero warnings; and a stored v25 journal replays under v26 with ZERO cache misses (`CallKey` byte-identical).
- **estimate:** L
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-202 (06-impl-log.md, `traces:` cites TASK-186); DoD re-run green today: `npx vitest run tests/unit/phase-stamp-ordering.test.ts tests/integration/call-key-byte-identity.test.ts tests/e2e/nested-frame-phase.test.ts`.

### TASK-187 — `layoutGraph` joins by lane ordinal; `inferPhase` repairs pre-v26 snapshots at read
- **status:** done
- **traces:** ARCH-114, ARCH-113, REQ-124, REQ-008
- **files:** src/dashboard.ts, src/server.ts, tests/unit/layout-graph-phase.test.ts, tests/fixtures/pre-v26-terminal-snapshot.json, tests/integration/dag-warnings-empty.test.ts
- **des:** DES-176
- **dod:** `npx vitest run tests/unit/layout-graph-phase.test.ts tests/integration/dag-warnings-empty.test.ts` → the shared corpus places every agent in its true lane (duplicate titles resolved by ordinal, `alt` consuming one agent, `parallel` up to its member count), each warning branch asserted BY BRANCH, and a REAL pre-v26 terminal snapshot copied into `tests/fixtures/` (redacted) yields `warnings: []` — copy it at Gate 5, so a missing `startedAt`/`phases[]` is a design fact, not a Gate 7.5 surprise.
- **estimate:** M
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-204, IMPL-205, IMPL-206 (06-impl-log.md, `traces:` cites TASK-187); DoD re-run green today: `npx vitest run tests/unit/layout-graph-phase.test.ts tests/integration/dag-warnings-empty.test.ts`.

### TASK-188 — the restart-reconstruction seam: `deriveAgentRecords` carries the whole record, and a refusal is journaled
- **status:** done
- **traces:** ARCH-114, ARCH-115, ARCH-118, ARCH-111, ADR-046, REQ-124, REQ-125, REQ-127, REQ-120
- **files:** src/run-store.ts, src/agent-executor.ts, src/run-manager.ts, src/types.ts, tests/unit/derive-agent-records.test.ts, tests/integration/derived-equals-snapshot.test.ts, tests/integration/refused-survives-restart.test.ts, tests/acceptance/val-007-observability.test.ts
- **des:** DES-188
- **dod:** `npx vitest run tests/unit/derive-agent-records.test.ts tests/integration/derived-equals-snapshot.test.ts tests/integration/refused-survives-restart.test.ts` → `deriveAgentRecords(allTranscripts)` deep-equals the terminal snapshot's `agents` minus `lastActivityAt` for a run with one done, one failed and one budget-refused call; a refused call read back from a FRESH store over the same SQLite file with no snapshot still shows `state:'refused'` with its `reasonCode`, phase and `phaseIndex`; and `val-007`'s transcript-kind list is extended to `['message','tool_call','tool_result','usage','harness','refused']` in the SAME commit as the union member.
- **estimate:** L
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-204 (06-impl-log.md, `traces:` cites TASK-188); DoD re-run green today: `npx vitest run tests/unit/derive-agent-records.test.ts tests/integration/derived-equals-snapshot.test.ts tests/integration/refused-survives-restart.test.ts`.

### TASK-189 — `checkMermaid` v2, the total `RULE_CODE` map, four catalog rows, and `diagram_contract`
- **status:** done
- **traces:** ARCH-119, ADR-043, ADR-039, REQ-128, REQ-116
- **files:** src/check-mermaid.ts, src/workflow-catalog.ts, src/errors.ts, src/types.ts, src/mcp-facade.ts, src/store/sqlite-run-store.ts, tests/unit/check-mermaid-v2.test.ts, tests/unit/rule-code-map.test.ts, tests/integration/diagram-contract-grandfather.test.ts
- **des:** DES-184
- **dod:** `npx vitest run tests/unit/check-mermaid-v2.test.ts tests/unit/rule-code-map.test.ts tests/integration/diagram-contract-grandfather.test.ts` → one negative fixture per v2 code (`DIAGRAM_DIRECTION` / `LANE_MISMATCH` / `TOOLS_MISMATCH` / `EDGE_MISMATCH`), each refusal carrying `{rule, line, expected}` and `see:'workflow_authoring_guide'` from a REAL `ERROR_CATALOG` row; `RULE_CODE` total over every rule the file emits with a `never` check; a `tools: default` slot never compared; and a pre-v26 `graph TD` row still rendering and re-serving untouched with `diagramContract:'v1'`.
- **estimate:** L
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-201, IMPL-203 (06-impl-log.md, `traces:` cites TASK-189); DoD re-run green today: `npx vitest run tests/unit/check-mermaid-v2.test.ts tests/unit/rule-code-map.test.ts tests/integration/diagram-contract-grandfather.test.ts`.

### TASK-190 — the guide examples become the v2 conformance corpus (LR swimlanes that register green)
- **status:** done
- **traces:** ARCH-119, ARCH-107, ADR-039, REQ-128, REQ-116, REQ-117
- **files:** src/authoring-guide.ts, docs/AUTHORING.md, tests/integration/guide-examples-register.test.ts
- **des:** DES-185
- **dod:** `npx vitest run tests/integration/guide-examples-register.test.ts` → every `GUIDE_EXAMPLE` registers against a booted engine with NO refusal, and the corpus covers phase lane, `parallel` slot, `alt` slot, `tools: none`, `tools: default`, a dynamic title, a nested `workflow()` rectangle and the five ADR-039 constructs in their LEGAL rewritten form; no negative fixture is present in the guide.
- **estimate:** M
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-204 (06-impl-log.md, `traces:` cites TASK-190); DoD re-run green today: `npx vitest run tests/integration/guide-examples-register.test.ts`.

### TASK-191 — the run DAG scales with its container, and both figures zoom / pan / fit
- **status:** done
- **traces:** ARCH-120, ADR-044, REQ-129, REQ-119
- **files:** src/dashboard.ts, src/dashboard-page.ts, tests/unit/dag-box.test.ts, tests/unit/dashboard-zoom-source.test.ts, tests/acceptance/val-018-dashboard-browser-ui.test.ts
- **des:** DES-186
- **dod:** `npx vitest run tests/unit/dag-box.test.ts tests/unit/dashboard-zoom-source.test.ts` → `dagBox` returns a non-zero minimum box for empty cells and the right extent for a 9-agent 5-phase layout; the emitted page sets `viewBox` + `width="100%"` + `preserveAspectRatio` with NO absolute `width=`; and calling `renderGraph` twice leaves the `.zoomable` WRAPPER transform untouched (the 3-second poll must not reset a user's zoom).
- **estimate:** M
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-204, IMPL-212, IMPL-215 (06-impl-log.md, `traces:` cites TASK-191); DoD re-run green today: `npx vitest run tests/unit/dag-box.test.ts tests/unit/dashboard-zoom-source.test.ts`.

### TASK-192 — the workflow page's per-agent harness table
- **status:** done
- **traces:** ARCH-119, REQ-128, REQ-110
- **files:** src/dashboard-page.ts, src/dashboard.ts, tests/unit/workflow-page-harness-table.test.ts
- **des:** DES-184
- **dod:** `npx vitest run tests/unit/workflow-page-harness-table.test.ts` → one row per `params.agents.<label>` — label / declared model → resolved model / effort / timeoutMs / tools — every cell written with `textContent`, no `innerHTML` on any run- or author-derived string.
- **estimate:** S
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-201, IMPL-202 (06-impl-log.md, `traces:` cites TASK-192); DoD re-run green today: `npx vitest run tests/unit/workflow-page-harness-table.test.ts`.

### TASK-193 — the guide's five gaps rendered from exported constants, with drift locks that EXECUTE
- **status:** done
- **traces:** ARCH-121, REQ-130, REQ-121, REQ-127, REQ-001
- **files:** src/sandbox/guards.ts, src/authoring-guide.ts, src/tool-specs.ts, docs/AUTHORING.md, scripts/gen-authoring-md.ts, tests/unit/authoring-guide.test.ts, tests/unit/sandbox-globals-lock.test.ts, tests/unit/authoring-md-generated.test.ts
- **des:** DES-187
- **dod:** `npx vitest run tests/unit/authoring-guide.test.ts tests/unit/sandbox-globals-lock.test.ts tests/unit/authoring-md-generated.test.ts` → the served guide contains `DETERMINISM_GUARD` and `seedManifest`; `Object.keys(createSandboxContext(...))` deep-equals `SANDBOX_GLOBALS`; every `DETERMINISM_GUARDED.call` really throws `DETERMINISM_GUARD` in a REAL `vm` context; the alias table is generated from `aliases × PROVIDER_CAPS`; `docs/AUTHORING.md` is byte-identical to the builder output; and `buildGuide()` stays under its byte ceiling.
- **estimate:** M
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-204, IMPL-208 (06-impl-log.md, `traces:` cites TASK-193); DoD re-run green today: `npx vitest run tests/unit/authoring-guide.test.ts tests/unit/sandbox-globals-lock.test.ts tests/unit/authoring-md-generated.test.ts`.

### TASK-194 — the public shapes pinned as literal fixtures, the cross-repo check, and the migration note
- **status:** done
- **traces:** ARCH-110, ARCH-115, ARCH-118, ARCH-117, REQ-121, REQ-125, REQ-126, REQ-127
- **files:** tests/fixtures/v26-public-shapes.ts, tests/integration/public-shapes-pin.test.ts, tests/unit/no-retired-surface.test.ts, DEPLOY.md, README.md
- **des:** DES-189
- **dod:** `npx vitest run tests/integration/public-shapes-pin.test.ts tests/unit/no-retired-surface.test.ts` → the LITERAL expected JSON of `run_status.agents[]`, `run_result.meta`, the usage transcript event, the `INVALID_SEED_SPEC` envelope and one v2 diagram refusal envelope deep-equal after a scripted run; `grep -rn "PRICE_UNKNOWN" src tests docs` → 0 hits; and DEPLOY.md carries the three-line migration note (budget object · `toolUse`→`toolUseDeclared` · two→four token columns). The cross-repo read of the plugin's `push_workspace.py` is recorded in the commit message and DECIDES whether `additionalProperties:false` ships on `seed.items`.
- **estimate:** M
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-203 (06-impl-log.md, `traces:` cites TASK-194); DoD re-run green today: `npx vitest run tests/integration/public-shapes-pin.test.ts tests/unit/no-retired-surface.test.ts`.

### TASK-195 — the v26 tool-surface table and the cold-model probe runbook
- **status:** done
- **traces:** ARCH-108, ARCH-119, ARCH-121, REQ-128, REQ-130, REQ-117, REQ-118
- **files:** tests/acceptance/v24-tool-surface.test.ts, .sdlc/features/001-remote-workflow-engine/v24-tool-surface.md, .sdlc/features/001-remote-workflow-engine/08-validation.md
- **des:** DES-189
- **dod:** `npx vitest run tests/acceptance/v24-tool-surface.test.ts` → every `TOOL_SPECS` row exercised once including its error path, with the v26 rows updated (`run_start.seed`/`seedManifest`/`seedManifestRef` item shapes, `run_start.budget` object + `null`, `models_list` declared columns, `workflow_describe.diagramContract`) and the regenerated table committed; the REQ-117/128/130 cold-model runbook names the guide + `tools/list` as the ONLY inputs and a first-try failure as a DOCUMENTATION defect.
- **estimate:** M
- **iter:** v26
- **closeout (2026-09-18, Gate 6 partitioner stale-`status` sweep):** already implemented — covered by IMPL-204 (06-impl-log.md, `traces:` cites TASK-195); DoD re-run green today: `npx vitest run tests/acceptance/v24-tool-surface.test.ts` (5 credential-gated rows remain `it.skip`'d — pre-existing, documented in `v24-tool-surface.md` since before v26, not a new gap).

## v27 tasks (REQ-131..136, REQ-140, REQ-141 / ARCH-120, ARCH-122..131 / ADR-049..056) — TASK-196..216

Synthesized from the pre-run two-group design panel on disk (`.panel/design/adversarial.r1.md`,
`.panel/design/quality-dimensions.r1.md`); round 1 only — the two headlines were complementary, so no
round 2. Reasoning lives in `04-design.md`'s one `## Decision rationale — v27`.

**Order is load-bearing, not cosmetic — three rules, and each is provable after the fact.**
1. **TASK-196 lands before ANY file under `src/dashboard/`.** `vitest.config.ts:7` includes `.ts` only and
   both grep guards walk `.ts` only, so a `.js` test authored first never runs (green, unshipped) and a
   client module landed first is bytes no guard reads (green, forbidden word served). TASK-196's own
   planted-violation test is what proves the widening happened.
2. **TASK-197 lands before every task that edits `src/types.ts` or writes a view test.** It owns ALL v27
   `types.ts` deltas and the one wire fixture; TASK-198/199/200 therefore do NOT list `types.ts`.
3. **TASK-213 (the pin migration) lands in the same batch as TASK-205**, never after it: the shell rewrite
   turns ~41 existing assertions red or, worse, VACUOUSLY GREEN, and the cheapest wrong fix is deletion.
4. **TASK-204's `listed ⇒ on disk` half is the slice's FINAL green, not TASK-204's.** DES-199's literal
   enumerates every `ui/`/`lib/` key, and those files arrive in TASK-206..212 — so that one assertion is
   RED for the js keys until the last client task lands, and that is expected, not a defect. TASK-204's own
   DoD is scoped to the halves it can satisfy alone (fonts, css, traversal, cache policy, sha256, the
   missing-file degrade); the full closed-both-ways assertion is re-run as TASK-212's last check. **[v27c] TASK-214's
   class-lock `is set by clientCorpus()` half and its no-design-values guard follow the identical rule** —
   the stylesheet and the declared list land first, the emitters catch up in TASK-208..212, and both halves
   are re-run as TASK-212's last check.

5. **[v27b] Within the Round-v27b delta the order is 197 → 201 → 203 → 202 → 206 → 209/210, and VAL-207/212
   are judged only after 201.** The fixture is the shared literal every later reader locks against. If the
   route (203) ships after the views (209/210), the views map warning tokens that never arrive and their
   acceptance passes VACUOUSLY — a healthy run renders no warning either. If 201's predicted `label` has not
   landed, the Chromium oracle photographs grey boxes reading `agent` and that screenshot becomes the
   accepted baseline. TASK-206 is NOT in the architecture's own v27b housekeeping list and lands unowned if
   the list is copied — it carries `warningText` and the three new string keys.

6. **[v27c] TASK-214 lands BEFORE val-198..202 are judged, and before TASK-209/210/211/212 re-run.** The
   stylesheet is the vocabulary those four surfaces set class names against and the home of the values they
   must stop inlining; if they re-run first the same literals get written twice and the repair lands on
   fresh code. TASK-214 also owns the ONE correction inside an already-committed file (the accent ramp
   direction, DES-201) — sequencing it last would mean a second author re-deciding it. **TASK-205's two v27c
   clauses** (deleting the `<style>`/`readFileSync` in `dashboard-page.ts` and re-pointing the two C1 CSS
   pins) are a RE-RUN of an already-landed task and land in the **same batch as TASK-214, never before it**:
   between the deletion and the re-point those two pins are red. And `dashboard.css` now has exactly ONE
   task in its `files:` — TASK-205 asserts the token facts, TASK-214 authors every byte.

**Out of this closure and deliberately untouched:** REQ-137/138/139 (Models/System/Issues tab *upgrades*)
and REQ-142/143. TASK-212 PORTS the three shipped tabs unchanged so REQ-067/076/077/078 do not regress —
it adds no sorting, no filtering, no slide-in, no demo data. See `04-design.md`'s rationale §1.

### TASK-196 — the guards see the served bytes, and the browser tier can fail instead of skipping
- **status:** done
- **traces:** ARCH-124, ARCH-123, REQ-131, REQ-134
- **files:** vitest.config.ts, tests/unit/no-skeleton-surface.test.ts, tests/unit/no-retired-surface.test.ts, tests/unit/dashboard-no-external-host.test.ts, tests/acceptance/val-193-dag-fit-and-columns.test.ts, tests/acceptance/val-197-diagram-drag-pan.test.ts
- **des:** DES-191
- **dod:** `RWE_REQUIRE_BROWSER=1 npx vitest run tests/unit/no-skeleton-surface.test.ts tests/unit/no-retired-surface.test.ts tests/unit/dashboard-no-external-host.test.ts tests/acceptance/val-193-dag-fit-and-columns.test.ts` → both walkers return a planted temp-fixture `*.js` AND `*.css` and go RED on the forbidden word planted in each; the no-external-host guard reports the planted `https://fonts.googleapis.com` in a planted `.css`; and the acceptance file THROWS (not skips) when no puppeteer Chrome is present. Same command without the env var still skips.
- **estimate:** S
- **iter:** v27

### TASK-197 — the v27 wire types, the one fixture, and the disclosure key-set test
- **status:** done
- **traces:** ARCH-131, ARCH-127, ARCH-129, ADR-054, REQ-140, REQ-141, REQ-136
- **files:** src/types.ts, src/mcp-facade.ts, tests/fixtures/dashboard-wire.ts, tests/integration/dashboard-disclosure.test.ts
- **des:** DES-192
- **dod:** `npx tsc --noEmit && npx vitest run tests/integration/dashboard-disclosure.test.ts` → `tsc` is green with the fixture `satisfies` each named route type (`AgentLogView`, `RunSummary`, the DAG payload, `HomeView`, the describe view); the fixture literals are POST-delta, so the disclosure table asserts, per (endpoint × outcome: ok / facade-error / http-error / degraded), `keys ⊆ ALLOWED` and `REQUIRED ⊆ keys` against the shape v27 is building toward: every row for a route this slice does not change is GREEN at this task's completion, and exactly the rows whose REQUIRED set carries `record`, `lanes`/`current` and the four summary fields are RED until TASK-198/199/202/203 land. That split is the expected outcome here, not a defect. **[v27b]** The fixture also renames `DAG_PAYLOAD_OPEN` → `DAG_PAYLOAD` and its disclosure row label `'GET /api/runs/:id/dag (open)'` → `'GET /api/runs/:id/dag'` (the 「(open)」 qualifier encodes a second, masked shape that ADR-051 retired — leaving it is exactly the 「faithfully record a degradation that must no longer exist」 failure), keeps `DAG_PAYLOAD.warnings` as `[]` (it is the DISCLOSURE_TABLE's `ok` row and a healthy DAG carries no warning), and gains ONE new export `DAG_WARNING_EXAMPLES = { fallback: 'PREDICTED_FROM_FALLBACK_VERSION: pinned=v2 resolved=v1', unavailable: 'PREDICTED_OVERLAY_UNAVAILABLE: reason=catalog-resolve-failed', prose: 'lane 1 is beyond the predicted layout: appended' } as const` — the third is `dashboard.ts:432`'s own format verbatim and it CONTAINS `': '`, which is the point (the client splits on the FIRST one and must pass an unknown head through RAW); the single literal the route's integration oracle and the client's unit oracle both read, because otherwise the token is spelled in three files and a rename on any one ships an English enum into the zh-TW legend with CI green. No key-set change.
- **estimate:** M
- **iter:** v27b

### TASK-198 — the store's at-rest usage projection and the narrow `usage`-only backfill
- **status:** done
- **traces:** ARCH-128, ADR-052, REQ-141
- **files:** src/store/sqlite-run-store.ts, src/run-store.ts, tests/unit/sqlite-run-store-usage-projection.test.ts, tests/integration/run-store-parity.test.ts
- **des:** DES-193
- **dod:** `npx vitest run tests/unit/sqlite-run-store-usage-projection.test.ts tests/integration/run-store-parity.test.ts` → against a real temp `better-sqlite3` file, five rows (no snapshot / full snapshot / `{usage}`-only snapshot / a `usage.tokens` missing `cacheWrite` / a full snapshot whose `agents` is `[]`) project exactly as DES-193 states — all four fields absent for rows 1 and 5, `tokensTotal` a COALESCE'd sum never `NULL`, `agentCount` absent (not 0) for row 3; `backfillUsage` writes only for a TERMINAL run whose snapshot lacks `usage` AND whose transcript carries a `kind:'usage'` event, is idempotent across two calls, and `InMemoryRunStore` passes the SAME table.
- **estimate:** M
- **iter:** v27

### TASK-199 — `listSummaries()`: one accessor, one precedence chain, and both routes moved onto it
- **status:** done
- **traces:** ARCH-127, ADR-052, REQ-141, REQ-132, REQ-133
- **files:** src/run-manager.ts, src/server.ts, README.md, .sdlc/features/001-remote-workflow-engine/v24-tool-surface.md, tests/unit/run-manager-summarize-usage.test.ts, tests/integration/usage-live-equals-fold.test.ts, scripts/bench-run-list.ts
- **des:** DES-194
- **dod:** `npx vitest run tests/unit/run-manager-summarize-usage.test.ts tests/integration/usage-live-equals-fold.test.ts` → `summarizeUsage` returns `undefined` for zero records and a PRESENT `{costUSD:0, unpricedCalls:1, …}` for one unpriced done call; over HTTP, `/api/runs[i].costUSD` equals `/api/runs/:id.usage.costUSD` for a run holding both a terminally-failed and an unpriced call, and BOTH are absent/zero-fold for a run that completed having made zero `agent()` calls; a counting `prepare` proxy shows `listRuns()` issuing exactly ONE statement at N=10 and N=1000, and `listSummaries()` issuing `1 + c·25` for a fixed small `c` on the first call (each healed run costs one `getRun` fan-out plus its write) and exactly 1 on the second; `{event:'usage_backfill', healed}` appears once per healing call. Because `list(filter)` gains the same projection, MCP `run_list` widens too — the regenerated tool-surface table and the README row must both name the four optional fields. `scripts/bench-run-list.ts` records p50/p95 of `/api/runs`, `/api/home` and boot recovery at N=1000 into 08-validation.md (ADR-052's measurement obligation).
- **estimate:** L
- **iter:** v27

### TASK-200 — REQ-136: the guarded strip at the one decoration site, and the contract change told three times
- **status:** done
- **traces:** ARCH-129, ADR-050, REQ-136, REQ-135
- **files:** src/params/resolve.ts, src/agent-executor.ts, src/tool-specs.ts, README.md, tests/unit/strip-first-segment.test.ts, tests/unit/agent-executor-harness-descriptor.test.ts, tests/acceptance/v24-tool-surface.test.ts, .sdlc/features/001-remote-workflow-engine/v24-tool-surface.md
- **des:** DES-195
- **dod:** `npx vitest run tests/unit/strip-first-segment.test.ts tests/unit/agent-executor-harness-descriptor.test.ts tests/integration/dashboard-disclosure.test.ts tests/acceptance/v24-tool-surface.test.ts` → the six-case table plus the property `stripFirstSegment(composePrompt(s,a,p,ap), s).prompt === composePrompt(undefined,a,p,ap)`; a stub gateway returning a prompt that is NOT what it was given yields `prompt:''` and one `{event:'harness_prompt_prefix_mismatch'}` line; the persisted descriptor carries `systemPrompt:{agentType,bytes}` present-iff-applied; the REQ-136 three-conjunct oracle passes against the real BODY of both `GET /api/runs/:id/agents/:agentId` and MCP `run_agent_log`; and the regenerated tool-surface table carries the new `run_agent_log` row. `val-082`/`val-104`'s existing assertions pass UNCHANGED. The cross-repo grep of the `rwe-mcp` plugin for `harness.prompt` and the one release-note line are recorded in the commit message.
- **estimate:** M
- **iter:** v27

### TASK-201 — `dashboard.ts`: `deriveLanes`, `predictedLanes`, and cost-aware workflow metrics
- **status:** done
- **traces:** ARCH-126, ADR-051, ADR-055, REQ-140, REQ-132, REQ-133, REQ-134
- **files:** src/dashboard.ts, tests/unit/dashboard-derive-lanes.test.ts, tests/unit/dashboard-metrics.test.ts
- **des:** DES-196
- **dod:** `npx vitest run tests/unit/dashboard-derive-lanes.test.ts tests/unit/dashboard-metrics.test.ts tests/unit/layout-graph-phase.test.ts` → **[v27b]** a 7×2 table over every `RunStatus` × empty/non-empty `phases` gives `current` = last observed index for `running|suspended|interrupted` and `null` for the other four — the `masked` axis is GONE (28 → 14 cases) and the `as { masked: boolean; status: RunStatus }` cast at `dashboard-derive-lanes.test.ts:34` no longer appears anywhere in the file; `lanes` are observed-then-unreached-expected UNCONDITIONALLY, ordinal-joined never title-joined, DENSE (`lanes[k].index === k`, including from a non-contiguous `expected.lanes` of `[0,1,3]`); `current` is not clamped when the observed phases outnumber the predicted lanes; `deriveLanes(phases, { lanes: [], slots: [], edges: [] }, …)` returns the observed lanes and never throws; `layoutGraph`'s inert predicted cell carries `label: s.labels.join(' / ')` (`a / b / c` for a `parallel([a,b,c])` slot) and NO `label` key for a slot with no labels; `predictedLanes` returns per-lane agent labels in slot order from the ONE `deriveExpectedGraph`; `avgCostUSD` is `null` (never `0`) when no terminal summary carries `costUSD`, and `unpricedRuns` counts the rest.
- **estimate:** M
- **iter:** v27b

### TASK-202 — the facade: `record` on the agent detail, and `phases[].agents` served to every caller
- **status:** done
- **traces:** ARCH-131, ADR-051, ADR-055, REQ-140, REQ-133
- **files:** src/mcp-facade.ts, src/tool-specs.ts, README.md, tests/integration/dag-masking-auth.test.ts, tests/integration/dashboard-http.test.ts
- **des:** DES-197
- **dod:** `npx vitest run tests/integration/dag-masking-auth.test.ts tests/integration/dashboard-http.test.ts` → **[v27b]** BOTH servers (auth off and auth on) answer `describe.phases[].agents` PRESENT with labels and `dag.lanes` INCLUDING the unreached lanes; the two anonymous `GET /api/workflows/:name/describe` bodies are deep-equal when scoped to `phases` exactly (never whole-payload — `owner` legitimately differs by deployment); a dynamic lane answers `agents: []` while a phase ordinal with no derived lane carries NO `agents` key; INV-V27-9's DAG-payload parity passes on the SAME harness after the stabilization predicate (poll both servers until each payload holds ≥1 predicted cell AND exactly one live agent cell in `running`), in exclusion form with the named `PARITY_EXCLUDED = ['runId','terminalAt'] as const` and `current` COMPARED, alongside the live `keys ⊆ ALLOWED_DAG_KEYS && REQUIRED_DAG_KEYS ⊆ keys` check on BOTH payloads and both positive anchors on the AUTH server (a `__skel_` cell present; `lanes.map(l => l.title)` equal to the phased script's titles with `current === 0`) — parity alone passes vacuously when both engines degrade identically; `runAgentLog` returns `record` on the success branch and omits it on the error branch; `src/tool-specs.ts:332`'s `workflow_describe` description names the new field (「and the predicted lane membership (`phases[].agents`)」) so a cold, schema-only client learns it without fetching (REQ-106's precedent); README.md §Dashboard JSON REST API carries the `describe.phases[].agents` row **WITHOUT any masking sentence** (「served to every caller regardless of auth; `[]` when the lane is derivable but has no static labels; absent only when the engine could not derive the predicted layout for this version」); `McpFacadeDeps` gains NO `maskPredictedOverlay` field and `server.ts` forwards nothing; and every pre-existing assertion in `dashboard-http.test.ts` (the pinned `{kind,cells,edges,startedBy}` shape) passes unchanged.
- **estimate:** M
- **iter:** v27b

### TASK-203 — the server wire: the `/static/dashboard/*` arm, the CSP, `lanes`/`current`, and the degraded log line
- **status:** done
- **traces:** ARCH-130, ARCH-123, REQ-131, REQ-140, REQ-133
- **files:** src/server.ts, README.md, tests/integration/static-assets-route.test.ts, tests/integration/dashboard-http.test.ts, tests/integration/dag-masking-auth.test.ts
- **des:** DES-198
- **dod:** `npx vitest run tests/integration/static-assets-route.test.ts tests/integration/dashboard-http.test.ts tests/integration/dag-masking-auth.test.ts && npx tsc --noEmit` → against a really booted `createServer()`, `GET /static/dashboard/ui/app.js` returns `text/javascript` + `no-store` + `nosniff` (NOT the SPA's `text/html`, i.e. the arm is registered before the catch-all), a woff2 returns `font/woff2` + `immutable`, every traversal string in the DES-199 table returns 404 with no echo of the key, a non-GET returns 405; `GET /dashboard` carries the exact ARCH-130 CSP string including `img-src 'self' blob:`; the DAG payload gains `lanes`+`current` with its old keys byte-compatible. **[v27b] The four deletions, by line — after them `grep -n authEnabled src/server.ts` returns exactly TWO lines, both historical COMMENTS (`:350`, which documents the retired `/skeleton` route, and `:819`, which documents ARCH-089's `Principal`): no parameter, no default, no argument, no branch**: the `if (!authEnabled)` wrapper at `:520` (the inner `try/catch` survives, unindented), the `authEnabled = false` parameter and its default at `:334`, the `!!authCfg` argument at the one call site `:1068`, and the two mask comments at `:331-334` and `:1064`; `:350`'s comment is AMENDED by ADDING one clause — the DAG route now shares the describe route's no-masking posture (ADR-051) — while its historical mention of the retired `/skeleton` route's `authEnabled` stays; `:819` and `authAnnounce` are untouched. **[v27b]** version resolution reads `view.legacySubstitution?.resolved ?? view.scriptVersion`, and the three warning pushes sit INSIDE their own catches (`:500-506` and `:538`/`:540`) — arm (iii)'s push is inside the `catch` that assigns `skeletonScript = ''`, never downstream of it, because nothing downstream throws. Two producer cases, real calls only: deregister → exactly one `PREDICTED_OVERLAY_UNAVAILABLE: reason=catalog-resolve-failed` entry (`warnings.filter(/^PREDICTED_/)` deep-equals `[DAG_WARNING_EXAMPLES.unavailable]`) PLUS exactly one parsed `{event:'dashboard_api_degraded', route:'dag', runId, reason}` line whose `reason` equals the warning's `reason=` value byte-for-byte; and register×2 → run pinned `v2` → deregister → register×1 → exactly one `PREDICTED_FROM_FALLBACK_VERSION: pinned=v2 resolved=v1` entry and NO log line (the pin must outnumber the re-registered lineage or arm (i) finds a same-numbered new row and the case proves nothing). One `const PREDICTED_OVERLAY_UNAVAILABLE` in the file, used twice; `/skeleton/i` absent from the served bytes. **[v27b]** In `dag-masking-auth.test.ts` (which this task runs but TASK-202 owns) the DAG-payload halves must be GREEN here: INV-V27-9's parity after the stabilization predicate (exclusion form, `PARITY_EXCLUDED = ['runId','terminalAt']`, `current` COMPARED), the live `keys ⊆ ALLOWED_DAG_KEYS && REQUIRED_DAG_KEYS ⊆ keys` check on BOTH payloads, and both positive anchors on the AUTH server (a `__skel_` cell present; `lanes.map(l => l.title)` equal to the phased script's titles with `current === 0`). Its `describe.phases[].agents` half stays RED until TASK-202 lands — the expected split, not a defect (same rule as TASK-197's).
- **estimate:** M
- **iter:** v27b

### TASK-204 — `src/static-assets.ts` and the vendored font payload
- **status:** done
- **traces:** ARCH-123, ADR-049, REQ-131
- **files:** src/static-assets.ts, src/dashboard/fonts/, src/dashboard/fonts/SOURCE.md, src/dashboard/fonts/OFL.txt, tests/unit/static-assets.test.ts
- **des:** DES-199
- **dod:** `npx vitest run tests/unit/static-assets.test.ts` → for the keys this task itself ships (`dashboard.css` and the five woff2) the map is closed in BOTH directions (listed ⇒ on disk, on disk ⇒ listed); the `ui/`/`lib/` keys are declared and their on-disk half stays RED until TASK-206..212 land (preamble rule 4, re-run as TASK-212's last check). `lookupStaticAsset` answers `null` for every row of the traversal table (`../../etc/passwd`, `%2e%2e%2f`, `ui/../lib/theme.js`, `ui/app.js%00.png`, `//etc/passwd`) and is a bare `Map.get` (no `join`/`normalize`/`decode` appears in the module); cache policy is the exact header value `public, max-age=31536000, immutable` for woff2 (**[v27j]** not the bare token — AC-8) and `no-store` for js/css; `fonts/SOURCE.md`'s recorded sha256 matches each woff2 byte-for-byte and `fonts/OFL.txt` exists; and a key whose file is deleted logs `{event:'dashboard_asset_missing', key}` once and then 404s instead of throwing at boot.
- **estimate:** M
- **iter:** v27j

### TASK-205 — the shell page: markup, tokens CSS with the OKLCH ramp, the data island, and the update panel that must not vanish
- **status:** done
- **traces:** ARCH-122, ARCH-120, ADR-049, REQ-131, REQ-070
- **files:** src/dashboard-page.ts, src/dashboard/lib/status.js, tests/unit/dashboard-page-source.test.ts, tests/unit/update-outcome-config-check.test.ts
- **des:** DES-200, DES-201
- **dod:** `npx vitest run tests/unit/dashboard-page-source.test.ts tests/unit/update-outcome-config-check.test.ts` → `buildDashboardHtml()` keeps its signature and its one caller; the emitted HTML contains `data-theme="dark"`, the three asset `<link>`/`<script>` references, exactly ONE inline `<script>` and it is `type="application/json" id="rwe-init"` (a grep for `<script>` without `type=` returns 0); the island round-trips `{version,lastUpdate,interruptedRuns}` through `JSON.parse` with `<` escaped; ~~`DASHBOARD_HTML` still contains `.fit-btn{position:relative;z-index:1;` and the `#diagram-img{…-webkit-user-drag:none}` rule~~ **[v27c: `clientFile('dashboard.css')` is now the subject of those two CSS pins — see below]** and ~~`DASHBOARD_HTML` still contains `draggable="false"`~~ **[v27j: STRUCK — `draggable="false"` was never markup; `src/dashboard/ui/workflow.js:151-154` sets `img.draggable = false` and UT-224 has pinned it there since v27g (IMPL-270). ~~Pending TASK-215, the fossil body at `dashboard-page.ts:92-152` still stands and is not a test subject~~ **[v28, TASK-215 landed — the fossil body is deleted]**]**; and `dashboard.css` declares `--color-bg:#18191b` under `[data-theme="dark"]`, `#eef2f1` under `[data-theme="light"]`, and every accent token as an `oklch(L C var(--rwe-hue))` literal. **[v27c] This task no longer WRITES `dashboard.css` — TASK-214 is its one author** (the routed defect was two owners on one file; two writers is the same defect). The two `dashboard.css` clauses above stay as ASSERTIONS over TASK-214's output, and one of them is corrected: the accent ramp must satisfy DES-201's corrected DIRECTION — dark `--accent-100…900` L **ascends**, light **descends**. What this task still OWNS, in `src/dashboard-page.ts`, is DES-200's one-delivery-path rule: the `readFileSync`, the `DASHBOARD_CSS` const and the `<style>${DASHBOARD_CSS}</style>` tag are DELETED so the `<link>` is the only path, and in the SAME commit the `.fit-btn` and `#diagram-img` CSS pins take `clientFile('dashboard.css')` as their subject rather than `DASHBOARD_HTML` (DES-208's STAYS option; `draggable="false"` is markup and stays on `DASHBOARD_HTML`). These two v27c clauses are a RE-RUN of an already-landed task (IMPL exists) and land in the SAME batch as TASK-214, never before it — between the deletion and the re-point those two pins are red.
- **estimate:** L
- **iter:** v27j

### TASK-206 — `lib/` I: viewer preferences + the string table, and the connection reducer
- **status:** done
- **traces:** ARCH-124, ADR-049, REQ-131
- **files:** src/dashboard/lib/theme.js, src/dashboard/lib/strings.js, src/dashboard/lib/connection.js, tests/unit/dashboard-lib-theme.test.js, tests/unit/dashboard-lib-strings.test.js, tests/unit/dashboard-lib-connection.test.js
- **des:** DES-201, DES-202
- **dod:** `npx vitest run tests/unit/dashboard-lib-theme.test.js tests/unit/dashboard-lib-strings.test.js tests/unit/dashboard-lib-connection.test.js` → the `.js` tests RUN (they are silently skipped without TASK-196); `clampHue` totals over `-1 / 0 / 359 / 360 / NaN`, `prefsFromStorage` is pure over an injected getter and survives a throwing `localStorage`; `Object.keys(STR.zh).sort()` deep-equals `Object.keys(STR.en).sort()` and the table contains the key `predictedLayout` and NOT the C3 word; `nextConnection`'s transition table passes with a literal-fixture oracle — **[v27j: 「any `ok` → `live`」 is STRUCK, the v27g AC-4 repair removed that reading]** the tag is `worstOf(tick.results)` over the visible view's routes: `worst === 'ok'` → `live` with `consecutiveFails:0`, anything worse that is not unanimous `fail` → `degraded` with `consecutiveFails:0` (a degraded-plus-ok tick reads `degraded`, not `live`), one all-`fail` tick keeps the previous status and two consecutive make it `offline`; `classifyResponse` maps a 200-with-`degraded` body to `'degraded'`, a 404/500 and a parse failure to `'fail'`, never throwing. **[v27b]** `strings.js` also exports `warningText(lang, raw)`: over `DAG_WARNING_EXAMPLES` (TASK-197) it renders the FALLBACK literal with its substitute version and the UNAVAILABLE literal in BOTH languages, passes the `layoutGraph` prose literal through RAW (it contains `': '` too — the split is on the FIRST one and the head must match the CLOSED token set), and returns `raw` for an unknown head, a detail with no `=`, and a known token with a malformed detail — never `undefined`, never the detail half. The key-parity assertion now also covers `predictedLayoutUnavailable`, `predictedLayoutFromFallback` and `laneUntitled`, and none of the three contains the C3 word.
- **estimate:** M
- **iter:** v27j

### TASK-207 — `lib/` II: swimlane geometry, the list projections and the one money formatter, the panel VM
- **status:** done
- **traces:** ARCH-124, ARCH-120, REQ-132, REQ-133, REQ-134, REQ-135
- **files:** src/dashboard/lib/swimlane.js, src/dashboard/lib/runlist.js, src/dashboard/lib/agent.js, tests/unit/dashboard-lib-swimlane.test.js, tests/unit/dashboard-lib-runlist.test.js, tests/unit/dashboard-lib-agent.test.js
- **des:** DES-203, DES-204, DES-205
- **dod:** `npx vitest run tests/unit/dashboard-lib-swimlane.test.js tests/unit/dashboard-lib-runlist.test.js tests/unit/dashboard-lib-agent.test.js` → `SWIMLANE_BOX` equals REQ-134's seven constants exactly, `svgBox` of a 5-lane/9-agent fixture is a minimum box for zero cells (never `0×0`), `edgePath` emits a cubic from right-mid to left-mid, `panelSide` is total at exactly `graphWidth/2`; `fmtCost` renders `—` for absent, `≥ $0.42 · 2 未定價` when `unpricedCalls>0` and `$0.42` otherwise, `sortRows` puts absent values LAST in BOTH directions, `historyRow` emits REQ-133's nine columns with `4m 12s 進行中` for a live run; `panelModel` builds the six stat cards (timeout twice, four token columns), renders BOTH `effortApplied` branches, the `provider · transport · proxyModel` line, the `lastActivityAt`-vs-`startedAt` activity line, `mcpUnresolved`/`unmapped` counts, `reasonCode`, `detail`, and — for an absent `harness.systemPrompt` — the wording 「無 system prompt 紀錄」, never 「未套用」. Every function takes `now` as a parameter; `grep -rn "Date.now()\|new Date()" src/dashboard/lib` → 0. **[v27c]** This task adds no `.css` and no design value: the rules its consumers need are TASK-214's, and `lib/` returns numbers and strings only — never a colour, a font size or a class it invented (DES-209's allowlist).
- **estimate:** L
- **iter:** v27c

### TASK-208 — `ui/` I: the app entry, the settle-then-reschedule poller, and the Workflows home
- **status:** done
- **traces:** ARCH-125, ARCH-122, REQ-131, REQ-132
- **files:** src/dashboard/ui/app.js, src/dashboard/ui/theme-init.js, src/dashboard/ui/poll.js, src/dashboard/ui/home.js, tests/unit/dashboard-client-corpus.test.ts, tests/acceptance/val-198-shell-and-home.test.ts
- **des:** DES-206, DES-200, DES-201
- **dod:** `RWE_REQUIRE_BROWSER=1 npx vitest run tests/acceptance/val-198-shell-and-home.test.ts` → in real Chromium against a really booted `createServer()`: first load is `data-theme="dark"` with `--color-bg` computing to `#18191b`; switching to 淺 gives `#eef2f1` and survives a reload; 「系統」 follows an emulated `prefers-color-scheme` flip with no reload; moving the hue slider to `h` recomputes `--color-accent` to `oklch(0.72 0.065 h)` and writes `localStorage['rwe-hue']`; EN/中 swap every nav and column label; `performance.getEntriesByType('resource')` lists ONLY same-origin URLs and both font families are applied; home shows the three segments, the search box, the segment counts, the `平均費用` meta figure and the running card's sweep; and a dark + a light screenshot per view are written to `evidence/v27/`. **[v27c]** DES-206's 「one timer」 is made TRUE (the `grep` half is the SLICE's final green, re-run as TASK-212's last check, since `system.js`/`issues.js`/`models.js` are TASK-212's files): `grep -c "setTimeout" src/dashboard/ui/*.js` finds the scheduler in `app.js` ONLY — the five view loops (`run.js:315`, `workflow.js:293` and `:305`, `system.js:82`, `issues.js:102`, `models.js:65`) are deleted and each view instead exports `onTick(container, bodies, ctx)`; `app.js`'s tick keeps EVERY body (not just `primaryBody`), calls the mounted module's `onTick`, merges the statuses it returns into `results`, and only THEN reduces `nextConnection`, and `app.js:294`'s `render(container, {}, {})` becomes `render(container, ctx, handlers)`. `ROUTES` (`poll.js:15-26`) is unchanged — a view needing a state-dependent fetch (the selected run's `/dag`) does it INSIDE `onTick` via `getJSON` and returns its status. This task also sets only class names that appear in DES-209's `STYLE_HOOKS`, and adds no `.css`.
- **estimate:** L
- **iter:** v27c

### TASK-209 — `ui/workflow.js`: the workflow detail view, the run chips, the history table and the predicted layout
- **status:** done
- **traces:** ARCH-125, ARCH-131, REQ-133
- **files:** src/dashboard/ui/workflow.js, tests/acceptance/val-199-workflow-detail.test.ts
- **des:** DES-206, DES-204
- **dod:** `RWE_REQUIRE_BROWSER=1 npx vitest run tests/acceptance/val-199-workflow-detail.test.ts` → in real Chromium: the detail page renders the h2, the `版本 vN` tag, the executable tag, the TRIGGERS outline tags, at most six run chips with 7px status dots and 8-char runIds, and the nine-column history table (a live row reading `4m 12s 進行中`); clicking a row switches the figure above to that run; a never-run workflow renders its predicted lanes with agent labels from `describe.phases[].agents` — **[v27b]** on an auth-ENABLED engine too, and with NO masked arm: a lane whose `agents` is `[]` renders with no cells, and `agents` absent on every phase renders lanes-only plus `t(lang,'predictedLayoutUnavailable')` (the same string-table key the run view's warning uses), never a 「masked」 branch no engine state can produce; `grep -rin "skeleton" src/dashboard` → 0; and the author's diagram still loads through `createObjectURL`/`revokeObjectURL` with the per-(name,version) memo, fetched once rather than once per tick. **[v27c]** This task adds no `.css`; the rules its DoD needs are TASK-214's. It sets only class names that appear in DES-209's `STYLE_HOOKS` (`.wf-desc`, `.run-chip`/`.is-selected`, `.status-dot`, `tr.is-selected`, `.tag-*`) and carries NO colour / typography / radius / shadow / transition literal — `maxWidth='720px'` (`:72`), `fontSize='7px'` (`:178`) and the `rgba(159,184,214,.07)` selected row (`:189`) MOVE to the stylesheet. It drops its own `setTimeout` loop for `onTick` (TASK-208).
- **estimate:** M
- **iter:** v27c

### TASK-210 — `ui/run.js`: the swimlane painter, and the zoom/pan/fit contract that may not regress
- **status:** done
- **traces:** ARCH-125, ARCH-120, REQ-134, REQ-129
- **files:** src/dashboard/ui/run.js, tests/acceptance/val-193-dag-fit-and-columns.test.ts, tests/acceptance/val-200-swimlane.test.ts
- **des:** DES-206, DES-203
- **dod:** `RWE_REQUIRE_BROWSER=1 npx vitest run tests/acceptance/val-200-swimlane.test.ts tests/acceptance/val-193-dag-fit-and-columns.test.ts` → in real Chromium on a 5-lane/9-agent run: lane headers are 13px uppercase `.04em` semibold with the current lane accent + `目前` tag and a hairline per lane x; edges are 1.2px cubic béziers, dashed `4 4` into pending/queued; nodes are 216×74 three-row with the running node's `rweGlow`/`rweRing` and the failed node's `oklch(0.55 0.16 25)`; the trigger node is 112×40; the legend row and the right-aligned run summary render; and — the non-regression half — a real wheel-zoom then real drag survives at least two 3-second rebuilds (the transform stays on `#dag-zoom`), `#dag-fit` resets, and val-193's existing assertions on `#dag-fit`/`#dag-graph`/`#dag-zoom`/`#run-usage`/`#diagram-img`/`#diagram-zoom` pass unchanged. **[v27b]** The legend row renders the DAG payload's `warnings` as TEXT — `warningText(lang, w)` per entry via `textContent`, replacing the `N warning(s)` badge (`dashboard-page.ts:601-607`) — and a predicted cell (`kind === 'agent' && agentId === undefined`, never `agentId === undefined` alone: the trigger cell has no `agentId` either) paints with REQ-134's queued/pending style and its own `label`, falling back to nothing rather than to the word `agent`. **[v27c]** The painter moves onto DES-209's SUBSTRATE: `#dag-graph` keeps the lane hairlines and the edges (SVG, `viewBox` and native scale unchanged), and the lane headers / trigger / agent cells / legend become HTML in a sibling `<div class="cell-layer">` inside `#dag-zoom`, absolutely positioned from the SAME `laneX`/`cellRect` px — which is what makes REQ-134's ellipsis label, the in-node `.tag-neutral` and `--shadow-md` renderable at all. This task adds no `.css`; it sets only class names in DES-209's `STYLE_HOOKS` and carries NO colour / typography / dasharray / opacity literal, **`setAttribute` included** — all 12 hex literals (`:108 :121 :139-140 :151-152 :162-163 :172-173 :181 :190`), the `letter-spacing` style attribute (`:119`), the `.toUpperCase()` (`:122`) and the container px (`:260-262`, `:279`) move to the stylesheet. `val-200`'s node selector becomes `'#dag-zoom [data-node-cell]'` and its lane-header selector drops the `[class*="lane-head"]` alternate — both edits travel in THIS commit or the case goes red for a non-defect reason. It drops its own `setTimeout` loop for `onTick` (TASK-208).
- **estimate:** L
- **iter:** v27c

### TASK-211 — `ui/agent-panel.js`: the slide-in panel
- **status:** done
- **traces:** ARCH-125, ARCH-131, REQ-135, REQ-136
- **files:** src/dashboard/ui/agent-panel.js, tests/acceptance/val-201-agent-panel.test.ts
- **des:** DES-206, DES-205
- **dod:** `RWE_REQUIRE_BROWSER=1 npx vitest run tests/acceptance/val-201-agent-panel.test.ts` → in real Chromium: clicking a node in the LEFT half slides the panel in from the right and a node in the right half from the left, over a `rgba(8,12,9,.5)` backdrop; the header carries the close button, label h2, state tag, phase tag and monospace agentId; six stat cards render including the four token columns and the timeout shown twice; the user prompt appears in the `<pre>` and contains the script prompt but NOT the agentType system prompt; the three tag columns carry counts; event rows carry `HH:MM:SS` + a kind tag + monospace content, a row over 2 KB is clipped with a click-to-expand that restores the full text, and the window marker 「顯示 N / 共 M+」 appears when `hasMore`; a failed event's `detail` renders in the red block; Esc and a backdrop click both close. **[v27c]** This task adds no `.css`; the rules its DoD needs are TASK-214's. It sets only class names in DES-209's `STYLE_HOOKS` and carries NO colour / typography / width / transition literal: the three `cssText` blocks (`:104` backdrop, `:110` panel, `:180` detail) become `.agent-backdrop`, `.agent-panel` / `.agent-panel.from-left` and `.detail-block`. The invented `width:420px` is DELETED — the width belongs to `.agent-panel` in the stylesheet, and REQ-135's own six stat cards at `auto-fit minmax(150px,1fr)` plus a `<pre>`, three tag columns and an event list do not fit in 420px (the target value `min(760px,100vw)` is the delivery README's and resolves with DES-209's `owner_decision`; the tested floor is three stat columns).
- **estimate:** L
- **iter:** v27c

### TASK-212 — the three shipped tabs are PORTED, not redesigned
- **status:** done
- **traces:** ARCH-125, ARCH-123, REQ-067, REQ-076, REQ-077, REQ-078
- **files:** src/dashboard/ui/models.js, src/dashboard/ui/system.js, src/dashboard/ui/issues.js, src/static-assets.ts, tests/acceptance/val-202-ported-tabs.test.ts
- **des:** DES-207
- **dod:** `RWE_REQUIRE_BROWSER=1 npx vitest run tests/acceptance/val-202-ported-tabs.test.ts` → in real Chromium after the rebuild, the Models tab still renders its `.models-table` rows from `/api/models`, the System tab still renders `#system-panel` from `/api/system` (with the ONE 「無法取樣」 component on a degraded section rather than a thrown render), and the Issues tab still lists open and resolved issues from `/api/issues` — each re-themed only by inheriting the new tokens, with NO sorting, NO filtering, NO slide-in and NO new endpoint. A diff of the three modules against `dashboard-page.ts`'s retired functions is recorded in the commit message as evidence the move was mechanical. **[v27c]** This task adds no `.css`; it inherits TASK-214's component layer (`.table .tag .btn .seg .input .nav .hr .card`) and sets only class names in DES-209's `STYLE_HOOKS`, with no colour / typography literal of its own. It drops its own `setTimeout` loops for `onTick` (TASK-208).
- **estimate:** M
- **iter:** v27c

### TASK-213 — the page-source pin migration: one corpus, one disposition per assertion
- **status:** done
- **traces:** ARCH-122, ARCH-124, ADR-053, REQ-131, REQ-129, REQ-119
- **files:** tests/helpers/client-corpus.ts, tests/unit/dashboard-page-source.test.ts, tests/unit/dashboard-diagram-render.test.ts, tests/unit/dashboard-zoom-source.test.ts, tests/unit/workflow-page-harness-table.test.ts, tests/unit/update-outcome-config-check.test.ts
- **des:** DES-208
- **dod:** `npx vitest run tests/unit/dashboard-page-source.test.ts tests/unit/dashboard-diagram-render.test.ts tests/unit/dashboard-zoom-source.test.ts tests/unit/workflow-page-harness-table.test.ts tests/unit/update-outcome-config-check.test.ts tests/unit/dashboard-client-corpus.test.ts` → every assertion that took `DASHBOARD_HTML` as its subject and grepped it for client-JS content has been dispositioned STAYS / MOVES / RETIRES (the table is in the commit message, one row per assertion, retirements naming the VAL id that re-proves them); each re-pointed file carries at least one POSITIVE anchor on `clientCorpus()` beside its negatives plus `expect(clientCorpus().length).toBeGreaterThan(5000)`; and `clientCorpus()` THROWS on an empty directory rather than returning `''`.
- **estimate:** M
- **iter:** v27

### TASK-214 — `dashboard.css` gets ONE owner: the class contract, every component and view section, and the two locks that keep them
- **status:** done
- **traces:** ARCH-122, ARCH-125, ARCH-123, ADR-053, REQ-131, REQ-132, REQ-133, REQ-134, REQ-135, REQ-067, REQ-076, REQ-077, REQ-078
- **files:** src/dashboard/dashboard.css, tests/fixtures/dashboard-classes.ts, tests/fixtures/dashboard-spec.ts, tests/unit/dashboard-class-contract.test.ts, tests/unit/dashboard-no-design-values.test.ts
- **des:** DES-209, DES-201, DES-200, DES-203
- **dod:** `npx vitest run tests/unit/dashboard-class-contract.test.ts` → (1) **class lock**: every `STYLE_HOOKS` entry in `tests/fixtures/dashboard-classes.ts` appears as a selector in `clientFile('dashboard.css')`, every class selector in the stylesheet appears in `STYLE_HOOKS` (so the dead ported rules `.pill .st-* .grp .node .phase .ph-lbl .usage-* #tree` are DELETED — authorised here, since their emitters retired with `dashboard-page.ts`'s inline script), and `STYLE_HOOKS.length ≥ 60`; (2) **value anchors** (anti-vacuity — 60 empty rules must not pass): the seven `@keyframes` bodies are present by name, `.cell` is `216px`/`74px` radius `3px`, `.cell.is-failed` carries `oklch(0.55 0.16 25)`, `.cell.is-queued` carries `opacity:.65` + a dashed border, `.lane-head` is `13px`/`600`/`letter-spacing:.04em`/`uppercase`, `.card-grid` is `minmax(280px,1fr)` gap `16px`, `.agent-panel` resolves wide enough for THREE columns of REQ-135's `auto-fit minmax(150px,1fr)` stat grid (**≥ 500px** — derived from REQ-135's own numbers; the `min(760px,100vw)` the panel transcribed from the delivery README is the target value and resolves with DES-209's `owner_decision`, so it is NOT the anchor), and the dark `--accent-100…900` L values **ascend** while the light ones **descend** (DES-201's corrected ramp direction); (3) `tests/unit/dashboard-no-design-values.test.ts` is WRITTEN here and carries the slice's two deferred halves — **the emitter half of the class lock** (every `STYLE_HOOKS` entry is set by `clientCorpus()` or `DASHBOARD_HTML`, and every `TEST_ANCHORS` entry is emitted) and **the no-design-values guard**: over `clientCorpus()`, zero matches for `#[0-9a-fA-F]{3,6}`, `oklch(`, `rgba(`, `cssText`, `setAttribute('fill'|'stroke'|'stroke-width'|'stroke-dasharray'|'font-size'|'font-weight'|'opacity'|'style'` and `.style.` other than `display`/`transform`/`setProperty('--rwe-hue'`/the one `// rwe-allow-style: svgBox` line, with a POSITIVE anchor (`expect(clientCorpus()).toContain('style.transform')`) beside the negatives. **This task owns NO `.js` and NO `.ts` product file** — it writes the stylesheet, the two fixtures and the two locks, and the view modules are edited by their OWN tasks (TASK-208/209/210/211/212, whose amended DoDs carry the relocation). Consequently, exactly as ordering rule 4 already governs TASK-204's `listed ⇒ on disk` half, **the whole of `dashboard-no-design-values.test.ts` is the SLICE's final green, not this task's** — it stays RED until TASK-212 lands and is re-run as its last check, which is why this task's own `dod:` command names only `dashboard-class-contract.test.ts`. This task's own green is the stylesheet plus clauses (1) and (2). **This task has no Gate 5 of its own** (the invocation skips `tests`): write the two new test files and `SPEC_ROWS` FIRST, run them RED for the stated reason, then green — and the verifier records them as UT items at the next gate that owns 05-tests.md.
- **estimate:** L
- **iter:** v27c

### TASK-215 — the shell body becomes ONE mount element, and the five fossil page-source pins are dispositioned
- **status:** done
- **traces:** ARCH-122, ADR-049, REQ-131
- **files:** src/dashboard-page.ts, tests/unit/dashboard-page-source.test.ts, tests/unit/dashboard-zoom-source.test.ts, tests/unit/workflow-page-harness-table.test.ts, tests/unit/dashboard-diagram-render.test.ts, tests/unit/dashboard-no-design-values.test.ts
- **des:** DES-200, DES-208
- **dod:** `npx vitest run tests/unit/dashboard-page-source.test.ts tests/unit/dashboard-zoom-source.test.ts tests/unit/workflow-page-harness-table.test.ts tests/unit/dashboard-diagram-render.test.ts tests/unit/dashboard-no-design-values.test.ts` → green after `src/dashboard-page.ts:92-152` (the pre-v27 `<header>`…`</main>` body) is DELETED and `<body>` emits ONE mount element — `<main class="empty">` carrying DES-200's pre-boot literal, no `id`, no timer, no `<noscript>` — and RED beforehand on exactly the NEW UT-241 positive (the F-pattern proof: write that assertion first, run it red against HEAD where the fossil is present, then delete the body). `app.js` needs no change: `replaceChildren` (`ui/app.js:455`) removes whatever the shell put there. **Five dispositions, one per assertion, each verified at `eb387a1`:** (1) `dashboard-page-source.test.ts:95` `expect(DASHBOARD_HTML).toMatch(/draggable="false"/)` **RETIRES** — UT-224's v27g re-pointed case at `:43` already guards the element on `clientFile('ui/workflow.js')`; (2) `dashboard-zoom-source.test.ts:19,23` (`.zoomable` / `fit`) **MOVE** to `clientFile('ui/run.js')`; (3) `workflow-page-harness-table.test.ts:15` **RETIRES with reason** (the harness table's role is REQ-135's panel, real-tier proven by val-201) or MOVES to `clientFile('ui/agent-panel.js')`; (4) `dashboard-diagram-render.test.ts:60`'s positive **MOVES** to `clientFile('ui/workflow.js')` and its two negatives to `clientCorpus()` (over `DASHBOARD_HTML` they pass vacuously — DES-208's 「dangerous green」); (5) `dashboard-no-design-values.test.ts:44,50` **STAYS**, no change (measured: 0 of 104 `STYLE_HOOKS` and 0 of 23 `TEST_ANCHORS` are emitted only by the shell). **NEW UT-241 positive:** the `<body>` holds `<main class="empty">`, the island and the module script and **no `<section`/`<header`**, and the asset path inside the pre-boot literal is asserted EQUAL to the module `<script src>` the same page emits. **The deletion and the five dispositions land in ONE commit** — deletion first turns five assertions red, dispositions first leaves them green over dead bytes. In that same commit: fix `dashboard-page-source.test.ts:51`'s comment `UT-240` → `UT-241` (the ledger's UT-240 is `static-assets.test.ts`, `05-tests.md:12062`; both ids resolve, so `sh .sdlc/trace` can never see this), and strike the five tree-state sentences this task retires — ARCH-122's `api:` 「removed by the TASK-A follow-up」, its `note:` 「(after TASK-A)」 marker and its `note:` 「plus `<noscript>`」 clause (DES-200 landed on NO `<noscript>`: the pre-boot sentence is on screen whether the module 404s or JS is off, so a second string saying the same thing is redundancy — striking it here is what stops that DES↔ARCH disagreement from outliving this task), and the 「until/pending TASK-215」 sentences in DES-200, DES-208 and TASK-205.
- **estimate:** S
- **iter:** v27j
- **closeout (2026-09-18, missing-IMPL-trail sweep — verified and flipped `done`):** landed at `7c71b2b`, which committed this task's work but never flipped this row or wrote its IMPL entry. `dod:` re-run verbatim in an isolated `git worktree add --detach <scratch> HEAD` copy (`d935da4`) — 24/24 green across all five named test files; the live tree's own run shows 1 unrelated failure caused by a parallel task's uncommitted edit to `src/dashboard/ui/workflow.js:420`, not by this task (see IMPL-299). `dashboard-page.ts` confirmed 115 lines, `<body>` is exactly one `<main class="empty">`, no `<section`/`<header`/`<noscript`. The five tree-state strikes and the UT-240→UT-241 comment fix are on disk. See IMPL-299.

### TASK-216 — the inverse `tsc` program: the server tree compiles without the client tree and without DOM
- **status:** done
- **traces:** ADR-049, ARCH-124, REQ-131, REQ-134
- **files:** tsconfig.server.json (new), package.json, tests/unit/tsconfig-server-program.test.ts (new)
- **des:** DES-191
- **dod:** `npm run typecheck` and `npm run build` each run BOTH programs (`tsc --noEmit && tsc --noEmit -p tsconfig.server.json`) and exit 0 on the tree — paste both exit codes. The config's shape is ADR-049's as amended (`02-architecture.md:3444`) and is not re-invented here. **Three planted violations go RED and are then reverted:** `document.title` in a server `.ts` → **TS2584**; `import { worstOf } from './dashboard/lib/connection.js'` in a server `.ts` → **TS7016**; a stray token in `src/dashboard/ui/app.js` still fails the **ROOT** program → **TS1109**, exit 2 (the parse coverage this must not trade away). ONE unit test asserts that both `scripts.typecheck` and `scripts.build` contain `tsconfig.server.json`, so neither program can vanish in a later 「simplification」; `deploy/rwe-update.sh` stays unchanged (`:147` already reverts a self-update whose `npm run build` failed). Red-first, since this loop has no tests gate: write the pinning test FIRST and run it red against HEAD (the script strings do not name the second program), then green. IN THE SAME COMMIT strike ADR-049's 「the split has NOT landed … UNGUARDED」 sentence and ARCH-124's 「UNGUARDED until TASK-B lands」, and update ARCH-124's 「`npm run build` is `tsc --noEmit`」 plus the v27 deployment view's `npm ci · tsc --noEmit · vitest run` label to name both programs. The new test file's UT id is minted by the verifier at the next gate that owns `05-tests.md` (TASK-214's precedent).
- **estimate:** S
- **iter:** v27j
- **closeout (2026-09-18, missing-IMPL-trail sweep — verified and flipped `done`):** landed at `7c71b2b`, which committed this task's work but never flipped this row or wrote its IMPL entry. `dod:` re-run verbatim in an isolated `git worktree add --detach <scratch> HEAD` copy (`d935da4`): `npm run typecheck` and `npm run build` (both `tsc --noEmit && tsc --noEmit -p tsconfig.server.json`) exit 0; `tests/unit/tsconfig-server-program.test.ts` 3/3 green; one of the three planted violations (`document.title` in a server `.ts`) re-planted in that disposable copy, reproduces `TS2584`, reverted clean. `tsconfig.server.json` matches ADR-049's amended shape and both scripts run the two-program form. The UT id for the new test file stays deferred to the next gate owning `05-tests.md`, per this card's own `dod:` — not minted here. See IMPL-300.

## v28 tasks — Sprint B (REQ-137/138/139/142/143 · ARCH-132..135 + ADR-057..060 + the v28 amendments to ARCH-123/124/125/130) — TASK-217..TASK-225

**Ordering rules (the v27 precedent, re-derived for this slice — read before picking a task).**
1. **TASK-219 first, TASK-217 second, then everything else.** TASK-219 mints the three wire fixture
   rows every later task's oracle imports; TASK-217 is the seam five modules hang from. Neither is
   parallel with what follows it.
2. **TASK-217 is ONE task and is not split by file.** `poll.js`'s `reached` without `app.js`'s
   sequence is a dead field, the SIX import swaps without `getViewJSON` break six working views,
   and the INV-V28-1 guard is RED today (`run.js:83`, `workflow.js:36`, `agent-panel.js:35`,
   `issues.js:17`, `models.js:15`, `system.js:19` all import `getJSON`) so it must go green in the
   same commit that makes it true.
3. **Every new `.js` file lands in the SAME commit as its `ASSET_KEYS` entry.**
   `src/static-assets.ts:18-26` + `tests/unit/static-assets.test.ts:50-71` is closed BOTH ways, so a
   file on disk without its key — or a key without its file — turns that test red for every other
   implementer on the shared tree (CLAUDE.md's recorded hazard). Four files are affected:
   `lib/scheduler.js`, `lib/system.js`, `lib/issues.js`, `demo/dataset.js`.
4. **TASK-221 (the stylesheet) lands before the three view tasks and its own green is partial** —
   the class lock (`dashboard-class-contract.test.ts`) goes green with it; the EMITTER half
   (`dashboard-no-design-values.test.ts`: every `STYLE_HOOKS` entry is set by `clientCorpus()`)
   stays RED until TASK-222/223/224 land and is **the slice's final green**, not TASK-221's. Exactly
   the disposition TASK-214 carried at v27c.
5. **Each tab task owns its `lib/` module AND its `ui/` module AND its UT.** Splitting pure from DOM
   across two tasks produces a `lib/` export with no caller and a `ui/` file importing a function
   that does not exist — and under ADR-049 the `ui/` half has no unit tier to catch the mismatch.
6. **`tests/fixtures/dashboard-spec.ts` is in NO task's `files:`.** Carry-forward lesson 3 — a
   SPEC_ROW authored from the build is worse than a missing one. The rows for REQ-137/138 are
   written RED by Gate 5 from `.sdlc/design-handoff/README.md` §4/§5, before the CSS exists
   (DES-219 states the row contract; only the `SpecReq`/`SpecView` union widening is mechanical and
   it belongs to Gate 5's own RED commit).
7. **TASK-225 is independent** of all of the above and may land at any point — with ONE exception:
   it shares `src/server.ts` with TASK-219 (the `:370` literal vs the `:466` type annotation), so those
   two are sequential with each other even though neither blocks anything else.

### TASK-217 — the v28 seam: ONE result type, the tick sequence, the two stamps, and tab activation
- **status:** done
- **traces:** ARCH-133, ARCH-125, ARCH-124, ADR-057, ADR-058, ADR-059, REQ-142, REQ-143, REQ-137, REQ-138, REQ-139
- **files:** src/dashboard/ui/poll.js, src/dashboard/ui/app.js, src/dashboard/ui/run.js, src/dashboard/ui/workflow.js, src/dashboard/ui/agent-panel.js, src/dashboard/ui/models.js, src/dashboard/ui/system.js, src/dashboard/ui/issues.js, tests/unit/dashboard-seam.test.ts
- **des:** DES-210
- **dod:** `npx vitest run tests/unit/dashboard-seam.test.ts tests/unit/dashboard-client-corpus.test.ts` → green, and RED beforehand on the INV-V28-1 case (write it first and run it against HEAD, where six `ui/` modules import `getJSON`). The test carries five cases, all over `clientCorpus()`/`clientFile()`: (1) **INV-V28-1** — the only files importing `getJSON` from `./poll.js` are `ui/app.js` and `ui/poll.js`; every other `ui/` module that fetches imports `getViewJSON`; (2) `poll.js` exports `getViewJSON` and `setDemoBodies`, and `endpointsFor('system')` deep-equals `['/api/system', '/api/workflows', '/api/runs']` (ADR-057); (3) **the one-timer tripwire** — `setTimeout(` occurs exactly once in `clientFile('ui/app.js')`; (4) **the one-commit tripwire (K2)** — `nextConnection(` occurs exactly twice in `app.js` while the string `connectionState = nextConnection(` occurs exactly ONCE, so the preview cannot be committed (measured at the design gate: `connectionState =` alone already matches twice today — `app.js:112`'s declaration and `:383` — and TASK-218 adds `connectionState = resumeReset(…)`, so the bare form is the wrong anchor); (5) `documentElement.setAttribute('data-poll'` and `'data-source'` each occur exactly once. **SIX files take one import line each and nothing else** — `run.js`, `workflow.js` and `agent-panel.js` (not rewritten this sprint) **and** `models.js`, `system.js`, `issues.js` (rewritten later by TASK-222/223/224, but they still self-fetch until then, so leaving them out would make case (1) red the moment this task lands). A diff touching any other line of those six files fails this task's review.
- **estimate:** L
- **iter:** v28
- **closeout (2026-09-18, missing-IMPL-trail sweep):** covered by IMPL-283; DoD re-run green today: `npx vitest run tests/unit/dashboard-seam.test.ts tests/unit/dashboard-client-corpus.test.ts` → 13/13.

### TASK-218 — `lib/scheduler.js`, `resumeReset`, and REQ-142's wiring
- **status:** done
- **traces:** ARCH-134, ARCH-133, ARCH-123, ADR-059, REQ-142
- **files:** src/dashboard/lib/scheduler.js, src/dashboard/lib/connection.js, src/dashboard/ui/app.js, src/static-assets.ts, tests/unit/dashboard-lib-scheduler.test.js, tests/unit/dashboard-lib-connection.test.js
- **des:** DES-211
- **dod:** `npx vitest run tests/unit/dashboard-lib-scheduler.test.js tests/unit/dashboard-lib-connection.test.js tests/unit/static-assets.test.ts` → green on the full decision table plus the five named cases a browser cannot see: `hidden` arriving between `fire` and `settled` ⇒ `park` (never `arm`); `visible` ⇒ `fire` then `arm`; `view-changed` ⇒ `fire`; `settled` while `parked` ⇒ `park`; and for `resumeReset` — `fail → pause → fail` ⇒ `degraded`, `fail → fail → pause → fail` ⇒ `offline`, `fail → fail → pause → ok` ⇒ `live`, and a `status:'offline'` input returns the SAME object (`status` is never touched). `static-assets.test.ts` is in the command because `lib/scheduler.js`'s `ASSET_KEYS` entry lands in this same commit (ordering rule 3).
- **estimate:** M
- **iter:** v28
- **closeout (2026-09-18, missing-IMPL-trail sweep):** covered by IMPL-284; DoD re-run green today: `npx vitest run tests/unit/dashboard-lib-scheduler.test.js tests/unit/dashboard-lib-connection.test.js tests/unit/static-assets.test.ts` → 41/41.

### TASK-219 — the three wire fixture rows, `IssuesListView`, and the four owed disclosure rows
- **status:** done
- **traces:** ARCH-130, ARCH-135, ADR-054, REQ-137, REQ-138, REQ-139
- **files:** tests/fixtures/dashboard-wire.ts, src/github/issue-reporter.ts, src/server.ts, tests/integration/dashboard-disclosure.test.ts
- **des:** DES-218
- **dod:** `npx vitest run tests/integration/dashboard-disclosure.test.ts` → green with `DISCLOSURE_TABLE` carrying **four new rows** — `GET /api/system (ok)`, `GET /api/system (per-section degraded)`, `GET /api/models[i] (ok)`, `GET /api/issues (ok)` — beside the existing `any /api/* (degraded)` row that already covers `/api/issues`'s token-missing arm and `/api/workflows[i]`'s catch-all, each with its own `ALLOWED_*`/`REQUIRED_*` key set and its body typed against the PRODUCTION type (`SystemInfoView & { auth: unknown }`, `EnrichedModelEntry`, `IssuesListView`). `export interface IssuesListView { open: IssueSummary[]; resolved: IssueSummary[]; degraded?: string }` is minted in `src/github/issue-reporter.ts` beside the types it composes and `server.ts:466`'s `sendJson` payload is annotated against it — **zero wire change**, it names a shape that already ships. No `DISCLOSURE_TABLE` row may be authored from a live response: each body is a literal typed by `satisfies`, which is what makes it simultaneously the type oracle for TASK-220, the key-set lock here, and the input literal for TASK-222/223/224's UTs.
- **estimate:** M
- **iter:** v28
- **closeout (2026-09-18, missing-IMPL-trail sweep):** covered by IMPL-285; DoD re-run green today: `npx vitest run tests/integration/dashboard-disclosure.test.ts` → 3/3.

### TASK-220 — `demo/dataset.js`, `demoEngages`, and the retirement tripwire
- **status:** done
- **traces:** ARCH-132, ARCH-123, ARCH-133, ADR-058, REQ-143
- **files:** src/dashboard/demo/dataset.js, src/dashboard/lib/connection.js, src/dashboard/lib/strings.js, src/dashboard/ui/app.js, src/static-assets.ts, tests/unit/demo-surface.test.ts, tests/unit/demo-dataset-types.test.ts, tests/unit/dashboard-lib-connection.test.js
- **des:** DES-212
- **dod:** `npx vitest run tests/unit/demo-surface.test.ts tests/unit/demo-dataset-types.test.ts tests/unit/dashboard-lib-connection.test.js tests/unit/static-assets.test.ts` → green on all four halves: (1) **the type lock** — every `DEMO` body `satisfies` the matching type from `tests/fixtures/dashboard-wire.ts` (TASK-219's rows), so the fiction cannot drift from the wire it imitates; (2) **the id charset** — every parametric key in `DEMO` round-trips `encodeURIComponent(id) === id` (`/^[A-Za-z0-9._~-]+$/`), and every workflow name starts `demo-`, every run id `demo0001`, every agent id `demo-agent-`, every issue title `[DEMO]`, every process pid is in `99000-99999`; (3) **the tripwire, closed BOTH ways** — an allowlist of the files permitted to contain `demo`/`示範` (`src/dashboard/demo/dataset.js`, `lib/connection.js`'s `demoEngages`, `lib/strings.js`'s two keys, `ui/app.js`'s one arm, `ui/poll.js`'s `getViewJSON`/`setDemoBodies`, and the VAL/UT files), where *listed ⇒ present on disk* and *mentioned ⇒ listed*; (4) `demoEngages` over its 2³ corners **plus** the one that bites — `reachedFlags === []` returns `false`, never vacuously `true`. `static-assets.test.ts` is in the command for `demo/dataset.js`'s key (ordering rule 3). Also in this commit: the two `lib/strings.js` keys (`demoData`, `demoBanner`) in BOTH languages.
- **estimate:** M
- **iter:** v28
- **closeout (2026-09-18, missing-IMPL-trail sweep):** covered by IMPL-286; DoD re-run green today: `npx vitest run tests/unit/demo-surface.test.ts tests/unit/demo-dataset-types.test.ts tests/unit/dashboard-lib-connection.test.js tests/unit/static-assets.test.ts` → 42/42.

### TASK-221 — `dashboard.css` v28: the three tabs' component families and the STYLE_HOOKS they declare
- **status:** done
- **traces:** ARCH-133, ARCH-125, REQ-137, REQ-138, REQ-139, REQ-143
- **files:** src/dashboard/dashboard.css, tests/fixtures/dashboard-classes.ts
- **des:** DES-219
- **dod:** `npx vitest run tests/unit/dashboard-class-contract.test.ts` → green on BOTH halves of the class lock (every new `STYLE_HOOKS` entry is a selector in `clientFile('dashboard.css')`, every class selector in the stylesheet is in `STYLE_HOOKS`) and on the value anchors DES-219 names, with `STYLE_HOOKS.length` risen by the v28 families. **This task's green is deliberately partial:** `tests/unit/dashboard-no-design-values.test.ts`'s emitter half stays RED until TASK-222/223/224 land and is the SLICE's final green (ordering rule 4) — do not "fix" it here by trimming a hook. This task owns **no `.js`**, writes **no `SPEC_ROW`** (ordering rule 6), and adds no colour/typography literal outside the existing token layer.
- **estimate:** L
- **iter:** v28
- **closeout (2026-09-18, missing-IMPL-trail sweep):** covered by IMPL-287 (`9e10453` + `78b4658`, the latter a one-line `.proc-self` value TASK-223's own acceptance test needed); DoD re-run green today: `npx vitest run tests/unit/dashboard-class-contract.test.ts` → 18/18.

### TASK-222 — Models (REQ-137): `lib/model.js`'s projections and the rewritten `ui/models.js`
- **status:** done
- **traces:** ARCH-134, ARCH-133, ADR-060, REQ-137
- **files:** src/dashboard/lib/model.js, src/dashboard/ui/models.js, tests/unit/dashboard-lib-model.test.js, tests/acceptance/val-203-models-tab.test.ts
- **des:** DES-213, DES-214
- **dod:** `npx vitest run tests/unit/dashboard-lib-model.test.js` → green on the **12 × 2 sort table** (every column, both directions, over a fixture of five `EnrichedModelEntry` rows one of which is all-absent: the absent row is LAST in BOTH directions for EVERY column) plus the honesty rule stated as a RULE and never as this iteration's absence — one fixture row WITHOUT `latency`/`benchmarks` renders `—`, one WITH them renders `TTFT 900ms · p50 6.8s` and `78 avg`, both required (ADR-060: a test pinning 「the latency cell is `—`」 encodes Won't-have D2 and goes green forever the day D2 is lifted) — plus `costLevel === 0` ⇒ the zero-dot form and sort key `0`, `costLevel === null` ⇒ `—` and sorts last (R4: `ZERO_RATES` is a fact, not an absence). Then `RWE_REQUIRE_BROWSER=1 npx vitest run tests/acceptance/val-203-models-tab.test.ts` → from a COLD `/dashboard`, clicking `[data-tab="models"]` paints the twelve columns, a header click sorts and re-sorts with ▲/▼ on the active header only, the counter reads `9` then `4 / 9` under a filter, and a row click opens the 560 px slide-in — with `notClipped` on every text cell of the table (`getComputedStyle` cannot see a flex-shrink clip).
- **estimate:** L
- **iter:** v28
- **closeout (2026-09-18, missing-IMPL-trail sweep — NOT flipped):** `lib/model.js` + `ui/models.js` landed at `9e10453` and the unit half is genuinely green (IMPL-288, `dashboard-lib-model.test.js` 29/29), but this card's OWN `dod:` also requires the browser-tier run, which is RED today: `RWE_REQUIRE_BROWSER=1 npx vitest run tests/acceptance/val-203-models-tab.test.ts` → **3 passed | 2 failed (5)** — the search box does not narrow the row count (`before`/`after` both 100), and the SPEC_ROWS case finds no `[data-model-panel]`/`.bench-row` anchors (the panel only renders after a row click, which that case never performs). See IMPL-288 for the full evidence. Left `draft`.
- **closeout (2026-09-18, both IMPL-288 findings root-caused — STILL NOT flipped):** both were test defects, not `models.js` defects — a diagnostic confirmed `matchModels`/`paint` filter correctly once the right element is typed into. (1) the search case's grouped selector matched the Home tab's hidden `.home-search` (`home.js:171`) ahead of the Models tab's own input, since every `[data-tab-panel]` stays mounted (`app.js:199`) and `page.$()` resolves a selector LIST in document order, not first-listed-selector order; scoped to `[data-tab-panel="models"] input[type="search"]`, test-only. (2) the SPEC_ROWS case never clicked a row before checking `[data-model-panel]`/`.bench-row`, though README §4 and `renderPanel` (`ui/models.js:235-241`) both gate the panel on a click, same as `val-201-agent-panel.test.ts:307`'s own precedent for the agent panel's SPEC_ROWS; added the click. Re-run: **4 passed | 1 failed (5)**. **Residual, not closed:** the three `.bench-row*` SPEC_ROWS (`dashboard-spec.ts:285-287`) cannot pass this iteration under any real `/api/models` reply — `EnrichedModelEntry` (`model-catalog.ts:341`) carries no `benchmarks` field (ADR-060 Won't-have D2) — and fabricating one via request interception was rejected as violating this file's own "no mock catalog" banner (`val-203-models-tab.test.ts:4`). This is a Gate 5 fixture-scope question (hold the three rows pending D2, or amend the mock policy), not resolvable at this tier. See IMPL-292. Still `draft` — orchestrator's call whether "unit dod full green + browser dod 4/5 green with one ADR-060-attributable residual" meets the bar.
- **closeout (2026-09-18, orchestrator ruling carried out — flipped `done`):** the three `.bench-row*` residual rows are PARKED (not deleted, not left red, not faked green) into a new `PARKED_SPEC_ROWS` export in `tests/fixtures/dashboard-spec.ts`, citing Won't-have D2 and ADR-060 by name, with a `tsc --noEmit` type-level tripwire against `EnrichedModelEntry` so a future `benchmarks` field breaks the build and points back at the parked rows. Both `dod:` commands now pass verbatim: unit tier 29/29, browser tier `RWE_REQUIRE_BROWSER=1 npx vitest run tests/acceptance/val-203-models-tab.test.ts` → **5/5**. Full regression re-confirmed unaffected (335 files/2567 passed/1 skipped, `tsc --noEmit` exit 0, trace 1716/30 gaps byte-identical). See IMPL-293 (closes IMPL-292's residual, at `03804bb`) and IMPL-292 (root-cause investigation).

### TASK-223 — System (REQ-138): `lib/system.js`'s projections and the rewritten `ui/system.js`
- **status:** done
- **traces:** ARCH-134, ARCH-133, ARCH-123, ADR-057, REQ-138
- **files:** src/dashboard/lib/system.js, src/dashboard/ui/system.js, src/static-assets.ts, tests/unit/dashboard-lib-system.test.js, tests/acceptance/val-204-system-tab.test.ts
- **des:** DES-215, DES-216
- **dod:** `npx vitest run tests/unit/dashboard-lib-system.test.js tests/unit/static-assets.test.ts` → green on: `sectionState` over each of the five `Reason` values of `system-info.ts:24-30` (and the three that are NOT faults — `awaiting-second-sample`, `unsupported-platform`, `sample-window-too-short` — carry their reason out as the card's secondary text, so 「wait one tick」 is distinguishable from 「this host cannot report it」); `cpuUtilState` over the sibling-key case (`utilizationPct: null` + `utilizationDegraded`); `statCard` returning `pct: undefined` for the counts card so the bar has an ABSENT state of its own (INV-V28-4), never `pct: 100`; `procTotals` over a `byState` map containing a letter no fixture anticipated (the `/proc` key set is OPEN — render the top states by count with a stable tiebreak, never a hard-coded S/R pair, never a throw); `catalogCounts` over ADR-057's three definitions. Then `RWE_REQUIRE_BROWSER=1 npx vitest run tests/acceptance/val-204-system-tab.test.ts` → the four stat cards, the process table with the engine's own row marked, the engine `<dl>`, and **the per-card degrade split**: with ONLY `/api/workflows` intercepted, the counts card reads Unavailable while CPU/memory/disk keep rendering live host numbers and the nav tag reads 降級.
- **estimate:** L
- **iter:** v28
- **closeout (2026-09-18, missing-IMPL-trail sweep):** covered by IMPL-289 (`9e10453` + `78b4658`); DoD re-run green today: `npx vitest run tests/unit/dashboard-lib-system.test.js tests/unit/static-assets.test.ts` → 21/21, then `RWE_REQUIRE_BROWSER=1 npx vitest run tests/acceptance/val-204-system-tab.test.ts` → 4/4.

### TASK-224 — Issues (REQ-139): `lib/issues.js` and the re-themed `ui/issues.js`
- **status:** done
- **traces:** ARCH-134, ARCH-133, ARCH-123, REQ-139, REQ-067
- **files:** src/dashboard/lib/issues.js, src/dashboard/ui/issues.js, src/static-assets.ts, tests/unit/dashboard-lib-issues.test.js, tests/acceptance/val-205-issues-tab.test.ts
- **des:** DES-217
- **dod:** `npx vitest run tests/unit/dashboard-lib-issues.test.js tests/unit/static-assets.test.ts` → `safeIssueHref` returns `null` for `javascript:alert(1)`, `data:text/html,…`, `http://evil.example/` and a relative path, and returns the string unchanged for `https://github.com/…` (`https:` ONLY, parsed via `new URL` inside a try, total — never throws). Then `RWE_REQUIRE_BROWSER=1 npx vitest run tests/acceptance/val-205-issues-tab.test.ts` → REQ-067 does not regress (`/api/issues` answering its token-missing 200 `{degraded}` still shows the degraded TEXT, not a blank), Open/Resolved still partition, a row still expands and still links out, and the tab's tag/list/detail use the v27 component classes with no visual gap against the other three tabs in BOTH `data-theme` values (two screenshots recorded as REQ-139's own evidence, since this tab has no design page).
- **estimate:** M
- **iter:** v28
- **closeout (2026-09-18, missing-IMPL-trail sweep):** covered by IMPL-290; DoD re-run green today: `npx vitest run tests/unit/dashboard-lib-issues.test.js tests/unit/static-assets.test.ts` → 11/11, then `RWE_REQUIRE_BROWSER=1 npx vitest run tests/acceptance/val-205-issues-tab.test.ts` → 4/4.

### TASK-225 — the server's whole v28 footprint: one literal, and the DEPLOY line that owns its consequence
- **status:** done
- **traces:** ARCH-135, ADR-057, REQ-138
- **files:** src/server.ts, DEPLOY.md, tests/integration/dashboard-http.test.ts
- **des:** DES-218
- **dod:** `npx vitest run tests/integration/dashboard-http.test.ts` → green with `GET /api/system` returning up to **20** `process.topN` rows (was 5) while the MCP `system_info` tool keeps its own default of 5 and its 1-50 argument (`tool-specs.ts:999-1004`), and `grep -n "topN" src/server.ts` shows **literals only** — no value derived from the URL, no `?topN=` (ARCH-135's refusal: `SystemInfoSampler.get()` applies `topN` at SHAPE time over the cached snapshot, `system-info.ts:256-290`, so a different constant per caller is free). One DEPLOY.md line lands in the same commit stating the consequence rather than hiding it: with `bind: 0.0.0.0` this unauthenticated route now publishes 20 host process rows instead of 5, bounded to `comm` only — never argv, cwd, env or uid.
- **estimate:** S
- **iter:** v28
- **closeout (2026-09-18, missing-IMPL-trail sweep):** covered by IMPL-291; DoD re-run green today: `npx vitest run tests/integration/dashboard-http.test.ts` → 15/15; `grep -n "topN" src/server.ts` shows one literal (`:375`); `DEPLOY.md`'s consequence line confirmed present (`git show 9e10453 -- DEPLOY.md`).

## v28b — the Gate 7.5 send-back slice (REQ-143's per-route disclosure · ARCH-132) — TASK-226

### TASK-226 — the 「此路由無示範資料」 disclosure: one string key, three view arms, each naming its own route
- **status:** done
- **closeout (2026-09-18, missing-IMPL-trail sweep, 4th occurrence):** covered by IMPL-301; DoD re-run VERBATIM, in one invocation as written (not the orchestrator's split runs): `RWE_REQUIRE_BROWSER=1 npx vitest run tests/acceptance/val-207-demo-data.test.ts tests/unit/demo-surface.test.ts tests/unit/dashboard-seam.test.ts tests/unit/dashboard-lib-strings.test.js` → 4 files / 23 tests, all green (61.98s wall clock), including the widened THIRD case (System tab counts card, DES-220 B7) and both recovery cases. `src/dashboard/lib/strings.js:40,51` — `noDemoData` is the exact colon-terminated prefix in both languages. Each call site verified appending its OWN literal route: `workflow.js:420` → `/api/workflows/:name/describe`, `issues.js:127` → `/api/issues`, `system.js:278-279` → `/api/workflows` gated on `tick.source === 'demo'` inside `paintCountsUnavailable`'s one caller (`system.js:232` gains the one `text` parameter). `git show bdf36f4 --stat -- src/ tests/` shows exactly the 8 files on this card's `files:` line, nothing else (`dashboard.css`/`server.ts`/`demo/dataset.js`/config untouched). `npx tsc --noEmit` exit 0. Full DoD PASSES.
- **traces:** ARCH-132, ARCH-123, REQ-143
- **files:** src/dashboard/lib/strings.js, src/dashboard/ui/workflow.js, src/dashboard/ui/issues.js, src/dashboard/ui/system.js, tests/unit/demo-surface.test.ts, tests/unit/dashboard-seam.test.ts, tests/unit/dashboard-lib-strings.test.js, tests/acceptance/val-207-demo-data.test.ts
- **des:** DES-220
- **dod:** `RWE_REQUIRE_BROWSER=1 npx vitest run tests/acceptance/val-207-demo-data.test.ts tests/unit/demo-surface.test.ts tests/unit/dashboard-seam.test.ts tests/unit/dashboard-lib-strings.test.js` → green on all four, INCLUDING Gate 5's two demo-miss acceptance cases (the `/api/workflows/:name/describe` arm and the `/api/issues` arm), **the widened v28b THIRD case (the System tab's counts card, DES-220 (4)/(B7))**, and the recovery case that proves no disclosure survives under a Live tag. `noDemoData` (`lib/strings.js`) is now a colon-terminated PREFIX (zh `'此路由無示範資料:'` / en `'No demo data for this route: '`); each of the three call sites appends its OWN literal route — `/api/workflows/:name/describe` (workflow.js), `/api/issues` (issues.js), `/api/workflows` (system.js's `paintCountsUnavailable`, gaining a `text` parameter and a `tick.source === 'demo'` check in its ONE caller) — so `[data-legend]`/`#issues-open`/`#issues-resolved`/the counts-card value each assert the FULL prefixed-and-routed sentence, not the bare prefix. The fault must stay the file's existing REAL one (`server.close()` + re-`listen()` on the same port); `page.setRequestInterception` is forbidden in this file (DES-212 — an HTTP-error storm is REQ-131's Offline case, val-198's). Also in this commit: `PRODUCTION_ALLOWLIST` in `demo-surface.test.ts` grows by `ui/workflow.js` + `ui/issues.js` + `ui/system.js` (DES-220's `tests:` clause says why this is designed growth, not leak-hiding). The System tab's other three cards (CPU/memory/disk) and DES-215/216's own per-section degrade are UNTOUCHED — the only system.js diff is the one new parameter and the one new branch. Nothing in `src/dashboard/dashboard.css`, `src/server.ts`, `src/dashboard/demo/dataset.js` or any config file is touched — `git diff --stat` must show exactly the files above.
- **estimate:** S
- **iter:** v28

## v33 — REQ-201: the version loop is advertised where a cold client actually reads (TASK-227)

### TASK-227 — the register response carries `versions`/`channels`; two tool descriptions and the guide section teach the loop
- **status:** done
- **traces:** ARCH-091, ARCH-087, ARCH-107, REQ-201
- **files:** src/mcp-facade.ts, src/tool-specs.ts, src/authoring-guide.ts, docs/AUTHORING.md, tests/integration/register-version-loop.test.ts, tests/unit/tool-specs.test.ts, tests/unit/authoring-guide.test.ts
- **des:** DES-222
- **dod:** `npm run gen:authoring && npx vitest run tests/integration/register-version-loop.test.ts tests/unit/tool-specs.test.ts tests/unit/authoring-guide.test.ts tests/unit/authoring-md-generated.test.ts tests/unit/tool-schema-drift.test.ts tests/integration/guide-examples-register.test.ts && npx tsc --noEmit` → green on all of: (1) over REAL MCP HTTP against a booted `createServer()`, `workflow_register({name:'x',…})` answers `result.versions === ['v1']` and `result.channels` deep-equals `{release: null, beta: null}`; then `workflow_publish(x,'v1','release')`; then a SECOND `workflow_register` of the SAME name answers `result.versions === ['v1','v2']` **and** `result.channels.release === 'v1'` (the new version did NOT take over the pointer) — plus a refused registration (`MERMAID_REQUIRED`) still answering `{status:'failed', code}` with NO `result` key; (2) `projectToolsList()`'s `workflow_register` description states that re-registering the same name appends a version and overwrites nothing, and its `See also: workflow_authoring_guide` line is still present (it is derived, not re-typed); (3) `projectToolsList()`'s `run_start` description mentions `{version}` at a LOWER index than `workflow_publish` (an order assertion, not a substring one) and still carries the "starting a run returns no result — poll `run_status`, then `run_result`" trap; (4) `buildAuthoringGuide(...)`'s `Registration and versioning` section opens with the four-step loop in order and STILL contains `LEGACY_REREGISTER`, the omission-does-not-release sentence and the assets-shared-across-versions sentence; (5) `docs/AUTHORING.md` byte-equal to the regenerated builder output (UT-160). No file outside `files:` is touched — `git diff --stat` must show exactly that list.
- **estimate:** M
- **iter:** v33

## v34 — REQ-202/203/204: the prompt/model/tool layer a remote author cannot write is deleted (TASK-228..230)

Three tasks, and the split is forced by `tsc`, not by taste. TASK-228 is genuinely independent
(two files nobody else touches this iteration). TASK-229 is ONE task because
`composePrompt(def?.systemPrompt, req.runParams.prompt, …)` names ARCH-137's `def` and ARCH-140's
`RunParams.prompt` in one expression, `AGENT_OPT_KEYS: Record<keyof AgentOpts|'prompt', true>`
turns the `AgentOpts.agentType` deletion into a compile error in `workflow-meta.ts`, and
`composeConfig` forwards `agentDefinitionsDir` into `ServerConfig` — any split leaves the repo red
on both sides of the seam, and this project treats `tsc` as the first test (DES-192). TASK-230 is
the byte-locked text trio and lands immediately after TASK-229.

### TASK-228 — `workflow_describe` publishes the bound it already computes, and the appendPrompt refusal names the same word
- **status:** draft
- **traces:** ARCH-136
- **files:** src/workflow-view.ts, src/params/contract.ts, tests/unit/workflow-describe-projection.test.ts, tests/unit/params-contract.test.ts
- **des:** DES-223
- **dod:** `npx tsc --noEmit && npx vitest run tests/unit/workflow-describe-projection.test.ts tests/unit/params-contract.test.ts tests/unit/workflow-view.test.ts tests/unit/workflow-describe-facade.test.ts tests/integration/workflow-describe-http.test.ts` → green on all of: (1) `projectAgentParams` emits `unit:'bytes'` on `appendPrompt` and on NO other key, and emits `ceiling` on whichever key carries `ceilingKey` (so `timeoutMs` gets it too when the engine ceiling won — the spread is generic, not gated to `appendPrompt`); (2) the five `boundMax` rows of DES-223 (author<ceiling → no `ceiling`; author>ceiling → `ceiling` + `range.max`=ceiling; author **==** ceiling → `ceiling` PRESENT; author declares no `max` → `ceiling` present; a stored non-number `max` → same as no `max`); (3) the appendPrompt over-size refusal's MESSAGE names the engine ceiling iff `detail.ceiling` is present and says `exceeds the maximum of N` otherwise — one assertion locking message and detail together; (4) `detail.maxBytes`/`suppliedBytes` and the `FRAME_CLOSE_FORGERY` branch are UNCHANGED. Also in this commit: the three stale comment lines in `contract.ts` that narrate the retired `agentType` rung (`:17`, `:20`, `:51`) are corrected — this task owns that file, so the grep checklist in TASK-229's DoD comes back clean for it. No file outside `files:` is touched — `git diff --stat` must show exactly that list.
- **estimate:** S
- **iter:** v34

### TASK-229 — the cut: one commit deletes the `agentType` mechanism, `defaults.prompt`/`tools`, and the config key, and keeps two fail-closed properties
- **status:** draft
- **traces:** ARCH-137, ARCH-138, ARCH-139, ARCH-140
- **files:** src/agent-definitions.ts (deleted), src/agent-executor.ts, src/params/resolve.ts, src/types.ts, src/run-manager.ts, src/server.ts, src/main.ts, src/workflow-meta.ts, src/workflow-catalog.ts, src/gateway/claude-agent-sdk-client.ts (comments only), src/dashboard/lib/agent.js, src/dashboard/ui/agent-panel.js, tests/fixtures/dashboard-wire.ts, tests/unit/compose-config-v2-wiring.test.ts, tests/unit/dashboard-lib-agent.test.js, tests/unit/strip-first-segment.test.ts (deleted), tests/unit/agent-executor-agent-type.test.ts (deleted), tests/integration/agent-type-composition-root.test.ts (deleted), tests/integration/main-composition-root-agent-types.test.ts (deleted), tests/unit/agent-executor-harness-descriptor.test.ts, tests/unit/agent-opts-unknown-key.test.ts, tests/unit/params-resolve.test.ts, tests/unit/agent-executor-params.test.ts, tests/unit/agent-executor-allowed-tools.test.ts, tests/integration/agent-log-harness-shape.test.ts, tests/integration/dashboard-disclosure.test.ts, tests/integration/resume-legacy-params.test.ts, tests/integration/redact-sweep.test.ts, tests/acceptance/val-003-agent.test.ts, tests/acceptance/val-100-param-contract.test.ts, tests/acceptance/val-201-agent-panel.test.ts
- **des:** DES-224, DES-225, DES-226, DES-227, DES-228
- **dod:** `npx tsc --noEmit && npx vitest run` → **the WHOLE suite green in one commit** (a partial run hides exactly the breakage this task's atomicity exists to prevent), including: (1) the five `composePrompt` goldens of DES-225 reproduced byte-for-byte by the 2-arg function, case 5 (empty `scriptPrompt` → leading `\n\n`) pinned as-is, not tidied; (2) an integration test asserting the PERSISTED `descriptor.prompt` equals `composePrompt(script, append)` byte-for-byte for a no-`schema` dispatch under the 2048 `capPrompt` bound, plus a second case with a `schema` asserting `startsWith(composePrompt(…))`; (3) a legacy pre-v34 harness row (`tests/fixtures/dashboard-wire.ts`, repurposed as `HARNESS_LEGACY_PRE_V34` per DES-225 — NOT deleted) read back through `deriveAgentRecords` and the dashboard projection with no crash and with the retired disclosure line ABSENT; (4) a pre-v34 pinned script carrying `agentType:` dispatched → the run reaches a failed terminal state whose PER-AGENT RECORD `detail` STRING names the v34 retirement and points at `workflow_authoring_guide` (DES-226's literal wording), observable through `workflow_status` — not merely a unit-level throw. **Corrected 2026-09-20 (tests gate, TASK-229 DoD item (4)):** this item previously claimed the run-level coded error's `detail.violation:'AGENT_OPT_RETIRED'` object is what `workflow_status` surfaces; it is not — `run-manager.ts`'s `toErr()` keeps only `{code, message}` off a caught error and drops the thrown error's `.detail` object entirely, so that structured marker never reaches `mgr.status()`'s run-level `error` at all. What IT-176 actually asserts and passes is the STRING carried on the per-agent record's own `detail` field (set by `_sink.capture` before the throw, per DES-226's "RECORDED then THROWN" rule) — that string is what is observable through `workflow_status` today. UT-273 separately pins the thrown object's `detail.violation:'AGENT_OPT_RETIRED'` field directly at the unit level, which is real and correct, just not run-level-observable. **Deliberately not fixed here:** widening `toErr()` to forward `.detail` so the structured marker becomes run-level-observable too is ROUTED TO v35 (failed-run error observability), where error envelopes are the subject and it gets its own REQ/DES/test — not smuggled into this task's DoD untested; (5) `workflow_register` of a script carrying `agentType:` → `SCAN_VIOLATION` with `detail.violation:'AGENT_OPT_RETIRED'` and `detail.key:'agentType'` (DES-224); (6) `composeConfig({graphAnalyzer, agentDefinitionsDir, typo}, {listen:false})` emits exactly ONE `console.warn` naming all three with a retirement note on the two retired ones and none on the typo, and the engine boots (DES-227); (7) `tests/unit/compose-config-v2-wiring.test.ts`'s exclusion list drops `agentDefinitionsDir` in THIS commit; (8) a legacy params row carrying a `tools` key is refused `LEGACY_REREGISTER` on resume (DES-228) while the existing `.agents`-present and `.agents`-absent cases in `resume-legacy-params.test.ts` behave exactly as before. **Evidence line, pasted into the impl log, not a test:** `grep -rn agentType src/ docs/` (56 hits before the cut, across 13 files) returns only intentional historical references afterwards — `tsc` cannot see a comment. Expected residuals, so a literal reading of this line is not read as a miss: **until TASK-230 lands**, `tool-specs.ts:614`, `authoring-guide.ts:531` and `docs/AUTHORING.md` (they are TASK-230's files — do NOT edit them here); **permanently**, `types.ts:530`'s stored-shape `provenance` union, which keeps admitting `'agentType'`/`'call'` for pre-v24 rows on purpose (INV-V34-3). Everything else must go, including the five comment-only hits in `claude-agent-sdk-client.ts`. **Checked at design time so nobody hunts:** `tests/unit/gateway-client-stop.test.ts` and the three `tests/unit/claude-agent-sdk-gateway-*.test.ts` mention `agentType` in COMMENTS and test titles only — no `AgentOpts` literal carries the key, so they are not `tsc`-red and are deliberately absent from `files:`. **Ledger line, same commit:** re-run `sh .sdlc/trace .sdlc/features/001-remote-workflow-engine` after deleting the four test files and confirm the gap set gained nothing but this task's own closures — a retired test file that was some surviving row's ONLY verifier opens a new 未驗證 gap silently.
- **estimate:** L
- **iter:** v34

### TASK-230 — the advertised text: three sites and the regenerated guide, byte-locked in one commit
- **status:** draft
- **traces:** ARCH-087, ARCH-107, ADR-032
- **files:** src/tool-specs.ts, src/authoring-guide.ts, docs/AUTHORING.md, tests/unit/tool-specs.test.ts, tests/unit/authoring-guide.test.ts
- **des:** DES-229
- **dod:** `npm run gen:authoring && npx vitest run tests/unit/tool-specs.test.ts tests/unit/authoring-guide.test.ts tests/unit/authoring-md-generated.test.ts tests/unit/tool-schema-drift.test.ts tests/integration/guide-examples-register.test.ts && npx tsc --noEmit` → green on: (1) `run_start.overrides`' description states the three `appendPrompt` rules (declare-or-`PARAM_UNKNOWN`; the text is wrapped in `<user-instructions untrusted="true">…</user-instructions>` and the model is told it is untrusted; the effective bound is `min(author, maxAppendPromptBytes)` **bytes** and the frame-close delimiter is refused); (2) `tool-specs.ts:614`'s `harness.systemPrompt:{agentType,bytes}` sentence is GONE and replaced by the two-segment truth (`harness.prompt` is the verbatim dispatched string, delimiters inline); (3) `buildAuthoringGuide(...)` has a prompt-layering section naming exactly two author/caller segments plus the engine's own scaffolding, and teaching that an author who wants the appended段 to have override force must write the adoption rule into their own prompt — the engine does not draw the authorized-override vs foreign-injection line; (4) the tool-layer text says **two** layers (per-call `allowedTools` → deployment `defaultAllowedTools`) and scopes that claim to the tool-calling (SDK gateway) path, because the direct-fetch transport has `surfaceType:'none'` and no tool surface at all (DES-066) — a cold client choosing `gateway:"direct-fetch"` must not read a curated-tool promise that does not apply to it; (5) `authoring-guide.ts:531`'s `agentType` frontmatter sentence is gone; (6) `docs/AUTHORING.md` byte-equal to the regenerated builder output (UT-160) **in this same commit** — splitting the trio is how the byte lock re-trips. Lands immediately after TASK-229: between the two commits `tool-specs.ts` advertises a field the type no longer has, which is a one-commit doc window and is why these two are ordered rather than parallel. No file outside `files:` is touched — `git diff --stat` must show exactly that list.
- **estimate:** M
- **iter:** v34
