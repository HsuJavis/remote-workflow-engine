---
lens: quality-dimensions (observability / replaceability / consumability / self-sustainability)
stage: design (v3 slice — REQ-016..021 / ARCH-015..019 + three v1/v2 amendments D-DOS, D-BIND, D-PROC)
round: r1 (independent proposal — refresh incorporating ARCH-019 WorkRoot guard added in synthesis)
prior: quality-dimensions.v2.r1.md (v2) → the v3 proposal previously at this path is superseded by this refresh
---

# Quality-dimensions review — Design stage, v3 slice (Remote Workflow Engine)

## Altitude judgment

From `tech_stack` and REQ-001..021 this project is **both** a plain system and an AI-agent system, and
the split is not incidental — it is load-bearing for this lens. Apply both altitudes, segregated per
module:

- **System altitude:** ARCH-015 (MCP Provisioning Registry), ARCH-016 (Secret Store), ARCH-019
  (WorkRoot Project-Isolation Guard), D-BIND (loopback guard), D-PROC (subprocess lifecycle),
  ARCH-001..008 (v1 kernel, not reworked but amended). These are conventional trusted-parent modules:
  store/config/process engineering with injectability as the quality lever.

- **Agent altitude:** ARCH-017 (SDK Session-Options Builder + outer timeout race), ARCH-018
  (asset-ingestion policy), and the v3 amendments to ARCH-004 (Agent Executor). The builder decides
  what the agent runtime sees — thinking mode, curated tool surface, injected-MCP set, resolved
  secrets — for **non-Anthropic models running the full harness**. This is the v3 slice's center of
  gravity for all four dimensions.

- **ARCH-019 straddles both:** the boot guard is system-altitude; the `cwd`-outside-project invariant
  it enforces is agent-altitude (session-init confinement, not a tool-call-level check).

---

## Summary

The v3 architecture makes the right structural choices — pure builder, ProviderProfile config table,
single `AgentTranscriptSink`, typed reason-code taxonomy, global RunGuard semaphore, kill-on-timeout
not abandon. My role at this stage is to turn those correct architectural decisions into *specific
design contracts* that survive implementation.

Five clusters dominate this proposal:

1. **SessionInitRecord and FailureEnvelope must be persisted as queryable typed records**, not log
   lines. The distinction matters at Gate 7.5: forensic `ps aux` reconstruction is not "observable."
2. **The semaphore must have a gauge and a single idempotent release site** — a process-global
   resource with no observable state is the canonical silent-failure scenario my lens exists to
   prevent.
3. **ARCH-019 adds a new observable-failure mode**: `WORKROOT_INSIDE_PROJECT` at boot is correct
   design, but the error must name the offending path, be testable with a no-real-filesystem UT, and
   not prevent the engine from booting healthy on a correctly configured host.
4. **The typed error taxonomy must be one enum, one owner** — three independent places minting
   reason-codes will diverge by Gate 6.
5. **Task-splitting must keep pure and impure halves separate** at every seam or the cheap-UT
   economics of the pure builder dissolve.

---

## (1) Observability — internal state transparent, end-to-end followable

### System altitude

**O-1 (SessionInitRecord: persisted, typed, reachable through an existing MCP surface).**
ARCH-017 says the builder writes one `SessionInitRecord`. The design must specify three things the
architecture left open:

- *Where it persists*: prepend it as the first entry of the existing `agent-<id>.jsonl` via the
  existing `AgentTranscriptSink`. One writer path, no new file kind, survives restarts, replayed by
  resume for free, included in the existing retention/cleanup scope (REQ-013).
- *Its TypeScript type*: an exported `SessionInitRecord` interface with fields:
  `resolvedAlias→provider+modelId`, `thinkingMode` (enabled/disabled), `allowedToolNames: string[]`,
  `injectedMcpNames: string[]`, `secretHandleNames: string[]` (NEVER values), `cwd: string`,
  `timestamp: number`. Unit-snapshot-tested so a field rename is a CI failure, not a silent contract
  break.
