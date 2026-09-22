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
