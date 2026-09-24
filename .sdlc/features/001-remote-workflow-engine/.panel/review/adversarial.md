# Gate 8 RE-REVIEW (round 3) — Adversarial architecture group (security / scalability / testability, Karpathy tie-break)

**Iteration:** v37 (REQ-218 Bash confinement posture C, REQ-219 dead-security-module cleanup)
**Round:** 3 — this file REPLACES the 2026-09-23 round-2 review (B1–B7 + A6/A8). Round 2's text is
superseded, not lost: it is recoverable verbatim at
`git show 2a760bd:.sdlc/features/001-remote-workflow-engine/.panel/review/adversarial.md`, and every
one of its findings is enumerated with a disposition in Part 1 below.
**Compared:** `02-architecture.md` ARCH-175..182 + ADR-082..086 (including ADR-086's **second**
`owner_decision`, 2026-09-24 —「在 `claim()` 重新蓋章」) + INV-V37-1..5 **against** the code named on
`06-impl-log.md`'s IMPL-371..385 `files:` lines, plus the modules those files reference at a module
boundary (`workflow-catalog.ts`, `tool-specs.ts`, `errors.ts`, `net-guard.ts`).
**Scope note that is itself a finding (C4).** The last two commits on `master` — `3e3c331`
(`claim()` re-stamps trigger provenance) and `2cf5f32` (re-stamp made monotonic) — are the
implementation of ADR-086's second owner ruling and they appear on **no IMPL `files:` line at all**:
`06-impl-log.md` ends at IMPL-385, whose own note states the *opposite* of what those commits do.
Their files (`src/mcp-facade.ts`, `src/call-tool.ts`, `src/scheduler.ts`, `src/webhook-registry.ts`,
`tests/unit/claim-restamps-provenance.test.ts`) were read anyway — via `git show` and on disk, since
`04-design.md`'s DES-263 amendment and ADR-086's ruling name them — because a security predicate that
the ledger's own scoping rule cannot reach is exactly what this lens exists to catch.
**Verdict:** `consistent: no` — **11 open findings** (2 HIGH, 4 MED, 2 LOW new; 3 carried forward).
Counting convention: 8 new (C1–C8) + 3 carried (A6, A8, B7).

Two of this group's three charter lenses again have little purchase on this slice, and that is
reported rather than invented: there is **no authn/authz change, no credential verification loop, no
token issuance and no failure counter** in v37's diff, so *brute force / JWT forgery / timing attacks
/ concurrency of failure counting* remain **N/A**. The security lens lands on provenance integrity and
admission completeness; the testability lens lands on one newly-minted unlocked forward; the
scalability lens lands (again) on nothing but a log line and one un-transacted pair of statements, and
says so. The place where the lenses genuinely pull apart this round is **C5**, and it is the same
security-vs-availability axis the owner has now ruled on twice — recorded, not re-litigated.

---

## Part 1 — round-2 closure (verified on disk, not inherited from the impl log)

