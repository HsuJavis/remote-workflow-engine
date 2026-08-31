# Design panel — Adversarial group (interface-contract / boundary-error / testability), round 1

**Feature:** 001-remote-workflow-engine · **Iteration:** v21 (REQ-090..095 → ARCH-064..070, ADR-001..008)
**Stage:** Gate 3+4 (Tasks + Detailed Design), debate round 1 — independent proposal
**Lenses carried:** (a) interface-contract, (b) boundary/error, (c) testability. Tie-breaker: Karpathy
simplicity-first (minimum design that solves the problem; no flexibility the requirement did not buy).
**Inputs read:** `01-requirements.md` (v21 slice, lines 831–888), `02-architecture.md` (v21 slice, lines
710–978), `state.yaml` `tech_stack` (lines 11–51). `03-tasks.md` for v21 does not exist yet — a dedicated
task-splitting section is included where my lenses constrain the split.

---

## 0. Altitude determination (system vs agent) — done FIRST, per the panel brief

From `tech_stack` + the v21 requirements this project is **both**, and the two altitudes land on different
parts of this slice. I apply both, explicitly labelled, and do not force either where it is irrelevant.

- **System altitude (the engine itself).** Node 22.6+/TypeScript/SQLite/vitest; a hand-rolled JSON-RPC
  HTTP server, a run store, a catalog, a sandbox. Everything in ARCH-066/067 (admission ladder, a new
  column, a persisted snapshot, migrations, resume) is ordinary systems design and is judged as such:
  transactional fail-closed writes, no partial state, deterministic replay, injectable clock/storage.
- **Agent altitude (the consumers).** Every v21 surface is consumed by *agents*: `workflow_run`'s
  `overrides` arrives from an MCP client, `workflow_get`'s contract exists so a caller **learns what it
  may tune without reading the script**, and the error payloads exist so the caller **repairs its own
  call without a second round-trip** (ARCH-064 inv-3). That makes consumability and self-describing
  errors first-class *functional* requirements here, not documentation polish — and it is why my
  boundary lens spends its budget on a **total condition→code→payload table** rather than on more codes.
- **Where the two collide** — the `appendPrompt` frame (ADR-007) is an agent-altitude construct
  (instruction-provenance for a model reader) implemented with system-altitude guarantees (byte cap,
  fixed delimiters, drift-lock test). I treat the frame text as a *contract artifact*: it is
  API surface for a model, so it is version-pinned by test exactly like a schema.

Not applied: agent-altitude "self-sustainability" (self-healing/retry policy) — v21 adds no autonomous
loop; and system-altitude "replaceability" beyond the provider-profile entry ARCH-069 already names.

---

## 1. Summary

The v21 architecture is unusually good: the dominant failure modes are *silent* ones (inert wiring, a
smuggled locked key, a dishonest `effortApplied`, a poisoned resume cache, an unredacted sink) and
ARCH-064..070 makes each impossible-by-construction rather than detectable-afterwards. I have **no
architectural objection** and propose **no new modules, no new endpoints, no new abstractions**.

What I do have is **eleven places where the architecture's prose does not survive contact with the
primary source**, and each one is a coin-flip an implementer would otherwise resolve silently. Four of
them are, on my reading, defects-in-waiting rather than under-specification:

1. **`WorkflowCatalog.get()` returns `{script, version}` only** (`workflow-catalog.ts:136`) — ARCH-066's
   "the row the run path already reads carries the contract and defaults" is **not true today**, and the
   *nested* `workflow()` path uses the same narrow `get()`, so REQ-092 silently fails under composition.
2. **`options.thinking` already has a sole writer** (`claude-agent-sdk-client.ts:527` → `thinkingFor()`
   at `:325`), added to fix the shipped Gate-7.5 "Ollama 400 after ~4 min" defect. An `effort` mapper
   that writes `thinking` from a second site can re-open that exact defect on the default path.
3. **REQ-094's "appendPrompt last" is already false** for schema calls: `agent-executor.ts:312/320`
   appends an `=== OUTPUT FORMAT (REQUIRED) ===` block and a retry nudge *after* the composed prompt.
4. **`register`'s `ON CONFLICT DO UPDATE` does not update every column** (`workflow-catalog.ts:110–114`
   updates script/version/createdAt/defaults and deliberately **not** `owner`). An implementer adding a
   `params` column and copying that clause leaves a **stale contract on re-register** — silent, and
   exactly the drift class v21 exists to close.

Everything else below is refinement that *preserves* the ARCH invariants rather than contradicting them;
each deviation is labelled as such, with the invariant it preserves, because Gate 2 has passed.

---

## 2. Key points

