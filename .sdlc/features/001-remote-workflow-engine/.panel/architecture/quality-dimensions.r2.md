# Quality-dimensions lens — Architecture round 2 (v37 Gate 8 round-2 send-back)

**Scope:** same five items my own r1 left open to architecture — **B1** (INV-V37-5's hop lock
covers `confinementPosture` only, not `isRemoteSubmission`), **B2** (creation-time vs.
attachment-time trust on `createdRemote`), **B4** (`WebhookRegistry.deliver()`'s catch flattens
every `start()` throw into an uncoded 403), **QD-MED** (the authoring guide names two admission
routes where four now exist), **B5/B6** (ledger bookkeeping one edit behind the code). Responding
to `adversarial.r1.md`'s **ADDENDUM 2 — v37 Gate 8 round-2 send-back** (the only other panellist's
round-2 content; read in full, including the base round and ADDENDUM above it for precedent they
cite forward). They also rule on **B3** and **B7**, and raise **A6/A8** as a Replaceability item I
address below. **This file supersedes the round-2-send-back-addendum content this same path
previously held** (that content answered the earlier, already-resolved `ADDENDUM` on A1-A9 — it is
clean at `HEAD`, so `git show HEAD:<path>` reaches it, per this repo's own read-a-commit rule; this
is a fresh r2 answering `ADDENDUM 2` specifically, which is the round my own r1 above is scoped to).

I re-verified, myself, every load-bearing fact adversarial's addendum 2 depends on before conceding
to any of it: `grep -n "admissionRefusal\|async resume" src/run-manager.ts` — `admissionRefusal` is
called at `:473` only, inside `start()`; `resume()` is at `:848` and never calls it. `grep -n
"createdRemote" src/*.ts` — written at exactly two `INSERT` sites (`scheduler.ts:294`,
`webhook-registry.ts:174`), both behind a migration that does `ALTER TABLE … ADD COLUMN
createdRemote INTEGER NOT NULL DEFAULT 0`. `grep -n "isRemoteSubmission" src/mcp-facade.ts
src/call-tool.ts` — `workflowRegister(a, principal)` and `workflowPublish(a, principal)` take no
`deps` argument at all; `deps.isRemoteSubmission` cannot reach either. `claim()`'s `'held'` arm
(`webhook-registry.ts:211-213`) returns before any `UPDATE`. All four confirmed exactly as stated.

## Headline of this round

**Converged on the shape of every fix except one ranking.** B4+B7 collapse into the same shared
classifier I proposed in r1 under a different name — I adopt theirs (`classifyStartRefusal`) and
their one correction I had missed (`RUN_ADMISSION_LIMIT` must NOT join `RefusalReason` — see §2).
B1's remedy is compiler-enforced required keys, not more test cases — I concede this as the
*stronger* instance of my own Observability principle, not a competing one. B3 converges exactly
(mirror `createdRemote` on `WebhookView`). QD-MED converges on data-driven guide text. **One
reversal of my own r1**: B2 is not a re-arm residual, it is zero coverage on the entire pre-v37
cohort by construction — I withdraw my narrower framing and adopt the corrected arithmetic, while
keeping my own zero-operator-action framing as a *second*, independent premise correction for the
same `owner_decision`. **The one live disagreement is B2's option ranking** — not a fix-shape
dispute, an `owner_decision` input both of us agree is not ours to resolve.

## Responses to adversarial's ADDENDUM 2, per disagreement

**On B2 (§1) — concede the arithmetic, hold my premise as an addition, rebut nothing.** My r1 framed
B2 as: an existing local trigger gets re-registered remotely, `createdRemote` never re-stamps, a
cold fire admits unreviewed work. That is real but it is the *second-order* case. Adversarial's
first-order fact is stronger and I verified it myself above: `createdRemote` is a column this
iteration adds, `DEFAULT 0`, written only at row creation — so **every trigger that predates the
migration reads local**, and ARCH-182's refusal arm has nothing to refuse on the population REQ-218
exists for. My re-arm path is a live, additional way coverage *stays* zero even after an operator
manually recreates a trigger to get it; it does not compete with their finding, it extends it past
the point their "recreate the trigger" mitigation would otherwise look sufficient. I fold both into
one corrected premise for the re-put `owner_decision`: **(a) coverage starts at zero** (theirs) **and
(b) recreating a trigger does not make it durable**, because `workflow_publish` — not `claim()` — is
the actual laundering point, and neither call receives `isRemoteSubmission` today. My r1's proposed
fix (OR version provenance into fire-path admission) is withdrawn on their §1.1 evidence: stamping
it would be a sixth unlocked hop through the facade, the exact bug class B1 already names once this
round. I do not propose a fix for B2; I contribute a second premise to the same re-opened decision.

