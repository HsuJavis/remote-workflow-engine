# Gate 8 review (pass 4) — Adversarial architecture group

**Lens:** (a) **security** — authn/authz correctness, secret protection, attack surface (brute force,
forgery, timing); (b) **scalability/performance** — state storage, horizontal scaling, concurrency &
consistency; (c) **testability** — module boundaries, injectable dependencies, unit/integration
reachability. **Tie-break:** Karpathy simplicity-first (minimum architecture that solves the problem,
nothing speculative).

**Iteration under review:** v21 — ARCH-064..070 + ADR-001..008 (REQ-090..095), IMPL-129..141.
**Compared against:** `02-architecture.md` §v21 (as amended by IMPL-139 B5 and IMPL-140 R-G6/G7/G8)
and `04-design.md`'s three binding adjudication sections (A-1..A-9, B-1..B-8, C-1..C-2, plus #5/#6/#7).
Adjudicated departures are **not** reported as drift.
**Tree:** clean at `016e95c`. `git diff 637b86e..HEAD -- src/` = 17 files, +1233/−132.
**Scope:** the union of the v21 IMPL `files:` lines plus the modules they cross at a boundary
(`harness-defaults.ts`, `secret-resolver.ts`, `default-aliases.ts`, `sandbox/guards.ts`) and the two
vendored type surfaces the effort wiring targets (`@anthropic-ai/sdk`, `@anthropic-ai/claude-agent-sdk`).
No whole-tree scan.

**This is the fourth adversarial pass.** Passes 1–3 produced `07-review.md` §4 (B1..B5), §R2
(R-G1..R-G10) and the P-A1 `restPath` HIGH, closed by IMPL-139/140/141. **Every one of those closures
was re-verified in code at HEAD** (see *Checked and clean*) and none is re-reported. The findings below
are new. Two of them (A1, A2) are reachable by any authenticated caller with a single MCP call.

---

## Headline

**Two HIGH, both in the same 320-line pure module the architecture calls "the single place that knows
the contract vocabulary" (ARCH-064) — and both are the *inverse* of the defect class this iteration
spent three send-backs closing.** R-G3, P-A2 and G-1 were all "an advertised bound is enforced
nowhere". A1 and A2 are "an input the parser accepts is *unsurvivable downstream*":

- **A1** — `parseParamContract` validates a `ParamSpec`'s `enum` **length** but never its **type**. A
  script declaring `enum: 'abc'` on the `effort` knob registers successfully, and every subsequent
  `workflow_get` **and `workflow_list`** throws `TypeError: authorEnum.filter is not a function`. One
  poisoned registration by any authenticated principal permanently denies workflow discovery for
  *every* workflow on the engine. ARCH-067's "fail-closed registration… nothing is stored" is not held.
- **A2** — the error-echo truncator trims **one character per iteration**. Measured on this tree:
  100k chars → 611 ms, 200k → 2.41 s, 400k → 9.72 s (clean 4× per doubling). `overrides.model` is
  bounded only by `MAX_BODY_BYTES = 8 MiB`, so one `workflow_run` blocks the single-threaded event
  loop for ~an hour, *before* `createRun` and therefore before `maxConcurrentRuns` can see it.

Both are one-line fixes (`Array.isArray` + shape guards; `Buffer.byteLength` + a single `slice`), which
is why they clear the Karpathy bar: neither asks for new machinery, only for the parser to finish the
job ARCH-064 assigns it.

The four MEDs are all **honesty-of-control** defects: a control the architecture names that the code
does not enforce (A3), bounds served on a discovery surface that nothing checks (A4), a ceiling
enforced but never advertised (A5), and an `effortApplied:true` record that is false for exactly the
models REQ-093 exists for (A6).

---

## Findings

### A1 — HIGH — malformed `ParamSpec` registers fail-**open** and bricks the read surface engine-wide

