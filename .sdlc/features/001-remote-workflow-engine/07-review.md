---
stage: review
status: closed
---
# 07 Review & Retro — Gate 8

## v18 GATE 8 REVIEW (2026-08-18, CURRENT / AUTHORITATIVE — ITERATION CAN CLOSE)

> This section supersedes "## v17 GATE 8 REVIEW (2026-08-18)" below (kept for history).
> **v18 fix-mode iteration — Google OAuth 3-endpoint real-consent fix (REQ-012 v18, ARCH-059 v18).**
> Impact closure: REQ-012, ARCH-059, DES-094, DES-095, IMPL-122, IT-078, TASK-092 — iter v18.
> No new high/severe gaps, no new broken chains, no arch violations for v18-scoped changes.

### Traceability consistency (v18)

Trace `--check` result (regenerated 2026-08-18): **753 items, 11 gaps.**

Change from v17 baseline (752 items / 9 gaps):

- **1 new item:** TASK-092 added (traces ARCH-059, DES-094/095, IMPL-122).
- **2 new LOW iter-drift gaps (TDD wavefront):** DES-092 (v17) and DES-093 (v17) both lag behind IMPL-122 (v18). These design items were not bumped because the v18 URL-injection fix is outside their metadata/token-store scope; IMPL-122 was bumped as the single impl item covering the whole auth subsystem. Cosmetic — no production code gap.
- **UT-095 drift widened:** was "v16 behind DES-095 v17," now "v16 behind DES-095 v18" — same gap item, severity unchanged (LOW). `resolvePrincipal` is unchanged in v18.
- **No new broken links, no new orphans, 0 未驗證, 0 未真實驗證, 0 high-severity gaps introduced by v18.**

| ID | Severity | Type | Note |
|----|----------|------|------|
| IMPL-082 | MID | TDD label drift | Pre-existing since v4; no change |
| UT-058 | LOW | iter drift v6 behind DES-038 v11 | Pre-existing since F1; cosmetic |
| UT-064 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| IT-057 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| UT-092 | LOW | iter drift v15 behind DES-092 v17 | Pre-existing from v17 |
| UT-093 | LOW | iter drift v16 behind DES-093 v17 | Pre-existing from v17 |
| UT-095 | LOW | iter v16 behind DES-095 v18 | Widened (same gap, DES-095 bumped v18; resolvePrincipal unchanged in v18 — cosmetic) |
| DES-092 | LOW | iter drift v17 behind IMPL-122 v18 | New TDD-wavefront drift; DES-092 scope (metadata) unchanged by v18 — cosmetic |
| DES-093 | LOW | iter drift v17 behind IMPL-122 v18 | New TDD-wavefront drift; DES-093 scope (token-store) unchanged by v18 — cosmetic |
| DES-088 | LOW | iter drift v14 behind IMPL-127 v15 | Pre-existing from v15 |
| TASK-018 | LOW | no implementation | OIDC task; functionally superseded by v15+v17+v18 OAuth implementation |

Dashboard confirms: 0 severe gaps, 0 未驗證 requirements, 0 mock-only validations. All 11 remaining gaps are recorded as known tech debt (Exit Gate 1 satisfied).

### Architecture consistency (v18 self-check — lean QM fix, no panel)

Fix scope: `src/auth/auth-service.ts`, `src/auth/google-verifier.ts`, `src/server.ts`, `vitest.config.ts`. Checked against ARCH-059 v18 (the only ARCH decision touched by v18).

**ARCH-059 v18 — Google 3-endpoint URL injection:**

Architecture text (ARCH-059 v18 excerpt): "three separately-injectable URL fields (`googleAuthorizeUrl`/`googleTokenUrl`/`googleJwksUrl`), each defaulting to its correct production host via an exported named constant; a static UT regression guard pins the two previously-wrong production defaults (token + JWKS); the `google-verifier.ts` deps drop the misnamed `googleBase` for a full `jwksUri` (host-agnostic). No new module, no new route, no config-schema change (the three URLs are test-injectable overrides with production defaults; production config is unchanged)."

Implementation checks:

1. **Exported named constants** (`src/auth/auth-service.ts:9-13`): `GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'`, `GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'`, `GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'` — three distinct production hosts, each an exported named constant. **Matches.**
2. **Separately-injectable fields** (`src/auth/auth-service.ts:28-32`): `AuthConfig.googleAuthorizeUrl?`, `googleTokenUrl?`, `googleJwksUrl?` with 3-way priority resolution (new field > `googleBase`-derived backward-compat fallback > production constant). **Matches injectable override semantics.**
3. **google-verifier.ts rename** (`src/auth/google-verifier.ts:8,16,76`): `JwksPort` type parameter `googleBase→jwksUri`; deps field `jwksUri: string`; call `deps.jwksFetch(deps.jwksUri)`. **Matches "drops misnamed googleBase for full jwksUri (host-agnostic)."**
4. **Static UT regression guard** (UT-094 via `vitest.config.ts`, pinning `GOOGLE_TOKEN_URL`/`GOOGLE_JWKS_URL` constants against wrong defaults). Per DES-095 per-tier policy, unit is the only tier that can catch the fake-double-collapses-hosts class. **Matches.**
5. **No new module, no new route:** `src/server.ts:149` comment updated (terminology only); no route additions. **Matches.**

**Documented deviation (design-level, not arch violation):** DES-095 v18 states `googleBase` is dropped. The implementation retains `googleBase` as `/** @deprecated */` with backward-compat fallback resolution (`src/auth/auth-service.ts:25-26, 124-130`). Documented in IMPL-122 v18 note: VAL-096/097 (v15 fixtures outside F3 closure scope) reference `googleBase`; removal deferred to fixture migration. No production behavior change (fallback only activates when all three new fields are absent AND `googleBase` is explicitly set, which production config never does).

**LOW-5 text-amendment recommendation (new):** ARCH-059 v18 prose says "no config-schema change." The `AuthConfig` TypeScript interface gained 3 new optional fields (`googleAuthorizeUrl?`, `googleTokenUrl?`, `googleJwksUrl?`) and 1 deprecated field (`googleBase?`), with 4 new rows in DEPLOY.md §1 設定総表. The implementation intent is correct ("production config unchanged" — existing configs work without modification). Recommend amending ARCH-059 v18 text to "no breaking config change (3 new optional test-injectable fields + 1 deprecated)". No code gap; LOW doc-debt identical treatment to LOW-4.

**Verdict for v18-touched code: architecture CONSISTENT with ARCH-059 v18.**

Pre-existing violations (UNCHANGED from v17 review — not re-litigated here), plus LOW-5:

| Label | Severity | Finding | Status |
|-------|----------|---------|--------|
| H-2 | HIGH | ARCH-017/D-PROFILE/DES-031 session-options-builder orphaned | Gate 2 adjudication pending (security-hardening iter) |
| H-3 | HIGH | D-KILL/D-PROC cli-lifecycle + timeout-race dead code | Gate 2 adjudication pending |
| M-1 | MED | LiteLLMGatewayClient transcript opaque | Pre-existing, separately tracked |
| L-1 | LOW | McpRegistry wall-clock direct Date.now | Pre-existing |
| L-2 | LOW | materializeAssets hook arm not removed | Pre-existing |
| LOW-3 | LOW | client-echoable principal on null-edge path | Pre-existing; restrict to test seam when convenient |
| LOW-4 | LOW | ARCH-059 inv.3 text: state TTL 600 s vs. "≤60 s" | Recommend text amendment to "state ≤10 min / codes ≤60 s" |
| LOW-5 | LOW | ARCH-059 v18 text: "no config-schema change" vs. 3 new optional AuthConfig fields + 1 deprecated | Recommend text amendment to "no breaking config change (3 new optional test-injectable fields + 1 deprecated)" |

**Architecture consistency overall: v18-scoped changes are consistent with ARCH-059 v18. Pre-existing H-2/H-3 remain outstanding on their own adjudication track. One new LOW-5 text-amendment recommended. No new violations.**

### Validation & handover check (v18)

- **VAL-095 (REQ-012, v18):** `real:true`, green, iter v18 (in `08-validation.md`, which is authoritative; `05-tests.md` carries `real:false` automated entry — trace reports 0 未真實驗證, consistent with the established pattern). 9/9 acceptance cases pass: case 3 — `/oauth/google/callback` token exchange hits injected `googleTokenUrl` (distinct host from dead `googleBase`); case 4 — JWKS fetch hits injected `googleJwksUrl`; 7 pre-existing cases green.
- **Live evidence (Gate 7.5):** IT-078 29/29 — case 19: `/authorize` Location origin = `googleAuthorizeUrl`; case 20: callback exchanges code at `googleTokenUrl` on distinct port. UT-094 15/15 static-pin guard passes. Real Google hosts confirmed: `GET https://www.googleapis.com/oauth2/v3/certs → 200 + 4 RSA keys`; `POST https://oauth2.googleapis.com/token bogus → invalid_client` (not 404); `/authorize → Location: https://accounts.google.com/o/oauth2/v2/auth?...`. Composition-root wiring confirmed (scratch config `googleAuthorizeUrl:127.0.0.1:59099`).
- **Full suite:** 1348/1348 pass (233 files; zero regression against 1342/1342 pre-v18 baseline).
- **No mock-only/unverified REQ for any v18-touched item.**
- **`08-validation.md`:** present, v18 Gate 7.5 PASSED section written (2026-08-18).
- **`README.md`:** present. Current-state v18. Three-endpoint separation documented. No stale commands.
- **`DEPLOY.md`:** present. Current-state v18. §1 設定総表 has 4 new rows (`auth.googleAuthorizeUrl`, `auth.googleTokenUrl`, `auth.googleJwksUrl`, `auth.googleBase` [deprecated]). §変更紀錄 has v18 entry. No superseded instructions outside §変更紀錄. Config keys deduplicated.
- **Unreachable dep (carry-forward):** interactive browser Google consent flow — headless-unreachable (pre-existing, classified `unreachable-dep`, no code gap).
- **Validation verdict: Gate 7.5 v18 PASSED. VAL-095 v18 real:true. 1348/1348 pass. README + DEPLOY present, current-state. No mock-only/unverified REQ.**

### Retro (v18 — Google OAuth 3-endpoint real-consent fix)

**What changed (IMPL-122 v18, TASK-092):**

- `src/auth/auth-service.ts`: exported `GOOGLE_AUTHORIZE_URL`/`GOOGLE_TOKEN_URL`/`GOOGLE_JWKS_URL` named constants (3 correct production hosts); added `AuthConfig.googleAuthorizeUrl?`/`googleTokenUrl?`/`googleJwksUrl?` optional fields with `/** @deprecated */ googleBase?` retained for backward compat; `createAuthRouteHandlers` resolves each URL via 3-way priority (explicit field > `googleBase`-derived fallback > production constant); passes `jwksUri: googleJwksUrl` to `verifyIdToken` deps.
- `src/auth/google-verifier.ts`: renamed `VerifyIdTokenDeps.googleBase` → `jwksUri`; `JwksPort` parameter `googleBase→jwksUri`; call site `deps.jwksFetch(deps.jwksUri)`.
- `src/server.ts`: line 149 comment updated to new field names.
- `vitest.config.ts`: static UT regression guard pinning `GOOGLE_TOKEN_URL` and `GOOGLE_JWKS_URL` constants to their correct production values.

**What went well:**

- The per-tier testing policy in DES-095 v18 (unit = only tier that can detect fake-double-collapses-hosts) was precise and decisive: once the right tests existed, the root cause was immediately visible and non-ambiguous.
- 3-way priority resolution (new-field > deprecated-fallback > production-constant) kept backward compatibility for existing fixtures (VAL-096/097) without any fixture migration in v18 scope, keeping the closure tight.
- Gate 7.5 live confirmation of all three production Google hosts in one pass gave high confidence the root cause was fully resolved.

**What to change:**

- **composeConfig snapshot test is now 4-for-4 overdue** (named at v16, carried through v17 and v18). v18 added 3 new optional config fields; none silently dropped, but the absence of a snapshot test means this class is caught only by live integration, not unit regression. MUST build before next config-adding iteration.
- **TASK-018** (OIDC task): functionally superseded by v15+v17+v18; recommend close/annotate in 03-tasks.md to remove the persistent LOW trace gap.
- **LOW-4** (ARCH-059 inv.3 state TTL text): amend "≤60 s" to "state ≤10 min / codes ≤60 s" (carry-forward from v17, no code change).
- **LOW-5** (ARCH-059 v18 text): amend "no config-schema change" to "no breaking config change (3 new optional test-injectable fields + 1 deprecated)".
- **TASK-091/TASK-092 `status: draft`** despite being shipped: cosmetic ledger residual; flip authorized by orchestrator at next iteration.

**Impact closure:**

- **Real consent 502 at `/oauth/google/callback`:** CLOSED. Root cause: `googleBase=accounts.google.com` used for all three Google OAuth operations; token exchange and JWKS fetch hit non-existent endpoints. Fix: three separately-injectable URLs each defaulting to the correct production host. VAL-095 v18 cases 3+4 confirm correct routing; Gate 7.5 real-Google host confirmation.
- **ARCH-059 v18 (Google endpoint topology documented):** CLOSED. Architecture accurately reflects the three-host topology; static UT regression guard prevents future conflation.

**Known tech debt (all recorded, updated from v17):**

*Carry forward — Gate 2 adjudication pending:*
- [HIGH] H-2: ARCH-017/D-PROFILE/DES-031 builder cluster unwired
- [HIGH] H-3: D-KILL/D-PROC cli-lifecycle + timeout-race orphaned

*Carry forward — lower urgency:*
- [MED] M-1: LiteLLMGatewayClient transcript opaque
- [LOW] LOW-3: client-echoable principal on null-edge path
- [LOW] LOW-4: ARCH-059 inv.3 text — amend state TTL bound
- [LOW] LOW-5: ARCH-059 v18 text — amend "no config-schema change" (new this review)
- [LOW] L-1: McpRegistry wall-clock direct Date.now
- [LOW] L-2: ARCH-018 hooks-drop live branch in materializeAssets

*Action items (carry-forward):*
- [LOW] composeConfig snapshot test — 4 iterations, same bug class; MUST build before next config-adding iteration.

*Trace gaps (all recorded):*
- IMPL-082 MID (TDD-label, pre-existing since v4)
- DES-088 LOW (iter drift v14 behind IMPL-127 v15)
- DES-092 LOW (iter drift v17 behind IMPL-122 v18 — cosmetic; DES-092 metadata scope unchanged)
- DES-093 LOW (iter drift v17 behind IMPL-122 v18 — cosmetic; DES-093 token-store scope unchanged)
- UT-058/UT-064/IT-057 LOW (iter drifts, pre-existing cosmetic)
- TASK-018 LOW (OIDC task, functionally superseded — recommend close/annotate)
- UT-092/UT-093 LOW (TDD-wavefront drift from v17; cosmetic)
- UT-095 LOW (TDD-wavefront drift, widened to v18; resolvePrincipal unchanged — cosmetic)

*Pre-existing doc-debt (unchanged):*
- DEPLOY.md §1b historical v2 blockquote + §6 scenario JSON config keys.

---

## v17 GATE 8 REVIEW (2026-08-18, superseded by v18 above — kept for history)

> This section supersedes "## v16 GATE 8 REVIEW (2026-08-18)" below (kept for history). Superseded by "## v18 GATE 8 REVIEW (2026-08-18)" above.
> **v17 fix-mode iteration — RFC 7591 Dynamic Client Registration (REQ-012 v17 DCR fix).**
> Impact closure: REQ-012, ARCH-059 "explicitly reject DCR" stance reversed, DES-092/093/095, IMPL-122, IT-078, TASK-091 — iter v17.
> No new gaps, no new broken chains, no arch violations for v17-scoped changes.

### Traceability consistency (v17)

Trace `--check` result (regenerated 2026-08-18): **752 items, 9 gaps.**

Change from v16 baseline (751 items / 6 gaps):

- **1 new item:** TASK-091 added (traces ARCH-059, DES-092, IMPL-122).
- **3 new low iter-drift gaps (TDD wavefront):** UT-092/UT-093/UT-095 paired-UT items sat behind DES/IMPL bumped to v17; 2 of the 5 TDD-wavefront drifts from Gate 5–7 were resolved at Gate 7.5 (VAL-095 bumped to v17 in the validation pass; IT-078 bumped at Gate 7). Remaining 3 are cosmetic — no production code gap.
- **No new broken links, no new orphans, 0 未驗證, 0 未真實驗證, 0 high-severity gaps introduced by v17.**

| ID | Severity | Type | Note |
|----|----------|------|------|
| IMPL-082 | MID | TDD label drift | Pre-existing since v4; no change |
| UT-058 | LOW | iter drift v6 behind DES-038 v11 | Pre-existing since F1; cosmetic |
| UT-064 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| IT-057 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| DES-088 | LOW | iter drift v14 behind IMPL-127 v15 | Pre-existing from v15 open; DES-088 iter unchanged by v17 |
| TASK-018 | LOW | no implementation | OIDC task; functionally superseded by v15+v17 OAuth implementation |
| UT-092 | LOW | iter drift behind DES-093 v17 | New TDD-wavefront drift; cosmetic |
| UT-093 | LOW | iter drift behind DES-093 v17 | New TDD-wavefront drift; cosmetic |
| UT-095 | LOW | iter v16 behind IMPL-122 v17 | New TDD-wavefront drift; resolvePrincipal unchanged in v17 — cosmetic |

Dashboard confirms: 0 severe gaps, 0 未驗證 requirements, 0 mock-only validations. All 9 remaining gaps are recorded as known tech debt (Exit Gate 1 satisfied).

### Architecture consistency (v17 self-check — lean QM fix, no panel)

Fix scope: `src/auth/oauth-metadata.ts`, `src/auth/token-store.ts`, `src/auth/auth-service.ts`, `src/server.ts`, `vitest.config.ts`. Checked against ARCH-059 v17 (the only ARCH decision touched by v17).

**ARCH-059 v17 reversal — DCR implemented:**

Architecture text (ARCH-059 v17): "advertise `registration_endpoint` in `/.well-known/oauth-authorization-server`; implement a public `POST /register` that issues a public PKCE `client_id` (no `client_secret`), clamping requested metadata; enforce RFC 8252 loopback rule on every `redirect_uri` at registration; persist to a GC'd `registered_clients` table; `/authorize` applies port-agnostic binding (scheme+host+path, port ignored per RFC 8252 §7.3) for registered clients; unregistered/absent `client_id` falls through to loopback-only path (backward compatible)."

Implementation checks:

