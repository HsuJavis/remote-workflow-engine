# Gate 8 review (pass 3) — Adversarial architecture group

**Lens:** (a) security — authn/authz correctness, secret protection, attack surface; (b) scalability &
performance — state storage, horizontal scaling, concurrency/consistency of failure counting;
(c) testability — module boundaries, injectable dependencies, unit/integration reachability.
**Tie-break:** Karpathy simplicity-first (minimum architecture that solves the problem, nothing speculative).

**Iteration under review:** v21 — ARCH-064..070 + ADR-001..008 (REQ-090..095), IMPL-129..140.
**Compared against:** `02-architecture.md` (v21 section, as amended by IMPL-139 B5 and IMPL-140 R-G6/G7/G8)
and `06-impl-log.md` v21 entries.
**Baseline diff:** `git diff 637b86e..HEAD -- src/` — 16 files, +1109/−127. Every changed `src/` file is
named on some IMPL's `files:` line; **no undeclared file changed.** Working tree clean at `50a2a36`.
**Scope:** only files listed on v21 IMPL `files:` lines, plus the modules they touch at a boundary
(`harness-defaults.ts`, `secret-resolver.ts`, `submission-validator.ts`, `default-aliases.ts`,
`sandbox/guards.ts`). No whole-tree scan.

**This is the third adversarial pass.** Passes 1–2 produced `07-review.md` §4 (B1..B5) and §R2
(R-G1..R-G10), closed by IMPL-139/IMPL-140. Every R-G closure was re-verified in code at HEAD (see
*Checked and clean*). The findings below are **new**: two of them (A2, A3/A4) are the same defect
*shape* as a closed finding surfacing at the opposite end of the same seam, which is the characteristic
way this codebase's fixes have been incomplete — R-G1 itself was born as a regression in B2's fix.

---

## Headline

