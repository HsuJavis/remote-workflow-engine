// UT-019: D-F5 route-back — 2 real defects Gate 7.5 round 2 found in the SDK-default gateway path
// (src/gateway/claude-agent-sdk-client.ts), reproduced hermetically at unit tier (DES-015 mocks the
// third-party SDK module freely, per UT-018's own established pattern).
//
// Defect (1) opts.model alias forwarding (claude-agent-sdk-client.ts:43-51): `invoke()` never sets
// `options.model` at all, so the SDK session dispatches to whatever model id the CLI defaults to
// internally — the caller's resolved alias/model id has zero effect on which provider model the
// proxy actually routes to. Confirmed empirically (throwaway probe against a real local stub
// server + the real `claude` CLI, not shipped) that when `options.model` IS set, the outbound
// `/v1/messages` request body's own `model` field carries it verbatim — proving the fix is exactly
// "thread `req.opts.model` into `options.model`", not a CLI/SDK limitation.
//
// Defect (2) is_error response handling (claude-agent-sdk-client.ts:56-64): `invoke()` only checks
// `msg.subtype !== 'success'` to decide terminal failure. A real upstream API error (e.g. invalid
// model id, rate limit, auth failure at the proxy) is reported by the SDK's own transport as a
// `type:'result'` message that STILL carries `subtype:'success'` but with `is_error:true` and
// `result` set to the error text (confirmed empirically: a local stub returning HTTP 400 produces
// exactly `{type:'result',subtype:'success',is_error:true,result:'API Error: 400 ...'}` from the
// real CLI's own transport — see `Query.readMessages`'s own
// `e.is_error?e.subtype==="success"?e.result:...` branch bundled in the SDK package). Today's code
// falls through this shape straight to the `ok:true` return, surfacing the literal error text as if
// it were a successful agent() response — never resolving null per DES-013's null-on-terminal
// contract.
//
// Red reason: neither check exists yet in src/gateway/claude-agent-sdk-client.ts — both cases fail
// against current src (confirmed via `npx vitest run` before this file is registered in 05-tests.md).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentOpts } from '../../src/types.js';

const queryMock = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

function fakeSession(msg: Record<string, unknown>) {
  return (async function* () {
    yield msg;
  })();
}

function req(opts: AgentOpts = {}) {
  return { prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1' };
}

describe('ClaudeAgentSdkGatewayClient — D-F5 route-back defects (UT-019)', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('forwards opts.model (the resolved alias/model id) into the SDK session options.model', async () => {
    queryMock.mockReturnValue(
      fakeSession({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'pong',
        usage: { input_tokens: 3, output_tokens: 2 },
      }),
    );
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });

    await client.invoke(req({ model: 'haiku-alias' }));

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [[call]] = queryMock.mock.calls as [[{ options?: { model?: string } }]];
    // The alias is routed via its proxy-facing name (proxyModelName): a bare shorthand like `haiku`
    // would be expanded by the CLI to a dated Anthropic id the LiteLLM proxy has no entry for. The
    // prefix keeps the name verbatim so the proxy matches its own model_name.
    expect(call.options?.model).toBe('rwe-proxy-haiku-alias');
  });

  it('an is_error:true result on a subtype:"success" SDK message resolves { ok:false, reason:"terminal" }, never surfaced as success content', async () => {
    queryMock.mockReturnValue(
      fakeSession({
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: 'API Error: 400 model: haiku-alias is not a valid model ID',
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    );
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });

    const result = await client.invoke(req({ model: 'haiku-alias' }));

    // Today's implementation only checks `subtype !== 'success'`, so an is_error:true result on a
    // 'success'-shaped message falls through to `ok:true` with the raw error text as `content` —
    // this assertion is the forcing red.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('terminal');
  });
});
