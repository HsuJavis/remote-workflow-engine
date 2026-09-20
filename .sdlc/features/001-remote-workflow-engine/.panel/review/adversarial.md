# Gate 8 review — Adversarial architecture group (security / scalability / testability, Karpathy tie-break)

- **iteration:** v34
- **compared:** `02-architecture.md` (ARCH-136..140, ADR-061..064, INV-V34-1..4, ARCH-087/107 v34 amendments)
  against `06-impl-log.md` IMPL-338..341 and ONLY the files on their `files:` lines
  (plus `src/gateway/claude-agent-sdk-client.ts`, `src/harness-defaults.ts` — both reached through a
  module boundary those files name).
- **verdict:** NOT consistent — 6 findings (1 MED-security, 1 MED-security, 1 LOW/MED-simplicity, 3 LOW).
  None is a functional regression; all six are places where the shipped code does not hold the property
  the v34 rows claim for it, which is the exact defect class REQ-202/203/204 were opened to remove.

---

## What the three lenses found, before the individual findings

**(a) Security.** The cut itself is clean and the two fail-closed properties v34 promised are really
there: the dispatch-time `Object.hasOwn(req.opts,'agentType')` refusal (ADR-063) lands at the same site
the old `Unknown agentType` throw stood (`src/agent-executor.ts:537-548`) and is RECORDED before it is
THROWN, so `parallel()`'s swallow-into-null cannot hide it; the resume guard (DES-228) refuses a stored
snapshot carrying `prompt`/`tools` rather than silently widening a resumed run's tool surface
(`src/run-manager.ts:1039`). Where security fails is not in the code the cut wrote but in the two
sentences the cut left standing about the mechanism it deliberately KEPT — the tool surface
(AC-1, AC-2). Both are text-vs-code, and both are load-bearing: AC-2 is the entire justification for
INV-V34-1's single named residual.

**(b) Scalability / performance.** Nothing to report, stated rather than invented. The slice touches no
state storage, no concurrency primitive and no shared counter; it is deletion-heavy and strictly reduces
per-dispatch work (five-segment join + `stripFirstSegment` + a registry lookup → one concat). The only
new per-call cost is one `_sink.capture` write ahead of the refusal throw, bounded by the same
`parallel()` fan-out and agent semaphore that already bound successful dispatches. `RETIRED_CONFIG_KEYS`
is a boot-time O(1) map, `RETIRED_AGENT_OPT_KEYS` a registration-time O(1) map. No finding.

**(c) Testability.** ARCH-140's byte-identity pin is real and correctly built: all five DES-225 goldens
are literals in `tests/unit/params-resolve.test.ts:176-205`, including golden 5's pinned leading `\n\n`.
ARCH-139's named same-commit obligation landed (`tests/unit/compose-config-v2-wiring.test.ts:240-277`
adds the `RETIRED_CONFIG_KEYS` cases and drops `agentDefinitionsDir` from the `PROBES` sweep).
ADR-061's accepted obligation landed (`tests/integration/agent-log-harness-shape.test.ts:221-284` pins
the post-cut `descriptor.prompt`, split no-schema/with-schema per DES-225 rationale item 2).
ADR-063's Gate-7.5 text sweep was actually run against the production catalog (VAL-226 item 3).
The seam ARCH-140 refused to inline is genuinely load-bearing — `FRAME_CLOSE_FORGERY`
(`src/params/contract.ts:141`) is unit-testable only because `composePrompt` still owns the frame
constants. The testability gap is AC-3: the half of the retired object that was NOT cut is the half the
compiler cannot see, which is the drift class INV-V34-4 exists to prevent.

**Internal conflicts between the lenses, argued.**

