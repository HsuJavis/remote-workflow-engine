# Design panel — Adversarial group (Interface-contract × Boundary/error × Testability), round 1

**Iteration**: v23 (REQ-101..106), Gate 3+4 merged (Tasks + Detailed Design).
**Read before writing**: `01-requirements.md` §v23 (REQ-101..106 + Round v23 A1–A3), `02-architecture.md`
§v23 slice (ARCH-077..086, ADR-015..022), `state.yaml` `tech_stack`, and the architecture panel's own
`.panel/architecture/{adversarial,quality-dimensions}.r{1,2}.md`.
**Independent proposal** — no other design-panel r1 file existed when this was written.
**Primary source read for this proposal** (line numbers verified today, not quoted from the ledger):
`src/gateway/client.ts`, `src/gateway/claude-agent-sdk-client.ts`, `src/gateway/litellm-proxy.ts`,
`src/types.ts`, `src/workflow-view.ts`, `src/mcp-facade.ts`, `src/workflow-catalog.ts`,
`src/params/contract.ts`, `src/clock.ts`, `src/errors.ts`,
`tests/unit/claude-agent-sdk-gateway-allowed-tools.test.ts` (UT-024), and
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.

**Proposed DES numbering**: the ledger's highest is `DES-119`, so this proposal uses `DES-120..DES-134`.
The synthesizer owns the final numbers; the *content* of each item is what I am proposing.

---

## 0. Altitude judgment (required before the lenses are applied)

`tech_stack` + REQ-101..106 make this **both** altitudes, and v23 is the iteration where that changes:

- **Plain system altitude (dominant, ~70% of the slice).** A SQLite table, a projection function, two
  MCP tool schemas, one HTTP route swapped for another, one config block, one deletion. `workflow_describe`
  is an ordinary read API and every one of my three lenses applies to it unchanged: a literal response
  contract, a closed error-code set, a pure function under unit test.
- **AI-agent-system altitude (new, and it is where the risk concentrates).** ARCH-079 makes the engine
  itself an LLM consumer for an internal control surface: the input is attacker-influenced (an author's
  script), the output is republished to principals who are forbidden from reading that input. My three
  lenses read *differently* here and I apply them at the agent altitude explicitly:
  - **Interface-contract** at agent altitude is not just "what type does the function return" — it is
    *what exactly goes on the wire to the provider, and what exactly is accepted back*. A model does not
    honour a TypeScript type. So the analyzer's contract must be asserted on the **built request object**
    and on the **post-gate string**, never on an intermediate the engine authored itself.
  - **Boundary/error** at agent altitude adds failure modes a plain function does not have: a
    syntactically valid but semantically wrong completion, a completion in prose instead of glyphs, a
    provider error payload that *echoes the request* (i.e. echoes the masked script), a hung session, and
    a tool-enabled session that does something. These need codes, not exceptions.
  - **Testability** at agent altitude splits in two: everything that can be made **model-free** must be
    (the gate, the projection, the note mapping, the queue), and the residue that genuinely needs a model
    is REQ-104's own real-run acceptance and nothing else. A test that mocks the model and then asserts
    the diagram is a test whose oracle is the mock.

The quality dimensions (observability/replaceability/consumability/self-sustainability) are the other
panel's lens; I touch them only where a contract or an error code is the mechanism.

**Karpathy tie-breaker, stated once up front and used throughout.** The architecture is already
disciplined (ADR-018 deleted a converged panel mechanism on simplicity grounds; ADR-021 folded a
component into an existing module). I am not going to propose new components. Every proposal below is
either (a) a *signature* the design must pin, (b) an *error code* the design must enumerate, (c) a
*seam* the design must inject, or (d) a **correction of something the architecture asserts that the code
contradicts**. Where I want a new field or a new parameter, I say which lens wants it, which lens objects,
and which way simplicity breaks the tie.

---

## 1. Summary

Ten proposals, in falling order of how much damage they prevent.

1. **`graphAnalyzer.tools: []` does not produce a tool-less analyzer on this deployment's own default
   path — it produces a Bash-enabled one.** Verified in primary source. ADR-020's central claim ("the
   default blast radius is nil") is **falsified** for `gateway:"sdk"` + a non-Anthropic model, which is
   exactly this deployment's real configuration (local Ollama `qwen2.5:7b`). This is the finding of the
   round and the design must close it in code, not in prose.
2. **`graphAnalyzer.retries` has no per-call channel in `GatewayClient.invoke()`.** `AgentOpts` carries
   `timeoutMs` but not `retries`; retries come from the *gateway's own* config. Unless the design pins
   the analyzer's own attempt loop as the sole retry mechanism, the key is either decorative (this
   engine's known wiring-defect class) or **multiplicative** with the gateway's.
3. **ADR-015's "phase names are already served to non-owners" is factually false.**
   `WorkflowPublicView` has no `phases` field. The consequence is *not* that v23 re-opens the mask —
   REQ-102/A3 explicitly authorises phase names in the diagram — but that AUTHORING.md's phase-name rule
   is the **sole control** over a **new** disclosure, not a residual note about an old one. The owner
   should be told, because nobody escalated it precisely because it looked free.
4. **`ARCH-077` names a mechanism that does not exist**: there is no `maxWorkflowVersions` *prune*. The
   ceiling **refuses** registration (`VERSION_CEILING_EXCEEDED`). Diagram rows therefore die in exactly
   one place — `deregister()`'s transaction — and the design must say so or the "derived data must not
   outlive its source" invariant is written against a phantom.
5. **The analyzer has no `cwd` channel either.** `invoke()` accepts `workspace`, not `cwd`; with no
   `workspace` the tool jail falls back to `this._config.cwd` (the server workRoot) and
   `settingSources: []`. ARCH-079's "an explicit scratch `cwd`" is not expressible through the existing
   interface. I propose isolation-by-omission (pass no `workspace`) rather than widening `invoke()`,
   and I state the internal lens conflict this creates rather than hiding it.
6. **Pin the closed `DiagramNoteCode` enum and the total `GatewayResult → noteCode` mapping**, including
   the case nobody has named: `GatewayResult.ok:true` returns `content: unknown`, so "the model returned
   something that is not a string" is a real, reachable, un-coded state.
