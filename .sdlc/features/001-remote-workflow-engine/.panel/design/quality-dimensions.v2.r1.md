---
lens: quality-dimensions (observability / replaceability / consumability / self-sustainability)
stage: design (v2 refinement — ARCH-009..014 / TASK-018..027)
round: r1 (independent proposal)
model: sonnet-5
---

# Quality-dimensions review — Design stage, v2 (Remote Workflow Engine)

## Altitude determination

This project is **both** a plain system and an AI-agent system, and the split is clean along the
existing module boundary: the *trusted parent* (MCP Facade, Run Manager, Run Store, Catalog,
Scheduler, Dashboard, Asset Sync, Auth) is conventional server software — apply the **system**
altitude. The *agent-execution slice* (Agent Executor over the Claude Agent SDK, the GatewayClient
port to LiteLLM/Anthropic/OpenAI/Gemini/Ollama, per-`agent()` transcripts/budget) is a genuine
AI-agent runtime — apply the **agent** altitude. Both altitudes are applied below, per dimension,
because both are load-bearing in this codebase (confirmed by tech_stack: two GatewayClient impls,
AgentTranscriptSink, ajv schema retry, agentType registry — this is not a thin LLM-call wrapper).

v1 (ARCH-001..008) is DONE, validated, and Gate 8-closed per `state.yaml` — I do not re-litigate it
except where a v1 decision or a v1.1-backlog item directly constrains v2 design. My scope is the six
v2/v3 extension modules: ARCH-009 Auth (no-op v1/v3), ARCH-010 Scheduler, ARCH-011 Dashboard,
ARCH-012 Asset Sync, ARCH-013 Client Plugin, ARCH-014 Deploy Packaging.

**Task-splitting note**: `03-tasks.md` already reflects the fine-grained v2 split (TASK-019/024
scheduler CRUD-vs-firing-engine, TASK-020/025 dashboard VM-vs-transport, TASK-021/026 asset
core-vs-McpProbe, TASK-022 client plugin, TASK-023/027 deploy-vs-hardening). This split is good news
for my lens specifically: it separates the *pure, UT-able* half of each module (TASK-019/020/021,
easy to keep correct and easy to reason about) from the *networked/time/OS-boundary* half
(TASK-024/025/026/027, where my dimensions' real risk concentrates — a scheduler's clock seam, a
live MCP probe, a subprocess-lifecycle hardening task). Below I anchor each observation to the
specific fine-grained task it belongs to, not just the coarse ARCH module, since a synthesizer
folding my asks into the wrong half (e.g. an observability ask landing on the pure TASK-020 VM
instead of the transport-carrying TASK-025) would misplace the seam.

---

## (1) Observability

**System altitude**
- ARCH-011/TASK-020+025 Dashboard is *the* v2 observability surface, but its trace only reaches
  REQ-008 (runs/agents over the Run Store). Two v2-native state machines have **no described
  observability surface at all**: the Scheduler's own state (next-fire time, last-fire result,
  enabled/disabled, misfire — owned across TASK-019's CRUD and TASK-024's firing engine) and Asset
  Sync's asset health (which pushed skills/hooks/MCP configs are currently live vs. broken, owned by
  TASK-021 core + TASK-026 McpProbe). Recommend: extend `buildDashboardModel` (TASK-020, still pure —
  it just needs `ScheduleStatus`/`AssetHealth` shapes as additional inputs) and TASK-025's read-only
  HTTP surface to serve them, or an explicit MCP query tool (`schedule_status`, `asset_list` with a
  `health` field) if wiring into the dashboard proper is deferred. A silently-not-firing cron
  schedule is exactly the "silent/opaque failure = design defect" case this lens exists to catch.
- Every run must carry its *origin* (`triggeredBy: manual | cron | one-shot | resident`) end-to-end
  into the journal/dashboard. TASK-019/024's note says scheduled/triggered runs "start via the same
  code path as a manual `workflow_run`" — good for zero-kernel-rework, but the trace field itself
  isn't specified in either task. Without it, a run in `workflow_list` is indistinguishable from an
  unexpected duplicate fire, undermining the "bottleneck/anomaly locatable in seconds" goal.