### 2A. Interface-contract lens

**I-1 (blocking) — `catalog.get()` must be widened, and it is the design's first landing.**
Primary source: `get()` = `SELECT script, version` (`workflow-catalog.ts:136–142`); `getFull()`
(`:145–166`) is the only reader of `defaults`. ARCH-066 pins the insertion point at `run-manager.ts:349`
(`this._catalog.get(spec.name)`) and asserts "no second query". As written that is unimplementable.
Callers of the narrow `get()`: `run-manager.ts:349` (start), `run-manager.ts:523` (resume rehydrate),
`run-manager.ts:~688` (**nested `workflow()`**), `submission-validator.ts:83` (existence probe).
Options: (a) widen `get()` to `{script, version, defaults?, params?}`; (b) point `start()` at `getFull()`.
**Proposal: (a).** Every call site destructures, so widening is source-compatible; `getFull()` additionally
returns `owner`, which the run path has no business carrying, and duplicating the row read in two shapes is
how the `defaults`-vs-`params` drift starts. `getFull()` then delegates to `get()` + owner.
*DES must state this; it is not implementer discretion, because option (b) is the tempting shortcut and it
leaves the nested path unfixed.*

**I-2 (blocking) — composition (`workflow()` nesting) semantics are unspecified, and split in two.**
Nothing in ARCH-064..070 mentions nesting; `run-manager.ts:~688` resolves the child through the same
narrow `get()` and runs it via a nested manager. Two different questions hide here:
- **Harness knobs (`model`/`effort`/`timeoutMs`): do NOT propagate.** The parent's `overrides` were
  validated against the **parent's** contract; letting them reach a child whose contract may constrain or
  differently bound the same knob bypasses the *child author's* contract — a REQ-091 hole with the same
  shape ADR-001 closes at the caller boundary. The child resolves from **its own** registered defaults.
  This is also the fix for the real, present bug: the nested path drops `defaults` entirely today.
- **`appendPrompt`: genuinely ambiguous — flagged for the synthesizer, not decided by me.** REQ-094 says
  "**any** `agent()` in that run", and nested agents *are* in the run's frame tree (REQ-045/046), which
  reads as propagate. The contract-integrity argument reads as don't. Both are defensible; what is not
  defensible is silence. **Recommendation if forced: propagate `appendPrompt` (it is additive instruction
  text, structurally powerless per ADR-007) and do not propagate the three knobs** — with one integration
  test per direction, and the provenance rung recorded as `'override'` in the child so the propagation is
  *visible* rather than inferred.

