// Dashboard pure render model (DES-018 / ARCH-011 / TASK-020).
// buildDashboardModel is a PURE function: no store/network access, no parallel dashboard DTO —
// it shapes exactly the existing RunSummary[]/RunStatusView/TranscriptEvent[] shapes (DES-010).
// HTTP transport + live-tail polling (TASK-025) reads this VM; not built here (distinct test seam,
// D-V2f task split).
import type { RunSummary, RunStatusView, TranscriptEvent, AgentRecord, PhaseView, RunStatus } from './types.js';
import type { ExpectedLane, ExpectedSlot, ExpectedGraph } from './skeleton-graph.js';
import { deriveExpectedGraph } from './skeleton-graph.js';
import { parseWorkflowSkeleton, scanAgentCalls } from './workflow-meta.js';
import { sumTokens } from './run-guard.js';

export interface DashboardVM {
  runs: RunSummary[];
  selected?: RunStatusView;
  transcript?: TranscriptEvent[];
  degraded?: string;
}

// ── v8 Slice 3 (REQ-048): call-tree reconstruction for the dashboard DAG ──
export interface DagAgentNode {
  agentId: string;
  label?: string;
  state: AgentRecord['state'];
  model: string;
  // v26 (DES-180, ARCH-118, TASK-180): stays `number` — the four-column SUM (`sumTokens`), never
  // the `Tokens` object itself. Widening this field to the object would compile here but silently
  // break the client's `(a.tokens||0)+' tok'` render into `[object Object] tok` (see DES-180's own
  // boundary note); the client renders the breakdown via costUSD/unpriced below instead.
  // [v31, REQ-186, R30-A1] OPTIONAL: absent while the call is still in flight. The client's
  // `fmtTok` gained an absent branch in the same commit and renders `—`; before that it had none
  // at all and `String(undefined)` would have printed the literal word.
  tokens?: number;
  /** v26 (DES-180, DES-188): USD cost of this call (absent on a pre-v26 record — never re-priced). */
  costUSD?: number;
  /** v26 (DES-180, DES-188): true iff costUSD could not be priced — see AgentRecord's own doc. */
  unpriced?: boolean;
  // v8 Slice 2b (REQ-051): per-agent timing; durationMs is undefined while unfinished.
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
}
export interface DagNode {
  kind: 'root' | 'workflow';
  frame: string;      // "" for the root (top-level script)
  name?: string;      // composite workflow name (kind:'workflow')
  depth: number;      // 0 for root
  agents: DagAgentNode[];
  children: DagNode[];
}

/**
 * PURE reconstruction of a run's call tree from its RunStatusView (Slice-2 frame-tagged agents +
 * workflowNodes). Groups agents by `frame`, nests composite frames by `parentFrame`. Never throws,
 * never mutates inputs, never drops an agent (an agent whose frame has no matching node falls back
 * to the root). Shared by the /api/runs/:id/dag endpoint and the dashboard page — one tested model.
 */
export function buildDagModel(view: RunStatusView): DagNode {
  const root: DagNode = { kind: 'root', frame: '', depth: 0, agents: [], children: [] };
  const byFrame = new Map<string, DagNode>([['', root]]);
  // depth-ascending so a parent frame always exists before its children are attached.
  const nodes = [...(view.workflowNodes ?? [])].sort((a, b) => a.depth - b.depth);
  for (const wn of nodes) {
    const node: DagNode = { kind: 'workflow', frame: wn.frame, name: wn.name, depth: wn.depth, agents: [], children: [] };
    byFrame.set(wn.frame, node);
    (byFrame.get(wn.parentFrame) ?? root).children.push(node);
  }
  for (const a of view.agents ?? []) {
    const target = byFrame.get(a.frame ?? '') ?? root;
    const durationMs = a.startedAt && a.endedAt ? Math.max(0, Date.parse(a.endedAt) - Date.parse(a.startedAt)) : undefined;
    // v26 (DES-180): the four-column sum, not the pre-v26 two-column `input+output` (which silently
    // dropped >97% of a cache-heavy call's real usage).
    // [v31, REQ-186] `tokens` is absent on a not-yet-measured call; it contributes nothing to the
    // sum, and the per-agent figure stays absent rather than becoming a zero here.
    const tokens = a.tokens
      ? sumTokens({ input: a.tokens.input, output: a.tokens.output, cacheRead: a.tokens.cacheRead ?? 0, cacheWrite: a.tokens.cacheWrite ?? 0 })
      : undefined;
    target.agents.push({ agentId: a.agentId, label: a.label, state: a.state, model: a.model, tokens, costUSD: a.costUSD, unpriced: a.unpriced, startedAt: a.startedAt, endedAt: a.endedAt, durationMs });
  }
  return root;
}