| Conflict | Positions | Who won, and was it right |
|---|---|---|
| Dispatch refusal: `capture` **then** `throw` (ADR-063 + DES-225 rationale item 3) vs Karpathy "~3 lines, option (a) accept silent-inert" | Security wants the record; simplicity wants zero lines | **Security won, correctly.** Without the capture, "refused, not silently ignored" is true of the run and false of the client — `sandbox/guards.ts` swallows a bare throw inside `parallel()`. Impl honoured it. |
| Keep `composePrompt` as a seam (ARCH-140) vs inline three lines | Testability vs simplicity | **Testability won, correctly.** Inlining scatters the security-relevant frame constants and converts a unit test into an integration test. Impl honoured it. |
| Delete `stripFirstSegment` + `harness_prompt_prefix_mismatch` (ADR-061 (c), DES-225 rationale item 1) | Simplicity + disclosure quality vs the last remaining runtime check that a gateway echoed what it was handed | **Simplicity won.** Defensible for two in-tree gateways that both echo verbatim, and the revisit trigger is pre-stated ("a third gateway implementation, or any observed non-echo"). Accepted, not a finding — but see AC-4: the v34 comment written at that site asserts the *opposite* semantics to the one the panel ruled. |
| "Two layers" as the advertised simplification (ADR-064 (A)) vs what the gateway actually resolves | Simplicity wanted one clean sentence; security says the sentence under-states the default surface | **Simplicity won on the text and the code did not follow.** This is AC-1 — the only finding where the Karpathy tie-break argues for a *code* change rather than a doc change. |
| `defaultAllowedTools` kept as "an operator's tool floor" (INV-V34-1, ARCH-137) vs `??` precedence | Security assumed a restriction; the code implements a default | **Neither — the architecture asserted a property the code never had.** AC-2. |

---

## Findings

### AC-1 — MED (security, simplicity) — the advertised 「兩層」 tool surface is three rungs, and the unnamed third one contains `Bash`

- **Violated:** ADR-064 owner ruling (「REQ-203 的『工具只剩兩層』對**所有** run 為真,不加例外句」);
  DES-229 item 4 / ARCH-107 (the guide's tool-surface text); INV-V34-1 (「**The single named residual:**
  `defaultAllowedTools`」 — the residual inventory is incomplete).
- **Evidence:**
  - `src/gateway/claude-agent-sdk-client.ts:544-547` —
    `const baseTools = req.opts.allowedTools ?? this._config.defaultAllowedTools ?? BUILT_IN_CORE_TOOLS;`
  - `src/gateway/claude-agent-sdk-client.ts:190` —
    `const BUILT_IN_CORE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'];`
  - `src/authoring-guide.ts:534-537` (v34, this iteration) — 「Two layers set it, on the tool-calling
    (SDK gateway) path, and **the first one present wins**: the per-call `allowedTools` above, then this
    deployment's configured `defaultAllowedTools`.」 Neither sentence names what happens when **neither**
    is present, which is the default deployment.
  - `src/agent-executor.ts:561` (v34 comment) — 「the tool surface is exactly per-call `allowedTools` >
    the gateway's `defaultAllowedTools`」.
  - `src/main.ts:60-62` states the truth the guide omits: 「Omitted -> ClaudeAgentSdkGatewayClient's own
    built-in minimal core set applies」.
- **Why it matters under the security lens, not just tidiness:** the finding is the *readability* prong,
  not a hidden surface. The guide's closing measurement (「1722 [input tokens] with the default one」)
  tells an author that *a* default exists; nothing on any advertised surface — the guide, `tools/list`,
  or `workflow_describe` — says **what is in it**. An author who writes no `allowedTools` on a
  deployment that configures no `defaultAllowedTools` cannot learn pre-hoc that the model is handed
  `Write`, `Edit` and `Bash`. That is exactly the pre-hoc gap INV-V34-1 names and bounds for
  `defaultAllowedTools` — on a rung INV-V34-1 does not name at all, and whose contents are fixed in
  engine source rather than chosen by the operator.
- **Not caught upstream:** VAL-226 item 4 / VAL-227 item 3 verified the *live text* says 「two layers
  unconditionally, with no legacy-row exception clause」 and passed it — the sweep checked the sentence
  against ADR-064, never against `claude-agent-sdk-client.ts`.
- **Karpathy tie-break:** two minimal exits, both smaller than the claim they repair. (i) one clause in
  `authoring-guide.ts:534` naming the built-in fallback and its contents (doc-only, byte-lock regenerate);
  or (ii) have `composeConfig` default `defaultAllowedTools` to `BUILT_IN_CORE_TOOLS` at compose time so
  the runtime really does have exactly two rungs and the sentence becomes true by construction. (ii) is
  the one that makes 「不加例外句」 hold in code. Nothing speculative either way.

### AC-2 — MED (security) — `defaultAllowedTools` is a fallback default, not 「an operator's tool floor」; the justification for INV-V34-1's one named residual is not a property the code has

