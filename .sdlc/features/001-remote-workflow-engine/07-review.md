---
stage: review
status: passed
---
# 07 Review & Retro — Gate 8

## v2 GATE 8 FINAL CLOSING REVIEW (2026-07-04 22:40, CURRENT / AUTHORITATIVE)

> This section supersedes "## v2 GATE 8 CLOSING RE-REVIEW (2026-07-04 20:05)" immediately below
> (kept for history). That 20:05 pass reviewed the working tree as IMPL-064 left it and correctly
> reported the V3 HIGH as downgraded to MEDIUM. Between that pass and this one, a further real-run
> defect was found and fixed **within the same fix round** (same binding decisions D-V2G8-1/D-V2G8-2,
> no new decision needed): **IMPL-067** (journal 2026-07-04 21:20) — picking up IMPL-064's own
> hand-off — ran a REAL (non-mocked) `@anthropic-ai/claude-agent-sdk` session and found that the
> `canUseTool` callback IMPL-064 wired was **silently shadowed** for the default (no opt-in)
> `Read`/`Write` case: a bare `allowedTools` entry auto-approves that tool call before `canUseTool`
> is ever consulted (the SDK's own `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` runtime warning), so a real
> unmocked `Read` of `/etc/hostname` (outside the workspace) SUCCEEDED despite the mocked UT-040
> passing green — the exact default-path exfiltration vector the original V3 HIGH named, still open
> in practice though closed on paper. IMPL-067 fixed this by wiring the SAME boundary decision as
> BOTH `canUseTool` (unchanged) AND a new `hooks.PreToolUse` matcher (`makePreToolUseHook`,
> `src/gateway/claude-agent-sdk-client.ts:164-180`) — the SDK's own documented alternative for a call
> a bare `allowedTools` entry already auto-approved — without touching `allowedTools` itself (so the
> pre-existing `UT-024`/D-F11 regression test, which requires the built-in fallback to stay bare,
> stays green). This was independently re-verified for real at **Gate 7.5 v2 ROUND 4** (journal
> 2026-07-04 22:10, `08-validation.md` "## v2 ROUND 4", VAL-019..022): live `ps aux` argv, live
> `/proc/<pid>/environ` key-custody diffing, and the REAL captured `canUseTool`/`PreToolUse` callback
> objects denying 3 real hostile-path attempts (LiteLLM's own config, a different real run's
> workspace secret, `/etc/hostname`) while allowing a genuine in-workspace path. ROUND 4 also found
> and fixed 1 new config-drift defect (`rwe.config.example.json`/DEPLOY.md's shipped example still
> listed `Bash` in `defaultAllowedTools`, which the documented `cp ...example.json rwe.config.json`
> quickstart would have silently re-enabled) — corrected to `["Read","Write"]`
> (`rwe.config.example.json:9`), confirmed on disk above. **Net effect on the architecture-consistency
> verdict below: unchanged in substance** — the residual V3 finding (Bash opt-in / symlink / other
> file-tool bypass) the 2 architecture-expert panel reports already describe is exactly what survives
> after IMPL-067 too (their critique was never about the shadowing bug — that was a real-execution-only
> defect neither static architecture lens could see — and IMPL-067 didn't touch Bash/symlink/other-tool
> coverage), so the panel reports at `.panel/review/*.md` remain valid without a re-spawn; only their
> line-citations for `canUseTool` have drifted by a few lines (now ~147-159, not 140-148) since
> IMPL-067 added `makePreToolUseHook` above it — noted here, not requiring a re-run.
>
> **V3/V4 resolved-on-disk verification performed this pass** (fresh, not trusted from the log):
> - `permissionMode: 'default'` — `src/gateway/claude-agent-sdk-client.ts:293`.
> - `BUILT_IN_CORE_TOOLS = ['Read', 'Write']` (no `Bash`) — `:118`.
> - `canUseTool: makeCanUseTool(...)` — `:294`, `makeCanUseTool`/`toolUsePreCheck`/`isInsideWorkspace`
>   — `:124-159`.
> - `hooks: { PreToolUse: [{ hooks: [makePreToolUseHook(...)] }] }` (the IMPL-067 shadowing fix) —
>   `:326`, `makePreToolUseHook` — `:164-180`.
> - `env: buildSubprocessEnv(...)` (agent-CLI env allowlist, no host secrets) — `:329`,
>   `buildSubprocessEnv`/`ENV_ALLOWLIST` — `:194-213`.
> - Proxy-subprocess env custody (D-V2G8-1(c)) — `src/gateway/litellm-proxy.ts` `_doStart()`'s
>   `spawnImpl(...)` explicit `env:` passthrough (unchanged since IMPL-064, re-verified present).
> - `RunGuard.reserve()` reserves `Math.min(remaining, this.total / 2)`, not 100%-of-remaining —
>   `src/run-guard.ts:92-98` (D-V2G8-2).
> - New/route-back tests, re-run standalone this pass, all green: `UT-039` (3/3, permission
>   hardening), `UT-040` (5/5, workspace boundary), `UT-041` (3/3, provider-key non-reachability),
>   `IT-037` (2/2, parallel budget-estimate reservation), plus the pre-existing regression guard
>   `UT-024` (3/3, D-F11 bare-`allowedTools` shape) confirmed still green (no shadowing-fix
>   regression). Full suite re-run fresh this pass: 96 files / 356 tests, 354 pass / 2 fail — same 2
>   pre-existing `IT-015`(env defect)/`IT-024`(in-flight-state test, ~1/6 documented flake, unrelated
>   to the in-flight-agent-state test's own name collision with the route-back's `IT-037` — different
>   files) failures, unchanged, no new regression.
> - `sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check` re-run fresh this pass: 247
>   items, 3 gaps (REQ-012 未實作/未驗證 + TASK-018 未實作, v3-out-of-scope baseline, byte-identical
>   to every prior round), 0 orphan/broken-link/漂移/未真實驗證, `dashboard.html` regenerated.
>
> **Conclusion of this pass: V3 (HIGH) and V4 (MEDIUM regression) both confirmed resolved on disk**,
> with real-execution re-verification (not just mocked-unit-test claims) at Gate 7.5 ROUND 4 — see
> the updated Report block at the end of this section. The rest of the architecture-consistency
> table (§2 below, unchanged from the 20:05 pass) still stands: 11 residual MEDIUM/LOW findings, 0
> HIGH, recorded as v2.1 backlog, not blocking.

### v2.1 backlog (carried, unchanged in substance by IMPL-067 — full detail in the 20:05 section §2/Retro below)
V1 (auth no-op seam, worse in v2), V2 (RunGuard global-vs-per-run cap multiplication), V3-residual
(Bash opt-in / symlink / non-`file_path`-tool workspace-confinement gaps — MEDIUM, not HIGH, since
the default surface's real shadowing bug is now closed by IMPL-067), V4-residual (`total/2`
budget-reservation magic constant, stale `run-manager.ts` comment), V5 (VM determinism guards
bypassable), O-2 (no transition-history audit trail), R-1 (3 drifted `DEFAULT_ALIASES` tables), R-3
(`workflow_artifacts` bypasses `RunStore`), C-2 (2 generic IPC error codes), C-3 (`workflow_status`
non-uniform envelope), S-2 (no LiteLLM-proxy liveness/restart supervision). 11 items, all
MEDIUM/Medium-High/LOW, 0 HIGH — not fixed this round, per binding scope (only V3/V4 were in scope
for D-V2G8-1/D-V2G8-2).

### Report (v2 Gate 8 FINAL CLOSING REVIEW, 2026-07-04 22:40 — CURRENT / AUTHORITATIVE)
```
Gaps: high=0 mid=2 low=1 (REQ-012 未實作/未驗證 + TASK-018 未實作, v3-out-of-scope, recorded as
  known tech debt; re-confirmed byte-identical this pass: 247 items, 3 gaps, 0 severe)
Drift: none (trace.py 0 漂移/orphan/broken-link gaps this pass; every v2 REQ/ARCH/TASK/DES/IMPL/UT
  chain, incl. the route-back items UT-039..041/IT-037/IMPL-064/067, consistently iter:v2/v2g8)
Architecture consistent: no — 11 residual findings, 0 HIGH (V3 HIGH from the original pre-route-back
  pass is now genuinely resolved for the default path, real-execution-verified via IMPL-067 +
  Gate 7.5 ROUND 4 VAL-019..022, and downgraded to MEDIUM for its acknowledged residual scope
  — Bash opt-in / symlink / non-file_path-tool bypass). 5 MEDIUM/LOW from adversarial (V1, V2,
  V3-downgraded, V4-downgraded, V5) + 6 Medium/Medium-High/Low-Medium from quality-dimensions (O-2,
  R-1, R-3, C-2, C-3, S-2) — all in the v2.1 backlog above, none new, none blocking.
Validation: real-tier all-green? yes (Gate 7.5 v2 ROUND 4, SCOPED security re-validation dispatched
  standalone after IMPL-067, fresh independent process, VAL-019..022 confirm D-V2G8-1(a)(b)(c)(d) +
  D-V2G8-2 for real via ps aux argv / /proc/<pid>/environ diffing / real captured canUseTool+
  PreToolUse callback deny-tests / real parallel() concurrency-restored-to-2 with 3rd budget-capped;
  0 mock-only/未驗證 among v1/v2 in-scope REQs) · README+DEPLOY present? yes, step-by-step, updated
  ROUND 4 (1 new config-drift found+fixed this round: rwe.config.example.json/DEPLOY.md's shipped
  defaultAllowedTools still listed Bash, corrected to ["Read","Write"])
Conclusion: iteration can close. The pre-route-back HIGH (V3, agent-CLI Bash/default-path escaping
  the trust boundary) is fixed and real-execution-verified twice over (IMPL-067's own repro +
  Gate 7.5 ROUND 4's independent re-verification), not merely claimed from a mocked unit test. The
  MEDIUM regression (V4, parallel() collapsing to 1 under budget) is fixed and confirmed restoring
  concurrency to 2 with the hard ceiling intact. 11 residual MEDIUM/Medium-High/LOW
  architecture-consistency findings are recorded as v1.1/v2.1 backlog, real and unresolved but none
  HIGH and none blocking, per the same binding-deferral precedent set at v1's own Gate 8 close.
  gates.review.passed -> true.
```

---

## v2 GATE 8 CLOSING RE-REVIEW (2026-07-04 20:05, superseded by the FINAL CLOSING REVIEW above)

> This section supersedes "## v2 GATE 8 REVIEW (2026-07-04, iteration v2)" immediately below, which
> was the **as-found, pre-route-back** record (correctly identified 1 HIGH — V3, agent-CLI `Bash`
> escapes the trust boundary — plus 2 related MEDIUM, V2/V4, and recommended a Gate 6 route-back).
> That route-back happened: the orchestrator dispatched D-V2G8-1 (drop `bypassPermissions`, curate
> the default tool surface to `['Read','Write']`, wire a `canUseTool` workspace-boundary callback,
> explicit proxy-subprocess env custody) and D-V2G8-2 (per-call budget-reservation cap at
> `total/2` instead of 100%-of-remaining) — RED tests (UT-039/040/041, IT-037) written at Gate 5,
> GREENED at Gate 6 (**IMPL-064**), verification-closed at Gate 6.5/7 (**IMPL-065/066**), and the
> whole iteration re-validated for real at Gate 7.5 **ROUND 3** (`08-validation.md`, `state.yaml`
> `gates.validation.note`, journal 2026-07-04 19:15). This pass re-reviews the **post-fix** code
> against the 2 architecture-expert reports, which were themselves **re-run against the fixed
> source** (`.panel/review/adversarial.md`, `.panel/review/quality-dimensions.md`, both explicitly
> scoped as "re-review after the Gate-8 v2 route-back, IMPL-064").

### 1. Traceability consistency (`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine`, regenerated 2026-07-04)
- `✓ 掃描 242 個工作項，偵測 3 個缺口`. `--check`: **3 gaps**, byte-identical to every prior round's
  baseline:
  - `mid` **REQ-012 未實作** — REQ-012 (v3 OAuth 2.0/OIDC, `01-requirements.md:194-200`, `iter: v3`,
    explicitly "deferred by user decision D5") has no IMPL tracing to it.
  - `mid` **REQ-012 未驗證** — same REQ, no UT/IT/VAL tracing to it.
  - `low` **TASK-018 未實作** — TASK-018 (`03-tasks.md:124-128`, the v3 auth-middleware seam task,
    `iter: v3`, `traces: ARCH-009`) has no IMPL.
  - **0** broken-link (斷鏈), **0** orphan (孤兒), **0** doc↔code iteration-drift (漂移), **0**
    未真實驗證 (mock-only), **0** unverified in-scope (v1 or v2) REQ.
  - **gaps_high = 0, gaps_mid = 2, gaps_low = 1.** All 3 are known, accepted, out-of-scope (v3)
    tech debt — recorded here per Exit-Gate criterion 1, not accidental.
- **Doc↔code iteration drift**: none. Every v2 REQ (`REQ-008..011,015`, `iter: v2`) chains through
  `ARCH-010..014` → `TASK-019..027` (v2, except v3 `TASK-018`) → `DES-016..023` → `IMPL-052..066` →
  `UT-027..041`/`IT-031..037`/`E2E-004..005`/`VAL-008..011,016,017,018` all consistently `iter: v2`.
  The Gate-8-route-back items (UT-039/040/041, IT-037, IMPL-064/065/066) all carry `iter: v2` and
  trace to `ARCH-002/005/007` (pre-existing v1 ARCH items the v2 fix touches) — no DES/UT left
  stamped with a stale iteration while its IMPL moved on. Exit-Gate criterion 2 satisfied.

### 2. Architecture consistency (vs Gate 2 `02-architecture.md`) — post-route-back re-review
Consolidated from the 2 **already-run** expert reports (not re-spawned, per instruction) at
`.sdlc/features/001-remote-workflow-engine/.panel/review/`, both explicitly re-reviewing the
IMPL-064-fixed source, not the pre-fix snapshot:
- `adversarial.md` — security / scalability-consistency / testability (opus-4-8).
- `quality-dimensions.md` — observability / replaceability / consumability / self-sustainability
  (sonnet-4-6/5), each re-verifying every prior "resolved" claim against current source directly
  (grep/read), not taken on the log's narrative.

**Verdict: NOT (fully) consistent — but 0 HIGH remain.** The prior HIGH (V3) was **downgraded to
MEDIUM**: IMPL-064 closed the *default* agent-CLI attack surface (`permissionMode:'default'`,
`Bash` dropped from the default tool set, a `canUseTool` workspace-boundary callback) — confirmed
genuinely fixed, not a paper patch. **11 findings remain open**, all MEDIUM/MEDIUM-HIGH/LOW, none HIGH:

| # | ID | Lens | Severity | Finding (ARCH violated) | Evidence | Status |
|---|----|------|----------|-------------------------|----------|--------|
| 1 | V1 | adversarial | MEDIUM | ARCH-009 auth-middleware no-op seam still doesn't exist in `src/server.ts` — now *more* exposed (v2 added `/dashboard`, `/api/runs*`, RCE-capable `asset_push` on the same open unauthenticated listener) | `src/server.ts:471-521` | carried, worse than v1 |
| 2 | V2 | adversarial | MEDIUM | `RunGuard`'s concurrency gate (`min(16,cores-2)`) and the ARCH-002 "global" agent counter (`≤1000`) are enforced **per-run** (fresh `RunGuard` per run) — K runs multiply both host caps by K, unbounded | `src/run-guard.ts:5,13,17-18,26-52`; `src/run-manager.ts:92,127` | open, newly precise this round |
| 3 | V3 | adversarial | MEDIUM (↓ from HIGH) | Workspace confinement (`canUseTool`) covers only `Read`/`Write`'s `file_path`, lexically (not `realpath`) — an agentType opting into `Bash` (still fully supported), a symlink, or `Edit`/`Glob`/`Grep`/`NotebookEdit` bypasses it | `src/gateway/claude-agent-sdk-client.ts:118,124-128,140-148,233-236` | residual, downgraded |
| 4 | V4 | adversarial | LOW (↓ from MEDIUM) | Flat `total/2` per-call budget reservation caps `parallel()` at 2 concurrent calls under a tight budget; `run-manager.ts:332-337`'s own comment still says "reserves the entire remaining budget" — stale, contradicts the code | `src/run-guard.ts:92-98`; `src/run-manager.ts:332-338` | residual, downgraded |
| 5 | V5 | adversarial | LOW | Determinism guards (`Date.now`/`Math.random`) bypassable via VM host-realm `Function` escape; not a process-boundary property | `src/sandbox/guards.ts:163-175` | carried, unchanged |
| 6 | O-2 | quality-dims | Medium-High | Both `RunStore` impls drop `recordTransition`'s `from`/`ts` — no transition-history audit trail despite ARCH-006's "one writer of every state transition (timestamp+runId)" | `src/run-store.ts:116-120`, `src/store/sqlite-run-store.ts:114-116` | carried, unchanged since v1 |
| 7 | R-1 | quality-dims | Medium | 3 independently-maintained `DEFAULT_ALIASES` tables drifted (`run-manager.ts`/`main.ts` agree; `submission-validator.ts` differs) — ARCH-005 "config, singular" broken | `src/run-manager.ts:26-31`, `src/main.ts:40-45`, `src/submission-validator.ts:12-17` | carried, unchanged |
| 8 | R-3 | quality-dims | Medium | `workflow_artifacts` bypasses `RunStore`, calls `readdirSync` directly on the workspace path — ARCH-001 "no direct persistence (reads via ARCH-006)" | `src/mcp-facade.ts:149-163` | carried, unchanged |
| 9 | C-2 | quality-dims | Medium-High | Sandbox IPC boundary collapses every `agent()`/`workflow()` error into 1 of 2 generic codes (`AGENT_ERROR`/`NESTING_ERROR`) — ARCH-001 uniform-envelope/branch-identically promise broken | `src/sandbox/host.ts:74-104` | carried, unchanged |
| 10 | C-3 | quality-dims | Low-Medium | `workflow_status` spreads extra top-level fields (`phases`/`agents`/`scriptVersion`), not uniform with the other 15 tools | `src/mcp-facade.ts:87-92` | carried, unchanged |
| 11 | S-2 | quality-dims | Medium | `LiteLLMProxyManager` has no post-start liveness/restart supervision — a mid-run crash of the now-default gateway's always-on subprocess is permanent for the process's life | `src/gateway/litellm-proxy.ts` | carried, unchanged |

**What the route-back genuinely fixed** (both lenses agree): no `bypassPermissions`, curated default
tools (`Bash` off by default), a real `canUseTool` deny-callback, explicit proxy env custody
(`ENV_ALLOWLIST`/`buildSubprocessEnv`), and atomic budget reservation replacing the prior
stale-pre-check TOCTOU — all independently re-verified against current source, not trusted from
`06-impl-log.md`'s narrative. **0 new violations were introduced by IMPL-064..066** within either
lens's dimensions (quality-dimensions explicitly re-checked and confirms this).

**Exit-Gate criterion 3**: architecture consistency is consolidated above; the residual
inconsistency (11 MEDIUM/MEDIUM-HIGH/LOW findings, 0 HIGH) is reflected in the conclusion below.
Unlike the pre-route-back finding (V3 at HIGH, which blocked closing and correctly routed back to
Gate 6), none of the 11 residual findings rises to HIGH, and 2 of them (V3, V4) are the *same*
findings already substantively fixed this round and merely downgraded, not new defects — consistent
with the precedent set at v1's own Gate 8 close (7 MEDIUM/LOW backlogged, not blocking). Recorded as
**v2.1 backlog** below rather than a further route-back.

### 3. Validation & handover (Gate 7.5)
- `gates.validation.passed` = **true** — v2 **ROUND 3** (2026-07-04 19:15), a fresh independent
  validator dispatch (not trusting Round 2's narrative): re-ran the full boot from documented steps
  only, fresh real `ps aux`-inspected agent-CLI argv, fresh real materialized `SKILL.md`, fresh real
  `GET /dashboard` HTML + live-update-without-reload, fresh real `claude mcp list` recognition, fresh
  real SIGTERM orphan-reap. Found + fixed 1 genuine doc drift (README/DEPLOY's stale claim that the
  litellm port is fixed at 4000 and shutdown doesn't reap it — both false since TASK-027; corrected
  in the same round).
- `trace.py --check` confirms **0 未真實驗證 (mock-only)** and **0 in-scope 未驗證** gaps — the only
  2 "未驗證" cards are REQ-012 (v3, explicitly out of scope).
- `08-validation.md` exists (1906 lines), frontmatter `status: passed`, with a "v2 ROUND 3" section
  (current head) containing fresh real-process evidence, superseding but preserving ROUND 1/2 for
  history.
- Handover docs present at `state.yaml layout.readme`/`layout.deploy`: `README.md` and `DEPLOY.md`
  (product root), both step-by-step (numbered quickstart/deploy steps, health-check, rollback,
  troubleshooting table, known-limitations sections in Traditional Chinese), both updated in ROUND 3
  with the corrected litellm-port/shutdown claims.
- **No REQ closed on mock-only evidence. No missing handover doc.** Exit-Gate criterion 4 satisfied.

### Retro (v2 iteration, closing pass)
- **What went well**: the Gate-8 route-back loop worked exactly as designed — a genuine HIGH
  security finding (V3) was found by the architecture-consistency lens (not by Gate 7.5's
  REQ-acceptance testing, which structurally couldn't reach it since no round tried an
  adversarial/cross-workspace script), routed to Gate 6 with an explicit new decision (D-V2G8-1/2)
  rather than a silent patch, RED-tested first (UT-039/040/041, IT-037), fixed, and **re-verified by
  re-running the same 2 architecture experts against the fixed source** rather than trusting the
  implementer's own claim — this is what caught that V3 is downgraded-but-not-eliminated (Bash
  opt-in/symlink/other-file-tool gaps remain) instead of naively marking it "fixed."
- **What to change next iteration**: (1) Gate 5's test matrix should include an adversarial-script
  acceptance test ("agent() with Bash cannot read another run's workspace or the proxy's config")
  from the start, not only after a Gate 8 finding forces it — the residual V3 gap (Bash opt-in path)
  is exactly what such a test would keep pinned red until genuinely closed; (2) the 3-copy
  `DEFAULT_ALIASES` drift (R-1) and the 2-generic-error-code IPC collapse (C-2) have now survived 2
  full Gate-8 reviews (v1 and v2) unaddressed — should be scheduled explicitly in v2.1/v3, not
  deferred a third time; (3) `RunGuard`'s global-vs-per-run cap question (V2) and its budget
  reservation constant (V4) both point at the same underlying gap — a process-global concurrency/
  agent-count semaphore plus a per-call budget *estimate* (reconciled in `capture()`) would fix both
  in one coherent redesign instead of two separate constants.
- **Known tech debt (recorded as known gaps, not silently dropped)**:
  - v3-out-of-scope trace gaps (REQ-012, TASK-018) — deferred by the requirements Gate itself.
  - v1.1 backlog (carried unfixed from the v1 Gate 8 review, unchanged by v2): O-2, R-1, R-3, C-2,
    S-2, V1 (auth no-op seam — now worse, see above), C-3, V5(LOW, doc-wording).
  - **v2.1 architecture backlog (this round)**: V2 (global-vs-per-run RunGuard caps), V3-residual
    (Bash opt-in/symlink/other-tool workspace-confinement gaps — MEDIUM, not HIGH, since the
    *default* surface is now safe), V4-residual (`total/2` budget-reservation magic constant + its
    stale code comment).
  - v2.1 non-architecture backlog (from `08-validation.md`): aborted-`AgentRecord` cosmetic state,
    litellm port-4000 collision hazard (mitigated but not eliminated by TASK-027), tool-use re-test
    against a larger local model/paid provider, latent `cwd`-not-per-run-workspace gap, `mkdtemp()`
    temp-dir cleanup, D-V2V-3 docker/sudo environment gap (accepted, non-blocking).

### Report (v2 Gate 8 CLOSING RE-REVIEW, 2026-07-04 20:05 — CURRENT / AUTHORITATIVE)
```
Gaps: high=0 mid=2 low=1 (REQ-012+TASK-018, v3-out-of-scope, recorded as known tech debt above)
Drift: none (trace.py 0 漂移 gaps; every v2 REQ/ARCH/TASK/DES/IMPL/UT/route-back-test chain
  consistently iter:v2, incl. the Gate-8 route-back items UT-039..041/IT-037/IMPL-064..066)
Architecture consistent: no — 11 residual findings, 0 HIGH (down from 1 HIGH pre-route-back): 5
  MEDIUM/LOW from the adversarial lens (V1, V2, V3-downgraded, V4-downgraded, V5) + 6 Medium/
  Medium-High/Low-Medium from quality-dimensions (O-2, R-1, R-3, C-2, C-3, S-2) — see table above.
  The prior blocking HIGH (V3, agent-CLI Bash escaping the trust boundary) is confirmed fixed at the
  default-surface level (D-V2G8-1/IMPL-064) and downgraded to MEDIUM for its residual (opt-in
  Bash/symlink/other-file-tool) scope.
Validation: real-tier all-green? yes (Gate 7.5 v2 ROUND 3, fresh independent validator dispatch,
  CONVERGENCE RULE satisfied, 0 mock-only/未驗證 among v1/v2 in-scope REQs) · README+DEPLOY present?
  yes, step-by-step, updated ROUND 3 (1 doc-drift found+fixed: litellm port/shutdown claims)
Conclusion: iteration can close. The 1 HIGH finding that blocked the prior (pre-route-back) Gate 8
  pass is fixed and re-verified for real by re-running both architecture experts against the fixed
  source (not trusted from the implementer's log). 11 residual MEDIUM/MEDIUM-HIGH/LOW
  architecture-consistency findings (5 adversarial + 6 quality-dimensions) are recorded above as
  v1.1/v2.1 backlog per the same binding-deferral precedent set at v1's own Gate 8 close — real,
  confirmed, not silently dropped, but none blocking. gates.review.passed -> true.
```

---

## v2 GATE 8 REVIEW (2026-07-04, iteration v2 — SUPERSEDED, see "CLOSING RE-REVIEW" above)

> **Superseded 2026-07-04 20:05**: this section is the **as-found, pre-route-back** Gate 8 pass. It
> correctly found 1 HIGH (V3) + 2 related MEDIUM (V2, V4) and recommended a Gate 6 route-back. That
> route-back happened (D-V2G8-1/2, IMPL-064, re-verified at Gate 6.5/7/7.5 ROUND 3) — see the
> "CLOSING RE-REVIEW" section above for the current, authoritative state. Preserved below UNCHANGED
> for history; do not edit it to retroactively mark items fixed.

> Everything below this section (down to "## v1 Gate 8 review — historical record") is the **v1**
> Gate 8 pass (closed 2026-07-03). It is preserved unchanged for history. This new section is the
> review of the **v2** iteration (TASK-019..027 / DES-016..023 / IMPL-052..063, scheduler + dashboard
> + asset-sync + client plugin + deploy hardening), performed after Gate 7.5 v2 Round 2 flipped
> `gates.validation.passed` to `true`.

### 1. Traceability consistency (`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine`, regenerated 2026-07-04 10:10)
- Total work items: **235**. `trace.py --check`: **3 gaps**, all on the identical pre-existing,
  binding-decision v3-out-of-scope baseline:
  - `mid` **REQ-012 未實作** — REQ-012 (v3 OAuth/OIDC) has no IMPL tracing to it.
  - `mid` **REQ-012 未驗證** — REQ-012 has no UT/IT/VAL tracing to it.
  - `low` **TASK-018 未實作** — TASK-018 (v3 auth middleware task) has no IMPL.
  - **0** broken-link (斷鏈), **0** orphan (孤兒), **0** doc↔code iteration-drift (漂移) gaps, **0**
    未真實驗證 (mock-only) gaps, **0** unverified in-scope (v1 or v2) REQ.
  - **gaps_high = 0, gaps_mid = 2, gaps_low = 1.** All 3 are explicitly recorded here as **known,
    accepted, out-of-v2-scope tech debt** (REQ-012/TASK-018 are `iter: v3`, deferred since Gate 1.5's
    own requirements-slice decision, reconfirmed unchanged at every gate since) — not accidental.
    Exit-gate criterion 1 satisfied.
- **Doc↔code iteration drift**: none. `trace.py`'s own drift check (comparing each item's `iter:`
  against its downstream/upstream neighbors' `iter:`) produced 0 findings. Spot-verified manually:
  every v2 REQ (`REQ-008..011,015`, `iter: v2`) traces to `ARCH-010..014` (`iter: v2`) → `TASK-019..027`
  (`iter: v2`, except `TASK-018` which is `iter: v3`) → `DES-016..023` (`iter: v2`) → `IMPL-052..063`
  (`iter: v2`) → `UT-027..033`/`IT-031..036`/`E2E-004..005`/`VAL-008..011,016,017,018` (`iter: v2`) —
  no DES/UT left at a stale `iter` while its IMPL moved on. Exit-gate criterion 2 satisfied.

### 2. Architecture consistency (vs Gate 2 `02-architecture.md`)
Consolidated from the 2 pre-run expert reports at `.sdlc/features/001-remote-workflow-engine/.panel/review/`
(already present, not re-spawned, per instruction):
- `adversarial.md` — security / scalability-consistency / testability (opus), scoped to the files each
  touched `IMPL-*` lists plus directly-referenced module boundaries.
- `quality-dimensions.md` — observability / replaceability / consumability / self-sustainability
  (sonnet), same scoping; explicitly re-verifies (not trusts) each prior-round finding against the
  current source tree.

**Verdict: NOT consistent.** Of the v1 Gate-8 closing round's 10 architecture-consistency findings,
**4 are now genuinely RESOLVED** (re-verified against current source, not taken on faith): O-1
(transcript stream now captured, `claude-agent-sdk-client.ts:150-164,272-295` + `agent-executor.ts:108-113`),
C-1 (`tools/list` real per-tool schemas, `server.ts:121-264`), S-1 (default `timeoutMs` fallback,
`main.ts:100,145`), R-2 (`ENV_ALLOWLIST`, `claude-agent-sdk-client.ts:129-148`).

**11 violations remain open or newly found** — 1 HIGH, 8 MEDIUM(-ish), 2 LOW:

| # | ID | Severity | Finding | ARCH violated | Evidence | Status |
|---|----|----------|---------|----------------|----------|--------|
| 1 | V3 | **HIGH (NEW)** | The untrusted script's `agent()` call reaches a fully-privileged, `Bash`-capable CLI in the parent trust zone (`permissionMode:'bypassPermissions'`, default tools include `Bash`, the only fs confinement is `cwd`) — a script can have the agent `cat` the LiteLLM proxy's on-disk config (real provider API keys) or another run's workspace/journal and return it as the `agent()` result, exfiltrating host secrets and cross-run data straight through the trust boundary the architecture's whole security story rests on. | ARCH-007 (fs confinement to the run workspace), ARCH-005 (sole parent-only key custody), rationale D6/C1 (trust split removes keys/network/fs from blast radius) | `src/gateway/claude-agent-sdk-client.ts:222` (`bypassPermissions`), `:115` (`BUILT_IN_CORE_TOOLS` incl. `Bash`), `:219` (`cwd`-only confinement) | Open |
| 2 | V2 | MEDIUM (NEW — corrects a prior round's mis-classification) | `RunGuard`'s concurrency gate (`min(16,cores-2)`) and the agent counter ARCH-002 explicitly calls **global** (`≤1000`) are both enforced **per-run** (`run-guard.ts:5,13,17-18,46-52`; a fresh `RunGuard` built per run at `run-manager.ts:127,226`) — K concurrent runs multiply both host-protection caps by K, unbounded, on the single node. | ARCH-002 | `src/run-guard.ts:5,13,17-18,26-44,46-52`; `src/run-manager.ts:92,127,226` | Open |
| 3 | V4 | MEDIUM (NEW — side effect of the v1 Gate-8 fix for the prior V2) | The D-G8-6 budget-reservation fix (`reserve()`) reserves **100% of currently-remaining budget** per call, held for the whole call; under any bounded budget, `parallel([a,b,c])` has the first call reserve everything and the rest immediately throw `BudgetExceededError` (swallowed to `null` by `makeParallel`) — every bounded-budget run silently loses ALL concurrency, contradicting `parallel()`'s own concurrent semantics. | ARCH-002 ⟂ ARCH-003 | `src/run-guard.ts:79-84`; `src/run-manager.ts:338,378`; `src/sandbox/guards.ts:78-85` | Open |
| 4 | O-2 | MEDIUM-HIGH (carried) | Both `RunStore` impls drop `recordTransition`'s `from`/`ts` params — no transition-history/audit trail exists despite ARCH-006's "one writer of every state transition (timestamp+runId)" promise. | ARCH-006 | `src/run-store.ts:116-120`, `src/store/sqlite-run-store.ts:114-116` | Open, unchanged since v1 |
| 5 | C-2 | MEDIUM-HIGH (carried) | Sandbox IPC boundary collapses every distinct `agent()`/`workflow()` failure into 1 of 2 generic codes (`AGENT_ERROR`/`NESTING_ERROR`), discarding real error identity. | ARCH-001 (uniform envelope, branch identically) | `src/sandbox/host.ts:74-104` | Open, unchanged since v1 |
| 6 | V1 | MEDIUM (carried) | ARCH-009's promised zero-v1-rework auth-middleware no-op seam still does not exist in `src/server.ts` — now MORE exposed (v2 added unauthenticated `/dashboard`, `/api/runs*`, and the RCE-capable `asset_push` on the same open listener). | ARCH-001, ARCH-009, rationale C4/D5 | `src/server.ts:471-521` | Open, worse than v1 |
| 7 | R-1 | MEDIUM (carried) | 3 independently hand-maintained `DEFAULT_ALIASES` tables have drifted to different model-id values for the same alias names (`run-manager.ts`/`main.ts` agree; `submission-validator.ts` differs). | ARCH-005 (config as single source of truth), ARCH-008 | `src/run-manager.ts:26-31`, `src/main.ts:40-45`, `src/submission-validator.ts:12-17` | Open, unchanged since v1 |
| 8 | R-3 | MEDIUM (carried) | `workflow_artifacts` bypasses `RunStore` entirely, calls `readdirSync` directly on the workspace path. | ARCH-001 (no direct persistence, reads via ARCH-006) | `src/mcp-facade.ts:149-163` | Open, unchanged since v1 |
| 9 | S-2 | MEDIUM (carried) | `LiteLLMProxyManager` has no post-start liveness/restart supervision — a mid-run subprocess crash of the now-default gateway's always-on dependency is permanent for the server process's life. | ARCH-014 (self-healing framing) | `src/gateway/litellm-proxy.ts` | Open, unchanged since v1 |
| 10 | C-3 | LOW-MEDIUM (carried) | `workflow_status`'s envelope spreads extra top-level fields (`phases`/`agents`/`scriptVersion`), not uniform with the other 9 (now 15, incl. v2) tools. | ARCH-001 (uniform envelope) | `src/mcp-facade.ts:87-92` | Open, unchanged since v1 |
| 11 | V5 | LOW (carried) | Determinism guards (`Date.now`/`Math.random`) are advisory only, bypassable via the VM's host-realm `Function` constructor escape. | ARCH-003 | `src/sandbox/guards.ts:163-174` | Open, unchanged since v1 (correctly judged LOW — non-adversarial script threat model) |

**What the impl got right this round** (both lenses, for balance): the prior v1 Gate-8 HIGH fixes hold
under re-verification (env-allowlist, nested-`callSeq` namespacing, real `tools/list` schemas, default
`timeoutMs`); all core seams (gateway/store/spawner/clock, `queryImpl`/`fetchImpl`/`mcpProbe`/
`proxyManager`) remain constructor-injected; bind default and the fail-fast validator's ownership model
are unchanged/compliant; the v2 scheduler/dashboard/asset-sync/plugin/deploy work introduces **0 new
violations of its own** within either lens's dimensions — all 11 open findings are either carried
unchanged from v1 or are newly-surfaced consequences of the v1 Gate-8 fixes themselves (V2, V4), not
defects in the new v2 feature code.

**Exit-gate criterion 3**: architecture consistency is consolidated above; the inconsistency is real
and reflected in the conclusion below. **V3 (HIGH) is a genuine security-boundary violation that
contradicts explicit Gate-2 rationale (D6/C1's blast-radius claim) and was not present/flagged in the
v1 review** — it is newly surfaced now because `Bash`-capable tool-use against a real local model was
only exercised for real starting in v2's validation rounds. This is not a "decision not honored, cheap
fix" item like the v1 HIGH batch; it requires an actual architecture decision (jail/chroot the CLI
subprocess's fs, or drop `Bash` from the default tool set, or move provider-key storage off any path
the agent's fs access can reach) before a route-back implementation is dispatched — **recommend
routing to Gate 2 (or at minimum Gate 6 with an explicit new ARCH decision, not a silent code patch)**
for V3 specifically. V2 and V4 are consequences of a single v1 fix (D-G8-6) trading a real overshoot
bug for a real concurrency-collapse bug — these should route back to Gate 6 together (a shared
estimate-then-reconcile budget-reservation redesign fixes both without a new Gate-2 decision). The 7
remaining MEDIUM/LOW carried items (O-2, C-2, V1, R-1, R-3, S-2, C-3, V5) may continue to be recorded
as backlog (as they were after v1's Gate 8) if the team elects not to fix them this cycle, but they
must stay recorded, not silently dropped.

### 3. Validation & handover (Gate 7.5)
- `gates.validation.passed` = **true** — v2 Round 2 (2026-07-04), CONVERGENCE RULE satisfied: all 5 v2
  REQs (`REQ-008/009/010/011/015`) have real, fresh `real:true` green VAL/E2E evidence (`VAL-008..011,
  016,017,018`), including round-2's re-verification of the 2 fixes (D-V2V-1 asset wiring via `ps aux`
  argv inspection + on-disk skill materialization; D-V2V-2 real `GET /dashboard` HTML + live-update
  demonstration) and no-regression smoke on REQ-010/011/015.
- `trace.py --check` confirms **0 未真實驗證 (mock-only)** and **0 in-scope 未驗證** gaps — the only
  2 "未驗證" cards are REQ-012, explicitly v3-out-of-scope.
- `08-validation.md` exists (frontmatter `status: passed`), with a "v2 ROUND 2" section (current head)
  containing real-process evidence (real spawned `claude` CLI argv via `ps aux`, real materialized
  `SKILL.md` on disk, real `GET /dashboard` HTTP response, real `claude mcp list` recognition, real
  `scripts/smoke.sh` pass + orphan-reap confirmation).
- Handover docs present at `state.yaml layout.readme`/`layout.deploy`: `README.md` (372 lines) and
  `DEPLOY.md` (465 lines), both step-by-step (numbered quickstart/deploy steps, health-check section,
  rollback section, troubleshooting table, known-limitations section), both updated in v2 Round 2 with
  fresh evidence (v2 status header flipped to GATE PASSED).
- **No REQ closed on mock-only evidence. No missing handover doc.** Exit-gate criterion 4 satisfied at
  the REQ-acceptance level.
- **Caveat (same class as the v1 review's caveat)**: this Gate-8 architecture-consistency pass surfaced
  V3 (HIGH), a real security exposure that Gate 7.5's 2 v2 rounds never exercised (both rounds' agent
  tool-use tests used benign scripts, never a script attempting cross-workspace/secret-file access).
  This is not a Gate 7.5 process failure — it tested every documented REQ acceptance clause — it is a
  gap in what was tested, now found by this Gate 8 review, and should be added to Gate 7.5's test
  matrix on the route-back (an adversarial-script acceptance test: "a workflow script's `agent()` call
  cannot read another run's workspace or the litellm proxy's config file").

### Retro (v2 iteration)
- **What went well**: the v2 slice (scheduler + dashboard + asset-sync + plugin + deploy hardening) was
  delivered with 0 new architecture-consistency violations of its own; Gate 7.5 found and route-backed
  2 real defects (REQ-009 asset wiring never reaching any `agent()` call; REQ-008's dashboard not
  actually being a browser page) rather than accepting weaker acceptance criteria, and both were
  re-verified for real (not just re-tested) in Round 2 before `gates.validation.passed` flipped; the
  quality-dimensions expert this round explicitly re-verified every prior "resolved" claim against
  current source instead of trusting `06-impl-log.md`'s own narrative, catching that the process/data
  is genuinely fixed for 4 of 10 prior findings.
- **What to change next iteration**: (1) the architecture-consistency review should run **during**
  implementation once real Bash-tool-use against a real local model is exercised for the first time —
  V3 (the HIGH finding) was structurally invisible until an actual agent()-with-tools call was made for
  real, which only happened in v2's validation rounds; a scoped adversarial-script test belongs in the
  Gate 5 test matrix from now on, not discovered post-hoc at Gate 8; (2) a single-fix-at-a-time approach
  to `RunGuard` (v1's D-G8-6 fixed one bug and introduced another, V4) suggests budget/concurrency
  invariants need one coherent redesign (estimate-reserve + reconcile) rather than incremental patches;
  (3) the 3-copy `DEFAULT_ALIASES` drift (R-1) and the 2-generic-error-code IPC collapse (C-2) have now
  survived 2 full Gate-8 reviews unaddressed — recommend scheduling both explicitly in the v1.1/v2.1
  backlog pass rather than leaving them permanently deferred.
- **Known tech debt (recorded as known gaps)**:
  - v3-out-of-scope trace gaps (REQ-012, TASK-018) — deferred by the requirements Gate itself.
  - v1.1 backlog (carried unfixed from the v1 Gate 8 review): O-2 (transition audit trail), R-1
    (duplicated `DEFAULT_ALIASES`), R-3 (`workflow_artifacts` bypasses `RunStore`), C-2 (collapsed
    sandbox IPC error codes), S-2 (no litellm-proxy liveness supervision), V1 (auth no-op seam), C-3
    (non-uniform `workflow_status` envelope), V5 (advisory-only determinism guards, LOW, doc-wording).
  - v2.1 backlog (non-REQ improvement ideas, from `08-validation.md`): aborted-`AgentRecord` cosmetic
    state, litellm port-4000 collision hazard, tool-use re-test against a larger local model / paid
    provider, latent `cwd`-not-per-run-workspace gap, `mkdtemp()` temp-dir cleanup, D-V2V-3
    docker/sudo environment gap (accepted).
  - **NEW this round, NOT backlog-eligible — blocking**: V3 (HIGH, agent-CLI Bash escapes the trust
    boundary to host secrets/other-run workspaces) and its close relatives V2/V4 (global-vs-per-run
    resource caps; budget-reservation collapses `parallel()` concurrency) require a Gate 6 route-back
    before this iteration can close, per the exit-gate contract ("any inconsistency reflected in the
    conclusion, may send back to Gate 2/6").

### Report (v2 Gate 8, 2026-07-04 — CURRENT / AUTHORITATIVE)
```
Gaps: high=0 mid=2 low=1 (REQ-012+TASK-018, v3-out-of-scope, recorded as known tech debt above)
Drift: none (trace.py 0 漂移 gaps; all v2 REQ/ARCH/TASK/DES/IMPL/UT chains consistently iter:v2)
Architecture consistent: no — 11 violations (1 HIGH: V3 agent-CLI Bash escapes trust boundary to host
  secrets/other-run workspaces, NEW this round; 2 MEDIUM NEW: V2 global-vs-per-run RunGuard caps, V4
  budget-reservation collapses parallel() concurrency; 8 MEDIUM/LOW carried unchanged from v1: O-2,
  C-2, V1, R-1, R-3, S-2, C-3, V5) — see table above
Validation: real-tier all-green? yes (Gate 7.5 v2 Round 2, CONVERGENCE RULE satisfied, 0 mock-only/
  未驗證 among v1/v2 in-scope REQs) · README+DEPLOY present? yes, step-by-step, updated Round 2
Conclusion: send back to Gate 6 (implementation route-back) for the 1 HIGH architecture-consistency
  finding (V3 — jail/jail-equivalent the agent CLI's fs reach, or drop Bash from the default tool set,
  or move provider-key storage off any agent-reachable path; needs an explicit new decision, not a
  silent patch, so Gate 2 should bless the chosen fix) plus its 2 closely-related MEDIUM
  consequences (V2, V4, both stemming from the same RunGuard area and cheapest fixed together via a
  coherent estimate-reserve+reconcile redesign). The 8 remaining MEDIUM/LOW findings and the 3
  pre-existing v3-out-of-scope trace gaps may be carried as known tech debt (as recorded above) if the
  team elects not to fix them this cycle, but must stay recorded rather than silently dropped.
  gates.review.passed stays false pending the Gate 6 route-back.
```

---

## v1 Gate 8 review — historical record (2026-07-03, superseded by the v2 section above)

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
