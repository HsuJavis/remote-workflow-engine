# Design panel — Adversarial group (interface-contract / boundary-error / testability), round 1

**Feature:** 001-remote-workflow-engine · **Iteration:** v22 (REQ-096..100 → ARCH-071..076, ADR-009..014)
**Stage:** Gate 3+4 (Tasks + Detailed Design), debate round 1 — independent proposal
**Lenses carried:** (a) interface-contract, (b) boundary/error, (c) testability. Tie-breaker: Karpathy
simplicity-first (the minimum design that solves the problem; no flexibility the requirement did not buy).
**Inputs read:** `01-requirements.md` v22 slice (lines 903–977), `02-architecture.md` v22 slice (lines
986–1352), `state.yaml` `tech_stack` (lines 11–51). **A v22 `03-tasks.md` does not exist** (the file on
disk is v21, last id `TASK-104`; last design id `DES-108`) — §3 states where my lenses constrain the split.
**Primary source verified in this session** (every line number below was read, not recalled):
`src/workflow-catalog.ts`, `src/submission-validator.ts`, `src/mcp-facade.ts`, `src/run-manager.ts`,
`src/run-store.ts`, `src/store/sqlite-run-store.ts`, `src/server.ts`, `src/scheduler.ts`,
`src/webhook-registry.ts`, `src/params/contract.ts`, `tests/integration/scriptversion-fidelity.test.ts`.

---

## 0. Altitude determination (system vs agent) — done FIRST, per the panel brief

**This project is both, and v22 is system-dominant.** From `tech_stack`: Node 22.6+/TypeScript strict/ESM,
`better-sqlite3`, vitest, a hand-rolled JSON-RPC-over-HTTP server — and the *product* is an engine that
runs LLM agents. v22's substance (a table, two pointer columns, a migration, an authorization input on two
read paths, a validation that moves) is ordinary systems design and is judged at the **system altitude**.

The **agent altitude binds in exactly two places**, and I apply it only there:

1. **The tool schema and the error text ARE the documentation.** An MCP client agent learns the surface
   from `tools/list` and learns recovery from the error string. That is why REQ-098's schema-level removal
   is not cosmetic, why `INLINE_SCRIPT_CLOSED` must carry the two-call recipe, and why (§2A.6) an error
   *code* that still names a removed concept is a defect, not a naming preference.
2. **The masked view must still let a non-owner agent decide and act.** REQ-100's allowlist is a
   consumability contract for an agent that can no longer read the script: it must still be able to pick
   the workflow (`description`, `params`), call it (`params`, `channels`), and report a problem
   (`reportProblem`, REQ-095). Masking that leaves an agent unable to act would satisfy the letter and
   break the product.

Everything else in v22 — the pin, the migration, the transaction, the ceiling — I judge as a plain system.
I do not force the agent altitude onto the schema/migration work; the architecture made the same call and
I agree with it.

---

## 1. Summary

The v22 architecture is unusually complete: ADR-009..014 are decided, sourced, and I contest none of them.
Restating them at Gate 4 would add nothing. **My proposal is the layer underneath — exact TypeScript
signatures, a closed error table, and test oracles — plus seven boundary conditions the architecture did
not legislate.** Ranked by what they cost if discovered at Gate 6/7.5 instead of now:

1. **A pre-v22 suspended named run is stranded by the pin (HIGH, correctness regression).** The migration
   copies each name's **current** row only — and it can copy no other, because `ON CONFLICT DO UPDATE`
   (`workflow-catalog.ts:210-220`) already destroyed the older scripts. A run started at `v2`, suspended,
   whose workflow was then re-registered to `v3`, carries pin `scriptVersion='v2'` on its run row. After
   v22, `resume` resolves *through the pin* (ARCH-072) → `UNKNOWN_VERSION` → the run is unresumable, where
   today it resumes (on `v3`). ARCH-072 invariant 3 protects only the *inline* legacy cohort (a persisted
   `spec.script`); this cohort has an empty `spec.script` by construction (`run-manager.ts:385-392`).
   **Needs an explicit, narrow legacy fallback (§2B.1) — the one place I argue for a fallback the
   interface-contract lens hates (§5.ii).**
2. **`workflow_run`'s `scriptSha256` parameter becomes permanently unsatisfiable** and no ARCH mentions it:
   `run-manager.ts:292-294` throws `SCRIPT_SHA_WITHOUT_SCRIPT` whenever it is supplied without an inline
   script, which after REQ-098 is *always*. It must leave the schema with `script` (§2A.7).
3. **`getFull()` is the surviving-legacy-accessor hole.** ARCH-071 deletes `get(name)` and is silent on
   `getFull(name)` (`workflow-catalog.ts:267-276`), which today delegates to `get()` **and** issues its own
   `SELECT createdAt, owner FROM workflows`. Its SQL is a *string*: if the script/params columns move and
   `getFull` is left half-converted, `tsc` says nothing and the failure is a runtime read of a column that
   no longer exists — or worse, a legacy column left in place becomes the stale second source of truth the
   whole slice exists to delete. I pin the complete catalog API and a `PRAGMA table_info` assertion (§2A.1,
   §2B.2).
