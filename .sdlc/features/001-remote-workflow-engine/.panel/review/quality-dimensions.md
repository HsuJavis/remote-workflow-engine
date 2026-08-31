# Gate 8 review — Quality-dimensions lens (observability / replaceability / consumability / self-sustainability)

- **Scope:** v21 slice only (IMPL-129..138 ↔ ARCH-064..070, ADR-001..008; REQ-090..095). Files read = the union of the v21 IMPLs' `files:` lines plus their direct module-boundary references (`submission-validator.ts`, `default-aliases.ts` usage sites, `compose-config-v2-wiring.test.ts`).
- **Reading discipline for adjudications:** per the v21 integrator note, the A-*/B-*/C-* adjudications in 04-design.md override earlier DES text and are treated as design, not drift. Where 02-architecture.md itself was never amended to match, that is reported below as stale-architecture doc drift (QD-5), not implementation deviation.
- **Verdict: NOT consistent.** 5 findings: 1 HIGH implementation deviation from an adopted Gate 2 decision (QD-1), 2 MEDIUM (QD-2, QD-3), 2 LOW (QD-4 doc/boundary, QD-5 stale ARCH text). Everything else checked under the four dimensions conforms (positive verifications listed per section).

---

## 1. Observability — transparency of internal state

### QD-1 (HIGH, shared with self-sustainability) — the adopted "effective post-merge model alias-checked at submission" decision is not implemented; an unresolvable model admits the run and dies as an opaque per-agent `null`

- **Violates:** the v21 Gate 2 Decision rationale, "Quality S-1 (stale registered defaults) adopted in reduced form": *"the effective (post-merge) model is checked at submission with the existing alias rule (including the `openrouter/<id>` passthrough carve-out) and reuses the existing `UNKNOWN_ALIAS` code … the evidence shows a real hole, so it stays — but as one call"* (02-architecture.md:974). Also ARCH-066's "before any durable work" typed-refusal intent and this lens's core rule (a silent/opaque failure is a design defect).
- **Evidence:**
  - `src/run-manager.ts:399` — `validateUserOverrides(contract, overrides, new Set(), this._ceilings)`: the alias vocabulary passed to the admission rung is a hard-coded **empty set**.
  - `src/params/contract.ts:217-267` — `validateUserOverrides` declares `aliasNames` but **never reads it** (dead parameter); no model-alias check exists in the function body.
  - `src/params/contract.ts:157-158` — a comment claims *"at submission only the effective model is re-checked via the existing UNKNOWN_ALIAS rule"* — that check exists **nowhere**: `grep -rn UNKNOWN_ALIAS src/` hits only `submission-validator.ts:112`, whose scan (`extractModelAliases`, submission-validator.ts:34-42,109-113) runs **only over inline `spec.script` text** — a named run's registered default, and any `overrides.model`, are never checked (this is exactly the hole the S-1 evidence in the rationale documents; it is still open).
  - Consequence path: `overrides:{model:'no-such-alias'}` (or a registered `defaults.model` that no longer resolves) passes admission (run-manager.ts:399-407), `createRun` + workspace happen (415-416), and at dispatch `LiteLLMGatewayClient.invoke` hits `if (!target) return { ok:false, provider:'unknown', reason:'terminal' }` (src/gateway/client.ts:324) → every `agent()` in the run resolves `null` with a 0-token `terminal` usage record. The caller paid for a run row, a workspace, and a sandbox to learn nothing typed.
- **Why HIGH:** this is not a declined option — the rationale explicitly *adopted* the check after weighing it ("the evidence shows a real hole, so it stays"). The in-code comment claiming the check exists makes it the fifth instance of the silent-wiring-miss class (composeConfig bug class) that v21's own provenance machinery was built to end.
- **Fix shape (one call, as the decision specified):** after the merge at run-manager.ts:405-407, check `effectiveParams.model` (when set) against the gateway's alias table + the `openrouter/.+` passthrough, throw `UNKNOWN_ALIAS`; thread the real alias-name set (or delete the dead `aliasNames` param from `validateUserOverrides` and do the check in run-manager).

