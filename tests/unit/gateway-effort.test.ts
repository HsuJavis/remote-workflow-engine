// UT-101 (DES-106, ARCH-069, TASK-102): effort actually reaches the wire — one shared `mapEffort`
// consumed by LiteLLMGatewayClient (direct-fetch path); `thinkingFor` stays the SOLE writer of
// options.thinking for the SDK gateway (regression pin lives in claude-agent-sdk-gateway-thinking.test.ts).
//
// Mock policy (unit): fetchImpl spy intercepts the outbound HTTP call — no network, no live creds.
//
// Red reason: today's LiteLLMGatewayClient never reads req.opts.effort anywhere in callProvider() —
// a 'low' and a 'max' request produce a byte-identical body. Genuine v21 behavioral red.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { LiteLLMGatewayClient } from '../../src/gateway/client.js';
import type { GatewayConfig } from '../../src/gateway/client.js';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';

const ALIASES: GatewayConfig['aliases'] = {
  sonnet: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  local: { provider: 'ollama', model: 'qwen2.5:7b' },
};

// Same fake-proxy pattern as tests/integration/gateway-provider-down.test.ts (IT-005): the proxy's
// OWN health-check spawn/fetch are faked so proxy.start() resolves instantly with no real
// subprocess — GatewayConfig.fetchImpl (spyFetch below) is a SEPARATE injection point that captures
// the actual outbound /v1/messages call.
function makeFakeProxyManager(): LiteLLMProxyManager {
  const fakeSpawn = vi.fn(() => ({ exitCode: null, kill: vi.fn() }) as unknown as ChildProcess);
  const fakeHealthFetch = vi.fn(async () => ({ ok: true }) as unknown as Response);
  return new LiteLLMProxyManager(ALIASES, {
    spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
    fetchImpl: fakeHealthFetch as unknown as typeof fetch,
  });
}

function spyFetch(): { fetchImpl: typeof fetch; bodies: string[] } {
  const bodies: string[] = [];
  const fetchImpl = (async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body ?? ''));
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }),
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

describe('LiteLLMGatewayClient effort-on-the-wire (UT-101, DES-106)', () => {
  const ORIGINAL_KEY = process.env['ANTHROPIC_API_KEY'];
  beforeEach(() => { process.env['ANTHROPIC_API_KEY'] = 'fake-unit-test-key'; });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = ORIGINAL_KEY;
  });

  it('a provider with a reasoning dial: low vs max produce different outbound request bodies', async () => {
    const low = spyFetch();
    const gwLow = new LiteLLMGatewayClient({ aliases: ALIASES, timeoutMs: 5000, retries: 0, fetchImpl: low.fetchImpl });
    await gwLow.invoke({ prompt: 'hi', opts: { model: 'sonnet', effort: 'low' }, runId: 'r1', agentId: 'a1' });

    const max = spyFetch();
    const gwMax = new LiteLLMGatewayClient({ aliases: ALIASES, timeoutMs: 5000, retries: 0, fetchImpl: max.fetchImpl });
    await gwMax.invoke({ prompt: 'hi', opts: { model: 'sonnet', effort: 'max' }, runId: 'r1', agentId: 'a1' });

    expect(low.bodies[0]).not.toEqual(max.bodies[0]);
  });

  it('effort-absent request composition is byte-identical to a request with no effort key at all (pre-v21 regression pin)', async () => {
    const a = spyFetch();
    const gwA = new LiteLLMGatewayClient({ aliases: ALIASES, timeoutMs: 5000, retries: 0, fetchImpl: a.fetchImpl });
    await gwA.invoke({ prompt: 'hi', opts: { model: 'sonnet' }, runId: 'r1', agentId: 'a1' });

    const b = spyFetch();
    const gwB = new LiteLLMGatewayClient({ aliases: ALIASES, timeoutMs: 5000, retries: 0, fetchImpl: b.fetchImpl });
    await gwB.invoke({ prompt: 'hi', opts: { model: 'sonnet', effort: undefined }, runId: 'r1', agentId: 'a1' });

    expect(a.bodies[0]).toEqual(b.bodies[0]);
  });

  it('a provider with NO reasoning dial (ollama): the harness descriptor records effortApplied:{applied:false,reason} — no 400, no crash', async () => {
    const { fetchImpl } = spyFetch();
    const gw = new LiteLLMGatewayClient({ aliases: ALIASES, timeoutMs: 5000, retries: 0, fetchImpl });
    let captured: { effortApplied?: unknown } | undefined;
    const onHarness = async (h: unknown): Promise<void> => { captured = h as { effortApplied?: unknown }; };
    const result = await gw.invoke({ prompt: 'hi', opts: { model: 'local', effort: 'max' }, runId: 'r1', agentId: 'a1', onHarness });

    expect(result.ok).toBe(true);
    expect(captured?.effortApplied).toEqual(expect.objectContaining({ applied: false }));
  });
});

