# Quality-dimensions lens — Architecture round 2 (v37 Gate 8 send-back)

**Scope:** same five send-back findings as my own r1 — **A1** (webhook/scheduler bypass the
remote-submission door), **A2** (`confinement.workRoot` evaporates to `denyRead: []`), **A3**
(`ENGINE_STATE_DENY` hand-maintained, incomplete), **A4** (INV-V37-1/2 worded unconditional but
false under posture `unconfined`), **O-1** (ARCH-178's row not amended for the deferred event).
Responding to `adversarial.r1.md`'s **ADDENDUM — v37 Gate 8 send-back** section (the only other
panellist's send-back round; I have read it in full, including their base-round §1–§7 above the
addendum, for context on precedent they cite forward). They also rule on **A5/C-1** (routed
elsewhere, one architectural sentence each) and surface a **new finding, A9**, which folds A3/A6/A8
into one decision (**ADR-086**). I address all of it below, dimension by dimension, with an explicit
rebut/concede/hold per disagreement. **This file supersedes the send-back `quality-dimensions.r2.md`
this same path previously held** (the earlier round-2 content answered the pre-send-back version of
`adversarial.r1.md`'s base round only — that file was clean at `HEAD` before this write, per
`git status`, so it stays reachable via `git show HEAD:<path>` per this repo's own read-a-commit
rule; this is a fresh r2 answering the send-back addendum specifically).

## Headline of this round

**Converged, fully, on four of six decisions**: A1's chokepoint-at-`RunManager.start()`/`resume()`
keyed on persisted **provenance** rather than live socket peer (their **ARCH-182**); A2's fix as
"delete the optionality," not "defend against it" (their **ARCH-183** — I now go further than my own
r1 and say so); A4's posture-conditional invariant reword; O-1's one-sentence ARCH-178 amendment.
**One reversal of my own r1 position**: I withdraw my A3 recommendation (complete
`ENGINE_STATE_DENY`, add a completeness test) and adopt their **ADR-086** (flip `DENY_READ_MODE` to
`'workroot'`, delete the enumerated arm) — their **A9** finding (SDK reads are default-allow;
`allowRead` is a punch-out, not an allowlist, confirmed against `sdk.d.ts` below) proves my fix was
solving the wrong-shaped problem: completing a hand-list that was never the thing protecting sibling
run workspaces in the first place. **One live disagreement remains, on R3** (how to mark
pre-existing trigger rows that predate the `origin` column) — not a rebuttal of their ruling, a
refinement of it, argued in §1/§3 below.

## Responses to adversarial.r1.md's addendum, by disagreement

**D1 (A1, chokepoint layer) — no disagreement, converges.** My own r1 independently landed on
`RunManager.start()` as the chokepoint, citing the same `INLINE_SCRIPT_CLOSED` precedent they cite.
**What I add, not covered in my r1**: their ruling on `resume()` — refuse if *either* the stored
`RunSpec.origin` or the resume request's own remoteness is `'remote'` — is new territory my r1 never
reached. I adopt it, and add one Observability requirement in §1 below: a resume refusal and a start
refusal must be distinguishable in the journal, not collapsed into one `CONFINEMENT_UNAVAILABLE`
shape, because they are diagnostically different events for an operator (a resume-time refusal means
the posture changed *underneath* an already-running workflow, which is a fact worth its own line).

