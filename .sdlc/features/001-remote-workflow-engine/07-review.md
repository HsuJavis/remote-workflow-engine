---
stage: review
status: passed
---
# 07 Review & Retro — Gate 8

## v7 GATE 8 CLOSING REVIEW (2026-07-24, CURRENT / AUTHORITATIVE)

> This section supersedes "## v6 GATE 8 CLOSING REVIEW (2026-07-19)" below (kept for history). v7
> adds provider-native SDK routing + OpenRouter first-class provider + `models_list` federated
> catalog (ARCH-025/026). REQ-037..040 / IMPL-087/088 / VAL-046..049. Gate 7.5 v7 ROUND 1 PASSED
> 2026-07-24: all four REQs real-validated against live engine (28 tools, real OPENROUTER_API_KEY);
> REQ-037 security invariant real (unit-real test); REQ-038 OpenRouter passthrough → "PONG" live;
> REQ-039 federated catalog 100 entries live; REQ-040 filter live (5 results). Anthropic-direct live
> auth: honest partial (no anthropic alias+key on this engine — not a code defect).

### 1. Traceability (398 items, 3 gaps)

`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check` — 398 items scanned, 3 gaps
detected (exit 1). Dashboard regenerated: `dashboard.html`.

V7 adds 19 traceability items (REQ-037..040, ARCH-025/026, TASK-046/047, DES-039/040, IMPL-087/088,
UT-059/060, IT-045, VAL-046..049). All chains are intact. The 3 remaining gaps are identical to v6
— all pre-existing and out-of-v7-scope:

| Sev | Type | ID | Description | Classification |
|---|---|---|---|---|
| HIGH | 未真實驗證 | REQ-012 | no real:true VAL; mock-only | OIDC deferred; accepted gap D5 |
| MID | TDD | IMPL-082 | no test item directly cites IMPL-082 | trace-label cleanup; covered in substance (IT-042/VAL-033) |
| LOW | 未實作 | TASK-018 | no corresponding implementation | OIDC deferred; accepted gap D5 |

Zero drift: all v7 ledger items (ARCH-025/026 / TASK-046/047 / DES-039/040 / IMPL-087/088 /
UT-059/060 / IT-045 / VAL-046..049) carry `iter: v7`. No IMPL/DES/UT with mismatched iter stamps
relative to their upstream within v7.

### 2. Architecture Consistency — v7 ARCH-025/026 (lean-tier self-check, QM)

No pre-run panel reports exist for the v7 scope (no `.panel/` directory). Per lean-tier rules (QM,
single-area, v7 slice), the architecture-consistency check is performed here against the v7-touched
files listed on IMPL-087/088 in 06-impl-log.md: `src/gateway/claude-agent-sdk-client.ts` (provider-
aware routing additions), `src/gateway/client.ts` (openrouter provider case), `src/gateway/
litellm-proxy.ts` (`openrouter/*` wildcard), `src/submission-validator.ts` (passthrough acceptance),
`src/main.ts` (config threading), `src/models/model-catalog.ts` (NEW), `src/server.ts` (models_list
wiring).

#### ARCH-025 — Provider-native SDK routing + OpenRouter provider (IMPL-087)

_Provider-aware routing split at SDK-session build time:_
`effectiveProvider()` (sdk-client.ts:206-208) derives the provider from the alias table for
configured aliases, or from the `openrouter/` prefix for passthrough model strings. `buildSubprocessEnv()`
(sdk-client.ts:350-367) branches on `provider === 'anthropic'`: Anthropic-direct path gets
`ANTHROPIC_BASE_URL = anthropicBaseUrl ?? 'https://api.anthropic.com'` and real auth; every other
provider (openai/openrouter/ollama/gemini/unknown) gets `ANTHROPIC_BASE_URL = config.baseUrl` (the
managed LiteLLM proxy) and the dummy key. Consistent with ARCH-025's "LiteLLM bypassed for
anthropic; translation layer preserved for everything else."

_SECURITY INVARIANT — VERIFIED GREEN:_

(a) **Real ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN in subprocess env ONLY**: `ENV_ALLOWLIST`
(sdk-client.ts:330) = `['PATH', 'HOME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM']`. Neither
`ANTHROPIC_API_KEY` nor `CLAUDE_CODE_OAUTH_TOKEN` appears in this list. The real key or oauth token
is injected only in the `provider === 'anthropic'` branch of `buildSubprocessEnv()` (lines 356-361),
directly into the SDK subprocess `options.env` field (line 557). The code comment on `buildSubprocessEnv()`
explicitly states: "The real key / oauth token is injected ONLY here, into the SDK subprocess env —
never written to the run workspace, sandbox, or any transcript (D-R2)." No log path, no workspace
write, no transcript capture reads from `envResult.env`; the env is passed directly to `options.env`.

(b) **CLAUDE_CODE_OAUTH_TOKEN NOT in ENV_ALLOWLIST**: Verified — it is absent from `ENV_ALLOWLIST`
(line 330). The code comment at line 347 states explicitly: "CLAUDE_CODE_OAUTH_TOKEN is an auth var
treated like the ANTHROPIC_* pair (deliberately NOT added to ENV_ALLOWLIST, which is for benign host
vars only)." Consistent with ARCH-025 invariant.

(c) **Missing auth → ANTHROPIC_AUTH_MISSING typed error, never a silent dummy attempt**:
`resolveAnthropicAuth()` (lines 96-108) returns `{ok:false}` when the required secret is absent for
the configured mode. `buildSubprocessEnv()` (line 358) propagates to `{ok:false, detail:'ANTHROPIC_AUTH_MISSING'}`.
`_invokeOnce()` (lines 491-494) returns a typed terminal `GatewayResult` immediately, before
`this._query()` is ever called. The dummy key (`DUMMY_API_KEY`) is assigned ONLY in the non-anthropic
branch (line 365). Consistent with ARCH-025: "required-secret-missing case is a TYPED
ANTHROPIC_AUTH_MISSING error, never a silent dummy-key run."