1. **`registration_endpoint` in AS metadata** (`src/auth/oauth-metadata.ts:41`): `registration_endpoint: \`${b}/register\`` added to `buildAuthServerMetadata` return. **Matches.**
2. **`POST /register` public endpoint** (`src/server.ts:1409`): route inside `if (authHandlers)` block at line 1409 after `/token`, no bearer check, calls `authHandlers.register(req, res)`. **Matches ARCH-059 "public endpoint, no bearer."**
3. **Loopback enforcement at registration** (`src/auth/auth-service.ts:304-308`): `redirect_uris` must all pass `isLoopbackRedirectUri`; non-loopback/empty → 400 `invalid_redirect_uri`. **Matches ARCH-059 inv.4 extension to registration.**
4. **Metadata clamping** (`src/auth/auth-service.ts:311-325`): response always `grant_types:["authorization_code"]`, `response_types:["code"]`, `token_endpoint_auth_method:"none"`, no `client_secret` issued. **Matches "public PKCE client_id" and "clamping not rejecting."**
5. **`registered_clients` table + GC** (`src/auth/token-store.ts:59-80, 161-192`): 4th table with `client_id PK`, `redirect_uris TEXT`, `client_id_issued_at`, `expires_at`; `registerClient` uses `this._csprng()` + `this._clock()` (seam-consistent, no raw `randomBytes`/`Date.now`); `gcExpired` extended to delete expired `registered_clients` rows. **Matches DES-093 v17 seam-consistency requirement.**
6. **Port-agnostic binding in `/authorize`** (`src/auth/auth-service.ts:138-156`): `tokenStore.getClient(clientId)` looked up; if registered, compares `req_u.protocol === reg_u.protocol && req_u.hostname === reg_u.hostname && req_u.pathname === reg_u.pathname` (port NOT compared); mismatch → 400 before `putState`. **Matches RFC 8252 §7.3 port-ignored binding.**
7. **Backward compatibility** (`src/auth/auth-service.ts:157-162`): absent/unregistered `client_id` → existing `isLoopbackRedirectUri` check (loopback-only path unchanged). **Matches "backward compatible, keeps pre-DCR callers green."**
8. **No new config keys:** `POST /register` is a public endpoint with no secrets; `registered_clients` table auto-managed. Config file unchanged from v16. **Confirmed by Gate 7.5 config-sync check.**
9. **D-AUTH-1 (opaque bearer, no JWT):** DCR adds only a `client_id` (not a bearer token). No JWT introduced. **Consistent.**
10. **ARCH-063 interaction:** `/register` is inside `if (authHandlers)` (auth-enabled guard), but public (no bearer). The net-guard's `isAllowedHost`/`isAllowedOrigin` still covers this route (all routes go through the top-of-handler guard before the `authHandlers` dispatch). **Consistent — "public" means no bearer, not exempted from net-guard.**

**Verdict for v17-touched code: architecture CONSISTENT with ARCH-059 v17.**

Pre-existing violations (UNCHANGED from v16 review — not re-litigated here):

| Label | Severity | Finding | Status |
|-------|----------|---------|--------|
| H-2 | HIGH | ARCH-017/D-PROFILE/DES-031 session-options-builder orphaned | Gate 2 adjudication pending (security-hardening iter) |
| H-3 | HIGH | D-KILL/D-PROC cli-lifecycle + timeout-race dead code | Gate 2 adjudication pending |
| M-1 | MED | LiteLLMGatewayClient transcript opaque | Pre-existing, separately tracked |
| L-1 | LOW | McpRegistry wall-clock direct Date.now | Pre-existing |
| L-2 | LOW | materializeAssets hook arm not removed | Pre-existing |
| LOW-3 | LOW | client-echoable principal on null-edge path | Pre-existing; restrict to test seam when convenient |
| LOW-4 | LOW | ARCH-059 inv.3 text: state TTL 600 s vs. "≤60 s" | Recommend text amendment to "state ≤10 min / codes ≤60 s" |

**Architecture consistency overall: v17-scoped changes are consistent with ARCH-059 v17. Pre-existing H-2/H-3 remain outstanding on their own adjudication track. No new violations.**

### Validation & handover check (v17)

- **VAL-095 (REQ-012, v17):** `real:true`, green, iter v17. 9/9 acceptance cases pass (5 carry-forward + 4 new DCR cases 7a–7d). Case 7a: `registration_endpoint` present in AS metadata. Case 7b: `registerClient()` SDK call → 201 + `client_id`, no `client_secret`. Case 7c: non-loopback `redirect_uris` → SDK throws (server 400 `invalid_redirect_uri`). Case 7d: full DCR end-to-end (registerClient → authorize port-ignored binding → token → MCP 200).
- **Live curl evidence (Gate 7.5):** POST /register → 201 + `client_id`; `registration_endpoint` present in `/.well-known/oauth-authorization-server`; non-loopback `redirect_uri` → 400; port-ignored `/authorize` → 302; restart survival confirmed (`registered_clients` persists across SIGTERM + restart).
- **IT-078 27/27:** 17 pre-existing + 10 new DCR integration cases, all green, real SQLite + real HTTP.
- **Full suite:** 1342/1342 pass (233 files; 1338 pre-existing zero regression + 4 new acceptance cases 7a–7d).
- **No mock-only/unverified REQ for any v17-touched item.**
- **`08-validation.md`:** present, v17 section written (Gate 7.5 v17 PASSED 2026-08-18 confirmed).
- **`README.md`:** present. Current-state v17 (2026-08-18). Quick-start reflects DCR behavior. No stale commands.
- **`DEPLOY.md`:** present. Current-state v17. §7 変更紀錄 has v17 entry (2026-08-18). No new config keys → §1 設定総表 unchanged. No superseded instructions outside §7.
- **Config key deduplication:** v17 adds no new config keys. §1 設定総表 remains deduplicated and authoritative.
- **Unreachable dep (carry-forward + v17 note):** real Google OAuth browser consent flow requires interactive browser + real Google account; headless-unreachable (classified `unreachable-dep`, not a code gap). Real Claude Code DCR browser flow: original "Incompatible auth server" failure is now closed (proven by VAL-095 cases 7a–7d); the interactive browser-consent step remains headless-unreachable but the SDK-function-level proof (case 7d) exercises the same code path.
- **Validation verdict: Gate 7.5 v17 PASSED. VAL-095 v17 real:true. 1342/1342 pass. README + DEPLOY present, current-state. No mock-only/unverified REQ.**

### Retro (v17 — RFC 7591 DCR fix for REQ-012 real-connect failure)

**What changed (IMPL-122 v17, TASK-091):**

- `src/auth/oauth-metadata.ts`: added `registration_endpoint: \`${b}/register\`` to `buildAuthServerMetadata` return (DES-092 v17).
- `src/auth/token-store.ts`: added 4th table `registered_clients(client_id PK, redirect_uris TEXT, client_id_issued_at, expires_at)`; `registerClient({redirectUris, ttlMs})` using injected clock+CSPRNG (seam-consistent, no `Date.now`/`randomBytes` in module); `getClient(clientId)` returning `null` for expired entries; `gcExpired()` extended to sweep all 4 auth tables (DES-093 v17).
- `src/auth/auth-service.ts`: added `register(req, res)` handler to `AuthRouteHandlers` interface + implementation (JSON body parse; loopback enforcement on all `redirect_uris`; metadata clamping; 201 no `client_secret`); updated `authorize()` to perform port-agnostic binding (scheme+hostname+pathname match, port ignored per RFC 8252 §7.3) for registered clients, with graceful fallback to loopback-only path for unregistered/absent `client_id` (DES-095 v17).
- `src/server.ts`: added `POST /register` dispatch inside `if (authHandlers)` block after `/token` at line 1409.

**What went well:**

- The three key design decisions (port-agnostic binding, clamp-not-reject, weeks-scale bounding with GC) were taken at Gate 3+4 and all held through implementation unchanged — no mid-stream pivots. The pre-advisor review before the decisions crystallized saved a potential 400-loop at Gate 7.5 (exact-match port binding would have broken the live-connect case).
- Determinism-by-construction: `registerClient` obeys the injected-seam rule identically to the 3 pre-existing `registerToken`/`storeAuthCode`/`putState` methods — no special handling needed, and the GC determinism property fell out for free.
- The "clamp-not-reject" stance on metadata (e.g., MCP SDK requesting `refresh_token` grant type) meant zero breakage from client diversity; the 201 response always carries the correct supported-subset regardless of what the client sent.
- IT-078 added 10 new cases RED-first at Gate 5, all flipped GREEN at Gate 6 with zero changes to pre-existing 17 cases — the test-before-impl chain guard worked exactly as intended for a surgical fix.

**What to change:**

- **composeConfig snapshot test is 2-for-2 overdue** (named at v16 retro; carry-forward). A snapshot pinning every `fileConfig` key against `ServerConfig` would catch the two silent-drop bugs from v15+v16 before Gate 7.5. This MUST be built before the next config-adding iteration.
- **TASK-018** (OIDC task): functionally superseded by v15+v17 implementation; close or annotate as superseded in 03-tasks.md to remove the persistent LOW trace gap.
- **LOW-4 ARCH-059 text (state TTL):** amend "≤60 s" to "state ≤10 min / codes ≤60 s" to match the 600 s implementation. No code change required.

**Impact closure:**

- **Real-connect failure ("Incompatible auth server: does not support dynamic client registration"):** CLOSED. `registration_endpoint` advertised in AS metadata; `POST /register` issues public PKCE `client_id`; a spec-only MCP client (Claude Code / `@modelcontextprotocol/sdk`) with no pre-registered `client_id` can now complete the OAuth flow. SDK-function-level proof in VAL-095 cases 7b/7d.
- **REQ-012 DCR acceptance clause:** CLOSED. VAL-095 v17 real:true, 9/9, including live curl and restart survival.
- **ARCH-059 "explicitly reject DCR" stance:** REVERSED in place (v17 amendment). The prior stance was wrong for a spec-only MCP client; the architecture now correctly implements DCR as the real-connect path.

**Known tech debt (all recorded, unchanged from v16 except as noted):**

*Newly closed by v17:*
- [N/A] ARCH-059 "reject DCR" stance — REVERSED/CLOSED (was never a bug record, was the prior arch decision)

*Carry forward — Gate 2 adjudication pending:*
- [HIGH] H-2: ARCH-017/D-PROFILE/DES-031 builder cluster unwired
- [HIGH] H-3: D-KILL/D-PROC cli-lifecycle + timeout-race orphaned

*Carry forward — lower urgency:*
- [MED] M-1: LiteLLMGatewayClient transcript opaque
- [LOW] LOW-3: client-echoable principal on null-edge path
- [LOW] LOW-4: ARCH-059 inv.3 text: amend state TTL bound
- [LOW] L-1: McpRegistry wall-clock direct Date.now
- [LOW] L-2: ARCH-018 hooks-drop live branch in materializeAssets

*Action items (carry-forward from v16 + no new):*
- [LOW] composeConfig snapshot test — 3 iterations now, same bug class; must be built before next config-adding iteration.

*Trace gaps (all recorded):*
- IMPL-082 MID (TDD-label, pre-existing since v4)
- DES-088 LOW (iter drift v14 behind IMPL-127 v15 — fix: bump DES-088 iter)
- UT-058/UT-064/IT-057 LOW (iter drifts, pre-existing cosmetic)
- TASK-018 LOW (OIDC task, functionally superseded by v15+v17 — recommend close/annotate)
- UT-092/UT-093/UT-095 LOW (TDD-wavefront drift from v17; cosmetic — resolvePrincipal / token-store methods unchanged)

*Pre-existing doc-debt (unchanged):*
- DEPLOY.md §1b historical v2 blockquote + §6 scenario JSON config keys.

---

## v16 GATE 8 REVIEW (2026-08-18, superseded by v17 above — kept for history)

> This section supersedes "## v15 GATE 8 REVIEW (2026-08-18)" below (kept for history).
> **v16 fix-mode iteration — ARCH-059 inv.4 open-redirect (HIGH-1) + gcExpired unscheduled (MED-2) + composeConfig workspaceTtlMs forwarding fix.**
> Both v15 Gate-8 blocking violations are fixed and verified real-tier. No new gaps, no new drift, no new arch violations.

### Traceability consistency (v16)

Trace `--check` result (regenerated 2026-08-18): **751 items, 6 gaps.**

Change from v15 baseline (750 items / 6 gaps):

- **1 new item:** TASK-090 added (traces ARCH-059, closes the TASK-090 未實作 gap introduced at Gate 3+4 v16).
- **3 iter-drift gaps resolved:** UT-093, UT-095 bumped to v16 (matching DES-093/DES-095 v16 bump), plus one more drift resolved at Gate 7.5 — trace went from 751/9 (Gate 7) to 751/6 (Gate 7.5).
- **No new gaps opened by v16.**

| ID | Severity | Type | Note |
|----|----------|------|------|
| IMPL-082 | MID | TDD label drift | Pre-existing since v4; no change |
| UT-058 | LOW | iter drift v6 behind DES-038 v11 | Pre-existing since F1; cosmetic |
| UT-064 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| IT-057 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| DES-088 | LOW | iter drift v14 behind IMPL-127 v15 | Opened at v15; cosmetic; DES-088 iter unchanged by v16 |
| TASK-018 | LOW | no implementation | OIDC task; functionally superseded by v15+v16 OAuth implementation |

Dashboard confirms: 0 severe gaps, 0 未驗證 requirements, 0 mock-only validations. All 6 remaining gaps are recorded as known tech debt (Exit Gate 1 satisfied).

### Architecture consistency (v16 self-check — lean QM fix, no panel)

Fix scope: `src/auth/auth-service.ts`, `src/server.ts`, `src/main.ts`, `vitest.config.ts`. Checked against ARCH-059 (the only ARCH touched by v16).

**HIGH-1 fix — ARCH-059 inv.4 (loopback-only redirect_uri):**

Architecture text: "`/authorize` validates the `redirect_uri` is an RFC 8252 loopback URI … BEFORE storing any `oauth_state` and BEFORE redirecting to Google — a non-loopback / missing / unparseable `redirect_uri` is refused 400 `invalid_request` with no state row written."

Implementation (`src/auth/auth-service.ts:30-40, 132-140`): `isLoopbackRedirectUri(uri)` — `http:` scheme, hostname ∈ {`127.0.0.1`, `localhost`, `[::1]`}, any port, try/catch→false. Called at `authorize()` BEFORE `tokenStore.putState()` and BEFORE building the Google redirect. Non-loopback → `400 {error:"invalid_request"}`, no state row. Handles WHATWG IPv6 bracket serialization (`[::1]`) correctly per named UT. `https://127.0.0.1` correctly rejected (`http:` scheme required). **Matches ARCH-059 inv.4 exactly.** Confirmed by live curl (8 cases) and IT-078 cases 8a-9c (VAL-095 v16).

**MED-2 fix — ARCH-059 note (gcExpired in sweep):**

Architecture text: "`gcExpired` is called each tick of the REQ-026 periodic maintenance sweep (try/catch→log+continue, never throws into the scheduler); to guarantee bounded auth tables even in the auth-enabled / no-workspace-TTL config, the sweep interval is created when `workspaceTtlMs>0` OR auth is enabled."

Implementation (`src/server.ts:1273-1296`): `const _gcTtl = config?.workspaceTtlMs ?? 0; if (_gcTtl > 0 || authCfg) { … authTokenStore?.gcExpired() … }` — sweep created under the OR condition; `gcExpired()` called first in each tick with its own try/catch; `reclaimStaleWorkspaces` runs only when `_gcTtl>0`; interval = `Math.min(ttl, hourly)` when TTL set, `hourly` otherwise. **Matches ARCH-059 note exactly.** Confirmed by IT-078 case 10 (real SQLite) and cross-process live confirmation (3 expired rows deleted within 2 s at 500 ms interval).

**composeConfig workspaceTtlMs forwarding (`src/main.ts:153-158`):**

No dedicated ARCH item; this is the composition-root wiring fix preventing `_gcTtl=0` in production. Follows the identical forwarding pattern as the v15 `auth:` forwarding fix. Correct.

**vitest.config.ts `sequence: { hooks: 'stack' }`:**

Test tooling only; no ARCH item.

**Verdict for v16-touched code: architecture CONSISTENT.**

Pre-existing violations (UNCHANGED from v15 review — not re-litigated here, all previously recorded):

| Label | Severity | Finding | Status |
|-------|----------|---------|--------|
| H-2 | HIGH | ARCH-017/D-PROFILE/DES-031 session-options-builder orphaned | Gate 2 adjudication pending (security-hardening iter) |
| H-3 | HIGH | D-KILL/D-PROC cli-lifecycle + timeout-race dead code | Gate 2 adjudication pending |
| M-1 | MED | LiteLLMGatewayClient transcript opaque | Pre-existing, separately tracked |
| L-1 | LOW | McpRegistry wall-clock direct Date.now | Pre-existing |
| L-2 | LOW | materializeAssets hook arm not removed | Pre-existing |
| LOW-3 | LOW | client-echoable principal on null-edge path | Pre-existing; restrict to test seam when convenient |
| LOW-4 | LOW | ARCH-059 inv.3 text: state TTL 600 s vs. "≤60 s" | Recommend text amendment to "state ≤10 min / codes ≤60 s" |

These all carry the operator's standing decision (memory: arch-debt-unwired-security-modules = separate security-hardening iteration). HIGH-1 and MED-2 from v15 are CLOSED by this fix.

**Architecture consistency overall: v16-scoped changes are consistent with ARCH-059. Pre-existing H-2/H-3 remain outstanding on their own adjudication track.**

### Validation & handover check (v16)

- **VAL-095 (REQ-012, v16):** `real:true`, green, iter v16. 8 live-server curl tests (HIGH-1: evil.example/https-scheme/garbage/empty/missing → 400, no state row; loopback 127.0.0.1/localhost/[::1] → 302). IT-078 17/17 (7 v16 new + 10 pre-existing). IT-079 4/4 (regression). Cross-process GC: 3 expired oauth_state rows deleted within 2 s at 500 ms interval (MED-2 confirmed real).
- **composeConfig fix (same VAL-095 session):** `workspaceTtlMs: fileConfig.workspaceTtlMs` forwarded; `_gcTtl` now non-zero in production when configured. 1328/1328 pass unchanged after fix.
- **All prior REQs (001..089):** VAL-001..094 hold evidence from prior rounds; 1328/1328 regression pass.
- **No mock-only/unverified REQ for any touched item.**
- **`08-validation.md`:** present, v16 section written (lines 4225–4360), Gate 7.5 v16 PASSED 2026-08-18 confirmed.
- **`README.md`:** present. Current-state v16 (2026-08-18). Quickstart reflects v16 behavior. No stale commands.
- **`DEPLOY.md`:** present. Current-state v16. §7 変更紀錄 has v16 entry (2026-08-18). `workspaceTtlMs` key in §1 設定総表 (single canonical source; no duplicate). No superseded instructions outside §7.
- **Config key deduplication:** `workspaceTtlMs` documented in §1 設定総表; referenced by name in §7. No duplication.
- **Validation verdict: Gate 7.5 v16 PASSED. VAL-095 v16 real:true. 1328/1328 pass. README + DEPLOY present, current-state. No mock-only/unverified REQ.**

### Retro (v16 — ARCH-059 inv.4 + gcExpired + composeConfig workspaceTtlMs fix)

**What changed (IMPL-122 v16, TASK-090):**

- `src/auth/auth-service.ts`: added `isLoopbackRedirectUri(uri): boolean` (pure export, lines 24-40). Called in `authorize()` BEFORE `tokenStore.putState()` — non-loopback/missing/unparseable `redirect_uri` → 400, no state row. Handles WHATWG IPv6 bracket serialization. Relative-URI fallback in `googleCallback` is now unreachable; flagged in code comment but intentionally not removed per DES-095 v16 (surgical fix).
- `src/server.ts`: REQ-026 sweep block moved after `authTokenStore` init (necessary for the condition change); interval-creation condition widened to `(_gcTtl > 0 || authCfg)`; `authTokenStore?.gcExpired()` called first in each tick (own try/catch, never throws into scheduler); `reclaimStaleWorkspaces` only when `_gcTtl > 0`. Auth-only/no-TTL config now bounds auth tables hourly.
- `src/main.ts`: `workspaceTtlMs: fileConfig.workspaceTtlMs` added to `composeConfig()` (lines 153-158). Prevents `_gcTtl=0` in production, ensuring GC runs at the configured interval rather than hourly.
- `vitest.config.ts`: `sequence: { hooks: 'stack' }` — fixes Vitest v1.6.1 parallel-hooks race (test tooling only, no production impact).

**What went well:**