7. **Pin `projectWorkflowDescribe`'s signature and its two-sided literal key oracle**, and notice that
   REQ-101 requires `versions` for *every* principal while today's non-owner projection drops it — so
   describe is a genuinely different projection, not a superset of `projectWorkflowForRead`, and the
   "cannot drift apart" test has to be written against the *secret-absence property*, not against object
   equality of two differently-shaped views.
8. **Pin four boundary states the architecture leaves open**: a pre-v23 version with no diagram row at
   all; whether `enabled:false` writes a row or synthesizes at read; `diagramStale` when `bindings_fp`
   is NULL; and what `workflow_regenerate_diagram` returns when the row is already `pending`.
9. **Testability: make the model-free share as large as the architecture already allows**, with a
   `schedule` seam that is `runInline` in tests, `FixedClock` for `generatedAt`, an injected `queryImpl`
   for wire assertions, and a single real-run item (REQ-104) that no unit test may be allowed to
   impersonate.
10. **Task-splitting**: three pairs of changes that must land in the *same* task or the wiring-defect
    class recurs, and one that must land *before* its sibling.

---

## 2. Key points

### 2.1 DES-120 — the analyzer's outbound request is pinned as a literal object, and `curateToolsForProvider` must preserve an intentionally-empty tool set

**This is the round's headline finding. It is verified, not inferred.**

`src/gateway/claude-agent-sdk-client.ts:478-487`:

```ts
const baseTools =
  (req.opts as AgentOpts & { allowedTools?: string[] }).allowedTools ??
  this._config.defaultAllowedTools ??
  BUILT_IN_CORE_TOOLS;                                    // ['Read','Write','Edit','Glob','Grep','Bash']
const curatedTools = curateToolsForProvider(baseTools, effectiveProvider(this._config.aliases, req.opts.model));
```

and `:223-227`:

```ts
export function curateToolsForProvider(tools: string[], provider: string | undefined): string[] {
  if (provider === undefined || provider === 'anthropic') return tools;
  const filtered = tools.filter((t) => !NON_ANTHROPIC_EXCLUDED_TOOLS.has(t));
  return filtered.includes('Bash') ? filtered : [...filtered, 'Bash'];
}
```

Therefore **`curateToolsForProvider([], 'ollama') === ['Bash']`**, and the built session sets both
`allowedTools: ['Bash']` and `tools: ['Bash']` (`:556-563`). ADR-020 chose `tools: []` so that "the
default blast radius is nil" and concluded "the analyzer needs no process sandbox, because it executes
no user code". On the engine's **own default path** (`gateway:"sdk"`, per `state.yaml`) with the
deployment's **own real model** (a non-Anthropic Ollama alias), the analyzer ships with a Bash tool,
auto-approved by a bare `allowedTools` entry, on a session whose prompt is attacker-authored script
text, reachable by anyone who can call `workflow_register`.

The jail is not nothing but it is not what ADR-020 assumed either: `canUseTool:
makeCanUseTool(req.workspace ?? this._config.cwd)` — with no `workspace` the boundary is the **server
workRoot**, which contains every other run's workspace and journal; and the file's own docblock
(`:246-248`) records that with *neither* `req.workspace` nor a configured `cwd` there is "nothing to
enforce against, allow".

**Two checks I ran so the fix is not itself a guess:**

- The SDK's own `Options.tools` doc (`sdk.d.ts:102-105`) states: *"`[]` (empty array) — Disable all
  built-in tools."* So an empty set is honoured by the SDK and means what we want it to mean.
- UT-024's "must be non-empty" assertion
  (`tests/unit/claude-agent-sdk-gateway-allowed-tools.test.ts:91-105`) applies **only** to the
  no-per-call-opts, no-config **fallback** case. It does not pin that an explicit per-call `[]` becomes
  non-empty. So the fix collides with no existing invariant.

**Proposal (DES-120), three parts, all in one task:**

1. `curateToolsForProvider(tools, provider)` gains one line at the top:
   `if (tools.length === 0) return [];` — *an explicitly empty tool surface is an intent, not an
   omission.* This is a general latent-bug fix, not analyzer-specific; the Bash-injection branch exists
   to repair a *curated* set, and there is nothing to repair in an empty one.
2. `GraphAnalyzer` passes its config's `tools` through the **existing off-schema field name**:
   `opts: { model, timeoutMs, allowedTools: cfg.tools }`. Pin this in the design in so many words,
   because the config key REQ-104 mandates is `tools` and the wire field is `allowedTools`; a
   design that maps `cfg.tools → opts.tools` type-checks (both are `string[]` on a cast object), passes
   every unit test that inspects the analyzer's own inputs, and silently gets
   `defaultAllowedTools ?? BUILT_IN_CORE_TOOLS`. That is `composeConfig`-class drift with a security
   payload.
3. **UT (model-free), the load-bearing one**: inject `queryImpl` / `vi.mock` the SDK exactly as UT-024
   does, run the analyzer with a **non-Anthropic alias**, and assert the built `options` object
   **literally**: `tools` `[]`, `allowedTools` `[]`, `settingSources` `[]`, `strictMcpConfig` `true`,
   `mcpServers` empty, `thinking` disabled, `abortController` present. Two-sided: a new tool appearing
   fails, and a dropped `settingSources` fails. Per the ledger's carried-in rule 1 the oracle is the
   literal expected object, never "whatever the analyzer computed".

**Residual, stated not hidden:** if an operator sets `graphAnalyzer.tools: ['Read']`, the same curation
turns it into `['Bash']` for a non-Anthropic provider. ADR-020 already classes non-empty as an
operator-accepted risk announced at boot; the design should make the boot warning name the **effective
post-curation** set, not the configured one, because those differ and the operator is accepting the
effective one.

### 2.2 DES-121 — the analyzer owns the only retry loop; the gateway's own is neutralised, and the worst-case call count is written down

`AgentOpts` (`src/types.ts:44-63`) has `timeoutMs` but **no `retries`**. The SDK client computes
`attempts = effTimeout !== undefined ? 1 + Math.max(0, this._config.retries ?? 0) : 1`
(`claude-agent-sdk-client.ts:452-453`) — retries are a property of the **gateway instance**, shared with
every user-facing `agent()` call. There is no per-call channel.

This gives three concrete design obligations:

- **`graphAnalyzer.retries` is implemented as the analyzer's own attempt loop.** ARCH-079 invariant (3)
  already says the analyzer's retries are "the only retry mechanism in the design"; the design must say
  *how*, because the obvious implementation (pass it in `opts`) is not expressible.
