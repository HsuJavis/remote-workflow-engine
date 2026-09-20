# Quality-dimensions expert — Architecture round 2 (v35, REQ-205..210)

Read: `adversarial.r1.md` (Security × Scalability/Performance × Testability, Karpathy tie-break).
I grepped both files their load-bearing citations depend on before relying on them below, rather than
taking the line numbers on faith:

- `sqlite-run-store.ts:246-353` — confirmed. `_rowToSummary`'s `agentCount` is exactly the
  `json_array_length(s.json,'$.agents')` read-time projection they describe, already gated by
  `usagePresent = !!row.usagePresentRaw && (row.agentCount ?? 1) > 0` at line 264.
- `run-manager.ts` — confirmed against a targeted grep (`toErr`, `redact(`, `resultError`,
  `_secretValueProvider`, `storedParams`): `toErr` is defined at `:150` exactly as cited; the
  `redact()` fork is at `:626-627`; `entry.resultError = toErr(outcome.error)` at `:1225` is bare —
  the nearest `redact()` calls in the file are at `:1115` (the live `agents` array) and `:1447-1448`
  (the journal entry), neither of which touches `resultError`; and it sits directly above
  `await this._transition(runId, entry, 'failed')`, immediately after the success branch's
  `recordResult` + `_transition('completed')` — the write-then-transition symmetry adversarial's §3(c)
  R4 argument depends on. All of adversarial's cited line numbers I checked hold.

Per REQ, in the same order as both r1 documents, then a self-contained final position.

---

## REQ-205 — diagnosable reason on disk

**Concede, and fold into Observability as a hard gate, not a side risk.** Adversarial's R1 (HIGH,
verified: `entry.resultError = toErr(outcome.error)` at `run-manager.ts:1225` is bare — no `redact()`
call, and DES-088's four enumerated sinks don't include it) is not a security-only finding from where
I sit. It is the *same defect this dimension exists to name*: a field this iteration adds specifically
to make internal state observable becomes, if unredacted, a **new opaque-failure surface one layer
up** — a caller who now gets a reason string that happens to contain a bearer token has traded "silent
failure" for "silent exfiltration," which is not the trade REQ-205 was written to make. I'm not
treating this as a competing security concern to be traded off against my consumability read of the
same REQ (cold agent wants the verbatim string) — I concede that trade outright, for the reason
adversarial gives in their §5 conflict #2: the fix is a **visible redaction marker**, not silent
truncation. A marker is itself an observability artifact (it tells the reader "something was here and
removed," which is strictly more honest than either extreme). So: Observability's acceptance
criterion for REQ-205 now reads *diagnosable reason, redacted-with-marker, reaching disk* — not just
"reaching disk." This tightens my r1 position; it does not replace it.

One addition from my chair, not raised by adversarial: whatever marker format is chosen
(`[redacted]`, a redaction count, etc.) must itself go through the **same** code path on all three
surfaces REQ-205 touches (`runs.error`, `journal.jsonl`, `run_list`/dashboard) — if the column and the
journal line are populated at two different call sites (plausible, since one is a DB write and one is
an `appendFileSync`), a redaction fix applied to one and not the other reproduces the exact
composeConfig-wiring-gap / v31-`costUSD` drift pattern both r1 documents already independently name
for other fields in this same REQ. Concretely: **one `buildDiagnosticReason()` helper, called once,
its output written unchanged to all three surfaces** — not three call sites each doing their own
`redact()` call, which is three chances for one to be missed.

This is also where adversarial's own §3(c) testability note belongs, and I'm adopting it as this
dimension's acceptance bar rather than leaving it filed under Testability alone: a test that seeds no
`_secretValueProvider` and then asserts "the secret string is absent from `runs.error`" passes
vacuously — there was never a secret-provider to redact anything, so the assertion is true for the
wrong reason. That is the identical "closed at the type/shape level, not the behavior level" pattern
I'm naming for REQ-206 (registration stops rejecting the default vs. the default actually reaching
`effective_params`) and REQ-209 (the parameter is required vs. a v2 rule actually fires). REQ-205's
version of the same test discipline: the test must inject a real provider, seed a real secret, and
assert the marker is present *and* the raw secret is absent — proving redaction happened, not merely
that the output looks clean.

## REQ-206 — `args` `{}` + defaults must apply

