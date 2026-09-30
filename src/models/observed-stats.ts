// Issue #104 (ObservedStats interface): engine-measured per-model-ref call stats — what models_list's
// `observed` field reads (agent 1 owns the row-shape wiring in models_list; this module owns the
// data). Distinct from `benchmarks` (third-party, global) — this is "how THIS deployment's own runs
// actually did on this model", aggregated over ALL principals (owner decision: never scoped to one
// caller) in a rolling 30-day window, split prose ('tools' surface resolved empty, i.e.
// `allowedTools: []`) vs tools (any resolved tool surface).
//
// Ground truth and why a new read path was needed: an agent call's provider/model/tokens/cost/
// state/startedAt/endedAt already live on `AgentRecord` (`run-store.ts`'s `deriveAgentRecords`,
// reconstructed from a run's per-agent `agent-<id>.jsonl` transcript — the same source `getRun()`
// reads). But `AgentRecord` never carried the RESOLVED tool surface (see its field list in
// `types.ts`) — only the raw `kind:'harness'` transcript event's `descriptor.tools` has it. So this
// module reads transcripts directly (via two small additive `SqliteRunStore` methods,
// `terminalRunIdsSince`/`allAgentTranscripts`) and reuses `deriveAgentRecords` for everything else,
// rather than re-deriving state/tokens/cost logic a second time.
//
// Efficiency (spec: "must not scan all run journals per models_list call"): the expensive
// transcript-reading aggregation runs at most once per `ttlMs` window (default 5 min) — a TTL cache,
// not a per-call scan. The recompute itself is O(settled agent calls in the window); percentiles are
// computed exactly (sorted array, nearest-rank method — see `percentile()`), which a 10k-row
// benchmark keeps well under 200ms (see tests/unit/observed-stats.test.ts).
//
// Precise definitions (owner decisions, since the spec leaves these to the implementer):
//  - Window: a call counts when its `endedAt` (settle time) is >= now-30d. The SQL pre-filter that
//    finds candidate runs (`terminalRunIdsSince`) is EXACT, not an approximation: it filters on the
//    run's own terminal-transition timestamp, which is always >= every one of its calls' `endedAt`,
//    so "runs that terminated in the window" is precisely the candidate set — no run with a
//    within-window call is ever excluded by it. See that method's own doc.
//  - "runs stopped by the user excluded": `terminalRunIdsSince` only returns 'completed'/'failed'
//    runs — a 'stopped' run's calls never enter the aggregate at all.
//  - "tools" vs "prose": read off the harness event's `descriptor.tools` (the ACTUAL materialized
//    tool surface for the dispatch, source-of-truth for "resolved allowedTools" per the spec) —
//    non-empty -> 'tools', empty -> 'prose'.
//  - Success/failure: `AgentRecord.state === 'done'` -> success; `'failed'` -> failure (this is the
//    state a timeout/gateway error settles into — see `deriveAgentRecords`'s own branch comment: "a
//    failed call moves no counter", so its tokens/cost are a real, counted zero, not an absence).
//    `'queued'`/`'running'` (not yet settled) and `'refused'` (never dispatched — no provider/model
//    to attribute it to) are excluded entirely, not counted as failures.
//    KNOWN GAP (verified by reading agent-executor.ts, not assumed): a call ABORTED by
//    run_suspend/run_stop also settles `state:'failed'` (via `_finalizeAborted` -> the same
//    `capture()` path), but `_finalizeAborted` stamps its usage event with `provider: ''`
//    UNCONDITIONALLY, even when the harness had already resolved a real provider before the abort —
//    so `AgentRecord.provider` is always `''` for an aborted call, regardless of `deriveAgentRecords`'
//    `data.provider ?? 'unknown'` fallback (`??` does not replace an empty string). This module's own
//    `!rec.provider` guard below (needed to keep 'refused'/harness-only junk out of the ref
//    aggregate) therefore ALSO excludes every aborted call as a side effect — an abort never counts
//    against any model ref today, contrary to a literal reading of "aborts count as failures". Fixing
//    that means `_finalizeAborted` stamping the harness-resolved provider instead of `''` — out of
//    this module's scope (agent-executor.ts's capture path, shared by every other caller of
//    `capture()`), left for a follow-up.
//  - Cost: `unpriced: true` -> excluded from the cost average (a real "we don't know", per
//    ADR-046) — NOT the same as `costUSD: 0`, which for a `'failed'` call is a real measured zero and
//    IS averaged in.
//  - Latency: wall clock `endedAt - startedAt` in ms, for every settled call (success AND failure —
//    a timeout's latency is informative too). p50/p95 via the nearest-rank method on the exact
//    sorted sample (`Math.ceil(p * n) - 1`), never interpolated, never a bounded sub-sample — the
//    performance budget did not require one.
//  - Probe fallback: only when a ref has ZERO run-observed calls in the window (source `'runs'` is
//    preferred over `'probe'` even if only one of prose/tools has data). `probeLatencyMs` is the
//    average of the probe's prose and tools legs (`ModelProbeStore.get()` already persists both,
//    since every probe — periodic or ad-hoc `models_probe` — writes through `ModelProber._probe` ->
//    `store.put()`; the spec's "currently returned once, not stored" premise no longer holds for this
//    codebase, verified by reading `model-probe.ts`).
//  - Privacy: `CallStats`/`ObservedForRef` carry only aggregate numbers + a settle timestamp — never
//    a runId, agentId, principal, or prompt text (see the privacy test).
import type { Clock } from '../clock.js';
import type { TranscriptEvent } from '../types.js';
import { deriveAgentRecords } from '../run-store.js';
import type { ModelProbeStore } from './model-probe.js';
import { parseModelRef } from '../providers.js';

