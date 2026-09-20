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
import type { HomeView } from '../../src/dashboard.js';
import type { SystemInfoView } from '../../src/system-info.js';
import type { EnrichedModelEntry } from '../../src/models/model-catalog.js';
import type { IssuesListView, IssueSummary } from '../../src/github/issue-reporter.js';

// ---- run_agent_log / GET /api/runs/:id/agents/:agentId ----

// v34 (DES-225 rationale item 9, ARCH-137, ADR-061, TASK-229): `systemPrompt` is retired from
// `HarnessDescriptor` at the type level, but this fixture keeps the property deliberately — it IS
// the genuine pre-v34 shape the retirement's totality tests need as input (a writer this version
// of the engine can no longer produce, but a reader must still handle without crashing). Cast at
// the fixture boundary so `tsc` accepts a property the type no longer declares.
const HARNESS_APPLIED = {
  model: 'claude-3-5-sonnet-20241022',
  provider: 'anthropic',
  prompt: 'the user-visible prompt only — never the agentType systemPrompt',
  tools: ['Read'],
  skills: [],
  mcpServers: [],
  surfaceType: 'curated',
  systemPrompt: { agentType: 'researcher', bytes: 42 },
} as unknown as HarnessDescriptor;

const AGENT_RECORD: AgentRecord = {
  agentId: 'a1',
  state: 'done',
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
  costUSD: 0.01,
};

const EVENTS: TranscriptEvent[] = [{ ts: '2026-09-11T00:00:00.000Z', kind: 'message', data: {} }];

// v34 (DES-225 rationale item 9, ARCH-137, ADR-061, TASK-229, REQ-203): this row IS the genuine
// pre-v34 legacy harness shape the retirement's IT/UT need as input — ARCH-137's deletion table
// names these exact lines for removal, and DES-225 overrides that for this fixture specifically:
// deleting it and hand-building a legacy row in the test would be testing a straw man. Exported as
// an ALIAS (not a rename) so this file's existing `HARNESS_APPLIED` importers are untouched.
export const HARNESS_LEGACY_PRE_V34: HarnessDescriptor = HARNESS_APPLIED;

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

// ---- degraded outcome shared by every /api/* route (server.ts:611-617) ----
// [v27c AC-1 repair]: measured against the real server (a malformed %-encoded describe path
// throws inside handleDashboardRequest's try, caught by its own outer catch) — the shape is
// `buildDashboardModel([], undefined, undefined, message)`, which ALWAYS sets `runs` too
// (`dashboard.ts:87`, unconditional), not `degraded` alone. `DEGRADED_BODY` is kept as the
// documentation literal; the real-body check (dashboard-disclosure.test.ts) reads the served JSON.
export const DEGRADED_BODY = { runs: [], degraded: 'internal dashboard error' };
export const ALLOWED_DEGRADED_KEYS = ['runs', 'degraded'] as const;
export const REQUIRED_DEGRADED_KEYS = ['runs', 'degraded'] as const;

// ---- GET /api/home (v27 AC-1 repair: ARCH-126 widened this route with avgCostUSD/unpricedRuns
// nested under each card's `metrics`; the top-level shape stays the fixed 3-array envelope) ----

export const HOME_VIEW_EXAMPLE: HomeView = { running: [], registered: [], other: [] };
export const ALLOWED_HOME_KEYS = ['running', 'registered', 'other'] as const;
export const REQUIRED_HOME_KEYS = ['running', 'registered', 'other'] as const;

// ---- GET /api/system (v28, DES-218, TASK-219, REQ-138) ----
// [v28 Gate 5] two literals — the healthy shape and a per-SECTION degraded shape (`memory` timed
// out; `cpu`/`disk`/`process` stay real) — because DES-215's own split rule (the counts card's
// state is a ROUTE verdict, the other three cards' state is a SECTION reason) needs a fixture that
// can fail ONE section without failing the whole route.
export const SYSTEM_OK: SystemInfoView & { auth: unknown } = {
  cpu: { cores: 8, loadAvg: [1.2, 1.1, 0.9], utilizationPct: 42 },
  memory: { totalBytes: 17179869184, usedBytes: 8589934592, freeBytes: 8589934592, usedPct: 50 },
  disk: { path: '/', totalBytes: 500000000000, usedBytes: 250000000000, freeBytes: 250000000000, usedPct: 50 },
  process: {
    self: { pid: 99001, uptimeSec: 3600, rssBytes: 104857600, cpuPct: 1.2, threads: 8, fdCount: 32 },
    topN: [{ pid: 99001, name: 'node', cpuPct: 1.2, memBytes: 104857600 }],
    system: { total: 200, byState: { S: 190, R: 10 } },
  },
  sampledAt: '2026-09-17T00:00:00.000Z',
  windowMs: 3000,
  auth: undefined,
};
export const ALLOWED_SYSTEM_KEYS = ['cpu', 'memory', 'disk', 'process', 'sampledAt', 'windowMs', 'auth'] as const;
export const REQUIRED_SYSTEM_KEYS = ['cpu', 'memory', 'disk', 'process', 'sampledAt', 'windowMs'] as const;

