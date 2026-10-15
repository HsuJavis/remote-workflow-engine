# Adversarial design group — v40 (REQ-220..REQ-230) — Gate 4 (Design), debate round 1 (independent)

**Lens bundle**: (a) Interface-contract · (b) Boundary/error · (c) Testability.
**Tie-breaker**: Karpathy simplicity-first — the minimum design that solves *this* problem, no
speculative flexibility.
**Round**: 1, independent (I have not read the other design panellist).
**Inputs read**: `01-requirements.md` §v40 (REQ-220..230, V40-Q1..Q19, Won't list, Gate-0 design
constraints); `02-architecture.md` §v40 slice (ARCH-183..194, ADR-087..095, INV-V40-1..7, contracts
table); `state.yaml` `tech_stack`. **Verified against code** (not only the ARCH text):
`node_modules/@earendil-works/pi-ai/dist/{types.d.ts, api/system-one-shared.js,
api/openrouter-images.js, utils/provider-retry.js}`, `src/resume-cache.ts`, `src/run-guard.ts`
(`foldUsage`, `addUsage`, `nextAgentId`), `src/run-manager.ts` (`_handleAgentRequest` journal/throw
path, `RECORDED_REFUSAL_CODES`), `src/sandbox/guards.ts` (`sanitizeThrownError`,
`ENGINE_REFUSAL_CODES`), `src/ipc/protocol.ts`, `src/types.ts` (`CallKey`, `AgentOpts`,
`JournalEntry`), `src/workflow-meta.ts` (`AGENT_LABEL_FORMAT_RE`).
`03-tasks.md` v40 rows do not exist yet — where my lens depends on the split I say so in §6.

**The file previously at this path was v37's (REQ-218/219); it is superseded by this one.**

---

## 0. Altitude — which system is this?

**Both, and the split matters per lens.** tech_stack + REQs say: a conventional Node/TS service
(SQLite, IPC sandbox, HTTP to OpenRouter) whose **primary author is an AI agent** (V40-Q3: 「agent
代寫為主」; REQ-224: a cold client agent must register a working decide workflow from the guide
alone).

- **(a) Interface-contract runs at AGENT altitude** for the script-facing surface (signatures, return
  shapes, error codes, guide text): the consumer is a cold agent who self-corrects only from
  `code` + message + guide. A contract detail that only a human reading source would discover is a
  defect here.
- **(b) Boundary/error and (c) Testability run at SYSTEM altitude**: retry semantics, signal
  handling, fs containment, usage folds, deterministic UTs with injected clock/fetch/rng.
- Observability (REQ-229) straddles both: metadata-only is a system invariant; but the *only*
  diagnostic a cold agent gets for a rejected decide is the engine's own error text, because
  ADR-093 strips the provider body — so input validation becomes an agent-altitude contract
  (finding B4).

---

## 1. Summary

The ARCH is sound in shape (one host module, fetch seam, engine-owned retry, digest journal key,
`AgentRecord.kind`). My round-1 job is to find where it is **under-specified or wrong at the seams**
before 20 implementers fork. Ten findings, ranked; the first five would ship a defect if built
literally from ARCH:

| # | Sev | Finding | Where ARCH is wrong / open |
|---|---|---|---|
| B1 | **HIGH** | A per-attempt **timeout is reported by pi-ai as `'aborted'`**, which ARCH-183 maps to the run-stop path → timeouts are never retried; REQ-227 fails | ARCH-183 note |
| A1 | **HIGH** | `PRIMITIVE_FAILED{detail:{…}}` **cannot reach the script**: `agentThrow` is `{code,message}` and `sanitizeThrownError` keeps only name/message/code | ARCH-183 api, ADR-093 |
| B2 | **HIGH** | `foldUsage` **skips any usage event without `tokens`** → a wire-reported cost with no token counts vanishes on resume; USD budget re-arms short | ARCH-187 step 7, ARCH-191 |
| B3 | **HIGH** | pi-ai does **not** check `choice ∈ criteria` nor `0 ≤ probability ≤ 1`; REQ-220's acceptance requires both | ARCH-187 (missing post-check) |
| B4 | MED-HIGH | With provider bodies stripped (ADR-093), host pre-validation is the **only** diagnostic; ARCH-187 validates only question *types*, not per-type shapes | ARCH-187 step 1 |
| A2 | MED | `Plan.replay` is **synchronous**; ARCH-187's `validate?: …\|Promise<boolean>` would turn every agent call site's `ReplayResult` into maybe-Promise (INV-V40-1 risk) | ARCH-187 api |
| A3 | MED | ARCH-187 (8) "every call that consumed a callSeq is journaled" **contradicts the agent precedent** (a throw is never journaled) and has no defined replay of a journaled failure | ARCH-187 note, INV-V40-6 |
| B5 | MED | Pre-flight refusals (`BUDGET_EXCEEDED`, `PRICE_UNKNOWN`) sit **after** `withSlot` → a certain refusal queues behind 16 live decides | ARCH-187 order |
| A4 | MED | Record ids, label grammar/length, cross-kind label collisions, `outDir` normalization before hashing — all unstated | ARCH-187/188 |
| C1 | MED | `AbortSignal.timeout` and backoff jitter are **not injectable** → timeout/backoff UTs need real waits or flake | ARCH-183 `DirectDeps` |

