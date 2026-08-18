---
stage: design
status: draft
---
# 04 Detailed Design

> Interfaces, data structures, flows. Each `### DES-NNN`'s traces point back to ARCH/TASK. Matching verification is unit test UT-*.
> **Panel provenance:** `.panel/gate34/adversarial.r1.md` (interface-contract / boundary-error / testability, opus-4-8)
> + `.panel/gate34/quality.r1.md` (observability / replaceability / consumability / self-sustainability, sonnet-5).
> Headlines were complementary (contract+boundary+testability seams vs cross-cutting concerns landing on
> already-chosen seams) → no round-2 rebuttal; synthesized directly.
> **Degraded-fallback disclosure:** this host exposes no Agent/Task tool, so the designer applied all lens
> groups itself sequentially (the weak substitute for real per-lens subagents) and wrote the `.panel/gate34`
> proposals directly. Safety_class=QM → no functional-safety/cybersecurity lenses (panel unchanged).
> Language: TypeScript (D9). All types are illustrative signatures the verifier can bind UTs against.

## Module boundaries (who may call whom)
- **Untrusted child (ARCH-003)** holds no secrets/store/network; its ONLY channel to the trusted parent is the
  IPC seam (DES-006). It calls nothing else directly.
- **Trusted parent**: MCP Facade (DES-001) → Run Manager/RunGuard (DES-002/003/004) → {AgentExecutor (DES-007/008),
  RunStore (DES-010), Catalog (DES-011)}. AgentExecutor → GatewayClient (DES-009). Submission Validator (DES-012)
  is called only at the two entry points. Injected seams (RunStore, GatewayClient, AgentSpawner, Clock) are
  constructor-injected interfaces (DES-002/007/009/010/014).

## Real-tier validation & per-tier mock policy — see DES-015 (binds every REQ to a runnable path).

### DES-001 — MCP tool contract + uniform result envelope
- **status:** draft
- **traces:** ARCH-001, TASK-001, TASK-002
- **signature:** every tool returns `ResultEnvelope`; `workflow_run` is async (returns `runId` immediately), caller polls `workflow_status` then fetches `workflow_result`.
- **iter:** v1

```ts
type RunStatus = 'queued'|'running'|'suspended'|'stopped'|'completed'|'failed';
interface ResultEnvelope<T = unknown> { runId: string; status: RunStatus; result?: T; error?: ErrEnvelope; }
interface ErrEnvelope { code: string; message: string; field?: string; }

interface McpFacade {
  workflow_run(a: { name?: string; script?: string; args?: unknown; budget?: number|null }): Promise<ResultEnvelope<{runId:string}>>;
  workflow_status(a: { runId: string }): Promise<ResultEnvelope<RunStatusView>>;
  workflow_result(a: { runId: string }): Promise<ResultEnvelope>;            // result = script return value
  workflow_suspend(a: { runId: string }): Promise<ResultEnvelope>;
  workflow_resume(a: { runId: string; script?: string }): Promise<ResultEnvelope>;
  workflow_stop(a: { runId: string }): Promise<ResultEnvelope>;
  workflow_list(a?: {}): Promise<ResultEnvelope<RunSummary[]>>;
  workflow_agent_log(a: { runId: string; agentId: string }): Promise<ResultEnvelope<TranscriptEvent[]>>;
}
```
Boundary/error: unknown `runId` → envelope with `error{code:'RUN_NOT_FOUND'}`, never throw across the tool boundary. Submission-time failures (DES-012) return `status:'failed'` + `error` synchronously (before a `runId` exists → `runId:''`). Bind: 127.0.0.1 default; `bind:'0.0.0.0'` opt-in only (REQ-005). No business logic here — pure delegation.

> **Gate 6 note (D-I2, IMPL-018/IMPL-019):** `workflow_result`'s `result` field is the **script's own
> return value**, not the `RunStatusView` — this was already the documented contract above but the
> initial parallel implementation mistakenly returned the `RunStatusView` from `workflow_result` too
> (and `McpFacade` built its own private `RunStore` instead of sharing the one `workflow_status`/
> `workflow_result` read from, causing `RUN_NOT_FOUND` everywhere). Both are now wired per this spec —
> see `src/mcp-facade.ts`, `src/run-manager.ts`.

> **Gate 6 note (D-I9, IMPL-027):** `workflow_list`'s `RunSummary[]` signature above undersold the
> contract — REQ-014 requires a REGISTERED-but-never-run workflow to be visible via `workflow_list`
> too, not just started runs. `result` is now a flat kind-discriminated array mixing catalog entries
> (`{kind:'workflow', name, version, createdAt}`, sourced from `WorkflowCatalog.list()`) with run
> summaries (`{kind:'run', ...RunSummary}`), so existing callers doing `list.some(w => w.runId === x)`
> and new callers doing `list.some(w => w.name === y)` both work against the same array. See
> `src/mcp-facade.ts`, `src/workflow-catalog.ts`.

> **Gate 8 route-back note (D-G8-3, IMPL-051; review finding C-1):** `server.ts`'s `tools/list`
> handler previously served `{name, description: name, inputSchema: {type:'object'}}` for every
> tool — the tool's own name repeated as its description, and an opaque schema with no
> `properties`/`required` at all, so an MCP client could not learn any tool's real parameter
> contract from `tools/list` alone (this section's own consumability rationale). Fix: a new
> `TOOL_METADATA` record gives each of the 10 tools a real, non-name-echoing description plus a
> real JSON `inputSchema.properties`/`required` mirroring exactly the argument shape
> `callTool()`/`McpFacade` already accept above (e.g. `workflow_run`:
> `name?`/`script?`/`args?`/`budget?`; `workflow_agent_log`: required `runId`+`agentId`).
> `workflow_list` (genuinely zero-parameter per this section's own `workflow_list(a?: {})`
> signature) gets `inputSchema.properties: {}` — real, not a placeholder, but correctly empty since
> it truly takes no arguments. See `src/server.ts`.

### DES-002 — RunGuard (single-authority caps + budget)
- **status:** draft
- **traces:** ARCH-002, TASK-003
- **signature:** shared object read by BOTH orchestration and the agent spawner so caps cannot drift.
- **iter:** v1

```ts
interface Budget { total: number|null; spent(): number; remaining(): number; }   // read-only view handed to VM
interface RunGuard {
  readonly concurrency: number;          // min(16, cores-2)
  acquireSlot(): Promise<() => void>;    // resolves when a slot is free; returns release fn
  nextAgentId(): string;                 // throws AgentCapError once 1000 issued this run
  addTokens(delta: number): void;        // single accounting path; feeds Budget + status
  budgetView(): Budget;                  // total/spent()/remaining(); remaining()=Infinity when total=null
  assertBudget(): void;                  // throws BudgetExceededError when spent() >= total (hard ceiling)
}
```
Boundary/error: at exactly `concurrency` in-flight, the (N+1)th `acquireSlot()` awaits (queues) and all still complete (REQ-002). `nextAgentId()` throws at the 1001st call. `assertBudget()` is checked BEFORE each `agent()` dispatch so budget-exhausted calls throw inside the script (REQ-002). `addTokens` is the ONLY writer of token totals → `budgetView().spent()` and the status API can never diverge.

> **Gate 6 round-3 route-back note (D-F8, IMPL-D-F8-1):** this server-side `RunGuard`/`Budget` was
> always the single authority and was never itself wrong — the gap (`08-validation.md` round-2/3
> finding, `state.yaml` `pending[]` item 3) was that the SEPARATE, sandbox-VM-side `Budget` object
> `agent()` scripts actually read (DES-005's `WorkflowApi.budget`, realized over the DES-006 IPC seam
> in `src/sandbox/child-entry.ts`) had its own independent `spent()/remaining()` hard-coded to
> `spent=0` always, never reading THIS `RunGuard`. Closed by piggybacking `RunGuard.budgetView().
> spent()` onto every `agentResult` IPC message (see DES-006's route-back note) — the script-visible
> view now tracks this authority live, one writer (`addTokens`), same invariant, just also mirrored
> across the process boundary. No change to this interface itself. See DES-006's note,
> `src/run-manager.ts`, `src/sandbox/child-entry.ts`.

> **Gate 8 route-back note (D-G8-6, IMPL-051; review finding V2, REQ-002):** `assertBudget()` was a
> stale PRE-DISPATCH-only check — tokens are only added post-invoke via `addTokens()` (DES-008's own
> `capture()`) — so under `parallel()`, a burst of N concurrent `agent()` calls could all read the
> same stale `spent()` (still reflecting none of their own eventual cost) and all pass the gate
> before any one of them recorded real spend, materially overshooting the hard ceiling this
> section's own boundary text promises. Fix: `RunGuard` grows `reserve(): number` (atomically
> reserves the run's ENTIRE currently-remaining budget for one about-to-dispatch call — synchronous,
> no per-call cost estimate exists ahead of time, so this is the simplest atomic gate) and
> `releaseReserved(amount)` (frees it once the call settles, regardless of its real cost — real cost
> accounting via `addTokens()` is untouched, a separate concern). `assertBudget()` now checks
> `spent() + <reserved> >= total`. `RunManager._handleAgentRequest` calls `reserve()` synchronously
> (no `await` in between) immediately after `assertBudget()`, releasing it in a `finally` around the
> rest of the call. Since only ONE call can ever hold a full-remaining-budget reservation at a time,
> the 2nd..Nth concurrent dispatch in a burst now synchronously throws `BudgetExceededError` (the
> existing hard-throw-at-ceiling contract, unchanged) instead of all reaching the gateway. No-op
> (unbounded budget) when `total===null`, matching this section's existing `remaining()=Infinity`
> convention. See `src/run-guard.ts`, `src/run-manager.ts`.

> **Gate 8 v2 review route-back note (D-V2G8-2, IMPL-064/067; review finding V4 MEDIUM — a
> regression against D-G8-6 directly above):** `reserve()` reserving the run's ENTIRE remaining
> budget for ONE call overcorrected — under `parallel([a,b,c])`, the first concurrent `agent()` call
> to reach `reserve()` monopolized 100% of whatever budget remained, so every other call in the SAME
> burst synchronously threw `BudgetExceededError` before ever reaching the gateway: concurrency
> collapsed to exactly 1, always, regardless of how much real headroom the budget had (REQ-002's
> own `parallel()` concurrency promise broken). Fix: `reserve()` now reserves
> `Math.min(remaining, this.total / 2)` — a flat half of the total budget per call, not the whole
> remainder — so a burst can push at most 2 calls' worth of reservations through before a 3rd (or
> later) hits a real `assertBudget()` check against what's genuinely left. Restores concurrency for
> the common (generously-bounded) case (IT-037) while the hard ceiling still holds once a budget is
> tight for real (IT-030's near-exhausted regression guard, re-verified green). See
> `src/run-guard.ts`.

### DES-003 — Run state machine + suspend/resume/stop lifecycle
- **status:** draft
- **traces:** ARCH-002, TASK-004
- **signature:** legal transitions only; every transition persisted via RunRecorder before it is observable.
- **iter:** v1

```ts
// legal edges: queued→running; running→{suspended,stopped,completed,failed};
//              suspended→{running(resume),stopped}; stopped→running(resume w/ cached prefix)
interface RunManager {
  start(spec: RunSpec): Promise<string>;                 // returns runId, runs async
  suspend(runId: string): Promise<void>;                 // stop in-flight agents, persist, → suspended
  resume(runId: string, script?: string): Promise<void>; // replay cache (DES-004) then run live
  stop(runId: string): Promise<void>;                    // terminate sandbox child, → stopped
  status(runId: string): Promise<RunStatusView>;
}
```
Boundary/error: illegal transition (e.g. resume a `running` run) → `IllegalTransitionError` surfaced as envelope error. On process crash, a `running` run re-hydrates as `failed` (not silently `running`) but its journal prefix stays resumable; a `suspended` run re-hydrates resumable (REQ-006, restart survival). Suspend must actually abort in-flight SDK sessions (AbortSignal through AgentExecutor), not just flip the flag.

### DES-004 — Resume cache / replay contract
- **status:** draft
- **traces:** ARCH-002, TASK-005
- **signature:** longest-unchanged prefix of `agent()` calls keyed by `(prompt, opts)` replays from journal instantly.
- **iter:** v1

```ts
interface ResumePlan { cachedThrough: number; replay(callSeq: number, key: CallKey): unknown|MISS; }
type CallKey = { prompt: string; opts: AgentOpts };   // structural equality → cache hit
```
Boundary/error: same script + same args → 100% cache hit (every `agent()` returns cached, zero model calls). First edited/new `(prompt,opts)` and everything after runs live. Prior run must be `stopped`/`suspended` before resume (else `IllegalTransitionError`). `workflow_resume` with an edited script re-runs only from the first changed call (REQ-006 cached-prefix). Determinism guards (DES-005) exist precisely so replay is sound.

> **Gate 6 route-back note (D-F13, IMPL-048; REQ-006):** Gate 7.5 round 5 found that an
> ABORTED-mid-flight `agent()` call (workflow_suspend/workflow_stop cutting it short) journals
> `{value:null}` INDISTINGUISHABLE from a genuinely-completed terminal-provider-error null (DES-009's
> own legitimate `{ok:false}` outcome) — `ResumeCache.replay()` (correctly, per its documented "same
> script+args -> 100% cache hit" contract) then replays that aborted null as if it were a completed
> call, so `workflow_resume` never re-runs it live (violates this section's own "same final result as
> an uninterrupted run" promise). Fix: `JournalEntry` (DES-010) grows `aborted?: boolean` — true only
> when `AgentExecutor.run()`'s outcome was `{kind:'null', aborted:true}` (the signal fired before or
> during the gateway call), never for a genuine `{kind:'null'}` terminal/schema-exhaustion outcome.
> `Plan.replay()` now treats an `aborted` entry as a cache MISS (`this._missed = true; return MISS`)
> exactly like a missing/changed-key entry — the same "everything from the first miss onward runs
> live" contract this section already documents, just triggered by a different condition. See
> `src/resume-cache.ts`, `src/agent-executor.ts`, `src/run-manager.ts`, `src/types.ts`.

> **Gate 8 route-back note (D-G8-1, IMPL-051; review finding V3, REQ-006/ARCH-002/ARCH-006):** a
> nested `workflow()` call spawns a NEW `SandboxHost`/child process for the nested script, and that
> child has its OWN independent `callSeq` counter (`child-entry.ts`'s own `nextCallSeq`) starting at
> 0 again — but `RunManager._handleWorkflowRequest` forwarded the nested child's
> `agent()` calls into the SAME `_handleAgentRequest` (and so the same shared per-run journal /
> `ResumePlan`'s `Map<callSeq, JournalEntry>`) as the outer script's own `callSeq` values, without
> any namespacing. The outer script's own `callSeq` 0 and the nested script's own `callSeq` 0
> silently collided (last-write-wins in the `Map`), corrupting this section's own "longest-
> unchanged-prefix" replay contract for the WHOLE run (once any `callSeq` misses, `Plan.replay()`
> makes every later `callSeq` miss too — this section's own documented behavior), not just the
> nested call. Fix: `RunManager` gains `_nestedCallSeq(parentCallSeq, nestedCallSeq) =
> (parentCallSeq+1) * 1_000_000 + nestedCallSeq` — the nested child's own raw `callSeq` is namespaced
> into a numeric range keyed off the PARENT's own `callSeq` for the `workflow()` call that spawned
> it (itself unique in the parent's own `callSeq` space, and — critically — deterministic across an
> original run and a resume of the same unmodified script, since the same `workflow()` call gets the
> same parent-level `callSeq` both times). `SandboxHost.onWorkflowRequest`'s existing 3rd `callSeq`
> parameter (already threaded by `host.ts`, previously unused by `_handleWorkflowRequest`) supplies
> `parentCallSeq`. See `src/run-manager.ts`.

### DES-005 — Sandbox VM bindings (workflow API surface) + guards
- **status:** draft
- **traces:** ARCH-003, TASK-006, TASK-007
- **signature:** restricted VM context exposes EXACTLY the compat-spec §2 surface and nothing else.
- **iter:** v1

```ts
interface WorkflowApi {                       // the only globals visible inside the sandboxed script
  agent(prompt: string, opts?: AgentOpts): Promise<unknown|null>;
  parallel(thunks: Array<() => Promise<unknown>>): Promise<Array<unknown|null>>;
  pipeline(items: unknown[], ...stages: Stage[]): Promise<Array<unknown|null>>;
  phase(title: string): void;
  log(message: string): void;
  readonly args: unknown;                     // verbatim JSON, undefined if absent
  readonly budget: Budget;                    // read-only view (DES-002); no setter exposed
  workflow(nameOrRef: string|{scriptPath:string}, args?: unknown): Promise<unknown>;
}
type AgentOpts = { label?: string; phase?: string; schema?: object; model?: string;
                   effort?: 'low'|'medium'|'high'|'xhigh'|'max'; isolation?: 'worktree'; agentType?: string };
type Stage = (prev: unknown, item: unknown, index: number) => Promise<unknown>;
```
Boundary/error (all throw INSIDE the script, catchable/reported): `Date.now()`, `Math.random()`, argless `new Date()` (determinism guard); >4096 items in one `parallel`/`pipeline` call; second-level `workflow()` nesting; script >512 KB; TS syntax (type annotations/generics fail to parse — must match original JS-not-TS); non-literal `meta` (variables/calls/spreads/interpolation rejected). No `fs`/`require`/`process`/network reachable in-context. `budget` is frozen getters — mutation attempts throw.

### DES-006 — IPC seam message protocol (child ↔ parent)
- **status:** draft
- **traces:** ARCH-003, TASK-008
- **signature:** tagged discriminated union over the child process channel; every request correlated by `(runId, callSeq)`.
- **iter:** v1

```ts
// child → parent (untrusted asks trusted to do the privileged thing)
type ChildMsg =
  | { t: 'agent';    runId: string; callSeq: number; prompt: string; opts: AgentOpts }
  | { t: 'workflow'; runId: string; callSeq: number; ref: string|{scriptPath:string}; args: unknown }
  | { t: 'phase';    runId: string; title: string }
  | { t: 'log';      runId: string; message: string }
  | { t: 'done';     runId: string; result: unknown }        // script return value
  | { t: 'error';    runId: string; error: { message: string; stack?: string } };
// parent → child
type ParentMsg =
  | { t: 'agentResult';    callSeq: number; value: unknown|null }   // null carries the null-semantics contract
  | { t: 'workflowResult'; callSeq: number; value: unknown }
  | { t: 'agentThrow';     callSeq: number; error: { code: string; message: string } } // budget/nesting/unknown-name
  | { t: 'abort';          reason: 'suspend'|'stop' }
  | { t: 'init';           args: unknown; budget: { total: number|null } };
```
Boundary/error: the master test seam — stubbing the parent side lets a UT dry-run `sdlc-run.js` (641 lines) with ZERO model calls. `agentThrow` maps to a thrown error inside the VM (budget ceiling, unknown `workflow(name)`, second-level nesting); `agentResult{value:null}` maps to the null return. Unknown `callSeq` correlation → protocol error (fail loud, never hang).

> **Gate 6 round-3 route-back note (D-F8, IMPL-D-F8-1):** `ParentMsg`'s `'agentResult'` variant
> grows an optional `spent?: number` — the real cumulative `RunGuard` token total as of that call's
> completion, piggybacked onto the SAME message (no new message type; the child already receives one
> `agentResult` per `agent()` call, and budget only ever changes as a side effect of one). `SandboxHost`
> (`src/sandbox/host.ts`) grows an optional `onBudgetSnapshot?: () => number` config hook, called when
> sending `agentResult`; `RunManager` wires it to `entry.guard.budgetView().spent()`
> (`src/run-manager.ts`). The child (`src/sandbox/child-entry.ts`) tracks a local `spentSoFar`
> updated from each `agentResult.spent`; the script-visible `budget.spent()/remaining()` accessors
> now read `spentSoFar` instead of a hard-coded stub (`remaining()` still derives from the
> `StartMsg.budgetTotal` captured at spawn — total itself never changes mid-run). Omitting
> `onBudgetSnapshot` (e.g. existing dry-run test seams) → no `spent` field sent, `spentSoFar` stays
> at its initial `0`, unchanged prior behavior. See `src/ipc/protocol.ts`, `src/sandbox/host.ts`,
> `src/sandbox/child-entry.ts`, `src/run-manager.ts`.

### DES-007 — Agent Executor / AgentSpawner contract
- **status:** draft
- **traces:** ARCH-004, TASK-009
- **signature:** one Claude Agent SDK headless session per `agent()`; schema→StructuredOutput retry; terminal failure → null.
- **iter:** v1

```ts
interface AgentSpawner {                                   // injected seam; fake for dry-runs
  run(req: AgentReq): Promise<AgentOutcome>;
}
interface AgentReq { runId: string; agentId: string; prompt: string; opts: AgentOpts;
                     workspace: string; signal: AbortSignal; }
type AgentOutcome =
  | { kind: 'text';   value: string }                      // no schema → final text string
  | { kind: 'object'; value: object }                      // schema → validated object (retry-on-mismatch)
  | { kind: 'null' }                                       // terminal API error after retries → agent() resolves null
```
Boundary/error: `schema` present → subagent forced to call StructuredOutput; validation at tool-call layer → model retries on mismatch; after retry budget exhausted with still-invalid → `kind:'null'` (never reject). Unknown `agentType` → reported error (not hang) surfaced at submission (DES-012) or as `agentThrow`. `agentType` resolves system-prompt/tools from the server-side registry; composes with `schema`. Runs PARENT-side so the untrusted script never touches the SDK or keys.

> **Gate 6 route-back note (D-V4/D-V5, IMPL-029):** `schema` validation is real Ajv (`ajv` dep,
> JSON-Schema draft-07-ish subset, `strict:false`) — `ajv.compile(opts.schema)` then up to
> `SCHEMA_RETRY_ATTEMPTS = 3` attempts total (never infinite), never a bare `as object` cast.
> `AgentExecutorDeps` grew an additive `agentTypes?: Record<string, {systemPrompt: string}>` seam
> (a server-side agent-definition registry, resolved by name before any gateway dispatch — unknown
> name throws before dispatch, known name's `systemPrompt` is prepended to the outbound prompt).
> Composition-root note: no caller (`server.ts`/`run-manager.ts`) currently populates `agentTypes`
> from an actual on-disk registry (e.g. `.claude/agents/*.md` per the compat-spec) — every
> `agentType` is "unknown" (fails fast, per spec) until that loader is built; no test in this route
> back drives that loader, so it was deliberately left unbuilt rather than speculatively implemented
> (see IMPL-029 needs_clarification). See `src/agent-executor.ts`.

> **Gate 6 final route-back note (D-F2, IMPL-036):** the loader is now built —
> `src/agent-definitions.ts`'s `loadAgentDefinitions(dir)` reads every `agents/*.md` file directly
> under `dir`, splits its `---\n...\n---\n` frontmatter (flat `key: value` lines; `name`/`model`
> read, `tools` parsed-but-unused — no seam restricts tools per agentType yet, so it is
> intentionally not stored) from its body (the `systemPrompt`), and returns a
> `Record<string, AgentTypeDef>`. `AgentTypeDef` grew an optional `model?: string` (an alias name,
> resolved the same way `opts.model` already is): `AgentExecutor.run()` now also applies a resolved
> definition's `model` to the outbound `opts.model` when the caller didn't already set one (in
> addition to the existing systemPrompt-prepend behavior). `ServerConfig.agentDefinitionsDir`
> (new) triggers the load once at `createServer()` startup and forwards the registry through
> `RunManagerDeps.agentTypes` into every `AgentExecutor` this manager constructs (both the
> `start()` and rehydrate-on-restart `_requireLive()` construction sites). Omitted
> `agentDefinitionsDir` → empty registry, unchanged prior behavior (every `agentType` "unknown").
> Proven end-to-end by IT-016 (real `createServer()` + a real on-disk frontmatter file + a real
> local Ollama-shaped stub — only the third-party LLM network is faked). See
> `src/agent-definitions.ts`, `src/agent-executor.ts`, `src/run-manager.ts`, `src/server.ts`.

> **Gate 6 route-back note (D-F11, IMPL-048; REQ-003):** Gate 7.5 round 5's central tool-use finding
> (agent()'s tool-use loop never actually fires against a real local model through the SDK-default
> gateway, root-caused to the CLI's own full uncurated tool surface — dozens of tools — overwhelming
> a 7B model's tool-selection ability) is fixed at the curation half here: `AgentTypeDef` (this
> section's own interface) grows `tools?: string[]` — the frontmatter `tools:` list
> `agent-definitions.ts` already parsed but, per this section's own prior note, deliberately left
> unstored ("no seam restricts tools per agentType yet") now IS stored and applied.
> `AgentExecutor.run()`'s existing agentType-resolution block (the one that already applies
> `def.systemPrompt`/`def.model`) now ALSO applies `def.tools` to the outbound `opts.allowedTools`
> the same way it applies `model` — only when the caller didn't already set an `allowedTools` of
> their own (an explicit per-call value always wins, same precedence `model` already follows).
> `AgentOutcome`'s `{kind:'null'}` variant also grows an optional `aborted?: boolean` this round
> (D-F13's own need, documented under DES-004/DES-010) — set when `req.signal` was already aborted,
> or the internal abort-vs-invoke race resolved as aborted; a genuine terminal gateway failure or
> exhausted schema-retry still returns `{kind:'null'}` with `aborted` absent. See
> `src/agent-executor.ts`, `src/agent-definitions.ts` — the gateway-side half of D-F11 (curating
> `options.allowedTools`/`options.tools` on the actual SDK session) is documented under DES-009.

### DES-008 — AgentTranscriptSink + token accounting
- **status:** draft
- **traces:** ARCH-004, TASK-010
- **signature:** single capture path taps the SDK event stream → `agent-<id>.jsonl`; token deltas → RunGuard.addTokens.
- **iter:** v1

```ts
interface TranscriptEvent { ts: string; kind: 'message'|'tool_call'|'tool_result'|'usage'; data: unknown; }
interface AgentRecord {
  agentId: string; label?: string; phase?: string;
  state: 'queued'|'running'|'done'|'failed';
  provider: string; model: string;                         // REAL provider + real model id actually used
  tokens: { input: number; output: number };
}
```
Boundary/error: ONE sink feeds `workflow_agent_log`, the dashboard (v2), and the resume cache — not three paths (observability). Every `usage` event calls `RunGuard.addTokens(delta)` so the `budget` view and the status API share one number. Local-Ollama routing must show `provider:'ollama'` in the record and NO paid-provider call in the gateway log (REQ-004 verifiability).

> **Gate 6 route-back note (D-V6, IMPL-029):** `RunStore` grew a real `getTranscript(runId, agentId):
> Promise<TranscriptEvent[]>` read-back accessor (`InMemoryRunStore` reads its in-memory map;
> `SqliteRunStore` reads `agent-<id>.jsonl` line-by-line, `[]` if the file never materialized) —
> `McpFacade.workflow_agent_log` now delegates to it instead of a hard-coded `[]`. See
> `src/run-store.ts`, `src/store/sqlite-run-store.ts`, `src/mcp-facade.ts`.

> **Gate 6 route-back note (D-F12, IMPL-048; REQ-007/REQ-002):** Gate 7.5 round 5 found
> `AgentRecord.state` (this section's own `'queued'|'running'|'done'|'failed'` type) never actually
> produced `'queued'`/`'running'` — `AgentTranscriptSink.capture()` only ever created a record at
> call-RESOLUTION time, so an in-flight or concurrency-queued agent was invisible in
> `workflow_status` (`agents:[]` while the run itself showed `status:'running'`). Fix: the sink grows
> two additive methods — `markQueued(agentId, label?, phase?)` (records `state:'queued'`,
> `provider:''`/`model:''`/`tokens:{0,0}` placeholders) and `markRunning(agentId)` (flips an existing
> record's `state` to `'running'`, preserving `label`/`phase`) — both exposed on `AgentExecutor`
> itself (delegating to its private sink) alongside the existing `getRecord`/`getAllRecords`.
> `RunManager._handleAgentRequest` (DES-003) now allocates the agentId via `RunGuard.nextAgentId()`
> and calls `markQueued` BEFORE `await guard.acquireSlot()` (so a call genuinely blocked behind the
> concurrency cap is observable immediately, not only once it dispatches), then calls `markRunning`
> right after the slot is acquired and before dispatching to the spawner. `capture()` (unchanged)
> still overwrites the record with the real terminal `'done'`/`'failed'` state once the call
> resolves. See `src/agent-executor.ts`, `src/run-manager.ts`.

> **Gate 8 route-back note (D-G8-2, IMPL-051; review finding O-1, ARCH-004, REQ-007):** this
> section's own signature promises "single capture path taps the SDK event stream" — but
> `AgentTranscriptSink.capture()` only ever emitted a single terminal `kind:'usage'` event per call;
> separately, `ClaudeAgentSdkGatewayClient._drain` explicitly discarded every real SDK message except
> the final `type:'result'` one (`if (msg.type !== 'result') continue`). Net effect:
> `workflow_agent_log` could only ever show one summary token-count line per `agent()` call, never
> the real reasoning/tool-call trace this section's own `TranscriptEvent.kind` type
> (`'message'|'tool_call'|'tool_result'|'usage'`) already declared it should. Fix: `GatewayResult`'s
> `ok:true` variant (DES-009) grows optional `events?: TranscriptEvent[]`. `_drain` now accumulates
> a `TranscriptEvent` for every non-`result` SDK message's own `message.content` items
> (`type:'text'`->`kind:'message'`, `type:'tool_use'`->`kind:'tool_call'`,
> `type:'tool_result'`->`kind:'tool_result'`) instead of discarding them, returning them on the
> final `GatewayResult`. `capture()` now emits each of `result.events` (in order) BEFORE the terminal
> `usage` event — a real reasoning/tool-call trace now reaches `workflow_agent_log`.
> `LiteLLMGatewayClient` (no SDK message stream to tap) leaves `events` unset — unchanged single-
> `usage`-event legacy behavior for that path. See `src/gateway/client.ts`,
> `src/gateway/claude-agent-sdk-client.ts`, `src/agent-executor.ts`.

### DES-009 — GatewayClient interface + provider-down breaker + null semantics
- **status:** draft
- **traces:** ARCH-005, TASK-011, TASK-012
- **signature:** narrow `invoke(prompt,opts)` over LiteLLM; bounded timeout→retry→null; sole key custody (parent-only).
- **iter:** v1

```ts
interface GatewayClient {                                   // injected seam; one impl = LiteLLMGatewayClient
  invoke(req: { prompt: string; opts: AgentOpts; runId: string; agentId: string }): Promise<GatewayResult>;
}
type GatewayResult =
  | { ok: true;  provider: string; model: string; tokens: { input: number; output: number }; content: unknown }
  | { ok: false; provider: string; reason: 'timeout'|'unreachable'|'terminal' };   // → agent() resolves null
interface AliasMap { [alias: string]: { provider: 'anthropic'|'openai'|'gemini'|'ollama'; model: string }; }
```
Boundary/error (D-G, user-confirmed v1): unreachable/hung provider → bounded `timeoutMs` (config, sane default) → `retries` (config) → `{ok:false}` → `agent()` resolves `null`, run continues, never hangs; the failure is visible in the AgentRecord. Every call correlation-tagged `(runId,agentId)` so the LiteLLM log joins back to the store. `default` alias used when `opts.model` omitted; unmapped alias → caught at submission (DES-012), never mid-run. API keys live ONLY here (parent).

> **Gate 6 route-back note (D-V1/D-R1, IMPL-029):** `GatewayConfig` grew `useLiteLLMProxy?: boolean`
> (default `true` from `server.ts`'s composition root as of this route-back — D-R1; explicit
> `false` opts back into the pre-existing direct-per-provider-`fetch` path) and an injectable
> `proxyManager?: LiteLLMProxyManager` seam (tests fake its `spawnImpl`/`fetchImpl`, never a real
> `litellm` binary — D-R2/DES-015). `LiteLLMProxyManager` (`src/gateway/litellm-proxy.ts`) owns one
> `litellm --config ... --port ...` subprocess: config.yaml generated straight from the existing
> `AliasMap` (one source of truth), bounded-timeout health poll (never hangs), idempotent `start()`.
> When the proxy path is active, `invoke()` calls the proxy's Anthropic-Messages-shaped
> `POST /v1/messages` (alias name as `model`) instead of each provider's native endpoint directly —
> this is a direct HTTP call shaped to match what a real `@anthropic-ai/claude-agent-sdk` headless
> session pointed at `ANTHROPIC_BASE_URL=<proxy>` would send, not an actual SDK session construction
> (`@anthropic-ai/claude-agent-sdk` is an added-but-currently-unused dependency — no test in this
> route back drives real SDK session objects; see IMPL-029 needs_clarification for the open question
> of whether that full swap is required for v1 sign-off). Manually smoke-tested end-to-end against a
> real spawned `litellm` + real local Ollama (see IMPL-litellm-proxy-manager); no automated test
> spawns the real binary (D-R3: Python 3.11/3.12 runtime requirement, documented in DEPLOY.md).
> IT-005 (`gateway-provider-down.test.ts`) retimed to inject `fetchImpl`+fake `proxyManager` so its
> breaker-semantics assertions are deterministic, not dependent on Python cold-start. See
> `src/gateway/client.ts`, `src/gateway/litellm-proxy.ts`, `src/server.ts`.

> **Gate 6 final route-back note (D-F1, IMPL-036/037):** user decision D1 stands (twice confirmed)
> — the direct-fetch-to-proxy shape above does NOT satisfy "genuine SDK sessions" (a raw fetch has
> no tool-use agent loop); the accept-direct-fetch alternative was explicitly REJECTED. New
> `ClaudeAgentSdkGatewayClient` (`src/gateway/claude-agent-sdk-client.ts`) implements `GatewayClient`
> against the REAL `@anthropic-ai/claude-agent-sdk` `query()` export: with no `queryImpl` override
> the default IS the real SDK export (UT-018, `vi.mock`s only the third-party module — unit tier);
> wires `ANTHROPIC_BASE_URL` to the given `baseUrl` (e.g. the already-built `LiteLLMProxyManager`'s
> proxy) and a dummy, non-empty, never-real `ANTHROPIC_API_KEY` (D-R2); reads the session's own
> `result` message (`subtype:'success'` → `{ok:true, content: msg.result, tokens: msg.usage.*}`,
> anything else or a thrown/aborted iteration → `{ok:false}`, never a hang, never a rejection).
> `queryImpl` stays injectable. `IT-015` is the real-subprocess companion (real SDK pointed at a
> LOCAL stub `/v1/messages` server, including one genuine tool-use turn) — in THIS environment it is
> RED for a documented, pre-anticipated reason (see `05-tests.md`'s IT-015 note + journal.md, and
> IMPL-037's test_defect report to the verifier): this sandboxed dev environment is *itself* a
> nested Claude Code agent host, and `query()` here is intercepted by that outer host with a live
> synthetic response (confirmed via a throwaway debug script: the intercepted request bodies carry
> the OUTER project's own system prompts/agent-type list and a live model id, never our stub's SSE
> bytes) rather than genuinely spawning an independent CLI subprocess against `ANTHROPIC_BASE_URL` —
> the test's own skip-guard anticipates exactly this failure mode in prose but its literal condition
> (`stub.requests.length > 0` within 20s) doesn't catch it, because the intercepted calls do still
> reach the local port with a wrong-shaped body. Not a defect in `ClaudeAgentSdkGatewayClient` itself
> — UT-018 fully pins its logic. Composition-root wiring: an additive `ServerConfig.gateway?:
> GatewayClient` override seam was added to `createServer()` (no existing caller sets it, zero
> regression) so this class CAN be selected explicitly; it was deliberately NOT wired as the
> zero-config default for `RunManager`/`server.ts`'s existing `aliases`-absent or
> `useLiteLLMProxy:true` construction paths, because ~20 existing green tests (`val-002`, `val-006`,
> `e2e/suspend-resume-replay`, etc. — see their own "fast local no-credential agent() rejection path"
> comments) depend on that path's near-instant no-credential terminal-fail behavior, and IT-005/
> IT-013 pin the raw-fetch transport shape for the `useLiteLLMProxy:true` path specifically; no test
> in this round forces re-wiring either of those paths, and doing so untested risked exactly the kind
> of speculative, unverified production behavior Gate 6 discipline warns against. Flagged to the
> orchestrator as needs_clarification (see 06-impl-log.md IMPL-037) rather than silently wired. See
> `src/gateway/claude-agent-sdk-client.ts`, `src/server.ts`.

> **Gate 6 round-3 route-back note (D-F6/D-F7/D-F9a, IMPL-SLICE-DF6-DF7-DF9a-1/2/3):** three
> additive changes finalize what UT-020/UT-021/IT-019 pinned as red (verifier-authored design
> extensions not yet written up here, per those tests' own notes):
> (1) **D-F9a — signal threading.** `GatewayClient.invoke(req)`'s `req` grows an optional
> `signal?: AbortSignal` (`src/gateway/client.ts`); `AgentExecutor`'s `_invokeOnce` forwards its own
> `req.signal` (already required on `AgentReq` per DES-007) straight through
> (`src/agent-executor.ts`). `RunManager` needed no change — `entry.abortController.signal` was
> already threaded into `AgentExecutor.run()`'s call (predates this round). Scope is deliberately
> narrow: only `ClaudeAgentSdkGatewayClient` honors the incoming `signal` this round (D-F7's bounded
> race is explicitly scoped to it too) — `LiteLLMGatewayClient`'s `callProvider`/`callViaLiteLLMProxy`
> do NOT yet tie their own `AbortController` to this external signal; that remains `state.yaml`
> `pending[]` item (4), unchanged, out of this round's binding text.
> (2) **D-F6 — alias-aware thinking policy.** `ClaudeAgentSdkGatewayConfig` grows `aliases?:
> AliasMap` (same shape `LiteLLMGatewayClient` already takes). `invoke()` sets `options.thinking =
> {type:'disabled'}` for any alias not confirmed `provider:'anthropic'` (including an
> alias absent from the map — the safe default), and leaves `options.thinking` unset (SDK default)
> only for a confirmed Anthropic-mapped alias.
> (3) **D-F7 — bounded race.** `ClaudeAgentSdkGatewayConfig` grows `timeoutMs?: number` /
> `retries?: number` (mirroring `GatewayConfig`). When `timeoutMs` is set, `invoke()` makes
> `1 + retries` attempts, each racing the session drain against an `AbortController`-driven timer
> (`Promise.race`) exactly like `LiteLLMGatewayClient`'s per-attempt race — first success wins,
> exhausting all attempts without one returns the last `{ok:false}`. The same `AbortController` also
> answers the external `req.signal` (D-F9a) via a `once` listener, so either the timeout or an
> external abort resolves the race; both listeners are cleaned up in a `finally`. When neither
> `timeoutMs` nor `req.signal` is set, `invoke()` is unchanged legacy (unbounded single attempt).
> See `src/gateway/client.ts`, `src/agent-executor.ts`, `src/gateway/claude-agent-sdk-client.ts`.

> **Gate 6 round-4 route-back note (D-F10, gap-tests-7, IT-021/IT-022/UT-022/UT-023):** Gate 7.5
> round 4 found the 3 fixes above (D-F6/D-F7/D-F9a) were all real at the class level but DEAD in
> production because `src/main.ts` (the real product entrypoint) never constructed
> `ClaudeAgentSdkGatewayClient` with `aliases`/`timeoutMs`/`retries`, and never read/forwarded
> `agentDefinitionsDir` at all -- no existing test constructed the server the way `main.ts` itself
> does, so this whole class of composition-root wiring gap was invisible below the 45-minute
> real-run validation tier. Fix, ORCH D-F10 STRUCTURAL RULE: `src/main.ts`'s inline
> `FileConfig -> ServerConfig` translation is now an exported, independently testable helper --
> `export async function composeConfig(fileConfig: FileConfig, deps?: { queryImpl?, proxyManager? }):
> Promise<ServerConfig>` -- with `main()` itself reduced to `composeConfig(loadFileConfig())` +
> `createServer()`. `composeConfig()` forwards `aliases`/`timeoutMs`/`retries` into the constructed
> `ClaudeAgentSdkGatewayClient` (`gateway:'sdk'`, the default) and forwards `agentDefinitionsDir`
> into the returned `ServerConfig` regardless of gateway choice (`gateway:'direct-fetch'` leaves
> `config.gateway` unset so `createServer()`'s own `aliases`-driven `LiteLLMGatewayClient`
> construction applies, unchanged). `src/main.ts` also gained an import-guard
> (`fileURLToPath(import.meta.url) === process.argv[1]`) so `main()`'s side-effecting boot only runs
> when the file is the real process entry point, not merely imported to reach `composeConfig` --
> a necessary companion, since re-running the whole program on every import would make the export
> pointless. `IT-021`/`IT-022` (`tests/integration/main-composition-root(-agent-types).test.ts`)
> are the STRUCTURAL-RULE tests themselves: they boot via `import('../../src/main.js')` +
> `composeConfig()`, not a hand-built `ServerConfig`, closing the exact blind spot Gate 7.5 round 4
> identified.
>
> Also closes the `state.yaml pending[]` item (4) noted in the round-3 note above:
> `LiteLLMGatewayClient.invoke(req)`'s parameter type now includes `signal?: AbortSignal` and both
> `callProvider`/`callViaLiteLLMProxy` listen for its `abort` event to abort their own per-attempt
> `AbortController` (`UT-023`) -- the `"direct-fetch"` path is no longer excluded from D-F9a's signal
> threading. `ClaudeAgentSdkGatewayClient._invokeOnce`'s local `AbortController` (built whenever
> `timeoutMs` or `req.signal` is set) is now additionally assigned to the real SDK cancellation hook
> `Options.abortController` (`sdk.d.ts:1275`) BEFORE `query()` is called, not only raced against
> locally (`UT-022`) -- this is a genuine new capability (Gate 7.5 round 4's real repro showed the
> spawned `claude` CLI subprocess kept running past an unsuspended local race), verified so far only
> at unit tier (`vi.mock`s the SDK module); real-subprocess-kill confirmation against a live `claude`
> CLI remains Gate 7.5's job, same boundary as `IT-015`'s own documented environment caveat.
> `rwe.config.example.json` gained the `agentDefinitionsDir` key + a shipped example `agents/`
> directory (`researcher.md`/`writer.md`, same frontmatter shape `agent-definitions.ts` already
> parses and `IT-016`/`IT-022` already exercise) closing the config-drift half of the gap. See
> `src/main.ts`, `src/gateway/client.ts`, `src/gateway/claude-agent-sdk-client.ts`,
> `rwe.config.example.json`, `agents/`.

> **Gate 6 route-back note (D-F11, IMPL-048; REQ-003, ORCH ruling on Gate 7.5 round 5's tool-use
> defect):** the DES-007 note above threads a curated tool list as far as `opts.allowedTools`; this
> note is the gateway-side half that makes it real on the wire. `ClaudeAgentSdkGatewayConfig` grows
> `defaultAllowedTools?: string[]` (a configurable server-wide default core set, forwarded from
> `rwe.config.json`'s new `defaultAllowedTools` key via `main.ts`'s `composeConfig()` — same
> forwarding convention as `aliases`/`timeoutMs`/`retries`). `invoke()` resolves a `curatedTools`
> list once per call: the caller's (agentType-derived) `opts.allowedTools` when given, else
> `defaultAllowedTools`, else a built-in minimal core set (`['Read','Write','Bash']`) — NEVER left
> unset. A direct real-CLI repro (IT-023) proved `options.allowedTools` ALONE does not narrow the
> outbound wire tool surface at all — the SDK's own doc (`sdk.d.ts:1323`) confirms it only
> auto-approves listed tools without prompting; `options.tools` (`sdk.d.ts:~1370`) is what actually
> restricts the model's available BUILT-IN tools. The same repro also showed the CLI additionally
> inherits this HOST machine's own project/user Claude Code settings (MCP plugin tool definitions —
> e.g. Playwright/Cloudflare tools present in this dev sandbox — entirely unrelated to this product)
> regardless of `tools`; `settingSources: []` (SDK isolation mode: skip loading any filesystem
> settings) + `strictMcpConfig: true` (restrict MCP servers to only what `mcpServers` explicitly
> passes — none here) eliminates that leakage too. `invoke()` now sets `allowedTools`, `tools` (both
> to `curatedTools`), `settingSources: []`, and `strictMcpConfig: true` on every call — proven by
> IT-023 (real CLI subprocess + local stub capturing the actual outbound request body) that the wire
> tool surface is deterministically exactly the curated set, independent of whatever Claude Code
> configuration happens to exist on the host machine running this product. See
> `src/gateway/claude-agent-sdk-client.ts`, `src/main.ts`, `rwe.config.example.json`.

> **Gate 8 v2 review route-back note (D-V2G8-1(a)(b)(c)(d), IMPL-064/067; review finding V3 HIGH):**
> the D-F11 tool-curation note directly above closed the "which tools are on the wire" half of the
> tool-use defect but left the PERMISSION half wide open: `options.permissionMode` was hard-coded
> `'bypassPermissions'` (skips every tool-call decision outright, headless-safe but with zero
> arbitration) paired with a default tool set that (pre-this-note) still included `'Bash'` and no
> path-argument check at all — together these let any `agent()` prompt drive a fully-privileged
> shell, or a Read/Write call reach any path on the host (the LiteLLM proxy's own `config.yaml`, a
> sibling run's workspace/journal — both literally reachable via `../` from a run's own `cwd` since
> `RunManager`'s default `workRoot` places every run's workspace as a sibling directory), closing
> neither the key-exfiltration nor the cross-run-read path this finding named. Fix, four parts:
> **(a)** `permissionMode` is now `'default'`, not `'bypassPermissions'` — headless behavior is
> preserved because the callback in (d) below always resolves synchronously, never `null`/pending.
> **(b)** `BUILT_IN_CORE_TOOLS` drops `'Bash'` (now `['Read','Write']`) — a privileged shell is now
> an explicit `agentType`/`opts.allowedTools`/`defaultAllowedTools` opt-in, never silently default.
> **(c)** `LiteLLMProxyManager._doStart()`'s subprocess spawn grows an explicit `env: {
> ...process.env }` — the ONE place real provider keys need to live, now a real, testable custody
> statement instead of an implicit Node default; the agent-facing CLI subprocess's own
> `buildSubprocessEnv` allowlist (D-G8-5) is untouched — the "proxy yes, agent no" split holds.
> **(d)** a new `isInsideWorkspace(candidate, root)` (`path.resolve` + `root + path.sep`-prefix
> check, so a sibling dir sharing a string prefix is never wrongly treated as "inside") backs a
> shared `toolUsePreCheck(root, candidate)` decision, wired into `options.canUseTool` (inspects a
> tool call's own path argument — `input.file_path` for Read/Write, `options.blockedPath` for a Bash
> escape — against `req.workspace ?? this._config.cwd`) **and** into an `options.hooks.PreToolUse`
> matcher. Both are wired, not just `canUseTool` alone, because real-SDK verification (not just the
> mocked unit tests) surfaced a genuine shadowing gap: the SDK's own
> `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` runtime warning documents that a BARE `allowedTools` entry
> (e.g. the default `'Read'`) auto-approves that tool call before `canUseTool` is ever consulted —
> and (b)'s D-F11-mandated non-empty bare `allowedTools` default means the built-in Read/Write case
> hits exactly that shadow. `hooks.PreToolUse` (the SDK's own suggested mechanism for this exact
> case) fires for every tool call regardless of that shadow, so the workspace boundary holds either
> way — confirmed end-to-end against a real `@anthropic-ai/claude-agent-sdk` session (not just the
> mocked `UT-039/040/041` unit tests): a genuine out-of-workspace `Read` (`/etc/hostname`) is denied
> with `path outside run workspace: ...`; a genuine in-workspace `Read` still succeeds. No workspace
> root known at all (neither `req.workspace` nor a configured `cwd`) -> nothing to enforce against,
> allow (unchanged legacy behavior for direct unit-tier calls). See
> `src/gateway/claude-agent-sdk-client.ts`, `src/gateway/litellm-proxy.ts`.

> **Gate 8 route-back note (D-G8-4, IMPL-051; review finding S-1, decision D-G):** this section's
> own boundary text promises "bounded `timeoutMs` (config, sane default) ... never hangs" — but the
> *default* production gateway path (`ClaudeAgentSdkGatewayClient`, selected by `main.ts`'s
> `composeConfig()` whenever no config file exists at all, the exact zero-config "just run it"
> deployment `main.ts` was built to support) had no hardcoded fallback of its own, unlike `bind`/
> `port` which both already default in `composeConfig()`. `loadFileConfig()` returns `{}` in that
> shape, so `timeoutMs` stayed `undefined` end-to-end — `ClaudeAgentSdkGatewayClient.invoke()` only
> races a bound `when this._config.timeoutMs !== undefined` (D-F7's own note above), so a dead/hung
> local provider hung the whole run (RunGuard's concurrency slot stays held) indefinitely, violating
> decision D-G (user-reconfirmed 2026-07-03: "keep the minimal breaker in v1"). Fix:
> `composeConfig()`'s `timeoutMs: fileConfig.timeoutMs` grows the same hardcoded `?? 15000` fallback
> `server.ts`'s own legacy `LiteLLMGatewayClient` construction already has. A second, more direct
> bug was found while verifying the fix: the `ClaudeAgentSdkGatewayClient` constructor call was
> reading the raw `fileConfig.timeoutMs` (still `undefined` in the zero-config case) instead of the
> just-resolved `config.timeoutMs` — fixed alongside, since the fallback above would otherwise have
> been dead code. See `src/main.ts`.

> **Gate 8 route-back note (D-G8-5, IMPL-051; review finding V5, D-R2):** this class's own header
> comment already promised "never reads or forwards a real host credential" — but `invoke()`'s
> `options.env` spread the ENTIRE `process.env` verbatim (`{...process.env, ANTHROPIC_BASE_URL:...,
> ANTHROPIC_API_KEY:...}`) into the spawned `claude` CLI subprocess, true only for the two
> `ANTHROPIC_*` keys actually overridden — every other host secret (`OPENAI_API_KEY`,
> `GEMINI_API_KEY`, cloud credentials, tokens, ...) leaked straight through. Fix: a new
> `ENV_ALLOWLIST = ['PATH','HOME','SHELL','LANG','LC_ALL','TMPDIR','TERM']` (the keys the subprocess
> genuinely needs to find its own binaries, resolve `$HOME`-relative config/cache paths, and respect
> the host's locale/shell) + `buildSubprocessEnv(baseUrl)` builds `options.env` from only those
> allowlisted keys (when present in the host env) plus the overridden `ANTHROPIC_BASE_URL`/
> `ANTHROPIC_API_KEY` pair — never the full `process.env`. See
> `src/gateway/claude-agent-sdk-client.ts`.

### DES-010 — RunStore port + journal / record data shapes
- **status:** draft
- **traces:** ARCH-006, TASK-013, TASK-014
- **signature:** narrow injectable port (in-memory fake for tests); journal.jsonl per run + SQLite index; single-writer per run.
- **iter:** v1

```ts
interface RunStore {                                        // injected seam; InMemoryRunStore fake for UTs
  createRun(r: RunSpec): Promise<string>;
  appendJournal(runId: string, e: JournalEntry): Promise<void>;   // ordered append, one writer per run
  appendTranscript(runId: string, agentId: string, ev: TranscriptEvent): Promise<void>;
  recordTransition(runId: string, from: RunStatus|null, to: RunStatus, ts: string): Promise<void>;
  getRun(runId: string): Promise<RunStatusView|null>;
  listRuns(): Promise<RunSummary[]>;
  hydrateAll(): Promise<RunSummary[]>;                      // boot recovery: one log line enumerating re-hydrated runs
}
interface JournalEntry { callSeq: number; key: CallKey; value: unknown|null; ts: string; scriptVersion: string; }
interface RunStatusView { runId: string; status: RunStatus; phases: PhaseView[]; agents: AgentRecord[]; scriptVersion: string; }
```
Boundary/error: journal records each `agent()` return in COMPLETION order (the resume cache, DES-004). Per-run files → no cross-run write contention. Survives restart (REQ-006). Port exists for TESTABILITY (in-memory fake), NOT multi-DB portability — SQLite swap deliberately not built (Karpathy). Prior runs' journals keep referencing the `scriptVersion` they ran with (REQ-014).

> **Gate 6 note (D-I2, IMPL-019; REQ-006, IMPL-025):** the port grew two small additive methods beyond
> the original signature above, both needed to keep `workflow_result`/restart-survival honest rather
> than reconstructing them ad hoc in `RunManager`: `recordResult(runId, result)` / `getResult(runId)`
> (the script's return value — SqliteRunStore persists it as a `result` column plus a
> `{type:'result',...}` marker line in that run's `journal.jsonl`) and `getSpec(runId)` (the original
> `name`/`script`/`args`/`budget`, needed to rebuild a live `RunEntry` for `suspend`/`resume`/`stop`
> after a process restart — SqliteRunStore added `script`/`args`/`budget` columns). See
> `src/run-store.ts`, `src/store/sqlite-run-store.ts`.

> **Gate 6 route-back note (D-V6/D-V7, IMPL-029):** `RunStore` grew `getTranscript(runId, agentId):
> Promise<TranscriptEvent[]>` (see DES-008's note) and `createRun(spec, scriptVersion = 'v1')` gained
> an optional third param — `RunManager.start()` now threads the catalog's actually-resolved
> `scriptVersion` (e.g. `"v2"` after an update) through it instead of every run hard-coding `'v1'`
> (default preserved for existing call sites). REQ-013 artifact listing did NOT change this port —
> `McpFacade.workflow_artifacts` reads the filesystem directly via a new `RunManager.workspacePath
> (runId)` accessor (live state first, falls back to recomputing the deterministic
> `name`+`runId`-derived path from `RunStore.getSpec` for a run this process hasn't touched since
> restart) rather than adding an artifact-listing method to the store port itself (smaller blast
> radius — DES-011 already owns workspace path derivation). See `src/run-store.ts`,
> `src/store/sqlite-run-store.ts`, `src/run-manager.ts`, `src/mcp-facade.ts`.

> **Gate 6 round-3 route-back note (D-F9b, IMPL-D-F9b-1):** `getRun`'s `RunStatusView.agents` was a
> hard-coded `[]` in BOTH `InMemoryRunStore` and `SqliteRunStore` (`08-validation.md` round-2/3
> finding, `state.yaml` `pending[]` item 5's root cause, real: AgentRecord was only ever tracked in
> an in-process `AgentExecutor`'s transient Map, which does not survive a restart, even though the
> underlying `agent-<id>.jsonl` transcripts already do per D-V6). New exported helper
> `deriveAgentRecords(transcripts: Map<string, TranscriptEvent[]>): AgentRecord[]`
> (`src/run-store.ts`) derives one `AgentRecord` per agentId from that agent's last `usage`
> transcript event (an agent with no `usage` event yet — still in flight, or never completed — is
> omitted, same as it would be from the in-process Map before its own capture resolves). Both
> `getRun` implementations now call it instead of hard-coding `[]`: `InMemoryRunStore` passes its
> already-in-memory transcripts map; `SqliteRunStore` grows a private `_allTranscripts(runId)` that
> enumerates every on-disk `agent-<id>.jsonl` file in that run's directory (the restart-survival
> source, since no in-process Map exists after a real restart) and reads each one back via the
> existing `_readTranscriptFile` helper (D-V6). This closes `McpFacade.workflow_agent_log`'s
> downstream `AGENT_NOT_FOUND`-after-restart gap too, since that facade method gates on
> `view.agents.find(...)` before ever calling `getTranscript`. See `src/run-store.ts`,
> `src/store/sqlite-run-store.ts`.

> **Gate 6 route-back note (D-F13, IMPL-048; REQ-006):** `JournalEntry` (this section's own
> interface) grows `aborted?: boolean` — see the DES-004 note above for the full rationale
> (distinguishing an ABORTED-null from a genuine TERMINAL-null so `ResumeCache.replay()` re-runs the
> former live on resume). Absent/false for every entry recorded before this route-back and for every
> ordinary terminal-null entry going forward — the field is purely additive, no existing journal
> shape/consumer changes. See `src/types.ts`, `src/run-manager.ts`, `src/resume-cache.ts`.

### DES-011 — Workflow Catalog: registry + workspace rooting
- **status:** draft
- **traces:** ARCH-007, TASK-015, TASK-016
- **signature:** named registry with version pinning; per-workflow work folder + per-run workspace; rooted paths only.
- **iter:** v1

```ts
interface WorkflowCatalog {
  register(name: string, script: string): Promise<{ version: string }>;     // new version each update
  get(name: string): Promise<{ script: string; version: string }>;          // unknown → CatalogNotFoundError (catchable)
  list(): Promise<Array<{ name: string; version: string }>>;
  workFolder(name: string): string;                                          // persistent per-workflow root
  runWorkspace(name: string, runId: string): string;                         // per-run dir under workFolder
  resolveInWorkspace(runId: string, rel: string): string;                    // throws if escapes the run workspace
}
```
Boundary/error: `workflow('other-name')` unknown → catchable throw naming the missing workflow (mapped to `agentThrow`, REQ-014). Agent file I/O confined to the run workspace: run A cannot see run B's files; workflow X's folder unreachable from Y via the API surface (REQ-013). `resolveInWorkspace` rejects `..`/absolute escapes. Updating a registered workflow bumps `version`; the next run uses the new script, prior journals keep their pinned version. Documented retention/cleanup governs old run workspaces.

> **Gate 6 note (D-I9, IMPL-027):** `list()` grew a `createdAt: string` field per entry (registration
> timestamp) beyond the signature above, needed so `McpFacade.workflow_list` can surface it directly
> without McpFacade reaching into catalog internals — see `src/workflow-catalog.ts`.

> **Gate 6 route-back note (D-V2, IMPL-029):** registrations (`name`/`script`/`version`/`createdAt`)
> now persist in an on-disk SQLite DB (`catalog.db` under `workRoot`, `better-sqlite3` — the same
> dependency `SqliteRunStore` already uses, no new one) instead of an in-memory `Map`, so
> `workflow_list`/`workflow_run(name)` keep working across a server restart pointed at the same
> `workRoot` (REQ-014 acceptance extended per user decision). `register()` bumps the existing row's
> version rather than inserting a new one, so per-name version numbering also survives restart. See
> `src/workflow-catalog.ts`.

### DES-012 — Submission Validator: one error shape at entry points
- **status:** draft
- **traces:** ARCH-008, TASK-017
- **signature:** thin facade delegating to each module's rule; returns one error shape at BOTH entry points, pre-run.
- **iter:** v1

```ts
interface SubmissionValidator {
  validate(spec: RunSpec): Promise<{ ok: true } | { ok: false; errors: ErrEnvelope[] }>;
}
// delegates: ARCH-003 meta/parse · ARCH-005 alias resolves · ARCH-007 registry/agentType existence
```
Boundary/error: fails FAST at submission, never mid-run — missing model-alias mapping, malformed `meta` literal, unknown `agentType`, unknown workflow name, TS-not-JS parse all surface here as `errors:[{code,field,message}]` (consumability: one shape, caller branches once). It only aggregates the owning modules' rules — no duplicated/inverted validation logic (D-VAL).

### DES-013 — Cross-cutting error / null-semantics + throw contract
- **status:** draft
- **traces:** ARCH-003, ARCH-004, ARCH-005
- **signature:** ONE shared contract for every null-return and every hard-throw so paths cannot drift.
- **iter:** v1

```ts
// NULL (resolve, never reject):  agent() terminal API error after retries;  parallel() thunk throw → that slot null;
//   pipeline() stage throw → item→null, remaining stages skipped;  provider timeout/unreachable/terminal (D-G).
// THROW (inside script, catchable/reported):  budget ceiling (spent()>=total);  2nd-level workflow() nesting;
//   unknown workflow(name);  determinism guards;  >4096 items/call;  >512KB;  TS-not-JS;  malformed meta;
//   unmapped alias & unknown agentType (surfaced at submission, DES-012).
```
Boundary/error: `parallel()`/`pipeline()` calls themselves NEVER reject (barrier resolves with nulls in slots). This single enumeration is the checklist the verifier turns into UTs — every row is one testable case.

### DES-014 — Clock / RNG determinism seam consistency
- **status:** draft
- **traces:** ARCH-003, ARCH-006
- **signature:** every parent-side method that reads time takes the injected Clock; the sandbox VM has NO clock (guards throw).
- **iter:** v1

```ts
interface Clock { now(): number; isoNow(): string; }       // injected; FixedClock for UTs
```
Seam consistency (Exit-Gate 5): the ONLY sanctioned time reads in the v1 kernel are `RunRecorder.recordTransition` timestamps and `RunStore.appendJournal`/`appendTranscript` `ts` — ALL take the injected `Clock` (no bare `Date.now()`/`new Date()` anywhere in kernel code). The sandbox never reads time at all (determinism guards throw). No `get_due(clock)`/`rearm(wallclock)` asymmetry exists in v1 because there is no scheduler yet; when ARCH-010 (Scheduler, v2) is built it MUST adopt the same injected `Clock` in EVERY method that reads time (forward-flag). RNG: no kernel randomness; `Math.random()` inside the script throws.

### DES-015 — Real-tier validation path + per-tier mock policy
- **status:** draft
- **traces:** ARCH-001, ARCH-004, ARCH-005
- **signature:** per-REQ real entrypoint + real wiring the validator can run; explicit mock policy per tier.
- **iter:** v1

Real entrypoint(s): the running MCP Streamable HTTP server on 127.0.0.1; real wiring = real sandbox child process + real RunStore (journal.jsonl + SQLite on disk) + real embedded LiteLLM subprocess. Real external deps: LLM providers via LiteLLM (E2E uses a local Ollama backend or a test/sandbox API key — never a mock of the SUT's own gateway boundary).

Per-REQ real-tier path (what proves it, end to end):
- REQ-001/002 — submit `sdlc-run.js` (and synthetic null/nesting/budget fixtures) via `workflow_run`, assert `workflow_result` deep-equals the script return; determinism-guard fixtures throw.
- REQ-003 — a workflow whose `agent()` reads a workspace file; real SDK session performs the read.
- REQ-004 — `agent(...,{model:'haiku'})` routes through real LiteLLM; assert AgentRecord provider+model and (Ollama alias) that the gateway log shows only the local backend; provider-down fixture → agent()=null.
- REQ-005 — real MCP client `tools/list` + async submit→poll→fetch over Streamable HTTP; bind check 127.0.0.1.
- REQ-006 — suspend→resume replay + restart survival against the real on-disk store.
- REQ-007 — `workflow_status`/`workflow_agent_log` over a real completed run.
- REQ-013/014 — real registry register/list/invoke-by-name + per-run workspace isolation on disk.

Per-tier mock policy: **unit** may mock freely — RunStore(InMemory), AgentSpawner(fake), GatewayClient(fake), Clock(Fixed) — to isolate logic. **integration** uses real adjacent components (real sandbox child + real RunStore), mocking ONLY third-party network you genuinely cannot run. **E2E/acceptance MUST NOT mock the SUT's own boundaries** (no faking the sandbox, store, or GatewayClient); external LLM providers go through a local Ollama or sandbox/test credentials. This is what lets Gate 7.5 actually run the system and blocks mock-only false-green.

## Iteration v2 — extension-module design (ARCH-010..014; attaches at v1 seams, zero v1 rework)

> **Panel provenance (v2):** `.panel/design/adversarial.r1.md` (interface-contract / boundary-error /
> testability, opus-4-8) + `.panel/design/quality-dimensions.r1.md` (observability / replaceability /
> consumability / self-sustainability, sonnet-5). Round-1 headlines were largely complementary (contract+
> boundary+testability seams vs cross-cutting concerns landing on the same seams); the two material
> conflicts (asset live-probe drop-vs-keep; scheduler catch-up backfill; asset re-probe) are reconciled in
> the v2 Decision rationale at the foot of this file — synthesized directly, no round-2 needed.
> Safety_class=QM → no functional-safety/cybersecurity lenses. All v2 tools return the DES-001
> `ResultEnvelope` and pass the ARCH-009 auth no-op seam unchanged; new tools get real
> `TOOL_METADATA.inputSchema` in the D-G8-3 shape (do NOT repeat the v1 placeholder-schema finding).

### DES-016 — Scheduler port + Schedule record + persistence + `workflow_trigger`
- **status:** draft
- **traces:** ARCH-010, TASK-019
- **signature:** discriminated `Schedule` union persisted in SQLite; `SchedulerPort` CRUD + resident trigger over Catalog(ARCH-007)+RunManager(ARCH-002); all tools return `ResultEnvelope`.
- **iter:** v2

```ts
type Schedule =                        // each arm carries optional budget → the run it starts (KP-9)
  | { kind:'cron';     id:string; workflow:string; args?:unknown; budget?:number|null; cron:string; tz?:string; enabled:boolean }
  | { kind:'once';     id:string; workflow:string; args?:unknown; budget?:number|null; at:string /*ISO*/;        enabled:boolean }
  | { kind:'resident'; id:string; workflow:string; args?:unknown; budget?:number|null;                            enabled:boolean };
interface ScheduleStatus { id:string; kind:Schedule['kind']; workflow:string; enabled:boolean;
                           nextFire?:string; lastFire?:string; lastRunId?:string; }
// Closed error-code union (KP-1) — an agent caller branches retryable-vs-terminal without string-matching:
type ScheduleErrCode = 'INVALID_CRON'|'AT_UNPARSEABLE'|'WORKFLOW_NOT_FOUND'|'SCHEDULE_NOT_FOUND'|'SCHEDULE_DISABLED'|'ALREADY_COMPLETED';
interface SchedulerPort {
  create(s: Omit<Schedule,'id'>): Promise<ResultEnvelope<Schedule>>;   // validates cron/at/name at SUBMISSION
  list(): Promise<ScheduleStatus[]>;                                   // observability surface (schedule_list)
  setEnabled(id: string, on: boolean): Promise<ResultEnvelope<void>>;
  delete(id: string): Promise<ResultEnvelope<void>>;
  trigger(workflow: string, args?: unknown): Promise<ResultEnvelope<{runId:string}>>; // resident; disabled → error
  originOf(runId: string): 'manual'|'cron'|'once'|'resident';          // SYNC (KP-2): reads the schedule store synchronously (better-sqlite3), the one deliberately-sync method
}
// MCP tools: schedule_create / schedule_list / schedule_delete / workflow_trigger — each ResultEnvelope + real TOOL_METADATA.inputSchema.
```
Boundary/error: cron/`at` validated synchronously at `create` (invalid cron expr → `INVALID_CRON` / unparseable `at` → `AT_UNPARSEABLE` / unknown workflow name → `WORKFLOW_NOT_FOUND`, each an `ErrEnvelope` with `field`, never a run that silently never fires — reuse DES-012 fail-fast, delegate name-existence to Catalog). **`trigger` precondition pinned (KP-3):** unknown workflow → `WORKFLOW_NOT_FOUND`; a `resident` whose `enabled=false` → `SCHEDULE_DISABLED` (REQ-015 clause 3); never a thrown exception across the tool boundary. `setEnabled`/`delete` on an unknown id → `SCHEDULE_NOT_FOUND` (never throw). **Why `resident` is its own kind (KP-4):** trigger-eligibility is persisted and enable-gated uniformly in the ONE schedule store (a single `Schedule` union), rather than splitting an `enabled` flag onto the Catalog entry — simpler than a two-store split; it carries no time field. **Cost containment (KP-9 / R1, agent-altitude self-sustainability):** each `Schedule` arm carries an optional `budget` that flows into `RunManager.start(spec)` exactly like a manual run's budget (the run path already enforces it via RunGuard); absent → the server-level default cap applies (no unbounded-spend-on-an-unattended-timer). **Overlap = allowed and is an explicit accepted risk** (a slow cron can pile independent runs against paid providers); skip-if-running is a documented v2 non-goal — mitigated by per-run budget + the tunnel-gate (D5/C4), re-evaluate with auth in v3. **Same run path:** `trigger` and every scheduled fire call `RunManager.start(spec)` exactly like `workflow_run`, so scheduled/triggered runs appear in `workflow_list`/dashboard identically and are covered by the existing AgentSpawner stub (zero second execution path). **Persistence:** schedules live in SQLite under `workRoot` (same `better-sqlite3` dependency the catalog/store already use — no new dep, no ARCH-006/007 signature change), survive restart, re-armed at boot (DES-017). **Run-origin observability (zero v1 rework):** the scheduler records `scheduleId → runId` in its OWN store; `originOf(runId)` derives a run's origin by that join — the v1 `RunSpec`/`RunStore` are NOT modified (see rationale D-V2a).

### DES-017 — Scheduler firing engine: pure `tick(now)` + `computeNextFire` + Ticker/Clock seam
- **status:** draft
- **traces:** ARCH-010, TASK-024
- **signature:** the firing decision is a PURE function of persisted schedules + `now`; the only impure part is a driver loop; every time read goes through the injected Clock (Exit-Gate-5).
- **iter:** v2

```ts
interface ScheduleFiring { id:string; workflow:string; args?:unknown; kind:Schedule['kind']; }
interface Ticker { start(cb:()=>void): void; stop(): void; }        // real=setInterval; FakeTicker.advance() in UT
function tick(schedules: Schedule[], now: number): ScheduleFiring[]; // PURE: what is due at `now`; starts no runs
function computeNextFire(cron: string, tz: string|undefined, after: number): number; // PURE named helper (DST/rollover)
// driver: onTick = () => { for (f of tick(store.all(), clock.now())) runManager.start(specOf(f)); store.markFired(f, clock.now()); }
// bootRearm(clock: Clock): void  — re-computes nextFire for every persisted schedule from clock.now() at startup.
```
Boundary/error (all pure, table-driven UT via `FixedClock`+`FakeTicker`, zero wallclock waiting): **missed fire while server was down** — cron = **fire-once-on-catch-up-then-resume** (NEVER backfill every missed slot); one-shot whose `at` is already past at boot or at create = **fire-immediately**. A `once` **auto-completes** (sets `enabled=false`) after firing exactly once. **Overlap** = allowed (a fire while a prior run of the same workflow is still running starts an independent run — matches "appears like any manual run"; skip-if-running is a documented non-goal for v2). Editing `at` before firing applies the new time; editing after a `once` has fired → `error` (already completed). **Seam consistency (Exit-Gate 5, named per method):** `tick(now)` takes `now` (the driver passes `clock.now()`); `computeNextFire(...,after)` takes `after` (clock-sourced); `bootRearm(clock)` takes the injected Clock; `create`/`setEnabled`/`markFired` stamp `nextFire`/`lastFire` via the injected Clock. **No scheduler method reads the wall clock itself** — there is no `get_due(clock)`/`rearm(wall)` asymmetry (the exact time-bomb DES-014 forward-flagged for this module).

### DES-018 — Dashboard: pure `buildDashboardModel` + read-only HTTP / live-tail
- **status:** draft
- **traces:** ARCH-011, TASK-020, TASK-025
- **signature:** all data-shaping in a pure VM builder over the existing store shapes; HTML/transport is a dumb renderer; live update = poll the injectable RunStore port; strictly read-only.
- **iter:** v2

```ts
interface DashboardVM { runs: RunSummary[]; selected?: RunStatusView; transcript?: TranscriptEvent[]; degraded?: string; }
function buildDashboardModel(runs: RunSummary[], view?: RunStatusView, tr?: TranscriptEvent[]): DashboardVM; // PURE, UT
// read-only HTTP: GET /api/runs → RunSummary[]; GET /api/runs/:id → RunStatusView; GET /api/runs/:id/agents/:aid → TranscriptEvent[]
```
Boundary/error: NO parallel dashboard DTO — payloads are exactly the shapes the MCP read-tools already return (one data model, two transports). **NO mutation/write endpoint exists** (cannot perturb a run — REQ-008/ARCH-011). Live update = **poll the already-injectable RunStore port** (reuse the established test seam; no bespoke store event-bus — simplicity+testability align). A store read error mid-tail returns a partial/last-known VM with `degraded` set + an error badge, **never a 500 that takes the page down**; the tail survives a run being stopped/deleted underneath it. **Stored-XSS invariant (KP-12):** the HTML page injects run/agent/transcript data — which includes model-produced text and tool args — into the DOM **only via `textContent` / `JSON.stringify`, never `innerHTML`** (see `src/dashboard-page.ts`), so a transcript containing `<script>` is structurally escaped on an unauthenticated dashboard; verifier asserts a `<script>`-bearing transcript renders escaped. **Transcript pagination (KP-6, deferred-safe):** `GET /api/runs/:id/agents/:aid` returns the whole `TranscriptEvent[]` today; an optional `?limit`/`?after` cursor is a NON-breaking additive extension (optional query params, default = whole), deferred to when a real long-run pain appears — no contract break to add later (Karpathy: not speculative now). Known boundary (v1.1 carry-forward): an aborted `AgentRecord` may still read `'running'`; the dashboard renders agent state as-recorded and does not fabricate liveness — the run's own final status is authoritative (documented, not fixed here — zero v1 rework).

> **Gap-test verifier note (D-V2I-4, 2026-07-04):** confirmed there is no separate dashboard bind/port
> — `read-only HTTP` above is served on the SAME `http` server/listener as `/mcp` (`src/server.ts`'s
> single `createHttpServer` handler routes by `req.url` prefix, e.g. `/api/runs`, not by a second
> port). A `dashboardPort` composition-root config key was removed from `UT-033`'s coverage for this
> reason (dead wiring with nothing to ever consult it).

> **Gate 6 route-back (D-V2V-2, 2026-07-04, gap-tests-v2b):** the user's own Gate-1 choice was an
> explicit 瀏覽器即時儀表板 (browser live dashboard) — a JSON-only transport with no literal HTML page
> to open in a browser tab did not satisfy that acceptance criterion (VAL-018 finding, Gate 7.5
> round 1). Added `GET /dashboard` (+ `GET /dashboard/<runId>` SPA-style routing) on the SAME
> server/port as `/api/runs*`/`/mcp` — a minimal self-contained static HTML/JS page
> (`src/dashboard-page.ts`'s `DASHBOARD_HTML` const, served verbatim by `src/server.ts`): a run
> list, a drill-in phase/agent-tree view (per-agent `agentId`/`state`/`tokens`), a transcript view,
> and `setInterval`-based polling so state/tokens refresh with no manual reload. The page's own
> client JS calls the SAME `buildDashboardModel`-shaped `/api/runs*` endpoints this section already
> defines — **no parallel dashboard DTO, no second data model**: "one data model, two transports"
> is now genuinely two (the JSON API the MCP tools/other clients still use, and this HTML page for
> a human in a literal browser). `buildDashboardModel` itself is untouched. See
> `tests/acceptance/val-018-dashboard-browser-ui.test.ts` (VAL-018).

### DES-019 — Asset Sync core: push/list/delete + recursion-guard + path-safety
- **status:** draft
- **traces:** ARCH-012, TASK-021
- **signature:** explicit `files[]` payload (inspectable without unpacking); two mandatory pure security predicates; partial-push atomicity.
- **iter:** v2

```ts
type AssetKind = 'skill'|'hook'|'mcp-config';
interface AssetPush { kind: AssetKind; name: string; files: Array<{ path:string; contentB64:string }>; }
interface AssetPushResult { stored: string[]; excluded: Array<{ name:string; reason:string }>; }
// MCP tools: asset_push(AssetPush) → ResultEnvelope<AssetPushResult>; asset_list() → {kind,name}[]; asset_delete({kind,name}).
function isSelfReferential(a: AssetPush, selfBind: {host:string;port:number}, reservedPrefix: string): boolean; // pure fast-gate, D4
function safeRelPath(p: string, assetRoot: string): string | null;   // pure fast-gate; null ⇒ escapes root ⇒ reject
function assertContained(absTarget: string, assetRoot: string): void; // IMPURE write-time guard: fs.realpath prefix / O_NOFOLLOW
```
Boundary/error (fast pure gate + edge guard; both directions UT-covered): **(1) recursion guard (D4)** — reject/strip any asset that is (a) a `mcp-config` whose endpoint/URL resolves to *this* server's own bind addr/port, or (b) matches this system's own plugin / guidance-skill identity by reserved name prefix (`rwe-*`). Every exclusion is REPORTED in `excluded[]` (REQ-009 clause 3), never silent; UT with a self-config fixture (must reject) AND a benign-lookalike (must NOT over-reject). **Self-ref must NORMALIZE, not string-compare (KP-8):** resolve `localhost`/`0.0.0.0`/the loopback set / bind-equivalent addrs to "self" before comparing — a bare `hostname===host` compare under-rejects (`localhost`≡`127.0.0.1`) and the D4 guard fails OPEN, letting a remote agent re-invoke this service. **(2) path-traversal / workspace-escape — TWO-TIER (KP-7):** the pure `safeRelPath` fast-gate rejects `..`/absolute (fully UT'd both directions); a **pure string check cannot enforce symlink containment** (a component resolving through an existing symlinked dir redirects the write outside root, invisible to the string), so the write-time `assertContained` guard requires `fs.realpath(target)` to be a prefix of the realpathed asset root (or `O_NOFOLLOW` per component) — on a no-auth service where `asset_push` is already code-exec, path-containment is the LAST boundary and must hold on disk, not just in a testable string. Verified by a tmpdir-with-planted-symlink integration test (KP-17), not only pure UT. **(3) size/count caps (KP-13):** each file's decoded `contentB64` and the per-push total are capped (mirrors v1's 512 KB script cap) → `ASSET_TOO_LARGE`; guards disk-fill/OOM DoS on a no-auth surface. **Partial-push atomicity:** if ANY file fails ANY gate, reject the WHOLE push (no half-written asset dir). **Overwrite:** pushing an existing `(kind,name)` replaces it; a run already using the old version keeps its loaded copy (per-run resolution at spawn) — documented, does not crash. **Known boundary:** `agentType` (`agents/*.md`) definitions load once at `createServer()` and are NOT hot-synced by this path — documented asymmetry (assets sync live, agent prompts need restart), not silently equated.

> **Gate 6 route-back (D-V2V-1, 2026-07-04, gap-tests-v2b):** this module (push/list/delete +
> the two predicates) was already correct — the gap Gate 7.5 round 1 found (VAL-017) was that
> NOTHING downstream ever read what it stored. Closed at the consumer, not here (this module stays
> transport-agnostic, unchanged): `src/gateway/claude-agent-sdk-client.ts` now (a) reads every
> stored `mcp-config` asset FRESH off disk (`assetRoot/mcp-config/<name>/...`) on every `invoke()`
> call and threads it into `Options.mcpServers` (`strictMcpConfig:true` unchanged — see DES-020's
> own note below), and (b) materializes every stored `skill`/`hook` asset into THAT call's own run
> workspace (`AgentReq.workspace`, forwarded through `GatewayClient.invoke()`'s new optional
> `workspace` field) at `<workspace>/.claude/skills|hooks/<name>/`, with `options.cwd` re-scoped to
> that workspace and `options.settingSources` becoming `['project']` (host-level `'user'`/`'local'`
> sources stay excluded either way — the D-F11 isolation this class was built to close is
> preserved, now scoped per run instead of globally off). `composeConfig()` (`src/main.ts`) forwards
> the resolved `assetRoot` (defaulting the same way `src/server.ts`'s own `AssetSyncService`
> construction does, `join(workRoot,'assets')`, when the config file omits it) into the
> constructed `ClaudeAgentSdkGatewayClient`. This system's own `rwe-*` skill/plugin is excluded
> end-to-end unchanged (D4 already prevents it from ever landing on disk, so there is nothing for
> the new read-side to find). See `tests/integration/asset-mcp-config-wiring.test.ts` (IT-035),
> `tests/integration/asset-skill-materialization-wiring.test.ts` (IT-036).

### DES-020 — Asset MCP-config live-probe validator behind injected `McpProbe` port
- **status:** draft
- **traces:** ARCH-012, TASK-026
- **signature:** the one network dependency isolated behind an injected port; static transport classification first, live probe only for runnable kinds; machine-readable reason code.
- **iter:** v2

```ts
interface McpProbe { probe(cfg: McpServerConfig): Promise<{ ok:true } | { ok:false; code:string; message:string }>; }
// FakeMcpProbe (accept/reject) in UT; real connect/handshake (remote-HTTP) or npx-stdio-spawn exercised ONLY at real-tier.
function classifyTransport(cfg: McpServerConfig): 'remote-http'|'npx-stdio'|'unsupported'; // PURE, UT
```
Boundary/error: `classifyTransport` (pure, UT) is the first gate — `remote-http` / `npx-stdio` are server-runnable and get probed; anything else (e.g. interactively-authenticated-headless per compat-spec §5) is rejected at push time with a **machine-readable `code`** (consumability: an agent client distinguishes "unsupported kind" from "unreachable" programmatically), not just a human string. The live probe is behind the injected `McpProbe` port so UT fakes accept/reject and the real handshake/spawn runs only at the real-tier (DES-023) — never a flaky network dependency in UT (adversarial C2/conflict-3 resolution: keep the REQ-mandated probe but inject it). Push is rejected BEFORE the asset lands (no half-validated config in the workspace). **Bounded + dangerous (KP-11):** the probe is hard-bounded by a timeout (shipped `PROBE_TIMEOUT_MS`, same breaker discipline as the gateway — a hung handshake never hangs the tool). Probing an `npx-stdio` config **spawns `npx <pkg>`**, i.e. installs+runs an arbitrary npm package at PUSH time, pulling code-exec forward from run-time to validate-time; on a no-auth service this is acceptable ONLY behind the DES-022 tunnel-gate (D5/C4) — documented as the compensating control, not silently ignored.

> **Gate 6 route-back (D-V2V-1, 2026-07-04, gap-tests-v2b):** unchanged by the DES-019 note above —
> this module still owns exactly the push-time gate (`classifyTransport` + the injected `McpProbe`,
> both in `src/mcp-probe.ts`/`src/server.ts`'s `checkMcpConfigTransport`). Only an already-accepted
> (server-runnable, probe-passed) `mcp-config` asset ever reaches disk, so the new
> `readMcpConfigAssets()` read-side (DES-019's note) never encounters an unsupported/unreachable
> config in the first place — no double-validation needed at the read side.

### DES-021 — Claude Code client plugin artifact + guidance skill
- **status:** draft
- **traces:** ARCH-013, TASK-022
- **signature:** client-side artifact (not a server API): plugin dir layout = MCP connection config + a guidance-skill markdown; two invariants only.
- **iter:** v2

```
plugin/                         # installable Claude Code plugin dir
  .mcp.json                     # MCP connection config → remote server (Streamable HTTP url + bind)
  skills/rwe-remote-workflow/SKILL.md   # guidance skill (reserved rwe-* name → self-excluded by DES-019 D4)
```
Boundary/error (deliberately thin, mostly non-code): the guidance skill teaches (i) the async **`workflow_run` returns a `runId` → poll `workflow_status` → fetch `workflow_result`** contract (the single easiest thing a calling agent gets wrong), (ii) the new v2 tools' **envelope-not-exception** gotchas (e.g. `workflow_trigger` on a disabled resident returns `error{SCHEDULE_DISABLED}`, not a throw), and (iii) **when to use the remote service vs the built-in local dynamic Workflow tool**. Two invariants for the verifier: the plugin's MCP tool namespace must **NOT collide** with the local dynamic Workflow tool (both coexist — REQ-010), and the plugin + its `rwe-*` skill + this `.mcp.json` are **self-excluded** from asset sync (D4, DES-019). UT/artifact test: `.mcp.json` is valid JSON pointing at the configured server; `SKILL.md` present with the async-contract section; reserved-prefix name matches the DES-019 guard.

### DES-022 — Deploy packaging + hardening (compose / systemd / smoke / orphan-reap / port-config)
- **status:** draft
- **traces:** ARCH-014, TASK-023, TASK-027
- **signature:** docker-compose (LiteLLM-optional profile) + systemd unit (`Restart=on-failure`) + scripted smoke check; the reproduced orphan-child / port-collision hazards designed IN.
- **iter:** v2

```
docker-compose.yml   # default profile: server only (direct-fetch/SDK path, no LiteLLM subprocess)
                     # profile "litellm": + managed LiteLLM (Python 3.11/3.12 required, D-R3)
deploy/rwe.service   # systemd: Restart=on-failure; ExecStart=node dist/main.js
scripts/smoke.sh     # non-interactive, exit-code: boot → submit sample workflow → assert completed → shutdown
```
Boundary/error: **DEPLOY.md leads with the dependency-free direct-fetch/SDK path** and presents LiteLLM as opt-in (replaceability + the path repeatedly real-verified clean); LiteLLM path documents the **Python 3.11/3.12 pin** (system 3.14 lacks prebuilt wheels — real, found live). **No-auth caveat** documented loudly: `asset_push` = server-side code execution → require SSH-tunnel/VPN until v3 auth (D5/C4). **Hardening (TASK-027, both panels binding):** SIGTERM/SIGINT handler **cascade-kills the LiteLLM child via process-group kill** (not `child.kill()` on the direct handle — `Restart=on-failure` alone does not reap leaked children); LiteLLM **port is configurable** (not hard-coded 4000); **pre-bind port ownership/liveness check** fails fast with an actionable message instead of false-positive-attaching to a stale proxy. The `smoke.sh` exercises boot→run→shutdown and **asserts no leaked LiteLLM child + no port clash**, not just a happy-path submit (the real-tier obligation for REQ-011). **Wiring completeness (standing rule 1):** every new config key (scheduler db path, configurable litellm port, asset root) is threaded through the exported `composeConfig()` helper and covered by the composition-root wiring-completeness UT — wiring gaps caught at unit tier. (D-V2I-4, 2026-07-04: no separate "dashboard bind/port" key exists — the dashboard shares the `/mcp` server's own bind/port, see DES-018's own note; dropped from this list and from `UT-033`'s coverage.)

### DES-023 — v2 real-tier validation paths + per-tier mock policy (extends DES-015)
- **status:** draft
- **traces:** ARCH-011, ARCH-012, ARCH-014
- **signature:** per-REQ real entrypoint + real wiring for the v2 REQs; explicit per-tier mock policy so E2E/acceptance never mock the SUT's own boundaries.
- **iter:** v2

Real entrypoint(s): the running MCP Streamable HTTP server (REQ-009/010/015) + the read-only dashboard HTTP server (REQ-008) + the documented deploy bring-up (REQ-011). Real wiring reuses the v1 real chain (real sandbox child + real on-disk RunStore + real Catalog) and adds the real SQLite schedule store, real asset FS writes under the workspace root, and the real `McpProbe`.

Per-REQ real-tier path (what proves it, end to end):
- **REQ-008** — boot the server with a real completed run AND a real in-flight run; HTTP GET the dashboard, assert the run list + drill-in phase/agent tree render, agent states update **without manual reload** (poll observed to refresh), and a selected agent's transcript is viewable. `buildDashboardModel` proven at UT with the InMemory store fake.
- **REQ-009** — `asset_push` a real local skill dir → it lands under the workspace root → a subsequent real `workflow_run` whose agent invokes that skill succeeds; push a real npx-stdio/remote-HTTP MCP config → real `McpProbe` accepts, a later run calls its tools; push a non-runnable config → rejected with a reason `code`; push this system's own plugin/guidance-skill/self-`.mcp.json` → excluded + reported in `excluded[]`.
- **REQ-010** — install the plugin in a real Claude Code client → `tools/list`/MCP-server list shows the remote server + the guidance skill is available; a locally-generated dynamic workflow JS still runs via the local Workflow tool unaffected, and the same JS submitted through the plugin's MCP connection runs remotely (both coexist, no namespace collision).
- **REQ-011** — on a clean Linux host, the documented DEPLOY.md steps only → server (+ LiteLLM when the profile is selected) boots and `smoke.sh` returns exit 0 (sample workflow completes); identical steps on localhost; shutdown leaves no orphan LiteLLM child and no port-4000 clash.
- **REQ-015** — a near-term cron schedule fires a real run that appears in `workflow_list` and keeps firing until disabled; a one-shot fires exactly once then auto-completes; `workflow_trigger(name,args)` starts a run immediately, and a disabled resident → `error{SCHEDULE_DISABLED}`. Firing logic proven deterministically at UT via `FixedClock`+`FakeTicker` time-travel (missed-fire/catch-up cases included) with zero wallclock waiting.

Per-tier mock policy: **unit** may mock freely — RunStore(InMemory), AgentSpawner(fake), `Clock`(Fixed), `Ticker`(Fake), `McpProbe`(Fake) — to isolate logic; tests construct servers via injected configs, never call paid endpoints, need no live credentials (fakes/local stubs only), `fileParallelism:false` kept. **integration** uses real adjacent components (real SQLite schedule store, real asset FS writes, real scheduler `tick` over a real Clock), mocking ONLY third-party network you genuinely cannot run. **E2E/acceptance MUST NOT mock the SUT's own boundaries** — no faking the dashboard HTTP server, the scheduler, the asset FS, or the `McpProbe`; external MCP servers probed go through a real sandbox MCP server / test npx package, and LLM providers go through local Ollama or sandbox/test credentials. This is what lets Gate 7.5 actually run the v2 system and blocks mock-only false-green.

### DES-024 — MCP Provisioning Registry: store + strict-by-name injection
- **status:** draft
- **traces:** ARCH-015, TASK-028, TASK-029
- **signature:** SQLite sibling catalog over the ARCH-006 store; pure resolve of the strict injected-MCP set by name; provision behind the injected `McpProbe`.
- **iter:** v3

```ts
type McpKind = 'stdio' | 'http';
interface McpProvisionRecord { name: string; kind: McpKind; config: unknown; healthy: boolean; provisionedAt: string; }
interface McpRegistry {
  register(rec: { name: string; kind: McpKind; config: unknown }): Promise<Result>;   // TASK-029: probes first
  get(name: string): McpProvisionRecord | undefined;
  list(): McpProvisionRecord[];                                        // store-internal; NOT an unauth MCP tool (D-V3f)
  delete(name: string): Promise<void>;
  resolveInjected(referencedNames: string[]): { configs: Record<string, unknown> } | { error: ReasonCode };  // MCP_NOT_PROVISIONED
}
```
Boundary/error: unknown name → `{error:'MCP_NOT_PROVISIONED'}` at submission (via DES-012 facade) AND at session build — never a silent no-op. `resolveInjected` returns ONLY the referenced entries → the builder passes them with `strictMcpConfig` (host ambient MCP never inherited — VAL-003). Provision: `McpProbe` dead → `MCP_PROBE_FAILED`, nothing persisted; live → row persisted `healthy:true`. Boot re-validation is warn-at-boot / fail-at-use (D-V3g): a bad row is marked `healthy:false`, logged (name only), never crashes the server; a run referencing it gets the typed error at submission. Testability: all CRUD + `resolveInjected` are pure UTs over the InMemory store; probe is the one injected seam (fake prober UT).

### DES-025 — Secret Store + Resolver (pure resolve + capture-time redaction)
- **status:** draft
- **traces:** ARCH-016, TASK-030, TASK-031
- **signature:** synchronous resolve of preloaded values + atomic config walk + a pure capture-time redactor; loading confined to startup; provider keys never off the proxy process.
- **iter:** v3

```ts
interface SecretSource { resolve(handle: string): string | undefined; names(): string[]; }   // preloaded at startup (env/LoadCredential)
// pure — imports no fs/net/process:
function resolveConfig(config: unknown, source: SecretSource): unknown;   // atomic: throws {code:'SECRET_MISSING'} or {code:'SECRET_HANDLE_INVALID'}
function redact(event: unknown, secretValues: string[]): unknown;         // capture-time; replaces any occurrence with '‹redacted›'
const HANDLE = /\$\{secret:([A-Za-z0-9_.-]+)\}/g;                          // the only legal handle grammar
```
Boundary/error: **atomic all-or-nothing** — a config with one good and one missing handle throws `SECRET_MISSING`, injects nothing partial, spawns nothing (fail-closed on REQ-018's core invariant). Malformed handle → `SECRET_HANDLE_INVALID` (never the literal `${secret:...}` smuggled through as a value). Handles are legal only in provisioned-MCP config values and provider-alias config; inert (never resolved) in workflow scripts and pushed skills — by construction. **Redaction is a single capture-time choke point** applied by the AgentTranscriptSink (DES-008) BEFORE any write to `agent-<id>.jsonl`, and by the RunRecorder — property invariant: given `${secret:x}`, no byte of x's resolved value appears in any persisted transcript, `SessionInitRecord`, dashboard field, or log line; handle NAMES stay loggable (diagnosability survives redaction). Two-layer containment (TASK-031): provider keys live only in the LiteLLM proxy process env/memory; the ARCH-007 confinement callback is realpath-based + argument-name-complete + `Bash`-deny-outside-root so a tool-capable agent cannot `cat` the proxy config or a sibling journal. Testability: `resolveConfig`/`redact` are pure UTs (atomicity, redaction, grammar); the source loader is a thin adapter; the confinement hardening is target-tier (planted-symlink integration + agent-cannot-read case).

### DES-026 — SDK Session-Options Builder (pure) + ProviderProfile + SessionInitRecord
- **status:** draft
- **traces:** ARCH-017, TASK-032
- **signature:** the master v3 test seam — a pure `(providerClass, alias, config, provisionedRefs, resolvedSecrets) → SDKOptions`; capability is a flat boot-validated config table; one audit record per build.
- **iter:** v3

```ts
interface ProviderProfile {                    // one flat row per alias; boot-validated by ajv; single source of truth
  providerClass: 'anthropic' | 'non-anthropic';
  supportsExtendedThinking: boolean;           // → builder thinking flag
  timeoutMs: number;                           // → DES-027 outer race
  retries: number;                             // → DES-027 outer race
  effortMapping?: Record<string, unknown>;     // → resolves the open `effort`-mapping question (pass-through default)
}                                              // supportsToolUse CUT (no consumer; allowlist applies regardless — D-V3b)
function buildSessionOptions(providerClass: string, alias: string, config: unknown,
                             provisionedRefs: Record<string, unknown>, resolvedSecrets: unknown): SDKOptions;  // PURE
interface SessionInitRecord {                  // transcript head (agent-<id>.jsonl line 1)
  alias: string; provider: string; modelId: string; thinkingMode: 'disabled' | 'sdk-default';
  allowlist: string[]; injectedMcpNames: string[]; secretHandleNames: string[]; cwd: string;   // NAMES only, never values
  settingSources: string[]; resolvedProjectRoot: string | null;   // REQ-021 auditability: stored, queryable confinement fact
}
```
Boundary/error: non-Anthropic alias → `thinking:{type:'disabled'}` (the D-F6 400 regression guard); Anthropic → left at SDK default. Curated tool allowlist ONLY (never the full built-in Claude Code surface — small models must not degrade to text-only). Unprofiled alias → **fail-safe default** (thinking disabled, conservative) AND submission-time `ALIAS_PROFILE_MISSING` via the DES-012 facade (defense in depth); the profile table is **ajv-boot-validated** — a typo'd field fails boot with `CONFIG_SCHEMA_ERROR` (boot-axis code, DES-013) rather than degrading silently, and `supportsToolUse` is CUT (no consumer). The ARCH-008 alias validator and the builder read the **same** `ProviderProfile` table instance — two copies is how D-F6 recurs. **Session-init project-marker re-walk (R2/Adv#3):** the builder re-runs DES-031's `findProjectMarkerAncestor(cwd, workRoot, existsImpl, realpathImpl)` from the run-workspace `cwd` up to (excluding) `workRoot` and refuses the build (typed error) on a hit — closing the intra-run REQ-021 leak an agent re-opens by writing a marker into its workspace after boot's one-time check; load-bearing precondition (stated): ARCH-016 confines agent writes to the run-workspace subtree — if weakened the cross-run variant escalates to HIGH. `SessionInitRecord` persists as the transcript head via the existing sink (no new file kind, now carrying `settingSources`+`resolvedProjectRoot`) and is reachable through `workflow_agent_log`; `workflow_status` per-agent entries carry resolved provider+modelId + `thinkingMode`. Testability: table-driven UT matrix (providerClass × thinking × allowlist × MCP refs × secret handles × cwd-marker) + a purity UT (frozen input → deterministic, asserts NO env/global/clock read); a **`settingSources`-never-`user`/`local` regression UT** (R9 — guards the `~/.claude/CLAUDE.md` global-memory leak class the workRoot walk cannot catch, today held only by a ternary); `SessionInitRecord` snapshot UT diffs against the `ps aux` argv Gate 7.5 already proved. This builder is a pure UT for everything except the one real Ollama `tool_use` round-trip (DES-028). Lives INSIDE the GatewayClient impls behind the unchanged `invoke(prompt,opts)` — SDKOptions never leak up through ARCH-004.

### DES-027 — Outer timeout race + kill-on-timeout + slot-free-exactly-once + FailureEnvelope
- **status:** draft
- **traces:** ARCH-017, TASK-033, TASK-035, TASK-037
- **signature:** the impure half — bound over the injected Clock, kill via the process-group primitive, one idempotent slot release, one internal failure record, never fake success.
- **iter:** v3

```ts
type FailureKind = 'timeout' | 'provider_error' | 'tool_error' | 'schema_mismatch';   // INTERNAL classification
interface FailureEnvelope { kind: FailureKind; attempts: number; elapsedMs: number; providerDetail?: string; }  // → AgentRecord
interface AgentSemaphore { withSlot<T>(fn: () => Promise<T>): Promise<T>; gauge(): { total: number; inUse: number; queued: number }; }
// outer race (inside each GatewayClient impl), over the injected Clock + injected spawn/kill (DES-027 seam):
//   race(query(), clock.delay(profile.timeoutMs)) → on timeout: killGroup(child); on all attempts spent → FailureEnvelope → null
```
Boundary/error (R1, both panels HIGH): the D-DOS slot is acquired in `withSlot` and released **exactly once** in one `finally` keyed to the race outcome (idempotent guard) — covering success / schema-retry-exhausted / provider-error / timeout-kill / suspend / stop. Never double-free (cap silently exceeded) nor never-free (a hung provider starves every run). On timeout the CLI child is killed via the DES-029 process-group primitive (its stdio-MCP grandchildren reaped) BEFORE the slot frees. Each impl writes ONE `FailureEnvelope` into the AgentRecord (surfaced in `workflow_status` + dashboard drill-in) and resolves `agent()` to `null` — the failure is NEVER smuggled as fake success text (REQ-020 clause 2). The AgentRecord transitions to a terminal state: `failed`(kind:timeout/provider_error) or `aborted`(suspend/stop) — no phantom `running` agent accumulates under the overnight scheduler (D-V3d). `FailureKind` is internal; at the client envelope `kind:timeout` maps to the published `PROVIDER_TIMEOUT` `ReasonCode` (one mapping fn — DES-013 taxonomy). Testability: timeout rides the injected Clock (UT time-travels the ~4-min CLI backoff, asserts `null` at simulated `timeoutMs`); kill is the injected `killImpl` (assert called exactly once); the semaphore is injected max=1 and a UT asserts `gauge().inUse` returns to 0 on every branch. Every time-reading path here takes the injected Clock (Exit-Gate-5 seam consistency — no bare `Date.now()`).

### DES-028 — Asset-Ingestion Policy: pure classifier
- **status:** draft
- **traces:** ARCH-018, TASK-034
- **signature:** one pure classifier at the ARCH-012 boundary; one UT per asset kind.
- **iter:** v3

```ts
type AssetKind = 'skill' | 'mcp-config' | 'hook';
type Disposition = { action: 'materialize' } | { action: 'redirect-to-provisioning' } | { action: 'reject'; code: 'HOOKS_UNSUPPORTED' };
function classifyAsset(kind: AssetKind, asset: unknown): Disposition;   // PURE
```
Boundary/error: `hook` → `reject{HOOKS_UNSUPPORTED}` by construction (closes the arbitrary-server-side-code / RCE vector — never silently materialized); the engine's OWN internal `PreToolUse` workspace-boundary hook is a fixed control (not user-uploadable) and is unaffected. `mcp-config` → `redirect-to-provisioning` (DES-024, not per-run materialized — the REQ-009 rescope). `skill` → `materialize` (ARCH-012 unchanged). Testability: one pure UT per kind.

### DES-029 — D-PROC: per-agent CLI subprocess lifecycle + D-BIND loopback guard
- **status:** draft
- **traces:** ARCH-005, ARCH-009, TASK-036, TASK-037
- **signature:** detached process-group spawn + kill-the-group primitive + race-safe proxy port + probe-gates-first-call; one tested `isLoopback` fail-closed guard.
- **iter:** v3

```ts
interface CliLifecycle {
  spawnDetached(cmd: string, args: string[], opts: SpawnOpts): ChildHandle;   // own process group (detached)
  killGroup(h: ChildHandle): void;                                            // kill(-pgid) SIGTERM→SIGKILL; reaps grandchildren
  cleanupTemp(h: ChildHandle): void;                                          // rm the session temp dir
}
function isLoopback(bind: string): boolean;   // accepts 127.0.0.0/8 + ::1; rejects everything else (truth-table UT)
```
Boundary/error: the SDK CLI child is spawned detached in its own process group so `killGroup` on timeout reaps its N stdio-MCP grandchildren (a bare `child.kill()` orphans them — re-creating the orphan-litellm pathology at higher volume). Proxy port selection is race-safe (bind port 0 and read the assigned port / retry-on-EADDRINUSE — NOT check-then-bind); the health probe gates the FIRST agent call, not server boot (a slow proxy degrades one run, not the engine). Restart/auto-recovery stays with systemd/docker `Restart=on-failure` — no in-process watchdog (D-PROC). `isLoopback` fail-closed: a non-loopback bind requires explicit opt-in, and `mcp_provision` refuses to serve when `bind != loopback` even with `insecureNoAuth:true` (RCE-grade write authority ⇒ stricter default than a read); the guard is NOT auth — real auth stays REQ-012/ARCH-009. Testability: `spawnImpl`/`killImpl` injected (UT asserts kill-called-once, never a real `claude` CLI); `isLoopback` is a pure truth-table UT.

### DES-030 — v3 real-tier validation paths + per-tier mock policy (extends DES-015/023)
- **status:** draft
- **traces:** ARCH-015, ARCH-016, ARCH-017, ARCH-018, ARCH-019
- **signature:** per-REQ real entrypoint + real wiring for REQ-016..021; explicit per-tier mock policy so E2E/acceptance never mock the SUT's own boundaries.
- **iter:** v3

Real entrypoint(s): the running MCP server with `gateway:"sdk"` + the managed LiteLLM proxy on Python 3.11/3.12 (REQ-016/020), the SQLite provisioning registry + `mcp_provision` (REQ-017), the parent-only secret store fed from real env/`LoadCredential` (REQ-018), and the real asset-push boundary (REQ-019). Real wiring reuses the v1/v2 real chain (real sandbox child + on-disk RunStore + Catalog) and adds a real local Ollama provider, a real provisioned MCP server (sandbox/test npx package), and real secret env.

Per-REQ real-tier path (what proves it, end to end):
- **REQ-016** — an alias mapped to a real local Ollama model with a tool available When run on the SDK gateway Then the model emits a native `tool_use` (not text), the tool executes in the run workspace, and its result lands in the agent's final answer — asserted on the **persisted `agent-<id>.jsonl` transcript** (same artifact Gate 7.5 forensically reconstructed), and the `SessionInitRecord` head shows `thinkingMode:'disabled'` + the curated allowlist. Everything but this one round-trip is a pure UT.
- **REQ-017** — `mcp_provision` a real MCP once → a later real `workflow_run` referencing it by name gets its tools; an unprovisioned name → typed `MCP_NOT_PROVISIONED` at submission; the SDK session injects ONLY the referenced MCP (`strictMcpConfig`, host ambient never inherited — VAL-003 continues to hold).
- **REQ-018** — a provisioned MCP / provider alias configured with `${secret:name}` resolving from real env → the run works and NO byte of the value appears in any transcript/dashboard/log; a tool-capable agent attempting to `cat` the proxy config or a sibling journal is denied (realpath confinement); a missing handle → `SECRET_MISSING` at submission, never a hang or literal pass-through.
- **REQ-019** — `asset_push` a hook-kind asset → rejected `HOOKS_UNSUPPORTED` (nothing materialized); an MCP-config asset → redirected to provisioning (not materialized per-run); a skill asset → materialized; the engine's own internal `PreToolUse` boundary hook still fires.
- **REQ-020** — with a real (or fault-injected) hung provider and a configured `timeoutMs`/`retries` on the `gateway:"sdk"` path, the affected `agent()` resolves `null` within the bound (the CLI child + its stdio-MCP grandchildren killed, the D-DOS slot freed — `gauge().inUse` returns to baseline), the run continues, and the `FailureEnvelope` is visible in the AgentRecord — never fake success text. Timeout/kill/slot logic proven deterministically at UT via the injected Clock + injected `killImpl` + injected semaphore, zero wallclock waiting.
- **REQ-021** (ARCH-019/DES-031) — real entrypoint = the running server booted with a `workRoot` nested inside a real git repo → boot aborts with `WORKROOT_INSIDE_PROJECT` naming the offending ancestor (no server comes up); booted with a marker-free data-dir `workRoot` → boots, and a real Ollama agent run whose workspace sits under it does NOT echo the operator's `CLAUDE.md`/memory (the empirical MEMORY.md-echo repro now fails closed). Session-init variant: a real run where agent A writes `CLAUDE.md` into its workspace → the subsequent same-run `agent()` build is refused (marker not loaded into agent B). The boot walk + the session-init re-walk are proven deterministically at UT via injected `existsImpl`/`realpathImpl` (truth table incl. symlink-into-project); the boot-abort and the no-echo run are the real-tier assertions (real fs, real Ollama, real `settingSources:['project']` CLI). E2E must NOT stub the guard or the session builder.

Per-tier mock policy: **unit** may mock freely — McpRegistry(InMemory store), `McpProbe`(fake), `SecretSource`(fake map), `Clock`(Fixed), `AgentSemaphore`(injected max=N), `spawnImpl`/`killImpl`(fake), `queryImpl`(fake) — to isolate the pure builder/resolver/classifier and the deterministic race; no paid endpoints, no live credentials, `fileParallelism:false` kept. **integration** uses real adjacent components (real SQLite registry, real asset FS writes, real secret env loading, real process-group spawn/kill of a stub child), mocking ONLY third-party network you genuinely cannot run. **E2E/acceptance MUST NOT mock the SUT's own boundaries** — no faking the registry, the secret resolver, the session builder, the kill path, or the asset classifier; provisioned MCP servers are real sandbox/test npx packages, and the LLM goes through **real local Ollama** (never a mocked model) so the native `tool_use` round-trip and the D-F6 thinking-disabled fix are proven for real. This is what lets Gate 7.5 actually run the v3 system on the `gateway:"sdk"` default path and blocks mock-only false-green.

### DES-031 — WorkRoot Project-Isolation Guard: pure marker-ancestor predicate (boot + session-init call sites)
- **status:** draft
- **traces:** ARCH-019, TASK-038
- **signature:** one pure predicate, two call sites — a throwing boot wrapper and a non-throwing session-build re-walk; `realpathSync` canonicalization, injected fs seams.
- **iter:** v3

```ts
// pure: the single predicate. realpathSync FIRST (resolve() misses a symlinked workRoot into a git repo — Adv#5).
// walk EXISTING ancestors from realpath(path) up to (but excluding) stopAt; return the first carrying a marker, else null.
function findProjectMarkerAncestor(
  path: string, stopAt: string | null,           // stopAt=null → walk to filesystem root (boot); =workRoot → session-init
  existsImpl: (p: string) => boolean,
  realpathImpl: (p: string) => string,
): string | null;                                 // marker = `.git` OR `CLAUDE.md`, as FILE or DIR
function assertWorkRootIsolated(workRoot: string, existsImpl, realpathImpl): void;  // boot wrapper: throw on hit
class WorkRootInsideProjectError extends Error { ancestor: string; marker: '.git' | 'CLAUDE.md'; remedy: string; }
```
```mermaid
classDiagram
  class findProjectMarkerAncestor { <<pure fn>> +path +stopAt +existsImpl +realpathImpl }
  class assertWorkRootIsolated { <<boot wrapper, throws>> }
  class SessionOptionsBuilder { <<DES-026, session-init>> }
  assertWorkRootIsolated --> findProjectMarkerAncestor : stopAt=/ , at boot (main.ts)
  SessionOptionsBuilder --> findProjectMarkerAncestor : stopAt=workRoot, at session-build (no throw)
```
Boundary/error: **(1) boot** — `assertWorkRootIsolated` (`stopAt=/`) raises `WORKROOT_INSIDE_PROJECT` (boot-axis `ReasonCode`, DES-013) naming the offending ancestor + marker type + remedy; a marker-free data dir returns void. A **non-existent** `workRoot` does NOT early-return/bypass — the walk checks the *existing* ancestors of the resolved path; clean chain → warn+proceed (a freshly-provisioned server may boot before its workRoot dir exists), a marker on an existing ancestor → fail. **(2) session-init** (DES-026 reuse, `stopAt=workRoot`) — re-walk from the run-workspace `cwd` up to (excluding) `workRoot`; on a hit **refuse the build with a typed error** (chosen over the engine planting a synthetic boundary marker — an active engine write into the agent's workspace could collide with agent scripts that read markers; refuse is simpler and side-effect-free). This closes the intra-run REQ-021 leak an agent re-opens by writing `.git`/`CLAUDE.md` into its workspace after boot's one-time check. **Load-bearing precondition (stated):** ARCH-016 confines agent writes to the run-workspace subtree (not above into the shared per-workflow folder); if that confinement is ever weakened the cross-run variant becomes reachable and this MED-HIGH escalates to HIGH. The guard is a FIXED control, not a per-deployment pluggable strategy — no "allow-inside-project" flag without reopening REQ-021. Testability: `existsImpl`/`realpathImpl` injected, all pure UTs (no live fs, no real model). Boot truth table: marker at workRoot → throws naming workRoot; marker at mid-ancestor → throws naming it; `.git`-file vs `.git`-dir → both trip; clean-to-`/` → void, no false positive, terminates (no infinite loop); `~/.claude` present without a marker → does NOT trip; symlinked workRoot into a project → trips ONLY after `realpathSync` (a fake realpathImpl models the symlink). Session-init: marker written in workspace → build refused; clean workspace → build proceeds. Complements the `settingSources`-never-`user`/`local` UT (DES-026, R9) which guards the disjoint global-`~/.claude` leak class this walk cannot see.

## v3 Decision rationale (contested / converged points)

The two design-panel groups (adversarial opus-4-8 — interface/boundary/testability; quality-dimensions sonnet — observability/replaceability/consumability/self-sustainability) came in **complementary, not conflicting** on the load-bearing choices, so no round 2 was needed. Both independently flagged the same #1 risk (the kill-path slot free-exactly-once / orphan pair). Reconciliations:

- **D-V3a — kill-path slot accounting: single idempotent `withSlot` release (both panels' #1 HIGH risk, converged).** Adversarial (#1) and quality (S-1) independently ranked the slot double-free/never-free as the highest hazard. **Resolved (no conflict):** one `withSlot(fn)` try/finally, idempotent, keyed to the race outcome, release provably once on every branch; a UT with injected semaphore(max=1) asserts `gauge().inUse` returns to 0 on success/schema-exhausted/provider-error/timeout-kill/suspend/stop (DES-027).
- **D-V3b — ProviderProfile: flat config table, and `supportsToolUse` CUT (quality pre-conceded; adversarial held the config-table line).** Adversarial expected quality/replaceability to push a provider SPI; quality instead **pre-conceded** the discipline ("every field names its consumer or is cut") and offered `supportsToolUse` for the chop (no consumer — the curated allowlist applies regardless). **Resolved to the simpler shape (Karpathy tie-break):** a flat boot-schema-validated table `{providerClass, supportsExtendedThinking, timeoutMs, retries, effortMapping}`, single-sourced with the ARCH-008 validator; `supportsToolUse` dropped. GLM/qwen/next = a config row, not a plugin framework (D-PROFILE upheld).
- **D-V3c — redaction is a capture-time choke point, not a post-filter (adversarial #2 ⟂ quality O-8, converged).** Both required redaction at the write boundary. **Resolved:** a pure `redact(event, secretValues)` applied by the transcript sink BEFORE any write, `SessionInitRecord` logs handle NAMES only; property invariant "no resolved value byte in any artifact" (DES-025). This is DISTINCT from the ARCH-016 filesystem-containment half — both needed, neither substitutes.
- **D-V3d — terminal agent state `aborted`/`timeout` (quality O-3 ⟂ Karpathy "backlog scope creep").** Quality argued the v1.1 cosmetic "phantom running" finding becomes a REQ-020 *verifiability* requirement the moment kill-on-timeout is a designed, frequent, overnight-scheduler path (~1 enum + 2 transition sites). **Resolved: adopt** — REQ-020's "bound observably applied" is unverifiable if the record never transitions; the cost is trivial and the alternative accumulates phantom agents exactly when nobody watches (DES-027).
- **D-V3e — reason-code taxonomy: one PUBLISHED union, axis-annotated, finer internal `FailureEnvelope.kind` (adversarial C1/C2 ⟂ quality O-2, converged r2).** Adversarial wanted a small stable client-facing enum; quality wanted a single anti-drift union owned once. **Reconciled r2 (both satisfied, single owner):** ONE exported `ReasonCode` union in `types/reason-codes.ts`, consumed by ARCH-008 (submission validator), ARCH-017 (`FailureEnvelope`) and ARCH-001 (MCP envelope), contract-tested — but each member **annotated by axis** so the type is single-owner while the invariant "a boot code never appears in a per-run `ResultEnvelope`" is a contract test, not an enum fork: **boot** (`WORKROOT_INSIDE_PROJECT`, `CONFIG_SCHEMA_ERROR` — fail-to-start), **submission** (`MCP_NOT_PROVISIONED`, `SECRET_MISSING`, `SECRET_HANDLE_INVALID`, `ALIAS_PROFILE_MISSING`), **run** (`PROVIDER_TIMEOUT`, `HOOKS_UNSUPPORTED`, `MCP_PROBE_FAILED`). The internal 4-value `FailureEnvelope.kind` classifies for the store and maps INTO the published run codes via one deterministic function (`timeout→PROVIDER_TIMEOUT`); a runtime-dead MCP surfaces as `FailureEnvelope{kind:'tool_error'}` → `agent()` null (no new public code — stated, not a silent no-op). Two enums for two concepts (client reason vs internal classification), not drift.
- **D-V3f — no discovery/enumeration endpoints on the no-auth listener (adversarial's sharpest expected disagreement — quality pre-conceded).** Quality/consumability wanted `mcp_list`/`secret_list` for agent UX but **explicitly held the line against its own dimension**; adversarial refused enumeration on the unauthenticated surface. **Resolved: no inventory-enumeration MCP tools until REQ-012 auth lands** — a clear typed error to the submitter is the discoverability surface; `McpRegistry.list()` stays store-internal (dashboard/admin behind the same 127.0.0.1+tunnel boundary), never an unauth tool.
- **D-V3g — process-group kill + boot graceful degradation (quality S-2/S-4 asked for MORE than the ARCH note; adversarial conceded on its own orphan-threat grounds).** Quality asked to kill the process GROUP (reap the CLI's stdio-MCP grandchildren) and to warn-at-boot/fail-at-use rather than crash on a bad registry row. **Resolved: adopt both** — the architecture note's own orphan threat model applies one level down (grandchildren), so process-group kill is the consistent choice (DES-029); one bad row degrading per-entry (not crashing every overnight schedule) is the self-sustainability pattern (DES-024). No in-process watchdog — restart stays on the supervisor (D-PROC line held).
- **D-V3h — `isLoopback` predicate + provision write-authority stricter default (adversarial #4/R7, quality neutral).** **Resolved:** one tested `isLoopback` (127.0.0.0/8 + ::1) replacing string equality (a `=== '127.0.0.1'` is simultaneously a `::1` false-reject and a prefix-match bypass risk); `mcp_provision` refuses when `bind != loopback` even with `insecureNoAuth` — RCE-grade write authority earns a stricter default than a read (DES-029). The guard is documented as NOT auth (D-BIND).
- **D-V3i — atomic secret resolution + fail-safe unprofiled-alias default (adversarial #3/#5).** **Resolved:** `resolveConfig` is all-or-nothing (mixed good/missing → `SECRET_MISSING`, nothing partial spawned — DES-025); an unprofiled alias defaults thinking-disabled (fail-safe, not fail-open) AND is caught at submission via `ALIAS_PROFILE_MISSING` (DES-026). Fail-safe > fail-open on both.
- **D-V3j — global semaphore is an injected composition-root instance, never a `static` (adversarial C1 internal, quality O-4 gauge).** **Resolved:** ONE `AgentSemaphore` built at the composition root, passed by reference into every RunGuard (true global rationing + injectable/resettable for UTs); a gauge (total/in-use/queued) rides the existing `workflow_status`/server-status response so starvation is observable and the release invariant is testable (DES-027/TASK-035). Gauge accepted over "speculative metrics" because it is the ONLY observable for the new global resource D-DOS itself introduces, on an existing response — no metrics stack.
- **D-V3k — ARCH-019 gets its own TASK/DES + a session-init re-walk (r2's one arbitrated item; adversarial #3 held-then-decided, quality conceded).** ARCH-019 (added at v3 Gate 2 to close REQ-021) had no TASK/DES — IMPL-080/UT-051 traced straight to REQ-021, skipping the decomposition layer. **Decomposed now:** TASK-038 (pure `findProjectMarkerAncestor` + `assertWorkRootIsolated` boot wrapper + `realpathSync` + boot wiring) / DES-031, and the existing IMPL-080/UT-051 re-threaded through them (surgical amendment, no stage rewind). The r2 open item — adversarial *held* the session-init re-walk pending one empirical repro, quality *conceded* it as its own self-sustainability nightmare — is **decided in favor of shipping the re-walk**: the underlying leak class was already empirically reproduced (the MEMORY.md echo that motivated REQ-021/ARCH-019), it is the *same one pure predicate at a second call site* (zero new subsystem, Karpathy-clean), and a boot-only guard against a runtime-mutable tree is a known false-security pattern. Chose **refuse-the-build** over quality's alternative of the engine planting a synthetic boundary marker (an active engine write into the agent workspace risks colliding with agent scripts). `settingSources`-never-`user`/`local` (Adv#8/R9) and `realpathSync`-not-`resolve` (Adv#5/R6) folded in as the two low-cost invariants guarding the disjoint global-memory and symlink-bypass leak classes.
- **Explicitly NOT built in v3 (both groups, Karpathy):** no vault/KMS secret backend (env/`LoadCredential` is the one real source; port ready for a real second backend), no provider SPI/plugin framework, no background MCP re-poller (provision-time + submission-time probes only — D-PROBE), no cross-run agent memory / prompt self-calibration / transcript compression, no in-process subprocess watchdog (supervisor owns restart), no discovery/enumeration endpoints (until auth), no OIDC (REQ-012 stays deferred — D5).

## v2 Decision rationale (contested / converged points)

- **D-V2a — run-origin observability WITHOUT touching v1 RunSpec** (quality observability ⟂ Gate-2 zero-v1-rework): quality wanted `triggeredBy` threaded end-to-end into the journal; that would modify the v1 `RunSpec`/`RunStore`/`RunManager` signatures. **Resolved:** the scheduler records `scheduleId→runId` in its OWN store and exposes `originOf(runId)`; origin is derived by join, fully observable, with ZERO v1 signature change. Quality conceded the journal-field ask in exchange for keeping the Gate-2 promise; observability goal still met.
- **D-V2b — asset live-probe: keep but inject** (adversarial testability/simplicity ⟂ REQ-009 + quality self-sustainability): adversarial preferred DROPPING the live probe for static classification (conflict-3, its strongest simplicity call); REQ-009's own acceptance and the dispatch explicitly require a live-probe validator. **Resolved (adversarial conceded the drop, kept the seam):** static `classifyTransport` gates first (pure, UT), then the REQ-mandated live probe runs behind an injected `McpProbe` port — UT-fakeable, real only at real-tier. Honors the REQ without a flaky UT dependency.
- **D-V2c — scheduler catch-up: fire-once, never backfill** (adversarial boundary ⟂ quality self-sustainability): quality floated durable backfill of every missed slot ("never miss a job"); adversarial argued fire-once-catch-up as the boundary-safe minimum. **Resolved to fire-once-on-catch-up (cron) / fire-immediately (one-shot):** never a backfill storm; the whole decision is pure inside `tick(now)` and UT-covered for the downtime case. Quality's stronger ask was the higher-value-claim but the simpler policy delivers equal REQ-015 satisfaction — simpler wins (Karpathy tie-break).
- **D-V2d — asset liveness: push-time-only, re-probe deferred** (quality self-sustainability ⟂ adversarial simplicity/no-auth-scope): quality wanted a lazy on-first-use re-probe for asset drift; adversarial resisted extra outbound traffic on an explicitly unauthenticated (D5) v2 service. **Resolved: push-time probe only for v2; asset drift documented as a known boundary, lazy re-probe deferred to v3 (post-auth).** Keeps the v2 attack surface unchanged and the design minimal.
- **D-V2e — GatewayClient parity: documented decision, no new build** (quality replaceability): quality flagged the two `GatewayClient` impls have drifted (abort/timeout/thinking wired inconsistently). **Resolved to option (b):** the `sdk`/direct-fetch path is the documented PRIMARY (per D-F5/D1, already real-verified), LiteLLM a constrained fallback — recorded explicitly rather than building a v2 parity contract-test (that touches v1 code; out of the zero-rework v2 scope). No DES item.
- **D-V2f — scheduler split, dashboard split, asset split along test seams** (adversarial task-splitting note, uncontested): TASK-019/024 (CRUD+resident vs clock/firing engine), TASK-020/025 (pure VM vs HTTP transport), TASK-021/026 (pure security core vs network probe) — each half has a distinct test seam and reviewer; lets the UT-heavy pure halves land fully tested even if the network/transport halves lag.
- **D-V2g — orphan-reap + port-config designed in, not carried forward** (both panels binding): the repeatedly-Gate-7.5-reproduced orphan-LiteLLM + port-4000 hazards become TASK-027 with real assertions in `smoke.sh`, rather than surviving as "known limitations" a third iteration.
- **D-V2h — schedule budget + overlap accepted-risk** (adversarial R1, agent-altitude self-sustainability): the single highest-value gap the just-run panel added — unattended cron/resident runs default to unbounded paid spend. **Resolved:** each `Schedule` arm carries an optional `budget` threaded into the SAME `RunManager.start` budget-enforcement path a manual run uses (the run spec already carries `budget?:number|null`, shipped), defaulting to a server-level cap when absent; overlap-allowed is kept but recorded as an EXPLICIT accepted risk (per-run budget + tunnel-gate are the compensating controls, skip-if-running deferred to v3-with-auth). Chosen over silence; simpler than a max-in-flight scheduler guard for a single-node QM tool.
- **D-V2i — dashboard XSS already structurally prevented; pagination deferred-safe** (adversarial KP-12/KP-6): the shipped page renders untrusted model output via `textContent`/`JSON.stringify` only (no `innerHTML`), so stored XSS is prevented by construction — recorded as a verifier invariant, no code change. Transcript pagination is a NON-breaking additive `?limit`/`?after` extension (optional query params), so deferring it now is safe (Karpathy: not speculative) — added only when a real long-run pain appears.
- **D-V2j — path/self-ref containment as TWO-TIER, with a shipped-code hardening item** (adversarial KP-7/KP-8, R2 HIGH given D5): the design mandates a pure fast-gate (`safeRelPath`/`isSelfReferential`, fully UT'd) PLUS an impure edge guard (`fs.realpath`-prefix / `O_NOFOLLOW` at write time; loopback-set normalization for self-ref). **Honest shipped state:** the current `src/asset-sync.ts` implements the pure string gates only (no realpath symlink guard; a bare-string self-ref compare that under-rejects `localhost`≡`127.0.0.1`). The tunnel-gate (D5/C4, DES-022) is the deployment-level compensating control that bounds severity for v2, but these two are carried as a **v2.1 asset-containment hardening backlog item** (target-tier tests: planted-symlink integration + `localhost`-vs-`127.0.0.1` self-ref real case) rather than closed — flagged, not silently equated to done.
- **D-V2k — asset size/count caps** (adversarial KP-13): per-file + per-push byte caps → `ASSET_TOO_LARGE`, mirroring v1's 512 KB script cap; cheap DoS/disk-fill boundary on a no-auth surface. Design requirement added; carried with D-V2j as the same v2.1 asset-hardening item where not yet in shipped code.
- **D-V2l — closed error-code union** (adversarial KP-1, both lenses agreed): the free-form `code` string becomes a documented closed union (`INVALID_CRON|AT_UNPARSEABLE|WORKFLOW_NOT_FOUND|SCHEDULE_NOT_FOUND|SCHEDULE_DISABLED|ALREADY_COMPLETED`; asset side `PATH_ESCAPE|SELF_REFERENTIAL|ASSET_TOO_LARGE|MCP_UNSUPPORTED|MCP_UNREACHABLE`) so an agent caller branches retryable-vs-terminal without string-matching — satisfies the contract-uniformity AND boundary-taxonomy lenses at once. Shipped scheduler codes already conform; formalized here.
- **D-V2m — TASK-019 clock-seam note corrected (KP-15)** (adversarial testability, seam consistency): the stale "no clock needed" note contradicted DES-016/017 and the shipped `create` (which computes an initial `nextFire` via the injected Clock). Resolved via option (ii): CRUD takes the injected `Clock` and stamps `nextFire`/`lastFire` through it, delegating the cron math to `computeNextFire` — every scheduler method that reads time uses the injected Clock, no bare `Date.now()` (Exit-Gate-5). Note fixed in 03-tasks.md.
- **Explicitly NOT built in v2** (both groups, Karpathy): no pluggable scheduler backend (in-process cron suffices for single-node QM), no store event-bus (poll the RunStore port), no schedule-status dashboard panel (MCP `schedule_list` tool is the v2 observability surface; dashboard schedule view deferred), no agent-prompt hot-reload, no background asset re-poller.

## Template (reference — not a work item)
<!-- TEMPLATE EXAMPLE (uncommented by the stage agent when writing real items)
    ### DES-001 — <interface/function/data-model name>
- **status:** draft
- **traces:** ARCH-001, TASK-001
- **signature:** <interface signature / schema / flow notes>
- **iter:** v1
-->
## Class diagram
<!-- Use classDiagram for design; add a sequenceDiagram for key flows. The dashboard auto-renders and cites the source -->
```mermaid
classDiagram
  class McpFacade {
    +workflow_run(a) ResultEnvelope
    +workflow_status(a) ResultEnvelope
    +workflow_result(a) ResultEnvelope
    +workflow_suspend/resume/stop(a) ResultEnvelope
    +workflow_list(a) ResultEnvelope
    +workflow_agent_log(a) ResultEnvelope
  }
  class SubmissionValidator {
    +validate(spec) OkOrErrors
  }
  class RunManager {
    +start(spec) runId
    +suspend/resume/stop(runId)
    +status(runId) RunStatusView
  }
  class RunGuard {
    +concurrency int
    +acquireSlot() release
    +nextAgentId() string
    +addTokens(delta)
    +budgetView() Budget
    +assertBudget()
  }
  class SandboxHost {
    +spawnChild(runId)
    -restrictedVmContext WorkflowApi
  }
  class WorkflowApi {
    +agent(prompt, opts)
    +parallel(thunks)
    +pipeline(items, stages)
    +phase/log()
    +args
    +budget Budget
    +workflow(ref, args)
  }
  class AgentExecutor {
    +run(req) AgentOutcome
  }
  class AgentSpawner {
    <<interface>>
    +run(req) AgentOutcome
  }
  class TranscriptSink {
    +capture(ev)
  }
  class GatewayClient {
    <<interface>>
    +invoke(req) GatewayResult
  }
  class LiteLLMGatewayClient {
    +invoke(req) GatewayResult
    -aliasMap AliasMap
    -keys secret
  }
  class RunStore {
    <<interface>>
    +createRun(spec)
    +appendJournal(runId, e)
    +appendTranscript(runId, agentId, ev)
    +recordTransition(runId, from, to, ts)
    +getRun/listRuns/hydrateAll()
  }
  class WorkflowCatalog {
    +register/get/list(name)
    +workFolder(name)
    +runWorkspace(name, runId)
    +resolveInWorkspace(runId, rel)
  }
  class Clock {
    <<interface>>
    +now() int
    +isoNow() string
  }
  McpFacade --> SubmissionValidator
  McpFacade --> RunManager
  McpFacade --> RunStore : reads
  RunManager --> RunGuard
  RunManager --> SandboxHost : spawn + IPC
  RunManager --> AgentExecutor
  RunManager --> RunStore
  RunManager --> WorkflowCatalog
  SandboxHost --> WorkflowApi : exposes
  WorkflowApi ..> RunManager : IPC seam only
  AgentExecutor ..|> AgentSpawner
  AgentExecutor --> GatewayClient
  AgentExecutor --> TranscriptSink
  AgentExecutor --> RunGuard : addTokens
  TranscriptSink --> RunStore
  LiteLLMGatewayClient ..|> GatewayClient
  RunStore --> Clock : timestamps
  RunManager --> Clock

  %% --- v2 extension modules (attach at v1 seams) ---
  class SchedulerPort {
    <<interface>>
    +create(s) ResultEnvelope
    +list() ScheduleStatus[]
    +setEnabled(id, on)
    +delete(id)
    +trigger(workflow, args) ResultEnvelope
    +originOf(runId) origin
  }
  class FiringEngine {
    +tick(schedules, now) ScheduleFiring[]
    +computeNextFire(cron, tz, after) int
    +bootRearm(clock)
  }
  class Ticker {
    <<interface>>
    +start(cb)
    +stop()
  }
  class Dashboard {
    +buildDashboardModel(runs, view, tr) DashboardVM
    +GET /api/runs (read-only)
  }
  class AssetSync {
    +asset_push(a) ResultEnvelope
    +asset_list()
    +asset_delete(a)
    -isSelfReferential() D4 guard
    -safeRelPath() root guard
  }
  class McpProbe {
    <<interface>>
    +probe(cfg) OkOrReason
  }
  McpFacade --> SchedulerPort : schedule/trigger tools
  McpFacade --> AssetSync : asset tools
  SchedulerPort --> WorkflowCatalog : validate name
  SchedulerPort --> RunManager : start (same path)
  SchedulerPort --> Clock
  FiringEngine --> Ticker
  FiringEngine --> Clock
  SchedulerPort --> FiringEngine
  Dashboard --> RunStore : reads (poll, read-only)
  AssetSync --> WorkflowCatalog : workspace root
  AssetSync --> McpProbe : mcp-config validate

  %% --- v3 slice modules (attach at v1/v2 seams) ---
  class McpRegistry {
    +register(rec) Result
    +get(name) McpProvisionRecord
    +list() McpProvisionRecord[]
    +resolveInjected(names) configsOrError
  }
  class SecretResolver {
    +resolveConfig(config, source) resolved
    +redact(event, values) event
  }
  class SecretSource {
    <<interface>>
    +resolve(handle) value
    +names() string[]
  }
  class SessionOptionsBuilder {
    +buildSessionOptions(class, alias, config, refs, secrets) SDKOptions
    -ProviderProfile table
  }
  class OuterRace {
    +race(query, timeoutMs) resultOrNull
    -FailureEnvelope
    -SessionInitRecord
  }
  class AgentSemaphore {
    +withSlot(fn) T
    +gauge() SlotGauge
  }
  class CliLifecycle {
    +spawnDetached(cmd, args) ChildHandle
    +killGroup(h)
    +cleanupTemp(h)
  }
  class AssetIngestionPolicy {
    +classifyAsset(kind, asset) Disposition
  }
  McpFacade --> McpRegistry : mcp_provision (loopback-guarded)
  McpRegistry --> McpProbe : provision-time probe
  McpRegistry --> RunStore : sibling catalog
  GatewayClient --> SessionOptionsBuilder : builds SDKOptions (inside impl)
  GatewayClient --> OuterRace : bounded race + kill
  SessionOptionsBuilder --> McpRegistry : resolveInjected (strict)
  SessionOptionsBuilder --> SecretResolver : resolvedSecrets
  SecretResolver --> SecretSource : preloaded at startup
  OuterRace --> AgentSemaphore : withSlot (free-once)
  OuterRace --> CliLifecycle : killGroup on timeout
  OuterRace --> Clock : timeout bound
  AgentSemaphore ..> RunGuard : one global instance (composition root)
  TranscriptSink --> SecretResolver : redact at capture
  AssetSync --> AssetIngestionPolicy : classify
  AssetIngestionPolicy --> McpRegistry : mcp-config redirect
```

### DES-032 — listArtifacts / readArtifactChunk (src/workspace-artifacts.ts)
- **status:** done
- **traces:** TASK-039, TASK-040
- `listArtifacts(workspace): {path,size,sha256}[]` (recursive, isPathContained-skip); `readArtifactChunk(workspace,relPath,offset?,length?,maxChunk=1MiB): {path,size,offset,length,eof,base64}|{error:'PATH_OUTSIDE_WORKSPACE'|'NOT_A_FILE'}` (positioned read).
### DES-033 — readBody cap (src/server.ts)
- **status:** done
- **traces:** TASK-041
- `readBody(req, maxBytes=8MiB)`: discards past cap (bounded memory), rejects BodyTooLargeError → 413.
### DES-034 — materializeSeed (src/workspace-seed.ts)
- **status:** done
- **traces:** TASK-042
- `materializeSeed(workspace, {path,contentB64}[]): {written,stripped,rejected}`; STRIP_RE for `.claude/settings*.json|hooks/**`; isPathContained + `.git` reject.
### DES-035 — RunSpec.seed + RunManager.start materialization
- **status:** done
- **traces:** TASK-042
- RunSpec.seed threaded from workflow_run; materialized before _runLive (replay-safe).
### DES-036 — reclaimStaleWorkspaces + workspace_purge (src/workspace-gc.ts, McpFacade)
- **status:** done
- **traces:** TASK-043
- `reclaimStaleWorkspaces(workRoot,ttlMs,statusOf,nowMs): reclaimedIds` (TERMINAL+old only); `McpFacade.workspace_purge` (terminal-only, idempotent).
### DES-037 — IssueReporter / GithubIssueClient / renderIssueBody (src/github/issue-reporter.ts)
- **status:** done
- **traces:** ARCH-023, TASK-044, TASK-059
- **iter:** v11
- `IssueReporter.report(input: IssueReportInput): Promise<IssueReportResult>` — validates required `[title, reproSteps, analysis]` (missing/empty → `{ok:false,error:{code:'ISSUE_REPORT_INVALID', field}}`, no GitHub call), resolves the token via `SecretSource.resolve('GITHUB_TOKEN')` (absent/empty → `GITHUB_TOKEN_MISSING`), renders the body, calls the client; any client failure is caught and returned as `{ok:false,error:{code:'GITHUB_API_ERROR', message}}` — never throws across the tool boundary. Success → `{ok:true, issueNumber, url}`.
- `createGithubIssueClient(opts:{token,repo,fetchImpl?,timeoutMs?,retries?}): GithubIssueClient` — bounded `POST {api}/repos/{repo}/issues` per attempt: AbortController `timeoutMs` (default 10000) + `retries` budget (default 1); non-2xx/network/timeout → `GithubApiError` (code `GITHUB_API_ERROR`, carries HTTP `status`); 4xx except 429 is not retried.
- **v11 (REQ-066) version field.** `IssueReportInput` gains optional `version?: string`. `report()` computes the EFFECTIVE version `const version = input.version?.trim() || this.cfg.engineVersion || 'unknown'` (caller-supplied wins; else the engine's own running version; never empty) and threads it into `renderIssueBody`'s `meta.version`.
- `resolveEngineVersion(exec?: (cmd:string)=>string): string` — NEW pure-ish seam: `` `${pkg.version}` `` from `package.json`, best-effort appended with `git describe --tags --always` (via the injectable `exec`, e.g. `execSync`); fallback chain = `pkg.version + " (" + gitDescribe + ")"` → `pkg.version` alone (on any git failure) → `'0.0.0'` (never empty). Computed ONCE at the composition root to build `engineVersion`, REPLACING the hardcoded `ENGINE_VERSION = '1.0.0'` in `src/server.ts`. Injectable `exec` makes it unit-testable (fake git output; git-absent fallback). Do NOT add `GET /api/version` here (that is REQ-070, Sprint 2, out of scope) — leave the helper reusable.
- `renderIssueBody(input, meta:{version, nowIso, ...}): string` — FIXED template with labelled sections `## Summary` / `## Reproduction steps` / `## Logs` / `## Analysis / root cause` / `## Environment` / `## Linked run` (only when `runId`). **v11 (REQ-066):** the `## Environment` section renders ALL FIVE report fields on labelled lines so none is ever missing — `- Version: <version>`, `- severity: <severity | _none_>`, `- component: <component | _none_>`, `- reported at: <nowIso>` (Logs and Analysis stay their own sections; logs already placeholders `_none provided_`). The `- Version:` line makes the acceptance substring `Version: <v>` present verbatim for both caller-supplied and engine-filled versions. (`meta.engineVersion` is renamed/superseded by `meta.version` = the effective version.)
- typed error codes: `ISSUE_REPORT_INVALID` (bad request), `GITHUB_TOKEN_MISSING` (secret unset), `GITHUB_API_ERROR` (bounded API failure).
- Boundary/error (REQ-066): caller `version` present-but-whitespace → treated as omitted (falls back to engine version); engine version never empty (package.json always present); a caller `version:"v1.4.0"` → body contains `Version: v1.4.0`, an omitted version → body contains the engine's own non-empty version string. Testability: `renderIssueBody` and `resolveEngineVersion(fakeExec)` are pure UTs; no GitHub call needed to assert the rendered body.
- injection seam: `ServerConfig.issueReporter?` — tests inject a real IssueReporter over a fake GithubIssueClient (or bypass fetch via `clientImpl`); prod composition root builds `new IssueReporter({ secretSource: loadSecretSourceFromEnv(), engineVersion: resolveEngineVersion() })`. Fixed repo `HsuJavis/remote-workflow-engine`; `issue_report` inputSchema requires `[title, reproSteps, analysis]` and accepts optional `version`.

### DES-038 — GithubIssueClient read/write extension + IssueReporter ops + dedup/enrichment (src/github/issue-reporter.ts, src/server.ts)
- **status:** done
- **traces:** ARCH-024, TASK-045, TASK-060
- **iter:** v11
- `GithubIssueClient` extended (shared bounded-fetch `ghFetch`): `getIssue(number): Promise<IssueView|null>`, `listIssues(filter: IssueListFilter): Promise<IssueSummary[]>`, `getComments(number): Promise<CommentView[]|null>`, `createComment(number, body): Promise<{commentId,url}|null>`, `findOpenByFingerprint(fp): Promise<number|null>` — 404→`null` on get/comments/createComment, other non-2xx→`GithubApiError` (`GITHUB_API_ERROR`), retry only on 5xx/429/network. New types `IssueView` / `IssueSummary` / `CommentView` / `IssueListFilter`.
- `IssueReporter` ops (each: token unset→`GITHUB_TOKEN_MISSING`; catch→`GITHUB_API_ERROR`; never throws across the tool boundary): `getIssue(number): Promise<IssueGetResult>` (client `null`→`ISSUE_NOT_FOUND`), `listIssues(filter): Promise<IssueListResult>`, `getComments(number): Promise<IssueCommentsResult>` (`null`→`ISSUE_NOT_FOUND`), `postComment(number, body): Promise<IssueCommentResult>` (empty body→`ISSUE_COMMENT_INVALID{field:'body'}`, `null`→`ISSUE_NOT_FOUND`, success→`{commentId,url}`).
- `report()` upgrades: REQ-035 dedup — `issueFingerprint(title, component?): string` (sha256) + a hidden `<!-- rwe-fp:<fp> -->` body marker; a matching OPEN issue from `findOpenByFingerprint`→`createComment` returns `{...,deduped:true}`, else new issue (`deduped:false`). REQ-036 enrichment — when `IssueReporterConfig.runDiagnostics?: (runId)=>Promise<string|null>` is present and `input.runId` is set, its output enriches the `## Linked run` section; best-effort (`.catch(()=>null)`, never fails the report).
- typed error codes (this slice): `ISSUE_NOT_FOUND`, `ISSUE_COMMENT_INVALID` (+ reused `GITHUB_TOKEN_MISSING` / `GITHUB_API_ERROR`).
- server.ts: `issue_get` / `issue_list` / `issue_comments` / `issue_comment` in TOOL_NAMES + TOOL_METADATA + `callTool` cases; facade-backed `runDiagnostics` (workflow_status + artifact list + last-agent transcript tail) wired into the default IssueReporter; `issue_report` result carries `deduped`.
- **v11 (REQ-067) read-only Issues dashboard** — DISPLAY-only (no report form), sourced from the EXISTING `IssueReporter.listIssues`/`getIssue`, riding the DES-018 `handleDashboardRequest` read-only transport (one data model, two transports):
  - `GET /api/issues` — ONE `issueReporter.listIssues({ labels:['agent-reported'], state:'all' })`, partitioned into `{ open: IssueSummary[], resolved: IssueSummary[] }` by `s.state === 'open'` (else resolved). On `{ok:false}` for ANY reason (`GITHUB_TOKEN_MISSING`/`GITHUB_API_ERROR`) → HTTP **200** `{ open:[], resolved:[], degraded:'GitHub not configured' }` — never a 500/crash, so the rest of the dashboard still loads. VM shape: `IssuesVM { open: IssueSummary[]; resolved: IssueSummary[]; degraded?: string }` (`IssueSummary` already carries number/title/state/labels/url — severity is read off `labels` client-side).
  - `GET /api/issues/:number` (`issuesDetailMatch = /^\/api\/issues\/(\d+)$/`) — `issueReporter.getIssue(Number(n))` → 200 `IssueView` (body, labels, commentCount, url) on `{ok:true}`; `ISSUE_NOT_FOUND` → 404; token-missing/API-error → 200 `{ degraded:'GitHub not configured' }` (never 500).
  - `handleDashboardRequest` gains an `issueReporter: IssueReporter` parameter (threaded from the composition root, same instance as `callTool`'s); the `/api/issues` + `/api/issues/:number` branches sit alongside the existing `/api/runs`/`/api/workflows` branches.
  - Router widening (`src/server.ts` ~:996, the ARCH-029 pattern): the top-level dispatch predicate becomes `startsWith('/api/runs') || startsWith('/api/workflows') || startsWith('/api/issues')` — without the `|| … '/api/issues'` clause the route falls through to `/mcp` and returns JSON-RPC `-32601` (the exact routing gap caught at Gate 7.5 for `/api/workflows`, IT-048).
  - Dashboard page (`src/dashboard-page.ts`): a new READ-ONLY Issues view — an "Issues" nav link, an `Open` group and a `Resolved` group (each entry `#<number> · <title>` linking to its GitHub `url`, showing severity/status from labels), and a click-to-detail panel fetching `/api/issues/:number` (body, labels, comment count, GitHub link). No form, no write. **Route disambiguation:** the Issues view uses a DISTINCT path segment `/dashboard/issues`, and `currentRunId()` MUST special-case `issues` (treat `/dashboard/issues` as the Issues view, NOT as a run id `"issues"` fed to `/api/runs/issues/dag`) — otherwise it collides with the `/dashboard/<runId>` SPA route. **XSS invariant (KP-12, extends DES-018):** issue title/body/labels are remote, model-/user-authored content on the unauthenticated dashboard — inject via `textContent`/`JSON.stringify` only, NEVER `innerHTML`; a `<script>`-bearing issue body renders escaped (verifier asserts).
- typed error codes (v11 read path): reused `GITHUB_TOKEN_MISSING` / `GITHUB_API_ERROR` (both collapse to the 200 `degraded` VM), `ISSUE_NOT_FOUND` (→ 404 on detail).
- Boundary/error (REQ-067): 2 open + 1 closed `agent-reported` issues → `/api/issues` returns 2 under `open`, 1 under `resolved`, each with its GitHub `url`; no token → both endpoints return the `degraded` notice at HTTP 200 and the dashboard's other pages keep working; `GET`-only (the read-only 405 guard already covers non-GET). Testability: `handleDashboardRequest` over an InMemory/fake `IssueReporter` (fake GithubIssueClient) is a UT/integration seam — no live GitHub needed for the partition/degrade logic.
- **Real-tier validation & per-tier mock policy (REQ-066/067, extends DES-015/023).** Real entrypoint(s): the running MCP server + `issue_report` tool (REQ-066) and the read-only dashboard HTTP server + `/api/issues*` + `/dashboard/issues` (REQ-067), both on 127.0.0.1 against the engine's own GitHub repo via a real PAT (`RWE_SECRET_GITHUB_TOKEN`). Per-REQ real path: **REQ-066** — live engine, `issue_report` WITH `version:"v1.4.0"` → the created issue body contains `Version: v1.4.0`; `issue_report` OMITTING version → the body contains the engine's own non-empty running version (from `resolveEngineVersion()`); assert all five fields (repro/version/severity/analysis/log) present in the rendered body (matches the VAL-036..045 live-issue precedent). **REQ-067** — live engine seeded with ≥2 open + 1 closed `agent-reported` issues → a browser/Playwright loads `/dashboard/issues`, sees 2 under Open + 1 under Resolved each linking to its GitHub url, and a click renders detail (body/labels/comment count/url); then boot with NO GitHub token → the Issues page shows the "not configured" notice and the rest of the dashboard still loads (no 500). Per-tier mock policy: **unit** may mock freely — fake `GithubIssueClient`, injected `resolveEngineVersion` `exec`, InMemory store — isolating `renderIssueBody`/version-resolution/partition/degrade logic; **integration** = the real dashboard HTTP server + `handleDashboardRequest` over a fake `GithubIssueClient` (real transport, real routing/degrade, third-party GitHub network the only thing faked); **E2E/acceptance MUST NOT mock the SUT's own boundaries** — no faking the HTTP server, the router, the IssueReporter, or the dashboard page; GitHub is reached for real through the engine's own repo + test PAT (third-party network via sandbox credentials, allowed). This lets Gate 7.5 actually file + display a real issue and blocks mock-only false-green.

### DES-039 — Provider-aware SDK subprocess env + OpenRouter provider/passthrough (src/gateway/claude-agent-sdk-client.ts, src/gateway/client.ts, src/gateway/litellm-proxy.ts, src/submission-validator.ts, src/main.ts)
- **status:** done
- **traces:** ARCH-025, TASK-046
- **iter:** v7
- `buildSubprocessEnv(...)` is provider-aware: provider `anthropic` → `ANTHROPIC_BASE_URL` = the REAL Anthropic API (LiteLLM bypassed) plus `resolveAnthropicAuth(...)`; any other provider → `ANTHROPIC_BASE_URL` = the managed LiteLLM proxy with the existing dummy key. Auth secrets are read from the injected `secretSource` and written ONLY into the returned SDK-subprocess env.
- `resolveAnthropicAuth(anthropicAuth, secretSource)`: mode `api-key` → set real `ANTHROPIC_API_KEY` (never the dummy); mode `subscription` → set `CLAUDE_CODE_OAUTH_TOKEN` and DO NOT set `ANTHROPIC_API_KEY`; required secret absent → typed `ANTHROPIC_AUTH_MISSING` (no silent dummy-key fallback).
- `isPassthroughModel(model)` / `effectiveProvider(alias, model)`: an `openrouter/<id>` passthrough model string is NOT rewritten/alias-cloaked through the rwe proxy — it is passed RAW so LiteLLM's `openrouter/*` wildcard matches; its effective provider is the `openrouter` prefix (so routing/auth pick the LiteLLM path + `OPENROUTER_API_KEY`).
- `src/gateway/client.ts`: `openrouter` added to the provider union + a direct-fetch `openrouter` case (OpenAI-format request to `openrouter.ai` using `OPENROUTER_API_KEY`).
- `src/gateway/litellm-proxy.ts`: the generated LiteLLM config gains a native wildcard `openrouter/*` route (reads `OPENROUTER_API_KEY`).
- `src/submission-validator.ts`: an `openrouter/<id>` passthrough model string is accepted (not falsely flagged `UNKNOWN_ALIAS`).
- `src/main.ts`: threads `anthropicBaseUrl` / `anthropicAuth` + `secretSource` into the SDK gateway.

### DES-040 — Federated model catalog + `models_list` tool (src/models/model-catalog.ts, src/server.ts)
- **status:** done
- **traces:** ARCH-026, TASK-047
- **iter:** v7
- `ModelEntry` type — the unified normalized shape `{provider, model, alias?, description, modalities:{in:[…],out:[…]}, contextWindow, price(in/out | "free" | "unknown"), toolUse(bool | "unknown"), location:"local"|"remote"}`.
- `buildCatalog(deps)` — federates the static openai/anthropic table + live Ollama `/api/tags` (local) + live OpenRouter `/api/v1/models` (remote; maps metadata incl. tool support from `supported_parameters`) + the curated-alias overlay into one `ModelEntry[]`; the live fetchers are injectable; each source degrades gracefully (an unreachable live source drops only its own entries, curated/static still return); output is secret-free (no key value ever surfaces).
- `filterCatalog(entries, filter)` — AND-filter over `{provider, query, modalityIn, modalityOut, maxPricePerM, minContext, toolUse, location}` + `limit` (sane default/hard cap); empty match → `[]`.
- `src/server.ts`: `models_list` in TOOL_NAMES + TOOL_METADATA/schema (all filter params) + a `callTool` case delegating to `buildCatalog`→`filterCatalog`; ServerConfig exposes injectable catalog seams (the live fetchers) for tests.

### DES-041 — N-level nested `workflow()` recursion + 3 composition guards + frame-based journal keying (src/run-manager.ts)
- **status:** done
- **traces:** ARCH-027, TASK-048
- **iter:** v8
- `RunEntry` gains nesting state (`src/run-manager.ts:95-100`): `name?`, `descendants: number` (per-run total-descendant counter), `nestedFrames: Map<string, number>` (frame-path → allocated callSeq base), `nestedFrameSeq: number` (monotonic frame allocator) — initialized in both entry constructions (`start()` ~:214-223, `_requireLive()` ~:322-331) and reset in `resume()` (~:249-254) so replay re-derives frames deterministically.
- `_newSandbox(runId, workspace, topName?)` (`src/run-manager.ts:343-350`) seeds the TOP-level `onWorkflowRequest` with the base nesting context: `depth = 1`, `ancestors = new Set(topName ? [topName] : [])`, `parentPathKey = ''`.
- `_handleWorkflowRequest(runId, ref, args, parentPathKey, parentCallSeq, depth, ancestors)` (`src/run-manager.ts:407`) — the recursive nested-run boundary. Guards run in order BEFORE catalog resolution / execution, each throwing `codedError(code, message)` (`src/run-manager.ts:66`) so the sandbox receives a typed, branchable envelope (never a crash): `depth > this._maxWorkflowDepth` → `NESTING_DEPTH_EXCEEDED` (`:421-422`); `ancestors.has(name)` → `NESTING_CYCLE` (`:425`); `(entry.descendants += 1) > this._maxWorkflowDescendants` → `DESCENDANT_CAP_EXCEEDED` (`:427-428`). It then resolves the catalog entry, allocates a nested-frame base via `_frameBaseFor`, and builds the nested `SandboxHost` WITH its own `onWorkflowRequest` recursing at `depth + 1` with the extended `childAncestors` set (`:445`) and `onAgentRequest` namespaced under `frameBase + callSeq` — so the child shares the SAME parent `RunEntry`/`RunGuard` (shared-budget invariant, no per-level reset).
- `_frameBaseFor(entry, pathKey)` + `NESTED_FRAME_STRIDE = 1_000_000` (`src/run-manager.ts:367-373`): additive per-frame base allocation — first touch of a `pathKey` assigns `base = (entry.nestedFrameSeq += 1) * NESTED_FRAME_STRIDE` and memoizes it in `entry.nestedFrames`; repeat touches (resume) return the memoized base. REPLACES the old multiplicative `(parentCallSeq+1)*1e6+n` scheme that overflowed `MAX_SAFE_INTEGER` past ~depth 2. `pathKey` is derived deterministically from `parentPathKey` + `parentCallSeq`, and frames are first-touched in deterministic execution order (incl. `parallel()` array order), so the allocation is identical across resume → callSeq keys stay globally unique and within `MAX_SAFE_INTEGER` at arbitrary depth.
- typed error codes (this slice): `NESTING_DEPTH_EXCEEDED`, `NESTING_CYCLE`, `DESCENDANT_CAP_EXCEEDED`.
- See the `## v8 Decision rationale` at the foot of this file for the additive-vs-multiplicative keying decision and the diamond-vs-cycle distinction.

### DES-042 — Config caps + construction-time validation + config threading (src/run-manager.ts, src/server.ts, src/main.ts)
- **status:** done
- **traces:** ARCH-027, TASK-048
- **iter:** v8
- `RunManagerDeps` gains `maxWorkflowDepth?: number` / `maxWorkflowDescendants?: number` (`src/run-manager.ts:56-59`); `RunManager` stores `_maxWorkflowDepth` / `_maxWorkflowDescendants` (`:115-116`).
- `RunManager._positiveInt(value, fallback, name): number` (`src/run-manager.ts:121`) — static config-load validator: an out-of-range/invalid value (≤0 or non-integer) is REJECTED at construction with a clear message naming the offending key; an absent/undefined value takes the fallback. Applied at construction: `maxWorkflowDepth` default **4**, `maxWorkflowDescendants` default **256** (`:141-142`).
- `ServerConfig` gains `maxWorkflowDepth?` / `maxWorkflowDescendants?` (`src/server.ts:92-93`), threaded into `new RunManager({..., maxWorkflowDepth: config?.maxWorkflowDepth, maxWorkflowDescendants: config?.maxWorkflowDescendants})` (`src/server.ts:656`).
- `src/main.ts` `composeConfig` forwards both from `FileConfig` (extends `Partial<ServerConfig>`) into the ServerConfig (`src/main.ts:131-132`); `rwe.config.example.json` documents `"maxWorkflowDepth": 4` / `"maxWorkflowDescendants": 256`.

### DES-043 — read-model shapes + frame-threading through the agent-transcript capture path (src/types.ts, src/agent-executor.ts)
- **status:** done
- **traces:** TASK-049
- **iter:** v8
- Read-model shapes (`src/types.ts`): `AgentRecord` gains optional `frame?: string` (`src/types.ts:60`) — `""` for the top-level script's own agents, a non-root frame for a nested `workflow()`'s agents whose parent frame is a strict prefix; absent on pre-v8 records (back-compat). New `WorkflowNodeView { frame: string; name: string; parentFrame: string; depth: number }` (`src/types.ts:70-75`) — one per nested `workflow(name)` call: `frame` equals the frame its own inner agents carry, `parentFrame` is the caller's frame (`""` at top), `depth` 1-based. `RunStatusView.workflowNodes: WorkflowNodeView[]` is now a REQUIRED field (`src/types.ts:83`) — every read-model producer supplies it (empty array where no tree data, see DES-044).
- Frame stamped at queue time, not capture time (`src/agent-executor.ts`): `AgentTranscriptSink.markQueued(agentId, label?, phase?, frame?)` records the `frame` on the queued record the moment the agent is enqueued (`src/agent-executor.ts:119-121`), so `workflow_status` shows a frame-tagged node while the agent is still `queued`/`running` (REQ-047's "current step = the running node(s)"). `capture()` then reads the frame back off that queued record and carries it FORWARD onto the final `AgentRecord` on BOTH the ok and failed branches (`src/agent-executor.ts:135, 140, 152`) — so the frame survives regardless of agent outcome. `AgentExecutor.markQueued(agentId, label?, phase?, frame?)` delegates the frame straight through to the sink (`src/agent-executor.ts:275-276`); the `AgentSpawner` seam signature is extended with the optional `frame?` so RunManager can pass it (DES-044) without touching the capture internals.
- Boundary: this DES owns the DATA shape + the executor-side frame carry; it does NOT decide frame VALUES — those are the ARCH-027 frame-path keys threaded in by RunManager (DES-044). `mcp-facade.ts` is unchanged: `workflow_status` already returns the whole `RunStatusView` as its `result`, so both new fields reach clients with no facade edit.

### DES-044 — frame-threading + boundary-node recording + read-model exposure in RunManager (src/run-manager.ts) + persisted-path defaults (src/run-store.ts, src/store/sqlite-run-store.ts)
- **status:** done
- **traces:** TASK-049
- **iter:** v8
- `RunEntry` gains `workflowNodes: WorkflowNodeView[]` (`src/run-manager.ts:103`), the per-run live boundary-node list — initialized `[]` in both entry constructions (`start()` ~:227, `_requireLive()` ~:337) and RESET to `[]` in `resume()` (`src/run-manager.ts:259`) so a replay re-derives nodes deterministically rather than double-appending. Imports `WorkflowNodeView` from `./types.js` (`src/run-manager.ts:14`).
- Frame threading into agents: `_handleAgentRequest(runId, prompt, opts, callSeq, framePath = '')` takes the frame as a defaulted trailing arg and passes it to `entry.spawner.markQueued(agentId, key.opts.label, key.opts.phase, framePath)` (`src/run-manager.ts:464, 489`). The TOP-level sandbox's `onAgentRequest` passes `''` (root frame) (`src/run-manager.ts:355`); the NESTED sandbox's `onAgentRequest` (built inside `_handleWorkflowRequest`) passes that frame's `framePathKey` (`src/run-manager.ts:449-450`) — so every agent is stamped with exactly the ARCH-027 frame it ran under.
- Boundary-node recording: inside `_handleWorkflowRequest` (`src/run-manager.ts:413-`), after computing `framePathKey = \`${parentPathKey}.${parentCallSeq}\`` (`:438`), it pushes `{ frame: framePathKey, name, parentFrame: parentPathKey, depth }` onto `entry.workflowNodes` (`src/run-manager.ts:442`) — reusing the SAME frame-path key ARCH-027 already allocates for journal namespacing (one source of frame identity; `frame` here == the frame its inner agents carry via the nested `onAgentRequest` above). `depth` is the recursion depth already carried by the boundary.
- Read-model exposure: `_mergeLive` returns `workflowNodes: entry.workflowNodes` alongside the already-merged live `phases`/`agents` (`src/run-manager.ts:284`), so a `workflow_status` on a live/just-completed run gets the full node list.
- Persisted/derived path default (out-of-scope-for-this-increment marker): the store `getRun()` read-models return `workflowNodes: []` — `src/run-store.ts:137` and `src/store/sqlite-run-store.ts:170` — because cross-restart tree persistence is deferred (the tree is reconstructed live from `entry.workflowNodes`, which is per-process). This keeps `RunStatusView.workflowNodes` a satisfiable required field on every producer without inventing persisted-tree state this increment.
- See the `## v8 Decision rationale` at the foot of this file for the stamp-at-queue-time and reuse-the-journal-frame-key decisions and the deferred-persistence scope call.

### DES-045 — pure call-tree model `buildDagModel(RunStatusView) → DagNode` + `DagNode`/`DagAgentNode` shapes (src/dashboard.ts)
- **status:** done
- **traces:** TASK-050
- **iter:** v8
- Shapes (`src/dashboard.ts:16-30`): `DagAgentNode { agentId: string; label?: string; state: AgentRecord['state']; model: string; tokens: number }` (an agent leaf; `tokens` is the FLATTENED `input+output` sum, not the split object) and `DagNode { kind: 'root' | 'workflow'; frame: string; name?: string; depth: number; agents: DagAgentNode[]; children: DagNode[] }` (a tree node — the root carries `kind:'root'`, `frame:""`, `depth:0`, `name` absent; each composite carries `kind:'workflow'`, its `frame`, `name`, 1-based `depth`).
- `buildDagModel(view: RunStatusView): DagNode` (`src/dashboard.ts:38-53`) — PURE, no I/O, never throws, never mutates `view`, never drops an agent. Algorithm: (1) seed a root `DagNode` and a `byFrame` map `{ "" → root }` (`:39-40`); (2) sort a COPY of `view.workflowNodes ?? []` depth-ASCENDING (`:42`) so a parent-frame node is always in `byFrame` before its children are attached, then for each boundary node build its `DagNode`, register it in `byFrame`, and push it onto `(byFrame.get(parentFrame) ?? root).children` (`:43-47`) — the `?? root` is the total-function guard for an orphan parentFrame; (3) for each agent, look up `byFrame.get(a.frame ?? '') ?? root` and push a `DagAgentNode` (`:48-51`) — the ROOT FALLBACK guaranteeing an agent whose frame has no matching node is attached to root, not dropped. Returns the root.
- Boundary: consumes exactly the ARCH-028/DES-043 read-model fields (`agents[].frame`, `workflowNodes[]`) — decides no frame VALUES, only reshapes. Shared by DES-046's `/api/runs/:id/dag` endpoint AND the dashboard page's `renderNode` (one tested model, no parallel tree logic). Sits alongside the existing `buildDashboardModel` in the same file; `buildDashboardModel` unchanged.

### DES-046 — dashboard endpoints `GET /api/workflows` + `GET /api/runs/:id/dag`, router widening, and the SPA `renderNode` contract (src/server.ts, src/dashboard-page.ts)
- **status:** done
- **traces:** TASK-050
- **iter:** v8
- Endpoints (in the DES-018 `handleDashboardRequest`, `src/server.ts`): `GET /api/workflows` → `sendJson(res, 200, await runManager.catalog.list())` (`src/server.ts:602-604`) — the registered-workflow catalog for the home cards. `GET /api/runs/:id/dag` (`dagMatch = /^\/api\/runs\/([^/]+)\/dag$/`, `src/server.ts:593`) → 404 if `store.getRun(runId)` is falsy, else `sendJson(res, 200, buildDagModel(view))` where `view = await runManager.status(runId).catch(() => stored)` (`src/server.ts:607-613`) — the live read-model if the run is in-process, the stored view (flat, `workflowNodes: []`) otherwise.
- Router widening (`src/server.ts:797`): the top-level request-router dispatch predicate is `req.url?.startsWith('/api/runs') || req.url?.startsWith('/api/workflows')` — the `|| … '/api/workflows'` clause is the fix; before it, `/api/workflows` did not match the dashboard-API branch and fell through to the `/mcp` handler (JSON-RPC `-32601`). Both new endpoints thus route through the SAME `handleDashboardRequest` transport as `/api/runs*`.
- Page contract (`src/dashboard-page.ts`, self-contained SPA served by `GET /dashboard` + `/dashboard/<runId>`): home view fetches `/api/workflows` → workflow cards (`:69`) and `/api/runs` → run cards each `runId` + `status · name` (`:75-81`); `currentRunId()` reads the runId from `location.pathname` (`:62`) and `go()` uses `history.pushState` for SPA routing (`:63`). Detail view fetches `/api/runs/:id/dag` (`:114`) and renders it via a RECURSIVE `renderNode(runId, node, container)` (`:102-107`): each child `kind:'workflow'` becomes a `.grp` group with a `grp-h` header `workflow <name> · depth <N>` (`:105`) then recurses; each agent becomes a `.node st-<state>` row (`:93-96`) showing label / model / state / tokens, clickable → `loadTranscript` fetches `/api/runs/:id/agents/:aid` (`:88-89`). State→color mapping in CSS (`.st-queued/.st-running/.st-done/.st-completed/.st-failed`, `:28`). `setInterval(render, 3000)` is the 3-second poll (`:128`).
- Boundary: no new read-model — reuses the shared `RunStatusView` (via `buildDagModel`, DES-045) and the existing `WorkflowCatalog`/`RunStore`/transcript surfaces. `src/mcp-facade.ts` unchanged. See the `## v8 Decision rationale` foot for the shared-model, poll-over-SSE, and routing-fix decisions.

## v8 slice 2b — live execution detail: phase timeline + per-agent timing (DES-047)

### DES-047 — phase timestamps + per-agent started/ended timing + `durationMs` on the dag node + phase-timeline/duration page contract (src/types.ts, src/run-manager.ts, src/agent-executor.ts, src/dashboard.ts, src/dashboard-page.ts)
- **status:** done
- **traces:** TASK-051
- **iter:** v8
- Read-model shapes (`src/types.ts`): `PhaseView.ts: string` is made a REQUIRED field (`src/types.ts:68-72`) — every `phases[]` entry now carries the ISO time its `phase()` was entered (was previously title-only), so `PhaseView = { title, ts }`. `AgentRecord` gains optional `startedAt?: string` (dispatch time, absent while queued; `src/types.ts:61-63`) and `endedAt?: string` (settle time, absent while in flight; `src/types.ts:64-65`).
- Phase timestamp (REQ-050, `src/run-manager.ts`): the top-level sandbox's `onPhase` callback pushes `{ title, ts: this._clock.isoNow() }` onto `entry.phases` (`src/run-manager.ts:357`) — the SAME injectable `Clock` used for journal/transition stamps, so entries are in call order with non-decreasing `ts`. Back-compat: no `phase()` call ⇒ `phases: []`.
- Per-agent `startedAt` (REQ-051): stamped at the EXISTING dispatch seam — `RunManager` calls `entry.spawner.markRunning(agentId, this._clock.isoNow())` the moment the agent acquires its concurrency slot, just before the gateway dispatch (`src/run-manager.ts:494`). `AgentTranscriptSink.markRunning(agentId, startedAt?)` writes `startedAt` onto the running record (carrying forward an existing one if present; `src/agent-executor.ts:128-130`); `AgentExecutor.markRunning(agentId, startedAt?)` delegates it to the sink (`src/agent-executor.ts:282-283`). A queued-but-not-yet-dispatched agent has neither timestamp; an in-flight agent has only `startedAt`.
- Per-agent `endedAt` (REQ-051): `capture()` reads `startedAt` (and `frame`) off the prior running/queued record and carries it forward, setting `endedAt: ts` (the capture timestamp `this._clock.isoNow()` passed from RunManager) on BOTH the ok and failed branches (`src/agent-executor.ts:135-136, 141, 153`) — so a settled agent always has `startedAt`+`endedAt` with `endedAt ≥ startedAt`, whatever the outcome.
- Dag-node timing (REQ-051, `src/dashboard.ts`): `DagAgentNode` gains `startedAt?`/`endedAt?`/`durationMs?` (`src/dashboard.ts:22-25`). In `buildDagModel`, each agent node computes `durationMs = a.startedAt && a.endedAt ? Math.max(0, Date.parse(a.endedAt) - Date.parse(a.startedAt)) : undefined` (`src/dashboard.ts:54`) — a derived non-negative duration when both timestamps are present, `undefined` while unfinished — and carries `startedAt`/`endedAt`/`durationMs` onto the leaf (`src/dashboard.ts:55`). Pure/total as before (DES-045); the timing fields are additive.
- Page contract (`src/dashboard-page.ts`): the detail view gains a `#phases` timeline container (`src/dashboard-page.ts:60`), rendered by `renderPhases(phases, status)` (`:109-116`) — each phase becomes a `.phase` chip whose `title` attribute is its `ts` tooltip, and the LAST chip gets the extra class `cur` only while `status === 'running'` (`:113-115`, CSS `.phase.cur` at `:42`); an empty `phases` renders nothing (`:111`). `loadDag(runId)` now fetches `GET /api/runs/:id` for the run's `status`+`phases` (`:129`) — previously it scanned the `/api/runs` LIST — and calls `renderPhases((view.phases)||[], status)` (`:132`) before fetching `/dag` (`:133`). Each agent node renders its duration when present: `if(a.durationMs!=null){ n.appendChild(el('span','dur', a.durationMs+' ms')); }` (`:104`).
- Boundary: no lifecycle/budget/concurrency change — timing + timeline are read-model/observability only, reusing the one injectable `Clock` (deterministic under an advancing test clock, IT-049) and the existing `markRunning`/`capture` seams. `src/mcp-facade.ts` unchanged (`workflow_status` already returns the whole `RunStatusView`). See the `## v8 Decision rationale` foot for the required-`ts`, stamp-at-markRunning, and derived-`durationMs` decisions.

## v8 slice 4 — cross-trigger chaining + run-admission (DES-048, DES-049)

### DES-048 — authoritative onTerminal hook fired from `_transition` + `maxConcurrentRuns` admission gate (src/run-manager.ts)
- **status:** done
- **traces:** TASK-052
- **iter:** v8
- Deps shape (`src/run-manager.ts`): `RunManagerDeps` gains `onTerminal?: (runId: string, status: RunStatus) => void` (`src/run-manager.ts:63`) and `maxConcurrentRuns?: number` (`:66`). The ctor stores them as `private readonly _onTerminal` (`:127`, `:155`) and `private readonly _maxConcurrentRuns` (`:128`, `:156`) — the latter through the EXISTING `_positiveInt(value, fallback, name)` validator (`:133`), so `maxConcurrentRuns` defaults to **64** and an invalid `≤0`/non-integer is rejected at construction, exactly like `maxWorkflowDepth`/`maxWorkflowDescendants`. `const TERMINAL: RunStatus[] = ['stopped','completed','failed']` (`:69`) is the single terminal set both the gate and the hook read.
- Admission gate (REQ-054): a new `private _liveRunCount(): number` counts the non-terminal entries in the in-process `_runs` map — `for (const e of this._runs.values()) if (!TERMINAL.includes(e.status)) n++` (`:162-164`). `start()` opens with the gate at the VERY TOP, before any durable/expensive work: `if (this._liveRunCount() >= this._maxConcurrentRuns) throw codedError('RUN_ADMISSION_LIMIT', …)` (`:204-210`) — so an over-limit top-level run is rejected before `store.createRun`, workspace mkdir, seed, or sandbox spawn. A nested `workflow()` never calls `start()` (it re-enters through the composition path on the parent `RunEntry`), so it consumes no slot; a terminal run drops out of `_liveRunCount()` (its `entry.status` is terminal), freeing the slot for a later `start()`.
- onTerminal fire (REQ-052): `_transition(runId, entry, to)` fires the hook AFTER the persisted terminal write and ONLY from this one authoritative choke: `if (TERMINAL.includes(to) && this._onTerminal) { const fire = this._onTerminal; queueMicrotask(() => { try { fire(runId, to); } catch { /* listener errors never wedge the run */ } }); }` (`src/run-manager.ts:369-380`). `queueMicrotask` + `try/catch` make it fire-and-forget — a slow/throwing listener (e.g. a continuation starting run B) can never wedge A's terminal transition. Because `_transition` is the SINGLE writer of terminal status, the hook covers all three terminal statuses INCLUDING `stopped` (the un-`.catch`'d `.then` in `_runLive` never sees `stopped`); a non-terminal transition (`running`/`suspended`) fails the `TERMINAL.includes(to)` guard and does not fire; a nested `workflow()` has no store row and never calls `_transition`, so a composite parent with N nested calls fires exactly ONE onTerminal (for the parent).
- Boundary: the RunGuard budget, agent concurrency semaphore, journal, and RunSpec/RunStore shapes are UNTOUCHED — this DES adds one counter read on the `start()` entry and one fire-and-forget notification on the terminal edge. See the `## v8 Decision rationale` foot for the fire-from-`_transition`-not-`_runLive` and admit-before-durable-work decisions.

### DES-049 — durable ContinuationStore (schema/methods/seams) + `chain_create`/`chain_list` tools + late-bound server wiring (src/continuation-store.ts, src/server.ts, src/main.ts)
- **status:** done
- **traces:** TASK-052
- **iter:** v8
- Module (`src/continuation-store.ts`, NEW): `ContinuationStore` mirrors `SqliteSchedulerPort` — `better-sqlite3`, `journal_mode = WAL` (`:72-73`), engine-owned SIDE TABLE `CREATE TABLE IF NOT EXISTS continuations (id PK, afterRunId, workflow, argsJson, budget, rootRunId, status, spawnedRunId, createdAt)` + an `idx_continuations_after` index (`:74-87`). Zero change to RunSpec/RunStore. Seams are STRUCTURAL (no class import, same as the scheduler): `interface RunManagerPort { start(spec): Promise<string> }` (`:17-19`) and `interface RunStorePort { getRun(runId): Promise<RunStatusView|null> }` (`:21-23`); `ContinuationStoreDeps = { clock, runManager, store, dbPath }` (`:25-30`); public types `ChainSpec` (`:32-35`), `ChainStatus = 'pending'|'fired'|'skipped'` (`:36`), `ChainView` (`:37-45`).
- Methods: `chainCreate(spec): Promise<{chainId; error?}>` (`:93-106`) — validates the target via `store.getRun` → `{code:'CHAIN_TARGET_NOT_FOUND'}` when unknown (`:94-97`); else inserts a `pending` row with `rootRunId = _rootOf(afterRunId)` (`:99-102`) and, if the target is ALREADY terminal at create time, reconciles immediately (`:104`) so a late `chain_create` still fires/skips. `onTerminal(runId, status)` (`:110-114`) — the RunManager subscriber: ignores non-terminal, else `_reconcile`s every `pending` continuation whose `afterRunId = runId`. `rearmAtBoot()` (`:118-124`) — the durability reconcile: for every still-`pending` continuation whose target already terminated, fire/skip it once. `list(): Promise<ChainView[]>` (`:126-132`). Private `_reconcile(chainId, targetStatus)` (`:137-159`) — target `completed` → an ATOMIC `UPDATE … SET status='fired' WHERE id=? AND status='pending'` claim (`:144`); only the winner (`claim.changes===1`) starts B via `runManager.start({name, args, budget})` and records `spawnedRunId` (`:148-153`), a `start()` throw marks the row `skipped` (`:154-158`); target `failed`/`stopped` → `UPDATE … SET status='skipped' WHERE id=? AND status='pending'` (`:138-140`). Private `_rootOf(runId)` (`:163-166`) — inherits `rootRunId` from the continuation that spawned `runId` (`SELECT rootRunId … WHERE spawnedRunId=?`), else the run is its own root — anchoring a chain-of-chains to the original run.
- Idempotency + durability by construction: the `WHERE status='pending'` claim is the single serialization point — a stop→resume→complete cycle (two terminal transitions), or a concurrent `onTerminal` + boot reconcile, can each ATTEMPT a continuation but only one wins the row, so B starts AT MOST once. Durable because the row is SQLite-persisted and `rearmAtBoot()` re-derives the outcome from the target's persisted terminal status on the next boot (see the rationale foot on hydrateAll → boot-reconcile completeness).
- Tools (`src/server.ts`): `chain_create`/`chain_list` added to `TOOL_NAMES` (`:151-152`) and to the `TOOL_SCHEMAS`/inputSchema map — `chain_create` requires `{afterRunId, run:{workflow, args?, budget?}}` (`:418-428`), `chain_list` is a genuine zero-arg tool `inputSchema:{ type:'object', properties:{} }` (`:429-432`). `callTool()` gains a `continuations: ContinuationStore` param (`:499-502`); the dispatch handles `chain_create` → `continuations.chainCreate(args)` (`:533-536`) and `chain_list` → `continuations.list()` (`:537`); the one `callTool` call site passes `continuations!` (`:887`).
- Late-bound wiring cycle (`src/server.ts:702-711`): RunManager needs `onTerminal → continuations`, but `continuations` needs `runManager.start` — a construction cycle. Broken with a late-bound closure: `let continuations: ContinuationStore | undefined` (`:706`) is declared first; RunManager is built with `onTerminal: (runId, status) => { void continuations?.onTerminal(runId, status); }` + `maxConcurrentRuns: config?.maxConcurrentRuns` (`:707`); THEN `continuations = new ContinuationStore({ clock, runManager, store, dbPath: config?.continuationDbPath ?? join(workRoot, 'continuations.db') })` (`:710`) followed by `void continuations.rearmAtBoot()` (`:711`). The closure only ever fires at runtime via `queueMicrotask` (DES-048), long after both are assigned, so `continuations` is populated by then. `ServerConfig` gains `maxConcurrentRuns?` (`:98`) + `continuationDbPath?` (`:99`); `src/main.ts` composeConfig forwards `maxConcurrentRuns: fileConfig.maxConcurrentRuns` (`src/main.ts:134`); `rwe.config.example.json` documents `"maxConcurrentRuns": 64`.
- Boundary: the ContinuationStore is a swappable peer module reached only through the two structural ports — IT-051 drives it with fake RunManagerPort/RunStorePort + real SQLite, no engine wiring. See the `## v8 Decision rationale` foot for the completed→fire/failed-or-stopped→skip and boot-reconcile-completeness decisions.

### DES-050 — cross-restart DAG snapshot: `RunDagSnapshot` + `RunStore.saveSnapshot` + terminal-transition write + getRun overlay (src/run-store.ts, src/store/sqlite-run-store.ts, src/run-manager.ts)
- **status:** done
- **traces:** TASK-053
- **iter:** v8
- Port + type (`src/run-store.ts`): a new `interface RunDagSnapshot { phases: RunStatusView['phases']; agents: AgentRecord[]; workflowNodes: RunStatusView['workflowNodes'] }` (`src/run-store.ts:61-65`) — the persisted DAG detail a `getRun` overlays after a restart. The `RunStore` interface gains `saveSnapshot(runId: string, snapshot: RunDagSnapshot): Promise<void>` (`:57`), so every store implements it uniformly. Reuses the read-model's own `phases`/`workflowNodes` types (no parallel shape) and the full `AgentRecord[]` (which already carries `label`/`phase`/`frame`/`startedAt`/`endedAt` — the enriched fields the transcript-derived path lacks).
- InMemory store (`src/run-store.ts`): `StoredRun` gains a `snapshot?: RunDagSnapshot` field (`:78`); `saveSnapshot` sets it (`:161-164`); `getRun` overlays it when present, else the existing fallback — `phases: s?.phases ?? []`, `agents: s?.agents ?? deriveAgentRecords(run.transcripts)`, `workflowNodes: s?.workflowNodes ?? []` (`:150-158`). The `?? deriveAgentRecords(...)` / `?? []` keeps a no-snapshot run reconstructing exactly as today (backward-compatible).
- Sqlite store (`src/store/sqlite-run-store.ts`): a migration-free side table `CREATE TABLE IF NOT EXISTS run_snapshots (runId TEXT PRIMARY KEY, json TEXT NOT NULL)` created in the ctor (`:56-61`, mirroring the transitions/scheduler side-table convention); `saveSnapshot` does `INSERT OR REPLACE INTO run_snapshots (runId, json) VALUES (?, ?)` with `JSON.stringify(snapshot)` (`:191-193`); `getRun` reads the snapshot row and, when present, overlays it (`snap?.phases ?? []`, `snap?.agents ?? deriveAgentRecords(this._allTranscripts(runId))`, `snap?.workflowNodes ?? []`), else the existing derive-from-on-disk-transcripts fallback (`:179-188`). Imports `RunDagSnapshot` from `../run-store.js` (`:8`).
- Terminal write (`src/run-manager.ts`): `_transition(runId, entry, to)` — AFTER the persisted `recordTransition`, when `TERMINAL.includes(to)` — gathers `{ phases: entry.phases, agents: (entry.spawner instanceof AgentExecutor ? entry.spawner.getAllRecords() : []), workflowNodes: entry.workflowNodes }` and calls `await this._store.saveSnapshot(runId, …)` (`src/run-manager.ts:373-378`). Written ONCE from the single authoritative terminal choke (so `failed`/`stopped` are covered, not only `completed`), on the SAME edge the onTerminal hook (DES-048) rides; the `getAllRecords()` path pulls the enriched in-process records (a non-AgentExecutor spawner, e.g. a test fake, yields `[]` — snapshot still safe).
- Boundary: RunSpec/RunStore's existing shapes, the journal, the transition audit trail, and the terminal state machine are untouched — this DES adds one port method, one side table, one write on the terminal edge, and one overlay branch on read-back. See the `## v8 Decision rationale` foot for the snapshot-at-terminal (not incremental) and overlay-with-fallback (backward-compat) decisions.

### DES-051 — Host/Origin allowlist helpers + top-of-handler 403 guard + late-bound boundPort (src/net-guard.ts, src/server.ts)
- **status:** done
- **traces:** TASK-054
- **iter:** v8
- Helpers (`src/net-guard.ts`, added beside the existing D-BIND `isLoopback`): `isAllowedHost(hostHeader: string | undefined, bind: string, port: number): boolean` (`:47-52`) — an ABSENT Host → `false` (fail-closed; HTTP/1.1 requires it); splits `host:port`, requires `host` ∈ the allowset and, if a port is present, that it equals the server port. `isAllowedOrigin(originHeader: string | undefined, bind: string, port: number): boolean` (`:56-67`) — `undefined`/`''`/`'null'` → `true` (fail-OPEN; programmatic clients send none); a present Origin is parsed with `new URL(...).host` (malformed → `false`), then the same host+port allowset check. The allowset (`allowedHostSet(bind)`, `:27-31`) is `{127.0.0.1, localhost, ::1, [::1]}` plus the configured `bind` host WHEN it is non-loopback and not `0.0.0.0`/`::`. `splitHostPort` (`:33-44`) handles IPv6 literals (`[::1]:8787`) — a real authority parse, so a `127.0.0.1.evil.example.com` prefix is NOT treated as loopback (prefix-bypass rejected).
- Guard placement (`src/server.ts`): at the VERY TOP of the `createHttpServer` handler, before any route branch: `if (!isAllowedHost(req.headers.host, bind, boundPort) || !isAllowedOrigin(req.headers.origin, bind, boundPort)) { sendJson(res, 403, { error: 'Forbidden: Host/Origin not allowlisted' }); return; }` (`src/server.ts:867-870`) — uniform across `/mcp`, `/api/*`, `/dashboard`, `/hooks/*` because it fronts them all. `net-guard`'s helpers are imported at `:22`.
- Real-port closure (`src/server.ts`): the listening port is known only after `listen()` (the server may be started on `port: 0`), so a mutable `let boundPort = 0` (`:861`) is declared before the handler and assigned `boundPort = port` right after listen resolves (`:986`); the handler closure reads it, so the allowlist always checks against the REAL port. `0` until listen, but no request is served before then.
- Boundary: the helpers are pure (no I/O), so UT-063 drives them as a truth table and IT-053 drives the guard on a real server. Nothing else in the request path changes — the guard is a single early-return before the existing routing. See the `## v8 Decision rationale` foot for the fail-open-on-absent-Origin decision.

### DES-052 — durable WebhookRegistry (schema/methods/deliver contract) + POST /hooks/:id ingress route + webhook_create/list/delete tools + secret model (src/webhook-registry.ts, src/server.ts)
- **status:** done
- **traces:** TASK-054
- **iter:** v8
- Module (`src/webhook-registry.ts`, NEW): `WebhookRegistry` mirrors the scheduler/continuation side modules — `better-sqlite3` + `journal_mode = WAL` (`:67-68`), two engine-owned side tables `CREATE TABLE IF NOT EXISTS webhooks (id PK, workflow, secret, enabled, createdAt)` + `webhook_deliveries (deliveryId PRIMARY KEY, webhookId, ts)` (`:69-82`). Structural seams (no class import): `interface RunManagerPort { start(spec): Promise<string> }` (`:19-21`) and `interface CatalogPort { get(name): Promise<{script; version}> }` (`:23-25`); `WebhookRegistryDeps = { clock, runManager, catalog, dbPath }` (`:27-32`); public `WebhookView { id, workflow, enabled, secretFingerprint }` (`:34-39`) and `DeliverResult` (`:42-44`) — a discriminated `{ ok:true; httpStatus:202|200; runId?; replayed? } | { ok:false; httpStatus:401|403|404; reason }` the route maps to a status code.
- Methods: `create({workflow, enabled?})` (`:87-99`) — validates the workflow via `catalog.get` → `{error:{code:'WORKFLOW_NOT_FOUND'}}` when unknown (`:88-92`); else `randomBytes(32).toString('hex')` secret, `INSERT INTO webhooks`, returns `{webhookId, secret}` — the secret shown ONCE. `list()` (`:101-107`) — maps rows to `WebhookView` with `secretFingerprint = sha256(secret).slice(0,16)` (never the secret). `delete(id)` (`:109-112`). `deliver(id, {signature, timestamp, deliveryId, rawBody, parsedBody})` (`:117-139`) — the fail-CLOSED verify+fire, in order: row exists (`:118-119`, else 404) + enabled (`:120`, else 403) → `createHmac('sha256', row.secret).update(req.rawBody)` compared constant-time via `signatureEquals` (`timingSafeEqual`, length-guarded, `:122-124,:143-148`, else 401) → `±300_000ms` timestamp window (`:126-129`, else 401) → `INSERT OR IGNORE INTO webhook_deliveries` dedup (`ins.changes===0` → replay → `{ok:true, httpStatus:200, replayed:true}`, no second run, `:131-135`) → `runManager.start({ name: row.workflow, args: { event: req.parsedBody } })` → `{ok:true, httpStatus:202, runId}` (`:137-138`). The workflow name is ALWAYS the stored `row.workflow` (never the request), and the HMAC is over the RAW body before the route's JSON parse.
- Route (`src/server.ts`): `POST /hooks/:id` slotted in BEFORE the `/mcp` fallthrough (`:895-917`) — `readBody(req)` (inherits the 413 body cap), then `parsed = raw ? JSON.parse(raw) : undefined` (non-JSON → passed through as text), then `webhooks.deliver(webhookId, { signature: req.headers['x-rwe-signature'], timestamp: req.headers['x-rwe-timestamp'], deliveryId: req.headers['x-rwe-delivery'], rawBody: raw, parsedBody: parsed })`, mapping `DeliverResult` → `sendJson(res, out.httpStatus, …)` (202/200 on ok, 401/403/404 on failure), with a `BodyTooLargeError` → 413 catch.
- Tools (`src/server.ts`): `webhook_create`/`webhook_list`/`webhook_delete` added to `TOOL_NAMES` (`:159-161`) + `TOOL_METADATA` (`:442-460`; `webhook_list` a genuine zero-arg tool `inputSchema.properties:{}`). `callTool()` gained a `webhooks: WebhookRegistry` param + a `webhookBaseUrl: string` param (`:531-532`); the dispatch handles `webhook_create` → returns `{webhookId, url: `${webhookBaseUrl}/hooks/${webhookId}`, secret}` (secret once) (`:570-573`), `webhook_list` → `webhooks.list()` (`:575`), `webhook_delete` → `webhooks.delete(id)` (`:576`). The `/mcp` call site passes `webhooks` + a `webhookBaseUrl` derived from `req.headers.host` (`:962-963`). `WebhookRegistry` is constructed in the composition root next to the scheduler/continuation stores (`:752`, `dbPath: config?.webhookDbPath ?? join(workRoot, 'webhooks.db')`); `ServerConfig` gains `webhookDbPath?` (`:104`).
- Test-allowlist touch (`tests/integration/mcp-tools-list-schema.test.ts`): `webhook_list` added to that test's `ZERO_ARG_TOOLS` allowlist (a genuine zero-arg tool, like `schedule_list`/`asset_list`) — a one-line update to the EXISTING IT-028, NOT a new IT id.
- Boundary: the WebhookRegistry is a swappable peer reached only through `RunManagerPort`/`CatalogPort` — IT-054 drives it with fakes + real SQLite; IT-055 drives the route on a real server. The secret is stored server-side (not a one-way hash) because HMAC verification needs the key. See the `## v8 Decision rationale` foot for the secret-model and fail-closed-order decisions.

### DES-053 — crash durability: `interrupted` RunStatus + hydrateAll reclassify + `RunStore.getJournal` read-back + `_requireLive` journal-populate & named-script re-resolution (src/types.ts, src/store/sqlite-run-store.ts, src/run-store.ts, src/run-manager.ts, src/dashboard-page.ts)
- **status:** done
- **traces:** TASK-055
- **iter:** v8
- Status type (`src/types.ts`): the `RunStatus` union gains `'interrupted'` (`src/types.ts:5`) — a RESUMABLE, NON-terminal status a crashed-while-`running` run is reclassified to at boot, distinct from a user `suspended`/`stopped`; it is NOT in the RunManager's `TERMINAL` set (`src/run-manager.ts:69`, `['stopped','completed','failed']`), so it never fires onTerminal and remains resumable. Documented inline (`src/types.ts:3-4`).
- Boot recovery (`src/store/sqlite-run-store.ts`): `hydrateAll` now selects the rows left `status='running'` (a run that was executing when the process died) and `UPDATE runs SET status='interrupted'` for each (`:222-227`), replacing the previous force-to-`failed`; it logs `hydrateAll: … N re-classified running→interrupted (resumable)` (`:227`). So a crashed run comes back resumable, not permanently dead. (REQ-060.)
- Journal read-back (`src/run-store.ts` port + both stores): `RunStore.getJournal(runId): Promise<JournalEntry[]>` added to the interface (`src/run-store.ts:53-57`). `InMemoryRunStore.getJournal` returns `[...run.journal]` (a defensive copy) or `[]` for an unknown run (`:185-187`). `SqliteRunStore.getJournal` (`src/store/sqlite-run-store.ts:113-124`) reads `journal.jsonl`, and for each non-empty line: `JSON.parse` inside a `try/catch` where a parse failure `continue`s (a crash-truncated final line is SKIPPED, not thrown — a real SIGKILL can leave a half-written tail, `:120`), then keeps only entries with a numeric `callSeq` — so the terminal `{type:'result'}` marker (no `callSeq`) is dropped (`:121`). Returns `[]` when the file is absent (`:115`). (REQ-059.)
- Rehydration (`src/run-manager.ts` `_requireLive`): the method that reconstructs a `RunEntry` for a run not in this process's memory (`:333-380`) now (a) accepts `interrupted` alongside suspended/stopped as a resumable state (`:338`); (b) **re-resolves a NAMED workflow's script from the catalog** — `let script = spec.script ?? ''` then, `if (spec.name && !spec.script)`, `script = (await this._catalog.get(spec.name)).script` (`:347-351`), mirroring `start()` (`:211-217`); (c) reads the persisted journal back — `const persistedJournal = await this._store.getJournal(runId)` (`:354`) — and assigns it to the rehydrated entry's `journal` field (`:369`, was hard-coded `journal:[]`), so `resume()`'s `ResumeCache.build(entry.journal, newScript)` (`:276`) replays the settled calls from cache instead of re-running them live. `resume()` also accepts `interrupted` as a resumable pre-state (`:271-273`).
- Dashboard (`src/dashboard-page.ts`): a `.st-interrupted{color:#d29922}` CSS rule added to the run-status color set (`:28`) — cosmetic, so an interrupted run renders distinctly (amber, like `queued`).
- Test-assertion touch (`tests/integration/run-store-persistence.test.ts`): the EXISTING IT-006 case "running runs re-hydrate as ___ on restart" now asserts `interrupted` (was `failed`) — the behavior REQ-060 deliberately changes (`:89-99`). A one-line assertion update to an existing test, NOT a new IT id.
- Boundary: Option X — no new sandbox-checkpoint protocol; the journal is the durable checkpoint and the ResumeCache/replay machinery is reused wholesale. The terminal state machine, RunSpec/RunStore shapes, and the journal format are untouched; this DES adds one status value, one boot-recovery reclassify, one port read-back method (two impls), and one rehydration-path change. See the `## v8 Decision rationale` foot for the reuse-ResumeCache (no VM checkpoint), the mid-flight-at-crash re-run caveat, and the named-workflow script-re-resolution fix.

### DES-054 — workflow discovery: `parseMeta` + `parseWorkflowSkeleton` (src/workflow-meta.ts) + catalog `getFull`/`list`-with-description + `workflow_get` tool + `GET /api/workflows/:name/skeleton` + dashboard card drill-in
- **status:** done
- **traces:** TASK-056
- **iter:** v11
- **v11 F1 supersession (REQ-074):** the "workflow card is clickable → `showSkeleton(name)` inline" behavior (bullet below) is SUPERSEDED by DES-070 — on the redesigned home the card always shows a mini skeleton preview and a click opens the FULL graph view (REQ-071). `parseMeta`/`parseWorkflowSkeleton`/`GET /api/workflows/:name/skeleton` are unchanged and now REUSED by DES-070 for the card description + mini preview.
- New pure module (`src/workflow-meta.ts`): `parseMeta(script): WorkflowMeta` (`src/workflow-meta.ts:16-37`) — calls `checkMeta(script)` (reused from `sandbox/guards`, `:18`); returns the empty `{description:'', phases:[]}` unless the meta is `found && pureLiteral && objectText` (`:19`); evaluates the validated pure-literal object text in an EMPTY, timeout-bounded VM — `runInNewContext('(' + objectText + ')', Object.create(null), {timeout:50})` under `try/catch` that degrades to empty (`:21-25`); then reads `description` only if a string and maps `phases[]` to `{title}` keeping only string-title entries (`:28-35`). `parseWorkflowSkeleton(script): SkeletonNode[]` (`:99-129`) — a pure static scan: `CALL_RE = /\b(phase|agent|parallel|workflow)\s*\(/g` (`:52`) walked in source order; a `parallel(` records a `{id,start,end}` span (via `matchDelimiter`, string/paren-aware, `:82-93`) and is itself NOT emitted as a node (`:113-117`); each `phase`/`agent`/`workflow` becomes a `SkeletonNode{kind}` (`:118`), with `phase`→`title` / `workflow`→`workflow` name lifted from a leading string-literal arg (`STRING_ARG_RE`, `:119-122`); a node whose index falls inside a recorded parallel span gets `parallel: group.id` (`:123-124`); a node inside a `for`/`while`/`if`/`.map`/`.forEach`/… body (ranges from `dynamicRanges`, `:59-79`) gets `dynamic:true` (`:125`). Never executes the script, never throws (odd/invalid input returns whatever parsed).
- Types (`src/workflow-meta.ts`): `WorkflowMeta = {description:string; phases:Array<{title:string}>}` (`:7-10`); `SkeletonKind = 'phase'|'agent'|'workflow'` and `SkeletonNode = {kind; title?; workflow?; parallel?; dynamic?}` (`:39-50`).
- Catalog (`src/workflow-catalog.ts`): `list()` now `SELECT name, script, version, createdAt` and returns `{name, version, createdAt, description}` per row, deriving `description` on-demand via `parseMeta(r.script).description` (`src/workflow-catalog.ts:87-93`) — always in sync with the current script, no stored/migrated column. NEW `getFull(name): Promise<{name, script, version, createdAt}>` (`:79-85`) `SELECT`s the full row and throws `CatalogNotFoundError` for an unknown name (`:83`); imports `parseMeta` (`:21`).
- MCP facade (`src/mcp-facade.ts`): `workflow_list`'s workflow-kind return element WIDENED to include `description` (`src/mcp-facade.ts:147-148`). NEW `workflow_get({name})` (`:163-177`) — resolves `catalog.getFull(name)`; on `CatalogNotFoundError` returns a typed `{status:'failed', error:{code:'WORKFLOW_NOT_FOUND', …}}` envelope (never throws across the tool boundary, `:171`); otherwise returns `{name, version, createdAt, description, phases, script, skeleton}` where `description`/`phases` come from `parseMeta(full.script)` and `skeleton` from `parseWorkflowSkeleton(full.script)` (`:173-176`); imports `parseMeta, parseWorkflowSkeleton, SkeletonNode` (`:13`).
- Server (`src/server.ts`): `workflow_get` added to `TOOL_NAMES` (`src/server.ts:132`), `TOOL_METADATA` (`:260-261`, agent-facing description of the reuse-decision use), and the `callTool` dispatch (`:562`). NEW dashboard route `GET /api/workflows/:name/skeleton` (`:675`, `:688-697`) inside `handleDashboardRequest` — `getFull(name)` → `{name, version, description, phases, skeleton}` (200), unknown name → 404 (`:695`); the top-level router predicate already matches `/api/workflows` (`:911`, from Slice 3). Imports `parseMeta, parseWorkflowSkeleton` (`:23`).
- Dashboard (`src/dashboard-page.ts`): a workflow card renders its `description` as a sub-line (`src/dashboard-page.ts:80`) and is clickable → `showSkeleton(name)` (`:82`). `showSkeleton` (`:87-102`) fetches `/api/workflows/:name/skeleton`, sets a `skeleton (predicted)` badge, shows the `description` as the purpose text, and renders the predicted DAG — nodes sharing a `parallel` group id are boxed under a `parallel group` header (`:96-97`), and a `dynamic` node shows a `×? (dynamic)` marker (`:101`).
- Tests: UT-064 (`tests/unit/workflow-meta.test.ts`) + IT-057 (`tests/integration/workflow-discovery-http.test.ts`) — see 05-tests.md; both trace this DES.
- Boundary: purely additive read layer — no registration-storage change (no migration; `description` derived on-demand), no run-lifecycle/sandbox change, no change to any existing tool's semantics beyond the additive `description` field on `workflow_list`. See the `### v9 Decision rationale` foot.

## v10 — efficient large-codebase seeding (DES-055 / DES-056 / DES-057)

### DES-055 — compressed request bodies + typed too-large error: `readBodyDecoded` (bounded gzip/deflate) + `BodyTooLargeError{code,cap,phase,hint}` (src/server.ts)
- **status:** done
- **traces:** TASK-057
- **iter:** v10
- Caps (`src/server.ts`): the existing `MAX_BODY_BYTES = 8 MiB` (`:506`) is the COMPRESSED-input cap; NEW `MAX_DECOMPRESSED_BYTES = MAX_BODY_BYTES * 8` (`:511`) is the decompressed-output cap (8× headroom for a compressible code seed, still bounded so a bomb can't OOM).
- Typed error (`src/server.ts`): `BodyTooLargeError` (`:513-520`) now carries `readonly code = 'BODY_TOO_LARGE'` (`:514`) + `constructor(readonly cap:number, readonly phase:'compressed'|'decompressed', readonly hint:string)` (`:516`), message ``request body exceeds the ${cap}-byte ${phase} cap`` (`:517`); shared `GZIP_HINT = 'compress the body with Content-Encoding: gzip, or split the payload'` (`:522`).
- Body read refactor (`src/server.ts`): `readBody` split into `readBodyBuffer(req, maxBytes): Promise<Buffer>` (`:524-542`) — the RAW capped read (over-cap → `reject(new BodyTooLargeError(maxBytes,'compressed',GZIP_HINT))` then DISCARDs further data, bounded memory, `:532-536`); `readBody` (`:546-547`) is now `readBodyBuffer(...).then(b=>b.toString('utf8'))` (raw utf8, unchanged for callers that need the delivered bytes); NEW `readBodyDecoded(req, maxBytes): Promise<string>` (`:553-567`) reads the raw buffer, then honors `Content-Encoding` — `''`/`identity` → raw utf8 (`:556`, an un-encoded body behaves EXACTLY as before), `gzip`→`gunzipSync` / `deflate`→`inflateSync` (`node:zlib`, imported `:4`) each with `{maxOutputLength: MAX_DECOMPRESSED_BYTES}` (`:558-559`); an unknown encoding falls back to raw (`:560`); the zlib `RangeError` on exceeding `maxOutputLength` (a bomb) is caught and re-thrown as `BodyTooLargeError(MAX_DECOMPRESSED_BYTES,'decompressed',GZIP_HINT)` (`:564`).
- Wiring (`src/server.ts`): the `/mcp` handler now reads via `readBodyDecoded(req)` (`:1023`); its 413 catch emits the FULL typed body `{code, message, cap, phase, hint}` at HTTP 413 (`:1074-1076`). The WEBHOOK `POST /hooks/:id` handler deliberately KEEPS `readBody(req)` (RAW, un-decoded, `:1002`) because its HMAC is over the delivered bytes (auto-decompress would break signature verify); it only gains the typed 413 `{error, code, cap, hint}` (`:1014`).
- Tests: IT-058 (`tests/integration/compressed-body.test.ts`) — see 05-tests.md; traces this DES.
- Boundary: only the HTTP body-read seam + the two 413 catch blocks. No tool payload shape, no run-lifecycle change. See the `### v10 Decision rationale` foot.

### DES-056 — the CAS store: `CasStore` byte-verify + store-under-computed-hash + per-namespace refset (src/cas-store.ts)
- **status:** done
- **traces:** TASK-058
- **iter:** v10
- New module (`src/cas-store.ts`): `class CasStore` (`:22-89`) — `constructor(dir)` (`:26-41`) mkdir's `dir` + `dir/blobs` and opens a WAL SQLite `refs.db` (`:30-31`) with a per-namespace refset `refs(namespace TEXT, sha TEXT, createdAt TEXT, PRIMARY KEY(namespace,sha))` (`:33-40`); `_blobPath(sha)` shards to `blobs/<sha[0:2]>/<sha>` (`:43-45`).
- `putBlob(namespace, declaredSha, bytes): Promise<{sha256, accepted:true}>` (`:50-65`) — computes `sha256(bytes)` (`:51`); a non-empty `declaredSha !== computed` throws `casError('BLOB_HASH_MISMATCH', …)` and stores NOTHING (`:52-54`); stores under the COMPUTED hash (never the claimed one) only if absent, via write-tmp (`.<uuid>.tmp`) + atomic `renameSync` so a concurrent reader never sees a partial blob (`:56-62`) — IMMUTABLE (an existing blob is never overwritten); records the ref `INSERT OR IGNORE INTO refs` (`:63`, idempotent). `casError(code,message)` mints a branchable coded error (`:17-20`).
- `missing(namespace, shas): Promise<string[]>` (`:69-72`) — filters `shas` to those NOT in this namespace's refset (`SELECT 1 FROM refs WHERE namespace=? AND sha=?`); PER-NAMESPACE, never global existence (a blob another tenant uploaded is still "missing" here). `hasRef(namespace, sha)` (`:74-76`) same per-namespace predicate. `readBlob(sha)` (`:80-82`) / `readBlobSync(sha)` (`:85-88`) return the pool bytes by content hash or `null` if absent (namespace-agnostic pool read — the caller must have already checked `hasRef`/`missing` for its namespace).
- Tests: IT-059 (`tests/integration/cas-store.test.ts`) — see 05-tests.md; traces this DES.
- Boundary: a standalone engine-owned store (`$workRoot/cas`, its own SQLite side table, same convention as schedules/webhooks). The four security invariants (per-namespace refs, byte-verify-under-computed-hash, no exists-skip, immutable pool) are enforced HERE. See the `### v10 Decision rationale` foot.

### DES-057 — assemble from CAS: `materializeManifest` + `seedManifest` fail-fast + wiring (workspace-seed.ts, run-manager.ts, types.ts, mcp-facade.ts, server.ts)
- **status:** done
- **traces:** TASK-058
- **iter:** v10
- Shared guardrail (`src/workspace-seed.ts`): EXTRACTED the per-path verdict `seedPathVerdict(workspace, rel): {verdict:'ok', abs} | {verdict:'stripped'|'rejected'}` (`:33-41`) — empty→rejected (`:34`), `.claude` settings/hooks→stripped (`:35`), `/.git/`→rejected (`:37`), non-`isPathContained` (`../`/symlink escape)→rejected (`:39`) — reused by BOTH `materializeSeed` (inline `contentB64`, `:52-63`) and the NEW `materializeManifest` so the two seed paths can NEVER diverge on policy. NEW `ManifestEntry {path, sha256, exec?}` (`:19-23`, REGULAR FILES ONLY — no mode int / symlink / type field, ever). NEW `materializeManifest(workspace, manifest, readBlob): SeedResult` (`:69-83`) — for each entry runs `seedPathVerdict`, reads bytes via `readBlob(sha256)` (`:75`, `null`→rejected, `:76`), writes them, then `chmodSync(abs, e.exec ? 0o755 : 0o644)` (`:79`, masked — only the exec bit, never setuid/setgid/sticky).
- RunSpec (`src/types.ts`): `seedManifest?: {path, sha256, exec?}[]` + `seedNamespace?: string` (`:117-118`, additive).
- Run assemble + fail-fast (`src/run-manager.ts`): `RunManagerDeps.cas?: CasStore` (`:70`), stored `_cas` (`:133`, `:162`); imports `materializeManifest` (`:10`) + `CasStore` type (`:11`). `start()` — BEFORE `createRun` (before any durable work): if `spec.seedManifest?.length`, throw `CAS_UNAVAILABLE` when no `_cas` (`:220`), else compute `missing(seedNamespace ?? '_default', shas)` and throw `MISSING_BLOBS` listing the shas when non-empty (`:221-223`) — so the client `blob_put`s the missing blobs and retries, no run row created. The seed block (`:247-253`) — when `seedManifest` present and `_cas` set — mkdir's the workspace, `materializeManifest(workspace, spec.seedManifest, sha => cas.readBlobSync(sha))` (`:252`), then `initGitBaseline(workspace)` (`:253`, the same brownfield baseline the inline seed gets).
- MCP facade (`src/mcp-facade.ts`): `workflow_run` widened to accept + forward `seedManifest`/`seedNamespace` into `runManager.start` (`:82`, `:89`). `toErrEnvelope` (`:22-30`) now PREFERS an explicit `.code` on the error over the Error name (`:25-26`) — fixing a PRE-EXISTING latent bug where run-manager `codedError`s (`RUN_ADMISSION_LIMIT`, `MISSING_BLOBS`, `NESTING_*`) surfaced as `'Error'` (the Error name) through `workflow_run`; they now reach the client as their branchable code.
- Server (`src/server.ts`): constructs `const cas = new CasStore(config?.casDir ?? join(workRoot, 'cas'))` (`:845`), passes `cas` into the `RunManager` deps (`:847`) and threads it as a `callTool` param (`:604`, forwarded at `:1064`); `ServerConfig.casDir?` (`:106`); `blob_put`/`seed_plan` added to `TOOL_NAMES` (`:169-170`), `TOOL_METADATA` (`:478-500`), and the `callTool` dispatch (`blob_put` byte-verifies + returns `{sha256,accepted}` or a typed `{code,message}` on `BLOB_HASH_MISMATCH`, `:651-659`; `seed_plan` returns `{missing}` per-namespace, `:660-664`).
- Tests: IT-060 (`tests/integration/seed-manifest-http.test.ts`) + IT-059 (the store) — see 05-tests.md; the existing `workspace-artifacts-seed.test.ts` (the `materializeSeed` refactor) stays green. Both trace this DES.
- Boundary: additive over the existing inline seed path — `materializeSeed`/`asset_push` untouched, one shared `seedPathVerdict` guarantees the CAS and inline paths apply identical policy; `workflow_run` gains additive `seedManifest`/`seedNamespace`. See the `### v10 Decision rationale` foot.

## v8 Decision rationale (contested / converged points)

- **Additive frame-base keying replaces the multiplicative scheme (REQ-044b, the load-bearing fix).** The v1 nested-callSeq keying was `(parentCallSeq+1)×1e6+n`. Composed recursively this multiplies once per level, so the journal key grows super-linearly with depth and blows past `Number.MAX_SAFE_INTEGER` (2^53) around depth 2–3 — beyond which integer keys silently collide and resume replays the wrong cached `agent()` result. The fix is an ADDITIVE allocator: every distinct nested frame gets `base = (++nestedFrameSeq) × NESTED_FRAME_STRIDE` (stride 1e6), and a frame's own calls live at `base + localCallSeq`. Keys grow linearly in the number of frames, not exponentially in depth, so they stay well within `MAX_SAFE_INTEGER` for any realistic composition. Determinism is preserved by keying each frame on a stable frame-path (parent path + parent callSeq) and first-touching frames in execution order (including `parallel()` array order), so a resume re-derives byte-identical bases and replays every nested call from cache. Regression-guarded by the pre-existing IT-026 (callseq-resume) which stays green under the new scheme.
- **Cycle guard keys on the ancestor CHAIN, not a global visited-set — so diamonds are allowed (REQ-042).** A global "already-seen" set would falsely reject a legitimate diamond (two sibling branches each invoking the same NON-ancestor workflow D). Keying the guard on the per-branch `ancestors` set means a name is refused only when it is one of ITS OWN ancestors (true unbounded recursion, e.g. A→A or A→B→A), while D→(run twice, once per branch) is permitted because neither branch has D as an ancestor. This matches the "compose a system graph" intent: sharing a sub-workflow across branches is normal; re-entering your own chain is not.
- **Two independent caps (REQ-041 depth vs REQ-043 descendants).** Depth bounds a single branch; a total-descendant counter bounds the WHOLE tree. Either alone is insufficient: a shallow-but-very-wide fan-out (depth 2, thousands of siblings) is caught only by the descendant cap, and a narrow-but-deep chain only by the depth cap. Both are enforced at the same `onWorkflowRequest` boundary, both surface typed envelope errors, and both are config-validated (≤0/non-integer rejected at load, defaults 4 / 256).
- **Shared budget by construction (REQ-044a).** The nested child reuses the parent `RunEntry`/`RunGuard` rather than getting its own — so there is no per-level budget reset and the aggregate agent count across all depths is bounded by the single run budget. This is a property of NOT allocating new budget state on recursion, not a separate accounting pass.

### v8 Slice 2 — call-tree read-model (DES-043/044)

- **Stamp the frame at markQueued, not at capture (REQ-045/047).** The frame could in principle be attached when the final `AgentRecord` is written (`capture()`), but REQ-047 wants the running/queued node to already carry its frame so the dashboard can show "current step = the running node(s)". Stamping at `markQueued` and carrying it forward through `capture()` (both ok and failed branches) means a frame-tagged node exists from the instant the agent is enqueued — before any gateway result — and survives whatever the outcome. The alternative (compute-frame-at-capture) would leave in-flight agents un-grouped, exactly the observability gap this slice closes.
- **Reuse the ARCH-027 frame-path key as the tree key — don't invent a parallel one.** The boundary node's `frame`/`parentFrame` are the SAME `framePathKey`/`parentPathKey` the N-level composition already derives to namespace the journal (`${parentPathKey}.${parentCallSeq}`). A separate tree-id space would risk drifting out of sync with the journal keys the agents are actually namespaced under, breaking the "group agents by frame" reconstruction. One frame identity, used for both journal namespacing and tree linkage, makes `node.frame == its inner agents' frame` true by construction (asserted by IT-047) rather than by a matching pass.
- **`workflowNodes` is a REQUIRED read-model field, defaulted `[]` on the persisted path (deferred persistence).** Making it required forces every `RunStatusView` producer to answer the "what's the tree?" question explicitly rather than leaving `undefined` ambiguity for clients. Cross-restart tree persistence is out of scope for this first increment, so the persisted/derived `getRun()` path returns `[]` (the live tree lives in the per-process `RunEntry`); this is an honest "no persisted tree yet" default, not a silent data loss — a later increment can populate it from a persisted node table without changing the shape. Recorded as deferred in 07-review alongside parallel-group markers, phase persistence + current-step/timing, and static pre-read + scriptVersion caching.

### v8 Slice 3 — dashboard UI (DES-045/046)

- **One pure `buildDagModel`, shared by the endpoint AND the page — not tree logic duplicated in the browser.** The call-tree could be rebuilt in client JS from the flat `/api/runs/:id` read-model, but then the reconstruction would live untested in the page and could drift from any server-side use. Instead the tree is a single PURE function (`buildDagModel`) unit-tested in isolation (UT-061) and served whole by `GET /api/runs/:id/dag`; the page just walks the already-built `DagNode` recursively (`renderNode`). One reconstruction, one test — the page renders, it does not re-derive.
- **Total function with a root fallback — never drop an agent, never throw.** REQ-048 mandates the model never throws and never drops an agent. Two guards make it total: boundary nodes are attached depth-ascending with `(byFrame.get(parentFrame) ?? root)` so an orphan parentFrame lands on root rather than crashing, and each agent is attached via `byFrame.get(a.frame ?? '') ?? root` so an agent whose frame has no matching node (e.g. a stale/unknown frame) falls back to root instead of vanishing. A dashboard must degrade to a flatter-but-complete tree, never to a 500 or a silently missing agent.
- **Keep the 3-second poll; defer SSE.** Live updates could use server-sent events, but the dashboard already had a poll and the run cards / DAG are cheap read-model reads; a 3s `setInterval(render)` is enough for an operator view and avoids a streaming endpoint + reconnect handling this increment. SSE is recorded deferred in 07-review.
- **Widen the router predicate rather than special-case `/api/workflows`.** The Gate-7.5-caught gap was that the top-level router only matched `/api/runs*`, so `/api/workflows` fell through to `/mcp` (`-32601`). The fix keeps ONE dashboard-API branch and simply extends its predicate to also match `/api/workflows` — both endpoints share `handleDashboardRequest`, no second handler. Locked by IT-048's `GET /api/workflows` case.

### v8 Slice 2b — live execution detail (DES-047)

- **Make `PhaseView.ts` REQUIRED, not optional.** An optional `ts?` would let a producer omit the timestamp and leave the timeline half-built for clients to special-case. Making it required forces every phase-push site to answer "when was this phase entered?" explicitly (there is exactly one, the sandbox `onPhase` callback), so the timeline is always complete. The one compile consequence — a `PhaseView` fixture in `tests/unit/dashboard-model.test.ts` had to gain `ts` — is a cheap, honest cost of the tighter contract.
- **Stamp `startedAt` at `markRunning` (slot-acquired), not at enqueue.** REQ-051 defines `startedAt` as the DISPATCH time (once the agent acquired its concurrency slot), so a run that queues an agent behind a full semaphore does not falsely credit it with a long duration it spent waiting. `markRunning` is exactly that seam — it already fires the instant the slot is acquired and the gateway call is about to start — so reusing it (rather than stamping at `markQueued`) makes `durationMs` measure real execution, and leaves a queued-not-yet-dispatched agent correctly timestamp-less. `endedAt` is the `capture()` timestamp, giving `endedAt ≥ startedAt` by construction.
- **Derive `durationMs` in the model, don't persist it.** `durationMs` is a pure function of `startedAt`/`endedAt` (`max(0, Δ)`, `undefined` when either is missing), so it lives only in `buildDagModel`'s output, not in the stored `AgentRecord`. This keeps one source of truth (the two timestamps), makes the `max(0, …)` clamp a single tested spot (UT-062), and means an unfinished agent yields `undefined` for free — no separate "is it done yet?" flag. The dashboard just renders whatever the node exposes.
- **One clock, so the timeline + timing are deterministically testable.** Both the phase `ts` and the agent `startedAt`/`endedAt` come from the SAME injectable `Clock` (`this._clock.isoNow()`) the engine already uses for journal/transition stamps. An advancing test `Clock` (ticks +1s per read) therefore makes "phases carry ordered `ts`" and "`endedAt ≥ startedAt`" assertable against real RunManager + real sandbox without wall-clock flake (IT-049).
- **Fetch `/api/runs/:id` for the detail head, not the `/api/runs` list.** The timeline needs the run's own `status` (to mark the current step) + `phases`; the home-card list endpoint (`/api/runs`) does not carry per-run phases. Switching `loadDag` to the single-run endpoint gets both in one read the page already had a route for, rather than scanning the list for the matching id.

### v8 Slice 4 — cross-trigger chaining + run-admission (DES-048/049)

- **Fire `onTerminal` from `_transition`, not from the `.then` in `_runLive`.** `_runLive` chains an un-`.catch`'d `.then` on the live-run promise, but that path only covers the natural completed/failed exit — it never sees a `stop()` (which transitions the run to `stopped` out-of-band) and a throw in the `.then` would corrupt the terminal write. `_transition` is the SINGLE authoritative writer of terminal status, so firing there covers ALL THREE terminal statuses (completed/failed/stopped) exactly once and after the status is persisted. Firing is `queueMicrotask` + `try/catch` (fire-and-forget) precisely so the continuation's `runManager.start(B)` — which is real, slow, throwable work — can never wedge or corrupt A's terminal transition.
- **Admit before durable work — the run-count chokepoint the agent-semaphore is not.** The existing global agent-semaphore caps only `agent()` DISPATCH; it does nothing to bound how many top-level runs materialize workspaces, fork sandboxes, or write `createRun` rows — the actual DoS surface. So the `maxConcurrentRuns` gate sits at the VERY TOP of `start()`, before `createRun`/mkdir/seed/spawn, and rejects with a typed `RUN_ADMISSION_LIMIT` envelope. A nested `workflow()` deliberately consumes NO slot: it is not a top-level `start()`, it re-enters on the parent `RunEntry`, and counting it would let a single legitimate composite exhaust the cap against itself.
- **completed → fire; failed/stopped → skip.** A continuation means "when A SUCCEEDS, do B"; a failed or stopped A is exactly the case where B should NOT run (it would act on a broken/aborted predecessor). So `_reconcile` starts B only for `completed` and marks the continuation `skipped` for the other two terminal statuses — an explicit, observable `skipped` (via `chain_list`), not a silent no-op.
- **Boot-reconcile completeness rests on hydrateAll marking cross-restart running → failed.** `rearmAtBoot()` only reconciles continuations whose target is ALREADY terminal on boot. This is complete because the RunStore's `hydrateAll` marks any run that was `running` at the previous shutdown as `failed` (a crashed/killed run cannot still be running) — so on boot every target has REACHED a terminal status (it either finished cleanly, or was hydrated to `failed`), and the reconcile always fires or skips it. There is no "still pending forever because the target is stuck non-terminal across restart" hole.
- **Structural ports + a late-bound closure, not a class import.** The ContinuationStore reaches RunManager/RunStore through the same structural-`interface` seams the scheduler uses (no class import), keeping it unit-drivable with fakes (IT-051). The RunManager↔store construction cycle (RunManager wants `onTerminal → store`; store wants `runManager.start`) is broken with a `let continuations` captured by the `onTerminal` closure and assigned immediately after RunManager is built — safe because the closure only executes at runtime (via `queueMicrotask`), never during construction, so `continuations` is always populated by the time a terminal transition fires.

### v8 Slice 2c — cross-restart DAG persistence (DES-050)

- **Snapshot ONCE at the terminal transition, not incrementally.** The DAG detail (phases/workflowNodes/agent-frames) could be written as it changes, but that adds a write on every phase-push / agent-capture and risks a torn half-tree if the process dies mid-run. Instead the snapshot is captured EXACTLY ONCE, at the single authoritative terminal `_transition` (`src/run-manager.ts:373-378`), when the tree is complete and immutable — the same choke the onTerminal hook rides, so `failed`/`stopped` runs are snapshotted too (not only `completed`). A run that crashes before terminal simply has no snapshot and falls back to the derive-from-transcripts path — an honest "no persisted tree" rather than a corrupt partial one.
- **Overlay-with-fallback keeps it strictly backward-compatible.** `getRun` overlays the snapshot only WHEN PRESENT (`snap?.phases ?? []`, `snap?.agents ?? deriveAgentRecords(...)`, `snap?.workflowNodes ?? []`), so a run persisted before this change — or any run without a snapshot — reconstructs exactly as it does today (phases:[] / workflowNodes:[] / agents-from-tokens), never worse and never a crash. This is REQ-055's explicit backward-compat clause satisfied by construction: the new path is purely additive, gated on a nullable side-table row.
- **Persist the full `AgentRecord[]` (via `getAllRecords()`), not the token-only transcript derivation.** The restart-survival gap was that `deriveAgentRecords` rebuilds agents from the `usage` transcript event, which has tokens/provider/model but NOT `label`/`phase`/`frame`/`startedAt`/`endedAt` — so the tree flattened. The snapshot instead captures the in-process AgentExecutor's `getAllRecords()`, which carry the enriched fields, so `buildDagModel` regroups by `frame` and shows durations after a restart identically to before. A non-AgentExecutor spawner (a test fake) yields `[]` and the fallback still applies.
- **A migration-free side table, same stance as the scheduler.** `run_snapshots(runId PRIMARY KEY, json TEXT)` is a `CREATE TABLE IF NOT EXISTS` side table with an `INSERT OR REPLACE` write — no ALTER on the `runs` table, no v1-core schema change. This mirrors the transitions/schedules/continuations convention: engine-owned durable state lives in its own table, so a rollback is just "ignore the extra table" and RunSpec/RunStore's existing shape is untouched.

### v8 Defer B — external-ingress security (DES-051, DES-052)

- **Fail-OPEN on an absent Origin, fail-CLOSED on an absent Host.** These asymmetric defaults are deliberate and load-bearing. A missing `Origin` is the NORMAL case for every programmatic MCP client and test (browsers send Origin on cross-site POSTs; `curl`/`fetch`/SDK clients send none), so a fail-closed Origin check would break all legitimate non-browser callers — hence absent/`''`/`null` Origin is allowed, and only a PRESENT-but-foreign Origin (a drive-by browser page CSRF-POSTing `/mcp`) is 403'd. A missing `Host`, by contrast, is anomalous (HTTP/1.1 mandates it) and is exactly the shape a crafted rebinding request might take, so absent Host is fail-closed (403). The CSRF threat needs a browser (which always sends Origin); the rebinding threat needs a forged Host — so each check is closed against its own threat and open against legitimate traffic.
- **Store the webhook secret server-side (not a one-way hash) — HMAC requires the key.** This is the one honest security note worth stating plainly: unlike a password (verified by hashing the input and comparing), an HMAC signature can only be verified by RE-COMPUTING `HMAC(secret, body)` — which needs the secret itself. So the secret is generated server-side, stored server-side, and returned to the client EXACTLY ONCE at creation (never retrievable again); `webhook_list` exposes only a `sha256(secret).slice(0,16)` FINGERPRINT, never the secret. This is precisely the GitHub/Stripe webhook model — a one-way hash cannot verify an HMAC. The at-rest exposure is the same as any HMAC-signing system and is bounded by the DB file's own access controls.
- **Fail-closed verify ORDER: exists+enabled → signature (over RAW body) → timestamp → delivery-dedup → fire.** The order is chosen so no expensive or observable side effect happens before authentication: a 404/403 for unknown/disabled costs one indexed lookup; the HMAC is computed over the RAW body BEFORE any JSON parse (so a malformed/hostile body can't bypass signature check via a parse quirk, and the bytes signed are exactly the bytes received); the ±300s window bounds replay of a captured-but-valid signature; the `X-RWE-Delivery` dedup (atomic `INSERT OR IGNORE`) makes a legitimate retry idempotent (200, no second run) rather than double-firing. Only after all four does `runManager.start` run the PRE-BOUND workflow — whose name comes from the stored registration, never the request body, so there is no workflow-selection injection.
- **Structural ports for the WebhookRegistry, same as the scheduler/continuation modules.** The registry reaches `RunManager.start` and `WorkflowCatalog.get` through structural `RunManagerPort`/`CatalogPort` interfaces (no class import), so IT-054 drives the full verify+fire+dedup+durability logic with fakes over REAL SQLite, and the module stays a swappable engine-owned side table (`webhooks` + `webhook_deliveries`) durable across restart by the same convention as schedules.db/continuations.db. The interim access control (this allowlist + the loopback/LAN bind) stands in for OIDC (REQ-012, D5); a public `0.0.0.0` bind without OIDC is a documented deployment caveat, not a silent hole.

### v8 Defer A — crash durability (DES-053)

- **Option X: reuse ResumeCache + a status gate + journal read-back — NOT a new VM/sandbox checkpoint protocol.** The obvious "durable in-flight graph" design is to serialize the mid-execution call-tree (a sandbox checkpoint / VM snapshot) and rehydrate it. That is a large, fragile new protocol (freeze a running VM context, version its serialized shape, restore it). Option X observes that the engine ALREADY persists a journal of every settled `agent()`/`workflow()` call and ALREADY has a ResumeCache that replays settled calls and runs only the unfinished tail (that is exactly how suspend/resume works). So crash durability needs no new checkpoint at all — it needs only (1) a non-terminal `interrupted` status so a crashed run is resumable rather than force-`failed`, and (2) a `getJournal` read-back so a run rehydrated in a FRESH process gets its ResumeCache populated (it was hard-coded empty). Re-executing the script against the populated cache reconstructs the run's position by construction. Smaller, reuses tested machinery, and adds one status value + one read-back method instead of a whole serialization format.
- **A mid-flight-at-crash call is correctly RE-RUN on resume — the same caveat suspend/resume already carries, not silent loss.** A call that was dispatched but had not yet journaled its result at the instant of the crash has no journal entry, so on resume it is a cache MISS and re-dispatches live. This is identical to how a suspend that stops an in-flight agent re-runs that agent on resume — it is the documented, correct behavior of cached-prefix replay, not a regression. The honest consequence: a re-run tail call whose side effects are non-idempotent (e.g. it already sent an email before the crash) will repeat that side effect. This is recorded as a caveat (side-effect idempotency is the workflow author's responsibility), the same boundary suspend/resume has always had.
- **`getJournal` is robust to a crash-truncated final line — a real SIGKILL can leave a half-written tail.** Unlike a clean suspend (which flushes complete journal lines), a `kill -9` can interrupt a journal append mid-line. So `getJournal` parses each line under `try/catch` and SKIPS an unparseable line rather than throwing — a truncated last line simply means that call is treated as unsettled (cache MISS → re-run), which is exactly the mid-flight-at-crash semantics above. Dropping the terminal `{type:'result'}` marker (it has no `callSeq`) keeps the read-back to settled-CALL entries only, so it feeds `ResumeCache.build` the same shape the in-memory journal does.
- **The named-workflow script-re-resolution fix — a PRE-EXISTING bug this surfaced.** A NAMED-workflow run (`start({name})`) stores `spec.script = null` because `start()` resolves the script from the catalog at launch; only inline `start({script})` runs carry a script on the spec. `_requireLive` used `spec.script ?? ''`, so ANY restart-resume of a named workflow — not only a crash, but the pre-Defer-A suspended-run restart path too — executed an EMPTY script and returned `undefined`, with only the pre-crash agents journaled. Every unit test missed it because they all used inline scripts. Live Gate-7.5 crash testing of a named workflow exposed it (the resumed run "completed" in ~0.13s with a null result and no re-dispatch). The fix re-resolves the script from the catalog in `_requireLive` the SAME way `start()` does — so the rehydrated run runs the REAL script and its journaled prefix replays correctly. This is why IT-056's third case (a named-workflow crashed run resumes to the CORRECT result) is a deliberate regression guard.

### v9 Decision rationale (workflow discovery — DES-054)

- **On-demand `parseMeta` at read time, NOT a stored/migrated `description` column — migration-free + always in-sync.** The description could be extracted once at register time and stored in a new `workflows.description` column. That needs a schema migration AND risks drift: if a workflow is re-registered with a changed meta, a cached column can go stale. Deriving `description` on-demand from the stored `script` (`list()` / `getFull()` → `parseMeta`) is migration-free (the catalog's existing `name/script/version/createdAt` shape is untouched) and always reflects the CURRENT script by construction. `parseMeta` is cheap (a `checkMeta` scan + one small VM eval) and only runs on the discovery read paths, not on the hot run path.
- **The skeleton is an explicitly BEST-EFFORT STATIC prediction, not a claimed exact DAG — because loops/conditionals resolve only at run time.** A `for`/`while`/`if`/`.map` body's true node count/shape is unknown until execution, so the static scanner cannot honestly enumerate it. Rather than run the script (which would defeat "inspect BEFORE running" and be unsafe), the scanner marks such nodes `dynamic:true` — an honest "this repeats/branches an unknown number of times" signal — and reports the exact ordered nodes it CAN see (top-level phase/agent/workflow calls, parallel groups, sub-workflow names). The dashboard renders the `×? (dynamic)` marker so the operator reads it as a prediction, not a guarantee.
- **Evaluating the meta object in a VM is SAFE because the meta is a validated PURE LITERAL.** `parseMeta` does not `eval` arbitrary code — it first runs the SAME `checkMeta` guard the engine already uses to validate `export const meta` at register time, and evaluates the object text ONLY when `checkMeta` reports `pureLiteral` (no calls, no variable refs, no spreads, no template expressions). A pure object literal has no side effects, so evaluating it in an empty (`Object.create(null)`) prototype-free context with a 50ms timeout is side-effect-free and bounded; any parse/eval failure degrades to empty. This reuses the register-time validation as the security boundary rather than inventing a second parser.
- **A purely additive read layer — `workflow_get` + `/skeleton` are new surfaces; `workflow_list` gains one additive field.** Discovery adds no write path and changes no existing tool's semantics. `workflow_list`'s new `description` is additive (older clients ignore it); `workflow_get` and `GET /api/workflows/:name/skeleton` are new read-only endpoints; unknown-name reads return a typed `WORKFLOW_NOT_FOUND` envelope / 404 rather than throwing, matching the engine's envelope-not-exception convention.

### v10 Decision rationale (efficient large-codebase seeding — DES-055/056/057)

> These record the panel-accepted architecture in `docs/seed-sync-architecture.md`; the doc is the full 4-architect debate, this is the design-decision digest for the two shipped slices.

- **TWO caps, not one — the compressed cap alone can't stop a bomb (DES-055).** Accepting `Content-Encoding: gzip` without a decompressed-output bound would trade the wire-size win for a decompression-bomb DoS (a 1 KB gzip inflating to gigabytes OOMs the process). So `readBodyDecoded` bounds BOTH planes: `MAX_BODY_BYTES` on the compressed bytes on the wire (the existing DoS cap, unchanged) AND `MAX_DECOMPRESSED_BYTES` (8×) on the inflate output via zlib's own `maxOutputLength`, which throws mid-inflate the instant the cap is crossed — no full buffer ever materializes. 8× is real headroom for compressible code, still a hard ceiling. This is the adversarial-security seat's non-negotiable condition for enabling compression at all.
- **The webhook path keeps the RAW body — HMAC is over delivered bytes, so it must NOT auto-decompress (DES-055).** Only `/mcp` routes through `readBodyDecoded`; `POST /hooks/:id` stays on `readBody` (raw). A webhook's signature is `HMAC(secret, the bytes as delivered)` — silently gunzipping before the HMAC compare would verify a signature over different bytes than the client signed, breaking every valid delivery. The webhook merely inherits the typed 413. This asymmetry is deliberate: decode where the payload is engine-parsed JSON, never where the bytes are the security material.
- **A typed `{code, cap, phase, hint}` 413, not an opaque raw 413 (DES-055).** The consumability seat's point: a bare 413 tells a client nothing actionable. The typed body names WHICH cap was hit (`phase:'compressed'|'decompressed'`), the numeric `cap`, and the concrete next step (`hint`: gzip the body or split it) — so an LLM/agent caller can self-correct (compress and retry) instead of failing blind. It rides the engine's existing envelope-not-exception convention.
- **The CAS is content-addressed by sha256 of RAW bytes, stored under the COMPUTED hash, with NO exists-skip (DES-056).** The store computes the hash over the received bytes and stores under THAT, never the caller's claim — a mismatch throws `BLOB_HASH_MISMATCH` and stores nothing. This single choice closes two attacks at once: hash-POISONING (uploading bytes X under name Y so a later victim assembling Y gets X) is impossible because the name IS the verified content, and confused-deputy EXFIL (claiming a hash you don't have to trick the server into revealing whether it exists) is impossible because there is no exists-skip fast path — every upload is verified and stored, existence is never leaked as a side channel.
- **`missing`/`hasRef` are PER-NAMESPACE, never global existence — the dedup-oracle fix (DES-056).** A global "does this blob exist?" dedup would leak, across tenants, whether ANY tenant has uploaded a given blob — the Harnik/Dropbox-2011 confirmation attack (guess a file's bytes, ask, learn if someone has it). Scoping the refset to `(namespace, sha)` means a blob namespace A uploaded is STILL "missing" for namespace B until B uploads it too: cross-tenant dedup savings are given up on purpose to close the oracle. Multi-tenant enforcement is then an OIDC-time flip (bind namespace to identity), not a rewrite.
- **ONE shared `seedPathVerdict`, so the inline and CAS seed paths can never diverge (DES-057).** The security-critical guardrail (`.claude` strip → `.git` reject → realpath-contained) is extracted to a single per-path verdict function that BOTH `materializeSeed` (inline `contentB64`) and `materializeManifest` (CAS bytes) call. The byte source is irrelevant to policy; making it one function means a future tightening of the guardrail applies to both paths by construction — there is no second, drifting copy of the "is this path safe to write?" logic to forget to update.
- **`{path, sha256, exec?}` — regular files only, `exec?` the sole metadata bit, no symlinks EVER (DES-057).** The fidelity-vs-safety resolution: `exec?:boolean` (masked `& 0o755`) lets a runnable script keep `+x` and is categorically safe (it grants no capability the jailed agent lacks; nothing auto-executes; the `.claude`-strip, not the exec bit, is the RCE gate). But NO `mode:int` and NO `symlink`/`type`/`target`, ever — adding `symlinkSync` to the privileged pre-agent assemble would turn every future "tree-walker forgot `isPathContained`" bug from harmless into host-file exfiltration. A seed is a starting tree the agent builds from (install output and submodules are regenerated), not a frozen runnable image — "no symlinks" seeds a working tree, not a crippled one.
- **Fail fast on `MISSING_BLOBS` BEFORE any durable work — no run row created (DES-057).** The `seedManifest` blob-presence check sits at the top of `start()`, before `createRun`/mkdir/spawn, and throws `MISSING_BLOBS` (listing the shas) or `CAS_UNAVAILABLE`. So a client that references an un-uploaded blob gets an immediate, actionable rejection (upload these, retry) with zero half-built run state to clean up — the same admit-before-durable-work discipline as the run-admission cap. Resumability is free: re-running `seed_plan` after a partial upload returns only the still-missing blobs.
- **`toErrEnvelope` prefers a coded error's `.code` over the Error name — a PRE-EXISTING latent bug fixed here (DES-057).** Before v10, `toErrEnvelope` returned `err.name` (`'Error'`) for run-manager `codedError`s, so `RUN_ADMISSION_LIMIT` / `NESTING_*` (and now `MISSING_BLOBS`) surfaced through `workflow_run` as a useless `'Error'` code — the branchable code was silently dropped at the tool boundary. The fix reads `.code` first, falling back to the Error name only for a genuinely un-coded error. This is a latent bug that predates the CAS work (it already swallowed the v8 admission/nesting codes) but was surfaced and fixed by this slice because `MISSING_BLOBS` MUST reach the client as a code for the upload-then-retry loop to work.

## v11 Sprint 2 — tag-triggered privilege-separated self-update (DES-058..062; ARCH-038..040)

### DES-058 — pure GitHub tag-webhook verifier: `extractTag` + `verifyTagWebhook` → `TagVerdict` (`src/self-update-webhook.ts`)
- **status:** done
- **traces:** ARCH-038, TASK-061
- **iter:** v11
- **signature:**
  - `const TAG_PATTERN = /^v[0-9][0-9A-Za-z.\-+]*$/` (anchored; rejects `v1.0.0; rm -rf /` by class).
  - `extractTag(event: string, body: unknown): string | null` — `event==='ping'`→null; `'create'` with `body.ref_type==='tag'`→`body.ref` (path A); `'create'` `ref_type==='branch'`→null; `'push'` with `body.ref` `=== 'refs/tags/<t>'` && `body.deleted!==true`→`<t>` after stripping `refs/tags/` (path B); `'push'` `deleted===true` (tag delete) or `refs/heads/…`→null. Returned tag is NOT yet pattern-checked here (caller does).
  - `type TagVerdict = { arm: true; tag: string; deliveryId?: string } | { arm: false; httpStatus: 200 | 401 | 503; code?: string; reason: string }`
  - `verifyTagWebhook(input, deps): TagVerdict` where `input: { event: string; signatureHeader?: string; deliveryId?: string; rawBody: Buffer }`, `deps: { secret?: string; tagPattern?: RegExp }`. HMAC = `createHmac('sha256', secret).update(rawBody).digest('hex')` over the **raw `Buffer`** (never `rawBody.toString`), constant-time compared to `signatureHeader` after stripping `^sha256=` (reuse the `timingSafeEqual` helper proven in `src/webhook-registry.ts:147`).
- **boundary:** secret undefined → `{arm:false,503,'UPDATE_WEBHOOK_UNCONFIGURED'}` (fail-closed, NEVER 200/never treat unsigned as valid) · signature absent/malformed(not `sha256=<64hex>`)/mismatch → `{arm:false,401}` (401 not 500 on malformed) · `event:'ping'` → `{arm:false,200,'PING'}` no-op · `JSON.parse(rawBody)` throws (e.g. form-encoded body) → `{arm:false,200}` no-op (safe — no tag extractable) · `extractTag`→null OR tag fails `tagPattern` → `{arm:false,200}` no-op · else `{arm:true,tag,deliveryId}`. Clock-free by design: GitHub signs no timestamp, so the RWE ±300s window does NOT transfer — dedup is the caller's (DES-059) job.

### DES-059 — engine-side wiring: route + flag-writer + dedup + boot guard (`src/self-update.ts`, `src/server.ts`)
- **status:** done
- **traces:** ARCH-038, TASK-062
- **iter:** v11
- **signature:**
  - Route `POST /github/webhook` — a **distinct fixed prefix** (NOT under `/hooks/:id`, which the `server.ts:1036` dispatcher would capture and 404). Reads the body via `readBodyBuffer` (RAW) — never `readBodyDecoded` (GitHub signs wire bytes; the REQ-063 decode path would break HMAC). **Host-exempt**: `if (pathname === '/github/webhook')` skip the REQ-056 `isAllowedHost` allowlist before it runs (HMAC is this route's auth; the forwarded delivery carries a public Host); Origin stays fail-open-on-absent.
  - `writeUpdateFlag(tag: string): void` (FlagSink seam) — atomic `temp + rename`, mode `0600`, at `cfg.updateFlagPath`. The verifier core calls an injected `FlagSink` so UTs assert sink-called-with-T vs not-called without touching fs.
  - Dedup: `update_deliveries(deliveryId TEXT PRIMARY KEY, ts TEXT)` (`INSERT OR IGNORE`, engine-owned SQLite, `:memory:` in tests) in `cfg.selfUpdateDbPath` (default `join(workRoot,'self-update.db')` — the DB may live under workRoot; the helper never trusts it). A replayed valid delivery → 200, no second flag. `deliveryId` absent → process anyway (idempotent helper covers a double-arm).
  - Pending upsert: on `arm`, before the flag write, `INSERT OR REPLACE` the single `update_outcome` row (DES-061) with `{tag, status:'pending', ts: clock.isoNow()}`.
  - Secret: `RWE_SECRET_GITHUB_WEBHOOK_SECRET` via `loadSecretSourceFromEnv` (`RWE_SECRET_*` prefix, server-side only, never workspace-reachable, never logged, never on the dashboard).
  - Boot guard `assertUpdatePathsOutsideWorkRoot(paths, workRoots)` — `realpathSync` each configured flag/result path and refuse to start with `UPDATE_FLAG_INSIDE_WORKROOT` if any resolves inside any `workRoot` (RCE-prevention; reuses the ARCH-019 `WorkRootInsideProjectError` fail-fast shape). Guard runs ONLY on a configured path.
  - Config: `ServerConfig.updateFlagPath?`, `updateResultPath?`, `selfUpdateDbPath?`.
- **boundary:** **Feature-off by construction** — when BOTH the secret and `updateFlagPath` are unset, the route answers `503 UPDATE_WEBHOOK_UNCONFIGURED` (no invented default path that the engine may lack rights to create, no boot guard on an absent path). Response set is exactly: `202` armed (flag written) · `200` no-op (ping / non-tag / non-matching / dup-delivery / JSON-parse-fail) · `401` bad signature · `503` unconfigured. **Ordering:** dedup-check → pending-upsert → flag-write → 202. **Gate-5 seam consistency:** the ONLY time-reading points on this path are the dedup `INSERT` ts and the pending-upsert ts, both via the injected `Clock`; the verifier itself is clock-free; no method reads the wall clock.

### DES-060 — privileged updater helper + systemd units + shared outcome type (`deploy/rwe-update.sh`, `deploy/rwe-update.{path,service}`, `src/update-types.ts`)
- **status:** done
- **traces:** ARCH-039, TASK-063
- **iter:** v11
- **signature (a bash script's contract is argv/env/exit-codes/files — all pinned):**
  - `src/update-types.ts` — the **single home** of the cross-process schema (engine imports it; the helper doc references it verbatim): `type UpdateStatus = 'pending'|'applied'|'failed'|'skipped'`; `interface UpdateOutcome { tag: string; status: UpdateStatus; ts: string; detail?: string }`. If helper-writer and engine-reader are split without this one file, the JSON drifts with no compiler to catch it.
  - Env seams (injectable): `RWE_UPDATE_FLAG`, `RWE_UPDATE_RESULT`, `RWE_UPDATE_LOCK`, `RWE_OFFICIAL_REMOTE` (pinned remote), and command-prefix `GIT`/`NPM`/`SYSTEMCTL` (default the real binaries; tests substitute fakes; also the operator's replaceability seam for NVM-managed node etc.).
  - Exit codes (feed the result `detail`): `0` applied · `10` flag/tag validate-fail · `20` remote-resolve-fail (T not an existing tag on the official remote) · `30` build/checkout-fail (safe-abort before restart) · `40` already-on-T skip.
  - Flag content: **exactly the validated tag, one line, newline-terminated** — nothing shell-interpolatable; helper re-validates T against `TAG_PATTERN` (defence-in-depth) and only ever passes T as an `execFile`/array-arg, never `sh -c "… $T"`.
  - Result file: `UpdateOutcome` JSON written **atomically (temp+rename)**, `detail` capped ~4 KB (head+tail truncate; full log to journald).
  - `.path` unit: `PathExists=` + `PathChanged=` (an atomic rename into place does NOT fire `PathModified=`) triggering a oneshot `.service`; both units carry **ZERO** decision logic.
- **helper sequence (all on untrusted T):** flock `RWE_UPDATE_LOCK`; read the flag **within the lock** (latest-tag-wins); consume it (rename `→ .consumed` / rm, so the `.path` unit doesn't re-arm on a stale flag); re-validate T; `git fetch --tags` from `RWE_OFFICIAL_REMOTE`, resolve T to an existing tag SHA there (else exit 20, nothing changed); if HEAD already at that SHA → write `skipped`, exit 40; `git checkout <SHA>` (array-args); `npm ci && npm run build`; on any failure in fetch/checkout/build → **abort BEFORE `systemctl restart`** (prior good checkout keeps running), write `failed`, exit 30; else write `applied`, **flush to disk, THEN `systemctl restart rwe`**.
- **boundary:** flag **absent** at trigger (stale/duplicate re-fire after consume) → clean **exit 0 no-op**, distinct from exit 10, so a post-consume re-fire does not mark the oneshot failed in systemd. Safe-fail is the load-bearing first-class test: inject failing `NPM` → assert `SYSTEMCTL` NOT called + working tree still at the prior SHA + result `failed`. Write-ordering invariant: `applied` result flushed before restart, so the restarted engine (ARCH-034 crash-durability replays in-flight runs — no new drain machinery) ingests it at boot.

### DES-061 — observable version + last-update outcome (`src/server.ts`, `src/dashboard-page.ts`)
- **status:** done
- **traces:** ARCH-040, TASK-064
- **iter:** v11
- **signature:**
  - `GET /api/version → { version: string }` (reuse the `ENGINE_VERSION` from `resolveEngineVersion(exec?)`, `server.ts:39`; after a tag checkout `git describe --tags` yields T). `GET /api/status` gains `{ version, lastUpdate?: UpdateOutcome, interruptedRuns?: number }`.
  - Store: single durable row `update_outcome(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT)` in `selfUpdateDbPath` (deliberately NOT an audit/rollback-history DB). Written `pending` by DES-059, overwritten by the ingested result.
  - `readUpdateResult(path, readFileImpl?): UpdateOutcome | null` — **tolerant**: absent file → null (no update ever ran); malformed / half-written / unknown `status` → null (never throws, never 500); `detail` capped 4 KB.
  - Read points (no watcher daemon, no push channel): **at boot** (covers the applied case — the restart makes the engine ingest the flushed result) AND **lazily on `/api/status`/dashboard** (covers the failed case — the engine was never restarted). `interruptedRuns` = the ARCH-034 `hydrateAll` running→interrupted reclassify count (engine-side, NOT in the result file).
  - Dashboard update panel (`dashboard-page.ts`): renders `lastUpdate.{tag,status,ts,detail}` with a per-status color for `pending|applied|failed|skipped`; when `status==='applied'` and `interruptedRuns>0`, a call-to-action ("N runs interrupted by the update; use `workflow_resume`"). `textContent`/`JSON.stringify` only (XSS-safe, per KP-12).
- **boundary:** absent outcome → panel shows "no update recorded". **Stale-result guard:** an ingested result overwrites a `pending` row ONLY when `result.tag === row.tag`; a stale `applied` for T_old must NOT clobber a fresh `pending` for T_new (engine restarted for an unrelated reason while the helper is mid-build). **Gate-5 seam consistency:** `readUpdateResult` reads no clock; the outcome `ts` is the helper's (out-of-process); the engine-side pending `ts` uses the injected `Clock` (DES-059).

### DES-062 — real-tier validation paths + per-tier mock policy + DEPLOY acceptance (REQ-068..070)
- **status:** done
- **traces:** ARCH-038, ARCH-039, ARCH-040, TASK-065
- **iter:** v11
- **REQ-068 real path:** a signed GitHub `create` fixture (captured real body + its valid `X-Hub-Signature-256` over the raw bytes) POSTed to a real HTTP server bound to loopback with `RWE_SECRET_GITHUB_WEBHOOK_SECRET` configured → asserts the flag file is written containing exactly the tag + a `pending` row exists; the same body with a wrong signature → 401, no flag, no row. Real entrypoint = the `POST /github/webhook` route; real wiring = real SQLite side table + a tmp flag path outside workRoot.
- **REQ-069 real path:** a child-process integration harness — `execFile` `deploy/rwe-update.sh` against a `mkdtemp` throwaway git repo with `GIT` real but `NPM`/`SYSTEMCTL` pointed at fake shims recording argv: valid tag → checks out that tag's SHA + calls `systemctl restart`; foreign/nonexistent ref → exit 20, nothing changed; failing `NPM` → exit 30, `SYSTEMCTL` NOT called, tree at prior SHA, result `failed`.
- **REQ-070 real path:** full flow — arm a valid tag → helper applies → engine restarts → `GET /api/version` returns the new tag AND the dashboard update panel (Playwright-headless real-run, the established dashboard pattern) shows `applied`; a tag whose `npm run build` fails → the service stays up on the prior version and the panel shows `failed` for that tag.
- **Per-tier mock policy:** **unit** mocks freely — inject `{secret, tagPattern}`, a `FlagSink` spy, an in-memory dedup (isolates the pure verifier + tolerant reader). **integration** uses real adjacent components — real HTTP server, real SQLite, real `git` against a throwaway repo, tmp flag/result paths; mock ONLY `npm`/`systemctl` (genuinely un-runnable in CI, via the command-prefix seam). **E2E/acceptance MUST NOT mock the SUT's own boundaries** — a real signed delivery through the real route, the real helper against a real git repo; external tools go through test shims/sandbox credentials only.
- **DEPLOY acceptance (TASK-065):** GitHub webhook content-type `application/json` (the HIGH-severity omission — a form-encoded body HMAC-verifies but JSON-parse-fails → no-op, and the operator must set this), event subscription (create + push tags), `RWE_SECRET_GITHUB_WEBHOOK_SECRET` sourcing; a reverse-proxy snippet forwarding ONLY `POST /github/webhook` to `127.0.0.1` with the engine loopback-bound; the Host-allowlist exemption note; the flag/result/lock path convention (engine-user-owned `0700`, OUTSIDE every workRoot); systemd-only self-update scope (docker-compose keeps running but updates manually — Option A); the deferred-hardening (GPG signed-tag verify, `npm ci --ignore-scripts`) and single-instance-ceiling notes.

```mermaid
classDiagram
  class SelfUpdateWebhook {
    <<pure, clock-free>>
    +extractTag(event, body) string_or_null
    +verifyTagWebhook(input, deps) TagVerdict
  }
  class SelfUpdate {
    +route POST /github/webhook
    +writeUpdateFlag(tag) void
    +dedup update_deliveries
    +assertUpdatePathsOutsideWorkRoot()
  }
  class UpdateOutcomeStore {
    +update_outcome id CHECK(id=1)
    +upsertPending(tag)
    +readUpdateResult(path) UpdateOutcome_or_null
  }
  class RweUpdateHelper {
    <<external deploy artifact, bash>>
    +flock+consume flag
    +fetch/verify/checkout/build
    +safe-fail abort-before-restart
    +write UpdateOutcome result
  }
  class UpdateTypes {
    <<shared contract>>
    +UpdateStatus pending|applied|failed|skipped
    +UpdateOutcome tag,status,ts,detail
  }
  SelfUpdate --> SelfUpdateWebhook : verify
  SelfUpdate --> UpdateOutcomeStore : upsert pending
  SelfUpdate ..> RweUpdateHelper : flag file (privilege boundary)
  RweUpdateHelper ..> UpdateOutcomeStore : result file (ingested at boot/lazy)
  UpdateOutcomeStore --> UpdateTypes
  RweUpdateHelper --> UpdateTypes
```

## v11 Sprint 2 decision rationale (self-update — DES-058..062)
- **Panel:** r1 only (`adversarial.r1.md` opus + `quality-dimensions.r1.md` sonnet); stances **complementary** (quality explicitly endorses the privsep shape adversarial defends) → the conditional Round-2 rebuttal trigger was NOT met, synthesized directly. QM `safety_class` → no functional-safety/cybersecurity lenses.
- **Route path — distinct `/github/webhook`, NOT `/hooks/:id` (adversarial R1, HIGH).** The `server.ts:1036` dispatcher captures `/hooks/<id>` and 404s an unknown id before the GitHub verifier runs. A distinct prefix avoids a fragile dispatch-order pin. Both lenses converge.
- **Host-allowlist exemption for this one route (adversarial P2 + quality consumability, HIGH).** A forwarded GitHub delivery carries a public Host; REQ-056 would 403 it before HMAC. Exempt `/github/webhook` (HMAC is strictly stronger than the Host allowlist, which defends browser DNS-rebinding, not a server-to-server POST). Not a hole in the uniform policy — a second, narrow, HMAC-gated auth root, documented in DEPLOY. Both lenses picked "exempt" over "proxy rewrites Host" (fragile).
- **bash helper, not TS (adversarial testability⟂privsep; RESOLVED bash-but-seamed).** The privilege boundary is the load-bearing security property; putting privileged logic back in a Node process erodes exactly the seam privsep buys. Command-prefix/env seams give replaceability + testability WITHOUT crossing the boundary. Quality endorsed. Every meaningful step lives in the SCRIPT (child-process integration harness), the `.path`/`.service` units carry zero logic.
- **Single-row outcome + `pending` status, NOT a history table (adversarial simplicity ⟂ quality observability; RECONCILED).** Adversarial held the ARCH line (one `update_outcome` row = "last outcome", REQ-070). Quality's "armed-but-stuck is invisible" gap is closed by the SAME single row taking a `pending` status at flag-write (`INSERT OR REPLACE`) — not a new subsystem, not a history DB. The 4-state enum `pending|applied|failed|skipped` unions quality's `pending` (observability) and adversarial's `skipped` (idempotent already-on-T). History remains a future-REQ candidate.
- **Feature-off when unconfigured (advisor simplification, fail-closed).** No safe invented default flag path exists (the engine may lack rights to create `/var/lib/...`). Secret+flag-path both unset → the route 503s (self-update disabled); the boot `UPDATE_FLAG_INSIDE_WORKROOT` guard runs only on a configured path. Dissolves the default-path problem rather than solving it.
- **Flag lifecycle — consume-within-flock + `PathExists=` (adversarial R3 + quality R5, MEDIUM-HIGH).** flock alone does not close the overlapping-arm race (a systemd path trigger firing during the oneshot is dropped). The helper reads the flag WITHIN the lock (latest-tag-wins) and consumes it (rename/rm); the `.path` unit uses `PathExists=` (an atomic rename does not fire `PathModified=`) so a flag landing mid-build re-fires the unit when the oneshot deactivates. Flag-absent re-fire → clean exit 0 (not a systemd failure).
- **`detail` cap 4 KB (quality R7).** Truncate head+tail; the full log belongs to journald, not the SQLite row.
- **docker-compose scope — Option A, systemd-only (quality replaceability; Karpathy).** Self-update requires the systemd deployment; docker-compose keeps running but updates manually. Documented explicitly in DEPLOY (silence would create false expectations); Option B (docker sidecar invoking the same script) noted as a future path, not built.
- **content-type `application/json` (quality R1, HIGH).** A form-encoded body HMAC-verifies (HMAC is over raw bytes regardless) but JSON-parse-fails → design fail-closes to a 200 no-op (no tag extractable), AND DEPLOY must instruct `application/json` so the webhook actually arms.
- **Stale-result guard (advisor).** An ingested result overwrites a `pending` row only when tags match — a stale `applied` for T_old must not clobber a fresh `pending` for T_new when the engine restarted for an unrelated reason mid-build.
- **Deferred, flag-don't-build (both lenses agree — recorded, NOT `needs_clarification`):** GPG `git tag -v` signed-tag verify + `npm ci --ignore-scripts` (documented hardening, not v1 blockers); auto-resume of interrupted runs on boot (`config.autoResumeOnUpdate` is an open question — surface the interrupted-run COUNT now, don't auto-resume: a run stopped mid-flight for review must not silently restart); distributed trace-ID across the four-process boundary (the flag/result files carry the tag as the correlation key). **Budget-on-crash-resume (quality R4)** — re-derive `budget.spent()` from journaled agent usage on `_requireLive` rehydration — belongs to ARCH-034's path, NOT this slice; carried as a real defect candidate in the journal, no speculative ARCH here.
- **Residual accepted (adversarial R6, per REQ-070 full-auto):** a malicious tag whose build SUCCEEDS is not caught by safe-fail (which protects availability, not integrity) — bounded by privsep + official-remote-pin; the only real defence is repo/secret integrity + the deferred signed-tag verify. Single-instance ceiling (self-update is host-local, incompatible with multi-replica) documented, not fixed.

## v11 Sprint 3 — n8n-style Morandi graph dashboard (DES-063..069; ARCH-041..045)

### DES-063 — trigger provenance `startedBy` on the durable run record (src/types.ts, src/run-manager.ts, src/store/sqlite-run-store.ts)
- **status:** done
- **traces:** ARCH-041, TASK-066
- **signature:** `type StartedBy = { type:'client'|'webhook'|'schedule'|'chain'|'unknown'; id?:string }` (closed discriminated union; `'unknown'` is the legal sentinel for pre-migration/internal-caller rows, never coerced to `client`). Added to `RunSpec`, `RunStatusView`, `RunSummary`; passed through `workflow_status` (via ARCH-028 pass-through) and `GET /api/runs/:id`. Set at `RunManager.start()` by each caller: mcp-facade→`{type:'client'}`; `WebhookRegistry.deliver`→`{type:'webhook',id:<webhookId>}`; scheduler→`{type:'schedule',id:<name>}`; `ContinuationStore.fire`→`{type:'chain',id:<parentRunId>}`. `id` stored opaquely (a string; no source-registry). Persisted in the `runs` table as a **nullable** `started_by` TEXT column (additive migration, no backfill job) — NOT the REQ-055 terminal snapshot (must render for in-progress runs).
- **boundary-conditions:** absent at read time (legacy row OR internal/test `start()` caller) → read model coalesces to `{type:'unknown'}` (total, never throws, never blank). `chain` enum value is required NOW (a chained run must not crash the source-node builder) even though its display label is derived at render (DES-065). Store round-trip / restart preserves `startedBy` (persistence IT).
- **iter:** v11

### DES-064 — pure graph model + layout: `GraphPayload` + `LayoutNode` adapter + `layoutGraph` (src/dashboard.ts, src/server.ts)
- **status:** done
- **traces:** ARCH-042, TASK-067
- **signature:** `type GraphPayload = { kind:'skeleton'; cells:LayoutCell[]; edges:LayoutEdge[]; warnings:string[]; name:string } | { kind:'run'; cells:LayoutCell[]; edges:LayoutEdge[]; warnings:string[]; truncated?:boolean; startedBy:StartedBy; terminalAt?:number }`. **Both arms carry logical `cells`** — the skeleton arm is run through the same adapter→`layoutGraph` server-side so the browser renderer is a single branchless projection. `LayoutNode` = a narrow adapter type over `SkeletonNode` (only the fields layoutGraph uses: id, kind, label, phase, group/parallel, depth) built by `toLayoutNodes(SkeletonNode[]):LayoutNode[]`. `layoutGraph(nodes:LayoutNode[], liveAgents:AgentRecord[], opts?:{maxNodes?:number}) → { cells:LayoutCell[]; edges:LayoutEdge[]; warnings:string[]; truncated?:boolean }` is **PURE** (no clock/store/DOM). `LayoutCell = { id:string; col:number; row:number; laneSpan:number; kind; state?:AgentState; label:string; frame?:string; depth?:number }` — **logical grid cells, never device pixels** (col by phase→parallel-group→nesting depth; row by index within a parallel group). `LayoutEdge = { from:string; to:string }`. Exposed additively on `GET /api/runs/:id/dag` (internal seam, not a frozen public contract; JSDoc: "may change without notice"). `terminalAt?` added to `RunStatusView` (ARCH-028 pass-through → `workflow_status`).
- **boundary-conditions:** **total — never throws.** Node-id is a pure deterministic function of node identity (agent→`agentId`; trigger/phase/frame→a stable synthetic key) so pan/zoom + click-selection survive the 3s re-render — an id must not reshuffle per poll. Skeleton-overlay join is **phase → parallel-group → ordered set of AgentRecords (ordered by `startedAt`/dispatch seq), NOT a 1:1 `label+phase` lookup** (else two same-label parallel agents collapse into one box and a live agent silently vanishes). An unmatched **live** agent (loop/conditional/dynamic label the static scan missed) falls back to frame-based `buildDagModel` grouping and still renders (**never drop a live agent**) AND pushes `warnings:["agent <id> unmatched to skeleton: frame-grouped"]`. An unmatched **skeleton** node renders inert. Empty run → trigger node only. `maxNodes` default **200** (== the client "N more" ceiling, DES-065 — one shared constant) → over-limit sets `truncated:true` and a `warnings[]` entry. `warnings[]` surfaced in BOTH the JSON response and the SVG (DES-065).
- **iter:** v11

### DES-065 — Morandi n8n SVG renderer + cell→pixel mapper + `morandiFrameHue` (src/dashboard-page.ts)
- **status:** done
- **traces:** ARCH-043, TASK-068
- **signature:** `cellToPixel(cell:LayoutCell, box:BoxSize):Rect` — **pure**, deterministic (the only place logical cells become device geometry; a box-size restyle touches zero model/topology tests). `morandiFrameHue(frame:string):string = palette[stableHash(frame) % palette.length]` — **pure**, so a frame never flickers hue across the poll; the Morandi palette lives in ONE scoped CSS-custom-property set (one-file swap). Hand-rolled inline SVG: a `<g>` root transformed for pan/zoom, an edge layer, node boxes, per-frame depth-nested tinted background containers (one hue per frame via `morandiFrameHue`, labeled with the sub-workflow name, each wrapping exactly its own agents; depth-2 frame nests inside its parent). Shared constant `MAX_GRAPH_NODES = 200` drives both the client "N more" affordance and the server `maxNodes` (DES-064).
- **boundary-conditions:** **`textContent`-only invariant (security-load-bearing, no-auth plane):** every run-derived string — agent label, model id, workflow name, tool/skill names, AND text inside SVG `<text>` — is set via `textContent`, never `innerHTML` (extends REQ-067 verbatim; hand-rolled SVG, no vendored graph lib). Node-shape selection is data-driven off `node.kind` (keep the renderer near-branchless — branching lives in DES-064's pure layout). Page body never scrolls horizontally (a wide graph pans within its own `overflow` container). Empty/degraded/truncated payload renders an empty-or-partial canvas + a `warnings[]` badge, never a throw. Single-workflow run → one plain region.
- **iter:** v11

### DES-066 — harness capture at dispatch: `HarnessDescriptor` + pure `redactHarness` + `onHarness` hook + run-status-aware `deriveAgentRecords` (src/types.ts, src/gateway/*.ts, src/agent-executor.ts, src/run-store.ts)
- **status:** done
- **traces:** ARCH-044, TASK-069
- **signature:** `HarnessDescriptor = { model:string; prompt:string /*4KB head+tail cap*/; tools:string[]; skills:string[]; mcpServers:string[]; surfaceType:'curated'|'none' }`. New `TranscriptEvent.kind` value `'harness'` (extend the union in src/types.ts). `redactHarness(resolved) → HarnessDescriptor` is **PURE** — names only, never a resolved MCP config, never a provider key, never a resolved `${secret:}` value. Emission seam = an optional async hook `onHarness?(h:HarnessDescriptor):Promise<void>` injected into `GatewayClient.invoke` options, called **eagerly at session-build (post-curation), before `query()`** — **two call sites, one hook:** the SDK client at `claude-agent-sdk-client.ts:483` projects `{model:modelName, prompt:req.prompt, tools:curatedTools, skills:<materialized .claude/skills dirs>, mcp:Object.keys(mergedMcp), surfaceType:'curated'}`; the direct-fetch/LiteLLM client calls it at its own model-resolution point with `surfaceType:'none'` and `tools/skills/mcpServers=[]`. The executor wires `onHarness` → `sink.appendTranscript(runId, agentId, {kind:'harness', ...})`.
- **boundary-conditions:** **`harness===null` ⟺ the agent was never dispatched (queued/idle)** — one unambiguous meaning (converged, adversarial.r2 §2.1 folded the r1 defer; direct-fetch now emits). 4KB prompt cap = **first 2KB + last 2KB + `…[truncated]…` marker** (task instructions land at the tail in the context-injection pattern). **Latest-wins dedupe keyed on agentId** (the bounded `SCHEMA_RETRY_ATTEMPTS` loop can build a session more than once → a later harness supersedes). **Required `deriveAgentRecords` change (run-store.ts):** drop `if(!usage)continue`; new **run-status-aware** rule — a `harness` event with no later `usage` ⟹ `running` **only on an in-process parent**, but ⟹ `queued` on an `interrupted`/`suspended` parent (it re-dispatches on resume — never paint a live spinner on a dead run); a `usage` event ⟹ `done`/`failed`; neither ⟹ never-dispatched (absent, renders `idle` while in-process). **H2 single-source decision:** `redactHarness` projects from the gateway's post-curation resolved values (REQ-073 needs the resolved surface, which the pre-gateway `SessionInitRecord.allowlist` cannot authoritatively give); `SessionInitRecord` (DES-026) stays the pre-dispatch security-audit head (secretHandleNames/settingSources/REQ-021 guard) and is NOT re-projected into the panel — exactly ONE record feeds the harness panel, no field resolved twice, no two overlapping harness records. **Accepted VM-sandbox limit:** a script may pass a secret VALUE as a prompt string (captured at the transcript's trust level); the engine invariant is only "never substitutes a `${secret:}` handle into a prompt."
- **iter:** v11

### DES-067 — harness detail panel + `workflow_agent_log` shaping + two-tier no-secret proof (src/mcp-facade.ts, src/server.ts, src/dashboard-page.ts)
- **status:** done
- **traces:** ARCH-045, TASK-070
- **signature:** extend the existing `workflow_agent_log` response (MCP tool + HTTP) with `harness:HarnessDescriptor|null` and `hasMore:boolean` — **no new `/harness` route**. Shaping layer **projects the `kind:'harness'` event to the top-level `harness` field AND strips it from the returned `events` window** (sent exactly once; never evicted by the 50-message display cap, since it is the first event and a naive cap-last-50 would drop it). Optional `?limit=N&offset=M` on the HTTP path; the MCP tool enforces the same 50-cap and returns `hasMore`. Canonical `AgentRecord.state` stays `queued|running|done|failed`; `idle`/`completed` are **render-time-only** aliases (`queued→"idle"`, `done→"completed"`) — enforced by a serialization-layer UT per response shape (`workflow_status`, `workflow_agent_log`, `GET /api/runs/:id` all carry only canonical values). `chain` source-node label = `"chain via <startedBy.id[0..7]>"` via `textContent`, degrading to `"chain"` when no id.
- **boundary-conditions:** transcript fetched **on-click only** (never on the 3s poll); display capped at 50 messages. Unknown agentId → the uniform typed error envelope (not a crash). `harness:null` for a never-dispatched agent → panel shows `idle`. **`textContent`-only** in the panel (the `prompt` is the most attacker-influenceable field on the no-auth page — all names + prompt via `textContent`, no `innerHTML`). `mcpServers` JSDoc caveat: "configured-at-dispatch fingerprint, names only (never URLs — URLs may carry tokens), not liveness-checked." **Two-tier no-secret PROOF (both required):** (1) a fast pure-mapper UT on `redactHarness` (a build carrying a resolved-secret MCP config → output has the server NAME only, never plaintext); (2) one Gate-7.5 headless-browser assertion that the rendered detail-panel DOM contains no secret plaintext (catches a future `innerHTML` regression between payload and pixel that capture-time purity alone cannot).
- **iter:** v11

### DES-068 — budget re-derivation on crash-resume: pure fold + resume-path hydration + double-count boundary (src/run-store.ts, src/run-manager.ts)
- **status:** done
- **traces:** ARCH-044, TASK-071
- **signature:** a **pure fold** over the same journal usage events read by DES-066's `deriveAgentRecords` that **returns** an accumulated `spentTokens:number` (e.g. `sumUsageTokens(events):number`) — the read-model function stays a pure fixture-testable fold with **no side effect** on shared state. The impure **resume path** (`_requireLive`/rehydration, the one existing impure seam) hydrates `RunGuard.spent` from that returned value — the guard mutation does NOT live in the read model.
- **boundary-conditions:** **double-count boundary test (adversarial add):** usage already reflected in a REQ-055 terminal snapshot must **NOT** be re-added when journal events replay on resume (else a resumed run under-runs its cap). Own IT sharing the same journal read as DES-066. **Must land before Gate 7.5** (closes the named budget-on-crash-resume defect deferred in DES-062's rationale).
- **iter:** v11

### DES-069 — real-tier validation paths + per-tier mock policy (REQ-071..073)
- **status:** done
- **traces:** ARCH-042, ARCH-043, ARCH-044, ARCH-045, TASK-067, TASK-068, TASK-069, TASK-070
- **REQ-071 real path:** start a real run (real `RunManager` + SQLite store) and a static workflow skeleton → `GET /api/runs/:id/dag` returns a `GraphPayload` with a trigger source node labeled by `startedBy.type`, phase columns, a 2-agent parallel "Draft" group and a "Verify" node connected by edges; a headless-browser (Playwright, the established dashboard pattern) opens the graph and asserts the trigger/parallel/verify nodes + drawn edges render and the page body does not scroll horizontally. Real entrypoint = `GET /api/runs/:id/dag` + the dashboard SPA; real wiring = real store + real `layoutGraph` (never mocked at E2E).
- **REQ-072 real path:** a real composed run calling `workflow('sub')` → the dag payload carries depth-nested frames; the headless assertion shows two differently-tinted labeled containers each wrapping only its own agents, and a depth-2 frame nested inside its parent.
- **REQ-073 real path:** click a real agent box → `workflow_agent_log` returns `harness` with model/prompt/tool/skill/mcp names + status; the headless DOM assertion contains the model + prompt + tool/skill/mcp names and **no secret plaintext**; a queued agent shows `idle`, a running agent `running` (live-updates on the poll), a finished agent `completed · N tok`.
- **Per-tier mock policy:** **unit** mocks freely — pure fixtures for `layoutGraph`, `redactHarness`, `morandiFrameHue`, `cellToPixel`, `deriveAgentRecords`, the budget fold, the canonical-state serializer (isolate logic; inject clock/store where needed). **integration** uses real adjacent components — real SQLite store, real journal, real HTTP handler, the real `onHarness`→sink→`deriveAgentRecords` replay path; mock ONLY the LLM provider network (a fake gateway that still invokes the real `onHarness` hook with faked model output). **E2E/acceptance MUST NOT mock the SUT's own boundaries** — real engine process, real HTTP, real SVG render via headless browser, real store/journal; the agent dispatch uses a real (sandbox/cheap) model or a seeded deterministic agent — `layoutGraph`/`redactHarness`/the sink/the render path are never mocked.
- **iter:** v11

```mermaid
classDiagram
  class GraphModel {
    <<pure, no clock/store/DOM>>
    +toLayoutNodes(SkeletonNode[]) LayoutNode[]
    +layoutGraph(nodes, liveAgents, opts) GraphLayout
    +join phase-group-orderedSet
  }
  class GraphPayload {
    <<internal seam, not frozen>>
    +kind skeleton|run
    +cells LayoutCell[]
    +edges LayoutEdge[]
    +warnings string[]
    +startedBy StartedBy
    +terminalAt? number
  }
  class SvgRenderer {
    <<browser, textContent-only>>
    +cellToPixel(cell, box) Rect
    +morandiFrameHue(frame) string
    +MAX_GRAPH_NODES 200
  }
  class HarnessCapture {
    +redactHarness(resolved) HarnessDescriptor
    +onHarness hook (2 call sites)
    +deriveAgentRecords run-status-aware
    +sumUsageTokens(events) number
  }
  class HarnessDescriptor {
    +model string
    +prompt string 4KB head+tail
    +tools/skills/mcpServers string[]
    +surfaceType curated|none
  }
  class AgentLogShaping {
    +harness HarnessDescriptor|null
    +strip kind:harness from events
    +hasMore boolean
    +canonical state serializer UT
  }
  class RunManager {
    +start() sets startedBy
    +resume() hydrates RunGuard.spent
  }
  GraphModel --> GraphPayload : builds
  GraphPayload --> SvgRenderer : rendered by
  HarnessCapture --> HarnessDescriptor : projects
  HarnessCapture --> AgentLogShaping : journaled event
  RunManager --> HarnessCapture : deriveAgentRecords on resume
  RunManager --> GraphPayload : startedBy
```

## v11 Sprint 3 decision rationale (n8n graph dashboard — DES-063..069)
- **Panel:** BOTH rounds ran; r2 WAS triggered (D1 derive-vs-capture, D6 flexbox-vs-SVG materially conflicted). Synthesized from the converged r2 stances (adversarial.r2 + quality-dimensions.r2) with r1 as supporting context. QM `safety_class` → no functional-safety/cybersecurity lenses.
- **H1 logical cells vs literal pixels — ADOPT CELLS (both lenses converged in r2).** `layoutGraph` emits `{col,row,laneSpan}`; a pure `cellToPixel` mapper in the renderer does geometry. Refines ARCH-042's literal `{x,y,width,height}` while preserving its discriminating constraint (deterministic, browser-free coordinates untestable via `getBoundingClientRect`): the topology UT asserts ordering, never pixels, and a box restyle breaks zero model tests. Not ARCH drift — a testability refinement of the same server-authoritative-coordinate decision.
- **H2 single harness source — DECIDED (adversarial r1/quality r2 both flagged; synthesizer picks).** `SessionInitRecord` (DES-026) is a real journaled security-audit head built pre-gateway; REQ-073 needs the **post-curation resolved** surface, which that record cannot authoritatively give. So `redactHarness` projects from the gateway's resolved `curatedTools`/`mergedMcp`/`modelName`; `SessionInitRecord` stays for its distinct security purpose and is not re-projected into the panel → one record feeds the panel, no field resolved twice, no two overlapping harness records.
- **H3 run-status-aware derive rule — ADOPT (both lenses endorsed).** `harness⟹running` only on an in-process parent; on `interrupted`/`suspended` a harness-without-usage agent reads `queued` — never a live spinner on a dead run.
- **R2 direct-fetch harness — CONVERGED (adversarial.r2 §2.1 folded the r1 defer).** Both call sites emit; `surfaceType:'curated'|'none'` is in `HarnessDescriptor` from the initial type; `harness:null` means "never dispatched" only. Quality r2's "one live disagreement" was written concurrently, not after — treated as converged, not open.
- **GraphPayload stays an internal seam (adversarial HELD, quality conceded r2).** One in-tree consumer rewritten this sprint; a frozen/versioned public contract is speculative flexibility (Karpathy). Type shared, elevation deferred.
- **LayoutNode adapter — narrow input type, NO parser-swap layer (converged).** `layoutGraph` consumes only the `SkeletonNode` fields it uses; that narrow structural type IS the seam, coupling documented — no speculative future-proofing framework (Karpathy tie-break).
- **Budget re-derivation — SEPARATE ticket (adversarial r2 §2.2 reshaped quality R3).** A pure fold **returns** `spentTokens`; the resume path (not the read-model) hydrates the guard — preserves `deriveAgentRecords` purity; plus a snapshot/journal double-count boundary test; gated before Gate 7.5. Closes the defect deferred in DES-062's rationale.
- **Converged specifics pinned (both lenses):** `maxNodes`==client "N more"==**200** (one constant); head+tail 2KB/2KB + `…[truncated]…`; latest-wins dedupe by agentId; join phase→group→ordered-set (tie-order `startedAt`/dispatch seq); harness projected-to-top-level + stripped-from-events + cap-exempt; `hasMore` on both surfaces; canonical-state serialization UT; `{type:'unknown'}` sentinel; `"chain via <id[0..7]>"` degrading to `"chain"`; node-id stability; `warnings[]` in JSON and SVG; `textContent`-only incl. SVG `<text>`; `mcpServers` names-only JSDoc caveat.
- **Seam consistency (Exit Gate 5):** the layout/redact/derive/budget functions are **pure and read no time** (run status comes from the injected run record, not a wall clock); the one impure `onHarness`→sink append rides the already-injected `_clock`/`RunStore` seams. Invariant held: **every method that reads time takes the injected clock** — no method in this slice reads the wall clock directly.
- **Deferred, not `needs_clarification` (both lenses agree):** per-agent MCP liveness probe (`mcpLivenessCheckedAt?` future field); distributed trace-ID; `GET /health`; SSE (poll+`terminalAt?` bounds it). All future-REQ candidates, no speculative ARCH here.

## v11 F1 — home dashboard: grouped cards + reliability metrics (DES-070 / DES-071 / DES-072)

### DES-070 — home cards view: pure `buildHomeView` 3-way grouping + `GET /api/home` + dashboard render (src/dashboard.ts, src/server.ts, src/dashboard-page.ts)
- **status:** done
- **traces:** ARCH-046, TASK-072
- **signature:** `type WorkflowMetrics = { successRate:number|null; avgDurationMs:number|null; terminalCount:number }` (from DES-071). `type WorkflowCard = { name:string; description:string; group:'running'|'registered'|'other'; metrics:WorkflowMetrics; activeRunId?:string; latestRunId?:string }`. `type HomeView = { running:WorkflowCard[]; registered:WorkflowCard[]; other:WorkflowCard[] }`. **Pure** `buildHomeView(catalog:Array<{name:string;description:string}>, runs:RunSummary[], metrics:Map<string,WorkflowMetrics>) → HomeView` (no clock/store/DOM). Exposed additively as `GET /api/home` → `HomeView` inside `handleDashboardRequest` (server-authoritative, recomputed per 3s poll; top-level router predicate widened to match `/api/home`). Browser home (`src/dashboard-page.ts`): three labeled groups; each card renders `description` (sub-line), the two metrics (DES-071), and a **mini non-interactive skeleton preview** — fetch the existing `GET /api/workflows/:name/skeleton`, run it through the SAME `layoutGraph` (DES-064) + `cellToPixel` (DES-065) at a reduced `BoxSize`, no pan/zoom; click a card → open the full graph view (DES-064/065): the run graph of `activeRunId` when RUNNING, else the predicted-skeleton graph.
- **boundary-conditions:** **grouping rule** — `RUNNING` = a catalog workflow with ≥1 run whose status is non-terminal (`running|queued|suspended|interrupted`); `REGISTERED` = a catalog workflow with no such active run; `OTHER` = run `name`s absent from / not in the catalog (inline-script or deregistered), keyed by `name` or the synthetic label `(inline)`. **Total — never throws.** OTHER card (or any workflow whose script the catalog no longer has) → no skeleton → **placeholder preview**, still clickable to `latestRunId`'s graph if present. Empty catalog + no runs → three empty groups. **`textContent`-only** for every card/preview run-derived string (name, description, metric labels, SVG `<text>`) — extends the ARCH-043 / REQ-067 no-auth-plane invariant. A workflow appears in exactly one group (RUNNING wins over REGISTERED; catalog membership decides REGISTERED vs OTHER).
- **iter:** v11

### DES-071 — per-workflow reliability metrics: pure `computeWorkflowMetrics` fold + additive `RunSummary.terminalAt` (src/dashboard.ts, src/types.ts, src/run-store.ts, src/store/sqlite-run-store.ts)
- **status:** done
- **traces:** ARCH-047, TASK-073
- **signature:** **Pure** `computeWorkflowMetrics(runs:RunSummary[]) → Map<string, WorkflowMetrics>` — groups by `run.name`, folds each group: `terminalCount` = count of runs with status ∈ `{completed,failed,stopped}`; `successRate` = `completedCount / terminalCount`; `avgDurationMs` = mean of `Date.parse(terminalAt) − Date.parse(createdAt)` over terminal runs with a parseable `terminalAt`. **No clock read** (only already-timestamped terminal runs count). Requires `terminalAt?:string` added **additively** to `RunSummary` (src/types.ts) and populated by `RunStore.listRuns()` in BOTH stores from the first terminal-transition `ts` (in-memory: the recorded transition; SQLite: `MIN(ts)` over terminal transitions — no migration, derived from existing `run_transitions`). `GET /api/home` calls this once and passes the map to `buildHomeView` (DES-070).
- **boundary-conditions:** **zero terminal runs → `{successRate:null, avgDurationMs:null, terminalCount:0}`** → card renders `"— / —"` (the REQ-075 named divide-by-zero / NaN boundary; a workflow with only in-flight/`interrupted`/`queued` runs hits this too). `interrupted`/`suspended`/`running`/`queued` never count toward either metric. Duration **includes queue wait** (`terminalAt − createdAt`, an explicit design choice — no separate dispatch timestamp is persisted). A terminal run whose `terminalAt` is absent/unparseable (legacy) is counted in `successRate` but skipped from the duration mean; if ALL terminal runs of a workflow lack `terminalAt` → `avgDurationMs:null` while `successRate` still computes. Total — never throws, never emits `NaN`.
- **iter:** v11

### DES-072 — real-tier validation paths + per-tier mock policy (REQ-074, REQ-075)
- **status:** done
- **traces:** ARCH-046, ARCH-047, TASK-072, TASK-073
- **REQ-074 real path:** register two workflows (one with a `meta.description` + a `parallel(...) → verify` skeleton), start a real run (real `RunManager` + SQLite store) on one and leave the other idle, plus one inline-script run → `GET /api/home` returns the first under `running`, the second under `registered`, the inline run under `other`; a headless browser (Playwright, the established dashboard pattern) opens the home and asserts the three group headers render, the customer-service card shows its description + a mini `2-parallel → verify` preview SVG, and clicking the card opens the full graph view. Real entrypoint = `GET /api/home` + `GET /api/workflows/:name/skeleton` + the dashboard SPA; real wiring = real store + real `buildHomeView`/`layoutGraph`/`cellToPixel` (never mocked at E2E).
- **REQ-075 real path:** seed a workflow with 4 `completed` + 1 `failed` terminal runs (+ known createdAt/terminalAt) in a real SQLite store → `GET /api/home` card shows `80%` success and the mean of the 5 durations; a never-run registered workflow shows `"— / —"`; the headless DOM assertion reads both values off the card. Real entrypoint = `GET /api/home`; real wiring = real store + real `computeWorkflowMetrics` over real persisted transitions.
- **Per-tier mock policy:** **unit** mocks freely — pure fixtures for `computeWorkflowMetrics` (terminal/zero-terminal/legacy-missing-terminalAt cases) and `buildHomeView` (3-way grouping, OTHER, single-group membership); inject the run list, no store/clock. **integration** uses real adjacent components — real SQLite store + real `run_transitions` + real `listRuns()` populating `terminalAt` + the real HTTP `/api/home` handler; no mock of the store or the fold. **E2E/acceptance MUST NOT mock the SUT's own boundaries** — real engine process, real HTTP, real SVG mini-preview render via headless browser, real store; `buildHomeView`/`computeWorkflowMetrics`/`layoutGraph`/`cellToPixel`/the skeleton endpoint are never mocked.
- **iter:** v11

### Decision rationale — v11 F1 (self-decided, no panel; grouped lenses self-applied)
- **Fix-mode QM lean self-decision:** two read-only card-UI REQs on shipped seams (DES-054 discovery/skeleton, DES-063 startedBy, DES-064/065 layout+render, `RunStore.listRuns`); no cross-cutting trade-off → no expert panel per the F1 dispatch. Grouped lenses applied as a checklist below.
- **Adversarial group:** *interface-contract* — `HomeView`/`WorkflowCard`/`WorkflowMetrics` are narrow additive types on one new `GET /api/home`, no existing tool/route semantics change; *boundary/error* — every named failure pinned in DES-070/071 boundary-conditions (zero-terminal null, legacy missing `terminalAt`, no-catalog-script placeholder, single-group membership, empty catalog); *testability* — both cores are pure folds over an injected run list (fixture-testable, no clock/store), the render path reuses the two-tier `textContent`/headless-DOM proof pattern. Simplicity tie-break (Karpathy): REUSE `/skeleton` + `layoutGraph` + `cellToPixel` for the mini preview and `listRuns` for metrics — zero new layout/render code, one new endpoint, one additive field.
- **Quality dimensions (conventional system):** *observability* — metrics + grouping are recomputed server-side per poll and rendered as plain numbers (no hidden state); *replaceability* — pure folds decoupled from store/DOM, swappable behind their signatures; *consumability* — one additive JSON endpoint (`GET /api/home`), existing skeleton endpoint reused; *self-sustainability* — total functions that degrade to `"— / —"` / placeholder / empty groups rather than throw on any missing/legacy data.
- **Seam consistency (Exit Gate 5):** `buildHomeView` and `computeWorkflowMetrics` are pure and **read no wall clock** (duration derives from persisted `terminalAt`/`createdAt` only) — no injected-clock asymmetry introduced; the existing `RunStore` clock seam is untouched.

<!-- ── v12 (REQ-076..079) — system_info metrics · enriched models_list · precise schemas + drift-lock ── -->

### DES-073 — `SystemProbe` port + lazy-TTL `SystemInfoSampler` + pure `buildSystemInfo` host shaper (src/system-probe.ts, src/system-info.ts, src/types.ts, src/server.ts, src/dashboard-page.ts)
- **status:** draft
- **traces:** ARCH-048, TASK-074
- **signature:** Three pieces on the testability seam. **(1) Port** (`src/system-probe.ts`, the untestable OS boundary, raw counters only, no shaping): `interface RawHostSnapshot { cpu:{perCore:Array<{idleMs:number;totalMs:number}>}|null; loadAvg:[number,number,number]; cores:number; mem:{totalBytes:number;freeBytes:number}|null; disk:{path:string;blockSize:number;blocks:number;bfree:number;bavail:number}|null }`; `interface SystemProbe { sampleHost():Promise<RawHostSnapshot>; sampleProcesses(deadlineMs:number):Promise<RawProcSnapshot> /* DES-074 */ }`. Real impl = `os.cpus()/loadavg()/totalmem()/freemem()` + `fs.promises.statfs(workRoot)`, no shell-out; `StubSystemProbe` implements the same interface with per-field fault injection. **(2)** `class SystemInfoSampler { constructor(private probe:SystemProbe, private clock:Clock, private ttlMs=1500){} get(opts:{topN?:number}):Promise<SystemInfoView> }` — `get()` triggers `probe.sampleHost()` unless the cached snapshot is younger than `ttlMs`; caches full raw + previous snapshot. **(3) Pure** `buildSystemInfo(cur:RawHostSnapshot, prev:RawHostSnapshot|null, ctx:{sampledAt:string;windowMs:number|null}, opts:{topN:number}, procShape) → SystemInfoView` — all delta math + degrade logic, no I/O. Output (additive `types.ts`): `type Reason = 'awaiting-second-sample'|'sample-window-too-short'|'timeout'|'unsupported-platform'|'probe-error'`; `interface Degraded { reason:Reason; detail?:string }`; `interface SystemInfoView { cpu:{cores:number;loadAvg:[number,number,number];utilizationPct:number|null;utilizationDegraded?:Degraded}; memory:{totalBytes:number;usedBytes:number;freeBytes:number;usedPct:number}|Degraded; disk:{path:string;totalBytes:number;usedBytes:number;freeBytes:number;usedPct:number}|Degraded; process:ProcessInfoView; sampledAt:string; windowMs:number|null }`. Named constant `UTIL_PCT_CONVENTION = 'host-aggregate-0-100'` is the single source of truth the shaper, the schema description (DES-077), and the drift-lock all read. Wire seam: `ServerConfig.systemInfo?:SystemInfoSampler` (mirrors `modelCatalog`/`issueReporter`); ONE sampler instance feeds the `system_info` MCP tool case AND `GET /api/system` — sample once. The tool case returns the uniform `{status, result?, error?}` envelope. Dashboard System panel renders the view `textContent`-only via the 3 s poll on `GET /api/system`.
- **boundary-conditions:** **Clock seam (Exit Gate 5) — every method that reads time takes the injected `clock`:** the TTL-freshness check, `sampledAt` (`clock.now()` ISO), and `windowMs` (delta span) ALL derive from `clock`; the ONLY timer outside the seam is the `~150ms Promise.race` inside the real probe's `sampleProcesses` (OS boundary — the stub simulates timeout by returning `procsDegraded`, no real wait). **host `utilizationPct` = aggregate 0–100 clamped** (`usedTotal/totalDelta`, `CLK_TCK=100` hardcoded with comment). First call, no prior snapshot → `utilizationPct:null` + `{reason:'awaiting-second-sample'}`, `windowMs:null`, `sampledAt` = call time. `totalDelta===0` (same jiffy) → `null` + `{reason:'sample-window-too-short'}` (the divide-by-zero). Counter-wrap / negative delta → clamp `[0,100]`, never negative. `memory.usedPct` from `os.freemem` = MemFree not MemAvailable (disclosed in schema, no `/proc/meminfo` reader). `disk.usedPct = used/(used+bavail)` (df convention), `used=(blocks-bfree)*blockSize`, `free=bavail*blockSize`; single mount `statfs(workRoot)` only, never enumerates filesystems. Any probe field `null` → that block degrades independently; the tool NEVER throws. Concurrent within-TTL calls may each sample (no single-flight — bounded + idempotent). **DEPLOY deliverable:** DEPLOY names `system_info` as a host-reconnaissance surface coupled to the standing "never expose publicly until auth lands" invariant (REQ-005); interim control = loopback-bind + Host/Origin net-guard (ARCH-009/033). `system_info` tool description carries a call-motivation hint and the null-section contract (DES-077).
- **iter:** v12

### DES-074 — process metrics on the same probe: engine-self + host Top-N (comm-only) + system-wide stats (src/system-probe.ts, src/system-info.ts)
- **status:** draft
- **traces:** ARCH-049, TASK-074
- **signature:** Extends the port: `interface RawProcSnapshot { self:{threads:number|null; fdCount:number|null}; procs:Array<{pid:number; comm:string; utimeJiffies:number; stimeJiffies:number; state:string; rssBytes:number}>|null; procsDegraded?:Degraded }`; `SystemProbe.sampleProcesses(deadlineMs:number):Promise<RawProcSnapshot>`. Engine-self observables from the Node runtime (`process.pid`/`process.uptime()`/`process.cpuUsage()`/`process.memoryUsage().rss`) + `/proc/self/status` Threads + `/proc/self/fd` count for threads/fdCount only (smaller Linux surface, self-consistent with the delta window — refinement of ARCH-049's `/proc/self/stat`, flagged in rationale). Parts (b)+(c) from ONE bounded async pass: `readdir('/proc')` → numeric pids → per-pid `stat`+`comm`, `Promise.race([enumerate(), timeout(~150ms)])`. Output `ProcessInfoView` (nested on `SystemInfoView.process`): `{ self:{pid:number;uptimeSec:number;rssBytes:number;cpuPct:number|null;threads:number|null;fdCount:number|null}; topN:Array<{pid:number;name:string;cpuPct:number|null;memBytes:number}>; system:{total:number;byState:Record<string,number>}|Degraded }`. Per-process `cpuPct` = `%-of-one-core` (may exceed 100 summed) over `windowMs` from the sampler's per-pid prev-jiffies cache; the shaper applies `topN` (cache stores the FULL list — a `topN:50` call cannot poison a concurrent `topN:5` read).
- **boundary-conditions:** **`name` = `/proc/<pid>/comm` ONLY — argv structurally absent:** the record type has no `cmd`/`argv`/`cmdline` field and the real impl never opens `/proc/<pid>/cmdline` (capture-time redaction-by-construction, the HIGH control both lenses ratify); UT asserts the shape has no argv-shaped field. **TOCTOU:** pid gone between `readdir` and `stat`/`comm` → skip it (ENOENT swallowed per-pid), never throw. **Timeout** → `procs=null`, `procsDegraded={reason:'timeout'}` → `topN` degrades to `[]`, `system` to `{reason:'timeout'}`; self-part still returns. **Non-Linux / no `/proc`** → `{reason:'unsupported-platform'}`, no macOS/Windows probe built. **Newborn pid** (absent from prev) → `cpuPct:null` (no delta). **Top-N sort** = `cpuPct` desc, `memBytes` tiebreak; `null` cpuPct sorts last (ordered as `-1`) — deterministic. **Per-pid cache wholesale-replaced each sample** (never accumulated) → O(live pids) bounded (~<2 MB at 50k pids, comment); system stats = total pid count + state-char breakdown (field 3 of `/proc/<pid>/stat`) from the same pass.
- **iter:** v12

### DES-075 — enriched `models_list`: pure `enrichModelEntry` post-`filterCatalog` layer (src/model-catalog.ts, src/server.ts)
- **status:** draft
- **traces:** ARCH-050, TASK-075
- **signature:** `type Stability = 'stable'|'variable'|'best-effort'`; `interface EnrichedModelEntry extends ModelEntry { capability:string; stability:Stability; costLevel:number|null }` (`modalities` already on `ModelEntry` — surfaced, no new field). Exported pure helpers (all UT-able): `enrichModelEntry(e:ModelEntry):EnrichedModelEntry`; `classifyStability(e:ModelEntry):Stability` (paid/curated → `stable`, `location:'local'` Ollama → `variable`, OpenRouter `:free`/besteffort → `best-effort`); `computeCostLevel(e:ModelEntry):number|null` over `COST_LEVEL_BANDS` (named ascending band table) on the scalar from **promoted-to-exported** `maxPricePerMOf(price):number|null` — `'free'→0`, `'unknown'→null` (never guessed), above top band → clamp `10`, typed `integer|null`. **Insertion point:** `filterCatalog` reads only base `ModelEntry` fields (confirmed `model-catalog.ts:225`), so enrich AFTER filter — `server.ts:803` → `filterCatalog(entries, args).map(enrichModelEntry)` (cheaper, order-safe). Fields additive/optional/non-breaking (absent from any `required` array), computed at call time, never persisted (no SQLite column/migration).
- **boundary-conditions:** `capability`: `len>200` → `slice(0,199)+'…'` (total 200); `≤200` verbatim; empty/null source → `"${provider} model"` (NEVER null); rendered `textContent`-only (source strings may embed HTML). `costLevel` description states scale (`0=free/local … 10=dearest`) AND null contract (`null = price unknown, do NOT infer cheapness`). Monotonicity holds by construction; the property test sorts by the SAME `maxPricePerMOf` scalar and asserts `costLevel` non-decreasing (a test against out-price would red spuriously when in/out prices cross). `stability` enum carries a JSDoc extension-point note ("to add a level: add the literal here, update `classifyStability`, extend the drift-lock"). Curated capability table carries a `// Last reviewed: <date>. Unlisted models fall back to source description.` comment. Future-filter coupling: if a filter ever keys on `costLevel`, enrich/filter order must flip — not built now (Karpathy), recorded as a constraint.
- **iter:** v12

### DES-076 — `GET /api/models` route + dashboard Models section (src/server.ts, src/dashboard-page.ts)  ← closes REQ-078 dashboard-observable gap
- **status:** draft
- **traces:** ARCH-050, TASK-075
- **signature:** Additive `GET /api/models` inside `handleDashboardRequest` returns `EnrichedModelEntry[]` in the uniform `{status, result?, error?}` envelope, using the SAME `buildCatalog`→`filterCatalog`→`map(enrichModelEntry)` builder as the `models_list` tool (top-level router predicate widened to match `/api/models`). Dashboard page gains a Models section rendering columns `provider | model | capability | stability | costLevel | modalities`, all `textContent`-only, populated by the existing 3 s poll.
- **boundary-conditions:** Empty catalog → empty section, never throws. `costLevel:null` renders as `"—"` (not `0`). `capability` already capped by DES-075. No new enrichment logic here — pure consumption of DES-075; ARCH-050 named `enrichModelEntry` + the tool but NO route, and there is no `/api/models` / Models section today (adversarial + quality R1, both HIGH) — without this the REQ-078 dashboard clause is unverifiable.
- **iter:** v12

### DES-077 — precise self-describing `TOOL_DEFS` schemas + one structured drift-lock test (src/server.ts, test/schema-drift.test.ts)
- **status:** draft
- **traces:** ARCH-051, TASK-076
- **signature:** Extend the declarative `TOOL_DEFS` object literals (pattern near `server.ts:214`, no framework). **`system_info` inputSchema = exactly one param `topN`**: `{type:'integer', default:5, minimum:1, maximum:50}`, description states unit + effect + clamp ("integer 1–50, default 5; how many host processes part (b) returns; out-of-range CLAMPED to [1,50]"). `sortBy` + `sections` rejected (D-v12-B). `cpuPct` semantics in-schema ("% of one core over the last sampled TTL window, not a lifetime average; null when awaiting a second sample"); host `utilizationPct` per `UTIL_PCT_CONVENTION` (host-aggregate 0–100). `system_info` description ALSO carries: a call-motivation hint ("call before scheduling compute-intensive work to check host headroom") + the null-section contract ("any section may be null with a reason when the OS probe fails; handle null per section independently"). `models_list` description gains the enriched output shape (`capability`, `stability` enum values, `costLevel` 0–10 + null-when-unknown). **Drift-lock** (`test/schema-drift.test.ts`) reads the **served `tools/list`** (in-process handler call = the surface REQ-079 pins) and asserts STRUCTURED FACTS per param: name present, `default` present, `enum`/range present where applicable, a unit keyword (`bytes`/`percent`/`seconds`) in the description, the effect named, and the `system_info` description contains a `"null"` keyword (null-section caveat proxy) — NOT a golden-string snapshot.
- **boundary-conditions:** `topN` = CLAMP not reject (documented in schema = contract-honest); non-integer → `Math.floor` then clamp. Drift-lock is the ONLY drift signal (test-time, not runtime) — a comment in the test file states "run before every push that touches `TOOL_DEFS`". This DES creates NO `UT-*`/`IT-*` items — the verifier owns those.
- **iter:** v12

### DES-078 — real-tier validation paths + per-tier mock policy (REQ-076, REQ-077, REQ-078, REQ-079)
- **status:** draft
- **traces:** ARCH-048, ARCH-049, ARCH-050, ARCH-051, TASK-074, TASK-075, TASK-076
- **REQ-076 real path:** live Linux rwe engine (real `SystemInfoSampler` + real `SystemProbe`, no stub) → call the real `system_info` MCP tool AND `GET /api/system`; assert `cpu.cores`/`loadAvg` present, `memory`/`disk` non-negative bytes that track `free`/`df` on the same host (used+free ≈ total), `sampledAt` recent, and the dashboard System panel renders the figures (headless DOM). Real entrypoint = `system_info` tool + `GET /api/system` + dashboard SPA; real wiring = real OS probe (never mocked at E2E).
- **REQ-077 real path:** same live engine → assert the engine-self entry `pid` == the live rwe service pid and `rssBytes` tracks `/proc/self`; `topN` list length ≤ N and ordered by `cpuPct` desc; system-wide total count is a positive integer close to `ps -e | wc -l`; assert NO process record carries an argv/cmdline field. Real entrypoint = `system_info` tool; real wiring = real `/proc` pass.
- **REQ-078 real path:** live engine with a real catalog fetch → `models_list` returns entries each carrying `capability`/`stability`/`costLevel`/`modalities`; an Ollama/`:free` model has `costLevel:0`, a top paid model a high `costLevel`+`stability:'stable'`; `costLevel` monotonic with price across the catalog; `GET /api/models` + dashboard Models section show the columns (headless DOM). Real entrypoint = `models_list` + `GET /api/models` + dashboard; real wiring = real `buildCatalog`+`enrichModelEntry` (never mocked at E2E).
- **REQ-079 real path:** read the **served `tools/list`** from the running engine (not TOOL_DEFS in-process only) → assert `system_info` + `models_list` each declare every param with type + range/enum + default + unit + effect, and the drift-lock passes against that served surface.
- **Per-tier mock policy:** **unit** mocks freely — `StubSystemProbe` (per-field fault injection: null cpu/mem/disk, timeout, unsupported-platform, awaiting-second-sample, same-jiffy) + `FixedClock` drive every `buildSystemInfo`/sampler degrade+delta path; pure fixtures for `classifyStability`/`computeCostLevel`/`enrichModelEntry`/the monotonicity property test; the drift-lock is a pure served-schema assertion. **integration** uses real adjacent components — the real HTTP `GET /api/system`+`/api/models` handlers over the real sampler/catalog builder; only the OS `SystemProbe` may be a stub if the CI host is non-Linux. **E2E/acceptance MUST NOT mock the SUT's own boundaries** — real engine process, real OS probe on a real Linux host, real `/proc`, real catalog fetch, real HTTP + headless-browser dashboard; `SystemInfoSampler`/`buildSystemInfo`/`enrichModelEntry`/the served `tools/list` are never mocked.
- **iter:** v12

```mermaid
classDiagram
  class SystemProbe {
    <<port, untestable OS boundary, raw counters only>>
    +sampleHost() RawHostSnapshot
    +sampleProcesses(deadlineMs) RawProcSnapshot
  }
  class StubSystemProbe {
    <<test double, per-field fault injection>>
  }
  class SystemInfoSampler {
    <<lazy-TTL cache; caches full raw + prev snapshot + per-pid prev-jiffies>>
    +get(opts) SystemInfoView
  }
  class buildSystemInfo {
    <<pure shaper, no I/O; all delta + degrade math>>
    +UTIL_PCT_CONVENTION host-aggregate-0-100
    +Reason closed enum + detail
  }
  class SystemInfoView {
    +cpu utilizationPct|Degraded
    +memory|Degraded
    +disk|Degraded
    +process ProcessInfoView
    +sampledAt/windowMs
  }
  class Clock
  class Server {
    +ServerConfig.systemInfo? SystemInfoSampler
    +system_info tool case
    +GET /api/system
    +GET /api/models
  }
  class ModelCatalog {
    +buildCatalog / filterCatalog
    +maxPricePerMOf (promoted export)
  }
  class enrichModelEntry {
    <<pure, post-filterCatalog>>
    +classifyStability(e) Stability
    +computeCostLevel(e) integer|null
    +COST_LEVEL_BANDS
  }
  class EnrichedModelEntry {
    +capability string
    +stability Stability
    +costLevel number|null
    +modalities
  }
  class SchemaDriftLock {
    <<structured facts over served tools/list>>
  }
  StubSystemProbe ..|> SystemProbe
  SystemInfoSampler --> SystemProbe : samples
  SystemInfoSampler --> Clock : injected
  SystemInfoSampler --> buildSystemInfo : shapes via
  buildSystemInfo --> SystemInfoView : returns
  Server --> SystemInfoSampler : one instance feeds tool + HTTP
  Server --> enrichModelEntry : maps catalog
  ModelCatalog --> enrichModelEntry : filtered entries
  enrichModelEntry --> EnrichedModelEntry : produces
  SchemaDriftLock --> Server : asserts served tools/list
```

### Decision rationale — v12 (ARCH-048..051, REQ-076..079: `system_info` metrics + enriched `models_list` + precise schemas)
- **Panel provenance / synthesize-only:** synthesized from `.panel/design/adversarial.r1.md` (opus, three trade-off lenses) + `quality-dimensions.r1.md` (sonnet, four cross-cutting lenses), BOTH freshly rewritten 2026-08-14 for v12 and explicitly superseding the v11-Sprint-3 residue at this path. The `*.r2.md` files at this path are v11-Sprint-3 residue (dated 2026-08-09) — NOT inputs. Per the synthesize-only dispatch I did NOT re-spawn a panel; **r2 not run** because the two r1 stances are complementary (both want the injectable `SystemProbe`, the pure shaper, enrich-after-`buildCatalog`, the structured drift-lock, comm-not-cmdline, `statfs(workRoot)`, `sampledAt`/`windowMs`, and both independently flag the same HIGH `GET /api/models` gap). QM `safety_class` → no functional-safety / cybersecurity lenses.
- **Altitude:** system↔agent seam — data is system-altitude observability (host CPU/mem/disk, process facts, catalog), but the consumption contract is agent-altitude (REQ-079's schema-only LLM consumer; REQ-078's fields exist for agent model-selection). Both altitudes applied.
- **Task split:** ARCH-048+049 FUSED into TASK-074 (shared port/sampler/shaper; splitting creates a broken intermediate where the port exists but the sampler can't instantiate — both lenses ratify). ARCH-050 = TASK-075, independent/parallelizable, and it ABSORBS `GET /api/models` + the dashboard Models section (DES-076) since REQ-078's dashboard clause is otherwise unverifiable. ARCH-051 = TASK-076, LAST (depends on both schemas existing).
- **cpu conventions pinned (quality R2 precondition):** host `utilizationPct` = aggregate 0–100 clamped; per-process `cpuPct` = %-of-one-core (may exceed 100 summed). Single source of truth = named constant `UTIL_PCT_CONVENTION` read by shaper + schema description + drift-lock, so all three assert the same keyword.
- **Resolved conflicts (who conceded):** (1) `topN` out-of-range — interface-contract wanted a typed `SYSTEM_INFO_INVALID` error; testability+Karpathy won CLAMP documented in schema (a documented clamp is contract-honest, no new error surface for a read-only knob) — contract lens conceded, dissent recorded (revisit if a caller must KNOW it was clamped). (2) degrade `reason` — closed `Reason` enum + optional free-text `detail` (mirrors shipped `FailureEnvelope{kind,providerDetail}`); enum wins agent-branchability cheaply, `detail` keeps the probe-error escape hatch — simplicity "a string is enough" conceded to the enum. (3) enrich order — enrich-AFTER-filter (cheaper, safe because filters read only base fields), the coupling recorded as a future-filter constraint; uniform-pipeline conceded. (4) concurrent within-TTL sampling — allow the double sample (bounded 150 ms, idempotent), no single-flight — boundary lens conceded to Karpathy.
- **Refinement flagged:** engine-self rss/cpu/uptime/pid from the Node runtime (`process.*`) rather than `/proc/self/stat`; `/proc/self` used only for threads+fdCount (smaller Linux surface, self-consistent with the delta window).
- **Named deferred gaps (quality's condition: named, not silently dropped — each a future-REQ candidate, none built for v12 per Karpathy):** (a) no cross-correlation of system metrics with run performance (min hook = `systemInfo` snapshot in the run journal start-event); (b) `GET /health` liveness endpoint still absent; (c) `capability` free text limits programmatic routing — future `tags:string[]` parallel to `modalities`; (d) no feedback loop from `system_info` to `RunGuard` concurrency (adaptive concurrency under host pressure) — `system_info` is the prerequisite telemetry. Security recon deferral (per-tool disable/public-bind suppression) ratified with the loopback invariant as the interim control; the DEPLOY recon-note IS an in-scope deliverable (DES-073).
- **Seam consistency (Exit Gate 5):** DES-073 states every method that reads time takes the injected `clock` (TTL check, `sampledAt`, `windowMs`); the only timer outside the seam is the `~150ms Promise.race` inside the real probe's `sampleProcesses` (OS boundary; the stub simulates timeout via `procsDegraded`, no real wait) — no injected-clock asymmetry.

---

## v13 — REQ-080 engine-pull `seedRef` (ARCH-052, ARCH-053)

### DES-079 — pure egress gate `isEgressAllowed` + `normalizeSeedRefAllowlist` (src/seedref-egress.ts)
- **status:** draft
- **traces:** ARCH-052, TASK-077
- **signature:**
  ```ts
  export type EgressVerdict =
    | { ok: true; url: URL }
    | { ok: false; code: 'SEEDREF_DISABLED' | 'SEEDREF_EGRESS_DENIED'; reason: string };
  export function isEgressAllowed(repoUrl: string, allowlist: readonly string[]): EgressVerdict;
  export function normalizeSeedRefAllowlist(raw: unknown): string[]; // config-load; throws codedError('SEEDREF_ALLOWLIST_INVALID', <entry-named>)
  ```
- **matching:** deny-by-default. Absent/empty allowlist → `SEEDREF_DISABLED`. Else `new URL(repoUrl)`; verdict is `SEEDREF_EGRESS_DENIED` on ANY of: non-`https:` scheme (`file:`/`ext:`/`ssh:`/`git:`/`http:`), non-empty `username`/`password` (userinfo), `URL` parse throw, or no prefix match. Match = `url.origin + url.pathname` starts-with a normalized entry (origin+path with an ENFORCED trailing `/`). `normalizeSeedRefAllowlist` appends the trailing `/` and rejects any non-`https`/unparseable entry (reject, do not clamp); `isEgressAllowed` re-appends the trailing `/` idempotently so it is TOTAL on any `string[]` (loader-free UTs). NOT a reuse of `net-guard.ts` (that is the HTTP server-bind/host-header plane, not URL egress).
- **boundary UT table (each REQ-080 example = one row, zero network):** `http://169.254.169.254/`, `http://localhost/`, private-range IP, `file://x`, `ssh://`, `git://`, `http://…` → `SEEDREF_EGRESS_DENIED`; `https://user:pass@github.com/HsuJavis/x` → DENIED (userinfo); `https://github.com/HsuJavisEvil/x` vs allow `https://github.com/HsuJavis/` → DENIED (trailing-`/` over-match guard); `[]`/absent allowlist → `SEEDREF_DISABLED`; `https://github.com/HsuJavis/foo` → `ok`. No private-IP connect-ban by design (D-v13-B: air-gapped internal forge is a legitimate allowlisted target).
- **iter:** v13

### DES-080 — seed-source mutual-exclusion + sha/url shape + pre-`createRun` precedence (submission validator / run-manager fail-fast tier)
- **status:** draft
- **traces:** ARCH-052, TASK-077
- **signature:** in the pure spec-validation module: `seedSourceCount(spec) = count of {seed, seedManifest, seedRef} that are a non-empty presence` (`seed:[]`/`seedManifest:[]` are inert, matching the existing branch-picker). Errors raised via the existing `codedError(code, msg)` throw convention (NOT a return-union) in the pre-`createRun` tier next to `INVALID_SEED_SPEC`/`MISSING_BLOBS`.
- **codes (pre-`createRun`, no run created):** `SEED_SOURCE_CONFLICT` (>1 source); `SEEDREF_DISABLED` (seedRef given, allowlist absent/empty); `INVALID_SEED_SPEC` (`sha` not full 40- or 64-hex — a branch/short-sha/ref is rejected here to protect the K3 provenance anchor; `repoUrl` empty/non-string); `SEEDREF_EGRESS_DENIED` (fails `isEgressAllowed`); `CAS_UNAVAILABLE` (seedRef needs a configured `CasStore`, exactly like seedManifest at run-manager.ts:226 — `putBlob` target).
- **precedence (pinned, deterministic — same malformed request always yields the same code):** `SEED_SOURCE_CONFLICT` → `SEEDREF_DISABLED` → `INVALID_SEED_SPEC` (sha/url shape) → `SEEDREF_EGRESS_DENIED` → `CAS_UNAVAILABLE`. Precedence is its own UT row-per-transition.
- **boundary:** "creates no run before any network" is its OWN assertion — for each pre-run code, the injected fake fetcher's `fetch` is NEVER invoked AND `store.createRun` is NEVER invoked.
- **iter:** v13

### DES-081 — `SeedRefFetcher` port + request/result types + pure `buildGitInvocation` (src/seedref-fetcher.ts, src/types.ts)
- **status:** draft
- **traces:** ARCH-053, TASK-077, TASK-078
- **signature:**
  ```ts
  // types.ts — additive
  export interface RunSpec { /* … */ seedRef?: { repoUrl: string; sha: string }; }
  // seedref-fetcher.ts
  export interface SeedRefRequest { repoUrl: string; sha: string; timeoutMs: number; maxTotalBytes: number; maxFileBytes: number; }
  export interface SeedRefResult { resolvedSha: string; bytesTransferred: number; entries: ManifestEntry[]; dropped: string[]; }
  export interface SeedRefFetcher {
    fetch(req: SeedRefRequest, putBlob: (sha: string, bytes: Buffer) => Promise<void>): Promise<SeedRefResult>;
  }
  export function buildGitInvocation(req: SeedRefRequest): { args: string[]; env: Record<string, string> }; // pure, UNIT-asserted
  ```
- **contract:** interface DECLARED in TASK-077 (no I/O) so the RunManager test fake and the real impl share one compile-time contract; impl in TASK-078. `entries: ManifestEntry[]` is load-bearing — it feeds the EXISTING `materializeManifest` branch (D-v13-A); this is why the port returns entries, NOT a `{ok,resolvedSha,bytes}` outcome union. `putBlob` is `Promise`-returning and MUST be `await`ed (CasStore.putBlob is async; a later `readBlobSync` in materialize must not race a pending write). Fetcher takes NO clock dep — `latencyMs`/`fetchedAt` are stamped by RunManager (DES-083). Future `authToken?` rides the `SeedRefRequest` bag with no breaking change (D-v13-F).
- **iter:** v13

### DES-082 — hardened-git impl: `buildGitInvocation` + killable child + byte caps + two-step sha-verify + CAS stream (src/seedref-fetcher.ts)
- **status:** draft
- **traces:** ARCH-053, TASK-078
- **signature/flow:** (1) `buildGitInvocation` → env `{ GIT_CONFIG_NOSYSTEM:'1', HOME:<isolated tmp>, GIT_CONFIG_GLOBAL:<isolated tmp>, GIT_ALLOW_PROTOCOL:'https', GIT_TERMINAL_PROMPT:'0' }` (NO `...process.env` spread) + args incl `-c http.followRedirects=false -c submodule.recurse=false --depth 1`; a table UT asserts each flag present AND ambient env NOT inherited. (2) spawn git into a fresh temp dir; wrap in a `Promise.race` against a `setTimeout(timeoutMs)` that calls `child.kill('SIGTERM')` then SIGKILL — the ONLY timer in the fetcher; temp-dir removed on EVERY exit path (success/fail/timeout). (3) `git ls-tree -l -r <sha>`: sum sizes → if total > `maxTotalBytes` or any file > `maxFileBytes` → throw `SEEDREF_TOO_LARGE` BEFORE reading a blob; skip `120000`(symlink)/`160000`(gitlink) modes into `dropped[]`. (4) two-step verify (quality S-A1) inside the hardened env: `git rev-parse HEAD` == requested `sha` AND `git cat-file -t <sha>` == `commit`; any deviation → `SEEDREF_SHA_MISMATCH`. (5) for each surviving blob → `putBlob(sha256, bytes)` (CasStore stores under computed hash → poisoning-safe) → push `{path, sha256, exec?}` into `entries`. git-absent/unreachable/timeout/non-2xx all FOLD into `SEEDREF_FETCH_FAILED` + `reason` (mirrors `GITHUB_API_ERROR`; do NOT mint `SEEDREF_TIMEOUT`).
- **boundary:** distinct codes earn their keep only when remediation+test-tier differ — `SEEDREF_TOO_LARGE` (deterministic pre-download size check, "shrink the repo") and `SEEDREF_SHA_MISMATCH` (provenance) stay distinct; everything else folds. `execFileSync` is FORBIDDEN (uninterruptible → `timeoutMs` cosmetic, leaks temp dir + burns an admission slot).
- **iter:** v13

### DES-083 — RunManager post-`createRun` wiring + `RunStatusView.seedRef` observability (src/run-manager.ts, src/types.ts)
- **status:** draft
- **traces:** ARCH-053, TASK-078
- **signature:**
  ```ts
  // types.ts — additive on RunStatusView
  seedRef?: { resolvedSha: string; bytes: number; latencyMs: number; fetchedAt: string; // ISO
              dropped: string[]; failCode?: 'SEEDREF_FETCH_FAILED' | 'SEEDREF_SHA_MISMATCH' | 'SEEDREF_TOO_LARGE'; failDetail?: string; };
  ```
- **flow:** in `start()` AFTER `createRun` and BEFORE the `materialize` branch-pick (run-manager.ts ~L244): when `spec.seedRef` present, `const t0 = clock.now(); const r = await fetcher.fetch({repoUrl,sha,timeoutMs,maxTotalBytes,maxFileBytes}, (sha,b)=>cas.putBlob(ns,sha,b));` then set `spec.seedManifest = r.entries` (or bind entries directly) so it FALLS INTO the existing `materializeManifest(ws, entries, readBlobSync)` + `mkdir` + `initGitBaseline` tail unchanged (entries are regular files only; `.git` never materialized — guard-parity is structural). Stamp `seedRef` view via injected `Clock` (`latencyMs = clock.now()-t0`, `fetchedAt = clock.iso()`); merge `r.dropped` onto `seedRef.dropped` (SeedResult from materialize is discarded today — DES does NOT invent a new channel; `dropped`/failure ride the new `seedRef` field). On fetch throw → record `seedRef.failCode/failDetail` (truncate `failDetail` ≤200 chars, never a secret) + set run `failed` via existing `entry.resultError {code,message}` (same in-memory durability as every other run failure — deliberate Karpathy parity, no new column). `workflow_run` still returns `runId` immediately (REQ-005): the fetch is in the async run body, not the tool call.
- **testability:** RunManager UTs inject a fake `SeedRefFetcher` (network-free): (i) entries → assembles via seedManifest branch, artifacts match; (ii) throws `SEEDREF_FETCH_FAILED` → status failed, workspace NOT started against empty tree; (iii) throws `SEEDREF_SHA_MISMATCH` → typed fail; (iv) returns `dropped` → surfaced on `seedRef`. `latencyMs` deterministic under the fake `Clock`.
- **seam (Exit Gate 5):** every time read on the seedRef path takes the injected `Clock` — `t0`, `latencyMs`, `fetchedAt` all via `clock`; NO RunManager or fetcher method reads wall-clock time; the sole timer is the child-kill `setTimeout` inside the fetcher (OS-boundary, simulated in UTs by a fake that resolves/rejects without real wait).
- **iter:** v13

### DES-084 — `workflow_run` TOOL_DEFS `seedRef` schema + error hints + drift-lock (src/server.ts, src/mcp-facade.ts, test/schema-drift.test.ts)
- **status:** draft
- **traces:** ARCH-052, TASK-079
- **signature:** add to `TOOL_DEFS.workflow_run.properties`: `seedRef:{ type:'object', description:<mutual-exclusion + requires seedRefAllowlist (SEEDREF_DISABLED) + pre-run/post-run error split prose>, properties:{ repoUrl:{type:'string'}, sha:{type:'string'} }, required:['repoUrl','sha'] }`. Plumbing hop (implementer greps here): thread `seedRef?` through `mcp-facade.workflow_run` (src/mcp-facade.ts:82) → `runManager.start` and the `server.ts:727` `workflow_run` case arg-cast. Error payloads: `SEEDREF_DISABLED` carries `hint:"add seedRefAllowlist:[…] to engine config"`; `SEEDREF_EGRESS_DENIED` carries `attempted:{scheme,host}` (NEVER the full URL, NEVER the allowlist contents — D-REDACT non-disclosure).
- **drift-lock assertions (structured facts, not golden string):** `seedRef` param present; `.properties.repoUrl` + `.properties.sha` present; description contains `"SEEDREF_DISABLED"`, `"seedRefAllowlist"`, `"mutually exclusive"`.
- **iter:** v13

### DES-085 — real-tier validation path + per-tier mock policy (REQ-080)
- **status:** draft
- **traces:** REQ-080, TASK-077, TASK-078, TASK-079
- **signature:** real-tier path = a real `workflow_run({seedRef:{repoUrl:"https://github.com/HsuJavis/<tiny>", sha:<fixed 40-hex>}})` against an engine configured with `seedRefAllowlist:["https://github.com/HsuJavis/"]`; the run materializes the tree and a script Reads one file back / `workflow_artifacts` lists them; `repoUrl:"http://169.254.169.254/"` → `SEEDREF_EGRESS_DENIED` with zero outbound connection; no allowlist → `SEEDREF_DISABLED`. Real entrypoint = the MCP `workflow_run` tool; real wiring = real `CasStore` + real git subprocess.
- **per-tier mock policy:** UNIT — mock freely (fake `SeedRefFetcher`, in-table allowlist); the whole SSRF matrix + precedence + `buildGitInvocation` flags are pure UTs, no network/clock. INTEGRATION — real `CasStore` + real git against a PINNED PUBLIC repo at a fixed sha, SKIPPED when offline (mirrors the real-tier LLM VAL skip-without-key); NOT a `file://` local repo (the `GIT_ALLOW_PROTOCOL=https` + https-only gate forbids it — a local-file IT would not exercise the real path). E2E/acceptance — MUST NOT mock the engine's own boundaries (gate, fetcher, CAS, git); the pinned public pull is the real network touch. The "creates no run before network" property is asserted at unit tier (fetcher + `createRun` never invoked).
- **iter:** v13

### Decision rationale — v13 (DES-079..085, REQ-080 engine-pull seedRef)
- **Panel provenance / r2 NOT run:** synthesized from `.panel/design/adversarial.r1.md` (opus — interface-contract / boundary-error / testability, Karpathy tie-break) + `quality-dimensions.r1.md` (sonnet — observability / replaceability / consumability / self-sustainability). QM `safety_class` → no functional-safety/cybersecurity lenses (correct for developer tooling). The two r1 stances are COMPLEMENTARY (adversarial supplies the decomposition + security shape; quality names the observable surface + config knobs), so r2 was not triggered. Task split follows both lenses' shared seam: pure-before-network (TASK-077) vs network-after-`createRun` (TASK-078), + a small consumability/schema task (TASK-079).
- **Fetcher interface — adversarial's shape wins, quality CONCEDES.** Quality's `SeedFetchOutcome = {ok,resolvedSha,bytes}` union has no `entries: ManifestEntry[]`, so it cannot drive the existing `materializeManifest` branch — the whole point of D-v13-A. Adopted adversarial's `fetch(req, putBlob) → SeedRefResult{entries,dropped,…}` (DES-081). Quality's forward-compat concern (future `authToken`) is already satisfied — `SeedRefRequest` is an object bag, so the field adds without a break.
- **Error channel — throw `codedError` / `resultError`, NOT a return-union.** Matches the shipped run-manager convention (pre-`createRun` throws `codedError`; post-`createRun` failure via `entry.resultError {code,message}`). Adversarial's fake-throws UTs assume it; quality's typed-verdict union was for the pure gate only (kept there as `EgressVerdict`).
- **Observability O-S1 (`RunStatusView.seedRef`) adopted (NOT scope creep).** ARCH-053 already committed "records on the run's observable record"; quality named the MCP-visible surface (a caller polling `workflow_status` cannot read an engine log). Adversarial's minimal three fields (resolvedSha/bytes/latency) + failCode ride ON this field (DES-083). CONCEDED to quality on the surface, held adversarial's field minimalism. `dropped[]` also rides here because the current materialize lambdas DISCARD `SeedResult` (run-manager.ts:250) — no existing `rejected` channel to merge into; carrying it on `seedRef` avoids inventing a parallel reporting path (Karpathy). Deferred quality O-S3 `seedSource` field (quality itself marked it low-priority; `seedRef` presence already implies the source).
- **sha-verify — quality S-A1 two-step adopted** (`rev-parse HEAD`==sha AND `cat-file -t`==`commit`), closing the shallow-clone alternative-object-type confused-deputy path, while keeping ARCH-053's latitude on fetch strategy (do not assume `allowAnySHA1InWant`).
- **Config knobs named at design time (D-v13-E class foot-gun, D-F5 precedent):** `seedRefTimeoutMs` (default 30_000, min 5_000), `seedRefMaxTotalBytes`, `seedRefMaxFileBytes`, `seedRefAllowlist` — all validated at config-load (same convention as `maxConcurrentRuns`/`maxWorkflowDepth`), rejected with actionable entry-named messages. Left to impl = the same late-fix trap both lenses flagged.
- **`CAS_UNAVAILABLE` in the precedence (gap NEITHER panel closed):** `putBlob` targets `CasStore`, so seedRef requires a configured CAS exactly like seedManifest — added as the last pre-`createRun` precedence slot (DES-080) with its own UT row.
- **Reuse checked (Karpathy surgical):** `src/net-guard.ts` NOT reused — it is the HTTP server-bind/host-header/loopback plane, a different concern from URL egress prefix matching; `src/timeout-race.ts` (`raceWithTimeout`) is agent/semaphore-oriented (provider-call racing, no child kill), so the fetcher's kill-on-timeout is a local `setTimeout`+`child.kill` (DES-082) rather than a forced reuse.
- **Carried D-v13 decisions (from Gate 2, unchanged):** D-v13-B no blanket private-IP connect-ban (air-gapped internal forge is a legit allowlisted target); D-v13-C DNS-rebind = accepted residual, connect-IP-pin not built; D-v13-D no fetch worker pool (REQ-054 admission counter already bounds concurrency; S-S3 slot-holding residual documented for operator sizing); D-v13-F secrets/private-repo deferred. Quality's cross-cutting gaps (trace-ID, RunStorePort, circuit-breaker, `GET /health`, journal archival) remain pre-existing deferred future-REQ candidates — NOT seeded by a single seed-source feature.
- **Seam consistency (Exit Gate 5):** every time read on the seedRef path takes the injected `Clock` (`t0`/`latencyMs`/`fetchedAt`, DES-083); no RunManager or fetcher method reads wall-clock time; the sole timer is the fetcher's child-kill `setTimeout` (OS boundary, faked in UTs). seedRef falls into the identical mkdir → materialize → `initGitBaseline` tail as seed/seedManifest — no asymmetric second assembly path.

### DES-086 — streaming blob ingest: `CasStore.putBlobStream` seam + pure validators + error taxonomy + net-guarded route (src/cas-store.ts, src/server.ts)
- **status:** draft
- **traces:** ARCH-054, TASK-080
- **signature:** `putBlobStream(namespace: string, declaredSha: string, body: Readable, opts: { maxBytes: number; readTimeoutMs: number; timer?: { set(fn:()=>void, ms:number): T; clear(t: T): void } }): Promise<{ sha256: string; bytes: number }>` (mirrors shipped `putBlob`'s `{sha256,…}`, drops the never-load-bearing `accepted:true`). `opts.timer` defaults to global `setTimeout/clearTimeout` — the ONLY injection seam for the idle timer (CasStore has no clock; localized to this method, Karpathy). Pure exports: `isValidSha256Hex(s): boolean` (exactly 64 chars `[0-9a-f]`, lowercase-only, REJECT not normalize) and `isValidNamespace(ns): boolean` (bounded charset, no `/`, no `.`-runs, non-empty) — both run BEFORE any fd.
- **flow:** validators → open per-request temp file → pipe `body`, hash incrementally, `bytes+=chunk.length`; on each chunk RESET the idle timer (`readTimeoutMs`). `bytes > maxBytes` mid-stream → abort+unlink → `BLOB_TOO_LARGE`; idle timer fires → abort+unlink → `BLOB_UPLOAD_TIMEOUT`; on end `computed !== declaredSha` → unlink → `BLOB_SHA_MISMATCH` (store NOTHING); else atomic rename → `blobs/<sha[0:2]>/<sha>`, THEN record namespace ref. `finally`-unlink covers every exit. `server.ts` handler = thin glue (parse `:sha`+`?namespace`, run the two validators, call `putBlobStream`, map throw→envelope), registered AFTER the net-guard (server.ts:1265), reads UNDECODED bytes (does NOT reuse `readBodyDecoded`).
- **boundary/error (HTTP status pinned):** bad hex/namespace → `400 INVALID_BLOB_REQUEST`; over-cap → `413 BLOB_TOO_LARGE`; idle timeout → `408 BLOB_UPLOAD_TIMEOUT`; mismatch → `409 BLOB_SHA_MISMATCH`. BE-2 no-exists-shortcut: fully consume+verify even when `blobs/<sha>` already exists (store under COMPUTED hash — possession proof, REQ-064 poisoning). BE-3 raw route does NOT decode Content-Encoding (a gzipped body simply mismatches → `BLOB_SHA_MISMATCH`; the sha is over stored bytes). BE-4 0-byte blob with correct empty-sha SUCCEEDS (`maxBytes` is an upper bound). Twin recorded: keep shipped `putBlob`'s `BLOB_HASH_MISMATCH`, emit `BLOB_SHA_MISMATCH` on the new route (REQ-081 text) — do NOT rename the shipped code (breaks pinned `blob_put` callers).
- **config (named at design time):** `maxBlobBytes` default `268435456` (256 MiB), min `1048576`; `blobUploadTimeoutMs` default `120000`, min `10000` → feeds `opts.readTimeoutMs`. Validated at config-load with the `maxConcurrentRuns` convention, actionable entry-named messages.
- **testability / seam (Exit Gate 5):** fake `Readable` battery drives the unit — good stream stored+ref recorded; `maxBytes+1` → `BLOB_TOO_LARGE`+temp unlinked; stalling stream + fake `opts.timer` fired synchronously → `BLOB_UPLOAD_TIMEOUT`+temp unlinked; bytes≠declared → `BLOB_SHA_MISMATCH`+temp unlinked; exists-hit still verifies. Every time read on this path is the injected `opts.timer`; NO method reads wall-clock. Net-guard 403-on-foreign-Host IT on `/assets/blob` + placement drift assertion.
- **drift-lock:** `blob_put` description contains `"/assets/blob/"` and `"BLOB_SHA_MISMATCH"`.
- **iter:** v14

### DES-087 — manifest-as-CAS-blob: `POST /assets/manifest` + `seedManifestRef` run-load + 4-way exclusion ladder + `RunStatusView.seedManifestRef` (src/server.ts, src/run-manager.ts, src/types.ts)
- **status:** draft
- **traces:** ARCH-055, TASK-081
- **signature:** `POST /assets/manifest?namespace=<ns>` (raw-body, net-guarded) → `{ seedManifestRef: string; namespace: string }` where `seedManifestRef = sha256(manifestBytes)`. `RunSpec.seedManifestRef?: string` (types.ts, beside `seedManifest`/`seedNamespace` at :158); `RunStatusView.seedManifestRef?: string` (types.ts:104, parity with `seedRef` at :120 — the ref actually used).
- **flow:** register endpoint: parse manifest bytes → on failure `INVALID_SEED_SPEC`; validate every `{path,sha256}` blob present in `<ns>` → `MISSING_BLOBS` (naming absent shas); `putBlob(ns, sha256(bytes), bytes)` storing the manifest AS a blob; return the ref. Run path (run-manager, in the seed-source pick): load blob by `seedManifestRef` under `seedNamespace` → absent → `MISSING_BLOBS`; parse → fail → `INVALID_SEED_SPEC`; re-validate referenced blobs → `MISSING_BLOBS`; bind `spec.seedManifest = parsed.entries` so it FALLS INTO the existing `materializeManifest(workspace, entries, readBlob)` tail unchanged (inline+ref cannot diverge). Stamp `RunStatusView.seedManifestRef`.
- **boundary/error:** register-time `MISSING_BLOBS` is UX; the run-time pre-`createRun` `MISSING_BLOBS` re-validation stays the SECURITY boundary (a caller can mint a manifest-shaped blob via plain `blob_put` and skip the endpoint). TOCTOU non-issue (blobs immutable, never deleted); documented contract: any future per-namespace quota/GC MUST exempt blobs referenced by a stored manifest. Parse-failure reuses `INVALID_SEED_SPEC` (no new `MANIFEST_PARSE_ERROR` — a manifest IS a seed spec; drift-locked).
- **4-way ladder (literal, pinned):** at the existing top rung, `>1 of {seed, seedManifest, seedRef, seedManifestRef}` → `SEED_SOURCE_CONFLICT` (extends run-manager.ts:254, does NOT invent a parallel path). One ordered-precedence UT extended: `seedManifestRef`+`seed` → CONFLICT (not MISSING_BLOBS); ref naming a missing blob → MISSING_BLOBS; unparseable manifest blob → INVALID_SEED_SPEC.
- **consumability:** `seedManifestRef` is client-derivable (`sha256(manifestBytes)`) → a caller can verify the register response. `workflow_run` description enumerates all four seed sources + names `SEED_SOURCE_CONFLICT` + `/assets/manifest`; `seed_plan` description names `POST /assets/manifest` as the next step.
- **drift-lock:** `workflow_run` description contains `"seedManifestRef"`, `"SEED_SOURCE_CONFLICT"`, `"/assets/manifest"`; `seed_plan` description contains `"/assets/manifest"`.
- **iter:** v14

### DES-088 — redact-at-capture wiring: `SecretValueProvider` port + `redact({name,value}[])` + exhaustive persist-sink enumeration (src/secret-resolver.ts, src/run-manager.ts, src/gateway)
- **status:** draft
- **traces:** ARCH-056, TASK-082
- **signature:** `redact(event: unknown, secrets: ReadonlyArray<{ name: string; value: string }>): unknown` (extends the shipped `redact(event, secretValues: string[])` at secret-resolver.ts:88 — ZERO production callers today, so blast radius = its own unit tests, not a caller migration); marker `‹secret:${name}›`, value-exact substring (NO pattern/entropy matcher — that would break the negative control). New port `interface SecretValueProvider { entries(): ReadonlyArray<{ name: string; value: string }>; }` (`ReadonlyArray` load-bearing — capture path must not mutate). Real impl enumerates the same `RWE_SECRET_*` source behind `loadSecretSourceFromEnv`; injected into `RunManager`, never into the sandbox.
- **sinks (exhaustive — completeness IS the REQ):** route each through `redact()` on the persist write: (1) per-agent transcript store read by `workflow_agent_log`; (2) terminal snapshot — `redact()` over the `AgentRecord[]` BEFORE `saveSnapshot` (run-manager.ts:508), never the raw in-process records (else a cross-restart `GET /api/runs/:id` leak); (3) SDK-gateway `kind:'message'|'tool_call'|'tool_result'|'usage'` capture; (4) the ENTIRE `JournalEntry` (key.prompt + key.opts + value) at the `appendJournal` build site — a REPLAY source. NOTE (Gate-7.5 live-Ollama finding): redacting only `.value` leaked a secret-bearing `key.prompt` on disk (a prior agent's provisioned value can reach a later agent's prompt via the persist-only raw in-memory return); `redact()` runs over the whole entry so no raw secret hits `journal.jsonl`.
- **invariants (each a named test):** (a) double-redaction exclusivity — `redact({name,value})` runs ONLY on `kind!=='harness'`, `redactHarness` (agent-executor.ts:12, ARCH-044) runs ONLY on `kind==='harness'`; neither runs on the other's output (else marker corruption). (b) persist-only — the live in-memory `messages` array the SDK replays into its next turn is UNTOUCHED; unit asserts in-memory holds the raw value while the persisted copy holds the marker (silent-wrong-agent-behavior guard). (c) journal replay-divergence — a resumed run receives `‹secret:NAME›` where an `agent()`/`workflow()` return contained a provisioned value (accepted-by-design under the hermeticity contract: no provisioned secret may be returned from an `agent()`/`workflow()` schema; documented in `workflow_run` + authoring guidance). EXTENDED to call params (Gate-7.5 ruling): the persisted `key.prompt`/`key.opts` are redacted too, so if a provisioned secret rides a call KEY, a HARD-CRASH resume MISSes that call (sameKey compares raw prompt+opts, resume-cache.ts:14, against the redacted on-disk key) and re-runs it + the tail LIVE — correct values, just recomputed; strictly more graceful than the redacted-VALUE divergence above (which feeds a marker back as data). Same-process suspend/resume is unaffected (the in-memory `entry.journal` keeps the raw key). Future option, not built: persist a `keyHash` of the raw key so replay matches without the raw prompt on disk.
- **completeness sweep IT (definition-of-done):** provision a fake secret; run a workflow whose agent echoes the value into a message AND round-trips it through a return; assert the raw bytes are ABSENT from every on-disk artifact (per-agent transcript, terminal snapshot, `journal.jsonl`) AND from `workflow_agent_log` output; negative control — a same-shape different-value string is NOT redacted. Perf bound (S-S3): `redact()` over ≤20 secrets × ≤1000 events; a loose timing guard (<50 ms for 20×200) catches quadratic drift.
- **consumability:** `workflow_agent_log` description gains: "Secret values are replaced with `‹secret:NAME›` markers in persisted transcripts (agents received real values at runtime; only the stored transcript is redacted)."
- **iter:** v14

### DES-089 — honest `asset_push` `kind` schema + drift-lock (src/server.ts, tests/integration/schema-drift.test.ts)
- **status:** draft
- **traces:** ARCH-057, TASK-083
- **signature:** rewrite `TOOL_DEFS.asset_push.properties.kind.description` (server.ts:435): `'Asset type. "skill" materializes into the run workspace. "hook" is rejected (HOOKS_UNSUPPORTED) — hooks are not supported on the server. "mcp-config" is redirected to mcp_provision; use that tool instead.'` Keep `enum: ['skill','hook','mcp-config']` (dropping breaks the redirect caller). Behavior UNCHANGED (classifier `classifyAsset` untouched; pushing `hook` still returns typed `HOOKS_UNSUPPORTED`).
- **drift-lock:** the `asset_push` `kind` field description contains BOTH `"HOOKS_UNSUPPORTED"` and `"mcp_provision"` (asserted over served `tools/list`, structured-fact not golden-string).
- **iter:** v14

### DES-090 — pure `assertScriptIntegrity` + `SCRIPT_SHA_MISMATCH` ladder rung + `scriptSha256` schema (src/run-manager.ts, src/server.ts, tests/integration/schema-drift.test.ts)
- **status:** draft
- **traces:** ARCH-058, TASK-084
- **signature:** `assertScriptIntegrity(script: string, sha?: string): void` — `sha` present and `sha256(Buffer.from(script,'utf8')) !== sha` → `throw codedError('SCRIPT_SHA_MISMATCH', …)`; absent → no-op. `sha` is 64-char lowercase hex. One pure function, unit-tested directly (matching + one-byte-altered + absent + upper/short-hex reject).
- **ladder position (pinned):** NEW top rung in the `workflow_run` pre-`createRun` ladder, evaluated BEFORE the admission counter (run-manager.ts:230) — a pure request-shape check that costs nothing and should report a mistyped script regardless of load. `scriptSha256` supplied with a NAMED run (no inline `script`) → typed `SCRIPT_SHA_WITHOUT_SCRIPT` (clear reject, never a silent pass — the REQ-084 honesty principle). Full pre-`createRun` order: `SCRIPT_SHA_WITHOUT_SCRIPT`/`SCRIPT_SHA_MISMATCH` → admission (`RUN_ADMISSION_LIMIT`) → `SEED_SOURCE_CONFLICT`(4-way) → `SEEDREF_DISABLED` → `INVALID_SEED_SPEC`(incl. unparseable manifest) → `SEEDREF_EGRESS_DENIED` → `CAS_UNAVAILABLE` → `MISSING_BLOBS`(incl. absent manifest blob).
- **schema/drift-lock:** `TOOL_DEFS.workflow_run.properties.scriptSha256` = `{type:'string', description:'Optional integrity guard. 64-char lowercase hex sha256 of the script'"'"'s UTF-8 bytes. If present and mismatched, returns SCRIPT_SHA_MISMATCH and creates no run. Omit to skip.'}`; drift assertion: description contains `"UTF-8"` and `"SCRIPT_SHA_MISMATCH"`.
- **iter:** v14

### DES-091 — real-tier validation path + per-tier mock policy (REQ-081..085)
- **status:** draft
- **traces:** REQ-081, REQ-082, REQ-083, REQ-084, REQ-085, TASK-080, TASK-081, TASK-082, TASK-083, TASK-084
- **real-tier path per REQ (real entrypoint + real wiring):**
  - REQ-081 (`POST /assets/blob/:sha`): a real >8 MiB blob (e.g. 20 MiB) uploads via the raw route against a running engine (real `CasStore`, real fs) and reads back byte-identical (assembled into a run / `workflow_artifacts`); the SAME blob via `blob_put` base64 → `413 BODY_TOO_LARGE`; a tampered sha → `BLOB_SHA_MISMATCH`, nothing written; oversized body → `BLOB_TOO_LARGE`; foreign `Host` → 403.
  - REQ-082 (`seedManifestRef`): a real multi-file tree uploads its blobs, registers via `POST /assets/manifest`, then `workflow_run({seedManifestRef, seedNamespace})` (params a few dozen bytes) produces a workspace byte-identical to the inline-`seedManifest` path; a ref naming a missing blob → `MISSING_BLOBS`.
  - REQ-083 (redact-at-capture): a REAL agent run (LLM-gated skip when no key, the ledger convention) whose agent echoes a provisioned secret → the raw value is absent from `workflow_agent_log` AND every on-disk artifact; a same-shape non-secret is not redacted.
  - REQ-084 (`asset_push` honesty): real `tools/list` shows the `kind` description naming `HOOKS_UNSUPPORTED`/`mcp_provision`; pushing `hook` still returns typed `HOOKS_UNSUPPORTED`.
  - REQ-085 (`scriptSha256`): real `workflow_run` with a matching sha runs; one byte altered → `SCRIPT_SHA_MISMATCH`, no run; omitted → runs as before.
- **per-tier mock policy:** UNIT — mock freely (fake `Readable`, fake `opts.timer`, fake `SecretValueProvider`/`SeedRefFetcher`, in-table secrets); all validators, error taxonomy, redact invariants, ladder precedence, `assertScriptIntegrity` are pure/clock-free UTs. INTEGRATION — real adjacent components (real `CasStore` + real fs + real HTTP server + real net-guard); mock only third-party network you cannot run (LLM provider → gated skip). E2E/ACCEPTANCE — MUST NOT mock the engine's own boundaries (route/net-guard/`putBlobStream`/CAS/`redact` chokepoint/ladder); the >8 MiB upload, the manifest round-trip, and the real-agent secret-echo are the real touches; REQ-083's agent run is LLM-gated-skip.
- **iter:** v14

## Class diagram — v14 (ARCH-054..058: blob transport + manifest ref + capture redaction)
```mermaid
classDiagram
    class CasStore {
        +putBlob(ns, declaredSha, bytes) BlobResult
        +putBlobStream(ns, declaredSha, body, opts) BlobStreamResult
        +hasRef(ns, sha) bool
    }
    class BlobValidators {
        <<pure>>
        +isValidSha256Hex(s) bool
        +isValidNamespace(ns) bool
    }
    class Server {
        +POST /assets/blob/:sha  (after net-guard)
        +POST /assets/manifest   (after net-guard)
        +TOOL_DEFS.asset_push.kind
        +TOOL_DEFS.workflow_run.scriptSha256 / seedManifestRef
    }
    class RunManager {
        +assertScriptIntegrity(script, sha?)
        +pre-createRun ladder (4-way SEED_SOURCE_CONFLICT)
        +stamp RunStatusView.seedManifestRef
        -secretValues: SecretValueProvider
    }
    class SecretValueProvider {
        <<interface>>
        +entries() ReadonlyArray~NameValue~
    }
    class redact {
        <<pure>>
        +redact(event, secrets NameValue[]) unknown
    }
    class SecretSource {
        <<interface>>
    }
    Server --> BlobValidators : gate before fd
    Server --> CasStore : putBlobStream / manifest blob
    Server --> RunManager : workflow_run
    RunManager --> SecretValueProvider : inject
    RunManager --> redact : persist-write sinks only
    SecretValueProvider ..> SecretSource : reads RWE_SECRET_*
    RunManager --> CasStore : materializeManifest(seedManifestRef)
```

### Decision rationale — v14 (DES-086..091, REQ-081..085: remote-seeding transport + capture-redaction + schema honesty)
- **Panel provenance / r2 NOT run:** synthesized from `.panel/design/adversarial.r1.md` (opus — interface-contract / boundary-error / testability, Karpathy tie-break) + `quality-dimensions.r1.md` (sonnet — observability / replaceability / consumability / self-sustainability). Stances are COMPLEMENTARY — none of adversarial's six predicted disagreements materialized in quality's r1 (both concede D-v14-A manifest-as-blob, D-v14-C persist-only, D-v14-D name-keyed marker; quality did NOT re-push pattern/entropy redaction or a ManifestStore port) — so r2 was not triggered. QM `safety_class` → no functional-safety / cybersecurity lenses (correct for developer tooling).
- **Task shape — 5 tasks 1:1 with ARCH** (matches the architecture's own "5 ARCH for 5 REQ, one-to-one"; both lenses allow it). ARCH-056 is deliberately ONE task (DES-088) — the completeness sweep IT is its definition-of-done and cannot be written until all four sinks are wired in one place; splitting sinks across tasks is the exact divergence failure mode (a green transcript-sink task while the journal sink still leaks). ARCH-054→055 ordered (a manifest references uploaded blobs). Did not fuse ARCH-057+058 (adversarial floated it) — they touch different subsystems (asset_push schema vs run-manager ladder) and clean 1:1 traces beat a marginal harness-sharing saving.
- **Error-code twin (BLOB_SHA_MISMATCH vs shipped BLOB_HASH_MISMATCH) — intentional, recorded.** The new route emits `BLOB_SHA_MISMATCH` (REQ-081 text); the shipped `putBlob` keeps `BLOB_HASH_MISMATCH` (pinned by `blob_put` tests/callers). Two codes for one invariant is mild debt; a rename that breaks a shipped tested path is worse (Karpathy). Drift-note so a future maintainer does not "unify" them.
- **Manifest parse-failure = `INVALID_SEED_SPEC`, NOT a new `MANIFEST_PARSE_ERROR`** (adversarial BE-5b; the architecture left it "INVALID_SEED_SPEC / MANIFEST_PARSE_ERROR"). A manifest is a seed spec; the existing rung already owns "malformed seed spec." Fewest codes; drift-locked either way. Register-time `MISSING_BLOBS` is UX, run-time re-validation stays the security boundary (BE-6).
- **Idle-timer seam — injected (adversarial TE-1 over Karpathy "no new seam").** `BLOB_UPLOAD_TIMEOUT` needs a wall-clock and the repo's Exit-Gate-5 rule is "clock seam hermetic"; the stall case is exactly what must be deterministic. Since `CasStore` has no existing clock (constructor(dir) only), the seam is a localized optional `opts.timer` defaulting to the real timer — the minimal injection, not a constructor-level dependency. A second recorded real-timer exception was the weaker option.
- **`scriptSha256` rung BEFORE admission (adversarial BE-10).** A pure request-shape check that costs nothing durable should report a mistyped script regardless of current load; this reclassifies a bad-script-under-load result from `RUN_ADMISSION_LIMIT` to the more specific `SCRIPT_SHA_MISMATCH` (an improvement). `scriptSha256` on a NAMED run (no inline script) → typed `SCRIPT_SHA_WITHOUT_SCRIPT`, never silent-ignore (the REQ-084 schema-honesty principle applied to REQ-085).
- **Sink completeness = runtime sweep IT (adversarial conflict #3, quality R2/R3/R9/R10).** A compile-time single-chokepoint guarantee is stronger but would force refactoring unrelated write paths; at v14 sink counts (four, enumerable) the greps-every-artifact sweep IT is sufficient and is DES-088's definition-of-done. The named unit invariants (double-redaction exclusivity O-S2, persist-only S-A2, redact-before-saveSnapshot O-A2, replay-divergence S-A1) close the silent failure modes the sweep alone would not localize.
- **Config defaults named at design time (quality S-S1/S-S2; D-v13-E / D-F5 late-fix precedent):** `maxBlobBytes` 256 MiB (min 1 MiB), `blobUploadTimeoutMs` 120 s (min 10 s), validated at config-load. Leaving them to impl is the exact deferred-timeout trap the ledger already burned through twice.
- **`redact` blast radius is a test-only migration (adversarial IC-5, verified):** `redact()` has ZERO production callers today (grep over `src/` — `redactHarness` is a separate unchanged function), which is precisely the audit finding ("exists but not wired") and is why the `string[]`→`{name,value}[]` signature+marker change is cheap.
- **Karpathy check:** complexity budget spent only on ARCH-054 (true streaming) and ARCH-056 (sink completeness); ARCH-055 collapses to a CAS blob (no store/port/GC), ARCH-057 is a static schema edit, ARCH-058 is a ~10-line pure guard + one rung. Every heavier option (ManifestStore port, pattern/entropy redaction, script-signing subsystem, chunked/resumable upload, separate `asset-server.ts`) rejected as speculative. The dominant risks are all bypass risks (a route skipping the net-guard, a sink skipping `redact()`, a stream skipping verification) made impossible-by-construction via positional/enumerable design, not new machinery.
- **Seam consistency (Exit Gate 5):** on the blob path every time read is the injected `opts.timer`, no method reads wall-clock; on the redact path there is no clock (value-exact substitution is clock-free); the seedManifestRef path reuses the v13 `Clock`-seamed `RunStatusView` stamping unchanged. No asymmetric second assembly path — `seedManifestRef` falls into the identical `materializeManifest` tail as inline `seedManifest`.

## v15 Slice B — per-caller identity (OAuth2/Google), workflow ownership, harness binding, fail-closed bind (DES-092..100, REQ-012 + REQ-086..089 → ARCH-059..063)

### DES-092 — `src/auth/oauth-metadata.ts` — PURE metadata + challenge builders (no I/O)
- **status:** draft
- **traces:** ARCH-059, TASK-085, TASK-091
- **signature:** `buildProtectedResourceMetadata(cfg): {resource, authorization_servers: string[]}` · `buildAuthServerMetadata(cfg): {issuer, authorization_endpoint, token_endpoint, registration_endpoint, code_challenge_methods_supported:["S256"], response_types_supported:["code"], grant_types_supported:["authorization_code"]}` · `wwwAuthenticateHeader(cfg): string` returns the exact `Bearer resource_metadata="<issuer>/.well-known/oauth-protected-resource"` challenge.
- **boundary-conditions:** all three are pure functions of `cfg` (unit-testable, no fetch/clock). The `resource_metadata` param name + challenge form MUST be verified against the current MCP authorization spec **at wiring time** — one call-site (R4). No trailing-slash drift between `issuer` and the `.well-known` paths. **v17 (RFC 7591 DCR):** `buildAuthServerMetadata` now also returns `registration_endpoint: `${base}/register`` (RFC 8414 field name, exactly that spelling) — without it a spec-only MCP client refuses to connect ("does not support dynamic client registration"). Same trailing-slash discipline as the other endpoints.
- **iter:** v17

### DES-093 — `src/auth/token-store.ts` — opaque sha256-at-rest bearer + single-use code/state, constructor-injected clock+CSPRNG
- **status:** draft
- **traces:** ARCH-059, TASK-085, TASK-090, TASK-091
- **signature:** `new TokenStore(db, {clock: () => number, csprng: (n) => Buffer})`. `issue(principal, ttlMs): {token, expiresAt}` — returns the RAW opaque token ONCE, persists only `sha256(token)` (never a JWT). `verifyByHash(rawToken): string | null` — one indexed lookup → principal or null (expired/unknown → null). `mintAuthCode(principal, codeChallenge, redirectUri): string` / `consumeAuthCode(rawCode): {principal, codeChallenge, redirectUri} | null` — single-use, ≤60s TTL, **atomic consume** (DELETE-RETURNING/txn). `putState({state, nonce, codeChallenge, redirectUri})` / `consumeState(state): {...} | null` — same single-use contract. `gcExpired(): number`. **v17 (RFC 7591 DCR):** `registerClient({redirectUris: string[], ttlMs}): {clientId: string, clientIdIssuedAt: number}` — mints `clientId` from `this.csprng(n).toString('hex')`, `clientIdIssuedAt = Math.floor(this.clock()/1000)` (RFC 7591 unit = **seconds**), persists the row (redirect_uris as JSON), returns the id + issued-at. `getClient(clientId): {redirectUris: string[]} | null` — one indexed lookup → the registered (unexpired) redirect_uris, or `null` if unknown/expired.
- **boundary-conditions:** 3 tables `bearer_tokens(token_hash PK, principal, issued_at, expires_at)`, `auth_codes(code_hash PK, …, expires_at)`, `oauth_state(state PK, …, expires_at)`; **v17 adds a 4th** `registered_clients(client_id PK, redirect_uris TEXT/*JSON array*/, client_id_issued_at, expires_at)`. **Seam (Exit Gate 5):** EVERY method that reads time reads `this.clock()`; EVERY token/code/state/**client_id** value comes from `this.csprng()` — no `Date.now()`/`crypto.randomBytes` in the module (so a fixed clock makes expiry/GC deterministic and no method reads the wall clock behind the seam); `registerClient` obeys this rule identically (client_id from `this.csprng()`, issued-at from `this.clock()`). Concurrent double-`consumeAuthCode` → at most one non-null (atomic). Raw token/code/state MUST never equal any stored column (assert in UT). `gcExpired` reuses the workspace-TTL GC cadence; caller wraps it try/catch→log+continue (never throws into the scheduler — quality r2 note). **v16 MED-2 — contract pinned (now actually invoked, see DES-095 wiring):** `gcExpired(): number` deletes every row with `expires_at <= this.clock()` — **v17: across ALL FOUR tables** (`bearer_tokens`, `auth_codes`, `oauth_state`, `registered_clients`), returns the total deleted count, RETAINS rows with `expires_at > this.clock()` (a live bearer / live registration survives), and is idempotent (a second call with no newly-expired rows returns 0). Time read only via `this.clock()` (seam) so a fixed clock makes the sweep deterministic. **v17 registration bounding (self-decided, same MED-2 class):** `registered_clients` is an unauthenticated tunnel-reachable write path, so registrations carry a weeks-scale `expires_at` (bearer-like) and are GC'd by the same sweep; an expired registration degrades gracefully to the loopback-only `/authorize` path (no user-facing breakage — see DES-095), so bounding the table costs nothing in correctness.
- **iter:** v17

### DES-094 — `src/auth/google-verifier.ts` — id_token verify, injected JWKS+clock+base (zero network in UT)
- **status:** draft
- **traces:** ARCH-059, TASK-085
- **signature:** `verifyIdToken(idToken, deps: {clientId, jwksFetch: JwksPort, now: () => number, googleBase: string, expectedNonce}): {email} | throws AuthError` · `type JwksPort = (googleBase) => Promise<Jwk[]>` (cached one layer above so the verifier stays cache-free).
- **boundary-conditions:** verify order — `iss ∈ {accounts.google.com, https://accounts.google.com}`, `aud === clientId`, `exp` fresh via injected `now`, signature via injected `jwksFetch`, `nonce === expectedNonce`, and **`email_verified === true` BEFORE adopting `email`** (the difference between authenticated and authenticated-as-whoever-you-typed). Every reject branch (bad iss/aud/exp/sig/nonce, `email_verified:false`, missing claim) → typed `AuthError`, UT'd with injected deps. Injected `now` = the only time read (seam).
- **iter:** v15

### DES-095 — `src/auth/auth-service.ts` + 4 `server.ts` routes — orchestration + `resolvePrincipal` discriminated union
- **status:** draft
- **traces:** ARCH-059, TASK-086, TASK-090, TASK-091
- **signature:** `startAuthorize(req): 302` (→ Google consent, stores state+nonce+PKCE) · `handleGoogleCallback({state, code}): 302` (verify id_token → mint engine auth-code) · `tokenExchange({code, codeVerifier}): {access_token, token_type:"Bearer", expires_in}` (verify PKCE S256 → issue engine bearer) · `resolvePrincipal(req): {principal: string} | {status: 401, wwwAuthenticate: string}` — **returns a union, does NOT throw**. **v16 (HIGH-1):** new exported PURE `isLoopbackRedirectUri(uri: string): boolean` (lives in auth-service.ts, NOT merged with net-guard's `isLoopbackPeer` — that is socket-peer semantics, this is redirect-URL semantics, DES-097's "do not merge" note applies). **v17 (RFC 7591 DCR):** new handler `register(req, res)` on `AuthRouteHandlers` (RFC 7591 `POST /register`, JSON body). Routes: `GET /.well-known/oauth-protected-resource`, `GET /.well-known/oauth-authorization-server`, `GET /authorize`, `GET /oauth/google/callback`, `POST /token`, **`POST /register`** (slots into the same pre-guard `if (authHandlers)` dispatch block in `server.ts` after `/token` ~line 1408 — public, bypasses the D-BIND/auth gate, no ARCH-063/DES-097 change).
- **boundary-conditions:** PKCE `S256` verify at `/token`; missing Google `client_id`/`secret` → typed config error, never client-visible. Uniform 401 body — NO expired-vs-unknown-vs-malformed distinction on the wire [D-REDACT / C-2]; the distinction lives ONLY in an internal DEBUG log `auth.resolve: {outcome}` (no token value). Bearer TTL weeks-scale, no refresh; revocation = row-delete. Every reachable secret (bearer, Google id_token, client_secret, pepper) stays off every sandbox-reachable path.
- **v16 HIGH-1 (open-redirect):** `authorize()` calls `isLoopbackRedirectUri(redirectUri)` **BEFORE `tokenStore.putState(...)` and BEFORE building the Google redirect** — a `false` result (or missing/empty `redirect_uri`) → `400 {error:"invalid_request"}` with **no `oauth_state` row written** (observable: `/authorize?redirect_uri=https://evil.example/cb` → 400, 0 state rows; `?redirect_uri=http://127.0.0.1:5599/cb` → 302 to Google as before). `isLoopbackRedirectUri` boundary UTs: `http://127.0.0.1:<any>/cb`→true, `http://localhost:<any>/cb`→true, **`http://[::1]:<any>/cb`→true (named UT — verifies WHATWG `URL.hostname` serializes IPv6 WITH brackets `[::1]`, an implementer footgun)**, `https://127.0.0.1/cb`→false (REQ names `http:` only — do NOT generalize to `127/8` or https), `https://evil.example/cb`→false, `` (empty/missing)→false, unparseable garbage→false (parse in a try/catch, throw⇒false). Post-validation the stored `redirectUri` is always an absolute loopback URL, so the relative-URI branch at the callback redirect (auth-service.ts ~line 185) becomes unreachable — **flag only, do NOT remove** (surgical; not this fix's concern).
- **v17 RFC 7591 Dynamic Client Registration (`register` handler):** reads a JSON client-metadata body. **Validation:** `redirect_uris` MUST be a non-empty array and EVERY entry MUST satisfy `isLoopbackRedirectUri` (reuses the v16 pure fn) — otherwise `400 {error:"invalid_redirect_uri"}`; a body that is not parseable JSON → `400 {error:"invalid_client_metadata"}`. **Clamp, do NOT reject, richer requests** (RFC 7591 permits the AS to replace requested values; the MCP SDK routinely requests `refresh_token` — rejecting it re-breaks live connect): the engine ignores requested `grant_types`/`response_types`/`token_endpoint_auth_method` and pins them to `["authorization_code"]` / `["code"]` / `"none"`. On success → `201 {client_id, client_id_issued_at, redirect_uris, grant_types:["authorization_code"], response_types:["code"], token_endpoint_auth_method:"none"}` (public PKCE client — **no `client_secret`**), persisted via `tokenStore.registerClient({redirectUris, ttlMs})`. Body read via a small JSON-body reader (mirror of the existing `readFormBody`, but `JSON.parse` in try/catch → `invalid_client_metadata`). **`/authorize` registered-client binding:** after the existing loopback check, IF `client_id` is present AND `tokenStore.getClient(client_id)` returns a registration, the request `redirect_uri` MUST match one of that client's registered redirect_uris by **scheme + hostname + pathname, PORT-IGNORED (RFC 8252 §7.3** — native clients bind an ephemeral loopback port per session; a cached `client_id` + fresh port is exactly the live-connect case, so exact-match would 400 it) — no match → `400 {error:"invalid_request"}`. An **absent OR unregistered** `client_id` falls through to the existing loopback-only path unchanged (backward compatible — keeps IT-078 regression guards 9a-9c, which send an unregistered `client_id`, at 302). This binding is RFC conformance + the reader that makes `registered_clients` persistence observable; it is **NOT a security boundary** (the unregistered-client_id path remains open by design — security rests on loopback-only + PKCE S256 + single-use state, unchanged).
- **v16 MED-2 (unbounded auth-table growth):** `tokenStore.gcExpired()` is invoked from the REQ-026 periodic maintenance sweep in `server.ts` (the `sweep()` at ~line 1259), wrapped `try/catch`→log+continue so it never throws into the scheduler. **Decision (self-decided, F1):** the sweep interval is now created when **`workspaceTtlMs>0` OR auth is enabled** (was: only `workspaceTtlMs>0`) — inside a tick, workspace reclaim runs iff a TTL is set and `gcExpired()` runs iff auth is wired — so the auth-enabled / no-workspace-TTL config still bounds its tables (fully closes MED-2, not just the literal Gate-8 one-liner). Same hourly cadence cap; `gcTimer.unref()` preserved; auth-disabled ⇒ unchanged behavior (no `gcExpired`, sweep created only if a TTL is set).
- **iter:** v17

### DES-096 — per-caller principal: resolve-once-at-edge, explicit-param threading, control-plane attribution, sandbox hermeticity (ARCH-060)
- **status:** draft
- **traces:** ARCH-060, TASK-087
- **signature:** append one nullable `principal: string | null` to `callTool(...args, principal)` and the **mutation+attribution** facade methods `workflow_run(a, principal)` / `workflow_register(a, principal)` / `workflow_deregister(a, principal)`, plus `cas.putBlobStream(ns, sha, req, opts, principal)` / `cas.putBlob(ns, sha, bytes, principal)` / manifest-register. `workflow_get`/`workflow_list`/`workflow_status` take **no** principal param (reads open by absence-of-parameter). `principal` is `null` iff auth disabled OR a token-free loopback caller.
- **boundary-conditions:** `resolvePrincipal` runs per surface BEFORE any side effect — `/mcp` headers-only before `readBodyDecoded` (gates `initialize`/`tools/list`/`ping`), `POST /assets/blob/:sha` before `putBlobStream` consumes `req`, `POST /assets/manifest` before body read. `workflow_run` principal is **attribution only, NOT a gate** (any principal may run any workflow — REQ-086); the run record carries `principal:<email>` (surfaced via existing `workflow_status`), CAS namespace records first-writer (record-only, no enforcement — content-addressed blobs can't be forged). Principal is **NEVER** written to child-process env or run workspace [D-AUTH-4]. No `CallContext` refactor this slice (append the param — smallest diff). **DoD = the paired hermeticity IT (I-2):** one run, assert `principal:<email>` PRESENT on `workflow_status` AND ABSENT from sandbox child env + run workspace (mirrors v14 redact sweep).
- **iter:** v15

### DES-097 — `isLoopbackPeer` + D-BIND fail-closed net-guard extension (ARCH-063)
- **status:** draft
- **traces:** ARCH-063, TASK-088
- **signature:** new PURE sibling in `net-guard.ts`: `isLoopbackPeer(remoteAddress: string | undefined, headers: IncomingHttpHeaders): boolean` (distinct from the existing `isLoopback(bind)` — different fail-closed semantics; do not merge). Guard: when auth-enabled + non-loopback bind, a protected-surface request from a non-loopback peer without a valid bearer → 401 fail-closed; loopback peer exempt.
- **boundary-conditions:** exhaustive UT cases — `127.0.0.0/8`→exempt, `::1`→exempt, **`::ffff:127.0.0.1`(IPv4-mapped)→exempt** (dual-stack `::` bind form; missing it spuriously 401s the local-admin/self-update rescue path — availability break, must-fix), `undefined`→NOT exempt (fail-closed), **ANY forwarded/tunnel client-IP header (`x-forwarded-for`/`cf-connecting-ip`/`forwarded`/`x-real-ip`) present ⇒ NEVER exempt** (closes the cloudflared-on-loopback hole that would exempt the whole internet). Keys on the **raw socket `remoteAddress` ONLY**, never a header. Auth-disabled ⇒ dormant; `POST /github/webhook` unaffected (own HMAC).
- **iter:** v15

### DES-098 — workflow ownership: owner column, mutation-only gate, idempotent boot backfill (ARCH-061)
- **status:** draft
- **traces:** ARCH-061, TASK-089
- **signature:** `WorkflowCatalog.register(name, script, defaults, principal): {version} | throws NOT_WORKFLOW_OWNER | throws HARNESS_DEFAULTS_INVALID` · `deregister(name, principal): {removed} | throws NOT_WORKFLOW_OWNER`. `ALTER TABLE workflows ADD COLUMN owner TEXT`. `workflow_get` output gains `owner`.
- **boundary-conditions:** owner recorded on FIRST registration; mutation (register-overwrite/deregister) by a non-owner → `NOT_WORKFLOW_OWNER`, stored definition unchanged; `run`/`get`/`list` NOT gated (B can run/read A's workflow, not change it). **`null` principal ⇒ ungated mutation even on an owned row** (one rule at the gate, no auth-flag plumbed into the catalog — keeps auth-disabled byte-for-byte pre-v15). Boot backfill `UPDATE workflows SET owner='hsuhungjung@gmail.com' WHERE owner IS NULL` runs once/boot, self-limiting (idempotent under re-run); auth-disabled ⇒ store NULL owner not a sentinel [D-AUTH-6]. Decided behavior (not a bug): a token-free loopback registration (NULL owner) is re-owned at the next boot. One boot log line `auth.migrate: N workflows backfilled to owner=<email>` (0-change when N=0).
- **iter:** v15

### DES-099 — harness defaults bound at registration: shared type, fail-closed validation, pure per-param merge (ARCH-062)
- **status:** draft
- **traces:** ARCH-062, TASK-089
- **signature:** single exported `interface HarnessDefaults { model?: string; tools?: string[]; skills?: string[]; timeoutMs?: number; prompt?: string }` consumed by all three consumers (register validation + `workflow_get` output + run-time merge — prevents schema drift). `resolveHarnessParams(registered: HarnessDefaults | undefined, overrides: Partial<HarnessDefaults>): EffectiveParams` — **PURE, per-param merge** (per-run value wins for that key only, unset keys fall back). `ALTER TABLE workflows ADD COLUMN defaults TEXT`; `TOOL_DEFS.workflow_register` gains OPTIONAL `defaults`.
- **boundary-conditions:** **register-time validation depth [D-AUTH-5, named assertions — do not simplify]:** shape + **model-alias resolvable** against the ARCH-005 table + **every `tool` name in the curated static allowlist** → on any unknown/ill-typed key or unresolvable model/tool → typed `HARNESS_DEFAULTS_INVALID` and **store NOTHING** (no partial write). **`skills` existence DEFERRED to run time** (mutable per-run uploaded assets; register-time coupling manufactures stale false-failures — the REQ says *tool*, not *skill*; a registered skill absent at run → typed run-time error). Backward-compat: `defaults` absent ⇒ registers exactly as pre-v15; the `tools/call` arg-cast at server.ts:747 widens for `workflow_register`/`workflow_deregister`; drift-locked in `tests/integration/schema-drift.test.ts`.
- **iter:** v15

### DES-100 — real-tier validation path + per-tier mock policy (REQ-012 + REQ-086..089)
- **status:** draft
- **traces:** REQ-012, REQ-086, REQ-087, REQ-088, REQ-089, TASK-085, TASK-086, TASK-087, TASK-088, TASK-089
- **real-tier path per REQ (real entrypoint + real wiring):**
  - REQ-012 / REQ-086 → running-server integration of the 4 OAuth routes + protected surfaces, driven by a **real MCP client library** for the discovery handshake (proves zero-custom-code discovery, not asserted); Google is a **genuine external dependency, legitimately doubled** via injected `googleBase`+`jwksFetch` (there is NO real external model call in this slice). Un-tokened hit to every protected route → real 401; valid engine bearer → 200 + `principal:<email>` on the run record. A bearer-authed `POST /assets/blob/:sha` / `POST /assets/manifest` → assert the CAS namespace **first-writer record equals the principal** via a direct store read (integration-tier store read, not an E2E SUT-boundary mock — closes REQ-086's "namespace carries the email that pushed it" clause). Paired with the I-2 hermeticity sweep (DES-096 DoD).
  - REQ-089 → **no second host needed:** bind `0.0.0.0`, connect to the machine's own **LAN IP** → genuine non-loopback `remoteAddress` → real 401; the identical call to `127.0.0.1` → real 200; a valid-HMAC webhook POST still self-updates.
  - REQ-087 → catalog owner-gate + idempotent boot-backfill integration (`:memory:`/real SQLite): owner mutation succeeds, non-owner → `NOT_WORKFLOW_OWNER`, backfill idempotent, `null`-principal ungated.
  - REQ-088 → pure `resolveHarnessParams` merge UT + register-validation integration (I-5 named assertions: model-alias-resolvable reject, unknown-tool reject, skills-deferred-to-run, no-partial-write on invalid).
  - Carried-forward regression (I-3, NOT a new DES/TASK) → **Gate 7.5 Validation** assertion: hung-provider slot-free within `timeoutMs+margin`, second run admits — tagged to REQ-083 (Slice B ships zero gateway code for a DES to bind to).
- **per-tier mock policy:** UNIT — mock freely (injected `clock`/`csprng`/`jwksFetch`/`now`, fake catalog, principal literals); all metadata builders, bearer-parse, `verifyIdToken` branches, `isLoopbackPeer`, `resolveHarnessParams`, owner-gate are pure/injectable UTs. INTEGRATION — real adjacent components (real server routes, real net-guard, real SQLite catalog + token-store); mock ONLY the genuine third-party network you cannot run (Google JWKS/consent → injected `googleBase`+`jwksFetch`). E2E/ACCEPTANCE — MUST NOT mock the SUT's own boundaries (the 4 OAuth routes, `resolvePrincipal`, the net-guard, the catalog, the CAS attribution write); Google stays a legitimately-doubled external dep via the injected base; the `0.0.0.0`+LAN-IP 401/200 is a real socket touch.
- **note (I-4, optional boundary):** `Cache-Control: no-store` on `/api/*` responses that carry `principal` is a defensible one-liner on the response writer (keeps PII out of shared/proxy caches given the cloudflared tunnel) — NOT a DES. `X-Frame-Options` explicitly **not adopted** (non-responsive: framing a JSON document does not let a cross-origin page read its body). The residual `/api/*`+dashboard PII exposure stays a recorded REQ-086 non-goal.
- **iter:** v15

## Class diagram — v15 Slice B (ARCH-059..063: auth AS + edge principal + ownership/harness binding + fail-closed bind)
```mermaid
classDiagram
    class OAuthMetadata {
        <<pure>>
        +buildProtectedResourceMetadata(cfg)
        +buildAuthServerMetadata(cfg) S256
        +wwwAuthenticateHeader(cfg) string
    }
    class TokenStore {
        -clock: () number
        -csprng: (n) Buffer
        +issue(principal, ttlMs) token+expiresAt
        +verifyByHash(rawToken) principal|null
        +mintAuthCode / consumeAuthCode  single-use atomic
        +putState / consumeState
        +gcExpired() number
    }
    class GoogleVerifier {
        <<injected JWKS+clock+base>>
        +verifyIdToken(idToken, deps) email
    }
    class AuthService {
        +startAuthorize / handleGoogleCallback / tokenExchange
        +resolvePrincipal(req) principal|401  // union, no throw
    }
    class Server {
        +GET /.well-known/oauth-protected-resource
        +GET /.well-known/oauth-authorization-server
        +GET /authorize / /oauth/google/callback
        +POST /token
        +callTool(...args, principal)
    }
    class NetGuard {
        <<pure>>
        +isLoopback(bind) bool
        +isLoopbackPeer(remoteAddress, headers) bool
    }
    class WorkflowCatalog {
        +owner TEXT  +defaults TEXT
        +register(name, script, defaults, principal) version
        +deregister(name, principal) removed
        +backfill owner IS NULL  idempotent
    }
    class HarnessDefaults {
        <<shared type>>
        +resolveHarnessParams(registered, overrides) EffectiveParams
    }
    Server --> AuthService : resolvePrincipal at edge (before side-effect)
    Server --> NetGuard : isLoopbackPeer (fail-closed)
    AuthService --> OAuthMetadata : builders
    AuthService --> TokenStore : issue/verify/consume
    AuthService --> GoogleVerifier : verifyIdToken (email_verified===true)
    Server --> WorkflowCatalog : register/deregister(principal) owner-gated
    WorkflowCatalog --> HarnessDefaults : validate + store + merge
```

### Decision rationale — v15 Slice B (DES-092..100, REQ-012 + REQ-086..089: engine-as-own-AS + per-caller principal + ownership + harness binding + fail-closed bind)
- **Panel provenance / converged r2:** synthesized from `.panel/design/adversarial.r1/r2.md` (opus — interface-contract / boundary-error / testability, Karpathy tie-break) + `quality-dimensions.r1/r2.md` (sonnet — observability / replaceability / consumability / self-sustainability). Both r2 confirm **convergence, not a fork**: quality self-deferred every heavyweight surface (SSE, `/metrics`, `/healthz`, refresh tokens, RunStore-swap port, harness SPI) under the same Karpathy discipline the adversarial lens applied. QM `safety_class` → no functional-safety / cybersecurity lenses. D-AUTH-1..6 adopted wholesale from the architecture.
- **RD-1 (slot-free hung-provider check) — quality conceded placement; recorded in DES-100 as a Gate-7.5 regression tagged REQ-083, NOT a new TASK/DES.** Slice B touches zero gateway/`Promise.race` code (shipped v14 IMPL-117..121); a DES needs code to attach to. The threat-model point (auth opens more submission paths to a hung provider) is honored by the carried-forward assertion, not a manufactured design artifact.
- **RD-2 (ARCH-061+062 granularity) — held as ONE merged task (TASK-089); quality seconded.** Same `workflows` primary key, same owner gate, same migration boot path — splitting is two tasks over one row. Quality's real ask (D-AUTH-5 validation depth not simplified away) is honored as **named DoD assertions inside the merged task**, which is a test-naming requirement, not a task-boundary one.
- **RD-3 (`/api/*` PII headers) — `Cache-Control: no-store` narrow-conceded as an optional one-line boundary note (DES-100), `X-Frame-Options` declined as non-responsive** (framing a JSON body doesn't leak it). Adversarial rebutted, quality's underlying concern (the PII residual) stays a recorded REQ-086 non-goal either way. Both lenses agree the real control (auth on `/api/*`) is out of slice.
- **A2⟂A4 reconciliation (synthesizer call): `workflow_run` DOES take `principal` (attribution), `workflow_get/list/status` do NOT.** Adversarial A4's literal "don't thread principal into read/run methods" was overruled where it collided with REQ-086's acceptance (the run record must carry the starting principal) and ARCH-060's own signature list. Correct cut: mutation+attribution methods take the param (register/deregister gate on it, run only records it); pure reads take none so "reads are open" is true by absence-of-parameter, not a runtime `if`. Getting A4's wording literally would fail REQ-086 attribution at validation.
- **C-1 append-one-param over CallContext (adversarial, quality flagged CallContext as named tech-debt).** Appending a nullable `principal` to the 14-arg `callTool` is the smallest diff that satisfies D-AUTH-2 explicitness and contains the security-review blast radius; the context-object refactor is deferred alongside the MCP-SDK migration (G-REP-1).
- **C-2 uniform 401 on the wire + internal DEBUG log (both lenses).** Distinguishing expired/unknown/malformed in the 401 body is info-disclosure on the unauthenticated listener; the operator's debuggability need is met by an internal-only `auth.resolve: {outcome}` log (no token value) — additive, no wire change (DES-095).
- **Quality r2 implementation notes folded into existing DES (no new items):** boot backfill log → DES-098; `gcExpired` try/catch + auth.resolve DEBUG log → DES-093/095; single-export `HarnessDefaults` → DES-099; I-2 paired presence+absence hermeticity IT → DES-096 DoD (referenced by DES-100).
- **v16 Gate-8 fix (F1), self-decided (no panel — small QM iteration in the ARCH-059 closure):** two shipped-code defects from the v15 Gate-8 review. **HIGH-1 (open-redirect → bearer theft):** v15's `/authorize` stored state and redirected to Google without validating `redirect_uri`, so an attacker could have the engine mint-and-deliver its auth-code to an attacker URL. Fix = enforce ARCH-059 invariant 4 with a pure `isLoopbackRedirectUri` gate BEFORE `putState` (DES-095). Kept in auth-service.ts, NOT merged with net-guard's `isLoopbackPeer` (socket-peer vs redirect-URL semantics — DES-097's do-not-merge note); did NOT generalize the host set beyond the REQ's exact `http:`+{127.0.0.1,localhost,[::1]} (Karpathy: no speculative `127/8`/https breadth). **MED-2 (unbounded auth tables):** v15 built `TokenStore.gcExpired()` but never called it. Fix = invoke it from the REQ-026 sweep (DES-093/095). **One decision I made and own:** the v15 sweep only existed when `workspaceTtlMs>0`, which would leave MED-2 half-fixed in the auth-enabled/no-TTL config; I widened the interval-creation condition to `workspaceTtlMs>0 OR auth enabled` (one condition change, stays in server.ts, no closure expansion) so the intent "tables do not grow without bound" holds in every auth-enabled config. The literal Gate-8 one-liner (wire only inside the existing TTL block) was rejected as an incomplete fix.
- **Karpathy check:** complexity budget spent only on ARCH-059 (the one genuine new subsystem — a minimal AS in four small pure/injectable files). ARCH-060 = a threaded parameter (not machinery), ARCH-061 = one column + idempotent backfill, ARCH-062 = one column + register validation reusing the existing alias table + tool allowlist, ARCH-063 = an extension of the existing `net-guard.ts` chokepoint (no new module). Every heavier option (JWT for statelessness, DCR/scopes/refresh, namespace-ownership enforcement, a separate auth-server file, a `CallContext` refactor, a RunStore port for the new columns, an OpenAPI file for self-describing `.well-known` docs) rejected as speculative. Auth is opt-in by config; disabled ⇒ byte-for-byte pre-v15 (every existing test runs unchanged). The dominant risks are all bypass/impersonation (a protected route skipping `resolvePrincipal`, the cloudflared-on-loopback exemption hole, a missing `email_verified` gate, a principal leaking into the sandbox) — made impossible-by-construction (single edge chokepoint, raw-socket keying, load-bearing verifier gate, control-plane-only attribution), not by adding machinery.
- **Seam consistency (Exit Gate 5):** in `token-store.ts` EVERY method that reads time reads the constructor-injected `clock()` and EVERY token/code/state value comes from the injected `csprng()` — there is no `Date.now()`/`crypto.randomBytes` anywhere in the module, so `issue`/`verifyByHash`/`consumeAuthCode`/`consumeState`/`gcExpired` are all deterministic under a fixed clock (no asymmetric method reading the wall clock behind the seam). `google-verifier.ts` reads time only through the injected `now`. `isLoopbackPeer` is clock-free and keys purely on the raw socket address. No method touching these concerns was left on the wall clock.

### Decision rationale — v17 (REQ-012 real-connect DCR fix; touches DES-092/093/095, ARCH-059, TASK-091)
- **v17 real-connect fix (F1), self-decided (no panel — QM iteration inside the ARCH-059 closure).** Live remote-connect from Claude Code failed: the MCP OAuth client reported "Incompatible auth server: does not support dynamic client registration". Root cause: v15's AS metadata advertised no `registration_endpoint` and the engine had no RFC 7591 handler, so a spec-only client with no pre-registered `client_id` could not even begin the flow. This **reverses** the v15 ARCH-059 "explicitly reject dynamic client registration" stance — that stance was wrong for a real spec-only MCP client (it presumed the client would arrive with a `client_id`). Fix = advertise `registration_endpoint` (DES-092) + implement a public `POST /register` (DES-095) persisting to a new `registered_clients` table (DES-093).
- **Decision A — port-agnostic redirect binding (not exact-match).** `/authorize`'s registered-client binding compares scheme+hostname+**pathname only, ignoring port** (RFC 8252 §7.3). Native/loopback clients bind a fresh ephemeral port each session; a cached `client_id` (the whole point of "survives restart") arrives with a new port, so exact-match would 400 the very live-connect case this fix exists to close — and it would only surface again at Gate 7.5. Safe because every registered redirect_uri is already loopback-clamped at register time.
- **Decision B — clamp requested metadata, do not reject it.** RFC 7591 lets the AS replace requested values; the MCP SDK commonly requests `refresh_token` in `grant_types`. Rejecting a richer registration re-breaks the connect, so `/register` pins grant/response/auth-method to the engine's single supported set and echoes the clamped values. 400s are reserved for non-loopback/empty/missing `redirect_uris` (`invalid_redirect_uri`) and unparseable JSON (`invalid_client_metadata`).
- **Decision C — bound the new table (self-decided, same MED-2 class I just closed).** `registered_clients` is an unauthenticated, tunnel-reachable write path. Rather than leave it unbounded, registrations carry a weeks-scale `expires_at` and are swept by the existing `gcExpired()` (extended from 3 tables to 4). An expired registration degrades gracefully to the loopback-only `/authorize` path — no user-facing breakage — so bounding costs nothing in correctness. This is why the binding is a reader that makes persistence observable, and honestly **not** a security boundary: the unregistered-`client_id` path stays open by design (it keeps IT-078 9a-9c green), and security still rests on loopback-only redirect validation + PKCE S256 + single-use state, all unchanged.
- **Seam consistency (Exit Gate 5):** the new `registerClient` obeys the same token-store seam as every sibling — `client_id` from the injected `csprng()`, `client_id_issued_at` from the injected `clock()` (seconds, RFC 7591 unit); no new `Date.now()`/`randomBytes` enters the module, and `gcExpired()` reads time only via `this.clock()`, so the 4th table's expiry/GC is deterministic under a fixed clock exactly like the other three. The raw `randomBytes` idiom already in auth-service.ts (state/nonce) is left untouched — surgical, not refactored.
- **Real-tier validation path:** REQ-012 v17 clause → a real `@modelcontextprotocol/sdk` auth client driving register→authorize→token end-to-end against the live engine over the cloudflared tunnel (VAL-095 extension at Gate 7.5); integration tier (IT-078, real server + real SQLite token-store, Google doubled via injected JWKS) proves the register/binding/persistence contract without third-party network. Mock policy unchanged from v15/v16: unit mocks freely; integration uses the real server + real store, doubling only Google's network; E2E/acceptance mocks none of the SUT's own boundaries.
