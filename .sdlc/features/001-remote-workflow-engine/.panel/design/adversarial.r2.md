# Adversarial design group — REQ-218 / REQ-219 — Gate 4 (Design), debate round 2

**Lenses**: (a) interface-contract · (b) boundary/error · (c) testability. **Tie-break**: Karpathy.
**Read this round**: `design/quality-dimensions.r1.md` in full; re-measured every point where our two
proposals touch the same line of source. New measurements are tagged **N*** and cited by file:line.

**Verdict in one line**: we converge on almost everything they raised — I concede ARCH-107 (their
shape is better than my r1's static paragraph) and half of my own `allowRead` argument — I rebut
their reason-union widening and their boot-time capability probe **on measurements**, and my three
blocking findings (B1/B2/B3) went unanswered because they had not read them, not because they were
weighed and dismissed. One **new defect of my own r1** surfaced while checking theirs (§0.1) and it
is the sharpest item in this round.

---

## 0. Amendments to my own r1 (self-correction first)

### 0.1 **NEW, and it breaks two of my own rows: `reason:'terminal'` does NOT stop a retry.**

My r1 §3.5 wrote 「the re-walk refusal is `terminal`, never `transient` — retrying re-walks the same
tree」 and §3.7 mapped sandbox-unavailable to `terminal` for the same reason. Measured
(**N1**, `claude-agent-sdk-client.ts:507-518`): `invoke()`'s loop is

```ts
for (let i = 0; i < attempts; i++) { last = await this._invokeOnce(req);
  if (last.ok) return last;
  if (!last.ok && last.retryable === false) break; }
```

The retry gate is **`retryable === false`, not `reason`**. A `reason:'terminal'` failure without
`retryable:false` is retried `1 + retries` times. So both of my typed refusals, as I specified them,
retry: the re-walk re-walks an unchanged tree, and a host with no bubblewrap is asked to grow one,
each attempt burning the full `timeoutMs`.

**Amendment**: DES-256's refusal and the sandbox-unavailable failure both carry
**`retryable: false`** — and, in the same commit, the two doc comments that currently say `retryable`
is `false` 「ONLY on that classification」, i.e. only `classifyApiError`'s (`client.ts:164-168`,
`claude-agent-sdk-client.ts:514-515`), are corrected, because this slice gives the field two new
producers. Leaving them is ARCH-176's own bug class: a comment readers believe over the code. UT arm: a refused `invoke()` produces exactly **one** `_invokeOnce` entry —
assert on the injected `queryImpl`'s call count (zero calls for the re-walk arm, since it refuses
before `query()`; one for the unavailable arm).

### 0.2 **NEW consequence for ARCH-178, which both of our r1s got wrong in the same way.**

ARCH-178 says `agent.confinement` is emitted 「**once per `agent()` call**」 and quality-dimensions
builds its ordering rule on the same words. **N1 again**: the options literal (`:623-677`) lives in
`_invokeOnce`, *inside* the retry loop. With `retries` configured, one `agent()` call that fails and
retries emits **N confinement lines**, not one. Two honest resolutions, and the DES must pick:

- **(i) restate the contract as 「once per attempt」** and put `attempt` in the payload — the line then
  means what it says and a duplicate is information, not noise; or
- **(ii) hoist the emit above the loop** — which forces the builder to run once outside `_invokeOnce`
  and hands two consumers one object, a bigger diff for no operator benefit.

**I take (i)**, with its real cost stated so a task-splitter is not surprised: the loop index `i`
lives in `invoke()` and is **not** passed to `_invokeOnce`, so it is one extra integer *plus one
parameter on a private method*, and it must be a **new** counter — the existing `attempt`
(`:776`, `:798`) is `sys.attempt`, the **CLI's own internal backoff counter** off a system message,
and conflating two retry layers in one field is how a log line becomes unreadable. Even so (i) is
far smaller than (ii), and the log stops asserting something false. This
is a contract fix, not a preference — 「once per call」 is currently a claim no test can hold, i.e.
exactly the greener-than-green shape REQ-219 exists to delete.