None of these changes the architecture; each is a DES-level ruling. Net effect on surface area:
**zero new error codes** (one is optional, A4), one new method on `Plan`, two new `DirectDeps`
members, one IPC field decision.

---

## 2. Key points — per lens

### 2.1 (b) Boundary/error — the five that would ship a defect

**B1 — timeout vs run-stop disambiguation (HIGH).**
Verified in `system-one-shared.js`: the catch sets
`output.stopReason = options?.signal?.aborted ? "aborted" : "error"`. ARCH-183 passes
`signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), runAbort])`; when the *timeout* fires,
that composite signal is aborted → pi-ai reports `'aborted'` → ARCH-183 says `'aborted'` maps onto
the run-stop path → the call is **not retried and not reported as `reason:'timeout'`**. Same in
`openrouter-images.js` (identical catch). REQ-227's "逾時 → 重試" fails, silently.
**DES ruling:** the engine never branches on pi-ai's `stopReason` for abort classification. It owns
both signals and decides from them after the call returns:
`runAbort.aborted → run-stop path; else attemptSignal.aborted → reason:'timeout' (retryable); else
stopReason==='error' → classify by the seam's recorded status; else success`.
Do **not** use pi-ai's own `timeoutMs` option (it creates an un-injectable `AbortSignal.timeout`
inside pi-ai and, for images, a separate OpenAI-SDK timer) — the engine's attempt signal is the only
timer. Test: stub fetch that never resolves until its signal aborts; assert attempt 1 → `retry`,
attempt N → `PRIMITIVE_FAILED{reason:'timeout'}`; and a run-stop mid-attempt → no retry, no
`PRIMITIVE_FAILED` event.

