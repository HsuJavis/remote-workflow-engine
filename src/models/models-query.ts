// Issue #104: the `models_list` query surface over ENRICHED rows — selection filters, sortBy/order
// (nulls always last), cursor pagination with a total, and a field projection whose default is a
// COMPACT row. The catalog-level filters (provider/query/modality/price/context/toolUseDeclared/
// location) stay in `model-catalog.ts`'s `matchesCatalogFilter` and are applied before enrichment;
// this module adds everything that needs the enriched row (probe, benchmarks, observed).
//
// Size: a full-field row can reach a few KB (design-arena arrays, long descriptions), so besides
// `limit` every page is also cut at PAGE_BYTE_BUDGET serialized bytes — the rest is one
// `nextCursor` away, never dropped — keeping any page far below the ~198KB MCP response limit.
import type { EnrichedModelEntry } from './model-catalog.js';
import { maxPricePerMOf } from './model-catalog.js';
import type { CallStats, ObservedForRef } from './observed-stats.js';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
export const PAGE_BYTE_BUDGET = 100_000;

export type SortBy = 'price' | 'costLevel' | 'intelligence' | 'coding' | 'agentic' | 'latency' | 'successRate' | 'avgCostPerCall' | 'contextWindow' | 'releasedAt';
export const SORT_KEYS: readonly SortBy[] = ['price', 'costLevel', 'intelligence', 'coding', 'agentic', 'latency', 'successRate', 'avgCostPerCall', 'contextWindow', 'releasedAt'];
/** The natural "best first" direction per key, used when `order` is omitted. */
const DEFAULT_ORDER: Record<SortBy, 'asc' | 'desc'> = {
  price: 'asc', costLevel: 'asc', latency: 'asc', avgCostPerCall: 'asc',
  intelligence: 'desc', coding: 'desc', agentic: 'desc', successRate: 'desc', contextWindow: 'desc', releasedAt: 'desc',
};

export interface ModelsQuery {
  fields?: string[];
  limit?: number;
  cursor?: string;
  sortBy?: SortBy;
  order?: 'asc' | 'desc';
  callKind?: 'prose' | 'tools';
  modelType?: string;
  toolUseVerified?: boolean;
  structuredOutput?: boolean;
  reasoning?: boolean;
  minIntelligence?: number;
  minCoding?: number;
  minAgentic?: number;
  maxLatencyMsP95?: number;
  minSuccessRate?: number;
  maxAvgCostUsdPerCall?: number;
}

export interface ModelsPage { models: Array<Record<string, unknown>>; nextCursor: string | null; total: number }

export class ModelsQueryError extends Error {}

/** The default (compact) row: enough to choose, small enough for 200 rows per page. Nested picks:
 *  `capabilities` -> {toolUse}, `benchmarks` -> {artificialAnalysis} (or null), `observed` -> per
 *  bucket {calls, successRate, latencyMsP50, latencyMsP95, avgCostUsdPerCall}. */
export const COMPACT_FIELDS = [
  'ref', 'provider', 'model', 'modelType', 'limits', 'price', 'costLevel', 'capabilities',
  'toolUseVerified', 'stability', 'benchmarks', 'observed',
] as const;

/** Every top-level key a full row carries (the `fields` vocabulary). */
export const ALL_FIELDS = [
  'ref', 'provider', 'model', 'description', 'modalities', 'contextWindow', 'price', 'location', 'besteffort', 'ratesPerM',
  'capability', 'stability', 'costLevel', 'toolUseDeclared', 'effortDeclared', 'declaredSource', 'catalogFetchedAt',
  'toolUseVerified', 'proseVerified', 'lastProbedAt', 'probeDetail', 'stabilitySource', 'probeFailureReason',
  'modelType', 'modelTypeSource', 'limits', 'capabilities', 'effortAppliedOnTransport', 'pricingDetail', 'local',
  'lifecycle', 'benchmarks', 'sameModelAs', 'borrowedFrom', 'observed',
] as const;
const ALL_FIELD_SET = new Set<string>(ALL_FIELDS);

const bucket = (r: EnrichedModelEntry, kind: 'prose' | 'tools'): CallStats | null => r.observed[kind];
/** p95 latency of the chosen bucket; the persisted probe latency is the fallback when no run data. */
const latencyOf = (r: EnrichedModelEntry, kind: 'prose' | 'tools'): number | null => bucket(r, kind)?.latencyMsP95 ?? r.observed.probeLatencyMs ?? null;

function sortValue(r: EnrichedModelEntry, key: SortBy, kind: 'prose' | 'tools'): number | null {
  switch (key) {
    case 'price': return maxPricePerMOf(r.ratesPerM ?? null);
    case 'costLevel': return r.costLevel;
    case 'intelligence': return r.benchmarks?.artificialAnalysis?.intelligence ?? null;
    case 'coding': return r.benchmarks?.artificialAnalysis?.coding ?? null;
    case 'agentic': return r.benchmarks?.artificialAnalysis?.agentic ?? null;
    case 'latency': return latencyOf(r, kind);
    case 'successRate': return bucket(r, kind)?.successRate ?? null;
    case 'avgCostPerCall': return bucket(r, kind)?.avgCostUsdPerCall ?? null;
    case 'contextWindow': return r.contextWindow;
    case 'releasedAt': {
      const t = r.lifecycle.releasedAt ? Date.parse(r.lifecycle.releasedAt) : NaN;
      return Number.isFinite(t) ? t : null;
    }
  }
}

