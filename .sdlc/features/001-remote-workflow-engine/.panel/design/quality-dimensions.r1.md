# Design panel r1 — quality-dimensions lens (observability / replaceability / consumability / self-sustainability)

- **stage:** Design (Gate 3+4) — round 1, independent proposal
- **scope:** v21 slice, REQ-090..095 → ARCH-064..070 + ADR-001..008
- **altitude 判斷:** this project is **both** a conventional system (MCP tool surface, SQLite columns,
  config keys, journal) and an AI-agent system (prompt composition, per-agent transcripts, effort,
  model routing). v21 itself touches both altitudes — the parameter contract is system-altitude
  (schema, validation, persistence) while its *effect* is agent-altitude (what prompt/model/effort
  actually reaches the backend). Each dimension below carries both where relevant.
- **stance on the ADRs:** the quality lens already ran at Gate 2 and its adjudications are baked into
  ADR-001..008. I treat those as **constraints, not re-openable asks** (no metrics subsystem, no
  non-owner masking before v22, open-by-default + ceilings, session-options-builder stays fenced).
  This proposal is DES-level: exact record shapes, per-seam semantics, test pins, and task-split
  constraints that make the ARCH invariants *checkable* — plus two genuinely new design-level findings
  (F-1, F-2 below) that Gate 2 did not resolve.

## Summary

The v21 architecture already made the dominant silent-failure classes impossible-by-construction; the
design's job is to keep them impossible *and observable*. Four things carry the weight: (1) the
per-key provenance object must be **computed once in `resolveCallParams` and consumed by both the
dispatch and the descriptor as the same value** — a parallel re-derivation at record time recreates
the exact false-success class v21 repairs; (2) **"on the wire" must be pinned per gateway client** —
the two clients have different seams (LiteLLM direct-fetch: request body; SDK client: only
`Options.thinking` via `thinkingFor`, which D-F6 *disables* for non-Anthropic aliases), so the effort
mapping needs a per-client application point and a per-client spy assertion, or REQ-093's Gate-7.5
check cannot distinguish wire from echo — and the mapping must never re-enable thinking on a
non-Anthropic alias (400-regression, F-1); (3) the effectiveParams snapshot is the **first sink that
is both redacted-on-persist and read back for execution** (resume), which the DES-088 persist-only
invariant never contemplated — the divergence must be decided, not discovered (F-2); (4) legacy
(pre-v21) run rows have **no snapshot**, and ARCH-066's "resume reads the pinned snapshot" needs an
explicit fallback or the upgrade breaks every suspended run in flight.

## Key points

### 1. Observability — internal state transparent at any time; a silent/opaque failure is a design defect

**System altitude**

- **O-1 (same-object provenance — the load-bearing one).** ARCH-065's `mapEffort` rule ("the same
  returned object is both placed on the outbound request and recorded in the descriptor — never a
  parallel lookup") must be generalized to the whole `EffectiveCallParams`: `resolveCallParams` is the
  **single construction site** for `{model, effort, timeoutMs, appendPrompt, provenance}`, and the
  descriptor writer receives that object, not the raw inputs. DES should state this as an invariant
  and the unit test should assert it structurally (e.g. the descriptor-building function takes
  `EffectiveCallParams`, has no access to the pre-resolution inputs). Otherwise the descriptor can
  claim `provenance.model:'override'` while the dispatch used the agentType rung — the exact
  "echo, not wire" defect REQ-092 forbids, one abstraction level up.
- **O-2 (snapshot persist sink = one DES item, not two).** The `runs.effectiveParams` write must be
  designed as: route through ARCH-056 `redact()` **and** add the sink to the REQ-083
  sink-completeness sweep IT **in the same DES/TASK**. Splitting "persist snapshot" from "redact +
  sweep" across tasks is how a sink ships unredacted (the redact() zero-caller history is this exact
  class). See F-2 for the read-back consequence.
- **O-3 (typed refusal is the observability for rejections — settled).** ADR-008 declined the
  rejection counter; the residual stands recorded. The DES should not reintroduce it. One addition
  that costs one string and is *not* a metrics subsystem: `PARAM_OUT_OF_RANGE` should carry
  `source: 'contract' | 'engine_ceiling'` alongside `{param, supplied, allowed}` — an agent caller
  repairing its call needs to know whether the author constrained the knob (re-read `workflow_get`)
  or the engine ceiling did (lower the value); without it the error is typed but not actionable,
  which fails the quality bar the taxonomy was built for (see C-1).