| # (r2) | Status | Evidence now on disk |
|---|---|---|
| **B1** HIGH — `isRemoteSubmission` has no hop lock anywhere | **CLOSED for the three forwards it named** | UT-332/333/334 drive `callTool({…isRemoteSubmission:true}, 'webhook_create'\|'schedule_create')` against REAL stores and read `createdRemote` back through `.get()` (`tests/unit/call-tool-confinement-door.test.ts:94-119`); IT-304 boots a real `createServer({confinementPosture:'unconfined'})` and asserts the 403 (`tests/integration/confinement-unconfined-wiring.test.ts`). **Reopened in a new shape one commit later — see C2.** |
| **B2** HIGH — the row's key (creation) ≠ its rationale (attachment) | **DECISION CLOSED, TEXT NOT** | The owner re-ruled on the corrected premise (ADR-086, 2026-09-24: 在 `claim()` 重新蓋章) and the code implements it (`src/scheduler.ts:537-550`, `src/webhook-registry.ts:230-252`). ARCH-182's own row was **never amended** and now asserts the inverse of the code — **C1**. |
| **B3** MED — `webhook_list` cannot answer 「created remotely?」; no DEPLOY.md sweep | **CLOSED as written, re-broken by the later commit** | `WebhookView.createdRemote` exists and is projected (`src/webhook-registry.ts:65-69`, `:210`); `DEPLOY.md:883` (§5) and `:908` (§6) rows were written. Both rows are now **false** — **C6**. |
| **B4** MED — `deliver()`'s catch-all dropped the code, inverted retryable/permanent, recorded nothing | **CLOSED** | `admissionErrorToOutcome()` beside `admissionRefusal()` (`src/run-manager.ts:187-193`); `deliver()`'s three arms with `_recordRefusal(id,'CONFINEMENT_UNAVAILABLE')` on the 403 and STATIC `ERROR_CATALOG[...].hint` on every arm (`src/webhook-registry.ts:357-372`); the route now spreads `code` into the wire body (`src/server.ts:1481`) — the self-caught half-fix IMPL-385 reports is real and present. |
| **B5** LOW — three comments stating the opposite of the code | **CLOSED for all three named sites** | `src/main.ts:182-183` and `:485` now say the gateway's own default is `'unconfined'`; `src/gateway/claude-agent-sdk-client.ts:824-830` now names IMPL-377's `WORKROOT_INSIDE_PROJECT` refusal; `src/server.ts:809-813` now names the `start()`-driven routes and that `run_resume` stays on the door. **The class reopened at eight other sites — C6.** |
| **B6** LOW — ARCH-177 says `workRootDefault: string`, code ships it optional | **CLOSED** | `02-architecture.md:5541-5545` carries the one-word amendment (「optional on the type, always supplied on the production path」). |
| **B7** LOW — a permanent refusal routed to `markFailed`, re-fires forever | **OPEN by explicit architectural deferral** | `src/server.ts:1027-1038` unchanged; ARCH-182 amendment (7) declines it for this round **with a corrected mechanism and a v38 trigger**. Reported as deferred, not as a defect of this round. |
| **A6** LOW — spike-blocked arms ship as dead code | **OPEN, unrepaired** | `DENY_READ_MODE`'s `'workroot'` arm (`src/gateway/bash-confinement.ts:17`, `:66-69`) and `MASK_PROVIDER_ENV`'s `credentials.envVars` arm (`:21`, `:85-87`) unchanged. |
| **A8** LOW — ARCH-175 `allowRead` vs ARCH-176's 「the CLI keeps its own paths」 | **OPEN, unrepaired, unmeasurable until a host measures `confined`** | `src/gateway/bash-confinement.ts:77` unchanged. |

Worth crediting, because they were the expensive and easy-to-get-wrong parts: the wire boundary now
emits `code` + static catalog text and never `err.message` (the posture/`maxConcurrentRuns`
disclosure is genuinely gone); `admissionErrorToOutcome()` is pure and lives beside the predicate it
classifies, so the four consumers cannot drift; and **the monotonic correction in `2cf5f32` is the
single best piece of engineering in this iteration** — the first re-stamp draft was an unconditional
overwrite that would have let a LOCAL registration launder a REMOTELY-created webhook, a real loss
(whoever created the webhook controls *when* it fires and *what payload* reaches the script), and it
was caught by an existing test rather than by inspection, then fixed in the direction that keeps both
protections instead of relaxing the test.

---

## C1 — HIGH — ARCH-182 now contradicts the shipped code in the inverse direction of B2: the row (and the persistence table) still say `createdRemote` is written once and never re-stamped, after the owner ruled it IS re-stamped and the code does re-stamp it

**Violates:** ARCH-182 header + `api` (`02-architecture.md:5683`, `:5691`), ARCH-182's persistence
table row (`:5413`), ARCH-182 amendment (1) (`:5704-5710`), REQ-218's own acceptance rule (a
statement about the code either cites the line that makes it true or is deleted).

