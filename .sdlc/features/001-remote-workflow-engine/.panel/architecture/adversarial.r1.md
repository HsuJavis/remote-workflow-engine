# Adversarial architecture group — REQ-218 / REQ-219 — debate round 1 (independent)

**Lens bundle**: (a) Security · (b) Scalability/performance · (c) Testability.
**Tie-breaker**: Karpathy simplicity-first — the minimum architecture that solves *this* problem,
nothing speculative.
**Round**: 1, independent. I have not read the other panellists.

---

## 0. Altitude call (do this before anything else)

From `tech_stack` + the two requirements: this is **both**, but the two requirements sit at
**one** altitude only.

- *System altitude* exists here: `src/server.ts` is a hand-rolled JSON-RPC-over-HTTP MCP server with
  its own authn (`src/auth/`, `auth-tokens.db`), authz (`src/authz.ts`, owner ladder), bind guard,
  webhook secrets. That is where brute force / token forgery / timing attacks would live.
- *Agent altitude* is where REQ-218/219 actually are: the engine **hosts** agents
  (`ClaudeAgentSdkGatewayClient` spawns a real `claude` CLI subprocess per `agent()` call, with a
  tool surface, a workspace cwd, and an LLM deciding what to run). REQ-218 is about **confining what
  a hosted agent's tools may touch**; REQ-219 is about **whether the engine's declared confinement
  code is the code that actually runs**.

**Therefore I deliberately do not produce authn/JWT/brute-force/timing findings this round.** The
REQ-218 threat is not a forged token — it is a *legitimately admitted* agent whose model output
becomes a shell command. Forcing my template's system-altitude half onto this requirement would
manufacture noise. The lens half that *does* apply is **secret protection** and **attack surface**,
and I apply it hard below.

The agent-altitude quality dimensions that bind here:
- **observability**: a confinement decision that is not journalled is not a control;
- **replaceability**: the confinement must not be welded to one gateway impl (there are two);
- **self-sustainability**: a guard with green tests and zero production callers (REQ-219) is
  *negative* self-sustainability — it actively misleads the next maintainer.

---

## 1. Summary

### REQ-218 — recommend **(c) both**, but argue it is structurally **(a) with (b) as its config**

The requirement offers (a) OS-level confinement, (b) an explicit `allowHostPaths` declaration
contract, (c) both. I recommend (c) — *and* I claim the panel should not treat it as two mechanisms
bolted together. There is exactly **one** enforcement point (the kernel) and exactly **one**
declaration surface (a list of paths); (b) is the input to (a), not a parallel control.

The decisive fact, measured this round, is that **we do not have to build (a)**:

- `@anthropic-ai/claude-agent-sdk@0.3.199` — the version in `package.json` and in `node_modules` —
  exposes `Options.sandbox?: SandboxSettings` (`sdk.d.ts:1805`). Its schema
  (`sdk.d.ts:2682–2736`) carries `enabled`, `failIfUnavailable`, `autoAllowBashIfSandboxed`,
  `filesystem.{allowWrite,denyWrite,allowRead,denyRead,allowManagedReadPathsOnly}`,
  `credentials.files[].mode:'deny'`, `credentials.envVars[].mode:'deny'|'mask'`, and `bwrapPath`.
- `bwrap`, `unshare`, `nsenter` are all present on this host;
  `/proc/sys/user/max_user_namespaces = 123851` and `unprivileged_userns_clone = 1`.
- The spawned CLI binary really implements this, not just the typings: the resolved executable
  (`~/.local/bin/claude` → `~/.local/share/claude/versions/2.1.278`, ELF, not stripped) contains the
  literals `allowWrite` (27), `denyRead` (27), `denyWrite` (20), `failIfUnavailable` (16),
  `autoAllowBashIfSandboxed` (11), `bwrapPath` (11), `allowManagedReadPathsOnly` (8).

**Caveat I am obliged to state rather than paper over**: `sdk.d.ts:1770–1776` says "Filesystem and
network restrictions are configured via permission rules, not via these sandbox settings". That
comment **contradicts the schema three lines of code below it and contradicts the CLI binary's own
strings**. I read the comment as stale/partial, but I have *not* run it. REQ-218's acceptance
demands a real run anyway, so this becomes a **Gate 2 spike, blocking the ADR** — not an assumption
the ADR may rest on. If the spike shows `filesystem.allowWrite` is inert, the fallback inside the
same mechanism is `enabled:true` + `autoAllowBashIfSandboxed:true` with the sandbox's default
write scope (whatever that turns out to be — measured in the same spike), and the declaration list is expressed through `additionalDirectories`
(`sdk.d.ts:1280`) plus permission rules — still option (a)+(b), still no hand-rolled wrapper.

Proposed shape:

```
sandbox: {
  enabled: true,
  failIfUnavailable: true,          // fail CLOSED — see conflict C1
  autoAllowBashIfSandboxed: true,
  allowUnsandboxedCommands: false,
  filesystem: {
    allowWrite: [ <run workspace>, ...declaredAllowHostPaths ],
    denyRead:   [ <rwe.config.json>, <auth-tokens.db>, <workRoot>/<other runs> ],
  },
  credentials: { files: [ {path:<rwe.config.json>,mode:'deny'}, {path:<auth-tokens.db>,mode:'deny'} ] },
}
```

Why this answers the requirement's own words:

1. **"路徑比對不是選項" is honoured.** The paths above are *not* parsed out of a shell command and
   compared — they are a declaration handed to the kernel *before* the shell exists. The banned
   thing is static analysis of `command`; this is enforcement, at a layer where `$(...)`,
   `eval`, symlinks and a second `bash -c` are all irrelevant. The panel must not confuse "a
   mechanism that mentions paths" with "path comparison".
2. **The jev-haiku case becomes a declaration, not a tacit permission.** `$HOME/.cache/jev-haiku`
   (510 MB written on 9/20) appears as one line in `allowWrite`, which is literally REQ-218's
   acceptance clause 2b ("該路徑明確出現在申報清單裡").
3. **The 風險面 paragraph is answered directly, and this is my strongest single point.**
   `credentials.files[].mode:'deny'` + `filesystem.denyRead` keep `rwe.config.json` (Google client
   secret) and `auth-tokens.db` unreadable **even when `$HOME` itself has to be write-allowed for
   the shared cache**. No other option on the table can do that: an `allowHostPaths` declaration
   alone is coarse-grained *permission*, it cannot express *"and still not these two files"*.
4. **The two contradictory comments collapse into one true sentence.** Today
   `claude-agent-sdk-client.ts` claims at `BUILT_IN_CORE_TOOLS` that "Bash here is confined to that
   workspace" and, in the V3-residual block above `PATH_ARG_FIELDS`, that "Bash beyond its
   SDK-computed `blockedPath` remains best-effort". Both stay; readers believe the first. After
   this change the true statement is: *path-bearing tools (Read/Write/Edit/Glob/Grep/NotebookEdit)
   are confined by the PreToolUse hook; Bash is confined by the OS sandbox; neither claim rests on
   parsing a command string.*
5. **`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` gets the one-line explanation, not a redesign.** The warning
   is *correct and by design*: a bare `allowedTools` entry auto-approves before `canUseTool` runs.
   Under the new posture it is harmless and the line says why. Karpathy: do **not** reopen
   `allowedTools`/`tools` semantics — D-F11/UT-024/VAL-003 depend on that list staying bare and
   non-empty, and the 7B tool-surface regression is expensive to re-earn.

Root cause is confirmed unchanged and I add one detail the requirement does not state:
`makePreToolUseHook` (`claude-agent-sdk-client.ts:291`) calls `extractCandidatePaths(tool_input)`
**with no second argument**, while `makeCanUseTool` passes `options.blockedPath`. So the two
enforcement paths are not equivalent, and the one that actually fires for auto-approved Bash is the
weaker one. With `PATH_ARG_FIELDS = ['file_path','path','notebook_path']` and a Bash `tool_input` of
`{command}`, `candidates` is `[]` and `toolUsePreCheck` returns `allow` — an **empty candidate list
is indistinguishable from a compliant one**. That is the shape of the bug, and it is worth recording
in the ADR as a *class*: **a guard whose "nothing to check" branch and its "checked and clean"
branch return the same verdict is not a guard.** Under the new design this stops mattering for Bash,
but the same pattern will bite the next tool that carries its target in a field nobody enumerated.

### REQ-219 — **delete both**, with one rider the requirement does not mention

- `src/timeout-race.ts` → **delete**, with its 2 test files.
- `src/session-options-builder.ts` → **delete**, with its 4 test files — **but** its one live
  security behaviour (the DES-031 intra-run re-walk) must be wired into production *in the same
  change*, because deleting the module silently deletes REQ-021's only acceptance evidence.

Details in §3. The rider is a **trace-chain finding the requirements author did not list**, and I
regard it as the single most important thing I found this round.

---

## 2. Key points — REQ-218

**K1. One enforcement point, one declaration surface.** Enforcement: the kernel, via the SDK's
sandbox. Declaration: a `string[]` of host paths. Everything else is plumbing. Resist any design
that introduces a second arbiter for Bash.

**K2. A pure, unit-testable seam:**
`buildSandboxSettings(workspace: string, allowHostPaths: string[], protectedFiles: string[]) → SandboxSettings`
— no fs, no env, no process. This is the only new module REQ-218 needs. It is testable at the unit
tier without bwrap; the *effect* is testable only at the real tier (Gate 7.5).

**The irony is worth naming in the ADR**: that signature is exactly the shape
`session-options-builder.ts` was built to be (pure, injected, no ambient authority). The reason the
answer to REQ-219 is still "delete" and not "revive it" is that the old module builds a *record* of
what a session would look like, not the *options the SDK is actually given* — it was a description
of the boundary standing next to the boundary. The new builder returns the object that is passed
verbatim into `query()`. Same discipline, load-bearing this time. (See §3.)

**K3. Wire it at the gateway, not at the composition root.** `src/main.ts` already defaults to the
SDK gateway; `src/server.ts` also constructs one. The sandbox settings belong where `req.workspace`
is known — the `query()` options assembly in `claude-agent-sdk-client.ts` (~line 630–665), beside
`permissionMode`, `canUseTool`, `settingSources`, `strictMcpConfig`. Do **not** thread them through
`RunManager`. Replaceability: `LiteLLMGatewayClient` has no CLI subprocess and no Bash, so it needs
nothing; the confinement is a property of the SDK gateway, and the interface should not grow a
method the other impl must stub.

**K4. Who may declare `allowHostPaths` is the ADR's real open question.** See conflict C2. I propose
**operator-owned in `rwe.config.json`, with a workflow-author *request* that is refused unless the
operator has allow-listed it** — but I flag it rather than assume it, because it is a trust-boundary
decision, not a coding preference.

**K5. Denials must reach the journal.** A sandbox denial that appears only as a failed shell command
inside an agent transcript is a silent control. `SandboxSettings.ignoreViolations` exists, which
implies violations are surfaced. Requirement: every denial produces one journal line with the run
id, the attempted path, and whether a declaration would have permitted it. Observability at agent
altitude: the operator must be able to answer *"what did the agent try to touch that it couldn't?"*
without reading transcripts. I name this; I deliberately do **not** design the event schema here
(speculative, and it belongs to whichever panellist owns observability).

**K6. Keep the PreToolUse hook.** It is cheap, it already works for the path-bearing tools, and it
is the only control that still functions if the spike in §1 comes back negative. Defence in depth
here is not gold-plating — it is the fallback that keeps the change shippable.

---

## 3. Key points — REQ-219 (measured this round, not quoted from notes)

Importer census (`grep -rn` over the repo, node_modules excluded):

| module | `src/` importers | test importers |
|---|---|---|
| `src/session-options-builder.ts` | **0** | `tests/unit/session-options-builder.test.ts`, `tests/acceptance/val-019-non-anthropic-harness.test.ts`, `tests/acceptance/val-024-workroot-isolation.test.ts`, `tests/unit/gateway-effort.test.ts` (the fence, see F1) |
| `src/timeout-race.ts` | **0** | `tests/unit/timeout-race.test.ts`, `tests/acceptance/val-023-sdk-gateway-timeout.test.ts` |

`net-guard.ts` / `workroot-guard.ts` are indeed wired (`server.ts` / `main.ts`) — confirmed, out of
scope, agreeing with the requirement.

### F1 — a standing test *asserts the opposite of REQ-219* and will go RED

`tests/unit/gateway-effort.test.ts:263` is a describe block literally named
*"session-options-builder.ts stays FENCED — zero src/ importers (ADR-006, DES-106)"*; it walks
`src/` and asserts `offenders == []`. Its own comment says the fence *"retires when the
security-hardening track wires the module deliberately"* — **this iteration is that track.**

So whichever ending the panel picks, **that fence retires in the same commit**:
- wire → the fence fails by design;
- delete → the fence passes vacuously forever, which is worse (a green assertion about a file that
  does not exist).

And **ADR-006 / DES-106 must be explicitly superseded by the new ADR**, not silently contradicted.
A panel that decides "delete" without touching ADR-006 leaves two ADRs in force that disagree.

### F2 — the coverage lie is worse than the requirement states: it reaches the VAL tier

REQ-219 says a green-but-unused module lies about coverage. Measured, it is not only the unit tier:

- `tests/acceptance/val-024-workroot-isolation.test.ts:13` imports `buildSessionOptions` and uses it
  for the clause *"session-init re-walk → buildSessionOptions refuses when cwd carries a project
  marker"* — i.e. **REQ-021's intra-run re-walk clause is verified at the real tier against code
  production never calls.**
- `tests/acceptance/val-019-non-anthropic-harness.test.ts` calls it for "clause 2/3", and its own
  header admits that case "is the only one of the three that was ever actually verifying anything in
  CI" — the other two skip without a provider.

I checked the obvious escape hatch and it is not there: `grep -rn "findProjectMarkerAncestor" src/`
returns **only** its definition in `workroot-guard.ts` and the three call sites inside
`session-options-builder.ts`. No other production file calls it. So this is not "a dead duplicate of
a live check" — the live check does not exist.

Consequence, stated plainly for the ADR: **the boot-time workRoot check (`main.ts` → `workroot-guard`)
is real; the intra-run re-walk that closes the "agent writes `.git`/`CLAUDE.md` into its own
workspace after boot" hole does not exist in production.** `rtm.md:100` nevertheless marks REQ-021 ✅
with `VAL-024, VAL-030` as its real-tier evidence — and VAL-024 is the file that exercises the
unwired module.

*Side finding, hedged*: `VAL-030`, REQ-021's only other real-tier citation, resolves to nothing under
`tests/` and appears nowhere in `05-tests.md`, whereas VAL-023/VAL-024/VAL-171 all do. If that holds
up it is a second, separate trace defect and VAL-024 is REQ-021's sole real-tier evidence. Cheap for
the panel to confirm; I am not asserting it.

That is the hard-rule violation this feature's own Gate 7.5 exists to prevent, and it
was hiding behind a module with four green test files.

### F3 — `session-options-builder`: delete, and rescue the one live behaviour

Three things the module holds, and what happens to each:

1. `thinkingMode` (non-Anthropic → disabled) — **already live** in the inline assembly
   (`wired.thinking`, the D-F6 400-regression fix). Duplicate. Dies with the module.
2. `settingSources` — the module **hard-codes `['project']` unconditionally**; production is
   `req.workspace !== undefined ? ['project'] : []`. These differ, and **the module is the less safe
   of the two**: with no workspace it would still load project settings from whatever cwd the engine
   process happens to be in. Wiring it as-is would be a *regression*, and REQ-219's "prove behaviour
   unchanged or explain the difference" clause would have to report exactly this. Concrete argument
   against the "wire it" ending.
3. The DES-031 re-walk (`findProjectMarkerAncestor(cwd, workRoot)`) — **the only live security
   behaviour, and it calls into `workroot-guard.ts`, which is already wired.**

So: delete the module and its 4 test files, and in the same change put the one live line directly
into the SDK client's option assembly, before `query()` — refuse the call with the existing typed
`WORKROOT_INSIDE_PROJECT` error when a marker is found between `req.workspace` and the configured
workRoot. Then **re-point VAL-024's re-walk clause and VAL-019's clause 2/3 at the production path**.

