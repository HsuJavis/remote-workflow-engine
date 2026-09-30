// Issue #104 (ObservedStats interface, agent 2 of 2): engine-measured per-model-ref call stats,
// aggregated over ALL principals' runs in a rolling 30-day window, split prose vs tools, with a
// models_probe latency fallback when no run data exists for a ref.
//
// Ground truth: an agent call's provider/model/tokens/cost/state/startedAt/endedAt live on the
// AgentRecord `deriveAgentRecords` (run-store.ts) reconstructs from a run's per-agent
// `agent-<id>.jsonl` transcript (SqliteRunStore) — the SAME source `getRun()` reads. The "tools" vs
// "prose" split is NOT on AgentRecord (it never carried the resolved tool surface) — it is read
// straight off the persisted `kind:'harness'` transcript event's `descriptor.tools` (the actual
// materialized tool list for the dispatch; `[]` = prose, matching `allowedTools: []`).
//
// Red reason (measured): src/models/observed-stats.ts does not exist yet — every import below
// fails with "Cannot find module '../../src/models/observed-stats.js'".
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { Clock } from '../../src/clock.js';
import { ModelProbeStore, type ProbeResult } from '../../src/models/model-probe.js';
import {
  RunStoreObservedStats,
  aggregateFacts,
  computeStats,
  type AgentCallFact,
  type ObservedStatsSource,
} from '../../src/models/observed-stats.js';

/** A mutable fake clock (this repo's FixedClock is immutable) — needed to drive the TTL cache. */
class MutableClock implements Clock {
  private _ms: number;
  constructor(startMs: number) { this._ms = startMs; }
  now(): number { return this._ms; }
  isoNow(): string { return new Date(this._ms).toISOString(); }
  advance(ms: number): void { this._ms += ms; }
}

const NOW = new Date('2026-09-30T12:00:00.000Z');

function newStore(): { store: SqliteRunStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rwe-observed-'));
  return { store: new SqliteRunStore(dir, new FixedClock(NOW)), dir };
}

function db(store: SqliteRunStore): Database.Database {
  return (store as unknown as { _db: Database.Database })._db;
}

async function mkRun(store: SqliteRunStore, principal: string, status: 'completed' | 'failed' | 'stopped'): Promise<string> {
  const runId = await store.createRun({ origin: 'local', args: {}, principal });
  await store.recordTransition(runId, 'queued', 'running', NOW.toISOString());
  await store.recordTransition(runId, 'running', status, NOW.toISOString());
  return runId;
}

/** Backdates a run's `createdAt` — the only way to seed an "older than 30 days" row (the store has
 *  no other write path for it), same raw-db convention `sqlite-run-store-usage-projection.test.ts`
 *  already uses. */
function backdateRun(store: SqliteRunStore, runId: string, iso: string): void {
  db(store).prepare('UPDATE runs SET createdAt = ? WHERE runId = ?').run(iso, runId);
}

interface CallSpec {
  agentId: string;
  provider: string;
  model: string;
  tools: string[];
  startedAt: string;
  endedAt: string;
  success: boolean;
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUSD?: number;
}

async function seedCall(store: SqliteRunStore, runId: string, spec: CallSpec): Promise<void> {
  await store.appendTranscript(runId, spec.agentId, {
    ts: spec.startedAt,
    kind: 'harness',
    data: {
      agentId: spec.agentId,
      descriptor: {
        model: spec.model, provider: spec.provider, prompt: 'p', tools: spec.tools,
        skills: [], mcpServers: [], surfaceType: spec.tools.length > 0 ? 'curated' : 'none',
      },
    },
  });
  if (spec.success) {
    await store.appendTranscript(runId, spec.agentId, {
      ts: spec.endedAt,
      kind: 'usage',
      data: { tokens: spec.tokens, provider: spec.provider, model: spec.model, costUSD: spec.costUSD, unpriced: false },
    });
  } else {
    // A failed/timed-out call: a `usage` event carrying no `tokens` (deriveAgentRecords' failed
    // branch) — model/provider come from the harness descriptor, exactly as issue #22 fixed.
    await store.appendTranscript(runId, spec.agentId, {
      ts: spec.endedAt,
      kind: 'usage',
      data: { provider: spec.provider },
    });
  }
}

