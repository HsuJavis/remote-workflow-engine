# Architecture debate r1 — Quality-dimensions lens (observability · replaceability · consumability · self-sustainability)

**Scope of this round**: the v3 slice (REQ-016..020; REQ-012 stays deferred) layered onto the delivered
ARCH-001..014 architecture, informed by the Gate 7.5 real-validation record in `state.yaml`
(thinking:true 400 on Ollama, `timeoutMs` inert on the SDK path, litellm port-4000 collision,
aborted AgentRecord stuck `running`, mkdtemp leaks, latent cwd-not-per-run-workspace gap).

## Altitude determination (required first step)

This project is **BOTH** a conventional system and an AI-agent system, and the two altitudes map onto
its two halves cleanly:

- **System altitude** applies to the serving substrate: MCP JSON-RPC-over-HTTP facade, Run
  Manager/RunGuard, SQLite+journal store, scheduler, dashboard, asset sync, the managed LiteLLM
  subprocess, and the new v3 surfaces (MCP provisioning registry, secret store).
- **Agent altitude** applies to what the substrate hosts: per-`agent()` Claude Agent SDK sessions
  (now a spawned CLI subprocess on the default `gateway:"sdk"` path), multi-provider routing, tool
  loops, transcripts, token budgets.

Both altitudes are load-bearing for v3 — REQ-016 is precisely "make the agent altitude real for
non-Anthropic backends", and the Gate 7.5 defects show the pain concentrates at the **seam between
the two** (the semi-opaque SDK CLI subprocess). Every dimension below is applied at both altitudes.

## Summary

The v1/v2 architecture already carries strong quality DNA (AgentTranscriptSink, correlation-tagged
gateway calls, GatewayClient port, uniform result envelope, RunGuard). The v3 slice threatens all
four dimensions at one place: the **SDK gateway path wraps a black-box CLI subprocess** whose
internal defaults (extended thinking), internal retry/backoff (~4 min invisible stall), working
directory, and env inheritance are currently neither observable, nor configurable per provider, nor
bounded. My proposal: (1) an explicit **SessionInitRecord + FailureEnvelope** observable seam shared
by both gateway paths; (2) a config-driven **ProviderProfile** (per-alias capability flags) instead
of hardcoded if-Anthropic-else logic; (3) an enumerated **reason-code taxonomy** across the new
error-bearing surfaces (`mcp_provision`, secrets, hook rejection); (4) a **ManagedSubprocess
supervisor** closing the LiteLLM/CLI lifecycle loop (ports, shutdown, temp dirs, kill-on-timeout).
Keep the standing "explicitly NOT built" list intact — no metrics stack, no autoscaling, no prompt
self-calibration.

---

## Dimension 1 — Observability (folds in traceability)

**System altitude**

- **KP-O1 — SessionInitRecord (new, closes REQ-016 c3 by construction).** At SDK-session build time,
  write one structured journal record per agent: resolved alias → provider + real model id, thinking
  mode chosen, curated tool allowlist actually passed, injected MCP server *names* (REQ-017),
  referenced secret *handles* (REQ-018 — names only, never values), cwd handed to the session. This
  is the single artifact that makes "curated surface observable in the session init", the D-F6
  thinking regression guard, and the VAL-003 isolation invariant all *auditable from the store*
  instead of re-proven by ad-hoc `ps aux` at each validation round.
- **KP-O2 — SDK-subprocess stderr/stream tap.** Gate 7.5's ~4-minute silent retry storm is the
  canonical "opaque failure = design defect". The CLI child's stderr and SDK event stream must flow
  into the existing AgentTranscriptSink (`agent-<id>.jsonl`), so `workflow_agent_log` shows *why* an
  agent sat for 4 minutes. No second capture path — extend the one sink.
- **KP-O3 — correlation survives the extra hop.** The direct-fetch path tags LiteLLM calls with
  `runId/agentId`; the SDK path (CLI → ANTHROPIC_BASE_URL → proxy) currently loses that join. Carry
  it via LiteLLM metadata/extra-headers config per session so the proxy request log still joins back
  to the store (REQ-004 "local backend only" stays verifiable on the *default* path).
- **KP-O4 — provisioning/secrets audit lines.** `mcp_provision` (create/update/probe result) and
  each secret-handle resolution emit one structured log line (handle name, consumer runId/agentId,
  outcome). Never the value. REQ-018's "clear error, never a silent leak" needs the *positive* trace
  too, or a missing-secret bug is undebuggable.

**Agent altitude**

- **KP-O5 — FailureEnvelope, one shape, both paths.** REQ-020 says a bounded failure is "visible in
  the run record, never smuggled as fake success". Architect it as one typed failure record
  `{kind: timeout|provider_error|tool_error|schema_mismatch, attempts, elapsedMs, providerDetail}`
  written by *both* GatewayClient impls before resolving `null`. Also terminal-ize the aborted
  AgentRecord (v1.1 backlog item 1) — an agent forever `running` is a lying status API, an
  observability defect not a cosmetic one.
