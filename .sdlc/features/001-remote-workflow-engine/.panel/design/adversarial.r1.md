# Adversarial design group — REQ-218 / REQ-219 — Gate 4 (Design), debate round 1 (independent)

**Lens bundle**: (a) Interface-contract · (b) Boundary/error · (c) Testability.
**Tie-breaker**: Karpathy simplicity-first — the minimum design that solves *this* problem, no
speculative flexibility.
**Round**: 1, independent. I have not read the other design panellist.
**Inputs read**: `01-requirements.md` §REQ-218/219, `02-architecture.md` §v37 slice
(ARCH-175..180, ADR-082..085, INV-V37-1..3), `state.yaml` `tech_stack` + gate notes.
`03-tasks.md` exists but carries v24..v36 only — **no v37 task rows exist yet**; where my lens
depends on how the work is split I say so in §7.

---

## Summary

1. **BLOCKING (B1).** ARCH-180's REQ-021 re-walk, wired as written, **refuses every seeded run**:
   `findProjectMarkerAncestor` tests the marker on the path itself, the unwired module passes the
   *workspace*, and the engine runs `git init` inside every seeded workspace (`CLAUDE.md` is not
   stripped from seeds either). The walk must start **above** the workspace. This also overrides
   02-architecture's Scenario (+1) #4, which describes the refusal as intended.
2. **BLOCKING (B2).** `denyRead: [workRoot]` is not "cross-run reads open if S7 fails" — it is
   **the agent cannot read its own workspace**, i.e. every run dead. Ship the enumerated deny list
   and widen only on a positive S7.
3. **BLOCKING (B3).** Eight spike arms all measure a *denial*; none measures that a real workflow
   still *completes* under `allowWrite=[workspace]`. Add S9.
4. **Contract collision.** ARCH-107's guide paragraph is "rendered from the effective grant list"
   while ARCH-177 mints no `ServerConfig` field — the guide is served by the server, not the
   gateway. Resolve as a static paragraph (§2.7).

Plus five smaller contract corrections (§2.3 grant rule, §2.4 protected-file derivation, §2.5 the
event-sink seam that does not exist today, §2.1 `allowRead`, §3.4 the version surface) and a full
per-DES UT map (§4.2).

---

## 0. Altitude call

`tech_stack` + the two requirements put this project at **both** altitudes, but these two REQs sit
almost entirely at the **agent** altitude, and I refuse to manufacture the system-altitude half.

- *System altitude* is real in this repo (hand-rolled JSON-RPC-over-HTTP server, own authn/authz,
  SQLite stores) — but nothing in REQ-218/219 touches a request path, a token, or a schema a remote
  caller submits. The one system-altitude item that genuinely binds is **replaceability**: the
  confinement's carrier is a third party's schema (`@anthropic-ai/claude-agent-sdk`), pinned by a
  caret range, and that is a *contract* risk (§2.6) rather than a security one.
- *Agent altitude* is where the design lives. The confined party is an LLM's shell. Two consequences
  my lenses lean on throughout:
  - **Observability at agent altitude has a second consumer**: an `EACCES` landing inside the
    agent's own `tool_result` is *good* observability — the agent reads it and adapts — which is why
    ARCH-178's honest "the denial may only exist as a failed tool result" is not the weakness it
    looks like (§3.5).
  - **Consumability at agent altitude means the workflow still completes.** A confinement that
    refuses every real toolchain is not a strict design, it is a broken one (§3.3, my B3).

---

## 1. What I measured before proposing anything

Everything below is from this working tree today, not from the architecture's prose.

