# Gate 8 review — Quality-dimensions lens (v21 slice, re-review round: post IMPL-142/143/144)

- **Scope:** ARCH-064..070 + ADR-001..008 (02-architecture.md:710-829, as amended through RE-REVIEW #4) vs IMPL-129..144 (06-impl-log.md v21 slice). Files read this round: the union of the v21 IMPLs' `files:` lines — src/params/{contract,resolve}.ts, workflow-catalog.ts, workflow-meta.ts, mcp-facade.ts, server.ts (v21 sections), run-manager.ts (v21 anchors), run-store.ts, store/sqlite-run-store.ts, main.ts, agent-executor.ts, types.ts, gateway/{client,claude-agent-sdk-client}.ts, github/issue-reporter.ts, harness-defaults.ts, secret-resolver.ts — plus the doc anchors of every closure IMPL-142/143 claims.
- **Reading discipline (unchanged):** the 04-design.md adjudications (A-1..A-9, B-1..B-8, C-1..C-2, #5–#8 incl. G-1/H-1..H-4) are binding design, not drift. Where shipped code follows an adjudication, the finding — if any — is the *un-amended doc*, never the code.
- **Verdict (read this sentence before routing):** **all 4 open findings are LOW; zero code-level invariants of ARCH-064..070 / ADR-001..008 are violated; 2 of 4 (R-1, S-1) are pre-declared debt with recorded rationales (R-1 on ARCH-065's own amended note, S-1 in IMPL-141/143); the other 2 are doc-layer drift with one-batch fixes.** The v21 code, including the post-round IMPL-144 fix (`997626d`), is substantively consistent with the amended architecture.

---

## Prior-round findings — verified CLOSED at their anchors this round

| Prior # | Closure claimed by | Verified at |
|---|---|---|
| O-1 (diagram `appendPromptBytes`) | IMPL-143 A8/O-1 | `02-architecture.md:914-915` (field removed, amendment comment in the mermaid) |
| O-2 (cap-site misdirection) | IMPL-143 A10/O-2 | `02-architecture.md:761` + `:977` now name `capPrompt` at the `onHarness` persist site **after** `redact()`; matches `src/agent-executor.ts:25`, `:437-439` |
| O-3 (UT-020 "6/6" miscount) | IMPL-143 O-3 | `05-tests.md:651` corrected to 5 cases, enumerated |
| C-1 (phantom `parseUserOverrides`) | IMPL-143 A9/C-1 | `02-architecture.md:725`, `:923` amended; `04-design.md:2718` normalized; code exports `validateUserOverrides` (`contract.ts:290`) |
| C-2 (DES-102 trio/seven) | IMPL-143 C-2/F-3 | `04-design.md:2574` amended to the pair/six-key truth; matches `resolve.ts:17-31` |
| R-2 (undeclared ARCH-069→068 dep) | IMPL-143 R-2 (landed in `43042d3`) | ARCH-069 `deps:` line (`02-architecture.md:768`) now names ARCH-068 |
| QD-CONS-1 (`workflow_agent_log` description) | IMPL-142 (`244f9f0`) | `server.ts:373` block documents `effort` / tri-state `effortApplied` / `timeoutMs` / `provenance` + the secret-marker sentence |

---

## (1) Observability — transparency of internal state

**Verified consistent (code, this round):**
- **IMPL-144's content-leak fix keeps the observable actionable while closing the leak** (DES-101 row 6 / ARCH-064 inv-3): the `appendPrompt` enum-branch rejection is sanitized post-hoc (`contract.ts:360-367` — `supplied`/`suppliedTruncated` deleted, `suppliedBytes` substituted), while the author's own `allowed` presets stay in the response. The alternative (stripping `enum` from `specForCheck`) would have re-opened the advertised≠enforced class — the comment at `contract.ts:351-359` records exactly that reasoning.
- **A2's O(n) truncation preserves the observability contract**: `truncatedSupplied` (`contract.ts:80-93`) still emits the 64-byte echo + `suppliedTruncated:true`, now with UTF-8 continuation-byte backoff — the rejection detail is bounded AND still self-describing.
- R-G9 ordering holds: `redact()` at `agent-executor.ts:437` then `capPrompt` at `:439`, unconditional; `redactHarness` is purely structural (`:31-59`); both `kind!=='harness'` carve-outs remain deleted (`:181`, `:459` redact unconditionally).
- One descriptor-decoration site with per-key provenance emitted by the computing function (`resolve.ts:75-128`, `agent-executor.ts:409-418`); the pre-dispatch guard records-then-throws (`:313-320`); the persisted `effortApplied` DTO stays `{param,value}|{reason}` (`types.ts:232`) — deliberately without `restPath`, matching IMPL-143's gateway-type-vs-DTO distinction.
- Resume refusal is observable and typed: `PARAM_SECRET_UNAVAILABLE` names the runId and cites ARCH-066 inv-5 (`run-manager.ts:538-539`).
- A1 half 2's poisoned-row totality is observable-safe: `boundEffort`/`boundMax` (`contract.ts:117-129`) degrade to "unconstrained" rather than crashing `workflow_get` engine-wide or propagating `NaN` (a ceiling bypass dressed as a display bug).

**Violations: none new this round.** (Prior O-1/O-2/O-3 verified closed above.)

## (2) Replaceability — decoupling & pluggability

**Verified consistent (code, this round):**
- P-A1's `restPath` lands the D-PROFILE property for real: placement travels WITH the mapping decision (`EffortProfile {param, restPath}` at `gateway/client.ts:34-43`; `effortBodyFields` nests via `reduceRight` at `:137-139`; SDK client writes flat `options[applied.param]`). A new provider dial is one config row carrying both wire shapes.
- `thinkingFor` remains the sole writer of `options.thinking` (`claude-agent-sdk-client.ts:507-509`, `:532`) — the D-F6 fence held through four re-review passes.
- ADR-006's fence held: `session-options-builder.ts` still has zero `src/` importers (only a comment reference at `resolve.ts:152`).
- One alias predicate at every rung (`isKnownAlias`, `contract.ts:71-75`): registration enum + default (`contract.ts:214-227`), override rung (`:376-383`), effective post-merge (`run-manager.ts:424-430`), all fed the same `config?.aliases ?? DEFAULT_ALIASES` table (`server.ts:1155`, `:1206`) — R-G3/P-A2 closures re-verified.

**Violations:**

| # | What | Evidence | Severity | Status |
|---|---|---|---|---|
| R-1 | The wrong `mapEffort` twin still ships: `resolve.ts:151-164` exports a `ProviderEffortProfile`/`mapEffort` pair with **no `restPath`** — any future importer re-emits top-level `effort` on the REST body, verbatim the HIGH defect P-A1 fixed. Zero production callers (grep re-run this round); exercised only by `tests/unit/params-resolve.test.ts:204-229`, which is why the doc-only pass could not delete it. ARCH-065's amended note records it as "a loaded gun in the source tree" with the standing deletion instruction | `src/params/resolve.ts:151-164` vs `src/gateway/client.ts:28-59`; ARCH-065 note (`02-architecture.md:734`) | LOW | Declared debt (A12/R-1 upgrade, recorded on ARCH-065 + DES-102). **Deletion must land with the next touch of DES-102/DES-106** together with re-pointing/retiring the 5 UT cases — re-routed unchanged |

## (3) Consumability — interface friendliness & integration cost

**Verified consistent (code, this round):**
- The shared five-code `Err` union with the three-rungs-three-codes split holds exactly as ARCH-064's amended api line states: `parseParamContract` → `PARAM_CONTRACT_INVALID` only (incl. A1's `validateSpecShape`, `contract.ts:156-170`); `validateUserOverrides` → `PARAM_LOCKED`/`PARAM_UNKNOWN`/`PARAM_OUT_OF_RANGE`/`UNKNOWN_ALIAS`; `validateDeclaredArgs` → `PARAM_OUT_OF_RANGE`.
- A4's string byte-length semantics (`contract.ts:269`) match H-3's pinned rule and the module's other byte-expressed limits; A5's third advertised ceiling: `boundMax` shared by `timeoutMs` and `appendPrompt` (`contract.ts:133-144`) — advertised == enforced by the one shared predicate.
- Read surfaces never serve null/unbounded: `readParams = effectiveBounds(stored ?? canonicalContract(), ceilings)` (`mcp-facade.ts:24-26`).
- `workflow_run.overrides` schema: closed, exactly four properties, description names locked keys, both bounding sources, and the resume exclusion (`server.ts:327-341`).
- `issue_report`/`issue_list` symmetric `workflow` filter with label-scoped sanitize per amended ARCH-070/A-5 (re-verified unchanged since prior round).
- *Non-violation observation:* the post-merge `UNKNOWN_ALIAS` detail (`run-manager.ts:429`) echoes `supplied` raw rather than via `truncatedSupplied`; the value is a registration-validated alias (bounded in practice — this rung fires only when the alias table changed after registration), so recorded as a hygiene note, not a finding.

**Violations:**

| # | What | Evidence | Severity | Status |
|---|---|---|---|---|
| C-3 | **NEW — the self-describing `workflow_register` surface advertises 5 defaults keys while the engine accepts and applies 7.** Adjudication #6 F-1 (IMPL-141) widened `HarnessDefaults` to accept `effort` and `appendPrompt` as registrable defaults (`harness-defaults.ts:39` KNOWN_KEYS + shape checks at `:77-82`; applied at the `'default'` rung by `defaultRunParams`, `resolve.ts:43-58`), but the `workflow_register` tool schema still lists only `{model, tools, skills, timeoutMs, prompt}` properties and its `defaults` description names the same 5-key set (`server.ts:395-402`) — the two v21-widened knobs are undiscoverable from the tool contract, and the description also omits the G-1 ceiling refusal on `defaults.effort`/`appendPrompt`/`defaults.timeoutMs` (`workflow-catalog.ts:160-183`). No drift-lock pins the property list (`tests/integration/schema-drift-v15.test.ts:52-64` asserts only that `defaults` exists), so nothing forced the update. This is the docs/behavior split class ARCH-067's own note forbids minting ("the `effort` no-op being repaired here was precisely a docs/behavior split, so the fix must not create a new one") under the ARCH-051 self-describing discipline; ARCH-062's "at minimum {model,tools,skills,timeoutMs,prompt}" hedge keeps the ARCH text technically true — the violation anchor is the tool schema. Same batch: DES-098's signature line still declares the 5-key `HarnessDefaults` AND the `resolveHarnessParams` deleted by TASK-104 (`04-design.md:2341`, `:2352`, `:2404` mermaid) — the "prevents schema drift" interface drifted in its own spec. Fix: extend the schema properties + description, amend DES-098, and add the property-list pin to the drift-lock | `src/server.ts:395-402` vs `src/harness-defaults.ts:39,77-82`; `src/workflow-catalog.ts:160-183`; `tests/integration/schema-drift-v15.test.ts:52-64`; `04-design.md:2341` | LOW | **New.** Not scoped out by any adjudication (swept #5–#8, A/B/C, P-A, R-G, §Q7 — `workflow_register`'s schema appears in none) |

## (4) Self-sustainability — closed-loop autonomy & lifecycle

**Verified consistent (code, this round):**
- Resume stays refusal-only with the shared marker grammar: `hasSecretMarker` exported beside `MARKER_PREFIX` (`secret-resolver.ts:95,124-126`), imported at `run-manager.ts:35` — the guard and the writer cannot drift (P-A6 closed-verified).
- Deploy-day continuity intact: legacy NULL-`effectiveParams` fallback (`run-manager.ts:633`); CallKey untouched; snapshot redacted before the durable write with the live entry unredacted (`run-manager.ts:434-439`).
- A1's totality makes the read path self-healing over a poisoned stored row (a pre-guard deployment survives; H-1's "verify no row is poisoned" escape correctly declined); A2 removes the O(n²) event-loop stall a single oversized rejection could inflict (`contract.ts:77-93`) — both are closed-loop survival properties landed as adjudicated.
- Ceilings self-apply on lowering with no re-register at read AND admission (`effectiveBounds` from live config, `contract.ts:133-144`, `:297`); ONE ceilings object threaded from `server.ts:1142` to catalog/RunManager/facade (`:1156`, `:1207`, `:1224`).
- G-1's registration ceiling pass over the FINAL `effectiveDefaults` (`workflow-catalog.ts:160-183`), origin-keyed rejection codes, delegating to the same shared predicate as read/admission.

**Violations:**

| # | What | Evidence | Severity | Status |
|---|---|---|---|---|
| S-1 | `DEFAULT_CEILINGS` hand-duplicated (`run-manager.ts:110`, `mcp-facade.ts:20` — same literal, two copies), and a `WorkflowCatalog` built without `opts.ceilings` enforces **no** registration ceiling (`workflow-catalog.ts:171` — `ceilingKnobs` undefined → every knob `continue`s) while `RunManager` applies its own defaults: the two-tables-one-predicate shape one level up from P-A2. No shipped deployment splits (server.ts always passes the shared object), but the closed-loop property depends on every future composition site remembering to | `src/run-manager.ts:110`, `src/mcp-facade.ts:20`, `src/workflow-catalog.ts:74,171` | LOW | Declared residual (IMPL-141, re-affirmed IMPL-143 "S-1 stays recorded debt" with its third-copy/IT-083 rationale) — re-routed unchanged |
| S-2 | **NEW — ADR-005 and ARCH-066 inv-4 were never amended for G-1 and are now false as written.** ADR-005 states ceilings are "applied to **caller-supplied override values only**" and "ceilings deliberately do NOT apply to author-side values (registered defaults / script per-call opts)" (`02-architecture.md:809`); ARCH-066 inv-4 says "engine ceilings bound the USER override rung only" (`:743`). The binding adjudicated G-1 fix (#6/#7, IMPL-141) applies the engine ceilings to **registered defaults at registration time**: a caller-supplied `defaults.effort` above `maxEffort` (or over-byte `appendPrompt`, over-`maxTimeoutMs` timeout) is refused with `HARNESS_DEFAULTS_INVALID`/`PARAM_CONTRACT_INVALID` (`workflow-catalog.ts:160-183`). The code is right (adjudication outranks the earlier prose; REQ-091 compat is preserved because enforcement is at registration of NEW rows, not admission of existing ones) — the violation is the un-amended rationale: an architect reading ADR-005 today concludes author defaults are ceiling-exempt and would re-open G-1's hole on the next composition site. Same doc↔code class as A3/A10; fix is a one-paragraph amendment to ADR-005 + inv-4 recording the registration-time half. *Attached observation (consistent with ADR-005 as written, not a separate finding):* a ceiling **lowered after** registration does not re-bound already-stored defaults at admission — a stored `defaults.effort:'high'` dispatches under `maxEffort:'low'`; only user overrides and new registrations feel the lowered ceiling. If that asymmetry is intended, the same amendment should say so | `02-architecture.md:809` (ADR-005), `:743` (ARCH-066 inv-4) vs `src/workflow-catalog.ts:160-183`; IMPL-141 G-1 | LOW | **New** — doc amendment, routed with the C-3 batch |

---

## Tally

- **Violations (still-open + new): 4** — R-1 (carried, declared), S-1 (carried, declared), C-3 (new), S-2 (new). All LOW.
- **Zero code-level invariants of ARCH-064..070 / ADR-001..008 violated** — every load-bearing anchor (redact→cap ordering, refusal-only resume, closed `UserOverrides`, run-immutable snapshot, CallKey fence, one alias table, one bounds predicate, advertised==enforced ceilings, `thinking` sole-writer, builder fence, pre-eval meta bound in `workflow-meta.ts:40-64`) re-verified at HEAD, including the post-Gate-7.5-round-2 commit `997626d` (IMPL-144), whose sanitize preserves both DES-101 row 6 and the no-un-enforced-constraint rule.
- **All 7 prior-round findings routed to IMPL-142/143 verified closed at their anchors** (table above) — the doc batch was real, not claimed.
- **Recommended routing:** C-3 + S-2 are one small amendment batch (server.ts TOOL_DEFS `workflow_register.defaults` schema/description + drift-lock pin; DES-098 signature; ADR-005/ARCH-066-inv-4 paragraph). R-1 and S-1 stay tracked debt with their recorded rationales — no action this round beyond carrying them visibly.
