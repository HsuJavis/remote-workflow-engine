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
