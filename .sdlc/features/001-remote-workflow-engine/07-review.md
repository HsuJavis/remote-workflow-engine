---
stage: review
status: draft
---
# 07 Review & Retro — Gate 8

> **Gate 8 closing-fixes update (IMPL-051, 2026-07-03):** the 4 HIGH architecture-consistency
> findings below (V3, O-1, C-1, S-1) plus 2 of the 9 MEDIUM findings (V2, V5) are now FIXED per the
> binding decisions D-G8-1..6 — see `06-impl-log.md` IMPL-051 and the `04-design.md` D-G8-* route-back
> notes for exactly what changed and why. The remaining MEDIUM/LOW findings (V1 auth no-op seam, O-2
> transition audit trail, R-1 duplicated `DEFAULT_ALIASES`, R-2, R-3, C-2, S-2, V4, C-3) are formally
> RECORDED below as a **v1.1 backlog** — a binding decision NOT to fix them this round, not an
> oversight. The narrative below (violations list, retro, report) is preserved UNCHANGED as the
> as-found record from the original Gate 8 review pass; do not edit it to retroactively mark items
> fixed — the "Gate 8 closing-fixes update" callouts (this one, and inline ones below) carry the
> current status instead.

> **GATE 8 CLOSING RE-REVIEW (2026-07-03 22:05, this pass — `gates.review.passed` now flips to
> `true`):** independently re-verified all 6 D-G8-1..6 fixes directly against the current source tree
> (not just trusted `06-impl-log.md`'s own narrative), their forcing tests, and the Gate 7.5 round-7
> spot re-validation evidence in `08-validation.md`. All 6 CONFIRMED RESOLVED:
> | # | Decision | Finding fixed | Code evidence | Test evidence | Real-process evidence |
> |---|---|---|---|---|---|
> | 1 | D-G8-1 | V3 (HIGH) — nested `workflow()` callSeq collision | `src/run-manager.ts:272` `RunManager._nestedCallSeq(parentCallSeq, nestedCallSeq)`, called at `src/run-manager.ts:311` | `tests/integration/nested-workflow-callseq-resume.test.ts` green | 08-validation.md round 7: regression-suite + source-confirmed call site (not independently re-booted this round, per its own scoping) |
> | 2 | D-G8-2 | O-1 (HIGH) — transcript black-box | `src/gateway/claude-agent-sdk-client.ts:91` `extractEvents()`, forwarded at `:200`; `AgentTranscriptSink.capture()` emits `result.events` before the terminal usage event | `IT-026/IT-027` green | 08-validation.md round 7: real Ollama `agent('...PONG')` — `workflow_agent_log` returned a real ordered `message` event followed by the terminal `usage` event |
> | 3 | D-G8-3 | C-1 (HIGH) — placeholder `tools/list` | `src/server.ts:91` `TOOL_METADATA` (real description + real `inputSchema.properties`/`required` per tool), served at `:238` | `IT-028` — 3 of 4 sub-cases green, 1 sub-case a confirmed test defect (see below) | 08-validation.md round 7: real HTTP `tools/list` returned real descriptions/schemas for all 10 tools |
> | 4 | D-G8-4 | S-1 (HIGH) — no default `timeoutMs` on zero-config default gateway path | `src/main.ts:98` `timeoutMs: fileConfig.timeoutMs ?? 15000`, resolved value forwarded at `:122` (fixes the 2nd bug found while verifying: the SDK client ctor was reading the raw `fileConfig.timeoutMs`, not the resolved one) | `IT-029` green | 08-validation.md round 7: booted with NO config file, real unresponsive TCP peer — `agent()` resolved `result:null`, run `completed` in 5.2s, never hung; direct composition-root probe confirmed resolved `timeoutMs=15000` and a 15014ms-bounded forced-hang |
> | 5 | D-G8-5 | V5 (MEDIUM) — full `process.env` forwarded to spawned CLI | `src/gateway/claude-agent-sdk-client.ts:71` `ENV_ALLOWLIST`, `:76` `buildSubprocessEnv()`, applied at `:167` | `tests/unit/claude-agent-sdk-gateway-env-allowlist.test.ts` green | 08-validation.md round 7: regression-suite + source-confirmed call site |
> | 6 | D-G8-6 | V2 (MEDIUM) — stale pre-dispatch budget check under `parallel()` | `src/run-guard.ts:79` `reserve()`/`:88` `releaseReserved()`, called atomically (no `await` between) at `src/run-manager.ts:338`/`:378` | `tests/integration/parallel-budget-concurrency.test.ts` green | 08-validation.md round 7: regression-suite + source-confirmed call site |
>
> Full suite re-run fresh this pass: `npx vitest run` = 69 files/217 tests, 214 pass/3 fail — all 3
> fails are pre-existing, individually root-caused, documented `test_defect`s, re-confirmed here, none
> a product regression from D-G8-1..6:
> - `IT-015` (`tests/integration/claude-agent-sdk-session.test.ts`) — pre-existing, environment-specific
>   (this sandbox is itself a nested Claude Code host that intercepts `query()`), unrelated to this
>   round, unchanged since round 4.
> - `IT-024` (`tests/integration/in-flight-agent-state.test.ts`) — the documented ~1-in-6 real-
>   subprocess IPC-delivery race; re-confirmed the exact flake pattern this pass (failed on 2
>   consecutive standalone runs, then passed on the next 3 consecutive standalone runs) — matches
>   `vitest.config.ts`'s own documented/accepted flake class for real-child-process integration tests,
>   not a regression.
> - `IT-028` (`tests/integration/mcp-tools-list-schema.test.ts`) — 3 of 4 sub-cases green; the 4th
>   sub-case ("every tool has non-empty `inputSchema.properties`") wrongly applies to `workflow_list`,
>   which `04-design.md:45`'s own signature (`workflow_list(a?: {})`) documents as genuinely zero-
>   parameter — it correctly has real, honest, empty `properties:{}`, not a placeholder. This is the
>   SAME test defect the Gate-6 implementer flagged in IMPL-051's own narrative and Gate 7.5 round 7
>   independently re-confirmed; re-confirmed a third time here. Not a product defect, not fudged.
>
> `sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check`: 187 items, 18 gaps — identical
> pre-existing v2/v3-out-of-scope baseline (`REQ-008..012/015`, `TASK-018..023`), 0 orphan/broken-link,
> 0 new gaps. **Doc↔code iteration drift: none** — `04-design.md` DES-001/002/004/008/009 each carry a
> D-G8-* route-back note matching IMPL-051 in the same round; `README.md`/`DEPLOY.md` were rewritten in
> the same round (Gate 7.5 round 7) that produced the real-process evidence confirming these fixes.
> **Remaining architecture-consistency violations after this closing round: 0 HIGH** (all 4 fixed and
> re-confirmed); **7 MEDIUM/LOW remain**, all correctly recorded in the "v1.1 backlog" section below per
> the binding user decision to defer them, not silently dropped. **Exit-gate criteria 1-4 (see gate
> contract) are now all satisfied — this iteration can close.**

## Consistency conclusion

### Traceability (`trace.py --check`, regenerated 2026-07-03)
- Total work items: **180**
- Requirements: 15 (v1 slice: REQ-001..007,013,014; v2: REQ-008..011; v3: REQ-012,015)
- Gaps: **high=0, mid=12, low=6** (18 total)
  - **mid (12)** = REQ-008/009/010/011/012/015 each with 2 gaps (未實作 + 未驗證) — all **v2/v3, explicitly out of v1 scope** per `state.yaml notes` and every Gate's own note since Gate 3.
  - **low (6)** = TASK-018..023, the coarse v2/v3 placeholder tasks with no v1 implementation — same out-of-scope set.
  - **high = 0**: 0 broken links, 0 orphans, 0 mock-only (`僅 mock 驗證` card = 0), 0 v1-REQ 未驗證/未真實驗證. This matches the identical baseline every round from Gate 5 through Gate 7.5 round 6 independently reconfirmed (18 gaps, same IDs, 0 new).
  - **All 18 remaining gaps are recorded here as known, accepted, out-of-v1-scope tech debt** (v2/v3 slice deferred by the requirements Gate itself), not accidental drift. Exit-gate criterion 1 satisfied.
- Doc↔code iteration drift: **none found.** Every DES-* item in `04-design.md`, every IMPL-* item in `06-impl-log.md`, and every v1 REQ carry `iter: v1` consistently; no DES/UT left at a stale iter while its IMPL moved on. `state.yaml`'s dense route-back history (rounds D-R1..D-R5, D-F1..D-F13, D-V1..D-V7) shows each round's design/doc updates (04-design.md route-back notes, README.md/DEPLOY.md rewrites) were applied in the SAME round as the corresponding IMPL change, not deferred. Exit-gate criterion 2 satisfied.

### Architecture consistency (vs Gate 2 `02-architecture.md`)
Consolidated from the 2 pre-run expert reports at `.sdlc/features/001-remote-workflow-engine/.panel/review/` (not re-spawned, per instruction):
- `adversarial.md` — security / scalability-consistency / testability (opus)
- `quality-dimensions.md` — observability / replaceability / consumability / self-sustainability (sonnet)

**Verdict: NOT fully consistent.** 15 violations found across the two reports (0 counted as violations for the 1 advisory-only note). None of these were caught by Gate 7.5's REQ-acceptance-clause validation because they are architecture-invariant-level findings (module-boundary/seam/observability promises in `02-architecture.md`'s rationale text), not REQ-acceptance-clause-level findings — this is exactly the class of drift Gate 8's architecture-consistency check exists to catch that Gate 7.5 structurally cannot.