function matches(r: EnrichedModelEntry, q: ModelsQuery, kind: 'prose' | 'tools'): boolean {
  const atLeast = (v: number | null | undefined, min: number | undefined): boolean => min === undefined || (v != null && v >= min);
  const atMost = (v: number | null | undefined, max: number | undefined): boolean => max === undefined || (v != null && v <= max);
  if (q.modelType !== undefined && r.modelType !== q.modelType) return false;
  if (q.toolUseVerified !== undefined && r.toolUseVerified !== q.toolUseVerified) return false;
  if (q.structuredOutput !== undefined && r.capabilities.structuredOutput !== q.structuredOutput) return false;
  if (q.reasoning !== undefined && r.capabilities.reasoning.supported !== q.reasoning) return false;
  const aa = r.benchmarks?.artificialAnalysis;
  if (!atLeast(aa?.intelligence, q.minIntelligence) || !atLeast(aa?.coding, q.minCoding) || !atLeast(aa?.agentic, q.minAgentic)) return false;
  if (!atMost(latencyOf(r, kind), q.maxLatencyMsP95)) return false;
  if (!atLeast(bucket(r, kind)?.successRate, q.minSuccessRate)) return false;
  if (!atMost(bucket(r, kind)?.avgCostUsdPerCall, q.maxAvgCostUsdPerCall)) return false;
  return true;
}

function compactStats(s: CallStats | null): Record<string, unknown> | null {
  return s ? { calls: s.calls, successRate: s.successRate, latencyMsP50: s.latencyMsP50, latencyMsP95: s.latencyMsP95, avgCostUsdPerCall: s.avgCostUsdPerCall } : null;
}
function compactObserved(o: ObservedForRef): Record<string, unknown> {
  return { window: o.window, source: o.source, prose: compactStats(o.prose), tools: compactStats(o.tools), ...(o.probeLatencyMs != null ? { probeLatencyMs: o.probeLatencyMs } : {}) };
}

function project(r: EnrichedModelEntry, fields: string[] | undefined): Record<string, unknown> {
  const row = r as unknown as Record<string, unknown>;
  if (fields === undefined) {
    const out: Record<string, unknown> = {};
    for (const f of COMPACT_FIELDS) out[f] = row[f];
    out['capabilities'] = { toolUse: r.capabilities.toolUse };
    out['benchmarks'] = r.benchmarks ? { artificialAnalysis: r.benchmarks.artificialAnalysis } : null;
    out['observed'] = compactObserved(r.observed);
    return out;
  }
  if (fields.includes('*')) return row;
  const out: Record<string, unknown> = { ref: r.ref };
  for (const f of fields) if (f in row) out[f] = row[f];
  return out;
}

const encodeCursor = (offset: number): string => Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
function decodeCursor(cursor: string): number {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown };
    if (typeof parsed?.o === 'number' && Number.isInteger(parsed.o) && parsed.o >= 0) return parsed.o;
  } catch { /* fall through */ }
  throw new ModelsQueryError('cursor is not a value this tool returned as nextCursor — omit it to start from the first page');
}

/** Filter -> sort -> page -> project. `rows` are already narrowed by the catalog-level filters.
 *  Throws ModelsQueryError (the caller's INVALID_ARGUMENT) for an unknown field or a bad cursor. */
export function queryModels(rows: readonly EnrichedModelEntry[], q: ModelsQuery): ModelsPage {
  if (q.fields !== undefined) {
    const unknown = q.fields.filter((f) => f !== '*' && !ALL_FIELD_SET.has(f));
    if (unknown.length > 0) {
      throw new ModelsQueryError(`unknown field(s): ${unknown.join(', ')} — valid fields: ${ALL_FIELDS.join(', ')} (or ['*'] for all)`);
    }
  }
  const offset = q.cursor !== undefined ? decodeCursor(q.cursor) : 0;
  const limit = Math.min(Math.max(1, Math.floor(q.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
  const kind = q.callKind ?? 'tools';
  let matched = rows.filter((r) => matches(r, q, kind));
  if (q.sortBy !== undefined) {
    const key = q.sortBy;
    const dir = (q.order ?? DEFAULT_ORDER[key]) === 'asc' ? 1 : -1;
    // Stable sort over (value, original position); a null value always sorts after every number.
    matched = matched
      .map((r, i) => ({ r, i, v: sortValue(r, key, kind) }))
      .sort((a, b) => (a.v === null ? (b.v === null ? a.i - b.i : 1) : b.v === null ? -1 : a.v !== b.v ? (a.v - b.v) * dir : a.i - b.i))
      .map((x) => x.r);
  }
  const models: Array<Record<string, unknown>> = [];
  let bytes = 0;
  let next = offset;
  for (; next < matched.length && models.length < limit; next++) {
    const p = project(matched[next]!, q.fields);
    const size = Buffer.byteLength(JSON.stringify(p));
    if (models.length > 0 && bytes + size > PAGE_BYTE_BUDGET) break;
    models.push(p);
    bytes += size;
  }
  return { models, nextCursor: next < matched.length ? encodeCursor(next) : null, total: matched.length };
}