**B2 — the primitive usage event must always carry `tokens` (HIGH).**
`run-guard.ts:63` `if (!data.tokens) continue;` — cost, and the unpriced counter, only move on events
that carry `tokens`; `:69` `unpriced ?? true`. `/systemone` may return `usage.cost` with no token
counts (Gate 7.5 unknown), and an image call may report cost with no completion tokens. Built as
ARCH-187 reads, such a call is counted live (`guard.addUsage`) but **dropped by the resume fold** →
a resumed run's USD limit is re-armed low → overspend. **DES ruling:** the primitive `usage` event
ALWAYS carries `tokens` (zero-filled when the provider gave none — the token budget is a chat-token
notion; a decide that reported no tokens consumes no token budget, stated in the guide), and
`costUSD` + explicit `unpriced` (`false` when reported/estimated; `true` with `costUSD:0` when absent,
which is the existing capture-site convention `priceCall`'s doc already names). The `primitive.call`
*event-log* line keeps `costUSD:null` for absent — two sinks, two encodings, both documented. Test:
IT-156-style "live fold == resume fold" deep-equal, extended with one reported-cost-no-tokens decide
and one absent-cost image.

**B3 — post-hoc answer validation (HIGH).**
Verified in `parseAnswers`: choice → only `typeof choice === 'string'`; bool → only finite number.
REQ-220's acceptance says choice 「為宣告選項之一」 and bool 「為 0..1 的機率值」. pi-ai also drops any
answer id not asked (iterates `context.questions`), which is fine. **DES ruling:** one pure
`checkAnswers(questions, answers)` after the call: choice ∈ `Object.keys(criteria)`, bool
probability ∈ [0,1], score finite; violation → `PRIMITIVE_FAILED{reason:'malformed'}`, **not
retried** (deterministic provider behaviour), and the call is still priced (a malformed answer was
billed — pi-ai itself sets usage "before parsing answers" for that reason). Pure → trivial UT table.

**B4 — full host pre-validation of `questions` (MED-HIGH, agent altitude).**
ADR-093 makes every error body-free, so a provider 400 tells the cold author nothing. pi-ai's
per-type shapes (`types.d.ts:448-466`) are: bool `criteria:{true:string,false:string}`; choice
`criteria: Record<string,string>`; score `criteria: string[]`; all `instructions: string`.
**DES ruling:** `validateDecideInput` checks every one of those, plus:
question count 1..cap (empty `questions` refused — nothing to ask); question id matches
`/^[A-Za-z_][A-Za-z0-9_]{0,63}$/` (no `__proto__`/`constructor` — answers are rebuilt in the child
realm); choice ≥ 2 options; score ≥ 2 criteria; `state` a plain JSON object (not array/null) under
the byte cap; `prompt` non-empty under its cap; `inputImages` array of strings, count ≤ cap; `outDir`
string. Error contract: `PRIMITIVE_INPUT_INVALID` with message
`decide '<label>': <fieldPath> <rule>` where `fieldPath` is **structural only** — `state`,
`questions.<id>.criteria`, `prompt`, `inputImages[2]` — **never a value and never a key inside
`state`** (a sentinel placed in a state *key* must not leak via the message → `runs.error`;
REQ-229). Question ids may appear (they are author structure, declared literally in the script).

**B5 — refuse before slot (MED).**
ARCH-187 orders (4) `withSlot` before (5) `assertBudget`/`PRICE_UNKNOWN`. A call that is certain to be
refused then waits behind up to 16 in-flight decides (or 2 images — seconds to minutes) only to be
refused. **DES ruling:** order = validate → key → replay → **budget + price-knowable pre-flight** →
`withSlot` → **re-check `assertBudget` inside the slot** (spend may have moved while queued) → call.
The double check is one line and keeps the overshoot bound ARCH-187 states. INV-V40-2 test: every
pre-flight refusal path leaves stub-fetch count 0 **and** semaphore `inUse` unchanged.

### 2.2 Further boundary conditions the DES must enumerate (each a UT row)

| Input / condition | Ruling |
|---|---|
| Provider returns image with mime `image/png` but bytes are JPEG | Mime = **sniffed** magic bytes, never the data-URL string (ARCH-185 already says so for the extension; extend to the returned `mimeType`) |
| Provider returns `image/svg+xml` or undecodable base64 (`Buffer.from` silently skips bad chars) | Sniff fails → that image dropped, counted in the event (`droppedImages`); zero remaining → `PRIMITIVE_FAILED{reason:'no_output'}`, priced (billed) |
| Text blocks from image+text models | Ignored this round (ADR-095 / v41 candidate) |
| `outDir` with a dot-segment (`.git/x`, `.claude`) | Refused `IMAGE_PATH_REFUSED{reason:'escape'}` — engine never writes into hidden trees of an agent workspace; one rule, no allowlist |
| `outDir: '.'` / `''` / trailing `/` | Normalized: posix-normalize, strip trailing `/`; `''` → refused; `'.'` → workspace root. **Normalization happens before hashing** (else `out/ig` vs `out/ig/` miss on resume) |
| `inputImages: []` vs absent | Normalized to `[]` before hashing |
| Duplicate entries in `inputImages` | Allowed, sent twice (author's choice; no dedupe logic) |
| Run stop during backoff sleep | `sleep(ms, runAbort)` is abortable → run-stop path, no further attempt |
| `retry-after` above the cap | `PRIMITIVE_FAILED{reason:'http', retryable:true}` immediately (ARCH-183) |
| Same label declared in `agents` and `decisions` | See A4 |
| Second `decide` with identical inputs in one run | Not deduped — two calls, two callSeqs, two charges (the key is per-callSeq) |
| Image call times out but provider completes server-side | Double bill on retry — guide text (ARCH-194) already; DES default suggestion `retries: 0` for images in the worked example |

### 2.3 (a) Interface-contract

**A1 — what the script actually receives on failure (HIGH).**
`protocol.ts:23` `agentThrow: {callSeq, error:{code, message}}`; `guards.ts:169`
`sanitizeThrownError` rebuilds the error in the child realm with **name, message, code only**. So
ARCH-183's `detail:{status, attempts, retryable, reason}` dies at the IPC hop. Two options:
(i) widen `agentThrow.error` with an optional `detail` and copy it (re-realmed) in
`sanitizeThrownError` — touches the agent path's error shape (INV-V40-1 "byte-identical" must then
be argued) and a script-writable field near the refusal-ref machinery; (ii) **message is the whole
script contract; `detail` lives in the `primitive.call` event only.**
**Recommendation — (ii) by Karpathy tie-break.** The message template from ADR-093 already carries
everything a script needs to branch: `decide 'gate' failed: timeout after 3 attempt(s)` /
`… failed: http [HTTP 429] after 3 attempt(s)`. A cold-agent script does
`try { … } catch (e) { if (e.code === 'PRIMITIVE_FAILED') fallback() }` — it branches on `code`,
not `detail`. The guide documents the message template as stable. This also removes a
script-forgeable structured field. The ARCH-183 `api` line must be corrected to say `detail` is an
event-log field.

**A2 — keep `Plan.replay` synchronous; add `invalidate()` (MED).**
`resume-cache.ts:29` returns `ReplayResult` synchronously and every agent call site relies on it.
ARCH-187's `validate?: (v) => boolean | Promise<boolean>` widens that to a maybe-Promise.
**DES ruling:** `ResumePlan.invalidate(): void` (sets the existing `_missed` flag). The image handler:
`let v = plan.replay(seq, key); if (v !== MISS && !(await verifyFiles(root, v.files))) { plan.invalidate(); v = MISS; }`.
`replay`'s signature and every agent call site are untouched; `invalidate` gets a 3-line UT
(after invalidate, every later `replay` is MISS).

**A3 — journal only returned values; a throw is never journaled (MED).**
Verified: `_handleAgentRequest` pushes a `JournalEntry` only on the success/terminal-null path; the
catch path throws without journaling. ARCH-187 (8) / INV-V40-6 say "every call that consumed a
callSeq is journaled", which would require inventing a journaled-failure value and a replay that
re-throws it. **DES ruling:** mirror agent exactly — `{answers}` / `{files}` journaled on success;
`PRIMITIVE_FAILED`, `PRIMITIVE_INPUT_INVALID`, `IMAGE_PATH_REFUSED`, `PRICE_UNKNOWN`,
`BUDGET_EXCEEDED` journal nothing. On resume that callSeq has no entry → MISS → it and every later
call re-run live, which is the existing longest-unchanged-prefix rule. INV-V40-6 must be reworded to
"one callSeq per call; journaled iff it returned". A run-stop mid-call: the run is stopping, no entry
— same as an agent throw (not the D-F13 aborted-null case, since a primitive never resolves null).

**A4 — identities and names (MED). Four small rulings:**
1. **Record ids**: `recordPrimitive` draws `guard.nextAgentId()` → `agent-N`, so primitives count
   toward the per-run `AGENT_CAP` (1000) runaway backstop. One counter for all paid model calls;
   the guide states "1000 model calls per run, decide/generateImage included". Webhook usage is one
   run per message (V40-Q5) so per-run volume is small. (Alternative — a separate counter — is extra
   state for no observed need.)
2. **Label grammar**: reuse `AGENT_LABEL_FORMAT_RE` (`/^[A-Za-z_][\w-]*$/`) **plus a 64-char cap**
   (the label becomes a filename component, `<label>-<callSeq>-<i>.<ext>`), and the existing
   `Object.hasOwn` lookup discipline for `effectiveParams.decisions[label]` (the 2026-10-07
   prototype-name bug must not be reintroduced on the new blocks).
3. **Cross-kind label collision**: `agents.x` + `decisions.x` in one workflow — records, swimlane
   rows, observed-stats and mermaid nodes all key on the label. **Recommend refusing** at
   registration (one check in the contract validator). Code: reuse the nearest existing
   duplicate-label code if one exists; otherwise one new `PRIMITIVE_LABEL_COLLISION`. This is the
   only possible new code in my proposal and I would drop it if the other lens shows records/nodes
   already disambiguate by `kind` end-to-end.
4. **`CallKey.opts`**: `{label, model}` is assignable to `AgentOpts` (both optional fields exist,
   `types.ts:227`) — no type widening needed; confirmed, no ruling required.

**A5 — the script-facing signatures, pinned (for the DES table).**
```ts
decide(label: string /* literal */, opts: {
  state: JsonObject;
  questions: Record<Id, {type:'bool', instructions:string, criteria:{true:string,false:string}}
                      | {type:'choice', instructions:string, criteria:Record<string,string>}
                      | {type:'score', instructions:string, criteria:string[]}>;
}): Promise<{ answers: Record<Id, {type:'bool', probability:number}
                                 | {type:'choice', choice:string, probabilities:Record<string,number>, confidence:number}
                                 | {type:'score', score:number, confidence:number}> }>;

generateImage(label: string /* literal */, opts: {
  prompt: string; inputImages?: string[]; outDir?: string;
}): Promise<{ files: Array<{ path: string; mimeType: 'image/png'|'image/jpeg'|'image/webp'|'image/gif';
                             bytes: number; sha256: string }> }>;
```
Nothing else on the result (no `model`, no `costUSD` — those are in run usage/events; adding them
would make the journaled value carry metadata a replay would have to keep consistent).
Both reject with errors whose `code` ∈ the ARCH-194 runtime set; the guide lists each with one
cause + one fix line (agent altitude).

### 2.4 (c) Testability

**C1 — make every timer and every random injectable (MED).**
`DirectDeps = {fetch, now, sleep, resolveKey, onAttempt}` is missing two seams:
- `attemptSignal(ms): {signal, fired(): boolean}` — default wraps `AbortSignal.timeout`; tests pass a
  manual controller. Node's `AbortSignal.timeout` is not reliably faked by `vi.useFakeTimers`, so
  without this every timeout UT waits real seconds. It also *is* B1's fix (the engine knows which
  timer fired).
