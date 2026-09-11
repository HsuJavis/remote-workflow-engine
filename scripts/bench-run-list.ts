// scripts/bench-run-list.ts (DES-194, ADR-052, TASK-199, v27)
//
// ADR-052's measurement obligation: v27 ships `/api/runs`/`/api/home` with no `?workflow=&limit=`
// bound and no SQL aggregate — "a number rather than a hope" decides whether v28 needs one. This
// seeds N=1000 TERMINAL runs directly at the store layer (the READ path REQ-141 changed is what is
// being measured, not 1000 real `agent()` dispatches — a separate, already-measured cost), boots a
// real `createServer()` against that store (timing boot recovery — `store.hydrateAll()` at startup),
// then samples `/api/runs` and `/api/home` over real HTTP.
//
// Usage: npx tsx scripts/bench-run-list.ts
// Paste the printed block into 08-validation.md under ADR-052's own VAL row.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SqliteRunStore } from '../src/store/sqlite-run-store.js';
import { SystemClock } from '../src/clock.js';
import { createServer } from '../src/server.js';
import type { Server } from '../src/server.js';
import type { GatewayClient } from '../src/gateway/client.js';

// No real provider — this measures the READ path, never dispatches an `agent()` call, and an
// injected gateway (same convention as IT-167/usage-live-equals-fold.test.ts) keeps boot from
// depending on network/proxy readiness regardless of server.ts's own default wiring.
const NO_DISPATCH_GATEWAY: GatewayClient = {
  invoke: async () => { throw new Error('bench-run-list: no agent() call should ever be dispatched'); },
};

const N = 1000;
const SAMPLES = 30;

function percentile(sortedMs: number[], p: number): number {
  const idx = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length));
  return sortedMs[idx]!;
}

async function timeIt(fn: () => Promise<unknown>, samples: number): Promise<{ p50: number; p95: number }> {
  const durations: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    await fn();
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  return { p50: percentile(durations, 50), p95: percentile(durations, 95) };
}

async function main(): Promise<void> {
  const workRoot = mkdtempSync(join(tmpdir(), 'rwe-bench-run-list-'));
  let server: Server | undefined;
  try {
    const clock = new SystemClock();
    const seedStore = new SqliteRunStore(join(workRoot, 'store'), clock);
    for (let i = 0; i < N; i++) {
      const runId = await seedStore.createRun({ name: 'bench', args: {} });
      await seedStore.recordTransition(runId, 'running', 'completed', clock.isoNow());
    }

    const bootStart = performance.now();
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot, gateway: NO_DISPATCH_GATEWAY });
    const bootMs = performance.now() - bootStart;
    const baseUrl = `http://127.0.0.1:${server.port}`;

    const runsResult = await timeIt(async () => { await fetch(`${baseUrl}/api/runs`); }, SAMPLES);
    const homeResult = await timeIt(async () => { await fetch(`${baseUrl}/api/home`); }, SAMPLES);

    console.log(`N = ${N} terminal runs`);
    console.log(`boot recovery (one-shot, hydrateAll over ${N} rows): ${bootMs.toFixed(1)} ms`);
    console.log(`/api/runs   p50=${runsResult.p50.toFixed(1)}ms p95=${runsResult.p95.toFixed(1)}ms  (${SAMPLES} samples)`);
    console.log(`/api/home   p50=${homeResult.p50.toFixed(1)}ms p95=${homeResult.p95.toFixed(1)}ms  (${SAMPLES} samples)`);
  } finally {
    await server?.close();
    rmSync(workRoot, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