**I-3 — new `HarnessDescriptor` fields: optional on the DTO, decorated at ONE site.**
*(Refinement preserving ARCH-068's intent: required-ness moves to where `tsc` actually bites.)*
The descriptor is constructed at **two** sites with different shapes: an inline object literal in
`gateway/client.ts:289` (with its own duplicated `PROMPT_CAP=4096/HALF=2048` constants) and via
`redactHarness()` in `claude-agent-sdk-client.ts:577`. Worse, `provenance` is knowledge the **gateway does
not have**. Making `promptTruncated: boolean` required (ARCH-068's `api` line) breaks the inline literal
plus ~8 test fixtures for zero safety gain — a DTO field is not the tsc lever that catches inert wiring.
**Proposal:** (i) gateways keep emitting today's descriptor; (ii) `agent-executor.ts:347`'s `onHarness`
closure — the single place that already owns persistence and already knows the resolved params — merges
`{effort, effortApplied, timeoutMs, appendPromptBytes, promptTruncated, provenance}` before the
`appendTranscript` write; (iii) `gateway/client.ts:289` is switched to call `redactHarness()` so the
4096/2048 cap has one implementation. Result: one decoration site, both gateways covered, **no `GatewayClient` signature churn beyond
I-4's optional second `onHarness` argument**, and the new fields are optional on the wire type (many historical
records lack them anyway). ARCH-068's real lever (I-4/T-1) is untouched.

**I-4 — `mapEffort` cannot run in the executor: the provider is only resolvable inside the gateway.**
*(Refinement preserving ARCH-065's no-parallel-lookup invariant.)*
`ProviderEffortProfile` is keyed by provider; provider is resolved from the gateway's own alias map —
`gateway/client.ts:281` (`this._config.aliases[aliasName]`) and the SDK client's own alias→model/provider
resolution feeding `thinkingFor(this._config.aliases, req.opts.model)` at `:527`. So ARCH-065's "the same
returned object is both placed on the outbound request and recorded in the descriptor" cannot be satisfied
by an executor-side call. Options: (a) add `resolveTarget(alias)` to `GatewayClient` and map in the
executor; (b) **one shared pure `mapEffort` imported by both gateways, called once per invoke, and the
same object handed back to the executor** via a second `onHarness` argument
(`onHarness(descriptor, applied?)`). **Proposal: (b)** — it preserves the invariant that actually matters
(the recorded value *is* the applied value, never a re-lookup) with one translator implementation and two
import sites, and it avoids inventing a `resolveTarget` seam (a new interface method with two
implementations, which the Karpathy tie-break rejects). (a) loses because it exports alias-resolution
across a boundary purely to relocate a pure function call.

**I-5 — where a bad *script-supplied* `effort` surfaces is undefined.** ARCH-069 says such a call "rejects
typed", but `agent()` today has two distinct failure channels: **throw** (`Unknown agentType`,
`agent-executor.ts:289`) and **resolve-null** (any gateway failure). **Proposal: throw a coded
`PARAM_OUT_OF_RANGE`** from the executor before dispatch, matching the `agentType` precedent (an author
mistake is a run failure, not a null the script silently branches on), and pin it. Note the pleasant
consequence: because this is pre-dispatch and `CallKey` is built upstream at `run-manager.ts:706` from the
raw opts, ADR-002 is untouched.

**I-6 — do not hang `overrides` off `RunSpec`.**
*(Refinement preserving ARCH-066 inv-5's single-sink discipline.)*
`RunSpec` is persisted wholesale by `createRun(spec)` (`run-store.ts:136`) and read back by `getSpec()`
(`:152`) on resume. Putting `overrides` on `RunSpec` creates (i) a **second persist sink carrying caller
`appendPrompt` text** that ARCH-066 inv-5 does not name and the REQ-083 sweep would miss, and (ii) a
standing temptation on the resume path to re-merge from `spec.overrides` — the precise thing ADR-002
forbids. **Proposal: `RunManager.start(spec, overrides?)` as a separate argument**, consumed at admission,
never persisted raw; the `effectiveParams` snapshot is the single durable representation. One shape, one
sink, one thing to redact.

**I-7 (small) — `workflow_list` mixes sources.** `list()` re-parses `meta.description` from the stored
script per row (`workflow-catalog.ts:167–175`) while v21's contract comes from a column. Not a v21 defect,
but v22/D15's script masking breaks the description the same way it would have broken a script-derived
contract (ADR-004's own argument). One line in DES: `list()` reads `params` from the column; the
description re-parse is recorded as inherited debt with a v22 owner.

### 2B. Boundary/error lens

**B-1 — publish a TOTAL condition→code→payload table; keep the three codes.** Three codes
(`PARAM_LOCKED` / `PARAM_OUT_OF_RANGE` / `PARAM_UNKNOWN`) against at least eight distinct conditions.
The codes are the API (agent altitude), so the *mapping* must be total and table-driven, and it is the
single highest-value artifact of this design step:

| # | Condition (submission unless noted) | Code | Payload |
|---|---|---|---|
| 1 | `overrides` names a D12-locked key | `PARAM_LOCKED` | `{param, tunable:[…]}` |
| 2 | `overrides` names an unrecognized key | `PARAM_UNKNOWN` | `{param, tunable:[…]}` |
| 3 | wrong type (`timeoutMs:"fast"`) | `PARAM_OUT_OF_RANGE` | `{param, suppliedType, expectedType}` |
| 4 | outside author-declared enum/range | `PARAM_OUT_OF_RANGE` | `{param, supplied, allowed}` |
| 5 | above engine ceiling | `PARAM_OUT_OF_RANGE` | `{param, supplied, allowed}` (effective bound, B-3) |
| 6 | `appendPrompt` over `maxAppendPromptBytes` | `PARAM_OUT_OF_RANGE` | `{param:'appendPrompt', suppliedBytes, maxBytes}` — **never echoes the text** (B-1a) |
| 7 | declared `args` field violates its spec | `PARAM_OUT_OF_RANGE` | `{param:'args.<field>', supplied, allowed}` |
| 8 | *registration:* `params` block names a locked key, an **unknown knob** (`params:{temperature:…}`, REQ-090 "may not unlock anything outside them"), or is malformed/oversized | typed registration error, nothing stored | `{param, reason}` |

**B-1a (own finding, not in ARCH):** `PARAM_OUT_OF_RANGE.supplied` must never carry unbounded caller text.
`appendPrompt` can be 1 KB and error envelopes are logged; report **bytes, never content**. Same rule for
any string knob whose value exceeds a small threshold (truncate with an explicit `suppliedTruncated:true`).

**B-2 — one source of truth for a knob's default value.** REQ-090 explicitly puts `default` in the params
declaration ("name, type, default, and an allowed enum/range"), and the registered `defaults` block
(`HarnessDefaults`, `harness-defaults.ts:6`) already carries a value for the same knob. Two author-side
sources of one value is a contradiction hole with no stated winner. **Proposal (fail-closed, per
ARCH-067):** at registration, cross-validate — `params.<knob>.default` that disagrees with
`defaults.<knob>`, or a `defaults.<knob>` that violates the knob's own declared enum/range, is a typed
rejection with nothing stored; and the normalized contract's `default` is **derived from the `defaults`
column** so the two can never diverge after storage. Preserves REQ-090's vocabulary, removes the ambiguity.

**B-3 — the discoverable bound must be the *effective* bound.** Author declares `timeoutMs ≤ 900_000`;
engine ceiling is `600_000` (ARCH-066). `workflow_get` advertising 900 000 while submission refuses it is
a discoverability lie — the exact docs/behaviour split REQ-093 exists to repair. **Proposal:**
`workflow_get` returns `min(author bound, engine ceiling)` **computed at read time** (ceilings are config
and can change; storing the min would stale-cache it), with the stored column keeping the author's raw
declaration. One line, closes the lie.

**B-4 — `maxEffort` needs a total order, defined once.** `'high'` as a default ceiling over
`low|medium|high|xhigh|max` (`types.ts:49`) is only meaningful with a rank table. Put `EFFORT_RANK` in
`src/params/contract.ts` next to `isEffort()`, use it for both the ceiling comparison and any author
range, and list the permitted values in the error's `allowed` (agent altitude: the caller must be able to
retry correctly on the first bounce). DEPLOY §1 must document that `max`/`xhigh` are **refused by default
config** — otherwise the first user report is "the docs advertise `max` and the engine says no".

**B-5 — `workflow_resume` accepts no `overrides` field at all.** ARCH-066 inv-2 says resume "refuses new
or changed overrides", which requires an equality semantics over the closed type (absent vs `{}` vs
byte-identical values) — three cases to specify and test for zero user value. **Proposal (Karpathy):**
presence of the field on resume is a typed error, full stop; the pinned snapshot is the only source. Same
guarantee, nothing to get subtly wrong.

**B-6 (top risk) — `effort` on the SDK path must not re-open the shipped Ollama defect.** `thinkingFor()`
(`claude-agent-sdk-client.ts:325`, wired at `:527`) is the **sole writer** of `options.thinking` and was
added precisely because unconditional extended thinking made every local-Ollama default-path call fail
after ~4 minutes (`state.yaml` tech_stack, Gate 7.5 round 3). If Anthropic's effort profile maps to a
thinking budget, the design **must** state that `thinkingFor` remains the sole writer and **takes the
effort directive as an input** — never a second assignment to `options.thinking`. Non-Anthropic profiles
get the explicit `{applied:false, reason}` no-op entry (which is also the honest answer for Ollama).
Regression test: alias→non-Anthropic + `effort:'max'` ⇒ `options.thinking` byte-identical to today.

**B-7 (top risk) — REQ-094's "last" is already contradicted by the engine's own scaffolding.**
`agent-executor.ts:312` composes `${effectivePrompt}\n\n=== OUTPUT FORMAT (REQUIRED) ===…` and `:320`
appends a retry nudge — both **after** everything `composePrompt` produces. So for any schema-bearing
`agent()` call, user `appendPrompt` is *not* the final text. Two honest resolutions: (i) declare that
REQ-094's ordering constrains the three **content** segments (system / script / user) and that engine
**protocol scaffolding** is appended after them as a fourth, non-author, non-user segment — pinned by a
test that asserts the full four-segment order; or (ii) move the schema block ahead of the user text (I
oppose: it demonstrably degrades JSON conformance on the OpenAI path, per the D-V4 hardening comment at
`:305–311`). **Proposal: (i)**, stated in DES and in the REQ-094 acceptance note, because leaving it
implicit means Gate 7.5 either finds a "violation" that is really a mis-specification, or misses it.

**B-8 — non-MCP triggers now go through the contract, and that has a visible consequence.** Confirming
ARCH-066's placement (run-manager, not `SubmissionValidator`) and stating the reason ARCH left implicit:
**four of five `start()` callers bypass `SubmissionValidator` entirely** — `webhook-registry.ts:137`,
`scheduler.ts:219`, `server.ts:1242`, `continuation-store.ts:148`; only `mcp-facade.ts:89` is validated.
Admission is therefore the only placement that covers all triggers. **Consequence to design deliberately:**
declared-`args` validation (REQ-091) now applies to webhook/schedule/chained runs, so a webhook payload
that violates the args contract **refuses the run at trigger time** rather than failing inside the script.
That is the right behaviour (fail-closed, attributable) but it is a behaviour change for existing
webhooks and needs exactly one test plus a DEPLOY note.

**B-9 — one factory for `RunParams`; no call site constructs it.** With four callers that never supply
overrides, an implementer facing a required param will reach for `?? {}` at the call site — resurrecting
the inert-default bug class ARCH-068 is built to kill. **Proposal:** `start()` is the *only* producer,
via a single `defaultRunParams(registeredDefaults)` helper for the no-overrides path; `continuation-store`
chained runs explicitly start with the child workflow's own defaults and **never** inherit run A's
snapshot (one test — a chained run must not silently inherit a user's `appendPrompt`).

**B-10 — registration bounds need numbers, or there is nothing to test.** ARCH-064 inv-5 says "byte size +
nesting depth" without values. **Proposal:** `params` source ≤ 4 KB, ≤ 32 declared knobs+args, enum ≤ 32
members, nesting depth ≤ 4. Any number is better than none; these are chosen to be obviously generous.

### 2C. Testability lens

**T-1 — the tsc lever belongs on `AgentReq`, not on the constructor.**
*(Refinement resolving ARCH-068's own "constructor/dispatch" ambiguity toward dispatch.)*
`AgentExecutorDeps = {}` is an all-optional deps bag (`agent-executor.ts:269`) and `new AgentExecutor({…})`
appears at 30 sites across 12 files in `tests/unit` and `tests/integration`. A required *constructor* field breaks
them all and buys nothing: the executor instance is not where params semantically live. `AgentReq` is
built at exactly **one** production site (`run-manager.ts:_handleAgentRequest`) and explicitly in tests —
a required field there gives an identical compile-time guarantee with a fraction of the blast radius.
**Critically:** `_spawnerOverride` (the `AgentSpawner` test seam, `run-manager.ts:400/540`) must carry the
same required field, or the lever is bypassed in exactly the tests that would otherwise catch a
regression. Call that out as a DES line — it is a one-word omission away from being useless.

**T-2 — "before any durable work" needs named observables or the test passes vacuously.** ADR-008 allows
exactly one integration test; fine, but DES must name its three assertions, because "the call threw" is
satisfied by a rejection that happens *after* `createRun`:
1. `store.listRuns()` count unchanged (fake/in-memory store),
2. no directory created under `catalog.workFolder(name)/runs/` (tmp `workRoot`; note `runWorkspace()` at
   `workflow-catalog.ts:180` only computes a path and memoizes it — the mkdir is downstream, so this
   assertion must target the filesystem, not the call),
3. zero sandbox spawns (spawner spy).
Anything less does not test the property REQ-091 actually promises.

**T-3 — effort "on the wire" is testable today at both gateways; say so, and flag the Gate-7.5 gap now.**
Seams already exist: `GatewayConfig.fetchImpl` (direct/LiteLLM path → assert the mapped param in the
request body) and `queryImpl` (SDK path → assert the mapped value on `Options`). Both are UT/IT-tier, no
network. **But** REQ-093's real-tier evidence is a problem worth raising at Gate 3, not at Gate 7.5:
Ollama (the local provider used in all Gate 7.5 rounds) has **no reasoning dial**, so the only real-tier
observation available on the default local stack is the honest **no-op-with-reason** branch. Given this
project's history of gates stalling on local-model capability (VAL-003 tool-use, still open in the v1.1
backlog), the validation plan should pre-commit: real-tier green for REQ-093 = the no-op branch on Ollama
**plus** the mapped-value assertion at the injected-seam tier, or a paid provider with sandbox credentials.
Deciding this now costs a paragraph; deciding it at Gate 7.5 costs a round.

**T-4 (top risk) — ARCH-064 inv-5 is unimplementable as written; split the guard in two.** It says
`parseParamContract` "bounds the author literal (byte size + nesting depth) **BEFORE** it reaches the
existing `runInNewContext` pure-literal gate" — but its own signature takes `metaParams: unknown`, i.e. a
value that only exists **after** evaluation. `parseMeta()` (`workflow-meta.ts:16–22`) is the evaluator
(`runInNewContext(…, {timeout:50})`). **Proposal:** two guards, two homes, two tests —
(i) a **pre-eval source-size** guard in `workflow-meta.ts` (bytes of the matched `meta` literal text),
(ii) a **post-eval structural** guard (depth / key-count / enum-length) in the pure
`parseParamContract`. This also keeps `parseParamContract` genuinely pure (no VM, no clock), which is what
makes the whole rejection taxonomy a table-driven unit test.

**T-5 (top risk) — the `ON CONFLICT` clause is a silent-staleness trap.** `workflow-catalog.ts:110–114`
updates `script, version, createdAt, defaults` and **deliberately omits `owner`**. An implementer adding
`params` by pattern-matching that block will omit `params = excluded.params`, so **re-registering a
workflow with a changed contract keeps the old contract** — no error, no cache miss, and the run path
happily enforces a contract the author no longer wrote. Pinned test: register → re-register with a
different `params` block → `workflow_get` returns the **new** contract; plus a negative test that `owner`
still does not change. Also: the migration follows the established idempotent PRAGMA pattern
(`workflow-catalog.ts:58–67`) — reuse it verbatim, and add a test that opening a pre-v21 `catalog.db`
yields `params = NULL` reading back as the canonical unconstrained contract (ARCH-064 inv-4).

**T-6 — provenance can only be honest if it is emitted by the function that computes the value.**
`resolveCallParams` must return `{value, rung}` per key from a single pass; a second function that infers
provenance by comparing values can lie whenever two rungs hold the same value (e.g. registered default and
engine default are both `sonnet`) — and that is precisely the case a wiring-miss test needs to distinguish
(`provenance.model:'engine'` where `'default'` was expected). 5 rungs × 4 keys = 20 table-driven unit
cases; 1–2 integration cases suffice on top.

**T-7 — the dedup fingerprint change (ARCH-070 inv-2) has a one-time blast radius.** The fingerprint is
over (normalized title + component) (`github/issue-reporter.ts:140`). Adding `workflow` changes it for
every workflow-bound report, so open pre-v21 issues stop matching once and re-duplicate. Acceptable, but
pin the boundary: **with `workflow` absent, the fingerprint must be byte-identical to pre-v21** — that is
the compatibility promise REQ-095's "behaves exactly as it does today" makes, and it is a two-line test.

**T-8 — the missing REQ acceptance clause: the locked trio has no ARCH home.** REQ-092's final clause —
"`defaults.skills` / `defaults.tools` / `defaults.prompt` … are applied from the **registration** … closing
the current state where they are inert metadata" — is **not placed by any of ARCH-064..070**:
`composePrompt(systemPrompt, scriptPrompt, appendPrompt)` has no slot for `defaults.prompt`; provenance
covers only `model|effort|timeoutMs|appendPrompt`; the tool-surface rung is unstated (today
`agent-executor.ts:297–299` gives per-call `allowedTools` › agentType `tools` (D-F11) — where does
`defaults.tools` sit? my proposal: directly below agentType); and `defaults.skills` was explicitly deferred
by D-AUTH-5-D "to run time", which is *now*. **Proposal:** `mergeRunParams` folds **all five** registered
keys into the snapshot (three author-only, never user-reachable — which is trivially safe precisely
because `UserOverrides` cannot represent them, ADR-001), `composePrompt` gains the `defaults.prompt`
segment with a pinned position, and the descriptor's `tools`/`skills` already-existing fields carry their
own provenance. This also reshapes the "delete `resolveHarnessParams`" cleanup below: the locked trio
still needs an **author-side** application path, so `mergeRunParams` must subsume it *before* the old
function is deleted.

---

## 3. Task-splitting implications (`03-tasks.md` does not exist yet)

- **T-A `catalog.get()` widening lands FIRST, alone.** It is the only change with cross-cutting compile
  impact (4 call sites incl. the nested path), and every later task assumes it. A tiny task, but sequencing
  it first is what stops I-1 from being "fixed" by the `getFull()` shortcut inside a bigger task.
- **T-B pure modules** (`src/params/contract.ts`, `src/params/resolve.ts`) + the full rejection table
  (B-1) + `EFFORT_RANK` (B-4) + the post-eval structural guard (T-4ii). All UT, no I/O. This task carries
  the majority of the coverage and should be test-first in the strictest sense.
- **T-C catalog column + registration** (migration, `ON CONFLICT` incl. `params`, cross-validation B-2,
  pre-eval source guard T-4i, `workflow_get`/`workflow_list` surfacing with effective bounds B-3).
- **T-D admission rung + snapshot + resume** (ceilings, `start(spec, overrides)` per I-6, redaction sink,
  `defaultRunParams` factory B-9, resume-refuses-overrides B-5) — **and the three `composeConfig()` keys
  plus their line in `tests/unit/compose-config-v2-wiring.test.ts` must be in THIS task**, never a
  "config plumbing" task of its own. A separate config task is how a fifth instance of that bug class gets
  deferred (v11 `updateFlagPath`, v15 `auth`, v16 `workspaceTtlMs`, now `resolveHarnessParams`).
- **T-E dispatch wiring + descriptor decoration** (required field on `AgentReq` **and** `_spawnerOverride`
  per T-1; `onHarness` decoration per I-3; `composePrompt` incl. `defaults.prompt` per T-8; the
  four-segment prompt-order pin per B-7).
- **T-F gateway effort** (shared `mapEffort`, two call sites, `onHarness(descriptor, applied)` per I-4,
  `thinkingFor` sole-writer regression test per B-6).
- **T-G issue binding** (label, body lines, fingerprint incl. the absent-workflow byte-identity test T-7).
- **Explicit cleanup task, not a footnote: retire `resolveHarnessParams`** (`harness-defaults.ts:90`,
  zero `src/` callers) once T-8's author-side path exists. Leaving a `Partial<HarnessDefaults>`-shaped
  merge function sitting next to the new closed-type one is an open invitation for a future implementer to
  "finally wire the one that was never wired" — reintroducing exactly the ADR-001 escalation. Deleting the
  shape is cheaper than documenting why not to use it.
- **Dependency edges that matter:** T-A → {T-C, T-D}; T-B → {T-C, T-D, T-E, T-F}; T-D → T-E; T-E ∥ T-F
  (they meet only at `onHarness`); T-G independent.

---

## 4. Risks (ordered by confirmed severity)

| # | Risk | Evidence | Mitigation |
|---|---|---|---|
| R-1 | **Effort mapping re-opens the shipped Ollama/`think:true` defect** on the default SDK+local path | `claude-agent-sdk-client.ts:325/527`; `state.yaml` Gate 7.5 round 3 | `thinkingFor` stays sole writer of `options.thinking`, takes the effort directive as input; non-Anthropic ⇒ explicit no-op; regression test pins byte-identical `thinking` for a non-Anthropic alias at `effort:'max'` (B-6) |
| R-2 | **REQ-094 "last" is unachievable as literally worded** for schema calls; Gate 7.5 finds either a phantom violation or nothing | `agent-executor.ts:312, 320` | Declare the four-segment order (system / script / user / engine-protocol) in DES + REQ-094 note; pin with a test (B-7) |
| R-3 | **Pre-eval vs post-eval bound is unimplementable as written**; implementer silently drops one half | ARCH-064 inv-5 vs its own `metaParams: unknown` signature; `workflow-meta.ts:16–22` | Split into a source-size guard in `workflow-meta` and a structural guard in the pure parser (T-4) |
| R-4 | **Stale contract on re-register**, silent | `workflow-catalog.ts:110–114` omits `owner` by design; `params` would be omitted by pattern-copy | `params = excluded.params` + a re-register test (T-5) |
| R-5 | **REQ-092 still fails under composition**; nested runs get neither defaults nor contract | `run-manager.ts:~688` uses the narrow `get()` | I-1 widening + explicit nesting semantics + one test per direction (I-2) |
| R-6 | **REQ-092's locked-trio clause is unplaced** — ships as "still inert metadata" and Gate 8 finds it | no ARCH-064..070 slot for `defaults.prompt/tools/skills` | `mergeRunParams` folds all five keys; `composePrompt` gains the author-prompt segment (T-8) |
| R-7 | **Second unredacted sink** for caller `appendPrompt` via the persisted `RunSpec` | `run-store.ts:136/152`; ARCH-066 inv-5 names only the snapshot | `start(spec, overrides)`; never persist raw overrides (I-6) |
| R-8 | **REQ-093 has no real-tier evidence path** on the local stack; Gate 7.5 stalls a round | Ollama has no reasoning dial; VAL-003 precedent in the v1.1 backlog | Pre-commit the evidence plan at Gate 3/4: no-op branch real-tier + mapped-value at the injected seam (T-3) |
| R-9 | **Required-field churn** breaks ~28 executor constructions (30 mentions across 12 test files) for no safety gain, or the lever is bypassed via `_spawnerOverride` | `agent-executor.ts:269`; `run-manager.ts:400/540` | Required field on `AgentReq` and on the spawner seam; optional on the DTO (T-1, I-3) |
| R-10 | **Caller text echoed into error envelopes/logs** | ARCH-064 inv-3 payload `{supplied}` × 1 KB `appendPrompt` | Bytes not content; truncate with an explicit flag (B-1a) |
| R-11 | Behaviour change for existing webhooks/schedules once declared-args validation applies at admission | 4 of 5 `start()` callers bypass `SubmissionValidator` | Intended and fail-closed; one test + DEPLOY note (B-8) |

**Accepted, not mitigated (agreeing with ADR-005/007/008):** cost amplification within ceilings by a
non-owner principal; prompt-injection influence over the author's granted tool surface via `appendPrompt`;
no rejection telemetry; no non-owner descriptor masking before v22.

---

## 5. Internal conflicts between my own three lenses (surfaced, not hidden)

1. **Interface honesty vs. testability blast radius (I-3/T-1 vs ARCH-068).** The boundary lens wants
   required fields everywhere (omission = compile error); testability counts ~28 constructions across 12 files and ~2 gateway
   sites broken for fields that a DTO cannot enforce anyway. **Resolution:** put required-ness where
   omission is a *bug* (the dispatch argument, plus the spawner seam) and optionality where it is merely
   *shape* (the persisted descriptor). Karpathy tie-break: one lever, placed precisely, beats three.
2. **Self-describing errors vs. not echoing caller text (B-1 vs B-1a).** The agent-altitude consumability
   argument wants `{supplied}` in every payload so the caller self-repairs; the boundary/security argument
   refuses to copy 1 KB of unscreened user text into envelopes and logs. **Resolution:** echo `supplied`
   only for small, enum-like values; report *bytes* for free-text knobs. Consumability barely suffers —
   "your appendPrompt was 4096 bytes, max 1024" is fully actionable.
3. **Injectable observables vs. exactly-one integration test (T-2 vs ADR-008).** I agree with ADR-008's
   refusal to refactor the pinned `admit()` ladder, but a single integration test only proves the property
   if its assertions are named in advance. **Resolution:** keep one test; specify its three assertions in
   DES. This is the one place I ask the synthesizer to add *words*, not code.
4. **One translator (ARCH-065) vs. provider knowledge lives in the gateway (I-4).** Purity says map once,
   upstream; the primary source says provider is only resolvable downstream. **Resolution:** one pure
   implementation, two import sites, and the *applied object* travels back up — the invariant that matters
   (recorded ≡ applied) is preserved without a new interface method.
5. **REQ-094's literal "any agent() in that run" vs. child-contract integrity (I-2).** I could not resolve
   this from the requirement text and I decline to resolve it unilaterally: it is a **user-visible product
   decision** about whether a user's instruction follows a workflow into workflows it composes. Flagged for
   the synthesizer with both readings and my conditional recommendation.

---

## 6. Expected disagreements with the other lenses

- **Quality-dimensions (observability/consumability) will want more surfaces than I will grant.** Its
  architecture-round pattern (O-1/O-3) was rejection telemetry and richer exposure. I hold ADR-008: three
  error codes do not justify a metrics subsystem, and `/api/*` remains unauthenticated so dashboard
  surfacing of params publishes author config. Expect friction on whether "no telemetry" is a *gap* or a
  *recorded residual* — I say residual, already adjudicated at Gate 2.
- **On the contract's expressiveness.** I expect a push for `ParamSpec.description`, richer `unit`
  vocabulary, maybe a per-knob `examples` — consumability arguments at the agent altitude. I will accept
  `description` (pure documentation, zero behaviour, it genuinely helps an agent caller) and reject
  anything that *branches* at run time. And I expect a counter-push on my B-2: quality may want
  `params.<knob>.default` to be authoritative for discoverability; I want it derived so it cannot diverge.
- **On my I-3/T-1 softening.** A lens that prizes hard structural enforcement will read "optional DTO
  fields" as backsliding from ARCH-068. My defence is empirical, not aesthetic: `HarnessDescriptor` is a
  persisted record shape with historical instances that already lack these fields; a required field there
  buys a compile error at two gateway sites, not at the wiring site that has actually failed four times.
- **On I-4.** A replaceability-minded lens may prefer a `ProviderProfile`/`resolveTarget` seam so effort
  mapping is "properly" abstracted. I argue that is a new interface with two implementations invented to
  relocate a pure function call — the Karpathy tie-break rejects it; the config-entry replaceability
  ARCH-069 promised is fully delivered by the profile data alone.
- **On I-2 (`appendPrompt` propagation).** I expect the other lenses to have an opinion on the *user's*
  expectation ("I asked this run to answer in Spanish and the nested step didn't") which points to
  propagate, versus my contract-integrity instinct which points to contain. I have deliberately not
  pre-committed; this is the item most worth arguing in round 2.
- **Where I expect agreement:** the `catalog.get()` widening (I-1), the `ON CONFLICT` trap (T-5), the
  `thinkingFor` collision (B-6), and the unplaced REQ-092 locked-trio clause (T-8) are primary-source
  facts, not judgement calls. If any lens disputes them, it should do so with a file and a line number.
