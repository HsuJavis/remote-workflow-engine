# Architecture panel — Adversarial group, round 1 (independent proposal)

- **Feature**: 001-remote-workflow-engine
- **Iteration**: v21 — author/user separation part 1, the tunable-parameter contract (REQ-090..095)
- **Lenses carried (three, in tension)**: (a) Security — authn/authz correctness, secret protection, attack surface; (b) Scalability/performance — state storage, horizontal scaling, concurrency & consistency; (c) Testability — module boundaries, injectable deps, cheap unit/integration tests.
- **Tie-breaker discipline**: Karpathy simplicity-first — the minimum architecture that closes the requirement, nothing speculative.
- **Safety class**: QM (state.yaml) → no safety lenses applied.

---

## 0. Altitude judgment (done first, per task)

**Verdict: BOTH altitudes are live, and the *agent* altitude dominates this slice.**

Evidence from `tech_stack` + requirements:

- The engine is a conventional **system** in its transport/persistence/lifecycle layer: hand-rolled JSON-RPC-over-HTTP (`src/server.ts`), better-sqlite3 RunStore + WorkflowCatalog, filesystem journal, child-process + `node:vm` sandbox, systemd/docker deploy. REQ-091's "before any durable work", REQ-090's storage/discoverability, and REQ-095's issue plumbing are **system-altitude** concerns.
- But the artifact v21 actually governs is an **agent harness**: which model is dispatched, at what effort, with which tool/skill surface, and what text lands in the outbound prompt (REQ-092/093/094). The thing being made replaceable/observable/consumable is *an agent's configuration*, and the new caller-controlled input (`appendPrompt`) is **instruction text fed to a model**, not data fed to a function. So the agent-altitude readings apply and dominate:
  - *Observability (agent)*: "the run used model M" is not enough — the reviewable unit is the **effective harness descriptor** (model, effort + whether the mapping actually applied, timeout, tool/skill surface, prompt composition order, and the **provenance rung** each value came from). REQ-092/093 already say "observable in the harness descriptor, **not** merely echoed back" — that is an agent-altitude acceptance criterion and I treat it as the load-bearing one.
  - *Consumability (agent)*: the contract must be legible to a **non-human consumer** (an MCP client agent choosing knobs) without reading the script — REQ-090's whole point.
  - *Replaceability (agent)*: effort mapping must be per-provider and degrade honestly, because providers are swapped by config (REQ-004/016/037).
  - *Self-sustainability*: v21's two repaired defects are both **inert-config** bugs (`resolveHarnessParams` zero callers; `effort` a documented no-op). The architecture must make inertness structurally impossible, not test-detectable.

**What this altitude call rules OUT (honesty, not evasion):** my lens template names brute force, JWT forgery, timing attacks, and concurrency of failure counting. v21 introduces **no credential comparison, no token issuance, no failure counter, and no new authenticated endpoint** — that surface is REQ-012/086/089 (v15–v20, shipped and reviewed). Manufacturing threats there would be speculative work and I decline it. v21's real security surface is different and is enumerated in §2.

---

## 1. Summary

v21 is, structurally, one idea: **a run's effective harness parameters become a first-class, resolved-once, immutable value object, computed at admission from three ranked sources and carried on the run** — instead of being (as today) partly inert registry metadata, partly script-literal opts, and partly nothing at all.

My proposal is deliberately small: **five pure functions, one non-optional wiring seam, one new catalog column, zero new tables, zero new endpoints, zero new services.**

```
  registration time                    submission time                 dispatch time
  ────────────────                     ───────────────                 ─────────────
  parseParamContract(script)  ──►  validateOverrides(contract, raw)  ──►  resolveEffective(...)
        │  (pure)                          │  (pure)                          │  (pure)
        ▼                                  ▼                                  ▼
  workflows.paramsJson             PARAM_LOCKED /                    EffectiveParams snapshot
  (normalized, stored once)        PARAM_OUT_OF_RANGE                 pinned on the run record
                                   (before ANY durable work)                  │
                                                                              ├─► composePrompt()  (pure)
                                                                              └─► mapEffort()      (pure)
                                                                                       │
                                                                                       ▼
                                                                            harness descriptor
                                                                        (the single observation point)
```

### The load-bearing decision — **D-P21-1: effective params are resolved once, at admission, and are run-immutable**

