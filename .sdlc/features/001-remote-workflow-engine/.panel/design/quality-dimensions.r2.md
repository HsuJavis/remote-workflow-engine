# Design panel r2 — quality-dimensions lens (observability / replaceability / consumability / self-sustainability)

- **stage:** Design (Gate 3+4) — round 2, convergence
- **inputs read:** `adversarial.r1.md` (full), my `quality-dimensions.r1.md`. Only two r1s exist in the panel dir.
- **verification note:** the four adversarial citations my concessions rest on were re-checked against
  source before this round, not taken on faith: `workflow-catalog.ts` `get()` = `SELECT script, version`
  only; the `ON CONFLICT(name) DO UPDATE` clause updates `script/version/createdAt/defaults` and omits
  `owner` by design; `agent-executor.ts` appends the `=== OUTPUT FORMAT (REQUIRED) ===` block and the
  retry nudge *after* the composed prompt; `gateway/client.ts` resolves `this._config.aliases[aliasName]`
  inside `invoke()` and emits the descriptor from an inline literal with its own `PROMPT_CAP=4096/HALF=2048`
  constants. All four check out. Adversarial's primary-source findings are facts; I treat them as such.

## 0. Headline disposition

Adversarial r1 and my r1 agree on far more than either predicted: the `thinkingFor` collision (their B-6 =
my O-4/F-1), provenance-emitted-by-the-resolver (their T-6 = my O-1/S-7), script-supplied-effort as a
catchable pre-dispatch throw (their I-5 = my O-6), same-task config wiring (their T-D = my S-3), the
fingerprint compat pin (their T-7 = my task-constraint 5), and Gate-2 residuals held as settled (their §4
"accepted" = my "recorded residuals"). The friction they predicted from my lens — telemetry, richer
non-owner exposure — does not exist: my r1 already held ADR-005/007/008 as closed. What follows is a
per-finding disposition, then my final position stated under the four mandatory dimension headings.

## 1. Responses to adversarial r1 (rebut / concede / hold)

