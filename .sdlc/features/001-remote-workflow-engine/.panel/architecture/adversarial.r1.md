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