// [v28 Gate 5] `cpu` degrades via a SIBLING key (`system-info.ts:133-138`), never a replaced
// union — REACHABLE FOR REAL on the very FIRST sample after boot (`prev === null` ⇒
// `awaiting-second-sample`, no fault injection needed), which is exactly the IT-172 real producer.
export const SYSTEM_SECTION_DEGRADED: SystemInfoView & { auth: unknown } = {
  ...SYSTEM_OK,
  cpu: { ...SYSTEM_OK.cpu, utilizationPct: null, utilizationDegraded: { reason: 'awaiting-second-sample' } },
};

// ---- GET /api/models[i] (v28, DES-218, TASK-219, REQ-137) ----
export const MODEL_ENTRY_OK: EnrichedModelEntry = {
  provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', aliases: ['sonnet'],
  description: 'a capable general-purpose model', modalities: { in: ['text'], out: ['text'] },
  contextWindow: 200000, price: { in: '3', out: '15' }, toolUseDeclared: true,
  location: 'remote', ref: 'sonnet', ratesPerM: { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  effortDeclared: true, declaredSource: 'static', capability: 'general-purpose reasoning and tool use',
  stability: 'stable', costLevel: 8, catalogFetchedAt: '2026-09-17T00:00:00.000Z',
};
export const ALLOWED_MODEL_ENTRY_KEYS = [
  'provider', 'model', 'aliases', 'description', 'modalities', 'contextWindow', 'price',
  'toolUseDeclared', 'location', 'ref', 'besteffort', 'ratesPerM', 'effortDeclared', 'declaredSource',
  'capability', 'stability', 'costLevel', 'catalogFetchedAt',
] as const;
export const REQUIRED_MODEL_ENTRY_KEYS = [
  'provider', 'model', 'description', 'modalities', 'contextWindow', 'price', 'toolUseDeclared',
  'location', 'capability', 'stability', 'costLevel', 'catalogFetchedAt',
] as const;

// ---- GET /api/issues (v28, DES-218, TASK-219, REQ-139) ----
const ISSUE_SUMMARY_OPEN: IssueSummary = { number: 1, title: 'example open issue', state: 'open', labels: ['agent-reported'], url: 'https://github.com/example/repo/issues/1' };
const ISSUE_SUMMARY_RESOLVED: IssueSummary = { number: 2, title: 'example resolved issue', state: 'closed', labels: ['agent-reported'], url: 'https://github.com/example/repo/issues/2' };
export const ISSUES_OK: IssuesListView = { open: [ISSUE_SUMMARY_OPEN], resolved: [ISSUE_SUMMARY_RESOLVED] };
export const ALLOWED_ISSUES_KEYS = ['open', 'resolved', 'degraded'] as const;
export const REQUIRED_ISSUES_KEYS = ['open', 'resolved'] as const;

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
  // v27c AC-1 repair: the two endpoints this delta widened with no prior row (ADR-054, INV-V27-7).
  { route: 'GET /api/home', outcome: 'ok', body: HOME_VIEW_EXAMPLE as unknown as Record<string, unknown>, allowed: ALLOWED_HOME_KEYS, required: REQUIRED_HOME_KEYS },
  { route: 'GET /api/runs/:id/agents/:agentId (http, ok)', outcome: 'ok', body: AGENT_LOG_OK as unknown as Record<string, unknown>, allowed: ALLOWED_AGENT_LOG_OK_KEYS, required: REQUIRED_AGENT_LOG_OK_KEYS },
  // v28 (DES-218, TASK-219, INV-V27-7 pattern extended, REQ-137/138/139): the four disclosure rows
  // this iteration owes.
  { route: 'GET /api/system (ok)', outcome: 'ok', body: SYSTEM_OK as unknown as Record<string, unknown>, allowed: ALLOWED_SYSTEM_KEYS, required: REQUIRED_SYSTEM_KEYS },
  { route: 'GET /api/system (per-section degraded)', outcome: 'ok', body: SYSTEM_SECTION_DEGRADED as unknown as Record<string, unknown>, allowed: ALLOWED_SYSTEM_KEYS, required: REQUIRED_SYSTEM_KEYS },
  { route: 'GET /api/models[i] (ok)', outcome: 'ok', body: MODEL_ENTRY_OK as unknown as Record<string, unknown>, allowed: ALLOWED_MODEL_ENTRY_KEYS, required: REQUIRED_MODEL_ENTRY_KEYS },
  { route: 'GET /api/issues (ok)', outcome: 'ok', body: ISSUES_OK as unknown as Record<string, unknown>, allowed: ALLOWED_ISSUES_KEYS, required: REQUIRED_ISSUES_KEYS },
];
