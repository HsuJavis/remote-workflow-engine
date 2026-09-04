# Authoring a workflow script

This engine has no bundled guidance skill — the tool schemas returned by `tools/list` are the only documentation a cold MCP client ever sees, and `workflow_authoring_guide` (this text) is what every authoring error's `see` field points back to.

## The sandbox API

A workflow script runs inside a restricted VM context with exactly these globals — nothing else is reachable (`agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, `budget`, `workflow`):

- `await agent(label, options)` — dispatches one agent call. `label` MUST be a literal string identifier (`/^[A-Za-z_][\w-]*$/`) matching a `meta.params.agents.<label>` declaration; `options` MUST be a literal object (no variable, no spread).
- `await parallel([thunk, ...])` — runs an array of zero-argument thunks concurrently, each returning `null` on its own thrown error rather than rejecting the whole call.
- `await pipeline([item, ...], stage1, stage2, ...)` — runs each item through the stage chain.
- `phase(title)` — names the current step for observability. Titles are public (see below).
- `log(...)` — a no-op placeholder in this sandbox (accepted, does nothing).
- `args` — the caller-supplied run arguments, shaped by `meta.params.args`.
- `budget` — `{total, spent(), remaining()}`, read-only.
- `await workflow(name, args)` — runs another registered workflow. A workflow() call may itself call workflow() again, recursing up to this deployment's configured `maxWorkflowDepth` (cycle-checked, descendant-capped) — a call that exceeds the depth is refused `NESTING_DEPTH_EXCEEDED`, one that would re-enter an ancestor on its own chain is refused `NESTING_CYCLE`, and one that pushes the run past its descendant cap is refused `DESCENDANT_CAP_EXCEEDED`. (An earlier one-level cap with a flatten-it instruction is what an older draft of this guide taught — that no longer matches what's shipped.) Even with depth available, the simplest and most readable script still flattens a needless wrapper into its caller, and draws another owner's workflow as a black-box rectangle node in your diagram rather than expanding it.

## Declaring the parameter contract

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

`meta.params.args` declares the run-time inputs the script reads off `args.<name>` — `{type, enum?, min?, max?}`, no `.default` (a declared args default is refused: it is advertised but never applied).

`meta.params.knobs` and `meta.defaults` are retired — a script that declares either is refused `DEFAULTS_RETIRED`, naming `meta.params.agents.<label>.<key>.default` as the replacement.

The engine-owned keys are never written inside an `agent()` call's options literal — `model`, `effort`, and `timeoutMs` there are refused `SCAN_VIOLATION`, naming the key and the `meta.params.agents.<label>.<key>.default` it belongs in instead.

## Locked vs. tunable

The six locked keys are engine-owned and can never be overridden by a caller: prompt, tools, skills, mcp, workdir, cwd. The four tunable keys an override may target, per declared agent label, are: model, effort, timeoutMs, appendPrompt.

## Engine ceilings (this deployment)

The ceilings below are this build's resolved values — operator-overridable, so a different deployment's engine may render different numbers here: a declared agent's `timeoutMs.default` may not exceed 600000ms, a declared `appendPrompt.default` may not exceed 1024 bytes, and a declared `effort.default` may not rank above 'high'. A declaration above any of these ceilings is refused `PARAM_OUT_OF_RANGE` at registration — never silently clamped.

## The author-supplied diagram

Every registration requires a non-empty Mermaid `mermaid` string (`MERMAID_REQUIRED`) — the engine no longer draws the diagram for you (that generator is retired: registering a script used to send the whole script body to an LLM as a prompt; the diagram is now yours to draw, so nothing you write is sent anywhere just to produce a picture). The diagram must use only the three node shapes `id(["agent label"])` (stadium — MUST exactly match your script's agent() labels, checked both ways: an agent label with no matching node, or a node with no matching label, is `DIAGRAM_MISMATCH`), `id["free text"]` (rectangle — a black-box node, e.g. another owner's nested workflow; excluded from the label check), and `id[/"free text"/]` (trapezoid — e.g. a trigger header). Edges are `a-->b`, `a<-->b` (bidirectional, excluded from the cycle check), or `a-.->b`, optionally carrying `|a label|`. Any edge that sits inside a cycle (a directed loop back to an ancestor, or a self-loop) MUST carry a `|label|` — describe what the loop is doing (e.g. `|revise|`), not just that it loops. A `subgraph "title"` / `end` pair boxes related nodes (e.g. a debate) under a mandatory quoted title. For a live preview before you register, paste your diagram into a Mermaid live editor (e.g. https://mermaid.live/) — this guide only checks the grammar, it does not render.

## Registration and versioning

Registering a script that predates the v24 contract (or was never migrated) resolves `runnable:false` with `runnableReason: LEGACY_REREGISTER` — re-register it under the current contract; there is no legacy-resolution ladder. Omitting a currently-registered trigger from a new version does not release it (omission does not release) — deregister the trigger explicitly if you mean to stop it. A `once` trigger is consumed on its firing attempt — whether that attempt succeeds or is refused — and will not fire again; a refused `cron` firing instead gets a fresh future `nextFire` and tries again next time. Assets (skills/mcp) registered under an owner are shared across every version of that workflow name, not pinned to the version that first declared them.

## Authoring rules this engine enforces (refused with this code)

- `PARSE_ERROR` — the script body failed to parse as TypeScript
- `UNKNOWN_ALIAS` — a model alias in the script is not in the configured alias table
- `MCP_NOT_PROVISIONED` — an agent() call references an mcp name with no provisioned secret
- `SCRIPT_INVALID` — the script violates a sandbox-enforced structural rule
- `SCAN_VIOLATION` — an agent() call is not scannable — label/options must be literal (ADR-029)
- `MERMAID_INVALID` — the diagram does not parse under checkMermaid's grammar
- `MERMAID_REQUIRED` — v24 registration requires a non-empty mermaid diagram string (ADR-025)
- `DIAGRAM_MISMATCH` — the diagram's agent labels disagree with the script's
- `AGENT_UNDECLARED` — a script agent() label has no params.agents.<label> declaration
- `AGENT_DECLARED_NOT_IN_SCRIPT` — params.agents declares a label no agent() call in the script uses
- `PARAM_CONTRACT_INVALID` — the declared parameter contract itself is malformed or out of its own bounds
- `PARAM_OUT_OF_RANGE` — a declared or overridden parameter value is outside its allowed range
- `PARAM_LOCKED` — a caller override targets a key the author locked (prompt/tools/skills/mcp/workdir/cwd)
- `PARAM_UNKNOWN` — a caller override names a parameter the contract does not declare
- `UNKNOWN_AGENT_LABEL` — a caller override names an agent label the contract does not declare
- `DEFAULTS_RETIRED` — meta.params.knobs / meta.defaults are retired; declare params.agents.<label> instead
- `LEGACY_REREGISTER` — this version predates the v24 contract and cannot run; re-register it
- `INLINE_SCRIPT_CLOSED` — inline run-time scripts are closed; register once, then run by name
- `NESTING_DEPTH_EXCEEDED` — nested workflow() calls exceed the configured maxWorkflowDepth
- `NESTING_CYCLE` — a workflow() call would re-enter an ancestor already on this call's chain
- `DESCENDANT_CAP_EXCEEDED` — nested workflow() calls exceed the configured maxWorkflowDescendants

## Authoring convention (not checked)

Declare every knob a user might need in `meta.params` rather than hard-coding it, and never read a value the contract does not declare: a value the script reaches for but the contract never named cannot be tuned by a caller, cannot be shown by `workflow_describe`, and cannot be bounded by the engine ceilings. Nothing refuses it — the cost is simply that the workflow can only be changed by editing it.

Phase titles (`phase(title)` and `meta.phases[].title`) are visible to every principal who can see the workflow, including the non-owner projection and the generated diagram — a phase title is not a private annotation, so keep secrets and distinctive internal prose out of it. The diagram you draw is structure-only: it is your responsibility, not an enforced check, to keep secrets out of node text and labels.

## Registered examples

### single agent

```js
export const meta = {
  description: 'Summarize the given topic in one paragraph',
  params: { agents: { writer: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
};
return await agent('writer', { prompt: 'Summarize the topic' });
```

Mermaid:

```
graph TD
writer(["writer"])
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
graph TD
draft(["draft"])
edit(["edit"])
final(["final"])
draft-->edit
edit-->final
```

### fan-out/fan-in

```js
export const meta = {
  description: 'Fan out research to three topics in parallel, then combine the results',
  params: { agents: { researcher: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, combiner: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'medium' }, timeoutMs: { type: 'number', default: 90000 } } } },
};
const topics = ['a', 'b', 'c'];
const results = await parallel(topics.map((t) => () => agent('researcher', { prompt: 'Research ' + t })));
return await agent('combiner', { prompt: 'Combine: ' + results.join(', ') });
```

Mermaid:

```
graph TD
r1(["researcher"])
r2(["researcher"])
r3(["researcher"])
combiner(["combiner"])
r1-->combiner
r2-->combiner
r3-->combiner
```

### non-agent aggregation

```js
export const meta = {
  description: 'Score three candidates with an agent, then pick the best score without another agent call',
  params: { agents: { scorer: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
};
const items = ['x', 'y', 'z'];
const scores = await parallel(items.map((it) => () => agent('scorer', { prompt: 'Score ' + it })));
return scores.reduce((best, s) => (Number(s) > Number(best) ? s : best), scores[0]);
```

Mermaid:

```
graph TD
scorer(["scorer"])
aggregate["pick the best score (no agent call)"]
scorer-->aggregate
```

### conditional

```js
export const meta = {
  description: 'Classify the input, then branch to one of two agents',
  params: { agents: { classifier: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, simple: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, complex: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'high' }, timeoutMs: { type: 'number', default: 120000 } } } },
};
const kind = await agent('classifier', { prompt: 'Classify the request' });
if (kind === 'simple') {
  return await agent('simple', { prompt: 'Handle the simple case' });
}
return await agent('complex', { prompt: 'Handle the complex case' });
```

Mermaid:

```
graph TD
classifier(["classifier"])
simple(["simple"])
complex(["complex"])
classifier-->simple
classifier-->complex
```

### labelled loop

```js
export const meta = {
  description: 'Draft and critique in a bounded loop until the critic approves',
  params: { agents: { writer: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }, critic: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
};
let draft = await agent('writer', { prompt: 'Write a draft' });
for (let i = 0; i < 3; i++) {
  const verdict = await agent('critic', { prompt: 'Critique: ' + draft });
  if (verdict === 'approved') break;
  draft = await agent('writer', { prompt: 'Revise using: ' + verdict });
}
return draft;
```

Mermaid:

```
graph TD
writer(["writer"])
critic(["critic"])
writer-->|draft|critic
critic-->|revise|writer
```

### debate subgraph

```js
export const meta = {
  description: "Two agents debate a proposition, each seeing the other's point",
  params: { agents: { proponent: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'medium' }, timeoutMs: { type: 'number', default: 90000 } }, opponent: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'medium' }, timeoutMs: { type: 'number', default: 90000 } } } },
};
const a = await agent('proponent', { prompt: 'Argue for the proposition' });
const b = await agent('opponent', { prompt: 'Argue against, given: ' + a });
return { a, b };
```

Mermaid:

```
graph TD
subgraph "debate"
proponent(["proponent"])
opponent(["opponent"])
proponent<-->opponent
end
```

### nested workflow() black box

```js
export const meta = {
  description: 'Delegates to another registered workflow, then summarizes its result',
  params: { agents: { summarizer: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
};
const child = await workflow('other-team-etl', { since: 'yesterday' });
return await agent('summarizer', { prompt: 'Summarize: ' + JSON.stringify(child) });
```

Mermaid:

```
graph TD
etl["workflow: other-team-etl (black box)"]
summarizer(["summarizer"])
etl-->summarizer
```

### declared args

```js
export const meta = {
  description: 'Uses a declared arg to steer the single agent call',
  params: { args: { topic: { type: 'string' } }, agents: { writer: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },
};
return await agent('writer', { prompt: 'Write about: ' + args.topic });
```

Mermaid:

```
graph TD
writer(["writer"])
```

### skills and mcp

```js
export const meta = {
  description: 'An agent declared with a skill name and an mcp server name',
  params: { agents: { coder: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'medium' }, timeoutMs: { type: 'number', default: 120000 }, skills: ['repo-search'], mcp: ['project-tracker'] } } },
};
return await agent('coder', { prompt: 'Fix the failing test' });
```

Mermaid:

```
graph TD
coder(["coder"])
```
