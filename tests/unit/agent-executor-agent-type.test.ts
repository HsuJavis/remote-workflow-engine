// UT-017: AgentExecutor — agentType resolution against server-side agent definitions (DES-007, D-V5).
// Fake transport / fake registry — unit tier per DES-015, mocks freely.
//
// Design note (verifier-authored extension, not yet in 04-design.md — flagged for Gate 6 to finalize):
// AgentExecutorDeps grows an optional `agentTypes?: Record<string, { systemPrompt: string }>` seam
// (server-side agent-definition registry). A known `opts.agentType` must observably apply its
// definition before dispatching to the gateway; an unknown `opts.agentType` must be a reported error
// (AgentExecutor.run() rejects), never a silent no-op and never a hang.
//
// Red reason (2026-07-03, before Gate 6 rework): `agentType` is declared on `AgentOpts` (types.ts)
// but never read anywhere in src/ — agent-executor.ts forwards `req.opts` to the gateway unexamined,
// so an unknown agentType is silently accepted (run completes normally) instead of erroring, and a
// known agentType's definition (even if a fake one is injected) has no observable effect.
import { describe, it, expect, vi } from 'vitest';
import { AgentExecutor } from '../../src/agent-executor.js';
import type { AgentExecutorDeps } from '../../src/agent-executor.js';
import type { GatewayClient, GatewayResult } from '../../src/gateway/client.js';
import type { AgentOpts } from '../../src/types.js';

function req(opts: AgentOpts = {}) {
  return {
    runId: 'run-1',
    agentId: 'agent-1',
    prompt: 'do the review',
    opts,
    workspace: '/tmp/ws',
    signal: new AbortController().signal,
  };
}

const AGENT_TYPES = { reviewer: { systemPrompt: 'You are a strict code reviewer.' } };

describe('AgentExecutor agentType resolution (UT-017, DES-007)', () => {
  it('a known agentType applies its server-side definition (observable via the fake registry)', async () => {
    const okResult: GatewayResult = { ok: true, provider: 'anthropic', model: 'claude-3', tokens: { input: 1, output: 1 }, content: 'ok' };
    const invoke = vi.fn().mockResolvedValue(okResult);
    const gw: GatewayClient = { invoke };
    const executor = new AgentExecutor({ gateway: gw, agentTypes: AGENT_TYPES } as AgentExecutorDeps & { agentTypes: typeof AGENT_TYPES });

    await executor.run(req({ agentType: 'reviewer' }));

    expect(invoke).toHaveBeenCalledTimes(1);
    const sentReq = invoke.mock.calls[0][0] as { prompt: string };
    // The resolved definition's systemPrompt must be observably applied somewhere in what's sent
    // to the gateway (today it is not — opts.agentType is forwarded unread, nothing about the
    // reviewer definition appears anywhere in the outbound request).
    expect(sentReq.prompt).toContain(AGENT_TYPES.reviewer.systemPrompt);
  });

  it('an unknown agentType is a reported error, not a silent no-op, and never hangs', async () => {
    // If AgentExecutor ever forwarded this to the gateway, this fake would hang forever —
    // proving the real implementation must fail fast at agentType resolution, before dispatch.
    const invoke = vi.fn(() => new Promise<GatewayResult>(() => {}));
    const gw: GatewayClient = { invoke };
    const executor = new AgentExecutor({ gateway: gw, agentTypes: AGENT_TYPES } as AgentExecutorDeps & { agentTypes: typeof AGENT_TYPES });

    const settled = await Promise.race([
      executor.run(req({ agentType: 'not-a-real-type' })).then((v) => ({ kind: 'resolved' as const, v })).catch((e) => ({ kind: 'rejected' as const, e })),
      new Promise<{ kind: 'timeout' }>((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 500)),
    ]);

    expect(settled.kind).not.toBe('timeout'); // never hangs
    expect(settled.kind).toBe('rejected');    // reported error (catchable/reportable), not silently accepted
    expect(invoke).not.toHaveBeenCalled();    // fails fast at agentType resolution, before any gateway dispatch
  });
});
