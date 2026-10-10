// issue #165: per-agent config/lookup is selected by agent()'s POSITIONAL label while `opts.label`
// is display-only (`run-manager.ts:_handleAgentRequest`'s own comment), but every AgentRecord/log
// producer only ever carried the display label — so `agent('a', {label:'b'})` recorded NOTHING
// naming the 'a' contract it actually dispatched under, and collided under `label:'b'` with a
// sibling `agent('b', {...})` call (whose own `label` defaults to its positional 'b' too).
//
// This file is the DIRECT AgentExecutor/AgentTranscriptSink-level test (no sandbox/registration
// pipeline) proving `agentKey` (the positional) rides every live-record producer — markQueued,
// capture()'s done/running/failed branches, and markRefused's merge+journal — distinctly from
// `label`. The full run_agent_log/run_status end-to-end scenario lives in
// tests/integration/issue-165-agentkey-label-lookup.test.ts.
//
// Mock policy (unit): a fake GatewayClient; real AgentExecutor/AgentTranscriptSink/RunGuard.
import { describe, it, expect } from 'vitest';
import { AgentExecutor } from '../../src/agent-executor.js';
import { RunGuard } from '../../src/run-guard.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { defaultRunParams } from '../../src/params/resolve.js';

function okGateway(model: string): GatewayClient {
  return {
    invoke: async () => ({ ok: true, provider: 'fake', model, tokens: { input: 1, output: 1 }, content: 'DONE' }),
  };
}

describe('AgentRecord.agentKey — the positional label, distinct from the cosmetic display label (issue #165)', () => {
  it('a done record carries BOTH its own agentKey (positional) and its display label, even when they differ', async () => {
    const executor = new AgentExecutor({ gateway: okGateway('model-A') });
    await executor.run({
      runId: 'run-1',
      agentId: 'ag-1',
      agentKey: 'a',
      prompt: 'p',
      opts: { label: 'b' },
      workspace: '/tmp/ws',
      signal: new AbortController().signal,
      runParams: defaultRunParams(undefined),
    });
    const record = executor.getRecord('ag-1')!;
    expect(record.label).toBe('b');
    expect(record.agentKey).toBe('a');
    expect(record.model).toBe('model-A');
  });

  // The exact issue #165 repro: two calls whose DISPLAY label collides ('b' on both — one
  // explicitly, one by positional-defaulting) must still be told apart by agentKey.
  it('two agents with the SAME display label but different positionals keep distinct agentKeys', async () => {
    const executor = new AgentExecutor({ gateway: okGateway('model-A') });
    await executor.run({
      runId: 'run-1', agentId: 'ag-a', agentKey: 'a', prompt: 'p-a', opts: { label: 'b' },
      workspace: '/tmp/ws', signal: new AbortController().signal, runParams: defaultRunParams(undefined),
    });
    const executor2 = new AgentExecutor({ gateway: okGateway('model-B') });
    await executor2.run({
      runId: 'run-1', agentId: 'ag-b', agentKey: 'b', prompt: 'p-b', opts: { label: 'b' },
      workspace: '/tmp/ws', signal: new AbortController().signal, runParams: defaultRunParams(undefined),
    });
    const recA = executor.getRecord('ag-a')!;
    const recB = executor2.getRecord('ag-b')!;
    expect(recA.label).toBe('b');
    expect(recB.label).toBe('b');
    expect(recA.agentKey).toBe('a');
    expect(recB.agentKey).toBe('b');
    expect(recA.model).toBe('model-A');
    expect(recB.model).toBe('model-B');
  });

  it('markQueued stamps agentKey immediately, before any gateway dispatch', () => {
    const executor = new AgentExecutor({ gateway: okGateway('model-A') });
    executor.markQueued('ag-q', { label: 'b', agentKey: 'a' });
    const record = executor.getRecord('ag-q')!;
    expect(record.state).toBe('queued');
    expect(record.label).toBe('b');
    expect(record.agentKey).toBe('a');
  });

  it('markRefused merges onto the markQueued record, preserving agentKey', async () => {
    const guard = new RunGuard({ concurrency: 4, budget: 1000 });
    const store = undefined;
    const executor = new AgentExecutor({ gateway: okGateway('model-A'), guard, store });
    executor.markQueued('ag-r', { label: 'b', agentKey: 'a' });
    await executor.markRefused('run-1', 'ag-r', 'BUDGET_EXCEEDED', '2026-10-10T00:00:00Z');
    const record = executor.getRecord('ag-r')!;
    expect(record.state).toBe('refused');
    expect(record.label).toBe('b');
    expect(record.agentKey).toBe('a');
  });

  it('a call with no agentKey (pre-#165-shaped test fixture) never fabricates one — reads back undefined, and JSON persistence (snapshot/journal) omits the key entirely, exactly like the pre-existing `label` field on this same record-building path', async () => {
    const executor = new AgentExecutor({ gateway: okGateway('model-A') });
    await executor.run({
      runId: 'run-1', agentId: 'ag-legacy', prompt: 'p', opts: { label: 'x' },
      workspace: '/tmp/ws', signal: new AbortController().signal, runParams: defaultRunParams(undefined),
    });
    const record = executor.getRecord('ag-legacy')!;
    expect(record.agentKey).toBeUndefined();
    // Round-trip through JSON (how this record is actually persisted — run_snapshots.json /
    // the journal) — `JSON.stringify` drops an `undefined`-valued key, so no caller ever reads an
    // explicit `agentKey: undefined`/`null` back off disk.
    expect('agentKey' in JSON.parse(JSON.stringify(record))).toBe(false);
  });
});