**What the architecture says today**
- `:5683` (the row's own header): 「keyed on the stored provenance of the trigger ROW's **CREATION**」.
- `:5691`: 「`createdRemote`, **written once by the `INSERT` and never re-stamped by any later
  attachment event** (`claim()`, `workflow_register`, `workflow_publish`)」.
- `:5413` (schema table): 「Written once at `webhook_create`/`schedule_create` … **Never updated
  afterwards — provenance is a fact about creation.**」
- amendment (1)/(1b): the re-attachment gap is written up as a **second named residual** with an
  event-shaped revisit trigger.

**What the code does** — `SqliteSchedulerPort.claim()` re-stamps on both the `'claimed'` and the
`'held'` outcome (`src/scheduler.ts:544-550`, `:551`, `:557`), and `WebhookRegistry.claim()` is its
twin (`src/webhook-registry.ts:234-243`, `:245`, `:249`); `McpFacade.workflowRegister()` feeds the
claiming registration's own remoteness into them (`src/mcp-facade.ts:392`). The residual described at
`:5704-5710` is (for claimed triggers) **closed**, and the sentence at `:5691` is **false**.

**Why this is HIGH and not a typo.** This is the *same* defect B2 was, with the sign reversed: last
round the row claimed a coverage the code did not have; this round it denies a mechanism the code
does have. Both are load-bearing for the next reader, and `:5691` is the sentence a v38 author will
quote when deciding whether provenance can be trusted after a re-registration. The owner ruling and
`04-design.md`'s DES-263 amendment were both updated; **`02-architecture.md` was not touched by
either commit** (`git show --stat 3e3c331 2cf5f32`). One ledger reading `02-architecture.md` alone
gets the pre-ruling model, complete with a residual that no longer exists and without the monotonic
rule that now governs the column.

**Minimum fix (no code change):** amend ARCH-182's header/`api`/table row to
「the trigger row's stored provenance — stamped at creation and **re-stamped, monotonically
local→remote, by `claim()`**」, fold amendment (1b) into 「closed by the 2026-09-24 ruling **for
claimed triggers**; still open for triggers bound at creation — see **C3**」, and state the monotonic
rule where an architect will find it (**C5** — today it exists only in a code comment and
`04-design.md`).

---

## C2 — HIGH — the sixth forward, predicted verbatim by ADR-086 and shipped unlocked, with both hops optional and defaulting to 「admit」

**Violates:** INV-V37-5 (`02-architecture.md:5974-6010` — 「each hop needs an assertion that fails
when the forward is dropped」), ARCH-182's 「`RunSpec.origin` is REQUIRED, not optional … an optional
security field whose absence means 「admit」 is finding A2 wearing a different field name」
(`:5690`), and ADR-086's own costing of the option the owner then chose.

**The new forward, end to end**

1. `src/call-tool.ts:212` — `facade.workflowRegister(a as never, principal, deps.isRemoteSubmission === true)`
2. `src/mcp-facade.ts:358` — `async workflowRegister(a, principal, isRemoteSubmission = false)` — **optional, defaults to `false` = local = not tainted = admit**
3. `src/mcp-facade.ts:392` — `this._storeFor(id).claim(id, a.name, isRemoteSubmission)` through the port at `:69`, `claim(id, workflow, createdRemote?: boolean)` — **also optional**, and the port's own doc comment states that TypeScript's method-parameter bivariance means the compiler does **not** police this seam.

**The mutations no test catches** (census run this round):
- Delete the third argument at `call-tool.ts:212` → every remote `workflow_register` re-stamps
  nothing, the 2026-09-24 ruling is silently undone, **suite green**.
- Delete `createdRemote` from the `claim()` call at `mcp-facade.ts:392` → same, **suite green**.
- Delete the `stamp()` call from **`WebhookRegistry.claim()`** (`src/webhook-registry.ts:245`, `:249`)
  → **suite green**: the only re-stamp test, UT-335
  (`tests/unit/claim-restamps-provenance.test.ts`), exercises `SqliteSchedulerPort` **only**, and the
  one webhook test that touches this branch (IT-304) asserts the *no-downgrade* direction, which a
  missing `stamp()` satisfies trivially.
- UT-335 itself calls `st.claim(id,'wf-a',true)` **directly on the store**, exactly as round 2's B1
  described the pre-existing `createdRemote` tests: it locks the predicate, never a forward.

**ADR-086 predicted this in the text the owner ruled on** (`02-architecture.md:5914-5916`):
「`workflowRegister()`/`workflowPublish()` 目前根本收不到 `isRemoteSubmission` —— 要做就是新增
**第六條未上鎖的 forward**(INV-V37-5 管的正是這件事)」. It was built, and it was not locked. This
repo's memory now names this bug class four times (v11 `updateFlagPath`, v15 auth, v37 A5, v37 B1) and
a hop lock remains the only thing that has ever caught it.

**Cost of the fix, measured rather than guessed** (so the Karpathy tie-break is made on numbers):
- One `it()` beside UT-335: `callTool({…isRemoteSubmission:true}, 'workflow_register', {name, script,
  mermaid, triggers:[id]})` against a real store, then `get(id).createdRemote === true`; and its
  webhook twin. Two cases, no production change.
- If the structural fix is preferred instead: `grep -rn "workflowRegister(" tests/` → **5 call sites
  in 4 files**; `grep -rn "\.claim(" tests/` → **23 call sites in 6 files**. Making the facade
  parameter required is cheap; making the port parameter required is not, and the tie-break says take
  the tests, not the churn.

---

## C3 — MED — the 2026-09-24 self-heal cannot reach a trigger that was BOUND AT CREATION: `claim()` never runs on it and the `NOT_IN_RELEASE` guard is switched off for it, so ADR-086's residual (1b) survives for the pre-v24 cohort

**Violates:** ARCH-182 `note`「What this closes」(`:5693`) and ADR-086's second `owner_decision`
as *stated* (「既有列因此在下次被認領時自我修復,不需要資料遷移」) — true for triggers bound the
supported way, false for this cohort, and the difference is written nowhere.

**Correction, reported rather than buried: my first reading of this path was wrong and I executed a
probe instead of shipping the inference.** I had concluded from `inputSchema: schema({})`
(`src/tool-specs.ts:153-155`, `:876`) plus ajv's `strict:false` with no `additionalProperties:false`
(`src/call-tool.ts:26`) that `webhook_create({workflow:'x'})` would still bind at creation, which
would have made this a live HIGH. Executed against real `':memory:'` stores through `callTool()`
(scratch probe, not added to `tests/`): **both tools refuse** —
`INVALID_ARGUMENT: webhook_create names no workflow — create the trigger unclaimed, then bind its id
with workflow_register(...)`. The refusal is `src/call-tool.ts:180-184`, placed ahead of ajv, and its
own comment (`:171-179`) anticipates this exact reasoning. Adjudication #8 did land; the tool surface
is closed for NEW rows.

**What remains, and it is the cohort this iteration already owes a sweep to.** That same comment ends:
「The store's own `create({workflow})` is unchanged — **pre-v24 rows keep firing on their legacy
binding**; only this door closes.」 For such a row:

1. It is its own claim from birth — `claimedBy: s.workflow ?? null` (`src/scheduler.ts:304`),
   `INSERT … workflow` (`src/webhook-registry.ts:188`) — so `claim()` is never called on it and the
   new re-stamp **never fires**: no self-heal, and no taint from a later remote re-registration.
2. `catalog.declaresTrigger(workflow, id)` is false for it (it entered no version's `triggers[]` —
   `src/workflow-catalog.ts:355-368`), so the `NOT_IN_RELEASE` guard that would otherwise catch a
   re-registration is deliberately skipped (`src/server.ts:1003`, `src/webhook-registry.ts:336`).

So a remote `workflow_register` + `workflow_publish` onto that workflow name is followed by a cron
tick or delivery that stamps `origin:'local'`, `admissionRefusal()` returns `null`, and the remotely
authored script runs with `options.sandbox = {enabled:false}`
(`src/gateway/claude-agent-sdk-client.ts:748`). That is ADR-086 residual (1b), verbatim, for a bounded
and identifiable set of rows — **the same rows `DEPLOY.md` §6 already tells the operator to rebuild**,
which is why the fix is documentation and a sweep, not a mechanism.

**Credit, because it makes the boundary exact.** For a trigger bound the supported way the two
mechanisms compose into a genuine pincer: declaring the id re-stamps it remote via `'held'`, and
*omitting* it is not an evasion because `declaresTrigger` is then true and the firing is refused
`NOT_IN_RELEASE`. That is good design and it is currently undocumented; C1's amendment is where it
belongs, together with this cohort as the one named exception.

**Fix:** state the exception on ARCH-182/ADR-086 (「self-heals on the next claim — **except a trigger
bound at creation, which is never claimed**」) and give the operator the identifying query in
`DEPLOY.md` (a trigger id that appears in no version's `triggers[]`), folded into the §6 row C6
already requires rewriting. No code change; optionally, the legacy binding could be retired in the
store as well, which is the Karpathy end state — one fewer path for every future control to miss.

---

## C4 — MED — the code implementing the owner's ruling exists in no IMPL row, its test in no UT row: the trace chain and this gate's own scoping rule both break at the most security-relevant change in the iteration

**Violates:** the ledger's own IMPL/UT contract (every `src/` change carries an IMPL with `files:`,
`traces:` and `greens:`; every test carries a UT/IT id in `05-tests.md`), and the review-stage scope
rule this task states in its own terms.

**Evidence**
- `grep -n "^### IMPL-3" 06-impl-log.md | tail -1` → **IMPL-385**. Commits `3e3c331` and `2cf5f32`
  touch `src/mcp-facade.ts`, `src/call-tool.ts`, `src/scheduler.ts`, `src/webhook-registry.ts` and add
  `tests/unit/claim-restamps-provenance.test.ts`; **none of those files appears on a later `files:`
  line, because there is no later IMPL.**
- IMPL-385's note (the newest ledger text on this subject) still states the superseded model twice:
  「the Gate-8 round-2 correction that re-attachment **never** re-stamps `createdRemote`」 and
  「since `claim()`/`workflow_register`/`workflow_publish` **never re-stamp** the column」. A reader
  working forward through the impl log ends at the pre-ruling world.
- `grep -n "UT-335\|claim-restamps" 05-tests.md` → **nothing**. The test exists, is green, and is
  invisible to `trace`.
- Only `04-design.md` (DES-263 amendment) and ADR-086's `owner_decision` were amended, i.e. the two
  documents the implementer happened to be editing.

**Why a reviewer reports this rather than shrugging.** This ledger's whole claim is that the
documents and the code move together; the one change made *after* the gate's own send-back, on the
predicate the gate exists to check, is the one that moved alone. It is also self-reinforcing: the
next review scoped 「read the files on each IMPL's `files:` line」 would not read `claim()` at all.

---

## C5 — MED — the monotonic sticky rule and its availability consequence exist only in a code comment: on this host, the next routine remote re-registration silently and permanently stops an existing trigger firing

**Violates:** ADR-086's costing of the option the owner chose (`02-architecture.md:5910-5916` states
only the coverage benefit and 「每個 store 一行」), ARCH-182 (the rule is nowhere in the row — C1),
and the ledger's own standard that an accepted cost is named where the person paying it reads it.