/**
 * Pure view-model builder — never throws, never mutates its inputs. A store read error is
 * signalled via the optional `degradedReason` (rendered as `vm.degraded`, a partial/last-known
 * VM), never surfaced as a thrown exception (DES-018: "never a 500 that takes the page down").
 */
export function buildDashboardModel(
  runs: RunSummary[],
  view?: RunStatusView,
  tr?: TranscriptEvent[],
  degradedReason?: string,
): DashboardVM {
  const vm: DashboardVM = { runs: [...runs] };
  if (view !== undefined) vm.selected = view;
  if (tr !== undefined) vm.transcript = [...tr];
  if (degradedReason !== undefined) vm.degraded = degradedReason;
  return vm;
}

// ── v11 F1 (TASK-072 / DES-070, TASK-073 / DES-071): home cards + reliability metrics ──

export interface WorkflowMetrics {
  successRate: number | null;
  avgDurationMs: number | null;
  terminalCount: number;
  /** v27b (DES-196, ADR-055, TASK-201, REQ-141): mean `costUSD` over TERMINAL runs that carry it —
   *  `null` (never `0`) when none does. `unpricedRuns` counts the rest of the terminal group. */
  avgCostUSD: number | null;
  unpricedRuns: number;
}

export interface WorkflowCard {
  name: string;
  description: string;
  group: 'running' | 'registered' | 'other';
  metrics: WorkflowMetrics;
  activeRunId?: string;
  latestRunId?: string;
  /** v27 README-fidelity closure: the LAST RUN kicker (README: `LAST RUN · 9/11 14:02`) names a
   *  TIMESTAMP, not the id `latestRunId` already carries — the run's own `terminalAt` (else
   *  `createdAt` for the rare non-terminal edge the ACTIVE branch didn't already claim). Set
   *  alongside `latestRunId`, from the SAME run, so the two never drift. */
  latestRunAt?: string;
}

export interface HomeView {
  running: WorkflowCard[];
  registered: WorkflowCard[];
  other: WorkflowCard[];
}

const ZERO_METRICS: WorkflowMetrics = { successRate: null, avgDurationMs: null, terminalCount: 0, avgCostUSD: null, unpricedRuns: 0 };
const TERMINAL_STATUSES = new Set<string>(['completed', 'failed', 'stopped']);
const ACTIVE_STATUSES = new Set<string>(['running', 'queued', 'suspended', 'interrupted']);

/**
 * PURE: groups RunSummary[] by run.name and folds each group into a WorkflowMetrics.
 * terminalCount = runs with status ∈ {completed,failed,stopped}.
 * successRate = completedCount / terminalCount; null if terminalCount === 0.
 * avgDurationMs = mean(Date.parse(terminalAt) − Date.parse(createdAt)) over terminal runs
 *   with a parseable terminalAt; null if none are parseable.
 * avgCostUSD = mean(costUSD) over terminal runs that CARRY a costUSD; null (never 0) if none does
 *   (DES-196, REQ-141). unpricedRuns = terminal runs that do not carry a costUSD.
 * Never throws, never emits NaN.
 */
