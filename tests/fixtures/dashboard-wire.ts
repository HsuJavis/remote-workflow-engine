// v27 (DES-192, ARCH-131/127/129, ADR-054, TASK-197): the ONE fixture module for every dashboard
// wire shape v27 touches — precedent `tests/fixtures/v26-public-shapes.ts`. Every literal below
// `satisfies` its REAL route type (not a local structural copy — `AgentLogView` is a genuinely new
// export this fixture is written AGAINST, so importing it before it exists is deliberate: `tsc
// --noEmit` on THIS file is DES-192's own "first test", red until TASK-197 adds the type). Hand
// written literals only — never produced by running the code under test and pasting its output
// (per-tier mock policy v27).
//
// `.ts` on purpose (ADR-049): a `.test.ts` importing `src/dashboard/lib/*.js` would fail `tsc` with
// TS7016 absent `allowJs`, which ADR-049 refuses — so the `.js` client tests read literals off this
// file at RUNTIME (vitest/esbuild, no type-check) while `tsc --noEmit` locks the SERVER-side shapes
// this file itself claims to satisfy.
//
// [v27b amendment, Round v27b owner ruling, ADR-051, TASK-197]: `DAG_PAYLOAD_OPEN` renamed to
// `DAG_PAYLOAD` and its disclosure-row label loses the `(open)` qualifier — that qualifier encoded a
// second, MASKED shape ADR-051 retired; leaving it would "faithfully record a degradation that must
// no longer exist" (ADR-051's own words). `warnings: []` stays (this is the DISCLOSURE_TABLE's `ok`
// row; a healthy DAG carries no warning). New export `DAG_WARNING_EXAMPLES` below — no key-set
// change.
import type { AgentLogView, RunSummary, HarnessDescriptor, AgentRecord, TranscriptEvent } from '../../src/types.js';

// ---- run_agent_log / GET /api/runs/:id/agents/:agentId ----

const HARNESS_APPLIED: HarnessDescriptor = {
  model: 'claude-3-5-sonnet-20241022',
  provider: 'anthropic',
  prompt: 'the user-visible prompt only — never the agentType systemPrompt',
  tools: ['Read'],
  skills: [],
  mcpServers: [],
  surfaceType: 'curated',
  // v27 (DES-195, ARCH-129): present iff a non-empty agentType systemPrompt was applied.
  systemPrompt: { agentType: 'researcher', bytes: 42 },
};

const AGENT_RECORD: AgentRecord = {
  agentId: 'a1',
  state: 'done',
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
  costUSD: 0.01,
};

const EVENTS: TranscriptEvent[] = [{ ts: '2026-09-11T00:00:00.000Z', kind: 'message', data: {} }];

export const AGENT_LOG_OK: AgentLogView = {
  runId: 'r1', status: 'completed', result: EVENTS,
  harness: HARNESS_APPLIED, events: EVENTS, hasMore: false,
  record: AGENT_RECORD,
};
export const ALLOWED_AGENT_LOG_OK_KEYS = ['runId', 'status', 'result', 'error', 'principal', 'meta', 'harness', 'events', 'hasMore', 'record'] as const;
export const REQUIRED_AGENT_LOG_OK_KEYS = ['runId', 'status', 'harness', 'events', 'hasMore', 'record'] as const;

export const AGENT_LOG_FACADE_ERROR: AgentLogView = {
  runId: 'r1', status: 'failed',
  error: { code: 'AGENT_LOG_NOT_FOUND', message: 'Agent not found: x' },
  harness: null, events: [], hasMore: false,
  // no `record` — the error branch never resolved an agent.
};
export const ALLOWED_AGENT_LOG_ERROR_KEYS = ['runId', 'status', 'error', 'harness', 'events', 'hasMore'] as const;
export const REQUIRED_AGENT_LOG_ERROR_KEYS = ['runId', 'status', 'error', 'harness', 'events', 'hasMore'] as const;

// ---- GET /api/runs (RunSummary[]) ----

export const RUN_SUMMARY_PRICED: RunSummary = {
  runId: 'r2', status: 'completed', scriptVersion: 'v1', createdAt: '2026-09-11T00:00:00.000Z',
  terminalAt: '2026-09-11T00:05:00.000Z',
  costUSD: 0.42, unpricedCalls: 0, tokensTotal: 1000, agentCount: 3,
};
export const RUN_SUMMARY_NO_RECORDS: RunSummary = {
  // v27 (ADR-052, DES-194): a run with zero agent() calls omits all four fields together — never 0.
  runId: 'r3', status: 'completed', scriptVersion: 'v1', createdAt: '2026-09-11T00:00:00.000Z',
};
export const ALLOWED_RUN_SUMMARY_KEYS = ['runId', 'name', 'status', 'scriptVersion', 'createdAt', 'startedBy', 'terminalAt', 'costUSD', 'unpricedCalls', 'tokensTotal', 'agentCount'] as const;
export const REQUIRED_RUN_SUMMARY_KEYS = ['runId', 'status', 'scriptVersion', 'createdAt'] as const;