This satisfies REQ-219's binary honestly (the module is gone, not "kept for later") *without*
quietly dropping a REQ-021 clause on the way out. If the panel prefers "wire it" instead, that is
defensible — but then item 2 above must be fixed inside the module first, and the ledger must say
so.

### F4 — `timeout-race`: delete, and name what carries its guarantee now

It was built for *"Promise.race(call, timeoutMs) with kill-on-timeout and slot-free-exactly-once
(D-V3a #1 HIGH risk)"*. Measured, both halves have moved and the replacements are strictly better:

- **kill-on-timeout** → `AbortController` + `setTimeout(() => controller.abort(), timeoutMs)`, handed
  to the SDK's own `Options.abortController` (`claude-agent-sdk-client.ts` ~630–640, D-F10(c),
  v26/DES-171). Strictly better: `raceWithTimeout`'s `kill` is an *injected callback* that a caller
  can forget to supply correctly, and Gate 7.5 round 4's real repro was precisely that a local race
  resolved while the real spawned CLI kept running. The SDK hook kills the actual subprocess.
- **slot-free-exactly-once** → `run-manager.ts:1547` wraps the whole spawn in
  `this._semaphore.withSlot(...)`, and `agent-semaphore.ts:44–51` releases in a `finally`. Exactly
  once, on every path, including throw. It never depended on the timeout primitive.

Ledger entry REQ-219 asks for: *built at TASK-033/DES-027 when the gateway owned its own timeout and
its own slot; superseded by DES-171 (AbortController, which kills the real subprocess) and by the
slot moving up to RunManager (`withSlot`+`finally`). Neither guarantee is now carried by this file;
it is a design that lost its job, not a guard that was forgotten.*

**Risk to name, not to hide**: deleting `val-023-sdk-gateway-timeout.test.ts` removes a real-tier
test for REQ-020. This is *less* severe than the REQ-021 case above — `rtm.md:99` credits REQ-020
with a long VAL list (VAL-023, VAL-029, VAL-171, VAL-172, VAL-175, …), so REQ-020 does not go
uncovered the way REQ-021 does. But that file already boots a real server and a real fault-injected hung HTTP endpoint
— the *right* fix is to **rewrite it against the production timeout path** (assert the run comes
back `ok:false` with a timeout and that `semaphoreGauge().inUse` returns to 0), not to delete it. If
the panel accepts a plain deletion, REQ-020 loses real-tier coverage and the RTM must say so out
loud rather than stay green.

---

## 4. Risks

| # | Risk | Lens | Sev | Mitigation |
|---|---|---|---|---|
| R1 | `sdk.d.ts:1770` says filesystem restrictions don't come from sandbox settings; the schema and the CLI binary say they do. If the comment is right, `allowWrite` is inert and the design's declaration surface evaporates. | sec | **HIGH** | Gate 2 spike, blocking the ADR: real `query()` with `sandbox.filesystem.allowWrite`, Bash writes `$HOME`, observe. Fallback named in §1. |
| R2 | The sandbox confines *Bash commands the CLI runs*; the CLI process itself is not jailed (it must reach `~/.claude`, and the executable lives at `~/.local/bin/claude`). A "deny all of `$HOME`" reading of the requirement would break the CLI. | sec | HIGH | State the boundary explicitly in the ADR: the confined principal is the agent's shell, not the harness. `allowRead` must keep the CLI's own paths. Do not let "Bash 寫 `$HOME` 被拒" be implemented as "nothing under `$HOME` is reachable". |
| R3 | `failIfUnavailable:true` makes runs **refuse to start** where bwrap is unavailable (container without CAP_SYS_ADMIN, macOS, older kernels). Verified available here; the 9/20 evidence came from the *remote* host, which I have not measured. | scale | HIGH | Accept (see C1). Measure the remote host in the same spike; if it fails, the answer is to fix the deployment, not to degrade the control. |
| R4 | Deleting `session-options-builder` deletes REQ-021's intra-run re-walk evidence and REQ-016's clause-2/3 evidence — and the re-walk has **no** other production call site (grep-confirmed), so REQ-021 is a live gap, not merely a coverage one. | sec/test | **HIGH** | §3 F3 rider: wire the live line into production and re-point VAL-024/VAL-019 *in the same change*. Non-negotiable. |
| R5 | The fence test at `gateway-effort.test.ts:263` contradicts REQ-219 and goes RED (wire) or vacuously green (delete). ADR-006/DES-106 stay in force unless superseded. | test | MED | Retire the fence and supersede ADR-006 in the same commit; the new ADR cites the old by number. |
| R6 | A shared `allowHostPaths` entry (`$HOME/.cache/jev-haiku`) is **shared mutable state across concurrent runs** — the host semaphore defaults to 32 slots. Two agents populating one cache can corrupt it. | scale | MED | Out of REQ-218's scope to *solve*; in scope to *name* in the ADR as an accepted property of any declared shared path. Do not invent a locking scheme this round. |
| R7 | bwrap adds per-Bash-call process setup; with 32 concurrent agent slots this is real but small. | perf | LOW | Measure in the spike; do not pre-optimise. |
| R8 | Sandbox denials invisible to the operator (K5). | obs | MED | One journal line per denial. |
| R9 | Deleting `val-023` loses REQ-020's real-tier timeout coverage. | test | MED | Rewrite against the production path rather than delete (§3 F4). |
| R10 | The `extractCandidatePaths` bug class — empty candidate list ≡ clean candidate list — survives the refactor for any future tool whose path field nobody enumerated. | sec | MED | Record as a class in the ADR; consider making `toolUsePreCheck` require an explicit "this tool carries no paths" assertion rather than inferring it from emptiness. Cheap, one branch. |

---

## 5. Internal conflicts between my own three lenses (surfaced deliberately)

