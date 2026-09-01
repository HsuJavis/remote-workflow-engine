# Gate 8 review — Adversarial architecture group (v22)

**Lens:** (a) **security** — authn/authz correctness, secret/confidentiality protection, attack
surface; (b) **scalability/performance** — state storage, concurrency, consistency of counting;
(c) **testability** — module boundaries, injectable dependencies, unit/integration reachability.
**Tie-breaker:** Karpathy simplicity-first — the minimum architecture that solves the stated problem,
nothing speculative. Each lens is argued separately; their conflicts are surfaced in §Internal
conflicts.

**Iteration under review:** v22 — ARCH-071..076 + ADR-009..014 (REQ-096..100), IMPL-148..156.
**Compared against:** `02-architecture.md` §v22 slice (as amended by the two
`[AMENDED v22 gate-closeout]` notes on ARCH-073 and ARCH-074/ADR-013), the v22 4+1 views, the v22
data architecture ER, and the v22 interface & API contracts table; `06-impl-log.md` IMPL-148..156.
**Scope discipline:** the union of the IMPL-148..156 `files:` lines — `src/{workflow-catalog,
run-manager,scheduler,webhook-registry,submission-validator,mcp-facade,server,script-checks,
workflow-view,main,run-store,types,agent-executor}.ts`, `src/store/sqlite-run-store.ts`,
`src/gateway/claude-agent-sdk-client.ts`, `tests/unit/compose-config-v2-wiring.test.ts` — plus the
files they cross at a declared module boundary (`src/params/contract.ts`, `src/auth/auth-service.ts`,
`src/net-guard.ts`) and nothing else. No full-tree scan. One read of history via `git show
a54a794^:src/workflow-catalog.ts` (never `git checkout <sha> -- <path>`, per CLAUDE.md).

**Framing note on the standing lens template.** The template names brute force, JWT forgery and
timing attacks. v22 touches none of those: it introduces no credential surface, no token issuance
and no comparison of secrets. Its real security surface is exactly three things — **script
confidentiality** (REQ-100's mask), **catalog write authorization** (register / deregister / the new
`publish`), and **ingress closure** (`INLINE_SCRIPT_CLOSED`). This review is scoped to those; no
finding is invented to fill a template row.

**Headline.** The read side of REQ-100 was built to the letter of ADR-012 and is genuinely
fail-closed. The **write** side was not: v22 added a new catalog-mutating tool
(`workflow_publish`) that governs which script every future run of a name executes, and gated it with
the pre-existing `principal !== null` idiom — which the very principal ADR-012 spent a whole ADR
closing out of the read path (the D-BIND loopback-exempt caller on an auth-enabled, publicly-bound
server) passes straight through. Two further HIGHs: the DAG route serves the script-derived skeleton
that ADR-012 records as an *accepted loss* under auth, and version allocation uses `COUNT(*)` where
ARCH-071 says `max`, which breaks the ADR-011 migrated cohort.

**Verdict: NOT consistent — 12 deviations (3 HIGH, 5 MEDIUM, 4 LOW).**

---

## §A Findings

### A1 — HIGH (security). `workflow_publish` is not owner-gated against the one principal ADR-012 exists to constrain; and it re-imports the `args.principal` self-assertion ADR-012 bars