- **The worst case is multiplicative and must be documented**:
  `attempts = (1 + graphAnalyzer.retries) × (1 + gatewayConfig.retries)`, each bounded by
  `graphAnalyzer.timeoutMs`. With the default gateway retries and `graphAnalyzer.retries: 2` that is a
  6× spend amplification on a failing provider, per registration. **Default `graphAnalyzer.retries: 0`**
  and state the formula in DEPLOY.md.
- **`timeoutMs` is passed per call and is honoured** — `resolveTimeout(req.opts.timeoutMs) ?? this._config.timeoutMs`
  (`:466`) plus a real `AbortController` + timer (`:471-472`) and a raced session (`:624-634`). Note that
  `state.yaml`'s Gate 7.5 round-3 defect (b) — "the gateway has no `timeoutMs`-bounded race of its own"
  — is **fixed in the code as it stands today**; I verified the race exists. The design should not
  re-litigate it, but the analyzer must still pass `opts.timeoutMs` explicitly rather than relying on the
  gateway default, because REQ-102 says the analyzer is bounded by **its** configured `timeoutMs`.

**UT (model-free)**: a `queryImpl` that never resolves + a fake timer ⇒ the row settles
`unavailable/TIMEOUT` within `timeoutMs`, and the model was called exactly `1 + retries` times. Asserts
the count literally.

### 2.3 DES-122 — analyzer isolation is achieved by omission, and the design says which omissions are load-bearing

`invoke()`'s signature is
`{prompt, opts, runId, agentId, signal?, workspace?, onHarness?, onEvent?}` (`gateway/client.ts:93-97`).
There is **no `cwd` parameter**. ARCH-079 asks for "an explicit scratch `cwd` that is not
CLAUDE.md/MEMORY.md-reachable"; that is not expressible without widening the interface.

What the code actually does (`claude-agent-sdk-client.ts:493-499`, `:556-568`):

| passed | effect |
|---|---|
| `workspace` set + `assetRoot` set | `materializeAssets()` into it, `settingSources: ['project']`, `cwd` re-scoped, `canUseTool` jailed there |
| `workspace` omitted | no asset materialisation, **`settingSources: []`** (no filesystem settings loaded at all), `cwd = this._config.cwd`, `canUseTool` jailed to that |

**`settingSources: []` is the actual guard against the recorded workroot/MEMORY.md leak class** — it is
what stops any project/user/local settings, skills or plugin MCP config from being loaded. Passing a
scratch `workspace` would *turn that guard off* (`['project']`) in exchange for a tighter path jail on a
tool surface that DES-120 has already made empty. So:

**Proposal**: the analyzer passes **no `workspace`, no `onEvent`, no `onHarness`, no `signal`-from-a-run,
and no `SecretValueProvider`**, and the design records each omission with the property it buys:
`workspace` ⇒ `settingSources: []`; `onEvent`/`onHarness` ⇒ no transcript events exist to persist
(ADR-016); a synthetic `runId`/`agentId` (`analyzer:<name>@<version>:<attempt>`) ⇒ never joins a real
run's records. A UT asserts the built request object's **absent keys**, which is the only way an
omission-based control is testable at all.

**Internal conflict, argued not buried** — see §5.1.

### 2.4 DES-123 — `GatewayResult` → `DiagramNoteCode`: one total mapping function, one closed enum, `content: unknown` included

`GatewayResult` (`gateway/client.ts:61-79`) is:
`{ok:true, provider, model, tokens:{input,output}, content: unknown, events?}` |
`{ok:false, provider, reason:'timeout'|'unreachable'|'terminal', detail?, events?}`.

Two things follow that the architecture does not name:

- **`content` is `unknown`.** "The provider succeeded and returned a non-string / an empty string" is a
  reachable state with no code. It must not fall into `GATE_REJECTED_SHAPE` (that code is defined as the
  *replaceability* signal for a degraded model) and it must not throw.
- **`detail` on the failure branch is provider text** and ADR-016 forbids provider text on every channel.
  So `detail` is consumed **only** to pick a code, never stored, never journalled, never rendered.

**Proposal (DES-123)** — a pure, exported, total function
`noteCodeFor(res: GatewayResult | {kind:'gate'; reason: GateReason} | {kind:'queue'} | {kind:'disabled'}) → DiagramNoteCode`,
plus the closed enum, asserted literally (carried-in rule 1 forbids inferring it from two branches):

```ts
export type DiagramNoteCode =
  | 'TIMEOUT'               // ok:false reason 'timeout'
  | 'PROVIDER_UNREACHABLE'  // ok:false reason 'unreachable'
  | 'PROVIDER_ERROR'        // ok:false reason 'terminal'
  | 'MALFORMED_COMPLETION'  // ok:true, content not a non-empty string
  | 'GATE_REJECTED_CONTENT' // ARCH-080, security event
  | 'GATE_REJECTED_SHAPE'   // ARCH-080, replaceability event
  | 'QUEUE_FULL'            // ARCH-079 inv. 2
  | 'RETRIES_EXHAUSTED'     // boot sweep's second failure; analyzer loop exhausted
  | 'DISABLED'              // graphAnalyzer.enabled === false
  | 'NOT_GENERATED';        // no row exists (pre-v23 version) — see DES-127
```

and `diagramNote: string` is rendered from this enum by a second pure function
`noteTextFor(code): string`, so the human-readable note is engine-authored by construction (ADR-016) and
literally assertable. **UT**: `Object.keys(NOTE_TEXT).sort()` equals the enum, so a new code without a
message is a red test rather than an `undefined` in a user-facing field.

`status` follows mechanically: `TIMEOUT|PROVIDER_*|MALFORMED_COMPLETION|GATE_*|QUEUE_FULL|RETRIES_EXHAUSTED|DISABLED|NOT_GENERATED → 'unavailable'`;
only a gate-passed diagram is `'ready'`. Invariant (4) of ARCH-077 (`diagram` NULL unless `ready`) is
enforced by the *writer's* signature, not by a CHECK constraint alone:
`putDiagramResult(name, version, r: {status:'ready'; diagram: string; generatedAt: string; bindingsFp: string} | {status:'unavailable'; noteCode: DiagramNoteCode; generatedAt: string; bindingsFp: string})`
— a discriminated union means "unavailable with a diagram" does not type-check. Add the SQLite CHECK too;
belt and suspenders is cheap here and the table is written from one module.

