// Dashboard pure render model (DES-018 / ARCH-011 / TASK-020).
// buildDashboardModel is a PURE function: no store/network access, no parallel dashboard DTO —
// it shapes exactly the existing RunSummary[]/RunStatusView/TranscriptEvent[] shapes (DES-010).
// HTTP transport + live-tail polling (TASK-025) reads this VM; not built here (distinct test seam,
// D-V2f task split).
import type { RunSummary, RunStatusView, TranscriptEvent, AgentRecord } from './types.js';
import type { SkeletonNode } from './workflow-meta.js';

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
  tokens: number;
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
    target.agents.push({ agentId: a.agentId, label: a.label, state: a.state, model: a.model, tokens: a.tokens.input + a.tokens.output, startedAt: a.startedAt, endedAt: a.endedAt, durationMs });
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
}

export interface WorkflowCard {
  name: string;
  description: string;
  group: 'running' | 'registered' | 'other';
  metrics: WorkflowMetrics;
  activeRunId?: string;
  latestRunId?: string;
}

export interface HomeView {
  running: WorkflowCard[];
  registered: WorkflowCard[];
  other: WorkflowCard[];
}

const ZERO_METRICS: WorkflowMetrics = { successRate: null, avgDurationMs: null, terminalCount: 0 };
const TERMINAL_STATUSES = new Set<string>(['completed', 'failed', 'stopped']);
const ACTIVE_STATUSES = new Set<string>(['running', 'queued', 'suspended', 'interrupted']);

/**
 * PURE: groups RunSummary[] by run.name and folds each group into a WorkflowMetrics.
 * terminalCount = runs with status ∈ {completed,failed,stopped}.
 * successRate = completedCount / terminalCount; null if terminalCount === 0.
 * avgDurationMs = mean(Date.parse(terminalAt) − Date.parse(createdAt)) over terminal runs
 *   with a parseable terminalAt; null if none are parseable.
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
    out.set(key, { successRate, avgDurationMs, terminalCount });
  }
  return out;
}

/**
 * PURE: builds a HomeView from a catalog snapshot, a run list, and a pre-computed metrics map.
 * RUNNING = catalog workflow with ≥1 active (non-terminal) run.
 * REGISTERED = catalog workflow with no active run.
 * OTHER = run name absent from catalog (inline or deregistered).
 * A workflow appears in exactly ONE group (RUNNING wins). Never throws.
 */
export function buildHomeView(
  catalog: Array<{ name: string; description: string }>,
  runs: RunSummary[],
  metrics: Map<string | undefined, WorkflowMetrics>,
): HomeView {
  const catalogMap = new Map(catalog.map((c) => [c.name, c.description]));
  // Gather active and latest run per named workflow
  const activeRunId = new Map<string, string>();
  const latestRunId = new Map<string, string>();
  for (const r of runs) {
    const name = r.name;
    if (name === undefined) continue;
    if (ACTIVE_STATUSES.has(r.status)) activeRunId.set(name, r.runId);
    latestRunId.set(name, r.runId); // last one wins (list order)
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
      ...(latestRunId.has(name) ? { latestRunId: latestRunId.get(name) } : {}),
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
      ...(latestRunId.has(key) ? { latestRunId: latestRunId.get(key) } : {}),
    });
  }
  return { running, registered, other };
}

// ── v11 Sprint 3 (TASK-067 / DES-064): pure graph layout ──

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
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface LayoutGraphOpts {
  startedByType?: string;
  maxNodes?: number;
}

/**
 * PURE: derives a logical grid layout from skeleton nodes + live agent records.
 * Never throws, never mutates inputs, never accesses I/O, DOM, or the clock.
 *
 * Join order: phase → (ordered-set within phase, tied by startedAt). The same-label+different-
 * startedAt case is intentionally handled — two parallel agents in the same group produce TWO
 * cells, not one collapsed cell (DES-064 ARCH-042).
 *
 * Unmatched live agents (dynamic/conditional) → frame-grouped fallback cell + warnings[].
 * Unmatched skeleton nodes (predicted but not yet run) → inert cell (no agentId/state).
 * maxNodes (default 200) caps agent cells; trigger is always present in addition.
 */
