# Dynamic Workflow Compatibility Spec (as-is capability survey)

> **Purpose**: authoritative inventory of what Claude's built-in dynamic Workflow tool provides today.
> This is the 100%-compatibility target for REQ-001/002/003 and the architecture input for Gate 2.
> Source: the Workflow tool interface spec (the exact contract Claude follows when *generating* workflow JS),
> cross-validated against a real production script (`iso-agile-sdlc/workflows/sdlc-run.js`, 641 lines).
> Items marked **[EXT]** are extensions this product adds beyond the as-is tool.

## 1. Script format

- Plain **JavaScript, not TypeScript** — type annotations / interfaces / generics must fail to parse, matching the original.
- Must begin with `export const meta = {...}` — a **pure literal** (no variables, calls, spreads, template interpolation).
  - Required: `name`, `description`. Optional: `whenToUse`, `phases: [{title, detail?, model?}]`.
  - `meta.phases` titles are matched **exactly** against `phase()` calls; a `phase()` with no meta entry gets its own progress group.
- Script body runs in an **async context** — top-level `await` allowed.
- Standard JS built-ins available (JSON, Math, Array, …) **except**: `Date.now()`, `Math.random()`, argless `new Date()` **throw** (determinism guard — they would break resume/replay).
- **No filesystem or Node.js API access** inside the script (agents do the I/O; the script only orchestrates).
- Max script size: 512 KB.

## 2. Script-global API surface

### `agent(prompt, opts?) → Promise<any>`
Spawn a subagent. Options:

| opt | semantics |
|---|---|
| `label` | display label in progress UI |
| `phase` | explicit progress-group assignment (race-safe alternative to global `phase()` inside `pipeline`/`parallel` stages; same string → same group box) |
| `schema` | JSON Schema → subagent is forced to call a `StructuredOutput` tool; `agent()` returns the **validated object**; validation at tool-call layer so the model **retries on mismatch** |
| `model` | model alias override (`'sonnet'`, `'opus'`, `'haiku'`, `'fable'`); omit → inherit the session/main-loop model |
| `effort` | reasoning effort `'low'|'medium'|'high'|'xhigh'|'max'`; omit → inherit session effort |
| `isolation` | `'worktree'` → fresh git worktree per agent (~200–500 ms setup + disk); auto-removed if unchanged; for parallel file mutation |
| `agentType` | custom subagent type resolved from the same registry as the Agent tool (`.claude/agents/*.md` frontmatter: model/tools/system prompt; plugin agents too, e.g. `iso-agile-sdlc:sdlc-architect`); composes with `schema` (StructuredOutput instruction appended to the custom system prompt) |

Return semantics:
- Without `schema`: the subagent's **final text** as a string (subagents are told their final text IS the return value — raw data, not user-facing prose).
- Returns **`null`** (never rejects) when: the user skips the agent mid-run, or the subagent dies on a terminal API error after retries. Scripts defensively `.filter(Boolean)`.

### `parallel(thunks: Array<() => Promise<any>>) → Promise<any[]>`
- Concurrent execution, **barrier**: awaits all before returning.
- A thunk that throws (or whose agent errors) resolves to `null` in the result array; the call itself **never rejects**.

### `pipeline(items, ...stages) → Promise<any[]>`
- Each item flows through all stages independently, **no barrier between stages** (item A in stage 3 while item B in stage 1).
- Stage callback signature: `(prevResult, originalItem, index)`.
- A stage that throws → that item drops to `null` and its remaining stages are skipped; other items unaffected.

### `phase(title)` / `log(message)`
- `phase`: starts a progress group; subsequent `agent()` calls group under it.
- `log`: narrator line shown above the progress tree.

### `args`
- The Workflow invocation's `args` value, verbatim (undefined if absent). Real JSON values (arrays stay arrays — not stringified).

### `budget: {total, spent(), remaining()}`
- Token target for the run; pool **shared** between main loop and all workflows (in this product: per-run budget parameter **[EXT: supplied at submission instead of a user "+500k" turn directive]**).
- `total` null if unset → `remaining()` = Infinity. HARD ceiling: once `spent() ≥ total`, further `agent()` calls **throw**.