### 2.5 DES-124 — `gateDiagram`'s tokenisation is the contract, and it must be specified, not left to the implementer

ARCH-080 gives the signature but the *hard* part is unstated: what is a "label token"? An allowlist gate
whose tokeniser is under-specified is a gate that either rejects every valid diagram or passes
`SECRET` glued to a box glyph.

**Proposal (DES-124)** — pin the algorithm in the design, in this order:

1. **Codepoint pass first.** Every codepoint of `raw` must be in `DIAGRAM_CODEPOINTS`
   (printable ASCII `0x20-0x7E` + `\n` + the named glyphs `◇ ⟲ ─ │ ┬ ┴ ├ ┤ ▶ ╭ ╮ ╰ ╯`). A failure is
   `GATE_REJECTED_SHAPE`. Explicitly excluded and explicitly tested: C0/C1 controls, `\r`, `\t`, ESC/CSI,
   RTL/LTR overrides (`U+202A-202E`, `U+2066-2069`), zero-width (`U+200B-200D`, `U+FEFF`), NBSP.
2. **Size pass.** `maxBytes` (UTF-8 byte length, not `.length`) and `maxLines` (`\n` count + 1) ⇒
   `GATE_REJECTED_SHAPE`. Defaults proposed: `maxBytes: 8192`, `maxLines: 120`.