**D2 (A1, one persisted signal vs. two, required vs. optional) — concede, and resolve my own r1's
open question.** My r1 flagged, as unresolved, whether provenance should be recorded once (at
`workflow_register`) or independently at `webhook_create`/`schedule_create` too, and predicted
adversarial "may argue for recording it once... rather than separately." They didn't — they ruled
**both**: `RunSpec.origin` on the run, **and** `createdRemote` independently on each trigger row,
because a locally-registered workflow's webhook can still be attached by a remote party later. That
resolves my own open question in the more conservative direction, and I take it: a single-signal
model conflates "who registered the workflow" with "who attached this trigger to it," which are
different trust events. **On `RunSpec.origin` required-vs-optional**: I agree with them ahead of the
disagreement they predicted from my side. This isn't a reluctant concession — it follows directly
from my own r1 Self-sustainability argument about A2 ("a system... needs its defaults to compose
toward the SAME guarantee regardless of which optional key is set"). An optional origin field
recreates exactly the `undefined`-means-permissive cascade I already objected to for `workRoot`. A
security field whose absence silently means "admit" is the A2 defect wearing a different field name.
Making it required lets the compiler catch admission site #5 the way their §"Testability" point
argues — that's a Self-sustainability win too (see §4): no future admission path can forget to set
it, because it won't compile.

**D3 (A2, hoist vs. delete) — concede the sharper phrasing; my own recommendation already implied
it.** My r1 asked to hoist `workRoot`'s default to `composeConfig()`, "so `confinement.workRoot` is
never conditionally omitted." I verified `server.ts:655` this round:
`const workRoot = config?.workRoot ?? mkdtempSync(join(tmpdir(), 'rwe-'));` — a second default that
survives untouched if the fix only *adds* an upstream one. Their ARCH-183 says delete it outright,
and that's the correct reading of my own r1 rationale, not a different position: a resolved
`workRoot` arriving from `composeConfig()` makes `server.ts`'s local `??` dead code that *looks*
alive — the same shape as `session-options-builder.ts`, a description of the boundary left standing
next to the boundary after the boundary moved. I should have said "delete" in my own r1 and say it
now: leaving an unreachable second default in place is itself the self-sustainability failure this
whole finding is about, one line lower in the same file.

**D4 (A3/A6/A8/A9 → ADR-086) — concede fully; this is the round's substantive reversal.** I checked
their central claim against the file directly:

```
node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts (filesystem block)
  denyRead?:  "Additional paths to deny reading within the sandbox."
  allowRead?: "Paths to re-allow reading within denyRead regions.
               Takes precedence over denyRead for matching paths."
```

That confirms A9 as read: `allowRead` only *widens back* what `denyRead` (plus permission rules)
already narrowed — it is not an allowlist that narrows an otherwise-open read surface. My r1's A3
fix (complete `ENGINE_STATE_DENY` with the two missing literals, add a completeness test against the
resolved config) would have shipped a technically-more-complete version of a list that was never the
thing standing between an agent and a sibling run's workspace — ARCH-175's own note excludes sibling
run directories from that list *by design* ("not a stale sibling run-directory list"), and with
reads default-allow, excluding them from `denyRead` is excluding them from the only thing that could
have denied them. **My own Self-sustainability argument for A3 in r1** — "deriving the deny list
from the same resolved config... removes the coupling requirement entirely... correct by
construction" — argues *for* ADR-086 more cleanly than it argued for my own round-1 option (i): a
`denyRead = [workRoot, ...enginePaths, ...protectedFiles]` derived from the composed config, with
sibling workspaces caught for free because they live *under* `workRoot`, is a stronger instance of
"correct by construction" than a completed-but-still-enumerated literal array. I was arguing for the
right destination and stopped one stop short of it. Where I add value on top of the concession is in
§1 and §4 below: an unmeasured mode flip needs a self-check, not just a documented revisit trigger.

**D5 (A4/O-1) — no disagreement, converges as both sides predicted.** Posture-conditional rewording
of INV-V37-1/2, `rtm.md` repointed to the chokepoint rows once ARCH-182 has an id, and ARCH-178
amended in place to record the `confinement_denied` deferral rather than build a structurally-unable-
to-fire event. I have nothing to add past my own r1 text here.

**D6 (A5 → INV-V37-5) — agree, with one guard-the-guard caution.** "Any security-relevant field
forwarded through `composeConfig()` carries a hop-level wiring assertion" is the right generalization
of the `composeConfig` 佈線 bug class this repo's own memory already names twice (v11
`updateFlagPath`, v15 auth). One caution, in the same spirit as D4: don't let "which fields are
security-relevant" become a new hand-maintained list standing next to the code the way
`ENGINE_STATE_DENY` did — see §4 for a mechanical alternative.