- *Which MCP tool returns it*: `workflow_agent_log(runId, agentId)` returns it as the transcript
  head; `workflow_status` per-agent entries carry `resolvedProvider`, `resolvedModelId`, and
  `thinkingMode` (already promised by REQ-007 + REQ-016-c3). A stored-but-unreachable record is a
  black box with extra steps.

**O-2 (FailureEnvelope: persisted into AgentRecord and surfaced in the caller-visible surface).**
The envelope `{kind: ReasonCode, attempts: number, elapsedMs: number, providerDetail?: string}` must:

- Be persisted into the `AgentRecord` in RunStore (not only logged), so `workflow_status` per-agent
  entries show `failureEnvelope` when `state === 'failed'`.
- Draw `kind` from the SINGLE `ReasonCode` union (see C-1 below) — two parallel enums for one
  concept will drift before the ink dries.
- Have `providerDetail` redacted at the `AgentTranscriptSink` write boundary if it contains any
  resolved secret value (unlikely for a provider error message but designed away by construction,
  not assumption).

**O-3 (Terminal agent states for the kill path — REQ-020 verifiability requirement, not cosmetic).**
Before v3, an agent interrupted by suspend/stop staying `state:'running'` was a cosmetic backlog
item. With D-KILL making kill-on-timeout a designed, frequent execution path (every hung provider,
every scheduled overnight run), phantom `running` agents accumulate at exactly the times nobody is
watching. Design: add `aborted` (suspend/stop path) and let `FailureEnvelope{kind:'PROVIDER_TIMEOUT'}`
transition to `failed`. This is 1 enum value + 2 state-machine transitions. REQ-020's "bound
observably applied" is unverifiable if the record never transitions.

**O-4 (Semaphore gauge — D-DOS creates one process-global scarce resource; its state must be
observable).**
Include `semaphoreGauge: {total, inUse, queued}` in the `workflow_status` response or a `server_status`
field the dashboard already polls. Without it, semaphore starvation (any missed release on an error
path) presents as "everything hangs, no error anywhere" — the textbook silent failure. The gauge also
makes the D-KILL release invariant *testable*: assert gauge returns to baseline after a timeout-kill.

**O-5 (Boot log enumerates the new v3 items alongside the existing run-rehydration log).**
ARCH-006 already emits one log line per re-hydrated run at boot. v3 boot should likewise enumerate:
provisioned-MCP names (count + names), secret-handle names (names only — D-REDACT), and the
outcome of the ARCH-019 workRoot ancestor walk (`workRoot: /data/rwe, no project marker found →
boot proceeds` OR the typed error). A misconfigured deployment must be diagnosable from the boot log
alone without attaching a debugger.

### Agent altitude

**O-6 (Native tool_use round-trip visible in the transcript for non-Anthropic models).**
REQ-016-c2 says the round-trip is "observable in the per-agent transcript." The `AgentTranscriptSink`
taps the SDK message/event stream; design must confirm `tool_use`/`tool_result` blocks from
non-Anthropic models (translated through LiteLLM) land in `agent-<id>.jsonl` in a canonical shape.
If LiteLLM normalizes event types differently, the sink is where to normalize — once, not in every
downstream consumer. The real-Ollama integration test should assert on the *persisted transcript*,
not on stdout, so the observable and the verified artifact are the same thing.

**O-7 (Per-attempt token attribution; budget must not silently rot under kill).**
D-KILL requires that a killed/timed-out attempt's partial token usage (if any usage event arrived
before the kill signal) still posts to the budget and to the per-agent usage in `workflow_status`.
Design the gateway to emit usage deltas as they stream, before final settlement. This closes the
"REQ-020 passes its test while budget silently rots" hazard. Carried finding: the in-script
`budget.spent()/remaining()` accessors are still stubs; v3 must not widen the gap between script-
visible and server-truth accounting — at minimum, document the gap as a known limitation in the
design doc so it is not accidentally "fixed" by feeding fake numbers through the IPC seam.

