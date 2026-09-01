# Architecture panel — Adversarial group, round 1 (independent proposal)

- **Feature**: 001-remote-workflow-engine
- **Iteration**: v22 — author/user separation part 2: version history, release channels, closing inline script (REQ-096..100)
- **Lenses carried (three, in tension)**: (a) Security — authn/authz correctness, secret/asset protection, attack surface; (b) Scalability/performance — state storage, horizontal scaling, concurrency & consistency; (c) Testability — module boundaries, injectable deps, cheap unit/integration tests.
- **Tie-breaker discipline**: Karpathy simplicity-first — the minimum architecture that closes the requirement, nothing speculative.
- **Safety class**: QM (state.yaml) → no safety work products.

---

## 0. Altitude judgment (done first, per task)

**Verdict: BOTH altitudes are live. For v22 the *system* altitude dominates, with one agent-altitude concern that must not be dropped.**

From `tech_stack` + REQ-096..100:

- v22's five requirements are, without exception, about **storage schema, identity-gated reads, and where a validation runs**: a catalog keyed by `(name, version)` instead of `name`, two channel pointers, a removed tool parameter, a moved validator, a masked response. That is conventional-system architecture — SQLite (`better-sqlite3`), a hand-rolled JSON-RPC-over-HTTP surface (`src/server.ts`), an idempotent boot migration. **No model, prompt, tool surface, or dispatch behaviour changes.** So the *system* readings of the four quality dimensions apply and dominate.
- The **agent altitude still binds in one place, and it is the place most likely to be forgotten**: the artifact being versioned, channelled and masked is *a script that configures agents* — its `meta.params` contract, its `defaults.appendPrompt` (prompt text), its `model` aliases, its `mcp` names. Two consequences I carry through §2/§3:
  - *Consumability (agent)*: the primary consumer of `workflow_get` is **an MCP client agent** choosing whether/how to run a workflow. Masking the script must not leave that agent unable to decide — REQ-100 exists precisely because "purpose + declared parameter contract" must be enough for a non-human reader. A mask that returns a hole is a consumability regression at the agent altitude even when it is correct at the security altitude.
  - *Replaceability (agent)*: REQ-099 moves **model-alias** and **MCP-provisioned** checks from run-time to registration-time. Those are checks against a *mutable environment* (aliases come from config, MCP servers from the registry). Freezing an environment check at registration is safe for parse errors and unsafe for environment-coupled ones — §3.4 argues this and takes a position.

**What this altitude call rules OUT (honesty, not evasion).** My lens template names brute force, JWT forgery, timing attacks, and concurrency of failure counting. **v22 introduces no credential comparison, no token issuance, no failure counter, and no new authenticated endpoint.** That surface is REQ-012/086/089 (v15–v20, shipped and reviewed); the OAuth/token machinery in `src/auth/*` is untouched by REQ-096..100. Manufacturing threats there would be speculative and I decline it. v22's real security surface is **authorization on a read** (REQ-100) and **removal of an execution primitive** (REQ-098), and that is what §2 attacks.

---

## 1. Summary

v22 is one structural idea plus one deletion:

**Structural idea** — the catalog stops being a mutable key–value map and becomes an **append-only version table with two movable pointers**. Registration writes an immutable row; publication moves a pointer; a run resolves *pointer → version* once, at admission, and pins it.

**Deletion** — `script` leaves the wire surface of `workflow_run`/`workflow_resume`, which means the engine's *only* remaining ingress for executable text is `workflow_register`. That is what makes REQ-099 (moving the static checks) not optional bookkeeping but a **correctness precondition**: today every static check sits behind `if (spec.script)` (`src/submission-validator.ts:92`), so the moment inline script is closed, **100% of runs skip 100% of submission validation.**

```
   REGISTER (the only ingress for script text)        PUBLISH (pointer move)          RUN (resolve once, pin)
   ─────────────────────────────────────────         ──────────────────────          ───────────────────────
   ownership gate (name-level, existing)              ownership gate (same)           channel|version → version
        │                                                   │                                  │
   SubmissionValidator.validateScript(script) ◄── MOVED     │                          catalog.getVersion(name, v)
        │  PARSE_ERROR / UNKNOWN_ALIAS / MCP_NOT_PROVISIONED│                                  │
   contract + defaults + ceiling checks (existing)          │                          run record pins (name, version)
        │                                                   ▼                                  │
        ▼                                    workflows.release_version / .beta_version         ▼
   INSERT workflow_versions(name, version, …)  ← immutable                             every later read of this run,
   (NOT published to any channel — REQ-097)                                            and RESUME, uses the PIN
```

**Cost of my proposal: one new table, two new columns on the existing table, one new MCP tool (`workflow_publish`, required by REQ-097) plus three new parameters (`channel`/`version` on `workflow_run`, `version` on `workflow_get`), one moved function call, one masking projection at one choke point, one `db.transaction()` wrapper. Zero new HTTP endpoints, zero new services, zero new background jobs, zero caches.**

