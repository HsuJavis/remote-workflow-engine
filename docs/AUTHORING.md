# Authoring a workflow script

This engine has no bundled guidance skill — the tool schemas returned by `tools/list` are the only documentation a cold MCP client ever sees, and `workflow_authoring_guide` (this text) is what every authoring error's `see` field points back to.

## The sandbox API

A workflow script runs inside a restricted VM context with exactly these globals — nothing else is reachable (`agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, `budget`, `workflow`, `Date`, `Math`, `Intl`; `Date`/`Math`/`Intl` are GUARDED, see below). The script body IS the function the engine calls — write statements and a `return`, with no `function`/`async function` DECLARATION wrapped around any of it (`const thunk = () => agent(...)`, used for parallel()/pipeline(), is fine — only a top-level `function` STATEMENT is refused, `PARSE_ERROR`, issue #154). Call `agent`/`phase`/`parallel`/`pipeline`/`workflow` DIRECTLY — `agent('label', {...})`, not `const a = agent; a(...)` or `agent.call(...)` — registration can only see a call it can read at the call site; an alias, a `.call`/`.bind`, or any other indirection is refused `SCRIPT_INVALID` (issue #154).

- `await agent(label, options)` — dispatches one agent call. `label` MUST be a literal string identifier (`/^[A-Za-z_][\w-]*$/`) matching a `meta.params.agents.<label>` declaration; this positional is the call's real contract key — it selects the label's per-agent model/effort/timeoutMs/skills/mcp and is reported back as `run_status.agents[].agentKey` (issue #165). `options.label`, if set, is a SEPARATE, purely cosmetic display name — reported as `agents[].label` (defaulting to the same positional when `options.label` is absent) — that two different agent() calls may share on purpose; it selects nothing. run_agent_log's `label` argument matches `agentKey` FIRST across every call, and only falls back to `label` when none matches — a value that is one call's agentKey always resolves to THAT call even when it also collides with a different call's cosmetic label; pass `agentId` to reach one specific call when several genuinely share the SAME value within the SAME field (agentKey, or failing that, label) — array order then decides. `options` MUST be a literal object: no variable, no spread (`{...x}`), no shorthand property (`{allowedTools}`) — every entry must be written `key: value` at the syntax level so this scan can see each key at all (a spread entry hides every key it carries, a shorthand entry hides its value; both are refused `AGENT_OPTS_SPREAD` / `AGENT_OPTS_SHORTHAND` at registration, issue #154). That is a rule on the OBJECT'S SHAPE, not on every key's VALUE: `prompt`, `schema`, and every other option may be any runtime expression, read live at dispatch. Only TWO keys additionally require their OWN value to be a literal, checked key-by-key at registration: `allowedTools` (a `[...]` array literal of quoted strings only — `allowedTools: tools` (a variable), `allowedTools: cfg.tools` (a member expression), or `allowedTools: getTools()` (a call) are all refused `AGENT_OPTS_VALUE_NOT_LITERAL` even though the key itself is written literally) and `bash` (only the literal string `'readonly'` — any other value, including a variable, is refused `BASH_MODE_INVALID`). A literal `schema` that can never be a valid JSON Schema (a string/number/array/null/template-literal — `schema: 'not-a-schema'`) is refused `AGENT_OPTS_SCHEMA_INVALID` at registration too (issue #162); an object literal (checked for real JSON-Schema validity only at dispatch, via ajv — `INVALID_SCHEMA`) or the literal booleans `true`/`false` (valid JSON Schema on their own) are both accepted here, and a NON-literal `schema` value — a variable, a function call building the schema at runtime — registers successfully and is left entirely to that same dispatch-time ajv check.
- `await parallel([thunk, ...])` — runs an array of zero-argument thunks concurrently, each returning `null` on its own thrown error rather than rejecting the whole call.
- `await pipeline([item, ...], stage1, stage2, ...)` — runs each item through the stage chain.
- `phase(title)` — names the current step for observability. Titles are public (see below). `meta.phases: [{title}, ...]` is REQUIRED and must equal these calls in count/order (see 'Declaring the parameter contract' below).
- `log(...)` — a no-op placeholder in this sandbox (accepted, does nothing).
- `args` — the caller-supplied run arguments, shaped by `meta.params.args`.
- `budget` — read-only: `{limits: {usd, tokens}, total, spent(), remaining(), tokens()}` (see "Budget, concurrency" below for which accessor answers which limit).
- `await workflow(name, args)` — runs another registered workflow. A workflow() call may itself call workflow() again, recursing up to this deployment's configured `maxWorkflowDepth` (cycle-checked, descendant-capped) — a call that exceeds the depth is refused `NESTING_DEPTH_EXCEEDED`, one that would re-enter an ancestor on its own chain is refused `NESTING_CYCLE`, and one that pushes the run past its descendant cap is refused `DESCENDANT_CAP_EXCEEDED`. (An earlier one-level cap with a flatten-it instruction is what an older draft of this guide taught — that no longer matches what's shipped.) Even with depth available, the simplest and most readable script still flattens a needless wrapper into its caller, and draws another owner's workflow as a black-box rectangle node in your diagram rather than expanding it. A nested workflow()'s own phase() calls are recorded on THAT sub-workflow's card, not folded into the parent run as one of its lanes. Its agent() calls run on THAT workflow's own `meta.params.agents` defaults — your run's `overrides.agents` never reach them (labels belong to the workflow that declares them, even when a name collides) — and its models are priced into, and bound by, your run's budget.

`Date`, `Math`, and `Intl` are present but GUARDED — the calls below are refused `DETERMINISM_GUARD` because resume replays agent() calls keyed by prompt+opts, so a wall-clock or random value baked into that key would change it on replay and re-dispatch an already-paid call:

- `Date.now()` — refused `DETERMINISM_GUARD`. resume replays agent() calls keyed by prompt+opts, so a wall-clock value baked into that key would change it on replay and re-dispatch an already-paid call. Instead: read a timestamp off run_status/run_result, or pass one in via args.
- `Math.random()` — refused `DETERMINISM_GUARD`. the same replay-key hazard as Date.now() — a random value baked into the key changes on every run. Instead: pass a seed in via args.
- `new Date()` — refused `DETERMINISM_GUARD`. called with no arguments this reads the wall clock, the same hazard as Date.now(). Instead: pass an argument — new Date('2026-01-01') is allowed.
- `new Intl.DateTimeFormat()` — refused `DETERMINISM_GUARD`. Intl.DateTimeFormat (and its format()/formatToParts()/resolvedOptions() methods) reads the wall clock the same way Date.now() does, the same replay-key hazard. Instead: format a timestamp off run_status/run_result or args yourself, or pass a pre-formatted string in via args.

`setTimeout`, `fetch`, `require`, `process`, and `fs` are genuinely absent from this context (not merely shadowed) — standard `node:vm` behavior, unrelated to the guards above. `console` IS present (unlike the five above) but writes nowhere observable — a `node:vm` context gets its own inert console whose output never reaches this engine's logs or your run's result; it is harmless, just not useful; `log(...)` (listed above) is this engine's own no-op placeholder, included for forward compatibility, not a working substitute today.

Security containment here is THREE independent layers, not one — defeating any single one still leaves your script stopped by the next:

1. **In-realm hardening** (`node:vm`, hygiene, not a boundary by itself): every value exposed into your script — `agent`/`parallel`/`pipeline`/`phase`/`log`/`workflow`, the `Math.random`/`Intl.DateTimeFormat`/`Date.now` guards, the budget accessors — is built NATIVE to your script's own vm context (not merely given its `[[Prototype]]` severed after the fact), and so is the context's global object itself (`globalThis`/top-level `this`), reparented to the context's own `Object.prototype` instead of keeping the engine's. The context additionally disables code generation from strings (`codeGeneration: { strings: false }`), so even the context's own (otherwise harmless) `Function`/`eval` cannot build new code from a string, and your script body is compiled strict-mode and invoked with no receiver, so a bare top-level `this` is `undefined`, not the global object — closing `this.constructor...`, `eval(...)`, `globalThis.constructor...`, and (as a side effect of strict mode) `arguments.callee`/`.caller` and `Error.prepareStackTrace` reassignment (a classic `vm`-sandbox stack-walking escape, locked to always-`undefined` on this call's own `Error`) all at once. `node:vm` itself still documents that it does not provide a complete boundary, so this layer is treated as hygiene, not as the reason the next two layers are "just in case".

2. **Empty child environment**: your script runs in a real, separate OS process (layer 3 below), forked with NO inherited environment at all — no provider API keys, no `RWE_SECRET_*`, nothing from the engine's own process.env. Even if layer 1 were ever defeated by an escape nobody has found yet, the process it reaches carries no secrets to begin with.

3. **OS-level containment of that same process**: it is launched under Node's own permission model (`--permission`), with filesystem READ permitted only for the engine's own source directory (nothing else — not your workspace, not the rest of the host) and NO permission at all to write files, spawn a child process, start a worker thread, or load a native addon. So even a live `process` handle reached through a future layer-1 regression cannot read an arbitrary host file or run a shell command — both fail closed with `ERR_ACCESS_DENIED`.

Treat anything a script can reach as untrusted until it leaves the forked child regardless — these layers are independent precisely so that a gap found in one is still caught by another.

A script's own top-level `return` value (and an agent()/workflow() call's resolved value, which crosses the same boundary) must be JSON-serializable — no circular references, no BigInt — and under 10MB serialized; either violation is refused (`RESULT_NOT_SERIALIZABLE` / `RESULT_TOO_LARGE`) rather than crashing the run. Return a summary or a reference (an id, a CAS blob hash) instead of a large payload. `RESULT_NOT_SERIALIZABLE` also rejects an agent()/workflow()/phase() call whose OWN arguments aren't JSON-serializable (there is no size check on a call's own arguments, so `RESULT_TOO_LARGE` never applies there) — that failure is local to the one call your script made and is catchable with a normal try/catch, not run-terminating.

Two more limits bound the sandbox itself, independent of anything your script does right or wrong: the run has a wall-clock deadline (`maxRunDurationMs`, 4 HOURS by default, operator-configurable — covering every agent()/workflow() round trip across every phase, not a single call, which `timeoutMs` already bounds — raised or lowered per deployment via rwe.config.json's own maxRunDurationMs key, issue #157 follow-up) and the sandboxed process has a memory cap. Exceeding either terminates the run with a coded `SCRIPT_TIMEOUT` or `SCRIPT_OOM` rather than hanging forever or crashing opaquely — including a synchronous infinite loop (`while(true){}`), which blocks the script's own event loop and so cannot be caught or reported from inside the script itself. The same deadline is what ends the asynchronous equivalent too: a script that `await`s a Promise that never resolves or rejects (e.g. `await new Promise(() => {})`) leaves the run `running` indefinitely from the caller's side — polling `run_status` shows no progress and no error — until EITHER `maxRunDurationMs` elapses (the same `SCRIPT_TIMEOUT` above) or someone calls `run_stop` on it; neither the script nor anything it awaits can end that wait from the inside.

## Declaring the parameter contract

**The script body is a bare async function body.** The statements you send as `script` ARE the body of an `async function` the engine wraps for you: `await` at the top level is fine, and a `return` returns the run result. Do not wrap it yourself — `export default async function () { … }`, a top-level `function`/`async function` STATEMENT, and any top-level `import` are refused `PARSE_ERROR` (which names the line and the construct). A `const` arrow function used as a thunk (for `parallel()`/`pipeline()`, or called back out by name) is fine — but an `agent()`/`phase()` call written inside ANY function (a `const`-bound arrow, a nested `function` declaration, …) that the script never demonstrably reaches is refused `SCRIPT_INVALID`, issue #154: the engine counts the call site as live and the run silently dispatches nothing. "Demonstrably reaches" is a plain NAME census (does the bound name appear anywhere else in the script at all), never a real reachability analysis of control flow — a name referenced only from inside a branch that can never execute (e.g. `if (false) await main()`, or any other always-false condition) still counts as "reached" and registers cleanly, same as a genuinely live call; this is a known, deliberate scope line (a real reachability analysis rejected legitimate patterns this codebase relies on — see script-checks.ts's own doc), not a gap this guide hides. `export const meta = {…}` is the ONE exception to the no-wrapper rule, and it must be written exactly that way, as a literal object: dropping the `export` makes the whole declaration invisible to the engine, and every `agent()` label is then refused `AGENT_UNDECLARED`.

Every `agent(label, ...)` call in the script needs a matching `meta.params.agents.<label>` declaration — `model`, `effort`, and `timeoutMs` are all required, each with a `.default` (v24: there is no implicit engine default per agent). `appendPrompt`, `skills`, and `mcp` are optional. A working example:

```js
export const meta = {
  description: 'Summarize the given topic in one paragraph',
  phases: [{ title: 'summarize' }],
  params: {
    agents: {
      writer: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } },
    },
  },
};
```

A declared `model.default` (and every entry of a declared `model.enum`) MUST be a full `<provider>/<model-id>` ref — providers are exactly `anthropic`, `openrouter`, `ollama` — split at the FIRST `/` (an openrouter id can itself carry further `/`s, e.g. `openrouter/openai/gpt-4.1`; an ollama id can carry `:`/`.`, e.g. `ollama/qwen2.5:7b`). There are no aliases, no bare names, and no `'default'`/`'local'`-style shortcut — a bare name, an unrecognized provider prefix, or an empty model id is refused `UNKNOWN_MODEL`, naming the expected form and the three providers. `models_list` shows the catalog this deployment can reach: each row's `ref` field IS the exact string to paste — copy it verbatim, never hand-type a variant. An openrouter/ollama ref is checked against that provider's live catalog listing when one is available (refused `UNKNOWN_MODEL` if genuinely absent from it; accepted with a non-fatal `MODEL_CATALOG_UNVERIFIED` warning if the listing could not be checked); an anthropic id not yet in this deployment's static price table is likewise accepted with that same warning — a new Anthropic model is never blocked. The model is bound once at `workflow_register` time (the `.default` above) and may be replaced with a different full ref per run via `run_start`'s `overrides.agents.<label>.model` — there is no other override surface (a scheduled/webhook-fired run, and a nested `workflow()` call, always use the target version's own bound `.default`). A `gateway:"pi"` deployment narrows this to only `openrouter`/`ollama` — see the pi harness note below for the exact refusal code and remediation.

**Declaring `meta.phases`.** `meta.phases: [{title}, ...]` is REQUIRED and must equal your script's own `phase()` calls, in the same count and order — the SAME `writer: {...}` shape above but with `phase('summarize');` in the script body. A script with zero `phase()` calls must still declare `phases: []` explicitly (an absent key is refused even then). Refused `PHASES_REQUIRED` when `meta.phases` is missing, not an array, or has an entry with no string `title`; `PHASES_MISMATCH` when it disagrees with the script — count, order, or title (the message names both lists and the first difference). A `phase()` call whose title is computed at runtime (`phase('tier:' + args.tier)`) cannot be checked textually — declare ANY non-empty title for it, at the right position; only the position, never the text, is checked there (mirrors the diagram's own dynamic-lane rule below). This is what `workflow_describe`'s `phases` reads back (`phasesSource:'declared'`); a version registered before this rule existed has its `phases` DERIVED from its own `phase()` calls instead (`phasesSource:'derived'`) rather than reported empty.

**Skills.** `skills: [name, ...]` names skills pushed with `workspace_push` (`kind: 'skill'`). Register the workflow FIRST (`workflow_register`), then `workspace_push` each declared skill against that already-registered name — a push naming an unregistered workflow is refused `WORKFLOW_NOT_FOUND`; registration itself never requires a declared skill to exist yet. Under `gateway:"sdk"` (the default), the model activates a declared skill through the Skill tool, which the engine adds to that agent's tool surface for you — do not list `Skill` in `allowedTools`. Declaring a skill grants no file tools, and none are needed to reach it: an agent with `allowedTools: []` and a declared skill can still activate it. Under `gateway:"pi"`, there is no separate `Skill` tool: pi only lists a declared skill in the model's system prompt when `allowedTools` includes `'Read'` or `'Bash'` — an agent with neither is refused `SKILL_REQUIRES_READ_TOOL` before dispatch. `allowedTools: []` does NOT work here, unlike sdk. This guide is generated once and is not per-deployment — the LIVE `workflow_authoring_guide` tool response states which one THIS engine actually runs (`system_info`'s `harness.name` does too).

Only the agent's own declared skills can be activated (other skills are hidden from it), and a skill's inline shell command (the `!` prefix form) is not executed. A declared skill's files are PRIVATE to the dispatch that declared it: they materialize into a directory outside the run workspace for the lifetime of that one dispatch only, never into `.claude/skills/` or anywhere else inside the workspace — another agent in the same run (parallel or later, sharing that workspace) cannot read them with Read/Bash/Glob, they are never visible to `workspace_pull`/`workspace_list`, and they are gone once the dispatch ends. If a skill's own instructions reference a supporting file by relative path, resolve it against the base directory the Skill tool itself reports when activating it (or, under `gateway:"pi"`, the path in the skill listing pi's own prompt shows) — never a hand-written `.claude/skills/...` path, which will not exist. In `run_agent_log`, `harness.skillsExposed` lists the skills the model could activate (by the plain name you declared); `harness.materialized` records which ones were actually found and materialized for this dispatch (also by plain name) — neither field, and nothing else in this run, exposes WHERE a materialized skill lives on disk.

**MCP servers.** `mcp: [name, ...]` names MCP servers pushed with `workspace_push` (`kind: 'mcp'`). Every tool of a declared server is on that agent's tool surface from its FIRST turn, whatever `allowedTools` says — `allowedTools` narrows only the built-in tools, and an `mcp__<server>__<tool>` entry in it only pre-approves that call, it does not hide the server's other tools. So `allowedTools: []` plus a declared server is a valid MCP-only agent. The engine waits for each declared server to connect before the first turn, for at most about 5 seconds; a server that is slower than that to start (e.g. a first `npx` download on a new host) misses the turn. When that happens, or the server fails, `run_agent_log` shows it: `harness.mcpStatus` lists each server's status and exposed tool names as the session started, and `harness.warnings` (rolled up onto `run_status.warnings` with the agent's label) carries `MCP_SERVER_NOT_CONNECTED`.

`meta.params.args` declares the run-time inputs the script reads off `args.<name>` — `{type, enum?, min?, max?, default?}`. A declared `.default` fills in the key when the caller omits it (or a run_start call omits `args` entirely); an explicit caller-supplied value always wins, including an explicit `undefined`. `type` is one of `string | number | enum` (an `enum` type requires the `enum` array of legal values).

This "explicit value always wins" rule is scoped to a TOP-LEVEL own key only: a nested `workflow()` call's `args` crosses a real OS-process IPC hop, and a function or symbol value anywhere in it (top-level or nested), or a plain `undefined` NESTED inside a sub-object/array, cannot survive that hop at all (issue #161) — it is refused `PARAM_OUT_OF_RANGE` up front, before anything is sent, rather than silently vanishing and letting a declared default fill in behind your back. Pass only plain JSON-shaped data: objects, arrays, strings, numbers, booleans, `null`, and — at the top level only — an explicit `undefined`.

A nested `workflow()` call's args are **structured-clone/JSON-like, not a true structured clone** — crossing that same IPC hop can silently LOSE data no error is ever raised for, distinct from the refused shapes just above: a `Map` or `Set` value arrives as `{}` (JSON serialization keeps neither type's internal entries, only its own enumerable string-keyed properties, which neither type has any of by default); a nested `NaN` arrives as `null` (`JSON.stringify(NaN) === 'null'`, same as a top-level one would); and a symbol-keyed own property is dropped entirely, invisible to `Object.keys`/JSON serialization alike — none of these three is refused, because the unsendable-value scan above only looks for function/ symbol VALUES and a nested `undefined`, never a Map/Set/NaN/symbol KEY. Avoid all four in nested `workflow()` args.

**A workflow that declares NO `args` at all still requires `args` to be a plain object (or omitted/`null`, which the script sees as `{}`)** — an array, string, or other non-object `args` is refused the same way a bad declared-args value is, before your script runs. Keys the contract doesn't declare still pass through onto `args` unchanged either way; only the top-level shape is checked.

`args` are typed data YOU (the author) interpolate into your own trusted prompt — declaring `type`/`enum`/`min`/`max` is what keeps a caller-supplied value inside the shape you wrote the prompt for. This is enforced on `run_start` AND on a nested `workflow(name, args)` call (the SAME contract, the CALLED workflow's own — a caller composing your workflow cannot send anything your declared `args` would not already accept directly); a value outside the contract is refused before your script runs at all. `appendPrompt` is the separate, author-OPT-IN channel for a caller's own free-text instructions, framed so the model can tell them apart from yours — a `string`-typed arg you interpolate verbatim carries no such framing, so a loose `{type:'string'}` (no `enum`, no byte-length `max`) lets ANY text through your own bound; constrain it with `enum`/`max`, or route free text through `appendPrompt` instead.

`meta.params.knobs` and `meta.defaults` are retired — a script that declares either is refused `DEFAULTS_RETIRED`, naming `meta.params.agents.<label>.<key>.default` as the replacement.

The engine-owned keys are never written inside an `agent()` call's options literal — `model`, `effort`, `timeoutMs`, `appendPrompt` there are refused `SCAN_VIOLATION`, naming the key and the `meta.params.agents.<label>.<key>.default` it belongs in instead.

The options object is closed. An `agent()` option key that is not one of `prompt`, `label`, `phase`, `schema`, `isolation`, `mcp`, `allowedTools`, `bash` is refused `SCAN_VIOLATION: PARAM_UNKNOWN` at registration, naming the key you wrote and listing the ones that are accepted. It is never silently dropped — before v25 it was, and an author who reached for a plausible-sounding name got a run that looked correct and ignored the option.

## The agent's tool surface

Each `agent()` call decides which tools its model may use, with `allowedTools`:

```js
const verdict = await agent('judge', { prompt: 'Answer with one word: PASS or FAIL.', allowedTools: [] });
const editor  = await agent('editor', { prompt: 'Fix the typo in README.md.', allowedTools: ['Read', 'Edit'] });
```

Two layers are **settable**, on the tool-calling (SDK gateway) path, and the first one present wins: the per-call `allowedTools` above, then this deployment's configured `defaultAllowedTools`. Only the first is settable from a script. If the deployment configures neither, the engine applies a built-in core set — `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash` — so a session is never handed the CLI's full uncurated tool list. (The direct-fetch transport has no tool surface at all — this section does not apply to it.)

`allowedTools` restricts tool **names**, not what the agent can reach. `Bash` can read, write and search anything `Read`, `Write`, `Edit`, `Grep` and `Glob` can — inside the run workspace when this deployment confines `Bash`, anywhere the engine process can reach when it does not (see Host path grants). So `['Bash']` alone can still write files, and a list that names `Bash` beside any of those five is no narrower than `Bash` alone: `workflow_register` answers it with a non-fatal `result.warnings` entry (`BASH_SUBSUMES_FILE_TOOLS`) and registers the version anyway. A read-only agent is `['Read', 'Grep', 'Glob']`, with no `Bash`. An agent that also declares a `skill` is a partial exception on `gateway:"pi"` (see Skills, above): dropping `Read` there is still safe for the skill's own visibility, because `Bash` alone already satisfies pi's `SKILL_REQUIRES_READ_TOOL` requirement — the warning states this explicitly when it applies.

When an agent needs a shell to run commands and report their output, but must not change anything, add `bash: 'readonly'` beside its `allowedTools`:

```js
const facts = await agent('clerk', { prompt: 'Run `ls -la src` and `wc -l src/*.ts`; paste the raw output.', allowedTools: ['Bash', 'Read', 'Grep', 'Glob'], bash: 'readonly' });
```

The kernel sandbox enforces it, not the prompt and not the tool list: that agent's `Bash` gets no writable path — not the run workspace and not any host path grant. Only the CLI's own private scratch directory stays writable, because the shell cannot run without it. That combination does not trip `BASH_SUBSUMES_FILE_TOOLS`. On a host with no working Bash sandbox, the engine never downgrades a readonly agent to a writable shell. The call fails closed: the agent returns `null`, and its record carries `BASH_READONLY_UNENFORCEABLE`, with no session started. `workflow_register` refuses `bash: 'readonly'` beside `Write`, `Edit` or `NotebookEdit`, with no literal `allowedTools` (the deployment default includes write tools), or with no `Bash` in the list — `SCAN_VIOLATION` `BASH_READONLY_CONFLICT`. It refuses any other `bash` value (`BASH_MODE_INVALID`) and a `bash` key in `meta.params`. `run_start` overrides cannot change it. When a session starts, the agent's `harness.bash` record in `run_agent_log` shows `{mode, enforced}`; a fail-closed call starts no session, so it has no harness record — read its detail instead. Whether it is enforced or refused depends on the serving deployment's measured posture — the live `workflow_authoring_guide` response says which.

File tools take workspace-relative paths: `out/result.txt` resolves inside the run workspace, even where a tool's own description asks for an absolute path. A file-tool path that resolves outside the workspace is refused, and the refusal names the workspace root.

`allowedTools: []` means no tools at all, and for a prose-only task that is usually what you want — especially on a smaller model. A smaller model handed a working tool surface tends to answer with a tool call rather than with prose: ask it to produce a summary while it holds `Write`, and the reply can come back as a tool-call envelope your script then has to unwrap. Emptying the surface removes the option and the model answers in text. It also makes the call markedly cheaper — the tool definitions are prompt tokens on every turn (measured on this engine: 162 input tokens with an empty surface against 1722 with the default one, for the same prompt).

## Host path grants

Whether `Bash` is confined to the run workspace depends on THIS deployment's measured posture, checked once at boot. This generated page is built before any host boots, so it cannot state which one applies to the deployment serving it — it describes both:

**Confined:** `Bash` may write inside the run workspace and nowhere else. A write outside it arrives as an ordinary `EROFS` (read-only filesystem) inside the agent's own tool result, not as an engine refusal — a script that shells out to a global cache sees a failed command, not a special error your script can branch on.

A shared host path is possible but is an **operator grant** in `rwe.config.json`, never something a script requests — the list applied to a given run appears in that run's own `agent.confinement` log line.

`Bash`'s READS are deny-by-default too, but scoped differently than writes: the whole engine home directory and the whole `workRoot` (every run's workspace, not just other runs' — this one's own workspace, the HOME-RESIDENT toolchain (everything the engine's own `PATH` puts under `$HOME`, plus its node install prefix), and any operator-granted host path are re-opened on top of that denial — a system path like `/usr/bin/git` was never denied in the first place, so it needs no re-opening. A read outside those paths fails as an ordinary shell-level error (e.g. "No such file or directory"), never a special engine refusal — same as the write case above, just the opposite default. A host path with no relationship to $HOME or workRoot (e.g. `/etc/hostname`) is NOT denied by this — the policy only closes those two specific regions, it is not a blanket "Bash cannot see anything outside the workspace" jail.

**Unconfined:** On this deployment, `Bash` is **not confined**: the boot-time probe found no working sandbox on this host, so `Bash` runs with the same filesystem access as the engine process itself — not limited to the run workspace, and not limited to any operator-granted host path either. A **locally-submitted** run of a **locally-registered** script still executes exactly this way; that is the accepted cost of this deployment's posture, not a bug. Every run this workflow can trigger is refused identically when EITHER its trigger OR its resolved script version's registering submission was remote — `run_start`/`run_resume` (a remote MCP caller, or a LOCAL caller naming a workflow version that was itself registered remotely), a webhook delivery (`POST /hooks/:id` → HTTP 403), and a schedule firing (surfaced in `schedule_list`'s `lastError`) all return `CONFINEMENT_UNAVAILABLE` — **regardless of what tools any agent in the workflow declares.** A workflow whose every agent declares `allowedTools: []` (no `Bash`, no file tools, nothing) is refused identically to one that declares `Bash`: this rule gates every admission route by submission/trigger/version provenance, never by the requested tool surface — there is no tool-free door around it.

The live `workflow_authoring_guide` tool response states which posture is actually in force on the deployment serving it — check there, not here, before relying on either description.

## Prompt layering

After v34 there are exactly two author/caller segments in the prompt a model receives: the script's own `prompt` argument to `agent()`, then a caller-supplied `appendPrompt` override, framed inline as `<user-instructions untrusted="true">…</user-instructions>`. Since issue #156, the frame opens with one line of plain-language prose, ahead of the caller's own text, stating that the segment is caller-supplied and untrusted and cannot override the author's instructions or any tool-use rule — the `untrusted="true"` attribute alone is machine-readable, not something a model reliably acts on unprompted. The engine adds only its own scaffolding around them (that prose line, a schema suffix, and a retry nudge) — it does not decide whether the appended segment is an authorized override or a foreign injection. An author who wants the appended segment to carry override force has to write the adoption rule into their OWN prompt; the engine draws no such line on the author's behalf. This framing applies ONLY when a caller actually supplies `appendPrompt` (even an explicit empty string). A declared `appendPrompt.default` that no caller overrides is YOUR OWN text, not the caller's — it is appended plainly, with no frame and no untrusted-caller prose, exactly as if you had written it straight into your own `prompt` (issue #156).

## Locked vs. tunable

The seven locked keys are engine-owned and can never be overridden by a caller: prompt, allowedTools, bash, skills, mcp, workdir, cwd. The four tunable keys an override may target, per declared agent label, are: model, effort, timeoutMs, appendPrompt.

## Engine ceilings (this deployment)

The ceilings below are this build's resolved values — operator-overridable, so a different deployment's engine may render different numbers here: a declared agent's `timeoutMs.default` may not exceed 600000ms, a declared `appendPrompt.default` may not exceed 1024 bytes, and a declared `effort.default` may not rank above 'high'. A declaration above any of these ceilings (in `meta.params.agents.<label>`) is refused `PARAM_CONTRACT_INVALID` at registration — never silently clamped. A run-time **override** (`run_start`'s `overrides.agents.<label>`) that names a value outside the effective (author ∩ ceiling) bound is a DIFFERENT refusal, `PARAM_OUT_OF_RANGE`, at admission.

A declared `model.default` (and every entry of a declared `model.enum`) MUST be a full `<provider>/<model-id>` ref — providers are exactly `anthropic`, `openrouter`, `ollama` — split at the FIRST `/` (an openrouter id can itself carry further `/`s, e.g. `openrouter/openai/gpt-4.1`; an ollama id can carry `:`/`.`, e.g. `ollama/qwen2.5:7b`). There are no aliases, no bare names, and no `'default'`/`'local'`-style shortcut — a bare name, an unrecognized provider prefix, or an empty model id is refused `UNKNOWN_MODEL`, naming the expected form and the three providers. `models_list` shows the catalog this deployment can reach: each row's `ref` field IS the exact string to paste — copy it verbatim, never hand-type a variant. An openrouter/ollama ref is checked against that provider's live catalog listing when one is available (refused `UNKNOWN_MODEL` if genuinely absent from it; accepted with a non-fatal `MODEL_CATALOG_UNVERIFIED` warning if the listing could not be checked); an anthropic id not yet in this deployment's static price table is likewise accepted with that same warning — a new Anthropic model is never blocked. The model is bound once at `workflow_register` time (the `.default` above) and may be replaced with a different full ref per run via `run_start`'s `overrides.agents.<label>.model` — there is no other override surface (a scheduled/webhook-fired run, and a nested `workflow()` call, always use the target version's own bound `.default`). A `gateway:"pi"` deployment narrows this to only `openrouter`/`ollama` — see the pi harness note below for the exact refusal code and remediation.

## Providers and the model catalog

A full model ref's provider prefix names exactly one of three providers, each with its own declared capability row — read from the SAME table `parseModelRef`/`checkModelRef` check against, labelled **declared, not probed**: nothing here is learned by dispatching a call.

- `anthropic` — tool surface: all, effort applies: yes
- `openrouter` — tool surface: all, effort applies: no (the provider has a reasoning dial, but this deployment's dispatch path does not carry it — `effortApplied` says so per call)
- `ollama` — tool surface: all, effort applies: no

There is no `openai` row: OpenRouter is the many-model front door for everything that is not Anthropic-direct or a local Ollama model, so swapping a model — or a transport — is a different `<provider>/<model-id>` ref, not a new provider.

`models_list` shows the CATALOG this deployment can reach — every row's `ref` field is the exact `<provider>/<model-id>` string to paste into `model.default`/a run_start override (see "Engine ceilings" above for the full-ref rule). One row per model — there is no alias overlay, so a model is never listed twice under two names. Its `toolUseDeclared`/`effortDeclared` flags and `costLevel` rating are DECLARED capability, never probed by dispatching a call, and carry their own provenance: `declaredSource` ('upstream'|'static'|'unknown') says where the flag came from, and `catalogFetchedAt` is per-row catalog provenance (a timestamp, or `null`). `toolUseVerified`/`proseVerified` are the OBSERVED counterpart: the engine periodically probes each configured model with one prose call and one call that must read a file through the Read tool (`null` = never probed; `lastProbedAt`/`probeDetail` say when and what happened), and `stabilitySource:'probe'` means `stability` reflects that probe ('unavailable' = no prose answer, 'degraded' = no tool use). If an agent needs tools, pick a model whose row says `toolUseVerified: true` — `run_start` answers a non-fatal `warnings` entry (MODEL_TOOL_USE_UNVERIFIED) when an agent holding tools lands on one whose probe saw none. Probe results are PER HARNESS (issue #138): a result only counts as evidence for the gateway/transport that actually produced it, so after this deployment switches `gateway` (e.g. `"sdk"` to `"pi"`), every model's `toolUseVerified`/`proseVerified` read `null` again (`stabilitySource` falls back to the rule tier) until re-probed under the new harness — automatically on the periodic prober's next tick, or immediately via an admin `models_probe()` call.

To CHOOSE a model, `models_list` answers one page `{ models, nextCursor, total }` of compact rows (`fields: ['*']` for every field; pass `nextCursor` back as `cursor`). Filter by `modelType: 'chat'` (only chat models can drive an agent), `toolUseVerified`, `structuredOutput`, `reasoning`, benchmark minimums, or observed latency/success/cost; sort with `sortBy` (price, intelligence, coding, agentic, latency, successRate, avgCostPerCall, …; nulls last). `observed` is what THIS engine measured for the model over 30 days (split `prose` vs `tools` calls — `avgCostUsdPerCall` includes the harness overhead, so it predicts a run's cost better than unit price); `benchmarks` are third-party scores republished by OpenRouter (null when none). `effortAppliedOnTransport` says whether an agent's `effort` actually reaches THIS model on this engine's dispatch path — a live, per-model fact (never a blanket per-provider one), whatever `effortDeclared` (the upstream catalog's own declaration) says.

Reading the numbers: `null` means "not published / not measured", never a low score — OpenRouter republishes only Artificial Analysis intelligence/coding/agentic (plus Design Arena), so compare models only on dimensions both have; there is no instruction-following or tool-calling score. `observed.successRate` counts calls that finished, NOT schema conformance: a call whose output keeps failing an agent() `schema` resolves null in your script yet still counts as a success. The engine enforces `schema` itself (states it in the prompt, validates the reply, makes up to 3 attempts total — the first try plus up to 2 re-asks — before giving up) on every model, so `capabilities.structuredOutput` (an upstream declaration, null on anthropic-direct rows) neither enables nor guarantees it — keep the schema a small top-level object, prefer stronger models for strict JSON, and handle a null result (retry with another model). Fields outside the compact row (`capabilities`, `ratesPerM`, full `observed` buckets) need `fields: ['*']` or `fields: [...]`. The vendor of `openrouter/<vendor>/<model>` is its second segment; `:batch`/`:free` suffixes are the same model on another pricing tier. There is no score-per-dollar field — compute it from `ratesPerM`. Cap every agent with `timeoutMs` and the run budget so a model that loops on tools cannot run away (visible as high `avgCacheReadTokens` and low `avgOutputTokens` in `observed.tools`).

This deployment may instead be configured with `gateway:"pi"` in rwe.config.json — a different harness with the SAME agent()/tool contract but a narrower surface: only `openrouter`/`ollama` models are usable (an `anthropic/*` ref is refused `PROVIDER_UNSUPPORTED_BY_HARNESS` at registration/run_start/admission — route a Claude model through `openrouter/anthropic/...` instead); the tool surface is limited to Read/Write/Edit/Bash/Grep/Glob/LS (WebFetch/WebSearch/Task/NotebookEdit are refused `TOOL_UNSUPPORTED_BY_HARNESS`). Pre-existing Glob quirk, unrelated to pi specifically but worth restating here since pi's Glob maps straight onto it: a `**/*.txt`-shaped pattern does not match a file sitting directly in the searched directory (only one nested one level or deeper does) — unlike Claude's own Glob tool, which matches the root too; write `*.txt` (or `{,**/}*.txt`) when top-level files must match. MCP and skills ARE supported under `gateway:"pi"` (resolved through the same shared resolver/ materializer as the sdk gateway — `${secret:}`/`${run:dir}` substitution never diverges between the two), with two pi-specific differences: a declared skill requires `Read` or `Bash` in `allowedTools` (pi only lists a skill in its system prompt when one of those two tools is present — no separate `Skill` tool exists on pi — refused `SKILL_REQUIRES_READ_TOOL` before dispatch with neither), and a `seedManifest`/`workspace_push` skill file's `exec:true` is only ever a file-permission bit (0o755 vs 0o644) on pi — there is no inline-shell (`!cmd`) skill syntax to gate the way the sdk gateway's `disableSkillShellExecution` does. Known network difference: pi's Bash network policy is allow-all, but the underlying sandbox library routes ALL traffic through its own MITM proxy once any network field is set at all, which makes `localhost`/`127.0.0.1` destinations from inside the confined Bash unreachable — unlike `gateway:"sdk"`, whose Bash leaves the network field unset entirely and keeps full host network including loopback. A workflow whose Bash needs a same-host service must use `gateway:"sdk"` for now (see DEPLOY.md §1b2 for the full writeup). Known unconfined-posture limitation (review R2-2): a Bash command that backgrounds a process via `setsid` (not `nohup`, which stays reachable) escapes this dispatch's process group and survives even normal completion — accepted because the unconfined posture only ever runs a local submission to begin with; the confined posture never has this gap (bwrap's own pid-namespace teardown reaps everything regardless of process group). Confined Bash's own `TMPDIR` is a per-dispatch directory this engine verifies, never srt's shared `/tmp/claude` fallback — a host `/tmp/claude` (any local user can create one) is readable (the same exposure as every other host `/tmp` path) but never writable from inside confined Bash, and its mere presence only emits an operator-visible warning event, never a refusal (review round 4, R4-2). Issue #131: `gateway:"sdk"` (the default) got this identical `/tmp/claude` protection too — no longer a pi-only difference — see DEPLOY.md §1b2/§1c for the full writeup. Other pi-specific refusals an operator may see on a failed agent (run_status.agentFailures / run_agent_log, not a direct tool-call error) are listed with the rest of this engine's error codes below, and in DEPLOY.md §1b2's own remediation table. `system_info`'s `harness` field states which one THIS engine runs (`{name, version, providers, unsupportedTools, effort, usage}`) — read it rather than assuming.

## Budget, concurrency, and how wide a fan-out really runs

`parallel([a, b, c, ...])` dispatches every thunk, and this deployment runs up to **24** of them at a time (`runConcurrency`, operator-configurable). Past that they QUEUE and run as slots free: a wider fan-out is slower, never truncated. This applies identically whether the fanned-out thunks call `agent()` or nested `workflow()` — a wide `parallel()` of nested `workflow()` calls is throttled by its own same-sized pool, never left to fork every child process at once (issue #163).

`run_start`'s `budget` takes TWO independent limits — `{usd?, tokens?}` — either of which may be omitted or `null` for unbounded. Each is a **stop-dispatching signal, not a hard ceiling**, and this is the honest description of what the engine can enforce. Before each dispatch it asks one question per armed limit: has this run already spent it? If yes, the call is refused `BUDGET_EXCEEDED`; if no, it goes. What a call will cost cannot be known before it finishes, so calls already in flight when a limit runs out still complete — a run can therefore overshoot EITHER limit by up to one concurrency window (24 x one call's cost). Size a budget for the whole workflow, not per call.

A fire-and-forget `agent()` call your script does not `await` keeps running to completion AFTER the script returns and the run goes terminal — the engine never aborts in-flight work just because the run around it finished (issue #162, adjudication #9 I-2, a deliberate owner ruling, not a bug). Its usage is folded into `run_result.meta.usage`/`run_list`'s totals once it settles, so a figure read AT the terminal moment can be a lower bound until then. While this is happening, `run_result`/`run_status`'s own `meta.warnings` carries `{code:'AGENT_STILL_RUNNING', message}` (issue #162(1)) — that is the signal to poll again rather than trust the figure as final; it disappears once every call has settled. This tracks the engine PROCESS that owns the call, not a persisted fact (issue #162(1) reverify-2): across an engine restart the warning stops appearing for a call that process owned — there is nothing left for any process to observe settling — and that call's usage, if any, is whatever had already been captured before the restart, final. Otherwise `await` every call whose spend you need counted or whose completion you need to know about.

Inside the script, the read-only `budget` object answers each limit with its own accessor: `budget.limits.usd` / `budget.limits.tokens` are the two ceilings (`null` when that limit is unbounded — `null` is `===`-detectable but NOT comparison-safe, `null < 1000` is `true`); `budget.total` aliases `budget.limits.usd`; `budget.spent()` / `budget.remaining()` answer the USD limit only (`remaining()` is `null` when no USD limit is armed); `budget.tokens()` answers the token limit — it returns the four-column `{input, output, cacheRead, cacheWrite, sum}` spent so far. A USD budget counts only calls the model catalog can price — an unpriced call (the catalog has no rate for that model at all) adds 0 to USD spend and never trips a USD limit. An `ollama/*` (local) model is priced at exactly $0 for the SAME reason — running it costs nothing, not "price unknown" — so a USD budget never trips on it either, but it reports as PRICED (not unpriced) everywhere a caller checks. Either way, set `budget.tokens` for a limit that binds on every model, local or not.

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

`e.code` is still the recommended handle — a plain own property, simplest to branch on, and unaffected by anything below. `e instanceof Error` and `args instanceof Object` now also work correctly (fixed by #157 B1): every value the engine hands your script — errors, `args`, agent()/workflow() results — is built natively in your script's own realm, not the engine's, so standard checks (`instanceof`, `Array.isArray`) behave exactly as they would for a value you constructed yourself. Every engine refusal carries the same `e.code`/`e.name` catalog code as `run_result.error.code`, plus a human `e.message`.

A `running` agent's `tokens`/`costUSD` on `run_status` show only COMMITTED usage — every already-settled attempt so far (e.g. an earlier schema re-ask that failed validation and is retrying) — never the CURRENTLY in-flight attempt's own live total; for a plain single-attempt call that means no `tokens` field at all until the agent itself goes terminal. Polling `run_status` mid-call will not show a live-updating count; read run_agent_log for the transcript as it streams instead.

`run_status.agents[].tokens`/`costUSD` are populated on a FAILED agent too, not only a done one, whenever the gateway reported usage before the call ended; `agents[].partial: true` marks that figure as a LOWER BOUND — the deduped sum of what streamed in before the cutoff, not the provider's own finalized total (a terminal provider error that DID report its own total is NOT marked partial — only a genuine abort/timeout/mid-stream cutoff is). On a `partial` figure, treat `output` as the column most likely to be a severe underestimate (the per-turn streamed snapshot it is built from only reaches a turn's true `output_tokens` on that turn's own final frame, which a cut-short call's in-flight turn never reaches) — `input`/cache columns track the eventual finalized total closely ONLY when `estimated` (below) is absent; an `estimated:true` figure's `input` is a deliberate `ceil(chars/4)` floor over the text this attempt DISPATCHED, never a measurement of what the provider actually processed. What "streamed in before the cutoff" means depends on the harness: a cutoff that lands after at least one turn has FULLY completed (a tool call and its result, say) always charges that turn's own exact figure; for a cutoff mid-TURN, the sdk-cli harness streams partial tokens continuously and so almost always has something to charge, while the pi harness's wire protocol normally reports nothing for the in-flight turn at all unless the provider itself happens to populate usage on an intermediate chunk — most do not. `estimated:true` is new ON TOP of `partial:true` (both together, never `estimated` alone): it means this attempt's figure is NOT anything a provider or harness reported, not even a partial one — it is `estimateInputTokens`'s deterministic `ceil(chars/4)` floor over the exact text this attempt dispatched (the composed prompt, including the schema/output-format block appended when `schema` is set — never the harness's own expanded system prompt or tool definitions, which this layer cannot see), applied ONLY to `input` (`output` stays 0 — nothing was ever observed to estimate it from). The engine reaches for this estimate ONLY on a call cut short by `run_suspend`/`run_stop` (`agentFailures[].reason: 'aborted'`) — NEVER on a plain timeout, which still reports a genuine, un-estimated zero when nothing streamed, unchanged from before this fix — and only when NEITHER source has anything at all for that aborted attempt: the pi harness's wire protocol (above) reports nothing, AND nothing streamed onto the live record via the gateway's own mid-turn usage callback either. The engine cannot tell a REAL exact zero apart from "nothing reported" — both read as all four columns being 0 — so an all-zero figure from EITHER source is replaced by the estimate; only a NONZERO figure, from either source, counts as real, wins, and is read as `partial` with no `estimated` field — the two are mutually exclusive, never summed. This means an attempt that was genuinely dispatched to a gateway and then cut short BY `run_suspend`/`run_stop` ALWAYS charges something nonzero against `budget` now (real or estimated) — the one case that stays an honest zero is an attempt aborted before it was ever dispatched at all (the signal was already set when the executor checked); a TIMEOUT with nothing streamed also still stays an honest, un-estimated zero — this estimate is `run_suspend`/`run_stop` only. Either figure — real or estimated — is charged exactly like a completed call's, so a repeated suspend/resume cycle of a usage-heavy agent counts toward, and WILL eventually trip, a TOKEN limit, including under a provider (OpenRouter via the pi harness) that never streams mid-turn usage at all — the floor is always nonzero for a non-empty prompt. A USD limit is a DIFFERENT claim: an estimate taken before this attempt's own provider/model is resolved prices at `costUSD:0, unpriced:true` (no price-book entry to charge against) and does not move the USD arm — a run suspended early and often enough that every charged figure is one of these sees its USD limit never trips, however many times it is resumed. Separately: resuming a suspended/interrupted run RE-DISPATCHES the agent() call that was in flight at the cutoff from the START, with a NEW agentId — it does not continue the old one, and the cut-off attempt never itself resolves anything to the script (only the replacement agentId's own eventual outcome does); the cut-off attempt still counts toward `failedAgentCount`/`agentFailures` (`reason:'aborted'`) even though it is not a genuine gateway failure. An agent() whose ONLY effect is its return value (e.g. a pure-text or `schema`-validated response) is safe to re-dispatch this way; one that also performs a non-idempotent side effect through an MCP tool or Bash (writing a row, sending a message, charging something) may perform that effect TWICE across a suspend/resume — design such a call to be idempotent (a dedupe key, an "upsert" instead of an "insert") or keep it out of a label a workflow might resume into.

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
3. **Tools — `TOOLS_MISMATCH`.** Whenever an `agent()` call declares a literal `allowedTools` array — including the empty array `allowedTools: []` — its node's third `<br/>` segment is REQUIRED and checked exactly: `label<br/>model · effort · timeout<br/>tools: Edit, Read` — the names sorted, comma-space separated, exactly the literal `allowedTools` array on that call, or `tools: none` for `allowedTools: []`. Omitting the segment (or leaving the node with no `<br/>` at all) while `allowedTools` is a literal array is refused `TOOLS_MISMATCH` — it does NOT fall back to "not compared". When the call declares no `allowedTools` key at all, there is no declared list to VALUE-check the segment against, but the segment is still not free text (issue #155): write exactly `tools: default` (the honest word for "whatever this deployment configures") or leave the segment off — any OTHER text there, most dangerously a false `tools: none` (indistinguishable from a REAL `allowedTools: []`), is refused `TOOLS_MISMATCH` too.
4. **Edges — `EDGE_MISMATCH`.** Consecutive calls in your script must be joined in the diagram, across lane boundaries too. A path may run through non-agent shapes (a diamond for a branch, an aggregation for a non-agent join), which is how you draw a ternary or an `if/else`. A direct agent→agent edge between calls that are NOT consecutive needs a `|label|` saying what it means. Members of one `parallel([...])` (or of the two arms of one branch) are never edged to each other — they fan in to whatever follows.

A script whose shape a static read cannot resolve at all — an `agent()` inside a `for`, `while` or `switch` body — makes that lane DYNAMIC: it predicts no slots, so rule 4 has no edges to compare there. Declare the agent's node inside that lane anyway: rule 2 (LANE) still requires it, and rule 3 (TOOLS) applies EXACTLY the same way it does everywhere else — a dynamic lane earns no exemption at all (issue #154/#155 follow-up, 2026-10-09 re-verification): an `allowedTools` array still requires the exact `tools: …` segment, and an ABSENT `allowedTools` still only accepts `tools: default` or no segment at all, same as rule 3's own paragraph above states. A VARIABLE `allowedTools` (`agent('a', {allowedTools: tools})`, a ternary, a spread, `[...arr]`, …) is not a dynamic-lane carve-out either — it cannot even REGISTER, refused `AGENT_OPTS_VALUE_NOT_LITERAL` at registration time, before the diagram is ever checked — the SAME registration-time literal check this guide's `agent()` section (above) states precisely: `allowedTools` and `bash`'s values in particular, never every option (a non-literal `schema` registers fine and is checked only at dispatch).

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

- `seed` — Seed files by inline content — each element is {path, contentB64}, the file bytes as base64. Refused INVALID_SEED_SPEC if any element is missing contentB64, escapes the workspace, or has a reserved rwe- first path segment.
- `seedManifest` — Seed files already pushed to the CAS via workspace_push({sha256, contentB64}) — each element here is {path, sha256, exec?}, referenced by hash rather than carrying content inline (exec:true materializes that file 0o755, else 0o644). Use for large trees, or content you already have a sha256 for. Refused INVALID_SEED_SPEC if any element escapes the workspace or has a reserved rwe- first path segment.
- `seedManifestRef` — Seed the whole workspace from ONE manifest previously pushed as a CAS blob — the sha256 of that manifest. Over MCP (no separate "manifest mode" — this is the SAME workspace_push blob call, used twice): push each file's bytes with workspace_push({sha256, contentB64}) (sha256 is that file's own hex sha256; one call per file), then push the manifest ITSELF the same way — workspace_push({sha256, contentB64}) again, where contentB64 is the base64 of the manifest JSON bytes (a JSON array of {path, sha256, exec?}, each sha256 referencing an already-pushed file blob; exec:true materializes that file 0o755, else 0o644) and sha256 is that JSON's own hex sha256 — the accepted sha256 from that second push IS the ref. (The HTTP equivalent — POST /assets/blob/<sha> per file, then POST /assets/manifest — does the identical two pushes and returns the same ref as seedManifestRef directly; it also validates every referenced blob is present at manifest-upload time, where this MCP path defers that check to registration/run_start, answering the same MISSING_BLOBS either way.)
- `workspace_push` — Push content: a CAS blob into the caller's own pool, or a workflow-owned asset (skill/mcp). Any runId argument is refused — see workflow_authoring_guide. A CAS blob/manifest is content-addressed within the caller's own pool and counts against the caller's content-store quota (see workspace_diff for usedBytes/limitBytes): a push that would exceed it is refused QUOTA_EXCEEDED {usedBytes, limitBytes, requestedBytes, hint} before anything is stored, and any push is refused DISK_LOW {freeBytes, floorBytes} (transient — retry later) while the engine's disk is below its free-space floor. Accepted blobs stay until removed with workspace_prune_blobs (which only removes blobs no registered workflow version's seed needs and that were not used recently) — workspace_delete never removes a CAS blob or manifest. A non-global `workflow` must already be registered (workflow_register FIRST, then workspace_push its assets) — WORKFLOW_NOT_FOUND otherwise; registration itself does not require any declared skill to exist yet. A `kind:'mcp'` stdio server's own persisted state is shared host-wide across every run/principal that declares it unless its `env`/`args` opt into a per-run private directory with `${run:dir}` (created fresh for THIS run only, e.g. `MEMORY_FILE_PATH:'${run:dir}/memory.jsonl'`) and/or `${run:id}` (this run's id) — any other `${run:xxx}` name is refused UNKNOWN_RUN_PLACEHOLDER before the probe runs. See workflow_authoring_guide's "Provisioning skills and MCP servers" section for the full role x asset-kind/scope/transport matrix, the two accepted MCP config shapes, the `${secret:NAME}`/`${run:...}` handle grammars, and why stdio server state needs keeping per-run.

Every `seed`/`seedManifest`/`seedManifestRef` element that does not match its declared shape is refused `INVALID_SEED_SPEC` before a single byte is written — a `seed` element missing `contentB64` (or carrying only a `sha256`) does NOT silently materialize a 0-byte file; the refusal names the offending `path` and points at `seedManifest` instead. Content referenced only by hash (`seedManifest`, `seedManifestRef`) must already exist in the CAS — push it first with `workspace_push`.

**Scheduled and webhook-fired runs** carry no `run_start` arguments, so they cannot bring a seed of their own — bind one to the workflow VERSION instead: `workflow_register({name, script, mermaid, seedManifestRef})`. Optional default seed for THIS version: the sha256 of a manifest you already uploaded. Over MCP (no separate "manifest mode" — this is the SAME workspace_push blob call, used twice): push each file's bytes with workspace_push({sha256, contentB64}) (sha256 is that file's own hex sha256; one call per file), then push the manifest ITSELF the same way — workspace_push({sha256, contentB64}) again, where contentB64 is the base64 of the manifest JSON bytes (a JSON array of {path, sha256, exec?}, each sha256 referencing an already-pushed file blob; exec:true materializes that file 0o755, else 0o644) and sha256 is that JSON's own hex sha256 — the accepted sha256 from that second push IS the ref. (The HTTP equivalent — POST /assets/blob/<sha> per file, then POST /assets/manifest — does the identical two pushes and returns the same ref as seedManifestRef directly; it also validates every referenced blob is present at manifest-upload time, where this MCP path defers that check to registration/run_start, answering the same MISSING_BLOBS either way.) Every run of this version that brings no seed of its own — run_start, a scheduled firing, a webhook delivery — starts with those files in its workspace. A run_start seed (seed/seedManifest/seedManifestRef/seedRef) REPLACES it, never merges. Checked now, in your own CAS namespace: MISSING_BLOBS if you never uploaded it, INVALID_SEED_SPEC if the referenced blob is not a JSON array of {path, sha256, exec?}. References only — inline seed/seedManifest/seedRef are refused INVALID_ARGUMENT. Versions are immutable: a different seed is a new registration (a new version).

**Storage quota and cleanup.** Everything you upload to the CAS (POST /assets/blob, POST /assets/manifest, `workspace_push` blob mode, and trees the engine fetches for your `seedRef`) counts against YOUR content-store quota — by default user 1 GiB, author 5 GiB, admin unlimited (the operator sets `casQuota`; an administrator can override one account with `principal_set_quota`). Usage is the total size of every blob in your pool; a blob other accounts also hold still counts fully for you. `workspace_diff` returns your `quota {usedBytes, limitBytes, source}` with every diff. An upload that would exceed the limit is refused `QUOTA_EXCEEDED {usedBytes, limitBytes, requestedBytes, hint}` (HTTP 507) before anything is stored. Free space with `workspace_prune_blobs` — a dry run by default; `dryRun:false` removes blobs that no version you registered with `seedManifestRef` needs (the manifest and every blob it lists are kept) and that were not used for `olderThanDays` (default 30). Separately, while the engine's disk is below its free-space floor every upload and every new run (run_start, run_resume, schedule/webhook firings, nested `workflow()`) is refused `DISK_LOW {freeBytes, floorBytes}` — transient (HTTP 503), retry later; runs already in flight continue.

**Project configuration under `.claude/` in a seed is neutralised two different ways, at two different times.** `.claude/settings.json`, `.claude/settings.local.json`, and anything under `.claude/hooks/` are **stripped at seed time** — never written to the workspace at all — because `settingSources:['project']` would execute them. The ONLY place this shows up is `seedConfigStripped` on `run_status`/`run_result` (absent when nothing was stripped); they will never appear in `workspace_pull` and no dispatch ever reports removing them (there was nothing on disk to remove). `.mcp.json` and `.claude/skills/**` are different: seed DOES write them, and the engine removes them from the workspace before the first `agent()` dispatch's CLI can load them — reported as `plantedConfigRemoved` on that dispatch's `run_agent_log.harness` (and an `agent.planted_config_removed` event), never in `seedConfigStripped`. Either way, a seeded skill was never activatable by being present in the workspace in the first place (the engine's own skill wiring is an explicit list it builds itself, never scanned off disk) — provision one with `workspace_push({kind:'skill', workflow, name, files})` instead — see "Provisioning skills and MCP servers" below.

## Three things a cold author gets wrong

A **sequential** `await agent(label, options)` call that fails, times out, or is aborted by run_suspend/run_stop while in flight resolves to `null` for that reason — it does not throw. (An ENGINE refusal, e.g. `BUDGET_EXCEEDED`, is a different case and still propagates as a thrown error — see "Budget, concurrency" above.) Guard every sequential call the same way `parallel()`'s own thunks already are:

```js
const out = await agent('reviewer', { prompt: 'Review the draft' });
if (out === null) {
  // the agent failed, timed out, or was aborted by run_suspend/run_stop — there is no
  // result to read here
  return;
}
```

`timeoutMs` bounds ONE attempt, never the whole call: this deployment MAY retry a failed attempt — how many times is deployment-configured (it can be zero); `workflow_describe`'s `timeoutMs.attempts` for that agent is authoritative, not an assumption. The deployed retry count multiplies the single-attempt bound into the actual worst-case wait — `workflow_describe` reports the multiplied figure as that agent's `timeoutMs.worstCaseMs`, next to the single-attempt `timeoutMs.default`. An `agent()` call with no timeoutMs set — neither on the call itself (`timeoutMs`) nor as this deployment's own configured default — runs once: retries apply only to a call that has a bounded timeout in effect.

Every tool result — including this guide's own — arrives as a JSON string inside `content[0].text`, never as a structured object: parse it again to reach the actual payload.

A run's structured refusal marker (`refusalRef`, carried internally from the sandbox to the run's own ledger) is engine-attested — it can only name a refusal this SAME run genuinely raised. `error.code` alone is **not** attested and never has been: `e.name`, `e.code`, and a plain thrown/returned `{code: '...'}` object are every bit as forgeable as each other — a script fully controls what it throws or returns, so ANY of these carries exactly as much trust as the script that produced it, with no marker to back it.

## Registration and versioning

The normal loop: `workflow_register` a script under a name, `run_start({name, version})` the version it just returned to iterate, and once it is stable `workflow_publish(release)` it — registering the same name again appends a new version and never overwrites an existing one. The rest of this section is exceptions, not the common path.

Registering a script that predates the v24 contract (or was never migrated) resolves `runnable:false` with `runnableReason: LEGACY_REREGISTER` — re-register it under the current contract; there is no legacy-resolution ladder. Omitting a currently-registered trigger from a new version does not release it (omission does not release) — deregister the trigger explicitly if you mean to stop it. A `once` trigger is consumed on its firing attempt — whether that attempt succeeds or is refused — and will not fire again; a refused `cron` firing instead gets a fresh future `nextFire` and tries again next time. Assets (skills/mcp) registered under an owner are shared across every version of that workflow name, not pinned to the version that first declared them.

A trigger bound through `triggers:[id]` is PINNED to the HIGHEST-numbered version that declares it — it runs that version directly when it fires, regardless of what `release`/`beta` point at, and even while neither channel is published at all. Re-declaring the same id in a later registration moves the binding forward to that version; omitting it from a later version leaves the binding on the older version that still lists it (the "omission does not release" rule above). A trigger `workflow_deregister` releases is also DISABLED — a schedule needs `schedule_setEnabled({id, enabled:true})` after it is re-claimed to fire again; a disabled webhook has no re-enable call and answers every delivery `403 {code:TRIGGER_DISABLED}` until it is deleted and a new one is created.

## Authoring rules this engine enforces (refused with this code)

- `NOT_TRIGGER_OWNER` — the caller does not own (did not create) this trigger
- `WORKFLOW_NOT_ALLOWED` — this service account is restricted to a workflows allowlist (service_account_create/_update) and this workflow is not in it
- `PARSE_ERROR` — the script body failed to parse as TypeScript
- `UNKNOWN_MODEL` — the model is not a valid <provider>/<model-id> ref, or (for openrouter/ollama) was not found in the catalog listing — see models_list
- `PROVIDER_UNSUPPORTED_BY_HARNESS` — this engine runs the pi harness, which supports only openrouter/ollama models — use an openrouter/anthropic/... model instead (check models_list({query:'anthropic/'}) or models_list({provider:'openrouter'}) for the exact id) or an ollama/* model, never "anthropic/*" directly
- `TOOL_UNSUPPORTED_BY_HARNESS` — this tool has no mapping under the pi harness (gateway:"pi") — only Read/Write/Edit/Bash/Grep/Glob/LS are supported; declare a supported tool or switch this engine back to gateway:"sdk"
- `SKILL_REQUIRES_READ_TOOL` — this engine runs the pi harness (gateway:"pi"); a declared skill requires 'Read' or 'Bash' in this dispatch's allowedTools — pi only lists a skill in its system prompt when one of those two tools is present (no separate Skill tool exists on pi)
- `AGENTDIR_UNAVAILABLE` — the pi gateway could not create or verify its own private per-dispatch directory (agentDir) under confinement.workRoot, or a private per-process fallback — check that workRoot (or the host tmp dir, with no workRoot configured) is writable by this engine's own user and that nothing else (a symlink, a foreign-owned directory, a stray file) occupies the `pi-agentdirs` path there
- `TMPDIR_SCRATCH_UNAVAILABLE` — the pi gateway could not create or verify its own private per-dispatch TMPDIR scratch directory under confinement.workRoot (the `pi-tmp` sibling of `pi-agentdirs`) — same remediation as AGENTDIR_UNAVAILABLE: check that workRoot is writable and nothing foreign occupies that path
- `SANDBOX_UNAVAILABLE` — the pi gateway's confined Bash sandbox (srt / @anthropic-ai/sandbox-runtime) could not be initialized on this host — check that bwrap and socat are installed, and that a ripgrep-capable CLI binary is reachable (the engine normally supplies its own via the bundled @anthropic-ai/claude-agent-sdk-<platform> package; see DEPLOY.md §1b2 for the platform-support caveat)
- `BASH_READONLY_UNENFORCEABLE` — an agent() call declared bash:'readonly', but this engine cannot enforce it on this dispatch — either the boot confinement probe measured this host as unconfined (no working kernel Bash sandbox), or the call has no known workspace root to deny writes to; drop bash:'readonly' on this deployment, or fix host confinement (DEPLOY.md's confinement remediation) and retry
- `OPENROUTER_AUTH_MISSING` — no OpenRouter API key is configured on this engine — set RWE_SECRET_OPENROUTER_API_KEY (preferred) or a bare OPENROUTER_API_KEY environment variable before dispatching an openrouter/* model under gateway:"pi"
- `PATH_ESCAPES_WORKSPACE` — a tool call (Read/Write/Edit/Glob/Grep/LS) under gateway:"pi" resolved to a path outside this run's own workspace — including through a symlink planted inside the workspace that points outside it; every one of those five file tools is jailed to the workspace root and refuses rather than follow the link. `Bash` is NOT jailed this way: its containment is the kernel sandbox (see the Host path grants section) — a confined Bash command reading outside the workspace fails with an ordinary shell-level error (e.g. "No such file or directory"), never this code, and is not limited to the workspace alone (it also denies $HOME and the whole workRoot, while leaving the system toolchain and any operator-granted host path readable)
- `MCP_SERVER_CONFIG_INVALID` — a declared MCP server's resolved configuration has no runnable transport — it needs either {type:"http", url:...} or {command:...}; check the workspace_push({kind:"mcp"}) config that provisioned it
- `MODEL_REGISTRATION_FAILED` — the pi harness could not register this dispatch's model with its own ModelRuntime — usually transient (a provider-side hiccup) or a sign the model id itself is not one openrouter/ollama actually serves; retry, and verify the exact ref against models_list
- `SCRIPT_INVALID` — the script violates a sandbox-enforced structural rule
- `SCAN_VIOLATION` — an agent() call is not scannable — label/options must be literal (ADR-029)
- `PHASES_REQUIRED` — meta.phases is missing or not a valid array of {title:string} — declare it, matching your phase() calls in count/order (phases: [] when the script calls phase() zero times)
- `PHASES_MISMATCH` — meta.phases disagrees with the script's own phase() calls in count, order, or title
- `MERMAID_INVALID` — the diagram does not parse under checkMermaid's grammar
- `VALUE_MISMATCH` — an agent node's `<br/>model · effort · timeout` triple disagrees with that label's declared default(s) — detail names the label and which field(s) disagree
- `COLLAPSED_EDGE` — an edge uses the `&` fan-out shorthand (e.g. `a-->b & c`) — write one edge per line instead
- `MERMAID_REQUIRED` — v24 registration requires a non-empty mermaid diagram string (ADR-025)
- `DIAGRAM_MISMATCH` — the diagram's agent labels disagree with the script's
- `DIAGRAM_DIRECTION` — a v2 diagram header must be graph LR / flowchart LR
- `LANE_MISMATCH` — the diagram's subgraph lanes (count/order/title, or a stadium's containing lane) disagree with the script's phases
- `TOOLS_MISMATCH` — a stadium's tools: line disagrees with the script's allowedTools for that label
- `EDGE_MISMATCH` — the diagram's edges do not realise the script's consecutive-slot flow
- `AGENT_BEFORE_PHASE` — under the v2 diagram contract every agent() must be dispatched inside a phase() — add a phase() before the first agent()
- `AGENT_UNDECLARED` — a script agent() label has no params.agents.<label> declaration
- `AGENT_DECLARED_NOT_IN_SCRIPT` — params.agents declares a label no agent() call in the script uses
- `PARAM_CONTRACT_INVALID` — the declared parameter contract itself is malformed or out of its own bounds; also returned at run_start admission when overrides.agents (or overrides.agents.<label>) is not an object
- `PARAM_OUT_OF_RANGE` — a declared or overridden parameter value is outside its allowed range
- `INVALID_SCHEMA` — an agent()'s declared `schema` option is not a valid JSON Schema; see the thrown message for Ajv's own compile error
- `PARAM_LOCKED` — a caller override targets a key the author locked (prompt/allowedTools/bash/skills/mcp/workdir/cwd)
- `PARAM_UNKNOWN` — a caller override names a parameter the contract does not declare
- `UNKNOWN_AGENT_LABEL` — a caller override names an agent label the contract does not declare
- `DEFAULTS_RETIRED` — meta.params.knobs / meta.defaults are retired; declare params.agents.<label> instead
- `LEGACY_REREGISTER` — this version predates the v24 contract and cannot run; re-register it
- `INLINE_SCRIPT_CLOSED` — inline run-time scripts are closed; register once, then run by name
- `CONFINEMENT_UNAVAILABLE` — this host could not measure a working Bash sandbox at boot; a run is refused when EITHER its trigger's provenance OR its resolved script version's registering submission is remote — a remote run_start/run_resume, a webhook delivery or schedule firing whose trigger was created remotely, or ANY run (including a local one) resolving to a version registered remotely. Remediation: the Claude CLI sandbox requires BOTH bubblewrap (bwrap) AND socat installed and on PATH — if the boot-time probe reason names a missing binary, install it (Ubuntu/Debian: sudo apt install bubblewrap socat) and restart this engine; separately, on an Ubuntu/AppArmor host, a nested-bwrap probe failure is usually the bwrap-userns-restrict AppArmor profile blocking a second, nested unprivileged user namespace — set kernel.apparmor_restrict_unprivileged_userns=0 (e.g. via /etc/sysctl.d/60-rwe-userns.conf, then sysctl --system) AND disable the profile (ln -s /etc/apparmor.d/bwrap-userns-restrict /etc/apparmor.d/disable/ && apparmor_parser -R /etc/apparmor.d/bwrap-userns-restrict), then restart this engine; this is a host-wide relaxation (any unprivileged process on the host can now nest user namespaces) — revert both steps (remove the sysctl override and re-enable the profile: rm the symlink under disable/ and apparmor_parser again) on a shared/multi-tenant host
- `NESTING_DEPTH_EXCEEDED` — nested workflow() calls exceed the configured maxWorkflowDepth
- `NESTING_CYCLE` — a workflow() call would re-enter an ancestor already on this call's chain
- `DESCENDANT_CAP_EXCEEDED` — nested workflow() calls exceed the configured maxWorkflowDescendants
- `TRIGGER_NOT_FOUND` — no trigger (schedule or webhook) is registered under this id
- `TRIGGER_ALREADY_CLAIMED` — this trigger id is already claimed by a different workflow
- `BUDGET_EXCEEDED` — the run's token budget is spent; the engine refused to dispatch this agent() call
- `AGENT_OPTS_TAMPERED` — the agent() call's dispatched allowedTools/bash does not match any options literal this script's registered scan recorded for that label — the options object was altered after registration (e.g. by a planted Array.prototype.toJSON)
- `RESERVED_PREFIX` — the name or a path segment starts with the engine-reserved 'rwe-' prefix, case-insensitively — 'RWE-x'/'Rwe-x' are refused the same as 'rwe-x' (ARCH-093)
- `INVALID_NAME` — the name must be a single path segment: non-empty, no leading/trailing whitespace, no control characters (0x00-0x1F, 0x7F) anywhere in the name, no '/' or '\', not '.' or '..', at most 128 characters AND at most 200 UTF-8 bytes (a multi-byte name can satisfy one ceiling while still exceeding the other)
- `INVALID_SEED_SPEC` — the seed/seedManifest/seedManifestRef payload does not match its declared shape
- `UNKNOWN_RUN_PLACEHOLDER` — a pushed mcp config references ${run:xxx} with an unknown name — only ${run:dir} (a per-run, per-server private directory) and ${run:id} (this run's id) are supported
- `ITEM_CAP_EXCEEDED` — parallel()/pipeline() refused: either the argument was not an array at all, or the array exceeds the configured item cap — see the thrown message for which
- `RESULT_NOT_SERIALIZABLE` — an agent()/workflow() script returned a value that is not JSON-serializable (e.g. a circular reference or a BigInt) — return only JSON-compatible values
- `RESULT_TOO_LARGE` — an agent()/workflow() script's returned value exceeds the engine's return-value size cap — return a smaller value (e.g. a summary or a reference), not the full payload
- `SCRIPT_TIMEOUT` — the sandboxed script did not complete within the engine's run-duration deadline (maxRunDurationMs) and was terminated — reduce the work per run, or split it across multiple shorter runs/phases
- `SCRIPT_OOM` — the sandboxed script exhausted its memory limit and was terminated — avoid unbounded in-memory accumulation (e.g. append-only arrays/strings across many agent() calls); process data in smaller chunks or summarize incrementally

## Provisioning skills and MCP servers: roles, config shapes, and the trust boundary

The role/scope/transport matrix (`author` = owns the target workflow; `admin` bypasses ownership):

| Capability | `user` | `author` | `admin` |
|---|---|---|---|
| Push a skill, `scope:'workflow'` (must own the workflow) | `FORBIDDEN_ROLE` | yes | yes |
| Push a skill, `scope:'global'` | `FORBIDDEN_ROLE` | `FORBIDDEN_ROLE` | yes |
| Use a skill your own run declares (workflow-scoped OR global — either resolves) | yes | yes | yes |
| Push an MCP server, `type:'http'` (remote) | `FORBIDDEN_ROLE` | yes, gated on `mcpEgressAllowlist` + a live probe | yes, same gates |
| Push an MCP server, `type:'stdio'` (local process) | `FORBIDDEN_ROLE` | `FORBIDDEN_ROLE` | yes |
| Use an MCP server your own run declares (workflow-scoped OR global) | yes | yes | yes |
| Ship a CLI as a skill file with `exec:true` | `FORBIDDEN_ROLE` | yes, for a workflow you own | yes |
| Ship a CLI via a `run_start`/version-default `seedManifest` entry with `exec:true` | yes (`workspace_push({sha256,contentB64})` is `cas`-mode, no role floor beyond authenticated `user`; `run_start` itself is `user`-level too) | yes | yes |
| Install a package/tool AT RUN TIME (`npm install`, `pip install`, a fetched binary, …) | not a supported path on any role — see "Shipping a CLI" below for the posture caveat | | |

With authentication enabled, an account that has signed in but has no role in the engine's principals config (and no role granted at runtime) is `none` = pending approval: EVERY tool answers `ACCOUNT_PENDING_APPROVAL` until an admin grants user/author/admin with `principal_set_role` (or the dashboard admin page).

**Skill files and the `exec` flag.** `workspace_push({kind:'skill', files:[{path, contentB64, exec?}]})` materializes each file 0o755 (`exec:true`) or 0o644 (absent/false) — identical in shape and meaning to a `seedManifest` entry's `{path, sha256, exec?}`. Set it on a script with a shebang or a compiled CLI (an ELF binary, not a text script) that the agent should be able to run directly; never on the skill's own top-level `SKILL.md` (refused `INVALID_ARGUMENT` — it is the manifest, never executed). The dispatched agent always runs inside its Bash sandbox either way: without `exec` a shebang script still runs via `sh <path>` or `python3 <path>`, but a compiled binary cannot run at all without it. Legacy skills pushed before this flag existed carry no mode information — they stay at whatever mode the original write happened to give them (umask-dependent, never made executable by this) — push again with `exec:true` to change that.

**Shipping a CLI.** There is no separate `kind:'tool'` asset — the two supported paths are a skill file with `exec:true` (above, `author`/`admin` only, and only into a workflow you own) or a `run_start`/version-default `seedManifest` entry with `exec:true` (see "Seeding a workspace" above — the CAS blob push and `run_start` behind that path are both `user`-level, no ownership required). Installing a package or tool AT RUN TIME (`npm install`, `pip install`, a fetched binary, …) is not a supported path on this engine: on a `confined` deployment the sandbox blocks egress and confines writes to the run workspace (see "Host path grants" above for this deployment's measured posture), so it genuinely cannot work; ship the binary bytes with the push instead regardless of posture.

**MCP config shapes.** `workspace_push({kind:'mcp', name, config})` accepts exactly two server-runnable shapes — `stdio` requires `command` to be EXACTLY `"npx"` (any other command, including a direct binary path or `node -e ...`, does not classify as a supported transport). Anything else — the exact two shapes below are the only ones — is refused `UNSUPPORTED_TRANSPORT` inside `MCP_PROBE_FAILED`'s `detail.code` before any probe:

```json
{ "type": "http", "url": "https://example.com/mcp" }
{ "type": "stdio", "command": "npx", "args": ["-y", "@some/mcp-server"] }
```

A `${secret:NAME}` placeholder may appear anywhere inside `config` — in any string value, at any depth of a nested object or array — and is resolved from `RWE_SECRET_<NAME>` in the engine's OWN environment (operator-provisioned, e.g. `~/.config/rwe.env`), never sent to any sandbox and never visible to an agent. Resolution is atomic and happens at DISPATCH time (a run actually declaring that MCP name), not at push time: every handle in the config must resolve or that `agent()` call fails, its failure detail carrying `SECRET_MISSING: ...` (a handle naming no such secret) or `SECRET_HANDLE_INVALID: ...` (malformed `${secret:...}` grammar) — never a partial substitution, never the literal placeholder smuggled through as a value.

**The push-time probe.** Before a `kind:'mcp'` push is accepted, the engine runs a lightweight reachability check ONCE, IN THE ENGINE'S OWN PROCESS: a `type:'http'` config gets a short HTTP HEAD request; a `type:'stdio'` config SPAWNS the configured command directly on the engine host to confirm it launches. Since only `command:'npx'` is accepted, this means the package download happens for real, right then, into the ENGINE USER's own `~/.npm` cache — using whatever network access that user has, not the sandboxed egress a dispatched agent gets. A failed probe is refused `MCP_PROBE_FAILED`, whose `detail` carries the underlying probe code/message/transport (`UNSUPPORTED_TRANSPORT`, `UNREACHABLE`, `PROBE_FAILED`, …); nothing is stored either way until the probe succeeds.

**Why `stdio` is admin-only.** A pushed `stdio` MCP server is not run inside the per-agent Bash sandbox at all — it runs as an ordinary child process of the ENGINE ITSELF, with the engine user's full filesystem and network access (in principle, it can read the engine's own secrets and data — the same trust tier as the engine process, not a dispatched agent). It is also not gated by `mcpEgressAllowlist` at all (that list only inspects a config's `url` field, which a `stdio` config never carries). Pushing one is handing it host-level trust, which is why every role below `admin` is refused `FORBIDDEN_ROLE` before any probe ever runs — this is intentional, not a gap to work around. `type:'http'` stays author-reachable because it IS gated — `mcpEgressAllowlist` (an `rwe.config.json` key: an https-only URL-prefix allowlist, the same fail-closed convention as `seedRefAllowlist`; omitted or empty denies EVERY `http` MCP config with `EGRESS_DENIED`, checked BEFORE the probe, zero probe attempts) is an operator decision an author cannot widen — but you can SEE it before pushing: `system_info`'s `policy.mcpEgressAllowlist` (owner decision 2026-09-30) reports this deployment's effective list to any authenticated caller, and an `EGRESS_DENIED` refusal from `workspace_push({kind:'mcp'})` points back at that same field. Two narrower checks run even BEFORE the allowlist, so a config that trips one of them never sees `EGRESS_DENIED` at all, no matter the allowlist: an unknown `${run:...}` placeholder (`UNKNOWN_RUN_PLACEHOLDER` — see "Per-run MCP state" below) and a `url`-bearing config whose `type` IS set and is one the probe would itself call `'unsupported'` — `type:'sse'`, or `type:'stdio'` with a `command` other than `"npx"` (e.g. `{type:'stdio', command:'node'}`) — is `MCP_PROBE_FAILED`/`UNSUPPORTED_TRANSPORT`, the same code the probe itself would give, just returned before the probe (and the allowlist) are ever reached. A real `{type:'stdio', command:'npx'}` config that happens to ALSO carry a `url` field is NOT caught by this — it is a supported transport — and reaches the allowlist and probe exactly as a `url`-less one would. A config with a `url` but NO `type` at all is also not covered by this: it still reaches the allowlist first, exactly as before.

**A `stdio` server's own state is shared across EVERY run and principal that declares it, unless you ask for it to be kept per-run.** The trust-tier point above is about what the server CAN reach; this is about what it actually keeps. A `stdio` server runs as one ordinary engine-host process per agent session — not a fresh process per run — so any state it persists OUTSIDE its own process (a file under its default location in the engine user's HOME, its `npx` package cache, an absolute path baked into its own defaults) is a single host-global store every run of every principal that declares the SAME server name reads and writes. `@modelcontextprotocol/server-memory`, for example, defaults to a JSONL file inside its own npx package directory — two unrelated runs started minutes apart by two different principals, each creating entities under what they each believe is THEIR OWN graph, actually read and write the exact same file. Nothing in the run sandbox catches this (the workspace, `/tmp`, and materialized skills are each correctly kept separate per run — this is the one channel that is not, because the server itself runs outside that sandbox, per the trust-tier paragraph above).

`config`'s `env` values and `args` items may reference two per-run placeholders, resolved at DISPATCH time (same timing as `${secret:NAME}`, and stored unresolved, same as it): `${run:dir}` (an empty, private directory this engine creates 0700 the first time THIS run uses it — `<workflowFolder>/mcp-state/<runId>/<serverName>/`, never inside the pulled run workspace, so it is NOT reachable via `workspace_pull`/`workspace_list`) and `${run:id}` (this run's id, as a plain string). The SAME run's agents that declare the same server share the SAME `${run:dir}` (sequential `agent()` calls can hand off through it); a DIFFERENT run — even of the same workflow, even started by the same principal — never sees it, and it is deleted when the run's own workspace is (the engine's existing workspace retention/GC policy, unchanged — see DEPLOY.md). Any OTHER `${run:xxx}` name is refused `UNKNOWN_RUN_PLACEHOLDER` at push time, before the probe ever runs, so a typo is caught immediately rather than surfacing as a confusing launch failure on a run's first dispatch. Example — the server-memory server above, made per-run instead of host-global:

```json
{
  "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"],
  "env": { "MEMORY_FILE_PATH": "${run:dir}/memory.jsonl" }
}
```

A server with no state of its own (nothing written outside the one request/response it is handling) needs neither placeholder — most servers are this shape, and `${run:dir}` costs nothing for them to skip. When in doubt, prefer a stateless server, or point whatever state it keeps at `${run:dir}`.

**Global assets are opt-in per script, not automatic.** An admin-pushed `scope:'global'` skill or MCP server is usable by every principal's runs, but ONLY when that run's OWN script declares the name (`meta.params.agents.<label>.skills`/`.mcp`) — existing at global scope never auto-grants it to an agent that doesn't ask for it, and a declared-but-absent name (workflow-scoped or global, checked in that order) is refused `SKILL_NOT_PROVISIONED`/`MCP_NOT_PROVISIONED` at admission, not registration. Don't know the exact name? `workspace_list({scope:'global', kind:'skill'|'mcp'})` lists every global asset of that kind — name plus (skill) its SKILL.md description or (mcp) its transport type, nothing more. Add `includeBody:true` (skills only) to also read the FULL SKILL.md text — its instructions and any dependency it names (e.g. "requires MCP X") — BEFORE you declare/register against it (capped at 16 KiB, `bodyTruncated:true` past the cap; refused `INVALID_ARGUMENT` outside `{scope:'global', kind:'skill'}`). That text is visible to every approved principal this way, same as the description already is — an admin pushing a global skill must never put a secret in its SKILL.md.

## Provisioning: warned at registration, refused at admission

Registering a script whose agent() declares an mcp/skill name with no `workspace_push`-provisioned asset SUCCEEDS anyway (the version registers, with a `result.warnings` entry naming the label and the missing name(s)) — it is `run_start` (and a schedule/webhook firing, and a nested `workflow()` call) that REFUSES, before any side effect, once the name is still unprovisioned at admission time:

- `MCP_NOT_PROVISIONED` — an agent() call declares an mcp name with no workspace_push-provisioned asset (workflow-scoped or global) — admission refuses before any side effect; registration only warns
- `SKILL_NOT_PROVISIONED` — an agent() call declares a skill name with no workspace_push-provisioned asset (workflow-scoped or global) — admission refuses before any side effect; registration only warns

## Authoring convention (not checked)

Declare every knob a user might need in `meta.params` rather than hard-coding it, and never read a value the contract does not declare: a value the script reaches for but the contract never named cannot be tuned by a caller, cannot be shown by `workflow_describe`, and cannot be bounded by the engine ceilings. Nothing refuses it — the cost is simply that the workflow can only be changed by editing it.

Phase titles (`phase(title)` and `meta.phases[].title`) are visible to every principal who can see the workflow, including the non-owner projection and your own `mermaid` diagram, which `workflow_describe` serves verbatim to any caller — a phase title is not a private annotation, so keep secrets and distinctive internal prose out of it. The diagram you draw is structure-only: it is your responsibility, not an enforced check, to keep secrets out of node text and labels.

## Registered examples

This guide is generated once and is not per-deployment: the examples below declare the neutral `anthropic/claude-haiku-4-5-20251001` ref, usable as-is under `gateway:"sdk"` (the default). Under `gateway:"pi"`, every `anthropic/*` ref — including these — is refused `PROVIDER_UNSUPPORTED_BY_HARNESS`; swap in an `openrouter/`/`ollama/` ref instead (the LIVE `workflow_authoring_guide` response on a pi deployment renders this same section with `openrouter/anthropic/claude-haiku-4.5` already substituted).

### single agent

```js
export const meta = {
  description: 'Summarize the given topic in one paragraph',
  phases: [{ title: 'summarize' }],
  params: { agents: { writer: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
};
phase('summarize');
return await agent('writer', { prompt: 'Summarize the topic' });
```

Mermaid:

```
graph LR
subgraph "summarize"
writer(["writer<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
end
```

### three-stage pipeline

```js
export const meta = {
  description: 'Draft, then edit, then finalize a piece of text',
  phases: [{ title: 'draft' }, { title: 'edit' }, { title: 'final' }],
  params: { agents: { draft: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, edit: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, final: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
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
draft(["draft<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
end
subgraph "edit"
edit(["edit<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
end
subgraph "final"
final(["final<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
end
draft-->edit
edit-->final
```

### fan-out/fan-in

```js
export const meta = {
  description: 'Fan out research to three topics in parallel, then combine the results',
  phases: [{ title: 'research' }, { title: 'combine' }],
  params: { agents: { alpha: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, beta: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, gamma: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, combiner: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'medium' }, timeoutMs: { type: 'number', default: 90000 } } } },
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
alpha(["alpha<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
beta(["beta<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
gamma(["gamma<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
end
subgraph "combine"
combiner(["combiner<br/>anthropic/claude-haiku-4-5-20251001 · medium · 90000<br/>tools: default"])
end
alpha-->combiner
beta-->combiner
gamma-->combiner
```

### ternary routing

```js
export const meta = {
  description: 'Classify urgency, then route to a fast or thorough agent',
  phases: [{ title: 'classify' }, { title: 'route' }],
  params: { agents: { classifier: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, fast: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, thorough: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'high' }, timeoutMs: { type: 'number', default: 120000 } } } },
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
classifier(["classifier<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
end
subgraph "route"
routeChoice{"fast or thorough?"}
fast(["fast<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
thorough(["thorough<br/>anthropic/claude-haiku-4-5-20251001 · high · 120000<br/>tools: default"])
end
classifier-->routeChoice
routeChoice-->|fast|fast
routeChoice-->|thorough|thorough
```

### conditional

```js
export const meta = {
  description: 'Classify the input, then branch to one of two agents',
  phases: [{ title: 'classify' }, { title: 'handle' }],
  params: { agents: { classifier: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, simple: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, complex: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'high' }, timeoutMs: { type: 'number', default: 120000 } } } },
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
classifier(["classifier<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
end
subgraph "handle"
handleChoice{"simple or complex?"}
simple(["simple<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
complex(["complex<br/>anthropic/claude-haiku-4-5-20251001 · high · 120000<br/>tools: default"])
end
classifier-->handleChoice
handleChoice-->|simple|simple
handleChoice-->|complex|complex
```

### non-agent aggregation

```js
export const meta = {
  description: 'Score three candidates with an agent, then pick the best score without another agent call',
  phases: [{ title: 'score' }],
  params: { agents: { scorerX: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, scorerY: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, scorerZ: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
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
scorerX(["scorerX<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
scorerY(["scorerY<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
scorerZ(["scorerZ<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
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
  phases: [{ title: 'draft' }, { title: 'critique' }, { title: 'revise' }],
  params: { agents: { writer: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, critic: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
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
writer1(["writer<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
end
subgraph "critique"
critic(["critic<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
end
subgraph "revise"
writer2(["writer<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
end
writer1-->critic
critic-->writer2
```

### nested workflow() black box

```js
export const meta = {
  description: 'Delegates to another registered workflow, then summarizes its result',
  phases: [{ title: 'delegate' }, { title: 'summarize' }],
  params: { agents: { summarizer: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
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
summarizer(["summarizer<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
end
```

### parallel workflow() delegation

```js
export const meta = {
  description: 'Delegates to two other registered workflows in parallel — a parallel() of workflow() calls yields no agent slot',
  phases: [{ title: 'delegate' }],
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
  phases: [{ title: 'write' }],
  params: { args: { topic: { type: 'string' } }, agents: { writer: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
};
phase('write');
return await agent('writer', { prompt: 'Write about: ' + args.topic });
```

Mermaid:

```
graph LR
subgraph "write"
writer(["writer<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
end
```

### dynamic phase title

```js
export const meta = {
  description: 'The phase title is computed from a declared arg — a static scan cannot know it in advance',
  phases: [{ title: 'processing' }],
  params: { args: { tier: { type: 'string' } }, agents: { worker: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
};
phase('tier:' + args.tier);
return await agent('worker', { prompt: 'Handle the request' });
```

Mermaid:

```
graph LR
subgraph "processing"
worker(["worker<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: default"])
end
```

### skills and mcp

```js
export const meta = {
  description: 'An agent declared with a skill and an mcp server and NO file tools — the declared skill is still reachable, through the Skill tool',
  phases: [{ title: 'code' }],
  params: { agents: { coder: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'medium' }, timeoutMs: { type: 'number', default: 120000 }, skills: ['repo-search'], mcp: ['project-tracker'] } } },
};
phase('code');
return await agent('coder', { prompt: 'Use the repo-search skill to say where the retry policy is defined', allowedTools: [] });
```

Mermaid:

```
graph LR
subgraph "code"
coder(["coder<br/>anthropic/claude-haiku-4-5-20251001 · medium · 120000<br/>tools: none"])
end
```

### no tools — pure reasoning

```js
export const meta = {
  description: 'A judge agent restricted to no tools at all — pure text reasoning',
  phases: [{ title: 'judge' }],
  params: { agents: { judge: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
};
phase('judge');
return await agent('judge', { prompt: 'Answer PASS or FAIL', allowedTools: [] });
```

Mermaid:

```
graph LR
subgraph "judge"
judge(["judge<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: none"])
end
```

## Service accounts (non-interactive access)

A program, CI job, or bot connects without a human login via a SERVICE ACCOUNT — an admin creates one with `service_account_create` (role `author`/`user`, never `admin`; an optional `workflows` allowlist). It authenticates with `POST /token` (RFC 6749 §4.4 `client_credentials`), client id `sa:<name>`, client secret the `clientSecret` shown ONCE at create/rotate:

```bash
curl -s https://<host>/token -d grant_type=client_credentials \
  -d client_id=sa:ci-bot -d client_secret=rwe_sa_...
# => {"access_token":"...","token_type":"Bearer","expires_in":3600}  (no refresh_token)
```

The `access_token` is a normal engine bearer — `Authorization: Bearer <token>` on `/mcp`, same as a human session. To connect Claude Code non-interactively, configure the rwe MCP server with a `headersHelper` script that performs this exchange (caching until near expiry) and prints the header as a JSON OBJECT — `{"Authorization":"Bearer <token>"}` — NOT a raw `Header: value` text line; the bundled CLI `JSON.parse`s the script's stdout. Full worked example (the complete script, `claude mcp add-json`/`--mcp-config --strict-mcp-config` usage, rotation procedure, least-privilege allowlist guidance): see DEPLOY.md's "服務帳號 (Service accounts)" section.
