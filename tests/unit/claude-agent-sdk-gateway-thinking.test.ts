// UT-020: D-F6 route-back — SDK gateway thinking policy is alias-aware (not unconditional)
//
// D-F6 (binding): the SDK gateway sets options.thinking per the alias mapping — DISABLED by default
// for non-Anthropic-provider aliases (Ollama/OpenAI/Gemini via the LiteLLM proxy; non-reasoning
// models 400 on think:true, see 08-validation.md round-3 VAL-003 finding 1: LiteLLM forwards
// think:true to Ollama, qwen2.5:7b rejects it, every real SDK-default+Ollama agent() call fails
// after ~4 minutes of CLI-internal retry/backoff before resolving to null), SDK default preserved
// for Anthropic-provider aliases; per-alias config override allowed.
//
// This is a verifier-authored design extension to ClaudeAgentSdkGatewayConfig (a new `aliases:
// AliasMap` field — the same alias table shape LiteLLMGatewayClient already takes) — not yet in
// 04-design.md, flagged for Gate 6 to finalize, same precedent as D-V5's AgentExecutorDeps.agentTypes
// seam (UT-017) and D-F2's ServerConfig.agentDefinitionsDir.
//
// Mock policy (DES-015, unit tier): vi.mock intercepts only the third-party
// @anthropic-ai/claude-agent-sdk module (same pattern as UT-018/UT-019).
//
// Red reason: src/gateway/claude-agent-sdk-client.ts's invoke() never sets options.thinking at all
// today (confirmed by reading the source — no `thinking` key anywhere in the built Options object),
// so the first case (non-Anthropic alias -> thinking disabled) is the forcing red. The second case
// (Anthropic alias -> thinking left unset) already passes today by omission, not by any deliberate
// alias-aware decision — documented transparently as an intentional regression guard (must stay
// green once the D-F6 alias logic is wired), same precedent as IT-016's "unknown agentType still
// fails fast" sub-case (05-tests.md IT-016 note).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AliasMap } from '../../src/gateway/client.js';
import type { ClaudeAgentSdkGatewayConfig } from '../../src/gateway/claude-agent-sdk-client.js';
import { InMemorySecretSource } from '../../src/secret-resolver.js';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

function fakeSession() {
  return (async function* () {
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
  })();
}

const ALIASES: AliasMap = {
  local: { provider: 'ollama', model: 'qwen2.5:7b' },
  sonnet: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
};