### Observability — conforming (verified)

- Per-key provenance is emitted by the computing function, never inferred by value comparison: `src/params/resolve.ts:44-49,58-61,74-119` (`{value, rung}` in one pass).
- One descriptor-decoration site: `src/agent-executor.ts:390-413` merges `effort`/`timeoutMs`/`provenance`/`effortApplied` onto the gateway descriptor without overwriting `descriptor.model`/`provider`; `types.ts:227-239` carries the matching optional fields.
- `effortApplied` tri-state survives the reshape: `{param,value}` / `{reason}` / absent-when-never-requested (`agent-executor.ts:399`, `types.ts:232`) — "silently dropped" and "never asked" stay distinguishable per ARCH-068.
- Pre-dispatch out-of-contract `effort` is RECORDED then THROWN (`agent-executor.ts:293-302`: `_sink.capture` with a terminal FailureEnvelope-shaped record, then `codedError('PARAM_OUT_OF_RANGE')`) — cannot become a silent null through `parallel()`'s swallow. ARCH-068 satisfied.
- The `effectiveParams` snapshot is a new persist sink routed through `redact()` before the durable write, with the live `RunEntry` keeping the unredacted copy (`run-manager.ts:408-413,479`) — ARCH-066 inv (5) satisfied; recorded ≡ dispatched divergence avoided.

---

## 2. Replaceability — decoupling & pluggability

### QD-2 (MEDIUM) — two `mapEffort` translators exist; ARCH-065's "the ONLY effort translator" invariant is textually false and ARCH-069's declared dependency on ARCH-065 is unrealized in code

- **Violates:** ARCH-065 (*"`mapEffort` is the ONLY effort translator"*, api lists `mapEffort` in `src/params/resolve.ts`); ARCH-069 (api: *"both `GatewayClient` implementations … apply `mapEffort(...)`"* with `deps: ARCH-065, ARCH-005`).
- **Evidence:**
  - `src/params/resolve.ts:147-157` — exports `ProviderEffortProfile` (per-provider value-table shape) + `mapEffort` with **zero production importers**: `grep -rn "from '.*params/resolve" src/` → run-store.ts, sqlite-run-store.ts, agent-executor.ts (imports only `resolveCallParams, composePrompt` + types), run-manager.ts (`defaultRunParams, mergeRunParams`). Nothing imports its `mapEffort`.
  - `src/gateway/client.ts:24-50` — a second, differently-shaped `mapEffort`/`EffortProfile`/`EFFORT_PROFILES` is the one actually wired (client.ts:327; claude-agent-sdk-client.ts:19,509 imports it from `./client.js`). `src/gateway` never imports from `src/params/resolve.ts` at all — ARCH-069's declared dep on ARCH-065 does not exist in code.