- **Violates:** **ARCH-067** ("Fail-closed registration… a `params` block naming any locked key, or
  **malformed**/oversized, is rejected with a typed error and **nothing is stored** — no partial
  write", `02-architecture.md:752`); **ARCH-064** api/inv (the five-code typed taxonomy is the whole
  rejection surface, `:723`).
- **Evidence:** `src/params/contract.ts:161-197`. The knob loop checks locked-key, unknown-key,
  `spec.enum.length > 32` and (for `model`) alias membership. It never checks that `enum` **is an
  array**, that `type` is one of `'string'|'number'|'enum'`, or that `min`/`max` are numbers.
  `src/params/contract.ts:110` then does `authorEnum.filter(...)` on whatever was stored.
- **Reproduced end-to-end** against a real `WorkflowCatalog` + the verbatim `mcp-facade.ts:24`
  `readParams`:

  ```
  script:  export const meta = { params: { knobs: { effort: { type:'enum', enum:'abc' } } } };
  register('poison')                      -> ACCEPTED
  stored params column                    -> {"knobs":{...,"effort":{"type":"enum","enum":"abc"},...}}
  readParams(stored, ceilings)            -> TypeError: authorEnum.filter is not a function
  list().map(w => readParams(w.params))   -> TypeError  (throws on the poisoned row, so the whole
                                             workflow_list response dies — healthy workflows included)
  ```
- **Blast radius (security lens).** Registration of a *new* name is open to any authenticated
  principal (ARCH-061/062 gate only re-register-overwrite and deregister), and with `auth` disabled —
  still the default per ARCH-063 inv (5) — it is open to the LAN. The poisoned row is **durable**, so
  this is a persistent cross-tenant denial of `workflow_get`/`workflow_list`, not a transient one. The
  same throw also fires at the admission rung (`run-manager.ts:410` → `contract.ts:249`
  `effectiveBounds`), turning a submission into an untyped 500 rather than one of the five documented
  codes.
- **Why the existing guards miss it.** `workflow-catalog.ts:171` computes `ceilingKnobs` from
  `canonicalContract()`, never from the author's contract, so the G-1 ceiling pass cannot trip on a
  malformed author spec. `validateHarnessDefaults` never sees `params`. `checkMeta.pureLiteral` +
  `MAX_META_LITERAL_BYTES` bound the *source*, not the *shape*.
- **Fix (minimum):** a `ParamSpec` shape guard inside `parseParamContract`'s two loops — `type` in the
  three literals, `enum` `Array.isArray`, `min`/`max` `typeof === 'number'` — returning the existing
  `invalid(param, reason)`. ~6 lines, no new module, no new code.

### A2 — HIGH — quadratic error-echo truncation = single-request CPU exhaustion at the admission rung

- **Violates:** **ARCH-066** (the rung's stated property is that a rejection costs "no durable work…
  no run row, no workspace mkdir, no sandbox fork" — the implicit and load-bearing half is that it
  costs *little work at all*, since it runs upstream of every concurrency and budget control);
  **ADR-005** (whose entire purpose is bounding what a caller-supplied override can cost the operator).
- **Evidence:** `src/params/contract.ts:77-84`.
  ```ts
  while (Buffer.byteLength(truncated, 'utf8') > MAX_SUPPLIED_BYTES) truncated = truncated.slice(0, -1);
  ```
  Each iteration re-measures and re-copies the whole string: O(n²) time **and** O(n²) allocation to
  trim to 64 bytes.
- **Measured on this tree** (`validateUserOverrides` with an out-of-enum `model`):
  | input chars | wall time |
  |---|---|
  | 100 000 | 611 ms |
  | 200 000 | 2 410 ms |
  | 400 000 | 9 718 ms |

  Clean 4× per doubling. `MAX_BODY_BYTES = 8 * 1024 * 1024` (`src/server.ts:687`) and nothing bounds
  the *length* of `overrides.model` / `overrides.appendPrompt` before the rejection path, so an 8 MiB
  `model` string extrapolates to ≈ 65 minutes of blocked Node event loop from **one** request.