// v21 Gate 5 re-run (2026-08-31, A-7 / 04-design.md "Orchestrator adjudication — v21 Gate 6
// send-back"): `mapEffort` is called ONCE per invoke and the SAME `applied` object already flows to
// BOTH `callProvider` (direct-fetch) and `callViaLiteLLMProxy` (proxy) — only the direct-fetch
// branch has a red test pinning it today (the case above). This adds the proxy branch's own
// contract test, per DES-108's per-tier mock policy (UT tier, no network): the proxy's own
// health-check spawn/fetch are faked (makeFakeProxyManager), GatewayConfig.fetchImpl captures the
// real outbound /v1/messages body.
describe('LiteLLMGatewayClient effort-on-the-wire — LiteLLM-proxy branch (UT-101, DES-106, v21 Gate 5 re-run A-7)', () => {
  const ORIGINAL_KEY = process.env['ANTHROPIC_API_KEY'];
  beforeEach(() => { process.env['ANTHROPIC_API_KEY'] = 'fake-unit-test-key'; });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = ORIGINAL_KEY;
  });

  // Superseded (2026-09-01, review §P2 P-A1): originally asserted the value landed at the
  // top-level `effort` key — the exact placement the P-A1 shape-pin describe block below proves is
  // WRONG (a real 400 on the live API; the documented Messages contract nests it under
  // `output_config`). Corrected to the adjudicated shape so this pin doesn't contradict that block.
  it('the mapped effort value reaches the outbound request on the LiteLLM-proxy branch', async () => {
    const { fetchImpl, bodies } = spyFetch();
    const gw = new LiteLLMGatewayClient({
      aliases: ALIASES, timeoutMs: 5000, retries: 0,
      useLiteLLMProxy: true, proxyManager: makeFakeProxyManager(),
      fetchImpl,
    });
    await gw.invoke({ prompt: 'hi', opts: { model: 'sonnet', effort: 'max' }, runId: 'r1', agentId: 'a1' });

    expect(bodies).toHaveLength(1);
    const parsed = JSON.parse(bodies[0]!) as { output_config?: { effort?: string } };
    expect(parsed.output_config?.effort).toBe('max');
  });

  it('a provider with NO reasoning dial on the proxy branch: onHarness records applied:false and no effort key reaches the outbound proxy body', async () => {
    const { fetchImpl, bodies } = spyFetch();
    const gw = new LiteLLMGatewayClient({
      aliases: ALIASES, timeoutMs: 5000, retries: 0,
      useLiteLLMProxy: true, proxyManager: makeFakeProxyManager(),
      fetchImpl,
    });
    let captured: { effortApplied?: unknown } | undefined;
    const onHarness = async (h: unknown): Promise<void> => { captured = h as { effortApplied?: unknown }; };
    const result = await gw.invoke({ prompt: 'hi', opts: { model: 'local', effort: 'max' }, runId: 'r1', agentId: 'a1', onHarness });

    expect(result.ok).toBe(true);
    expect(captured?.effortApplied).toEqual(expect.objectContaining({ applied: false }));
    const parsed = JSON.parse(bodies[0]!) as Record<string, unknown>;
    expect(parsed['effort']).toBeUndefined();
  });
});

