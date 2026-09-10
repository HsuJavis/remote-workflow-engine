// IT-164 (M-1 send-back repair, ADR-046 D-V26-projection, INV-V26-6): the direct-fetch transport's
// token projections defaulted silently over `?? 0` — a provider response with a RENAMED usage key
// (`inputTokens` instead of the documented `input_tokens`) yielded `tokens.input === 0` with
// nothing recording that a drop happened: "a run reporting it spent nothing and a budget that can
// never bind" (the review's own wording). Fixed by reusing the SAME `unmapped` → `unmappedMessages`
// wiring REQ-125's unmapped-subtype counter already reaches `run_result.meta` through — a renamed
// usage key now names itself (`usage.input_tokens`) in that counter instead of vanishing.
//
// Mock policy (integration, real adjacent components): real McpFacade + real RunManager + real
// InMemoryRunStore + real AgentExecutor + real LiteLLMGatewayClient; only `fetchImpl` (the actual
// outbound HTTP call, the third-party network) is faked, returning a body with the WRONG key name.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpFacade } from '../../src/mcp-facade.js';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { LiteLLMGatewayClient } from '../../src/gateway/client.js';
import type { GatewayConfig } from '../../src/gateway/client.js';
import { facadeCaller, runScriptVia, AUTH_DISABLED } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2026-01-01T00:00:00Z'));
const ALIASES: GatewayConfig['aliases'] = { default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' } };

const ORIGINAL_KEY = process.env['ANTHROPIC_API_KEY'];
beforeEach(() => { process.env['ANTHROPIC_API_KEY'] = 'fake-unit-test-key'; });
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env['ANTHROPIC_API_KEY'];
  else process.env['ANTHROPIC_API_KEY'] = ORIGINAL_KEY;
});

async function pollUntilSettled(facade: McpFacade, runId: string): Promise<{ status: string }> {
  let s = await facade.runStatus({ runId }, AUTH_DISABLED, false, null);
  for (let i = 0; i < 100 && (s.status === 'running' || s.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 50));
    s = await facade.runStatus({ runId }, AUTH_DISABLED, false, null);
  }
  return s;
}

describe('a renamed usage key names itself in run_result.meta.unmappedMessages, never a silent zero (IT-164, M-1 repair)', () => {
  it('tokens.input === 0 but unmappedMessages["usage.input_tokens"] >= 1 — the drop is visible, not silent', async () => {
    // The real Anthropic-Messages shape is `usage.input_tokens`/`usage.output_tokens` — this body
    // uses camelCase instead, the exact renamed-key shape the review names.
    const fetchImpl = (async () => ({
      ok: true, status: 200,
      json: async () => ({ content: [{ text: 'ok' }], usage: { inputTokens: 5, outputTokens: 3 } }),
    })) as unknown as typeof fetch;
    const gateway = new LiteLLMGatewayClient({ aliases: ALIASES, timeoutMs: 5000, retries: 0, fetchImpl });

    const store = new InMemoryRunStore(CLOCK);
    const runManager = new RunManager({ store, clock: CLOCK, gateway });
    const facade = new McpFacade({ clock: CLOCK, store, runManager, aliasNames: new Set(Object.keys(ALIASES)) });

    const run = await runScriptVia(facadeCaller(facade), `const a = await agent('x', {}); return a;`);
    const runId = run.result!.runId;
    const status = await pollUntilSettled(facade, runId);
    expect(status.status).toBe('completed');

    const result = await facade.runResult({ runId }, AUTH_DISABLED, false, null);
    const meta = result.meta as { usage: { tokens: { input: number; output: number }; unmappedMessages: Record<string, number> } };

    // NOT gating on tokens {0,0,0,0} — that silent shape is exactly what this repair makes visible.
    expect(meta.usage.tokens.input).toBe(0);
    expect(meta.usage.tokens.output).toBe(0);
    expect(meta.usage.unmappedMessages['usage.input_tokens']).toBeGreaterThanOrEqual(1);
    expect(meta.usage.unmappedMessages['usage.output_tokens']).toBeGreaterThanOrEqual(1);
  }, 15000);

  it('a healthy response with the documented key names — no gap counted at all', async () => {
    const fetchImpl = (async () => ({
      ok: true, status: 200,
      json: async () => ({ content: [{ text: 'ok' }], usage: { input_tokens: 5, output_tokens: 3 } }),
    })) as unknown as typeof fetch;
    const gateway = new LiteLLMGatewayClient({ aliases: ALIASES, timeoutMs: 5000, retries: 0, fetchImpl });

    const store = new InMemoryRunStore(CLOCK);
    const runManager = new RunManager({ store, clock: CLOCK, gateway });
    const facade = new McpFacade({ clock: CLOCK, store, runManager, aliasNames: new Set(Object.keys(ALIASES)) });

    const run = await runScriptVia(facadeCaller(facade), `const a = await agent('x', {}); return a;`);
    const runId = run.result!.runId;
    const status = await pollUntilSettled(facade, runId);
    expect(status.status).toBe('completed');

    const result = await facade.runResult({ runId }, AUTH_DISABLED, false, null);
    const meta = result.meta as { usage: { tokens: { input: number; output: number }; unmappedMessages: Record<string, number> } };
    expect(meta.usage.tokens.input).toBe(5);
    expect(meta.usage.tokens.output).toBe(3);
    expect(meta.usage.unmappedMessages).toEqual({});
  }, 15000);
});