3. **Token pass.** Strip every glyph and box-drawing character, split the remainder on
   `/[^A-Za-z0-9_.:@\/-]+/`, drop empty tokens, and require **every** remaining token to be a member of
   `allowedLabels` ⇒ else `GATE_REJECTED_CONTENT`. Matching is **exact and case-sensitive**; no prefix,
   no substring, no normalisation. (`allowedLabels` is built by the caller from the engine's own static
   scan, so its casing is the engine's.)
4. Return the **verbatim** `raw` on success — the gate is a validator, never a transformer. A gate that
   also rewrites is a gate whose output nobody has validated.

**Why exact-and-total matters**: the requirement is a content-*absence* claim. A tokeniser that skips
"punctuation-ish" runs is how `api_key=sk-abc123` becomes three tokens of which two are allowed and one
is silently dropped. **UT** (model-free, and this is where REQ-102/A3's security invariant actually
lives): feed hostile strings — the secret literal bare, the secret glued to a glyph
(`╭─sk-live-abc123─╮`), the secret inside an otherwise perfect diagram, an ANSI escape, a zero-width
space between allowed characters, an 80MB line — and assert the **exact reason code** for each.

### 2.6 DES-125 — `projectWorkflowDescribe` is a *different* projection from `projectWorkflowForRead`, and the "cannot drift" test must be written against the property, not the object

Verified in `src/workflow-view.ts:33-70`: `WorkflowPublicView` is
`{name, version, channels, description, params, owner, reportProblem, validation:{ok}, scriptWithheld:true}`.
It has **no `versions`**, **no `phases`**, **no `skeleton`**, **no `createdAt`**.

REQ-101 requires describe to carry `versions` and channel pointers **for any principal**. So describe is
**not** a superset of the masked `workflow_get` and **not** its subset — the two overlap. ARCH-081's
demand that the two masks "cannot drift apart" therefore cannot be tested by comparing the two objects.

**Proposal (DES-125)**, the signature and the oracle:

```ts
export interface WorkflowDescribeView {
  name: string; version: string;
  resolvedBy: 'version' | 'channel' | 'default-release';
  channels: { release: string | null; beta: string | null };
  versions: string[];
  description: string;
  params: unknown;               // the REQ-090 contract, already ceiling-bounded
  lockedKeys: readonly string[]; // = LOCKED_KEYS from params/contract.ts — imported, never re-typed
  owner: string | null;
  reportProblem: string;
  triggers: TriggerBinding[];    // always LIVE (ARCH-078)
  diagram: string | null;
  diagramStatus: 'ready' | 'pending' | 'unavailable';
  diagramNote: string;
  diagramGeneratedAt: string | null;
  diagramStale: boolean;
}
export function projectWorkflowDescribe(
  full: WorkflowOwnerView,
  ctx: { diagram: DiagramRow | null; bindings: TriggerBinding[]; bindingsFp: string },
): WorkflowDescribeView;   // pure; no clock, no I/O, no auth
```

Three deliberate signature calls:

- **No `viewerIsOwner` parameter.** ARCH-081 lists one, but the type contains no owner-only field, so a
  parameter that cannot change the output is a parameter that will eventually be *made* to change the
  output. Dropping it makes "there is exactly one describe response, and every principal gets it"
  a signature-level property. (If the owner later overrules the `owner`-field decision, the parameter
  comes back **together with** a change to `workflow_get` — argued in §5.4.)
- **`lockedKeys` imports `LOCKED_KEYS`** from `src/params/contract.ts:8`
  (`['prompt','tools','skills','mcp','workdir','cwd']`) rather than re-declaring six strings. A second
  copy of a list whose whole job is to be authoritative is the drift class this ledger keeps recording.
- **`channels` is `{release: string|null; beta: string|null}`**, not `Record<string,string>`. v22 had to
  double-cast a nullable channel pointer through a non-nullable type
  (`mcp-facade.ts:300-305`); a new type has no compatibility reason to repeat that, and
  `CHANNEL_UNPUBLISHED` exists precisely because `null` is a real value.

**The two oracles, both required:**

1. `expect(Object.keys(deepFlatten(resp)).sort()).toEqual(EXPECTED_DESCRIBE_KEYS)` — exported from
   `workflow-view.ts` next to `EXPECTED_NON_OWNER_KEYS`, the pattern v22 already established. Two-sided.
2. **The anti-drift test is a shared *property*, not an object compare**: one secret-bearing script,
   registered once; the test calls `workflow_get` (non-owner), `workflow_describe`, `GET /api/workflows/:name`,
   and `GET /api/workflows/:name/describe`, and asserts the **exact secret literal** is absent from
   `JSON.stringify` of all four. Table-driven over the four surfaces so adding a fifth surface without
   adding a row is visible. Per carried-in rule 1: assert the *literal* absent, never
   `not.toContain(theWholeScript)`.

### 2.7 DES-126 — `workflow_describe`'s error contract is the existing one, unchanged and re-asserted

`resolveVersionRequest` (`workflow-catalog.ts:59-89`) already returns
`'INVALID_CHANNEL' | 'UNKNOWN_VERSION' | 'CHANNEL_UNPUBLISHED' | 'DANGLING_CHANNEL'`, and
`getWorkflow`'s own path throws `codedError('UNKNOWN_VERSION', …)` (`:485`). REQ-101 names only
`CHANNEL_UNPUBLISHED`. Two boundary calls the design must make rather than leave to the implementer:

- **`workflow_describe` reuses `resolveVersionRequest` verbatim and surfaces all four codes**, plus
  `WORKFLOW_NOT_FOUND` for an unknown name. Do **not** collapse `DANGLING_CHANNEL` into
  `CHANNEL_UNPUBLISHED`: they are different operator faults (a pointer to a pruned version vs an
  unpublished channel) and the ledger's own note at `:421` shows this codebase has already thought about
  when collapsing is right (`getWorkflow` collapses to `WORKFLOW_NOT_FOUND` when the *name* is unknown —
  a different case).
- **A table-driven UT over the resolve truth table** (`{version}`, `{channel:'beta'}`,
  `{channel:'release'}`, `{}`, unknown version, unpublished beta, dangling pointer, both selectors) that
  asserts describe's code **equals** run-admission's code for the same input. One table, two call sites —
  that is the only structural way REQ-101's "resolve by REQ-097's exact order" stays true after someone
  edits one of them.
- **`workflow_regenerate_diagram`**: `NOT_WORKFLOW_OWNER` via the existing `resolveWritePrincipal`
  (`server.ts:822`), `WORKFLOW_NOT_FOUND`, `UNKNOWN_VERSION`, and a new `ANALYZER_DISABLED` when
  `graphAnalyzer.enabled === false` — because returning a cheerful "queued" for a job that will never run
  is exactly the dishonesty A1 exists to forbid. `version` is **required** on this tool (ARCH-082's
  signature already has it non-optional) so nobody regenerates "whatever release currently points at" and
  is surprised.

### 2.8 DES-127 — four boundary states the architecture leaves open, each pinned

| # | State | Proposal | Why |
|---|---|---|---|
| B1 | **A version registered before v23** has no `workflow_diagrams` row at all. The boot sweep only requeues `pending` rows. | `getDiagram` returns `null`; describe emits `diagramStatus:'unavailable'`, `noteCode:'NOT_GENERATED'`, `diagramGeneratedAt:null`, `diagramStale:false`. **No boot backfill.** Recovery is the owner's explicit `workflow_regenerate_diagram`. | A backfill is N workflows × one LLM call, triggered by an *upgrade* with no owner action and no principal to attribute the spend to. That is the "every read might trigger a model call" failure ADR-017 rejected, moved to boot. |
| B2 | **`graphAnalyzer.enabled: false` at registration** — row written, or synthesized at read? | **Write no row.** Describe synthesizes `unavailable/DISABLED` from `enabled===false` + missing row; `NOT_GENERATED` is only for a missing row while `enabled===true`. | A persisted `DISABLED` row is a lie the moment the operator flips the flag back on; the config is the live truth. One rule: *the row is written only by an attempt*. |
| B3 | **`diagramStale` when `bindings_fp` is NULL** (any non-`ready` row, and B1/B2). | `diagramStale = (row?.status === 'ready') && (liveBindingsFp !== row.bindings_fp)`. Otherwise `false`. | Otherwise every absent diagram reads "stale", the flag stops meaning anything, and REQ-103's machine-checkable promise degrades to noise. |
| B4 | **`workflow_regenerate_diagram` while the row is already `pending`** (queued, or another regenerate in flight). | Return `{queued:false, status:'pending'}` — accepted, idempotent, **no second job enqueued**. Single-flight is per `(name, version)`, not merely global concurrency 1. | Without a per-key guard, N regenerate calls become N model calls behind a depth-capped queue; ADR-017's "one shot per invocation" is about the *invocation*, and the key-level guard is what makes it true. |

Also pin **B5**: `enqueue()` on a `(name, version)` that already has a `ready` row (i.e. a re-register can
never hit this, since versions are append-only — but `regenerate` can) **overwrites** on success and
**leaves the old row untouched** on failure. A failed regenerate must not destroy a working diagram.
That is one `if` in `putDiagramResult`'s caller and it is the difference between "recovery action" and
"foot-gun".

### 2.9 DES-128 — `getTriggerBindings` signature, the `ports` seam, and the `null` upstream

ARCH-078's `ports = {schedules, webhooks, continuations, runs}` is the right shape and it is the whole
testability story for REQ-103 (three separate SQLite *files* + a `RunStore` join is not something a unit
test should have to stand up). The design should pin the **narrowest possible port interfaces** —
structural types with one method each, not the store classes:

```ts
export interface TriggerPorts {
  schedules:     { listByWorkflow(name: string): Array<{cron: string; tz?: string; enabled: boolean}> };
  webhooks:      { listByWorkflow(name: string): Array<{enabled: boolean}> };   // NEVER the row: no secret, no id
  continuations: { listPendingByWorkflow(name: string): Array<{afterRunId: string}> };
  runs:          { getWorkflowName(runId: string): string | null };
}
export function getTriggerBindings(name: string, ports: TriggerPorts):
  { bindings: TriggerBinding[]; bindingsFp: string };
```

Three points my lenses insist on:

- **The webhook port's return type has no `secret` and no `id` fields at all.** ARCH-078 says the
  projection "constructs from an explicit field list"; making it a *type* means a future edit that
  returns the row is a `tsc` error rather than a review item. This is the same "absent from the type"
  discipline ARCH-081 applies to `script`, applied to the credential that actually reaches a provider.
- **`bindingsFp` is `sha256` over a canonicalised form**, and the canonicalisation must be pinned or the
  flag flaps: sort by `(kind, cron|'', upstreamWorkflow|'')`, JSON with a fixed key order,
  `upstreamWorkflow: null` serialised as `null` (not omitted). **UT**: two calls with the underlying rows
  returned in different orders produce the same fp; adding a schedule changes it.
- **`upstreamWorkflow: null` is a first-class rendering**, not an error: the continuation's `afterRunId`
  run may have been purged. The diagram renders an unnamed chain entry. A UT feeds a `runs` port that
  returns `null` and asserts the binding is still emitted.

### 2.10 DES-129 — the analyzer's journal line is a typed record, and `promptTokens`/`completionTokens` come from `GatewayResult.tokens`

ARCH-079 invariant (5) pins the field list
`{name, version, principal, model, promptTokens, completionTokens, durationMs, outcome, noteCode}`. Two
contract notes: `GatewayResult` calls them `tokens.{input,output}` — the design should either adopt the
existing names or state the rename once, and I propose **adopting `input`/`output`** so no mapping exists
to get backwards. And `principal` on an *async* job is the registering principal captured **at enqueue
time**, not read at completion (the request is long gone). Pin it as a field on the queued job.

**UT**: a failing `queryImpl` whose error message contains the secret literal ⇒ the emitted journal line,
`JSON.stringify`d, does not contain it, and `noteCode` is `PROVIDER_ERROR`. This is the concrete test for
ADR-016's "closing the diagram channel while leaving the log channel open would be decorative".

---

## 3. Primary-source corrections to `02-architecture.md`

The architecture itself set the precedent of recording primary-source corrections (ARCH-078 records
three). These four are mine. **I did not edit `02-architecture.md`** — they are here for the synthesizer.

### 3.1 There is no `maxWorkflowVersions` prune (ARCH-077, ADR-018)

ARCH-077 says `deregister()` "and the `maxWorkflowVersions` prune each delete this name's/version's
diagram rows". Verified in `workflow-catalog.ts:342-346`: the ceiling **refuses** the registration —
`VERSION_CEILING_EXCEEDED: workflow '<name>' already has N version(s) (maximum M) — deregister an old
version, or raise the engine's maxWorkflowVersions ceiling`. ADR-014 says the same ("no GC"). **There is
no prune to ride.**

Consequences for the design: (a) diagram rows are deleted in exactly one transaction —
`deregister()`'s at `:389`; (b) `listPendingDiagrams()` is the only sweep and it is bounded by the number
of `pending` rows, not by a GC; (c) ADR-018's cost argument survives but its mechanism sentence needs
rewording — the ceiling bounds the *number of registrations*, and it does so by refusing, so the
worst-case analyzer spend for one name is `maxWorkflowVersions` initial calls **plus unbounded
owner-initiated regenerates**. The second half is new and belongs in the design's cost note.

### 3.2 ADR-020's "default blast radius is nil" is falsified on the default path

See §2.1. Not a wording problem — a code fix plus a wire-level UT.

### 3.3 ADR-015/ARCH-080's "phase names are already served to non-owners" is false, and the consequence is a disclosure the owner was never asked about

Verified: `WorkflowPublicView` (`workflow-view.ts:33-43`) has no `phases`; the non-owner branch of
`workflow_get` builds a full owner view and projects it down (`mcp-facade.ts:297-316`), dropping `phases`
and `skeleton`; and the `/skeleton` route's own comment (`server.ts:1079`) says "skeleton/phases are
script-derived and masked".

**The correct framing** — and I want to be precise, because the wrong framing would be rejected and
should be: this is **not** v23 re-opening REQ-100's mask. REQ-102/A3 is owner-ratified and it
*explicitly* lists "phase names" as diagram content. The disclosure is **authorised**. What is wrong is
the *rationale*: ADR-015 and ARCH-080 both dismiss the phase-name residual as "pre-existing exposure, not
a v23 regression", and on that basis it is documented in AUTHORING.md rather than controlled. It is not
pre-existing. It is **new**, and AUTHORING.md — a document — is its **sole** control.

**Proposal**: keep A3's decision (it is the owner's), keep the AUTHORING.md rule, and change three things.
(1) The design states plainly that `workflow_describe` is the **first** surface to serve
`meta.phases[].title` to a non-owner. (2) The Decision-rationale entry flags it for the owner at review,
because nobody escalated it — the false "pre-existing" premise is exactly why. (3) The
secret-bearing-script test grows one case: a secret **in a phase name** is asserted to appear in the
diagram (documenting the accepted behaviour as a *pinned* behaviour, so if the owner overrules it the test
turns red and names the decision) — or, if the owner prefers, `allowedLabels` drops phase names and the
diagram loses phase labels. That is a one-line change to the allowlist builder, which is precisely why
this is worth asking now rather than after implementation.

