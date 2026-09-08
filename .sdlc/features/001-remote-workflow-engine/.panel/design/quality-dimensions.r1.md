---
stage: design
lens: quality-dimensions
iteration: v26
round: 1 (independent proposal)
reads: "01-requirements.md REQ-121..130 (incl. the 2026-09-08 Gate-2 addendum rulings); 02-architecture.md ARCH-110..121 + ADR-037..047 + INV-V26-1..7 + 4+1 views + interface table + Decision rationale; state.yaml tech_stack; .panel/architecture/quality-dimensions.r{1,2}.md (my own Gate 2 positions); the HEAD source tree (= 570723e), including the two seams ARCH-113/119/120 cut — check-mermaid.ts, workflow-catalog.ts:484-499, dashboard-page.ts:391-543"
delta_note: "This path already held a v26 r1 written at 08:11 on 2026-09-08. The owner's Gate-2 addendum rulings were committed at 08:13 (eaf6546) — TWO MINUTES LATER — so that draft argued PRICE_UNKNOWN as pending and specified a three-valued costUSD the owner has since overruled. This round re-verifies every prior finding against HEAD (all still hold; nothing in src/ moved), adds the four findings the ruling creates (O-15, C-13, S-13, S-14), and closes the two REQs the prior draft never reached — REQ-128's refusal vocabulary (C-15) and REQ-129's zoom (C-16)."
---
# Quality-dimensions proposal — v26 DESIGN (Observability / Replaceability / Consumability / Self-sustainability)

## summary

Gate 2 adopted this lens almost wholesale — the phase ordinal on the record (O-2 → ARCH-114), the
capped subtype + count with a *named reader* (D1/D3), the `{transport, provider, model, proxyModel}`
split (O-6 → ARCH-115), `effortApplied` recording the wire POSITION (O-7 → ARCH-117), book-level
provenance on `price_book` (r2 → ARCH-116), `remaining() → null` (D9 → ARCH-118), the ADR row for the
bug class (D2 → ADR-046), the unconditional ledger amendment for trigger budgets (D5 → ADR-047). None
of that is re-argued here. This round is the layer Gate 2 could not see, and it has two halves.

**Half one — the ledger names fields; the tree names readers, and in eight places the reader does not
exist or is a hand-written whitelist that silently drops what v26 writes.** Every claim below was
re-verified by reading HEAD, with file and line. Two of those places are the seams the prior draft
never reached: REQ-128's four new rule names are not error codes at all and collapse through a
two-way ternary into a catalog hint that lies to the cold model REQ-128 exists to serve (C-15), and
REQ-129's zoom is built on a subtree that a 3-second poll deletes (C-16).

**Half two — and this is new since the prior draft of this file — the owner's two rulings
(committed 2026-09-08 08:13, `eaf6546`) inverted ADR-038 and re-decided D-V2h, but only the two
`owner_decision:` fields were rewritten. The architecture BODY still specifies the overruled design
in seven places** (ARCH-116 note, ARCH-118 api, ADR-038 title + note, the 4+1 logical view `PU`
node, the ERD's two `costUSD` comments, the interface-contract row). A design gate that reads the
body and not the ruling will implement a refusal the owner struck out. Worse, the ruling itself
creates a hole the requirement explicitly forbade, and closing it honestly — without reinstating the
refusal — is this lens's single most important ask this round.

**The five sharpest findings:**

1. **The ruling makes a USD budget under-count silently, and over an all-unpriced reachable set it
   never trips at all** (C-13, HIGH). With `costUSD: 0` for an unpriced call, `assertBudget()`
   compares an accumulator that skips those calls: on a mixed set (haiku + one unlisted OpenRouter
   model) the limit binds LATE by exactly the unpriced spend; on an all-unpriced set it binds never.
   Silent in both cases. REQ-127's own words are **"不得默默採 (i)"** — do not silently take the
   option where the budget quietly fails to bind. The owner ruled out the *refusal*; they did not
   rule out *telling the caller*. The honest replacement costs one non-fatal warning at admission,
   one `meta.budgetEnforceable` record, and one guide sentence — no refusal, no new door.
2. **The restart reconstruction path is a hand-written whitelist, and ARCH-114 names a function that
   does not exist** (O-9, HIGH). `deriveAgentRecords` (`run-store.ts:24`) is what `getRun` uses
   whenever there is no terminal snapshot; it emits exactly `{agentId, state, provider, model,
   tokens, label}` at three sites and already drops `startedAt`, `endedAt`, `frame`, `phase`,
   `lastActivityAt`. ARCH-114 assigns the v26 fields to `buildRecordsFromTranscript` — **no such
   symbol exists in `src/` or `tests/`** (grepped). Unless the real function is named, `phase`/
   `phaseIndex`/four-column `tokens`/`costUSD`/`transport`/`detail` are write-only there, and
   `inferPhase(record, phases)` has no `startedAt` to join on, so every restart-reconstructed record
   falls to the frame-grouped fallback *with a warning* — REQ-124's forbidden outcome.
3. **The price pin must be installed in `RunManager.start()`, not in the `run_start` facade** (S-13,
   HIGH). ARCH-116 says "Admission (`run_start`)". Verified: all four starters funnel through
   `RunManager.start()` — `mcp-facade.ts:570`, `scheduler.ts:313`, `webhook-registry.ts:302`,
   `server.ts:870` — and the reachable-set expression the pin needs already lives inside it
   (`run-manager.ts:498`). Pin at the facade and every cron/webhook/resident run has `price_book =
   null` ⇒ every call `unpriced` ⇒ `costUSD: 0` ⇒ **the owner's "every run must record its spend,
   however started" is hollow precisely for the unattended runs it was written about.** This is the
   `composeConfig` wiring bug class one file over.
4. **`run_result.meta` does not exist, and two of its counters live only in RAM** (O-11/O-12, HIGH).
   `ResultEnvelope` (`types.ts:66`) is `{runId, status, result?, error?, principal?}`. ARCH-118 says
   `meta` "gains" three things it has nowhere to gain them; `unmappedMessages` rides `GatewayResult`,
   an in-memory object, so the counter my own D1/D3 condition promised a reader for is gone after a
   restart. And the resume fold is gated on a budget existing (`run-manager.ts:840`) — correct for
   hydrating `RunGuard`, fatal for a spend total the owner just made mandatory for **unbudgeted**
   runs.
5. **A `refused` record does not survive a restart at all** (O-10, HIGH). `markRefused`
   (`agent-executor.ts:222`) writes only the in-process `_records` map — no transcript event — and
   `deriveAgentRecords` omits any agent with neither a usage nor a harness event. v25 minted that
   record *because* an invisible refusal silently cost every branch past the second of a
   `parallel()`; v26's projection re-loses it on any interrupted run.

`03-tasks.md` **does exist** (the task prompt says it does not); it ends at TASK-169 / DES-169 (v24
+ v25), so v26 starts at TASK-170 / DES-170. Where task splitting decides whether a quality survives,
§Task-splitting obligations is a numbered block the synthesizer can lift verbatim.

---

## Altitude call (which system is this?)

**Both altitudes, applied per REQ** — the same call ARCH's own "Altitude split" paragraph makes, and
it is the right one. A Node 22 / TypeScript ESM service (hand-rolled JSON-RPC MCP server,
better-sqlite3, journal + snapshots, dashboard, systemd self-update) carries REQ-121 / 124 / 125 /
129 at the **system** altitude. `agent()` dispatching a Claude Agent SDK session through a swappable
`GatewayClient` onto three providers carries REQ-122 / 123 / 126 / 127 at the **agent** altitude.
REQ-128 / 130 are agent-altitude **consumability**: the author is a cold model, and the refusal
envelope plus the generated guide *are* the API.

Deliberately excluded, one sentence each so the dimension is answered rather than skipped.
**Memory metabolism / context compression** — runs are bounded, journalled and terminal; there is no
resident agent memory to compress, and inventing one is scope invention. (The one real context-size
pressure is the guide itself, which a cold client receives whole — that is QD-R10, not a metabolism
mechanism.) **Self-reflection / prompt calibration** — nothing in REQ-121..130 asks for it, and the
REQ-117 cold-model probe is the human-in-the-loop substitute this ledger already runs.
**Tool-liveness is NOT excluded** — v26 builds its reactive form and should say so; see S-12.

---

## Carried forward from Gate 2 (not re-argued)

| Gate 2 item | Landed as | This round |
|---|---|---|
| O-2 phase `{title,index}` at IPC receipt, never on `CallKey` | ARCH-114, INV-V26-1 | O-9, O-14 make it reachable |
| O-4/D1 unmapped subtype + count, capped, named reader | ARCH-111 + rationale | O-12: journal it or it has no reader after a restart |
| O-5 `retryable` honoured by both loops | ARCH-111, ADR-040 | S-12 claims it as the liveness answer |
| O-6 transport ≠ provider ≠ model | ARCH-115 | O-9: all three must reach the derived path |
| O-7 `effortApplied` records wire position + value | ARCH-117 | no change |
| O-8 + r2 provenance: pinned prices, `price_book.{fetchedAt,source}` | ARCH-116 | S-9, S-10, S-13 |
| D2 name the bug class once | ADR-046 + D-V26-projection | O-15 is the sixth instance, minted by the ruling itself |
| D3 every counter named, rendered, asserted | rationale | O-11, O-12, O-13, S-11 |
| D5 trigger-budget ledger amendment unconditional | ADR-047 (ruled (b)) | S-13, C-14 |
| D8 provider table split by fact LIFETIME | ARCH-112 + ARCH-116 | R-8, R-10 |
| D9 `remaining() → null` | ARCH-118 | C-8 applies the same rule to `total` |
| D10 narrowed `PRICE_UNKNOWN` refusal | ADR-038 | **OVERRULED by the owner** — O-15, C-13, C-14 |
| D13 `--check-config` before restart | ADR-042 | S-11 gives it a reader |

---

## key_points

1. **(C-13, HIGH)** The owner's `costUSD: 0` ruling makes a USD budget **under-count silently** (it
   binds late by exactly the unpriced spend) and, over an all-unpriced reachable set, **never bind at
   all**. Replace the struck-out refusal with a non-fatal admission **warning** +
   `meta.budgetEnforceable: {usd, tokens, unpricedModels: string[]}` + one guide sentence. No refusal,
   no new door, and REQ-127's "不得默默採 (i)" is satisfied.
