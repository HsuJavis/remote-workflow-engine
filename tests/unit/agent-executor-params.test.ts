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

    // InMemoryRunStore.appendTranscript drops events for a run it has never seen (run-store.ts:192),
    // so the run must exist before dispatch or the transcript reads back empty. createRun mints its
    // own id, so use the returned one rather than a literal.
    const runId = await store.createRun({ script: 'return 1;' } as Parameters<typeof store.createRun>[0]);

    await executor.run({
      runId, agentId: 'a-2', prompt: 'hi', opts: {},
      workspace: '/tmp/ws', signal: new AbortController().signal,
      runParams,
    } as Parameters<typeof executor.run>[0]);

    const events = await store.getTranscript(runId, 'a-2');
    const harnessEvent = events.find((e) => e.kind === 'harness') as { data?: { descriptor?: HarnessDescriptor & { provenance?: Record<string, string> } } } | undefined;
    expect(harnessEvent?.data?.descriptor?.provenance?.['model']).toBe('default');
  });

  // v34 (DES-228, ARCH-140, ADR-064 baseline (A), TASK-229, REQ-203/204): the `defaults.tools`
  // dispatch-time ladder this pair of cases pinned retires WHOLE with `RunParams.tools` — the tool
  // surface is now exactly per-call `allowedTools` > deployment `defaultAllowedTools` (no
  // `RunParams` rung at all), so a case asserting a `RunParams.tools` value reaches
  // `opts.allowedTools` pins a field that no longer exists (`tsc` error, not merely a red test).
  // 隨機制消失 — no successor id; the surviving two-layer claim is DES-229's guide text, not a
  // dispatch-wiring unit test (there is no third rung left to race against the other two).

  it('a caller-supplied opts.allowedTools is forwarded to the gateway unchanged (no RunParams rung to compete with, v34)', async () => {
    const gw: GatewayClient = { invoke: vi.fn().mockResolvedValue(OK_RESULT) };
    const executor = new AgentExecutor({ gateway: gw });
    const runParams: RunParams = {
      provenance: { model: 'engine', effort: 'engine', timeoutMs: 'engine', appendPrompt: 'engine' },
    };

    await executor.run({
      runId: 'r-tools-2', agentId: 'a-tools-2', prompt: 'hi', opts: { allowedTools: ['Bash'] },
      workspace: '/tmp/ws', signal: new AbortController().signal,
      runParams,
    } as Parameters<typeof executor.run>[0]);

    expect(gw.invoke).toHaveBeenCalledWith(expect.objectContaining({ opts: expect.objectContaining({ allowedTools: ['Bash'] }) }));
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

  // UT-273 (DES-226, ARCH-137, ADR-063, TASK-229, REQ-203/REQ-096): the SAME "record then throw"
  // shape as the effort guard above, at the site the `Unknown agentType` throw stands today — a
  // pre-v34 pinned script carrying `agentType` in its options literal must be refused at DISPATCH
  // (Object.hasOwn(req.opts, 'agentType')), not silently accepted. Red reason: today `agentType` is
  // resolved against `this._agentTypes` (empty here) and throws a PLAIN `Error` with no `.code` at
  // all ('Unknown agentType: reviewer') — `.rejects.toMatchObject({code:'PARAM_UNKNOWN', …})` fails
  // because `err.code` is undefined.
  it('req.opts carrying agentType (a stored pre-v34 script re-run): record a terminal failure THEN throw PARAM_UNKNOWN/AGENT_OPT_RETIRED (never a silent null via parallel())', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const appendSpy = vi.spyOn(store, 'appendTranscript');
    const gw: GatewayClient = { invoke: vi.fn().mockResolvedValue(OK_RESULT) };
    const executor = new AgentExecutor({ gateway: gw, store });
    const runParams: RunParams = { provenance: { model: 'engine', effort: 'engine', timeoutMs: 'engine', appendPrompt: 'engine' } };

    await expect(
      executor.run({
        runId: 'r-5', agentId: 'a-5', prompt: 'hi',
        opts: { agentType: 'reviewer' } as unknown as Parameters<typeof executor.run>[0]['opts'],
        workspace: '/tmp/ws', signal: new AbortController().signal,
        runParams,
      } as Parameters<typeof executor.run>[0]),
    ).rejects.toMatchObject({ code: 'PARAM_UNKNOWN', detail: { violation: 'AGENT_OPT_RETIRED', param: 'agentType' } });

    // The gateway must never have been dispatched for a call refused pre-dispatch.
    expect(gw.invoke).not.toHaveBeenCalled();
    // A terminal-failure record lands in the journal — this is what makes the refusal observable
    // through workflow_status/run_agent_log rather than a bare unswallowable throw inside parallel().
    expect(appendSpy).toHaveBeenCalled();
  });
});
