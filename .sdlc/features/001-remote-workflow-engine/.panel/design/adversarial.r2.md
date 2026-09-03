---
stage: design
lens: adversarial (Interface-contract × Boundary/error × Testability; Karpathy tie-break)
iteration: v24
round: 2 (responses to quality-dimensions.r1 + final position)
---
# Design panel — adversarial group, round 2

**Read:** `quality-dimensions.r1.md` in full (the only other r1 file), my own `adversarial.r1.md`, and — because
several QD claims are about the *current tree* — the source lines they cite, re-verified 2026-09-04:
`agent-executor.ts:39-64` (two `redactHarness` branches: **true**), `:440-449` (harness event `data = {agentId,
descriptor}`), `run-store.ts:24` (`deriveAgentRecords` reads `descriptor.model/provider` only: **true**),
`types.ts:65-72` (`AgentRecord.label?` already exists and is never filled from the descriptor), `server.ts:1161/1733/1953`
(`/api/runs*` dispatched by the ungated `dispatchDashboard`: **true**; `dashboard*.ts` never reads `principal`),
`scheduler.ts:34-43` (`ScheduleStatus.lastError:{code,at}`: **true**), `:213-217` (`listByWorkflow` reads the column
ARCH-099 drops: **true**), `:284-294` (`markFired`'s `UPDATE`), `path-containment.ts:13-24` (no realpath injection
today), `main.ts:68` (`JSON.parse(...) as FileConfig` — no unknown-key check: **true**), `main.ts:163-165` (the three
ceilings are operator-overridable: **true**), 58 `codedError(` call sites over 25 distinct literals in `src/`,
bundled SQLite `3.53.2`, `workspace-gc.ts:12` (`reclaimStaleWorkspaces`). ADR-027 text: `adminReads[]` "for the run's
owner". ARCH-099 text: `claim` as **one** conditional `UPDATE`; migration `claimedBy = workflow, then dropped`.

**Verdict in one paragraph.** QD's r1 and mine are complementary, not opposed: QD found holes in the *read-back* half
of seams whose *refusal* half I specified, and every one of their HIGH items is real in the tree. Tally over the
tables below: **19 concede, 5 already converged in my r1 under another name, 2 hold in a narrower form, 1 rebut** (the
task merge). No
QD item reopens ADR-023/030/035. The section that matters most to the synthesizer is §3 — the architecture sentences
both panels now agree must be amended, listed by id so the ledger does not drift.

---

## 1. Responses to quality-dimensions r1 (rebut / concede / hold)

### Observability