export interface CallStats {
  calls: number;
  successRate: number;
  latencyMsP50: number | null;
  latencyMsP95: number | null;
  avgInputTokens: number | null;
  avgOutputTokens: number | null;
  avgCacheReadTokens: number | null;
  avgCacheWriteTokens: number | null;
  avgCostUsdPerCall: number | null;
  lastAt: string;
}

export interface ObservedForRef {
  window: '30d';
  source: 'runs' | 'probe' | 'none';
  prose: CallStats | null;
  tools: CallStats | null;
  probeLatencyMs?: number | null;
}

export interface ObservedStatsProvider {
  get(ref: string): ObservedForRef;
  getAll(): Map<string, ObservedForRef>;
}

/** The minimal read surface this module needs off the run store — `SqliteRunStore` satisfies this
 *  structurally via its two additive methods (issue #104). Kept as its own interface (not the
 *  concrete class) so a test can inject a spy/fake without a real sqlite file. */
export interface ObservedStatsSource {
  terminalRunIdsSince(sinceIso: string): string[];
  settledCallEvents(runId: string): Map<string, TranscriptEvent[]>;
}

/** One settled agent call, reduced to exactly what the aggregation needs — deliberately NOT
 *  carrying agentId/runId/principal/prompt (privacy: aggregate-only, structurally, not by
 *  convention). */