describe('ClaudeAgentSdkGatewayClient thinking policy (UT-020, D-F6)', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('disables thinking for a non-Anthropic-mapped alias (Ollama, routed via the LiteLLM proxy)', async () => {
    queryMock.mockReturnValue(fakeSession());
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const config: ClaudeAgentSdkGatewayConfig & { aliases: AliasMap } = {
      baseUrl: 'http://127.0.0.1:4000',
      aliases: ALIASES,
    };
    const client = new ClaudeAgentSdkGatewayClient(config);

    await client.invoke({ prompt: 'hi', opts: { model: 'local' }, runId: 'r1', agentId: 'a1' });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [[call]] = queryMock.mock.calls as [[{ options?: { thinking?: unknown } }]];
    // Forcing red: today's src never sets options.thinking regardless of alias.
    expect(call.options?.thinking).toEqual({ type: 'disabled' });
  });

  it('preserves the SDK default (thinking left unset) for an Anthropic-mapped alias', async () => {
    queryMock.mockReturnValue(fakeSession());
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    // REQ-037: an anthropic-mapped alias now dispatches DIRECT to the real Anthropic API with real
    // auth (LiteLLM bypassed). Provide a fake api-key secret so the auth-present path reaches query()
    // and the thinking policy under test (thinking left unset for anthropic) can be asserted.
    const config: ClaudeAgentSdkGatewayConfig & { aliases: AliasMap } = {
      baseUrl: 'http://127.0.0.1:4000',
      aliases: ALIASES,
      secretSource: new InMemorySecretSource({ ANTHROPIC_API_KEY: 'fake-unit-test-key' }),
    };
    const client = new ClaudeAgentSdkGatewayClient(config);

    await client.invoke({ prompt: 'hi', opts: { model: 'sonnet' }, runId: 'r1', agentId: 'a1' });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [[call]] = queryMock.mock.calls as [[{ options?: { thinking?: unknown } }]];
    expect(call.options?.thinking).toBeUndefined();
  });

  // v21 (DES-106, ARCH-069, TASK-102) regression pin: `thinkingFor()` remains the SOLE writer of
  // options.thinking. An effort mapper introduced elsewhere must NOT re-open the D-F6 defect
  // (unconditional extended thinking -> real SDK+Ollama 400 after ~4min, Gate 7.5 round 3) by
  // assigning `options.thinking` from a second site for a non-Anthropic alias. This case already
  // passes today by omission (opts.effort is a documented no-op) — deliberately labeled a green
  // regression guard, same precedent as UT-016's "unknown agentType still fails fast" sub-case.
  it('a non-Anthropic alias at effort:"max" leaves options.thinking byte-identical to today ({type:"disabled"})', async () => {
    queryMock.mockReturnValue(fakeSession());
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const config: ClaudeAgentSdkGatewayConfig & { aliases: AliasMap } = {
      baseUrl: 'http://127.0.0.1:4000',
      aliases: ALIASES,
    };
    const client = new ClaudeAgentSdkGatewayClient(config);

    await client.invoke({ prompt: 'hi', opts: { model: 'local', effort: 'max' }, runId: 'r1', agentId: 'a1' });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [[call]] = queryMock.mock.calls as [[{ options?: { thinking?: unknown } }]];
    expect(call.options?.thinking).toEqual({ type: 'disabled' });
  });

  // v21 Gate 5 addendum (B-6, DES-106, TASK-102): the direct-fetch LiteLLMGatewayClient branch has
  // its own mapEffort coverage (tests/unit/gateway-effort.test.ts) but the SDK client's own call
  // site (claude-agent-sdk-client.ts:509/581, `(options as ...)[applied.param] = applied.value`)
  // had no covering test — DES-106/TASK-102's "parameterized over BOTH GatewayClient impls" DoD
  // was half-met. Mirrors the direct-fetch case: an Anthropic alias at effort:'low' vs effort:'max'
  // produces two captured Options objects differing at the mapped effort key.
  it('an Anthropic-mapped alias dispatched at different effort levels produces Options objects that differ at the mapped effort key (B-6, DES-106)', async () => {
    queryMock.mockReturnValue(fakeSession());
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const config: ClaudeAgentSdkGatewayConfig & { aliases: AliasMap } = {
      baseUrl: 'http://127.0.0.1:4000',
      aliases: ALIASES,
      secretSource: new InMemorySecretSource({ ANTHROPIC_API_KEY: 'fake-unit-test-key' }),
    };

    const clientLow = new ClaudeAgentSdkGatewayClient(config);
    await clientLow.invoke({ prompt: 'hi', opts: { model: 'sonnet', effort: 'low' }, runId: 'r1', agentId: 'a1' });
    const [[lowCall]] = queryMock.mock.calls as [[{ options?: Record<string, unknown> }]];

    queryMock.mockReset();
    queryMock.mockReturnValue(fakeSession());
    const clientMax = new ClaudeAgentSdkGatewayClient(config);
    await clientMax.invoke({ prompt: 'hi', opts: { model: 'sonnet', effort: 'max' }, runId: 'r1', agentId: 'a1' });
    const [[maxCall]] = queryMock.mock.calls as [[{ options?: Record<string, unknown> }]];

    expect(lowCall.options?.['effort']).toBeDefined();
    expect(lowCall.options?.['effort']).not.toEqual(maxCall.options?.['effort']);
  });

  // v21 GATE 8 RE-REVIEW #3 re-run (review 07-review.md §P2 P-A1, re-run scope (a) — SDK side):
  // transport-CONTRACT shape pin, asserted against the documented contract (a real `Options.effort`
  // top-level SDK field per `claude-agent-sdk-client.ts:581`), never against "differs from the
  // sibling call" (the B-6 case above's assertion style — the exact style the review found let
  // P-A1 through every test tier on the REST side). Companion to the REST-side shape pin in
  // `tests/unit/gateway-effort.test.ts`. Result: GREEN on write — the SDK path's placement was
  // already correct (unlike the REST path); kept as a deliberate regression pin, not force-reddened.
  it('an Anthropic-mapped alias at effort:"max" sets the documented top-level Options.effort field to the requested value (P-A1 SDK-side contract pin)', async () => {
    queryMock.mockReturnValue(fakeSession());
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const config: ClaudeAgentSdkGatewayConfig & { aliases: AliasMap } = {
      baseUrl: 'http://127.0.0.1:4000',
      aliases: ALIASES,
      secretSource: new InMemorySecretSource({ ANTHROPIC_API_KEY: 'fake-unit-test-key' }),
    };
    const client = new ClaudeAgentSdkGatewayClient(config);

    await client.invoke({ prompt: 'hi', opts: { model: 'sonnet', effort: 'max' }, runId: 'r1', agentId: 'a1' });

    const [[call]] = queryMock.mock.calls as [[{ options?: Record<string, unknown> }]];
    expect(call.options?.['effort']).toBe('max');
  });
});