2. **(O-15, HIGH)** The architecture body still specifies the overruled refusal in seven named
   places. 04-design must state the corrected rule ONCE (`unpriced ⇒ costUSD: 0`, `unpriced: true`
   on the record, `meta.unpricedCalls`, no admission refusal) and the tasks doc must carry a
   *deletion* item for `PRICE_UNKNOWN`, not an implementation item. And every reported total whose
   `unpricedCalls > 0` is a **lower bound** — the word belongs in the field's own description.
3. **(S-13, HIGH)** Install the pin in `RunManager.start()` (`run-manager.ts:498`, the reachable-set
   expression that already exists), not in the facade — all four starters share that door — and prove
   it with one integration test that a schedule-fired run has a non-null `price_book` and non-zero
   recorded spend.
4. **(O-9, HIGH)** `deriveAgentRecords` (`run-store.ts:24`) is the restart reconstruction path;
   ARCH-114's `buildRecordsFromTranscript` does not exist. Fix all three branches and derive
   `startedAt` from the event `ts`, or `inferPhase` has nothing to join on.
5. **(O-10, HIGH)** `markRefused` (`agent-executor.ts:222`) never journals, so `refused` and `queued`
   records vanish when a non-terminal run is reconstructed — v25's visible-refusal fix, re-lost.
6. **(O-11, HIGH)** `run_result.meta` does not exist (`types.ts:66`): envelope field + `foldUsage`
   over the persisted journal at read time + `outputSchema`; and the budget gate at
   `run-manager.ts:840` must NOT be inherited by the meta fold.
7. **(O-12, HIGH)** `unmappedMessages` as specified is memory-only. Journal the capped subtype, and
   **derive** `unpricedCalls` from the stored per-call `unpriced` flag rather than maintaining a
   second live counter.
8. **(O-13, MEDIUM)** Name the two dashboard readers (`dashboard.ts:56` flattens
   `tokens.input + tokens.output` into `tokens: number`; `dashboard-page.ts:359` renders
   `(a.tokens||0)+' tok'`). A partial four-column rollout either drops both cache columns silently or
   renders **`[object Object] tok`**; neither fails `tsc`.
9. **(O-14, MEDIUM)** `phase()` inside a nested `workflow()` is silently dropped today — the nested
   host (`run-manager.ts:1011`) passes no `onPhase`, and `host.ts:139` is `onPhase?.(…)` — which makes
   ARCH-114's nested-lane cohort rule unreachable code. Wire it, or make the no-op an explicit guide
   sentence. Silence is not one of the options.
10. **(R-8, HIGH)** `maxPricePerMOf` (`model-catalog.ts:250`) parses the DISPLAY string
    (`/\$([0-9.]+)\/1M/`); ARCH-116 makes numeric rates primary and the string derived. Re-point the
    filter and `computeCostLevel` at the numbers, or one model has two price derivations in the same
    iteration that deleted three effort tables for exactly that reason.
11. **(R-9, MEDIUM)** `toolUse` is an input FILTER as well as an output field
    (`model-catalog.ts:39`, `tool-specs.ts:848`, `filterCatalog:306`) — rename both together and
    extend the `models_list` description with `effortDeclared` / `declaredSource` /
    `catalogFetchedAt`, or REQ-126's declaration ships undiscoverable.
12. **(R-10, MEDIUM)** The grep guard proves the retired names are GONE, not that the new table is
    TOTAL. Add one `Provider`-totality test across every provider-keyed site, which is what makes
    ADR-041's headline claim ("a fourth provider is one union member") a checked property.
13. **(C-8, HIGH)** Apply Gate 2's conceded `remaining() → null` rule to its sibling: `budget.total`
    reads `null` = "unbounded" under a tokens-only budget, which is the identical confident-wrong
    value. Add `budget.limits: {usd, tokens}` as the one named reader.
14. **(C-9, HIGH)** The IPC budget wire is three fields (`budgetTotal`, `spent`, `onBudgetSnapshot`),
    and the nested host has **no `onBudgetSnapshot` at all** — `budget.spent()` reads 0 in every
    sub-workflow today and `$0.00` after v26.
15. **(C-10, MEDIUM)** Render the seed item `description` and the validator `hint` from one exported
    constant; **hold** ARCH-110's `required: ['path']` (ajv is live, so adding `contentB64` there
    would make `INVALID_SEED_SPEC` unreachable and its new `see:` row dead on arrival).
16. **(C-11, MEDIUM)** Three breaking changes in one release (`budget` number→object,
    `models_list.toolUse`→`toolUseDeclared`, `tokens` two→four columns) need one migration paragraph
    and a named answer AHEAD of ajv, following the `call-tool.ts:94-100` precedent.
17. **(C-14, LOW)** Both owner rulings have landed, so **nothing is gated any more** — the tasks doc
    must not carry a conditional `PRICE_UNKNOWN` task or a conditional trigger-budget task. What it
    must carry is the unconditional ADR-047 ledger correction (`04-design.md:832`, `:1156`, and the
    overlap accepted risk), scheduled EARLY so it cannot be dropped at the end.
18. **(S-9/S-10, HIGH/MEDIUM)** The pin rides the reads that already exist (`run-manager.ts:498`
    reachable set, `:834` stored-params rehydration); `price_book.source` needs a fourth value,
    `'unavailable'`, because after the ruling `0` no longer distinguishes *free* from *never
    fetched*.
19. **(S-11/S-12, MEDIUM/LOW)** `configCheck` touches four things that must move together or
    `'skipped'` — the *silent* outcome by construction — has no reader; and ARCH-111 IS this
    dimension's tool-liveness answer, which 04-design should claim in one paragraph.
20. **(S-14, MEDIUM)** The ruling's "a budget is optional; tracking is not" principle needs a
    **negative** test, not only a positive one: a run started with NO budget at all must still show
    four-column tokens and a `costUSD` in `run_status`, `run_result.meta` and the dashboard — that is
    the exact combination every code path currently gates away.
21. **(C-15, HIGH, NEW)** REQ-128's four v2 names are **rules, not error codes**. `checkMermaid`
    returns `rule: string` and `workflow-catalog.ts:495` folds it through a two-way ternary —
    `DIAGRAM_MISMATCH` when a label diff is present, else `MERMAID_INVALID` — so all four land on a
    catalog hint that says *"the diagram does not parse under checkMermaid's grammar"*, which is
    false for every one of them (they parse; they disagree with the script). `expected` has nowhere
    to travel (the detail literal is four fields), and ARCH-121's drift-lock iterates `ErrorCode`, so
    it is **blind to rule strings and stays green while REQ-128's `see:` clause is unmet**.
    `COLLAPSED_EDGE` is the living precedent: emitted as a rule, taught by the guide
    (`authoring-guide.ts:445`) as if it were a refusal code, and it has no `ERROR_CATALOG` row at
    all. Fix: one total `rule → ErrorCode` map with a `never` check replacing the ternary, four
    catalog rows, `expected` in the detail — or keep one code and amend REQ-128. Not silently both.
