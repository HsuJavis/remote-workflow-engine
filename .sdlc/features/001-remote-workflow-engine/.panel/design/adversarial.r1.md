---
stage: design
lens: adversarial (interface-contract × boundary/error × testability; Karpathy simplicity-first as the tie-breaker)
iteration: v26
round: 1 (independent proposal)
reads: "01-requirements.md REQ-121..130 + Round v26 clarification incl. the Gate-2 addendum rulings (:1328-1543); 02-architecture.md v26 slice ARCH-110..121 + ADR-037..047 + 4+1 views + data delta + interface table + INV-V26-1..7 + Decision rationale (:2726-3134); state.yaml tech_stack + the GATE 3+ directive + gates.{tasks,design} reset; v26-gate1-working-notes.md; the HEAD source tree (570723e) and node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts"
delta_note: "This path already held a v26 r1 (written 08:22, committed in 570723e). The owner's Gate-2 addendum rulings landed at 08:13 in eaf6546 and that draft still argued ADR-038's PRICE_UNKNOWN refusal and ADR-047 as PENDING. This round re-verifies every prior finding against HEAD (all still hold; nothing in src/ moved) and REWRITES the money items for the two rulings: DES-180/181 (costUSD is a number, never null; `unpriced` becomes a real field), DES-178 (the pin moves to RunManager.start() because tracking is now mandatory for trigger-started runs), DES-188 (ADR-047 is ruled, so the ledger amendment is the whole obligation). ALSO NEW since 570723e and not a stale carry-over: DES-174's finding that `AgentCallScan` (workflow-meta.ts:165-169) carries none of the three fields ARCH-113's derivation assumes, and DES-171's verified three-tier unmapped-subtype rule (26 system subtypes in the installed sdk.d.ts, four of them diagnostic). The prior text is reachable at `git show 570723e:.sdlc/features/001-remote-workflow-engine/.panel/design/adversarial.r1.md`. NOTE FOR THE SYNTHESIZER: `.panel/design/adversarial.r2.md` on disk is PRE-RULING (08:35) and must not be read as current — it rebuts a refusal the owner struck."
---
# Design panel — adversarial group (Interface-contract × Boundary/error × Testability), round 1 — v26

**Altitude (judged from tech_stack + the ten REQs, not assumed).** This is a **system-altitude control plane**
(Node 22 / TypeScript strict ESM, SQLite via better-sqlite3, a hand-rolled JSON-RPC-over-HTTP MCP server, a managed
LiteLLM subprocess, two GatewayClient implementations) that **hosts AI agents**. Both altitudes are live, and they
divide cleanly:

- **Agent altitude** applies exactly where the *consumer of a surface is an LLM*: the `tools/list` schemas and their
  descriptions (`run_start.seed`, `run_start.budget` — REQ-121/127), the refusal envelopes a cold model must act on
  (`INVALID_SEED_SPEC`, the four v2 diagram codes — REQ-121/128), the authoring guide (REQ-130) and the REQ-117
  cold-model probe that REQ-128 extends. There, **the error envelope and the tool description ARE the API**:
  interface-contract reads "a cold model can act on this without a human"; boundary reads "every refusal names the
  fix and the next legal move"; testability reads "the REQ-117 protocol plus a description-literal drift-lock".
- **System altitude** applies everywhere else — the gateway, the guard, the store, the layout, the updater. I do not
  force the agent lens onto `RunGuard` or `sqlite-run-store`; a budget door is a budget door.

**The constraint that shapes every item below (state.yaml GATE 3+ DIRECTIVE, still in force).** `tests` and
`implement` run on the **lower model tier**, so the compensation must live in the *specification*: a finer task
partition, a larger test count, and tests written to trap the four mid-tier failure modes the directive names —
**(T1)** a silent no-op instead of a refusal; **(T2)** an oracle derived from the code under test; **(T3)** a test
left green after the thing it named was retired; **(T4)** a description that stops matching the thing. Every DES
below names its tests and which trap(s) they close. v26 is unusually **T3-heavy** (a whole provider path, a curation
function, three effort tables and a fold function leave the tree) and unusually **T4-heavy** (a persisted number
changes unit, a field is renamed, ten guide examples change shape, one schema goes from `{type:'array'}` to a
described item shape).

**Settled at Gate 2 — nothing below reopens these.** Object budget (ADR-037), regex skeleton + a narrowed contract
(ADR-039), the SDK error union as the classifier input (ADR-040), the deletion (ADR-041), `--check-config` in the
updater (ADR-042), an explicit `diagram_contract` column (ADR-043), client-constructed DAG DOM (ADR-044), one effort
table (ADR-045), the bug class recorded as an ADR without a shared abstraction (ADR-046), no payload of an unmapped
SDK message is ever stored (named counter only), named counters over a `warnings[]` umbrella, the phase join by
ordinal, `remaining() → null`, no corrected Mermaid in a refusal, `tools: default` as the honest word for the
engine's configured default surface. Where I sharpen a MECHANIC of one of these it is labelled as such, not as a
reopening.

**Settled by the owner on 2026-09-08 (commit `eaf6546`) — this round is written to these, and they are not
negotiable at Gate 4.**

1. **An unpriced model is charged 0, and the run is admitted.** `costUSD: 0`, the record is marked `unpriced`, the
   run counts `meta.unpricedCalls`, and the price book can be adjusted afterwards. ADR-038's `PRICE_UNKNOWN`
   admission refusal is **overruled**.
2. **Trigger-started runs (cron / once / resident / webhook) carry no spend limit** — the author already knows what
   the trigger costs. D-V2h is re-decided; ADR-047 option (b).
3. **The standing principle both rulings serve:** *a budget is optional and absent means unbounded — but every run's
   spend must be tracked, recorded and queryable afterwards.* Tracking is not conditional on a budget existing.

---

## Summary

The v26 architecture is sound and unusually well-grounded; my three lenses find **no structural objection** to
ARCH-110..121. What they find is a design gate's proper business: **eleven stale spots and two outright omissions in
the architecture text (§A), plus the places where ARCH is a paragraph and the design must be a signature**, and — the headline — **the owner's two rulings landed 9 minutes
before the previous panel round and the architecture BODY was never updated to match**, so a design gate that
derives DES rows from the body alone will specify a refusal the owner struck out and a `null` the owner replaced
with `0`.

Five things this proposal argues, in descending order of what they cost if missed:

1. **(HIGH, ruling fallout) The body still specifies the overruled design in eight places, and never specified the
   two things the ruling requires.** Nothing in ARCH-116/118 mints a field for `unpriced: true` — the struck design
   used `costUSD: null` to *mean* unpriced, and deleting the refusal without adding the flag leaves the ruling's
   "可查詢" (queryable) clause with no field behind it. And ARCH-116 pins the price book at "`run_start` admission",
   which is precisely the door **trigger-started runs do not come through** — under ruling (2)+(3), unattended runs
   are exactly the ones whose spend must be recorded, so an unpinned trigger run would report `unpriced` for every
   call and satisfy neither ruling. Both are one-line fixes made in the right place: `RunManager.start()` is the
   shared chokepoint (verified: `mcp-facade.ts:570`, `scheduler.ts:313`, `server.ts:870`, `webhook-registry.ts:302`
   all call it), and `unpriced` is a boolean beside `costUSD`. §A lists every stale spot so the synthesizer derives
   no DES from them.
2. **(HIGH, interface-contract) `costUSD: number | null` must collapse to `costUSD: number` + `unpriced: boolean`.**
   The ruling makes the three-valued number an unforced choice: `null` now has no meaning the boolean does not carry
   better, and a nullable number in a summed column is how "0 or missing?" bugs get written by a lower-tier
   implementer summing `?? 0` into a total nobody can audit. Keep `null` where it is honest — inside the pure
   `priceCall(tokens, rates) → number | null`, which really cannot price an unlisted model — and collapse at the ONE
   capture site: `costUSD = priced ?? 0; unpriced = priced === null`. Two-valued on the wire, in SQLite, and in the
   fold.
3. **(HIGH, boundary) `run_start.budget` must keep accepting `null`.** ARCH-118 specifies `{usd?, tokens?}` with
   `minProperties:1`; today's schema is `budget: {type:['number','null'], description:'… Omitted or null means
   unbounded.'}` (`tool-specs.ts:352`) and the owner's own principle says absent = unbounded. Shipping
   `minProperties:1` alone refuses `budget: null` — a value the engine's own published description tells callers to
   send — turning "unbounded" into `INVALID_ARGUMENT` for every conservative client. The schema is
   `anyOf:[{type:'null'}, {type:'object', properties:{usd,tokens}, additionalProperties:false, minProperties:1}]`
   and `parseBudget` is the one door with a `never` check over three arms.
4. **(HIGH, testability + the directive) Four of v26's ten REQs are verified by DELETION, and deletion is the trap
   the lower tier fails.** A grep guard proves an identifier is absent; it does not prove no *behaviour* survived,
   and it goes green the moment the test that named the retired thing is deleted along with it (T3). Every deletion
   in DES-173 therefore pairs a grep guard (absence) with one behavioural assertion (presence of the right
   behaviour) and one explicit list of the ~18 existing test files that must be rewritten *before* the code is
   removed, not after.

5. **(HIGH, interface-contract) `AgentCallScan` cannot supply what ARCH-113 asks of it.** The derivation is typed
   as if the scanner already carried `allowedTools`, a character offset and ternary/`parallel` grouping; verified at
   `workflow-meta.ts:165-169` it carries `{labels, calls:[{line,label}], violations}` and nothing else. Two of the
   four v2 diagram rules (`TOOLS_MISMATCH`, the `alt` slot) are therefore not implementable until the scan learns
   three fields — a task that must be named ahead of the derivation, not discovered inside it (DES-174).

Below that: `deriveExpectedGraph` must be TOTAL and return a discriminated refusal rather than throw (it is consumed
by a checker that must answer and a layout that must never crash a dashboard); the terminal `api_retry` arm must
follow the *existing* streaming rule at `claude-agent-sdk-client.ts:660-667` or `capture()` double-emits every error
event; the `AbortController` at `:462` is created only when a timeout or an external signal exists, so ARCH-111's
"always abort" is a real code change and not a comment; and the sandbox budget wire is three fields
(`budgetTotal` at start, `spent` per `agentResult`, and the accessors reading them) of which the **nested**
`SandboxHost` at `run-manager.ts:1011` gets neither `onBudgetSnapshot` nor the new `currentPhase` — so today a
nested `workflow()` frame's `budget.spent()` is stuck at 0, and v26 makes that a money number.

**Karpathy check on my own proposal.** I add **no new module** beyond the three ARCH already names, **no new error
code** (I delete one that was designed: `PRICE_UNKNOWN`), **no new persisted table**, and **one new persisted
boolean** (`unpriced`) which replaces a nullable number rather than joining it. Where a lens of mine wanted more —
an admission-time warning channel for an unenforceable USD cap, a `Projection<T>` type, a second budget accessor
object — I talk myself out of it in §Conflicts and say why.

---

## A. Ruling fallout — the exact spots the synthesizer must NOT derive a DES from (HIGH)

The owner's rulings were applied to the two `owner_decision:` fields only. Everything below still specifies the
struck design. **I am not editing `02-architecture.md`** (Gate 2 is closed and the architect owns that file); this
is the list the orchestrator needs, and the DES rows below are written to the ruling, not to the body.

