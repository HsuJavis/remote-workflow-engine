# Gate 8 review — Quality-dimensions lens (v21 slice)

- **Scope:** ARCH-064..070 + ADR-001..008 (02-architecture.md:710-980) vs IMPL-129..141 (06-impl-log.md v21 slice). Files read: the union of the v21 IMPLs' `files:` lines (src/params/{contract,resolve}.ts, workflow-catalog.ts, workflow-meta.ts, mcp-facade.ts, server.ts, run-manager.ts, run-store.ts, store/sqlite-run-store.ts, main.ts, agent-executor.ts, types.ts, gateway/{client,claude-agent-sdk-client}.ts, github/issue-reporter.ts, harness-defaults.ts) plus the module-boundary references they import.
- **Reading discipline:** the integrator note in 06-impl-log.md binds the 04-design.md adjudications (A-1..A-9, B-1..B-8, C-1..C-2) as design, not drift — adjudicated departures (B-1 depth bound dropped, B-2 descriptor fields dropped, B-3 `RunParams.skills` removed, A-6 2-arg `thinkingFor`) are **not** reported as violations here. Findings already closed by IMPL-139/140/141 (B1..B5, R-G1..R-G10, F-1/F-2, G-1/G-2, P-A6) were spot-verified at their code anchors and are **not** re-reported; where a closeout claim was checked it is listed under "verified consistent".
- **Verdict:** the v21 *code* is substantively consistent with the (amended) architecture — every load-bearing invariant checked at its anchor holds. All 8 open violations are doc-layer drift or declared residuals, LOW severity; 7 of the 8 were declared and routed by IMPL-140/141 ("left for the next reviewer to route") and are hereby routed as findings, 1 is new.

---

## (1) Observability — transparency of internal state

**Verified consistent (code):**
- Per-key provenance is emitted by the function that computes each value, one pass, never inferred by value comparison (ARCH-065/068; `src/params/resolve.ts:75-128`) — the anti-wiring-miss observable works as designed.
- ONE descriptor-decoration site: `agent-executor.ts:409-418` merges `effort`/`timeoutMs`/`provenance`/`effortApplied` onto the gateway descriptor without overwriting `descriptor.model`/`provider`; recorded ≡ applied by object identity (`gateway/client.ts:338→351`, `claude-agent-sdk-client.ts:509→596`).
- Pre-dispatch guard **records then throws** (ARCH-068): `agent-executor.ts:312-321` writes a terminal-failure capture before `codedError('PARAM_OUT_OF_RANGE')` — no silent null via `parallel()`'s swallow.
- R-G9 ordering holds in code: `redact()` at `agent-executor.ts:437` then `capPrompt` at `:439`; `redactHarness` (`:36`) passes the prompt uncut; R-G10's `kind !== 'harness'` carve-outs are gone (`:181`, `:459` redact unconditionally).
- `effortApplied` is tri-state in `types.ts:228-239`; live `markHarness` surfaces model/provider before the first token (`agent-executor.ts:425`).

**Violations:**

| # | What | Evidence | Severity | Status |
|---|---|---|---|---|
| O-1 | ARCH-068/B-2 contradicted by the arch doc's own process view: the v21 sequence diagram still emits `appendPromptBytes` in the harness event, a field adjudication B-2 dropped and `types.ts` does not carry | `02-architecture.md:913` vs `:760` (api line), `:961` (interface table), `src/types.ts:227-239` | LOW | Declared (QD-OBS-1, routed by IMPL-140 "not done") — still open |
| O-2 | ARCH-068's note still states `PROMPT_CAP=4096` "lives in `redactHarness` (`agent-executor.ts:23`)" and the v21 decision rationale still says the truncation residual is "handled by `promptTruncated` + `appendPromptBytes` + a small cap" — both false after R-G9 relocated the cap to `capPrompt` applied *after* `redact()` at the persist site and B-2 dropped both fields. An auditor following ARCH-068 to verify the security-relevant redact→cap ordering is pointed at the wrong site | `02-architecture.md:761`, `:975` vs `src/agent-executor.ts:25` (capPrompt), `:437-439` (redact-then-cap) | LOW | Declared (IMPL-141 F-4 "three remaining 02-architecture.md amendments", routed) — still open |
| O-3 | Evidence-chain observability: 05-tests.md's UT-020 re-run note claims "6/6 pass"; the file holds 5 cases (re-run this review: 5/5). A green count that cannot be reproduced weakens the audit trail the harness-descriptor observability rests on | `.sdlc/…/05-tests.md:651` vs `tests/unit/claude-agent-sdk-gateway-thinking.test.ts` (5 `it(` cases; vitest 5/5) | LOW | Declared (IMPL-141 F-4 doc batch, routed) — still open |