- `random(): number` for jitter — or make `backoffMs(attempt, retryAfterMs, capMs, rand)` pure with
  `rand` a parameter. Deterministic backoff UT, no flake.
- `now` is **monotonic** (`performance.now`), not the run `Clock` (`isoNow` stays for timestamps).

**C2 — REQ-230 test shape.** A wall-clock p95 over a real IPC hop in CI is a flake generator.
Primary assertion: over 100 stub-fetch decides through the real RunManager handler, the
seam-derived `engineMs = total − Σ providerMs` p95 ≤ 200 ms (the same number production logs).
Plus one loose end-to-end smoke through the real sandbox child (script-observed elapsed − stub
latency) with the 200 ms bound — the acceptance's literal measure — run in the IT suite, not UT.

**C3 — fixtures that must exist before the change they guard.**
- REQ-222 golden: freeze the **current** code's chat rows from a recorded OpenRouter fixture *before*
  the URL change lands; the new code runs over that fixture + the extra non-chat rows; chat rows
  deep-equal the golden. If the golden is generated after the change it proves nothing.
- Stub-fetch bodies for `/systemone` (incl. the wire-level `noul` type — keeps the real codec under
  test, ADR-089) and `/chat/completions` with `images[].image_url` data URLs. Image bytes in fixtures
  are real 1×1 PNG/JPEG so magic-byte sniffing is exercised.

