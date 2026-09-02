# Gate 8 RE-REVIEW — Adversarial architecture group (v22, pass 2)

**Lens:** (a) **security** — authn/authz correctness, secret/confidentiality protection, attack
surface; (b) **scalability/performance** — state storage, concurrency, consistency of counting;
(c) **testability** — module boundaries, injectable dependencies, unit/integration reachability.
**Tie-breaker:** Karpathy simplicity-first — the minimum architecture that solves the stated
problem, nothing speculative. Each lens is argued separately; conflicts are surfaced in §C.

**Iteration under review:** v22 — ARCH-071..076 + ADR-009..014 (REQ-096..100), IMPL-148..157.
**This is a RE-REVIEW.** Pass 1 (`07-review.md` §4, the prior contents of this file) found 12
deviations and sent back 4 HIGHs. IMPL-157 (`330eefd`, `2e865e8`, plus the Gate 6.5 simplify)
claims to close them. **This pass judges the tree as it stands now, not the diff** — every prior
finding is re-verified against source, the fix delta itself gets a fresh adversarial read, and the
MEDIUM/LOW debt recorded in `07-review.md` §4.3 is re-checked for whether it is still live.

**Compared against:** `02-architecture.md` §v22 slice (ARCH-071..076, ADR-009..014, the two
`[AMENDED v22 gate-closeout]` notes, the 4+1 views, the v22 data-architecture ER, the v22 interface
& API contracts table); `06-impl-log.md` IMPL-148..157.
**Scope discipline:** the union of IMPL-148..157's `files:` lines — `src/{workflow-catalog,
run-manager,scheduler,webhook-registry,submission-validator,mcp-facade,server,script-checks,
workflow-view,main,run-store,types,errors,agent-executor}.ts`, `src/store/sqlite-run-store.ts`,
`src/gateway/claude-agent-sdk-client.ts`, and the named test files — plus files they cross at a
declared module boundary (`src/params/contract.ts`, `src/net-guard.ts`,
`src/continuation-store.ts`). No full-tree scan. The prior report was copied to scratch before
being overwritten (it is untracked; overwriting it is otherwise destructive).

**Headline.** The four send-back HIGHs are genuinely fixed — verified at source, not taken from the
ledger's word. H2 (DAG masking), H3 (MAX allocator) and H4 (both create ingresses) are complete and
correct. **H1 is closed only for the hole it named.** The anonymous D-BIND write path is shut, but
`workflow_register`/`workflow_deregister` still accept a caller-asserted `args.principal`, and the
owner string that unlocks it is published to every reader by REQ-100's own non-owner allowlist — so
the identical attack reopens with one extra step, on the same deployment shape ADR-012 was written
for. That residue is *disclosed* (DES-117, IT-091's header), which makes it a decision rather than
a discovery, but a disclosed live hole is still an open deviation. The fix also produced a new,
undocumented asymmetry: the *least* destructive of the three catalog writes is the one that lost
its ownership check on auth-disabled deployments, while the *most* destructive (`deregister`) kept
the spoofable one — and a real acceptance oracle was rewritten from "a non-owner is refused" to
"the call succeeds" to accommodate it.

**Verdict: NOT consistent — 13 open deviations (1 HIGH, 7 MEDIUM, 5 LOW).**

---

## §0 Disposition of pass 1's 12 findings (each re-verified at source)

| Prior | Pass-1 sev | Status now | Evidence in the current tree |
|---|---|---|---|
| A1 (H1) — `publish` reachable anonymously; `args.principal` self-assertion | HIGH | **PARTLY FIXED** → re-raised as **B1** | `server.ts:857-880`: all three writes now refuse `authEnabled && effectivePrincipal === null` with `PRINCIPAL_REQUIRED` (`server.ts:812-815`) *before* the ownership comparison; `workflow_publish` drops `args.principal` entirely (`:876-880`). `workflow_register`/`workflow_deregister` **keep** the fallback (`:858`, `:865`). |
| A2 (H2) — DAG route serves the script-derived skeleton under auth | HIGH | **FIXED** | `server.ts:1132` — `const skeletonNodes = authEnabled ? [] : parseWorkflowSkeleton(skeletonScript);`. Mirrors the sibling skeleton route (`:1060-1071`). Live agent nodes still reach `layoutGraph`. |
| A3 (H3) — `COUNT(*)` version allocator | HIGH | **FIXED** | `workflow-catalog.ts:353-356` — `SELECT MAX(CAST(SUBSTR(version, 2) AS INTEGER))`, `v${(maxVersion ?? 0) + 1}`. The `COUNT(*)` read survives at `:341` and is used **only** for the ceiling, which is the correct quantity there. |
| A4 (M1) — `runs.requested` / `runs.validation` asserted on 3 arch surfaces, absent in code | MEDIUM | **STILL OPEN** → **B3** | `grep -n requested src/run-manager.ts src/run-store.ts src/store/sqlite-run-store.ts src/types.ts` → 0 hits on the run record. |
| A5 (H4) — `Scheduler.create()` checks `exists()`, not "resolves `release`" | MEDIUM→HIGH | **FIXED, both sites** | `scheduler.ts:157-165` and `webhook-registry.ts:93-99` both call `catalog.resolve(name, {channel:'release'})` and map failures through the shared `catalogResolveErrorEnvelope` (`errors.ts:52-72`). `Scheduler.trigger()` still uses `exists()` — correctly, per adjudication #6. |
| A6 (M2) — `workflow_list` / `/api/workflows` / `/api/home` bypass the projection | MEDIUM | **STILL OPEN** → **B4** | `mcp-facade.ts:240,248`; `server.ts:1029-1034`, `:1056-1058`. |
| A7 (M3) — `list()` does a per-row `SELECT script` + `parseMeta` on the 3s poll | MEDIUM | **STILL OPEN** → **B5** | `workflow-catalog.ts:511-516`. |
| A8 (M4) — `maxWorkflowVersions` reaches the catalog through a structural cast | MEDIUM | **STILL OPEN** → **B6** | `workflow-catalog.ts:342`; `server.ts:1239-1243`; `Ceilings` still 3 fields (`params/contract.ts:39-43`). |
| A9 (L1) — `publish()`'s checks outside its transaction | LOW | **STILL OPEN** → **B9** | `workflow-catalog.ts:479-491`. |
| A10 (L2) — `VERSION_CEILING_EXCEEDED` names a remedy that does not exist | LOW | **STILL OPEN** → **B10** | `workflow-catalog.ts:346` vs `:380-394`. |
| A11 (L3) — `workflow_get` drops `versions[]`/`channels{}` | LOW | **STILL OPEN** → **B11** | `mcp-facade.ts:326-345`; `workflow-view.ts:61-71`. |
| A12 (L4) — `list()` newest-row fallback vs `CHANNEL_UNPUBLISHED` | LOW | **STILL OPEN** → **B12** | `workflow-catalog.ts:510`. |

Also carried from the quality lens and re-verified: **M5/O-2** (nested `workflow()` discards the
resolved version) is **still open** → **B7**.

Three findings are **new this pass**: **B2** (the fix's own asymmetry + the weakened acceptance
oracle), **B8** (`chain_create` vs the v22 interface table), **B13** (the surviving
`scriptVersion` namespace collision on the journal).

---

## §A Findings

### B1 — HIGH (security). H1's gate is bypassed by echoing the `owner` string REQ-100 publishes: `workflow_register` / `workflow_deregister` still honour `args.principal`

**Violates:** ARCH-071 (`register`/`deregister`/`publish` — "owner-gated, `NOT_WORKFLOW_OWNER`");
ADR-012's rider ("the identity used for masking comes **only** from `resolvePrincipal`, never from
`args.principal` … since `owner` is in the non-owner allowlist, reusing it would make the mask
bypassable by echoing its own response") — the rider's stated *reason* is identity-integrity, and
it was applied to reads and to `publish` but not to the two writes that predate them.

**Evidence:**
- `src/server.ts:1520` — `const dbindExempt = isLoopbackPeer(req.socket?.remoteAddress, req.headers) && !isLoopback(bind);`
- `src/server.ts:1635` — `if (!dbindExempt && req.method === 'POST' && req.url?.startsWith('/mcp'))` — an exempt caller skips the bearer gate whole and falls through to…
- `src/server.ts:1859` — `callTool(…, args, null, !!authCfg)` — `principal = null`, `authEnabled = true`.
- `src/server.ts:857-859` — `workflow_register`: `const effectivePrincipal = principal ?? (typeof argPrincipal === 'string' ? argPrincipal : null); if (authEnabled && effectivePrincipal === null) return principalRequiredEnvelope();` — **a supplied string satisfies the new gate.**
- `src/server.ts:864-866` — `workflow_deregister`: identical.
- `src/workflow-catalog.ts:338` / `:385` — the ownership comparison then *passes* because the asserted string equals the stored `owner`.
- `src/workflow-view.ts:41` + `src/mcp-facade.ts:308,330,338` — `owner` is on the non-owner allowlist and on the owner branch, i.e. every reader is handed the exact string the fallback accepts.

**Failure scenario.** Server bound `0.0.0.0`, `auth.enabled = true` — the deployment REQ-100 exists
for. An unauthenticated local process calls `workflow_get({name:'deploy-prod'})`, reads
`owner: "alice@example.com"` out of the masked projection, then POSTs
`workflow_deregister({name:'deploy-prod', principal:'alice@example.com'})`. `PRINCIPAL_REQUIRED`
does not fire (the principal is non-null); the catalog's owner check does not fire (the strings
match); `deregister` drops the `workflows` row **and every `workflow_versions` row**
(`workflow-catalog.ts:389-392`). Every schedule, webhook and chain bound to that name now fails,
and every completed run's pin dangles (ADR-014's own "degrades exactly like a purged workspace",
except triggered by an anonymous caller rather than the owner). `workflow_register` is reachable
the same way, adding versions under a stolen identity.

**Why it is an architecture deviation, not merely surviving debt.** ARCH-071 states the gate as a
property of the operation ("owner-gated"), not of the transport, and ADR-012 spent an entire ADR
establishing that a self-asserted `args.principal` is not an identity *because `owner` is
disclosed*. The implementation applies that reasoning to two of three catalog writes. The residue
**is disclosed** — `04-design.md` DES-117's amended row, IT-091's file header, and IMPL-157's note
all say plainly that the fallback is retained as accepted debt — so this is a decision the gate
must ratify, not a defect it must discover. It is nonetheless live, and it fully reopens the attack
H1 was raised to close.

**Karpathy check.** The fix is a deletion, not a mechanism: drop the two `?? argPrincipal`
fallbacks, exactly as `workflow_publish` already did. Catalog-layer integration tests that need a
principal already have a seam — `catalog-versions.test.ts` calls `catalog.publish()` directly with
a real principal, and IT-089 mints a real bearer through the injectable `TokenStore`. The
convenience the fallback buys has had a supported replacement since v15.

---

### B2 — MEDIUM (security / testability, introduced by the fix). Three catalog writes now use three different identity idioms, the least destructive one lost its check on auth-disabled deployments, and an acceptance oracle was inverted to match

**Violates:** ARCH-071 (one ownership gate, uniformly stated for `register`/`deregister`/`publish`);
ADR-013's stated design property that v22's checks give "no two gates that can disagree"; the v22
interface table's `workflow_publish` error list (`NOT_WORKFLOW_OWNER` first).

**Evidence:**
- `src/server.ts:876-880` — `workflow_publish` destructures `principal: _argPrincipal` and discards it; `effectivePrincipal = principal`.
- `src/server.ts:857-866` — `workflow_register`/`workflow_deregister` keep the fallback.
- On an **auth-disabled** server `principal` is always `null` at both dispatch sites, so
  `workflow_publish` reaches `catalog.publish(name, version, channel, null)` and
  `workflow-catalog.ts:480` (`row.owner && principal !== null && …`) skips the comparison — **no
  ownership check runs at all**.
- `tests/acceptance/val-107-release-channels.test.ts:57-62` — the pre-existing oracle
  "a non-owner is refused `NOT_WORKFLOW_OWNER`" was **rewritten in place** to
  `const anyonePublish = await toolCall('workflow_publish', {…, principal:'not-the-owner@example.com'}); expect(anyonePublish['error']).toBeUndefined();`

**Assessment.** Each half is individually defensible — D-AUTH-6 says ownership is not enforced
without a principal, and dropping `args.principal` is the ADR-012-correct move. Composed, they
produce an outcome nobody chose: on the single-operator deployment the project treats as its floor,
`workflow_publish` — the one operation that decides *which script every future run of a name
executes* — is the only catalog write with zero ownership enforcement, while `deregister` keeps a
check that a caller can satisfy by echoing a published string. The safer tool got the stricter rule
and the weaker outcome.

**Testability half, which is the sharper cost.** VAL-107 was a real-tier acceptance oracle asserting
a refusal; it now asserts a success. The replacement coverage IMPL-157 names is real but narrower:
`catalog-versions.test.ts` exercises the *catalog method* with a principal (never the dispatch
layer), and IT-091 exercises the *anonymous* case under auth. **No test anywhere asserts that an
authenticated non-owner is refused `NOT_WORKFLOW_OWNER` on `workflow_publish` over HTTP** — the one
shape ARCH-071's owner-gate clause is actually about — verified by reading all five files that
mention the code: `val-097-workflow-ownership.test.ts:147-160` pins exactly that shape over real
HTTP with real bearers for **`workflow_register` and `workflow_deregister`** (bob →
`NOT_WORKFLOW_OWNER`) and simply has no `workflow_publish` counterpart, while
`workflow-masking-http.test.ts:84,144` and `val-097:144` only ever publish as the *owner*. The
seam, the fixture and the pattern all already exist one `it()` block away. Inverting an oracle to
match a behaviour change is the correct move *only* when the property it protected is re-pinned
elsewhere; here it was retired.

---

### B3 — MEDIUM (observability). `runs.requested` is asserted by three architecture surfaces, computed in code, and dropped before it can be stored

**Violates:** ARCH-072 **api** ("the run record additionally carries the **request shape**
(`requested: {version} | {channel} | 'default-release'`)"); ARCH-072 inv 2 ("the per-run pin **plus
the recorded request shape** is what makes 'which version did this cron actually run' answerable
afterwards"); the v22 data-architecture ER (`RUNS { text requested "v22 NEW" }`); the v22 interface
table (`workflow_status(runId)` "reports the **pinned** version **and the request shape**").

**Evidence:**
- `src/workflow-catalog.ts:67,77,86,90` — `resolveVersionRequest` returns `requested` for all three shapes, correctly…
- `src/workflow-catalog.ts:95` — …and `VersionEntry` has no `requested` field; `resolve()` (`:431-436`) drops it on the floor.
- `src/run-manager.ts:447` — `await this._store.createRun(spec, resolvedVersion, persistedParams)` — no third observation.
- `src/store/sqlite-run-store.ts:35,85-86` — the `runs` DDL and `INSERT` carry `scriptVersion`, no `requested`, no `validation`.

**Assessment.** The `validation` half **was** superseded at the gate closeout — ARCH-074 and ADR-013
both carry `[AMENDED v22 gate-closeout, adjudication #5 O-1]` re-siting it on
`HarnessDescriptor.mcpUnresolved`, and that mechanism is built and correct (`types.ts:246`,
`agent-executor.ts:47,61`, `claude-agent-sdk-client.ts:422,505,606`; absent-never-`[]` honoured).
The **`requested` half was never superseded and was never built**, and the amendment reached only
the two prose notes — not ARCH-072's `api:` line, not the ER, not the interface table. After a
`release` pointer moves, a run shows *which* version ran but not *whether it was pinned, channelled
or defaulted* — verbatim the question ARCH-072 inv 2 says the field exists to answer.

**Disposition.** Build it (one column, one field, already computed) **or** amend the three surfaces
the way ARCH-074 was amended. Three documents asserting a field that does not exist is this
ledger's most-paid-for drift class.

---

### B4 — MEDIUM (security-structural, latent). The "one choke point by construction" is bypassed by `workflow_list`, `/api/workflows` and `/api/home`; the required `ReadContext` is never read

**Violates:** ARCH-076 api ("the response is whatever `projectWorkflowForRead` returns, **never a
row**"); ARCH-075 note ("adding a catalog field later cannot silently widen disclosure");
ARCH-073 ("`/api/workflows` … serve the non-owner projection whenever auth is enabled").

**Evidence:**
- `src/mcp-facade.ts:240` — `async workflow_list(_a: unknown, _ctx: ReadContext)`; `_ctx` is never referenced in the body.
- `src/mcp-facade.ts:248` — `...workflows.map((w) => ({ kind: 'workflow' as const, ...w, params: … }))` — the raw catalog row is **spread**, not projected.
- `src/server.ts:1056-1058` — `if (path === '/api/workflows') { sendJson(res, 200, await runManager.catalog.list()); }` — no `authEnabled` branch, no projection.
- `src/server.ts:1029-1034` — `/api/home` feeds `catalog.list()` straight into `buildHomeView`.

**Assessment.** No script text leaks today: `list()` selects no `script` into its return shape, and
`description` is on REQ-100's non-owner allowlist. This is a **latent** violation. But it is exactly
the failure mode ARCH-075 exists to make structurally impossible — the next field added to
`list()`'s shape (an `owner`, a `defaults`, a cached `skeleton`) reaches three unauthenticated
surfaces with no gate on the path.

**Testability corollary.** ADR-012's argument for a required `ReadContext` is that "a required
argument makes an unwired call site a `tsc` error". That proves the argument is *passed*; it cannot
prove it is *consulted*. On `workflow_list` it is passed and ignored, so the compiler-enforced
guarantee is, for this method, zero — and IMPL-155's green-evidence claim that "`workflow_list`
masks every entry" overstates the code: nothing is masked, the entries merely never carried a
script.

---

### B5 — MEDIUM (scalability). ADR-013's stated reason for excluding `workflow_list` from `validateCurrent` is false as written — the 3s poll already reads and parses every script

**Violates:** ARCH-076 ("`workflow_list` returns public views for every row — its per-row
`description`/`params` come from stored columns, **never from a script parse**"); ARCH-074 /
ADR-013's exclusion rationale ("polled by the dashboard every 3s and a per-row script parse there
would be a real cost for a surface nobody debugs from").

**Evidence:** `src/workflow-catalog.ts:511-516` —
```
const vrow = version
  ? (this._db.prepare('SELECT script, params FROM workflow_versions WHERE name = ? AND version = ?').get(r.name, version) as …)
  : undefined;
…
description: parseMeta(vrow?.script ?? '').description,
```
The full `script` column is SELECTed **per row** and `parseMeta` runs on it **per row**, on every
`list()` — the body of `workflow_list` (`mcp-facade.ts:243`), `/api/workflows` (`server.ts:1057`)
and `/api/home` (`server.ts:1030`), i.e. all three polled surfaces. `params` does come from a
column, as ARCH-076 claims; `description` does not.

**Second site, introduced by the H2 fix.** `server.ts:1114-1126` still resolves the pinned version's
**full script** on every `GET /api/runs/:id/dag` and then discards it at `:1132` when
`authEnabled` — a per-poll script materialisation whose only consumer is now unreachable. Hoisting
the `authEnabled` check above the resolve is one line and strictly smaller code.

**Assessment.** The *decision* to exclude `validateCurrent` may survive on other grounds (a
`vm.Script` compile is far dearer than `parseMeta`), but the *reason on file* no longer
distinguishes the options: the cost it was bought to avoid is already paid on the same poll. Cost
scales O(registered workflows × script bytes) per 3s tick, and under ADR-014's ceiling `script` is
the largest column in the DB.

**Karpathy check.** Two minimal options, both smaller than the cache ADR-009's data-architecture
note rightly forbids: store `description` as a column at registration (exactly the pattern ARCH-067
established for `params`, and for the same "survives script masking" reason), or bound the read to
the leading bytes `parseMeta` needs.

---

### B6 — MEDIUM (testability). `maxWorkflowVersions` reaches the catalog through a structural cast on both sides, so the wiring hop is not `tsc`-checked

**Violates:** ARCH-071 inv 6 ("sourced from the **existing** `WorkflowCatalogOpts.ceilings` object
(`:57`) — no new plumbing") and, in spirit, ARCH-071's own definition of done, which names the
`composeConfig` wiring-bug class this repo has paid for five times.

**Evidence:**
- `src/workflow-catalog.ts:342` — `const maxWorkflowVersions = (this._ceilings as (Ceilings & { maxWorkflowVersions?: number }) | undefined)?.maxWorkflowVersions;`
- `src/server.ts:1239-1243` — the same ad-hoc widening on the producing side.
- `src/params/contract.ts:39-43` — `Ceilings` is still `{maxTimeoutMs, maxAppendPromptBytes, maxEffort}`; the field is declared nowhere.
- `tests/unit/compose-config-v2-wiring.test.ts:175-177` — asserts only that `composeConfig` **returns** the key; never that the value reaches `new WorkflowCatalog(...)`.

**Assessment.** The key is wired end-to-end today (`main.ts:167` → `server.ts:1243` → `:1264`), so
this is not a live functional gap. But because the field is never declared on `Ceilings`, deleting
`maxWorkflowVersions:` from the `server.ts` literal compiles cleanly, every unit test stays green,
and the ceiling silently becomes `undefined` — i.e. disabled. That is the exact bug class
ARCH-071's DoD invokes, reproduced inside its own mitigation. One line on `Ceilings` restores the
compiler as the guard and deletes both casts.

---

### B7 — MEDIUM (observability). Nested `workflow()` resolves `release` and then discards the version the architecture says it must record

**Violates:** ARCH-072 api ("nested `workflow(name)` (`:801`) resolves the **`release`** channel
**and records the resolved version on the journal entry**").

**Evidence:**
- `src/run-manager.ts:816` — `const registered = await this._catalog.resolve(name, {});` — the `release` resolution is correct.
- `src/run-manager.ts:821` — `entry.workflowNodes.push({ frame: framePathKey, name, parentFrame: parentPathKey, depth });` — `registered.version` is never carried.
- `src/types.ts:100-105` — `WorkflowNodeView` has no `version` field.

**Assessment.** A composed run is now the one place where "which version actually ran" is
unanswerable, and it is the place where the answer changes most often: ARCH-072's own declared
residual says an unsettled nested call **re-resolves `release` on resume**, so a parent pinned at
`v3` can execute child `v7` on the first pass and child `v8` after a resume, with nothing on either
record distinguishing them. IMPL-152's ledger note claims this was done; the diff does not do it.
One field on the push, one on the type.

---

### B8 — MEDIUM (doc-vs-code). The v22 interface table asserts a `chain_create` release-check that has no code and no seam

**Violates:** the v22 interface & API contracts table, row `schedule_create` / `chain_create` /
`webhook_create` — "creation now requires the name to resolve on `release`… errors
`WORKFLOW_NOT_FOUND`, `CHANNEL_UNPUBLISHED` at creation".

**Evidence:** `src/continuation-store.ts:93-106` — `chainCreate` validates `afterRunId` only;
`grep -n catalog src/continuation-store.ts` returns **zero hits** — the class holds no catalog
reference of any kind. A chain bound to a name that has never been registered is accepted, stored,
and fails later inside `_reconcile`.

**Assessment.** `07-review.md` §8.2 raised this and deliberately routed it out of the send-back
batch, on the sound ground that it is a pre-existing v8 defect rather than a v22 regression and
that closing it needs a new constructor port plus composition-root wiring (this repo's known
silent-no-op class). That ruling governs the *code*. It does not govern the *document*: with H4
now closing both of the row's other two ingresses, the interface table is the only surface still
asserting a property that exactly one third of its named tools lacks. Either narrow the row to the
two sites that implement it and record chain as a named residual, or carry the REQ into v23 — but
do not leave the contracts table asserting it.

---

### B9 — LOW (concurrency). `publish()` runs its authorization and existence checks *outside* the transaction; only the `UPDATE` is inside

**Violates:** ARCH-071 inv 5 — "**`register` + `publish` each run inside one `db.transaction()`**".

**Evidence:** `src/workflow-catalog.ts:479` (`_requireName` — owner + pointers), `:483`
(`_listVersions`), `:484` (`UNKNOWN_VERSION` check), then `:489-491`:
```
this._db.transaction(() => {
  this._db.prepare(`UPDATE workflows SET ${column} = ? WHERE name = ?`).run(version, name);
}).immediate();
```
Compare `register()` (`:333-365`), which correctly puts the ownership read, the count/max reads and
both writes inside one `.immediate()` transaction — the invariant is honoured on one of the two
methods it names. `deregister()` (`:381-392`) has the same shape as `publish` (ownership read
outside, deletes inside); ARCH-071 inv 5 does not name it, so it is noted, not charged.

**Failure scenario.** The cross-process window ARCH-071 inv 5 explicitly names (self-update overlap,
an operator's second instance): a concurrent `deregister` lands between `_requireName` and the
`UPDATE`. The `UPDATE` matches zero rows, `publish` still returns `{channel, version, from}` and
still emits the structured `catalog.publish:` audit line (`:494`) — a durable record of a
publication that never happened. A single-statement transaction around a write that needs no
atomicity is also, on the Karpathy reading, ceremony shaped like the invariant without providing
it.

---

### B10 — LOW (consumability). `VERSION_CEILING_EXCEEDED` prescribes a remedy the API does not have

**Violates:** ADR-014 ("`deregister` keeps today's semantics — owner-gated, removes the name **and
now all its version rows**") and ARCH-071's note that no per-version delete exists in v22; against
ARCH-073's stated principle that "for an MCP agent the error text is the documentation".

**Evidence:** `src/workflow-catalog.ts:346` — `… — deregister an old version, or raise the engine's
maxWorkflowVersions ceiling`. There is no per-version delete: `deregister(name, principal)`
(`:380-394`) is name-granular and drops every version row plus the `workflows` row.

**Failure scenario.** An agent hits the ceiling, follows the error text, and either loops hunting a
tool that does not exist or calls `workflow_deregister` — destroying the whole version history and
every completed run's ability to resolve its pin, believing it pruned one old draft. The remedy
sentence should name the two operations that exist.

---

### B11 — LOW (consumability). `workflow_get`'s owner branch returns neither `versions[]` nor `channels{release,beta}`

**Violates:** the v22 interface table — `workflow_get({name, version?})` … "`+versions[]`,
`+channels{release,beta}`, `+validation{ok,errors[]}`".

**Evidence:** `src/mcp-facade.ts:326-345` — the owner `resultObj` and the flat top-level fields
carry `name, version, createdAt, description, phases, script, skeleton, owner, defaults, params,
validation`. No `versions`, no `channels`. The catalog supplies both
(`WorkflowDetail.channels`/`.versions`, `workflow-catalog.ts:96-98`, `:443-450`); the owner branch
drops them. The non-owner branch gets `channels` but not `versions` (`workflow-view.ts:61-71`) —
faithful to ARCH-075's literal allowlist, which itself omits `versions`, so the architecture is
internally inconsistent with its own interface table here.

**Consequence.** The author — the reader this branch exists for — has no `workflow_get` path to
discover which versions exist or where `release`/`beta` point, and must fall back to
`workflow_list`, the surface that does carry both.

---

### B12 — LOW (consistency). `list()` falls back to the newest row when both pointers are NULL, advertising a version `workflow_run({name})` will refuse

**Violates:** the spirit of ARCH-071 inv 2 / ADR-009 — "a NULL pointer is `CHANNEL_UNPUBLISHED`
naming the channel, **never a fallback to the newest row**". (The invariant is scoped to
`resolveVersionRequest`, which is correct — `workflow-catalog.ts:84,89` — so this is a *reporting*
divergence, not a resolution one.)

**Evidence:** `src/workflow-catalog.ts:510` —
`const version = r.release_version ?? r.beta_version ?? versions[versions.length - 1] ?? '';`
and `:516-517`, where `description`/`params` are then read from *that* version.

**Consequence.** For an unpublished draft, `workflow_list` reports a concrete `version` with its
description and parameter contract while `workflow_run({name})` on the same name refuses
`CHANNEL_UNPUBLISHED`. Two surfaces disagree about what a name means. `version: null` beside the
(correct, informative) `versions[]` + `channels{}` keeps the draft visible — scenario S-1's goal —
without asserting a runnable version.

---

### B13 — LOW (testability / diagnosability). The `scriptVersion` namespace collision ARCH-072 warned about survives at the one user-visible surface, where version history makes it newly plausible

**Violates:** nothing ARCH-072 states as an invariant — both of its named rules are honoured — but
it defeats the *purpose* of the name-collision warning ARCH-072 wrote specifically so Gate 4/5
would not conflate the two fields.

**Evidence:**
- `src/run-manager.ts:392` — the in-memory counter is **seeded from the catalog version**: `scriptVersion = Number(registered.version.replace(/^v/, '')) || 1;` (and `:691` on resume).
- `src/run-manager.ts:563` — `entry.scriptVersion += 1;` per resume.
- `src/run-manager.ts:898` — every journal entry is stamped `scriptVersion: \`v${entry.scriptVersion}\``.

**Assessment.** The two load-bearing rules hold and were verified: `runs.scriptVersion` is
write-once (no `UPDATE … SET scriptVersion` exists anywhere), and the counter never writes back to
the pin. What survives is the *observable* collision: a run pinned at `v3` that has been resumed
once stamps its journal entries `v4` — a string that is now a **real, resolvable catalog version of
the same workflow**. Pre-v22 the counter's output could not be mistaken for a catalog version
because only one ever existed per name; version history is exactly what makes the confusion
plausible, and journal entries are exactly what a debugger reads to answer "which script produced
this". Under the testability lens the cost is concrete: no oracle can distinguish the two meanings
from the value. Renaming the journal field (`resumeGeneration`, a bare integer) is a two-line
change with no behavioural surface.

---

## §B What the implementation got right (verified this pass, not assumed)

Recorded because a re-review that lists only residue misrepresents a send-back that largely worked.

- **All four send-back HIGHs were re-verified at source, and three are cleanly complete.** H2's
  masking mirrors its sibling route exactly and withholds only the derived overlay; H3's allocator
  is the precise expression ARCH-071 inv 7 named, with the `COUNT(*)` correctly *retained* for the
  ceiling (a row count, which is the quantity ADR-014 describes); H4 closed **both** sites its own
  text named, and `Scheduler.trigger()` was correctly left alone with a recorded reason.
- **The Gate 6.5 simplify is a real simplification, not churn.** Two hand-rolled error ladders
  collapsed into `catalogResolveErrorEnvelope` (`errors.ts:52-72`), consistent with that module's
  own `codedError` precedent, and the untestable non-`Error` branch was **deleted** rather than
  covered — the Karpathy-correct direction, and unusual to see chosen.
- **The pin and resume determinism.** `catalog.resolve` once at admission (`run-manager.ts:386-392`),
  pinned through the pre-existing `createRun` field (`:447`), resume reads **through the pin**
  (`:641`) with a typed legacy-cohort fallback that records `legacySubstitution` and never rewrites
  the pin (`:645-651`).
- **Ingress closure, both levels, independently.** Schema-level (`script` absent from
  `workflow_run`/`workflow_resume`) *and* runtime-level at two chokepoints (`mcp-facade.ts:126`/`:217`,
  `run-manager.ts:284`), the second of which refuses even a direct in-process caller. Correctly
  **ingress-only**: `resume()` applies no such check, so a pre-upgrade run with a persisted
  `spec.script` still rehydrates (ARCH-072 inv 3).
- **The projection is constructed, not deleted.** `projectWorkflowForRead`
  (`workflow-view.ts:55-72`) builds the non-owner branch from an explicit field list;
  `scriptWithheld: true` is a distinct key; `skeleton`/`phases` are absent from
  `WorkflowPublicView`'s **type**, so a leak is a compile error. `EXPECTED_NON_OWNER_KEYS` lives
  with the module, not at the call site.
- **Read-path masking is exactly ADR-012.** `mcp-facade.ts:286` —
  `ctx.authEnabled ? (ctx.principal !== null && ctx.principal === full.owner) : true`; the read
  dispatch builds `ctx` from the auth-resolved principal only, with no `argPrincipal`
  destructuring, and a NULL-`owner` row falls out fail-closed with no special case. This is what
  makes B1's write-side asymmetry conspicuous rather than merely unlucky.
- **One enforcement site, no second checker.** `submission-validator.ts` has zero `if (spec.script)`
  branches and its deps shrank to `{catalog}`, so re-adding an alias check there is a `tsc` error.
  `validateScriptEntry` runs **first** in `register()` (`workflow-catalog.ts:223-231`), before every
  other check and every write — "nothing stored" holds for every refusal code, including the ceiling.
- **`get()`/`getFull()` are genuinely gone** (0 hits over `src/`), and `mcpLookup` really is wired
  in the composition root (`server.ts:1257`) rather than silently defaulting to `() => true`.
- **The boot migration is atomic and idempotent** (`workflow-catalog.ts:192-209`): one `.immediate()`
  transaction, `INSERT OR IGNORE`, pointer write only where NULL, legacy columns dropped inside the
  same transaction, guarded so a post-migration boot cannot resurrect them, and an unconditional log
  line so idempotence is observable.
- **`mcpUnresolved`** matches the closeout amendment exactly: names only, emitted only when
  non-empty, never `[]`.

---

## §C Internal conflicts between the three lenses

1. **Security vs consumability — the dashboard mask (recorded, ADR-012).** An owner cannot read
   their own script, and now cannot see the predicted DAG overlay, on an auth-enabled deployment.
   ADR-012 priced both. **Now genuinely resolved in favour of security:** pass 1 noted the project
   was paying the usability cost without collecting the benefit; H2 closed that, so the trade is
   the one that was decided.
2. **Security vs testability — `args.principal` (still unresolved, B1/B2).** ADR-012 reasoned this
   through for reads and chose real bearers via the injectable `TokenStore`. `workflow_publish`
   followed; `register`/`deregister` did not. The seam that makes the secure choice cheap already
   exists and is already used (IT-089, IT-091), so the conflict has **no live cost to resolving
   it** — it is purely an unclosed one, and the Karpathy resolution is a deletion, not a mechanism.
3. **Security vs testability, the inverted case (new, B2).** Dropping `args.principal` from
   `workflow_publish` was the *security*-correct move and it **destroyed a test oracle** rather than
   relocating it. This is the honest form of the conflict: the two lenses genuinely pull opposite
   ways here, and the resolution is not to restore the fallback but to re-pin the property at the
   layer where it still holds (an authenticated non-owner over HTTP).
4. **Scalability vs observability — `workflow_list` excluded from `validateCurrent` (recorded,
   ADR-013; premise falsified, B5).** The decision may survive on other grounds (a `vm.Script`
   compile is far dearer than `parseMeta`), but the reason on file no longer distinguishes the
   options and should be restated rather than left as a rationale a future reader will trust.
5. **Simplicity vs safety — the H1 half-fix (new).** Karpathy's tie-break was invoked to keep the
   send-back batch minimal, and closing the *narrower, more severe* hole first is a defensible
   application of it. But the residue is not a smaller version of the same risk: it is the **same
   attack, on the same deployment, with one extra read** — and the read is served by REQ-100's own
   allowlist. Minimum-that-solves-the-problem is measured against the problem, and here the problem
   was "an unauthenticated caller can move/destroy a name", which remains true.
6. **Simplicity vs operability — ADR-014's ceiling instead of GC (recorded).** Endorsed under the
   tie-break: a visible front-door refusal beats a sweep that can make an audited run
   unreconstructible. Only the error text is wrong (B10).

---

## §D Summary table

| # | Sev | Lens | ARCH / INV / ADR violated | Evidence |
|---|---|---|---|---|
| B1 | HIGH | security | ARCH-071 (owner-gated writes); ADR-012 rider | `src/server.ts:857-866, 1520, 1635, 1859`; `src/workflow-catalog.ts:338, 385`; `src/workflow-view.ts:41` |
| B2 | MEDIUM | security / testability | ARCH-071; ADR-013 ("no two gates that can disagree"); v22 interface table | `src/server.ts:857-880`; `src/workflow-catalog.ts:480`; `tests/acceptance/val-107-release-channels.test.ts:57-62` |
| B3 | MEDIUM | observability | ARCH-072 api + inv 2; v22 ER; v22 interface table | `src/workflow-catalog.ts:95`; `src/run-manager.ts:447`; `src/store/sqlite-run-store.ts:35, 85-86` |
| B4 | MEDIUM | security (structural, latent) | ARCH-076 api; ARCH-075; ARCH-073 | `src/mcp-facade.ts:240, 248`; `src/server.ts:1029-1034, 1056-1058` |
| B5 | MEDIUM | scalability | ARCH-076; ADR-013 rationale | `src/workflow-catalog.ts:511-516`; `src/server.ts:1114-1132` |
| B6 | MEDIUM | testability | ARCH-071 inv 6 + its own DoD | `src/workflow-catalog.ts:342`; `src/server.ts:1239-1243`; `src/params/contract.ts:39-43` |
| B7 | MEDIUM | observability | ARCH-072 api | `src/run-manager.ts:816, 821`; `src/types.ts:100-105` |
| B8 | MEDIUM | doc-vs-code | v22 interface table (`chain_create` row) | `src/continuation-store.ts:93-106` |
| B9 | LOW | concurrency | ARCH-071 inv 5 | `src/workflow-catalog.ts:479-491` vs `:333-365` |
| B10 | LOW | consumability | ADR-014; ARCH-073 error-text principle | `src/workflow-catalog.ts:346, 380-394` |
| B11 | LOW | consumability | v22 interface table (`workflow_get`) | `src/mcp-facade.ts:326-345`; `src/workflow-view.ts:61-71` |
| B12 | LOW | consistency | ARCH-071 inv 2 / ADR-009 (spirit) | `src/workflow-catalog.ts:510, 516-517` |
| B13 | LOW | testability / diagnosability | ARCH-072 name-collision warning (purpose, not letter) | `src/run-manager.ts:392, 563, 691, 898` |

**Recommended gate disposition.** B1 is the only finding that should govern the verdict, and it is a
**ratification decision, not a discovery** — the residue is disclosed in DES-117, IT-091's header
and IMPL-157's own note, so the owner may close it as accepted debt with eyes open, or spend the
two-line deletion. B2 is cheap and should not wait: re-pin the authenticated-non-owner refusal that
VAL-107 stopped asserting. B3 and B8 are decisions (build the field / narrow the row), not code
defects. B4–B7 are one-column/one-line/one-field fixes. B9–B13 are text and shape corrections.
Nothing here reopens ARCH-071..076's structure: the slice's shape is right, and every remaining fix
is smaller than the code it replaces.