- **KP-O6 — token accounting per attempt.** Retries (SDK-internal or REQ-020 outer) must attribute
  token spend per attempt into the budget path, or budget drift becomes invisible on flaky providers.

## Dimension 2 — Replaceability (decoupling & pluggability)

**System altitude**

- **KP-R1 — ProviderProfile config, not code branches.** The D-F6 fix ("thinking disabled iff
  non-Anthropic") must NOT be `if (provider === 'anthropic')` string-matching in the gateway.
  Propose a per-alias capability table in `rwe.config.json` (`supportsExtendedThinking`,
  `supportsToolUse`, `timeoutMs`, `retries`, `effortMapping: passthrough|ignore`), with sane defaults
  per provider family. Then GLM/qwen/next-provider is a config row, not a gateway rewrite — this IS
  the D2 replaceability promise extended to v3's full-harness reality, and it answers the open
  question on `effort` mapping without new code later.
- **KP-R2 — SecretResolver port.** REQ-018 names two mechanisms already (systemd `LoadCredential`,
  process env). Put them behind one narrow port resolving `${secret:name}` → value at session-build
  time; registry/asset entries store only handles. A future vault backend is then an impl, and the
  handle syntax is the stable contract. Deliberately NOT proposing a vault impl now.
- **KP-R3 — keep GatewayClient the only seam.** Two impls exist and both survived real validation
  (direct-fetch fully; SDK after D-F5). The v3 work (thinking, timeout race, cwd) must land *inside*
  the impls behind the unchanged `invoke(prompt, opts)` contract — resist any temptation to let
  REQ-016 leak SDK-specific options through ARCH-004 into the orchestration layer.

**Agent altitude**

- **KP-R4 — LLM backend swap stays a config change.** Already true via alias mapping; v3's job is to
  keep it true when the full harness (tools+MCP+skills) rides along. The acceptance test for this
  dimension: switching an alias Ollama↔Anthropic changes zero lines outside `rwe.config.json`, and
  the SessionInitRecord (KP-O1) proves what was actually applied.

## Dimension 3 — Consumability (interface friendliness, integration cost)

**System altitude**

- **KP-C1 — reason-code taxonomy for the new error surfaces.** REQ-017 ("clear error, not silent
  no-op"), REQ-018 ("clear error, never the literal handle passed through"), REQ-019 ("clear
  'hooks unsupported' reason") are all consumability acceptance criteria. Define one enumerated set
  now — `MCP_NOT_PROVISIONED`, `MCP_PROBE_FAILED`, `SECRET_MISSING`, `SECRET_HANDLE_INVALID`,
  `HOOKS_UNSUPPORTED`, `PROVIDER_TIMEOUT` — carried in the existing uniform result envelope
  `{runId,status,result,error?}`. Callers (and the guidance skill) branch on codes, not prose.
- **KP-C2 — tools/list schema completeness stays a gate.** New tools (`mcp_provision`, any probe/
  status tool) must ship full JSON schemas; the existing `mcp-tools-list-schema` integration test is
  the right enforcement point — extend it, don't exempt v3 tools.
- **KP-C3 — DEPLOY.md is a consumability deliverable, not an afterthought.** REQ-016 c4 makes
  "documented steps boot the harness path green on local Ollama" an acceptance criterion. That doc
  must carry: the Python 3.11/3.12 pin, the `gateway:"sdk"` vs `"direct-fetch"` decision matrix
  (today the committed example config's own template needs direct-fetch for a working local-Ollama
  deploy — that contradiction must be resolved or explicitly documented), and the ProviderProfile
  reference table.

**Agent altitude**

- **KP-C4 — one error-handling pattern for workflow authors.** `agent()` resolves `null` on terminal
  failure on BOTH gateway paths with the same timing bounds (REQ-020 closes the asymmetry). A
  workflow script must never need to know which gateway is configured — that is the agent-altitude
  consumability invariant, and it is exactly what compat with the local Workflow tool requires.
- **KP-C5 — guidance skill teaches the new v3 surfaces.** The plugin's skill must gain the
  provision-by-name pattern (reference a provisioned MCP, handle `MCP_NOT_PROVISIONED`) so remote
  callers integrate without reading server source.

## Dimension 4 — Self-sustainability (closed-loop autonomy, lifecycle)

**System altitude**

- **KP-S1 — ManagedSubprocess supervisor (biggest concrete gap).** The engine now owns TWO kinds of
  child processes beyond the sandbox: the LiteLLM proxy and per-agent SDK CLI children. Known real
  defects: port-4000 collision, proxy never stopped on shutdown, mkdtemp config dirs leaked, and
  (predictable once REQ-020 lands) CLI children orphaned by an outer timeout race. Propose one small
  supervisor owning: dynamic/derived port selection, health probe before first use, SIGTERM→SIGKILL
  shutdown chain tied to engine lifecycle, temp-dir cleanup, and **kill-the-child-on-timeout**
  semantics for REQ-020 (an abandoned race that leaves the CLI running keeps burning tokens —
  budget integrity depends on this).
- **KP-S2 — MCP tool-liveness at the right moments.** The provision-time live probe exists
  (`src/mcp-probe.ts` lineage from ARCH-012). For REQ-017, run it (a) at provision time (reject
  dead configs with `MCP_PROBE_FAILED`), (b) optionally at run-submission for referenced names —
  cheap, and turns "tools silently absent mid-run" into a fail-fast. Do NOT build continuous
  background probing (speculative; nothing dies quietly enough to justify a poller on a single node).
- **KP-S3 — retention closes over the new stores.** REQ-013's documented retention/cleanup policy
  must now also cover: asset store versions, provisioned-MCP registry orphans, per-agent transcript
  growth, and litellm temp artifacts. One documented policy, one sweep path.
- **KP-S4 — restart-recovery already exists; extend, don't reinvent.** Boot re-hydration (ARCH-006)
  plus systemd `Restart=on-failure` (ARCH-014) remain the self-healing story. v3 only adds: on boot,
  re-probe provisioned MCPs lazily (first reference), and mark stale `running` agents terminal
  (KP-O5) so recovered state tells the truth.

**Agent altitude**

- **KP-S5 — memory metabolism is (correctly) minimal here.** Runs are ephemeral; the journal IS the
  long-term memory and the resume cache IS its compression (longest-unchanged-prefix replay). No
  cross-run agent memory, no periodic memory summarization — consistent with the standing
  "explicitly NOT built" list. The only metabolism needed is KP-S3's retention sweep.
- **KP-S6 — no prompt self-calibration.** Reaffirm the v1 agreement. The closest justified thing is
  already in scope: schema-mismatch retry (ARCH-004) and ProviderProfile effort-mapping config.

---

## Risks

1. **SDK CLI subprocess double-timeout hazard (highest).** REQ-020's outer race vs the CLI's own
   internal retry/backoff: if the outer bound fires and merely abandons the promise, the child keeps
   running — orphaned process, tokens still billed against nothing, agent record already `null`.
   Kill-on-timeout (KP-S1) plus per-attempt token attribution (KP-O6) are the mitigations; without
   them REQ-020 passes its test while budget accounting silently rots.
2. **Secret/observability tension.** KP-O1/O4 log handle names and env shape near code that holds
   values; the CLI child inherits env (it already gets `ANTHROPIC_BASE_URL` + dummy key). One missed
   scrub and a provider key lands in a per-run-readable transcript. Mitigation: SecretResolver is
   the only component that ever touches values; SessionInitRecord is built from handles pre-resolution.
3. **ProviderProfile drift vs reality.** Capability flags are asserted config, not probed truth; a
   provider that starts rejecting a flag combination fails at run time. Accepted: the
   FailureEnvelope makes the mismatch visible in one look, which is the affordable answer at this
   scale (vs a capability-probe subsystem).
4. **Consumability contradiction already on disk.** The committed example config says
   `gateway:"sdk"` (binding D-F5/D1 decision) while the only fully-real-verified local-Ollama path
   today is `direct-fetch`. Until REQ-016/020 land green, DEPLOY.md carries a doc-level fork that
   users WILL mis-follow. Must be resolved within this slice, not documented around.

## Expected disagreements with other lenses

- **vs Adversarial/security**: they will likely push per-run process isolation for provisioned stdio
  MCPs, or a heavier secret sandbox. I hold: admin-provisioned stdio is trusted by decision (REQ-017
  c4); the quality-critical control is the *observable seam* (audit lines, SessionInitRecord) plus
  env-scrub, not more isolation machinery. Expect to concede audit granularity, not new sandboxes.
- **vs Simplicity/Karpathy lens**: ProviderProfile (KP-R1) and ManagedSubprocess (KP-S1) will read
  as speculative structure. Counter: both are reactions to *confirmed real defects* (D-F6 thinking
  400; port collision/orphan/mkdtemp are on the recorded v1.1 backlog), not imagined futures — this
  is debt already incurred, not flexibility purchased.
- **vs Performance/scalability lens**: they may want continuous MCP health polling or proxy pooling.
  I explicitly reject background pollers (KP-S2) and keep the single managed proxy — single-node QM
  tool, per the standing C2 agreement.
- **Where the timeout lives (likely cross-lens)**: some will argue REQ-020 should be solved by
  configuring the SDK/CLI's own retry knobs instead of an outer race. I argue both: configure what
  the SDK exposes, but the *engine-owned* outer bound is non-negotiable — the black-box child's
  policy is not our contract, and self-sustainability cannot depend on a dependency's internals.
- **On metrics/OTel**: any lens proposing a metrics stack re-litigates the "explicitly NOT built"
  list; I defend structured JSONL + correlation ids + the dashboard as sufficient observability at
  this scale.
