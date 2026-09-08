---
stage: design
lens: quality-dimensions
iteration: v26
round: 2 (response + final position)
reads: "adversarial.r1.md (DES-170..186, its 18-row task partition, R1..R12, its ten internal tie-breaks); quality-dimensions.r1.md (my O-9..O-14 / R-8..R-11 / C-8..C-12 / S-9..S-12); HEAD source re-verified at every point I hold"
---
# Quality-dimensions — round 2 (Observability / Replaceability / Consumability / Self-sustainability)

## summary

The adversarial round-1 proposal is stronger than mine on eight of the fourteen items where we
overlap, and I concede all eight below **by number**, including the two it flagged as
"synthesizer call" (its R8 and R9) — those are now arbitrated and the synthesizer does not have to
rule on them. What survives is small and almost entirely *verified holes in DES-170..186 as written*
rather than re-argument: **seven holds and three new findings**, all re-checked against HEAD this
round. Two of the new ones are defects in the adversarial design itself (a pin-less-run `TypeError`
on the first resume after the upgrade, and a re-pointed price function with nothing to read).

The single highest-value item this round is **the budget gate at `run-manager.ts:840`**. DES-179
sources `RunStatusView.usage` from the live guard and saves `RunDagSnapshot.usage` at terminal;
the guard is hydrated from the journal only `if (spec.budget !== null && spec.budget !== undefined)`.
So an **unbudgeted resumed run** — the common case — reports zero usage in `run_status.usage`, zero
in `run_result.meta.usage`, and **persists the zero into the terminal snapshot**. The fix is deleting
one `if`. The `usage-live-equals-fold` IT as designed (a completed run in one process) cannot catch
it, and a *budgeted* resumed run passes through the gate and goes green — so the IT must name an
**unbudgeted resumed** run explicitly.

This round is deliberately shorter than my r1. Where DES-17x already carries a finding, I say
"converged" and stop.

---

## A. Concessions — I drop my version and adopt theirs

| my r1 item | their item | verdict | engineering reason |
|---|---|---|---|
| **C-8** `budget.limits:{usd,tokens}` | DES-179 `Budget.tokens(): Tokens & {total,limit}` | **concede** | Their accessor carries spend *and* limit in one call and is already threaded through the four-column work; `total===null && tokens().limit!==null` disambiguates "tokens-only" from "unbounded", and their `sandbox-budget-api.test.ts` already pins it. A fourth accessor to re-say it is the feature I accused them of. **Held residue:** one guide clause (§3). |
| **O-12** journal the unmapped subtype | DES-179 usage event carries `unmapped`; `foldUsage` folds it | **concede — converged** | My ask was "a counter that dies with the process is not observability". Their usage-event shape meets it exactly. |
| **O-12 corollary** derive `unpricedCalls`, don't keep a live counter | DES-179 two producers + `usage-live-equals-fold` IT (their tie-break 10) | **concede** | An asserted equality between two producers is a stronger lock than my "one derivation rule", and the live path genuinely must not re-read transcripts per poll. **Held residue:** the IT's cohort (§B-1). |
| **R-9** `toolUse` renames IN and OUT | DES-178 | **converged** | Same finding, independently reached. No dispute. |
| **R-10** runtime totality test over provider-keyed sites | DES-172 `never` switches + `AliasMap` narrowed to `Record<string,{provider:Provider,…}>` | **concede** | I checked the one site I thought a `never` switch could not reach: `default-aliases.ts:15` is typed `AliasMap`, so the narrowing makes it a *compile-time* error. Compile-time totality beats my runtime loop. Drop my extra test. |
| **their R8** — `catalogFetchedAt` per row vs a wrapper object | DES-178 per-row | **concede, arbitrated** | Consumability is measured in caller breakage, not payload bytes. A wrapper breaks the dashboard models panel, `models-list-tool.test.ts`, VAL-087 and the plugin's schema notes to dedupe ~24 bytes/row. Per-row, and the *deviation, property preserved* label is correct. |
| **their R9** — `tools: default` literal vs skip-entirely (my D7) | DES-181 literal word | **concede, arbitrated** | The comparison is one string equality against a constant the guide already renders; it closes the T4 at zero consumability cost. My D7 argued against *comparing a resolved list*, which the literal does not do. Record no accepted risk — I am not holding. |
| **S-10** add `'unavailable'` to `price_book.source` | DES-177's existing three values | **concede** | Re-reading DES-177's fallback chain, `'static'` already *means* "no live fetch has ever succeeded in this process" and `'last-good'` means "fetched, now stale" — the two operator actions I wanted distinguished already are. **Held residue:** one sentence, §4. |
| **anticipated:** `PRICE_UNKNOWN` carries a retry-after | — | **I never asked; declining pre-emptively** | Agreed with their reasoning: a retry hint encodes the TTL in a user-facing string (T4 on the next change). `source` + `fetchedAt` is the right amount. |
| **anticipated:** count the benign SDK subtypes too | DES-171 `BENIGN_SYSTEM_SUBTYPES` + empty-on-healthy fixture | **agree, not a disagreement** | My D1/D3 condition was "a named counter with a reader". A counter non-zero on every healthy run has no reader in practice — their behavioural lock is the right shape. **One cheap integration:** record the installed SDK version in the healthy-fixture header comment, so a bump that adds a subtype is diagnosable in one line instead of bisected. |

