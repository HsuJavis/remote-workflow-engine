# Quality-dimensions lens — v36 Design stage (Gate 3, Tasks+Design merged), round 2

Read in full: `adversarial.r1.md` (20 findings — A1–A7, B1–B7, C1–C6 — across three lenses:
interface-contract, boundary & error, testability — plus 5 internal-conflict rulings, 5
task-splitting notes, and an explicit "expected disagreements with quality-dimensions" section
addressed to me). Before writing this round I spot-checked the four
claims of theirs that would flip a position I took in r1, against the working tree, not just against
their citation:

- `grep -n principal src/run-manager.ts` — confirms **A2**: no `entry.principal` / `RunEntry.principal`
  field exists anywhere in `run-manager.ts`; the only `principal` reads are `spec.principal` inside
  `casNamespaceFor(spec.principal)` calls (admission-time, not the run entry). ARCH-160's
  `entry.principal ?? null` line has nothing to read.
- `sed -n 1,75p tests/unit/compose-config-v2-wiring.test.ts` — confirms **C1**: the sweep is a
  literal `FileConfig → composeConfig() → ServerConfig` forwarding assertion (schedulerDbPath,
  assetRoot, litellmPort, useLiteLLMProxy). `eventSink` is not, and structurally cannot be, a
  `FileConfig` key — it's composition-root-constructed, not file-configured.
- `grep -n "attempts\|retries\|timeoutMs" src/main.ts` — confirms **C1**'s second half: the real keys
  are `timeoutMs`/`retries`; there is no `attempts` config key for the sweep to probe.
- `sed -n 675,700p src/run-manager.ts` — confirms **B6**: `code` is computed independently
  (`(err as {code?}).code ?? 'SEEDREF_FETCH_FAILED'`) from the message, and `seedRefFail.message` is
  currently the **raw, unredacted** message — so ARCH-169/170's proposed `captureFailure(err, secrets)`
  call, if it supplies the whole envelope instead of just the message, silently changes `code`'s
  domain from a 3-value enum to `err.name`.

All four hold. What follows integrates on that basis rather than deferring to citation count.

---

## Observability

**A2 confirmed and merged into my own REQ-213×212 finding — theirs is the sharper diagnosis.** I
flagged in r1 that `run.terminal`'s `principal: entry.principal ?? null` reproduces REQ-212's own
defect one line below where `catalog.publish`/`catalog.register` disambiguate identity source. A2
shows it's worse than stale semantics: there is **no field to read**, on either the fresh-run or the
resumed-run path. **Concede and integrate**: their fix (add `principal?: string` to `RunEntry`,
populated in `_newEntry` from `spec.principal` **and** rehydrated on resume from the persisted
`started_by` column) is the correct DES row, and it closes exactly the gap my discriminated-union
proposal was built to catch at the type level, not just the specific line. I keep my ask on top of
theirs, not instead of it: once `RunEntry.principal` exists, the `run.terminal` event literal should
still go through the same `EngineEvent` union member (`kind: 'run.terminal', actor: {id, bypass,
idSource}`) as `catalog.publish`/`catalog.register`, not a bespoke `principal: string | null` shape —
otherwise A2's fix compiles cleanly while `run.terminal` is still the one event kind whose actor
shape doesn't match the other three, which was my original finding independent of whether the field
exists. **Named Gate 5 case, combining both:** a resumed run's terminal line carries the same
`actor.id`/`actor.idSource` as its start-adjacent `catalog.register` line for the same principal.

