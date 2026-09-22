# Adversarial architecture group — debate round 2 (v37 Gate 8 send-back)

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