| # | Measurement | Command / file |
|---|---|---|
| M1 | `SandboxSettings` is `z.infer<ReturnType<typeof SandboxSettingsSchema>>` and the object is **`z.core.$loose`** — unknown keys pass, nothing is rejected at runtime | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2682-2736` |
| M2 | `filesystem` has `allowWrite`, `denyWrite`, `denyRead`, `allowRead` **and `allowManagedReadPathsOnly`** | same |
| M3 | `credentials.files[].mode` is `z.ZodLiteral<"deny">`; `credentials.envVars[].mode` is `deny|mask` | same |
| M4 | SDK dependency is **`"^0.3.199"`** — a caret range, not a pin | `package.json:23` |
| M5 | `invoke(req)` already carries `runId` **and** `agentId` | `src/gateway/client.ts:198` |
| M6 | `ClaudeAgentSdkGatewayConfig` has **no `EventSink`** and the gateway has **no event emission**; `queryImpl` is the only injected seam | `src/gateway/claude-agent-sdk-client.ts:28-98, 452-457` |
| M7 | The gateway is constructed in `composeConfig()` **before** `createServer()` exists — this is why `resolveMcp` is a *late* bind (`bindResolveMcp`) | `claude-agent-sdk-client.ts:459-468`, `main.ts:342` |
| M8 | **`initGitBaseline(workspace)` runs `git init` inside every seeded run workspace** | `run-manager.ts:735` → `src/workspace-git.ts:42-67` |
| M9 | Seed materialization **rejects** `.git` paths and **strips** `.claude/settings*.json` + `.claude/hooks/**` — but **`CLAUDE.md` is explicitly NOT stripped** | `src/path-verdict.ts:18,38-41` |
| M10 | `findProjectMarkerAncestor(path, stopAt, exists, realpath)` tests `join(dir,'.git')` / `join(dir,'CLAUDE.md')` on **`path` itself** before walking up | `src/workroot-guard.ts:42-53` |
| M11 | The unwired module passes **`config.cwd`** (= the run workspace) as `path` | `src/session-options-builder.ts:74, 89` |
| M12 | `val-024`'s re-walk clause writes `.git` **into `cwd`** and asserts refusal — the VAL evidence encodes M11's semantics | `tests/acceptance/val-024-workroot-isolation.test.ts:73-75` |
| M13 | `isPathContained(path, root, realpath)` already exists and is the repo's single containment primitive | `src/path-containment.ts:15` |
| M14 | `EngineEvent` is a **closed** four-member union with a comment saying "a v37 kind is a v37 edit" | `src/event-log.ts:8-14` |

---

## 2. Lens (a) — Interface-contract

I propose **six DES rows** (numbering continues v36's DES-250 → DES-251..256). Signatures below are
what I would hold the synthesizer to; each is followed by the contract decision it settles.

### 2.1 DES-251 — `buildBashConfinement()` (ARCH-175)

```ts
// src/gateway/bash-confinement.ts   — PURE: no fs, no process, no env, no clock
export interface ConfinementInput {
  readonly root: string | undefined;            // this call's workspace (req.workspace ?? cfg.cwd)
  readonly grantedHostPaths: readonly string[];  // already validated + realpath'd at boot
  readonly protectedFiles: readonly string[];    // absolute, resolved at the composition root
  readonly workRoot: string | undefined;
  readonly denyReadMode: 'workroot' | 'enumerated';   // §3.2 — S7's two arms, ONE parameter
}
export function buildBashConfinement(input: ConfinementInput): SandboxSettings;
```

**Contract decisions this row must state, because ARCH-175 leaves them implicit:**

1. **The return is total and never `undefined`.** There is no "no sandbox" return value. `root ===
   undefined` ⇒ `allowWrite: []` (ARCH-175's R10 rule) — I endorse this without reservation: it is
   the direct antidote to the bug class ARCH-176 names, where an empty candidate list read as a
   clean one.
2. **`filesystem.allowRead` is emitted ONLY in `'workroot'` mode, and its job is named.** ARCH-175
   emits it unconditionally, which is wrong in both directions. In `'enumerated'` mode (§3.2's
   default) it is dead weight: M2 shows the schema carries `allowManagedReadPathsOnly`, whose
   existence only makes sense if `allowRead` is *additive* to a default-permissive read posture — so
   an additive allow beside no ancestor deny changes nothing, and if the unlikely whitelist reading
   is right it locks the CLI out of `/usr/lib`, `/lib64` and its own binary. In `'workroot'` mode it
   is **load-bearing and must be present**: it is the only carve-out that lets the agent read its
   own workspace out from under `denyRead: [workRoot]`, and it is precisely the thing spike arm S7
   measures (*does a narrower allow override a broader deny?*). So the two modes differ in two
   fields, not one, and S7 must be run **with `allowRead` set** or it measures the wrong object.
   The row must also state **`allowManagedReadPathsOnly` is deliberately unset in both modes**, with
   a UT asserting that key's absence, so a later "tighten the sandbox" edit cannot add it without a
   test turning red.
3. **`denyReadMode` is a parameter, not a config key** (§3.2). One compile-time constant
   `ENGINE_STATE_DENY_SUFFIXES = ['store','catalog.db','auth-tokens.db','cas','assets',
   'webhooks.db','continuations.db','schedules.db']` lives in this file. ADR-082 already forbids a
   confinement toggle in config; the S7 fallback must not become one by accident.
4. **Empty-string handling is uniform.** ARCH-175 filters `isNonEmptyString` on `denyRead` only.
   Apply the same filter to every array the function emits, and make `root === ''` take the
   `undefined` branch. One predicate, four uses — not three special cases.
5. **Return the SDK's `SandboxSettings` type directly**, no parallel local type. But state the
   M1 consequence plainly on the row: **`$loose` means TypeScript is the only thing checking our
   field names, and TypeScript checks them against a caret-ranged dependency (M4).** A minor bump
   that renames `allowWrite` produces a compile error *only if* our tsconfig rejects excess
   properties on the object literal — and produces **silent total loss of confinement** if the SDK
   ever moves to accepting a superset. The contract sentence I want in the ledger: *"a green
   typecheck is not evidence that this object confines anything; only the real-run arm of the
   spike and Gate 7.5 are."*

### 2.2 DES-252 — the `confinement` block and its two hops (ARCH-176/177)

```ts
// on ClaudeAgentSdkGatewayConfig
confinement?: {
  readonly allowHostPaths: readonly string[];   // validated + realpath'd
  readonly protectedFiles: readonly string[];   // absolute
  readonly workRoot: string;                    // REQUIRED here — see below
};
```

**The `workRoot` optionality is wrong as the architecture's contract table has it.** ARCH-177
computes `protectedFiles = [..., join(workRoot,'auth-tokens.db')]`, which is unwritable without a
`workRoot`; and ARCH-175's `denyRead` must never contain a literal `'undefined'`. Resolve the
conflict at the type: **`workRoot` is required on the `confinement` block** (the composition root
always knows it), and `ConfinementInput.workRoot` stays `string | undefined` only because the pure
function is also reachable from a unit-tier caller. Optionality belongs on the *block*, not on a
field inside it: `confinement` absent ⇒ the gateway builds the workspace-only posture with
`workRoot: undefined`, never "no sandbox" (the R10 rule, restated one level up).

**The `EXCLUDED`-row plus one wiring `it()` in `compose-config-v2-wiring.test.ts` is right and I
would not weaken it** — see §4.2 for what that test must actually assert.

**ARCH-176's three text changes ride this row and must be named on it**, or they are the first thing
a task split drops: the two contradictory comments (`:184-189` and `:243-249`) collapsing into one
true sentence, the `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` explanation (`:639-645`), and the
`extractCandidatePaths`-without-`blockedPath` site (`:291`) keeping its bug-class note. REQ-218's
acceptance demands all three; none of them is testable, which is exactly why they need an owner.

### 2.3 DES-253 — grant validation (ARCH-177), as a pure function

```ts
// src/main.ts or src/gateway/bash-confinement.ts — pure, realpath injected
export type GrantRefusal = { entry: string; rule: 'NOT_ABSOLUTE'|'UNRESOLVABLE'|'INSIDE_WORKROOT'|'COVERS_PROTECTED'|'GLOB' };
export function validateHostPathGrants(
  grants: readonly string[],
  ctx: { workRoot: string; protectedFiles: readonly string[] },
  realpathImpl?: (p: string) => string,
): { ok: true; resolved: string[] } | { ok: false; refusals: GrantRefusal[] };
```

Three contract corrections to ARCH-177's prose:

- **Rule (iii) is too narrow.** ARCH-177 refuses an entry that is *an ancestor of or equal to*
  `workRoot` or a protected file. That leaves **`<workRoot>/cas`, `<workRoot>/store`,
  `<workRoot>/assets` grantable** — a grant that hands the agent the content-addressed store and
  every other run's seed. The rule must be **"no entry inside `workRoot`, in either direction"**:
  refuse if the entry contains `workRoot` *or* `workRoot` contains the entry. Use `isPathContained`
  (M13) for both directions rather than minting a second containment idiom.
- **Return all refusals, not the first.** An operator editing a five-entry list under time pressure
  should be told about all five, once. (`ADR-028`'s idiom is one typed message; one message
  *listing* the offending entries satisfies it and is strictly kinder.)
- **`UNRESOLVABLE` is a refusal, not a pass-through.** A grant naming a path that does not exist
  yet realpaths to itself in `workroot-guard`'s forgiving idiom; here it must refuse, because the
  whole point of realpath'ing is that a later re-point cannot widen the grant, and a
  not-yet-existing path can be created as a symlink to anything. **Name the operational cost on the
  row**: the operator must `mkdir` a granted path before boot, whereas today `$HOME/.cache/jev-haiku`
  is created by the agent itself. That is consistent with what a bind-mount-style jail needs anyway,
  but it is a behaviour change an operator will meet as a boot refusal, so it belongs in the refusal
  message and in DEPLOY.md, not in a reviewer's head.

### 2.4 DES-254 — `protectedFiles` come from the loader, not from a re-derivation

ARCH-177 computes `resolve(RWE_CONFIG_PATH ?? 'rwe.config.json')` — **resolved against whatever cwd
systemd gave the process**. If the engine was started with a different cwd, this names a file that
does not exist, `denyRead`/`credentials.files` deny a phantom, and **the real config stays
readable**, silently. The contract fix is one line and it is the honest one: `loadFileConfig()`
returns (or exposes) **the absolute path it actually read**, and `composeConfig()` passes *that*.
A deny list derived from a second guess at the same fact is the same defect class as ARCH-174's
"don't infer a global fact from a page".

### 2.5 DES-255 — the event sink seam (ARCH-178)

ARCH-178 says the sink "stays **injected into** the gateway exactly as ARCH-159 designed it". M6+M7
say that is not the current state and cannot be a plain constructor injection: **no sink exists on
the gateway today, and the gateway is constructed in `composeConfig()` before the sink's owner
exists** — which is exactly why `resolveMcp` is a late bind. So the design must pick one, and it is
not free:

- **(i) `bindEventSink(sink)` late bind**, mirroring `bindResolveMcp` — smallest diff, one
  precedent already in the file, and it has a named failure mode: unbound ⇒ no confinement line.
- **(ii) create the sink in `composeConfig()`** and pass it to both the gateway and `createServer()`
  — better (no unbound window) but moves ownership of a v36 seam and touches `server.ts`.

**My recommendation is (i)**, plus the same discipline v36 applied to the other late bind: the
unbound case must be a **no-op sink installed at construction**, never an `undefined` the emit site
has to test — so the "nothing to do" branch and the "did it" branch are not the same line of code.
I want this stated as a DES boundary because the cost of the unbound window is precisely that the
`agent.confinement` line — the one ARCH-177 leans on as the operator's read path in place of an
endpoint — is missing exactly when nobody is watching.

**Also**: `EngineEvent` is a closed union with a note saying a v37 kind is a v37 edit (M14). Two new
members, and `agent.confinement*` carry **no `AuditActor`** — they are engine facts, not
principal-attributable actions. Say so on the row so a future reviewer does not read the missing
actor as an omission.

### 2.6 DES-256 — the intra-run re-walk (ARCH-180's rider)

```ts
// src/workroot-guard.ts — new thin export, defaults supplied HERE not at the call site
export function findProjectMarkerAboveWorkspace(
  workspace: string,
  workRoot: string,
  deps?: { existsImpl?: (p: string) => boolean; realpathImpl?: (p: string) => string },
): string | null;
```

Two contract points, and the second is my biggest finding of the round (§3.1):

- **The gateway must not acquire an `fs` dependency.** `findProjectMarkerAncestor` has four
  *required* parameters; calling it from the gateway means importing `node:fs` into the module whose
  entire test strategy is "fake the SDK, assert the Options object". One thin wrapper in
  `workroot-guard.ts` with defaulted, injectable probes keeps the gateway's surface at two arguments
  and keeps the UT reachable (§4.4).
- **It starts the walk ABOVE the workspace.** See §3.1.

### 2.7 DES-257 — the guide paragraph: ARCH-107 and ARCH-177 cannot both be true as written

The Gate-2 contract table says `workflow_authoring_guide` gains 「one new paragraph, **rendered from
the effective grant list**」, and the development view lists `src/authoring-guide.ts` as changed.
ARCH-177 says the grant list lands **only** on the constructed gateway's own config and that 「no
`ServerConfig` field is minted for a value nothing else reads」. The guide is rendered on the
**server** side, not the gateway's — so the grant list has no path to it. Measured: `grep -n
'allowHostPaths\|sandbox' src/authoring-guide.ts src/server.ts` finds **nothing carrying it today**,
and the only `sandbox` hits in `authoring-guide.ts` are the *script* sandbox (`node:vm`).

Two resolutions:

- **(a) mint the `ServerConfig` field** — then ARCH-177's `EXCLUDED` row in
  `compose-config-v2-wiring.test.ts` becomes a *forwarded* row and the probe changes shape, and a
  second hop-2 acquires the silently-inert failure mode the whole ARCH-177 note is about.
- **(b) a static paragraph** — 「a host path outside the run workspace requires an operator grant in
  `rwe.config.json`; the list applied to your run appears in the `agent.confinement` log line」. No
  wiring, no hop, no new config surface.

**Karpathy and ADR-084 both say (b)**: ADR-084 already deferred the entire author-facing request
surface on the grounds that the author cannot ask in-band, so rendering the *effective* list to the
author is state the author cannot act on. One extra constraint on whichever wins: the guide already
has a section literally titled 「The sandbox API」 meaning the `node:vm` script sandbox
(`authoring-guide.ts:432`). ARCH-175 refused to put the new module under `src/sandbox/` for exactly
this reason; the guide paragraph must be titled after **host path grants**, never 「sandbox」, or the
collision ARCH-175 avoided in the filesystem reappears in the document a cold author reads.

---

## 3. Lens (b) — Boundary / error

### 3.1 **B1 (BLOCKING). ARCH-180's rider, implemented as written, refuses every seeded run.**

Chain of measured facts:

- `findProjectMarkerAncestor` checks the marker on **`path` itself** before walking (M10).
- The unwired module passes the **workspace** as `path` (M11), and `val-024` writes `.git` into the
  workspace and asserts refusal (M12) — so the VAL evidence *encodes* that reading.
- The engine itself runs **`git init` in every seeded workspace** (M8), and seed materialization
  deliberately **does not strip `CLAUDE.md`** (M9).

⇒ Wire `findProjectMarkerAncestor(workspace, workRoot, ...)` in front of `query()` and **the first
`agent()` call of every seeded run returns `WORKROOT_INSIDE_PROJECT`**. Every unseeded SDLC workflow
dies the moment one of its own agents commits. This is not a subtle interaction: it is the engine
refusing its own normal output.

The irony is worth recording, because it is REQ-219's thesis sharpened: **the coverage lie was not
only hiding an unimplemented clause — it was hiding a defect.** The module was never wired, so its
`path` argument was never wrong in production; `val-024` went green over the wrong semantics for
four iterations because nothing downstream of it ran.

**Design fix, and it is small — but it is TWO checks, not one displaced check.** Collapsing them
into `dirname(realpath(workspace))` is wrong for the symlink case: a workspace symlinked into
`/home/user/proj` realpaths to `/home/user/proj/<ws>`, whose `dirname` is `/home/user/proj`… only if
the link target's parent *is* the project; take `dirname` of the realpath of a link that lands one
level deeper and the walk steps straight past `proj/.git`. Split them:

- **Containment check** — `isPathContained(realpath(workspace), workRoot)` (M13, the repo's existing
  primitive). A workspace whose real location is outside `workRoot` is a refusal on its own terms,
  and it is the check that actually catches the symlink-into-a-project case.
- **Marker walk** — `findProjectMarkerAncestor(dirname(workspace), workRoot, ...)`, keeping the
  realpath *inside* the function exactly as it is today (`workroot-guard.ts:47`). The start point
  moves up one level; nothing else about the function changes.

Justification from REQ-021's own leak model, not from convenience: the leak is the CLI resolving its
*project root* to an ancestor **outside the run** and loading the operator's `CLAUDE.md` +
auto-memory. A marker **inside** the run workspace makes the CLI treat *the run's own directory* as
the project — which is the engine's deliberate design (`initGitBaseline` exists so the SDLC precheck
has something to diff) and leaks nothing the agent did not already have.

**This overrides a settled Gate-2 statement, and I name it so the synthesizer does not read my
finding as a contradiction of a decision rather than a correction of one**: `02-architecture.md`'s
「Scenarios (+1)」 **#4** describes 「an agent writes `.git/` into its own workspace mid-run → the next
`agent()` call is refused `WORKROOT_INSIDE_PROJECT`」 as the *intended* behaviour. Under M8/M9 that
scenario fires on the engine's own `git init`, so the scenario text must be amended in the same
round as the DES row. **Two existing design rows must also be amended as living documents**, and
neither appears in the Gate-2 prescription list: **DES-031** (the re-walk's original row — its start
point and its refusal semantics both change) and **DES-106** (whose amendment ADR-085 explicitly
prescribes *to this gate*, because it traces REQ-093 and is outside this closure, so nobody else
will open it).

**Named boundary cases the DES must carry, each with its own UT arm (§4.4):**

| Case | Expected |
|---|---|
| `.git` at the workspace root (engine's own `initGitBaseline`) | **allow** — regression guard for exactly this |
| `CLAUDE.md` at the workspace root (seeded repo, M9) | **allow** |
| marker at `<workRoot>/workflows/<name>/` or `.../runs/` | refuse |
| `workspace === workRoot` (degenerate config) | refuse or allow — **decide explicitly**; I propose allow-and-log, because boot's guard already owns `workRoot` |
| workspace is a symlink into a project | refuse (realpath first — the property `findProjectMarkerAncestor` already has) |
| `workRoot` unknown on this call | **skip the re-walk** and say so; do not fail open silently, do not fail closed on a missing config |

**Honest consequence of the fix, stated rather than glossed:** with the walk starting above the
workspace, the only directories it can trip on are engine-created intermediates — which, after
REQ-218's sandbox lands, an agent can no longer write to. The re-walk's true-positive domain is
therefore **near-empty by construction**. I still say **wire it** rather than delete it, on two
grounds: (1) REQ-219's own acceptance says a module with green tests and no caller must not keep
lying, and the cheapest honest ending here is one wired call; (2) it is the only thing standing
between the sandbox's arm-3 fallback and the REQ-021 leak if S1/S2 both fail. But the DES must say
this out loud, because "we wired REQ-021's re-walk" will otherwise be read as a bigger security win
than it is, and this ledger has just paid twice for exactly that kind of over-claim.

### 3.2 **B2 (BLOCKING). The S7 failure mode is "every run dead", not "cross-run reads open".**

ARCH-175 sets `denyRead = [workRoot, ...protectedFiles]` and `allowWrite = [root, ...]` where
**`root` is a descendant of `workRoot`**. ARCH-175's own note treats S7 (does a narrower allow
override a broader deny?) as deciding whether cross-run reads close. It decides much more: if deny
wins unconditionally, **the agent cannot read its own workspace**, and every agent call in every run
fails in a way that looks like a workflow bug.

**Design consequence: invert the default.** Ship `denyReadMode: 'enumerated'` (the engine-state
path list) as the built-in posture, and widen to `'workroot'` **only** after S7 positively
demonstrates allow-over-deny on the remote host. That ordering costs one enum value and converts a
possible total outage into a named, already-written-down residual. The architecture has the two arms
but has them the wrong way round: it ships the risky arm and keeps the safe one as a fallback,
which means the failure is discovered in production rather than in the spike.

### 3.3 **B3 (BLOCKING). Eight spike arms all test a denial; none tests that a real run still finishes.**

`allowUnsandboxedCommands: false` + no `excludedCommands` ⇒ **every** Bash command is sandboxed, with
`allowWrite = [workspace, ...grants]`. Real toolchains write outside that: `$TMPDIR`, `~/.npm/_logs`,
`~/.cache`, `~/.config/git`, compiler/test-runner scratch. S1–S8 measure *that a write is refused*.
Nothing measures *that a legitimate workflow still completes*.

**Propose S9 (blocking, same spike, remote host): run one real SDLC-shaped workflow end-to-end under
the confinement and record every EACCES it produces.** Its output is design input, not a pass/fail:
it tells us whether `$TMPDIR` needs to be a built-in grant (distinct from operator grants — a
default, not a config key) or whether the CLI's sandbox already handles it. I deliberately do **not**
pre-decide that; M2's schema has no documented default-writable set in the type, and guessing is how
we would ship a second wrong claim in a slice built to delete one. Karpathy cuts this way, not the
other: a jail that fails every existing workflow is not the minimum solution, it is zero solution.

### 3.4 **B4. `$loose` + `^0.3.199` — the confinement can vanish silently across a patch bump.**

**There are two version surfaces and the design must say which one enforces.** The jail is executed
by the `claude` **binary** (Gate 2 cites 2.1.278); our pin is the **npm SDK** (`^0.3.199`). Measured:
the gateway sets **no** `pathToClaudeCodeExecutable`, and the installed package carries
`extractFromBunfs.js` + `manifest.json` (i.e. the executable travels inside the npm package at
`0.3.199`), so pinning the package does pin the jail **unless** a PATH-installed `claude` is
preferred at resolution time — which is a one-line spike observation worth adding to S6. Whichever
it is, that is the version the `agent.confinement` payload should record, not the one in
`package.json`.

M1 (unknown keys pass, nothing validated) and M4 (caret range) compose into: rename or nest a field
upstream and `options.sandbox` becomes a decorative object. No test in the repo would turn red; the
`agent.confinement` log line would still print *our* object; Gate 7.5's own green would be the last
evidence and it would be stale. **Two design asks, both cheap:** (1) pin the SDK exactly for this
iteration (or add a `resolutions`-style lock note in DEPLOY.md) and record the pinned version in the
`agent.confinement` event payload so a log line is self-dating; (2) the acceptance evidence for
REQ-218 must be a **real write refusal on the remote host**, never a unit assertion about object
shape — which REQ-218's own clause already demands ("要有真跑證明"), and which this finding says must
be re-run on every SDK bump, not once.

### 3.5 **B5. Emission order and the refused call.**

The refused-call path has four candidate orderings and they are not equivalent. I propose, and want
pinned in the DES:

```
invoke()
  → auth/env resolution (existing, unchanged)
  → DES-256 re-walk            ← refuse here: {ok:false, reason:'terminal', detail: WORKROOT_INSIDE_PROJECT}
  → buildBashConfinement()
  → emit agent.confinement      ← exactly once, from the returned object, never re-derived
  → query()
```

- The re-walk refusal is **`terminal`, never `transient`** — retrying re-walks the same tree and the
  marker does not move. (`GatewayResult.reason` already has that domain; `stamp()` at
  `claude-agent-sdk-client.ts:612` already covers the `ok:false` arm.)
- A refused call emits **no** `agent.confinement` line, because no policy was applied. That is a
  boundary the UT must pin in both directions, or the log acquires a line describing a session that
  never existed.
- ARCH-178's second event (`agent.confinement_denied`) is **correctly** spike-gated and I endorse
  the honesty. At agent altitude the fallback is genuinely adequate: the `EACCES` reaches the agent's
  own `tool_result`, which is both the agent's feedback channel and (via `onEvent`) already inside
  `agent_log`. I would go one step further than ARCH-178 and say so on the row, so that S4 coming
  back negative reads as "the design's stated fallback held", not as a gap.

### 3.6 **B6. INV-V37-2's remaining vector is narrower than ARCH-175 assumes — and the check is free.**

Good news, measured: the author-supplied-seed vector is **already closed** — `path-verdict.ts`
strips `.claude/settings*.json` and `.claude/hooks/**` from every run-workspace write and rejects
`.git` outright (M9). So ARCH-175's `denyWrite` on the workspace settings files is defending against
the *agent's own* Write/Bash only, which is exactly right and one line. Two residual arms for the
DES to name rather than assume:

- **Asset materialization uses `dest:'asset-tree'`, where `STRIP_RE` does not apply.** Confirm (one
  UT) that no asset path can land at `<workspace>/.claude/settings.json`; today the shape is
  `.claude/skills/<name>/…`, so this is a pin, not a hole.
- **If S5 says project settings are honoured**, `denyWrite` is the fix; if S5 says the flag-settings
  layer outranks project settings, arm 2 (`Options.settings.sandbox`) is the stronger carrier and
  `denyWrite` becomes belt-and-braces. Either way the design should keep `denyWrite` — it costs one
  line and the schema gives no default-deny.

### 3.7 **B7. `failIfUnavailable: true` has an unspecified error surface.**

ADR-083 decides fail-closed and I agree. But "the run fails typed" is not yet a contract: the SDK
emits *something* (an error result on the query stream), and the gateway's existing `_drain` turns
stream contents into a `GatewayResult`. The DES must state which `reason` a sandbox-unavailable
failure maps to (**`terminal`** — a retry cannot install bubblewrap) and that its `detail` names
`sandbox unavailable` verbatim, because ADR-083's revisit trigger is literally phrased as *"an
operator reports a run refused for `sandbox unavailable`"*. A trigger whose text nobody can grep for
does not fire.

---

## 4. Lens (c) — Testability

**Standard I hold the design to**: every DES row is covered by at least one UT, and no UT needs a
real `claude` CLI, a real clock, or a real `$HOME`.

### 4.1 The seams that already exist and must be used, not re-invented

- `queryImpl` (M6) — the gateway's SDK fake. **Every wiring assertion in this slice goes through it**:
  call `invoke()` with an injected `queryImpl` that captures its `Options` argument, then assert on
  `captured.sandbox`. No new seam needed for ARCH-176.
- `existsImpl` / `realpathImpl` on `workroot-guard` — already injected, already the pattern.
- `createEventSink({write})` — already takes an injected `write`, so `agent.confinement` lines are
  assertable as strings with no stdout capture.
- **Nothing in this slice needs a clock or a store.** `buildBashConfinement` is pure and the two
  events carry no time of their own (the sink stamps `at`). That is a genuine simplicity win worth
  stating: the v37 slice is the first in four iterations with **zero** clock/storage injection
  questions.

### 4.2 Per-DES UT map (this is the row I would send back if it is missing)

| DES | UT arms (minimum) |
|---|---|
| DES-251 builder | `root=undefined` ⇒ empty `allowWrite`; `root=''` ⇒ same branch; `workRoot=undefined` ⇒ no literal `'undefined'` in `denyRead`; grants appear verbatim in `allowWrite`; `denyWrite` names **both** settings files; `credentials.files` shape matches M3 exactly (`mode:'deny'`); **`allowManagedReadPathsOnly` absent**; `denyReadMode:'enumerated'` vs `'workroot'` produce the two documented lists |
| DES-252 wiring | via `queryImpl`: `options.sandbox` **deep-equals** the builder's output for the same input (identity of decision, not a re-computation); `confinement` absent ⇒ workspace-only posture present, **never `sandbox: undefined`** |
| DES-253 grants | one arm per `GrantRefusal.rule`; **`<workRoot>/cas` refused** (B6's hole); relative path refused; `~`-prefixed refused; glob refused; symlink resolved to target; **all** refusals returned, not the first |
| DES-254 protected files | `composeConfig()` with `RWE_CONFIG_PATH` set and a differing cwd ⇒ `protectedFiles[0]` is the file actually loaded |
| DES-255 events | one `agent.confinement` per `invoke()` (not per tool call); refused call ⇒ **zero** lines; unbound sink ⇒ no throw; payload redacted by the sink's existing path |
| DES-256 re-walk | the six rows of §3.1's table, all with injected `existsImpl`/`realpathImpl` |
| ARCH-177 wiring probe | the `EXCLUDED` row **plus** the hop-2 `it()`: `composeConfig({gateway:'sdk', sandbox:{allowHostPaths:[p]}})` ⇒ constructed gateway's `_config.confinement.allowHostPaths === [p]` |

### 4.3 What is NOT unit-testable, and must not be claimed as if it were

Three facts in this slice are **only** knowable from a real run, and the DES should mark them so the
test-first gate does not mint a green over them: (1) that `Options.sandbox` is honoured at all (M1's
`$loose` guarantees nothing rejects a wrong shape); (2) that a denial produces *any* observable
signal (S4); (3) that a real workflow still completes (B3/S9). Each maps to a Gate 7.5 item, not a
UT. The one-line rule I would write into the DES: **"no UT in this slice may be cited as evidence
that the confinement confines."**

### 4.4 The deletions are a testability event, not just a cleanup

- `val-023`'s rewrite (ARCH-179) is **real-tier and must stay real-tier** — it is REQ-020's only
  fault-injected coverage. Its new assertions (`ok:false` + timeout, `semaphoreGauge().inUse === 0`)
  are both reachable: `semaphoreGauge()` is already public (`run-manager.ts:404`, used by
  `server.ts:1401`). Good.
- `gateway-effort.test.ts:263`'s fence must be **deleted in the same commit as the module**, not
  after: ARCH-180 is right that it otherwise passes vacuously forever. I would add one thing: the
  fence's replacement is **not** another fence. INV-V37-3's automated checker is correctly filed to
  v38; a hand-written "no importer of a deleted file" assertion is the greener-than-green pattern
  this slice exists to delete.
- **Six test files are deleted while new ones are written.** Under Gate 5's RED-then-GREEN
  discipline this needs an explicit ordering or the suite is briefly green for the wrong reason
  (§7).

---

## 5. Where my own three lenses conflict (stated, not resolved by pretending)

1. **Interface-contract wants `confinement` non-optional; boundary wants absent ⇒ strict.**
   Non-optional gives a compiler guarantee that every construction site supplies a policy — which is
   exactly the guarantee the composeConfig bug class keeps eating. Optional-with-strict-default
   keeps ~40 existing `new ClaudeAgentSdkGatewayClient({...})` test constructions compiling.
   **Resolution: optional block, required fields inside it, strict default, and the wiring probe
   carries the guarantee the type gave up** (§2.2). I am explicit that this is a *trade*, not a
   free lunch: the probe is a test, and tests can be deleted where a type cannot.
2. **Testability wants injection; Karpathy resents constructor surface.** DES-256's wrapper and
   DES-255's sink each add a seam. My tie-break: the repo's precedent (`queryImpl`, `existsImpl`,
   `bindResolveMcp`) already pays this cost and pays it in one shape, so adding a seam *in that
   shape* is not new flexibility — it is consistency. A seam in a *new* shape (a
   `WorkspaceConfinement` interface, a config-driven policy provider) would be, and I reject those.
3. **Boundary wants `denyReadMode` as a parameter; interface-contract wants the function to have
   one behaviour.** A parameter that selects between two postures is a small mode, and modes are
   what ADR-083 just refused. **Resolution: it is a parameter with no path from config to it** — the
   caller passes a constant that the spike's outcome fixes, and if S7 comes back positive the losing
   arm is **deleted**, not kept. The DES should say so, with the deletion as an explicit follow-up
   item, or we will still have both arms in v40.

---

## 6. Karpathy tie-break, applied and countable

Things I am arguing **out** of the design: `filesystem.allowRead` (§2.1.2, useless or fatal);
`allowManagedReadPathsOnly` (never set); a config key for the S7 fallback (§2.1.3); a second
containment helper (§2.3, reuse `isPathContained`); a `WorkspaceConfinement` interface (already
refused at Gate 2, I re-endorse); a read-back endpoint (already refused, I re-endorse); a
replacement fence test (§4.4); locking for shared granted paths (correctly filed to v38).

Things I am arguing **in**, total: one enum parameter, one thin `workroot-guard` wrapper, one
`bindEventSink`, one loader-returned path, one widened grant rule, one extra spike arm. Net new
production surface over the architecture's plan: **roughly ten lines**. Net removed: one schema
field and its whole failure mode.

---

## 7. Where task-splitting affects my lens (03-tasks.md does not exist yet)

1. **ARCH-176, ARCH-178 and ARCH-180's rider all edit the same ~55-line `Options` literal**
   (`claude-agent-sdk-client.ts:623-677`). In a shared working tree with ~20 implementers that is
   three agents inside one block. **One task must own that file**, with its three edits as ordered
   commits in the order of §3.5. The parallelizable pieces are DES-251 (new file + UT), DES-253/254
   (`main.ts`), and the `val-023` rewrite.
2. **The spike is a task with no DES row.** S1–S8 (+ my S9) produce *decisions*, not code, and three
   DES rows (`denyReadMode`, the carrier arm, the second event) are parameterized on their outcome.
   The task list must carry it as **task #1, blocking, remote host**, and the DES rows must specify
   **both arms** so the Gate 5 tests written before the spike returns do not need rewriting.
3. **ARCH-180's "same commit" must be sequenced internally, not literally simultaneous.** The safe
   order inside that one task is: wire DES-256 → its UTs green → *then* delete the module, its four
   test files and the fence. Deleting first leaves the tree with REQ-021 having neither an
   implementation nor a test for an interval — small, but this is the iteration whose entire subject
   is not lying about coverage.
4. **B1's fix means `val-024` changes semantics, not just its target.** That is verification's and
   validation's work per ARCH-180, but the task that wires DES-256 must *name* it, or the re-point
   lands as a mechanical retarget of a test that now asserts the opposite of the truth.

---

## 8. Risks

| # | Risk | Severity | Mitigation I propose |
|---|---|---|---|
| R1 | Re-walk wired as written ⇒ **every seeded run refused** (§3.1) | **Blocking** | Walk from `dirname(realpath(workspace))`; six-arm UT table; `val-024` re-pointed with corrected semantics |
| R2 | `denyRead: [workRoot]` under deny-wins ⇒ **agent cannot read its own workspace**, all runs dead (§3.2) | **Blocking** | Ship `'enumerated'`, widen only on a positive S7 |
| R3 | Confinement refuses real toolchains (`$TMPDIR`, caches) ⇒ workflows break in ways that look like workflow bugs (§3.3) | **Blocking** | Spike arm S9: one real SDLC-shaped run under confinement, EACCES inventory |
| R4 | `$loose` schema + caret range ⇒ confinement silently becomes a decorative object (§3.4) | High | Exact pin; version in the `agent.confinement` payload; real-run evidence re-earned on every bump |
| R5 | `protectedFiles` re-derived from cwd ⇒ deny list points at a phantom while the real config stays readable (§2.4) | High | Loader returns the path it read |
| R6 | Grant rule (iii) permits `<workRoot>/cas` ⇒ a grant hands over the CAS store (§2.3) | High | "No entry inside `workRoot`, either direction", via `isPathContained` |
| R7 | Event sink unbound window ⇒ the only operator read path is silently absent (§2.5) | Medium | No-op sink installed at construction; late bind mirrors `bindResolveMcp` |
| R8 | Three DES rows parameterized on an unreturned spike ⇒ Gate 5 tests rewritten mid-flight (§7.2) | Medium | Both arms specified in the DES; spike is task #1 |
| R9 | `agent.confinement` line volume — one per `agent()` call on an unrotated log (ADR-078) | Low | Accept; already argued at Gate 2 |
| R10 | The re-walk's true-positive domain is near-empty post-sandbox and may be over-read as a security win (§3.1) | Low | Say it on the DES row |
| R11 | ARCH-107's 「rendered from the effective grant list」 has no wire to the server; implementing it literally mints a second silently-inert hop (§2.7) | Medium | Static paragraph, titled after *host path grants* not 「sandbox」 |
| R12 | Scenario (+1) #4, DES-031 and DES-106 all state the pre-B1 semantics and are not on Gate 2's prescription list (§3.1) | Medium | Amend all three as living documents in this gate |

---

## 9. Expected disagreements with the other lens (quality-dimensions)

1. **`agent.confinement_denied` unconditional vs best-effort.** I expect them to argue that an
   observability dimension cannot accept "the event may not exist" and to ask for a transcript scan
   or a `PostToolUse` sweep as a fallback. **I hold best-effort**, and my agent-altitude argument
   (§3.5) is the reason: the denial *does* reach a consumer — the agent itself, in its own
   `tool_result`, already captured in `agent_log` via `onEvent`. Building a second observation path
   for a fact that already arrives is the speculative machinery this slice is otherwise deleting.
2. **My B2 (invert the S7 default) may read to them as weakening the posture.** It is the opposite:
   it moves the discovery of a possible total outage from production into the spike. If they argue
   for shipping the strict arm first, the tie-break is availability evidence, not preference — and
   neither of us has it until S7 returns.
3. **B1's fix (walk above the workspace) will look like a security relaxation** — it removes a
   refusal that `val-024` currently asserts. I expect a self-sustainability objection ("the guard
   now catches less"). My answer is that the refusal it removes was never a true positive: the
   engine creates that marker itself, and the leak REQ-021 names is an *ancestor outside the run*.
4. **The `confinement` optionality trade (§5.1)** — a consumability/replaceability lens usually
   wants the required field. I expect them to be right in principle and wrong on cost, and I would
   concede quickly if they can show the ~40 construction sites are fewer than I think.
5. **S9 (a real successful run) may be seen as scope creep on an already-large spike.** I will not
   concede this one: seven arms proving a denial and none proving a completion is how a security
   slice ships an outage with a green ledger.
6. **ARCH-107 vs ARCH-177 (§2.7)** — a consumability lens will want the *effective* list rendered to
   the author, which is option (a) and a second silently-inert hop. I expect this to be the round's
   sharpest contract argument, and I hold (b) on ADR-084's own reasoning: the author has no in-band
   way to act on the list, so rendering it buys a surface and no decision.
7. **Where I expect immediate agreement**: `protectedFiles` from the loader; the grant rule
   widening; the event sink's late-bind cost; that the deletions and the re-walk wiring need an
   internal order; and that no UT in this slice may be cited as evidence that the confinement
   confines.

---

## 10. One-line headline

The design is sound in shape but ships three blocking boundary defects the architecture did not
have the measurements to see — **the REQ-021 re-walk as specified refuses every seeded run (the
engine `git init`s its own workspaces), `denyRead: [workRoot]` kills the agent's read of its own
workspace if deny wins, and every spike arm measures a denial while none measures that a real
workflow still completes** — so both arms of each spike-dependent field belong in the DES rows now,
and ARCH-107's 「rendered from the effective grant list」 has no wire to the server that renders it.
