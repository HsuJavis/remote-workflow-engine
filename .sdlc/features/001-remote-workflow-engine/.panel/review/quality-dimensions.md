# Quality-dimensions review — Gate 2 architecture vs implementation (v22 slice)

**Lens:** Observability / Replaceability / Consumability / Self-sustainability
**Scope:** v22 slice only (REQ-096..100, ARCH-071..076, ADR-009..014), files collected from IMPL-148..156's `files:` lists in `06-impl-log.md`:
`src/workflow-catalog.ts`, `src/run-manager.ts`, `src/scheduler.ts`, `src/webhook-registry.ts`, `src/submission-validator.ts`, `src/mcp-facade.ts`, `src/server.ts`, `src/script-checks.ts`, `src/workflow-view.ts`, `src/run-store.ts`, `src/store/sqlite-run-store.ts`, `src/types.ts`, `src/agent-executor.ts`, `src/gateway/claude-agent-sdk-client.ts`, `src/main.ts`, plus the named test files.
**Baseline used:** `02-architecture.md`'s v22 section AS AMENDED — the `[AMENDED v22 gate-closeout]` notes on ARCH-074/ADR-013 (admission observation re-sited to the harness descriptor, registration-only environmental enforcement) were treated as the binding text, not the superseded original wording. Findings below are against text that was never amended.

---

## 1. Observability

Internal state — resolution decisions, version pins, staleness — must be inspectable without reading source.

### Finding O-1 — the run record never carries the "request shape" ARCH-072 specifies (CONFIRMED)
- **Violates:** ARCH-072 `api:` clause ("the run record additionally carries the **request shape** (`requested: {version} | {channel} | 'default-release'`) and the admission-time `validation` observation") and the v22 interface-contract table row for `workflow_status` ("reports the **pinned** version and **the request shape**"), and the v22 ER diagram (`RUNS.requested "v22 NEW — {version} | {channel} | default-release"`).
- **Evidence:** `grep -n "requested" src/run-store.ts src/store/sqlite-run-store.ts src/run-manager.ts src/types.ts` returns zero hits for any such field. `RunStore.createRun` (`src/run-store.ts:81,133,151-157`) persists only `scriptVersion`; nothing records *how* the run was addressed (explicit version vs. channel vs. default-release fallthrough).
- **Note on scope:** the sibling field `validation` from the same ARCH-072 clause is legitimately dropped — ADR-013's `[AMENDED v22 gate-closeout]` note explicitly re-sites that observation onto the harness descriptor (`mcpUnresolved`) and records the original "on the run record" wording as superseded. `requested` has no such amendment anywhere in `02-architecture.md`, `06-impl-log.md`, `07-review.md` or `08-validation.md` — it is a silent drop, not a recorded ruling.
- **Impact:** ARCH-072 note point (2) explicitly motivates this field as answering "which version did this cron actually run" after the pointer moves — that diagnostic is only half-built (the pin answers *what ran*; nothing answers *how it was addressed*, e.g. distinguishing "an explicit version pin" from "rode the release pointer that happened to be there at fire time").
- **Severity:** MEDIUM. Silent architecture drift on an explicitly-named observability field, undetected through Gate 6.5/7/8 (five rounds of gate-closeout notes exist for this slice and none flags it).