---

## B. Holds — each is a verified hole in DES-170..186 as written

### B-1 (HIGH, observability) — delete the budget gate at `run-manager.ts:840`, and make the equality IT cover an *unbudgeted resumed* run
**Verified on HEAD** (`run-manager.ts:837-845`):
```
const guard = new RunGuard({ concurrency: this._concurrency, budget: spec.budget ?? null });
if (spec.budget !== null && spec.budget !== undefined) {
  … guard.setSpent(sumUsageTokens(allEvents));
}
```
DES-179 makes the guard the **live producer of `RunStatusView.usage`** and saves
`RunDagSnapshot.usage` at terminal. The gate was written for DES-068's purpose — hydrate spend so the
*budget cap* enforces correctly on resume — and that purpose no longer describes what the guard's
usage is for. Consequence after v26, in three steps: an unbudgeted run is interrupted → resumed →
the fold is skipped → `run_status.usage` is zero, `run_result.meta.usage` is zero, **and the zero is
persisted into the terminal snapshot**. That is not a transient poll artifact; it is a wrong number at
rest, which is the class ADR-046 exists to close. Fix: **delete the `if`** (the fold is pure and
never throws; `setUsage(fold)` runs unconditionally). Test condition: `usage-live-equals-fold` as
written is a completed run in one process and cannot see this, and a *budgeted* resumed run passes
through the gate and goes green — the IT must add **one unbudgeted, resumed** case. And the design
must **name which producer writes `RunDagSnapshot.usage`**; if it is the guard, this deletion is
load-bearing for stored data, not for a view. Pre-empting the obvious objection — *"that adds a
full transcript read to every unbudgeted resume"* — the **budgeted** path already performs exactly
that read at `:841-843`, an unbudgeted run's journal is no larger, and the fold is pure and never
throws.