**C1 — Security vs deployability: `failIfUnavailable`.**
Security says `true`: a control that silently degrades is not a control, and "silently degrades" is
exactly how we got here (70 shadow warnings since 9/20 that nobody's build failed on). Scalability
says `false`: fail-closed means the engine refuses to run agents on any host without bwrap —
macOS dev machines, unprivileged containers — and an engine that won't start is a worse operational
outcome than one that runs slightly unconfined.
**I resolve for `true`.** The threat model is *same-unix-user*: the agent can read
`rwe.config.json`, `auth-tokens.db` and other runs' workspaces. On such a host, a run that cannot be
confined should not start. A `false` would recreate today's failure mode with extra steps. But I
concede this is the choice most likely to be overturned by an operations lens, and if it is, the
minimum acceptable compromise is `false` **plus** a startup-time refusal to accept *remote*
submissions when the sandbox is unavailable — degrade the trust boundary, never degrade it silently.

**C2 — Security vs usability: who owns the declaration.**
Testability and usability both want the **workflow author** to declare `allowHostPaths` in the
workflow meta — it is co-located with the code that needs the cache, and it is unit-testable as
data. Security objects: the workflow author is not the operator, and a mechanism where the confined
party writes its own confinement is not a boundary. **I propose operator-owned
(`rwe.config.json`), with an author-side *request* that is refused unless the operator allow-listed
it** — the refusal message names the path, so the operator's action is one line. I flag this as the
ADR's genuine open decision rather than pretending my lens settles it; it interacts with the
principal/ownership ladder v14 and v36 already built.

**C3 — Security vs testability: the control is real-tier-only.**
bwrap cannot be exercised in a unit test, and REQ-218's acceptance explicitly demands a real run.
Testability wants a mockable seam; security says a mockable confinement is a confinement you can
mock away — and this repo has *just* been burned by exactly that (a fenced pure module with green
tests standing next to the real path). **Resolution: split by honesty, not by convenience.**
`buildSandboxSettings()` is pure and unit-tested (does the right object come out?); the *effect* has
exactly one tier — real (Gate 7.5: Bash writes `$HOME`, gets denied, and the denial appears in the
journal). **No mock-tier test may claim to verify the confinement.** This is the same rule REQ-219
is enforcing, applied pre-emptively to REQ-218 so we do not create the next unwired guard while
deleting the last two.

**C4 — Simplicity vs defence-in-depth (K6).**
Karpathy says: one mechanism, delete the other. Keeping both the PreToolUse hook and the OS sandbox
is two mechanisms. I keep both anyway, on a narrow and falsifiable ground: they cover **disjoint
tool sets** (hook → path-bearing tools, whose arguments *are* statically available; sandbox → Bash,
whose arguments are not). That is not redundancy, it is a partition — and the hook already exists
and works. I would not accept a third.

---

## 6. Expected disagreements with the other lenses

1. **A pure-security lens will want a hand-rolled bwrap/unshare wrapper** (full control over the
   namespace, no dependence on an SDK option whose docs contradict its schema). My rebuttal: we
   would be re-implementing, under this project's own maintenance, a jail that the subprocess we
   spawn already ships and already maintains — and we would have to keep it in step with every CLI
   upgrade. If the §1 spike passes, a hand-rolled wrapper is speculative architecture. If the spike
   fails, I will switch to this position myself, and I have said so up front.

2. **A simplicity lens will argue (b)-only**: just declare `allowHostPaths`, skip the OS layer. My
   rebuttal: a declaration without enforcement *is the current state with a nicer config file*. The
   9/20 evidence is not "the agent went somewhere undeclared" — it is "nothing was stopping it".
   Option (b) alone makes the ADR feel resolved while the 510 MB still lands.

3. **A performance/ops lens will fight C1** (`failIfUnavailable`) and will be right that a
   fail-closed engine is an operational liability on heterogeneous hosts. My fallback is in C1.

4. **An observability lens will ask for the denial-event schema** (K5) and will be right that I
   named the requirement without designing it. I left it deliberately: designing an event schema
   this round is speculative and belongs to whoever owns the journal contract.

5. **A pragmatist will resist deleting `val-023`/`val-024` clauses** on the grounds that losing
   real-tier tests to satisfy a cleanup requirement is a net loss. I agree — which is why my
   position is *re-point*, not *delete*, for both (§3 F3, F4). I expect the disagreement to be about
   cost, and I would rather this iteration ship one requirement properly than both cosmetically.

6. **Someone will propose keeping `session-options-builder` and wiring it**, since it is pure and
   nicely factored. I have the concrete counter in §3 F3 item 2: its `settingSources` is
   unconditionally `['project']` where production is conditional, so wiring it as-is is a
   *regression*, and REQ-219's own "prove behaviour unchanged" clause would have to report that.

7. **Someone will read REQ-218's "路徑比對不是選項" as banning `allowWrite`.** I expect to spend
   real debate time on §1 point 1: the ban is on *parsing shell commands*, not on *naming paths to
   the kernel*. If the panel accepts the broad reading, no option except "deny Bash entirely"
   survives — and that is worth stating as the reductio.

---

## 7. What I would put in the ADR (skeleton)

- **Decision**: (c) — OS-level confinement via the SDK's own sandbox, configured by an explicit
  operator-owned `allowHostPaths` declaration; the PreToolUse hook is retained for path-bearing
  tools.
- **Rejected**: path comparison (banned, and correctly so — `extractCandidatePaths` cannot see a
  Bash target, confirmed at `claude-agent-sdk-client.ts:291`); hand-rolled bwrap wrapper (rejected
  *conditionally* on the spike); declaration-only (enforcement-free).
- **Supersedes**: ADR-006 / DES-106 (the `session-options-builder` fence).
- **Open**: C2 (declaration principal).
- **Blocking evidence required before this ADR is binding**: the §1 spike, on the *remote* host.

---
---

# ADDENDUM — v37 Gate 8 send-back, debate round 1 (independent)

**Date**: 2026-09-22 · **Round**: send-back r1, independent (I have not read the other group's
send-back round). **Lens bundle unchanged**: (a) Security · (b) Scalability/performance ·
(c) Testability, Karpathy simplicity-first as tie-breaker.

**Scope discipline.** This addendum answers ONLY the Gate 8 findings routed to *architecture*
(A1, A2, A3, A4, O-1) plus the two routed elsewhere that need an architectural sentence to land
(A5, C-1), plus the LOW items that turn out to be the same object as A3 (A6, A8). Everything above
this line stands: ADR-082/083/084/085 are cited by name elsewhere in this ledger and I refuse to
re-debate REQ-218's mechanism choice from zero.

**Explicitly NOT reopened:** ADR-083's `owner_decision` (posture **C**, 不動主機). No posture flip,
no new config key to select a posture, no re-litigation of (A) vs (C). My whole argument below is
that the shipped implementation **under-delivers the owner's own ruling**, and my job is to make the
code mean what 裁決理由 (1) says — 「遠端提交」— not to trade the ruling for something else.

**Altitude call, re-affirmed.** Still both-altitudes, still an *agent-altitude* problem. One
correction to my own §0 above, which Gate 8's A1 proves I got half wrong: I wrote that
「forged token / brute force」 is system-altitude and therefore out of scope. A1 shows the system
altitude re-enters through a side door — **the agent-altitude control was installed on exactly one
of the system altitude's four admission routes.** The confinement question is agent-altitude; the
question *"which requests are subject to it"* is a plain authz-surface question and must be argued
with system-altitude rigour. I under-applied my own lens (a) last round; below I do not.

---

## Summary (addendum)

Seven findings, five rulings, one new finding of my own. In one line each:

- **A1** → the door is at the wrong layer *and* keyed on the wrong fact. One pure predicate at ONE
  choke point (`RunManager.start`/`resume`), keyed on **provenance** (`RunSpec.origin`) rather than
  the live socket peer; `call-tool.ts:120` deleted, not duplicated into three more sites.
- **A2** → do not defend against the `workRoot`-absent state, **delete it**: one owner
  (`composeConfig()`) resolves the default, `server.ts:655`'s second default goes.
- **A3 + A6 + A8** → one finding, dissolved by reading the SDK's own schema: flip
  `DENY_READ_MODE` to `'workroot'` and **delete** `ENGINE_STATE_DENY` and the `'enumerated'` arm.
  A3's incomplete list stops being incomplete by ceasing to exist; A6's "dead code" is inverted
  (the shipped arm is the dead one); A8 resolves in ARCH-176's favour.
- **A9 (NEW, mine)** → the SDK's `filesystem.allowRead` is a **re-allow punch-out of `denyRead`,
  not an allowlist** (`sdk.d.ts:5863-5865`), so sandbox reads are **default-allow**. Consequence:
  the third exposure REQ-218's own 風險面 names — 「其他 run 的 workspace」 — is **not covered at
  all by the `confined` arm we shipped**, and `allowRead: allowPaths` is a no-op under
  `'enumerated'`. This is the finding that decides A3/A6/A8.
- **A4 / O-1** → doc-truth repairs: INV-V37-1/2 reworded posture-conditional with the `unconfined`
  branch stated out loud; `rtm.md:240` re-pointed; ARCH-178 amended to record the
  `confinement_denied` deferral with an event-shaped trigger.
- **A5 / C-1** → routed elsewhere; architecture owes one sentence each. ARCH-182 **deletes** one of
  A5's two silently-insecure hops outright, and C-1's whole class closes by typing
  `refusalEnvelope(code: ErrorCode, …)` — a type is smaller than a test.

**Headline**: the v37 confinement is installed on one of four doors and keyed on transport instead
of provenance, and its read side is a no-op — all three are structural, and all three get smaller,
not bigger, when fixed.

---

## A1 — the door is at the wrong layer AND keyed on the wrong fact

**Security (a).** I accept Gate 8's finding and raise its severity's *reason*. The reviewer frames
it as "3 of 4 admission sites un-gated". Verified independently this round —
`grep -rn "\.start({" src/` outside `run-manager.ts` returns exactly four sites:
`mcp-facade.ts:710` (gated), `webhook-registry.ts:305`, `scheduler.ts:363`, `server.ts:1015`. Note
the last two: **the scheduler has two dispatchers**, an injected `Scheduler.dispatch` and a second
ticker driver inlined in `server.ts`. That is this ledger's own K1 twin-divergence class, already
named in v36. Any fix that adds the predicate *at the call sites* must be written four times and
will be wrong at three of them within two iterations. This is not an argument about tidiness; it is
the argument that decides the layer.

**The deeper defect is the key, not the count.** `call-tool.ts:120` keys on
`isRemoteSubmission = !isLoopbackPeer(req.socket.remoteAddress, headers)` — a fact about the *live
TCP peer of the request currently on the wire*. ADR-083 裁決理由 (1) says the threat is
「另一台機器送來的工作流程」 — a fact about **where the work came from**, which is provenance, not
transport. On three of the four routes those two facts are not the same fact:

| route | live peer at fire time | provenance of the work |
|---|---|---|
| `tools/call run_start` | the caller | same — the only route where peer == provenance |
| `POST /hooks/:id` | whoever holds the HMAC secret | the principal who called `webhook_create` |
| scheduler tick (×2) | **none — there is no request** | the principal who called `schedule_create` |

So the cheap repair — "thread `isRemoteSubmission` into the webhook path too, it is already computed
in `server.ts:1168`" — is **wrong in both directions** and I want that on the record before anyone
proposes it in r2:

- *It leaks.* Remote attacker (authenticated, which the incident's attacker was) calls
  `webhook_create` — un-gated, it is not `run_start` — receives the secret, then fires
  `POST /hooks/<id>` from `curl` on the box, or simply waits for the legitimate local integration
  to fire it. Peer is loopback ⇒ admitted ⇒ unconfined Bash ⇒ `$HOME`. The control is bypassed by
  one HTTP request from the wrong-but-allowed direction.
- *It over-refuses.* The operator's own locally-created webhook, fired by GitHub as designed, has a
  non-loopback peer ⇒ refused. We would break the product's advertised purpose to protect against
  a threat that route does not carry.

**Ruling (proposed ARCH-182).** One predicate, one choke point, one fact:

1. **Fact**: add `origin: 'local' | 'remote'` to `RunSpec`, stamped at the moment the work is
   *admitted*, never re-derived downstream.
2. **Choke point**: evaluate it inside `RunManager.start()` and `RunManager.resume()`. All four
   `start` sites and the one `resume` site already converge there; `call-tool.ts:120`'s door is
   then **deleted, not duplicated**. Net call sites carrying the rule: 1, down from 1-of-4.
3. **Predicate**: one pure exported function
   `admissionRefusal({posture, origin}): 'CONFINEMENT_UNAVAILABLE' | null`. Pure, two scalar inputs,
   no clock, no fs — the same discipline `buildBashConfinement()` already earned.
4. **Provenance for deferred triggers**: stamp at creation, in **both** trigger stores, using the
   idempotent `ALTER TABLE … ADD COLUMN` idiom that already exists verbatim in both files
   (`scheduler.ts:193-198`, `webhook-registry.ts`'s own v24 rebuild block). `webhooks.createdRemote`
   and `schedules.createdRemote`, written from the *creating* `tools/call`'s own
   `isRemoteSubmission`. Prior art that per-trigger provenance is an accepted shape here:
   `run_origins` (`scheduler.ts:183`) already exists and already keys runs to their trigger.

**Karpathy check, argued honestly because it is close.** The cheap alternative is one rule + one
column + a named hole: use the live peer for `tools/call` and webhooks, and stamp only
`schedules.createdRemote` (the one route with no peer at all). That is genuinely smaller — one
migration instead of two. **I reject it**, and the reason is not aesthetic: it keeps *two different
meanings of the word "remote" in one system*, which is precisely the defect that produced A1. The
webhook leak above is not a corner case; it is the shortest path from the incident's own attacker
position to the incident's own outcome. Two columns vs. one is the smallest price I know for making
「遠端提交」 mean one thing. Simplicity-first means the minimum architecture that *solves the
problem* — a rule that means two things has not solved it.

**Scalability (b).** Neutral-to-positive. The predicate is two scalar comparisons on a path that
already does `INSERT INTO runs` — unmeasurable. The provenance columns are read once per firing on
paths that already `SELECT` the trigger row (`webhook-registry.ts:305` and `scheduler.ts:363` both
have `row`/`target` in hand), so **zero new queries**; I insist the column be read from the row the
route already fetched, never by a second `SELECT` keyed on id. No index needed: both reads are by
primary key.

**Testability (c).** Strongly positive and this is the lens that makes the choke point cheap. Today
the rule is reachable only through `callTool()`, which means testing "does a scheduled firing get
refused?" requires standing up an HTTP server, a ticker and a clock. With the predicate extracted:
one pure unit test with a 2×2 truth table, plus one integration test per route asserting the
`origin` value handed to a fake `RunManager`. Four tiny tests replace one expensive one, and the
四-site census becomes a mechanical guard: a test that asserts `RunSpec.origin` is required (not
optional) makes the compiler refuse a fifth admission site that forgets it. **That is the real fix
for the 4-sites class** — not a lint rule, a required field.

**Residual I am NOT solving, stated rather than glossed** (this is the honest cost of my own pick):
a *local* principal remains unconstrained by design (ADR-083: 「本機發起的 run 仍不受限制」), so
anyone who can reach loopback — including any other process on the box, including a compromised
unrelated service doing SSRF to `127.0.0.1` — can still submit unconfined work. Posture C buys
「遠端提交動不了 `$HOME`」 and nothing more. DEPLOY.md must not round that up.

**Resume semantics, ruled explicitly** (the reviewer's A1 does not reach this, and `resume(runId)`
has no origin of its own). Two origins exist at a resume: the **stored** `RunSpec.origin` of the
original start, and the **resume request's own** remoteness. They can disagree — a run admitted
remotely while the posture was `confined`, then resumed locally after the posture flips to
`unconfined`, carries remote-authored Bash into an unconfined session. **Rule: refuse if EITHER is
`remote`.** Anything else picks one of two true facts and discards the other, which is the A1 defect
in miniature. For a legacy `runs` row predating the column, resolve to `'remote'` — and note this
is the *opposite* of R3's ruling for trigger rows, deliberately: a stale suspended run has no
operational continuity to protect (the operator re-submits), whereas disabling every existing
schedule is an outage. The asymmetry is a decision, not an inconsistency, and belongs in the ADR
text.

**One observability clause the R3 mitigation depends on**: `createdRemote` must surface in
`webhook_list` and `schedule_list` output. The DEPLOY rider asks the operator to 「review existing
triggers once」 — that is not a performable instruction unless the value is visible on the tool
surface they already use. One field on two existing projections, no new tool.

---

## A2 — the fix is to delete the optionality, not to defend against it

**Security (a).** Confirmed on disk and it is worse than the reviewer's framing. `main.ts:252`
computes `protectedFiles` unconditionally, `main.ts:439` forwards the whole `confinement` block only
`if (workRoot)`, and `claude-agent-sdk-client.ts:120` types `confinement.workRoot` as non-optional —
so the omission is *forced by the type*, all-or-nothing. On a host with no `workRoot` key (a
configuration `DEPLOY.md:511-530` documents as supported, 必須=否), the run is not merely "less
confined": `denyRead` and `credentials.files` both evaporate to `[]`, i.e. the config file with the
Google client secret and `auth-tokens.db` become readable **by the confined arm itself**. A control
that is absent is at least honest; a control that reports `enabled: true` with an empty policy is a
false green, which is the exact class REQ-219 exists to kill *in the same iteration*.

**Ruling (proposed ARCH-183): `workRoot` becomes a resolved `string` before `composeConfig()`
returns, and there is exactly ONE place it acquires a default.** Today there are two
(`main.ts:240` reads the explicit value; `server.ts:655` does `?? mkdtempSync(...)`), and that
two-defaults shape is *the mechanism of this bug* — the downstream consumer defaults independently,
so upstream can hand on `undefined` without anything looking broken. I rule `composeConfig()` the
single owner: it resolves the tmpdir default, `ServerConfig.workRoot` becomes required, and
`server.ts:655`'s `??` is **deleted** rather than left as a convenience. If the test suite relies
on that convenience, the fix is a test helper that fills it in, not a second production default —
a default that exists only for tests is a production code path nobody tests.

**Second consequence, which is why this is worth doing properly**: the same absence makes IMPL-377's
brand-new REQ-021 intra-run re-walk inert (`claude-agent-sdk-client.ts:705`). One `undefined`
silently disables two different v37 controls. After ARCH-183 neither can be disabled by omission,
because there is no omission to make.

**Scalability (b).** One `mkdtemp` at boot instead of one `mkdtemp` at boot. Nil.

**Testability (c).** Net simplification: every test that today has to decide whether to pass
`workRoot` stops deciding. I flag the one real cost — this is a **breaking change to
`ServerConfig`**, so every `createServer({...})` call site in the suite needs the field. That is a
large mechanical diff on a tree ~20 implementers share, and it must therefore be ONE task with ONE
owner and ONE commit, per the same file-ownership rule TASK-253 already applies. Do not let it ride
inside another card.

---

## A3 + A6 + A8 — these are one finding, and a grep of the SDK's own schema dissolves it

This is my largest contribution this round, and it changes what A3's fix should be.

**The measurement.** `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:5849-5870`, the doc
comments on `filesystem`:

- `denyRead` — *"Additional paths to **deny** reading within the sandbox."*
- `allowRead` — *"Paths to **re-allow** reading within `denyRead` regions. **Takes precedence over
  `denyRead`** for matching paths."*
- `allowManagedReadPathsOnly` — *"When true (**set in managed settings**), only `allowRead` paths
  from `policySettings` are used."*

**Therefore reads are DEFAULT-ALLOW.** `allowRead` is a punch-out of `denyRead`, not an allowlist.
Three consequences, all of which land on the shipped code:

1. **A8 is resolved, in ARCH-176's favour** — the CLI's own paths survive confinement, because
   nothing denies them. ARCH-175's `api` row, which reads as though `allowRead` restricts reads to
   the workspace and grants, is **factually wrong** and must be corrected. It is currently the only
   place a reader learns what the read posture is.
2. **`allowRead: allowPaths` in the shipped builder is a no-op**, not a control. Under
   `DENY_READ_MODE='enumerated'` the `denyRead` entries are `join(workRoot, <engine dir>)` and the
   `allowRead` entries are the run workspace + grants — **disjoint sets**, so the punch-out punches
   nothing out. We ship a field that does nothing, in the module whose stated purpose is that
   「the posture IS the design」.
3. **A9 (new this round): REQ-218's own 風險面 is not met by the shipped arm.** The requirement
   names three read exposures — `rwe.config.json`, `auth-tokens.db`, **「其他 run 的 workspace」**.
   The first two are covered (`protectedFiles` + `credentials.files`). The third is **not covered at
   all**. Verified on disk rather than assumed, since ADR-086 stands on it: a run's workspace is
   `join(workRoot, 'workflows', <name>, 'runs', <runId>)`
   (`workflow-catalog.ts:944-951`, consumed at `run-manager.ts:689`/`:1151`), so **every run's
   workspace is a sibling under `workRoot`**; `ENGINE_STATE_DENY` deliberately excludes them
   (ARCH-175's own note: 「not a stale sibling run-directory list」), and with default-allow reads
   there is nothing else. The builder's `root` is likewise engine-supplied, not author-supplied —
   it is `req.workspace ?? cfg.cwd` (`claude-agent-sdk-client.ts:742`) and `req.workspace` is the
   sandbox host's own `entry.workspace` (`run-manager.ts:1553`), never a value a workflow script
   chooses — so `denyRead: [workRoot]` + `allowRead: [root]` composes as intended with no extra
   containment check needed. **Precondition, stated so it cannot silently lapse**: if a future
   iteration ever lets an author pass a `workspace`, ADR-086 requires that value to be
   containment-checked against `workRoot` before it reaches the builder. An agent in run A can read run B's workspace — including run B's
   seeded source, prompts and outputs — under the *confined* arm. Cross-tenant read, in the arm we
   call the control.

**Ruling (proposed ADR-086): flip `DENY_READ_MODE` to `'workroot'` and delete the `'enumerated'`
arm together with `ENGINE_STATE_DENY`.** `denyRead = [workRoot, ...protectedFiles]` with
`allowRead = [this run's workspace, ...grants]` is the composition the SDK schema actually
implements: deny the whole tree, punch out this run's own workspace. It covers engine state,
covers sibling workspaces (A9), and needs **no hand-maintained list** — which means:

- **A3 does not get "a completeness invariant" or "an operator-config-driven derivation". A3
  ceases to exist**, because the enumeration it is about is deleted. This is the Karpathy answer in
  its strongest form: the finding says "this hand-maintained list is incomplete"; the right move is
  to notice the list should never have existed.
- **A6 inverts.** A6 files the `'workroot'` branch as dead code to delete. It is the opposite: it
  is the only branch that implements the requirement, and the branch that ships is the dead one.
  Deleting the wrong one would have locked in A9 permanently.
- **The one residue A3 correctly identifies survives and must be handled explicitly:** operator path
  overrides (`casDir`, `webhookDbPath`, `schedulerDbPath`, `continuationDbPath`, `assetRoot`,
  `selfUpdateDbPath`) can point **outside** `workRoot` — verified, `server.ts:812` is
  `config?.webhookDbPath ?? join(workRoot, 'webhooks.db')`. `denyRead: [workRoot]` does not reach
  them. So `denyRead` must be `[workRoot, ...enginePathsFromTheComposedConfig, ...protectedFiles]`,
  where the engine paths are taken as **values off the composed config object**, never re-derived
  from key names. That is a derivation from one source of truth, not a second list.

**Invariant (proposed INV-V37-4).** *Every config value that names a filesystem path the engine
itself writes must appear in the confinement's `denyRead`.* Unlike A3's suggestion this is
**mechanically checkable**: a test enumerates the path-typed keys of the composed config and asserts
each resolved value is contained in some `denyRead` entry. It fails the day someone adds a seventh
path key — which is exactly the failure the current tautological test
(`bash-confinement.test.ts:30`, asserting the constant against itself) can never produce.

**Security (a).** Strictly widens the control; closes a cross-run read the requirement named.
**Scalability (b).** `denyRead` shrinks from 8+N entries to ~2+N; per-call allocation is smaller.
Deleting a branch and a constant removes code from a hot-ish path.
**Testability (c).** Mixed and I will not pretend otherwise: the new invariant test is real work
(it needs a composed-config fixture), and **none of this is measurable on any host this ledger has
touched** — the `confined` arm has never executed a real Bash call (S1/S9). I am ruling on schema
reading, not on a real run. That is a genuine weakness of this ruling and the reason I give it a
named revisit trigger: *the first host that measures `confined` must re-run the read-side arms
before anyone treats this as verified.* It is still strictly better than shipping a field the schema
says does nothing plus a list the requirement says is the wrong list.

---

## A4 — the invariants are false as written; posture-conditional is not a weakening

INV-V37-1 (「No agent Bash write may land outside…」) and INV-V37-2 are written as unconditional
global truths. Under the owner's own accepted posture C on this host, **every local run violates
INV-V37-1** — the sandbox is not attempted at all. An invariant that the shipping system violates on
every run is not an invariant; it is a slogan, and INV-V37-3 (which v37 itself introduced) exists
precisely to forbid this shape of claim.

**Ruling:** reword both as posture-conditional — *"When the boot probe measures `confined`, …"* —
and add the second half explicitly: *"When it measures `unconfined`, no filesystem confinement is
attempted for any run; the only control in force is the admission refusal of remote-origin work
(ARCH-182)."* Naming the `unconfined` branch is the point. A reader must not have to infer the
degraded posture from the absence of a sentence.

Same repair on `rtm.md:240`: REQ-218's trace row cites ARCH-175..178 (the arm that does not run) and
omits ARCH-181/DES-261/262/IMPL-375/376 (the arm that does). Given my A1 ruling, the corrected row
should cite the **choke-point** rows, so this edit should land after ARCH-182 has an id — not
before, or it will need a second edit.

**Testability note (c):** an invariant with a stated condition is testable (assert the condition,
assert the consequence). An unconditional one that is false is not testable at all, which is why
nothing caught it. This is the same failure mode as the tautological test in A3: both are assertions
that cannot fail.

---

## O-1 — the architecture row must record what shipped, not what was predicted

ARCH-178 says `agent.confinement_denied` is built *if* spike S4 is positive. S4 was positive. The
event was not built. IMPL-374 says so honestly; `02-architecture.md` does not, so a reader of the
architecture alone believes the event exists. Cheap and unambiguous:

**Ruling:** amend ARCH-178 in place to state the deferral, with an event-shaped trigger (*"built when
the first host measures `confined`, since a denial event on a host that never attempts confinement
can never fire"* — which is also the honest reason it was deferred, and a good one). No new id, no
code. **I explicitly agree with Gate 8 that building the event is not required** — on this host it
would be an event that structurally cannot fire, which is the same defect class as VAL-255's
always-empty `phases[].agents` field found four commits ago.

---

## A5 and C-1 — routed elsewhere, but each needs one architectural sentence

**A5 (wiring lock, → impl+tests).** Agreed, and I want the reason on the architecture record because
this repo's own memory names `composeConfig` mis-wiring as its recurring failure mode (twice bitten:
v11 `updateFlagPath`, v15 auth). The *posture* hop has a property the *grant* hop does not: **both
of its failure directions are silently insecure.** Drop `main.ts:368` ⇒ the door reads `undefined`
⇒ every remote submission admitted. Drop `main.ts:443` ⇒ every run ships unconfined. A wiring bug
here does not degrade to inert, it degrades to open.

**Proposed INV-V37-5:** *any security-relevant field forwarded from `FileConfig` through
`composeConfig()` carries a hop-level wiring assertion.* Note that ARCH-182 **shrinks** this
obligation — moving the door to `RunManager` deletes the `main.ts:368` → `ToolDeps` hop entirely, so
one of the two silently-insecure hops stops existing rather than getting a test. That is the
tie-breaker rewarding the right structure: the cheapest guard is the hop you deleted.

**C-1 (`CONFINEMENT_UNAVAILABLE` missing from `ERROR_CATALOG`, → impl).** Agreed, no architecture
decision needed, one structural note: the root cause is that `refusalEnvelope(code: string, …)`
takes a bare `string`. UT-164 locks catalog↔authz in one direction and cannot see an ad-hoc call
naming a code in neither list. **Type the parameter as the closed `ErrorCode` union** and the whole
class stops being a test's responsibility — the compiler refuses the next one. Karpathy: a type is
smaller than a test.

---

## Key points (condensed)

1. **ARCH-182 (proposed)** — one predicate, one choke point (`RunManager.start`/`resume`), keyed on
   `RunSpec.origin` provenance, not the live socket peer. Delete `call-tool.ts:120`'s door.
2. **`origin` stamped at creation in BOTH trigger stores** (`webhooks.createdRemote`,
   `schedules.createdRemote`), idempotent-ALTER idiom already present in both files; read from the
   row the route already fetched, zero new queries.
3. **`RunSpec.origin` required, not optional** — the compiler, not a census, guards admission site #5.
4. **ARCH-183 (proposed)** — `workRoot` resolved to a `string` in `composeConfig()`, `server.ts:655`'s
   second default deleted; kills A2 and the inert REQ-021 re-walk with one change.
5. **ADR-086 (proposed)** — `DENY_READ_MODE='workroot'`; delete the `'enumerated'` arm AND
   `ENGINE_STATE_DENY`. A3 dissolves; A6 inverts; A8 resolves in ARCH-176's favour.
6. **A9 (new)** — SDK reads are default-allow; `allowRead` is a punch-out. Sibling run workspaces,
   named in REQ-218's 風險面, are readable under the *confined* arm today.
7. **INV-V37-4 (proposed)** — every engine-written config path must appear in `denyRead`;
   mechanically checkable, replaces a tautological assertion.
8. **INV-V37-1/2 reworded posture-conditional**, with the `unconfined` branch stated explicitly;
   `rtm.md:240` re-pointed after ARCH-182 gets an id.
9. **ARCH-178 amended** to record the `confinement_denied` deferral with an event-shaped trigger.
10. **`refusalEnvelope(code: ErrorCode, …)`** — a type, not a test, closes C-1's class.

---

## Risks

- **R1 (highest).** The read-side ruling (ADR-086) is derived from the SDK's *doc comments*, not from
  a real confined Bash call — no host in this ledger can execute one. If the CLI's `denyRead` does
  not compose with `allowRead` as documented, `'workroot'` mode denies the agent its own workspace
  and **every run dies** — the exact failure ARCH-175's note feared when it chose `'enumerated'` as
  the built-in. *Mitigation*: the flip must be gated behind the same spike discipline TASK-250 used —
  first host that measures `confined` runs the read-side arms before the flip is trusted. I am ruling
  the *direction*, and the direction is safe to record now because the arm cannot execute today.
- **R2.** Two schema migrations on live operator databases. Mitigated by the idiom already in both
  files, but it is still two more `ALTER TABLE` lines in a boot path that has a documented history of
  rebuild blocks (D13).
- **R3 (the one I most want recorded).** `createdRemote INTEGER NOT NULL DEFAULT 0` grandfathers
  every pre-existing trigger row as **local**. On the incident host, any webhook or schedule the
  2026-09-20 remote submission left behind is whitelisted by exactly the control built to stop it.
  *Mitigation, not a fix*: a boot WARN naming the count of un-stamped rows, plus a DEPLOY.md rider
  that the operator reviews existing triggers once. **I am recording this as unresolved-by-design,
  not as handled.** Fail-closed (`DEFAULT 1`) would silently break every existing operator's
  schedules on an unconfined host, and I judge a loud-but-open default with a disclosed sweep better
  than a silent outage — but this is a genuine security concession and the next round should push on
  it rather than accept it because I wrote it down.
- **R4.** ARCH-183 is a breaking `ServerConfig` change across a shared tree. Must be one task, one
  owner, one commit (the TASK-253 rule), or it will collide with ~20 concurrent implementers.
- **R5.** ARCH-182 deletes a control that has *real-tier evidence* (REQ-218's Gate 7.5 record proves
  the `tools/call` door). Validation must re-earn that evidence on the new choke point, including at
  least one webhook-path and one scheduler-path real run. Until it does, REQ-218's green is stale.

---

## Expected disagreements with the other lens group (quality-dimensions)

1. **The two columns (consumability / replaceability).** I expect their sharpest objection here:
   two `ALTER TABLE`s plus a new required `RunSpec` field is new persisted surface, and their
   consumability lens will prefer the one-column variant (peer for webhooks, column for schedules)
   or a derivation from the existing `createdBy` principal. *My pre-answer*: `createdBy` is a
   principal **id**, and ARCH-181's own note already establishes why identity cannot answer
   「is this remote」 — on the default loopback+auth config every local caller carries an ordinary
   id-bearing principal. Provenance is not derivable from anything currently stored. If they
   produce a stored fact I have missed, I will concede the column.
2. **`RunSpec.origin` required vs. optional.** Their replaceability lens will likely want it optional
   for backward compatibility of the `RunManager` port. I will hold: optional re-creates the
   `undefined`-means-don't-gate failure that A5 identifies and A2 demonstrates. A security field
   whose absence means "allow" is the bug, not the compatibility story.
3. **ADR-086 (the read-side flip).** I expect them to resist ruling on an arm no host can execute —
   their self-sustainability lens is rightly allergic to unmeasured decisions, and R1 is a real
   objection. *My position*: not flipping is also an unmeasured decision, and it is the one that
   ships a field the SDK schema says does nothing plus an exposure (A9) the requirement names. Given
   two unmeasured options, take the one the vendor's own schema supports.
4. **A3's shape.** They may prefer "complete the enumeration + add an invariant" (incremental, no
   behaviour change) over "delete the enumeration". I think that is the conflict worth having in r2:
   completing a list the requirement's own 風險面 says is the wrong list buys a green test and no
   security.
5. **Where I expect to agree, and will say so early to save a round**: A4's posture-conditional
   rewording, O-1's ARCH-178 amendment, C-1's typed `ErrorCode`, and the observation that
   `agent.confinement_denied` should NOT be built on a host where it cannot fire (their
   observability lens usually argues for more events; here the event is structurally empty, the same
   defect as VAL-255's `phases[].agents`, and I expect them to reach the same conclusion by their
   own route).

---

## Internal conflicts within my own three lenses (surfaced, as required)

- **(a) vs. Karpathy — A1's column count.** Security wants one meaning of 「remote」 (two columns).
  Karpathy wants the smaller diff (one column, two rules, one named hole). I ruled for security and
  the reason is narrow and checkable: the hole is not hypothetical, it is a two-request replay of the
  incident's own attack. *Karpathy conceded to a named attack path, not to caution.*
- **(a) vs. (c) — R3's default.** Security says `DEFAULT 1` (fail closed). Testability and
  operability say `DEFAULT 0` with a loud WARN, because fail-closed turns an upgrade into a silent
  outage of every existing schedule. I ruled for `DEFAULT 0` and marked it **unresolved-by-design** —
  this is the one place in this addendum where my own security lens lost and I do not think the
  argument is finished.
- **(b) vs. (a) — A3's derivation.** Scalability mildly prefers the static constant (allocation-free,
  no config walk per call). Security requires the operator-override paths. Resolved without conflict:
  derive once at boot into a frozen array, allocate nothing per call — the composed config is
  already boot-frozen, so this costs nothing at runtime.
- **(c) vs. (a) — ADR-086's unmeasurability.** Testability's honest verdict on the read-side flip is
  「you cannot test this here」. Security's is 「the arm as shipped does not do what the requirement
  says」. I let security rule the *direction* and testability rule the *trust*: record the decision,
  gate the trust on the first `confined` host. Neither lens wins outright and the split is
  deliberate.

---

# ADDENDUM 2 — v37 Gate 8 **round-2** send-back, debate round 1 (independent)

*Adversarial architecture group (security / scalability / testability, Karpathy simplicity as
tie-break). Written 2026-09-23, independently, against the round-2 send-back
(`07-review.md` §"v37 GATE 8 round 2", `send_back=[architecture,impl,validation]`). I have NOT read
this round's quality-dimensions r1. Appended, not overwritten — the two prior rounds are the record
ADR-086 cites and must stay readable.*

**Scope discipline.** This is a send-back repair round: no re-decomposition, no new REQ, closure
stays `{REQ-218, REQ-219, REQ-018, REQ-037, REQ-117}`. I organise strictly by the sent-back
findings. **REQ-219 is CLOSED** — both modules are gone from disk (`ls src/session-options-builder.ts
src/timeout-race.ts` → no such file; the only surviving reference is
`tests/acceptance/val-254-req219-dead-code.test.ts`, which is the standing guard my own r1 §F1 asked
for). One line, not reopened.

**Altitude call (both, and the split is the whole story).** This is simultaneously a conventional
system (HTTP + SQLite + OAuth principals + HMAC ingress) and an AI-agent system (a tool-loop harness
that executes remotely-authored scripts which drive `Bash` under the engine's own unix identity).
REQ-218 is an **agent-altitude** confinement problem. Everything v37 shipped for it after the
sandbox probe failed — the `tools/call` door, `createdRemote`, `admissionRefusal()` — is a
**system-altitude admission control**. That substitution is legitimate as a compensating control and
it has one permanent ceiling worth writing down once: *admission control can only ever change **who
may fire**; it can never change **what the agent may do** once it fires.* Every finding below is
downstream of that ceiling.

---

## Summary

Five rulings, ranked by what actually moves the risk:

1. **B2 is larger than the review states, and the correction is arithmetic, not semantic.**
   The review frames B2 as a re-arm path. It is that, but the first-order fact is simpler and
   structurally certain: **`createdRemote` was added by this iteration, therefore every trigger row
   that exists on the production host today reads `0`, therefore ARCH-182 refuses exactly nothing on
   the population that motivated REQ-218.** The legacy-cohort `DEFAULT 0` decision and B2's
   re-arm path are the same defect seen at two times: coverage starts at zero and stays at zero,
   because the only event that ever writes the column (row creation) is not an event the production
   workflow lifecycle performs. I cannot rule on the fix — it reverses or confirms an owner ruling.
   I can, and do, demand the ruling be re-taken against the corrected number.
2. **B4 and B7 are one change, not a MED plus a deferred v38 candidate.** Both are the same missing
   fact: *nothing classifies a `start()` throw as retryable-vs-permanent at the three non-facade
   admission sites.* One shared classifier plus **one word added to `RefusalReason`** fixes the
   uncoded 403, restores durable refusal accounting on the webhook row, and dissolves B7's
   re-fire-forever loop for free. Arguing B7 into this round is the only scope expansion I ask for,
   and it costs nothing extra.
3. **B1's fix is not three tests — it is one extended predicate plus required keys.** The review's
   remedy (write the missing cases) is correct and insufficient: the reason a forward could be
   dropped silently is that the forwards are *optional with a permissive default*, and the reason
   there are five of them is that v37 kept **two checks for one predicate**. Measured this round
   (and it reversed my own draft ruling): **`RunManager.resume()` never calls `admissionRefusal()`**
   — `run-manager.ts:473` is the only call site, `:848` is `resume` — so the `call-tool` door is not
   redundant, it is the sole cover for `run_resume`, and ARCH-182's «the ONE predicate every run
   admission passes» is false as written. Extend the predicate to `resume()`, make the forwards
   required keys so the compiler is the lock, and only then collapse the duplicate. That is the
   discipline ARCH-182 already applied to `RunSpec.origin` and then applied to nothing else.
4. **B3 is a symmetry bug with a security consequence**: `ScheduleStatus.createdRemote` is
   projected, `WebhookView.createdRemote` is not. A value that decides whether code executes and
   cannot be read back is unauditable by construction. Mirror the field; it is one line and it
   unblocks both the sweep and B1's webhook case.
5. **QD-MED / B5 / B6 are text, and the architectural rule behind them is one sentence**: a comment
   or guide paragraph that states a *fact about the code* must either cite the line that makes it
   true or be deleted. REQ-218 exists because two comments contradicted each other and readers
   believed the wrong one; this repair wrote a third instance. That is the class, not the instance.

**Boilerplate lens items, dispatched in three lines so they do not eat the round:** webhook HMAC
compare is already `timingSafeEqual` with a length short-circuit (`webhook-registry.ts:329-334`) —
no timing oracle. The admission predicate runs *after* signature + timestamp-window verification
(`deliver()`'s documented order, re-read this round), so an unauthenticated peer cannot use it to
probe host posture — that ordering is load-bearing and should be stated as an invariant before
someone "optimises" the cheap check upward. There is no JWT in this path and no brute-forceable
credential; the one real disclosure risk is B4's `err.message` pass-through (§2).

---

## Key points (condensed)

- **KP1.** `createdRemote` records *row creation*. Nothing in the production lifecycle
  (`claim()`'s `'held'` arm, `workflow_register`, `workflow_publish`) ever writes it, and no
  pre-upgrade row carries it — so ARCH-182's refusal arm is unreachable for the existing trigger
  population. ARCH-182/ADR-086 assert otherwise; the text must be corrected whatever the owner
  decides.
- **KP2.** The owner's 2026-09-23 ruling weighed «blackout vs. a residual needing operator action».
  The real trade is «a visible blackout vs. a control that refuses nothing here». Re-put it, with
  four options ranked (iii) fix the host > (iv) drop `Bash` when `unconfined` > (ii) add
  `workflow_versions.origin` > (i) keep C and correct the text.
- **KP3.** B4 and B7 are one change: `classifyStartRefusal()` (permanent/retryable) + one word added
  to `RefusalReason`. That gives the webhook 403 a `code`, makes `RUN_ADMISSION_LIMIT` retryable
  again, records refusals durably on both trigger stores, and ends the re-refuse-forever loop.
- **KP4.** B1's real fix is structural: `resume()` is not covered by the predicate (verified — so
  the `call-tool` door is *not* redundant), and every security-relevant forward is optional with a
  *permissive* default. Extend the predicate to `resume()`, make the forwards required keys, keep
  one non-vacuous `unconfined` boot test. Fewer hops beats more hop-locks.
- **KP5.** `WebhookView` must project `createdRemote` as `ScheduleStatus` already does — a value
  that decides whether code executes and cannot be read back is unauditable, and its absence blocks
  both the promised sweep and B1's webhook assertion.
- **KP6.** One rule covers QD-MED/B5/B6: a comment or guide paragraph asserting a fact about the
  code cites the line that makes it true or is deleted; and optionality is acceptable exactly when
  the default is the *safe* answer, never the permissive one.

---

## 1. B2 — the admission control's coverage on the production host is zero by construction

### 1.1 What I verified myself (not accepted from the review or either panel)

- `createdRemote` is written at exactly two sites, both `INSERT`: `webhook-registry.ts:170-176`,
  `scheduler.ts:294-307`. Both carry this iteration's own comment «written ONCE at creation, never
  updated afterwards».
- `claim()` (`webhook-registry.ts:211-219`, read in full) touches `workflow` only. **And note the
  arm the review's own attack narrative depends on:** when the trigger is *already* this workflow's,
  `claim()` returns `'held'` **before any `UPDATE` at all**. So even a hypothetical "stamp at
  `claim()`" repair would not fire on the re-register path unless it also stamped the `held` arm.
- `mcp-facade.ts:349` `workflowRegister(a, principal)` and `:492` `workflowPublish(a, principal)`
  take **no deps argument**; `call-tool.ts:212/214` dispatch them with `(a, principal)` only.
  `deps.isRemoteSubmission` **does not reach either**. Any attachment-time stamping is therefore a
  *new* forward through the facade — i.e. a sixth hop, governed by INV-V37-5, on the same iteration
  that just failed to lock five.
- The script that actually runs is selected by `catalog.resolve(workflow, {channel:'release'})` at
  both trigger dispatch sites. **The attachment event that matters is therefore `workflow_publish`
  moving the release pointer, not `claim()`** — `claim()` binds an id, `publish` decides which bytes
  that id will execute. The review names `claim()`; the real laundering point is one call later.

### 1.2 The arithmetic the owner's 2026-09-23 ruling was not given

ADR-086's ruling weighed *«方案 B 會讓這台主機上每一個現有工作流程都停跑»* against *«殘留風險需要
操作者自己動手»*. Both sides of that trade are wrong as stated:

- **The residual does not require operator action.** B2's path is a cron tick. Correct.
- **But the prior, larger fact:** `webhooks.createdRemote` / `schedules.createdRemote` are columns
  **this iteration adds**, and every row created before that migration runs reads `DEFAULT 0` by
  the same ADR's own decision. I have not queried the deployed host (and should not), so I state
  the bound rather than the number: **every trigger that predates the v37 upgrade — which, on a
  host still printing the 2026-09-20 `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` lines, is all of them —
  reads as local, so ARCH-182's refusal arm is unreachable for it.** Not "weakened", not "has a residual":
  **coverage zero**, until each trigger is deleted and recreated by a remote caller. No attack is
  needed to reach this state; it is the upgrade's resting state.

So the choice the owner actually faced was not «blackout vs. a narrow residual». It was
**«a visible, immediate blackout (B)» vs. «a control that silently refuses nothing on this host (C
as shipped)»**. That is a materially different trade and it must be re-put.

### 1.3 The options, with costs I will defend

| | Option | What it costs | What it buys |
|---|---|---|---|
| **(i)** | Keep C, **correct the text** — ARCH-182 stops claiming provenance tracks attachment; ADR-086 records coverage-zero-on-legacy explicitly; B3's sweep becomes the compensating control | operator must sweep + recreate triggers to get *any* coverage; the re-register path stays open forever | honesty; no blackout; no code change |
| **(ii)** | Adopt B **in addition** (`workflow_versions.origin`, OR-ed with the trigger fact — my own r2 §1 design, purely additive, no re-keying) | every production workflow stops until locally re-registered — loud, at upgrade, once | the only option that closes B2's path and the legacy cohort together |
| **(iii)** | **Fix the host**: make the nested-userns probe pass (this is what spike S1 blocked on), so posture is `confined` | a host-level fix, possibly a kernel/AppArmor change; unknown effort | the entire question dissolves — provenance stops being load-bearing at all |
| **(iv)** | **Fail-closed at the agent altitude**: when posture is `unconfined`, remove `Bash` from the agent tool surface (the SDK's own `disallowedTools`) instead of gating who may fire | every Bash-using workflow fails — but with a code and a reason, not silently | cannot be re-armed by any register/publish/claim path; needs no column, no migration, no ruling about remoteness |

**My ranking: (iii) > (iv) > (ii) > (i).** The reasoning, in one line each. (iii) is the only option
that restores the control REQ-218 actually asks for — everything else is a proxy for a sandbox that
is not running. (iv) is the honest degradation: it makes the *engine's own claim* true on every host
in every posture, and it is the same discipline REQ-218's acceptance criteria already blesses for
paths («顯式申報契約 —— 讓共用快取變成申報而非默許»), applied one level up to the tool itself.
(ii) is correct-but-expensive and the expense lands all at once on a live host. (i) is defensible
**only** if the text stops asserting a coverage the code does not have — as shipped, ARCH-182 reads
like a control and behaves like a label.

**What I explicitly do NOT propose, and why (Karpathy tie-break, stated so the next round does not
re-invent it):** a "locally bless this workflow version" allowlist (`{workflow, scriptSha256}` in
`rwe.config.json`) is the obvious way to buy (ii)'s security without (ii)'s blackout. I drafted it
and I am declining it. It is a new configuration surface, a new boot validator, a new re-pin ritual
on every release, and a new way to be wrong (name-keyed entries would launder the next version, so
it must be hash-keyed, so it must be re-pinned, so it will be pinned once and forgotten). That is
three mechanisms bought to avoid one owner decision. **The deliverable of this round is a corrected
`owner_decision`, not a mechanism that lets us avoid taking one.**

**Half-measure, named and declined:** stamping provenance on `claim()`'s `'claimed'` arm only
(adopting a previously-unclaimed trigger). It closes the narrowest sub-path, leaves the `'held'`
re-register path — the actual one — open, and makes the column's meaning *even harder* to state.
Worse than either endpoint.

### 1.4 What architecture can do this round without the owner

Regardless of which option wins: **amend ARCH-182's justifying sentence and ADR-086's consequence
paragraph so the ledger states what the code computes** — provenance of *row creation*, never of
attachment, never of authorship — and record the coverage-zero-on-legacy fact as a first-class
consequence rather than a `DEFAULT 0` footnote. A wrong premise in an ADR is worse than a known gap,
because the next iteration reasons from it.

---

## 2. B4 + B7 — one classifier, one vocabulary word, three sites

### 2.1 The defect is a missing classification, not a missing `code` field

`webhook-registry.ts:316-323` maps **every** `start()` throw to `403 + flattened message`. Three
distinct failures follow, and they are all the same root:

- **Retryable answered as permanent.** `RUN_ADMISSION_LIMIT` (`run-manager.ts:495`) is explicitly
  retryable; it now returns 403 Forbidden to a webhook sender, which will not retry. This inverts
  the *exact* reasoning ARCH-182 used to hoist `admissionRefusal()` above the limit check. The
  architecture got the ordering right at the choke point and then threw the distinction away at the
  first consumer.
- **Uncoded wire error.** `DeliverResult`'s 409 arm carries `code`; the 403 arm does not. C-1 was
  closed at `tools/call` and reopened at the ingress ARCH-182 exists to cover.
- **Message pass-through is an information-disclosure decision nobody took.** `toErrEnvelope(err)
  .message` goes straight to the wire. Today that string is
  «…the boot-time sandbox probe found no working nested user namespace…» — i.e. an HMAC-authenticated
  peer who knows one webhook secret learns the host's sandbox posture; `RUN_ADMISSION_LIMIT`'s
  message ships `maxConcurrentRuns=N`. Neither is catastrophic; both are *unaudited*. **Rule: a wire
  boundary emits `code` + static catalog text. `err.message` is for logs.**

### 2.2 The fix, and why B7 rides it for free

One shared, pure classifier next to `admissionRefusal()` — same file, same test shape, no new module:

```
classifyStartRefusal(err) -> { code: ErrorCode; retryable: boolean; httpStatus: 403 | 409 | 503 | 500 }
```

- `CONFINEMENT_UNAVAILABLE` → permanent, 403, `code` on the envelope, static text.
- `RUN_ADMISSION_LIMIT` → retryable, **503** (the sender should retry; 403 tells it never to).
- anything else → 500 + static text, `err` to the log only.

Then **add `'CONFINEMENT_UNAVAILABLE'` to `RefusalReason`** (`types.ts:427`, currently four members,
already a deliberately *shared* vocabulary between the scheduler and the webhook registry). That one
word does three jobs at once:

1. `WebhookRegistry._recordRefusal(id, 'CONFINEMENT_UNAVAILABLE')` becomes legal — the refusal lands
   in `refusalCount` / `lastRefusedAt` / `lastRefusalReason` like the other four, so a refused
   delivery leaves a durable forensic trace instead of nothing.
2. The ticker can route a **permanent** refusal to `scheduler.markRefused(firing, reason)`
   (`scheduler.ts:501`, which already takes exactly a `RefusalReason` and is already the path
   `resolveScheduleTarget`'s pre-dispatch refusals use) instead of `markFailed`. **That is B7**: the
   re-fire-every-period-forever loop with an un-incremented `refusalCount` and a `console.error`
   per period exists solely because a permanent refusal is currently routed through the
   *dispatch-failure* writer. It is one branch on `classifyStartRefusal(err).retryable`.
3. Failure accounting becomes *consistent across all four admission routes*, which is the only
   scalability-lens claim I will make about this system (see §5).

**I ask for B7 to be pulled into this round.** The review filed it as a v38 candidate because
ARCH-182's contract table literally prescribes `markFailed` — correct, and that is precisely why it
belongs here: the architecture row is wrong, this is the architecture gate, and the repair is one
branch inside a change we are already making. Deferring it means shipping a known
refuse-and-retry-hourly-forever loop on the one host we know is `unconfined`.

---

## 3. B1 — fewer hops beats more hop-locks

### 3.1 The census, re-run

The review's grep census is exact; I re-ran all three and confirm it. What I want to add is *why*
five forwards exist at all.

`call-tool.ts:124` still runs the v37 door (`spec.name === 'run_start' || 'run_resume'` &&
`deps.confinementPosture === 'unconfined'` && `deps.isRemoteSubmission === true`) **and**
`call-tool.ts:223` passes `deps.isRemoteSubmission` into `facade.runStart(...)`, which stamps
`RunSpec.origin`, which `RunManager.start()`'s `admissionRefusal()` then evaluates as its *first
statement*. **These are two implementations of one predicate on one path.** They read the same two
facts through two independent forwards (`server.ts:813` → `RunManager`, `server.ts:902` → `ToolDeps`)
and they can drift without a type error.

That is the actual architecture defect under B1. INV-V37-5 asks for a lock per hop; the cheaper move
is to have fewer hops:

- **NEW FINDING, and it inverts my own first draft of this section — `resume()` is not gated by
  the predicate at all, so the door is NOT redundant; it is the only cover for one route.**
  I nearly wrote "delete the `call-tool.ts:120-127` door, it is strictly redundant". Measured
  before writing it: `grep -n "admissionRefusal\|async resume" src/run-manager.ts` →
  `admissionRefusal` is called at **:473 only** (inside `start()`); `async resume(runId)` is at
  **:848** and never calls it. The door covers `run_start` **and** `run_resume`; the predicate
  covers `start()` only. So:
  - **ARCH-182's own headline claim — «the ONE predicate every run admission passes» — is false as
    written.** A resume is an admission of Bash-capable agent work onto an `unconfined` host, and
    it passes a *different*, facade-local check. Today no route other than `tools/call` can reach
    `resume()`, so there is no live hole — but the sentence in the ledger asserts a property the
    code does not have, which is the same class as B2's premise and B5's comments, in the row that
    exists to close them.
  - This is also exactly the omission my own r2 §1(5) predicted («`resume(runId)` carries no
    `RunSpec`, so `RunManager.resume()` grows a required `origin` argument») and which the repair
    did not land.
  - **Ruling: the predicate is extended to `resume()` FIRST (a required `origin` argument on
    `RunManager.resume()`, stamped from the resume request's own peer exactly as `start` is), and
    only then does the door become genuinely redundant and deletable.** Sequenced, not simultaneous
    — see R3. One forward (`ToolDeps.confinementPosture`) disappears with the door, at the end of
    that sequence, not at the start of it.
  - *Cost, stated honestly:* the door is where REQ-218's real-tier evidence currently points
    (VAL-253 / DES-262). Deleting it requires re-pointing that evidence at the predicate — which
    VAL-256 already exercises through two of the four routes. **If this round keeps the door (my
    recommendation: keep it, extend `resume()`, defer the deletion), then INV-V37-5 must state that
    the two checks are one predicate over two route sets and may never diverge**, and one test must
    assert both refuse the same input. Silent duplication is the unacceptable third outcome.
- **Make the survivors required properties, not optional ones.** `buildToolDeps(webhookBaseUrl,
  isRemoteSubmission = false)` (`server.ts:901`) is a **fail-open default on a security value** —
  drop the argument and a remote caller is read as local, with a clean compile and a green suite.
  That is the precise shape of the bug the review found, and the type system already pays for the
  fix:
  - `buildToolDeps(webhookBaseUrl: string, isRemoteSubmission: boolean)` — required. The one
    internal caller (`buildInitializeInstructions`, `server.ts:909`) passes `false` explicitly,
    which is also the only place that "this call is not a submission" is *true by construction*
    rather than by default.
  - `ToolDeps.confinementPosture` and `ToolDeps.isRemoteSubmission` become **required keys with
    `| undefined` values** (required key, nullable value) instead of `?:`. "Never measured" stays a
    representable state; *forgetting to say anything* stops being one. Same for
    `RunManagerDeps.confinementPosture`.
  - This is exactly the discipline ARCH-182 already argued for `RunSpec.origin` («required on
    purpose: the compiler is what stops a fifth admission site being added without answering the
    remoteness question»). v37 applied it to one field and to nothing else. **Generalise it: every
    security-relevant value crossing a composition-root boundary is a required key. The compiler is
    the hop-lock; tests are the backstop.**
  - *Cost, measured:* 7 test files touch `confinementPosture`; the ToolDeps literals are already
    mostly built through helpers. A one-time, compiler-guided edit. This repo's memory names this
    bug class four times now (v11 `updateFlagPath`, v15 auth, v37 A5, v37 B1) and hand-written hop
    tests have caught it once. A required key catches it every time, for free, forever.

### 3.2 The one test that must exist regardless

The deepest testability finding here is not "a case is missing"; it is that **the entire suite
exercises `admissionRefusal()` only at values where it is vacuous.** `val-253` boots a real
`createServer` with `confinementPosture:'confined'` — the one value the predicate never gates on — so
it stays green with both forwards deleted. Fix the *shape*, not the count:

- one integration case that boots `createServer({confinementPosture:'unconfined'})` and asserts an
  `origin:'remote'` submission is refused with `CONFINEMENT_UNAVAILABLE`, and a local one is
  admitted — i.e. a **non-vacuous** boot;
- the posture-carrying boot tests parameterised over both postures (`describe.each`), so no future
  suite can again cover only the non-gating value;
- the two `createdRemote` stamp cases the review names, through `callTool(...)`, reading the row
  back through the store (the webhook half needs B3's field, §4).

And **INV-V37-5 must name its consumers explicitly** — `RunManager`, `ToolDeps`, both
`buildToolDeps` call sites, both `createdRemote` stamps — or it is an invariant nobody can check.
An invariant that does not enumerate its surface cannot be audited, which is how IMPL-381 came to
claim the class was closed with three of five forwards unlocked.

---

## 4. B3 — a decision input that cannot be read back is not auditable

`ScheduleStatus` projects `createdRemote` (`scheduler.ts:151`); `WebhookView`
(`webhook-registry.ts:50-64`) and `list()` (`:192-202`) do not. Same fact, same decision, same
iteration, one surface. **Mirror the field.** One line, no new concept, and it:

- makes ADR-086's promised operator sweep performable for webhooks at all (today it is not);
- unblocks B1's webhook stamp assertion without reaching into SQLite;
- restores the symmetry the two trigger stores otherwise maintain deliberately (`RefusalReason`,
  `refusalCount`, `markRefused`/`_recordRefusal` are all already shared vocabulary).

**Position, taken in advance, on the tri-state I expect to resurface:** quality-dimensions r2 §3
previously proposed `NULL` = unreviewed legacy plus an `originConfirmed` surface, and ARCH-182
declined it on the Karpathy tie-break. **I supported that decline and I still do — with one
qualification I did not make then.** The decline is only defensible if §1's coverage-zero fact is
written down somewhere an operator will read. A tri-state is a schema-level way of saying "we never
looked at these rows"; if we decline the schema, the sentence must exist in `DEPLOY.md` instead.
Declining *both* is how a known-empty control ships looking full.

---

## 5. Scalability / performance lens — the honest version

I will not manufacture a horizontal-scaling story. This is a single-process Node engine on SQLite;
there is no clustering requirement in `01-requirements.md` and inventing one would violate the
tie-break. Three real statements, and no more:

- **Admission-path cost is nil.** `admissionRefusal()` is two scalar comparisons on a path that
  already does `INSERT INTO runs`. Hoisting it above `RUN_ADMISSION_LIMIT` is correct and *saves*
  work — a permanently-refusable submission no longer consumes a slot.
- **Failure counting is the only consistency question in scope, and it is currently inconsistent
  across routes, not across processes.** Within one process, `UPDATE … refusalCount = refusalCount
  + 1` in a single `better-sqlite3` statement is atomic; there is no race to design against. The
  defect is that *two of four routes count refusals and two do not* (§2): the webhook confinement
  refusal records nothing, and the ticker's permanent refusal is recorded as a dispatch *failure*.
  Consistency here means one vocabulary, one writer per outcome class — which is exactly what the
  `RefusalReason` addition buys.
- **The one unbounded behaviour in the iteration is B7's loop**, and it is a *duration* problem, not
  a load problem: a permanently-refused `cron` schedule re-refuses once per period forever, with a
  `console.error` each time and no counter. On an hourly health-check schedule that is a log line an
  hour, indefinitely, with the durable signal of the refusal absent. Naming it as "performance" would
  be overstating it; naming it as unbounded-by-construction is exact.

---

## 6. QD-MED, B5, B6 — text, and the one rule behind them

- **QD-MED** (`authoring-guide.ts:363-369`): `errors.ts:91` points `CONFINEMENT_UNAVAILABLE` at
  `workflow_authoring_guide`, and the guide paragraph still names only `run_start`/`run_resume`. The
  remote author debugging a refused webhook is sent, by the engine's own pointer, to a paragraph
  that does not describe their case. Architectural form of the fix: the **admission-route list is
  data in `errors.ts` and the guide renders it**, so the code that adds a fifth route updates the
  prose it is obliged to update. If that is judged too much for a send-back round, the minimum is
  the text edit plus an ARCH note that the duplication exists.
- **B5**: `main.ts:182-183` claims a `'confined'` gateway default that
  `claude-agent-sdk-client.ts:748` contradicts (it fails open to `'unconfined'`, deliberately, per
  ARCH-176's Gate-6 amendment) — plus round 1's two unrepaired A7 sites. **The rule, and it is
  REQ-218's own rule:** a comment asserting a fact about code either cites the line that makes it
  true or is deleted. REQ-218 exists because «Bash here is confined to that workspace» and «Bash is
  still best-effort» sat in one file and readers believed the first. This repair wrote a third
  instance of that pattern while closing the requirement about it; that is the finding, and it is
  worth one invariant line rather than three silent edits.
- **B6**: ARCH-177 says `workRootDefault: string`, the shipped type is `workRootDefault?: string`.
  Amend the ledger to the shipped type — IMPL-380's engineering call was right (≈80 call sites).
  **But note the tension with §3.1 and resolve it out loud rather than by accident:** I am arguing
  *required keys* for security-relevant forwards and *accepting an optional one* here. The line is
  not arbitrary — `workRootDefault` is a fallback whose absent case is well-defined and harmless;
  `isRemoteSubmission`'s absent case silently reads a remote caller as local. **Optionality is
  acceptable exactly when the default is safe; it is never acceptable when the default is the
  permissive answer.** That sentence belongs in INV-V37-5.

---

## Risks

- **R1 — The corrected premise may not change the owner's answer, and the round must not stall on
  it.** Every repair in §2–§6 is independent of B2's outcome. Sequence them first; carry B2 as an
  open `owner_decision` with the corrected numbers. What is *not* acceptable is shipping ARCH-182's
  current justifying sentence unchanged while knowing it is false.
- **R2 — Option (ii)'s blackout is real and lands on a live host.** If the owner picks it, it needs
  a stated operator procedure (re-register locally, or delete+recreate triggers) in `DEPLOY.md`
  *before* the upgrade, not after. My own r2 argued for (ii) and the owner overrode it with a
  concrete cost; I am not re-arguing it, I am re-costing the alternative.
- **R3 — the door must not be deleted before `resume()` is covered, and deleting it moves
  REQ-218's real-tier evidence.** Two distinct hazards, one sequence. (a) `resume()` is currently
  ungated by the predicate (§3.1), so a deletion done first opens a real hole on an `unconfined`
  host. (b) VAL-253 proves the door; VAL-256 proves the predicate on two of four routes — deleting
  the door forces validation to re-point, i.e. a send-back into a gate that has already run.
  **Mitigation and recommended sequence: this round, keep the door, extend the predicate to
  `resume()`, add the never-diverge invariant and one shared test; v38, delete the door and re-point
  the evidence.** I state the simplification ruling and its safe sequencing separately so the round
  can take one without the other — and I would rather be overruled on the deletion than have it
  taken out of order.
- **R4 — Required-key changes touch tests broadly.** Compiler-guided, mechanical, one-time, and the
  failure mode is a red build, never a silent hole. Small risk, correctly shaped.
- **R5 — Adding `'CONFINEMENT_UNAVAILABLE'` to `RefusalReason` widens a persisted vocabulary.**
  Both stores write it into `lastRefusalReason`; any reader that switches exhaustively on the four
  members (dashboard, `schedule_list`, `webhook_list`) must handle the fifth. This is a real, small
  ripple and it should be grep-verified in the same change, not discovered at Gate 7.5.
- **R6 — Option (iv) is the one I rank second and have the least evidence for.** Whether the SDK's
  `disallowedTools` reliably removes `Bash` from an already-`allowedTools`-shadowed session is
  precisely the mechanism that already surprised this iteration once
  (`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`, 70 occurrences). **It must be spiked before it is ruled, not
  ruled and then spiked.** I raise it as an option with that condition attached, not as a
  recommendation to implement blind.

---

## Internal conflicts between my own three lenses (surfaced deliberately)

- **Security vs. operability (the round's central conflict).** Security says attachment/authorship is
  the event that matters, so option (ii); operability says (ii) stops every workflow on the one
  production host. I do **not** resolve this with a new mechanism (§1.3's declined allowlist) —
  that is where a simplicity-first discipline and a security-first instinct genuinely collide, and
  simplicity wins because the mechanism buys security for the *config-writing operator*, who is
  already the trusted party, at the price of three moving parts and a ritual. The resolution is a
  decision, not a design.
- **Security vs. testability, resolved in testability's favour — and it changes the security
  answer.** My instinct on B1 was "add the missing assertions". The stronger move is structural:
  delete a door and make two keys required, so the assertion becomes unnecessary. This is the one
  place where the testability lens produced the *better security* outcome, because a compile error
  is a stronger guarantee than a test somebody must remember to write.
- **Scalability vs. security on B7's routing — I checked this instead of asserting it, and the
  conflict dissolved.** My draft claimed `markRefused` and `markFailed` advance differently, and
  that routing a permanent refusal to `markRefused` might turn an hourly loop into a 500ms hot
  loop. **Read both (`scheduler.ts:501-522` and `markFailed`), and neither advances anything**:
  since v29/REQ-152 the advance belongs to `claimFiring()` (`:465-472`, which recomputes `nextFire`
  before dispatch), and both writers are pure recorders — `once` is disabled identically by both,
  `cron` is left to the claim. The *only* difference is which trio is written: `lastError`
  («dispatch failed») versus `refusalCount`/`lastRefusedAt`/`lastRefusalReason` («policy refused»).
  That is precisely the distinction B7 is about, so the routing change is semantically right and
  carries **no** scheduling-behaviour risk. The residual work B7 still needs is a decision about
  whether a repeatedly-refused `cron` should eventually be auto-disabled — which I do **not**
  propose (speculative; the refusal counter now makes it visible, and visibility is what was
  missing).
- **Simplicity vs. observability on the tri-state (§4).** I decline the schema and then demand the
  sentence. That is not free — prose rots and a column does not. I take it anyway, because a
  one-time upgrade cohort does not justify a three-valued column plus two tool surfaces, and I flag
  that this is the decline's actual cost so the next reviewer can hold me to it.

---

## Expected disagreements with the other lens group (quality-dimensions)

1. **They will want the tri-state / `originConfirmed` surface back for B3.** Expected, and I
   half-concede in advance (§4): mirror `createdRemote` on `WebhookView`, no tri-state, but the
   coverage-zero sentence must land in `DEPLOY.md` or I withdraw the decline.
2. **They will treat B1 as an observability finding** («an invariant reported closed with two of
   three consumers unlocked») and ask for more *checks*: a standing wiring test, perhaps an
   automated importer/forward scanner. I argue for *fewer things to check* — the predicate extended
   to `resume()`, the forwards made required keys, the duplicate door collapsed once it is safe to —
   plus exactly one non-vacuous boot test. Expect a genuine disagreement about
   whether the compiler counts as observability. My position: a type error is the most observable
   possible failure, because it fires before the code exists.
3. **They will likely defend keeping B7 out of scope** on send-back discipline. I argue it is the
   same branch as B4 and costs one word in a type union; deferring it ships a known unbounded loop.
4. **They may prefer a generated/derived explanation surface for QD-MED** (their own finding) and I
   agree in principle, but I will resist if it grows into a doc-generation mechanism; data in
   `errors.ts` rendered by the existing guide is the ceiling.
5. **Option (iv) will meet a consumability objection** — «removing `Bash` breaks every existing
   workflow». My answer: it breaks them *loudly, with a code and a reason*, which is strictly better
   than the current state where the protection is absent and the comment says it is present. But see
   R6: it needs a spike before anyone rules on it.
6. **Replaceability, where I expect to be the more aggressive lens:** A6/A8 (`DENY_READ_MODE`'s
   `'workroot'` arm, `MASK_PROVIDER_ENV`'s `envVars` arm) are compiled-in and unreachable by any
   shipped config — the same shape REQ-219 just deleted two modules for. They are carried as
   accepted LOW debt. I accept the carry *this round* (they are bridges with a named flip condition,
   documented in `bash-confinement.ts`'s own header), but I want the flip condition written as an
   event-shaped revisit trigger on the ARCH row, not as a comment — otherwise v38 inherits exactly
   the REQ-219 situation with a nicer explanation.

---

## What I would put in the ledger (skeleton, for whoever synthesises)

- **ADR-086 amendment (not a new ADR — the same decision, corrected premise):** state that
  `createdRemote` records *row creation*, not attachment nor authorship; record coverage-zero on the
  pre-v37 cohort as a consequence; re-open the `owner_decision` with §1.3's four options and their
  costs; keep the answered 2026-09-23 ruling in place as history, clearly marked as given against
  the superseded premise.
- **ARCH-182 amendment:** justifying sentence corrected (creation, not attachment); **the «ONE
  predicate every run admission passes» claim either becomes true by extending it to
  `RunManager.resume()` with a required `origin`, or is reworded to name the route it does not
  cover** — it may not stand as written; contract table's `markFailed` cell replaced by the
  retryable/permanent branch; the four-route refusal contract (`code` + static text + durable
  record) stated once, here, rather than four times in four consumers.
- **New ARCH row (small):** `classifyStartRefusal()` — one pure function beside `admissionRefusal()`,
  the single mapper from a `start()` throw to `{code, retryable, httpStatus}`, consumed by all four
  admission sites. Named so a fifth site cannot invent a fifth mapping.
- **INV-V37-5 amendment:** enumerate the consumers; add «optionality is acceptable exactly when the
  default is the *safe* answer, never when it is the permissive one»; add the two-doors-never-diverge
  clause if the `call-tool` door is kept.
- **Tech-debt row with an event-shaped trigger:** collapse the duplicate door (v38, trigger = the
  first re-point of REQ-218's real-tier evidence); A6/A8's flip condition (trigger = a positive
  spike S7/S8 or the first `confined` host).

*Adversarial architecture group — v37 Gate 8 round-2 send-back, debate round 1, 2026-09-23.*

---
---

# ADDENDUM 3 — v37 Gate 8 **round-3** send-back, debate round 1 (independent)

*Appended 2026-09-24. The three sections above (original r1, ADDENDUM, ADDENDUM 2) are unchanged and
still stand — this is a delta over them, not a re-derivation.*

**Altitude:** unchanged from §0 of the original r1 and re-affirmed. This is **both** a system and an
agent-hosting system, but this slice sits at the **agent altitude**: the asset being protected is
*what a hosted agent's shell may touch on an unconfined host*, not a token. I again produce **no**
JWT / brute-force / timing findings — there is no new credential surface in `3e3c331`/`2cf5f32`.
The system-altitude halves that *do* apply are **attack surface** and **authz correctness**, and
§3.2 below uses them.

**Scope.** `send_back=[architecture, impl, validation]`; this document takes only the
**architecture-owned** half of the reviewer's consolidated round-3 list: **C1**, the
`02-architecture.md` half of **C4**, **C5** (cost + relay — I do not rule), **C3**, **QD-3**, **C8**,
and **C7 re-severitied**. C2's *test* is the tests/impl gate's; C2's *invariant sentence* is mine.
C6 (`DEPLOY.md`) is validation's, but §2.4 supplies the replacement text because under my primary
recommendation the current text becomes correct again rather than needing a rewrite.

---

## Summary

The round-3 findings are not seven defects. They are **one design defect with seven faces**:
`createdRemote` is a single bit that, since `3e3c331`, carries **two different facts** that have
different lifetimes and different correct behaviours.

- **Fact A — the firing capability.** Who created the trigger ROW, and therefore who holds the
  webhook secret / controls the cron expression / supplies `args.event`. This fact is **immutable**
  and must never be laundered. `2cf5f32`'s monotonicity is *right* about this fact.
- **Fact B — the script provenance.** Whether the code that will run on this firing arrived from a
  remote registration. This fact is **per-attachment** and legitimately changes when the workflow is
  re-registered or re-published. Monotonicity is *wrong* about this fact, and that wrongness is C5.

Conflating them into one column is what makes C1 unfixable-by-editing (the doc cannot describe one
bit that is both immutable and re-stamped), what makes C6 backwards (the operator manual is correct
about Fact A and wrong about Fact B), what makes C8 a naming problem that cannot be fixed by
renaming, what leaves C3's create-time-bound cohort uncovered (`claim()` never runs on it, so Fact B
is unreachable there), and what makes C5 irreversible (you cannot clear the mutable fact without
also clearing the immutable one).

**My primary recommendation (P1): stop re-stamping, and store Fact B where it already belongs —
one `workflow_versions.registeredRemote` column, read at the two fire sites from a row they already
load.** Refusal becomes `origin = row.createdRemote || released.registeredRemote ? 'remote' :
'local'`. This preserves the owner's *intent* in the second ADR-086 ruling ("a remote re-registration
must taint the trigger it attaches to") while (a) extending coverage to the C3 cohort the shipped
mechanism structurally cannot reach, (b) restoring a recovery path that is a routine local
re-publish rather than delete-and-recreate, (c) making ARCH-182's *original* sentence true again,
and (d) removing code rather than adding it (the two `UPDATE`s, the monotonic rule, the
compensation question, and the bivariant third port parameter all evaporate).

**I do not have the authority to reverse the owner's 2026-09-24 ruling and I am not asking the
architect to.** I am asking for the same move this ledger made at round 2's B2 and round 1's A2:
**relay the corrected premise with costed options.** §3.3 supplies them. If the owner keeps the
shipped mechanism, §3.4 is the fallback (P2) and §3.5 is the floor (P3) — all three are costed, and
all three carry the same non-negotiables in §4/§5.

---

## Key points (condensed)

1. **C1 is not a stale sentence; it is the symptom.** `02-architecture.md:5683/5691/5413/5704-5710`
   say `createdRemote` is "written once by the `INSERT` and never re-stamped by any later attachment
   event (`claim()`, `workflow_register`, `workflow_publish`)". `src/scheduler.ts:548` and
   `src/webhook-registry.ts:242` re-stamp it from `claim()`, reached from
   `src/mcp-facade.ts:392` ← `:358` ← `src/call-tool.ts:212`. I verified all six sites this round.
   The replacement sentence is in §2.1 — but note that under P1 the *original* sentence is restored
   verbatim instead, which is the cheapest possible repair of the contradiction.
2. **C5 has an attacker-shaped face that the reviewer's "routine re-publish" framing understates,
   and it is the reason the un-stamp question is mandatory rather than nice-to-have.** See §3.2.
   It is still C5, not a new HIGH — I checked the authz gate before claiming otherwise.
3. **C3 is not a bounded legacy exception under P1 — it is *covered*.** The shipped mechanism keys
   on `claim()`, which by construction never runs on a create-time-bound row
   (`src/call-tool.ts:180-184` closed the tool door for new rows; the store's own
   `create({workflow})` is unchanged for old ones). The version-row key reaches every firing
   regardless of how the trigger got bound. This is the single strongest technical argument for P1
   and it is a **security coverage** argument, not a tidiness one.
4. **C7 should be MED, not LOW.** The re-stamp lands *before* the registration is known to succeed
   and is never compensated (`src/mcp-facade.ts:395`/`:402` release the claim, nothing un-stamps).
   Under a monotonic rule, "safe direction" means "permanent". See §5.
5. **QD-3 cannot be fixed by the compiler and the architecture row must say so.** Making the third
   parameter required does not help: TypeScript method-parameter bivariance means a 2-argument
   implementation still satisfies a 3-argument port. The only mechanism that holds is a
   **conformance test parametrized over both stores**, and that belongs in an INV so the tests gate
   owns it rather than each store's author remembering.
6. **Scalability: nothing new to report, and one thing to *watch* rather than optimise.** See §6.
   I decline to propose an index or a cache.

---

## 1. What I verified myself this round (not taken from the review, not from either panel)

| Claim | How | Result |
|---|---|---|
| The re-stamp chain exists end to end | read `call-tool.ts:212`, `mcp-facade.ts:69,358,392`, `scheduler.ts:537-550`, `webhook-registry.ts:230-249` | Confirmed; six hops, two of them defaulting to `false` |
| The rule is monotonic, local→remote only | `scheduler.ts:548`, `webhook-registry.ts:242` — `if (createdRemote !== true) return;` | Confirmed |
| No un-stamp path exists in `src/` | `grep -rn "createdRemote" src/` — every writer enumerated | Confirmed: two `INSERT`s and two `UPDATE … SET createdRemote = 1`. Nothing sets it to 0 after creation. `release()` (`scheduler.ts:564`, `webhook-registry.ts:256`) clears the binding columns only |
| No test drives the `callTool` → facade → store forward | `grep -rln isRemoteSubmission tests/` → **one** file, `call-tool-confinement-door.test.ts` (the `run_start`/`run_resume` door, not `workflow_register`); `grep -rn "\.claim(" tests/` → every pre-existing call site is 2-argument | Confirmed. C2 stands |
| No test covers the webhook twin's upgrade direction | UT-335 imports `SqliteSchedulerPort` only | Confirmed. QD-3 stands |
| The ownership gate bounds who can taint what | `mcp-facade.ts:377-386` — `isAdmin \|\| owner === actorId`, ownerless rows admin-only | Confirmed, and it is the reason §3.2 is C5's face and not a separate finding |
| `auth-disabled` makes every caller admin, including a non-loopback one | `mcp-facade.ts:377` (`kind === 'auth-disabled'` ⇒ `isAdmin`); `server.ts:1597` hands a non-loopback caller `{kind:'auth-disabled'}` when `authCfg` is absent; **no bind guard is wired** (`find src -name "*bind*"` → nothing; `grep -rn "bindGuard\|assertBind" src/` → nothing) | Confirmed — this is the pre-existing unwired-bind-guard debt, and §3.2 is what the new durable write makes of it |
| The reviewer's refutation of QD-Violation-5 is correct | read `workflow-catalog.ts:355-368` (`declaredTriggers` unions `triggers` over **every** version row of the name), `mcp-facade.ts:373` (`a.triggers ?? []` — so a `triggers`-less v2 stores `[]`, not `undefined`), `server.ts:1003` and `webhook-registry.ts:336` (both guards) | **Confirmed. I independently reach the same conclusion.** And §4.3 says what to do about the fact that this refutation is currently verified only by two people reading code |
| The re-stamp is not compensated on a failed registration | `mcp-facade.ts:395`, `:402` call `release()` only | Confirmed — §5 |

---

## 2. C1 + the architecture half of C4 — the exact replacement text

### 2.1 If the shipped mechanism stands (P2/P3)

`02-architecture.md:5413` (persistence/API table row for `webhooks.createdRemote` /
`schedules.createdRemote`) — replace *"Written once at `webhook_create`/`schedule_create` from
`ToolDeps.isRemoteSubmission`; read at the three trigger dispatch sites. Never updated afterwards —
provenance is a fact about creation."* with:

> Initialised at `webhook_create`/`schedule_create` from `ToolDeps.isRemoteSubmission`, then
> **monotonically re-stamped by `claim()`** as the OR of its existing value and the remoteness of
> the registration claiming the trigger (`'claimed'` and `'held'` both stamp; `'ALREADY_CLAIMED'`
> never does). **The value is therefore a taint bit, not a creation record**: it is monotone
> non-decreasing for the lifetime of the row, there is no path in `src/` that clears it, and the
> only operator remedy is deleting and recreating the trigger — which rotates a webhook's id and
> secret. Read at the three trigger dispatch sites (`server.ts:1027`, `webhook-registry.ts:354`,
> `scheduler.ts:388`).

`:5683` (the ARCH-182 header) and `:5691` (the `deps`/prose restatement) carry the same
"written once by the `INSERT` and never re-stamped by any later attachment event (`claim()`,
`workflow_register`, `workflow_publish`)" clause — the parenthesis is now precisely inverted and must
go. `:5704-5710` (amendment (1)) is the round-2 premise correction; it must gain a
`[SUPERSEDED 2026-09-24 by amendment (8)]` marker rather than being edited in place, because the
round-2 ruling was *taken on it* and a future reader needs to see what was true when.

**New amendment (8)** states the invariant as an invariant, because the whole of C1/C6/C8 is that
this rule lives in a code comment:

> **INV-V37-6 — trigger provenance is monotone.** For any trigger row, `createdRemote` never
> transitions `1 → 0`. Every writer must preserve this; the two `stamp()` closures are the only
> writers after creation, and a conformance test (§4.2) pins **both stores in both directions**,
> because the port's optional third parameter is bivariance-exempt and the compiler does not police
> this seam.

### 2.2 The ADR-086 entry (`:5899-5920`, `:6146`)

Three states of one decision are interleaved in a single entry with no supersession marker: the
architect's round-2 corrected-premise text (phrased as still pending), the sentence saying the
decision "goes back to `pending`", and the owner's `answered 2026-09-23(第二次)` ruling two
paragraphs later. **`04-design.md`'s DES-263 already shows the shape to copy** — the superseded
sentence is kept struck through with an explicit `[SUPERSEDED]` tag and the replacement follows it.
Apply the same treatment here: one CURRENT ruling at the top of the entry, everything else marked
and dated. This is also the entry that must carry §3's costed options, because C5 is functionally an
uncosted owner decision and this ledger's own pattern (round 1's A2, round 2's B2) is to put the
corrected premise where the owner reads it.

### 2.3 The architecture half of C4

Not my call to write IMPL-386/UT-335 rows (that is the impl gate), but **the architecture row must
name them**, because ARCH-182's `traces:` chain is what makes the mechanism discoverable at all. One
line at the end of amendment (8): *"Shipped by `3e3c331` + `2cf5f32`; IMPL row and UT-335 test-spec
row are owed by the impl/tests gates of this same send-back."* If the architect writes the amendment
without that sentence, the next `trace --check` still shows 2113/77 and the drift stays invisible —
which is exactly how this round happened.

### 2.4 C6 (validation's, but the text depends on the ruling)

`DEPLOY.md:883` and `:908` are **correct about Fact A and wrong about Fact B**. Under P1 they become
correct as written and need only one added sentence ("a trigger refused `CONFINEMENT_UNAVAILABLE`
because its *released version* was registered remotely is recovered by re-publishing that workflow
from a local session; a trigger refused because the *row itself* was created remotely must be
deleted and recreated"). Under P2/P3 the whole of `:908` must be rewritten, because delete-and-
recreate stops being the only remedy (P2) or becomes the only remedy for a much larger population
than the text describes (P3). **This is the strongest operational argument for P1: it is the option
where the manual that already shipped is the manual that is true.**

---

## 3. C5 — the availability cost, its attacker-shaped face, and the four options

### 3.1 The arithmetic, restated so it is in the architecture document and not only in a review

This host: every workflow on the production catalog is remotely registered (ADR-086's own ruling
text), submissions genuinely arrive non-loopback (VAL-256 measured it on this host), and the host
measures `unconfined` (VAL-256 again). Therefore **every** trigger on this host is one ordinary
remote `workflow_register({triggers:[…existing ids…]})` away from `createdRemote = 1`, after which
**every firing of it is refused permanently** with no path back except deleting the row. Deleting a
webhook row rotates its id and secret, so recovery is not local: every external caller pointed at
that hook must be reconfigured.

The owner declined a fleet-wide blackout twice (option (B), then option (ii-narrow)) specifically to
avoid this outcome. The shipped mechanism delivers the same outcome **lazily, per workflow, at
re-registration time** — which is strictly worse to attribute, because the failure appears hours or
days after the action that caused it, on a trigger nobody touched.

### 3.2 The attacker-shaped face — why an un-stamp path is mandatory, not a convenience

`3e3c331` introduced the first **durable, irreversible, remotely-reachable write** in this
subsystem. Who can reach it, verified at `mcp-facade.ts:377-386`:

- **A non-admin remote principal can only taint triggers it created**, which already read
  `createdRemote = 1`. **No new exposure.** (I want this on the record because it is the reflex
  finding and it is wrong.)
- **An admin principal acting remotely can taint any trigger id in the catalog**, including ones an
  operator created locally, by naming them in a single `workflow_register` — and an admin's routine
  remote re-publish *is* §3.1's scenario. Same act, different intent.
- **On an `auth-disabled` deployment every caller is `isAdmin`** (`mcp-facade.ts:377`), including a
  non-loopback one (`server.ts:1597`), and **no bind guard is wired** to prevent that configuration.
  On such a host, an unauthenticated remote caller can permanently brick every trigger in the
  catalog with one call. Note the shape carefully: this caller **cannot** get code execution —
  ARCH-181's door and ARCH-182's predicate both refuse it, which is the control working. What it
  **can** do is destroy availability irreversibly. **A security control whose failure mode is a
  permanent, unauthenticated, remote denial of service on the asset it protects has traded the wrong
  way**, and it did not have that property before `3e3c331`.

This does **not** promote C5 to HIGH. `auth-disabled` + non-loopback bind is an already-named,
already-tracked posture (the unwired bind-guard debt), and an admin is trusted by construction. It
*does* settle the question §3.3 asks: an irreversible write reachable by a remote caller needs a
reverse path, and "delete and recreate" is not one when deleting rotates the credential.

### 3.3 The four options, costed. The architect relays; the owner rules.

**(P1) Move Fact B to the version row; restore `createdRemote` to immutable. — my recommendation.**
`workflow_versions.registeredRemote INTEGER NOT NULL DEFAULT 0`, written by `insertVersion` from the
`isRemoteSubmission` that `mcp-facade.ts:358` *already receives* (that hop exists as of `3e3c331`, so
this is not new plumbing). The two fire sites compute
`origin = (row.createdRemote === 1 || released.registeredRemote === 1) ? 'remote' : 'local'` from a
`released` row **they already load** for the `NOT_IN_RELEASE` guard (`server.ts:1003`,
`webhook-registry.ts:336`). `claim()` reverts to two arguments; the port's third parameter, the two
`UPDATE`s, the monotonic rule, and the compensation question all delete.
- *Security:* **strictly more coverage than shipped.** Fact A stays immutable, so a remotely-created
  webhook can never be laundered by a local registration — `2cf5f32`'s protection (ii) is preserved
  by construction rather than by a rule. Fact B now reaches the **create-time-bound cohort** (C3),
  which `claim()` structurally cannot, because the fire path always resolves a released version
  whether or not the trigger ever entered a `triggers[]`.
- *Availability:* recovery is a **local re-publish of the workflow** — no id churn, no secret
  rotation, no external reconfiguration. The remedy is an act the operator already performs.
- *Cost:* one column, one idempotent `ALTER` in the idiom already at `workflow-catalog.ts:272-277`,
  one extra field on `insertVersion`, one extra field read at two sites. **Zero new queries.**
- *The obvious attack on P1, stated by me because it survives:* a principal who can `workflow_publish`
  can move Fact B **both** ways by choosing which version is released. Publishing an older,
  locally-registered version clears the taint. That is **correct, not a hole**: the script that will
  run is then the locally-authored one, which is exactly ADR-083's ANSWERED position
  (「本機發起的 run 仍不受限制」), and the firing capability is still governed by the immutable Fact A.
- *The rejection ADR-086 already recorded does not apply.* ADR-086 declined the version-row design
  (adversarial r2 §1) because it would refuse a **local `run_start`** of a remote-authored script.
  P1 reads the version bit **only at the two trigger fire sites** and leaves `run_start` entirely to
  ARCH-181's live-peer door. The stated objection is not reachable from this proposal, and the
  architect must say so explicitly or the ADR will look self-contradicting.
- *Honest cost:* it changes the mechanism of a ruling the owner made two days ago and that has
  already been implemented and then repaired. That churn is real and the owner may reasonably
  decline it.

**(P2) Keep the re-stamp; split the column. — the fallback if the owner keeps `claim()`.**
Add `attachedRemote INTEGER NOT NULL DEFAULT 0` beside the immutable `createdRemote`; `claim()`
stamps `attachedRemote` (monotone within one attachment); `release()` clears it; the predicate is the
OR of the two. Laundering is impossible because `createdRemote` is untouched, and C5's irreversibility
shrinks to the half that genuinely *should* be irreversible.
- *Cost:* one column per table (two total), one field in each status projection, `release()` gains a
  clause. Keeps `claim()`'s widened port and therefore keeps QD-3.
- *Does not fix C3* — `claim()` still never runs on a create-time-bound row.

**(P3) Keep exactly what shipped; pay in documentation. — the floor.**
ARCH-182 amendment (8) per §2.1, `DEPLOY.md:908` rewritten, the two missing tests (§4), and an
explicit accepted-cost line: *"a trigger tainted remote is refused forever; the remedy is delete and
recreate, which rotates a webhook's id and secret."*
- *Cost:* zero code beyond tests. **Does not solve C5** — it only makes the cost visible.

**(P4) An operator un-taint tool.** A loopback-only, admin-only `trigger_reset_provenance(id)`.
- **I recommend against it on the Karpathy tie-break.** It is a new MCP tool, a new authz surface,
  and a new audit obligation, bought to undo a write that P1 removes the need for. If the owner
  keeps P3, P4 becomes the least-bad mitigation — but P1 dominates it.

**The sentence the owner needs before reading any of the above, and the one my Risk 2 muddles.**
**None of P1–P4 keeps this host's catalog running past its next remote re-publish.** Every option
refuses those triggers, because refusing them is precisely what the owner's ruling asks for on a host
that measures `unconfined` — the control is working, not failing. The only option that keeps the
catalog running is **confining the host**, which ADR-086's own ranking already puts first and which
is out of v37 scope. **What the owner is choosing between in P1–P4 is the *recovery cost* of a
refusal that every option delivers**, not whether the refusal happens: P1 costs one local re-publish
per workflow, P2 costs one `workflow_deregister` + re-register, P3 costs deleting and recreating
every trigger and reconfiguring every external caller pointed at a rotated webhook secret, P4 costs a
new tool. And note the wrinkle that makes P1's recovery less free than it sounds on *this* host: the
owner's stated workflow is remote registration only, so "re-publish locally" is an act they do not
normally perform and may not have a session for. That is an honest cost of P1, it belongs in the
relay, and it is the reason §3.5's floor (P3, documented) is not an absurd choice.

**Karpathy tie-break across P1–P4:** the rule is *minimum architecture that solves the problem*, and
"solves" is doing the work. P3 is the smallest and does not solve C5. P4 adds surface. P2 solves C5
but not C3 and keeps the bivariant seam. **P1 is the smallest option that closes C5 *and* C3 *and*
dissolves C1/C6/C8 instead of patching them — and it is net-negative in code.** That is the answer
the tie-break gives, and it is the only one of the four where the sentence already in
`02-architecture.md:5413` becomes true again by *reverting* code rather than by rewriting the
document to match a mechanism nobody has re-reviewed.

### 3.4 What architecture can do this round without the owner

Regardless of the ruling: write amendment (8) (§2.1), mark ADR-086's three interleaved states
(§2.2), record §3.1's arithmetic and §3.2's failure shape in the ADR, name the IMPL/UT obligation
(§2.3), and state the §4 invariants. **None of that pre-empts the ruling**, and all of it is owed
even if the owner picks P3 unchanged.

---

## 4. C2 + QD-3 — the seam the compiler cannot hold, and the two tests that can

### 4.1 Why "make the parameter required" is not the fix

`mcp-facade.ts:69` declares `claim(id, workflow, createdRemote?)`. The commit message for `3e3c331`
already names the limit correctly and I confirm it: **TypeScript's method-parameter bivariance lets a
2-argument implementation satisfy a 3-argument port silently.** Making the parameter *required* on
the port changes nothing — a narrower implementation still type-checks. Deleting the optionality at
the *caller* (`mcp-facade.ts:392` always passes a boolean) is already true today and still did not
stop C2, because the defect is that nothing *exercises* the forward, not that something could omit it.

**Architectural consequence, and it generalises past this field:** this repo's named `composeConfig`
wiring bug class (v11 `updateFlagPath`, v15 auth, v37 A5, v37 B1, now C2) has never once been caught
by a type. It has been caught five times out of five by a test that drives the **real entry point**.
The architecture row should stop offering "required parameter" as a mitigation for this class and say
so once: *optionality is acceptable exactly when the default is the SAFE answer, never when it is the
permissive one; and no forward whose default is permissive is considered wired until a test drives it
from the tool surface.*

### 4.2 INV-V37-7 — the conformance test, stated as an invariant so the tests gate owns it

> Any type that implements `TriggerClaimStore` must pass one shared conformance suite, parametrized
> over **every** implementation (`SqliteSchedulerPort`, `WebhookRegistry`), asserting all three
> directions: remote claim taints (`local → remote`), local claim does **not** launder
> (`remote → remote`), and `ALREADY_CLAIMED` leaves the row untouched. A new implementation is
> wired only when it is added to that suite's parameter list.

Today UT-335 is three `it()` blocks against `SqliteSchedulerPort` alone; if `WebhookRegistry.claim()`'s
`stamp()` regressed to a no-op, **no test in this repo fails**. Parametrizing the existing file over
both stores is a mechanical change to a test that already exists — it is not new structure, it is the
same three cases run twice.

### 4.3 The one test the reviewer's own refutation now needs

The `NOT_IN_RELEASE` guard is what makes quality-dimensions' Violation 5 wrong, and it is therefore
**load-bearing security logic whose correctness is currently attested only by two people reading
`workflow-catalog.ts:355-368` and `mcp-facade.ts:373`**. Pin it: register `v1` with
`triggers:['T']`, register `v2` **without** `triggers`, publish `v2`, fire `T`, assert the firing is
refused `NOT_IN_RELEASE`. That is an architecture-level obligation — the guard's behaviour is what
ARCH-182's coverage statement now depends on — even though the test itself belongs to the tests gate.
If a future refactor makes `declaredTriggers()` scan only the released row, ADR-086's residual (1b)
silently re-opens and nothing goes red.

### 4.4 C2's hop lock (tests gate's to write; architecture's to require)

One case driving `callTool({isRemoteSubmission: true}, 'workflow_register', {triggers:[id]})` against
a **real** store and asserting the row flipped. Deleting the third argument at any of the three hops
(`call-tool.ts:212`, `mcp-facade.ts:358`, `:392`) must turn it red. Under P1 this test re-points to
`insertVersion`'s field instead; the obligation is identical either way, which is why it belongs in
the architecture row and not only in a test file.

---

## 5. C7 — I disagree with LOW, and the disagreement is about the word "safe"

The re-stamp lands inside the claim loop (`mcp-facade.ts:392`) **before** `insertVersion` is
attempted (`:400`). Both failure paths — a later trigger returning `ALREADY_CLAIMED` (`:395`) and
`insertVersion` throwing (`:402`) — call `release()`, and **`release()` does not un-stamp**
(`scheduler.ts:564`, `webhook-registry.ts:256`: binding columns only).

So a registration that **fails** still taints every trigger it got through first, permanently. The
reviewer classed this "safe direction by construction". Under a monotonic rule, *safe direction* and
*permanent* are the same sentence: this is the **cheapest** form of §3.2 — a caller does not even
need the registration to succeed. **MED, not LOW.**

Under **P1 it disappears entirely** — a failed `insertVersion` writes no version row, so there is no
Fact B to un-do. Under P2, `release()` clearing `attachedRemote` fixes it for free. Under P3 it needs
an explicit compensating un-stamp, which contradicts the monotonic invariant and is exactly the
tangle that says the one-bit design is underpowered.

The scheduler/webhook transaction asymmetry (`scheduler.ts:537-550` runs `SELECT` + two `UPDATE`s
outside a transaction; `webhook-registry.ts:231` wraps its twin) is **unmeasurable today** on one
synchronous `better-sqlite3` connection, and I do not propose adding a transaction. I propose
replacing the current code comment's reasoning: the right argument is not "one connection" (which a
future WAL/multi-process change falsifies) but **"the stamp is idempotent and order-independent
because it is a monotone OR"** — which stays true under any concurrency model. That is a one-sentence
change with a much longer shelf life.

---

## 6. Scalability / performance — the honest version

**Nothing to optimise, and one thing to watch.**

- The re-stamp adds at most one `UPDATE … WHERE id = ?` per claimed trigger per registration, on a
  path that already does several writes. Unmeasurable. Under P1 it is *removed*.
- The admission predicate is still two scalar comparisons with zero new queries.
- **The thing to watch:** `declaredTriggers()` (`workflow-catalog.ts:355-368`) runs on **every**
  cron firing (`server.ts:1003`) and **every** webhook delivery (`webhook-registry.ts:336`), and it
  `SELECT`s and `JSON.parse`s the `triggers` column of **every version row ever registered** for that
  name. It is a primary-key range scan of a table that grows by one row per `workflow_register`, on
  the per-firing path. **I explicitly do NOT propose an index or a cache** — the scan is bounded by
  a workflow's version count, and this is a developer-tooling engine, not a fleet. What changed this
  round is that this scan became **load-bearing for a security refusal** (it is the whole of the
  QD-Violation-5 refutation), so its *correctness* now matters more than its cost — which is §4.3,
  not a performance item. Recording it here so a future iteration that does hit a version-count
  problem knows that caching this predicate has a security consequence.
- Under P1, the fire path reads one more integer off a row it already has. Also unmeasurable.

---

## Risks of my own recommendation

1. **P1 reverses the mechanism of a ruling made two days ago.** If the owner reads this as the panel
   re-litigating a settled decision, the relay pattern breaks down. Mitigation: the architect must
   present it as *the second corrected premise on the same ADR* (the first correction was round 2's
   B2), with §3.3's costs intact, and must state plainly that the owner's **intent** — a remote
   re-registration taints — is preserved and extended, not reversed.
2. **P1's `DEFAULT 0` legacy cohort has the same zero-coverage-at-upgrade property as the shipped
   design's, and I want to be precise about the difference rather than hand-wave it.** Every
   pre-existing version row reads local until that workflow is next registered. The difference from
   the shipped design is about **which** re-registrations populate the bit, not about how routine
   they are: the shipped `claim()` stamp only fires when the registration **re-lists the trigger id**
   in `triggers[]`, so a workflow re-registered without re-listing its trigger stays uncovered
   indefinitely — and a create-time-bound trigger (C3) is never covered at all. P1's bit is written
   by **every** `insertVersion`, so coverage follows registration rather than re-listing. That is a
   real coverage advantage, it is not a claim that either upgrade is instant, and it must be stated
   in the ADR rather than discovered at the next Gate 8.
3. **The version row IS always loaded at both fire sites — checked, with one misleading character.**
   `webhook-registry.ts:336` reads `released?.triggers` with optional chaining while `server.ts:1003`
   reads `released.triggers` without it, which looks like evidence that the webhook path can reach
   `start()` with no released version. It cannot: `webhook-registry.ts:315-322` assigns `released`
   inside a `try` whose `catch` **returns** `CHANNEL_UNPUBLISHED` / `CLAIMED_WORKFLOW_MISSING`, and
   `:304` has already refused `UNCLAIMED`. The `?.` is vestigial defensiveness, not a reachable
   undefined — worth deleting on the same commit as C8's comment fixes so the next reader does not
   re-derive the alarm I just did. **The residual risk is forward-looking:** a future admission route
   that dispatches a firing without resolving a released version would lose Fact B silently. The
   architecture row must state the dependency as a rule: *any admission site that reads Fact B must
   resolve the released version first, and must refuse when it cannot* — the same "required field"
   discipline ARCH-182 already applies to `RunSpec.origin`.
   **One cost of P1 I did not see until I read the source of `resolve()`:** the field is read by
   adding one column to the `SELECT` already at `workflow-catalog.ts:835` (the exact row, already
   fetched) and one property to the `VersionEntry` it returns at `:837-852`. That is cheaper than I
   claimed — but `VersionEntry` is a **shared** type that `resolveDetail()` spreads into
   `workflow_describe`'s output, so the field becomes visible on a read surface unless deliberately
   stripped. Name that in the ADR and decide it once: I would **project it** (it is the same
   auditability `webhook_list.createdRemote` already got at round 2's B3) rather than strip it.
4. **Two columns (P2) or a second table's column (P1) is still more state than one bit.** A reader
   applying Karpathy naively will prefer the shipped design because it is one column. §3.3's
   tie-break argument has to be *in the document*, or this decision gets re-litigated in v38 by
   someone counting columns.
5. **All four options leave C3's pre-v24 create-time-bound rows partially exceptional** — P1 covers
   them for Fact B but they still have `createdRemote = 0` and no way to have been created remotely
   before v37, which is fine and should simply be *stated* rather than left as an unmarked hole.

---

## Internal conflicts between my own three lenses (surfaced deliberately, as the lens requires)

1. **Security vs. availability — the round's real conflict, and it is not resolvable inside one
   bit.** Security wants Fact A sticky forever (`2cf5f32` is right, and the reasoning in its commit
   message — that whoever created a webhook controls *when* it fires and what payload reaches the
   script — is the best piece of security thinking in this iteration). Availability wants Fact B
   resettable, because this host's entire catalog is one re-publish from permanent refusal. **These
   are not in conflict once the facts are separated; they are in irreconcilable conflict while they
   share a column.** That observation is the whole of my proposal. Where the two lenses genuinely
   still pull apart, even under P1, is §3.2's `auth-disabled` case: security says refuse, availability
   says an unauthenticated remote caller should not be able to cause a permanent refusal — and the
   real answer there is the **unwired bind guard**, which is not this iteration's scope and which I
   decline to pull in.
2. **Testability vs. surgical change — and testability wins cheaply again.** The structural fix for
   QD-3 (required parameters) is both expensive and *ineffective* (§4.1). The test fix is
   parametrizing a file that already exists. When the cheap option is also the only one that works,
   there is no trade to argue — but I note that my lens's reflex ("tighten the type") was wrong here
   for the second round running, and the thing that settled it was reading how bivariance actually
   behaves rather than reasoning about what a port *ought* to guarantee.
3. **Karpathy vs. my own security lens — where I had to rule against myself.** My security reflex
   wanted an audit trail on the local→remote transition (QD-Violation-2: timestamp, actor, log line)
   and an operator un-taint tool (P4). Both are defensible. **I decline both on the tie-break**: the
   audit field is a real gap but ARCH-182 does not promise this field the auditability guarantee it
   promises `createdBy`, and the un-taint tool is new authz surface bought to undo a write that P1
   deletes. If the owner picks P3, P4 comes *back* — the tie-break is contingent on the ruling, and
   I would rather say that than pretend the answer is unconditional.
4. **Scalability — a fourth round with nothing to report, and I again think saying so is worth more
   than manufacturing a finding.** The one honest observation (§6) is that a cheap security guard now
   rides an unbounded-in-principle scan, and the right response is a test, not an index.

---

## Expected disagreements with the other lens group (quality-dimensions)

1. **They will want the audit trail (their Violation 2) as a blocking item; I will not.** Expected
   split, same as round 2. My position: record it as debt with a trigger condition (the first time an
   operator asks *when* a trigger became remote), not as this round's work. Where I expect them to
   land a point on me: under P1, Fact B's transition is *derivable* from the version row's own
   `createdAt`/`actor`, so P1 gives them most of what they want for free — I should concede that
   rather than argue it.
2. **They will likely prefer P2 (two columns, keep `claim()`) over P1 (version row).** Their
   replaceability lens reads a cross-module read (`webhook-registry` → `workflow-catalog`'s released
   row) as new coupling. **My counter:** that read **already exists** at both fire sites for the
   `NOT_IN_RELEASE` guard — P1 adds a *field*, not a dependency. I expect this to be the sharpest
   disagreement of round 2 and I want it argued on that specific fact.
3. **Their Violation 5 was refuted and I confirm the refutation independently** (§1). I expect them
   to accept it; if they do not, the settling evidence is `mcp-facade.ts:373`'s `a.triggers ?? []`
   and `workflow-catalog.ts:355-368`'s all-versions union, and §4.3 turns the argument into a test so
   neither group has to be believed.
4. **Consumability: they will read the `createdRemote` name as needing a rename (C8); I will not.**
   Renaming a persisted column for a naming nit costs a migration on every deployed workRoot. Under
   P1 the name becomes accurate again and the question evaporates. Under P2/P3, document the
   semantics at the two projection sites and leave the column alone — that is my Karpathy call and I
   expect to have to defend it.
5. **Self-sustainability: we will agree on C4 and should say so loudly.** A security-relevant
   predicate changed outside every gate and the ledger did not move. Neither lens group disagrees
   about that, and the architecture-side repair is §2.3's one sentence — worth stating as consensus
   in round 2 rather than each group re-arguing it.

---

## What I would put in the ledger (skeleton, for whoever synthesises)

- **ARCH-182 amendment (8)** — the monotonic rule stated as **INV-V37-6**; the persistence-table row
  at `:5413` replaced (§2.1); the "never re-stamped" parenthesis removed from `:5683`/`:5691`;
  amendment (1) at `:5704-5710` marked `[SUPERSEDED 2026-09-24]` rather than edited; the IMPL/UT
  obligation named (§2.3); the "released version must be resolved before Fact B is read" dependency
  stated if P1 is chosen (risk 3).
- **ADR-086, third entry** — ONE current ruling at the top, the two older states marked and dated in
  the DES-263 style already on disk; §3.1's arithmetic and §3.2's failure shape recorded as the
  corrected premise; §3.3's four options with their costs; `owner_decision: pending` re-opened on the
  **mechanism** (P1/P2/P3/P4) only — not on the intent, which is settled.
- **INV-V37-7** (§4.2) — the `TriggerClaimStore` conformance suite, parametrized over every
  implementation, three directions each. Owner: tests gate.
- **One sentence in the wiring-bug-class row** (§4.1) — stop offering "required parameter" as a
  mitigation for a permissive default; a permissive forward is unwired until a test drives it from
  the tool surface. This is the fifth instance of the class in this repo's own memory.
- **C7 re-severitied to MED** with its disposition under each of P1/P2/P3 (§5), and the `stamp()`
  comment's justification changed from "one connection" to "monotone OR is idempotent and
  order-independent".
- **New ARCH row, only under P1** — `workflow_versions.registeredRemote`, its `DEFAULT 0` cohort
  stated honestly (risk 2), and the explicit note that ADR-086's recorded rejection of the
  version-row design was about `run_start` and does not reach a fire-path-only read (§3.3).
- **Tech-debt rows with event-shaped triggers** — QD-Violation-2's audit field (trigger: the first
  operator question about *when*); C8's naming (trigger: the next migration that touches these
  tables for another reason); the `declaredTriggers()` per-firing scan (trigger: the first workflow
  past ~10³ versions); the unwired bind guard (trigger: the first `auth-disabled` non-loopback
  deployment) — that last one is **not** v37 scope and I am filing it, not pulling it in.

*Adversarial architecture group (security / scalability / testability + Karpathy tie-break) —
v37 Gate 8 round-3 send-back, debate round 1 (independent), 2026-09-24.*
