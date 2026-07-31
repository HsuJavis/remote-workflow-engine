// Dashboard pure render model (DES-018 / ARCH-011 / TASK-020).
// buildDashboardModel is a PURE function: no store/network access, no parallel dashboard DTO —
// it shapes exactly the existing RunSummary[]/RunStatusView/TranscriptEvent[] shapes (DES-010).
// HTTP transport + live-tail polling (TASK-025) reads this VM; not built here (distinct test seam,
// D-V2f task split).
import type { RunSummary, RunStatusView, TranscriptEvent, AgentRecord } from './types.js';

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
