# Quality-dimensions review — Gate 2 architecture vs. implementation (v37, ADR-086 claim()-restamp slice)

**Scope note (itself the first finding, see §1):** the task instruction was to scope code reading
to files listed on each IMPL's `files:` line in `06-impl-log.md`. The work under review — commits
`2a760bd` (docs: ADR-086 corrected ruling), `3e3c331` (feat: `claim()` re-stamps provenance) and
`2cf5f32` (fix: re-stamp made monotonic) — has **no IMPL entry at all**: `06-impl-log.md`'s last
entry (IMPL-385) was written by `2a760bd` and the file is untouched by the two commits after it.
Scoping strictly to `files:` lines would have silently skipped the entire slice under review, so
this pass reads the actual changed files instead: `src/scheduler.ts`, `src/webhook-registry.ts`,
`src/mcp-facade.ts`, `src/call-tool.ts`, `tests/unit/claim-restamps-provenance.test.ts`, plus the
architecture/design/deploy prose these commits reference or should have updated
(`02-architecture.md` ADR-086/ARCH-182, `04-design.md` DES-263, `rtm.md`, `05-tests.md`,
`DEPLOY.md`). The prior `.panel/review/quality-dimensions.md` (IMPL-371..384 slice, 2 findings, both
about `authoring-guide.ts`/`INV-V37-5`'s own wiring-lock coverage) is superseded by this file; its
findings are not re-verified here and should be re-checked on a future pass — this pass is scoped to
the claim()-restamp slice only.

**Architecture decision under review:** ADR-086's second owner ruling (`02-architecture.md:5880-5906`)
— "在 `claim()` 重新蓋章": re-stamp `createdRemote` on a trigger row whenever a `workflow_register`
call claims it, using that call's own `isRemoteSubmission`, closing (a) the zero-coverage-on-legacy-
rows gap and (b) the "remote `workflow_register`+`workflow_publish` onto an already-triggered
workflow name, no operator action needed" residual named in ARCH-182's Gate-8 round-2 amendment
(1b).

---

## 1. Observability

**Checked and consistent:** the `stamp()` closures added in `scheduler.ts:537-560` and
`webhook-registry.ts:230-247` are pure, small, and the monotonic-union rule (`createdRemote !== true
? return : UPDATE ... = 1`) is legible from the diff alone — no argument that this specific 6-line
change is hard to read.

**Violation 1 — HIGH — the entire slice is invisible to the traceability chain the SDLC exists to
produce.** `06-impl-log.md` (the one document whose whole purpose is "internal state [of the
build process] observable at any time") has zero entry for this work:
- `git log --stat` on `3e3c331`/`2cf5f32` shows neither commit touches `06-impl-log.md`.
- `05-tests.md` has zero mentions of `UT-335` (grep, zero hits) — the new red-then-green test suite
  `tests/unit/claim-restamps-provenance.test.ts` was written and landed with no Gate-5 test-spec
  entry to trace it back to.
- `rtm.md:455-468` still carries the PRE-fix language: "`createdRemote` is stamped once, at
  trigger-ROW CREATION, and no later event re-stamps it (`claim()`'s `'held'` arm returns before any
  `UPDATE`...)" and "re-opened as ADR-086's `owner_decision: pending`" — both now false of the
  shipped code, and neither line was touched by either commit.
- `02-architecture.md:5691` (ARCH-182's own `api:` paragraph) still asserts `createdRemote` is
  "written once by the `INSERT` and never re-stamped by any later attachment event (`claim()`,
  `workflow_register`, `workflow_publish`)" — the exact fact this slice changed, uncorrected in the
  architecture document itself.
- `02-architecture.md:5900-5906` is internally self-contradictory as it now stands: the round-2
  amendment sentence says the ADR "回到 `pending`", the `owner_decision:` line two paragraphs later
  says "answered 2026-09-23(第二次...)" and gives a ruling, and the same block's tail still repeats
  the *pre-ruling* framing ("請在更正後的前提下重新裁決: 選「只更正文字」... 還是選「在 `claim()`
  時重新蓋章」?") as if unanswered — three inconsistent states of the same decision coexist in one
  entry, with no marker showing which paragraphs are superseded.

  This is not a paperwork nit: the CLAUDE.md project rule and this feature's own INV-V37-3
  ("no requirement's only evidence may run against code with no production caller" — the general
  form of "wire it or delete it") both depend on the ledger being the thing reviewers and future
  agents read instead of re-deriving from source. A security-relevant behavior change (who can start
  unconfined Bash execution on a remote-registered script) shipped through review with **no traced
  record that it happened at all** — a reviewer reading `06-impl-log.md`, `05-tests.md` or `rtm.md`
  top-to-bottom today would not learn this fix exists, would still see ADR-086 as "pending", and
  would still see the round-2 amendment's residual (1b) described as open. Evidence:
  `06-impl-log.md` (10404 lines, none after IMPL-385), `05-tests.md` (grep `UT-335` → 0 hits),
  `rtm.md:455-468`, `02-architecture.md:5691,5900-5906`.

**Violation 2 — MED — the re-stamp transition is itself unaudited, contradicting the architecture's
own stated principle for this exact area.** ARCH-182 (4) states, about a *different* field in this
same slice, "a value that decides whether code executes and cannot be read back is unauditable by
construction." `createdRemote`'s local→remote transition now silently mutates in place
(`UPDATE schedules SET createdRemote = 1 WHERE id = ?` / the `webhooks` twin,
`scheduler.ts:552`/`webhook-registry.ts:243`) with no `provenanceChangedAt`, no actor, no journal/log
line — an operator (or `webhook_list`/`schedule_list`) can see the CURRENT value but never learn
*when* a trigger flipped from locally- to remotely-owned or *which registration* did it, which is
exactly the audit question this predicate exists to let an operator answer after an incident.

---

## 2. Replaceability

**Checked and consistent:** both trigger stores (`SqliteSchedulerPort`, `WebhookRegistry`) implement
the widened `TriggerClaimStore.claim(id, workflow, createdRemote?)` port identically in shape and in
the monotonic rule, so `McpFacade._storeFor()` still dispatches through one interface with no
backend-specific branching — a third store implementation (e.g. swapping SQLite for another engine)
would plug in the same way it always has.

**Violation 3 — MED — the port widening is not compiler-enforced, and the implementers' own commit
message says so without adding the compensating test.** `mcp-facade.ts:64-70`'s
`TriggerClaimStore.claim` signature grew a third, optional parameter. The `3e3c331` commit message
states directly: "TypeScript 方法參數的雙變性讓較窄的實作靜默滿足較寬的 port，所以編譯器不守這條縫"
(method-parameter bivariance means the compiler will not catch a narrower implementation silently
satisfying the wider port) — i.e., a future third `TriggerClaimStore` (or a refactor of one of the
two existing ones) that simply drops the third parameter, or accepts it but never re-stamps, would
type-check cleanly and compile with no error, silently reopening ADR-086's hole. The codebase has an
established pattern for exactly this class of problem — INV-V37-5's "hop-level wiring lock" tests
for `confinementPosture`/`allowHostPaths` (`04-design.md`, `confinement-unconfined-wiring.test.ts`)
— but no equivalent lock was added here: `UT-335` (`claim-restamps-provenance.test.ts`) imports and
tests `SqliteSchedulerPort` only (grep confirms zero references to `WebhookRegistry` in that file),
so `WebhookRegistry.claim()`'s local→remote upgrade direction has **no direct unit test at all**;
it is only reachable indirectly through `confinement-unconfined-wiring.test.ts`, which tests the
*other* direction (local registration must not downgrade a remote-created row) and says so in its
own comment ("it does not, and must not, re-stamp `createdRemote`"). If either store's `claim()`
regressed to not upgrading local→remote, no test in the suite would fail.

---

## 3. Consumability

**Checked and consistent:** the facade-level contract (`workflowRegister(a, principal,
isRemoteSubmission = false)`) defaults the new parameter so every pre-existing caller keeps
compiling and keeps prior behavior — no breaking change to the tool's advertised I/O shape.

**Violation 4 — HIGH — `DEPLOY.md`, the operator-facing document, now gives actively wrong
remediation instructions that contradict the shipped code.** `DEPLOY.md:908` reads (unchanged by
either commit): "`claim()`／`workflow_register`／`workflow_publish` 都不會重新蓋章這個欄位——認領一個
既有 id 不會補上覆蓋率，只有重新『建立』觸發器才會" (claim()/workflow_register/workflow_publish will
NEVER re-stamp this field; claiming an existing id does not restore coverage, only re-creating the
trigger does) and prescribes, as the *only* remedy for the legacy zero-coverage cohort, deleting and
recreating every webhook/schedule from a remote caller. `DEPLOY.md:883` similarly states
`createdRemote` "建立後不會再變，即使之後被別的工作流程認領也不會重蓋" (never changes after
creation, even if claimed by another workflow, never re-stamped). Both sentences are now false of
the code an operator following this doc would be running: `claim()` on both stores now re-stamps
(monotonically) exactly when a remote registration claims the row. An operator who trusts this
paragraph will delete-and-recreate triggers that a plain remote re-registration would already have
fixed, or — worse — will read the *converse* implication (their local reclaims are inert) and miss
that a LOCAL re-registration of a workflow that owns a remotely-created webhook is correctly
*refused* from downgrading it, which is new, security-relevant behavior this doc never mentions.
This traces directly back to Violation 1: because no IMPL entry flagged the change, the standard
"prose this row's own widening made stale" sweep that ARCH-182 (5) itself prescribes for exactly this
kind of drift never ran against `DEPLOY.md` for the claim()-restamp slice.

---

## 4. Self-sustainability

**Checked and consistent:** the monotonic-union design (`createdRemote = existing OR
this-claim-is-remote`) is a genuinely closed-loop self-healing rule in the two cases it actually
fires for — a pre-existing trigger explicitly re-listed in a later remote `workflow_register` call
upgrades itself with zero operator action, exactly as designed, and the fix's regression (caught by
`confinement-unconfined-wiring.test.ts` and corrected same-day in `2cf5f32`, with the design doc
amended in place recording what the first version got wrong) is a good instance of the process
working: a real test caught a real regression before merge, and the correction is documented rather
than silently folded in.

