// Dashboard pure render model (DES-018 / ARCH-011 / TASK-020).
// buildDashboardModel is a PURE function: no store/network access, no parallel dashboard DTO —
// it shapes exactly the existing RunSummary[]/RunStatusView/TranscriptEvent[] shapes (DES-010).
// HTTP transport + live-tail polling (TASK-025) reads this VM; not built here (distinct test seam,
// D-V2f task split).
import type { RunSummary, RunStatusView, TranscriptEvent } from './types.js';

export interface DashboardVM {
  runs: RunSummary[];
  selected?: RunStatusView;
  transcript?: TranscriptEvent[];
  degraded?: string;
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
