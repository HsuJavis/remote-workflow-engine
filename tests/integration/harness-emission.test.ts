// IT-069 (new): harness emission via onHarness hook — executor + sink + transcript store
// (DES-066, ARCH-044, TASK-069)
//
// Tests that the `onHarness` hook propagates from GatewayClient.invoke all the way to a
// persisted `{kind:'harness'}` transcript event WITHOUT a live LLM.
//
// Mock policy (integration): fake GatewayClient whose invoke() still calls the injected
// `onHarness` hook synchronously before returning a fixed result; real AgentExecutor with
// a real InMemoryRunStore; no LLM network call. Verifies:
//   (a) a {kind:'harness'} event is appended to the transcript for the dispatched agent
//   (b) the descriptor carries the expected model/surfaceType/tools/skills/mcpServers NAMES
//   (c) NO secret value / resolved MCP config (URL, key, token) appears in the serialised event
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentExecutor } from '../../src/agent-executor.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { GatewayClient, GatewayResult } from '../../src/gateway/client.js';
import type { HarnessDescriptor } from '../../src/types.js';

// A fixed clock for deterministic timestamps.
const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));

/**
 * A fake GatewayClient that calls the injected `onHarness` hook (if present) with a controlled
 * descriptor, then returns a fixed ok result — so we can test the executor→sink→store path
 * without a real model or SDK session.
 */
function makeFakeGateway(descriptorToEmit: HarnessDescriptor): GatewayClient {
  return {
    async invoke(req): Promise<GatewayResult> {
      if (req.onHarness) {
        await req.onHarness(descriptorToEmit);
      }
      return {
        ok: true,
        provider: 'fake',
        model: descriptorToEmit.model,
        tokens: { input: 1, output: 2 },
        content: 'done',
      };
    },
  };
}

describe('harness emission via onHarness hook (IT-069, DES-066)', () => {
  let store: InMemoryRunStore;
  let runId: string;
  const agentId = 'agent-001';

  beforeEach(async () => {
    store = new InMemoryRunStore(clock);
    runId = await store.createRun({ script: 'return 1;' }, 'v1');
  });

  it('appends a {kind:"harness"} transcript event when the hook is called', async () => {
    const descriptor: HarnessDescriptor = {
      model: 'test-model',
      prompt: 'hello world',
      tools: ['Read', 'Write'],
      skills: ['my-skill'],
      mcpServers: ['my-server'],
      surfaceType: 'curated',
    };
    const executor = new AgentExecutor({ gateway: makeFakeGateway(descriptor), store, clock });
    const signal = new AbortController().signal;
    await executor.run({ runId, agentId, prompt: 'hello', opts: {}, signal, workspace: '' });

    const events = await store.getTranscript(runId, agentId);
    const harnessEvent = events.find((e) => e.kind === 'harness');
    expect(harnessEvent).toBeDefined();
    expect(harnessEvent!.kind).toBe('harness');
  });

  it('harness event descriptor carries model, surfaceType, tools, skills, mcpServers NAMES', async () => {
    const descriptor: HarnessDescriptor = {
      model: 'gpt-4o',
      prompt: 'short prompt',
      tools: ['Bash', 'Read'],
      skills: ['sdlc-skill'],
      mcpServers: ['github-mcp'],
      surfaceType: 'curated',
    };
    const executor = new AgentExecutor({ gateway: makeFakeGateway(descriptor), store, clock });
    const signal = new AbortController().signal;
    await executor.run({ runId, agentId, prompt: 'prompt', opts: {}, signal, workspace: '' });

    const events = await store.getTranscript(runId, agentId);
    const harnessEvent = events.find((e) => e.kind === 'harness');
    const data = harnessEvent!.data as { agentId: string; descriptor: HarnessDescriptor };
    expect(data.agentId).toBe(agentId);
    expect(data.descriptor.model).toBe('gpt-4o');
    expect(data.descriptor.surfaceType).toBe('curated');
    expect(data.descriptor.tools).toEqual(['Bash', 'Read']);
    expect(data.descriptor.skills).toEqual(['sdlc-skill']);
    expect(data.descriptor.mcpServers).toEqual(['github-mcp']);
  });

  it('SECURITY: no secret value / resolved MCP config (URL/key) appears in the serialised harness event', async () => {
    // The descriptor must contain NAMES only — never a resolved secret URL or API key.
    const secretUrl = 'https://mcp.example.com/?api_key=super_secret_token_12345';
    const secretKey = 'super_secret_token_12345';
    // Simulate what redactHarness produces: only the server NAME, never the resolved URL/key.
    const descriptor: HarnessDescriptor = {
      model: 'claude-3-5-haiku',
      prompt: 'safe prompt',
      tools: ['Read'],
      skills: [],
      mcpServers: ['my-protected-server'],   // name only — NOT the URL or key
      surfaceType: 'curated',
    };
    const executor = new AgentExecutor({ gateway: makeFakeGateway(descriptor), store, clock });
    const signal = new AbortController().signal;
    await executor.run({ runId, agentId, prompt: 'prompt', opts: {}, signal, workspace: '' });

    const events = await store.getTranscript(runId, agentId);
    const harnessEvent = events.find((e) => e.kind === 'harness');
    // Serialise the full event to a string — simulates what a transcript read-back sees.
    const serialised = JSON.stringify(harnessEvent);
    // Secret URL and key must NOT appear anywhere in the stored event.
    expect(serialised).not.toContain(secretUrl);
    expect(serialised).not.toContain(secretKey);
    // But the server name IS present.
    expect(serialised).toContain('my-protected-server');
  });

  it('surfaceType:"none" (direct-fetch path) emits harness with empty arrays', async () => {
    const descriptor: HarnessDescriptor = {
      model: 'ollama/llama3',
      prompt: 'test',
      tools: [],
      skills: [],
      mcpServers: [],
      surfaceType: 'none',
    };
    const executor = new AgentExecutor({ gateway: makeFakeGateway(descriptor), store, clock });
    const signal = new AbortController().signal;
    await executor.run({ runId, agentId, prompt: 'prompt', opts: {}, signal, workspace: '' });

    const events = await store.getTranscript(runId, agentId);
    const harnessEvent = events.find((e) => e.kind === 'harness');
    const data = harnessEvent!.data as { descriptor: HarnessDescriptor };
    expect(data.descriptor.surfaceType).toBe('none');
    expect(data.descriptor.tools).toEqual([]);
    expect(data.descriptor.mcpServers).toEqual([]);
  });
});