**Violation 5 — HIGH — the "self-heals" claim does not hold for the actual attack path ADR-086 (1b)
names, because `claim()` is not always called on re-registration.** `mcp-facade.ts:373`:
`const triggers = a.triggers ?? [];` — the set of trigger ids a `workflow_register` call re-claims
is taken *only* from the caller-supplied, optional `a.triggers` argument. Trigger ownership
(`claimedBy`/`workflow` in the two stores) persists per workflow **name** across versions
independent of whether a later `workflow_register` call re-lists it — `workflow_publish`
(`mcp-facade.ts:501-519`) takes only `(a, principal)`, calls no store's `claim()`, and simply flips
the release-channel pointer via `catalog.publish()`; firing resolves the running script by
`catalog.resolve(row.workflow, {channel:'release'})` (`webhook-registry.ts:318`,
`scheduler.ts`'s twin), keyed on workflow name, not on which trigger ids any particular
`workflow_register` call happened to list.

Concretely: workflow `wf-a` already owns trigger `cron-x` (`createdRemote: false`, e.g. locally
created). A remote peer calls `workflow_register({name:'wf-a', script:<malicious>, mermaid, ...})`
**without `triggers`** (the field is optional; there is no validation requiring already-owned ids to
be re-listed) to register `v2`, then `workflow_publish({name:'wf-a', version:'v2'})`. Because
`triggers` is empty, the `for (const id of triggers)` loop (`mcp-facade.ts:390-396`) never runs,
`claim()` is never called for `cron-x`, and its row is untouched — `createdRemote` stays `false`.
The next scheduler tick resolves `wf-a`'s release channel, now `v2` (the remote script), reads
`origin: 'local'` off the trigger row, and `admissionRefusal({posture:'unconfined',
origin:'local'})` returns `null` — the run is **not refused**, and Bash-capable work executes
unconfined running a remotely-authored script. This is the *exact* scenario ARCH-182's Gate-8
round-2 amendment (1b) describes ("遠端 `workflow_register` + `workflow_publish` 到一個已經擁有觸發器
的工作流程名稱上，下一次 cron 或 webhook 自己就把新腳本跟起來" / "no operator action needed") and
that ADR-086's owner ruling was explicitly chosen to close ("它一次關掉兩個洞（重新註冊路徑、既有列
在下次被認領時重新評估）" — `02-architecture.md:5906`). The shipped fix closes this hole **only when
the remote registration call happens to include the already-owned trigger id in `triggers`**, which
nothing in the API, the validation, or the test suite requires or exercises — `UT-335`'s three cases
all call the store's `claim()` directly, never through `workflowRegister()`'s trigger-derivation
logic, so this gap is untested as well as unfixed. The system does not, in fact, self-heal the
residual the ADR was answered to close; it self-heals a narrower case (explicit re-claim of a
specific id) that happens to overlap with it in the common, cooperative case but not in the
adversarial one the ADR's own threat model describes.

---

## Summary

| Dimension | Violations | Severity |
|---|---|---|
| Observability | 2 | HIGH, MED |
| Replaceability | 1 | MED |
| Consumability | 1 | HIGH |
| Self-sustainability | 1 | HIGH |

**Total violations: 5** (3 HIGH, 1 MED counted twice across dims — see below, 1 further MED).

**Not consistent.** The headline issue (Violation 5) is that the shipped `claim()`-restamp fix does
not close the residual ADR-086's owner ruling was chosen specifically to close: a remote
`workflow_register`+`workflow_publish` onto an already-triggered workflow name, made **without**
re-listing that trigger's id, still results in unconfined execution of a remotely-authored script
with no operator action — because `claim()` is only invoked over `a.triggers`, an optional argument
independent of what `workflow_publish` actually releases. This is compounded by Violation 1: the
work has no traceability-chain entry at all (no IMPL row, no test-spec row, no RTM update), so the
architecture document, the RTM, and the deployment guide all still describe the PRE-fix state (or,
worse, a state that never existed — RTM/DEPLOY.md's "never re-stamps" claims were already an
overstatement of the pre-fix code and are now simply false), and no downstream reviewer following
the ledger would discover any of this without re-deriving it from source, as this review did.
