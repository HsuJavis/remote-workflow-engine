---
stage: architecture
iteration: v36
panel: architecture
lens: adversarial (security / scalability-performance / testability, Karpathy simplicity tie-break)
round: 2 (responses + final position)
scope: REQ-211..REQ-216
read: quality-dimensions.r1.md, adversarial.r1.md
---

# Adversarial architecture group — round 2

## 0. Headline

The panel's one genuine fork — REQ-215 Design A ("widen the wire") vs. Design B ("the parent
already knows; don't widen it") — **dissolves**. Both r1 documents were arguing about *what kind of
payload crosses upward*, and the answer neither of us wrote down is: **an integer**. The parent
mints the refusal, records it in `RunManager` keyed by the `callSeq` it already owns, and the upward
IPC envelope gains one optional `refusalRef: number`. That satisfies REQ-215(a) literally (a four-file
additive IPC contract change), gives Design A's exact causality, and gives Design B's security
property — clause (c)'s「腳本可控物件寫進磁碟」channel **is not created at all**, because nothing
script-authored and nothing string-shaped crosses upward.

I move off my r1 "primary design" (payload-carrying `WeakMap` + host-side allowlist/bound/redact
over a new `detail` field) to this. The WeakMap survives; it carries a `callSeq` instead of a
payload, which deletes the allowlist table, the byte bound, the redact-then-cap ordering hazard and
three unit-test files from the diff. Credit where due: quality-dimensions' Design B observation —
that the parent holds the full object at `host.ts:143` *before* it ever flattens it downward — is
what forced this, and it is correct.

Two factual corrections of record are in §3; one of them (`journal.jsonl` is **per-run**, not the
operator log stream) invalidates the coupling quality-dimensions built its rotation argument on,
and relocates that debt to a file neither r1 named.

---

## 1. Response to quality-dimensions.r1 — rebut / concede / hold