- Gate 7.5 live test caught the `workspaceTtlMs` composition-root gap before the iteration closed — the same safety-net that caught the `auth:` forwarding gap in v15. Real validation found a real production bug.
- The fix is minimal: 3 files, 2 behavioral changes, zero ARCH expansion (the OR-condition widening of the sweep interval is the boldest change, and ARCH-059 named it).
- IT-078 test-first coverage (7 new RED cases at Gate 5, all GREEN at Gate 7) gave precise pass/fail feedback for the fix — the cases 8a-9c provided both failure modes and regression guards in a single test file.

**What to change:**

- **composeConfig snapshot test is now 2-for-2 overdue.** The same bug class (a config key silently dropped from `composeConfig()`) has occurred in consecutive iterations (`auth:` in v15, `workspaceTtlMs` in v16), and the v15 retro already named the fix: a snapshot test pinning every key present in `fileConfig` against `ServerConfig`. This MUST be built before the next config-adding iteration, not after. File as LOW tech debt targeted at the next gate-5 pass for any config-adding iteration.
- **LOW-4 ARCH-059 text fix (state TTL):** amend "≤60 s" to "state ≤10 min / codes ≤60 s" to match the 600 s implementation. No code change required.
- **TASK-018** (OIDC task, functionally superseded): close or annotate as superseded in 03-tasks.md to remove the 未實作 trace gap.

**Impact closure:**

- HIGH-1 (ARCH-059 inv.4 open-redirect → bearer theft): CLOSED. `isLoopbackRedirectUri()` enforced before `putState`. Attack surface: attacker-supplied `redirect_uri` can no longer receive an engine auth-code.
- MED-2 (ARCH-059 gcExpired unscheduled → unbounded auth tables): CLOSED. `gcExpired()` wired into REQ-026 sweep; sweep created for auth-enabled configs. Auth table rows now expire and are reclaimed.
- composeConfig workspaceTtlMs forwarding: CLOSED. Production `_gcTtl` now reflects the configured value; GC fires at the configured interval, not hourly.

**Known tech debt (all recorded, unchanged from v15 except as noted):**

*Closed by v16:*
- [HIGH] HIGH-1: ARCH-059 inv.4 redirect_uri not validated — CLOSED
- [MED] MED-2: ARCH-059 gcExpired never scheduled — CLOSED

*Carry forward — Gate 2 adjudication pending:*
- [HIGH] H-2: ARCH-017/D-PROFILE/DES-031 builder cluster unwired
- [HIGH] H-3: D-KILL/D-PROC cli-lifecycle + timeout-race orphaned

*Carry forward — lower urgency:*
- [MED] M-1: LiteLLMGatewayClient transcript opaque
- [LOW] LOW-3: client-echoable principal on null-edge path
- [LOW] LOW-4: ARCH-059 inv.3 text: amend state TTL bound
- [LOW] L-1: McpRegistry wall-clock direct Date.now
- [LOW] L-2: ARCH-018 hooks-drop live branch in materializeAssets

*Newly identified action items:*
- [LOW] composeConfig snapshot test — 2-for-2 same bug class; must be built before next config-adding iteration.

*Trace gaps (all recorded):*
- IMPL-082 MID (TDD-label, pre-existing since v4)
- DES-088 LOW (iter drift v14 behind IMPL-127 v15 — fix: bump DES-088 iter)
- UT-058/UT-064/IT-057 LOW (iter drifts, pre-existing cosmetic)
- TASK-018 LOW (OIDC task, functionally superseded by v15+v16 — recommend close/annotate)

*Pre-existing doc-debt (unchanged):*
- DEPLOY.md §1b historical v2 blockquote + §6 scenario JSON config keys.

---

## v15 GATE 8 REVIEW (2026-08-18, superseded by v16 above — kept for history)

> This section supersedes "## v14 GATE 8 REVIEW (2026-08-16)" below (kept for history).
> **v15 Slice B — OAuth AS + per-caller principal + workflow ownership + harness-defaults + D-BIND fail-closed**
> (REQ-012 + REQ-086..089). Gate 7.5 v15 PASSED 2026-08-18 (composition-root fix applied first;
> VAL-095..099 real:true; 1316/1316 pass). Panel architects pre-ran (not re-spawned): adversarial group
> (ARCH-059..063 / IMPL-122..128 scope) + quality-dimensions group (v14+v15 scope) reports are in
> `.panel/review/`. This section consolidates them; `.panel/` is removed at end of Gate 8.
>
> **Conclusion: SEND BACK TO GATE 6** — adversarial HIGH-1 (redirect_uri not validated, ARCH-059 inv.4)
> is a fresh HIGH violation in the iteration's own newly-shipped auth code; the fix is one `if` at
> `auth-service.ts:authorize`. MEDIUM-2 (gcExpired unscheduled, ARCH-059 note) is a one-line call into
> the existing sweep. These are not pre-existing built-but-unwired debt; they are the ARCH-059 slice's
> own stated invariants not enforced. Pre-existing H-2/H-3 carry the standing "security-hardening
> iteration" umbrella (Gate 2 adjudication pending); HIGH-1 and MEDIUM-2 do not.

### Traceability consistency (v15)

Trace `--check` result (regenerated 2026-08-18): **750 items, 6 gaps.**

Change from v14 baseline (704 items / 6 gaps):
- **CLOSED:** REQ-012 HIGH 未真實驗証 gap — v15 implemented OAuth AS (ARCH-059..063 / IMPL-122..128)
  and VAL-095 is now `real:true`; REQ-012 is no longer unvalidated.
- **OPENED:** DES-088 LOW drift — DES-088 design is at iter v14, while IMPL-127 (which traces to it) is
  at iter v15. Cosmetic iter mismatch introduced when v15 updated the `workflow_agent_log` TOOL_DEF
  description (‹secret:NAME› marker documentation) without bumping DES-088 to v15. Fix: bump DES-088
  iter to v15 or add a v15 note. Does not affect functionality.
- **Net:** 46 new items (750−704), same gap count (6). The v15 Gate 7.5 state.yaml recorded 750/11 during
  Gate 7 (when 5 v15 gaps — REQ-086..089 × {未實作+未驗證} — were still open); those 5 closed when
  VAL-095..099 flipped real:true, restoring the count to 6.

| ID | Severity | Type | Note |
|----|----------|------|------|
| IMPL-082 | MID | TDD label | Pre-existing since v4; no change |
| UT-058 | LOW | iter drift v6 behind DES-038 v11 | Pre-existing since F1; cosmetic |
| UT-064 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| IT-057 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| DES-088 | LOW | iter drift v14 behind IMPL-127 v15 | **NEW (v15)** — bump DES-088 iter to fix |
| TASK-018 | LOW | no implementation | OIDC task, superseded by v15 OAuth; defer or close |

All remaining gaps recorded as known tech debt (Exit Gate 1 satisfied). DES-088 is the only new drift;
it is LOW cosmetic and does not affect correctness.

### Architecture consistency (v15 panel consolidation)

Two expert groups pre-ran (see `.panel/review/adversarial.md` and `.panel/review/quality-dimensions.md`).

**Overall verdict: NOT consistent — new HIGH violation in v15 auth code requires Gate 6 fix.**

#### Changes since v14 Gate 8

**FIXED by v15 — previously H-1 [HIGH] D-BIND bind guard unimplemented:**
ARCH-063 (TASK-089 / IMPL-128) implemented the D-BIND fail-closed guard. Adversarial confirms D-AUTH-3
(`isLoopbackPeer`) holds: non-loopback without bearer → 401; loopback always exempt; forwarded headers
strip the exemption. VAL-099 real-validated. **This finding is CLOSED.**

**Adversarial panel new findings (v15 auth scope — ARCH-059..063 / IMPL-122..128):**

#### HIGH-1 [HIGH] ARCH-059 invariant 4 violated: redirect_uri not validated (open redirect → bearer theft)

**Violates:** ARCH-059 load-bearing invariant (4): loopback redirect URIs per RFC 8252 (no open-redirect).

**Evidence:**
- `src/auth/auth-service.ts:104-115` (`authorize`) — reads `redirect_uri` from the query and stores it
  verbatim via `tokenStore.putState(...)`. No loopback / host / allowlist check.
- `src/auth/auth-service.ts:177-189` (`googleCallback`) — after Google auth succeeds, 302-redirects
  the browser to the unvalidated `redirect_uri` carrying `?code=<engine auth-code>`.
- `src/auth/auth-service.ts:221-223` (`tokenExchange`) — only checks equality to the stored value;
  the stored value is itself attacker-supplied. No `loopback|127|localhost|allow|valid` predicate anywhere.

**Failure scenario:** Attacker crafts a link with `redirect_uri=https://evil.example`. Victim completes
Google consent as themselves. Engine mints an auth-code for victim's principal, redirects to
`https://evil.example?code=…`. Attacker holds the PKCE verifier, exchanges the code at `/token`, receives
a valid engine bearer for victim. Full impersonation on every protected surface.

**Fix direction:** in `authorize`, reject any `redirect_uri` whose host is not `127.0.0.1`/`::1`/`localhost`
(reuse the `net-guard` loopback predicate) before `putState`. One `if` fail-closed.

**Action: Gate 6 fix.**

#### MED-2 [MED] ARCH-059 note violated: gcExpired() defined but never scheduled (unbounded auth-table growth)

**Violates:** ARCH-059 note: "`gcExpired` reuses the existing workspace-TTL GC cadence (no new scheduler)."

**Evidence:** `src/auth/token-store.ts:155` defines `gcExpired()`. No caller exists anywhere in `src/`.
The workspace GC sweep at `server.ts:1256-1270` (`reclaimStaleWorkspaces`) does NOT invoke
`authTokenStore.gcExpired()`. Abandoned `oauth_state` rows, unexchanged `auth_codes`, and expired
`bearer_token` rows grow without bound.

**Fix direction:** one line — call `authTokenStore.gcExpired()` inside the existing `sweep` at
`server.ts:1264`, piggybacking the cadence ARCH-059 named.

**Action: Gate 6 fix (one-line addition).**

#### LOW-3 [LOW] D-AUTH-2 spirit: caller-echoable principal on null-edge path

**Tension with:** D-AUTH-2 (principal resolved at the edge, never echoed from client).

**Evidence:** `server.ts:786-793` (`callTool`, `workflow_register`/`workflow_deregister`): when edge
principal is null (loopback-exempt or auth-disabled), `args.principal` becomes the ownership value.
`mcp-facade.ts:89` similarly forwards caller-supplied `principal` on the null-edge path.

**Assessment:** Scoped to already-trusted callers (authenticated remote callers cannot exploit it —
`p.principal` is non-null and wins); documented as a test affordance (IMPL-124/IT-080). LOW. Consider
removing or restricting to a test seam to be consistent with the `/assets/*` pattern (which explicitly
refuses client echo).

#### LOW-4 [LOW] ARCH-059 inv.3 literal deviation: oauth_state TTL is 600 s, not ≤60 s

**Evidence:** `token-store.ts:128` sets `oauth_state.expires_at = now + 600_000` (10 min). `auth_codes`
at line 90 correctly use `now + 60_000`.

**Assessment:** Single-use and atomic-consume (the security-critical properties the invariant exists for)
HOLD. Only the numeric TTL exceeds the stated bound, and 60 s is impractical for interactive Google
consent. **Recommended action:** amend ARCH-059 text to "state ≤10 min / codes ≤60 s" rather than
tightening the impl. LOW.

#### Pre-existing violations carried from v14 (Quality-Dimensions confirmation)

Quality-dimensions panel scoped to v14+v15 (IMPL-117..128). Its findings cross-reference the v14 catalog:

| Label | Severity | Panel finding | v14 catalog label |
|-------|----------|---------------|-------------------|
| H-2 | HIGH | R-1 (ProviderProfile / session-options-builder orphaned) | H-2: ARCH-017/D-PROFILE/DES-031 |
| H-3 | HIGH | O-2 + S-2 (FailureEnvelope not emitted; timeout-race dead code) | H-3: D-KILL/D-PROC cluster |
| M-1 | MED | (LiteLLMGatewayClient transcript opaque — quality O-2 scope) | M-1: ARCH-004 LiteLLM gap |
| L-1 | LOW | (McpRegistry wall-clock direct Date.now) | L-1: C3 seam gap |
| L-2 | LOW | (materializeAssets hook arm not removed) | L-2: ARCH-018 defense-in-depth |
| —   | ACK | R-2 (CasStore no port, D-v14-F), C-2 (seedManifest handshake) | Acknowledged deferred debt |
| —   | ACK | S-1 (no disk-full guard, G-SUS-3 deferred), C-1 (allowedTools) | Pre-existing quality gaps |

**O-1 (SessionInitRecord) — re-apply ARCH-044 supersession:** Quality panel re-raised O-1 but without
the ARCH-044 context. ARCH-044 explicitly superseded the SessionInitRecord contract, replacing it with
`HarnessDescriptor` (wired end-to-end, confirmed by adversarial). **Not a violation.** Residual:
`thinkingMode` not in `HarnessDescriptor`, deliberate per ARCH-044 scope, LOW observability debt.

All pre-existing violations carry the operator's standing decision (memory: arch-debt-unwired-security-modules
= a separate security-hardening iteration). H-2 and H-3 require Gate 2 adjudication (wire or formally
supersede following ARCH-044 precedent).

**Architecture consistency conclusion: no.** Fresh HIGH (HIGH-1) and MED (MED-2) in v15's own auth code;
pre-existing H-2, H-3, M-1, L-1, L-2 (all pre-existing, separately tracked). Gate 6 fix required for
HIGH-1 and MED-2 before this iteration closes. Gate 2 adjudication pending for H-2/H-3 (separate
security-hardening iteration).

### Validation & handover check (v15)

- **VAL-095 (REQ-012):** `real:true`, green — SDK-driven OAuth discovery: PRM → AS metadata chain;
  full PKCE auth-code flow via fake RS256 IdP; bearer-authenticated POST /mcp returns 200; unauthenticated
  → 401 with WWW-Authenticate; auth-disabled server returns 200 (backward-compat). 5/5 pass.
- **VAL-096 (REQ-086):** `real:true`, green — per-caller principal: /mcp/assets without bearer → 401;
  bearer-authed workflow_run carries `principal:'alice@example.com'` in run record; CAS namespace
  attributed to principal. 5/5 pass.
- **VAL-097 (REQ-087):** `real:true`, green — workflow ownership gate: creator-only mutation; backfill
  NULL-owner → `hsuhungjung@gmail.com` on first auth-enabled boot; `NOT_WORKFLOW_OWNER` on mismatch.
  8/8 pass.
- **VAL-098 (REQ-088):** `real:true`, green — harness defaults bound at registration; per-param merge
  at run time; HARNESS_DEFAULTS_INVALID on invalid values. 6/6 pass.
- **VAL-099 (REQ-089):** `real:true`, green — D-BIND fail-closed: LAN-IP → 401; loopback exempt;
  webhook HMAC path unaffected; auth-disabled → not 401 (backward-compat). 4/4 pass.
- **Google interactive consent flow:** classified `unreachable-dep` (headless-unreachable; same precedent
  as v11 Playwright); fake RS256 IdP validates all engine-side auth routes with full HTTP. Not mock-only.
- **All prior REQs (001..089):** VAL-001..094 hold evidence from prior rounds; 1316/1316 regression pass.
  REQ-012 gap is NOW CLOSED (VAL-095 real:true). TASK-018 (OIDC task) is functionally superseded by the
  v15 OAuth implementation; recommend closing.
- **`08-validation.md`:** present, v15 section written, Gate 7.5 v15 PASSED 2026-08-18 confirmed.
- **`README.md`:** present at repo root. Current-state (v15, 2026-08-18). Step-by-step quickstart.
  OAuth auth documented as opt-in (v15 section). No stale commands or superseded content.
- **`DEPLOY.md`:** present at repo root. Current-state (v15, 2026-08-18). §7 変更紀錄 includes v15 entry
  (2026-08-18). Three new `auth.*` config keys in §1 設定総表 v15 block, with full descriptions +
  defaults. v15 rwe.config.example.json `auth` block present. No superseded current-state instructions
  outside §7.
- **Config key deduplication:** `設定総表` (§1 DEPLOY.md) is the single canonical source for `auth.enabled`/
  `auth.googleClientId`/`auth.googleClientSecret`. §7 変更紀錄 references them by name (correct). No
  duplication across sections.
- **Pre-existing doc-debt (LOW, unchanged from v14):** DEPLOY.md §1b historical v2 blockquote (inline
  supersession marker); §6 scenario JSON blocks carry config key examples. Risk low. Carry forward.
- **Validation verdict:** Gate 7.5 v15 PASSED. VAL-095..099 real:true. 1316/1316 pass. README + DEPLOY
  present, step-by-step, current-state. 設定総表 deduplicated. No mock-only/unverified REQ.
  **HIGH-1 and MED-2 require Gate 6 fix before final closure; no Gate 7.5 send-back on validation itself.**

### Retro (v15 — OAuth AS + per-caller principal + ownership + harness-defaults + D-BIND)

**What changed (ARCH-059..063 / IMPL-122..128):**
- IMPL-122 `auth-service.ts` — OAuth AS: authorization-code + PKCE S256; Google IdP (injected
  `jwksFetch`/`googleBase`); engine-issued opaque bearer (sha256-at-rest, 32-CSPRNG-byte, no JWT);
  `/.well-known/oauth-protected-resource` + `/.well-known/oauth-authorization-server` endpoints.
- IMPL-123 `token-store.ts` — three-table SQLite auth store (oauth_state, auth_codes, bearer_tokens);
  injected clock + csprng + db; `gcExpired()` defined (wiring gap = MED-2 above).
- IMPL-124 `google-verifier.ts` — RS256 JWKS verify; pins `alg`/`iss`/`aud`/`exp`/`email_verified`.
- IMPL-125 `oauth-metadata.ts` — pure PRM + AS metadata builders.
- IMPL-126 `net-guard.ts` + `src/harness-defaults.ts` + `src/workflow-catalog.ts` — `isLoopbackPeer`
  (loopback exemption for D-BIND); `validateHarnessDefaults` + `resolveHarnessParams`; ownership gate.
- IMPL-127 `mcp-facade.ts` + `server.ts` (auth wiring, 1276-1503) — `resolvePrincipal` edge resolver;
  auth routes wired in server; `workflow_agent_log` TOOL_DEF updated (traces DES-088, iter v15 →
  creates DES-088 LOW drift since DES-088 iter is v14).
- IMPL-128 `src/main.ts` composition-root fix (`auth: fileConfig.auth` forwarded) — the composition-root
  gap caught at Gate 7.5 (`composeConfig` silently dropped the `auth` block; live test showed /mcp
  returned 200 without bearer even with `auth.enabled:true`; 1-line fix, then curl 200→401 confirmed).

**What went well:**
- D-AUTH-1..6 all confirmed HELD by adversarial panel — the security invariants that *were* wired are
  correctly wired (sha256-at-rest, no JWT forgery surface, principal never enters sandbox, D-BIND loopback
  guard, harness-defaults fail-closed, auth-disabled idempotent backfill).
- Gate 7.5 caught the composition-root gap (IMPL gap, not doc-only) before it left the iteration —
  the "seam-wired-in-tests-but-not-in-production" pattern surfaced via a live curl, not just the test suite.
- REQ-012 is now CLOSED (VAL-095 real:true) after being the iteration's sole HIGH trace gap for 14 iterations.
- v14 H-1 (D-BIND bind guard) is now FIXED — one pre-existing HIGH eliminated.