export function computeWorkflowMetrics(runs: RunSummary[]): Map<string | undefined, WorkflowMetrics> {
  const groups = new Map<string | undefined, RunSummary[]>();
  for (const r of runs) {
    const key = r.name;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  const out = new Map<string | undefined, WorkflowMetrics>();
  for (const [key, group] of groups) {
    const terminal = group.filter((r) => TERMINAL_STATUSES.has(r.status));
    const terminalCount = terminal.length;
    if (terminalCount === 0) {
      out.set(key, { ...ZERO_METRICS });
      continue;
    }
    const completedCount = terminal.filter((r) => r.status === 'completed').length;
    const successRate = completedCount / terminalCount;
    const durations: number[] = [];
    for (const r of terminal) {
      if (!r.terminalAt) continue;
      const end = Date.parse(r.terminalAt);
      const start = Date.parse(r.createdAt);
      if (Number.isFinite(end) && Number.isFinite(start)) {
        durations.push(Math.max(0, end - start));
      }
    }
    const avgDurationMs = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null;
    const priced = terminal.filter((r) => r.costUSD !== undefined);
    const avgCostUSD = priced.length > 0
      ? priced.reduce((a, r) => a + r.costUSD!, 0) / priced.length
      : null;
    const unpricedRuns = terminalCount - priced.length;
    out.set(key, { successRate, avgDurationMs, terminalCount, avgCostUSD, unpricedRuns });
  }
  return out;
}

/**
 * PURE: builds a HomeView from a catalog snapshot, a run list, and a pre-computed metrics map.
 * RUNNING = catalog workflow with ≥1 active (non-terminal) run.
 * REGISTERED = catalog workflow with no active run.
 * OTHER = run name absent from catalog (inline or deregistered).
 * A workflow appears in exactly ONE group (RUNNING wins). Never throws.
 *
 * v36 (REQ-217 follow-up, DES-251, TASK-249): `activeRuns` is `RunStore.activeRuns()`'s own
 * "currently non-terminal" query — unbounded, and NOT bounded by concurrency alone (Gate 8
 * send-back, ARCH-174/ADR-081): its result set is active ∪ never-resumed — it grows with restarts
 * × concurrency, not with total history; scan cost is bounded separately, by the `runs_status`
 * index. It is the ONLY source RUNNING/`activeRunId` resolve from. `runs` (the paginated `list()`
 * page) no longer decides RUNNING at all: a suspended/interrupted run older than the page used to silently
 * move its workflow to REGISTERED and drop `activeRunId`, the exact regression this closes.
 * `latestRunId`/`latestRunAt` stay sourced from `runs` alone — DES-250's already-accepted, page-
 * scoped narrowing for those two fields is unchanged by this fix (a card can legitimately carry an
 * `activeRunId` with no `latestRunId` when its only run fell outside the page).
 */
export function buildHomeView(
  catalog: Array<{ name: string; description: string }>,
  runs: RunSummary[],
  metrics: Map<string | undefined, WorkflowMetrics>,
  activeRuns: RunSummary[],
): HomeView {
  const catalogMap = new Map(catalog.map((c) => [c.name, c.description]));
  // Gather active and latest run per named workflow.
  // v36 (REQ-217): compares `createdAt` directly rather than trusting "list order" — `runs` used to
  // be `listRuns()`'s unordered (effectively insertion-order) sweep, but `listSummaries()` now
  // builds on `list()`, which is `ORDER BY createdAt DESC`. A position-based "first/last wins" tie-
  // break would have silently flipped to picking the OLDEST run in the page; comparing the actual
  // timestamp is correct under ANY input order (and needs no contract with the caller about one).
  const activeRunId = new Map<string, string>();
  const activeRunAt = new Map<string, string>();
  const latestRunId = new Map<string, string>();
  const latestRunAt = new Map<string, string>();
  const latestRunCreatedAt = new Map<string, string>(); // the recency KEY; latestRunAt is the DISPLAYED value
  // v36 (REQ-217 follow-up): activeRunId/RUNNING resolve from `activeRuns`, never from the
  // paginated `runs` page (see the function doc comment above).
  for (const r of activeRuns) {
    const name = r.name;
    if (name === undefined || !ACTIVE_STATUSES.has(r.status)) continue;
    if (!activeRunAt.has(name) || r.createdAt > activeRunAt.get(name)!) {
      activeRunId.set(name, r.runId);
      activeRunAt.set(name, r.createdAt);
    }
  }
  for (const r of runs) {
    const name = r.name;
    if (name === undefined) continue;
    if (!latestRunCreatedAt.has(name) || r.createdAt > latestRunCreatedAt.get(name)!) {
      latestRunCreatedAt.set(name, r.createdAt);
      latestRunId.set(name, r.runId);
      latestRunAt.set(name, r.terminalAt ?? r.createdAt);
    }
  }
  const running: WorkflowCard[] = [];
  const registered: WorkflowCard[] = [];
  // Catalog workflows
  for (const { name, description } of catalog) {
    const isActive = activeRunId.has(name);
    const card: WorkflowCard = {
      name,
      description,
      group: isActive ? 'running' : 'registered',
      metrics: metrics.get(name) ?? { ...ZERO_METRICS },
      ...(isActive ? { activeRunId: activeRunId.get(name) } : {}),
      ...(latestRunId.has(name) ? { latestRunId: latestRunId.get(name), latestRunAt: latestRunAt.get(name) } : {}),
    };
    if (isActive) running.push(card);
    else registered.push(card);
  }
  // OTHER: runs whose name is absent from catalog (grouped by name or '(inline)')
  const otherSeen = new Set<string>();
  const other: WorkflowCard[] = [];
  for (const r of runs) {
    const name = r.name;
    if (name !== undefined && catalogMap.has(name)) continue; // belongs to catalog
    const key = name ?? '(inline)';
    if (otherSeen.has(key)) continue;
    otherSeen.add(key);
    other.push({
      name: key,
      description: '',
      group: 'other',
      metrics: metrics.get(name) ?? { ...ZERO_METRICS },
      ...(latestRunId.has(key) ? { latestRunId: latestRunId.get(key), latestRunAt: latestRunAt.get(key) } : {}),
    });
  }
  return { running, registered, other };
}

// ── v11 Sprint 3 (TASK-067 / DES-064): pure graph layout ──
// v26 (DES-176, ARCH-114/113, TASK-187): `layoutGraph` now joins live agents to their skeleton
// LANE by ORDINAL (`record.phaseIndex ?? inferPhase(record, phases)?.index`), never by re-matching
// the phase TITLE string — duplicate phase titles and dynamic (runtime-only) titles were the blind
// spot the old `a.phase ?? ''` string join could never resolve (100% of runs were frame-grouped).
// `ExpectedGraph` replaces the flat `SkeletonNode[]` skeleton as the predicted-layout input.

/** ARCH-113's `ExpectedGraph`, re-exported from its canonical home `src/skeleton-graph.ts`
 *  (TASK-185, which HAS now landed — this used to be a local structural copy carrying the note
 *  "replace with a real import once skeleton-graph.ts ships"). Type-only, so nothing changes at
 *  runtime, and existing importers of these names from `./dashboard.js` keep working. ARCH-113's
 *  load-bearing property is "one derivation, two consumers"; a second declaration of the shape the
 *  two consumers join on is the same drift risk one layer down. (`check-mermaid.ts` keeps its own
 *  local copy on purpose — see its comment: UT-115/ADR-022's `skeleton` allowlist does not include
 *  that file, and even a type import would put the word in its source text.) */
export type { ExpectedLane, ExpectedSlot, ExpectedGraph };

const LIVE_LANE_STATUSES = new Set<RunStatus>(['running', 'suspended', 'interrupted']);

/** v27b (DES-196, ARCH-126, ADR-051, TASK-201): `{lanes, current}` for the dashboard swimlane —
 *  pure, no I/O. `lanes` = the observed `phases` (regardless of auth) extended UNCONDITIONALLY by
 *  the `expected` overlay's UNREACHED tail (any expected lane at or beyond `phases.length`),
 *  re-indexed dense so `lanes[k].index === k` even over a non-contiguous `expected.lanes`. `current`
 *  is the last observed phase index for the three LIVE statuses (`running`/`suspended`/
 *  `interrupted`) and `null` otherwise (or when `phases` is empty) — never clamped to
 *  `expected.lanes.length - 1` (a loop-body `phase()` can legally observe more phases than the
 *  predicted graph has lanes). Body stays garbage-tolerant (`Array.isArray(expected?.lanes)`,
 *  matching `layoutGraph` at :346) even though `expected` is typed non-optional (ADR-051). */
export function deriveLanes(
  phases: PhaseView[],
  expected: ExpectedGraph,
  opts: { status: RunStatus },
): { lanes: Array<{ index: number; title: string | null }>; current: number | null } {
  const safePhases = Array.isArray(phases) ? phases : [];
  const observed = safePhases.map((p, i) => ({ index: i, title: p.title }));
  const expectedLanes = Array.isArray(expected?.lanes) ? expected.lanes : [];
  const unreached = expectedLanes
    .filter((l) => l.index >= safePhases.length)
    .sort((a, b) => a.index - b.index)
    .map((l, i) => ({ index: safePhases.length + i, title: l.title }));
  const lanes = [...observed, ...unreached];
  const current = safePhases.length > 0 && LIVE_LANE_STATUSES.has(opts.status) ? safePhases.length - 1 : null;
  return { lanes, current };
}

/** v27b (DES-196, ADR-055, TASK-201): per-lane predicted agent labels for a workflow's registered
 *  script — the THIRD consumer of `deriveExpectedGraph` (INV-V26-3/INV-V27-4: registration checker,
 *  run-DAG layout, and this), never a fourth derivation. Lives here (not the facade) because
 *  `dashboard.ts` is on the `no-skeleton-surface` allowlist (C3/ADR-048) and `mcp-facade.ts` is not.
 *  Empty array when the script fails to derive (`derived.ok === false`) — indistinguishable here
 *  from a legitimately empty graph; DES-197's facade contract is to emit no `agents` key on the
 *  phase in either case, never `[]` standing in for "unavailable" (that signal is the DAG route's
 *  own `PREDICTED_OVERLAY_UNAVAILABLE` warning, DES-198, a different call site). */
export function predictedLanes(script: string): Array<{ index: number; title: string | null; agents: string[] }> & { unscannable?: true } {
  const nodes = parseWorkflowSkeleton(script);
  const scan = scanAgentCalls(script);
  const derived = deriveExpectedGraph(nodes, scan);
  if (!derived.ok) {
    // v35 (item 5, Gate 8 return): additive, backward-compatible — an array with an extra property
    // is still a plain array to every existing `.map`/`.find` consumer (mcp-facade.ts:519).
    const empty: Array<{ index: number; title: string | null; agents: string[] }> & { unscannable?: true } = [];
    if (scan.unscannable) empty.unscannable = true;
    return empty;
  }
  const bySlotLane = new Map<number, string[]>();
  for (const slot of derived.graph.slots) {
    bySlotLane.set(slot.lane, [...(bySlotLane.get(slot.lane) ?? []), ...slot.labels]);
  }
  const result: Array<{ index: number; title: string | null; agents: string[] }> & { unscannable?: true } =
    derived.graph.lanes.map((lane) => ({ index: lane.index, title: lane.title, agents: bySlotLane.get(lane.index) ?? [] }));
  if (scan.unscannable) result.unscannable = true;
  return result;
}

/** Logical grid cell — NO pixel coords (no x/y/width/height). Stable id across re-layout calls. */
export interface LayoutCell {
  id: string;
  kind: 'trigger' | 'agent' | 'phase';
  col: number;
  row: number;
  laneSpan: number;
  label?: string;
  state?: string;
  agentId?: string;
  frame?: string;
  depth?: number;
  /** v26 (M-4 send-back repair, ARCH-118, REQ-127): per-call cost attribution on the DAG cell
   *  itself — `run_status.agents[]` already carries these three; the cell payload didn't. Optional,
   *  additive: present only on a LIVE agent cell (never on a predicted/inert `__skel_*` one, which
   *  has no dispatched call to report a cost for). Mirrors `AgentRecord`'s own fields verbatim. */
  tokens?: AgentRecord['tokens'];
  costUSD?: number;
  unpriced?: boolean;
  /** v27 README-fidelity closure: node cell row 3 ("52k tok · $0.31 · 2m 10s") named a duration
   *  the cell payload never carried — `AgentRecord.startedAt`/`endedAt` reach `buildDagModel`'s
   *  `DagAgentNode` but never `layoutGraph`'s `LayoutCell`. Same derivation as that sibling model
   *  (`dashboard.ts`'s own `buildDagModel`): present only once both timestamps exist, i.e. a
   *  finished call — never a guess at an in-flight duration. */
  durationMs?: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface LayoutGraphOpts {
  startedByType?: string;
  maxNodes?: number;
}

/** v26 (DES-186, ARCH-120, ADR-044, TASK-191, REQ-129): the ONE cell-box constant — `dashboard-page.ts`
 *  interpolates this literal (`${JSON.stringify(DAG_BOX_DEFAULTS)}`, the same `MORANDI_PALETTE`
 *  pattern) into its client-side `renderGraph` rather than re-declaring the numbers, so the two
 *  cannot drift even though the CLIENT still recomputes `svgW`/`svgH` itself (live `cells` data is
 *  only known in the browser; `dagBox` below is what makes the FORMULA unit-testable server-side). */
export const DAG_BOX_DEFAULTS = { cellW: 140, cellH: 44, gap: 14 };

/** v26 (DES-186, ARCH-120, ADR-044, TASK-191, REQ-129): the box math the client interpolates into
 *  the run DAG's `viewBox` — extracted verbatim from `dashboard-page.ts`'s own inline client JS
 *  (`renderGraph`'s `svgW`/`svgH` computation). Never `0×0` for empty cells (a `viewBox="0 0 0 0"`
 *  SVG vanishes) — the `+1`/`maxSpan` floor of 1 already guarantees a minimum box even with no
 *  cells (the client itself never calls this path empty; see `renderGraph`'s own early return). */
export function dagBox(
  cells: LayoutCell[],
  box: { cellW: number; cellH: number; gap: number } = DAG_BOX_DEFAULTS,
): { width: number; height: number } {
  const safeCells = Array.isArray(cells) ? cells : [];
  let maxCol = 0;
  let maxRow = 0;
  let maxSpan = 1;
  for (const c of safeCells) {
    if (c.col > maxCol) maxCol = c.col;
    if (c.row > maxRow) maxRow = c.row;
    if (c.laneSpan > maxSpan) maxSpan = c.laneSpan;
  }
  return {
    width: (maxCol + 1) * (box.cellW + box.gap) + box.gap,
    height: (maxRow + maxSpan) * (box.cellH + box.gap) + box.gap,
  };
}

/** v26 (DES-176, TASK-187): the last `phases[i]` with `ts <= (record.startedAt ?? record.endedAt)`
 *  — pure, INCLUSIVE at an exact tie, `undefined` when the record precedes every phase (or
 *  `phases` is empty/absent). `layoutGraph` calls this only when `record.phaseIndex` is absent (a
 *  pre-v26 record, or one dispatched before the IPC-receipt phase stamp, DES-175/TASK-186). */
export function inferPhase(record: AgentRecord, phases: PhaseView[]): { title: string; index: number } | undefined {
  const at = record.startedAt ?? record.endedAt;
  if (at === undefined || !Array.isArray(phases) || phases.length === 0) return undefined;
  const atMs = Date.parse(at);
  let found: { title: string; index: number } | undefined;
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i]!;
    if (Date.parse(p.ts) <= atMs) found = { title: p.title, index: i };
  }
  return found;
}

