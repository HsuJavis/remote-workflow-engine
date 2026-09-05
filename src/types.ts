// Shared domain types — no implementation, pure TypeScript interfaces.
import type { ToolName } from './tool-specs.js';

/** v11 Sprint 3 (TASK-066 / DES-063): who triggered a run — total (never undefined/null/throws). */
export type StartedBy = {
  type: 'client' | 'webhook' | 'schedule' | 'chain' | 'unknown';
  id?: string;
};

// v8 Defer A: `interrupted` = a run that was `running` when the engine crashed/restarted — RESUMABLE
// (not terminal), distinct from a user `suspended`/`stopped`. hydrateAll assigns it at boot recovery.
export type RunStatus = 'queued' | 'running' | 'suspended' | 'stopped' | 'completed' | 'failed' | 'interrupted';

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
}

export interface Budget {
  total: number | null;
  spent(): number;
  remaining(): number;
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
  agentType?: string;
  /** REQ-017 (D-V3M-1): names of server-side-provisioned MCP servers this agent references
   *  (`agent(prompt, {mcp:['name']})`). Resolved by the SDK gateway against the MCP Provisioning
   *  Registry at session-build time (McpRegistry.resolveInjected) — ONLY these explicitly-named
   *  entries are injected (strictMcpConfig preserved); an unprovisioned name is already rejected at
   *  submission (SubmissionValidator). Survives the sandbox boundary as an opaque opts field. */
  mcp?: string[];
  /** v25 (issue #55, adjudication #9 I-1.1): the tool surface handed to THIS agent —
   *  `agent('a', {prompt, allowedTools: []})` gives it no tools at all, which is what a prose-only
   *  task on a small model needs (a model holding Write/Edit/Bash answers with a tool-call envelope
   *  instead of prose). Precedence, unchanged and now declared rather than inferred: this per-call
   *  value > the agentType definition's `tools` frontmatter > the gateway's configured
   *  `defaultAllowedTools` (agent-executor.ts, claude-agent-sdk-client.ts).
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
  state: 'queued' | 'running' | 'done' | 'failed';
  provider: string;
  model: string;
  tokens: { input: number; output: number };
  /** v8 Slice 2 (REQ-045): the composite nesting frame this agent ran in — `""` for the top-level
   *  script's own agents; a nested workflow()'s agents carry a non-root frame whose parent frame is a
   *  strict prefix (so the dashboard groups + nests agents by frame). Absent for pre-v8 records. */
  frame?: string;
  /** v8 Slice 2b (REQ-051): ISO time this agent was dispatched to the gateway (once it acquired its
   *  concurrency slot). Absent while still queued. */
  startedAt?: string;
  /** v8 Slice 2b (REQ-051): ISO time this agent settled (done/failed). Absent while in flight. */
  endedAt?: string;
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
  budget?: number | null;
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
  model: string;
  /** Resolved provider for `model` (e.g. 'anthropic'/'ollama'/'openai'). Emitted at session-build
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
  /** v24 (ARCH-103/DES-154/DES-160, TASK-145): the ACTUAL materialized set for this dispatch — not
   *  the declared one (a declared-but-absent name lands in `missing`, never silently dropped). A
   *  `surfaceType:'none'` dispatch materializes nothing (DES-154), so its `skills`/`mcp` are empty
   *  and every declared name is `missing`. Absent for every pre-v24 record. */
  materialized?: { skills: string[]; mcp: string[]; missing: string[] };
}

export interface TranscriptEvent {
  ts: string;
  kind: 'message' | 'tool_call' | 'tool_result' | 'usage' | 'harness';
  data: unknown;
}
