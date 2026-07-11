---
lens: quality-dimensions (observability / replaceability / consumability / self-sustainability)
stage: design (v3 slice — REQ-016..021 / ARCH-015..019 + amendments D-DOS, D-BIND, D-PROC)
round: r2 (debate — responses to adversarial.r1.md; integrated final position)
prior: quality-dimensions.r1.md (my r1), adversarial.r1.md
---

# Quality-dimensions review — Design stage, v3 slice — Round 2

## What I read

Three r1 documents:
- `quality-dimensions.r1.md` — my own r1 (v3 slice, the active proposal)
- `quality-dimensions.v2.r1.md` — v2-era proposal; historical background only; no v3 re-litigation needed
- `adversarial.r1.md` — adversarial panel carrying interface-contract / boundary-error / testability /
  Karpathy simplicity

The adversarial r1 is the only proposal with live disagreements worth engaging. I address each of the
adversarial's eight ranked findings in order, then produce the integrated four-dimension proposal.

---

## Responses to adversarial.r1.md

**Adv-#1 — Slot free-exactly-once on kill path (double-free / never-free hazard).**
**CONCEDE AND INTEGRATE.** My S-1 already had `withSlot(fn)` try/finally as the single release site and
an idempotent guard flag. The adversarial adds a precision I missed: the timeout timer and the
`onExternalAbort` listener registered during the race must both be torn down in the same `finally`
block, or a settled-before-timeout call leaves a live timer that fires against a reused controller on
the *next* run. This is a real hazard; the fix costs one line. S-1 in this r2 adds explicit
timer-and-listener teardown to the `finally` inventory.

**Adv-#2 — Redaction races the transcript tap.**
**ALREADY ALIGNED.** My O-8 stated exactly this: `redact(event, resolvedSecretValues) → event`
applied at the `AgentTranscriptSink` write boundary before any `agent-<id>.jsonl` write. The
adversarial's formulation is identical. `SessionInitRecord` logs handle names only — never values.
Both proposals hold the same position. Nothing new to integrate; noting agreement so the synthesizer
need not adjudicate.

**Adv-#3 — ARCH-019 boot-only check re-opens REQ-021 at runtime (NEW, MED-HIGH).**
**CONCEDE AND INTEGRATE.** This is the most important new finding in the adversarial r1 and one I did
not raise in my own r1.

Mechanism: the boot guard checks workRoot ancestors once; an agent executing during a run can write
`CLAUDE.md` or `.git` into its run-workspace subtree; a subsequent `agent()` in the same run spawns
with `cwd` at that workspace and the Claude CLI's project-root resolution walks up from `cwd`, finds
the agent-authored marker, and loads it into the new agent's context — the exact REQ-021 channel,
below every tool-call jail, after boot has already cleared.

The adversarial's proposed fix is the minimum that makes the invariant true against a runtime-mutable
tree: at session-build time, re-run the *same* `findProjectMarkerAncestor(cwd, workRoot, existsImpl)`
predicate from the agent's run-workspace `cwd` up to (but excluding) workRoot. On a hit, refuse
the build with a typed error. This is not a new subsystem; it is the same one-function predicate
called at a second point in time. I accept it.

Residual question the adversarial raises correctly: does ARCH-016 confinement actually prevent an
agent writing *above* its run workspace into the per-workflow work folder (cross-run persistence)?
If yes, only the intra-run variant remains open (and the session-init re-walk closes it). If no,
the cross-run variant is also reachable and the risk escalates to HIGH. The design must state
ARCH-016 write-confinement-to-run-workspace as the load-bearing precondition that blocks the
cross-run variant; if that precondition is ever weakened, the intra-run re-walk alone is insufficient.
I adopt the adversarial's task placement: the session-init re-walk rides ARCH-017(a) (the pure builder
owns `cwd`/`settingSources`), reusing the `findProjectMarkerAncestor` predicate extracted in the
ARCH-019 task. No duplication of the walk; no new runtime subsystem.

**Adv-#4 — Fail-safe ProviderProfile default for unprofiled alias.**
**ALREADY ALIGNED.** My R-4 already stated: fail-safe default `supportsExtendedThinking: false` for
any alias with no profile row; ideally caught at submission (`ALIAS_PROFILE_MISSING`) before reaching
the builder. The adversarial holds the same position. Agreement; no new integration needed.

