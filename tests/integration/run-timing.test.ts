// v8 Slice 2b — phase timeline + per-agent timing (REQ-050/051). TEST-FIRST (RED).
//
// The dashboard's "current step" + per-node duration need the run to record WHEN things happened:
//   REQ-050  each phase() entry carries the ISO ts it was entered (ordered; last-while-running = current).
//   REQ-051  each agent() record carries startedAt (dispatched) + endedAt (settled), endedAt ≥ startedAt.
//
// Mock policy (integration tier): real RunManager + real on-disk WorkflowCatalog + real sandbox child
// process/IPC/vm; only the GatewayClient is faked. An advancing clock (isoNow ticks +1s) makes the
// ordering + duration assertions meaningful and deterministic.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import type { Clock } from '../../src/clock.js';
import type { GatewayClient } from '../../src/gateway/client.js';

/** Deterministic clock whose isoNow() advances 1s per read — so recorded timestamps strictly order. */
class AdvancingClock implements Clock {
  private ms: number;
  constructor(anchor: Date) { this.ms = anchor.getTime(); }
  now(): number { return this.ms; }
  isoNow(): string { const v = new Date(this.ms).toISOString(); this.ms += 1000; return v; }
}

function echoGateway(): GatewayClient {
  return { async invoke(req) { return { ok: true, provider: 'fake', model: 'fake', tokens: { input: 1, output: 1 }, content: req.prompt }; } };
}

async function settled(mgr: RunManager, runId: string) {
  let v = await mgr.status(runId);
  for (let i = 0; i < 300 && (v.status === 'running' || v.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 25));
    v = await mgr.status(runId);
  }
  return v;
}

describe('phase timeline + per-agent timing (v8 Slice 2b, REQ-050/051)', () => {
  let workRoot: string;
  beforeEach(() => { workRoot = mkdtempSync(join(tmpdir(), 'rwe-timing-')); });
  afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it('REQ-050 records a timestamp on every phase() entry, in order', async () => {
    const clock = new AdvancingClock(new Date('2024-01-01T00:00:00Z'));
    const store = new InMemoryRunStore(clock);
    const mgr = new RunManager({ store, clock, catalog: new WorkflowCatalog(workRoot, clock), gateway: echoGateway() });

    const runId = await mgr.start({ script: `phase('draft'); const a = await agent('A', { label: 'A' }); phase('verify'); return a;` });
    const view = await settled(mgr, runId);
    expect(view.status).toBe('completed');

    const phases = view.phases as Array<{ title: string; ts?: string }>;
    expect(phases.map((p) => p.title)).toEqual(['draft', 'verify']);
    expect(phases.every((p) => typeof p.ts === 'string' && p.ts.length > 0)).toBe(true); // RED: ts absent today
    expect(phases[0]!.ts! <= phases[1]!.ts!).toBe(true); // non-decreasing (current step = last while running)
  });

  it('REQ-051 records startedAt + endedAt per agent, with endedAt ≥ startedAt', async () => {
    const clock = new AdvancingClock(new Date('2024-01-01T00:00:00Z'));
    const store = new InMemoryRunStore(clock);
    const mgr = new RunManager({ store, clock, catalog: new WorkflowCatalog(workRoot, clock), gateway: echoGateway() });

    const runId = await mgr.start({ script: `const a = await agent('A', { label: 'A' }); return a;` });
    const view = await settled(mgr, runId);
    expect(view.status).toBe('completed');

    const a = (view.agents as Array<{ label?: string; startedAt?: string; endedAt?: string }>).find((x) => x.label === 'A')!;
    expect(a).toBeDefined();
    expect(typeof a.startedAt).toBe('string'); // RED: timing fields absent today
    expect(typeof a.endedAt).toBe('string');
    expect(a.endedAt! >= a.startedAt!).toBe(true);
  });
});
