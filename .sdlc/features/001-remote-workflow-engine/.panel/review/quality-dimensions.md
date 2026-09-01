# Gate 8 architecture-consistency review — Quality-dimensions lens (v21)

- **Lens:** Quality-dimensions expert (Observability / Replaceability / Consumability / Self-sustainability)
- **Scope:** v21 iteration (IMPL-129..146) vs ARCH-064..070 + ADR-001..008 + the v21-amended invariants in `02-architecture.md` (incl. ARCH-066 inv 1–6, the v21 4+1 views and interface table). Code universe = the union of the IMPL `files:` lines, verified against `git diff 637b86e..HEAD --stat -- src/` (17 files, exact match — no orphan source file this pass).
- **Calibration applied:** adjudications #1–#9 and the Gate 8 amendment notes are read as design of record (the integrator note in 06-impl-log.md §v21 says so explicitly). Recorded residuals (ADR-005 lowered-ceiling asymmetry, ADR-008 declined telemetry/masking, S-1 ceilings-less catalog, ARCH-066 F3 nesting residual, the resolve.ts `mapEffort` debt *as debt*) are verified-still-fenced, not re-filed.
- **Verdict: 2 violations (both LOW, both documentation/guard-rail class — zero code-vs-architecture behavior violations found).**

---

## 1. Observability

**Checked, consistent:**