4. **`SubmissionValidator`'s dependencies must shrink, not just its body.** Once the `if (spec.script)`
   block moves out (`submission-validator.ts:92-124`), `aliases`, `mcpRegistry` and `openrouterPassthrough`
   have **no remaining reader** in that class. Deleting them from `SubmissionValidatorDeps` turns "still
   wired in `main.ts`" into a `tsc` error and makes re-adding a second alias checker there a visible act.
   Leaving them is how a second enforcement site grows back (§2A.4).
5. **The version ceiling can permanently wedge an author** with no escape short of destroying the workflow
   (ADR-014 gives `deregister` name-granularity only). One optional parameter on an existing tool fixes it
   (§2B.4).
6. **The nested-`workflow()` journal stamp will be conflated with the resume-generation counter.**
   `JournalEntry.scriptVersion` (`types.ts:203`) is written as `` `v${entry.scriptVersion}` ``
   (`run-manager.ts:883`) from the in-memory counter — which is itself *seeded from the catalog version*
   (`:394`) and incremented per resume (`:563`). ARCH-072 says nested `workflow()` "records the resolved
   version on the journal entry". If that lands in the same field, both meanings are destroyed. Pin a
   distinct field name and decouple the counter (§2A.5).
7. **`db.transaction()` alone does not serialize the cross-process case** ARCH-071 invariant 5 invokes it
   for. `better-sqlite3`'s default transaction is *deferred*: two processes can both run the
   `SELECT max(version)` before either writes. `.immediate()` plus a typed mapping for the residual
   `SQLITE_BUSY`/`SQLITE_CONSTRAINT` is the actual fix (§2B.3).

Two testability findings sit alongside these: **IT-011's oracle is relative** ("the second run's recorded
`scriptVersion` must differ from the first's", `tests/integration/scriptversion-fidelity.test.ts:40-49`) —
the precise anti-pattern v22 Rule 1 names, and it is the *existing* guard for the field v22 turns into the
pin; and **the migration fixture must be hand-written legacy SQL**, never a DB built by the new code.

---

## 2. Key points

### 2A. Interface-contract lens

#### 2A.1 — DES-109/110/111: the complete `WorkflowCatalog` surface, so no legacy accessor survives

The deletion of `get()` is only load-bearing if the *whole* read surface is restated. I propose exactly
these members and no others (Karpathy: `getVersion()` beside `resolve()` is refused; a separate resolver
module is refused — the truth table is an exported function in the file that owns it):

```ts
export type Channel = 'beta' | 'release';
export interface Channels { release: string | null; beta: string | null }
export interface VersionEntry {          // what execution needs
  script: string; version: string;
  defaults: HarnessDefaults | undefined; params: ParamContract | undefined;
}
export interface WorkflowDetail extends VersionEntry {   // what a read needs — REPLACES getFull()
  name: string; createdAt: string; owner: string | null;
  channels: Channels; versions: string[];                // ascending, engine-assigned v<n>
}
export interface VersionSelector { version?: string; channel?: Channel }

class WorkflowCatalog {
  register(name, script, defaults?, principal?): Promise<{ version: string }>;   // signature UNCHANGED
  publish(name: string, version: string, channel: Channel, principal: string | null):
      Promise<{ channel: Channel; version: string; from: string | null }>;
  resolve(name: string, sel: VersionSelector): Promise<VersionEntry>;            // the ONE exec read
  resolveDetail(name: string, sel: VersionSelector): Promise<WorkflowDetail>;    // the ONE read read
  exists(name: string): Promise<boolean>;                                        // never throws
  listVersions(name: string): Promise<string[]>;
  list(): Promise<Array<{ name; version; createdAt; description; params; versions: string[]; channels: Channels }>>;
  deregister(name: string, principal: string | null, version?: string): Promise<{ removed: boolean }>;  // §2B.4
}

// module-level, pure, no I/O, no `this` — deliberately NOT a class member and NOT a separate module:
export function resolveVersionRequest(
  sel: VersionSelector, ch: Channels, known: ReadonlySet<string>,
): { ok: true; version: string } | { ok: false; code: ResolveErrorCode; channel?: Channel; version?: string };
```

Four contract points that are not stylistic:

- **`getFull` is *renamed*, not kept.** `resolveDetail` takes a selector; `getFull(name)` did not, and a
  no-selector detail read is exactly the "newest row" semantics ARCH-071 deletes. Renaming makes every one
  of its call sites a compile error, which is the only mechanism this repo has that actually works (four
  documented recurrences of the unwired-module class).
- **`exists()` returns `boolean` and never throws.** Today four of the six call sites
  (`submission-validator.ts:83`, `scheduler.ts:147-149` and `:207-210`, `webhook-registry.ts:87-90`)
  implement existence as `try { await catalog.get(x) } catch {}`. Converting them to a throwing accessor
  reproduces the same pattern one layer down.
- **`resolve()` returns `VersionEntry` and *not* `owner`.** Owner is an authorization input; keeping it off
  the execution read means a future confidentiality decision cannot accidentally be made from the execution
  path's data.
- **`resolveVersionRequest` takes `known: ReadonlySet<string>`, not a DB handle.** That is what makes
  `UNKNOWN_VERSION` decidable inside the pure function instead of splitting the truth table across two
  layers (§2C.1). The catalog reads the version list once and hands it in.