**Agent altitude**

- **O-4 (per-client "wire" definition for effort — genuinely open, F-1).** Verified against source:
  the SDK client's only reasoning dial is `Options.thinking`, set by `thinkingFor(aliases, model)`
  (`claude-agent-sdk-client.ts:325`, applied at `:527`), and D-F6 pins `thinking:{type:'disabled'}`
  for every non-Anthropic alias. The LiteLLM direct-fetch client builds an HTTP body where a
  provider-profile param (`reasoning_effort`, thinking-budget tokens, …) can be set. The DES must
  therefore pin, per client:
  - *LiteLLM client:* `mapEffort` result `{param, value}` is placed on the outbound request body;
    test = spy/fake captures the body, asserts `low` vs `max` differ at `body[param]`.
  - *SDK client:* the only legal application point is the `thinking` option, and **only for
    Anthropic-mapped aliases**; for a non-Anthropic alias the profile entry MUST be the explicit
    no-op `{applied:false, reason:'thinking disabled for non-Anthropic alias (D-F6)'}` — the mapping
    must compose with `thinkingFor`, never override it (re-enabling `think:true` on
    Ollama/OpenAI/Gemini is a known 400). Test = captured `Options.thinking` for an Anthropic alias
    at two effort levels; non-Anthropic alias asserts `applied:false` **and** thinking still disabled.
  Without this split, REQ-093's "observable on the outbound request" is untestable on the SDK path
  and the honest-degradation clause has no defined trigger.
- **O-5 (tri-state `effortApplied` + truncation honesty — pin the schema).** Descriptor delta should
  be pinned exactly as: `effort?`, `effortApplied?: {param, value} | {reason}` (absent = never
  requested), `timeoutMs`, `appendPromptBytes?`, `promptTruncated: boolean`,
  `provenance: Record<'model'|'effort'|'timeoutMs'|'appendPrompt', 'call'|'agentType'|'override'|'default'|'engine'>`.
  The `PROMPT_CAP=4096` head/tail pinned test (descriptor-only truncation; outbound prompt untouched
  — confirmed at `agent-executor.ts:23`) belongs to the ARCH-068 task's definition of done.
- **O-6 (script-supplied invalid effort — pin the error surface).** ARCH-069 says "rejects the call
  typed" but not *where it lands*. Proposal: a **catchable throw inside the script's `agent()` call**
  (consistent with the unknown-agentType precedent, REQ-003), error message naming the param and the
  allowed set; the run continues if the script catches; no harness event is written (the call never
  dispatched). A run-failing alternative would break `parallel()` null-semantics expectations.

### 2. Replaceability — decoupling & pluggability; no lock-in

**System altitude**

- **R-1 (two effort vocabularies must not coexist).** `ProviderEffortProfile` (consumed by
  `mapEffort`) is a **new type in `src/params/`**, deliberately distinct from the dead
  `ProviderProfile.effortMapping` at `session-options-builder.ts:18` (ADR-006 fence). The DES should
  (a) name the schema — proposal: per provider-class entry
  `{param: string, values: Record<Effort, unknown>} | {noop: true, reason: string}` — and its config
  location (rides the existing alias/provider config, no new file); (b) add a cheap standing guard
  that pins the fence: a unit test asserting `session-options-builder.ts` has **zero `src/`
  importers** (the ADR-006 fence becomes a tripwire instead of a review promise; the same test
  retires naturally when the security-hardening track wires the module deliberately).
- **R-2 (one contract vocabulary, three consumers — already won, keep it won).** ARCH-064 as the sole
  owner of `LOCKED_KEYS`/`TUNABLE_KEYS`/validation is the anti-drift design; the DES's job is the
  task split that preserves it: `contract.ts` and `resolve.ts` are **standalone, first-sequenced,
  table-driven-test tasks**, and no consumer task (066/067/068) re-declares any key list or bound
  rule — the MCP inputSchema and tool descriptions are *generated from the ARCH-064 types* under the
  existing ARCH-051 drift-lock, which is what keeps v23's describe surface a pure consumer.

