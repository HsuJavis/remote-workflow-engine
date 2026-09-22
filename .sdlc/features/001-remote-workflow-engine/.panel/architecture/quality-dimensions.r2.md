# Quality-dimensions lens — Architecture round 2

**Scope:** REQ-218 (Bash workspace confinement) + REQ-219 (wire-or-delete dead security modules),
iteration v37. Responding to `adversarial.r1.md` (security · scalability · testability bundle,
Karpathy tie-break) — the only other panellist this round. Four dimensions, one section each, all
required, updated from round 1 in light of their evidence.

## Headline of this round

We converge on the outcome: **(c)** for REQ-218 (kernel confinement as floor + declared exception),
**delete-both-with-a-rider** for REQ-219. We diverge, and I concede, on *mechanism*: round 1 me
argued for building OS-level confinement (bwrap/unshare/namespaces) behind a new interface I called
`WorkspaceConfinement.spawn(cmd, policy)`. Adversarial did the archaeology I didn't — schema fields
in `sdk.d.ts`, ELF strings in the resolved CLI binary, host namespace sysctls — and showed the
confinement mechanism already exists inside the SDK/CLI we already spawn (`Options.sandbox`). I was,
unknowingly, the "pure-security lens that wants a hand-rolled wrapper" they pre-rebutted in their
§6.1. Their evidence is concrete and mine wasn't; I concede the mechanism question and spend this
round on what a quality-dimensions lens adds on top of a mechanism I no longer contest: an
observability event schema for the seam that now exists, a fuller consumability treatment of the
two-sided declaration surface their C2 opens rather than closes, and a sharper self-sustainability
argument for why REQ-219's rider is not optional.

## Responses to adversarial.r1.md, by disagreement

**D1 — my own-interface Replaceability ask, vs. their "one enforcement point already exists."**
**Concede.** My round-1 Replaceability section asked for OS-level confinement to sit behind a narrow
interface so a namespace-less host could fall back to declaration-only, modeled on `GatewayClient`
(D2). That assumed we'd be writing the OS call. Adversarial's K1/K3 show we wouldn't be: `bwrap` is
invoked by the CLI binary itself (their ELF-string count is the tell — `bwrapPath` literally appears
in the resolved executable), and what our code contributes is a plain data object,
`Options.sandbox`, assembled where `permissionMode`/`canUseTool`/`settingSources` already are
(`claude-agent-sdk-client.ts` ~630–665, their K3). There is nothing here to abstract behind a new
interface — the swap point is the one that already exists: `LiteLLMGatewayClient` has no CLI
subprocess and simply never populates `sandbox`, the same way it already doesn't implement
`canUseTool`. Building `WorkspaceConfinement.spawn(...)` on top of that would be an abstraction with
no second implementation, which is the premature-abstraction failure mode Karpathy's tie-break
exists to catch — I'm applying their own tie-break against my round-1 self here, not just yielding to
seniority. What I do **not** withdraw is the underlying portability worry: unprivileged user
namespaces are not uniform across "self-hostable local or remote Linux" targets. That risk is real,
but adversarial already owns it correctly, as `failIfUnavailable` + their Gate-2 spike (R1/R3), not
as an interface-design question. **Resolved by their mechanism, my risk absorbed into their spike.**