### 3.4 ARCH-079's "explicit scratch `cwd`" is not expressible through `invoke()`

See §2.3. The interface has `workspace`, not `cwd`. The design must choose omission (my proposal) or
widen the interface (which I argue against in §5.1).

---

## 4. Testability plan (lens (c)), stated as "which tier proves which REQ"

The rule I am applying: **every DES must be coverable by a UT, and the model must be absent from every
UT.** The one exception is REQ-104, which the requirement itself says a unit test cannot prove.

| Seam | Injection | Used by |
|---|---|---|
| `clock: Clock` | `FixedClock` (`src/clock.ts`) | `generatedAt` is a fixed literal in every assertion — no `expect.any(String)` |
| `schedule?: (job) => void` | test passes `runInline` (await the job); prod default `setImmediate` | the async job is deterministic; ARCH-079 inv. 8 |
| `queryImpl` / `vi.mock('@anthropic-ai/claude-agent-sdk')` | UT-024's existing pattern | wire-level assertions (DES-120), failure injection (DES-121, DES-129) |
| `gateway: GatewayClient` | a hand-written stub returning a literal `GatewayResult` | the whole `noteCodeFor` mapping (DES-123) with zero SDK involvement |
| `ports: TriggerPorts` | plain object literals | `getTriggerBindings` + fingerprint (DES-128) — no SQLite at all |
| `Database` | the catalog's existing in-memory-db test pattern | `workflow_diagrams` CRUD + the `deregister` transaction |

**Model-free coverage claim, per REQ:**

- **REQ-101** — UT: `projectWorkflowDescribe` key oracle + the four-surface secret-absence table. IT: the
  MCP tool and the HTTP route return the identical object.
- **REQ-102** — UT: `gateDiagram` hostile-input table (§2.5); the `(name, version)` PK never serving
  across versions; `enqueue` returns before the job runs (registration does not block); the note/status
  mapping. **Real-tier**: one registration against the live analyzer producing a `ready` diagram.
- **REQ-103** — UT: `getTriggerBindings` composition, canonical fingerprint, `upstreamWorkflow: null`,
  `diagramStale` true/false/`false`-when-not-ready.