**The mechanism, as shipped.** `stamp()` is monotonic: `if (createdRemote !== true) return;`
(`src/scheduler.ts:548`, `src/webhook-registry.ts:242`) — local→remote only, and **there is no
un-stamp path anywhere in `src/`** (grep: the only writers are the two `INSERT`s and these two
`UPDATE … SET createdRemote = 1`). The argument for stickiness is correct and I endorse it: whoever
created a webhook controls *when* it fires and *what payload* reaches the script, so a local
registration must not launder it.

**The consequence nobody wrote down.** The owner's own record states that **every** workflow on this
production catalog is registered remotely, and VAL-256 established on this very host that such
submissions do arrive non-loopback (`isRemoteSubmission === true` via the tunnel header) (`owner=hsuhungjung@gmail.com`, `jev-haiku` v4's hourly
health check named explicitly). This host measures `unconfined`. Therefore the *next* ordinary remote
`workflow_register({triggers:[…existing ids…]})` — a routine re-publish, not an attack — flips those
rows to `createdRemote=1`, and from that moment **every firing of those triggers is refused 403 /
`lastError: CONFINEMENT_UNAVAILABLE`, permanently**, with no un-stamp path and no DEPLOY.md row
telling the operator why or what to do. That is the same blackout —「這台主機上每一個現有工作流程
都停跑」— the owner declined option (B), and later option (ii-narrow), specifically to avoid; the
chosen option delivers it **lazily, per workflow, at re-registration time**, which is strictly harder
to attribute when it happens.

