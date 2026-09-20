# Design panel — adversarial group (interface-contract / boundary-error / testability), round 1

**Scope:** v35 slice, REQ-205..210 → ARCH-141..154 + ADR-065..071.
**Inputs read:** `01-requirements.md` (v35 block, lines 2735–2842), `02-architecture.md` (v35 slice, lines 4369–4560+), `state.yaml` `tech_stack`, and the named source seams (verified in this gate, line numbers below are from the working tree at `dc652d9`+dirty).
**Note on 03-tasks.md:** it exists on disk but carries no v35 rows — I treat the v35 task split as unwritten and flag the splits my lenses constrain in §6.
**Tie-breaker in force:** Karpathy simplicity-first — minimum design that closes the requirement, no flexibility nobody asked for.

---

## 0. Altitude judgement (system vs. agent) — done first, as instructed

This project is **both**, and v35 splits cleanly along that line. Forcing one altitude on all six REQs is how this slice would get reviewed wrong.

- **System altitude — REQ-205, REQ-206, REQ-208, REQ-209.** These are ordinary software contracts: a persistence port gaining two methods, an IPC message shape, an admission-gate parser, a compile-time signature. The consumer is code. The right questions are the classic ones: what is the type, what happens at the boundary, can a UT reach it without booting an engine.
- **Agent altitude — REQ-207, REQ-210, and the doc-bearing rows ARCH-151/152/154.** The consumer here is an **LLM reading `tools/list`, `initialize.instructions` and `workflow_authoring_guide` cold**. Both of v35's evidence sources are agent-altitude failures: a cold subject interpolated `null` into the next prompt, and a remote agent wrote `const a = args || {}` as a workaround for a contract the engine never stated. At this altitude:
  - *consumability* = the advertised surface states the failure mode **before** the caller can hit it (not after, in an error message);
  - *interface contract* = the advertised prose is **computed from the enforcement constants**, not transcribed beside them — a transcribed sentence is a v34-class false green;
  - *testability* = the test asserts the **number/word the agent will read equals the value the engine will enforce**, never that "a sentence exists".

Everything below is tagged (S) or (A) where the altitude changes the verdict.

---

## 1. Summary

The architecture is unusually strong for a fix slice: ADR-065..071 are well-argued, the redact-at-capture call (ADR-066) is correct and is the right kind of thing to do unasked, and ARCH-149's spans-as-predicate (rather than masked text) is the detail that makes REQ-208 safe. I am not attacking the shape of the slice. I am attacking six places where the design, as written, **does not reach the requirement it claims**, and two places where it **introduces a new failure that did not exist before**.

Ranked, with the evidence that makes each one a fact rather than an opinion:

| # | Sev | Lens | One line |
|---|-----|------|----------|
| D1 | **HIGH** | contract + boundary | `.detail` cannot exist at `toErr`'s input — `evaluateScript` rebuilds every failure as a two-field `{code,message}` literal. ARCH-141's forwarding and its byte bound are **dead code**, and the named example loses even its *code* two hops earlier. |
| D2 | **HIGH** | boundary | ARCH-144/ADR-071 put `args` inside `effectiveParams`, which `resume()` scans with `hasSecretMarker` — a run whose arg carried a secret becomes **permanently unresumable**. New defect, not named. |
| D3 | **HIGH** | boundary + testability | `run_list.failedAgentCount` reports **`0` for every non-terminal run** (single snapshot writer, at terminal only; `json_each` over a NULL snapshot yields 0, and the stated guard passes on NULL). The mandatory agreement test misses it unless it includes a *running* run. |
| D4 | MED-HIGH | contract | ARCH-148's "loaded on the **registration** path only" is false: `scanAgentCalls` has **five** production callers. Four have no refusal channel, so `SCRIPT_UNSCANNABLE` degrades them **silently** — REQ-208's own defect class, relocated. |
| D5 | MED | contract + simplicity | ARCH-145's "the declared default is validated like every other spec value" is **new code with no precedent** — `validateSpecShape` never looks at `.default`, and `validateDeclaredArgs` skips absent keys. Cheaper fix: materialize *before* validation and get one path. |
| D6 | MED | contract | Six concrete type/wiring gaps that will compile-error or silently narrow: `result()`'s return type, `ErrEnvelope.detail`'s `Record<string,unknown>` vs ARCH-141's `unknown`, `failedAgentCount: number` declared required but specified as omitted, `InMemoryRunStore`, the **four** read sites that must learn `r.error` (incl. `getRun`/`RunStatusView`, which ARCH-143 omits), and `toErr`'s second caller. |
| D7 | MED | boundary | The new `await recordError(...)` sits inside an **uncaught `.then()` continuation** — if the store write throws, the run never transitions and stays `running` forever. Persist-before-transition is right; it needs a `try/finally`. |
| D8 | MED | simplicity | ARCH-144's resume expression `submission.args ?? storedParams?.args ?? {}` **contradicts its own note** ("the snapshot copy is never promoted to the dispatch source") and the middle term is dead on both row generations. Delete it. |
| D9 | LOW-MED | contract (A) | ARCH-147 derives `attempts` from one of the **two** gateways; `client.ts:515` and `claude-agent-sdk-client.ts:507` disagree exactly in the untimed case the guide sentence is about. |
| D10 | LOW | testability (A) | ARCH-152's advertised size is memoized in module scope (a cross-test singleton) and measures the guide's own stringification, not `content[0].text`. Compute it per `initialize`; it is one `JSON.stringify` per connection. |
| D11 | LOW | boundary | `checkMeta` yields `span` only when meta is *found and parsed*; ARCH-149's blank is then a no-op and acorn (`sourceType:'script'`) hits the surviving `export` → `SCRIPT_UNSCANNABLE` replaces today's clearer refusal. Order the checks. |

