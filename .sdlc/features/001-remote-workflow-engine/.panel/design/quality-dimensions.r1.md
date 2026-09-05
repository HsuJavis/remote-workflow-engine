---
stage: design
lens: quality-dimensions
iteration: v24
round: 1 (independent proposal)
---
# Quality-dimensions proposal — v24 DESIGN (Observability / Replaceability / Consumability / Self-sustainability)

## summary

Gate 2 adopted this lens almost wholesale — ARCH-087/088/091/092/097/099/100/104/107/108 and
ADR-024/027/028/031/032 each cite a QD item by number. So the design round's job is **not** to
re-argue those; it is to pin the seven places where the adopted decisions are still one level too
abstract to implement without a silent hole, and to say where the task boundary has to fall so the
drift-locks are never green in an intermediate state.

The four sharpest design-level findings, each verified in the current tree:

1. **The per-agent harness descriptor (ARCH-104) has a hole and an unnamed consumer.**
   `redactHarness` (`agent-executor.ts:39-64`) returns from **two** branches, and the
   `surfaceType:'none'` branch returns `skills:[], mcpServers:[]` — i.e. exactly where a degraded
   agent ran, the new `label`/`provenance`/`materialized` fields would be missing. And the reader
   is `deriveAgentRecords` (`run-store.ts:24`, called at `sqlite-run-store.ts:241` and
   `run-store.ts:227`): unless it is changed in the same task, the new fields persist to the
   journal and never reach `run_status.agents[]`. Write-without-readback, one layer down.
2. **ADR-027's chosen read-back carrier is served on an unauthenticated route.** `RunStatusView`
   already carries `principal` (`types.ts:135-137`) and `GET /api/runs/:id` (`server.ts:1272`)
   returns `buildDashboardModel([], view).selected` — the whole view — through `dispatchDashboard`
   (`server.ts:1953`), which is **not** in the gated set (the four gated routes are `/mcp`,
   `POST /assets/blob`, `POST /assets/manifest`, `GET /api/workflows/:name/describe`, at
   `server.ts:1852/1792/1816/1907`). Putting `adminReads[].actor` on `RunStatusView` without a
   projection rule publishes admin emails to any dashboard reader.
3. **ADR-031's three refusal fields land next to a field that already does that job.**
   `ScheduleStatus` (`scheduler.ts:34-43`) already has `lastError:{code, at}` plus `lastFire`.
   Adding `refusalCount`/`lastRefusedAt`/`lastRefusalReason` beside it without saying which one a
   reader trusts is the v24 version of "two arrays over the same names" (CONS-1).
4. **REQ-117 has an unbudgeted context cost.** A cold model receives 35 tool descriptions with
   `Errors:`/`See also:` appended (ARCH-087) *plus* the entire `buildAuthoringGuide()` output
   (ARCH-107) in one response. Nothing in Gate 2 bounds either. A guide that overflows the
   subject's context fails REQ-117 for a reason no example-registration test can detect.

## Altitude call (which system is this?)

Unchanged from the architecture round and re-affirmed by what Gate 2 actually built: **both
altitudes, applied per dimension.** A Node 22 / TypeScript ESM service (hand-rolled JSON-RPC MCP
server, better-sqlite3, filesystem journal, dashboard, systemd self-update) carries REQ-107/108/109/
114/115/118 at the **system** altitude; `agent()` dispatching a Claude Agent SDK session through a
pluggable gateway carries REQ-110/113 at the **agent** altitude. REQ-111 is agent-altitude in the
negative — it deletes the one LLM subsystem in the engine (ARCH-079).

Still deliberately excluded, one sentence each: **memory metabolism / context compression** (runs
are bounded and journalled; no resident memory exists to compress) and **self-reflection / prompt
calibration** (nothing in REQ-107..118 asks for it; inventing it is scope invention, not quality).

---

## 1. Observability

**The traceability fold this dimension carries** (stated explicitly, not only in the carry-forward):
REQ-109's audit rows, REQ-114's `pushedBy` and REQ-115's refusal counters are what make an action
traceable to a principal at Gate 8, and O-12's generated conformance artifact plus the drift-locks
of ARCH-087/093/107 are what make the *surface* traceable to its enforcement. A row that no
projection returns, and a table that exists only in test stdout, are both untraceable in the sense
this ledger grades.