- **REQ-104** — UT: the `composeConfig` wiring row (mandatory, same change, `compose-config-v2-wiring.test.ts`)
  + the defaults table. **Real-tier and only real-tier for the acceptance**: edit `systemPrompt`,
  re-register, diagram visibly changes, no redeploy. **The design must forbid a UT that claims to prove
  REQ-104** — a unit assertion on a value read off the same broken path is the defect this REQ is named
  after.
- **REQ-105** — the ADR-022 grep guard, plus a schema-level assertion that no advertised tool description
  or input schema contains `skeleton`. Both are UTs and both are two-sided (the allowlist is exactly three
  entries; a fourth fails).
- **REQ-106** — a UT asserting `workflow_register`'s `script` parameter description contains the pointer
  and the rules, joined to ARCH-051's drift-lock.

**One anti-test rule to write into the design**, because this ledger has produced an instance in each of
the last two iterations: *no v23 test may compute its expected value with the function under test.* The
places at risk are the describe key list (compute it from the type ⇒ vacuous), `bindingsFp` (assert
"equal to itself" ⇒ vacuous), and the gate (assert "the gate accepted what the gate produced" ⇒ vacuous).
All three expected values are literals in the test file.

---

## 5. Internal conflicts between my own three lenses (argued, not smoothed)

### 5.1 Interface-contract wants an explicit `cwd`; boundary/error says optional parameters are this repo's silent-default bug class; simplicity breaks the tie

**Interface lens**: ARCH-079 asserts a security property ("a scratch cwd not MEMORY.md-reachable") that
the interface cannot express. An interface that cannot express its own guarantee is a bad interface; add
`cwd?: string` to `invoke()`.
**Boundary lens objects**: an *optional* parameter with a fallback (`req.cwd ?? this._config.cwd`) is
precisely the shape that produced `updateFlagPath`, `auth`, and `workspaceTtlMs` — a caller that forgets
it gets the old behaviour silently, and there is no way to tell from a passing test which happened. Worse,
adding `cwd` to a `GatewayClient` used by every user-facing `agent()` call widens a shared interface for
one internal caller.
**Testability lens**: omission is testable — you assert the built object's absent keys — but it is
*weakly* testable, because "we did not pass `workspace`" reads as an accident to the next maintainer.
**Karpathy tie-break: omission wins**, with the omission-table of §2.3 written into the design as a
comment block at the call site naming the property each omission buys. And DES-120 makes the objection
mostly moot: with `tools: []` there is no tool that could read anything, so `cwd`'s remaining job is a
belt whose suspenders are already on.

### 5.2 Testability wants the analyzer on a stub gateway; interface-contract wants the *real* shared gateway instance

**Testability**: injecting a stub `GatewayClient` gives total control and zero SDK involvement.
**Interface**: a stub that returns a hand-written `GatewayResult` proves nothing about what the *real*
client puts on the wire — and §2.1 is a bug that lives entirely in the real client's `options` builder,
invisible to any stub.
**Resolution — both, at different altitudes, and the design must say so**: the stub gateway carries the
mapping/queue/status tests (many, fast); a single `queryImpl`-level test carries the wire assertion (one,
literal). **Neither is optional.** A design that only lists the stub tests will ship §2.1's bug and be
green.

### 5.3 Boundary lens wants `workflow_regenerate_diagram` to be rate-limited; simplicity says no new mechanism

**Boundary**: an owner-gated call that costs a model call, with no per-key guard, is a spend primitive
(and with `authEnabled:false` — the documented local deployment — "owner-gated" is everyone).
**Simplicity**: a rate limiter is a new mechanism, and ADR-018 just deleted one on those grounds.
**Resolution**: no rate limiter. **B4's per-`(name, version)` single-flight guard** (§2.8) is not a new
mechanism — it is the correct implementation of ARCH-079's *existing* single-flight invariant — and it
converts a loop of N calls into N cheap no-ops for the duration of one job. That is enough. Record the
residual (a patient attacker can still serialise calls) rather than build for it.

### 5.4 Interface-contract wants `viewerIsOwner` on `projectWorkflowDescribe` for symmetry with `projectWorkflowForRead`; boundary lens wants it gone

**Interface (symmetry)**: the sibling projection takes it; ARCH-081 lists it; a future owner-only field
would need it.
**Boundary**: a parameter that provably cannot change the output is dead weight that invites a future
"just one owner-only field", which is how a second disclosure policy gets born — the exact drift REQ-101
exists to prevent.
**Tie-break: drop it** (§2.6). If A3's owner-field decision is ever revisited, it is revisited for
`workflow_get` and `workflow_describe` **together**, which is a bigger change than one parameter and
should look like one.

---

## 6. Task-splitting notes (03-tasks.md does not exist yet; these constrain it)

1. **`curateToolsForProvider`'s empty-set fix + the wire-assertion UT + the analyzer's `opts.allowedTools`
   wiring are ONE task.** Split across tasks, the analyzer lands wired to a Bash-capable session and the
   fix lands later as "a small curation cleanup" with nothing red in between. This repo's wiring-defect
   class is precisely "the guard and the thing it guards landed in different changes".
2. **ARCH-085's three definition-of-done items are one task**: the `composeConfig()` forwarding line, the
   `compose-config-v2-wiring.test.ts` row, and the `rwe.config.example.json` + DEPLOY.md entry. The
   architecture already says "in the same change"; the task list has to make that a single task or the
   instruction has no enforcement point.
3. **The ADR-022 grep guard lands BEFORE (or with) the deletion task, and is allowed to be red in
   between.** A guard written after the deletion is a guard fitted to whatever the deletion happened to
   leave — which is how a nine-instance defect class stays at nine.
4. **`gateDiagram` (`diagram-gate.ts`) is its own task and can land first.** It is pure, has no deps
   (ARCH-080 `deps: —`), and carries REQ-102/A3's security invariant. It should be green before
   `GraphAnalyzer` exists, so the analyzer is written against a gate that already works.
5. **`getTriggerBindings` is its own task and lands before both its consumers.** Two call sites,
   port-injected, fully unit-testable without SQLite.
6. **The dashboard task (ARCH-084) depends on the route task (ARCH-083) and must not be merged into it** —
   the `<pre>`/`textContent` assertion is a distinct test and the first model-authored string this
   renderer has received.