Consequences, all of which fall out for free and each of which fixes a distinct problem in one of my three lenses:

1. **Consistency (scalability lens)** — the contract is read from the **same catalog version row the run pins** (REQ-014 already pins version per run). A concurrent owner `workflow_register` between validation and dispatch cannot change what this run enforces. **No lock, no transaction, no coordination** — the fix is snapshotting, not synchronization.
2. **Resume determinism (scalability + correctness)** — `resume-cache.ts:13` `sameKey()` compares `a.prompt === b.prompt && JSON.stringify(a.opts) === JSON.stringify(b.opts)`, and `run-manager.ts:706` builds `CallKey` from the **raw script-literal** prompt/opts. If REQ-092's wiring fills `opts.model` or REQ-094's `appendPrompt` **upstream** of that line, every already-journaled call's key changes on upgrade → cache MISS → and because `ResumeCache` poisons forward ("once any callSeq misses, every later call misses"), the **entire tail of every suspended run re-dispatches live** after the v21 deploy. Real money, silently. Because params are run-immutable, they need **not** enter the key at all: same run ⇒ same params ⇒ `CallKey` stays at script altitude ⇒ **zero invalidation on upgrade**. The price is one explicit rule: `workflow_resume` must **not** accept new overrides (typed error if supplied and different). That rule is one `if`, and it is the whole cost of the property.
3. **Security** — the persisted snapshot is the audit record: who (principal, REQ-086) ran what workflow@version with which knobs and which appended text.
4. **Testability** — resolution becomes a pure function over a stored row, so the four-rung precedence table (REQ-092) is a table-driven unit test with no I/O, and the snapshot is a single assertable artifact.

---

## 2. Key points

### 2.1 Security lens

**S-1 (blocking) — `resolveHarnessParams()`'s current signature is a privilege-escalation trap. Do not wire it as-is.**
`src/harness-defaults.ts:90`:
```ts
export function resolveHarnessParams(registered: HarnessDefaults | undefined,
                                     overrides: Partial<HarnessDefaults>): HarnessDefaults
```
`HarnessDefaults` = `{model, tools, skills, timeoutMs, prompt}`. The override side can therefore supply **`tools`, `skills`, and `prompt`** — exactly three of the five keys D12 declares permanently locked to the author. REQ-092 instructs an implementer to "wire the zero-caller function into the run path". Wiring it verbatim with caller-supplied overrides hands every authenticated principal the author's tool surface and system prompt. This is not a hypothetical: it is the shortest path from the requirement text to code.

**Fix — split the type, don't guard the call.** The author side and the user side are *different sets that merely overlap*:

| key | author (registration) | user (per-run) | note |
|---|---|---|---|
| `model` | ✔ default | ✔ tunable (constrainable) | shared |
| `timeoutMs` | ✔ default | ✔ tunable (constrainable) | shared |
| `tools` | ✔ | ✘ **locked** | D12 |
| `skills` | ✔ | ✘ **locked** | D12 |
| `prompt` (system) | ✔ | ✘ **locked** | D12 |
| `mcp`, `workdir`/`cwd` | ✔ (provisioned) | ✘ **locked** | D12 |
| `effort` | (not today) | ✔ tunable | REQ-093 |
| `appendPrompt` | ✘ | ✔ tunable | REQ-094 |

