# Quality-Dimensions Panel — Round 1 (Design, v23)

**Lens**: Observability / Replaceability / Consumability / Self-sustainability.
**Stage**: Design (Gate 3, tasks+design merged). Architecture for this slice (ARCH-077..086,
ADR-015..022, REQ-101..106) is already RATIFIED — this round does not re-litigate settled ADRs
(`ready` over `ok`, no `inputs_fp`, no standalone `DiagramStore`, owner-email left unmasked). It
inherits them and works one altitude down: concrete interfaces, sinks, enums, and boot-time
behavior the architecture text intentionally left to design. Grounded against `src/gateway/
client.ts`, `src/gateway/claude-agent-sdk-client.ts`, `DEPLOY.md §6`, and `src/dashboard-page.ts`
— not against the architecture proposal's prose alone.

## Altitude determination

**Both altitudes, plus the third the ARCH rationale itself already names.** This codebase is a
plain system at its storage/HTTP/dashboard layer (SQLite, Streamable HTTP, a polling dashboard)
and an AI-agent system at its execution core (Claude Agent SDK sessions, a pluggable LLM gateway).
v23 adds a genuinely new instance of the agent altitude: **the engine itself becomes an LLM
consumer for an internal control surface** — it calls a model on attacker-influenced input (an
author's script) and republishes the output as engine-authored fact to principals forbidden from
reading that input. All four dimensions below are evaluated at whichever altitude that finding
lands on: system altitude for the sink/table/route mechanics, agent altitude for the analyzer's
isolation and backend-swap properties.

---

## Observability

**1. Pin the journal-line sink, not just its field list.** ARCH-079/ADR-016 pin the *fields*
(`{name, version, principal, model, promptTokens, completionTokens, durationMs, outcome,
noteCode}`) but not where the line goes. Grounded against `DEPLOY.md §6` ("日誌僅
stdout/stderr（`[remote-workflow-engine] ...` 前綴），交給你的 process manager … 收集；沒有另外寫
檔案 log") — this project has exactly one logging convention: a prefixed line on stdout/stderr,
collected by systemd/pm2/docker, no dedicated file. Design should pin the analyzer journal line to
the **same** convention: one `console.log('[remote-workflow-engine] graph-analyzer ' +
JSON.stringify({...}))` call, so an operator's existing `journalctl -u rwe -f` already shows it —
no new observability channel to document, deploy, or rotate. Do not invent a second sink (a
dedicated log file, a DB table) for this — that would be a new operational surface ARCH-079
explicitly didn't budget for, and it would fork this project's one logging convention in two.

**2. `outcome`/`noteCode` needs a closed, literally-written enum — write it now, not at impl time.**
ARCH-077 pins `note_code` as "always one of the fixed `DiagramNoteCode` values" but the set is
never enumerated. From the ARCH text plus one gap found below, the closed set design should carry
into 03-tasks.md/04-design.md is: `TIMEOUT | RETRIES_EXHAUSTED | QUEUE_FULL | DISABLED |
GATE_REJECTED_CONTENT | GATE_REJECTED_SHAPE | MODEL_UNMAPPED` (the last is new — see
Self-sustainability §2). Per this ledger's carried-in rule 1 ("a test whose oracle is the code
under test cannot fail when the code is wrong"), the test asserting this must enumerate the seven
values literally, not infer them from two failure branches — the same discipline ARCH-081 already
mandates for `diagramStatus`.

**3. The `GATE_REJECTED_CONTENT` vs `GATE_REJECTED_SHAPE` distinction must survive per-run, not
just in the terminal row.** `workflow_diagrams` stores one `note_code` per `(name, version)` — the
*latest* outcome only. If an operator wants to see a gate-rejection **rate** rising after a model
swap (the "wired but degraded" signal ADR's own text relies on), that requires the per-run journal
line to carry the same split code, not just the terminal table row overwriting itself on retry.
This is already implied by the field list (`noteCode` is per-run) — flagging it explicitly because
it's easy for an implementer to collapse "log the outcome" into "read back the table row" and lose
the rate signal.

---

## Replaceability

**1. Positive finding, worth recording as a design constraint rather than assuming it holds:**
`GatewayClient.invoke()` already exists as the shared interface (`src/gateway/client.ts:81-99`),
implemented identically in shape by both `LiteLLMGatewayClient` and `ClaudeAgentSdkGatewayClient`.
`GraphAnalyzer` needs **zero new interface surface** — it is just another `invoke()` caller that
happens to omit `workspace`, `onEvent`, and `onHarness`. This means the backend-swap property
(GPT↔Claude↔local model = config change) that D2/REQ-004 already established for user-facing
`agent()` calls extends to the analyzer for free. **Design must pin this as a constraint, not an
accident**: `GraphAnalyzer`'s constructor should take a `gateway: GatewayClient` (the existing
interface type, not a narrower ad hoc shape), so a future third `GatewayClient` implementation
needs no analyzer-specific code path. Do not let an implementer special-case the analyzer's gateway
usage behind a narrower interface "because it only needs a few fields" — that would quietly
re-introduce the coupling this slice's architecture avoided.

**2. `graphAnalyzer.model` must resolve through the same `AliasMap`, and that has a boot-time
implication.** Confirmed in code: `opts.model` on `invoke()` is not a raw provider string — both
gateway clients resolve it against the shared `AliasMap` (`providerOf`/`effectiveProvider`/
`thinkingFor` in `claude-agent-sdk-client.ts:201-219,325`). So `graphAnalyzer.model` in
`rwe.config.json` is an **alias name** from the same table `agent()` calls use — this needs to be
stated explicitly in the design doc (it is not stated anywhere in ARCH-085), because it is exactly
the kind of implicit coupling a reader could miss and configure with a raw provider:model string
that silently fails to resolve. See Self-sustainability §2 for the boot-time-validation
consequence.

---

## Consumability

**1. Dashboard live-update for `pending → ready` needs no new mechanism — confirm, don't
reinvent.** `dashboard-page.ts` runs one global `setInterval(render, 3000)` (`:505`) driving every
view on the page from a single 3s poll. ARCH-084's workflow-detail view fetches `/describe`
instead of `/skeleton`; as long as that fetch sits inside the polled `render()` path (the same
place the `/skeleton` fetch it replaces already lived), a diagram that flips from `pending` to
`ready` mid-session appears within 3s with zero new code. **Design action**: state this explicitly
as the mechanism (no new poll, no websocket, no manual-refresh affordance needed) so the task that
implements ARCH-084 doesn't invent a bespoke refresh timer for one view. One thing worth a
one-line confirm at implementation time (not re-verified here): that the `/describe` fetch is
inside the *ticked* render call and not a one-shot fetch-on-navigate — the file's own comment
block at `:90-92` documents the "3s poll" convention for the rest of the page, so this would be
the one view that breaks it if implemented differently.

**2. `EXPECTED_DESCRIBE_KEYS` (ARCH-081) needs a single home, not a duplicate literal per test
file.** The two-sided literal key-set assertion is exactly right per carried-in rule 1, but if the
facade test and the HTTP-route parity test (ARCH-082's "one projection, consumed by both") each
write their own copy of the expected key array, they drift the same way two mask implementations
would. Design should name one exported constant (or one shared fixture) that both the MCP-tool
test and the `/api/workflows/:name/describe` route test import — this is the same anti-drift
argument ARCH-081 already makes for the projection function itself, applied one layer up to its
test oracle.

---

## Self-sustainability

**1. The `no workspace` / `explicit scratch cwd` pairing in ARCH-079's own text needs a concrete
mechanism — as written it under-specifies where the analyzer's session actually runs.**
ARCH-079 states the analyzer call passes "no `workspace`" and separately promises "an explicit
scratch `cwd` that is not CLAUDE.md/MEMORY.md-reachable." Read against the actual `invoke()` body
(`claude-agent-sdk-client.ts:494-581`), these two clauses resolve through the **same** code path
in a way the architecture text doesn't spell out:
  - `cwd: req.workspace ?? this._config.cwd` — omitting `workspace` falls back to whatever `cwd`
    the `ClaudeAgentSdkGatewayClient` instance was constructed with.
  - `settingSources: req.workspace !== undefined ? ['project'] : []` — omitting `workspace` also
    sets `settingSources: []`, which is the actual fix this repo already validated for the REQ-021
    leak class (CLAUDE.md is loaded via `settingSources:['project']`, not via `cwd` alone). So the
    documented leak class is closed by omitting `workspace`, independent of what `cwd` resolves to
    — good, and worth stating in the design doc as *why* "no workspace" is sufficient on its own
    for the CLAUDE.md vector, so a future reader doesn't think the scratch-`cwd` clause is doing
    that job.
  - But `this._config.cwd` is a **static, construction-time value with no other real-run consumer**
    going forward (every user-facing run always supplies `req.workspace`; the only two callers that
    ever hit the `this._config.cwd` fallback are unit tests and, as of v23, `GraphAnalyzer`). What
    that value actually *is* for the analyzer's gateway instance is therefore load-bearing for
    exactly one case ADR-020 already names as an accepted risk: an operator who sets
    `graphAnalyzer.tools` non-empty. With `tools:[]` (the default) this is moot — there's no tool
    surface to act inside a cwd. But ADR-020 explicitly contemplates the non-empty case as a real,
    if operator-accepted, state, and nothing in the architecture pins what directory a tool call
    would then run against.
  - **Concrete design proposal**: give the analyzer's gateway construction (whether a dedicated
    `ClaudeAgentSdkGatewayClient` instance or a shared one reconfigured per this call — either
    works, pick one in 04-design.md) an explicit `cwd` under `workRoot` — e.g. a fixed
    `${workRoot}/.graph-analyzer-scratch/` directory, created once, never written to by any run.
    This is not new machinery: `workRoot` is already certified by the existing boot-time
    `workroot-guard` (REQ-021) to never be, or be inside, a project (`.git`/`CLAUDE.md` ancestor)
    — so "not project-reachable" is **inherited for free** from an invariant the engine already
    enforces at boot, rather than re-derived for this one path. Leaving `this._config.cwd`
    unset/defaulted (e.g. to `process.cwd()`, which for this very repo checked out as a working
    tree **is** a Claude project) would silently reproduce the exact incident class REQ-021 was
    written to close, gated behind a config flag (`graphAnalyzer.tools`) that starts empty and so
    would not be caught by any test that only exercises the default. This is adjacent to (not
    inside) this lens's four dimensions in the strictest reading — flagged here anyway, and flagged
    again below as an expected cross-lens disagreement, because it is a design-level gap this
    lens's grounding pass surfaced and no ARCH item currently owns it by name.

**2. `graphAnalyzer.model` naming an unmapped alias is a design gap, and the fix should match this
requirement's own honest-absence philosophy, not REQ-021's fail-fast one.** Following from
Replaceability §2: if `graphAnalyzer.model` in config is a typo or a retired alias, `providerOf`
resolves to `undefined` and — unless something checks earlier — every single registration's
analyzer call silently degrades (wrong thinking-policy default, or a provider mismatch) instead of
being an operator-visible misconfiguration. Two requirements already on this ledger point at two
different remedies and shouldn't be conflated:
  - REQ-004 requires **submission-time validation** with a hard failure for an unmapped alias on a
    user's `agent()` call — because a run silently proceeding on the wrong model is a correctness
    bug for that run.
  - REQ-104's own last clause requires the opposite for the analyzer: `enabled:false` →
    `diagramStatus:'unavailable'`, **never an error** — because a broken analyzer must never block
    or fail a registration.
  A misconfigured `graphAnalyzer.model` sits between these: it shouldn't crash the boot (that's
  REQ-104's fail-open promise for this feature), but it also shouldn't fail silently forever
  (that's the closed-loop gap this dimension exists to catch). **Proposed resolution**: validate
  `graphAnalyzer.model` against the alias map once at boot with a loud warning on the existing
  `[remote-workflow-engine]` stdout convention (same channel as ADR-020's non-empty-tools warning —
  one operational convention, not two), and have every subsequent `enqueue()` settle
  `unavailable` with the new `MODEL_UNMAPPED` note code (§Observability-2) rather than a silent
  wrong-provider dispatch. This keeps registration non-blocking (REQ-104) while making the
  misconfiguration observable on both the boot log and every affected row's `diagramNote` — no new
  boot-time hard failure is proposed; that would over-apply REQ-021's fail-fast posture to a
  feature whose own requirement text says the opposite.

**3. No disagreement to record against the ratified ADR-017 recovery design** — the single
`workflow_regenerate_diagram` action, no auto-retry-forever, no lazy describe-time regeneration —
this design round inherits it as settled and has nothing new to add.

---

## Task-splitting notes (03-tasks.md does not exist yet)

- **ARCH-085's three-part "definition of done" (composeConfig forward + wiring-test row + Gate 7.5
  real run) must be enforced as *one task*, not three that can land independently.** The
  architecture text is explicit that this class of bug (v11 `updateFlagPath`, v15 `auth`, v16
  `workspaceTtlMs`) happens precisely when the config-forward and its wiring-test row are split
  across commits/tasks. Splitting them defeats the guard `compose-config-v2-wiring.test.ts` exists
  to be.
- **The CI grep guard (ADR-022) must land in the same task as, or strictly before, the ARCH-083
  deletions it's meant to police**, with its three-entry allowlist populated at creation time —
  writing the guard against an empty allowlist and back-filling entries later re-opens exactly the
  "review discipline doesn't catch this" gap ADR-022 exists to close by mechanism instead of habit.
- **The facade/route parity test (ARCH-081's "one projection … one test asserting both call sites
  emit the identical object") is naturally one task spanning `mcp-facade.ts` and `server.ts`'s
  route** — splitting it by file (a common task-decomposition instinct) would produce two tests
  each checking half the property, which is not the same guarantee.
- **`gateDiagram` (ARCH-080) is pure with zero dependencies** (`deps: —` in the architecture row)
  — natural first test-first task in this slice: it can be fully red→green before `GraphAnalyzer`,
  the catalog table, or any wiring exists, and the S-2 hostile-diagram unit test (zero model
  involvement) should be written against it directly.
- **The analyzer-scratch-`cwd` decision (Self-sustainability §1) is a design decision belonging
  inside the ARCH-079/`graph-analyzer.ts` task**, not a follow-up — it determines a constructor
  parameter of the class that task builds, and deferring it risks the class shipping with whatever
  default `ClaudeAgentSdkGatewayClient.cwd` happens to be at construction time.

---

## Risks

- **Silent-degradation risk if `graphAnalyzer.model` validation is skipped**: every registration's
  diagram silently fails to reflect the intended model (or fails outright) with no operator signal
  beyond a `diagramStatus` an operator has no reason to be watching, until someone notices the
  diagram quality dropped. Mitigated by the boot-warning + `MODEL_UNMAPPED` proposal above.
- **Scratch-cwd risk is currently unpinned**: as written, ARCH-079 is satisfiable by an
  implementation that leaves `this._config.cwd` at whatever the gateway's general construction
  default is, which for this repo's own checked-out working tree is a Claude project — reproducing
  the exact REQ-021 incident class the moment an operator turns on `graphAnalyzer.tools`. Low
  probability (tools default to `[]`) but the failure mode, if triggered, is a repeat of a
  previously-recorded, explicitly-named incident.
- **Journal-line sink drift**: if an implementer reaches for a new logging utility instead of the
  established `console.log('[remote-workflow-engine] ...')` convention, the analyzer's
  observability seam becomes invisible to an operator's existing `journalctl`/`docker logs`
  workflow — a self-inflicted regression of exactly the seam ARCH-079/ADR-016 built.
- **Test-oracle duplication risk for `EXPECTED_DESCRIBE_KEYS`**: without a single shared constant,
  the facade and route tests can drift the way two independent implementations of a mask would —
  the precise failure class ARCH-081 was written to prevent, recurring one layer up in the test
  suite instead of the production code.

## Expected disagreements

- **With the adversarial/security lens**: the scratch-`cwd` finding (Self-sustainability §1) sits
  on the boundary between this lens and theirs — it is phrased here as a self-sustainability
  closed-loop concern (an operator-accepted-risk config path silently reproducing a named incident
  class with no observable signal) but its remedy is a security-shaped control (workspace/cwd
  confinement). Expect either a claim that this belongs entirely in their lens, or a counter-
  proposal that the fix should be process-sandboxing rather than a scratch directory — the latter
  would reopen ADR-020's "the analyzer executes no user code, so process isolation is speculative
  machinery" argument, which this lens has no basis to relitigate and would defer to on.
- **On `MODEL_UNMAPPED` as a new `noteCode` value**: expect pushback that REQ-104 never asked for
  a new closed-enum member and that this is scope creep on a config-validation edge case — the
  counter is that `note_code`'s closed-enum discipline (ARCH-077 invariant 3) means *some* design
  round has to enumerate the full set before implementation, and an unmapped alias is a real
  reachable state the six-value set as currently implied doesn't cover.
- **On the non-fatal (warn, don't fail boot) stance for a misconfigured `graphAnalyzer.model`**:
  expect the alternative fail-fast proposal (mirroring `WORKROOT_INSIDE_PROJECT`) to be raised —
  this lens's position is that REQ-104's explicit "never an error" clause for a broken analyzer
  should extend to a misconfigured one, not just a disabled/unreachable one, but the boundary
  between "config error worth failing boot over" and "degraded-feature error worth an honest
  `unavailable`" is a judgment call the owner may want to make directly rather than have this lens
  decide unilaterally.
