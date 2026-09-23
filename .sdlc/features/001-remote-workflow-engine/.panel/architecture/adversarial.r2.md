# Adversarial architecture group — debate round 2 (v37 Gate 8 send-back)

> **Reader pointer.** The **current round** — *v37 Gate 8 round-2 send-back, debate round 2* —
> is the **ADDENDUM near the end of this file** (`# ADDENDUM — v37 Gate 8 **round-2** send-back,
> debate **round 2**`). Everything above it is the earlier **Gate-2** round-2 record, kept
> because `adversarial.r1.md` ADDENDUM 2 §1.3 cites it by section number. The two rounds have
> different headlines and different disagreement lists: the Gate-2 section's open items are
> labelled `D1`/`D2`, the current round's are `RD1`–`RD9`. They are not the same items.


**Lenses**: (a) Security · (b) Scalability/performance · (c) Testability. **Tie-breaker**: Karpathy
simplicity-first. **Round**: 2 — I have read `quality-dimensions.r1.md` (the only other r1 in the
panel directory). **This file supersedes the stale Gate-2 `adversarial.r2.md` this path held**
(timestamped before both r1 files; reachable via `git show HEAD:<path>`), same convention QD used
for their r1.

**Scope unchanged**: A1, A2, A3, A4, O-1 (+A6/A8 folded into A3, A5/C-1 one sentence each).
ADR-083's posture C is not reopened.

**Headline**: we converged on more than either r1 predicted — QD expected me to argue for
per-site duplication and I had already ruled for the same choke point they did. The one real
disagreement about A1 was the *key*, and **I concede it to QD's shape and sharpen it**: origin
belongs on the **workflow version row**, not on two trigger stores — one migration instead of two,
closing a hole my r1 had, matching 裁決理由 (1) literally — **while keeping the existing
submission-peer check for the one route where peer genuinely is provenance**, so no verified control
is loosened on the way. Two disagreements remain: the *timing* of the read-side flip, and the
legacy-row default.

---

## 1. A1 — I concede my own r1 ruling. Origin goes on `workflow_versions`, not the trigger stores.

**CONCEDE (large).** My r1 ruled two new columns (`webhooks.createdRemote`,
`schedules.createdRemote`) keyed on who *created the trigger*. QD argued the persisted fact should
be the **workflow's** origin, because ADR-083 says 「另一台機器送來的**工作流程**」 — the script, not
the request. They are right and I was wrong, and the hole is concrete, not semantic:

