// Shared domain types — no implementation, pure TypeScript interfaces.
import type { ToolName } from './tool-specs.js';
import type { ErrorCode } from './errors.js';

/** v11 Sprint 3 (TASK-066 / DES-063): who triggered a run — total (never undefined/null/throws). */
export type StartedBy = {
  type: 'client' | 'webhook' | 'schedule' | 'chain' | 'unknown';
  id?: string;
};

// v8 Defer A: `interrupted` = a run that was `running` when the engine crashed/restarted — RESUMABLE
// (not terminal), distinct from a user `suspended`/`stopped`. hydrateAll assigns it at boot recovery.
export type RunStatus = 'queued' | 'running' | 'suspended' | 'stopped' | 'completed' | 'failed' | 'interrupted';

/** v25 (issue #53, adjudication #9 I-2): one structured observation about a run's terminal path.
 *  OBSERVABILITY ONLY — emitting one changes no control flow, refuses nothing and is never surfaced
 *  to a caller; it exists so the next occurrence of #53 leaves evidence at the scene instead of
 *  being caught by coincidence a second time.
 *
 *  Run `3977b82d-5a01-4b37-a4db-d4ea4feca17a` reached `failed` 8ms after a resume with (a) no
 *  `failed` row in its `transitions` and (b) its agent still running, for another ~36 seconds,
 *  producing output nobody would ever read. Both symptoms are directly detectable; neither left a
 *  line behind. These are the two detections, and each names the run so the two can be joined. */
export interface EngineWarning {
  /** `agent_live_at_terminal` — a run reached a terminal state while one of its agents was still
   *  `queued`/`running` (the orphan half; one record per such agent).
   *  `terminal_without_transition` — a run's queryable status is terminal but no matching row exists
   *  in its transitions (the unexplained half; the invariant ARCH-006's "one writer of every state
   *  transition" is supposed to make unbreakable). */
  kind: 'agent_live_at_terminal' | 'terminal_without_transition';
  /** ISO timestamp from the engine's own Clock — the field #53's investigation had to do without. */
  ts: string;
  runId: string;
  terminalState: RunStatus;
  /** Why the run went terminal, when the engine knows it (a failed run's error); `null` otherwise —
   *  `null` is itself the finding for #53, whose failure had no reason anywhere. */
  reason: string | null;
  /** `agent_live_at_terminal` only: the agent that was still live, and what state it was in. */
  agent?: { agentId: string; label?: string; state: string };
  /** `terminal_without_transition` only: the rows that DID land, as `"from->to"` — "which
   *  transitions were recorded" is the first question #53 raised and nothing could answer. */
  transitions?: string[];
}

/** O-2 (review finding): one recorded state transition — the audit trail ARCH-006 promises
 *  ("one writer of every state transition, timestamp+runId"). `from` is null for the initial
 *  queued state. Persisted by RunStore.recordTransition, read back via RunStore.getTransitions. */
export interface StateTransition {
  from: RunStatus | null;
  to: RunStatus;
  ts: string;
}

export interface ErrEnvelope {
  code: string;
  message: string;
  field?: string;
  /** v24 (DES-137, D-3): the ERROR_CATALOG pointer at the tool that explains this code — always
   *  read from the catalog by `errors.ts`'s `toErrEnvelope`, never hand-typed at a call site.
   *  `null` for a code the catalog marks as having no guide entry. */
  see?: 'workflow_authoring_guide' | null;
  /** v24 (DES-137): structured context a caller can branch on (`param`, `runId`, `errors[]`, …). */
  detail?: Record<string, unknown>;
}

export interface ResultEnvelope<T = unknown> {
  runId: string;
  status: RunStatus;
  result?: T;
  error?: ErrEnvelope;
  /** v15 (REQ-086 / DES-096): set only on workflow_status responses when auth is enabled and the
   *  run has an attributed principal. Absent (not null) when auth disabled or no attribution. */
  principal?: string;
  /** v26 (DES-183, ARCH-118, TASK-183, REQ-127): `run_result`'s usage read path — the run's
   *  persisted `RunUsage` plus whether a budget could actually bind, derived at READ from the
   *  run's price pin (never stored twice). Always present on a `run_result` response. */
  meta?: { usage: RunUsage; budgetEnforceable: { usd: boolean; tokens: boolean; unpricedModels: string[] } };
}