**Carried forward:** O-0 ADOPTED (REQ-114 is the exemplar). O-1 ADOPTED as ADR-027 + ARCH-092.
O-2 ADOPTED as ADR-031. O-3 ADOPTED as ARCH-108. O-4 ADOPTED as ARCH-104. O-5 ADOPTED as
ARCH-097's `onlyInScript`/`onlyInDiagram`. O-6 ADOPTED as slice rationale.

**O-7 (new, HIGH) — the harness descriptor must carry the new fields on BOTH branches of
`redactHarness`.** Verified: `agent-executor.ts:39` returns early for `surfaceType:'none'` with
`tools:[], skills:[], mcpServers:[]`. ARCH-104 adds `label`, per-key `provenance` and
`materialized:{skills,mcp,missing}`; `label` and `provenance` are *properties of the dispatch*, not
of the tool surface, so they belong on both branches. `materialized` on the `'none'` branch is
`{skills:[],mcp:[],missing:declared}` — which is the diagnostically interesting case, because
"nothing was materialized" and "the agent had no surface at all" are different failures. Design
must state this per-branch, and the design's own test list must contain one `surfaceType:'none'`
fixture; otherwise the seam has a hole exactly where a degraded agent ran.

**O-8 (new, HIGH) — name the consumer, or the descriptor is write-only.** `deriveAgentRecords`
(`run-store.ts:24`) is what turns `{kind:'harness'}` transcript events into `run_status.agents[]`
(`sqlite-run-store.ts:241`, `run-store.ts:227`; the contract is documented at
`gateway/client.ts:90`). It is not named in ARCH-104. Design must pin: which of `label` /
`provenance` / `materialized` surface on `AgentRecord`, which stay transcript-only and are read via
`run_agent_log`. My proposal: `label` and the resolved four values with `provenance` on
`AgentRecord` (that is the question a user asks about a *running* agent); `materialized` stays on
the transcript event (it is a post-hoc "why did skill X not load" question). Either way it must be
a stated decision with a test on `run_status`, not an inferred one.

**O-9 (new, HIGH) — `adminReads[]` needs a visibility rule AND a dashboard-projection rule.**
Two halves:
- *MCP:* present for the run's owner and for an admin; **absent, not `[]`**, for anyone else —
  same honest-absence convention as `mcpUnresolved` (`types.ts:239-246`) and `seedRef`. An empty
  array asserts "no admin read this run", which a non-owner has not earned.
- *HTTP:* `GET /api/runs/:id` is ungated (evidence in the summary) and returns the whole
  `RunStatusView`. Design must state that the `/api/*` projection **strips `adminReads`** — and,
  by the same rule, must decide the pre-existing `principal` exposure on that route rather than
  inheriting it silently. The pre-existing leak is a v15-era condition and not v24's to fix, but
  v24 chose that carrier and therefore owns the rule. The general form worth writing once: **no
  identity field (`actor`, `principal`, `pushedBy`, `createdBy`, `claimedBy`) is served on an
  ungated `/api/*` route.** That one sentence also pre-decides the projection for `workspace_list`
  and the trigger listings if a dashboard route is ever added for them.

**O-10 (new, MID) — "audit before bytes" must define what happens when the audit write fails.**
ARCH-091 note (2) fixes the ordering and accepts the crash window. It does not say what an
`appendAudit()` throw (SQLite busy, disk full) does. Fail closed: the read is refused with a typed
error, because "audit first" that degrades to "serve anyway" on the one failure path that matters
is not an audit. One test: a store whose `appendAudit` throws ⇒ `workspace_pull` returns the typed
error and no bytes.

