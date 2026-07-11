---
lens: quality-dimensions (observability / replaceability / consumability / self-sustainability)
stage: design (v3 slice — REQ-016..020 / ARCH-015..018 + the three v1/v2 amendments D-DOS, D-BIND, D-PROC)
round: r1 (independent proposal)
note: the v2 round-1 proposal previously at this path is archived at quality-dimensions.v2.r1.md
---

# Quality-dimensions review — Design stage, v3 slice (Remote Workflow Engine)

## Summary

This project is **both** a plain system and an AI-agent system, and the v3 slice is where the two
altitudes fuse: ARCH-015/016 (provisioning registry, secret store) are conventional trusted-parent
server modules — **system** altitude; ARCH-017 (SDK session-options builder + kill-on-timeout race)
and ARCH-018 (asset-ingestion policy) sit directly on the agent-execution path — **agent** altitude.
Both are applied below, per dimension.

The v3 architecture is unusually good news for this lens *on paper*: `SessionInitRecord`,
`FailureEnvelope`, the typed error taxonomy, `ProviderProfile`, and `SecretResolver` are all
quality-dimension constructs the Gate-2 panel already bought. My proposal is therefore mostly about
**making those constructs land as designed, reachable, persisted contracts rather than log lines** —
the design stage is where "observable in session init" either becomes a queryable record with a
schema and an owner, or degrades into a `console.log` nobody can trace. Four asks dominate:

1. **`SessionInitRecord` and `FailureEnvelope` must be persisted, typed, and *reachable through an
   existing MCP surface*** (per-agent record in `workflow_status` / `workflow_agent_log`), not just
   written somewhere. An audit record you cannot query from the client is a black box with extra steps.
2. **The kill-on-timeout path (D-KILL) forces a terminal `aborted`/`timeout` agent state** — the
   carried v1.1 cosmetic finding ("aborted AgentRecord stuck `running` forever") becomes a v3
   correctness defect the moment REQ-020 makes killing a *designed, frequent* path. REQ-020's "bound
   observably applied" is unverifiable if the record never transitions.
3. **`ProviderProfile` stays a flat, boot-validated config table with every field naming its
   consumer** — that is the whole replaceability story for v3 (GLM/qwen/next = a config row), and
   also the discipline that keeps it from re-growing into the provider SPI Karpathy already cut.
4. **The D-DOS global semaphore needs a gauge and a release invariant, and the CLI kill must reap
   the process *group*** — a starved semaphore with no observable state is the textbook silent
   failure ("all runs hang, nothing is wrong anywhere"), and a killed CLI that orphans its N
   stdio-MCP children un-fixes D-PROC in the same release that ships it.

**Task-splitting note for the synthesizer** (03-tasks.md does not exist yet for this slice): keep
the v2 pattern of splitting each module along the pure ⟂ impure seam — it served every dimension of
this lens well. Concretely: ARCH-017 → pure builder task ⟂ race/kill/spawn task; ARCH-016 →
resolver+redaction (pure mapping) ⟂ confinement-callback hardening (touches ARCH-007) ⟂ source
loading (env/LoadCredential); ARCH-015 → registry CRUD ⟂ probe wiring; ARCH-018 is one pure
classifier task; D-DOS / D-BIND / D-PROC each get their **own small amendment task with their own
test** — folding them silently into "misc hardening" is how amendments to existing modules get lost.

---

## (1) Observability — internal state transparent, end-to-end followable

### System altitude

- **O-1 (SessionInitRecord is a stored, queryable contract — the REQ-016-c3 audit seam).**
  ARCH-017 says the builder writes one `SessionInitRecord` (resolved alias→provider+model id,
  thinking mode, curated allowlist, injected-MCP names, secret-handle *names*, cwd). Design must fix
  three things the architecture left open: (a) **where it persists** — I propose: first line of the
  existing `agent-<id>.jsonl` transcript via the existing AgentTranscriptSink (one writer, no new
  file kind, survives restart, replayed by resume for free); (b) **its TypeScript type** exported
  from one module and unit-snapshot-tested (this is the record Gate 7.5 will diff against `ps aux`
  argv — make the designed record match what forensics already proved works); (c) **which MCP tool
  returns it** — `workflow_agent_log(runId, agentId)` should return it as the transcript head, and
  `workflow_status` per-agent entries should carry the resolved `provider+model id` (REQ-007 already
  promises this) plus `thinkingMode`. A stored-but-unreachable audit record fails my lens as surely
  as no record.
