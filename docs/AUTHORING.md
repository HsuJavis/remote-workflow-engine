# Authoring a workflow script

This engine has no bundled guidance skill — the tool schemas returned by `tools/list` are the only documentation a cold MCP client ever sees, and `workflow_authoring_guide` (this text) is what every authoring error's `see` field points back to.

## The sandbox API

A workflow script runs inside a restricted VM context with exactly these globals — nothing else is reachable (`agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, `budget`, `workflow`, `Date`, `Math`; `Date`/`Math` are GUARDED, see below):

- `await agent(label, options)` — dispatches one agent call. `label` MUST be a literal string identifier (`/^[A-Za-z_][\w-]*$/`) matching a `meta.params.agents.<label>` declaration; `options` MUST be a literal object (no variable, no spread).
- `await parallel([thunk, ...])` — runs an array of zero-argument thunks concurrently, each returning `null` on its own thrown error rather than rejecting the whole call.
- `await pipeline([item, ...], stage1, stage2, ...)` — runs each item through the stage chain.
- `phase(title)` — names the current step for observability. Titles are public (see below).
- `log(...)` — a no-op placeholder in this sandbox (accepted, does nothing).
- `args` — the caller-supplied run arguments, shaped by `meta.params.args`.
- `budget` — read-only: `{limits: {usd, tokens}, total, spent(), remaining(), tokens()}` (see "Budget, concurrency" below for which accessor answers which limit).
- `await workflow(name, args)` — runs another registered workflow. A workflow() call may itself call workflow() again, recursing up to this deployment's configured `maxWorkflowDepth` (cycle-checked, descendant-capped) — a call that exceeds the depth is refused `NESTING_DEPTH_EXCEEDED`, one that would re-enter an ancestor on its own chain is refused `NESTING_CYCLE`, and one that pushes the run past its descendant cap is refused `DESCENDANT_CAP_EXCEEDED`. (An earlier one-level cap with a flatten-it instruction is what an older draft of this guide taught — that no longer matches what's shipped.) Even with depth available, the simplest and most readable script still flattens a needless wrapper into its caller, and draws another owner's workflow as a black-box rectangle node in your diagram rather than expanding it. A nested workflow()'s own phase() calls are recorded on THAT sub-workflow's card, not folded into the parent run as one of its lanes.

`Date` and `Math` are present but GUARDED — three calls are refused `DETERMINISM_GUARD` because resume replays agent() calls keyed by prompt+opts, so a wall-clock or random value baked into that key would change it on replay and re-dispatch an already-paid call:

- `Date.now()` — refused `DETERMINISM_GUARD`. resume replays agent() calls keyed by prompt+opts, so a wall-clock value baked into that key would change it on replay and re-dispatch an already-paid call. Instead: read a timestamp off run_status/run_result, or pass one in via args.
- `Math.random()` — refused `DETERMINISM_GUARD`. the same replay-key hazard as Date.now() — a random value baked into the key changes on every run. Instead: pass a seed in via args.
- `new Date()` — refused `DETERMINISM_GUARD`. called with no arguments this reads the wall clock, the same hazard as Date.now(). Instead: pass an argument — new Date('2026-01-01') is allowed.

This is documented as HYGIENE, not a security boundary — `node:vm` is not a sandbox, and the real containment is the per-run child PROCESS, which holds no secrets/store/network handle, not these two guarded globals. `setTimeout`, `fetch`, `console`, `require`, `process`, and `fs` are simply absent from the context, not merely shadowed.

## Declaring the parameter contract

**The script body is a bare async function body.** The statements you send as `script` ARE the body of an `async function` the engine wraps for you: `await` at the top level is fine, and a `return` returns the run result. Do not wrap it yourself — `export default async function () { … }`, a `function` wrapper of any kind, and any top-level `import` are refused `PARSE_ERROR` (which names the line and the construct). `export const meta = {…}` is the ONE exception, and it must be written exactly that way, as a literal object: dropping the `export` makes the whole declaration invisible to the engine, and every `agent()` label is then refused `AGENT_UNDECLARED`.

Every `agent(label, ...)` call in the script needs a matching `meta.params.agents.<label>` declaration — `model`, `effort`, and `timeoutMs` are all required, each with a `.default` (v24: there is no implicit engine default per agent). `appendPrompt`, `skills`, and `mcp` are optional. A working example:

```js
export const meta = {
  description: 'Summarize the given topic in one paragraph',
  params: {
    agents: {
      writer: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },
    },
  },
};
```

`meta.params.args` declares the run-time inputs the script reads off `args.<name>` — `{type, enum?, min?, max?, default?}`. A declared `.default` fills in the key when the caller omits it (or a run_start call omits `args` entirely); an explicit caller-supplied value always wins, including an explicit `undefined`. `type` is one of `string | number | enum` (an `enum` type requires the `enum` array of legal values).

`meta.params.knobs` and `meta.defaults` are retired — a script that declares either is refused `DEFAULTS_RETIRED`, naming `meta.params.agents.<label>.<key>.default` as the replacement.

The engine-owned keys are never written inside an `agent()` call's options literal — `model`, `effort`, `timeoutMs`, `appendPrompt` there are refused `SCAN_VIOLATION`, naming the key and the `meta.params.agents.<label>.<key>.default` it belongs in instead.

The options object is closed. An `agent()` option key that is not one of `prompt`, `label`, `phase`, `schema`, `isolation`, `mcp`, `allowedTools` is refused `SCAN_VIOLATION: PARAM_UNKNOWN` at registration, naming the key you wrote and listing the ones that are accepted. It is never silently dropped — before v25 it was, and an author who reached for a plausible-sounding name got a run that looked correct and ignored the option.

## The agent's tool surface

Each `agent()` call decides which tools its model may use, with `allowedTools`:

```js
const verdict = await agent('judge', { prompt: 'Answer with one word: PASS or FAIL.', allowedTools: [] });
const editor  = await agent('editor', { prompt: 'Fix the typo in README.md.', allowedTools: ['Read', 'Edit'] });
```

Two layers are **settable**, on the tool-calling (SDK gateway) path, and the first one present wins: the per-call `allowedTools` above, then this deployment's configured `defaultAllowedTools`. Only the first is settable from a script. If the deployment configures neither, the engine applies a built-in core set — `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash` — so a session is never handed the CLI's full uncurated tool list. (The direct-fetch transport has no tool surface at all — this section does not apply to it.)

`allowedTools: []` means no tools at all, and for a prose-only task that is usually what you want — especially on a smaller model. A smaller model handed a working tool surface tends to answer with a tool call rather than with prose: ask it to produce a summary while it holds `Write`, and the reply can come back as a tool-call envelope your script then has to unwrap. Emptying the surface removes the option and the model answers in text. It also makes the call markedly cheaper — the tool definitions are prompt tokens on every turn (measured on this engine: 162 input tokens with an empty surface against 1722 with the default one, for the same prompt).

## Host path grants

Whether `Bash` is confined to the run workspace depends on THIS deployment's measured posture, checked once at boot. This generated page is built before any host boots, so it cannot state which one applies to the deployment serving it — it describes both:

**Confined:** `Bash` may write inside the run workspace and nowhere else. A write outside it arrives as an ordinary `EACCES` inside the agent's own tool result, not as an engine refusal — a script that shells out to a global cache sees a failed command, not a special error your script can branch on.

A shared host path is possible but is an **operator grant** in `rwe.config.json`, never something a script requests — the list applied to a given run appears in that run's own `agent.confinement` log line.

**Unconfined:** On this deployment, `Bash` is **not confined**: the boot-time probe found no working sandbox on this host, so `Bash` runs with the same filesystem access as the engine process itself — not limited to the run workspace, and not limited to any operator-granted host path either. A **locally-submitted** run still executes exactly this way; that is the accepted cost of this deployment's posture, not a bug. A **remote submission** is refused before it ever reaches an agent — `run_start`/`run_resume` return a refusal instead of admitting Bash-capable work.

The live `workflow_authoring_guide` tool response states which posture is actually in force on the deployment serving it — check there, not here, before relying on either description.

## Prompt layering

After v34 there are exactly two author/caller segments in the prompt a model receives: the script's own `prompt` argument to `agent()`, then a caller-supplied `appendPrompt` override, framed inline as `<user-instructions untrusted="true">…</user-instructions>`. The engine adds only its own scaffolding around them (a schema suffix and a retry nudge) — it does not decide whether the appended segment is an authorized override or a foreign injection. An author who wants the appended segment to carry override force has to write the adoption rule into their OWN prompt; the engine draws no such line on the author's behalf.

## Locked vs. tunable

The six locked keys are engine-owned and can never be overridden by a caller: prompt, allowedTools, skills, mcp, workdir, cwd. The four tunable keys an override may target, per declared agent label, are: model, effort, timeoutMs, appendPrompt.

## Engine ceilings (this deployment)

The ceilings below are this build's resolved values — operator-overridable, so a different deployment's engine may render different numbers here: a declared agent's `timeoutMs.default` may not exceed 600000ms, a declared `appendPrompt.default` may not exceed 1024 bytes, and a declared `effort.default` may not rank above 'high'. A declaration above any of these ceilings is refused `PARAM_OUT_OF_RANGE` at registration — never silently clamped.

A declared `model.default` (and every entry of a declared `model.enum`) must be one of this deployment's model ALIAS names — `sonnet`, `haiku`, `opus`, `default` — not a provider model id. `models_list` shows the catalog MODELS an alias may resolve to; it is not the alias table, and passing an id from it is refused `PARAM_CONTRACT_INVALID: default not a known alias`. Each catalog row does carry an `aliases` list — every configured name that resolves to that one model — so a row is where you LOOK UP a legal name, and the row itself is never the answer. An `agent()` call naming an unknown alias is refused `UNKNOWN_ALIAS`. (The one exception is an `openrouter/<model-id>` passthrough, which the validator accepts by prefix and needs no entry in the table above.)

## Providers and the model catalog

Every model alias resolves to exactly one of three providers, each with its own declared capability row — read from the SAME table `resolveAlias`/`validateAliases` check against, labelled **declared, not probed**: nothing here is learned by dispatching a call.

- `anthropic` — tool surface: all, effort applies: yes
- `openrouter` — tool surface: all, effort applies: no (the provider has a reasoning dial, but this deployment's dispatch path does not carry it — `effortApplied` says so per call)
- `ollama` — tool surface: all, effort applies: no

There is no `openai` row: OpenRouter is the many-model front door for everything that is not Anthropic-direct or a local Ollama model, so swapping a model — or a transport — is a config change to an alias, not a new provider.

`models_list` shows the CATALOG this deployment's aliases can resolve into — it is not the alias table (see "Engine ceilings" above). It serves ONE row per model, and that row lists in `aliases` every configured name resolving to it (`ref` is the first — the one to pass to `agent({model})`), so a model named twice is one priced row, never a duplicate that reports `price:"unknown"`. Its `toolUseDeclared`/`effortDeclared` flags and `costLevel` rating are DECLARED capability, never probed by dispatching a call, and carry their own provenance: `declaredSource` ('upstream'|'static'|'unknown') says where the flag came from, and `catalogFetchedAt` is per-row catalog provenance (a timestamp, or `null`).

## Budget, concurrency, and how wide a fan-out really runs

`parallel([a, b, c, ...])` dispatches every thunk, and this deployment runs up to **24** of them at a time (`runConcurrency`, operator-configurable). Past that they QUEUE and run as slots free: a wider fan-out is slower, never truncated.

`run_start`'s `budget` takes TWO independent limits — `{usd?, tokens?}` — either of which may be omitted or `null` for unbounded. Each is a **stop-dispatching signal, not a hard ceiling**, and this is the honest description of what the engine can enforce. Before each dispatch it asks one question per armed limit: has this run already spent it? If yes, the call is refused `BUDGET_EXCEEDED`; if no, it goes. What a call will cost cannot be known before it finishes, so calls already in flight when a limit runs out still complete — a run can therefore overshoot EITHER limit by up to one concurrency window (24 x one call's cost). Size a budget for the whole workflow, not per call.

Inside the script, the read-only `budget` object answers each limit with its own accessor: `budget.limits.usd` / `budget.limits.tokens` are the two ceilings (`null` when that limit is unbounded — `null` is `===`-detectable but NOT comparison-safe, `null < 1000` is `true`); `budget.total` aliases `budget.limits.usd`; `budget.spent()` / `budget.remaining()` answer the USD limit only (`remaining()` is `null` when no USD limit is armed); `budget.tokens()` answers the token limit — it returns the four-column `{input, output, cacheRead, cacheWrite, sum}` spent so far. A USD budget counts only calls the model catalog can price — an unpriced call adds 0 to USD spend and never trips a USD limit — so set `budget.tokens` for a limit that binds on every model, including local ones with no listed price.

The four token columns are priced at four different rates, not one. On the Anthropic models this deployment prices statically, a cache READ costs about a tenth of a fresh input token and a cache WRITE costs more than one: the published multipliers are 1.25x input for a 5-minute cache and 2x for a 1-hour one. **This engine bills every cache write at 2x** — the usage it receives reports a single `cacheWrite` figure with no TTL in it, so the two cannot be told apart, and the more expensive of the two is the safe assumption for a spend limit (a budget that stops slightly early is recoverable; one that stops late is not). Your `costUSD` for a cache-writing call is therefore an upper bound, never an undercount.

A refusal is visible, and is NOT the same thing as your own thunk throwing:

- your thunk throws → `parallel()`/`pipeline()` give that slot `null` and the rest keep going (the documented contract);
- the ENGINE refuses to dispatch → the error PROPAGATES out of `parallel()` with the code `BUDGET_EXCEEDED`, the run fails with that code unless you catch it, and the refused call appears in `run_status.agents` as `state: 'refused'` with `reasonCode: 'BUDGET_EXCEEDED'`. A refusal rejects the WHOLE `parallel()` call, so its already-completed branches are not returned to you either. Catch it only if the run has something useful to do without them:

```js
let findings = [];
try {
  findings = await parallel(lenses.map((lens) => () => agent('researcher', { prompt: lens })));
} catch (e) {
  if (e.code !== 'BUDGET_EXCEEDED') throw e;
  // Out of budget: `findings` is still [] — this phase produced nothing. Continue with what
  // earlier phases returned, or rethrow to fail the run with BUDGET_EXCEEDED.
}
```

Branch on `e.code` — not on `e instanceof Error`. Your script runs in a `node:vm` context whose intrinsics are a different realm from the engine that raises these errors, so `instanceof` is **false** for anything the engine hands you: engine errors, and `args` and its contents alike (`args instanceof Object` is false; `Array.isArray(args.xs)` is true — realm-safe checks work). Errors you construct yourself inside the script are ordinary and unaffected. Every engine refusal carries the same `e.code`/`e.name` catalog code as `run_result.error.code`, plus a human `e.message`.

## The author-supplied diagram

Every registration requires a non-empty Mermaid `mermaid` string (`MERMAID_REQUIRED`) — the engine no longer draws the diagram for you (that generator is retired: registering a script used to send the whole script body to an LLM as a prompt; the diagram is now yours to draw, so nothing you write is sent anywhere just to produce a picture). A node is `id<shape>`, one per line, and these are the shapes this engine accepts — nothing else parses:

- `[/"…"/]` (trapezoid) — trigger / output
- `(["…"])` (stadium) — agent node — participates in the label diff + value triple
- `{"…"}` (diamond) — conditional
- `{{"…"}}` (aggregation) — non-agent aggregation
- `["…"]` (rectangle) — nested workflow() black box — free text, excluded from the diff

The stadium (agent) nodes MUST exactly match your script's `agent()` labels, checked both ways: an agent label with no matching node, or a stadium node with no matching label, is `DIAGRAM_MISMATCH`. The other four shapes are free text and are excluded from that check.

An agent node may also carry its resolved settings after a `<br/>`, as the triple `label<br/>model · effort · timeout` (separated by ` · `, a space-padded middle dot; the timeout as `120s`, `120000` or `120000ms`). If you write the triple it must AGREE with that label's declared defaults — a disagreement is refused `VALUE_MISMATCH`. A node with no `<br/>` is simply not compared, so the triple is optional and, once written, is held to the contract.

Edges:

- `a-->b` — directed edge — participates in cycle detection
- `a-.->b` — directed dashed edge (e.g. a skipped path) — participates in cycle detection
- `a<-->b` — bidirectional edge (e.g. a debate) — EXCLUDED from cycle detection

An edge may carry a label as `a-->|text|b`. Write ONE edge per line: the `&` fan-out shorthand (`a-->b & c`) is refused `COLLAPSED_EDGE` — the checker matches your diagram against your script edge by edge. Any edge that sits inside a cycle (a directed loop back to an ancestor, or a self-loop) MUST carry a `|label|` — describe what the loop is doing (e.g. `|revise|`), not just that it loops. A `subgraph "title"` / `end` pair boxes related nodes (e.g. a debate) under a mandatory quoted title. For a live preview before you register, paste your diagram into a Mermaid live editor (e.g. https://mermaid.live/) — this guide only checks the grammar, it does not render.

## Canonical diagram

From v26 every NEW registration is checked against the shape of your own script, not just against its label set. Four rules, each with its own refusal code, each carrying the line and the structure the checker EXPECTED (as data — the engine never hands you a corrected diagram; writing it is the point).

1. **Direction — `DIAGRAM_DIRECTION`.** The first line must be `graph LR` or `flowchart LR`. The diagram is a swimlane read left to right; `TD` is refused before anything structural is looked at, because a top-down diagram has no lanes to check.
2. **Lanes — `LANE_MISMATCH`.** One `subgraph "title"` / `end` block per `phase()` call in your script, in CALL ORDER, and every agent node declared inside the lane of the `phase()` it is dispatched under. A phase title computed at runtime (`phase('tier:' + args.tier)`) is matched by POSITION, so any non-empty title is accepted for that lane. This is why every `agent()` must sit inside a `phase()`: a call before your first `phase()` is refused `AGENT_BEFORE_PHASE`, since an unnamed zeroth lane is neither checkable nor drawable.
3. **Tools — `TOOLS_MISMATCH`.** An agent node may carry a third `<br/>` segment naming its tool surface: `label<br/>model · effort · timeout<br/>tools: Edit, Read` — the names sorted, comma-space separated, exactly the literal `allowedTools` array on that `agent()` call, or `tools: none` when you passed `allowedTools: []`. If the call declares no `allowedTools` at all, the segment is NOT compared: write `tools: default` (the honest word for "whatever this deployment configures") or leave the segment off.
4. **Edges — `EDGE_MISMATCH`.** Consecutive calls in your script must be joined in the diagram, across lane boundaries too. A path may run through non-agent shapes (a diamond for a branch, an aggregation for a non-agent join), which is how you draw a ternary or an `if/else`. A direct agent→agent edge between calls that are NOT consecutive needs a `|label|` saying what it means. Members of one `parallel([...])` (or of the two arms of one branch) are never edged to each other — they fan in to whatever follows.

A script whose shape a static read cannot resolve at all — an `agent()` inside a `for`, `while` or `switch` body — makes that lane DYNAMIC: it predicts no slots, so rules 3 and 4 have nothing to compare there. Declare the agent's node inside that lane anyway; the label check (both ways) still applies.

Minimal accepted example:

```
graph LR
subgraph "draft"
writer(["writer"])
end
subgraph "review"
critic(["critic"])
end
writer-->critic
```

Versions registered BEFORE v26 are grandfathered: they keep `diagramContract: 'v1'`, are never re-checked, and render exactly as they always did. `workflow_describe` tells you which contract a version was admitted under.

## Seeding a workspace

A run's workspace can be pre-populated three ways on `run_start`, mutually exclusive with each other and with `seedRef` (a mixed request is refused `SEED_SOURCE_CONFLICT`):

- `seed` — Seed files by inline content — each element is {path, contentB64}, the file bytes as base64. Refused INVALID_SEED_SPEC if any element is missing contentB64.
- `seedManifest` — Seed files already pushed to the CAS via workspace_push — each element is {path, sha256, exec?}, referenced by hash rather than carrying content inline. Use for large trees, or content you already have a sha256 for.
- `seedManifestRef` — Seed the whole workspace from ONE manifest previously pushed as a CAS blob — the sha256 of that manifest.
- `workspace_push` — Push content: a CAS blob into the caller's own pool, or a workflow-owned asset (skill/mcp). Any runId argument is refused — see workflow_authoring_guide.

Every `seed`/`seedManifest`/`seedManifestRef` element that does not match its declared shape is refused `INVALID_SEED_SPEC` before a single byte is written — a `seed` element missing `contentB64` (or carrying only a `sha256`) does NOT silently materialize a 0-byte file; the refusal names the offending `path` and points at `seedManifest` instead. Content referenced only by hash (`seedManifest`, `seedManifestRef`) must already exist in the CAS — push it first with `workspace_push`.

## Three things a cold author gets wrong

A **sequential** `await agent(label, options)` call that fails or times out resolves to `null` for that reason — it does not throw. (An ENGINE refusal, e.g. `BUDGET_EXCEEDED`, is a different case and still propagates as a thrown error — see "Budget, concurrency" above.) Guard every sequential call the same way `parallel()`'s own thunks already are:

```js
const out = await agent('reviewer', { prompt: 'Review the draft' });
if (out === null) {
  // the agent failed or timed out — there is no result to read here
  return;
}
```

`timeoutMs` bounds ONE attempt, never the whole call: this deployment retries a failed attempt, and the deployed retry count multiplies the single-attempt bound into the actual worst-case wait — `workflow_describe` reports the multiplied figure as that agent's `timeoutMs.worstCaseMs`, next to the single-attempt `timeoutMs.default`. An `agent()` call with no timeoutMs set — neither on the call itself (`timeoutMs`) nor as this deployment's own configured default — runs once: retries apply only to a call that has a bounded timeout in effect.

Every tool result — including this guide's own — arrives as a JSON string inside `content[0].text`, never as a structured object: parse it again to reach the actual payload.

A run's structured refusal marker (`refusalRef`, carried internally from the sandbox to the run's own ledger) is engine-attested — it can only name a refusal this SAME run genuinely raised. `error.code` alone is **not** attested and never has been: a script that catches an error and sets `e.name` before rethrowing it can forge any code, with no marker to back it.

## Registration and versioning

The normal loop: `workflow_register` a script under a name, `run_start({name, version})` the version it just returned to iterate, and once it is stable `workflow_publish(release)` it — registering the same name again appends a new version and never overwrites an existing one. The rest of this section is exceptions, not the common path.

Registering a script that predates the v24 contract (or was never migrated) resolves `runnable:false` with `runnableReason: LEGACY_REREGISTER` — re-register it under the current contract; there is no legacy-resolution ladder. Omitting a currently-registered trigger from a new version does not release it (omission does not release) — deregister the trigger explicitly if you mean to stop it. A `once` trigger is consumed on its firing attempt — whether that attempt succeeds or is refused — and will not fire again; a refused `cron` firing instead gets a fresh future `nextFire` and tries again next time. Assets (skills/mcp) registered under an owner are shared across every version of that workflow name, not pinned to the version that first declared them.

## Authoring rules this engine enforces (refused with this code)

- `NOT_TRIGGER_OWNER` — the caller does not own (did not create) this trigger
- `PARSE_ERROR` — the script body failed to parse as TypeScript
- `UNKNOWN_ALIAS` — a model alias in the script is not in the configured alias table
- `MCP_NOT_PROVISIONED` — an agent() call references an mcp name with no provisioned secret
- `SCRIPT_INVALID` — the script violates a sandbox-enforced structural rule
- `SCAN_VIOLATION` — an agent() call is not scannable — label/options must be literal (ADR-029)
- `MERMAID_INVALID` — the diagram does not parse under checkMermaid's grammar
- `MERMAID_REQUIRED` — v24 registration requires a non-empty mermaid diagram string (ADR-025)
- `DIAGRAM_MISMATCH` — the diagram's agent labels disagree with the script's
- `DIAGRAM_DIRECTION` — a v2 diagram header must be graph LR / flowchart LR
- `LANE_MISMATCH` — the diagram's subgraph lanes (count/order/title, or a stadium's containing lane) disagree with the script's phases
- `TOOLS_MISMATCH` — a stadium's tools: line disagrees with the script's allowedTools for that label
- `EDGE_MISMATCH` — the diagram's edges do not realise the script's consecutive-slot flow
- `AGENT_BEFORE_PHASE` — under the v2 diagram contract every agent() must be dispatched inside a phase() — add a phase() before the first agent()
- `AGENT_UNDECLARED` — a script agent() label has no params.agents.<label> declaration
- `AGENT_DECLARED_NOT_IN_SCRIPT` — params.agents declares a label no agent() call in the script uses
- `PARAM_CONTRACT_INVALID` — the declared parameter contract itself is malformed or out of its own bounds
- `PARAM_OUT_OF_RANGE` — a declared or overridden parameter value is outside its allowed range
- `PARAM_LOCKED` — a caller override targets a key the author locked (prompt/allowedTools/skills/mcp/workdir/cwd)
- `PARAM_UNKNOWN` — a caller override names a parameter the contract does not declare
- `UNKNOWN_AGENT_LABEL` — a caller override names an agent label the contract does not declare
- `DEFAULTS_RETIRED` — meta.params.knobs / meta.defaults are retired; declare params.agents.<label> instead
- `LEGACY_REREGISTER` — this version predates the v24 contract and cannot run; re-register it
- `INLINE_SCRIPT_CLOSED` — inline run-time scripts are closed; register once, then run by name
- `NESTING_DEPTH_EXCEEDED` — nested workflow() calls exceed the configured maxWorkflowDepth
- `NESTING_CYCLE` — a workflow() call would re-enter an ancestor already on this call's chain
- `DESCENDANT_CAP_EXCEEDED` — nested workflow() calls exceed the configured maxWorkflowDescendants
- `TRIGGER_NOT_FOUND` — no trigger (schedule or webhook) is registered under this id
- `TRIGGER_ALREADY_CLAIMED` — this trigger id is already claimed by a different workflow
- `BUDGET_EXCEEDED` — the run's token budget is spent; the engine refused to dispatch this agent() call
- `RESERVED_PREFIX` — the name or a path segment starts with the engine-reserved 'rwe-' prefix (ARCH-093)
- `INVALID_SEED_SPEC` — the seed/seedManifest/seedManifestRef payload does not match its declared shape

## Authoring convention (not checked)

Declare every knob a user might need in `meta.params` rather than hard-coding it, and never read a value the contract does not declare: a value the script reaches for but the contract never named cannot be tuned by a caller, cannot be shown by `workflow_describe`, and cannot be bounded by the engine ceilings. Nothing refuses it — the cost is simply that the workflow can only be changed by editing it.

Phase titles (`phase(title)` and `meta.phases[].title`) are visible to every principal who can see the workflow, including the non-owner projection and your own `mermaid` diagram, which `workflow_describe` serves verbatim to any caller — a phase title is not a private annotation, so keep secrets and distinctive internal prose out of it. The diagram you draw is structure-only: it is your responsibility, not an enforced check, to keep secrets out of node text and labels.

## Registered examples

### single agent

```js
export const meta = {
  description: 'Summarize the given topic in one paragraph',
  params: { agents: { writer: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
};
phase('summarize');
return await agent('writer', { prompt: 'Summarize the topic' });
```

Mermaid:

```
graph LR
subgraph "summarize"
writer(["writer<br/>default · low · 60000<br/>tools: default"])
end
```

### three-stage pipeline

```js
export const meta = {
  description: 'Draft, then edit, then finalize a piece of text',
  params: { agents: { draft: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, edit: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, final: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
};
phase('draft');
const drafted = await agent('draft', { prompt: 'Write a first draft' });
phase('edit');
const edited = await agent('edit', { prompt: 'Improve the draft: ' + drafted });
phase('final');
return await agent('final', { prompt: 'Polish: ' + edited });
```

Mermaid:

```
graph LR
subgraph "draft"
draft(["draft<br/>default · low · 60000<br/>tools: default"])
end
subgraph "edit"
edit(["edit<br/>default · low · 60000<br/>tools: default"])
end
subgraph "final"
final(["final<br/>default · low · 60000<br/>tools: default"])
end
draft-->edit
edit-->final
```

### fan-out/fan-in

```js
export const meta = {
  description: 'Fan out research to three topics in parallel, then combine the results',
  params: { agents: { alpha: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, beta: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, gamma: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, combiner: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'medium' }, timeoutMs: { type: 'number', default: 90000 } } } },
};
phase('research');
const results = await parallel([
  () => agent('alpha', { prompt: 'Research topic A' }),
  () => agent('beta', { prompt: 'Research topic B' }),
  () => agent('gamma', { prompt: 'Research topic C' }),
]);
phase('combine');
return await agent('combiner', { prompt: 'Combine: ' + results.join(', ') });
```

Mermaid:

```
graph LR
subgraph "research"
alpha(["alpha<br/>default · low · 60000<br/>tools: default"])
beta(["beta<br/>default · low · 60000<br/>tools: default"])
gamma(["gamma<br/>default · low · 60000<br/>tools: default"])
end
subgraph "combine"
combiner(["combiner<br/>default · medium · 90000<br/>tools: default"])
end
alpha-->combiner
beta-->combiner
gamma-->combiner
```

### ternary routing

```js
export const meta = {
  description: 'Classify urgency, then route to a fast or thorough agent',
  params: { agents: { classifier: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, fast: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, thorough: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'high' }, timeoutMs: { type: 'number', default: 120000 } } } },
};
phase('classify');
const urgency = await agent('classifier', { prompt: 'Classify urgency: fast or thorough?' });
phase('route');
return await (urgency === 'fast' ? agent('fast', { prompt: 'Answer quickly' }) : agent('thorough', { prompt: 'Answer thoroughly' }));
```

Mermaid:

```
graph LR
subgraph "classify"
classifier(["classifier<br/>default · low · 60000<br/>tools: default"])
end
subgraph "route"
routeChoice{"fast or thorough?"}
fast(["fast<br/>default · low · 60000<br/>tools: default"])
thorough(["thorough<br/>default · high · 120000<br/>tools: default"])
end
classifier-->routeChoice
routeChoice-->|fast|fast
routeChoice-->|thorough|thorough
```

### conditional

```js
export const meta = {
  description: 'Classify the input, then branch to one of two agents',
  params: { agents: { classifier: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, simple: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, complex: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'high' }, timeoutMs: { type: 'number', default: 120000 } } } },
};
phase('classify');
const kind = await agent('classifier', { prompt: 'Classify the request' });
phase('handle');
if (kind === 'simple') {
  return await agent('simple', { prompt: 'Handle the simple case' });
} else {
  return await agent('complex', { prompt: 'Handle the complex case' });
}
```

Mermaid:

```
graph LR
subgraph "classify"
classifier(["classifier<br/>default · low · 60000<br/>tools: default"])
end
subgraph "handle"
handleChoice{"simple or complex?"}
simple(["simple<br/>default · low · 60000<br/>tools: default"])
complex(["complex<br/>default · high · 120000<br/>tools: default"])
end
classifier-->handleChoice
handleChoice-->|simple|simple
handleChoice-->|complex|complex
```

### non-agent aggregation

```js
export const meta = {
  description: 'Score three candidates with an agent, then pick the best score without another agent call',
  params: { agents: { scorerX: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, scorerY: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, scorerZ: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
};
phase('score');
const scores = await parallel([
  () => agent('scorerX', { prompt: 'Score candidate X' }),
  () => agent('scorerY', { prompt: 'Score candidate Y' }),
  () => agent('scorerZ', { prompt: 'Score candidate Z' }),
]);
return scores.reduce((best, s) => (Number(s) > Number(best) ? s : best), scores[0]);
```

Mermaid:

```
graph LR
subgraph "score"
scorerX(["scorerX<br/>default · low · 60000<br/>tools: default"])
scorerY(["scorerY<br/>default · low · 60000<br/>tools: default"])
scorerZ(["scorerZ<br/>default · low · 60000<br/>tools: default"])
aggregate{{"pick the best score (no agent call)"}}
end
scorerX-->aggregate
scorerY-->aggregate
scorerZ-->aggregate
```

### draft, critique, revise

```js
export const meta = {
  description: 'Write a draft, get one round of critique, then revise — an unrolled fixed-length sequence (an agent call inside a loop body cannot be statically checked)',
  params: { agents: { writer: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, critic: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
};
phase('draft');
const drafted = await agent('writer', { prompt: 'Write a draft' });
phase('critique');
const verdict = await agent('critic', { prompt: 'Critique: ' + drafted });
phase('revise');
return await agent('writer', { prompt: 'Revise using: ' + verdict });
```

Mermaid:

```
graph LR
subgraph "draft"
writer1(["writer<br/>default · low · 60000<br/>tools: default"])
end
subgraph "critique"
critic(["critic<br/>default · low · 60000<br/>tools: default"])
end
subgraph "revise"
writer2(["writer<br/>default · low · 60000<br/>tools: default"])
end
writer1-->critic
critic-->writer2
```

### nested workflow() black box

```js
export const meta = {
  description: 'Delegates to another registered workflow, then summarizes its result',
  params: { agents: { summarizer: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
};
phase('delegate');
const child = await workflow('other-team-etl', { since: 'yesterday' });
phase('summarize');
return await agent('summarizer', { prompt: 'Summarize: ' + JSON.stringify(child) });
```

Mermaid:

```
graph LR
subgraph "delegate"
etl["workflow: other-team-etl (black box)"]
end
subgraph "summarize"
summarizer(["summarizer<br/>default · low · 60000<br/>tools: default"])
end
```

### parallel workflow() delegation

```js
export const meta = {
  description: 'Delegates to two other registered workflows in parallel — a parallel() of workflow() calls yields no agent slot',
  params: { agents: {} },
};
phase('delegate');
const [a, b] = await parallel([
  () => workflow('sub-a', {}),
  () => workflow('sub-b', {}),
]);
return { a, b };
```

Mermaid:

```
graph LR
subgraph "delegate"
subA["workflow: sub-a (black box)"]
subB["workflow: sub-b (black box)"]
end
```

### declared args

```js
export const meta = {
  description: 'Uses a declared arg to steer the single agent call',
  params: { args: { topic: { type: 'string' } }, agents: { writer: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
};
phase('write');
return await agent('writer', { prompt: 'Write about: ' + args.topic });
```

Mermaid:

```
graph LR
subgraph "write"
writer(["writer<br/>default · low · 60000<br/>tools: default"])
end
```

### dynamic phase title

```js
export const meta = {
  description: 'The phase title is computed from a declared arg — a static scan cannot know it in advance',
  params: { args: { tier: { type: 'string' } }, agents: { worker: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
};
phase('tier:' + args.tier);
return await agent('worker', { prompt: 'Handle the request' });
```

Mermaid:

```
graph LR
subgraph "processing"
worker(["worker<br/>default · low · 60000<br/>tools: default"])
end
```

### skills and mcp

```js
export const meta = {
  description: 'An agent declared with a skill name, an mcp server name, and a curated tool set',
  params: { agents: { coder: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'medium' }, timeoutMs: { type: 'number', default: 120000 }, skills: ['repo-search'], mcp: ['project-tracker'] } } },
};
phase('code');
return await agent('coder', { prompt: 'Fix the failing test', allowedTools: ['Read', 'Edit'] });
```

Mermaid:

```
graph LR
subgraph "code"
coder(["coder<br/>default · medium · 120000<br/>tools: Edit, Read"])
end
```

### no tools — pure reasoning

```js
export const meta = {
  description: 'A judge agent restricted to no tools at all — pure text reasoning',
  params: { agents: { judge: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
};
phase('judge');
return await agent('judge', { prompt: 'Answer PASS or FAIL', allowedTools: [] });
```

Mermaid:

```
graph LR
subgraph "judge"
judge(["judge<br/>default · low · 60000<br/>tools: none"])
end
```
