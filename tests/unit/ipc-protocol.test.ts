// UT-006: IPC message protocol — discriminated union shape + callSeq correlation (DES-006)
import { describe, it, expect } from 'vitest';
import type { ChildMsg, ParentMsg } from '../../src/ipc/protocol.js';
import type { SandboxHostConfig } from '../../src/sandbox/host.js';

// These tests verify the TYPE CONTRACT of the IPC protocol.
// They check that a message handler can discriminate by `t` and that callSeq
// correlates correctly in a simulated round-trip.

describe('IPC protocol types', () => {
  it('ChildMsg "agent" carries runId, callSeq, prompt, opts', () => {
    const msg: ChildMsg = { t: 'agent', runId: 'run-1', callSeq: 0, prompt: 'do X', opts: {} };
    expect(msg.t).toBe('agent');
    expect(msg.callSeq).toBe(0);
    expect(msg.prompt).toBe('do X');
  });

  it('ChildMsg "done" carries result', () => {
    const msg: ChildMsg = { t: 'done', runId: 'run-1', result: { answer: 42 } };
    expect(msg.t).toBe('done');
    expect((msg as Extract<ChildMsg, { t: 'done' }>).result).toEqual({ answer: 42 });
  });

  it('ParentMsg "agentResult" with null value represents null-semantics (agent resolved null)', () => {
    const msg: ParentMsg = { t: 'agentResult', callSeq: 0, value: null };
    expect(msg.t).toBe('agentResult');
    expect((msg as Extract<ParentMsg, { t: 'agentResult' }>).value).toBeNull();
  });

  it('ParentMsg "agentThrow" carries error code for budget/nesting/unknown-name', () => {
    const msg: ParentMsg = { t: 'agentThrow', callSeq: 3, error: { code: 'BUDGET_EXCEEDED', message: 'over limit' } };
    const m = msg as Extract<ParentMsg, { t: 'agentThrow' }>;
    expect(m.callSeq).toBe(3);
    expect(m.error.code).toBe('BUDGET_EXCEEDED');
  });

  it('ParentMsg "abort" carries reason suspend or stop', () => {
    const suspend: ParentMsg = { t: 'abort', reason: 'suspend' };
    const stop: ParentMsg = { t: 'abort', reason: 'stop' };
    expect((suspend as Extract<ParentMsg, { t: 'abort' }>).reason).toBe('suspend');
    expect((stop as Extract<ParentMsg, { t: 'abort' }>).reason).toBe('stop');
  });

  // UT-229 (M-6 send-back repair, ARCH-118): TYPE-LEVEL pin — `ParentMsg`'s declared
  // `agentResult.spent` must accept, with NO cast, exactly what `SandboxHostConfig.onBudgetSnapshot`
  // (host.ts's own send-site type) returns. Before this repair `spent?: number` while
  // `onBudgetSnapshot` returned `{usd:number; tokens:Tokens}` — this line would not COMPILE (a real
  // `tsc` red), because neither `host.ts` nor `child-entry.ts` is typed against `ParentMsg` at all,
  // so no other test could ever falsify the drift.
  it('agentResult.spent accepts exactly what SandboxHostConfig.onBudgetSnapshot returns, with no cast', () => {
    type Snapshot = ReturnType<NonNullable<SandboxHostConfig['onBudgetSnapshot']>>;
    const snapshot: Snapshot = { usd: 1.5, tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } };
    const msg: ParentMsg = { t: 'agentResult', callSeq: 0, value: null, spent: snapshot };
    expect((msg as Extract<ParentMsg, { t: 'agentResult' }>).spent).toEqual(snapshot);
  });

  it('callSeq from agent request matches the callSeq in parent reply', () => {
    // Simulate a correlation table (what the real implementation will maintain)
    const pending = new Map<number, (v: unknown) => void>();
    let resolved: unknown;

    const seq = 7;
    pending.set(seq, (v) => { resolved = v; });

    // Parent sends reply with same callSeq
    const reply: ParentMsg = { t: 'agentResult', callSeq: seq, value: 'the-result' };
    const handler = pending.get((reply as Extract<ParentMsg, { t: 'agentResult' }>).callSeq);
    expect(handler).toBeDefined();
    handler!((reply as Extract<ParentMsg, { t: 'agentResult' }>).value);
    expect(resolved).toBe('the-result');
  });
});