---

## 2. Lens (a) — interface contract

### D1 (HIGH) — nothing with a `.detail` can reach `toErr`; ARCH-141's forwarding and its byte bound are dead code

REQ-205 requires: 「結構化標記(例如 `violation: AGENT_OPT_RETIRED`)能從 run 層的錯誤封包讀到」. ARCH-141 answers it by widening `toErr` to forward `.detail`, and bounds it with `MAX_ERROR_DETAIL_BYTES` because it is 「an arbitrary object from call sites reachable by script-controlled input」. Traced end-to-end against the source, **every** producer of `outcome.error` builds a fresh two-field literal:

- `sandbox/guards.ts:322-335` — `evaluateScript`'s catch has three branches and all three return `{ kind:'error', error: { code: …, message: … } }` constructed in place. `:288` (`SIZE_EXCEEDED`) and `:315` (`PARSE_ERROR`) do the same. This is the value the child sends at `child-entry.ts:146`, so **no thrown value's own properties survive at all** — not `detail`, not anything else.
- `sandbox/host.ts:147/166` — the agent/workflow throw relays build `{ code: ipcErrorCode(err,…), message }`; `:189`/`:199` (crash / spawn) likewise. `grep -n detail src/sandbox/*.ts src/ipc/*.ts` returns exactly one hit and it is a stderr-tail variable.
- `child-entry.ts:36` types the wire message as `error: { code: string; message: string }` — the shape has no slot.

So `outcome.error` at `run-manager.ts:1224` is **always** `{code, message}`. ARCH-141's widening has **no reachable input on the path ARCH-142 names**, and `MAX_ERROR_DETAIL_BYTES` bounds a value that cannot occur. Its unit test — build an `Error`, attach `.detail`, call `toErr` — passes forever while production loses every marker: the vacuous-test class this iteration exists to kill, reproduced inside the fix for it.

**And the loss starts one hop earlier than the detail.** `agent-executor.ts:547` throws `codedError('PARAM_UNKNOWN', detail, { param:'agentType', agent, violation:'AGENT_OPT_RETIRED' })`. That refusal *does* fail the run — contrary to a first reading of `types.ts:189`, the two agent-failure paths are different: a **gateway** failure (timeout, provider error) resolves `null` and does not throw, while an **engine refusal** is rejected into the script at `child-entry.ts:81` (`p.reject(Object.assign(new Error(msg.error.message), {name: code, code}))`). Uncaught, it reaches `evaluateScript`'s catch — where `refusalCode()` only recognizes `ENGINE_REFUSAL_CODES = new Set(['BUDGET_EXCEEDED'])` (`guards.ts:175`), so `PARAM_UNKNOWN` **flattens to `SCRIPT_ERROR`** at `:334`. REQ-205's own example therefore reaches the run-level packet today as `{code:'SCRIPT_ERROR'}` with the marker *and the code* gone, two hops before anything ARCH-141 touches.

The design owes one of these, in writing:

1. **Fix it where it breaks** — the minimum honest fix is *not* `toErr`: it is `guards.ts:322-335` (preserve `code`, and `detail` if carried), `host.ts:147/166` and `child-entry.ts:36/81`. Four files, one task (§6), an integration-tier test through a real sandbox, and `MAX_ERROR_DETAIL_BYTES` then guards a genuinely script-influenced value. Note this also widens what a *script* can attach to a thrown object and get onto disk — which is exactly why the bound must land in the same task, not after it.
2. **Delete the forwarding and the bound; keep the file move.** ARCH-141's move of `toErr` into `src/errors.ts` is worth doing on its own (see C2), and the slice then honestly states: run-level errors are `{code,message}`; `.detail` is not carried across the sandbox seam; REQ-205's fourth criterion is **deferred with its four line numbers**.

**My vote, on simplicity: (2) for v35.** (1) is a four-file widening of an IPC contract plus a new script-controlled disk channel, inside a slice whose thesis is 「no new subsystem, deltas at known lines」. What is **not** acceptable is the current row: (1)'s code without (1)'s seam, carrying a bound for input that cannot arrive, tested by a UT that cannot fail. If the panel prefers (1), it must also decide whether `SCRIPT_ERROR` flattening is in scope — fixing `detail` while the *code* is still flattened closes the smaller half of the gap.

### D5 (MED) — the P6-3 reversal's premise is only half discharged

ARCH-145 deletes `contract.ts:428-431` and says the declared default is then "validated against the spec's own `type`/`enum`/range like every other spec value". Verified: **no such validation exists**. `validateSpecShape` (`contract.ts:228-258`) checks `type`, `enum` shape, `min`/`max` *shape*, and two enum rules — it never reads `spec.default`. And `validateDeclaredArgs` (`:665-673`) starts with `if (!(key in obj)) continue;` — an **absent** key is never checked, which is exactly the key a default fills.

Consequence if the row is implemented literally: `{ type:'number', default:'abc' }` registers, materializes, and reaches the script as a string. P6-3's premise ("served but never applied is a silent lie") is discharged; a *new* one ("applied but never validated") is created in the same edit.

**Karpathy fix, cheaper than the row as written:** materialize **before** `validateDeclaredArgs` (i.e. at `run-manager.ts:574`, not inside the `:578-628` block), so the materialized value flows through the *existing* `checkValueAgainstSpec` path. One validation path, no new validator, and the admission error message a caller sees is the one that already exists. If the panel still wants registration-time rejection of a bad default (I would take it — failing at register beats failing at every run), it is one line: `checkValueAgainstSpec(`args.${key}.default`, spec.default, spec)` in the loop where the ban is being deleted. Name it in the design; do not let "like every other spec value" imply code that is not there.

Boundary note for the same move: materializing before validation also means a caller-supplied `undefined` for a declared key is filled by the default, which is the behaviour a caller expects from the word "default". State it either way.

### D4 (MED-HIGH) — the oracle does not run "on the registration path only"

ARCH-148 says acorn "is loaded on the **registration** path only". Verified callers of `scanAgentCalls`:

```
src/workflow-catalog.ts:487   ← the admission gate (has a refusal channel)
src/workflow-meta.ts:57       ← label extraction
src/dashboard.ts:301          ← dashboard render
src/server.ts:540             ← skeleton graph
src/mcp-facade.ts:494         ← per-call projection
```

Two consequences, and they pull in opposite directions:

- **Contract:** the statement in the ADR is wrong as written and should be corrected before it is quoted in a later audit as a scoping guarantee. acorn parses on every dashboard render and every describe-class read.
- **Boundary:** ARCH-149's fail-closed returns `{ calls: [], labels: [], violations: [{code:'SCRIPT_UNSCANNABLE'}] }`. The gate refuses loudly. The other four **do not look at `violations`** — they read `.calls`/`.labels`. Under the acorn↔V8 version drift the valve exists for, the dashboard renders an empty graph, `workflow_describe` shows zero agents, and nobody is told. A guard that cannot tell you it ran, one level out.

**Minimum fix:** `AgentCallScan` gains `unscannable?: true` (one optional field, no existing consumer breaks), and the four read callers each get one line that surfaces it as a visible marker instead of an empty result. Five lines total, and it keeps the gate and the skeleton agreeing on the same script — which is why "run the oracle only at the gate" is *not* the answer (the gate and the skeleton would then disagree about phantom nodes).

### D6 (MED) — six typing/wiring gaps that the rows do not name