### The load-bearing decision — **D-P22-1: a run pins `(name, version)` at admission, and every later read of that run — status, resume, DAG — resolves through the pin, never through a channel or a name**

This is not a nicety. It fixes a **live consistency defect that exists today**:

> `src/run-manager.ts:632-636` — on `rehydrate`/`resume`, a run whose `spec.script` is empty (which is *every* run started by name; the resolved script is deliberately never written back into the spec) re-reads `await this._catalog.get(spec.name)` and gets **whatever is registered now**. Register a new version while a run is suspended, resume it, and the run continues executing **a different script than it started**. Today that is a narrow window because registration overwrites in place and nobody notices; under v22, with version history and a `beta` channel that authors are *encouraged* to churn, it becomes the normal case.

So: version history is not only REQ-096's feature request, it is the **only available fix** for resume determinism. I want this framed that way in the architecture doc, because it changes the priority of the pin from "nice observability" to "correctness invariant", and it gives the pin a test with real failure semantics (§4).

---

## 1b. Key points

1. **D-P22-1 — a run pins `(name, version)` at admission; status, resume and DAG all resolve through the pin, never through a name or a channel.** Not a feature: it is the only available fix for a *live* defect where resume re-resolves the catalog and can continue a different script than the run started (`run-manager.ts:632-636`). §1, §3.6, §4.4, R6.
2. **D-P22-4 — the boot migration must publish each migrated workflow's current version to `release`.** REQ-096's migration says nothing about channels; REQ-097 refuses an unpublished channel rather than falling back. Composed, they silently break every existing `workflow_run({name})`, schedule, chain and webhook at next fire. One line in the migration; highest-value point in this proposal. §3.2, R1.
3. **D-P22-2 — the masking principal is a *required* parameter (`ReadContext`), not an optional one defaulting to `null`.** `server.ts:823`/`:808` thread no principal today; an optional parameter reproduces this project's `composeConfig` wiring bug class (correct implementation, unwired call site, all unit tests green, zero protection). Required parameter ⇒ an unwired call site is a compile error. §2.1, R2.
4. **D-P22-3 — the mask keys off `authEnabled`, not off `principal == null`.** `null` principal has two causes: auth genuinely off (REQ-100's intended case) and the D-BIND loopback-peer exemption on an auth-*enabled*, publicly-bound server. Fail closed on the second. This deviates from REQ-100's parenthetical to honour its intent and must be escalated as a decision. §2.3, §5(e), R9.
5. **One choke point, allowlist projection.** `projectWorkflowForRead(full, viewerIsOwner)` *constructs* every script-derived response — `workflow_get`, `workflow_list`, `/api/workflows*`, the skeleton route, the dashboard. Script appears twice today (top level + `result.script`), and `skeleton`/`phases` are script-derived and absent from REQ-100's allowlist. Enforcement by construction, not by five remembered deletions. Identity for the decision comes from the auth layer only — `args.principal` (`server.ts:815`) is barred from this path. §2.2, §2.4, R4, R10.
6. **REQ-099 is a correctness precondition, not bookkeeping**, and it needs a *structural* guard: after the move, `SubmissionValidator` contains **zero** `if (spec.script)` branches. Today every static check sits behind that condition (`submission-validator.ts:92`), so closing inline script without the move deletes 100% of submission validation. §4.5, R3.
7. **Schema: append-only `workflow_versions(name, version, …)` + two nullable pointer columns on `workflows`** — not a channels table (REQ-097 closes the enum and bars per-user channel state). Register/publish wrapped in one `db.transaction()`, because the new `(name, version)` PK turns today's silent cross-process lost update into a raw `SQLITE_CONSTRAINT`. §3.1, §3.3, §5(d), R7.
8. **Take two debts while this file is open, as the requirements invite:** S-1 (per-name version ceiling — v22 turns catalog growth from O(names) into O(registrations), unbounded) and P6-2's registration half (reuse the *dispatch* predicate; do not write a second checker — the F-2 lesson). §3.4, §4.6, R8.
9. **Explicitly rejected alternatives**, recorded so they are not re-invented at Gate 5: persisting the resolved script into `RunSpec` to fix the DAG (a new unmasked sink that defeats REQ-100 from another endpoint, §3.6); GC/pruning of old versions (dangling pins behind an auditable record, §5(c)); any lock table or version-allocation service (§3.3); deleting the `_adhoc` defaults rather than leaving them inert (§2.6).

---

## 2. Security lens

### 2.1 The masking wiring seam is the highest-probability defect in v22 (this project's known bug class)

`src/server.ts:823` today:

```
case 'workflow_get': return facade.workflow_get(args as { name: string });
```

**No principal is threaded.** Same for `workflow_list` (`server.ts:808`). Compare `workflow_register`/`workflow_deregister` (`server.ts:813-822`), which *do* thread it. REQ-100 is therefore not "add a mask to the facade" — it is "**add an authorization input to two read paths that currently have none**", and this project has a named, twice-realised bug class for exactly this shape (`composeConfig` wiring: a new config block implemented correctly and never forwarded, silently inert; v11 `updateFlagPath`, v15 auth). A masking implementation that is perfect inside `McpFacade` and unwired at `server.ts:823` **passes every facade unit test and protects nothing.**

**Architectural requirement (D-P22-2): the mask is applied at the facade, and the principal reaching it is a *required* parameter, not an optional one with a `null` default.** `workflow_get(a, principal)` with `principal: string | null = null` reproduces the failure — an unwired call site compiles and defaults to "no principal". Make the signature `workflow_get(a: {name: string}, ctx: ReadContext)` where `ReadContext` is a required argument. Then the unwired call site is a **compile error**, not a silent hole. This is the cheapest possible structural fix and it costs one type.

### 2.2 The `args.principal` fallback must be barred from the masking path

`src/server.ts:814-815` (register/deregister):

```
const { principal: argPrincipal, ...regArgs } = args as { …; principal?: string | null };
const effectivePrincipal = principal ?? (typeof argPrincipal === 'string' ? argPrincipal : null);
```

A caller-supplied `principal` in the tool arguments is honoured whenever the auth-resolved principal is null. The comment names it as an "IT-080 pattern for catalog-layer integration tests" — i.e. **a test convenience on a production code path**. For *ownership attribution* it is defensible (the auth-disabled deployment is single-operator). For a **confidentiality decision** it is not: it is a self-asserted identity, and REQ-100's whole content is "non-owner does not see the script".

**Requirement: the identity used for masking comes from the auth layer only (`resolvePrincipal`), never from `args`.** If integration tests need an owner identity, they get it by minting a real token through `TokenStore` (the injectable seam already exists) — that is the correct test-double boundary and it costs one helper.

Note the sharper form of this: if masking reused `effectivePrincipal`, then in an auth-disabled deployment a non-owner could pass `{name, principal: "<owner-email>"}`. Owner emails are **not secret** — `workflow_get` returns `owner` to everyone by REQ-100's own text. The mask would be bypassable by reading its own response.

### 2.3 "No principal" is overloaded — and the D-BIND exemption makes it dangerous

REQ-100: *"Given auth is disabled (no principal) Then behaviour matches the pre-v22 surface."* But `null` principal arises from **two distinct causes**:

1. Auth genuinely disabled in config (the intended case — a local single-operator deployment).
2. **Auth enabled, but this request took the D-BIND loopback-peer exemption** (`src/server.ts:~1418`, `dbindExempt`): when the server is bound non-loopback *and auth is enabled*, loopback socket peers skip the auth gate. That exists to preserve the local-admin/self-update rescue path.

Under a naive `principal === null → full script` rule, **any process on the host (or anything that can present as a loopback peer) reads every workflow's script on an authenticated, publicly-bound server.** That is precisely the deployment REQ-100 is written for.

**Requirement (D-P22-3, fail-closed): the mask keys off `authEnabled`, not off `principal == null`.**

| authEnabled | principal | script |
|---|---|---|
| false | null | returned (pre-v22 surface, REQ-100 clause 3) |
| true | null (D-BIND exempt) | **masked** |
| true | owner | returned |
| true | non-owner | masked |

The rescue path is unharmed: self-update and local admin need `workflow_run`/status/`/api/status`, not script text. I want this recorded as a **named decision**, because it is the one place where a literal reading of the requirement's parenthetical ("no principal") and its intent diverge.

### 2.4 Masking must be an allowlist *projection at one choke point*, not field deletion

Three concrete traps, all visible in today's code:

1. **`script` is returned twice.** `src/mcp-facade.ts:208+` puts it at the top level *and* inside `result`. A `delete resp.script` fix leaves `result.script`. This is v21's rule-1 failure mode verbatim ("`not.toContain(whole)` passes when a fragment leaks").
2. **`skeleton` and `phases` are script-derived.** `parseWorkflowSkeleton(full.script)` is a static scan of every `phase`/`agent`/`parallel`/`workflow` call — effectively a decompiled outline, including the shape of the agent graph. REQ-100's non-owner allowlist is *name, version, channel, purpose, params contract, owner, how-to-report* — **`skeleton` and `phases` are not on it.** Someone will add them back "for usability". See §5(a): this is a real conflict, and my position is that they stay out by default.
3. **`/api/workflows/:name/skeleton`** (`src/server.ts:~1003`) serves the same derived structure over a route with **no identity plumbing at all** — `handleDashboardRequest(req, res, store, runManager, issueReporter, facade, systemInfoSampler, buildModelCatalog)` has no principal parameter in its signature.

**Requirement: one function, `projectWorkflowForRead(full, viewerIsOwner): WorkflowView`, that *constructs* the response from an explicit field list.** On the non-owner branch it must emit a **positive withheld marker** — REQ-100's final clause: *"a masked response says the script is withheld rather than pretending the workflow has none."* Concretely, `scriptWithheld: true` (a distinct key, so the response never carries a `script` field of a second shape that a client's type-narrowing would misread as content). Note the interaction with §4.2's allowlist oracle: the marker key **must be in `EXPECTED_NON_OWNER_KEYS`**, or the golden-allowlist test would enforce exactly the silent-hole behaviour the requirement forbids. Every surface — `workflow_get`, `workflow_list`, `/api/workflows`, `/api/workflows/:name/skeleton`, the dashboard page — returns a value produced by that function. Then "the mask cannot be side-stepped by asking a different endpoint" (REQ-100's own clause) is enforced by **construction**, not by five remembered deletions, and adding a field to the catalog cannot silently widen disclosure.

