// Issue #104: the ObservedStats interface `models_list` codes against — VERBATIM from the owner's
// spec. The implementation (`src/models/observed-stats.ts`: aggregation of this engine's own agent
// calls over all principals' runs, 30-day window, probe fallback) is built separately; this file
// only pins the shape so the `observed` row field and the observed filters/sorts compile without it.
// Aggregate numbers per model ref only — never run ids, workflow names, principals or prompts.
export interface CallStats { calls: number; successRate: number; latencyMsP50: number|null;
  latencyMsP95: number|null; avgInputTokens: number|null; avgOutputTokens: number|null;
  avgCacheReadTokens: number|null; avgCacheWriteTokens: number|null; avgCostUsdPerCall: number|null;
  lastAt: string }
export interface ObservedForRef { window: '30d'; source: 'runs'|'probe'|'none';
  prose: CallStats|null; tools: CallStats|null; probeLatencyMs?: number|null }
export interface ObservedStatsProvider { get(ref: string): ObservedForRef; getAll(): Map<string, ObservedForRef> }

/** What a row says when nothing was ever measured (or no provider is wired). */
export const OBSERVED_NONE: ObservedForRef = { window: '30d', source: 'none', prose: null, tools: null };