**O-11 (new, MID) — reconcile ADR-031's refusal fields with the fields the row already has.**
`ScheduleStatus` (`scheduler.ts:34-43`) is `{id, kind, workflow, enabled, nextFire, lastFire,
lastRunId, lastError:{code,at}}`. Three points design must settle: (a) `lastError` vs
`lastRefusalReason` — is a claim refusal an "error"? My proposal: **reuse `lastError` for the
refusal reason and add only `refusalCount`**, so there is one last-failure field, not two that can
disagree; if the architecture's three-field shape is kept instead, `lastError` must be documented
as "gateway/run failures only" and a test must pin that a refusal does not write it. (b)
`refusalCount` is monotonic and never resets, so a trigger unclaimed for a week then claimed reads
`refusalCount: 10080` forever — `lastFire` already exists as the health signal, so the projection
should be read as "`refusalCount` since `lastFire`", stated in the field's own docblock. (c) the
`workflow` field on this row is replaced by `claimedBy` (ARCH-099) — a projection change whose
consumers must be enumerated at design, not discovered: `ScheduleStatus.workflow`
(`scheduler.ts:37`) and `listByWorkflow`'s `WHERE workflow = ?` (`scheduler.ts:213-217`, the sync
port `getTriggerBindings` composes) both read the dropped column. Per carried-in rule 3, everything
describing the old field moves with it.

**O-12 (new, LOW) — REQ-118's generated table needs a path and a reason string.** ARCH-108 says
"generated" and "drift-locked". Design must pin *where the artifact is written* (a repo path a
human and Gate 7.5 can read, not test stdout) and that an `UNVERIFIED` row carries its reason
string verbatim in that artifact. Otherwise REQ-118's "never quietly omitted" is satisfied only
inside a test process.

---

## 2. Replaceability

**Carried forward:** R-1 ADOPTED as ARCH-087/088 + ADR-024. R-2 ADOPTED as ARCH-093. R-3 ADOPTED
as ADR-023 (with the subset obligation stated). R-4/R-5 ADOPTED as ARCH-095's note. R-3b/QD-R10
RESOLVED by ADR-033 (source text, cost recorded, owner-surfaced).

**R-6 (new, HIGH) — the null-owner rule must be decided once, and it is a data-migration
consequence, not a code detail.** `OwnerLookup.triggerOwner` (ARCH-088) reads `createdBy`, which
ARCH-099/100 add as `TEXT NULL` — so it is `NULL` on **every migrated legacy trigger**;
`runOwner` reads `runs.principal`, which is `NULL` on every pre-v15 run and on every run submitted
while auth was disabled. Design must pin one rule: **a `NULL` owner is owned by nobody, therefore
admin-only** (fail closed). The honest consequence, stated not buried: legacy runs and legacy
triggers become invisible/unusable to non-admin principals the moment auth is enabled. The same
rule has to hold on both sides of the seam — `authorize()`'s predicate and `run_list`'s SQL filter
(`WHERE principal = ?` excludes `NULL` rows in SQLite, which happens to agree; that agreement must
be asserted by a test, not left to SQL trivia).

**R-7 (new, MID) — `pathVerdict` imports the containment primitive, it does not re-derive it.**
`src/path-containment.ts:13` exports `isPathContained(path, root)` and is already the shared jail
test for four consumers (`workspace-seed.ts:10`, `workspace-artifacts.ts:9`,
`gateway/claude-agent-sdk-client.ts:20`, `self-update.ts:12`); ARCH-093's new pure module must call
it rather than grow a fifth copy of the escape check. And the drift-lock
ARCH-093 asks for needs its fixture list named at design: every former `STRIP_RE` case from
`workspace-seed.ts` and every former `safeRelPath` case from `asset-sync.ts`, enumerated, each
asserted to land on the same verdict as before. A drift-lock with an unnamed fixture list is a
review item wearing a test's clothes.

**R-8 (new, LOW) — ARCH-102 explicitly leaves `resolveMcp`'s placement to design; decide it as a
pure helper.** `resolveMcp(assets, workflow, names)` over `assetsOf()`'s output is testable without
a filesystem and swappable when the asset store changes; a method on `AssetSyncService` ties MCP
resolution to the FS service for no gain. This is the same call R-1/R-2 made twice already: one
decision point, table of inputs, no service dependency.

