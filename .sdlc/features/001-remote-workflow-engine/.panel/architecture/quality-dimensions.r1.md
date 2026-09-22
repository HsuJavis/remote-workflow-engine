# Quality-dimensions lens — Architecture round 1 (independent proposal)

**Scope:** this is not a fresh REQ-218/REQ-219 design — ADR-082/083/084/085 and ARCH-175..181 are
already owner-decided and shipped, and this round does not reopen them. `send_back = [architecture,
impl, validation, tests]` from **v37 GATE 8 — Consistency review (2026-09-22)** names five findings
that are architecture's to fix: **A1** (webhook/scheduler bypass the remote-submission door), **A2**
(`confinement.workRoot` evaporates to `denyRead: []` on the DEPLOY.md-documented optional-workRoot
config), **A3** (`ENGINE_STATE_DENY` is a hand-maintained list, already stale, blind to operator path
overrides), **A4** (INV-V37-1/2 worded as unconditional but false under posture `unconfined`; the
`rtm.md` REQ-218 row cites the mechanism that doesn't run on this host and omits the one that does),
and **O-1** (ARCH-178's row never amended to say `agent.confinement_denied` is deferred despite a
positive S4). C-1 and A5 are impl/tests-owned (a catalog entry, a wiring-lock test) and are out of
this lens's scope. This proposal's job is to fix the five architecture rows, not to re-litigate the
posture-C decision they sit inside. **This file supersedes the Gate-2 `quality-dimensions.r1.md`
this same path held** (`git status --short` on this path shows `M`, so that Gate-2 round is not
lost — it is `HEAD`'s copy, reachable via `git show HEAD:<path>` if ever needed, per this repo's
own read-a-commit rule; this send-back opens a fresh r1/r2 exchange scoped to the five findings
above, at the same conventional path).

## Summary

All five findings are instances of one shape: **a control was specified at one seam and the system
has more than one seam.** A1 is one admission chokepoint assumed where there are four. A2 is one
`workRoot` assumed where the documented config has two behaviors (explicit / auto-tmpdir) and only
one reaches the confinement block. A3 is one hand-authored path list assumed to track N independently
configurable path options. A4 is one invariant text assumed to hold under both measured postures. O-1
is one row assumed to still describe what shipped after a spike changed the answer. Recommended
shape for all five, argued dimension-by-dimension below: **stop asserting single-seam claims that the
code doesn't structurally guarantee — either collapse the seams to one (A1, A3) or write the claim
conditionally on the fact that varies (A2, A4, O-1).** Concretely: move the remote-submission gate's
CHOKEPOINT into `RunManager.start()` (A1's `INLINE_SCRIPT_CLOSED` precedent still holds), but key it
on a **persisted** remoteness signal recorded at the moment a remote party gains the ability to cause
a run — `workflow_register`/`webhook_create`/`schedule_create` time — not on the live request's own
socket peer, because two of the four admission sites (`schedule` ticks, `chain` sub-runs) fire with
no inbound request to read a peer from at all, and the third (`webhook`) is *supposed* to receive
non-loopback deliveries from a legitimate third party (GitHub-shaped), so gating on the delivery's own
peer would refuse an operator's correctly configured webhook exactly as readily as it refuses an
attacker's; hoist `workRoot`'s tmpdir default — currently computed late, inside `server.ts` — up into
`composeConfig()`, so `confinement.workRoot` is never conditionally omitted (A2); **A3 turns out to be
the SAME hoist, extended to five siblings**: `casDir`/`webhookDbPath`/`schedulerDbPath`/
`continuationDbPath`/`selfUpdateDbPath` all default the identical way — `config?.X ?? join(workRoot,
'<literal>')` — but *inside `server.ts`*, not at `main.ts`'s composition root (`main.ts:348`'s own
comment names this explicitly: "server.ts's own defaults... them"), so `ARCH-177`'s `protectedFiles`
today sees `undefined` for every one of the five on a zero-config deployment, not a resolved path;
complete `ENGINE_STATE_DENY` with the two genuinely knob-less literals the reviewer found missing
(`mcp-registry.db`, `_global_assets` — no `FileConfig` key exists for either) and, for the five
siblings, hoist their `join(workRoot, ...)` defaults to the SAME composition-root point A2 already
needs, so both arrive as one resolved-value read, not two problems; reword INV-V37-1/2 as
posture-conditional and repoint the `rtm.md` REQ-218 trace row at ARCH-181 (A4); and amend ARCH-178's
row in place, one sentence (O-1).

## Altitude call

**Both, and this send-back sits mostly on the plain-system half.** REQ-218/219's original design
question (v37 Gate 2) was squarely on the seam between agent altitude (a spawned CLI's Bash tool)
and system altitude (kernel confinement) — that question is closed. What GATE 8 found is different in
kind: A1 is an HTTP-server admission-control gap (webhook/scheduler routes bypassing a check that
lives in a third route's handler) — conventional system architecture, no agent behavior involved. A2
is a config-composition gap (`composeConfig()` not forwarding a computed default) — the exact
`composeConfig` 佈線 bug-class this repo's own memory names, again conventional. A3 is a
maintainability gap in a literal array versus the config surface that actually varies it —
conventional. A4 and O-1 are documentation-consistency gaps in the architecture ledger itself. None
of the five is about the agent's chain-of-thought, tool-call sequence, or LLM-backend pluggability —
so below I apply plain-system altitude throughout, and I call out the one place (O-1, Observability)
where the *subject* of the fix is an agent-emitted event even though the *fix itself* is system-side
(editing a row, not building the event).

## 1. Observability

**A1 — the door's own refusal is invisible to the operator.** `call-tool.ts:120-124` returns
`CONFINEMENT_UNAVAILABLE` straight to the caller and emits nothing to the event sink — confirmed by
reading the block: no `emit(...)` call anywhere near the refusal, unlike `agent.confinement`
(ARCH-178), which fires for every run that *starts*. A refused remote-admission attempt is exactly
the event an operator investigating "why didn't my webhook fire" — or auditing for the next 9/20-class
incident — needs in the journal, and today it produces zero journal lines regardless of which of the
three admission sites reaches it. This is additive to A1's headline fix, not a substitute for it: the
recommendation below (§ synthesis) is to put the gate in `RunManager.start()`, and whichever module
ends up holding the refusal should emit one line, same shape as `agent.confinement`
(`{runId: undefined, startedBy, posture, reason: 'CONFINEMENT_UNAVAILABLE'}` — no `runId` exists yet
at refusal time, which is itself informative: the event's own shape proves the run never got as far as
having one).

**A4 — INV-V37-1 as worded is a claim the system cannot honor under its own accepted posture, and an
unfalsifiable invariant is worse than no invariant.** "No agent Bash write may land outside {workspace}
∪ {granted paths}" is true only when `posture === 'confined'`; under `'unconfined'` (this host, today,
per ADR-083's own owner_decision) a **local** submission's Bash is genuinely unconstrained by design —
`buildBashConfinement()` is never even called (ARCH-176's Gate-6 amendment). An invariant that is
silently false on the one host this ledger has actually measured is not observable to the next
architect who reads it — they will believe INV-V37-1 holds, exactly the failure mode ARCH-176's own
`BUILT_IN_CORE_TOOLS`-vs-`V3-residual` contradiction was written to retire. The fix is the same
discipline ARCH-176 already applied to its two comments: state the invariant per posture, not as an
unconditional universal. Same for INV-V37-2 (denyWrite-on-workspace-settings only matters in the
`confined` arm; under `unconfined` there is no policy object to protect). The `rtm.md` REQ-218 row
compounds this: citing ARCH-175..178 (the mechanism that never runs on the measured host) while
omitting ARCH-181 (the door, which is the only control actually active here) means a reader who
traces REQ-218's evidence lands on inert code — the trace itself is the thing that isn't observable.

**A3 — a hand-maintained deny list is a standing observability debt, not just a completeness bug.**
Every time an operator sets `casDir`/`webhookDbPath`/`schedulerDbPath`/`continuationDbPath` away from
its default (all six documented, resolvable), the actual set of engine-state files diverges from what
`ENGINE_STATE_DENY` protects, and nothing surfaces that divergence — not a boot warning, not a log
line, not a test (the one test that exists is tautological against the same constant, per the
reviewer's A3 finding). An operator has no way to observe that their own documented config choice
silently shrank the protected set.

## 2. Replaceability

**A1 — the real defect is that the admission check was NOT made replaceable/reusable across ingress
modules, so it had to be copy-pasted, and it wasn't.** `call-tool.ts`, `webhook-registry.ts`, and
`scheduler.ts` are three independently evolving modules that each start Bash-capable runs; ARCH-181's
own text asserted "both are the only two" without checking `webhook-registry.ts:305` and
`scheduler.ts:363`, both of which call `RunManager.start()` directly. `RunManager.start()` already
has exactly this shape of chokepoint — `INLINE_SCRIPT_CLOSED` is enforced once, at the top of
`start()`, "even off the wire," specifically because REQ-098's ban needed to hold for a caller that
"bypasses the MCP schema entirely and calls RunManager directly" (the comment's own words). The
confinement-door check is the same class of concern and belongs at the same seam: one check, one
place, reused by construction rather than by discipline. Putting it in `call-tool.ts` made it
non-reusable — the door and the RunManager convergence point are two different modules, and only one
of them is where all four admissions actually meet. **The chokepoint (`RunManager.start()`) and the
INPUT to the check (what counts as "remote") are two separate decisions, and only the first one
transfers cleanly from the `call-tool.ts` precedent** — see § Recommended concrete decisions below for
why the input needs its own seam (a persisted origin, not the live request's peer), because `schedule`
and `chain` admissions have no live request to read a peer from at all, and `webhook`'s live peer is
expected-non-loopback by the feature's own design.

**A3 — the reusable fix is NOT "read an already-resolved `ServerConfig` field", it is hoisting a
default-resolution step that today lives in the wrong module.** `ARCH-177` resolves `protectedFiles`
from `deps.configPath` and `workRoot` at `main.ts`'s composition root, but the six operator-overridable
DB/dir paths the reviewer names are not uniformly resolved there: `assetRoot` IS
(`main.ts:295`, `fileConfig.assetRoot ?? (workRoot ? join(workRoot, 'assets') : undefined)`) — the one
correct precedent to copy — but `casDir`/`webhookDbPath`/`schedulerDbPath`/`continuationDbPath`/
`selfUpdateDbPath` are forwarded RAW at `main.ts` (`fileConfig.casDir`, etc., `:290,323,352-354`) with
their `join(workRoot, '<literal>')` defaults applied later, *inside `server.ts`*
(`:774,812,820,671-672` — `main.ts:348`'s own comment names this split explicitly: "server.ts's own
defaults... them"). So on the single most common deployment shape — an operator who sets none of
these six — `ARCH-177` sees `undefined` for five of them today, not a resolved path; reusability here
means hoisting `server.ts`'s five defaults up to where `assetRoot`'s already lives, which is the SAME
hoist A2 needs for `workRoot` itself. **Separately, two of the reviewer's three named-missing files
have no config knob to derive from at all** — `mcp-registry.db` is `join(this._workRoot,
'mcp-registry.db')`, a literal in `workflow-catalog.ts:398`, and `_global_assets` is `join(workRoot,
'_global_assets')`, a literal in `asset-sync.ts:145`; neither path is ever overridden by any
`FileConfig` key (confirmed: no `mcpRegistryDbPath`/`globalAssetsPath`-shaped key anywhere in
`main.ts`). Those two stay named literals by necessity — see § Recommended
concrete decisions for the two-option split this forces.

**Where this dimension does NOT ask for new abstraction:** A2 (and, per the correction above, A3's
config-hoist half) are not replaceability problems in the "new interface" sense — they are a
config-defaulting bug, now understood as one bug with two visible symptoms rather than two — and A4/O-1
are a documentation-consistency bug; inventing an interface for any of these would be exactly the
premature-abstraction move this same lens conceded away in the prior round (the `WorkspaceConfinement`
interface withdrawal, ARCH-175's own
note). No new port, no second implementation, on either.

## 3. Consumability

**A1 — if the gate moves to `RunManager.start()`, the three callers must not learn about the refusal
in three different shapes.** Today: `call-tool.ts` returns a typed `refusalEnvelope` (MCP JSON-RPC
shape); `webhook-registry.ts`'s `deliver()` returns `{ok:false, httpStatus, reason, code}` via its own
`_recordRefusal` idiom; `scheduler.ts`'s `trigger()` returns a `ScheduleResult<{runId}>` with
`{error:{code, message, field?}}`. If `RunManager.start()` throws `codedError('CONFINEMENT_UNAVAILABLE', ...)`
uniformly, each caller's existing catch/translate path needs to map that ONE thrown shape into ITS
OWN existing idiom (the webhook route already has a `try/catch` around `runManager.start()`-adjacent
calls elsewhere in the file, per `_recordRefusal`'s pattern; the scheduler's `trigger()` does not
currently catch anything from `start()` at all — that gap needs naming, not assuming it already
exists, or the fix regresses to an uncaught throw → HTTP 500 for a webhook caller who deserves a 409
with a code, exactly the "generic complaint, not a migration-shaped answer" anti-pattern
`call-tool.ts`'s own comment on `INLINE_SCRIPT_CLOSED` was written to avoid). This is why the
recommendation below asks implementation to inventory all three call sites' error handling in the
same change, not treat "move the check" as a one-line diff.

**A2 — "optional, auto-tmpdir default" is consumability language in `DEPLOY.md`'s own 設定總表, and
consumability requires the two paths it describes (explicit `workRoot` / omitted `workRoot`) to
behave the same with respect to every OTHER documented guarantee, including this one.** An operator
who reads the table, sees `workRoot` marked optional, and reasonably omits it for a low-stakes
deployment gets a silently weaker security posture than the table's own REQ-018/ARCH-007 prose
promises — with no error, no warning, nothing in `--check-config`'s output (unverified either way in
this pass, but nothing in `main.ts:245-260` suggests it checks this). A config surface with a silent
mode that quietly forfeits a documented invariant is a bad-faith contract with an operator who did
exactly what the docs told them to do.

**A3 — same shape as A2, smaller radius.** An operator who sets `casDir` (a documented, supported
override) gets a `sandbox` deny-list that still protects the OLD default location, not the one their
own config now points at. The consumability cost lands on the operator who followed the docs
correctly, which is the worst place for a security-relevant silent gap to land.

**A4/O-1 — the `rtm.md` row and ARCH-178's row are consumability surfaces for the NEXT architect,**
not for an operator or a remote caller — but "consumability" as this lens frames it is about
integration cost for any consumer of the artifact, and a trace row that points at the wrong mechanism
imposes a real cost: whoever next touches REQ-218 will read ARCH-175..178, believe the kernel enforces
this on the measured host, and build on a premise that is false today. Fixing both rows is the cheapest
possible instance of this dimension's concern — no schema, no new surface, one sentence each.

## 4. Self-sustainability

**A3 is centrally a self-sustainability finding: a hand-maintained list requires a human to remember
to update it every time a DIFFERENT, unrelated config surface changes, and nothing forces that
remembering.** `casDir`/`webhookDbPath`/etc. are ordinary deployment knobs an operator can and does
turn without touching `bash-confinement.ts` at all — there is no coupling forcing the two to move
together, which is exactly the shape of drift that survives silently until an incident. Deriving the
deny list from the same resolved config `ARCH-177` already assembles removes the coupling requirement
entirely: the list becomes correct by construction, one edit away from zero maintenance instead of
eight-entries-of-vigilance away from it. This is the same "review-free switch" concern ADR-083/A2
already names for the posture flip — a control that degrades without anyone deciding to degrade it is
the self-sustainability failure mode this dimension exists to catch, and A3 is a second instance of it
in the same iteration.

**A2 is the same failure mode at the config layer**: `ADR-083`'s revisit trigger is explicitly an
EVENT ("upstream CLI no longer needs nested userns, or the owner decides to flip policy") specifically
so the posture reverses "without a re-debate." An omitted `workRoot` reversing `denyRead` to `[]` is
the same kind of silent reversal, but triggered by an ordinary config omission rather than a deliberate
ADR-anticipated event — nobody decided to weaken the posture, a default cascade did it for them. A
system that is meant to survive long-term with minimal human intervention needs its defaults to
compose toward the SAME guarantee regardless of which optional key is set, not toward a materially
different one depending on an unrelated key's absence.

**A1, self-sustainability framing**: `RunManager.start()` is already the place this codebase chose,
once, to make an admission rule hold "even off the wire" (`INLINE_SCRIPT_CLOSED`'s own justification).
A check placed at one of three convergent call sites needs a human to remember, for every future new
admission path, to add the check there too — `webhook_registry.ts`/`scheduler.ts` are the second
instance of exactly this omission in this same iteration (the first being the `INLINE_SCRIPT_CLOSED`
precedent that DID get this right by putting it at the convergence point). Putting A1's fix at the
convergence point is not just cleaner, it is the one placement that doesn't need a human to remember
anything the next time a fourth ingress module is added.

**Credit, not just findings**: the boot-time `confinementProbe` (ARCH-181) is itself a working
instance of this dimension's "tool-liveness check" idea — it re-measures a real host fact (nested
bwrap userns) once per boot rather than trusting a config flag, and ADR-083's revisit trigger is
phrased as an event specifically so the system's posture can correct itself when the underlying host
fact changes. That discipline is sound and this round's fixes (A2, A3) are asking for the SAME
discipline to be applied one layer further out — to config composition, not just to host measurement.

## Recommended concrete decisions (synthesis, for the panel to converge on)

1. **A1**: keep the chokepoint at `RunManager.start()` (the `INLINE_SCRIPT_CLOSED` precedent), but key
   it on a **persisted** origin signal, not the live request's peer. Rationale, walked per admission
   site: `schedule` ticks and `chain` sub-runs fire with **no inbound request at all** — a
   ticker-driven `scheduler.ts:363` call has no socket to read `isLoopbackPeer` from, so "hardcoded
   non-remote" (this proposal's own first draft) is wrong — a remote caller can `workflow_register`
   then `schedule_create` an ungated resident trigger and the ticker admits Bash-capable work from a
   workflow nobody local ever approved, the SAME incident class ADR-083 exists to intercept, through a
   door this draft itself would have left unlocked. `webhook` deliveries are, by the feature's own
   design, expected to arrive from a non-loopback peer (a GitHub-shaped integration) — gating on the
   DELIVERY's own peer refuses an operator's correctly configured webhook exactly as readily as an
   attacker's, a functional regression on legitimate use. `client` (a direct `run_start`/`run_resume`
   over `tools/call`) is the one site where the live request genuinely IS the submission, and
   `isRemoteSubmission` is already computed in scope for it (`server.ts:1168`, inside the same
   `createHttpServer` closure the webhook branch at `:1450` also runs in — confirmed by reading the
   enclosing function, so this is NOT new plumbing for that one site). The signal that covers all four
   sites uniformly is recorded **at the moment a remote party gains the ability to cause a run** —
   `workflow_register` (was the registering caller's peer non-loopback?) and/or `webhook_create`/
   `schedule_create` (same question at binding-creation time) — persisted on the catalog/webhook/
   schedule row, with `RunManager.start()` reading it from `spec`/the persisted row rather than from
   `ToolDeps`. This also matches ADR-083's owner_decision **literally**: 「另一台機器送來的工作流程」
   names the *workflow's* origin, not the triggering request's origin. `chain` sub-runs never need
   independent gating — they exist only as children of an already-admitted parent run, so they inherit
   whatever the parent's admission already decided. **Open migration question, named for the panel, not
   resolved here**: pre-v37 catalog/webhook/schedule rows carry no persisted origin — backfill them as
   `local` (permissive; matches today's de facto behavior, no existing legitimate webhook/schedule
   breaks) or fail-closed as `remote` (safer default, but refuses every pre-existing binding until an
   operator re-registers it). `ARCH-181`'s false "only two" claim is corrected in the same edit that
   relocates the check.
2. **A2 and A3 are ONE hoist, not two fixes** — resolve `workRoot`'s own tmpdir default (currently
   `server.ts`'s), plus the five sibling defaults that share its exact shape (`casDir`,
   `webhookDbPath`, `schedulerDbPath`, `continuationDbPath`, `selfUpdateDbPath` — each
   `config?.X ?? join(workRoot, '<literal>')`, verified at `server.ts:671-672,774,812,820`), ONCE, at
   the composition root, before `confinement`/`protectedFiles` are built — copying the ONE precedent
   in this codebase that already does this correctly, `assetRoot` (`main.ts:295`). Each resolved
   default arrives on `ComposeConfigDeps` as a **pre-computed value**, matching `configPath`'s and
   `confinementProbe`'s own idiom (ARCH-181/DES-255's stated reason: several test files globally
   `vi.mock('node:child_process')`/mock the fs layer, and a callable seam resolved inside that mock's
   scope silently becomes `undefined` — the same hazard applies to `mkdtempSync`-shaped defaulting, not
   only to `spawnSync`). This closes `confinement.workRoot` never being conditionally omitted (A2) AND
   gives `ENGINE_STATE_DENY` a real resolved path for all five siblings (A3's config-backed half) in
   the same edit; it needs the standing wiring-lock treatment (`compose-config-v2-wiring.test.ts`) that
   catches this bug class, which is impl/tests' job once architecture states the resolved shape.
3. **A3's remaining half — two options**, named because the hoist above still doesn't reach the two
   genuinely knob-less paths (§ Replaceability above): **(i, recommended for this round)** add
   `mcp-registry.db`/`_global_assets` as named literals to `ENGINE_STATE_DENY` (confirmed to have no
   `FileConfig` key, so a literal is not an oversight here, it is the honest answer) alongside the
   five now-hoisted-and-derived siblings from item 2; add a completeness test that cross-checks the
   merged list against an actual census of `join(workRoot, ...)`/`join(this._workRoot, ...)` literals
   under `src/` so a ninth engine-state path added later fails a test instead of silently joining the
   unprotected set — small, send-back-sized, closes the finding. **(ii, structural, NOT this round)**
   consolidate all engine state under one deniable ancestor (e.g. `<workRoot>/.engine/`), complete by
   construction with no per-path enumeration ever again needed — but an on-disk layout migration
   touching `workflow-catalog.ts`, `asset-sync.ts`, `webhook-registry.ts`, `scheduler.ts` and every
   existing deployment's directory layout, well beyond a consistency-review send-back's blast radius;
   filed as a v38 candidate rather than decided here.
4. **A4**: reword INV-V37-1 and INV-V37-2 as posture-conditional ("...holds when `posture ===
   'confined'`; under `'unconfined'`, the control is ARCH-181's door, not the kernel"); repoint
   `rtm.md`'s REQ-218 trace row to include ARCH-181 (and DES-261/262/IMPL-375/376, matching what the
   reviewer's own re-verification named as the mechanism that actually runs).
5. **O-1**: one-sentence amendment to ARCH-178's row: "`agent.confinement_denied` is deferred despite
   S4 firing positive — no Gate-5 red test exists for the `PostToolUseFailure` registration this
   would require; see IMPL-374." No new event is built by this fix.

## Key points

- All five findings share one root shape — a single-seam claim (one chokepoint / one workRoot value /
  one hand-list / one universal invariant / one still-current row) made about a system that actually
  has more than one of that thing. The fix is either collapsing to a true single seam (A1, A3) or
  stating the claim conditionally on what varies (A2, A4, O-1) — never adding a parallel mechanism.
- A1's fix reuses a precedent this exact codebase already has right (`INLINE_SCRIPT_CLOSED` at
  `RunManager.start()`); it is not a new pattern, and quality-dimensions has no basis to propose
  anything else without a reason the existing precedent doesn't already serve.
- A2 and A3 are both instances of this repo's own named `composeConfig` 佈線 bug class, just discovered
  by an architecture-consistency reviewer instead of a real run this time — the ledger has now paid for
  this class enough times that the fix should also close the *pattern*, not just these two instances,
  though a generic detector is out of scope for this round (already filed as a v38 candidate for
  INV-V37-3's sibling problem).
- No new abstraction, port, or config surface is proposed anywhere in this document — every
  recommendation edits an existing seam (`RunManager.start()`, `composeConfig()`, `ARCH-177`'s already-
  resolved config, two prose rows) rather than adding one.
- O-1's fix is the cheapest possible instance of any of these — verify it does not get bundled into a
  larger rewrite of ARCH-178 that the send-back does not ask for.

## Risks

- **A1's persisted-origin signal is new state (a column/field on the catalog/webhook/schedule row)
  that does not exist today**, and the migration question named in § Recommended concrete decisions
  (backfill pre-v37 rows as `local` vs fail-closed as `remote`) is a real product decision, not a
  formality — get it wrong in the fail-closed direction and every webhook/schedule an operator already
  has running stops firing the moment this ships, on an unconfined host, with no code change on the
  operator's side to explain why. (Correction to this proposal's own first draft: `isLoopbackPeer` for
  the `client` site is NOT new plumbing — `server.ts:1168` computes it inside the same
  `createHttpServer` closure the webhook branch at `:1450` also runs in, confirmed by reading the
  enclosing function boundaries; the risk is specifically in the NEW persisted-origin path for
  `webhook`/`schedule`, not in reusing the existing per-request check for `client`.)
- **Moving the check into `RunManager.start()` changes its position relative to `RUN_ADMISSION_LIMIT`
  and the workspace-creation side effects `start()` performs** — the order needs to be decided
  (confinement gate before or after the concurrency-limit check) and is not specified by this
  proposal; get it wrong and a saturated engine could either leak "confinement unavailable" refusals
  ahead of a legitimate "try again later," or vice versa.
- **A3's config-driven derivation adds a dependency from `bash-confinement.ts`'s pure-function
  contract onto values that flow through `composeConfig()`** — ARCH-175's own row is explicit that
  `buildBashConfinement()` stays fs/process/env/clock-free; deriving the deny list from resolved
  config must happen at the composition root (where ARCH-177 already lives) and be PASSED IN as
  `protectedFiles`-shaped data, never computed inside the pure function itself. Getting this backwards
  would reopen the exact purity property ARCH-175 was written to protect.
- **A4's reword touches text the owner has already read and accepted (ADR-083's owner_decision)** —
  the invariant rewording must not read as re-litigating posture C; it is describing what posture C
  already means, not proposing a different posture. A version that drifts into re-arguing (A) vs (C)
  would be an unwelcome scope expansion this round does not have standing for.
- **This proposal takes no position on C-1 or A5** (the catalog entry and the wiring-lock test) beyond
  confirming they are correctly impl/tests-owned; if the converged panel decides either one actually
  needs an architecture decision after all (for instance, if `refusalEnvelope`'s untyped `code`
  parameter turns out to need a scoped local type that itself wants an architecture row), that is new
  scope this document does not cover and should be raised explicitly rather than folded in silently.

## Expected disagreements with other lenses

- **Adversarial will likely push A1's chokepoint fix toward the door pattern already proven at
  `call-tool.ts` (duplicate the check at each ingress site, explicitly, rather than centralize it at
  `RunManager.start()`)**, on the grounds that a shared chokepoint is also a shared single point of
  failure for the check itself, and that `webhook-registry.ts`/`scheduler.ts` already have their own
  typed-refusal idioms that a thrown-from-`RunManager` error has to be retrofitted into (my own
  Consumability section above concedes this retrofitting cost is real). I expect to hold the
  centralization position on the `INLINE_SCRIPT_CLOSED` precedent, but the retrofitting cost is a
  legitimate trade the panel should weigh, not dismiss.
- **On A1's SIGNAL (as opposed to the chokepoint), I expect the live disagreement to be about
  WHERE origin gets persisted, not WHETHER** — a persisted signal is close to forced once the
  scheduler/chain gap is walked through (§ Recommended concrete decisions), but adversarial may argue
  for recording it once at `workflow_register` only (the workflow's own origin, matching ADR-083's
  owner_decision text most literally) rather than separately at `webhook_create`/`schedule_create` too
  (which would let a LOCALLY-registered workflow's webhook binding be independently flagged if a
  remote party later attaches a trigger to someone else's already-registered workflow — a real
  distinction my proposal's synthesis collapses by naming both without picking one). This is a genuine
  open question I have not resolved and expect the panel to need to.
- **Adversarial may treat A3's two-option split as over-engineered for a send-back** — even option (i)
  (complete the literals + derive the six config-backed ones) touches more files than a bare literal
  patch (just adding the two missing knob-less paths and leaving the six as-is) would. I'd expect them
  to propose the smaller fix over the more self-sustaining one, and the tie-break is the same Karpathy
  rule ARCH-175 already invoked once this iteration — if the smaller fix is equally durable, it should
  win; my Self-sustainability section argues the six config-backed entries are NOT equally durable as
  literals (they drift again the next time an operator changes `casDir` etc., which the two purely
  knob-less paths structurally cannot do), so I expect to hold option (i) but concede the panel may
  reasonably split the difference (derive the six, but treat completing the two literals as the ENTIRE
  A3 fix rather than bundling a new completeness test in the same change).
- **On A2, I'd expect convergence** — both lenses' independent re-verification already agrees this is
  a `composeConfig()`-shape defect of the exact class this repo's own memory names; I don't expect a
  live disagreement here, only a difference in which specific resolution point (main.ts vs a new
  helper) gets proposed.
- **On A4/O-1, adversarial may consider these too small to need explicit architecture-panel debate at
  all** (pure prose edits) and want to route them straight to an implementer instruction; I've included
  them here because the send-back explicitly assigned them to architecture and a panel round is
  running anyway, but I would not object to them being handled as direct edits without further debate
  cycles if the other lens proposes that.