**What to change:**
- **Composition-root config-forwarding drift-lock:** the `composeConfig` function has dropped config keys
  twice (first `auth`, and the pattern is documented as the recurring bug class in the code itself).
  Add a `composeConfig` snapshot test pinning each key present in `fileConfig` against `ServerConfig`
  to catch the next dropped key at Gate 7 (not Gate 7.5).
- **`redirect_uri` allowlist must be written before closure (HIGH-1):** a one-`if` loopback check in
  `authorize()` before `putState`. The ARCH-059 invariant was explicit; this is the fastest Gate 6
  round-trip possible.
- **gcExpired wiring must be done before closure (MED-2):** one line in the existing sweep.
- **DES-088 iter bump:** bump DES-088's `iter` field to v15 to close the trace drift.

**Known tech debt (all recorded):**

*New for v15 — require Gate 6 fix before this iteration closes:*
- [HIGH] HIGH-1: ARCH-059 inv.4 redirect_uri not validated — one `if` in `authorize()`.
- [MED] MED-2: ARCH-059 gcExpired never scheduled — one `gcExpired()` call in the existing sweep.

*Newly downgraded to LOW (no longer a security gap, pending ARCH-text fix):*
- [LOW] LOW-4: ARCH-059 inv.3 text: amend to "state ≤10 min / codes ≤60 s" (impl is defensible; text wrong).

*Pre-existing, Gate 2 adjudication pending:*
- [HIGH] H-2: ARCH-017/D-PROFILE/DES-031 builder cluster unwired — wire or formally supersede (ARCH-044 precedent).
- [HIGH] H-3: D-KILL/D-PROC cli-lifecycle + timeout-race orphaned — wire or formally supersede.

*Pre-existing, Gate 6 fix (lower urgency — no new data in v15):*
- [MED] M-1: LiteLLMGatewayClient transcript opaque.
- [LOW] LOW-3: client-echoable principal on null-edge path (restrict/remove args.principal fallback).
- [LOW] L-1: McpRegistry wall-clock direct Date.now.
- [LOW] L-2: ARCH-018 hooks-drop live branch in materializeAssets (delete hook arm).

*Acknowledged deferred quality debt (no committed resolution path):*
- S-1: No disk-full defense on CAS blob writes / journal appends (G-SUS-3 deferred).
- C-1: allowedTools absent from AgentOpts interface.
- R-2: CasStore no port (acknowledged D-v14-F).
- C-2: seedManifest handshake not inline in workflow_run description.

*Trace gaps (all recorded):*
- IMPL-082 MID (TDD-label, pre-existing since v4)
- DES-088 LOW (iter drift v14 behind IMPL-127 v15 — fix: bump DES-088 iter)
- UT-058/UT-064/IT-057 LOW (iter drifts, pre-existing cosmetic)
- TASK-018 LOW (OIDC task, functionally superseded by v15 OAuth — recommend closing)

*Pre-existing doc-debt (unchanged):*
- DEPLOY.md §1b historical v2 blockquote (inline supersession marker) + §6 scenario JSON config keys.

**Gate 7.5:** PASSED 2026-08-18 (composition-root fix applied first). VAL-095..099 `real:true`.
1316/1316 regression pass.
**Gate 8 conclusion: SEND BACK TO GATE 6** — HIGH-1 (redirect_uri) and MED-2 (gcExpired) are the
blocking findings. Both are one-`if`/one-line fixes in the v15 auth code. All other findings are either
pre-existing recorded debt or LOW/cosmetic.

---

## v14 GATE 8 REVIEW (2026-08-16, superseded by v15 above — kept for history)

> This section supersedes "## v12 GATE 8 REVIEW (2026-08-15)" below (kept for history).
> This round closes the v13 + v14 chain together (v13 never ran a standalone Gate 8): **v13 —
> engine-pull seedRef** (REQ-080); **v14 — streaming blob + manifest ref + redact-at-capture +
> schema honesty + scriptSha256** (REQ-081..085). Gate 7.5 ran two rounds: ROUND 1 found the
> REQ-083 key.prompt structural gap (JournalEntry.key.prompt not redacted); ROUND 2 confirmed the
> fix (live Ollama run 8cdbed02, qwen2.5:7b). All six pre-existing trace gaps remain — none
> introduced or closed by this round (REQ-083 gap was a Gate 7.5 implementation finding, not a
> trace-tool gap; VAL-092 flipped to green/pass after fix).
>
> **Panel architects pre-ran (not re-spawned):** adversarial group + quality-dimensions group
> reports are in `.panel/review/`. This section consolidates them; `.panel/` is removed at end of Gate 8.

### Traceability consistency (v14)

Trace `--check` result (regenerated 2026-08-16): **704 items, 6 gaps — ZERO new gaps from v13/v14.**
The v13/v14 chain (REQ-080..085) is fully closed: REQ→ARCH→TASK→DES→IMPL→UT/IT/VAL with
VAL-089..094 all `real:true`. Gap breakdown (all pre-existing; first recorded in v12 Gate 8):

| ID | Severity | Type | Note |
|----|----------|------|------|
| REQ-012 | HIGH | 未真實驗證 | OIDC deferred by user decision D5; pre-existing known tech debt; not a Gate 7.5 send-back |
| IMPL-082 | MID | TDD label gap | Pre-existing since v4 |
| UT-058 | LOW | iter drift v6 behind DES-038 v11 | Pre-existing since F1; underlying ops covered; cosmetic lag only |
| UT-064 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| IT-057 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| TASK-018 | LOW | no implementation | OIDC task, deferred D5 |

All 6 are pre-existing; none introduced by v13/v14. Every remaining gap is recorded here as known tech debt (Exit Gate 1 satisfied).

Iter drift check on the v14 chain: IMPL-117..121 at iter v14; DES-086..091 at iter v14; VAL-089..094 at iter v14; ARCH-054..058 at iter v14. No new drift introduced.

### Architecture consistency (v14 panel consolidation)

Two expert groups pre-ran against the v14 codebase (both read `02-architecture.md` ARCH/INV/rationale,
`06-impl-log.md`, and the files on each IMPL `files:` for the v3 scope — IMPL-068..080 + surrounding
wiring — which is the standing v3 built-but-unwired control set the panels track; v14-scope IMPL-117..121
is grounded below separately). Their findings are consolidated here.

**Verdict: NOT consistent. 3 HIGH + 1 MED + 3 LOW violations.**

**Changes since v12 panel:**
- FIXED: M-2 D-REDACT `redact()` orphaned — IMPL-119 (v14) wired `redact({name,value}[])` into all four
  persist sinks (AgentExecutor transcript, RunManager snapshot, RunManager journal entry including
  `key.prompt` fix from Round 2). Quality's wired-positive inventory confirms the sinks at
  `agent-executor.ts:154`, `run-manager.ts:575`, `run-manager.ts:771`, and IMPL-119's full coverage.
  **Not a violation in v14.**
- FIXED: M-3 ARCH-015 MCP_NOT_PROVISIONED silent for named workflows — Adversarial's consistent-list
  confirms `claude-agent-sdk-client.ts:416-436` now produces the typed `MCP_NOT_PROVISIONED` result.
  **Not a violation in v14.**
- NEW: O-1 LiteLLMGatewayClient transcript opaque (quality O-1, MED) — carries forward from v14 panel.
- NEW: V4 ARCH-018 hooks-drop live branch in `materializeAssets` (adversarial V4, LOW) — carries forward.

#### ARCH-044 reconciliation — SessionInitRecord vs HarnessDescriptor

Both new panels flag `SessionInitRecord` as never emitted (adversarial V2 at MED, quality O-2 at HIGH).
The v12 Gate 8 review ruled this a "not-a-violation" under ARCH-044 (signed later, supersedes ARCH-017's
`SessionInitRecord` contract). ARCH-044 is confirmed in `02-architecture.md:463-490`: `HarnessDescriptor`
with `redactHarness` is the designated replacement, wired end-to-end, and the adversarial panel's
own consistent-list confirms `harness` events are emitted at `claude-agent-sdk-client.ts:575-587`.

**Ruling (stable from v12):** `SessionInitRecord` absence = superseded-intentional per ARCH-044.
`HarnessDescriptor` is the production audit record. **Not a standalone violation.**

However, the panels' cluster around the builder contains three legitimate violations *distinct* from
SessionInitRecord that ARCH-044 does NOT supersede:

#### H-1 [HIGH] D-BIND fail-closed bind guard unimplemented (adversarial V3; quality S-2)

Decision D-BIND (amends ARCH-009) requires a fail-closed guard refusing `bind != 127.0.0.1` unless
`insecureNoAuth:true` is set. `src/net-guard.ts:14` exports `isLoopback()` but it is never imported by
`src/server.ts` or `src/main.ts` for bind refusal. `grep -rn insecureNoAuth src/` → zero hits.
`src/main.ts:97` and `src/server.ts:1025` pass the bind address through with no guard.
DEPLOY.md preamble documents the live deployment at `0.0.0.0:8899` — the exact configuration D-BIND
exists to block. Compensating control: ufw allowlist `192.168.0.0/24 + SSH` documented in DEPLOY.md.
That control is outside the engine; D-BIND requires an in-engine guard.

**Evidence:** `src/net-guard.ts:14`; `src/server.ts:28` (no isLoopback import); `src/main.ts:97`.
**Severity:** HIGH. RCE + secret surface exposed with a live `0.0.0.0` deployment.
**Action:** Gate 6 fix — one `if (!isLoopback(bind) && !config.insecureNoAuth) throw` at bind site.

#### H-2 [HIGH] D-PROFILE dual thinking policy + dead DES-031 per-session re-walk (adversarial V2; quality R-1)

ARCH-017 designates `buildSessionOptions()` (`src/session-options-builder.ts`) as the master v3 test
seam, consolidating thinking policy, curated allowlist, and MCP injection for all providers. D-PROFILE
requires `ProviderProfile` (from this module) as the single source of truth for thinking-disabled policy.

Two concrete violations:
1. **Dual thinking policy:** production (`claude-agent-sdk-client.ts:325-328`) keys off inline
   `thinkingFor(aliases, model)` using a local `aliases?.[model]?.provider === 'anthropic'` check;
   `buildSessionOptions` keys off `ProviderProfile.supportsExtendedThinking`. The two tables can
   diverge silently. Adding a new provider requires changing two independent code paths.
2. **Dead DES-031 per-session re-walk:** `findProjectMarkerAncestor(cwd, workRoot)` (ARCH-019 intra-run
   confinement re-check) lives only inside `buildSessionOptions`, which has zero production callers.
   Only the boot-time `assertWorkRootIsolated` (`main.ts:94`) runs. If an agent writes a `.git`/`CLAUDE.md`
   marker into its workspace during a run, the per-session re-walk that would refuse the next session
   call is never invoked.

**Note:** `buildSessionOptions` has zero production importers (confirmed by adversarial V2 + quality R-1
both grepping `src/`; impl-log IMPL-078 note also acknowledges "not-yet-wired (TASK-032)").

**Evidence:** `src/session-options-builder.ts` (zero production importers); `claude-agent-sdk-client.ts:325-328`; `src/main.ts:94` (single boot guard only).
**Severity:** HIGH. Confinement invariant unenforced per-session; D-PROFILE single-source broken.
**Action:** Gate 2 adjudication — wire the seam or formally supersede ARCH-017/D-PROFILE/DES-031
following the ARCH-044 precedent (signed supersession with explicit rationale). TASK-032 is the standing open task.

#### H-3 [HIGH] D-KILL/D-PROC: cli-lifecycle + timeout-race orphaned; no engine-owned process-group kill (adversarial V1; quality S-1)

ARCH-017 (D-KILL) requires the outer `Promise.race` to physically kill the CLI subprocess on timeout
(not merely abandon the promise via `abortController.abort()`), freeing the semaphore slot exactly once.
D-PROC requires SIGTERM→SIGKILL escalation on a detached process group to reap stdio-MCP grandchildren.

Both `src/cli-lifecycle.ts` (`RealCliLifecycle.killGroup`) and `src/timeout-race.ts` (`raceWithTimeout`)
have zero production callers. The real timeout path at `claude-agent-sdk-client.ts:462-463,603-616`
delegates cancellation entirely to `abortController.abort()`. Whether the SDK's `claude` CLI child and
its stdio-MCP grandchildren are reaped is the SDK's own policy — the engine performs no `kill(-pid)`.
Under the scheduled fan-out use case (D-DOS), this is the single-node exhaustion surface D-KILL/D-DOS were
raised to close (adversarial V1 notes semaphore slot IS freed via `withSlot` `finally`, which is a partial
mitigation — the slot is freed when the SDK promise settles, not when the subprocess exits).

**Evidence:** `src/cli-lifecycle.ts` (zero production importers); `src/timeout-race.ts` (zero production importers); `claude-agent-sdk-client.ts:462-463`; `run-manager.ts:585` (`withSlot` direct, no `raceWithTimeout`).
**Severity:** HIGH. Orphaned MCP grandchildren + token burn on timeout; no SIGKILL escalation.
**Action:** Gate 2 adjudication — wire or formally supersede D-KILL/D-PROC following ARCH-044 precedent.

#### M-1 [MED] LiteLLMGatewayClient transcript opaque (quality O-1)

ARCH-004 requires a single capture path that taps the SDK message/event stream into `agent-<id>.jsonl`.
`LiteLLMGatewayClient` (`src/gateway/client.ts:53`) never calls `onEvent`; runs dispatched via the
direct-fetch path produce only a terminal usage event. Tool-call traces, message text, and reasoning
steps are absent from those transcripts. `workflow_agent_log` for such runs returns a single opaque record.

**Evidence:** `src/gateway/client.ts:53` (comment confirms `onEvent` is never called for LiteLLM path).
**Severity:** MED. Observability gap on the non-Anthropic gateway path; no data loss.
**Action:** Gate 6 fix — stream per-event records through `onEvent` in the LiteLLM path.

#### L-1 [LOW] McpRegistry wall-clock (pre-existing; persists from v12)

`src/mcp-registry.ts:61` uses `new Date().toISOString()` directly instead of the injected `Clock`,
violating the C3 clock/RNG seam. Confirmed present in v14 tree (verified by direct read). Neither v14
panel re-flagged it, but the code path is unchanged. Does not affect production correctness; breaks
hermetic test seam.

**Evidence:** `src/mcp-registry.ts:61`.
**Severity:** LOW. One-line fix, opportunistic.

#### L-2 [LOW] ARCH-018 hooks-drop live branch in `materializeAssets` (adversarial V4)

ARCH-018 requires hook-kind assets rejected "by construction" — the materializer must not have a hook
arm at all. `claude-agent-sdk-client.ts:166-176` `materializeAssets` iterates `[['skill','skills'],
['hook','hooks']]` and would `copyDirRecursive` hook assets into `<workspace>/.claude/hooks/` on every
`agent()` call. The branch is dead today (classifyAsset and seedManifest strip hooks before disk), but
the structural ban ARCH-018 requires is not present in the materializer itself.

**Evidence:** `src/gateway/claude-agent-sdk-client.ts:166-176`.
**Severity:** LOW. Defense-in-depth gap; no open RCE today.
**Action:** Delete the `'hook'` arm from `materializeAssets` loop.

#### L-3 [LOW residual] SessionInitRecord — superseded by ARCH-044; thinkingMode absent from HarnessDescriptor

Per ARCH-044 ruling above, SessionInitRecord absence is not a violation. Residual observability debt:
`HarnessDescriptor` carries `prompt/tools/skills/mcpServers` but not `thinkingMode`, `secretHandleNames`,
or `settingSources`. This narrowing was deliberate (ARCH-044 scope). Recorded as LOW observability debt,
intentional per ARCH-044.

#### v14-chain architecture consistency (ARCH-054..058 / IMPL-117..121)

No panel finding touches the v14 ARCH-054..058 chain. Independent check against Gate 2 decisions:
- ARCH-054 streaming blob (IMPL-117): `isValidSha256Hex`/`isValidNamespace` guards wired before any fd;
  `putBlobStream` seam injectable; net-guard 403 on foreign Host; no-exists-shortcut invariant preserved.
  Consistent with ARCH-054.
- ARCH-055 manifest ref (IMPL-118): manifest stored as CAS blob; `seedManifestRef = sha256(bytes)`;
  4-way SEED_SOURCE_CONFLICT ladder; re-validation at run-time. Consistent with ARCH-055.
- ARCH-056 redact-at-capture (IMPL-119): `SecretValueProvider` port; `redact({name,value}[])` wired at
  all 4 sinks including JournalEntry (key.prompt + value). Quality's wired-positive inventory confirms.
  Consistent with ARCH-056. **M-2 from v12 CLOSED.**
- ARCH-057 schema honesty (IMPL-120): `asset_push` kind description includes HOOKS_UNSUPPORTED/mcp_provision;
  IT-077 drift-lock. Consistent with ARCH-057. **ARCH-015 named-workflow finding from v12 CLOSED** (adversarial
  confirms `claude-agent-sdk-client.ts:416-436` correctly resolves MCP_NOT_PROVISIONED).
- ARCH-058 scriptSha256 (IMPL-121): pure `assertScriptIntegrity` placed before admission; SCRIPT_SHA_MISMATCH
  / SCRIPT_SHA_WITHOUT_SCRIPT typed errors. Consistent with ARCH-058.

**Architecture consistency conclusion: no.** 3 HIGH + 1 MED + 3 LOW violations, all in the v3
built-but-unwired control set. No panel finding touches the v14 ARCH-054..058 chain (fully consistent).
**Gate 2 adjudication required** for H-2 (ARCH-017/D-PROFILE/DES-031) and H-3 (D-KILL/D-PROC).
**Gate 6 fix required** for H-1 (D-BIND) and M-1 (LiteLLM transcript).
Per the operator's standing decision (memory: arch-debt-unwired-security-modules — a separate security
hardening iteration), these violations do not block v14 iteration closure; they are carried as recorded
known tech debt.

### Validation & handover check (v14)

- **VAL-089 (REQ-080):** `real:true`, green — seedRef live GitHub pull + 4 SSRF denial cases confirmed.
- **VAL-090 (REQ-081):** `real:true`, green — POST /assets/blob/:sha streaming; sha mismatch 409;
  oversized 413; foreign Host 403; live production blob uploaded.
- **VAL-091 (REQ-082):** `real:true`, green — POST /assets/manifest + seedManifestRef round-trip;
  MISSING_BLOBS + SEED_SOURCE_CONFLICT confirmed; live production manifest registered.
- **VAL-092 (REQ-083):** `real:true`, green (ROUND 2) — live Ollama run (runId 8cdbed02, qwen2.5:7b,
  SDK+LiteLLM); journal.jsonl JournalEntry key.prompt redacted to `‹secret:VAL092_SECRET›`; events
  array clean; IT-075 extended (5/5 pass); val-092 clauses 2+3 pass under RWE_SKIP_ONLINE_TESTS=1.
- **VAL-093 (REQ-084):** `real:true`, green — `tools/list` asset_push kind description confirmed with
  HOOKS_UNSUPPORTED + mcp_provision text; push kind=hook → HOOKS_UNSUPPORTED.
- **VAL-094 (REQ-085):** `real:true`, green — matching scriptSha256 → run proceeds; mismatch →
  SCRIPT_SHA_MISMATCH; no sha → unchanged behavior; named + sha → SCRIPT_SHA_WITHOUT_SCRIPT.
- **REQ-012:** 1 未真實驗証 HIGH (OIDC, D5 deferral, user-accepted). Not a Gate 7.5 send-back; known
  tech debt per user decision D5. TASK-018 and its gate gap remain as LOW unimplemented.
