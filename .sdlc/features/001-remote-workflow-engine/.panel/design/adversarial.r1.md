# Design panel — Adversarial group (interface-contract / boundary-error / testability), round 1

**Iteration:** v34 · **Gate:** 3+4 (tasks + detailed design, merged) · **Scope:** REQ-202, REQ-203, REQ-204
**Reading:** 01-requirements.md REQ-202/203/204 · 02-architecture.md v34 slice (ARCH-136..140, ADR-061..064,
INV-V34-1..4, Gate-5 constraints 1..9) · state.yaml `tech_stack` · and the live source at every `file:line`
the architecture cites. Every claim below was checked against the code, not against the ledger's prose.
`03-tasks.md` does not exist yet; where task-splitting changes my answer I say so under **Task splitting**.

**Citation convention:** line numbers are as of `a98b469` and are approximate (±5); every claim is anchored on the named identifier, so **locate by grep, not by line number** — the same rule the architecture's own retirement register states for `04-design.md:2593`.

**Round-1 discipline:** ADR-061/062/063 are closed decisions. I do not relitigate them. Where I disagree
with one I put it under **risks** with a revisit trigger. ADR-064 carries a live `owner_decision`, so it is
fair game — and §K2 below is my main contribution to it.

---

## 0. Altitude determination (system vs AI-agent)

**Both, with a measurable split — and this slice is ~90% plain-system.** `tech_stack` is a Node/TypeScript
MCP JSON-RPC server over SQLite with two `GatewayClient` implementations; the product is an *engine* that
dispatches agents, not an agent. Of the five ARCH rows, four (ARCH-136 projection, ARCH-138 registration
refusal, ARCH-139 config key, and the deletion bookkeeping half of ARCH-137) are ordinary API/config/persisted-
schema work and take the **system** altitude of observability/consumability/replaceability: a cold MCP client
is the consumer, `tsc` and vitest are the pins, the SQLite row is the durable contract.

The **agent** altitude enters at exactly one seam and I apply it only there: `composePrompt`'s output is
*what the model sees*, and `<user-instructions untrusted="true">` is a label addressed to a model rather than
a parser. Two consequences I carry through the whole proposal: (a) the engine has no protocol-level system
prompt at all, so "prompt layering" is a string-concatenation contract and must be specified as bytes, not as
roles (INV-V34-2 says this; the DES must not quietly re-introduce role language); (b) an agent-altitude
"output" is non-deterministic, so every v34 test must be anchored on the **dispatched** string or the
**persisted** row, never on the model's reply. That single rule is what makes §K1 a defect rather than a nit.

I deliberately do **not** apply agent-altitude self-sustainability (prompt-eval loops, judge harnesses):
nothing in REQ-202/203/204 changes model behaviour; it changes what the engine puts in front of the model.

---

## summary

The architecture is right and the slice is genuinely subtractive. My three lenses agree on the shape and
disagree only at the edges. But I found **three design-altitude defects that are not nits**, each verified in
the source, each cheap to fix now and expensive to find at Gate 6/7.5:

1. **Gate-5 constraint 2 as written is FALSE and will be "fixed" by weakening the assertion.**
   `descriptor.prompt` is not `composePrompt()`'s output — it is `schemaPrompt` (or the retry-nudged variant).
   The DES must define `descriptor.prompt` as *the dispatched string* and fixture the test with no `schema`.
2. **`RunParams.prompt` and `RunParams.tools` are provably dead on every reachable path**, which dissolves most
   of ADR-064's dilemma: option (A) carries zero behavioural risk, and constraint 9's "legacy row with three
   layers" is **unconstructible** without hand-forging a row the engine itself refuses one line earlier.
3. **ADR-063's refusal has no specified error type, code or observable surface.** "Refused, not silently
   ignored" is only true once the DES names all three — and the answer is already sitting seven lines above
   the throw it replaces (`codedError`, `agent-executor.ts:533-540`).

Plus one real interface-contract sharpening (`ceiling` is generic, `unit` is not — and the code makes the
first one free), one boundary case the architecture's golden matrix omits, and one fixture the deletion table
tells the implementer to delete that constraint 3 needs kept.

Karpathy tie-break, applied throughout: **every fix below is smaller than the thing it replaces or is a
one-line change at a site that already exists.** I propose zero new modules, zero new error codes, zero new
config keys and zero standing machinery. Where a lens of mine wanted machinery, I say so and rule against it
(§C1, §C3).

---

## key_points

### K1 — (interface-contract + testability) `descriptor.prompt` must be specified as *the dispatched string*, and Gate-5 constraint 2 needs two edits

**Measured, not inferred.** `agent-executor.ts:598-604` builds `schemaPrompt = validate ? effectivePrompt +
"\n\n=== OUTPUT FORMAT (REQUIRED) ===..." + JSON.stringify(schema) : effectivePrompt`, then the attempt loop
(`:601-606`) passes `schemaPrompt` on attempt 0 and `schemaPrompt + "\n\n(Your previous reply did not parse…)"`
on every retry into `_invokeOnce(req, prompt, …)`, which hands it to the gateway verbatim
(`agent-executor.ts:725`: `this._gateway.invoke({ prompt, opts, … })`). Both gateways echo that same value onto
the descriptor — `client.ts:501` (`prompt: req.prompt`) and `claude-agent-sdk-client.ts:691` (`prompt: req.prompt`).