- **Why it matters for this lens:** an inert second copy of the effort vocabulary is precisely the built-but-unwired class this iteration existed to repair (`resolveHarnessParams` was deleted for exactly this reason, IMPL-137), and it splits the "adding a provider is a config row" seam into two candidate tables — the next implementer must guess which one is real. IMPL-138 recorded this as an observation and deliberately left it; from this lens it is a standing hazard, not a neutral observation.
- **Fix shape:** delete `mapEffort`/`ProviderEffortProfile` from `resolve.ts` (and re-point UT-099's cases at the gateway mapper), or make the gateways consume the resolve.ts mapper — either way one translator; then amend ARCH-065/ARCH-069 text to name the surviving module.

### QD-4 (LOW) — v21 introduced an undeclared reverse module edge: `src/gateway` now value-imports from `src/agent-executor.ts`

- **Violates:** ARCH-069's declared `deps: ARCH-065, ARCH-005` (module-boundary completeness — the same rule the Gate 6.5+7 `solid_check` pass enforced in the forward direction).
- **Evidence:** `src/gateway/client.ts:7` — `import { redactHarness } from '../agent-executor.js'` is a **value** import, confirmed new in v21 (`git diff 637b86e..HEAD -- src/gateway/client.ts` shows the `+import` line; landed with the A-4 swap, commit f50484c). Combined with `agent-executor.ts:4`'s type-import of `./gateway/client.js`, the executor (ARCH-004/068) and gateway (ARCH-005/069) modules are now mutually coupled — the gateway can no longer be swapped without dragging the executor module in. The Gate 6.5+7 rationale entry (02-architecture.md:979) fixed the two forward edges but missed this reverse edge that v21 itself created.
- **Fix shape:** move `redactHarness` (a pure transform, agent-executor.ts:17-45) into a neutral module (e.g. `types.ts` or a `redact-harness.ts`), or declare the dependency; note that A-4's *intent* (one shared transform, zero behavior change) is correctly implemented — only its placement breaks the boundary.

### Replaceability — conforming (verified)

- ADR-006 fence holds: `session-options-builder.ts` still has **zero** `src/` importers (only a comment reference at resolve.ts:145); the unwired-debt track was not dragged into the run path.
- `EFFORT_PROFILES` is a flat config table (client.ts:32-34); a new provider dial is one row; a profile-less provider is an honest `{applied:false, reason}` no-op (client.ts:48), never a 400 or a crash.
- `thinkingFor` remains the sole writer of `options.thinking` (claude-agent-sdk-client.ts:507-509,532) — the D-F6 regression guard is intact; the effort mapper writes a different wire field.
- The `tsc` lever is real: `AgentReq.runParams` is required, no `?`, no default (agent-executor.ts:109-121), built at the one production site (`run-manager.ts:817`), so `_spawnerOverride` carries it automatically — the inert-wiring class ARCH-068 targets is closed by construction.

---

## 3. Consumability — ease of use & low integration cost

### QD-3 (MEDIUM) — the author-side model vocabulary is inconsistent: `params.knobs.model.enum` fail-closes against an empty alias set on an unconfigured server, rejects valid `openrouter/<id>` passthrough ids everywhere, and diverges from `validateHarnessDefaults`' permissive rule inside the same `register()` call

- **Violates:** ARCH-064's "single source of truth" intent for the alias vocabulary shared with the alias validator; the S-1 adoption's "the existing alias rule (including the `openrouter/<id>` passthrough carve-out)" (02-architecture.md:974); REQ-038's established model vocabulary (submission-validator.ts:29-31,106-113 accepts passthrough ids).
- **Evidence:**
  - `src/server.ts:1141` — `aliasNames: config?.aliases ? new Set(Object.keys(config.aliases)) : undefined`: when the operator omits `aliases` (the documented anthropic-only DEFAULT_ALIASES fallback, main.ts:36-38; run-manager.ts:47-48 dispatches against DEFAULT_ALIASES), the catalog gets `undefined`.
  - `src/workflow-catalog.ts:117` — `parseMetaParams(script, this._aliasNames ?? new Set())` then **fail-closes against an empty vocabulary**: `contract.ts:159-165` rejects every `model.enum` entry as "not a known alias", so on a default-alias server an author cannot declare a model enum at all — even naming `'sonnet'`, which dispatch would happily route.
  - Two policies in one function: three lines up, `validateHarnessDefaults(defaults, this._aliasNames)` deliberately **skips** the alias check when the set is empty/undefined (harness-defaults.ts:35-36,70: D-AUTH-5-B backward-compat) — so `defaults.model:'sonnet'` registers fine while `params.knobs.model.enum:['sonnet']` is refused, in the same `register()` call, for the same reason-of-being value.
  - `contract.ts:159-165` has no `openrouter/.+` passthrough carve-out, so an author constraining `model` to a valid passthrough id (`enum:['openrouter/qwen-72b']`) is rejected even on a fully-configured server, while the same string is a valid `agent({model})` value (submission-validator.ts:111, models_list's own tool description at server.ts:583 tells agents `ref` is "directly usable as an agent({model}) value").
- **Why MEDIUM:** typed and fail-closed (not silent), but the integration cost lands on the API's primary consumer — a workflow author following `workflow_get`/`models_list` guidance gets `PARAM_CONTRACT_INVALID` for vocabulary the rest of the surface accepts. Divergent validation rules for one concept across one entry point is the consumability defect class ARCH-008/D-VAL was created to prevent.
- **Fix shape:** thread one alias-vocabulary predicate (DEFAULT_ALIASES-aware + passthrough carve-out) into both `validateHarnessDefaults` and `parseParamContract`; same predicate resolves half of QD-1.

### Consumability — conforming (verified)

- `workflow_run.overrides` inputSchema: exactly the four tunable properties, `additionalProperties:false`, with per-property ceiling documentation and the resume caveat in the description (server.ts:326-336) — allowlist at both ends per ARCH-064 inv (2).
- Error envelopes are self-repairing: `PARAM_LOCKED {param, tunable[]}` (contract.ts:228-234), `PARAM_OUT_OF_RANGE {param, supplied/suppliedBytes, allowed/maxBytes}` (contract.ts:179-213,247-257), `PARAM_UNKNOWN {param, tunable[]}`; oversized `appendPrompt` is reported **by size only** — the text never enters a detail object (contract.ts:245-257), and rejected free-text echoes are 64-byte-truncated with `suppliedTruncated:true` (contract.ts:63-70).
- Read surfaces never serve null/unbounded: `readParams(stored, ceilings)` = `effectiveBounds(stored ?? canonicalContract(), ceilings)` on both `workflow_get` and `workflow_list` (mcp-facade.ts:24-25,196,217-230); lowering a ceiling takes effect at read time with no re-register (contract.ts:101-113).
- `workflow_resume` rejects the mere **presence** of `overrides` with `RESUME_OVERRIDES_NOT_ALLOWED` and an actionable message (mcp-facade.ts:172-176) — no absent-vs-`{}` semantics to get wrong.
- `issue_report`/`issue_list` are symmetric through the same `workflowLabel()` sanitize (issue-reporter.ts:169-170,438,479); untruncated `name@version` in the body (204-205); fingerprint extends **only when** `workflow` present so absent-`workflow` output stays byte-identical to pre-v21 (158-160) — REQ-095 backward compat honored.

---

## 4. Self-sustainability — closed-loop autonomy & lifecycle

### (QD-1 also lands here — see §1: an unresolvable effective model burns a full run lifecycle — run row, workspace, sandbox, N null agents — instead of being refused at the door, and a stale registered default rots silently until a human reads transcripts.)

### Self-sustainability — conforming (verified)

- **Ceilings refuse, never clamp:** override validation returns typed `Err` (contract.ts:247-263), run-manager throws `paramCodedError` (run-manager.ts:399-402) — no silent alteration; `boundEffort`/`boundTimeoutMs` compute min(author, ceiling) at read time (contract.ts:90-113), so the advertised bound equals the enforced bound.
- **composeConfig wiring class closed as decreed (ARCH-066 inv 6):** `main.ts:162-164` forwards `maxTimeoutMs`/`maxAppendPromptBytes`/`maxEffort`; the three rows exist in `tests/unit/compose-config-v2-wiring.test.ts:130-142`; per-key fail-closed defaults in both consumers (`run-manager.ts:103,226-229`; `mcp-facade.ts:20`; `server.ts:1183-1187` builds ONE ceilings object passed to both).
- **Rejection leaves zero durable work:** validate (run-manager.ts:399-402) precedes `createRun` (:415) and `runWorkspace` (:416) — ARCH-066's pinned insertion point, no existing rung moved.
- **Resume closed loop:** pinned snapshot read back (`getEffectiveParams`, run-manager.ts:594-595,626), never re-resolved from the current catalog row; legacy NULL-snapshot fallback to `defaultRunParams(registered.defaults)` so in-flight pre-v21 runs survive deploy day — ADR-002/ARCH-066 inv (2).
- **`CallKey` untouched:** `run-manager.ts:774` still builds the key from raw script-literal `{prompt, opts}`; resolution happens downstream in agent-executor — zero resume-cache invalidation on deploy (ADR-002 inv 3).
- **Registration fail-closed, no partial write:** parse + A-2 cross-validation before any DB operation (workflow-catalog.ts:115-142); `ON CONFLICT … params = excluded.params` closes the stale-contract trap (:158-167); the served default is derived from one source (accept-and-normalize into `defaults`).
- **Snapshot immutability:** `runs.effectiveParams` written once at `createRun` (sqlite-run-store.ts:78-83), never updated; shared by reference into every nested frame (run-manager.ts:817).

---

## Stale-architecture doc drift (QD-5, LOW — record-keeping, not implementation deviation)

02-architecture.md was not amended after the v21 Gate 5/6 adjudications, so the Gate 2 document now misdescribes the shipped system in four places. Per the integrator note these are adjudicated design (the code is correct); the *doc* is the defect:

1. **ARCH-068 + the v21 interface table (02-architecture.md:760,961)** still promise `promptTruncated`/`appendPromptBytes` on the harness descriptor — dropped per **B-2**. Verified B-2's justification holds in code: the truncated-append state is genuinely unreachable (oversize `appendPrompt` refused at contract.ts:247-257 with byte counts; `types.ts:227-239` carries neither field).
2. **ARCH-064 note (:725)** — "bounds the author literal (byte size **+ nesting depth**)": the depth bound was dropped per **B-1** (contract.ts is flat; only `MAX_META_LITERAL_BYTES` at workflow-meta.ts:43,57 + structural caps).
3. **ARCH-065 api (:733)** — `composePrompt(systemPrompt, scriptPrompt, appendPrompt?)` is the 3-arg shape; implemented as 4-arg with the author `defaults.prompt` segment inserted (resolve.ts:131-142, agent-executor.ts:339). The 4-arg form is what DES-102/IMPL-131 record; ARCH text lags.
4. **ARCH-070 note (1) (:779)** — claims the report name "IS charset/length-validated with the same rule workflow registration already enforces": no such registration rule exists and per **A-5** none was added; only the GitHub **label** is sanitized (issue-reporter.ts:163-170). ARCH-070's stated rationale rests on a nonexistent mechanism; the shipped A-5 shape (label-scoped sanitize + untruncated body reference) is the better design and should be what the ARCH text says.

---

## Summary table

| id | dimension | severity | ARCH/decision violated | evidence anchor |
|---|---|---|---|---|
| QD-1 | observability + self-sustainability | **HIGH** | adopted S-1 decision (02-architecture.md:974); ARCH-066 typed-refusal intent | run-manager.ts:399; contract.ts:157-158 (claim) vs 217-267 (no check); gateway/client.ts:324 (opaque terminal) |
| QD-2 | replaceability | MEDIUM | ARCH-065 "ONLY effort translator"; ARCH-069 deps/api | resolve.ts:147-157 (inert) vs gateway/client.ts:24-50 (wired) |
| QD-3 | consumability | MEDIUM | ARCH-064 single-vocabulary; S-1's passthrough carve-out; REQ-038 | server.ts:1141; workflow-catalog.ts:117; contract.ts:159-165; harness-defaults.ts:70 |
| QD-4 | replaceability (boundary) | LOW | ARCH-069 declared deps completeness | gateway/client.ts:7 (new v21 value import of agent-executor) |
| QD-5 | all (trace-chain honesty) | LOW | ARCH-064/065/068/070 text vs adjudications B-1/B-2/A-5 + 4-arg composePrompt | 02-architecture.md:725,733,760,779,961 |

**consistent: no** — QD-1 is a real implementation deviation from an adopted Gate 2 decision; QD-2/QD-3 are architecture-invariant breaks in shipped code; QD-4/QD-5 are boundary/doc hygiene.