22. **(C-16, MEDIUM, NEW)** ARCH-120 does not say **where the zoom transform lives or what is
    allowed to reset it**, and the page rebuilds underneath it: `setInterval(render, 3000)`
    (`dashboard-page.ts:543`) → `renderGraph` → `svgEl.innerHTML=''` (`:393`). Inside the SVG the
    transform dies every 3 s; on the wrapper it survives, but `dagBox` recomputes `viewBox` as agents
    appear, so the picture still jumps under a user who zoomed. Decide it: transform on the
    `.zoomable` wrapper, a `viewBox` recompute that never re-fits, and only `fit`/`resize` returning
    to identity. One screenshot cannot catch this — the assertion is zoom → wait >3 s → transform
    unchanged.

---

## 1. Observability

**The traceability fold, stated up front:** after v26 the question *"which of the three provider paths
broke, what did it cost, and in which phase"* must be answerable **from the persisted record alone**,
because this box restarts on every release (ADR-038's own premise, and ADR-042's). Every finding
below is one place where the answer exists only in RAM, or only in a field that nothing projects.

### O-15 (HIGH) — the owner's ruling made the ledger internally inconsistent, and it minted a sixth instance of ADR-046's own bug class

Verified by grep against HEAD. The owner ruled at `eaf6546` (2026-09-08 08:13) that an unpriced model
is **charged 0**, the record still says `unpriced: true`, `meta.unpricedCalls` counts it, and the
`PRICE_UNKNOWN` refusal is **overruled**. Only the two `owner_decision:` fields were rewritten. The
body of 02-architecture.md still specifies the struck-out design at:

| line | text still standing | corrected rule |
|---|---|---|
| 2798 (ARCH-116 note) | "under ADR-038 the pin decides whether a budgeted run is **admitted at all**" | the pin decides arithmetic only; it never refuses |
| 2815 (ARCH-118 api) | `priceCall(…) → number \| null`; `AgentRecord.costUSD: number \| null` | `→ number` with a companion `unpriced: boolean`; `costUSD: number` |
| 2853 (ADR-038 title) | "…is **refused** when a reachable model has no price (`PRICE_UNKNOWN`)" | title and note superseded by the ruling recorded beneath them |
| 2933/2936 (4+1 logical view) | `PU{"USD-only limit + unpriced model?"} -->|yes| REF2["PRICE_UNKNOWN"]` | the decision node and the refusal arm are deleted |
| 3070, 3081 (ERD) | `costUSD "… null when unpriced"` (twice) | `0 when unpriced, with unpriced=true beside it` |
| 3097 (interface table) | "may refuse `PRICE_UNKNOWN` … (pending the owner ruling)" | no refusal; admission may WARN (C-13) |

**04-design.md is where this gets resolved for the design gate**, because REQ-127 (as amended) is the
higher authority: the design must state the corrected rule ONCE and every DES row must descend from
that statement, not from ARCH-118's api line. The tasks doc gets a **deletion** item, not an
implementation item. **And the seven lines above should be patched in 02-architecture.md itself as a
housekeeping amendment** — the SAD is a living document in this ledger (ARCH's own housekeeping note
already schedules amendments to `state.yaml` and `04-design.md`), and a stale arch body traps every
future reader, not only this gate. Leaving the struck-out refusal standing in the title of ADR-038,
in the logical view and in the interface table is how it gets re-implemented in v27.

And note what the ruling *is*, in this iteration's own vocabulary: **charging 0 for a price the
engine could not look up is a silent default over an external payload — ADR-046's class, sixth
instance, minted by the compensating control's own design.** The owner is entitled to that trade (a
refusal was worse for them), but ADR-046 then binds it: the drop must name what it dropped and have a
named reader. Concretely —

- `unpriced: true` is a **per-agent-record** field, not only a run-level counter — and this is not a
  proposal of mine, it is REQ-127-as-amended's literal text (*"該筆紀錄標 `unpriced: true`"*) which
  ARCH-118's api line simply does not carry. It is therefore a ledger-consistency defect, not a
  preference. Without it the record shows `costUSD: 0` and nothing distinguishes *free ollama call*
  from *we had no price*. The
  owner's stated purpose — "可查詢即可 … 供事後調整價格表" (queryable, so the price table can be fixed
  later) — needs the `(provider, model)` of the unpriced call, and the record is the only place that
  pairing survives.
- **`unpricedCalls > 0` makes every total on that run a LOWER BOUND**, and the word belongs in the
  field description, the guide, and the dashboard label — not in a comment. A number presented as a
  cost, that is arithmetically guaranteed too low, with no adjacent qualifier, is the same defect
  class as `provider: 'claude-agent-sdk'` (REQ-125) at the money layer.
- `foldUsage`'s legacy branch resolves cleanly under the ruling and should say so: a pre-v26
  two-column usage event folds `cacheRead/cacheWrite = 0`, `costUSD += 0`, `unpriced += 1`, never
  re-priced against today's catalog. ARCH-118 states the counter but never states the cost
  contribution; under the old `null` rule that was ambiguous, under the ruling it is 0.

### O-9 (HIGH) — name the real reconstruction function and fix all three of its branches

Verified: `deriveAgentRecords(transcripts, parentStatus)` at `run-store.ts:24` constructs records at
three sites — usage/done (`:39`), usage/failed (`:41`), harness-only (`:52`) — each an object literal.
It fabricates `tokens: {input: 0, output: 0}` on two branches and never sets `startedAt`, `endedAt`,
`frame`, `phase` or `lastActivityAt`. `getRun` reaches it whenever no terminal snapshot exists
(`sqlite-run-store.ts:260`, `run-store.ts:243`: `snap?.agents ?? derive…`). `buildRecordsFromTranscript`
returns **zero grep hits** in `src/` and `tests/`. The design must:

- **name the function `deriveAgentRecords`** in the DES row (or state that a new function is being
  introduced and what becomes of the existing one) — a ledger row pointing at a symbol that does not
  exist is how a task gets implemented somewhere else and the seam stays broken;
- set `startedAt` from the **first** event's `ts` and `endedAt` from the usage event's `ts`, because
  `inferPhase` is specified as `record.startedAt ?? record.endedAt` and this path supplies neither;
- carry `phase`, `phaseIndex`, `transport`, `proxyModel`, four-column `tokens`, `costUSD`, `unpriced`
  and `detail` on **all three** branches — the failed branch emitting four zeros, `costUSD: 0` and
  `unpriced: false` (a failed call has no usage; claiming it was unpriced would inflate the very
  counter ARCH-118 was careful to protect from outages);
