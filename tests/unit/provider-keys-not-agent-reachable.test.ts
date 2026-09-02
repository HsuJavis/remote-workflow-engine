// UT-041: provider API keys move OUT of any agent-reachable path — injected into the LiteLLM proxy
// subprocess's own env explicitly, never present in the spawned agent CLI's env/cwd, never written
// into an on-disk file the agent could reach (Gate 8 v2 review, adversarial.md finding V3 HIGH;
// binding D-V2G8-1(c)).
//
// Bug (review evidence): `src/gateway/litellm-proxy.ts`'s `_doStart()` calls
// `this._spawnImpl('litellm', [...], { stdio: 'ignore', detached: true })` with NO `env` key at all
// — there is no explicit, testable statement anywhere in this class that the proxy subprocess
// actually receives the real provider credentials it needs to route real calls. Today this only
// "works" by accident, via Node's own default child_process behavior of implicitly inheriting the
// full `process.env` when `options.env` is omitted — a seam this class's own test suite
// (litellm-proxy-hardening.test.ts) never exercises, and one that gives no place to explicitly
// EXCLUDE anything either. Meanwhile the spawned agent CLI subprocess
// (`claude-agent-sdk-client.ts`'s `buildSubprocessEnv`) must continue to see none of it (D-G8-5,
// already covered by UT-026 — re-asserted here for contrast in the SAME test file to pin the
// "proxy yes, agent no" custody split end-to-end).
//
// Mock policy (DES-015, unit tier): LiteLLMProxyManager's own pre-existing spawnImpl/fetchImpl
// injection seams (no real `litellm` binary); ClaudeAgentSdkGatewayClient's own pre-existing
// vi.mock('@anthropic-ai/claude-agent-sdk') seam (no real CLI subprocess).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events'; // a real ChildProcess IS an EventEmitter (v23 adjudication #6 V-2)
import type { ChildProcess } from 'node:child_process';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';
import type { AgentOpts } from '../../src/types.js';

const ALIASES = { default: { provider: 'anthropic' as const, model: 'claude-3-5-haiku-20241022' } };
const REAL_ANTHROPIC_KEY = 'sk-ant-REAL-secret-for-this-test-only';
const REAL_OPENAI_KEY = 'sk-openai-REAL-secret-for-this-test-only';

function makeFakeSpawn(pid: number | undefined) {
  const fakeProc = Object.assign(new EventEmitter(), { exitCode: null, kill: vi.fn(), pid }) as unknown as ChildProcess;
  return { fakeSpawn: vi.fn(() => fakeProc), fakeProc };
}

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

function okSession(): AsyncGenerator<unknown> {
  return (async function* () {
    yield {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'ok',
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  })();
}

describe('Provider API key custody: proxy receives them, the agent-facing env does not (UT-041, D-V2G8-1c)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('LiteLLMProxyManager spawns the proxy subprocess with the real provider keys explicitly present in its own env', async () => {
    process.env['ANTHROPIC_API_KEY'] = REAL_ANTHROPIC_KEY;
    process.env['OPENAI_API_KEY'] = REAL_OPENAI_KEY;

    const { fakeSpawn } = makeFakeSpawn(999);
    const fakeHealthFetch = vi.fn(async () => ({ ok: true }) as unknown as Response);
    const proxy = new LiteLLMProxyManager(ALIASES, {
      port: 48281,
      spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
      fetchImpl: fakeHealthFetch as unknown as typeof fetch,
    });

    await proxy.start();

    expect(fakeSpawn).toHaveBeenCalledTimes(1);
    const [, , spawnOpts] = fakeSpawn.mock.calls[0] as unknown as [string, string[], { env?: Record<string, string> }];
    // Forcing red today: _doStart() never sets `env` at all — this is `undefined`, not an explicit
    // statement that the proxy subprocess receives the real credentials it needs.
    expect(spawnOpts?.env?.['ANTHROPIC_API_KEY']).toBe(REAL_ANTHROPIC_KEY);
    expect(spawnOpts?.env?.['OPENAI_API_KEY']).toBe(REAL_OPENAI_KEY);
  });

  it('the SAME real keys never reach the spawned agent CLI subprocess env (custody stays split)', async () => {
    process.env['ANTHROPIC_API_KEY'] = REAL_ANTHROPIC_KEY;
    process.env['OPENAI_API_KEY'] = REAL_OPENAI_KEY;
    queryMock.mockReset();
    queryMock.mockReturnValue(okSession());

    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:48282' });
    const opts: AgentOpts = {};
    await client.invoke({ prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1' });

    const [[call]] = queryMock.mock.calls as [[{ options?: { env?: Record<string, string> } }]];
    const env = call.options?.env ?? {};
    expect(env['ANTHROPIC_API_KEY']).not.toBe(REAL_ANTHROPIC_KEY);
    expect(env['OPENAI_API_KEY']).toBeUndefined();
  });

  it('the generated litellm config.yaml never contains a raw provider key value', async () => {
    process.env['ANTHROPIC_API_KEY'] = REAL_ANTHROPIC_KEY;
    const { generateLiteLLMConfig } = await import('../../src/gateway/litellm-proxy.js');
    const yaml = generateLiteLLMConfig(ALIASES);
    expect(yaml).not.toContain(REAL_ANTHROPIC_KEY);
  });
});