- **O-2 (FailureEnvelope reaches the caller-visible surface and shares the error taxonomy).** The
  envelope `{kind, attempts, elapsedMs, providerDetail}` must be persisted **into the AgentRecord**
  (not only logged) and surfaced in `workflow_status` per-agent entries and the dashboard drill-in.
  Its `kind` values must be drawn from the *same* D-REDACT reason-code taxonomy
  (`PROVIDER_TIMEOUT`, `provider_error`, …) — two enums for one concept will drift. Design should
  publish ONE `ReasonCode` union used by: FailureEnvelope.kind, submission-validator errors, and the
  MCP result envelope `error.code`.
- **O-3 (terminal agent states — the acute form of the v1.1 backlog item).** Today an agent cut
  short by suspend/stop stays `state:'running'` forever. v3's outer race **kills agents by design**
  on every provider hang; with a scheduler launching runs autonomously overnight, the dashboard
  would accumulate phantom "running" agents at exactly the moments nobody is watching. Design ask:
  extend the agent state machine with a terminal `aborted` (suspend/stop) and let the FailureEnvelope
  transition the record to `failed` with `kind:timeout`. This is 1 enum value + 2 transition sites,
  and it is the difference between REQ-020's bound being *observably* applied and merely applied.
- **O-4 (semaphore gauge).** D-DOS creates one process-global scarce resource. Its state (slots
  total / in-use / queued, per-run holders) must be observable — cheapest seam: include it in the
  `workflow_status` response envelope or a trivial server-status field the dashboard already polls.
  Without it, semaphore starvation (e.g. a leak from a missed release on some untested error path)
  presents as "everything hangs, no error anywhere" — the exact silent-failure my lens exists to
  design out. A gauge also makes the D-KILL release invariant *testable*: assert gauge returns to
  baseline after a timeout-kill.
- **O-5 (lifecycle events log with reasons).** D-PROC's health probe, port selection, and
  SIGTERM→SIGKILL escalation each emit one structured log line with the *reason* (`port 4000 busy →
  4017`, `probe failed: ECONNREFUSED after 3 attempts`). Boot already enumerates re-hydrated runs
  (ARCH-006); v3 boot should likewise enumerate provisioned-MCP names and secret-handle names
  (names only — D-REDACT) so a misconfigured deployment is diagnosable from the boot log alone.

### Agent altitude

- **O-6 (native tool_use round-trip visible in the transcript).** REQ-016's acceptance says the
  round-trip is "observable in the per-agent transcript". The transcript sink taps the SDK message
  stream; design must confirm `tool_use`/`tool_result` blocks from **non-Anthropic** models (via
  LiteLLM translation) land in `agent-<id>.jsonl` in the same shape as Anthropic ones — if LiteLLM
  normalizes differently, the sink is where to normalize, once. The real-Ollama integration test
  should assert on the *persisted transcript*, not on stdout, so the observable and the verified
  artifact are the same thing.
- **O-7 (token attribution per attempt — budget must not silently rot).** D-KILL requires
  per-attempt token attribution: a killed/timed-out attempt's tokens (if any usage event arrived
  before the kill) must still post to the budget and to the per-agent usage in `workflow_status`.
  Design the gateway to emit usage deltas **as they stream**, not only on successful completion.
  Related carried finding (flag, not re-litigate): the in-script `budget.spent()/remaining()`
  accessors are hard-coded stubs — v3 touches the same accounting path; at minimum the design must
  not *widen* the gap between script-visible and server-truth accounting.