**Concede in full; adversarial's read is strictly more useful than mine and I have nothing to add
against it.** My r1 asked for "a test asserting `default` really flows into `effective_params`."
Adversarial's R5 (fork at `run-manager.ts:627` — materialize before it, or persisted snapshot lacks
the defaults while first dispatch has them) and R5b (pre-v35 rows with `args='null'` still reach the
sandbox as literal `null` through the resume handoff at `:1221`, independent of the admission-time
fix) are the concrete failure shapes my abstract "don't repeat the P6-3 served-but-inert pattern"
warning was gesturing at, found by someone who actually read the fork and the resume path. I'll cite
both by name in my final position below instead of restating my own vaguer version. No residual
disagreement.

## REQ-207 — run-level health signal

**This is the one place I have a factual objection, not a framing one, and it's about adversarial's
own internal consistency, not about my r1 position versus theirs.**

Adversarial's §2 finding and their §3(b) performance claim contradict each other:

- §2 (correct, and I verified it): "the minimum is no schema change, no new column, and no new write
  site at all — one more projection on the query that already reads the snapshot... It survives
  restart because `run_snapshots` already does."
- §3(b) (wrong, on their own evidence): "REQ-207's health field computed at the terminal transition
  is O(agents) once, versus O(agents) on every `run_status` poll if computed at read time... Write-time
  is strictly better here and it is also the only version that survives restart."

§3(b)'s "only version that survives restart" claim is false given §2's own finding: `run_snapshots`
already persists `agents[]` as JSON at admission/update time, so a read-time projection off it (what
§2 actually proposes and what I proposed independently in r1, citing `computeWorkflowMetrics` as
precedent) survives restart *for free*, the same way `agentCount` already does today. There is no
"write-time at the terminal transition" version in §2's design at all — §2 never proposes writing
anything new. I read §3(b) as an artifact of adversarial's own stated process ("I began by proposing a
field computed at the terminal transition... reading the code kills that") where the earlier,
abandoned design leaked into the performance section after the correct one replaced it in §2 — and it
recurs a third time, not just in §3(b): §5 conflict #3 ("Simplicity ↔ Consumability") also says "the
field is computed at a write site that already exists," restating the same abandoned premise while
adjudicating a different conflict. Three independent restatements of the pre-§2 design make this look
less like a stray sentence and more like the earlier draft never got swept from the later sections
after §2 superseded it. This matters for round 3 because if a designer reads §3(b) or §5#3 in
isolation they'll persist the field and reintroduce exactly the drift risk my r1 flagged (the v31
`costUSD`-presence bug class) — §2 is the section that actually reflects the evidence adversarial
themselves read, and it's the one I'm holding both of us to.

**Rebut §3(b), hold my r1 §2-equivalent position, which adversarial's own §2 already independently
reached:** REQ-207's health signal is a **pure read-time fold over the already-persisted
`run_snapshots.agents[]`**, computed the same place `agentCount`/`usagePresent` are computed today
(`_rowToSummary`), inheriting their zero-agent guard (adversarial's own point, and one I hadn't
stated as precisely as `usagePresent = !!row.usagePresentRaw && (row.agentCount ?? 1) > 0` — I adopt
that exact predicate shape for the health signal too, since a script with zero `agent()` calls must
not report degraded health for having none to fail). No new column. No new write site. One O(agents)
scan per read of an already-small JSON blob, same cost class as the existing `agentCount` projection
— the O(agents)-once-vs-per-poll tradeoff §3(b) raises does not apply because there is nothing to
write in the first place.

## REQ-208 — scanner must not read string content as code

**Concede the implementation choice; hold the structural principle, and note the two aren't actually
in tension once stated precisely.**

My r1 argued for "a real-parser classification port," worried a regex "cannot in principle
distinguish a call site from a string literal," and rejected pulling in the TS compiler API as a
devDependency-to-runtime-dependency promotion, suggesting acorn/meriyah as a lighter alternative.
Adversarial argues for reusing `matchDelimiter`'s existing quote/backtick/escape state machine as an
index-preserving literal-mask pass, explicitly rejecting a JS parser as "a new failure mode... what
does the scanner do with input the parser rejects but the catalog would accept?" — and backs it with
three named adversarial test cases (template-literal `${agent(...)}` interpolation must be unmasked
back to code, escaped-quote desync, comment-swallowed apostrophe).