**Agent altitude**

- **R-3 (LLM backend swap stays a config change).** The contract's `model` enum references **alias
  names**, never provider model ids (`parseParamContract(metaParams, aliasNames)` already takes the
  alias set) — so remapping `haiku` from Anthropic to Ollama invalidates no stored contract. Pin the
  temporal semantics: enum entries are validated against the alias set **at registration**; at
  submission only the *effective* (post-merge) model is re-checked via the existing `UNKNOWN_ALIAS`
  rule (Gate-2's reduced adoption of quality S-1) — the stored contract is never re-validated
  wholesale on read. Adding a provider with a new effort dial = one `ProviderEffortProfile` entry;
  adding one with no dial = one explicit no-op entry. Both are config rows, zero executor code —
  test: parameterize the gateway effort-application contract test over **both** GatewayClient
  implementations so a future third client inherits the assertion.
- **R-4 (both clients, one mapper).** ARCH-069's rule that both `GatewayClient` impls consume the
  *same* `mapEffort` result means the mapper must not leak into either client as a re-implementation;
  DES: `mapEffort` is imported from `src/params/resolve.ts` by both, and the descriptor value is the
  returned object handed back, not recomputed (same-object rule again).

### 3. Consumability — interface friendliness, minimal integration cost for callers (human and agent)

- **C-1 (self-repairing error envelopes — exact shapes).** Pin in the DES, not the implementation:
  - `PARAM_LOCKED {param, tunable: ['model','effort','timeoutMs','appendPrompt']}`
  - `PARAM_OUT_OF_RANGE {param, supplied, allowed, source: 'contract'|'engine_ceiling'}` where
    `allowed` is `{enum: [...]}` or `{min?, max?}` — a machine-distinguishable shape, not prose
  - `PARAM_UNKNOWN {param}`
  An agent caller must be able to repair its call from the error alone (no second `workflow_get`
  round-trip) — that requires `allowed` to be structured and `source` to disambiguate who imposed the
  bound. All ride the existing uniform result envelope; no new error transport.
- **C-2 (`workflow_get`/`workflow_list` params surface — never null).** The `params` column is
  nullable but the **API never serves null**: a NULL row reads back as the canonical unconstrained
  contract (four knobs, no bounds, no declared args) — ARCH-064 invariant (4) applied at the read
  surface too, so callers write zero special-casing. Pin the served JSON shape
  (`{knobs:{<name>:{type,default?,enum?|min?|max?,unit?}}, args:{…}}`) in the DES and drift-lock it
  with the tool description.
- **C-3 (docs = behavior, generated).** The `effort` no-op being repaired was precisely a
  docs/behavior split (`server.ts:258` advertised what nothing read). The fix must not mint a new
  one: `workflow_run.overrides` inputSchema (`additionalProperties:false`, exactly four properties,
  effort enum inline) and the `workflow_get.params` description are generated from ARCH-064 types
  under the ARCH-051 drift-lock test — this is a stated ARCH-067 property; the DES makes it a task
  DoD. The three config keys get DEPLOY §1 rows + README knob documentation in the same iteration
  (living-documents rule), including the ceilings' *refuse-don't-clamp* behavior so operators aren't
  surprised by refusals.
- **C-4 (appendPrompt cap semantics — pin before someone argues off-by-frame).** The
  `maxAppendPromptBytes` cap applies to the **raw user text, byte-measured, before the frame is
  added**; the frame (`\n\n<user-instructions untrusted="true">\n…\n</user-instructions>`) is an
  exported, drift-locked constant in `resolve.ts`. Refusal error names the cap and the observed byte
  length. Cap check happens in `validateUserOverrides` (submission), so refusal is pre-durable-work
  like every other param error.
- **C-5 (issue tools — one name vocabulary).** ARCH-070's charset/length rule for the `workflow`
  field is the **exported registration-name predicate minus the existence check** — reuse the
  function, don't transcribe the regex (transcription is drift). `issue_report`/`issue_list` are
  symmetric on unregistered names so report-then-list round-trips; both already ride the existing
  envelope.
- **C-6 (client plugin).** No plugin change is required — the self-describing schema discipline
  (REQ-079) means the new `overrides` surface reaches agent callers through `tools/list`. Worth one
  line in the guidance-skill's next scheduled refresh, not a v21 task.

### 4. Self-sustainability — closed-loop autonomy, survives upgrades and config drift without human rescue

**System altitude**

- **S-1 (byte-identity pins — the regression immune system).** Three pinned equality tests, named in
  the DES as non-negotiable: (a) `composePrompt(system, prompt, undefined)` byte-equals today's
  `${systemPrompt}\n\n${prompt}` / bare `prompt`; (b) a no-overrides `workflow_run` of an
  unconstrained workflow behaves identically to pre-v21 (integration); (c) effort-absent request
  composition is byte-identical to pre-v21 on both gateway clients.
- **S-2 (upgrade compat: legacy runs have no snapshot — unpinned in ARCH, must be pinned in DES).**
  ARCH-066(2) says resume reads the pinned snapshot, but every run row created before the v21 deploy
  has `effectiveParams = NULL`. The DES must pin the fallback: **a NULL snapshot resumes with the
  canonical default resolution (today's behavior — re-resolve from the run's pinned catalog version
  row), never a crash**, and refuses `overrides` on resume exactly as a v21 run does. Plus the
  **upgrade-compat replay test**: a suspended pre-v21 journal fixture resumed on the v21 build
  replays fully from cache with zero misses (this is ADR-002's zero-invalidation promise made
  checkable — `CallKey` at `run-manager.ts:706` byte-identical).
- **S-3 (the composeConfig tripwire — same-task, by decree).** ARCH-066(6) already says it; the DES
  task split must enforce it: the three config keys' `composeConfig()` forwarding **and** their rows
  in `tests/unit/compose-config-v2-wiring.test.ts` land in the *same task* as the admission rung.
  Four prior misses of this class (v11 `updateFlagPath`, v15 `auth`, v16 `workspaceTtlMs`, now
  `resolveHarnessParams`) all came from treating wiring as someone else's later step.
- **S-4 (fail-closed config defaults + one effort ordering).** A missing ceiling key uses the
  fail-closed default (`600_000` / `1024` / `'high'`) — one unit test per key. The `maxEffort`
  ceiling needs an ordinal comparison; the ordering table
  (`low < medium < high < xhigh < max`) lives **once** in `contract.ts` (single source, used by both
  `isEffort` and the ceiling check).
- **S-5 (lifecycle untouched — verify, don't build).** No new process, port, table, or watchdog
  (slice-shape promise). `effectiveParams` rides the run row: `workspace_purge` preserves the
  journaled record, so the snapshot survives purge like the transcript does — one assertion in the
  existing purge test, no new retention policy.

**Agent altitude**

- **S-6 (budget metabolism under fan-out).** `appendPrompt` tokens are charged to the run's REQ-002
  budget (ARCH-068: "no free rider under fan-out"); DES test: an N-way `parallel()` with an
  appendPrompt shows budget spend scaling with N. The 1024-byte cap is what keeps a user's appended
  text from metabolizing the author's budget — the cap, the charge, and the descriptor's
  `appendPromptBytes` are the same story told at three layers (bound, account, observe).
- **S-7 (the standing wiring tripwire).** The per-key `provenance` field is not just observability —
  it is the *self-diagnosing* mechanism for the next wiring miss: a future knob that silently falls
  through to the engine default shows up as `provenance.<key>:'engine'` where a Gate-7.5 assertion
  expects `'default'`. The DES should name the specific Gate-7.5 assertions (one per rung, S-1
  scenario style) so this tripwire is armed from day one.

## Task-splitting constraints (for the synthesizer writing 03-tasks.md)

1. **ARCH-064 then ARCH-065 first**, standalone pure tasks, table-driven tests, no I/O — everything
   downstream imports them.
2. **ARCH-066 is ONE task**: admission rung + snapshot persist + redact routing + sweep-test addition
   + config-key forwarding + compose-config wiring test. Every seam in that list has a
   shipped-precedent failure mode when split from its wiring.
3. **ARCH-068's required-argument signature change cannot be split from the dispatch wiring** — the
   `tsc`-error property *is* the design; a two-task split invites a temporary default that never
   leaves.
4. **ARCH-069 is one task covering both gateway clients** with a parameterized shared contract test
   (per-client wire assertions per O-4).
5. **ARCH-070's dedup-fingerprint extension carries its regression test in-task** (two workflows,
   same title/fingerprint → two issues, not one comment).
6. **S-2's legacy-resume fallback needs an explicitly named task/test** — no ARCH clause owns it, so
   it is the likeliest silent omission in this slice.

## Risks

- **F-1 (HIGH, design-open): SDK-client effort seam collides with the D-F6 thinking policy.** If the
  mapper is applied naively on the SDK path it either does nothing observable (untestable REQ-093) or
  re-enables thinking on a non-Anthropic alias (the exact 400 D-F6 exists to prevent). Mitigation is
  the O-4 per-client pinning; Gate-7.5 must include a non-Anthropic-alias effort run asserting
  `effortApplied:{reason}` **and** no 400.
- **F-2 (MID, design-open): the snapshot is the first redacted-persist sink that is read back for
  execution.** DES-088's persist-only redaction was designed for write-only sinks (transcripts). On
  resume-after-restart, the run's live tail composes prompts from the *persisted* snapshot: if the
  user's `appendPrompt` happened to contain a server-secret value, the pre-suspend dispatches used
  raw text and the resumed tail uses `‹secret:NAME›` — a replay divergence. Proposed resolution:
  **accept and pin** (option a) — the divergence only occurs when caller text literally contains a
  server secret value, in which case masking on resume is the *safe-side* behavior; add one test
  documenting it and a note in the DES invariant table. The alternative (a second, unredacted
  persisted copy) doubles the sink surface for a pathological case.
- **MID: legacy NULL-snapshot resume** (S-2) — unowned by any ARCH clause; crash or silent
  re-resolve drift on the deploy day if unpinned.
- **LOW: two effort vocabularies drift** if `ProviderEffortProfile` isn't explicitly typed apart from
  the fenced `effortMapping` (R-1); the zero-importer tripwire test closes it.
- **Recorded residuals (not re-contested):** cost amplification within ceilings (ADR-005);
  appendPrompt instruction-position injection, bounded + framed + attributed but not eliminable
  (ADR-007); no rejection telemetry and full descriptor/provenance served to non-owners until v22/D15
  (ADR-008 — note the new `provenance` field does reveal *that* an override was supplied, but that is
  the same exposure class as the already-served knob values, so the deferral holds).

## Expected disagreements with other lenses

1. **appendPrompt injection (adversarial):** likely push for content screening or author opt-out
   now. Stance: settled at ADR-007 — screening is unenforceable theatre; the frame + cap + structural
   locks + attribution are the design; opt-out is already free via a `params` constraint later.
2. **Non-owner exposure of `provenance`/`effectiveParams` (adversarial):** likely push to mask now.
   Stance: ADR-008 — no new exposure *class*; two masking implementations are worse than one; the
   residual is recorded and bound to v22/D15.
3. **F-2 resolution (adversarial may prefer an unredacted execution copy):** stance: accept-and-pin;
   the divergence trigger is pathological and masking-on-resume fails safe. Willing to concede if
   adversarial shows a non-pathological trigger.
4. **`source` field on `PARAM_OUT_OF_RANGE` and the zero-importer fence test (simplicity/Karpathy):**
   may be read as creep. Stance: `source` is one string that makes the error self-repairing (the
   stated reason the taxonomy exists); the fence test is one `grep`-shaped assertion guarding a
   fenced-off module that has already caused one scope-leak debate. Both are cheaper than the
   round-trips they prevent. I pre-concede any push to drop the C-6 plugin note and any suggestion to
   surface `effectiveParams` on `workflow_status` (I deliberately did NOT propose the latter —
   ADR-008's spirit says the descriptor is the one observation point until v22).
5. **Per-client effort pinning (someone may say "let the implementer decide"):** stance: O-4/F-1 is
   exactly the kind of seam where implementer discretion produced the `effort` no-op in the first
   place; the per-client application point is design, not implementation detail.
