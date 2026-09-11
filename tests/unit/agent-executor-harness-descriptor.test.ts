// UT-236 (DES-195, ARCH-129, ADR-050, TASK-200, REQ-136/135): the ONE decoration site
// (`agent-executor.ts`'s `onHarness`) strips the agentType systemPrompt from the persisted
// `descriptor.prompt` and records `systemPrompt?: {agentType, bytes}` present-iff-applied — never
// the bytes themselves.
//
// Mock policy (unit): a fake GatewayClient echoes `req.prompt` back onto the descriptor exactly as
// both real gateways do (`prompt: req.prompt`, gateway/client.ts:493-508) — the fixture models the
// real contract rather than inventing a shortcut; a real InMemoryRunStore captures the persisted
// transcript (no store mock — the ONLY thing faked is the model provider network).
//
// Red reason (measured): today `_invokeOnce`'s `onHarness` decorates the descriptor with
// `effort`/`timeoutMs`/`provenance`/`label`/`phase`/`materialized` but never strips `prompt` and
// never adds `systemPrompt` — the persisted `harness` event's `descriptor.prompt` still STARTS WITH
// the agentType's systemPrompt verbatim, and `descriptor.systemPrompt` is `undefined` in every case.
import { describe, it, expect } from 'vitest';
import { AgentExecutor, type AgentTypeDef } from '../../src/agent-executor.js';
import type { GatewayClient, GatewayResult } from '../../src/gateway/client.js';
import type { HarnessDescriptor } from '../../src/types.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { defaultRunParams } from '../../src/params/resolve.js';

function echoGateway(): GatewayClient {
  return {
    invoke: async (req): Promise<GatewayResult> => {
      const descriptor: HarnessDescriptor = {
        model: 'fake-model', provider: 'fake', prompt: req.prompt, tools: [], skills: [], mcpServers: [], surfaceType: 'none',
      };
      await req.onHarness?.(descriptor);
      return { ok: true, provider: 'fake', model: 'fake-model', tokens: { input: 1, output: 1 }, content: 'ok' };
    },
  };
}

async function lastHarnessDescriptor(store: InMemoryRunStore, runId: string, agentId: string): Promise<HarnessDescriptor | undefined> {
  const transcript = await store.getTranscript(runId, agentId);
  const harnessEvents = transcript.filter((e) => e.kind === 'harness');
  const last = harnessEvents[harnessEvents.length - 1];
  return (last?.data as { descriptor?: HarnessDescriptor } | undefined)?.descriptor;
}

describe('the one decoration site strips the agentType systemPrompt (UT-236, DES-195)', () => {
  it('a known agentType with a non-empty systemPrompt: the persisted prompt does NOT start with it, and systemPrompt:{agentType,bytes} is present', async () => {
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-09-11T00:00:00.000Z')));
    const runId = await store.createRun({ name: 'r', args: {} });
    const agentTypes: Record<string, AgentTypeDef> = { researcher: { systemPrompt: 'You are a researcher.' } };
    const executor = new AgentExecutor({ gateway: echoGateway(), agentTypes, store });

    await executor.run({
      runId, agentId: 'a1', prompt: 'do the task',
      opts: { agentType: 'researcher' }, workspace: '/tmp/ut-236-ws',
      signal: new AbortController().signal, runParams: defaultRunParams(undefined),
    });

    const descriptor = await lastHarnessDescriptor(store, runId, 'a1');
    expect(descriptor?.prompt.startsWith('You are a researcher.')).toBe(false);
    expect(descriptor?.prompt.includes('do the task')).toBe(true);
    expect(descriptor?.systemPrompt).toEqual({ agentType: 'researcher', bytes: Buffer.byteLength('You are a researcher.', 'utf8') });
  });

  it('no agentType at all: systemPrompt key is ABSENT (not null, not {bytes:0})', async () => {
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-09-11T00:00:00.000Z')));
    const runId = await store.createRun({ name: 'r', args: {} });
    const executor = new AgentExecutor({ gateway: echoGateway(), store });

    await executor.run({
      runId, agentId: 'a2', prompt: 'do the task',
      opts: {}, workspace: '/tmp/ut-236-ws',
      signal: new AbortController().signal, runParams: defaultRunParams(undefined),
    });

    const descriptor = await lastHarnessDescriptor(store, runId, 'a2');
    expect('systemPrompt' in (descriptor ?? {})).toBe(false);
    expect(descriptor?.prompt).toBe('do the task');
  });

  it("an agentType whose systemPrompt is '' behaves as absent: systemPrompt key is absent", async () => {
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-09-11T00:00:00.000Z')));
    const runId = await store.createRun({ name: 'r', args: {} });
    const agentTypes: Record<string, AgentTypeDef> = { blank: { systemPrompt: '' } };
    const executor = new AgentExecutor({ gateway: echoGateway(), agentTypes, store });

    await executor.run({
      runId, agentId: 'a3', prompt: 'do the task',
      opts: { agentType: 'blank' }, workspace: '/tmp/ut-236-ws',
      signal: new AbortController().signal, runParams: defaultRunParams(undefined),
    });

    const descriptor = await lastHarnessDescriptor(store, runId, 'a3');
    expect('systemPrompt' in (descriptor ?? {})).toBe(false);
  });

  it('a stub gateway echoing a DIFFERENT prompt than it was given (mismatch): prompt is stripped to "" and one harness_prompt_prefix_mismatch line is logged', async () => {
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-09-11T00:00:00.000Z')));
    const runId = await store.createRun({ name: 'r', args: {} });
    const agentTypes: Record<string, AgentTypeDef> = { researcher: { systemPrompt: 'You are a researcher.' } };
    const mismatchGateway: GatewayClient = {
      invoke: async (req): Promise<GatewayResult> => {
        const descriptor: HarnessDescriptor = {
          model: 'fake-model', provider: 'fake', prompt: 'a completely unrelated prompt the gateway substituted',
          tools: [], skills: [], mcpServers: [], surfaceType: 'none',
        };
        await req.onHarness?.(descriptor);
        return { ok: true, provider: 'fake', model: 'fake-model', tokens: { input: 1, output: 1 }, content: 'ok' };
      },
    };
    const executor = new AgentExecutor({ gateway: mismatchGateway, agentTypes, store });
    const warnSpy: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnSpy.push(String(args[0])); };
    try {
      await executor.run({
        runId, agentId: 'a4', prompt: 'do the task',
        opts: { agentType: 'researcher' }, workspace: '/tmp/ut-236-ws',
        signal: new AbortController().signal, runParams: defaultRunParams(undefined),
      });
    } finally {
      console.warn = originalWarn;
    }
    const descriptor = await lastHarnessDescriptor(store, runId, 'a4');
    expect(descriptor?.prompt).toBe('');
    expect(warnSpy.some((l) => l.includes('harness_prompt_prefix_mismatch'))).toBe(true);
  });
});