describe('ObservedStats — aggregation correctness (issue #104)', () => {
  it('splits prose vs tools per ref, aggregates across principals, excludes rows >30d old and stopped runs', async () => {
    const { store, dir } = newStore();
    try {
      // Run 1 (alice, completed): one prose success + one tools success, both anthropic/claude-x.
      const r1 = await mkRun(store, 'alice', 'completed');
      await seedCall(store, r1, {
        agentId: 'a1', provider: 'anthropic', model: 'claude-x', tools: [], success: true,
        startedAt: '2026-09-29T00:00:00.000Z', endedAt: '2026-09-29T00:00:01.000Z',
        tokens: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 }, costUSD: 0.01,
      });
      await seedCall(store, r1, {
        agentId: 'a2', provider: 'anthropic', model: 'claude-x', tools: ['Read', 'Bash'], success: true,
        startedAt: '2026-09-29T00:00:02.000Z', endedAt: '2026-09-29T00:00:04.500Z',
        tokens: { input: 200, output: 80, cacheRead: 0, cacheWrite: 0 }, costUSD: 0.02,
      });

      // Run 2 (bob, completed): a FAILED prose call on the same ref, plus a tools success on a
      // second ref.
      const r2 = await mkRun(store, 'bob', 'completed');
      await seedCall(store, r2, {
        agentId: 'b1', provider: 'anthropic', model: 'claude-x', tools: [], success: false,
        startedAt: '2026-09-29T01:00:00.000Z', endedAt: '2026-09-29T01:00:03.000Z',
      });
      await seedCall(store, r2, {
        agentId: 'b2', provider: 'openrouter', model: 'openai/gpt-x', tools: ['Read'], success: true,
        startedAt: '2026-09-29T02:00:00.000Z', endedAt: '2026-09-29T02:00:01.000Z',
        tokens: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 }, costUSD: 0.005,
      });

      // Run 3 (carol, completed) but 31 days old — must be entirely excluded from the window.
      const r3 = await mkRun(store, 'carol', 'completed');
      backdateRun(store, r3, '2026-08-29T00:00:00.000Z');
      await seedCall(store, r3, {
        agentId: 'c1', provider: 'anthropic', model: 'claude-x', tools: [], success: true,
        startedAt: '2026-08-29T00:00:00.000Z', endedAt: '2026-08-29T00:00:01.000Z',
        tokens: { input: 999, output: 999, cacheRead: 0, cacheWrite: 0 }, costUSD: 9,
      });

      // Run 4 (dave, STOPPED by the user) — excluded even though it is inside the window.
      const r4 = await mkRun(store, 'dave', 'stopped');
      await seedCall(store, r4, {
        agentId: 'd1', provider: 'anthropic', model: 'claude-x', tools: [], success: true,
        startedAt: '2026-09-29T03:00:00.000Z', endedAt: '2026-09-29T03:00:01.000Z',
        tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, costUSD: 0.001,
      });

      const probeStore = new ModelProbeStore(join(dir, 'probes.db'));
      const clock = new MutableClock(NOW.getTime());
      const provider = new RunStoreObservedStats({ source: store, probes: probeStore, clock });

      const claudeX = provider.get('anthropic/claude-x');
      expect(claudeX.source).toBe('runs');
      expect(claudeX.window).toBe('30d');

      // prose bucket: a1 (success, 1000ms) + b1 (failed, 3000ms). carol (31d old) and dave (stopped)
      // excluded.
      expect(claudeX.prose).not.toBeNull();
      expect(claudeX.prose!.calls).toBe(2);
      expect(claudeX.prose!.successRate).toBe(0.5);
      expect(claudeX.prose!.latencyMsP50).toBe(1000);
      expect(claudeX.prose!.latencyMsP95).toBe(3000);
      expect(claudeX.prose!.avgInputTokens).toBe(50); // (100 + 0) / 2 — a failed call moves no counter
      expect(claudeX.prose!.avgOutputTokens).toBe(25);
      expect(claudeX.prose!.avgCacheReadTokens).toBe(5);
      expect(claudeX.prose!.avgCacheWriteTokens).toBe(2.5);
      expect(claudeX.prose!.avgCostUsdPerCall).toBe(0.005); // (0.01 + 0) / 2
      expect(claudeX.prose!.lastAt).toBe('2026-09-29T01:00:03.000Z');

      // tools bucket: a2 only.
      expect(claudeX.tools).not.toBeNull();
      expect(claudeX.tools!.calls).toBe(1);
      expect(claudeX.tools!.successRate).toBe(1);
      expect(claudeX.tools!.latencyMsP50).toBe(2500);
      expect(claudeX.tools!.avgInputTokens).toBe(200);
      expect(claudeX.tools!.avgCostUsdPerCall).toBe(0.02);

      const gptX = provider.get('openrouter/openai/gpt-x');
      expect(gptX.source).toBe('runs');
      expect(gptX.prose).toBeNull(); // no prose calls at all for this ref
      expect(gptX.tools).not.toBeNull();
      expect(gptX.tools!.calls).toBe(1);

      probeStore.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a harness-only (still in flight) or refused call contributes nothing — never dispatched or not yet settled', async () => {
    const { store, dir } = newStore();
    try {
      const r1 = await mkRun(store, 'alice', 'completed');
      // harness only, no usage — never settled.
      await store.appendTranscript(r1, 'unsettled', {
        ts: '2026-09-29T00:00:00.000Z', kind: 'harness',
        data: { agentId: 'unsettled', descriptor: { model: 'claude-y', provider: 'anthropic', prompt: 'p', tools: [], skills: [], mcpServers: [], surfaceType: 'none' } },
      });
      // a budget-refused call: no harness event at all, no model/provider.
      await store.appendTranscript(r1, 'refused', {
        ts: '2026-09-29T00:00:00.000Z', kind: 'refused', data: { reasonCode: 'BUDGET_EXCEEDED' },
      });

      const probeStore = new ModelProbeStore(join(dir, 'probes.db'));
      const clock = new MutableClock(NOW.getTime());
      const provider = new RunStoreObservedStats({ source: store, probes: probeStore, clock });
      const r = provider.get('anthropic/claude-y');
      expect(r.source).toBe('none');
      expect(r.prose).toBeNull();
      expect(r.tools).toBeNull();
      probeStore.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // dash-auth-spec.md section C (2026-09-30): the KNOWN GAP this module's own header documented —
  // `_finalizeAborted` used to stamp `provider: ''` unconditionally, which is what excluded every
  // aborted call from this aggregate (via the `!rec.model || !rec.provider` guard in `loadFacts`).
  // Now that agent-executor.ts's repair keeps the REAL provider/model on an aborted call's usage
  // event, that guard would stop excluding it — so this module needs its OWN explicit exclusion,
  // keyed on the new `failReason:'aborted'` the usage event carries, to keep the module's own
  // definition ("failure = the state a timeout/gateway error settles into") honest: a user's
  // suspend/stop says nothing about the MODEL's own reliability, so it must never move
  // `successRate` for a ref it happened to be mid-call on.
  it('an aborted call (provider now real, per the agent-executor.ts repair) is still excluded — a suspend/stop is not a model failure', async () => {
    const { store, dir } = newStore();
    try {
      const r1 = await mkRun(store, 'alice', 'completed');
      // A REAL success on the ref, so exclusion of the aborted call is observable (not just "empty").
      await seedCall(store, r1, {
        agentId: 'good', provider: 'anthropic', model: 'claude-z', tools: [], success: true,
        startedAt: '2026-09-29T00:00:00.000Z', endedAt: '2026-09-29T00:00:01.000Z',
        tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, costUSD: 0.001,
      });
      // An aborted call on the SAME ref — harness resolved a real provider/model before the abort
      // (exactly `capture()`'s failed branch's post-repair shape: the usage event's `provider` is
      // the merged value, never `''`).
      await store.appendTranscript(r1, 'aborted-1', {
        ts: '2026-09-29T00:00:02.000Z', kind: 'harness',
        data: { agentId: 'aborted-1', descriptor: { model: 'claude-z', provider: 'anthropic', prompt: 'p', tools: [], skills: [], mcpServers: [], surfaceType: 'none' } },
      });
      await store.appendTranscript(r1, 'aborted-1', {
        ts: '2026-09-29T00:00:03.000Z', kind: 'usage',
        data: { reason: 'aborted', provider: 'anthropic', detail: 'ABORTED: the run was suspended or stopped while this call was in flight' },
      });

      const probeStore = new ModelProbeStore(join(dir, 'probes.db'));
      const clock = new MutableClock(NOW.getTime());
      const provider = new RunStoreObservedStats({ source: store, probes: probeStore, clock });
      const r = provider.get('anthropic/claude-z');
      expect(r.source).toBe('runs');
      expect(r.prose).not.toBeNull();
      expect(r.prose!.calls).toBe(1); // the aborted call is NOT counted
      expect(r.prose!.successRate).toBe(1); // would be 0.5 if the aborted call counted as a failure
      probeStore.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ObservedStats — probe fallback (issue #104)', () => {
  it('falls back to the persisted models_probe latency when a ref has no run data at all', async () => {
    const { store, dir } = newStore();
    try {
      const probeStore = new ModelProbeStore(join(dir, 'probes.db'));
      const probed: ProbeResult = {
        provider: 'ollama', model: 'llama3', proseVerified: true, toolUseVerified: true,
        probedAt: '2026-09-30T00:00:00.000Z', latencyMs: { prose: 500, tools: 700 }, detail: 'ok',
      };
      probeStore.put(probed);
      const clock = new MutableClock(NOW.getTime());
      const provider = new RunStoreObservedStats({ source: store, probes: probeStore, clock });

      const r = provider.get('ollama/llama3');
      expect(r.source).toBe('probe');
      expect(r.prose).toBeNull();
      expect(r.tools).toBeNull();
      expect(r.probeLatencyMs).toBe(600); // documented: average of the probe's prose/tools legs

      // No run data AND no probe -> 'none', not a thrown error / invented number.
      const none = provider.get('ollama/never-probed');
      expect(none.source).toBe('none');
      expect(none.probeLatencyMs).toBeUndefined();

      probeStore.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('getAll() surfaces both run-observed and probe-only refs', async () => {
    const { store, dir } = newStore();
    try {
      const r1 = await mkRun(store, 'alice', 'completed');
      await seedCall(store, r1, {
        agentId: 'a1', provider: 'anthropic', model: 'claude-x', tools: [], success: true,
        startedAt: '2026-09-29T00:00:00.000Z', endedAt: '2026-09-29T00:00:01.000Z',
        tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, costUSD: 0.001,
      });
      const probeStore = new ModelProbeStore(join(dir, 'probes.db'));
      probeStore.put({ provider: 'ollama', model: 'llama3', proseVerified: true, toolUseVerified: true, probedAt: '2026-09-30T00:00:00.000Z', latencyMs: { prose: 100, tools: 200 }, detail: 'ok' });
      const clock = new MutableClock(NOW.getTime());
      const provider = new RunStoreObservedStats({ source: store, probes: probeStore, clock });

      const all = provider.getAll();
      expect(all.get('anthropic/claude-x')?.source).toBe('runs');
      expect(all.get('ollama/llama3')?.source).toBe('probe');
      probeStore.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ObservedStats — privacy (issue #104): only aggregate numbers per ref, never identifying data', () => {
  it('the served ObservedForRef never carries a runId, principal, or prompt text', async () => {
    const { store, dir } = newStore();
    try {
      const r1 = await mkRun(store, 'alice-secret-principal', 'completed');
      await seedCall(store, r1, {
        agentId: 'a1', provider: 'anthropic', model: 'claude-x', tools: [], success: true,
        startedAt: '2026-09-29T00:00:00.000Z', endedAt: '2026-09-29T00:00:01.000Z',
        tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, costUSD: 0.001,
      });
      const probeStore = new ModelProbeStore(join(dir, 'probes.db'));
      const clock = new MutableClock(NOW.getTime());
      const provider = new RunStoreObservedStats({ source: store, probes: probeStore, clock });
      const all = provider.getAll();
      const serialized = JSON.stringify([...all.entries()]);
      expect(serialized).not.toContain(r1);
      expect(serialized).not.toContain('alice-secret-principal');
      expect(serialized).not.toContain('a1');
      probeStore.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ObservedStats — TTL cache (issue #104): must not re-scan the run store on every call', () => {
  it('within the TTL window, a second get() reuses the cached aggregate (no re-read)', async () => {
    const { store, dir } = newStore();
    try {
      const r1 = await mkRun(store, 'alice', 'completed');
      await seedCall(store, r1, {
        agentId: 'a1', provider: 'anthropic', model: 'claude-x', tools: [], success: true,
        startedAt: '2026-09-29T00:00:00.000Z', endedAt: '2026-09-29T00:00:01.000Z',
        tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, costUSD: 0.001,
      });
      let calls = 0;
      const spySource: ObservedStatsSource = {
        terminalRunIdsSince: (iso) => { calls += 1; return store.terminalRunIdsSince(iso); },
        settledCallEvents: (runId) => store.settledCallEvents(runId),
      };
      const probeStore = new ModelProbeStore(join(dir, 'probes.db'));
      const clock = new MutableClock(NOW.getTime());
      const provider = new RunStoreObservedStats({ source: spySource, probes: probeStore, clock, ttlMs: 60_000 });

      provider.get('anthropic/claude-x');
      provider.get('anthropic/claude-x');
      expect(calls).toBe(1);

      clock.advance(61_000);
      provider.get('anthropic/claude-x');
      expect(calls).toBe(2);
      probeStore.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('start() warms the cache off the synchronous construction path, in the background', async () => {
    const { store, dir } = newStore();
    try {
      const r1 = await mkRun(store, 'alice', 'completed');
      await seedCall(store, r1, {
        agentId: 'a1', provider: 'anthropic', model: 'claude-x', tools: [], success: true,
        startedAt: '2026-09-29T00:00:00.000Z', endedAt: '2026-09-29T00:00:01.000Z',
        tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, costUSD: 0.001,
      });
      const probeStore = new ModelProbeStore(join(dir, 'probes.db'));
      const clock = new MutableClock(NOW.getTime());
      const provider = new RunStoreObservedStats({ source: store, probes: probeStore, clock, ttlMs: 60_000 });

      provider.start();
      // start() itself does not block — nothing is warm the instant it returns.
      // The deferred initial warm (setTimeout(…, 0)) needs one real macrotask to run.
      await new Promise((resolve) => setTimeout(resolve, 20));

      const t0 = performance.now();
      const r = provider.get('anthropic/claude-x');
      const elapsed = performance.now() - t0;
      expect(r.source).toBe('runs');
      expect(elapsed).toBeLessThan(50); // already warm — a map lookup, not a rescan

      provider.stop();
      probeStore.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ObservedStats — performance (issue #104): 10k-row aggregation stays well under budget', () => {
  it('aggregateFacts over 10,000 synthetic agent-call facts completes in well under 200ms', () => {
    const facts: AgentCallFact[] = [];
    for (let i = 0; i < 10_000; i++) {
      const ref = `anthropic/claude-${i % 50}`;
      const t0 = 1_700_000_000_000 + i * 1000;
      facts.push({
        ref, kind: i % 2 === 0 ? 'tools' : 'prose', success: i % 10 !== 0,
        startedAt: new Date(t0).toISOString(), endedAt: new Date(t0 + (i % 1000)).toISOString(),
        inputTokens: i % 100, outputTokens: i % 50, cacheReadTokens: 0, cacheWriteTokens: 0,
        costUsd: (i % 100) / 1000,
      });
    }
    const t0 = performance.now();
    const byRef = aggregateFacts(facts);
    const elapsed = performance.now() - t0;
    expect(byRef.size).toBe(50);
    expect(elapsed).toBeLessThan(200);
  });

  it('computeStats over a single bucket returns exact nearest-rank percentiles', () => {
    const mk = (ms: number): AgentCallFact => ({
      ref: 'r', kind: 'prose', success: true,
      startedAt: '2026-01-01T00:00:00.000Z', endedAt: new Date(ms).toISOString(),
      inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 1,
    });
    const base = Date.parse('2026-01-01T00:00:00.000Z');
    const facts = [100, 200, 300, 400, 500].map((ms) => mk(base + ms));
    const stats = computeStats(facts);
    expect(stats.calls).toBe(5);
    expect(stats.latencyMsP50).toBe(300); // nearest-rank: ceil(0.5*5)-1 = 2 -> sorted[2]
    expect(stats.latencyMsP95).toBe(500); // ceil(0.95*5)-1 = 4 -> sorted[4]
  });

  // The `aggregateFacts` benchmark above only times the in-memory bucketing/percentile step — the
  // step that runs on a cache HIT. It does NOT measure the expensive part: `loadFacts` reading 10k
  // real `agent-<id>.jsonl` transcript files (harness + streamed message/tool_result events + usage)
  // off a real `SqliteRunStore` — a cache MISS. Two things matter here, separately:
  //  1. How slow is a cold scan, for real, against real files? (measured below, not asserted against
  //     an arbitrary number — see the comment at that assertion for why.)
  //  2. Given that cost, does a `get()`/`getAll()` call on the request path ever have to pay it? With
  //     `start()` armed (RunStoreObservedStats' own class doc), no — the scan runs on a background
  //     tick, and a request-path call hits a warm cache (asserted below: microseconds, not ms).
  it('end-to-end against a real SqliteRunStore: 10,000 real agent transcripts, cold-scan cost measured, warm-cache reads stay O(1)', async () => {
    const { store, dir } = newStore();
    try {
      const RUNS = 200;
      const AGENTS_PER_RUN = 50; // 200 * 50 = 10,000 agent records
      for (let r = 0; r < RUNS; r++) {
        const runId = await mkRun(store, `principal-${r}`, 'completed');
        for (let a = 0; a < AGENTS_PER_RUN; a++) {
          const agentId = `agent-${a}`;
          const model = `claude-${a % 20}`;
          const tools = a % 2 === 0 ? ['Read'] : [];
          const startedAt = '2026-09-29T00:00:00.000Z';
          const endedAt = '2026-09-29T00:00:00.500Z';
          await store.appendTranscript(runId, agentId, {
            ts: startedAt, kind: 'harness',
            data: { agentId, descriptor: { model, provider: 'anthropic', prompt: 'p', tools, skills: [], mcpServers: [], surfaceType: tools.length > 0 ? 'curated' : 'none' } },
          });
          // realistic streamed noise between harness and usage — the real cost `loadFacts` pays
          // (it reads the whole file, deriveAgentRecords itself skips these two kinds).
          await store.appendTranscript(runId, agentId, { ts: startedAt, kind: 'message', data: { role: 'assistant', text: 'a realistically sized filler reply so the file is not trivially tiny for the benchmark' } });
          await store.appendTranscript(runId, agentId, { ts: startedAt, kind: 'tool_result', data: { name: 'Read', result: 'some file contents, padding padding padding padding padding' } });
          await store.appendTranscript(runId, agentId, {
            ts: endedAt, kind: 'usage',
            data: { tokens: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 }, provider: 'anthropic', model, costUSD: 0.001, unpriced: false },
          });
        }
      }

      const probeStore = new ModelProbeStore(join(dir, 'probes.db'));
      const clock = new MutableClock(NOW.getTime());
      const provider = new RunStoreObservedStats({ source: store, probes: probeStore, clock });

      // Cold path: the first call after construction, no `start()` — a real synchronous scan of
      // 10,000 real transcript files. Measured, logged, and sanity-bounded generously (real disk on
      // a loaded CI box can be slower than this repo's own dev box measured ~200-230ms at this exact
      // shape) — this is NOT the number the spec's "under 200ms" budget is about; see the class doc
      // and the warm-cache assertion right below for the number that actually is.
      const t0 = performance.now();
      const all = provider.getAll();
      const coldElapsed = performance.now() - t0;
      // eslint-disable-next-line no-console
      console.log(`[perf] cold (unwarmed) getAll() over 10,000 real agent transcripts: ${coldElapsed.toFixed(1)}ms`);
      expect(all.size).toBe(20); // 20 distinct models (a % 20)
      expect(coldElapsed).toBeLessThan(2_000); // sanity bound on the rare/background-only cold path

      // Warm path: the cache built by the call above is still fresh (default ttlMs=5min, clock
      // unmoved) — THIS is the per-`models_list`-call cost the spec's budget is actually about, and
      // it must be O(1) map lookups, not a rescan.
      const t1 = performance.now();
      const warm = provider.getAll();
      const warmElapsed = performance.now() - t1;
      expect(warm.size).toBe(20);
      expect(warmElapsed).toBeLessThan(50);
      probeStore.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