### B-2 (HIGH, observability) — the derive path drops v26's *optional* fields, and no drift lock can catch it
**DES-175 converges with my O-9** on the part that matters most: it names the real function
(`deriveAgentRecords`, against ARCH-114's non-existent `buildRecordsFromTranscript`) and sets
`startedAt` from the harness event's `ts`. I concede that half; my "three sites, not two" quibble is
answered by `harnessAny` being computed above the `if (usage)`.

What remains is not covered by any DES: `costUSD`, `transport`, `proxyModel` and `detail` are
**optional** fields on `AgentRecord`, and `tsc` therefore says nothing when the derive path's three
object literals omit them. Only `tokens` is caught, because widening it to a four-field required type
is a compile error. And **DES-186's `EXPECTED_AGENT_RECORD_KEYS` is a superset pin — it is satisfied
by a record carrying none of them**, so it structurally cannot catch omission; the adversarial's own
claim that it catches "I forgot to persist `transport`" holds only against a fixture that already
asserts presence. DES-176 puts all four fields *on the usage event*, so the data is in the journal —
the reader is what is missing. **Ask:** task 11 gains "`deriveAgentRecords` reads `costUSD`,
`transport`, `proxyModel`, `detail` from the usage event", plus **one presence assertion on a
transcript-only (snapshot-less) run fixture**. That fixture is also QD-R2's mitigation.

### B-3 (HIGH, observability) — a `refused` record still does not survive a restart; DES-175's own cohort sentence is false
**Verified:** `markRefused` (`agent-executor.ts:222-228`) writes only the in-process `_records` map —
no transcript event — and `deriveAgentRecords` omits any agent with neither a usage nor a harness
event (`run-store.ts:31-63`). DES-175's boundary states cohort (i) as *"v26 runs exact (incl.
`refused` records — `markQueued` precedes `assertBudget`)"*. That is true in-process and in the
**terminal snapshot**, and **false for any interrupted run reconstructed by `deriveAgentRecords`** —
which is precisely the run a reader consults a DAG for. This is not "QD wants one more write path":
it is the design's own sentence describing behaviour the tree does not have.

Two acceptable fixes; silence is the third and it is what we have today.
- **(a), my preference — journal it.** `TranscriptEvent.kind` gains `'refused'`
  (`types.ts:364`, a closed five-member union today) with
  `data: {reasonCode, label?, frame?, phase?, phaseIndex?}`. **The cost is concrete, and I checked
  it:** two call sites need a decision — `run-store.ts:31` (a new terminal branch) and
  `run-store.ts:74`/`foldUsage` (skip; it already skips non-`usage`, and a refusal has no usage to
  fold) — plus the signature: the journal is per-run, so `runId` is threaded into **both**
  `markRefused` definitions (`agent-executor.ts:222`, the in-process sink; `:527`, the
  `AgentExecutor` delegate — and it is the delegate that holds `store`, so that is where the write
  goes), from a caller that already has it. Two sites then handle it for free: `mcp-facade.ts:661`
  puts it in the `nonHarness` list
  `workflow_agent_log` already renders, and `server.ts:788`'s tail is generic. Adding a union member
  is `tsc`-visible, which is the property my r1 asked for and a `data`-marker on `kind:'usage'` would
  not have. Every field is **engine-authored** (an `ErrorCode`, a label, a frame path, a phase title),
  so the security objection to a new persisted event does not apply here — one clause, not a debate.
- **(b) fallback I accept** — DES-175's cohort sentence is corrected to exclude `refused`/`queued`
  records on the derive path, and REQ-124's acceptance says so out loud.