- **O-8 (redaction is a choke point, and it is observability's twin, not its enemy).** D-REDACT
  lands in ARCH-016; design it as a **single redaction function applied at the RunRecorder /
  transcript-sink write boundary** (one choke point, property-tested: "no resolved secret value in
  any persisted artifact"), not as N call-site disciplines. Handle *names* stay loggable — that is
  what keeps the system diagnosable after redaction.

---

## (2) Replaceability — decoupling & pluggability

### System altitude

- **R-1 (ports already won at Gate 2 — hold the line at design).** `SecretResolver` port (one
  env/`LoadCredential` impl; vault = a *second impl later*, explicitly not built now — correct),
  `RunStore` port untouched, ARCH-015 registry as a sibling catalog over the same store. My only
  design ask: the `SecretResolver` port signature should be **synchronous resolve of preloaded
  values** (`resolve(handle) → value | SECRET_MISSING`) with loading confined to a startup step —
  an async-resolve signature would silently invite a network vault impl into the session-build hot
  path and complicate the pure builder (which must stay pure).
- **R-2 (SDKOptions must not leak through `invoke(prompt, opts)`).** ARCH-017 lives *inside* the
  GatewayClient impls behind the unchanged contract. Design should state the `invoke` opts type
  explicitly and assert (compile-time, by module boundary) that nothing SDK-specific
  (`thinking`, `allowedTools`, `strictMcpConfig`, mcp config objects) appears in it. This is the
  seam that keeps "swap the agent-execution engine someday" a config problem for ARCH-004's caller
  and preserves the direct-fetch ⟂ sdk duality that Gate 7.5 repeatedly relied on as the working
  fallback.

### Agent altitude

- **R-3 (ProviderProfile is the replaceability deliverable — keep it data, boot-validated, single-
  sourced).** The confirmed D-F6 defect (unconditional `think:true` → Ollama 400) is exactly the
  class of bug a capability table retires. Design asks: (a) **flat config rows** per alias
  (`supportsExtendedThinking, timeoutMs, retries, effortMapping`, …) validated at boot against a
  schema (ajv is already in-tree) — a typo'd profile field must fail boot, not silently produce SDK
  defaults; (b) **every field names its consumer in 04-design.md** — e.g. `supportsExtendedThinking`
  → builder's thinking flag; `timeoutMs/retries` → the outer race; `effortMapping` → the open
  `effort` question. A field with no named consumer is dropped (this is my concession to the
  simplicity lens, offered up front: `supportsToolUse` has no consumer I can find — the curated
  allowlist applies regardless — so unless the validator wants it for a submission-time warning,
  cut it); (c) the alias validator (ARCH-008) and the builder read the **same table instance** —
  two copies of capability knowledge is how D-F6 happens again.
- **R-4 (pure builder = the replaceability *and* testability seam — keep it dependency-free).**
  `(providerClass, alias, config, provisionedRefs, resolvedSecrets) → SDKOptions` must import no
  fs/net/process module. Everything Gate 7.5 round 3 found the hard way (thinking flag, missing
  timeout race, model not forwarded) becomes a table-driven unit test against this one function.
  Task-split ask: the builder is its own task with its own exhaustive UT matrix (provider-class ×
  thinking × allowlist × MCP refs × secret handles), *before* the impure race task starts.

---

## (3) Consumability — interface friendliness, low integration cost

### System altitude

- **C-1 (one stable, typed error surface).** The D-REDACT taxonomy (`MCP_NOT_PROVISIONED /
  MCP_PROBE_FAILED / SECRET_MISSING / SECRET_HANDLE_INVALID / HOOKS_UNSUPPORTED / PROVIDER_TIMEOUT`)
  must land in the existing uniform result envelope as `error: {code, message, hint?}` with **codes
  as stable contract-tested strings** (a contract test enumerating the union, so a rename is a
  breaking-change decision, not a refactor accident). Agent callers branch on `code`; `message` is
  for humans; `hint` carries the actionable next step ("provision it via mcp_provision", "define
  secret X in the unit's LoadCredential="). This is the cheapest possible SDK for the taxonomy.
- **C-2 (fail at submission, not mid-run — extend ARCH-008, don't fork it).** ARCH-015 already
  promises `MCP_NOT_PROVISIONED` at submission/run; design should route *both* new checks
  (referenced-MCP-name exists; `${secret:name}` handles in the referenced configs resolve) through
  the existing Submission Validator facade so the caller keeps seeing **one error-reporting shape at
  one moment**. A workflow that will die at agent #37 for a missing secret must die at submit.
- **C-3 (`${secret:name}` handle syntax needs a spec).** Design must pin: the exact grammar, where
  handles are legal (provisioned-MCP config values; provider alias config) and where they are inert
  (workflow scripts, pushed skills — never resolved there, by construction), and what happens to a
  literal `${secret:...}` that fails the grammar (`SECRET_HANDLE_INVALID`, not silent pass-through —
  REQ-018 already forbids the literal-handle-smuggled-as-value failure). One paragraph in DEPLOY.md
  §secrets with a worked example is part of the deliverable (consumability of the *admin* surface).
- **C-4 (new tools ship real schemas + doc surface split by audience).** `mcp_provision` (and any
  siblings) get genuine JSON schemas in `tools/list` from day one — the v1 C-1 placeholder-schema
  finding must not recur on new tools. Audience split: **admin** surfaces (provisioning, secrets,
  bind guard, Python 3.11/3.12 constraint) → DEPLOY.md; **agent-caller** surfaces (error-code
  taxonomy, what `null` from `agent()` can now mean, submit→poll unchanged) → the client plugin's
  guidance skill (ARCH-013 gets a small v3 doc amendment; recursion guard still excludes the plugin
  itself from sync).

### Agent altitude

- **C-5 (the workflow-script contract stays boring — that is a feature).** `agent()` still resolves
  `string | validated-object | null`; v3 adds *no* new script-visible API. Consumability here means:
  the FailureEnvelope explains the `null` **out-of-band** (status/dashboard/log), never as fake
  success text in-band (REQ-020 second clause). Design should say this explicitly so no task
  "helpfully" returns error prose to the script and breaks compat.

---

## (4) Self-sustainability — closed-loop autonomy, lifecycle management

### System altitude

- **S-1 (global semaphore: design the release invariant + queue policy, injectable for tests).**
  D-DOS's semaphore is only as good as its guaranteed release. Design asks: (a) slot acquisition/
  release wrapped in one `withSlot(fn)` construct (try/finally) so *every* exit path — success,
  FailureEnvelope, kill, suspend, stop — releases; (b) an explicit queue policy (FIFO is fine;
  document that a single greedy `parallel()` can queue-starve others — acceptable single-node
  behavior, but *documented*, not discovered); (c) the semaphore is injectable/fake-able so the
  starvation and release-on-kill tests are deterministic unit tests, not timing-flaky integration
  tests; (d) gauge per O-4.
- **S-2 (kill the process *group*, not the child).** The SDK CLI subprocess spawns its own stdio-MCP
  children (N per session, per the D-DOS analysis). A `child.kill()` on timeout orphans those
  grandchildren — recreating the orphan-litellm pathology D-PROC exists to fix, at higher volume.
  Design: spawn the CLI detached in its own process group and kill(-pgid) with SIGTERM→SIGKILL
  escalation; temp-dir cleanup on the same path. This is the one place where I ask for *more* than
  the architecture note literally says ("kills the CLI subprocess"), because the note's own threat
  model (orphans burning tokens/slots) applies equally one level down.
- **S-3 (D-PROC lands as designed: derived port, probe-before-use, shutdown tied to engine
  lifecycle).** These fix three *confirmed* real defects (port-4000 collision — reproduced live
  twice; orphan litellm after every graceful restart; mkdtemp leak). Design detail worth pinning:
  port selection must be race-safe (bind port 0 and read the assigned port, or retry-on-EADDRINUSE
  loop — not "check then bind"), and the health probe gates the *first agent call*, not server
  boot, so a slow proxy start degrades one run rather than failing the whole engine. Restart/
  auto-recovery stays with systemd/docker per D-PROC — no in-process watchdog (agreed; my lens's
  self-healing requirement is satisfied by supervisor + `Restart=on-failure` + the D-BIND fail-closed
  default, which is self-sustainability's "safe without a human watching" in one `if`).
- **S-4 (graceful degradation at boot: warn-at-boot, fail-at-use).** A provisioned MCP whose secret
  handle no longer resolves, or whose probe fails at boot, must **not** crash the server: boot logs
  the defect (names only), the registry entry is marked unhealthy, and a run referencing it gets the
  typed error at submission. One bad registry row taking down every scheduled workflow overnight is
  the anti-pattern; per-entry degradation is the pattern. (No background re-probe — D-PROBE agreed;
  provision-time + submission-time probes only.)

### Agent altitude

- **S-5 (metabolism: the existing retention policy must enumerate the new artifacts).** v3 adds
  SessionInitRecords and FailureEnvelopes inside existing per-run files — no new file kind if O-1's
  proposal is taken — so the REQ-013 retention/cleanup policy covers them for free. Design ask is
  one sentence in 04-design.md saying so, plus confirming killed-session temp dirs (S-2) and proxy
  config mkdtemp dirs (D-PROC) are inside the cleanup scope. Explicitly NOT asking for: cross-run
  agent memory, prompt self-calibration, transcript compression — all remain on the not-built list
  and nothing in REQ-016..020 needs them.
- **S-6 (tool-liveness = the probe, at the two designed moments).** Provision-time reject
  (`MCP_PROBE_FAILED`) + optional submission-time re-check is the right closed loop for a
  single-node QM tool; a background poller would be the first step toward the metrics stack the
  panel already declined. No further ask.

---

## Risks

1. **Highest: the release-invariant / orphan pair (S-1/S-2).** If any exit path misses the slot
   release or the kill misses a grandchild, v3 converts a per-run nuisance into a whole-server
   creeping outage that only manifests under the scheduler at night. Mitigation is structural
   (`withSlot`, process-group kill), not test-only.
2. **SessionInitRecord/FailureEnvelope degrade into logs.** If tasks don't pin persistence + query
   surface (O-1/O-2), REQ-016-c3 and REQ-020's observability clauses will "pass" via console output
   that Gate 7.5 then has to forensically reconstruct with `ps aux` again. The design must encode
   what validation already proved it needs.
3. **Taxonomy drift.** Three places mint error identifiers (validator, gateway envelope, MCP result
   envelope); without the single `ReasonCode` union (O-2/C-1) they will diverge by Gate 6.
4. **Redaction implemented as call-site discipline** instead of one choke point (O-8) — one missed
   `providerDetail` interpolation leaks a key into a transcript the dashboard then displays.
5. **Phantom `running` agents (O-3)** — cosmetic in v1, systematic once kill-on-timeout is a designed
   path; cheap now, confusing forever if skipped.
6. **Boot-fragility inversion (S-4)**: naive "validate registry at boot, throw on bad entry" is the
   easy implementation and the wrong one; it must be explicitly designed away.

## Expected disagreements with other lenses

- **vs simplicity/Karpathy**: (a) O-3's terminal agent state will be called v1.1-backlog scope creep
  — my counter: D-KILL changes its class from cosmetic to a REQ-020 verifiability requirement; it is
  ~1 enum value + 2 transitions. (b) O-4's gauge will be called speculative metrics — counter: it is
  the *only* observable for the new global resource D-DOS itself introduces, and it rides an existing
  response, no metrics stack. (c) ProviderProfile fields — I have pre-conceded the discipline
  (every field names its consumer or is cut, R-3), which should defuse most of this.
- **vs adversarial/security**: (a) they may want SessionInitRecord content (allowlist, MCP names,
  secret-handle names) treated as disclosure on the unauth listener — my position: it lives in the
  store behind the same 127.0.0.1+tunnel boundary as everything else, and D-REDACT already draws the
  line at *values* vs *names*; if they escalate, the compromise is redacting handle names from the
  dashboard only, never from the store. (b) They may prefer a simpler `child.kill()` over
  process-group kill (S-2) as less code — I expect to win this one on their own orphan-threat-model
  grounds. (c) They may re-escalate the per-run OS jail; that is settled (D-SEC) and I am not
  reopening it.
- **vs consumability-maximalists / DX**: someone may propose discovery endpoints (`secret_list`,
  `mcp_list`) for admin convenience — D-REDACT already settled this against discoverability until
  auth lands; I hold that line even though it is "my" dimension being curtailed.
- **On task splitting**: a synthesizer might merge D-DOS/D-BIND/D-PROC into their host modules'
  tasks. I want them as three visible amendment tasks with their own tests, because amendments to
  "done" v1/v2 modules are precisely the changes that skip verification when invisible.