**Adv-#5 — ARCH-019 must use `realpathSync`, not `path.resolve`.**
**ALREADY ALIGNED — confirming.** My S-4 said "the check is `realpath(workRoot)`." The adversarial
correctly calls out `path.resolve` vs `realpathSync`: `path.resolve` only normalizes `.`/`..`,
it does NOT follow symlinks. A symlinked workRoot whose target lives inside a git repo passes
`path.resolve` while the CLI (operating on the real path) still climbs into the project. The fix
is `realpathSync(workRoot)` before the ancestor walk. My r1 intended this; I am now making it
explicit: the ARCH-019 task must use `realpathSync`, keep the fs-probe injected (so UTs can model
a symlink-into-project via a fake realpath impl), and the UT truth table must include the
symlink-to-project case. Consistent with ARCH-016's own realpath-based confinement.

**Adv-#6 — `isLoopback` predicate, not string equality on `'127.0.0.1'`.**
**CONCEDE AND INTEGRATE.** My r1 referenced D-BIND's loopback guard but did not specify the predicate
shape. The adversarial is right that `bind !== '127.0.0.1'` is simultaneously a false-reject (breaks
a `::1` IPv6 deploy) and a bypass avenue (foolable by `127.0.0.2` if fixed naively with prefix match).
Design requirement promoted from advisory to explicit: D-BIND's guard must use a proper
`isLoopback(bind)` predicate covering `127.0.0.0/8` and `::1`, with a truth table UT (loopback IPv4,
loopback IPv6, non-loopback IPv4, non-loopback IPv6 — all four cases). This is one small function,
one test; cost is negligible.

**Adv-#7 — Atomic secret resolution (all-or-nothing).**
**ALREADY ALIGNED.** My C-3 and the description of `SecretResolver` (R-1) both require fail-on-first-
bad-handle, nothing spawned on partial resolution. The adversarial's framing ("resolve whole or throw
`SECRET_MISSING`, nothing spawned, boundary UT proves it") matches my position. Agreement; no new
integration.

**Adv-#8 — `settingSources` regression-guard UT (REQ-021 guarantee silently coupled to never `'user'/'local'`).**
**CONCEDE AND INTEGRATE.** My r1 did not cover this. The adversarial correctly observes: the workRoot
guard prevents the project-context leak at session-init via `cwd`, but does nothing about a global
`~/.claude/CLAUDE.md` that loads if `settingSources` ever includes `'user'`. Today this is prevented
by a ternary (`settingSources: req.workspace !== undefined ? ['project'] : []`) — correct but
untested. A future edit adding `'user'` to pull in a user-global skill silently re-opens a leak the
workRoot guard cannot catch, with no CI signal. Fix: add one regression-guard UT in ARCH-017(a)
asserting the built `SDKOptions.settingSources` never contains `'user'` or `'local'` on any code path.
One assertion; the invariant is now machine-verified, not a ternary-convention.

**Adv-other: `mcp_provision` write authority stricter than the general listener.**
**PARTIAL CONCEDE.** The adversarial flags that RCE-provisioning write authority currently rests
entirely on network position (D-BIND loopback). My r1 held D-BIND's resolution (do not duplicate the
guard logic in the tool itself). On reflection, the adversarial's point is not redundancy — it is that
the tool should *explicitly refuse* when `bind != loopback` even if `insecureNoAuth:true` is set on
the general listener, because write authority deserves a stricter baseline than read. I concede this
narrowly: `mcp_provision` (and sibling write-authority tools: any `secret_*` setters) must check
`bind == loopback` at the tool handler level and return a hard error code if not, independent of the
general auth flag. This is one guard per write-authority tool handler, not a new subsystem, and it
closes an authority-escalation gap the network-position check alone cannot cover if D-BIND is
misconfigured. The distinction: D-BIND is the outer envelope (correct); the per-handler check is the
inner defensive layer for write-authority tools (added by this r2).

