---
stage: design
lens: quality-dimensions
iteration: v26
round: 1 (independent proposal)
reads: "01-requirements.md REQ-121..130; 02-architecture.md ARCH-110..121 + ADR-037..047 + INV-V26-1..7 + 4+1 views + interface table + Decision rationale; state.yaml tech_stack; .panel/architecture/quality-dimensions.r1+r2.md (my own Gate 2 positions); the HEAD source tree"
---
# Quality-dimensions proposal — v26 DESIGN (Observability / Replaceability / Consumability / Self-sustainability)

## summary

Gate 2 adopted this lens almost wholesale: the phase ordinal on the record (my O-2 → ARCH-114), the
subtype+count with a *named reader* (D1/D3), the `{transport, provider, model, proxyModel}` split
(O-6 → ARCH-115), `effortApplied` recording the wire POSITION (O-7 → ARCH-117), book-level
provenance on `price_book` (new in r2 → ARCH-116), `remaining() → null` (D9 → ARCH-118), the ADR
row for the bug class (D2 → ADR-046) and the unconditional ledger amendment for trigger budgets
(D5 → ADR-047). So this round does **not** re-argue any of it. Its job is the layer Gate 2 could not
see: **the ledger names the fields; the tree names the readers, and in six places the reader does not
exist or is a hand-written whitelist that will silently drop what v26 writes.**

`03-tasks.md` exists on disk but ends at v24 (TASK-169 / DES-169); v26 starts at TASK-170 / DES-170.
Where task splitting decides whether a quality survives, §Task-splitting obligations gives the
synthesizer a numbered block to lift.

The four sharpest findings, each verified on HEAD:

1. **The restart reconstruction path is a hand-written whitelist, and ARCH-114 names a function that
   does not exist.** `deriveAgentRecords` (`run-store.ts:24`) is what `getRun` uses whenever there is
   no terminal snapshot (`sqlite-run-store.ts:260`, `run-store.ts:243`: `snap?.agents ?? derive…`).
   It builds records field-by-field at three sites and emits exactly
   `{agentId, state, provider, model, tokens, label}` — it already drops `startedAt`, `endedAt`,
   `frame`, `phase` and `lastActivityAt` today. ARCH-114 assigns the v26 fields to
   `buildRecordsFromTranscript`; **no such symbol exists in `src/` or `tests/`**. Unless the real
   function is named and changed, `phase`/`phaseIndex`/four-column `tokens`/`costUSD`/`transport`/
   `detail` are write-only on that path — and `inferPhase(record, phases)` has no `startedAt` to join
   on, so every restart-reconstructed record falls to the frame-grouped fallback *with a warning*,
   which is precisely REQ-124's forbidden outcome.
2. **`run_result.meta` does not exist.** `ResultEnvelope` (`types.ts:66`) is
   `{runId, status, result?, error?, principal?}`; `getResult` persists `{value}` only;
   `RunManager.result()` (`:735`) returns `{ok, value}`. ARCH-118 says `meta` "gains" three things it
   has nowhere to gain them. And `unmappedMessages` as specified lives on `GatewayResult` — an
   in-memory object — so the counter my own D1/D3 condition promised a reader for is **gone after a
   restart**.
3. **A `refused` record does not survive a restart at all.** `markRefused`
   (`agent-executor.ts:222`) writes only the in-process `_records` map — no transcript event — and
   `deriveAgentRecords` omits any agent with neither a usage nor a harness event. So ARCH-114's
   cohort (i) ("including `refused` records") is true in-process and in the TERMINAL snapshot
   (`run-manager.ts:885`) and false for an interrupted run reconstructed after a restart. v25 minted
   that record *because* an invisible refusal cost a whole `parallel()`; v26's projection re-loses it.