- **1170/1170 pass.** 217 test files. `npx tsc --noEmit` clean.
- **`08-validation.md`:** present, front-matter `status: passed`, v14 ROUND 2 evidence recorded.
- **`README.md`:** present at repo root (layout.readme). Current-state (v14, 2026-08-16). Step-by-step
  quickstart (6 numbered steps). All 37 tools documented. No stale commands or superseded content.
- **`DEPLOY.md`:** present at repo root (layout.deploy). Current-state (v14, 2026-08-16). §0 step-by-step
  quickstart (verbatim copy-paste). §7 変更紀錄 includes v13 (2026-08-15) and v14 (2026-08-16) entries.
  New config keys `seedRefAllowlist` and `maxBlobBytes` documented in §1b with full descriptions + defaults;
  also present in `rwe.config.example.json` JSON block. No superseded commands or keys outside §7.
- **Config key deduplication:** `設定総表` (§1b) is the single canonical source. `seedRefAllowlist` and
  `maxBlobBytes` appear in the §1b JSON example + description blocks only (§7 変更紀錄 references them by
  name in the change entry, which is correct). No duplication.
- **Doc-debt (LOW, does not change conclusion, pre-existing from v12):** §1b lines 287-289 still carry
  the historical v2 blockquote with an inline "(v3 更新, 2026-07-11): 上述 v2 敘述已被 D-V3M-3 取代"
  supersession note — append-with-inline-marker rather than clean supersede-not-append. Current truth is
  stated inline; quickstart real-validated this round. §6 scenario-recipe JSON blocks also contain config
  key examples. Risk remains low (same as v12 assessment). Carry forward as LOW doc-debt; fold cleanup
  into the next Gate 6 round-trip.
- **Validation verdict:** Gate 7.5 v14 ROUND 2 real-tier all-green for REQ-080..085. README + DEPLOY
  present, step-by-step, current-state. 設定総表 deduplicated. No mock-only/unverified REQ for touched
  items. REQ-012 gap user-deferred and recorded.

### Retro (v13+v14 — engine-pull seedRef + streaming blob + redact-at-capture + schema honesty + scriptSha256)

- **What changed — v13 (REQ-080 / IMPL-116):** `workflow_run({seedRef:{repoUrl,sha},seedNamespace?})`
  allows the engine to pull a git repository at a specific sha for workspace seeding. SSRF-safe: fail-closed
  `seedRefAllowlist:[]` default (any seedRef → `SEEDREF_DISABLED`); repoUrl prefix must match allowlist or
  → `SEEDREF_EGRESS_DENIED` before any network call. Hardened git child (isolated env, `--depth 1`,
  `http.followRedirects=false`, ls-tree byte caps, two-step sha verify, symlink/gitlink discard).
  `workflow_status.result.seedRef` stamps resolvedSha/bytes/latencyMs/dropped/failCode. Gate 6 integrator
  fix: implementer chunk stalled on API; orchestrator completed IMPL-116 + two test_defects (pinned private
  repo → octocat public, VAL-089 workspace assembly).
- **What changed — v14 (REQ-081..085 / IMPL-117..121):**
  - IMPL-117 streaming blob: `POST /assets/blob/:sha` raw-body route bypasses the 8 MiB JSON-RPC cap.
    Pure `isValidSha256Hex`/`isValidNamespace` validators before any fd; `putBlobStream` seam with temp-file
    + incremental sha256 + mid-stream abort + atomic rename + no-exists-shortcut invariant.
  - IMPL-118 manifest ref: `POST /assets/manifest` stores manifest as CAS blob; `seedManifestRef =
    sha256(rawBytes)` client-derivable; 4-way SEED_SOURCE_CONFLICT ladder; run-time re-validation.
  - IMPL-119 redact-at-capture: `SecretValueProvider` port + `redact({name,value}[])` wired into all 4
    persist sinks. The Round 1 Gap (key.prompt unredacted in JournalEntry) was caught via live run, fixed
    by extending sink 4 to redact the entire JournalEntry (key.prompt + key.opts + value), re-verified
    in Round 2 via live Ollama run. This closes the pre-existing v12 M-2 D-REDACT violation.
  - IMPL-120 schema honesty: `asset_push` kind description explicitly documents HOOKS_UNSUPPORTED and
    mcp_provision redirect; IT-077 drift-lock. Closes the pre-existing v12 M-3 ARCH-015 finding.
  - IMPL-121 scriptSha256: pure `assertScriptIntegrity(script, sha?)` before admission; typed
    SCRIPT_SHA_MISMATCH / SCRIPT_SHA_WITHOUT_SCRIPT errors.
- **Gate 7.5 real-run value story:** the Round 1 Gap (REQ-083 key.prompt unredacted) was a genuine
  implementation defect caught ONLY by real-run evidence — the on-disk `journal.jsonl` revealed raw secret
  in `key.prompt` after a live Ollama run, which no unit or integration test caught (IT-075's test prompt
  'A' contained no secret). This is the exact class of defect Gate 7.5 exists to catch.
- **Impact closure:** REQ-080..085 fully chained (REQ→ARCH→TASK→DES→IMPL→UT/IT/VAL with real:true).
  1170/1170 regression pass. Gate 7.5 v14 ROUND 2 PASSED 2026-08-16. ZERO new trace gaps introduced.
- **Known tech debt (all pre-existing unless noted, all recorded):**
  - [HIGH] H-1 D-BIND bind guard unimplemented — Gate 6 fix required; ufw is the current compensating control.
  - [HIGH] H-2 ARCH-017/D-PROFILE/DES-031 builder cluster unwired — Gate 2 adjudication (wire or supersede).
  - [HIGH] H-3 D-KILL/D-PROC cli-lifecycle + timeout-race orphaned — Gate 2 adjudication.
  - [MED] M-1 LiteLLMGatewayClient transcript opaque — Gate 6 fix (stream onEvent in LiteLLM path).
  - [LOW] L-1 McpRegistry wall-clock — one-line fix, opportunistic.
  - [LOW] L-2 ARCH-018 hooks-drop live branch in materializeAssets — delete the hook arm.
  - [LOW] L-3 SessionInitRecord superseded (ARCH-044); thinkingMode not in HarnessDescriptor, intentional.
  - [LOW] DEPLOY.md §1b historical v2 blockquote + §6 scenario JSON config key instances — doc cosmetics.
  - Trace gaps: REQ-012/TASK-018 (OIDC, D5), IMPL-082 (TDD-label), UT-058/UT-064/IT-057 (iter drift).
- **Gate 7.5:** PASSED 2026-08-16 (ROUND 2). VAL-089..094 `real:true`. 1170/1170 regression.

## v12 GATE 8 REVIEW (2026-08-15, superseded by v14 above)

> This section supersedes "## v11 GATE 8 FIX-ITERATION REVIEW (2026-08-09)" below (kept for history).
> This round lands four already-implemented, GREEN, real-validated items: **v12 — system metrics +
> models enrichment**: REQ-076 (`system_info` CPU/mem/disk), REQ-077 (process metrics via `system_info`),
> REQ-078 (`models_list` enrichment with provider/context/pricing), REQ-079 (drift-locked input/output
> schemas). All are additive tool surface additions; no v1-core or run-lifecycle change.
> Ledger chain: REQ-076..079 → ARCH/TASK/DES chain → IMPL-101..102 (iter v12) → VAL-085/086/087/088.
>
> **Gate 7.5 v12 ROUND 1 PASSED 2026-08-15.** VAL-085..088 all `real:true`. 998/998 regression pass.
> 37 tools. `npx tsc --noEmit` clean.
>
> **Panel architects pre-ran (not re-spawned):** adversarial group + quality-dimensions group reports
> were in `.panel/review/`. This section consolidates them; `.panel/` is removed at end of Gate 8.

### Traceability consistency (v12)

Trace `--check` result (regenerated 2026-08-15): **642 items, 6 gaps — ZERO new gaps from v12.**
REQ-076..079 are fully chained (REQ→ARCH→TASK→DES→IMPL→UT/VAL) with VAL-085..088 `real:true`.
Gap breakdown:

| ID | Severity | Type | Note |
|----|----------|------|------|
| REQ-012 | HIGH / 嚴重 | 未真實驗證 | OIDC deferred by user decision D5; pre-existing known tech debt; not a Gate 7.5 send-back |
| IMPL-082 | MED | TDD label gap | Pre-existing since v4 |
| UT-058 | LOW | iter drift v6 behind DES-038 v11 | Pre-existing since F1; underlying ops covered; cosmetic lag only |
| UT-064 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| IT-057 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| TASK-018 | LOW | no implementation | OIDC task, deferred D5 |

All 6 are pre-existing; none introduced by v12. Every remaining gap is recorded here as known tech debt (Exit Gate 1 satisfied).

### Architecture consistency (v12 panel consolidation)

Two expert groups pre-ran against the v12 implementation. Both independently concluded NOT consistent.
Their findings are consolidated here; `.panel/review/` files removed at end of this gate.

**Expert scope:** adversarial group (security + scalability + testability) and quality-dimensions group
(observability + replaceability + consumability + self-sustainability). Both read `02-architecture.md`
(ARCH/INV/rationale), `06-impl-log.md`, and the files listed on each IMPL `files:` for the v12 iter block.

**Verdict: NOT consistent. 6 violations (2 HIGH, 3 MED, 1 LOW) and 1 superseded item.**

#### H-1 [HIGH] D-BIND fail-closed bind guard unimplemented (co-signed by both groups)

Decision D-BIND requires the engine to refuse any bind that would expose a no-auth server to a
non-loopback/non-LAN address. `src/net-guard.ts` exports `isLoopback()` but it is never imported by
`src/server.ts` or `src/main.ts` for bind refusal. Verified: `grep -rn insecureNoAuth src/` returns
zero hits; `isLoopback` absent from `src/server.ts` and `src/main.ts`. `src/main.ts:97` and
`src/server.ts:1005` pass the bind address through with no guard. The `insecureNoAuth` config key does
not exist anywhere in src/. `DEPLOY.md` preamble documents the live deployment at `0.0.0.0:8899` — the
exact configuration D-BIND was designed to block fail-closed.

**Evidence:** `src/net-guard.ts:14` (exports `isLoopback`, not wired to bind path);
`src/server.ts:28` (imports `isAllowedHost, isAllowedOrigin` only — no bind guard);
`src/main.ts:97` (bind passed through unguarded).

**Severity:** HIGH. Unenforced on an RCE + secret surface with a live `0.0.0.0` deployment.
**Action required:** Gate 6 fix (a one-`if` guard at the bind site).

#### H-2 [HIGH] ARCH-017/019 session-options-builder + per-session confinement re-walk absent (quality group R-1)

ARCH-017 designates `src/session-options-builder.ts:buildSessionOptions()` as the master test seam for
session-level SDK option assembly. ARCH-019 part-2 requires a per-session workroot re-walk (DES-031),
enforcing confinement at each session, not only at boot. `buildSessionOptions()` has zero production
importers — the gateway `claude-agent-sdk-client.ts:520-573` builds SDK options inline via `thinkingFor()`
and `curateToolsForProvider()`, bypassing the seam entirely. `src/workroot-guard.ts:findProjectMarkerAncestor()`
is imported only by session-options-builder, which is itself never called in production. The boot guard at
`src/main.ts:94` runs once; DES-031 per-session re-walk is never executed. The confinement invariant
(work-root re-verified per session) is not enforced at runtime.

**Evidence:** `src/session-options-builder.ts` (zero production importers);
`claude-agent-sdk-client.ts:520-573` (inline SDK option build, no seam call);
`src/workroot-guard.ts:findProjectMarkerAncestor()` (reachable only through the orphaned builder);
`src/main.ts:94` (single boot guard only).

**Severity:** HIGH. Confinement invariant unenforced at runtime; ARCH-017 test-seam trust not realized.
**Action required:** Gate 2 adjudication — wire the seam or formally supersede ARCH-017/019, following
the ARCH-044 precedent for explicitly signed supersession decisions.

#### M-1 [MED] D-PROC/D-KILL / FailureEnvelope / cli-lifecycle + timeout-race cluster orphaned (both groups)

Three related built-but-unwired modules: (a) `src/cli-lifecycle.ts:RealCliLifecycle` — zero production
importers; no SIGKILL escalation after grace window, no explicit temp-dir cleanup tied to session
lifecycle. (b) `src/timeout-race.ts:raceWithTimeout()` — zero production importers; `run-manager.ts:585`
uses `withSlot(() => spawner.run({signal}))` directly, bypassing the D-PROC timeout-race seam.
(c) `src/timeout-race.ts:FailureEnvelope` — zero production callers; `agent-executor.ts:218` emits a
different `{kind:'usage', data:{reason,provider,detail}}` taxonomy without `attempts` or `elapsedMs`;
the retry counter at `claude-agent-sdk-client.ts:291-302` exists but is never surfaced via FailureEnvelope.
Gateway uses `abortController.abort()` only; D-KILL SIGTERM→SIGKILL escalation sequence not connected.

**Evidence:** `src/cli-lifecycle.ts` (zero production importers);
`src/timeout-race.ts` (zero production importers/callers);
`run-manager.ts:585` (withSlot direct, no raceWithTimeout);
`agent-executor.ts:218` (different taxonomy, no FailureEnvelope);
`claude-agent-sdk-client.ts:291-302` (retry counter, not surfaced).

**Severity:** MED. Process-group kill guarantee and failure taxonomy incomplete; no active data-loss but
degrades correctness under timeout/kill scenarios.
**Action required:** Gate 2 adjudication — wire or formally supersede D-PROC/D-KILL (following ARCH-044 precedent).

#### M-2 [MED] D-REDACT `redact()` orphaned (adversarial V5)

Decision D-REDACT requires capture-time secret scrubbing before any transcript event is stored or emitted.
`src/secret-resolver.ts:88 redact()` is imported by nothing in src/. The transcript capture path at
`claude-agent-sdk-client.ts:589` stores raw events with no `redact()` applied. Secret values resolved
from `RWE_SECRET_*` env vars can appear verbatim in stored transcripts.

**Evidence:** `src/secret-resolver.ts:88` (redact() exported, zero production importers);
`claude-agent-sdk-client.ts:589` (raw event capture, no redact call).

**Severity:** MED. Secret leakage into transcripts on an RCE surface.
**Action required:** Gate 6 fix (wire redact() at the transcript capture site).

#### M-3 [MED] ARCH-015 MCP_NOT_PROVISIONED silent for named workflows (adversarial V6)

ARCH-015 mandates a typed `MCP_NOT_PROVISIONED` error when an agent call references an MCP server name
not in the provisioning list. `claude-agent-sdk-client.ts:421` silently maps an unprovisioned MCP name
to `{}` (empty allowedTools), swallowing the error. The `if (spec.script)` gate at
`submission-validator.ts:100` skips named-workflow runs from submission-time scan entirely, so an
unprovisioned name is never caught before dispatch for named workflows.

**Evidence:** `claude-agent-sdk-client.ts:421` (maps unprovisioned name to `{}`);
`submission-validator.ts:100` (named-workflow bypass).

**Severity:** MED. Silent failure degrades operator debuggability.
**Action required:** Gate 6 fix.

#### L-1 [LOW] McpRegistry wall-clock (adversarial V7)

`src/mcp-registry.ts:61` uses `new Date().toISOString()` directly instead of the injected `Clock`,
violating the C3 clock/RNG seam. Does not affect production correctness but breaks hermetic test seam.

**Evidence:** `src/mcp-registry.ts:61`.

**Severity:** LOW. One-line fix, opportunistic.

#### Not-a-violation: SessionInitRecord superseded by ARCH-044

Adversarial flagged `SessionInitRecord` (defined at `session-options-builder.ts:23-37`) as never emitted.
Quality's response: ARCH-044 (signed later) explicitly superseded it, replacing it with `HarnessDescriptor`
emitted via `redactHarness()`, which IS wired end-to-end. **Later-signed ARCH-044 wins** — not a violation.
Residual: `thinkingMode` absent from `HarnessDescriptor`, so it is not auditable in the harness log.
ARCH-044 deliberately narrowed scope. Recorded as: superseded-with-residual, intentional per ARCH-044,
LOW observability debt.

#### Not-a-violations confirmed by both groups

D-DOS semaphore correctly wired; host-ambient MCP isolation (VAL-003) holds; ARCH-018 asset classifier
correct; D-SEC two-layer secret containment wired at composition root; `withSlot()` semaphore gates DOS;
ARCH-033 Host/Origin allowlist correctly enforced.

#### Architecture consistency conclusion

Architecture consistent: **no**. 2 HIGH + 3 MED + 1 LOW violations, all in the v3 built-but-unwired
control set. The v12 REQ-076..079 ARCH chain is fully satisfied (no panel finding touches v12 scope).

**Overall conclusion: send back to Gate 6** for D-BIND, D-REDACT, and ARCH-015 (fixable, concrete).
**Gate 2 adjudication recommended** for ARCH-017/019 and D-PROC/D-KILL (wire vs formally supersede,
following the ARCH-044 precedent).

### Validation & handover check (v12)

- **VAL-085 (REQ-076):** `real:true`, green — live `system_info` returned CPU/mem/disk metrics.
- **VAL-086 (REQ-077):** `real:true`, green — `system_info` process metrics (pid, uptime, heap, rss).
- **VAL-087 (REQ-078):** `real:true`, green — `models_list` enriched with provider/context/pricing.
- **VAL-088 (REQ-079):** `real:true`, green — schema drift-lock confirmed.
- **`08-validation.md`:** status: passed. Gate 7.5 v12 ROUND 1 PASSED 2026-08-15.
- **No mock-only/unverified gaps for v12 chain:** trace reports 0 未驗證需求, 0 僅mock驗證 for REQ-076..079.
- **REQ-012:** 1 未真實驗證 (OIDC, D5 deferral). User-deferred; not a Gate 7.5 send-back. Known tech debt.
- **998/998 regression pass.** 37 tools. `npx tsc --noEmit` clean.
- **`README.md`:** present, current-state (v12, 2026-08-15). Step-by-step quickstart (6 numbered steps).
  All 37 tools documented. No stale commands or superseded content.
- **`DEPLOY.md`:** present, current-state. §0 step-by-step quickstart (逐字可貼上執行). §7 変更紀錄
  includes v12 entry (2026-08-15). No new config keys in v12. No stale current-state docs.
- **DEPLOY.md doc-debt (LOW, does not change conclusion):** §1b lines 276-290 carry a historical v2/pre-v3
  `defaultAllowedTools` blockquote with an inline "(v3 更新, 2026-07-11): 上述 v2 敘述已被 D-V3M-3 取代"
  supersession note — append-with-inline-marker rather than clean supersede-not-append. Config keys also
  appear in §6 scenario-recipe JSON examples. Risk is low (current truth stated inline; quickstart
  real-validated this round). Fold cleanup into the Gate 6 round-trip.
- **Validation verdict:** Gate 7.5 real-tier all-green for v12 REQ-076..079. README + DEPLOY present.
  No mock-only/unverified REQ for touched items. REQ-012 gap user-deferred and recorded.

### Retro (v12 — system metrics + models enrichment)

- **What changed:** `system_info` MCP tool — CPU usage (user/system/idle %), memory (total/used/free,
  usedPercent), disk (each mount point: size/used/available/usedPercent), all in SI-prefixed units;
  process metrics (pid, uptimeSeconds, heapUsedMB, heapTotalMB, rssMB). `models_list` enriched with
  provider, contextWindow, maxOutput, and pricing fields. Input/output schemas drift-locked by
  schema-registry test (REQ-079). Additive only — no v1-core, no run-lifecycle, no config change.
- **Impact closure:** REQ-076..079 fully chained. 998/998 regression. Gate 7.5 v12 ROUND 1 PASSED
  2026-08-15. ZERO new trace gaps introduced.