| # | Location | What it still says | What the ruling makes it |
|---|---|---|---|
| 1 | ADR-038 heading | "a run whose USD limit is its ONLY armed limit is refused … (`PRICE_UNKNOWN`)" | no refusal exists; the heading is the struck design |
| 2 | ARCH-116 note | "under ADR-038 the pin decides whether a budgeted run is admitted at all" | the pin decides *arithmetic*, never *admission* |
| 3 | ARCH-118 api | `AgentRecord.costUSD: number \| null` | `costUSD: number` (0 when unpriced) + `unpriced: boolean` |
| 4 | ARCH-118 api | `priceCall(...) → number \| null` … "`_unpriced++` (only for a `done` call whose pinned rates are `null`)" | the pure function keeps `null`; the RECORD does not (DES-180) |
| 5 | 4+1 logical view | `PU{"USD-only limit + unpriced model?"}` and `PU -->|yes| REF2["PRICE_UNKNOWN (ADR-038)"]` | the `PU` decision node and the `REF2` edge are gone; admission has no pricing branch |
| 6 | ERD, `USAGE_EVENT.costUSD` | "null when unpriced" | "0 when unpriced; `unpriced` says so" |
| 7 | ERD, `AGENT_RECORD.costUSD` | "null when unpriced" | same |
| 8 | Interface table, row 3 | "`run_start` admission … may refuse `PRICE_UNKNOWN` … (pending the owner ruling on ADR-047's sibling question)" | **delete the row**; there is no pricing-related admission outcome |
| 9 | Scenarios bullet 4 | "ADR-038 either refuses (USD-only) or admits and counts" | admits and counts, always |
| 10 | Decision rationale, "Unpriced model under a USD budget" | records the narrowed refusal as the synthesis position | records a position the owner overruled; keep as history, do not implement |
| 11 | Housekeeping (2) | "`04-design.md:832` / `:1156` (D-V2h) … must be amended at Gate 4 whichever way ADR-047 is ruled" | it IS ruled — (b). The amendment is now a definite, single-valued doc task (DES-188), not a conditional |

**And two things the body never says, which the design must mint:**

- **(a) No field carries `unpriced`.** REQ-127's ruling text is explicit — *"該筆紀錄標 `unpriced: true`、run 的
  `meta.unpricedCalls` 計數"*. ARCH-118 mints the run-level counter but relies on `costUSD === null` for the
  per-record fact. Delete the `null` and the fact has nowhere to live. **DES-180** mints `unpriced: boolean` on the
  usage event and on `AgentRecord`, and defines absence as "pre-v26 record" (which `foldUsage` already counts as
  unpriced) — one meaning per state, no overloading.
- **(b) The pin is bound to the wrong door.** ARCH-116: *"Admission (`run_start`) resolves the reachable set …
  and writes `runs.price_book`"*. Verified at HEAD: `run_start` reaches `RunManager.start()` via
  `mcp-facade.ts:570`, but so do `scheduler.ts:313` (cron/once), `server.ts:870` (a second schedule firing path) and
  `webhook-registry.ts:302` — none of which pass a budget, and all of which the owner has just declared *must still
  track spend*. `RunManager.start()` is already the admission chokepoint (`RUN_ADMISSION_LIMIT`, the seed
  precedence ladder and `INLINE_SCRIPT_CLOSED` all live there, `run-manager.ts:335-400`), so pinning there costs one
  site and covers all four entrypoints. Pinning in the MCP facade would satisfy ruling (1) and silently fail
  rulings (2)+(3) for exactly the unattended runs they were written about. **DES-178.**

A third, smaller consequence worth stating because a lower tier will otherwise "helpfully" build it: **`PRICE_UNKNOWN`
must never appear in `ERROR_CATALOG`, in a test name, or in a guide sentence.** It was designed in a panel round, it
is written down in three panel files on disk, and it is exactly the kind of striking-through a mid-tier implementer
reading stale context re-implements. DES-187 carries a one-line grep guard for the string across `src/`, `tests/`
and `docs/` (T3).

---

## Key points — proposed DES items

Convention follows `04-design.md`'s existing rows (**signature** / **boundary** / **tests**), plus two fields my
lens needs: **lens** (which of my three drives the item) and **traps** (which of T1–T4 the tests close). IDs start
at **DES-170** (last used on disk: DES-169 / TASK-169 / UT-171 / IT-140 / E2E-009 / VAL-170). `TASK-` numbers are
left unassigned — §Task partition says where the cuts belong, the synthesizer numbers them.

### DES-170 — `validateSeedSpec` is the ONE door for `INVALID_SEED_SPEC`, and it runs before the first `mkdirSync`

- **lens:** boundary/error (primary), interface-contract (schema), agent altitude (the hint is read by a model).
- **signature:** `validateSeedSpec(source: 'seed' | 'seedManifest', value: unknown) → { ok: true; files: SeedFile[] } | { ok: true; entries: ManifestEntry[] } | { ok: false; code: 'INVALID_SEED_SPEC'; index: number; path: string | null; message: string }`.
  Pure, no I/O, no throw. `materializeSeed(workspace, files)` narrows its parameter to the validated type and
  **throws** on a missing `contentB64` instead of `?? ''` (`workspace-seed.ts:46`) — defence in depth behind the
  gate, never the gate itself.
- **boundary — the completeness argument.** At HEAD there are already **two** sites emitting `INVALID_SEED_SPEC`
  with hand-written messages for the seed arrays (`run-manager.ts:356` for `seed`, `:359` for `seedManifest`) plus
  four more for `seedRef`/`seedManifestRef` (`:381`, `:384`, `:404`, `:407`). Adding a seventh in
  `workspace-seed.ts` gives one code seven prose styles and makes the guide's hint undrift-lockable. **The design
  rule is: `start()`'s two array-shape checks are REPLACED by `validateSeedSpec(...)` calls** (it subsumes the
  non-array case as `index:-1`), so the seed family has one door for one code. The `seedRef`/`seedManifestRef`
  branches stay as they are — they validate a *different* shape and were not in REQ-121's scope; §Conflicts explains
  why I do not unify all six.
- **boundary — ordering, stated as a decision procedure (this is what a lower tier gets wrong).** In `start()`:
  (1) `INLINE_SCRIPT_CLOSED`; (2) `RUN_ADMISSION_LIMIT`; (3) `validateSeedSpec` on `seed` and on `seedManifest`;
  (4) `SEED_SOURCE_CONFLICT` (4-way); (5) the `seedRef` ladder; (6) the `seedManifestRef` ladder. **Note the
  deliberate inversion of today's order at step 3 vs 4:** today the array-type check precedes the conflict check
  and v26 keeps that relative order, so a caller who sends both a malformed `seed` AND a `seedManifest` gets
  `INVALID_SEED_SPEC` — not `SEED_SOURCE_CONFLICT`. Pin it in a test either way; leaving it unstated is how the
  precedence flips silently in a refactor.
- **boundary — refuse the FIRST offender, not all of them.** The consumer is a model editing one call; a list of
  20 bad paths is noise, and the second element's validity is unknown anyway once the first is malformed. (The
  opposite call is made for aliases in DES-172 — see §Conflicts item 1 for why the two differ.)
- **interface-contract — the schema, and the one thing that must be checked before it ships.** `seed.items =
  {type:'object', required:['path','contentB64'], additionalProperties:false, properties:{path:{type:'string'},
  contentB64:{type:'string', description:'REQUIRED — base64 of the file bytes. A sha256-only element is refused
  with INVALID_SEED_SPEC; to seed by sha256 use seedManifest.'}}}`; `seedManifest.items =
  {required:['path','sha256'], properties:{sha256:{pattern:'^[0-9a-f]{64}$'}, exec:{type:'boolean'}}}`;
  `seedManifestRef = {type:'string', pattern:'^[0-9a-f]{64}$'}`. **`additionalProperties:false` on `seed.items`
  ships only after a Gate 5 read of `~/Documents/remote-workflow-plugin/skills/rwe-seed/push_workspace.py`
  confirms it sends exactly `{path, contentB64}`** — the plugin is a separate repo with no SDLC ledger, so this is
  a manual cross-repo check with a named owner, not an assumption. If it sends anything extra,
  `additionalProperties:false` is dropped and `required` alone carries REQ-121 (the requirement is satisfied either
  way; only the strictness differs).
- **interface-contract — the catalog row.** `errors.ts:112` today: `INVALID_SEED_SPEC: { see: null, hint: 'the
  seed/seedManifest/seedManifestRef payload does not match its declared shape' }`. That generic row would let
  DES-186's catalog test pass while REQ-121's actual message is still useless. v26 sets
  `see: 'workflow_authoring_guide'` and rewrites the hint to name the fix: *"seed elements carry bytes inline as
  contentB64 (string, base64); to seed by sha256 use seedManifest (blobs pushed via workspace_push) or
  seedManifestRef."* **The hint string and the schema description are ONE exported constant**, interpolated into
  both (the `LOCKED_KEYS` pattern already used at `tool-specs.ts:370-376`), or they drift within two iterations (T4).
- **tests:** UT — a table of ≥12 rows over `validateSeedSpec` (`{path,sha256}` → refused naming the path;
  `contentB64: null` / `123` / `undefined`; `path` missing; a non-array; `[]`; an element that is a string; a valid
  pair; a valid `seedManifest` row; a `seedManifest` row with a 63-hex sha; `exec:true`). **The zero-write
  assertion is the one that matters and it must be filesystem-observable, not mock-observable**: call the real
  admission path against a `tmpdir` with element 2 of 3 malformed and assert `readdirSync(workspace)` throws ENOENT
  — a spy on `mkdirSync` is an oracle derived from the implementation (T2). IT — `run_start({seed:[{path,sha256}]})`
  over the real MCP facade returns `INVALID_SEED_SPEC` with the path in the message and `see`. UT — the
  description/hint drift lock (T4). UT — `tools/list` snapshot contains the three item shapes.