**This is the round's genuine lens conflict, and it is not this gate's to resolve.** Security says
the stamp must stick; availability says this host's whole catalog is one re-publish away from
stopping. The gate's obligation is to put the consequence in front of the owner, since the ruling was
made without it: (a) record the monotonic rule + this consequence on ARCH-182/ADR-086; (b) give the
operator a recovery path that is not 「delete and recreate every trigger」 (the honest options are a
local `schedule_setEnabled`-style re-stamp tool, or fixing the host, which ADR-086's own ranking puts
first); and (c) fix DEPLOY.md, which currently tells the operator the opposite (**C6**).

---

## C6 — MED — round-2's B5 class, reintroduced at eight sites one commit after it was repaired, and this time the two operator-facing ones give an instruction that is now backwards

**Violates:** REQ-218's acceptance clause 「互相矛盾的兩段註解改成事實」, ARCH-176's named bug class,
ARCH-182 amendment (6), ADR-086's promise that the operator sweep lives in `DEPLOY.md`.

**Operator-facing (the reason this is MED, not LOW)**
- `DEPLOY.md:883` (§5 troubleshooting): 「判斷依據是**那個 webhook/schedule 被建立當下**是不是一次
  遠端提交(`createdRemote`,寫在觸發器那一列,**建立後不會再變,即使之後被別的工作流程認領也不會
  重蓋**)」 — false since `3e3c331`.