export function layoutGraph(
  skeletonNodes: SkeletonNode[],
  liveAgents: AgentRecord[],
  opts?: LayoutGraphOpts,
): { cells: LayoutCell[]; edges: LayoutEdge[]; warnings: string[]; truncated?: boolean } {
  const warnings: string[] = [];
  const cells: LayoutCell[] = [];
  const edges: LayoutEdge[] = [];
  const maxNodes = opts?.maxNodes ?? 200;

  // Guard against garbage input (pure: never throws)
  const safeNodes = Array.isArray(skeletonNodes) ? skeletonNodes : [];
  const safeAgents = Array.isArray(liveAgents) ? liveAgents : [];

  // --- Trigger cell (always present, always col:0) ---
  cells.push({ id: '__trigger__', kind: 'trigger', col: 0, row: 0, laneSpan: 1, label: opts?.startedByType ?? 'trigger' });

  // --- Build skeleton slots (agent nodes per phase, in order) ---
  // Track phases in order of first appearance (explicit phase node OR first agent in implicit phase).
  const phaseOrder: string[] = [];
  const slotsPerPhase = new Map<string, { skeletonIdx: number; row: number }[]>();
  const rowCounters = new Map<string, number>(); // phase → next row index
  let curPhaseKey = '';
  for (let i = 0; i < safeNodes.length; i++) {
    const node = safeNodes[i]!;
    if (node.kind === 'phase') {
      curPhaseKey = node.title ?? '';
      if (!phaseOrder.includes(curPhaseKey)) phaseOrder.push(curPhaseKey);
    } else if (node.kind === 'agent') {
      // Add implicit phase key on first encounter (skeleton agent before any explicit phase node)
      if (!phaseOrder.includes(curPhaseKey)) phaseOrder.push(curPhaseKey);
      const row = rowCounters.get(curPhaseKey) ?? 0;
      rowCounters.set(curPhaseKey, row + 1);
      const slots = slotsPerPhase.get(curPhaseKey) ?? [];
      slots.push({ skeletonIdx: i, row });
      slotsPerPhase.set(curPhaseKey, slots);
    }
  }
  // Add any live-agent phases not already in skeleton's phase order
  for (const a of safeAgents) {
    const k = a.phase ?? '';
    if (!phaseOrder.includes(k)) phaseOrder.push(k);
  }
  // col: 1-based (col 0 = trigger)
  const phaseColMap = new Map(phaseOrder.map((p, i) => [p, i + 1]));

  // --- Sort live agents within each phase by startedAt (ordered-set join) ---
  const liveByPhase = new Map<string, AgentRecord[]>();
  for (const a of safeAgents) {
    const k = a.phase ?? '';
    const arr = liveByPhase.get(k) ?? [];
    arr.push(a);
    liveByPhase.set(k, arr);
  }
  for (const arr of liveByPhase.values()) {
    arr.sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
  }

  // --- Positional match: skeleton slot[i] → live agent[i] within each phase ---
  const matchedIds = new Set<string>();
  let agentCellCount = 0;
  let truncated = false;

  for (const phaseKey of phaseOrder) {
    const slots = slotsPerPhase.get(phaseKey) ?? [];
    const liveInPhase = liveByPhase.get(phaseKey) ?? [];
    const col = phaseColMap.get(phaseKey) ?? 1;

    for (let si = 0; si < slots.length; si++) {
      if (agentCellCount >= maxNodes) { truncated = true; break; }
      const slot = slots[si]!;
      const live = liveInPhase[si];
      if (live) matchedIds.add(live.agentId);

      const id = live ? live.agentId : `__skel_${slot.skeletonIdx}__`;
      const cell: LayoutCell = { id, kind: 'agent', col, row: slot.row, laneSpan: 1 };
      if (live?.label != null) cell.label = live.label;
      if (live?.state != null) cell.state = live.state;
      if (live?.agentId != null) cell.agentId = live.agentId;
      cells.push(cell);
      agentCellCount++;
    }
    if (truncated) break;
  }

  // --- Unmatched live agents → frame-grouped fallback ---
  if (!truncated) {
    for (const a of safeAgents) {
      if (matchedIds.has(a.agentId)) continue;
      if (agentCellCount >= maxNodes) { truncated = true; break; }
      const k = a.phase ?? '';
      const col = phaseColMap.get(k) ?? 1;
      const row = rowCounters.get(k) ?? 0;
      rowCounters.set(k, row + 1);
      cells.push({ id: a.agentId, kind: 'agent', col, row, laneSpan: 1, label: a.label, state: a.state, agentId: a.agentId });
      matchedIds.add(a.agentId);
      agentCellCount++;
      warnings.push(`agent ${a.agentId} unmatched to the predicted layout: frame-grouped`);
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