- **Violated:** ARCH-137 note (「deployment-wide `defaultAllowedTools` is the surviving **operator-owned
  restriction layer**… **removing an operator's tool floor would be a security regression**」);
  INV-V34-1 (a surviving deployment-side input may only *restrict* **or** be *readable* — the row calls
  this one 「additive」 in the same sentence it calls it a 「floor」, and only one of the two can be true).
- **Evidence:**
  - `src/gateway/claude-agent-sdk-client.ts:544-547` — `??`, not an intersection: a per-call
    `allowedTools` **replaces** the operator's set outright; it can only ever be a default, never a floor.
  - Nothing validates a per-call `allowedTools`. `grep -n allowedTools src/workflow-catalog.ts
    src/workflow-meta.ts src/params/contract.ts` finds only the scanner recording the literal
    (`src/workflow-meta.ts:491-493`) and `LOCKED_KEYS` (`src/params/contract.ts:25`, which locks it
    against a *caller* override, not against the author). The only curated allowlist in the tree,
    `HARNESS_TOOL_ALLOWLIST` (`src/harness-defaults.ts:28`), is reachable only from
    `validateHarnessDefaults`, which has zero call sites in `src/` (see AC-3).
  - The v34-rewritten comments at `src/gateway/claude-agent-sdk-client.ts:188-189` and `:247-248` now
    state the consequence in plain words: Web egress (`WebFetch`/`WebSearch`) and sub-agent spawning
    (`Task`) 「stay OUT of the default (opt-in **via an explicit per-call `allowedTools`**)」, and Bash
    「stays opt-in via an explicit per-call `allowedTools`」 — i.e. the operator's set is what applies
    when the script names nothing, and is fully displaced the moment the script names something.
    To be precise about who this is and is not about: a per-call `allowedTools` is **author**-written,
    author-visible, workspace-confined (`isInsideWorkspace`, the `PreToolUse` path guard) and LOCKED
    against a *caller* (`LOCKED_KEYS`), so this is **not** an author-side escalation and INV-NOADD's
    subject is untouched. The defect is on the operator's side: the operator has no floor, only a
    default, and ARCH-137 spends the loss of per-agent-type granularity against a floor that does not
    exist.
- **Scope honesty:** the behaviour is pre-existing (v21/v25), not introduced by v34. v34 is the iteration
  that minted the security claim about it, and it did so while ARCH-137 was arguing that losing
  per-agent-type tool granularity is an *accepted, bounded* tradeoff *because* an operator-owned floor
  survives. It does not survive; there was never one.
- **Karpathy tie-break:** no new machinery. Either amend INV-V34-1/ARCH-137 to say what is true
  (「a default, overridable upward by the script; its post-hoc prong is satisfied by
  `HarnessDescriptor.tools`」), or, if an operator floor is actually wanted, it is a one-line
  intersection at `:544` and a v35 requirement — **not** something to bolt on inside a review.

### AC-3 — LOW/MED (simplicity, testability) — 「one retired object retired whole」 retired only the reader half; the writer half survives as dead, compiler-unprotected vocabulary

- **Violated:** ADR-064 owner ruling (「(A) 一併退休… 退乾淨,退一半會讓文件永久帶著例外句」) and its own
  note, which names *these* lines as the object in question; INV-V34-4 in spirit (absence is pinned by
  the compiler — this file is not one of the two `Record<keyof T, true>` sets, so nothing pins it).
- **Evidence:**
  - `src/params/resolve.ts:44-52, :85-87` — the reader half is correctly gone (`RunParams.prompt`,
    `RunParams.tools`, and their population from `defaults?.*`).
  - `src/harness-defaults.ts:17` (`tools?: string[]`), `:20` (`prompt?: string`), `:39` (`KNOWN_KEYS`
    still lists both), `:68-72` (their shape guards), `:28` (`HARNESS_TOOL_ALLOWLIST`) — untouched.
    ADR-064's note cites exactly `harness-defaults.ts:17`/`:20`/`:39`/`:68-72` as the split-down-the-
    middle it was ruling on.
  - `src/harness-defaults.ts:50` `validateHarnessDefaults` — **zero call sites in `src/`**
    (`grep -rn "validateHarnessDefaults\|HARNESS_TOOL_ALLOWLIST" src/` returns only its own file). The
    only surviving import of the module anywhere in `src/` is the **type-only**
    `import type { HarnessDefaults }` at `src/params/resolve.ts:11`, and both live callers of
    `defaultRunParams`/`mergeRunParams` pass `defaults: undefined`
    (`src/run-manager.ts:582`, `:1046`).
- **Fair reading of the other side:** ARCH-140's `api:` block names only `RunParams.prompt`/`.tools`, so
  the implementation is *literally* compliant with the architecture row, and Gate 6.5's `/simplify` pass
  was correctly scoped to `git diff a98b469..HEAD -- src` — a file nobody touched cannot show up there.
  That is exactly how this half survives an iteration, which is the mechanism ADR-064's own note
  predicted ("exactly why it will not appear in a smoke test and exactly how it survives an iteration").
- **Karpathy tie-break:** deletion is the minimum, and it is a deletion — the module is dead. If it is
  kept for a future re-introduction, that is speculative architecture by the ledger's own standard.
  Defer to v35 rather than cut inside a review gate; record it so the next `/simplify` sees it.

### AC-4 — LOW (traceability / security-relevant comment) — the v34 comment at the decoration site asserts the semantics DES-225 ruled AGAINST, and cites the wrong ADR

- **Violated:** DES-225 decision rationale item 1 / ADR-061 (the field means 「what the gateway
  **reported it received**」, and engine-side ownership was explicitly **ruled against for v34**).
- **Evidence:** `src/agent-executor.ts:637-640` — 「`descriptor.prompt` is **DEFINED as the exact string
  this dispatch handed the gateway** — … this site no longer takes ownership of it (the retired
  agentType-systemPrompt strip + the `harness_prompt_prefix_mismatch` fail-closed that verified the echo
  went with it, **ADR-063 rationale item 1**)」.
  Two defects in one sentence: (1) 「the exact string this dispatch handed the gateway」 is the
  engine-says-it-sent meaning DES-225 refused; the code actually assigns the gateway's *reported* echo
  and, with the fail-closed deleted, no longer verifies the two are equal. (2) The cited decision is not
  in ADR-063 (whose rationale items are the (a)/(b)/(c) options for the *dispatch refusal*); the echo
  ruling is ADR-061 / DES-225 rationale item 1.
- **Why it is not cosmetic:** the comment is the only in-code statement of a field whose meaning v34
  changed silently. A future reader who trusts it will "restore determinism" by setting `prompt` from the
  in-scope `prompt` variable — which is precisely the change DES-225 rationale item 1 rejected, and the
  revisit trigger it named ("a third gateway implementation, or any observed non-echo") would be bypassed.
- **Fix:** two-line comment correction, no behaviour change.

### AC-5 — LOW (consumability) — the re-pointed near-miss renders a sentence where the template promises a key name

- **Violated:** ARCH-138's own stated reason for the re-point (「a key that will no longer exist — **a
  helpful message teaching a removed feature is worse than no message**」).
