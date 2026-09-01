# Architecture panel — Quality-dimensions lens, round 1 (independent proposal)

**Scope**: v22 slice, REQ-096..100 (catalog version history + run-pinned versions; beta/release
channel pointers; closing inline script; moving submission-time static checks to registration;
masking `workflow_get` for non-owners). Plus the two debt items the Round-v22 note explicitly
invites into this slice (S-1 registration ceiling; P6-2's registration half).

**System-vs-agent determination (required first)**: this project is **both**, but the balance is
**flipped from v21 — the *system* altitude dominates v22**. The slice's subject matter is catalog
schema, channel pointers, MCP tool-surface shape, and read-boundary masking — conventional
system/API work on the hand-rolled JSON-RPC-over-HTTP server + SQLite catalog. The *agent* altitude
stays live in two places and is applied only there: (a) observability — the run record must carry
version/channel **provenance** so what an agent actually executed with is inspectable, exactly like
v21's harness descriptor; (b) consumability — the callers of this surface are themselves MCP agents
that learn the API **from the tool schema alone** (D-G8-3), so schema and error text are the UX.
The LLM-backend-replaceability question (GPT↔Claude↔local) is untouched by this slice — already
settled by the alias/gateway architecture — and is not re-litigated here.

## Summary

v22's five requirements are all **read/resolve-boundary work on the catalog**, and the dominant
architectural danger is this codebase's own signature failure class: **stored-but-never-wired**
(`resolveHarnessParams` zero callers, v11 `updateFlagPath`, v15 `auth`, v16 `workspaceTtlMs` — the
composeConfig wiring bug class). The v22 instance is concrete and predictable: the catalog grows
`(name, version)` rows and channel-pointer columns, while the run path keeps calling
`catalog.get(name)` (today's single-row read, `workflow-catalog.ts:246-259`) and silently runs "the
newest script" — making REQ-096/097 inert metadata that every echo surface happily displays. All
four dimensions below converge on the same architectural objects: **one channel-resolution
function** used by every script-entry path and **recorded at admission into the run record** (the
pointer is mutable, so post-hoc reconstruction is impossible); **one masking projection at the
catalog read boundary** (four read surfaces must agree or REQ-100 is side-steppable); a
**registration-vs-admission split of the static checks** into intrinsic (parse — registration-only)
vs environmental (alias/MCP — recheck at admission, because they go stale); and an **explicit
retention decision** for the engine's first unbounded-by-design store. Secondary but real: closing
inline script (REQ-098) deletes the author's inner dev loop (and REQ-006's edited-script resume)
without naming a replacement — the sanctioned loop must be designed, not left to emerge.

---

## 1. Observability — transparency of internal state (folds in traceability)

*System altitude primary; agent altitude in the run-record provenance points.*

- **OBS-1 (admission-time provenance, the non-negotiable).** Channel pointers are mutable state:
  after `workflow_publish` moves `release` from v3 to v5, nothing in the world can reconstruct which
  version a past run resolved — unless it was recorded when it happened. The run record must pin, at
  admission: `{name, requestedVersion? | requestedChannel?, resolvedVersion, resolvedAt}`. REQ-096's
  acceptance already demands the pinned version; this lens adds: record the *request shape* too
  (explicit version vs channel vs default-release), because "user asked for beta and got v4" and
  "user asked for nothing and release pointed at v4" are different diagnoses for the same bad run.
  This must cover **every** entry path: `workflow_run`, `workflow_trigger`, scheduler-fired
  (`scheduler-engine.ts`), webhook-fired (`webhook-registry.ts`), chain-fired, and the **nested
  `workflow('name')` call inside a running script** (REQ-014) — one cron schedule legitimately
  produces runs of *different* versions over time, and only per-run pinning makes that followable.
- **OBS-2 (publish is an event, not a mutation).** `workflow_publish` moving a pointer is exactly
  the kind of state change that explains a cluster of failed runs three days later. It needs an
  audit trail: who (principal, per REQ-086 attribution), when, channel, from-version → to-version —
  a small append-only table or journal entries, surfaced in `workflow_get`/dashboard as "channel
  history". Without it, "all my users broke at 14:02" is undiagnosable in seconds, which is this
  dimension's stated bar. Cheap now (one INSERT next to the pointer UPDATE), unreconstructable later.
- **OBS-3 (the REQ-099 staleness seam must be designed, not implied).** REQ-099 says a pre-v22
  workflow that would now fail the checks is "surfaced (observable, not silently swallowed)" — but
  no seam is named. Propose: a `validation` field on the catalog row, recomputed opportunistically
  (on read / on admission), returned by `workflow_get`/`workflow_list` (e.g.
  `validation:{ok:false, errors:[{code:'MCP_NOT_PROVISIONED', name:'…'}]}`) and copied into the run
  record when such a workflow is run anyway. A log line is not a seam; the author must be able to
  *query* which of their workflows went stale. Note this seam is **general, not migration-era-only**
  — see SUS-3.
- **OBS-4 (masking must be an honest, distinguishable state).** REQ-100 already requires "says the
  script is withheld rather than pretending the workflow has none" — architecturally this means the
  masked projection carries an explicit marker (e.g. `scriptWithheld: true`), never `script: ""` or
  an absent key that a client can't distinguish from an empty workflow. Same marker on all four read
  surfaces (see REP-2).
- **OBS-5 (oracle-independent contract pins — Rule 1 of the Round-v22 note applied).** The two
  external contracts this slice creates — channel-resolution semantics (explicit version › channel ›
  default release; unpublished channel → typed refusal, never fallback-to-newest) and the masked
  `workflow_get` response shape — must be pinned by **literal fixture assertions** (expected JSON
  written out by hand), not by comparing the code's output to the code's own helper. v21 paid for
  this lesson four times; v22's two contracts are named in the requirements doc itself.

## 2. Replaceability — decoupling & pluggability

*System altitude. The LLM-gateway pluggability story is out of this slice's blast radius.*

- **REP-1 (one ChannelResolver, injected everywhere a script enters a run).** A single pure module
  — `resolveWorkflowVersion(catalog, name, {version?, channel?}) → {script, version, defaults,
  params} | typed error` — consumed by `workflow_run`, `workflow_trigger`, scheduler, webhook,
  chain, nested `workflow()` resolution, and resume's re-read path (resume: explicit-version mode
  only — it re-reads the version pinned at admission, never a channel, per CON-3). This is the structural guard
  against the stored-but-never-wired class (OBS-1's failure mode): if resolution logic lives in one
  place, the "run path still calls the old `catalog.get(name)`" bug becomes a compile-visible
  missed-call-site rather than five independent chances to forget. The guard test is REQ-096's own
  acceptance asserted **at the seam** (run record pins the resolved version after a newer
  registration lands) — the only assertion shape that Gate 7.5 history shows actually catches this
  class. The old single-row `get(name)` should be **deleted**, not kept alongside — a surviving
  legacy read path is exactly how the wiring class recurs.
- **REP-2 (one masking projection at the catalog read boundary).** REQ-100 demands consistency
  across `workflow_get`, `workflow_list`, `/api/workflows*`, and the dashboard. Per-endpoint
  masking WILL drift (the dashboard renders from its own store reads). Propose two projection types
  at the catalog boundary — `WorkflowOwnerView` (has `script`) and `WorkflowPublicView`
  (**no script field in the type at all** — unrepresentable, the same pattern v21 used for the
  closed `overrides` object) — with a single `projectFor(principal, row)` function. Every read
  surface consumes projections, never rows. Masking then cannot be side-stepped by asking a
  different endpoint, because no endpoint ever holds an unmasked row for a non-owner.
- **REP-3 (the static checks move as one module, not as a copy).** The `if (spec.script)` block in
  `submission-validator.ts:92` (parse/checkMeta, alias extraction, MCP-name extraction) becomes a
  `validateScriptEntry(script)` module invoked wherever a script enters the engine: registration
  now (REQ-099), and v23's analyzer agent later (it will read scripts too). Forking a second copy
  for registration while the submission validator keeps its own would recreate the divergence this
  slice exists to close. REQ-099's "no code path performs these checks only for inline scripts"
  should be pinned by asserting the *module* has exactly the intended call sites.
- **REP-4 (migration as a discrete, replayable step).** The `(name)` → `(name, version)` PK change
  plus channel-pointer backfill should be a self-contained, idempotent migration unit (REQ-096's
  acceptance already demands idempotent/restart-safe) — keyed and ordered like the existing store
  migrations, so a future schema change (v23 stores per-version diagrams — already known!) composes
  on top rather than re-touching this one. Design the version table so v23's per-version diagram
  column/table attaches without another PK migration.

## 3. Consumability — ease of use & low integration cost

*Agent altitude strong here: the consumers are MCP agents that learn the surface from
`tools/list` schema + typed errors alone (D-G8-3). The schema IS the product.*

- **CON-1 (schema-level closure, not runtime-level).** REQ-098 is explicit: `script` is *removed
  from the input schema* of `workflow_run`/`workflow_resume` so a schema-reading client never
  learns it existed — mirroring v21's "locked keys are unrepresentable" pattern. A runtime refusal
  with the parameter still advertised would be a consumability defect (the schema would teach a
  path that always fails). The refusal for callers who try anyway must carry the migration recipe
  in the error text (`register → run({name})`), per REQ-098's own acceptance.
- **CON-2 (the new surface's error taxonomy is part of the contract).** `workflow_publish` (new
  tool: name/version/channel, owner-gated via existing `NOT_WORKFLOW_OWNER`), plus typed
  `CHANNEL_UNPUBLISHED` (names the channel), `UNKNOWN_VERSION`, `INVALID_CHANNEL`. Each error
  self-describing enough that an agent self-corrects in one round-trip (the v21 standard: carry the
  violated bound / the valid set). `workflow_list` grows `versions[]` + per-channel pointers —
  document the shape in the tool description since MCP has no output schema.
- **CON-3 (name the inner-loop regression and design its replacement — the slice's biggest UX
  hole).** Closing inline script kills two things: the ad-hoc dev loop (today a main usage route,
  acknowledged at Gate 1 Q1) and **REQ-006's edited-script resume** ("resume with an edited script
  re-runs from the first changed agent() call"). Nothing in REQ-096..100 replaces them. The
  sanctioned author loop must be stated as architecture, not left to emerge: **register (draft
  version, on no channel — safe by REQ-097's "registration ≠ publication") → run
  `{name, version}` → iterate**, i.e. two MCP calls per iteration. To keep that loop tight:
  `workflow_register` must return the assigned version (it already returns `{version}`) so an agent
  chains register→run without a `workflow_get` in between; and edited-script resume becomes
  "register new version → `workflow_resume({runId})` semantics against the new version" — a design
  decision the panel must make explicitly (does resume re-resolve, or stay pinned? This lens says:
  **stays pinned to the admitted version by default**, consistent with v21's "resume reuses its
  pinned admission-time snapshot", with the cached-prefix-rerun path taking an explicit
  `{version}`). Also update REQ-006's text or record the supersession — a requirement contradicting
  the shipped schema is a traceability defect.
- **CON-4 (the no-principal matrix, written once).** Auth-disabled single-operator is the compat
  floor (REQ-100: behaves pre-v22). But versioning/channels still function without auth. Spell out
  the matrix — auth off: register/publish/get-with-script all allowed, masking dormant; auth on:
  ownership gates publish + unmasked get — in one table in the architecture doc and the plugin
  guidance skill, so the client-side agent doesn't have to discover it by probing errors.
- **CON-5 (version identifiers stay engine-assigned).** Keep the current monotonic
  `v<n>` assignment (`workflow-catalog.ts:205`) rather than author-chosen strings: sortable,
  collision-free, and an agent can reason "higher = newer" without a semver parser. Author-visible
  labels can come later if ever needed.

## 4. Self-sustainability — closed-loop autonomy & lifecycle management

*System altitude primary; SUS-3 is the agent-flavored liveness point.*

- **SUS-1 (the first unbounded-by-design store — force the retention decision).** Every prior
  store got a metabolism: workspaces have TTL GC + purge (REQ-026), auth tables have `gcExpired()`
  in the maintenance sweep (REQ-012 v16). Version history has **no natural expiry, grows on every
  draft registration** (and the new dev loop of CON-3 *accelerates* registration), and run-pinned
  versions cannot be GC'd naively (a journal references the version it ran, REQ-014/096). The panel
  must decide out loud: (a) accepted-unbounded (defensible for a self-hosted single-team engine —
  scripts are text), or (b) a sweep rule such as "prune versions that are: not channel-pointed, not
  the newest, not referenced by any retained run, older than TTL", riding the existing maintenance
  sweep. This lens recommends **(a) now with the schema shaped so (b) bolts on** (the run→version
  reference must be queryable, which OBS-1 already requires) — but silence is not an option;
  undecided-unbounded is how disks fill at 3am.
- **SUS-2 (take the two invited debt items — both are self-protection).** **S-1**: the
  ceilings-less `WorkflowCatalog` enforces no registration ceiling, and v22 makes that strictly
  worse — every draft is a *new row*, so a single misbehaving author-agent loop can grow the
  catalog without bound (REQ-024's 413 caps one body, not row count). Add per-name version-count
  and script-size ceilings at registration (typed error, fail-closed). **P6-2 registration half**:
  an author-declared `defaults.appendPrompt` carrying a forged frame delimiter must be refused at
  registration, not just at dispatch — registration is now the *only* script entrance, so the gate
  belongs there.
- **SUS-3 (environmental checks go stale — split intrinsic from environmental validation).**
  REQ-099 moves parse/alias/MCP checks to registration. But only **parse is intrinsic** to the
  script; alias resolution and MCP-provisioned are **environmental** and rot after registration (an
  operator deprovisions an MCP, remaps an alias — the tool-liveness problem, agent-altitude
  self-sustainability). Architecture: registration runs all checks fail-closed (REQ-099); admission
  **re-computes the cheap environmental checks** against the resolved version, always; what happens
  with the result is a policy split the panel must pin. For **pre-v22 registrations** REQ-099's
  grandfathering clause is explicit and binding: the run proceeds and the condition is recorded on
  the run record + OBS-3's `validation` seam (surfaced, never swallowed). For **post-v22
  registrations that go stale later**, REQ-099 is silent — fail fast with the registration-time
  typed error (this lens's preference: the author was already told the contract) vs warn-and-run
  (symmetry with grandfathering) is an open decision; either way the OBS-3 seam surfaces staleness
  on read for *all* workflows, so one detection mechanism serves both policies.
- **SUS-4 (migration self-healing = the acceptance text, verified for real).** Idempotent,
  restart-safe, no-loss migration is already REQ-096 acceptance — this lens adds only: the engine
  should detect a *partially applied* migration on boot and either complete or fail fast with a
  named error, never boot half-migrated (the workroot-guard fail-fast precedent, REQ-021). And it
  must be exercised at Gate 7.5 against a **real pre-v22 SQLite file**, not a fixture built by the
  new code — the oracle-independence rule again.
- **SUS-5 (no silent fallback, ever).** REQ-097's "unpublished channel → typed refusal, never
  silently the newest script" is the load-bearing self-sustainability clause: every fallback path
  in this design must be a typed, observable refusal. A scheduler-fired run hitting an unpublished
  channel must record the refusal where the schedule's owner can see it (schedule status/dashboard),
  not vanish — a cron that silently stops producing runs is the "silent/opaque failure" this lens
  exists to outlaw.

---

## Key points (condensed)

1. One **ChannelResolver** for all seven script-entry paths; delete the legacy `get(name)` read —
   the stored-but-never-wired class is this repo's #1 recurring defect and v22 is shaped exactly
   like its past instances (REP-1).
2. **Provenance at admission**: run record pins requested-shape + resolved version; publish gets an
   audit trail. Mutable pointers make post-hoc reconstruction impossible (OBS-1/2).
3. **One masking projection** at the catalog boundary, script-field-unrepresentable for non-owners;
   all four read surfaces consume projections (REP-2, OBS-4).
4. **Intrinsic vs environmental check split**: parse at registration only; alias/MCP re-checked at
   admission + surfaced via a queryable `validation` seam covering both grandfathered and gone-stale
   workflows (SUS-3, OBS-3).
5. **Name the author inner loop**: register-draft → run-by-version; resume stays pinned; REQ-006's
   edited-script clause must be formally superseded (CON-3).
6. **Retention decided out loud** + S-1 ceilings + P6-2 registration gate (SUS-1/2).
7. Both external contracts (channel resolution, masked shape) pinned by **literal fixtures** —
   Rule 1 from v21's post-mortem (OBS-5).

## Risks

- **R1 (high likelihood, high impact)**: version/channel columns land but a run path keeps reading
  "newest" — the wiring class. Mitigation: REP-1's single resolver + seam test + Gate 7.5 real run
  that registers twice and asserts the pinned version.
- **R2**: masking implemented per-endpoint; dashboard or `/api/workflows*` leaks script to
  non-owners, silently voiding REQ-100. Mitigation: REP-2 projection types.
- **R3**: fire-time channel resolution means a `workflow_publish` silently changes what a cron/
  webhook runs next — correct per REQ-097, but without OBS-1/OBS-2 it is an undiagnosable surprise
  (and a hijack-shaped one; see disagreements).
- **R4**: author inner-loop friction (two calls + version churn) pushes authors to point `beta` at
  every draft, eroding channel semantics; or users report against drafts. Mitigation: CON-3's
  sanctioned loop documented in the plugin skill + tool descriptions.
- **R5**: unbounded catalog growth / registration DoS now that drafts accumulate rows (SUS-1/S-1).
- **R6**: migration drops owner/defaults/params while re-keying, or half-applies on a crash —
  guarded only if verified against a real pre-v22 database (SUS-4).
- **R7**: moving MCP/alias checks to registration creates a bootstrap ordering constraint
  (provision MCP before registering workflows that use it) and a staleness window after
  registration; without SUS-3's admission recheck the engine trades one silent-failure mode for
  another.

## Expected disagreements with other lenses

- **Adversarial/simplicity (Karpathy tie-breaker)** will likely YAGNI: the publish audit trail
  (OBS-2), the retention/sweep design (SUS-1), the admission-time environmental recheck (SUS-3),
  and possibly the shared-resolver insistence ("just call the catalog in each place"). I hold the
  line on REP-1 (four documented recurrences of the wiring class outweigh abstraction cost — and it
  is *less* code than five inline resolutions), on OBS-1 (unreconstructable later), and on OBS-2
  (one INSERT); I will concede elaborate retention *implementation* if the decision is recorded as
  accepted-unbounded with the schema kept GC-ready.
- **Security** will likely push the opposite direction on R3: fire-time channel resolution lets a
  compromised/careless owner's publish instantly retarget every standing schedule — they may want
  schedules to **pin a version at creation** rather than resolve `release` at fire time. That is a
  genuine product trade-off (auto-upgrade-by-publish is arguably the *feature*); the panel must pin
  fire-time vs creation-time explicitly rather than let it fall out of implementation. My lens is
  satisfied by either **provided** OBS-1 provenance + OBS-2 audit trail exist.
- **Security on masking scope**: may argue masking should apply even with auth disabled (defense in
  depth). REQ-100's acceptance explicitly keeps auth-disabled = pre-v22 (single-operator floor); I
  side with the requirement — a no-principal deployment has no "non-owner" to mask against.
- **Scalability** may raise per-version full-script row storage and propose content-addressed dedup
  via the existing `cas-store`. Defensible, but this lens rates it premature for text-sized scripts
  when SUS-1's ceilings exist; keep the schema's script column swappable for a CAS ref later
  (replaceability satisfied by a column, not a subsystem).
- **Testability** will welcome the pure resolver/projection modules but may resist SUS-3's
  admission recheck as run-path latency; the recheck is two SQLite/registry lookups already paid on
  the inline path pre-v22 — cost is unchanged, only relocated.