- carry one fixture per branch. The v24 panel found this exact shape one layer up ("write-without-
  readback"); this is the same seam one iteration later.

### O-10 (HIGH) — journal the refusal, or state the cohort limit; silence is the one option v26 cannot keep

Verified: `markRefused` (`agent-executor.ts:222-227`) merges onto the in-process `_records` map only —
"no gateway, no tokens, **no transcript**" in its own doc comment — `saveSnapshot` runs only at the
terminal transition, and `deriveAgentRecords` skips any agent with neither a usage nor a harness
event. So a `refused` (or `queued`) record is invisible in `run_status.agents[]` for any run
interrupted before terminal: the DAG loses the refused cell and REQ-120's whole point with it.

Cheapest correct fix: **one journaled transcript event at `markRefused`** — the sink exists and is
already redacted at capture — which also lets `foldUsage` see the refusal with `costUSD: 0`,
`unpriced: false`. If the panel refuses a new write path inside a slice whose REQs never ask for one,
then ARCH-114's cohort list and REQ-124's acceptance must say so **out loud**. My position: journal
it. A record that exists only in RAM is precisely ADR-046's class, and the design gate is the cheapest
place it is ever fixed.

### O-11 (HIGH) — `run_result.meta` is three obligations, not one

`ResultEnvelope` (`types.ts:66`) is `{runId, status, result?, error?, principal?}`; `getResult`
persists `{value}` only; `RunManager.result()` (`:735`) returns `{ok, value}`. ARCH-118 says `meta`
"gains" `usage`, `unpricedCalls` and `unmappedMessages`. So:

- **(a)** the envelope (or a `run_result`-specific response type) gains `meta`;
- **(b)** it is computed by `foldUsage` over the **persisted journal at read time**, never from
  `entry.guard` — a `run_result` after a restart has no live guard, and a `meta` that is silently
  empty there is the same defect one level up;
- **(c)** it is declared in `TOOL_SPECS.run_result.outputSchema`, or a cold model never learns it
  exists (the REQ-117 lesson, and why `models_list`'s nine filters went undiscovered in v24).

**And one gate must not be inherited.** `run-manager.ts:840-844` folds the journal only
`if (spec.budget !== null && spec.budget !== undefined)`. That is right for hydrating `RunGuard` and
wrong for the run's own spend total — and after the ADR-047 ruling it is *acutely* wrong, because
trigger-started runs never carry a budget and are exactly the runs the owner ordered tracked. One
function, two callers, different gating, written down in the DES row.

### O-12 (HIGH) — a counter that dies with the process is not observability

ARCH-111 carries `unmapped?: string[]` on `GatewayResult` → `meta.unmappedMessages`. `GatewayResult`
is an in-memory object; after a restart the count is gone while the run row survives. The subtype
(already capped at 64 B and charset-restricted per the adopted D1) must ride the **terminal usage
transcript event** into the journal, so `foldUsage` recounts it exactly the way it recounts tokens.

Corollary that removes a whole drift class: **`unpricedCalls` should be DERIVED by `foldUsage` from
the stored per-call `unpriced` flag, not maintained as a second live counter.** ARCH-118 currently has
`RunGuard._unpriced++` *and* `foldUsage → {…, unpriced}`. They are sequential (live vs rehydrate), not
concurrent, so this is not a race — it is two independent statements of one rule, which is exactly how
they drift apart, and this iteration exists because five such pairs drifted. Ask: **one derivation
rule — the stored `unpriced` flag on a `done` call — applied by whichever object holds the count.**

### O-13 (MEDIUM) — the two dashboard readers, named, and cost that does not lie

`dashboard.ts:56` flattens `tokens: a.tokens.input + a.tokens.output` into the DAG cell type
(`dashboard.ts:22`, `tokens: number`); `dashboard-page.ts:359` renders `(a.tokens||0)+' tok'` off that
cell. Two outcomes, both bad, neither caught by `tsc`: leave the cell a `number` and the two cache
columns — the **majority** of a cached Anthropic call's usage (measured in REQ-127: `input 18 /
cache_creation 20,762 / cache_read 19,522 / output 282`) — never reach the UI; widen it to the object
and the renderer emits **`[object Object] tok`**, because string concatenation of an object is legal
TypeScript. Both sites move in one task, and this is where the Gate 2 promise lands: `costUSD`,
`meta.unpricedCalls` and `meta.unmappedMessages` get their rendered reader on the run page beside
ARCH-119's per-agent harness table.

**Under the ruling, cost is still two-valued but the pair is `(costUSD, unpriced)` and the renderer
must not collapse it.** `0 + unpriced:false` = genuinely free (ollama, or a refused call that never
dispatched); `0 + unpriced:true` = we could not price it. Rendering both as a bare `$0.00` re-creates
the silent default one layer up from where ADR-046 removed it. One badge on the cell and one
"(lower bound)" qualifier on the run total is the whole cost.

### O-14 (MEDIUM) — nested `phase()` is discarded today; decide it, don't inherit it

Verified: the nested `SandboxHost` (`run-manager.ts:1011-1022`) passes only `onAgentRequest` and
`onWorkflowRequest`; `host.ts:139` is `case 'phase': this._config.onPhase?.(msg.title)`. A
sub-workflow's phases therefore never reach `entry.phases`, and ARCH-114's rule — "`k >= lanes.length`
(nested frames pushing onto the parent timeline) appends a lane WITH a warning" — describes behaviour
that **cannot occur**. REQ-124's "nested `workflow()` frames share the same phase timeline (a known
approximation)" is not an approximation; it is a silent drop.

Two acceptable designs, one unacceptable: **(a)** wire `onPhase` on the nested host and accept the
warned appended lane ARCH-114 already specifies — my preference, one line, and it makes the
architecture's own stated cohort true; **(b)** leave it unwired and make *"`phase()` inside a nested
`workflow()` is a no-op"* an explicit sentence in the guide (ARCH-121 (b)) plus a registration-time
warning; **(c)** saying nothing, which is what we have.

---

## 2. Replaceability

**Carried:** R-1..R-7 landed as ARCH-112 / ADR-041 / ADR-045 — one `PROVIDER_CAPS`, `never`-checked
switches, the retired surface grep-guarded — and I conceded the pricing/identity split on lifetime
grounds (D8). None of that reopens. The three items below are seams the deletion leaves behind.

### R-8 (HIGH) — one numeric price, or the catalog and the budget answer differently about the same model

Verified: `maxPricePerMOf` (`model-catalog.ts:250`) parses the **display string**
(`/\$([0-9.]+)\/1M/`) and returns `max(in, out)`; `computeCostLevel` (`:272`) rides it; the
`maxPricePerM` filter and the 0–10 `costLevel` rating ride that. ARCH-116 makes numeric
`ratesPerM {in, out, cacheRead, cacheWrite}` primary and the `"$5/1M"` string **derived**. If the
filter keeps parsing the derived string, one model has two price derivations — the exact defect
ADR-045 deletes for effort, re-created in the pricing module in the same iteration.

Design ask: `maxPricePerMOf(rates: FourRates | null) → number | null`, the display string becomes
human-facing only, and the DES row **states which rates the scalar compares** — today `max(in, out)`;
keep it, but say so now that four rates exist, and say explicitly that `costLevel` therefore ignores
the cache rates. A silent `max` over two of four columns is a projection with a default.

### R-9 (MEDIUM) — `toolUse` is an input filter as well as an output field

`CatalogFilter.toolUse` (`model-catalog.ts:39`), `TOOL_SPECS.models_list.inputSchema.toolUse`
(`tool-specs.ts:848`), `filterCatalog` (`:306`), and the prose at `:838-841` that enumerates the row's
fields. ARCH-117 renames only `EnrichedModelEntry`. Rename the filter in the same task or the surface
is inconsistent for exactly the cold model v24 rewrote that description for — and extend the
description with `effortDeclared`, `declaredSource` and the top-level `catalogFetchedAt`, or REQ-126's
declaration ships served-but-undiscoverable.

### R-10 (MEDIUM) — enumerate the provider-keyed sites; a grep guard proves absence, not totality

REQ-123's own red test is a grep, and a grep is an absence proof.
`no-retired-surface.test.ts` will prove `'openai'` / `'gemini'` are gone. It proves nothing about
whether the surviving sites are exhaustive over `Provider` — which is the half REQ-123 actually cares
about ("三條都拿完整工具面"). Provider-keyed sites beyond
`PROVIDER_CAPS`, verified: `default-aliases.ts:16-19` (provider-keyed data), the LiteLLM route
emitter, the static catalog list plus the two federation fetchers in `model-catalog.ts`, and the
direct-fetch client's request/response branches. Design ask: **list them, and add one totality test** —
for every member of `PROVIDERS`, each site returns without reaching its `never` arm. That is what
converts ADR-041's headline claim ("a fourth provider is one union member plus the rows `tsc` demands")
from a hope into a checked property, and it is the whole replaceability argument for a slice whose
main act is a deletion.

### R-11 (LOW, agent altitude) — record the compensating property where a *caller* reads it

This dimension's agent half asks that GPT↔Claude↔local stay a config change. v26 narrows five paths to
three — a real reduction, correctly traded. The compensating facts are that **OpenRouter is the
many-model front door** (so *swap the model* is still a config change) and that **two `GatewayClient`
implementations behind one interface** keep *swap the transport* a config change. ADR-041 says this to
the ledger; the **guide's alias table (ARCH-121 (d)) should say it to the caller** in one sentence, so
"why is there no `openai` row" has a published answer instead of a removed one.

---

## 3. Consumability

**Carried:** C-1..C-7 landed as ARCH-119's structure-as-JSON refusal envelope (I am the lens that was
expected to argue for handing back corrected Mermaid, and I argued against it — D6), the
`tools: default` keyword with the checker's own constant rendering the guide's definition and a
SKIPPED (never partial) comparison (D7), and `declaredSource` on the declared flags (C-7).

### C-13 (HIGH, NEW) — the ruling removed the refusal; it must not also remove the telling

**The mechanism, stated exactly and without overstatement.** `assertBudget()` compares accumulated
`costUSD` against `budget.usd`. Under the ruling an unpriced call contributes `0`. So a caller who
sets `budget.usd` and no `budget.tokens` gets one of two failures, depending on the reachable set:

- **partially unpriced** (the common case — `haiku` plus one unlisted OpenRouter id): the limit
  **binds late**, by exactly the spend of the unpriced calls. A `$5` cap can pass `$5` of real money
  and keep dispatching.
- **entirely unpriced** (this deployment's own `default` alias is ollama at price 0, and any run
  whose reachable models are all missing from the catalog): the accumulator never grows, so the limit
  **never trips at all**.

Silent in both cases. The engine knows which case applies **at admission** — the reachable set is
static (ADR-029 + REQ-091) and the pin is taken right there — so this is not an unknowable condition;
it is a known one being kept quiet.

REQ-127 anticipated precisely this shape and forbade it in its own words: **"不得默默採 (i)"**. The
architecture's answer was a refusal; the owner struck the refusal. The owner did **not** rule that the
caller must be left uninformed — their stated principle is the opposite ("追蹤與紀錄不能不做", and the
whole point of `unpriced` is that a human can go back and fix the price table).

**Proposal — three cheap parts, no refusal, no new door:**

1. **A non-fatal warning on the `run_start` response.** Stated honestly: **no `warnings` envelope
   exists on any MCP tool response today** — grepped; the only `warnings` in `src/` is
   `dashboard.ts:249`'s `warnings: string[]` on the DAG payload, rendered at
   `dashboard-page.ts:450-455`. So this is a new field, and the cheapest form is the one that already
   has a precedent and a renderer: **`warnings: string[]` with the same shape as the DAG payload**,
   carrying one engine-authored sentence naming the models and the remedy the struck-out refusal
   already drafted — *"add `budget.tokens`, or accept that the USD limit cannot bind for these
   models."* This is the struck refusal converted into information; the owner overruled *stopping the
   run*, which this does not do. If the panel will not add a response field at all, fold the sentence
   into (2) and drop this part.
2. **`meta.budgetEnforceable: {usd, tokens, unpricedModels}`** on the run, pinned at admission
   alongside `price_book`. Deliberately **not** a bare boolean pair, because a boolean cannot express
   the partial case: `usd: true` means *every* reachable model is priced, `usd: false` means at least
   one is not, and **`unpricedModels: string[]` names which** — the owner's stated purpose is
   "回頭調整" (go back and adjust the price table), and the `provider/model` ids are the only thing
   that makes that actionable. It is the durable, queryable form of the fact, it survives the restart
   the warning does not, and every value in it is already computed for the pin.
3. **One guide sentence** in ARCH-121's budget section: *"a USD budget counts only calls the catalog
   can price; a run that reaches an unpriced model records `unpriced: true` on those calls, counts
   them in `meta.unpricedCalls`, and its USD total is a lower bound — set `budget.tokens` if you need
   a limit that binds on every model, including local ones."* Note this sentence also carries the
   deployment fact ARCH-118 already knows: this box's `default` alias is ollama at price 0, so a
   USD-only budget never stops a local run either. One sentence covers both.

If the panel wants only one of the three, take **(2)** — it is the one that survives a restart and the
one a post-mortem reads.

### C-15 (HIGH, NEW) — REQ-128's four names are rules, not codes; today they all collapse into a hint that lies

This is ADR-046's class again — the **seventh** instance, and the first one found on the consumability
surface rather than in a record. The projection is a two-way ternary over a rule vocabulary that has
grown past it.

**Verified at HEAD.** `checkMermaid` returns `CheckMermaidResult` carrying `rule: string`
(`check-mermaid.ts:15`, `:86`). Exactly one caller consumes it, `workflow-catalog.ts:492-499`:

```
const code = diagramCheck.onlyInScript !== undefined || diagramCheck.onlyInDiagram !== undefined
  ? 'DIAGRAM_MISMATCH' : 'MERMAID_INVALID';
throw codedError(code, `${code}: ${diagramCheck.rule ?? 'unknown'}…`, {
  rule, line, onlyInScript, onlyInDiagram,          // ← a four-field literal
});
```

The ternary keys on **label-diff presence**, and exactly one rule in the file sets those fields.
Enumerated from `grep -n "return err(" src/check-mermaid.ts`, today's seven rule names route like
this:

| rule emitted | reaches code | hint truthful? |
|---|---|---|
| `DIAGRAM_SCRIPT_MISMATCH` (`:192`) | `DIAGRAM_MISMATCH` | yes — it *is* a label diff |
| `MERMAID_INVALID` (`:161`, `:202`) | `MERMAID_INVALID` | yes — it really did not parse |
| `SIZE` (`:98`, `:100`) | `MERMAID_INVALID` | **no** — it parsed; it is too big |
| `COLLAPSED_EDGE` (`:163`) | `MERMAID_INVALID` | **no** |
| `UNDECLARED_NODE` (`:165`, `:166`) | `MERMAID_INVALID` | **no** |
| `AGENT_LABEL_FORMAT` (`:175`) | `MERMAID_INVALID` | **no** |
| `VALUE_MISMATCH` (`:210`) | `MERMAID_INVALID` | **no** |

So the defect is not created by v26 — it is **five sixths of the existing vocabulary**, and v26 walks
four more rules into it. After ARCH-119, ten distinct rule names reach two codes, and nine of the ten
land on `MERMAID_INVALID` with only one of those nine telling the truth.

**Why that is a defect and not a cosmetic complaint.** `MERMAID_INVALID` does carry
`see: 'workflow_authoring_guide'` (`errors.ts:56`), so the *pointer* is right. Its **hint is
false**: *"the diagram does not parse under checkMermaid's grammar."* An `EDGE_MISMATCH` diagram
parses perfectly; it disagrees with the script. A cold model reading that hint re-checks its Mermaid
syntax — the one thing that is not wrong — and the REQ-117 first-try probe REQ-128 is written to
pass is exactly the test that punishes this. Widening the ternary to route them to
`DIAGRAM_MISMATCH` does not fix it either: that hint says *"the diagram's agent labels disagree with
the script's"*, equally false for a direction or a tools row.

**Three consequences, each checkable:**

1. **REQ-128's "四個碼皆 `see: workflow_authoring_guide`" is unmet as specified** — the four names are
   not codes, so nothing carries a `see:` for them; the code they collapse into carries someone
   else's.
2. **`expected` has no route.** ARCH-119 specifies the refusal envelope as `{rule, line, expected}`;
   the detail object at `:495` is a closed four-field literal. The structure-as-JSON envelope that
   both lenses agreed on at Gate 2 (D6 — *"strictly more useful to a cold model"*) does not reach
   the wire unless this object is opened.
3. **ARCH-121's drift-lock is blind to it.** "Every code any validator emits has an `ERROR_CATALOG`
   row and every authoring-side code has `see: 'workflow_authoring_guide'`" iterates `ErrorCode`.
   Rule strings are not in that union, so the lock is **green while the clause fails** — the worst
   kind of test, one that reports coverage it does not have. `COLLAPSED_EDGE` proves the gap is
   already open: the guide teaches it as a refusal (`authoring-guide.ts:445`, *"is refused
   `COLLAPSED_EDGE`"*) and `ERROR_CATALOG` has no row for it at all.

**The ask (one of the two, explicitly, in 04-design — not inherited):**

- **(a) Promote.** Replace the ternary with a total `RULE_TO_CODE: Record<Rule, ErrorCode>` plus a
  `never` exhaustiveness check, mint `DIAGRAM_DIRECTION` / `LANE_MISMATCH` / `TOOLS_MISMATCH` /
  `EDGE_MISMATCH` (and, while the file is open, the five pre-existing strays `SIZE` /
  `COLLAPSED_EDGE` / `UNDECLARED_NODE` / `AGENT_LABEL_FORMAT` / `VALUE_MISMATCH`) as `ERROR_CATALOG` rows each with
  `see: 'workflow_authoring_guide'` and a hint that names what the checker actually compared, and
  widen the detail to carry `expected`. Cost: one map, one `never`, and nine catalog rows — four
  REQ-128 already requires and five that pay off a debt v26 would otherwise deepen. It also makes
  ARCH-121's drift-lock mean what it says, and a new rule added without a code becomes a compile
  error instead of a silent mis-hint. **Minimum viable version if the panel balks at the five
  strays:** the map and the `never` still land, the five keep mapping to `MERMAID_INVALID`
  explicitly (a named, greppable decision instead of a ternary's silence), and only the four new
  codes are minted.
- **(b) Keep one code and say so.** REQ-128's acceptance is amended to *"one `DIAGRAM_MISMATCH` code
  whose `detail.rule` names which of the ten comparisons failed"*, the hint is rewritten to be true
  for all of them, and the guide teaches `detail.rule` as the thing to read.

(a) is what REQ-128 asks for literally and what `errors[]`-driven cold clients consume; (b) is
legitimate and cheaper, but it is a REQ amendment and must be recorded as one. What must not happen is
(b) by default with REQ-128's text left standing — that is the ledger asserting a control that does
not exist, ADR-047's own finding one document over.

### C-8 (HIGH) — apply the conceded `remaining()` rule to its sibling `total`

`Budget` is `{total: number | null; spent(): number; remaining(): number}` (`types.ts:76-80`), built
in the child at `child-entry.ts:97-100` with `total: msg.budgetTotal` and
`remaining: () => budgetTotal === null ? Infinity : …`. Gate 2 adopted `remaining() → null` because
`Infinity` is *"a confident wrong value of exactly the class this iteration exists to remove"*.
**`total === null` under a tokens-only budget is the identical class and identically undetectable** —
every script written against v25 reads `total === null` as "no budget". This is not a new proposal; it
is the conceded rule applied to the accessor next door, and leaving one of the pair fixed is worse
than fixing neither, because it teaches the reader that the API was audited.

Cheapest honest shape: `budget.limits: {usd: number | null; tokens: number | null}` as the one named
reader, `total` kept as an alias of `limits.usd`, and ARCH-121's honesty line extended by one clause
naming which accessor answers which limit.

### C-9 (HIGH) — the IPC budget wire is three fields, and one is missing on nested frames

`host.ts:52` `onBudgetSnapshot?: () => number`; `:103` `child.send({t:'start', …, budgetTotal})`;
`:109` `spent: this._config.onBudgetSnapshot?.()`; `child-entry.ts:20, 97-100`. ARCH-118 changes
`agentResult.spent` to `{usd, tokens}` — so the **start message's `budgetTotal` and the callback's
return type change with it**, and the script-visible object must be built from both. Meanwhile
`run-manager.ts:1023` passes `entry.guard.budgetView().total` into a nested frame whose host config
(`:1011-1022`) has **no `onBudgetSnapshot` at all**: `budget.spent()` reads 0 inside every
sub-workflow today, and will read `$0.00` after v26. Wire the callback on the nested host in the same
task — it is the missing half of a wire v26 is already editing, not new scope.

*(Ledger note for the synthesizer: `state.yaml.tech_stack` still calls the script-visible
`budget.spent()`/`remaining()` accessors "hard-coded stubs". Verified false at the top level —
`run-manager.ts:925` really supplies `onBudgetSnapshot`. The true residual caveat is exactly two
things: nested frames have no snapshot at all, and the values are live-not-resume-stable. ARCH's own
housekeeping note flags the first half of this; the nested-frame half is new here.)*

### C-10 (MEDIUM) — one constant behind the seed schema's prose and the validator's hint

I **hold ARCH-110's `required: ['path']`**: ajv is live (`call-tool.ts:23`, `validateArgs :66-67`), so
adding `contentB64` to `required` would make `INVALID_SEED_SPEC` unreachable and its new
`see: 'workflow_authoring_guide'` row dead on arrival. The narrow ask is the drift lock: the item
`description` string ("REQUIRED — base64 of the file bytes…") and the validator's `hint` render from
**one exported constant**, tested — the same rule ARCH-121 applies to the guide, applied to the schema
that teaches the same fact.

**Verified, and it sharpens issue #64:** `TOOL_SPECS.run_start.errors[]` (`tool-specs.ts:394`)
*already* lists `INVALID_SEED_SPEC` and `SEED_SOURCE_CONFLICT`, so ARCH-087's `Errors:` line has been
advertising a refusal the `seed` path never gave — the tool description was not silent, it was
**wrong**, which is a strictly worse starting point than #64 reports. What is genuinely missing is the
catalog row's `see:` (`errors.ts:112` is `see: null`, confirmed), which ARCH-110 fixes. The design
should say the `errors[]` entry needs **no** change, so nobody "adds" a duplicate.

### C-11 (MEDIUM) — three breaking changes in one release need one migration paragraph and a named answer ahead of ajv

`budget` number→object, `models_list.toolUse`→`toolUseDeclared`, `run_status.agents[].tokens`
two→four columns. The cross-repo row covers the plugin client; a human or third-party caller gets
nothing. Deliverables: one release-note line per break with the exact old→new; and — following the
existing precedent at `call-tool.ts:94-100`, where the retired inline-script door answers **ahead of
ajv** with a migration message — a `budget: <number>` argument gets a named answer stating the new
shape *and the unit change*, not a bare ajv type error. `INVALID_ARGUMENT` with no remedy is what
REQ-122 is about at the provider seam; the same standard applies at ours. This one is load-bearing
beyond politeness: a v25 caller sending `budget: 200000` must not be able to read the error as
"formatting" and re-send `{usd: 200000}`.

### C-16 (MEDIUM, NEW) — the zoom is built on a subtree a 3-second poll deletes; ARCH-120 never says where the transform lives

REQ-129 is the one REQ in this slice whose whole payload is *a human can read this*. ARCH-120 gives it
`viewBox` from `dagBox`, a `.zoomable` wrapper on both figures, wheel-zoom clamped 0.25–4, drag-pan and
a `fit` button. What it does not state is the one thing that decides whether any of it works.

**Verified at HEAD.** The dashboard is a full re-render on a timer: `setInterval(render, 3000)`
(`dashboard-page.ts:543`), and the DAG branch of `render()` is `renderGraph`, whose first act is
`svgEl.innerHTML=''` (`:391-393`). So:

- A transform applied to a `<g>` **inside** `#dag-graph` is destroyed on the next tick. A user zooms
  into a nine-agent run and the view snaps back within three seconds, forever.
- A CSS transform on the `.zoomable` **wrapper** survives the rebuild — but `dagBox` recomputes
  `width`/`height` as agents appear on a *running* run, so the `viewBox` changes underneath a held
  transform and the picture still moves under the cursor. Whether that recompute re-fits is an
  unstated decision.
- `#diagram-img` is stable by comparison (the author's SVG does not change mid-run), so the two
  figures need the *same* wrapper behaviour for *different* reasons — which is an argument for
  putting the state in the wrapper and saying so, not for two mechanisms.

**The ask, three sentences in 04-design:** (1) the pan/zoom transform lives on the `.zoomable`
wrapper, never on rebuilt SVG children, and `renderGraph` does not touch it; (2) a `viewBox`
recompute updates the drawing extent but **does not re-fit** — only the explicit `fit` button and a
`resize` return to identity; (3) `fit` computes from the current `dagBox`, so it is correct after the
run grows. This is ~3 lines of the ~40 ARCH-120 already budgets, and it is entirely inside the view
layer, so it touches no stored diagram (ARCH-120's own boundary).

**Acceptance,** because REQ-129's stated evidence cannot catch it: a Playwright screenshot taken
inside one poll interval passes on a zoom that is about to vanish. The assertion is *zoom → wait >3 s
→ the wrapper transform is unchanged and the agent count has grown*, added beside the existing
`val-018` readability shot rather than replacing it.

### C-14 (LOW) — nothing is gated any more; the tasks doc must reflect that

The prior draft of this file asked for two GATED tasks. Both rulings have since landed
(`eaf6546`), so:

- **`PRICE_UNKNOWN` gets a deletion task, not an implementation task** — no `ERROR_CATALOG` row, no
  `run_start.errors[]` entry, no guide sentence. Publishing then un-publishing an error code is worse
  than never publishing it, because `errors[]` is what a cold model reads to decide what to handle.
- **Trigger budgets are ruled OUT (option (b))**, so no schema change to `schedule_create` /
  `webhook_create`. What remains is **unconditional and must not be dropped**: `04-design.md:832`,
  `:1156` (D-V2h) and the overlap accepted risk are corrected to say *no such control exists, by
  owner ruling, and spend is tracked instead*. ADR-047 mandates this either way; schedule it early,
  because it is the one task with no code dependency and therefore the one that gets postponed.

*(One naming nit worth a line while the wire is open: `ErrEnvelope.detail` is
`Record<string, unknown>` (`types.ts:64`) while ARCH-111's `AgentRecord.detail` is a capped `string`.
Two fields named `detail` with different types on one MCP surface is a cold-model trap. Either name
the new one `errorDetail`, or state the distinction in both descriptions.)*

---

## 4. Self-sustainability

**Carried:** ARCH-116's TTL + single-flight + last-good, ARCH-118's stored `costUSD` and journal fold
(a restart cannot rewrite a run's spend), ADR-042's `--check-config`, and the `price_book` provenance
my r2 added.

### S-13 (HIGH, NEW) — pin in `RunManager.start()`, or the owner's mandatory tracking is hollow exactly where they meant it

ARCH-116 says the pin is taken at *"Admission (`run_start`)"*. `run_start` is an MCP tool handled in
`mcp-facade.ts`. Verified, all four starters:

| starter | call site |
|---|---|
| MCP `run_start` | `mcp-facade.ts:570` → `runManager.start({…})` |
| cron / once | `server.ts:870` → `.start({name, args, startedBy:{type:'schedule'}})` |
| resident scheduler | `scheduler.ts:313` → `.start({…, startedBy:{type:'schedule'}})` |
| webhook | `webhook-registry.ts:302` → `.start({…, startedBy:{type:'webhook', id}})` |

`RunManager.start()` (`:335`) is the single shared door, and the reachable-set expression the pin needs
is already inside it at `:498`
(`[effectiveParams.model, ...Object.values(effectiveParams.agents ?? {}).map(a => a.model)]`).

Implement the pin in the facade and every trigger-started run gets `price_book = null` ⇒ every call
`unpriced` ⇒ `costUSD: 0` ⇒ `meta.unpricedCalls = N`. That is not a crash; it is a plausible-looking
zero. And it lands on **exactly** the runs ADR-047's ruling is about: the owner accepted that
unattended runs have no ceiling *because* their spend would be recorded and reviewable afterwards.
Silent zeros there void the trade.

Design asks, all cheap: (a) the DES row names `RunManager.start()` and reuses the `:498` expression —
never a second derivation of "which models can this run reach", because INV-V26-4 is only as strong as
the set it pins over; (b) one integration test that a **schedule-fired** run has a non-null
`price_book` and a non-zero recorded `costUSD`; (c) `startedBy` is already on the run, so the
dashboard's spend column can group by it for free — one line, and the owner's "回頭調整" (go back and
adjust) has a place to happen.

### S-14 (MEDIUM, NEW) — the ruling's principle needs a NEGATIVE test

Owner's standing principle: *a budget is optional; absent means unbounded; **tracking is never
optional***. Every gate in the current code goes the other way — `run-manager.ts:840` folds only when
a budget exists, and the guard is the object that holds the totals. So the acceptance must include the
combination nothing currently exercises: **a run started with NO budget at all** shows four-column
tokens and a `costUSD` in `run_status.agents[]`, in `run_result.meta.usage`, and on the dashboard —
before and after a restart. Positive budget tests will all pass without this and the principle will
still be unimplemented.

### S-9 (HIGH) — the pin rides reads that already exist; the fold does not ride the budget gate

Three anchors, verified:

- **Admission already computes the reachable set** — `run-manager.ts:498` (above).
- **Resume already reads a pinned admission snapshot** — `run-manager.ts:834`
  (`storedParams ?? defaultRunParams(...)`, via `getParams`, `sqlite-run-store.ts:110`).
  `runs.price_book` is read back in that **same row read**, one rehydration site, so no path can reach
  dispatch holding a live catalog instead of the pin.
- **A pre-v26 row has no pin.** Define it explicitly: rates `null` ⇒ every call `costUSD: 0`,
  `unpriced: true`, never re-priced against today's catalog — the same rule ARCH-118 already sets for
  legacy two-column usage events, now stated for the row as well as the event.

And the gating split from O-11 belongs here too: `:840-844` is right for the guard and wrong for the
run's own spend total.

### S-10 (MEDIUM) — "never fetched" and "six hours stale" need different words, and the ruling makes this *more* necessary, not less

`price_book.source ∈ {'live','last-good','static'}` cannot express *the catalog has been unreachable
since this process started*. Under ADR-038-as-written that state produced a visible refusal, so the
missing word was a nicety. **Under the ruling it produces a run that reports `$0.00` and looks
finished** — the operator's only clue is `unpricedCalls`, which does not distinguish "OpenRouter is
down" from "this model genuinely is not in the catalog". Those need different human actions (wait vs
add a price row). Add `'unavailable'`. One string, no new mechanism, and it is what keeps the fallback
auditable now that the loud path is gone.

### S-11 (MEDIUM) — `configCheck` needs a reader, or it is a value in a file nobody opens

Verified: `write_result` (`deploy/rwe-update.sh:39-60`) writes a FIXED four-key JSON
`{tag, status, ts, detail}` via `printf`; the engine ingests `updateResultPath` (`server.ts:157`,
`main.ts:217`); the dashboard renders `lastUpdate` as an `UpdateOutcome` (`dashboard-page.ts:57-65`).
ADR-042's `configCheck: 'passed' | 'skipped' | 'failed'` therefore touches **four things that must
move together**: the `printf` shape, the `UpdateOutcome` type, the ingestion, and the banner. Ship
three of four and `'skipped'` becomes a value nothing displays — my own D3 condition, applied to the
deployment path instead of the run page. It matters most for `'skipped'`, which is the **silent**
outcome by construction and the only one that lets a stale `gpt41*` row reach a boot refusal.

### S-12 (LOW→MEDIUM, agent altitude) — tool-liveness is answered by ARCH-111; claim it

This dimension's agent half asks for "probe that the API still works". v26 builds the **reactive**
form and should say so in 04-design rather than leave Gate 8 to read the dimension as unaddressed:
`classifyApiError` recognises *cannot succeed*, the `finally` abort kills the CLI's remaining nine
retries, and the `RunGuard` slot plus host `AgentSemaphore` are released in seconds instead of
`timeoutMs × (1 + retries)` — on a 24-wide `parallel()` that is the difference between a degraded run
and a dead host. The **proactive** form (#73's weekly OpenRouter probe) is deferred by owner ruling;
`declaredSource` + `catalogFetchedAt` are the seam it will attach to, and v26 is right to decline a
per-row `declaredAt` that pre-shapes it. One paragraph, plus the Gate 7.5 `ps` observation ADR-040
already calls the only real evidence that the subprocess is actually gone.

---

## Task-splitting obligations (for the synthesizer; v26 starts at TASK-170 / DES-170)

`03-tasks.md` exists and ends at TASK-169 / DES-169. Task boundaries decide whether three of the four
dimensions survive. This block is written to be lifted:

1. **One task: the AgentRecord surface.** New fields (`phase`, `phaseIndex`, `transport`,
   `proxyModel`, `detail`, four-column `tokens`, `costUSD`, `unpriced`) **+** `deriveAgentRecords`
   all three branches **+** `startedAt`/`endedAt` from event `ts` **+** the dashboard cell. Split it
   and the fields are written by one task and dropped by the next until someone notices in
   production.
2. **One task: the four-column `Tokens` type across every site** — usage event, `foldUsage`,
   `RunGuard.setSpent`/`addUsage`, IPC `spent` and `budgetTotal`, `child-entry` budget object,
   `dashboard.ts:56`, `dashboard-page.ts:359`. A partial rollout does not fail to compile; it renders
   `[object Object] tok`.
3. **One task: `run_result.meta`** — envelope type + `foldUsage` at read time (ungated by budget) +
   `outputSchema` + the dashboard reader. (b) without (c) is an undiscoverable feature; (a) without
   (b) is a field that empties on restart.
4. **One task: the money pin** — `ModelBook` + the pin taken in `RunManager.start()` + `price_book`
   column + rehydration in the existing `getParams` row read + `meta.budgetEnforceable` (C-13) +
   the schedule-fired integration test (S-13). The pin and its non-`run_start` callers cannot be
   separate tasks; that separation IS the bug.
5. **One task: the updater result** — `printf` shape + `UpdateOutcome` + ingestion + banner, together
   with the `--check-config` entry point and the DEPLOY.md numbered step.
6. **Each drift-lock test lives in the task that creates the constant it locks**
   (`SANDBOX_GLOBALS` ↔ `createSandboxContext`, `DETERMINISM_GUARDED` ↔ the real vm throw,
   `PROVIDER_CAPS` totality, the seed description ↔ hint constant, `docs/AUTHORING.md` ↔ builder).
   A lock landing one task later is green against the wrong baseline.
7. **Deletion before table-widening, or the grep guard is meaningless.** `no-retired-surface` is RED
   until the `openai`/`gemini` deletion lands; the `PROVIDER_CAPS` totality test (R-10) must land
   *with* the table. Sequenced the other way there is a window where two provider vocabularies
   disagree.
8. **A `PRICE_UNKNOWN` DELETION item, not an implementation item** (O-15/C-14) — seven named lines in
   02-architecture.md, restated once and correctly in 04-design.md, and nothing added to
   `ERROR_CATALOG` or `run_start.errors[]`.
9. **The ADR-047 ledger amendment is unconditional and has no code dependency** — `04-design.md:832`,
   `:1156` (D-V2h) and the overlap accepted risk. Schedule it FIRST so it cannot be the thing that
   gets dropped when the iteration runs long. A design row asserting a control that does not exist,
   with an accepted risk leaning on it, is ADR-046's class in the ledger instead of the code.
10. **One task: the refusal vocabulary (C-15), and it must land BEFORE the ARCH-121 drift-lock is
    written.** The `rule → ErrorCode` map + the `never` check + the catalog rows + `expected` in the
    detail object at `workflow-catalog.ts:495` are one unit — a map without the rows compiles and
    refuses on a code with no `see:`, and rows without the map are unreachable. Order matters against
    obligation 6: a drift-lock authored while the four names are still rule strings is minted blind
    against a vocabulary it cannot see, reports green, and is never revisited. If the panel takes
    C-15's option (b) instead, this task becomes *rewrite one hint + amend REQ-128* and still lands
    before the lock.

---

## risks

- **QD-R0 (HIGH)** — 04-design descends from ARCH-118's api line rather than from REQ-127-as-amended,
  and `PRICE_UNKNOWN` gets implemented after being overruled — or, subtler, `costUSD: null` ships and
  every downstream `?? 0` re-creates the silent zero without the `unpriced` flag beside it.
  *Mitigation:* O-15's table, obligation 8, and one statement of the corrected rule in 04-design that
  every DES row cites.
- **QD-R1 (HIGH)** — Partial four-column rollout. `tsc` catches neither failure mode: a cell left as
  `number` silently drops both cache columns; a widened cell concatenates as `[object Object]`.
  *Mitigation:* obligation 2 + one page-source assertion + one four-column fixture rendered
  end-to-end.
- **QD-R2 (HIGH)** — REQ-124's "zero warnings on existing runs" passes on the owner's ~30 terminal
  snapshots and fails on any interrupted run reconstructed by `deriveAgentRecords`, which has no
  `startedAt` for `inferPhase` to join on. *Mitigation:* O-9, plus a fixture that is a
  transcript-only (snapshot-less) run.
- **QD-R3 (HIGH)** — The `meta` counters live only in process memory (`GatewayResult.unmapped`,
  `RunGuard._unpriced`), so a restart empties exactly the observability v26 added. *Mitigation:*
  O-12 — journal the capped subtype; derive `unpricedCalls` from the stored per-call flag.
- **QD-R4 (HIGH)** — The pin is installed in the `run_start` facade and trigger-started runs report
  `$0.00` spend that looks like a real number. *Mitigation:* S-13 + the schedule-fired test in
  obligation 4.
- **QD-R5 (MEDIUM)** — Two price derivations (`maxPricePerMOf` string-parse vs `FourRates`) diverge,
  so the catalog filter and the spend meter disagree about the same model. *Mitigation:* R-8.
- **QD-R6 (MEDIUM)** — Nested-frame blind spots ship as-is: `phase()` silently dropped,
  `budget.spent()` permanently `$0.00` inside every sub-workflow. *Mitigation:* O-14 + C-9, both one
  line at `run-manager.ts:1011`.
- **QD-R7 (MEDIUM)** — A caller sets `budget.usd`; it binds late (mixed reachable set) or never
  (all-unpriced set), and nobody learns until an invoice does the telling. *Mitigation:* C-13 — the
  mitigation is information, not enforcement, so it does not reopen the owner's ruling.
- **QD-R8 (LOW)** — Seed schema prose and validator hint drift apart, so `tools/list` says REQUIRED
  and the refusal says something else. *Mitigation:* C-10's shared constant.
- **QD-R9 (LOW)** — `configCheck: 'skipped'` ships without a reader and the deployment's only
  fail-open path stays invisible. *Mitigation:* S-11 / obligation 5.
- **QD-R10 (LOW)** — Guide growth: ARCH-121 adds five sections and REQ-130 (d)'s alias table to a
  response a cold client already receives whole; v24 flagged the same unbudgeted context cost.
  *Mitigation:* one byte-size assertion on `buildGuide()` output, and the alias table generated (not
  hand-enumerated).
- **QD-R11 (HIGH)** — The v2 checker ships, all four rules collapse to `MERMAID_INVALID`, and the
  cold model at Gate 7.5 is told its diagram "does not parse" when it parses fine. The
  `ERROR_CATALOG` drift-lock is green throughout, because rule strings are not in `ErrorCode`, so
  nothing signals the gap until the REQ-117 probe fails and is misread as an authoring error.
  *Mitigation:* C-15 + obligation 10, sequenced before the lock is written.
- **QD-R12 (MEDIUM)** — Zoom/pan ships on a subtree `renderGraph` deletes every 3 s, passes its
  screenshot acceptance, and is discovered unusable by the owner on the next cold run — the same
  route by which #69 and #70 reached this iteration in the first place. *Mitigation:* C-16's three
  design sentences and the zoom → wait → transform-unchanged assertion.

---

## expected disagreements with other lenses

- **Adversarial / Karpathy on C-13 (`warnings[]` + `meta.budgetEnforceable`)** — "the owner overruled
  the refusal; adding a warning re-litigates it, and it is a new field on the response envelope."
  My answer: the ruling struck *stopping the run*, which C-13 does not do. What the ruling cannot have
  intended is the outcome REQ-127 names in its own text and forbids — a budget that quietly does not
  bind. I have stated the mechanism precisely so it cannot be discounted on an overstatement: the
  mixed case binds LATE, the all-unpriced case binds NEVER, both silently. Every value in
  `meta.budgetEnforceable` is already computed for the pin, and if the panel takes only one part I
  will settle for that field alone, because it is the half that survives a restart. What I will not
  concede is shipping a USD budget that silently under-counts real money with no field saying so.
- **Adversarial (testability/simplicity) on O-10 (journal the refusal)** — "a new write path inside a
  slice whose ten REQs never ask for one." My answer: v25 minted the `refused` record *because* an
  invisible refusal cost every branch past the second of a `parallel()`; a projection that drops it on
  restart is ADR-046's class, found at the design gate, which is the cheapest place it is ever fixed.
  If they refuse the write, I will settle for the cohort limit written into ARCH-114 and REQ-124's
  acceptance — but not for silence.
- **Karpathy simplicity on C-8 (`budget.limits`)** — "a fourth accessor on a read-only view." My
  answer: it *replaces* an ambiguity rather than adding a feature; the alternative is a guide sentence
  apologising for two different `null`s, and Gate 2 already rejected that trade once, for
  `remaining()`. Fixing one of a matched pair is worse than fixing neither.
- **Adversarial on O-14 (nested `onPhase`)** — "behaviour change beyond REQ-124." My answer:
  ARCH-114's own cohort rule is unreachable code without it. I accept the documented-no-op option (b)
  as an equal outcome; what I will not accept is shipping the architecture's sentence and the tree's
  silence together.
- **Security on O-11 / O-13** — "a new field on the result envelope and a cost column on an
  unauthenticated dashboard route." My answer: every value there is engine-authored arithmetic
  (integers, one float, one boolean); the single provider-authored string (`detail`) is
  redacted-then-capped and swept per INV-V26-5, and `dashboard.ts`'s route already returns the whole
  run view.
- **Scalability/consistency on S-13** — I expect agreement, and I expect them to have found it
  independently: pinning inside `start()` is strictly cheaper than a second derivation plus a second
  read, and it is the only site all four starters share.
- **Testability on C-11** — "a release note is not a test." Agreed, and I am not asking for one: the
  testable half is the migration-message assertion (the `call-tool.ts:94-100` precedent) plus the
  fixture-backed `Errors:` line. The release note is the human half, one line per break.
- **Karpathy simplicity on C-15 (four new `ErrorCode`s for one checker)** — "five catalog rows and a
  map to replace a working ternary; keep one code and put the rule in the message." My answer: the
  alternative to the map is not the ternary, it is a catalog hint that *lies* to a cold model — and
  REQ-116/117 make a cold model's first-try failure a documentation defect by ruling, so a false hint
  is a defect by this ledger's own definition, not a preference. I will take option (b) without
  argument **provided REQ-128 is amended in the same breath and the hint is rewritten to be true for
  every non-label rule**; what I will not accept is (b) reached by inheritance while REQ-128's text still
  promises four `see:`-bearing codes. Note also that (a) is what makes ARCH-121's drift-lock honest,
  which is a testability argument the adversarial group owns, not mine.
- **Adversarial (testability) on C-16's assertion** — "a >3 s wait in an acceptance test is a flaky
  sleep." Agreed that it is the weakest kind of test; it is also the only kind that can observe a
  timer-driven reset, and the poll interval is a constant in the page, not a race. If they prefer, the
  same property is assertable in a unit test by calling `renderGraph` twice and checking the wrapper's
  transform is untouched — I will take either, but not neither, because the screenshot REQ-129 names
  cannot see this at all.
- **Anyone on R-10's totality test** — "the grep guard is enough." It proves the old names are gone;
  it says nothing about whether the surviving table is total over the three. Those are different
  properties, and ADR-041's headline claim is the second one.
