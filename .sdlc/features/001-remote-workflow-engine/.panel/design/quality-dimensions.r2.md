# Quality-dimensions lens — Design stage, round 2

**Read for this round:** my own `quality-dimensions.r1.md` in full, and `adversarial.r1.md` in full (11 dated
findings D1-D11, six lens-conflict notes C1-C5, and an explicit §8 predicting five points of disagreement
with this lens by name). I address every D-item that lands on one of my four dimensions, and every §8
prediction, by name, with rebut/concede/hold. Net effect: **on every §8 prediction, the adversarial lens
predicted my r1 position more pessimistically than my r1 actually held it, and on three of five I end up
on their side of the fence, not the one they expected** — this round is mostly convergence, and I say so
plainly rather than manufacturing disagreement to fill a section.

**Where round 1 undersold the problem:** two of the four gaps I raised in r1 (dashboard rendering, write-
ordering) were real but shallow next to what adversarial's line-level tracing found underneath the same
rows (D3, D7). I concede the depth gap up front rather than defending r1's coverage — a panel that ties
5-4 on point-scoring while missing a HIGH-severity correctness bug in the exact field I was praising has
not done its job. This round corrects that.

---

## (1) Observability

**r1 stood on:** ARCH-141/142/143's single-write/three-surface `recordError` pattern as the exemplar of
"one observable seam, not three chances to miss it," and ARCH-148's fail-closed valve as the same
principle applied at the registration gate.

**What adversarial's tracing does to that praise — three concessions, in order of how much they cost me:**

