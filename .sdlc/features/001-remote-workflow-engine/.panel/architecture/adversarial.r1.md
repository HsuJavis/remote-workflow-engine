# Adversarial architecture group — v40 REQ-220..230 (`decide()` / `generateImage()` via pi-ai) — debate round 1 (independent)

**Lens bundle**: (a) Security · (b) Scalability/performance · (c) Testability.
**Tie-breaker**: Karpathy simplicity-first. Build the minimum architecture that solves *this* problem and nothing speculative.
**Round**: 1, independent. I have not read the other panellists.
**Evidence base**: `01-requirements.md` §迭代 v40 (REQ-220..230, V40-Q1..Q19, Won't list, and the
"設計限制" preamble), `v40-gate0-asis-map.md` (cited as G0 §n), and a direct read of the installed
pi-ai 1.0.0 sources: `dist/api/system-one-shared.js`, `dist/api/typesafe-system-one.js`,
`dist/api/openrouter-images.js`, `dist/utils/provider-retry.js`. I mint no ARCH/ADR numbers. That is the architect's job.

---

## 0. Altitude call

The project is **both** kinds of system: an MCP server/engine (system altitude) that hosts LLM agents (agent altitude).
This slice sits almost entirely at the **system altitude**:

- `decide()` and `generateImage()` are **plain host-side RPCs**. The engine host makes one HTTP call per invocation,
  with no harness, no tool surface and no agent loop. Their quality concerns are API-key handling, path
  containment, concurrency, budget accounting, retries and privacy of logged data.
- The **agent altitude** enters in only two places:
  1. **REQ-224 (consumability)**: the author is usually a cold-client *agent* (V40-Q3). The served
     text and error codes are the whole interface it learns from.
  2. **The owner frames `decide` as a cheap gate in front of `agent()`** (V40-Q1). Its failure mode is
     therefore a *policy* failure: a gate that fails open silently lets an expensive agent run. That is why
     REQ-227 says to throw named errors (script decides) and not return a null-ish default.

My lens template mentions authn / JWT forgery / brute force / timing attacks. **I deliberately do not
apply those here.** No requirement in this slice touches authentication, and inventing JWT findings
would only add noise. The template's "concurrency & consistency of failure counting" maps here to
**spend accounting and retry counting under concurrency**, and I apply that in full. The security
half that *does* bite is **secret protection**, **a confused-deputy file read/write by the host**, and
**data leakage into logs**.

---

## 1. Summary (the minimum architecture I argue for)

1. **One new host module** (working name `src/direct-models.ts`). It is independent of `GatewayChoice`
   (G0 §1: production runs `sdk`, where no `PiGatewayClient` exists). It exposes two functions,
   `runDecide(req, deps)` and `runImage(req, deps)`. **All I/O goes through injected deps**:
   `fetch`, `now`, `sleep`, `resolveKey`, `price` (admission pin lookup), `semaphore`, `workspaceFs`, and `emit`
   (event sink). RunManager gets two thin adapters, `_handleDecideRequest` and `_handleImageRequest`. They do
   **not** go through `_handleAgentRequest`, because the tamper check would refuse labels that
   `scanAgentCalls` never saw (G0 §1).
2. **Use pi-ai only as a wire codec, not as a catalog.** Import `classify` from
   `@earendil-works/pi-ai/api/typesafe-system-one` and `generateImages` from
   `@earendil-works/pi-ai/api/openrouter-images` (both exported via `./api/*`, G0 §9). The pi model
   object is **synthesized from the engine's ModelBook row** plus an **engine-fixed `baseUrl`**
   (`https://openrouter.ai/api/v1`). We never call `createModels()` and never read pi-ai's
   static `openrouter.json`. This removes the "two catalogs, two prices" blocker (G0 §0.4). It also stops pi-ai's
   frozen 1.0.0 snapshot from vetoing a classifier that OpenRouter lists live.
3. **The engine owns retry**, and pi-ai is called with `maxRetries: 0`. The engine owns the timeout
   (`timeoutMs` per attempt) and propagates the run's stop signal through `options.signal`.
4. **A single `fetch` seam** is passed to pi-ai as `options.fetch`. It (i) is the stub-provider
   injection point for every NFR test, (ii) reads the response body once with a size cap, (iii) captures
   the provider-reported `usage.cost` for REQ-225, (iv) timestamps provider time for REQ-230, and then
   hands pi-ai a fresh `Response` built from the buffer.
5. **Images never cross IPC.** The host decodes the image, writes it to the workspace under an engine-chosen name, and returns
   `{files:[{path,mimeType,bytes,sha256}]}`. Reference images are read by the host **after a
   realpath containment, regular-file and size check** (§2.S1).