4. **Two nested-frame blind spots that v26 turns into money and lanes.** The nested `SandboxHost`
   (`run-manager.ts:1011`) passes only `onAgentRequest` and `onWorkflowRequest`. It has **no
   `onPhase`** — so `phase()` inside a `workflow()` is silently discarded today
   (`host.ts:139` is `this._config.onPhase?.(…)`), which makes ARCH-114's own cohort rule
   ("`k >= lanes.length` — nested frames pushing onto the parent timeline — appends a lane WITH a
   warning") unreachable code. And it has **no `onBudgetSnapshot`** — so `budget.spent()` inside a
   nested frame reads 0 forever (`host.ts:109` sends `spent: this._config.onBudgetSnapshot?.()`),
   which after REQ-127 means *the money meter reads $0 inside every sub-workflow*.

## Altitude call (which system is this?)

Unchanged from my Gate 2 round and re-affirmed by what the v26 slice actually touches: **both
altitudes, applied per REQ**, exactly as ARCH's own "Altitude split" paragraph states. A Node 22 /
TypeScript ESM service (hand-rolled JSON-RPC MCP server, better-sqlite3, journal, dashboard, systemd
self-update) carries REQ-121/124/125/129 at the **system** altitude; `agent()` dispatching a Claude
Agent SDK session through a swappable gateway carries REQ-122/123/126/127 at the **agent** altitude;
REQ-128/130 are agent-altitude *consumability* — the author is a cold model and the refusal envelope
plus the guide **are** the API.

Deliberately excluded, one sentence each so the dimension is answered rather than skipped:
**memory metabolism / context compression** — runs are bounded, journalled and terminal; no resident
agent memory exists to compress, and inventing one is scope invention. **Self-reflection / prompt
calibration** — nothing in REQ-121..130 asks for it. **Tool-liveness is NOT excluded** — see S-12.

## Carried forward from Gate 2 (not re-argued)

| Gate 2 item | Landed as | This round |
|---|---|---|
| O-2 phase `{title,index}` at IPC receipt, never on `CallKey` | ARCH-114, INV-V26-1 | O-9, O-14 make it reachable |
| O-4/D1 unmapped subtype + count, capped, with a named reader | ARCH-111 + rationale | O-12: it must be journaled to have a reader after a restart |
| O-5 `retryable` honoured by both loops | ARCH-111, ADR-040 | S-12 reads it as the tool-liveness answer |
| O-6 transport ≠ provider ≠ model | ARCH-115 | O-9: all three must reach the derived path |
| O-7 `effortApplied` records wire position + value | ARCH-117 | no change |
| O-8 + r2 provenance: prices pinned, `price_book.{fetchedAt,source}` | ARCH-116 | S-9, S-10 |
| D2 name the bug class once | ADR-046 + D-V26-projection | every item below is an instance |
| D3 every counter named, rendered, asserted | rationale | O-11, O-12, O-13, S-11 |
| D5 trigger-budget ledger amendment unconditional | ADR-047 | C-12 (conditional tasks) |
| D8 provider table split by fact LIFETIME | ARCH-112 + ARCH-116 | R-8, R-10 |
| D9 `remaining() → null` | ARCH-118 | C-8 applies the same rule to `total` |
| D13 `--check-config` before restart | ADR-042 | S-11 gives it a reader |

## key_points

1. **(O-9, HIGH)** `deriveAgentRecords` (`run-store.ts:24`) is the restart reconstruction path and a
   hand-written whitelist; ARCH-114 assigns v26's fields to `buildRecordsFromTranscript`, which does
   not exist. Fix all three branches, and derive `startedAt` from the event `ts` or `inferPhase` has
   nothing to join on.
2. **(O-10, HIGH)** `markRefused` (`agent-executor.ts:222`) never journals, so `refused` and `queued`
   records vanish when a non-terminal run is reconstructed — v25's visible-refusal fix, re-lost.
3. **(O-11, HIGH)** `run_result.meta` does not exist (`types.ts:66`): envelope field + `foldUsage`
   over the persisted journal at read time + `outputSchema` — and the budget gate at
   `run-manager.ts:840` must not be inherited by the meta fold.
4. **(O-12, HIGH)** `unmappedMessages` as specified is memory-only; journal the capped subtype, and
   derive `unpricedCalls` from stored `costUSD === null` rather than keeping a second counter.
5. **(O-13, MEDIUM)** Name the two dashboard readers (`dashboard.ts:56`, `dashboard-page.ts:359`) and
   keep cost three-valued: `0` = never dispatched, `null` = unpriceable, a number = priced.
6. **(O-14, MEDIUM)** `phase()` inside a nested `workflow()` is silently dropped today
   (`run-manager.ts:1011` passes no `onPhase`), which makes ARCH-114's nested-lane rule unreachable.
   Wire it or document it as a no-op; silence is not an option.
7. **(R-8, HIGH)** `maxPricePerMOf` (`model-catalog.ts:250`) parses the display string; re-point it and
   `computeCostLevel` at the numeric rates, or the catalog filter and the spend meter price the same
   model twice.
8. **(R-9, MEDIUM)** `toolUse` is an input FILTER as well as an output field — rename both together and
   extend the `models_list` description with the new declared columns.
9. **(R-10, MEDIUM)** The grep guard proves the retired names are gone, not that the new table is total:
   add one `Provider`-totality test over every provider-keyed site.
10. **(C-8, HIGH)** Apply Gate 2's conceded `remaining() → null` rule to its sibling: `budget.total`
    reads `null` = "unbounded" under a tokens-only budget. Add `budget.limits: {usd, tokens}`.
11. **(C-9, HIGH)** The IPC budget wire is three fields (`budgetTotal`, `spent`, `onBudgetSnapshot`), and
    the nested host has no `onBudgetSnapshot` at all — `budget.spent()` reads `$0` in every sub-workflow.
12. **(C-10, MEDIUM)** Render the seed item `description` and the validator `hint` from one constant;
    hold `required:['path']` (ajv is live, so `required` would make `INVALID_SEED_SPEC` unreachable).
13. **(C-11/C-12, MEDIUM/LOW)** Three breaking changes need one migration paragraph and a named answer
    ahead of ajv; the two pending-ruling surfaces are marked GATED with their fallback.
14. **(S-9/S-10, HIGH/MEDIUM)** The pin reuses the existing reachable set (`run-manager.ts:498`) and the
    existing params row read (`:834`); `price_book.source` needs a fourth value for "never fetched".
15. **(S-11/S-12, MEDIUM/LOW)** `configCheck` needs its four moving parts in one task or `skipped` has no
    reader; and ARCH-111 IS this dimension's tool-liveness answer — claim it in 04-design.

---

## 1. Observability

**The traceability fold, stated:** after v26 the question "which of the three provider paths broke,
what did it cost, and in which phase" must be answerable **from the persisted record alone**, because
the box restarts on every release (ADR-038's own premise). Every finding below is one place where the
answer exists only in RAM or only in a field nothing projects.

**O-9 (HIGH) — name the real reconstruction function and fix all three of its branches.**
Verified: `deriveAgentRecords(transcripts, parentStatus)` at `run-store.ts:24` constructs records at
three sites — usage/done (`:39`), usage/failed (`:41`), harness-only (`:52`) — each an object literal.
Today it fabricates `tokens:{input:0,output:0}` on the failed and harness branches and never sets
`startedAt`, `endedAt`, `frame`, `phase` or `lastActivityAt`. The design must:
- **rename ARCH-114's `buildRecordsFromTranscript` to `deriveAgentRecords`** (or state that the
  function is being introduced and what happens to the existing one — but not leave a ledger row
  pointing at a symbol that does not exist);
- set `startedAt` from the *first* event's `ts` and `endedAt` from the usage event's `ts`, because
  `inferPhase` is specified as `record.startedAt ?? record.endedAt` and this path supplies neither;
- carry `phase`, `phaseIndex`, `transport`, `proxyModel`, four-column `tokens`, `costUSD` and
  `detail` on **all three** branches, with the failed branch emitting four zeros and
  `costUSD: null` (a failed call has no usage; `0` would be a claim);
- carry one fixture per branch in the test list. The v24 round found the identical shape one layer up
  (O-8, "write-without-readback"); this is the same seam, one iteration later.

**O-10 (HIGH) — journal the refusal, or state the cohort limit; silence is the one option v26 cannot
keep.** Verified above: `markRefused` never journals, `saveSnapshot` runs only at the terminal
transition, and the derive path omits records with neither event. Consequence: a `refused` (or
`queued`) record is invisible in `run_status.agents[]` for any run interrupted before terminal — the
DAG loses the refused cell and REQ-120's whole point with it. Cheapest correct fix: **one journaled
transcript event at `markRefused`** (the sink already exists and is already redacted at capture),
which also makes the refusal survivable by `foldUsage` with `costUSD: 0`. If the panel prefers not to
add a write path, then ARCH-114's cohort list and REQ-124's acceptance must say so out loud. My
position: journal it — a record that exists only in RAM is exactly ADR-046's class, and the design
gate is where that gets decided, not Gate 8.

**O-11 (HIGH) — `run_result.meta` is three obligations, not one.**
(a) `ResultEnvelope` (or a `run_result`-specific response type) gains `meta`;
(b) it is computed by `foldUsage` over the **persisted journal** at read time, never from
`entry.guard` — a `run_result` after a restart has no live guard, and a meta that is silently empty
there is the same defect one level up;
(c) it is declared in `TOOL_SPECS.run_result.outputSchema`, or a cold model never learns it exists
(the REQ-117 lesson, and the reason `models_list`'s nine filters were undiscoverable in v24).
**And one gate must not be inherited:** `run-manager.ts:840-844` folds the journal only
`if (spec.budget !== null && spec.budget !== undefined)`. That gate is correct for hydrating
`RunGuard` and wrong for `meta` — unbudgeted runs are the common case and would report no usage at
all. One function, two callers, different gating, written down.

**O-12 (HIGH) — a counter that dies with the process is not observability.**
ARCH-111 carries `unmapped?: string[]` on `GatewayResult` → `meta.unmappedMessages`. `GatewayResult`
is an in-memory object; after a restart the count is gone while the run row survives. The subtype
(already capped at 64 B and charset-restricted per the adopted D1) must ride the **terminal usage
transcript event** into the journal, so `foldUsage` recounts it exactly like tokens.
Corollary that removes a whole drift class: **`unpricedCalls` should be DERIVED by `foldUsage` from
`costUSD === null`, not maintained as a second counter.** ARCH-118 currently has `RunGuard._unpriced++`
*and* `foldUsage → {…, unpriced}`. The two are sequential (live vs rehydrate), not concurrent, so this
is not a race — it is two independent statements of one rule, which is how they drift. Ask: **one
derivation rule — `costUSD === null` on a `done` call — applied by whichever object holds the count**,
so the live counter and the fold cannot disagree about a resumed run's total.

**O-13 (MEDIUM) — the two dashboard readers, named, plus the three-valued cost.**
`dashboard.ts:56` flattens `tokens: a.tokens.input + a.tokens.output` into one number for the DAG
cell type (`dashboard.ts:22`, `tokens: number`); `dashboard-page.ts:359` renders
`(a.tokens||0)+' tok'` off that cell. Two outcomes, both bad and neither caught by `tsc`: leave the
cell a `number` and the two cache columns — the *majority* of a cached Anthropic call's usage
(measured: `input 18 / cache_creation 20,762 / cache_read 19,522`) — silently never reach the UI;
widen it to the object and `(a.tokens||0)+' tok'` renders **`[object Object] tok`**, because string
concatenation of an object is legal TypeScript. Both sites are named in the design and moved
together, and this is where the Gate 2 promise lands: `costUSD`, `meta.unpricedCalls`
and `meta.unmappedMessages` get their rendered reader on the run page beside ARCH-119's harness table.
**Cost is three-valued and the renderer must not collapse it:** `0` = never dispatched (a refused
call — truly zero), `null` = dispatched but unpriceable, a number = priced. Rendering `null` as `0`
re-introduces the silent default one layer up from where ADR-046 removed it.

**O-14 (MEDIUM) — nested `phase()` is discarded today; decide it, don't inherit it.**
Verified: nested host at `run-manager.ts:1011` has no `onPhase`; `host.ts:138-140` is
`case 'phase': this._config.onPhase?.(msg.title)`. So a sub-workflow's phases never reach
`entry.phases`, and ARCH-114's "nested frames pushing onto the parent timeline append a lane WITH a
warning" describes behaviour that cannot occur. REQ-124's "nested `workflow()` frames share the same
phase timeline (a known approximation)" is not an approximation — it is a silent drop. Two acceptable
designs, one unacceptable: **(a)** wire `onPhase` on the nested host and accept the warned appended
lane ARCH-114 already specifies (my preference — it makes the architecture's stated cohort true and
costs one line); **(b)** leave it unwired and make "`phase()` inside a nested workflow is a no-op"
an explicit sentence in the guide (ARCH-121 (b)) plus a registration-time warning. **(c)** saying
nothing is what we have now.

---

## 2. Replaceability

**Carried:** R-1..R-7 landed as ARCH-112 / ADR-041 / ADR-045 (one `PROVIDER_CAPS`, `never`-checked
switches, retired surface grep-guarded), and I conceded the pricing/identity split on lifetime
grounds (D8). Nothing there reopens.

**R-8 (HIGH) — one numeric price, or the catalog and the budget answer differently.**
Verified: `maxPricePerMOf` (`model-catalog.ts:250`) parses the DISPLAY string with
`/\$([0-9.]+)\/1M/`; `computeCostLevel` (`:272`) rides it; the `maxPricePerM` filter and the
`costLevel` rating ride that. ARCH-116 makes numeric `ratesPerM` primary and the `"$5/1M"` string
*derived*. If the filter keeps parsing the derived string, one model has two price derivations — the
exact defect ADR-045 just deleted for effort, re-created in the pricing module in the same
iteration. Design ask: `maxPricePerMOf(rates: FourRates | null) → number | null`, the display string
is human-facing only, and the design **states which rates the scalar compares** (today `max(in,out)`;
keep it, but say so now that four exist, and say that `costLevel` therefore ignores cache rates).

**R-9 (MEDIUM) — `toolUse` is an input filter as well as an output field.**
`CatalogFilter.toolUse` (`model-catalog.ts:39`), `TOOL_SPECS.models_list.inputSchema.toolUse`
(`tool-specs.ts:848`), `filterCatalog` (`:306`), and the prose at `:838-841` that enumerates the row's
fields. ARCH-117 renames only `EnrichedModelEntry`. Rename the filter in the same task or the surface
is inconsistent for exactly the cold model v24 fixed this description for — and extend the
description with `effortDeclared`, `declaredSource` and `catalogFetchedAt`, or REQ-126's declaration
is served and undiscoverable.

**R-10 (MEDIUM) — enumerate the provider-keyed sites; a grep guard proves absence, not totality.**
`no-retired-surface.test.ts` will prove `'openai'`/`'gemini'` are gone. It proves nothing about
whether the surviving sites are exhaustive over `Provider`. Verified provider-keyed sites beyond
`PROVIDER_CAPS`: `default-aliases.ts:16-19` (provider-keyed data), the LiteLLM route emitter, the
static catalog list plus the two federation fetchers in `model-catalog.ts`, and the direct-fetch
client's request/response branches. Design ask: list them, and add **one totality test** — for every
member of `PROVIDERS`, each site returns without reaching its `never` arm. That is what makes
ADR-041's "a fourth provider is one union member plus the rows `tsc` demands" a checked claim rather
than a hope.

**R-11 (LOW, agent altitude) — record the compensating property where a caller reads it.**
This dimension's agent-altitude requirement is "GPT↔Claude↔local is a config change". v26 narrows
five paths to three, which is a real reduction; the compensating facts are that OpenRouter is the
many-model front door (so *swap the model* stays a config change) and that two `GatewayClient`
implementations behind one interface keep *swap the transport* a config change. ADR-041 says this to
the ledger; the **guide's alias table (ARCH-121 (d)) should say it to the caller**, one sentence, so
"why is there no `openai` row" has a published answer instead of a removed one.

---

## 3. Consumability

**Carried:** C-1..C-7 landed as ARCH-119's structure-as-JSON refusal envelope (I am the lens that was
expected to argue for corrected Mermaid and I argued against it — D6), the `tools: default` keyword
with the checker's constant rendering the guide's definition and a SKIPPED (never partial) comparison
(D7), and `declaredSource` on the declared flags (C-7).

**C-8 (HIGH) — apply the conceded `remaining()` rule to its sibling `total`.**
`Budget` is `{total: number | null; spent(): number; remaining(): number}` (`types.ts:76-80`), built
in the child at `child-entry.ts:97-100` with `total: msg.budgetTotal` and
`remaining: () => budgetTotal === null ? Infinity : …`. Gate 2 adopted `remaining() → null` because
`Infinity` is "a confident wrong value of exactly the class this iteration exists to remove".
**`total === null` under a tokens-only budget is the identical class and identically undetectable** —
every script written against v25 reads `total === null` as "unbounded". This is not a new proposal;
it is the conceded rule applied to the accessor next door. Cheapest honest shape:
`budget.limits: { usd: number | null; tokens: number | null }` as the one named reader, `total` kept
as an alias of `limits.usd`, and ARCH-121's honesty line extended by one clause naming which
accessor answers which limit.

**C-9 (HIGH) — the IPC budget wire is three fields, and one of them is missing on nested frames.**
`host.ts:52` `onBudgetSnapshot?: () => number`, `:103` `child.send({t:'start', …, budgetTotal})`,
`:109` `spent: this._config.onBudgetSnapshot?.()`, `child-entry.ts:20/97-100`. ARCH-118 changes
`agentResult.spent` to `{usd, tokens}`; the **start message's `budgetTotal` and the callback's return
type change with it**, and `run-manager.ts:1023` already passes
`entry.guard.budgetView().total` into a nested frame that has **no `onBudgetSnapshot` at all**, so
`budget.spent()` reads 0 there today and reads `$0.00` after v26. Wire the callback on the nested
host in the same task — it is the missing half of a wire v26 is editing anyway, not new scope.

**C-10 (MEDIUM) — one constant behind the seed schema's prose and the validator's hint.**
I **hold ARCH-110's `required: ['path']`**: ajv is live (`call-tool.ts:23`, `validateArgs` `:66-67`),
so adding `contentB64` to `required` would make `INVALID_SEED_SPEC` unreachable and its new
`see: 'workflow_authoring_guide'` row dead on arrival. The narrow ask is the drift lock: the item
`description` string ("REQUIRED — base64 of the file bytes…") and the validator's `hint` render from
**one exported constant**, tested, so the schema's prose and the refusal message cannot diverge — the
same rule ARCH-121 applies to the guide, applied to the schema that teaches the same fact. **Verified, and it sharpens
issue #64:** `TOOL_SPECS.run_start.errors[]` (`tool-specs.ts:394`) *already* lists
`INVALID_SEED_SPEC` and `SEED_SOURCE_CONFLICT`, so ARCH-087's `Errors:` line has been advertising a
refusal the `seed` path never gave — the description was not silent, it was wrong. What is missing is
the catalog row's `see:` (`errors.ts:112` is `see: null`), which ARCH-110 fixes; the design should
say the `errors[]` entry needs no change so nobody "adds" a duplicate.

**C-11 (MEDIUM) — three breaking changes in one release need one migration paragraph.**
`budget` number→object, `models_list.toolUse`→`toolUseDeclared`, `run_status.agents[].tokens`
two→four columns. The cross-repo row covers the plugin client; a human or third-party caller gets
nothing. Design deliverables: one release-note line per break with the exact old→new, and — following
the existing precedent at `call-tool.ts:94-100`, where the retired inline door answers *ahead of
ajv* with a migration message — a `budget: <number>` argument gets a named answer stating the new
shape and the unit, not a bare ajv type error. `INVALID_ARGUMENT` with no remedy is what REQ-122 is
about at the provider seam; the same standard applies at ours.

**C-12 (LOW) — mark the conditional surfaces conditional.**
`PRICE_UNKNOWN` (ADR-038, `owner_decision: pending`) is a NEW `ERROR_CATALOG` row **plus** a
`run_start.errors[]` entry **plus** a guide sentence — i.e. it changes the published tool description.
Trigger budgets (ADR-047 option (a)) would change three tool schemas. The tasks doc must mark both
**gated on the ruling**, and the fallback path (ADR-038's stated "(a) everywhere") must be the
default the task reverts to, so no unruled surface is specced as if decided.

---

## 4. Self-sustainability

**Carried:** ARCH-116's TTL + single-flight + last-good, ARCH-118's stored `costUSD` and journal fold
(a restart cannot rewrite a run's spend), ADR-042's `--check-config`, and ADR-038's consequence
recorded rather than discovered plus the `price_book` provenance my r2 added.

**S-9 (HIGH) — the pin rides the reads that already exist; the fold does not ride the budget gate.**
Three anchors, all verified:
- **Admission already computes the reachable set.** `run-manager.ts:498`:
  `modelsToCheck = [effectiveParams.model, ...agents.map(a => a.model)]`. The pin must reuse this
  expression, not mint a second derivation of "which models can this run reach" — INV-V26-4 is only
  as strong as the set it pins over.
- **Resume already reads a pinned admission snapshot.** `run-manager.ts:834`
  (`storedParams ?? defaultRunParams(...)`, via `getParams`, `sqlite-run-store.ts:110`).
  `runs.price_book` is read back in that **same row read**, one rehydration site, so no path can
  reach dispatch with a live catalog instead of the pin.
- **A pre-v26 row has no pin.** Define it: prices `null`, every call `unpriced`, never re-priced
  against today's catalog — the same rule ARCH-118 already sets for two-column legacy usage events.
And the gating split from O-11 belongs here too: `run-manager.ts:840-844` folds only when a budget
exists, which is right for the guard and wrong for the run's own spend total.

**S-10 (MEDIUM) — "never fetched" and "six hours stale" need different words.**
`price_book.source ∈ {'live','last-good','static'}` cannot express *the catalog has been unreachable
since this process started* — which is the concrete state ADR-038 creates on a restart during an
OpenRouter outage, and the one where a USD-only budgeted run gets refused. Add `'unavailable'` (or
make the `PRICE_UNKNOWN` message distinguish the two), because the operator action differs: wait vs.
investigate. One string, no new mechanism, and it is what makes the refusal actionable rather than
mysterious — the property that won ADR-038 my concession in the first place.

**S-11 (MEDIUM) — `configCheck` needs a reader, or it is a value in a file nobody opens.**
Verified: `write_result` (`deploy/rwe-update.sh:39-60`) writes a FIXED four-key JSON
`{tag,status,ts,detail}` via `printf`; the engine ingests `updateResultPath` (`server.ts:157`,
`main.ts:217`) and the dashboard renders `lastUpdate` as an `UpdateOutcome`
(`dashboard-page.ts:57-65`). ADR-042's `configCheck: 'passed' | 'skipped' | 'failed'` therefore
touches **four things that must move together**: the `printf` shape, the `UpdateOutcome` type, the
ingestion, and the banner. Ship three of four and `skipped` becomes a value nothing displays — my own
D3 condition, applied to the deployment path instead of the run page. This matters most for
`skipped`, which is the *silent* outcome by construction.

**S-12 (LOW→MEDIUM, agent altitude) — tool-liveness is answered by ARCH-111; say so.**
This dimension's agent half asks for "probe that the API still works". v26 builds the **reactive**
form and should claim it: `classifyApiError` recognises *cannot succeed*, the `finally` abort kills
the CLI's remaining retries, and the RunGuard slot plus host semaphore are released in seconds
instead of `timeoutMs × (1+retries)` — on a 24-wide `parallel()` that is the difference between a
degraded run and a dead host. The **proactive** form (#73's weekly OpenRouter probe) is deferred by
owner ruling; `declaredSource` + `catalogFetchedAt` are the seam it will attach to, and v26 correctly
declines to pre-shape a per-row `declaredAt` for it. Design ask: one paragraph in 04-design naming
this as the liveness answer, so Gate 8 does not read the dimension as unaddressed — and one Gate 7.5
observation that the subprocess is actually gone (`ps`), which ADR-040 already calls the only real
evidence.

---

## Task-splitting obligations (for the synthesizer; v26 starts at TASK-170 / DES-170)

Task boundaries decide whether three of the four dimensions survive. Lift this block:

1. **One task: the AgentRecord surface.** New fields (`phase`, `phaseIndex`, `transport`,
   `proxyModel`, `detail`, four-column `tokens`, `costUSD`) **+** `deriveAgentRecords` all three
   branches **+** `startedAt`/`endedAt` from event `ts` **+** the dashboard cell. Split, and the
   fields are written by one task and dropped by the next until someone notices.
2. **One task: the four-column `Tokens` type across every site** — usage event, `foldUsage`,
   `RunGuard.setSpent`/`addUsage`, IPC `spent` and `budgetTotal`, `child-entry` budget object,
   `dashboard.ts:56`, `dashboard-page.ts:359`. A partial rollout does not fail to compile; it renders
   `[object Object] tok`.
3. **One task: `run_result.meta`** — envelope type + `foldUsage` at read time + `outputSchema` +
   the dashboard reader. (b) without (c) is an undiscoverable feature; (a) without (b) is a field
   that empties on restart.
4. **One task: the updater result** — `printf` shape + `UpdateOutcome` + ingestion + banner, together
   with the `--check-config` entry point and the DEPLOY.md numbered step.
5. **Each drift-lock test lives in the task that creates the constant it locks**
   (`SANDBOX_GLOBALS` ↔ `createSandboxContext`, `DETERMINISM_GUARDED` ↔ the vm throw,
   `PROVIDER_CAPS` totality, the seed description ↔ hint constant, `docs/AUTHORING.md` ↔ builder).
   A lock landing a task later is green against the wrong baseline.
6. **Deletion before table-widening, or the grep guard is meaningless.** The `no-retired-surface`
   test is RED until the `openai`/`gemini` deletion lands; the `PROVIDER_CAPS` totality test (R-10) is
   the one that must land *with* the table. Sequencing them the other way leaves a window where two
   provider vocabularies disagree.
7. **Two tasks marked GATED on an owner ruling** — ADR-038's `PRICE_UNKNOWN` (catalog row +
   `run_start.errors[]` + guide sentence) and ADR-047's trigger budgets. Each names its fallback so
   the unruled path is still shippable.
8. **The ADR-047 ledger amendment is NOT gated** — `04-design.md:832`, `:1156` (D-V2h) and the
   overlap accepted risk are corrected in this iteration whichever way the ruling goes. It is a
   documentation task with no dependency; schedule it early so it cannot be dropped at the end.

---

## risks

- **QD-R1 (HIGH)** — Partial four-column rollout. `tsc` catches neither failure mode: a cell left as
  `number` silently drops both cache columns, and a widened cell concatenates as `[object Object]`.
  *Mitigation:* task-splitting obligation 2 + one page-source assertion + one four-column fixture
  rendered end-to-end.
- **QD-R2 (HIGH)** — REQ-124's "zero warnings on existing runs" passes on the owner's ~30 terminal
  snapshots and fails on any interrupted run reconstructed by `deriveAgentRecords`, because that path
  has no `startedAt` for `inferPhase`. *Mitigation:* O-9, plus a fixture that is a
  transcript-only (snapshot-less) run.
- **QD-R3 (HIGH)** — `meta` counters live only in process memory (`GatewayResult.unmapped`,
  `RunGuard._unpriced`), so a restart empties exactly the observability v26 added. *Mitigation:*
  O-12 (journal the subtype; derive `unpricedCalls` from stored `costUSD === null`).
- **QD-R4 (MEDIUM)** — Two price derivations (`maxPricePerMOf` string-parse vs `FourRates`) diverge, so
  the catalog filter and the spend meter disagree about the same model. *Mitigation:* R-8.
- **QD-R5 (MEDIUM)** — Nested-frame blind spots ship as-is: `phase()` silently dropped, `budget.spent()`
  permanently `$0`. *Mitigation:* O-14 + C-9, both one line at `run-manager.ts:1011`.
- **QD-R6 (MEDIUM)** — A pending-ruling surface (`PRICE_UNKNOWN`) is specced and implemented
  unconditionally, then has to be un-published from a tool description. *Mitigation:* obligation 7.
- **QD-R7 (LOW)** — Seed schema prose and validator hint drift apart, so the schema says REQUIRED and
  the refusal says something else. *Mitigation:* C-10's shared constant.
- **QD-R8 (LOW)** — `configCheck: 'skipped'` ships without a reader and the deployment's only
  fail-open path stays invisible. *Mitigation:* S-11 / obligation 4.
- **QD-R9 (LOW)** — Guide/description growth: ARCH-121 adds five sections and REQ-130 (d)'s alias
  table to a response a cold model already receives whole. v24 flagged the same unbudgeted context
  cost. *Mitigation:* one byte-size assertion on `buildGuide()` output, and the alias table generated
  (not enumerated by hand).

## expected disagreements with other lenses

- **Adversarial (testability/simplicity) on O-10** — "journaling a refusal is a new write path inside
  a slice whose ten REQs never ask for one." My answer: v25 minted the `refused` record *because* an
  invisible refusal cost every branch past the second of a `parallel()`; a projection that drops it on
  restart is ADR-046's class, discovered at the design gate, which is the cheapest place it can be
  fixed. If they refuse the write, I will settle for the cohort limit written into ARCH-114 and
  REQ-124's acceptance — but not for silence.
- **Karpathy simplicity on C-8 (`budget.limits`)** — "a fourth accessor on a read-only view." My
  answer: it *replaces* an ambiguity rather than adding a feature; the alternative is a guide sentence
  apologising for two different `null`s, and Gate 2 already rejected that trade once for
  `remaining()`.
- **Adversarial on O-14 (nested `onPhase`)** — "behaviour change beyond REQ-124." My answer:
  ARCH-114's own cohort rule is unreachable code without it. I accept the documented-no-op option (b)
  as an equal; what I will not accept is shipping the architecture's sentence and the tree's silence
  together.
- **Security on O-11/O-13** — "a new field on the result envelope and a cost column on an
  unauthenticated dashboard route." My answer: every value there is engine-authored arithmetic
  (integers and one float), not provider text; the single provider-authored string (`detail`) is
  redacted-then-capped and swept per INV-V26-5, and `dashboard.ts`'s route already returns the whole
  run view.
- **Scalability/consistency on S-9** — I expect agreement: reusing `modelsToCheck` and the existing
  `getParams` row read is strictly cheaper than a second derivation and a second read.
- **Testability on C-11** — "a release note is not a test." Agreed, and I am not asking for one: the
  testable half is the migration-message assertion (the `call-tool.ts:94-100` precedent) plus the
  fixture-backed `Errors:` line. The release note is the human half, and it is one line per break.
- **Anyone on R-10's totality test** — "the grep guard is enough." It proves the old names are gone; it
  says nothing about whether the new table is total over the surviving three. Those are different
  properties and ADR-041's headline claim ("a fourth provider is one union member") is the second one.
