# Gate 8 review — quality-dimensions lens (v21 slice, ARCH-064..070 / ADR-001..008, IMPL-129..140)

- **Reviewer lens:** Quality-dimensions expert (observability / replaceability / consumability / self-sustainability)
- **Scope:** v21 iteration only — the files named on IMPL-129..140's `files:` lines in `06-impl-log.md`, checked against `02-architecture.md`'s v21 slice (ARCH-064..070, ADR-001..008, the v21 4+1 views and interface table) plus the amended cross-cutting invariants (ARCH-056 redact-at-capture, ARCH-051 self-describing schemas). This is the post-IMPL-140 state (i.e. after the §4 and §R2 send-back closeouts).
- **Verdict: consistent = NO — 4 violations, all LOW.** Every load-bearing v21 invariant verified holds in code; the four findings are three architecture-doc drift items IMPL-140 explicitly declared out of its §R2 scope and left "for the next reviewer to route" (confirmed still open, re-reported here as QD-1..3), plus one new inert-at-one-rung consistency gap of the R-G3 class (QD-4).

---

## 1. Observability — transparency of internal state

**Conformant (verified against code):**

- **Per-key provenance emitted by the computing function, never inferred** (ARCH-065/ARCH-068, quality O-1 ≡ adversarial T-4): `resolveCallParams` emits `{value, rung}` in one pass (`src/params/resolve.ts:68-121`); the single decoration site `onHarness` merges `effort`/`timeoutMs`/`provenance`/`effortApplied` onto the gateway descriptor without overwriting `descriptor.model`/`provider` (`src/agent-executor.ts:409-419`). A future wiring miss surfaces as `provenance.model:'engine'` where a test expects `'default'` — exactly the ARCH-068 design intent.
- **Tri-state `effortApplied`** (ARCH-068/069): applied `{param,value}` / not-applied `{reason}` / absent-because-never-requested, computed ONCE per invoke and the SAME object travels to both the outbound request and the descriptor (`src/gateway/client.ts:46-50,327,340`; `src/gateway/claude-agent-sdk-client.ts:509,581,596`) — recorded ≡ applied by object identity, killing the false-success mode REQ-093 forbids.
- **Pre-dispatch rejection is recorded THEN thrown** (ARCH-068/DES-105): an invalid script-supplied `effort` writes a terminal-failure entry through `_sink.capture` before throwing `PARAM_OUT_OF_RANGE` (`src/agent-executor.ts:312-320`) — can never become a silent `null` via `parallel()`'s swallow.
- **Redact-before-cap ordering (R-G9) holds**: the persist site redacts first, then applies the unconditional `capPrompt` (`src/agent-executor.ts:435-439`); `redactHarness` is structural-only and passes the prompt uncut (`src/agent-executor.ts:19-36`). No partial-credential-bytes window.
- **Typed refusals throughout**: `PARAM_SECRET_UNAVAILABLE` on marker-carrying resume (`src/run-manager.ts:538-539`), `RESUME_OVERRIDES_NOT_ALLOWED` on override presence (`src/mcp-facade.ts:175-176`), `UNKNOWN_ALIAS` on the effective post-merge model (`src/run-manager.ts:424-431`) — no silent/opaque failure on any v21 path.
- *Note, not counted:* the legacy NULL-`effectiveParams` resume fallback (`src/run-manager.ts:633`) resolves from the current catalog row — the designed transitional carve-out from IMPL-133; its observable is the NULL snapshot in the store, so it is not an opaque path.

**Violation:**

