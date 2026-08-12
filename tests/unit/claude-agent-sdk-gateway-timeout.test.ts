// UT-021: D-F7 route-back — SDK gateway invoke() honors a configured timeoutMs/retries bound
//
// D-F7 (binding): ClaudeAgentSdkGatewayClient.invoke() must honor configured timeoutMs/retries with
// an AbortController race exactly like LiteLLMGatewayClient (REQ-004's 4th acceptance clause; D-G
// breaker must bind on the DEFAULT path). 08-validation.md round-3 VAL-003 finding 2 / VAL-004:
// unlike LiteLLMGatewayClient (client.ts's callProvider/callViaLiteLLMProxy, each with a real
// AbortController tied to timeoutMs), ClaudeAgentSdkGatewayClient.invoke() just `for await`s the
// session's own async generator to its natural end with no timer/race of its own — a hung/stuck
// session runs unbounded, governed entirely by the SDK CLI's own internal retry/backoff policy, not
// the product's own configured bound.
//
// This is a verifier-authored design extension to ClaudeAgentSdkGatewayConfig (timeoutMs?/retries?,
// mirroring GatewayConfig's own fields) — not yet in 04-design.md, flagged for Gate 6 to finalize,
// same precedent as D-V5/D-F6 (UT-020).
//
// Mock policy (DES-015, unit tier): the already-existing injected queryImpl seam (used by
// UT-018/UT-019) stands in for a genuinely stuck real SDK session — no real process/network involved.
//
// Red reason: invoke() has no bounded race of its own today — confirmed by reading the source (the
// `for await (const msg of session)` loop has no timer/AbortController anywhere near it). A hung
// session therefore never lets invoke() settle at all.
import { describe, it, expect } from 'vitest';
import type { ClaudeAgentSdkGatewayConfig } from '../../src/gateway/claude-agent-sdk-client.js';

/** A session that never yields and never returns — models a genuinely hung/stuck real SDK session
 *  (e.g. the CLI subprocess never responding). Uses no timer of its own, so it leaves no dangling
 *  Node handle after the test — just an unresolved promise, safely garbage-collected. */
function hungSession(): AsyncGenerator<unknown> {
  return (async function* () {
    await new Promise(() => {}); // never resolves — generator never gets past its first await
  })();
}

// A sentinel distinguishable from any real GatewayResult, used only to bound THIS TEST's own wall
// time (not a claim about src's own timeout behavior) so an unbounded invoke() fails fast and
// clearly instead of hanging the suite until vitest's global testTimeout.
const TEST_LEVEL_BOUND = Symbol('ut-021-test-level-bound');

describe('ClaudeAgentSdkGatewayClient bounded timeout/retry race (UT-021, D-F7)', () => {
  it('a hung session resolves ok:false within the configured timeoutMs — never hangs unbounded', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    let calls = 0;
    const config: ClaudeAgentSdkGatewayConfig & { timeoutMs: number; retries: number } = {
      baseUrl: 'http://127.0.0.1:1',
      queryImpl: (() => {
        calls += 1;
        return hungSession();
      }) as never,
      timeoutMs: 200,
      retries: 1,
    };
    const client = new ClaudeAgentSdkGatewayClient(config);

    const start = Date.now();
    const result = await Promise.race([
      client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1' }),
      new Promise((resolve) => setTimeout(() => resolve(TEST_LEVEL_BOUND), 3000)),
    ]);
    const elapsed = Date.now() - start;

    // Forcing red: today's invoke() never settles at all against a hung session, so this resolves
    // to the test-level escape-hatch sentinel instead of a real GatewayResult.
    expect(result).not.toBe(TEST_LEVEL_BOUND);
    expect((result as { ok: boolean }).ok).toBe(false);
    // Bounded by the CONFIGURED 200ms timeout (+ 1 retry) + slack — not the 3s test-level escape hatch.
    expect(elapsed).toBeLessThan(1500);
    // retries:1 => 1 initial attempt + 1 retry = exactly 2 session constructions.
    expect(calls).toBe(2);
  }, 10000);

  // issue #24/#22: a per-call AgentOpts.timeoutMs overrides the gateway's configured default.
  it('opts.timeoutMs shrinks the bound below a large configured default', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const config = { baseUrl: 'http://127.0.0.1:1', queryImpl: (() => hungSession()) as never, timeoutMs: 60000, retries: 0 };
    const client = new ClaudeAgentSdkGatewayClient(config as never);
    const start = Date.now();
    const result = await Promise.race([
      client.invoke({ prompt: 'hi', opts: { timeoutMs: 150 }, runId: 'r', agentId: 'a' }),
      new Promise((resolve) => setTimeout(() => resolve(TEST_LEVEL_BOUND), 3000)),
    ]);
    expect(result).not.toBe(TEST_LEVEL_BOUND);
    expect((result as { ok: boolean }).ok).toBe(false);
    expect(Date.now() - start).toBeLessThan(1500); // bounded by opts 150ms, NOT the 60s config
  }, 10000);

  it('opts.timeoutMs bounds a config-LESS gateway (permutation: no configured default + per-call set)', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    let calls = 0;
    // No timeoutMs in config → legacy unbounded path. A per-call opts.timeoutMs must still bound it,
    // AND invoke()'s attempts calc must agree (1 + retries), or a bounded timer pairs with attempts=1.
    const config = { baseUrl: 'http://127.0.0.1:1', queryImpl: (() => { calls += 1; return hungSession(); }) as never, retries: 1 };
    const client = new ClaudeAgentSdkGatewayClient(config as never);
    const result = await Promise.race([
      client.invoke({ prompt: 'hi', opts: { timeoutMs: 150 }, runId: 'r', agentId: 'a' }),
      new Promise((resolve) => setTimeout(() => resolve(TEST_LEVEL_BOUND), 3000)),
    ]);
    expect(result).not.toBe(TEST_LEVEL_BOUND); // NOT the unbounded-hang escape hatch
    expect((result as { ok: boolean }).ok).toBe(false);
    expect(calls).toBe(2); // per-call timeout enabled the 1+retries attempt count
  }, 10000);

  it('an invalid opts.timeoutMs falls back to the configured default (never disables the bound)', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const config = { baseUrl: 'http://127.0.0.1:1', queryImpl: (() => hungSession()) as never, timeoutMs: 200, retries: 0 };
    const client = new ClaudeAgentSdkGatewayClient(config as never);
    const result = await Promise.race([
      client.invoke({ prompt: 'hi', opts: { timeoutMs: -1 }, runId: 'r', agentId: 'a' }), // invalid → ignored
      new Promise((resolve) => setTimeout(() => resolve(TEST_LEVEL_BOUND), 3000)),
    ]);
    expect(result).not.toBe(TEST_LEVEL_BOUND);
    expect((result as { ok: boolean }).ok).toBe(false); // still bounded by config 200ms
  }, 10000);
});