**C4 — the REQ-229 sentinel test is a sweep, not a list.** By-construction (type shape) covers the
event and journal; it does not cover what nobody thought of. The IT puts one sentinel in a `state`
**value**, one in a `state` **key**, one in `prompt`, forces one input-validation failure and one
uncaught `PRIMITIVE_FAILED` (so `runs.error` is populated), then greps **raw bytes** of: the
event-log file, `journal.jsonl`, the SQLite DB file + WAL, every dashboard `/api/*` response for
the run, `run_status`, `run_agent_log`, and captured host stderr. (`src/sandbox/host.ts` has no
`console.*` today — verified — so stderr should be clean; the sweep keeps it that way.)

**C5 — fixture compatibility.** `RunManager` must default the two new semaphores
(`deps.decideSemaphore ?? createSemaphore(16)`, image `?? createSemaphore(2)`) exactly as the agent
one defaults (`run-manager.ts:743`), or every existing RunManager fixture breaks — INV-V40-1 says the
agent suites pass *without edits*.

**C6 — DES ↔ UT coverage map (proposed DES split; each line one UT file).**

| Proposed DES | Pure/injected? | UT proves |
|---|---|---|
| `validateDecideInput` / `validateImageInput` | pure | B4 table incl. structural-only messages |
| `canonicalJson` + `primitiveCallKey` | pure | key order independence; `outDir`/`inputImages` normalization; model change → different opts |
| `checkAnswers` | pure | B3 |
| `classifyAttemptOutcome(status?, runAborted, attemptFired, piStop)` | pure | B1 truth table |
| `backoffMs(attempt, retryAfterMs, capMs, rand)` | pure | jitter bounds, retry-after honoured / over-cap fail-fast |
| `runDecide` / `runImage` (call.ts) | deps-injected (stub fetch, manual timer, rand) | retry count = `retries`; 4xx no retry; seam body cap; real pi-ai codec |
| `image-files` read/write/verify | real tmp dir (no fs injection — symlink cases need a real fs) | planted symlink in `inputImages` **and** `outDir`; dot-segment; sniff; tmp+rename; sha mismatch → false |
| `pricePrimitiveCall` / `primitivePriceKnowable` | pure | reported > estimated > absent; absent never 0 in event |
| usage event shape | pure builder | B2 always-`tokens`; live fold == resume fold |
| `checkPrimitiveModelType` | pure | mismatch / unverified warn / catalog-down warn |
| scanner + contract | pure | declared⇔used, literal label, closed keys, `PARAM_IN_SCRIPT`, alias refusal, A4 collision |
| handler integration | RunManager + stub fetch | order (B5), replay + `invalidate` (A2), no-journal-on-throw (A3), semaphores (REQ-228) |