**On B2's option ranking (§1.3) — hold, and name it as the one real remaining dispute.** Adversarial
ranks (iii) fix the host > (iv) drop `Bash` under `unconfined` > (ii) add version-origin > (i) keep
C, correct the text. I do not have standing to out-rank this from my own lens's evidence — (iii) and
(iv) are feasibility/spike questions (R6 in their own risk list), not quality-dimension questions.
What I add, from Self-sustainability (§4 below): (iv) is not merely "the honest degradation," it is
the textbook shape of a **circuit breaker** — the exact mechanism this dimension's brief names
("circuit-breaker / graceful degradation under extreme load") applied to a trust condition instead
of a load condition. That is a reason to keep it *in* the ranked set, not a reason to move it up
past their own stated caveat (R6: spike before ruling). I hold at "their ranking, my caveat noted,"
and I agree with them that the deliverable this round is a corrected `owner_decision`, not a winner.

**On B4+B7 (§2) — concede fully, with one correction I owe them.** `classifyStartRefusal(err) ->
{code, retryable, httpStatus}` is the same shared-mapper shape my r1 asked for
(`admissionErrorToOutcome`); I adopt their name and their routing detail (`RUN_ADMISSION_LIMIT` →
503, not 403) since I had left the status code unspecified. **The correction they made that I had
not**: my r1 proposed widening `RefusalReason` with *both* `'CONFINEMENT_UNAVAILABLE'` and
`'RUN_ADMISSION_LIMIT'`; theirs adds only the first. I checked why and their choice is right —
`markRefused` (the writer both `RefusalReason` members would flow through) sets `enabled = 0` on the
webhook row (confirmed, `webhook-registry.ts`'s `markRefused`/`_recordRefusal` pairing). A transient
concurrency ceiling is not a reason to auto-disable a webhook; only a permanent, policy-shaped
refusal should touch that durable state. `RUN_ADMISSION_LIMIT` gets its 503 and its log line, never
a `_recordRefusal` call, never a `RefusalReason` membership. I withdraw my wider version. I also
agree to pull **B7** into this round: it is one branch on `classifyStartRefusal(err).retryable`
routing a permanent refusal to `scheduler.markRefused` instead of `markFailed`, and their §"Internal
conflicts" check (neither writer advances `nextFire`; that belongs to `claimFiring()` since v29) is
the exact verification I would have asked for before agreeing — they already did it.

**On B1 (§3) — concede the mechanism as a stronger instance of my own principle; add the sequencing
condition and the missing test's shape.** My r1 asked for INV-V37-5 to be reworded so a reader can
enumerate "two locks, check both are present." Adversarial's structural fix — make
`isRemoteSubmission`/`confinementPosture` **required keys** at the composition-root boundary
(`buildToolDeps`, `ToolDeps`, `RunManagerDeps`) instead of optional-with-a-permissive-default — is
not a competing remedy, it is the more observable one: a missing forward becomes a compile error
before the code exists, rather than a green test suite someone must remember to extend. That is my
own dimension's "internal state observable at any time" argument taken to its limit, and I adopt it
as the primary fix; the reworded invariant text becomes secondary documentation of a fact the type
system now enforces. **What I add, not in their fix:** their own new finding — `resume()` calls
`admissionRefusal()` nowhere, so the `call-tool.ts` door is the *sole* cover for `run_resume`, not a
redundant twin — means the required-key change and the door's deletion cannot land in the same
commit (their R3, which I fully endorse: extend the predicate to `resume()` first, delete the door
in v38). My contribution to that sequencing is the one test their §3.2 already asks for but I want
named explicitly as an Observability requirement, not just a testability one: **if the door is kept
even temporarily, one test must assert that the door and the predicate refuse the identical input**
— not two tests that happen to both pass, one test that would fail if either half of the duplicate
silently diverged. A duplicate control that is only accidentally in agreement is exactly as opaque
as no control, until something asserts the agreement itself.

**On B3 (§4) — full convergence, nothing to add.** Mirror `createdRemote` onto `WebhookView` and
`list()`, exactly as my r1 proposed independently. I accept their sharper framing over mine: "a
decision input that cannot be read back is not auditable" is the same claim I made under
Consumability, stated more precisely as an Observability one — I fold my own framing into theirs
rather than keep a separate, weaker version.

**On the tri-state (their §4, addressed to me by name) — the withdrawal stands, condition
accepted.** My r1 already declined to re-ask for `originConfirmed`/`NULL`-as-unreviewed this round
(I noted only that projecting the existing boolean is the minimum bar). Adversarial asks for one
explicit condition on their own decline: the coverage-zero fact must land in `DEPLOY.md`, not just
in an ADR paragraph an operator won't open before running a sweep. I accept the condition — it costs
nothing and it is exactly the kind of observable-surface argument this lens exists to insist on.

**On QD-MED/B5/B6 (their §6) — converge on the rule, converge on the mechanism, one addition.**
"A comment or guide paragraph asserting a fact about the code either cites the line that makes it
true or is deleted" is a stricter, better-stated version of my own r1's "derive the observable
artifact from the current shape, don't hand-author it once." I adopt their wording. Their proposed
mechanism for QD-MED specifically — the admission-route list becomes data in `errors.ts`, the guide
renders it — is exactly my own Consumability proposal from r1 (name the rule, not a route census)
implemented as an actual data structure instead of a rewritten paragraph; I prefer their concrete
mechanism over my own prose-only version and adopt it, with the one qualifier they already stated
themselves: if judged too much for a send-back round, the fallback is the text edit plus one ARCH
note recording that the duplication exists and will drift again. B6 (`workRootDefault` optional vs.
required) — I agree with their resolution and, more, with the general principle they state to
resolve the apparent tension with B1: **optionality is acceptable exactly when the default is the
safe answer, never when it is the permissive one.** That sentence deserves to sit in INV-V37-5
itself, not just in this round's prose, because it is the one line that would have prevented B1,
B4's `RUN_ADMISSION_LIMIT`/`RefusalReason` question, and B6 all being separately re-derived.

**On A6/A8 (their point 6, addressed to me as the Replaceability owner) — concede the carry, take
the ask.** `DENY_READ_MODE`'s `'workroot'` arm and `MASK_PROVIDER_ENV`'s `envVars` arm are
compiled-in and unreachable by any shipped config today — the same shape REQ-219 just deleted two
modules for, and my own r1's Replaceability section is exactly the lens that should be uncomfortable
carrying dead flexibility as debt without a name. I accept the carry this round (LOW, not blocking)
on their stated condition: the flip trigger goes on the ARCH row as an event ("a positive spike S7/S8
result, or the first `confined` host measurement") rather than as a code comment, because a comment
saying "flip this when X" is precisely the artifact-drift shape B5/B6 are instances of, and I am not
going to ask for that discipline everywhere else in this same document and then exempt my own item.

## Answering their six "expected disagreements," by number

1. **Tri-state for B3** — not disagreeing; addressed above (withdrawal stands, `DEPLOY.md` condition
   accepted).
2. **B1 as "more checks" vs. "fewer hops"** — not disagreeing; conceded above, with the added
   argument that a compile-time required key is the more observable failure mode, not a different
   dimension's win over mine.
3. **B7 in scope** — not disagreeing; agreed above, on their own verification that neither writer
   advances scheduling state, so there is no behavioural risk to the pull-in.
4. **Guide text growing into a doc-generation mechanism** — agreed with their stated ceiling (data in
   `errors.ts`, rendered by the existing guide, nothing more); I would object only if a future round
   proposed a templating layer beyond that, which nobody has.
5. **Option (iv)'s consumability objection** ("removing `Bash` breaks every workflow") — I do not
   raise this objection. A loud, coded failure is strictly more consumable than a silent one; my only
   addition is the self-sustainability framing in §4, not a consumability rebuttal.
6. **Replaceability being the more aggressive lens on A6/A8** — not really a disagreement; I concede
   the carry and add the one condition (event-shaped trigger on the ARCH row, not a comment) they
   themselves proposed. Converged.

---

## 1. Observability

**B1's fix, restated as an observability claim.** A required key with a `| undefined` value is a
strictly more observable contract than an optional key with a default: the "never measured" state
stays representable, but *silently forgetting to say anything* stops being representable at all. My
r1 asked for a reworded invariant that a human reader could check; the required-key fix makes the
compiler the reader, which fires before the code that would violate it ships, not after a test
happens to catch it. I still want the reworded INV-V37-5 sentence — "optionality is acceptable
exactly when the default is safe, never when it is permissive" — but now as the recorded *reason* for
the type shape, not as a substitute for it. And regardless of whether the `call-tool.ts` door is kept
this round or deleted in v38, the one non-negotiable observability requirement is the never-diverge
test: two controls that happen to agree, with nothing asserting that they must, are indistinguishable
from one control and a coincidence.

**B4's root cause, confirmed by reading `DeliverResult` and the catch directly, is a missing
classification, not a missing field** — `classifyStartRefusal()` fixes this once, at the type level
(`RefusalReason` gaining exactly one new member, `'CONFINEMENT_UNAVAILABLE'`, not two), and every one
of the four admission-throwing consumers inherits a `code`, a durable `_recordRefusal`/`markRefused`
write, and a `RUN_ADMISSION_LIMIT` that is finally visible as *retryable* rather than indistinguishable
from a permanent posture refusal. I want one more sentence recorded on the wire-boundary rule they
named: **`err.message` is for logs; a wire boundary emits `code` plus static catalog text.** The
sandbox-probe string currently reaching an HMAC-authenticated webhook caller (their §2.1's disclosure
point) is a small but real instance of exactly the "opaque failure is a design defect" principle
applied in the other direction — here the failure is *too* transparent, to the wrong audience.

**B3, folded into Observability rather than kept as a separate Consumability point** (see response
above): `createdRemote` decides whether Bash-capable code executes on this host, and it is currently
readable back for schedules and not for webhooks. Mirror the field.

## 2. Replaceability

**B4/B7's shared classifier is the LLM-backend-swap argument applied to error taxonomy, and I keep my
r1's framing of it, now aimed at their concrete function.** Today, a fifth admission-throwing
condition added to `RunManager.start()` (plausible — REQ-218's residuals are not fully closed) would
require editing four call sites by hand; with `classifyStartRefusal()` as the one place that maps a
throw to `{code, retryable, httpStatus}`, it requires editing one function, and all four routes
(`call-tool.ts`, `webhook-registry.ts`, `scheduler.ts`, the ticker) inherit the fix automatically. The
per-route HTTP envelope stays route-specific by design — a webhook caller and a `tools/call` caller
legitimately want different wire shapes — the DECOUPLING is at the taxonomy (`RefusalReason`,
`{retryable, httpStatus}`), not at forcing one envelope shape on every consumer.

**A6/A8, carried as named debt with an event-shaped trigger, per the section above.** This is the
converse of the classifier point: `DENY_READ_MODE`'s dead `'workroot'` arm is flexibility nobody can
currently reach, kept alive by a hand-written enum rather than deleted and re-added when the trigger
event (a `confined` host, or a positive sandbox spike) actually arrives. I accept it as debt rather
than asking for its deletion this round, on the strength of the same tie-break my own r1 used against
premature abstraction elsewhere — but debt that is only named in a comment is exactly the B5/B6
pattern, so the trigger condition belongs on the ARCH row where the next iteration will actually read
it before deciding whether to act.

## 3. Consumability

**QD-MED, converged on the data-driven fix.** The admission-route list becomes a small data structure
in `errors.ts` (already the file that maps `CONFINEMENT_UNAVAILABLE` to `workflow_authoring_guide`);
the guide renders it rather than hand-naming routes. A cold agent — REQ-117's own bar — learns the
actual predicate ("every run this workflow can trigger is refused identically when the host is
unconfined and the trigger's own recorded provenance is remote") rather than a route census that a
fifth admission site will make stale again, exactly as it made the current two-route sentence stale
after ARCH-182 shipped four.

**B4, kept as a consumability point too, not only observability**: `webhook_list`'s existing
`lastRefusalReason?: RefusalReason` field is precisely the machine-readable surface a management
caller or the dashboard should be able to branch on for this refusal class; today it cannot, at all,
for `CONFINEMENT_UNAVAILABLE`. The classifier closes this as a side effect of closing B4's
observability gap — the same fix serves both dimensions, which is itself a small confirmation that
the fix is at the right layer.

## 4. Self-sustainability

**B2, read through this dimension, is the strongest argument for re-opening the `owner_decision`
regardless of which option wins.** ARCH-182/ADR-086 implement a closed-loop control meant to keep a
human out of the loop for ordinary trigger fires while still gating Bash-capable agent work. Two
independent, verified facts now show the loop is not closed the way the ruling assumed: **(a)**
coverage is zero on the entire pre-migration cohort by construction (adversarial's arithmetic,
verified above), and **(b)** even a freshly-recreated trigger's provenance can be laundered one call
later, at `workflow_publish`, without any forward carrying `isRemoteSubmission` there today (my own
r1's zero-operator-action path, sharpened by their evidence that `claim()` was never actually the
laundering point). Both facts describe the same failure mode from this dimension's own definition:
*the control's trust boundary degrades on ordinary, unattended operation* — the opposite of
"minimize human intervention while surviving," because here the absence of intervention is what
silently produces coverage instead of assurance.

**On the option ranking**, I contribute exactly one dimension-scoped argument and no vote: option
(iv) — drop `Bash` from the agent's tool surface when posture is `unconfined`, rather than gating who
may fire — is a **circuit breaker** in the literal sense this dimension's brief names, applied to a
trust condition instead of a load condition. That is a reason it belongs in the ranked set on its
own architectural merits, independent of whichever option the owner ultimately picks; it is not a
reason to move it ahead of adversarial's own stated precondition (spike whether the SDK's
`disallowedTools` reliably survives `allowedTools` shadowing, before anyone rules on it — their R6,
which I have not independently verified and do not dispute).

**B7, once pulled into this round, is a self-sustainability fix in exactly this dimension's terms**:
a permanently-refused `cron` schedule currently re-fires every period forever with a `console.error`
and no durable counter — an unbounded, silent retry loop with no backoff and no circuit-breaker,
which is the failure mode this dimension exists to catch even though it is not, on adversarial's own
verification, a *scheduling*-correctness bug (neither writer advances `nextFire`). Routing a
permanent refusal to `markRefused` instead of `markFailed` gives the loop a durable, visible refusal
count for free, as a side effect of the same classifier that fixes B4 — I have nothing to add beyond
endorsing the routing and noting, as they do, that whether a repeatedly-refused `cron` should
eventually auto-disable is a separate, not-yet-asked question that the refusal counter now at least
makes visible enough to ask.

---

## Remaining disagreements

- **B2's option ranking** ((iii) > (iv) > (ii) > (i)) is the one item where I do not converge on a
  position, because it is not a quality-dimension question — it is an `owner_decision` weighing a
  live-host blackout against a host-level fix of unknown effort against a tool-surface circuit
  breaker of unverified reliability. I ask that the re-put decision carry **two** corrected premises,
  not one: coverage-zero-on-legacy (theirs, verified) and publish-time laundering
  (mine, verified), since either alone understates the gap between what the 2026-09-23 ruling was
  asked to weigh and what is actually shipped.
- **Everything else in this round is converged**: B1 (required keys + sequenced door deletion + a
  never-diverge test), B3 (mirror the field), B4+B7 (one classifier, one new `RefusalReason` member,
  not two), QD-MED (data-driven guide text), B5/B6 (the safe-default-vs-permissive-default rule,
  recorded once in INV-V37-5), and A6/A8 (carried debt with an event-shaped trigger on the ARCH row).

## Key points

- I withdrew my r1's B2 framing (re-arm residual) in favor of the stronger, independently-verified
  coverage-zero arithmetic, and I withdrew my proposed fix (OR-ing version provenance into the fire
  path) once verification showed it would be an unlocked sixth hop through the facade — the same bug
  class this round's B1 already names.
- I withdrew half of my own B4 proposal: `RefusalReason` gains one member
  (`'CONFINEMENT_UNAVAILABLE'`), not two — `RUN_ADMISSION_LIMIT` must stay outside the durable-refusal
  vocabulary because that vocabulary drives `markRefused`'s auto-disable write, and a transient
  concurrency ceiling is not a reason to disable a webhook.
- I adopted adversarial's required-keys fix for B1 as the stronger instance of my own Observability
  principle (a compile error is the earliest, most certain observable failure), not a competing
  testability-vs-observability outcome — and added the one test I think their sequencing still needs
  named explicitly: a never-diverge assertion between the door and the predicate for as long as both
  exist.
- Every other item (B3, QD-MED, B5/B6, A6/A8, B7's pull-in) converges without residue.

*Quality-dimensions lens — v37 Gate 8 round-2 send-back, debate round 2, 2026-09-23.*
