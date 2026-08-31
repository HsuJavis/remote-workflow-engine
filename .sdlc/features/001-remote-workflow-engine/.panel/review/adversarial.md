# Gate 8 review — Adversarial architecture group (security ⟂ scalability/perf ⟂ testability, Karpathy tie-break)

- **iteration:** v21 (tunable-parameter contract, REQ-090..095 → ARCH-064..070 + ADR-001..008)
- **compared:** `02-architecture.md` (ARCH-064..070, ADR-001..008, v21 interface table, decision rationale)
  vs `06-impl-log.md` IMPL-129..138 and the files those entries name.
- **scope discipline:** only the `files:` of IMPL-129..138 plus three module-boundary neighbours they
  directly reference (`src/secret-resolver.ts` `redact()`, `src/submission-validator.ts`,
  `src/store/sqlite-run-store.ts`). No full-tree scan.
- **adjudications honoured as design, not drift:** A-1..A-9, B-1..B-8, C-1..C-2, D-1..D-3
  (04-design.md:2724-2948). Nothing settled there is re-litigated below; where the *code* follows an
  adjudication but `02-architecture.md` was never amended, it is filed as doc-drift (F8), not as a
  code violation.
- **verdict:** **NOT consistent — 10 findings** (1 HIGH, 4 MEDIUM, 5 LOW).

**Headline.** The load-bearing v21 invariants hold and hold well: the closed `UserOverrides` type
(ADR-001), the admission rung sitting between `catalog.get` and `createRun` (ARCH-066), `CallKey`
byte-identical (ADR-002 — verified by `git diff master...HEAD -- src/run-manager.ts`, zero `CallKey`
hunks), the pinned resume snapshot, `thinkingFor` still the sole writer of `options.thinking`
(ARCH-069), the ceilings forwarded through `composeConfig()` (ARCH-066 inv-6 — the fifth instance of
that bug class genuinely closed), `additionalProperties:false` on the `overrides` schema, and
fail-closed registration. What did **not** hold is the *periphery* of those invariants: one adopted
decision produced no code at all (F1), and three of the invariants are true on the primary path but
false on a secondary path the ARCH text never enumerated — resume (F2), the harness transcript sink
(F3), nested `workflow()` frames (F4). All four are the same shape: **the invariant was implemented
where the design diagram drew it, and not where the system actually flows.**

---

## F1 — HIGH — the effective-model alias check at submission was adopted and never implemented; `validateUserOverrides`'s `aliasNames` is a dead parameter