// ---- GET /api/runs/:id/dag ----

export interface DagPayloadFixture {
  kind: string;
  cells: unknown[];
  edges: unknown[];
  warnings: unknown[];
  startedBy: unknown;
  lanes: Array<{ index: number; title: string | null }>;
  current: number | null;
  truncated?: boolean;
  terminalAt?: string;
}
export const DAG_PAYLOAD: DagPayloadFixture = {
  kind: 'run', cells: [], edges: [], warnings: [], startedBy: { type: 'unknown' },
  lanes: [{ index: 0, title: 'ONE' }, { index: 1, title: null }], current: 0,
};
export const ALLOWED_DAG_KEYS = ['kind', 'cells', 'edges', 'warnings', 'startedBy', 'lanes', 'current', 'truncated', 'terminalAt'] as const;
export const REQUIRED_DAG_KEYS = ['kind', 'cells', 'edges', 'warnings', 'startedBy', 'lanes', 'current'] as const;

// v27b (Round v27b owner ruling, ADR-051, TASK-197 amendment): the ONE literal the route's own
// integration oracle (IT-169) and the client's unit oracle (UT-244's `warningText`) both read —
// spelling the token in three files independently is how a rename ships an English enum into the
// zh-TW legend with CI green. `prose` is `dashboard.ts:432`'s own format VERBATIM and deliberately
// contains `': '` too (the client splits on the FIRST one and must pass an unknown head through RAW).
export const DAG_WARNING_EXAMPLES = {
  fallback: 'PREDICTED_FROM_FALLBACK_VERSION: pinned=v2 resolved=v1',
  unavailable: 'PREDICTED_OVERLAY_UNAVAILABLE: reason=catalog-resolve-failed',
  prose: 'lane 1 is beyond the predicted layout: appended',
} as const;

// ---- degraded outcome shared by every /api/* route (server.ts:582-585, :1067-1071) ----

export const DEGRADED_BODY = { degraded: 'internal dashboard error' };
export const ALLOWED_DEGRADED_KEYS = ['degraded'] as const;
export const REQUIRED_DEGRADED_KEYS = ['degraded'] as const;

// ---- (endpoint x outcome) table DES-192/ADR-054 requires ----

export interface DisclosureRow {
  route: string;
  outcome: 'ok' | 'facade-error' | 'http-error' | 'degraded';
  body: Record<string, unknown>;
  allowed: readonly string[];
  required: readonly string[];
}

export const DISCLOSURE_TABLE: DisclosureRow[] = [
  { route: 'run_agent_log (ok)', outcome: 'ok', body: AGENT_LOG_OK as unknown as Record<string, unknown>, allowed: ALLOWED_AGENT_LOG_OK_KEYS, required: REQUIRED_AGENT_LOG_OK_KEYS },
  { route: 'run_agent_log (facade-error)', outcome: 'facade-error', body: AGENT_LOG_FACADE_ERROR as unknown as Record<string, unknown>, allowed: ALLOWED_AGENT_LOG_ERROR_KEYS, required: REQUIRED_AGENT_LOG_ERROR_KEYS },
  { route: 'GET /api/runs[i] (ok, priced)', outcome: 'ok', body: RUN_SUMMARY_PRICED as unknown as Record<string, unknown>, allowed: ALLOWED_RUN_SUMMARY_KEYS, required: REQUIRED_RUN_SUMMARY_KEYS },
  { route: 'GET /api/runs[i] (ok, no records)', outcome: 'ok', body: RUN_SUMMARY_NO_RECORDS as unknown as Record<string, unknown>, allowed: ALLOWED_RUN_SUMMARY_KEYS, required: REQUIRED_RUN_SUMMARY_KEYS },
  { route: 'GET /api/runs/:id/dag', outcome: 'ok', body: DAG_PAYLOAD as unknown as Record<string, unknown>, allowed: ALLOWED_DAG_KEYS, required: REQUIRED_DAG_KEYS },
  { route: 'any /api/* (degraded)', outcome: 'degraded', body: DEGRADED_BODY, allowed: ALLOWED_DEGRADED_KEYS, required: REQUIRED_DEGRADED_KEYS },
];
