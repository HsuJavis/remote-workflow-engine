# Design panel — adversarial group (Interface-contract × Boundary/error × Testability), round 1 — v26

**Scope read:** REQ-121..130 (`01-requirements.md:1328-1543`), the v26 architecture slice ARCH-110..121 + ADR-037..047 with its
4+1 views, data delta, API-contract table, INV-V26-1..7 and the file-end Decision rationale (`02-architecture.md:2726-3134`),
`v26-gate1-working-notes.md` (the owner's six rulings), `state.yaml` (tech_stack; `gates.design` reset for v26; the GATE 3+
directive), the previous design panel's format (`.panel/design/*.r1.md`, v24), and the source seams the design will cut:
`workspace-seed.ts`, `tool-specs.ts`, `errors.ts`, `gateway/claude-agent-sdk-client.ts`, `gateway/client.ts`,
`gateway/litellm-proxy.ts`, `session-options-builder.ts`, `params/resolve.ts`, `sandbox/host.ts`, `sandbox/child-entry.ts`,
`sandbox/guards.ts`, `run-manager.ts`, `run-guard.ts`, `agent-executor.ts`, `run-store.ts`, `store/sqlite-run-store.ts`,
`types.ts`, `dashboard.ts`, `dashboard-page.ts`, `check-mermaid.ts`, `workflow-meta.ts`, `workflow-catalog.ts`,
`workflow-view.ts`, `models/model-catalog.ts`, `authoring-guide.ts`, `main.ts`, `deploy/rwe-update.sh`, the SDK's own
`sdk.d.ts`, and the plugin client `~/Documents/remote-workflow-plugin/skills/rwe-seed/push_workspace.py`. `03-tasks.md`
has no v26 rows yet — §"Task partition" says where my lenses need the synthesizer to cut. IDs below start at **DES-170**
(last used: DES-169 / TASK-169 / UT-171 / IT-140 / E2E-009 / VAL-170); `TASK-` is left unassigned.

