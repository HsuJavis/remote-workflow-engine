# Architecture panel — Adversarial group (Security × Scalability/Performance × Testability), round 1

**Iteration:** v35 (REQ-205..REQ-210)
**Lens:** adversarial trio, argued separately, conflicts surfaced; tie-breaker = Karpathy simplicity-first
**Round:** 1 (independent proposal — no other panelist's text read)

---

## 0. Altitude ruling (done first, per the lens brief)

`state.yaml` `tech_stack` describes an MCP server (hand-rolled JSON-RPC over HTTP, `src/server.ts`)
that admits, persists and supervises **runs of scripts that call LLM agents** through two
`GatewayClient` implementations (LiteLLM proxy / `@anthropic-ai/claude-agent-sdk`). So this is
**both** a plain system and an AI-agent system, and the v35 requirements split cleanly along that
seam — this is the ruling, and I do not relitigate it below:

| REQ | Altitude that dominates | Why |
|---|---|---|
| REQ-205 failed-run diagnosability | **agent** (observability) + system (durability) | The evidence is a cold agent subject that could not find out *why* run `bb151ba2` died. |
| REQ-206 `args` `{}` + declared defaults | **system** (correctness) | A null-vs-`{}` contract bug; the fact that the victim was an agent-authored script is incidental. |
| REQ-207 agent-failure semantics surfaced | **agent** (consumability) | `null` from a failed `await agent()` was string-interpolated into the next prompt — a *data-corruption* failure mode that only exists at the agent altitude. |
| REQ-208 scanner mis-reads string content | **system** (correctness/security of an admission gate) | Regex vs. tokenizer; classic. |
| REQ-209 doc examples must really register | **system** (self-sustainability) | A guard-degradation defect in `checkMermaid`. |
| REQ-210 envelope/size legibility | **agent** (consumability) | Double-JSON + 39.5KB guide truncated the cold subject's output twice. |

The "replaceability" dimension is not moved by any of the six; I do not force it.

---

## 1. Summary

**The minimum architecture for v35 is: no new architecture.** All six requirements land inside
modules that already exist, at write sites that already exist. `01-requirements.md:2840` already
routed this iteration to `/sdlc-fix` F1–F6 ("無新外部整合、無新能力、safety_class 維持 QM"), and after
reading the six acceptance blocks against the actual code I endorse that routing without
qualification. My adversarial contribution is therefore **three concrete objections and one
boundary move**, not a design:

1. **Security (real, verified):** REQ-205 converts `entry.resultError` from an in-process value into
   a *persist sink*, and that value has **never passed through `redact()`**. `src/run-manager.ts:1225`
   is `entry.resultError = toErr(outcome.error)` — bare. DES-088's redact-at-capture sweep enumerates
   its sinks by number in the source (I read sink (2) at `run-manager.ts:1115`, the snapshot array, and
   sink (4) at `:1448`, the whole journal entry; the admission snapshot is redacted at `:627`). The error
   channel is not among them — because today it dies with the process. REQ-205 makes it sink **#5** across three new surfaces
   (`runs.error` column, `journal.jsonl`, `run_list`/dashboard) simultaneously. This is the
   composeConfig-class bug pattern this repo already has a memory note for: a new sink wired without
   the cross-cutting transform. **Non-negotiable: REQ-205 does not close until `redact()` is applied
   at capture and a test proves a seeded secret does not reach `runs.error`.**
2. **Security (bounded write):** REQ-205 also asks `toErr()` to stop dropping `.detail`. `.detail` is
   an arbitrary object supplied by `codedError`/`paramCodedError` call sites, some of which are
   reachable from script-controlled input. Forwarding it *to disk* without a size bound creates an
   unbounded, attacker-influenced write. Bound it (serialized-bytes cap with explicit truncation
   marker), same discipline as `MAX_META_LITERAL_BYTES` already applies to meta literals.
3. **Correctness (REQ-208 cuts both ways):** teaching `scanAgentCalls` to skip string literals makes
   an **admission-time guard weaker**, not stronger. The fix must not create a hiding place. Three
   named adversarial cases below.
4. **Testability (the one boundary move I do propose):** `toErr` is module-private at
   `run-manager.ts:150`. REQ-205 demands `.detail` forwarding "有自己的測試". Move `toErr` to
   `src/errors.ts` (already imported at `run-manager.ts:15` alongside `codedError`/`toErrorCode`) so
   its behaviour is unit-testable without standing up a `RunManager`, a sandbox and a clock. This is
   the only file-boundary change I argue for in v35.

Everything else is a delta at a known line.

---

## 2. Key points, per requirement (minimum viable change, anchored to code I read)

### REQ-205 — failed run must leave a diagnosable reason on disk

- **Storage:** an **additive `error TEXT` column** on `runs`, using the exact idempotent idiom already
  used five times at `src/store/sqlite-run-store.ts:70–83`
  (`try { ALTER TABLE runs ADD COLUMN … } catch {}`). A pre-v35 row reads back `NULL` = "no recorded
  reason", never a crash — the same boundary `effective_params`/`price_book` already established.
- **Explicitly reject** a side `run_errors` table. It buys nothing (one row per run, read on the same
  path as the summary), costs a join on the `run_list` projection that `runs_name_status_created`
  was built for, and is exactly the speculative-generality the tie-breaker forbids.
- **Write site:** the same transition that flips the row to `failed`. `recordTransition` already
  persists the trail *before* flipping status; the error must land on the same side of that ordering
  so a reader never sees `status='failed'` with no reason.
- **Journal line:** mirror `recordResult`'s existing `{type:'result', value}` line with
  `{type:'error', code, message, detail?}` in the same `journal.jsonl` — same file, same append,
  no new artifact kind. This alone discharges the "run 目錄完全空" evidence.
- **Read surfaces:** extend `_rowToSummary` (`sqlite-run-store.ts:~250`) so `run_status`/`run_list`/
  dashboard read it off the row they already fetch. **Zero new read-time computation.**
- **`result()` (`run-manager.ts:946`):** today `{ok:false}` survives restart only for in-memory
  entries. After the column exists, the restart path must resolve the stored error to the same
  `{ok:false,error}` shape — this is the REQ's "引擎重啟後 `run_result` 仍答得出同一個原因" and it is
  a read-path change, not a shape change. The REQ is explicit that `result` column semantics must not
  be overloaded; a separate column is what preserves `{ok:false}` distinguishability. Agreed.

### REQ-206 — omitted `args` must be `{}`; declared `args.<k>.default` must apply

- Two independent defects; do not merge them.
  - `args: null` → `{}` is a **normalization at admission**, at the single site where `RunSpec.args`
    is fixed for the run (`run-manager.ts` `start()`, in the same block that computes
    `effectiveParams` at `:578`–`:628`), so scheduler and webhook triggers — which structurally never
    carry `args` — get it for free without each trigger path re-implementing it.
  - Declared defaults materialize into the **existing** `effective_params` snapshot (`run-store.ts:184`
    `createRun(spec, scriptVersion, effectiveParams, priceBook)`), which is already the run-immutable
    admission record and already the thing the sandbox reads. **No new field, no new plumbing.**
- **Ordering hazard worth stating in the design:** `effectiveParams` forks at `run-manager.ts:627` —
  the persisted copy is `redact()`-ed, the in-memory copy stays clear. Materialized arg defaults must
  enter **before** that fork. If they enter after, first dispatch sees the defaults but the persisted
  snapshot does not, and `:1046`'s resume path (`storedParams ?? defaultRunParams(...)`) hands the
  script *different args on resume than on first run* — a silent divergence, in the exact class of
  defect this iteration exists to kill. Sequencing constraint, not a new module.
- **Two write consumers, not one — I withdraw the word "single site" before someone else finds it.**
  Normalizing at admission fixes new rows. A pre-v35 row already persisted with `args = 'null'` still
  reaches the sandbox as `null` through the dispatch handoff at `:1221`
  (`entry.sandbox.run(runId, script, entry.args, null)`) on resume. Either that handoff also coerces
  `?? {}`, or legacy-row resume is declared out of scope **in writing**. Silence here is how the bug
  survives its own fix.
- The `params/contract.ts:428` prohibition is deleted **with the reason recorded in place**: P6-3
  banned the declaration because "served but never applied is a silent lie"; applying it discharges
  the premise. This is a reasoned reversal, and the comment must say so, or a future audit reads it
  as an amnesiac regression.

### REQ-207 — agent failure must be audible at run level

- **Correcting my own first instinct, because the code is cheaper than the design I was about to
  write.** I began by proposing a field computed at the terminal transition. Reading
  `sqlite-run-store.ts:338` kills that: `agentCount` is **already** derived in SQL from the existing
  `run_snapshots` JSON — `json_array_length(s.json, '$.agents')` — and projected into `_rowToSummary`
  (`:269`). REQ-207's signal is the same shape one predicate deeper. So the minimum is **no schema
  change, no new column, and no new write site at all**: one more projection on the query that already
  reads the snapshot (`SELECT COUNT(*) FROM json_each(s.json,'$.agents') WHERE …`), or, if that reads
  badly, derived in `_rowToSummary` from the same row. It survives restart because `run_snapshots`
  already does, and it costs one column's worth of derived state in a projection that exists.
- Precedent to copy exactly: `usagePresent = !!row.usagePresentRaw && (row.agentCount ?? 1) > 0`
  (`:264`) — a run with **zero** `agent()` calls must not read as unhealthy. Whatever predicate v35
  picks needs the same zero-agent guard, or every plain script run starts reporting a health signal
  it has no agents to justify.
- The rest of REQ-207 is served text (`workflow_authoring_guide`: a failed sequential `await agent()`
  returns `null` and does not throw — `types.ts:189` is deliberate; and `timeoutMs` bounds **one
  attempt**, multiplied by deployed `retries`). **Zero architecture.** I note only that the
  worst-case-wait arithmetic must be computable by the caller from advertised values — if `retries`
  is deployment-side and not advertised, the guide's promise is unmeetable and the *advertisement* is
  the change, not the guide sentence.

### REQ-208 — scanner must not read string content as code

- **Minimum:** one index-preserving literal-mask pass over the script before `AGENT_CALL_RE` runs
  (or an `inLiteral(idx)` span predicate in the shape of the existing `nestedWorkflowSpans` /
  `parallelCallSpans` / `altSpans` helpers). The codebase already has the tokenizer discipline:
  `matchDelimiter` (`workflow-meta.ts:137–148`) tracks `'`, `"`, `` ` `` and backslash escapes. **Reuse
  that state machine; do not import a JS parser.** A real parser is more correct and more isolable —
  and it is a new dependency, a new failure mode on syntactically-invalid-but-registerable input, and
  far more surface than the defect justifies.
- **Index preservation is load-bearing:** if masking is implemented, replace masked characters with
  spaces of equal length and **preserve newlines**, or `lineAt()` reports wrong line numbers and every
  violation hint points at the wrong line.
- **Three adversarial cases the fix must not open (these are the real risk of this REQ):**
  1. **Template substitution.** `` `${agent("x", {...})}` `` — `matchDelimiter`'s state machine treats
     a backtick as an ordinary string, so a naive mask **hides a real `agent()` call** from the guard.
     `${` … matching `}` inside a backtick must be treated as **code**, not literal.
  2. **Escaped quote.** `"he said \" agent (" ` — an escape mishandled by one character desynchronizes
     the mask for the remainder of the file, silently disabling the scanner downstream.
  3. **Comment containing an unbalanced quote.** `// don't` followed by real `agent(` calls — if
     comments are not handled, one apostrophe swallows the rest of the script.
  Each is a named test case; the REQ's "偵測能力不得下降" is only discharged if all existing
  `SCAN_VIOLATION` tests stay green **and** these three are added as new red-first tests.

### REQ-209 — printed examples must really register; `checkMermaid` must stop being silently degradable

- Of the REQ's three options I argue for **making the fifth parameter required**, and the cost is now
  quantified: there is exactly **one** production caller (`workflow-catalog.ts:548`, which already
  passes it). The break is confined to `tests/unit/check-mermaid.test.ts` (14 call sites; the 15th `checkMermaid(`
  hit in that file is its header comment) and `check-mermaid-v2.test.ts` (14, already 5-arg). The three
  other `src/` files that import from `check-mermaid.ts` are not callers — `authoring-guide.ts` imports
  `SHAPES`/`EDGE_FORMS`, the other two only mention it in comments. A compile-time break in tests is the cheapest
  possible enforcement and the only one with **no runtime branch to get wrong** — fail-closed and
  "not-covered marker" both keep a degraded mode alive and therefore keep the trap alive.
- **Consequence to accept openly:** the v1-only tests must now state an expectation for the v2 rules.
  That is the point — the v34 false green existed precisely because a caller could get a structurally
  incomplete pass and not know it.
- The doc-example guard (`guide-examples-register.test.ts` extended to DEPLOY.md/README blocks) must
  call the **real `workflow_register`**, not the static checkers — this is exactly the
  "mock-only counts as unverified" rule the workflow already enforces elsewhere, applied to docs.

### REQ-210 — envelope and size legibility

- **Zero architecture.** Advertised-text change (double-JSON encoding stated; guide size advertised).
  If a segmented/summary accessor is proposed by another panelist, I will oppose it in round 2 unless
  a measured size cap is shown to be exceeded by something other than one 39.5KB document.

---

## 3. The three lenses, argued separately

### (a) Security

**What is in scope.** REQ-205's new persist sink and unbounded `.detail`; REQ-208's deliberate
weakening of an admission-time guard; REQ-209's removal of a silently-degradable validation mode
(a security improvement — a guard nobody can accidentally half-run).

**Ranked risks:** unredacted secret → `runs.error`/`journal.jsonl`/`run_list` (HIGH, verified);
unbounded script-controlled `.detail` written to disk (MED); literal-masking creating a hiding place
for `agent()` calls that bypass label/tool-surface enforcement (MED); health field leaking per-agent
error text into a run-level surface with different read authorization (LOW — `audit_events` and
the owner/principal model already govern cross-owner reads, so the health field must be a **count or
enum, not error text**, and then this stays LOW).

**Explicitly N/A — the lens template does not fit this iteration; I will not manufacture threats:**
- *Brute force / lockout / failure counting* — N/A. There is no credential-failure counter in v35's
  scope. Authentication lives in `src/auth/` (OAuth/Google verifier/token store) and **no v35
  requirement touches it**. The only "failure counting" in scope is REQ-207's failed-*agent* tally,
  which is a diagnostic aggregate, not a security control; treating it as one would be the mistake.
- *JWT forgery* — N/A. No v35 requirement touches token minting or verification.
- *Timing attacks* — N/A. No secret-dependent comparison is added or moved.
- *Attack-surface growth* — one SQLite column, one journal line kind, one required function
  parameter. Surface does not grow; the *sink set* does, which is risk #1 above.

### (b) Scalability / performance

Deliberately short, because the honest answer is short. `better-sqlite3` is **synchronous and
single-process**; the engine is one node with a WAL-mode local DB. Horizontal scaling is not a
property this system has today and **v35 must not pretend to add it** — any proposal shaped as
"prepare for multi-instance" is speculative under the tie-breaker and I will oppose it.

What v35 actually does to performance:
- `runs.error` is on the row `run_list` already reads; `runs_name_status_created`
  (`sqlite-run-store.ts:~86`) is untouched because nothing filters or sorts on the new column.
  **Cost: one wider row. No new query plan.**
- REQ-207's health field computed at the terminal transition is O(agents) **once**, versus O(agents)
  on every `run_status` poll if computed at read time. Write-time is strictly better here and it is
  also the only version that survives restart.
- REQ-208's masking pass is one extra O(script) scan at **registration** time only — off the run
  hot path entirely. `MAX_META_LITERAL_BYTES` already bounds the input.
- REQ-205's journal append is `appendFileSync` on an **already-failed** run — nothing is waiting
  on it.
- **The one thing I want measured, not assumed:** `.detail` size. Everything else is noise; an
  unbounded JSON blob appended per failure is not.

**Concurrency/consistency that IS real here:** the terminal-transition write ordering. Persist the
reason **before** the status flip (the trail/status ordering `recordTransition` already documents at
`:217`), or a poller that catches the window reads `failed` with a `NULL` reason — and that is
precisely the "失敗的時候不出聲" symptom the whole iteration exists to kill, reintroduced as a race.
This is the single consistency requirement I would block on.

### (c) Testability

- **Win:** `toErr` → `src/errors.ts`. Pure function, no `RunManager`, no sandbox, no clock. REQ-205's
  `.detail` forwarding and the size bound both become plain unit tests. This is the lens's
  "injectable dependencies / clear module boundaries" ask, and it is one file move.
- **Win I under-argued in §2:** REQ-205's persist call belongs on the **`RunStore` interface**
  (`run-store.ts:184`), which `InMemoryRunStore` and `SqliteRunStore` both implement — exactly as
  `recordResult` already is. That is what lets the `.detail`-bound and redaction tests run against the
  in-memory store with no SQLite file, no temp dir, no cleanup. Same argument as the `toErr` move,
  applied one layer out; I should have made it there.
- **R4 is discharged by symmetry, not by new ordering logic:** the success path at `:1222–1223` is
  already `recordResult(...)` **then** `_transition('completed')`. The failure path mirrors it —
  `recordError(...)` then `_transition('failed')`. No new invariant to invent; just do not invert it.
- **Win:** the redaction obligation is testable at the same boundary — `redact()` is already
  injectable via `_secretValueProvider` (`run-manager.ts:111`, "Omitted → no redaction"). The test
  seeds a provider, fails a run, asserts the secret is absent from `runs.error` **and** from
  `journal.jsonl`. Note the existing opt-out: a test that forgets to inject the provider will pass
  vacuously. **The test must assert the redaction happened, not merely that the secret is absent.**
- **Win:** REQ-209's required parameter is enforced by `tsc`, the cheapest guard that exists.
- **Loss I accept:** REQ-208's masking is a private helper inside `workflow-meta.ts`. Testing it
  through `scanAgentCalls` is coarser than testing a tokenizer directly. I accept the coarseness over
  exporting a new surface for test convenience — the three adversarial cases are expressible as
  `scanAgentCalls` inputs.
- **Gap to close:** REQ-207's health field needs a test that plants a **restored** (post-restart) run
  whose `agents[]` came from `run_snapshots`, not from the live `_mergeLive` overlay
  (`run-manager.ts:~930`). Those are two different code paths and only the live one is easy to test —
  which is exactly why the persisted one will be the one that breaks.

---

## 4. Risks (consolidated, with what makes each disappear)

| # | Risk | Sev | Closed by |
|---|---|---|---|
| R1 | `resultError` becomes persist sink #5 with **no** `redact()` — verified bare at `run-manager.ts:1225`; DES-088's four-sink sweep predates it | **HIGH** | `redact()` at capture + a test asserting a seeded secret is absent from `runs.error` *and* `journal.jsonl` |
| R2 | `.detail` forwarded to disk unbounded, script-influenced | MED | serialized-size cap + explicit truncation marker, `MAX_META_LITERAL_BYTES`-style |
| R3 | Literal masking hides a real `agent()` call (`${agent(…)}`, escaped quote desync, comment-swallowed apostrophe) | MED | three named red-first tests + all existing `SCAN_VIOLATION` tests green |
| R4 | Reason written *after* the status flip → poller sees `failed` with `NULL` reason | MED | order the write with the transition, as `recordTransition` already orders trail-before-status |
| R5 | Arg defaults materialized *after* the `redact()` fork at `:627` → persisted snapshot lacks them → `:1046`'s `storedParams ?? defaultRunParams(...)` hands the script **different args on resume than on first dispatch** | MED | materialize before the fork; test the **resume** path, not just `start()` |
| R5b | Pre-v35 rows persisted with `args = 'null'` keep reaching the sandbox as `null` at `:1221` after the admission-time fix — the requirement reads closed while the reported symptom survives for existing runs | MED | coerce at the dispatch handoff too, or declare legacy-row resume out of scope in writing |
| R6 | REQ-209's required param makes 15 v1-only test call sites state a v2 expectation; done carelessly this becomes 15 rubber-stamp `expected` objects and the false green comes back wearing a new hat | MED | at least one v1 test must assert a **v2 rule firing**, not just compiling |
| R7 | Scope creep: six small fixes become an "error/observability subsystem" | MED | the `/sdlc-fix` routing at `01-requirements.md:2840` is the contract; hold it |
| R8 | Health field carries per-agent error **text** to a run-level surface with different read authorization than `audit_events` governs | LOW | count/enum only, never text |
| R9 | Masking shifts indices → every violation hint points at the wrong line | LOW | equal-length space substitution, newlines preserved; a test asserting line numbers |

---

## 5. Internal conflicts between my own three lenses (named, and adjudicated)

1. **Security ↔ Testability (REQ-208).** Testability wants a real JS tokenizer/parser: isolable,
   unit-testable, provably correct on the hard cases. Security wants the smallest possible change to
   an admission-time guard, because every new line in a guard is a new way for the guard to be wrong,
   and a parser brings a whole new failure mode (what does the scanner do with input the parser
   rejects but the catalog would accept?). **I rule for masking**, reusing `matchDelimiter`'s existing
   state machine, and pay for it with the three adversarial tests. Simplicity-first breaks the tie.
2. **Security ↔ Consumability (REQ-205).** The cold-agent consumer wants the *verbatim* error text;
   that is the entire point of the requirement. Redaction truncates exactly the strings most likely
   to appear in a genuinely useful message (a URL with a token in it). **Security wins outright, no
   compromise**: redaction is non-negotiable, and the consumability cost is mitigated by the
   redaction *marker* being visible, so the reader knows text was removed rather than seeing a
   mysteriously short message.
3. **Simplicity ↔ Consumability (REQ-207).** Karpathy says: don't denormalize, the caller can read
   `agents[]`. Consumability says a run whose every agent died must not read `completed`/`result:null`
   with no signal. **The requirement already ruled** (REQ-207 acceptance), the cold-subject evidence is
   real, and the field is computed at a write site that already exists — so the cost is one column's
   worth of derived state. I do not reopen it. I *do* hold the line at **count/enum, not a narrative**.
4. **Performance ↔ Security (REQ-205 `.detail`).** A size cap costs a serialize-and-measure on the
   failure path. That path is already failing and nothing is waiting on it. **Not a real conflict**;
   I name it only to close it.
5. **Testability ↔ Simplicity (the `toErr` move).** Moving a 7-line private function to another file
   is, strictly, churn. But REQ-205 *requires* a test for `.detail` forwarding, and the alternative is
   a test that boots a `RunManager`, a sandbox and a clock to observe one mapping. **Testability wins**
   — the move is one file, one export, zero behaviour change.

---

## 6. Expected disagreements with the other lenses

- **vs. an observability / quality-dimensions lens:** they will want a structured error *taxonomy*
  (typed codes, an error registry, maybe an event stream) so the dashboard can classify failures. I
  will oppose anything beyond `{code, message, detail?}` — `toErrorCode`/`codedError` already exist,
  v35 has six fix-shaped requirements, and a taxonomy is exactly the "新能力" the routing note excludes.
  Codes can be enumerated later from real data; inventing them now is guessing.
- **vs. a pragmatist/delivery lens:** they will likely propose reusing the existing `result` column
  with an `{ok:false}` envelope to skip the migration. **REQ-205 forbids it in as many words**
  ("不得塞進 `result` 欄"), and rightly: it destroys the distinguishability between "the script
  returned `{ok:false}`" and "the run failed". I will hold the separate column.
- **vs. a user-advocate / consumability lens on redaction (R1):** they will argue that redacting the
  error message defeats REQ-205's purpose for the cold agent it was written for. I concede the
  tension is genuine and still refuse — see conflict #2. Expect this to be the sharpest exchange.
- **vs. a correctness/formalist lens on REQ-208:** they will want a real parser. See conflict #1; my
  counter is the input-rejection failure mode and the fact that `matchDelimiter` is already the
  codebase's chosen answer to this exact problem. If they can show a case my three adversarial tests
  miss *and* masking cannot express, I will move.
- **vs. anyone proposing a `run_errors` side table or an "error service":** opposed on
  simplicity-first, and on the concrete cost of a join against `runs_name_status_created`.
- **vs. anyone proposing multi-instance/horizontal-scaling preparation:** opposed outright.
  `better-sqlite3` is synchronous single-process by construction; v35 is not the iteration that
  changes that, and half-preparing for it is worse than not preparing.
- **vs. a scope lens that says REQ-209's required-param break is too disruptive:** I expect
  "fail-closed when omitted" to be proposed as gentler. I oppose it — it keeps the degraded mode
  alive, and the v34 false green proves a degraded mode will eventually be used by accident. One
  compile error beats one silent half-validation.
- **Likely agreement (worth recording so round 2 doesn't spend time on it):** REQ-210 is text-only,
  and REQ-206's two halves must not be merged into one change.

---

## 7. One-line position

v35 needs **one additive column, one journal line kind, one derived count, one literal-mask pass, one
required parameter, and some honest prose** — plus the one thing nobody asked for and the security
lens insists on: **`redact()` on the error channel before it is ever written to disk.**