- **Per-key provenance emitted by the computing function, never inferred by value comparison** (ARCH-065/068, quality O-1 ≡ adversarial T-4): `src/params/resolve.ts:43-58` (`defaultRunParams` writes `{value, rung}` in one pass), `:62-70` (`mergeRunParams` flips the rung in the same statement that writes the value), `:75-127` (`resolveCallParams` carries `modelRung/effortRung/…` beside each value). No comparison-based inference anywhere.
- **One descriptor-decoration site; gateway's own model/provider never overwritten** (ARCH-068, DES-105): `src/agent-executor.ts:409-419` — the single `onHarness` closure spreads the gateway descriptor first, then adds only `effort/timeoutMs/provenance/effortApplied`. `descriptor.model`/`provider` untouched.
- **Redact-then-cap ordering at the single persist site, cap unconditional** (ARCH-068 as amended A10/O-2; R-G9 end-state): `src/agent-executor.ts:436-439` — `redact()` runs first (when a provider exists), `capPrompt` is applied outside the provider branch. `capPrompt` exported at `agent-executor.ts:25`; `redactHarness` (`:36`) is purely structural and passes the prompt uncut. Both `kind!=='harness'` carve-outs are gone: `agent-executor.ts:452-461` (`onEvent`) and the `_emit` comment at `:176` redact unconditionally (R-G10 end-state).
- **Pre-dispatch guard records THEN throws — no silent null via `parallel()` swallow** (ARCH-068/DES-105): `src/agent-executor.ts:312-320` — `_sink.capture(...)` of a terminal-failure entry precedes the `PARAM_OUT_OF_RANGE` throw, in the same function.
- **`effortApplied` tri-state matches the amended "sent, not verified-honoured" definition** (ARCH-068/069, A6): `src/gateway/client.ts:28-31` (`EffortApplied` union), `src/agent-executor.ts:418` (applied → `{param,value}`, not-applied → `{reason}`, absent → field absent). Same object travels to wire and descriptor: SDK `claude-agent-sdk-client.ts:509` (computed once) → `:581` (onto `options`) → `:596` (`onHarness(descriptor, applied)`); LiteLLM `client.ts:338` → `:351`, body via `effortBodyFields` on both branches (`:167`, `:304`).
- **Rejections report size, never caller content** (DES-101 row 6, unconditional per IMPL-144): `src/params/contract.ts:343-373` (appendPrompt size-only branches incl. F2 forgery refusal at `:349-356` carrying `{param, suppliedBytes}` only), `:389-396` (post-hoc sanitize of the enum branch — `supplied`/`suppliedTruncated` deleted, `suppliedBytes` substituted). `truncatedSupplied` (`:89-102`) is the O(n) UTF-8-boundary-safe slice (A2).
- **Live-record stamp at session build** (#20 seam preserved): `src/agent-executor.ts:424` (`sink.markHarness` before first token).
- **`workflow_agent_log` surfaces the four v21 descriptor fields in its tool description** (`src/server.ts:373`) — **QD-CONS-1/QD-OBS routing closed**: the three quality-lens LOW items IMPL-140 left "for the next reviewer to route" are all confirmed closed at HEAD: QD-OBS-1 (process-view `appendPromptBytes` — dropped from the sequence diagram with an amendment comment, `02-architecture.md:915-917`), QD-CONS-1 (`workflow_agent_log` description, `server.ts:373`, landed in `244f9f0`/IMPL-142), QD-CONS-2 (phantom `parseUserOverrides` — ARCH-064 note + S-2 now name `validateUserOverrides`, A9/C-1). No further routing needed.

**No observability violation found.**

---

## 2. Replaceability

**Checked, consistent:**

- **Effort mapping is a config row, not a branch** (ARCH-069, D-PROFILE lineage): `src/gateway/client.ts:41-43` — `EFFORT_PROFILES` with `anthropic: { param:'effort', restPath:['output_config','effort'] }`; a new provider dial is one more row. `restPath` present per the amended A12/R-1 api line, placement travels with the decision (`effortBodyFields`, `client.ts:137-138` `reduceRight`; SDK flat write `claude-agent-sdk-client.ts:581`).
- **`thinkingFor` stays the SOLE writer of `options.thinking`** (IMPL-135's top-risk fence): `claude-agent-sdk-client.ts:532` is the only `thinking:` write; the effort write at `:581` targets `applied.param` only, comment-fenced at `:507-508`. Grep confirms no second writer.
- **`session-options-builder.ts` fence holds AND is structurally pinned** (ADR-006): zero `src/` importers at HEAD (grep — only the doc-comment citation in `resolve.ts:152`, which the pin's own regex deliberately excludes); the standing zero-importer assertion exists at `tests/unit/gateway-effort.test.ts:195-213`.
- **`GatewayClient.invoke(prompt,opts)` contract unleaked**: `AgentExecutor` consumes only the `invoke`/`onHarness`/`onEvent` surface (`agent-executor.ts:465`); no SDK `Options` type crosses into orchestration.
- **One shared alias predicate through both registration doors** (ARCH-064 "the ONE alias predicate", F1 half 1): `contract.ts:80-84` (`isKnownAlias`, openrouter-passthrough + empty-table skip) consumed by `harness-defaults.ts:89-93`, `contract.ts:233/242/405`, `run-manager.ts:424`.

**Finding QD-REP-1 (LOW) — the "unsafe to adopt" `resolve.ts` `mapEffort` copy has no structural guard, unlike the parallel ADR-006 fence.**
- **ARCH/decision implicated:** ARCH-065's amended debt entry (A12/R-1: the copy "is WRONG — no `restPath` … a loaded gun in the source tree"; standing instruction = delete at next touch of DES-102/DES-106) read against the iteration's own guard-rail precedent: the *other* declared fence in the same api line (ADR-006 / `session-options-builder.ts`) is enforced by a standing zero-`src/`-importer test (`tests/unit/gateway-effort.test.ts:198-213`), added precisely because "no assertion existed anywhere in the suite".
- **Evidence:** `src/params/resolve.ts:154-164` still exports `ProviderEffortProfile`/`mapEffort` (flat shape, no `restPath`); grep over `src/` confirms zero production importers (only `run-store.ts:7`, `run-manager.ts:43`, `sqlite-run-store.ts:10`, `agent-executor.ts:9` import *other* names); grep over `tests/` finds it exercised by `tests/unit/params-resolve.test.ts:228-253` but **no test anywhere asserts its zero-importer status**. A future `src/` import of it goes green and silently re-emits top-level `effort` on the REST body — the exact HIGH defect P-A1 fixed, with nothing going red.
- **Severity:** LOW (self-sustainability/replaceability guard-rail gap, not a live behavior defect — the wired copy is correct). **Suggested closure:** either land the pre-authorized deletion (with the re-pointing of the 5 UT-099 cases, next DES-102/DES-106 touch) or add a one-`it()` zero-importer pin mirroring the ADR-006 one until then. Not a duplicate of the recorded debt: the debt records the *copy*; this records that the fence around it is declared but unenforced — the same advertised≠enforced shape this iteration closed four times in code.

---

## 3. Consumability

**Checked, consistent:**

- **One shared five-code `Err` union, emitter→code mapping exactly as ARCH-064's api table:** `contract.ts:45-50`; `parseParamContract` emits only `PARAM_CONTRACT_INVALID` (single `invalid()` helper `:155-157`, incl. locked-key-as-knob `:218-219` and bad alias `:234/:243`); `validateUserOverrides` emits `PARAM_LOCKED` (`:318-325`), `PARAM_UNKNOWN` (`:326-333`), `PARAM_OUT_OF_RANGE` (via spec checks + F2 `:349-356`), `UNKNOWN_ALIAS` (`:405-412`); `validateDeclaredArgs` → `PARAM_OUT_OF_RANGE` (`:422-430`). Three rungs, three codes, verified.
- **Errors are self-describing** (ARCH-064 inv-3): `PARAM_OUT_OF_RANGE` carries `{param, supplied|suppliedBytes, allowed}`; `PARAM_LOCKED`/`PARAM_UNKNOWN` carry `{param, tunable:[...]}` — an agent caller can repair without a second round-trip.
- **Read surfaces never serve null/unbounded; lowered ceilings honored at read with no re-register** (ARCH-067, B-3): `src/mcp-facade.ts:24-25` (`readParams` = `effectiveBounds(stored ?? canonicalContract(), ceilings)`), used by `workflow_list` (`:196`) and `workflow_get` (`:217`); `boundMax` covers **both** `timeoutMs` and `appendPrompt` (A5, `contract.ts:145-150`), `boundEffort`/`boundMax` total over poisoned rows (A1 half 2, `:126-138`).
- **Backward compat is explicit, not undefined-shaped** (ARCH-064 inv-4): `canonicalContract()` (`contract.ts:110-120`); no-meta/impure-meta/no-params all resolve to it (`workflow-meta.ts:49-72`); ad-hoc inline scripts bound by it at admission (`run-manager.ts:409`).
- **Tool schemas/descriptions match behavior under the ARCH-051 drift-lock:** `workflow_run.overrides` ceiling wording (`server.ts:332-334`), `workflow_register.defaults` advertises all 7 keys incl. ceiling refusal (`server.ts:402-403`; drift-lock pin in `tests/integration/schema-drift-v15.test.ts` per IMPL-145 C-3); `workflow_agent_log` description (`server.ts:373`). ARCH-064 inv-2's amended honesty (inputSchema = client-facing doc, `validateUserOverrides` = the control) matches `server.ts:799`'s cast-and-forward.
- **Issue binding consumable as specified** (ARCH-070): label-scoped sanitize + 50-char cap (`issue-reporter.ts:178-179`), untruncated `name@version` in body (`:214`), fingerprint extension (`:158`), symmetric label-filtered list (`:488`); F5 collision documented at both ends (`issue-reporter.ts:165-177` + the `issue_list.workflow` tool description).

**Finding QD-CONS-3 (LOW) — the v21 interface table still claims the ceilings are "user-override ceilings only", contradicting the S-2-amended ARCH-066 inv-4 / ADR-005 two-rung scope.**
- **ARCH/INV implicated:** ARCH-066 invariant (4) as amended (S-2: "engine ceilings bound the user override rung AND, since G-1, the values stored into the `defaults` column at registration time") and ADR-005's amended decision text.
- **Evidence:** `02-architecture.md:967` — the `rwe.config.json` row of "v21 interface & API contracts" reads "`+maxTimeoutMs` (600000), `+maxAppendPromptBytes` (1024), `+maxEffort` ('high') — **user-override ceilings only**". The code enforces two rungs: admission (`run-manager.ts:410`) **and** registration over the final stored defaults (`workflow-catalog.ts:171-194`, G-1). The S-2 amendment corrected inv-4 and ADR-005 but missed this row. Same stale claim also survives in `DEPLOY.md:349` ("不影響作者 `defaults`" on the `maxTimeoutMs` row — false since G-1 for caller-supplied and normalized defaults alike), noted here as a second surface of the identical drift, one fix class.
- **Severity:** LOW — doc-drift only, no behavior gap; but it is verbatim the class S-2 itself warned about ("an architect reading the superseded text would re-open G-1's hole at the next composition site"), now surviving on the *interface contract* table an integrating caller is most likely to read, plus the operator-facing DEPLOY row. **Suggested closure:** one-line amendment to `02-architecture.md:967` ("bounds the caller-override rung at admission AND the stored defaults at registration; script per-call opts unbounded per ADR-005") and the matching DEPLOY.md §1 row wording.

---

## 4. Self-sustainability

**Checked, consistent:**

- **The composeConfig bug class stays closed** (ARCH-066 inv-6; the memory'd wiring class): `src/main.ts:162-164` forwards all three ceiling keys; `tests/unit/compose-config-v2-wiring.test.ts:130-142` pins each; fail-closed per-consumer defaults exist in `RunManager` (`run-manager.ts:110, 233-236`) and `McpFacade` (`mcp-facade.ts:16-23, 97`).
- **One ceilings object, one alias table, at every composition end** (P-A2/R-G3 class): `server.ts:1144-1147` builds `ceilings` once, forwarded to catalog (`:1158`), `RunManager` (`:1210`) and facade (`:1226`); both alias sites read `config?.aliases ?? DEFAULT_ALIASES` (`server.ts:1157`, `:1208`). The known S-1 residual (a catalog constructed *without* `opts.ceilings` enforces no registration ceiling — `run-manager.ts:218` fallback) is verified still fenced exactly as recorded: production composition always passes the shared object; not re-filed.
- **Rejection leaves zero durable work** (ARCH-066 placement): the whole v21 rung (`run-manager.ts:403-431`) sits before `createRun` (`:439`) and `runWorkspace` (`:440`); `paramCodedError` (`:115`) preserves the typed code + detail.
- **Resume is refusal-only and cannot drift from the writer's grammar** (ARCH-066 inv-2/5, R-G1, P-A6, F2 durable half): `run-manager.ts:538-539` uses the *imported* `hasSecretMarker` (`secret-resolver.ts:124-126`, sharing `MARKER_PREFIX` with `redact()` itself); `:547` uses the *imported* `FRAME_CLOSE_FORGERY` (exported `contract.ts:75` — the Gate 6.5 dedup landed; no retyped literal). Legacy NULL-snapshot fallback for in-flight pre-v21 runs at `:642` (`?? defaultRunParams(registered.defaults)`).
- **Degradation is honest, never a crash or a hang:** provider without a dial → `{applied:false, reason}` (`client.ts:55-58`), no 400 re-opened (thinking untouched); poisoned stored rows survivable on every read path (A1 half 2 totality, `contract.ts:126-138`); rejection-path cost bounded O(n) with UTF-8 backoff (A2, `:89-102`) so one oversized override can no longer block the event loop.
- **Idempotent additive migrations, both stores symmetric:** `sqlite-run-store.ts:71` (`ALTER TABLE … effective_params`, catch-exists), `:89-92` (`getEffectiveParams`), `run-store.ts:81/85/137` (port + in-memory seam); catalog `params TEXT` same pattern (IMPL-129, B-5 pre-v21-row case pinned in IT-012).
- **Snapshot sink in the redaction loop** (ARCH-066 inv-5): `run-manager.ts:435-437` redacts before the durable write; live `RunEntry` keeps the unredacted copy for dispatch (`:503`), nested frames share it by reference (`:864`) — consistent with the F3 residual as recorded (not re-filed; the v22 candidate stands).
- **Explicitly-NOT-built list respected:** no metrics subsystem, no vault backend, no provider SPI, no in-process watchdog appeared in the v21 diff — the generic self-sustainability menu (autoscaling, memory metabolism, prompt self-calibration) is correctly absent per the architecture's own exclusion lists.

**No self-sustainability violation found beyond QD-REP-1's guard-rail note (filed once, under Replaceability).**

---

## Summary

| # | Finding | ARCH/INV | Evidence | Severity |
|---|---|---|---|---|
| QD-CONS-3 | Interface table (+ DEPLOY row) still says ceilings are "user-override only" — contradicts S-2-amended ARCH-066 inv-4 / ADR-005 | ARCH-066 inv-4, ADR-005 | `02-architecture.md:967`; `DEPLOY.md:349` vs `workflow-catalog.ts:171-194` | LOW |
| QD-REP-1 | Declared "unsafe to adopt" fence on `resolve.ts`'s `mapEffort` copy has no structural pin (unlike the ADR-006 fence) — a future importer regresses P-A1 with nothing red | ARCH-065 debt entry (A12/R-1), ADR-006 precedent | `src/params/resolve.ts:154-164`; pin exists only for `session-options-builder` (`tests/unit/gateway-effort.test.ts:198-213`) | LOW |

**Consistent: NO (2 LOW violations, zero behavior-level deviations).** Every load-bearing v21 invariant this lens owns — provenance-at-computation, one decoration site, redact-then-cap, tri-state honesty, five-code taxonomy, ceiling-bounded read surfaces, refusal-only resume, composeConfig wiring, one-table/one-object composition — is implemented as decided.