### Finding O-2 — nested `workflow()` does not record the resolved version on the journal / composite node (CONFIRMED)
- **Violates:** ARCH-072 `api:` clause verbatim: "nested `workflow(name)` (`:801`) resolves the **`release`** channel and **records the resolved version on the journal entry**." IMPL-152's own ledger note repeats the same claim ("nested `workflow()` resolves `release` and records the resolved version on the journal entry").
- **Evidence:** `src/run-manager.ts:816` resolves via `this._catalog.resolve(name, {})`, then `src/run-manager.ts:821` pushes `entry.workflowNodes.push({ frame: framePathKey, name, parentFrame: parentPathKey, depth })` — no version field. `WorkflowNodeView` (`src/types.ts:100-105`) has exactly four fields (`frame`, `name`, `parentFrame`, `depth`); there is no `version`/`scriptVersion` member anywhere on the type, so the resolved version returned by `catalog.resolve()` at line 816 is discarded immediately after the call.
- **Impact:** for a composite run, the dashboard/journal cannot show which version of a nested workflow actually executed once its `release` pointer moves on — exactly the observability gap ADR-010's "declared residual" flags for the *unsettled* resume case, except this is the *initial-dispatch* case and is not disclosed as a residual anywhere.
- **Severity:** MEDIUM. Same class as O-1 (a specific, named architecture commitment that the ledger's own note asserts was done but the code does not do).

### Finding O-3 (informational, not a defect) — publish/migration logging matches architecture
`workflow-catalog.ts:209` (`catalog.migrate: N workflows → workflow_versions, release published`) and `workflow-catalog.ts:487` (`catalog.publish: {...}` structured log with name/channel/fromVersion/toVersion/principal/at) both match ADR-011 and the "Conflict 2" decision to decline an audit table in favor of one log line. `mcpUnresolved` is correctly present-only-when-non-empty (`src/agent-executor.ts:61`, `src/gateway/claude-agent-sdk-client.ts:431/444`). No violation.

---

## 2. Replaceability

Module boundaries, pluggable ports, no hidden coupling.

No violations found. Specifically verified against the architecture's own load-bearing claims:
- `ReadContext` is a required parameter with no default at both `mcp-facade.ts` call signatures (`workflow_list(_a, _ctx: ReadContext)` at `:240`, `workflow_get(a, ctx: ReadContext)` at `:260`) and threaded from both `server.ts` dispatch sites (`:838`, `:859`) — matches ARCH-076/ADR-012's explicit rejection of an optional `principal = null` default.
- `catalog.get(name)` / `catalog.getFull(name)` are genuinely deleted — `grep -rn "catalog\.get(\|\.getFull("` over `src/` returns zero hits — matching ARCH-071 invariant (1)'s "compiler, not a reviewer, finds a missed call site."
- `script-checks.ts`'s `mcpLookup` port is exactly the declared `(name: string) => boolean` shape (`src/script-checks.ts:14`, `src/workflow-catalog.ts:108/127/135`), never the registry object — matches ARCH-074's stated port discipline.
- `maxWorkflowVersions` is threaded end-to-end: `WorkflowCatalogOpts.ceilings` (`workflow-catalog.ts:342`) ← `main.ts:167` ← `composeConfig()`, **and** `tests/unit/compose-config-v2-wiring.test.ts:175-177` carries the wiring-test row ARCH-071 invariant (8) names as "part of this ARCH's definition of done, not implementer discretion." This is the sixth instance of this project's recurring composeConfig wiring-gap class and it was correctly closed.

---

## 3. Consumability

Caller-facing surface: typed I/O, self-describing errors, discoverable schema.

No violations found. Specifically verified:
- `VERSION_CEILING_EXCEEDED` names both remedies (`workflow-catalog.ts:346`: "deregister an old version, or raise the engine's maxWorkflowVersions ceiling").
- `INLINE_SCRIPT_CLOSED` carries the two-call migration recipe (`run-manager.ts:285`: "register once (workflow_register) then run by name...").
- `CHANNEL_UNPUBLISHED` names the specific unpublished channel rather than falling back to "newest" (`workflow-catalog.ts:84,89`).
- `workflow_publish` is present in the schema drift-lock with `{name, version, channel}` required and a closed `beta|release` enum (`tests/integration/schema-drift-v22.test.ts:76-86`), matching ARCH-073's "both facts join the ARCH-051 structured drift-lock test."
- The non-owner masking oracle is the literal two-sided `Object.keys(deepFlatten(resp)).sort()` equality (`tests/unit/workflow-view.test.ts:18-29,77`) — the weaker `not.toContain(scriptText)` oracle ARCH-075 explicitly refuses is correctly absent.

---

## 4. Self-sustainability

Closed-loop autonomy: migrations that can't half-apply, self-healing schedules, no silent forever-retry.

### Finding S-1 — `Scheduler.create()` still only checks `exists()`, not "resolves on `release`" (CONFIRMED)
- **Violates:** ARCH-072 note point (1): "`scheduler.ts`/`webhook-registry.ts` keep only an `exists()`-shaped front-door check, **and `Scheduler.create()` upgrades its check to "resolves `release`"** so a schedule that could never fire is refused at creation rather than at 3am [quality SUS-5, bought for one line]." Also violates the v22 interface-contract table row: "`schedule_create` / `chain_create` / `webhook_create` ... creation now requires the name to resolve on `release`" with `CHANNEL_UNPUBLISHED` listed as a possible creation-time error.
- **Evidence:** `src/scheduler.ts:153-156` — `Scheduler.create()`'s only workflow check is `if (!(await this._catalog.exists(s.workflow))) return { error: { code: 'WORKFLOW_NOT_FOUND', ... } }`. There is no call to `catalog.resolve(name, {})` anywhere in `create()`, so a workflow that is registered (exists) but has never been published to `release` (`release_version = NULL`) **passes creation** and will only fail with `CHANNEL_UNPUBLISHED` at the driver's next fire — i.e. exactly the "refused... at 3am" failure mode the architecture note says this change eliminates. `webhook-registry.ts:88` has the same `exists()`-only shape, which is architecturally correct for that module (the note does not claim webhook gets the upgrade) but confirms scheduler's parity check was the one meant to move and did not.
- **Corroboration:** IMPL-152's own ledger note asserts the same unbuilt behavior verbatim ("nested `workflow()` resolves `release` and records the resolved version on the journal entry" — see Finding O-2), suggesting this SUS-5 claim and the O-2 claim were both written aspirationally from the architecture text rather than verified against the diff. No test in the suite exercises `Scheduler.create()` against an unpublished-but-registered workflow (`grep -rn "CHANNEL_UNPUBLISHED" tests/` has no scheduler/create hit), so the gap was never RED, either.
- **Impact:** a standing cron/once schedule created against a drafted-but-unpublished workflow silently accepts creation, then fails indefinitely (cron) or once with auto-disable (once, per IMPL-156) at its first real fire — with no operator signal at the point of the actual mistake. This is the precise "self-heal at the front door, not at 3am" property Self-sustainability asks for, and the one line the architecture explicitly bought for it was not shipped.
- **Severity:** HIGH. This is a named, budgeted (quality SUS-5) architectural commitment with a concrete failure scenario and zero test coverage protecting it — the same silent-failure risk class (S-1/S-2 in `06-impl-log.md`'s recurring vocabulary) this repo's own Karpathy-check paragraph for v22 claims is closed "by construction."

### Finding S-2 (informational, not a defect) — migration, transactions, ceiling semantics, and legacy fallback all match the architecture
- Boot migration is one `db.transaction()` (`workflow-catalog.ts:189-209`), idempotent (`INSERT OR IGNORE` + pointer-write-only-when-NULL), matching ADR-011.
- `register()` and `publish()` each run inside their own `db.transaction()` (`workflow-catalog.ts:333,382,482`), matching ARCH-071 invariant (5).
- The version ceiling counts versions, refuses at registration with a typed code, is sourced from the existing `Ceilings` object — matching ADR-014's decision (c) exactly, no GC/sweep introduced.
- `scheduler.ts`'s `markFailed`/`lastError` writer (once auto-disables, cron advances `nextFire` and records `lastError`) matches IMPL-156/ARCH-072's driver-wiring claim.
- Legacy-cohort resume fallback records `legacySubstitution:{pinned,resolved}` rather than crashing (`run-manager.ts:635-649`), matching ARCH-072 note point (3)'s ban-is-ingress-only guarantee.

---

## Summary

| # | Dimension | ARCH/ADR | Severity | Verdict |
|---|---|---|---|---|
| O-1 | Observability | ARCH-072 (`requested` field) | MEDIUM | CONFIRMED |
| O-2 | Observability | ARCH-072 (nested workflow() version on journal) | MEDIUM | CONFIRMED |
| S-1 | Self-sustainability | ARCH-072 note (1) / SUS-5 (Scheduler.create resolves release) | HIGH | CONFIRMED |

Replaceability and Consumability: no violations found against this iteration's architecture text.

Total violations: **3** (1 HIGH, 2 MEDIUM). All three are silent-drift defects — an architecture-text commitment that the implementation ledger asserts was done (O-2/S-1 are both restated verbatim as accomplished fact in IMPL-152's note) but that the actual diff does not perform, and that no test in the suite currently protects against regressing back to.