**Altitude (judged from tech_stack + the ten REQs):** a system-altitude control plane (Node/TS engine, SQLite, a managed
LiteLLM subprocess, an MCP surface) that HOSTS AI agents. Agent altitude applies exactly where the consumer of a surface is
an LLM: the refusal envelopes and tool descriptions (`run_start.seed`/`budget`, `workflow_register.mermaid` — REQ-121/127/128),
the authoring guide (REQ-130) and the cold-model probe (REQ-117's extension in REQ-128). For my three lenses that means
**there, the error envelope and the description ARE the API**: interface-contract reads "a cold model can act on it", boundary
reads "every refusal names the fix", testability reads "the REQ-117 protocol plus a description-literal assertion". Everywhere
else (gateway, guard, store, layout) the lenses are read at system altitude. I do not force the agent altitude onto the
guard or the store.

**The constraint that shapes every item (state.yaml GATE 3+ DIRECTIVE, still in force):** `tests` and `implement` run on
the LOWER model tier, so the compensation lives in the specification — finer partition, larger test count, and tests written
to trap the four mid-tier failure modes: **(T1)** silent no-op instead of refusal, **(T2)** oracle derived from the code under
test, **(T3)** a test left green after the thing it named was retired, **(T4)** a description that stops matching the thing.
Every DES below names its test file and which trap(s) it closes. v26 is unusually T3-heavy (a provider path, a curation
table, three effort tables and a fold function all leave the tree) and unusually T4-heavy (a unit changes on a persisted
number, a column is renamed, ten examples change shape).

**Settled at Gate 2 — nothing below reopens these:** object budget (ADR-037), `PRICE_UNKNOWN` narrowed to USD-only budgets
(ADR-038, pending owner), regex skeleton + narrowed contract (ADR-039), the SDK error union (ADR-040), the deletion (ADR-041),
`--check-config` in the updater (ADR-042), explicit `diagram_contract` column (ADR-043), client-constructed DAG (ADR-044), one
effort table (ADR-045), the projection bug class recorded without an abstraction (ADR-046), the trigger-budget hole escalated
(ADR-047, pending owner), no payload of unmapped SDK traffic is ever stored, named counters over a `warnings[]` umbrella,
phase join by ordinal, `remaining() → null`, no corrected Mermaid in a refusal, `tools: default` as the honest word for the
engine's default surface. Two of those MECHANICS are sharpened, not reopened, and labelled where they appear: the unmapped
counter gains a named benign set so it is empty on a healthy run (DES-171, R4), and `tools: default` is checked as the
literal word rather than skipped (DES-181, R9). Where I change an ARCH-stated API *shape* I label it **deviation, property
preserved** so it is not read as a Gate 2 reopening.

---

## Summary

The architecture is five corrections of one bug class, two shared pure objects (`ExpectedGraph`, `ModelBook`) and one large
deletion. The design's job is the same as in v24 — make every function **total** (every input has a named outcome), every
outcome **typed** (a member of a closed union the compiler and one drift test both see), and every seam **injectable**
(clock, store, catalog source, SDK query, realpath) — plus one v26-specific job: **make the deletion and the unit change
un-fakeable**, because a lower-tier implementer's cheapest path through "budget is now USD" is to rename a variable and leave
every token test green (T3/T4 at once).

Reading the code against the twelve ARCH items found **fifteen design-level gaps** the architecture leaves open. In
priority order (each becomes a DES below):

1. **`capture()` clobbers the phase stamp** (`agent-executor.ts:258/270`). It rebuilds the record from `req.opts.phase`
   without spreading `prev`, so ARCH-114's receipt-time stamp survives `markQueued` and dies at terminal. `capture` must carry
   `prev.phase/phaseIndex` exactly as it carries `frame`/`startedAt`, and the `phase` argument to `capture` is deleted — there
   is no second source. Both `SandboxHost` constructions (`run-manager.ts:920`, `:1011`) need `currentPhase` (DES-175).
2. **`deriveExpectedGraph` cannot join skeleton to scan by ordinal** — `parseWorkflowSkeleton` matches `\b(agent|…)\s*\(`
   while `scanAgentCalls` matches `(?<!\.)\bagent\s*\(`; a `foo.agent(` shifts every later index by one. Join by CHARACTER
   OFFSET (`at`), added to both. And ARCH-113's return union `ExpectedGraph | {refused}` hands the run-DAG consumer a refusal it
   cannot act on: the derivation is made **total** and the L2 refusal moves into the v2 checker where refusals already live
   (**deviation, property preserved** — one derivation, two consumers). The scanner must also extract literal `allowedTools`,
   and a NON-literal value is refused under the contract rather than silently `'default'` (T1) (DES-174).
3. **The edge rule must be over label SETS, not node ids, and `<-->` must be excluded** — guide example 3 draws `r1/r2/r3`
   all labelled `researcher` for one `parallel(topics.map(…))`, and example 7 draws `proponent<-->opponent` inside
   `subgraph "debate"`. ARCH-119's rule (13) as written refuses both. The rule is restated over labels with `<-->` outside the
   directed set (as cycle detection already does), and "subgraph = phase lane" reshapes examples 3, 5, 7, 8 (DES-181/182).
4. **The checker must name its own `ErrorCode`.** `workflow-catalog.ts:494` maps `rule → code` by a ternary on
   `onlyInScript`; four new codes cannot ride that. `CheckMermaidResult.code` + one `RULE_CODE` table that preserves today's
   mapping byte-for-byte for every v1 rule (DES-181).
5. **`meta.unmappedMessages` is noise without a benign set** — the installed SDK has 26 `type:'system'` subtypes and `init`
   fires on every session. `BENIGN_SYSTEM_SUBTYPES` is a named closed set, and a recorded healthy-session fixture must yield
   an EMPTY counter, or the "named counter with a reader" reads non-zero on every run and means nothing (DES-171).
6. **`run_result` has no `meta` today** (`ResultEnvelope = {runId, status, result|error}`) and `RunStatusView` has no usage
   field. One home: `RunStatusView.usage: RunUsage`, produced live by `RunGuard` and at rest by `foldUsage`, mirrored as
   `run_result.meta.usage`; one IT asserts the two producers agree on a completed run (DES-179).
7. **Who indexes the price pin.** Alias → (provider, model) is resolved INSIDE the gateway; the executor holds only the alias
   (`eff.model`), so ARCH-117's "the executor threads the label's pinned caps" cannot be written. Pass the PIN into
   `invoke(req.pin)` and let the gateway index it after resolution; `costUSD` at capture indexes the same pin by the RESOLVED
   names ARCH-115 puts on the result. One resolver, `resolveAlias`, moves to `providers.ts` (DES-177/178).
8. **The budget has eight readers**: the schema, `createRun`, `getSpec` (`JSON.parse(row.budget)`), `RunGuard`,
   `sandbox.run(..., budgetView().total)` at `:956` and `:1023`, `host.ts:103`'s `start.budgetTotal`, `child-entry.ts:98-100`,
   and `types.ts:76`'s `Budget`. One normaliser `parseBudget(raw)` in `run-guard.ts`; the read-back type widens, nothing else
   does (DES-179).
9. **`price_book` must be readable at RESUME** — a dispatch after resume prices against the pin, not the live book
   (INV-V26-4). `createRun(spec, version, params, priceBook)` and `getSpec` returning it (DES-177).
10. **`toolUse → toolUseDeclared` applies IN and OUT** — `models_list`'s inputSchema has a `toolUse` filter and `CatalogFilter.toolUse`
    exists; renaming only the row is a description that stops matching (T4) (DES-178).
11. **`AgentOpts.phase` becomes a per-call key nothing reads.** After v26 the only phase source is the receipt-time stamp;
    a script writing `agent('x', {phase:'…'})` would be silently ignored (T1). Delete the field from `AgentOpts`; the closed
    `AGENT_OPT_KEYS` record then REFUSES it as `PARAM_UNKNOWN` with a near-miss hint — zero new codes (DES-175).
12. **`additionalProperties:false` on `seed.items` would make REQ-121's hint unreachable**: ajv refuses `{path, sha256}` for the
    extra key as a generic `INVALID_ARGUMENT` before `validateSeedSpec` ever runs. The validator owns the whole item shape
    (types, required, unknown keys) so `INVALID_SEED_SPEC` with "use `seedManifest`" is what the caller sees; the schema
    items stay descriptive. The plugin evidence is already in: `push_workspace.py` never sends `run_start.seed` at all — it
    builds `{path, sha256, exec?}` for the raw-blob/manifest route and prints a `seedManifestRef` (DES-170).
13. **Token semantics differ per transport**: Anthropic `input_tokens` EXCLUDES cache tokens (the four are additive);
    OpenRouter `prompt_tokens` INCLUDES `cached_tokens`. Stated at the seam, and an ABSENT cache field over-counts (all input at
    the `in` rate — safe for a spend limit), never drops (DES-179).
14. **`--check-config` is a `tsx` invocation** (`build` is `tsc --noEmit`, `start` is `tsx src/main.ts`), and it must run the
    real `composeConfig` with the already-injectable NOOP proxy manager or it is a false pass; `validateAliases` wired through
    `composeConfig` is a `compose-config-v2-wiring.test.ts` row (the twice-bitten class) (DES-172).
15. **Zero-`phase()` scripts.** ARCH-113 L2 refuses an `agent()` before the first `phase()`; read literally every v2 script
    needs a `phase()` and the one-agent example becomes a lane. Zero lanes ⇔ zero subgraphs is checkable and drawable, so:
    **no `phase()` ⇒ no subgraph, agents at top level; ≥1 `phase()` ⇒ every agent in a lane** (**deviation, property
    preserved** — the undecidable MIXED case is still refused) (DES-174/181).

---

## Key points — proposed DES items (04-design.md `signature`/`boundary`/`tests` convention; DES-170.., `TASK-` unassigned)

### DES-170 — `validateSeedSpec(source, items)`: one validator owns both inline shapes; nothing is written before every element passes
- **traces:** ARCH-110, REQ-121, REQ-025, REQ-065, REQ-082, REQ-130
- **signature:** `src/workspace-seed.ts` —
  `export type SeedSpecRefusal = { ok:false; code:'INVALID_SEED_SPEC'; source:'seed'|'seedManifest'; index:number; path:string|null; field:'path'|'contentB64'|'sha256'|'exec'|'<unknown key>'; hint:string }`;
  `export function validateSeedSpec(source:'seed', items:unknown): {ok:true; files:SeedFile[]} | SeedSpecRefusal` and the
  `'seedManifest'` overload returning `{ok:true; entries:ManifestEntry[]}`. Refuses the FIRST failing element: not an
  array → index -1; element not an object; `path` not a string; for `seed`: `contentB64` not a string (hint: *"seed elements
  carry bytes inline as contentB64 (base64 string); to seed by sha256 use seedManifest (blobs pushed via workspace_push) or
  seedManifestRef"*); for `seedManifest`: `sha256` not `^[0-9a-f]{64}$`, `exec` present and not boolean; any key outside the
  shape → `field:'<key>'` with the hint naming the allowed keys. `materializeSeed(ws, files)` THROWS on a non-string
  `contentB64` (defence in depth) — the `?? ''` is deleted. Call site: `RunManager.start()` BEFORE `createRun` (today the
  materializer runs in a closure after the row exists, `run-manager.ts:534/567`), so a refused seed leaves no run row and no
  directory. `TOOL_SPECS.run_start`: `seed.items` / `seedManifest.items` gain `type:'object'`, `properties` with descriptions
  (`contentB64: 'REQUIRED — base64 of the file bytes; missing or non-string → INVALID_SEED_SPEC'`), `seedManifestRef` gains
  `pattern:'^[0-9a-f]{64}$'`; `required` and `additionalProperties:false` are deliberately NOT placed on the items. The
  `INVALID_SEED_SPEC` catalog row is rewritten to the hint above with `see:'workflow_authoring_guide'`.
- **boundary:** **Why no `additionalProperties:false` on the items (deviation from ARCH-110's letter, property preserved):**
  ajv runs before any facade code and refuses an unknown key as `INVALID_ARGUMENT` — so `{path, sha256}` in `seed`, the exact
  input REQ-121 is about, would never reach the validator and never see the `seedManifest` hint. One validator, one code, one
  hint. The plugin question ARCH-110 gated on is answered by reading the client: `push_workspace.py` does not use `run_start.seed`
  (it streams blobs and registers a manifest), so nothing in the other repo is affected either way; the cross-repo row
  reduces to a release-note line. Two sources together remain `SEED_SOURCE_CONFLICT` (checked before shape). Base64 is not
  decode-verified (stated in the description) — byte exactness is the sha-verified route's job.
- **tests:** `tests/unit/workspace-seed-spec.test.ts` (new; table over 12 refusals + 3 accepts; the red case `{path, sha256}`
  → `INVALID_SEED_SPEC` whose `hint` contains `seedManifest` — T1), `tests/unit/workspace-artifacts-seed.test.ts` (UT rewritten:
  the `?? ''` case becomes a throw — T3), `tests/integration/run-start-seed-refusal.test.ts` (new: booted server, refused seed ⇒
  `run_list` unchanged AND the run directory absent — T1 at the store boundary), `tests/unit/tool-specs.test.ts` (the item
  descriptions asserted as literals — T4), `tests/unit/error-catalog.test.ts` (the rewritten row).

### DES-171 — `classifyApiError` is total over the SDK union; `_drain` stops on a terminal `api_retry`; the controller always exists and is always aborted; benign system traffic is named, the rest is counted
- **traces:** ARCH-111, ADR-040, ADR-046, REQ-122, REQ-083, REQ-020
- **signature:** `src/gateway/claude-agent-sdk-client.ts` —
  `export function classifyApiError(kind: SDKAssistantMessageError, status: number | null): 'terminal' | 'retry'` — a `switch`
  with a `never` default: `authentication_failed | oauth_org_not_allowed | billing_error | invalid_request | model_not_found →
  'terminal'`; `rate_limit | overloaded | server_error | max_output_tokens → 'retry'`; `unknown → status !== null && status >= 400
  && status < 500 && status !== 408 && status !== 429 ? 'terminal' : 'retry'`.
  `export const BENIGN_SYSTEM_SUBTYPES: ReadonlySet<string>` = {`init`, `status`, `compact_boundary`, `hook_started`,
  `hook_progress`, `hook_response`, `thinking_tokens`, `task_started`, `task_updated`, `task_progress`, `task_notification`,
  `files_persisted`, `commands_changed`, `session_state_changed`, `informational`, `notification`, `local_command_output`,
  `memory_recall`, `worker_shutting_down`, `elicitation_complete`, `plugin_install`} — dropped with a comment naming the drop
  (D-V26-projection); everything else under `type:'system'` except `api_retry` increments `unmapped[subtype]` after
  `sanitizeSubtype(s) = s.replace(/[^a-z0-9_.-]/g,'?').slice(0,64)`. `_drain` on `system/api_retry`: `retry` → emits
  `{kind:'message', data:{type:'api_retry', status:error_status, kind:error, attempt, max_retries}}` and continues; `terminal` →
  emits `{type:'error', detail, status, kind, attempt}` and returns `{ok:false, reason:'terminal', retryable:false, detail,
  error:{kind, status, attempt}, events, unmapped}`. `_invokeOnce`: `const controller = new AbortController()` unconditionally;
  `finally { controller.abort(); … }` after the race settles. `invoke()`: `if (!last.ok && last.retryable === false) break;`.
  `GatewayResult` failure arm gains `retryable?: false; error?: {kind:string; status:number|null; attempt:number}`; both arms
  gain `unmapped?: Record<string, number>`. Direct-fetch (`client.ts`): `res.status ∈ {401,403,404}` → `{…, reason:'terminal',
  retryable:false, error:{kind:'unknown', status}}`. `AgentRecord.detail?: string` (failed only): `redact()` FIRST, then
  `capBytes(…, MAX_ERROR_DETAIL_BYTES = 1024)`.
- **boundary:** The abort belongs in `finally`, after the race, for the reason ARCH-111 gives (`bound` resolves synchronously on
  abort — an early abort inside `_drain` lets the timeout arm win and misreports `reason:'timeout'`); the unit oracle for "the
  CLI is killed" is `options.abortController.signal.aborted === true` observed by the fake `queryImpl` after `invoke` returns —
  Gate 7.5's `ps` is the real one. The benign set is a closed list against a THIRD-PARTY union that changes per SDK version:
  that is a T4 risk by construction, so the lock is behavioural, not lexical — a recorded healthy session fixture (`init`,
  `assistant`, `user`/tool_result, `result`) must yield `unmapped === undefined` and `meta.unmappedMessages` equal to `{}`; a new
  subtype the SDK adds shows up as a counted name, which is the honest signal. Non-`system` message types with no content
  (`stream_event`, `tool_progress`, `rate_limit_event`…) stay dropped as today with the comment; the counter is scoped to
  `system` as ARCH-111 scopes it. A `failed` call moves no usage counter (an outage cannot inflate `unpricedCalls`). Not built:
  breaker, health table, retry policy object.
- **tests:** `tests/unit/classify-api-error.test.ts` (new; the full 10-kind × {null, 400, 401, 404, 408, 429, 500} table — T2
  guarded by writing the expected column from ADR-040's prose, not from the function), `tests/unit/claude-agent-sdk-gateway-api-retry.test.ts`
  (new; fake session emits `api_retry(401)` ×3 and never `result` → ONE attempt, resolved within one tick, `retryable:false`,
  `events[0].data.type==='error'`, the abort signal fired, `invoke` with `retries:3` performs exactly one `_invokeOnce` — T1;
  `api_retry(429)` then `result` → ok with one `api_retry` event; `api_retry(500)` under `timeoutMs` → `timeout` after the bound,
  not before), `tests/unit/claude-agent-sdk-gateway-benign-system.test.ts` (new; the healthy fixture → empty counter; an
  invented subtype `x!y` → `{ 'x?y': 1 }`), `tests/unit/gateway-client.test.ts` (direct-fetch 401/403/404 rows gain
  `retryable:false` — T3 for the old `terminal`-only assertions), `tests/integration/agent-record-detail-bound.test.ts` (new; a
  5 KB error containing a provisioned secret value → `detail.length ≤ 1024` and no secret bytes — the REQ-083 sweep row),
  `tests/acceptance/val-171-provider-terminal.test.ts` (VAL-171: real engine, revoked-key alias → `failed` with `detail`,
  `events` non-empty, `provider:'openrouter'`, within `timeoutMs`; skips LOUDLY without a key).

### DES-172 — `providers.ts`: the closed `Provider` union, `PROVIDER_CAPS` with a `never` check, `resolveAlias`, `validateAliases` listing every offender; `--check-config` runs the real `composeConfig`
- **traces:** ARCH-112, ADR-041, ADR-042, ADR-045, REQ-123, REQ-070, REQ-016
- **signature:** `src/providers.ts` (pure; no SDK import, no fetch) —
  `export const PROVIDERS = ['anthropic','openrouter','ollama'] as const; export type Provider = typeof PROVIDERS[number];`
  `export type EffortWire = { param:'effort'; restPath:['output_config','effort'] } | { param:'thinking'; restPath:['thinking','budget_tokens']; requires:'reasoning' }`;
  `export const PROVIDER_CAPS: Record<Provider, { tools:'all'; effort: EffortWire | null; thinking:'sdk-default'|'budget-when-declared'|'disabled' }>`;
  `export function isProvider(s: string): s is Provider`;
  `export function resolveAlias(aliases: AliasMap, model: string | undefined): { provider: Provider; model: string; alias?: string; proxyModel?: string } | undefined`
  — the ONE alias/passthrough resolver (today's `providerOf`/`isPassthroughModel`/`effectiveProvider` in the SDK client move
  here; `proxyModel` = `rwe-proxy-<alias>` for an aliased model through LiteLLM, absent for `openrouter/<id>` passthrough and for
  direct-fetch);
  `export function validateAliases(raw: Record<string, {provider:string; model:string}>): { ok:true; aliases: AliasMap } | { ok:false; offenders: Array<{alias:string; provider:string}>; allowed: readonly Provider[]; message: string }`
  — lists EVERY offending row; `message` is the boot text (*"provider 'openai' on alias 'gpt41' is not supported (allowed:
  anthropic, openrouter, ollama); also: gpt4omini, gpt41mini, gpt41nano — remove these rows"*). `AliasMap` (`client.ts:9`) is
  narrowed to `Record<string, {provider: Provider; model: string}>`. `composeConfig()` calls `validateAliases` and throws the
  message. `main.ts`: `if (process.argv.includes('--check-config')) { await composeConfig(loadFileConfig(), CHECK_DEPS); print
  'config ok'; exit 0 }` with `CHECK_DEPS = { proxyManager: NOOP }` (the same neutralising deps `compose-config-v2-wiring.test.ts`
  already injects) and `catch → print message, exit 1`. `package.json`: `"check-config": "tsx src/main.ts --check-config"`.
  `deploy/rwe-update.sh`: after the test gate, `if [ -n "${RWE_CONFIG_PATH:-}" ]; then "$NPM" run check-config ||
  revert_and_fail "config check failed"; CONFIG_CHECK=passed; else CONFIG_CHECK=skipped; fi`, and `write_result` gains a
  `configCheck` field.
- **boundary:** `--check-config` runs the REAL `composeConfig` — a pure-validator subset would pass configs the boot refuses for
  another reason, which INV-V26-7 forbids ("never a false pass"); the NOOP proxy manager is the existing seam, so no new
  `listen:false` option is invented. **It mutates nothing, and that is verified in the tree, not assumed:** `composeConfig`
  opens no store — every `SqliteRunStore` / `WorkflowCatalog` / schedule DB is constructed inside `createServer()`
  (`main.ts:327`), which the check never calls — so running the NEW build's check against the production config while the
  OLD service is still serving runs no `ALTER TABLE` migration and touches no file; a unit test pins this by asserting the
  check path never reaches `createServer` (the same spawn mock, plus a `createServer` spy). `never` exhaustiveness on `switch (provider)` in the LiteLLM route emitter, the direct-fetch
  request builder and the catalog fetchers is what makes a fourth provider a compile-time to-do list. `validateAliases` narrows
  a RAW config type to `AliasMap` — after it, no code path holds a non-`Provider` string, so `profileFor`-style "unknown provider
  → no dial" branches disappear rather than being re-typed. The retired env names are inert in the LiteLLM subprocess env by
  design (ARCH-112); the grep guard checks engine code, generated config and docs, not `process.env`.
- **tests:** `tests/unit/providers.test.ts` (new; `PROVIDER_CAPS` total over `PROVIDERS` — a `satisfies` plus a runtime
  `Object.keys` equality; `validateAliases` on a 6-row map with 4 offenders lists all 4 in `offenders` AND in `message` — T1
  for "names the first only"; `resolveAlias` table incl. passthrough and unknown), `tests/unit/compose-config-v2-wiring.test.ts`
  (UT-033 row: a config with an `openai` row makes `composeConfig` reject with the message — the wiring lock), `tests/unit/main-check-config.test.ts`
  (new; `--check-config` path exits 1 with the message and 0 on a clean config, with the spawn mock the wiring test already
  uses), `tests/acceptance/val-078-update-helper.test.ts` (VAL-078 extended: the updater against a config carrying a `gpt41`
  row → `configCheck:'failed'`, service unchanged; without `RWE_CONFIG_PATH` → `configCheck:'skipped'`; then clean → `applied` —
  the ORDER is the assertion), `tests/unit/no-retired-surface.test.ts` (DES-173's guards).

### DES-173 — the deletion has its own definition of done: five identifiers, two provider literals, three env names, one fold, eighteen test files, twenty-six doc hits
- **traces:** ARCH-112, ARCH-117, ADR-041, ADR-045, REQ-123, REQ-126
- **signature:** DELETED from `src/`: `NON_ANTHROPIC_EXCLUDED_TOOLS`, `curateToolsForProvider` (`claude-agent-sdk-client.ts:193-224`),
  `thinkingFor` (`:322`), `EFFORT_PROFILES`/`profileFor`/`mapEffort` (`client.ts:41-59`), `ProviderEffortProfile` + the second
  `mapEffort` (`params/resolve.ts:191-198`), `ProviderProfile.effortMapping` + `thinkingMode` derivation (`session-options-builder.ts:18/96`),
  `STATIC_OPENAI` (`model-catalog.ts:72`), the `'openai'` and `'gemini'` arms of `client.ts` (`:183-240`), `sumUsageTokens`
  (`run-store.ts:72`, replaced by `foldUsage` — DES-179). Grep guard (`no-retired-surface.test.ts`, comment-stripped for
  `src/`, raw for `DEPLOY.md`/`README.md`/`rwe.env.example`/`docs/AUTHORING.md`): the identifiers above, the string literals
  `'openai'`/`'gemini'` (also `"openai"`), `OPENAI_API_KEY`, `OPENAI_API_BASE`, `GEMINI_API_KEY`, `provider: 'claude-agent-sdk'`
  (the transport name must not be assigned to `provider` anywhere — DES-176). Test files, by name, so the task is checkable:
  DELETE `tests/unit/provider-tool-curation.test.ts`; REWRITE `claude-agent-sdk-gateway-thinking.test.ts`, `gateway-effort.test.ts`,
  `params-resolve.test.ts` (the `mapEffort` half), `openrouter-provider.test.ts`, `model-catalog.test.ts`,
  `model-catalog-enrich.test.ts`, `models-list-tool.test.ts`, `budget-fold.test.ts` (UT-071 → `foldUsage`),
  `budget-resume-hydration.test.ts` (IT-067), `agent-record-harness-model.test.ts`, `harness-emission.test.ts`,
  `main-composition-root.test.ts`, `claude-agent-sdk-gateway-workspace-boundary.test.ts`, `claude-agent-sdk-gateway-allowed-tools.test.ts`,
  `claude-agent-sdk-provider-aware-env.test.ts`, `claude-agent-sdk-gateway-symlink-escape.test.ts`, `claude-agent-sdk-gateway.test.ts`,
  `val-019-non-anthropic-harness.test.ts` (VAL-019: the ollama run's tool surface now CONTAINS `Read`). (`claude-agent-sdk-gateway.test.ts`
  is on the list for its `result.tokens toEqual {input:3, output:2}` assertion at `:77`, not for a retired symbol.) **Plus the
  mechanical tier the symbol grep does not see:** 37 test files construct a two-column `tokens: {input, output}` literal on an
  `AgentRecord`/`GatewayResult`/usage event (`grep -rl "tokens: *{ *input" tests`) and every one of them fails `tsc` under the
  four-column `Tokens` — 22 integration, 13 unit, 2 acceptance (`val-007`, `val-088`-class). These are shape rewrites, not
  behavioural ones (a shared `tok(input, output)` helper in `tests/helpers/` that fills the cache columns with 0 turns them
  into one-line edits), but they are the bulk of task 6's size and must be counted, not discovered. Docs: DEPLOY.md (25
  hits: §"self-hosted OpenAI-compatible endpoint" replaced by "local: Ollama; cloud: OpenRouter"), README.md (1),
  `rwe.env.example` (the three names), `docs/AUTHORING.md` regenerated.
- **boundary:** The DoD lists files because "delete the openai path" is otherwise unfalsifiable at review — the v24 sweep
  (DES-159) is the precedent and it worked. `val-019` is the trap to watch: its current assertion (`Read` absent on a
  non-Anthropic harness) will go RED under REQ-123 and the cheap fix is to delete the line rather than invert it; the
  rewritten case asserts `Read ∈ tools` on the `default` (ollama) alias. Every deletion above is enforced twice — `tsc`
  (the imports vanish) and the grep — because a comment-stripped grep alone missed nothing last time but a `tsc`-only
  deletion leaves dead exports.
- **tests:** `tests/unit/no-retired-surface.test.ts` (UT-161 extended with a v26 block), and the eighteen files above; the
  grep target is zero before Gate 5's RED confirmation so genuine reds are not buried (ordering in §Task partition).

### DES-174 — `skeleton-graph.ts`: `deriveExpectedGraph` is TOTAL, joins skeleton to scan by character offset, and the scanner learns `allowedTools`, `alt` groups and one retired key
- **traces:** ARCH-113, ADR-039, ADR-029, REQ-128, REQ-124, REQ-111
- **signature:** `src/workflow-meta.ts` — `SkeletonNode` gains `at: number` (char offset of the call keyword), `line: number`,
  and `alt?: number` (group id shared by the two arms of one `?:` / `if…else` at the same delimiter depth, found with the
  scanner's string-aware `matchDelimiter` beside `dynamicRanges`); `AgentCallScan.calls[]` gains `at: number` and
  `allowedTools?: string[] | 'non-literal'` (a literal array of string literals → sorted copy; any other expression →
  `'non-literal'` and a violation `ALLOWED_TOOLS_NOT_LITERAL` with the line; absent → undefined). `AgentOpts.phase` is DELETED
  (types.ts:84), so the closed `AGENT_OPT_KEYS` record drops it and `AGENT_OPT_NEAR_MISSES.phase = 'call phase(title) before
  the agent() call — the phase is not a per-call option'` (the existing `PARAM_UNKNOWN` path carries it; zero new codes).
  `src/skeleton-graph.ts` —
  `export interface ExpectedLane { index:number; title:string|null; dynamic:boolean; slots:number[] }`;
  `export interface ExpectedSlot { index:number; lane:number|null; labels:string[]; kind:'single'|'parallel'|'alt'; dynamic:boolean; tools:Record<string, string[]|'default'>; line:number }`;
  `export interface ExpectedGraph { lanes:ExpectedLane[]; slots:ExpectedSlot[]; edges:Array<{from:number; to:number}> }`;
  `export function deriveExpectedGraph(nodes: SkeletonNode[], scan: AgentCallScan): ExpectedGraph` — TOTAL, never throws.
  Rules: (L1) one lane per `phase` node in source order, `title` = literal or `null`, `dynamic` from the node. (S1) an `agent`
  node → one `single` slot; (S2) nodes sharing `parallel` → one `parallel` slot; (S3) nodes sharing `alt` → one `alt` slot with the
  union of labels; (S4) `workflow` nodes are transparent. `slot.lane` = index of the last `phase` node before the slot's first
  call, or `null` when none precedes it. (T1) `tools[label]` = the scan call's `allowedTools` when it is an array, `'default'`
  when absent or `'non-literal'`. (E1) one edge between consecutive slots. Join: `scan.calls` matched to skeleton `agent` nodes
  by `at` equality; an unmatched node (e.g. `foo.agent(`) is dropped from slots with no error (it is not an `agent()` call).
- **boundary:** **Deviation from ARCH-113's `ExpectedGraph | {refused}` (property preserved):** a derivation that can refuse
  forces the run-DAG consumer — which must lay out a v1-contract run whose script legally dispatches before its first `phase()`
  — to handle a refusal it cannot act on; making the derivation total and moving the L2 refusal into the v2 checker (DES-181)
  keeps "one derivation, two consumers" and gives the checker one more rule in the place refusals already live. `slot.lane ===
  null` is the honest representation of "before any phase" for both consumers. Why offsets and not ordinals: the two regexes
  differ in their `.`-lookbehind, and an ordinal join silently mis-labels every slot after a method call named `agent` — a
  T1-shaped failure that no fixture without a `.agent(` would catch, so one fixture has it. Why `'non-literal'` is a violation
  and not `'default'`: the checker would then compare against `default` while the harness runs a variable's tools — the
  description-stops-matching shape (T4), on the one row REQ-128 exists to make truthful. `agentType`-supplied tools are
  invisible to the checker by design (frontmatter is server config); the harness table beside the diagram (DES-181) is where
  the RESOLVED surface is shown, so the drift is visible, not hidden. Deleting `AgentOpts.phase` changes no persisted byte
  (nothing ever set it — Gate 1 evidence) and `CallKey` stays byte-identical (INV-V26-1).
- **tests:** `tests/unit/skeleton-graph.test.ts` (new; fixtures are `(script, ExpectedGraph)` pairs written BY HAND from the
  rules — T2 — covering: sequential, `parallel([...])`, `parallel(xs.map(…))` (dynamic parallel), ternary `alt`, `if/else`
  `alt`, `workflow()` transparency, `parallel()` of `workflow()`, agent before first phase (`lane:null`), zero phases, dynamic
  title (`null`), a `foo.agent(` decoy, `allowedTools: []`, `allowedTools: tools` (non-literal), `phase:` per call →
  `PARAM_UNKNOWN`), `tests/unit/workflow-meta-skeleton.test.ts` (the `at`/`line`/`alt` fields on existing fixtures — T3 for
  fixtures that pinned the old shape), and the SAME fixture module imported by DES-175's layout tests and DES-181's checker
  tests (INV-V26-3 as a shared fixture, not a sentence).

### DES-175 — the phase is a receipt-time stamp on both hosts, carried on the record, the harness event and the snapshot; `capture` keeps it; `inferPhase` repairs old snapshots; `layoutGraph` joins by lane ordinal
- **traces:** ARCH-114, ARCH-113, REQ-124, REQ-008, REQ-055, REQ-119
- **signature:** `src/sandbox/host.ts` — `export type PhaseStamp = { title:string; index:number }`;
  `AgentRequestHandler = (prompt, opts, callSeq, phase?: PhaseStamp) => …`; `SandboxHostConfig.currentPhase?: () => PhaseStamp | undefined`;
  in `case 'agent'` the stamp is read SYNCHRONOUSLY before `Promise.resolve().then(…)`. `run-manager.ts` — `currentPhase` is
  supplied to BOTH `new SandboxHost` sites (`:920` top-level and `:1011` nested frames — a nested frame that never calls
  `phase()` inherits the parent's lane); `_handleAgentRequest(runId, positional, opts, callSeq, framePath, phase?)`;
  `markQueued(agentId, key.opts.label, framePath, phase)`. `agent-executor.ts` — `markQueued(agentId, label?, frame?, phase?: PhaseStamp)`
  (the old third positional `phase?: string` that read `key.opts.phase` is GONE); `capture(runId, req:{agentId; label?}, result, ts)`
  — `phase` is removed from `req` and the terminal record is built as `{...prev, …}` for `phase`/`phaseIndex`/`frame`/`startedAt`/
  `lastActivityAt`; the ONE decoration site (`:442`) adds `phase`/`phaseIndex` from `sink.getRecord(agentId)` onto the
  descriptor. `AgentRecord.phaseIndex?: number`; `HarnessDescriptor.phase?: string; phaseIndex?: number`. `run-store.ts` —
  `deriveAgentRecords` reads `descriptor.phase/phaseIndex` on BOTH branches (as it does `label`) and sets `startedAt` from the
  harness event's `ts` when absent. `src/dashboard.ts` — `export function inferPhase(rec: {startedAt?:string; endedAt?:string},
  phases: PhaseView[]): PhaseStamp | undefined` (last `phases[i]` with `ts <= (startedAt ?? endedAt)`; undefined when neither
  exists or all phases are later); `layoutGraph(expected: ExpectedGraph, liveAgents: AgentRecord[], phases: PhaseView[], opts?)`
  with lane = `rec.phaseIndex ?? inferPhase(rec, phases)?.index ?? 0`; `server.ts:506-507` passes `deriveExpectedGraph(…)` (or
  the empty graph when the skeleton is withheld under auth) and `view.phases`.
- **boundary:** The clobber at `agent-executor.ts:258/270` is the gap ARCH-114 does not see: the stamp lands on the queued
  record and is overwritten at terminal by a field nothing sets. Fixing it by carrying `prev` (the same pattern `frame` and
  `startedAt` already use) is one line per branch and removes the second source entirely. Lane rule, stated as a total
  function so the acceptance cannot ask for the impossible: `k < lanes.length && !lanes[k].dynamic` → lane `k`; `k >=
  lanes.length` → appended lane WITH a warning; `lanes[k].dynamic` → frame-grouped WITH a warning; no stamp and no inferable
  phase → lane 0 WITHOUT a warning (a v1 script may dispatch before its first `phase()`, and REQ-124 demands zero warnings on
  the ~30 existing production runs). Within a lane, a record is matched to a slot by LABEL against the slot's label set (`alt`
  consumes one, `parallel` up to its member count, `single` one); a record with no `label` (pre-v24) falls back to positional
  order by `startedAt`. Three cohorts, named: v26 runs exact (incl. `refused` records — `markQueued` precedes `assertBudget`);
  pre-v26 TERMINAL snapshots repaired at read by `inferPhase` (zero writes — a back-fill would be a second writer on a
  write-once snapshot); pre-v26 journals RESUMED across the upgrade replay with no stamp and no agreeing timestamps →
  frame-grouped WITH a warning (the one cohort REQ-124 does not cover, said out loud). INV-V26-1: `phase` never enters
  `key.opts`; the replay test is a v25 journal fixture replayed under v26 with zero misses.
- **tests:** `tests/unit/sandbox-host-phase-stamp.test.ts` (new; a child that sends `agent` then `phase('B')` in one chunk —
  the handler receives `{title:'A', index:0}`; the ARCH-114 `fork()` probe made a test), `tests/unit/agent-executor-capture-carries-phase.test.ts`
  (new; `markQueued(…, {title:'A',index:0})` → `capture(done)` and `capture(failed)` both keep `phase`/`phaseIndex` — the
  clobber trap, T1), `tests/unit/infer-phase.test.ts` (new; 8-row table incl. equal timestamps, refused record with `endedAt`
  only, empty phases), `tests/unit/graph-layout.test.ts` (UT-068 REWRITTEN to the new signature and the three cohorts —
  the red case: agents without `phase`, with `startedAt`, and a `phases[]` → zero warnings, correct columns; T3 for the old
  `phase:''` fixtures), `tests/unit/agent-record-harness-model.test.ts` (phase read on both branches), `tests/integration/resume-callkey-byte-identical.test.ts`
  (new; INV-V26-1 — a v25 journal fixture file under `tests/fixtures/`, replayed: zero misses, `JSON.stringify(key)` equal),
  `tests/integration/dag-route-existing-runs.test.ts` (new; a v25 `run_snapshots` fixture → `GET /api/runs/:id/dag` returns
  `warnings: []`), `tests/e2e/nested-frame-inherits-phase.test.ts` (E2E-010: a nested `workflow()` without `phase()` lands in
  the parent's lane).

### DES-176 — the result carries what was resolved and which transport carried it; `capture` prefers the harness stamp; one drift test on both gateways
- **traces:** ARCH-115, ARCH-111, REQ-125, REQ-122, REQ-037, REQ-020
- **signature:** `src/gateway/client.ts` — `export type Transport = 'claude-agent-sdk' | 'direct-fetch'`; `GatewayResult` (both
  arms): `transport: Transport; provider: string /* RESOLVED */; model: string /* resolved id, never the alias */; proxyModel?: string`.
  Every literal `provider: 'claude-agent-sdk'` in the SDK client becomes `transport: 'claude-agent-sdk', provider: resolved.provider,
  model: resolved.model` using DES-172's `resolveAlias` result computed once per `_invokeOnce` (a pre-resolution terminal such
  as `ANTHROPIC_AUTH_MISSING` carries `provider: 'unknown'`). `agent-executor.ts capture()`: `provider: prev?.provider || result.provider`,
  `model: prev?.model || result.model`, `transport: result.transport`, `...(result.proxyModel ? {proxyModel} : {})`; the usage
  event data is `{tokens, costUSD, provider, model, transport, proxyModel?, unmapped?}` on success and `{reason, provider, model,
  transport, detail, error?, unmapped?}` on failure. `AgentRecord.transport?: Transport; proxyModel?: string`.
- **boundary:** Fix at the source so the executor rule is a safety net: the SDK client already knows the resolved pair (it
  builds `HarnessDescriptor.provider/model` from it at `:481-537`), so returning the transport under `provider` was a naming
  error, not missing information. The `||` (not `??`) is deliberate and commented: a harness stamp of `''` (never built) must
  lose to the gateway's value. Tests that today assert `provider:'claude-agent-sdk'` move to `transport` — listed in DES-173
  so the mid-tier reader does not "fix" them by asserting the new lie.
- **tests:** `tests/unit/agent-record-resolved-names.test.ts` (new; the REQ-125 red case: `markHarness(openrouter,
  google/gemini-3.8-flash)` then `capture({provider:'openrouter', model:'google/gemini-3.8-flash', transport:'claude-agent-sdk',
  proxyModel:'rwe-proxy-gem'})` and a `failed` variant → record keeps `openrouter`/`google/gemini-3.8-flash`, gains `transport`),
  `tests/integration/provider-name-drift.test.ts` (new; booted engine, fake SDK session AND direct-fetch fake transport: for
  each, `harness.descriptor.provider === record.provider === usageEvent.data.provider` and the same for `model` — the three-names
  defect as one assertion), the DES-173 rewrites.

### DES-177 — `ModelBook`: one TTL'd, single-flight snapshot with an injected clock; four numeric rates per row; the pin is written at admission and read back at resume
- **traces:** ARCH-116, ADR-038, REQ-127, REQ-126, REQ-039, REQ-078
- **signature:** `src/models/model-book.ts` —
  `export type FourRates = { in:number; out:number; cacheRead:number; cacheWrite:number }` (USD per TOKEN);
  `export type Caps = { reasoning: boolean|'unknown'; tools: boolean|'unknown'; source:'upstream'|'static'|'unknown' }`;
  `export type BookEntry = { price: FourRates|null; caps: Caps }`;
  `export type PinnedBook = { fetchedAt: string|null; source:'live'|'last-good'|'static'; pinned: Record<string /* provider/model */, BookEntry> }`;
  `export interface BookSnapshot { fetchedAt: string|null; source: PinnedBook['source']; entries: ModelEntry[]; lookup(provider: Provider, model: string): BookEntry; pin(targets: Array<{provider:Provider; model:string}>): PinnedBook }`;
  `export class ModelBook { constructor(source: () => Promise<ModelEntry[]>, opts: { clock: Clock; ttlMs?: number /* 3_600_000 */ }); snapshot(): Promise<BookSnapshot> }`
  — `snapshot()` returns the cached snapshot while `clock.now() - fetchedAtMs < ttlMs`; otherwise starts ONE `source()` shared
  by every concurrent caller; a throwing/timing-out `source()` yields the last-good snapshot with `source:'last-good'`, or, with
  no last-good, a `'static'` snapshot (static Anthropic rows + ollama). `lookup`: `ollama` → all-zero rates for ANY model
  name, `caps:{reasoning:false, tools:'unknown', source:'static'}`; `anthropic` → the static table's `ratesPerToken`
  (`STATIC_ANTHROPIC` gains `ratesPerM:{in,out,cacheRead,cacheWrite}` + `reviewedAt`; `price` display is DERIVED by
  `displayPrice(rates)`); `openrouter` → `pricing.prompt/completion/input_cache_read/input_cache_write` parsed by
  `parseRate(s): number|null` (a missing cache rate = the `prompt` rate — an upper bound; a non-numeric string → `null` for the
  whole entry, never `0`); unlisted → `{price:null, caps:{reasoning:'unknown', tools:'unknown', source:'unknown'}}`.
  `run-store.ts` — `createRun(spec, scriptVersion?, effectiveParams?, priceBook?: PinnedBook)`; `getSpec` returns `RunSpec & { priceBook?: PinnedBook }`;
  `sqlite-run-store.ts`: `ALTER TABLE runs ADD COLUMN price_book TEXT` (try/catch like `effective_params`); `InMemoryRunStore` parity.
  `RunManager.start()`: `reachable = reachableModels(effectiveParams)` (`{model} ∪ agents[*].model`, resolved via `resolveAlias`)
  → `pin = (await book.snapshot()).pin(reachable)` → `createRun(…, pin)`; `resume()` reads it back. `RunEntry.priceBook`;
  `AgentExecutorDeps.priceBook`. `server.ts`: `new ModelBook(config.modelCatalog ?? buildCatalog(…), {clock})` replaces the bare
  builder; `models_list` renders from `snapshot().entries`.
- **boundary:** The loader is the already-injectable `config.modelCatalog`, so a unit test injects a deferred `source()` and a
  `FixedClock`, then proves single-flight (N callers, one call), TTL (advance the clock, second call), last-good (throwing
  source after a good one → `'last-good'`), and static (throwing source first → `'static'`). `Clock.now()` (ms) exists on the
  seam already. Per-token internally, per-M only in display and in the static table's human-readable literal — converted once
  at module load, so `priceCall` is a bare `Σ tokens[k] × rates[k]`. The pin is a JSON column on the run row because that is
  where every other admission-time immutable already lives (`effective_params`), and it must be readable at resume for the
  same reason `effective_params` is. Not built: persisted last-good (ADR-038 records the consequence), per-row `declaredAt`,
  a pricing service.
- **tests:** `tests/unit/model-book.test.ts` (new; ~14 cases incl. the four `lookup` provinces, `parseRate('abc')` → null
  entry, missing cache rate = prompt rate, `pin()` keys, and a `'$5/1M'` display derived from `ratesPerM` — T4 on the display
  string), `tests/unit/model-catalog.test.ts` (rewritten for numeric rates; `STATIC_OPENAI` cases deleted — T3),
  `tests/integration/price-book-pinned-at-admission.test.ts` (new; two `run_start`s around a catalog change: each run's
  `price_book` differs, and a resumed run prices a post-resume dispatch from ITS pin — INV-V26-4), `tests/unit/sqlite-run-store.test.ts`
  (the column round-trips; a pre-v26 row reads `priceBook: undefined`).

### DES-178 — `wireEffort` is the single writer of `thinking` and `effort`, keyed by provider × the PINNED capability; the gateway indexes the pin after resolution; `models_list` renames in and out
- **traces:** ARCH-117, ARCH-112, ADR-045, REQ-126, REQ-123, REQ-110, REQ-038
- **signature:** `src/gateway/client.ts` — `export const REASONING_BUDGET: Record<Effort, number> = { low:1024, medium:2048,
  high:4096, xhigh:4096, max:4096 }`;
  `export function wireEffort(provider: Provider|undefined, caps: Caps|undefined, effort?: Effort): { thinking: ThinkingConfig|undefined; effort?: Effort; applied?: EffortApplied }`
  — total, six rows: `anthropic` → `{thinking: undefined, effort, applied: effort ? {applied:true, param:'effort',
  restPath:['output_config','effort'], value: effort} : undefined}`; `openrouter` ∧ `caps.reasoning === true` ∧ effort →
  `{thinking:{type:'enabled', budgetTokens: REASONING_BUDGET[effort]}, applied:{applied:true, param:'thinking',
  restPath:['thinking','budget_tokens'], value: REASONING_BUDGET[effort]}}`; `openrouter` ∧ `reasoning false|'unknown'` →
  `{thinking:{type:'disabled'}, applied: effort ? {applied:false, reason: false ? 'model does not declare reasoning' : 'model
  reasoning support unknown'} : undefined}`; `openrouter` ∧ no effort → `{thinking: caps.reasoning === true ? undefined :
  {type:'disabled'}}`; `ollama`/`undefined` → `{thinking:{type:'disabled'}, applied: effort ? {applied:false, reason:'no reasoning
  dial for this provider'} : undefined}`. `GatewayClient.invoke(req)` gains `pin?: PinnedBook`; the SDK client computes
  `resolved = resolveAlias(aliases, req.opts.model)`, `caps = req.pin?.pinned[`${resolved.provider}/${resolved.model}`]?.caps`,
  and `wireEffort(...)` is the ONLY assignment to `options.thinking` and `options.effort` (`:512/:537` collapse into it).
  `effortBodyFields(provider, caps, effort)` in the direct-fetch client reads the same `PROVIDER_CAPS[p].effort`. `models/model-catalog.ts`
  — `EnrichedModelEntry`: `toolUse` RENAMED `toolUseDeclared: boolean|'unknown'`; `+ effortDeclared: boolean|'unknown'`;
  `+ declaredSource: 'upstream'|'static'|'unknown'`; `+ catalogFetchedAt: string|null` on EVERY row (see boundary);
  `CatalogFilter.toolUse` → `toolUseDeclared`; `TOOL_SPECS.models_list.inputSchema.toolUseDeclared` and the description
  sentence *"flags are DECLARED (upstream listing or provider convention), not probed"*.
- **boundary:** Effort is provider × MODEL, and the model fact must come from the run's pin (INV-V26-4), never a fresh
  lookup at dispatch; the pin is a map keyed by resolved names, and only the gateway holds the resolver at the moment of
  dispatch, so the whole pin travels (one optional field) rather than the executor pre-resolving with an alias table it does
  not have. Absent pin (a test or a trigger path) → `caps` undefined → the fail-safe `'unknown'` branch: thinking disabled,
  `applied:false` with a reason — never the SDK default on a non-Anthropic model (the v3 spike's 400). UT-101's byte-identical
  Anthropic request is untouched: for `anthropic` the function returns `thinking: undefined`, exactly today's SDK-default path.
  **`catalogFetchedAt` per row (deviation from ARCH-116/117's "one top-level field", property preserved):** `models_list`
  returns an ARRAY today and the dashboard's models panel, `models-list-tool.test.ts`, VAL-087 and the plugin's schema notes
  all read that array; wrapping it in an object to carry one timestamp breaks every reader to save a repeated string. The
  honest "as of" is still one value from one snapshot — repeated, not re-derived — and it is NOT the per-row `declaredAt`
  ARCH-116 declined (that was a probe time, this is the fetch time). Rename with no alias window per the v24 ruling; the
  input filter renames with the row so a caller cannot filter on a name the row no longer has (T4).
- **tests:** `tests/unit/gateway-effort.test.ts` (UT REWRITTEN: the six-row `wireEffort` table — the red case
  `wireEffort('openrouter', {reasoning:true,…}, 'low')` → `applied:true` with `budgetTokens:1024`; the byte-identical anthropic
  request re-pinned; T3 for `mapEffort`/`profileFor`), `tests/unit/claude-agent-sdk-gateway-thinking.test.ts` (rewritten: the
  wire `options.thinking` for each of the six rows via the fake `queryImpl`, plus a source guard that `options.thinking` and
  `options.effort` are assigned exactly once in the file — INV-V26-2), `tests/unit/models-list-declared.test.ts` (new;
  `toolUseDeclared`/`effortDeclared`/`declaredSource`/`catalogFetchedAt` on an openrouter row with `supported_parameters`, an
  anthropic static row, an ollama row; `toolUse` ABSENT from every row and refused as an unknown filter — T3/T4),
  `tests/integration/models-list-tool.test.ts` (rewritten for the rename), `tests/acceptance/val-172-effort-openrouter.test.ts`
  (VAL-172: real LiteLLM `--detailed_debug` capture greps `reasoning_effort` for low vs high on a declared-reasoning model; ollama
  `applied:false`; skips loudly without a key).

### DES-179 — four-column `Tokens` with per-transport semantics, `priceCall`, `costUSD` computed once, `RunGuard` with two limits, `parseBudget` as the one normaliser, `RunUsage` produced live and at rest
- **traces:** ARCH-118, ADR-037, ADR-046, REQ-127, REQ-120, REQ-001, REQ-059
- **signature:** `src/types.ts` — `export type Tokens = { input:number; output:number; cacheRead:number; cacheWrite:number }`;
  `export const ZERO_TOKENS: Tokens`; `export function sumTokens(t: Tokens): number`; `export type BudgetSpec = { usd:number|null; tokens:number|null }`;
  `export interface RunUsage { tokens: Tokens; costUSD: number; unpricedCalls: number; unmappedMessages: Record<string, number> }`;
  `RunStatusView.usage: RunUsage`; `RunSpec.budget?: BudgetSpec | number | null` (the `number` arm is READ-BACK ONLY, documented
  like `script`); `AgentRecord.tokens: Tokens; costUSD?: number|null` (present on `done`). Sandbox `Budget`:
  `{ total: number|null /* USD */; spent(): number /* USD */; remaining(): number|null; tokens(): Tokens & { total:number; limit:number|null } }`.
  `src/run-guard.ts` — `export function parseBudget(raw: unknown): BudgetSpec | null` (`null|undefined` → null; a finite
  non-negative `number` → `{usd:null, tokens:n}` with the comment "persisted v25 meaning"; `{usd?, tokens?}` → normalised with
  `null` for absent; anything else → throws `codedError('INVALID_ARGUMENT')` — unreachable past the schema, kept as the
  defensive arm); `RunGuard({concurrency, budget: BudgetSpec|null})`; `addUsage(tokens: Tokens, costUSD: number|null, unmapped?: Record<string,number>)`;
  `setUsage(fold: RunUsage)` (resume, once); `usage(): RunUsage`; `assertBudget()` throws `BudgetExceededError({limit:'usd'|'tokens', spent, total})`
  when EITHER `spentUsd >= usd` or `spentTokens >= tokens` (the `null` limit never fires); `budgetView()` returns
  `{ total: BudgetSpec|null, spentUsd(), spentTokens(), tokens() }`. `export function priceCall(tokens: Tokens, rates: FourRates|null): number|null`.
  `src/run-store.ts` — `export function foldUsage(events: TranscriptEvent[]): RunUsage` replaces `sumUsageTokens`: a v26 usage
  event contributes its four columns, its stored `costUSD` (never re-priced) and its `unmapped`; a pre-v26 two-column event
  contributes `cacheRead=cacheWrite=0` and `unpricedCalls += 1` (comment: "drops nothing it had; names the missing price").
  `agent-executor.ts capture()`: `costUSD = priceCall(result.tokens, pin.pinned[`${provider}/${model}`]?.price ?? null)`
  computed ONCE, written on the record and the usage event, fed to `guard.addUsage`. SDK client: `tokens = { input:
  usage.input_tokens, output: usage.output_tokens, cacheRead: usage.cache_read_input_tokens, cacheWrite:
  usage.cache_creation_input_tokens }` from `result.usage` (`NonNullableUsage` carries all four), falling back to the sum over
  `modelUsage[*].apiUsage` ONLY when `usage` is absent. Direct-fetch OpenRouter: `cached = prompt_tokens_details?.cached_tokens ?? 0`,
  `input = prompt_tokens - cached`, `cacheRead = cached`, `cacheWrite = cache_write_tokens ?? 0`; ollama: both cache columns 0.
  IPC: `start.budget: BudgetSpec|null` (replaces `budgetTotal`), `agentResult.spent: { usd:number; tokens: Tokens }`;
  `host.ts:103/:110` and `run-manager.ts:925/956/1023` follow; `child-entry.ts` inlines the four-column sum (no local value
  import — the sandbox-child constraint). `run_start.budget` schema: `{type:'object', properties:{usd:{type:'number',
  minimum:0, description:'Spend limit in USD, computed from each model's four token rates pinned at run start'},
  tokens:{type:'integer', minimum:0, description:'Token limit (input+output+cacheRead+cacheWrite); the only limit a local
  (price 0) model can hit'}}, minProperties:1, additionalProperties:false, description:'Stop-dispatching signal, not a hard
  ceiling — either limit reached refuses the next agent() (BUDGET_EXCEEDED); in-flight calls finish. Not a bare number.'}`.
  `run_result` gains `meta: { usage: RunUsage }` read from the same view; `RunDagSnapshot.usage` is saved at terminal.
- **boundary:** Per-transport token semantics are stated at each seam because they differ: Anthropic's four are ADDITIVE
  (`input_tokens` excludes both cache columns); OpenRouter's `prompt_tokens` INCLUDES `cached_tokens`, so `input` is the
  difference and an ABSENT `cached_tokens` prices the whole prompt at the `in` rate — an over-count, the safe direction for a
  limit, with the comment naming it (D-V26-projection). `remaining()` returns `null` when no USD limit exists (settled) — the
  guide sentence pairs with it. One `RunUsage` shape with two producers — the guard while live, `foldUsage` at rest — and one IT
  that proves they agree on a completed run; that equality is the double-count guard IT-067 used to state in prose.
  `unpricedCalls` counts a `done` call with `price:null` only; a failed call carries no usage. Float accumulation is fine at
  this scale (ARCH-118's arithmetic); "correct to the cent" is asserted with `toBeCloseTo(…, 2)` on a fixture reproducing the
  Gate 1 haiku numbers (18 / 20,762 / 19,522 / 282 at Haiku's four rates). `BudgetExceededError.message` names the limit that
  fired so the `refused` record's reason is not ambiguous between the two.
- **tests:** `tests/unit/parse-budget.test.ts` (new; 9-row table incl. the legacy number → `{tokens:n}`, `{}` refused, negative
  refused, `{usd:0}` allowed and fires immediately), `tests/unit/run-guard.test.ts` (UT-002/UT-170 REWRITTEN: `addUsage` on
  both limits, `null` limit never fires, `{limit}` on the error, unpriced counting — T3), `tests/unit/price-call.test.ts` (new;
  the haiku fixture to the cent, `null` rates → null, zero rates → 0), `tests/unit/budget-fold.test.ts` (UT-071 REWRITTEN to
  `foldUsage`: v26 events, pre-v26 events, mixed — T3), `tests/unit/claude-agent-sdk-gateway-usage.test.ts` (new; a fake
  `result` with the four columns → four columns; `usage` absent → `modelUsage` sum; the red case "18 recorded" is now a
  four-column assertion), `tests/unit/gateway-client.test.ts` (OpenRouter `cached_tokens` present/absent, ollama zeros),
  `tests/unit/sandbox-budget-api.test.ts` (new; in a real vm context: `budget.total`, `spent()`, `remaining() === null` under
  tokens-only, `tokens().limit`, and a `budget: {usd:0}` script whose second `agent()` throws `BUDGET_EXCEEDED` — reuses
  IT-140's shape), `tests/integration/usage-live-equals-fold.test.ts` (new; booted engine, fake gateway: after completion,
  `run_status.usage` deep-equals `foldUsage(all transcripts)` and equals `run_result.meta.usage` — the two-producer lock),
  `tests/integration/budget-resume-hydration.test.ts` (IT-067 rewritten: resume rehydrates BOTH limits from stored `costUSD`;
  a catalog change between crash and resume does not change the total — INV-V26-4), `tests/integration/parallel-budget-fanout-width.test.ts`
  (IT-135..139 re-pinned to `{tokens}` so v25's three-branch guarantee survives the unit change — the highest-value T3 in the slice),
  `tests/unit/tool-specs.test.ts` (the `budget` description contains `USD`, `tokens`, `Not a bare number` — T4; a bare `200000`
  refused by the schema).

### DES-180 — admission: `priceVerdict` is one pure predicate for ADR-038's rule (d); the owner's overrule deletes one call
- **traces:** ARCH-116, ARCH-118, ADR-038, REQ-127
- **signature:** `src/run-guard.ts` (beside `parseBudget`) —
  `export function priceVerdict(budget: BudgetSpec|null, pin: PinnedBook, reachable: Array<{provider:Provider; model:string; alias:string}>): { ok:true } | { ok:false; code:'PRICE_UNKNOWN'; unpriced: string[]; message: string }`
  — `ok:false` iff `budget?.usd !== null && budget.tokens === null && reachable.some(r => pin.pinned[key(r)].price === null)`;
  `message`: *"<alias> (openrouter/<id>) has no price in the catalog (source: live, fetched <ts>); a USD-only budget cannot
  count it — add budget.tokens, omit budget.usd, or retry when the catalog is reachable"*. `ERROR_CATALOG.PRICE_UNKNOWN =
  { see:'workflow_authoring_guide', hint:'a USD-only budget meets a model the catalog cannot price; add a token limit or
  omit the USD limit' }`. Called in `RunManager.start()` after `parseBudget` and the pin, before `createRun`.
- **boundary:** Designed and tested as ADR-038(d) because that is the architecture's stance; the owner's overrule (REQ-127
  literal, admit and count) is `delete the call, the predicate, its catalog row and its test` — no flag, no second policy
  source, exactly the "one branch in the admission path" ADR-038 promises. The verdict carries `pin.source`/`fetchedAt` in
  its message because a refusal on six-hour-stale prices must say so (ARCH-116's provenance is load-bearing here). The refusal
  spends nothing: it precedes `createRun`, so no row, no directory, no pin persisted.
- **tests:** `tests/unit/price-verdict.test.ts` (new; 8-row table: USD-only + unpriced → refuse; USD+tokens + unpriced →
  admit; tokens-only → admit; no budget → admit; ollama price 0 is PRICED; anthropic static priced; `'last-good'` source in
  the message — T2 guarded by writing the table from ADR-038's prose), `tests/integration/run-start-price-unknown.test.ts`
  (new; booted engine with an injected catalog lacking one openrouter row: `run_start({budget:{usd:1}})` on a workflow naming it →
  `PRICE_UNKNOWN`, `run_list` unchanged; with `{usd:1, tokens:1e6}` → admitted and the call lands `costUSD:null`,
  `meta.unpricedCalls === 1`, and the dashboard run page renders the counter — the ADR-046 named-reader assertion).

### DES-181 — `checkMermaid` v2: the checker names its `ErrorCode`, four rules stated as decision procedures, edges over label sets, `<-->` outside the directed set, the `tools:` row recognised by prefix; `diagram_contract` on the immutable row
- **traces:** ARCH-119, ARCH-113, ADR-039, ADR-043, REQ-128, REQ-111, REQ-112, REQ-116, REQ-117
- **signature:** `src/check-mermaid.ts` — `CheckMermaidResult` gains `code?: ErrorCode` and `expected?: unknown`;
  `const RULE_CODE: Record<Rule, ErrorCode>` = every existing rule → the code the catalog assigns it TODAY (`DIAGRAM_SCRIPT_MISMATCH`
  → `DIAGRAM_MISMATCH`; `SIZE`/`MERMAID_INVALID`/`SUBGRAPH_TITLE`/`DUPLICATE_NODE`/`UNDECLARED_NODE`/`COLLAPSED_EDGE`/
  `AGENT_LABEL_FORMAT`/`VALUE_MISMATCH`/`LOOP_LABEL` → `MERMAID_INVALID`) plus `DIAGRAM_DIRECTION`, `LANE_MISMATCH`,
  `TOOLS_MISMATCH`, `EDGE_MISMATCH` → themselves; `workflow-catalog.ts:494`'s ternary is replaced by `diagramCheck.code`.
  `checkMermaid(src, scriptLabels, agentDefaults, limits, v2?: { expected: ExpectedGraph })`. With `v2`, after (1) size: **(10)
  `DIAGRAM_DIRECTION`** — line 1 must match `/^(graph|flowchart)\s+LR$/` (`expected:'graph LR'`, `line:1`). After (9): **(11)
  `LANE_MISMATCH`** — (a) if `expected.lanes.length === 0`: no `subgraph` may appear (expected `{lanes:0}`); (b) else the top-level
  `subgraph` blocks in source order equal `lanes` in COUNT; a literal `title` must equal the block's title, `null` accepts any
  non-empty; nested subgraphs → `MERMAID_INVALID`; (c) every stadium must sit inside exactly the block whose index equals its
  slot's `lane` (a stadium outside any block, or in another block, is refused with `expected:{label, lane:{index,title}}`);
  (d) a slot with `lane:null` while lanes exist → refused pointing at the SCRIPT line (`expected:{slot, hint:'every agent() must
  follow a phase()'}`) — ARCH-113's L2, relocated. **(12) `TOOLS_MISMATCH`** — the stadium text's LAST `<br/>` segment must
  start with `tools:` (the value triple stays optional in the middle: `label<br/>[model · effort · timeout<br/>]tools: …`);
  `tools: none` ⇔ `[]`; `tools: a, b` ⇔ the sorted list joined by `, `; expected `'default'` ⇔ the segment is literally
  `tools: default` (no resolved list is ever compared or frozen — the checker cannot see the default surface, so the WORD is
  what it checks); mismatch carries `expected:{label, tools}`. **(13) `EDGE_MISMATCH`** over the DIRECTED edge set (`-->` and
  `-.->`; `<-->` excluded exactly as in cycle detection): let `S(i)` be the stadiums whose label ∈ `slots[i].labels`, and
  `reach(a,b)` be "a directed path whose intermediate nodes are all non-stadium shapes"; for every expected edge `i→i+1`:
  (E-a) every `s ∈ S(i)` reaches some `t ∈ S(i+1)`; (E-b) every `t ∈ S(i+1)` is reached by some `s ∈ S(i)`; (E-c) a reach between
  stadiums of NON-consecutive slots (either direction) is refused unless the LEAVING edge carries `|label|` (a documented loop
  or skip — cycle rule (8) already demands the label on a back-edge); (E-d) no reach between two stadiums of the same
  `parallel` or `alt` slot. Refusal carries `expected:{from:{slot, labels}, to:{slot, labels}}` and the first offending line.
  `workflow-catalog.ts`: `ALTER TABLE workflow_versions ADD COLUMN diagram_contract TEXT`; `insertVersion` writes `'v2'`;
  `VersionEntry.diagramContract: 'v1'|'v2'` (`NULL` → `'v1'`); `validateRegistration` builds `expected =
  deriveExpectedGraph(parseWorkflowSkeleton(script), scan)` and passes `{expected}`; `WorkflowDescribeView.diagramContract`;
  `EXPECTED_DESCRIBE_KEYS` re-pinned (deliberately — T3 on the oracle). `workflow_register.mermaid`'s description is rendered
  from `HEADER_RE`/`SHAPES`/the four rule names. Dashboard workflow page: a `<table>` — one row per `params.agents.<label>`:
  label / declared model → resolved (via `resolveAlias`) / effort / timeoutMs / `allowedTools` or `default` — via `textContent`.
- **boundary:** Over labels because the diagram is allowed several stadiums for one label (example 3's `r1/r2/r3`, a
  `dynamic` parallel); over `<-->`-excluded edges because a debate is a legitimate v1 construct the owner kept (example 7). The
  `tools:` row is recognised by PREFIX on the last segment, not by position, because the value triple is optional today and
  "third segment" is ambiguous without it. Literal `tools: default` (sharpening D7, property preserved): the QD-held mechanic
  was "never partially compare against a resolved list" — requiring the word compares nothing against a list, while
  SKIPPING the row entirely would let `tools: Read` stand on a default-surface agent (T4 on the one row this REQ is about).
  The code table is pinned to today's mapping so no v1 fixture changes code — a change there is a Gate 8 finding, not an
  implementation choice. Rule order: (10) first because it is the cheapest refusal a cold model can fix; (11)–(13) last
  because they need the node table. Testability is a coverage assertion: each of the four codes has ≥2 negative fixtures and
  each v2 construct has ≥1 registering example (DES-182). Not built: a Mermaid diff, a generator, a per-workflow contract
  override.
- **tests:** `tests/unit/check-mermaid.test.ts` (the 14 v1 cases KEPT verbatim and each asserted to still return its code
  through `RULE_CODE` — the T3 lock on grandfathered behaviour), `tests/unit/check-mermaid-v2.test.ts` (new; ≥24 cases from the
  DES-174 fixture module: TD header; lane count/order/title/`null` title; stadium in the wrong lane; agent-before-phase; zero
  lanes with a decorative subgraph; `tools: none`/list/`default`/missing/unsorted; E-a..E-d each positive and negative;
  `<-->` inside a parallel passes; a labelled back-edge passes; an unlabelled skip fails; `r1/r2/r3` all `researcher` pass),
  `tests/unit/workflow-catalog.test.ts` (`diagram_contract` written `'v2'`; a NULL row reads `'v1'`; the catalog no longer
  computes a code — a source guard that the ternary is gone), `tests/integration/diagram-contract-grandfather.test.ts` (new;
  a v25 catalog DB fixture with a `graph TD` row → boot → `workflow_describe.diagramContract === 'v1'`, `/diagram.svg` 200,
  `run_start` admitted, no re-check), `tests/integration/workflow-describe-keys.test.ts` (the re-pinned key list),
  `tests/unit/dashboard-workflow-harness-table.test.ts` (new; page-source + a model-level test of the row builder).

### DES-182 — the guide examples become the v2 corpus: twelve examples, every v2 construct registered green, the four refusals exercised negatively
- **traces:** ARCH-119, ARCH-121, ADR-039, REQ-128, REQ-112, REQ-116, REQ-117
- **signature:** `src/authoring-guide.ts GUIDE_EXAMPLES` — all `graph TD` → `graph LR`; every stadium gains its `tools:` row.
  Shape changes: **1/9/10** (one agent, no `phase()`) stay lane-less (`writer(["writer<br/>tools: default"])`); **2** (draft/edit/
  final) → three lanes; **3** (parallel researchers → combiner) gains `phase('research')`/`phase('combine')` and keeps `r1/r2/r3`;
  **4** (scorer → aggregation) → one lane + the `{{…}}` aggregation node; **5** (classifier → simple|complex) → one lane, a
  diamond, two labelled edges, an `alt` slot; **6** (writer ⇄ critic) → one lane, labelled loop edges; **7** (debate) — the
  decorative `subgraph "debate"` becomes a real `phase('debate')` in the script and stays a `<-->` inside a `parallel` slot;
  **8** (black-box `workflow()` → summarizer) → the rectangle stays edge-transparent; NEW **11** `parallel([() => workflow(…),
  () => workflow(…)])` (no slot, no edge constraint); NEW **12** `for (const t of tiers) { phase('tier:' + t); … }` is NOT a v2
  example (a loop body is `dynamic`) — instead **12** is `phase('tier:' + args.tier)` (a dynamic TITLE, `null` lane matched by
  position). The `Canonical diagram` guide section is rendered from `DIAGRAM_DIRECTION`'s header literal, the lane/tools/edge
  rule names and ONE worked example (2). `tests/fixtures/mermaid-v2-negative.ts`: ≥2 fixtures per v2 code.
- **boundary:** Examples are the acceptance corpus, not prose: `guide-examples-register.test.ts` registers each against a
  booted engine (one `it` each — an example that stops registering is a failing test, the v23 lesson), `val-mermaid-renders`
  renders each in a real browser, and the REQ-117 cold-model probe at Gate 7.5 is the arbiter of whether the text teaches
  enough. Example 7 is the one owner-visible reshaping (a decorative subgraph is no longer legal when lanes exist) and is
  called out for the synthesizer.
- **tests:** `tests/integration/guide-examples-register.test.ts` (12 `it`s — T3 for the ten old TD strings), `tests/unit/authoring-guide.test.ts`
  (UT-159: `Canonical diagram` section present; the `workflow_register.mermaid` description contains `graph LR`, `tools:`,
  the four code names — T4), `tests/acceptance/val-mermaid-renders.test.ts` (12 rows, `UNVERIFIED` when no browser),
  `tests/unit/check-mermaid-v2.test.ts` (the negative fixtures, DES-181).

### DES-183 — `dagBox` is pure and exported; the page carries `viewBox`, `width=100%` and one `.zoomable` wrapper for both figures; the picture is asserted by Playwright, the source by a string test
- **traces:** ARCH-120, ADR-044, REQ-129, REQ-119, REQ-008
- **signature:** `src/dashboard.ts` — `export const DAG_BOX = { cellW:140, cellH:44, gap:14 } as const`;
  `export function dagBox(cells: Array<{col:number; row:number; laneSpan:number}>, box = DAG_BOX): { width:number; height:number }`
  (`(maxCol+1)*(cellW+gap)+gap` × `(maxRow+maxSpan)*(cellH+gap)+gap`; empty → `{0,0}`). `dashboard-page.ts` — `DAG_BOX` and
  `dagBox` are interpolated into the inline script (as `MORANDI_PALETTE` is); `renderGraph` sets `viewBox="0 0 W H"`,
  `width="100%"`, `preserveAspectRatio="xMinYMin meet"` and removes the absolute `width`/`height` attributes; a `.zoomable`
  wrapper around `#diagram-img` and `#dag-graph` with wheel → scale about the cursor (clamped 0.25–4), pointer drag →
  translate, a `fit` button → identity, `resize` → re-fit; `#diagram-img{max-width:100%}` is the fit state.
- **boundary:** View layer only; no stored diagram is touched, which is what gives v1 `graph TD` rows the same zoom (REQ-129's
  own clause). The client keeps `createElementNS` + `textContent` (ADR-044) — the zoom is a CSS transform on a wrapper and
  executes nothing. Testability split honestly: the box math is a unit test; the emitted page is a template string a unit test
  greps for the four attributes and the wrapper; the BEHAVIOUR (wheel changes the transform, fit resets, both figures fit
  1100 px) is Playwright in the existing `val-018` tier with a screenshot as evidence; nothing in between is claimed.
- **tests:** `tests/unit/dag-box.test.ts` (new; 5 rows incl. empty and `laneSpan>1`; the red case: a rendered payload's SVG has
  a `viewBox`), `tests/unit/dashboard-page-source.test.ts` (new; `setAttribute('viewBox'`, `preserveAspectRatio`, `.zoomable`,
  and NO `setAttribute('width', String(svgW))`), `tests/acceptance/val-018-dashboard-browser-ui.test.ts` (VAL-018 extended:
  1100 px viewport, an 11-node TD workflow and a 9-agent five-phase run — both bounding boxes ≤ container width; wheel event →
  `transform` changes; fit → identity; screenshot saved under `evidence/`).

### DES-184 — the guide's five gaps are rendered from exported constants, and each constant has a drift lock that executes the thing it describes
- **traces:** ARCH-121, ADR-032, ADR-045, REQ-130, REQ-116, REQ-117, REQ-001, REQ-121, REQ-127
- **signature:** `src/sandbox/guards.ts` — `export const SANDBOX_GLOBALS = ['agent','parallel','pipeline','phase','log','args','budget','workflow','Date','Math'] as const`;
  `export const DETERMINISM_GUARDED: ReadonlyArray<{ call:string; probe:string; why:string; instead:string }>` (three rows;
  `probe` is executable script text); `export function buildSandbox(api: SandboxApi): Record<string, unknown>` extracted from
  `evaluateScript` (exports only — no new value import into the child). `src/authoring-guide.ts` — `buildGuide()` renders (a)
  Seeding a workspace from `TOOL_SPECS.run_start`'s item descriptions + `workspace_push`; (b) the sandbox: `SANDBOX_GLOBALS`,
  the three guarded calls with WHY/INSTEAD, `log()` no-op, the absent globals list; (c) `meta.params.args` types from
  `params/contract.ts`'s own union; (d) `aliasTable(aliases, PROVIDER_CAPS)` — pure, one row per alias: provider / tools `all` /
  effort applies (`anthropic: yes`, `openrouter: when the model declares reasoning`, `ollama: no`) — labelled *declared, not
  probed*; (e) `models_list` flags are declarations with `declaredSource` and `catalogFetchedAt`; the budget section rewritten
  for `{usd, tokens}` keeping the v25 overshoot sentence per limit, plus the "live, not resume-stable" line; `run_start`'s
  description carries the seed shapes and the budget unit. `docs/AUTHORING.md` regenerated by `npm run gen:authoring`.
- **boundary:** Each lock EXECUTES rather than greps: `Object.keys(buildSandbox(fakeApi))` equals `SANDBOX_GLOBALS`; every
  `DETERMINISM_GUARDED[i].probe` evaluated through `evaluateScript` throws `DETERMINISM_GUARD`, and `new Date('2026-01-01')`
  does NOT; `aliasTable` is total over `PROVIDER_CAPS`; the catalog test asserts every code emitted by `validateSeedSpec`,
  `priceVerdict` and `RULE_CODE` has a row and every authoring-side one has `see:'workflow_authoring_guide'`. The guide
  documents the determinism guard as hygiene, not a boundary (`guards.ts:93-102` already disclaims it) — the guide must not
  outclaim the code it renders from. The REQ-117 cold-model probe is the acceptance; by the v24 ruling any first-try failure is
  a documentation defect.
- **tests:** `tests/unit/sandbox-globals-lock.test.ts` (new; the two executed locks above — T4 by construction),
  `tests/unit/authoring-guide.test.ts` (UT-159 v26 cases: the five section titles; literals `DETERMINISM_GUARD`, `seedManifest`,
  `INVALID_SEED_SPEC`, `budget.tokens()`, `remaining()` … `null`, `declared, not probed`; `aliasTable` with a fake 3-alias map —
  T4), `tests/unit/authoring-md-diff-lock.test.ts` (existing diff lock, regenerated), `tests/unit/error-catalog-closed.test.ts`
  (extended to the three new emitters), `tests/acceptance/v26-tool-surface.test.ts` (REQ-118's table regenerated: the
  `run_start` fixture gains `budget:{tokens:1}` and the `PRICE_UNKNOWN`/`INVALID_SEED_SPEC` error rows).

### DES-185 — trigger budgets (ADR-047) are designed both ways so the owner's ruling is a task toggle, and D-V2h is amended either way
- **traces:** ADR-047, REQ-127, REQ-015, REQ-057
- **signature:** **(a) if ruled IN:** `schedule_create`/`webhook_create` inputSchema gain the same `budget` object as
  `run_start` (one shared `BUDGET_SCHEMA` constant); `schedules` and `webhooks` tables gain `budget TEXT` (additive ALTER);
  `Schedule`/`Webhook` rows carry `budget?: BudgetSpec|null`; every `start({name, args, startedBy})` in `server.ts`,
  `scheduler.ts`, `webhook-registry.ts` forwards `budget: row.budget ?? null` (through `parseBudget` — one normaliser); NO
  server-level default cap. **(b) if ruled OUT:** no code. **Both:** `04-design.md:814-815/:832/:1156` amended — (a) points
  them at the new REQ; (b) rewrites D-V2h to *"no such control exists; unattended runs have no spend ceiling"* and the overlap
  accepted-risk drops "per-run budget" as its compensating control.
- **boundary:** The forwarding in (a) is the `composeConfig`-class wiring bug in three files — each gets a
  `compose-config-v2-wiring`-style row (a schedule created with `{usd:1}` starts a run whose `run_status.usage`… no, whose
  `RunGuard` holds `{usd:1}` — observed through a fake gateway that would exceed it). The ledger amendment is unconditional
  and is the cheaper half; it must not wait on the ruling.
- **tests:** (a) `tests/integration/trigger-budget-forwarded.test.ts` (new; three trigger doors × one budget each → a
  `BUDGET_EXCEEDED` refusal visible on `run_status.agents`); (b) none. Either: a `04-design.md` grep in the review checklist
  that D-V2h no longer says "Resolved" against a control that does not exist.

### DES-186 — the public record and envelope shapes are pinned as literals so the four-column/`costUSD`/`transport`/`detail` additions are asserted, not inferred
- **traces:** ARCH-115, ARCH-118, ARCH-111, REQ-125, REQ-127, REQ-122, REQ-118
- **signature:** `src/types.ts` — `export const EXPECTED_AGENT_RECORD_KEYS = ['agentId','label','phase','phaseIndex','state',
  'provider','model','transport','proxyModel','tokens','costUSD','frame','startedAt','endedAt','reasonCode','lastActivityAt','detail'] as const`
  (a superset pin: every key a record may carry, no other key may appear); `EXPECTED_RUN_USAGE_KEYS`; `run_result`'s envelope
  keys `['runId','status','result','error','meta']`. `tools/list` byte baseline (`mcp-tools-list-http.test.ts`) re-pinned
  ONCE for the three breaking rows (`budget`, `seed.items`, `models_list.toolUseDeclared`) in the same commit as the schema
  change, with the diff quoted in the test's header comment.
- **boundary:** These are drift locks, not correctness tests, and are labelled as such (the v24 R8 lesson) — the correctness
  weight sits in DES-171/176/179's behavioural cases. A superset pin catches the mid-tier shape "I added `cost` beside
  `costUSD`" and the opposite "I forgot to persist `transport`", both invisible to `tsc` through the `unknown`-typed transcript
  path.
- **tests:** `tests/unit/agent-record-keys.test.ts` (new), `tests/integration/mcp-tools-list-http.test.ts` (re-pinned),
  `tests/acceptance/v26-tool-surface.test.ts` (REQ-118 rows).

---

## Task partition — where my lenses need the synthesizer to cut (03-tasks.md has no v26 rows yet)

The cut that serves all three lenses under the directive: **pure files first, each with its export signature and test file
named; the deletion as its own task with a file list; one task per store column; wiring after every store; the sweep before
Gate 5's RED confirmation; acceptance last; the owner-conditional task isolated.** Proposed order and the trap each closes:

| # | task | DES | closes |
|---|---|---|---|
| 1 | `providers.ts` (`PROVIDERS`, `PROVIDER_CAPS`, `resolveAlias`, `validateAliases`) + `AliasMap` narrowed | 172 | T1 (offender list complete), `never` on four switches |
| 2 | `types.ts` `Tokens`/`BudgetSpec`/`RunUsage`/key pins; `run-guard.ts` `parseBudget`/`priceCall`/`priceVerdict`/two-limit guard | 179, 180, 186 | T3 (UT-002/170 rewritten), T4 (schema literals) |
| 3 | `skeleton-graph.ts` + `workflow-meta.ts` (`at`/`line`/`alt`, `allowedTools`, `phase` retired) + the shared fixture module | 174 | T2 (hand-written expected graphs), T1 (non-literal tools) |
| 4 | `check-mermaid.ts` v2 + `RULE_CODE` + catalog column + describe key | 181 | T3 (v1 codes pinned), T4 (`tools: default` literal) |
| 5 | `models/model-book.ts` + numeric static rates + store `price_book` column + `getSpec` | 177 | injectable clock/source; INV-V26-4 |
| 6 | **DELETION** — the identifiers, arms, tables, `sumUsageTokens`; 18 test files; grep block | 173 | T3 (the whole task) |
| 7 | `workspace-seed.ts` `validateSeedSpec` + schema items + catalog row + `start()` call site | 170 | T1 (no row, no dir) |
| 8 | SDK client: `classifyApiError`, `_drain` api_retry + benign set, controller/`finally`, `invoke` break, four-column usage, resolved names, `wireEffort` + `pin` | 171, 176, 178, 179 | T1 (one attempt), INV-V26-2 (single writer), T3 (`provider:'claude-agent-sdk'` assertions) |
| 9 | direct-fetch client: `retryable`, `transport`, OpenRouter cache columns, `effortBodyFields` | 171, 176, 179 | over-count on absent `cached_tokens` |
| 10 | phase stamp: `host.ts` both sites, `run-manager.ts`, executor `markQueued`/`capture`/decoration, `deriveAgentRecords`, `inferPhase`, `layoutGraph`, `server.ts` route | 175 | T1 (capture clobber), INV-V26-1 (replay fixture) |
| 11 | executor `capture`: `costUSD` once, `addUsage`, usage event shape, `detail` redact-then-cap; `foldUsage`; `RunStatusView.usage`; snapshot `usage`; `run_result.meta` | 179, 171, 176 | two-producer equality IT; REQ-083 sweep row |
| 12 | sandbox `Budget` API + IPC shapes (`start.budget`, `agentResult.spent`) + child inline sum | 179 | realm test in a real vm (IT-140 shape) |
| 13 | `composeConfig` wiring + `main.ts --check-config` + `package.json` script + `rwe-update.sh` step + `configCheck` in the result | 172 | wiring row; VAL-078 order |
| 14 | `models_list` rename in+out, declared columns, `catalogFetchedAt`; dashboard models panel | 178 | T3/T4 (`toolUse` absent) |
| 15 | dashboard: `dagBox`, `viewBox`, `.zoomable`, workflow-page harness table | 183, 181 | page-source strings; Playwright |
| 16 | guide: constants, five sections, alias table, twelve examples, negative fixtures, `AUTHORING.md`, `run_start` description, `DEPLOY.md`/`README.md`/`rwe.env.example` | 184, 182 | executed drift locks; T4 |
| 17 | **CONDITIONAL (ADR-047)** trigger budget (a) or ledger-only (b); the D-V2h amendment in both | 185 | wiring rows ×3 |
| 18 | acceptance: VAL-171 (terminal), VAL-172 (effort), VAL-018 ext., VAL-078 ext., VAL-019 rewrite, `v26-tool-surface`, the REQ-117 cold-model probe, the ollama-with-`Read` real run | all | real-tier evidence |

Ordering constraints my lenses insist on: **task 6 (deletion) before task 8** — a gateway edited while `curateToolsForProvider`
still compiles will keep calling it "for now"; **task 3 before 4 and 10** — both consumers import the same fixture module,
and writing either consumer first re-derives the shape (INV-V26-3 broken at birth); **task 2 before 5, 8, 11, 12** — every
budget reader imports `parseBudget`; **task 13's `--check-config` before the v26 release is cut** — the production
`gpt41*` rows are removed by the deployment step ADR-042 names and the updater's check is the net under it; **task 17 gated
on the owner's ADR-047 ruling and NOT blocking Gate 5** (its ledger half is not conditional). Tasks 1–5 are pure and can
run on the lower tier in parallel with the deletion; tasks 8 and 10 are the two that need the most care and should be
single-owner.

---

## Risks

- **R1 (boundary, HIGH):** the phase stamp is clobbered at terminal by `capture()` rebuilding the record from `req.opts.phase`
  (`agent-executor.ts:258/270`). ARCH-114 does not name this site; without DES-175's `prev` carry, every done/failed agent
  loses its lane and REQ-124's red test passes only for RUNNING agents.
- **R2 (interface, HIGH):** `deriveExpectedGraph` joined by ordinal mis-labels every slot after a `foo.agent(` — silently.
  Offsets (DES-174) plus one decoy fixture are the whole defence.
- **R3 (testability, HIGH):** the unit change on `budget`. The cheapest lower-tier path is to keep `_spent` a number, set it
  from `costUSD` and leave IT-135..139 green with `{tokens}`; the money limit then never fires in any test. DES-179's
  two-limit guard test, the haiku-fixture cent test and `usage-live-equals-fold` are the traps; the synthesizer should make
  IT-135..139's re-pin an explicit sub-bullet of task 2, not an implicit consequence.
- **R4 (boundary, HIGH):** `meta.unmappedMessages` without the benign set is non-zero on every healthy run (26 `system`
  subtypes, `init` always) and the ADR-046 named reader shows noise; the healthy-fixture-yields-empty test (DES-171) is the
  only guard, and the set will need a line per SDK bump — accept and say so.
- **R5 (interface, HIGH):** `additionalProperties:false` on `seed.items` makes the REQ-121 hint unreachable (ajv first). DES-170
  keeps the validator as the sole shape authority; if the synthesizer keeps the schema clamp, the red test must assert the hint
  text and will fail.
- **R6 (boundary, MED):** the EDGE rule stated over node ids refuses guide examples 3 and 7. Over label sets with `<-->`
  excluded (DES-181) it passes both; every positive fixture is a registered example so this cannot regress unnoticed.
- **R7 (interface, MED):** `toolUse` renamed on the row but not on the `models_list` filter/`CatalogFilter` — a caller filters on
  a name the row no longer has and gets an unfiltered list. DES-178 renames both; the test refuses the old filter name.
- **R8 (interface/consumability, MED — synthesizer call):** `catalogFetchedAt` per row (DES-178) vs a wrapper object (ARCH).
  I hold per-row because the wrapper breaks every reader of an array contract to carry one string; if the synthesizer prefers the
  wrapper, the dashboard models panel, VAL-087 and the plugin notes join the cross-repo row.
- **R9 (boundary, MED):** `tools: default` skipped entirely (D7 as held) leaves `tools: Read` standing on a default-surface
  agent. DES-181 requires the literal word; if QD holds the full skip, the T4 exposure should be recorded as accepted.
- **R10 (interface, MED):** zero-`phase()` scripts under a literal L2 need a lane; DES-174/181's carve-out keeps the simplest
  script the simplest diagram. If refused, examples 1/9/10 gain a `phase()` each and the guide must say every v2 script needs one.
- **R11 (testability, MED):** `wireEffort`'s LiteLLM translation (`budgetTokens` → `reasoning_effort`) is unobservable below
  Gate 7.5; the unit pins the WIRE value only, and VAL-172's `--detailed_debug` grep is the sole evidence for REQ-126's
  "low vs high differs" clause. Accepted; named in the validation table.
- **R12 (boundary, LOW):** pre-v26 journals resumed across the upgrade replay with no stamp and no agreeing timestamps
  (cohort iii) — frame-grouped WITH a warning. REQ-124's "existing runs" clause is read as terminal snapshots; the ledger
  should say so before Gate 7.5 reads it literally.

---

## Conflicts between my three lenses (argued, with the Karpathy tie-break)

1. **Totality of `deriveExpectedGraph` (interface/testability) vs refusing an undecidable shape at the source (boundary).**
   A derivation that can return `{refused}` is a second refusal site the run-DAG consumer cannot honour. **Tie-break:** total
   derivation (`lane:null`, `dynamic`, `'default'` are values, not errors), and the ONE gate stays `checkMermaid` v2 — fewer
   places that say no.
2. **One validator for both inline seed arrays (interface) vs the schema as the machine-readable truth (testability: `tools/list`
   is what the cold model reads).** **Tie-break:** the schema DESCRIBES (types, descriptions), the validator DECIDES (required,
   unknown keys) — because ajv's generic code would pre-empt the specific one; the description literally says REQUIRED so the
   schema does not lie.
3. **A closed benign set of SDK subtypes (boundary: the counter must mean something) vs a list against a third-party union
   (testability: T4 by construction).** **Tie-break:** keep the set, lock it behaviourally (healthy fixture → empty), accept one
   line per SDK bump.
4. **Pass the whole pin into `invoke` (simplicity, one field) vs pre-resolve `caps` in the executor (interface purity: the
   gateway should not receive a run-wide map).** **Tie-break:** the pin — the resolver lives in the gateway, and giving the
   executor an alias table only to index a map is a second resolver.
5. **`catalogFetchedAt` per row (interface: array contract survives) vs one top-level field (simplicity: one value once).**
   **Tie-break:** per row; a breaking wrapper to save 24 bytes per row is the opposite of minimal for the consumers.
6. **Literal `tools: default` (boundary: no unchecked row) vs skip-entirely (simplicity: nothing to compare).** **Tie-break:**
   the literal — the comparison is a string equality, and it closes the only T4 on the row REQ-128 exists for.
7. **Edges over node ids (interface: precise) vs over label sets (boundary: dynamic parallels and multiple stadiums per label
   are legal).** **Tie-break:** labels; the diagram's unit of meaning is the label, and the checker already diffs labels.
8. **Delete `AgentOpts.phase` (interface: no dead key) vs keep it for `CallKey` compatibility (boundary).** **Tie-break:**
   delete — nothing ever set it (Gate 1 evidence), an optional TS field changes no bytes, and the closed `AGENT_OPT_KEYS` record
   turns the deletion into an automatic refusal with a near-miss hint, zero new codes.
9. **`--check-config` as pure validators (simplicity) vs the real `composeConfig` (boundary: never a false pass).** **Tie-break:**
   real `composeConfig` with the NOOP proxy dep that already exists; INV-V26-7 wins over ten lines saved.
10. **`RunUsage` from the guard (live) and from `foldUsage` (at rest) — two producers (testability risk) vs one (interface).**
    **Tie-break:** two producers, one shape, one equality IT — because the live path must not re-read transcripts per poll and
    the at-rest path must not depend on an in-memory guard; the test is the contract.

---

## Expected disagreements with other lenses

- **Quality-dimensions / observability** will want the benign SDK subtypes counted too ("a counter that drops is a projection").
  I hold DES-171: a counter that is non-zero on every healthy run has no reader in practice; the benign set is NAMED (the
  ADR-046 requirement) and locked by the empty-on-healthy fixture.
- **Quality-dimensions / consumability** may want `models_list` wrapped in an object with one `catalogFetchedAt` (ARCH's letter).
  I hold per-row (R8) and flag it for the synthesizer rather than assume it.
- **Quality-dimensions** may hold D7's "skip the tools comparison entirely for `default`". I hold the literal word (R9): it
  compares no resolved list and closes a T4.
- **Quality-dimensions / self-sustainability** may ask for `PRICE_UNKNOWN` to carry a retry-after or the TTL. No — the message
  already carries `source` and `fetchedAt`; a retry hint would encode the TTL in a user-facing string (T4 on the next change).
- **The synthesizer** may read DES-174's total derivation and DES-181's relocated L2 as reopening ARCH-113. They are the same
  property (one derivation, two consumers, the checker the only gate) with the refusal moved to where refusals already are —
  labelled as such.
- **The synthesizer** may see the zero-`phase()` carve-out (item 15) as a contract change. It is narrower than L2 (the mixed
  case is still refused) and keeps three of the twelve examples one line long; if refused, R10 states the cost.
- **Someone will propose `budget: number` accepted "for one iteration" as USD.** ADR-037 settled it and REQ-127 forbids the
  silent unit change; the schema refuses a bare number with a description that says why.
- **Security lens** may want `AgentRecord.detail` omitted from the live `run_status` reply until redacted. DES-088's
  persist-only redaction is the standing rule (live replies are un-redacted by design); every PERSISTED copy is redacted then
  capped, and the sweep row proves it.

---

## Real-tier validation paths (v26) — the entrypoint that proves each REQ

| REQ | real entrypoint + real wiring | what proves it |
|---|---|---|
| REQ-121 (seed refusal) | booted `createServer()`, real `run_start({seed:[{path,sha256}]})` over MCP HTTP | `INVALID_SEED_SPEC` whose message names the path and `seedManifest`; `run_list` unchanged; no run directory on disk |
| REQ-122 (terminal in one attempt) | real engine, real LiteLLM, an alias whose key is revoked (VAL-171) | `failed` within `timeoutMs`, `detail` with provider+status, `events` non-empty, `provider:'openrouter'`; `ps` shows no surviving CLI subprocess |
| REQ-123 (three providers, full surface) | three real runs (anthropic / openrouter / ollama `default`); a config with a `gpt41` row against the updater (VAL-078) | the ollama harness `tools` contains `Read` and a real `Read` tool_call lands; `configCheck:'failed'` then `applied`; grep target zero |
| REQ-124 (phase-accurate DAG) | `GET /api/runs/<id>/dag` on the owner's existing run 77f74018 and on a fresh 9-agent run | `warnings: []` on both; every agent in its phase column |
| REQ-125 (resolved names on the terminal record) | a real openrouter run, `run_status` before and after terminal | `provider`/`model` identical across running/done/usage event; `transport`/`proxyModel` present |
| REQ-126 (effort on declared-reasoning models) | private LiteLLM `--detailed_debug` + real OpenRouter (VAL-172) | `reasoning_effort` low vs high observed upstream; `effortApplied.applied:true` with `budget_tokens`; ollama `applied:false` |
| REQ-127 (four columns, cost, budget) | a real haiku run with tool use; a `budget:{usd:0.01}` run | four non-zero columns, `costUSD` to the cent vs the SDK's `total_cost_usd` cross-check; a `refused` record with `limit:'usd'` |
| REQ-128 (v2 contract, grandfather) | the twelve examples registered over MCP HTTP; a v25 catalog DB with a TD row booted under v26 | 12/12 registered; the TD row describes `diagramContract:'v1'` and renders; the cold-model probe registers first try |
| REQ-129 (scaling + zoom) | Playwright at 1100 px on an 11-node TD workflow and a wide run (VAL-018) | both figures within the container; wheel/drag/fit observed; screenshot in `evidence/` |
| REQ-130 (guide gaps) | `workflow_authoring_guide` over MCP HTTP; the REQ-117 cold subject | the five sections present with the literals; the cold subject seeds, budgets and registers without reading source |

**Test-count target for Gate 5 (the directive's "larger in COUNT"):** ~46 new or rewritten UT files/cases named above,
~15 IT, 1 E2E, 4 VAL new + 3 VAL extended, plus the 18-file deletion/rewrite list with a grep target of zero.