- `DEPLOY.md:908` (§6 upgrade): 「**`claim()`／`workflow_register`／`workflow_publish` 都不會重新蓋章
  這個欄位——認領一個既有 id 不會補上覆蓋率,只有重新「建立」觸發器才會**」 — this is *the* sweep
  instruction, and it now sends the operator to delete and recreate every trigger (destructive, and
  on this host, every workflow) to obtain coverage that a single re-registration would now supply.
  It also omits C5 entirely, so the operator is not warned that the cheap path taints irreversibly.

**Code comments** (each asserts creation-immutability that `claim()` now falsifies):
`src/scheduler.ts:29-30`, `:210`, `:306`; `src/webhook-registry.ts:166`, `:187`, `:348`;
`src/call-tool.ts:259`. `src/webhook-registry.ts:348` is the sharpest instance — it is the comment
IMPL-385 **rewrote for finding B5** (「never re-stamped by a later attachment event (`claim()`,
`workflow_register`, `workflow_publish` — Gate-8 round-2, finding B2)」), invalidated by the very next
commit, sitting two lines above the `start()` call whose security semantics it explains.

**Test comment:** `tests/integration/confinement-unconfined-wiring.test.ts:66` — 「it does not, and
must not, re-stamp `createdRemote`」. `claim()` now *does* re-stamp there (the `'held'` branch); what
the test actually pins is the *no-downgrade* direction. The sentence is the reason the implementer
reports nearly deleting the test as stale (commit `2cf5f32`'s own message) — a comment that almost
cost a real protection.

---

## C7 — LOW — the re-stamp is not compensated when the registration that caused it fails, and the scheduler's twin runs its two statements outside the transaction the webhook twin uses

**Violates:** nothing in the letter; reported as a pair of small consistency gaps in a new mechanism.

- `McpFacade.workflowRegister()` releases the ids it claimed when a later claim fails
  (`src/mcp-facade.ts:396`) or when `insertVersion` throws (`:403`), but a release does **not**
  un-stamp — monotonicity guarantees the residue is in the *safe* direction (a trigger reads remote
  after a registration that never landed), so this is a note, not a defect: a remote principal can
  permanently taint a trigger **it already owns** with a registration it intends to fail. Combined
  with C5's missing un-stamp path, that is a self-inflicted denial of service an operator cannot undo
  from the tool surface.
- `SqliteSchedulerPort.claim()` performs `SELECT` + `UPDATE claimedBy` + `UPDATE createdRemote` with
  no `.transaction()` wrapper, while `WebhookRegistry.claim()` wraps the identical sequence
  (`src/webhook-registry.ts:231`). Single synchronous `better-sqlite3` connection, so no interleaving
  is possible today; the asymmetry is worth one line of either code or comment so the next reader does
  not have to re-derive that.

---

## C8 — LOW — the column's name and its two projected field docs still describe creation provenance, which is no longer what the value means

**Violates:** ARCH-182's advertised-surface discipline (a value that decides whether code executes must
read back honestly — the rule B3 was closed under).