---

## 3. Internal conflicts between my three lenses (argued, then ruled)

1. **Interface wants rich structured errors (`detail` on the script error) vs Boundary wants
   body-free, unforgeable errors vs Testability wants one assertion surface.** → **A1(ii)**: `code` +
   templated message to the script, `detail` in the event. Karpathy: zero IPC/realm change; the
   script branches on `code` anyway.
2. **Boundary wants many specific codes (`PRIMITIVE_TIMEOUT`, `PRIMITIVE_RATE_LIMITED`,
   `PRIMITIVE_MALFORMED`) vs Interface/simplicity wants a small vocabulary a cold agent can learn.**
   → keep ARCH-194's one `PRIMITIVE_FAILED` with `reason` in the message; one input code
   `PRIMITIVE_INPUT_INVALID` with a `fieldPath`. Every reason is still a distinct UT row (C6), so
   testability loses nothing.
3. **Boundary wants post-hoc answer validation (B3) vs Interface purity "trust the codec's types".**
   → validate; REQ-220's acceptance literally requires it and the check is pure.
4. **Testability wants injectable fs for image-files vs simplicity.** → real tmp dir; symlink and
   containment bugs are exactly what an in-memory fs would hide. Residual: the dir-component swap
   race between `realpath` and `open` (Node has no `openat`) is **not** unit-testable; accepted and
   named in §4, not engineered (no fd-relative syscalls via native addons).
5. **Interface wants `replay(…, validate)` as one call vs Testability/INV-V40-1 wants the agent
   signature untouched.** → `invalidate()` (A2).
6. **Boundary wants a strict REQ-230 measure at the script boundary vs Testability wants a
   deterministic assertion.** → both, at different tiers (C2).

---

## 4. Risks