### `workflow(nameOrRef, args?) → Promise<any>`
- Run another workflow inline as a sub-step; returns its return value.
- `nameOrRef`: a **name** (resolved from the saved-workflow registry — originally `.claude/workflows/` + built-ins) or `{scriptPath}`.
- Child **shares** the parent's concurrency cap, agent counter, abort signal, and token budget; its agents appear under a `▸ name` progress group; tokens count into `budget.spent()`.
- **Nesting is one level only**: `workflow()` inside a child throws.
- Throws on unknown name / unreadable scriptPath / child syntax error (catchable).

## 3. Execution model & limits

- Runs **in the background** by default: invocation returns immediately with a run/task id; a completion notification fires when done; live progress viewable (original: `/workflows`; this product: MCP status tools + dashboard).
- Concurrency cap: `min(16, cpuCores − 2)` simultaneous agents per workflow; excess calls **queue** (all complete eventually).
- Lifetime cap: **1000 agents** per workflow run (runaway-loop backstop).
- Single `parallel()`/`pipeline()` call: max **4096 items** — exceeding is an explicit error, not silent truncation.

## 4. Persistence, resume & lifecycle

- **journal.jsonl** in the run's transcript dir records each `agent()` call's actual return value; per-agent transcripts stored as `agent-<id>.jsonl`.
- **Resume** (`resumeFromRunId`): the longest unchanged prefix of `agent()` calls — keyed by `(prompt, opts)` — returns cached results instantly; the first edited/new call and everything after runs live. Same script + same args → 100% cache hit. Prior run must be stopped before resuming.
- Determinism guards (§1) exist precisely to keep replay sound; timestamps/randomness must come in via `args`.
- Lifecycle operations: stop (original: TaskStop), resume; **[EXT: first-class `suspend` + survival across server restarts + run states queued/running/suspended/stopped/completed/failed]**.

## 5. Agent runtime environment

- Default agent = general workflow subagent; full harness capabilities: file tools, Bash, **skills, hooks, MCP tools**.
- MCP: agents reach session-connected MCP tools via **ToolSearch** (schemas load on demand per agent). Caveat inherited by this product: interactively-authenticated MCP servers may be absent headless — server-side MCP configs must be non-interactive.
- `agentType` registry: `.claude/agents/*.md` + plugin agents; frontmatter single-sources model/tools/prompt.
- Agent prompts receive only what the script passes — context flows through files/args, not shared memory.

## 6. Original limitations relevant to this product's design

| As-is behavior | This product **[EXT]** |
|---|---|
| Budget set by user's "+500k" turn directive | Budget = submission parameter on `workflow_run` |
| `user skips agent` interactive path | No interactive skip in v1 (headless); reserved in run-state model |
| Session-bound: dies with the CLI session | Durable server runs; suspend/resume/stop survive restarts (REQ-006) |
| One shared cwd (the session's project dir) | **Per-workflow work folder + per-run workspace** (REQ-013) |
| Manual invocation only | Scheduler: cron / one-shot / resident-triggered (REQ-015) |
| Registry = local `.claude/workflows/` | Server-side named-workflow registry (REQ-014) |
| Model aliases = Claude tiers only | Alias → any provider via gateway mapping (REQ-004) |

## 7. Compatibility fixtures

- **Real-world fixture**: `iso-agile-sdlc/workflows/sdlc-run.js` (641 lines) — measured usage: 17× `agent()` (16 with `schema`, 23 `agentType` refs, 11 `model:` overrides), 8× `phase()`, 5× `parallel()`, 31× `log()`, `budget.total/spent/remaining`, `args.*`, 1× `isolation`. A compat suite must at minimum parse & dry-run this script.
- Synthetic fixtures to author at Gate 5: determinism-guard violations, pipeline/parallel null semantics, `workflow()` nesting depth, schema retry, budget exhaustion, 4096-item cap, meta literal validation.