**D7 (C-1 → typed `ErrorCode`) — agree, small addition.** A type is smaller than a test, and it
closes the class rather than one instance of it, which is the same shape of fix as ADR-086 versus my
r1's A3. One addition from a Consumability angle: if `refusalEnvelope`'s `code` parameter becomes a
closed union, that union should be part of the type surface an external SDK consumer (or this repo's
own `--check-config` tooling) can import, not an internal-only type — otherwise the fix closes the
production-code class but leaves the *documented* error surface untyped, which is its own smaller
instance of the same defect.

**D8 (R3, the `createdRemote` default for pre-existing rows) — hold, and refine rather than
reverse.** This is the one place I want a different shape of answer, argued in §1 and §3, not a
different admission outcome. I agree with their `DEFAULT 0` / fail-open choice on the merits (a
fail-closed default would silently break every existing schedule on an upgrade, which is a worse
outcome than the exposure it prevents, on their own correct reasoning). What I don't accept is that
a **boot-time WARN is the only surface** for a fact the operator needs to act on. See §1.

---

## 1. Observability

**A1/resume — a resume-time refusal and a start-time refusal must be distinguishable events, not
one shape.** Their ruling correctly closes the gap (refuse if either origin is remote), but the two
refusal *causes* are operationally different facts: a start-time refusal means "this work was never
admitted"; a resume-time refusal under their rule means "this work was admitted once, and the
posture or the resume request's own remoteness has since made it inadmissible" — the second is a
mid-flight state change an operator investigating "why did my long-running workflow stop resuming"
needs to see named as such, not inferred from a generic `CONFINEMENT_UNAVAILABLE` line that looks
identical to a same-request refusal. One extra field on the existing refusal event
(`phase: 'start' | 'resume'`) is the whole cost.

**A2 — the same "silent-mode" argument I made in r1 now also indicts leaving the dead default in
place (D3).** A resolved `workRoot` arriving from `composeConfig()` with `server.ts:655`'s `??`
still sitting underneath it is *worse* for observability than either state alone: it reads as live
code, a future reader has no signal it is unreachable, and the day someone refactors
`composeConfig()` to legitimately omit the field again (a plausible future edit, since nothing marks
the line as load-bearing-only-during-migration), the dead default silently reactivates and A2
recurs. Delete it in the same change, per D3.

**A3/A9/ADR-086 — the flip is correct, and the honest cost adversarial names (R1: "no host in this
ledger can execute the `confined` arm") deserves more than a documentation note, though not as much
more as my first draft of this section claimed.** Their own lens vocabulary supplies the shape of
the fix: this is what a Self-sustainability "tool-liveness check" is for (see §4, revised after I
checked what `confinementProbe` actually measures) — I fold the mitigation there rather than
duplicating it, but flag here that an *unverified security-mode flip shipped with no executable
signal at all about whether it holds* is the same kind of silent, unfalsifiable claim my own A4
argument objected to. §4's revised proposal is narrower than "self-test discharges R1" — a cheap
boot-time bwrap-level check is additive diagnostic signal, not a substitute for the real-tier
validation run their own R1 mitigation already calls for.

**A5/INV-V37-5 — the wiring-assertion obligation is only observable if it fails loudly, not
silently.** A hop-level test that exists but is easy to forget to *add* for the next security-
relevant field is the same shape of gap A1 had (a control installed at some but not all of its
required points). Prefer, where feasible, a test that enumerates security-relevant fields from a
single typed marker (e.g., a branded type or a fixed list co-located with the field's own
declaration in `FileConfig`, walked by one test) over a test file that maintains its own separate
list of "fields that need wiring assertions" — the latter is `ENGINE_STATE_DENY`'s exact shape one
layer up, and D6 already names this risk; this is where I'd put the fix if implementation asks.

**R3 (D8) — a one-time boot WARN is not a durable observability surface.** Their mitigation logs a
count at boot; a count seen once in a log stream that operators do not tail continuously is not
meaningfully different from silent, for the same reason this repo's own incident history keeps
citing "nobody's build failed on it" as the recurring failure shape. §3 below proposes a durable,
queryable alternative that costs one schema decision, not one feature.

## 2. Replaceability

**A1 — the chokepoint choice is orthogonal to gateway pluggability, and stays that way.** Moving the
door to `RunManager.start()`/`resume()` touches nothing `LiteLLMGatewayClient` needs to implement —
provenance is a property of *how a run was admitted*, not of which LLM backend executes it. No new
interface, no new method either gateway impl must stub. This matches my r1's "Where this dimension
does NOT ask for new abstraction" stance and I extend it here without qualification.

**A3/A9/ADR-086 — deleting the `'enumerated'` arm rather than keeping both modes is the right call,
and I want to name the tie-break explicitly since my own lens is the one that would normally worry
about removing an option.** Replaceability asks "does removing this branch cost us a legitimate
future configuration?" Here, no: A9 proves the `'enumerated'` arm never delivered the guarantee its
own name implied (an enumerated allowlist), so keeping it as a second mode preserves an option that
was never real — the same premature-abstraction shape my r1 already flagged once this iteration (the
withdrawn `WorkspaceConfinement` interface, cited in my own r1 Replaceability section). A mode with
one real implementation and one non-functional one is not two options, it is one option and one trap
for the next operator who picks the wrong `DENY_READ_MODE` value. Delete it.

**A5/INV-V37-5 — agree with their own observation and add nothing**: the posture hop's fix (moving
the door to `RunManager`) *deletes* a wiring obligation rather than adding a guard for it, which is
the strongest form of a replaceability-friendly fix — fewer seams a future gateway or admission path
has to reimplement correctly, not more.