### 0.3 **Partial retraction: `filesystem.allowRead` is not 「wrong in both directions」.**

My r1 §2.1.2 argued `allowRead` is either dead weight or actively fatal (locking the CLI out of
`/usr/lib`). Measured (**N2**, `sdk.d.ts:5863-5865`): *「`allowRead`: Paths to re-allow reading
within `denyRead` regions. **Takes precedence over `denyRead` for matching paths.**」* It is
**purely subtractive from a deny region** — never an independent whitelist. The whitelist reading I
feared belongs to `allowManagedReadPathsOnly` (*「When true (set in managed settings), only
`allowRead` paths from policySettings are used」*, `:5867-5869`), which we never set.

**Concede**: `allowRead` may be emitted unconditionally; it is harmless in `'enumerated'` mode.
**Hold** the other half: it is load-bearing in `'workroot'` mode, S7 must be run *with it set*, and
`allowManagedReadPathsOnly`'s **absence keeps its own UT assertion** so a later 「tighten the
sandbox」 edit cannot add it silently. Net: one row simpler than my r1 asked for.

### 0.4 S7 is documented-positive — and that does not move B2.

**N2** *is* the answer S7 goes looking for: the SDK documents allow-over-deny. I still **hold** B2's
ordering (ship `'enumerated'`, widen on a positive S7, then **delete** the losing arm). Reason, and
it is this slice's own thesis: M1 says the schema is `z.core.$loose` and ADR-082 itself records that
the block's doc comment 「contradicts the schema three lines below it」. A JSDoc line is the same
class of evidence as a green typecheck — a claim about the object, not an observation of the kernel.
What N2 changes is the *expectation*: S7 is now expected to pass, so the `'enumerated'` arm is a
short-lived guard rather than a likely permanent residual, and its deletion task is cheap to plan.

---

## 1. Point-by-point response to quality-dimensions r1

### 1.1 `failIfUnavailable` needs a labelled failure, not just a typed one — **CONCEDE the requirement, REBUT the mechanism**

They ask for a 4th `GatewayResult.reason` (`'sandbox_unavailable'`), arguing 「every existing
exhaustive `switch` becomes a compile error until updated, which is exactly the idiom this repo
already uses」. **Measured: that compiler pressure does not exist.** `grep -rn "switch (.*reason"
src` returns exactly one hit, `asset-sync.ts:125`, which switches on `PathVerdict.reason` — a
different type. There is **no** exhaustive `switch` on `GatewayResult.reason` anywhere in `src/`,
and no production branch compares it (`retryable`, not `reason`, drives every decision — N1).
So the union widening buys **zero** compile-time guarantees, and it does cost something: `reason`
is **persisted** into the `usage` transcript event's `data.reason` (`agent-executor.ts:431`), so a
new literal widens a stored vocabulary. (Stated precisely, because I checked: no `src/` file reads
`data.reason` back today — `grep -rn 'data\.reason' src` returns only `run-store.ts:136`'s unrelated
`reasonCode`. So the cost is future-facing, and the rebuttal rests on the measured leg above.)

Their *requirement* is right and I adopt it verbatim: **typed and labelled are different claims and
only the second is falsifiable**, and ADR-083's revisit trigger is phrased as 「an operator reports a
run refused for `sandbox unavailable`」 — a trigger nobody can grep for does not fire. My r1 §3.7
already asked for the detail string; **their bullet correctly says an ad-hoc string is not enough**.

**Converged design**: `{ ok:false, reason:'terminal', retryable:false, detail }` where `detail`
begins with a **constant exported from one module**, e.g.
`export const SANDBOX_UNAVAILABLE = 'sandbox unavailable';` — the same literal the ADR's trigger
sentence quotes — with (1) a UT asserting the emitted `detail` starts with the constant, (2) a
drift-lock test asserting the ADR's trigger sentence and the constant are the same string, and
(3) an assertion that `enrich()` (`:726`, fills `detail` only when `undefined`) cannot overwrite it.
That gives grep-ability **and** leaves the stored vocabulary alone.