- **Panel architecture findings are pre-existing, none introduced by v12:** The 6 violations are all in
  the v3 built-but-unwired control set (session-options-builder, cli-lifecycle, timeout-race, net-guard
  bind guard, redact, ARCH-015 named-workflow path). The panel's v12-era line numbers confirm current-tree
  findings. Zero violations touch the REQ-076..079 chain.
- **Root cause of built-but-unwired pattern:** ARCH decisions (Gate 2) created module contracts; Gate 6
  created the modules; but the gateway composition (`claude-agent-sdk-client.ts`, `main.ts`) was never
  updated to call them. Future Gate 6 exit criteria should include a production-caller check (zero
  importers on a wired ARCH decision = open finding).
- **Known tech debt (all pre-existing, all recorded):**
  - [HIGH] D-BIND bind guard unimplemented — Gate 6 fix required before any `0.0.0.0` deployment.
  - [HIGH] ARCH-017/019 session-options-builder + per-session re-walk absent — Gate 2 adjudication.
  - [MED] D-PROC/D-KILL / FailureEnvelope / cli-lifecycle + timeout-race orphaned — Gate 2 adjudication.
  - [MED] D-REDACT `redact()` orphaned — Gate 6 fix.
  - [MED] ARCH-015 MCP_NOT_PROVISIONED silent for named workflows — Gate 6 fix.
  - [LOW] McpRegistry wall-clock — one-line fix, opportunistic.
  - [LOW] SessionInitRecord superseded by ARCH-044 (thinkingMode not auditable, intentional).
  - [LOW] DEPLOY.md doc-debt (historical blockquote append-with-marker; §6 scenario JSON config keys).
  - Trace gaps: REQ-012/TASK-018 (OIDC, D5), IMPL-082 (TDD-label), UT-058/UT-064/IT-057 (iter drift).
- **Gate 7.5:** PASSED 2026-08-15. VAL-085..088 `real:true` (live engine, 37 tools, 998/998 regression).

## v11 GATE 8 FIX-ITERATION REVIEW (2026-08-09, superseded by v12 above)

> This section supersedes "## v10 GATE 8 REVIEW (2026-08-01)" below (kept for history).
> Fix-mode iteration: impact closure on REQ-066 (version autofill) and REQ-067 (read-only Issues dashboard).
> Scope: IMPL-100 touching three files — `src/github/issue-reporter.ts`, `src/server.ts`,
> `src/dashboard-page.ts`. No panel spawned (fix scale, self-decided per SDLC fix-mode rules).
>
> **Trace --check result (regenerated this review):** 532 items, 20 gaps — ZERO new gaps from v11.
> REQ-066/067 are fully chained (REQ→ARCH→TASK→DES→IMPL→UT/IT→VAL) with VAL-075/076 real:true.
> Gap breakdown: 1 HIGH (REQ-012 未真實驗証 — OIDC deferred D5, pre-existing known tech debt) /
> 17 MID (REQ-068..075 × 2 each = future sprint work, 16; IMPL-082 TDD-label, 1) /
> 2 LOW (UT-058 drift v6 behind DES-038 v11 — flagged since F1 design stage; TASK-018 OIDC unimplemented).
> All 20 are pre-existing; none introduced by this iteration.

### Consistency self-check (architecture, v11 scope only)

Checked IMPL-100's three touched files against the Gate 2 ARCH/INV/rationale in 02-architecture.md:

- **ARCH-023 (v11 NB, REQ-066):** `resolveEngineVersion()` export replaces the hardcoded `ENGINE_VERSION`
  constant; `IssueReportInput.version?` optional caller override; `renderIssueBody` always renders all five
  Environment fields with `_none_` placeholders; `report()` effective-version rule (`input.version?.trim() ||
  cfg.engineVersion`). Implementation in `src/github/issue-reporter.ts` matches the ARCH-023 v11 annotation
  exactly. **No violation.**
- **ARCH-024 (v11 NB, REQ-067):** read-only `/api/issues` + `/api/issues/:number` endpoints on the
  existing `handleDashboardRequest` transport (ARCH-011); degrade-to-200 on missing token or API error (never
  500); `/dashboard/issues` view using ARCH-029's dashboard page. Implementation in `src/server.ts` and
  `src/dashboard-page.ts` matches the ARCH-024 v11 annotation exactly. **No violation.**
- **ARCH-001 (MCP tool surface):** optional `version` field added to `issue_report` inputSchema — backward-
  compatible (optional, existing callers unaffected). **No violation.**
- **ARCH-011/ARCH-029 (dashboard HTTP + page):** new `/api/issues*` predicate follows the `startsWith`
  pattern established by `/api/workflows` (the ARCH-029 routing-gap fix pattern, documented in the v8 Slice 3
  retro). **No violation.**
- **ARCH-016 (server-side secrets):** `RWE_SECRET_GITHUB_TOKEN` stays in the server-side secret store;
  the new `/api/issues` routes use the same `issueReporter` instance that already holds the token
  server-side. **No violation.**
- **ARCH-033 (Host/Origin allowlist):** the new routes go through the same top-level dispatcher that applies
  `isAllowedHost`/`isAllowedOrigin` before routing to `handleDashboardRequest`. **No violation.**
- **DES-013 (null-vs-throw / never 500):** both `/api/issues` routes degrade to HTTP 200 `{degraded:...}`
  on any `{ok:false}` result — no 500 escapes. **No violation.**
- **DES-038/KP-12 (XSS invariant):** all remote content in `src/dashboard-page.ts` is rendered via the
  `el()` helper's `textContent` assignment or direct `.textContent`; `innerHTML=''` is used only to clear
  containers (empty string, no user content); `link.setAttribute('href', data.url||'#')` is acceptable
  (GitHub API URLs are always HTTPS; display text is separately `textContent`). **No violation.**
- **Iter drift check (the fix chain guard):** IMPL-100 at iter v11; DES-037/038 at v11; UT-057/IT-043/
  IT-044/VAL-075/076 at v11. The one LOW drift flagged (UT-058 v6 vs DES-038 v11) was created at F1
  (design bump) and pre-dates this implementation; UT-058's existing 9 cases cover the underlying
  `GithubIssueClient` read ops (unchanged in v11) and the v11 dashboard addition is covered by IT-044.
  No new drift introduced by IMPL-100.

Architecture consistent: **yes** (no violations found across all lenses checked).

### Validation check (v11)

- **VAL-075 (REQ-066):** real:true, green — GitHub issue #7 filed with caller `version:"v1.4.0-val75"` →
  body contained `Version: v1.4.0-val75`; issue #8 filed without version → body contained
  `Version: 0.1.0 (v0.4.0-39-g5832599)` (engine autofill via `resolveEngineVersion()`); all five
  Environment fields rendered. Both issues closed after evidence capture.
- **VAL-076 (REQ-067):** real:true, green — `GET /api/issues` → 200 `{open:[2 items],resolved:[2 items]}`;
  `GET /api/issues/7` → 200 full IssueView; `GET /api/issues/999999` → 404 `{error:...}`; no-token degrade
  → 200 `{degraded:"GitHub not configured"}`; `/dashboard/issues` → HTML with Open/Resolved groups and
  `#issue-detail` panel.
- **08-validation.md:** status: passed (front-matter).
- **README.md + DEPLOY.md:** current-state confirmed. README fully rewritten at Gate 7.5 v11. DEPLOY.md
  preamble de-stacked (v3/v6/v7 blockquotes removed), §0 Quickstart added, §1b `RWE_SECRET_GITHUB_TOKEN`
  documented (single row, no duplication), §7 v11 entry in 変更紀錄. No superseded commands or keys found
  outside §7 変更紀錄. `設定総表` (§1b env-var table) is deduplicated — `RWE_SECRET_GITHUB_TOKEN` appears
  exactly once (line 377 of DEPLOY.md).
- **No config-file changes:** v11 reuses the existing `RWE_SECRET_GITHUB_TOKEN` secret store key.
- **mock-only / 未真實驗証 for touched REQs:** none — trace shows REQ-066/067 have real:true VAL items.

### Retro (v11 — version autofill + Issues dashboard, fix iteration)

- **What changed (IMPL-100, 3 files):**
  - `src/github/issue-reporter.ts` — new `resolveEngineVersion(exec?)` export (pkg.version + best-effort
    `git describe`, injectable for unit tests); `IssueReportInput.version?` optional field; `renderIssueBody`
    widened to accept both `version` and `engineVersion` (backward-compat) and always renders all five
    Environment fields with `_none_` placeholders; `report()` reads caller-supplied version with whitespace-
    only fallback to engine autofill. The hardcoded `ENGINE_VERSION = '1.0.0'` constant in `src/server.ts` is
    replaced by a call to `resolveEngineVersion()` at module load — `initialize` response now carries the real
    version string including git-describe.
  - `src/server.ts` — `issue_report` inputSchema gains optional `version` field; `handleDashboardRequest`
    grows a 5th `issueReporter` parameter (already wired from the composition root); new `/api/issues` and
    `/api/issues/:number` route branches; top-level dispatcher predicate widened with `||
    startsWith('/api/issues')` (the ARCH-029 routing-gap pattern).
  - `src/dashboard-page.ts` — Issues nav link; `#issues` section with `#issues-open`, `#issues-resolved`,
    `#issue-detail`; `currentRunId()` special-cases `"issues"` segment; `isIssuesView()` helper; `loadIssues()`
    / `renderIssueList()` / `loadIssueDetail()` — all remote content via `textContent` (XSS-safe).
- **Impact closure:** REQ-066 and REQ-067 fully chained and real-validated (VAL-075/076 real:true, Gate 7.5
  v11 ROUND 1 PASSED 2026-08-09). Issues #7 and #8 filed and verified live against the production engine
  (`rwe.service`, `127.0.0.1:8787`, `tools/list` → 36 tools). Zero regressions: full suite 697 pass / 156
  files; `npx tsc --noEmit` clean.
- **Design-stage decision to note:** the `toErrEnvelope` pre-existing bug (surfaced in v10) had already
  been fixed, so IMPL-100 inherits correct coded-error surfacing at the tool boundary without additional work.
  The `resolveEngineVersion()` seam design (injectable `exec`) was chosen specifically to keep the unit
  tests hermetic (no git subprocess in CI) — the production path calls `execSync('git describe --tags
  --always')` at module load with a try/catch fallback, ensuring a non-empty version even in a shallow clone.
- **Residual tech debt (all pre-existing, none introduced here):**
  - UT-058 (v6) trails DES-038 (v11) — LOW drift, flagged since the F1 design stage. UT-058's 9 original
    cases cover the underlying `GithubIssueClient` read primitives (unchanged); the v11 Issues dashboard
    addition is covered by IT-044 at v11. No behavioral gap; cosmetic iter lag only.
  - IMPL-082: no unit/IT coverage (TDD-label gap, pre-existing since v4).
  - TASK-018 / REQ-012: OIDC deferred by user decision D5 — unchanged.
  - REQ-068..075 (future sprint): tag-triggered self-update + enhanced graph dashboard, not yet started.
- **Gate 7.5:** PASSED 2026-08-09, ROUND 1. Trace `--check`: 532 items, 20 gaps — the REQ-066/067 chain
  is fully closed (REQ→ARCH→TASK→DES→IMPL→UT/IT→VAL with real:true); remaining 20 gaps are ALL pre-existing.
  ZERO new gaps introduced by this fix iteration.

## v10 GATE 8 REVIEW (2026-08-01, superseded by v11 above)