**R-9 (new, MID) — ARCH-090's "a present-but-unknown `graphAnalyzer` key produces one boot warning"
does not exist for free.** Removing the block from `FileConfig`'s **type** produces nothing at
runtime — TypeScript types are erased and the JSON is parsed, not validated. The warning needs an
explicit unknown-key check at the config parse site in `main.ts`. Design must either specify that
check (and, worth more than the one key, make it general: warn once listing every unrecognized
top-level config key) or delete the claim from ARCH-090. A specified guard that was never built is
this ledger's adjudication (v23) #4 repeating.

**R-10 (kept) — the LLM-decoupling win is now complete at the authoring layer** (ARCH-095's note):
with no model name legal in any script, retiring a provider is a `meta` default edit or a
`run_start({overrides})` — never a workflow-logic edit. Design should make this checkable rather
than merely true: one test asserting that no `GUIDE_EXAMPLES` script contains a model alias string.

---

## 3. Consumability

**Carried forward:** C-1 ADOPTED as ARCH-107 + ADR-032. C-2 ADOPTED as `ERROR_CATALOG` in
ARCH-107. C-3 ADOPTED as ARCH-094's note. C-4 ADOPTED as `runnable`/`onlyRunnable`.

**C-5 (new, MID) — fence the `ERROR_CATALOG` refactor, or it becomes a 40-file task.** Verified:
`src/errors.ts` today is value classes plus a free-string `codedError(code: string, message)`
factory used across `run-manager`, `cas-store` and the tools. Scope for v24: the catalog contains
**every code that appears in any `TOOL_SPECS[].errors` row, plus every new v24 code** — nothing
else; `ErrorCode` is derived from the catalog's keys (so `TOOL_SPECS` cannot name a code that has
no entry); the drift-lock is "every `errors[]` entry has a catalog row **and** every catalog row is
named by some tool"; **existing free-string `codedError()` call sites are NOT migrated in v24.**
One dependency-direction clause the synthesizer will otherwise trip over: ARCH-107 homes the
catalog in `src/errors.ts` while ARCH-087 requires `tool-specs.ts` to import nothing from `src/`
(which is why it declares `Role` locally). `tool-specs.ts` therefore takes `ErrorCode` as a
**type-only** import — erased at runtime, so ARCH-087's rule stays literally true and the drift-lock
still compiles; the alternative (moving the catalog into `tool-specs.ts`) splits the error home away
from `errors.ts` and is worse. Name the choice, or the synthesizer drops one of the two.
Without this fence the synthesizer either skips C-2 as unbounded or spawns a refactor larger than
the feature.

**C-6 (new, HIGH) — REQ-117's context budget is unbounded and nothing measures it.** The subject
receives 35 tool descriptions (each with `Errors:` and `See also:` appended by `projectToolsList`)
plus the whole guide — the sandbox API, the `meta` shape, the authoring rules, the full REQ-112
vocabulary with six drawn patterns, the tunable-vs-locked table, the nesting rule, and
`GUIDE_EXAMPLES`. Proposal: a byte ceiling on `buildAuthoringGuide()` output and on total
`tools/list` description bytes, each asserted by a unit test that fails when a well-meant addition
crosses it. The number itself is a design call (my suggestion: guide ≤ 24KB, `tools/list`
descriptions ≤ 24KB in total, both revisable with evidence); the point is that the ceiling exists
and is a red test, because the failure it prevents — a subject that runs out of room before it gets
to the example — is invisible to REQ-116's example-registration test and expensive to diagnose at
Gate 7.5, where every re-run costs a *fresh* model instance (REQ-117 forbids re-using one).

**C-7 (new, MID) — the guide must interpolate the EFFECTIVE ceilings, not `DEFAULT_CEILINGS`.**
`maxTimeoutMs` / `maxAppendPromptBytes` / `maxEffort` are operator-overridable config (they are
already rows in `compose-config-v2-wiring.test.ts:130-145`). ARCH-107 builds the guide from
`DEFAULT_CEILINGS`. On any deployment that raises or lowers a ceiling, the guide then teaches a
number the engine does not enforce — precisely the C-1 failure mode the whole builder exists to
prevent, re-entering through the one input that is not a constant. Design: `buildAuthoringGuide()`
takes the resolved `ServerConfig` ceilings, and one test boots with a non-default ceiling and
asserts the guide text carries it.