6. **Concurrency** uses one **process-wide** semaphore per kind (`decideConcurrency`,
   `imageConcurrency` in `rwe.config.json`). They are separate from the agent semaphore (REQ-228).
7. **Journal/replay** shares the child's `callSeq` counter and is journaled on the same path as `agent()`.
   The `decide` CallKey is stored as a **sha256 of the canonical JSON**, never as plaintext `state`. Image replay
   checks that each file exists **and** that its sha256 still matches. Otherwise the call is a miss, and the existing
   first-miss cascade applies.

Everything else (dashboard node kinds, per-run fairness, cross-run quotas, a richer price model) is
deferred. It is not needed to pass REQ-220..230.

---

## 2. Key points by lens

### (a) Security

**S1. A confused deputy on the workspace is the main finding (REQ-221).**
The host runs as the engine user (`rwe`, outside bwrap). The workspace is written by **sandboxed
agents**. `generateImage` makes the host *read* paths from `inputImages` and *write* under `outDir`.
pi-ai's `buildParams` inlines every input image as a `data:` URL sent to the provider. The attacks are:
- `inputImages:['ref/a.png']`, where `ref/a.png` is a **symlink an earlier agent planted** pointing at
  `/home/rwe/.config/rwe.env`. The host then uploads the OpenRouter key file to a third party "as an image".
  A lexical `../` check does not catch this.
- `outDir:'out'`, where `out` is a symlink to `/home/rwe/...`. The host then writes attacker-influenced bytes outside
  the workspace as the engine user.

Required controls:
- `realpath` the workspace root and the candidate, require containment (`isPathContained`, G0 §8), and
  require `lstat` to report a **regular file**.
- Open the file, then `fstat` the **fd** (not the path) to check the size cap. This closes the check-then-open race.
- Sniff magic bytes against a png/jpeg/webp/gif allowlist. Refuse anything else with a named error
  **before** the provider is called (REQ-221 already requires that the provider is not called).
- For output, `mkdir -p` the directory, then realpath it and re-check containment. Use **engine-chosen file
  names** (`<label>-<callSeq>-<i>.<ext>`) and open with `O_CREAT|O_EXCL` (plus `O_NOFOLLOW` where available).
- Pick the extension from a **mime allowlist**, never from the provider's `mimeType` string, which is
  parsed out of the provider's data URL. The script never supplies a filename component.

**S2. Secret handling.** pi-ai requires an explicit `options.apiKey`. `resolveOpenrouterKey` is
module-private in `pi-gateway-client.ts` (G0 §4). Extract it into a shared resolver. The resolution
order stays the same, and no new secret is added (V40-Q6). Resolve the key per call, which is cheap and
survives a key rotation. Never put the key in `model.headers`, which is a field we might log. We must not use
pi-ai's own credential discovery.

**S3. Fixed endpoint.** The synthesized model object's `baseUrl` is an engine constant, not data
from the catalog or the script. Then nothing a workflow author writes can redirect the bearer
token to another host.

**S4. Privacy of logs (REQ-229), three leak paths beyond the obvious one.**
- `formatProviderError(normalizeProviderError(e))` includes the provider's response body. A provider
  that echoes the request (validation errors often do) would put `state` or `prompt` into
  `errorMessage`. **Events log only `{status, errorClass, attempt}`.** The full message goes to the
  script in the thrown error, because the script already owns that data.
- The persisted journal: hash the `decide` key (point 7 above). The image prompt is hashed the same way.
- Observed-stats and transcripts: the new records carry no `state` or `prompt` field at all. That makes the
  sentinel test (REQ-229) true by construction, not by redaction.

**S5. Static-check bypass (REQ-224).** Add `decide` and `generateImage` to `CALLABLE_API_NAMES`
(`script-checks.ts:96`). Without that, `const d = decide` evades every text scanner. Add them to
`SANDBOX_GLOBALS`, the guards.ts `wrap`/`toCtxPromise`/`reRealm`/`sanitizeThrownError` template, and
`SandboxApi`. Keep everything **inlined, with no local value imports** in `guards.ts` or `child-entry.ts`
(design constraint; memory note `rwe-sandbox-child-ts-imports`).

**S6. Validate input at the host, not in a static scan.** `state` is runtime data, so the agent-style rule
"literal options object with a closed key set" cannot apply to `decide`. The static scan therefore requires only
a **literal label** as argument 1. The host validates the rest:
- the options key set (`state`, `questions` / `prompt`, `inputImages`, `outDir`); any tunable key there →
  `PARAM_IN_SCRIPT`-equivalent named error