| # | Risk | Likelihood | Mitigation in this proposal |
|---|---|---|---|
| R1 | B1 shipped literally → timeouts never retried, misreported as run-stop | high if unaddressed | `classifyAttemptOutcome` from engine-owned signals; UT truth table |
| R2 | B2 → resumed run under-counts USD spend, budget overshoot | medium (depends on wire facts unknown until Gate 7.5) | always-`tokens` usage event; live==resume fold test |
| R3 | Cold agent can't diagnose a 400 because bodies are stripped | high for first-time authors | B4 full pre-validation; guide lists each code's cause/fix |
| R4 | Sentinel leaks via an error message that echoes a value or a state key | medium | structural-only `fieldPath`; C4 raw-byte sweep incl. `runs.error` |
| R5 | `realpath`→`open` dir-swap race on an agent-written workspace | low (needs a concurrent hostile agent in the same run) | `O_NOFOLLOW` + fstat-on-fd + tmp+rename (ARCH-185); race named, not tested |
| R6 | Shared `AGENT_CAP` (A4.1) surprises a batch-classification workflow | low (webhook use = one run per message) | guide states it; v41 candidate if observed |
| R7 | Wire facts (`usage.cost` presence, `retry-after` format, `image_output` unit) differ from assumptions | medium | nothing *requires* them (ARCH-183/191); Gate 7.5 records them under the US$1 cap |
| R8 | Golden chat snapshot regenerated after the change, proving nothing | medium | C3 ordering; task-split rule §6 |
| R9 | `imageSlots × bodyCap × ~2.3` memory with a large body cap | low at default 2 | body cap constant fixed at Gate 4 with this product in mind (e.g. 32 MiB → ~150 MiB peak) |

---

## 5. Expected disagreements with the other lens (quality-dimensions)

- **Port/adapter for the backend** (`DecisionBackend`/`ImageBackend`) — already ruled out at Gate 2
  (ADR-089); I expect it to resurface as "testability needs a fake backend". My answer: the stub
  `fetch` + C1's two extra seams make every DES testable while keeping the real codec under test;
  a port would have one implementation.
- **Rich script-facing `detail` / structured error object** for agent self-correction — they will
  argue agent-altitude consumability. I concede the goal and meet it with the stable message
  template + guide cause/fix lines (A1), not a widened IPC type.
- **Circuit breaker, decision probe, kind-aware slide-in panel, per-run fairness** — filed v41 by
  ARCH; I will oppose re-introducing any of them at Design (no REQ asks).
- **More config keys** (state cap, question cap, body cap as keys) — I hold they stay constants
  (ARCH-193's wiring-bug-class argument; three keys already).
- **Zero-filled `tokens` (B2)** — they may call it a violation of "absent is not zero". My answer:
  absence is preserved where it is *observable* (`unpriced:true`, event `costUSD:null`); `tokens`
  zero-fill is a fold-encoding requirement of the existing `foldUsage` contract, documented on the
  builder. If they prefer changing `foldUsage` to count cost without tokens, that touches the
  agent fold (INV-V40-1) — I'd oppose.
- **Cross-kind label collision (A4.3)** — they may prefer allowing it and disambiguating by
  `kind`; I'd yield if they show every keyed consumer already carries `kind`.

---

## 6. Task-splitting notes (03-tasks.md absent — the synthesizer writes it)

These are the splits where my lens breaks if two implementers own halves:

1. **Rule A1 (script error contract) and A3 (journal-on-throw) before forking** the guards.ts task
   and the run-manager task — otherwise one implementer widens `agentThrow` and the other doesn't.
2. **One task owns all three refusal-code sets** (`ENGINE_REFUSAL_CODES` guards.ts:356,
   `RECORDED_REFUSAL_CODES` run-manager.ts:451, `ERROR_CATALOG` errors.ts) **plus** the provenance
   test that pins them.
3. **One task owns the three config keys** end to end: `KNOWN_FILE_CONFIG_KEYS` + `composeConfig()`
   + UT-219 sweep + RunManager defaults (C5) — the composeConfig bug class has bitten three times.
4. **The golden chat-row snapshot is its own task, ordered before** the catalog URL change (C3).
5. **guards.ts / child-entry.ts edits in one task** with the no-local-value-import rule restated in
   the task text (the sandbox child does not resolve `.js→.ts`).
6. **Pure helpers (C6 rows 1–5, pricing, type gate) are leaf tasks** with no deps — parallelizable;
   the handler-integration task depends on all of them.
7. **The REQ-229 sentinel sweep (C4) and REQ-230 measurement (C2) are their own test-first tasks**,
   dependent on the handler task, not folded into it — they are the NFR verdicts.
