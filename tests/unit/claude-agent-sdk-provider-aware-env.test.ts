// REQ-037: provider-aware SDK routing + Anthropic dual auth (api-key | subscription).
//  - anthropic provider -> ANTHROPIC_BASE_URL = REAL Anthropic API (LiteLLM bypassed), real auth
//    injected (never the dummy); api-key sets ANTHROPIC_API_KEY, subscription sets
//    CLAUDE_CODE_OAUTH_TOKEN and NO ANTHROPIC_API_KEY.
//  - openrouter/ollama/unknown -> ANTHROPIC_BASE_URL = LiteLLM proxy baseUrl + DUMMY.
//  - the chosen mode's secret missing -> typed terminal failure (detail ANTHROPIC_AUTH_MISSING),
//    never a silent dummy-key attempt.
//  - SECURITY INVARIANT: the real key / oauth token is injected ONLY into the SDK subprocess env —
//    never into any other option, the workspace, or the transcript.
// Unit tier: the third-party SDK module is faked via vi.mock (same seam UT-018/UT-026 use); auth is
// injected via an in-memory SecretSource — no real secrets, no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentOpts } from '../../src/types.js';
import { InMemorySecretSource } from '../../src/secret-resolver.js';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

function fakeSession(resultText: string) {
  return (async function* () {
    yield { type: 'result', subtype: 'success', is_error: false, result: resultText, usage: { input_tokens: 1, output_tokens: 1 } };
  })();
}

