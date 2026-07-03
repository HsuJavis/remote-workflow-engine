// Shared domain types — no implementation, pure TypeScript interfaces.

export type RunStatus = 'queued' | 'running' | 'suspended' | 'stopped' | 'completed' | 'failed';

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
