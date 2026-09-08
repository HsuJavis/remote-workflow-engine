---
stage: architecture
lens: quality-dimensions
iteration: v26
round: 2 (debate — responses, final position, remaining disagreements)
reads: adversarial.r1.md (the only other proposal on disk at write time), quality-dimensions.r1.md
---
# Quality-dimensions round 2 — Observability / Replaceability / Consumability / Self-sustainability

**What I read.** `adversarial.r1.md` (Security × Scalability/Consistency × Testability) in full — its
ARCH-110..121, ADR-037..045, risks ADV-R1..R13, its ten cross-lens conflicts C1..C10, its
"Expected disagreements with other lenses" list (which addresses my r1 by number), and gaps G1..G14.
It is the only other proposal on disk at this write; if a third lens lands later, the positions below
are stated so they can be merged by ID rather than re-argued.

**Headline of this round.** We converged on more than we disagree about, including every HIGH risk I
raised. The adversarial proposal reached my key_points 3, 4, 5, 6, 8, 9, 10, 11 independently and in
several cases with better mechanisms than mine (ADR-042's `--check-config` is a strictly better answer
than my "numbered DEPLOY.md step"; ARCH-111's controller-always-aborted closes a liveness hole my S-6
only named). The ledger below concedes far more than it holds, and what it holds is narrow: three open
items survive to §Remaining disagreements. Nothing I hold requires a new module; the total cost of everything below is one
extra field on a record, one field on a pinned book, two lines in the sandbox budget accessor, and
four test/guide obligations.

## Disagreement ledger (rebut / concede / hold)

| # | Item | Their position | Mine (r1) | Verdict |
|---|---|---|---|---|
| D1 | Unmapped SDK messages (their C10 / ARCH-111 vs my O-4, key_point 2) | subtype NAME + count, never the payload | typed event with bounded, redacted payload | **CONCEDE** the payload. **HOLD** subtype+count, plus a cap/charset on the subtype and a named *reader* |
| D2 | "Name the bug class once" (my key_point 1) | review discipline in 04-design; no shared abstraction | design the counter-measure once | **CONCEDE** the mechanism. **HOLD** one ADR row so v27 does not re-derive it |
| D3 | `meta.warnings[]` umbrella (my key_point 12) | named typed fields (`unpricedCalls`, `unmappedMessages`) | one array with a closed code catalog | **CONCEDE** the vehicle. **HOLD** the property: every counter has one named reader, asserted |
| D4 | `phaseAt(phases, ts)` for both paths (my O-2) | live path needs no join; ordinal falls out of `ExpectedGraph` | one pure function, `{title, index}` | **CONCEDE** the second function. **HOLD** the ordinal on the record + an explicit join rule (evidence below) |
| D5 | Trigger-started runs carry no budget (my QD-R14 / their ADV-R13, G12) | a requirement gap → orchestrator, not a v26 ARCH entry | Gate 2 owes one of two answers | **CONCEDE** placement. **HOLD** that the ledger amendment is unconditional either way |
| D6 | Corrected Mermaid in the REQ-128 refusal envelope | structure as JSON; Mermaid text is direction 乙 by the back door | (not raised) | **ALLY** — I am the consumability lens they expected to argue this and I agree with them |
| D7 | `tools: default` keyword "leaks engine internals" | honest word; freezing `defaultAllowedTools` invalidates every diagram on a config change | (not raised) | **CONCEDE** the keyword. **HOLD** two mechanical properties |
| D8 | One `PROVIDERS` descriptor row (my R-2 / key_point 6) | `providers.ts` (identity + caps + alias validation), pricing in `ModelBook`, effort in `client.ts` | one row serving all four requirements | **CONCEDE** the split (lifetimes differ). Placement of `EFFORT_PROFILES` = non-blocking suggestion |
| D9 | `budget` shape, ADR-037 (my key_point 8 / S-1) | object `{usd?, tokens?}`, legacy number → tokens | same | **CONVERGED** + one amendment (`remaining()`) |
| D10 | ADR-038, unpriced model under a USD budget (my S-3) | refuse at admission when `budget.usd` is set | lean warn-and-continue | **CONCEDE**, with a named dependency raised from deferred |
| D11 | ADR-040, classify by the SDK error-kind union (my O-5) | union + status fallback | status set per REQ | **SUPPORT** — it subsumes my O-5 and shortens S-6 |
| D12 | ADR-039, regex skeleton + refuse the undecidable | no runtime `typescript` | (no r1 position) | **ACCEPT** with the C-3 documentation lock applied to G5's five edges |
| D13 | ADR-042, `--check-config` before restart (my R-4 / QD-R6) | shell-level pre-check in `revert_and_fail` | numbered DEPLOY.md step | **CONCEDE to theirs**; my step survives only because ADR-042 depends on their own G6 |