/**
 * PURE: derives a logical grid layout from the predicted `ExpectedGraph` + live agent records.
 * Never throws, never mutates inputs, never accesses I/O, DOM, or the clock.
 *
 * v26 (DES-176): joins by LANE ORDINAL (`record.phaseIndex ?? inferPhase(record, phases)?.index`),
 * never by phase-title string equality — duplicate/dynamic phase titles no longer collide. Warning
 * outcome pinned PER BRANCH:
 *  - no lane resolvable (record precedes every phase, or the run has no phases at all) → implicit
 *    lane 0, NO warning (a v1-contract script may legally dispatch before its first `phase()`).
 *  - lane in range and NOT dynamic → placed in that lane, slot-matched by LABEL against the union
 *    of that lane's own slots' labels, NO warning on a match.
 *  - lane in range and `dynamic` → frame-grouped fallback cell in that lane's column, WITH a
 *    warning (PLUS one standing warning for the lane's mere existence, even with zero live agents
 *    there yet — the layout is genuinely unpredictable ahead of a run, not only once an agent lands).
 *  - lane beyond the predicted set (`k >= lanes.length`) → appended live, WITH a warning (reachable
 *    only when a script's runtime `phase()` count exceeds the predicted skeleton's).
 * A predicted slot that matched no live agent renders as an INERT cell (id `__skel_<slotIndex>__`,
 * no agentId/state) — the v11 DES-064 "predicted but not yet run" behavior, preserved.
 * maxNodes (default 200) caps agent cells; trigger is always present in addition.
 */
