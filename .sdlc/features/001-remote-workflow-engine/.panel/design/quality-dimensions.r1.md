# Quality-dimensions — Design stage, round 1 (independent proposal)

**Scope discipline.** Gate 2 (architecture) already closed for v37: ADR-082 (option (c),
`Options.sandbox` configuration), ADR-083 (`failIfUnavailable:true`), ADR-084 (operator-grants,
author-request deferred), ADR-085 (delete both modules, two rescue riders) are settled, and my own
lens conceded the `WorkspaceConfinement` interface in the architecture panel's r2. Nothing below
re-opens an ADR. This is a Design/Tasks-stage proposal: how ARCH-175..180 get built out as concrete
types, call-site ordering, error taxonomy and an atomic task split, verified against the actual
source (not the architecture doc's prose) wherever the two could drift.

**Altitude.** Both. This is a distributed system (MCP server, SQLite stores, one event-log sink)
*and* an AI-agent system (two swappable GatewayClient backends, one of which spawns a real LLM-CLI
subprocess whose own shell tool this slice is confining). For REQ-218/219 specifically the *system*
altitude dominates — confinement is process configuration, the two new facts are ordinary structured
logs. The *agent* altitude applies in exactly two places, named under Observability and
Replaceability below, and I do not force memory-metabolism or prompt-self-calibration onto a slice
that touches neither — that sub-dimension is N/A here (stated under Self-sustainability, not
skipped silently).

## 1. Observability

- **`event-log.ts`'s `kind` union is closed on purpose** (`// exactly the four kinds v36 emits; a
  v37 kind is a v37 edit`, only `catalog.register/publish/deregister` + `run.terminal` exist today).
  Design must spell out the two literal additions as their own reviewable diff, not assume ARCH-178
  self-executes: `agent.confinement` and `agent.confinement_denied` joining the union, with their
  field shapes typed exactly as ARCH-178 states. Task-split as one atomic unit with its own RED test
  (`event-log.test.ts` gains two fixtures) before it is ever emitted from the gateway.
- **`failIfUnavailable` has nowhere to land.** `GatewayResult`'s failure arm
  (`src/gateway/client.ts:157-158`) is a **closed** 3-value union: `reason: 'timeout' | 'unreachable'
  | 'terminal'`. ADR-083 says a confinement-unavailable host makes `query()` "emit an error result…
  the run fails typed" — but none of the three existing reasons names it, and folding it into
  `'terminal'` (the generic bucket, already used for auth-missing, non-2xx, etc.) makes "the sandbox
  itself was unavailable" indistinguishable from every other terminal failure in the very log line
  this slice is supposed to make sandbox posture legible from. Design must pick one: widen the union
  with a 4th reason (`'sandbox_unavailable'`), or fold into `'terminal'` with a `detail` string that
  is drift-locked by a unit test. I read the union-widening as the smaller, more honest option —
  it costs one literal and every existing exhaustive `switch` becomes a compile error until updated,
  which is exactly the "compiler refuses a missing case" idiom this repo already uses for
  `KNOWN_FILE_CONFIG_KEYS`. This is the single biggest observability gap the architecture text
  leaves open; it is not decorative, because ADR-083's whole point is that a confinement failure
  must be loud, and today it would be typed but **unlabelled**.
- (Checked and set aside, not a gap): `FailureEnvelope`/`RaceResult` — the type ARCH-017 says both
  gateway impls "write" — is defined only in `timeout-race.ts` and has **zero production
  importers**; the real failure shape production emits is `GatewayResult`'s `reason` field above.
  ARCH-179's claim that deleting the module carries no production surface is confirmed by grep, not
  merely inherited from the ADR text.
- **Emit ordering at the one call site.** ARCH-180's rescued re-walk (`findProjectMarkerAncestor`)
  and ARCH-178's `agent.confinement` emit both sit in the same options-assembly block
  (`claude-agent-sdk-client.ts:623-677`, where `cwd`/`allowedTools`/`hooks` are already built).
  Design must pin the order explicitly: the re-walk refusal returns `WORKROOT_INSIDE_PROJECT` (typed,
  terminal) **before** `buildBashConfinement()` is ever called, so a refused call emits **no**
  `agent.confinement` line — there is no policy to report, because no session was built. State this
  as one sentence in the design doc and one test asserting the log has zero confinement lines for a
  refused call; the alternative reading (emit the policy anyway, "for completeness") would print a
  posture for a session that never ran, which is the same "sensation from a nerve attached to
  nothing" defect REQ-219 exists to delete elsewhere in this same slice.
- **`WORKROOT_INSIDE_PROJECT` is not in `ERROR_CATALOG`.** It is a bespoke string on
  `workroot-guard.ts`'s own error class and on `session-options-builder.ts`'s local result union —
  never routed through `src/errors.ts`'s closed `ErrorCode` catalog that every other
  authoring/registration failure goes through (REQ-116's "the error points at the guide" contract).
  Rescuing this code path into production (ARCH-180) is the first time it becomes reachable from a
  live `agent()` call rather than only from boot. Design should decide, and say so as a task: does it
  join `ERROR_CATALOG` now (consistent taxonomy, `see: null` since the remedy is a deployment fix,
  not an authoring one) or stay a local literal surfaced only in the log line? Leaving it undecided
  means two failure taxonomies exist side by side for the same slice.
- **Spike evidence (S1–S8) is itself the load-bearing observable for this whole gate.** ADR-082
  prescribes the spike as design's first, blocking item, on the remote host. Design must require one
  dated evidence file per arm under `.sdlc/features/001-remote-workflow-engine/` (raw observed
  output — the actual `EACCES`/absence of one, the actual `bwrap`/`unshare` presence check, the
  actual precedence result for S7 — not a verdict sentence), or the spike's outcome is folklore by
  Gate 7.5 the same way the 9/20 incident was folklore before someone grepped for it. S1 should
  record per-call `bwrap` setup latency while it's already instrumenting the call, since ADR-082
  names it "unmeasured" rather than bounded — cheap to capture now, expensive to reconstruct later.
- **Traceability closure.** `trace.py` computes closure from `traces:` upstream, so the VAL-024 /
  VAL-019 clause-2/3 / `val-023` re-points that ARCH-179/180 name as "verification's and
  validation's to perform" must appear as their own named tasks in 03-tasks.md, not as a parenthetical
  inside the deletion task — otherwise they are exactly the kind of orphaned re-point this ledger has
  already lost twice (REQ-021's own history).

## 2. Replaceability

- **The type-only import is the right amount of coupling, and design should say why explicitly.**
  `buildBashConfinement` imports only the SDK's `SandboxSettings` *type* — no `fs`, `process`, `env`.
  The compiler is the guard: a `sdk.d.ts` schema change breaks the build at the one call site
  (ARCH-176), never silently. Design should pin the exact SDK version the spike ran against
  (2.1.278, already named in ADR-082) as a recorded fact, so a later `npm update` that changes
  `SandboxSettings`'s shape is a diffable, attributable break rather than a mystery regression.
- **Do not build a seam for the carrier ladder.** ADR-082's arm-1/2/3 ladder is a *spike contingency*,
  not a runtime feature — "the builder's output is identical under arms 1 and 2" is exactly why no
  `applyCarrier()` abstraction is warranted. Design records the ONE arm the spike selects at exactly
  one call site; a task that builds a three-way seam "in case the spike changes its mind" would
  re-import the interface my own lens already conceded as premature abstraction in the architecture
  round. I flag this because task-splitting language ("wire the sandbox field, keep it swappable")
  can smuggle the abstraction back in under a different name — the design doc should say once,
  explicitly, that the seam is the spike's own report, not code.
- **LLM-backend replaceability is preserved by omission, and that omission should be a stated
  invariant, not an inference.** `GatewayClient` (the port both `LiteLLMGatewayClient` and
  `ClaudeAgentSdkGatewayClient` implement) gains **no** new method — `sandbox` never crosses
  `invoke(prompt, opts)`. `LiteLLMGatewayClient` spawns no subprocess and therefore has no shell to
  confine; "unconfined" does not apply to it, which is a category fact, not a coverage gap. Design
  should state this as one line in the interface table (it is implied by ARCH-176's "and nowhere
  else" but not spelled out as a reader-facing invariant) so a future contributor adding a third,
  subprocess-spawning gateway (a hypothetical local-CLI backend) does not assume confinement is
  free — `buildBashConfinement`'s output type is bound to *this* CLI's exact `SandboxSettings`
  shape. Name the revisit trigger explicitly: the first second subprocess-spawning `GatewayClient`.
- **REQ-219's `ProviderProfile` deletion is the replaceability property already achieved elsewhere,
  confirmed rather than assumed.** `providers.ts`'s `PROVIDER_CAPS` + `wireEffort` (ADR-045/006)
  already gives "GLM/qwen/next-provider is a config row" without importing the deleted builder.
  Task-split should include one negative check — no new parallel capability table appears anywhere
  in the REQ-218/219 diff — since a security-hardening slice is exactly the kind of change that
  tempts a "just add one more provider-shaped struct" shortcut under time pressure.

## 3. Consumability

- **The guide-paragraph mechanism has a real signature to design against, not an abstract one.**
  `buildAuthoringGuide(ceilings: GuideCeilings): string` is pure over one flat, already-resolved
  struct; the split between the byte-locked committed doc and the live served guide **already
  exists** as a working precedent — `scripts/gen-authoring-md.ts` calls it over `DEFAULT_CEILINGS`
  (the documented unconfigured default) while `mcp-facade.ts:670` calls it over the deployment's own
  live `this.ceilings`/`this.aliasNames`/`this.runConcurrency`. ARCH-107's v37 amendment ("rendered
  from the effective grant list… this deployment's currently-granted list rendered inline") should
  follow the identical shape: `GuideCeilings` gains `allowedHostPaths: readonly string[]`,
  `DEFAULT_CEILINGS` supplies `[]` (matching "absent ⇒ strictest posture"), and
  `mcp-facade.ts` is extended to pass the resolved grant list at the same call site it already
  assembles `ceilings` from. This is a design decision with an exact, one-line shape, not an open
  question — I'm naming the file/line pattern so the task is "add one field to one interface plus
  one call site," not "figure out how to thread live config into a pure guide builder."
- **Boot-refusal message shape needs to be designed, not left to "a typed message naming the
  offending entry."** ARCH-177 lists four validation rules (absolute / realpath / not-an-ancestor /
  no-globs) in this repo's ADR-028 idiom. Design should fix the exact error object — which rule
  failed, the offending entry verbatim, the one-line remedy — as a table, the same way ARCH-107 did
  for `ERROR_CATALOG` entries, so the four rules don't ship as four slightly-different ad-hoc
  message strings written by whoever happens to implement each `if`. Pair this with two small,
  easily-dropped tasks: `rwe.config.example.json` gains a commented `"sandbox": { "allowHostPaths":
  [] }` block (it has none today — checked), and `DEPLOY.md` §1 gains the config-reference entry
  for it, the same place `timeoutMs`/`retries`/other operator knobs already live.
- **Two disclosure levels must stay visibly distinct in the design doc, not just in the architecture
  prose.** The `agent.confinement` log line carries `protectedFiles`/`workRoot` and inherits the
  0600 per-instance log's permissions; the served guide renders **only** the granted list, never
  `protectedFiles`/`workRoot` (ARCH-107 v37 amendment is explicit about this). Design should make
  this a named non-goal in the interface table ("the guide's `allowedHostPaths` field type is
  `readonly string[]` sourced from `sandbox.allowHostPaths` only — never from `protectedFiles`") so
  a future refactor that "unifies" the two rendering paths for DRY reasons doesn't quietly widen
  what a remote authenticated principal can read.
- **A cold-model author needs the failure to be learnable, not just documented.** REQ-117's own
  protocol (ARCH-108) is a fresh model instance with nothing but `tools/list` + the guide, judged on
  whether it authors correctly on the first try. The new guide paragraph states the EACCES-as-
  ordinary-shell-failure fact in prose; whether a cold author actually internalizes "my Bash call to
  a global cache failed because nobody granted the path, not because my script is malformed" is
  exactly the kind of thing this repo's own `GUIDE_EXAMPLES` pattern exists to pressure-test (rule 4:
  "a guide that teaches an invalid example is worse than none"). I'd task-split one `GUIDE_EXAMPLES`
  entry demonstrating an agent handling a failed Bash write gracefully, registered and exercised by
  the existing `authoring-guide.test.ts` integration loop — otherwise the paragraph's claim of
  consumability is asserted, not measured, which is the standard this exact iteration is holding
  everything else to.

## 4. Self-sustainability

- **Tool-liveness, named precisely because this slice's dependency structure matches the dimension's
  own definition.** REQ-218's entire mechanism depends on a capability of a subprocess this engine
  does not own the source of (the `claude` CLI's sandbox). ADR-082's blocking spike is the correct
  *one-time* liveness probe. What the architecture does not resolve is *ongoing* liveness: nothing in
  ARCH-175..180 detects a future `claude` CLI upgrade that silently changes or removes
  `Options.sandbox`'s effect. Design should add a boot-time capability probe in the same place and
  the same idiom as `ARCH-019`'s existing `workRoot`-ancestor boot check — attempt one benign
  confined operation (or, cheaper, assert the resolved binary version/schema shape the spike measured
  against) and refuse to start rather than silently run REQ-218's control as a no-op. This adds no
  new config key and no new mode — it is `ADR-083`'s existing fail-closed decision, moved from
  "discovered per-run at `query()` time" to "discovered once at boot," which is strictly cheaper and
  closes the exact failure shape (a control that quietly stops enforcing and nothing says so) that
  the 9/20 incident and 70 `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warnings already are one instance of.
  I expect this to be read as scope creep by an adversarial-style lens on Karpathy grounds ("the
  spike already answers this for the measured host"); I'm naming it anyway because it is the
  self-sustainability dimension's own core question ("does the tool the agent depends on still
  work") applied to the one dependency this whole slice rests on, and it costs one boot check, not a
  subsystem.
- **Fail-closed over fail-open is the right self-sustainability trade for a security control, stated
  rather than assumed.** ADR-083's decision trades availability for correctness — a host that loses
  bubblewrap stops taking runs instead of degrading. That is normally a self-healing anti-pattern
  (a resilient system routes around a failed dependency), but for a control whose entire job is "the
  agent cannot do X," silently continuing without the control is not degraded service, it is the
  service failing to do the one thing this iteration exists to make it do. I concur with (A) over
  (B)/(C) on these grounds independently of the architecture panel's own reasoning.
- **No new circuit breaker for repeated `EACCES`.** A misbehaving or confused agent hammering a
  denied path is already bounded by the existing per-run token/turn budget (`RunGuard`) — nothing
  about this slice needs a second backoff mechanism, and I'd flag inventing one as over-engineering
  against a risk that's already covered.
- **Memory metabolism / self-reflection: N/A for this slice, stated rather than skipped.** REQ-218/219
  touch neither long-term agent memory nor prompt self-calibration; the closest analogue —
  `docs/AUTHORING.md` being *generated* from source-of-truth constants rather than hand-kept — is an
  existing, positive self-sustainability property this slice inherits and extends by one paragraph
  (ARCH-107), not something new to build. Noted as a strength, not left blank.

## Suggested task split (atomic units, in dependency order)

1. **Spike S1–S8** (blocking, remote host) — one evidence file per arm, per the Observability section
   above. Nothing below can be honestly test-first'd against a real sandbox until this returns.
2. **ARCH-177**: `FileConfig.sandbox` + `composeConfig()` validation (4 rules) + boot-refusal message
   table + `compose-config-v2-wiring.test.ts` entries (EXCLUDED row + the hop-2 assertion) +
   `rwe.config.example.json` + `DEPLOY.md` §1 entry. Independent of the spike's arm choice.
3. **ARCH-175**: `buildBashConfinement()` — pure, unit-tested against the fixed field values, no SDK
   boot required.
4. **ARCH-176**: wiring at the one call site (the arm the spike selected) + the three comment/text
   changes, each as its own reviewable diff line + a source-scanning drift-lock test so the two
   contradictory comments cannot silently re-diverge the way they did originally.
5. **ARCH-178**: the two `event-log.ts` kinds + the emit-ordering rule (Observability, above) + the
   `reason` union decision for `failIfUnavailable`.
6. **ARCH-180, rescue-then-delete, in that literal order within one commit**: wire
   `findProjectMarkerAncestor` into the production option assembly and its VAL/RTM re-points FIRST;
   delete `session-options-builder.ts` + its tests + the `gateway-effort.test.ts` fence SECOND. Never
   the reverse — deleting first would make REQ-021 regress to "not in production" with no rescue
   commit to point at, for however long the reorder takes.
7. **ARCH-179, same discipline**: name where `raceWithTimeout`'s two guarantees now live (already
   true today, confirmed by grep) and rewrite `val-023` against the production timeout path FIRST;
   delete `timeout-race.ts` + its unit test SECOND.
8. **ARCH-107**: `GuideCeilings.allowedHostPaths` + `mcp-facade.ts` call-site + one `GUIDE_EXAMPLES`
   entry + `docs/AUTHORING.md` regen (`DEFAULT_CEILINGS` renders `[]`).

## Risks

- Treating ARCH-178's `agent.confinement_denied` event as "spike-gated, therefore design has nothing
  to do here" — it still needs the `event-log.ts` union edit prepared now so S4's answer only flips a
  boolean, not a schema.
- The `failIfUnavailable` reason-taxonomy gap (Observability, above) shipping unresolved into
  implementation, where it will most likely be folded into `'terminal'` under time pressure without
  a recorded decision — reproducing, in miniature, the exact "two things read as one green" pattern
  REQ-219 exists to delete elsewhere in this slice.
- `WORKROOT_INSIDE_PROJECT` staying outside `ERROR_CATALOG` by default (inertia) rather than by
  decision, the first time it becomes reachable from a live call.
- Task-splitting ARCH-180 as a single "delete the dead module" ticket, which is exactly the shape
  that drops the rescue rider — the ledger has already lost this once (REQ-021's history is the
  architecture doc's own cited example).

## Expected disagreements with other lenses

- My boot-time CLI-capability probe (Self-sustainability) will likely be read as re-litigating
  ADR-083/scope creep by an adversarial-style lens; I've named the Karpathy-style counter-argument
  against myself above rather than waiting to have it raised.
- An adversarial lens may treat the EACCES-as-only-signal path (already accepted as a named residual
  in ARCH-178) as settled and see my push for a `GUIDE_EXAMPLES` entry demonstrating it as
  over-investment in a documented gap rather than a design-stage consumability requirement.
- The `failIfUnavailable` reason-taxonomy point is the one I'd defend hardest if pushed back on as
  "the architecture already said typed" — typed and *labelled* are different claims, and only the
  second is falsifiable by a test.