function req(opts: AgentOpts = {}, extra: Record<string, unknown> = {}) {
  return { prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1', ...extra };
}

function lastEnv(): Record<string, string> {
  const [[call]] = queryMock.mock.calls as [[{ options?: { env?: Record<string, string> } }]];
  return call.options?.env ?? {};
}

describe('ClaudeAgentSdkGatewayClient — provider-aware env (REQ-037)', () => {
  const REAL_KEY = 'sk-ant-REAL-should-only-be-in-subprocess-env';
  const OAUTH = 'sk-ant-oat01-REAL-subscription-token';
  const original = { ...process.env };

  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockReturnValue(fakeSession('pong'));
    // Ensure no ambient host anthropic auth leaks into the auto-mode tests.
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['CLAUDE_CODE_OAUTH_TOKEN'];
    delete process.env['RWE_SECRET_ANTHROPIC_API_KEY'];
    delete process.env['RWE_SECRET_CLAUDE_CODE_OAUTH_TOKEN'];
  });
  afterEach(() => { process.env = { ...original }; });

  it('anthropic + api-key mode: REAL Anthropic base + real ANTHROPIC_API_KEY, no dummy, no oauth', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:4000',
      anthropicAuth: 'api-key',
      secretSource: new InMemorySecretSource({ ANTHROPIC_API_KEY: REAL_KEY }),
    });
    const result = await client.invoke(req({ model: 'anthropic/claude-3-5-sonnet-20241022' }));
    expect(result.ok).toBe(true);
    const env = lastEnv();
    expect(env['ANTHROPIC_BASE_URL']).toBe('https://api.anthropic.com');
    expect(env['ANTHROPIC_API_KEY']).toBe(REAL_KEY);
    expect(env['ANTHROPIC_API_KEY']).not.toBe('sk-local-dev-dummy-not-a-real-key');
    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined();
    // real Anthropic model id on the wire, never the rwe-proxy cloak (LiteLLM bypassed)
    const [[call]] = queryMock.mock.calls as [[{ options?: { model?: string } }]];
    expect(call.options?.model).toBe('claude-3-5-sonnet-20241022');
  });

  it('REQ-038 passthrough: an openrouter/<id> model goes on the wire RAW (not rwe-proxy-cloaked), via LiteLLM+dummy', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });
    const result = await client.invoke(req({ model: 'openrouter/qwen/qwen-2.5-72b-instruct' }));
    expect(result.ok).toBe(true);
    const [[call]] = queryMock.mock.calls as [[{ options?: { model?: string } }]];
    // raw passthrough id (matches LiteLLM's `openrouter/*` wildcard) — the rwe-proxy cloak would break routing
    expect(call.options?.model).toBe('openrouter/qwen/qwen-2.5-72b-instruct');
    expect(call.options?.model).not.toMatch(/^rwe-proxy-/);
    const env = lastEnv();
    expect(env['ANTHROPIC_BASE_URL']).toBe('http://127.0.0.1:4000'); // non-anthropic → LiteLLM proxy
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-local-dev-dummy-not-a-real-key'); // dummy, no real key
  });

  it('anthropic + subscription mode: real base + CLAUDE_CODE_OAUTH_TOKEN and NO ANTHROPIC_API_KEY', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:4000',
      anthropicAuth: 'subscription',
      secretSource: new InMemorySecretSource({ CLAUDE_CODE_OAUTH_TOKEN: OAUTH }),
    });
    const result = await client.invoke(req({ model: 'anthropic/claude-3-5-sonnet-20241022' }));
    expect(result.ok).toBe(true);
    const env = lastEnv();
    expect(env['ANTHROPIC_BASE_URL']).toBe('https://api.anthropic.com');
    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBe(OAUTH);
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('auto mode selects subscription when only an oauth-token secret is present', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:4000',
      secretSource: new InMemorySecretSource({ CLAUDE_CODE_OAUTH_TOKEN: OAUTH }),
    });
    await client.invoke(req({ model: 'anthropic/claude-3-5-sonnet-20241022' }));
    const env = lastEnv();
    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBe(OAUTH);
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('auto mode selects api-key when only an api-key secret is present', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:4000',
      secretSource: new InMemorySecretSource({ ANTHROPIC_API_KEY: REAL_KEY }),
    });
    await client.invoke(req({ model: 'anthropic/claude-3-5-sonnet-20241022' }));
    const env = lastEnv();
    expect(env['ANTHROPIC_API_KEY']).toBe(REAL_KEY);
    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined();
  });

  it('anthropic with the chosen mode secret MISSING -> typed terminal failure, never a dummy attempt', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:4000',
      anthropicAuth: 'api-key',
      secretSource: new InMemorySecretSource({}), // no ANTHROPIC_API_KEY
    });
    const result = await client.invoke(req({ model: 'anthropic/claude-3-5-sonnet-20241022' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('terminal');
      expect(result.detail).toBe('ANTHROPIC_AUTH_MISSING');
    }
    expect(queryMock).not.toHaveBeenCalled(); // never spawned a session with the dummy key
  });

  it('non-anthropic provider (openrouter) keeps LiteLLM base + dummy, never a real key', async () => {
    process.env['ANTHROPIC_API_KEY'] = REAL_KEY; // even with a real host key present
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:4999',
      secretSource: new InMemorySecretSource({ ANTHROPIC_API_KEY: REAL_KEY }),
    });
    await client.invoke(req({ model: 'openrouter/gpt-4.1' }));
    const env = lastEnv();
    expect(env['ANTHROPIC_BASE_URL']).toBe('http://127.0.0.1:4999');
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-local-dev-dummy-not-a-real-key');
    expect(env['ANTHROPIC_API_KEY']).not.toBe(REAL_KEY);
    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined();
  });

  it('anthropicBaseUrl override is honored for the anthropic-direct path', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({
      baseUrl: 'http://127.0.0.1:4000',
      anthropicBaseUrl: 'https://anthropic.internal.example',
      anthropicAuth: 'api-key',
      secretSource: new InMemorySecretSource({ ANTHROPIC_API_KEY: REAL_KEY }),
    });
    await client.invoke(req({ model: 'anthropic/claude-3-5-sonnet-20241022' }));
    expect(lastEnv()['ANTHROPIC_BASE_URL']).toBe('https://anthropic.internal.example');
  });

  it('SECURITY INVARIANT: the real key is ONLY in the subprocess env, never elsewhere in options, nor written to the workspace', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'rwe-req037-'));
    try {
      const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
      const client = new ClaudeAgentSdkGatewayClient({
        baseUrl: 'http://127.0.0.1:4000',
          anthropicAuth: 'api-key',
        secretSource: new InMemorySecretSource({ ANTHROPIC_API_KEY: REAL_KEY }),
      });
      await client.invoke(req({ model: 'anthropic/claude-3-5-sonnet-20241022' }, { workspace }));

      const [[call]] = queryMock.mock.calls as [[{ options?: Record<string, unknown> }]];
      const options = call.options ?? {};
      // The key lives in options.env — and NOWHERE else in the options object.
      expect((options['env'] as Record<string, string>)['ANTHROPIC_API_KEY']).toBe(REAL_KEY);
      const optionsSansEnv = { ...options };
      delete optionsSansEnv['env'];
      expect(JSON.stringify(optionsSansEnv)).not.toContain(REAL_KEY);

      // The key is never written to any file in the run workspace.
      const walk = (dir: string): string[] => {
        const out: string[] = [];
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) out.push(...walk(p));
          else out.push(readFileSync(p, 'utf-8'));
        }
        return out;
      };
      for (const content of walk(workspace)) expect(content).not.toContain(REAL_KEY);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