### 2.5 Simplicity call on the HTTP/dashboard surface

The dashboard has **no identity plumbing whatsoever** and adding it is a real project (session identity for a browser, not a bearer). The minimum architecture that closes REQ-100 is: **`/api/workflows*` and the dashboard serve the masked (non-owner) projection unconditionally.** No new auth plumbing, one call to the same projection function, and the requirement's "masked consistently" clause is satisfied at the strongest setting. The cost is that an owner browsing the dashboard cannot read their own script there — they use `workflow_get`. I name that as a conflict in §5, I do not hide it.

### 2.6 REQ-098's ban must be **schema-level**, and rehydrate must not become a bypass

- REQ-098 requires `script` **removed from the input schema** (`src/server.ts:278` `workflow_run`, `:354` `workflow_resume`), not merely rejected — a schema-reading client must never learn it exists. But schema removal alone is not enforcement: `/mcp` accepts arbitrary JSON bodies, so a hand-rolled request can still carry `script`. **Both are needed**: removed from the advertised schema *and* a typed refusal in the facade if present. Assert both, separately.
- `src/run-manager.ts:562` (`entry.script = newScript`) is the resume replacement-script path. Removing the parameter closes it at the wire; the internal capability should go too, or it is a latent re-entry.
- **Do not close rehydrate.** A run suspended *before* the upgrade has a persisted `spec.script`. Refusing it at resume would strand it. Rule: **the ban is on ingress (the wire), never on rehydration of already-persisted state.** That distinction should be explicit in the architecture text, because "remove `spec.script` support" is the obvious over-correction.
- `_adhoc` (`run-manager.ts:268`, `:450`, `:654` — three `spec.name ?? '_adhoc'` sites): once no new run can be nameless, these become dead defaults. REQ-098 permits "retired or left inert". **Simplicity pick: leave them inert.** Deleting them means touching three workspace-rooting call sites and re-proving `path-containment`/`workroot-guard` behaviour for zero user-visible gain.