- `state` is a JSON object
- each question type is in {bool, choice, score}
- a byte cap on `state`, sized to the classifier's context window (Jev 32k)
- a cap on the number of questions

Each check is a pure function and gets its own unit test.

**S7. Authz is unchanged, and that is deliberate.** `authz.ts` has no per-model rule (G0 §4). The cost control
is the run budget. **Recorded, not relitigated**: the owner decided that with no USD budget and an unknown price the call
proceeds unpriced (V40-Q12). In pi-ai's snapshot 37 of 57 image rows have zero cost. At webhook volume
(V40-Q5) that unbounded-spend path is reachable. Pointing it out is all I do here (§3 R4).

### (b) Scalability / performance

**P1. Concurrency scope is process-wide per kind.** The contended resource is the **single shared
OpenRouter key's rate limit**, not any one run. One semaphore per kind is created in `main.ts` and
injected. REQ-228's test ("agent semaphore full, decide still proceeds") follows directly from the two
semaphores being separate. **Deferred**: per-run fairness. In a webhook storm, one run with
`parallel()` over 200 decides can starve other runs. I name this risk and do not design for it now.

**P2. REQ-230 hot path (overhead p95 ≤ 200 ms).** The engine's added work per call is:
- child→host IPC
- the replay lookup
- semaphore acquire
- `assertBudget`
- one price lookup **from the admission pin** (in memory)
- one better-sqlite3 journal write (sync, sub-millisecond)
- host→child IPC

Rules that keep it inside the budget:
1. **Never await ModelBook** (1 h TTL, single-flight refresh) on the call path.
2. Build the pi model object **at admission**, from the pinned row, and cache it per run.
3. Make no extra network round-trips: no catalog fetch and no generation-stats lookup for cost.

The REQ-230 measurement is (script-observed − provider-observed). The `fetch` seam records the provider
time and the stub provides fixed latency, so the test is deterministic and needs no network.

**P3. The admission pin must cover the new models.** `reachableModels` (`model-book.ts:194`) covers
`params.model` and `agents[*].model` only (G0 §3). Extend it to `decisions[*].model` and
`images[*].model`. Without that, REQ-225's rule "USD budget + unknown price → refuse before send" cannot be
evaluated from in-memory state, and the call would need a hot-path catalog lookup (violating P2).

