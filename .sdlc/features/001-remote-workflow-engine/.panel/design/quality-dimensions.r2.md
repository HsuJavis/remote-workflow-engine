# Quality-dimensions — Design stage, round 2

I read `adversarial.r1.md` in full (its §0–§10, all measured facts M1–M14, B1–B7, R1–R12, and its §9
predictions of where we'd clash). Their lens found things mine could not have — actual grep/read
measurements of this working tree, not architecture-doc prose — and several of those findings
change my own dimension's conclusions, not just theirs. I address every one of their §9 predictions
by name, then restate what remains genuinely open.

## 1. Observability

**B1 (re-walk refuses every seeded run) — concede, and elevate.** M8 (`initGitBaseline` runs `git
init` in every seeded workspace) + M9 (`CLAUDE.md` not stripped) + M10/M11 (the unwired module tests
the marker on the workspace itself) is exactly the discipline my own r1 scope note committed to
("verified against the actual source... wherever the two could drift") — I just didn't do the grep
myself. This is not a security finding I can referee, but it is a first-class Observability finding:
the fix's six-arm boundary table (§3.1) and the explicit statement that the re-walk's true-positive
domain becomes "near-empty by construction" (R10) are exactly the kind of stated-not-glossed residual
my r1 asked for throughout ("Observability: a silent/opaque failure is a design defect"). I fold R10's
sentence into the DES-256 row directly rather than restating it, and add one thing: **Scenario (+1)
#4, DES-031, and DES-106 must be amended in the same diff as the code**, not filed as follow-up — an
amended living document that lags its own code by even one gate is the orphaned-re-point failure my
r1's traceability-closure point already named (REQ-021's own history, cited independently by both of
us from different angles — theirs from the boundary bug, mine from the ledger-closure bug).

**B5 (emission order) — concede outright, no daylight between us.** Their four-step ordering
(`auth/env → re-walk refusal → buildBashConfinement → emit → query()`) with "a refused call emits no
`agent.confinement` line" is the identical rule I stated in r1 under almost the same words ("a
refused call emits no `agent.confinement` line... the alternative reading would print a posture for
a session that never ran"). We derived it independently from opposite directions (them: boundary
correctness; me: observability honesty) and landed on one sentence. Nothing to add except: this
convergence is itself evidence the rule is right, and the DES should say the order was cross-checked
by two lenses, not asserted by one.

**§9.1 (`agent.confinement_denied` best-effort vs unconditional) — concede, with one testability
condition attached.** Their agent-altitude argument is correct and I did not weigh it heavily enough
in r1: an `EACCES` landing in the agent's own `tool_result` *is* a first-class observable — the
consumer is the agent, not only an operator's log — and building a second observation path (a
transcript scan, a `PostToolUse` sweep) for a fact that already arrives is exactly the speculative
machinery REQ-219 exists to delete. I drop my implicit assumption that "observable" means
"operator-log-observable." One condition, which is Observability's own standard applied consistently:
**this fallback claim needs its own UT**, not just architecture prose — assert that a denied Bash
call's `EACCES` actually reaches `agent_log` via the existing `onEvent` path (M6's seam), the same way
their §4.3 already refuses to let any UT be "cited as evidence the confinement confines." A design
that asserts "the agent sees it" without a test asserting the wiring that makes that true is the same
unlabelled-but-typed gap I flagged for `failIfUnavailable` below.