---

## 3. Scalability / performance / consistency lens

### 3.1 Schema (concrete, so it can be argued with)

```sql
-- existing table, repurposed as the per-NAME record: identity + pointers
workflows(
  name TEXT PRIMARY KEY,
  owner TEXT,
  createdAt TEXT NOT NULL,
  release_version TEXT,      -- NULL = never published
  beta_version TEXT          -- NULL = never published
)

-- new: immutable per-registration rows
workflow_versions(
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  script TEXT NOT NULL,
  defaults TEXT,             -- JSON, as today
  params TEXT,               -- JSON, as today
  createdAt TEXT NOT NULL,
  PRIMARY KEY (name, version)
)
```

**Channels as two nullable columns, not a `channels` table.** REQ-097 closes the enum to exactly `beta|release`, and states outright that "no per-user channel assignment or opt-in state exists". A channels table is speculative generality for a two-valued closed enum; two columns make "a channel that has never been published" a `NULL` check rather than a missing-row join, and make the pointer move a single-row `UPDATE` inside the same transaction as everything else. If a third channel ever lands, `ALTER TABLE ADD COLUMN` is the same migration this codebase already performs idempotently four times over (`workflow-catalog.ts:86-98`).

**Owner lives on `workflows`, not on `workflow_versions`.** Ownership is per *name* (that is what `NOT_WORKFLOW_OWNER` already means at `workflow-catalog.ts:201`), and duplicating it per version invents a "who owns v3 vs v4" question nothing asks.

### 3.2 The migration is where v22 breaks production, and REQ-096 does not cover it

