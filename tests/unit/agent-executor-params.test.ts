// UT-100 (DES-105, ARCH-068, TASK-101): dispatch wiring — AgentExecutor consumes req.runParams,
// decorates the harness descriptor with provenance, composes the 5-segment prompt, and
// records-then-throws on a script-supplied out-of-contract per-call knob.
//
// Mock policy (unit): fake GatewayClient (no network); fake RunStore captures appendTranscript calls.
//
// Red reason: AgentExecutor.run()/req today ignores `runParams` entirely (the field does not exist
// on AgentReq) — none of the assertions below can pass against today's code: gateway.invoke never
// sees a resolved model, descriptors never carry `provenance`, an invalid per-call effort is never
// validated or recorded. Genuine v21 red, not a syntax/import failure.
import { describe, it, expect, vi } from 'vitest';
import { AgentExecutor } from '../../src/agent-executor.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { GatewayClient, GatewayResult } from '../../src/gateway/client.js';
import type { HarnessDescriptor } from '../../src/types.js';
import type { RunParams } from '../../src/params/resolve.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

function fakeGatewayEmittingHarness(descriptor: HarnessDescriptor, result: GatewayResult): GatewayClient {
  return {
    async invoke(req) {
      await req.onHarness?.(descriptor);
      return result;
    },
  };
}

const OK_RESULT: GatewayResult = { ok: true, provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', tokens: { input: 1, output: 1 }, content: 'ok' };

describe('AgentExecutor + RunParams — required dispatch wiring (UT-100, DES-105)', () => {
  it('registered default model reaches the gateway when the per-call opts set none (REQ-092)', async () => {
    const gw: GatewayClient = { invoke: vi.fn().mockResolvedValue(OK_RESULT) };
    const executor = new AgentExecutor({ gateway: gw });
    const runParams: RunParams = {
      model: 'sonnet',
      provenance: { model: 'default', effort: 'engine', timeoutMs: 'engine', appendPrompt: 'engine' },
    };

    await executor.run({
      runId: 'r-1', agentId: 'a-1', prompt: 'hi', opts: {},
      workspace: '/tmp/ws', signal: new AbortController().signal,
      runParams,
    } as Parameters<typeof executor.run>[0]);

    expect(gw.invoke).toHaveBeenCalledWith(expect.objectContaining({ opts: expect.objectContaining({ model: 'sonnet' }) }));
  });

  it('the harness descriptor persisted to the transcript carries per-key provenance', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const descriptor: HarnessDescriptor = {
      model: 'sonnet', provider: 'anthropic', prompt: 'hi', tools: [], skills: [], mcpServers: [], surfaceType: 'none',
    };
    const gw = fakeGatewayEmittingHarness(descriptor, OK_RESULT);
    const executor = new AgentExecutor({ gateway: gw, store });
    const runParams: RunParams = {
      model: 'sonnet',
      provenance: { model: 'default', effort: 'engine', timeoutMs: 'engine', appendPrompt: 'engine' },
    };

    await executor.run({
      runId: 'r-2', agentId: 'a-2', prompt: 'hi', opts: {},
      workspace: '/tmp/ws', signal: new AbortController().signal,
      runParams,
    } as Parameters<typeof executor.run>[0]);

    const events = await store.getTranscript('r-2', 'a-2');
    const harnessEvent = events.find((e) => e.kind === 'harness') as { data?: { descriptor?: HarnessDescriptor & { provenance?: Record<string, string> } } } | undefined;
    expect(harnessEvent?.data?.descriptor?.provenance?.['model']).toBe('default');
  });

  it('appendPrompt (run override) is composed into the outbound prompt, after the script prompt', async () => {
    const gw: GatewayClient = { invoke: vi.fn().mockResolvedValue(OK_RESULT) };
    const executor = new AgentExecutor({ gateway: gw });
    const runParams: RunParams = {
      appendPrompt: 'EXTRA USER TEXT',
      provenance: { model: 'engine', effort: 'engine', timeoutMs: 'engine', appendPrompt: 'override' },
    };

    await executor.run({
      runId: 'r-3', agentId: 'a-3', prompt: 'SCRIPT PROMPT', opts: {},
      workspace: '/tmp/ws', signal: new AbortController().signal,
      runParams,
    } as Parameters<typeof executor.run>[0]);

    const [[callArg]] = (gw.invoke as ReturnType<typeof vi.fn>).mock.calls as [[{ prompt: string }]];
    const scriptIdx = callArg.prompt.indexOf('SCRIPT PROMPT');
    const appendIdx = callArg.prompt.indexOf('EXTRA USER TEXT');
    expect(scriptIdx).toBeGreaterThanOrEqual(0);
    expect(appendIdx).toBeGreaterThan(scriptIdx);
  });

  it('a script-supplied per-call effort outside low|medium|high|xhigh|max: record a terminal failure THEN throw (never a silent null via parallel())', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const appendSpy = vi.spyOn(store, 'appendTranscript');
    const gw: GatewayClient = { invoke: vi.fn().mockResolvedValue(OK_RESULT) };
    const executor = new AgentExecutor({ gateway: gw, store });
    const runParams: RunParams = { provenance: { model: 'engine', effort: 'engine', timeoutMs: 'engine', appendPrompt: 'engine' } };

    await expect(
      executor.run({
        runId: 'r-4', agentId: 'a-4', prompt: 'hi',
        opts: { effort: 'ultra-invalid' as unknown as 'low' },
        workspace: '/tmp/ws', signal: new AbortController().signal,
        runParams,
      } as Parameters<typeof executor.run>[0]),
    ).rejects.toMatchObject({ code: 'PARAM_OUT_OF_RANGE' });

    // The gateway must never have been dispatched for a call that fails pre-dispatch validation.
    expect(gw.invoke).not.toHaveBeenCalled();
    // A terminal-failure record lands in the journal (never an untyped/absent record).
    expect(appendSpy).toHaveBeenCalled();
  });
});