**C-8 (new, LOW) — a silent default filter is a consumability defect.** ARCH-091 defaults
`onlyRunnable:true` for `user`. A user seeing an empty `workflow_list` must be able to learn why,
so the response echoes the applied filter (`filter:{onlyRunnable:true}`). Same principle as
refuse-never-clamp (C-3): the caller learns the rule from the response, on the first attempt.

**C-9 (kept, LOW) — ADR-033's honest cost.** The dashboard shows Mermaid *source*, so a human
reader loses the picture the v21 ask named. The design's own doc set (README/DEPLOY, and the guide)
should say so in one line, so the next reader does not file it as a bug — and the guide should
point a human at any Mermaid live-editor rather than the engine pretending to render.

---

## 4. Self-sustainability

**Carried forward:** S-1 ADOPTED as ADR-031 (coalescing, option (c)). S-2 ADOPTED as ADR-028 +
ARCH-090. S-3 ADOPTED as ARCH-098's boot migration. S-4 ADOPTED as slice rationale (registration
is total again). S-5 ADOPTED as ARCH-103/ADR-034. S-6 kept OUT of scope.

**S-7 (new, HIGH) — ADR-028 designed the "closed" half of fail-closed and not the "loud" half.**
The rationale is that an unwired `principals` block "locks the operator out visibly, not grants
everyone `admin` silently" — but visibility is asserted, not built: nothing announces the state.
Design must pin one boot seam: a single startup line stating **auth mode, `principals` entry count,
and the effective default role**, plus the same three facts on `system_info` (which exists, is
read-only, and is already in the 35). Then "locked out within minutes" is *announced* rather than
*discovered*, and the twice-bitten `composeConfig` class has a detector that does not require
someone to try `workflow_register` first. This is cheap — one log line and three fields — and it is
the difference between failing closed and failing closed *observably*.

**S-8 (new, MID) — three migration specifics ARCH-098/099/100 leave to design.**
(a) `schedules.workflow NOT NULL → claimedBy, then drop` uses SQLite `ALTER TABLE … DROP COLUMN`,
which needs SQLite ≥ 3.35; better-sqlite3 bundles a newer one, but the floor belongs in the design
note beside the migration, because a re-build against a system SQLite is how that becomes a boot
failure nobody predicted. (b) The legacy global assets migrating to `assets(workflow='',
pushedBy='legacy')` need **no filesystem move** — the global tree path `<workRoot>/assets/<kind>/
<name>/` is unchanged in ARCH-102 — so the migration is rows only. Saying so removes a task and
removes the risk of a half-moved tree. (c) `deregister`'s FS removal is an after-hook outside the
transaction (ARCH-098): a failure there leaves an orphan `<workRoot>/<name>/assets/` directory with
no row. Pin the reclaim — the existing workspace-GC sweep (ARCH-022/`workspace-gc.ts`) is the
natural home, reclaiming asset trees with no `assets` row — not a log line and not a manual step.

**S-9 (kept) — the autonomy ledger for v24 is net positive and should be claimed.** Deleted: an
async single-flight LLM subsystem, its config block, its reconcile machinery, two `diagramStatus`
states and a regenerate tool. Added: two tables, five columns and one bounded coalesced counter.
Registration no longer depends on a provider being reachable. **Tool-liveness probing** (S-6) is
still out of scope — REQ-113 gives an author *discovery* of provisioned MCP for the first time,
which is the precondition, but nothing asks for probing, and the one probe that exists
(`mcp-probe.ts`, at push time) is a validation gate, not a liveness monitor.

---

## key_points

1. **`redactHarness`'s `surfaceType:'none'` branch is a hole in ARCH-104's seam** — `label` /
   `provenance` / `materialized` must be on both return branches, with a `'none'` fixture in the
   test list (O-7).
2. **`deriveAgentRecords` is ARCH-104's unnamed consumer** — same task, or the new fields persist
   and never surface on `run_status.agents[]` (O-8).