- **Evidence:** `src/workflow-meta.ts:235-236` puts prose into the near-miss *value* map; the render
  template at `:511-513` is `` `'${key}' is not an agent() option — did you mean '${nearMiss}'?` ``.
  An author writing `systemPrompt:` now receives:
  `'systemPrompt' is not an agent() option — did you mean 'your script's own prompt — see workflow_authoring_guide → prompt layering'?`
  — a quoted suggestion that is not a key either, followed by `Accepted: <the real key list>`.
- **Scope honesty:** DES-224 specifies this exact string, so the implementation is faithful; the defect is
  design-level and shipped. Raised here because the lens is adversarial and because 「teaching a key that
  does not exist」 is the same failure ARCH-138 invoked to justify the change.
- **Karpathy tie-break:** the minimum is not a new mechanism — either keep the map key-shaped
  (`systemPrompt → prompt`) and let the existing guide pointer in the `PARAM_UNKNOWN` hint carry the rest,
  or split the near-miss value into `{key, note}` only if a second such case ever appears. Do neither
  speculatively.

### AC-6 — LOW (hygiene, in a block v34 rewrote) — `in` vs `Object.hasOwn` applied on one side of the same commit

- **Violated:** no ARCH/INV row directly; it contradicts the in-tree rule the SAME commit re-applied
  four files away, and ARCH-139's premise that the config-side retirement 「REPLACES a special case
  instead of adding one」 — the replacement inherited the old branch's prototype-key hole.