export function layoutGraph(
  expected: ExpectedGraph,
  liveAgents: AgentRecord[],
  phases: PhaseView[],
  opts?: LayoutGraphOpts,
): { cells: LayoutCell[]; edges: LayoutEdge[]; warnings: string[]; truncated?: boolean } {
  const warnings: string[] = [];
  const cells: LayoutCell[] = [];
  const edges: LayoutEdge[] = [];
  const maxNodes = opts?.maxNodes ?? 200;

  // Guard against garbage input (pure: never throws)
  const lanes = Array.isArray(expected?.lanes) ? expected.lanes : [];
  const slots = Array.isArray(expected?.slots) ? expected.slots : [];
  const safeAgents = Array.isArray(liveAgents) ? liveAgents : [];
  const safePhases = Array.isArray(phases) ? phases : [];

  // --- Trigger cell (always present, always col:0) ---
  cells.push({ id: '__trigger__', kind: 'trigger', col: 0, row: 0, laneSpan: 1, label: opts?.startedByType ?? 'trigger' });

  let agentCellCount = 0;
  let truncated = false;
  const rowCounters = new Map<number, number>(); // laneIndex -> next row
  const nextRow = (laneIdx: number): number => {
    const row = rowCounters.get(laneIdx) ?? 0;
    rowCounters.set(laneIdx, row + 1);
    return row;
  };
  const placeCell = (laneIdx: number, cell: Omit<LayoutCell, 'col' | 'row'>): void => {
    cells.push({ ...cell, col: laneIdx + 1, row: nextRow(laneIdx) });
    agentCellCount++;
  };
  // Same derivation as `buildDagModel`'s `DagAgentNode.durationMs` above — undefined until both
  // timestamps land (never a guess at an in-flight duration).
  const durationOf = (a: AgentRecord): number | undefined =>
    a.startedAt && a.endedAt ? Math.max(0, Date.parse(a.endedAt) - Date.parse(a.startedAt)) : undefined;

  // --- Group live agents by resolved LANE ORDINAL (never by phase-title string) ---
  const byLane = new Map<number, AgentRecord[]>();
  const implicitLane0: AgentRecord[] = [];
  for (const a of safeAgents) {
    const laneIdx = a.phaseIndex ?? inferPhase(a, safePhases)?.index;
    if (laneIdx === undefined) { implicitLane0.push(a); continue; }
    const arr = byLane.get(laneIdx) ?? [];
    arr.push(a);
    byLane.set(laneIdx, arr);
  }
  const byStartedAt = (a: AgentRecord, b: AgentRecord) => (a.startedAt ?? '').localeCompare(b.startedAt ?? '');
  for (const arr of byLane.values()) arr.sort(byStartedAt);
  implicitLane0.sort(byStartedAt);

  // --- Implicit lane 0 (no resolvable lane — legally before the first phase()) ---
  for (const a of implicitLane0) {
    if (agentCellCount >= maxNodes) { truncated = true; break; }
    placeCell(0, { id: a.agentId, kind: 'agent', laneSpan: 1, label: a.label, state: a.state, agentId: a.agentId, tokens: a.tokens, costUSD: a.costUSD, unpriced: a.unpriced, durationMs: durationOf(a) });
  }

  // --- Declared lanes: label-matched (static) or frame-grouped-with-warning (dynamic) ---
  for (const lane of lanes) {
    if (truncated) break;
    const laneAgents = byLane.get(lane.index) ?? [];
    if (lane.dynamic) {
      // Standing warning: the layout is unpredictable ahead of a run, independent of live data.
      warnings.push(`lane ${lane.index}${lane.title ? ` (${lane.title})` : ''} is dynamic: agents cannot be statically slotted`);
      for (const a of laneAgents) {
        if (agentCellCount >= maxNodes) { truncated = true; break; }
        placeCell(lane.index, { id: a.agentId, kind: 'agent', laneSpan: 1, label: a.label, state: a.state, agentId: a.agentId, tokens: a.tokens, costUSD: a.costUSD, unpriced: a.unpriced, durationMs: durationOf(a) });
        warnings.push(`agent ${a.agentId} unmatched to the predicted layout: frame-grouped`);
      }
      continue;
    }
    // Static lane: match by LABEL against the union of this lane's own slots' labels — never a
    // global label search (that would re-collide "duplicate labels — two distinct slots joined by
    // offset, not label", the exact case this rewrite fixes).
    const laneSlots = (Array.isArray(lane.slots) ? lane.slots : []).map((si) => slots[si]).filter((s): s is ExpectedSlot => s !== undefined);
    const labelSet = new Set(laneSlots.flatMap((s) => s.labels));
    for (const a of laneAgents) {
      if (agentCellCount >= maxNodes) { truncated = true; break; }
      const matched = a.label !== undefined && labelSet.has(a.label);
      placeCell(lane.index, { id: a.agentId, kind: 'agent', laneSpan: 1, label: a.label, state: a.state, agentId: a.agentId, tokens: a.tokens, costUSD: a.costUSD, unpriced: a.unpriced, durationMs: durationOf(a) });
      if (!matched) warnings.push(`agent ${a.agentId} unmatched to the predicted layout: frame-grouped`);
    }
    // Inert cells for predicted slots that matched no live agent yet (v11 DES-064 behavior kept).
    //
    // A slot is COVERED by any agent that was PLACED in this lane — which in lane 0 includes the
    // implicit-lane agents placed above, not just `byLane.get(0)`. Without them a grandfathered v1
    // run (REQ-124: no `phase()`, so every record resolves to no lane and lands in `implicitLane0`)
    // rendered its live cell AND a `__skel_` cell for the very same call, doubling every completed
    // agent in the v1 cohort's dashboard. The v1 fallback graph predicts its slots in lane 0, so
    // that is exactly where the two sets have to meet.
    const covering = lane.index === 0 ? [...laneAgents, ...implicitLane0] : laneAgents;
    if (!truncated) {
      for (const s of laneSlots) {
        if (covering.some((a) => a.label !== undefined && s.labels.includes(a.label))) continue;
        if (agentCellCount >= maxNodes) { truncated = true; break; }
        placeCell(lane.index, { id: `__skel_${s.index}__`, kind: 'agent', laneSpan: 1, ...(s.labels.length ? { label: s.labels.join(' / ') } : {}) });
      }
    }
  }

  // --- Lanes beyond the predicted set (k >= lanes.length): appended live, WITH a warning ---
  if (!truncated) {
    for (const laneIdx of [...byLane.keys()].filter((k) => k >= lanes.length).sort((a, b) => a - b)) {
      if (truncated) break;
      warnings.push(`lane ${laneIdx} is beyond the predicted layout: appended`);
      for (const a of byLane.get(laneIdx)!) {
        if (agentCellCount >= maxNodes) { truncated = true; break; }
        placeCell(laneIdx, { id: a.agentId, kind: 'agent', laneSpan: 1, label: a.label, state: a.state, agentId: a.agentId, tokens: a.tokens, costUSD: a.costUSD, unpriced: a.unpriced, durationMs: durationOf(a) });
      }
    }
  }

  if (truncated) warnings.push(`graph truncated to ${maxNodes} nodes`);

  // --- Edges: fan every cell in col N to every cell in col N+1 ---
  const cellsByCol = new Map<number, LayoutCell[]>();
  for (const c of cells) {
    const arr = cellsByCol.get(c.col) ?? [];
    arr.push(c);
    cellsByCol.set(c.col, arr);
  }
  const cols = [...cellsByCol.keys()].sort((a, b) => a - b);
  for (let i = 0; i < cols.length - 1; i++) {
    for (const from of cellsByCol.get(cols[i]!)!) {
      for (const to of cellsByCol.get(cols[i + 1]!)!) {
        edges.push({ from: from.id, to: to.id });
      }
    }
  }

  return { cells, edges, warnings, ...(truncated ? { truncated } : {}) };
}
