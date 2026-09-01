# Design panel r1 — Quality-dimensions lens (v22: REQ-096..100, ARCH-071..076, ADR-009..014)

lens: quality-dimensions (observability / replaceability / consumability / self-sustainability)
round: 1 (independent proposal)
inputs read: 01-requirements.md (v22 section + Round-v22 clarification + carried rules/debt), 02-architecture.md v22 slice (ARCH-071..076, ADR-009..014, 4+1 views, data architecture), state.yaml tech_stack.

## Altitude determination (required first step)

This project is **both** a conventional system and an AI-agent system: the engine is a Node/TS + SQLite
server (system altitude), its *callers* are LLM agents over MCP (ARCH-073's own words: "for an MCP agent
the error text is the documentation"), and it *runs* agents via the Claude Agent SDK. For the v22 slice
specifically: **system altitude dominates replaceability and self-sustainability** (catalog schema,
migration, ceilings — no LLM-backend surface is touched); **agent altitude dominates consumability**
(schema-reading agent clients, error-message-as-documentation); **observability needs both** (run-record
pins for the system; nothing in this slice touches per-agent transcript/token observability, which is
already served by REQ-007 and stays out of scope). Agent-altitude self-sustainability (memory
metabolism, prompt calibration) is **not applicable to this slice** and is not forced below; the one
legitimate mapping is ARCH-074's staleness observation as a tool-liveness analogue.

## Summary

The v22 architecture is unusually strong on this lens's core demands — typed refusals everywhere a
silent fallback could hide (`CHANNEL_UNPUBLISHED` never falls back to newest; `VERSION_CEILING_EXCEEDED`
is a visible refusal, not a silent GC), one resolution moment with a durable pin, pure/injectable new
modules, and a construction-not-deletion projection. I endorse ADR-009..014 as decided and add **design-
level detail the synthesizer owes**, in order of importance:

1. **[LEAD FINDING — a real seam between two ARCH items]** ARCH-074 says `workflow_get` returns
   `validation: {ok, errors[]}` for the served version. ARCH-075's non-owner branch emits **exactly**
   `{name, version, channels, description, params, owner, reportProblem, scriptWithheld}` — **no
   `validation` key**. Scenario S-5 does not say which viewer it describes. Either `validation` is
   owner-only — then a *user* whose run is about to hit a deprovisioned MCP server cannot see why until
   it fails mid-flight, an observability+consumability hole for exactly the non-owner audience v22
   exists to serve — or it joins the allowlist, and `EXPECTED_NON_OWNER_KEYS` plus the two-sided key-set
   oracle must be amended **deliberately**, not discovered red at Gate 5. **Recommendation: include
   `validation` in the non-owner allowlist.** It is environment status (alias/MCP liveness), not script
   disclosure — `errors[].code/message` name an alias or MCP server name the run transcript would name
   anyway, and the declared `params` contract already discloses model knobs. The design must state this
   decision explicitly either way.
2. Pin the **error-code taxonomy and message templates as one shared design item** (one DES table:
   code → producing surface → trigger → message template), tested against the published contract
   literally (v22 Rule 1: exact code strings, message-carries-recipe asserted against the template —
   never "an error is thrown").
3. Make the **unattended-trigger refusal path** land somewhere observable (fire-time
   `CHANNEL_UNPUBLISHED` at 3am must reach the ARCH-046/047 reliability metrics, not vanish).
4. One **structured log/journal line on `publish`** (`catalog.publish {name, channel, from→to,
   principal}`) — the fence-compliant answer to "pointer moves are mutable and unreconstructable"
   (ARCH-072's own admission), explicitly *not* the rejected audit table.

## Dimension 1 — Observability

**Endorsed as designed:** the pin + recorded request shape (`requested: {version}|{channel}|
'default-release'`, ARCH-072) is exactly the "answerable afterwards" property this lens demands — the
channel pointer is mutable state, and without the request shape "why did this cron run v3" is
unanswerable. The ADR-011 migration boot log line and the typed-refusal-over-silent-fallback rule
(`CHANNEL_UNPUBLISHED`, never newest-row) are both silent-failure eliminations. ARCH-074's
"admission observes and records" gives every run a durable validation observation.

**Design detail the synthesizer owes (all cheap, all fence-compliant):**

- **OBS-1 — where the pin/request/validation appear on the wire.** REQ-096 requires `workflow_status`
  to report the version that actually ran. The design must pin the `workflow_status` (and
  `/api/runs/:id`) response shape to carry `{version (the pin), requested, validation}` — the run
  *record* carrying them (ARCH-072) is necessary but not sufficient; an unread field is this repo's
  signature stored-but-never-wired class (resolveHarnessParams, updateFlagPath, auth, workspaceTtlMs).
  Test oracle: literal key assertions on the status response, not "the record has it".
- **OBS-2 — fire-time refusal for unattended triggers (genuine gap).** `Scheduler.create()` refuses a
  schedule that cannot resolve `release` (SUS-5 — endorsed, bought for one line). But a *standing*
  schedule/webhook/chain whose workflow is later deregistered, or whose release pointer is somehow
  NULL, hits `CHANNEL_UNPUBLISHED`/resolution failure at fire time with **no caller present**. The
  design must state where that refusal lands: recommended — a run-refused/trigger-failed journal entry
  attributable to the schedule id, surfaced in the ARCH-046/047 home-dashboard reliability metrics, so
  a 3am refusal is visible at 9am. A log line alone is not a seam a caller can read.
- **OBS-3 — publish traceability, one line not one table.** Add one structured journal/log line on
  every successful `publish`: `{name, channel, fromVersion, toVersion, principal, at}`. Fence check:
  the slice's "no audit table" stands — this is a log line in the existing journal/log stream, zero
  schema, zero query surface; it converts "who moved release under my running fleet" from
  unreconstructable to greppable. The run-record pins alone only show *effects*, not the move.
- **OBS-4 — migration observability.** Pin the boot log line contract (already sketched in the
  deployment view: `catalog.migrate: N workflows → workflow_versions, release published`) **plus** the
  idempotent re-boot shape (second boot logs 0-migrated, not silence, not a second migration) — S-2's
  real-pre-v22-SQLite test should assert both.
- **Agent altitude:** untouched by this slice — per-agent transcripts/tokens (REQ-007) already exist;
  no new agent-side opacity is introduced. Nothing to add; recorded so the dimension is judged, not
  skipped.

## Dimension 2 — Replaceability

**Endorsed as designed:** two new **pure** modules with injected ports (`script-checks.ts` takes
`{aliases, openrouterPassthrough, mcpLookup}`; `workflow-view.ts` is I/O-free; `resolveVersionRequest`
is pure and table-testable with no database) — this is textbook decoupling. `get(name)` **deleted** not
deprecated (compiler finds call sites). ADR-014's "script column stays swappable for a CAS ref later —
a column, not a subsystem" keeps storage replaceable without building it. The LLM-gateway surface is
untouched, so backend pluggability (LiteLLM/SDK/direct-fetch) is unaffected — correct for the slice.

**Design detail:**

- **REP-1 — port shapes are design contracts.** Pin the injected-port types of `validateScriptEntry`
  in 04-design (what exactly `mcpLookup` is: a `(name) => boolean` existence predicate, not the
  registry object) so the module cannot silently grow a concrete dependency on the MCP registry class.
- **REP-2 — one-predicate rule for the frame delimiter.** ARCH-074 reuses `FRAME_CLOSE_FORGERY` from
  `params/contract.ts` (P6-2's registration half). Design must require the QD-REP-1-style structural
  pin: the predicate is *imported*, and a grep-style test asserts no second regex copy under `src/` —
  the exact mutation-checked precedent from v21 P6-5/QD-REP-1.
- **REP-3 — wiring is definition-of-done, not discretion.** ARCH-071 note (8) already mandates it;
  restated here because it is this lens's marquee failure class (composeConfig bug, five instances):
  the catalog's new alias/MCP deps threaded in `main.ts` **and** added to
  `compose-config-v2-wiring.test.ts` in the *same change* as the constructor gains parameters. Ditto
  `maxWorkflowVersions` through `composeConfig()` — a new config key is precisely the class's trigger.

## Dimension 3 — Consumability

**Endorsed as designed:** callers here are agents, and the architecture already treats error text as
documentation (`INLINE_SCRIPT_CLOSED` carries the `register → run({name})` recipe); the author loop is
two calls with no lookup (`register` returns `{version}`); the non-owner view is a *positive* statement
(`scriptWithheld: true`, distinct key, no type-narrowing trap) carrying everything a user needs
including `reportProblem` and the declared params contract; schema-level + runtime-level closure are
asserted separately in the ARCH-051 drift-lock.

**Design detail:**

- **CONS-1 — every new typed error carries its next step (message-template table).** One DES item, a
  single table shared by all tasks: `INLINE_SCRIPT_CLOSED` (recipe — already pinned),
  `CHANNEL_UNPUBLISHED` (names the channel **and** what is published: which channels have versions,
  and — see fence check below — the available `versions[]`), `UNKNOWN_VERSION` (names known versions),
  `INVALID_CHANNEL` (names the closed enum `beta|release`), `VERSION_CEILING_EXCEEDED` (names both
  remedies — see SUS-1), `NOT_WORKFLOW_OWNER` (unchanged). Fence/disclosure check: listing
  versions/channels in error detail widens nothing — `versions[]` and `channels{}` are already on the
  REQ-096 `workflow_list` allowlist served to everyone. Test oracle per v22 Rule 1: the message is
  asserted against the published template literally.
- **CONS-2 — `workflow_get({name})` on a never-published name.** Per ARCH-076 it returns
  `CHANNEL_UNPUBLISHED` — while `workflow_list` shows the name. An agent that lists then gets will hit
  an error on a perfectly real workflow. Right call (no silent newest-fallback), but the design must
  make the error *sufficient to proceed*: CONS-1's detail (available versions + which channel is
  published) turns the dead end into a one-step recovery (`workflow_get({name, version})`). Assert
  this exact sequence in a test: list → get(name) errors → get(name, version-from-error) succeeds.
- **CONS-3 — inputSchema descriptions are the agent's manual.** `version?`/`channel?` on
  `workflow_run` and `workflow_get` must carry description strings stating the precedence (`version`
  wins; `channel` defaults to `release`; registration ≠ publication) — a schema-reading agent should
  not need DEPLOY.md to use the channel system. These strings join the ARCH-051 structured drift-lock
  like the rest of the schema.
- **CONS-4 — the lead finding again, from the consumer side.** If `validation` is owner-only, a user
  selecting between `beta` and `release` cannot see that beta references a deprovisioned MCP server;
  they find out mid-run. Include `validation` in the non-owner view (recommendation above) and amend
  `EXPECTED_NON_OWNER_KEYS` deliberately.

## Dimension 4 — Self-sustainability

**Endorsed as designed (system altitude):** the ADR-011 migration is atomic/idempotent/restart-safe —
half-applied states unrepresentable (self-healing by construction, and the single highest-value line in
the slice per its own ADR); ADR-014 bounds growth at the front door with a visible refusal instead of a
silent GC that would dangle run pins; register/publish transactions close the cross-process
(self-update overlap) lost-update window; `deregister` degradation is specified to fail soft (pin
string survives, DAG falls back to live nodes) rather than discovered.

**Agent altitude, scoped honestly:** memory metabolism / prompt calibration are not touched by this
slice and are not force-fitted. The one legitimate mapping: ARCH-074's admission/read-time staleness
recompute **is** this system's tool-liveness probe — `MCP_NOT_PROVISIONED` surfaced on `workflow_get`
is "probe that the API still works" for a workflow's tool surface, done lazily at the read/admission
seam instead of a background prober. Endorsed; a background liveness sweep would breach the fence
(zero new background jobs) for no requirement.

**Design detail:**

- **SUS-1 — the ceiling dead-end, softened but real.** `maxWorkflowVersions` is operator config, so
  the ceiling is raisable — the *narrow* residual is author ≠ operator: at the ceiling the author's
  only self-service path is `deregister` (destructive: removes all versions, unpublishes channels,
  dangles pins). Design requirements: (a) `VERSION_CEILING_EXCEEDED` message names **both** remedies
  (operator raises `maxWorkflowVersions`; owner deregisters — with its stated consequences); (b) an
  owner-gated `workflow_prune({name, version})` (refusing channel-pointed/run-referenced versions) is
  named as a **future requirements decision, not designed now** — it breaches the slice fence ("one
  new MCP tool" is already spent on `workflow_publish`). ADR-014's GC-ready schema makes it cheap
  later; the message text makes the dead-end survivable now.
- **SUS-2 — degradation shapes are test-pinned, not prose.** Three fail-soft claims in the ADRs
  deserve explicit tests: deregistered-name pin survives on the run record and status still renders;
  the dashboard DAG falls back to live agent nodes when the pinned version is gone (ARCH-042 fallback
  actually covering this shape); a pre-v22 suspended run with persisted `spec.script` resumes
  (ARCH-072 invariant 3 — the strand-avoidance floor).
- **SUS-3 — Scheduler.create's resolves-release check.** Endorsed (a schedule that can never fire is
  refused at creation, not at 3am). Design owes the refusal's error shape (reuse `CHANNEL_UNPUBLISHED`
  with a `context: 'schedule_create'` marker or equivalent — one taxonomy, per CONS-1, no new code).
  Pairs with OBS-2 for the standing-schedule case creation-time checks cannot cover.

## Task-splitting notes (03-tasks.md does not exist yet)

1. **Wiring travels with the constructor.** ARCH-071's catalog task must *include* the `main.ts`
   threading + `compose-config-v2-wiring.test.ts` additions (both the new catalog deps and
   `maxWorkflowVersions`) as its own DoD — never a separate "wiring task" that can be dropped (note 8
   says so; this lens co-signs with the five-instance bug-class history as the reason).
2. **The real-transport masking test is DoD of ARCH-073's task**, not a generic later test task — a
   facade-level test with an injected principal cannot see the `server.ts:823` hole (ARCH-073's own
   lesson); the task is not done until the authenticated non-owner over real HTTP asserts
   `EXPECTED_NON_OWNER_KEYS`.
3. **TDD order: pure first.** `resolveVersionRequest` truth-table units and `projectWorkflowForRead`
   key-set units are cheap, database-free, and pin the two external contracts (v22 Rule 1) — they
   should be the first RED tests written, before the catalog/schema tasks they constrain.
4. **The error-taxonomy/message-template table (CONS-1) is one shared DES item** referenced by every
   task that produces a typed error — split it across tasks and the codes drift.
5. **S-2's migration test needs a real pre-v22 SQLite fixture file** (the scenario says so); the task
   owning ADR-011 must budget producing one from a pre-v22 checkout, not synthesize it with the new
   code.

## Risks

- **R1 (lead):** `validation` key unreconciled between ARCH-074 and ARCH-075's allowlist — if left to
  Gate 5, either the key-set oracle goes red "unexpectedly" or non-owners lose staleness visibility
  silently. Decide in 04-design; recommendation: include it.
- **R2:** fire-time resolution refusal for unattended triggers lands nowhere a human looks (OBS-2) —
  a silently dying cron is this lens's definition of a design defect.
- **R3:** ceiling dead-end for author≠operator deployments (SUS-1) — survivable via message text now,
  prune later; unacceptable only if the message names no remedy.
- **R4:** publish-pointer history unreconstructable (OBS-3) — one journal line closes it; without it,
  operator debugging of "which version was release at time T" relies on inference from run pins.
- **R5 (accepted, recorded):** `workflow_list` excluded from validation recompute (3s poll × per-row
  parse) — right trade; the on-demand `workflow_get` recompute is the seam. No action.

## Expected disagreements with other lenses

- **Adversarial/security lens** will likely want (a) admission to *enforce* the environmental checks
  fail-closed rather than observe — I side with ADR-013: two enforcement gates that can disagree is
  the exact divergence REQ-099 deletes, and the grandfathering clause forbids retroactive refusal;
  and (b) may read CONS-1's error details (listing versions/channels) as disclosure widening — it is
  not: both are already on the everyone-visible `workflow_list` allowlist per REQ-096.
- **Minimalist/Karpathy lens** will call OBS-3 (publish log line), CONS-1 (message templates), and
  SUS-1(a) (richer ceiling message) additions. Each is strings-and-one-log-line inside the declared
  fence (zero tables, zero endpoints, zero jobs, zero tools); the audit table stays rejected and
  prune stays undesigned. If forced to drop one, drop OBS-3 last — it is the only one covering a
  stated unreconstructability.
- **Data/schema lens** may prefer recording `validation` observations in a dedicated column vs. the
  run record JSON — this lens is indifferent to storage shape, only to the wire shape (OBS-1) being
  pinned and read.
- **On the lead finding**, a security lens may argue `validation` errors leak environment topology
  (MCP server names) to non-owners; counter: the declared `params` contract and run failure modes
  already surface these names to users running the workflow, and withholding them only moves the
  discovery to a failed run.