**HIGH severity (4)** — directly contradict explicit `02-architecture.md` rationale text, not just under-building a nice-to-have:
1. **V3 (adversarial)** — nested `workflow()` reuses the parent `runId`'s journal but the nested child process's own `callSeq` counter restarts at 0 (`src/sandbox/child-entry.ts:29`), so colliding `callSeq` values corrupt `ResumeCache`'s longest-unchanged-prefix matching (`src/run-manager.ts:309-311`) — violates ARCH-002 (serialized journal-append ordering) and ARCH-006, breaks REQ-006 resume determinism for any nested-workflow run. `src/run-manager.ts:294`, `src/sandbox/child-entry.ts:29,81`.
2. **O-1 (quality-dims)** — `AgentTranscriptSink` never captures `message`/`tool_call`/`tool_result` events, only a terminal `usage` summary; `ClaudeAgentSdkGatewayClient._drain` explicitly discards every SDK message except the final `result` (`src/gateway/claude-agent-sdk-client.ts:158-172`, `if (msg.type !== 'result') continue`). Violates ARCH-004's own "one capture path taps the SDK message/event stream" rationale — `workflow_agent_log` can never show a real reasoning/tool-call trace, only one line per call.
3. **C-1 (quality-dims)** — `tools/list` serves placeholder metadata for all 10 tools (`description: name`, `inputSchema: {type:'object'}`, no properties/required) — `src/server.ts:147-149`. Violates ARCH-001's "uniform result envelope so callers branch identically" consumability rationale; a caller cannot learn any tool's real parameter contract from the served schema.
4. **S-1 (quality-dims)** — the new *default* production gateway path (`ClaudeAgentSdkGatewayClient`, selected by `src/main.ts composeConfig()` whenever no config file exists — the exact zero-config "just run it" deployment `main.ts` was built to support) has **no hardcoded `timeoutMs` fallback** (contrast `bind`/`port`, which do have real defaults). Violates decision D-G, explicitly **user-reconfirmed on 2026-07-03** ("keep the minimal breaker in v1... so a dead/hung provider cannot hang a whole run"). A dead local Ollama hangs `agent()` — and the whole run, since the concurrency slot stays held — indefinitely with zero automatic recovery, in the exact zero-config scenario the entrypoint exists for. **This is a genuine new finding this validation rounds did not test** (every Gate 7.5 round used an explicit config file with `timeoutMs` set), not previously flagged.