/** v26 (DES-183, ARCH-118, ADR-046/047, TASK-183, REQ-127): one run's usage total — THREE
 *  producers share this one shape (live guard overlay, at-rest fold over persisted transcripts,
 *  terminal snapshot). Sharing the shape is not what keeps them equal; the two folds agree because
 *  they apply the SAME per-column rule, and that rule is stated in one place, `foldUsage`'s docblock
 *  (run-guard.ts), with the live fold (`foldUsageFromRecords`, run-manager.ts) pointing at it:
 *  `tokens`/`costUSD`/`unpricedCalls` count only a `done` call — `unpricedCalls` only a `done` call
 *  whose price could not be resolved (ADR-046) — while `unmappedMessages` counts the unmapped
 *  provider system-message subtypes observed on a call of ANY state, keyed by subtype name and
 *  never carrying a value. v26 R-1 is what proves the distinction is load-bearing: for one
 *  iteration the at-rest fold gated the `unmappedMessages` column on the tokens rule as well, and
 *  the two producers silently disagreed on that whole column with every test green. IT-156's
 *  deep-equal case (a done call and a terminally-failed call, one run, both folds) is the lock. */
export interface RunUsage {
  tokens: Tokens;
  costUSD: number;
  unpricedCalls: number;
  unmappedMessages: Record<string, number>;
}

export interface Budget {
  total: number | null;
  spent(): number;
  // v26 (DES-182, TASK-182): widened from `number` — `SandboxBudget.remaining()` below returns
  // `null` when no USD limit is armed, and this interface's only two producers (`run-guard.ts`'s
  // `budgetView()`, which still returns a plain `number`/`Infinity`, and `SandboxBudget` itself)
  // both satisfy this wider signature; no caller does arithmetic assuming non-null.
  remaining(): number | null;
}

/** v26 (DES-180, ARCH-118, TASK-180): the four-column token count for one call — a strict,
 *  fully-populated shape (unlike `AgentRecord.tokens`/`GatewayResult['tokens']`, which keep
 *  `cacheRead`/`cacheWrite` OPTIONAL for pre-v26 backward compatibility). Runtime values
 *  (`ZERO_TOKENS`, `sumTokens`, `priceCall`) live in `run-guard.ts`; the type lives here beside
 *  `FourRates`, the price shape it is priced against. */