| Their item | Disposition | Reason |
|---|---|---|
| I-1 widen `catalog.get()`, first task | **Concede (verified)** | Fact: narrow `get()` makes ARCH-066's "no second query" unimplementable and leaves the nested `workflow()` path without defaults/contract. Option (a) over (b) is right — `getFull()` leaks `owner` into the run path and two row-read shapes is where drift starts. My R-2 task ordering amends to: T-A first, then contract/resolve. |
| I-2 nesting semantics | **Concede the gap; endorse their conditional recommendation, with an observability rider** | My r1 missed nesting entirely. Position: the three harness knobs do NOT propagate (child-contract integrity — validated against the parent's contract only); `appendPrompt` DOES propagate (REQ-094's "any `agent()` in that run" reads on the frame tree, and it is structurally powerless per ADR-007). Rider that makes this my lens's business: propagation must be *visible*, not inferred — the child's descriptors record `provenance.appendPrompt:'override'`, and one Gate-7.5 scenario runs a nested workflow with an appendPrompt and asserts it on a child descriptor. See §2.4 for the run-boundary half of the rule. This is now a **joint recommendation**, not a dispute. |
| I-3 optional DTO fields, decoration at `onHarness` merge site | **Concede** | Their empirical case is correct (two descriptor construction sites; historical records lack the fields; `provenance` is knowledge the gateway does not have). It also *strengthens* my O-1: the executor-side merge closure is exactly "the descriptor writer receives `EffectiveCallParams`, not the raw inputs" — one decoration site is the same-object invariant, realized. Bonus I endorse loudly: switching `gateway/client.ts`'s inline literal to `redactHarness()` collapses the duplicated 4096/2048 cap to one implementation (my O-5's pinned truncation test then guards one site, not two). Tri-state `effortApplied` schema from my O-5 is unchallenged and stands. |
| I-4 `mapEffort` runs in the gateway; applied object returns via `onHarness(descriptor, applied?)` | **Concede, and restate the merged invariant** | Verified: provider is only resolvable gateway-side. Their option (b) preserves the invariant that actually matters. Merged statement for the DES: `resolveCallParams` (executor) is the single construction site for `{model, effort, timeoutMs, appendPrompt, provenance}`; `mapEffort` (one pure function in `src/params/resolve.ts`, imported by both gateway clients, called once per invoke) is the single translation site; at **every** seam the *object* travels — resolver→dispatch, mapper→wire, mapper→`onHarness` second argument→descriptor merge. Recorded ≡ applied by object identity at each handoff; re-derivation anywhere recreates the echo-not-wire class. Their rejection of a `resolveTarget` interface method is right (my R-4 never asked for one). |
| I-5 error surface for script-supplied bad effort | **Converged** | Identical to my O-6: coded, catchable, pre-dispatch, no harness event, `CallKey`/ADR-002 untouched. Use their `PARAM_OUT_OF_RANGE` coding on the thrown error for one-taxonomy consistency. |
| I-6 `overrides` never on `RunSpec`; `start(spec, overrides?)` | **Concede — a strict improvement for my O-2/F-2** | One durable representation (the redacted snapshot) means one sink to redact, one sweep row, one thing the resume path can even be tempted by. Note for §3: this also makes the F-2 alternative (a second, unredacted persisted copy) strictly worse than in r1 — there is now deliberately no raw durable copy anywhere. |
| I-7 `workflow_list` reads `params` from the column | **Concede** | Consumability: the list surface and the get surface must not have two derivations. Description re-parse recorded as inherited debt with a v22 owner — fine. |
| B-1 total condition→code→payload table | **Concede/adopt as the design's spine** | This is the artifact my C-1 asked for, done properly (total over ≥8 conditions, not just three shapes). One amendment carried from my C-1: `allowed` stays machine-shaped (`{enum:[…]}` or `{min?,max?}`), which their rows already imply. |
| B-1a never echo free-text values; bytes + `suppliedTruncated` | **Concede — my r1 missed it** | It bounds my C-1 self-repair claim correctly: "4096 bytes, max 1024" is fully actionable; echoing 1 KB of unscreened caller text into logged envelopes is a new leak surface. Adopted as stated. |
| B-2 knob default derived from `defaults` column, cross-validated at registration | **Concede, with one normalization line they did not specify** | Derivation beats authority-splitting; a value that cannot diverge after storage needs no reconciliation story. The unspecified case: an author declares `params.<knob>.default` with **no** corresponding `defaults.<knob>` entry. That must be **accept-and-normalize** (write it into the stored defaults as if declared there), not reject — REQ-090 explicitly documents `default` in the params vocabulary, and rejecting the documented spelling is a consumability lie. Divergent *pair* → typed rejection, per their proposal. `workflow_get` serves the one derived value. |
| B-3 `workflow_get` serves `min(author bound, engine ceiling)` computed at read time | **Concede — and it triggers my O-3 concession** | This closes the discoverability lie better than my `source` field explained it. **Conditional withdrawal:** with B-3 landed, the caller's repair action is identical whichever side imposed the bound, so `PARAM_OUT_OF_RANGE.source` is no longer worth its string — withdrawn. **Iff** the synthesizer drops B-3, `source` returns, because then the served bound and the enforced bound can disagree and the error must say who to believe. The coupling must not be silently halved. |
| B-4 `EFFORT_RANK` in `contract.ts`; DEPLOY documents refused-by-default levels | **Converged** | Identical to my S-4 (single ordering table) + my C-3 (docs=behavior, refuse-don't-clamp documented). |
| B-5 resume: presence of `overrides` field is a typed error, no equality semantics | **Concede** | Simpler than inv-2's "new or changed" reading, same guarantee, three untestable edge cases deleted. Composes with my S-2 fallback (below). |
| B-6 `thinkingFor` stays sole writer of `options.thinking`, takes effort as input | **Converged — adopt their phrasing** | Same finding independently (my O-4/F-1). "Sole writer, effort directive as an input" is sharper than my "compose with, never override" and is the sentence the DES should carry. Their regression pin (non-Anthropic alias + `effort:'max'` ⇒ `options.thinking` byte-identical to today) merges with my Gate-7.5 requirement (same scenario real-tier, asserting `effortApplied:{reason}` and no 400). |
| B-7 four-segment prompt order; REQ-094 "last" means last *content* segment | **Concede (verified), with the T-8 interaction neither r1 stated** | Their option (i) is right; moving the schema block would re-open the D-V4 OpenAI conformance defect. But T-8 (also theirs) adds a `defaults.prompt` segment — so the pinned order is **five** segments: system / author-default-prompt / script / user-appendPrompt / engine-protocol (schema block + retry nudge). Pin the full five-segment order in one test. And scope the compat pin precisely: my S-1(a) byte-identity test remains **as-is** for the no-`defaults.prompt`, no-`appendPrompt` case (byte-equal to today's composition) — the segment-order pin is a *separate* test, not a restatement, or the regression immune system weakens exactly when the composition grows. |
| B-8 admission placement covers all five `start()` callers; webhook args-validation behavior change | **Concede/adopt** | Fail-closed at trigger time is right and attributable. The DEPLOY note rides my C-3 living-documents row; one test as they specify. |
| B-9 `defaultRunParams` factory; chained runs never inherit the parent's snapshot | **Concede — and claim the self-sustainability half** | The `?? {}` reflex at four call sites is precisely the inert-default class. Their chained-run test (no silent `appendPrompt` inheritance) is the run-boundary half of the propagation rule I state in §2.4. |
| B-10 concrete registration bounds (4 KB / 32 knobs+args / 32 enum / depth 4) | **Concede** | Any number beats none; these are generous; testable. |
| T-1 required field on `AgentReq` + the `_spawnerOverride` seam | **Concede** | Refines ARCH-068's ambiguity toward where `tsc` actually bites; the spawner-seam carve-out is the kind of one-word omission my S-7 tripwire exists for — belongs in DES text as they ask. My task-constraint 3 (no split from dispatch wiring) is unchanged and compatible. |
| T-2 three named observables for the pre-durable-work test | **Converged** | I endorse the exact three (store count / no run dir on the filesystem / zero spawns). This is "name the Gate-7.5 assertions in advance" (my S-7) applied at the unit/integration tier. |
| T-3 pre-commit REQ-093's real-tier evidence plan now | **Concede/adopt** | Ollama has no reasoning dial, so real-tier green = the honest no-op branch on Ollama **plus** mapped-value assertions at the injected seams (both clients, parameterized — my R-3's test shape). Deciding at Gate 3/4 costs a paragraph; at Gate 7.5 it costs a round (VAL-003 precedent). |
| T-4 split pre-eval source-size guard from post-eval structural guard | **Concede (their signature argument is airtight)** | `metaParams: unknown` only exists after evaluation; the split keeps `parseParamContract` pure, which is what keeps my R-2 table-driven tests honest. |
| T-5 `params = excluded.params` + re-register test; NULL-params migration test | **Concede (verified)** | The omitted-`owner` pattern is a real trap I confirmed at source. Their NULL-`params` read-back test is my C-2 invariant applied at the migration boundary — same canonical-unconstrained-contract shape. Note the scope boundary in §2.4: T-5 covers catalog NULL `params`; it does **not** cover run-row NULL `effectiveParams` on resume (my S-2), which remains unowned. |
| T-6 provenance from the resolver's single pass | **Converged** | Identical to my O-1; their value-collision argument (two rungs holding `sonnet`) is the concrete case that makes inference-by-comparison a liar. 20 table cases + 1–2 IT, agreed. |
| T-7 absent-`workflow` fingerprint byte-identity | **Converged** | Matches my task-constraint 5's regression test; their compat pin is the sharper half. |
| T-8 the locked trio (`defaults.prompt/tools/skills`) is unplaced | **Concede — the biggest thing my r1 missed** | REQ-092's closing clause has no ARCH home; shipping it inert repeats the exact class v21 exists to close. Adopt: `mergeRunParams` folds all five registered keys into the snapshot (three author-only — trivially user-unreachable since `UserOverrides` cannot spell them, ADR-001); `composePrompt` gains the author-prompt segment at the pinned position (B-7 interaction above); descriptor `tools`/`skills` carry provenance; `defaults.tools` sits directly below agentType in the tool-surface precedence. And their sequencing constraint is the part my lens co-signs hardest: `resolveHarnessParams` is deleted only **after** `mergeRunParams` subsumes it — deleting the shape beats documenting why not to use it. |

**Their expected disagreements with me, answered:** (1) more telemetry/exposure surfaces — no push; my r1
already held ADR-008 closed, the only ask was the `source` string, now conditionally withdrawn per B-3.
(2) contract expressiveness — I take exactly the `description` field they pre-accepted (optional, pure
documentation, serves the agent caller reading `workflow_get`); I ask for nothing that branches at run
time. (3) their I-3/T-1 "softening" — not backsliding; conceded above with reasons. (4) I-4 — conceded;
I never wanted the `resolveTarget` seam. (5) I-2 — position taken above, jointly.

## 2. Final position — the four dimensions

### 2.1 Observability

- **Same-object end to end (merged O-1 + their I-4/T-6/I-3):** `resolveCallParams` = single construction
  site (params + per-key provenance from one pass); `mapEffort` = single translation site (pure, in
  `src/params/resolve.ts`, imported by both gateway clients); the applied object returns via
  `onHarness(descriptor, applied?)`; the executor-side merge closure is the single descriptor-decoration
  site and receives `EffectiveCallParams` — never the pre-resolution inputs. Object identity at every
  handoff; no re-derivation anywhere.
- **Per-client "wire" pinned (O-4 + B-6):** LiteLLM client — mapped `{param, value}` on the request body,
  spy-asserted `low` vs `max`. SDK client — `thinkingFor` remains the **sole writer** of
  `options.thinking` and takes the effort directive as input; non-Anthropic aliases get the explicit
  `{applied:false, reason}` no-op, thinking stays disabled, pinned byte-identical at `effort:'max'`.
- **Descriptor delta (O-5, DTO-optional per I-3):** `effort?`, tri-state `effortApplied?`, `timeoutMs`,
  `appendPromptBytes?`, `promptTruncated`, per-key `provenance` — decorated at the one merge site;
  `gateway/client.ts` switches to `redactHarness()` so the truncation cap has one implementation.
- **Errors are the observability for rejections (C-1 + B-1/B-1a):** the total condition→code→payload
  table is the design's spine; `allowed` machine-shaped; free-text values reported as bytes, never
  content; `source` withdrawn iff B-3 lands.
- **Named assertions before the tests exist:** T-2's three observables; the Gate-7.5 per-rung provenance
  assertions (S-7); the nested-run appendPrompt-provenance scenario (§1 I-2 rider); the REQ-093
  real-tier plan pre-committed per T-3.

### 2.2 Replaceability

- **One contract vocabulary, one owner (R-2):** `contract.ts`/`resolve.ts` standalone and first (after
  T-A); no consumer re-declares key lists or bounds; MCP schema/descriptions generated under the
  ARCH-051 drift-lock. `EFFORT_RANK` lives once, next to `isEffort()` (S-4 = B-4).
- **Backend swap stays a config row (R-3):** contract `model` enums reference alias names, validated at
  registration; effective model re-checked at submission via `UNKNOWN_ALIAS`. New provider with a dial =
  one `ProviderEffortProfile` entry; without = one explicit no-op entry. The gateway effort contract test
  is parameterized over both `GatewayClient` impls so a third client inherits it.
- **No new seams for their own sake:** `resolveTarget` rejected (with adversarial); one pure `mapEffort`,
  two import sites. `ProviderEffortProfile` typed apart from the fenced `effortMapping`; the
  zero-`src/`-importer tripwire test on `session-options-builder.ts` stands (R-1) — one grep-shaped
  assertion that retires when the security-hardening track wires the module deliberately.
- **Delete the rival shape (their T-8/cleanup, co-signed):** `resolveHarnessParams` retired in-sequence
  after `mergeRunParams` subsumes the author-side path.

### 2.3 Consumability

- **Discovery never lies:** NULL `params` serves the canonical unconstrained contract at every read
  surface — `workflow_get`, `workflow_list` (column, not re-parse — I-7), and the migration read-back
  (T-5). Bounds served are **effective** bounds, `min(author, ceiling)` computed at read time (B-3).
  Knob defaults have one derived source (B-2), with the accept-and-normalize rule for
  `params.<knob>.default` declared alone — the documented vocabulary is never rejected for being used.
- **Errors self-repair in one bounce:** total table (B-1); machine-shaped `allowed`; bytes-not-content
  for free text (B-1a); resume refuses the `overrides` field by presence (B-5); registration rejections
  typed with nothing stored, against concrete bounds (B-10).
- **Contract gains `description` (optional, documentation-only)** — the one expressiveness item taken;
  nothing that branches at run time.
- **Docs = behavior, generated (C-3):** overrides inputSchema (`additionalProperties:false`, four
  properties, effort enum inline) generated from ARCH-064 types under drift-lock; DEPLOY §1 rows for the
  three config keys including refuse-don't-clamp, refused-by-default effort levels (B-4), and the
  webhook/schedule args-validation behavior change (B-8). appendPrompt cap semantics per my C-4 (raw
  text, byte-measured, pre-frame; frame is an exported drift-locked constant). Issue tools reuse the
  registration-name predicate, no transcribed regex (C-5). No plugin change (C-6).

### 2.4 Self-sustainability

- **One propagation rule, stated once (merging I-2 + B-9 + S-6):** `appendPrompt`'s scope is the run's
  frame tree — it propagates into nested `workflow()` (visible via child provenance, charged to the same
  run budget, so my S-6 fan-out budget test extends to nesting for free) and **dies at the run
  boundary**: chained runs (continuation-store), webhooks, and schedules start from their own workflow's
  registered defaults via `defaultRunParams`, never a prior run's snapshot. Harness knobs never cross
  either boundary. One test per boundary direction.
- **Upgrade compat is two distinct NULLs — do not let one test claim both:** T-5 covers catalog-row NULL
  `params` (registration/migration). My **S-2 hold** covers run-row NULL `effectiveParams` on resume of
  a pre-v21 suspended run: fallback = canonical default re-resolution from the run's pinned catalog
  version row, never a crash; `overrides` refused on resume exactly as for v21 runs; plus the
  suspended-pre-v21-journal replay fixture with zero cache misses (ADR-002 made checkable). No ARCH
  clause and no adversarial task owns this — it needs a **named task/test** or it is the slice's
  likeliest silent omission.
- **Regression immune system, precisely scoped (S-1 × B-7/T-8):** byte-identity pins stay for the
  no-new-inputs cases — (a) `composePrompt` with no `defaults.prompt` and no `appendPrompt` byte-equals
  today; (b) no-overrides run of an unconstrained workflow behaves identically pre/post; (c)
  effort-absent composition byte-identical on both clients; plus absent-`workflow` fingerprint
  byte-identity (T-7). The five-segment order pin is a **separate** test.
- **Fail-closed config + same-task wiring (S-3/S-4 = their T-D):** the three keys' `composeConfig()`
  forwarding and their `compose-config-v2-wiring.test.ts` rows land in the admission task — never a
  standalone "config plumbing" task (four shipped precedents).
- **Lifecycle untouched, verified (S-5):** no new process/port/table/watchdog; snapshot survives
  `workspace_purge` like the transcript — one assertion in the existing purge test.
- **The standing tripwire (S-7):** per-key provenance is the self-diagnosing mechanism for the next
  wiring miss (`'engine'` where `'default'` was expected); Gate-7.5 assertions named per rung, armed
  from day one.

## 3. Remaining disagreements / open items for the synthesizer

1. **F-2 (snapshot is redacted-on-persist AND read back for execution on resume) — still unaddressed by
   any other lens; I hold accept-and-pin.** If caller text literally contains a server-secret value, the
   resumed tail composes from `‹secret:NAME›` while pre-suspend dispatches used raw text — a replay
   divergence with a pathological trigger, and masking-on-resume fails safe. Adversarial's I-6 (no raw
   `RunSpec` copy) makes the alternative — a second, unredacted durable copy — strictly worse than at
   r1: it would be the *only* raw durable copy in the design. Needs one line in the DES invariant table
   plus one documenting test. I remain willing to move if anyone shows a non-pathological trigger.
2. **S-2 legacy NULL-`effectiveParams` resume needs a named owner.** Distinct from T-5's catalog NULL;
   currently owned by neither ARCH nor any proposed task. Cheap; omission breaks every in-flight
   suspended run on deploy day.
3. **`PARAM_OUT_OF_RANGE.source` — conditionally withdrawn.** Withdrawn iff B-3 (effective bound at read
   time) is adopted; if B-3 is dropped, `source` returns with it. The synthesizer must take or leave the
   pair, not halve it.
4. **R-1 zero-importer fence test on `session-options-builder.ts`** — possibly read as creep by a
   simplicity tie-break; I hold: one grep-shaped standing assertion on a module that already caused one
   scope-leak debate, self-retiring when the hardening track wires it deliberately.
5. **Recorded as joint recommendations (no longer disputes):** nesting semantics (knobs contained /
   appendPrompt propagates, provenance-visible, budget-charged; dies at the run boundary); five-segment
   prompt order; REQ-093's two-tier real-tier evidence plan; the B-2 derivation with the
   accept-and-normalize rider.
6. **Residuals held settled by both lenses:** ADR-005 cost amplification, ADR-007 injection residual,
   ADR-008 no telemetry / no non-owner masking before v22-D15.