**MEDIUM / MEDIUM-HIGH (9)**:
5. V1 (adversarial, MEDIUM) — the ARCH-009 auth-middleware no-op seam (promised "zero v1 rework" extension point for v3 OIDC) does not exist in `src/server.ts:133-166`; the transport→facade path has no wrapper/hook point.
6. V2 (adversarial, MEDIUM) — `RunGuard.assertBudget()` is a stale pre-dispatch check (tokens added only post-invoke in `capture()`); under `parallel()`, all N concurrent calls can pass the gate before any spend is recorded, allowing large budget overshoot. `src/run-manager.ts:314`, `src/agent-executor.ts:103,192`.
7. V5 (adversarial, LOW-MEDIUM) — `ClaudeAgentSdkGatewayClient` forwards the **entire** `process.env` (`env: {...process.env, ...}`) to the spawned CLI subprocess, contradicting the file's own D-R2 "never forwards a real host credential" comment — only `ANTHROPIC_API_KEY` is actually overridden. `src/gateway/claude-agent-sdk-client.ts:129-133`.
8. O-2 (quality-dims, MEDIUM-HIGH) — both `RunStore` implementations drop `recordTransition`'s `from`/`ts` params (`src/run-store.ts:116-120`, `src/store/sqlite-run-store.ts:114-116`) — no transition-history/audit trail exists despite ARCH-006's "one writer of every state transition (timestamp + runId)" promise.
9. R-1 (quality-dims, MEDIUM) — 3 independently-maintained `DEFAULT_ALIASES` tables have drifted (`src/run-manager.ts:26-31`/`src/main.ts:39-44` vs `src/submission-validator.ts:12-17` use different model-id strings for the same alias names) — the fail-fast validator (ARCH-008) validates against a table the gateway doesn't actually route with.
10. R-2 (quality-dims, MEDIUM) — the two `GatewayClient` impls silently diverge on secret custody (same root cause as V5 above), breaking ARCH-005's "swap without side effects" replaceability promise.
11. R-3 (quality-dims, MEDIUM) — `workflow_artifacts` bypasses the `RunStore` port and calls `readdirSync` directly on the workspace path (`src/mcp-facade.ts:149-163`) — violates ARCH-001's "no direct persistence (reads via ARCH-006)".
12. C-2 (quality-dims, MEDIUM-HIGH) — the sandbox IPC boundary collapses every `agent()`/`workflow()` error into one of 2 generic codes (`AGENT_ERROR`/`NESTING_ERROR`), discarding the real error identity (`BudgetExceededError`, `CatalogNotFoundError`, etc.) — `src/sandbox/host.ts:74-104`.
13. S-2 (quality-dims, MEDIUM) — `LiteLLMProxyManager` has no post-start liveness/restart supervision; a mid-run subprocess crash is permanent for the server process's life. `src/gateway/litellm-proxy.ts`.

