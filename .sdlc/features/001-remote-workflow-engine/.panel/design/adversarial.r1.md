# v41 Design panel — adversarial group, round 1 (independent proposal)

Lenses: (a) interface contract, (b) boundary/error, (c) testability. Simplicity-first breaks ties.
Scope: REQ-227 v41 addendum, REQ-231, REQ-232 (issue #168), built on ARCH-183/187/192 and the
SDK gateway (ARCH for `claude-agent-sdk-client.ts`). No new ARCH rows exist for v41; this is
design against existing modules.

**Altitude.** This is both kinds of system: the engine is a conventional service, and it runs agents.
All three REQs sit at the system altitude: a host-side HTTP loop, the engine's own records, and the
engine's event loop. The agent altitude is touched only through REQ-232's "agent() behaviour unchanged"
clause, so I do not apply agent-level observability or replaceability criteria here.

---

## Summary

Three disjoint fixes. Each is a few lines at a single point, and each has a deterministic UT:

1. **REQ-227: a hung body read can no longer outlive its attempt.** `makeObservedFetch` gets the
   attempt's own signal through a closure. Both `deps.fetch(...)` and every `reader.read()` inside
   `readCapped` race that signal. On abort we fire `reader.cancel()` without awaiting it, then throw.
   The throw goes through the existing path (seam throws → pi-ai swallows it → `stopReason:'error'`
   → `classifyAttempt` sees `fired()` → `timeout`, retryable), so no new classification branch is
   needed. `network` becomes `retryable: true`. `attemptSignal` gains `clear()`, which `runWithRetry`
   calls in a per-iteration `finally`.
2. **REQ-231: one failure type in all three places.** Delete the lossy `primitiveFailReasonFrom`
   mapping. A primitive record's `failReason` carries the `AttemptReason` verbatim, and its `detail`
   carries the engine-built `PRIMITIVE_FAILED` message. Both are also persisted on the `usage`
   event, so a restarted run rebuilds the same record.
3. **REQ-232: no process report on the `agent()` hot path.** The engine resolves the native CLI path
   once, when the module loads (same pattern as `SDK_VERSION`), and passes
   `pathToClaudeCodeExecutable` on every `query()`. The SDK only calls `process.report.getReport()`
   (via `D6()` → `lI()`) when that option is unset. If resolution fails, the option stays unset, so
   behaviour is exactly today's: slow, but correct.

---

## Key points

### KP-1 (REQ-227): where the deadline lives (contract and boundary)

- **Mechanism (DES-level).**
  `makeObservedFetch(deps, maxBodyBytes, signal: AbortSignal)` adds a third parameter. It is the
  composite `AbortSignal.any([tSig, runSignal])` that `runWithRetry` already builds, so build the
  signal *before* the seam (swap two lines).
  - Introduce one private helper: `untilAborted<T>(p: Promise<T>, signal, onAbort?: () => void): Promise<T>`.
    It rejects with an `AbortError` as soon as `signal` fires, or immediately if the signal is
    already aborted. It removes its listener when it settles.
  - Use it in two places. The first is `await untilAborted(deps.fetch(input, init), signal)`.
    The second is `readCapped(res, max, signal)`, which wraps each `reader.read()` and passes
    `onAbort = () => void reader.cancel().catch(() => {})`.
  - **Never `await` the cancel.** A stream that ignores abort may also ignore cancel. Awaiting it
    would rebuild the hang one line lower.
- **Why our own signal through a closure, not `init.signal`.** pi-ai's decide path forwards
  `options.signal` into `fetch`, and the image path forwards an OpenAI-SDK-derived signal. Both
  happen to work today, but racing `init.signal` makes the deadline depend on two third-party
  forwarding choices. The closure costs one parameter on an exported helper, and that helper's UT
  is the only other caller.
- **Classification is unchanged except for one flag.** `classifyAttempt`'s `network` arm flips to
  `retryable: true`. The precondition stays `invoked && status === undefined && piStop === 'error'`.
  The precedence `runAborted` → `timeoutFired` → … already makes a mid-body run stop classify as
  `aborted`, and a mid-body attempt timeout classify as `timeout`. Neither can be misread as
  `network`, because those two checks run first. UT must lock all three orderings (see T-3).
- **No outer `Promise.race(attempt(), deadline)` backstop.** I argue against it explicitly, as the
  Karpathy tie-break:
  - It needs a second timer and a second code path.
  - It abandons the pi-ai promise, which still holds the socket and the partial `chunks[]`.
  - It is a guess at a hang site nobody has observed.

  The only observed hang sites are the body read and, in theory, the pre-header `fetch`, and the
  inner race covers both. **Condition:** if RED (B) (real undici, abort on `undici:request:trailers`)
  still hangs after the inner race, the outer race becomes justified and I would concede.
- **Timer hygiene contract.** `DirectDeps.attemptSignal: (ms) => { signal; fired(): boolean; clear(): void }`.
  `runWithRetry` calls `clear()` in `finally` on every iteration: ok, fail, retry and throw.
  The production implementation does `clearTimeout(timer)`. This is a **breaking change to an
  injected interface**: every test fake, and the RED recipe's own `attemptSignal` in (B), must add
  `clear`. Make it a required field (not optional), so tsc finds every injector.
- **The bound, made a named constant.** The served guide already states
  `(retries+1)×timeoutMs + retries×RETRY_AFTER_CAP_MS`. After this fix that sentence becomes true,
  so no edit is needed there. REQ-227's "small fixed grace" is named `ATTEMPT_SETTLE_GRACE_MS`. It
  is a test-only tolerance constant (≈ one macrotask plus scheduling; I propose 250 ms in UT and
  1 s in IT). It is not a runtime timer, because under the inner race nothing runs after the
  deadline except the synchronous throw path.
- **Served text, one added sentence (current behaviour only, no issue numbers).** The guide's
  `PRIMITIVE_FAILED` paragraph should name which failures are retried: "429, 5xx, a per-attempt
  timeout, and a connection-level failure (no HTTP status) are retried; any other 4xx, malformed,
  no_output and response_too_large are not." Today the guide never says this, and `network` was
  silently non-retryable. Mirror the sentence in `docs/AUTHORING.md` via `gen-authoring-md`.

### KP-2 (REQ-231): one vocabulary, three surfaces (contract)

The three surfaces today, for a decide that exhausts its retries on a connection failure:

| surface | today | after |
|---|---|---|
| script `PRIMITIVE_FAILED` message | `decide 'x' failed: network after 3 attempts` | unchanged |
| `run_agent_log.record.failReason` | `unreachable` (lossy map) | `network` |
| `run_agent_log.record.detail` | absent | the same message string |
| `run_status.agentFailures[].reason` | `error` | `error` (unchanged, see D-2) |
| `run_status.agentFailures[].message` | `no failure detail recorded` | the same message string |

- **Widen `AgentRecord.failReason`.** The new type is
  `'timeout' | 'unreachable' | 'terminal' | 'aborted' | AttemptReason`. `timeout` and `aborted`
  already overlap, so the net additions are `http | network | no_output | malformed |
  response_too_large | write`.
  - The `kind` field already on the record discriminates which subset applies. An `agent()` record
    keeps the gateway vocabulary. A `kind: 'decide' | 'image'` record carries `AttemptReason`
    verbatim.
  - The record's own doc already says failReason is "never re-mapped". `primitiveFailReasonFrom`
    is the pre-existing contradiction of that doc, so deleting it fixes a contract lie rather than
    adding a new rule.
  - Consumers I checked:
    - `failureReason()` (unknown values → `'error'`) is unchanged.
    - `observed-stats` only tests `=== 'aborted'`, so it is unchanged.
    - `deriveAgentRecords` mirrors verbatim, so it is unchanged.
    - The `tool-specs.ts` `run_status` description mentions `failReason`. Re-read it for any
      sentence that enumerates the old four values.
- **Rejected alternative: a separate `primitiveReason?: AttemptReason` field.** It leaves
  `failReason: 'unreachable'` next to `primitiveReason: 'network'`, which is the "two names for one
  failure" defect REQ-231 exists to remove, and it adds a field to every consumer. The acceptance
  also names `failReason` literally.
- **Hardcoded arms.** The write-failure and `no_output` arms in `_handleImageRequest` (run-manager
  ~3450/3464) hardcode `failReason: 'terminal'`. They become `'write'` and `'no_output'`, the same
  value the thrown error's `detail.reason` carries. I propose a single local in each catch arm,
  `const reason = detail?.reason ?? (aborted ? 'aborted' : 'terminal')`, used for **all three**
  sinks: the record, the `primitive.call` event and the thrown error. One variable, three readers.
- **`detail`.** `recordPrimitive` gains `detail?: string`. It sets `AgentRecord.detail`, and it
  **also writes `data.detail` onto the `usage` event**. Otherwise `deriveAgentRecords` rebuilds a
  restarted or terminal run back to the "no failure detail recorded" fallback: the snapshot would
  be right and the derived record wrong (DES-188's derived≡snapshot lineage). The value is
  `(err as Error).message` **only when `err.code === 'PRIMITIVE_FAILED'`**, a message the engine
  built from the literal label, the reason word, the status and the attempt count. For any other
  throw (a bug, say a TypeError), use a fixed string, `"<kind> '<label>' failed: internal error"`,
  and never `err.message`, because an unexpected throw's message could carry a host path or
  provider text (REQ-229 boundary).
- **`summaryOfDetail` is safe on this input.** It cuts at `CLI stderr tail:` and strips a
  `success:` prefix, and neither can occur in the primitive grammar. Lock this with a UT, not a
  comment.

### KP-3 (REQ-232): CLI path resolved once (contract and testability)

- **Pure resolver.**
  `resolveCliExecutable(d: {platform, arch, isMusl: () => boolean, resolve: (spec: string) => string}): string | undefined`.
  - It reproduces the SDK's candidate order: on linux it tries `<sdk>-linux-<arch>-musl` first only
    when `isMusl()`, otherwise glibc first and musl second. Each candidate is `<pkg>/claude`.
  - The first `resolve()` that does not throw wins. If none resolves, it returns `undefined`.
  - **Both packages are installed on this host**, because npm installed both the glibc and the musl
    optional packages, so the musl check is load-bearing, not cosmetic.
- **Production wiring.**
  - `resolve` = `createRequire(<resolved SDK entry>).resolve`, anchored at the SDK's own entry
    exactly as `resolveSdkVersion` already does, so nested `node_modules` layouts resolve the same
    way the SDK would.
  - The `-linux-x64` package has **no `exports` map**, so `…/claude` is resolvable. This is unlike
    the SDK's own `package.json` (the ERR_PACKAGE_PATH_NOT_EXPORTED trap). A Gate-4 check should
    still assert this on the pinned version.
  - `isMusl` = the SDK's own test (`process.report.getReport().header.glibcVersionRuntime ===
    undefined`), run **once at module load**, when the engine holds only a few handles.
- **Constant and config field.** A module-level `const CLI_PATH = resolveCliExecutable(realDeps)`,
  next to `SDK_VERSION`. `ClaudeAgentSdkGatewayConfig.pathToClaudeCodeExecutable?: string` defaults
  to `CLI_PATH`, so tests inject. `options.pathToClaudeCodeExecutable` is set only when the value is
  defined.
  - **No `rwe.config.json` key.** That avoids the composeConfig wiring bug class (bitten three
    times), and an operator has no reason to pick a CLI.
  - On `undefined`, log one boot warning (`agent.cli_path_unresolved`, metadata only) and leave the
    option unset. agent() still works and takes the old slow path.
- **`spawnClaudeCodeProcess` (line 1365) is unaffected.** It spawns `spawnOpts.command`, which is
  whatever path the SDK settled on. Our value must therefore be exactly the binary the SDK would
  have picked: "agent() behaviour unchanged" depends on resolver equivalence, not on spawn.
- **Rejected: `process.report.excludeNetwork = true` at boot.** It is a one-line, global,
  process-wide setting that silently strips network data from an operator's own
  `--report-on-signal` diagnostics. It also does not satisfy REQ-232's second clause: a report is
  still generated synchronously on each `agent()`, just faster.

### KP-4: error-code and boundary table (boundary/error lens)

| condition | attempt reason | retryable | script sees | record.failReason |
|---|---|---|---|---|
| 429 / ≥500 | http | yes | `HTTP 503` | http |
| other 4xx | http | no | `HTTP 400` | http |
| attempt timer fired (any phase: pre-header, body, codec) | timeout | yes | `timeout` | timeout |
| run stop / suspend mid-attempt | aborted | no | `aborted` | aborted |
| socket reset / ETIMEDOUT / UND_ERR_SOCKET, no status | network | **yes (v41)** | `network` | network |
| body exceeds cap | response_too_large | no | `response_too_large` | response_too_large |
| decide answers fail `checkAnswers` | malformed | no | `malformed` | malformed |
| image stop with zero image blocks | no_output | no | `no_output` | no_output |
| post-spend image write / dir swap | write | n/a | `write` | write |
| retry-after hint over cap | (last reason) | yes, fail-fast | as last reason | as last reason |

Boundary cases the tests must hit explicitly:

- **B-1.** The timer fires in the same tick the body completes. Today `timeoutFired` beats `ok`, so
  a billed success is discarded and, for images, may be re-billed on retry. That is
  **pre-existing**, not a v41 change. I propose leaving it as is, but recording it as a named
  residual on the REQ-227 test card. An "output already in hand wins" rule would be a semantic
  change that this REQ does not ask for.
- **B-2.** `retries: 0` plus a hung body: one attempt, `timeout`, total ≤ `timeoutMs + grace`.
- **B-3.** A run stop *during* the backoff sleep: the existing `sleep(b, runSignal)` rejects. Assert
  the reason is `aborted`, with no further attempt.
- **B-4.** An already-aborted signal before `fetch`: `untilAborted` must reject synchronously-ish,
  without calling `deps.fetch` at all. Assert the stub call count is 0.
- **B-5.** **The `aborted` grammar gap (I am flagging, not fixing).** `PRIMITIVE_FAILED_GRAMMAR`
  in `authoring-guide.ts` lists `HTTP \d{3}|timeout|network|no_output|malformed|response_too_large|write`,
  **without `aborted`**, yet `runWithRetry` does throw `"… failed: aborted after N attempt(s)"`.
  REQ-231 says "其他失敗類型同樣三處一致" (other failure types consistent across all three places
  too). Either add `aborted` to the served grammar or document that an aborted run never surfaces
  to a script. The script's promise is torn down on stop, so the message may reach only the record.
  The synthesizer must decide. My vote is to add it: one token, and the grammar becomes true.

### KP-5: testability plan (every DES gets a UT; clock and storage injected)

Every new behaviour hangs off seams that already exist: `DirectDeps.fetch`, `attemptSignal`,
`sleep`, `now`, `random`, `queryImpl`, and `AgentExecutor._emit`. No module mocking.

- **T-1 (UT, REQ-227, the shipped version of RED (A)).** Stub `fetch` returns
  `new Response(new ReadableStream({type: 'bytes', pull() {}}), {status: 200})`, where the body
  never enqueues, never closes and ignores abort. `attemptSignal` is an injected fake that fires on
  demand. Assert `PRIMITIVE_FAILED{reason: 'timeout'}` and that the stream's `cancel` was invoked.
  **The committed RED recipe imports from a hardcoded scratchpad path**
  (`/tmp/claude-1000/.../src-pristine/...`), so it is not runnable from the repo. The UT must
  reproduce (A) self-contained.
- **T-2 (UT, bound).** Same hung stub with `retries: 2`, `random: () => 0` and real short timers
  (`timeoutMs: 50`). Assert `elapsed ≤ 3×50 + Σbackoff + ATTEMPT_SETTLE_GRACE_MS` and that
  `attempts === 3`.
- **T-3 (UT, `classifyAttempt` table).** Cover `network → retryable: true`, plus the three
  precedence rows from KP-1 (runAborted+network → aborted, timeoutFired+network → timeout, and
  network alone).
- **T-4 (UT, timers).** Fake timers. After a first-attempt success, `vi.getTimerCount() === 0`.
  After a fail-then-success sequence, the count is also 0. A spy on `attemptSignal().clear` is
  called once per attempt.
- **T-5 (UT, network retried end to end).** The stub rejects with `TypeError('fetch failed', {cause: {code: 'UND_ERR_SOCKET'}})`
  twice and then returns 200. Assert success with `attempts === 3`, and that `onAttempt` saw two
  `retry/network` events.
- **T-6 (IT, real undici, the shipped version of RED (B)).** A local http server, an abort fired
  from `undici:request:trailers` via `queueMicrotask`, and N = 30 iterations. Assert all 30 settle
  within the bound. This is the only test that touches the real bug's window. Keep it in the IT
  tier: it depends on the Node-bundled undici's internal diagnostics channel and must carry a
  version note.
- **T-7 (UT, REQ-231, table-driven over every `AttemptReason` plus a non-coded throw).** Drive
  `_handleDecideRequest` / `_handleImageRequest` with a stubbed `runDecide`/`runImage` throw.
  Assert three things:
  - (i) The thrown message, `getRecord().failReason`, and `summarizeAgentFailures().message` agree:
    `failReason === detail.reason`, and the message contains `reasonWord(reason, status)`.
  - (ii) The message matches `PRIMITIVE_FAILED_GRAMMAR`, which proves the REQ-229 clause: no
    provider text and no path, by construction.
  - (iii) The non-coded throw gives the fixed internal-error string, never `err.message`.
- **T-8 (UT, derived ≡ snapshot).** Run the failure through `recordPrimitive`, then rebuild via
  `deriveAgentRecords` from the emitted transcript events, and assert the `failReason` and `detail`
  are equal. This test catches the "detail only on the in-memory record" regression.
- **T-9 (UT, REQ-232 resolver table).** Cover glibc → glibc first, musl → musl first, the first
  candidate throwing → the second is used, both throwing → `undefined`, and non-linux →
  `<sdk>-<platform>-<arch>`.
- **T-10 (UT, REQ-232 wiring).** A fake `queryImpl` captures `options`. With the config path set,
  assert `options.pathToClaudeCodeExecutable === path`. With `undefined`, assert the key is absent
  (UT-018 lineage).
- **T-11 (IT, REQ-232 deterministic proxy for clause 2).** Wrap `process.report.getReport` with a
  counter, then run N = 10 real-SDK `query()` invocations against the stub `/v1/messages` server
  (the IT-015 lineage). Assert the counter stays at 0 after module load. **This test locks the
  mechanism. It cannot prove the NFR.**
- **V-1 (Gate 7.5 only, REQ-232 clause 1).** `perf_hooks.monitorEventLoopDelay` around the issue's
  own repro (`rwe168-repro@v2`, decide plus agent() in one `parallel()`), on a real engine with
  dozens of sockets. Assert p99 ≤ 200 ms and max ≤ 1 s. Wall-clock percentiles on a shared CI host
  are a flake generator, so they must not be a UT or IT gate.

---

## Risks

- **R-1 (high): DirectDeps break.** Adding `clear()` breaks every `DirectDeps` fake. If an implementer
  makes it optional "to keep tests compiling", the leak returns silently through any injector that
  forgot it. Keep it required, and let tsc enumerate the call sites.
- **R-2 (medium): network retries may double-bill images.** A network failure *after* the request
  body was sent can still bill on retry, the same as a timeout. The owner already accepted
  double-bill risk for image `retries` (V40-Q14), and the guide already warns about timed-out image
  calls. Extend that warning's wording to "a timed-out **or disconnected** image call may still be
  billed".
- **R-3 (medium): resolver drift from the SDK.** `resolveCliExecutable` re-implements an SDK-internal
  algorithm (`lI`), so an SDK upgrade could change the package naming and our path would silently
  point at a stale or missing binary. Two mitigations:
  - **Fail-open by construction.** An unresolvable path → `undefined` → the SDK resolves itself.
  - **T-9 reads the candidate names off the installed SDK.** Add one UT that greps the installed
    `sdk.mjs` for the `-linux-${arch}-musl` template literal, so drift turns CI red rather than
    staying silent. This is a brittle test by design. The synthesizer may judge it over-engineering.
- **R-4 (medium): failReason widening reaches the served schema.** `failReason` widening is a
  served-schema change (`run_agent_log.record`, `run_status.agents[]`). An external client that
  switched exhaustively on the four old values would see new strings. This is acceptable because
  it applies to primitive records only, and those records are themselves new in v40. It still
  needs one sentence in the `tool-specs` description, stating current behaviour.
- **R-5 (low): RED (B) depends on undici internals.** RED (B) / T-6 relies on the Node-bundled
  undici's `undici:request:trailers` channel. A Node patch release could change the timing window,
  and then T-6 passes vacuously. Mitigation: T-6 asserts that the trailers callback actually fired
  at least once per iteration, i.e. it asserts the perturbation took effect (v37 lesson: 驗紅要
  assert 擾動生效, "when proving RED, assert the perturbation took effect").
- **R-6 (low): stall attribution.** REQ-232's 7.1 s stall had one measured cause. If V-1 still
  shows stalls above 1 s after T-11 is green, the cause is something else (for example a large
  sync journal write, or `JSON.parse` of a 33 MB image body on the main thread). That would be new
  evidence, not a failure of this design.

## Task-splitting note (for the synthesizer writing 03-tasks)

There are three tasks with disjoint file sets, so they can run in parallel without sharing a hunk:

- **T-A (REQ-227):** `src/direct-models/call.ts` and its UT, `src/authoring-guide.ts` (one
  sentence), and the regenerated `docs/AUTHORING.md`.
- **T-B (REQ-231):** `src/run-manager.ts` (both catch arms and the two hardcoded arms; delete
  `primitiveFailReasonFrom`), `src/agent-executor.ts` (`recordPrimitive` gains `detail`, and the
  usage event carries it), `src/types.ts` (failReason union) and the `src/tool-specs.ts`
  description.
- **T-C (REQ-232):** `src/gateway/claude-agent-sdk-client.ts` only.

T-B reads no new vocabulary from T-A (`network` already exists in `AttemptReason`), so there is no
ordering dependency. **Shared-tree warning (CLAUDE.md):** T-A and T-B both touch `docs/AUTHORING.md`
only if B-5's `aborted` grammar fix is adopted. If it is, give that line to T-A alone.

## Expected disagreements with other lenses

- **D-1 (defence-in-depth or robustness lens): an outer race backstop.** That lens will want an outer
  `Promise.race` around `attempt()` as well as the inner race. My position is the inner race only,
  unless RED (B) still hangs with it in place: the outer race leaks the socket and duplicates the
  timer path. The internal conflict is real. My *boundary* lens likes the backstop, because it
  bounds every hang site, unknown ones included. My *simplicity* tie-break overrules it, because
  the unknown sites have zero observed instances.
- **D-2 (a UX or consumability lens): agentFailures vocabulary.** That lens may want
  `agentFailures[].reason` widened to `network` too. I keep the caller-facing vocabulary
  (`timeout | error | aborted | refused | schema-exhausted`). The REQ says "reason/message", the
  message carries the precise type, and widening the summary vocabulary changes a field shared
  with `agent()`. The internal conflict: the *contract* lens says one field per concept, so
  `reason` should be precise, while the *simplicity* lens says don't touch a shared vocabulary that
  the REQ does not require.
- **D-3 (a minimalist or quality lens): a separate field.** It may prefer `primitiveReason` to
  widening `failReason`, so that `agent()`'s union stays clean. Rejected: the acceptance names
  `failReason`, and two names for one failure is the defect itself.
- **D-4 (an ops lens): a config key for the CLI path.** That lens may want a `cliPath` key in
  `rwe.config.json`. Rejected: this is the composeConfig wiring bug class, and there is no operator
  need for it.
- **D-5 (any lens): tests in the UT tier.** Some lens will want REQ-232's p99/max as an IT
  assertion. My testability lens opposes it, because timing percentiles on shared hosts flake. The
  deterministic proxy (T-11) belongs in IT, and the NFR number belongs to Gate 7.5.
- **D-6 (self-conflict): the B-5 `aborted` grammar.** My *contract* lens says fix the served grammar
  now, because REQ-231 says every type must be consistent. My *simplicity* lens notes that no
  script can observe an aborted message (its run is being torn down). I vote to fix it, since it is
  one token, but I would accept "document instead".