**B7 (`failIfUnavailable`'s reason surface) — partial concession, converging on a hybrid.** My r1
called union-widening (`reason: 'sandbox_unavailable'`) "the smaller, more honest option" but already
named the fold-into-`'terminal'`-with-a-drift-locked-detail alternative. Their finding sharpens the
tie-break I didn't have in r1: ADR-083's own revisit trigger is *phrased as grep-able text*
("an operator reports a run refused for `sandbox unavailable`"), so the contract only needs to be
**findable and stable**, not compiler-exhaustive. Full union-widening forces every existing exhaustive
`switch` on `GatewayResult.reason` to grow a case for a failure mode most call sites don't need to
distinguish from `'terminal'` — that is real diff-surface for a marginal safety gain. I converge on
their fold, with one addition that keeps the part of my original concern that still matters: the
`detail` string must be an **exported constant** (`SANDBOX_UNAVAILABLE_DETAIL`), used at both the
throw site and asserted verbatim in a drift-lock unit test — not a free-text literal that can drift
between the code and ADR-083's revisit-trigger prose without a test noticing. This gets me the
type-adjacent safety I wanted (a typo breaks a test, not silently) at their smaller diff cost.

**Still open, not resolved this round: `WORKROOT_INSIDE_PROJECT` and `ERROR_CATALOG`.** Adversarial's
B1 fix changes *when* this path fires (near-empty, engine-created intermediates only) but does not
touch *whether* it should route through the closed `ErrorCode` catalog like every other
authoring/registration failure (REQ-116). If anything, B1 sharpens the case for joining it now: this
is the gate where the path becomes reachable from a live call for the first time, which is exactly
when a taxonomy decision should be made rather than inherited by inertia. I hold my r1 position:
join `ERROR_CATALOG` with `see: null`, and name it as its own task-list line so it isn't silently
dropped the way DES-031/DES-106 nearly were.

**Confirmed, unchanged: `protectedFiles` from the loader (DES-254), the spike-evidence-file
requirement, and the S1–S8(+S9) real-host discipline.** Their DES-254 (loader returns the absolute
path it actually read, `composeConfig()` passes that, not a re-derived guess) is the same "don't
infer a global fact from a local re-derivation" defect class my r1 named for a different symptom
(`WorkRoot`-scoped state). No disagreement; I adopt their concrete fix as satisfying my r1's abstract
ask.

**DES-255 / R7 (the event-sink late-bind) — concur, previously unaddressed by me.** M6/M7 establish
that ARCH-178's "the sink stays injected exactly as ARCH-159 designed it" is false as of today: no
sink exists on the gateway, and the gateway is constructed in `composeConfig()` before the sink's
owner exists, which is the same reason `resolveMcp` needed a late bind. R7 — "the only operator read
path is silently absent exactly when nobody is watching" — is an Observability defect by my own r1's
own standard (a silent/opaque failure is a design defect). I concur with their recommendation (i):
`bindEventSink(sink)` mirroring `bindResolveMcp`, with a **no-op sink installed at construction** so
the unbound window and the bound window are never the same code path, and unbound ⇒ no throw. No
residual objection; this was a gap in my r1, not a disagreement to negotiate.

**The three ARCH-176 comment/text changes (two contradictory comments, the
`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` note, the `extractCandidatePaths` bug-class note) — concede to
their framing over my own r1 task-split language.** My r1 task-split (item 4) asked for "a
source-scanning drift-lock test so the two contradictory comments cannot silently re-diverge." Their
§2.2 calls the three changes untestable and names that as exactly why they need an *owner* (a named
task-list line), and their §4.4 rejects fence-style tests generally as "the greener-than-green pattern
this slice exists to delete" (specifically about the `gateway-effort.test.ts` fence, but the principle
generalizes: a test that greps for prose strings to guard against re-divergence is a fence around
text, not around behavior, and produces exactly the "passes vacuously forever" failure mode they
flag). I hold the same anti-fence position elsewhere in this round (§4.4's fence-deletion point), so
consistency requires I drop my own drift-lock-test ask here and adopt theirs: each of the three text
changes is its own reviewable diff line with a named owner in the task row, not a grep-based test.

## 2. Replaceability

**B4 (SDK `$loose` schema + caret range) — concede and upgrade my own r1 ask.** My r1 said "pin the
exact SDK version... as a recorded fact" (naming 2.1.278 from ADR-082) so a later drift is
"diffable, attributable" rather than silent. Their M1 (`SandboxSettings` is `z.core.$loose` — unknown
keys pass, nothing rejected at runtime) plus M4 (the *npm* dependency is `^0.3.199`, a caret, not the
pinned figure) shows my r1 ask was too weak: "record the version as a fact" does nothing if the
dependency itself can float underneath that recorded fact via `npm update` inside the caret range,
and `$loose` means the compiler will not catch a renamed field either. I now hold their stronger fix:
**pin the SDK dependency exactly** (no caret) for this iteration, not just document the figure, and
record the *installed* version in the `agent.confinement` payload (self-dating the log line, per B4)
so a mismatch between "what we pinned" and "what's actually running" is itself detectable. This is a
straightforward upgrade of my own position under their measurement — not a concession of substance,
since we both wanted the same outcome (no silent confinement decay across a version bump); theirs is
just the version of the fix that actually closes the hole `$loose` opens.

**`denyReadMode` as a parameter, not a config key (§5.3 / B2) — concur, and note the consistency
with my own architecture-round position.** Their resolution — one parameter with no path from config
to it, the caller passes a spike-fixed constant, and the losing arm is *deleted* (not kept) once S7
returns — is the identical principle I already argued in r1's Replaceability #2 against a carrier
ladder: "the seam is the spike's own report, not code." A mode selected by an untestable-until-the-
spike-runs constant, with an explicit deletion follow-up for the losing arm, is not a runtime
flexibility point; it's a temporary fork with an expiry date. I hold this as converged, and add the
deletion-of-the-losing-arm item to the task list explicitly so it doesn't become permanent-by-
inertia the way `WORKROOT_INSIDE_PROJECT`'s catalog membership almost did.

**Unchallenged, restated as final:** the type-only `SandboxSettings` import (compiler-as-guard,
r1 §2 point 1) and the LLM-backend decoupling invariant (`invoke()` gains no `sandbox` parameter,
`LiteLLMGatewayClient` is unconfined by category, not by gap). Neither lens raised a counter; both
stand as this round's final position, restated only for completeness of the closed set.

## 3. Consumability

**§9.6 (ARCH-107 vs ARCH-177, the guide paragraph) — concede the predicted sharpest disagreement,
in full.** My r1 proposed wiring the live `allowedHostPaths` grant list into `GuideCeilings` and
through to `mcp-facade.ts`, on the grounds that ARCH-107's contract table already said "rendered from
the effective grant list" and the mechanism to do it cheaply already exists. Their §2.7 finding
changes the premise I built on: `grep` shows **nothing carries this value to the guide today**
(confirmed, not architecture prose), wiring it mints exactly the class of silently-inert second hop
this whole iteration exists to delete (their own words, and I recognize the shape from my own r1
`failIfUnavailable` complaint — a contract that claims a wire exists is worse than one that admits it
doesn't), and — the point that actually decides it for me — **ADR-084 already closed, at Gate 2,
on the grounds that the author has no in-band way to act on a grant list** (author-request deferred).
Consumability's own standard is "minimize the caller's learning curve *and* integration cost," not
"maximize information density" — a live per-deployment path list the author cannot request changes
to is not lower-friction than a static sentence naming the mechanism; it is a fact the author must
read and can do nothing about, which is worse for a cold-model author than a stable, generic
instruction ("ask your operator; the granted list for this run appears in the operator's log"). I
switch my recommendation from (a) to **(b), the static paragraph**, titled after "host path grants"
per their collision note (never "sandbox" — `authoring-guide.ts:432` already owns that title for the
`node:vm` script sandbox, and ARCH-175's own choice not to put the new module under `src/sandbox/`
was made for the identical reason). I keep my r1 mechanism note (the `GuideCeilings`/`DEFAULT_CEILINGS`/
`mcp-facade.ts` call-site shape) on record as the concrete answer *if* ADR-084 is ever reopened to
allow author-facing grant requests — not as a task for this gate.

**DES-253's grant-validation table — adopt in full as the concrete answer to my own open ask.** My
r1 asked for "the exact error object... as a table" rather than four ad-hoc `if` messages. Their
DES-253 is that table, and it is stronger than what I asked for on two points I hadn't found myself:
rule (iii) widened to bidirectional containment via the existing `isPathContained` primitive (closing
the `<workRoot>/cas` grant hole — a grant that would otherwise hand the agent the CAS store, which is
exactly the kind of "the guide teaches a working example that is actually a privilege leak" failure
my own r1's `GUIDE_EXAMPLES` point was trying to guard against from the documentation side), and
`UNRESOLVABLE` treated as a refusal rather than a forgiving pass-through, with the operational cost
(operator must `mkdir` before boot) named explicitly rather than left for a reviewer to infer. I adopt
their table wholesale as satisfying my r1 ask; no remaining gap on this point.

**S9 (a real workflow must still complete) — strongly endorse, and sequence it against my own
`GUIDE_EXAMPLES` ask.** Their B3 finding — eight spike arms test denial, none tests completion — is
not adversarial-only territory; it is Consumability's own "agent altitude means the workflow still
completes" claim (their phrase, and the right one). I connect this to my r1's ask for a
`GUIDE_EXAMPLES` entry demonstrating an agent handling a failed Bash write gracefully: that example is
only honest if it teaches the *actual* failure shape a real toolchain hits under confinement, not a
hypothetical one authored before anyone ran a real workflow through it. **Sequencing point for the
task list**: S9 must run and its EACCES inventory must exist *before* the `GUIDE_EXAMPLES` entry is
written, or the example risks teaching a graceful-recovery pattern for a denial that doesn't match
what real toolchains actually trip (their §3.3 names `$TMPDIR`, `~/.npm/_logs`, `~/.cache`,
`~/.config/git` as candidates nobody has confirmed yet). This is a one-line addition to their
suggested task order, not a new task.

**Correction to my own r1 claim about what proves this example "measured, not asserted."** I checked
`tests/unit/authoring-guide.test.ts`'s actual `it.each(GUIDE_EXAMPLES)` loop rather than assume its
shape from the architecture prose (the same discipline I'm holding everyone else to this round): it
validates each example's **mermaid diagram against `SHAPES`'s node-shape vocabulary and greps the
script text** for a hard-coded model alias — it does not execute any example script, in `node:vm` or
otherwise, and it has no path to a live agent's Bash tool or a real `EACCES`. My r1 sentence ("the
standard this exact iteration is holding everything else to... otherwise the paragraph's claim of
consumability is asserted, not measured") overstated what that test loop can prove. Corrected claim:
a `GUIDE_EXAMPLES` entry gets the example **documented and structurally validated** (shape-checked,
alias-checked, and — via S9's inventory — accurate to a real EACCES shape) — it does not get
runtime-measured that a cold agent actually recovers gracefully when it hits one. That stronger claim
would need a real-tier test driving an actual `agent()` call through the confined Bash tool, which is
outside this test file's design and, per §4.3's own rule, belongs at Gate 7.5, not in a UT.

## 4. Self-sustainability

**B2 (invert the S7 default to `'enumerated'`) — concur, as the same fail-closed principle I
already held, applied one level earlier.** My r1 argued ADR-083's fail-closed trade (a host that
loses bubblewrap stops taking runs, rather than degrading) is correct because "silently continuing
without the control is the service failing to do the one thing this iteration exists to do." Their
B2 is the identical argument applied to the *default mode choice* rather than the availability
failure: shipping the untested `'workroot'` arm as the default and demoting `'enumerated'` to a
fallback means a possible total outage (deny-wins ⇒ agent cannot read its own workspace) is
discovered in production instead of in the spike. That is not a weaker posture — it's fail-closed
applied to the *order of discovery*, which is exactly the same standard my own r1 held boot-time
liveness checks to ("discovered once at boot" is "strictly cheaper" than "discovered per-run"). I
hold no independent position here; theirs is mine, one layer earlier.

**Boot-time CLI-capability probe (my r1) — narrowed, not kept in full, once I take my own exact-pin
concession seriously.** My r1 justified the probe as catching "a future `claude` CLI upgrade that
silently changes or removes `Options.sandbox`'s effect." But I just adopted their B4 fix (Replaceability
§2: pin the SDK exactly, no caret) — and their own measurement (the `claude` binary ships *inside*
the npm package via `extractFromBunfs.js`, not as a separate PATH dependency) means that under an
exact pin, a CLI upgrade is a **diffable `package.json` commit reviewed like any other dependency
bump**, not a silent event. That eats most of my probe's original justification; I was arguing for a
runtime detector of a class of drift the version pin now prevents at the source. What honestly
survives, narrowed: (a) a PATH-installed `claude` shadowing the bundled one at binary-resolution time
— their own §3.4 flags this as a one-line spike observation still owed (S6) rather than resolved, so
a boot check confirming *which* binary actually resolved is still load-bearing until S6 answers it;
and (b) moving ADR-083's fail-closed decision from "discovered per-run at `query()` time" to
"discovered once at boot" is a genuine cost-reduction independent of the pin question — cheaper
failure-discovery timing, not drift-detection. I restate the probe scoped to these two, not the
broader "detects any silent capability change" claim r1 made.

**No new circuit breaker for repeated `EACCES` — unchallenged, stands from r1** (bounded by existing
`RunGuard` token/turn budget; inventing a second backoff mechanism here would be over-engineering
against an already-covered risk).

**S9 also serves this dimension, not only Consumability.** "Minimize human intervention" fails
completely if every confined run needs a human to diagnose why a normal toolchain step got denied.
I file S9 under both dimensions rather than picking one home for it — it is the kind of cross-cutting
finding this lens format exists to surface.

## Remaining disagreements (honest count: fewer than round 1 predicted)

Of adversarial's seven §9 predictions, six converge this round (B1/B5 outright agreement,
`agent.confinement_denied` best-effort conceded, `failIfUnavailable` converges on a hybrid, and the
ARCH-107/177 guide question resolves to their (b)).

On the `confinement`-optionality trade (§9.4): correction first — my r1 took **no position** on this;
the word `confinement` doesn't appear in it. Their §5.1 predicted my stance and invited a check on
their "~40 construction sites" estimate ("I would concede quickly if they can show... fewer than I
think"). I ran it rather than accept the estimate on their word: `grep -rc "new
ClaudeAgentSdkGatewayClient" src tests` sums to **62** call sites across 26 files (`src/main.ts` plus
25 test files spanning acceptance/integration/unit/e2e tiers). That is *more* than their own estimate,
not fewer — it strengthens their case rather than testing it. I accept optional-block/required-
fields-inside/strict-default/wiring-probe as final on evidence I now own, not on their word: making
`confinement` non-optional would touch more than 60 existing construction sites for a guarantee the
wiring probe (§4.2's `EXCLUDED`-row-plus-hop-2 test) already gives at compile-adjacent cost. No
residual objection. The one item still genuinely open is **whether `WORKROOT_INSIDE_PROJECT` joins
`ERROR_CATALOG`** — not a disagreement between lenses (adversarial didn't take a position), but an
undecided task-list line that both lenses should insist gets a row rather than inheriting a default
by inertia, the same failure shape both of us independently flagged elsewhere in this same slice
(orphaned re-points, unbound event-sink windows, a caret range standing in for a pin).

## Updated task-split deltas (additive to adversarial §7's ordering, nothing removed)

1. S9 (real-run completion inventory) is sequenced **before** the `GUIDE_EXAMPLES` task (Consumability
   §3 above) — both were already same-gate, this fixes their order.
2. `failIfUnavailable`'s `'terminal'` + `detail` gets an **exported constant**
   (`SANDBOX_UNAVAILABLE_DETAIL`) plus a drift-lock unit test, not a free-text literal (Observability
   §1).
3. `agent.confinement_denied`'s best-effort fallback gets one additional UT: the `EACCES` reaches
   `agent_log` via `onEvent`, asserted, not assumed (Observability §1).
4. The guide paragraph task is retitled to option (b), static text titled "host path grants," with my
   r1 `GuideCeilings` mechanism kept as a documented non-task for a future ADR-084 revisit
   (Consumability §3).
5. SDK dependency pin changes from "record the version as a fact" to "remove the caret, pin exactly,"
   plus record the *installed* version in the `agent.confinement` payload (Replaceability §2).
6. `WORKROOT_INSIDE_PROJECT` → `ERROR_CATALOG` membership gets its own named task-list row so it is
   decided, not inherited (Observability §1, still open).
7. Event sink: `bindEventSink(sink)` late bind + no-op sink at construction, per DES-255/R7
   (Observability §1) — no change to adversarial's own recommendation, just my concurrence recorded.
8. The three ARCH-176 comment/text changes lose their drift-lock-test line from my r1 task-split and
   gain a named-owner line instead, per the anti-fence consistency point (Observability §1).
9. The boot-time capability probe (Self-sustainability) is narrowed in scope to (a) confirming which
   `claude` binary actually resolved at boot (PATH-installed vs. bundled, pending S6) and (b) moving
   ADR-083's fail-closed check to boot time — not the broader "detect any silent SDK drift" claim r1
   made, which the exact-pin task (item 5) now covers instead.