`createdRemote` now means 「created remotely **OR** last claimed by a remote registration」.
`ScheduleStatus.createdRemote` (`src/scheduler.ts:151`) and `WebhookView.createdRemote`
(`src/webhook-registry.ts:65-69`) are the operator's only read path and both still read as a creation
fact — the same sentence DEPLOY.md gets wrong in C6. Renaming the column costs a migration and is not
worth it (Karpathy); renaming the *projected* field, or documenting it in one line at both projection
sites plus `DEPLOY.md`, costs nothing. Noted rather than blocking, but it is what makes C5's diagnosis
possible for an operator staring at `webhook_list`.

---

## Carried forward, still open, unchanged

- **A6 — LOW (Karpathy):** `DENY_READ_MODE`'s `'workroot'` arm (`src/gateway/bash-confinement.ts:17`,
  `:66-69`) and `MASK_PROVIDER_ENV`'s `credentials.envVars` arm (`:21`, `:85-87`) remain compiled-in
  branches no shipped configuration reaches, in the iteration whose ADR-085 deleted two modules for
  exactly that shape.
- **A8 — LOW (latent, high value at the posture flip):** `allowRead = [root, ...grants]`
  (`:77`) vs ARCH-176's note that 「`allowRead` keeps the CLI's own paths」. Unfalsifiable until a host
  measures `confined`.
- **B7 — LOW, deferred by the architect with a corrected mechanism and an event-shaped v38 trigger**
  (ARCH-182 amendment (7)): the ticker still routes a permanent refusal through `markFailed`
  (`src/server.ts:1027-1038`), so a remotely-created cron re-refuses every period forever,
  `refusalCount` never increments, and each firing writes a `console.error` with the raw error object.
  Accepted as deferred; re-stated only so v38 inherits it.

---

## Explicit lens conflicts (this group carries three lenses; here is where they pull apart)

1. **Security vs. availability — C5, and this one is real, live, and unrecorded.** The monotonic
   sticky stamp is the right security call and I endorse it on the merits (trigger ownership is an
   attack surface independent of who wrote the script). It also means this specific production host is
   one routine remote re-publish away from its hourly health check stopping forever, with no un-stamp
   path. The owner has ruled twice on this axis and both rulings stand; what is missing is that the
   *second* ruling was costed without this consequence, exactly as the *first* was costed without the
   re-attachment gap. The gate's job is the same both times: hand back the corrected premise, not a
   reversal.
2. **Testability vs. surgical change — and this time testability's price is two `it()` blocks.**
   C2 is B1 repeated on a forward that ADR-086's own option analysis predicted in writing. The
   structural fix (required parameters) costs 5 + 23 test call sites and I do not recommend it; the
   regression locks cost two cases against stores that already accept `':memory:'` and no production
   change at all. 「Minimum architecture」 has never meant 「minimum test」, and a lock on a security
   forward is not speculative structure.
3. **Karpathy, applied to C3 — and a note on how this lens can talk itself into a finding.** The
   reflex reading (「the retired argument was un-advertised, not refused」) was mine this round, it was
   wrong, and one two-minute probe against the real stores settled it where another paragraph of
   schema reasoning would not have. The surviving item is a *documentation* exception, not a
   mechanism, and the only structural move worth considering is the deleting kind: retire the store's
   own legacy `create({workflow})` binding once the pre-v24 rows are swept, so every future control
   has one path to cover instead of two.

4. **Scalability — nothing to report, again, and saying so is more useful than manufacturing a
   concern.** The re-stamp adds at most one `UPDATE … WHERE id = ?` per claimed trigger per
   registration, on a path that already does several writes; the admission predicate is still two
   scalar comparisons with zero new queries; the boot probe is still one 5 s-capped `spawnSync`
   (`src/gateway/confinement-probe.ts:38`). The only unbounded object v37 adds remains B7's per-firing
   log line.