export interface AgentCallFact {
  ref: string;
  kind: 'prose' | 'tools';
  success: boolean;
  startedAt: string;
  endedAt: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** `null` = unpriced (never averaged in), never "free". */
  costUsd: number | null;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** Reads every settled ('done'|'failed') agent call whose `endedAt` falls in `[sinceIso, now]` out of
 *  `source`, reusing `deriveAgentRecords` for state/tokens/cost/startedAt/endedAt/model/provider and
 *  reading the harness event directly for the tools-vs-prose split (see module header). A
 *  'queued'/'running'/'refused' record, or one missing model/provider/startedAt/endedAt, is skipped
 *  (never dispatched, or not yet settled — nothing to attribute); a ref that fails to parse as
 *  `<provider>/<model>` (e.g. a pre-#20 record's `provider:'unknown'`) is skipped too, never
 *  aggregated under a junk key. The `parentStatus` passed to `deriveAgentRecords` is always
 *  `'completed'` — it only changes the harness-only branch's state between `'running'`/`'queued'`,
 *  and both are skipped here regardless. `terminalRunIdsSince` already returns the EXACT candidate
 *  set (a run's terminalAt is always >= every one of its calls' endedAt) — the `rec.endedAt <
 *  sinceIso` check below is belt-and-braces, not a second approximation. */
export function loadFacts(source: ObservedStatsSource, sinceIso: string): AgentCallFact[] {
  const runIds = source.terminalRunIdsSince(sinceIso);
  const facts: AgentCallFact[] = [];
  for (const runId of runIds) {
    const transcripts = source.settledCallEvents(runId);
    const records = deriveAgentRecords(transcripts, 'completed');
    for (const rec of records) {
      if (rec.state !== 'done' && rec.state !== 'failed') continue;
      if (!rec.model || !rec.provider) continue;
      if (!rec.startedAt || !rec.endedAt) continue;
      if (rec.endedAt < sinceIso) continue;
      if (parseModelRef(`${rec.provider}/${rec.model}`) === undefined) continue;
      const events = transcripts.get(rec.agentId) ?? [];
      const harness = [...events].reverse().find((e) => e.kind === 'harness');
      const descriptorTools = (harness?.data as { descriptor?: { tools?: string[] } } | undefined)?.descriptor?.tools ?? [];
      const tokens = rec.tokens;
      facts.push({
        ref: `${rec.provider}/${rec.model}`,
        kind: descriptorTools.length > 0 ? 'tools' : 'prose',
        success: rec.state === 'done',
        startedAt: rec.startedAt,
        endedAt: rec.endedAt,
        inputTokens: tokens?.input ?? 0,
        outputTokens: tokens?.output ?? 0,
        cacheReadTokens: tokens?.cacheRead ?? 0,
        cacheWriteTokens: tokens?.cacheWrite ?? 0,
        costUsd: rec.unpriced ? null : (rec.costUSD ?? null),
      });
    }
  }
  return facts;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Nearest-rank percentile over an ALREADY-sorted-ascending array — exact, no interpolation. */
function percentile(sortedAsc: number[], p: number): number {
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

/** Pure aggregation over one bucket's facts (all `prose` or all `tools` for one ref). `facts` must
 *  be non-empty — the caller (`aggregateFacts`) returns `null` for an empty bucket instead of
 *  calling this, matching the spec's `Stats|null` row shape. */
export function computeStats(facts: AgentCallFact[]): CallStats {
  const calls = facts.length;
  const successCount = facts.filter((f) => f.success).length;
  const latencies = facts
    .map((f) => Date.parse(f.endedAt) - Date.parse(f.startedAt))
    .filter((ms) => Number.isFinite(ms) && ms >= 0)
    .sort((a, b) => a - b);
  const costs = facts.map((f) => f.costUsd).filter((c): c is number => c !== null);
  let lastAt = facts[0].endedAt;
  for (const f of facts) if (f.endedAt > lastAt) lastAt = f.endedAt;
  return {
    calls,
    successRate: successCount / calls,
    latencyMsP50: latencies.length > 0 ? percentile(latencies, 0.5) : null,
    latencyMsP95: latencies.length > 0 ? percentile(latencies, 0.95) : null,
    avgInputTokens: avg(facts.map((f) => f.inputTokens)),
    avgOutputTokens: avg(facts.map((f) => f.outputTokens)),
    avgCacheReadTokens: avg(facts.map((f) => f.cacheReadTokens)),
    avgCacheWriteTokens: avg(facts.map((f) => f.cacheWriteTokens)),
    avgCostUsdPerCall: avg(costs),
    lastAt,
  };
}

/** Pure aggregation: buckets `facts` by `ref` then by `kind`, computing `CallStats` per non-empty
 *  bucket (`null` for an empty one). This is the O(n log n) step the performance budget (10k facts
 *  under 200ms) is about — everything above it (file reads) is TTL-cached, not re-run per call. */
export function aggregateFacts(facts: AgentCallFact[]): Map<string, { prose: CallStats | null; tools: CallStats | null }> {
  const byRef = new Map<string, { prose: AgentCallFact[]; tools: AgentCallFact[] }>();
  for (const f of facts) {
    let bucket = byRef.get(f.ref);
    if (!bucket) { bucket = { prose: [], tools: [] }; byRef.set(f.ref, bucket); }
    bucket[f.kind].push(f);
  }
  const out = new Map<string, { prose: CallStats | null; tools: CallStats | null }>();
  for (const [ref, bucket] of byRef) {
    out.set(ref, {
      prose: bucket.prose.length > 0 ? computeStats(bucket.prose) : null,
      tools: bucket.tools.length > 0 ? computeStats(bucket.tools) : null,
    });
  }
  return out;
}

/** The concrete `ObservedStatsProvider` — TTL-cached aggregation over `source`'s run data, falling
 *  back to `probes`' persisted `models_probe` latency when a ref has no run-observed calls at all.
 *
 *  Two ways the cache gets built, same as `ModelProber` (`model-probe.ts`)'s own start()/stop()
 *  convention:
 *   (1) Lazily, inside `get()`/`getAll()`, if the cache is missing or older than `ttlMs` — always
 *       correct, but on a large deployment this is a synchronous scan of every settled agent call in
 *       the window (see `loadFacts`), which can take on the order of 100-200ms+ at 10k agent-call
 *       volume (measured; see tests/unit/observed-stats.test.ts's real-SqliteRunStore benchmark) —
 *       acceptable as a rare fallback, not as the steady-state path for a request handler.
 *   (2) Proactively, via `start()` — arms a `setInterval` background refresh (same `ttlMs`) plus one
 *       deferred initial warm (`setTimeout(…, 0)`, off the synchronous boot path) — so in steady
 *       state a `get()`/`getAll()` call almost always finds a cache already fresh from the last tick
 *       and returns in O(1) map lookups, never running the scan on the request path at all. The
 *       background tick itself still runs synchronously (this store has no async/streaming read
 *       path) and briefly blocks the event loop for its duration — a deliberate, disclosed trade-off:
 *       building an indexed SQL fact table would mean writing to the `capture()` hot path this
 *       module was explicitly scoped OUT of touching (issue #104 dispatch). Given this deployment's
 *       actual call volumes (far below the 10k-row benchmark), the disclosed cost is a background
 *       tick well under the interval, not a per-request stall. `start()` is optional — a caller that
 *       never invokes it still gets correct, just lazily-synchronous, answers. */
export class RunStoreObservedStats implements ObservedStatsProvider {
  private _cache: { builtAt: number; byRef: Map<string, { prose: CallStats | null; tools: CallStats | null }> } | undefined;
  private _timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly _deps: {
    source: ObservedStatsSource;
    probes: Pick<ModelProbeStore, 'get' | 'all'>;
    clock: Clock;
    ttlMs?: number;
  }) {}

  /** Arms the background refresh described in the class doc above. Idempotent (a second call is a
   *  no-op while already running). `unref()`s the timers so an otherwise-idle process can still exit. */
  start(): void {
    if (this._timer) return;
    const ttl = this._deps.ttlMs ?? DEFAULT_TTL_MS;
    this._timer = setInterval(() => this._refresh(), ttl);
    this._timer.unref?.();
    const warm = setTimeout(() => this._refresh(), 0);
    warm.unref?.();
  }

  stop(): void {
    if (this._timer) clearInterval(this._timer);
    this._timer = undefined;
  }

  private _refresh(): void {
    const now = this._deps.clock.now();
    const sinceIso = new Date(now - THIRTY_DAYS_MS).toISOString();
    const facts = loadFacts(this._deps.source, sinceIso);
    this._cache = { builtAt: now, byRef: aggregateFacts(facts) };
  }

  private _byRef(): Map<string, { prose: CallStats | null; tools: CallStats | null }> {
    const now = this._deps.clock.now();
    const ttl = this._deps.ttlMs ?? DEFAULT_TTL_MS;
    if (this._cache && now - this._cache.builtAt < ttl) return this._cache.byRef;
    this._refresh();
    return this._cache!.byRef;
  }

  /** Shared by `get()`/`getAll()` — takes an ALREADY-LOOKED-UP bucket (never re-reads `_byRef()`
   *  itself) so `getAll()` can snapshot the map once and stay internally consistent even if the TTL
   *  expires mid-iteration (see `getAll()`'s own comment). */
  private _fromBucket(ref: string, bucket: { prose: CallStats | null; tools: CallStats | null } | undefined): ObservedForRef {
    if (bucket && (bucket.prose !== null || bucket.tools !== null)) {
      return { window: '30d', source: 'runs', prose: bucket.prose, tools: bucket.tools };
    }
    const parsed = parseModelRef(ref);
    const probe = parsed ? this._deps.probes.get(parsed.provider, parsed.model) : undefined;
    if (probe) {
      return {
        window: '30d', source: 'probe', prose: null, tools: null,
        probeLatencyMs: Math.round((probe.latencyMs.prose + probe.latencyMs.tools) / 2),
      };
    }
    return { window: '30d', source: 'none', prose: null, tools: null };
  }

  get(ref: string): ObservedForRef {
    return this._fromBucket(ref, this._byRef().get(ref));
  }

  getAll(): Map<string, ObservedForRef> {
    // ONE `_byRef()` call, reused for every ref below — a `getAll()` that instead called `get()` in
    // the loop could straddle a TTL expiry mid-iteration (a background refresh landing between two
    // lookups) and read two different snapshots in the same response.
    const byRef = this._byRef();
    const out = new Map<string, ObservedForRef>();
    for (const ref of byRef.keys()) out.set(ref, this._fromBucket(ref, byRef.get(ref)));
    for (const p of this._deps.probes.all()) {
      const ref = `${p.provider}/${p.model}`;
      if (!out.has(ref)) out.set(ref, this._fromBucket(ref, byRef.get(ref)));
    }
    return out;
  }
}