**Violates:** `02-architecture.md:974` (*"Quality S-1 … adopted in reduced form … the effective
(post-merge) model is checked at submission with the existing alias rule … reuses the existing
`UNKNOWN_ALIAS` code … it stays — but as one call, not a subsystem"*), the v21 interface table
`02-architecture.md:959` (*"existing `UNKNOWN_ALIAS` for an unresolvable effective model — all
**before** any durable work"*), and ARCH-064's declared api `02-architecture.md:724`
(`validateUserOverrides(contract, raw, aliasNames, ceilings)`).

**Evidence:**
- `src/params/contract.ts:217-267` — `validateUserOverrides` takes `aliasNames: Set<string>` and
  **never reads it**. The only alias use in the module is `parseParamContract`
  (`contract.ts:159-165`), i.e. registration.
- `src/run-manager.ts:399` — `validateUserOverrides(contract, overrides, new Set(), this._ceilings)`:
  the call site hardcodes an empty set, which is only harmless *because* the parameter is dead.
- `src/submission-validator.ts:109-113` — the existing `UNKNOWN_ALIAS` rule scans
  `extractModelAliases(spec.script)` only; a named run carries no inline script, so neither the
  registered default nor the user override is ever alias-checked. This is exactly the hole
  `02-architecture.md:974` cites as its evidence for keeping the check.
- `src/gateway/client.ts:323` — the unresolvable alias surfaces at dispatch as
  `{ok:false, provider:'unknown', reason:'terminal'}` → `agent()` resolves `null`.

**Failure scenario.** `workflow_run({name:'nightly', overrides:{model:'gpt-5-turbo'}})` on any
workflow whose contract has no `model` enum (the canonical contract — i.e. every pre-v21 workflow and
every script with no `params` block) is **admitted**: a run row is written, a workspace is created, a
sandbox child is forked, a global concurrency slot and an agent-semaphore slot are taken, and then
every single `agent()` call returns `null`. The caller gets a run that fails opaquely instead of a
typed refusal before any durable work.

**Lens argument, with the conflict surfaced.**
- *Security:* fail-closed, no escalation — this is a robustness/DoS-adjacent defect, not a breach.
  The security lens alone would rate it LOW.
- *Scalability:* this is where it earns HIGH. v21 hands every authenticated principal a two-field
  JSON knob that reliably consumes a run row, a workspace directory, a sandbox process and a slot
  out of the D-DOS global semaphore, for a request that can never succeed. ADR-005 explicitly
  accepted cost amplification *within the ceilings*; it did not accept unbounded admission of runs
  that are dead on arrival, and `02-architecture.md:959`'s "before any durable work" is precisely the
  clause that was supposed to cover it.
- *Testability:* worst of the three. A parameter that is threaded, typed, documented in the ARCH api
  line, and never read is **the exact inert-wiring class this whole iteration exists to kill**
  (ADR-001's "a denylist … is one forgotten line away", ARCH-068's "omission must be a `tsc` error,
  not a silent no-op"). It even reproduces the `resolveHarnessParams` shape that IMPL-137 deleted for
  being a zero-caller function that looked wired.
- *Karpathy tie-break:* the fix is one call, as the rationale itself says — reuse
  `submission-validator`'s alias predicate (including the `openrouter/<id>` passthrough carve-out) on
  the post-merge effective model at `run-manager.ts:399`, and either use or delete the `aliasNames`
  parameter. Deleting a dead parameter is *also* an acceptable minimal outcome, but then
  `02-architecture.md:959,974` must be amended to record that the check was dropped — silently
  keeping the signature is the one option that is wrong under all three lenses.

---

## F2 — MEDIUM — a resumed run dispatches the **redacted** snapshot: replay divergence

**Violates:** ARCH-066 load-bearing invariant (5), `02-architecture.md:743`: *"the **dispatched** copy
is never redacted (DES-088 persist-only redaction / replay-divergence invariant)"*.

**Evidence:**
- `src/run-manager.ts:411-413` — `persistedParams = redact(effectiveParams, …)`; the live `RunEntry`
  correctly keeps the unredacted `effectiveParams` (`run-manager.ts:479`). Correct on the start path.
- `src/run-manager.ts:595` — on resume/rehydrate:
  `const effectiveParams = (await this._store.getEffectiveParams(runId)) ?? defaultRunParams(...)`.
  `getEffectiveParams` reads the persisted column (`src/store/sqlite-run-store.ts:89-92`,
  `src/run-store.ts:163`) — i.e. the **redacted** copy.
- `src/run-manager.ts:626` — that value becomes `entry.effectiveParams`, which
  `run-manager.ts:817` hands to every dispatch as `runParams`, and
  `src/agent-executor.ts:339` composes into the outbound prompt.
- `src/secret-resolver.ts:95-112` — `redact()` is a destructive substring replacement
  (`‹secret:NAME›`); there is no inverse.

**Failure scenario (scoped precisely).** A run is submitted with `overrides.appendPrompt` (or is
registered with a `defaults.prompt`/`defaults.model`) containing any configured secret value as a
substring. Before the restart, agents receive the real text. **After a process restart** — the
`_requireLive` rehydrate path at `run-manager.ts:572-627`, i.e. `workflow_resume` on a `suspended`/
`stopped`/`interrupted` run in a fresh process, and the REQ-059/060 boot re-hydration — the resumed
tail dispatches `‹secret:NAME›` in place of that text. Same run, same journal, silently different
model input. The same applies to `model`: an alias containing a secret substring resumes as an
unresolvable alias. *Same-process* resume is unaffected: `_requireLive` returns the cached entry
first (`run-manager.ts:570`) and nothing ever evicts it (`grep -n "_runs.delete" src/run-manager.ts`
→ no matches), so the live unredacted snapshot is reused. The divergence is therefore
restart-conditional, which is what holds this at MEDIUM rather than HIGH — but the restart path is
exactly the one REQ-059/060 added durability for.

**Lens argument.** *Security* is the lens that produced the redaction and it is satisfied on both
paths (nothing leaks). The damage is on the *correctness/observability* side that DES-088 named
explicitly as an invariant: the whole point of "persist-only redaction" is that the redaction must not
become an input. *Testability:* IT-075's sink-completeness sweep tests the write direction only; there
is no read-back test asserting that what resume dispatches equals what admission dispatched. The
minimal Karpathy-consistent fix is a single read-side decision — persist redacted **and** keep the
dispatchable copy out of band, or (cheaper, and the shape the codebase already uses for journals)
accept that resume cannot reconstruct redacted text and refuse/annotate rather than silently
substitute. Either way the current state is the one option ARCH-066 inv-5 forbids.

---

## F3 — MEDIUM — the v21 `appendPrompt` reaches a **second** persist sink (the `kind:'harness'` transcript event) with no secret redaction

**Violates:** ARCH-066 invariant (5) (*"the snapshot write is a NEW persist sink — it carries caller
text (`appendPrompt`) and MUST be routed through the ARCH-056 `redact()`-on-persist path and added to
the REQ-083 sink-completeness sweep"*, `02-architecture.md:743`) and adjudication B-4
(04-design.md:2850-2857, *"the non-negotiable item of the batch"*).

**Evidence:**
- `src/agent-executor.ts:339` — `composePrompt(def?.systemPrompt, req.runParams.prompt, req.prompt,
  req.runParams.appendPrompt)`: from v21 on, the composed prompt contains the user's `appendPrompt`
  **and** the author's `defaults.prompt`.
- That composed prompt is what both gateways put on the descriptor:
  `src/gateway/client.ts:331-337` and `src/gateway/claude-agent-sdk-client.ts:585-593`
  (`redactHarness({... prompt: req.prompt ...})`).
- `src/agent-executor.ts:17-45` — `redactHarness()` performs a **4096-char head/tail truncation
  only**. It does no secret-value redaction; its name asserts a property it does not provide.
- `src/agent-executor.ts:390-412` — the decoration site persists the descriptor via
  `store.appendTranscript(...)` with **no** `redact()` call, and `agent-executor.ts:419-424`
  deliberately excludes `kind === 'harness'` from the live-event redaction on the grounds of
  "double-redaction exclusivity (onHarness path above uses `redactHarness`)" — an exclusivity that is
  only sound if `redactHarness` redacted secrets, which it does not.

**Failure scenario.** `overrides:{appendPrompt:"use token sk-…"}` → the snapshot column is redacted
(inv-5 satisfied), but the identical text is written verbatim into `agent-<id>.jsonl` as the harness
descriptor's `prompt`, and served to any authenticated principal through `workflow_agent_log` and the
dashboard.

**Lens argument, including the internal conflict.** *Security* rates this the most consequential
finding in the set: REQ-083's sweep exists so that a *new* content source into a persist sink is
enumerated, and v21 added one (`appendPrompt`) to a sink it did not re-examine. *Karpathy pushes back
hard* — the pre-existing script prompt has always been persisted this way, so one could call this
"not a v21 regression, out of scope". I reject that reading on the evidence: B-4 was adjudicated
precisely on the argument that *this specific text can carry secrets*, and the argument does not stop
being true one function call downstream. *Testability* settles the tie: the cheapest fix is to make
the `kind !== 'harness'` carve-out unnecessary by running `redact()` over the decorated descriptor at
the one decoration site (`agent-executor.ts:404-410`), which is one line and makes IT-075's sweep
extendable to sink 6. Rating MEDIUM rather than HIGH only because exposure requires a configured
`SecretValueProvider` and a secret substring, and the audience is already-authenticated principals
(the ADR-008 residual).

---

## F4 — MEDIUM — nested `workflow()` frames run under the **parent's** snapshot: the callee author's `defaults` and declared `params` contract are never read

**Violates:** ADR-001/D12's author/user split (author configuration is enforced engine-side, per
workflow), ARCH-067's "the contract is stored on the version row … registration is the enforcement
point", and ADR-005's "ceilings/contract bound the user-override rung". ARCH-066/ARCH-068 are
**silent** on nesting, and no adjudication covers it — this is a genuine decomposition gap, not
adjudicated design.

**Evidence:**
- `src/run-manager.ts:744` — `_startNestedWorkflow` calls `this._catalog.get(name)` and consumes
  **only** `registered.script`. `registered.defaults` and `registered.params` are discarded (contrast
  `run-manager.ts:384-389` on the start path, which reads both).
- `src/run-manager.ts:809-817` — every nested agent dispatch passes `runParams: entry.effectiveParams`,
  the parent run's snapshot (IMPL-134 states this intent explicitly: *"shared by reference across
  every frame of a run including nested `workflow()` frames"*).
- `src/agent-executor.ts:316` (`resolveCallParams`), `:328-333` (`eff.tools` → `allowedTools`),
  `:339` (`req.runParams.prompt` → composed prompt).

**Three distinct failure scenarios.**
1. **Author config of the callee is silently ignored.** Workflow `B` is registered with
   `defaults.prompt`/`defaults.tools`; when `B` is invoked via `workflow('B')` from `A`, none of it
   applies. Pre-v21 this was invisible (`resolveHarnessParams` had zero callers, so registered
   defaults reached nobody); v21 wires defaults into dispatch and therefore *creates* the asymmetry —
   `B` run directly honours its defaults, `B` run nested does not.
2. **Tool-surface substitution across an ownership boundary.** `A.defaults.tools` becomes the
   `allowedTools` of `B`'s agents (`agent-executor.ts:330-333`). Since v15 gave workflows owners
   (`NOT_WORKFLOW_OWNER`), one owner's harness configuration now silently governs another owner's
   agents. If `A.defaults.tools` is wider than what `B`'s author granted, that is a widening.
3. **The callee's declared contract is bypassed.** `B` may declare
   `params.knobs.effort.enum:['low']` or a `model` enum; the user's `overrides` were validated only
   against `A`'s contract at admission, so a `workflow('B')` frame executes `B`'s agents at knob
   values `B`'s author explicitly refused. `ARCH-067`'s enforcement point does not exist on this path.

**Lens argument.** *Security* wants per-frame re-resolution against the callee's row. *Scalability
and Karpathy push back*: re-resolving per frame means a catalog read and a merge per nested call, and
a per-frame snapshot breaks ADR-002's "one run-immutable snapshot" clean story. *Testability*
breaks the tie toward the cheap option: the minimum that closes scenarios 1 and 3 without a new
subsystem is to validate the parent's `UserOverrides` against the **callee's** contract at
`_startNestedWorkflow` (the row is already being read at `run-manager.ts:744`) and to fold the
callee's own `defaults.prompt`/`defaults.tools` for that frame — the same two functions
(`validateUserOverrides` + `mergeRunParams`), no new module. Whatever is chosen, the decision belongs
in the ARCH text: today's behaviour is undocumented and untested at the nesting boundary.

---

## F5 — MEDIUM — two `mapEffort` implementations; ARCH-065's "the ONLY effort translator" lives in a module with zero production callers

**Violates:** ARCH-065 api/note (`02-architecture.md:733-734`): `mapEffort` is declared as part of
`src/params/resolve.ts` and *"`mapEffort` is the ONLY effort translator"*; the v21 development view
(`02-architecture.md:883`) draws `GC --> R` (gateway clients depend on `resolve.ts`). Not covered by
any adjudication — A-7 (04-design.md:2782-2788) adjudicated the *identity mapping* and the *wire
mechanics*, not the module the mapper lives in.

**Evidence:**
- `src/params/resolve.ts:144-157` — `ProviderEffortProfile` + `mapEffort` (the richer
  `{param, values: Record<Effort, unknown>}` table shape the ARCH api declares).
- `grep -rn "params/resolve" src/` — the only importers are `agent-executor.ts:9`,
  `run-manager.ts:43`, `run-store.ts:7`, `sqlite-run-store.ts:10`, and **none of them imports
  `mapEffort`**. Zero production callers; its only exercise is `tests/unit/params-resolve.test.ts`.
- The wired mapper is a different function with a different profile shape:
  `src/gateway/client.ts:27-49` (`EffortProfile {param}`, `EFFORT_PROFILES`, `profileFor`,
  `mapEffort`), imported by `src/gateway/claude-agent-sdk-client.ts:19` and called at
  `client.ts:327` / `claude-agent-sdk-client.ts:509`.
- IMPL-138 records exactly this as *"Observation, not acted on"* — so the state is known and
  deliberate, but no ARCH/adjudication sanctions it.

**Lens argument, conflict explicit.** *Security:* untouched — the wired copy correctly preserves
"recorded ≡ applied by object identity" (`client.ts:327,336,338`; `sdk-client.ts:509,581,596`), which
was the property REQ-093 actually needed. *Testability:* this is a false-coverage trap of the first
order — `params-resolve.test.ts` green-lights a `mapEffort` that ships to nobody, so the suite reports
coverage of a translator the product does not use, while the shipped translator's value semantics
(identity pass-through, no value table) are covered only by `gateway-effort.test.ts`. A future
maintainer reading ARCH-065 will edit the wrong file. *Karpathy:* two implementations of one concept,
one of them dead, is strictly more code than the design called for — and IMPL-138's own precedent
argument ("`session-options-builder.ts` is also fenced with zero importers") does not transfer:
that module is a *tracked debt item with an ADR (ADR-006) fencing it*, whereas this duplicate has no
ADR and directly contradicts an ARCH sentence containing the word "ONLY". Minimum fix: delete
`resolve.ts:144-157` and its unit block (the wired one wins on evidence), or amend ARCH-065 + the
development-view arrow to state that the mapper lives in `src/gateway/client.ts`. Do not leave both.

---

## F6 — LOW — the engine ceiling defaults are triplicated, so the advertised bound and the enforced bound can drift

**Violates:** ARCH-064's stated reason for existing (`02-architecture.md:725`: *"ONE pure,
dependency-free module is the single place that knows the contract vocabulary … so the locked-key list
and the bound-checking rules cannot drift into three copies"*) and the spirit of adjudication A-3
(04-design.md:2749-2758, "one test pinning that the advertised bound and the enforced bound are the
same number").

**Evidence:** three independent definitions of the same three numbers —
`src/run-manager.ts:105` (`DEFAULT_CEILINGS`, admission/enforced),
`src/mcp-facade.ts:20` (`DEFAULT_CEILINGS`, `workflow_get`/`workflow_list` advertised),
`src/server.ts:1184-1186` (inline literals at the composition root).
The `Ceilings` **type** lives in `src/params/contract.ts:39-43` — the module ARCH-064 designates as
the owner of the vocabulary — but the values do not.

**Lens argument.** *Testability/self-sustainability* only; no security or scalability impact today
because the three copies currently agree and `server.ts` overrides both at the composition root.
Karpathy would normally shrug at three literals — but the *specific* property A-3 asked to be pinned
is "advertised == enforced", and it is currently guaranteed by copy-paste rather than by
construction. One exported `DEFAULT_CEILINGS` in `contract.ts` consumed by all three is strictly less
code than what is there now, so simplicity and testability agree for once.

---

## F7 — LOW — `workflowLabel()` is non-injective, so `issue_list({workflow})` can return another workflow's reports

**Violates:** ARCH-070 note (3) (`02-architecture.md:779`: *"`issue_list({workflow})` tolerates an
unregistered name **symmetrically** with `issue_report` so report-then-list round-trips"*) — the
symmetry assumes a 1:1 name↔label mapping that the implementation does not provide.

**Evidence:**
- `src/github/issue-reporter.ts:169-170` —
  `` `workflow:${name.replace(/[^A-Za-z0-9:_./-]/g,'-')}`.slice(0,50) `` : a lossy character
  substitution followed by a hard truncation.
- `src/github/issue-reporter.ts:158-160` — `issueFingerprint` hashes the **raw** `workflow` name.
- `:438` (report labels) and `:479` (list filter) both key on the sanitized label.

**Failure scenario.** Workflows named `team a/report` and `team-a-report`, or any two names sharing
their first ~40 characters after the `workflow:` prefix, collapse to one GitHub label. Dedup still
separates them (fingerprint uses the raw name → two issues, correctly), but
`issue_list({workflow:'team a/report'})` returns **both**, exposing the other workflow's `repro` /
`analysis` / `log` body text — author- and principal-attributable content — to a caller who named a
different workflow.

**Lens argument.** *Security:* a small cross-tenant read amplification on an already
authenticated-only surface; LOW, not more. *Karpathy:* A-5 was right that inventing a
registration-name predicate is scope creep, and I am **not** asking for one — the fix is to make the
label injective for the cases that matter (e.g. append a short hash of the raw name when
sanitize/truncate changed it), or to record the collision as an accepted residual in ARCH-070. The
current text claims a symmetry the code does not have, which is the part that must not stand.

---

## F8 — LOW — `02-architecture.md` was never amended for four adjudicated departures (doc drift, code is correct)

The code follows the adjudications; the architecture document still describes the pre-adjudication
design. Filed so Gate 8's trace chain is not left pointing at retracted text.

| stale ARCH text | adjudication | shipped reality |
|---|---|---|
| `02-architecture.md:760` + interface table `:961` — `HarnessDescriptor` gains `appendPromptBytes?, promptTruncated: boolean` | **B-2** (04-design.md:2826-2831) drops both | `src/types.ts` / `agent-executor.ts:394-400` carry `effort/effortApplied/timeoutMs/provenance` only |
| `02-architecture.md:725` inv-5 — bounds the author literal by *"byte size + nesting depth"* | **B-1** (04-design.md:2819-2824) drops the depth bound | `src/workflow-meta.ts:43,57` byte bound only |
| `02-architecture.md:779` note (1) — the name *"IS charset/length-validated with the same rule workflow registration already enforces"* | **A-5** (04-design.md:2766-2773): no such rule exists; label-scoped sanitize only | `src/github/issue-reporter.ts:163-170` |
| `02-architecture.md:733` api — `composePrompt(systemPrompt, scriptPrompt, appendPrompt?)` (3 args) and `ProviderEffortProfile {param, values}` | 4-segment composition is DES-102/IMPL-131 design; **A-7** adjudicated the identity mapping | `src/params/resolve.ts:131-142` (4 args) and `src/gateway/client.ts:27-49` (`{param}`, identity) |

**Lens argument.** Pure *self-sustainability/testability*: the next iteration's implementer reads
`02-architecture.md` first (that is what this gate compares against), and four of its api lines now
describe code that does not exist. Cost to fix is four edits; the alternative — a second reviewer
re-deriving the adjudication chain from 04-design.md's tail — is the archaeology this ledger's
provenance discipline exists to prevent.

---

## F9 — LOW — `parseParamContract` does not normalize a `ParamSpec`: unknown/nested author fields are stored and served verbatim, contradicting B-1's stated rationale

**Violates:** ADR-004 (`02-architecture.md:800-803`, *"evaluate once at registration and persist
**normalized** JSON"*) and the factual premise of adjudication **B-1** (04-design.md:2822-2824:
*"`ParamSpec` is a flat shape, `parseParamContract` reads only known scalar/array fields, and any
nested key a caller invents is inert (never read, **never served**)"*).

**Evidence:** `src/params/contract.ts:166` (`knobs[key] = spec;`) and `:174`
(`const args = { ...argsIn };`) copy the author's spec objects **wholesale**, including any field
`ParamSpec` does not declare and any nesting under it. That object is `JSON.stringify`'d into the
`params` column (`src/workflow-catalog.ts:121,168`) and served on every `workflow_get` /
`workflow_list` through `readParams` → `effectiveBounds` (`src/mcp-facade.ts:24-25`, `:196`, `:217`),
which likewise spreads specs (`contract.ts:92,98,110`) without stripping.

**Lens argument.** *Security/scalability:* impact is genuinely small and bounded — the pre-eval
4096-byte source cap (`src/workflow-meta.ts:43,57`) limits what an author can smuggle in, and the
author is a trusted, owned-row principal. So B-1's *conclusion* (drop the depth bound) survives.
*Testability/honesty:* the *reason* recorded for dropping it is false in the shipped code, and a
future reader will rely on "never served" when it is served. Either strip specs to the declared
`ParamSpec` fields during parse (three lines, and it makes ADR-004's word "normalized" true), or
correct B-1's rationale to "bounded by the 4096-byte source cap" — which is the argument that
actually holds.

---

## F10 — LOW — the effort dial is identity-mapped with no value-set validation on the un-ceilinged (author/script) rung

**Violates:** nothing outright — ARCH-069 (`02-architecture.md:770`) says *"a provider profile entry
maps the ordinal to that backend's parameter"* and ARCH-065's api declares a
`values: Record<Effort, unknown>` table; A-7 adjudicated identity mapping for `anthropic`
specifically. Recorded as a **residual risk on the rung ADR-005 deliberately left unbounded**, not as
a code defect.

**Evidence:** `src/gateway/client.ts:32-33` (`anthropic: { param: 'effort' }`), `:46-49` (identity
pass-through of the engine's own 5-level vocabulary), `:126` (`effortBodyFields` spread into the
request body on both LiteLLM branches, `:156` and `:293`), `src/gateway/claude-agent-sdk-client.ts:581`
(written onto the built `Options`). The only per-call check is shape-only:
`src/agent-executor.ts:293` (`isEffort`). `src/server.ts:154` records the engine's own posture —
*"maxEffort 'high' (so xhigh/max are refused …)"* — but per ADR-005 that ceiling binds **user
overrides only**, so a script's `agent({effort:'max'})` reaches the wire unbounded.

**Lens argument.** *Security:* none. *Scalability/cost:* the author rung is trusted by design, so the
cost exposure is accepted. The concern is the **D-F6 regression class** ARCH-069 was written to avoid:
if the backend's accepted value set differs from the engine's five-level vocabulary, an author-side
`xhigh`/`max` produces a provider 4xx on every call — the same shape as the shipped
unconditional-extended-thinking defect, on the one rung no ceiling filters. I could not verify the
provider's accepted set from inside this review, so this is flagged structurally, not asserted as a
live bug; the value table ARCH-065 originally specified is exactly the mechanism that would make it
unrepresentable. *Karpathy:* do **not** build the table speculatively — one cheap alternative is to
let the `EffortProfile` carry the provider's accepted set and record `{applied:false, reason}` (the
honest no-op path that already exists at `client.ts:48`) for values outside it.

---

## What was checked and found CONSISTENT (recorded so the next reviewer does not re-derive it)

- **ADR-001** — `UserOverrides` closed (`contract.ts:32-37`); `validateUserOverrides` rejects locked
  keys `PARAM_LOCKED` (`:228-235`) and unknown keys `PARAM_UNKNOWN` (`:236-243`) rather than ignoring
  them; the MCP schema is allowlisted at the other end with `additionalProperties:false` and exactly
  the four properties (`server.ts:326-338`). A locked key is unrepresentable end to end.
- **ARCH-066 insertion point** — the rung sits between `catalog.get` (`run-manager.ts:384`) and
  `createRun` (`:415`)/`runWorkspace` (`:416`); every pre-existing rung (scriptSha, admission limit,
  seed shape, seed source) is above it and unmoved. Rejection leaves no run row, no workspace, no
  sandbox.
- **ADR-002** — `CallKey` construction untouched (`run-manager.ts:774`; `git diff master...HEAD --
  src/run-manager.ts` shows no `CallKey` hunk); resume reads the pinned snapshot and does **not**
  re-resolve from the current catalog row (`:595`), with the legacy-NULL fallback (mechanically
  correct — see F2 for the redaction consequence).
- **ARCH-066 inv-6** — all three ceiling keys forwarded in `composeConfig()` (`main.ts:162-164`) and
  one `ceilings` object passed to **both** consumers (`server.ts:1183-1189` RunManager, `:1206`
  McpFacade). The fifth instance of the recurring wiring bug class is genuinely closed; the same
  commit also closed four older instances (`maxBlobBytes`/`webhookDbPath`/`casDir`/
  `continuationDbPath`).
- **Ceilings refuse, never clamp** — `contract.ts:249-256` (appendPrompt bytes, reported by size and
  never by content), `:90-99` (`boundTimeoutMs`/`boundEffort` computed at read time from live config,
  so a lowered ceiling applies with no re-register), `:189-212`.
- **ARCH-067** — idempotent `ALTER TABLE workflows ADD COLUMN params` (`workflow-catalog.ts:86-88`);
  parse + A-2 cross-validation before **any** DB write, nothing stored on rejection (`:115-142`);
  `ON CONFLICT … params = excluded.params` closes the stale-contract trap (`:160-168`); read surfaces
  never serve null/unbounded (`mcp-facade.ts:24-25`).
- **ARCH-064 inv-5 (pre-eval bound)** — `workflow-meta.ts:57` checks the byte size of the matched
  literal *before* `runInNewContext` (`:67`), one eval site, registration only.
- **ARCH-068** — `AgentReq.runParams` is required with no default (`agent-executor.ts:120`), built at
  exactly one production site (`run-manager.ts:817`), so omission is a `tsc` error; provenance is
  emitted by the function that computes each value (`resolve.ts:74-119`), never inferred by
  comparison; one decoration site (`agent-executor.ts:390-412`) that never overwrites
  `descriptor.model`/`provider`; the invalid-per-call-`effort` guard **records then throws**
  (`:293-301`), so it cannot degrade to a silent `null` through `parallel()`'s swallow.
- **ARCH-069 top risk avoided** — `thinkingFor` remains the sole writer of `options.thinking`
  (`claude-agent-sdk-client.ts:325,532`); the mapped object travels by identity to both the wire and
  `onHarness` (`client.ts:327→336,338`; `sdk-client.ts:509→581,596`); `effortBodyFields` is applied on
  **both** LiteLLM branches (`client.ts:156` direct fetch, `:293` proxy). ADR-006's fence holds:
  `grep -rn session-options-builder src/` yields only a comment reference (`resolve.ts:145`), zero
  importers.
- **ARCH-070** — the workflow label enters the dedup fingerprint (`issue-reporter.ts:158-160,416`),
  absent-`workflow` output stays byte-identical to pre-v21, no existence check (per A-5).
- **IMPL-138's simplify claim** — verified: no `descriptor.effortApplied` pre-write remains in
  `claude-agent-sdk-client.ts`; the `LiteLLMGatewayClient` spread at `client.ts:336` is genuinely
  live and correctly left alone.

## Karpathy tie-break summary

Nothing in v21 is over-built. The slice is what it claimed: two pure modules, one column, one
snapshot field, one rung, one required argument, three config keys, one label. Every finding above is
either **under-built** (F1, F2, F3, F4 — an invariant that holds on the drawn path and not on a real
one) or **duplicated** (F5, F6, F9 — two of a thing the design said there would be one of). The
recommended fixes total roughly: one call, one read-side decision, one line, one merge at the nesting
boundary, three deletions and four doc edits. No new module, port, table or subsystem is warranted by
any of them — and F1's fix is literally the "one call, not a subsystem" the architecture rationale
already promised.

## Suggested disposition

- **Must fix before merge:** F1 (an adopted decision that produced no code, plus a dead parameter that
  reproduces the very bug class of the iteration).
- **Fix or explicitly accept with a recorded residual:** F2, F3, F4, F5.
- **Doc/cleanup, safe to batch:** F6, F7, F8, F9, F10.