| QD | verdict | reason (verified) | lands in |
|---|---|---|---|
| **O-7** descriptor fields on both `redactHarness` branches | **concede — by construction, not by editing the redactor.** The dispatch site builds `data = {agentId, descriptor}` (`agent-executor.ts:440`). `label`, `provenance`, `materialized` become **siblings of `descriptor` on `data`**, written once at the dispatch site regardless of `surfaceType`. Both branches are covered, `redactHarness` stays literally "unchanged" (ARCH-104's own words), and the `redact()` sweep on `:441` already covers the new keys (they are on `base`). The `'none'` fixture goes in the test list, with `materialized = {skills:[], mcp:[], missing: declared}` on that branch exactly as QD asks. | new **DES-161** |
| **O-8** name the consumer | **concede.** `deriveAgentRecords` (`run-store.ts:24`) gains two reads: `data.label → AgentRecord.label` (the field **already exists**, `types.ts:67`, v8, and is never filled from the harness — so this is one read, not a new field) and `data.provenance → AgentRecord.provenance` (four short strings). `materialized` stays transcript-only (`run_agent_log`) — QD's own split. I **do not** add the resolved `effort`/`timeoutMs` values to `AgentRecord`: `model` is already there and `run_agent_log` is one call away; a second copy of three values is a second thing that can drift. Residual, LOW, synthesizer may add them. | DES-161 |
| **O-9 (MCP half)** visibility | **hold owner-only; concede absent-not-`[]`.** ADR-027's text is "for the run's owner"; QD's "owner **and** admin" extends the ADR. The party whose data was read is the reviewer; an admin reviewing *other admins'* reads is a viewer tool by another name, which ADR-027 declined. Non-owner ⇒ key **absent** (the `mcpUnresolved` convention, `types.ts:239`), never `[]`. | DES-151 amended |
| **O-9 (HTTP half)** projection rule | **concede in full, including the pre-existing `principal`.** `GET /api/runs/:id` returns the whole `RunStatusView` through the ungated `dispatchDashboard` (`server.ts:1733/1953`). `dashboard*.ts` never reads `principal`, so the general rule — **no identity field (`principal`, `adminReads[].actor`, `pushedBy`, `createdBy`, `claimedBy`) is served on an ungated `/api/*` route** — is a zero-cost strip today. One function, `toPublicRunView(view)`, applied at `/api/runs*`; one test that the two keys are absent. Gating the whole dashboard stays out of v24 (we agree). | new **DES-162** |
| **O-10** audit write failure | **converged — already true by construction in DES-151** (`appendAudit` is sync; a throw propagates before the read). Adding QD's test: a store whose `appendAudit` throws ⇒ `workspace_pull` returns `INTERNAL_ERROR` and **no bytes**. **No new code** (`AUDIT_UNAVAILABLE` would be an engine-fault dressed as a caller code — `INTERNAL_ERROR` is the honest class). | DES-151 test list |
| **O-11(a)** `lastError` vs `lastRefusalReason` | **hold three fields — with the precedence QD says they will accept.** Overloading `lastError` makes a `cron` that was refused at 09:00 and failed at 09:01 lose one of two distinct facts. Docblock on `ScheduleStatus`: "`lastError` = dispatch failed (gateway/run); `lastRefusalReason` = policy refused before dispatch (never both for one firing)"; test: a refusal leaves `lastError` untouched (already DES-150). | DES-150 |
| **O-11(b)** monotonic `refusalCount` | **concede — but make the semantics true instead of documenting a lie.** `markFired` (`scheduler.ts:287/293`) gains `refusalCount = 0` in its existing `UPDATE`; the field is then literally "consecutive refusals since the last successful fire". One column in two statements, one test (refuse ×3, fire, count `0`). Same on the webhook row. | DES-150 |
| **O-11(c)** consumers of the dropped `workflow` column | **concede, enumerated:** `ScheduleStatus.workflow` (`scheduler.ts:37`) → `claimedBy: string \| null`; `listByWorkflow` (`:213`) — its only consumers are `trigger-bindings.ts:47` ← `getTriggerBindings` ← `graph-analyzer.ts:263/429` (**deleted**) and `mcp-facade.ts:436` (`describe`, which DES-156 rewrites to read `triggers[]` from the version row and resolve each id through `ownerOf/get(id)`); `server.ts:1458-1459` (the same wire, incl. the webhook `w.workflow === name` filter). **Decision: `listByWorkflow`, `getTriggerBindings`, `TriggerPorts` and the facade's `triggerPorts` field are retired outright** — not rewritten to `claimedBy` — because after the analyzer deletion nothing needs a by-workflow trigger query; `describe.triggers[]` is a by-id lookup. `trigger-bindings.ts` is then empty and joins DES-159's delete list (amends my r1, which kept the file minus two symbols). | DES-156, DES-159 |
| **O-12** REQ-118 table path + reason string | **converged — already DES-158** (`.sdlc/features/001-remote-workflow-engine/v24-tool-surface.md`, `UNVERIFIED(reason)` verbatim, one row per array entry). | — |

### Replaceability

| QD | verdict | reason | lands in |
|---|---|---|---|
| **R-6** null-owner rule | **converged — DES-139's tri-state is exactly this** (`null` = exists-and-ownerless ⇒ admin-only; `undefined` = not found). Adding QD's two obligations: (1) the SQL-agreement test — `run_list`'s `WHERE principal = ?` excludes `NULL` rows and the unit matrix says the same for the same fixture (DES-152 already has the row; label it as the cross-seam assertion); (2) the **stated consequence** in README/guide: when auth is enabled, pre-v15 runs and **every migrated trigger** (`createdBy NULL`, ARCH-099) are admin-only. **One boundary neither r1 stated:** a migrated schedule has `claimedBy = <workflow>` but `createdBy NULL`, so an `author` re-registering that workflow with the legacy id in `triggers[]` is refused `NOT_TRIGGER_OWNER` at DES-149 step (2) even though the claim would be `'held'` under their own name. Cost today is nil (the only caller is the admin owner); the ledger must say it or Gate 8 reads it as a defect. | DES-139, DES-149 |
| **R-7** import `isPathContained`, name the fixtures | **concede, one signature.** `isPathContained(path, root, realpath: (p: string) => string = realpathSync)` — extended **in place** (`path-containment.ts:13`), no second containment function; DES-142's `pathVerdict` takes the same injected `realpath` and passes it through. The drift-lock fixture rows, named: `STRIP_RE` (`workspace-seed.ts:39`) — `.claude/settings.json`, `.claude/settings.local.json`, `.claude/hooks/x`, nested `a/.claude/hooks/x`; **not** stripped — `.claude/skills/s/SKILL.md`, `CLAUDE.md`; `safeRelPath` (`asset-sync.ts:64-73`) — absolute (`/etc/x`, `C:\x`), `..` escape (`../x`, `a/../../x`), and the **relative-root regression** (`./data/assets` root, plain `a/b` accepted). | DES-142 |
| **R-8** `resolveMcp` pure helper | **converged — DES-153 already.** | — |
| **R-9** the ARCH-090 warning does not exist for free | **concede, generalized.** `loadFileConfig` (`main.ts:68`) gains `const KNOWN_FILE_CONFIG_KEYS: Record<keyof FileConfig, true> = {…}` — the `Record<keyof …, true>` form makes the compiler **refuse a missing key**, so the list cannot rot (T4 closed at compile time); any top-level key not in it ⇒ one `console.warn` listing all unknown keys, naming ADR-025 when the key is `graphAnalyzer`. Test: a config with `graphAnalyzer` and `typoKey` warns once naming both. | DES-141 |
| **R-10** no alias string in any example script | **concede** — one test over `GUIDE_EXAMPLES[].script` against `aliasNames`. | DES-157 |

### Consumability

| QD | verdict | reason | lands in |
|---|---|---|---|
| **C-5** fence `ERROR_CATALOG` | **concede the fence, with the number that dissolves the fear.** Catalog keys = `TOOL_SPECS[].errors` ∪ `INGRESS_CODES` (the HTTP-route codes: `BLOB_*`, `MISSING_BLOBS`, `INVALID_BLOB_REQUEST`, the 409 webhook codes). Of the 25 literals in `src/` today, `HARNESS_DEFAULTS_INVALID` (`workflow-catalog.ts:346/404`) is thrown only from the `defaults` path ADR-035 retires and leaves with its site; the remaining 24 all fall in one of the two sets, so narrowing `codedError(code: ErrorCode, …)` costs **zero call-site edits** — each existing code becomes one catalog row and the 58 sites compile untouched. `tool-specs.ts` imports `ErrorCode` **type-only** (ARCH-087's "imports nothing" stays true at runtime). **Karpathy correction to my r1:** the row is `{see, hint}` — **no `message`** (the call site already passes the message with its dynamic detail; a second static one is a duplicate that drifts). `hint` is the one-line sentence the guide's error table prints. | DES-137 amended |
| **C-6** byte ceilings on guide + `tools/list` descriptions | **concede the mechanism; do not negotiate the number here.** Two unit tests with literal ceilings, 24 KB each as QD's starting figure, revisable only with Gate 7.5 transcript evidence. It is a red test for a failure no other test sees. | DES-157 |
| **C-7** effective ceilings, not `DEFAULT_CEILINGS` | **converged — DES-157's "pure over inputs" was written for this;** the composition root passes `config.{maxTimeoutMs, maxAppendPromptBytes, maxEffort}` (`main.ts:163-165`). QD's boot-with-override test added. ARCH-107's `ceilings: DEFAULT_CEILINGS` is amended (§3). | DES-157 |
| **C-8** echo the applied filter | **concede** — `workflow_list` response gains `onlyRunnable: boolean` (the applied value). One field, one test. | DES-156 |
| **C-9** ADR-033's honest cost | **concede** — one guide sentence pointing a human at a Mermaid live editor; one README line. | DES-157 |

### Self-sustainability

| QD | verdict | reason | lands in |
|---|---|---|---|
| **S-7** the loud half of fail-closed | **concede.** One boot line `auth: enabled=<bool> principals=<n> defaultRole=<role>` and `system_info.auth: {enabled, principalsCount, defaultRole}`; same task as the `composeConfig` row (QD split-point 2). Test: `system_info` under auth with an empty map reports `defaultRole:'user'`. | DES-141 |
| **S-8(a)** `DROP COLUMN` floor | **concede as a note:** bundled SQLite is 3.53.2 (≥3.35); the migration docblock states the floor. | DES-148 |
| **S-8(b)** legacy global assets are rows-only | **concede — and it was already DES-148's walk** ("walk `<workRoot>/assets/<kind>/<name>` into `assets(workflow='', pushedBy='legacy')`" moves no file). Stated explicitly now. | DES-148 |
| **S-8(c)** orphan asset tree after a failed deregister after-hook | **concede as one predicate on the existing sweep**, not a new mechanism: `reclaimStaleWorkspaces` (`workspace-gc.ts:12`) takes a `hasWorkflow(name): boolean` port and removes `<workRoot>/<name>/assets/` when false. Two tests (orphan reclaimed; live workflow's tree untouched). | DES-148 |
| **S-9** autonomy ledger | agree; nothing to design. | — |

### QD's task-split points

| # | verdict |
|---|---|
| 1 `TOOL_SPECS` + `authorize()` + wire as ONE task | **rebut the merge, concede the placement.** The Gate 3+ directive asks for a *finer* partition; merging the three largest pure units into the facade task is the opposite. The "red at an intermediate state" objection dissolves by putting each drift-lock in the task that can make it green: pure row tests (prefix, count, no-old-name-in-array, admin-in-description ⇒ `minRole`) in task 2; the matrix in task 3; the **HTTP-level** locks (`tools/list` byte-equals `projectToolsList()`, no old name over the wire) in task 15. Red tests before their task is TDD, not a broken build. |
| 2 `principals` wiring + test row + S-7 announcement one task | **concede** (task 15's `composeConfig` slice becomes its own task 15a — see §5). |
| 3 descriptor + `deriveAgentRecords` one task | **concede** — DES-161 is one task (14b). |
| 4 catalog first | agree (task 1). |
| 5 migrations before facade | agree (tasks 10–13 before 15). |
| 6 guide last among code tasks | agree (task 16). |
| 7 client-plugin rename as a tracked external task | **concede** — task 19: "external, owner-scheduled, **blocks the REQ-117 probe**"; it carries DES-142's `?namespace=` drop and the 15 renames. |

### QD's expected disagreement aimed at me (O-9 placement)
They predicted I would want the whole dashboard gated. I do not — the projection strip is the minimum and it is
zero-cost (no dashboard reader of `principal`). They predicted I would read `adminReads[]` as leaking admin identity to
a user. I read it as ADR-027 settled it *for the owner*; my only hold is that it stays owner-only. Converged.

---

## 2. Amendments to my r1 DES items (deltas only — r1 text stands where not named)

- **DES-137** — catalog row is `{see: 'workflow_authoring_guide' | null; hint: string}` (drop `message`); keys =
  `TOOL_SPECS[].errors` ∪ `INGRESS_CODES`; the 24 surviving literals become rows (`HARNESS_DEFAULTS_INVALID` retires with `defaults`), call sites untouched; type-only import
  into `tool-specs.ts`; drift lock (a) now reads "every key ∈ some `errors[]` **or** `INGRESS_CODES`", and a new (f):
  "every existing `codedError('X'` literal in `src/` is a key" fails **today** by 24 rows — the task is to add the rows.
- **DES-139** — add the R-6 consequence sentence (migrated triggers `createdBy NULL` ⇒ admin-only under auth) and the
  cross-seam SQL-agreement test pointer to DES-152.
- **DES-141** — adds `KNOWN_FILE_CONFIG_KEYS: Record<keyof FileConfig, true>` + unknown-key warn (R-9); boot line +
  `system_info.auth` (S-7); tests ≥3 more.
- **DES-142** — `isPathContained(path, root, realpath = realpathSync)` extended in place; `pathVerdict` passes the
  injection through; fixture rows named as in R-7.
- **DES-148** — SQLite ≥3.35 floor in the migration docblock; "rows only, no FS move" stated; GC predicate
  `hasWorkflow(name)` on `reclaimStaleWorkspaces` (S-8c), ≥2 tests.
- **DES-150** — `markFired` sets `refusalCount = 0` (both stores); `ScheduleStatus` docblock pins `lastError` vs
  `lastRefusalReason`; `ScheduleStatus.workflow` → `claimedBy: string | null`; tests +2.
- **DES-151** — `adminReads[]` **absent** (not `[]`) for non-owners; audit-throw ⇒ `INTERNAL_ERROR`, no bytes (test).
- **DES-152** — the `NULL`-exclusion row is labelled "cross-seam agreement with DES-139".
- **DES-156** — `describe.triggers[]` resolved by id (`scheduler.get(id) ?? webhooks.get(id)`), never by workflow;
  `workflow_list` echoes `onlyRunnable`.
- **DES-157** — builder takes **effective** ceilings from `ServerConfig`; two byte-ceiling tests (24 KB each, revisable);
  no-alias-in-examples test; live-editor sentence; boot-with-override interpolation test.
- **DES-159** — `trigger-bindings.ts` moves from "partial delete" to the **delete list** (`getTriggerBindings`,
  `TriggerPorts`, `listByWorkflow` on both stores, `server.ts:1458-1459`, `mcp-facade.ts:24-25/436` go with it);
  `tests/unit/trigger-bindings*.test.ts` joins the deleted-test list.

### New items (no r1 home)

**DES-161 — the harness event carries `label` / `provenance` / `materialized` as siblings of `descriptor`; `deriveAgentRecords` reads two of them**
- **traces:** ARCH-104, REQ-110, REQ-113 · **closes:** QD O-7, O-8
- **signature:** at `agent-executor.ts:440`, `base = { agentId, descriptor: decorated, label, provenance, materialized }`
  — written **once**, before `redact()`, independent of `surfaceType`; `redactHarness` unchanged (ARCH-104 stays
  literally true). `deriveAgentRecords` (`run-store.ts:24`): on the harness branch, `label: data.label` (fills the
  existing `AgentRecord.label?`) and `provenance: data.provenance` (new optional field, the four rungs). On the usage
  branch, the same two are copied from the **latest harness event** (a terminal record must not lose its label).
  `materialized` is transcript-only (`run_agent_log`).
- **boundary:** `surfaceType:'none'` ⇒ `materialized = {skills:[], mcp:[], missing: declared}` (the whole declared set is
  missing — "nothing materialized" and "no surface" are different facts and both are visible); pre-v24 transcripts
  (no `data.label`) ⇒ `label` absent, `provenance` absent — never defaulted.
- **tests:** `tests/unit/derive-agent-records-v24.test.ts` (≥6): both branches; the `'none'` fixture; a pre-v24 fixture;
  latest-wins with two harness events. `tests/integration/agent-log-harness-shape.test.ts` (DES-160) asserts the three
  keys are **on `data`**, not inside `descriptor` (a mid-tier implementer who nests them inside `descriptor` breaks
  the `'none'` branch — the placement is the whole point, so the test pins it).

**DES-162 — `toPublicRunView(view)`: no identity field on an ungated `/api/*` route**
- **traces:** ARCH-091, ADR-027, REQ-109 · **closes:** QD O-9 (HTTP half)
- **signature:** `toPublicRunView(v: RunStatusView): Omit<RunStatusView, 'principal' | 'adminReads'>` — applied in
  `dispatchDashboard` for `/api/runs` and `/api/runs/:id`; the MCP `run_status` path does **not** call it.
- **boundary:** the rule is general and stated once: `principal`, `adminReads`, `pushedBy`, `createdBy`, `claimedBy`
  are never serialized by an ungated `/api/*` route. `/api/workflows/:name/describe` is gated (`server.ts:1907`) and
  unaffected. Behaviour change on `principal`: **none observable** — `dashboard*.ts` has no reader of it, and no test under `tests/` asserts `principal` over `/api/runs` (checked 2026-09-04; only the `no-skeleton-surface` grep guard mentions both terms), so there is no T3 exposure.
- **tests:** `tests/integration/api-runs-public-projection.test.ts` (≥3): both routes lack both keys on a run that has
  both; the MCP `run_status` for the owner still carries `adminReads`; a grep guard that no `/api/` handler
  serializes `createdBy|claimedBy|pushedBy` (source-text test, ARCH-084 pattern).

---

## 3. Architecture sentences both panels now need amended (for the synthesizer — by id, or the ledger drifts)

| ARCH/ADR | current text | amended to | source |
|---|---|---|---|
| ARCH-088 | `triggerOwner(kind, id): string \| null` | `triggerOwner(id): string \| null \| undefined` (tri-state; ids are unprefixed UUIDs from two stores) | adv DES-139 + QD R-6 |
| ARCH-091 | `run_start` seed arguments "unchanged" | `seedNamespace` removed (closed schema ⇒ `INVALID_ARGUMENT`); namespace = `principal.id ?? 'local'` at all three sites (`server.ts:359/1992/2014`) | adv DES-142 |
| ARCH-091 | `workspace_push` errors include `HOOKS_UNSUPPORTED` | retired; `kind:'hook'` is a schema `enum` refusal; the sentence moves to the row description | adv DES-153 |
| ARCH-099 | `claim → 'claimed' \| 'NOT_FOUND' \| 'ALREADY_CLAIMED'` via one `UPDATE … (claimedBy IS NULL OR claimedBy=?)` | adds `'held'`; two statements in one transaction — one conditional `UPDATE` cannot tell null→name from name→name, and the compensation rule ("release only what this call claimed") needs it | adv DES-149 |
| ARCH-099 | three refusal fields beside `lastError` | plus: `refusalCount` reset to `0` by `markFired`; `lastError`/`lastRefusalReason` precedence stated; `ScheduleStatus.workflow` → `claimedBy`; `listByWorkflow` retired | QD O-11 + adv DES-150 |
| ARCH-090 | "a present-but-unknown `graphAnalyzer` key produces one boot warning" | built as a general unknown-top-level-key warn (`KNOWN_FILE_CONFIG_KEYS`), plus the S-7 boot line | QD R-9/S-7 |
| ARCH-104 | descriptor "gains `label`, `provenance`, `materialized`; `redactHarness` unchanged" | the three are siblings of `descriptor` on the event `data` (so "unchanged" holds on both branches); `deriveAgentRecords` named as consumer | QD O-7/O-8 + DES-161 |
| ARCH-107 | `ceilings: DEFAULT_CEILINGS` | `ceilings: ServerConfig.{maxTimeoutMs, maxAppendPromptBytes, maxEffort}` (effective) | QD C-7 + adv DES-157 |
| ARCH-107 | `ERROR_CATALOG` in `src/errors.ts` | + fence: keys = `TOOL_SPECS[].errors` ∪ `INGRESS_CODES`; row `{see, hint}`; type-only import into `tool-specs.ts` | QD C-5 + adv DES-137 |
| ADR-027 | `adminReads[]` for the run's owner | + absent (not `[]`) for non-owners; stripped from `/api/*` (DES-162) | QD O-9 |
| ARCH-093 | "a new pure module" | `pathVerdict` **imports** `isPathContained` (extended in place with an injectable `realpath`) | QD R-7 + adv DES-142 |
| ARCH-095 | `agentType` rung "reachable only for `appendPrompt`" | rung deleted (unreachable once `model.default` is required); `agentTypeDef.model` sources the prompt, not the model | adv DES-146 (unchanged from r1, listed for completeness) |

---

## 4. Remaining disagreements (for the synthesizer; cost of each side in one line)

1. **`adminReads[]` audience — owner-only (adv) vs owner+admin (QD).** Owner-only: matches ADR-027's text, one
   predicate. Owner+admin: one more predicate, and an admin reviewing other admins' reads is a viewer capability ADR-027
   declined. *Holding owner-only; the cost of flipping is one line.*
2. **`AgentRecord` payload — `label` + `provenance` (adv) vs `label` + four resolved values + `provenance` (QD).** Mine:
   two reads in `deriveAgentRecords`. QD's: two more fields that duplicate `run_agent_log`. *Holding the smaller; LOW.*
3. **Task 15 as one task (QD) vs 2/3/15 with locks placed per task (adv).** Rebutted above; the placement rule is the
   integration. *If the synthesizer merges, the Gate 3+ directive's "finer partition" is contradicted in its largest
   task.*
4. **Legacy version rows — `LEGACY_REREGISTER` (adv r1 R6).** QD did not contest it; still flagged synthesizer-decidable.
5. **`run_result` in the audited set (adv r1 R7).** Not contested; one string; synthesizer may strike with a reason.

Everything else in both r1 files is converged as of this round.

---

## 5. Task partition — amendments to my r1 table

- **14b (new):** DES-161 — descriptor siblings + `deriveAgentRecords` reads, one task (QD point 3).
- **15a (split out of 15):** DES-141 — `composeConfig` rows (`principals`, `mcpEgressAllowlist`), `KNOWN_FILE_CONFIG_KEYS`
  warn, boot line, `system_info.auth` — wiring and its announcement in one unit (QD point 2). Runs **before** 15.
- **15:** facade + `callTool(deps)` + `Principal` at the edge + DES-162 projection + the HTTP-level drift-locks from
  tasks 2/3 (placement rule, QD point 1).
- **19 (new, external):** client plugin — 15 renames + `?namespace=` drop; "owner-scheduled, blocks the REQ-117
  probe" (QD point 7 / QD-R11).
- **9 (deletion)** now includes `trigger-bindings.ts` and its tests (O-11c).
- Ordering constraints from r1 stand: 9 before 15; 18 last before the Gate 5 RED confirmation.