**O-8 (Redaction at the capture boundary — one choke point, property-tested).**
D-REDACT lands in ARCH-016. Design it as a **single redaction function applied at the
AgentTranscriptSink write boundary**: `redact(event, resolvedSecretValues) → event`. Property test:
"no resolved secret value in any persisted artifact." Handle names are loggable (that is what keeps
the system diagnosable after redaction). This is not redundant with ARCH-016's filesystem-containment
callback — that callback catches agent *tool calls* trying to read secret-bearing files; the
transcript-sink redaction catches secrets that flow into the *event stream itself* (e.g. via a
stdio-MCP child's argv appearing in an SDK message). Both are needed; neither substitutes.

---

## (2) Replaceability — decoupling & pluggability

### System altitude

**R-1 (Ports won at Gate 2 — hold the line and clarify signatures).**
`SecretResolver`, `RunStore`, `GatewayClient`, `McpProbe` ports are established. v3 design task:
state each port's **synchronous vs asynchronous contract explicitly** in 04-design.md. `SecretResolver`
in particular should be synchronous `resolve(handle) → string | throw` over a pre-loaded map —
an async-resolve signature silently invites a network vault call into the hot-path session build
and violates the pure builder contract. Loading from env/`LoadCredential` is a *separate* startup
step that populates the map; the resolver itself is pure.

**R-2 (SDKOptions must not leak through `GatewayClient.invoke(prompt, opts)`).**
ARCH-017 lives inside the GatewayClient impls. Design should state the `invoke` opts type explicitly
and assert — at the TypeScript module boundary — that nothing SDK-specific (`thinking`,
`allowedTools`, `strictMcpConfig`, MCP config objects) appears in it. This preserves D2 replaceability:
swapping the agent-execution engine someday is still an impl change inside one GatewayClient, not an
ARCH-004 rewrite.

**R-3 (ARCH-019 WorkRoot guard is a fixed control, not a strategy to inject — and that is correct).**
The guard's `isProjectRoot(path)` predicate (walk ancestors for `.git`/`CLAUDE.md`) should be an
injected function for testability (see S-3 note), but the *guard itself* is not pluggable. That is
correct: the security property must not be switchable per-config. Design should state this explicitly
so no future "allow-inside-project" flag is added without reopening REQ-021.

### Agent altitude

**R-4 (ProviderProfile is the agent-altitude replaceability deliverable — keep it data, boot-
validated, single-sourced).**
The D-F6 defect (unconditional `think:true` → Ollama 400) is exactly the class of bug a flat
capability table retires. Design asks:

- Flat config rows per alias: `{supportsExtendedThinking: boolean, timeoutMs: number, retries: number,
  effortMapping: Record<string,string>}`. Validated at boot with ajv (already in-tree) against a
  schema — a typo'd profile field must fail boot with a clear `CONFIG_SCHEMA_ERROR`, not silently
  produce SDK defaults.
- **Every field names its consumer in 04-design.md**: `supportsExtendedThinking` → builder's thinking
  flag; `timeoutMs/retries` → outer race; `effortMapping` → open `effort`-mapping question. A field
  with no named consumer is cut (concession to simplicity). Specifically: `supportsToolUse` has no
  consumer I can find (the curated allowlist applies regardless of provider class) — cut it unless
  the submission validator needs it for a warning.
- The alias validator (ARCH-008) and the builder read the **same table instance** — two copies of
  capability knowledge is how D-F6 recurs.
- Fail-safe default for an unprofiled alias: `supportsExtendedThinking: false`. An unknown alias
  should ideally be caught by ARCH-008 at submission (`ALIAS_PROFILE_MISSING`); if it reaches the
  builder, the default must not cause a 400 on a non-reasoning model.

**R-5 (Pure builder is the replaceability and testability master seam — keep it dependency-free).**
`(providerClass, alias, config, provisionedRefs, resolvedSecrets) → SDKOptions` must import no
`fs`/`net`/`process` module. Everything the Gate 7.5 round 3 forensics found the hard way
(thinking flag, missing timeout race, model not forwarded) becomes a table-driven pure UT. Design
must state purity as a stated invariant with a dedicated UT that runs the builder with a frozen
input map and asserts determinism — if the builder ever reads `process.env` "for convenience", the
master seam rots.

---

## (3) Consumability — interface friendliness, low integration cost

### System altitude

**C-1 (ONE typed error surface — single `ReasonCode` union, one owner, contract-tested).**
Three independent places will mint error identifiers without this: the submission validator (ARCH-008),
the FailureEnvelope in ARCH-017, and the MCP result envelope from ARCH-001. They will drift. Design:
one exported `ReasonCode` union type in one module (`types/reason-codes.ts` or similar) used by all
three. The contract test enumerates the union so a rename is a breaking-change decision, not an
accidental refactor.

The published taxonomy from D-REDACT plus v3 additions:
`MCP_NOT_PROVISIONED | MCP_PROBE_FAILED | SECRET_MISSING | SECRET_HANDLE_INVALID | HOOKS_UNSUPPORTED
| PROVIDER_TIMEOUT | ALIAS_PROFILE_MISSING | WORKROOT_INSIDE_PROJECT | CONFIG_SCHEMA_ERROR`

Finer internal distinctions (runtime-dead MCP, partial-secret resolution failure, schema retry
exhausted) live in `FailureEnvelope.kind/providerDetail` — kept out of the client-facing enum to
keep the branching surface small and stable for agent callers.

**C-2 (Fail at submission, not mid-run — extend ARCH-008, do not fork it).**
ARCH-015 already promises `MCP_NOT_PROVISIONED` at submission. v3 extends ARCH-008 to also check:
referenced `${secret:name}` handles resolve (without materializing the values — check handle
existence in the pre-loaded map, not the value); referenced agentTypes exist; ProviderProfile rows
exist for all referenced model aliases. A workflow that will die at agent #37 for a missing secret
dies at submission. All checks through the single ARCH-008 facade — one error shape, one moment.

**C-3 (`${secret:name}` handle syntax requires a spec in 04-design.md).**
Pin: the exact grammar (`${secret:<name>}` where `<name>` is `[A-Za-z0-9_-]+`); where handles are
legal (provisioned-MCP config values, provider alias config) and where they are inert and never
resolved (workflow scripts, pushed skills — constructively excluded, not filtered at runtime); what
happens to a handle that fails the grammar (`SECRET_HANDLE_INVALID`, never a silent pass-through).
One concrete worked example in DEPLOY.md §secrets is part of the admin-surface consumability
deliverable.

**C-4 (`mcp_provision` and sibling admin tools ship real JSON schemas on day one).**
The v1 C-1 finding (placeholder tool schemas) must not recur on v3 tools. `mcp_provision`, any
`secret_*` admin tools, and `workflow_trigger` get genuine parameter schemas in `tools/list` from
day one. Audience split: admin surfaces (provisioning, secrets, Python 3.11/3.12 constraint, bind
guard, workRoot placement) → DEPLOY.md; agent-caller surfaces (error-code taxonomy, null semantics
from `agent()`, submit→poll unchanged) → ARCH-013 guidance skill v3 amendment.

**C-5 (ARCH-019 operator-facing error must be instantly actionable).**
`WORKROOT_INSIDE_PROJECT` boot error design: emit the full offending ancestor path, the type of
project marker found (`.git` vs `CLAUDE.md`), and the exact remediation step ("set `workRoot` to a
directory with no `.git` or `CLAUDE.md` ancestor, e.g. `/data/rwe-workspaces`"). One-liner in
DEPLOY.md §workRoot-placement. An opaque boot failure on a first deployment is a consumability
defect — the operator has no debugger attached.

### Agent altitude

**C-6 (The workflow-script contract stays boring — `agent()` still resolves string | object | null).**
v3 adds no new script-visible API. The FailureEnvelope explains `null` **out-of-band** (status API,
dashboard, log), never as fake success text in-band (REQ-020 second clause). Design must say this
explicitly so no task "helpfully" returns error prose to the script and silently breaks compat with
existing workflows.

---

## (4) Self-sustainability — closed-loop autonomy, lifecycle management

### System altitude

**S-1 (Global semaphore: design the release invariant and queue policy, injectable for tests).**
D-DOS's semaphore is only as good as its guaranteed release on **every** exit path. Design:

- Slot acquire/release wrapped in one `withSlot(fn)` construct with `try/finally` so every exit
  path — success, FailureEnvelope, kill, suspend, stop — releases the slot. There must be ONE
  release site, idempotent (guard flag prevents double-free on the race between the timeout branch
  and the query-settle path).
- Explicit queue policy: FIFO is fine; document that a single greedy `parallel()` can queue-starve
  other runs — acceptable single-node behavior, but *documented* rather than discovered.
- The semaphore is an injected instance (constructed once at the composition root, passed by
  reference) — never a `static`/module-level global. Same single object satisfies the "process-global
  rationing" contract while remaining injectable and resettable in tests. UT: build with max=1, assert
  gauge returns to 0 on every branch (success, timeout-kill, stop, suspend).
- Gauge per O-4 above.

**S-2 (Kill the process group, not only the CLI child — D-PROC's orphan threat applies one level down).**
The SDK CLI subprocess spawns N stdio-MCP children per session. A `child.kill()` on timeout orphans
those grandchildren — recreating the orphan-litellm pathology D-PROC fixes, at higher volume under
the v3 scheduler. Design: spawn the CLI detached in its own process group (Node.js `detached: true`)
and kill the group with `process.kill(-pgid, 'SIGTERM')` → SIGKILL escalation after a grace period.
This is one place where I ask for slightly more than the architecture note literally says ("kills
the CLI subprocess"), because the note's own threat model (orphans burning tokens/slots) applies
equally one level down.

**S-3 (D-PROC lands as designed: derived port, probe-before-use, shutdown tied to engine lifecycle).**
Three confirmed real defects: port-4000 collision (reproduced live twice), orphan litellm on restart,
`mkdtemp` config dir leak. Design details worth pinning:

- Port selection must be race-safe: bind port 0 and read the OS-assigned port, rather than
  "check-then-bind."
- The health probe gates the *first agent call*, not server boot — a slow proxy start degrades one
  run rather than failing the whole engine.
- SIGTERM→SIGKILL shutdown tied to the engine's own lifecycle signals (not a timer-based watchdog).
- Temp-dir cleanup (proxy config dirs, CLI session dirs) on the same path as kill/shutdown.
- Restart/auto-recovery stays with systemd/docker `Restart=on-failure` per D-PROC — no in-process
  watchdog. My lens's "safe without a human watching" requirement is satisfied by: supervisor
  restart + D-BIND fail-closed default + per-entry health-mark (S-4). Those three together mean
  a restarted server does not re-enter a bad state silently.

**S-4 (ARCH-019: boot fail-fast must be fail-closed AND must not block a correctly-configured deployment).**
The WorkRoot Project-Isolation Guard is a self-sustainability win: the MEMORY.md echo reproduced
empirically (2026-07-11) is precisely the "silent systemic failure nobody sees until too late" that
my lens exists to prevent. The design must be precise about two things:

- **Fail-closed on ancestor walk**: the check is `realpath(workRoot)`, then walk parents until the
  filesystem root, checking each for `.git` or `CLAUDE.md`. The comparison must use `existsSync`
  (synchronous at boot is fine and avoids race conditions); it must not short-circuit on non-existent
  dirs (a path that doesn't exist yet should not bypass the check).
- **No false positive on a plain data directory**: if `workRoot` has no project-marker ancestor,
  boot proceeds normally. The UT matrix must include both the positive (ancestor has `.git` → fail)
  and the negative (clean data dir → proceed) cases.
- The guard uses an injected `fsProbe: (path: string) => boolean` for the UT (avoids creating real
  `.git` dirs in tests). The impl is one function in `src/entrypoint/workroot-guard.ts`, not
  distributed.

**S-5 (Graceful degradation on stale registry entries — warn-at-boot, fail-at-use, never crash-on-bad-row).**
A provisioned MCP whose probe fails at boot, or whose secret handle no longer resolves, must not
crash the server: boot logs the defect (names only), marks the registry entry unhealthy, and a run
referencing it receives the typed error at submission. One bad registry row taking down every
scheduled workflow overnight is the anti-pattern. Per-entry degradation is the correct behavior for
a single-node background automation tool. No background re-probe (D-PROBE settled) — provision-time
and optional submission-time only.

**S-6 (Retention policy explicitly covers the new v3 artifacts).**
v3 adds SessionInitRecords and FailureEnvelopes into existing per-run `agent-<id>.jsonl` files (no
new file kind if O-1's proposal is accepted), killed-session temp dirs (S-2), and proxy-config
mkdtemp dirs (D-PROC). The REQ-013 documented retention/cleanup policy must enumerate all three
categories explicitly so a future cleanup implementation cannot miss them. One design-doc sentence
is sufficient — this is not asking for a new subsystem.

**S-7 (Tool liveness = the two designed probes; no background poller).**
Provision-time reject (`MCP_PROBE_FAILED`) and optional submission-time re-check are the right closed
loop for a single-node QM tool. No background polling (D-PROBE agreed). The submission-time re-check
is opt-in (a config flag, default: on) so an admin can disable it for expensive-to-probe MCP servers
without removing provision-time validation entirely.

### Agent altitude

**S-8 (Metabolism: context size of the agent session is not a self-sustainability risk at this scale).**
REQ-016..020 agents run within bounded run workspaces with a fixed tool surface (curated allowlist,
ARCH-017). Cross-run memory, prompt self-calibration, and transcript compression remain on the
not-built list and nothing in the current REQ set needs them. The one real v3 metabolism risk is
the kill-on-timeout path (S-1/S-2 above) — not context size.

---

## Risks

1. **HIGHEST: slot release invariant / orphan pair (S-1 × S-2).** If any exit path misses the slot
   release, or the kill misses stdio-MCP grandchildren, v3 converts a per-run nuisance into a
   creeping whole-server outage that manifests under the scheduler while nobody is watching.
   Mitigation is structural (`withSlot` try/finally + process-group kill), not test-only.

2. **SessionInitRecord/FailureEnvelope degrade to log lines.** If tasks do not pin persistence +
   query surface (O-1/O-2), REQ-016-c3 and REQ-020's observability clauses "pass" via console output
   that Gate 7.5 then has to forensically reconstruct with `ps aux`. The design must encode what
   validation already proved it needs.

3. **Taxonomy drift (O-2 / C-1).** Three independent places mint error identifiers without a single
   `ReasonCode` union. They will diverge by Gate 6 under parallel implementation. Design must own
   the union centrally.

4. **Redaction implemented as call-site discipline rather than one choke point (O-8).** One missed
   interpolation of `providerDetail` into a transcript string leaks a provider key into the dashboard.
   Structural solution: single `redact` function at the `AgentTranscriptSink` write boundary.

5. **Phantom `running` agents (O-3).** Cosmetic in v1; systematic and hard to clean up once
   kill-on-timeout is a designed path under the scheduler. One enum value + 2 transitions now; months
   of operator confusion if skipped.

6. **ARCH-019 false positive on a valid data directory.** A naive `existsSync('.git')` at the workRoot
   itself (without walking ancestors) both under-guards (ancestor has marker, immediate dir doesn't)
   and could in theory over-guard (an unusual but valid data directory layout). The guard must walk
   ancestors, nothing more, nothing less.

7. **Boot-fragility inversion (S-5).** Naive "validate registry at boot, throw on bad entry" is the
   easy implementation and the wrong one. It must be explicitly designed away in 04-design.md.

8. **Pure builder purity erosion.** A single `process.env` read inside the "pure" builder dissolves
   the whole slice's cheap-UT property silently. Purity must be a stated invariant with a UT that
   enforces it, not a review convention.

---

## Task-split guidance for the synthesizer (03-tasks.md does not exist yet)

Follow the v2 pattern: split each module along the pure ⟂ impure seam. Specific asks:

- **ARCH-017 → three tasks:** (a) pure builder + ProviderProfile table + validator wiring + fail-safe
  default (all pure UTs, exhaustive matrix: provider-class × thinking × allowlist × MCP refs × secret
  handles); (b) impure timeout-race + process-group kill + slot free-exactly-once over injected
  clock/spawn/semaphore; (c) one real-tier Ollama `tool_use` round-trip (VAL). Merging (a) and (b)
  forfeits the master seam.

- **ARCH-015 → two tasks:** (a) registry CRUD + typed errors + strict-MCP injection by name; (b)
  `McpProbe` wiring at provision.

- **ARCH-016 → two tasks:** (a) pure `resolveConfig` + `redact` (pure UTs: atomicity, redaction
  invariant); (b) env/`LoadCredential` source loader + filesystem confinement callback hardening.

- **ARCH-018 → one task:** pure asset-kind classifier (one UT per asset kind — hook → reject, MCP →
  redirect, skill → pass). Pure, small, done in one sitting.

- **ARCH-019 → one task:** workRoot guard + session-init cwd invariant (injected `fsProbe`; UT matrix:
  ancestor-has-.git → fail, clean-dir → pass, non-existent workRoot → fail). Owned at the
  boot/entrypoint layer, consumed by ARCH-017's session builder as a cwd precondition.

- **D-DOS / D-BIND / D-PROC → three separate amendment tasks, each with its own test.** Folding
  them into the host module's tasks is how amendments to "done" v1/v2 modules get lost. Each needs
  its own task so it has a test that must pass before it is marked done.

---

## Expected disagreements with other lenses

- **vs simplicity / Karpathy:** (a) O-3 terminal agent state will be called backlog scope creep —
  counter: D-KILL changes its class from cosmetic to a REQ-020 verifiability requirement; 1 enum
  value + 2 transitions. (b) O-4 gauge will be called speculative metrics — counter: it is the
  *only* observable for the new global resource D-DOS introduces, rides an existing API response, and
  makes the release invariant *testable*. (c) ProviderProfile field discipline (R-4) — I have pre-
  conceded `supportsToolUse` as cuttable, which should defuse most of this.

- **vs adversarial / security:** (a) They may want `SessionInitRecord` contents (allowlist, MCP names,
  secret-handle names) treated as disclosure on the unauth listener — my position: it lives in the
  store behind the same 127.0.0.1+tunnel boundary as everything else; D-REDACT already draws the line
  at *values* vs *names*. If they escalate, the compromise is redacting handle names from the
  dashboard only, never from the store. (b) They may prefer simple `child.kill()` over process-group
  kill (S-2) as less code — I expect to win on their own orphan-threat-model grounds. (c) They may
  prefer a stricter `mcp_provision` bind check — I hold D-BIND's existing resolution. (d) ARCH-019:
  they may want the workRoot guard to also prevent non-existent paths from booting at all (fail on
  missing dirs). I do not — a newly provisioned server should be able to boot before the workRoot dir
  is created, with a warning rather than a hard fail on a non-existent path; the guard's job is to
  reject project-marker ancestors, not to enforce directory existence.

- **vs consumability-maximalists / DX:** Someone may propose discovery endpoints (`secret_list`,
  `mcp_list`) for admin convenience. D-REDACT settled this against discoverability until auth lands;
  I hold that line even though it is "my" dimension being curtailed — clear typed errors to the
  trusted-behind-tunnel caller are sufficient before auth.

- **On task splitting:** the synthesizer may merge D-DOS/D-BIND/D-PROC amendments into their host
  modules' tasks. I want them as three visible amendment tasks with their own tests — amendments to
  "done" modules are precisely the ones that skip verification when invisible.