---

## 1. Observability

**Converged, no further debate:** the phase snapshotted at IPC receipt in `host.ts` and never onto the
replay key (my O-2 / QD-R2 ≡ ARCH-114 — their `fork()` probe, 5/5, is stronger evidence than my
nextTick-ordering argument and I adopt it as the citation); `retryable` honoured by **both** retry
loops (my O-5 ≡ ARCH-111); `{transport, provider, model, proxyModel?}` as distinct fields with
`markDone` writing only what `markHarness` does not own (my O-6 ≡ ARCH-115); `effortApplied` recording
the wire position and value, not `applied:true` (my O-7 / QD-R11 ≡ ARCH-117); prices pinned onto the
usage event at capture so a run's spend is re-derivable from its own journal (my O-8 ≡ ARCH-116/118).

### D1 — I concede the payload and hold the seam (final)
`redact()` is value-exact over secrets the engine was *told about*; it cannot protect against a
provider body echoing something it was not. That argument is correct and it beats my "bounded and
redacted" answer. **Final position: subtype NAME + `meta.unmappedMessages` count, no payload** — which
is exactly the fallback my r1 pre-conceded. Two conditions I do hold, both inside their ~6 lines:

- **The subtype is SDK-authored text, not engine-authored.** Cap it (≤64 bytes) and restrict it to
  `[a-z0-9_.-]`, replacing anything else with a single `?`. Otherwise the one string we deliberately
  keep from an untrusted stream is unbounded — the same reasoning as their own 1024-byte cap on
  `AgentRecord.detail` (ADR-040 / G13), applied to the smaller field for consistency.