- Restart/self-heal events (TASK-023/027's deploy hardening) should themselves be a visible fact, not
  just an OS-level side effect — ARCH-006 already emits one boot-recovery log line; recommend the
  same line (plus TASK-027's orphan-reap outcome) be surfaced through the dashboard/status tool so an
  operator can see "this instance restarted N times, reaped 1 orphan LiteLLM" without shelling in.

**Agent altitude**
- v1 already closed the big gap here: AgentTranscriptSink captures the real message/tool_call/
  tool_result stream and is live-tail-able per REQ-008's "live-updating agent states." That is the
  correct target state for this dimension — no v2 action needed on the capture path itself, only on
  confirming TASK-025's transport actually renders it live (test-first stage, not just "viewable").
- Carry-forward risk from the v1.1 backlog (`07-review.md`): an aborted `AgentRecord` never
  transitions out of `'running'`. Cosmetic in v1-backend-only terms, but becomes a *dashboard-
  integrity* bug once TASK-025 ships — a live dashboard showing a permanently-running agent for a run
  that's actually `stopped` is a worse observability defect in v2 than it was as a backend quirk in
  v1. Recommend folding this into TASK-020's acceptance criteria explicitly, not leaving it implicit.

---

## (2) Replaceability

**System altitude**
- Scheduler (TASK-019/024): resist over-engineering — an in-process cron implementation is
  appropriate for this QM/single-node system (matches the architecture doc's own "explicitly not
  built: autoscaling, distributed budget consensus" stance). No pluggable scheduler backend is
  warranted; flagging this explicitly so a future reviewer doesn't manufacture an unneeded interface.
  The one seam worth keeping clean — and TASK-024 already names it correctly — is the injected
  `Clock`/`Ticker` port: *trigger* (timer fires) stays decoupled from *execution* (same
  `workflow_run` path), and every time-reading method takes the injected Clock (no
  `get_due`/`rearm` asymmetry, per the task's own note). Good seam discipline, nothing to add.
- Deploy Packaging (TASK-023/027): the docker-compose/systemd bring-up must not silently re-couple
  the product to LiteLLM as a hard dependency. `state.yaml`'s validation history shows the LiteLLM
  path has been the single largest source of real operational pain (Python 3.11/3.12 pin,
  prebuilt-wheel availability, orphan subprocess, port collisions) while the `direct-fetch`/
  `ClaudeAgentSdkGatewayClient` paths are the ones repeatedly *real-verified clean*. TASK-023's note
  already commits to a "LiteLLM-optional profile" — good, this is exactly D2's "gateway interface
  abstracted so it can be replaced later" promise being honored at the packaging layer, not quietly
  foreclosed by ops defaults. Confirm the profile ships in the actual compose file, not just DEPLOY.md
  prose.

**Agent altitude**
- The core promise (GPT↔Claude↔local is a config change) is real and already delivered by
  `GatewayClient`/D2 — solid v1 work, nothing to add architecturally for v2.
- One real erosion risk surfaced by the validation history: the two `GatewayClient` implementations
  have **drifted in feature parity** — abort/cancellation signal wiring was done for
  `ClaudeAgentSdkGatewayClient` (D-F9a) but explicitly *not* wired for `LiteLLMGatewayClient`
  ("matches D-F7's identical scoping, not a gap" — self-declared, repeatedly). Each such scoping
  decision is individually reasonable, but stacked up they mean the port's two implementations are no
  longer behaviorally interchangeable — swapping gateways is no longer "a config change" for every
  feature, contradicting the D2 goal this dimension is graded on. This is not owned by any current
  v2 TASK (018-027) — it is a v1-delivered-module carrying forward a latent defect that v2 tasks
  don't touch. Recommend a v2 design item (attach to TASK-023, since deploy packaging is where a
  deployer chooses/switches gateways): either (a) a parity checklist/contract test asserting both
  `GatewayClient` impls honor the same interface behaviors (abort, timeout, correlation-tag,
  thinking-policy), or (b) an explicit, documented decision that one implementation is now primary
  and the other a constrained fallback — either is fine, but the current state (implicit, scattered
  across route-back notes) is not.

---

## (3) Consumability

**System altitude**
- v1 already reached the right end-state after the Gate 8 fix (D-G8-3): every MCP tool now has a
  real description + real `inputSchema.properties/required`, not a name-echoing placeholder. **v2
  must not repeat that mistake for its new tools.** TASK-019's `schedule_create/list/delete` +
  `workflow_trigger`, and TASK-021's `asset_push/list/delete`, need real schemas from day one — call
  this out explicitly in those tasks' acceptance so it isn't discovered as a review finding a second
  time.
- Asset Sync's rejection path ("non-runnable config rejected with a reason") should return a
  **machine-readable reason code**, not just a human string. TASK-026's note already gets this right
  ("rejected with a machine-readable reason CODE (not just a human string; consumability)") — good,
  this is the McpProbe task correctly inheriting ARCH-001's uniform-envelope rationale. No further
  ask here beyond confirming TASK-021's `{stored[], excluded[{name,reason}]}` envelope uses the same
  coded-reason convention for its own recursion-guard/path-safety rejections, not just TASK-026's
  probe rejections — one consumer of Asset Sync shouldn't see two different error-shape conventions
  depending on which half of the split rejected the push.
- Deploy Packaging / consumability-for-operators: the documented Python-version pin for LiteLLM
  (3.11/3.12 specifically) is real integration friction found during validation, not hypothetical.
  TASK-023's note already commits to "DEPLOY.md leads with the dependency-free path" — good, adopt
  as-is; this is the same fix serving both this dimension and replaceability above.

**Agent altitude**
- Structured, typed `agent()` I/O (ajv schema + retry) is already solid; no v2 change needed.
- Client Plugin (ARCH-013/TASK-022) is the delivery vehicle for this dimension at the agent altitude
  — it already specifies teaching the async submit→poll→fetch pattern, the single easiest thing for
  a calling agent to get wrong (treating `workflow_run`'s immediate `runId` as the result). Good
  design as written; the only addition is that the guidance skill should also teach the *new* v2
  tools' equivalent gotchas (e.g., `workflow_trigger` on a disabled resident workflow returns an
  error envelope, not an exception — same "branch on envelope" lesson, extended to the v2 surface).

---

## (4) Self-sustainability

**System altitude**
- Deploy Packaging's `Restart=on-failure` (TASK-023) is the correct minimal self-healing seam for a
  single-node QM system (no custom watchdog needed) — good, already decided.
- **Real, repeatedly-reproduced, still-open operational hazard**: the orphan LiteLLM subprocess on
  shutdown, plus the hard-coded port-4000 collision risk between a stale orphan and a freshly-booted
  instance. Found and re-confirmed across *multiple* Gate 7.5 rounds. TASK-027 is now the
  purpose-built task for exactly this (process-group cascade-kill on SIGTERM/SIGINT, configurable
  LiteLLM port, pre-bind port liveness check) — this is the right fix in the right place; my only ask
  is that TASK-023's smoke check explicitly asserts it (the task note already says so: "boot→run→
  shutdown→assert no leaked child, no port clash") — keep that assertion in the smoke script itself,
  not just as prose in DEPLOY.md, so a regression here is caught by CI, not by the next Gate 7.5 round.
- Scheduler catch-up semantics: TASK-024's note already resolves this ("cron = fire-once-on-catch-up-
  then-resume, never backfill every slot; one-shot past-`at` = fire-immediately then auto-complete")
  — good, this closes what I would otherwise have flagged as undefined behavior. Confirm this is
  exercised by an actual test (advance a fake Clock/Ticker across a missed window) rather than only
  asserted in the task note.
- Asset Sync's `AssetValidator`/McpProbe (TASK-026) live-probes **only at push time** per its own
  note. A pushed MCP config valid today can silently rot (upstream npx package updates, remote HTTP
  MCP goes down) with no signal until a workflow run fails days later, unattributed. This is the
  system-altitude twin of "tool liveness checks" below — recommend at minimum a lazy pre-flight
  re-probe immediately before a workflow's first use of that asset in a run (cheap, no background
  polling needed, keeps the unauthenticated-v2 attack surface unchanged), surfaced through the
  Observability recommendation above (asset health view). I flag this knowing it is the most likely
  point of cross-lens disagreement (see below).

**Agent altitude**
- Memory metabolism: correctly out of scope as a *framework* concern — "explicitly not built:
  cross-run agent memory" is the right call for this QM tool, and REQ-013's per-workflow persistent
  work folder is the actual mechanism by which a resident/cron workflow can carry state across runs
  if the *script* chooses to. Worth stating this explicitly as the resolved design answer (folder =
  the memory-metabolism seam, by delegation to the script) rather than an implicit non-decision a
  later reviewer flags as a gap.
- Tool-liveness / self-reflection: the provider-down circuit breaker (bounded timeout→retry→`null`,
  ARCH-005/D-G) is real, real-verified, and Scheduler-triggered runs inherit it for free via the
  shared code path — genuine v2 leverage from v1 investment, worth stating as a strength, not a gap.
- One real inconsistency worth a v2 decision: Asset Sync (TASK-021) lets operators push new
  skills/hooks/MCP configs into the live server-side workspace with **no restart required**, but
  `agentType` definitions (`agents/*.md`) are loaded once at `createServer()` boot and never
  hot-reloaded. An operator used to "assets sync live" will reasonably expect editing an agent's
  system prompt to also take effect live, and it silently won't. Recommend either (a) TASK-021 folds
  agent-definition directories into the same hot-sync path, or (b) this asymmetry is explicitly
  documented as a known boundary (agents require restart, other assets don't) — either is acceptable,
  silence is not.

---

## Risks (ranked)

1. **Orphan LiteLLM subprocess + port collision** — real, reproduced across 4+ validation rounds.
   TASK-027 is the right owner; risk is now "specified but not yet CI-asserted," not "unowned."
2. **GatewayClient parity drift** (abort/cancellation, timeout, thinking-policy wired inconsistently
   between the two implementations) — replaceability erosion; currently owned by no v2 task at all
   (it's a v1-delivered latent defect, not covered by TASK-018..027); needs an explicit decision.
3. **Scheduler/Asset Sync have no observability surface** despite TASK-024 resolving their internal
   semantics (catch-up policy) — internal correctness without external visibility is still an opaque
   system to an operator.
4. **v2's new MCP tools repeating the v1 placeholder-schema mistake** (D-G8-3 finding) if schema
   discipline isn't stated as an explicit acceptance line in TASK-019/021 (TASK-026 already gets this
   right for its own probe-rejection codes).
5. **Asset liveness is push-time-only** (TASK-026) — no design signal for post-push drift detection;
   compounds with risk #3's dashboard gap.
6. **agentType vs. asset hot-reload asymmetry** — confusing operator UX, silent-failure-shaped (an
   edited agent prompt appears to "not work" with no error).
7. **Deploy-doc friction from the LiteLLM Python-version pin** — a consumability/replaceability risk
   more than a correctness one, but real (found live during validation, not speculative), and TASK-023
   already commits to the right doc-ordering fix.

## Expected disagreements with other lenses

- **Security/adversarial lens** will likely resist my asset-liveness recommendation (even a lazy
  pre-flight re-probe) as unwanted-in-v2 additional outbound traffic against an explicitly
  unauthenticated (D5/C4) service — expect a push to defer any re-probing behavior to v3 (post-auth)
  and keep TASK-026 push-time-only. I'd counter that a *lazy, on-first-use* probe (not a background
  poller) doesn't change the exposed attack surface, only the honesty of already-granted trust, but
  expect this to be a genuine contention point the synthesizer has to arbitrate.
- **Testability/simplicity lens** will likely flag the GatewayClient parity-test ask as scope creep
  for a QM-class v2 slice, arguing "document the gap, don't build a fix" for something v2's own tasks
  don't touch. I'd accept "document the decision" as sufficient given it's genuinely outside
  TASK-018..027's boundary, but hold that it needs to land *somewhere* (e.g. as a new backlog item
  attached to TASK-023) rather than staying an implicit, scattered set of route-back notes.
- **Architecture's own "explicitly not built" list** (autoscaling, distributed consensus, pluggable
  DB/sandbox) could be invoked to wave off any residual orphan-subprocess concern as "operational
  hygiene, not core-system flexibility, out of scope" — I'd disagree if raised, since TASK-027 already
  exists precisely because this was a reproduced defect, not a hypothetical future need; the
  disagreement, if it surfaces, is more likely to be about whether the *smoke-check assertion* is
  strict enough, not about whether the fix belongs in scope.
- General tension to expect across the panel: my dimension pushes for *more* v2-visible state
  (schedule status, asset health, origin-tagged runs) while other lenses will weigh v2 scope
  discipline given v1's long, hard-won stabilization history recorded in `state.yaml` — expect the
  synthesizer to trim my "extend the dashboard model" ask down to "MCP query tool only, dashboard
  wiring deferred" as a reasonable compromise, and to treat the `triggeredBy` origin tag as the one
  non-negotiable item (it's a one-field addition to an existing record, not new surface).
</content>