**One HIGH.** A single shared `EFFORT_PROFILES` row (`{ anthropic: { param: 'effort' } }`) is consumed
by two clients whose wire contracts are **not the same shape**, so one `param` string cannot be correct
for both — and it is wrong for the REST one. On the Claude Agent SDK client the name happens to be
right (`effort` is a real field on the SDK's `Options` type). On the `LiteLLMGatewayClient` the same
string is spread **top-level into the Anthropic Messages request body**, where effort is not a
top-level parameter at all — it belongs inside `output_config`. So every anthropic-provider call
carrying an effort override on the REST/proxy path sends an unknown parameter and fails
`400 → terminal`, while the harness descriptor records
`effortApplied: {param:'effort', value:'max'}` — a confident claim of success. ARCH-069's stated
defence ("the **same returned object** is both placed on the outbound request and recorded in the
descriptor — never a parallel lookup … kills the false-success mode REQ-093 forbids") guarantees the
record matches the *intent*, not that the field name is real **or that it means the same thing at both
call sites**, so the one architectural control designed for exactly this failure does not cover it.
The mock tier cannot see it (UT-101 asserts only that `low` and `max` produce *different* bytes against
a stubbed `fetchImpl`), and the real tier never ran (VAL-103's `HAS_PROVIDER` case skipped, and Ollama
has no profile entry, so even a live Ollama run would exercise `applied:false`).

**Four MEDIUM**, all on the registration↔admission seam: the alias vocabulary is still asymmetric at
the *registration* end (R-G3's shape, other side); a declared `effort`/`appendPrompt` default is
accepted, persisted, and then never read; a declared `model` default bypasses the alias validation that
runs one block earlier; and the bound-checker is now implemented twice, against ARCH-064's explicit
prohibition.

**Four LOW**, three of them the doc-drift items IMPL-140 explicitly parked "for the next reviewer to
route" — routed here rather than dropped.

**No finding on the scalability/performance lens.** v21 adds one column to a row-read the run path
already performs, one pure fold per admission, one pure resolve per dispatch, and one JSON column
written once at `createRun`. Consistency of the register-vs-submit race is bought by snapshotting
(ADR-002), not locking; `CallKey` is untouched, so the deploy invalidates no resume cache. This is
genuinely the cheap option and I could not find a hot path it regresses.

---

## A1 — HIGH — one shared `EFFORT_PROFILES.param` is spread top-level into the Anthropic Messages body, where effort lives inside `output_config`; every effort-bearing anthropic call on the REST/proxy path fails `terminal` while the descriptor records success

**Violates:** ARCH-069 (REQ-093 — "the effort value must be visible on the wire … two runs at `low` vs
`max` differ on the outbound request"), ARCH-068 (`effortApplied` tri-state must keep "silently
dropped" and "never asked for" distinguishable), DES-106.

**Evidence**

- `src/gateway/client.ts:32` — `const EFFORT_PROFILES … = { anthropic: { param: 'effort' } };`
- `src/gateway/client.ts:126` — `effortBodyFields(applied)` → `{ [applied.param]: applied.value }`
- `src/gateway/client.ts:156` — direct fetch to `https://api.anthropic.com/v1/messages`:
  `body: JSON.stringify({ model, max_tokens: 1024, messages: [...], ...effortBodyFields(applied) })`
  → wire body `{"model":…,"max_tokens":1024,"messages":[…],"effort":"max"}`
- `src/gateway/client.ts:293` — the same spread on the LiteLLM-proxy branch (LiteLLM either forwards
  the unknown param through to the provider or drops it depending on `drop_params` — a 400 or a silent
  no-op, both failure modes of the same class)
- `src/gateway/claude-agent-sdk-client.ts:581` —
  `if (applied?.applied) (options as unknown as Record<string, unknown>)[applied.param] = applied.value;`
- `src/agent-executor.ts:418` — the descriptor is decorated from the same `applied` object regardless:
  `effortApplied: applied.applied ? { param: applied.param, value: applied.value } : { reason: … }`

The correct Messages API shape is `output_config: { effort: "low"|"medium"|"high"|"xhigh"|"max" }`
(GA, no beta header) — effort is a member of `output_config`, **not** a top-level request parameter.
A top-level `effort` is an unknown parameter.

**Verified, and it is the split that makes this a design defect rather than a typo.** The Claude Agent
SDK's `Options` type *does* declare `effort?: EffortLevel`
(`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1612`, inside `export declare type Options`
beginning at `:1270`), so `claude-agent-sdk-client.ts:581` happens to be **correct**. The REST body at
`client.ts:156/293` is **not**. One `EFFORT_PROFILES` row is therefore feeding two clients whose wire
contracts differ in shape, and a single `param: string` cannot express both — the profile encodes a
*name* where the two consumers need a *placement*. ARCH-069's premise ("adding a provider with a new
effort dial is **config**, not code") only holds if the config value means the same thing at every
consumption site; here it does not, and nothing in the type system says so — note that `:581` reaches
its correct outcome through a `as unknown as Record<string, unknown>` cast that would equally have
accepted a wrong name.

**Failure scenario.** Default deployment (`DEFAULT_ALIASES`, anthropic provider), LiteLLM gateway —
the gateway `main.ts` selects unless `gatewayChoice === 'sdk'`. Caller submits
`workflow_run({name:'x', overrides:{effort:'high'}})`. Admission accepts (`high` ≤ `maxEffort`).
Dispatch: `mapEffort` returns `{applied:true, param:'effort', value:'high'}`; the body becomes
`{"model":…,"max_tokens":1024,"messages":[…],"effort":"high"}`. The API rejects the unknown top-level
parameter with `400 invalid_request_error`; `client.ts:157` maps `!res.ok && status < 500` to
`{ok:false, reason:'terminal'}`; the agent call yields `null` after retries. **Every** anthropic agent
call in that run fails, for the whole run, because the snapshot is run-immutable (ADR-002) — and
`workflow_agent_log(...).harness.effortApplied === {param:'effort', value:'high'}` tells an operator
auditing "did my effort reach the model?" that it did.

**Why the architecture's own control missed it.** ARCH-069/DES-106 defend against *record ≠ applied*
by object identity. Object identity is preserved here perfectly — and the record is still false,
because both the record and the wire read the same `param` string, which is right for one client and
wrong for the other. The invariant needed is "the profile's `param` names a field the target client's
transport actually accepts, at the placement it accepts it", and nothing asserts it.

**Testability lens — why the whole test pyramid is blind to it.** UT-101's direct-fetch case asserts
that the `low` and `max` bodies *differ* and that the effort-absent body is byte-identical to pre-v21;
both hold with a wrong field name, against an injected `fetchImpl` that never validates the payload.
UT-020's SDK-side mirror asserts only that the mapped value lands on the built `Options` object — also
true of any string. No test on either client compares the emitted shape to the transport's contract.
The one test class that could catch it is the Gate 7.5 real tier, and VAL-103's `HAS_PROVIDER` case
**skipped** (`IMPL-135`: "skips cleanly in this environment (no `OLLAMA_BASE_URL`)"). Even had it run,
`EFFORT_PROFILES` has no `ollama` entry, so the assertion would have exercised `{applied:false}` and
never touched the anthropic mapping. **REQ-093's load-bearing clause — "actually conveyed to the model
backend" — therefore has no real-tier green**, which is the mock hard-rule Gate 7.5 exists to enforce.

**Security lens (secondary).** ADR-005 accepted *cost* amplification by a non-owner within the
ceilings. It did not accept *availability* denial: on a LiteLLM-gateway deployment any authenticated
principal can make every anthropic-backed agent call of any workflow fail terminally with a two-field
JSON override, at zero cost to themselves. That is a strictly worse residual than the one recorded, and
it is reachable inside the ceilings (`effort:'high'` is at, not above, the default `maxEffort`).

**Suggested direction (not prescriptive).** Make the profile carry the *placement* as well as the key
— the REST body needs `output_config: { effort: … }`, the SDK client needs a top-level `Options.effort`
— and pin each with a test that asserts the emitted shape against that transport's documented contract
rather than against "different from the other one". Note `src/params/resolve.ts:147`'s unwired
`ProviderEffortProfile` is already the richer per-provider table shape that would make this a data edit;
see *Carried forward*. The tri-state's honesty rests on a claim about two external contracts, so each
claim needs its own assertion.

---

## A2 — MEDIUM — registration and admission are still fed **different alias tables**; ARCH-064's "the ONE alias predicate … shared by the registration-time and admission-time rungs" does not hold on the documented default deployment

**Violates:** ARCH-064 (`isKnownAlias` as the single shared predicate), ARCH-067 ("fail-closed
registration … a `params` block naming … a `model` enum entry that is not a known alias is rejected
and **nothing is stored**"), and the parity claim IMPL-139 B4 recorded.

**Evidence**

- `src/server.ts:1142` — catalog: `aliasNames: config?.aliases ? new Set(Object.keys(config.aliases)) : undefined`
- `src/workflow-catalog.ts:117` — `parseMetaParams(script, this._aliasNames ?? new Set())`
- `src/params/contract.ts:72` — `if (aliasNames.size === 0) return true;` → the check is a **no-op**
- `src/server.ts:1196` — run manager: `const aliasNames = new Set(Object.keys(config?.aliases ?? DEFAULT_ALIASES));`
- `src/run-manager.ts:424` — admission enforces against that non-empty table

This is R-G3 at the other end of the same seam. R-G3 fixed the *admission* feed to read
`DEFAULT_ALIASES`; the *registration* feed was left as `undefined → new Set()`.

**Failure scenario.** Default deployment (no `aliases` in `rwe.config.json` — `main.ts:36-38` documents
this as the normal case). Author registers a script whose `meta.params.knobs.model.enum` is
`['gpt-9-turbo']`. Registration succeeds and stores it. `workflow_get` serves
`params.knobs.model.enum: ['gpt-9-turbo']` as a discoverable allowed value (ARCH-067's whole point).
A caller obediently submits `overrides:{model:'gpt-9-turbo'}` — `checkValueAgainstSpec` passes (it *is*
in the author's enum), and `run-manager.ts:424` then refuses `UNKNOWN_ALIAS`. **The advertised bound
and the enforced bound disagree** — the exact property IT-083's A-3 case pins for `maxTimeoutMs` and
that nothing pins for aliases. The workflow is registered and permanently unrunnable at that model,
with no failure at the moment the mistake was made.

**Note on the "empty table ⇒ accept everything" rule (D-AUTH-5-B).** The rule is sound where the
engine genuinely has no alias vocabulary. It is not sound here, because the engine *does* have one —
`DEFAULT_ALIASES` — and dispatch resolves against it. `isKnownAlias` being one function is not the
same as both callers being given the same table; the parity has to be established at the wiring, which
is the half R-G3 fixed once already.

---

## A3 — MEDIUM — a declared `knobs.effort.default` / `knobs.appendPrompt.default` is validated, normalized into the `defaults` column, and then **never read**; the declared default is inert and the descriptor reports "never requested"

**Violates:** ARCH-067 note + adjudication A-2(c) ("a declared default with no corresponding
`defaults.<k>` is accept-and-normalize (written into the stored `defaults` column) **so the served
default is always DERIVED from one source and the two cannot diverge**"), ARCH-068 (`effortApplied`
tri-state), REQ-090.

**Evidence**

- `src/workflow-catalog.ts:130-142` — the loop runs over **every** knob in
  `paramsResult.value.knobs`, and `effectiveDefaults[key] = spec.default` for any key not already
  present in `defaults`
- `src/harness-defaults.ts:8-14` — `HarnessDefaults` = `{model?, tools?, skills?, timeoutMs?, prompt?}`
  — no `effort`, no `appendPrompt`
- `src/harness-defaults.ts:30` — `KNOWN_KEYS = new Set(['model','tools','skills','timeoutMs','prompt'])`
- `src/params/resolve.ts:38-51` — `defaultRunParams()` reads only `model/timeoutMs/prompt/tools`, with
  the comments `effort: 'engine', // HarnessDefaults carries no author-side effort` and
  `appendPrompt: 'engine', // no author-side appendPrompt exists`

**Failure scenario.** Author writes
`export const meta = { params: { knobs: { effort: { type:'enum', enum:['low','high'], default:'high' } } } }`.
Registration accepts and writes `{"effort":"high"}` into the `defaults` column. Three consequences:

1. **The declared default is inert.** `defaultRunParams` never reads it, so a run with no `overrides`
   dispatches with `effort: undefined`, `mapEffort` returns `undefined`, and the descriptor omits
   `effortApplied` entirely — the tri-state's "absent because not requested" branch. The author did
   request it. This is the same silent-no-op class ARCH-069 and the whole iteration exist to repair,
   reintroduced through the normalization path.
2. **A-2(c)'s stated guarantee is false for two of the four knobs.** The served default (from
   `workflow_get`'s `params`) and the applied default (from `defaultRunParams`) *do* diverge, and the
   `defaults` column — named as the single source — is not consulted for these keys at all.
3. **The stored row now carries a key D-AUTH-5-A forbids.** `validateHarnessDefaults` ran at
   `workflow-catalog.ts:109` *before* the loop at `:129` inserted `effort`. So the documented
   discover→reuse round-trip (`workflow_get` → edit → `workflow_register({name, script, defaults})`)
   now fails with `HARNESS_DEFAULTS_INVALID: Unknown harness defaults key: "effort"` on a `defaults`
   object the engine itself produced.

The clean shapes are either to reject a `default` on a knob no rung can apply, or to widen the
snapshot's author side. Silently persisting it into a type that cannot represent it is the one option
that satisfies neither.

---

## A4 — MEDIUM — a declared `knobs.model.default` bypasses D-AUTH-5-B alias validation, because normalization runs **after** `validateHarnessDefaults`

**Violates:** ARCH-067 ("fail-closed registration [reuses the ARCH-062/D-AUTH-5-E rule] … a typed
error and **nothing is stored**"), ARCH-062 / D-AUTH-5-B.

**Evidence**

- `src/workflow-catalog.ts:108-113` — `validateHarnessDefaults(defaults, this._aliasNames)` runs on
  the **caller-supplied** `defaults` only
- `src/workflow-catalog.ts:129-142` — `effectiveDefaults[key] = spec.default` afterwards
- `src/workflow-catalog.ts:157,168` — `effectiveDefaults` (not `defaults`) is what gets serialized and
  stored
- `src/params/contract.ts:173-179` — `parseParamContract` alias-checks `spec.enum` entries only;
  `spec.default` is never checked against `aliasNames`

**Failure scenario.** Configured-alias deployment (so D-AUTH-5-B is live). Author registers with
`meta.params.knobs.model = { type:'string', default:'not-an-alias' }` and no `defaults` argument.
`validateHarnessDefaults` sees `{}` and passes. The loop injects `model:'not-an-alias'` into the stored
`defaults`. Registration reports success. Every subsequent named run of that workflow is refused at
`run-manager.ts:424` with `UNKNOWN_ALIAS` — the R-G2 backstop catches it, which is why this is MEDIUM
and not HIGH, but the register-time control that was supposed to make it impossible-by-construction
did not fire, and the operator learns about it at run time instead of at registration.

---

## A5 — MEDIUM — the value/bounds checker is implemented twice; ARCH-064's "cannot drift into three copies" is already partly false

**Violates:** ARCH-064 note ("ONE pure, dependency-free module is the single place that knows the
contract vocabulary … so the locked-key list and the **bound-checking rules** cannot drift into three
copies (quality R-2/R-3)").

**Evidence**

- `src/params/contract.ts:193-228` — `checkValueAgainstSpec(param, value, spec)`: type / enum / min /
  max, each with its own `PARAM_OUT_OF_RANGE` message and a truncated `supplied` echo
- `src/workflow-catalog.ts:38-45` — `violatesOwnSpec(value, spec)`: type / enum / min / max, boolean
  return, one generic `PARAM_CONTRACT_INVALID` message
- `src/workflow-catalog.ts:36-37` — the rationale in-code: *"Self-contained (no contract.ts import —
  TASK-099 stays out of TASK-097's file)"*

Adjudication A-2 (`04-design.md:2739`) authorized the cross-validation **behaviour** — three named
cases — not a second implementation of the predicate. The stated reason is a task-file boundary, which
is a process constraint, not an architectural one; ARCH-064's whole justification is that the vocabulary
lives in exactly one module, and `workflow-catalog.ts` already imports that module (type-only, per
adjudication A-1) so the import edge is not the objection.

The copies already differ: the catalog's has no `MAX_ENUM_MEMBERS` awareness, no free-text truncation,
and does not consult `effectiveBounds`, so a knob default is checked against the author's raw spec
while a user override is checked against `min(author, ceiling)`. Today that difference is intentional
(ADR-005 — ceilings bind the user rung only). The hazard is that it is *invisible*: the next change to
either rule has no test that compares them, and the two rejection taxonomies are exercised by different
suites (UT-098 vs IT-081).

**Karpathy tie-break.** The minimum architecture here is one exported predicate with an explicit
`{ceilings?}` parameter, called from both sites. Two implementations is more code, not less.

---

## A6 — LOW — the `‹secret:` marker grammar is duplicated into `run-manager.ts`, and the duplicate fails **open**

**Violates:** the module boundary that makes `secret-resolver.ts` the sole owner of the marker grammar
(the boundary R-G5 was filed against); weakens ARCH-066 inv-2.

**Evidence**

- `src/secret-resolver.ts:101` — the only producer: `out = out.split(v).join(`‹secret:${name}›`)`
  (no marker constant, predicate, or matcher is exported)
- `src/run-manager.ts:538` — the only consumer of the grammar outside that module:
  `if (JSON.stringify(entry.effectiveParams).includes('‹secret:'))`

IMPL-140 records R-G5 as closed "by subsumption" when `unredactBestEffort` was deleted. The *inverter*
went; the **grammar literal stayed**, now in a detector rather than an inverter. The residual risk
inverted with it: an inverter that stops matching fails closed (nothing restored), whereas a **detector**
that stops matching fails **open** — a future change to the marker format in `secret-resolver.ts`
silently disables the `PARAM_SECRET_UNAVAILABLE` guard, and ARCH-066 inv-2's "byte-identical to
admission, or a typed refusal — never a silent substitution" quietly becomes "dispatch the marker".
Exporting a `hasSecretMarker(v: unknown): boolean` from `secret-resolver.ts` makes the two move
together; two greps and one export.

---

## A7 — LOW — ARCH-066 inv-2 has an undocumented exception: the legacy NULL-snapshot resume path **does** re-resolve from the current catalog row

**Violates:** ARCH-066 invariant (2) as written ("it reads the **pinned snapshot** rather than
re-resolving from the current catalog row (`run-manager.ts:523` does a fresh `catalog.get`; without
this, a re-register between start and resume silently changes effective params with no cache miss to
reveal it)") and the `workflow_resume` row of the v21 interface table.

**Evidence**

- `src/run-manager.ts:615-619` — on rehydrate, `const registered = await this._catalog.get(spec.name);
  … registeredDefaults = registered.defaults;` — the fresh `catalog.get` the invariant names
- `src/run-manager.ts:633` — `const effectiveParams = (await this._store.getEffectiveParams(runId)) ??
  defaultRunParams(registeredDefaults);`

So for any run whose `effective_params` column is NULL (a pre-v21 row), resume resolves from the
**current** catalog row — precisely the behaviour inv-2 forbids. IMPL-133 declares the fallback openly
("today's behaviour, never a crash") and it is the right engineering call for deploy-day continuity;
the defect is that ARCH-066 and the interface table state the invariant without its exception, so a
future reader takes "never re-resolves" as unconditional. One clause in inv-2 closes it. Window is
narrow and one-directional (pre-v21 rows only), hence LOW.

---

## A8 — LOW — the three doc-drift items IMPL-140 parked "for the next reviewer to route" — routed, and all three still reproduce

IMPL-140 declared these out of §R2's pinned scope and left them for this pass. Verified at HEAD:

1. **QD-CONS-2 — ARCH-064 note (1) names a function that does not exist.**
   `02-architecture.md` ARCH-064 note: *"`parseUserOverrides` is the ONLY constructor from caller
   data"*. `grep -rn 'parseUserOverrides' src/` → **0 hits**. The real symbol is
   `validateUserOverrides` (`src/params/contract.ts:231`). The *claim* is true of the real function;
   the name is a phantom, and it is the name a reader would grep for when auditing ADR-001's
   by-construction guarantee.

2. **QD-OBS-1 — the v21 process-view diagram still emits a field adjudication B-2 dropped.**
   `02-architecture.md:913` — `AE->>AE: harness event {model, effort, effortApplied, provenance,
   appendPromptBytes}`. `appendPromptBytes` is absent from `src/types.ts:224-242` and from all of
   `src/`. IMPL-139 B5 corrected ARCH-068's api line, note, and the interface-table row; the mermaid
   was missed.

3. **QD-CONS-1 — `workflow_agent_log`'s tool description does not describe the fields v21 added.**
   `src/server.ts:373` still describes only `message/tool_call/tool_result/usage` and redaction; it
   never mentions `effort`, `effortApplied`, `timeoutMs`, or `provenance`. ARCH-068 makes provenance
   *the* observable for the wiring-miss class, and ARCH-067 explicitly invokes the ARCH-051
   self-describing-schema discipline for exactly this reason ("the `effort` no-op being repaired here
   was precisely a docs/behavior split, so the fix must not create a new one"). This is a new — if
   small — docs/behaviour split on the one surface v21 enriched.

---

## A9 — LOW — an invalid `maxEffort` in config silently disables the effort knob entirely; `isEffort` exists in the same module and is not used at the config boundary

**Violates:** ARCH-066 inv-6 in spirit ("a missing key uses the fail-closed default" — absence is
handled, an invalid *value* is not).

**Evidence**

- `src/main.ts:164` — `maxEffort: fileConfig.maxEffort` (forwarded verbatim from parsed JSON)
- `src/server.ts:1187` — `maxEffort: config?.maxEffort ?? 'high'` (no validation)
- `src/params/contract.ts:109-113` — `boundEffort`: `authorEnum.filter((e) => EFFORT_RANK[e] <= ceilingRank)`
  with `ceilingRank = EFFORT_RANK[ceilings.maxEffort]`
- `src/params/contract.ts:86-88` — `isEffort` is exported from the same module and is used at
  `agent-executor.ts:312`, but never at the config boundary

**Failure scenario.** Operator writes `"maxEffort": "highest"` in `rwe.config.json`.
`EFFORT_RANK['highest']` is `undefined`; every `EFFORT_RANK[e] <= undefined` is `false`; the effective
enum becomes `[]`. **Every** `overrides.effort` is then refused `PARAM_OUT_OF_RANGE`, and
`workflow_get` advertises `params.knobs.effort.enum: []`. No startup error, no log line — a typo in one
config key silently removes a documented feature engine-wide.

**Lens conflict, stated.** ADR-005's refuse-never-clamp discipline is correct for *caller* values
(silent alteration is the class v21 repairs). Applied transitively to an *operator* value it becomes
silent total denial, because a bad ceiling refuses everything rather than announcing itself. The
resolution is not clamping — it is validating at the boundary the value enters (`isEffort` in
`composeConfig`/`createServer`, fail fast or fall back to the documented default with a log line).

---

## Cross-lens conflicts, surfaced rather than resolved

1. **Security ⟂ availability — refusal-only resume (ARCH-066 inv-2).** Correct for secrets, and R-G1's
   reasoning is sound. The accepted cost is that any run whose `appendPrompt` (or author `prompt`) ever
   contained a live secret becomes **permanently unresumable** after a process restart, and a caller
   can brick their own long run by merely *typing* the public marker grammar into `appendPrompt`. Not
   filed as a violation — ARCH-066 chose this knowingly and documents it — but it is the reason A6's
   fail-open detector matters more than its severity suggests: the guard is the only thing standing
   between "typed refusal" and "dispatch a placeholder", and its correctness depends on a string
   literal in a different module.

2. **Security/auditability ⟂ consumability — refuse-never-clamp (ADR-005), see A9.** The same rule that
   makes caller-side refusals auditable makes an operator-side typo invisible. Two different actors,
   two different right answers; the architecture applies one rule to both.

3. **Karpathy ⟂ task boundaries — A5.** "Keep TASK-099 out of TASK-097's file" is a real process
   constraint that produced more code, a second rejection taxonomy, and a divergence no test compares.
   Where a process boundary and a module boundary disagree, ARCH-064 says the module boundary wins;
   the implementation chose the other way and the impl log records it as deliberate.

4. **Testability ⟂ the mock hard-rule — A1.** Every layer of the pyramid passed on a wrong wire field
   because each layer asserts a property that a wrong field name satisfies (bytes differ; object
   identity holds; type-checks pass). The only tier that could disagree is the real one, and it was
   `HAS_PROVIDER`-gated into a skip. A contract with an external API cannot be pinned by a test whose
   only oracle is the code under test.

---

## Checked and clean (spot-verified this pass, not carried on trust)

- **R-G1** — `grep -rn 'unredactBestEffort' src/` → **0**. `run-manager.ts:538-540` refuses typed
  `PARAM_SECRET_UNAVAILABLE`; no restore path exists. The scan covers the **whole** rehydrated snapshot
  (`JSON.stringify(entry.effectiveParams)`), not just `appendPrompt`.
- **R-G2** — `run-manager.ts:424` checks the **effective post-merge** model, after `mergeRunParams`
  (`:416-418`) and before `createRun` (`:439`). Un-overridden registered defaults are covered.
- **R-G3 (admission end)** — `server.ts:1196` reads `config?.aliases ?? DEFAULT_ALIASES`; the run
  manager and dispatch now see the same table. *(The registration end is A2.)*
- **R-G9** — `agent-executor.ts:436-439`: `redact()` first, then
  `capPrompt(redacted.descriptor.prompt)`. The cap is applied **unconditionally**, outside the
  `secretValueProvider` branch. `redactHarness` (`:36`) passes the prompt through uncut.
- **R-G10** — `grep -rn "!== 'harness'" src/` → only the two explanatory comments
  (`agent-executor.ts:174,452`) and `mcp-facade.ts:264`'s unrelated display filter. Both redaction-skip
  guards are gone; the harness sink gets exactly one `redact()`.
- **ADR-002 / `CallKey`** — `git diff 637b86e..HEAD -- src/run-manager.ts` contains **no hunk** at or
  near the `CallKey` construction (`run-manager.ts:812`); it is byte-identical. Resolution happens
  downstream in `agent-executor.ts`. No suspended run's journal is invalidated by the upgrade.
- **`overrides` is an argument, never a `RunSpec` field** — `start(spec, overrides?)`
  (`run-manager.ts:293`); `mcp-facade.ts:109` threads `a.overrides` as the second argument. No second
  persist sink.
- **Trigger paths** — `scheduler.ts:219`, `webhook-registry.ts:137`, `continuation-store.ts:148`,
  `server.ts:1282` all enter through the same `RunManager.start()`, supply no `overrides`, and
  therefore get `defaultRunParams` **and** the R-G2 effective-model check. No admission bypass.
- **`workflow_resume`** — `mcp-facade.ts:175` rejects the mere *presence* of an `overrides` property
  via `hasOwnProperty`; no absent-vs-`{}`-vs-equal semantics.
- **MCP surface drift-lock** — `server.ts:327-334`: `overrides` is `additionalProperties:false` with
  exactly `model/effort/timeoutMs/appendPrompt`, and the `effort` enum
  `['low','medium','high','xhigh','max']` matches `EFFORT_RANK` / `isEffort` exactly.
- **composeConfig wiring (the 5×-repeat bug class)** — `main.ts:162-164` forwards all three ceiling
  keys, `server.ts:1184-1187` builds ONE `ceilings` object passed to both `RunManager` (`:1197`) and
  `McpFacade` (`:1214`), and UT-033 carries the three rows. The same pass also closed four
  *pre-existing* misses (`maxBlobBytes`, `webhookDbPath`, `casDir`, `continuationDbPath`).
- **Catalog** — `ON CONFLICT … params = excluded.params` present (`workflow-catalog.ts:166`), so a
  re-register cannot leave a stale contract; `owner` still deliberately omitted. `params` migration is
  idempotent via the existing `existingCols` block. `ParamContract` is a **type-only** import
  (`:30`), per adjudication A-1 — no runtime edge, and this file is not sandbox-child-loaded.
- **Pre-eval bound** — `workflow-meta.ts:57-64` measures `MAX_META_LITERAL_BYTES` on the matched
  literal text **before** `runInNewContext` (`:67`). Order is correct.
- **Read surfaces** — `mcp-facade.ts:24` `readParams()` = `effectiveBounds(stored ?? canonicalContract(),
  ceilings)`, used by both `workflow_get` (`:217`) and `workflow_list` (`:196`). Neither can serve a
  null or unbounded contract, and a lowered ceiling takes effect with no re-registration.
- **Admission is genuinely pre-durable** — the rung sits at `run-manager.ts:409-431`, above
  `createRun` (`:439`), `runWorkspace` (`:440`), `mkdirSync` (`:476`) and the sandbox construction
  (`:492`). Rejection leaves zero run rows and zero workspace directories. No existing rung moved.
- **`thinkingFor` remains the sole writer of `options.thinking`** — the effort mapper writes a
  different key (`claude-agent-sdk-client.ts:581`); the Gate 7.5 round-3 400-after-4-minutes defect is
  not re-opened. Verified further: on this client the key it writes is also the *right* one —
  `Options.effort` is a real field (`claude-agent-sdk/sdk.d.ts:1612`). A1 is the REST client only.
- **`appendPrompt` framing** — `resolve.ts:123-142`: fixed `<user-instructions untrusted="true">`
  frame, appended last, and byte-identical to `${systemPrompt}\n\n${prompt}` / bare `prompt` when both
  new segments are absent. Byte cap checked against the raw ceiling *before* any generic spec check
  (`contract.ts:261-271`), so oversize caller text never reaches a `detail` object.
- **Issue reporter** — `workflowLabel()` (`issue-reporter.ts:169`) is used at **both** the report
  (`:438`) and list (`:479`) sites; `issueFingerprint` appends `|workflow` **only when present**
  (`:160`), so the absent-`workflow` output stays byte-identical to pre-v21.
- **IMPL-137 cleanup** — `grep -rn 'resolveHarnessParams' src/` → **0**. The `Partial<HarnessDefaults>`
  merge shape ADR-001 warned about is gone from the tree, not merely unused.

---

## Carried forward — recorded debt / accepted residuals, NOT counted as violations

- `src/params/resolve.ts:150` `mapEffort` + `ProviderEffortProfile` have **zero production callers**
  (the wired pair is in `gateway/client.ts`). Recorded as F5/QD-2 by IMPL-138 with an explicit
  decision not to remove it in a surgical pass. *(Worth noting alongside A1: the `resolve.ts` copy is
  the richer `{param, values: Record<Effort, unknown>} | {noop, reason}` shape — still a name and not a
  placement, so it would not by itself have prevented A1, but it is the closer starting point for the
  per-provider table A1 needs. Two divergent profile types is itself the drift ARCH-064 warns about,
  one module over.)*
- `session-options-builder.ts` stays fenced with zero `src/` importers (ADR-006), structurally pinned
  by a UT-101 test.
- The two declared iter-drift trace gaps (`DES-088（v14）` / `DES-066（v11）` vs IMPL-140 v21) — an
  accepted class with v15 precedent.
- ADR-005 cost amplification, ADR-007 `appendPrompt` prompt-injection influence over the author's
  granted tool surface, ADR-008 no rejection telemetry / non-owner descriptor masking deferred to v22.
  *(A1 adds an availability dimension to the ADR-005 residual that was not part of what was accepted —
  filed there, not here.)*
- v15 residuals unchanged and out of v21 scope: run-lifecycle mutation ungated for non-owners;
  `/api/*` + dashboard unauthenticated while surfacing `principal:<email>`.

---

## Verdict

**consistent: no — 9 violations (1 HIGH, 4 MEDIUM, 4 LOW).**

All ten §R2 findings are genuinely closed in code, and the redaction/resume/CallKey core is now in good
shape. The HIGH is not a regression of a previous fix — it is the original ARCH-069 wiring, correct in
structure and wrong in the one string that has to match an external API contract, and it is invisible to
every test tier that actually ran. A2/A3/A4 are the same registration↔admission seam surfacing three
more times; A5 is the single-source rule the seam was supposed to obey.