(d) **Passthrough models not proxy-cloaked (route-back fix)**: `isPassthroughModel()` (lines 200-202)
returns true for any `model.startsWith('openrouter/')`. In `_invokeOnce()` (lines 499-503), the
`modelName` assignment is: if `anthropicTarget` → real Anthropic id; else if `isPassthroughModel`
→ `req.opts.model` (the raw `openrouter/<id>` string, not cloaked); else `proxyModelName(...)`. The
raw string matches LiteLLM's `openrouter/*` wildcard (litellm-proxy.ts line 71: `model_name:
"openrouter/*"`). No `rwe-proxy-` prefix ever applied to a passthrough model. Consistent with
ARCH-025: "passthrough model string openrouter/<id> is NOT alias-cloaked."

_OpenRouter as first-class provider:_
- `AliasMap` type (client.ts line 9) admits `'openrouter'` as a valid provider value.
- `litellm-proxy.ts` generates the `openrouter/*` wildcard route (reads `OPENROUTER_API_KEY` from the
  proxy env, not from the subprocess env — the key stays in the LiteLLM process where it belongs).
- `submission-validator.ts` (lines 107-112): an `openrouter/<id>`-shaped model string passes the
  UNKNOWN_ALIAS check via `OPENROUTER_PASSTHROUGH` regex when `openrouterPassthrough` is true
  (default). Not rejected as an unknown alias.
- `client.ts` (lines 128-143): direct-fetch path has an explicit `openrouter` case using its own
  `OPENROUTER_API_KEY` — separate from `OPENAI_API_KEY`, no global `OPENAI_API_BASE` remap.
Consistent with ARCH-025.

_main.ts config threading:_
`composeConfig()` (main.ts lines 55-60, 183-188) threads `secretSource` (from `loadSecretSourceFromEnv()`),
`anthropicBaseUrl`, and `anthropicAuth` into `ClaudeAgentSdkGatewayConfig`. Consistent with
ARCH-025: config seams properly wired from the composition root.

**ARCH-025 architecture-consistency summary:**
- HIGH findings: 0
- MEDIUM findings: 0
- LOW findings: 0
- Security invariant: VERIFIED GREEN on all four checks (a)(b)(c)(d).

#### ARCH-026 — Model catalog (`models_list`) (IMPL-088)

_Federation from four sources:_
`buildCatalog()` (model-catalog.ts:167-186) assembles: (1) `STATIC_ANTHROPIC` + `STATIC_OPENAI`
static tables (included by default), (2) live Ollama `/api/tags` via `fetchOllama()`, (3) live
OpenRouter `/api/v1/models` via `fetchOpenRouter()`, (4) curated-alias overlay via `overlayAliases()`.
Sources run concurrently via `Promise.all`. Consistent with ARCH-026.

_Injectable fetchers (test seams):_
`BuildCatalogOptions` (lines 35-48) exposes `ollamaFetch`, `openrouterFetch`, `ollamaBaseUrl` —
all optional; defaults are the global `fetch` and the `OLLAMA_BASE_URL` env var. `ServerConfig`
(server.ts line 87) carries `modelCatalogFetchers` which are passed through to `buildCatalog()`
(server.ts lines 700-703). Consistent with ARCH-026: "injectable fetchers … tests fake the fetch
transport."

_Graceful degradation:_
`Promise.all([fetchOllama(...).catch(() => []), fetchOpenRouter(...).catch(() => [])])` (lines 178-181).
A throw/timeout/non-ok from either live source contributes zero entries while the static table and
aliases still return. Each `fetchWithTimeout()` (lines 70-78) has its own `AbortController` with
`timeoutMs` bound. The server-side builder (server.ts line 699) uses `config?.modelCatalog` (fully
injectable at the server level) — integration test IT-045 exercises this seam directly.
Consistent with ARCH-026: "degrades gracefully — an unreachable live catalog drops only its own
entries."

_Unified ModelEntry shape:_
`ModelEntry` interface (lines 10-21): `{provider, model, alias?, description, modalities:{in,out},
contextWindow, price, toolUse, location}` — all fields present, including `alias?` for the curated
overlay. All four source paths populate this shape. Consistent with ARCH-026.

_SECRET-FREE output:_
`buildCatalog()` (and `fetchOllama()` / `fetchOpenRouter()`) reads no credentials — no auth header
is set in any fetch call (OpenRouter's models list endpoint is public). No `ModelEntry` field can
hold a key value — the type itself has no such field. `OPENROUTER_API_KEY` is read only in
`litellm-proxy.ts` (proxy config generation) and `client.ts` (direct-fetch path) — not in
`model-catalog.ts`. Consistent with ARCH-026: "NO secret/API-key value ever appears in the output
(secret-separated by construction — this module reads no credentials at all)."

_Filtering (AND-filter + limit + empty-match):_
`filterCatalog()` (lines 203-224) chains all filter dimensions (`provider`, `location`, `toolUse`,
`modalityIn`, `modalityOut`, `minContext`, `maxPricePerM`, `query`) as explicit `if (filter.X !==
undefined && ...)` guards — every dimension is optional; all must pass. `limit` is capped at
`min(max(1, limit ?? 100), 500)`. An unmatched filter returns `[]`, not an error (`.slice(0, limit)`
on an empty `matched` array). Consistent with ARCH-026: "AND-filter … an empty match returns []."

_Server wiring (ARCH-001 tool surface):_
`'models_list'` in `TOOL_NAMES` (server.ts line 138). `TOOL_METADATA` entry (lines 387-417) has
description + input schema with all filter parameters. `callTool` case (lines 563-565) calls
`buildModelCatalog()` and passes `args` as `CatalogFilter`. `buildModelCatalog` is the injectable
seam (line 477): uses `config?.modelCatalog` override if provided (test path), else constructs the
real `buildCatalog()` call with the live fetchers and alias table. Consistent with ARCH-026:
"Surfaces as MCP tool models_list … ServerConfig exposes injectable catalog seams."

**ARCH-026 architecture-consistency summary:**
- HIGH findings: 0
- MEDIUM findings: 0
- LOW findings: 0
- ARCH-026 implemented exactly as specified; no deviations from decision rationale.

#### v7 architecture-consistency overall

- New HIGH findings: 0
- New MEDIUM findings: 0
- New LOW findings: 0 (DEPLOY.md doc gap recorded separately in §3 below — not an ARCH violation)
- Architecture consistent: YES. ARCH-025/026 are implemented exactly as specified. Security
  invariant: VERIFIED GREEN (all four checks pass).

### 3. Validation and Handover

Gate 7.5 v7 ROUND 1 passed (2026-07-24, `08-validation.md` §v7 ROUND 1). VAL-046..049 all
real-tier:

- VAL-046 (REQ-037): real — provider-aware routing decision + security invariant confirmed by
  `tests/unit/claude-agent-sdk-provider-aware-env.test.ts` (real unit test, no SUT-boundary mock;
  real `ClaudeAgentSdkGatewayClient` instance, actual `options.env` inspected). ANTHROPIC_API_KEY /
  CLAUDE_CODE_OAUTH_TOKEN appear only in subprocess options.env; api-key and subscription modes both
  pass; missing secret → typed ANTHROPIC_AUTH_MISSING. Non-Anthropic live path confirmed by
  REQ-038's `workflow_run` → "PONG" via OpenRouter. Anthropic-direct live auth: honest partial
  (no anthropic alias+key on this engine; routing decision is real:true).
- VAL-047 (REQ-038): real — `workflow_run` with `openrouter/nex-agi/nex-n2-pro` (passthrough id,
  not a pre-listed alias) against live engine → `result:"PONG"`. Full SDK→LiteLLM→OpenRouter chain.
  Passthrough id NOT proxy-cloaked (isPassthroughModel guard). No SUT-boundary mock.
- VAL-048 (REQ-039): real — `models_list{}` → 100 entries: `{anthropic:3, openai:3, ollama:3,
  openrouter:91}`. Live Ollama `/api/tags` + live OpenRouter `/api/v1/models` both queried at
  call time. No key/secret in any entry. No SUT-boundary mock.
- VAL-049 (REQ-040): real — `models_list{location:"remote",toolUse:true,query:"qwen",limit:5}` →
  exactly 5 entries, all matching all filters. No SUT-boundary mock.

**README.md + DEPLOY.md**: both present and step-by-step. No superseded commands or ports outside
the `## 變更紀錄` section.

**LOW finding — DEPLOY.md doc gap (OPENROUTER_API_KEY not in 設定總表)**:
`08-validation.md` §config-sync-check stated "`OPENROUTER_API_KEY` is already added to DEPLOY.md
§1 設定總表." This claim is incorrect: `OPENROUTER_API_KEY` does not appear in the LLM provider
keys table in DEPLOY.md (§1, lines ~333-338). The key IS correctly used by the implementation
(litellm-proxy.ts reads it from the proxy env; validated by the live VAL-047 "PONG" run). This is
a documentation gap only — not a code defect and not mock-only evidence. Recording as LOW backlog;
does not block v7 close (all VALs are real:true, the feature is fully validated, and the variable
name is self-documenting). The entry should be added to DEPLOY.md §1 in a follow-up pass (new row:
`OPENROUTER_API_KEY | provider:"openrouter" aliases | OpenRouter API key`).

### 4. Retro

**What went well:**

- Security-invariant design for ARCH-025 was precise and implementable: `ENV_ALLOWLIST` discipline
  + `buildSubprocessEnv()` provider-branch + typed `ANTHROPIC_AUTH_MISSING` terminal failure together
  close the three attack surfaces (credential leak to subprocess, silent dummy-key fallback, passthrough
  proxy-cloaking) without complicating the non-Anthropic path. The explicit code comment at line 347
  ("CLAUDE_CODE_OAUTH_TOKEN is an auth var treated like the ANTHROPIC_* pair — deliberately NOT
  added to ENV_ALLOWLIST") shows the invariant was held consciously, not by accident.
- The `isPassthroughModel` / `effectiveProvider` separation (sdk-client.ts lines 200-208) cleanly
  distinguishes three routing cases (anthropic-direct, passthrough, proxy-via-alias) with no if-nest
  sprawl. The passthrough route-back fix (discovered and repaired during Gate 7.5) is well-contained
  and has a regression test (UT).
- `model-catalog.ts` is a textbook injectable-fetcher module: zero global state, zero credential
  reads, `Promise.all` + `.catch(() => [])` per-source degradation, clean `ModelEntry` type. It
  was easy to test (IT-045 wires a fake fetcher; no live network needed in the test tier) and easy
  to validate live (models_list{} → 100 entries in one curl).
- Gate 7.5 real-run evidence quality: VAL-047 "PONG" from an actual OpenRouter model, VAL-048 with
  per-provider counts, VAL-049 with exact filter match — all three make the feature unmistakably
  real without ambiguity.

**To change / improve:**

- The validator's config-sync check (08-validation.md §v7 round, "already added to DEPLOY.md §1
  設定總表") was wrong — `OPENROUTER_API_KEY` was not actually added to DEPLOY.md. Gate 7.5
  validators should verify the claim by checking the file, not by asserting from memory. A single
  `grep OPENROUTER_API_KEY DEPLOY.md` would have caught this.
- The `resolveAnthropicAuth()` function resolves from three sources in a fixed priority order:
  `secretSource.resolve()` → `process.env['RWE_SECRET_*']` → `process.env['ANTHROPIC_API_KEY']`
  (plain env fallback). The plain-env fallback (`process.env['ANTHROPIC_API_KEY']`) means that if
  the operator sets a real Anthropic key as a plain env var (not via `RWE_SECRET_*`), Anthropic-direct
  routing will silently activate even without an explicit alias `provider:"anthropic"`. This is not
  a security problem (the key is read from the process env the operator controls), but it could
  cause unexpected behavior. A future iteration could require explicit opt-in.
- REQ-037's Anthropic-direct live-auth path remains untested against a real Anthropic API because
  this engine has no `anthropic` alias + key. An integration test fixture with a mocked Anthropic
  endpoint would close this gap without needing a real key; the unit coverage (VAL-046) is solid
  but live-auth is the one real-world path that has never been end-to-end exercised.

**Known tech debt (carried):**

- REQ-012 / TASK-018: OIDC auth deferred (D5). The pre-OIDC unauthenticated surface now also
  fronts the new `models_list` tool (read-only, no secret output, low risk). Existing compensations
  (ufw allowlist, loopback default bind) unchanged.
- REQ-037 Anthropic-direct live auth: honest partial accepted at Gate 7.5. Unit-covered; live path
  pending an anthropic alias + real key on a future engine.
- IMPL-082 trace-label: pre-existing, covered in substance, not a code gap.
- DEPLOY.md `OPENROUTER_API_KEY` entry: missing from §1 LLM provider keys table (LOW, see §3).

### 5. Report

```
Gaps: high=1 mid=1 low=1 (all 3 pre-existing, all recorded as backlog — REQ-012/TASK-018 OIDC D5; IMPL-082 trace-label)
Drift: none (all v7 items iter:v7)
Architecture consistent: yes (ARCH-025 security invariant VERIFIED GREEN; ARCH-026 model catalog consistent; 0 new HIGH/MID/LOW findings)
Validation: real-tier all-green? yes (VAL-046..049 all real:true) · README+DEPLOY present? yes
Backlog (not gate blockers):
  (a) REQ-037 anthropic-direct-live auth: honest partial, unit-covered, no anthropic alias+key on this engine
  (b) REQ-012/TASK-018: OIDC deferred D5; models_list now also on pre-OIDC surface (read-only, low-risk; same firewall/PAT compensation)
  (c) IMPL-082: trace-label cleanup (pre-existing, covered in substance)
  (d) LOW: OPENROUTER_API_KEY missing from DEPLOY.md §1 provider keys table (doc gap only)
Conclusion: v7 iteration closes; gates.review.passed stays true
```

---

## v6 GATE 8 CLOSING REVIEW (2026-07-19, SUPERSEDED — kept for history)

> This section supersedes "## v5 GATE 8 CLOSING REVIEW (2026-07-19)" below (kept for history). v6
> adds the issue read/reply toolset + dedup + runId enrichment (ARCH-024). REQ-031..036 /
> IMPL-086 / VAL-040..045. Gate 7.5 v6 ROUND 1 PASSED 2026-07-19: REQ-031..036 real-validated
> against the live production engine (systemd user service, 127.0.0.1:8787, 27 tools, real PAT);
> issue_get/issue_list/issue_comments/issue_comment all real; dedup (fingerprint + rwe-fp marker +
> deduped:true) real end-to-end; REQ-036 enrichment an honest partial (report path real via VAL-044,
> enrichment mechanism covered by UT-058, live path not triggered — no runId in validation reports).

### 1. Traceability (379 items, 3 gaps)

`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check` — 379 items scanned, 3 gaps
detected (exit 1). Dashboard regenerated: `dashboard.html`.

V6 adds 18 traceability items (REQ-031..036, ARCH-024, TASK-045, DES-038, IMPL-086, UT-058,
IT-044, VAL-040..045). All chains are intact. The 3 remaining gaps are identical to v5 — all
pre-existing and out-of-v6-scope:

| Sev | Type | ID | Description | Classification |
|---|---|---|---|---|
| HIGH | 未真實驗證 | REQ-012 | no real:true VAL; mock-only | OIDC deferred; accepted gap D5 |
| MID | TDD | IMPL-082 | no test item directly cites IMPL-082 | trace-label cleanup; covered in substance (IT-042/VAL-033) |
| LOW | 未實作 | TASK-018 | no corresponding implementation | OIDC deferred; accepted gap D5 |

Zero drift: all v6 ledger items (ARCH-024 / TASK-045 / DES-038 / IMPL-086 / UT-058 / IT-044 /
VAL-040..045) carry `iter: v6`. No IMPL/DES/UT with mismatched iter stamps relative to their
upstream within v6.

### 2. Architecture Consistency — v6 ARCH-024 (lean-tier self-check, QM)

No pre-run panel reports exist for the v6 scope (no `.panel/` directory). Per lean-tier rules (QM,
single-area, v6 slice), the architecture-consistency check is performed here against the v6-touched
files listed on IMPL-086 in 06-impl-log.md: `src/github/issue-reporter.ts` (v6 extensions) and
the v6-specific portions of `src/server.ts`.

**ARCH-024 (GitHub Issue Ops) — IMPL-086**

_Token ONLY from server-side SecretSource (same discipline as ARCH-023/ARCH-016):_
All four new `IssueReporter` methods (`getIssue`, `listIssues`, `getComments`, `postComment`) call
`this.resolveToken()` as their first action. `resolveToken()` reads exclusively from
`this.cfg.secretSource.resolve(TOKEN_SECRET_NAME)` — identical to the v5 path. No caller-supplied
token field exists on any of the four new operations. The composition root (server.ts line 662)
wires `loadSecretSourceFromEnv()` for the default reporter, injecting `runDiagnostics` alongside.
Consistent with ARCH-024's stated inheritance from ARCH-023 and ARCH-016.

_Envelope-not-throw typed errors (all four required codes present):_
- `ISSUE_NOT_FOUND`: returned by `getIssue` (line 394), `getComments` (line 419), and `postComment`
  (line 435) when the 404→null path is triggered at the client layer and propagated up; also by
  `postComment` when `createComment` returns null after the 404 mapping.
- `ISSUE_COMMENT_INVALID`: returned by `postComment` (line 431) when body is empty or non-string —
  before any API call is made.
- `GITHUB_TOKEN_MISSING`: returned by `resolveToken()` (line 320-321) on all four methods when the
  secret resolves to undefined or empty string.
- `GITHUB_API_ERROR`: `apiError()` (line 334-339) catches any `GithubApiError` thrown by the
  bounded client on all four paths.
- All four `callTool` cases in server.ts (lines 518-533) follow `res.ok ? {result:...} : {error:res.error}`
  — no exception crosses the tool boundary. Consistent with the envelope-not-throw invariant in
  ARCH-024.

_Bounded fetch on all new read/write methods:_
All five `GithubIssueClient` methods — including the four new ones (`getIssue`, `listIssues`,
`getComments`, `createComment`, `findOpenByFingerprint`) — use the shared `ghFetch` inner function
(lines 193-227), which applies an `AbortController` per attempt with `setTimeout(() => ctrl.abort(),
timeoutMs)` and retries only on 5xx/429/network errors (`res.status >= 500 || res.status === 429`).
Non-retryable 4xx responses are passed through immediately for the caller to interpret (404→null
or an explicit `fail()` throw). The retry budget and timeout are the same knobs (`timeoutMs`,
`retries`) shared with the v5 `createIssue` path. Consistent with ARCH-024's "same never-hang/
crash/fake-success discipline as ARCH-023."

_404→null mapping (get / comments / createComment only — correct subset):_
- `getIssue` (line 248): `if (res.status === 404) return null`
- `getComments` (line 286): `if (res.status === 404) return null`
- `createComment` (line 298): `if (res.status === 404) return null` (issue vanished between search
  and comment — handled gracefully in `report()` by falling through to createIssue)
- `listIssues` uses `ghJson` (throws on non-2xx, correct: GitHub list API returns 200+[] for empty
  and only 404s if the repo does not exist, which is a genuine error)
- `findOpenByFingerprint` uses `ghJson` (correct: GitHub search API returns 200+{items:[]} for no
  matches, never 404)
Consistent with ARCH-024's specified "404→null on get/comments/createComment."

_Dedup fingerprint + rwe-fp search:_
`issueFingerprint(title, component)` (lines 119-121) = sha256(normalizeTitle(title) + '|' +
(component ?? '')).hex().slice(0, 16). `findOpenByFingerprint(fp)` (lines 305-310) queries
`repo:X is:issue is:open in:body "rwe-fp:<fp>"` via the search API. The dedup flow in `report()`
(lines 371-382): `findOpenByFingerprint → if dup found → createComment(dup, body) → {deduped:true}`;
if `createComment` returns null (race: issue closed between search and comment), falls through to
`createIssue` with `{deduped:false}`. The hidden `<!-- rwe-fp:<fp> -->` marker is always appended
to the body by `renderIssueBody` (line 156), so every filed issue carries the search anchor.
Consistent with ARCH-024's dedup specification.

_runDiagnostics best-effort / injectable:_
`IssueReporterConfig.runDiagnostics?: (runId: string) => Promise<string | null>` (line 111) is the
injection seam. In `report()` (lines 357-360): called with `.catch(() => null)` and only when
`input.runId && this.cfg.runDiagnostics` — a null/throw never fails the report. The composition-root
`runDiagnostics` (server.ts lines 634-659) wraps the entire facade call chain in a `try/catch`
returning `null`, uses `facade.workflow_status` + `facade.workflow_artifacts` + `facade.workflow_agent_log`
(ARCH-002, same facade the MCP tools use — no bespoke data bus). Consistent with ARCH-024's
"never fails the report when the runId is unknown" and ARCH-002 dependency.

_Four new tools wired consistently:_
`TOOL_NAMES` (lines 127-130): `issue_get`, `issue_list`, `issue_comments`, `issue_comment`.
`TOOL_METADATA` (lines 340-378): each tool has a description (including all typed error codes
surfaced) and a typed `inputSchema` with `required` fields. All four `callTool` cases (lines
518-533) delegate to the corresponding `IssueReporter` method and return the typed envelope.
Consistent with ARCH-024's tool-surface specification.

_ARCH-023 report() amendment (dedup + enrichment):_
The `issue_report` callTool case (server.ts line 514-515) now exposes `deduped: res.deduped` in
the result. The `runDiagnostics` function is wired into the default `IssueReporter` constructor
at line 662. Both amendments are exactly as specified in the ARCH-023 NB note and ARCH-024.

**Implementation detail not in ARCH-024 (not a deviation):**
`listIssues` filters out pull requests from GitHub's list-issues response (`it.pull_request ===
undefined`, line 273). GitHub's list-issues API returns PRs mixed with issues; dropping them is a
necessary correctness measure invisible to callers. No architectural violation.

**v6 architecture-consistency summary:**
- New HIGH findings: 0
- New MEDIUM findings: 0
- New LOW findings: 0
- ARCH-024 is implemented exactly as specified; no deviations from the decision rationale found.
- Pre-existing security observation (pre-OIDC unauthenticated surface) extended below in backlog:
  the new write tool `issue_comment` adds a GitHub comment-write capability on the same surface.
  Compensating controls unchanged (ufw allowlist + Issues-only single-repo PAT).

### 3. Validation and Handover

Gate 7.5 v6 ROUND 1 passed (2026-07-19, `08-validation.md` §v6 ROUND 1). VAL-040..045 all real-tier:

- VAL-040 (REQ-031): real — `issue_get{number:2}` against live engine returned full IssueView
  envelope (all required fields including fingerprint marker in body); `issue_get{number:999999}` →
  `{error:{code:"ISSUE_NOT_FOUND"}}`. No SUT-boundary mock.
- VAL-041 (REQ-032): real — `issue_list{labels:["agent-reported"],state:"open",limit:10}` returned
  filtered bounded array; issue #1 (closed) absent, issue #2 (open) present. Uniform IssueSummary
  envelope confirmed.
- VAL-042 (REQ-033): real — `issue_comments{number:2}` returned the real comment (id:5013786770)
  posted by VAL-043. Fields {id, author, body, createdAt} all present; ordered array confirmed.
- VAL-043 (REQ-034): real — `issue_comment{number:2, body:"agent reply…"}` posted a genuine comment
  (id:5013786770) visible at the real GitHub URL. Empty body → `ISSUE_COMMENT_INVALID`. No mock.
- VAL-044 (REQ-035): real — dedup end-to-end: first call → `{issueNumber:2, deduped:false}`,
  fingerprint marker embedded (confirmed via VAL-040 body); second identical call → `{issueNumber:2,
  deduped:true}`. No issue #3 created. `findOpenByFingerprint → createComment` chain is real:true.
- VAL-045 (REQ-036): real (honest partial) — report path real via VAL-044; enrichment mechanism
  (runDiagnostics injected, appended to ## Linked run, null/throw-safe) confirmed by UT-058 (known-
  runId → diagnostics appended; unknown → report still filed). Live enrichment path not exercised
  (no runId in validation flows). Accepted: best-effort by design, no code defect.

trace.py reports 0 未真實驗證 for REQ-031..036. REQ-012 HIGH gap is pre-existing, accepted.

No new config keys, ports, or feature flags introduced by v6. `RWE_SECRET_GITHUB_TOKEN` follows
the existing `RWE_SECRET_<NAME>` pattern already in DEPLOY.md §1 (established in v3). No changes
to DEPLOY.md required. README.md present.

**Doc drift observation (LOW, pre-existing):** README.md line 123 states "22 個工具" but the live
engine exposes 27 tools. The discrepancy predates v6 (v3 Gate 8 set the count to 22; v4's
`workspace_purge`/`workflow_deregister`, v5's `issue_report`, and v6's four new tools each
incremented it without a README update). Not a config/command error; no deployment risk. Recorded
as LOW backlog; does not affect Gate 7.5 pass status or v6 close.

### 4. v6 Retro

**What went well:**
- ARCH-024 implemented and validated in a single Gate 7.5 pass — no route-back needed.
- Sharing the `ghFetch` bounded client across all five `GithubIssueClient` methods (createIssue +
  four new ones) means the "never-hang/crash/fake-success" discipline was not re-implemented —
  it was inherited. No new timeout/retry logic to test separately.
- The dedup mechanism (sha256 fingerprint + hidden body marker + GitHub search) is testable
  entirely through the `GithubIssueClient` interface seam, with no real API calls in unit tests.
  VAL-044 then exercised the full end-to-end path live (first call → deduped:false, second call →
  deduped:true, no issue #3 created).
- The "dup race" fallback (if `createComment` returns null — issue closed between search and
  comment, fall through to createIssue) is both tested by UT-058 and architecturally sound: it
  means the dedup path can never silently swallow a report.
- `runDiagnostics` uses the existing `McpFacade` interface rather than a new data bus — the
  enrichment data is the same shape already observable via `workflow_status/artifacts/agent_log`.
  No new subsystem, no new test surface; the composition-root function is a thin adapter.
- REQ-036 "honest partial" framing was correct: a null return from `runDiagnostics` never fails
  the report, and the enrichment mechanism is deterministically testable via injection. VAL-045
  accepted this without requiring a live runId probe.
- The PR-filter in `listIssues` (dropping items with `pull_request` field) was added defensively
  without an explicit ARCH requirement — it prevents a common GitHub API pitfall from surfacing
  as noise in a solve agent's work queue.
- Full suite (569) green; tsc clean; all 18 new traceability items connected without introducing
  new gaps.

**What to change next time:**
- The four new issue tools are exposed on the pre-OIDC unauthenticated listener, same surface as
  `issue_report`. The v5 backlog item was "rate-guard/dedup on pre-OIDC surface"; v6 compounds
  this with a write capability (`issue_comment` lets any LAN-allowlisted caller comment on the
  repo). The dedup half (REQ-035) now partially mitigates spam-by-duplicate, but a rate/volume
  guard is still open. Future work should either gate on OIDC (REQ-012, D5) or add a lightweight
  per-tool rate guard at the server layer.
- REQ-036 live enrichment was not triggered because no `runId` was available in the validation
  reports. A future validation round that runs a real `workflow_run` and then calls `issue_report`
  with the resulting `runId` would exercise this path live. A dedicated test repo (for error-path
  probes without spurious real-issue creation) would also close the "happy path only" limitation
  on live validation.
- README.md tool count has drifted to "22 個工具" across v4/v5/v6. The next iteration should
  include a README tool-count update as part of the handover checklist.

**Known tech debt (carried forward, updates noted):**
- IMPL-082 trace-label: IT-042 should cite DES-033 in its `traces:` field (LOW)
- V1: auth seam absent (MEDIUM) — no HTTP auth on engine endpoints; ufw allowlist mitigates;
  v6's `issue_comment` write capability adds to this surface (compensated by PAT scope + ufw)
- V3 residual: Bash opt-in bypass (LOW) — workspace confinement covers Read/Write; Bash requires
  explicit opt-in
- V3 LOW: SessionInitRecord.resolvedProjectRoot audit-fidelity
- V4, V5, O-2, R-1, R-3, C-2, C-3, S-2: unchanged from v2/v3 Gate 8 backlog
- REQ-012 / TASK-018 (OIDC): deferred per D5; no timeline
- v5 backlog: issue_report rate-guard on pre-OIDC surface (LOW) — **UPDATED**: REQ-035 dedup now
  partially addresses the dedup half (spam-by-duplicate is mitigated); a rate/volume guard remains
  open; `issue_comment` write capability (v6) further motivates this work
- NEW v6 backlog: `issue_comment` (and the other read tools) exposed on pre-OIDC listener; write
  capability allows any LAN-allowlisted caller to comment on the repo (LOW — compensated by ufw
  allowlist + Issues-only single-repo PAT; same surface and same mitigations as v5 issue_report)
- NEW v6 backlog: README.md tool count stale (22 documented, 27 actual) — LOW doc drift,
  pre-existing across v4/v5/v6; no deployment risk; update in next iteration

### Report

```
Gaps: high=1 mid=1 low=1 (all 3 recorded as known backlog; none in v6 scope)
  - high=1: REQ-012 (OIDC, 未真實驗證) — deferred D5, not a blocker
  - mid=1:  IMPL-082 (TDD trace-label) — covered in substance by IT-042+VAL-033; cleanup item only
  - low=1:  TASK-018 (OIDC auth middleware, 未實作) — deferred D5, not a blocker
Drift: README.md tool count 22 vs actual 27 (LOW, pre-existing across v4/v5/v6; no deployment risk)
Architecture consistent: yes — ARCH-024 fully consistent with IMPL-086;
  no new findings (HIGH/MEDIUM/LOW); token-from-SecretSource, envelope-not-throw
  (ISSUE_NOT_FOUND/ISSUE_COMMENT_INVALID/GITHUB_TOKEN_MISSING/GITHUB_API_ERROR), bounded fetch
  (shared ghFetch/AbortController/retry budget), 404→null (get/comments/createComment only),
  dedup (sha256 fingerprint + rwe-fp marker + findOpenByFingerprint search), runDiagnostics
  (best-effort/.catch/injectable/McpFacade-backed), 4 new tools wired consistently, ARCH-023
  report() amendment (deduped field + runDiagnostics wired) — all verified against source;
  pre-OIDC write surface (issue_comment) logged as LOW backlog, non-blocking
Validation: real-tier all-green? yes (VAL-040..045, 6/6 real:true; REQ-036 honest partial accepted;
           REQ-012 accepted D5) · README+DEPLOY present? yes (no v6 updates required)
Conclusion: v6 slice closes; gates.review.passed stays true;
  3 residual gaps are pre-existing accepted backlog (OIDC D5 x2 + IMPL-082 trace-label cleanup);
  2 new LOW backlog items added (issue_comment pre-OIDC write surface; README tool count drift);
  v5 rate-guard backlog updated: dedup half now partially mitigated by REQ-035
```

---

## v5 GATE 8 CLOSING REVIEW (2026-07-19, SUPERSEDED — kept for history)

> This section is superseded by "## v6 GATE 8 CLOSING REVIEW (2026-07-19)" above. v5 adds the
> `issue_report` GitHub tool (ARCH-023). REQ-027..030 / IMPL-085 / VAL-036..039. Gate 7.5 v5
> ROUND 1 PASSED 2026-07-19: issue #1 genuinely created at HsuJavis/remote-workflow-engine via the
> live engine.

### 1. Traceability (361 items, 3 gaps)

`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check` — 361 items scanned, 3 gaps
detected (exit 1). Dashboard regenerated: `dashboard.html`.

V5 adds 14 traceability items (REQ-027..030, ARCH-023, TASK-044, DES-037, IMPL-085, UT-057,
IT-043, VAL-036..039). All chains are intact. The 3 remaining gaps are identical to v4 — all
pre-existing and out-of-v5-scope:

| Sev | Type | ID | Description | Classification |
|---|---|---|---|---|
| HIGH | 未真實驗證 | REQ-012 | no real:true VAL; mock-only | OIDC deferred; accepted gap D5 |
| MID | TDD | IMPL-082 | no test item directly cites IMPL-082 | trace-label cleanup; covered in substance (IT-042/VAL-033) |
| LOW | 未實作 | TASK-018 | no corresponding implementation | OIDC deferred; accepted gap D5 |

Zero drift: all v5 ledger items (ARCH-023 / TASK-044 / DES-037 / IMPL-085 / UT-057 / IT-043 /
VAL-036..039) carry `iter: v5`. No IMPL/DES/UT with mismatched iter stamps relative to their
upstream within v5.

### 2. Architecture Consistency — v5 ARCH-023 (lean-tier self-check, QM)

No pre-run panel reports exist for the v5 scope. Per lean-tier rules (QM, single-area, v5 slice),
the architecture-consistency check is performed here against the v5-touched files listed on
IMPL-085 in 06-impl-log.md: `src/github/issue-reporter.ts` + the v5-specific portions of
`src/server.ts`.

**ARCH-023 (GitHub Issue Reporter) — IMPL-085**

_Token ONLY from server-side SecretSource (extends ARCH-016/REQ-018):_
`IssueReportInput` carries `{title, reproSteps, analysis, logs?, severity?, component?, runId?}` —
no token field; the caller can never supply one. `IssueReporter.report()` at
`src/github/issue-reporter.ts:155` resolves the token exclusively via
`this.cfg.secretSource.resolve('GITHUB_TOKEN')` — the same `SecretSource` interface used by
ARCH-016. At `src/server.ts:571` the composition-root wires `loadSecretSourceFromEnv()` which
reads `RWE_SECRET_GITHUB_TOKEN` from the parent-process environment only; the run workspace and
the untrusted sandbox have no access to this env var. The `ServerConfig.issueReporter` seam
(line 63) lets tests inject a fake reporter without touching the secret store. Consistent with
ARCH-023 and the ARCH-016 extension described in the decision rationale.

_Envelope-not-throw typed errors:_
- `ISSUE_REPORT_INVALID`: returned at lines 150-152 when any of `[title, reproSteps, analysis]`
  is missing or blank — no GitHub API call is made.
- `GITHUB_TOKEN_MISSING`: returned at lines 156-158 when the secret resolves to undefined or
  empty string — no partial/silent no-op.
- `GITHUB_API_ERROR`: `GithubApiError` (code field `'GITHUB_API_ERROR'`) thrown by the bounded
  client is caught at lines 176-181 and converted to `{ok:false,error:{code,message}}`. The code
  is extracted from the error object if present, defaulting to `'GITHUB_API_ERROR'`.
- At `src/server.ts:470-471` the `case 'issue_report'` branch returns
  `res.ok ? {result:{issueNumber,url}} : {error:res.error}` — no exception crosses the tool
  boundary. Consistent with the envelope-not-throw invariant specified in ARCH-023.

_Bounded fetch timeout + retries:_
`createGithubIssueClient` (lines 88-140) applies an `AbortController` per attempt with
`setTimeout(() => ctrl.abort(), timeoutMs)` (default 10 000 ms). The retry loop runs
`for (attempt=0; attempt<=retries; attempt++)` (default retries=1 → 2 attempts max). 4xx
responses (except 429) are thrown immediately without retry (`if (res.status < 500 && res.status !== 429) throw`),
preventing pointless retries for a structurally bad request. Timeout and network errors are
caught and re-surfaced as `GithubApiError` after the retry budget is exhausted. Consistent
with ARCH-023's bounded-fetch specification.

_Injectable client seam:_
`GithubIssueClient` interface (lines 30-32) is the abstraction boundary; `IssueReporterConfig.clientImpl?`
(line 39) lets unit tests inject a fake client that never touches the network;
`IssueReporterConfig.fetchImpl?` / `timeoutMs?` / `retries?` (lines 42-45) let the real client
be tuned or have its fetch replaced without changing production wiring. `ServerConfig.issueReporter?`
(server.ts line 63) is the composition-root seam for integration tests. Consistent with ARCH-023.

**Security observation (NOT a blocker — recorded as backlog):**
`issue_report` is exposed on the pre-OIDC unauthenticated MCP listener (port 8787). Any
LAN-allowlisted caller can create GitHub issues in the engine's own repo without authentication
at the engine layer. Current compensating controls: ufw allowlist restricts access to
`192.168.0.0/24` + SSH, and the PAT is a fine-grained token scoped to Issues-only on a single
private repository (`HsuJavis/remote-workflow-engine`). A future OIDC gate (REQ-012, deferred D5)
or a dedicated per-tool rate-guard / dedup check would tighten this surface. Logged as backlog
item below (non-blocking; V1 auth-seam gap already covers the unauthenticated-listener concern
at the feature level).

**v5 architecture-consistency summary:**
- New HIGH findings: 0
- New MEDIUM findings: 0
- New LOW findings: 0 (security observation above is a pre-existing surface inherited from V1,
  not a new gap introduced by v5)
- ARCH-023 is implemented exactly as specified; no deviations from the decision rationale found.
- All prior backlog items (V1, V3 residual, V4, V5, O-2, R-1, R-3, C-2, C-3, S-2, the v3 LOW
  SessionInitRecord audit-fidelity note, IMPL-082 trace-label) unchanged.

### 3. Validation and Handover

Gate 7.5 v5 ROUND 1 passed (2026-07-19, `08-validation.md` §v5 ROUND 1). VAL-036..039 all real-tier:

- VAL-036 (REQ-027): real — `tools/call issue_report{...}` against the live engine returned
  `{issueNumber:1, url:"https://github.com/HsuJavis/remote-workflow-engine/issues/1"}`; issue #1
  genuinely created in the private repo (externally visible on GitHub)
- VAL-037 (REQ-028): real — live call succeeded only because `RWE_SECRET_GITHUB_TOKEN` is
  configured server-side; `GITHUB_TOKEN_MISSING` path exercised by IT-043 (real HTTP POST to
  test server with no env token; 535-test suite green)
- VAL-038 (REQ-029): real — authenticated GET of issue #1 confirmed labels
  `["agent-reported","severity:low"]` and all body sections (`## Summary`, `## Reproduction steps`,
  `## Logs`, `## Analysis / root cause`, `## Environment`, `## Linked run`)
- VAL-039 (REQ-030): real — live call completed without hang/crash; error-bound paths (422
  no-retry, network error after retries, timeout → `GITHUB_API_ERROR`) confirmed by UT-057
  (injected fetch)
- REQ-012: deferred (D5); no VAL; accepted gap

trace.py reports 0 未真實驗證 for REQ-027..030. REQ-012 HIGH gap is pre-existing, accepted.
No new config keys, ports, or feature flags introduced by v5 (`RWE_SECRET_GITHUB_TOKEN` follows
the existing `RWE_SECRET_*` pattern already documented in DEPLOY.md §1 設定總表 as of v3).
README.md and DEPLOY.md present; no v5-specific updates required (fixed repo compiled in;
not user-configurable). No superseded commands or duplicated config keys.

### 4. v5 Retro

**What went well:**
- ARCH-023 (GitHub Issue Reporter) implemented and validated in a single Gate 7.5 pass — no
  route-back needed.
- The `GithubIssueClient` interface seam (injectable client) kept the unit tests entirely
  network-free while leaving the composition root wired to the real bounded client; IT-043
  threaded the seam through `ServerConfig.issueReporter` for integration coverage.
- Token isolation is end-to-end by design: `IssueReportInput` carries no token field, so it is
  structurally impossible for a caller to supply one; the SecretSource indirection ensures the
  raw PAT never appears in a tool response, a transcript, or a workspace.
- Real validation was decisive: issue #1 on GitHub is an externally visible artifact that cannot
  be produced by a stub — a higher quality bar than a logged return value.
- Body template verified externally (authenticated GET, not inferred from source), confirming
  the machine-parseable structure survives the round-trip to GitHub's storage.
- 4xx-not-retried logic is correct and tested: a 422 (invalid label, etc.) does not waste the
  retry budget on a request that cannot succeed by retrying.
- Full suite (535) green; tsc clean; all 14 new traceability items connected without introducing
  new gaps.

**What to change next time:**
- The `issue_report` tool is exposed on the pre-OIDC unauthenticated listener. Future issue-type
  tools should either wait for OIDC (REQ-012, D5) or include a lightweight per-tool rate guard
  at the server layer — filing N issues per second against a PAT is cheap for a LAN caller.
- The fixed repo (`HsuJavis/remote-workflow-engine`) is compiled into the implementation, not
  configurable. If the engine is ever redeployed under a different owner/repo, this requires a
  code change. A `githubRepo` config key in `rwe.config.json` would future-proof this, but the
  current design matches the ARCH-023 spec ("Fixed target repo") so it is not a deviation.
- `VAL-039` real error-path probe (e.g. deliberately wrong token → live `GITHUB_API_ERROR`) was
  intentionally skipped to avoid spurious issue creation. A dedicated test-repo or a mock HTTP
  intercept at the acceptance level would allow full real error-path coverage without side
  effects.

**Known tech debt (carried forward, no changes):**
- IMPL-082 trace-label: IT-042 should cite DES-033 in its `traces:` field (LOW)
- V1: auth seam absent (MEDIUM) — no HTTP auth on engine endpoints; ufw allowlist mitigates;
  `issue_report` on this surface adds a GitHub write capability — compensated by PAT scope
- V3 residual: Bash opt-in bypass (LOW) — workspace confinement covers Read/Write; Bash requires
  explicit opt-in
- V3 LOW: SessionInitRecord.resolvedProjectRoot audit-fidelity (stores workspace cwd instead of
  null on clean path)
- V4, V5, O-2, R-1, R-3, C-2, C-3, S-2: unchanged from v2/v3 Gate 8 backlog
- REQ-012 / TASK-018 (OIDC): deferred per D5; no timeline
- NEW backlog: issue_report rate-guard / dedup on the pre-OIDC surface (LOW — mitigated by PAT
  scope + ufw; follow-on to OIDC work or a standalone lightweight guard)

### Report

```
Gaps: high=1 mid=1 low=1 (all 3 recorded as known backlog; none in v5 scope)
  - high=1: REQ-012 (OIDC, 未真實驗證) — deferred D5, not a blocker
  - mid=1:  IMPL-082 (TDD trace-label) — covered in substance by IT-042+VAL-033; cleanup item only
  - low=1:  TASK-018 (OIDC auth middleware, 未實作) — deferred D5, not a blocker
Drift: none
Architecture consistent: yes — ARCH-023 fully consistent with IMPL-085;
  no new findings (HIGH/MEDIUM/LOW); token isolation, envelope-not-throw, bounded fetch,
  and injectable seam all verified against source; security observation (pre-OIDC listener
  write-capability) logged as LOW backlog, non-blocking
Validation: real-tier all-green? yes (VAL-036..039, 4/4 real:true; REQ-012 accepted D5)
           README+DEPLOY present? yes (no v5-specific updates required)
Conclusion: v5 slice closes; gates.review.passed stays true;
  3 residual gaps are pre-existing accepted backlog (OIDC D5 x2 + IMPL-082 trace-label cleanup);
  1 new LOW backlog item added (issue_report rate-guard on pre-OIDC surface)
```

---

## v4 GATE 8 CLOSING REVIEW (2026-07-19, CURRENT / AUTHORITATIVE)

> This section supersedes "## v3 GATE 8 CLOSING REVIEW (2026-07-18)" below (kept for history). v4
> adds workspace byte-transport (ARCH-020), seed-into-workspace + .claude RCE strip (ARCH-021), and
> run-workspace retention / TTL GC (ARCH-022). REQ-022..026 / IMPL-081..084 / VAL-031..035.
> REQ-022..026 requirement text was backfilled into 01-requirements.md on 2026-07-19, reconnecting
> the five previously-broken ARCH-020..022 chains. Gate 7.5 v4 ROUND 1 PASSED 2026-07-19.

### 1. Traceability (347 items, 3 gaps)

`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check` — 347 items scanned, 3 gaps
detected (exit 1). Dashboard regenerated: `dashboard.html`.

The five HIGH broken-chain gaps from v3 Gate 8 (ARCH-020..022 → missing REQ-022..026) are CLOSED:
the requirement headings were backfilled into 01-requirements.md on 2026-07-19, reconnecting all
chains. The 3 remaining gaps are pre-existing and out-of-v4-scope:

| Sev | Type | ID | Description | Classification |
|---|---|---|---|---|
| HIGH | 未真實驗證 | REQ-012 | no real:true VAL; mock-only | OIDC deferred; accepted gap D5 |
| MID | TDD | IMPL-082 | no test item directly cites IMPL-082 | trace-label cleanup; covered in substance (see §3) |
| LOW | 未實作 | TASK-018 | no corresponding implementation | OIDC deferred; accepted gap D5 |

Zero drift: no IMPL/DES/UT with mismatched `iter` stamps relative to their upstream within v4.

**IMPL-082 detailed assessment**: The trace tool flags IMPL-082 (readBody body cap, `src/server.ts:315-335,
620, 669-671`) as a TDD-ordering gap because no test item's `traces:` field directly references
IMPL-082 or DES-033. However, IT-042 (`tests/integration/v15-v2-workspace-transport.test.ts`)
explicitly includes a body-cap test at line 75 (`REQ-024: an over-cap request body is rejected with
413, not buffered/OOMed`) and IT-042 traces to ARCH-020, whose note explicitly lists "server.ts
readBody body-size cap (413)" as part of its scope. VAL-033 provides additional real-run evidence
(30 MB POST → 413 on the live engine). **Assessment: trace-label cleanup item — the code is covered
in substance by IT-042 and VAL-033. IT-042 should add DES-033 to its traces field to close the
formal chain. Not a genuine uncovered-code gap. Not a blocker for this iteration.**

### 2. Architecture Consistency — v4 ARCH-020..022 (lean-tier self-check, QM)

No pre-run panel reports exist for the v4 scope (no new `.panel/review/*.md`). Per lean-tier rules
(QM, single-area, v4 slice), the architecture-consistency check is performed here against the
v4-touched files listed on each IMPL in 06-impl-log.md.

**ARCH-020 (Workspace byte-transport) — IMPL-081, IMPL-082**
`src/workspace-artifacts.ts`: `listArtifacts(workspace)` recursively walks the workspace directory,
applying `isPathContained` (realpath-based) per entry — symlink escapes skipped, not silently
included. `.git` directories are excluded at any depth (engine seed baseline, not client deliverable).
Each regular file gets `{path, size, sha256}` with workspace-relative forward-slash paths.
`readArtifactChunk(workspace, relPath, offset, length, maxChunk=1MiB)` applies `isPathContained`
before any file open — a path escaping via `../` or symlink returns `{error:'PATH_OUTSIDE_WORKSPACE'}`
with no bytes read. Positioned read (openSync/readSync at offset) so large files are never fully
buffered for a windowed read. `src/server.ts:315-335`: `readBody(req, maxBytes=8MiB)` accumulates
chunks into a buffer, calling `reject(new BodyTooLargeError(maxBytes))` as soon as accumulated
length exceeds the cap — the socket continues draining (no back-pressure hang) and the caller sends
413. Consistent with ARCH-020.

**ARCH-021 (Seed-into-workspace) — IMPL-083**
`src/workspace-seed.ts`: `materializeSeed(workspace, seed[])` applies `isPathContained` before every
write (path-escape → `rejected[]`) and checks `.git` internals (`/.git/` or `/.git` suffix →
`rejected[]`). `STRIP_RE = /(^|\/)\.claude\/(settings[^/]*\.json|hooks\/.*)$/` matches
`.claude/settings.json`, `.claude/settings.local.json`, and `.claude/hooks/**` at any nesting depth
— stripped entries go to `stripped[]` and are never written. `.claude/CLAUDE.md` and
`.claude/skills/**` are explicitly NOT stripped (inert data / intended materialization surface).
Seed materialization is called from `RunManager` before `_runLive` (pre-agent, replay-safe).
Consistent with ARCH-021 (closes DES-028 hook-gate for the seed path).

**ARCH-022 (Run-workspace retention) — IMPL-084**
`src/workspace-gc.ts`: `reclaimStaleWorkspaces(workRoot, ttlMs, statusOf, nowMs)` only deletes a
workspace when `statusOf(runId)` returns a TERMINAL status (`stopped|completed|failed`) AND the
directory mtime is older than the TTL. A `null` status (store miss / unknown) or non-TERMINAL status
is treated as keep — never deletes an active/suspended/queued run. `statusOf` and `nowMs` are
injected (unit-testable without wall-clock). `src/mcp-facade.ts:188-192`: `workspace_purge` checks
`stored.status` against TERMINAL states before deleting — returns `RUN_NOT_TERMINAL` error for
active/suspended runs. `src/server.ts:572-581`: GC ticker only started when
`config.workspaceTtlMs > 0` (opt-in; default = no auto-GC); cleared on server shutdown (line 694).
Consistent with ARCH-022.

**v4 architecture-consistency summary:**
- New HIGH findings: 0
- New MEDIUM findings: 0
- New LOW findings: 0
- All three ARCH-020..022 modules are implemented exactly as specified; no deviations found.
- No amendments to prior backlog items: V1, V3 residual, V4, V5, O-2, R-1, R-3, C-2, C-3, S-2,
  and the v3 LOW SessionInitRecord audit-fidelity note are unchanged.

### 3. Validation and Handover

Gate 7.5 v4 ROUND 1 passed (2026-07-19, `08-validation.md` §v4 ROUND 1). VAL-031..035 all real-tier:

- VAL-031 (REQ-022): real — `workflow_artifacts` returned `sub/a.txt` with sha256 and nested path;
  `.claude/hooks/evil.sh` absent (stripped, confirming VAL-034 / ARCH-021 wiring)
- VAL-032 (REQ-023): real — windowed read returns first 5 bytes in base64; path-escape
  `../../../../etc/passwd` returns `PATH_OUTSIDE_WORKSPACE` error, no bytes leaked
- VAL-033 (REQ-024): real — 30 MB body → HTTP 413 on live engine, no OOM/buffering
- VAL-034 (REQ-025): real — `.claude/hooks/evil.sh` seed entry stripped; `sub/a.txt` materialized
  and readable (byte-verified via VAL-032)
- VAL-035 (REQ-026): real — completed-run purge returns `{purged:true}`; post-purge `workflow_artifacts`
  returns `[]`; active-run refusal exercised by IT-042 (`RUN_NOT_TERMINAL` assert, green in 522-test
  suite)
- REQ-012: deferred (D5); no VAL; accepted gap

trace.py reports 0 未真實驗證 for REQ-022..026. REQ-012 HIGH gap is pre-existing, accepted.
No new config keys, env vars, ports, or feature flags introduced by v4 (confirmed at Gate 7.5 v4
ROUND 1). README.md and DEPLOY.md present; no new entries required for v4; no superseded commands or
duplicated config keys.

### 4. v4 Retro

**What went well:**
- All three ARCH-020..022 modules (workspace byte-transport, seed materialization + .claude strip,
  workspace retention / TTL GC) implemented and validated in one Gate 7.5 pass without a route-back.
- The `.git` directory exclusion in `listArtifacts` (skips the engine's own seed baseline) was added
  proactively, closing a correctness gap that would have surfaced `.git` internals as client-pullable
  artifacts — caught during implementation, not at review.
- Realpath-based containment (`isPathContained`) applied consistently across all three path-sensitive
  surfaces (list, read, write) — no lexical-only path check left.
- Gate 7.5 real probes are fully deterministic (seed-based, no model execution needed); all five REQs
  verified against the live production engine without modifying or restarting it.
- Backfilling REQ-022..026 requirement text into 01-requirements.md closed five HIGH broken chains
  in a single edit, consistent with the v3 retro recommendation ("REQ text committed before ARCH").
- 522 tests all green; IMPL-082 body-cap coverage confirmed present in IT-042 (body-cap 413 test at
  line 75 of v15-v2-workspace-transport.test.ts).

**What to change next time:**
- IMPL-082's DES-033 trace is not linked from any test item's `traces:` field — IT-042 covers the
  behavior but omits the formal link. Add DES-033 to IT-042's traces as a follow-up trace-label
  cleanup (low priority, no correctness risk).
- Seed write in `materializeSeed` uses `writeFileSync(abs, Buffer.from(f.contentB64 ?? '', 'base64'))`
  which silently writes a zero-byte file if contentB64 is malformed base64. A future iteration could
  add a base64 validation guard (reject rather than silently materialize garbage).

**Known tech debt (carried forward):**
- IMPL-082 trace-label: IT-042 should cite DES-033 in its `traces:` field (trace-label cleanup; LOW)
- V1: auth seam absent (MEDIUM) — no HTTP auth on engine endpoints; host firewall mitigation
- V3 residual: Bash opt-in bypass (LOW) — workspace confinement covers Read/Write via realpath
  callback; Bash requires explicit opt-in but is not blocked
- V3 LOW: SessionInitRecord.resolvedProjectRoot audit-fidelity (stores workspace cwd instead of null
  on clean path)
- V4, V5, O-2, R-1, R-3, C-2, C-3, S-2: unchanged from v2/v3 Gate 8 backlog (see sections below)
- REQ-012 / TASK-018 (OIDC): deferred per D5; no timeline

### Report

```
Gaps: high=1 mid=1 low=1 (all 3 recorded as known backlog; none in v4 scope)
  - high=1: REQ-012 (OIDC, 未真實驗證) — deferred D5, not a blocker
  - mid=1:  IMPL-082 (TDD trace-label) — covered in substance by IT-042+VAL-033; cleanup item only
  - low=1:  TASK-018 (OIDC auth middleware, 未實作) — deferred D5, not a blocker
Drift: none
Architecture consistent: yes — ARCH-020..022 fully consistent with IMPL-081..084;
  no new findings (HIGH/MEDIUM/LOW); all v4 path-sensitive surfaces use realpath containment;
  10 prior backlog items unchanged
Validation: real-tier all-green? yes (VAL-031..035, 5/5 real:true; REQ-012 accepted D5)
           README+DEPLOY present? yes (no v4-specific updates required)
Conclusion: v4 slice closes; gates.review.passed stays true;
  3 residual gaps are pre-existing accepted backlog (OIDC D5 x2 + IMPL-082 trace-label cleanup)
```

---

## v3 GATE 8 CLOSING REVIEW (2026-07-18, CURRENT / AUTHORITATIVE)

> This section supersedes "## v2 GATE 8 FINAL CLOSING REVIEW (2026-07-04 22:40)" below (kept for
> history). v3 adds MCP-by-name provisioning (ARCH-015), server-side secrets (ARCH-016), SDK
> session-options builder + timeout race (ARCH-017), asset-ingestion policy (ARCH-018), and workRoot
> project-isolation guard (ARCH-019). REQ-016..021 / IMPL-068..080 / VAL-025..030.

### 1. Traceability (337 items, 8 gaps)

`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check` — 337 items scanned, 8 gaps
detected (exit 1 expected). Dashboard regenerated: `dashboard.html`.

All 8 gaps are pre-existing or out-of-v3-scope; none introduced by v3 IMPL-068..080:

| Sev | Type | ID | Description | Classification |
|---|---|---|---|---|
| HIGH | 斷鏈 | ARCH-020 | traces to non-existent REQ-022 | v4 chain — REQ text never written |
| HIGH | 斷鏈 | ARCH-020 | traces to non-existent REQ-023 | v4 chain — REQ text never written |
| HIGH | 斷鏈 | ARCH-020 | traces to non-existent REQ-024 | v4 chain — REQ text never written |
| HIGH | 斷鏈 | ARCH-021 | traces to non-existent REQ-025 | v4 chain — REQ text never written |
| HIGH | 斷鏈 | ARCH-022 | traces to non-existent REQ-026 | v4 chain — REQ text never written |
| HIGH | 未真實驗證 | REQ-012 | mock-only, no real:true VAL | OIDC deferred; accepted gap D5 |
| MID | TDD | IMPL-082 | no test coverage | v4 IMPL — backlog |
| LOW | 未實作 | TASK-018 | no corresponding implementation | OIDC deferred; accepted gap D5 |

Top v4 backlog item: **backfill REQ-022..026 requirement text + close v4 Gate 7.5/8** (closes 5 HIGH
broken chains and 1 MID TDD gap for IMPL-082). REQ-012 and TASK-018 remain under decision D5 (OIDC
deferred, no timeline set). Zero drift: no IMPL/DES/UT with mismatched `iter` stamps relative to their
upstream within v3.

### 2. Architecture Consistency — v3 ARCH-015..019 (lean-tier self-check, QM)

The existing `.panel/review/adversarial.md` and `.panel/review/quality-dimensions.md` cover
IMPL-001..066 (v2 baseline) only and are not applicable to the v3 scope. Per lean-tier rules (QM,
single-area, v3 slice), the architecture-consistency check is performed here against the v3-touched
files listed on each IMPL in 06-impl-log.md.

**ARCH-015 (MCP Provisioning Registry) — IMPL-068, IMPL-073**
`src/mcp-registry.ts`: SQLite-backed, probe-gated `register()` (returns `MCP_PROBE_FAILED` on failed
probe), strict `resolveInjected(referencedNames)` returning `{error:'MCP_NOT_PROVISIONED'}` on first
unknown name. Host ambient MCP never inherited (only explicitly referenced names returned). Consistent
with ARCH-015.

**ARCH-016 (Secret Store + Resolver) — IMPL-069, IMPL-074, IMPL-079**
`src/secret-resolver.ts`: atomic all-or-nothing `resolveConfig()`, typed errors `SECRET_MISSING` /
`SECRET_HANDLE_INVALID`, `redact()` baked in for transcript/dashboard sanitisation. `src/path-
containment.ts`: `isPathContained()` uses `safeRealpath` (realpathSync with lexical fallback) —
symlink-safe. Consistent with ARCH-016.
Note: IMPL-079 closes the symlink escape from v2 adversarial finding V3 (realpath-based callback
replaces prior lexical-resolve check). Bash opt-in bypass and non-`file_path` tools remain outside the
realpath callback scope (carried residual — see V3 status update below).

**ARCH-017 (SDK Session-Options Builder + outer timeout race) — IMPL-070, IMPL-072, IMPL-075**
`src/session-options-builder.ts`: pure builder (no fs/net/process direct imports), `thinkingMode =
'disabled'` for non-Anthropic (D-F6), `settingSources:['project']` hardcoded — never 'user' or
'local' (R9), DES-031 session-init re-walk calls `findProjectMarkerAncestor(cwd, workRoot)` and
returns `{ok:false, error:'WORKROOT_INSIDE_PROJECT'}` if hit. `src/timeout-race.ts`:
`raceWithTimeout` calls `opts.kill()` on timeout (D-KILL, not bare abandon), wrapped in
`semaphore.withSlot()` for slot accounting, returns `FailureEnvelope{kind,attempts,elapsedMs}`.
Consistent with ARCH-017.
LOW observation: `resolvedProjectRoot: config.cwd` at `session-options-builder.ts:115` — in the
nominal clean path (no WORKROOT_INSIDE_PROJECT hit) there is no project root; the field should be null
rather than the run-workspace cwd. The field is typed `string | null` but always receives `config.cwd`,
conflating workspace path with project root in the audit record. Not a security issue; a low
audit-fidelity concern.
V2 finding CLOSED: `src/server.ts:525` creates `agentSemaphore = createSemaphore(config?.agentSlots ??
32)` at the composition root, injected into `RunManager` and from there into each call's semaphore
slot. Per-run `RunGuard` handles budget accounting; the process-global semaphore bounds concurrent host
spawns. D-DOS wired correctly; V2 MEDIUM is closed.

**ARCH-018 (Asset-Ingestion Policy) — IMPL-077, IMPL-078**
`src/asset-sync.ts`: `classifyAsset()` — `hook → {action:'reject', code:'HOOKS_UNSUPPORTED'}`,
`mcp-config → {action:'redirect-to-provisioning'}`, `skill/other → {action:'materialize'}`. Wired
into the `asset_push` endpoint. Consistent with ARCH-018.

**ARCH-019 (WorkRoot Project-Isolation Guard) — IMPL-080**
`src/workroot-guard.ts`: `WorkRootInsideProjectError {code:'WORKROOT_INSIDE_PROJECT', ancestor, marker,
remedy}`, `assertWorkRootIsolated()` walks all ancestors to the filesystem root (boot-time check),
`findProjectMarkerAncestor()` uses `realpathImpl` first (symlink-safe), walks from resolved path to
`stopAt` exclusive, checks both `.git` and `CLAUDE.md`. Session-init re-walk wired in
`buildSessionOptions()`. Consistent with ARCH-019.

**v3 architecture-consistency summary:**
- New HIGH findings: 0
- New MEDIUM findings: 0 (V2 CLOSED; V3 Bash residual downgraded — see below)
- New LOW findings: 1 (SessionInitRecord.resolvedProjectRoot audit-fidelity, noted above)

v2-era backlog item status after v3 review:
- V2 (global-vs-per-run RunGuard, MEDIUM): CLOSED — AgentSemaphore wired process-global at composition root (server.ts:525)
- V3 (Bash opt-in/symlink bypass, MEDIUM): PARTIALLY CLOSED — symlink escape fixed by IMPL-079 realpath; Bash opt-in bypass remains, downgraded to LOW (Bash is off-by-default; enabling requires explicit BUILT_IN_CORE_TOOLS extension, a deliberate operator choice not an oversight)
- V1, V4, V5, O-2, R-1, R-3, C-2, C-3, S-2: unchanged (see v2 GATE 8 section for detail)

Remaining open backlog items: 10 (V2 closed; V3 reduced to LOW residual; 9 others unchanged).

### 3. Validation and Handover

Gate 7.5 v3 ROUND 1 passed (2026-07-18, `08-validation.md` §v3 ROUND 1). VAL-025..030 all real-tier:

- VAL-025 (REQ-016): real — SDK gateway executes end-to-end; D-F11 capability gap (qwen2.5:7b
  does not emit native tool_use) accepted
- VAL-026 (REQ-017): real — MCP_NOT_PROVISIONED error path; provision probe (real HTTP HEAD to live
  engine); DB handle confirmed present
- VAL-027 (REQ-018): real — SECRET_MISSING error; DB stores handle not value; workspace-clean grep
  produced no output
- VAL-028 (REQ-019): real — HOOKS_UNSUPPORTED returned; nothing written to workspace
- VAL-029 (REQ-020): real — `val-023` test 2/2 pass in 7.76s with real fault-injected HTTP server +
  real `ClaudeAgentSdkGatewayClient`
- VAL-030 (REQ-021): real — WORKROOT_INSIDE_PROJECT exit=1 on nested path; clean boot reaches ready
  (exit 124 = SIGTERM kill by timeout, not error)
- REQ-012: deferred (D5); no VAL; accepted gap

trace.py reports 0 未真實驗證 for REQ-016..021. REQ-012 HIGH gap is pre-existing, accepted.
Config-key sync: no new required config keys introduced by v3 (verified at Gate 7.5).
README.md (407 lines) and DEPLOY.md (835 lines) present; content verified at Gate 7.5 as step-by-step
current-state. No superseded commands or duplicated config keys found.

### 4. v3 Retro

**What went well:**
- All 5 ARCH-015..019 modules (MCP registry, secret resolver, session options builder, asset-ingestion
  policy, workRoot guard) implemented and validated in one gate cycle without a route-back.
- DES-031 (session-init re-walk for intra-run marker injection) was discovered and closed during test
  writing inside the same iteration rather than slipping to a follow-up.
- D-F6 (thinking-disabled for non-Anthropic) fixed a real 400 regression caught by the qwen2.5:7b
  spike before any v3 code was written — spike-then-design sequence worked.
- D-KILL (kill subprocess on timeout, not bare abandon) produces a deterministic `FailureEnvelope`
  instead of a silently-hung slot — better observability than the v1/v2 era.
- D-DOS global AgentSemaphore wired at composition root (server.ts:525) closes V2 (the per-run vs.
  process-global RunGuard gap from v2 Gate 8 backlog) — confirmed by reading the wiring, not by
  inference from the design docs.
- IMPL-079 realpath-based path containment closes the symlink escape in the workspace confinement
  callback (V3 MEDIUM → LOW residual Bash opt-in only).
- Gate 7.5 round 1 passed without a repeat round; all 6 v3 REQs real-verified in a single pass.

**What to change next time:**
- REQ-022..026 were built opportunistically alongside v3 without writing requirement headings into
  01-requirements.md first. Five HIGH broken chains resulted. Enforce: REQ text committed to
  01-requirements.md before ARCH is created, even for exploratory slices.
- IMPL-082 (v4) has no test coverage — the TDD discipline broke for the opportunistic v4 slice.
  Enforce Gate 5 test-first before any IMPL is committed.
- Future slices should complete their own gate sequence before building the next. Building v4 ARCH/IMPL
  alongside v3 created debt that now requires a dedicated v4 Gate 1.5–8 backfill.

**Known tech debt (v4 backlog):**
- TOP: backfill REQ-022..026 requirement text + close v4 Gate 7.5/8 (closes 5 HIGH broken chains,
  1 MID TDD gap IMPL-082)
- V1: auth seam absent (MEDIUM) — no HTTP auth on engine endpoints; host firewall mitigation (ufw
  192.168.0.0/24)
- V3 residual: Bash opt-in bypass (LOW) — workspace confinement covers Read/Write via realpath
  callback; Bash requires explicit opt-in but is not blocked
- NEW LOW: SessionInitRecord.resolvedProjectRoot audit-fidelity (always stores workspace cwd, not
  actual project root; should be null in the nominal clean path)
- V4, V5, O-2, R-1, R-3, C-2, C-3, S-2: unchanged from v2 Gate 8 backlog (see section below)
- REQ-012 (OIDC): deferred per D5; no timeline

### Report

```
Gaps: high=6 mid=1 low=1 (all 8 recorded as known tech debt; none in v3 scope)
Drift: none
Architecture consistent: yes — ARCH-015..019 fully consistent with IMPL-068..080;
  V2 finding CLOSED (D-DOS global semaphore at composition root);
  V3 finding partially closed (symlink escape fixed by IMPL-079; Bash opt-in → LOW);
  10 backlog items remain (was 11)
Validation: real-tier all-green? yes (VAL-025..030, 6/6 real:true or accepted D5)
           README+DEPLOY present? yes (README.md 407L, DEPLOY.md 835L)
Conclusion: v3 iteration can close; gates.review.passed stays true;
  v4 chain-backfill (REQ-022..026 requirement text + Gate 7.5/8) is the top backlog item
```

---

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