**D2 — my "spawn wrapper journals the policy," vs. no spawn wrapper exists.**
**Concede and revise.** Round 1's Observability section described the seam as "the spawn wrapper...
must journal the confinement policy it applied to that Bash invocation at spawn time." Given D1,
there is no spawn wrapper — `bwrap` happens inside the CLI process, invisible to us except through
whatever the SDK surfaces back. The seam I should have named is upstream of that: the point where
*we* build the `SandboxSettings` object and hand it to `query()`. That's a call-time policy-applied
event, not a spawn-time one, and it's cheap (log the object we constructed, once per `agent()` call,
next to the existing per-run journal entry). The harder half — the *denial* side — adversarial
correctly names as required (K5: "every denial produces one journal line...") but explicitly declines
to design ("I deliberately do not design the event schema here... it belongs to whichever panellist
owns observability"). That's this lens's job, so I do it in §1 below, and it folds in their R10
finding (empty-candidate-list-≡-clean-candidate-list) as the same *class* of defect the new event
schema must not repeat: a `sandbox_denial` event must exist as a distinct emitted fact, never
inferred from "no error was raised."

**D3 — consumability ownership (their C2), vs. my round-1 "author declares it, REQ-130-style."**
**Hold, and integrate rather than pick a side.** My round-1 Consumability section assumed the
workflow author declares `allowHostPaths` directly, patterned on REQ-130's schema/guidance
treatment. Adversarial's C2 argues (and hedges as genuinely open, not a settled call) for
operator-owned declaration in `rwe.config.json` with an author-side *request* that the operator must
allow-list — because "the confined party writes its own confinement is not a boundary." I don't have
a security-lens argument to weigh that trust-boundary call myself, so I hold on picking a winner. What
I add: **whichever model wins, the consumability cost is not smaller under the operator-owned
version — it's larger, and differently shaped**, and the ADR should size it correctly rather than
treat "operator-owned" as consumability-free because it's off the author's schema:
- If author-owned (my round-1 default): one new schema field + REQ-130-style guidance. Done.
- If operator-owned-with-request (their C2 proposal): **two** surfaces need the REQ-130 treatment,
  not one — (a) the operator-facing `rwe.config.json` schema, and (b) the author-facing *request*
  contract, including the shape of a refusal. Adversarial's own point that "the refusal message
  names the path, so the operator's action is one line" is a consumability requirement in disguise —
  it only holds if that refusal is a structured, documented error an author can act on
  (`workflow_describe`/registration-time validation, per D14, same as I said in round 1), not free
  text. Without that, "operator-owned" degrades into "an author files a support ticket," which is a
  worse consumability outcome than either of round 1's proposals.
- Either model also needs an operator-facing *read* path (what's currently declared / pending) — the
  jev-haiku case that motivated this requirement is exactly a case where nobody had a place to look
  this up before finding 510MB by accident. This is new territory neither round-1 proposal named.

**D4 — REQ-219's `session-options-builder`: my round-1 "re-verify per-module" vs. their F1–F3 rider.**
**Concede fully, and elevate.** Round 1 treated `session-options-builder.ts` as a same-shape sibling
of `timeout-race.ts` — dead code to decide against current call sites. Adversarial's F2 is a stronger
and more consequential finding than that framing allowed: `grep -rn "findProjectMarkerAncestor" src/`
returns *only* the module's own three call sites — meaning REQ-021's intra-run re-walk (the check
that catches an agent writing `.git`/`CLAUDE.md` into its own workspace mid-run, after the boot-time
check already passed) **does not exist in production at all**, and `rtm.md:100` marks REQ-021 ✅
anyway, citing a VAL test that exercises the unwired module. That is not "a dead-code cleanup
question"; from this lens it is the sharpest possible instance of the defect Observability and
Self-sustainability both exist to name (see §1 and §4), and I adopt their rider as non-negotiable:
delete the module and its four test files, but **wire the one live DES-031 line directly into the
SDK client's option assembly in the same change**, and re-point VAL-024's re-walk clause and
VAL-019's clause 2/3 at that production path. Deciding REQ-219 "independently per module" — which is
exactly what my own round-1 "Expected disagreements" section predicted someone would want — is the
one outcome that must not happen here; I withdraw that neutrality now that the grep evidence is in
front of me.

**D5 — `timeout-race.ts`: converging, one addition.** **Concede, minor addition.** Round 1 flagged
that the tech_stack-cited unbounded-wait gap looked already closed by `AbortController`/`timeoutMs`
(D-F7/D-F9a) and asked whoever owns REQ-219 to re-verify rather than carry the stale claim forward.
Adversarial's F4 does exactly that re-verification and reaches the same conclusion with sharper detail
(kill-on-timeout now the SDK's own `abortController` against the real subprocess, not an injected
callback that Gate-7.5-round-4 caught failing to kill it; slot-release now `withSlot(...)/finally` in
`agent-semaphore.ts`, never dependent on the timeout primitive to begin with). I fold this in as
settled. Their R9 addendum — rewrite `val-023-sdk-gateway-timeout.test.ts` against the production
timeout path instead of deleting it outright — is exactly the shape of test a Self-sustainability
lens wants kept: a real-tier probe of "does the system still fail fast and release its slot under an
actual hung endpoint," which is a tool-liveness check in this dimension's own terms, not incidental
test-count hygiene. I adopt it into §4.

**D6 — `failIfUnavailable: true` (their C1), from a self-sustainability angle.** **Concede, with a
framing addition, not a rebuttal.** Their resolution (fail-closed on same-unix-user hosts, with the
fallback of fail-open-but-refuse-remote-submissions if overturned) is, read through this lens's own
System-altitude definition, a textbook circuit-breaker / graceful-degradation instance — the exact
pattern this dimension's brief names for Self-sustainability. I'd rather name that explicitly than
let it read as a security-vs-ops trade with no self-sustainability content: refusing to *start* a
confinement-less run is the self-healing move (don't let a bad instance serve traffic), and the
fallback of degrading only the *remote-submission* trust boundary while keeping local runs live is
the graceful-degradation move (contain blast radius instead of an all-or-nothing outage). The one
condition I add, from Observability, is procedural: the refusal (or the degrade-to-local-only switch)
must go through the same typed-error/journal seam as every other startup failure — not a stderr line
an operator has to notice — otherwise "fail closed" quietly becomes "fail silent," which is the
identical failure shape REQ-218 was raised to close in the first place (§1).

**D7 — R6, shared `allowHostPaths` entries across concurrent runs.** **Hold, with an amendment.**
Adversarial names this (a declared shared path like `$HOME/.cache/jev-haiku` is mutable state shared
by concurrent agent slots) and correctly scopes it out of REQ-218 — "in scope to name... not to
solve." I don't disagree with leaving it unsolved this iteration; the acceptance criteria don't ask
for it. What I'd add is procedural, not substantive: "named in an ADR paragraph" and "tracked" are
different outcomes, and this ledger has a specific, recent memory of the first one quietly becoming
permanent (REQ-219 itself is the ledger re-litigating debt that was named once and then forgotten for
multiple iterations). The ADR should give this a REQ/backlog id, not just a sentence, or it repeats
the shape of problem this same iteration exists to close.

## 1. Observability

**Final position.** The seam is not a spawn wrapper (§ D2) — it is the point where `Options.sandbox`
is assembled and handed to `query()`, plus whatever channel the SDK/CLI uses to report a violation
back. Two events, minimum, both carrying `runId`/`agentId`:
- `sandbox_policy_applied` — emitted once per `agent()` call at options-assembly time: the
  `allowWrite`/`denyRead`/`credentials` object actually constructed for that run. This is cheap
  (one object, one call) and gives an operator a "what could this agent touch" answer without
  reading source.
- `sandbox_denial` — emitted when the CLI/kernel refuses a path. Must be a **distinct, positively
  emitted fact**, never inferred from the absence of an error — this is the same defect class
  adversarial's R10 found in `extractCandidatePaths` (empty candidate list returns the *same* verdict
  as a checked-and-clean one) and it must not be reintroduced on the new mechanism's denial path.
  Whether the SDK exposes this as a callback, an exit code, or parsed stderr is exactly the second
  thing (beyond "does `allowWrite` work at all") that adversarial's Gate-2 spike needs to establish
  before the ADR can specify the event's construction — I'm adding this to the spike's required
  outputs, not proposing a second spike.

Both events join the existing per-run journal/dashboard trail (REQ-135/167) as first-class event
types. `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` gets adversarial's one-line "why it's harmless now"
annotation rather than a redesign — I agree that reopening `allowedTools`/`tools` semantics this
round is not worth the 7B tool-surface regression risk they name.

**REQ-219 as an observability defect, sharpened.** Round 1 said a green-tests/zero-importers module
is "a dashboard lying about coverage." Adversarial's F2 shows the lie is worse than a coverage
metric: `rtm.md` marks REQ-021 ✅ against a real-tier test (VAL-024) that exercises code with no
production caller, which means the *traceability ledger itself* — the artifact this whole SDLC model
uses in place of a human remembering what's tested — is currently asserting something false about a
security control. That's the highest-severity form of "opaque failure" this dimension calls a design
defect, because the normal detection path (someone reads the code) is exactly what a green RTM line
is supposed to make unnecessary. The fix is D4's rider, not a documentation caveat.

## 2. Replaceability

**Final position, revised per D1.** No new interface. The existing gateway-swap boundary (D2,
`GatewayClient`) already does the job: `ClaudeAgentSdkGatewayClient`'s options-assembly populates
`Options.sandbox`; `LiteLLMGatewayClient` has no CLI subprocess and doesn't populate it, exactly the
same shape as its existing non-implementation of `canUseTool`/`permissionMode`. Nothing about
REQ-218 should touch the `GatewayClient` interface's method signatures. The one replaceability risk
that survives from round 1 — unprivileged namespaces aren't uniform across deployment targets — is
real but is adversarial's problem to close via `failIfUnavailable` + the remote-host spike, not an
abstraction problem; I was solving the wrong layer for it in round 1.

Agent altitude: unchanged from round 1 and unopposed — confinement mechanism and model/provider
choice are orthogonal, and the ADR should still say so explicitly so a future reader doesn't conflate
"what Bash can touch" with "which LLM answered."

## 3. Consumability

**Final position, incorporating D3.** Two things must both land in the ADR regardless of who wins
C2's ownership question:
1. Whichever surface is author-facing (either the `allowHostPaths` schema itself, or the *request*
   contract if operator-owned wins) gets the REQ-130-style treatment: declared in the schema
   `workflow_describe`/registration-time validation already enforces, explained in the client
   plugin's guidance (D8). A refusal in the request model must be a structured, documented error that
   names the path — not free text an author has to interpret — or the "operator's fix is one line"
   property adversarial claims for their proposal doesn't actually hold.
2. An operator-facing **read** path over current declarations (and, if the request model wins,
   pending requests) is new territory neither of us named in round 1. The 9/20 evidence that started
   this requirement was exactly a case of nobody having anywhere to look this up before finding the
   effect (510MB) by accident. Without a read path, "operator-owned" trades one invisible state
   (uncontrolled Bash writes) for another (uninspectable declarations) — smaller, but the same shape
   of consumability gap.

System altitude carried forward unchanged from round 1 (hand-rolled JSON-RPC-over-HTTP MCP surface,
pre-existing drift, worth one line in the ADR since any new declared capability is one more thing
that layer must keep in hand-written sync with docs) — adversarial didn't touch this, no conflict.

## 4. Self-sustainability

**Final position, incorporating D4/D5/D6.**
- **REQ-219, `session-options-builder`**: delete, with the DES-031 re-walk line wired into
  production in the same change (D4) — not because deleting dead code is wrong, but because this
  particular dead module is load-bearing for a ledger claim (REQ-021 ✅) that would otherwise become
  permanently false the moment the module is removed. A self-sustaining system's tests are supposed
  to be its nervous system for "is this control still real" — here they were reporting a sensation
  from a nerve that isn't attached to anything.
- **REQ-219, `timeout-race.ts`**: delete; its two guarantees (kill-on-timeout, slot-free-exactly-once)
  are now carried by strictly better mechanisms (SDK `abortController` against the real subprocess;
  `agent-semaphore.ts`'s `finally`-guaranteed release) that don't depend on this module and never did
  for the second guarantee. Rewrite `val-023` against the production timeout path (D5) rather than
  delete it outright — a real-tier "does the system still fail fast and free its slot under an
  actual hung endpoint" test is precisely a tool-liveness check, the mechanism this dimension asks
  for, and REQ-020 would otherwise lose its only fault-injected real-tier coverage.
- **REQ-218's confinement choice**: unchanged from round 1 — kernel-enforced confinement is
  self-sustaining by construction (no per-workflow human upkeep once configured); `allowHostPaths`
  alone would require a human to keep declaring paths correctly forever. This is still the core
  argument for (c) over (b) alone, now backed by adversarial's finding that the kernel-enforced half
  costs us nothing to build.
- **`failIfUnavailable: true` (D6)**: read as a circuit-breaker instance of this dimension rather
  than a pure security call — refuse-to-start-unconfined is the self-healing move, and their proposed
  fallback (degrade only the remote-submission trust boundary, keep local runs live) is the
  graceful-degradation move this dimension's brief names for extreme-load handling, applied instead
  to a missing-capability condition. Both must fail through the observable seam in §1, not stderr.
- **General mechanism, new this round**: F1–F2's finding — a fence test at `gateway-effort.test.ts`
  correctly caught the *presence* of drift once someone thought to write it, but nothing caught the
  *coverage lie* (VAL-024 exercising unwired code, REQ-021 marked ✅ regardless) until a panellist
  manually grepped `findProjectMarkerAncestor` this round. That's a gap in the machinery, not just in
  this one instance: I'd recommend the ADR note a follow-up check — something like "flag any `src/`
  module with zero production importers that is cited as real-tier evidence (VAL-*) for an RTM ✅
  line" — as a backlog item, so this class of drift is caught automatically next time instead of
  depending on a panellist happening to grep the right symbol. This is the "minimize human
  intervention" half of this dimension applied to the SDLC ledger itself, not just to the runtime.

## Remaining disagreements (unresolved after this round)

1. **C2 — who owns `allowHostPaths` declaration** (operator vs. author-with-request). Neither of us
   resolves this; I've sized the consumability cost of each branch (§3) rather than picked one. This
   is the one item I'd flag as still needing a security/trust-boundary lens's explicit ruling before
   the ADR can be written, not another quality-dimensions round.
2. **The exact shape of the `sandbox_denial` event** depends on what the Gate-2 spike finds about how
   the SDK/CLI actually surfaces a violation (callback vs. exit code vs. stderr) — I've specified the
   event's *contract* (§1) but its construction is blocked on that spike's output, same blocking
   relationship adversarial already established for the mechanism question itself.
3. **R6 (shared `allowHostPaths` path as concurrent mutable state)** — I've asked for a tracked
   backlog id rather than an ADR sentence; adversarial hasn't taken a position on tracking mechanism
   specifically, only on scope (agreed: out of this iteration to solve).

No disagreement remains on: REQ-218 option (c) via the SDK's native `sandbox` mechanism (not a
hand-rolled wrapper); REQ-219 deleting both modules with the DES-031 rewiring rider and the val-023
rewrite-not-delete treatment; the PreToolUse hook staying in place as a disjoint-tool-set partition,
not redundancy; and `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` getting an annotation rather than a redesign.
