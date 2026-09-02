# Quality-dimensions review — Gate 2 architecture vs implementation (v22 slice, Gate 8 RE-REVIEW)

**Lens:** Observability / Replaceability / Consumability / Self-sustainability
**Scope:** v22 slice only (REQ-096..100, ARCH-071..076, ADR-009..014), files collected from
IMPL-148..157's `files:` lists in `06-impl-log.md`:
`src/workflow-catalog.ts`, `src/run-manager.ts`, `src/scheduler.ts`, `src/webhook-registry.ts`,
`src/submission-validator.ts`, `src/mcp-facade.ts`, `src/server.ts`, `src/script-checks.ts`,
`src/workflow-view.ts`, `src/run-store.ts`, `src/store/sqlite-run-store.ts`, `src/types.ts`,
`src/agent-executor.ts`, `src/gateway/claude-agent-sdk-client.ts`, `src/main.ts`, `src/errors.ts`,
plus the named test files.

**Baseline used:** `02-architecture.md`'s v22 section AS AMENDED — the `[AMENDED v22
gate-closeout]` notes on ARCH-074/ADR-013 (admission observation re-sited to the harness
descriptor, registration-only environmental enforcement) are treated as binding text, not the
superseded original wording. Findings below are against text that was never amended.

**Relationship to the prior round:** a prior pass of this same review fed `07-review.md`'s v22
Gate 8 send-back (§4.1–§4.3), consolidated there with the adversarial panel's findings into 4 HIGH
+ 6 MEDIUM + 4 LOW. This round independently re-verifies the current tree (post `330eefd`/
`2e865e8`, IMPL-157) against source, not against either panel's prior word. Findings below
carry their prior ID where the same defect is being re-confirmed, and are marked RESOLVED,
CONFIRMED (still open), or NEW accordingly.

---

## 1. Observability

Internal state — resolution decisions, version pins, staleness — must be inspectable without
reading source.

### Finding O-1 — the run record never carries the "request shape" ARCH-072 specifies (CONFIRMED, still open)
- **Violates:** ARCH-072 `api:` clause ("the run record additionally carries the **request
  shape** (`requested: {version} | {channel} | 'default-release'`) and the admission-time
  `validation` observation") plus the v22 interface-contract table and ER diagram, all of which
  still assert this field exists.
- **Evidence:** `WorkflowCatalog`'s internal `resolve()` computes and returns a `requested`
  discriminated union (`src/workflow-catalog.ts:67,77,86,90`) but it is discarded before
  persistence: `RunManager.start()` calls `this._store.createRun(spec, resolvedVersion,
  persistedParams)` (`src/run-manager.ts:447`) — no `requested` argument — and
  `SqliteRunStore.createRun`'s `INSERT` (`src/store/sqlite-run-store.ts:35,85-86`) has no such
  column. `grep -n "requested" src/run-manager.ts src/types.ts src/run-store.ts
  src/store/sqlite-run-store.ts` returns zero hits outside `workflow-catalog.ts`'s own
  computation.
- **Note on scope:** the sibling field `validation` from the same ARCH-072 clause is legitimately
  dropped — ADR-013's `[AMENDED v22 gate-closeout]` note explicitly re-sites that observation onto
  the harness descriptor (`mcpUnresolved`) and records the original "on the run record" wording as
  superseded. `requested` has no such amendment anywhere in `02-architecture.md`; it is a silent
  drop, not a recorded ruling.
- **Disposition:** recorded in `07-review.md` §4.3 as M1 (=A4+O-1), MEDIUM, explicitly "does not
  reopen send_back if left for a follow-up." Confirmed still unfixed in the current tree — correct
  per that disposition, not a regression.
- **Severity:** MEDIUM (carried).

### Finding O-2 — nested `workflow()` does not record the resolved version on the journal / composite node (CONFIRMED, still open)
- **Violates:** ARCH-072 `api:` clause verbatim: "nested `workflow(name)` (`:801`) resolves the
  **`release`** channel and **records the resolved version on the journal entry**." IMPL-152's own
  ledger note repeats the same claim as accomplished fact.
- **Evidence:** `src/run-manager.ts:816` resolves via `this._catalog.resolve(name, {})`
  (`const registered = await this._catalog.resolve(name, {})`), then `src/run-manager.ts:821`
  pushes `entry.workflowNodes.push({ frame: framePathKey, name, parentFrame: parentPathKey,
  depth })` — no version field, and the `registered` binding is never read again after the
  `resolve()` call other than for its throw-on-not-found effect. `WorkflowNodeView`
  (`src/types.ts:100-105`) has exactly four fields; no `version`/`scriptVersion` member exists on
  the type at all, so there is nowhere for the resolved version to go even if it were kept.
- **Impact:** for a composite run, the dashboard/journal cannot show which version of a nested
  workflow actually executed once its `release` pointer moves on — the same class of gap ADR-010
  names as an accepted *resume-time* residual, except this is the undisclosed *initial-dispatch*
  case.
- **Disposition:** recorded in `07-review.md` §4.3 as M5 (=O-2), MEDIUM, same non-blocking
  disposition as O-1. Confirmed still unfixed — correct per that disposition.
- **Severity:** MEDIUM (carried).

### Finding O-3 (informational, not a defect) — mcpUnresolved surfacing and publish/migration logging match architecture
`src/agent-executor.ts:61` and `src/gateway/claude-agent-sdk-client.ts:431,444` correctly emit
`HarnessDescriptor.mcpUnresolved` present-only-when-non-empty (never `[]`), matching IMPL-148's
ADR-013 amendment. `workflow-catalog.ts:209` (`catalog.migrate: N workflows →
workflow_versions, release published`) and `:487` (`catalog.publish: {...}` structured log) both
match ADR-011's decision to decline an audit table in favor of one log line. No violation.

---

## 2. Replaceability

Module boundaries, pluggable ports, no hidden coupling.

No violations found. Specifically re-verified against the architecture's own load-bearing claims,
on the current (post-send-back) tree:
- `ReadContext` is a required parameter with no default at both `mcp-facade.ts` call signatures
  and threaded from both `server.ts` dispatch sites — matches ARCH-076/ADR-012's explicit rejection
  of an optional `principal = null` default.
- `catalog.get(name)` / `catalog.getFull(name)` are genuinely deleted —
  `grep -rn "catalog\.get(\|\.getFull("` over `src/` returns zero hits — matching ARCH-071
  invariant (1)'s "compiler, not a reviewer, finds a missed call site."
- `script-checks.ts`'s `mcpLookup` port is exactly the declared `(name: string) => boolean` shape,
  never the registry object — matches ARCH-074's stated port discipline, and no import cycle exists
  between `script-checks.ts` and `workflow-catalog.ts`.
- `Scheduler.create()` (`src/scheduler.ts:163`) and `WebhookRegistry.create()`
  (`src/webhook-registry.ts:97`) both now depend on `catalog.resolve()` through the same port
  shape used everywhere else (no new coupling introduced by the H4 fix — it reuses the existing
  `CatalogPort`-shaped `resolve` method already required by `run-manager.ts`).

---

## 3. Consumability

Caller-facing surface: typed I/O, self-describing errors, discoverable schema.

### Finding C-1 — `VERSION_CEILING_EXCEEDED`'s remedy text names the wrong-granularity fix (NEW to this report, = adversarial L2/A10)
- **Violates:** ARCH-073's own stated principle that "for an MCP agent the error text is the
  documentation," applied here to ADR-014.
- **Evidence:** `src/workflow-catalog.ts:346` — the refusal message reads "...deregister an old
  version, or raise the engine's maxWorkflowVersions ceiling." But `deregister(name, principal)`
  (`src/workflow-catalog.ts:380` onward) is name-granular: ADR-014 states plainly "`deregister`
  keeps today's semantics ... removes the name and now all its version rows." An agent that follows
  the error text's literal first remedy to free up "an old version" destroys the workflow's entire
  version history (and every completed run's pin degrades per ADR-014's own accepted-cost clause),
  not just the one draft it meant to prune. There is no per-version deregister to actually do what
  the text says.
- **Severity:** LOW — the ceiling refusal itself is correct and typed; only the suggested remedy is
  misleading. Already recorded in `07-review.md` §4.3 as L2, non-blocking.

### Finding C-2 — `workflow_get`'s owner branch omits `versions[]`/`channels{}` the v22 interface table promises (NEW to this report, = adversarial L3/A11)
- **Violates:** the v22 interface-contract table's stated `workflow_get` response shape (which
  includes `versions[]`/`channels{}`), and internal self-consistency with `workflow_list`, which
  does carry `channels`.
- **Evidence:** `src/mcp-facade.ts:325-341` — the owner (or auth-disabled) branch's `resultObj` and
  top-level response carry `name, version, createdAt, description, phases, script, skeleton, owner,
  defaults, params, validation` — no `versions` array, no `channels` object anywhere in either
  shape. An owner asking "what versions exist / what's on beta vs release for my own workflow"
  through `workflow_get` gets neither and must call `workflow_list` instead, which the interface
  table does not document as the required combination.
- **Severity:** LOW — a discoverability/consistency gap, not a masking or correctness defect
  (nothing sensitive is under- or over-disclosed). Already recorded in `07-review.md` §4.3 as L3,
  non-blocking.

Otherwise no violations found. Re-confirmed on the current tree:
- `INLINE_SCRIPT_CLOSED` still carries the two-call migration recipe (`run-manager.ts`).
- `CHANNEL_UNPUBLISHED` still names the specific unpublished channel, never falls back to newest.
- `workflow_publish` remains in the schema drift-lock with `{name, version, channel}` required and
  a closed `beta|release` enum.
- The non-owner masking oracle is still the literal two-sided `Object.keys(deepFlatten(resp)).sort()`
  equality (`tests/unit/workflow-view.test.ts`), not the weaker `not.toContain(scriptText)` ARCH-075
  explicitly refuses.
- H1's new `PRINCIPAL_REQUIRED` envelope (`server.ts:812-814`) adds one extra top-level `code`
  field beyond the `{runId,status,error}` shape `toErrEnvelope` produces elsewhere, but this is
  additive (not a removed/renamed field) and is itself pinned by
  `tests/integration/catalog-write-auth-dbind.test.ts` — not treated as a drift violation.

---

## 4. Self-sustainability

Closed-loop autonomy: migrations that can't half-apply, self-healing schedules, no silent
forever-retry, ceilings that can't silently disable.

### Finding S-1 — `Scheduler.create()`/`WebhookRegistry.create()` resolving `release` at creation (RESOLVED since prior round)
- **Prior status:** this report's own prior round flagged `Scheduler.create()` as checking only
  `exists()` and never `resolve(name,{channel:'release'})`, contradicting ARCH-072 note (1)'s
  named "one line" self-sustainability commitment (a schedule against an unpublished-but-registered
  workflow would fail silently at every future fire instead of at creation). Consolidated into
  `07-review.md` §4.2 as H4 (HIGH, both sites).
- **Verified fix, current tree:** `src/scheduler.ts:163` — `await this._catalog.resolve(s.workflow,
  { channel: 'release' })` inside `create()`, refusing `CHANNEL_UNPUBLISHED`/`WORKFLOW_NOT_FOUND`
  before the row is written. `src/webhook-registry.ts:97` carries the identical fix for
  `WebhookRegistry.create()` (the second site, IMPL-157's H4 note). Both now share
  `catalogResolveErrorEnvelope` (`src/errors.ts:61`) for the error-mapping, per the Gate 6.5
  simplify recorded in the same IMPL-157 note. `Scheduler.trigger()` was deliberately left
  unchanged (adjudication #6): it starts the run through `RunManager.start()`, which already
  resolves the channel itself, so the protected property holds there without a second check.
- **Verdict:** no longer a violation. Verified directly against source, not taken on the ledger's
  word.

### Finding S-2 (informational, not a defect) — migration, transactions, ceiling counting, and legacy fallback all match the architecture
- Boot migration is one `db.transaction()`, idempotent (`INSERT OR IGNORE` + pointer-write-only-
  when-NULL), matching ADR-011.
- `register()` and `publish()` each run inside their own `db.transaction()`, matching ARCH-071
  invariant (5).
- `register()`'s version allocator now uses `MAX(CAST(SUBSTR(version,2) AS INTEGER))`
  (`workflow-catalog.ts:353-356`), matching ARCH-071 invariant (7) and closing the prior H3 defect
  (a migrated-then-re-registered name no longer collides on `v2`).
- Legacy-cohort resume fallback records `legacySubstitution:{pinned,resolved}` rather than
  crashing, matching ARCH-072 note (3)'s ingress-only ban guarantee.

### Finding S-3 — `maxWorkflowVersions` reaches `WorkflowCatalog` only through an unchecked structural cast on both sides (NEW to this report, = adversarial M4/A8)
- **Violates:** ARCH-071 invariant (8)/(6)'s own stated purpose — the ceiling must be threaded
  through `main.ts`'s `composeConfig()` **and** pinned by
  `tests/unit/compose-config-v2-wiring.test.ts` "as part of this ARCH's definition of done, not
  implementer discretion," specifically to prevent this repo's recurring "correct implementation,
  silently-disable-able wiring, every unit test green" bug class (the same class named six times
  across v11/v15/v16/v21/v22 in this ledger's own vocabulary).
- **Evidence:** `src/workflow-catalog.ts:342` — `const maxWorkflowVersions = (this._ceilings as
  (Ceilings & { maxWorkflowVersions?: number }) | undefined)?.maxWorkflowVersions;` — the field is
  not on the declared `Ceilings` type; it is reached only via an `as` cast plus optional chaining
  on both the write side (`server.ts:1239-1243`'s `Ceilings & { maxWorkflowVersions?: number }`
  object literal) and the read side. `tests/unit/compose-config-v2-wiring.test.ts:175-177` pins
  only that `composeConfig()` forwards the raw `fileConfig.maxWorkflowVersions` value into
  `ServerConfig` — it never exercises `WorkflowCatalog` itself, so it cannot detect a rename or
  drop of the cast's literal key on either side (e.g. a typo in the object-literal key at
  `server.ts:1243`, or in the cast at `workflow-catalog.ts:342`) — such a change would compile
  clean (the cast suppresses the type error the class was supposed to make impossible) and every
  existing test, including the wiring test, would stay green while the ceiling silently stopped
  applying.
- **Impact:** the one property ARCH-071's DoD explicitly bought against — "the compiler, not a
  reviewer, finds a missed call site" — does not hold for this specific ceiling; it holds for the
  `composeConfig → ServerConfig` hop but not for the `ServerConfig → WorkflowCatalog` hop, where an
  `as`-cast reintroduces exactly the silent-failure shape the DoD language was written to prevent.
- **Severity:** MEDIUM. Already recorded in `07-review.md` §4.3 as M4, non-blocking this round —
  confirmed still present, unchanged.

---

## Summary

| # | Dimension | ARCH/ADR | Severity | Status |
|---|---|---|---|---|
| O-1 | Observability | ARCH-072 (`requested` field) | MEDIUM | CONFIRMED (carried, = 07-review M1) |
| O-2 | Observability | ARCH-072 (nested workflow() version on journal) | MEDIUM | CONFIRMED (carried, = 07-review M5) |
| S-1 | Self-sustainability | ARCH-072 note (1) (Scheduler/Webhook `create()` resolves release) | — | **RESOLVED** (was HIGH, = 07-review H4) |
| S-3 | Self-sustainability | ARCH-071 inv (6)/(8) (`maxWorkflowVersions` cast, wiring-gap class) | MEDIUM | CONFIRMED (= 07-review M4) |
| C-1 | Consumability | ADR-014 / ARCH-073 error-text principle | LOW | CONFIRMED (= 07-review L2) |
| C-2 | Consumability | v22 interface-contract table (`workflow_get` shape) | LOW | CONFIRMED (= 07-review L3) |

Replaceability: no violations found.

**Total open violations this pass: 5** (0 HIGH, 2 MEDIUM carried [O-1, O-2], 1 MEDIUM carried
[S-3], 2 LOW carried [C-1, C-2]). One prior HIGH (S-1) is verified RESOLVED. All five open items
are already recorded in `07-review.md` §4.3 as non-blocking MEDIUM/LOW tech debt with a clear
disposition ("does not reopen send_back") — none are newly discovered regressions, and none
contradict an architecture text that has itself been amended. Re-reporting them here reflects that
`02-architecture.md`'s unamended text still asserts behavior the code does not perform; the
decision to defer rather than fix is a review/process disposition, not an architecture amendment,
so from a pure architecture-vs-implementation lens the deviation is real and current.