- **traps:** T1 (today's silent 0-byte write is the exact failure mode), T2 (filesystem oracle), T4 (one constant).

### DES-171 — `classifyApiError` is total over a genuinely closed union; the terminal arm obeys the existing streaming rule; the controller always exists

- **lens:** boundary/error (primary), testability.
- **verification the design rests on (I checked, because ADR-040's central claim is a compile-time one).** In the
  installed SDK: `sdk.d.ts:2788` — `export declare type SDKAssistantMessageError = 'authentication_failed' |
  'oauth_org_not_allowed' | 'billing_error' | 'rate_limit' | 'overloaded' | 'invalid_request' | 'model_not_found' |
  'server_error' | 'unknown' | 'max_output_tokens'` — **exactly the ten members ARCH-111 enumerates, closed and
  exported**; and `sdk.d.ts:2740-2750` — `SDKAPIRetryMessage = { type:'system'; subtype:'api_retry'; attempt: number;
  max_retries: number; retry_delay_ms: number; error_status: number | null; error: SDKAssistantMessageError; uuid;
  session_id }`. So ADR-040's "a new SDK kind is a compile error" is **true**, and `retry_delay_ms` is available
  for the retry event at no cost.
- **signature:** `classifyApiError(kind: SDKAssistantMessageError | string, status: number | null) → 'terminal' |
  'retry'`. Pure, total, no I/O. `authentication_failed | oauth_org_not_allowed | billing_error | invalid_request |
  model_not_found → 'terminal'`; `rate_limit | overloaded | server_error | max_output_tokens → 'retry'`;
  `'unknown'` **and any string outside the union** → `status !== null && status >= 400 && status < 500 && status !==
  408 && status !== 429 ? 'terminal' : 'retry'`.
- **interface-contract — why the parameter is `SDKAssistantMessageError | string` and not the union alone.**
  `tsc` totality is a compile-time property of the *declared* type; the value arrives over an IPC boundary from a
  CLI subprocess whose version can move under us (the SDK is a runtime dependency the updater upgrades). A function
  typed only on the union gets a `switch` a lower tier writes with no `default`, and an unrecognised runtime string
  falls through to `undefined` → treated as falsy → retry forever. The widened parameter forces the default arm to
  exist **and** keeps the exhaustiveness benefit, because the internal `switch` is written over the union with a
  `const _never: never = k` in the union-exhaustive branch and the widened default outside it. State this in the
  design; it is two lines and it is the difference between a claim and a property.
- **boundary — the streaming rule, cited, because getting it wrong double-writes every error.** `_drain` at
  `claude-agent-sdk-client.ts:653-667` already branches on `const streaming = onEvent !== undefined`: non-result
  messages are streamed **or** accumulated, never both, and the existing `is_error` arm does
  `if (streaming) { await onEvent!(errEv); } else { events.push(errEv); }` then returns `{... events}`. **The new
  terminal `api_retry` arm MUST use the identical shape.** If it pushes unconditionally, `capture()`
  (`agent-executor.ts:277-279`) re-emits `result.events ?? []` and every 401 is journalled twice — a duplicate that
  a unit test on `_drain` alone will never see. The retry (non-terminal) arm streams a five-scalar event
  `{type:'api_retry', status, kind, attempt, max_retries}` (+ `retry_delay_ms`, free and useful) and **continues the
  loop**; no provider prose is copied.
- **boundary — the abort is a real code change, not a comment.** `:462` today:
  `const controller = timeoutMs !== undefined || req.signal !== undefined ? new AbortController() : undefined;`
  With no configured timeout and no external signal there is **no controller at all**, so "always abort in
  `finally`" requires unconditional construction. Two further facts a lower tier must be told rather than left to
  discover: (a) the abort belongs in `_invokeOnce`'s `finally` **after** the race settles — aborting inside `_drain`
  lets the timeout arm win and misreport `reason:'timeout'` (ARCH-111 says this; keep it verbatim in the DES);
  (b) `invoke()` at `:444-450` computes `attempts = effTimeout !== undefined ? 1 + retries : 1`, so **the
  `retryable === false` break is only reachable on a configured-timeout path** — the guard is still correct and
  still required, but the *test* must configure a timeout or it asserts nothing (T2-adjacent: a test that passes
  because the loop never ran twice anyway).
- **interface-contract:** `GatewayResult` failure arm gains `retryable?: false` and `error?: {kind: string; status:
  number | null; attempt: number}`; `AgentRecord.detail?: string` on `failed` only. `detail` is **redacted first,
  capped second** (`MAX_ERROR_DETAIL_BYTES = 1024`) — capping first can split a secret mid-string and defeat
  `redact()`'s value-exact match (INV-V26-5). `unmapped?: string[]` carries only the subtype, capped at 64 bytes and
  restricted to `[a-z0-9_.-]` with anything else replaced by `?`.
- **boundary — the unmapped counter needs THREE tiers, not two (verified against the installed SDK).**
  `_drain` handles exactly one `type:'system'` subtype (`api_retry`, after DES-171) while the installed
  `sdk.d.ts` declares **26** of them: `api_retry, commands_changed, compact_boundary, elicitation_complete,
  files_persisted, hook_progress, hook_response, hook_started, informational, init, local_command_output,
  memory_recall, mirror_error, model_refusal_fallback, model_refusal_no_fallback, notification,
  permission_denied, plugin_install, session_state_changed, status, task_notification, task_progress,
  task_started, task_updated, thinking_tokens, worker_shutting_down`. A counter over the whole complement fires on
  every run (`init` alone is emitted at session start) and becomes wallpaper within a day. But a flat allow-list is
  the opposite error: **four of those 26 are diagnostic signals of exactly the class REQ-122 exists for** —
  `model_refusal_fallback`, `model_refusal_no_fallback`, `permission_denied`, `mirror_error`. So the design is
  three tiers: **handled** (`api_retry`), **benign — named, skipped silently** (`init`, `compact_boundary`,
  `status`, `task_*`, `hook_*` and the rest of the routine chatter), and **counted** (everything else, including
  anything a future SDK version adds). The benign set is populated by a **Gate 5 read of the installed `sdk.d.ts`**
  and dated against that version — not from memory, and not from this file's list, which is a snapshot. The
  invariant that survives any SDK version bump is the assertion, not the list: **a healthy real run yields
  `unmappedMessages: {}`**, and a run that receives an unknown subtype yields a non-zero named count with a
  dashboard reader (INV-V26-6). Worth stating as a follow-on, not built here: the four diagnostic subtypes deserve
  real handling, and counting them is how v27 learns they exist.
- **tests:** UT — a 14-row table over `classifyApiError` (ten union members × the status fallback rows: `unknown/401`,
  `unknown/429`, `unknown/408`, `unknown/500`, `unknown/null`, plus a garbage string `'teapot'/418` → terminal and
  `'teapot'/null` → retry). UT — a fake session yielding three `api_retry(401)` and never a `result`: assert
  terminal **within 1 s of fake-clock time**, `events` length 1, `retryable:false`, `detail` non-empty. UT — the
  same fake session **with** an `onEvent` sink: assert the sink saw exactly one error event and the returned
  `events` array is empty (the duplicate trap). UT — `api_retry(503)` then `result:success` → ok, one retry event.
  UT — an injected `queryImpl` that records whether `options.abortController` was passed and whether `abort()` fired,
  run with **no** timeout configured (the `:462` gap). IT — `invoke()` with `timeoutMs` set and a terminal first
  attempt: assert `queryImpl` was called **once**. E2E/Gate 7.5 — a deliberately revoked OpenRouter key: terminal
  inside one attempt, `run_agent_log.events` non-empty, and **`ps aux | grep claude` shows no surviving CLI child**
  (the only real evidence the abort worked; ARCH-111's liveness claim is otherwise untested).
- **traps:** T1 (the current behaviour *is* a silent 4-minute no-op), T2 (fake clock + injected `queryImpl`, no spy
  on internals), T3 (a `reason:'timeout'` test that must be re-pointed, not left green).

### DES-172 — `providers.ts`: a closed union, one capability table with a `never` check, `validateAliases` listing EVERY offender

- **lens:** interface-contract (primary), boundary/error (boot refusal), testability.
- **signature:** `export const PROVIDERS = ['anthropic','openrouter','ollama'] as const; export type Provider =
  typeof PROVIDERS[number]; export function isProvider(v: unknown): v is Provider;
  export const PROVIDER_CAPS: Record<Provider, {tools:'all'; effort: EffortProfile | null; thinking:'sdk-default' |
  'budget-when-declared' | 'disabled'}>; export function validateAliases(aliases: Record<string, {provider: string;
  model: string}>) → {ok:true} | {ok:false; offenders: Array<{alias:string; provider:string}>; allowed: readonly
  Provider[]}`. Pure — **no SDK import, no `fetch`, no `process.env` read** — so both gateways, `composeConfig`,
  `models_list` and the guide builder can import it without dragging a transport in.
- **boundary — list every offending row, and say what to do.** The opposite call from DES-170, deliberately: the
  consumer is a human editing `rwe.config.json` under time pressure during a release, four rows are wrong on the
  production box today (`gpt4omini`, `gpt41mini`, `gpt41nano`, `gpt41`), and a first-offender-only message means
  four restart-fail cycles. Message shape (one string, all rows named, remedy included): *"unsupported provider
  'openai' on aliases gpt4omini, gpt41mini, gpt41nano, gpt41 — remove these rows. Allowed providers: anthropic,
  openrouter, ollama."*
- **interface-contract — the column rule, and where I hold the line.** ARCH-112's criterion (*a per-provider fact
  earns a column when two or more readers need it*) is right and I adopt it; the design's job is to enumerate the
  readers so the table cannot quietly grow. `effort` has five (`wireEffort`, `effortBodyFields`, `models_list`'s
  `effortDeclared`, the guide's alias table, and the `PROVIDER_CAPS`-totality drift lock). `keyEnv`, the request and
  response shapes, the catalog fetchers and the LiteLLM route emitter have **one reader each** and stay as
  `switch (provider)` with `const _never: never = provider` — the honest form for code. A fourth provider later is
  one union member plus the `Record` rows `tsc` then demands: no plugin interface, no capability probe, no
  deprecation window.
- **interface-contract — `resolveAlias` is the same seam and should move with it.** `effectiveProvider(aliases,
  model)` is called at `claude-agent-sdk-client.ts:479` today solely to feed `curateToolsForProvider`. That call
  site dies with DES-173, but the *function* is what REQ-125 needs (`transport` vs resolved `provider`) and what
  `wireEffort` needs. Move it into `providers.ts` as `resolveAlias(aliases, modelOrAlias) → {provider: Provider;
  model: string; proxyModel?: string} | undefined` and give it its own table test — otherwise the deletion takes a
  live function with it and the resolution logic is re-derived, differently, in two gateways (T3 in its most
  expensive form).
- **boundary — fail-closed at boot, with the ADR-042 escape hatch named.** `composeConfig()` throws with the full
  message. `main.ts --check-config` = `loadFileConfig()` + `composeConfig(cfg, {proxyManager: NOOP, listen:false})`
  → exit 0/1, **no proxy spawn, no port bind** (it runs on a box where the real service is up; binding would be a
  self-inflicted outage). `deploy/rwe-update.sh` runs it between the `npm test` gate and `write_result applied`,
  routes non-zero into the existing `revert_and_fail`, and records `configCheck: 'passed' | 'failed' | 'skipped'` —
  **`skipped` when `RWE_CONFIG_PATH` is absent from `/etc/rwe/update.env`, never a silent pass** (INV-V26-7).
- **tests:** UT — `validateAliases` table: all-valid; one bad; four bad (assert **all four** names in the message and
  the allowed list present); an alias whose provider is `'OpenAI'` (case) → offender; an empty map → ok. UT —
  `PROVIDER_CAPS` totality (`Object.keys` deep-equals `PROVIDERS`) — this is the drift lock that makes a future
  provider a compile *and* test failure. UT — `resolveAlias` table incl. an unknown alias → `undefined`. IT — a
  temp `rwe.config.json` with a `gpt41` row: `composeConfig` throws, message names it. IT — `--check-config` exit
  codes 0 and 1 against two temp configs, asserting no listener was opened (a port probe after the call). Gate 7.5 —
  ADR-042's ORDER observation: drive the updater against a config that still has a `gpt41*` row, expect
  `configCheck:'failed'` **and the service still on the prior version**; remove the rows, expect `applied`.
- **traps:** T1 (a boot check that logs and continues is the failure mode), T4 (the allowed-list literal in the
  message is interpolated from `PROVIDERS`, never typed twice).

### DES-173 — the deletion has a definition of done, and the test rewrites land FIRST

- **lens:** testability (primary), interface-contract.
- **why this is its own DES.** Four of REQ-123's acceptance clauses are *absence* clauses, and absence is the one
  thing the lower tier's usual instinct — "make the test pass" — satisfies by deleting the test. This item exists so
  the deletion has a checklist the reviewer can run rather than a paragraph they must interpret.
- **definition of done (each line is grep-checkable, comment-stripped for `src/` and raw for docs, following
  `no-retired-surface.test.ts`'s existing method):**
  1. identifiers gone: `NON_ANTHROPIC_EXCLUDED_TOOLS`, `curateToolsForProvider`, `STATIC_OPENAI`, `effortMapping`,
     `ProviderEffortProfile`, `thinkingFor`, `EFFORT_PROFILES`, `mapEffort`, `profileFor`, `sumUsageTokens`;
  2. provider literals `'openai'` and `'gemini'` gone from `src/` (both as `AliasMap` values and as `switch` arms);
  3. env names `OPENAI_API_KEY`, `OPENAI_API_BASE`, `GEMINI_API_KEY` gone from `src/`, `DEPLOY.md`, `README.md`,
     `rwe.env.example`, `rwe.config.example.json`;
  4. `generateLiteLLMConfig` emits no `openai` route — asserted **behaviourally** on a config containing only the
     three surviving providers, not by grep;
  5. the model catalog has no static OpenAI rows — asserted on `models_list` output;
  6. `DEPLOY.md`'s "self-hosted OpenAI-compatible endpoint" section is replaced by "local: Ollama; cloud:
     OpenRouter" (ADR-041 consequence (2) is a **capability loss**, so the doc must say what replaced it, not merely
     drop the section);
  7. every test file naming a retired identifier is either **rewritten to assert the new behaviour** or **deleted
     with its REQ trace re-pointed** — the list is enumerated in the task, not discovered.
- **boundary — the pairing rule (this is the whole point).** *Every grep guard is paired with one behavioural
  assertion.* Grep proves the name is gone; only behaviour proves the *effect* is gone. The two that matter:
  (a) `curateToolsForProvider` — pair the grep with `invoke()` on an **ollama** alias asserting the session received
  the caller's `allowedTools` **verbatim, including `Read`, with no `Bash` added** (this is REQ-123's own named
  acceptance and the one the deployment's default path actually runs); (b) `thinkingFor` — pair the grep with the
  three-way `wireEffort` assertion in DES-179, because deleting the function while leaving "always disabled"
  behaviour satisfies the grep and fails the REQ.
- **sequencing (the T3 control).** The rewrite of the ~18 test files that reference retired identifiers is a
  **separate, earlier task** than the source deletion. Reverse that order and the tests go red, the implementer
  deletes them, and the guard passes over a hole. State the order in `03-tasks.md` as a dependency, not as advice.
- **interface-contract — one honest scope limit, recorded not hidden.** The managed LiteLLM subprocess inherits
  `{...process.env}` by design (D-V2G8-1(c)). After v26 no *generated route* references the retired keys, so a
  stale `OPENAI_API_KEY` in an operator's `rwe.env` is inert but still *present in the child's environment*.
  REQ-123's "不再被引擎讀取或記載" is satisfied at the level of engine code, generated proxy config and docs;
  narrowing the child env is issue #22's hardening tracker. Say so in the DES so a reviewer does not read the grep
  guard as a stronger claim than it is.
- **tests:** the grep guard extended with the ten identifiers, two literals and three env names; the two paired
  behavioural tests above; `generateLiteLLMConfig` snapshot; `models_list` has no openai row; a docs test that
  `DEPLOY.md` contains the replacement sentence (T4 — the doc claim is asserted, not assumed).
- **traps:** T3 (the entire item).

### DES-174 — `deriveExpectedGraph` is TOTAL and returns a discriminated refusal; the scanner learns three new facts

- **lens:** interface-contract (primary), testability.
- **signature:** `deriveExpectedGraph(nodes: SkeletonNode[], scan: AgentCallScan) → {ok: true; graph: ExpectedGraph}
  | {ok: false; rule: 'AGENT_BEFORE_PHASE' | 'UNDECIDABLE_SHAPE'; line: number; label: string | null; message:
  string}`. **Never throws, for any input**, including a `null`, a truncated scan, or an empty array — `layoutGraph`
  consumes it on a dashboard request path where a throw is a 500 on someone's post-mortem, and `checkMermaid`
  consumes it on a registration path that must answer with a code. ARCH-113's `ExpectedGraph | {refused: ...}` is
  the right idea; making it a **discriminated `ok` union** matches every other result type in this codebase
  (`GatewayResult`, `validateAliases`, `validateSeedSpec`) and stops a lower tier writing `if (g.refused)` on a
  successful graph that has no such key.
- **interface-contract — the two consumers need different halves, and that is fine.** `checkMermaid` needs
  `lanes[].title/dynamic`, `slots[].labels/kind/tools`, `edges`. `layoutGraph` needs `lanes` (count + order) and
  `slots[].labels/kind` only — it never reads `tools`. One shape, two readers, no second type: INV-V26-3. But the
  **refusal is only actionable at registration**; at layout time a refusal means "this is a v1-contract script"
  and the layout falls back to its existing behaviour with a warning. Spell that out: same function, two different
  handlings of the same negative arm.
- **boundary — ARCH-113's rules L1/L2/S1–S4/T1/E1 are adopted verbatim and not restated here; two of
  them need a design correction, not a re-listing.** (i) `SkeletonNode.dynamic` means *the call sits inside a
  `for`/`while`/`if`/`.map` body* (`workflow-meta.ts:99/385`) — it does **not** mean "the phase title is computed".
  The two are routinely conflated and they drive different behaviour (a dynamic *title* still gets a lane, matched
  by position with `title: null`; a dynamic *node* forces the frame-grouped fallback). Say which is which in the
  DES or the layout's warning policy is written against the wrong predicate. (ii) S3's `alt` detection must state
  the depth rule it uses (`matchDelimiter`, same delimiter depth, one ternary or one `if/else`), because "the two
  arms" is ambiguous the moment a ternary nests.
- **interface-contract — `AgentCallScan` cannot supply what ARCH-113 asks of it, verified (HIGH).**
  ARCH-113 types the derivation as `deriveExpectedGraph(nodes, scan: AgentCallScan)` as though the scan already
  carried the facts rules T1 and S3 need. At HEAD it does not: `workflow-meta.ts:165-169` —
  `interface AgentCallScan { labels: string[]; calls: Array<{line: number; label: string}>; violations:
  AgentCallViolation[] }`. **No `allowedTools`** (so `tools[label]` is uncomputable and rule (12)
  `TOOLS_MISMATCH` cannot be implemented), **no character offset** (only `line`, so the skeleton↔scan join has
  nothing precise to join on), and **no grouping information** (so ternary/`if-else` arms cannot be collapsed into
  one `alt` slot). The scan therefore learns exactly three new facts, and this is a task in its own right, ahead of
  the derivation: `calls[].allowedTools?: string[] | 'absent'` (the literal array when the options object carries
  one, `'absent'` when it does not — the distinction rule T1 turns into `'default'`), `calls[].index: number` (the
  regex match offset `AGENT_CALL_RE.exec` already has at `workflow-meta.ts:287-289` and currently discards after
  computing `line`), and `calls[].group?: {kind:'parallel'|'alt'; id:number}` from the existing string-aware
  `matchDelimiter`. Adding a field to `AgentCallScan` also touches `scan-agent-calls.ts` (a re-export shim) and its
  existing unit test — cheap, but it must be *named*, or the derivation task starts by discovering it.
- **boundary — the join, which ARCH-113 leaves implicit and a lower tier will get wrong.** The skeleton
  (`workflow-meta.ts`) and the agent-call scan (`scan-agent-calls.ts`) are two independent passes over the same
  source. Joining them by *label string* breaks the moment two `agent()` calls share a label (legal, and common in a
  retry shape). **Join by character offset**: both passes already carry the match index; the design says so and a
  fixture with two identically-labelled calls in different phases proves it.
- **testability — the load-bearing property.** Fixtures are `(scriptSource, expectedGraph)` pairs with **no server,
  no engine, no database**, and the SAME fixture array is imported by the checker tests (DES-183) and the layout
  tests (DES-176). That shared corpus is what makes INV-V26-3 a test rather than a promise. Minimum 14 fixtures:
  linear 3-phase; `parallel` of 3; ternary; `if/else`; nested `workflow()`; `parallel` of `workflow()`; dynamic
  title; duplicate titles; duplicate labels; `allowedTools:[]`; no `allowedTools`; `agent()` before any `phase()`;
  a `switch` (→ existing `SCAN_VIOLATION`); an `agent()` inside a `for` body (→ `dynamic` lane).
- **traps:** T2 (fixtures are hand-written literals, never produced by running the function and pasting the output —
  say this in the task, it is the single most likely mid-tier shortcut here).

### DES-175 — the phase is stamped at IPC receipt, on BOTH hosts, and never enters the replay key

- **lens:** boundary/error (ordering), interface-contract (four signatures change).
- **signature chain (all four links must move together or the field is `undefined` at the end):**
  `SandboxHostConfig.currentPhase?: () => {title: string; index: number} | undefined` →
  `host.ts case 'agent'` reads it **synchronously, before the `Promise.resolve().then(handler)` deferral** →
  `AgentRequestHandler(prompt, opts, callSeq, phase?)` →
  `RunManager._handleAgentRequest(runId, prompt, opts, callSeq, framePath, phase?)` →
  `AgentExecutor.markQueued(agentId, label, phase?.title, framePath, phase?.index)` →
  `AgentRecord.phase?: string` + `AgentRecord.phaseIndex?: number` → the harness event descriptor carries both →
  `buildRecordsFromTranscript` reads both plus `startedAt` from the event `ts`.
- **boundary — why receipt-time, and the invariant that protects the money.** ARCH-114's verified reason stands
  (`case 'phase'` calls `onPhase` synchronously while `case 'agent'` defers to a microtask, and Node drains the
  `nextTick` queue containing both IPC messages before microtasks run, so a handler-time read stamps the LATER
  phase; reproduced 5/5 with a `fork()` probe). The design's job is to make the invariant **INV-V26-1** testable, not
  to re-argue it: `CallKey` must stay byte-identical to v25 — `phase` is **never** written into `key.opts`. Today's
  read is `key.opts.phase` at `run-manager.ts:1065`; the temptation to "just put it in opts" is enormous and the
  cost is that every pre-upgrade journal misses at `callSeq 0` on the first resume and **re-dispatches paid calls**.
  The test is a stored v25 journal fixture replayed under v26 asserting **zero** cache misses.
- **boundary — the nested host is not a footnote.** `run-manager.ts:1011` constructs the nested `SandboxHost` with
  `onAgentRequest` and `onWorkflowRequest` **only**. The top-level host at `:920-925` gets `onBudgetSnapshot`;
  the nested one does not. Under v26 both must get `currentPhase` (so a nested frame that calls no `phase()`
  inherits the parent's lane, which is ARCH-114's stated intent) **and** the nested one must finally get
  `onBudgetSnapshot` (DES-182). One edit, two config keys, two tests — and without it the "shared phase timeline"
  ARCH-114 describes is true for the top-level host only.
- **boundary — the resume-cache hole, stated so the acceptance cannot over-promise.** `_handleAgentRequest` returns
  from the resume cache at `run-manager.ts:1050-1056` **before** `markQueued` runs. A replayed call therefore gets
  no live phase stamp, by construction. That is ARCH-114's cohort (iii) and it is correct; the design must simply
  say that the replayed record's phase comes from `buildRecordsFromTranscript` (the harness event, if the original
  run wrote one) or from nothing (pre-v26 journals → frame-grouped fallback with a warning). What it must **not**
  do is move `markQueued` above the cache check to "fix" it — that would mint a duplicate record for every replayed
  call.
- **tests:** UT — a fake IPC channel delivering `{agent}` and `{phase}` in ONE chunk: assert the record carries the
  EARLIER phase (the exact ordering bug; without this the whole item is unfalsifiable). UT — a nested frame with no
  `phase()` call inherits the parent's `{title,index}`. UT — `CallKey` byte-identity: build a key under v26 and
  `deepEqual` it against a stored v25 literal. IT — replay a stored v25 journal fixture: **zero** misses. UT —
  `markQueued` records `phaseIndex:0` and `phase:'A'` for the first dispatch of a two-phase script.
- **traps:** T1 (a `currentPhase` supplied to the top-level host only *looks* wired and silently produces
  `undefined` on every nested frame), T2 (the ordering test uses a real `fork()`-shaped fake, not a stubbed
  scheduler).

### DES-176 — `layoutGraph` joins by lane ordinal; `inferPhase` repairs old snapshots at READ; three cohorts, stated

- **lens:** boundary/error (the cohorts), testability.
- **signature:** `layoutGraph(expected: ExpectedGraph, liveAgents: AgentRecord[], phases: PhaseView[], opts?:
  LayoutGraphOpts) → {cells, edges, warnings, truncated?}` (today: `layoutGraph(skeletonNodes, liveAgents, opts)` at
  `dashboard.ts:245`); `inferPhase(record: AgentRecord, phases: PhaseView[]) → {title: string; index: number} |
  undefined` — pure, the last `phases[i]` with `ts <= (record.startedAt ?? record.endedAt)`. `server.ts:507` passes
  `view.phases`.
- **boundary — the lane rule as a decision procedure, with the warning policy pinned per branch.** lane =
  `record.phaseIndex ?? inferPhase(record, phases)?.index`. Then: `k < lanes.length` **and** `!lanes[k].dynamic` →
  place in lane `k`, **no warning**. No index resolvable **and** the record precedes the first phase `ts` (or the
  run has no phases) → implicit lane 0, **no warning** (REQ-124 demands zero warnings on the existing production
  runs, and a v1-contract script may legally dispatch before its first `phase()`). `k >= lanes.length` (a nested
  frame pushing onto the parent timeline) → append a lane, **with** a warning. `lanes[k].dynamic` → frame-grouped
  fallback, **with** a warning. Every branch has a stated warning outcome; today's code (`dashboard.ts:285-287`,
  `const k = a.phase ?? ''`) warns on all of them, which is why 100% of runs are frame-grouped.
- **boundary — derive at read, write nothing.** `inferPhase` runs on a read of a pre-v26 **terminal snapshot**. A
  back-fill migration would open a second writer to a write-once snapshot; declined, and the declining is the design
  decision worth recording. The cost is that the repair is recomputed per request — for ~30 runs of ≤200 records
  this is microseconds, and `layoutGraph` is already `O(n)` with a `maxNodes` cap of 200.
- **testability — the acceptance oracle must be a real stored run, not a synthesised one.** REQ-124's own clause is
  *"正式機現有的 run(如 77f74018)`warnings` 為空"*. A synthesised fixture proves the algorithm; only a copy of a
  real pre-v26 snapshot proves the *cohort assumption* (that those records carry `startedAt` and their run carries
  timestamped `phases[]`). **Task obligation: copy one real terminal snapshot into `tests/fixtures/` at Gate 5**,
  redacted, and assert `warnings.length === 0` and the per-agent column. If the real snapshot turns out to lack
  `phases[]` timestamps, that is a Gate 4 discovery, not a Gate 7.5 surprise.
- **tests:** UT — the shared DES-174 fixture corpus × synthetic records: exact placement for the 3-phase linear,
  the `parallel`, the `alt` (one slot consumes one agent), the duplicate-title script (ordinal wins where string
  equality fails), the dynamic-title script (fallback + warning). UT — `inferPhase` boundary rows: `ts` exactly
  equal to a phase `ts` (inclusive → that phase), before all phases (→ `undefined`), after the last, empty
  `phases[]`. IT — the real stored snapshot, zero warnings. UT — a record with `phaseIndex` present **and** a
  contradictory `startedAt`: `phaseIndex` wins (precedence pinned).
- **traps:** T2 (the real-snapshot oracle), T3 (the existing frame-grouping tests must be re-pointed, not deleted —
  frame grouping is still the fallback and still needs coverage).

### DES-177 — the terminal record keeps what the harness resolved; `transport` is a new field, not a renamed one

- **lens:** interface-contract (primary).
- **signature:** `GatewayResult` (both arms) gains `transport: 'claude-agent-sdk' | 'direct-fetch'` and
  `proxyModel?: string`; `provider` becomes the **resolved** provider on both gateways (today the SDK path hard-codes
  `provider:'claude-agent-sdk'` at `claude-agent-sdk-client.ts:667/670/678/682` — four sites, all four must move) and
  `model` the resolved model id. `AgentRecord` gains `transport?` and `proxyModel?`. `capture()` writes
  `provider: prev?.provider || result.provider`, `model: prev?.model || result.model`.
- **boundary — fix it at the source, keep the executor rule as a net.** `capture()` already does the right thing
  for `model` on the failure arm (`model: prev?.model ?? ''`, `agent-executor.ts:273`) and the wrong thing on the
  success arm (`provider: result.provider`, `:259`). Making the gateway return resolved names is the fix;
  `prev?.x || result.x` is the net that also covers a **pre-harness terminal** (e.g. `ANTHROPIC_AUTH_MISSING`
  fails before `markHarness` ever ran, so `prev` is empty and the gateway's value is the only one there is).
  Both halves, stated, or a lower tier implements one and a test passes on the other.
- **interface-contract — the rename discipline.** Every existing test asserting `provider:'claude-agent-sdk'` on a
  **result** moves to `transport`. That is a mechanical rewrite with a large blast radius and it is the single
  easiest place in v26 to leave a test green on the wrong field (T3/T4 together): a test asserting
  `provider:'claude-agent-sdk'` will keep passing if the implementer sets *both* fields to the transport name. The
  drift test below is what stops that.
- **testability — one drift assertion, both gateways.** `harness.provider === record.provider ===
  usageEvent.provider` and the same for `model`, asserted on the SDK path and on the direct-fetch path, with a
  resolved provider that is **not** the transport name (`openrouter` / `google/gemini-3.8-flash`). A test using an
  anthropic alias proves nothing here, because `anthropic` and `claude-agent-sdk` are different strings only if you
  look.
- **tests:** UT — `markHarness(openrouter, gemini)` then `markDone({provider:'claude-agent-sdk', model:'gem'})` →
  record is `openrouter`/`gemini-…`, `transport:'claude-agent-sdk'` (REQ-125's own red test). UT — a pre-harness
  terminal: record carries the gateway's provider, no crash on `prev === undefined`. UT — the three-way drift
  assertion × two gateways. UT — `proxyModel` present on the LiteLLM route, absent on anthropic-direct.
- **traps:** T4 (the field rename), T3 (18-ish existing assertions).

### DES-178 — `ModelBook` with an injected clock and source; the pin is written in `RunManager.start()`, so trigger runs are tracked

- **lens:** testability (primary), interface-contract; **this is where owner ruling (2)+(3) lands.**
- **signature:** `class ModelBook { constructor(source: () => Promise<ModelEntry[]>, opts: {ttlMs?: number;
  clock: Clock}); snapshot(): Promise<BookSnapshot> }`; `BookSnapshot.lookup(provider: Provider, model: string) →
  BookEntry` where `BookEntry = {price: FourRates | null; caps: Caps}`, `FourRates = {in, out, cacheRead,
  cacheWrite}` in **USD per token**, `Caps = {reasoning: boolean|'unknown'; tools: boolean|'unknown'; source:
  'upstream'|'static'|'unknown'}`. Refresh at most once per TTL (default 1 h), **single-flight** (N concurrent
  callers share one `source()` promise), last-good retained in memory when `source()` throws.
- **interface-contract — the pin is a RunSpec-level fact written at the shared chokepoint.**
  `runs.price_book = {fetchedAt: string; source: 'live'|'last-good'|'static'; pinned: Record<'provider/model',
  BookEntry>}`, written **inside `RunManager.start()`** after the seed ladder and before `createRun` returns —
  *not* in `mcp-facade`. Verified callers of `start()`: `mcp-facade.ts:570` (run_start), `scheduler.ts:313`
  (resident), `server.ts:870` (cron/once), `webhook-registry.ts:302` (webhook). One site, four entrypoints, and
  ruling (3) is satisfied structurally rather than by four remembered edits.
- **boundary — the reachable set, and what happens when it is empty.** The set is `{effectiveParams.model} ∪
  {params.agents[*].model}`, static since ADR-029/REQ-091. If a model in it is unlisted, its entry is
  `{price: null, caps:{…'unknown'}}` — **the run is admitted** (ruling 1). If `source()` fails and no last-good
  exists, `source:'static'` and only the anthropic/ollama rows are priceable; still admitted. **There is no
  admission outcome that depends on pricing.** The pin is never empty: it always contains one entry per reachable
  model, even if every entry is `{price:null}`, because "we looked and found nothing" and "we never looked" must be
  distinguishable afterwards.
- **boundary — the ollama-is-free row is a priced row, not an unpriced one.** `ollama` → all-zero `FourRates`,
  `price` **not** `null`. Otherwise this deployment's default path marks every call `unpriced:true` and
  `meta.unpricedCalls` becomes a constant equal to the agent count — a counter that is always on is a counter
  nobody reads. Same reasoning for OpenRouter's missing cache rates: price them at the `prompt` rate (an upper
  bound, conservative for a spend limit) rather than dropping to `null`; a *parse failure* yields `null`, never 0.
  Both rules are one line each and both are asserted.
- **testability — the whole class is testable only because both dependencies are injected.** `source` is the
  already-injectable `config.modelCatalog`; `clock` is the existing `Clock` port (`src/clock.ts`). No `Date.now()`,
  no real fetch, in the class or in its tests. TTL, single-flight and last-good are otherwise untestable without
  real time and a real network — which is how they end up untested.
- **tests:** UT — TTL: two `snapshot()` calls inside the window → `source` called once; advance the fake clock past
  TTL → twice. UT — single-flight: 24 concurrent `snapshot()` against a deferred `source` → **one** invocation
  (the `parallel(24)` shape ARCH-116 is defending against). UT — `source()` throws after one good load → last-good
  returned, `source:'last-good'`. UT — throws with no prior load → `source:'static'`, anthropic rows still priced.
  UT — `lookup` table: anthropic static; ollama all-zero; openrouter full pricing; openrouter missing cache rates
  (→ prompt rate); openrouter malformed pricing (→ `null`); unlisted (→ `null`). IT — **`start()` writes
  `price_book` for a run created by a webhook trigger** (ruling 3's structural test — this one assertion is worth
  more than the other six for the owner's stated intent). UT — the static anthropic table's display strings
  (`"$5/1M"`) are **derived** from the numeric rates, one source, with a `reviewedAt` date beside it.
- **traps:** T1 (a pin written in the facade silently produces unpriced trigger runs), T2 (fake clock and fake
  source, never the real catalog).

### DES-179 — `wireEffort` is the single writer of `thinking` and `effort`, keyed by provider × the PINNED capability

- **lens:** interface-contract (primary), testability.
- **signature:** `wireEffort(provider: Provider | undefined, caps: Caps, effort?: Effort) → {thinking:
  Options['thinking']; effort?: Options['effort']; applied: EffortApplied}` — **total**, `applied` always present
  (not optional: "nothing was applied and here is why" is the answer REQ-126 asks for, and an optional field lets a
  lower tier omit it on the negative path, which is the only path anyone will debug).
  `EffortApplied = {applied: true; param: 'effort'|'thinking'; restPath: string[]; value: unknown} | {applied:
  false; reason: string}`.
- **boundary — ARCH-117's four arms stand; two things it leaves implicit are the design.** (i) The
  `openrouter` non-reasoning arm needs **two distinct reason strings** — "this model declares no reasoning" and
  "the catalog could not be read" are different operator actions, and one shared string makes a catalog outage look
  like a model limitation forever. (ii) `provider === undefined` (an unresolvable alias) is a real arm and it must
  land on `{thinking:{type:'disabled'}}`, the fail-safe: the v3 harness spike is unambiguous that qwen2.5:7b runs
  only with thinking off, so an unknown provider must inherit the safe wire shape, never the SDK default. `applied`
  is **non-optional** on every arm — "nothing was applied and here is why" is the answer REQ-126 asks for, and an
  optional field is one a lower tier omits on exactly the path anyone will debug.
- **interface-contract — `caps` must be threaded, and where from.** `GatewayClient.invoke(req)` gains `caps?: Caps`;
  the **executor** supplies the calling label's `BookEntry.caps` **from the run's pin** (INV-V26-4), never a fresh
  lookup at dispatch. Absent → `'unknown'` → the fail-safe branch. This is the only new parameter on `invoke` and it
  carries a pinned value, so a mid-run catalog change cannot alter a running workflow's wire shape.
- **boundary — `REASONING_BUDGET` is a claim about a third party and must be dated.** `{low:1024, medium:2048,
  high:4096, xhigh:4096, max:4096}` are the thresholds *the deployed LiteLLM version* translates into upstream
  `reasoning_effort`. That is a fact about someone else's code. The constant carries a comment naming the LiteLLM
  version it was pinned against and the Gate 7.5 observation that confirmed it, so a future failure is diagnosable
  as "the translation moved" rather than "effort is broken again".
- **testability — the honest limit, stated up front.** `result.usage` carries no `reasoning_tokens` through the SDK,
  so the *unit* tests can only assert the wire shape `wireEffort` produces. The real-tier evidence is a
  `--detailed_debug` LiteLLM capture grepping `reasoning_effort` plus an observable low-vs-high difference on a
  declared-reasoning OpenRouter model. Name that protocol in the DES so Gate 7.5 does not invent it under time
  pressure and settle for "it didn't crash".
- **tests:** UT — a 8-row table over `wireEffort` covering every arm incl. both `unknown` reasons and the
  `undefined` provider. UT — **UT-101's byte-identical anthropic request composition still passes** (the
  regression fence: v26 changes the *result* shape and the openrouter wire, not anthropic's request bytes). UT —
  `effortApplied` round-trips through the harness descriptor into `run_status` (it is already persisted, DES-106;
  the content changes, not the plumbing). UT — `models_list` rows carry `toolUseDeclared`/`effortDeclared`/
  `declaredSource` derived from the same snapshot, with `catalogFetchedAt` at top level.
- **traps:** T3 (three deleted effort tables — paired behavioural test per DES-173), T4 (`toolUse` →
  `toolUseDeclared` with **no alias window**, per the v24 ruling: every reader must move in the same commit,
  including the plugin repo's, which is a cross-repo release-note line).

### DES-180 — four-column `Tokens`, `priceCall` keeps `null`, the record does not: `costUSD: number` + `unpriced: boolean`

- **lens:** interface-contract (primary), boundary/error; **this is where owner ruling (1) lands.**
- **signature:** `type Tokens = {input: number; output: number; cacheRead: number; cacheWrite: number}`;
  `priceCall(tokens: Tokens, rates: FourRates | null) → number | null` — pure, `Σ tokens[k] × rates[k]`, `null`
  when `rates === null`. At the ONE capture site: `const priced = priceCall(t, pin.price); const costUSD = priced ??
  0; const unpriced = priced === null;`. Persisted on the usage event and on `AgentRecord`: `tokens: Tokens`,
  `costUSD: number`, `unpriced: boolean`. **`null` never reaches SQLite, the MCP wire, the fold or the dashboard.**
- **interface-contract — why the collapse, argued.** The struck ADR-038 needed `null` to *mean* unpriced; the ruling
  replaced that meaning with a charge of 0 and an explicit flag, so a nullable number is now a second encoding of a
  fact a boolean already carries. Three concrete costs of keeping it: (a) `Σ costUSD` over records needs `?? 0`
  at every summing site and each one is an unaudited decision; (b) SQLite `REAL NULL` vs `0.0` makes every
  dashboard/`run_result` reader branch; (c) the *oracle* for a test becomes ambiguous — is `costUSD` absent because
  unpriced, because pre-v26, or because the implementer forgot? Two-valued removes all three. `priceCall` keeps
  `null` because "I cannot price this" is genuinely its answer and collapsing inside the pure function would hide
  the very fact the flag reports.
- **boundary — the token extraction, per transport, with what is dropped named (ADR-046 / INV-V26-6).** SDK:
  `msg.usage` is `NonNullableUsage` (verified `sdk.d.ts:3995`) carrying `input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens` — today only the first two are read
  (`claude-agent-sdk-client.ts:673`). Fallback when `usage` is absent: sum `modelUsage[*]`, whose fields are
  **camelCase** (`inputTokens`/`outputTokens`/`cacheReadInputTokens`/`cacheCreationInputTokens`, `sdk.d.ts:1221-1230`)
  — a different spelling in the same result object, and exactly the kind of thing a lower tier gets half right.
  Direct-fetch OpenRouter: `prompt_tokens_details.cached_tokens` and `cache_write_tokens`. Ollama: cache columns 0.
  **Named drop:** `BetaUsage.cache_creation` carries a per-TTL breakdown (5-minute vs 1-hour writes, priced
  differently by Anthropic); v26 prices the flat `cache_creation_input_tokens` at one rate. That is an
  approximation, it is stated in a comment beside the projection per ADR-046, and it is bounded (it can only
  under-charge 1-hour writes).
- **boundary — `unpriced` counts only `done`.** A `failed` call carries no usage and moves no counter (an outage
  must not inflate `unpricedCalls`). Absence of `unpriced` on a persisted record means *pre-v26*, and `foldUsage`
  counts those as unpriced — one meaning per state.
- **interface-contract — the free cross-check nobody should store.** `SDKResultMessage.total_cost_usd` and
  `modelUsage[*].costUSD` exist (verified). They are Anthropic-priced and wrong through LiteLLM→OpenRouter, so they
  are **not** a field. They are a Gate 7.5 assertion on the anthropic path: our computed `costUSD` within an order
  of magnitude of the SDK's own. Free, and it catches a rates-per-million-vs-per-token error, which is the most
  likely arithmetic mistake here by a factor of ten.
- **tests:** UT — `priceCall` table: all four columns non-zero; zero tokens; `rates:null` → `null`; a rate of 0
  (ollama) → 0 **not** null. UT — the SDK extractor on a real-shaped `result` fixture with all four columns; on one
  with `usage` absent and `modelUsage` present (camelCase fallback); on one with neither (→ zeros, `unpriced` follows
  the rates, not the tokens). UT — the collapse: `priced === null` → `{costUSD: 0, unpriced: true}`. UT —
  "correct to the cent": 1000 calls of ~1e-3 USD, assert the total to 2dp (floats are fine; ~1e-16 accumulated
  error). UT — a `failed` call moves no counter. **Grep guard: `PRICE_UNKNOWN` appears nowhere in `src/`,
  `tests/`, `docs/`** (T3 — it was designed, then struck, and it is written down in three panel files on disk).
- **traps:** T1, T3, T4.

### DES-181 — `parseBudget` is the one door; the schema keeps `null`; `RunGuard` holds two limits and accumulates even when both are absent

- **lens:** boundary/error (primary), interface-contract; **this is where owner ruling (3) becomes an assertion.**
- **signature:** `parseBudget(v: unknown, opts: {source: 'wire' | 'store'}) → {usd: number | null; tokens: number |
  null}` — `source:'wire'`: `null`/`undefined` → both null (**unbounded**); an object → validated; a **number →
  throw `INVALID_ARGUMENT`** naming the unit change. `source:'store'`: a number → `{usd:null, tokens:n}` (its true
  v25 meaning), everything else as above. One function, one `never` over the three arms, two callers with an
  explicit flag — not two functions that drift, and not one function that guesses from context.
- **interface-contract — the schema must accept `null` (HIGH).** `tool-specs.ts:352` today:
  `budget: {type:['number','null'], description:'Total token budget … Omitted or null means unbounded.'}`.
  ARCH-118's `{usd?, tokens?}` + `minProperties:1` alone **refuses `budget: null`** — a value the engine's own
  published description instructs callers to send, and the exact spelling of the owner's "不設就是沒有上限".
  v26 schema: `anyOf: [{type:'null'}, {type:'object', properties:{usd:{type:'number', minimum:0},
  tokens:{type:'integer', minimum:0}}, additionalProperties:false, minProperties:1}]`, description rewritten to state
  **USD** for `usd`, the four-column sum for `tokens`, that either may be omitted, and that a bare number is now
  refused. `types.ts:258` (`budget?: number | null`) widens to `number | {usd?: number; tokens?: number} | null` —
  the `number` arm survives **only** because persisted rows contain it.
- **boundary — the accumulation property, which the ruling makes load-bearing.** Today `addTokens(delta)`
  (`run-guard.ts:82`) accumulates unconditionally and `assertBudget()` (`:103`) is the only thing that reads
  `total`. v26 keeps exactly that split: `addUsage(tokens: Tokens, costUSD: number)` accumulates `_spentUsd`,
  `_spentTokens` and `_unpriced` **whether or not either limit is set**, and `assertBudget()` throws
  `BudgetExceededError({limit:'usd'|'tokens', spent, total})` when **either** armed limit is met. The obvious
  mid-tier shortcut — `if (this.total === null) return;` at the top of `addUsage` — is a silent no-op that satisfies
  every budget test and destroys the owner's tracking principle for every unbudgeted run, which after ruling (2) is
  **every trigger-started run**. Hence the negative test below.
- **boundary — the accessors, honestly.** Script-visible `budget`: `total`/`spent()`/`remaining()` in **USD**, plus
  `tokens(): Tokens & {limit: number | null}`. `remaining()` → `null` (not `Infinity`) when no USD limit exists;
  **`total` → `null` under the same condition** — the two are one accessor pair and treating them differently is
  the same confident-wrong-value defect one field over. `null` is `=== null`-detectable and biases the common
  `remaining() > X` shape fail-SAFE (always false); it is **not** comparison-safe (`null < 1000` is `true`), so it
  ships **with** the guide sentence naming which accessor answers which limit (DES-186), not instead of it.
- **tests:** UT — `parseBudget` table × both sources: `null`, `undefined`, `{usd:1}`, `{tokens:5}`, `{usd:1,
  tokens:5}`, `{}` (→ refused, `minProperties`), `{usd:-1}`, `{usd:'1'}`, `200000` (wire → `INVALID_ARGUMENT`
  naming USD; store → `{tokens:200000}`), `{usd:1, extra:2}` (→ refused). UT — `run_start({budget:null})` is
  **accepted** and yields an unbounded run (the regression this item exists for). UT — `RunGuard` two-limit matrix:
  usd only / tokens only / both / neither, each × under-limit and at-limit, asserting which `limit` the error names.
  **UT (the ruling's negative test) — a run with `budget: null` executes two agents and `meta.usage` reports
  non-zero `tokens` and `costUSD`.** UT — `foldUsage(events)`: a v25 two-column event folds with `cacheRead/Write:0`
  and `unpriced += 1` and is **never re-priced** against today's catalog; **its oracle is a literal from a stored
  v25 journal fixture, never `sumUsageTokens()`** — that function is being deleted (T2+T3 in one line). UT —
  `assertBudget` still throws *before* dispatch and after `acquireSlot` (the v25 position at
  `run-manager.ts:1068-1075` is load-bearing and must not move).
- **traps:** T1 (the `if (!total) return` shortcut), T2 (the fold oracle), T4 (the schema description).

### DES-182 — the sandbox budget wire is three fields and both hosts must carry them

- **lens:** interface-contract (primary), boundary.
- **signature:** IPC `start` message `budgetTotal: number | null` → `{usd: number | null; tokens: number | null}`;
  IPC `agentResult.spent?: number` → `{usd: number; tokens: number}`; `SandboxHost.run(runId, script, args, budget:
  {usd, tokens} | null)`; `SandboxHostConfig.onBudgetSnapshot: () => {usd: number; tokens: number}`;
  `child-entry.ts`'s `budget` object rebuilt on those two shapes.
- **boundary — the nested-frame hole, verified.** `run-manager.ts:920-925` gives the top-level host
  `onBudgetSnapshot`; `:1011-1023` gives the nested host **neither** `onBudgetSnapshot` nor (under v26)
  `currentPhase`, while passing `entry.guard.budgetView().total` for the limit. So inside a nested `workflow()`
  frame today, `budget.spent()` returns 0 forever and `remaining()` returns the full total — a confident wrong value
  that v26 turns into a wrong *money* value. One added config key on one constructor. (This also corrects a stale
  `state.yaml.tech_stack` sentence calling the child accessors "hard-coded stubs": they are live at the top level
  via the `spent` piggyback and stubbed **only** in nested frames — worth fixing in the same pass so the next reader
  is not misled in the opposite direction.)
- **boundary — the honesty line stays.** These accessors are **live, not resume-stable**: a branch on `spent()`
  changes the next prompt, misses the replay key on resume and re-executes from that call at real cost. That is a
  guide sentence (DES-186), and it is the reason not to "improve" the accessors further.
- **tests:** UT — a nested frame's `budget.spent()` reflects a parent-run agent's spend (currently 0). UT — the IPC
  shapes round-trip both directions. UT — `budgetTotal: null` in the child → `total === null`, `remaining() ===
  null`. UT — `Object.keys(createSandboxContext(...))` deep-equals `SANDBOX_GLOBALS` (shared with DES-186).
- **traps:** T1.
- **constraint the task must carry:** the sandbox child loads `.ts` sources directly and **does not resolve local
  `.js`→`.ts` value imports**; a file the child loads (`guards.ts`, `child-entry.ts`) must not gain a new local
  *value* import — inline the constant or export it from a file the child already loads. ARCH-121 says "exports
  only" for exactly this reason; repeat it in the task or it will be rediscovered by a failing child process.

### DES-183 — `checkMermaid` v2: the three mechanics that decide whether ARCH-119's rules work, and `diagram_contract` as the gate

- **lens:** boundary/error (primary), agent altitude (a cold model reads every refusal).
- **signature:** `checkMermaid(src, scriptLabels, agentDefaults, limits, v2?: {expected: ExpectedGraph})` — steps
  (1)–(9) unchanged; `v2` present adds (10)–(13). Refusal envelope: `{rule, line, expected: <lane|slot|edge as
  JSON>, message}`. **Never a corrected diagram** (settled at Gate 2; the structure-as-JSON is strictly more useful
  to a model that must write the Mermaid anyway, and handing back passing text kills REQ-111 by convenience).
- **boundary — ARCH-119's four v2 rules are adopted as its `api:` states them — (10) `DIAGRAM_DIRECTION`,
  (11) `LANE_MISMATCH`, (12) `TOOLS_MISMATCH`, (13) `EDGE_MISMATCH`, alongside the unchanged steps (1)–(9). Three
  mechanics decide whether they work.**
  (i) **Order:** `DIAGRAM_DIRECTION` is checked before anything structural — a TD diagram's lanes are meaningless,
  and reporting `LANE_MISMATCH` on one sends the author to the wrong fix. (ii) **`tools: default` is SKIPPED
  ENTIRELY, never partially compared** — a partial compare turns "default" into a trap for the one author who wrote
  the resolved list out. (iii) **Every refusal carries `{rule, line, expected: <the lane/slot/edge as JSON>,
  message}` and `see: 'workflow_authoring_guide'`** — the expected STRUCTURE as data, never corrected Mermaid
  (settled at Gate 2: structure is strictly more useful to a model that must write the Mermaid anyway, and handing
  back passing text kills REQ-111 by convenience).
- **interface-contract — the contract column is the gate, and it is read before the check.** `workflow_versions
  .diagram_contract TEXT` (`ALTER TABLE … ADD COLUMN`, `NULL ⇒ 'v1'`); every v26 registration writes `'v2'` and is
  checked with `v2`; a `'v1'` row is **never re-checked, never deleted, renders as before**;
  `workflow_describe` exposes `diagramContract`. Version rows are immutable (ADR-025), so no v1 row can drift into
  needing a v2 check.
- **boundary — the ADR-039 refusals are part of the contract, not an implementation detail.** Five constructs the
  regex skeleton cannot decide are refused at registration with a line and an actionable message: an `agent()`
  before the first `phase()`, an `agent()` inside a loop body, an `agent()` reached through a helper, a `switch`,
  and a `parallel()` of `workflow()` calls. Each needs its own message; "SCAN_VIOLATION" alone fails REQ-117's
  first-try bar.
- **tests:** UT — ≥1 negative fixture per v2 code producing exactly that code (four minimum), plus a positive for
  each construct. UT — the **shared DES-174 fixture corpus** drives both this and DES-176 (INV-V26-3 as a test).
  UT — a `'v1'` row with a `graph TD` diagram passes untouched after the upgrade. UT — `ERROR_CATALOG` covers every
  code any validator emits and every authoring-side code has a non-null `see` (this is the catalog test that
  DES-170's hint rewrite must land before, or it passes on the old generic row). IT — register → `workflow_describe`
  reports `diagramContract:'v2'`. Gate 7.5 — REQ-128's cold-model first-try registration.
- **traps:** T4 (the guide's "逐邊比對" sentence becomes true only when (13) ships — the description and the thing
  must move in the same commit).

### DES-184 — the guide examples ARE the v2 conformance corpus

- **lens:** testability (primary), agent altitude.
- **content:** all ten `GUIDE_EXAMPLE`s are rewritten as LR swimlanes, and the corpus is extended so that **every v2
  construct and every ADR-039 narrowing has at least one example that registers GREEN against a booted engine**:
  phase lane, `parallel` slot, `alt` slot, `tools: none`, `tools: default`, dynamic title, nested `workflow()`
  rectangle, plus the five refusal constructs demonstrated in their *legal* rewritten form. That is ~12 examples.
- **why it is a DES and not a doc chore.** This converts five prose caveats (ADR-039's "cost accepted") into five
  executable tests, and it is the only mechanism that keeps the guide honest as the checker tightens: an example
  that stops registering is a red test, not a support ticket. The existing harness that registers every
  `GUIDE_EXAMPLE` against a booted engine already exists — this extends its corpus, it does not build machinery.
- **tests:** IT — every `GUIDE_EXAMPLE` registers with no refusal (the corpus test). UT — the four negative fixtures
  from DES-183 are *not* in the guide (a negative example that a model might copy is worse than none).
- **traps:** T4 (documentation that stops matching the checker is the exact failure REQ-128 was filed for).

### DES-185 — `dagBox` is pure and exported; one `.zoomable` wrapper serves both figures

- **lens:** testability (primary).
- **signature:** `dagBox(cells: LayoutCell[], box = {cellW:140, cellH:44, gap:14}) → {width: number; height: number}`
  — pure, exported from `dashboard.ts`, interpolated into the page. The client sets `viewBox="0 0 W H"`,
  `width="100%"`, `preserveAspectRatio="xMinYMin meet"` and **drops the absolute `width`/`height`**
  (`dashboard-page.ts:394-403`). One `.zoomable` wrapper applied to **both** `#diagram-img` (the author's SVG, still
  an `<img>` per REQ-119) and `#dag-graph`: wheel → scale about the cursor clamped 0.25–4, drag → translate, a `fit`
  button resets and re-fits on `resize`; `#diagram-img{max-width:100%}` (`:117`) becomes the fit state rather than a
  hard cap. No library, ~40 lines.
- **boundary:** view-layer only — no stored diagram is touched, which is what gives pre-v26 `graph TD` diagrams the
  same treatment (REQ-129's own clause). The DAG keeps `createElementNS` + `textContent` for every run-derived
  string (ADR-044): a CSS transform on an `<img>` executes nothing, so the anonymous route gains no author-text path.
- **tests:** UT — `dagBox` table incl. empty cells (→ a minimum box, not `0×0`, which would make the SVG vanish) and
  a 9-agent 5-phase layout. UT — page-source assertions (`setAttribute('viewBox'`, `.zoomable`, absence of an
  absolute `width=`). Playwright in the existing `val-018` acceptance tier — the 11-node TD diagram and the wide run
  readable at 1100 px, plus a wheel-zoom and a `fit` reset (the "一眼可讀" clause is a picture; only a screenshot
  settles it).
- **traps:** T1 (a `viewBox` added while the absolute `width` stays wins nothing — assert the absence too).

### DES-186 — the guide's five gaps are rendered from exported constants, each with a drift lock that EXECUTES the thing

- **lens:** agent altitude (primary), testability.
- **content:** ARCH-121's five sections (a)–(e) are adopted as written and not restated. Three additions
  the design owes them: (i) each guarded call in `DETERMINISM_GUARDED` carries `{call, why, instead}` as *data*,
  not prose — `why` = "resume replays `agent()` keyed by prompt+opts, so a wall-clock or random value changes the
  key and re-dispatches paid calls", `instead` = timestamps from `run_status`/`run_result` or via `args`, a seed via
  `args`, and the fact that `new Date('2026-01-01')` **with** an argument is allowed (the single most likely thing a
  cold model gets wrong after reading only "Date is banned"); (ii) the budget section keeps the v25 sentence *"a
  budget is a stop-dispatching signal; in-flight calls may overshoot by concurrency × one call"* now stated **per
  limit**, and names which accessor answers which limit; (iii) one honesty line: the script-visible accessors are
  **live, not resume-stable** — a branch on `spent()` changes the next prompt, misses the replay key on resume and
  re-executes from that call at real cost. `run_start`'s tool description carries the seed shapes and the budget
  unit; `docs/AUTHORING.md` is regenerated from the same builder.
- **boundary — the guide must not overclaim.** The determinism guard is **hygiene, not a security boundary**;
  `guards.ts` disclaims it and the guide must not upgrade it.
- **testability — a drift lock is only a lock if it executes.** Four, each of which fails when the code moves:
  `Object.keys(createSandboxContext(...))` deep-equals `SANDBOX_GLOBALS`; **every `DETERMINISM_GUARDED.call` really
  throws `DETERMINISM_GUARD` in a real `vm` context** (a list-vs-list comparison would pass over a guard someone
  removed); `PROVIDER_CAPS` is total over `Provider`; `docs/AUTHORING.md` is byte-diff-locked to the builder output.
  A fifth is a *text* assertion and is worth naming because REQ-130's red test is exactly it: the rendered guide
  contains the strings `DETERMINISM_GUARD` and `seedManifest`.
- **traps:** T4 (the whole item), T2 (the vm-executing lock instead of a list compare).
- **acceptance:** the REQ-117 cold-model probe at Gate 7.5. By the standing v24 ruling **any first-try failure is a
  DOCUMENTATION defect**, fixed then re-run against a fresh instance.

### DES-187 — the public shapes are pinned as literal fixtures, and the cross-repo check has a named owner

- **lens:** interface-contract (primary), testability.
- **content:** one fixture file holding the **literal expected JSON** of `run_status.agents[]`, `run_result.meta`,
  the usage transcript event, the `INVALID_SEED_SPEC` envelope and one v2 diagram refusal envelope, asserted by
  deep-equality after a scripted run. v26 changes eight public shapes at once (four-column `tokens`, `costUSD`,
  `unpriced`, `transport`, `proxyModel`, `phase`/`phaseIndex`, `detail`, `meta.usage`/`unpricedCalls`/
  `unmappedMessages`); asserting them field-by-field across nine test files guarantees three of them are asserted
  nowhere. A literal fixture is one oracle, external to the code, and it is the cheapest defence against T4.
- **cross-repo (one check, three items, before shipping):** (1) `push_workspace.py` sends exactly
  `{path, contentB64}` or `additionalProperties:false` stays off `seed.items`; (2) any plugin reader of
  `models_list.toolUse` moves to `toolUseDeclared`; (3) any plugin caller sending `budget: <number>` moves to
  `{usd}`/`{tokens}`. The plugin repo has no SDLC ledger, so this is one Gate 5 read + one Gate 7.5 observation +
  one release-note line, assigned to a person, not implied.
- **also here:** the `PRICE_UNKNOWN` absence grep (DES-180) and a `migration` paragraph in the release notes naming
  the three breaking changes in one place (`budget` object, `toolUse` rename, `seed.items` strictness) — three
  breaking MCP changes in one release with no deprecation window is a decision that deserves one paragraph a human
  can read.

### DES-188 — ADR-047 is RULED, so the ledger amendment is the whole obligation (doc-only, no code)

- **lens:** interface-contract (the ledger is an interface between iterations).
- **content:** ruling (2) is (b) — trigger-started runs carry no spend limit. Therefore **no code is written**:
  no `budget` on `schedule_create`/`webhook_create`, no `budget` column on a trigger row, no forwarding through
  `start()`, and explicitly **no "server-level default cap"** (D-V2h's own suggestion, which neither panel proposed
  and nobody has asked for). What must happen is that three ledger rows stop asserting a control that does not
  exist: `04-design.md:832` (the per-arm budget type), `:1156` (D-V2h, marked *Resolved*), and the overlap-allowed
  accepted risk that cites *"per-run budget"* as its compensating control. All three are corrected to state that
  trigger-started runs are unbounded by owner ruling of 2026-09-08, that the compensating control is **spend
  recording and post-hoc query**, not a cap, and to point at REQ-127 and ADR-047.
- **why it is a DES row and not a note.** A design document asserting a control that does not exist, with an
  accepted risk leaning on it, is ADR-046's own bug class one altitude up — a projection of reality with a silent
  default. It is also the only v26 work item that produces no code, which is precisely why it gets dropped unless it
  has an ID.
- **tests:** none (doc). The Gate 8 check is that no ledger row still claims a trigger budget — one grep for
  `per-run budget` in `04-design.md`.

---

## Task partition — where my lenses need the synthesizer to cut (`03-tasks.md` has no v26 rows yet)

The GATE 3+ directive asks for a partition **finer than usual** because the implementers are a lower tier. Nine
cuts my lenses actually depend on:

1. **The deletion is its own task, and it lands AFTER the test rewrites** (DES-173). Sequencing it first makes the
   suite red, and the cheapest way to green is to delete the tests — which is the exact T3 failure the directive
   names. The task carries the seven-line definition of done and the enumerated list of test files.
2. **`providers.ts` is one task and it lands FIRST** (DES-172). Six later items import it (`wireEffort`,
   `effortBodyFields`, `models_list`, the guide table, `composeConfig`, `--check-config`); building it late means
   six half-implementations against a moving table.
3. **The phase stamp (DES-175) and the layout (DES-176) are two tasks.** One is an IPC-ordering change across four
   files with a byte-identity invariant on `CallKey`; the other is a pure function over fixtures. Merging them
   produces a single PR where the layout tests pass on synthesised records and the ordering bug ships.
4. **The money seam is three ordered tasks:** `ModelBook` + the pin in `start()` (DES-178) → four-column tokens +
   `priceCall` + the `costUSD`/`unpriced` collapse (DES-180) → `parseBudget` + `RunGuard` + the schema + the IPC
   wire (DES-181/182). Each is independently testable and each depends on the previous one's type existing. Doing
   them as one task means the guard is written against a `Tokens` type that is still `{input, output}`.
5. **The `AgentCallScan` extension precedes `deriveExpectedGraph`, and the fixture corpus ships with it** (DES-174).
   Three fields on the scan (`allowedTools`, the match `index`, the `parallel`/`alt` group) are a prerequisite for
   two of the four v2 diagram rules; the derivation task cannot start against today's scan type. The corpus is what
   the checker task and the layout task both consume; if it arrives late they each grow their own.
6. **`checkMermaid` v2 (DES-183) and the guide corpus (DES-184) are separate tasks with a hard dependency** — the
   examples cannot be rewritten until the checker's rules are final, and the checker cannot be declared done until
   the examples register green.
7. **DES-188 is a doc-only task with an ID.** It produces no code and will otherwise evaporate.
8. **DES-187's cross-repo check is a task with a person on it**, scheduled before the release note, because it gates
   whether `additionalProperties:false` ships at all.
9. **The `null`-accepting budget schema (DES-181) is called out inside its task's acceptance**, not left as a
   sub-bullet: it is a one-line `anyOf` and a whole class of client breakage.

**Test-count target for Gate 5** (the directive's "larger in COUNT"): ~50 new or rewritten unit cases named above
(the tables alone: 12 seed rows, 14 classifier rows, 8 `wireEffort` rows, 10 `parseBudget` rows, 7 `priceCall` rows,
6 `lookup` rows, 6 `validateAliases` rows, 14 graph fixtures), ~10 integration cases, 2 Playwright assertions, and
6 Gate 7.5 real-tier paths (§below). Counting only tests whose oracle is **external** to the code under test — a
fixture literal, a real `vm`, a real filesystem, a real registration, a stored snapshot.

---

## Risks

1. **(HIGH) The synthesizer derives DES rows from the stale architecture body.** §A is the mitigation; the risk is
   real because the body is 400 lines and the rulings are two `owner_decision:` fields inside it. If one stale spot
   survives into `04-design.md`, a lower-tier implementer builds `PRICE_UNKNOWN` and a test goes green on a refusal
   the owner struck out.
2. **(HIGH) The pin lands in the MCP facade.** Everything about ARCH-116's prose points at `run_start`. The result
   passes every test anyone would naturally write (all of which start a run through `run_start`) and silently fails
   ruling (3) for cron, resident and webhook runs. The mitigation is one integration test that starts a run through
   the **webhook** path and asserts `price_book` is present.
3. **(HIGH) The deletion takes a live function with it.** `effectiveProvider` exists today *only* to feed
   `curateToolsForProvider`; removing the caller makes the function look dead exactly when REQ-125 and REQ-126 start
   needing it. DES-172 moves it into `providers.ts` in the same task for this reason.
4. **(MEDIUM) `REASONING_BUDGET` is a claim about LiteLLM's translation.** If the deployed LiteLLM version maps
   thresholds differently, `effortApplied:{applied:true}` is recorded while the upstream request carries no
   `reasoning_effort` — a confident wrong value with a passing test. Mitigation: the constant is dated against a
   version, and Gate 7.5's evidence is a proxy capture, not an inference from the record we ourselves wrote.
5. **(MEDIUM) The `alt`-slot detection is the least decidable rule in DES-174.** Ternaries nest, and
   `matchDelimiter` is string-aware but not an AST. False refusals are possible; ADR-039 accepts this and makes the
   cold-model probe the arbiter. The design's mitigation is that the refusal names the line and carries the expected
   structure, so a false refusal is one edit away from correct rather than a mystery.
6. **(MEDIUM) Three breaking MCP changes in one release, no deprecation window.** `budget` shape, `toolUse` rename,
   `seed.items` strictness. The plugin client is a separate repo. Mitigation: DES-187's cross-repo check plus one
   migration paragraph; the residual risk is any third-party caller nobody knows about, which is accepted (the
   deployment is single-owner).
7. **(MEDIUM) `unpricedCalls` becomes wallpaper if ollama counts as unpriced.** Mitigation is DES-178's rule that
   ollama is *priced at zero*, asserted by a unit test — otherwise the counter equals the agent count on this
   deployment's default path and stops carrying information on day one.
8. **(LOW→MEDIUM) The real pre-v26 snapshot may not carry what `inferPhase` needs.** REQ-124's zero-warning clause
   is stated over real production runs; if those records lack `startedAt` or their runs lack timestamped `phases[]`,
   the cohort (ii) promise cannot be kept. Mitigation: copy a real snapshot into fixtures at **Gate 5**, not at
   Gate 7.5 — turning a validation surprise into a design fact.
9. **(LOW) The 1024-byte `detail` cap interacts with `redact()`.** Redact first, cap second (INV-V26-5). Reversing
   them can split a secret across the cut and defeat the value-exact match. Stated in the DES; a test with a secret
   at byte 1020 is cheap and worth having.

---

## Conflicts between my three lenses (argued, with the Karpathy tie-break)

The brief asks me to surface these rather than present a smoothed consensus. Six real ones:

1. **Refuse the FIRST offender (DES-170) vs list EVERY offender (DES-172).** Boundary/error wants completeness
   everywhere; interface-contract wants one envelope shape for one code; testability prefers first-failure
   determinism (a list's ordering becomes an assertion nobody wanted). **Resolved by the consumer, not by a
   principle:** a cold model repairing one `seed` element at a time gets the first (and the second element's
   validity is unknowable once the first is malformed); a human editing four config rows during a release gets all
   four, because the alternative is four restart-fail cycles. The rule I would write down: *enumerate when the
   consumer can act on all of them at once; refuse first when acting on one changes the rest.*
2. **`number | null` internally vs two-valued on the wire (DES-180).** Boundary wants "cannot price" preserved as a
   distinct value all the way out; interface-contract wants one type end-to-end; testability wants an oracle with no
   third state. **Karpathy tie-break: the smallest design that keeps the fact.** `null` survives exactly one hop —
   inside `priceCall` — and collapses at the single capture site into `{costUSD: number, unpriced: boolean}`. The
   fact is kept, the nullable arithmetic is not.
3. **Totality vs refusal in `deriveExpectedGraph` (DES-174).** Testability wants a total function that never throws
   (it runs on a dashboard read path); boundary wants line-pointed refusals; interface-contract wants one return
   type. **Resolved by a discriminated union, and by giving the two consumers different handlings of the same
   negative arm** — at registration a refusal is an error code, at layout it means "v1-contract script, fall back".
   The alternative (throw, catch at the caller) puts the error semantics in two places.
4. **Telling vs storing, for an unenforceable USD cap.** After ruling (1) a run may carry `budget.usd` while a
   reachable model has no price — the cap will never fire, and nothing tells the caller. My boundary lens wanted an
   admission-time warning channel (`meta.warnings[]`, or a `run_start` response field). My interface-contract lens
   objects that the fact **is already stored**: `price_book.pinned[*].price === null` says exactly this, at
   admission, in a field that already exists. **Karpathy tie-break: derive at READ.** `run_status` and
   `run_result.meta` expose `unpricedModels: string[]` computed from the pin — zero new stored bytes, no new
   channel, no refusal, and it answers the operator's actual question ("why didn't my budget stop it?"). I expect
   the quality-dimensions lens to arrive at the same place from consumability; naming it here so the synthesis
   records it as a two-lens position rather than one lens's preference.
5. **Grep guards (absence) vs behavioural tests (presence), for the deletion.** Testability likes grep guards: they
   are cheap, total over the tree, and they run in milliseconds. Boundary says a grep proves a *name* is gone, not
   that a *behaviour* is — `curateToolsForProvider` could be inlined into the gateway and every grep would pass.
   **Both, paired, per DES-173**, and the pairing is the design rule rather than a suggestion: one grep + one
   behavioural assertion per retired thing.
6. **Test count vs test value, under the directive.** The directive asks for a test set "deeper, broader and larger
   in COUNT". Testability's honest position is that a test whose oracle is derived from the code under test (T2) is
   worse than no test, because it converts a defect into a green signal. **Tie-break: count only externally-anchored
   tests** (fixture literals, a real `vm`, a real filesystem, a real registration, a stored snapshot, a real
   process). The ~50-case target above is stated on that basis, which is why several items specify *what the oracle
   is* rather than just naming the assertion.

**Settled, not conflicts — recorded so they are not re-litigated:** the client-constructed DAG (ADR-044: a
server-rendered SVG string would be far easier for my testability lens to assert, and my boundary lens overrules it
on the escaping path and the lost interactivity); the `toolUse` rename with no alias window (the v24 ruling; my
interface-contract lens would normally want a window and does not get one); and no corrected Mermaid in a refusal
(my agent-altitude lens would love to hand back passing text and is overruled by REQ-111).

---

## Expected disagreements with the quality-dimensions lens

1. **The persisted last-good price snapshot.** I expect QD (self-sustainability) to want the last-good `ModelBook`
   snapshot persisted so it survives the automatic restart on every release. **I say: do not build it, and the
   ruling strengthens my case.** Under the struck ADR-038, a listing outage across a restart *refused runs* — that
   was worth hardening against. After the ruling an outage merely makes some calls `unpriced:true` on an admitted
   run, which is recorded, counted and queryable, which is exactly what the owner asked for. A persisted price cache
   is a cache with its own staleness and invalidation failure modes, bought to improve an outcome that is already
   acceptable. Karpathy: no.
2. **How much of `meta` to mint.** I expect QD to want `run_result.meta` to carry more (a `warnings[]`, per-row
   `declaredAt`, a richer provenance object). Gate 2 already settled named counters over an umbrella array; I hold
   the line at **three named fields** (`usage`, `unpricedCalls`, `unmappedMessages`) plus the read-derived
   `unpricedModels`. Every field in `meta` is a public shape with a fixture assertion (DES-187) and a dashboard
   reader; fields without both are decoration.
3. **`unpriced` as a boolean vs a richer reason.** I expect a push for `unpriced: {reason: 'unlisted' | 'catalog
   unavailable' | 'parse failure'}`. The information is already in `price_book.source` **per book**, which is the
   right granularity — the reason is a property of the snapshot, not of the individual call. A per-call reason
   object is three strings that always agree with each other within a run.
4. **The nested-frame `onBudgetSnapshot` fix (DES-182).** I expect agreement on the defect and possibly a push to
   also fix the nested frame's *own* budget view semantics (a per-frame allowance). I hold that the fix is exactly
   one config key: the guard is per-run by design and a per-frame allowance is a new feature nobody asked for.
5. **Where I expect agreement and want it recorded as a two-lens position:** the ruling's ledger fallout (§A) — both
   groups found this independently, which is the strongest signal in this round; the `unpricedModels` read-derived
   telling (conflict 4 above); the pin moving to `RunManager.start()`; and `configCheck` needing an actual reader
   rather than a value written into a file nobody opens.

---

## Real-tier validation paths (Gate 7.5) — the entrypoint that proves each REQ

REQ-121 — `run_start({seed:[{path,sha256}]})` against the booted engine: refused, workspace absent on disk.
REQ-122 — a revoked OpenRouter key: terminal inside one attempt, `run_agent_log.events` non-empty with the provider's
own error text, **and `ps aux` shows no surviving `claude` CLI child** (the liveness claim's only real evidence).
REQ-123 — three real runs, one per provider, and the **ollama (`default` alias, qwen2.5:7b) run must make a real
`Read` call** — that is the path this REQ actually changes; anthropic and openrouter would pass either way. Plus the
ADR-042 order observation (a `gpt41*` row → `configCheck:'failed'`, service still on the prior version).
REQ-124 — `GET /api/runs/77f74018/dag` on the real box: `warnings: []`, every agent in its true phase column.
REQ-125 — the openrouter run's `run_status.agents[]` shows `provider:'openrouter'`, `transport:'claude-agent-sdk'`.
REQ-126 — a LiteLLM `--detailed_debug` capture containing `reasoning_effort`, plus an observable low-vs-high
difference on a declared-reasoning model; ollama shows `applied:false` with its reason.
REQ-127 — a real haiku run: four token columns non-zero, `costUSD` within an order of magnitude of the SDK's own
`total_cost_usd`; **a trigger-started run with no budget still reports its spend** (the ruling's own acceptance).
REQ-128 — a cold model with only `tools/list` + the guide registers an LR swimlane **first try**.
REQ-129 — Playwright at 1100 px: both figures readable, wheel-zoom and `fit` work.
REQ-130 — the same cold-model probe, seeding a workspace and reading the sandbox section without asking a human.