> A remote authenticated caller (the incident's own attacker position) calls `workflow_register` —
> un-gated, it is not `run_start`. The operator later sees the workflow in `workflow_list` and runs
> it **locally**. Under my r1 design `origin = local` (loopback peer, no trigger involved) ⇒
> admitted ⇒ unconfined Bash. Under QD's design it is refused.

That is the shortest path from the incident's attacker position to the incident's outcome, and my
r1 design admits it. Ignore my r1 two-column ruling.

**SHARPEN — the workflow row is the wrong row; it must be the version row.** QD says "catalog/
webhook/schedule row" without picking. Measured: workflows are **versioned**
(`workflow_versions`, `workflow-catalog.ts:267`), `register()` bumps a version per name, and a run
executes *a specific version's script*. Stamping the `workflows` name row is last-writer-wins: a
locally-registered v1 and a remotely-registered v2 would share one origin, and a run pinned to v1
would inherit v2's taint (or launder it). So:

**Ruling (ARCH-182, revised).** One fact, one column, one choke point:

1. **Column**: `workflow_versions.origin TEXT NOT NULL DEFAULT 'local'`, written from the
   registering `tools/call`'s own `isRemoteSubmission`. **Exactly one insert site exists** —
   `workflow-catalog.ts:671` is the only `INSERT INTO workflow_versions` in the tree (grep-verified),
   so there is no second path and no publish-laundering: `publish`/`promote` set
   `release_version`/`beta_version` on the *name* row and never copy a script row. Idempotent
   `ALTER TABLE` idiom already present verbatim in the same file (`:322-327`).
2. **Choke point**: `RunManager.start()` / `.resume()` — unchanged from my r1 and from QD's, the
   `INLINE_SCRIPT_CLOSED` precedent. `call-tool.ts:120`'s door is **deleted, not duplicated**.
3. **Read cost: zero new queries, and this is why the version row is also the cheap row.**
   `start()` already calls `this._catalog.resolve(...)` at `run-manager.ts:553`, whose
   `SELECT script, mermaid, params, triggers, diagram_contract FROM workflow_versions WHERE name=?
   AND version=?` (`workflow-catalog.ts:~835`) is the exact row we want. `origin` is **one more
   column in an existing SELECT**, surfaced as one more field on `VersionEntry`.
4. **Predicate**: one pure exported
   `admissionRefusal({posture, origin}): 'CONFINEMENT_UNAVAILABLE' | null`. Unchanged.
5. **`RunSpec.origin` stays required — I do NOT drop it, and I nearly did.** My first draft of
   this round deleted it on the grounds that the version row subsumes it. That is wrong, and the
   reason is in my own r1 table: the `tools/call` route is **the only one where peer == provenance**,
   so the live peer there is not a second meaning of 「remote」 — it is a legitimate, first-class
   submission fact. Dropping it would delete the one door REQ-218's Gate 7.5 record actually proves,
   inside a consistency-review send-back whose job is to close three gaps, not re-scope the fourth.
   So: `RunSpec.origin: 'local' | 'remote'`, **required**, stamped from `isRemoteSubmission` at the
   `run_start`/`run_resume` handler and hard-coded `'local'` at the three trigger dispatch sites (per
   the scope line below: the delivery is not the threat). The compiler-guard argument from r1 stands
   — a required field is what makes admission site #5 impossible to forget.
6. **Predicate, final**: `admissionRefusal({posture, versionOrigin, submissionOrigin})` →
   `'CONFINEMENT_UNAVAILABLE' | null`, **refusing if EITHER origin is remote**. Still one pure
   function, one choke point, one refusal code. Two inputs is not two meanings: one answers 「who
   wrote this script」, the other 「who is pushing the button right now」, and both are genuinely
   remote-submission facts under 裁決理由 (1).

**Correction to QD's census (factual).** QD's four sites are `client / webhook / schedule / chain`.
`'chain'` exists only in the `startedBy` type union (`types.ts:7`) and in dashboard strings — there
is **no production `.start()` call site for a chain sub-run**. The real fourth site is the *second
scheduler dispatcher* inlined in `server.ts:1015`, which QD missed. So QD's "chain sub-runs inherit
the parent's admission" reasoning is about a path that does not exist, and their site list is
missing the twin-dispatcher case my r1 named. Census, grep-verified: `mcp-facade.ts:710`,
`webhook-registry.ts:305`, `scheduler.ts:363`, `server.ts:1015`. **Neither r1 had all four right;
this is the corrected list.** Under the version-row design the count stops mattering, which is the
point.

**Resume — my r1 rule half-collapses, and the half that survives needs an argument.** I ruled
"refuse if EITHER the stored origin or the resume request's own remoteness is remote."

- **The version fact collapses, in QD's favour.** `resume()` also goes through
  `this._catalog.resolve(spec.name, {version: view.scriptVersion})` (`run-manager.ts:1102`) — the
  **pinned** version. Runs pin their version (`types.ts:170`), so `versionOrigin` at a resume is the
  same single fact as at the start. There is no stored-vs-live asymmetry for the script's origin, and
  **my r1's "legacy `runs` rows resolve to `'remote'`" ruling is moot** — there is no `runs` column
  and no migration. Withdrawn.
- **The submission fact does not collapse.** `resume(runId)` (`mcp-facade.ts:778`) carries no
  `RunSpec`, so it has nowhere to read `submissionOrigin` from — an implementer hits this on the
  first line. **`RunManager.resume()` grows a required `origin` argument**, stamped from the resume
  request's own peer exactly as `start` is. Still no persisted state: `submissionOrigin` means "who
  is pushing the button right now" at both entry points, which is precisely why it cannot be
  inherited from the start.
- **The case r1 flagged, so it is not silently dropped**: a run started remotely under `confined`,
  resumed locally after the posture flips to `unconfined`. `versionOrigin` still refuses it if the
  script was remote-authored. If the script was local and only the original *args* came from a remote
  caller, it is admitted — the same scope line as the trigger routes, and the same answer.

**Three cases I rule explicitly rather than leave implicit:**

- **Remote party creates a webhook/schedule on a locally-registered workflow → admitted.** This is
  a *scope line, not a hole*: what the remote party controls is `args`, i.e. ordinary external input
  to a script a local author wrote — the same trust relationship any webhook payload already has.
  ADR-083's named threat is remote-*authored* Bash. If the panel wants remote-supplied args treated
  as taint, that is a different requirement and it should be filed, not smuggled in here.
- **Remote `run_start` of a locally-registered workflow → still REFUSED.** Under the two-input
  predicate this keeps working exactly as `call-tool.ts:120` does today, so **REQ-218's existing
  Gate 7.5 evidence stays valid** and no owner re-ask is needed. The door *moves* to `RunManager`;
  it is not widened. (Validation still owes the two *new* routes — one webhook-path and one
  scheduler-path real run — per my r1 R5. That obligation is additive, not a re-earn of what exists.)
- **Legacy `workflow_versions` rows** → `DEFAULT 'local'`. See §6, remaining disagreement #2.
- **Legacy-cohort resume** (`run-manager.ts:1097-1102`: the pin is absent from `workflow_versions`
  and `resolve()` falls back). **The origin that applies is the fallback-resolved version's** — the
  row whose script will actually execute, never the missing pin. Same principle as everything else
  here: the origin travels with the payload.

**Two laundering paths checked and closed (grep-verified this round):** there is **no
`UPDATE workflow_versions` anywhere in the tree**, so a script row is immutable once inserted and a
re-register at the same version cannot overwrite an origin in place. And the remoteness wire to the
register handler **already exists**: `server.ts:1168` computes `isRemoteSubmission`,
`buildToolDeps(webhookBaseUrl, isRemoteSubmission)` (`:898-899`) puts it on `ToolDeps`, and
`callTool(...)` (`:1324`, `:1583`) dispatches **every** tool through it — `workflow_register`
included. No new plumbing for the stamp.

**Corrections to my own r1 A5 claim.** I wrote that ARCH-182 *deletes* the `main.ts:368 → ToolDeps`
posture hop and therefore shrinks INV-V37-5's obligation. Under version-row stamping that is wrong
in one half: the *door* moves to `RunManager`, but `isRemoteSubmission` must now reach the
**register** handler in `mcp-facade.ts`, so a remoteness wire still crosses that boundary. The hop
survives; INV-V37-5 applies to it unchanged. Withdrawn.

**(b)** Two scalar comparisons on a path that already does `INSERT INTO runs`; one extra column on
an existing primary-key SELECT. Unmeasurable. **(c)** 2×2 pure truth table + one integration test
per route against a fake `RunManager`, replacing an HTTP-server-plus-ticker-plus-clock setup.

---

## 2. A1's two riders QD raised and I did not — both ruled

**Gate order (QD's risk, unanswered in my r1).** **Confinement refusal comes BEFORE
`RUN_ADMISSION_LIMIT`.** A submission that can never be admitted under the current posture must not
consume a slot, and must not be told "try again later" — `CONFINEMENT_UNAVAILABLE` is deterministic
and a retry is futile, whereas the limit's refusal is explicitly retryable. Returning the retryable
code for a non-retryable condition is the same false-signal class as A4's false invariant.

**This contradicts the current order, and the implementer must not have to discover that.**
Measured: `RUN_ADMISSION_LIMIT` throws at `run-manager.ts:459`, while the `catalog.resolve()` that
yields the version row — and therefore `versionOrigin` — is at `:553`. So **`resolve()` moves ahead
of the limit check.** That is cheap and consistent with the limit's own stated intent (`:103`,
"before any durable work"): `resolve()` is a primary-key read, not durable work, and a submission
that will be refused outright should never have consumed a slot on the way.

**Four callers, one thrown shape (QD's consumability point).** **CONCEDE, corrected.**
`RunManager.start()` throws one `codedError('CONFINEMENT_UNAVAILABLE', …)`; each caller maps it into
its own existing idiom (`refusalEnvelope` / `_recordRefusal` / `ScheduleResult.error` /
`markFailed`). QD's claim that "the scheduler does not catch anything from `start()`" is half right
and the precision matters for the task card: `server.ts:1015` **does** `.catch` and routes
`err.code` into `markFailed` (verified `:1017-1025`), so the ticker driver is already covered;
`scheduler.ts:363`'s `trigger()` has **no try/catch at all** (verified `:350-372`). So the
inventory is one uncovered site of four, not a general scheduler gap — and without it that site
regresses to an uncaught throw.

---

## 3. A2 — converged, and it is a precondition for A3, not merely a hardening

**AGREE with QD, same fix, same precedent.** `workRoot`'s tmpdir default hoists from
`server.ts:655` to the composition root, copying `assetRoot` (`main.ts:295`) — the one place this
codebase already does it right. `ServerConfig.workRoot` becomes required; `server.ts:655`'s `??` is
**deleted**, not left as a test convenience (a default only tests exercise is a production path
nobody tests). **ARCH-183 keeps its id.**

**I adopt QD's `ComposeConfigDeps` precomputed-value argument** and note it is stronger than either
of us said: several suites globally `vi.mock('node:child_process')`/the fs layer, so a *callable*
seam resolving `mkdtempSync` inside that mock's scope silently yields `undefined` — the same hazard
DES-255 already cited for `confinementProbe`. Pass the resolved value, not a resolver.

**One thing neither r1 said**: under my A3 ruling (§4) `denyRead = [workRoot, …]`, so a `workRoot`
that can still be `undefined` does not merely shrink the deny list — **the read posture cannot be
constructed at all**. A2 stops being a hardening and becomes ADR-086's precondition. That raises
ARCH-183's priority and couples the two cards' ordering.

**(c) cost, held from r1**: this is a breaking `ServerConfig` change across a tree ~20 implementers
share. **One task, one owner, one commit** (the TASK-253 rule). Do not let it ride inside another
card.

---

## 4. A3 — QD's own option (ii) *is* my ruling, delivered by the SDK instead of by a migration

QD offers (i) complete the literals + derive the six config-backed siblings [recommended], and (ii)
consolidate all engine state under one deniable ancestor `<workRoot>/.engine/` [structural, filed
as v38 because of the on-disk layout migration].

**HOLD my r1 ruling, and here is the sentence that should end this dispute:
`DENY_READ_MODE='workroot'` IS QD's option (ii).** `denyRead: [workRoot]` *is* the single deniable
ancestor — delivered by the SDK's own schema, with **zero on-disk layout migration**, touching none
of `workflow-catalog.ts` / `asset-sync.ts` / `webhook-registry.ts` / `scheduler.ts` and no existing
deployment's directory layout. QD filed their own preferred end-state as out-of-scope because they
priced it as a filesystem move; priced correctly it is a one-line constant and a deleted branch.
Their residue (operator overrides pointing *outside* `workRoot`) is exactly my r1's
composed-config-derived entries, and their two genuinely knob-less literals (`mcp-registry.db`,
`_global_assets`) both live under `workRoot` and are covered by the ancestor for free.

**Three measurements that decide it, all verified this round:**

1. **A9 stands, verbatim from the vendor.** `sdk.d.ts:5862-5864`: `allowRead` = *"Paths to
   **re-allow** reading within `denyRead` regions. **Takes precedence over** `denyRead` for matching
   paths."* Reads are **default-allow**; `allowRead` is a punch-out, not an allowlist. Under the
   shipped `'enumerated'` arm `denyRead` and `allowRead` are **disjoint sets**, so `allowRead:
   allowPaths` (`bash-confinement.ts:63`) punches nothing out — **a field that does nothing, in the
   module whose stated purpose is 「the posture IS the design」**. And sibling run workspaces
   (`<workRoot>/workflows/<name>/runs/<id>`) match no `ENGINE_STATE_DENY` entry, so the third
   exposure REQ-218's own 風險面 names — 「其他 run 的 workspace」 — **is not covered by the arm we
   call the control**.
2. **The list is already wrong in the direction nobody checked.** QD found entries *missing*. I
   found one that is a **phantom**: `ENGINE_STATE_DENY` names `'continuations.db'`, and there is **no
   production construction site for it anywhere** — `grep -rn continuation src/` returns only
   comments, a `ServerConfig` field, and the deny entry itself. (Separately and out of scope:
   `continuationDbPath` is forwarded by `composeConfig` and read by **no production consumer**,
   while `compose-config-v2-wiring.test.ts:166` asserts the forwarding — a green test locking a wire
   to nowhere. That is REQ-219's own bug class, found in REQ-219's own iteration. Route it, do not
   fold it in.) A hand-maintained list that is simultaneously incomplete *and* naming a file that is
   never created is the strongest possible argument against "complete the list."
3. **There is no safe intermediate, and this dissolves the S7 framing.** I looked for one: keep
   `'enumerated'` but add `'workflows'` and punch out this run's own workspace via `allowRead`. That
   closes A9 — and it carries the *identical* risk profile to `'workroot'`, because **any** design
   that closes A9 must deny a region containing the run's own workspace and re-allow it. The
   punch-out must work either way. Once you accept the punch-out, `[workRoot]` is strictly simpler
   than nine entries plus `'workflows'`. Karpathy settles it. So the choice is binary: **close A9
   (needs the punch-out) or leave cross-run reads open.** "Complete the enumeration" is the option
   that buys a green test and no security.

**Ruling (ADR-086, id held): record `'workroot'` as the decision, delete the `'enumerated'` arm and
`ENGINE_STATE_DENY` at the flip, and derive the outside-`workRoot` operator overrides from the
composed config as values, never from key names.** A3 does not get a completeness invariant — A3
**ceases to exist**. A6 inverts (the shipped arm is the dead one). A8 resolves for ARCH-176.
**INV-V37-4 keeps its id** and its mechanical check: every config value naming an engine-written
path appears in `denyRead` — a test that can actually fail, unlike `bash-confinement.test.ts:30`
asserting a constant against itself.

**Purity — AGREE with QD's risk, no daylight.** The derivation happens at the composition root and
arrives as `protectedFiles`-shaped data. `buildBashConfinement()` stays fs/process/env/clock-free
(ARCH-175). Derived once at boot into a frozen array: zero per-call allocation, which also settles
my own (b)-vs-(a) conflict from r1.

### The interim, so this send-back item is actually answered this iteration

§6 D1 concedes the constant should not flip until S7 measures positive. Read together with "A3
ceases to exist", that would leave the implementer shipping the same phantom-bearing list for
another iteration and A3 unanswered. It must not. **A3 gets a real fix now, explicitly labelled as
a bridge that dies at the flip** — this is QD's option (i), minus the one part of it that would be
thrown away:

1. **Remove the `'continuations.db'` phantom** (no production construction site exists).
2. **Add QD's two knob-less literals** `mcp-registry.db`, `_global_assets` — correctly identified by
   them as having no `FileConfig` key, so a literal is the honest answer, not an oversight.
3. **Take the six knob-backed paths from the composed config as resolved values, unconditionally.**
   After ARCH-183 all six (`casDir`, `webhookDbPath`, `schedulerDbPath`, `continuationDbPath`,
   `selfUpdateDbPath`, `assetRoot`) are strings, so `denyRead` simply includes them — no
   is-it-inside-`workRoot` branch per value. Their literals (`cas`, `assets`, `webhooks.db`,
   `schedules.db`) therefore **leave** `ENGINE_STATE_DENY`, which shrinks to the genuinely knob-less
   set: `store`, `catalog.db`, `auth-tokens.db`, plus QD's `mcp-registry.db` and `_global_assets`
   (`'store'` verified real and knob-less — `server.ts:676`, `:876`). This is the part that is **not**
   throwaway: after the flip, `denyRead: [workRoot]` still cannot reach an override pointed *outside*
   `workRoot`, so the config-derived half is needed either way. It depends on ARCH-183 having landed
   (§3) — before the hoist five of the six are `undefined`, which is QD's own measurement and the
   reason A2 and A3 are one ordering, not two problems.
4. **INV-V37-4's test over the derived set** — a test that can fail, replacing
   `bash-confinement.test.ts:30`'s constant-against-itself.
5. **NOT a census test** cross-checking the list against every `join(workRoot, …)` literal under
   `src/`. QD proposed it; I decline it *specifically because* of D1. It is the one item that exists
   only to maintain the enumeration, so it is pure throwaway the day the enumeration dies — and it
   would need deleting in the same change that deletes the arm, which is work created to be undone.

The header comment on `ENGINE_STATE_DENY` must say what it now is: **a bridge maintained until S7,
deleted at the flip, not a control anyone should extend.** A reader who finds it in six months needs
to know it was already scheduled for deletion when it was last edited.

**What I concede on timing → §6, disagreement #1.**

---

## 5. A4, O-1, A5, C-1 — converged, one line each

- **A4** — AGREE with QD, identical fix: INV-V37-1/2 reworded posture-conditional. My one addition
  they did not state: **the `unconfined` branch must be written out loud** ("no filesystem
  confinement is attempted for any run; the only control in force is the admission refusal"). A
  reader must not infer the degraded posture from the absence of a sentence. `rtm.md:240` re-pointed
  **after** ARCH-182 has an id, or it needs a second edit.
- **O-1** — AGREE, and I agree with QD *and* Gate 8 that the event must **not** be built: on a host
  that never attempts confinement it is an event that structurally cannot fire, the same defect as
  VAL-255's always-empty `phases[].agents`. ARCH-178 amended in place with an event-shaped trigger.
- **A5** — agreed, impl/tests-owned. Architecture's one sentence: both failure directions of the
  posture hop are **silently insecure** (drop one ⇒ every remote submission admitted; drop the other
  ⇒ every run unconfined). INV-V37-5 holds, with my r1's "shrinks the obligation" claim withdrawn
  (§1).
- **C-1** — agreed, impl-owned. `refusalEnvelope(code: ErrorCode, …)`: a type is smaller than a test
  and closes the class.
- **Observability — CONCEDE to QD, explicitly.** My r1 §6.4 said the denial-event schema belongs to
  whoever owns observability and I declined to design it. QD designed it, and their distinction is
  one I missed: the *admission refusal* event **can** fire on this host (posture `unconfined` +
  remote origin), unlike `agent.confinement_denied`. I adopt their shape
  (`{runId: undefined, startedBy, posture, reason}`) and their observation that the absent `runId`
  is itself informative. I add one clause: whichever module holds the refusal after ARCH-182 emits
  it — that is now `RunManager`, not `call-tool.ts`.

---

## 6. Remaining disagreements (two)

**D1 — WHEN to flip `DENY_READ_MODE`.** QD's self-sustainability lens is allergic to ruling on an
arm no host can execute, and `bash-confinement.ts:12-16` backs them: the constant is 「fixed by spike
S7」, S7 was **inconclusive** (blocked by the same apply-seccomp/AppArmor failure as S1), and
ARCH-175's own instruction is that a *positive* S7 flips it.

*My position, narrowed to the smallest honest claim*: **record the direction now, bind the constant
flip to S7 at the first host that measures `confined`.** I concede the flip should not ship
unmeasured. My argument for recording it now is failure-mode asymmetry, not schema-reading:
`'enumerated'` wrong ⇒ a **silent** cross-run read that no test on any host can surface;
`'workroot'` wrong ⇒ **every run dies loudly** on the first confined host — which is by definition a
validation host. A control whose failure is loud on a host that is watching beats one whose failure
is silent everywhere.

*What I will not accept, and I want this on the record before r3*: **"flip the default but keep the
`'enumerated'` arm"**. That ships a dead branch with a green test — REQ-219's exact bug class, in
REQ-219's own iteration, and my own lens would have to file it next round. The arm dies at the flip,
in the same change, per ARCH-175's own instruction.

*What must happen in the meantime, and this is the part I will not trade*: while `'enumerated'`
ships, **REQ-218's `rtm.md` row must record 「其他 run 的 workspace」 as UNCOVERED**, not silently
green. A9 is a live exposure in the arm we call the control, and the trace must say so.

**D2 — the legacy-row default (`DEFAULT 'local'`).** Unchanged from r1, and QD named the same
trade-off independently without resolving it. **I hold, and I say plainly that I am holding rather
than answering.** Fail-closed (`'remote'`) refuses every pre-existing workflow version until an
operator re-registers it — a silent outage on an unconfined host where nothing was ever protected
anyway. Fail-open grandfathers the incident host's 2026-09-20 remote submission through exactly the
control built to stop it. I rule `'local'` + a boot WARN naming the count of un-stamped versions + a
DEPLOY.md sweep rider, and per QD's own observability argument the value must be **visible in
`workflow_list`** — the sweep is not a performable instruction otherwise. **This is recorded as
unresolved-by-design.** My r1 asked the next round to push on it; QD did not, so it stands unpushed.
If r3 has an argument, it should be made there rather than inherited.

---

## 7. Internal conflicts between my own lenses (this round)

- **(a) vs Karpathy — settled in Karpathy's favour, which is new.** In r1 security bought two
  columns. The version row gives security a *stronger* control (it closes the operator-runs-the-
  attacker's-workflow path my two columns admitted) for *one* migration and *zero* new queries.
  Both lenses win; my r1 traded them for no reason.
- **Karpathy vs (a) — the near-miss, recorded because it is the instructive one.** Simplicity-first
  told me the version row subsumed `RunSpec.origin` and I drafted the deletion. It does not: it would
  have deleted the only door with real-tier evidence, to make a diff smaller. The tie-breaker is
  "the minimum architecture that **solves the problem**" — a smaller design that silently drops a
  verified control has not solved it. Simplicity is a tie-breaker between designs that both hold, not
  a licence to shed a control that is already holding.
- **(a) vs (c) — D2's default.** Security says fail closed; operability and testability say a
  migration must not black out every existing workflow. Security lost again, and again I have marked
  it rather than resolved it.
- **(a) vs (c) — ADR-086's unmeasurability (D1).** Security rules the *direction*; testability rules
  the *trust*. The split is deliberate and the concession on timing is where testability took ground
  from r1.
- **(b) — silent this round.** Every ruling here is a column on an existing SELECT, a constant, or a
  deleted branch. Nothing I propose is measurable at runtime, and I decline to manufacture a
  performance argument to fill the slot.

---

## 8. Where the panel stands

**Converged**: choke point (`RunManager.start`/`resume`); persisted origin *plus* the submission
peer for the one route where they coincide; A3's interim bridge (QD's option (i) minus the census
test); the A2 hoist
and its precedent; purity of the derivation; A4's posture-conditional rewording; O-1's amendment
with no event built; the refusal event's shape; C-1's typed code.
**Corrected in this round**: the admission-site census (4 sites, no `chain`, twin scheduler
dispatchers); the origin row (version, not workflow, not triggers); resume needs no second fact;
`ENGINE_STATE_DENY` contains a phantom.
**Open**: D1 (flip timing), D2 (legacy default).

---

# ADDENDUM — v37 Gate 8 **round-2** send-back, debate **round 2**

*Adversarial architecture group (security / scalability / testability, Karpathy simplicity as
tie-break). Written 2026-09-23 after reading `quality-dimensions.r1.md` in full. **Appended, not
overwritten** — this file's original content is the Gate-2 round-2 record that my own
`adversarial.r1.md` ADDENDUM 2 §1.3 cites by section number ("my own r2 §1 design"); deleting it
would break a live cross-reference in the same panel directory. Scope is the round-2 send-back
items only: B1, B2, B4, B3, QD-MED, B5/B6, and B7 (which I am still asking to pull in).*

**Headline.** We converged on more than the r1s predicted. The shared error classifier, the B3
mirror, the rule-shaped guide sentence and the INV-V37-5 enumeration are all agreed by both lenses
from independent starting points. The one place QD and I genuinely diverged — B2's fix shape — I
**rebut on cost and concede on premise**, and the two premises turn out to be one: QD's
zero-operator-action re-arm and my coverage-zero-on-legacy are two readings of the same wrong
sentence in ARCH-182. That merges into **one** `owner_decision`, not two. Two disagreements
survive, both small and both stated as such: whether B7 is in scope, and how many words
`RefusalReason` grows by.

---

## 1. Disagreement ledger (verdict first, reason second)

| # | Item | QD's r1 position | My verdict |
|---|---|---|---|
| RD1 | B2 fix shape | fire-path-only OR of `trigger.createdRemote` ∨ version origin; then retreat to "flag `claim()`-after-creation" | **rebut both, concede the premise** — §2 |
| RD2 | B2 relay | a *fresh* `owner_decision` distinct from `:5756` | **concede, and merge with mine** — §2.4 |
| RD3 | B4 mapper | `admissionErrorToOutcome`, 4 call sites | **converged** — §3 |
| RD4 | `RefusalReason` width | grow by **two** words | **hold at one** — §3.2 |
| RD5 | B7 | filed as v38 debt, "not proposing a fix this round" | **hold — and QD already argued my side** — §4 |
| RD6 | B1 remedy | reword INV-V37-5 to enumerate both hops; would accept "architecture only owns the reword" | **concede the enumeration, hold the structure** — §5 |
| RD7 | B3 | mirror the existing boolean, no tri-state | **converged** — §6 |
| RD8 | QD-MED | rule-shaped guide sentence, no mechanism | **concede to QD, against my own r1** — §7 |
| RD9 | B5/B6 | barely touched | no conflict — §8 |

---

## 2. RD1/RD2 — B2: the cheap fix is not cheap, and our two premises are one premise

### 2.1 REBUT — "fire-path-only" does not buy what QD prices it at

QD's narrowing is genuinely well-motivated: refuse on the trigger path only, leave local
`run_start` exactly where ADR-083 left it, stay additive. I wanted it to work. It does not, and QD
is the one who found the reason, in their own Self-sustainability section: per ADR-086's ruling text
(`02-architecture.md:5757`), *"production catalog 現有的工作流程**全部**是遠端註冊的"*, naming
`jev-haiku` v4's hourly health check explicitly. OR version-origin into the fire path and **every
existing scheduled and webhook fire on that host is refused** — the identical blackout the owner
rejected, delivered through two of the four routes instead of four.

**And the escape hatch people will reach for does not exist.** I checked whether the blackout could
be avoided by a kind `DEFAULT`. It cannot, and this is the sharpest new fact of the round:

- `workflow_versions` (`workflow-catalog.ts:267`, with the later `ALTER TABLE`s at `:322-327`)
  carries `name, version, script, defaults, params, mermaid, triggers, createdAt, diagram_contract`
  — **no `createdBy`, no origin, nothing about where a registration came from.** Adding version
  origin is a new column with a backfill decision attached, exactly like `createdRemote` was.
- **The catalog knows *who*, never *from where*.** `workflows.owner` does exist
  (`workflow-catalog.ts:242-243`, backfilled to the operator email at boot, `:86`/`:255`) — so a
  reader may object that provenance is already on disk. It is not: `owner` is an **identity**, and
  the ruling at `:5757` records that this same identity (`owner=hsuhungjung@gmail.com`) registered
  every existing workflow **remotely**. That is ADR-083's distinction exactly — the threat surface
  is 遠端提交, not an untrusted principal — and it is why **no existing column can be backfilled
  into an origin**: the one column that looks like a candidate is uniformly the trusted operator
  and uniformly remote.
- For `createdRemote` the cheap backfill (`DEFAULT 0` = local) is *unverified* — it might be true
  for some rows. For version origin the cheap backfill is **known false**: the owner has stated on
  the record that every existing workflow is remote-registered. An honest backfill is `'remote'`,
  and an honest backfill **is** the blackout.

So the choice is not "expensive option vs. cheap option". It is binary and the two ends are already
on my r1 table: **the automated fires stop on this host, or the control refuses nothing on it.**
There is no third column that makes this cheaper, and I withdraw any suggestion that QD's narrowing
is a middle path. It is option (ii) with a smaller blast radius — which is a real improvement and I
credit it below — not a different kind of option.

### 2.2 REBUT — the `claim()` flag misses the path it is named after

QD's fallback ("detect and flag `claim()`-after-creation as an event the operator should confirm")
is weaker than their own first proposal, for two measured reasons and one Karpathy reason:

1. **`claim()`'s `'held'` arm returns before any `UPDATE`** (`webhook-registry.ts:211-219`, read in
   full). The re-register path — the one QD's own B2 narrative runs through — hits that arm. A flag
   written in `claim()` never fires on it.
2. **The bytes that execute are chosen one call later.** Both dispatch sites resolve through
   `catalog.resolve(workflow, {channel:'release'})`. `claim()` binds an *id*; `workflow_publish`
   decides which *script* that id will run. The laundering event is the release-pointer move, not
   the claim.
3. It invents a confirmation surface with no actor: nothing in this engine notifies an operator or
   holds a decision pending one. That is a new mechanism bought to avoid a decision — the same
   thing I declined my own local-allowlist for in r1 §1.3. **Consistency demands I decline QD's too.**

### 2.3 CONCEDE — QD's premise correction is right, and it is my premise

QD: the owner's `:5756` ruling priced a residual that requires *"操作者在本機誤按啟動"* — a human
pressing a button; B2's path needs no human at all, because the trigger fires itself. That is
correct and it is the same defect I argued from the other end: I said ARCH-182's refusal arm is
**unreachable** for the pre-v37 trigger population (`createdRemote` is written at exactly two
`INSERT` sites, `webhook-registry.ts:170-176` / `scheduler.ts:294-307`, and nothing in the lifecycle
re-stamps it). QD said the trust **degrades** on unattended operation. Both are consequences of one
sentence being wrong: **ARCH-182 says provenance tracks attachment; the code records row creation.**
Start from creation-time truth and you get my coverage-zero at upgrade *and* QD's re-arm afterwards,
automatically. I therefore drop my framing's claim to priority ("the first-order fact is simpler"
— r1 ADDENDUM 2 Summary ¶1): neither is first-order, the premise is.

### 2.4 The merged relay (RD2 — concede, with one amendment)

QD asks for a fresh `owner_decision` distinct from the answered `:5756`. Agreed, and it must be
**one** item carrying both facts, because an owner given only one of them can reasonably pick an
option that the other one defeats:

> **`owner_decision` (v37-B2).** ADR-086's 2026-09-23 ruling was taken against the premise that
> `createdRemote` records who *attached* a trigger. It records who *created the row*. Two
> consequences the ruling was not given: (a) every trigger row predating this upgrade reads
> `DEFAULT 0` = local, so ARCH-182 refuses nothing on the existing population — coverage zero, not
> "a residual"; (b) the residual that does exist needs **no operator action** — a cron tick re-runs
> a re-pointed script by itself. Options, costs on my r1 ADDENDUM 2 §1.3 table, ranked
> **(iii) fix the host > (iv) drop `Bash` when `unconfined` (spike first, R6) > (ii) version-origin
> column > (i) keep C and correct the text + sweep**. **(ii) now has a narrower sub-variant, from
> the quality-dimensions lens: apply it to trigger-fired admissions only**, which stops the
> automated fires (on this host: `jev-haiku`'s hourly check) while leaving every workflow runnable
> by local `run_start`. That is a materially smaller blast radius than the one rejected on
> 2026-09-23 and the owner has not ruled on it. Note for whoever relays: the honest backfill for a
> version-origin column is `'remote'` — the owner's own stated fact — so the stoppage is not
> avoidable by choosing a default.

**I upgrade my ranking to put (ii-narrow) above bare (ii)**, on QD's argument, and I leave (iii)/(iv)
above both: they are the only options that make the engine's *own claim* true rather than buying
coverage with a column.

**Unchanged and not owner-gated:** ARCH-182's justifying sentence and ADR-086's consequence
paragraph get corrected **this round**, whatever the owner answers. A wrong premise in an ADR is
worse than a known gap.

---

## 3. RD3/RD4 — B4: converged on the mapper, holding at one vocabulary word

### 3.1 CONVERGED — same function, two names; take QD's

QD proposed `admissionErrorToOutcome(err) -> {code, retryable, httpStatus}` consumed by four call
sites; I proposed `classifyStartRefusal(err) -> {code, retryable, httpStatus}` beside
`admissionRefusal()`. Same object. **Take QD's name** — it is the one that does not imply the error
came from `start()` specifically, which matters if a fifth admission condition ever throws from
elsewhere. Placement: beside `admissionRefusal()` in `run-manager.ts`, so the thrower and the
classifier are read together.

Both of us independently flagged the same premature-abstraction risk against our own proposal (QD's
Risks ¶1; my r1 expected-disagreement ¶). Neither of us is going to raise it against the other, so
let it be recorded as **not a disagreement**: four hand-written mappings with one already wrong and
a second one-find away is not the case the Karpathy tie-break protects. The rule survives: one
function, four consumers, each keeping its own envelope shape.

**One measured correction to QD's version of the ticker twin-bug.** QD writes that
`CONFINEMENT_UNAVAILABLE` and a deleted-catalog-entry failure "are recorded identically via
`markFailed`". Read at `server.ts:1024-1031`: the `.catch()` *does* extract `err.code` when present,
so `lastError` reads `CONFINEMENT_UNAVAILABLE` rather than `DISPATCH_FAILED`. The schedule side is
not blind — it is **misclassified**: a policy refusal is written to the dispatch-failure field,
`refusalCount` never increments, and `scheduler.ts:499`'s own comment (*"`lastError` means dispatch
failed, `lastRefusalReason` means policy refused"*) is violated by the code one file over. That
makes the fix a routing branch, not a new field, which is cheaper than QD's framing implies and is
precisely why B7 rides along (§4).

### 3.2 HOLD — `RefusalReason` grows by ONE word, not two

QD wants `'CONFINEMENT_UNAVAILABLE'` **and** `'RUN_ADMISSION_LIMIT'`. I hold at
`'CONFINEMENT_UNAVAILABLE'` only, on the union's own documented meaning:
`scheduler.ts:499` defines `lastRefusalReason` as *"policy refused before dispatch"*. A concurrency
cap is **capacity, not policy** — it is retryable by construction, and writing it into
`refusalCount` makes the operator-facing counter answer "why did this webhook stop firing?" with a
number that mixes "this host will never run this" and "the host was busy for 200 ms". That is the
exact conflation B4 exists to fix, re-introduced one field over. `RUN_ADMISSION_LIMIT` gets a
`retryable: true` + **503** from the mapper and no durable refusal row; that is the whole of what a
sender needs.

**QD's own open risk on this, closed this round by measurement:** QD flagged "unverified whether
exhaustive switches over `RefusalReason` exist". I grepped `src/` — every one of the ~20 sites is an
assignment, a cast, a column read or a type annotation; the only `switch` on a field named `reason`
is `asset-sync.ts:125`, over an unrelated union. **No exhaustive switch over `RefusalReason` exists,
so widening it cannot break a `never` check.** My own r1 R5 raised the same worry; it is retired for
both of us. The residual ripple is persisted-string readers only, which is a grep, not a redesign.

---

## 4. RD5 — B7: HOLD, and QD has already argued my side

QD files B7 as non-blocking v38 debt "per the reviewer's own routing" — and then writes, in their
Key Points: *"Any fix scoped to `webhook-registry.ts` alone leaves this open."* Those two sentences
cannot both be acted on. The thing QD says must not be left open **is** B7's mechanism: the ticker
routing a permanent refusal through the dispatch-failure writer, hence no `refusalCount`, hence
re-refuse every period forever. QD has argued for touching the ticker; they declined only to use
the label.

**So I read this as agreement and record it as a disagreement about scope-hygiene, not about
engineering.** My position stands: with the mapper in place, B7 is `if
(!admissionErrorToOutcome(err).retryable) scheduler.markRefused(firing, code); else
scheduler.markFailed(firing, code);` — one branch, inside a change we are already making, using
`markRefused` which already takes exactly a `RefusalReason` (`scheduler.ts:501`). Deferring it ships
a known unbounded loop on the one host we know is `unconfined`, and re-opens the same file in v38.

**Scheduling-behaviour risk: none, verified in r1** — since v29/REQ-152 `claimFiring()`
(`scheduler.ts:465-472`) recomputes `nextFire` before dispatch; `markRefused` and `markFailed` are
both pure recorders and disable `once` identically. The only difference is which trio is written.

**What I still do not propose:** auto-disable after N consecutive refusals. Speculative; the counter
makes the condition visible, and visibility was what was missing. (QD's aside about a
"`refusalCount`-driven auto-disable the webhook side already has" is muddled — that write is
`scheduler.ts:515`, `once`-kind only — but nothing either of us is ruling on depends on it.)

---

## 5. RD6 — B1: concede the enumeration, hold the structure, because `resume()` decides it

**CONCEDE, and note we wrote the same sentence independently.** QD: INV-V37-5 must state both hops
as separately-locked obligations so a reader can enumerate two assertions and find one missing. My
r1 §3.2: "INV-V37-5 must name its consumers explicitly … an invariant that does not enumerate its
surface cannot be audited." Converged, no argument.

**HOLD on the structural half, and on QD's own open question.** QD offers to accept the narrow
framing — "architecture's only job is the INV-V37-5 reword" — if another lens raises it. I raise the
opposite, on one fact QD did not have:

- `grep -n "admissionRefusal\|async resume\|async start" src/run-manager.ts` → `admissionRefusal` is
  called at **:473 only**, inside `start()` (`:465`). `async resume(runId)` is at **:848** and never
  calls it. **Re-verified this round.**
- Therefore ARCH-182's headline — *"the ONE predicate every run admission passes"* — is **false as
  written**. `run_resume` is admitted by the `call-tool.ts:124` door alone.
- Therefore the door is **not** redundant (this reversed my own first draft), and B1 is not "three
  test cases": it is a ledger row asserting a property the code does not have — **the same class as
  B2's premise and B5's comments**, in the row that exists to close them. That makes B1
  architecture's finding, which answers QD's own open question in the direction they did not expect.

**Ruling, sequenced (r1 R3, unchanged):** this round — keep the door, extend the predicate to
`resume()` (a required `origin` argument stamped from the resume request's own peer), make the
forwards **required keys with `| undefined` values** (`buildToolDeps`'s
`isRemoteSubmission = false` default is a fail-open default on a security value),
add the never-diverge clause and one **non-vacuous** boot test at
`confinementPosture:'unconfined'` — today's suite exercises the predicate only at `'confined'`,
where it is vacuous. v38 — delete the door and re-point REQ-218's real-tier evidence. Not
simultaneous: deleting first opens a real hole on `resume()`.

To QD's expected objection that a compiler check is not observability: a type error is the most
observable failure available, because it fires before the code exists. That is the one place my
testability lens produced the better *security* answer, and I keep it.

---

## 6. RD7 — B3: converged, with my rider intact

Both lenses: **mirror the existing `createdRemote` boolean onto `WebhookView`/`list()`** (verified
absent — `webhook-registry.ts:50-64`, `:192-202`; `ScheduleStatus` projects it at `scheduler.ts:151`),
**no tri-state.** QD explicitly does not re-ask for the `NULL`-means-unreviewed surface they proposed
in the Gate-2 round; I explicitly supported that decline and still do. One line, no new concept,
unblocks ADR-086's promised sweep and B1's webhook assertion.

**Rider, restated because it is the decline's price:** the decline is defensible only if §2.3's
coverage-zero fact is written where an operator reads it — `DEPLOY.md`. A tri-state is a schema-level
way of saying "we never looked at these rows". Decline the schema *and* the sentence and a
known-empty control ships looking full. **If the sentence does not land, I withdraw the decline.**

---

## 7. RD8 — QD-MED: I concede to QD against my own r1

My r1 wanted the admission-route list to be **data in `errors.ts` that the guide renders**, so code
adding a fifth route is obliged to update the prose. QD wants the guide to state the **rule** —
every run this workflow can trigger is refused identically, regardless of route, when the host is
`unconfined` and the trigger's recorded provenance is remote — instead of enumerating routes at all.

**QD is right and my tie-break says so.** A rule-shaped sentence needs *no mechanism* and cannot go
stale when a fifth route appears; my version buys a rendering pipeline to keep a census accurate
that should not exist. My own r1 set the ceiling ("data in `errors.ts` rendered by the existing
guide is the ceiling") — QD's answer is below it. Karpathy tie-break goes to QD; I drop my proposal.
One paragraph in `authoring-guide.ts:363-369`, rule-shaped, no new surface.

---

## 8. RD9 — B5 / B6: no conflict, two rules carried forward

Unchanged from r1 and unopposed. **B5:** a comment asserting a fact about the code either cites the
line that makes it true or is deleted — `main.ts:182-183` claims a `'confined'` gateway default that
`claude-agent-sdk-client.ts:748` contradicts by deliberate fail-open. REQ-218 exists *because* two
comments contradicted each other; this repair wrote a third instance. **B6:** amend ARCH-177 to the
shipped `workRootDefault?: string` — IMPL-380's call was right — and resolve the tension with §5's
required-keys argument out loud: **optionality is acceptable exactly when the default is the safe
answer, never when it is the permissive one.** That sentence belongs in INV-V37-5, and it is the
one-line rule that separates B6 (fine) from `buildToolDeps`'s default (not fine).

---

## 9. Final position (what I am asking the gate to adopt)

1. **Correct the premise this round, independent of the owner:** ARCH-182 and ADR-086 state that
   `createdRemote` records *row creation* — never attachment, never authorship — and record
   coverage-zero-on-the-legacy-cohort as a first-class consequence.
2. **One merged `owner_decision`** (§2.4) carrying both premise corrections and four-plus-one
   options, ranked **(iii) > (iv, spike first) > (ii-narrow) > (ii) > (i)**.
3. **`admissionErrorToOutcome()`** — QD's name, one pure function, four consumers, each keeping its
   own envelope; wire boundaries emit `code` + static catalog text, `err.message` to logs only.
4. **`RefusalReason` += `'CONFINEMENT_UNAVAILABLE'`** (one word; no exhaustive switch exists to
   break). `RUN_ADMISSION_LIMIT` → retryable + 503, no durable refusal row.
5. **B7 in scope**: one `retryable` branch routing permanent refusals to `markRefused`.
6. **B1**: extend the predicate to `resume()`; required keys for both forwards; keep the door with a
   never-diverge clause; one non-vacuous `unconfined` boot test; INV-V37-5 enumerates its consumers.
   ARCH-182's "ONE predicate" sentence is corrected or made true — it may not stand as written.
7. **B3**: mirror `createdRemote` on `WebhookView` + the `DEPLOY.md` sentence (paired, not separable).
8. **QD-MED**: rule-shaped guide paragraph, no rendering mechanism.
9. **B5/B6**: the two rules in §8, one of them written into INV-V37-5.

## 10. Remaining disagreements (two, both small)

- **B7's scope.** QD defers it to v38 on send-back discipline while simultaneously requiring the
  ticker not be left open; I ask for the branch now. If the gate rules for deferral, the ticker's
  misclassification must be **filed with the corrected mechanism** (`lastError` carries the code but
  `refusalCount` never increments — §3.1), not carried as QD's "recorded identically", or v38
  inherits a wrong description of the bug.
- **`RefusalReason` width.** One word (mine) vs. two (QD's). Decidable in one sentence by the gate:
  does `refusalCount` mean "policy refused" or "did not run"? I say policy, per the field's own
  comment.

*No third disagreement is manufactured. On B2's option ranking both lenses defer to the owner, and
on the mapper, B3, QD-MED and INV-V37-5's enumeration we independently converged.*

*Adversarial architecture group — v37 Gate 8 round-2 send-back, debate round 2, 2026-09-23.*
