// Shared domain types — no implementation, pure TypeScript interfaces.

export type RunStatus = 'queued' | 'running' | 'suspended' | 'stopped' | 'completed' | 'failed';

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
}

export interface ResultEnvelope<T = unknown> {
  runId: string;
  status: RunStatus;
  result?: T;
  error?: ErrEnvelope;
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
  isolation?: 'worktree';
  agentType?: string;
  /** REQ-017 (D-V3M-1): names of server-side-provisioned MCP servers this agent references
   *  (`agent(prompt, {mcp:['name']})`). Resolved by the SDK gateway against the MCP Provisioning
   *  Registry at session-build time (McpRegistry.resolveInjected) — ONLY these explicitly-named
   *  entries are injected (strictMcpConfig preserved); an unprovisioned name is already rejected at
   *  submission (SubmissionValidator). Survives the sandbox boundary as an opaque opts field. */
  mcp?: string[];
}

export interface AgentRecord {
  agentId: string;
  label?: string;
  phase?: string;
  state: 'queued' | 'running' | 'done' | 'failed';
  provider: string;
  model: string;
  tokens: { input: number; output: number };
}

export interface PhaseView {
  title: string;
}

export interface RunStatusView {
  runId: string;
  status: RunStatus;
  phases: PhaseView[];
  agents: AgentRecord[];
  scriptVersion: string;
}

export interface RunSummary {
  runId: string;
  name?: string;
  status: RunStatus;
  scriptVersion: string;
  createdAt: string;
}

export interface RunSpec {
  name?: string;
  script?: string;
  args?: unknown;
  budget?: number | null;
  /** REQ-025 (v2): optional seed tree materialized into the run workspace BEFORE agents start, so
   *  the run's agents edit a real project in place. `.claude` settings/hooks are stripped and
   *  escapes rejected by workspace-seed.materializeSeed. */
  seed?: { path: string; contentB64: string }[];
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

export interface TranscriptEvent {
  ts: string;
  kind: 'message' | 'tool_call' | 'tool_result' | 'usage';
  data: unknown;
}