// v21 GATE 8 RE-REVIEW #3 re-run (2026-09-01, review 07-review.md §P2 P-A1, re-run scope (a)):
// transport-CONTRACT shape pin. Every prior effort test in this file asserts "the body changed" or
// "the value landed on the object under test" — never against the Anthropic Messages API's own
// documented contract. `effortBodyFields()` (client.ts:126) spreads `{effort:<value>}` TOP-LEVEL
// into the outbound JSON body on both the direct-fetch anthropic branch (client.ts:156) and the
// LiteLLM-proxy branch (client.ts:293) — the real, documented placement is nested:
// `output_config:{effort:<value>}`. An unknown top-level param is a real `400 invalid_request_error`
// on the live API while the harness descriptor already recorded `effortApplied:{applied:true,...}`
// (a false claim of success — the exact class REQ-093 exists to kill).
// Red reason: today's body has `body.effort === 'max'` and no `output_config` key at all — asserting
// the DOCUMENTED shape (`body.output_config.effort`) fails, and asserting the top-level key is ABSENT
// also fails (it's present). Genuine v21 Gate 8 re-review red.
describe('effort transport-contract shape pin — REST body must nest under output_config, never top-level (P-A1, v21 Gate 8 re-review re-run)', () => {
  const ORIGINAL_KEY = process.env['ANTHROPIC_API_KEY'];
  beforeEach(() => { process.env['ANTHROPIC_API_KEY'] = 'fake-unit-test-key'; });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = ORIGINAL_KEY;
  });

  it('direct-fetch anthropic branch: effort lands at body.output_config.effort, never at the top-level body.effort', async () => {
    const { fetchImpl, bodies } = spyFetch();
    let captured: { effortApplied?: unknown } | undefined;
    const onHarness = async (h: unknown): Promise<void> => { captured = h as { effortApplied?: unknown }; };
    const gw = new LiteLLMGatewayClient({ aliases: ALIASES, timeoutMs: 5000, retries: 0, fetchImpl });

    const result = await gw.invoke({ prompt: 'hi', opts: { model: 'sonnet', effort: 'max' }, runId: 'r1', agentId: 'a1', onHarness });

    const body = JSON.parse(bodies[0]!) as { effort?: unknown; output_config?: { effort?: unknown } };
    expect(body.effort).toBeUndefined(); // must NOT be top-level (a real 400 on the live API)
    expect(body.output_config?.effort).toBe('max'); // the documented Messages API placement
    // Descriptor honesty: applied:true must correspond to a value that genuinely reached the wire
    // at the CORRECT documented location — not merely "some field changed somewhere".
    expect(result.ok).toBe(true);
    expect(captured?.effortApplied).toEqual(expect.objectContaining({ applied: true }));
  });

  it('LiteLLM-proxy branch: effort lands at body.output_config.effort, never at the top-level body.effort', async () => {
    const { fetchImpl, bodies } = spyFetch();
    const gw = new LiteLLMGatewayClient({
      aliases: ALIASES, timeoutMs: 5000, retries: 0,
      useLiteLLMProxy: true, proxyManager: makeFakeProxyManager(),
      fetchImpl,
    });

    await gw.invoke({ prompt: 'hi', opts: { model: 'sonnet', effort: 'max' }, runId: 'r1', agentId: 'a1' });

    const body = JSON.parse(bodies[0]!) as { effort?: unknown; output_config?: { effort?: unknown } };
    expect(body.effort).toBeUndefined();
    expect(body.output_config?.effort).toBe('max');
  });
});

// v21 Gate 5 addendum Part 2 (DES-106 boundary condition — clause-coverage sweep, ADR-006): "
// session-options-builder.ts stays unwired, guarded by a standing zero-`src/`-importer assertion
// that retires when the security-hardening track wires the module deliberately." No such standing
// assertion existed anywhere in the suite — a structural (filesystem) check, not a behavioral one.
describe('session-options-builder.ts stays FENCED — zero src/ importers (ADR-006, DES-106)', () => {
  it('no file under src/ (other than the module itself) imports session-options-builder', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const srcDir = join(import.meta.dirname, '../../src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!name.endsWith('.ts') || name === 'session-options-builder.ts') continue;
        // Only an actual import/require site counts — a comment MENTIONING the filename (e.g. a
        // citation like "session-options-builder.ts:18, ADR-006") is not a wiring violation.
        if (/from ['"].*session-options-builder(\.js)?['"]|require\(['"].*session-options-builder/.test(readFileSync(p, 'utf8'))) {
          offenders.push(p);
        }
      }
    };
    walk(srcDir);
    expect(offenders).toEqual([]);
  });
});