---

## Summary table

| # | Severity | ARCH/INV/ADR violated | Evidence | Lens |
|---|---|---|---|---|
| C1 | HIGH | ARCH-182 header/`api`/table + amendment (1) | `02-architecture.md:5683,5691,5413,5704-5710` vs `src/scheduler.ts:544-557`, `src/webhook-registry.ts:234-249`, `src/mcp-facade.ts:392` | security / ledger accuracy |
| C2 | HIGH | INV-V37-5, ARCH-182「REQUIRED, not optional」, ADR-086's own option costing | `src/call-tool.ts:212`, `src/mcp-facade.ts:358,69,392`; tests: UT-335 drives the store directly, no `callTool`-driven case, no webhook upgrade case | testability / security |
| C3 | MED | ARCH-182「What this closes」, ADR-086 second `owner_decision` (self-heal claim) | `src/call-tool.ts:180-184` closes the tool door (probe-verified); residual cohort at `src/scheduler.ts:304`, `src/webhook-registry.ts:188`, guard skipped at `src/server.ts:1003`, `src/webhook-registry.ts:336` via `src/workflow-catalog.ts:355-368` | security |
| C4 | MED | IMPL/UT ledger contract; review-scope rule | `06-impl-log.md` ends at IMPL-385 (whose note states the superseded model twice); `05-tests.md` has no UT-335; `git show --stat 3e3c331 2cf5f32` | traceability |
| C5 | MED | ADR-086 option costing, ARCH-182 (rule absent — see C1) | `src/scheduler.ts:548`, `src/webhook-registry.ts:242` (no un-stamp path in `src/`); ADR-086 ruling text on the production catalog | security vs availability |
| C6 | MED | REQ-218 acceptance 註解改成事實, ARCH-182 (6), ADR-086's DEPLOY.md promise | `DEPLOY.md:883,908`; `src/scheduler.ts:29-30,210,306`; `src/webhook-registry.ts:166,187,348`; `src/call-tool.ts:259`; `tests/integration/confinement-unconfined-wiring.test.ts:66` | security hygiene / operability |
| C7 | LOW | — (consistency of a new mechanism) | `src/mcp-facade.ts:396,403` vs the monotonic `stamp()`; `src/scheduler.ts:537-550` vs `src/webhook-registry.ts:231` | security / maintainability |
| C8 | LOW | ARCH-182 advertised-surface discipline (B3's own rule) | `src/scheduler.ts:151`, `src/webhook-registry.ts:65-69` | operability |
| A6 | LOW | ARCH-175 (「deletes the losing arm」), ADR-085 thesis | `src/gateway/bash-confinement.ts:17,21,66-69,85-87` | Karpathy |
| A8 | LOW | ARCH-175 `api` vs ARCH-176 `note` | `src/gateway/bash-confinement.ts:77` | security (latent) |
| B7 | LOW | deferred by ARCH-182 (7) with a v38 trigger | `src/server.ts:1027-1038` | scalability / operability |

**Recommended blocking set for Gate 8: C1 and C2, with different owners.**
**C1 + C4 block on the architect/ledger** — the architecture row and the impl log currently state the
opposite of the shipped security predicate; that is one amendment and one IMPL/UT row, no code.
**C2 blocks on the implementer** — two regression cases, no production change, against an invariant
this iteration wrote for itself and whose failure direction is silently insecure.
**C3 does not block** — probe-verified, the tool door is shut; what is left is an undocumented
exception to the self-heal claim, over the cohort DEPLOY.md §6 already addresses, and it rides C1's
amendment and C6's rewrite. **C5 does not block, but it must be surfaced to the owner before Gate 8
closes**, on the same mechanism ADR-086 has used twice: the ruling was taken on a premise that omitted
its availability cost, and this ledger's pattern is to hand the corrected premise back rather than to
reverse or to bury it. **C6 is the floor either way** — the operator instruction that ships today is
backwards. **C7/C8/A6/A8** are cleanup that can ride the same commit; **B7** stays deferred to v38 as
the architect ruled.

*Reviewer: adversarial architecture group (security / scalability / testability + Karpathy
tie-break), Gate 8 re-review round 3, 2026-09-24.*