3. **`adminReads[]` needs both a visibility rule (absent, not `[]`, for non-owners) and an
   `/api/*` projection rule** — `GET /api/runs/:id` is ungated and returns the whole
   `RunStatusView` today; generalize to "no identity field on an ungated `/api/*` route" (O-9).
4. **Audit-write failure must fail the read closed** (O-10).
5. **ADR-031's refusal fields must be reconciled with the existing `lastError`/`lastFire` on
   `ScheduleStatus`**, and `refusalCount` read as "since `lastFire`" (O-11).
6. **The null-owner rule (`NULL` ⇒ admin-only, fail closed) is one decision spanning `authorize()`
   and `run_list`'s SQL**, with the legacy-invisibility consequence stated (R-6).
7. **`pathVerdict` imports `path-containment.ts`; its drift-lock fixture list is enumerated at
   design** (R-7).
8. **ARCH-090's stale-`graphAnalyzer` boot warning needs a real unknown-key check** — a type
   removal is not a runtime guard (R-9).
9. **Fence `ERROR_CATALOG` to codes named by `TOOL_SPECS` + new v24 codes; do not migrate existing
   `codedError()` call sites in v24** (C-5).
10. **Put a byte ceiling on the guide and on total `tools/list` description bytes** — REQ-117's
    context budget is currently unbounded and its failure is invisible to every other test (C-6).
11. **The guide interpolates the effective config ceilings, not `DEFAULT_CEILINGS`** (C-7).
12. **Build the "loud" half of fail-closed**: one boot line + three `system_info` fields stating
    auth mode, `principals` count and default role (S-7).
13. **Three migration specifics**: `DROP COLUMN` SQLite floor, legacy global assets are rows-only
    (no FS move), orphan asset trees reclaimed by the existing GC sweep (S-8).

## risks

| # | Risk | Severity | Where it lands |
|---|---|---|---|
| QD-D1 | **Harness descriptor fields missing on the `surfaceType:'none'` branch** — the seam is blind exactly where a degraded agent ran. | HIGH | ARCH-104 / O-7 |
| QD-D2 | **`deriveAgentRecords` not updated** — descriptor fields written to the journal never reach `run_status.agents[]`; the requirement looks met and is not. | HIGH | ARCH-104 / O-8 |
| QD-D3 | **`adminReads[]` (actor emails) served on the ungated `GET /api/runs/:id`** via the shared `RunStatusView` — the audit meant to protect a principal exposes the auditor. | HIGH | ADR-027 / O-9 |
| QD-D4 | **REQ-117's context budget unbounded** — 35 descriptions + the whole guide; overflow fails the probe for a reason no test detects, and each re-run costs a fresh model instance. | HIGH | ARCH-087/107 / C-6 |
| QD-D5 | **Null-owner rows (legacy `runs.principal`, migrated `createdBy`) with no stated rule** — either a fail-open ownership check or a silent invisibility nobody documented. | HIGH | ARCH-088/092 / R-6 |
| QD-D6 | **`principals` fails closed but silently** — ADR-028's own justification ("locked out visibly") is asserted, not built. | HIGH | ADR-028 / S-7 |
| QD-D7 | **Guide teaches `DEFAULT_CEILINGS` on a deployment that overrode them** — C-1's failure mode re-entering through the one non-constant input. | MID | ARCH-107 / C-7 |
| QD-D8 | **Two last-failure fields on the trigger row** (`lastError` vs `lastRefusalReason`) that can disagree, plus a monotonic counter with no health signal. | MID | ADR-031 / O-11 |
| QD-D9 | **Audit write failure degrades to serving bytes** — "audit before bytes" true only on the happy path. | MID | ARCH-091 / O-10 |
| QD-D10 | **ARCH-090's boot warning does not exist** — removing a key from a TypeScript type is a compile-time act; the operator's stale config stays silent. | MID | ARCH-090 / R-9 |
| QD-D11 | **`ERROR_CATALOG` unscoped** — either skipped as unbounded or grown into a repo-wide `codedError` migration inside v24. | MID | ARCH-107 / C-5 |
| QD-D12 | **`pathVerdict` re-derives containment** instead of importing `path-containment.ts`, adding a fourth copy of the rule REQ-108 exists to unify. | MID | ARCH-093 / R-7 |
| QD-D13 | **Orphan asset directory after a failed deregister after-hook**, reclaimed by nothing. | LOW | ARCH-098 / S-8 |
| QD-D14 | **REQ-118's table lives only in test stdout**, so "never quietly omitted" is unverifiable by a human. | LOW | ARCH-108 / O-12 |
| QD-R11 (carried, still OPEN) | **The client plugin's guidance skill (separate repo) teaches the old tool names.** ARCH-089 names it as scenario S-8 but no task owns it; REQ-117's probe is blocked on it. | MID | ARCH-013/089 |