- **Evidence:**
  - `src/main.ts:160` — `Object.keys(fileConfig).filter((k) => !(k in KNOWN_FILE_CONFIG_KEYS))`.
    `'constructor'`, `'toString'`, `'valueOf'` are `in` every object literal, so a config key with one of
    those names is silently classified as **recognized** and never warned about — the opposite of the
    ARCH-139 behaviour ("an unrecognized top-level key … gets ONE visible warning").
  - `src/main.ts:163` — `const note = RETIRED_CONFIG_KEYS[k];` is the same unguarded prototype lookup on a
    `Record<string, string>`; it is only unreachable *because* line 160 already swallowed those keys.
  - The rule is written down in this same iteration's other half:
    `src/workflow-meta.ts:503` (the new `RETIRED_AGENT_OPT_KEYS` branch itself) and `:507-509` use
    `Object.hasOwn`, the latter carrying the written-down rule: 「`Object.hasOwn`, not `key in` —
    `constructor` and `toString` are `in` every object literal and would be waved through」.
- **Severity honestly low:** no operator will name a config key `constructor`. It is listed because v34
  rewrote this exact block and chose the weaker predicate on one side of the same commit, which is how a
  rule that exists only as a comment decays.
- **Fix:** one word (`in` → `Object.hasOwn(...)`) plus the same on line 163.

---

## Known-open, deliberately NOT re-counted as findings

These are already recorded in the ledger with an owner and a destination; re-minting them would inflate
the violation count.

1. **`toErr()` drops `.detail`, so `detail.violation:'AGENT_OPT_RETIRED'` is unreachable at run level.**
   `src/agent-executor.ts:547` throws it; `src/run-manager.ts:150-156` keeps only `{code, message}`.
   ADR-062 chose the coded marker *specifically* so a cold client would not string-match, and DES-225
   rationale item 4 claims 「a client writes ONE branch that fires whether the retired key arrives at
   registration or at dispatch」 — true of the registration half (`workflow-catalog.ts:490`), not of the
   dispatch half. Recorded in `06-impl-log.md` IMPL-340 and in
   `tests/integration/resume-legacy-params.test.ts:141-149`, routed to v35 by TASK-229's corrected DoD (4).
   **Flagged for the gate owner only as: this is the one known-open item that makes a v34 *advertised*
   rationale partly false today.**
2. **`scanAgentCalls` false `AGENT_LABEL_REQUIRED` on a string literal containing `agent (`** — found
   while rewriting the DEPLOY.md recipe under the orchestrator ruling; registered for v35.
3. **`tests/fixtures/dashboard-wire.ts` keeps the legacy `systemPrompt` row behind a cast**, overriding
   ARCH-137's deletion table — that override is DES-225 rationale item 9, deliberate and correct
   (deleting it would test a straw man). Not a deviation.
4. **Ledger hygiene, not architecture:** `git status` shows `agents/researcher.md` and `agents/writer.md`
   deleted in the working tree and **uncommitted**; neither path appears on any IMPL's `files:` line.
   They are the sample `agentType` frontmatter files the deleted `src/agent-definitions.ts` loaded, so the
   deletion is right — it just has no ledger row. Worth one line in Gate 8's closeout.

## Where INV-V34-1..4 stand after this review

| Invariant | Held by the implementation? |
|---|---|
| INV-V34-1 (no invisible determinants) | Held for the deleted mechanism. **Residual inventory incomplete (AC-1) and the surviving residual's justification is wrong (AC-2).** |
| INV-V34-2 (frame = label + one enforced property) | **Held.** `FRAME_CLOSE_FORGERY` (`contract.ts:141`) unchanged, case-insensitive and whitespace-tolerant; `USER_INSTRUCTIONS_OPEN/_CLOSE` byte-identical (`resolve.ts:167-168`); the refusal is advertised on the tool surface (`tool-specs.ts:452-460`) and in the guide, not hidden. |
| INV-V34-3 (removal is forward-only) | **Held.** Legacy `systemPrompt` row reads without crashing (fixture + `dashboard-lib-agent` tests); `types.ts:529`'s stored `provenance` union still admits `'agentType'`. Note for the record: the invariant's own example list includes 「a legacy `HarnessDefaults`」, and DES-228 turns one such row into a terminal `LEGACY_REREGISTER` at `run-manager.ts:1039`. Literally compliant (it is read, then refused — not a crash), but the example is now misleading and should be amended when INV-V34-1 is. |
| INV-V34-4 (absence pinned by the compiler) | **Held where it applies:** `AGENT_OPT_KEYS` (`workflow-meta.ts:210-213`) and `KNOWN_FILE_CONFIG_KEYS` (`main.ts:85-95`) are both still `Record<keyof …, true>` with the field gone. Does not reach `harness-defaults.ts` (AC-3) or `src/dashboard/lib/*.js` (`allowJs` without `checkJs`) — the latter is why DES-225 rationale item 10 correctly refused to split TASK-229. |