export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** v26 (DES-182, ARCH-118/114, TASK-182, ADR-037): the sandbox SCRIPT-VISIBLE `budget` object —
 *  distinct from `Budget` above (`run-guard.ts`'s pre-v26, token-only `budgetView()`, unchanged).
 *  `total`/`spent()`/`remaining()` are USD (ARCH-118: "the script-visible `budget` keeps `total` /
 *  `spent()` / `remaining()` in USD and gains `tokens()`"); `limits`/`total`/`remaining()` are
 *  `null` — never `Infinity` — when no USD limit is armed: `null` is `===`-detectable but NOT
 *  comparison-safe (`null < 1000` is `true`), which is why this ships paired with the authoring
 *  guide sentence naming which accessor answers which limit (DES-187), not instead of it. Live,
 *  not resume-stable, like the `Budget` it replaces on this one surface. */
export interface SandboxBudget {
  limits: { usd: number | null; tokens: number | null };
  /** alias of limits.usd (ADR-037) */
  total: number | null;
  /** USD spent so far */
  spent(): number;
  remaining(): number | null;
  tokens(): Tokens & { sum: number };
}

/** v26 (DES-178, ARCH-116, ADR-038, TASK-178): USD-per-TOKEN rates for one model — four columns
 *  because a cache read/write is priced differently from a fresh input/output token. `null` means
 *  "we don't know" (never guessed); an all-zero object (ollama, a genuinely free openrouter route)
 *  is a KNOWN fact and must never collapse to `null`. */
export interface FourRates {
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
}

/** v26 (DES-178): declared (never probed) per-(provider,model) capability, carried beside price so
 *  a run's pin can answer "does this model take a reasoning/tool-use dial" without a second lookup
 *  at dispatch time. `source` names where the DECLARATION came from — 'upstream' (a fetched catalog
 *  row), 'static' (the built-in fallback table), 'unknown' (no data at all). */
export interface Caps {
  reasoning: boolean | 'unknown';
  tools: boolean | 'unknown';
  source: 'upstream' | 'static' | 'unknown';
}

/** v26 (DES-178): one (provider,model)'s pinned price + capability — `price:null` and
 *  `caps:{...:'unknown'}` together mean "we looked and found nothing", distinguishable from "we
 *  never looked" only by the row's PRESENCE in `PriceBook.pinned` (ARCH-116's "the pin is never
 *  empty"). */
export interface BookEntry {
  price: FourRates | null;
  caps: Caps;
}

/** v26 (DES-178, ADR-038): the admission-time price/capability pin written once by
 *  `RunManager.start()` (never re-resolved on resume — pinning is what makes a run's arithmetic
 *  immune to a mid-run price change or a listing outage). `fetchedAt`/`source` describe the
 *  UNDERLYING catalog snapshot this pin was built from, not the run's own start time. `pinned` is
 *  keyed `"<provider>/<model>"`, one entry per model this run can reach — present even when every
 *  entry prices `null` (that emptiness is itself the honest "we looked and found nothing"). */
export interface PriceBook {
  fetchedAt: string;
  source: 'live' | 'last-good' | 'static';
  pinned: Record<string, BookEntry>;
}

export interface AgentOpts {
  label?: string;
  phase?: string;
  schema?: object;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** issue #24/#22: per-call total timeout in ms. Overrides the gateway's configured default in BOTH
   *  directions (a default, not a ceiling — a caller may shorten or lengthen it). On timeout the call
   *  yields null (after retries), like any gateway failure — it does NOT throw. An invalid value
   *  (non-positive / non-finite / non-number) is ignored and the gateway default applies. */
  timeoutMs?: number;
  isolation?: 'worktree';
  /** REQ-017 (D-V3M-1): names of server-side-provisioned MCP servers this agent references
   *  (`agent(prompt, {mcp:['name']})`). Resolved by the SDK gateway against the MCP Provisioning
   *  Registry at session-build time (McpRegistry.resolveInjected) — ONLY these explicitly-named
   *  entries are injected (strictMcpConfig preserved); an unprovisioned name is already rejected at
   *  submission (SubmissionValidator). Survives the sandbox boundary as an opaque opts field. */
  mcp?: string[];
  /** v25 (issue #55, adjudication #9 I-1.1): the tool surface handed to THIS agent —
   *  `agent('a', {prompt, allowedTools: []})` gives it no tools at all, which is what a prose-only
   *  task on a small model needs (a model holding Write/Edit/Bash answers with a tool-call envelope
   *  instead of prose). Precedence, declared rather than inferred: this per-call value > the
   *  gateway's configured `defaultAllowedTools` (agent-executor.ts, claude-agent-sdk-client.ts) —
   *  the per-definition frontmatter rung that used to sit between the two was retired at v34.
   *
   *  The field is not new — the whole pipeline has honoured it since v21 — but it was reached
   *  through `(req.opts as AgentOpts & {allowedTools?: string[]})` at both consumers, so it existed
   *  for neither the compiler nor an author reading this interface, and `LOCKED_KEYS` advertised a
   *  DIFFERENT name (`tools`) that addressed nothing. That gap is #55: the v24 cold subject wrote
   *  `tools: []`, was silently ignored, and worked around a capability it already had. */
  allowedTools?: string[];
}

export interface AgentRecord {
  agentId: string;
  label?: string;
  phase?: string;
  /** v26 (DES-175, ARCH-114, TASK-186): the phase lane's ordinal (0-based), snapshotted at IPC
   *  receipt alongside `phase` — `layoutGraph` (DES-176) joins by this ordinal rather than by
   *  re-matching the title string. Absent exactly when `phase` is absent (pre-v26 record / no
   *  phase() dispatched yet). */
  phaseIndex?: number;
  /** v25 (REQ-120, issue #61): `refused` is a TERMINAL state meaning the engine declined to
   *  dispatch this call at all — it never reached a gateway, so it has no tokens, no transcript and
   *  no `startedAt`. Before v25 such a call had no record of any kind (the reported run's only trace
   *  was a gap in the journal's callSeq), which is exactly what made the loss invisible. */
  state: 'queued' | 'running' | 'done' | 'failed' | 'refused';
  provider: string;
  model: string;
  /** v26 (DES-177, ARCH-115, TASK-177, REQ-125): which wire actually carried this call — distinct
   *  from `provider`/`model`, which are now the RESOLVED provider/model the harness stamped (never
   *  the transport name). Optional: absent on a pre-v26 record and on a call that never reached a
   *  gateway (queued/refused). */
  transport?: 'claude-agent-sdk' | 'direct-fetch';
  /** v26 (DES-177, TASK-177): the LiteLLM-proxy-facing model id actually put on the wire (the
   *  `rwe-proxy-*` cloak or a raw passthrough id) — present only on the LiteLLM-proxy route,
   *  absent on an Anthropic-direct dispatch (there is no cloak to report). */
  proxyModel?: string;
  /** v26 (DES-180, DES-188): `cacheRead`/`cacheWrite` are optional so a pre-v26 record (persisted
   *  before the four-column split) keeps type-checking with only `input`/`output` — a legacy
   *  two-column usage event derives BOTH to `0` (a KNOWN zero, not an absence). */
  /** [v31, REQ-186, R30-A1] OPTIONAL: a call that has not reported usage yet has NO figure. It was
   *  required and zero-filled on the `queued`/`running` branches, so an agent still in flight was
   *  reported as having measurably used zero — three dashboard surfaces printed `0 tok` for an
   *  agent that finished at 2861. `failed` and `refused` keep their zeros on purpose (DES-188: a
   *  failed call moves no counter, and both are TERMINAL — nobody is waiting for the figure). */
  tokens?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  /** v26 (DES-180, DES-188, ADR-046): USD cost of this call, derived via `priceCall`; OPTIONAL —
   *  absence means "pre-v26 record" (never re-priced against today's catalog), never "free". */
  costUSD?: number;
  /** v26 (DES-180, DES-188): true iff `costUSD` could not be priced (no rate for this model) —
   *  counts only on a `done` call; a `refused` call is genuinely `unpriced:false` (it never
   *  dispatched). OPTIONAL for the same pre-v26 reason as `costUSD`. Deliberately left optional on
   *  `AgentRecord` (DES-188's own boundary) — the derived≡snapshot lock, not `tsc`, is what catches
   *  a branch that forgets to set it. */
  unpriced?: boolean;
  /** v26 integration (DES-183, clarification 38): the provider system-message subtypes this call
   *  produced that the engine could not map — carried on the record so the LIVE fold
   *  (`foldUsageFromRecords`) has a column to count at all, instead of being structurally `{}`
   *  forever. It is carried on a record of EVERY state, and (v26 R-1) counted by the AT-REST fold
   *  (`foldUsage`) on every persisted usage event, tokens or not — that pair of rules, not the
   *  presence of the field, is what makes the two folds reach the SAME
   *  `RunUsage.unmappedMessages`; a terminally-failed call carries `unmapped` and no `tokens`, so
   *  either fold gating this column on tokens/`done` re-opens the disagreement.
   *  Absent (never `[]`) when the call produced none, so a pre-v26 record and a clean v26 record
   *  keep the same shape and DES-188's derived≡snapshot deep-equal lock still holds. */
  unmapped?: string[];
  /** v26 (H-3 send-back repair, ARCH-111, DES-171, INV-V26-5): the provider-authored error detail
   *  from a `state:'failed'` call (`GatewayResult.detail`) — so `run_status.agents[]`/the dashboard
   *  agent detail answers the post-mortem question "why did this fail" from the record alone
   *  (ARCH-115), instead of only on the per-agent transcript's `usage` event. Redacted THEN capped
   *  at 1024 bytes (never the reverse — capping first can split a secret across the cut and defeat
   *  `redact()`'s value-exact match, the same rule `capPrompt` was moved for at v21 Gate 8, R-G9).
   *  Absent on `done`/`queued`/`running`/`refused` records, and on a `failed` record whose gateway
   *  reported no detail. */
  detail?: string;
  /** v8 Slice 2 (REQ-045): the composite nesting frame this agent ran in — `""` for the top-level
   *  script's own agents; a nested workflow()'s agents carry a non-root frame whose parent frame is a
   *  strict prefix (so the dashboard groups + nests agents by frame). Absent for pre-v8 records. */
  frame?: string;
  /** v8 Slice 2b (REQ-051): ISO time this agent was dispatched to the gateway (once it acquired its
   *  concurrency slot). Absent while still queued. */
  startedAt?: string;
  /** v8 Slice 2b (REQ-051): ISO time this agent settled (done/failed). Absent while in flight. */
  endedAt?: string;
  /** v25 (REQ-120): the named reason a `refused` record exists — a closed-catalog ErrorCode
   *  (`BUDGET_EXCEEDED` today). Absent on every other state. */
  reasonCode?: ErrorCode;
  /** issue #20: ISO time of the most recent live transcript event (message/tool_call/tool_result)
   *  the gateway streamed for this still-running agent — bumped per message by the onEvent hook. Lets
   *  workflow_status distinguish a PROGRESSING agent (lastActivityAt advancing past startedAt) from a
   *  HUNG one (lastActivityAt stays at startedAt / absent), which tokens-only-at-terminal could not.
   *  Absent until the first streamed event; the terminal usage event does not bump it. */
  lastActivityAt?: string;
}

export interface PhaseView {
  title: string;
  /** v8 Slice 2b (REQ-050): ISO time this phase() was entered — the phase timeline; the last entry
   *  while the run is still `running` is the current step. */
  ts: string;
}

/** v8 Slice 2 (REQ-046): one per nested `workflow(name)` call — the composite-linkage boundary the
 *  dashboard renders as a sub-card. `frame` equals the frame that call's own inner agents carry;
 *  `parentFrame` is the caller's frame (`""` at the top level); `depth` is 1-based. */
export interface WorkflowNodeView {
  frame: string;
  name: string;
  parentFrame: string;
  depth: number;
  /** v26 (DES-175, ARCH-114, TASK-186, REQ-124): titles this nested frame's OWN `phase()` calls
   *  recorded — additive, persisted with the snapshot. A nested frame's phase() call lands HERE,
   *  never on the parent run's `phases` timeline (pushing it there would warn on a legal parent
   *  script). Absent/`[]` for a frame that never called `phase()` of its own. */
  phases?: string[];
}

export interface RunStatusView {
  runId: string;
  status: RunStatus;
  phases: PhaseView[];
  agents: AgentRecord[];
  /** v8 Slice 2 (REQ-046/047): nested workflow() boundary nodes for an in-process run ([] otherwise). */
  workflowNodes: WorkflowNodeView[];
  scriptVersion: string;
  /** v11 Sprint 3 (TASK-066 / DES-063): who triggered the run; coalesced to {type:'unknown'} for legacy rows. */
  startedBy?: StartedBy;
  /** v11 Sprint 3 (TASK-067 / DES-064): ISO timestamp of the first terminal transition (completed/failed/stopped);
   *  absent while the run is still running, so clients can stop polling once truthy. */
  terminalAt?: string;
  /** v35 (DES-231, TASK-235, REQ-205): the failure reason, surfaced only when `status === 'failed'`
   *  — a non-NULL `error` on a non-failed row (the crash-window: written, then reclassified
   *  `interrupted` by REQ-060 boot recovery before the terminal transition) is stale and never
   *  served. */
  error?: { code: string; message: string };
  /** v35 (DES-234, TASK-236, REQ-207): count of `failed`/`refused` agents; OMITTED (never `0`)
   *  when the run has no agent records at all. */
  failedAgentCount?: number;
  /** v13 (REQ-080 / DES-083): engine-pull seedRef outcome — the resolved sha, bytes, latency, when it
   *  was fetched, any dropped symlink/gitlink paths, and (on failure) the typed failCode/failDetail.
   *  Absent unless the run used a seedRef. */
  seedRef?: {
    resolvedSha: string;
    bytes: number;
    latencyMs: number;
    fetchedAt: string;
    dropped: string[];
    failCode?: 'SEEDREF_FETCH_FAILED' | 'SEEDREF_SHA_MISMATCH' | 'SEEDREF_TOO_LARGE';
    failDetail?: string;
  };
  /** v14 (REQ-082 / DES-087): sha256 of the manifest blob used for this run's seed (client-derivable).
   *  Absent unless the run used a seedManifestRef. */
  seedManifestRef?: string;
  /** v15 (REQ-086 / DES-096): authenticated caller identity attributed at submission time.
   *  Absent when auth is disabled or the caller is a token-free loopback peer. */
  principal?: string;
  /** v22 (DES-113, TASK-108): the legacy-cohort fallback record — set when this run's pinned
   *  scriptVersion is absent from workflow_versions (the name row exists, but the pin doesn't,
   *  e.g. after a deregister/re-register restarted the lineage) and resume resolved through
   *  `release` instead. The pin itself is NEVER rewritten; this is a sibling record of what
   *  actually happened. Absent for every run that resolved its own pin normally. */
  legacySubstitution?: { pinned: string; resolved: string };
  /** v26 (DES-183, ARCH-118, TASK-183, REQ-127): this run's usage total — live-overlaid for an
   *  in-process run, folded from persisted transcripts otherwise (`getRun`'s own fallback, mirroring
   *  `agents` above). Absent only for a run row that predates this field (never re-derived as 0). */
  usage?: RunUsage;
}

export interface RunSummary {
  runId: string;
  name?: string;
  status: RunStatus;
  scriptVersion: string;
  createdAt: string;
  /** v11 Sprint 3 (TASK-066 / DES-063): who triggered the run; coalesced from started_by column. */
  startedBy?: StartedBy;
  /** v11 F1 (DES-071): ISO timestamp of the first terminal transition (completed/failed/stopped);
   *  absent for non-terminal or legacy runs where no terminal transition is recorded. */
  terminalAt?: string;
  /** v27 (DES-194, ADR-052, TASK-199, REQ-141): the four usage-projection fields, sourced by
   *  `listSummaries()`'s one precedence chain (live overlay, else at-rest fold). Omitted TOGETHER
   *  for a run with zero `agent()` calls — never `0`, which would mean "priced at zero". */
  costUSD?: number;
  unpricedCalls?: number;
  tokensTotal?: number;
  agentCount?: number;
  /** v35 (DES-231, TASK-235, REQ-205): same gating as `RunStatusView.error` — surfaced only when
   *  `status === 'failed'`. */
  error?: { code: string; message: string };
  /** v35 (DES-231/234, TASK-235, REQ-207): the `_USAGE_PROJECTION` read-surface count — omitted
   *  (never `0`) when there is no snapshot, a `{usage}`-only snapshot, or zero agents; present and
   *  0 for a terminal run whose agents all succeeded. */
  failedAgentCount?: number;
}

/** v24 (DES-151, TASK-155): the four tool names whose read surfaces an admin cross-owner read
 *  audits. `TOOL_SPECS` is now `as const` (TASK-155), so `ToolName` is a true 35-member literal
 *  union and this `Extract` narrows to the intended 4 — never `never` (verified: TASK-155's
 *  report records the positive/negative compile check). */
export type AuditAction = Extract<ToolName, 'workspace_list' | 'workspace_pull' | 'run_agent_log' | 'run_result'>;

/** v24 (DES-151): one recorded admin cross-owner read. `owner` is the run's actual owner (not the
 *  reading admin); `path` only for workspace reads. */
export interface AuditEvent {
  ts: string;
  actor: string;
  action: AuditAction;
  runId: string;
  owner: string;
  path?: string;
}

/** v24 (DES-152): RunStore.list()'s filter — `principal` is set by the FACADE from the caller's own
 *  id, never from caller-supplied args (a caller cannot pass `principal` directly). `limit` defaults
 *  to 50, capped at 500 by the store. */
export interface RunListFilter {
  workflow?: string;
  status?: RunStatus;
  principal?: string;
  limit?: number;
}

/** v24 (DES-150): a fire-path refusal — policy refused the firing BEFORE dispatch, distinct from
 *  `lastError` (dispatch itself failed). Shared vocabulary between the scheduler (TASK-141) and
 *  webhook registry (TASK-142) — declared once here so neither redeclares it. */
export type RefusalReason = 'UNCLAIMED' | 'CLAIMED_WORKFLOW_MISSING' | 'NOT_IN_RELEASE' | 'CHANNEL_UNPUBLISHED';

export interface RunSpec {
  name?: string;
  /** v22 (REQ-098 / DES-114, TASK-109): CLOSED at every ingress (advertised schema, facade,
   *  RunManager.start() itself) — a submission carrying this is refused INLINE_SCRIPT_CLOSED, never
   *  admitted. Field kept (not deleted) ONLY because RunSpec doubles as the persisted-spec read-back
   *  type: a run suspended before this ban shipped has a real `script` value in storage and must
   *  still resume through it (`_requireLive` in run-manager.ts). Never populated by a new run. */
  script?: string;
  args?: unknown;
  /** v26 (DES-181, ARCH-118, TASK-181): widened from `number | null` — the `number` arm survives
   *  ONLY because persisted pre-v26 rows contain it (`parseBudget(v, {source:'store'})` rehydrates
   *  it as `{tokens: n}`, its true v25 meaning); a fresh wire admission sending a bare number is
   *  refused (`call-tool.ts`, ahead of ajv). */
  budget?: number | { usd?: number; tokens?: number } | null;
  /** v22 (REQ-097 / DES-114, TASK-109): explicit version selector — wins over any `channel`.
   *  Ignored (never resolved) unless `name` is set. */
  version?: string;
  /** v22 (REQ-097 / DES-114, TASK-109): named-channel selector ('beta'|'release'); defaults to
   *  'release' when neither `version` nor `channel` is supplied. */
  channel?: 'beta' | 'release';
  /** v11 Sprint 3 (TASK-066 / DES-063): who triggered this run — set at the start() call site. */
  startedBy?: StartedBy;
  /** REQ-025 (v2): optional seed tree materialized into the run workspace BEFORE agents start, so
   *  the run's agents edit a real project in place. `.claude` settings/hooks are stripped and
   *  escapes rejected by workspace-seed.materializeSeed. */
  seed?: { path: string; contentB64: string }[];
  /** v10 Slice 2 (REQ-065): efficient seed — a CAS manifest assembled from the content store (blobs
   *  uploaded beforehand via blob_put) instead of inline base64. Same guardrails as `seed`.
   *  `seedNamespace` scopes which blobs count as present (per-tenant refset). */
  seedManifest?: ManifestEntry[];
  seedNamespace?: string;
  /** v13 (REQ-080 / DES-080, TASK-077): engine-pull seed — fetch a pinned commit from an allowlisted
   *  remote, verify sha, assemble into CAS, then materialize via the existing materializeManifest branch.
   *  Mutually exclusive with `seed`, `seedManifest`, and `seedManifestRef`. Requires seedRefAllowlist in engine config. */
  seedRef?: { repoUrl: string; sha: string };
  /** v14 (REQ-082 / DES-087): server-side manifest ref — the sha256 of a manifest blob registered via
   *  POST /assets/manifest. Mutually exclusive with `seed`, `seedManifest`, and `seedRef`. */
  seedManifestRef?: string;
  /** v15 (REQ-086 / DES-096): authenticated caller identity — attributed on the run record.
   *  null iff auth disabled or token-free loopback caller. NEVER forwarded to sandbox env. */
  principal?: string | null;
  /** v37 (ARCH-182, DES-263, TASK-258, REQ-218, ADR-086): REQUIRED on purpose — the compiler, not a
   *  reviewer, is what stops a fifth `RunManager.start()` admission site from being added without
   *  answering the remoteness question `admissionRefusal()` gates on. Stamped at each of the four
   *  admission sites from that site's own already-loaded provenance fact (never a live peer check —
   *  ADR-086's ruling is keyed on the TRIGGER's stored provenance, never the workflow version's
   *  registering author). `RunSpec` also doubles as the persisted-spec read-back type (see below);
   *  the `runs` table never gained an `origin` column, so `getSpec()` synthesizes `'local'` on every
   *  read-back — harmless because a resume is gated by `call-tool.ts`'s door, not this predicate. */
  origin: 'local' | 'remote';
}

/** v10 Slice 2 (REQ-065): a CAS-manifest seed entry — REGULAR FILES ONLY (no mode int, no symlink/type,
 *  ever — see docs/seed-sync-architecture.md). `exec` carries the sole safe metadata bit. */
export interface ManifestEntry {
  path: string;
  sha256: string;
  exec?: boolean;
}

export interface CallKey {
  prompt: string;
  opts: AgentOpts;
}

export interface JournalEntry {
  callSeq: number;
  key: CallKey;
  value: unknown | null;
  ts: string;
  scriptVersion: string;
  /** D-F13: true when `value` is null because workflow_suspend/workflow_stop aborted this call
   *  mid-flight (an ABORTED-null), never because the gateway genuinely returned a terminal failure
   *  (a legitimate TERMINAL-null, REQ-003's own documented outcome). ResumeCache.replay() treats an
   *  aborted entry as a cache MISS — the call must re-run live on resume, producing the same result
   *  an uninterrupted run would — while a plain terminal-null (this field absent/false) remains a
   *  valid, replayable cache hit. Absent/false for every entry recorded before D-F13 (default replay
   *  behavior unchanged). */
  aborted?: boolean;
}

/** DES-066 (TASK-069): the post-curation session surface — names only, never secrets or resolved configs. */
export interface HarnessDescriptor {
  /** v26 integration (DES-177, REQ-125, clarification 26): the RESOLVED provider model id this
   *  dispatch actually reached (e.g. `google/gemini-3.8-flash`) — never the `rwe-proxy-*` cloak.
   *  The descriptor is what `markHarness` stamps onto the live `AgentRecord`, and `capture()`'s
   *  harness-wins merge keeps it, so putting the cloak here made `record.model === record.proxyModel`
   *  on every LiteLLM-route call — exactly the thing REQ-125 exists to prevent. */
  model: string;
  /** v26 integration (DES-177, REQ-125): the proxy-facing model id actually put on the wire (the
   *  `rwe-proxy-*` cloak). Present only on the LiteLLM-proxy route — absent on an anthropic-direct
   *  dispatch and on a raw `openrouter/<id>` passthrough, where there is no cloak to report.
   *  Mirrors `AgentRecord.proxyModel`/`GatewayResult.proxyModel`, one meaning across all three. */
  proxyModel?: string;
  /** Resolved provider for `model` (e.g. 'anthropic'/'ollama'/'openrouter'). Emitted at session-build
   *  time so workflow_status can show WHICH backend a still-running agent is waiting on — before the
   *  first token, so a hung/slow backend is diagnosable rather than a blank `provider:""` (issue #20). */
  provider: string;
  /** 4KB head+tail capped prompt (DES-066: first 2048 + "…[truncated]…" + last 2048). */
  prompt: string;
  tools: string[];
  skills: string[];
  mcpServers: string[];
  /** v22 (REQ-099, adjudication #4 N-1): names this agent referenced in `opts.mcp` that could NOT be
   *  resolved against the provisioning registry at dispatch — the capability is absent from the
   *  session and the run says so. REQ-099 forbids retroactively refusing such a (pre-v22, since
   *  registration now refuses it) workflow, and equally requires the condition to be observable
   *  rather than silently swallowed; this is that record, following `effortApplied`'s `{reason}`
   *  branch — the same honest-no-op convention. Emitted ONLY when non-empty (absent, never `[]`), so
   *  a run with nothing dropped carries a byte-identical descriptor to before. */
  mcpUnresolved?: string[];
  surfaceType: 'curated' | 'none';
  /** v21 (ARCH-068, DES-105, TASK-101): the resolved per-call effort directive, when any rung set one. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** v21 (DES-106, TASK-102): tri-state record of whether/how `effort` reached the wire — applied
   *  (with the provider param+value) / not-applied (with a reason, e.g. no dial for this provider) /
   *  absent when no effort was ever requested. Recorded ≡ applied by object identity (no re-lookup). */
  effortApplied?: { param: string; value: unknown } | { reason: string };
  /** v21 (ARCH-068, DES-105, TASK-101): the resolved per-call timeout, when any rung set one. */
  timeoutMs?: number;
  /** v21 (ARCH-068, DES-105, TASK-101): per-key precedence rung each resolved value came from —
   *  the self-diagnosing tripwire for a wiring miss (a knob silently falling through shows up as
   *  'engine' where a rung was expected). Optional: historical records and gateway-emitted
   *  descriptors (before the executor's single decoration site runs) lack it. */
  provenance?: Record<'model' | 'effort' | 'timeoutMs' | 'appendPrompt', 'call' | 'agentType' | 'override' | 'default' | 'engine'>;
  /** v24 (ARCH-104/DES-160, TASK-145): this dispatch's script agent() label — the first DURABLE
   *  source `deriveAgentRecords` reads (DES-161); absent for a call with no `opts.label` and for
   *  every pre-v24 record. */
  label?: string;
  /** v26 integration (DES-176 cohort (i), REQ-124): the phase lane this call was RECEIVED in —
   *  `markQueued`'s receipt-time snapshot, carried onto the descriptor at the one decoration site.
   *  DES-176 says a v26 record's lane is "exact from the live stamp OR the harness event"; only the
   *  live-stamp half existed, so a `done` record reconstructed by `deriveAgentRecords` after a
   *  restart (no snapshot) lost its lane and fell back to frame-grouping — the exact defect
   *  REQ-124 is about, invisible until v26 made phases universal. Absent on a pre-v26 record and on
   *  a call dispatched before the script's first `phase()`. */
  phase?: string;
  /** v26 integration (DES-176): the 0-based lane ordinal beside `phase`, which is the key
   *  `layoutGraph` actually joins on. Absent exactly when `phase` is absent. */
  phaseIndex?: number;
  /** v24 (ARCH-103/DES-154/DES-160, TASK-145): the ACTUAL materialized set for this dispatch — not
   *  the declared one (a declared-but-absent name lands in `missing`, never silently dropped). A
   *  `surfaceType:'none'` dispatch materializes nothing (DES-154), so its `skills`/`mcp` are empty
   *  and every declared name is `missing`. Absent for every pre-v24 record. */
  materialized?: { skills: string[]; mcp: string[]; missing: string[] };
}

export interface TranscriptEvent {
  ts: string;
  /** v26 (DES-188, TASK-188, ADR-046, REQ-120): `'refused'` — the engine declined to dispatch this
   *  call at all (`markRefused`'s own journal row), so a budget refusal read back after a restart
   *  with no terminal snapshot still reconstructs (`deriveAgentRecords`'s branch (3)) rather than
   *  being silently omitted. */
  kind: 'message' | 'tool_call' | 'tool_result' | 'usage' | 'harness' | 'refused';
  data: unknown;
}

/** v27 (DES-192, ARCH-131/127/129, ADR-054, TASK-197): `run_agent_log`'s / the HTTP agent-detail
 *  route's own view type — replaces the anonymous inline intersection this used to be declared as
 *  at the one call site. `result` is NOT redeclared here: `ResultEnvelope<T>` already carries it as
 *  OPTIONAL, and the facade-error branch returns without it, so a required redeclaration would fail
 *  that branch's fixture `satisfies` check. `record` is OPTIONAL for the same reason — the error
 *  branch never resolved an agent to attach one. */
export interface AgentLogView extends ResultEnvelope<TranscriptEvent[]> {
  harness: HarnessDescriptor | null;
  events: TranscriptEvent[];
  hasMore: boolean;
  /** v27 (DES-197, ARCH-131, TASK-202): the full `AgentRecord` — present on the success branch,
   *  absent on the facade-error branch. */
  record?: AgentRecord;
}