**Adv-other: runtime-dead MCP as a distinct failure mode from `MCP_NOT_PROVISIONED`.**
**HOLD (and agree on resolution).** The adversarial says it is acceptable but must be stated. I agree
with the stated resolution: a runtime-dead MCP surfaces as `FailureEnvelope{kind:'tool_error'}` →
`agent()` null (consistent with REQ-003). No new public reason code. The design doc must say so
explicitly so it is not mistaken for a silent no-op. Incorporate in C-1's taxonomy note.

---

## Integrated four-dimension position (r2)

### (1) Observability — internal state transparent, end-to-end followable

#### System altitude

**O-1 (SessionInitRecord: persisted, typed, query-surfaced — unchanged from r1).**
`SessionInitRecord` prepended as the first entry in `agent-<id>.jsonl` via the existing
`AgentTranscriptSink`. Exported TypeScript interface: `{resolvedAlias, provider, modelId,
thinkingMode, allowedToolNames: string[], injectedMcpNames: string[], secretHandleNames: string[],
cwd: string, settingSources: string[], timestamp: number}`. Handle names logged; values never logged.
`workflow_agent_log(runId, agentId)` returns it as the transcript head; `workflow_status` per-agent
entries carry `resolvedProvider`, `resolvedModelId`, `thinkingMode`. Unit-snapshot-tested so a field
rename is a CI failure.

**O-2 (FailureEnvelope: persisted into AgentRecord, surfaced in caller-visible status).**
`{kind: ReasonCode, attempts: number, elapsedMs: number, providerDetail?: string}` persisted into
`AgentRecord` in RunStore. `workflow_status` per-agent entries show `failureEnvelope` when
`state === 'failed'`. `providerDetail` redacted at the `AgentTranscriptSink` write boundary by the
same `redact` function (O-8). Runtime-dead MCP surfaces as `kind: 'tool_error'` in the envelope, not
a new public reason code, with a design-doc note so it is not misread as a no-op.

**O-3 (Terminal agent states for kill path — `aborted` state, 1 enum value, 2 transitions).**
`aborted` for suspend/stop paths; `FailureEnvelope{kind:'PROVIDER_TIMEOUT'}` transitions to `failed`.
With kill-on-timeout a designed execution path under the scheduler, phantom `running` agents are a
systematic state-machine defect, not a cosmetic backlog item. REQ-020's "bound observably applied"
is unverifiable without the terminal transition.

**O-4 (Semaphore gauge — the only observable for the process-global resource D-DOS introduces).**
`semaphoreGauge: {total, inUse, queued}` in `workflow_status` or `server_status`. Without it,
semaphore starvation presents as "everything hangs, no error." The gauge also makes the D-KILL release
invariant testable: assert gauge returns to baseline after a timeout-kill cycle.

**O-5 (Boot log enumerates v3 items alongside existing run-rehydration entries).**
v3 boot logs: provisioned-MCP names (count + names), secret-handle names, and the ARCH-019 workRoot
ancestor-walk outcome (marker found → fail with path + remedy; clean → proceed). A misconfigured
deployment must be diagnosable from the boot log without a debugger attached.

#### Agent altitude

**O-6 (Native tool_use round-trip visible in transcript for non-Anthropic models).**
`tool_use`/`tool_result` blocks from LiteLLM-translated non-Anthropic models land in `agent-<id>.jsonl`
in a canonical shape. The `AgentTranscriptSink` is the normalization boundary — once, not per-consumer.
The real-Ollama integration test asserts on the *persisted transcript*, not on stdout.

**O-7 (Per-attempt token attribution; partial usage on kill must still post to budget).**
Usage events streaming before a kill still post to the per-agent budget counter. The in-script
`budget.spent()/remaining()` stub gap is documented as a known limitation (not silently widened by
feeding fake numbers through IPC).

**O-8 (Redaction at capture boundary — single choke point, property-tested).**
`redact(event, resolvedSecretValues) → event` applied at the `AgentTranscriptSink` write boundary
before any `agent-<id>.jsonl` write. `SessionInitRecord` logs handle names only. Property test: no
byte of any resolved secret value appears in any persisted artifact. Distinct from ARCH-016's
filesystem-containment callback (which intercepts tool-call reads of secret-bearing files); both are
needed.

---

### (2) Replaceability — decoupling and pluggability

#### System altitude