**LOW (2)**:
14. V4 (adversarial, LOW) — determinism guards (`Date.now`/`Math.random`) are advisory only, bypassable via the VM's host-realm `Function` constructor escape — correctly judged LOW since the threat model is non-adversarial Claude-generated scripts, but ARCH-003's text should stop implying the guard is enforced.
15. C-3 (quality-dims, LOW-MEDIUM) — `workflow_status`'s response envelope spreads extra top-level fields (`phases`/`agents`/`scriptVersion`) not present on the other 9 tools' uniform envelope.

**Advisory, not counted as a violation**: gateway path proliferation (3 near-identical abort/timeout/retry races across `LiteLLMGatewayClient` direct-fetch, its LiteLLM-proxy path, and `ClaudeAgentSdkGatewayClient`) — legitimately driven by explicit user decisions D1/route-backs, flagged only for future consolidation.

> **Gate 8 closing-fixes status (IMPL-051):** items 1-4 (all HIGH) FIXED via D-G8-1 (nested `callSeq`
> namespacing), D-G8-2 (transcript event forwarding), D-G8-3 (real `tools/list` schemas), D-G8-4
> (hardcoded `timeoutMs` fallback). Item 6 (V2) FIXED via D-G8-6 (`RunGuard.reserve()`/
> `releaseReserved()` atomic budget gate). Item 7 (V5) FIXED via D-G8-5 (`ENV_ALLOWLIST` on the spawned
> CLI subprocess). Items 5, 8-15 (V1, O-2, R-1, R-2, R-3, C-2, S-2, V4, C-3) are DEFERRED — see the
> "v1.1 backlog" section below for the binding decision recording each as known, accepted tech debt
> for this round, not silently dropped.

## v1.1 backlog (Gate 8 MEDIUM/LOW findings, deferred per binding decision — recorded, not fixed this round)

The following review findings are **binding-decision-deferred**, not overlooked. Each remains a real,
confirmed architecture-consistency gap; none blocks this round's Gate 8 exit (only the 4 HIGH items
were required to be fixed this round, per the binding instruction that dispatched this closing-fixes
pass).

