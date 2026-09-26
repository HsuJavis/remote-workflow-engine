// UT-187 (amendment, v26 integrator — DES-179, ARCH-117, REQ-126): the executor supplies the
// PINNED caps that `wireEffort` totals over.
//
// Why this file exists at all. UT-187 proves `wireEffort(provider, caps, effort)` is correct for
// every cell of its table, and it does so by CALLING `wireEffort` directly. That is the whole
// exposure: if nothing ever fills `GatewayRequest.caps`, every real dispatch reaches the gateway
// with `caps` absent, `wireEffort` reads `UNKNOWN_CAPS`, REQ-126 applies effort to nothing — and
// UT-187 stays green, because it never asked where `caps` came from. This repo has shipped that
// exact class of defect twice (`composeConfig()` wiring bugs, CLAUDE.md's standing note): a value
// computed correctly, forwarded nowhere, with the unit tests of the computation still passing.
// DES-179's signature line puts the forwarding in the EXECUTOR ("threads it from the run's pin"),
// so this is the seam that must be pinned by a test rather than by a comment.
//
// Mock policy (DES-015, unit tier): a fake GatewayClient captures the exact `GatewayRequest` it
// receives — no real network, no real SDK, no catalog fetch. The PriceBook is a hand-written
// literal (never produced by the code under test), which is what makes "the pin reached the wire"
// an observation rather than a tautology.
import { describe, it, expect } from 'vitest';
import { AgentExecutor } from '../../src/agent-executor.js';
import type { GatewayClient, GatewayResult } from '../../src/gateway/client.js';
import type { Caps, PriceBook } from '../../src/types.js';
import { defaultRunParams } from '../../src/params/resolve.js';

function okResult(): GatewayResult {
  return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'ok' };
}

const REASONING_CAPS: Caps = { reasoning: true, tools: true, source: 'upstream' };
const BOOK: PriceBook = {
  fetchedAt: '2026-09-01T00:00:00Z',
  source: 'live',
  pinned: {
    'openrouter/deepseek/deepseek-r1': { price: null, caps: REASONING_CAPS },
    'anthropic/claude-haiku-4-5-20251001': { price: null, caps: { reasoning: false, tools: true, source: 'static' } },
  },
};

/** Runs one dispatch and hands back whatever `caps` the gateway was given.
 *
 *  The model is set on `runParams`, not on `opts` — v24's ARCH-096 refuses a tunable written inside
 *  the agent() options (PARAM_IN_SCRIPT), so a call's EFFECTIVE model is the run's admission
 *  snapshot and `effectiveOpts.model` is overwritten from it. Threading caps off anything else
 *  would read a value production never sets. */
async function capsSeenByGateway(deps: Record<string, unknown>, model?: string): Promise<Caps | undefined> {
  let received: Caps | undefined;
  let sawRequest = false;
  const gateway: GatewayClient = {
    invoke: async (req) => {
      sawRequest = true;
      received = (req as { caps?: Caps }).caps;
      return okResult();
    },
  };
  const executor = new AgentExecutor({ gateway, ...deps } as ConstructorParameters<typeof AgentExecutor>[0]);
  await executor.run({
    runId: 'r1',
    agentId: 'a1',
    prompt: 'think hard',
    opts: {},
    workspace: '/tmp/ut-187-ws',
    signal: new AbortController().signal,
    runParams: { ...defaultRunParams(undefined), ...(model !== undefined ? { model } : {}) },
  });
  expect(sawRequest).toBe(true); // the dispatch really happened — an absent caps is a FINDING, not a skip
  return received;
}

// 2026-09-26 (alias mechanism removed, owner decisions 1/6): `AgentExecutorDeps` no longer carries
// an `aliases` table at all — `_pinnedCapsFor(model)` resolves the pin key straight off the full
// ref itself (`parseModelRef`, `providers.ts`), never through a name lookup. Two of the four cases
// below are rewritten onto the fail-loud successor design; none is weakened, each still proves
// DES-179's own honesty rule (an unresolvable/unpinned model leaves `caps` unset, never fabricated).
describe('the run pin reaches the wire: AgentExecutor fills GatewayRequest.caps (UT-187 amendment, DES-179)', () => {
  it("a full-ref model's pinned caps arrive at the gateway verbatim", async () => {
    expect(await capsSeenByGateway({ priceBook: BOOK }, 'openrouter/deepseek/deepseek-r1')).toEqual(REASONING_CAPS);
  });

  // The removed rule-3 "implicit `default` alias" fallback has no successor: model is REQUIRED at
  // admission (a run whose model cannot be resolved is refused before ever reaching the executor),
  // so `runParams.model` is never legitimately absent in production. AT THIS LAYER specifically
  // (called directly, bypassing admission), an absent model does not throw — `_pinnedCapsFor`
  // treats `model === undefined` the same as any other unresolvable ref: caps stays unset.
  it('a call with NO model at all leaves caps ABSENT — the implicit-default alias fallback is retired, never revived as a silent guess', async () => {
    expect(await capsSeenByGateway({ priceBook: BOOK })).toBeUndefined();
  });

  it('a malformed (non-full-ref) model value leaves caps ABSENT — never a fabricated default', async () => {
    // DES-179's honesty rule: an unresolvable model must leave `caps` unset so `wireEffort` reports
    // UNKNOWN_CAPS. Inventing `{reasoning:false}` here would silently disable effort and look
    // identical to a model that truthfully declares no reasoning.
    expect(await capsSeenByGateway({ priceBook: BOOK }, 'not-a-valid-ref')).toBeUndefined();
  });

  it('a well-formed model ref the pin never covered is ABSENT too', async () => {
    expect(await capsSeenByGateway({ priceBook: BOOK }, 'openrouter/some-vendor/not-pinned')).toBeUndefined();
  });
});