v25 minted this record *because* an invisible refusal cost every branch past the second of a
`parallel()` (issue #61). Re-losing it on restart is ADR-046's class, caught at the design gate,
which is the cheapest place it can be caught.

### B-4 (HIGH, observability) — the dashboard drops 99% of a cached call's tokens, and `tsc` is silent
**Verified:** `DagAgentNode.tokens: number` (`dashboard.ts:22`) is filled by
`tokens: a.tokens.input + a.tokens.output` (`dashboard.ts:56`) and rendered by
`(a.tokens||0)+' tok'` (`dashboard-page.ts:359`). After `Tokens` widens, **that expression still
compiles** and silently drops both cache columns. On the Gate 1 haiku sample
(`input 18 / cache_creation 20,762 / cache_read 19,522 / output 282`) the cell renders **`300 tok`
against a true `40,584`** — a 99.3% under-report on the page REQ-127 exists to make honest. This
site is in no DES and no task row (task 15 is `dagBox`/`viewBox`/`.zoomable`/the harness table).

**Minimal fix, deliberately not the widening:** `tokens: sumTokens(a.tokens)` — the function DES-179
already exports — leaving `DagAgentNode.tokens: number` and the renderer untouched. Widening the cell
to the object is the path that makes `dashboard-page.ts:359` render `[object Object] tok`, because
string concatenation of an object is legal in the browser and in TypeScript; I am not asking for it.
Separately, `DagAgentNode` gains `costUSD?: number | null` **rendered three-valued** — `0` = never
dispatched (a `refused` call: truly zero), `null` = dispatched but unpriceable, a number = priced.
Collapsing `null` to `0` re-introduces the silent default one layer above where ADR-046 removed it.
One page-source assertion covers both.

### B-5 (MEDIUM, observability + consumability) — the nested `SandboxHost` is missing two callbacks, in a constructor two DES items already edit
**Verified** (`run-manager.ts:1011-1021`): the nested host is constructed with `workspaceRoot`,
`onAgentRequest`, `onWorkflowRequest` — **and nothing else**. The top-level `_newSandbox`
(`:915-925`) passes `onPhase` and `onBudgetSnapshot`. Two consequences:

- **`onPhase` (my O-14).** `host.ts:139` is `this._config.onPhase?.(msg.title)`, so a `phase()` inside
  a `workflow()` is discarded **silently**. DES-175 supplies `currentPhase` to both hosts — that is
  the *read* side, and it correctly makes a nested frame with no `phase()` inherit the parent's lane
  (E2E-010). The *write* side is still absent, so a nested frame that **does** call `phase()` gets
  nothing: the title never reaches `entry.phases`, and `currentPhase` keeps returning the parent's.
  ARCH-114's own cohort rule ("`k >= lanes.length` — nested frames pushing onto the parent timeline —
  appends a lane WITH a warning") is unreachable code without it. **Consequence I state up front so
  it is not a surprise:** once wired, the parent's later agents inherit the nested `'X'` until the
  parent's next `phase()` — that *is* what REQ-124's "nested frames share the same phase timeline"
  means, and ARCH-114 already warns on it. E2E-010 gains a second case (a nested frame that *does*
  call `phase()`). **Fallback I still accept:** leave it unwired and say "`phase()` inside a nested
  `workflow()` is a no-op" in the guide (ARCH-121 (b)) plus a registration-time warning. Silence is
  the only option I refuse.
- **`onBudgetSnapshot` (my C-9).** `host.ts:109` sends `spent: this._config.onBudgetSnapshot?.()`, so
  with no callback the field is absent and `child-entry.ts`'s `budget.spent()` reads `0` in every
  sub-workflow — **for ever**, not as a lag. After REQ-127 that is a money meter reading `$0.00`
  inside every nested frame. DES-179 names `run-manager.ts:925/956/1023`, but `:1023` is the
  `nested.run(…, budgetView().total)` **argument**, not the host **config** at `:1011`. One line, in
  a constructor DES-179 is already editing for `start.budget`.

### B-6 (MEDIUM, replaceability) — one numeric price, or the catalog filter and the spend meter answer differently
**Verified:** `maxPricePerMOf` (`model-catalog.ts:250-258`) extracts a number from the **display
string** with `/\$([0-9.]+)\/1M/`; `computeCostLevel` (`:272`) rides it and `filterCatalog:311` rides
that for the `maxPricePerM` filter. DES-177 makes numeric `ratesPerM` primary and the display string
**derived** (`displayPrice(rates)`). Left alone, the filter becomes `parse(display(rates))` — a round
trip through a formatted string, in the same iteration ADR-045 deleted the twin-derivation defect for
effort. The failure is silent and one-directional: any format `displayPrice` produces that the regex
does not match (scientific notation for a sub-cent rate, a thousands separator, a second decimal
group) yields `null`, and `null` **excludes** the model from a `maxPricePerM` filter — a model
disappears from `models_list` because of a formatting choice.

**Sharpened this round (this is a signature requirement, not just "re-point the function"):**
`filterCatalog` and `computeCostLevel` run over `snapshot().entries: ModelEntry[]`, **not** over
`lookup()`, and DES-177 puts `FourRates` on `BookEntry` (the pin) — so `ModelEntry` must itself carry
the numeric rates or the re-pointed function has nothing to read. Ask:
`ModelEntry` gains `ratesPerM: FourRates | null`; `maxPricePerMOf(rates: FourRates | null): number | null`;
the `"$5/1M"` string is human-facing only; and the design **states that the scalar stays `max(in,out)`
and therefore ignores the two cache rates** — true today by accident, a decision now that four exist.

### B-7 (MEDIUM, self-sustainability) — `configCheck` needs its four moving parts in one task, or `skipped` is a value nothing displays
DES-172 / task 13 stop at `write_result` gaining a `configCheck` field and VAL-078 asserting the
order. **Verified**, the reader half is four things that must move together: the fixed four-key
`printf` in `write_result` (`deploy/rwe-update.sh:39-60`), the `UpdateOutcome` type, the ingestion
(`server.ts:157`, `main.ts:217`) and the dashboard banner (`dashboard-page.ts:57-65`). Ship three of
four and `configCheck:'skipped'` — the **silent** outcome by construction, the one that says the
deployment's only fail-open path was taken — becomes a string in a JSON file nobody opens. This is my
own D3 condition applied to the deployment path rather than the run page, and it is one sub-bullet on
task 13, not a new task.

---

## C. New this round — two defects in DES-179/177 as written, one sequencing sentence

**C-1 (HIGH, self-sustainability) — nothing says what a pin-less run prices against, and all three
readings of the silence are wrong.**
DES-177 types `AgentExecutorDeps.priceBook` as present while `getSpec` returns
`priceBook?: PinnedBook` and its own `sqlite-run-store.test.ts` case says a pre-v26 row reads
`priceBook: undefined`. So resume must pass *something* to the executor and the design does not say
what. `spec.priceBook!` with DES-179's `pin.pinned[…]?.price` — the `?.` guards the *entry*, not the
*pin* — is a `TypeError` on the first dispatch of every run resumed across the upgrade;
`?? staticBook` silently re-prices a legacy run against today's catalog, which is the exact thing
INV-V26-4 forbids; only an explicit rule is correct. My r1's S-9 predicted a missing price here; the
real exposure is that the missing case is unspecified.
DES-178 handles the absent pin for **caps** ("absent pin → `caps` undefined → the fail-safe branch")
and nobody handles it for **price**. Fix, one line and one boundary sentence:
`pin?.pinned[…]?.price ?? null`, and **a pin-less run prices every call `costUSD: null` and is never
re-priced against today's catalog** — the same rule ARCH-118 already sets for two-column legacy usage
events. One `parseBudget`-style row in `price-call.test.ts`.

**C-2 (MEDIUM, self-sustainability) — `reachableModels` must be the *extraction* of `run-manager.ts:498`, not a second derivation.**
DES-177 introduces `reachableModels(effectiveParams)` (`{model} ∪ agents[*].model`). Admission
already computes exactly that set at `run-manager.ts:498`
(`modelsToCheck = [effectiveParams.model, ...Object.values(effectiveParams.agents ?? {}).map((a) => a.model)]`) for its existing
alias check. If the pin derives the set a second time, INV-V26-4 pins over a set that can differ from
the one admission validated — and the divergence appears only when the two expressions drift, i.e.
in a later iteration, silently. Ask: one sentence in DES-177 saying `reachableModels` **is** `:498`
refactored, with `:498` re-pointed at it in the same task.

**C-3 (LOW, consumability) — `budget: <number>` deserves the migration answer, not ajv's.**
DES-179 refuses a bare number with a schema `description` that explains why. A description is not an
error message: ajv answers a type mismatch with `INVALID_ARGUMENT: budget must be object` and the
caller never sees the description. **The precedent is in the same file** — `call-tool.ts:103-105`
answers the retired inline `script` key with `INLINE_SCRIPT_CLOSED` *ahead of ajv*, for exactly this
reason ("technically true and completely useless"). Ask: `run_start` with a numeric `budget` gets a
named answer stating the old meaning (tokens), the new shape and the unit. One `if`, beside the one
already there, no new error code needed if `INVALID_ARGUMENT` carries the message.

---

## 1. Observability — final position

Transparency of internal state, traceability folded in. The question v26 must answer from the
**persisted** record — because the box restarts on every release — is *"which of the three provider
paths broke, what did it cost, and in which phase"*.

- **Held:** B-1 (the `:840` gate — the only item where a wrong number reaches *storage*), B-2 (the
  derive path drops the optional v26 fields; no superset pin can catch it), B-3 (a `refused` record
  still dies on restart; fix the write or fix DES-175's sentence), B-4 (the DAG cell under-reports a
  cached call by 99.3% and `tsc` is silent), B-5's `onPhase` half.
- **Conceded:** O-12 and its corollary — DES-179's usage-event `unmapped` + the two-producer equality
  IT are what I asked for, in a better shape.
- **Converged:** DES-175 names `deriveAgentRecords` and derives `startedAt` — ARCH-114's phantom
  `buildRecordsFromTranscript` is dead; DES-171's benign set with an empty-on-healthy fixture is the
  right answer to "a counter that means something".
- **Agent altitude, answered:** chain-of-thought is out of scope by owner ruling, but token usage
  (four columns), tool-call sequence (the transcript) and the dispatch decision (`effortApplied`,
  `transport`, `proxyModel`, `detail`) are all inspectable per call and all persisted. The one
  remaining black box after v26 is a refused call on an interrupted run — B-3.

## 2. Replaceability — final position

Decoupling and pluggability; no single-vendor lock-in.

- **Held:** B-6 (one numeric price derivation, and `ModelEntry` must carry the rates for the
  re-pointed function to read).
- **Conceded:** R-10 in full — DES-172's `never` switches plus the narrowed `AliasMap` make provider
  totality a **compile-time** property, which is strictly better than the runtime test I proposed;
  `default-aliases.ts:15` is covered by the narrowing, which was my one counter-example.
- **Converged:** R-9 (`toolUse` renamed IN and OUT — same finding, independently); ADR-041's
  three-provider table with one `PROVIDER_CAPS`.
- **Held, small (R-11):** v26 narrows five provider paths to three, which is a real reduction in this
  dimension. The compensating facts — OpenRouter is the many-model front door, so *swap the model*
  stays a config change; two `GatewayClient` implementations behind one interface keep *swap the
  transport* a config change — are recorded in ADR-041 for the ledger. DES-184 (d)'s alias table
  should say it to the **caller** in one sentence, so "why is there no `openai` row" has a published
  answer rather than a removed one.

## 3. Consumability — final position

Interface friendliness; the caller's learning and integration cost. At agent altitude the refusal
envelope and the description **are** the API.

- **Held:** B-5's `onBudgetSnapshot` half (a `budget.spent()` that reads `$0.00` in every nested
  frame is a lying interface, not a missing feature); C-3 (the migration answer ahead of ajv, with
  the `call-tool.ts` precedent); C-10 unchanged and narrow — the seed item `description` and the
  validator `hint` render from **one exported constant**, `required:['path']` stays (adding
  `contentB64` would make `INVALID_SEED_SPEC` unreachable behind live ajv), and
  `TOOL_SPECS.run_start.errors[]` **already** lists `INVALID_SEED_SPEC`/`SEED_SOURCE_CONFLICT`
  (`tool-specs.ts:394`) so nobody should "add" a duplicate — only `errors.ts:112`'s `see: null` needs
  the fix ARCH-110 specifies.