**Violates:** ARCH-071 (`publish(name, version, channel, principal)` — "owner-gated,
`NOT_WORKFLOW_OWNER`"); ADR-012 ("the identity used for masking comes **only** from
`resolvePrincipal`, never from `args.principal` … since `owner` is in the non-owner allowlist,
reusing it would make the mask bypassable by echoing its own response").

**Evidence:**
- `src/server.ts:1496` — `const dbindExempt = isLoopbackPeer(req.socket?.remoteAddress, req.headers) && !isLoopback(bind);`
- `src/server.ts:1611` — `if (!dbindExempt && req.method === 'POST' && req.url?.startsWith('/mcp'))` — an exempt caller **skips the auth gate entirely** and falls through to…
- `src/server.ts:1835` — `callTool(…, args, null, !!authCfg)` — `principal = null`, `authEnabled = true`.
- `src/server.ts:854-857` — `workflow_publish` dispatch: `const effectivePrincipal = principal ?? (typeof argPrincipal === 'string' ? argPrincipal : null);`
- `src/workflow-catalog.ts:473` — `if (row.owner && principal !== null && row.owner !== principal)` — a `null` principal **skips the ownership check outright**.
- `src/workflow-view.ts:41` + `src/mcp-facade.ts:317` — `owner` is on the non-owner allowlist, i.e. every reader learns the exact string the fallback accepts.

**Failure scenario.** Server bound to `0.0.0.0` with `auth.enabled = true` — the deployment REQ-100
is written for. Any local process (a co-tenant, a sandbox that can reach the port) POSTs
`/mcp tools/call {name:'workflow_publish', arguments:{name:'deploy-prod', version:'v9', channel:'release'}}`.
`dbindExempt` is true, so no bearer is demanded; `principal` is `null`; the catalog's owner check is
skipped; the `release` pointer moves. Every subsequent `workflow_run({name})`, every cron schedule,
every webhook and every chain bound to that name now executes `v9` — chosen by an unauthenticated
caller. `workflow_deregister` is reachable the same way. `args.principal` gives a second route (echo
the `owner` string any masked read hands out) that also works on the auth-disabled `/mcp` path.

**Why this is an architecture deviation and not just a pre-existing bug.** ADR-012 identified this
exact principal, named the exact bypass mechanism (`args.principal` + `owner` on the allowlist), and
closed it — *for reads only*, on the stated ground that "the rescue path is unharmed because
self-update and local admin need `workflow_run`/status, not script text". That rationale is
contradicted by the shipped code: the D-BIND path retains full **write** authority over the catalog,
including a tool v22 itself created. The asymmetry (reads fail-closed on `authEnabled`, writes
fail-open on `principal == null`) is recorded in no ADR.

**Karpathy check.** The fix is one predicate, not a subsystem: gate catalog mutations on
`authEnabled` the same way reads already are (`authEnabled && principal === null ⇒ refuse`), and drop
`args.principal` from `workflow_publish`'s dispatch (integration tests already mint real bearers
through the injectable `TokenStore` seam — `IT-089`'s own pattern, per IMPL-155).

---

### A2 — HIGH (security). `/api/runs/:id/dag` serves the script-derived skeleton while auth is enabled, on a route with no authentication at all

**Violates:** ARCH-073 ("`/api/workflows`, `/api/workflows/:name/skeleton` and `/api/runs/:id/dag`
serve the **non-owner projection whenever auth is enabled**"); ARCH-075 (trap 2 — "`skeleton` and
`phases` are script-derived … a decompiled outline of the agent graph … **not** on REQ-100's
non-owner allowlist, so they are masked by default"); ADR-012 (recorded accepted cost: "the dashboard
DAG loses its predicted-skeleton overlay there (live agent nodes still render)").

**Evidence:**
- `src/server.ts:1085-1109` — the DAG branch resolves the pinned script (`catalog.resolve(spec.name, {version: view.scriptVersion})`, `:1099`; `release` fallback `:1102`), runs `parseWorkflowSkeleton(skeletonScript)` (`:1108`) and feeds it to `layoutGraph` (`:1109`). **There is no `authEnabled` branch anywhere in this block** — contrast the sibling skeleton route at `src/server.ts:1049-1053`, which does exactly the right thing.
- `src/server.ts:1695-1707` — every `/api/*` URL is dispatched to `handleDashboardRequest` with **no bearer check**; only `!!authCfg` is passed through.

**Failure scenario.** Auth-enabled public deployment. An unauthenticated client enumerates
`GET /api/runs/<runId>/dag` and receives the full predicted graph of the workflow — phase names,
agent names and nested `workflow()` names, statically decompiled from the script text that REQ-100
withholds from the same client one endpoint over. `layoutGraph`'s cells are exactly the outline
ARCH-075 classifies as script-derived.

**Note on severity.** This is a *regression introduced by v22*: pre-v22 the DAG route read
`spec?.script`, which is empty for every named run (ARCH-072 inv 7 says so explicitly), so the route
leaked nothing. v22 fixed the blank-DAG defect by resolving the pinned script — correctly, per
ARCH-072 — but did not carry over the masking half of the same ARCH pair. The fix and the leak
shipped in one line.

---

### A3 — HIGH (correctness / upgrade). Version allocation uses `COUNT(*)`, not `max` — the ADR-011 migrated cohort gets non-monotonic versions and eventually a permanent, mislabelled registration failure

**Violates:** ARCH-071 load-bearing invariant 7 — "Version identifiers stay engine-assigned `v<n>`
(`:205` semantics preserved, **now computed as max over the name's rows**): sortable, collision-free,
and an agent reasons 'higher = newer' without a semver parser." Also degrades ADR-011 / scenario S-2
("an engine with pre-v22 rows boots … an existing cron schedule fires unchanged").

**Evidence:**
- `src/workflow-catalog.ts:341` — `const count = (… 'SELECT COUNT(*) AS n FROM workflow_versions WHERE name = ?' …).n;`
- `src/workflow-catalog.ts:349` — `const v = \`v${count + 1}\`;`
- `git show a54a794^:src/workflow-catalog.ts:205` — pre-v22 numbering was **monotonic per name**: `const nextNum = (existing ? Number(existing.version.replace(/^v/, '')) || 0 : 0) + 1;` over a single overwritten row.
- `src/workflow-catalog.ts:192-207` — the migration copies that single row **at its stored version**, so a workflow registered 7 times pre-v22 arrives as exactly one row at `v7`.
- `src/workflow-catalog.ts:359-364` — a PK collision is caught and re-thrown as `REGISTRATION_CONFLICT: concurrent registration of '<name>' — retry`.

**Failure scenario.** A pre-v22 workflow `nightly` was registered 7 times → migrates as one row,
`v7`, published to `release`. After upgrade the author registers again: `count = 1` → the new version
is **`v2`**, which is *older-numbered than the version it supersedes*. `listVersions` sorts it
`['v2','v7']`, `workflow_list` and `workflow_get` show `v7` as the release, and "higher = newer" —
the property invariant 7 explicitly buys — is false. Five registrations later `count = 6` → the
generated version is **`v7`**, which already exists → `SQLITE_CONSTRAINT_PRIMARYKEY` →
`REGISTRATION_CONFLICT … retry`. That workflow can now **never** be registered again, and the error
text tells the author to retry a call that is permanently deterministic. `workflow_publish` still
points `release` at the pre-upgrade `v7`, so the author's fix attempts are silent no-ops.

**Karpathy check.** The architecture already specified the one-word fix (`max`, not `count`):
`SELECT MAX(CAST(SUBSTR(version,2) AS INTEGER))` — the same expression `_listVersions`
(`workflow-catalog.ts:402`) already uses for ordering. No new state, no backfill.

**Second-order.** The ceiling check (`count >= maxWorkflowVersions`, `:343`) also counts *rows*, so a
migrated workflow's 7 pre-v22 registrations count as 1 against the ADR-014 ceiling. Benign, but it
means the ceiling is not the quantity ADR-014 describes for that cohort.

---

### A4 — MEDIUM (observability / doc-vs-code drift). `runs.requested` and `runs.validation` are declared across three architecture surfaces and exist nowhere in code

**Violates:** ARCH-072 **api** ("the run record additionally carries the **request shape**
(`requested: {version} | {channel} | 'default-release'`) and the admission-time `validation`
observation from ARCH-074"); ARCH-072 inv 2 (the pin "plus the recorded request shape is what makes
'which version did this cron actually run' answerable afterwards"); the v22 data-architecture ER
(`RUNS { text requested "v22 NEW" ; text validation "v22 NEW" }`); the v22 interface table
(`workflow_status(runId)` "reports the **pinned** version **and the request shape**").

**Evidence:**
- `src/workflow-catalog.ts:67, 77, 86, 90` — `resolveVersionRequest` **computes** `requested` correctly for all three shapes…
- `src/workflow-catalog.ts:95` — …and `VersionEntry` drops it; `resolve()` (`:424-429`) never returns it.
- `src/run-manager.ts:447` — `await this._store.createRun(spec, resolvedVersion, persistedParams)` — no third observation is passed.
- `src/store/sqlite-run-store.ts:35, 85-86` — the `runs` DDL and `INSERT` have `scriptVersion` and no `requested`/`validation` column.
- `src/mcp-facade.ts:189-196` — `workflow_status` returns the merged `RunStatusView`; no request shape.

**Assessment.** The `validation` half was superseded at the gate closeout — ARCH-074 and ADR-013 both
carry `[AMENDED v22 gate-closeout, adjudication #5 O-1]` re-siting it on
`HarnessDescriptor.mcpUnresolved`, and that mechanism **is** built and correct
(`src/types.ts:246`, `src/agent-executor.ts:47,61`, `src/gateway/claude-agent-sdk-client.ts:422,505,606`;
absent-never-`[]` is honoured at `agent-executor.ts:61`). The **`requested` half was never superseded
and was never built**, and the amendment did not reach ARCH-072's own api line, the ER diagram or the
interface table, all three of which still assert both fields. Net effect on the product: after a
`release` pointer moves, a run's record shows *which* version ran but not *whether it was asked for
by pin, by channel, or by default* — which is verbatim the question ARCH-072 inv 2 says the field
exists to answer, and the auditability half of the cron rationale.

**Disposition.** Either implement `requested` (it is already computed — one column, one field) or
amend ARCH-072 / the ER / the interface table the same way ARCH-074 was amended. Leaving three
surfaces asserting a field that does not exist is the drift class this ledger has repeatedly paid
for.

---

### A5 — MEDIUM. `Scheduler.create()` checks `exists()`, not "resolves `release`"

**Violates:** ARCH-072 inv 1 ("`Scheduler.create()` upgrades its check to 'resolves `release`' so a
schedule that could never fire is refused at creation rather than at 3am [quality SUS-5, bought for
one line]"); v22 interface table (`schedule_create` … errors `WORKFLOW_NOT_FOUND`,
**`CHANNEL_UNPUBLISHED` at creation**).

**Evidence:** `src/scheduler.ts:154` — `if (!(await this._catalog.exists(s.workflow)))`; same at
`src/scheduler.ts:213` for `workflow_trigger`. No `resolve(name, {channel:'release'})` anywhere in
the file.

**Failure scenario.** REQ-097 makes "registered but on no channel" the **normal** state of a fresh
version, and the sanctioned author loop (register-draft → publish later) produces it every time. An
author registers `nightly`, creates a cron schedule, and never publishes. `schedule_create` returns
success. At every tick the dispatch throws `CHANNEL_UNPUBLISHED`. IMPL-156's `markFailed` at least
records it now (`src/server.ts:1381`, `src/scheduler.ts:282-293`) instead of hot-looping — that part
is a genuine improvement — but the create-time refusal the architecture priced at "one line" is
absent, so the failure is still discovered at fire time.

---

### A6 — MEDIUM (security-structural). The "one choke point by construction" is bypassed by `workflow_list`, `/api/workflows` and `/api/home`; the required `ReadContext` on `workflow_list` is never read

**Violates:** ARCH-076 api ("the response is whatever `projectWorkflowForRead` returns, **never a
row**"); ARCH-075 note ("adding a catalog field later cannot silently widen disclosure"); ARCH-073
("`/api/workflows` … serve the non-owner projection whenever auth is enabled").

**Evidence:**
- `src/mcp-facade.ts:240` — `async workflow_list(_a: unknown, _ctx: ReadContext)` — both parameters are underscore-prefixed; `_ctx` is **never referenced** in the body.
- `src/mcp-facade.ts:248` — `...workflows.map((w) => ({ kind: 'workflow' as const, ...w, params: … }))` — the raw catalog row is **spread**, not projected.
- `src/server.ts:1037-1039` — `if (path === '/api/workflows') { sendJson(res, 200, await runManager.catalog.list()); }` — no `authEnabled` branch, no projection.
- `src/server.ts:1010-1017` — `/api/home` likewise passes `catalog.list()` output straight into `buildHomeView`.

**Assessment.** No script text leaks *today* — `catalog.list()` returns no `script` column, and its
`description` is on REQ-100's non-owner allowlist. This is therefore a **latent** violation, not a
live disclosure. But it is precisely the failure mode ARCH-075 was written to make structurally
impossible: the next field added to `catalog.list()`'s select (an `owner`, a `defaults`, a cached
`skeleton`) reaches three unauthenticated surfaces with no review gate, because the projection choke
point is not on the path.

**Testability corollary — the required-argument defence is nominal here.** ADR-012's whole argument
for making `ReadContext` required is that "a required argument makes an unwired call site a `tsc`
error". That proves the argument is *passed*; it cannot prove it is *consulted*. On `workflow_list`
it is passed and ignored, so the compiler-enforced guarantee the ADR claims is, for this method,
zero. IMPL-155's green-evidence note ("`workflow_list` masks every entry") overstates what the code
does: nothing is masked; the entries merely never carried a script.

---

### A7 — MEDIUM (scalability — a stated rationale contradicted by the code it justifies)

**Violates:** ARCH-076 ("`workflow_list` returns public views for every row — its per-row
`description`/`params` come from stored columns, **never from a script parse**"); ARCH-074 / ADR-013
(the reason `validateCurrent` is excluded from `workflow_list`: "it is polled by the dashboard every
3s and a per-row script parse there would be a real cost for a surface nobody debugs from").

**Evidence:** `src/workflow-catalog.ts:504-509` —
```
const vrow = version ? (… 'SELECT script, params FROM workflow_versions WHERE name = ? AND version = ?' …) : undefined;
…
description: parseMeta(vrow?.script ?? '').description,
```
The full `script` column is SELECTed **per row** and `parseMeta` is run on it **per row**, on every
call to `list()` — which is the body of `workflow_list` (`mcp-facade.ts:243`), `/api/workflows`
(`server.ts:1038`) and `/api/home` (`server.ts:1011`), i.e. all three of the dashboard's 3s-poll
surfaces. `params` does come from a column, as claimed; `description` does not.

**Assessment.** The exclusion of `validateCurrent` from `workflow_list` may still be the right call,
but its stated justification is void as written: the per-row script read + parse it was bought to
avoid is already paid on the same poll. Cost scales as O(registered workflows × script bytes) per
3s tick, and every registered workflow's full script text is materialised into process memory on
each poll. Under ADR-014's version ceiling the catalog can hold many versions per name, so the
`script` column is the largest thing in the DB and this is the hottest read of it.

**Karpathy check.** Two minimal options, both smaller than a cache (which ADR-009's data-architecture
note rightly forbids): store `description` as a column at registration (the pattern ARCH-067 already
established for `params`, and for the same reason — "so it survives script masking"), or select only
the leading bytes needed by `parseMeta`. Do **not** add the cache the architecture already rejected.

---

### A8 — MEDIUM (testability). `maxWorkflowVersions` reaches the catalog through a structural cast, so the wiring hop it needs is not `tsc`-checked

**Violates:** ARCH-071 inv 6 ("sourced from the **existing** `WorkflowCatalogOpts.ceilings` object
(`:57`) — no new plumbing"); and, in spirit, ARCH-073/ADR-012's own doctrine that a wiring hop must
be a compiler error rather than a remembered call site (the `composeConfig` bug class this repo has
paid for five times and which ARCH-071's own definition-of-done names).

**Evidence:**
- `src/workflow-catalog.ts:342` — `const maxWorkflowVersions = (this._ceilings as (Ceilings & { maxWorkflowVersions?: number }) | undefined)?.maxWorkflowVersions;`
- `src/server.ts:1215-1219` — the same ad-hoc widening on the producing side: `const ceilings: Ceilings & { maxWorkflowVersions?: number } = { …, maxWorkflowVersions: config?.maxWorkflowVersions };`
- `tests/unit/compose-config-v2-wiring.test.ts:175-177` — the wiring test asserts only that `composeConfig` **returns** the key; it never asserts that the value reaches `new WorkflowCatalog(...)`.

**Assessment.** The key *is* wired end-to-end today (`src/main.ts:167` → `server.ts:1219` →
`server.ts:1229`'s constructor call), so this is not a live functional gap. But because the field is
never declared on `Ceilings`, deleting `maxWorkflowVersions:` from the `server.ts` literal compiles
cleanly, every unit test stays green, and the ceiling silently becomes `undefined` — i.e. disabled.
That is the exact shape of the bug class ARCH-071's DoD invokes, reproduced inside the mitigation
for it. Declaring the field on `Ceilings` (one line in `params/contract.ts`) restores the compiler as
the guard and removes both casts.

---

### A9 — LOW (concurrency). `publish()` runs its authorization and existence checks *outside* the transaction; only the `UPDATE` is inside

**Violates:** ARCH-071 inv 5 — "**`register` + `publish` each run inside one `db.transaction()`**".

**Evidence:** `src/workflow-catalog.ts:472` (`_requireName` — owner + pointers read), `:476`
(`_listVersions` — known-versions read), `:477` (`UNKNOWN_VERSION` check), then `:482-484`
```
this._db.transaction(() => {
  this._db.prepare(`UPDATE workflows SET ${column} = ? WHERE name = ?`).run(version, name);
}).immediate();
```
Compare `register()` (`:333-358`), which correctly puts the ownership read, the count read and both
writes inside one `.immediate()` transaction — the invariant is honoured on one of the two methods
named by it.

**Failure scenario.** The cross-process window ARCH-071 inv 5 explicitly names (the self-update
overlap, an operator's second instance): a concurrent `deregister` lands between `_requireName` and
the `UPDATE`. The `UPDATE` matches zero rows, but `publish` still returns
`{channel, version, from}` and emits the structured `catalog.publish:` success log line
(`:487`) — a durable audit record of a publication that never happened. A single-statement
transaction around a write that needs no atomicity is also, on the Karpathy reading, ceremony that
looks like the invariant without providing it.

---

### A10 — LOW (consumability). `VERSION_CEILING_EXCEEDED` prescribes a remedy the API does not have

**Violates:** ADR-014 ("`deregister` keeps today's semantics (owner-gated, removes the name **and now
all its version rows**)") + ARCH-071's own note that no per-version delete exists in v22; against
ARCH-073's stated principle that "for an MCP agent the error text is the documentation".

**Evidence:** `src/workflow-catalog.ts:346` — `… — deregister an old version, or raise the engine's
maxWorkflowVersions ceiling`. There is no per-version delete: `deregister(name, principal)`
(`:373-387`) is name-granular and drops **every** version row plus the `workflows` row.

**Failure scenario.** An agent hits the ceiling, follows the error text, and either loops looking for
a non-existent tool or calls `workflow_deregister` — destroying the entire version history and every
completed run's ability to resolve its pin (ADR-014's own "degrades exactly like a purged workspace"
case), when it believed it was pruning one old draft. The remedy sentence should name the two
operations that actually exist.

---

### A11 — LOW. `workflow_get`'s owner branch returns neither `versions[]` nor `channels{release,beta}`

**Violates:** the v22 interface table — `workflow_get({name, version?})` … "`+versions[]`,
`+channels{release,beta}`, `+validation{ok,errors[]}`".

**Evidence:** `src/mcp-facade.ts:326-343` — the owner `resultObj` and the flat top-level fields carry
`name, version, createdAt, description, phases, script, skeleton, owner, defaults, params,
validation`. No `versions`, no `channels`. (The catalog does supply both —
`WorkflowDetail.channels`/`.versions`, `workflow-catalog.ts:96-98`, `:441-442` — they are simply
dropped on this branch.) The non-owner branch gets `channels` but not `versions`
(`workflow-view.ts:35-45`) — consistent with ARCH-075's literal allowlist, which itself omits
`versions`, so the architecture is internally inconsistent with its own interface table here.

**Consequence.** The author — the reader this branch exists for — has no `workflow_get` path to
discover which versions of their workflow exist or where `release`/`beta` currently point. They must
fall back to `workflow_list`, which does carry both.

---

### A12 — LOW. `list()` falls back to the newest row when both channel pointers are NULL, advertising a version `workflow_run({name})` will refuse

**Violates:** the spirit of ARCH-071 inv 2 / ADR-009 — "a NULL pointer is `CHANNEL_UNPUBLISHED`
naming the channel, **never a fallback to the newest row**". (The invariant is scoped to
`resolveVersionRequest`, which is correct — `workflow-catalog.ts:84, 89` — so this is a reporting
divergence, not a resolution one.)

**Evidence:** `src/workflow-catalog.ts:503` —
`const version = r.release_version ?? r.beta_version ?? versions[versions.length - 1] ?? '';`
and `:509-510` — `description`/`params` are then read from *that* version.

**Consequence.** For an unpublished draft, `workflow_list` reports a concrete `version` with its
description and parameter contract, while `workflow_run({name})` on the same name refuses with
`CHANNEL_UNPUBLISHED`. Two surfaces disagree about what a name means. Emitting `version: null`
alongside the (correct, informative) `versions[]` + `channels{}` would keep the draft visible —
scenario S-1's stated goal — without asserting a runnable version.

---

## §B What the implementation got right (verified, not assumed)

Recorded because an adversarial report that lists only misses misrepresents the slice.

- **The pin, and resume determinism.** `catalog.resolve` once at admission (`run-manager.ts:389`),
  version pinned via the pre-existing `createRun` field (`:447`, `run-store.ts:81`), resume reads
  **through the pin** (`run-manager.ts:641`) with a typed legacy-cohort fallback that records
  `legacySubstitution` and never rewrites the pin (`:645-651`). `scriptVersion` is write-once — no
  `UPDATE … SET scriptVersion` exists. ARCH-072's name-collision warning was heeded:
  `RunEntry.scriptVersion` (`run-manager.ts:136`) stays the in-memory resume counter and is re-seeded
  *from* the durable pin (`:691`), never written back.
- **Ingress closure, both levels, independently.** Schema-level (`script` absent from
  `workflow_run`/`workflow_resume`) *and* runtime-level at two chokepoints —
  `mcp-facade.ts:125` / `:216` and `run-manager.ts:284`, the last of which refuses even a direct
  in-process caller. The ban is correctly **ingress-only**: `resume()` applies no such check, so a
  pre-upgrade run with a persisted `spec.script` still rehydrates (ARCH-072 inv 3).
- **The projection is constructed, not deleted.** `projectWorkflowForRead`
  (`workflow-view.ts:55-72`) builds the non-owner branch from an explicit field list;
  `scriptWithheld: true` is a distinct key; `skeleton`/`phases` are absent from
  `WorkflowPublicView`'s *type*, so a leak is a compile error. `EXPECTED_NON_OWNER_KEYS` lives with
  the module, not at the call site.
- **Masking keys on `authEnabled`, and `args.principal` really is barred on the read path.**
  `mcp-facade.ts:286` — `ctx.authEnabled ? (ctx.principal !== null && ctx.principal === full.owner) : true`;
  the read dispatch at `server.ts:838`/`:859` builds `ctx` from the auth-resolved principal only, with
  no `argPrincipal` destructuring. A NULL-`owner` row falls out fail-closed with no special case.
  ADR-012 is implemented exactly as decided — which is what makes A1's write-side asymmetry
  conspicuous rather than merely unlucky.
- **One enforcement site, no second checker.** `submission-validator.ts` contains **zero**
  `if (spec.script)` branches and its deps shrank to `{catalog}` (`:14-16`), so re-adding an alias
  check there is now a `tsc` error. `validateScriptEntry` runs first in `register()`
  (`workflow-catalog.ts:223-231`), before every other check and every write — "nothing stored" holds
  for all refusal codes.
- **`get()`/`getFull()` are gone.** `grep -rn "catalog\.get(\|\.getFull("` over `src/` returns
  nothing; all six named call sites were converted. This is the invariant most likely to have been
  half-done, and it wasn't.
- **The migration is genuinely atomic and idempotent** (`workflow-catalog.ts:192-208`): one
  `.immediate()` transaction, `INSERT OR IGNORE`, pointer write only where NULL, legacy columns
  dropped inside the same transaction, and an unconditional boot log line so idempotence is
  observable. ADR-011's "single highest-value line in the slice" is present and correct.
- **`mcpUnresolved`** is exactly as re-sited by the closeout amendment: names only, emitted only when
  non-empty (`agent-executor.ts:61`), never `[]`.
- **`FRAME_CLOSE_FORGERY` is re-exported, not re-implemented** (`script-checks.ts:8-9`), and the
  shared regex carries no `g` flag (`params/contract.ts:89`) — so `.test()` is stateless and cannot
  alternate-pass. The one shared predicate serves both the registration half and the dispatch half.

---

## §C Internal conflicts between the three lenses

Recorded per the lens mandate. Where an ADR already priced the trade-off, that is stated; only the
last two are conflicts the architecture did **not** record.

1. **Security vs consumability — the dashboard mask (recorded, ADR-012).** An owner cannot read their
   own script in the dashboard on an auth-enabled deployment. ADR-012 accepted this explicitly and
   the code implements it (`server.ts:1049`). *Correctly resolved in favour of security.* But see A2:
   the DAG half of the same accepted cost was not implemented, so the project pays the usability cost
   of the decision without collecting its security benefit — the worst of both.

2. **Scalability vs observability — `workflow_list` excluded from `validateCurrent` (recorded,
   ADR-013).** Priced at "3s dashboard poll × per-row script parse". A7 shows the premise is false:
   the poll already does a per-row script read and parse. The *decision* may survive on other
   grounds (a `vm.Script` compile is far dearer than `parseMeta`), but the *reason* on file no longer
   distinguishes the two options and should be re-stated.

3. **Simplicity vs operability — ADR-014's ceiling instead of GC (recorded).** Endorsed under the
   Karpathy tie-break: a visible refusal at the front door beats a background sweep that can make an
   audited run unreconstructible. Only the error text is wrong (A10).

4. **Security vs testability — `args.principal` (NOT recorded for writes).** ADR-012 reasoned this
   through for reads and chose real bearers through the injectable `TokenStore` seam. The same
   convenience remains on the write path, and v22's new tool adopted it (A1). The seam that made the
   secure choice cheap for reads exists and is already used by IT-089 — so the trade-off has no live
   cost, and the conflict is only an unclosed one.

5. **Fail-closed reads vs fail-open writes (NOT recorded, and the sharpest conflict in the slice).**
   v22 asks two questions of the same `principal` and answers them with opposite defaults: *may this
   caller see the script?* → keyed on `authEnabled`, fail-closed (`mcp-facade.ts:286`); *may this
   caller change which script everyone runs?* → keyed on `principal !== null`, fail-open
   (`workflow-catalog.ts:473`, and `:338`/`:378` for register/deregister). Under the standard
   threat model, integrity of executable selection dominates confidentiality of the script text —
   an attacker who can move `release` does not need to read anything. No ADR names this asymmetry.
   Under the Karpathy tie-break the resolution is not new architecture but *deleting* the second
   idiom: one predicate, shared by reads and catalog writes.

---

## §D Summary table

| # | Severity | Lens | ARCH / INV / ADR violated | Evidence |
|---|---|---|---|---|
| A1 | HIGH | security | ARCH-071 (publish owner-gated); ADR-012 | `src/server.ts:854-857, 1496, 1611, 1835`; `src/workflow-catalog.ts:473` |
| A2 | HIGH | security | ARCH-073; ARCH-075 (trap 2); ADR-012 accepted cost | `src/server.ts:1085-1109`, cf. `:1049-1053`, `:1695-1707` |
| A3 | HIGH | correctness / upgrade | ARCH-071 inv 7; ADR-011 / S-2 | `src/workflow-catalog.ts:341, 349, 359-364, 192-207` |
| A4 | MEDIUM | observability | ARCH-072 api + inv 2; v22 ER; v22 interface table | `src/run-manager.ts:447`; `src/store/sqlite-run-store.ts:35, 85-86`; `src/workflow-catalog.ts:95` |
| A5 | MEDIUM | consumability | ARCH-072 inv 1; v22 interface table | `src/scheduler.ts:154, 213` |
| A6 | MEDIUM | security (structural) | ARCH-076 api; ARCH-075; ARCH-073 | `src/mcp-facade.ts:240, 248`; `src/server.ts:1010-1017, 1037-1039` |
| A7 | MEDIUM | scalability | ARCH-076; ARCH-074 / ADR-013 rationale | `src/workflow-catalog.ts:504-509` |
| A8 | MEDIUM | testability | ARCH-071 inv 6; ADR-012 wiring doctrine | `src/workflow-catalog.ts:342`; `src/server.ts:1215-1219`; `tests/unit/compose-config-v2-wiring.test.ts:175-177` |
| A9 | LOW | concurrency | ARCH-071 inv 5 | `src/workflow-catalog.ts:472-484` vs `:333-358` |
| A10 | LOW | consumability | ADR-014; ARCH-073 error-text principle | `src/workflow-catalog.ts:346, 373-387` |
| A11 | LOW | consumability | v22 interface table (`workflow_get`) | `src/mcp-facade.ts:326-343` |
| A12 | LOW | consistency | ARCH-071 inv 2 / ADR-009 (spirit) | `src/workflow-catalog.ts:503, 509-510` |

**Recommended gate disposition.** A1, A2 and A3 are code fixes, each small and each with the fix
already named by the architecture it violates. A4 is a decision (build `requested`, or amend the
three surfaces the closeout amendment missed). A5–A8 are one-line-to-one-column fixes. A9–A12 are
text and shape corrections. Nothing here requires re-opening ARCH-071..076's structure: the slice's
shape is right, and the Karpathy tie-break favours closing these by *deleting* a second idiom
(the `principal !== null` gate) rather than adding a mechanism.