Rereading my own r1 language, the principle I actually need is **classification by tracking lexical
state (quotes/escapes/comments/nesting), not by pattern-matching the four characters `a`,`g`,`e`,`n`
against surrounding text** — a regex applied *after* correct state-tracking is not the "smarter
regex" I was rejecting; a state machine that already exists in this codebase and already handles
quotes/backticks/escapes (`matchDelimiter`) is closer to a lexer than to `AGENT_CALL_RE` alone. It
also directly answers my own devDependency objection without needing acorn/meriyah either: zero new
dependency, runtime or dev. **I concede the implementation to masking.** What I hold is that masking
only actually delivers the structural property I argued for — real lexical classification instead of
blind pattern-matching — if it correctly resolves adversarial's own three adversarial cases,
particularly the template-literal one, which requires the mask to treat `${` … matching `}` as *code
even inside a backtick-delimited string*, i.e. the masker needs one more state than plain quote-
tracking (a nested "back to code" mode inside `${...}`). This is adversarial's own R3/§2 requirement,
not a new one from me — I'm naming it as the acceptance bar for calling this "classification" rather
than "a better regex," since the difference is exactly what my Replaceability framing was trying to
preserve.

One dimensional note, not a design disagreement: adversarial's altitude table states "the
'replaceability' dimension is not moved by any of the six; I do not force it," which reads REQ-208
purely as correctness/security-of-an-admission-gate. I don't think the two readings compete for the
same requirement — "swap the classifier without touching every caller" (my framing) and "don't weaken
an admission gate while fixing it" (theirs) are both true of the same masking design, and the REQ's
own constraint (existing `SCAN_VIOLATION` tests stay green, same call signature) is the concrete
artifact of the pluggability property I was naming. I'm not asking for anything in the design that
their §2 doesn't already deliver — I'm only recording that the fix satisfies Replaceability as a side
effect of satisfying their correctness argument, so a future caller (adding a second call-site
classifier, say for a different admission gate) can point at `scanAgentCalls`'s signature as the
precedent. No action item; converged.

## REQ-209 — `checkMermaid` v2-param must not be silently degradable

**Concede, and retract my own r1 wording as internally muddled.** My r1 recommended "fail-closed by
default with an explicit opt-out" and, in the same sentence, cited compiler-enforcement (`tsc`-pinned
guarantees) as the justification — but an opt-out is a *runtime* branch, not something `tsc` enforces;
I was reaching for compiler-strength while describing a design that still keeps a second, degraded
mode alive behind a flag. That's the exact shape adversarial's whole REQ-209 argument is against, and
they're right that it's the weaker version of what I actually wanted: adversarial's plain "make the
fifth parameter required, no runtime opt-out, break at compile time" is what "matches this repo's
stated preference for compiler-pinned guarantees over prose/test-only pins" (the D5 precedent I cited
myself) actually requires. Their cost accounting (one production caller already passing 5 args; break
confined to two test files, ~14+14 call sites) makes the required-param version the *cheaper* option
too, not just the stricter one — I have no basis left to prefer the softer form.

I fold in adversarial's R6 (15 call sites forced to state a v2 expectation risks becoming 15
rubber-stamped `expected` objects, recreating a false green wearing a new hat) as the same recurring
shape I named for REQ-206/P6-3: **an interface change that looks closed but is only closed at the
type level, not the behavior level.** Their remedy — at least one v1-only test must assert a v2 rule
*firing*, not merely compiling — is the correct closure and I adopt it as this dimension's acceptance
bar for REQ-209 too: Consumability's "does the advertised interface understate reality" test applies
to test suites as callers, not just runtime callers.

## REQ-210 — envelope/size legibility

**Hold, narrowly, with the scope of my open question restated to avoid a manufactured disagreement.**
Adversarial states "Zero architecture" and pre-emptively opposes "a segmented/summary accessor... unless
a measured size cap is shown to be exceeded by something other than one 39.5KB document." I agree with
that opposition and am not proposing anything it covers — my r1's open question was specifically
whether the hand-rolled JSON-RPC transport could move the *envelope* (double-JSON-encoded text) to
MCP's `structuredContent` field, which fixes the encoding defect structurally instead of documenting
around it. That is orthogonal to size-segmentation: it changes how one response is shaped, not how
much content ships or in how many calls. I'm not asking for that migration to happen in v35 — REQ-210's
acceptance text is satisfied by documentation alone, and I said so in r1 — I'm only keeping the
question open for whoever writes the detailed design, since "state the encoding" (REQ-210's literal
ask) doesn't foreclose "fix the encoding" if it turns out to be cheap, and nobody on this panel has
read `server.ts`'s response-building code closely enough to rule it out. No disagreement with
adversarial once the two asks are told apart.