**Gap neither of us named**: the gateway can only *apply* that label if the SDK's error result is
distinguishable from an ordinary terminal failure. **No spike arm covers this** — S6 measures that
*this* host has bubblewrap; nothing measures what `failIfUnavailable:true` produces on a host
without it. **Proposed S10**, phrased as the outcome needed rather than the method, because ADR-082 records a
`bwrapPath` literal in the resolved binary and the sandbox may therefore not resolve through `PATH`
at all: *on a host where the sandbox cannot start, is the failure distinguishable from an ordinary
terminal failure?* — record the exact `result` message shape; the spike owner picks how to produce
the condition. The DES specifies both outcomes now — distinguishable ⇒ mapped detail;
not distinguishable ⇒ ADR-083's trigger is unsatisfiable from the log and that is a recorded
residual, not a silent one.

### 1.2 ARCH-107's guide paragraph renders the live grant list — **CONCEDE the shape, HOLD two riders**

This is the disagreement I flagged in r1 §9.6 as the round's sharpest, and they win it. My r1's (b)
(static paragraph) rested on ADR-084: the author has no in-band way to *request* a grant, so the
list is state they cannot act on. That reasoning is wrong on inspection — an author who can read the
granted list can **write a script that stays inside it** (use the granted cache, or stay in the
workspace). That is an in-band decision, and REQ-117's cold-author protocol is precisely where it
pays. Their shape is also concretely cheaper than I estimated: `GuideCeilings`
(`authoring-guide.ts:33-48`) already carries two deployment-resolved fields (`aliases`,
`runConcurrency`) for exactly this reason, and `mcp-facade.ts:670` already spreads live values into
it. **Concede.**

Two riders I hold, plus one correction to their prescription:

- **(i) It is a second hop, and ARCH-177's premise is now false.** The value must travel
  `FileConfig.sandbox.allowHostPaths` → `composeConfig()` → `ServerConfig` → `createServer` →
  `McpFacade` — measured against how `runConcurrency` does it today (`main.ts:88` KNOWN-key table,
  `main.ts:249` the forward, `server.ts:119` the field, `server.ts:857` the facade construction,
  `mcp-facade.ts:108/268/289` the three declarations). ARCH-177's 「no `ServerConfig` field is minted
  for a value nothing else reads」 no longer holds — something else now reads it. Consequence for
  their own task 2: the `EXCLUDED` row in `compose-config-v2-wiring.test.ts` **flips to a forwarded
  row with its own hop-2 `it()`**, and the grant list is **one resolved array fanned out to two
  consumers, never re-derived** — the gateway's `confinement.allowHostPaths` and the facade's guide
  field must be assertably the *same* value. This is the `composeConfig` wiring bug class that has
  already bitten this repo twice (v11 `updateFlagPath`, v15 auth); the test is the price of the hop
  and it is not negotiable from my side. **And it is a living-document edit, by my own B1 standard**:
  ARCH-177's sentence is settled Gate-2 text, so conceding here means **ARCH-177 is amended in this
  gate** to resolve its conflict with ARCH-107 *toward* ARCH-107 — same shape as r1's R12, and it
  belongs on the synthesizer's amendment list, not in a reviewer's head.
- **(ii) Naming rider stands** (r1 §2.7): the section is titled after **host path grants**, never
  「sandbox」 — `authoring-guide.ts:432` already has a section literally titled 「The sandbox API」
  meaning the `node:vm` script sandbox. ARCH-175 refused to put the module under `src/sandbox/` to
  avoid this collision; re-importing it into the one document a cold author reads would be worse.
  Also **hold** their own disclosure invariant: the guide field's type is `readonly string[]` sourced
  from `sandbox.allowHostPaths` **only** — never `protectedFiles`, never `workRoot`.
- **Correction**: they write 「`DEFAULT_CEILINGS` supplies `[]`」. `DEFAULT_CEILINGS`
  (`params/contract.ts:89`) is a `Ceilings` — three fields, not a `GuideCeilings`. The `[]` lands at
  the two spread sites (`scripts/gen-authoring-md.ts:20` and `mcp-facade.ts:670`), same as
  `aliases`/`runConcurrency` do today. Small, but it is the difference between a one-line task and a
  wrong-file task.