REQ-096's migration clause preserves "every existing registration as its current version with its existing owner". REQ-097 says **a run with no channel resolves `release`, and a never-published channel is a typed refusal, not a fallback to newest**. Those two clauses, composed, are a **fleet-wide outage**:

> Every pre-v22 workflow migrates with `release_version = NULL`. Every existing `workflow_run({name})` then fails with the typed channel error. And it is not only interactive calls — `schedule_create`, `chain_create`, and `webhook_create` all bind a registered **name** and fire through the same run path (`server.ts:~1291`, "same run path" invariant). **Every scheduled job, every chained run, and every inbound webhook silently starts erroring at its next fire, with no user action having occurred.**

**Requirement (D-P22-4): the boot migration publishes each migrated workflow's current version to `release` (and only to `release`).** Post-migration registrations follow REQ-097 unchanged — registered ≠ published. This is one line in the migration and it is, in my judgment, **the single highest-value point in this proposal**: it costs nothing, and without it v22 is a breaking upgrade for every deployment that has ever registered a workflow.

Restart-safety follows the existing pattern: idempotent, guarded, self-limiting — exactly the shape of the `backfillOwner` boot pass at `workflow-catalog.ts:100-107`.

### 3.3 Concurrency: the version-number race becomes a *crash* under the new PK — state it precisely

Today, `register` does a read-then-write:

```
const existing = db.prepare('SELECT version, owner FROM workflows WHERE name = ?').get(name)   // :195
const nextNum  = (existing ? Number(existing.version.replace(/^v/,'')) || 0 : 0) + 1            // :205
… INSERT … ON CONFLICT(name) DO UPDATE …                                                       // :211
```

Being precise so this is not rebutted: **`better-sqlite3` is synchronous and there is no `await` between the SELECT and the INSERT**, so within a single Node process this sequence is not interleaved — the in-process exposure is nil. The real exposure is **cross-process on one `workRoot`**: a self-update window with old and new engines briefly overlapping, or an operator running a second instance. Today that race is a silent lost update (`ON CONFLICT DO UPDATE` absorbs it). **Under `PRIMARY KEY (name, version)` the same race becomes a raw `SQLITE_CONSTRAINT` surfacing as an untyped 500.**

**Fix, and it is small: wrap SELECT-max-version + INSERT (+ any pointer move) in one `db.transaction()`.** `better-sqlite3` gives this synchronously with no new dependency. Retention of `IMMEDIATE` semantics matters only if a second writer exists; the transaction is correct either way. **I explicitly reject** any proposal for a lock table, an advisory lock, or a version-allocation service: WAL + one transaction is the whole answer at this system's scale (single-node, one process, human-rate registrations).

### 3.4 Storage growth: REQ-096 makes S-1 (the missing registration ceiling) materially worse

Today, N registrations of one name = **one row**. After v22, N registrations = **N rows, each holding a full script**. The catalog goes from O(names) to O(registrations), unbounded, with no pruning and no ceiling — and the v21 review already carries **S-1** ("a ceilings-less `WorkflowCatalog` enforces no registration ceiling") as open debt, with the "would need a third copy" rationale already dead per P6-5's shared export. The requirements text itself flags S-1 as cheap to take while this code is open. **Take it now, in this iteration**: a per-name version-count ceiling with a typed refusal, sourced from the same `Ceilings` object already threaded into the catalog (`WorkflowCatalogOpts.ceilings`, `workflow-catalog.ts:57`). No new config plumbing, no new object.

On **pruning**: I want a ceiling, not a garbage collector. Automatic deletion of old versions collides head-on with REQ-096's "both versions remain retrievable" and with D-P22-1's pinned-run auditability — a pruned version makes a completed run's pin dangling and its DAG unreconstructible. A ceiling refuses *at the front door*, where the author can see and react; a GC deletes silently *behind* an auditable pin. See §5(c).

Also note the ceiling must count **versions**, not bytes, or it becomes a second byte-cap semantics next to `maxAppendPromptBytes` for no reason.

### 3.5 Read-path cost is not a concern, and I will say so rather than invent one

`workflow_list` currently does `SELECT … FROM workflows` (all rows) and `catalog.list()` per `/api/home` poll. With version history, list must return "available versions and which version each channel points at" (REQ-096). The naive implementation is a second `SELECT name, version FROM workflow_versions` and a group-by in JS — two queries, indexed by the PK, at human-rate row counts on a local SQLite file. **That is fine. No cache, no materialized column, no denormalized `versions` JSON blob.** Adding one would be exactly the speculative complexity the tie-breaker forbids, and a denormalized copy is a second source of truth that will drift.

### 3.6 The DAG route is already broken and v22 makes it universal — with a tempting wrong fix

`src/server.ts:1044-1046`:

```
const spec = await store.getSpec(runId);
const skeletonNodes = parseWorkflowSkeleton(spec?.script ?? '');
```