- **Scalability lens.** This engine is single-process and single-threaded; the block stalls *every*
  concurrent run's journal writes, `/api/status`, the scheduler and the webhook receiver, not just the
  offending call. It sits **before** `createRun`, so `maxConcurrentRuns`, `RunGuard` and the budget
  never see it, and it leaves **no durable trace** — the rejection is by design not journalled
  (ADR-008 declined the rejection counter), so the operator gets an unexplained multi-minute freeze.
- **Note:** the one path that *is* correctly size-first is `appendPrompt`, which returns
  `{suppliedBytes, maxBytes}` before any echo (`contract.ts:272-282`) — exactly the right shape. A2 is
  the two knobs that were not given the same treatment.
- **Fix (minimum):** `Buffer.byteLength(v) > 64 ? Buffer.from(v).subarray(0, 64).toString('utf8') : v`
  — one `slice`, O(n). (Or cap the string before it reaches the echo at all.)

### A3 — MED — ARCH-064 inv (2) "allowlist at **both** ends" — the MCP end is decorative

- **Violates:** **ARCH-064** invariant (2) (`02-architecture.md:725`) and scenario **S-2** (`:921`),
  which states the refusal is delivered by "`additionalProperties:false` **+** `parseUserOverrides`".
- **Evidence:** `src/server.ts:336` declares `additionalProperties: false` inside `TOOL_METADATA`, but
  nothing in `src/server.ts` validates an incoming tool call's arguments against its `inputSchema` —
  `callTool` (`src/server.ts:799`) casts the raw args and forwards them
  (`overrides?: unknown` → `mcp-facade.ts:109` → `RunManager.start(spec, a.overrides)`). Grep for a
  schema validator on the tool-dispatch path returns nothing; the only `ajv` in the tree is
  `agent-executor.ts`'s *agent-output* schema.
- **Assessment.** Behaviourally **fail-closed today**: `validateUserOverrides` refuses an unknown key
  with `PARAM_UNKNOWN` and a locked key with `PARAM_LOCKED`, so there is no live bypass. The defect is
  that the architecture credits a second, independent control that does not exist server-side —
  `additionalProperties:false` is a hint to well-behaved MCP clients only. This is precisely the class
  IMPL-139 filed as **B1** and IMPL-140 as **R-G10** (a comment/doc asserting a check that lives
  somewhere else), and it is *load-bearing here* because ADR-001's own text demotes `PARAM_LOCKED` to
  "a courtesy message at the boundary, never the security control" — so the doc names two controls,
  calls one a courtesy, and the other is a schema nobody evaluates. The actual single control is
  `validateUserOverrides`.
- **Fix:** either amend ARCH-064 inv (2)/S-2 to state that the closed **type** plus the parser are the
  control and the schema is client-facing documentation (zero code, honest), or enforce the schema at
  the dispatch seam. The doc fix is the Karpathy-correct one.

### A4 — MED — advertised bound ≠ enforced bound, 4th instance: `min`/`max` on a `string` knob are inert