### QD-1 (LOW, doc drift — declared by IMPL-140 as QD-OBS-1, confirmed still open)
- **Violates:** ARCH-068's own api line ("`appendPromptBytes` / `promptTruncated` dropped — adjudication B-2") — the v21 process view contradicts it.
- **Evidence:** `02-architecture.md:913` — the process-view sequence diagram still ends with `harness event {model, effort, effortApplied, provenance, appendPromptBytes}`. `appendPromptBytes` was dropped by adjudication B-2 and is confirmed absent from `src/types.ts:232-239` and all of `src/`. A reader auditing observability from the process view expects a field that never exists.
- **Fix shape:** one-word deletion in the mermaid line (same class as the R-G6/G7/G8 amendments; B-5/R-G8 corrected the api/note lines but the diagram was outside §R2's pinned list).

## 2. Replaceability — decoupling & pluggability

**Conformant (verified against code) — zero violations:**

- **One wired `mapEffort`, two import sites** (ARCH-069/DES-106): exported from `src/gateway/client.ts:46` and imported by `src/gateway/claude-agent-sdk-client.ts:19` — no second mapper on the run path.
- **Provider dial is config, not code** (ARCH-069, quality R-1): `EFFORT_PROFILES` table (`src/gateway/client.ts:32-34`) — a new provider with an equivalent dial is one row; a provider with no entry yields the honest `{applied:false, reason}` no-op (`client.ts:48`), degrading without failing.
- **`thinkingFor` remains the SOLE writer of `options.thinking`** (the D-F6 regression guard): the effort mapper writes a distinct wire field (`claude-agent-sdk-client.ts:507-509,532,581`) — the shipped Ollama thinking-400 defect is not re-opened.
- **ADR-006 scope fence holds**: `grep -rln session-options-builder src/` → only a comment reference in `src/params/resolve.ts`; zero value importers. The built-but-unwired module stayed on its own track.
- *Recorded debt, not counted:* `src/params/resolve.ts:147-157` carries a second, zero-production-caller `mapEffort`/`ProviderEffortProfile` pair — this is the §4 F5/QD-2 item, now recorded **in the architecture itself** (ARCH-065 api line names `src/gateway/client.ts` as the wired copy and calls the `resolve.ts` copy recorded debt), so doc and code agree; it stays a tracked cleanup for whoever next touches DES-102/DES-106.

## 3. Consumability — interface friendliness & integration cost

**Conformant (verified against code):**

- **Closed override surface at both ends** (ARCH-064 inv-2): `workflow_run.overrides` inputSchema declares exactly `{model, effort, timeoutMs, appendPrompt}` with `additionalProperties:false` (`src/server.ts:327-337`), and the parser rejects unknown keys with `PARAM_UNKNOWN` / locked keys with `PARAM_LOCKED` (`src/params/contract.ts:241-257`).
- **Self-describing errors** (ARCH-064 inv-3, D-REDACT discipline): `PARAM_OUT_OF_RANGE` carries `{param, supplied, allowed}`, `PARAM_LOCKED` carries `{param, tunable:[…]}`, oversize `appendPrompt` is reported by byte count only — the text never enters a detail object (`contract.ts:259-271`); free-text echoes truncated at 64 bytes with `suppliedTruncated:true` (`contract.ts:77-84`).
- **Read surfaces never serve null/unbounded** (ARCH-067/DES-103): `workflow_get`/`workflow_list` serve `effectiveBounds(stored ?? canonicalContract(), ceilings)` (`src/mcp-facade.ts:24-25,196,217`); the `workflow_get` description documents `params` incl. the canonical-contract fallback (`src/server.ts:421`) — advertised bound == enforced bound (A-3).
- **Uniform result envelope preserved**: `RESUME_OVERRIDES_NOT_ALLOWED` rides the standard `{runId, status, error}` envelope (`src/mcp-facade.ts:176`).
- **`issue_report`/`issue_list` symmetric `workflow` handling** (ARCH-070): label-scoped sanitize + 50-char cap (`src/github/issue-reporter.ts:169-170`), untruncated `name@version` in the body (`:204`), fingerprint extension with byte-identical absent-`workflow` output (`:158-160`).

**Violations:**

### QD-2 (LOW, doc/behavior split — declared by IMPL-140 as QD-CONS-1, confirmed still open)
- **Violates:** ARCH-051's self-describing-schema discipline as invoked by ARCH-067's note ("the `effort` no-op being repaired here was precisely a docs/behavior split, so the fix must not create a new one") and the v21 interface table (`02-architecture.md:961`), which declares `workflow_agent_log({…}).harness` gains `+effort`, `+effortApplied` (tri-state), `+timeoutMs`, `+provenance`.
- **Evidence:** `src/server.ts:372-373` — the `workflow_agent_log` tool description describes only "captured transcript events (message/tool_call/tool_result/usage)" plus the secret-marker sentence; it does not mention the served `harness` object at all, let alone the four v21 fields. An agent caller reading the tool description cannot discover the provenance observability v21's headline feature added.
- **Fix shape:** one sentence in the description (the same shape as IMPL-127's DES-088 secret-marker sentence, ideally pinned in the ARCH-051 drift-lock test).

### QD-3 (LOW, doc drift — declared by IMPL-140 as QD-CONS-2, confirmed still open)
- **Violates:** ARCH-064 internal consistency — its api line was corrected by R-G7 to name the real functions, but its note and scenario S-2 still name a phantom.
- **Evidence:** `02-architecture.md:725` ("**`parseUserOverrides`** is the ONLY constructor from caller data") and `02-architecture.md:921` (S-2: "`additionalProperties:false` + `parseUserOverrides` refuse with `PARAM_LOCKED`") — no function of that name exists; the implemented constructor is `validateUserOverrides` (`src/params/contract.ts:231`). A reader auditing ADR-001's "one total parser" claim greps for a function that isn't there.
- **Fix shape:** two-word rename in the note and scenario.

## 4. Self-sustainability — closed-loop autonomy & lifecycle

**Conformant (verified against code):**

- **ARCH-066 inv-6 (the composeConfig bug class) closed**: `composeConfig()` forwards all three ceiling keys (`src/main.ts:162-164`); ONE `ceilings` object built in `createServer` (`src/server.ts:1184-1187`) feeds BOTH `RunManager` (`:1197`) and `McpFacade` (`:1214`); per-key fail-closed defaults are present and **byte-identical across all three consumers** (600_000 / 1024 / 'high' — `server.ts:1185-1187`, `run-manager.ts:110,233-237`, `mcp-facade.ts:20`).
- **Refuse, never clamp** (ARCH-066 inv-4/ADR-005): ceilings bound the user-override rung only, via `effectiveBounds` min(author, ceiling) computed at READ time so lowering a ceiling needs no re-register (`contract.ts:104-127`); violations refuse with `PARAM_OUT_OF_RANGE` — no silent alteration path exists.
- **Run-immutable snapshot + refusal-only resume** (ARCH-066 inv-1/2, R-G1): admission rung sits between `catalog.get` and `createRun`/`runWorkspace` with zero durable work on rejection (`run-manager.ts:403-439`); resume reads the pinned snapshot and refuses marker-carrying params typed (`:528-539`); `CallKey` built from raw prompt+opts, untouched (`:812`).
- **New persist sink routed through `redact()`** (ARCH-066 inv-5/ARCH-056): snapshot redacted before the durable write, live entry keeps the unredacted copy for dispatch (`run-manager.ts:432-439,503`).
- **Fail-closed registration** (ARCH-067): `parseMetaParams` + A-2 cross-validation run before ANY DB operation, nothing stored on rejection; the `ON CONFLICT` upsert updates `params = excluded.params` so a re-register cannot leave a stale contract (`src/workflow-catalog.ts:115-170`).

**Violation:**

### QD-4 (LOW, new — the R-G3 inert-control class, one rung earlier)
- **Violates:** ARCH-064's api claim that `isKnownAlias` is "the ONE alias predicate … **shared by the registration-time and admission-time rungs**" (`02-architecture.md:724`), and the spirit of R-G3's fix rationale ("both ends now read the same table"). The *predicate* is shared; the *table* is not.
- **Evidence:** `src/server.ts:1142` hands `WorkflowCatalog` `config?.aliases ? new Set(Object.keys(config.aliases)) : undefined` (→ `new Set()` at `workflow-catalog.ts:117` → `isKnownAlias` skips every check via the empty-table rule, `contract.ts:72`), while `src/server.ts:1196` hands `RunManager` `new Set(Object.keys(config?.aliases ?? DEFAULT_ALIASES))` per R-G3. On the documented default deployment (no `config.aliases` — `main.ts` default path), registration-time model-enum validation (`contract.ts:171-179`, whose own comment says "validated against aliasNames at REGISTRATION only") and `validateHarnessDefaults`' model check are inert, while admission enforces `DEFAULT_ALIASES`. Consequence: `workflow_register` accepts a `params.knobs.model.enum` entry (or `defaults.model`) that **every** subsequent `workflow_run` of that workflow refuses with `UNKNOWN_ALIAS` at `run-manager.ts:424` — register-succeeds-every-run-fails, discovered only at run time.
- **Severity rationale:** LOW, not MED like R-G3 — the end state is a typed refusal before any durable work (R-G2's post-merge check is the backstop), so nothing is silent and nothing leaks; the defect is a late, surprising error surface plus a doc claim ("shared by both rungs") that overstates the consistency. Pre-v21 registration leniency is itself deliberate (D-AUTH-5-B), but R-G3 changed the meaning of "unconfigured" at the admission end only, leaving the two rungs disagreeing about the same deployment.
- **Fix shape:** feed `server.ts:1142` the same `config?.aliases ?? DEFAULT_ALIASES` table (one line), or amend ARCH-064's api line to state that registration deliberately skips the check on a default-alias server and why.

---

## ARCHCHECK summary

| | |
|---|---|
| lens | quality-dimensions (observability / replaceability / consumability / self-sustainability) |
| consistent | **no** |
| violations | **4** (QD-1 obs doc-drift LOW · QD-2 cons docs/behavior LOW · QD-3 cons doc-drift LOW · QD-4 self-sust alias-table divergence LOW) |
| of which pre-declared by IMPL-140 | 3 (QD-1/2/3 — left outside §R2's pinned scope "for the next reviewer to route"; routed here) |
| load-bearing invariants checked & held | ADR-001 closed type · ADR-002 CallKey/snapshot · ADR-003 five rungs · ADR-005 refuse-not-clamp · ADR-006 fence · ADR-007 frame+cap · inv-6 composeConfig wiring · R-G1 refusal-only resume · R-G2 effective-model check · R-G9 redact-before-cap · R-G10 no carve-outs |