**R-1 (Ports — explicit sync vs async contract in 04-design.md).**
`SecretResolver.resolve(handle) → string | throw` is synchronous over a pre-loaded map. Async
signature silently invites a network vault call into the session-build hot-path and violates pure
builder purity. Env/`LoadCredential` load is a *separate* startup step populating the map; the
resolver itself is pure. Each port's sync/async contract stated explicitly in 04-design.md.

**R-2 (SDKOptions must not leak through `GatewayClient.invoke(prompt, opts)`).**
The `invoke` opts type must not contain any SDK-specific fields (`thinking`, `allowedTools`,
`strictMcpConfig`, MCP config objects). ARCH-017 lives inside GatewayClient impls. TypeScript module
boundary enforces this; swapping the agent-execution engine stays an impl change inside one impl file.

**R-3 (ARCH-019 WorkRoot guard is not a pluggable strategy — stated explicitly).**
The guard itself is a fixed control; `isProjectRoot` predicate is injected for testability but the
guard is not configurable per-deployment. No "allow-inside-project" flag without reopening REQ-021.

#### Agent altitude

**R-4 (ProviderProfile: flat config table, boot-validated, single-sourced — Karpathy line held).**
Flat rows per alias: `{supportsExtendedThinking: boolean, timeoutMs: number, retries: number,
effortMapping: Record<string,string>}`. `supportsToolUse` is cut (no named consumer; the curated
allowlist applies regardless of provider class; adversarial did not dispute the cut). Boot-validated
with ajv against a schema; a typo fails boot with `CONFIG_SCHEMA_ERROR`. Fail-safe default:
`supportsExtendedThinking: false` for any alias with no profile row (catches unprofiled aliases
that slip past ARCH-008's `ALIAS_PROFILE_MISSING`). The alias validator (ARCH-008) and the builder
read the same table instance.

**R-5 (Pure builder is the replaceability master seam — dependency-free, invariant UT-enforced).**
`(providerClass, alias, config, provisionedRefs, resolvedSecrets) → SDKOptions` imports no `fs`,
`net`, or `process` module. Purity stated as a hard DES invariant with a UT running the builder with
a frozen input map and asserting determinism. A `process.env` read "for convenience" silently degrades
the cheap-UT property of the entire slice.

---

### (3) Consumability — interface friendliness, low integration cost

#### System altitude

**C-1 (ONE typed error surface — single `ReasonCode` union, one owner).**
One exported `ReasonCode` union in `types/reason-codes.ts` used by ARCH-008 (submission validator),
ARCH-017 (FailureEnvelope), and ARCH-001 (MCP result envelope). Contract test enumerates the union:

```
MCP_NOT_PROVISIONED | MCP_PROBE_FAILED | SECRET_MISSING | SECRET_HANDLE_INVALID
| HOOKS_UNSUPPORTED | PROVIDER_TIMEOUT | ALIAS_PROFILE_MISSING | WORKROOT_INSIDE_PROJECT
| CONFIG_SCHEMA_ERROR
```

`WORKROOT_INSIDE_PROJECT` is a boot/entrypoint error (fail-to-start), never a per-run client code;
document the axis distinction explicitly. Finer distinctions (`tool_error` for runtime-dead MCP,
schema-retry-exhausted, partial-resolve failure) live in `FailureEnvelope.kind/providerDetail` only.
Runtime-dead MCP → `FailureEnvelope{kind:'tool_error'}` → `agent()` null — stated, not a silent no-op.

**C-2 (Fail at submission, not mid-run — ARCH-008 extended, not forked).**
ARCH-008 checks at submission: MCP names provisioned, secret handle names in pre-loaded map (existence
check, not value resolution), agentTypes exist, ProviderProfile rows exist for all model aliases. A
workflow failing at agent #37 for a missing secret fails at submission. All checks through ARCH-008
facade — one error shape, one moment.

**C-3 (`${secret:name}` handle syntax spec in 04-design.md).**
Grammar: `${secret:<name>}` where `<name>` is `[A-Za-z0-9_-]+`. Legal in provisioned-MCP config
values and provider alias config. Inert (never resolved) in workflow scripts and pushed skills —
constructively excluded, not runtime-filtered. Grammar violation → `SECRET_HANDLE_INVALID`. One
worked example in DEPLOY.md §secrets.

**C-4 (Admin tools ship real JSON schemas on day one; `mcp_provision` write authority guarded).**
`mcp_provision` and sibling write-authority tools (any `secret_*` setters) include explicit write-
authority guards at the tool handler level: check `bind == loopback` and return a typed error if not,
independent of the general `insecureNoAuth` flag. This closes the authority-escalation gap if D-BIND
is misconfigured; it is one guard per write-authority handler, not a new subsystem. (Adversarial
partial-concede integrated.) All admin tools ship real parameter schemas in `tools/list` from day one.

**C-5 (ARCH-019 operator-facing error is instantly actionable).**
`WORKROOT_INSIDE_PROJECT` boot error emits: the full offending ancestor path, the type of project
marker found (`.git` vs `CLAUDE.md`), and the exact remediation step. One-liner in DEPLOY.md
§workRoot-placement.

#### Agent altitude

**C-6 (Workflow-script contract unchanged — `agent()` still resolves string | object | null).**
v3 adds no new script-visible API. FailureEnvelope explains `null` out-of-band (status API,
dashboard, log), never as fake success text in-band. Existing workflows stay compatible.

---

### (4) Self-sustainability — closed-loop autonomy and lifecycle management

#### System altitude

**S-1 (Global semaphore — single idempotent release site + timer/listener teardown in `finally`).**
D-DOS's semaphore slot acquired in the RunGuard; released in a single `try/finally` keyed to the
race outcome. The `finally` must contain ALL of:
- semaphore slot release (idempotent guard flag preventing double-free)
- timeout timer teardown (`clearTimeout`)
- `onExternalAbort` listener removal (the `once:true` listener registered during the race)

Without the timer teardown, a settled-before-timeout call leaves a live timer that fires against a
reused controller on the *next* run — a subtle cross-run contamination on high-throughput schedulers.
(Adversarial #1 refinement, conceded and integrated.)

Queue policy: FIFO; documented that a single greedy `parallel()` can queue-starve other runs (single-
node accepted behavior). Semaphore is an injected instance (composition root), never a `static`
global. Gauge per O-4. UT: max=1; assert gauge returns to 0 on success, timeout-kill, stop, suspend.

**S-2 (Kill the process group, not only the CLI child — orphan threat applies one level down).**
The SDK CLI subprocess spawns N stdio-MCP children per session. `child.kill()` on timeout orphans
those grandchildren, recreating the D-PROC orphan-litellm pathology at higher volume under the
scheduler. Design: spawn CLI detached (`{detached: true}`), kill the process group
(`process.kill(-pgid, 'SIGTERM')` → SIGKILL escalation after a grace period). One implementation
site; coherent with D-PROC's own threat model.

**S-3 (D-PROC: derived port, probe-before-use, shutdown tied to engine lifecycle).**
Port 0 bind (OS-assigned, race-safe). Health probe gates the first agent call, not server boot —
slow start degrades one run, not the whole engine. SIGTERM→SIGKILL shutdown on engine lifecycle
signals. Temp-dir cleanup (proxy config dirs, CLI session dirs) on the same path as kill/shutdown.
In-process restart stays with systemd/docker `Restart=on-failure` — no in-process watchdog.

**S-4 (ARCH-019: boot fail-fast + session-init re-walk — two call sites of one pure predicate).**
The WorkRoot Project-Isolation Guard has two call sites for the same predicate:

1. **Boot-time (ARCH-019 task):** `realpathSync(workRoot)` then walk ancestors to the filesystem
   root checking each for `.git` or `CLAUDE.md`. Uses `existsSync` (synchronous at boot, avoids
   race conditions). Fails boot with `WORKROOT_INSIDE_PROJECT` naming the offending ancestor and the
   marker type. Must use `realpathSync`, not `path.resolve`, so symlinked workRoot/ancestors that
   resolve into a git repo are caught. (Adversarial #5, integrated.)

2. **Session-init time (ARCH-017(a) task, using ARCH-019's extracted `findProjectMarkerAncestor`):**
   At session-build, re-run `findProjectMarkerAncestor(runWorkspaceCwd, workRoot, existsImpl)` —
   walking from the agent's run-workspace `cwd` up to (but excluding) workRoot. On a hit, refuse
   the build with a typed error. This closes the intra-run variant: an agent writing `CLAUDE.md`/`.git`
   into its workspace during a run cannot cause a subsequent same-run `agent()` to load that marker.
   (Adversarial #3, conceded and integrated.)

   Load-bearing precondition stated explicitly: ARCH-016 write-confinement restricts agent writes to
   within the run-workspace subtree (not above into the per-workflow work folder). If this precondition
   is weakened, the cross-run variant becomes reachable and escalates to HIGH. The design doc must
   state this dependency.

Implementation: `findProjectMarkerAncestor(path, stopAt, existsImpl) → string | null` is a pure
function extracted in the ARCH-019 task. `assertWorkRootIsolated(workRoot, existsImpl)` is the
boot-time throwing wrapper. ARCH-017(a) calls the same predicate at session-build without the throw —
no code duplication. UTs:
- Boot: (a) marker at workRoot → throws naming workRoot; (b) marker at mid-ancestor → throws naming
  that ancestor; (c) `.git` as file vs dir → both trip; (d) clean chain → void, no false positive;
  (e) `~/.claude` present but no marker → does not trip; (f) symlinked workRoot into project → trips
  after adding `realpathSync`.
- Session-init: (a) marker written in workspace → build refused; (b) clean workspace → build proceeds.
- `settingSources` regression UT: built `SDKOptions.settingSources` never contains `'user'` or
  `'local'` on any code path. (Adversarial #8, conceded and integrated.)

**S-5 (Graceful degradation on stale registry entries — warn-at-boot, fail-at-use, no crash-on-bad-row).**
A provisioned MCP failing its boot probe logs the defect (names only), marks the entry unhealthy, and
returns the typed error at submission. One bad registry row must not crash the server or block all
scheduled workflows overnight. No background re-probe — provision-time and optional submission-time
only.

**S-6 (Retention policy explicitly covers v3 artifacts).**
REQ-013 retention/cleanup policy extended to enumerate: SessionInitRecords and FailureEnvelopes in
existing `agent-<id>.jsonl` files; killed-session temp dirs (S-2); proxy-config mkdtemp dirs (D-PROC).
One design-doc sentence per category; not asking for a new subsystem.

**S-7 (Tool liveness: provision-time probe + optional submission-time re-check; no background poller).**
`MCP_PROBE_FAILED` at provision-time; optional submission-time re-check (config flag, default: on).
No background polling. An admin can disable submission-time re-check for expensive-to-probe servers
without removing provision-time validation.

#### Agent altitude

**S-8 (Context metabolism: not a v3 risk at this scale).**
Agents run within bounded run workspaces with a fixed, curated tool surface. Cross-run memory, prompt
self-calibration, and transcript compression remain off the build list. The real v3 metabolism risk is
the kill-on-timeout path (S-1/S-2), not context size. Memory metabolism is delegated to the script
layer via REQ-013's per-workflow persistent work folder — stated as the resolved design answer, not an
implicit non-decision.

---

## Task-split guidance for the synthesizer (03-tasks.md does not exist yet)

Unchanged from r1 except for the addition of the session-init re-walk to ARCH-017(a):

- **ARCH-017 → three tasks:**
  (a) Pure builder + ProviderProfile table + validator wiring + fail-safe default + **session-init
      project-marker re-walk reusing `findProjectMarkerAncestor`** + `settingSources`-never-user/local
      invariant UT. All pure UTs; exhaustive matrix: provider-class × thinking × allowlist × MCP refs
      × secret handles × cwd-marker × settingSources.
  (b) Impure timeout-race + process-group kill + slot free-exactly-once + **timer/listener teardown**
      in `finally` over injected clock/spawn/semaphore.
  (c) One real-tier Ollama `tool_use` round-trip (VAL).
  Merging (a) and (b) forfeits the master seam.

- **ARCH-015 → two tasks:** (a) registry CRUD + typed errors + strict-MCP injection by name +
  write-authority handler guard (bind=loopback check); (b) `McpProbe` wiring at provision.

- **ARCH-016 → two tasks:** (a) pure `resolveConfig` + `redact`; (b) env/`LoadCredential` source
  loader + filesystem-confinement callback hardening.

- **ARCH-018 → one task:** pure asset-kind classifier (hook → reject, MCP → redirect, skill → pass).

- **ARCH-019 → one task:** extract `findProjectMarkerAncestor(path, stopAt, existsImpl, realpathImpl)
  → string | null` + `assertWorkRootIsolated` throwing wrapper + `realpathSync` canonicalization +
  truth-table UTs (all cases above including symlink-into-project). Boot wiring in `main.ts`. Pure;
  no live filesystem, no real model.

- **D-DOS / D-BIND / D-PROC → three separate amendment tasks.** Each with its own test so amendments
  to "done" v1/v2 modules are not silently skipped.
  D-BIND: `isLoopback(bind)` predicate replacing string comparison; truth-table UT (IPv4-loopback,
  IPv6-loopback, non-loopback-IPv4, non-loopback-IPv6).

---

## Remaining genuine disagreements after r2

None with the adversarial r1 remain unresolved. All eight adversarial findings are either conceded
(#1, #3, #6, #8, and the partial-concede on write-authority guard), already-aligned (#2, #4, #7), or
explicit-confirmation of my r1 intent (#5 on `realpathSync`). The adversarial's Karpathy tie-break
on ProviderProfile SPI (flat table, not provider plugin) matches my r1 position.

One item requires a synthesizer decision (not a disagreement between my lens and the adversarial, but
a design open question): whether the session-init re-walk in ARCH-017(a) should refuse the build on
a marker hit (my endorsed approach) or plant an engine-owned project boundary marker above the
run-workspace so the CLI cannot climb past it. The adversarial left both options open. I endorse
"refuse the build with a typed error" as the simpler, safer path — planting a synthetic marker is
an active write to the workspace by the engine itself, which could interfere with agent scripts that
also read project markers.

---

## Risk register (updated from r1)

| # | Severity | Risk | Mitigation (design or structural) |
|---|----------|------|-----------------------------------|
| R1 | HIGH | Slot double-free / never-free on kill path + live timer / listener leak | `withSlot(fn)` try/finally with slot release + timer teardown + listener removal; idempotent guard; UT count-returns-to-zero on every branch |
| R2 | HIGH | ARCH-019 boot-only check re-opens REQ-021 at runtime via agent-authored markers | Session-init re-walk of `findProjectMarkerAncestor` from workspace `cwd` to workRoot boundary; stated ARCH-016 write-confinement precondition |
| R3 | HIGH | Secret leak via transcript tap before redaction | `redact(event, secretValues)` at `AgentTranscriptSink` write boundary; handle-names-only `SessionInitRecord`; invariant UT |
| R4 | MED | `SessionInitRecord`/`FailureEnvelope` degrade to log lines | Design pins persistence + query surface; C-1 `ReasonCode` union single owner |
| R5 | MED | Unprofiled alias re-opens D-F6 Ollama 400 | Fail-safe default `supportsExtendedThinking:false` + submission-time `ALIAS_PROFILE_MISSING` |
| R6 | MED | ARCH-019 `resolve`-not-`realpathSync` symlink bypass | `realpathSync` before ancestor walk; UT models symlink-into-project |
| R7 | MED | `isLoopback` string-compare false-reject / bypass | Proper predicate over 127.0.0.0/8 + ::1; truth-table UT |
| R8 | MED | Orphan stdio-MCP grandchildren on timeout kill | Process-group kill (`detached:true`, `kill(-pgid,...)`) |
| R9 | LOW | `settingSources`-never-user/local silently unchecked | Regression-guard UT in ARCH-017(a) asserting SDKOptions.settingSources |
| R10 | LOW | Builder purity erosion from `process.env` read | Purity stated as hard DES invariant; purity-enforcing UT |
| R11 | LOW | `mcp_provision` write authority on misconfigured D-BIND | Per-handler loopback check on write-authority tools; hard error if not loopback |
| R12 | LOW | Boot-fragility: crash on bad registry row | Warn-at-boot, fail-at-use (S-5); stated as explicit design rejection of naive validate-and-throw |