1. **D1 — concede, and correct my own r1.** I praised ARCH-141's `.detail` forwarding without tracing
   whether anything upstream of `toErr` can produce a `.detail` on the path ARCH-142 actually calls it
   on. Adversarial did that tracing — `guards.ts:322-335`, `host.ts:147/166`, `child-entry.ts:36` — and
   the answer is no: every producer on the sandbox-outcome path rebuilds a bare `{code,message}` before
   it reaches `toErr`. Worse for my dimension specifically: REQ-205's own named example
   (`violation: AGENT_OPT_RETIRED`) is an **engine refusal**, not a gateway failure, and it is caught by
   `evaluateScript` and flattened to `SCRIPT_ERROR` at `guards.ts:334` — the *code*, not just the detail,
   is gone two hops before ARCH-141 runs. An observable seam that cannot receive the signal it was built
   to carry is not a seam, it's a dead pipe with a label on it, and the unit test that exercises `toErr`
   directly (hand-build an `Error`, attach `.detail`) is precisely the kind of test my r1 should have
   flagged as suspect on sight — it proves the function is total, not that the system is observable.
   I take adversarial's **option (2)**: delete the forwarding and the byte bound, keep the file move
   (which is a real, independent testability win — see C2 below), and **state the deferral in writing**
   with the four line numbers, rather than let a green ARCH-141 imply a signal that isn't there. My own
   addition to option (2): the deferral note must also name the `SCRIPT_ERROR`-flattening loss
   (`guards.ts:334`, `refusalCode()`'s single-entry `ENGINE_REFUSAL_CODES` set) as the same open item —
   fixing `.detail` while the *code* stays flattened is fixing the smaller half and calling it done. If a
   v36 (or a widened v35) picks up D1 option (1) instead, it inherits both losses, not just the byte
   bound.

2. **D3 — concede fully, and elevate it above my own r1 gap #3.** My r1 flagged "no dashboard rendering
   item for `failedAgentCount`" as a Low-severity UI gap. Adversarial found underneath it that the field
   **reports `0` for the entire non-terminal lifetime of every run** — `saveSnapshot` writes only at the
   terminal transition, a `LEFT JOIN` against a run with no snapshot row yields `agentCount: null`, the
   stated guard `(row.agentCount ?? 1) > 0` evaluates that as `1 > 0` = true, and the field is emitted as
   a confident `0`. This is not a missing feature, it is **the exact defect class this dimension exists
   to name**: "a silent/opaque failure is a design defect" — except here it is worse than silent, it is
   *speaking a specific, wrong, reassuring number* to the caller who is polling precisely because they
   want to know if something died. A `run_list` poller mid-run reads "0 agents failed" about a run with
   one already dead. My r1's dashboard-rendering ask is still correct but now sequenced *after* this: I
   would be asking Design to wire a lie onto the UI faster. I adopt adversarial's fix in full — the
   guard must be `row.agentCount != null && row.agentCount > 0` (present *and* non-empty, not just
   non-empty), the field is **omitted**, not zeroed, for a run with no snapshot, and `run_list`'s
   documentation must say in one sentence that this is a **terminal-only** health signal (agent altitude:
   a cold client polling `run_list` mid-run must not read absence as health, and must not read `0` as
   health either once the fix lands, since `0` will now correctly mean "checked, none failed"). Once
   that fix is in, my original dashboard-rendering ask stands **unchanged** as the next line item — an
   operator watching a `completed` run with `result:null` still has to know to check a field the UI
   doesn't surface, and that's true whether the field is buggy or fixed.
   On the **denominator point** specifically (adversarial's §8.1 prediction that I'd want a richer
   payload than a bare count): I don't. `agentCount` is already returned by the same projection under the
   same guard (ARCH-143 note, `usagePresent`'s precedent) — the denominator I'd want is already there,
   just not named as a pairing. I'll take that as a one-line documentation ask (`run_list`'s field
   description for `failedAgentCount` should say "read against `agentCount` from the same row"), not a
   schema change. Adversarial's R8 line — a count, never narrative text, because `/api/runs*` is
   unauthenticated and per-agent text is gated differently — is correct and I hold it too; I raised no
   objection to it in r1 and don't now.

3. **D6.5 (the read-side wiring gap) — concede and connect it to my own opening praise.** My r1 called
   out ARCH-141/142/143's *write*-side pattern (one `recordError` call, three surfaces, no fan-out) as
   this repo's named `composeConfig`/v31-`costUSD` anti-pattern being correctly avoided. Adversarial's D6
   item 5 finds the mirror-image gap on the **read** side: `runs.error` needs to reach `RunSummary` via
   **two** explicit `SELECT` column lists (`listRuns`, `list`) plus `RunStatusView` via `getRun` (which
   `SELECT *`s the column for free but still needs the row type and a conditional-spread line) — four
   sites, and ARCH-143's note only shows the write path. This is the same wiring-gap class I praised the
   write side for closing, sitting open on the read side of the identical feature. I want it named
   explicitly in the design doc, not left as "TypeScript will catch it" — TS catches a missing property
   read, it does not catch a forgotten `SELECT` column that silently returns `undefined` and gets treated
   as "no error" by any caller that does `if (row.error)`. One test exercising `listRuns()`, `list({})`,
   and `getRun()` on the same failed run (adversarial's own proposal) is the closure; I'm folding it into
   my dimension because "observable on one surface, silent on the sibling surface" is exactly the failure
   shape this dimension names.

**Where I hold without change:** the redact-at-capture design (ADR-066) and the fail-closed registration
valve's *shape* (ARCH-148) are still correctly identified as exemplary in r1, and nothing in adversarial's
r1 undermines either — D4 (below, under Replaceability/Self-sustainability) is about the valve's **reach**,
not its shape. I also hold my r1's per-agent code/message parity question (gap #2) as still open and
unanswered by either document; it should get the same one-line "already covered by X" or "explicitly
deferred" treatment I asked for in r1.

**Final position:** two of my three r1 Observability claims needed correction once adversarial's tracing
came in (D1, D3), and I've adopted their fixes rather than defend the original framing. That is what
convergence looks like when the other lens did the more thorough job on a shared row — the honest move
is to say so, not to find a smaller disagreement to preserve independence.

---

## (2) Replaceability

**r1 stood on:** acorn-as-pure-function (not a port) being a correct, precedent-matching exception, and
the system/agent altitudes both being untouched by v35 otherwise.

**D9 changes this from "unaffected" to "one real finding," and it's squarely in my dimension, not
adversarial's — I'm surprised it landed in their doc first.** `GatewayClient` is the literal port my r1
named as the agent-altitude replaceability seam ("the LLM backend is decoupled so GPT↔Claude↔a local
model is a config change, not a rewrite"). ARCH-147 computes an advertised `attempts`/`worstCaseMs` from
"the effective deployed gateway config" as if that were one number. Adversarial traced both
implementations and found they disagree in the untimed case:
`claude-agent-sdk-client.ts:507` gives `1 + retries` only when a timeout is set (else `1`);
`src/gateway/client.ts:515` gives `1 + Math.max(0, retries)` **unconditionally**. `tech_stack` ships both,
selected by `"gateway":"sdk"|"direct-fetch"` at the composition root — which is exactly the config-not-
rewrite switch my r1 cited as this system doing replaceability correctly. **Rebut adversarial's own
framing of this as a contract/agent-altitude-only point (D9, "LOW-MED"):** it is that, but it is *also* a
replaceability-contract violation one level up — a port whose two implementations expose different
observable retry semantics is not fully interchangeable at the boundary this dimension cares about, even
though both satisfy the same TypeScript interface. A `GatewayClient` swap is supposed to be invisible to
the caller; here it silently changes how many attempts an untimed call gets, which is a behavior a
workflow author's script can depend on without any type error ever firing. I'm elevating this from "guide
prose is wrong for one gateway" (their framing) to **"the port's two implementations have divergent retry
semantics and the interface doesn't pin that down"** (mine) — same fix, stronger reason to take it now
rather than defer it: **read the advertised `attempts` from the effective gateway's actual behavior (already
a `composeConfig`-class forward, so the existing wiring guard covers it), and drop the SDK-only exception
from the guide** — or, if the panel wants the deeper fix, unify the two implementations' untimed-attempt
behavior so the port is behaviorally, not just structurally, interchangeable. I'd take the cheap fix for
v35 (advertise correctly) and file the deeper unification as a v36 replaceability-hardening item, the same
way ADR-070 filed `structuredContent` — evidenced, not actioned here.

**On acorn (unchanged from r1):** D4 doesn't reopen the port-vs-not question — I checked. `acorn` stays a
pure function with `deps: —`; nothing in adversarial's D4 argues it should become an injectable seam. What
D4 argues is about **reach** (does the fail-closed valve's *signal* reach every consumer), which is an
observability/self-sustainability question, not a replaceability one — see below. I hold my r1 conclusion
on this specific point unchanged.

**Adversarial's §8.4 prediction ("they may want the oracle's fail-closed to be uniform everywhere...
replaceability: one behaviour, one name") — rebut the prediction, not the finding.** I don't want
uniformity for its own sake, and "one behaviour" was never a replaceability argument in my r1 — replaceability
is about swappable *implementations behind one interface*, not about every *consumer* of a scan result
reacting identically to a degraded scan. A dashboard render and an admission gate have different
correctness requirements (one can refuse, one cannot), so asking them to behave identically is actually
the anti-pattern, not the fix. I take D4's own resolution — `unscannable?: true` on `AgentCallScan`, one
line at each of the four silent read callers — because it's the right shape under **Observability**
(the signal must reach every consumer that reads `.calls`/`.labels`, not just the one that can refuse), not
under Replaceability. I'm folding this into dimension (1) above in spirit; adversarial predicted the wrong
dimension for my objection but got my agreement on the fix.

**Final position:** one real Replaceability finding this round (D9, elevated), full agreement with
adversarial's fix, plus a sharper reason to take it into v35 rather than defer it. No disagreement with
D4's fix; disagreement only with the framing adversarial predicted I'd bring to it (I didn't bring it).

---

## (3) Consumability

**r1 stood on:** ARCH-151/152/154/147 as "documentation-as-interface" fixes, correctly answering measured
integration failures, plus one gap: `run_result`/`run_status`'s tool description doesn't name the two new
response fields (`error`, `failedAgentCount`).

**Hold, largely, with one narrowing.** Nothing in adversarial's r1 argues against the doc-fix rows
themselves; D9's gateway-attempts finding (discussed under Replaceability) does mean ARCH-151's guide
sentence about the untimed exception needs a correction — I'm not duplicating that argument here, just
noting the Consumability angle: a cold author reading the guide's stated rule and getting the *wrong*
number for their deployed gateway is a worse consumability failure than the number being merely
undocumented, because it's confidently wrong in the same way D3's `0` was confidently wrong. Same shape of
defect, two different rows — worth naming as a pattern: **this slice has now surfaced two "correctly
computed for one code path, silently wrong for the sibling path" defects (D3's terminal/non-terminal split,
D9's timed/untimed-times-gateway split)**. That's not proof of a systemic problem, but it's the second
instance in one review, and I'd ask whoever owns the Gate-3/4/5 constraint list to add a review note:
*any row that says "the computed value describes the caller's situation" gets checked against every branch
of the thing being computed from, not just the one the row's own example hit.*

**On my r1's `run_result`/`run_status` documentation gap:** unchanged and still open. I'd resequence it,
same as the dashboard item: land D1's resolution and D3's fix first (so the fields being documented are
the ones that will actually ship and actually mean what they say), then add the tool-description sentences
for whichever of `error`/`failedAgentCount` survive those two decisions. If D1 goes to option (2)
(defer `.detail`), the `run_result` sentence describes `{code,message}` only, not `{code,message,detail?}`
— documenting a field shape that D1 shows won't be populated would be a third instance of the same defect
pattern, introduced by my own proposed fix if I don't say this now.

**D11 (LOW, agent altitude) — concede, minor.** Ordering the meta-span check before the acorn parse so a
`pureLiteral:false` meta doesn't degrade a specific refusal (`AGENT_LABEL_REQUIRED`, etc.) into a vaguer
`SCRIPT_UNSCANNABLE` is exactly the kind of thing my r1's ARCH-151 praise was about (a cold author gets a
message that tells them what's wrong, not a generic failure). Small, correctly scoped as ordering-not-code
by adversarial; no disagreement.

**D10 — no position, correctly out of scope for this dimension.** Module-scope memoization breaking
per-test isolation is a testability concern (adversarial's own lens), not a consumability one — the
*caller* never sees the memoization, only the test suite does. I note it only to say I looked and it
doesn't belong here.

**Final position:** r1's Consumability gap stands, resequenced behind D1/D3; one new cross-cutting pattern
observation (branch-blind computed values) that I'd like written into the Gate-3/4/5 constraint list once,
rather than re-derived per row.

---

## (4) Self-sustainability

**r1 stood on:** the system-altitude "no watchdog, restart is the supervisor's job" stance as correctly
unchanged, ARCH-142's restart-safe `result()` fix as a self-sustainability win worth naming, and the
authoring-guide's monotonic size growth as the one real agent-altitude analog to memory metabolism (filed,
not actioned, per ADR-070 — which I now see the architecture doc credits me with raising and correctly
declining to force into v35).

**D7 — concede, and it cuts directly against the win I praised.** I called ARCH-142's `result()` fix
"recovering cleanly from a disruption without losing operational integrity." Adversarial found the
mechanism that's supposed to *record* that recovery has its own uncaught failure mode: `_runLive`'s
`.then()` continuation has no `.catch`, and ARCH-142 inserts `await this._store.recordError(...)` before
the transition to `failed` with nothing wrapping it. If that write throws — disk full, EACCES, a
serialization failure — **the run never transitions, stays `running` forever, and is not even
`interrupted`**, so nothing in this system's existing "restart is the supervisor's job" story ever picks
it up. This is precisely the failure mode my dimension is built to catch: a partial failure that produces
a stuck, unrecoverable state requiring manual intervention, worse than the state v35 exists to fix (at
least a silently-dead process gets restarted and its `running` rows get reconciled; a hung continuation on
a live process does not). I adopt adversarial's fix — `try { await recordError(...) } finally { await
transition(...,'failed') }` plus a `.catch` backstop on the continuation — and I add the self-sustainability
framing explicitly, since D7's own text frames this mostly as a boundary/error-handling point: **a recorder
that can get stuck recording is a self-healing regression, and it should be named as such in the design
doc's "where the non-functional qualities live" paragraph, next to where ARCH-142's restart fix is already
credited.** I also want the *serialization* half of D7's fix (bounded, cycle-safe `redact()`/`JSON.stringify`
at capture) treated as a self-sustainability line item, not just a defensive-coding footnote — a value that
can throw while being recorded is a value that can turn "record the failure" into "cause a second, worse
failure," which is the opposite of graceful degradation.

**D2 — hold on the outcome, rebut the predicted reasoning.** Adversarial's §8.5 predicts: "they will
likely prefer ADR-071 option (c) [drop `args` from `effectiveParams` entirely] on self-sustainability
grounds — fewer invariants to hold." **That's not my reasoning, and it's not my conclusion.** A run that
becomes *permanently* unresumable because its own admitted arguments happened to contain a provisioned
secret is a worse self-sustainability outcome than one more scoping rule on `hasSecretMarker` — permanent
unresumability is a dead end requiring a human to notice, diagnose, and manually work around (probably by
re-submitting a new run under a different name), which is exactly the "minimize human intervention"
failure this dimension is written against. "Fewer invariants" is not a self-sustainability value in
itself; *fewer permanently-stuck states* is. On that basis I land on adversarial's **option 1** — scope
`hasSecretMarker`'s scan to the fields that are actually dispatched (`effectiveParams` minus `args`,
consistent with ADR-071's own decision that `args` is a record, not a dispatch source) — for a
self-sustainability reason that happens to agree with their observability/audit reason (option (c) also
loses the audit record REQ-206 names). Two dimensions, same conclusion, different justification — that's
the good kind of convergence, and I want it on record that I did not need to be argued out of option (c);
I never held it.

**Authoring-guide size (unchanged from r1, now cross-referenced against ADR-070):** the architecture doc's
ADR-070 confirms my r1 read — the concern was raised as an open question, correctly not forced into v35
for want of a measured cap, and filed with its evidence attached (`~79KB` on a `~39.5KB` document, the
`structuredContent`-doubles-the-payload measurement). I have nothing to add or retract; I'd only ask that
the v36 filing keep the "memory-metabolism" framing explicit (r1's ask), since ADR-070's filed language is
about `structuredContent`/`outputSchema`, which is a different mechanism than a segmented/summarized guide
— the two are related (both about the size of what a cold agent ingests) but not the same fix, and I don't
want the framing to collapse into "solved by structuredContent" when that ADR is picked back up.

**Final position:** one r1 claim needed a real correction (D7 undercuts the restart-safety win I praised),
one prediction about my reasoning was simply wrong (D2 — I was never going to argue for option (c), and I
land on the adversarial's preferred fix from an independent direction), and the authoring-guide filing
stands as r1 left it.

---

## Where I still disagree, or haven't converged

1. **D1's chosen resolution.** I take option (2) (defer, don't forward what nothing produces) on
   simplicity grounds shared with adversarial, but I add a documentation obligation (name the
   `SCRIPT_ERROR`-flattening loss in the same deferral note) that adversarial's write-up doesn't require.
   If the synthesizer takes option (1) instead, my ask stands regardless: whichever option ships, the
   design doc must say, in one place, exactly which of REQ-205's four acceptance criteria are met and
   which are deferred — not implied by a green ARCH row.
2. **My r1's per-agent code/message parity question (gap #2)** is still unanswered by both documents. Not
   a disagreement, an open item: someone needs to write the one sentence confirming whether
   `AgentTranscriptSink`/`workflow_agent_log` already carries this, or REQ-207's closure line needs it
   named as out of scope.
3. **The Gate-3/4/5 constraint-list housekeeping** I'm proposing (branch-blind computed values as a named
   review pattern; `run_list`'s `failedAgentCount` documented against its `agentCount` pairing; the
   `run_result`/`run_status` doc additions resequenced behind D1/D3) are asks on process, not contested
   engineering — I don't expect adversarial to object, but they're additions, not yet agreed line items.

## Converged this round (no remaining daylight)

D2's fix (scope the secret scan, keep the audit record), D3's fix (presence-guard + omission + terminal-only
statement + five-case test matrix), D4's fix (`unscannable?: true`, one line per consumer, no uniformity
demand from me), D7's fix (`try/finally` + `.catch` + defensive serialization), D9's fix (read `attempts`
from the effective gateway, correct or drop the guide's SDK-only exception), ADR-066's redaction-at-capture
(already conceded pre-emptively per the architecture doc's own note), and ADR-070's v36 filing of
`structuredContent`.
