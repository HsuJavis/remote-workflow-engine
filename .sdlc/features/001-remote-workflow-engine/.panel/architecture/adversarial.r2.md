# Adversarial architecture group — REQ-218 / REQ-219 — debate round 2

**Lens bundle**: (a) Security · (b) Scalability/performance · (c) Testability.
**Tie-breaker**: Karpathy simplicity-first.
**Read this round**: `quality-dimensions.r1.md` (the only other r1 in `.panel/architecture/`), plus
re-measurement of the four claims it asked to be re-verified rather than carried forward.

We are **closer than r1 reads**: QD and I independently recommend option **(c)**, and QD's
methodological demand ("measure the current tree, don't quote the old snapshot") is the same
discipline I applied. The live disagreement is not *what to decide* but *what to build*: QD wants a
new OS-confinement backend behind a swappable interface; I have measured that the confinement
already ships inside the subprocess we spawn, so (c) is a **config decision, not a new module**.

---

## 1. Disagreements, one verdict each

| # | QD r1 position | Verdict | Engineering reason |
|---|---|---|---|
| D1 | Option (a) = "OS-level confinement via bwrap/unshare/namespaces" — i.e. build it | **rebut (mechanism), concede (goal)** | We do not spawn Bash; the `claude` CLI does. `@anthropic-ai/claude-agent-sdk@0.3.199` exposes `Options.sandbox?: SandboxSettings` (`sdk.d.ts:1805`) with `filesystem.{allowWrite,denyWrite,allowRead,denyRead}`, `credentials.files[].mode:'deny'`, `bwrapPath`; the resolved CLI binary (2.1.278) carries those literals. Building our own bwrap wrapper means maintaining a jail in step with every CLI upgrade, for a jail the CLI already maintains. |
| D2 | Put confinement behind `WorkspaceConfinement.spawn(cmd, policy)` so a namespace-less host can fall back | **rebut** | The swap point QD wants already exists in my proposal and is smaller: `buildSandboxSettings(workspace, allowHostPaths, protectedFiles) → SandboxSettings`, a pure function. A `spawn()` interface would need a second implementation that spawns Bash itself — which nothing in this engine does, and which would mean re-implementing the CLI's tool loop. That is the definition of speculative architecture. QD's own precedent argues my way: `GatewayClient` is swappable because **two** implementations genuinely exist (`sdk`, `direct-fetch`/LiteLLM); here there is one and the second is hypothetical. |
| D3 | Namespace availability varies across self-hostable Linux targets; design for it | **concede (fact), rebut (remedy)** | The fact is real and is my own R3. The remedy is not a second backend: `sdk.d.ts:1778–1783` states `failIfUnavailable` **defaults to `true`** when `enabled:true` is passed programmatically, and `false` gives graceful degradation. So the entire availability question is one boolean the SDK already owns — cost of my position dropped to zero since r1. |
| D4 | Fall back to (b)-only where the kernel can't enforce | **hold, and name a tension inside QD** | QD's Replaceability section wants (b)-only as the fallback; QD's Self-sustainability section rejects (b)-only as "a human declaring paths forever… the opposite of minimising human intervention". QD can fairly answer that a fallback is *expected* to be worse — but then the fallback inherits exactly the ongoing-human-cost QD's own §4 rejects, and that has to be written down as accepted, not hidden in the word "fallback". My landing zone is unchanged from C1 and I think it satisfies both halves of QD: `failIfUnavailable:true` by default; if ops overrides it to `false`, the engine **refuses remote submissions** while unconfined. Degrade the trust boundary, never degrade it silently. |
| D5 | The denial seam must be mechanism-specific, first-class, in the per-agent dashboard panel | **concede — fully — and I have to hand back bad news** | I measured what the SDK surfaces: `SDKPermissionDeniedMessage` (`sdk.d.ts:3886`) covers **permission-rule** denials and its own doc says PreToolUse-hook denies are *not* covered. There is **no typed message for a sandbox/bwrap violation**; `ignoreViolations` (`sdk.d.ts:5907`) is a suppression map, which implies the CLI detects violations somewhere but does not type an event for hosts. So a kernel denial most likely reaches us as an ordinary failed tool result (`EACCES` in the command's stderr). **Consequence for the ADR: "journal the denial" is not free with mechanism (c) and must be an explicit arm of the spike** — measure what an actual denied write emits in the message stream before promising a first-class event. Second arm, cheaper than I credited in r1: `HOOK_EVENTS` (`sdk.d.ts:772`) includes **`PostToolUseFailure`** — the same plumbing we already use for `makePreToolUseHook`, firing with tool name/input and the error, carrying our own run id. Still best-effort (a `2>/dev/null; true` inside the command masks it), but it is a hook event, not a regex over transcript text. So the honest design is: journal the *policy applied at spawn time* (always available, our own data) + `PostToolUseFailure` as the denial signal if the spike shows it fires, labelled best-effort. I will not let this one be written as if it were solved. |
| D6 | `allowHostPaths` is workflow-authoring surface and needs REQ-130-style schema + D14 registration-time validation + D8 guidance, not an ADR line | **integrate — this is the round's cleanest merge** | QD's Consumability and my C2 are the same object seen from two sides. Merged contract: **author *requests* paths in workflow meta** (schema'd, validated at registration per D14, documented in the client guidance per D8); **operator *grants* them in `rwe.config.json`**; an ungranted request is refused at registration with a message naming the exact path, so the operator's action is one line. This keeps QD's declarative escape hatch for the `$HOME/.cache/jev-haiku` case and keeps my rule that the confined party does not write its own confinement. |
| D7 | Re-verify the SDK-gateway timeout gap before using it to justify wiring `timeout-race.ts` | **concede the demand, report the result, hold "delete"** | Measured this round in `src/gateway/claude-agent-sdk-client.ts` (note: the file lives under `src/gateway/`, not `src/`): `resolveTimeout` + `_config.timeoutMs` (506, 525), `setTimeout(() => controller.abort(), timeoutMs)` (535), `abortController: controller` handed to `query()` (671), and the D-F7/D-F9a race with terminal-error short-circuit (728–787). The gap QD suspected was stale **is** stale. `timeout-race.ts` has no surviving job → delete stands. |
| D8 | "If any *other* unbounded external call exists on the 218/219 codepaths, `timeout-race.ts` is the candidate — check before deleting" | **concede the check, report: none on those paths** | Census of `fetch(` under `src/`: `mcp-probe.ts:62` is bounded (`AbortSignal.timeout`); `seedref-fetcher` goes through `run-manager.ts:700`; the two call sites found with **no explicit signal** are `auth/auth-service.ts:134` (default `jwksFetch`) and `:222` (Google token exchange) — the OAuth callback path, which is *not* a REQ-218/219 codepath, and where the idiom is `AbortSignal.timeout(...)` (one argument, already used at `mcp-probe.ts:62`), not resurrecting a race helper. Parked as a separate small finding; it does not reopen the authn altitude I closed in r1 and it does not save `timeout-race.ts`. |
| D9 | The requirement's ban means PreToolUse path-matching is out | **clarify, not a conflict** | Agreed the ban is binding. It bans *parsing a shell `command` string*. It does not ban handing a path list to the kernel before the shell exists, and it does not retire the hook for tools whose arguments genuinely carry paths (Read/Write/Edit/Glob/Grep/NotebookEdit). Two tool sets, two mechanisms, no overlap — a partition, not defence-in-depth theatre (my C4). |
| D10 | `session-options-builder` / `timeout-race` decided per-module against current call sites; REQ-219 possibly separable from REQ-218 | **agree, with my F2/F3 rider re-asserted as blocking** | QD did not find and did not dispute it: `buildSessionOptions` holds the **only** production-shaped implementation of REQ-021's intra-run re-walk (`findProjectMarkerAncestor` has no other caller under `src/`), and `tests/acceptance/val-024-workroot-isolation.test.ts:13` verifies that clause **against the unwired module**. **Correction to my r1 hedge — I withdraw it, and the finding gets sharper.** `VAL-030` has no test file (0 hits under `tests/`, 0 in `05-tests.md`) but it *is* a real validation record: `08-validation.md:2027`, tier acceptance, `real: true`, green — a manual real run proving the **boot-time** guard fires (`WorkRootInsideProjectError` on a project-nested workRoot). That is the clause that is genuinely wired (`main.ts` → `workroot-guard`). So REQ-021 is not one undifferentiated ✅ with phantom evidence; it is **two clauses with opposite health**: boot fail-fast = wired + real evidence (VAL-030); intra-run re-walk = **unwired**, and its only evidence (VAL-024) runs against the module REQ-219 proposes to delete. Deleting the module without wiring that one line silently deletes a ✅. |
| D11 | Hand-rolled JSON-RPC MCP layer is a standing consumability risk | **hold / out of scope** | True, pre-existing, and not created by 218/219. Karpathy: not this iteration. Worth one sentence in the ADR's context, zero work. |
| D12 | Journalling allow/deny may be seen as hot-path volume | **agree with QD against that objection** | A *denial* is rare and security-relevant; a per-call trace is not what anyone is proposing. No cost argument survives here. |

**Uncontested between us** (state once, don't re-litigate in r3): option (c); the two contradictory
comments in the SDK client must collapse into one true sentence; `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`
gets a one-line explanation rather than a redesign of `allowedTools`; a green-tested module with no
production importer is a coverage lie; 218 and 219 are coupled through `session-options-builder`.

---

## 2. What moved in my position since r1

1. **R1 (the contradictory `sdk.d.ts` comment) is now better understood, and the spike gets a second
   arm.** The comment (`sdk.d.ts:1769–1777`) says filesystem restrictions come from `Read`/`Edit`
   permission rules while "these sandbox settings control sandbox behavior". Read strictly, that is
   not merely "stale" — it may mean `Options.sandbox` forwards only the behavioral toggles. But
   `Options.settings` (`sdk.d.ts:1806+`) loads an object into the **flag-settings layer, the highest
   priority among user-controlled settings** — which is exactly the layer several `SandboxSettings`
   fields say they require ("only honored from user, managed/policy, or CLI `--settings` settings —
   project settings are ignored"). **Spike arm 2**: if `Options.sandbox.filesystem` proves inert,
   pass the same block via `settings: { sandbox: {...} }`. Same decision, same declaration surface,
   no hand-rolled wrapper. My r1 fallback (sandbox + `additionalDirectories` + permission rules)
   drops to arm 3.
2. **C1 got cheaper.** Fail-closed is the SDK's own default under `enabled:true`; I am no longer
   arguing for an unusual posture, I am arguing against explicitly downgrading one.
3. **A settings-precedence question that cuts both ways — new spike arm.** Some sandbox-weakening
   toggles are documented as *ignored when they come from project settings* (`allowPlaintextInject`,
   `allowAppleEvents`, `enableWeakerNetworkIsolation`; `bwrapPath` is managed-settings-only). That
   trust hierarchy is load-bearing for us and we would have to re-earn it in a hand-rolled wrapper —
   but I checked the schema (`sdk.d.ts:2682–2736`) and **`enabled`, `allowUnsandboxedCommands`,
   `excludedCommands` and the whole `filesystem` block carry no such note**. Production passes
   `settingSources: ['project']` whenever a workspace is set, and the agent can write
   `<workspace>/.claude/settings.json`. **If project settings can set `sandbox.excludedCommands` or
   `enabled:false` and are honored (or array-merged), the confined party can weaken its own
   confinement — the exact failure this requirement exists to close.** Spike arm: can a workspace
   settings file weaken the sandbox? Mitigations if yes, in preference order: pass the block through
   `Options.settings` (flag layer, outranks project), and/or list `<workspace>/.claude/settings.json`
   in `filesystem.denyWrite` while the rest of the workspace stays writable. This must not be written
   into the ADR as "the hierarchy protects us"; it protects *some* fields and the rest is unverified.
4. **D5 is a partial retreat.** In r1 I asserted denials must reach the journal and implied the SDK
   would surface them (`ignoreViolations` "implies violations are surfaced"). Measured: nothing typed
   surfaces them to hosts. The requirement stands; its feasibility is now spike-gated.

---

## 3. Final position

**REQ-218 — option (c), implemented as configuration of the CLI's own sandbox, not as a new
enforcement layer.**

- One enforcement point (the kernel, via the SDK/CLI sandbox), one declaration surface (a path list).
- One new module: `buildSandboxSettings(workspace, allowHostPaths, protectedFiles) → SandboxSettings`
  — pure, no fs/env/process, unit-testable without bwrap. Wired at the `query()` options assembly in
  `src/gateway/claude-agent-sdk-client.ts` (beside `abortController`, line ~671), **not** threaded
  through `RunManager`, and **not** added to `GatewayClient` (LiteLLM has no subprocess and no Bash;
  don't grow an interface method the other impl must stub).
- Posture: `enabled:true`, `failIfUnavailable:true` (the SDK default), `autoAllowBashIfSandboxed:true`,
  `filesystem.allowWrite = [run workspace, ...granted allowHostPaths]`,
  `denyRead = [rwe.config.json, auth-tokens.db, other runs' workspaces]`,
  `credentials.files[].mode:'deny'` for the two secret files. The `denyRead`/`credentials` half is the
  single thing no declaration-only option can express: **`$HOME` writable for a shared cache and the
  Google client secret still unreadable.**
- Declaration ownership (merged with QD): author requests in workflow meta → registration-time
  validation (D14) → operator grants in `rwe.config.json` → refusal names the path; guidance shipped
  with the client plugin (D8).
- Keep the PreToolUse hook for path-bearing tools; record in the ADR the bug *class* behind
  `makePreToolUseHook` (a guard whose "nothing to check" branch returns the same verdict as its
  "checked and clean" branch is not a guard).
- Testability split by honesty (C3, unchanged): the builder is unit-tested; the **effect** has exactly
  one tier — real (Gate 7.5: Bash writes `$HOME`, denied; or the path is in the granted list). No
  mock-tier test may claim to verify the confinement.
- **The ADR is not binding until the spike runs, on the remote host** (arms 1→2→3 above, plus: what
  does a denial actually emit?).

**REQ-219 — delete both, with two riders that ship in the same commit.**

- `timeout-race.ts` + its 2 tests: delete. Ledger line: built when the gateway owned its own timeout
  and slot; superseded by the AbortController path (D-F7/D-F9a/DES-171) and by `withSlot`+`finally` in
  `run-manager.ts`. Rider: **rewrite** `val-023-sdk-gateway-timeout.test.ts` against the production
  timeout path rather than deleting it (it already boots a real server with a hung endpoint); assert
  `ok:false` with a timeout and `semaphoreGauge().inUse` back to 0.
- `session-options-builder.ts` + its 4 tests: delete — **but** REQ-021's two clauses must be tracked
  separately in the RTM from now on (boot fail-fast: wired, VAL-030; intra-run re-walk: the gap), and
  move its one live security behaviour
  (the DES-031 re-walk, typed `WORKROOT_INSIDE_PROJECT` refusal) into the production option assembly
  first, and re-point VAL-024's re-walk clause and VAL-019's clause 2/3 at the production path.
  Wiring the module as-is would be a *regression*: it hard-codes `settingSources: ['project']` where
  production is `req.workspace !== undefined ? ['project'] : []`.
- The fence at `tests/unit/gateway-effort.test.ts:263` ("stays FENCED — zero `src/` importers") retires
  in the same commit — it would otherwise stay green vacuously, asserting about a deleted file — and
  the new ADR must **explicitly supersede ADR-006 / DES-106** rather than silently contradict them.

---

## 4. My three lenses still don't fully agree (updated)

- **C1 security vs ops (fail-closed)** — narrowed, not gone. Cost dropped (it's the SDK default), but
  a host without bwrap still can't run agents. Compromise stands: `false` is permitted only together
  with refusing remote submissions.
- **C2 security vs usability (who declares)** — **resolved this round** by merging with QD's D6:
  author requests, operator grants. I withdraw it as an open ADR question; what remains is a slicing
  question, not a trust question (below).
- **C3 security vs testability** — unchanged and I will keep enforcing it: the only tier that may
  claim the confinement works is the real tier.
- **New, from D2**: my *testability* lens finds QD's injectable `WorkspaceConfinement` seam genuinely
  attractive — an injected policy object is easier to test than a subprocess sandbox. My *security*
  and *simplicity* lenses overrule it: an injectable confinement is a confinement you can mock away,
  and this repo is currently deleting two modules for precisely that sin. Naming the trade rather
  than pretending the three lenses agreed.

---

## 5. Still disputed / open

1. **Fail-closed vs graceful degradation** (D3/D4). I hold fail-closed + remote-submission refusal;
   an ops lens may still overturn it. Decidable by data: does the *remote* host have usable
   namespaces? Same spike.
2. **Does the author-side request field ship this iteration, or is slice 1 operator-only?** The trust
   model is settled; the scope isn't. My simplicity lens says operator-only first (`rwe.config.json`
   alone unblocks the jev-haiku case today, zero new authoring surface); QD's consumability lens will
   want the schema+guidance in the same slice so cold clients don't hit a REQ-130-shaped gap. I lean
   operator-only-first and would not fight hard.
3. **Whether a sandbox denial can be journalled as a typed event at all** (D5). Unknowable until the
   spike; the ADR must not promise it in advance. (`PostToolUseFailure` is the most likely carrier.)
3b. **Whether workspace-level project settings can weaken the sandbox** (§2.3). Not a disagreement
   with QD — nobody raised it — but it is blocking in the same way the `filesystem.allowWrite` arm is:
   a confinement the confined party can edit is not a confinement.
4. **My r1 R6** (a granted shared path is shared mutable state across up to 32 concurrent runs). Name
   it in the ADR as an accepted property; do not invent locking this round.

## 6. Dropped for simplicity (Karpathy ledger, so r3 doesn't re-add them)

Hand-rolled bwrap/unshare wrapper (conditionally, pending spike) · `WorkspaceConfinement` interface
and its second backend · a denial-event schema design · locking for shared declared paths ·
`GatewayClient` interface growth · any reopening of `allowedTools`/`tools` semantics (D-F11/UT-024/
VAL-003 depend on that list staying bare and non-empty) · the hand-rolled-MCP-layer question.