7. **`docs/AUTHORING.md` (ARCH-086) is small but must not be the last task**: its phase-name rule is,
   per §3.3, the *sole* control over a new disclosure. If it slips, the control slips.
8. **REQ-104's Gate 7.5 real-run item needs its own line in the task list**, not a bullet inside the
   config task — it is the only proof of the acceptance and it happens at a different gate.

---

## 7. Risks

| # | Risk | Severity | Mitigation proposed here |
|---|---|---|---|
| R1 | `tools: []` yields `['Bash']` on the default sdk+Ollama path; the analyzer becomes an execution primitive reachable by `workflow_register` | **HIGH** | DES-120: preserve the empty set in `curateToolsForProvider`, pass `opts.allowedTools`, assert the built `options` literally with a non-Anthropic alias |
| R2 | `graphAnalyzer.retries` silently does nothing (no per-call channel) or multiplies with the gateway's | **HIGH** (one of the two is certain if unaddressed) | DES-121: analyzer-owned loop, default `0`, the `(1+a)×(1+g)` formula in DEPLOY.md, a UT counting calls |
| R3 | The phase-name disclosure is new, its only control is a document, and the owner was never asked because "pre-existing" made it look free | **MEDIUM-HIGH** | §3.3: state it, flag it in Decision rationale, pin the behaviour with a test so overruling it is a red test |
| R4 | An analyzer failure leaks provider text (which can echo the script) into the journal or `diagramNote` | **MEDIUM** | DES-123/DES-129: `noteCode` enum + `noteTextFor`; `detail` consumed only to select a code; the secret-in-error-message UT |
| R5 | The gate's tokeniser is under-specified ⇒ either every diagram is rejected, or a secret glued to a glyph passes | **MEDIUM** | DES-124: the four-pass algorithm, exact case-sensitive membership, hostile-input UT table |
| R6 | `diagramStale` reads `true` for every workflow with no diagram; the flag becomes noise and REQ-103's promise is decorative | **MEDIUM** | DES-127 B3: stale is meaningful only when `status==='ready'` |
| R7 | A boot backfill (or a lazy read-triggered generation) is added later for consumability, turning upgrade or read into unbounded spend | **MEDIUM** | DES-127 B1: no backfill, `NOT_GENERATED`, owner-initiated recovery — and say so in the design so a later reader sees a decision, not an omission |
| R8 | A failed `regenerate` overwrites a working `ready` diagram with `unavailable` | **MEDIUM** | DES-127 B5: failure leaves the prior row untouched |
| R9 | The webhook `secret` reaches the analyzer prompt or a diagram via a future edit that returns the row | **MEDIUM** (closed at architecture; needs a *type* to stay closed) | DES-128: the port's return type has no `secret`/`id` field, so a regression is a `tsc` error |
| R10 | Someone writes a unit test that "proves" REQ-104 and the wiring defect ships green | **MEDIUM** | §4: the design explicitly forbids it; the wiring row and the real run are separate, both mandatory |
| R11 | `bindingsFp` flaps on row ordering ⇒ spurious `diagramStale` | **LOW-MEDIUM** | DES-128: pinned canonicalisation + an order-independence UT |
| R12 | ARCH-077's phantom prune is implemented as written (a prune that does not exist), producing dead code and a false invariant | **LOW** | §3.1: one deletion path, `deregister()`'s transaction |

---

## 8. Expected disagreements with the other lens (quality-dimensions)

Predicted from their architecture-round positions (they raised the analyzer-transcript mask bypass, the
"wired but degraded" conformance signal, and pushed `ready` over `ok`).

1. **Boot backfill for pre-v23 versions.** They will want it, from **consumability** — an operator who
   upgrades and finds every existing workflow's diagram `unavailable` has a bad first five minutes. I
   oppose (R7): N model calls triggered by an upgrade, attributed to no principal, is a spend primitive
   at boot and it is the shape ADR-017 already rejected for reads. **Compromise I would accept**: a
   one-line boot log naming the count of versions with no diagram and the exact recovery command. Zero
   model calls, all of the discoverability.
2. **Analyzer diagnostics.** They will want more than one journal line — a raw completion kept somewhere
   for debugging a `GATE_REJECTED_SHAPE` storm, from **observability/replaceability**. I oppose on
   ADR-016: the raw completion is derived from the masked script and any store is a second surface to
   mask. **Compromise**: store the **rejected token** (the single `allowedLabels` miss) for
   `GATE_REJECTED_SHAPE` only, never for `GATE_REJECTED_CONTENT` (where the rejected token is by
   definition the leaked thing). That gives them the degradation signal with no content channel. I expect
   this to be the round's most productive disagreement.
3. **The `viewerIsOwner` parameter (§5.4).** They may want it retained for future-proofing /
   consumability of an owner-richer view. I hold: no parameter that cannot change the output.
4. **`inputs_fp` / the cache.** ADR-018 deleted it over both panels' converged position. If they
   re-litigate it at design altitude (self-sustainability: bounded spend), I **side with ADR-018** even
   though my own architecture-round lens argued for the cache — the ADR's construction argument for
   REQ-104 is stronger than my cost argument, and DES-121's `retries: 0` default plus B4's per-key
   single-flight take most of the spend risk off the table without a cache.
5. **Where the "wired but degraded" signal lives.** They may want a dedicated metric/counter surface. I
   hold that `GATE_REJECTED_SHAPE` on the existing journal line is the counter, and a new surface is a
   new component in a slice whose whole discipline is not adding one.
6. **Possible disagreement about my §3.3 framing.** They may read the phase-name finding as a security
   regression and want the diagram to drop phase labels. I do **not** claim a regression — A3 authorises
   it — I claim the *rationale* is false and the owner should confirm. If the owner drops phase names,
   the diagram loses most of its readable labels, which is a product cost, not a free win.

---

## 9. What I am explicitly NOT proposing (Karpathy discipline, stated so the synthesizer can see the budget)

No new component, module, service, daemon, table (beyond ARCH-077's one), cache, rate limiter, retry
scheduler, backfill, GC, sandbox, trust tier, second renderer, structured intermediate representation,
transcript store, effective-config readback surface, or `cwd` parameter. The proposal is: **one
one-line fix to an existing curation function, one wire-level test, one closed enum with a total mapping
function, one tokeniser specification, one projection signature, one port interface, five pinned boundary
states, and four corrections to the architecture's own text.**