- **Violates:** **ADR-005** / the "advertised-bound == enforced-bound" property pinned by IT-083's A-3
  case; **ARCH-067** (`workflow_get.params` is *the* discovery surface for a workflow's bounds).
- **Evidence:** `src/params/contract.ts:222-237` compares `(value as number) < spec.min` and
  `(value as number) > spec.max`. For a `type:'string'` knob the value is a string, so both are NaN
  comparisons and always false. `effectiveBounds` (`contract.ts:120-125`) narrows **only** `timeoutMs`
  and `effort`; every other spec is passed through verbatim to `workflow_get`/`workflow_list`.
- **Reproduced:** contract `{appendPrompt: {type:'string', min:5, max:10}}`, override
  `appendPrompt: 'x'.repeat(40)` → `{"ok":true}`. The author's declared `max:10` is served to callers
  and enforced nowhere.
- **Why this matters more than it looks.** ARCH-064's forward-looking clause (ADR-007) says an author
  "may constrain `appendPrompt` like any other global knob (REQ-090 already permits constraining), so
  no mechanism is needed now" — that is the stated reason option (b) *author opt-out* was declined.
  The mechanism ADR-007 leans on is the one that silently does nothing.
- **Fix:** interpret `min`/`max` as length bounds for `type:'string'` (three lines in
  `checkValueAgainstSpec`), **or** reject `min`/`max` on a string spec at `parseParamContract` — which
  folds into A1's shape guard for free.

### A5 — MED — `maxAppendPromptBytes` is enforced but never advertised (third ceiling, same asymmetry)

- **Violates:** **ARCH-064** inv (3) (errors self-describing so "an agent caller repairs its call
  without a second `workflow_get` round-trip" — the discovery surface must therefore carry the bound);
  **ARCH-067** (the read surface is the contract's discovery point); contradicted by the shipped tool
  description at `src/server.ts:334`, which tells callers `appendPrompt` is "bounded by the engine's
  `maxAppendPromptBytes` ceiling".
- **Evidence:** `src/params/contract.ts:117-127` — `effectiveBounds` applies `boundTimeoutMs` and
  `boundEffort` and nothing else. Verified: `effectiveBounds(canonicalContract(), ceilings).knobs.appendPrompt`
  → `{"type":"string"}`, with `maxAppendPromptBytes: 1024` in force at admission.
- **Assessment.** Fail-closed (the caller is refused with `{suppliedBytes, maxBytes}`), so this is a
  consumability/observability defect, not a hole — but it is the **third** ceiling and the only one a
  caller cannot discover before spending a round-trip on a refusal. Both other ceilings are advertised.
- **Fix:** add a `maxBytes` (or `max`) field to the `appendPrompt` spec inside `effectiveBounds`,
  paired with A4's length semantics so advertised and enforced are the same number by construction —
  which is the "same predicate at both rungs" discipline F-2 and G-1 already established in this file.

### A6 — MED — `effortApplied:true` is keyed per-**provider** while effort support is per-**model**

- **Violates:** **ARCH-069** ("a provider with no equivalent control gets an explicit no-op entry that
  degrades the run without failing it **and records the reason**", `02-architecture.md:770`);
  **ARCH-068** (`effortApplied` is tri-state so that "'silently dropped' and 'never asked for' must
  stay distinguishable", `:761`); **ARCH-065**'s "kills the false-success mode REQ-093 forbids".
- **Evidence:** `src/gateway/client.ts:41-43` —
  `EFFORT_PROFILES: { anthropic: { param:'effort', restPath:['output_config','effort'] } }`, keyed on
  `AliasMap[string]['provider']`. `mapEffort` (`:55-59`) returns `{applied:true, …}` for **every**
  anthropic-provider alias regardless of model.
- **Primary source (vendored types, not memory):**
  - `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:174-178` — effort is "Present … **on a model
    that supports the effort parameter**; absent for … **models without effort support**", and the
    reported level is "**after any silent downgrade for the selected model**".
  - `sdk.d.ts:1198-1202` — the SDK exposes per-model `supportsEffort` and available levels. Neither is
    consulted anywhere in `src/`.
  - `sdk.d.ts:1601-1608` — `'max'` is annotated "(Fable 5, Opus 4.6+, Sonnet 4.6+)", i.e. explicitly
    a model-level capability.
- **Consequence.** A run on any anthropic alias pointing at a model without the dial records
  `effortApplied: {param:'effort', value:'max'}` — "applied" — while the backend silently downgraded
  or ignored it. That is the exact dishonest-observability mode ARCH-068's tri-state exists to prevent,
  and it defeats REQ-093's Gate-7.5 assertion shape ("two runs at `low` vs `max` differ"): the
  descriptor will differ even when the wire outcome does not.
- **Verified NOT a defect (checked, so the finding is not overstated):** the wire shapes are both
  correct. `output_config.effort` matches `@anthropic-ai/sdk`'s `OutputConfig`
  (`resources/messages/messages.d.ts:853-863`), and `effort` is a real field on the Agent SDK's
  `Options`. The P-A1 `restPath` HIGH from pass 3 is genuinely closed.
- **Fix (minimum, and *not* a new subsystem):** the honest cheap version is to stop asserting
  `applied:true` from a provider-level table when the SDK path can report the truth — the SDK already
  surfaces the post-downgrade effort per turn. Failing that, ARCH-069's note should be amended to say
  the profile is a *provider* capability claim and `effortApplied:true` means "sent", not "honoured".
  Amending the doc is acceptable; leaving both as-is is not, because they disagree.

### A7 — LOW — `src/secret-resolver.ts` changed in v21 but appears on **no** IMPL `files:` line, and IMPL-141 declares the change "not done"

- **Violates:** the traceability discipline (every changed `src/` file named on an IMPL); contradicted
  by IMPL-141's own "**Not done, declared**" paragraph, which routes "**F-4** (P-A6 secret-marker
  grammar duplicated between `secret-resolver.ts` and `run-manager.ts:538`)" forward as outstanding.
- **Evidence:** `git diff 637b86e..HEAD -- src/secret-resolver.ts` = +15/−1: a new `MARKER_PREFIX`
  const, `redact()` re-pointed at it, and a new exported `hasSecretMarker()` — consumed at
  `src/run-manager.ts:35,538`. Grep for `secret-resolver` across the v21 slice of `06-impl-log.md`
  returns **0**. So F-4 **was** fixed, the log says it was not, and the file is untraced.
- **Testability lens.** This is the one finding that is purely about the ledger rather than the code,
  and it matters for the same reason the iteration keeps re-finding wiring misses: an untraced file is
  a file the next impact analysis will not open.

### A8..A12 — LOW — doc drift (A8..A10 are the items IMPL-140 explicitly "left for the next reviewer to route"; A11/A12 are new)

| # | Where | Drift |
|---|---|---|
| **A8** | `02-architecture.md:913` (v21 process view) | The sequence diagram still emits `appendPromptBytes` on the harness event — dropped by adjudication **B-2**, correctly retracted at `:760`, `:761` and `:961`. (= QD-OBS-1.) |
| **A9** | `02-architecture.md:725` (ARCH-064 note 1) and `:921` (scenario S-2) | Both name **`parseUserOverrides`** as the only constructor from caller data. That function has never existed: `grep -rn parseUserOverrides src/` → 0 hits; `04-design.md:2718` records the name being normalized to `validateUserOverrides`. (= QD-CONS-2.) |
| **A10** | `02-architecture.md:975` (v21 Decision rationale) | Still states the `PROMPT_CAP` record-honesty residual is "handled by `promptTruncated` + `appendPromptBytes`" — the identical false sentence IMPL-139's B5 corrected one line up at `:761`, reproduced one section down. |
| **A11** | `04-design.md:2646` and `:2653` (DES-105 body) | The descriptor struct still declares `appendPromptBytes?: number; promptTruncated?: boolean;` and the prose still explains them. Only the appended B-2 adjudication at `:2826` retracts them, and neither field exists in `src/types.ts`. Design *body* vs shipped type. |
| **A12** | `02-architecture.md:731` (ARCH-065 api) and `:767` (ARCH-069 api) | Both still describe the pre-P-A1 shape: `mapEffort` returning `{applied:true, param, value}` and the gateways applying "`{param, value}` **to the outbound request**". The wired mapper returns `{applied, param, restPath, value}` (`gateway/client.ts:28-30`) and nests the value at `output_config.effort` (`:137-139`) — a flat body field would be rejected by the Messages API. **Compounding:** the zero-caller duplicate `mapEffort`/`ProviderEffortProfile` in `src/params/resolve.ts:154-164` — declared debt (F5/QD-2, recorded in ARCH-065) — now diverges *semantically*, not merely by duplication: it has **no** `restPath`, so a future caller who picks the wrong copy emits exactly the top-level `effort` field pass 3 filed as a HIGH. Disputing declared debt, not a fresh discovery: the debt entry should be upgraded from "duplicate" to "wrong". |

---

## Internal conflicts between my three lenses (mandated section)

1. **Security vs. simplicity — A1's fix is the one place I want *more* code.** The Karpathy tie-break
   normally argues against adding validators. Here it argues **for**: ARCH-064's whole justification is
   "ONE pure module is the single place that knows the contract vocabulary… so the rules cannot drift
   into three copies". A module that owns the vocabulary but validates only two of a `ParamSpec`'s six
   fields is not simpler — it has pushed the missing half onto every downstream consumer, which is why
   `boundEffort` and `checkValueAgainstSpec` both crash. Six lines in the parser removes crash handling
   from two call sites. **Simplicity concedes.**

2. **Security vs. scalability — A2 pits secret-hygiene against cost.** `truncatedSupplied` exists for a
   security reason (ADR-007 / DES-101 row 6: never echo caller free text in full). The naive
   implementation of that security rule created a denial-of-service. This is the sharpest conflict in
   the slice, and it resolves cleanly: the security requirement is *"don't echo more than 64 bytes"*,
   which is O(n); the O(n²) is incidental. **No trade-off is actually being made — the current code is
   dominated on both axes.**

3. **Security vs. testability — A3's resolution is the uncomfortable one.** The clean testability move
   is to enforce `inputSchema` at the dispatch seam: it makes the drift-lock test meaningful and gives
   every tool a real boundary. The security-minimal move is to fix the doc, because a second validator
   is a second place for the allowlist to rot — the exact rot ARCH-064 was written to prevent. **I side
   with the doc fix and record the dissent:** defense-in-depth here buys little (the parser is total and
   already fail-closed) and costs a duplicate allowlist. But the architecture must stop claiming the
   control.

4. **ADR-005's own conceded conflict, re-examined and still sound.** ADR-005 chose open-by-default
   knobs (security loses) to honour REQ-090's backward-compat clause (a Gate-1 user decision), and
   patched the cost hole with ceilings. I audited the patch: it now holds at *four* rungs
   (registration via G-1's pass over final `effectiveDefaults`, admission via `effectiveBounds`, read
   via `readParams`, resume via the pinned snapshot) with one shared predicate. **That conflict is
   correctly resolved** — A5 is the only remaining seam and it is advisory, not enforcing.

5. **ADR-001's conflict is real but mis-stated.** "A locked key is unrepresentable" is a *compile-time*
   property, and every caller here arrives as JSON over HTTP where TypeScript does not exist. The
   runtime control is `validateUserOverrides`'s two-branch loop plus the fact that the returned object
   is built key-by-key from `TUNABLE_KEYS` only. I verified both ends, including prototype-pollution
   shapes: `JSON.parse('{"__proto__":…}')` yields an own key that `Object.entries` enumerates and the
   `TUNABLE_KEYS` allowlist rejects with `PARAM_UNKNOWN`. **ADR-001's decision is right; its stated
   reason is only half the mechanism**, and A3 is what happens when the doc leans on the half that
   isn't running.

---

## Checked and clean (re-verified at HEAD; not re-reported)

| Claim | Anchor | Result |
|---|---|---|
| R-G1 — `unredactBestEffort` deleted, resume refusal-only | `grep -rn unredactBestEffort src/` → 0; `run-manager.ts:538-539` throws `PARAM_SECRET_UNAVAILABLE` | ✅ |
| R-G2 — **effective post-merge** model alias check | `run-manager.ts:424-431`, after `mergeRunParams`, before `createRun` | ✅ |
| R-G3 — same alias table at both ends | `server.ts:1155` (catalog) and `:1206` (RunManager) both `new Set(Object.keys(config?.aliases ?? DEFAULT_ALIASES))` | ✅ |
| R-G9 — redact **then** cap | `agent-executor.ts:436-439`; `capPrompt` unconditional, outside the provider branch | ✅ |
| R-G10 — both `kind !== 'harness'` carve-outs deleted | `grep "kind !== 'harness'" src/` → 0; comments at `:174`, `:452` state the true reason | ✅ |
| ARCH-066 inv (1)/(3) — snapshot run-immutable, `CallKey` untouched | `run-manager.ts:812` = `{prompt, opts}` raw; composition lives in `agent-executor.ts:358` | ✅ |
| ARCH-066 inv (5) — snapshot redacted before the durable write, live entry unredacted | `run-manager.ts:435-437` vs `:503` | ✅ |
| ARCH-066 inv (6) — 3 config keys through `composeConfig` | `main.ts:162-164`; one `ceilings` object at `server.ts:1142-1145` → catalog `:1156`, RunManager `:1207`, facade `:1224` | ✅ |
| ARCH-067 — `ON CONFLICT … params = excluded.params`; idempotent `ALTER TABLE` | `workflow-catalog.ts:96-97`, `:213-218` | ✅ |
| ARCH-067 / ADR-004 — one query, no run-time script re-parse | `workflow-catalog.ts:249` `SELECT script, version, defaults, params`; `getFull` delegates | ✅ |
| G-1 — one ceiling pass over the **final** `effectiveDefaults` | `workflow-catalog.ts:171-193`, keyed by knob, shares `checkValueAgainstSpec` | ✅ |
| ARCH-064 inv (5) — pre-eval source bound before `runInNewContext` | `workflow-meta.ts:57` precedes `:67` | ✅ |
| ARCH-068 — `runParams` **required**, no `?`, one production build site | `agent-executor.ts:134`; `run-manager.ts:855` | ✅ |
| ADR-006 — `session-options-builder.ts` stays unwired | zero `src/` importers | ✅ |
| ARCH-070 / A-5 — label-scoped sanitize, untruncated `name@version` in body, workflow in fingerprint | `github/issue-reporter.ts` | ✅ |
| ARCH-065 — purity of both new modules | no I/O / clock / VM / randomness in `params/*.ts` | ✅ |
| QD-CONS-1 (routed by IMPL-141) — `workflow_agent_log` description vs DES-105 | `server.ts:373` names exactly effort / effortApplied / timeoutMs / provenance, no dropped fields | ✅ **already clean — close it** |

## Declared residuals — verified as declared, counted as 0

- **Catalog without `ceilings`** (`workflow-catalog.ts:68`, `:171`): `_ceilings` optional ⇒ registration
  ceiling skipped entirely. Confirmed; `server.ts:1156` always supplies the shared object, so no shipped
  deployment has the split. IMPL-141's rationale (a third `DEFAULT_CEILINGS` copy would be worse) stands.
- **`DEFAULT_CEILINGS` duplicated** at `run-manager.ts:110` and `mcp-facade.ts:20`. Confirmed, values
  identical, both fail-closed.
- **Self-inflicted resume refusal:** a caller who literally types `‹secret:` into `appendPrompt` makes
  their own run unresumable (`hasSecretMarker` is a prefix test). Fail-closed, caller-scoped, correct
  direction — noted, not filed.
- **Iter-drift trace pairs** (DES-088/DES-066 vs IMPL-140): the declared false positives; unchanged.

---

## Verdict

**Not consistent — 12 violations: 2 HIGH, 4 MED, 6 LOW.** The v21 *wiring* is in genuinely good shape:
every invariant the three send-backs were filed about now holds at its code anchor, and the P-A1 wire
shape is correct against both vendored SDKs. What survives is the seam the send-backs never looked at
— **the parser's own input validation** (A1, A4), **the cost of its rejection path** (A2), and four
places where the architecture describes a control the code does not run (A3, A5, A6) or a field the
code no longer has (A8..A12). A1 and A2 should not ship; the rest can be routed as amendments.