- **Conceded:** C-8 → DES-179's `Budget.tokens()`. **Residue, one clause:** ARCH-121's honesty line
  must name which accessor answers which limit, because `total === null` alone still reads
  "unbounded" to a v25 script; the disambiguation `total === null && tokens().limit !== null` is
  already pinned by their `sandbox-budget-api.test.ts`, so this is a sentence, not a test.
- **Arbitrated for the synthesizer:** their R8 (per-row `catalogFetchedAt` — adopted) and their R9
  (`tools: default` compared as the literal word — adopted). Neither needs a ruling now.
- **C-12, narrowed:** their task 17 (ADR-047) is already CONDITIONAL with an unconditional ledger
  half — converged with my obligations 7/8. The remaining gap is **ADR-038's `PRICE_UNKNOWN`**: DES-180
  makes the *predicate* a clean toggle ("delete the call, the predicate, its catalog row and its
  test"), but the `ERROR_CATALOG` row, the `run_start.errors[]` entry and the guide sentence are
  **published tool surface**, and un-publishing a described error after Gate 6 is a second
  `tools/list` byte re-pin. Ask: keep those three pieces in **one** task and mark it GATED, so the
  owner's overrule is one revert.

## 4. Self-sustainability — final position

Closed-loop autonomy; minimum human intervention.

- **Held:** C-1 (the pin-less-run `TypeError` — a crash on the first resume across the upgrade),
  C-2 (`reachableModels` is `:498` extracted, not re-derived), B-7 (`configCheck` needs its four
  moving parts in one task or `skipped` has no reader).
- **Conceded:** S-10 — DES-177's existing `'static'` already means "never fetched successfully in
  this process" and `'last-good'` means "fetched, now stale", which is the operator-action split I
  wanted; no fourth value. **Residue, one sentence:** DES-180's `PRICE_UNKNOWN` message must render
  `source:'static'` as *"the catalog has not been reachable since this process started"* rather than
  the bare word, or the distinction exists in the type and not in the refusal.
- **Converged:** ARCH-116's TTL + single-flight + last-good with an injected clock (DES-177);
  the pin read back at resume so a catalog change cannot rewrite a run's spend (INV-V26-4).
- **S-12, held (one paragraph, no code):** this dimension's agent half asks for tool-liveness probing.
  v26 builds the **reactive** form and should claim it in 04-design: `classifyApiError` recognises
  *cannot succeed*, the `finally` abort kills the CLI's remaining retries, and the guard slot plus
  host semaphore free in seconds instead of `timeoutMs × (1+retries)` — on a 24-wide `parallel()`
  that is the difference between a degraded run and a dead host. The **proactive** form (#73's weekly
  probe) is deferred by owner ruling; `declaredSource` + `catalogFetchedAt` are its attachment seam,
  and v26 is right to decline a per-row `declaredAt` for it now. Without the paragraph Gate 8 reads
  the dimension as unaddressed.
- **Explicitly excluded, unchanged from r1 and from Gate 2:** memory metabolism / context compression
  (runs are bounded, journalled and terminal; there is no resident agent memory to compress, and
  inventing one is scope invention) and self-reflection / prompt calibration (nothing in
  REQ-121..130 asks for it). Naming them is the dimension being answered, not skipped.

---

## D. Task-partition deltas — against their 18-row table, not a parallel list

Their partition is better than the eight obligations I wrote in r1 (it is ordered, it names the trap
each row closes, and its constraints — deletion before the gateway, the fixture module before both
consumers, `parseBudget` before every reader — are the ones I would have asked for). I adopt it and
ask for **six edits**, not a rewrite:

1. **Task 11** gains: *"`deriveAgentRecords` reads `costUSD`/`transport`/`proxyModel`/`detail` from
   the usage event"* + one transcript-only (snapshot-less) fixture asserting **presence**. Today
   task 10 gives that function `phase`/`startedAt` and task 11 gives the usage event the four new
   fields — the *reader* falls between the two rows, which is the exact seam ADR-046 names (B-2).
2. **Task 11** gains: *delete the `spec.budget` gate at `run-manager.ts:840`*, and
   `usage-live-equals-fold` gains an **unbudgeted resumed** case; the design names which producer
   writes `RunDagSnapshot.usage` (B-1).
3. **Task 11 or 15** gains the two dashboard readers by name — `dashboard.ts:56`
   (`sumTokens(a.tokens)`) and `DagAgentNode.costUSD` three-valued — with one page-source assertion.
   Neither site appears in any current row, and neither failure mode is a compile error (B-4).
4. **Task 10** gains `onPhase` **and** task 12 gains `onBudgetSnapshot` on the nested `SandboxHost`
   at `run-manager.ts:1011`; E2E-010 gains the nested-frame-that-*does*-call-`phase()` case (B-5).
5. **Task 13** gains the reader half of `configCheck`: `UpdateOutcome`, the ingestion at
   `server.ts:157`/`main.ts:217`, the dashboard banner at `dashboard-page.ts:57-65` (B-7).
6. **Task 5** gains `ModelEntry.ratesPerM` + the re-pointed `maxPricePerMOf`/`computeCostLevel`
   (B-6), and the pin-less `costUSD: null` rule (C-1) is an explicit sub-bullet of task 11 rather
   than an inference from DES-177's `priceBook: undefined` test.

One sequencing point their constraints do not state: **task 2's `Tokens` widening must land with the
`dashboard.ts:56` edit in the same commit.** Every other consumer of `Tokens` fails to compile; that
one does not, so it is the single site where a partial rollout is invisible until someone reads the
page.

---

## E. Risks — delta on my r1 list

- **QD-R2 → resolved-if-B-2-lands.** DES-175's `startedAt`-from-`ts` removes the `inferPhase`
  starvation I flagged; the residue is the optional-field omission, mitigated by the presence
  fixture.
- **QD-R3 → mostly resolved.** DES-179 journals `unmapped` on the usage event. The surviving half is
  B-1: the *fold* is gated, so an unbudgeted resumed run empties every counter at once.
- **NEW QD-R10 (HIGH):** a pin-less run **throws** rather than under-reports (C-1). Every run resumed
  across the v26 upgrade takes this path on its first dispatch. Mitigation: `pin?.pinned` + the
  stated `costUSD: null` rule (never `staticBook`) + one test row.
- **NEW QD-R11 (MEDIUM):** `RunDagSnapshot.usage` persists a wrong number if the guard writes it and
  the `:840` gate stays — a stored artefact, not a view (B-1). Mitigation: delete the gate, name the
  producer.
- **QD-R1, QD-R4..R9** stand as written, with QD-R1's mitigation now pointing at delta 3 and QD-R4's
  at B-6.

## F. Remaining disagreements after this round

1. **B-3 (the refusal write path)** — the only item where I expect a genuine "no". I hold that
   DES-175's cohort sentence and the tree disagree, and one of the two must change. I have costed
   the write precisely (one union member; two call sites decide, two get it free) and shown the data
   is engine-authored so the security objection does not attach. **I accept fallback (b)** — correct
   the sentence and REQ-124's acceptance — but not the current state, where the architecture claims
   the record survives and the code drops it.
2. **B-5's `onPhase`** — I accept either the wire (my preference; one line, and it makes ARCH-114's
   own cohort rule reachable) or a documented no-op plus a registration-time warning. I do not accept
   shipping the architecture's sentence and the tree's silence together. `onBudgetSnapshot` in the
   same constructor I do **not** offer as optional: `$0.00` in every nested frame is a lying
   interface after REQ-127.
3. **C-3 (migration answer ahead of ajv)** — testability may say "a release note is not a test".
   Agreed, and I am not asking for one: the testable half is the migration-message assertion on the
   `call-tool.ts:103-105` precedent. The release note is the human half, one line per break, for the
   three breaking changes (`budget` number→object, `models_list.toolUse`→`toolUseDeclared`,
   `run_status.agents[].tokens` two→four columns).
4. **Everything else is converged or arbitrated.** Their R8 and R9 are resolved in their favour and
   need no synthesizer ruling; my C-8, S-10, R-10, O-12 and the benign-subtype question are conceded
   in theirs.