**A1 (Actor per-call-site mint) is new evidence for my "one task" argument, and I fold it in rather
than treat it as a separate finding.** I didn't cover Actor minting in r1 at all — this is squarely
their interface-contract lens's catch, not a rebuttal of anything I said. But notice what just
happened: two lenses, working independently and blind to each other, each found a **different**
defect in the same seam — A1 found a privilege-escalation bug in how `Actor` is minted (ARCH-157/158),
I found a shape-inconsistency bug in how the minted `Actor` is logged (`catalog.deregister` has no
actor fields at all; `run.terminal` doesn't even have the field, per A2). That's not two independent
small bugs; it's one seam (principal → Actor → audit event) that nobody looking at only one row of
ARCH-157..161 caught in full. **This raises the stakes on my original task-splitting ask**: `canMutate`
+ `actorFor()` (ARCH-157/158, A1's fix) and the `EventSink` emitters that consume the minted `Actor`
(ARCH-159..161, my `EngineEvent` union) belong in **one task**, gated by **one** RED-first test that
exercises the full path — mint → gate → emit — not two tasks that each pass their own unit tests
while disagreeing on what an `Actor` looks like by the time it reaches the log line. C5's 16-row
`canMutate` table test is necessary but not sufficient for that; it proves the gate, not the emission.
I'd add one integration case to C5's table test's sibling suite: mint an `Actor` for each of the four
`Principal` kinds, run it through `canMutate`, and assert the **same** `Actor` object's `{id, bypass,
idSource}` is what a stub `EventSink` receives — closing the mint-to-emit seam in one assertion.

**C1's wiring-probe correction: concede the mechanism, hold the task boundary.** I argued in r1 that
`EventSink` + its call sites + its wiring guard must land as one task (same shape as the
`composeconfig-wiring-bug-class` memory). C1 shows the specific guard ARCH-159 names
(`compose-config-v2-wiring.test.ts`) is the wrong instrument — confirmed above, `eventSink` isn't a
`FileConfig` key and the sweep can't fail for the reason it's meant to catch. That's a correction to
*which test*, not to *whether it's one task*; I hold the task-boundary argument and adopt C1's fix
(a composition-root integration case in `tests/integration/main-composition-root.test.ts`) as the
right guard for it. **One addition C1's own proposed assertion doesn't yet cover**: C1 asserts
`catalog.publish` and `run.terminal` arrive with the expected kinds; add `catalog.deregister` as a
third assertion in the same IT. That's REQ-211's one destructive action, and it's the event kind my
r1 flagged as missing actor fields entirely — the wiring guard should prove it arrives *and* prove its
shape, in the same case, or the guard passes while the audit trail's one delete-path event is still
silently malformed.

**Task-split reconciliation — 13a/13b vs. "one task."** Adversarial's own task-splitting section
splits REQ-213 into `13a` (the `event-log.ts` module: type + factory + `now`/`write`/`secrets`
injection, dependency-free, ships before REQ-211) and `13b` (the emitters: `_transition`, catalog,
`lastRunAt`, `workflow_list`). On inspection this doesn't conflict with my "one task" claim — it
refines it correctly. My r1 was arguing against splitting *emission* from *its own wiring guard*;
13a/13b splits *the type* from *its call sites*, which is safe by the same logic C4 and I both use
for REQ-211's error-message fix: `event-log.ts` alone has no cross-file runtime coupling and no
compiler-invisible property until something calls it. **I adopt 13a/13b, with one sequencing note**:
13a should ship with the `EngineEvent` discriminated union as its exported type (not a later addition
to 13b), since 13b's call sites are exactly where the shape-consistency bugs (A2, my
`catalog.deregister` finding) get introduced if the type doesn't already force `actor` to be present.
The wiring guard (C1's composition-root IT) belongs in 13b, where the call sites and the constructors
that receive `eventSink` actually exist — not deferred to a later task, and not attached to 13a where
there's nothing yet to wire. **One sequencing gap in adversarial's own ordering (13a → REQ-211 →
13b):** if `deregisterVersion` calls `this._eventSink` but the constructor doesn't take an injected
sink until 13b, REQ-211's task ships in a window where the slice's one destructive action logs
nothing. Either fold the constructor parameter into 13a (still zero emitters, just the plumbing), or
make explicit that 13b's `catalog.deregister` IT assertion is what proves that window closed rather
than leaving it implicit.

**B2 (drift guard for `ENGINE_REFUSAL_CODES`) — support, not mine to claim.** This was the
architecture-stage quality-dimensions round's ask, dissolved by ADR-072's `refusalRef` design and
now shown by B2 to still apply because the duplication moved (`host.ts` → `run-manager.ts`) rather
than disappearing. I agree with B2's framing exactly as stated — forced duplication across an
import boundary that cannot be crossed is the one case where a drift guard earns its keep — and note
it's a straightforward addition to REQ-215's single task (same seam, same RED-first commit), not a
new task.

**REQ-215 IPC seam (B1, C3) — hold my "one task," concede the internal test shape.** My r1 asked for
one task, RED-first, with a real-sandbox integration test before any of the four files change. B1
scopes nested-`workflow()` frames out by name (Karpathy: the re-mint boundary at
`run-manager.ts:1375` deliberately loses identity, no requirement asks for nested coverage) and C3
shows most of the policy logic is unit-testable via the injected `SandboxApi` without a child
process, reserving the real-child IT for the transport seam alone. Both are corrections to test
*shape*, not to my *task-boundary* claim — I still want the four files landing together, RED-first,
with C3's four unit cases plus the one real-child IT as the acceptance set for that single task,
and B1's negative case (nested refusal fails with a code and no marker) pinned in the same task so
the scope-out is asserted rather than silently true. **Hold**, refined by C3/B1.

---

## Replaceability

**`EngineEvent` discriminated union — hold, strengthened, priced honestly.** This wasn't in
adversarial's r1 (written blind, per their own closing line), so there's nothing to rebut or concede
on the union itself. What arrived since r1 is three independent confirmations that the untyped sink
parameter is already producing shape drift before any code exists: A2 (`run.terminal`'s `principal`
field doesn't exist on `RunEntry` at all), A3 (`version` emitted as a bare number on `run.terminal`
where `catalog.publish`/`register` emit a string), and my own r1 finding (`catalog.deregister` has no
actor fields). Three event kinds, three independent shape defects, none caught by the
`Record<string, unknown>` signature ARCH-159 specifies. I price the union honestly at what it costs —
one `kind`-keyed union type (~10 lines), no new module, no framework — against what it buys: A2's fix
and my `catalog.deregister` fix both become type errors instead of passing tests if a future (v37+)
event kind omits `actor` or types `version` wrong. I'd expect a Karpathy tie-break to read this as
scope growth beyond REQ-213's "JSON 一行" sizing; my answer is the same as r1's — a test catches
today's three kinds, a type prevents kind four from repeating a bug that has now independently
recurred three times inside one architecture+design round, before implementation starts.

**`attemptsFor` cross-conformer contract test — hold, corrected by C1's key list.** C1 corrects the
config-key confusion I hadn't checked (there's no `attempts` key; `retries`/`timeoutMs` are the real
ones, confirmed above) and proposes a pure unit test directly on `attemptsFor()` plus confirming both
`GatewayClient` conformers reach the gateway config through the shared helper. That's the same test I
asked for in r1, named more precisely — I hold the ask, adopt C1's precision: one parametrized test
against `attemptsFor()` itself (not through the composeConfig sweep, which C1 shows can't see the
derived value either), plus an import-site check that both `client.ts` and
`claude-agent-sdk-client.ts` call the shared export rather than free-handing a local formula. No
disagreement here, just a sharper instrument for the same claim.

**A5 (`Actor.kind` dead field) — no dispute, not my dimension's fight but no objection.** Dropping an
unread field is Karpathy/interface-contract territory; it doesn't change any replaceability seam I
named. Noted only so it isn't read as contested.

**A1's flat-struct-vs-union ruling for `Actor` itself (adversarial's internal conflict #1) — not my
position to concede or defend, because I never proposed a union for `Actor`.** My `EngineEvent` union
is a different type at a different seam (the *emitted event*, not the *minted actor*); I want that
distinction on the record so it doesn't get read as "quality-dimensions lost the union argument" when
no such argument was made about `Actor`. I hold no position on `Actor`'s internal representation.

---

## Consumability

**ARCH-171/173 guide byte-lock, REQ-211 as the safe contrast case, `workflow_list` sentinel test —
none of these were addressed by adversarial's r1; I hold them from round 1 unchanged.** No new
evidence arrived against any of the three. Restating briefly rather than re-arguing: ARCH-171+173+
`docs/AUTHORING.md` ship as one task/commit (byte-locked pair, a half-landed pair is worse than
not-started on the shared tree this repo's CLAUDE.md is about); REQ-211's error-hint rewrite is the
calibration example for "splits safely"; `workflow_list.lastRunAt` gets its own never-run-reports-null
test case, not folded into a general shape assertion.

**A6/A7 (`deregisterVersion`'s six outcomes, trigger-release question) — integrate, and tighten my
"safe contrast case" claim.** A6's six-outcome table and refusal-ordering rule (ownership →
not-found → channel → last-remaining → pinned-run, ownership first so a stranger can't enumerate
versions by refusal type) is exactly the kind of contract-completeness work my dimension should have
flagged and didn't — REQ-211's error-hint text ("錯誤提示不得叫人做工具做不到的事") is the same
principle A6 applies to `VERSION_NOT_FOUND`. **Concede the gap, adopt A6 as the completion of my own
finding.** A7 is more consequential for my "REQ-211 is the safe, independently-shippable task"
claim from r1: A7 shows `deregisterVersion`'s relationship to `claimedTriggers` is genuinely
undetermined from the code ("not live" and "not claimed" are different states and only the second
leaks — an orphaned scheduler claim is named as the same defect class as the v24 cron incident).
**Revise my r1 position**: REQ-211 is only the calibration example for "splits safely" once A7's
question is answered *in the DES row*, with the line numbers A7 asks for, before the task is cut —
not after. An unanswered trigger-release question turns REQ-211 from an isolable, low-risk task into
one with the same "silent gap only a real scenario surfaces" shape as REQ-215, just smaller. I'd
still call it the easier of the two to close (one sentence or one release call, per A7's own framing),
but the task can't be marked safe-to-split until that sentence exists.

**B3 (attestation boundary: code forgeable, ref is not) — support under this dimension.** This is a
cold-client consumability point as much as a security one: `workflow_authoring_guide` and any tool
contract a script author reads need the one-sentence distinction B3 asks for (`error.code` is
script-influenceable, `error.detail`'s marker is not), or the first reader of the new field reasonably
assumes both are attested — exactly the kind of cold-client misread my r1's altitude section flagged
for `workflow_list`/`workflow_deregister`/`workflow_authoring_guide`. Cheap, one sentence in the guide
and the tool contract, one negative Gate 5 case. No disagreement, adding it under my own dimension
because B3 filed it under boundary & error and it belongs equally here.

**B5 (`failDetail` bytes vs. UTF-16 units) — concede, this was a miss in my r1.** I reviewed
consumability for `workflow_list`'s field shapes and the error-hint text but didn't check the units
of a truncation bound against the actual message content this engine emits. B5 is right that this
project's own requirements and error text are substantially Chinese (「腳本可控物件寫進磁碟」,
「稽核軌跡與實際擁有權不一致」, etc.), so a byte-bound silently narrowing to ~66 characters for CJK
operator-facing diagnostic text is a real consumability defect, not a rounding concern. Adopt B5's
fix as stated (state the contract as "200 bytes, may extend to ≤995 to keep a redaction marker
intact," assert both numbers in the K3 case) and its refusal of a second character-counted bound
path on the Karpathy tie-break — I have no consumability argument for carrying two truncation units
for one diagnostic field.

---

## Self-sustainability

**`deploy.sh` test harness — hold the vitest-shells-out choice; adopt C4 as its prerequisite and B4's
two assertions as its acceptance set.** My r1 named the harness gap (which runner exercises
`--dry-run`) without checking whether `--dry-run` was reachable cheaply at all. C4 shows it isn't, as
ARCH-164 places it: steps 1–3 can trigger `npm install` and a Python/`uv` toolchain build before
`--dry-run` is ever read, making the cheapest invocation of the seam a second Gate 7.5. C4's fix
(move the `RWE_CONFIG_PATH` export and derivation block above step 1, `--dry-run` handled immediately
after) doesn't conflict with my harness choice — it's what makes the vitest-shells-out harness I
proposed actually cheap to run, rather than a proposal that would itself trigger an npm install every
`npm test`. Adversarial raised no objection to a vitest harness specifically (C4's own framing:
"a seam whose cheapest invocation installs a Python toolchain is not a regression test" is an argument
against the *current placement*, not against testing it from vitest) — I hold it. Fold B4's two
concrete defects into the same task's acceptance set rather than treating them as separate follow-up:
the log-truncation fix (`(umask 077; touch "$RWE_LOG_FILE")` in a subshell, `chmod 600`, append with
`>>` never `:>`) is directly load-bearing for what REQ-214's `--dry-run` test should assert — not just
"two distinct pid/log paths" as I wrote in r1, but **0600 permissions on the created log, and a
pre-existing line surviving a second start** (B4's exact framing). Without that second assertion, a
harness that only checks path-distinctness would pass on a design that erases the only audit trail
this iteration ships (ADR-076 defers durable `appendAudit`), which is the specific risk B4 names.
**One task, both the placement fix and the truncation fix, one `--dry-run` test asserting all three
properties** (paths differ, 0600, restart-survival).

**ARCH-172 `owner_decision` — full convergence, no action needed.** Adversarial's risk table states
it plainly under "Not a risk, deliberately": both branches cost the same (comparable) task work, so
`03-tasks.md` proceeds without the answer as long as no task assumes either branch. That's the same
conclusion my r1 reached independently (REQ-216/K5 discharged by ADR-079; the marker is a separate,
non-blocking, owner-facing question the design stage inherits rather than re-decides). Recording
the convergence; no further action for either round.

**Agent altitude (ARCH-168's refusal ledger) — unchanged from r1, no new evidence against it.** Still
the round's one agent-altitude self-sustainability item: bounded per-run state with a visible overflow
signal (`refusalsDropped`) rather than a silent cap. B1's scope-out (record only at
`framePath === ''`) strengthens this rather than weakening it — it keeps the 8-entry ledger's
semantics honest (top-level refusals only) instead of letting nested-frame entries consume slots for
a marker that, per B1, can never validate for those frames anyway. Adopt B1's framing as the reason
the ledger stays correct, in addition to the reason it stays bounded.

---

## Resolving the K1/K2 ordering contradiction (mine, not fully closed by either round's r1)

I flagged in r1 that ARCH-170 states an impossible order (K2 "lands first," but its own `api:` line
calls `captureFailure`, which is K1's introduction). Adversarial's B6 refines K2's implementation
(supply `captureFailure`'s **message only**, keep `code` computed independently, so the code domain
doesn't regress to `err.name`) but B6's own fixed form — `{code, message: captureFailure(err,
secrets, 200).message}` — still calls `captureFailure`. **The contradiction stands after both rounds'
r1s; I resolve it here rather than leave it for the synthesizer to hit a third time.** Proposed
sequence, one task, three commits in this order:

1. `captureFailure` lands first as the pure function (ARCH-169's collapse), with its byte-exact test
   written against it directly (B5 wants this test to exist regardless of sequencing, so it's not
   extra work, just reordered).
2. K2's call site adopts B6's message-only form as its very next commit — reviewable alone, since
   `captureFailure` already exists to import.
3. K1's second call site (the one ARCH-169 was written to collapse) lands third, now with two call
   sites agreeing by construction rather than by convention.

This keeps ARCH-170's *intent* ("K2 is reviewable without a refactor wrapped around it" — true of
step 2, read as "reviewable as its own commit," not "shippable before the function it calls exists")
while resolving the literal contradiction in its `api:` line. One task, three ordered commits, not
three tasks — the same "don't let the synthesizer discover the file-boundary split independently"
argument I made for REQ-215 and the `attemptsFor` pair applies here too.

---

## Answering adversarial's "expected disagreements with quality-dimensions" directly

1. **B2/ADR-072**: agreed above under Observability, not disputed.
2. **Correlation ids, levels, a `run.start` line, agent-level events**: not a position I took in r1 —
   my r1 asked for shape-consistency (typed union) and one missing field (`principal`), not stream
   enrichment. No dispute. On `run.start` specifically: I decline to push for it in v36, same as
   adversarial — nothing in REQ-213's text asks for a paired start line, and A2's rehydration fix
   already makes a resumed run's terminal line auditable without it. If the synthesizer wants the
   pair anyway, it's cheap and I wouldn't object, but it's not a gap I'm asking to close.
3. **Pulling `appendAudit`/durable audit into v36 against ADR-076**: not a position I took. I hold
   the ADR, same as adversarial, and adopt their conditional (B4's restart-survival fix is the price
   of that deferral being acceptable) as my own condition too.
4. **A LIMIT on `listRuns()`**: not a position I took; ADR-079's no-LIMIT ruling stands, unchallenged
   by either r1.
5. **A6/A3 adding refusals the requirement didn't name**: addressed above under Consumability — I
   adopt A6, and I'd extend the same reasoning to A3's schema-pattern refusal (raising
   `VERSION_NOT_FOUND` over a silently-wrong compare is the same "don't let the tool claim success it
   didn't achieve" principle REQ-211 states for itself).

---

## Final position

Converged with adversarial on: A2 (integrated into my typed-union ask), C1's wiring-probe mechanism
(task boundary held, test instrument corrected), the 13a/13b split (adopted, with the union shipping
in 13a), B2/B3/B4/B5/A6 (supported or conceded under my dimensions), ARCH-172 (independent agreement),
REQ-215's one-task boundary (held, internal test shape refined by B1/C3), and all five items in
adversarial's "expected disagreements" list (none were disagreements — stated plainly above).

Revised from my own r1: REQ-211 is no longer an unconditionally safe standalone task — A7's
trigger-release question must be answered in the DES row first (small revision, same conclusion
once answered).

Not conceded, held with strengthened evidence: the `EngineEvent` discriminated union (three
independent shape defects found across both r1s, in three different event kinds, before any code
exists — the case is stronger now than when I first made it, not repeated unchanged).

Resolved, not left open: the K1/K2 commit-order contradiction that neither r1 fully closed —
`captureFailure` first, K2's message-only call second, K1's second call site third, one task.

**Remaining disagreements:** none argued between the two r1s — every point of friction turned out to
be a correction I should adopt (C1's mechanism, C4's placement), evidence strengthening a position
already held (the union, REQ-215's task boundary), or a gap in my own r1 (B5, A6/A7). Two items are
unclaimed rather than settled, and I flag them as such rather than as closed:

- **The `EngineEvent` union vs. a Karpathy sizing objection.** Adversarial's r1 predicted (in its own
  "expected disagreements" section, mirrored under REQ-213 in my r1 too) that a tie-break lens would
  read this as scope growth beyond REQ-213's "JSON one line" ask. Adversarial's r1 was written blind
  and never actually made that argument against my specific union — I'm holding it on the
  three-defect evidence above, but I expect it to be contested in their r2, not mine to declare
  settled.
- **`deploy.sh --dry-run`'s runner** (vitest-shells-out, my r1, held above with C4's placement fix
  folded in) **vs. two bare `sh` invocations** (C4's own literal phrasing: "two `sh` invocations, no
  engine, no npm"). Adversarial didn't argue for the shell-only form over mine, but they didn't argue
  against it either — I hold vitest for the reason given above (keeps REQ-214 inside the `npm test`
  surface everything else reports against), flagging it as unclaimed, not conceded to me by silence.