- **A counter with no reader is not observability.** ARCH-111 names the field; it does not name the
  second reader. `unmappedMessages` and `unpricedCalls` must both appear on the dashboard run page
  beside the harness table (ARCH-115's new table is the natural home), not only in `run_result`.

### D3 — concede `warnings[]`, hold "one named reader", now as a test
Their objection is right on its own terms: a cold model reads a named integer without scanning an
array, and `tsc` checks a named field. I withdraw the umbrella array. What I keep is the property the
array was a vehicle for, restated as an acceptance clause rather than a schema: **every run-level
counter v26 mints is (i) a named field on `run_result.meta`, (ii) rendered on the dashboard run page,
and (iii) covered by one assertion that a run which triggers it shows a non-zero value in both.**
Three counters exist after v26 (`unpricedCalls`, `unmappedMessages`, and whatever ADR-037's legacy-unit
detection reports); (iii) is one integration test, not three.

### D4 — the ordinal: their ARCH-113 already assumes it; make it explicit (HOLD, with evidence)
I concede that the live path needs no timestamp join — it reads the current title synchronously at
receipt, and only pre-v26 terminal snapshots need `inferPhase`. A separate `phaseAt(phases, ts)` for
both is one function too many and I drop it.

What does not fall out for free is the *join key*. Verified on HEAD:

- `dashboard.ts:262-289` builds `phaseOrder` and `phaseColMap` from **phase-title string equality**,
  and appends any live-agent phase not already present as a new column.
- `workflow-meta.ts:380` applies `STRING_ARG_RE = /^\s*(['"])(.*?)\1/` to `script.slice(openParen+1)`,
  i.e. it takes a **leading quoted literal only**. So `phase('fork:' + tier)` yields the **truncated**
  title `fork:` (the non-greedy capture stops at the closing quote of the first fragment), and
  `phase(tier)` yields **no title at all**.

So for a dynamic phase title the join fails in *both* directions: the skeleton lane holds `fork:` or
`undefined` while the live record holds `'fork:pro'`. REQ-124's "align by order, not string equality" therefore needs
the record to carry the runtime phase **index** taken at the same receipt-time snapshot as the title —
`{title, index}`, one extra integer, no second function, no second read. ARCH-113's "place by lane
ORDER through `ExpectedGraph`" is the right layout rule; it has nothing to order *against* unless the
index is on the record.

And the raw ordinal is necessary but not sufficient, which is why the rule should be written down
rather than discovered: a `phase()` inside a loop or a branch makes runtime index ≠ skeleton lane
index. Proposed rule, one sentence in ARCH-113/114: **runtime phase `k` places into skeleton lane `k`
when `k < lanes.length` and that lane's node is not `dynamic`; an `agent()` dispatched before any
`phase()` has fired takes the implicit lane 0 the layout already builds; anything else goes to the
frame-grouped fallback cell with a `warnings[]` entry** — the shape `layoutGraph` already has
(`dashboard.ts:241-242`) and `SkeletonNode.dynamic` (`workflow-meta.ts:99`) already supplies the
predicate. This is the same honesty their ADV-R8/G14 applies to nested frames and to the third resume
cohort.

### New (mine, this round) — the price book's own health must be in the pin
ARCH-116 pins prices onto the run row (`runs.price_book`). Under ADR-038 that pin is now a **safety
input**: it decides whether a budgeted run is admitted at all. A pin that cannot say how it was
obtained is unauditable — a post-mortem of "why did this run admit / refuse" has nothing to read.
**Add book-level provenance to `price_book`: `{fetchedAt, source: 'live' | 'last-good' | 'static'}`.**
This is the same provenance shape as my C-7 `source` field on the declared capability flags, for the
same reason, and it is what makes "admitted on six-hour-stale OpenRouter prices" a visible fact
instead of an inference. Three fields, written once per run, no new read path (their ADV-R11 Gate-7.5
cross-check reads it for free).

### Remaining disagreement — none in this dimension
D1's payload is conceded; D4 is an amendment to their entry, not a competing design.

---

## 2. Replaceability

**Converged:** one home for per-provider knowledge (my R-1/R-2 ≡ ARCH-112); the deletion of
`NON_ANTHROPIC_EXCLUDED_TOOLS` / `curateToolsForProvider` recorded as an ADR with the original decision,
the re-test and the reversal (my R-3 ≡ ADR-041 — and their ADR-041 already carries my QD-R7
capability-loss point); one effort table with the two dead ones deleted and grep-guarded (their ADR-045
— I had only counted the sites, they found that two of the three are dead code, which is a better
answer than mine); effort resolution as provider profile × **model** capability (my R-6 ≡ ARCH-117 +
ARCH-116); transport-specific detection staying behind each client with only the classification shared
(my R-7 ≡ ARCH-111's "the direct-fetch gateway gains the same `retryable:false` so both clients honour
one contract").

### D8 — I concede the single-row descriptor
My r1 wanted `{id, keyEnv, litellmPrefix, effort, thinkingPolicy, pricing, catalogSource, toolSurface}`
as one row. Their split is better and I withdraw mine, for a reason my own r1 gave without following
it: the facts have **different lifetimes**. `providers.ts` holds static per-provider identity (union,
caps, alias validation) checked by `tsc`; `ModelBook` holds per-model, TTL'd, remotely-sourced facts
(four price rates, declared capability). Anthropic's own four-column prices are per-*model*, not
per-provider, so they could never have lived in my row. Forcing both lifetimes into one table would
have produced a structure that is partly compile-time-true and partly six hours stale, with no field
saying which — the defect my own new observability item above exists to prevent.

The count I actually argued for is still achieved: **six sites → two homes**, plus the deletion of two.

**Non-blocking suggestion, explicitly not a hold:** `EFFORT_PROFILES` is a static per-provider fact
living in `gateway/client.ts`, a transport module. If `providers.ts` is being created anyway, that
table is a natural resident and `client.ts` imports it — but where a table that both gateways already
import physically lives is a bikeshed, and ADR-045's substance (one table, two deletions, a grep guard)
is what mattered. If the design gate leaves it in `client.ts`, I do not object.

### Remaining disagreement — none
R-5 (the swap surface concentrates onto OpenRouter model ids rather than disappearing) and R-4 (config
edit and release are one ordered operation) are both absorbed: R-4 by ADR-042, which is strictly better
than my proposal because a shell pre-check cannot be forgotten by an operator under time pressure. My
DEPLOY.md step survives only in the reduced form their own G6 requires: **`RWE_CONFIG_PATH` must be
added to `update.env` or ADR-042 silently skips** — a fail-closed design defeated by a missing env var
is worth one numbered line and one Gate 7.5 observation that the check actually ran (their "skipped and
recorded — never a false pass" is the right instrumentation; the acceptance should read the record).

---

## 3. Consumability

**Converged:** the three seed shapes discriminated in the schema with the refusal naming the
alternative (my C-1 ≡ ARCH-110, and their C9 tie-break — post-schema validator with a specific code,
description saying REQUIRED — is the same answer I gave); every emitted code in `ERROR_CATALOG` with a
non-null `see` for authoring-side failures (my C-2/key_point 10 ≡ their slice-shape `ERROR_CATALOG`
rows and ARCH-121's drift locks); the guide's rules interpolated from the checker's own constants (my
C-3/C-4 ≡ ARCH-121); `viewBox`-based scaling with zoom/pan over **both** figures at the view layer (my
C-6 ≡ ARCH-120), client-constructed DOM retained (my QD-R13 ≡ ADR-044).

### D6 — ally, not opponent: no corrected Mermaid in the refusal envelope
They pre-empted "a UX lens may want the corrected Mermaid" and I am the lens that would have. **I
agree with them and want it on the record as a two-lens position, not a lone security preference.**
Handing back a passing diagram would make every author paste it, and REQ-111 (the diagram is the
author's *statement of intent*, checked against the code) dies by convenience — the checker would be
generating the thing it checks. The expected **structure as JSON** (lanes, slots, edges, tools) is the
right envelope: it is strictly more useful to a cold model, which has to write the Mermaid anyway and
now knows exactly what shape to write.

### D7 — `tools: default` is conceded; two mechanical properties held
Their reasoning is correct: freezing the resolved `defaultAllowedTools` into a registered diagram makes
a config change retroactively invalidate every stored diagram, which is a worse consumability outcome
than one keyword. I withdraw the objection. What I hold is that the keyword must not become a third
hand-copied vocabulary:

1. **The guide's definition of `default` is rendered from the same constant the checker reads** —
   ARCH-121's drift-lock rule, applied to this word. A cold model must be able to learn what `default`
   means from the guide alone (it is "the engine's configured default surface", which is *not*
   guessable).
2. **When the diagram row says `default`, the checker skips the tools comparison entirely** rather
   than comparing against a resolved list. A partial comparison is how "the 22nd description that does
   not match" happens again.

### G5's five contract edges get the C-3 lock (HOLD, cheap)
Their G5 lists five edges REQ-128 leaves open (an `agent()` before the first `phase()`; nested
`workflow()` rectangles; `parallel()` of `workflow()` calls; the `tools:` row when `allowedTools` is
absent; dynamic phase titles). Under ADR-039 the skeleton **refuses the undecidable**, which I accept —
but a refusal a cold model cannot have anticipated is a documentation defect by the v24 ruling, and
these five are precisely the ones it will hit. **Each of the five needs at least one `GUIDE_EXAMPLE`
that registers green against a booted engine** (my C-3 lock: every rule the checker enforces is
demonstrated by ≥1 registering example, and the existing re-registration integration test is the
acceptance). That converts five prose caveats into five red tests and is the difference between
ADR-039 being teachable and being a trap.

### `toolUse` → `toolUseDeclared` (their G9) — no fight, one addition
I do not contest the rename or the v24 no-alias-window ruling. It is the same cross-repo class as my
QD-R8 (`additionalProperties:false` vs `push_workspace.py`): **the plugin repo has no SDLC ledger, so
both breaks belong in one Gate 5 / Gate 7.5 step against the real plugin, and in the release note** —
one check, two items, rather than one remembered and one discovered.

### Remaining disagreement — none

---

## 4. Self-sustainability

**Converged:** the object-shaped budget with a legacy number rehydrating as tokens (my key_point 8 /
S-1 / QD-R1 ≡ ADR-037); the resume fold summing **stored** `costUSD` rather than recomputing against
today's catalog, with legacy two-column events not folding to zero (my S-2 / QD-R9 ≡ ARCH-118's
`foldUsage`); TTL'd last-known-good pricing (my S-3 / QD-R4 ≡ ARCH-116 + ADV-R2); `diagram_contract`
as an explicit column, never a `createdAt` inference (my S-5 ≡ ADR-043); the four-column numeric price
model beside the existing display string (my S-4 ≡ ARCH-116); memory metabolism and prompt
self-calibration named and dropped as out of scope (my S-8 — unchallenged).

### D10 — I concede ADR-038 (refuse at admission when `budget.usd` is set), and can strengthen it
My r1 leaned warn-and-continue because I read "refuse on unpriced" as turning a catalog outage into a
total outage. Their scoping removes that: unbudgeted runs proceed, anthropic and ollama runs proceed,
only *new budgeted OpenRouter* runs refuse. Under ADR-037 the refusal is also **actionable** — the
caller has `budget.tokens` as an immediate remedy — which is what makes fail-closed acceptable to this
lens rather than merely safe. Their premise checks out and I can add the evidence they did not cite:

- `model` ∈ `TUNABLE_KEYS` (`params/contract.ts:25`) and is therefore **locked in-script**
  (`workflow-meta.ts:176/194`), so no new model can appear at dispatch — the reachable set really is
  static at admission, and `run-manager.ts:498` already walks every label's resolved model.
- The two ways an unlisted model reaches admission both route through the same door:
  `isKnownAlias` accepts an `openrouter/<id>` **passthrough unconditionally**, and accepts *anything*
  when `aliasNames.size === 0` (`params/contract.ts:146-150`). Both land in the ModelBook check at
  `run_start`, which is the correct place for them to fail closed.

**One condition, which is a dependency to raise rather than a design to add.** ADR-038 makes
last-good pricing part of a *safety* decision, but their ADV-R2 leaves the **persisted** last-good
snapshot as "a deferred hardening, named not built". In-memory-only, every restart empties the book —
and this deployment restarts automatically on every release (REQ-070's updater). An OpenRouter listing
outage that spans a release therefore refuses **all** budgeted OpenRouter runs until the first
successful fetch, with no warm cache to fall back on. Either raise the persisted last-good to v26
scope, or state that consequence explicitly in ADR-038 so it is an accepted risk rather than a
surprise. I do not need it built this iteration; I need it decided, and the observability item above
(`price_book.source`) is what makes either choice auditable afterwards.

### D9 amendment — ADR-037's own stated consequence is this iteration's bug class (HOLD, two lines)
ADR-037 states honestly that under a **tokens-only** budget the in-script `total` is `null` and
`remaining()` is `Infinity` while a real cap exists at `budget.tokens().limit`. Verified on HEAD:
`sandbox/child-entry.ts:96-100` is literally
`remaining: () => (msg.budgetTotal === null ? Infinity : msg.budgetTotal - spentSoFar)`.

A script that branches on `remaining()` under a token-capped run is then told there is no ceiling when
there is one. That is a projection reporting a confident wrong value for input it does not cover — the
class named in my key_point 1 and the reason five of these ten requirements exist. Their guide sentence
(which limit which accessor answers) is necessary and I endorse it, but documentation is the weaker
half. **Amendment: `remaining()` returns `null` when a token limit exists and no USD limit does.** Scoped
deliberately to the lying case — with **no** limit of any kind, `Infinity` is honest and stays, so a
v25 unbudgeted script doing `if (budget.remaining() > X)` keeps its current behaviour. (Widening the
`null` to every USD-less run would flip that branch from always-true to always-false, which is the very
silent-semantic-change ADR-037 exists to prevent; I am not proposing that.) Honest caveat, stated so
the design gate does not find it: `null` is `=== null`-detectable but *not* comparison-safe — `null <
1000` coerces to `true` — so this makes the absence **detectable** without making a naive numeric
branch safe. That is why it is paired with, not a replacement for, the guide sentence and for
`budget.tokens()` being the named accessor for the token cap. Two lines in `child-entry.ts`, one type
change.

### D5 — I concede the placement of the trigger-budget gap, and hold the ledger obligation
Designing per-trigger budgets inside a slice whose ten REQs never mention triggers is scope invention;
their framing (a requirement gap → **G12**, with both options and a ready shape) is right and I adopt
it. My QD-R14 and their ADV-R13 are the same finding, independently verified, and should be merged
into one escalation citing both.

**What I hold is unconditional and costs three lines.** Whichever way G12 is ruled, `04-design.md:832`
(D-V2h, *"no unbounded-spend-on-an-unattended-timer"*), `:1156` (marked **Resolved**) and the
overlap-allowed accepted risk that names *"per-run budget"* as its compensating control must be
amended in the same iteration. If G12 is ruled **in**, they become true and the rows should point at
the v26 REQ. If ruled **out**, a design row asserting a control that does not exist, plus an accepted
risk leaning on it, must be corrected — because REQ-127 turns that number into money, which makes the
false row costlier than it was in v25. My r1 framed this as this lens's traceability fold and I hold
it exactly there: **a ledger row that says "Resolved" with nothing reading it back is the same defect
class as a silent projection drop.** Leaving it as-is is the one outcome neither of our proposals
should permit.

### D2 — concede the mechanism, hold one ADR row
I never proposed a shared `Projection`/`Unmapped` class and would reject one for the reason they give:
the five seams have five correct behaviours (refuse / terminal / count / keep-prev / stamp). Their
"review discipline in 04-design" is the right home for the checklist. The one thing I hold is that
the *finding* be durable: **one ADR row naming the class** ("a projection over an external payload may
not drop silently; the correct behaviour per seam is chosen explicitly and recorded"), with the five
v26 instances listed as its evidence. Without it, v27 re-derives the class from a sixth incident. An
ADR row is the cheapest artifact this ledger has and it is exactly what ADR-041 is doing for the tool
curation reversal.

### S-6 — the per-provider circuit breaker stays deferred, and ARCH-111 shortens the case for it
With ADR-040's terminal classification **and** ARCH-111's unconditional `controller.abort()`, one bad
key costs one attempt instead of `timeoutMs × (1 + retries)` while holding a concurrency slot. That
removes most of the harm I was pointing at; a breaker remains a named deferred candidate, not v26
scope. Their ADV-R7 (`ps` after a forced 401 at Gate 7.5) is the evidence that the abort actually
kills the subprocess — without it the "one attempt" claim is unverified and my liveness argument comes
back.

---

## Rulings I ask the orchestrator for (theirs, merged — one asks for more)

- **G12 (merge QD-R14 + ADV-R13)** — trigger-started runs carry no budget. Rule (a) implement or
  (b) re-decide. **Either way**, `04-design.md:832`/`:1156` and the overlap accepted risk are amended
  this iteration. This is the one item where I ask for more than the adversarial proposal does.
- **G1/ADR-037** — support as written, **plus** the `remaining()` → `null` amendment.
- **G2/ADR-038** — support as written, **plus** an explicit decision on persisted last-good pricing
  (raise to v26, or record the restart-during-outage consequence as accepted).
- **G3/ADR-040** — support, including the `ps` acceptance clause.

## Remaining disagreements after this round

1. **The ordinal on the phase record (D4).** I hold `{title, index}` and an explicit lane-alignment
   rule with a `dynamic`-node fallback; they consider the ordinal implied by `ExpectedGraph`. Verified
   evidence above says title equality is today's actual join and cannot match a dynamic title. Cost of
   my position: one integer and one sentence. If the design gate reads ARCH-113 as already carrying
   it, this closes with no change.
2. **Persisted last-good pricing under ADR-038 (D10).** Not a disagreement about direction — only
   about whether the restart-during-outage consequence is built or accepted. Needs one line either way.
3. **The unconditional ledger amendment under G12 (D5).** They escalate the gap; I additionally require
   the design rows be corrected regardless of the ruling. I expect this to be agreed rather than argued.

Everything else in my r1 is either converged with an ARCH/ADR entry named above, or withdrawn.