| # | Item | QD r1 position | My r1 position | **r2 verdict** | Reason |
|---|---|---|---|---|---|
| D1 | REQ-215 Design A vs B | B is smaller for parent-minted codes; reads (a)'s 「缺一不可」 as having already chosen A; asks adversarial to ratify or contest | A (primary), B-shaped host ledger as fallback | **integrate — neither; `refusalRef`** | §2. Dominates both: exact causality (A's advantage) + no new script-controlled channel (B's advantage) + literal compliance with (a). |
| D2 | B's "inferred causality" weakness | B can only say "the run died after a refusal was issued"; a script that catches and then fails elsewhere misattributes | (same concern, unstated) | **rebut QD's own objection to B** | The ref is keyed on the **rethrown Error object identity**, not on run chronology. Rethrow-the-same-error → ref travels; throw-a-new-error → no ref → `SCRIPT_ERROR`. That is the semantically correct answer in both branches, and it is *more* exact than A. |
| D3 | REQ-215 allowlist size | expects adversarial to want narrower; SET is the friction point | one addition: `PARAM_UNKNOWN(+violation)` | **hold, and narrow the question** | Under `refusalRef` the wire-trust question disappears; (b) reduces to a **host-side policy list** of which refusals are recorded+lifted, plus the one real remaining wire question in D4. |
| D4 | `ENGINE_REFUSAL_CODES` (guards.ts:175) | treated as the thing REQ-215(b) widens | same | **hold — but flag that it serves TWO purposes** | It governs (i) top-level code preservation *and* (ii) the v25/REQ-120 exemption from `parallel()`/`pipeline()` null-folding. `refusalRef` replaces (i). **(ii) still needs the one-line widening** and is a live part of (b): should an `AGENT_OPT_RETIRED` refusal inside `parallel()` null-fold, or propagate? Neither r1 asked. My answer: propagate — it is an engine refusal, identical in kind to `BUDGET_EXCEEDED`, and the v25 incident (a silently lost third researcher) is the precedent. |
| D5 | REQ-212 fix shape | "add a field, don't repurpose `null`" — ownership semantics at `:233-239` must not change | 4-field `Actor` struct + `idSource` | **converged, no gap** | The `Actor` struct *is* QD's rule executed: the two contracts become two **fields** (`bypass`, `id`), not two readings of one value; `null`-means-any survives as `actor.bypass === true`. I keep `idSource: authenticated\|claimed\|none` — QD did not raise it, and without it the fix attests to a caller-supplied string (`bypassWithArg`, mcp-facade.ts:236-240). |
| D6 | K1+K2 in the same PR | same PR — cheaper, same files | K2 first, **separately** | **concede the PR, hold the ordering** | This was scoping-vs-commit-ordering, not a real disagreement. Same PR; **K2 as its own commit landing first, with its redact-before-slice test written first**; K1 then takes the bound as a parameter (4096 bytes vs 200 chars — R-4). Both satisfied. |
| D7 | Emit REQ-213's journal line from inside `captureFailure` | "the natural place — every failure funnels through it" | (not addressed) | **rebut** | Two engineering reasons. (i) **A successful terminal is still a terminal** — REQ-213 says 「任何 run 到達終態」, and a completed run never touches `captureFailure`, so half the requirement would be unimplementable there. (ii) K1's entire value is that `captureFailure` is **pure** (QD's own words); putting I/O inside it forfeits that and makes it untestable without a sink. Emit at the terminal-transition site (`_transition`, the one authoritative terminal writer ARCH-032 already rides); `captureFailure` is one of its inputs, not the emission point. |
| D8 | K5 — lean toward a default LIMIT on `listRuns()` | lean add; defers ruling to synthesis | adjudicate **NO** for `listRuns`, YES for the `listSummaries()` carve-out | **hold, with new corroborating evidence** | `run-manager.ts:860` states it in the codebase's own words: *"Boot recovery and the GC sweep stay on `store.listRuns()` directly — they need every row, not…"*. A LIMIT there is a boot-recovery and workspace-reclaim **data-loss bug sold as a scalability fix**. Also: QD's cost argument ("REQ-213 touches the same surface this round") does not hold — REQ-213 touches `workflow_list`; K5's cliff is `/api/runs`+`/api/home`. Different surface, no shared marginal cost. The carve-out (`listSummaries()` → paginated `list()`) delivers what QD actually wants. |
| D9 | REQ-213 × log rotation coupling | must be named; states a growth bound on `journal.jsonl` and re-files rotation | (missed entirely in r1) | **concede the coupling, reject the file** | §3.1. `journal.jsonl` is **per-run** (`join(this._runDir(runId), 'journal.jsonl')`, sqlite-run-store.ts:164) — bounded by one run and never appended after it ends. REQ-213's new lines go to **stdout → `.rwe.log`**, a single global file with no rotation whatsoever, which REQ-214 is already rewriting the creation of. The debt is real and QD was right to name it; it belongs to `.rwe.log`, not to `journal.jsonl`. |
| D10 | REQ-214 file location | prefers (a) `dirname($RWE_CONFIG_PATH)`; asks whether `workRoot` is intended | config-path-derived | **concede (a), with a required amendment** | `dirname()` **alone collides**: `RWE_CONFIG_PATH` defaults to `$(pwd)/rwe.config.json` (deploy.sh:23) and the scratch instance's config will usually sit in the same directory. The filename must carry the config's basename: `<dir>/.rwe.<basename>.pid` / `.log`. `workRoot` is rejected on a mechanical ground neither r1 checked: deploy.sh would have to parse JSON in shell **before** the engine that owns that config has started. Also: `.gitignore:19-20` pins the two literal names — the glob must be widened in the same change (CLAUDE.md's "gitignore it, don't `checkout` to tidy" rule). |
| D11 | REQ-211 is "mostly a consumability gap" | error text is the substance; confirms the channel seam doesn't regress | three refusal cases; name-keyed immortal-diagram guard | **hold — this is a weighting disagreement that matters for Gate 3** | REQ-211 creates a **new destructive path**. R-1 (a per-version delete under a non-terminal pinned run silently reroutes the resume into the legacy-cohort fallback at run-manager.ts:1053-1060 and continues on *different code*, visible only as one `run.legacySubstitution` line) is HIGH, not cosmetic. Sized as a consumability fix it will be tasked as one file and one string. |
| D12 | REQ-213 `lastRunAt` = `null` sentinel, REQ-206 precedent | reuse it | derived `MAX(createdAt) GROUP BY name`, `null` = never run | **converged** | Same answer from both lenses. Corroborated: there is **no `DELETE FROM runs` anywhere** in `src/store/sqlite-run-store.ts`, so the derived value is exactly as durable as a denormalized column and costs no cross-DB write on the run hot path. |
| D13 | K7 `attempts` formula | `client.ts:515` is the deviant one; the guide sentence settles it | one `attempts()` helper on the port, both call it | **converged** | QD's evidence (the guide promises "an untimed call gets ONE attempt") decides *which* implementation is wrong, which my r1 asserted without that proof. Adopt QD's reasoning, keep the port-level helper + K8 scanner extension. |
| D14 | REQ-215 consumability: reuse `refusalCode()`'s enum shape so callers learn one mechanism | asked | — | **concede, and it survives the redesign** | The caller-visible surface stays exactly one thing: `run_result.error.code` plus the structured marker in the run-level envelope. The host-ledger/`refusalRef` split is **internal**; no second mechanism is exposed to a workflow author. |
| D15 | Durable catalog audit (`appendAudit`) vs. a log line | REQ asks only for a log line | stdout now, durable deferred as R-6 | **hold** | Unchanged — but §3.1 sharpens it: after REQ-212 the stdout log carries user emails, and it has no rotation and no retention. "Audit lives only in an unrotated PII-bearing file" is a worse sentence than r1's, and I raise R-6 from MED to the top of the deferred list without smuggling it into v36. |

---

## 2. REQ-215 — the converged design (`refusalRef`)

### 2.1 Why the fork dissolves — the evidence both r1 docs half-had

Verified on disk this round:

- The refusal is minted **on the host**: `onAgentRequest`'s rejection is caught at `host.ts:143-150`,
  where the handler's real `err` object (with its `detail`) is in hand **together with
  `msg.callSeq`**, and is *then* flattened to `{code, message}` for the downward `agentThrow`.
  `BUDGET_EXCEEDED` arrives the same way (`run-manager.ts:1444` → `markRefused` → the same catch),
  so **the in-scope AGENT-PATH refusal classes are host-minted without exception** (the child-side
  `GuardError` wrapping — the `workflow()` nesting codes at child-entry.ts:80 — is a different class,
  out of REQ-215's scope; a reader must not test against it). QD's Design B premise is
  factually right.
- `callSeq` **already exists on the wire in both directions** (`host.ts:141-163`,
  `child-entry.ts:35-37,124-134`). The only leg missing it is the terminal one:
  `child-entry.ts:146` sends `{t:'error', runId, error}` with no correlation field. That single
  absence is why the marker dies.
- `child-entry.ts:10` **value-imports** `evaluateScript` from `./guards.ts`. So `guards.ts` can
  *export* a `WeakMap` that `child-entry.ts` populates: the import direction is child-entry →
  guards, which does **not** violate the constraint that pinned my r1 design (guards.ts itself can
  take no local value import — MEMORY `rwe-sandbox-child-ts-imports`; it is why
  `ENGINE_REFUSAL_CODES` is inlined at :175). **This is the one place the design could have failed
  to compile, and it does not.**

### 2.2 The design

1. **Refusal ledger — in `RunManager`, NOT in `host.ts`.** My first draft put it at `host.ts`'s
   catch; that is wrong twice over and should not reach the synthesis. `host.ts` is a generic relay:
   `onAgentRequest` is an *injected* handler (`this._config.onAgentRequest`, host.ts:135), so
   `host.ts` knows neither which codes are refusals nor the `secrets` set `captureFailure` needs —
   threading a policy list and a secret set into `SandboxHostConfig` is exactly this repo's
   documented composeConfig wiring bug class (MEMORY `composeconfig-wiring-bug-class`). **RunManager
   already owns all three**: it is the injected handler, it holds `secrets`, it keeps per-run state
   on `RunEntry` (the `journal` lives there), and it builds the run-level error envelope. So:
   `entry.refusals.set(callSeq, captureFailure(err, secrets))` inside the handler, at the point the
   refusal is raised. `host.ts` relays an integer and validates nothing — the correct division of
   labour for a relay. Bounded: **first 8 per run plus a dropped-counter** (R-12) — a script looping
   on a retired `agentType` would otherwise grow it without bound.

   **Checked whether the ledger is redundant, and it is not.** `markRefused`
   (agent-executor.ts:268-282) writes an `AgentRecord` carrying **`reasonCode: ErrorCode` only** —
   no structured detail, no `callSeq`; `AgentRecord.detail?: string` (types.ts:276) is the
   *provider-authored* string on a `state:'failed'` call, which is precisely the flattened
   「per-agent 紀錄的 detail 字串」 REQ-215 complains about. Giving the refused/failed record a
   structured detail alongside `reasonCode` is arguably part of this fix and the synthesis should
   rule whether it is in scope; it does **not** remove the need for the callSeq-keyed ledger,
   because nothing on the agent record correlates back to the `agent()` call the script rethrew.
2. **Provenance (child).** `child-entry.ts:82` already constructs the `Error` handed to script land.
   At that line it also does `refusalRefs.set(err, msg.callSeq)` into a **module-scope `WeakMap`
   exported from guards.ts** — module scope is unreachable from the vm context (`guards.ts:290-309`
   builds the context explicitly and exposes only `SANDBOX_GLOBALS`). A `WeakMap`, not a `WeakSet`:
   the object is mutable, so membership alone would let a script decorate a genuine error; keying
   the *value* means the ref is the engine's, not the object's.
3. **Forward (child).** `guards.ts:322-335`'s catch adds `refusalRef: refusalRefs.get(err)` to the
   `{kind:'error'}` result — **read from the map, never off `err`**. Rethrow-the-same-error carries
   the ref; `throw new Error(...)` does not; a script that mutates `e.refusalRef = 99` changes
   nothing, because the field is never read from the object.
   **Object identity through `parallel()`/`pipeline()` — verified, and it holds.** Both re-throw the
   *same* object (`if (refusalCode(err) !== null) throw err;` — guards.ts:207 and :230), unwrapped,
   so the WeakMap key survives the exact path the v25 lost-third-researcher incident ran down. Had
   they wrapped, the ref would need re-keying onto the wrapper (or following via `cause`); they do
   not, so no extra code is needed — but Gate 5 must pin it, because a future refactor that wraps
   here would silently drop the marker on the `parallel()` path only.
4. **Receipt (parent).** `host.ts`'s `case 'error'` accepts `refusalRef` only if
   `refusals.has(ref)`, and the run layer lifts **the host's own recorded marker** into the
   run-level error envelope. Unknown ref → dropped, silently, no error.
5. **(b) adjudicated.** Recorded+lifted set = the engine's agent-path refusals, starting at
   `{BUDGET_EXCEEDED, PARAM_UNKNOWN(+violation)}` — one addition, no wildcard, no per-call opt-in.
   Separately and explicitly, `ENGINE_REFUSAL_CODES` (guards.ts:175) gains the same one code **for
   its second job**: exemption from `parallel()`/`pipeline()` null-folding (D4).
6. **The four files (a) asks for**, enumerated so the synthesis can count them: `guards.ts`
   (WeakMap export + forward), `child-entry.ts` (populate at :82; wire type at :35-37), `host.ts`
   (relay `refusalRef` on the terminal envelope), `run-manager.ts` (ledger + lift into the run-level
   error envelope). If the panel prefers the wire types shared in `types.ts`, that is a fifth touch,
   not a substitution.
7. **(c) assessment, in one sentence.** *No new script-controlled-object-to-disk channel is created:
   the only value crossing upward is an integer, validated against a per-run map of refusals the
   PARENT itself minted and redacted; the worst a malicious script achieves is re-attributing one of
   its **own** run's genuine refusals to a different failure in that same run's envelope.*
   What v37's Bash jail inherits is therefore a **principle, not a code artifact**: only validated
   integers/handles cross upward, never script-adjacent bytes. My r1's line about the shared
   allowlist needing to live in `errors.ts` is **withdrawn** — with no string on the wire there is
   no allowlist table left to share.

### 2.3 What this deletes from my r1 diff

No new wire string; therefore **no `code → permitted detail keys` allowlist table, no per-value byte
bound, no redact-then-cap ordering on a new field, and no three unit-test files for them**. The
remaining tests are: one pure-function test on ledger bound + ref validation, and **exactly one**
real-child integration test proving the marker reaches the run-level envelope through a live
sandbox round trip (REQ-215's no-mock clause, satisfied; one test, not a matrix — R-10).

### 2.4 The literalist objection, answered rather than dodged

REQ-215's test clause says 「證明標記真的穿過去了」. A strict reading — *the marker string itself must
be on the wire* — would fail this design. My answer: the **Then** clause states the observable
requirement as 「該結構化標記能從 run 層的錯誤封包讀到」, which this delivers exactly; (a)'s four-file
IPC contract change happens; and (c) states the requirement's own **fear** as the creation of a
script-controllable-object-to-disk channel. A design that satisfies the Then-clause while making the
(c) fear structurally impossible serves the requirement better than one that satisfies the letter of
a trace description. **I flag this as a ruling for the synthesis, not a decision one lens should
make quietly** — it is the only place r2 departs from a literal reading of requirement text.

---

## 3. Corrections of record

### 3.1 `journal.jsonl` is per-run; the unrotated global file is `.rwe.log`

QD's r1 says *"`journal.jsonl` carries 7 `catalog.publish` lines"* and builds the rotation-coupling
argument on REQ-213 adding line kinds *"on top of the existing per-agent traffic"* in that file.
Verified otherwise:

- `journal.jsonl` is written at `sqlite-run-store.ts:164` to `join(this._runDir(runId),
  'journal.jsonl')` — **one file per run**, settled `agent()`/`workflow()` calls only, never
  appended after the run ends (ARCH-006, and ARCH-034 reads it back for crash replay).
  `run-store.ts:332` says outright that the in-memory store has *"no on-disk journal.jsonl"*.
  It cannot contain a `catalog.publish` line.
- `catalog.publish` is a bare `console.log` (`workflow-catalog.ts:803`) → **stdout** → `.rwe.log`
  via `nohup … > .rwe.log` (deploy.sh:63). REQ-213's 「70 分鐘的遠端測試,journal 只有 7 行」 is
  describing that operator log, and REQ-213's new lines land there too.

**Consequence, and it improves the answer.** The growth/retention risk is `.rwe.log`: a single
global file, created by a shell redirect, with no rotation, which after REQ-212 becomes
**PII-bearing** (R-7). REQ-214 is rewriting the exact line that creates it. So: do **not** build a
rotation subsystem in the engine (Karpathy — the stream is a shell redirect; `logrotate`, `systemd`
or a supervisor is the operator's existing tool), and do **not** state a growth bound on the wrong
file. Instead REQ-214's change ships the per-instance log path with **0600**, and DEPLOY.md gains
two sentences: the log is PII-bearing, and it is unrotated — point your rotation tool at it.
Rotation stays filed, **with that reason recorded**, which is the discipline QD was rightly asking
for.

### 3.2 `lastRunAt`'s durability, and K5's cliff, share one verified fact

There is **no `DELETE FROM runs`** anywhere in `src/store/sqlite-run-store.ts`. That single fact
(a) makes QD's and my converged derived-query answer for `lastRunAt` exactly as durable as a
denormalized column (D12), and (b) is what makes `listSummaries()`'s per-request full scan behind
`/api/runs` and `/api/home` a genuine monotonic cliff (R-11). Same fact, opposite conclusions for
two different call sites — which is why K5 must be adjudicated per-caller, not per-function.

---

## 4. Final position

- **REQ-211** — `deregisterVersion(name, version, actor)`: sibling method (not a mode flag), one
  transaction over `workflow_versions` + `workflow_diagrams` at `(name, version)`, never touching
  name-scoped `assets` or the `workflows` row. **Three** refusals (channel pin; last remaining
  version; **non-terminal run pinned to it** — R-1). Version-key the immortal-diagram guard
  (workflow-catalog.ts:~409) in the same change (R-9). `VERSION_CEILING_EXCEEDED`'s hint carries the
  exact call shape. **Amends ADR-014** — 02-architecture.md must record it.
- **REQ-212** — 4-field `Actor` (`id`, `kind`, `bypass`, `idSource`) replacing `principal: string |
  null` on mutating catalog methods; ownership becomes the pure predicate `canMutate(owner, actor)`;
  `idSource: 'claimed'` for `bypassWithArg`'s caller-supplied id. Recorded where the write commits,
  through the same sink as REQ-213 — no second writer. Durable `appendAudit` deferred (R-6).
- **REQ-213** — one injectable sink `(event: Record<string, unknown>) => void`; `catalog.publish`'s
  `console.log` moves onto it so the product ends with one log path, not two. Emission at
  `_transition` (covers success *and* failure terminals — D7), not inside `captureFailure`.
  `lastRunAt` via one grouped `MAX(createdAt) GROUP BY name` merged in the facade (index
  `runs(name, status, createdAt DESC)` leads with `name`); `null` = never run (REQ-206 convention).
  **Gate 3/4 wiring check**: `catalog.list()` already returns `description` — verify the
  `workflow_list` projection forwards it; if not, the "purpose summary" half is a one-line wiring
  fix, not a feature (MEMORY `composeconfig-wiring-bug-class`).
- **REQ-214** — `<dirname($RWE_CONFIG_PATH)>/.rwe.<config-basename>.{pid,log}`, 0600 on the log;
  widen `.gitignore:19-20` to the glob; ~3-line `--dry-run`/`RWE_START_CMD` seam so the two-instance
  regression is assertable without booting an engine. PID-recycling hardening out of scope (R-8).
- **REQ-215** — §2.
- **REQ-216** — K2 first commit (redact **then** slice); K1 second, bound as a parameter; K3/K4 as
  written; K6/K7 one `attempts()` helper on the `GatewayClient` port + the missing guide sentence;
  K8 extend `compose-config-v2-wiring.test.ts` (highest value-per-line in v36); **K5: NO LIMIT on
  `listRuns()`** — document it in the port as a deliberately unbounded sweep API — **plus** the
  carve-out: `listSummaries()` → the paginated `list()` (limit 50 / cap 500), and boot's
  `ownerlessRuns` `Promise.all(getRun)` fan-out (server.ts:815-817) → a COUNT query.

**Ordering** (unchanged, dependency-driven): K2 → K1 → REQ-212 → REQ-211 → REQ-214 → REQ-213 →
REQ-215. REQ-214 still precedes REQ-213: REQ-213 makes the log stream load-bearing for the first
time, and two instances interleaving into one `.rwe.log` would birth the new observability corrupt.

---

## 5. Internal conflicts between my three lenses (explicit, as the brief requires)

1. **Security × testability, REQ-215 — resolved, not traded.** r1 framed this as accepting one slow
   real-child test because the fast hermetic seam *is* the forgery seam. `refusalRef` shrinks the
   conflict rather than paying it: the trust decision moves to a host-side map lookup that is a pure
   function (fast, hermetic, exhaustively testable), and the real-child test now proves only
   *transport*, which is the one thing a mock genuinely cannot prove. Both lenses get what they
   wanted. This is the round's best outcome and it came from conceding to another lens.
2. **Security × scalability, against my own design (new this round).** The host refusal ledger is
   keyed by `callSeq` and populated by script-triggered events — a script looping on a retired
   `agentType` grows it without bound. Resolution: first-8-per-run plus a dropped counter (R-12).
   Causality only needs the *first* refusal; keeping all of them is speculative storage, which the
   tie-break forbids.
3. **Security × simplicity, REQ-212 — held, and the held position got worse.** Durable
   `appendAudit` is the secure answer; stdout is the simple one. I still hold stdout for v36
   (the requirement asks for a log line), but §3.1 means the held position is *"the catalog audit
   trail lives only in an unrotated, PII-bearing file"*. That is an uncomfortable sentence and it
   should be read aloud in the synthesis before R-6 is deferred again.
4. **Scalability × simplicity, K5 — I under-serve my own brief, deliberately.** Applied literally to
   a single-writer single-node SQLite tool, the scalability lens produces two wrong answers (a LIMIT
   that breaks boot recovery; a distributed-consistency story for one process). v36's honest
   scalability deliverable is one COUNT query, one paginated accessor, and a documented sweep API.
5. **Testability × simplicity, REQ-214 — testability wins, 3 lines.** "Gate 7.5 will catch it"
   demonstrably did not catch it in v34; it shipped a DEPLOY.md workaround instead.

---

## 6. Remaining disagreements for the synthesis

1. **(b)'s second half — the null-folding exemption (D4).** Neither r1 asked whether an
   `AGENT_OPT_RETIRED` refusal raised inside `parallel()`/`pipeline()` should null-fold or
   propagate. I say propagate (identical in kind to `BUDGET_EXCEEDED`; the v25 lost-researcher
   incident is the precedent). This is a genuine open policy question, not a settled one, and it is
   the only part of `ENGINE_REFUSAL_CODES` that `refusalRef` does **not** subsume.
2. **The literal reading of REQ-215's test clause (§2.4).** If the panel rules that the marker
   *string* must physically traverse the wire, `refusalRef` is out and my r1's primary design (host-
   side allowlist + bound + redact-then-cap, WeakMap payload) is the fallback. I ask for the ruling
   explicitly rather than letting the smaller diff win by default — which is the same request my r1
   §4.7 made, now with a concrete design attached.
3. **K5, if quality-dimensions holds its lean (D8).** My adjudication is NO-for-`listRuns`,
   YES-for-`listSummaries`. If QD holds out for a blanket LIMIT, the tiebreak evidence is
   `run-manager.ts:860`, which documents the three sweep callers' need for every row in the
   codebase's own voice.
4. **REQ-211's sizing (D11).** Not a disagreement about facts — about weight. If Gate 3 tasks
   REQ-211 from QD's "mostly a consumability gap" reading, R-1 and R-9 will not be in the task
   breakdown.

## 7. Risk-register delta vs. r1

| # | Change |
|---|---|
| R-2 | **Downgraded HIGH → LOW.** `refusalRef` means no script-authored or engine-authored string crosses upward; the forgeable surface is an integer validated against a host-owned map. |
| R-7 | **Broadened.** Not just "0600 the log": `.rwe.log` is the **unrotated global** stream (§3.1), so PII has no retention bound either. Mitigation now includes two DEPLOY.md sentences and re-filing rotation *with its reason recorded*. |
| R-10 | **Reduced.** One real-child test remains, but it now proves transport only; the security logic is pure-function-tested off the sandbox path. |
| R-12 | **NEW (scalability/security, MED).** The RunManager refusal ledger is script-driven and unbounded by default → memory growth within a run. Mitigation: first-8-per-run + dropped counter. (Refusals that also produce an `AgentRecord` inherit the ≤1000 agent-counter ceiling; those raised before admission do not, which is why the explicit bound is kept.) |
| R-13 | **NEW (correctness, MED).** `dirname($RWE_CONFIG_PATH)` alone collides when the scratch config sits beside the primary one — the default is `$(pwd)/rwe.config.json`, so this is the *likely* layout, not an edge case. Mitigation: config basename in the filename; widen `.gitignore:19-20`. |
| R-1, R-3, R-4, R-5, R-6, R-8, R-9, R-11 | Unchanged. |