## where task-splitting affects this lens (03-tasks.md does not exist yet)

1. **`TOOL_SPECS` + `authorize()` + the server wire are ONE task.** The drift-locks ("every tool has
   an authz row", "`tools/list` contains no old name", "a description saying admin has
   `minRole:'admin'`") cannot be green at any intermediate state; split across tasks, the first one
   ships a red build or a disabled guard.
2. **`principals` in `composeConfig()` and its row in `compose-config-v2-wiring.test.ts` are the
   same task** (the v11/v15 bug class), and S-7's boot line + `system_info` fields belong there too
   — the wiring and the announcement of the wiring are one unit of work.
3. **The harness-descriptor extension and `deriveAgentRecords` are one task** (O-7 + O-8). A task
   boundary between producer and consumer is exactly how a write-only field ships.
4. **`ERROR_CATALOG` lands before any task that introduces a v24 typed error**, or the pointers get
   backfilled — and backfilled pointers are what carried-in rule 3 is about.
5. **Migrations (ARCH-098/099/100) precede the facade task** (ARCH-091): the facade's register
   sequence claims triggers whose `claimedBy` column must already exist.
6. **The guide builder (ARCH-107) is last among code tasks**, because it interpolates constants from
   `diagram-gate.ts`, `params/contract.ts`, `errors.ts` and `tool-specs.ts`; the REQ-118 table test
   (ARCH-108) comes after it, since it exercises `workflow_authoring_guide` like any other tool.
7. **The client plugin rename needs a tracked task even though the repo has no SDLC ledger of its
   own** (QD-R11). REQ-117 is measured on what a cold client sees, and a cold client sees the
   plugin. A task that says "external, owner-scheduled, blocks the REQ-117 probe" is honest; no task
   at all is how the probe gets run against a plugin still saying `workflow_run`.

## expected disagreements with other lenses

- **vs. an adversarial / security lens — on O-9's placement.** They will likely want the audit
  invisible to the audited (append-only, admin-only reader) and may read `adminReads[]` on
  `run_status` as leaking admin identity to a user. My position: ADR-027 already settled *that* the
  owner sees it; the design disagreement is only about the HTTP projection, and there we agree —
  strip identity fields on ungated `/api/*`. Expect them to want the whole dashboard gated instead;
  I would take that, but it is a bigger change than v24 asked for.
- **vs. a simplicity / Karpathy lens — on C-6 and S-7.** A byte ceiling on the guide and a boot
  announcement will read as ceremony. My counter: both are one test and one log line respectively,
  and each guards a failure that this ledger has already paid for once (a doc defect found only by
  a real run; a config block silently unwired, twice).
- **vs. a data / persistence lens — on O-11.** They may prefer the architecture's three clean new
  columns over reusing `lastError`, arguing that overloading a field is worse than adding one. Fair;
  what I will not concede is shipping two last-failure fields with no stated precedence.
- **vs. a testing lens — on QD-D2.** They may say an integration test over `run_status` covers it
  anyway. It only does if someone writes it; my point is a *task-boundary* one, not a test-list one.
- **vs. a delivery / scope lens — on R-9 and S-8(c).** Both are "small guards for unlikely states"
  and are the first things a scope trim removes. R-9 in particular is not optional: ARCH-090 *claims*
  the warning, so either it is built or the claim is deleted — a specified-but-unbuilt guard is the
  exact defect adjudication (v23) #4 recorded.
- **vs. any lens proposing agent self-reflection or memory metabolism** — unchanged from round 1:
  out of altitude for v24, and adding it is scope invention.