**P4. Spend accounting under concurrency (the analogue of the template's "consistency of failure counting").**
`assertBudget` follows `agent()`'s precedent: it runs **after** acquiring the slot (G0 §1 step 5).
Concurrent calls can each pass the check before any adds usage. The overshoot is therefore bounded by
`concurrency × maxPerCallCost`. For decide that is negligible (fractions of a cent). For images it is
small with a low `imageConcurrency` default (2–4). **I recommend stating this bound in the
architecture, not adding a reservation/escrow mechanism.** The latter is speculative complexity and
inconsistent with `agent()`.

**P5. Memory.** Each in-flight image response holds base64 plus decoded bytes, roughly 2.3× the image size.
The `fetch` seam reads the body once with a hard cap (for example 32 MiB) and fails with a named error above it.
Peak image memory is then ≤ `imageConcurrency × cap × ~2.3`. That bound is the reason the image default stays low.

**P6. Retry and timeout semantics (REQ-227).** pi-ai's `classifySystemOne` defaults to `maxRetries ?? 2`, and its
policy also retries **408, 409 and undefined status**. REQ-227 wants **only 429 / 5xx / timeout**,
retried a declared number of times, with each retry visible in the event log. pi-ai's internal retries are invisible to us. Therefore:
- Call pi-ai with `maxRetries: 0`.
- The engine owns the loop (about 30 lines, injected `sleep`).
- Honour `retry-after`, but cap it (for example ≤ 10 s) because of the realtime use (V40-Q5). Above the cap,
  fail fast with the named error.
- `timeoutMs` is **per attempt**. Worst-case wall time is `(retries+1) × timeoutMs + backoff`.
  Document that formula in the served text.
- A run `stop` aborts in-flight provider calls via `options.signal`, so a stop never waits on a
  60-second image generation.

**P7. Catalog `?output_modalities=all`** raises the row count from 459 to 662 (G0 §0.1). The cost of that is trivial. The real risk is
semantic, not performance: chat rows must not change (REQ-222 last clause). A golden-snapshot test of the existing
chat rows (before vs after) is cheap and is the right guard.

### (c) Testability

**T1. The `fetch` seam is the whole test strategy.** Both pi-ai entry points accept `options.fetch`.
One scripted stub-fetch (status sequence, latency, body, headers) proves:
- REQ-227: the retry matrix (429 retried, 400 not, 408 not, timeout retried, count honoured)
- REQ-228: maximum in-flight count
- REQ-230: the overhead p95
- REQ-225: provider cost vs catalog estimate vs absent
- REQ-229: sentinel absence across every sink
- S1: the provider was **not** called on refusal (the stub call count stays 0)

No module mocking of pi-ai is needed. The real pi-ai codec stays in the loop, so the tests also catch
wire-format drift (for example the `bool` ↔ `noul` mapping).

**T2. Pure functions with their own unit tests**:
- `checkPrimitiveModelType(kind,row)` (REQ-223)
- `classifyRetryable(status|timeout)`
- `resolveContainedInput(root, rel)` (run against a temp dir with real symlinks)
- `canonicalKeyHash(state,questions)`
- `priceDecision(providerCost, pinRow, hasUsdBudget)` → `{usd, estimated} | absent | REFUSE`
- `mimeToExt`
- host-side option validation

**T3. RunManager integration** uses the existing sandbox with an injected stub `fetch` (through `main.ts`
composition). It covers the shared `callSeq`, resume replay with 0 provider calls (REQ-226), and
refusal-code propagation through `parallel()` (`ENGINE_REFUSAL_CODES`).

**T4. Wiring guard.** Memory note `composeconfig-wiring-bug-class`: new config blocks
(`decideConcurrency`, `imageConcurrency`, any image cap) silently fail if `composeConfig()` does not forward them.
Add them to `compose-config-v2-wiring.test.ts`.

**T5. Refusal-code set sync** covers three sets: guards.ts `ENGINE_REFUSAL_CODES`, run-manager
`RECORDED_REFUSAL_CODES`, and the `errors.ts` catalog. Add one test that asserts every new code appears in all
three, or in the sets it should be in.

**T6. Real tier (Gate 7.5, US$1 cap, V40-Q19).**
- One Jev decide and one cheap image model, with the cost recorded.
- A cold-client MCP authoring run for REQ-224.
- This is the **only** place the following unverified assumptions get settled: whether OpenRouter returns `usage.cost` on
  `/systemone` and on image completions, and the unit of `pricing.image_output`.

### The seven Gate-2 design constraints, addressed explicitly

| Constraint (REQ preamble) | Disposition |
|---|---|
| pi-ai root lacks `classify`/`generateImages` | Import from the `./api/typesafe-system-one` and `./api/openrouter-images` subpaths. No `createModels`. The model object is synthesized from ModelBook. |
| pi-ai failures resolve with `stopReason:'error'` and do not reject | The adapter converts `stopReason !== 'stop'` into a typed engine error. For retry classification it reads the status captured by the `fetch` seam, never by string-matching `errorMessage`. `'aborted'` → the run-stop path. |
| No local value imports in `guards.ts` / `child-entry.ts` | New globals inline-copied from the `makeAgent` template; type-only imports. |
| Shared `callSeq` | `decide`/`generateImage` draw from the child's single counter. Every call (success, or refusal after the replay check) is journaled exactly as `agent()` is, so later replay alignment holds. |
| Must not route through `_handleAgentRequest` | Separate handlers that reuse the replay, guard slot + `assertBudget`, journal and refusal-ledger pieces. |
| Three refusal-code sets in sync | T5 test. |
| Image pricing per image; `priceCall` is token-only | First choice: the provider `usage.cost` captured via the seam. Fallback: a ModelBook rate that **adds an `image_output` column** to the pin. Otherwise the cost is absent (v31 rule), or the call is refused when a USD budget is set. **No change to `priceCall` for agents.** |

---

## 3. Risks

- **R1 (high, security). Symlink exfiltration / out-of-tree write (S1).** If Gate 3/4 implements only
  lexical `..`/absolute-path checks (which is what REQ-221's acceptance literally names), the key file can be uploaded. The acceptance
  tests must include a **planted-symlink case** for both `inputImages` and `outDir`.
- **R2 (high, correctness of REQ-225). Provider cost may not be available through pi-ai.** pi-ai's
  `parseUsage` prices from *its* model object and ignores any `usage.cost` in the body. Without the
  `fetch`-tee capture, the "provider first" rule is dead code, and with pi's zero-cost rows images would
  record **$0. That is exactly what the v31 rule forbids.** Unverified: whether OpenRouter actually returns `usage.cost`
  on these endpoints.
- **R3 (medium). Retrying a timed-out image generation can double-bill.** The provider may finish the work after we
  time out. **Reliability vs cost conflict**: I recommend that the guide's suggested default for
  `images.<label>.retries` be 0–1 and that it state the double-billing caveat. The author still declares the value (V40-Q14).
- **R4 (medium, owner-accepted). Unbounded unpriced spend** with no USD budget and an unpriced image
  model at webhook volume (S7). Mitigation without new features: the run summary marks the call unpriced (REQ-225),
  and `models_list` shows the price as absent. Nothing more this round.
- **R5 (medium). ModelBook drops `modelType` in `toModelCatalogSnapshot`** (G0 §3). REQ-223 needs it
  at registration. The projection must carry it, and the old existence check must keep seeing the same rows.
- **R6 (medium). Image replay when the file was modified, not just deleted.** REQ-226 covers only "missing". I
  propose that a sha256 mismatch is also a miss, because returning a path whose bytes differ from the recorded `bytes`/`sha256`
  breaks REQ-221's invariant. The architect must decide, and if this is adopted, the guide must state it.
- **R7 (low). pi-ai upgrade drift.** We depend on the `./api/*` subpaths and on `options.fetch` /
  `maxRetries` semantics. Pin 1.0.0 exactly (already a direct dep). The T1 tests run the real codec, so an
  upgrade that changes the wire format fails CI.
- **R8 (low). The `errorMessage` thrown to the script may contain provider-echoed data.** The script owns
  that data, but if the script then passes the message to `agent()` or returns it, it lands in the journal / result. This is
  acceptable: it is the author's data flow, not an engine leak. State it in the guide.

---

## 4. Internal conflicts within my own three lenses (surfaced explicitly)

| Conflict | Security says | Perf says | Testability says | Tie-break (simplicity) |
|---|---|---|---|---|
| Body handling in the `fetch` seam | Buffer and cap the body, inspect cost and size | Don't double-buffer large images | One seam = one stub | **Read once with a cap, build a new `Response` from the buffer.** One copy, all three satisfied. |
| Retry ownership | Exact policy, logged | Retries add latency; cap `retry-after` | Engine loop with injected `sleep` is deterministic | **Engine-owned, `maxRetries:0` to pi-ai.** REQ-227's "every retry logged" forces it. |
| Journal key | Hash it (no plaintext state at rest) | Hashing costs ~µs | Equality on a hash is trivially testable | **sha256 of canonical JSON.** A dictionary attack on low-entropy states is moot because the hash is never served. |
| Budget reservation | Reserve before send (no overshoot) | Reservation adds contention and complexity | More states to test | **No reservation.** Document the `concurrency × maxPerCallCost` bound, same as `agent()`. |
| Image replay verification | Verify sha256 (integrity) | Hashing a big file on resume costs ms | Extra branch | **Verify.** It runs only on resume and keeps REQ-221's returned-metadata invariant true. |
| Concurrency scope | Per run limits blast radius | Process-wide matches the shared-key bottleneck | Either is easy to test | **Process-wide per kind.** Per-run is deferred as speculative until fairness is observed failing. |

---

## 5. Expected disagreements with other lenses

- **Quality-dimensions / observability group**: may want decide/image calls to reuse the
  `AgentRecord` / transcript pipeline so the dashboard and observed-stats "just work". I agree on
  **reusing the usage-event fold**, so `foldUsage` / `foldUsageFromRecords` see the spend. I disagree with
  letting them land in the chat `tools`/`prose` buckets (REQ-225 last clause). A **`callKind`
  discriminator** on the record is the minimum. A full new dashboard node kind is deferrable.
- **"Use pi-ai's catalog" (replaceability / less code)**: someone will argue for `createModels().setProvider()`
  plus `getModelOfType()` as the documented pi-ai path (G0 §9). My counter: that path creates a second
  catalog with a second price (37 of 57 image rows at zero cost) and a frozen model list. Synthesizing from ModelBook
  is less code *and* gives one source of record.
- **"Let pi-ai retry" (less duplicated code)**: rejected. pi-ai's policy differs from REQ-227 (408/409/no-status)
  and is invisible to the event log.
- **Architect simplicity vs my S1 controls**: someone may call realpath/fstat/magic-sniff/O_EXCL
  over-engineering for a "dev tool" (Gate 1.5 QM). It is not. The host is a privileged deputy reading
  agent-written trees, and the requirement text itself flags REQ-221 for security review.
- **Product/UX lens**: may want `generateImage` to return base64 or accept URLs for convenience.
  Both are Won't (V40-Q4/Q15), and I support that line on memory (P5) and privacy (S4) grounds.
- **Anyone proposing per-run concurrency caps or a spend-reservation ledger**: I will oppose both as
  speculative this round (§4).