---

## 1. Observability

Converged with adversarial on REQ-205 and REQ-207, both strengthened by their code-level evidence:

- REQ-205's diagnosable-reason field must be redacted-with-marker at a single shared helper before it
  reaches any of its three surfaces (my addition this round, folding in their R1/R2).
- REQ-207's health signal is a read-time fold over already-persisted `agents[]` JSON, inheriting the
  existing zero-agent guard — no new write path, no drift risk. (Adversarial's §2 agrees; their §3(b)
  sentence is a leftover from an abandoned earlier design and should not survive into the detailed
  design — see rebuttal above.)
- My r1's open item on REQ-205 (does the diagnosable-reason guarantee cover boot-recovery's
  `interrupted` reclassification, which never passes through `_transition`) stands unaddressed by
  adversarial's round 1 — neither confirmed nor disputed. I hold it as a scoping question for the
  designer, explicitly not a v35 send-back, same as r1.

## 2. Replaceability

Converged on substance, clarified on framing. REQ-208's fix is a lexical-state masking pass reusing
`matchDelimiter`, satisfying both "don't weaken the admission gate" (adversarial's frame) and "swap
the classifier behind a stable signature without a new dependency" (mine) — see concession above. My
r1's REQ-209 recommendation is superseded by adversarial's stricter, cheaper required-parameter form;
I've withdrawn the opt-out variant. No open Replaceability items remain for v35 that adversarial's
design doesn't already close.

## 3. Consumability

Converged on REQ-206 (adversarial's fork/resume analysis is the concrete form of my abstract
warning — adopted, not restated), REQ-209 (rubber-stamp risk R6 adopted as this dimension's own
concern about tests-as-callers), and REQ-210 (documentation-only, encoding question kept open and
now explicitly scoped apart from anything adversarial opposes). REQ-207's worst-case-wait exposure
(`timeoutMs × (1+retries)`, computed not raw) and REQ-205's redaction-vs-verbatim-error tension
(resolved: marker, not silence) both stand from r1, the latter now sharpened by adversarial's
concrete redaction gap.

## 4. Self-sustainability

No disagreement to record — adversarial's altitude table independently reaches the same conclusion I
did (this dimension is mostly N/A at agent altitude for v35, no autonomous LLM control loop in scope)
and frames REQ-209's doc-example guard the same way I did in r1: a closed-loop test against real
`workflow_register` replacing a prose claim that already rotted once. Converged position, stated once
so round 3 doesn't need to reconstruct it from r1: **REQ-209's `guide-examples-register.test.ts`
extension is endorsed as written (real registration call, not a re-implementation of the static
checks) — no change requested; `journal.jsonl` compaction/rotation for long-running resident/cron
workflows (D11) stays filed as backlog, out of v35 scope, on both r1 documents' agreement.**

---

## Final position

Every REQ-205..210 finding across both r1 documents now points at the same six fixes, with one
correction carried forward (REQ-207 must not be persisted, full stop — the performance section's
"write-time is strictly better" sentence should not survive into the detailed design) and one
strengthening carried forward (REQ-205's reason field is redacted-with-marker through a single shared
helper before it reaches any of its three surfaces, or the redaction fix itself becomes a second
composeConfig-class wiring gap). REQ-208 converges on masking via `matchDelimiter`, gated on the
three adversarial test cases actually passing (the template-literal case is the load-bearing one).
REQ-209 converges on a hard required parameter with no opt-out, gated on at least one v1 test
asserting a v2 rule fires, not just compiles. REQ-206 and REQ-210 have no residual disagreement.

## Remaining disagreements for round 3 (if any lens wants to reopen them)

1. Whether REQ-207's health signal belongs in the design doc as "computed at read time from
   `run_snapshots`" only, or whether the performance lens still wants to argue for a persisted
   write-time field despite §2's own finding that nothing needs writing — I've rebutted this as an
   internal inconsistency in adversarial's own r1, not a live position, but I haven't heard adversarial
   confirm which of §2 or §3(b) they'd keep.
2. REQ-205's boot-recovery/`interrupted` scoping question (raised in my r1, not addressed in
   adversarial's r1) — still open, still not a v35 blocker in my view.
3. REQ-210's `structuredContent` migration question is explicitly not a disagreement but remains
   unanswered pending someone reading `server.ts`'s response-building code.