> This section supersedes "## v9 GATE 8 REVIEW (2026-08-01)" below (kept for history).
> This round opens a NEW theme — **efficient large-codebase seeding** — landing its first two vertical
> slices, both already-implemented, GREEN, and real-validated. The accepted architecture is the 4-architect
> panel debate recorded in `docs/seed-sync-architecture.md`. Slice 1 (REQ-063): accept `Content-Encoding:
> gzip|deflate` on the `/mcp` body (bounded on BOTH the compressed input AND the decompressed output, so a
> gzip bomb can't OOM) + turn the opaque raw 413 into a typed, actionable `{code:'BODY_TOO_LARGE', cap, phase,
> hint}`. Slice 2 (REQ-064/065, the main event): a content-addressed blob store (`CasStore` — immutable blob
> pool + per-namespace SQLite refset, byte-verify-under-computed-hash, per-namespace `missing`) + assemble a
> run workspace from a `seedManifest:[{path,sha256,exec?}]` through the SAME `materializeSeed` guardrails,
> failing fast with `MISSING_BLOBS` before any durable work. Both slices are additive — the inline
> `{path,contentB64}` seed and `asset_push` are untouched.
> Ledger items added this round: REQ-063 (Slice 1) + REQ-064/065 (Slice 2) (requirements pre-written, iter
> v10) → ARCH-036 + ARCH-037 → TASK-057 + TASK-058 → DES-055 + DES-056/057 → IMPL-098 + IMPL-099 → IT-058
> (Slice 1) + IT-059 + IT-060 (Slice 2) → VAL-072 + VAL-073 + VAL-074.

### Retro (v10 — efficient large-codebase seeding, Slices 1+2)

- **What changed — Slice 1 (compressed body + typed error):** `src/server.ts` — a new decompressed-output cap
  `MAX_DECOMPRESSED_BYTES` (8× the compressed cap), a typed `BodyTooLargeError{code,cap,phase,hint}`, `readBody`
  split into a raw capped `readBodyBuffer` + a new `readBodyDecoded` (honors `Content-Encoding: gzip|deflate`
  with a bounded output so a bomb throws mid-inflate), the `/mcp` handler routed through `readBodyDecoded`, and
  the typed 413 emitted on both the `/mcp` and webhook catch blocks. The webhook keeps the RAW un-decoded body
  (its HMAC is over the delivered bytes) — it only gains the typed 413.
- **What changed — Slice 2 (the CAS substrate):** NEW `src/cas-store.ts` (`CasStore` — fs blob pool
  `blobs/<sha[0:2]>/<sha>` + SQLite per-namespace refset; byte-verifying `putBlob` that stores under the
  COMPUTED hash and throws `BLOB_HASH_MISMATCH` on a claim mismatch; per-namespace `missing`/`hasRef`;
  `readBlob`/`readBlobSync`); `src/workspace-seed.ts` extracted the shared per-path `seedPathVerdict` (reused by
  `materializeSeed` and the NEW `materializeManifest`, which reads CAS bytes + applies the masked exec bit) +
  the `ManifestEntry {path,sha256,exec?}` schema (regular files only); `src/run-manager.ts` threads a `cas?`
  dep, fails fast with `MISSING_BLOBS`/`CAS_UNAVAILABLE` before `createRun`, and assembles from the CAS;
  `src/types.ts` added `RunSpec.seedManifest`/`seedNamespace`; `src/mcp-facade.ts` forwards them; `src/server.ts`
  constructs the `CasStore` (`casDir` config), threads `cas` into `callTool`, and adds `blob_put`/`seed_plan`.
- **Key decisions (see the DES-055/056/057 rationale + `docs/seed-sync-architecture.md`):** TWO caps not one
  (compressed input + decompressed output — the compressed cap alone can't stop a bomb); the webhook keeps the
  raw body (HMAC is over delivered bytes, must not auto-decompress); the CAS byte-verifies and stores under the
  COMPUTED hash with NO exists-skip (closes hash-poisoning + confused-deputy at once); `missing`/`hasRef` are
  PER-NAMESPACE not global (closes the cross-tenant dedup oracle); ONE shared `seedPathVerdict` so the inline
  and CAS seed paths can never diverge; the manifest is regular-files-only with `exec?` the sole masked metadata
  bit and NO symlinks ever (retrofit-avoidance); fail fast on `MISSING_BLOBS` before any durable work.
- **The `toErrEnvelope` fix — a PRE-EXISTING latent bug fixed this round.** `src/mcp-facade.ts:toErrEnvelope`
  previously returned `err.name` (`'Error'`) for run-manager `codedError`s, so `RUN_ADMISSION_LIMIT` /
  `NESTING_*` (and the new `MISSING_BLOBS`) surfaced through `workflow_run` as a useless `'Error'` code — the
  branchable code was silently swallowed at the tool boundary since v8. It now prefers `.code`, falling back to
  the Error name only for a genuinely un-coded error. This was mandatory for the CAS upload-then-retry loop (the
  client keys on `MISSING_BLOBS`) and also un-swallows the pre-existing admission/nesting codes.
- **No regressions.** Full suite 683 pass / 155 files (up from 671 / 152 — three new integration files:
  compressed-body, cas-store, seed-manifest-http), `npx tsc --noEmit` clean. The change is additive: the inline
  `{path,contentB64}` seed and `asset_push` are untouched; the existing `workspace-artifacts-seed.test.ts`
  (exercising the `materializeSeed`→`seedPathVerdict` refactor) stays green; `workflow_run` gains only additive
  fields; `blob_put`/`seed_plan` are new tools older clients ignore.
- **Deferred to later increments (per `docs/seed-sync-architecture.md` §Roadmap):** the raw-streaming
  `POST /assets/blob/<sha256>` blob endpoint (no base64, no 8 MiB cap — the many-large-files transport), per-tenant
  quotas + immutable-pool refcount GC, the client `push_workspace.py` helper (git-as-client-cache: memoize
  `gitOID→sha256` so a re-align is `git status`-fast) + the `rwe seed` CLI, and the optional `seedRef:{repoUrl,sha}`
  engine-pull behind an egress allowlist (CI/forge/air-gapped). Rejected outright (not deferred): rsync (bypasses
  `materializeSeed`, second auth root) and git-bundle-as-transport (engine-minted baseline has no common ancestor →
  zero delta). Deferred UNCHANGED from v8/v9: SSE, RUN-dag parallel-group markers, and full OIDC (REQ-012, D5 — the
  Host/Origin allowlist + loopback/LAN bind is the interim control the blob route will inherit).
- **Gate 7.5:** PASSED 2026-08-01. Live production engine (systemd `rwe.service`, `127.0.0.1:8787`) restarted with
  the v10 code, `tools/list` → 36 tools incl `blob_put`/`seed_plan`. Slice 1: a gzip'd `tools/list` decoded (34
  tools); an oversized uncompressed body → typed 413 `{code:'BODY_TOO_LARGE', cap:8388608, hint:…}`. Slice 2:
  uploaded two blobs to namespace `liveproj` (`seed_plan` 2 missing → `[]` after `blob_put`); `workflow_run` with
  the `seedManifest` completed; `workflow_artifacts` byte-identical sha256; on-disk modes `0755` (`exec:true`) /
  `0644` (`exec:false`); an un-uploaded blob → `MISSING_BLOBS`. See VAL-072 / VAL-073 / VAL-074. Trace `--check`:
  the 6 REQ-063/064/065 gaps (untraced requirements) are CLOSED by this round's chain; the remaining 3 gaps are ALL
  pre-existing (REQ-012 / TASK-018 OIDC-deferred, IMPL-082 TDD-label) — ZERO new gaps introduced.

## v9 GATE 8 REVIEW (2026-08-01)

> This section is superseded by "## v10 GATE 8 REVIEW (2026-08-01)" above (kept for history).
> This section supersedes "## v8 DEFER A GATE 8 REVIEW (2026-08-01)" below (kept for history).
> This round lands ONE already-implemented, GREEN, real-validated slice: **v9 — workflow discovery / reuse
> decision**, a new discovery theme. Before an operator reuses a registered workflow (or authors a new one),
> they can now answer "what is it FOR?" and "what SHAPE does it have?" WITHOUT running it or reading its
> script — a workflow's purpose (`meta.description` + `phases`) is queryable via `workflow_list` +
> `workflow_get`, and its predicted DAG (a pure static scan) is inspectable via `workflow_get.skeleton` +
> `GET /api/workflows/:name/skeleton`, drawn on the dashboard card. Purely ADDITIVE read layer — no
> registration-storage/schema change (description derived on-demand → migration-free + always in-sync), no
> run-lifecycle/sandbox/journal change, no change to any existing tool's semantics beyond an additive
> `description` field on `workflow_list`.
> Ledger items added this round: REQ-061 + REQ-062 (requirements pre-written, iter v9) → ARCH-035 →
> TASK-056 → DES-054 → IMPL-097 → UT-064 (5 cases) + IT-057 (4 cases) → VAL-070 + VAL-071.

### Retro (v9 — workflow discovery / reuse decision)

- **What changed:** (a) a NEW pure module `src/workflow-meta.ts` — `parseMeta(script) → {description, phases}`
  (reuses the sandbox `checkMeta` guard to obtain the validated pure-literal meta, then evaluates it in an
  empty, timeout-bounded VM; degrades to empty, never throws) + `parseWorkflowSkeleton(script) →
  SkeletonNode[]` (a pure static scan of `phase`/`agent`/`parallel`/`workflow` calls in order — parallel-group
  ids, sub-workflow names, best-effort `dynamic` markers for loop/conditional bodies; never executes, never
  throws). (b) `WorkflowCatalog.list()` now returns each `{name, version, createdAt, description}` (description
  derived on-demand) and a NEW `getFull(name)` returns the full row (throws `CatalogNotFoundError` for
  unknown). (c) a NEW `workflow_get({name})` MCP tool → full detail + `skeleton`, unknown → typed
  `WORKFLOW_NOT_FOUND` envelope; `workflow_list` widened with `description`. (d) a NEW dashboard route
  `GET /api/workflows/:name/skeleton`. (e) the dashboard workflow card shows the description and is clickable →
  a rendered predicted DAG (parallel-group boxes, `×? (dynamic)` markers, the description as purpose text).
- **Key decisions (see DES-054 rationale):** on-demand `parseMeta` at read time rather than a stored/migrated
  `description` column — migration-free and always in-sync with the current script; the skeleton is an
  explicitly BEST-EFFORT static prediction (loop/conditional shapes resolve only at run time → flagged
  `dynamic`, never claimed exact) that never runs the script; and the meta VM eval is safe by construction
  because it evaluates the object text ONLY when the reused `checkMeta` guard reports a pure literal, in an
  empty prototype-free timeout-bounded context (side-effect-free, bounded, degrades to empty on any failure).
- **No regressions.** Full suite 671 pass / 152 files, `npx tsc --noEmit` clean. The change is a purely
  additive read layer: no existing tool's behavior changed beyond the additive `description` field on
  `workflow_list` (older clients ignore it); `workflow_get` + `/skeleton` are new read-only surfaces. No src
  code touched outside the discovery path.
- **Deferred items UNCHANGED from v8 (still open, not addressed this round):** SSE (the dashboard keeps its 3s
  poll), `parallel()` group markers on the RUN dag (needs a sandbox-child IPC change — note the STATIC
  skeleton added here DOES carry parallel groups, but the live-run DAG still does not), and full OIDC
  (REQ-012, D5 — the separate deferred auth track; a public `0.0.0.0` bind without OIDC remains the documented
  caveat, with the Host/Origin allowlist + loopback/LAN bind as the interim control).
- **Gate 7.5:** PASSED 2026-08-01. Live production engine (systemd `rwe.service`, `127.0.0.1:8787`) restarted
  with the v9 code: registered `disc-demo`, confirmed `workflow_list` description, `workflow_get`
  description + phases + skeleton `[agent(parallel:1), agent(parallel:1), agent, workflow:notify]`, and the
  Playwright-headless dashboard card → clicked → predicted DAG with the parallel group + workflow node + the
  description as purpose text. See VAL-070 / VAL-071. Trace `--check`: the 4 REQ-061/062 gaps (untraced
  requirements) are CLOSED by this round's chain; the remaining 3 gaps are ALL pre-existing (REQ-012 / TASK-018
  OIDC-deferred, IMPL-082 TDD-label) — ZERO new gaps introduced.

## v8 DEFER A GATE 8 REVIEW (2026-08-01)

> This section supersedes "## v8 SLICE 2c + DEFER B GATE 8 REVIEW (2026-08-01)" below (kept for history).
> This round lands ONE already-implemented, GREEN, real-validated slice: **Defer A — crash durability**,
> the last core v8 trigger-durability gap. A run in-flight when the engine crashes/restarts is now
> RESUMABLE, not lost. Achieved via **Option X**: reuse the EXISTING ResumeCache/journal-replay (the same
> machinery suspend/resume relies on) plus a non-terminal `interrupted` status assigned at boot recovery
> and a persisted-journal READ-BACK — NO new sandbox-checkpoint / VM-snapshot protocol. No v1-core change
> (RunSpec/RunStore shapes, the journal format, and the terminal state machine untouched) — one new
> `RunStatus` value, one boot-recovery reclassify, one port read-back method (two impls), one rehydration-
> path change, one cosmetic CSS rule.
> Ledger items added this round: REQ-059 + REQ-060 (requirements pre-written, iter v8) → ARCH-034 →
> TASK-055 → DES-053 → IMPL-096 → IT-056 (4 cases, + a one-line IT-006 assertion update) →
> VAL-068 + VAL-069.

### Retro (v8 Defer A — crash durability)

- **What changed:** (a) `'interrupted'` added to the `RunStatus` union (`src/types.ts:5`) — a RESUMABLE,
  NON-terminal boot-recovery status distinct from user `suspended`/`stopped` (NOT in `TERMINAL`
  `src/run-manager.ts:69`, so it never fires onTerminal and stays resumable). (b) `hydrateAll` reclassifies
  boot-time `running` rows → `interrupted` (`src/store/sqlite-run-store.ts:222-227`, was force-to-`failed`),
  logging `… N re-classified running→interrupted (resumable)`. (c) a NEW `RunStore.getJournal(runId)`
  read-back (`src/run-store.ts:53-57`, `:185-187`; `src/store/sqlite-run-store.ts:113-124`) — reads
  journal.jsonl, drops the terminal `{type:'result'}` marker, ROBUST to a crash-truncated final line (an
  unparseable tail is skipped, not thrown — a real SIGKILL can leave a half-written line). (d) `_requireLive`
  now accepts `interrupted`, populates the rehydrated entry's `journal` from `getJournal` (was hard-coded
  `journal:[]`), and re-resolves a NAMED workflow's script from the catalog (`src/run-manager.ts:338,
  347-354, 369`); `resume()` accepts `interrupted` (`:271-273`). (e) a cosmetic `.st-interrupted` dashboard
  color (`src/dashboard-page.ts:28`).
- **Key decision:** Option X — reuse ResumeCache + a status gate + journal read-back, NOT a VM/sandbox
  checkpoint. The journal of settled `agent()`/`workflow()` calls IS the durable checkpoint; re-executing
  the script against a cache populated from it reconstructs the run's position by replaying settled calls
  and running only the unfinished tail — no new serialization format, reusing tested machinery. A
  mid-flight-at-crash call (dispatched but never journaled → cache MISS → live re-run on resume) is the
  SAME semantics suspend/resume already carries — a documented caveat, not silent loss; and a re-run tail
  call's non-idempotent side effects (e.g. an already-sent email) may repeat — the workflow author's
  responsibility, the same boundary suspend/resume has always had.
- **The real Gate-7.5 value story — a PRE-EXISTING bug found via live crash testing.** A NAMED-workflow run
  (`start({name})`) stores `spec.script = null` (start() resolves the script from the catalog at launch);
  `_requireLive` used `spec.script ?? ''`, so ANY restart-resume of a named workflow — not only a crash, but
  the pre-Defer-A suspended-run restart-resume path too — executed an EMPTY script and returned `undefined`,
  with only the pre-crash agent journaled. Every unit test missed it because they ALL used inline
  `start({script})`. Live Gate-7.5 crash testing of a named workflow (`lr4`) exposed it: the resumed run
  "completed" in ~0.13s with a null result and no re-dispatch. Fixed by re-resolving the script from the
  catalog in `_requireLive`, mirroring `start()`; after the fix the live resume returned a 5-element array
  of real opus responses. IT-056's third case is the deliberate regression guard. This is exactly the kind
  of confinement/rehydration bug the real-run validation gate exists to catch that a mock suite cannot.
- **Cross-slice interaction (recorded):** `hydrateAll` now yields `interrupted` (non-terminal) for a
  crashed run instead of `failed` (terminal). The Slice-4 boot-reconcile completeness argument ("every
  continuation target is terminal on boot, because hydrateAll marks a cross-restart running run failed")
  therefore shifts: a continuation whose target was running-at-crash now stays pending until that target is
  RESUMED to a terminal status, rather than being force-skipped at boot as a `failed` target — which is the
  more correct behavior (the downstream fires iff the resumed run actually completes), not a regression.
- **Gate 7.5:** PASSED 2026-08-01. Live production engine (systemd `rwe.service`, `127.0.0.1:8787`):
  registered named workflow `lr4` (5-iteration opus `agent()` loop), ran it, `kill -9` of the engine at
  ~1 agent done (status `running`); systemd restarted it. Boot log
  `hydrateAll: … 1 re-classified running→interrupted (resumable)`; `workflow_status` → **`interrupted`**
  (not `failed`); `workflow_resume` re-executed (~10s, re-dispatching the 4 remaining agents) →
  **`completed` with a 5-element array of real opus responses** (not `undefined` — the script-re-resolution
  fix). REQ-059/060 `real:true` (VAL-068/069).
- **No regressions:** full suite **662 pass / 150 files**, `npx tsc --noEmit` clean. No v1-core change —
  RunSpec/RunStore shapes, the journal format, the sandbox protocol, and the terminal state machine are
  untouched; Option X adds one status value + one boot reclassify + one read-back method + one rehydration
  change + one CSS rule. The one existing test touched is IT-006 (`run-store-persistence.test.ts`), a
  one-line assertion update (`interrupted` was `failed`) — the behavior REQ-060 deliberately changes, NOT a
  new IT id.
- **Still deferred (recorded, not this increment):** **SSE** (the dashboard keeps its 3s poll), **parallel()
  group markers** (needs a sandbox-child IPC change), the **static pre-read skeleton + `scriptVersion`
  cache**; and, as accepted caveats of Option X, the **mid-flight-at-crash re-run** (correct-by-design, same
  as suspend/resume) and **side-effect idempotency** of a re-run tail call. Full OIDC (REQ-012, D5) stays
  deferred; a public `0.0.0.0` bind without OIDC remains a documented deployment caveat (the Host/Origin
  allowlist REQ-056 is the interim control).
- **Trace note:** all Defer-A work items use `###` headings and this section deliberately avoids ID-shaped
  sub-headings, so it introduces no scanner collision (trace.py parses only `###`).

## v8 SLICE 2c + DEFER B GATE 8 REVIEW (2026-08-01, historical — superseded by the v8 Defer A section above)