So after ARCH-137 deletes `stripFirstSegment`, the persisted `descriptor.prompt` equals `composePrompt()`'s
output **only when `opts.schema` is absent and attempt 0 succeeded**. With a schema it carries the engine
scaffolding too; on a retry it carries the nudge as well, and `onHarness` is latest-wins (the `_invokeOnce`
comment at `:637` says so), so the *last* attempt's string is what persists.

This does not break ADR-061 — segments 4/5 in the v34 "BEFORE" diagram are the engine's own scaffolding and
the diagram's "AFTER" box lists them as segment 3. ADR-061's claim ("`descriptor.prompt` is the gateway's
verbatim echo of what the model actually saw") is *more* true than the architecture realised. What breaks is
the **test sentence**, and it breaks in the worst direction: an implementer who writes constraint 2 literally
gets a red test for a reason that is not a defect, and the named failure mode ("an implementer who hits that
will 'fix' it by weakening the assertion") is exactly what will happen.

**DES proposal (two edits, zero code change):**
- **Definition.** 04-design.md defines `HarnessDescriptor.prompt` as *"the exact string this dispatch handed
  the gateway"* — `composePrompt(scriptPrompt, appendPrompt)` plus, when a `schema` is set, the OUTPUT FORMAT
  suffix, plus, on attempt n>0, the retry nudge. This is one sentence and it is the honest post-v34 contract.
- **Test.** Constraint 2's integration test fixtures an `agent()` call with **no `schema`** and asserts
  `descriptor.prompt === composePrompt(script, append)` byte-for-byte, both delimiters inline, fixture under
  `PROMPT_CAP` (2048, `agent-executor.ts:28-31` — the architecture already named this). A **second** case with
  a schema asserts `descriptor.prompt.startsWith(composePrompt(...))` and that the suffix is present. The
  second case is what stops a future reader from "simplifying" the first one's precondition away.

**Why this beats the alternative I considered and rejected.** The tempting fix is to stop trusting the echo:
have the ONE decoration site (`agent-executor.ts:661-672`) set `prompt` from the `prompt` parameter already in
scope instead of from `descriptor.prompt`. It is a one-line change, it makes the property total over both
gateway implementations and both attempts, and it removes a trust assumption — and today's fail-closed
(`stripResult.prompt === ''` + `harness_prompt_prefix_mismatch`) is the only thing that ever checked the
gateway echoed what it was given, so deleting it deletes the check with no replacement. **I rule against it
for v34.** It silently changes the field's meaning from "what the gateway reports it received" to "what the
engine says it sent", which destroys the ability to observe a gateway that mutates the prompt — a real
observability loss, bought for a test-determinism gain the fixture above already delivers. Recorded here as a
named runner-up with a revisit trigger: **if a third gateway implementation lands, or any gateway is observed
not echoing `req.prompt`, the decoration site takes ownership of the field.** See risk R-1.

### K2 — (boundary + testability) `RunParams.prompt`/`.tools` are dead on every reachable path; ADR-064's dilemma mostly dissolves

ADR-064 asks the owner to choose between (A) retiring `RunParams.tools` with `RunParams.prompt`, and (B)
amending REQ-203's advertised "two layers" to say three for a legacy row. Its premise is *"any run whose pinned
params snapshot carries a legacy `HarnessDefaults` still has THREE layers."* **I traced that premise and it
does not hold on any path the engine will execute.** Four facts, each at a line:

1. **Every live producer passes `defaults: undefined`.** `run-manager.ts:587` `defaultRunParams(undefined,
   contract.agents)` and `:588` `mergeRunParams(undefined, …)` — with the comment *"v24 Gate 7.5 (ADR-035): the
   workflow-wide `defaults` object is retired and no longer read from the catalog, so the first argument … is
   always absent."* The resume fallback at `:1046` also passes `undefined`. `grep` finds no fourth producer.
   Since `RunParams.prompt`/`.tools` are populated **only** from `defaults?.prompt`/`defaults?.tools`
   (`resolve.ts:85-87`), every snapshot written since v24 has both fields `undefined`.
2. **The snapshot is written once and never updated.** `sqlite-run-store.ts:111` is a single `INSERT`; there is
   no `UPDATE runs SET effective_params` anywhere. So a row's shape is fixed by the build that admitted it.
3. **Every pre-v24 snapshot is already refused before `effectiveParams` is built.** `run-manager.ts:1038-1045`:
   `storedParams !== null && storedParams.agents === undefined` → `LEGACY_REREGISTER`. `.agents` is written by
   every v24+ admission.
4. **Therefore a row with BOTH `.agents` and a non-undefined `.tools` requires a build from the window between
   `ba46e3b` (which introduced `rp.agents = {}`) and `7a3dbee` (which stopped passing `defaults`) — both dated
   2026-09-04, the same day, inside iteration v24.** **Verified, not assumed:** `git tag --contains` returns
   **zero tags for either commit**, so the window is not tag-separated and no tagged release sits inside it or
   after it; a deployment old enough to predate `7a3dbee` also predates `ba46e3b`, and its rows have no
   `.agents` key — which `run-manager.ts:1038` already refuses. The empirical closer is the Gate 7.5 SQL below.

**Consequences for this design:**
- REQ-204's "pipeline removal" is **dead-code removal**, not a behaviour change. The DES should say so in one
  sentence, because it converts the whole of REQ-204 from "risky" to "free" and stops Gate 6 hunting for a
  compatibility shim with no referent.
- **ADR-064 option (A) carries zero behavioural risk** and is what I recommend. The design baseline the
  architecture already attached to (A) is correct; I add the evidence that makes it cheap.
- **Constraint 9's test is unconstructible as written.** A "legacy row's ACTUAL resolved layers" requires a row
  with `.agents` + `.tools`, and any such row is a hand-forged fixture, not something the engine can produce.
  If Gate 5 writes it by hand-INSERTing JSON it is testing a straw man. **DES proposal:** replace it with two
  real things — (i) a **totality** assertion (a persisted snapshot carrying extra `prompt`/`tools` keys is read
  back, resumes, and the extra keys are ignored — this is INV-V34-3 and it *is* constructible, because reading
  is total over any JSON); and (ii) the `workflow_describe`-side assertion that the advertised layer count
  matches the resolved layers for a **normal** row, which is the sentence REQ-203 actually ships.
- **The one thing that would still be silently wrong**, and my boundary lens's remaining ask: if such a row
  *did* exist, removing `RunParams.tools` converts a restrictive rung into nothing — a silent **capability
  expansion** on a resumed run. That is strictly worse than the `agentType` hole ADR-063 just closed, because
  that one only lost content. **Minimal fail-closed:** extend the existing `LEGACY_REREGISTER` guard at
  `run-manager.ts:1038` from one condition to three —
  `storedParams.agents === undefined || Object.hasOwn(storedParams,'prompt') || Object.hasOwn(storedParams,'tools')`.
  Same site, same code, same message family, ~2 lines, no new vocabulary, and it makes REQ-203's advertised
  "two layers" sentence **unconditionally true** — which ADR-064 itself says is the requirement.
- **The anchor test does NOT go red — checked.** `tests/integration/resume-legacy-params.test.ts` discriminates
  purely on the presence/absence of the `.agents` key (its own comment at `:5-7`, `:36`, and the v24 case at
  `:70` — *"an `agents` slice present, even empty, resumes normally"*); no fixture there stores a snapshot
  carrying `prompt`/`tools` (the `prompt: 'go'` hits are inside the registered **script** string, not the
  params row). So the three-condition guard is strictly additive to that file, and the new case it needs is a
  **third** fixture: `.agents` present **and** a `tools` key ⇒ typed `LEGACY_REREGISTER`. Stated here so the
  verifier reads a new red as the intended new case, never as the guard mis-firing on an existing one.
- **Gate 7.5 evidence, exactly parallel to ADR-063's catalog sweep:** one SQL over the live DB —
  `SELECT COUNT(*) FROM runs WHERE effective_params LIKE '%"tools"%' OR effective_params LIKE '%"prompt"%'` —
  with the row count recorded in the validation ledger. If it returns 0 (expected), the guard is a preserved
  invariant with no live producer, exactly like ADR-063's. If it returns non-zero, the guard is the reason
  nobody's tool floor quietly vanished.

**My own lenses conflict here and I resolve it openly.** Simplicity says: 0 reachable rows ⇒ 0 lines, take (A)
and write nothing. Boundary says: a silent capability expansion is the one failure class that must never be
traded for two lines. ADR-063's precedent does **not** automatically carry — there the engine has an *existing*
fail-closed being deleted, here it does not. I side with boundary, narrowly, on the asymmetry between the two
halves: losing `prompt` is content loss (recoverable, visible in the persisted `descriptor.prompt`), losing
`tools` is capability gain (invisible, and security-relevant). One guard covering both keys is cheaper than two
guards or than arguing the split, so I propose the single three-condition guard. **If the owner picks (B)
instead**, the DES needs only a one-line delta (keep `RunParams.tools`, keep the `eff.tools` rung at
`agent-executor.ts:576-580`, and the guide says "three layers for a legacy row") — so **no task is blocked on
the pending decision**, and the design should say that explicitly.

### K3 — (interface-contract + boundary) ADR-063's dispatch refusal: name the error type, the code and the surface

ADR-063 specifies `Object.hasOwn(req.opts,'agentType')` → throw, "naming the v34 retirement and the guide". It
does not say *what is thrown*. The line it replaces is `throw new Error(\`Unknown agentType: …\`)`
(`agent-executor.ts:550`) — a **plain** `Error`, which reaches a client as an uncoded message. Seven lines
above it, the same function's sibling guard already does it properly:
`throw codedError('PARAM_OUT_OF_RANGE', detail)` (`agent-executor.ts:533-540`).

**DES proposal (one site, no new code):**
```ts
if (Object.hasOwn(req.opts, 'agentType')) {
  throw codedError(
    'PARAM_UNKNOWN',
    "PARAM_UNKNOWN: 'agentType' was retired at v34 — the server-side agent-definition mechanism is gone; " +
    "put the system prompt in your script's own prompt. See workflow_authoring_guide, 'prompt layering'.",
    { param: 'agentType', agent: req.opts.label, violation: 'AGENT_OPT_RETIRED' },
  );
}
```
Three deliberate choices, each with a reason the reviewer can check:
- **`PARAM_UNKNOWN`, not a new code.** It is already this codebase's code for "an options key that is neither
  an `AgentOpts` field nor a tunable" (`workflow-meta.ts:150-159`, `contract.ts:517-524`), and — **verified, so
  the snippet compiles** — it is a top-level `ErrorCode` with its own `ERROR_CATALOG` row already advertised
  (`errors.ts:81`, beside `PARAM_OUT_OF_RANGE` at `:79`), so `codedError('PARAM_UNKNOWN', …)` typechecks at
  this site exactly as `codedError('PARAM_OUT_OF_RANGE', …)` does seven lines above it. No catalog row, no
  `errors[]` entry and no fixture is added — which is the whole of ADR-062's argument, satisfied by reuse. ADR-062's own
  argument against `AGENTTYPE_RETIRED` (`errors.ts:66-74`, the deleted `UNDECIDABLE_SHAPE`) applies here with
  equal force, and reusing it costs nothing.
- **`detail.violation: 'AGENT_OPT_RETIRED'` — the SAME marker ARCH-138 mints on the registration side.** This
  is the highest-value line in my whole proposal: it means a client writes **one** branch
  (`detail.violation === 'AGENT_OPT_RETIRED'`) and it fires whether the retired key arrives at registration or
  at dispatch of a pinned pre-v34 version. Two sites, one vocabulary, zero extra concepts — which is exactly
  what REQ-202's "呼叫端不必試錯" asks for, one layer down.
- **`codedError`, not `new Error`.** Otherwise "refused, not silently ignored" is true of the *run* and false
  of the *client*, which cannot tell this refusal from any other crash.

**Observable surface — the DES must state it and Gate 5 must assert it.** The throw leaves `executor.run()`,
propagates out of `spawner.run(...)` inside `this._semaphore.withSlot(...)` (`run-manager.ts:1409-1421`) — the
`finally` there only releases the slot, it does not swallow — so it surfaces the same way the effort refusal at
`:533-540` already does: the script's `agent()` promise rejects and, uncaught, the run fails. **Test shape:**
one integration test that registers a pre-v34-shaped script (or injects a pinned version's script text
carrying `agentType:`), starts a run, and asserts the run reaches a failed terminal state with the coded error
and `detail.violation` visible through `workflow_status` — **not** a unit test that only asserts the throw.
A refusal nobody can observe is the same defect as silence.

### K4 — (interface-contract) ARCH-136: `ceiling` is generic and free; `unit` stays appendPrompt-only

Two sharpenings on the projection, both from the code:

- **Type it closed.** `ceiling?: string` is loose; `ParamSpec['ceilingKey']` is already the closed 3-arm union
  `'maxTimeoutMs' | 'maxAppendPromptBytes' | 'maxEffort'` (`contract.ts:46`). DES signature:
  ```ts
  export interface DescribeAgentParamKey {
    type: ParamSpec['type'];
    default: unknown;
    range?: unknown[] | { min?: number; max?: number };
    unit?: 'bytes';
    ceiling?: NonNullable<ParamSpec['ceilingKey']>;
  }
  ```
  A closed union costs nothing and makes a typo in the projection a `tsc` error, which is the same discipline
  INV-V34-4 applies to the two key sets.
- **`ceiling` falls out generically — do not gate it to `appendPrompt`.** `projectAgentParams`
  (`workflow-view.ts:145-165`) loops over `['model','effort','timeoutMs','appendPrompt']` and reads `eff[key]`,
  which `effectiveAgentBounds` already produced. `boundMax` sets `ceilingKey` for **`timeoutMs` too**
  (`contract.ts:186-192`, `:203-204`). So `...(s.ceilingKey !== undefined ? { ceiling: s.ceilingKey } : {})` is
  one spread that serves both keys, is *simpler* than gating it, and matches the generic rejection branch which
  already emits `detail.ceiling` for any key (`contract.ts:479-490`). **`unit` stays `appendPrompt`-only** — the
  architecture's asymmetry ruling is right and I do not reopen it. But the DES must state the asymmetry in the
  same paragraph as the generic `ceiling`, or a reader will assume both are gated the same way and the test
  will cover only one key. **Note for the synthesizer:** ARCH-136's api line says `ceiling` is set "iff the
  effective spec carries `ceilingKey`" — that already reads generic; I am making it explicit, not overturning it.

- **UT shape (pure function, no injection needed — `projectWorkflowDescribe` takes `ctx.ceilings`).** Five
  cases over `boundMax`'s branch, which is `effective === ceilingMax && authorMax >= ceilingMax`:
  (a) author max < ceiling → **no** `ceiling`, `range.max` = author's; (b) author max > ceiling → `ceiling`
  present, `range.max` = ceiling; (c) **author max exactly == ceiling → `ceiling` IS present** (both bounds
  fired; a reader may expect absence — pin it); (d) author declares no `max` → `Infinity >= ceilingMax` →
  `ceiling` present; (e) a legacy stored spec with a non-number `max` → same as (d), which is the totality
  discipline `boundMax`'s own comment claims and nothing currently pins from the projection side. Plus
  `unit:'bytes'` present on `appendPrompt` and **absent** on `timeoutMs`/`model`/`effort` (the anti-symmetry
  assertion — without it the asymmetry is undocumented in executable form).

- **Compatibility:** additive and safe. `workflow_describe`'s advertised `outputSchema` is the generic `OUT`
  (`tool-specs.ts:359`), so no schema, fixture or `errors[]` churn — the architecture's "no fixture change"
  claim holds **for ARCH-136**. (It does not automatically hold for ARCH-138; see K5.)

### K5 — (boundary + interface-contract) the appendPrompt rejection says "ceiling" even when the author's bound won

REQ-202 asks that the caller read *the same word* before the call and after a refusal. ARCH-136 adds
`detail.ceiling` to the appendPrompt branch conditionally — but that branch's **message** is the unconditional
string `'appendPrompt exceeds the byte ceiling'` (`contract.ts:557`), emitted whether the engine ceiling or the
author's own tighter range fired. The generic branch does it correctly and conditionally
(`contract.ts:485-489`: *"exceeds the engine ceiling `${spec.ceilingKey}` `${spec.max}`"* vs *"exceeds the
maximum of `${spec.max}`"*), with the comment *"the ceiling-vs-author-range direction must be readable from the
message itself"* (UT-147). So on the one parameter REQ-202 is about, the message currently **mis-attributes an
author bound to the engine** — the exact defect the generic branch was fixed for at v24.

**DES proposal:** the appendPrompt branch mirrors the generic branch's conditional message and adds
`...(spec.ceilingKey !== undefined ? { ceiling: spec.ceilingKey } : {})` to `detail`. Same shape, same words,
~3 lines, one site. `detail.maxBytes`/`suppliedBytes` stay (the architecture is right that `maxBytes` already
carries the min()-ed bound). **UT:** the two-branch message test, author-won vs engine-won, asserting the word
"ceiling" appears in the message **iff** `detail.ceiling` is present — one assertion that locks message and
detail together forever.

**Also checked, and I rule AGAINST doing it (simplicity):** the `FRAME_CLOSE_FORGERY` rejection
(`contract.ts:544-551`) is also `PARAM_OUT_OF_RANGE` and carries only `suppliedBytes`, so a client cannot
distinguish "too long" from "you forged the frame close" without string-matching — the very defect class
ADR-062 just fixed for `SCAN_VIOLATION`. It is tempting to mint `detail.violation:'FRAME_CLOSE'` for symmetry.
**No.** REQ-202 requires the caller to learn rule (c) **before** the first call (that is ARCH-087's prose and
ARCH-136's projection), not to machine-branch a refusal it now knows how to avoid. Minting a field nobody
asked for is how this ledger grows surface. I record the asymmetry here so Gate 8 reads it as a decision, with
the revisit trigger: **a real client reported branching on the frame-forgery message string.**

### K6 — (boundary) the golden matrix is missing a fifth case, and the goldens should be literals in the design, not a capture step

Gate-5 constraint 1 names a four-case matrix. I ran today's 4-arg `composePrompt` over it (and one more) and
confirmed the exact bytes:

| # | `scriptPrompt` | `appendPrompt` | output (JSON-escaped) |
|---|---|---|---|
| 1 | `"SCRIPT"` | *absent* | `"SCRIPT"` |
| 2 | `"SCRIPT"` | `"USER"` | `"SCRIPT\n\n<user-instructions untrusted=\"true\">\nUSER\n</user-instructions>"` |
| 3 | `"SCRIPT"` | `""` | `"SCRIPT\n\n<user-instructions untrusted=\"true\">\n\n</user-instructions>"` |
| 4 | `"SCRIPT"` | `"a\nb"` | `"SCRIPT\n\n<user-instructions untrusted=\"true\">\na\nb\n</user-instructions>"` |
| **5** | `""` | `"USER"` | `"\n\n<user-instructions untrusted=\"true\">\nUSER\n</user-instructions>"` — **leading `\n\n`** |

Case 5 is missing from the architecture's matrix and is **reachable**: `agent(label, '')` is refused nowhere —
no `PROMPT_REQUIRED`, no length check at the scan, the contract or admission (the only `prompt.length` in the
tree is `capPrompt`'s 2048 truncation, `agent-executor.ts:28-31`). The empty-body composition emits a leading
blank-line pair. **Pin it, do not fix it.** Byte-identity across the cut is the entire point of the golden; a
"tidy" `body === '' ? frame.trimStart() : …` is a behaviour change smuggled inside a refactor, and with no
current test it would not even show up as one. My boundary lens wants it handled; simplicity says the golden
*is* the spec. Simplicity wins, and the DES records the tension so a later reader sees a decision, not an
oversight.

**Second, and more useful: put the five literals in 04-design.md.** Constraint 1 says "capture the outputs
BEFORE the cut and freeze them" — correct in spirit, but it makes the test's correctness depend on *task
ordering* (§T1), and an implementer who deletes first can no longer produce them. If the design carries the
five literal strings, the constraint becomes unconditional and order-independent: the post-cut 2-arg function
must reproduce **these bytes**, whenever it is written. The strings above are that table; I computed them by
executing the current implementation, not by reading it.

### K7 — (testability) ARCH-137's deletion table tells the implementer to delete the fixture constraint 3 needs

ARCH-137's deletion set names `tests/fixtures/dashboard-wire.ts:31,36-37`. Those lines are:
```ts
prompt: 'the user-visible prompt only — never the agentType systemPrompt',
// v27 (DES-195, ARCH-129): present iff a non-empty agentType systemPrompt was applied.
systemPrompt: { agentType: 'researcher', bytes: 42 },
```
That is a **pre-v34 harness row** — precisely the input Gate-5 constraint 3 needs ("feed a genuine pre-v34
persisted row through the record rebuild and the dashboard projection"). **DES proposal:** re-purpose, don't
delete. Rename the fixture export to say what it now is (`HARNESS_LEGACY_PRE_V34`), keep the `systemPrompt`
property with a comment stating it is *deliberately* a shape the writer's type no longer emits, and cast at
the fixture boundary so `tsc` accepts an extra property on the narrowed type. Then constraint 3's test consumes
it instead of hand-building a legacy row, and the assertions that retire (`dashboard-lib-agent.test.js`'s
disclosure cases) are replaced by one that asserts the projection renders the legacy row with the disclosure
line **absent and no crash** — which is ADR-061's decision (d)-declined, stated executably.

Without this, "we removed the field" ships as "the engine cannot read its own history", and the deletion table
is what caused it.

### K8 — (testability) ARCH-139's warning is one console.warn; the UT needs `{ listen: false }`

Small but it will cost an hour at Gate 6 if unstated. `composeConfig` is `async` and its real path starts the
managed LiteLLM proxy; the seam is `deps.listen === false` (`main.ts:131-137`). The `RETIRED_CONFIG_KEYS` UT
must call `composeConfig({ graphAnalyzer: 1, agentDefinitionsDir: 'x', typo: 1 } as any, { listen: false })`
with a `console.warn` spy and assert **one** call whose text names all three keys and carries a retirement note
for the two retired ones and none for the typo. The current code emits exactly one warning
(`main.ts:148-155`); the DES must say the new map-driven version keeps that property, because "one warning
naming all of them" is the behaviour ARCH-090/DES-141 chose and a naive `for` loop over the map breaks it.

Also: `RETIRED_CONFIG_KEYS` cannot be compile-pinned (a retired key is by definition not `keyof FileConfig`).
Accepted. The one contradiction worth a single assertion is that **no key appears in both maps** — one line in
the same UT, not a new test file.

### K9 — (interface-contract) remaining signature deltas the DES must spell out

- `composePrompt(scriptPrompt: string, appendPrompt?: string): string`. Only **one** production call site
  (`agent-executor.ts:585`); `tsc` catches the arity change (TS2554) at every site, so the rename I considered
  (`composeAgentPrompt`, to make a missed site impossible) is unnecessary machinery — **ruled against**.
- `_invokeOnce(req: AgentReq, prompt: string, opts: AgentOpts, eff: EffectiveCallParams)` — the `sys?: string`
  fifth parameter goes with its subject (`agent-executor.ts:611`, `:663`).
- `AgentCallViolation.key` is documented free-form for `PARAM_UNKNOWN` (`workflow-meta.ts:161-164`); the new
  `AGENT_OPT_RETIRED` arm's `key` is closed to `keyof typeof RETIRED_AGENT_OPT_KEYS`. Say so in the doc comment
  next to the existing sentence, so the closed/free-form split stays one paragraph.
- **ARCH-138's "no fixture change" needs a check, not an assumption.** ARCH-087's row claims no `errors[]`/
  fixture change, and that holds. But `detail.violation` is added to `workflow-catalog.ts:490`'s
  `SCAN_VIOLATION` throw for **all seven arms** — the DES must confirm no existing test or advertised fixture
  pins that `detail` object exhaustively (a `toEqual` on `detail` anywhere will go red). One grep at design
  time; cheaper than a red suite at Gate 6.

---

## Task splitting (03-tasks.md does not exist; these are constraints on how it is written)

- **T1 — `tsc` atomicity: ARCH-137 + ARCH-139 + ARCH-140 are ONE task.** They are not independent.
  `composePrompt(def?.systemPrompt, req.runParams.prompt, …)` (`agent-executor.ts:585`) names ARCH-137's `def`
  and ARCH-140's `RunParams.prompt` in one expression; and `composeConfig` forwards `agentDefinitionsDir` into
  `ServerConfig`, so deleting `ServerConfig.agentDefinitionsDir` (ARCH-137, `server.ts:95`) makes ARCH-139's
  forwarding line a `tsc` error. Any split leaves a repo-red-on-both-sides intermediate state, and this project
  treats `tsc` as the first test (DES-192). **ARCH-136 and ARCH-138 are independently shippable** — split them
  out so the atomic task stays as small as it can be.
- **T2 — the golden task lands BEFORE the cut task** if the design does *not* carry the literals. If it does
  (§K6), the ordering constraint disappears, which is the better outcome. **Recommendation: carry the literals
  and drop the ordering constraint.**
- **T3 — constraints 4 and 5 are one-commit constraints, so each must be ONE task, not split by file.**
  Constraint 4: `tool-specs.ts` + `authoring-guide.ts` + regenerated `docs/AUTHORING.md` with UT-160 green in
  the same commit (`tests/unit/authoring-md-generated.test.ts:21` byte-compares the file against
  `buildAuthoringGuide()`; splitting re-trips the lock). Constraint 5: `KNOWN_FILE_CONFIG_KEYS` and
  `compose-config-v2-wiring.test.ts`'s exclusion list.
- **T4 — constraint 6 (near-miss re-pointing) belongs inside ARCH-138's task**, not as a follow-up: after the
  cut, `AGENT_OPT_NEAR_MISSES.system`/`.systemPrompt` point at `'agentType'` (`workflow-meta.ts:221-222`), a key
  that no longer exists. Leaving it one commit longer ships a message teaching a deleted feature.
- **T5 — if the owner answers ADR-064 as (A), it joins T1** (same type, same commit, `resolve.ts:50/87` plus
  the `eff.tools` rung at `agent-executor.ts:576-580`). If **(B)**, T1 is unchanged and only the guide sentence
  moves. Either way T1's shape is fixed — **no task is blocked on the pending decision**, which the design
  should state so Gate 6 does not stall.

---

## risks

- **R-1 (MID, testability/observability) — the gateway-echo trust assumption becomes unchecked.** Deleting
  `stripFirstSegment` also deletes the only code that ever verified the gateway echoed what it was given
  (`agent-executor.ts:656-659` fail-closed + `harness_prompt_prefix_mismatch`). After v34, `descriptor.prompt`
  is an *unverified claim by the gateway*, and there are two gateway implementations. Mitigation as proposed:
  K1's two test cases, plus running constraint 2 against **both** `GatewayClient`s (or stating in the DES that
  only the default SDK path is pinned, and why). Revisit trigger: a third gateway, or any observed non-echo.
- **R-2 (MID, boundary) — silent capability expansion on a forged/legacy params row** if ADR-064 resolves to
  (A) without K2's guard. Evidence says the row is unreachable; the guard costs ~2 lines at an existing site
  and makes the evidence non-load-bearing, exactly as ADR-063 argued for its own case.
- **R-3 (MID, interface-contract) — the `ceiling` attribution can silently disappear on a mistyped config.**
  `maxAppendPromptBytes` is `JSON.parse`d and never type-validated (`main.ts:114-121` casts;
  `server.ts:697` only `??`-defaults). A string `"2048"` makes `effective === ceilingMax` false (`===` across
  types) so `ceilingKey` is never set and the advertised `ceiling` vanishes while the bound still applies; a
  non-numeric value yields `max: NaN`, which serializes to `null` in the projection **and** makes the admission
  check `bytes > NaN` false — a ceiling bypass. Pre-existing, and I am **not** proposing a config-validation
  subsystem. Bounded remedy if the design wants one: `--check-config` already exists (`listen:false`) and is
  the natural home for a `typeof === 'number' && Number.isFinite` check on the three ceilings — three lines, no
  new surface, no boot behaviour change. Flagged because ARCH-136 newly *advertises* this bound, so the gap
  between advertised and enforced becomes a visible contract, not just an internal one.
- **R-4 (LOW, disagreement with a closed ADR) — ADR-061's legacy dashboard row.** I agree with following
  REQ-203 as written and do **not** reopen it. Recorded only so the revisit trigger stays visible: an operator
  mis-reading a pre-v34 run ⇒ a generic "fields retired at v34" note on legacy rows only. K7's fixture work is
  what makes that remedy a two-line change if it is ever needed.
- **R-5 (LOW, bookkeeping) — `04-design.md:2593/:2610`'s five-rung ladder text** is v24 doc-lag, not a v34
  change (the architecture says so). It sits in the file this gate writes, so it will be read as in-scope.
  Fix it by grep in this gate and say in the DES that it is v24 lag, or Gate 8 re-discovers it as a v34 defect.
- **R-6 (LOW, testability) — `grep -rn agentType src/ docs/` is a checklist, not a test.** INV-V34-4's compile
  pin cannot catch prose: `types.ts:204`, `agent-executor.ts:101/:464`, `contract.ts:17/:20`, `main.ts:59-63`
  all *narrate* the rung. A stale comment teaching a deleted mechanism is the defect class ARCH-138 is fixing
  on the message side; it deserves the same seriousness on the comment side. I do **not** propose an automated
  grep test (see C1) — I propose the grep output be pasted into the Gate 6 task's DoD so it is evidence.

---

## expected disagreements with the other lens (quality-dimensions group)

1. **Test inventory vs compile pins.** I expect the quality lens to want an explicit "did we remove
   everything?" test for `agentType` (observability/self-sustainability). I hold with INV-V34-4: a
   `Record<keyof AgentOpts|'prompt', true>` cannot be forgotten into, and an inventory test duplicates the
   compiler while going stale on its own. **Where I will concede:** the compile pin genuinely cannot see
   comments or docs, so the grep belongs in a task DoD as evidence (R-6). **Where I will not:** a new test file
   whose job is to assert an absence the type system already guarantees.
2. **ADR-064.** I expect the quality lens to treat the legacy-row three-layer case as live and ask for a
   compatibility path, or to want the `workflow_describe` layer-count test built against a hand-forged row.
   §K2's four file:line facts (`run-manager.ts:587/588/1046`, `resolve.ts:85-87`, `sqlite-run-store.ts:111`,
   `run-manager.ts:1038-1045`, and the `ba46e3b`→`7a3dbee` same-day window) say the row is unconstructible by
   the engine. I expect agreement once traced; I pre-empt with the evidence rather than the conclusion.
3. **K1 and who owns `descriptor.prompt`.** I expect the quality lens to prefer the decoration site taking
   ownership of the field (deterministic, total over both gateways, a clean observability story). I ruled
   against it *for v34* specifically because it converts "what the gateway reported" into "what the engine
   says", losing the ability to observe a mis-echoing gateway — the last remnant of a check this iteration is
   deleting. This is a genuine trade, not a preference, and I would accept the opposite ruling if the lens can
   show the observability of gateway echo is already covered elsewhere. **The fixture fix (K1) is required
   either way** and should not be held hostage to this argument.
4. **The frame-forgery discriminator (K5's second half).** I expect the quality lens to want
   `detail.violation:'FRAME_CLOSE'` for consumability symmetry with ADR-062. I rule against it on the Karpathy
   tie-break — REQ-202 asks the caller to learn the rule *before* the call, not to branch a refusal — and I
   record the asymmetry with a revisit trigger so the decision is visible rather than absent.
5. **`unit` symmetry.** I expect a push for `unit:'ms'` on `timeoutMs`. The architecture already ruled; I
   uphold it, and I go the *other* way on `ceiling` (generic, because the code already computes it for
   `timeoutMs` and gating it would be extra code). Expect the lens to read that as inconsistent — it is not:
   `ceiling` is free and `unit` is new work, which is precisely the tie-break.
6. **Where I expect us to agree immediately:** K3 (a refusal needs a code and an observable surface), K7
   (re-purpose the fixture), K6's fifth golden case, and T1's `tsc` atomicity.

---

## Internal conflicts between my own three lenses (stated, per the panel's charter)

- **Testability vs simplicity — absence pinning.** Testability wants an inventory/grep test; simplicity + the
  compiler win. Resolution: compile pin is the test, grep is a DoD checklist (R-6).
- **Boundary vs simplicity — the empty-`scriptPrompt` leading `\n\n` (K6 case 5).** Boundary wants it handled;
  simplicity says the golden is the spec and a "tidy" fix is an unannounced behaviour change. Simplicity wins;
  the case is pinned, not fixed.
- **Boundary vs simplicity — ADR-064's guard (K2).** Simplicity says zero reachable rows ⇒ zero lines.
  Boundary wins **narrowly**, and only because the failure mode is capability *expansion*, not content loss —
  I say so explicitly rather than invoking ADR-063's precedent, which does not transfer (there, an existing
  fail-closed was being deleted; here, none exists).
- **Interface-contract vs simplicity — `ceiling` generic vs gated.** Normally simplicity would say "do only
  what REQ-202 asks (appendPrompt)". Here generic is *less* code than gated, so both lenses point the same way;
  the only cost is that the DES must state the `unit`/`ceiling` asymmetry in one paragraph or a reader will
  mis-generalise (K4).
- **Interface-contract vs boundary — K1's definition change.** Interface-contract wants `descriptor.prompt` to
  have one crisp meaning ("the dispatched string"); boundary notes that meaning is now *unverified*. Both are
  satisfied by the same two test cases; the residual is R-1's revisit trigger.