## 3. Consumability

**A1 — `createdRemote`/`origin` must be visible on the existing `webhook_list`/`schedule_list`
surface, which they already name as a dependency of their own R3 mitigation.** I want to promote
this from "an observability clause the mitigation depends on" (their framing) to a first-class
Consumability point in its own right: a field added to an *existing* tool's output, with no new tool
and no new endpoint, is exactly the "reuse of the software asset" this dimension's own goal statement
names — it is the cheapest possible way to make a security-relevant fact inspectable by whatever
already calls that tool (an operator's own script, a dashboard, a future audit pass), and it should
be scoped and typed as part of ARCH-182 itself, not left as a follow-on.

**D8/R3, concretely — propose a tri-state origin marker instead of a boolean `DEFAULT 0`, so the
"needs operator review" fact is queryable forever, not just visible once at one boot.** Their
`createdRemote INTEGER NOT NULL DEFAULT 0` makes every pre-existing row indistinguishable from a row
a human explicitly confirmed as local after this fix shipped — the boot WARN is the only place that
distinction is ever surfaced, and it is surfaced exactly once, at exactly the boot immediately after
migration; an operator who reads logs a day later, or scrolls past it, has no second chance to find
out which of their webhooks/schedules are unreviewed legacy rows versus confirmed-local ones. I
propose the column be nullable (`createdRemote INTEGER` — `NULL` for pre-existing rows, `0`/`1` for
every row created from this migration forward), with the **admission predicate treating `NULL`
identically to `0`** (so the operational outcome they already argued for — no silent outage of
existing schedules — is unchanged) **but the value staying permanently distinguishable on
`webhook_list`/`schedule_list`** (surfaced as e.g. `originConfirmed: false` for `NULL` rows). This
costs one nullable column instead of a defaulted one — no new migration shape, no new admission
logic, same fail-open behavior they already argued for on the merits — and turns "operator reviews
existing triggers once" from a DEPLOY.md rider nobody can verify was followed into something the
operator's own tooling can query at any later time: `schedule_list` where `originConfirmed = false`
is the entire review checklist, indefinitely, not a boot-log needle. I'm not proposing a different
admission outcome than their R3 — I'm proposing the same outcome stay visible past the first boot.

**A3/A9/ADR-086 — no new consumability surface, matching their own framing.** The flip removes a
config mode (`'enumerated'`) rather than adding one; an operator who never touched
`DENY_READ_MODE` sees no change to any documented interface. Agreed, nothing to add.

**C-1/D7 — export the `ErrorCode` union where the documented error surface can use it (small,
already noted in D7).**

## 4. Self-sustainability

**A3/A9/ADR-086 — this is where I most want to land the concession, because it is the dimension my
own r1 used to argue for the *wrong* fix.** My r1's Self-sustainability section said, correctly, that
a hand-maintained list "requires a human to remember to update it every time a DIFFERENT, unrelated
config surface changes." I then proposed keeping the list and adding a completeness test — which
still requires a human to remember to run/maintain the *test*, and still requires enumerating every
engine-written path by name somewhere. ADR-086's `denyRead = [workRoot, ...enginePaths,
...protectedFiles]`, derived from the composed config rather than named literal-by-literal, is
closer to the "correct by construction" state I described but didn't fully reach: the day a ninth
config-driven path is added, it is *already* under `workRoot` (or explicitly in the composed
config's path set) with no separate list to remember. I adopt their **INV-V37-4** (a test that
enumerates the composed config's path-typed keys and asserts each resolved value lands in some
`denyRead` entry) as the mechanically-checkable version of exactly the completeness test my own r1
asked for — independently converged on, different route, same shape, and I'd rather credit that
convergence than pretend my r1 got there first.

**A3/A9's unmeasured-flip risk (R1 in their doc) is a textbook case for this dimension's own
"tool-liveness check" idea — but I checked what `confinementProbe` actually is before proposing to
extend it, and the honest version of this proposal is smaller than my first draft.**
`src/gateway/confinement-probe.ts` is a bare `spawnSync('bwrap', NESTED_BWRAP_ARGS, ...)` — no model
call, no `query()`, deliberately "impure... kept OUT of `bash-confinement.ts`" per its own header
comment. It measures one fact: can this host open a *nested* user namespace. It does **not**, and
cannot without invoking the SDK, tell us whether the CLI's own `denyRead`/`allowRead` composition
matches `sdk.d.ts`'s doc comments — that is a claim about the spawned `claude` process's internal
behavior, one layer past what a bare `bwrap` probe can see. So there are honestly two different
things I could be asking for here, and I pick one rather than blur them:

- **(a) Extend `confinementProbe` itself with a second bare-bwrap check** (deny a scratch path,
  confirm the nested sandbox actually refuses the read) — cheap, boot-time, no model dependency,
  consistent with the probe's existing shape. But it only proves *this host's bwrap can enforce a
  deny*, not that the CLI's SDK-level `filesystem.denyRead`/`allowRead` options compose the way A9
  reads the doc comments. It does **not** discharge their R1 by itself, and I should not claim it
  does.
- **(b) A real `query()` call exercising `Options.sandbox.filesystem` end-to-end** — this is the
  thing that actually discharges R1, because it is the only way to observe the SDK's own composition
  rather than the doc comment describing it. It is an agent turn: a model call, an API-key
  dependency, tokens, latency. That is not `confinementProbe`'s shape, and making engine *boot* on
  every host depend on model availability would be a worse self-sustainability trade than the one it
  fixes — the same "don't add a mechanism the codebase's own tie-break wouldn't accept" discipline
  my r1 already applied to A1 and A3. So I do **not** propose it as a boot gate. It belongs where
  REQ-218's other real-tier evidence already lives: a Gate-7.5-shaped one-shot validation run,
  executed once on the first host that measures `confined`, exactly as their own R1 mitigation text
  already says — I am not adding new scope there, only naming precisely why it can't be folded into
  boot the way I first drafted it.

**Revised proposal: do (a) as a cheap boot-time addition to `confinementProbe` (extra diagnostic
signal, not a new component's worth of scope), and leave (b) exactly where their R1 mitigation
already puts it — a real-tier validation task gated on the first `confined` host, not a boot check.**
This is a smaller ask than my first draft and an honest one: it stops short of claiming a bwrap-only
probe extension discharges a risk that only an actual `query()` call can discharge.

**A1/A5 — the required `RunSpec.origin` field and the hop-deletion in A5 are both self-sustainability
wins for the same reason: they remove a place a future change can silently regress rather than adding
a check that could be silently skipped.** A required compiler-enforced field and a deleted hop both
need zero ongoing human vigilance to stay correct; a WARN log and a remembered revisit trigger both
need some. Where ADR-086's mitigation is *forced* to rely on a documented revisit trigger (because
the arm genuinely cannot be measured today), that's the one place I add the self-test above rather
than accept the documentation-only mitigation; where a required field or a deleted hop is available
instead (A1, A5, D3's dead-default deletion), those are strictly the better fix and both proposals
already reach for them.

**D8/R3 — the tri-state marker (§3) is also a self-sustainability point, not only a consumability
one.** A boot-time WARN is a one-shot mitigation that depends on an operator's attention at one
moment; a queryable field is a mitigation that survives regardless of whether anyone was watching
the log at boot. The system should not need the operator to have been paying attention at exactly
the right minute for a security-relevant migration fact to still be discoverable a week later.

---

## Final position and remaining disagreements

**Converged, no further debate needed**: A1 (chokepoint, persisted two-column provenance, required
field, resume-refuse-if-either-remote — I add only the `phase` field on the refusal event, §1); A2
(delete the optionality, not defend it — I now agree `server.ts:655`'s local default should be
deleted outright, verified on disk); A3/A6/A8/A9 → ADR-086 (I withdraw my r1's completion-of-
`ENGINE_STATE_DENY` recommendation and adopt the flip, verified the `allowRead`/`denyRead` doc
comments myself against `sdk.d.ts` this round); A4 (posture-conditional reword); O-1 (one-sentence
ARCH-178 amendment); A5 (INV-V37-5, with the guard-the-guard caution in D6/§1); C-1 (typed
`ErrorCode`, with the export note in D7/§3).

**Remaining, genuinely open, for the panel/owner rather than for another debate round between the
two of us**: D8/R3's default-marking shape. I am not proposing a different admission *outcome* than
adversarial's `DEFAULT 0` fail-open ruling — I think that ruling is correct on the merits they gave.
I am proposing the fact be stored as permanently queryable (`NULL`/tri-state) rather than surfaced
once at boot and then lost to a log stream, at the cost of one nullable-vs-defaulted column decision.
Adversarial's own R3 text says "I do not think the argument is finished" — I'm taking that invitation
literally rather than treating it as closed, and I'd rather this specific point get one more look
(from validation or the owner, since it is genuinely a product/operability call, not a pure
architecture one) than have either lens force a resolution here.

**One thing I want on the record for whoever implements ADR-086**: §4's two-part self-test proposal
is new scope neither r1 named. Part (a) — a bare bwrap-level deny/allow check added to
`confinementProbe` — is small and can plausibly ride inside ADR-086's own diff. Part (b) — the real
`query()`-level validation of `filesystem.allowRead`/`denyRead` composition that actually discharges
their R1 — is *not* new scope at all; it is their own R1 mitigation text, restated, and belongs to
the same "first `confined` host" validation task they already named. I want it explicit which one is
being committed to where, so ADR-086 doesn't quietly inherit an agent-turn-shaped boot dependency
nobody asked for.

**Minor correction to my own r1, surfaced by their count, not mine.** My r1's Replaceability section
named three modules independently calling `RunManager.start()` (`call-tool.ts`, `webhook-registry.ts`,
`scheduler.ts`); adversarial's addendum greps four live call sites, including a second, inlined
ticker dispatcher at `server.ts:1015` alongside the injected `Scheduler.dispatch` — the same
twin-divergence shape this ledger's own v36 K1 finding already named elsewhere. I did not re-verify
the grep myself this round, but I have no reason to doubt it and it strengthens, rather than
undercuts, the case for a single chokepoint: a fourth uncounted site is exactly the failure mode a
per-call-site check (my r1's implicit alternative) is worst at catching, and the chokepoint both
proposals converge on catches it by construction. Noting the correction for the record rather than
re-deriving it.