## (2) Replaceability — decoupling & pluggability

**Verified consistent (code):**
- One wired effort mapper: `EFFORT_PROFILES`/`profileFor`/`mapEffort` in `gateway/client.ts:41-55`, imported by `claude-agent-sdk-client.ts:19` — a new provider dial is a config row (ARCH-069, D-PROFILE lineage).
- `thinkingFor` remains the **sole** writer of `options.thinking` (`claude-agent-sdk-client.ts:325`, `:532`; the mapper writes a different wire field, `:506-509`) — the D-F6 regression fence held.
- ADR-006's fence held: `session-options-builder.ts` has zero `src/` importers (grep-verified), pinned structurally by the UT-101 addendum test.
- Effort rides the wire on BOTH LiteLLM branches via `effortBodyFields` (`gateway/client.ts:167`, `:304`) and on the SDK `Options` object — ARCH-069's "visible on the wire" clause.

**Violations:**

| # | What | Evidence | Severity | Status |
|---|---|---|---|---|
| R-1 | Two `mapEffort` implementations ship: `src/params/resolve.ts:151-164` exports a richer `ProviderEffortProfile`/`mapEffort` pair with **zero production callers** (grep: only run-manager/stores/agent-executor import resolve.js, none import its mapper); the wired one is `gateway/client.ts:55`. A future provider added to one table but not the other is exactly the advertised-vs-enforced drift class v21 repairs. Amended ARCH-065 records this as F5/QD-2 debt but both copies still ship | `src/params/resolve.ts:151-164` vs `src/gateway/client.ts:41-55`; ARCH-065 api line (`02-architecture.md:731`) | LOW | Declared (F5/QD-2, recorded in amended ARCH-065 + IMPL-138 observation) — still open |
| R-2 | **NEW.** Undeclared, direction-inverting module dependency ARCH-069 → ARCH-068/004: both gateway impls **value-import** `redactHarness` from the executor module (`gateway/client.ts:7` — added in v21 by adjudication A-4's swap; `claude-agent-sdk-client.ts:16` pre-existing). ARCH-069's `deps:` names only ARCH-065, ARCH-005; the container diagram's dependency direction is K4→K5, not K5→K4. The Gate 6.5+7 `solid_check` declaration-completeness fix covered only the opposite direction (run-manager/agent-executor → gateway). Replaceability cost: a third `GatewayClient` implementation must import a record-shaping transform from the executor module | `src/gateway/client.ts:7`, `src/gateway/claude-agent-sdk-client.ts:16` vs ARCH-069 `deps:` (`02-architecture.md:768`) and the diagram | LOW | New — same declaration-completeness class as the solid_check fix; either declare the dep on ARCH-069 or move `redactHarness`/`capPrompt` to a neutral module |

## (3) Consumability — interface friendliness & integration cost

**Verified consistent (code):**
- `workflow_run.overrides` inputSchema: `additionalProperties:false`, exactly the four tunable properties, each self-describing incl. its bounding ceiling; description names the locked keys and the resume exclusion (`src/server.ts:328-341`) — ARCH-064 inv (2) allowlist-at-both-ends holds.
- Three-rungs-three-codes discipline holds in code: registration → `PARAM_CONTRACT_INVALID` only (`contract.ts:129-131`); alias-table → `UNKNOWN_ALIAS` at both override rung (`contract.ts:295-302`) and effective post-merge rung (`run-manager.ts:424-430`); author-enum → `PARAM_OUT_OF_RANGE`. Errors are self-repairing: `{param, supplied(+truncation), allowed}` / `{param, tunable[]}`; `appendPrompt` reported by size, never content (`contract.ts:270-282`).
- Read surfaces never serve null/unbounded: `readParams = effectiveBounds(stored ?? canonicalContract(), ceilings)` (`mcp-facade.ts:24-25`); advertised bound == enforced bound by the shared `checkValueAgainstSpec` predicate.
- `workflow_agent_log`'s tool description documents all four v21 harness fields + the secret-marker sentence (`server.ts:373` block) — the F-4 doc-batch item for this surface is **closed** in current state (QD-CONS-1 no longer reproduces).
- `issue_report`/`issue_list` symmetric `workflow` filter, label-scoped sanitize + 50-char cap, untruncated `name@version` in body, fingerprint extension (`github/issue-reporter.ts:158-170`, `:416`, `:438`) — ARCH-070/A-5 as amended.

**Violations:**

| # | What | Evidence | Severity | Status |
|---|---|---|---|---|
| C-1 | ARCH-064's load-bearing invariant (1) and scenario S-2 name a phantom function `parseUserOverrides` as "the ONLY constructor from caller data"; the module exports `validateUserOverrides` (no `parseUserOverrides` exists anywhere in src/). A consumer of the architecture doc greps for a function that does not exist — the exact docs/behavior split class v21 repaired for `effort` | `02-architecture.md:725`, `:921` vs `src/params/contract.ts:242` | LOW | Declared (QD-CONS-2 / IMPL-141 F-4 "ARCH-064 rename", routed) — still open |
| C-2 | DES-102 still specifies `RunParams` carrying the "author-only trio (prompt/tools/**skills**)" and `mergeRunParams` folding "all **seven** registered keys"; the shipped shape omits `skills` per binding adjudication B-3 (six keys; `resolve.ts:22-27` records the claim). The design doc specifies a snapshot the code deliberately does not build | `.sdlc/…/04-design.md:2559`, `:2574` vs `src/params/resolve.ts:17-31`; drift self-acknowledged at `04-design.md:3085-3088` (F-3) yet prose unfixed | LOW | Declared (IMPL-141 F-3, routed) — still open |

## (4) Self-sustainability — closed-loop autonomy & lifecycle

**Verified consistent (code):**
- Resume is refusal-only (R-G1 end state): `hasSecretMarker(entry.effectiveParams)` → typed `PARAM_SECRET_UNAVAILABLE` (`run-manager.ts:538-539`); `unredactBestEffort` deleted (grep: 0 code hits, 1 historical comment); marker grammar is NOT duplicated — `hasSecretMarker` is exported by `secret-resolver.ts:124` and imported (`run-manager.ts:35`), so P-A6 is closed.
- Deploy-day continuity: legacy NULL-`effectiveParams` fallback to `defaultRunParams(registered.defaults)` (`run-manager.ts:633`) — in-flight suspended runs survive the upgrade; ADR-002's CallKey fence held (resolution downstream of key construction).
- The composeConfig bug class (5th would-be instance) is closed: `main.ts:162-164` forwards all three ceiling keys; UT-033 carries the three rows (`compose-config-v2-wiring.test.ts:130-140`); per-consumer fail-closed defaults exist.
- ONE ceilings object at the production composition root threaded to all three consumers: `server.ts:1142` → catalog `:1156`, RunManager `:1207`, facade `:1224`; R-G3's two-tables split is closed (`:1155` and `:1206` both read `DEFAULT_ALIASES`).
- Lowering a ceiling self-applies with no re-register: `effectiveBounds` computed at read AND admission from live config (`contract.ts:115-127`, `:249`); G-1's ceiling pass over the FINAL `effectiveDefaults` landed (`workflow-catalog.ts:54-59` ceilings opt + the `effectiveDefaults` loop at `:139-148`).

**Violations:**

| # | What | Evidence | Severity | Status |
|---|---|---|---|---|
| S-1 | `DEFAULT_CEILINGS` is hand-duplicated in two consumers (`run-manager.ts:110`, `mcp-facade.ts:20` — same literal, two copies), and a `WorkflowCatalog` constructed without `opts.ceilings` enforces **no** registration ceiling at all while `RunManager` applies its own defaults — the P-A2 two-tables-one-predicate shape one level up. No shipped deployment splits (server.ts always passes the shared object), but the closed-loop property depends on every future composition site remembering to; a drifted default edit in one copy silently splits advertised vs enforced bounds | `src/run-manager.ts:110`, `src/mcp-facade.ts:20`, `src/workflow-catalog.ts:59,74`; residual recorded in IMPL-141 | LOW | Declared residual (IMPL-141, with its rationale for not fixing now) — still open |

---

## Tally

- **Violations (still-open + new): 8** — O-1, O-2, O-3, R-1, R-2, C-1, C-2, S-1. All LOW; 7 declared-and-routed by the v21 closeouts, 1 new (R-2).
- **No code-level invariant of ARCH-064..070 / ADR-001..008 was found violated.** The open set is architecture/design/test-doc text lagging adjudicated code (the living-documents discipline's own defect class) plus two declared duplication residuals.
- **Recommended routing:** O-1/O-2/C-1 + O-3 are one small 02-architecture.md/05-tests.md amendment batch (already named by IMPL-141 F-4); C-2 is the F-3 one-paragraph DES-102 fix; R-1/S-1 stay tracked debt with their recorded rationales; R-2 needs either a one-line `deps:` amendment on ARCH-069 or a relocation decision for `redactHarness`/`capPrompt`.