#### 2A.2 — DES-110: the resolution truth table, stated as a total function with explicit precedence

The rows only form a *function* if the order in which they are tried is part of the contract. Stating that
order is a real sharpening, not bookkeeping: `{version:'v9' (unknown), channel:'nightly'}` matches both the
unknown-version row and the invalid-channel row, and REQ-097's clause "`channel` supplied as anything other
than `beta|release` ⇒ a typed validation error" carries **no** version-set exception. ARCH-071 inv-2 has the
same latent ambiguity. **Ruling: validate the channel token first** — an invalid channel is a malformed
*input*, and reporting a resolution outcome for a request that was never well-formed is how a caller learns
the wrong lesson.

Precedence: **(1)** channel token validity → **(2)** explicit `version` → **(3)** named channel pointer →
**(4)** `release` default. Evaluated in that order, the seven outcome rows are disjoint and total:

| # | guard (first match wins, in this order) | result |
|---|---|---|
| 1 | `sel.channel` present and not in `{beta, release}` | `INVALID_CHANNEL(channel)` |
| 2 | `sel.version` present and in `known` | `{version}` — explicit wins over any channel (REQ-097, "regardless of any channel") |
| 3 | `sel.version` present and not in `known` | `UNKNOWN_VERSION(version)` |
| 4 | `sel.channel` present, `ch[channel] === null` | `CHANNEL_UNPUBLISHED(channel)` — **never "newest"** |
| 5 | `sel.channel` present, pointer set but not in `known` | `DANGLING_CHANNEL(channel, version)` — see §2B.6 |
| 6 | no selector, `ch.release === null` | `CHANNEL_UNPUBLISHED('release')` |
| 7 | no selector, `ch.release` set | `{version: ch.release}` (row 5's dangling guard applies here too) |

Seven disjoint outcomes, one pure function, zero I/O. `version`+`channel` together is **not** an error
(REQ-097's own words), but silently discarding a supplied argument is a contract smell at the agent
altitude — mitigated, not by an error, but by echoing `requested` back (§2A.3) so the caller can *see*
which input won.

#### 2A.3 — DES-112: `createRun`'s growth, and returning the resolved version

`RunStore.createRun(spec, scriptVersion?, effectiveParams?)` (`run-store.ts:76-81`) gains `requested` and
`validation` (ARCH's ER model). Five positional parameters, three optional, is a signature a caller can
mis-order silently. The clean answer is an options object — and it is **33 call sites** across `src/` and
`tests/` (grepped this session). **Position (Karpathy tie-break): additive fourth parameter
`admission?: { requested: RequestShape; validation: ValidationObservation }`, and the options-object
refactor is explicitly NOT v22 work.** A v22 whose dominant risk is silent-failure should not spend its
review budget on 33 mechanical edits. Record the debt with the reason.

`RequestShape = {kind:'version', version} | {kind:'channel', channel} | {kind:'default-release'}` — a
discriminated union, not a free string, so `workflow_status` can render it without parsing.

Two riders:
- **`runs` needs the same idempotent `ALTER TABLE` idiom** the run store already uses
  (`sqlite-run-store.ts:65-71`, `try { ALTER TABLE runs ADD COLUMN … } catch {}`) for `requested` and
  `validation`. ARCH names the catalog's idiom; the run store's is a *different file* and is easy to miss.
- **`workflow_run` should return the resolved version** in its result envelope
  (`{runId, version, requested}` — `mcp-facade.ts:100-113` returns `{runId}` today). One field. It is the
  agent-altitude affordance that makes the pin usable without a second `workflow_status` call, and it is
  the only way a caller sees which of `version`/`channel` won.

#### 2A.4 — DES-115: `SubmissionValidator` survives, but its dependency object must shrink

After the move, `validate()` holds one check: name existence (`submission-validator.ts:74-90`). **Keep the
class** — it is still the fail-fast choke point and deleting it churns the facade and the composition root
for zero user-visible gain. But `SubmissionValidatorDeps` (`:18-27`) must lose `aliases`, `mcpRegistry` and
`openrouterPassthrough`, leaving `{ catalog }`. Those three fields are read *only* inside the block that
moves. Keeping them is not neutral: it leaves `main.ts` wiring a checker's inputs to a checker that no
longer checks, which is a standing invitation to "just re-add the alias check here too" — the second
enforcement site ADR-013 exists to prevent. Deleting them makes that a `tsc` error.

The `openrouterPassthrough` flag moves with the checks into `validateScriptEntry`'s injected ports.

#### 2A.5 — DES-113: two same-named `scriptVersion` fields are actually **three** meanings

ARCH-072 warns about two. Verified in primary source, there are three uses and they are already entangled:

| where | type | meaning |
|---|---|---|
| `runs.scriptVersion` (`run-store.ts:76-81`) | `string` | the durable catalog version — **the pin**, write-once |
| `RunEntry.scriptVersion` (`run-manager.ts:146`) | `number` | in-memory resume-generation counter, `+= 1` at `:563` — but **seeded from the catalog version** at `:394` and re-seeded from the pin at `:676` |
| `JournalEntry.scriptVersion` (`types.ts:203`) | `string` | `` `v${entry.scriptVersion}` `` stamped at `:883` — i.e. neither the catalog version nor a clean generation number after the first resume |

**Two design rulings:**
1. ARCH-072's "nested `workflow()` records the resolved version on the journal entry" must use a **new,
   distinctly named field** — `resolvedWorkflowVersion?: string` — never `JournalEntry.scriptVersion`.
2. **Decouple the counter**: seed `RunEntry.scriptVersion` from `1`, not from
   `Number(registered.version.replace(/^v/,''))` (`:394`/`:676`). The durable pin now carries the catalog
   version, so the counter's only remaining job is generation counting. `ResumeCache` does not read the
   field (grepped: no `scriptVersion` in `src/resume-cache.ts`), so this is observational-only and safe —
   and leaving it coupled means every `beta`-churn re-numbers a live run's journal stamps.

#### 2A.6 — the closed error table (every code an agent can see after v22)

| surface | codes |
|---|---|
| `workflow_register` | `PARSE_ERROR`, `UNKNOWN_ALIAS`, `MCP_NOT_PROVISIONED`, `PARAM_CONTRACT_INVALID` (incl. the frame-delimiter refusal), `HARNESS_DEFAULTS_INVALID`, `VERSION_CEILING_EXCEEDED`, `NOT_WORKFLOW_OWNER` — **nothing stored on any** |
| `workflow_publish` | `NOT_WORKFLOW_OWNER`, `WORKFLOW_NOT_FOUND`, `UNKNOWN_VERSION`, `INVALID_CHANNEL` |
| `workflow_run` | `INLINE_SCRIPT_CLOSED`, `MISSING_NAME` (**renamed**, see below), `UNKNOWN_WORKFLOW`, `CHANNEL_UNPUBLISHED`, `UNKNOWN_VERSION`, `INVALID_CHANNEL`, `DANGLING_CHANNEL` + all v21 admission codes unchanged |
| `workflow_resume` | `INLINE_SCRIPT_CLOSED`, `RESUME_OVERRIDES_NOT_ALLOWED` (`mcp-facade.ts:171-176`, unchanged), `PARAM_SECRET_UNAVAILABLE`, `LEGACY_PIN_UNRESOLVABLE` only if §2B.1 is decided the strict way |
| `workflow_get` | `WORKFLOW_NOT_FOUND`, `UNKNOWN_VERSION`, `CHANNEL_UNPUBLISHED` |
| `schedule_create` / `webhook_create` / `chain_create` | `WORKFLOW_NOT_FOUND`, `CHANNEL_UNPUBLISHED` |

Two dispositions the architecture left open:

- **`MISSING_SCRIPT` → `MISSING_NAME`.** Today it fires when neither `name` nor `script` is present, with
  the message "Submission requires either a registered workflow \"name\" or an inline \"script\""
  (`submission-validator.ts:74-77`). After REQ-098 both the code and the message name a parameter that no
  longer exists in the schema. At the agent altitude that is worse than cosmetic: an agent that reads
  `MISSING_SCRIPT` will hallucinate a `script` parameter and retry with it. Rename the code and the
  message; the ARCH-051 drift-lock test already pins the vocabulary, so this costs one line there.
- **`UNKNOWN_WORKFLOW` (validator) vs `WORKFLOW_NOT_FOUND` (facade) vs `CatalogNotFoundError` (catalog)** —
  three names for one condition, all pre-existing. **Do not unify in v22** (pure churn on a slice with a
  silent-failure risk profile), but pin the mapping in the design table so Gate 5/6 does not add a fourth.

#### 2A.7 — `scriptSha256` leaves the wire with `script`

`workflow_run` advertises `scriptSha256` (`server.ts:318`) and `run-manager.ts:292-294` refuses it whenever
there is no inline script (`SCRIPT_SHA_WITHOUT_SCRIPT`). After REQ-098 there is never an inline script, so
the parameter is **permanently unsatisfiable**: every use of an advertised parameter returns an error. It
must be removed from the `workflow_run` schema, from the facade signature (`mcp-facade.ts:100`), from
`RunSpec` (`types.ts:179`) and the `:292-294` branch deleted, in the *same* task as `script` — and the
absence joins the drift-lock. Re-offering it on `workflow_register` is a **new** surface no requirement
buys; refused.

---

### 2B. Boundary/error lens

#### 2B.1 — HIGH: the dangling pin on a pre-v22 suspended named run

**Mechanism (verified, not hypothesised).** `start()` writes the pin from the catalog version at launch
(`run-manager.ts:385-394` → `createRun(spec, resolvedVersion)`), and named runs store an *empty*
`spec.script` (`:385-392`). Registration overwrites in place today (`workflow-catalog.ts:210-220`), so the
script the run started from **no longer exists anywhere** once the author re-registers. The migration can
only copy the current row. Therefore: a run suspended at pin `v2` on a workflow now at `v3` has a pin with
no version row. ARCH-072 makes `resume` read *through* the pin. Result: `UNKNOWN_VERSION`, permanently
unresumable — a regression, since today `:632-636` re-resolves and the run continues (on `v3`).

Population is small, closed, and identifiable: runs in `suspended`/`queued`/`running` at upgrade time whose
pin is not in `workflow_versions`. It can never grow after the migration.

**Options.** (a) Strict — refuse with a typed `LEGACY_PIN_UNRESOLVABLE` naming the missing version.
(b) Narrow legacy fallback — pin miss ⇒ resolve `release`, **record the substitution** on the run's
`validation` observation and log it; applies only when the pin is absent from `workflow_versions`.
(c) Migration-time repair — stamp legacy runs' pins to the migrated version during the ADR-011 transaction.

**Position: (b), with (c) rejected for a specific reason** — (c) rewrites the pin, and the pin is the
field REQ-096 makes authoritative for "which version actually ran"; overwriting it would *manufacture* a
false answer, which is worse than an honest substitution recorded at resume. (a) is the interface-contract
lens's answer and I acknowledge the tension (§5.ii): it strands work an operator already paid for, in
exchange for purity about a cohort whose true version is unrecoverable either way. (b) preserves exactly
today's semantics for exactly today's runs, is unreachable for any post-v22 run (their pins always exist),
and is observable rather than silent.

**Test (RED, must exist):** a hand-built legacy `catalog.db` + `runs.db` with a suspended run pinned to a
version absent from the versions table; assert it resumes and that the run's `validation` records the
substitution.

#### 2B.2 — the legacy `workflows.script`/`version`/`defaults`/`params` columns

ARCH's data view says these columns "move". SQL is a string; `tsc` cannot enforce a move. Two failure
shapes: a half-converted read (`getFull`'s own `SELECT`, `workflow-catalog.ts:272-274`) that fails at
runtime, or — much worse — the columns left in place and still written by an overlooked path, becoming the
stale second source of truth the slice exists to delete.

`better-sqlite3` in this repo bundles **SQLite 3.53.2** (verified by executing
`select sqlite_version()` this session), so `ALTER TABLE … DROP COLUMN` (3.35+) is available. **Position:
drop `script`, `version`, `defaults`, `params` from `workflows` inside the ADR-011 migration transaction,
guarded by the same "column present?" `PRAGMA table_info` read the file already performs
(`workflow-catalog.ts:86-98`) so it stays idempotent.** Assert it: a migration test that reads
`PRAGMA table_info(workflows)` and requires the four names to be **absent**. That assertion, not a review,
is what makes "moved" true.

#### 2B.3 — `db.transaction()` is deferred; the cross-process case needs `immediate`

ARCH-071 invariant 5 is right that the cross-process window is the real one (self-update overlap, a second
operator instance) and right to reject a lock service. But `better-sqlite3`'s plain `db.transaction(fn)`
begins a **deferred** transaction: two processes can both execute `SELECT max(version)` before either
takes a write lock, and the loser gets a raw `SQLITE_BUSY` (or, once both try to insert the same
`(name, version)`, `SQLITE_CONSTRAINT`) surfaced as an untyped 500 — precisely the outcome ARCH says the
transaction prevents.

**Position:** use `.immediate()` for `register` and `publish`, and map the residual
`SQLITE_BUSY`/`SQLITE_CONSTRAINT_PRIMARYKEY` to a typed `REGISTRATION_CONFLICT` ("retry"). Two lines, no
new machinery, and it converts an untyped 500 into an actionable code. Also set a `busy_timeout` pragma if
one is not already configured. Testability caveat in §2C.5 — this is the one v22 behaviour I concede is
not unit-testable.

#### 2B.4 — the version ceiling can wedge an author permanently

ADR-014 refuses at the front door with `VERSION_CEILING_EXCEEDED` and adds no GC — correct. But
`deregister` is name-granular (`workflow-catalog.ts:227-238`) and ARCH-071 extends it to remove *all*
version rows. So an author who hits the ceiling has exactly one escape: destroy the workflow, its channel
pointers, and the resolvability of every completed run's pin. The sanctioned author loop
(register-draft → run) is the very thing that fills the ceiling, so this is a wedge reachable by using the
feature as designed.

**Position: one optional parameter on the existing tool** — `workflow_deregister({name, version?})`,
owner-gated, refusing to delete a **channel-pointed** version (`CHANNEL_POINTED_VERSION`) and refusing to
delete the **last remaining** version (use name-granular deregister for that). No new tool, no GC, no
tombstones, no sweep. The `VERSION_CEILING_EXCEEDED` message names this escape — at the agent altitude the
error text is the runbook. This is the smallest thing that keeps the ceiling from being a trap.

#### 2B.5 — a NULL-owner row is masked from everyone once auth is on

`viewerIsOwner = ctx.authEnabled ? (principal !== null && principal === row.owner) : true` (ARCH-076)
evaluates false when `row.owner` is `NULL` — a pre-v15 row on a deployment where the boot backfill is off
(`opts.backfillOwner`, `workflow-catalog.ts:100-107`). Consequence: *nobody*, including the human who
registered it, can read that script through any surface. That is the correct fail-closed direction, but it
is a boundary condition the architecture never names, and an operator will read it as a bug. **Pin it as
intended behaviour, test it explicitly, and have the masked response's `scriptWithheld` reason distinguish
"you are not the owner" from "this workflow has no recorded owner; run the boot backfill".** Same shape,
different remediation text — one extra string, and it is the difference between a bug report and a fix.

#### 2B.6 — three states the truth table must not conflate

- **`name` exists, zero version rows.** Unrepresentable if `deregister` is name-granular; §2B.4's
  per-version delete makes it representable, which is exactly why that delete must refuse the last version.
  Belt-and-braces: `resolve` maps it to `WORKFLOW_NOT_FOUND`, never `CHANNEL_UNPUBLISHED`.
- **A channel pointer set to a version that no longer exists.** Reachable only via §2B.4; the pointer must
  be cleared in the same transaction as any per-version delete, and `DANGLING_CHANNEL` exists as the
  never-should-happen code rather than a silent `undefined` script.
- **Migration ordering vs the owner backfill.** Verified non-issue: owner stays on `workflows` and is not
  copied into `workflow_versions`, so the two boot passes are order-independent. Stated so Gate 5 does not
  invent an ordering constraint — and so nobody "helpfully" copies `owner` per version (ARCH-071 rules
  ownership is per-name; a per-version owner column would invent a question nothing asks).

#### 2B.7 — validation vs ceiling ordering at registration

Both run before any write. **Order: `validateScriptEntry` first, ceiling second.** The script errors are
properties of the author's own text and are actionable offline; the ceiling is an environmental refusal
whose remedy is a different call. An author with a broken script *and* a full ceiling should be told about
the script first. `register` throws the **first** error (matching the existing `codedError` convention at
`workflow-catalog.ts:121/129/143`) and carries the remaining codes in the error `detail` so a caller fixing
three things does not need three round trips.

---

### 2C. Testability lens

**Claim: every proposed DES is unit-coverable, and the two that are not are named as such.**

| DES | tier | seam |
|---|---|---|
| DES-110 `resolveVersionRequest` | pure UT, table-driven, **no DB** | none needed — pure function |
| DES-114 `validateScriptEntry` | pure UT | injected `{aliases, openrouterPassthrough, mcpLookup}` ports |
| DES-116 `projectWorkflowForRead` | pure UT | none |
| DES-117 facade policy (`viewerIsOwner`) | UT | constructed `ReadContext`, no HTTP |
| DES-109/111 schema + migration + ceiling | hermetic integration (real file DB in a tmp `workRoot`) | **no new seam** — see below |
| DES-112/113 pin, resume, nested, DAG | integration | existing `InMemoryRunStore`, injected `Clock`, `_spawnerOverride` |
| DES-118 wire surface + masking | real-transport integration | existing injectable `TokenStore` |
| §2B.3 cross-process race | **not testable in-process** | assert transaction mode; residual recorded |

Six oracles I insist on, each written to survive v22 Rule 1 ("a test whose oracle is the code under test
cannot fail when the code is wrong"):

1. **The truth table is tested as a table**, all seven outcome rows of §2A.2 as literal
   `[input, channels, known] → expected` tuples, **plus the four precedence collisions** that only a
   declared order resolves (unknown version + invalid channel ⇒ `INVALID_CHANNEL`; known version + invalid
   channel ⇒ `INVALID_CHANNEL`; known version + unpublished channel ⇒ the version; unknown version +
   valid channel ⇒ `UNKNOWN_VERSION`). Not "resolves to something sensible".
2. **The legacy fixture is hand-written SQL.** The migration/S-2 tests build the pre-v22 `catalog.db` with
   raw `CREATE TABLE workflows (name TEXT PRIMARY KEY, script TEXT NOT NULL, version TEXT NOT NULL,
   createdAt TEXT NOT NULL)` + the three `ALTER TABLE`s (`workflow-catalog.ts:78-98`) and direct
   `INSERT`s — **never** by instantiating the new `WorkflowCatalog`. A fixture built by the code under test
   cannot detect a migration that is wrong in the same direction. This is also why I **refuse a
   `Database`-injection seam** on the catalog (Karpathy + §5.iii): writing the file into a tmp `workRoot`
   is both simpler and a strictly better test.
3. **IT-011 is upgraded from relative to literal.** `tests/integration/scriptversion-fidelity.test.ts:40-49`
   currently asserts `v2 !== v1`. That passes if both are wrong, and it is the existing guard on the field
   v22 promotes to the pin. Rewrite: run 1 pins **`'v1'`**, run 2 pins **`'v2'`**, and after registering a
   third version, run 1's status **still reports `'v1'`** (REQ-096's own clause).
4. **Resume determinism is proven by execution, not by metadata.** The RED test registers `v1` whose script
   returns a literal marker, suspends, registers+publishes `v2` returning a *different* literal, resumes,
   and asserts the **v1 marker** is the result. Asserting "the pin still says v1" tests the label; asserting
   the marker tests the behaviour REQ-096 bought.
5. **Masking is asserted two-sided and over the real transport.**
   `expect(Object.keys(deepFlatten(resp)).sort()).toEqual(EXPECTED_NON_OWNER_KEYS)` — so a *new* leaked
   field fails **and** a missing `scriptWithheld` fails. `not.toContain(scriptText)` is refused as an
   oracle (it passes while `result.script` leaks — and `script` genuinely appears **twice** in
   `workflow_get`'s response today, at the top level and inside `result`, `mcp-facade.ts` ~:220/:232). One
   test drives an authenticated **non-owner** through `/mcp` with a real bearer minted via `TokenStore`,
   including the negative: supplying `{principal: '<owner-email>'}` in the arguments does **not** unmask
   (the `args.principal` fallback at `server.ts:813-822` is barred from this path).
6. **Structural (grep-style) assertions where behaviour cannot reach.** Zero `if (spec.script)` in
   `submission-validator.ts`; zero `catalog.get(` / `getFull(` in `src/`; `PRAGMA table_info(workflows)`
   lacks the four moved columns; `tools/list` advertises neither `script` nor `scriptSha256` on
   `workflow_run`, nor `script` on `workflow_resume`, and does advertise `workflow_publish` with the
   `beta|release` enum. These are cheap and they are the only tests that fail when a *future* change
   re-opens the hole.

**Clock/storage injection status (checked, not assumed).** The clock is already injected
(`workflow-catalog.ts:70-72`); the new `workflow_versions.createdAt` must use `this._clock.isoNow()`, never
`new Date()` — otherwise version ordering becomes untestable under a fake clock. Storage is *not* injected
and should stay that way (oracle 2). `RunStore` is already an interface with an in-memory fake
(`run-store.ts:76+`), so the pin is UT-reachable without SQLite.

---

## 3. Task-splitting implications (a v22 `03-tasks.md` does not exist yet)

Numbering continues from `TASK-104`. My lenses constrain the split in four places; everything else the
synthesizer may split as it likes.

**Three groupings that MUST be single tasks** — splitting them re-creates this repo's signature failure:

- **T1 (`TASK-105`): the versioned catalog *and* every converted call site, in one commit.** `get()`'s
  deletion + `resolve`/`resolveDetail`/`exists` + the six known call sites (`run-manager.ts:391`, `:635`,
  `:801`; `scheduler.ts:147` and `:207`; `webhook-registry.ts:87`; plus `submission-validator.ts:83`). Split
  across tasks, the intermediate state either does not compile or — worse — keeps a legacy accessor alive
  for one review cycle, which is how it survives.
- **T4 (`TASK-108`): the required `ReadContext` *and* every call site *and* the transport test.** The whole
  value of a required parameter is that an unwired call site is a `tsc` error; a task that adds the
  parameter with a default "to unblock the next task" deletes the entire protection.
- **T7 (`TASK-111`): `maxWorkflowVersions` + `composeConfig()` forwarding + the
  `tests/unit/compose-config-v2-wiring.test.ts` row, in one task.** This is the repo's twice-realised
  wiring bug class (v11 `updateFlagPath`, v15 `auth`); the architecture already decrees it, and the task
  split is where it actually gets enforced or lost.
- **T2 (`TASK-106`): `script` + `scriptSha256` + `SCRIPT_SHA_WITHOUT_SCRIPT` + the drift-lock rows,
  together.** Removing one and leaving the other ships an advertised parameter that can only error.

**One ordering constraint:** the migration (T1) must land before the pin work (T3) can have a green test —
the resume-determinism RED test needs two retrievable versions to exist at all.

**One task that must be first, not last:** the **legacy-cohort test fixture** (§2C.2). Written after the
implementation, it will be built with the new code and prove nothing.

**One task I would refuse:** a "refactor `createRun` to an options object" task (§2A.3). 33 call sites of
mechanical churn inside a slice whose entire risk profile is silent failure — the review attention it
consumes is worth more spent on the masking and migration tests.

---

## 4. Risks (ordered by confirmed severity)

| # | risk | severity | evidence | mitigation |
|---|---|---|---|---|
| R1 | pre-v22 suspended named runs stranded by an unresolvable pin | **HIGH** — silent regression, discovered only by an upgrading operator | `run-manager.ts:385-394`, `:632-636`; `workflow-catalog.ts:210-220` | §2B.1 option (b) + a legacy-fixture RED test |
| R2 | `getFull`/legacy columns leave a second source of truth or a runtime SQL failure | **HIGH** — `tsc` cannot see it | `workflow-catalog.ts:267-276` | rename to `resolveDetail`; DROP COLUMN + `PRAGMA` assertion (§2B.2) |
| R3 | masking implemented but unwired on one surface | **HIGH** — the repo's own recurring class | `server.ts:801-825` (no principal on `workflow_get`/`workflow_list`), `:1002-1007` skeleton, `:1039-1046` dag | required `ReadContext` in ONE task + real-transport two-sided oracle |
| R4 | `scriptSha256` becomes an advertised, always-failing parameter | MED | `server.ts:318`, `run-manager.ts:292-294` | remove with `script` (§2A.7) |
| R5 | cross-process registration collides → untyped 500 | MED | deferred-transaction semantics; ARCH-071 inv-5's own scenario | `.immediate()` + typed `REGISTRATION_CONFLICT` (§2B.3) |
| R6 | version ceiling wedges an author | MED | ADR-014 + name-granular `deregister` (`workflow-catalog.ts:227-238`) | optional `version` on the existing deregister (§2B.4) |
| R7 | journal `scriptVersion` conflated with the resolved catalog version | MED | `types.ts:203`, `run-manager.ts:394/563/676/883` | distinct field + decouple the counter (§2A.5) |
| R8 | the validation move loses a check silently | MED | every check behind `if (spec.script)`, `submission-validator.ts:92-124` | shrink the deps object (§2A.4) + zero-`if (spec.script)` structural test |
| R9 | `MISSING_SCRIPT` teaches an agent to retry with a removed parameter | LOW-MED (agent altitude) | `submission-validator.ts:74-77` | rename to `MISSING_NAME` (§2A.6) |
| R10 | NULL-owner rows unreadable by anyone under auth | LOW, correct-but-surprising | `workflow-catalog.ts:100-107` + ARCH-076's predicate | pin as intended + distinct remediation text (§2B.5) |

---

## 5. Internal conflicts between my own three lenses (surfaced, not hidden)

1. **Interface-contract vs boundary — "never a silent fallback" vs the stranded legacy run (§2B.1).**
   `CHANNEL_UNPUBLISHED` exists precisely because REQ-097 forbids falling back to "newest". My §2B.1(b)
   proposes a fallback. **Resolution: they govern disjoint populations.** The prohibition is about a
   *request* the caller made (a named channel, a named version) — there, refusal is right. The legacy pin
   is not a request; it is a record of a version whose bytes no longer exist, in a cohort that is closed
   and cannot grow. And the fallback is *recorded on the run*, so it is not silent. If the panel disagrees,
   the strict option (a) is a one-line change — but it must be a decision, not an omission.
2. **Interface-contract vs boundary — `version` + `channel` supplied together.** Contract says silently
   discarding a supplied argument is a defect; REQ-097 says version wins, no error. **Resolution:** obey
   the requirement, and pay the contract debt with the `requested` echo + returning the resolved version
   from `workflow_run` (§2A.3) — visibility instead of an error.
3. **Testability vs Karpathy — a `Database` injection seam on the catalog.** Testability's reflex is a seam
   for the migration test. **Resolution: refused.** Writing a legacy `catalog.db` into a tmp `workRoot` is
   fewer moving parts *and* a strictly stronger test (it exercises the real driver against a real legacy
   file). This is the rare case where the simpler design is also the more testable one.
4. **Interface-contract vs testability — `createRun`'s five positional parameters (§2A.3).** The clean
   signature is an options object; the honest cost is 33 call sites of churn in a slice whose failures are
   all silent. **Resolution (Karpathy tie-break): additive fourth parameter now, refactor recorded as
   debt.** I state this as a conflict rather than a preference because the contract lens genuinely loses
   here.
5. **Boundary vs Karpathy — the per-version deregister (§2B.4).** New surface in a slice that boasts "one
   new tool". **Resolution: one *optional parameter* on an existing tool, not a second tool.** The
   alternative is a documented trap, and a trap is not simplicity.

---

## 6. Expected disagreements with the other lens (quality-dimensions)

1. **Publish audit trail (their OBS-2).** They will re-open it. I hold with ADR-009's decline — but I
   **concede half**: a structured INFO log nobody asserts is not observability. If the log line is the
   answer, a test must pin its fields (`name`, `channel`, `from→to`, `principal`). Unasserted logging is
   the same class as an unwired module.
2. **`validation` on `workflow_list` (their "recompute opportunistically on read").** I hold with the
   exclusion: a 3s dashboard poll × a per-row script parse is a real cost on a surface nobody debugs from,
   and `workflow_get` already answers the question.
3. **Dashboard identity / "the owner can't read their own script in the dashboard".** They will call this a
   consumability regression. I hold fail-closed (ADR-012) and offer the zero-cost mitigation: the masked
   dashboard panel shows the exact `workflow_get` invocation that would return the script to its owner. A
   dead end becomes a signpost without adding browser-session identity.
4. **Retention/GC.** They will want a sweep; I want the ceiling **plus** the §2B.4 escape hatch. I expect
   them to prefer the sweep precisely because it avoids the wedge — my counter is that automatic deletion
   collides with REQ-096's "both versions remain retrievable" and can orphan a completed run's pin, while
   an owner-initiated per-version delete cannot happen by surprise.
5. **`resolveVersionRequest` as an injected module (their replaceability instinct).** I hold: an exported
   pure function in the file that owns it. A separate module for a function with one caller is abstraction
   for code used once — and it is equally testable either way, which removes their strongest argument.
6. **`workflow_resume({runId, version})` (their CON-3).** Already declined in ADR-010 and I agree; it
   collides with v21's run-immutable `effectiveParams`. If they re-open it, my answer is §2B.1: the legacy
   cohort is what they are actually reaching for, and it has a narrower fix.
7. **`Scheduler.create` requiring the name to resolve on `release`.** I predict they contest it: an author
   cannot schedule a beta-only workflow, and the refusal arrives at creation for a condition (an unpublished
   release) the author may be about to fix. I keep the refusal — a schedule that can never fire is worse —
   but the error must say "publish `<name>@<version>` to `release` first". No `schedule_create({channel})`.
8. **Author-chosen version strings / semver (their CON-5).** Refused; engine-assigned `v<n>` is sortable,
   collision-free and parser-free, and author-chosen strings would make `resolveVersionRequest`'s
   `UNKNOWN_VERSION` cell ambiguous with a channel name.
9. **Where I expect to *agree* and want it on record:** deleting `get(name)` outright (their REP-1 — they
   were right and the adversarial instinct to keep a `getVersion` beside it was wrong); and a type in which
   `script` is unrepresentable for the non-owner branch (their REP-2), which is exactly ARCH-075's
   `WorkflowPublicView`.