> This section supersedes "## v8 SLICE 4 GATE 8 REVIEW (2026-08-01)" below (kept for history). This
> round lands TWO already-implemented, GREEN, real-validated slices: **Slice 2c — cross-restart DAG
> persistence** (the one real data-loss the observability slices left open: after a restart an
> out-of-process composite run's nested DAG/phases/agent-frames FLATTENED) and **Defer B — external-
> ingress security** (a Host/Origin allowlist + an HMAC-verified webhook ingress + a durable webhook
> registry — the interim access control before OIDC). No v1-core change in either — one engine-owned
> side table + one terminal-edge write (2c); one top-of-handler guard + one new route + one durable side
> table + three MCP tools (Defer B).
> Ledger items added this round: REQ-055 (2c) + REQ-056/057/058 (Defer B, requirements pre-written) →
> ARCH-032 + ARCH-033 → TASK-053 + TASK-054 → DES-050 + DES-051 + DES-052 → IMPL-094 + IMPL-095 →
> IT-052 (2 cases) + UT-063 (7) + IT-053 (5) + IT-054 (8) + IT-055 (1) → VAL-064 + VAL-065/066/067.

### Retro (v8 Slice 2c — cross-restart DAG persistence)

- **What changed:** a new `RunDagSnapshot {phases, agents, workflowNodes}` (`src/run-store.ts:60-65`) +
  `RunStore.saveSnapshot` port method, captured ONCE at the authoritative terminal `_transition`
  (`src/run-manager.ts:373-378`, via the in-process AgentExecutor's `getAllRecords()` so the persisted
  agents carry `label`/`phase`/`frame`/`startedAt`/`endedAt`, not just tokens), overlaid on `getRun`
  read-back in BOTH stores (`src/run-store.ts:150-158`, `src/store/sqlite-run-store.ts:179-193`) with a
  `?? deriveAgentRecords(...)` / `?? []` fallback. A migration-free side table
  `run_snapshots(runId PRIMARY KEY, json TEXT)` (`INSERT OR REPLACE`).
- **Key decision:** snapshot ONCE at the terminal edge (not incrementally — no torn half-tree, covers
  failed/stopped via the single choke); overlay-with-fallback keeps it strictly backward-compatible (a
  pre-change / no-snapshot run reconstructs exactly as today, never worse, never a crash); persist the
  enriched `getAllRecords()` (not the token-only transcript derivation) so `buildDagModel` regroups by
  `frame` + shows durations after a restart; a migration-free side table (same "don't touch v1 core"
  stance as the scheduler/continuation tables).
- **Gate 7.5:** PASSED 2026-08-01. Live engine restarted mid-run: `phase('top') → workflow('s2c-mid'){
  phase('p1') → workflow('s2c-leaf') }` — before restart `/api/runs/:id/dag` children `[(s2c-mid,1)]`;
  after restart STILL `[(s2c-mid,1)]` + `phases ['top']` + `workflowNodes ['s2c-mid','s2c-leaf']` — the
  DAG did NOT flatten (reversing the Slice-3 documented flattening). REQ-055 `real:true` (VAL-064).

### Retro (v8 Defer B — external-ingress security)

- **What changed:** (a) pure allowlist helpers `isAllowedHost`/`isAllowedOrigin` (`src/net-guard.ts:47-67`)
  enforced by a TOP-of-handler 403 guard uniform across `/mcp`, `/api/*`, `/dashboard`, `/hooks/*`
  (`src/server.ts:867-870`), plus a mutable `boundPort` assigned after listen (`:861`, `:986`) so the
  closure knows the real port. (b) a NEW durable `WebhookRegistry` (`src/webhook-registry.ts`) — SQLite
  side tables `webhooks` + `webhook_deliveries`, `create`/`list`/`delete`/`deliver`, the fail-closed
  verify+fire (`createHmac`/`timingSafeEqual` over the RAW body + ±300s window + `INSERT OR IGNORE`
  dedup + `runManager.start` pre-bound), reached through structural `RunManagerPort`/`CatalogPort` seams.
  (c) a `POST /hooks/:id` ingress route (`src/server.ts:895-917`) + `webhook_create`/`list`/`delete` MCP
  tools + config key `webhookDbPath`.
- **Key decision:** fail-OPEN on an absent Origin, fail-CLOSED on an absent Host (an absent Origin is the
  normal programmatic case — a fail-closed Origin check would break every non-browser MCP client; an
  absent Host is anomalous/rebinding-shaped). Store the webhook secret SERVER-SIDE (not a one-way hash)
  because HMAC verification needs the key — the GitHub/Stripe model; `list` exposes only a sha256
  fingerprint. Verify ORDER exists+enabled → signature-over-RAW-body → timestamp → delivery-dedup → fire,
  so authentication precedes any side effect and the fired workflow name is ALWAYS the stored
  registration (no workflow-selection injection).
- **Caught + fixed regression:** `webhook_list` is a genuine ZERO-ARG tool (`inputSchema.properties:{}`),
  which the existing IT-028 (`tests/integration/mcp-tools-list-schema.test.ts`) flags UNLESS allowlisted —
  added `webhook_list` to that test's `ZERO_ARG_TOOLS` (a one-line update, NOT a new IT id) alongside
  `chain_list`/`schedule_list`/`asset_list`.
- **Gate 7.5:** PASSED 2026-08-01. Live engine (33 tools incl. `webhook_*`): allowlist `curl -H 'Host:
  evil.example.com'` → 403, normal → 200, `-H 'Origin: http://evil.example.com' POST /mcp` → 403; webhook
  `webhook_create` → `{url, secret}`, a signed `POST /hooks/:id` (openssl HMAC) → 202 `{runId}`, the
  pre-bound workflow ran → `{got:{deploy:'v9'}}` (body → `args.event`), a replay of the same delivery →
  200 (no second run), `webhook_list` fingerprint-only. REQ-056/057/058 `real:true` (VAL-065/066/067).

### Combined (both slices)

- **No regressions:** full suite **658 pass / 149 files**, `npx tsc --noEmit` clean. No v1-core change in
  either slice — RunSpec/RunStore/journal untouched (2c adds an engine-owned migration-free side table +
  one terminal-edge write; Defer B adds a top-of-handler guard, one route, one durable side table, three
  tools). The run lifecycle (RunGuard budget, agent semaphore, `_transition` state machine) is otherwise
  untouched.
- **Still deferred (recorded, not these increments):** Slice 2c's remaining dashboard items — **Item B =
  SSE** (the page keeps the 3s poll), **Item C = parallel-group markers** (which siblings ran as one
  `parallel()` batch — needs a sandbox-child IPC change), **Item D = static pre-read skeleton +
  `scriptVersion` cache**; and **Defer A = durable in-flight-graph suspend/resume** (persist/rehydrate a
  mid-execution call-tree across restart — 2c persists a run's DAG only at TERMINAL, not mid-flight). Full
  OIDC (REQ-012, D5) stays deferred; a public `0.0.0.0` bind without OIDC remains a documented deployment
  caveat — the Host/Origin allowlist (REQ-056) is the interim control.
- **Trace note:** all Slice-2c + Defer-B work items use `###` headings and this section deliberately
  avoids ID-shaped sub-headings, so it introduces no scanner-collision (trace.py parses only `###`).

## v8 SLICE 4 GATE 8 REVIEW (2026-08-01, historical — superseded by the v8 Slice 2c + Defer B section above)

> This section supersedes "## v8 SLICE 2b GATE 8 REVIEW (2026-07-31)" below (kept for history). v8
> Slice 4 is CROSS-TRIGGER CHAINING + RUN-ADMISSION — the last core v8 trigger mechanism: runs can now
> durably trigger runs, and the engine bounds how many top-level runs may be live at once. No v1-core
> change (RunSpec/RunStore/journal untouched) — one authoritative terminal notification (`onTerminal`),
> one engine-owned durable side table (continuations), one admission counter.
> Ledger items added this slice: REQ-052/053/054 (requirements, pre-written) → ARCH-031 → TASK-052 →
> DES-048 + DES-049 → IMPL-093 → IT-050 (4 cases) + IT-051 (6 cases) → VAL-061/062/063.

### Retro (v8 Slice 4)

- **What changed:** (a) `RunManager` gained an authoritative `onTerminal(runId,status)` hook fired from
  the ONE `_transition` choke (`src/run-manager.ts:369-380`) via `queueMicrotask`+`try/catch`
  (fire-and-forget, covers `stopped`) + a `maxConcurrentRuns` admission gate at the top of `start()`
  (`:204-210`, default 64 via the existing `_positiveInt` validator, counting non-terminal `_runs` with
  `_liveRunCount()` `:162-164`). (b) a NEW durable `ContinuationStore` (`src/continuation-store.ts`) —
  SQLite+WAL side table mirroring the scheduler, `chainCreate`/`onTerminal`/`rearmAtBoot`/`list` +
  atomic `WHERE status='pending'` reconcile + `_rootOf` lineage, reached through structural
  RunManagerPort/RunStorePort seams (no class import). (c) `chain_create`/`chain_list` MCP tools + a
  late-bound `let continuations` closure in server composition (`src/server.ts:706-711`) breaking the
  RunManager↔store construction cycle. Config keys `maxConcurrentRuns`/`continuationDbPath`
  (`src/main.ts`, `rwe.config.example.json`).
- **Key decision:** fire `onTerminal` from `_transition` (the single authoritative terminal writer), NOT
  the `_runLive` `.then` (which never sees `stop()`); fire-and-forget so a continuation's real `start(B)`
  can never wedge A's terminal write. Admit BEFORE any durable work — the run-count/sandbox-fork DoS
  chokepoint the global agent-semaphore (which caps only `agent()` dispatch) does not provide; a nested
  `workflow()` consumes no slot. completed→fire, failed/stopped→skip. Boot-reconcile is COMPLETE because
  `hydrateAll` marks a cross-restart running run `failed`, so a continuation's target is always terminal
  on boot — no "stuck pending forever" hole.
- **Caught + fixed regression:** `chain_list` is a genuine ZERO-ARG tool (`inputSchema.properties:{}`),
  which the existing IT-028 (`tests/integration/mcp-tools-list-schema.test.ts`) flags as a schema
  violation UNLESS allowlisted — added `chain_list` to that test's `ZERO_ARG_TOOLS` (a one-line update,
  NOT a new IT id) alongside `workflow_list`/`schedule_list`/`asset_list`.
- **Gate 7.5:** PASSED 2026-08-01. Live production engine (systemd `rwe.service`, `127.0.0.1:8787`,
  `tsx src/main.ts`) restarted with the Slice-4 code; `tools/list` served 30 tools incl.
  `chain_create`/`chain_list`. LATE-CREATE: `chain_create` after target `A` completed → `chain_list`
  `status:'fired', rootRunId:A, spawnedRunId:<B>`, `workflow_result(B)==="B-ran"` (chained run really
  ran). LIVE onTerminal: an in-flight opus `A2` chained mid-run fired its continuation on real
  completion. REQ-052/053 `real:true`; REQ-054 `real:true` honest-partial via IT-050 (VAL-061/062/063).
- **No regressions:** full suite 635 pass / 144 files, `npx tsc --noEmit` clean. No v1-core change —
  RunSpec/RunStore/journal untouched; the ContinuationStore is an engine-owned durable side table (same
  "don't touch v1 core" stance as the scheduler), and admission + onTerminal are the only run-lifecycle
  additions (RunGuard budget + agent semaphore untouched).
- **Deferred (recorded, not this increment):** external ingress security = **Defer B** (authn/z +
  rate-limit on any public trigger surface); durable in-flight-graph suspend/resume = **Defer A**
  (persist/rehydrate a mid-execution call-tree across restart); and the Slice-2c dashboard items
  (parallel-group markers, cross-restart phase/tree persistence, SSE, static pre-read + scriptVersion
  cache) carried forward from the Slice-2b retro below.
- **Trace note:** all Slice-4 work items use `###` headings and this section deliberately avoids
  ID-shaped sub-headings, so it introduces no scanner-collision (trace.py parses only `###`).

## v8 SLICE 2b GATE 8 REVIEW (2026-07-31, historical — superseded by the v8 Slice 4 section above)

> This section supersedes "## v8 SLICE 3 GATE 8 REVIEW (2026-07-31)" below (kept for history). v8
> Slice 2b is the LIVE-EXECUTION-DETAIL layer over Slice-2/Slice-3's call-tree read-model + dashboard:
> it adds the two "what is happening right now" signals the dashboard was missing — a phase timeline
> (with timestamps + a current-step marker) and per-agent timing (dispatch→settle duration) — a
> read-model/observability extension, no execution-semantics change.
> Ledger items added this slice: REQ-050/051 (requirements, pre-written) → ARCH-030 → TASK-051 →
> DES-047 → IMPL-092 → UT-062 (1 case) + IT-049 (2 cases) → VAL-059/060.

### Retro (v8 Slice 2b)

- **What changed:** `PhaseView.ts` made a REQUIRED field so every `phases[]` entry carries the ISO time
  its `phase()` was entered (`src/types.ts`, stamped in the sandbox `onPhase` callback via the injectable
  `Clock`, `src/run-manager.ts:357`); `AgentRecord` gains `startedAt` (stamped at the slot-acquired
  `markRunning` seam, `src/run-manager.ts:494` → `src/agent-executor.ts:128-130`) + `endedAt` (the
  `capture()` clock time, carried on both ok+failed branches, `src/agent-executor.ts:135-153`);
  `buildDagModel` exposes `startedAt`/`endedAt` + a derived non-negative `durationMs`
  (`undefined` while unfinished, `src/dashboard.ts:54-55`); and the dashboard detail page renders a
  `#phases` timeline (each phase a chip with its `ts` tooltip, the last chip marked `cur` only while
  `running`) plus each agent node's `<n> ms` duration (`src/dashboard-page.ts`).
- **Key decision:** stamp `startedAt` at `markRunning` (slot-acquired / dispatch), NOT at enqueue — so
  `durationMs` measures real execution, not queue wait, and a queued-not-yet-dispatched agent stays
  timestamp-less (per REQ-051). Derive `durationMs` in the model (`max(0, endedAt − startedAt)`), don't
  persist it — one source of truth in the two timestamps, `undefined` for an unfinished agent for free.
  Use the ONE injectable `Clock` for both the phase `ts` and the agent timing, so an advancing test clock
  makes the timeline ordering + `endedAt ≥ startedAt` deterministically assertable (IT-049).
- **Gate 7.5:** PASSED 2026-07-31. Live production engine (systemd `rwe.service`, `127.0.0.1:8787`,
  `tsx src/main.ts`) restarted with the Slice-2b code; an ad-hoc `phase('draft'); agent 'pinger'(opus);
  phase('done')` run in-process returned `phases:[{draft,ts},{done,ts}]` (ordered) and an agent record
  `{startedAt,endedAt}` (~5.3s real opus call, `endedAt ≥ startedAt`) from `GET /api/runs/:id`;
  `/dashboard/:runId` (DOM-verified) rendered `#phases` chips `['draft','done']` each with its `ts`
  tooltip and the agent node text `pinger opus done 7 tok 5325 ms`. REQ-050/051 both `real:true`
  (VAL-059/060).
- **No regressions:** full suite 625 pass / 142 files, `npx tsc --noEmit` clean; only the read-model
  presentation changed (two timestamps + a derived duration + timeline/duration rendering) — no
  run-lifecycle / budget / concurrency state added. `src/mcp-facade.ts` unchanged. The one compile
  consequence — a `PhaseView` fixture in `tests/unit/dashboard-model.test.ts` gaining `ts` — is the cost
  of making `ts` required.
- **Deferred to Slice 2c (recorded, not this increment):** parallel-group markers (which sibling nodes
  ran as one `parallel()` batch — needs a sandbox-child protocol change to report batch membership);
  cross-restart phase/tree persistence (after a service restart an out-of-process run's phases/tree are
  not rehydrated — the live timeline/tree lives in the per-process `RunEntry`); SSE (the page keeps the
  3-second poll); static pre-read + `scriptVersion` cache (serve the skeleton before the run starts).
- **Trace note:** all Slice-2b work items use `###` headings and this section deliberately avoids
  ID-shaped sub-headings, so it introduces no scanner-collision (trace.py parses only `###`).

## v8 SLICE 3 GATE 8 REVIEW (2026-07-31, historical — superseded by the v8 Slice 2b section above)

> This section supersedes "## v8 SLICE 2 GATE 8 REVIEW (2026-07-30)" below (kept for history). v8
> Slice 3 is the PRESENTATION layer over Slice-2's frame-tagged read-model: it turns the flat
> read-model into a PURE call-tree model and the browser-facing dashboard that renders cards → a nested
> composite DAG → an agent transcript — a read-model reshaping + a page, no execution-semantics change.
> Ledger items added this slice: REQ-048/049 (requirements, pre-written) → ARCH-029 → TASK-050 →
> DES-045/DES-046 → IMPL-091 → UT-061 (3 cases) + IT-048 (2 cases) → VAL-057/058.

### Retro (v8 Slice 3)

- **What changed:** `buildDagModel(RunStatusView) → DagNode` (`src/dashboard.ts`) — a PURE, total
  reconstruction of a run's call-tree (group agents by `frame`, nest composite frames by `parentFrame`,
  root-fallback so no agent is dropped) — plus two read-only endpoints on the existing dashboard-API
  transport (`GET /api/workflows` → the registered catalog for home cards; `GET /api/runs/:id/dag` →
  `buildDagModel(view)`), and a rewritten self-contained SPA (`src/dashboard-page.ts`) that renders
  workflow + run cards on `/dashboard`, a recursive nested-group DAG (composite `.grp` groups, 3-state
  agent nodes showing model) on `/dashboard/:runId`, and an agent transcript drill-down, on a 3-second
  poll. `buildDagModel` is shared by the endpoint AND the page — one tested model, no browser-side tree
  logic.
- **Key decision:** keep one pure `buildDagModel` (unit-tested, UT-061) served whole by `/api/runs/:id/dag`
  and just walked by the page's `renderNode`, rather than rebuild the tree in client JS — one
  reconstruction, one test. Make it total (never throws, never drops an agent: orphan parentFrame →
  root, unknown agent frame → root) so the dashboard degrades to a flatter-but-complete tree, never a
  500 or a missing agent.
- **Gate-7.5-caught routing gap:** the top-level request router's dispatch predicate matched only
  `/api/runs*`, so `GET /api/workflows` fell through to the `/mcp` JSON-RPC handler and returned
  `-32601` (method-not-found). Caught on the real run at Gate 7.5 and fixed by widening the predicate to
  also match `/api/workflows` (`src/server.ts:797`) — one shared `handleDashboardRequest` branch, no
  second handler. Regression-locked by IT-048's `GET /api/workflows` case.
- **Gate 7.5:** PASSED 2026-07-31. REQ-049 fully live via a headless browser (Playwright) — `/dashboard`
  rendered workflow + run cards; a nested composite `dag2mid → dag2leaf → agent 'pinger'(opus)` opened
  at `/dashboard/<runId>` rendered `groupHeaders = ["workflow dag2mid · depth 1","workflow dag2leaf ·
  depth 2"]`, the agent node nested two groups deep (`node st-done`, `pinger opus done 7 tok`), and
  clicking it loaded the real opus transcript ("PONG"). REQ-048 (`buildDagModel`) real:true via UT-061 +
  the live `/dag` tree.
- **No regressions:** full suite 622 pass / 141 files, `npx tsc --noEmit` clean; only the read-model
  presentation changed (a pure `buildDagModel` + two read-only endpoints + the page) — no run-lifecycle
  / scheduling state added. `src/mcp-facade.ts` unchanged.
- **Deferred (recorded, not this increment):** server-sent events (the page keeps the 3-second poll);
  parallel-group markers (which sibling nodes ran as one `parallel()` batch); phase persistence +
  current-step + timing (per-node start/end/duration); static pre-read + `scriptVersion` cache (serve
  the tree skeleton before the run starts); cross-restart tree persistence (after a service restart an
  out-of-process run's `/api/runs/:id/dag` flattens because `getRun()` returns `workflowNodes: []` — the
  live tree lives in the per-process `RunEntry`; a later increment can back it with a persisted node
  table without changing the shape — exactly REQ-047's documented cross-restart-out-of-scope, confirmed
  live).
- **Trace note:** all Slice-3 work items use `###` headings and this section deliberately avoids
  ID-shaped sub-headings, so it introduces no scanner-collision (trace.py parses only `###`).

## v8 SLICE 2 GATE 8 REVIEW (2026-07-30, historical — superseded by the v8 Slice 3 section above)

> This section supersedes "## v8 SLICE 1 GATE 8 REVIEW (2026-07-30)" below (kept for history). v8
> Slice 2 is the first increment of the dashboard DATA layer over Slice 1's N-level composition: it
> SURFACES the already-computed frame structure so a client can reconstruct a composite run's live
> call-tree (DAG) and drill from any node to its transcript — a read-model/observability extension,
> no execution-semantics change. Ledger items added this slice: REQ-045..047 (requirements,
> pre-written) → ARCH-028 → TASK-049 → DES-043/DES-044 → IMPL-090 → IT-047 (2 cases) → VAL-054..056.

### Retro (v8 Slice 2)

- **What changed:** each `agent()` record now carries the composite `frame` it ran in (root `""`; a
  nested agent's frame has its parent frame as a strict prefix), each nested `workflow()` call is
  recorded as a `workflowNodes` boundary node `{frame,name,parentFrame,depth}`, and both are exposed
  through the existing `workflow_status` / `GET /api/runs/:id` read-model — so the dashboard can render
  a composite as nested sub-cards and click a node to its log. `mcp-facade.ts` needed no change (it
  already returns the full `RunStatusView` as `result`).
- **Key decision:** reuse the ARCH-027 frame-path key as the tree key rather than mint a parallel
  id-space — so `node.frame == its inner agents' frame` holds by construction (one source of frame
  identity for both journal namespacing and tree linkage), and the frame is stamped at `markQueued`
  (not `capture`) so in-flight/queued agents already carry it (REQ-047's "current step = the running
  node").
- **Gate 7.5:** PASSED 2026-07-30. REQ-046/047 fully live — a model-free composite (`dagmid` →
  `workflow('dagleaf')`) run against the live engine returned, via real MCP, `workflowNodes:
  [{frame:".0",name:"dagmid",parentFrame:"",depth:1},{frame:".0.0",name:"dagleaf",parentFrame:".0",depth:2}]`
  (correct depth/parentFrame hierarchy, `dagleaf.parentFrame == dagmid.frame`). REQ-045 (agent frame
  tagging) is `real:true` via the real-sandbox integration test IT-047 (a live agent needs a model
  provider, so the live check used the model-free linkage path) — honest partial mirroring the
  VAL-046/051 precedent.
- **No regressions:** full suite 617 pass / 140 files, `npx tsc --noEmit` clean; only the read-model
  changed (agents gain a `frame`, a per-run `workflowNodes` list is populated + exposed) — no
  run-lifecycle / scheduling state added.
- **Deferred (recorded, not this increment):** parallel-group markers (which sibling nodes ran as one
  `parallel()` batch); phase persistence + current-step + timing (per-node start/end/duration);
  static pre-read + `scriptVersion` cache (serve the tree skeleton before the run starts); cross-restart
  tree persistence (the persisted/derived `getRun()` path defaults `workflowNodes: []` — the live tree
  lives in the per-process `RunEntry`; a later increment can back it with a persisted node table without
  changing the shape). These are the natural next Slice-2 increments toward the full dashboard.
- **Trace note:** all Slice-2 work items use `###` headings and this section deliberately avoids
  ID-shaped sub-headings, so it introduces no scanner-collision (the trace.py item regex now parses
  only `###`, per the Slice-1 carry-forward fix).

## v8 SLICE 1 GATE 8 REVIEW (2026-07-30, historical — superseded by the v8 Slice 2 section above)

> This section supersedes "## v7 GATE 8 CLOSING REVIEW (2026-07-24)" below (kept for history). v8
> Slice 1 lifts one-level `workflow()` nesting into config-capped N-level composition with cycle +
> descendant guards and a depth-safe journal keying rework. Ledger items added this slice: REQ-041..044
> (requirements, pre-written) → ARCH-027 → TASK-048 → DES-041/DES-042 → IMPL-089 → IT-046 (7 cases,
> +IT-026 regression) → VAL-050..053. Gate 7.5 v8 Slice 1 ROUND 1 PASSED 2026-07-30: REQ-041 fully
> live (CASE A depth-2 `"M(L)"`; CASE B depth-3 → `NESTING_DEPTH_EXCEEDED` under live `maxWorkflowDepth:2`);
> REQ-042/043/044 real:true via the real-wiring integration test IT-046 + the same live nested code
> path (honest partial on the isolated guard/budget probes, mirrors the VAL-046 pattern).

### 1. Traceability

`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check` regenerated. The v8 chain is
intact end-to-end: REQ-041..044 → ARCH-027 (traces all four REQs) → TASK-048 → DES-041/042 →
IMPL-089 (traces TASK-048 + DES-041/042, greens) and IT-046 (traces DES-041/042) + VAL-050..053
(each traces its REQ, real:true) — so all four REQs are implemented, verified, and real-verified (no
新 未實作 / 未驗證 / 未真實驗證 gap from this slice). All v8 items carry `iter: v8`; no doc↔code drift
(IMPL-089 v8 traces DES-041/042 v8, equal iter).

Pre-existing gaps unrelated to this slice are NOT touched: REQ-012 未真實驗證 (OIDC deferred, D5) and
TASK-018 未實作 (OIDC seam) remain accepted tech debt. NB — a pre-existing scanner collision (the v7
review's `#### ARCH-025`/`#### ARCH-026` sub-headings match trace.py's `#{2,4}` item regex and, being
scanned after 02-architecture.md, overwrite the real ARCH-025/026 traces) currently shows REQ-037..040
as 未實作; this predates v8, is out of this slice's scope, and is left recorded here rather than
silently patched. This v8 section deliberately avoids ID-shaped sub-headings so it introduces no new
collision.

### 2. Architecture consistency — ARCH-027 (lean-tier self-check, QM)

Checked against the v8-touched files on IMPL-089: `src/run-manager.ts` (nesting context + 3 guards +
`_frameBaseFor`/`NESTED_FRAME_STRIDE` + `_positiveInt`), `src/server.ts` + `src/main.ts` (config
threading), `rwe.config.example.json`. The three guards fire at the `onWorkflowRequest` boundary in
the ARCH-027-specified order (depth → cycle → descendant), each as a typed envelope error; the nested
child shares the parent `RunEntry`/`RunGuard` (shared-budget invariant by construction); the additive
frame keying replaces the overflowing multiplicative scheme. Consistent with ARCH-027 and its
Depends (ARCH-002 run/journal/budget, ARCH-005 catalog resolution, ARCH-001 config threading). No
drift found.

### Retro (v8 Slice 1)

- **What changed:** one-level `workflow()` nesting → N-level composition (default depth 4 /
  descendants 256, both config-validated at load), so a registered composite can be a node inside
  another — the foundation for composing workflows into a system graph.
- **Key finding (callSeq overflow):** the v1 multiplicative nested-callSeq keying `(parentCallSeq+1)*1e6+n`
  overflows `MAX_SAFE_INTEGER` past ~depth 2 and would corrupt resume replay at depth ≥3. Reworked to
  an additive per-frame base allocation, deterministic across resume (incl. `parallel()` array order);
  regression-guarded by IT-026 staying green.
- **No regressions:** full suite 615 pass / 139 files, `npx tsc --noEmit` clean; only the nesting path
  changed (nested child reuses parent budget/journal — no new run-lifecycle state).
- **Carry-forward:** the trace.py `#{2,4}` heading-collision (ARCH-025/026 in 07-review.md) is worth a
  tooling fix (restrict item headings to `###`, or de-dupe by first occurrence) so review prose can
  cite IDs in sub-headings without breaking upstream chains — deferred, not v8-scope.

Gaps: high=1 mid=5 low=1 — ALL pre-existing and out-of-v8-scope (high=REQ-012 未真實驗證; mid=REQ-037..040
未實作 [v7 review heading-collision] + IMPL-082 TDD label; low=TASK-018 未實作). 0 new gaps from the v8
slice. Conclusion: v8 Slice 1 can close; the four REQs are fully traced + real-validated.

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