### 1.3 A `GUIDE_EXAMPLES` entry demonstrating graceful EACCES handling — **REBUT (on mechanism, not on intent)**

`GuideExample` is `{title, script, mermaid, expectRegister:'ok'}` (`authoring-guide.ts:50-55`) and
the integration loop asserts the examples **register**. An `EACCES` occurs inside the *LLM's* Bash
tool result, at run time, in a subprocess — there is no workflow-script shape that can demonstrate
it, because the script never sees a tool result. An example that pretended to would be a guide
teaching an invalid example, which is the very rule (their rule 4) they invoke. **Their intent is
right and it has a real home**: the fact belongs in the ARCH-107 paragraph as prose, and its
*measurement* is REQ-117's cold-author protocol (ARCH-108) — where it costs nothing extra, because
that protocol already judges first-try authoring against the served guide.

### 1.4 Boot-time CLI capability probe — **SPLIT: concede one half, rebut the other**

- **「assert the resolved binary version/schema shape the spike measured against」** — **concede**,
  it collapses into my B4 (exact pin + version recorded in the `agent.confinement` payload) and they
  and I arrived at it from opposite directions, which is a good sign. One correction they need:
  they say 「pin the exact SDK version the spike ran against (2.1.278, already named in ADR-082)」.
  **Two different version surfaces** — `2.1.278` is the `claude` **binary** ADR-082 cites; our pin is
  the npm package `@anthropic-ai/claude-agent-sdk@^0.3.199` (`package.json:23`). Pinning the package
  pins the jail only if the executable travels inside it rather than being resolved off `PATH`
  (the gateway sets no `pathToClaudeCodeExecutable`) — r1 §3.4's one-line addition to S6. The
  `agent.confinement` payload should record **the binary's** version, not `package.json`'s.