1. `RunManager.result()` is declared `Promise<{ok:true;value} | {ok:false;error:{code:string;message:string}}>` (`run-manager.ts:942`). ARCH-142 returns a stored value carrying `detail?`. Widen the declared type or the detail is invisible to every TS consumer (it survives at runtime by structural typing, which is worse — present in the JSON, absent from the type).
2. `ErrEnvelope.detail` is `Record<string, unknown>` (`types.ts:63`); ARCH-141 declares `detail?: unknown`. A non-object detail cannot be assigned at `mcp-facade.ts:658`. Pick one: I would type `toErr`'s detail as `Record<string, unknown> | undefined` and coerce a non-object into `{ value: … }` at capture, so the two ends agree by construction.
3. ARCH-146 writes `RunStatusView` gains **`failedAgentCount: number`** (required) and then says it is "omitted rather than reported as `0`". Those are different types. It must be `failedAgentCount?: number`.
4. `InMemoryRunStore` (`run-store.ts:273`) implements the same port and must gain `recordError`/`getError`. No ARCH row names it; TS will force it, but the task list must own it or the parallel implementer discovers it as a red build.
5. `runs.error` lives on `runs`, **not** on the snapshot — so `_USAGE_PROJECTION` is the wrong home. Both `SELECT` lists that build a `RunSummary` (`sqlite-run-store.ts:342` `listRuns`, `:373` `list`) enumerate their columns explicitly and each needs `r.error` added, plus `_rowToSummary`'s row type. And there is a **fourth** site ARCH-143 does not mention: REQ-205 names `run_status`, which is `RunStatusView`, built by `getRun` (`:274-300`) — it uses `SELECT *` so the column arrives for free, but the row type and one conditional-spread line must be added there, and `RunStatusView` needs `error?`. Four sites, at least two easy to forget — this is the repo's own named `composeConfig` wiring class, and it deserves a test that exercises `listRuns()`, `list({})` **and** `getRun()` on one failed run.
6. `toErr` has **two** callers, not one: `run-manager.ts:1225` and `:1306` (the nested-`workflow()` outcome). ARCH-141's 「its only caller」 is wrong, and `:1306`'s consumer changes shape too if the forwarding lands. Cheap to fix, expensive to discover at Gate 6.

### D9 (LOW-MED, agent altitude) — `attempts` is gateway-dependent and the two gateways disagree

ARCH-147 takes the rule from `claude-agent-sdk-client.ts:507` (`attempts = effTimeout !== undefined ? 1 + retries : 1`) and carries the untimed exception into the guide. But `src/gateway/client.ts:515` computes `const attempts = 1 + Math.max(0, this._config.retries)` — **unconditionally**. `tech_stack` says both gateways ship, with `"gateway":"sdk"|"direct-fetch"` selecting at the composition root.

In the *timed* case (the case `timeoutMs` is advertised for) they agree, so `worstCaseMs` is safe. The **guide sentence about the untimed exception is wrong for `direct-fetch`**. Fix: the advertised `attempts` must be read from the effective gateway (it is already a `composeConfig`-class forward, so the existing wiring guard covers it), and the guide states the rule without the SDK-only exception — or states it as gateway-dependent and points at `workflow_describe` for the number. At agent altitude the computed number is the load-bearing part; the prose exception is the part a cold reader will over-generalize.

---

## 3. Lens (b) — boundary & error

### D2 (HIGH) — putting `args` into `effectiveParams` makes some runs unresumable

ARCH-144/ADR-071 add `effectiveParams.args = resolvedArgs`, and the snapshot is persisted through `redact()` at `run-manager.ts:626-627`. `resume()` then executes, at `:766`:

```ts
if (hasSecretMarker(entry.effectiveParams)) throw codedError('PARAM_SECRET_UNAVAILABLE', …)
```

and `hasSecretMarker` (`secret-resolver.ts:124`) is a blunt whole-object scan: `JSON.stringify(value).includes(MARKER_PREFIX)`.

Today `args` are stored raw in `runs.args` (`sqlite-run-store.ts:112`), are never redacted, and are outside that scan. After ARCH-144 they are inside it. So:

- a run whose `args` contained a provisioned secret value is redacted into the snapshot at admission, and on the **first resume** is refused `PARAM_SECRET_UNAVAILABLE` — **permanently**, because the marker is in a run-immutable row. That run can never be resumed again, where today it resumes fine.
- second-order, and cheaper to hit than it sounds: an arg whose literal text merely *contains* the marker prefix trips the same scan.

ADR-071 names the adjacent hazard (never promote the snapshot copy to the dispatch source) and explicitly does not name this one. It must be decided, not inherited. Options, in my order of preference:

1. **Scope the marker scan to the dispatched fields** — `hasSecretMarker` is applied to `effectiveParams` *minus* `args`, since `args` is not the dispatch source (that is `entry.args`/`runs.args`, by ADR-071's own decision). One expression, and it is consistent with the reason the check exists: it guards what will be *dispatched*, and `effective_params.args` is by design a *record*.
2. Persist `args` into the snapshot **unredacted**. Rejected: it breaks the redact-at-persist invariant for a whole new field class and contradicts DES-088.
3. Do not put `args` in `effectiveParams` at all; treat REQ-206's 「materialize 進既有的 `runs.effective_params`」 as satisfied by `runs.args`. This is ADR-071's option (c), already rejected for a stated reason — but it becomes live again if (1) is judged too clever.

Whatever is chosen, it needs its own test: **an arg containing a provisioned secret, admitted, suspended, resumed** — asserting the run resumes and the script receives the *raw* value. Without that test this defect ships green, because no existing test puts a secret in `args`.

### D3 (HIGH) — `failedAgentCount` on `run_list` is `0` for every run that has not terminated

Three verified facts compose into a false "healthy":

1. `saveSnapshot` has exactly **one** call site in production: `run-manager.ts:1119`, inside `_transition`, under `if (TERMINAL.includes(to))`. The only other writer of that table, `backfillUsage` (`sqlite-run-store.ts:310-320`), returns early unless the run is already terminal — and when it writes a row of its own it is **`{usage}`-only, with no `agents` key**. So a `queued`/`running`/`suspended`/`interrupted` run has no `run_snapshots` row at all, and a terminal run can have one whose `$.agents` path is missing. Both produce the same NULL `agentCount`, so both fall into the hole below.
2. `LEFT JOIN run_snapshots` therefore yields `s.json IS NULL`, and — measured in this gate with `better-sqlite3`, not assumed — `(SELECT COUNT(*) FROM json_each(s.json,'$.agents') …)` over a NULL document returns **`0`**, not NULL and not an error, while `json_array_length` returns NULL:

   ```
   [{"runId":"a","agentCount":2,"failedAgentCount":1},
    {"runId":"b","agentCount":null,"failedAgentCount":0}]   ← b has no snapshot
   ```
3. ARCH-143 surfaces the field "under the existing `(row.agentCount ?? 1) > 0` guard". With `agentCount === null` that is `1 > 0` → **true** → the field is emitted as `0`.

So `run_list` answers "zero agents have failed" about a run it knows nothing about, and keeps answering it for the entire lifetime of a run — which is precisely when a caller polls for health. Meanwhile `run_status` (ARCH-146) folds **live spawner records** via `_mergeLive`, so the same run with one dead agent says `1` there; and even after a restart `getRun` falls back to `deriveAgentRecords(this._allTranscripts(runId), status)` (`sqlite-run-store.ts:290`), so the TS side still has agents to fold where the SQL side has none. **Two surfaces, same run, same instant, different answers**, and ADR-067's mandatory agreement test ("one run, both surfaces, same number") misses it entirely if it only exercises a terminal run.

Note also that ARCH-143 quoted half of the real predicate: the conjunct that protects `agentCount`/`costUSD` today is `usagePresent = !!row.usagePresentRaw && (row.agentCount ?? 1) > 0` (`sqlite-run-store.ts:~264`), and it is `usagePresentRaw` (NULL → falsy on a missing snapshot) that does the protecting. Copying only the second half copies the wrong half.

**Design must state, precisely:**
- the SQL guard is `row.agentCount != null && row.agentCount > 0` — i.e. **snapshot present and non-empty**, so the field is *omitted* for a run with no snapshot and for a zero-agent run;
- `run_list`'s health signal is **terminal-only**, in one sentence, on the advertised surface (agent altitude: a cold client polling `run_list` must not read absence as health);
- the agreement test matrix is **five** cases, not one: (i) terminal, mixed pass/fail — both surfaces equal and non-zero; (ii) terminal, zero agents — both omit; (iii) **running, one agent already failed** — `run_list` omits, `run_status` reports `1`; (iv) a pre-v35 row with no snapshot — both omit, no crash; (v) a terminal run whose snapshot is `{usage}`-only (`backfillUsage`'s row) — both omit.

Case (iii) is the one that makes the test worth writing. Without it, ADR-067's "one obligation" is discharged by a test that cannot fail.

### D7 (MED) — the new `await` is inside an uncaught continuation

`_runLive` (`run-manager.ts:1216-1227`) is `entry.sandbox.run(...).then(async (outcome) => { … })` with **no `.catch`**. ARCH-142 inserts `await this._store.recordError(runId, entry.resultError)` *before* `this._transition(runId, entry, 'failed')`. `recordError` per ARCH-143 does an `UPDATE` plus an `appendFileSync` to the run directory.

If that write throws — disk full, EACCES on the run dir, a `JSON.stringify` that throws on the serialized value — the transition never runs, the run stays `running` **forever** (it is not even `interrupted`, so nothing resumes it), and the rejection is unhandled. The failure-recording path becomes a new way to lose a run, inside the iteration whose thesis is "this engine is silent when it fails".

The **success branch already has the identical shape** — `await this._store.recordResult(...)` at `:1222` inside the same uncaught continuation — so this is not a v35-only defect and should not be patched as one. It is a pre-existing hole that v35 widens (it adds a second, filesystem-touching write on the branch that is *already* the unhappy path), and the honest fix is symmetric across both branches, which also removes the 「pre-existing, not ours」 rebuttal at review.

Ordering persist-before-transition is still correct (ARCH-142's reason is sound: a poller must never see `failed` with a NULL reason). The design owes the **failure mode of the recorder itself**:

```ts
try { await this._store.recordError(runId, entry.resultError); }
finally { await this._transition(runId, entry, 'failed'); }
```

plus a `.catch` on the continuation as a backstop. And the serialization must not be able to throw: `JSON.stringify` throws on a `BigInt` and on a cycle, and `redact()` (`secret-resolver.ts:104-115`) has **no cycle guard** at all — `walk` recurses through objects with no seen-set. Today both are unreachable because `outcome.error` has crossed an IPC boundary and is a plain `{code,message}`; under D1 option (1) they become reachable the same day. Bound and serialize defensively at capture — `{ unserializable: true }` is a marker, silence is not — and state the choice so the next reader knows it was a decision.

Named tests: `recordError` throws → run still transitions to `failed`, and `run_status` shows `failed` (the reason is lost, which is honest; the run is not).

### D11 (LOW) — order the meta check before the parse

ARCH-149 blanks "the `checkMeta` span". `MetaCheck` (`sandbox/guards.ts:15-24`) carries `span?` and only when meta is **found and parsed**; `pureLiteral:false` / not-an-object-literal cases return no span. With no span, the `export const meta =` text survives into acorn with `sourceType:'script'`, which cannot admit `export` → `{ok:false}` → `SCRIPT_UNSCANNABLE`. The author gets a new, vaguer refusal in place of today's specific one (`script-checks.ts`'s `OFFENDING_CONSTRUCTS` messages, written precisely because a cold subject was defeated by `Unexpected token 'export'`).

Fix is ordering, not code: the design states that `scanAgentCalls` treats "no meta span" as **"do not invoke the oracle"** (fall back to today's behaviour) or that the meta/parse checks are guaranteed to run first on every path that reaches the scanner. Minor second point: `script.replace(meta.span, blank)` replaces the **first textual occurrence** of that string, not the span at its offset — fine in practice, worth one comment since the whole design rests on offsets being the author's own.

---

## 4. Lens (c) — testability

**What is already injectable, so nobody re-litigates it:** the clock is injected (`this._clock.isoNow()`), storage is a port with two implementations (`RunStore`, `InMemoryRunStore`, `SqliteRunStore`), the secret provider is injected (`this._secretValueProvider`), and the gateway is injectable (`queryImpl`). No v35 row needs a new seam for testability. ARCH-141's file move is the one genuine testability improvement in the slice — and see C2 below for why it does not discharge the requirement it is attached to.

**Every DES in this slice is UT-coverable except three, which need an integration tier — say so in 03-tasks.md rather than discovering it at Gate 5:**

| Claim | Tier | Why not a UT |
|---|---|---|
| ARCH-142 restart honesty | **IT** | needs a second `RunManager` over the same SQLite file (a fresh `_runs` map is the point) |
| ARCH-144 resume materialization | **IT** | REQ-206's acceptance is on the **resume** path, through the store |
| ARCH-151/REQ-209 doc examples | **IT** | must call the **real** `workflow_register`, per the REQ's own text |

**The three vacuous-test traps in this slice** (each one passes while the defect ships; each must be written as an assertion that *cannot* pass without the fix):

1. **Redaction (ADR-066, already flagged in `state.yaml`).** A test that asserts "the secret is absent from `runs.error`" passes when no `_secretValueProvider` was injected. Required shape: inject a real provider, seed a real secret, force a failure whose message contains it, assert the **marker is present** and the raw value absent. Assert presence, never absence alone.
2. **`.detail` forwarding (D1).** A UT that hand-builds `Object.assign(new Error('x'), {detail:{…}})` and calls `toErr` passes forever while every production path rebuilds the error as `{code,message}` at `guards.ts:322-335`. Required under D1 option (1): an **IT through a real sandbox** that throws a detail-carrying refusal and asserts it on `run_result`. Under option (2) there is no test, because there is no code — which is the point.
3. **Agreement (ADR-067).** Terminal-only ⇒ cannot fail. Required: the four-case matrix in D3, with case (iii) running.

**Two more tests the rows imply but never name:**
- `MAX_ERROR_DETAIL_BYTES`: a detail one byte over the bound yields `{truncated:true,bytes:n,…}` and the **raw detail is absent** — the marker is the contract, so assert the marker, not the size.
- Ordering (ARCH-142's third decision): an `InMemoryRunStore` spy records call order; assert `recordError` precedes `recordTransition(...,'failed')`. This is the only way the "poller sees `failed` with NULL reason" race is pinned, and it is a 10-line UT.

**Agent-altitude testability (A)** — ARCH-152/154 must be behaviour tests, not prose matches:
- assert `initialize.instructions` contains a number **equal to** `Buffer.byteLength(JSON.stringify(buildAuthoringGuide(ceilings)))` computed in the test — a regex for `/\d+ ?KB/` is the v34 false green;
- assert **both** `initialize` sites (`server.ts:1240`, `:1482`) carry it — two sites is exactly how the pair of envelope writers drifted before;
- D10: the memo. `buildAuthoringGuide` memoized in module scope is a singleton across a test file, and ceilings differ per test fixture. It is one `JSON.stringify` of ~40KB per *connection* (not per tool call). **Simplicity: drop the memo**, or hang it off the server instance. A module-level cache is a testability cost bought with no measured benefit.
- Also state the honest gap: what a caller receives is `content[0].text` = `JSON.stringify(result)` of the **whole tool result**, not of the guide object alone. ARCH-152 advertises the guide's stringification. If the envelope adds a non-trivial constant, say so, or advertise the number the caller can actually compare against.

---

## 5. Where my own three lenses conflict (stated, not smoothed over)

- **C1 — `detail`'s type.** Contract wants `Record<string, unknown>` so it assigns to `ErrEnvelope.detail` without a cast. Boundary wants `unknown`, because a thrown value's `detail` is whatever someone attached and narrowing at capture loses information silently. Testability wants whichever makes the pure function's signature total. **Resolution (simplicity):** `Record<string, unknown>` at the port, with a non-object detail coerced to `{ value: … }` **at capture** — one place, total, and the two ends can never disagree.
- **C2 — ARCH-141's file move.** Testability's case for it is correct and I endorse it. Boundary's objection is that the test it enables is **exactly the vacuous one** (D1). These do not reconcile: the move is good, and it must not be presented as discharging REQ-205's fourth criterion. The design should say both sentences.
- **C3 — fail-closed reach.** Boundary wants `SCRIPT_UNSCANNABLE` to be loud at all five callers. Contract objects that four of them have no refusal channel and widening `AgentCallScan` is a shape change with five consumers. **Resolution (simplicity):** one optional field (`unscannable?: true`), four one-line reads. Cheaper than either "refuse everywhere" or "accept silent degradation".
- **C4 — present-vs-omitted.** Contract prefers a field that is always present (`0` means zero) because a stable schema is easier for a cold client to reason about. Boundary insists on omission, because `0` on a run with no snapshot is a lie and REQ-207 exists because of a number that meant nothing. **Karpathy tie-break: omit.** The requirement is about a signal that cannot be misread; a schema-stability argument loses to a correctness argument at the same cost.
- **C5 — D1's resolution.** Contract prefers option (1) (fix the seam at `guards.ts`/`host.ts`/`child-entry.ts`: the requirement is then literally met, code included). Simplicity prefers (2) (delete the dead forwarding and the bound, keep the file move, defer the criterion with its line numbers). I propose **(2)**, and record that the contract lens dissents — if the synthesizer takes (1), it must take the four-file task, the sandbox-tier test and the `SCRIPT_ERROR`-flattening decision with it, not just `toErr`.

---

## 6. Where task-splitting affects these lenses (03-tasks.md has no v35 rows yet)

1. **`src/run-manager.ts` is touched by four ARCH rows** (141 caller, 142, 144, 146). With ~20 implementers on one shared working tree, this file must belong to **exactly one task**. Splitting REQ-205 and REQ-206 into two tasks that both edit it is how uncommitted work gets lost.
2. **D1 option (1), if chosen, is one task spanning `sandbox/child-entry.ts` + `sandbox/host.ts` + `errors.ts` + `run-manager.ts`.** An IPC shape split across two tasks ships a type that compiles and a wire that drops the field.
3. **The `acorn` dependency move (`package.json`, exact-pinned) must be its own first task, sequenced before ARCH-148/149.** A parallel implementer running the suite without the dependency installed gets a false red and "fixes" it.
4. **ARCH-150's breakage is mechanical and large** (one production caller; `tests/unit/check-mermaid.test.ts` and `check-mermaid-v2.test.ts` together hold ~29 `checkMermaid(` call sites — the row says 14, and the count should be re-taken before it becomes a task estimate). Separate task, sequenced **after** the signature change, with the Gate-5 constraint written as an explicit acceptance line: *at least one converted test asserts a v2 rule firing*. A task that only says "make it compile" will produce 14 rubber stamps, which ADR-069 itself predicts.
5. **The three-site `SELECT` wiring (D6.5) and the `InMemoryRunStore` port implementation belong to the same task as `recordError`**, or the port grows a method nobody implements.

---

## 7. Risks

| R | Risk | Sev | Mitigation I propose |
|---|---|---|---|
| R1 | `.detail` forwarding + byte bound shipped as code with no reachable input; REQ-205 marked verified on a UT that cannot fail | HIGH | D1: delete both and defer the criterion with its four line numbers, or fix the seam (`guards.ts`/`host.ts`/`child-entry.ts`) with an IT |
| R2 | A run with a secret in `args` becomes permanently unresumable | HIGH | D2: scope `hasSecretMarker` to the dispatched fields; add the secret-in-args suspend/resume test |
| R3 | `run_list` health reads `0` for the entire life of a run; agreement test cannot fail | HIGH | D3: snapshot-present predicate, terminal-only stated on the surface, four-case matrix incl. a running run |
| R4 | `SCRIPT_UNSCANNABLE` degrades four read surfaces silently | MED | D4: `unscannable?: true` + one line per consumer |
| R5 | A store failure in the new persist step leaves a run `running` forever | MED | D7: `try/finally` + `.catch` backstop + serialization that cannot throw |
| R6 | A declared `args` default materializes unvalidated (new silent lie replacing the old one) | MED | D5: materialize before `validateDeclaredArgs`; optional registration-time check on `.default` |
| R7 | Advertised `attempts` correct for one gateway, wrong for the other | LOW-MED | D9: read from the effective gateway; drop the SDK-only exception from the guide prose |
| R8 | The advertised guide size drifts from what the caller receives; module-level memo leaks across tests | LOW | D10: compute per `initialize`, assert equality against a freshly computed value |

---

## 8. Expected disagreements with the other lens (quality-dimensions)

1. **Run-health signal: count vs. richer payload.** They will argue observability/consumability for a status enum, a ratio, or the failing labels — at *agent* altitude an LLM reads `failedAgentCount: 3` and still has to ask for the denominator. I hold ARCH-143's R8 line: **a count, never narrative text**, because `/api/runs*` are unauthenticated reads (`server.ts:609`, `:1281`) and per-agent error text is gated differently. I will concede the *denominator* — `agentCount` must be present whenever `failedAgentCount` is, under the same guard, or the count is unreadable.
2. **Presence vs. omission (C4).** They will want the field always present for schema predictability, and self-sustainability will push them toward "0 is a fine default". I will argue omission, with D3 as the evidence that `0` is a measurable lie for the majority of a run's lifetime.
3. **`structuredContent` now vs. v36.** Observability/consumability will want it in v35 ("two lines"). ADR-070 already measured the cost (~79KB on the exact document that truncated the cold subject twice) and it needs a per-tool `outputSchema` to be trustworthy. I hold **v36**, and expect to have to restate the measurement rather than the preference.
4. **D4's resolution.** They may want the oracle's fail-closed to be uniform everywhere ("replaceability: one behaviour, one name"). I want the four read paths' behaviour *specified* rather than uniform — a dashboard cannot refuse, so it must mark.
5. **D2.** I expect agreement that it is a real defect and disagreement on the fix: they will likely prefer ADR-071 option (c) (keep `args` out of `effectiveParams` entirely) on self-sustainability grounds — fewer invariants to hold — while I prefer scoping the marker scan, because (c) drops the audit record REQ-206 explicitly names. This is the one place where I expect to be argued out of my position.
6. **ARCH-141's file move.** They will read it as an unambiguous win (testability, replaceability). I agree it is a win and will insist, loudly, that it does not discharge REQ-205's fourth criterion (C2) — I expect this to be read as pedantry and it is not: it is the difference between a green row and a fixed defect.