`spec.script` is empty for **every run started by name** (the resolved script is never written back — `run-manager.ts:385-392`). So `/api/runs/:id/dag` already renders an empty graph for named runs; after REQ-098, that is **100% of runs**, i.e. the DAG panel of the dashboard goes permanently blank.

- **Correct fix**: derive the skeleton from the run's **pinned `(name, version)`** via the catalog, subject to the same masking policy as every other script-derived surface (§2.4). The pin from D-P22-1 makes this exact and stable even after re-registration.
- **The fix to explicitly bar**: persisting the resolved script into the stored `RunSpec`. It is the one-line fix, and it creates a **new unmasked script sink** in the run store — read back wholesale by `getSpec()` — immediately defeating REQ-100 through a different endpoint, and duplicating script bytes per run (storage growth ×runs, not ×versions). I want this recorded as a rejected alternative so it does not get re-invented at Gate 5.

### 3.7 Horizontal scaling: out of scope, and honestly so

The engine is single-node by construction (local SQLite at `workRoot`, in-process semaphore, child-process sandbox, filesystem workspaces). v22 adds no shared state that changes this. The only multi-process reality is the **self-update overlap window**, which §3.3's transaction covers. I decline to design for a multi-instance deployment that does not exist.

---

## 4. Testability lens

### 4.1 Module boundaries I am asking for

| Unit | Purity | Why it earns its boundary |
|---|---|---|
| `resolveChannel(row, {channel?, version?}) → {version} \| TypedError` | pure | REQ-097's full truth table (explicit version wins > channel > release default > NULL ⇒ typed error, never fallback-to-newest) as a table-driven test with zero I/O |
| `projectWorkflowForRead(full, viewerIsOwner) → WorkflowView` | pure | REQ-100's masked shape asserted as a **literal golden object**, both branches |
| `SubmissionValidator.validateScript(script)` | already pure-ish, injectable deps | REQ-099: the moved checks are tested once, at their new home, and the old `if (spec.script)` block is *deleted*, not left dormant |
| `catalog.register` / `.publish` | I/O, one transaction | the ownership gate + the ceiling + the atomicity test |
| boot migration | I/O, idempotent | run twice, assert identical state; assert `release_version` populated (§3.2) |

`ReadContext` (§2.1) is the injectable identity seam; `Clock` and `Ceilings` are already injected (`WorkflowCatalogOpts`).

### 4.2 v22's two external contracts, and how each fails v21's rule 1

The requirements name the rule: *"a test whose oracle is the code under test cannot fail when the code is wrong."* v22 has exactly two external contracts, and both have an obvious self-referential test that must be refused:

- **Channel resolution.** Bad oracle: "`workflow_run({name})` and `workflow_run({name, channel:'release'})` produce the *same* version" — passes when both resolve wrongly. Good oracle: register v1, publish v1→release, register v2 (unpublished), then assert `workflow_run({name})` **executes v1** and its run record pins `v1` — the literal expected value, not a comparison between two code paths.
- **Masked `workflow_get`.** Bad oracle: `expect(resp).not.toContain(scriptText)` — passes while `result.script`, `skeleton`, or `phases` leak (v21's exact fragment-leak defect). Good oracle: **`expect(Object.keys(deepFlatten(resp)).sort()).toEqual(EXPECTED_NON_OWNER_KEYS)`** — a literal allowlist over the whole response tree, so any *new* field is a test failure until someone consciously classifies it. `EXPECTED_NON_OWNER_KEYS` **includes `scriptWithheld`** (§2.4) — the allowlist is two-sided: it fails on a leaked field *and* on a missing withheld marker, so REQ-100's "says it is withheld" clause is pinned by the same assertion rather than by a comment.

### 4.3 The masking test must run over the real transport

A facade-level unit test with an injected principal **cannot detect** the `server.ts:823` unwired-dispatch hole (§2.1) — that is the entire lesson of the `composeConfig` bug class, where the guard that finally caught it was `compose-config-v2-wiring.test.ts`. **Requirement: at least one integration test drives an authenticated non-owner through `/mcp` (real HTTP, real bearer, real `resolvePrincipal`) and asserts the masked shape.** Anything cheaper re-runs a defect this project has already paid for twice.

Corollary tests, each cheap: (i) `principal` supplied in `args` does **not** unmask (§2.2); (ii) auth-enabled + D-BIND loopback peer gets the **masked** view (§2.3); (iii) `/api/workflows/:name/skeleton` is masked (§2.5).

### 4.4 Resume determinism gets a test with real failure semantics

Start a run from `foo@v1`, suspend it, register `foo@v2`, resume, assert the run continued **v1**. Today (`run-manager.ts:634-636`) that test **fails** — which is the point: it converts §1's argument into a red test before any code moves.

### 4.5 REQ-099's negative assertion needs a structural, not a behavioural, guard

REQ-099 demands "no code path performs these checks only for inline scripts". A behavioural test ("a run by name is covered") is necessary but weak against re-introduction. Add the structural guard the requirement's shape invites: after the move, **`SubmissionValidator` has no `if (spec.script)` branch at all** — grep-able, and cheap to assert in a lint-style test. Same discipline as v21's F-2 single-implementation lesson.

### 4.6 Take P6-2's registration half while this file is open

`defaults.appendPrompt` carrying a forged frame delimiter is refused at dispatch but not at registration. v22 rewrites `register`'s validation block anyway. **Reuse the dispatch-time predicate** — do not write a second checker. That is the F-2 lesson (`workflow-catalog.ts:36-46` already delegates `violatesOwnSpec` to the shared `checkValueAgainstSpec` for exactly this reason), and a second copy is the drift class that has bitten this iteration twice.

---

## 5. Named internal conflicts between my three lenses

These are the tensions I am *not* resolving silently. Each has my ruling and its cost.

**(a) `skeleton`/`phases` for non-owners — security vs. agent-altitude consumability.**
Security: the skeleton is a decompiled outline of the agent graph and is absent from REQ-100's allowlist ⇒ mask it. Consumability (agent altitude, §0): an MCP client agent uses `phases`/`skeleton` to decide whether a workflow fits and to render progress; a hole degrades the very consumer REQ-100 was written to serve.
**My ruling: masked by default; `description` + `params` + `version`/`channel` are the non-owner contract.** REQ-090's whole premise is that the declared parameter contract is sufficient for a user. If the panel disagrees, the disagreement should be resolved by *adding a declared field to `meta`* (author-controlled, author-consented disclosure) rather than by leaking a derived one. **Cost: dashboard DAG for a non-owner's workflow is empty.** I accept it; I do not pretend it away.

**(b) Where REQ-099's environment checks run — security re-check vs. one-site simplicity.**
`PARSE_ERROR` is a property of the text and is correctly frozen at registration. `UNKNOWN_ALIAS` and `MCP_NOT_PROVISIONED` are properties of a **mutable environment**: an MCP server can be deprovisioned, an alias removed from config, *after* a workflow validates cleanly. Security/robustness says re-check at admission; simplicity (and REQ-099's own last clause — "does not retroactively refuse… but the condition is surfaced") says check once, surface drift.
**My ruling: registration-only enforcement, plus drift *surfaced* at run start (typed observable, not a refusal).** One enforcement site, honest observability, no second gate to drift. **Cost: a run can still fail mid-flight on a deprovisioned MCP server** — but it fails at the `agent()` call with a real error, which is the pre-existing behaviour and not a regression. I expect the quality-dimensions lens to push for a hard admission re-check; I think that re-creates the two-sites-that-disagree problem REQ-099 exists to delete.

**(c) Version retention — scalability vs. auditability/retrievability.**
Scalability wants pruning of old versions (unbounded script rows, §3.4). REQ-096 requires old versions stay retrievable, and D-P22-1's pins make a pruned version a dangling reference on a completed run.
**My ruling: bound the front door (per-name version ceiling, S-1), never GC behind an auditable pin.** **Cost: a prolific author eventually hits a refusal** — which is visible, actionable, and vastly preferable to a silently unreconstructible run history.

**(d) Channel storage — two columns vs. a channels table.**
Scalability/extensibility instinct says a table. Simplicity says REQ-097 closed the enum to two values *and explicitly barred per-user channel state*.
**My ruling: two nullable columns.** `ALTER TABLE ADD COLUMN` is this codebase's proven, idempotent migration idiom (four precedents in `workflow-catalog.ts`). **Cost: a hypothetical third channel needs a migration** — which it would need anyway.

**(e) The D-BIND fail-closed call (§2.3) — security vs. a literal reading of REQ-100.**
The requirement says "auth disabled (no principal) ⇒ pre-v22 surface". Read literally against the code, `null` principal also covers the loopback-exempt path on an auth-*enabled*, publicly-bound server. **My ruling: key the mask on `authEnabled`, not on `principal == null`.** This deviates from the requirement's parenthetical to honour its intent and **must be escalated as a decision, not absorbed as an implementation detail.**

---

## 6. Risks

| # | Risk | Lens | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R1 | **Migration leaves `release_version` NULL** ⇒ every existing named run, schedule, chain and webhook starts failing at next fire (§3.2) | Scalability/ops | **High** if unspecified | **Fleet-wide silent outage** | D-P22-4: migration publishes current version → `release`; explicit test asserts a pre-v22 row runs after upgrade with no user action |
| R2 | **Masking implemented but unwired** at `server.ts:823` / `:808` — the project's known `composeConfig` bug class; passes all facade unit tests | Security/testability | **High** | REQ-100 delivers zero protection while reported green | Required `ReadContext` parameter (compile error, not silent null) + a real-transport authenticated non-owner integration test (§4.3) |
| R3 | **REQ-099 move incomplete** ⇒ closing inline script deletes all submission validation; a broken script registers fine and fails deep in a run | Security/correctness | Medium | Loss of fail-fast; bad scripts reach the sandbox | Structural guard: zero `if (spec.script)` branches remain in `SubmissionValidator` (§4.5); registration-time tests for all three codes |
| R4 | **Script leaks through a non-`workflow_get` surface** — `result.script`, `skeleton`, `/api/workflows/:name/skeleton`, dashboard, or a newly added field | Security | Medium-High | REQ-100 bypassed by asking a different endpoint (a case the requirement names) | Single `projectWorkflowForRead` choke point; literal-allowlist key assertion so new fields fail closed (§2.4, §4.2) |
| R5 | **DAG panel goes permanently blank** post-REQ-098; the obvious fix (persist resolved script into `RunSpec`) creates a new unmasked sink | Security ∩ observability | Medium | Silent observability loss, or a self-inflicted REQ-100 bypass | Derive DAG from the pinned `(name, version)` via catalog + same mask; record "persist script into spec" as a **rejected** alternative (§3.6) |
| R6 | **Resume executes a different version than the run started** (`run-manager.ts:634-636`) — pre-existing, amplified by channel churn | Correctness/consistency | Medium (rises with `beta` usage) | A run's behaviour changes mid-flight; unreproducible outcomes | D-P22-1: resume resolves through the pin; RED test written first (§4.4) |
| R7 | **`(name, version)` PK turns a cross-process register race into a raw `SQLITE_CONSTRAINT`** untyped 500 (self-update overlap) | Scalability/robustness | Low | Untyped failure during upgrade | One `db.transaction()` around read-max-version + insert + pointer move (§3.3) |
| R8 | **Unbounded catalog growth** — O(registrations) scripts, S-1 still open | Scalability | Medium (slow) | Disk/backup growth; slow list | Per-name version ceiling from the existing `Ceilings` object; typed refusal (§3.4) |
| R9 | **Auth-disabled deployments get a mask they did not ask for**, or auth-enabled loopback callers silently lose access they relied on | Security ∩ operability | Low-Medium | Rescue/ops friction | §2.3's explicit table, documented in DEPLOY.md; owner reads via `workflow_get` with a bearer |
| R10 | **`args.principal` reused for the confidentiality decision** ⇒ mask trivially bypassed by self-asserting the (publicly readable) owner email | Security | Medium (it is the path of least resistance) | REQ-100 defeated by its own response | Bar `args.principal` from the read path; tests mint real tokens (§2.2) |
| R11 | **Pre-v22 suspended inline run stranded** by an over-broad ban | Correctness | Low-Medium | Un-resumable runs, data loss | Ban at ingress only; rehydrate keeps tolerating persisted `spec.script` (§2.6) |

---

## 7. Expected disagreements with the other lens (quality-dimensions)

1. **Skeleton/phases for non-owners.** I expect a strong consumability push to keep `skeleton` and `phases` unmasked ("a user must be able to see what it does"). I hold the mask, and offer the constructive alternative: author-declared `meta` fields, so disclosure is *consented*, not derived. This is the sharpest expected conflict.
2. **Masked-always dashboard (§2.5).** I expect resistance — "the owner should see their own script in the UI". My answer is that adding browser-session identity is a whole subsystem and REQ-100 does not ask for it; the masked-always dashboard is the honest minimum. I would accept "dashboard shows nothing script-derived at all" as a compromise; I would not accept "dashboard is exempt".
3. **Admission re-check of alias/MCP (§5b).** I expect them to want a run-time re-validation for robustness. I argue one enforcement site + surfaced drift, per REQ-099's own final clause.
4. **Observability surface breadth.** I expect them to want version/channel/pin/drift threaded into `workflow_status`, the run record, the journal, the dashboard, and `/api/home`. I agree on **the run's pinned `(name, version)`** (it is D-P22-1's own audit artifact and REQ-096 requires it) and will resist a per-surface expansion beyond that as scope creep — every additional field is another surface the §2.4 projection must classify.
5. **Migration UX.** They will likely propose richer migration reporting/backfill affordances; I want the migration to do exactly two things (preserve rows, publish `release`) and be idempotent. R1 is about *correctness*, not reporting.
6. **Channels table vs. columns.** Likely framed as replaceability/extensibility. I hold two columns on REQ-097's explicit closure of the enum and its explicit bar on per-user channel state.
7. **Where we will agree, and should say so early to save round 2:** the pin (D-P22-1), the migration publishing `release` (D-P22-4), the single projection choke point, and moving the static checks to registration. Round 2 should spend its time on (1), (2) and (3), not re-litigating these.
