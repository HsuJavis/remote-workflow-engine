# Architecture panel — Adversarial group (Security × Scalability/Performance × Testability), round 2

**Iteration:** v35 (REQ-205..REQ-210)
**Lens:** adversarial trio, argued separately, conflicts surfaced; tie-breaker = Karpathy simplicity-first
**Round:** 2 — read `quality-dimensions.r1.md` in full, re-read my own `adversarial.r1.md`, and
re-verified the four contested facts against source before moving. Two of my round-1 positions are
withdrawn, one on evidence I did not have and one because I contradicted myself.

---

## 0. What I actually verified between rounds (so the moves below are not vibes)

| # | Claim under dispute | Where I checked | Verdict |
|---|---|---|---|
| V1 | "A parser adds a new failure mode: input the parser rejects but the catalog accepts" (my r1, conflict #1) | `workflow-catalog.ts:472` pinned order `validateScriptEntry → scanAgentCalls → …`; `script-checks.ts:110–116` runs `new vm.Script('(async () => {\n' + body + '\n})')` and returns `PARSE_ERROR` | **My objection is foreclosed by existing code.** By the time `scanAgentCalls` runs, V8 has already accepted the script. The class of input I feared cannot reach the scanner. |
| V2 | "`matchDelimiter`'s state machine is the codebase's chosen answer, reuse it" (my r1) | `workflow-meta.ts:137–148`, read line by line | **It cannot do this job.** It has no `${}` stack (backtick = plain string → hides a real `agent()` call), no comment state, and **no regex-literal state** — `const re = /["']/;` desyncs it for the rest of the file. That is my own adversarial case #2, unreachable by the very machine I proposed to fix it with. |
| V3 | "Health field computed write-time is strictly better than read-time" (my r1 §3(b)) | `run-manager.ts:930–938` `_mergeLive`: `agents` = live spawner records **or** `view.agents` from the restored snapshot | **I contradicted my own §2**, which had already argued for a read projection. §3(b) is withdrawn. A fold over `agents[]` is path-identical live and restored. |
| V4 | "acorn is basically already there" (the tempting version of conceding REQ-208) | `npm ls acorn` → reachable **only** via `vitest` (`acorn-walk`, `mlly`); `typescript` is devDep-only | **False at production runtime.** Under `npm install --omit=dev` acorn is absent. Conceding REQ-208 means adding a real production dependency: `acorn@8.17.0`, **zero runtime deps**, MIT, 580 KB on disk. I state the cost rather than hide it. |
| V5 | REQ-205's error channel is an unredacted new sink (my R1, HIGH) | `run-manager.ts:1221` `entry.resultError = toErr(outcome.error)` — bare; **eleven lines above it**, `:1112–1115` redacts the `agents` array before `saveSnapshot` (DES-088 sink (2)) | **Holds, and is now sharper.** The redaction chokepoint is literally adjacent in the same method and the error line is outside it. |
| V6 | (new, neither r1 has it) `result()` after restart | `run-manager.ts:943–952`: a rehydrated `failed` run misses the in-memory `entry.resultError` branch, `getResult` returns nothing (success-only), so it falls through to `{ok:false, code:'RUN_NOT_TERMINAL', message:'… has not completed (status: failed)'}` | **The engine currently tells the caller a falsehood** about a failed run after restart. REQ-205's read-path fix must cover this exact line, not just the new column. |

---

## 1. Responses to `quality-dimensions.r1.md` — rebut / concede / hold, item by item

### 1.1 Their key point 3 — "REQ-208 belongs behind a real-parser classification port, not a smarter regex"

**CONCEDE, in full, and I withdraw my round-1 ruling (conflict #1).** Not on their framing — "a regex
is fundamentally the wrong tool" was true in round 1 too and did not move me — but on V1 and V2, which
are facts about this codebase that I had wrong:

- My whole case rested on a parser's rejection behaviour being a new failure mode. `validateScriptEntry`
  already parses the identical wrapped body with `vm.Script` **before** the scanner runs, and fails
  registration on `PARSE_ERROR`. There is no unparseable-but-registerable input. My objection was
  answered by code written in v22 and I did not read far enough to see it.
- Worse for my position: the masker I proposed **cannot be made correct**. `matchDelimiter` has no
  regex-literal state, so a script containing `/["']/` — an entirely ordinary line — silently disables
  the scanner for everything below it. Getting regex-vs-division right by hand requires parser context;
  that is more code than acorn and it would be wrong in a way nobody notices, which is the exact defect
  class REQ-208 exists to close. I would have shipped a fix with my own R3 inside it.

**But I hold the scope down, and this is where I still push on their framing.** They say "classification
port"; I say **span oracle**, and the difference is real:

> Parse once with acorn, collect the character ranges of string `Literal`s, `TemplateElement`s (quasis
> **only** — `${…}` stays code), regex literals and comments (`onComment`), mask those ranges to spaces
> with newlines preserved, then run the **existing, unchanged** `AGENT_CALL_RE` / `matchDelimiter` /
> label / `allowedTools` / group extraction over the masked text.

I built it and ran it (25 lines, scratch harness, acorn 8.17.0):

```
parsed OK, comments: 2
agent() call sites found at lines: 3,7   ← the one inside `${ await agent(...) }`, and the real one
index preserved: true | line count preserved: true
```

against a body containing `const re = /["']/;`, a `${ await agent(...) }` template substitution, an
escaped-quote string, a comment with an apostrophe, and a prompt string containing the prose
`agent (helpful)` and `agent('x')`. All four of my round-1 adversarial cases plus the regex case come
out right **by construction**, not by test-and-patch.

Why a span oracle and not the AST walk their "classification port" implies:

1. **`index` is a published join key.** `DES-174` (`workflow-meta.ts:180`) pins the `AGENT_CALL_RE`
   character offset as the skeleton↔scan join. Equal-length space masking preserves every offset and
   every line number, so `skeleton-graph.ts` and `lineAt()` need no change. An AST rewrite re-derives
   those offsets and puts that join at risk for no requirement's benefit.
2. **Their own constraint — "existing `SCAN_VIOLATION` tests stay green" — is discharged trivially**,
   because the code that produces violations is not touched at all. That is the strongest evidence the
   masking boundary is the right one: the blast radius is one function's input.
3. Simplicity-first still gets its say, just one level in: the dependency buys the **oracle**, not a
   rewrite of a working extractor.

**Plumbing consequence the designer must not miss** (neither r1 states it): the scanner must apply the
same `checkMeta` + `blankLines` strip and the same `(async () => {\n…\n})` wrapping that
`script-checks.ts:110–116` uses, or acorn chokes on `export const meta = {…}` — which is legal at the
top of a script and illegal inside the wrapper. Mask offsets must then be shifted back by the
wrapper's leading line. Get this wrong and the mask lands one line off, which is R9 with a parser.

**Cost I own rather than minimise (V4):** `acorn@8.17.0` moves from the vitest-only dev tree into
`dependencies`. Zero transitive runtime deps, MIT, 580 KB. It is loaded on the **registration** path
only. I judge that cheaper than a hand tokenizer that must get template nesting, escapes, comments and
regex-vs-division right — and I am the panelist who would otherwise be arguing against the dependency,
so treat this as a concession with its price tag attached, not an enthusiasm.

**One thing I rebut inside their point:** they offer "acorn/meriyah **or** the TS compiler API if this
codebase separately decides it wants `typescript` at runtime." Reject the TS branch outright, and not
only on footprint: `guards.ts:313` compiles the script with `new vm.Script` — the execution grammar
**is** JavaScript. A TS-aware parser would accept syntax the sandbox will reject at runtime, so the
scanner's grammar would be strictly wider than the executor's. The scanner must track the grammar V8
parses, not a superset of it; `ecmaVersion: 'latest'` tracks it, TS does not. Stated precisely, because
it cuts my way only if I do not overclaim: acorn is not *guaranteed* to equal the deployed Node's
accepted grammar — the two drift at the edges (new regexp modifiers, `using`, whatever V8 ships next).
That residual is what the fail-closed valve in §5 exists to catch, and it is why `acorn` should be
pinned to an exact version rather than a caret range.

### 1.2 Their key point 1 — "REQ-207's health field must be a pure read-time fold, never persisted"

**CONCEDE — and I withdraw my own §3(b), which contradicted my own §2.** My round-1 §2 had already
reasoned to the read projection off `run_snapshots` (`json_array_length(s.json,'$.agents')` at
`sqlite-run-store.ts:338` is the precedent); then my performance section argued "write-time is strictly
better, O(agents) once." Both cannot be true and the performance claim is the wrong one: `_mergeLive`
(`run-manager.ts:930–938`) feeds the fold from live spawner records **or** the restored snapshot's
`view.agents`, so the read fold is path-identical and a persisted copy buys nothing but a second place
to drift. Their v31 `costUSD` precedent is the right precedent. **Their position, not mine.**

**What I add on top, because their point stops one level short of the real drift risk.** "Derive on
read" does not mean one derivation — it means **two**, because there are two read models:

- `RunSummary` / `run_list` / dashboard list → derived in **SQL** (`_USAGE_PROJECTION`, `sqlite-run-store.ts:333–339`),
- `RunStatusView` / `run_status` → derived in **TypeScript** over `view.agents` (`_mergeLive`).

Two predicates in two languages over the same field is precisely the drift they are warning about,
relocated. So: **either** the SQL projection is dropped and `run_list` folds in TS from the same helper
(one definition, the honest option), **or** both exist and a test asserts they agree on the same run —
including the zero-agent case, where `usagePresent = !!row.usagePresentRaw && (row.agentCount ?? 1) > 0`
(`:264`) is the precedent both must copy: a script with no `agent()` calls must not read as unhealthy.
Silence here reproduces the v31 bug with a v35 field name.

I also **hold** my R8 from round 1, which their text does not address: the field is a **count or enum,
never error text**. Run-level surfaces (`run_list`, dashboard) are read under a different authorization
path than per-agent transcripts; a narrative field would move per-agent error text across that boundary.

### 1.3 Their "Expected disagreements → Security lens vs. REQ-205" — redaction

**CONCEDE that we agree; record it as converged and stop spending rounds on it.** They predicted the
security lens would ask whether the reason line routes through `redact()`. It does not (V5) — verified
bare at `run-manager.ts:1221`, eleven lines below the `agents`-array redaction at `:1112–1115` that
DES-088 installed as sink (2). Their prediction and my measurement are the same finding from two
chairs. **R1 stands as the panel's joint HIGH**, and it is the one thing in v35 that nobody's
requirement asked for.

**One clause to close their r2 ask explicitly rather than by inference:** they want a *single shared
helper* so the three sinks (`runs.error`, `journal.jsonl`, the `run_status`/`run_list` projection) do
not each get their own `redact()` call and their own chance to be missed. Redacting **at capture** —
before `entry.resultError` is assigned at `run-manager.ts:1221` — *is* that single call: all three
sinks read the already-redacted value, so there is exactly one call site and no fan-out to keep in
sync. Same helper, same reasoning, reached from the other side.

I keep my round-1 adjudication of the security↔consumability conflict unchanged (redaction wins
outright, mitigated by a visible redaction marker so the cold reader knows text was removed), and I
note they did not contest it — so the sharpest exchange I predicted in round 1 did not happen, and I
will not manufacture it.

### 1.4 Their key point 2 — the `interrupted` / never-resumed run stays diagnostically silent

**CONCEDE the gap is real; HOLD it out of v35.** REQ-060's boot recovery reclassifies a row left
`running` to `interrupted`, which is resumable (`run-manager.ts:758–759`, `:981`) and never passes the
`_transition` terminal choke, so REQ-205's disk-reason guarantee genuinely does not reach it. They
scoped it correctly themselves ("arguably v36's, not a v35 send-back") and I agree without reservation:
growing REQ-205 to cover process death is exactly R7 (six fixes become an observability subsystem).
**File as a v36 candidate with the pointer, close it in this gate.**

**What I add, and this one is not optional (V6):** there is a REQ-205-owned defect on the same read path
that neither round-1 document names. `result()` (`run-manager.ts:943–952`) resolves a **restart-rehydrated
`failed`** run by falling past the in-memory `entry.resultError` branch, past `getResult` (success values
only), to `{ok:false, code:'RUN_NOT_TERMINAL', message: 'Run … has not completed (status: failed)'}`.
The engine does not merely fail to answer "why" — it tells the caller the run **has not completed** when
its own status field says `failed`. That is squarely inside REQ-205's "引擎重啟後 `run_result` 仍答得出同
一個原因", it is a wrong answer rather than a missing one, and it must be a named test: fail a run,
restart the process, call `run_result`, assert the stored `{code,message}` comes back and that
`RUN_NOT_TERMINAL` does not.

### 1.5 Their key point 4 — `checkMermaid` "fail-closed by default **with an explicit opt-out**"

**HOLD, and ask them to drop three words.** Their own parenthesis already concedes my position
("a required-param signature change is enforced by `tsc`, matching this repo's stated preference for
compiler-pinned guarantees"), so we are one clause apart. But the clause matters: **an explicit opt-out
IS the degraded mode.** v34 did not ship a false green because someone chose weak validation on
purpose; it shipped one because a caller got the weak path *without knowing*. An opt-out flag is the
same trap with a name, and named traps get used — the hard evidence is that the current optional
parameter was itself the "explicit" form and 14 test call sites took it.

Cost is measured, not asserted (I counted in round 1 and re-state it because it is what makes this
cheap): **one** production caller (`workflow-catalog.ts:548`, already passing 5 args); the break is
confined to `check-mermaid.test.ts` (14 sites) and `check-mermaid-v2.test.ts` (already 5-arg). A
compile error at 14 known sites, once, with **no runtime branch that can be wrong**, beats any
mechanism that keeps two behaviours alive behind one name.

I keep my R6 attached to this concession: at least one converted v1 test must assert a **v2 rule
actually firing**, not merely compile with a rubber-stamp expectation object — otherwise the false
green returns wearing the required parameter as a hat.

### 1.6 Their key point 5 — REQ-206 must pin the default's *application*, not its acceptance

**CONCEDE, identical to my R5, and their framing is better than mine.** They name the failure shape
("recreates the exact 'accepted but inert' shape P6-3 was written to prevent, one layer down"); I named
the mechanism (materialize **before** the `redact()` fork at `run-manager.ts:627`, or `:1046`'s
`storedParams ?? defaultRunParams(…)` hands the script different args on resume than on first dispatch).
Merge them: **the test asserts the default's value inside the persisted `runs.effective_params`, and
asserts it on the resume path, not only on `start()`.** Registration-accepts is not evidence.

I also carry forward my **R5b**, which their document does not cover: a pre-v35 row already persisted
with `args = 'null'` still reaches the sandbox as `null` at `run-manager.ts:1221`
(`entry.sandbox.run(runId, script, entry.args, null)`) on resume. Admission-time normalization fixes
new rows only. Either coerce at that handoff too, or **write down** that legacy-row resume is out of
scope. Silence is how the bug survives its own fix.

### 1.7 Their key point 6 — publish the computed worst case `timeoutMs × (1 + retries)`

**CONCEDE, with one engineering caveat that decides what is actually buildable.** My round 1 said "the
worst-case arithmetic must be computable by the caller from advertised values" and flagged that if
`retries` is deployment-side and not advertised, the guide's promise is unmeetable. Their version —
publish the **computed product**, not the inputs — is strictly better for the caller and dissolves my
flag, because the server knows `retries` even when the client cannot see it.

Caveat: it must be computed from the **effective deployed** `retries` at the time `workflow_describe`
answers, not from a constant transcribed into guide prose. A hard-coded "120000ms" is a v34-class
false green (a sentence that certifies whatever was true when it was written). If the value is only
reachable through config that `workflow_describe` does not hold, then say so and advertise the inputs
instead — an honest pair beats a stale product.

### 1.8 Their key point 7 — `structuredContent` vs double-encoded text, "an open question for the designer"

**REBUT the deferral; I read the code they had not, and the question is answerable now.** They were
right to flag it as unread rather than assert; here is the answer.

There are exactly **two** envelope sites, both identical: `server.ts:1262` and `server.ts:1515` —
`{ content: [{ type: 'text', text: JSON.stringify(result) }] }`. Adding `structuredContent: result` is
literally two lines. And I still say **no, not in v35**, on three grounds:

1. **Payload doubling, measured against their own example.** `structuredContent` does not replace the
   text block, it accompanies it — every tool response ships the same payload twice. On the 39.5 KB
   guide that is ~79 KB, and REQ-210 exists *because* that guide already truncated a cold subject's
   output twice. The "fix" makes the measured symptom worse.
2. **The guarantee needs per-tool `outputSchema` to be worth anything.** A client's justification for
   trusting `structuredContent` is the declared schema; without it, well-behaved clients fall back to
   the text block anyway and we have paid the bytes for nothing. Writing `outputSchema` for every tool
   is new advertised surface — "新能力" — outside the `/sdlc-fix` routing at `01-requirements.md:2840`.
3. REQ-210's verb is 有明說 — *state it*. Stating the encoding costs nothing and is fully sufficient
   for the cold caller, who needs to know to parse `content[0].text` a second time.

**Disposition: document-only in v35** (state the double encoding; state the guide's approximate size),
and file `structuredContent` + per-tool `outputSchema` as a **v36 candidate with the two line numbers
attached**, so the next round starts from evidence instead of re-reading `server.ts`. This is me
conceding their instinct is right about the destination and holding that v35 is not the vehicle.

### 1.9 Their key point 8 (doc-example guard) and their "Process lens" expectation

**AGREE, both, no argument.** REQ-209's guard must call the **real `workflow_register`**, not a
re-implementation of the static checks — the repo's own "mock-only counts as unverified" rule applied
to docs; we wrote nearly the same sentence independently. And on process: both round-1 documents
independently endorse the `/sdlc-fix` F1–F6 routing and neither asks to reopen it. That is converged;
no lens needs to spend round 3 on it.

### 1.10 Their backlog items (journal rotation, tracing, OpenAPI, tool-liveness)

**AGREE they are out of scope; REBUT any attempt to let one back in via REQ-205.** One sharpening:
`journal.jsonl` growth is now *marginally* this iteration's business, because REQ-205 adds a new line
kind to it. The increment is one line per **failed** run — noise against the existing per-agent traffic
— so it does not change the backlog item's priority. It does make the **`.detail` size bound (my R2)
load-bearing rather than fussy**: an unbounded, script-influenced JSON blob appended per failure is the
one way a "one extra line" change becomes an unbounded-growth change. Bound it with an explicit
truncation marker, `MAX_META_LITERAL_BYTES`-style.

---

## 2. My final position for v35 (after the two withdrawals)

The minimum architecture is still **no new subsystem**, and one dependency more than I wanted:

1. **REQ-205** — additive `error TEXT` column on `runs` (the idempotent `ALTER TABLE … ADD COLUMN`
   idiom used five times at `sqlite-run-store.ts:70–83`); **no** side table; the persist call on the
   `RunStore` **interface** beside `recordResult`, so `InMemoryRunStore` satisfies the redaction and
   size-bound tests with no SQLite file; write the reason **before** the status flip (mirror the
   success path's `recordResult` → `_transition('completed')`); one `{type:'error', code, message,
   detail?}` line in the existing `journal.jsonl`; `_rowToSummary` reads it off the row already
   fetched; **and fix `result()`'s restart lie (V6)**.
   **Non-negotiable: `redact()` at capture** (R1, panel-joint HIGH) **and a bounded `.detail`** (R2).
2. **REQ-206** — normalize `args: null → {}` at admission; materialize declared defaults into
   `effective_params` **before** the `redact()` fork at `:627`; test the **resume** path; decide R5b
   (coerce at the `:1221` handoff, or write "legacy rows out of scope" down); delete the
   `params/contract.ts:428` prohibition **with the reversal's reason recorded in place**.
3. **REQ-207** — run-health signal as a **read-time fold** (their position; mine withdrawn), a
   **count/enum, never text**, with the zero-agent guard copied from `usagePresent`, and **one
   definition or a cross-check test** across the SQL and TS read models. Plus the guide text on
   `await agent()` returning `null`, and the **computed** worst-case wait from effective config.
4. **REQ-208** — **acorn span oracle** (their direction; mine withdrawn): parse the same wrapped body
   `validateScriptEntry` parses, mask string `Literal`s / `TemplateElement` quasis / regex literals /
   comments to equal-length spaces with newlines preserved, run the **unchanged** existing extractor
   over it. `acorn@8.17.0` → `dependencies` (zero deps, MIT, 580 KB, registration path only).
   **Not** the TS compiler API — the scanner must parse exactly the grammar `vm.Script` executes.
   My three round-1 adversarial cases plus the regex-literal case stay as red-first tests: a parser is
   a reason to expect them to pass, not a reason to skip writing them.
5. **REQ-209** — **required fifth parameter** (compiler-enforced, no runtime branch, no opt-out);
   at least one converted v1 test must assert a v2 rule **firing** (R6); doc-example guard calls the
   real `workflow_register`.
6. **REQ-210** — **document only**: state the double encoding, state the guide's size.
   `structuredContent` + `outputSchema` filed as v36 with `server.ts:1262` / `:1515` attached.

**Scaling posture, unchanged and unchallenged by anyone:** `better-sqlite3` is synchronous and
single-process; v35 does not pretend to prepare for multi-instance. The only real concurrency
requirement in scope is the terminal-write ordering in item 1, and I would block on it.

**Risk register after round 2:** R1 (HIGH, joint), R2, R4, R5, R5b, R6, R7, R8, R9 stand as written in
round 1. **R3 is retired** — the three cases are resolved by construction by the acorn oracle rather
than by tests-and-hope, and the tests remain as regression pins. **R10 (new):** the scanner's acorn
input must be `checkMeta`-stripped and wrapper-wrapped exactly as `script-checks.ts` does it, or the
mask lands off-by-one-line and every violation hint points at the wrong place. **R11 (new):** two
read-model derivations of REQ-207's predicate (SQL + TS) drifting apart — one definition, or a
cross-check test.

---

## 3. Remaining disagreements (honest list — it is short, and I say why)

> **Superseded by §5**, appended after `quality-dimensions.r2.md` landed mid-draft: #1 and #3 below are
> withdrawn (they conceded both) and #2 is replaced by the REQ-208 position swap. **One disagreement
> remains.** Left unedited rather than rewritten, so the timing stays legible.

1. **REQ-209's "explicit opt-out" clause.** They want fail-closed-by-default *with* an escape hatch;
   I want the required parameter with **no** hatch. Their own parenthesis already grants the
   compiler-pinned form, so this is one clause from closed — but it is a real gap, because an opt-out
   preserves exactly the two-behaviours-behind-one-name property that produced v34's false green.
   **Decidable by the owner in one line.**
2. **"Classification port" vs "span oracle" for REQ-208.** We agree on the parser. We have not agreed
   on how much downstream code it replaces. I hold that the `AGENT_CALL_RE` / `matchDelimiter` /
   label / group extraction stays **byte-identical** and only its input changes — because DES-174's
   `index` join key and every existing `SCAN_VIOLATION` test then need no argument at all. If they
   want the AST walked for label/`allowedTools` extraction too, that is a bigger change than any v35
   requirement asks for and I oppose it under the tie-breaker.
3. **REQ-210's destination.** They think `structuredContent` might be the real fix rather than a label;
   I agree about the destination and hold that v35 is not the vehicle (payload doubling on the exact
   document REQ-210 is about, plus `outputSchema` as new advertised surface). **Disagreement about
   timing, not direction** — and I have replaced their open question with two line numbers so the
   v36 round need not re-derive it.
4. **Nothing else.** Redaction (their prediction = my measurement), REQ-207 derive-on-read (I moved),
   REQ-206 pin-the-application (we converged from two directions), REQ-209's doc guard, the `/sdlc-fix`
   routing, the backlog items, and the `interrupted` deferral are all converged. No lens should spend
   a round 3 on them.

## 4. One-line position

Two withdrawals on evidence — **a real parser for REQ-208** (my masker could not handle a regex
literal, and the parse-failure objection I built my case on is already foreclosed by
`validateScriptEntry`) and **derive-on-read for REQ-207** (I had contradicted myself) — leaving v35 as
one additive column, one journal line kind, one derived predicate, one 25-line acorn span oracle, one
required parameter, some honest prose, and the one thing no requirement asked for and the security
lens will not trade: **`redact()` on the error channel before it is ever written to disk.**

---

## 5. Addendum — `quality-dimensions.r2.md` landed while I was writing, and we crossed on REQ-208

Read after drafting §§0–4. On REQ-205, REQ-206, REQ-207, REQ-209 and REQ-210 we converged *and*
converged on the same reasons — including their retraction of the "explicit opt-out" clause (§1.5 is
now closed, not a remaining disagreement) and their clarification that REQ-210's `structuredContent`
question was never a v35 ask (my §1.8 answers it with line numbers anyway, which is strictly better
than leaving it open). **Remaining disagreement #1 and #3 in §3 above are withdrawn.**

**On REQ-208 we swapped chairs.** They conceded the parser and adopted *my round-1 masking position*
in the same hours I conceded masking and adopted *their round-1 parser position*. Neither of us is
being stubborn; we are each now defending the other's abandoned argument. Somebody has to break it,
and it has to be me, because **the argument of mine that persuaded them is one I have since verified
as false.** Recording that plainly is the only honest move available:

1. **They cite my "what does the scanner do with input the parser rejects but the catalog would
   accept?" objection as part of why they moved.** That objection is void. `workflow-catalog.ts:472`
   pins `validateScriptEntry → scanAgentCalls`, and `script-checks.ts:110–116` already runs
   `new vm.Script('(async () => {\n' + body + '\n})')` and fails registration with `PARSE_ERROR`.
   The scanner never sees input a JS parser would reject. I argued from a hazard that this codebase
   closed in v22. **(V1)**
2. **They set the acceptance bar at the template-literal case** — "the masker needs one more state
   than plain quote-tracking (a nested 'back to code' mode inside `${...}`)". Correct, and
   insufficient. `matchDelimiter` (`workflow-meta.ts:137–148`) is missing **three** states, not one:
   `${}` re-entry, comments, and **regex literals**. The third is the one that decides this:

   ```js
   const re = /["']/;          // a wholly ordinary line
   ```

   A quote-tracking masker opens a string at `"` inside that regex and does not close it until the
   next `"` anywhere in the file — silently disabling the scanner for everything below. That is my
   own round-1 adversarial case #2 (escape/quote desync) in a form `matchDelimiter` cannot reach,
   inside an **admission-time security gate**, which is precisely the hiding place my R3 exists to
   prevent. **(V2)**
3. **Distinguishing a regex literal from division requires parser context** (`a / b /"c"/ d`), so the
   missing state cannot be added by tracking more characters — only by knowing the preceding token's
   grammatical role. A hand lexer can approximate it with a previous-significant-token heuristic; an
   approximation is exactly what an admission gate must not rely on, because its failure mode is a
   *silent false negative* on the security-relevant side.
4. **Their concession's stated benefit — "zero new dependency, runtime or dev" — is therefore not on
   offer at the required correctness.** The honest price list is: acorn span oracle = correct by
   construction, +1 production dependency (`acorn@8.17.0`, zero transitive deps, MIT, 580 KB,
   registration path only, **and** it parses exactly the grammar `vm.Script` executes); hand lexer =
   zero dependency, ~4 states to add, one of them heuristic, failing silently toward "scanner off."
   I ran the oracle against all four cases (§1.1) and it resolves them with `index` and line numbers
   preserved, so DES-174's join key and every `SCAN_VIOLATION` test are untouched.

**I hold the parser, and I hold it against my own round-1 self.** Their structural instinct in r1 was
right and my objection to it was wrong on the facts.

**Fail-closed valve — I propose this regardless of which implementation the owner picks, and it is
cheap in both.** Whatever produces the mask must be able to say it consumed the whole file cleanly,
and the scanner must **refuse registration** when it cannot, rather than scanning degraded output:

- acorn: the parse either succeeds or it does not — the signal is free. By V1 a failure here is
  *unlikely* (V8 already accepted the same body), **not impossible**: acorn's grammar and the deployed
  Node's can drift at the edges. That residual case fails toward a loud registration error — a false
  positive in the safe direction — never toward a silently degraded scan. The valve, not V1, is what
  makes that guarantee;
- hand lexer: assert the terminal state at EOF is `code` (no unterminated string/template/comment) and
  refuse otherwise.

This converts the entire class of "mask desynced, scanner silently off" from an invisible hole into a
registration-time error. It is the one piece of REQ-208 design that survives the implementation
choice, and it is the concrete form of the REQ's own "偵測能力不得下降" — a guard that cannot tell you
it ran is not a guard. **If the owner overrules the dependency, this valve plus the four named
red-first tests is my minimum acceptable fallback, and I want the heuristic regex/division limitation
written into the design as a known, accepted false-negative — not discovered later by whoever relies
on the gate.**

**Remaining disagreement after this addendum: exactly one** — acorn span oracle (mine, r2) vs.
zero-dependency lexical masking (theirs, r2), i.e. *whose round-1 position wins now that we have both
abandoned it*. It is a single owner decision with a stated price on each side, both options share the
fail-closed valve and the same four tests, and nothing else in v35 depends on the outcome.