- **「attempt one benign confined operation at boot」** — **rebut**. It needs a live `query()`: a
  model, a prompt, auth, a workspace. That is an LLM call on the boot path of a server whose whole
  admission story is that it boots without providers being reachable. ADR-083 already fails the
  **first** `agent()` call typed, loud and fail-closed; the probe buys the difference between
  「discovered at boot」 and 「discovered on the first run」 and pays for it with a boot-time network
  dependency and a new failure mode. Karpathy: no. Their own framing ("it costs one boot check, not
  a subsystem") understates the cost by exactly the query.

### 1.5 `WORKROOT_INSIDE_PROJECT` into `ERROR_CATALOG` — **REBUT, with the decision recorded either way**

Measured: `grep -n WORKROOT src/errors.ts` returns **nothing**, and `ERROR_CATALOG`'s two fields
(`see`, `hint`) are consumed by exactly `toErrEnvelope()`/`toErrorCode()` (`errors.ts:170-181`).
Neither path can reach this code: at boot it is a thrown `WorkRootInsideProjectError`
(`workroot-guard.ts:17-33`) that crashes the process before a facade exists, and in production
(ARCH-180's rescue) it surfaces as a `GatewayResult.detail` into the `usage` event
(`agent-executor.ts:431`) — never as a tool-call envelope. An entry now would be a catalog key
nothing routes to: taxonomy theatre in the slice that exists to delete exactly that.

**I do adopt their underlying ask**, which is that the code must not be three different literals:
export it **once** from `workroot-guard.ts` and have both the boot error class and the gateway's
`detail` use that constant. **Revisit trigger**, so this is a decision and not inertia (their fair
criticism): the first time this refusal is surfaced through `toErrEnvelope` to an MCP caller, it
joins the catalog with `see: null`.

### 1.6 Boot-refusal message for grant validation — **CONCEDE + integrate into DES-253**

Their 「fix the exact error object as a table so four `if`s don't ship four ad-hoc strings」 is the
same requirement as my DES-253's structured `GrantRefusal = {entry, rule}`. Integrated: the DES
carries **one table with one row per rule** (`NOT_ABSOLUTE` / `UNRESOLVABLE` / `INSIDE_WORKROOT` /
`COVERS_PROTECTED` / `GLOB`), each row giving the offending entry verbatim and a one-line remedy,
rendered by **one** formatter over the returned `GrantRefusal[]`, and **all** refusals reported (r1
§2.3). Their two riders (`rwe.config.example.json` gains a commented `"sandbox"` block; `DEPLOY.md`
§1 gains the config-reference row) are cheap and I add them to my task list. My widened rule (iii) —
**no entry inside `workRoot`, in either direction, via `isPathContained`** — stands; nothing in their
proposal conflicts with it, and without it `<workRoot>/cas` is grantable.

### 1.7 `protectedFiles` derivation, emit ordering, no carrier seam, no circuit breaker, spike evidence files, `FailureEnvelope` has no production importers, rescue-then-delete ordering — **AGREED, no argument to have**

Worth recording that we reached the emit-ordering rule (**refused call ⇒ zero `agent.confinement`
lines**) and the rescue-before-delete ordering independently, from an observability lens and a
boundary lens. Their 「a posture printed for a session that never ran is a nerve attached to nothing」
is a better sentence than mine for the same rule; take theirs. Their per-arm dated spike-evidence
files and the S1 `bwrap` setup-latency capture are strictly additive — adopted, extended to my S9 and
the new S10.

### 1.8 Their task split — **one structural rebut**

Their tasks 4/5/6 give ARCH-176 (the field), ARCH-178 (the emit) and ARCH-180's rescue (the re-walk)
to three different units. All three edit the **same ~55-line `Options` literal**
(`claude-agent-sdk-client.ts:623-677`), and this ledger's own CLAUDE.md records what ~20 concurrent
implementers do to one shared file. **One task owns that literal**, with its three edits as ordered
commits in §0.2/r1 §3.5's order. Their ordering *within* tasks 6 and 7 (rescue then delete, never the
reverse) is right and I keep it verbatim.

---

## 2. What their round did not address (unrebutted, and it changes their task list)

They had not read my r1, so their silence on these is not agreement. All three are still blocking,
and the synthesizer should treat them as open until someone argues them down:

- **B1 — the re-walk as specified refuses every seeded run.** `findProjectMarkerAncestor` tests the
  marker on `path` itself (`workroot-guard.ts:47-49`), the unwired module passes the **workspace**
  (`session-options-builder.ts:74,89`), and the engine runs `git init` in every seeded workspace
  (`run-manager.ts:735` → `workspace-git.ts:42-67`) while seed materialization deliberately does not
  strip `CLAUDE.md` (`path-verdict.ts:38-41`). **Their task 6 wires exactly this.** Fix unchanged
  from r1 §3.1: two checks — `isPathContained(realpath(workspace), workRoot)`, then the marker walk
  from `dirname(workspace)` — plus the six-arm UT table, plus the living-document amendments to
  Scenario (+1) #4, DES-031 and DES-106. Noted honestly again: with the walk started above the
  workspace the only directories it can trip on are engine-created intermediates
  (`<workRoot>/workflows/<name>/runs/…`, `workspace-gc.ts:38`), so the guard's true-positive domain
  is near-empty by construction. Wire it anyway (REQ-219's own standard), and **say so on the row**.
- **B2 — `denyRead:[workRoot]` is 「the agent cannot read its own workspace」**, not 「cross-run reads
  stay open」. Ship `'enumerated'`, widen on a positive S7, delete the loser. See §0.4 for what N2
  changes (the expectation) and what it does not (the ordering).
- **B3/S9 — eight arms measure a denial; none measures that a real workflow still completes.**
  Reinforced by a measurement their observability section would care about: `allowWrite` is
  documented as *「Merged with paths from `Edit(...)` allow permission rules」* (`sdk.d.ts:5850-5853`)
  and the block's own prose says filesystem restrictions 「come from your permission configuration」
  while the schema three lines below accepts the lists — ADR-082 already records that contradiction.
  With `allowUnsandboxedCommands:false`, whichever side wins decides whether `$TMPDIR`, `~/.npm`,
  `~/.cache` are writable, i.e. whether any real toolchain runs at all. S9 runs one SDLC-shaped
  workflow under the confinement and returns an EACCES inventory as **design input**.

---

## 3. Final position — DES rows, deltas from r1 marked

| DES | Row | Change this round |
|---|---|---|
| DES-251 | `buildBashConfinement(input): SandboxSettings`, pure | `allowRead` now emitted in **both** modes (§0.3); `allowManagedReadPathsOnly`-absent UT kept; `denyReadMode` still a parameter with no path from config, losing arm **deleted** after S7 |
| DES-252 | `confinement` block on `ClaudeAgentSdkGatewayConfig`, one call site | unchanged; `workRoot` required inside the optional block |
| DES-253 | `validateHostPathGrants(...) → {ok}|{refusals[]}` | + their refusal-message table, one formatter, all refusals; rule (iii) widened both directions |
| DES-254 | `protectedFiles` from the loader's actual path | unchanged (agreed by both lenses) |
| DES-255 | `bindEventSink`, no-op sink at construction; two `EngineEvent` kinds, no `AuditActor` | **+ `attempt` in the `agent.confinement` payload, contract restated as once per attempt** (§0.2) |
| DES-256 | `findProjectMarkerAboveWorkspace(workspace, workRoot, deps?)` + containment check | **+ `retryable:false` on the refusal; UT asserts `queryImpl` never called** (§0.1); shared `WORKROOT_INSIDE_PROJECT` constant, not an `ERROR_CATALOG` key (§1.5) |
| DES-257 | guide paragraph | **reversed**: live grant list per quality-dimensions, via one resolved array fanned to two consumers, `EXCLUDED`→forwarded row + hop-2 `it()`; titled 「host path grants」; never renders `protectedFiles`/`workRoot` (§1.2) |
| — | sandbox-unavailable surface | **new row**: `{reason:'terminal', retryable:false, detail: SANDBOX_UNAVAILABLE + …}`, constant exported once, drift-locked against ADR-083's trigger sentence (§1.1) |

**Spike**: S1–S8 as ADR-082 has them, **+ S9** (a real workflow completes; EACCES inventory)
**+ S10** (is a sandbox-unavailable failure distinguishable at all?), one dated evidence file per
arm, S1 also recording `bwrap` setup latency. Still task #1, blocking, remote host.

**Karpathy ledger for this round**: argued *out* — a 4th `reason` literal, an `ERROR_CATALOG` entry,
a boot-time confined-operation probe, a `GUIDE_EXAMPLES` entry that cannot exist, a carrier seam.
Argued *in* — one exported string constant, one `retryable:false`, one `attempt` integer, one
`GuideCeilings` field with its wiring test, two spike arms. Net production surface added over my r1:
about three lines; net removed: the static-paragraph fallback and half of my `allowRead` argument.

---

## 4. Remaining disagreements for the synthesizer

1. **Reason taxonomy** (§1.1): they want a 4th `GatewayResult.reason`; I want `terminal` +
   `retryable:false` + an exported detail constant. Tie-break evidence is on the table: zero
   exhaustive switches exist, and `reason` is a persisted vocabulary. If they can show one
   production consumer that must branch on it, I concede immediately.
2. **Boot-time confined-operation probe** (§1.4): conceded in its cheap form (version/pin), rebutted
   in its expensive form (a boot `query()`). If the owner values boot-time discovery over boot-time
   independence, that is an owner call, not a design call.
3. **ARCH-177's own sentence** (§1.2 rider i) is invalidated by the concession I just made and needs
   a Gate-2 amendment this round; I record it as an open item rather than assume a synthesizer will
   notice a premise going false inside a paragraph nobody edited.
4. **B1/B2/B3** remain unrebutted rather than agreed — they belong on the synthesizer's blocking
   list, and B1 in particular contradicts a settled Gate-2 scenario (Scenario (+1) #4), which is a
   correction the architecture could not have made without the measurements.
