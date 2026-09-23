# Quality-dimensions lens — Architecture round 1 (independent proposal)

**Scope:** this is not a fresh REQ or a re-litigation of ADR-082..086 / ARCH-175..182 / INV-V37-1..5,
all owner-or-gate-decided and shipped. `send_back = [architecture, impl, validation]` from **v37 GATE 8
ROUND 2 — Consistency re-review (2026-09-23)** names seven items architecture owns a piece of: **B1**
(INV-V37-5's hop lock covers `confinementPosture`'s `composeConfig()` spreads only; `isRemoteSubmission`
has zero forward-lock coverage and `server.ts:813`/`:902` are unlocked in the direction that fails
silently INSECURE), **B2** (ARCH-182/ADR-086 key admission on WHO CREATED a trigger row; the ruling's
own accepted premise argues from WHO ATTACHED it; `claim()` never re-stamps `createdRemote`), **B4**
(`WebhookRegistry.deliver()`'s catch at `webhook-registry.ts:316-323` maps every `RunManager.start()`
throw — retryable `RUN_ADMISSION_LIMIT` included — into an uncoded permanent 403, with no
`_recordRefusal`), **QD-MED** (`authoring-guide.ts:363-369`'s `CONFINEMENT_UNAVAILABLE` prose still
names only `run_start`/`run_resume`, stale since ARCH-182 added two more admission routes), **B5/B6**
(two ledger-accuracy items: a new "comment must be a measurement" instance at `main.ts:182-183`, and
ARCH-177's `workRootDefault: string` row shipping optional), and **B3/B7**, routed to validation and
filed as non-blocking debt respectively — named here for completeness but not re-argued, since this
lens's job is the five items still open to architecture (B1, B2, B4, QD-MED, B5/B6). **This file
supersedes the v37-Gate-8-round-1 `quality-dimensions.r1.md` this same path held** (that round's five
findings — A1/A2/A3/A4/O-1 — were independently verified CLOSED on disk by the round-2 reviewer before
B1-B7 were raised; `git status --short` on this path is clean at `045bd6e`, so that content is not
lost — `git show 045bd6e:<path>` reaches it, per this repo's own read-a-commit rule). Verified directly
against source, not accepted from the review-stage panel text: `src/webhook-registry.ts` (types,
`deliver()`, `claim()`, `list()`), `src/types.ts` (`RefusalReason`), `src/server.ts:960-1030`
(`resolveScheduleTarget`, the ticker's `.catch()`), `src/authoring-guide.ts:363-386`,
`02-architecture.md` ARCH-182/ADR-086/INV-V37-4/5 rows (including the owner's 2026-09-23 ruling at
`:5756`, already answered — **not reopened here**).

## Altitude call

Both altitudes apply, at different seams of the same finding set. The engine's own control plane
(webhook/scheduler dispatch, admission refusal, the authoring guide, the composition root) is a
**conventional distributed system** — B1/B4/QD-MED/B5/B6 are ordinary observability/consumability/
config-correctness defects in that plane, argued at system altitude. But every one of them gates
**agent-shaped work** (`agent()` calls with real Bash access), and B2 specifically is about the
system's ability to attest, to itself, whether the *script an agent is about to run* was authored by
a party the confinement decision trusts — that is the agent altitude's provenance/trust question, not
a generic input-validation one. I apply system altitude to B1/B4/QD-MED/B5/B6 and agent altitude to B2.

## Summary

Four of the five open items are the same shape this lens named in the round-1 send-back and the
round-2 reviewer just found again one layer down: **a control's OBSERVABLE STATE (a lock, a log line,
a doc sentence, a type) fell out of sync with the control's ACTUAL SHAPE once ARCH-182 added routes**
the earlier text didn't anticipate. B1 is a wiring lock that covers one of two forwarded values. B4 is
an error-mapping catch that predates the error it now also has to map. QD-MED is a guide sentence that
names two routes where four now exist. B5/B6 are the ledger's own bookkeeping falling one edit behind
the code. The fix for all four is the same discipline INV-V37-4 already established for the composed
config's deny surface: **derive the observable artifact from the current shape, don't hand-author it
once and let it drift.** I'm applying it here to the lock/catch/guide/comment artifacts. B2 is different
in kind — it is not a staleness bug, it is a genuine gap between what ADR-086's
*rationale* argues (attachment-time trust) and what ARCH-182 *implements* (creation-time trust), newly
exposed because the reviewer found a zero-operator-action path through it that the owner's 2026-09-23
ruling did not evaluate. I do not propose closing B2 unilaterally; I propose the narrowest fix that is
consistent with the ruling's own accepted premise, and I relay the corrected premise as a fresh
`owner_decision`, distinct from the one already answered at `02-architecture.md:5756`.

## 1. Observability

**B1 — a wiring lock is not a claim about the wire it doesn't check.** INV-V37-5's text says
`confinementPosture` *and* `isRemoteSubmission` each need "a hop-level wiring lock… in the shape of
the `allowHostPaths` lock that already exists." What shipped is `compose-config-v2-wiring.test.ts`
covering `confinementPosture`'s spread into `ServerConfig`/gateway config — real, and confirmed
independently on disk by round 2 — but `isRemoteSubmission`'s own forward, from
`server.ts:1168`'s per-request computation into `ToolDeps` at the two `tools/call` sites
(`server.ts:813`/`:902`), has **zero test asserting the drop-it-and-every-run-ships-unconfined
direction**. This is not a hypothetical: it is the *exact same bug class this repo's memory already
names three times* (v11 `updateFlagPath`, v15 auth, v37's own A5), on the invariant written specifically
to stop a fourth instance. The fix is architectural in shape even though the change is a test: INV-V37-5
should be reworded to state **both hops explicitly as independently-locked obligations**, not as one
sentence covering two mechanisms where only one lock exists — so a reader checking "is INV-V37-5
satisfied" can enumerate exactly two assertions and find one missing, instead of reading a green
CI run and assuming coverage that isn't there. (This is impl's test to write; it is architecture's row
to make checkable.)

**B4 — an admission refusal that reaches production loses its own identity before anyone can see it.**
`WebhookRegistry.deliver()`'s catch (`:320-323`) does `return { ok: false, httpStatus: 403, reason:
toErrEnvelope(err).message }`. `toErrEnvelope` already computes a `code` — the catch simply discards
it. Two consequences, both observability failures: (a) `RUN_ADMISSION_LIMIT` (retryable — the ARCH-182
row's own text says so explicitly, "must not be answered with the RETRYABLE limit refusal when the
true condition is deterministic and permanent," which is exactly backwards here for the OTHER
direction: a genuinely retryable limit refusal is flattened into a `403` that looks exactly like a
permanent `CONFINEMENT_UNAVAILABLE` refusal) is now indistinguishable, from the caller's or an
operator's side, from a posture refusal; (b) `_recordRefusal(id, reason)` — called on every OTHER
refusal branch in this same function (`UNCLAIMED`, `CLAIMED_WORKFLOW_MISSING`/`NOT_IN_RELEASE` via the
lines above) — is never called here, so `webhook_list`'s `refusalCount`/`lastRefusedAt`/
`lastRefusalReason` (the dashboard's only window into "why does this webhook keep not firing")
undercounts every admission-gated refusal. An operator watching the dashboard after their host measures
`unconfined` sees a webhook that silently stopped firing with no count and no reason — the "opaque
failure is a design defect" case this lens exists to catch, verbatim. Root cause at the TYPE level,
confirmed by reading `DeliverResult` directly: the `401 | 403 | 404` branch carries `reason: string`
only, no `code` — only the `409` branch has a `code: RefusalReason` slot, and `RefusalReason` itself
(`types.ts:427`) is `'UNCLAIMED' | 'CLAIMED_WORKFLOW_MISSING' | 'NOT_IN_RELEASE' |
'CHANNEL_UNPUBLISHED'` — four pre-ARCH-182 values with no room for `CONFINEMENT_UNAVAILABLE` or
`RUN_ADMISSION_LIMIT`. The catch block was wired to the code that existed before ARCH-182; ARCH-182's
new throw landed in the same `try` without the type or the recording call growing to match.

**QD-MED, read as an observability defect too, not just a doc defect:** the guide's
`HOST_PATH_GRANTS_UNCONFINED` string is the *only* place a caller can learn what "confined" means on
this deployment, and it says "`run_start`/`run_resume` return a refusal instead" — silently false for
the two routes ARCH-182 added. An author who reads the guide, provisions a webhook, and sees it never
fire has no text anywhere connecting the observed silence to the documented posture. This is the same
"agent's chain-of-thought / tool-call sequence must be inspectable" principle one level up: the *guide
that lets a cold agent predict its own admission* is part of the observable surface, and it now
under-reports the admission surface it's describing.

## 2. Replaceability

ARCH-182's own note says the four admission callers each map `CONFINEMENT_UNAVAILABLE` "into the idiom
it already has" — `refusalEnvelope` at the facade, the webhook route's ad hoc catch, `ScheduleResult`
at `Scheduler.trigger()` (dead code today, no production caller — filed as v38 debt already), and
`markFailed` at the ticker driver. Reading the ticker driver directly (`server.ts:1017-1025`) shows this
is not hypothetical either: `CONFINEMENT_UNAVAILABLE` thrown from `start()` "falls into the SAME generic
`.catch()` below `markFailed` already handles" — the same code path that handles "the catalog entry was
deleted." A **deterministic, permanent, posture-caused** refusal and a **transient-until-the-operator-
fixes-the-catalog** failure are recorded with the same `lastError` shape, on the schedule side, for the
identical reason B4 exists on the webhook side. Four hand-written mappings is not decoupling, it is
the same logic re-derived four times with one instance already wrong (B4) and a second (the ticker) one
missed find away from the same bug. I propose one shared, pure mapping function —
`admissionErrorToOutcome(err: unknown): { code: ErrorCode; retryable: boolean; httpStatus?: 403 | 503 }`
(name illustrative) — that each of the four callers consumes instead of writing its own `catch`. This
is the LLM-backend-swap argument applied to error taxonomy rather than providers: today, adding a fifth
admission-throwing condition to `RunManager.start()` (plausible — REQ-218's residuals aren't closed)
requires editing four call sites correctly; with one mapper, it requires editing one function and
every caller inherits the fix. `RefusalReason` should grow to a shared, ARCH-182-aware type (adding
`'CONFINEMENT_UNAVAILABLE'` and `'RUN_ADMISSION_LIMIT'`) that the mapper returns and every one of the
four idioms narrows into its own status-code convention — the DECOUPLING is at the taxonomy, not at
each route's HTTP shape, which stays route-specific by design (a webhook caller and a `tools/call`
caller legitimately want different envelopes).

## 3. Consumability

**QD-MED's fix, stated as an interface-friendliness requirement, not just a text patch:** the guide
should describe the admission predicate's actual KEY ("every run this workflow can trigger is refused
identically, regardless of route, when this host is unconfined and the trigger's own recorded
provenance is remote") rather than enumerate routes, which is exactly the drift-prone shape B1/QD-MED
both are instances of. A caller integrating against this engine — including a cold agent reading only
the guide, REQ-117's own bar — should learn the RULE, not a route census that a fifth admission site
(schedule/webhook already made it four) will make stale again. This is a one-paragraph rewrite in the
same builder DES-258 already established as the pattern (a static string keyed on `posture`), and it
composes with my Observability point: name the rule, and the rule stays true across future admission
sites without a text edit.

**B4, read as consumability:** an uncoded `403` with only a prose `reason` gives a webhook-management
caller (`webhook_list`, the dashboard, a future retry-aware client) nothing machine-readable to branch
on. `webhook_list`'s existing `lastRefusalReason?: RefusalReason` field is exactly the typed surface a
caller should be able to read this outcome from — it currently can't, for this refusal class, at all.

**B3** (routed to validation, not mine to fix) is worth one sentence here because it compounds QD-MED:
`WebhookView`/`ScheduleView` project `id, workflow, createdBy, enabled, secretFingerprint,
refusalCount, lastRefusedAt?, lastRefusalReason?` — `createdRemote`, the one field ADR-086's promised
operator sweep needs to find the pre-v37 cohort, is not projected at all. I am not re-asking for the
tri-state this lens's own r2 conceded on the Karpathy tie-break; I am noting that projecting the
EXISTING boolean on `list()` is the minimum consumability bar for a sweep ADR-086 already promised in
`DEPLOY.md`, and its absence is what makes B3 a real, not decorative, finding.

## 4. Self-sustainability

**B2, at agent altitude.** ARCH-182/ADR-086 implement a closed-loop control — the engine decides,
without a human in the loop, whether an incoming trigger fire is trustworthy enough to admit
Bash-capable `agent()` work. The owner's 2026-09-23 ruling on ADR-086's named residual (`:5756`)
accepted a **specific, bounded** cost: a remotely-registered script can still run if "操作者本機誤啟動"
— the operator's own deliberate local action starts it. That is a self-sustainability argument in this
lens's own terms: the accepted risk requires a human circuit-breaker in the loop. B2 shows a path where
**no human acts at all**: an existing, locally-created (`createdRemote=0`) webhook or schedule already
claims a workflow name; a remote principal calls `workflow_register` against that name (registering a
new version, or re-claiming via `claim()` if the trigger was ever released); the trigger's own
`createdRemote` stamp — written once, at row creation, per ARCH-182's own text — never changes; the
NEXT automated fire (a cron tick, an inbound webhook `POST`) reads `origin: 'local'` and admits
Bash-capable work under a script the trigger's creator never reviewed. This is not the residual the
owner ruled on — that residual required "操作者" to press a button; this one requires nothing, because
the trigger fires itself. The self-sustainability defect is exact: **the control's own trust boundary
degrades on ordinary, unattended operation**, which is the opposite of "minimize human intervention
while surviving" — it is a case where the *absence* of intervention is what breaks the guarantee.

I do not propose (B) from ADR-086 (a `workflow_versions.origin` column refusing any run of a
remote-authored script) — that is the option the owner already rejected, for a reason (ADR-083's
"本機發起的 run 仍不受限制") that is untouched by B2. Narrower shape, consistent with the accepted
premise: **origin, for a TRIGGER-FIRED admission only** (webhook `deliver()` / schedule ticker — never
`run_start`/`run_resume`, which stay exactly as ADR-083 settled them), is `'remote'` if EITHER
`trigger.createdRemote` OR the released version's own provenance is remote. This restores the ruling's
own stated premise (an unattended fire should carry the same trust as the weakest of the two facts that
produced it — who attached the trigger, and what script it currently points at) without reopening the
local-`run_start` question the owner already closed. This is additive on top of ARCH-182 exactly as
ADR-086's own "Consequences" paragraph already anticipated ("closing it means adding (B)'s column ON
TOP of (C), which is purely additive and can ship later without re-keying anything") — I am proposing
the trigger already arrived (a zero-operator-action production path, not a hypothetical), narrowed to
the fire-path only, not the general (B).

**Recorded as a fresh `owner_decision`, not decided here**: whether to ship the additive, fire-path-only
version-origin check. The premise correction that makes this a *different* question from the one
answered 2026-09-23: that ruling's cost/benefit was framed entirely around a deliberate local human
action; B2's path requires none. I attach the concrete production fact the relay should carry: per
ADR-086's own text, "production catalog 現有的工作流程**全部**是遠端註冊的" — so the fire-path check,
if the ADR's OR is read literally (version provenance ORed in), would refuse **every existing
schedule/webhook fire on this production host**, the same blast radius the owner already rejected once
for a different reason. The narrower, defensible framing is therefore not "OR in version origin" but
"detect and flag `claim()`-after-creation as an event the operator should confirm" (see below) —
functionally a decision the owner should make with this cost stated up front, not one this lens should
resolve by picking the ADR wording that happens to compile.

**B7** (filed as non-blocking v38 debt by the reviewer, not reopened) is the same self-sustainability
shape one level down: a permanent refusal re-firing forever via `markFailed` is a missing circuit-
breaker on the schedule side — ARCH-182's contract table already prescribes this behavior verbatim, so
it is not a deviation, but it means a schedule that starts refusing (posture flips to `unconfined`, or
lands in the B2 scenario above) burns a ticker cycle every interval forever with no backoff and no
"disable after N consecutive refusals" the webhook side's `refusalCount`-driven auto-disable
(`markRefused`'s `enabled = 0` write) already has. I note the asymmetry only; not proposing a fix this
round, per the reviewer's own routing.

## Key points

- B1/B4/QD-MED/B5/B6 are one recurring shape: an observable artifact (lock, catch, guide sentence,
  comment, type) authored once and not re-derived when ARCH-182 added routes. The systemic fix is one
  shared error-mapping function + a rule-shaped guide sentence, not four/five point patches.
- B4's root cause is in the TYPE (`DeliverResult`'s `403` branch has no `code` slot; `RefusalReason` has
  no ARCH-182-era member) — fixing the catch body without widening the type just moves the same bug to
  the next admission-throwing condition.
- The schedule-side ticker has the SAME bug as B4 (verified directly, not in the round-2 finding text)
  — `CONFINEMENT_UNAVAILABLE` and a deleted-catalog-entry failure are recorded identically via
  `markFailed`. Any fix scoped to `webhook-registry.ts` alone leaves this open.
- B2 is a genuine gap between ADR-086's stated rationale (attachment-time trust) and its implementation
  (creation-time trust), newly reachable with zero operator action. It is not the residual the
  2026-09-23 ruling already closed, and deserves its own, narrower relay — not silent adoption of
  option (B), which the owner has already rejected once for a related but distinct reason.
- B3's fix (project `createdRemote` on `list()`) is a precondition for ADR-086's own promised sweep to
  be performable at all — noted for validation's benefit, not claimed as this lens's fix.

## Risks

- **Scope creep risk on my own proposal:** the shared `admissionErrorToOutcome` mapper touches four
  call sites (`call-tool.ts`, `webhook-registry.ts`, `scheduler.ts`, `server.ts`'s ticker) for what the
  reviewer scoped as one file's finding (B4). If the panel prefers a surgical, webhook-only fix
  (Karpathy tie-break cutting the other way from my r1's own precedent on ARCH-182's confinement
  builder), the ticker-side twin bug should at minimum be FILED, not silently left for a third
  discovery.
- **B2's proposed check has a real false-negative-preserving property, not a closure:** OR-ing version
  provenance into fire-path admission only narrows the window (it still doesn't stop the SAME script
  from running via a local `run_start`, by design/ADR-083) — if the panel or owner reads it as "closes
  B2," that overstates it. It converts an unattended, zero-operator-action path into one requiring
  either (a) the operator's own local button press (already-accepted cost) or (b) the trigger creator
  never having re-registered the workflow under a different, remote identity after creation — narrower,
  not zero.
- **Cost of widening `RefusalReason`:** every existing `switch`/exhaustiveness check over that union
  (if any exist in tests or dashboard code) needs a new-member arm; unverified this round whether such
  exhaustive switches exist — a real risk if TypeScript's `never` check is relied on anywhere and this
  change is applied without a full-suite compile.
- **My B2 framing could itself be second-guessed as re-litigating an answered ruling** — I have tried to
  make the premise difference explicit (deliberate local action vs. zero action) but the adversarial
  lens or the gate may read it as the same question with different words; if so, the correct outcome is
  the gate saying so explicitly, not my silently dropping it.

## Expected disagreements with other lenses

- **On B2's fix shape:** adversarial's r1/r2 history on this exact question (ADR-086's Options B vs C)
  shows a live disagreement pattern — I expect adversarial to push harder toward the general (B)
  (`workflow_versions.origin`, refusing local `run_start` too) on the ground that the 2026-09-20
  incident's shortest path runs through exactly this gap; I will hold at the narrower, fire-path-only,
  additive shape because the general (B) is the option the owner has already ruled out once, on a
  premise B2 does not disturb (the local-`run_start` case still requires the deliberate action ADR-083
  accepted).
- **On B4/B1's remedy granularity:** I expect pushback that a shared mapper is premature abstraction for
  four call sites (the same Karpathy tie-break my OWN r1 used against the `WorkspaceConfinement`
  interface, now potentially used against me) — I'm flagging this as a live risk above rather than
  presenting the mapper as obviously right.
- **On QD-MED:** low-disagreement risk; the "route census goes stale" argument is the same one INV-V37-4
  already won for the config-deny-surface case, and I expect convergence on rule-shaped, not
  route-shaped, guide text.
- **On whether B1 is architecture's finding at all:** the reviewer filed it as "three test cases, no
  production change" — another lens may argue this is entirely impl/verification-owned and that
  architecture's only job is the INV-V37-5 reword I proposed; I'd accept that narrower framing if raised.