So: `HarnessDefaults` (author, 5 keys, unchanged) and a **new closed type `UserOverrides = {model?, effort?, timeoutMs?, appendPrompt?}`** — nothing else is *representable*. `resolveEffective(defaults, userOverrides, perCallOpts)` takes the two distinct types. A locked key cannot be smuggled because **there is no field to put it in**; the `PARAM_LOCKED` error becomes a courtesy message at the parse boundary, not the security control. Enforcement is by construction (D12's own words: "engine-side validation at run submission, not convention").

**S-2 — the boundary must be allowlist-shaped at *both* ends, and it must be one boundary.**
Denylisting locked keys rots: the next iteration adds a harness knob and it is silently user-tunable by default. Instead: (i) the MCP `workflow_run` inputSchema declares `overrides` with `additionalProperties: false` and exactly four properties (this also makes the contract self-describing to a schema-only consumer, satisfying the REQ-079 discipline for free); (ii) a single total parser `parseUserOverrides(unknown) -> Ok<UserOverrides> | Err<PARAM_LOCKED|PARAM_OUT_OF_RANGE|PARAM_UNKNOWN>` is the **only** way caller data becomes a `UserOverrides`. Every other path constructs it from the registry. One boundary, one test target.

**S-3 — `appendPrompt` is a prompt-injection surface, and no amount of validation removes it. Bound it, frame it, attribute it.**
REQ-094 correctly guarantees the *structural* things (tools/skills/mcp/workdir) stay locked. But D13's chosen position — **last, after everything the author controls** — is also the position with the greatest instruction-following weight in most models. A user cannot change the tool list; a user *can* ask the agent to use the tools the author already granted in ways the author did not intend (read the seeded workspace and dump it into the return value, call `issue_report`, hit a provisioned MCP). This is a real residual risk of the requirement as specified and I record it rather than pretend it away.

Minimum sufficient controls (no classifier, no sanitizer — those are theatre here):
1. **Hard byte cap**, config-driven, validated at submission (REQ-094 already demands a documented cap and a typed refusal — name it `maxAppendPromptBytes`, default 4 KiB).
2. **Fixed delimiter frame**, so the author's prompt can reference it and the model can be told its trust level, e.g. `\n\n<user-instructions untrusted="true">\n…\n</user-instructions>`. Frame text is part of the composition contract and pinned by a drift-lock test.
3. **Attribution**: the appended text is persisted on the run snapshot beside `principal` — an abuse is reconstructable, which is the control that actually deters at this altitude.
4. **No structural reach**: already guaranteed by S-1/S-2.

**S-4 — REQ-093 `effort` + REQ-087's open execution = a new user-reachable cost-amplification vector.**
REQ-087 deliberately gates *mutation*, not execution: any authenticated principal may run any workflow. v21 then hands that principal `model` and `effort` as tunable-by-default knobs (REQ-090), and REQ-093 makes `effort` **actually reach the backend**. `effort:'max'` + the most expensive alias, on someone else's workflow, on the owner's billing. Today this is impossible because effort is inert and overrides don't exist; after v21 it is a two-field JSON call.

- **Non-negotiable, cheap**: engine-global ceilings that always apply — `maxTimeoutMs`, `maxAppendPromptBytes`, and `maxEffort` (an ordinal clamp over `low<medium<high<xhigh<max`). Fail-closed defaults; a declared author ceiling may only be *tighter*, never looser.
- **Open for adjudication (OPEN-1)**: should `model`/`effort` be *closed*-by-default (pinned to the registered default unless the author declares them tunable)? Security says yes. REQ-090's explicit backward-compat clause ("no `params` block ⇒ the four global knobs, no extra constraints") says no. My Karpathy call: **follow the requirement** (open-by-default) + ship the global ceilings + attribute cost to the principal — the ceilings close the unbounded part of the hole for one config block, and flipping the default is a requirement change that must go back to Gate 1, not be smuggled in at Gate 2. Recorded as residual risk R-4.

**S-5 — `overrides.model` must still pass the existing alias-resolvability check.**
Even when the contract declares no enum, an override model has to resolve against the configured alias table (REQ-004's "missing mapping reported at submission, not mid-run"). One line inside `validateUserOverrides`, reusing the same `aliasNames` set `validateHarnessDefaults` already takes — no new vocabulary.

**S-6 — the `params` block widens an existing VM-eval surface; bound it and evaluate it exactly once.**
`workflow-meta.ts:parseMeta` already does `runInNewContext('(' + objectText + ')', emptyCtx, {timeout: 50})` on the `checkMeta`-validated pure literal. A `params` block is a *larger, nested, author-supplied* literal in that same object. Controls: reuse the **same** `pureLiteral` gate (no new parser), add a size + nesting-depth bound before eval, and — critically — **evaluate at registration only**, persisting the normalized contract as JSON on the catalog row. The run path must never re-parse a script to learn the contract. Security (one eval site), performance (§2.2), and v22 (§2.4) all want the same thing.

**S-7 — REQ-095 label/query injection.** `workflow:<name>` becomes a GitHub label and an `issue_list` label query, from a caller-supplied name that REQ-095 explicitly does **not** existence-check. Cheapest correct fix: apply the **same name-charset/length rule workflow registration already enforces, minus the existence check** — reuse, no new validation vocabulary. Also note the interaction with REQ-035's dedup fingerprint: the fingerprint derivation must include the workflow label, or two different workflows' reports collapse onto one issue.

**S-8 — persisted snapshot vs REQ-083 redaction.** See conflict C-3.

### 2.2 Scalability / performance lens

**P-1 — zero new state. One column, one snapshot field.**
- Contract → a `paramsJson` column on the existing workflows/version row. The run path already calls `catalog.get()`; the contract rides that **same row read**. No second query, no second index, no cache, no script re-parse per submission.
- Effective params → a field on the existing run record / journal snapshot (the REQ-055 terminal-snapshot machinery already persists per-run structure). No table.
- v21 therefore adds **no shared mutable state**, which is why the "concurrency & consistency of failure counting" item on my lens card has no v21 answer: there is no counter. The only concurrency question is the register-vs-submit race, and D-P21-1 answers it by version-pinned snapshot rather than by locking.

**P-2 — admission-ladder placement is a DoS-ordering decision, not a style question.**
REQ-091 demands refusal "before any durable work (no run row, no workspace directory, no sandbox fork)". The existing pre-`createRun` ladder is already pinned by DES-090 (scriptSha rung before admission). The param rung's correct slot:

```
auth/principal (REQ-086/089)          — cheapest, most certain, no I/O
  → run-admission counter (REQ-054)   — in-memory counter
    → catalog.get(name@version)       — the ONE row read (also gives us the contract)
      → parseUserOverrides + contract check   ← v21 rung: PURE, no I/O, no allocation of consequence
        → seed / scriptSha rungs (DES-090)
          → createRun / mkdir / fork  — first durable work
```
Rationale: the v21 rung costs a JSON parse of a stored object and a handful of comparisons, so it belongs *after* the free in-memory checks and *before* anything that touches the filesystem, but it must not be pushed later "for convenience" — a submission that will be rejected must never mkdir.

**P-3 — the CallKey/ResumeCache hazard (see D-P21-1 ¶2).** This is the single highest-cost mistake available in v21 and it is invisible to unit tests. Architectural rule, stated as an invariant for Gate 3/4 to carry: **nothing resolved by v21 may enter `CallKey`.** `run-manager.ts:706` stays byte-identical; resolution happens **downstream**, in the agent-executor, at the same point where `agentType.systemPrompt` is already prepended (`agent-executor.ts` ~line 290) — reading from the run-immutable snapshot. That placement is what makes D-P21-1 hold mechanically rather than by discipline.

**P-4 — prompt composition interacts with the existing `PROMPT_CAP` truncation.** `agent-executor.ts:26-28` truncates as `head + '…[truncated]…' + tail`. An appended block sits in the tail and survives; the **author's** prompt middle is what gets eaten. So a large `appendPrompt` can silently displace author instruction. Two requirements fall out: (i) `maxAppendPromptBytes` must be small relative to `PROMPT_CAP`; (ii) a test must pin the head/tail behaviour with an append present, and the harness descriptor must record that truncation occurred (honest observability, same principle REQ-093 applies to effort).

**P-5 — horizontal scaling: unchanged and out of scope.** The engine is single-process with SQLite and a per-run child process; v21 adds no cross-process coordination, so it neither helps nor hurts a future multi-node story. I am **not** proposing a params service, a config cache, or an abstraction seam for a future distributed registry. Karpathy: that is speculative.

### 2.3 Testability lens

**T-1 — five pure functions and one wiring seam.** Everything v21 needs to *decide* is pure and unit-testable with no I/O, no clock, no randomness:

| function | when | signature (shape) | tests |
|---|---|---|---|
| `parseParamContract(script)` | registration | `→ Ok<ParamContract> \| Err` | locked-key rejection, no-block backward compat, size/depth bounds |
| `validateUserOverrides(contract, raw, aliasNames)` | submission | `→ Ok<UserOverrides> \| Err<PARAM_LOCKED\|PARAM_OUT_OF_RANGE>` | table-driven, one row per rejection reason |
| `resolveEffective(defaults, overrides, perCallOpts, agentTypeDef, engineDefaults)` | dispatch | `→ EffectiveParams` | **the precedence table** (T-3) |
| `composePrompt(systemPrompt, scriptPrompt, appendPrompt)` | dispatch | `→ string` | order, frame, byte-identity when append absent |
| `mapEffort(providerProfile, effort)` | dispatch | `→ {applied: boolean, value?: unknown}` | per-provider, honest no-op |

**T-2 — the wiring is the risk, and pure tests cannot catch it. Make omission a *type* error.**
This is the fourth instance of a documented bug class in this repo: v11 `updateFlagPath`, v15 `auth`, v16 `workspaceTtlMs` all shipped as inert config because a composition-root forwarding line was missing, and REQ-092 exists because `resolveHarnessParams` has zero callers. Guards, in order of strength:
1. **Non-optional constructor argument.** The run/dispatch path takes `EffectiveParams` (or a `HarnessResolution` port) as a **required** parameter. An implementer who forgets it gets a `tsc` failure, not a silently-inert feature. Do **not** add an optional field with a fallback default — that reproduces the bug class exactly.
2. **composeConfig forwarding test.** Any new config key (`maxAppendPromptBytes`, `maxTimeoutMs`, `maxEffort`) must be added to `compose-config-v2-wiring.test.ts` **as part of this ARCH's definition of done**, not left to the implementer. The historical failure is always the same line: the key exists in the file schema, is read into `fileConfig`, and is never forwarded in `composeConfig()`.
3. **One observation point** (T-4) so Gate 7.5 can assert reality rather than an echo.

**T-3 — the precedence table has a missing rung; pin all five.**
REQ-092 names four rungs (per-call `agent()` opts › per-run overrides › registered defaults › engine alias). The code has a fifth the requirement is silent about: `agent-executor.ts:291` fills `model` from the **agentType definition's frontmatter** when `opts.model` is undefined. Where does that sit relative to a *user's* run-level override? A naive wiring lets a user's `overrides.model` beat the author's per-step agentType choice — which contradicts D12's spirit, since the agentType definition is author configuration. Proposed table (**and flagged for synthesizer adjudication as OPEN-3**), rationale *the author's more specific choice wins over a user's blanket one*:

| rung | source | who controls it |
|---|---|---|
| 1 (highest) | per-call `agent({model, effort, timeoutMs})` in the script | author |
| 2 | `agentType` definition frontmatter (`model`, `tools`) | author |
| 3 | per-run `overrides` | **user** |
| 4 | registered `defaults` | author |
| 5 (lowest) | engine default alias / config default | operator |

The same table must be applied to `timeoutMs`, whose per-call semantics are already documented as overriding the gateway default *in both directions* (`server.ts:258`) — so "override" here means "replaces", not "lowers", and the global ceiling from S-4 clamps the result *after* resolution.

**T-4 — extend the harness descriptor; add no new observability plumbing.**
`agent-executor.ts:~16-40` already builds `{model, provider, prompt, tools, skills, mcpServers, surfaceType}` and it is already served through `workflow_agent_log`. Extend it with `{effort, effortApplied: boolean, effortMappedValue?, timeoutMs, appendPromptBytes, promptTruncated: boolean, source: {model: 'per-call'|'agentType'|'override'|'default'|'engine', timeoutMs: …, effort: …}}`.

One change, three lenses satisfied: **security** gets the audit record, **scalability** gets it without a new store or endpoint, **testability** gets the exact assertion point REQ-091/092/093 already demand ("observable in the harness descriptor … not merely echoed back"). The provenance `source` map is what turns "did the wiring happen?" from a code-review question into an integration assertion.

**T-5 — scope fence: do NOT wire `session-options-builder.ts` in v21.**
It carries `effortMapping?: Record<string, unknown>` (line 18) and will look like the natural home for REQ-093. It is one of the three modules recorded as **built-but-unwired architecture debt** (with `cli-lifecycle`, `timeout-race`), explicitly parked on a separate security-hardening iteration and re-verified 2026-08-31 as having zero importers in `src/`. Wiring it here drags an unreviewed module into the run path under cover of a params iteration. Keep `mapEffort` a small pure function consumed by the two gateway clients; leave the debt on its own track.

### 2.4 Forward-compatibility with v22/v23 that costs nothing now

D15 masks the script from non-owners; D16 removes the skeleton parser and stores an agent-rendered diagram per version. Both mean **the script text stops being the discovery surface**. If the contract is normalized and stored on the version row at registration (S-6/P-1), REQ-090's discoverability keeps working after masking with zero rework. If instead the contract is derived from script text on read, v22 breaks it. This is not speculative generality — it is choosing the storage location that the already-approved next iteration requires. One decision, made now, for free.

---

## 3. Risks

| id | risk | severity | mitigation |
|---|---|---|---|
| **R-1** | **Inert-wiring regression (4th instance of the class).** REQ-092's fix ships as another optional-with-default field and is silently never applied. | **HIGH** | Non-optional constructor arg (T-2.1) + composeConfig wiring test as ARCH DoD (T-2.2) + provenance in the harness descriptor asserted at Gate 7.5 real-tier (T-4). Do not accept a Gate 6 green that only proves `workflow_get` echoes the row. |
| **R-2** | **Privilege escalation via `resolveHarnessParams`'s override side** (`tools`/`skills`/`prompt` mergeable from caller data). | **HIGH** | Split types (S-1); `UserOverrides` has no field for a locked key. Regression test: a `workflow_run` whose `overrides` carries `tools` → `PARAM_LOCKED`, and the dispatched surface is byte-identical to the registered one. |
| **R-3** | **Mass resume-cache invalidation on deploy.** v21 folds resolved model/appendPrompt into `CallKey` upstream of `run-manager.ts:706`; every suspended run re-dispatches its whole tail (forward-poisoning miss rule). Costs real money, visible only in production. | **HIGH** | D-P21-1 + P-3: params are run-immutable, resolution happens downstream of key construction, `workflow_resume` refuses changed overrides. Test: a run journaled pre-change resumes with zero gateway invocations. |
| **R-4** | **Cost amplification** — non-owner principal runs any workflow at `effort:'max'` on the dearest alias, billed to the owner (REQ-087 opens execution to all). | **MED** | Global fail-closed ceilings (`maxEffort`, `maxTimeoutMs`); principal attribution on the run snapshot. Residual accepted per OPEN-1; escalate to Gate 1 if the operator considers it unacceptable. |
| **R-5** | **Prompt injection via `appendPrompt`** steering the author's granted tool surface. Cannot be eliminated by design; D13 fixes it in the strongest instruction position. | **MED** | Cap + untrusted-framing delimiter + persisted attribution (S-3). Documented as an accepted residual of D13, not a defect. |
| **R-6** | **Dishonest effort reporting** — `effortApplied:true` derived from a static provider table rather than from the request actually built, producing a false success claim (the exact failure mode REQ-093 forbids). | **MED** | `mapEffort` returns `{applied, value}` and the **same** returned value must be the one placed on the outbound request; the descriptor reads that return, never a parallel lookup. One integration test per provider family, incl. a provider with no equivalent control. |
| **R-7** | **Contract-parse widening / VM eval on a bigger literal** (DoS via a huge or deeply nested `params` block at registration). | **LOW-MED** | Reuse `checkMeta` pureLiteral gate; size + depth bound before `runInNewContext`; existing 50 ms timeout retained; evaluate once at registration only (S-6). |
| **R-8** | **`workflow:<name>` label injection / dedup collision** in REQ-095. | **LOW** | Reuse the registration name-charset rule minus existence check; include the workflow label in the REQ-035 dedup fingerprint (S-7). |
| **R-9** | **appendPrompt × PROMPT_CAP truncation silently displaces author instruction.** | **LOW** | Cap sized well below `PROMPT_CAP`; `promptTruncated` flag in the descriptor; pinned head/tail test (P-4). |
| **R-10** | **Snapshot persists caller text that may contain a pasted secret.** | **LOW** | Route the persisted copy through the REQ-083 redact-at-capture path; see C-3 for why the dispatched copy must not be redacted. |

---

## 4. Internal conflicts between my own three lenses (surfaced explicitly, as the lens demands)

**C-1 — Security vs Simplicity/backward-compat: closed-by-default knobs.**
Security wants `model`/`effort` pinned to the registered default unless the author opts them open (fail-closed, and it kills R-4 outright). REQ-090 explicitly states the opposite (four global knobs tunable by default; a `params` block may only *constrain*), and flipping it silently breaks every already-registered workflow's user experience and contradicts a Gate-1 decision.
**My resolution**: obey the requirement, ship the global ceilings (which remove the *unbounded* part of the risk at the cost of one config block), attribute cost to the principal, and record the residual. Escalated as **OPEN-1** — a default flip is a requirements change, not an architecture liberty.

**C-2 — Security vs Testability: "before any durable work" is a negative assertion.**
The security property in REQ-091 is *absence* of side effects (no run row, no directory, no fork) — the hardest kind of thing to test, and the kind that silently rots as the ladder grows.
**My resolution**: make the ladder itself **data**. A pure `admit(spec, contract, state) -> Verdict` returns the ordered verdict, so rung ordering is unit-testable as a table without a filesystem; then exactly **one** integration test asserts the negative (submit a `PARAM_LOCKED` call, assert zero run rows and zero new workspace dirs). The cost: `admit` must receive the admission counter and catalog row as arguments rather than reaching for them, which makes the call site slightly more verbose. Accepted — verbosity at one call site buys a testable security invariant.

**C-3 — Scalability/consistency vs Security: the snapshot persists caller text.**
D-P21-1's snapshot (which is what buys consistency, resume determinism, and auditability) means `appendPrompt` — arbitrary user text — is written to durable storage. If a user pastes a credential, it lands in the run record. But REQ-094 also demands the *composed* prompt be byte-identical to pre-v21 when no append is present, and redacting the **dispatched** bytes would change what the model sees and break replay.
**My resolution**: redact the **persisted** copy only, never the dispatched one — which is precisely the invariant DES-088 already pins (*persist-only redaction / double-redaction exclusivity / replay-divergence*). So this conflict is already adjudicated in the codebase's favour; v21 must route the snapshot through the existing sink rather than adding a fifth persist path that bypasses it. **Explicit instruction for Gate 3/4**: the run-snapshot write is a *new persist sink* and must be added to REQ-083's four-sink completeness sweep, or v21 silently opens a hole in a shipped control.

**C-4 — Testability vs Security: provenance in the descriptor leaks author configuration.**
T-4's `source` map plus the full `tools`/`skills` lists is exactly what makes the wiring assertable — and it is served through `workflow_agent_log` to whoever ran the workflow, including a **non-owner**. v22 (D15) will mask the script from non-owners; a descriptor that lists the author's tool/skill names and registered model hands back a good part of what the mask hides.
**My resolution**: not mine to decide alone, because it is really a v22 masking-policy question. Cheap options: (a) full descriptor to the owner, and to a non-owner show effective `model`/`effort`/`timeoutMs` + **counts** (`tools: 6`) instead of names; (b) accept exposure now and fold it into v22's masking decision. I lean (a) — it costs one branch and one test, and it keeps v22 from having to retrofit — but I flag it as **OPEN-2** rather than pre-empting the v22 Gate-1 decision.

---

## 5. Open items for the synthesizer / round 2

- **OPEN-1** — closed-vs-open default for `model`/`effort` when no `params` block is declared (C-1). Requirements change if closed; my proposal is open + ceilings.
- **OPEN-2** — descriptor exposure of author configuration to a non-owner caller (C-4), coupled to v22's D15 masking.
- **OPEN-3** — the fifth precedence rung: `agentType` definition frontmatter vs per-run user override (T-3). REQ-092 is silent; code (`agent-executor.ts:291`) currently has it beat only an absent `opts.model`. I propose author-agentType **above** user override.

---

## 6. Expected disagreements with the other lens groups

My counterpart in this panel is the **quality-dimensions** lens (per the v14/v15 precedent in `state.yaml`, where it proposed streaming, metrics, `/healthz`, a RunStore port, and an OpenAPI surface — all consciously excluded as out-of-slice). I predict the same shape of disagreement and pre-commit my positions so round 2 is cheap:

**D-1 — "Model the contract as a general parameter registry / a schema-driven knob system."**
Expected argument: a `ParamDescriptor` abstraction with pluggable validators and a registry, so future knobs are declarative and the engine gains a uniform parameter subsystem.
**My position — decline (Karpathy).** v21 has exactly **four** user-tunable knobs, fixed by D12, and a small author-declared `args` shape. A closed four-field type is *more* secure than a registry (S-1: locked keys become unrepresentable, whereas a registry makes lockedness a runtime property of registry entries — i.e. a denylist again) and it is trivially testable. If a fifth knob arrives, adding a field to a four-field type is an afternoon. **Concession available**: I will accept a shared `ParamSpec` *value type* for the declared-`args` checks (which genuinely are open-ended, since authors declare arbitrary arg shapes) as long as the four **harness** knobs stay a closed type. That is the natural seam and I expect it is where we converge.

**D-2 — "Serve the contract as JSON Schema in `tools/list` / add an OpenAPI or a dedicated discovery endpoint."**
Expected argument: consumability — a schema-only client should discover the contract the standard way (REQ-079 lineage).
**My position — partially agree, and I have already conceded the cheap half.** S-2 puts `overrides` in the `workflow_run` inputSchema with `additionalProperties:false` and documented bounds; that is the schema-only-consumer story for the *engine-global* knobs, and it costs nothing. But the *per-workflow* contract is per-row data, not a static tool schema, so it belongs in `workflow_get`/`workflow_list` structured output (which REQ-090 already specifies) — **not** a new endpoint and **not** a dynamically-generated per-workflow tool schema. I will resist any new route: v21 should add zero endpoints.

**D-3 — "Surface the contract and the effective params on the dashboard."**
Expected argument: observability — REQ-071/073's agent-detail panel already shows model/prompt/tools, so v21's params belong there.
**My position — agree on direction, decline for this slice, and note a *security* objection the quality lens will not have considered.** The dashboard and `/api/*` are **unauthenticated** (explicit REQ-086 non-goal, trusted-network caveat). Rendering the harness descriptor there publishes author configuration and user-supplied `appendPrompt` text to anyone who can reach the port — strictly worse than C-4's authenticated case. If the dashboard is in scope at all, it must show the same reduced view OPEN-2 lands on. My preference: out of scope for v21; revisit with v23's read-only describe surface, which is the natural home.

**D-4 — "Introduce a port/adapter seam for harness resolution (replaceability)."**
Expected argument: `HarnessResolutionPort` with an injected implementation, consistent with the RunStore-port style proposal from v14/v15.
**My position — accept, but for the *testability/wiring* reason, not the replaceability one**, and only in its minimal form: a **required constructor argument** carrying already-resolved `EffectiveParams` (or one function). Not an interface with multiple implementations, not a DI container, no alternate strategy. I expect agreement here; the disagreement will be about size, and I will argue the non-optional-argument version is what actually kills R-1, whereas an interface with a default implementation *reintroduces* the bug class (a default implementation is exactly how `resolveHarnessParams` came to have zero callers while looking wired).

**D-5 — "Add metrics / structured events for parameter rejections."**
Expected argument: self-sustainability — count `PARAM_LOCKED`/`PARAM_OUT_OF_RANGE` to see misuse.
**My position — decline.** No metrics subsystem exists; v21 must not introduce one for two error codes. The typed error already reaches the caller and the run record already carries the principal. If misuse analysis is later wanted, the journal has the data. **Speculative** by the tie-breaker.

**D-6 — Where I expect the quality lens to be *right* and me to concede.**
(i) `params` naming/shape consistency with the existing `meta` block — I have no strong view and will take theirs. (ii) Degradation semantics for a workflow registered before v21 (no `params`, no `defaults`): they will likely push a more explicit "unconstrained" representation rather than `undefined` sprinkled through the resolver; that is a genuine improvement to `resolveEffective`'s testability and I will adopt it. (iii) If they propose surfacing `effortApplied:false` to the *caller* rather than only in the descriptor, I agree — REQ-093's honesty requirement is better served by both.

---

## 7. Minimal architecture, restated (the Karpathy check)

Everything above reduces to this delta. If a proposal at Gate 3/4 is larger than this list, it is carrying speculation:

1. One new column: `workflows.paramsJson` (normalized contract, written at registration).
2. One new closed type `UserOverrides` + one new value type `EffectiveParams`; `HarnessDefaults` unchanged.
3. Five pure functions (`parseParamContract`, `validateUserOverrides`, `resolveEffective`, `composePrompt`, `mapEffort`).
4. One admission rung, placed after `catalog.get()` and before any filesystem work.
5. One snapshot field on the run record (run-immutable effective params + principal), routed through the existing REQ-083 redaction sink.
6. One **required** constructor argument on the dispatch path (kills the inert-wiring class).
7. Descriptor extension at the single existing observation point (`agent-executor` harness descriptor → `workflow_agent_log`).
8. Three config keys with fail-closed defaults (`maxTimeoutMs`, `maxAppendPromptBytes`, `maxEffort`) — **each one added to `compose-config-v2-wiring.test.ts` in the same change**.
9. Zero new tables, zero new endpoints, zero new services, zero new abstractions, and **no wiring of `session-options-builder.ts`**.