| # | ID | Severity | Finding | Evidence |
|---|----|----------|---------|----------|
| 1 | V1 | MEDIUM | ARCH-009's promised "zero v1 rework" auth-middleware no-op seam does not exist — the transport→facade path (`src/server.ts`) has no wrapper/hook point at all. A v3 OIDC resource-server swap will require touching `server.ts` itself, not just plugging in a new middleware. | `src/server.ts:133-166` |
| 2 | O-2 | MEDIUM-HIGH | Both `RunStore` implementations drop `recordTransition`'s `from`/`ts` params — no transition-history/audit trail exists despite ARCH-006's "one writer of every state transition (timestamp + runId)" promise. Every transition is overwritten in place; there is no way to reconstruct a run's full lifecycle history after the fact. | `src/run-store.ts:116-120`, `src/store/sqlite-run-store.ts:114-116` |
| 3 | R-1 | MEDIUM | 3 independently-maintained `DEFAULT_ALIASES` tables (`run-manager.ts`, `main.ts`, `submission-validator.ts`) have drifted to different model-id strings for the same alias names — the fail-fast validator (ARCH-008) can validate against a table the gateway doesn't actually route with. A single shared exported constant would remove the drift risk entirely. | `src/run-manager.ts:26-31`, `src/main.ts:39-44`, `src/submission-validator.ts:12-17` |
| 4 | R-2 | MEDIUM | The two `GatewayClient` implementations diverge on secret custody conventions (same root cause class as V5, though D-G8-5 only fixed `ClaudeAgentSdkGatewayClient`'s specific env-forwarding instance of it) — breaks ARCH-005's "swap without side effects" replaceability promise; a caller cannot assume both impls handle credentials identically. | `src/gateway/client.ts`, `src/gateway/claude-agent-sdk-client.ts` |
| 5 | R-3 | MEDIUM | `workflow_artifacts` bypasses the `RunStore` port entirely and calls `readdirSync` directly on the workspace path — violates ARCH-001's "no direct persistence (reads via ARCH-006)" boundary rule. | `src/mcp-facade.ts:149-163` |
| 6 | C-2 | MEDIUM-HIGH | The sandbox IPC boundary collapses every `agent()`/`workflow()` error into one of 2 generic codes (`AGENT_ERROR`/`NESTING_ERROR`), discarding the real error identity (`BudgetExceededError`, `CatalogNotFoundError`, etc.) — a script's own `catch(e){ e.code }` handling can't distinguish error causes it otherwise could. | `src/sandbox/host.ts:74-104` |
| 7 | S-2 | MEDIUM | `LiteLLMProxyManager` has no post-start liveness/restart supervision — a mid-run subprocess crash is permanent for the server process's life (no auto-restart, no health re-check). | `src/gateway/litellm-proxy.ts` |
| 8 | V4 | LOW | Determinism guards (`Date.now`/`Math.random`) are advisory only, bypassable via the VM's host-realm `Function` constructor escape — correctly judged LOW (non-adversarial Claude-generated script threat model), but `02-architecture.md` ARCH-003's text should stop implying the guard is fully enforced. | n/a (doc-wording nit) |
| 9 | C-3 | LOW-MEDIUM | `workflow_status`'s response envelope spreads extra top-level fields (`phases`/`agents`/`scriptVersion`) not present on the other 9 tools' uniform envelope — a minor consumability inconsistency. | `src/mcp-facade.ts` |

Recommended prioritization for a future v1.1 pass (not binding, advisory only): O-2 (audit trail) and
R-1 (alias-table drift) are the cheapest fixes with the clearest correctness payoff; V1 (auth seam)
should be scheduled ahead of any actual v3 OIDC work, not deferred indefinitely.

**What the architecture got right** (adversarial lens, for balance): the process-boundary trust split (D6/C1) genuinely contains the secrets/network/fs blast radius; all core seams (gateway/store/spawner/clock) are constructor-injected exactly as C3 specified; bind default, concurrency/agent caps, and the fail-fast validator's ownership model all match spec.

Exit-gate criterion 3: architecture consistency is consolidated above; **the inconsistency is real and is reflected in the conclusion below** — this does not require a Gate 2 redesign (the architecture text/decisions themselves are sound; #5's ARCH-009 seam and #4's D-G default are the only 2 that are "decision not honored" rather than "under-specified"), but does require a **Gate 6 implementation route-back**, prioritizing the 4 HIGH items (especially S-1, which contradicts a decision the user re-confirmed today, and V3, which corrupts resume determinism — REQ-006's own core promise).

### Validation & handover (Gate 7.5)
- Gate 7.5 (`gates.validation.passed`) = **true**, round 6, CONVERGENCE RULE satisfied: every v1 REQ acceptance clause has real, fresh `real:true` green VAL evidence, or is covered by a binding accepted-gap decision (D-V3 paid-provider credentials gap; D-F11 model-capability-tier tool-use gap). All 10 VAL-* items in `08-validation.md` are `tier: acceptance`, `real: true`.
- `trace.py --check` confirms **0 未真實驗證(mock-only)** and **0 v1-REQ 未驗證** gaps — the 6 "未驗證需求" the dashboard's overview card shows are exactly REQ-008/009/010/011/012/015, all v2/v3-out-of-scope, not mock-only v1 items.
- `08-validation.md` exists (870 lines), frontmatter `status: passed`, with 6 rounds of real-process evidence (real Ollama, real litellm[proxy] subprocess, real `@anthropic-ai/claude-agent-sdk` sessions, `ps aux`/`ss -tlnp`/`curl` repros).
- Handover docs present at `state.yaml layout.readme`/`layout.deploy`: `README.md` (210 lines) and `DEPLOY.md` (278 lines), both step-by-step (numbered quickstart/deploy steps, health-check section, rollback section, troubleshooting table, known-limitations section), both rewritten in round 6 with fresh evidence.
- **No REQ closed on mock-only evidence. No missing handover doc.** Exit-gate criterion 4 satisfied at the REQ-acceptance level.
- **Caveat**: the architecture-consistency review above (S-1 specifically) surfaced a real production defect (no default `timeoutMs` in the zero-config default-gateway deployment path) that Gate 7.5's own 6 rounds never exercised, because every round used an explicit config file. This is not a Gate 7.5 process failure (it tested every documented REQ acceptance clause thoroughly) — it is a gap in what was tested, now found by this Gate 8 review. It should be added to Gate 7.5's test matrix on the route-back.

## Retro
- **What went well this iteration**: exceptionally disciplined validation practice — 7 full/scoped real-process Gate 7.5 rounds, each independently re-confirming prior fixes with fresh repros rather than trusting narrative; every route-back closeout re-ran the full suite and `tsc --noEmit` from scratch; honest handling of the D-F11 model-capability-tier finding (didn't force a fake fix, recorded the real boundary); 0 orphan/broken-link/mock-only gaps across the entire 187-item ledger; docs (README/DEPLOY) kept in lockstep with every round's findings, not deferred to the end; the Gate 8 closing-fixes round itself was disciplined too — all 4 HIGH + 2 MEDIUM fixed with forcing tests written red-first (gap-tests-9), one genuine test defect (IT-028's `workflow_list` sub-case) found and reported rather than papered over, and a scoped Gate 7.5 round 7 re-validated the 3 most operationally-critical fixes (S-1/O-1/C-1) against a real, independent, unmocked process rather than trusting the unit/integration suite alone.
- **What to change next iteration**: (1) architecture-consistency review (this Gate 8 lens) should run at least once mid-implementation, not only at the very end — 4 HIGH findings (esp. S-1's default-timeout gap and V3's nested-journal collision) would have been cheaper to catch before 6 validation rounds' worth of code accreted around the gap; (2) the 3 independently-maintained alias tables (R-1) and the duplicated abort/timeout/retry logic across 3 gateway paths (adversarial advisory) suggest a "single source of truth" consolidation pass should be scheduled explicitly, not left implicit; (3) `tools/list` (C-1) should be test-driven from the start — an IT/E2E test asserting `inputSchema.properties` is non-empty per tool would have caught this at Gate 5, not Gate 8 (and, per IT-028's own test defect, the forcing test itself should special-case genuinely zero-parameter tools from the start rather than needing a round-7 re-confirmation of the same defect).
- **Known tech debt (recorded as known gaps)**:
  - v2/v3 scope (18 trace gaps: REQ-008..012/015, TASK-018..023) — explicitly deferred by the requirements Gate itself, not implementation debt.
  - v1.1 backlog already filed in `08-validation.md` (5 items): aborted-`AgentRecord` cosmetic state, litellm port-4000 collision hazard, tool-use re-test against a larger local model / paid provider, latent `cwd`-not-per-run-workspace gap, `mkdtemp()` temp-dir cleanup.
  - **v1.1 backlog from the Gate 8 architecture-consistency review** (7 MEDIUM/LOW items remaining after this closing round's 6 fixes — full detail + evidence in the "v1.1 backlog" section above): V1 (auth no-op seam), O-2 (transition audit trail), R-1 (duplicated `DEFAULT_ALIASES`), R-2 (gateway secret-custody divergence), R-3 (`workflow_artifacts` bypasses `RunStore`), C-2 (collapsed sandbox IPC error codes), S-2 (no litellm-proxy liveness supervision); V4 and C-3 (LOW) accepted as-is for v1, doc-wording-only.
  - Known test defect (not product debt, recorded for future test-suite hygiene): `IT-028`'s "every tool has non-empty `inputSchema.properties`" sub-assertion should exempt genuinely zero-parameter tools (`workflow_list`) rather than being re-flagged every round.
- **Gate 8 closure (this pass)**: all 6 D-G8-1..6 binding fixes independently re-verified against the current source tree, their tests, and Gate 7.5 round-7's real-process evidence — see "GATE 8 CLOSING RE-REVIEW" callout above. 0 remaining unfixed HIGH architecture-consistency findings. `gates.review.passed` set to `true`; iteration closes.

## Report (as-found, original Gate 8 pass — SUPERSEDED, see below)
```
Gaps: high=0 mid=12 low=6 (all remaining recorded as known v2/v3-out-of-scope tech debt above)
Drift: none
Architecture consistent: no — 15 violations (4 HIGH: V3 nested-journal callSeq collision / O-1 transcript black-box / C-1 tools/list placeholder schemas / S-1 no default timeoutMs on default gateway path contradicting user-reconfirmed D-G; 9 MEDIUM; 2 LOW) — see full list above
Validation: real-tier all-green? yes (Gate 7.5 round 6, CONVERGENCE RULE satisfied, 0 mock-only/未驗證 among v1 REQs) · README+DEPLOY present? yes, step-by-step
Conclusion: send back to Gate 6 (implementation route-back) for the 4 HIGH architecture-consistency findings — prioritize S-1 (contradicts today's user-reconfirmed D-G decision, real hang risk in the documented zero-config default deployment) and V3 (breaks REQ-006 resume determinism for nested workflows); re-run the affected Gate 7.5 acceptance clauses (REQ-004's bounded-timeout clause under zero-config; REQ-006's resume-determinism clause under nesting) after the fix. The 9 MEDIUM + 2 LOW findings and the pre-existing v2/v3 trace gaps may be carried as known tech debt if the team elects not to fix them this cycle, but must stay recorded (as they are here) rather than silently dropped.
```

## Report (Gate 8 CLOSING RE-REVIEW, 2026-07-03 22:05 — CURRENT / AUTHORITATIVE)
```
Gaps: high=0 mid=12 low=6 (all remaining recorded as known v2/v3-out-of-scope tech debt above; identical baseline, 0 new gaps from IMPL-051)
Drift: none (04-design.md D-G8-* route-back notes match IMPL-051 in the same round; README.md/DEPLOY.md rewritten in the same round as the Gate 7.5 round-7 real-process evidence)
Architecture consistent: yes for all previously-HIGH findings — 0 remaining unfixed HIGH (V3/O-1/C-1/S-1 all fixed + re-verified this round, evidence table above). 7 MEDIUM/LOW findings (V1, O-2, R-1, R-2, R-3, C-2, S-2) plus 2 LOW (V4, C-3) remain, formally recorded as v1.1 backlog per binding user decision, not fixed this round.
Validation: real-tier all-green? yes (Gate 7.5 round 6 CONVERGENCE RULE + round 7 scoped real-process re-confirmation of the 3 most operationally-critical D-G8 fixes) · README+DEPLOY present? yes, step-by-step, updated in round 7
Conclusion: iteration can close. All 4 HIGH + 2 MEDIUM binding Gate-8 fixes (D-G8-1..6) confirmed resolved at the code/test tier and re-confirmed via Gate 7.5 round-7 real-process evidence for the 3 highest-risk ones (S-1 zero-config hang, O-1 transcript black-box, C-1 tools/list placeholders). 7 remaining MEDIUM/LOW architecture-consistency findings correctly recorded as v1.1 backlog, not silently dropped. gates.review.passed=true.
```
