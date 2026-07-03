// IT-029: src/main.ts composeConfig() — the zero-config default gateway path is bounded by a
// hardcoded timeoutMs fallback, even when the config file sets none at all
// (Gate 8 review D-G8-4, quality-dimensions.md finding S-1, HIGH — enforces decision D-G,
// re-confirmed by the user 2026-07-03: "keep the minimal breaker in v1... so a dead/hung provider
// cannot hang a whole run").
//
// Bug (review evidence, src/main.ts:93,113): `composeConfig()` forwards
// `timeoutMs: fileConfig.timeoutMs` with NO hardcoded fallback — contrast `bind` (`?? '127.0.0.1'`)
// and `port` (`?? 8787`), which both DO have real defaults baked in. `loadFileConfig()` returns
// `{}` when `rwe.config.json` doesn't exist on disk — the ordinary "just run it" zero-config path
// this entrypoint exists to support. In that exact deployment shape, a dead/unresponsive local
// provider hangs the `agent()` call — and, because RunGuard's concurrency slot stays held for the
// duration, the whole run — indefinitely, with zero automatic recovery. The legacy path already
// gets this right (`src/server.ts:120` hardcodes `timeoutMs: config?.timeoutMs ?? 15000` for
// `LiteLLMGatewayClient`); the new D-F4 *default* SDK gateway path does not.
//
// Mock policy (DES-015, integration tier): real `composeConfig()` + real `ClaudeAgentSdkGatewayClient`
// construction; only the third-party SDK `query()` call (injected `queryImpl`) and the
// `LiteLLMProxyManager` subprocess (its own pre-existing spawnImpl/fetchImpl seams) are faked — same
// pattern as the already-established IT-021 (main-composition-root.test.ts).
//
// Red reason: `composeConfig({})` (no `timeoutMs` key at all) constructs a
// `ClaudeAgentSdkGatewayClient` with `timeoutMs: undefined` — its own `invoke()` only races a bound
// when `this._config.timeoutMs !== undefined` (src/gateway/claude-agent-sdk-client.ts:78), so a
// hung session never settles at all.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';
import type { GatewayClient } from '../../src/gateway/client.js';

// Same import-safety harness as IT-021 (main-composition-root.test.ts): src/main.ts has no
// import-guard-independent way to avoid its own auto-invoked main() side effect on import, so
// fake node:child_process.spawn to neutralize any background real litellm subprocess attempt.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(() => ({ exitCode: null, kill: vi.fn() }) as unknown as ChildProcess) };
});

const TEST_LEVEL_ESCAPE = Symbol('it-029-test-level-escape-hatch');
// Generous but finite: comfortably above any reasonable hardcoded fallback (the legacy
// LiteLLMGatewayClient path already hardcodes 15000ms — src/server.ts:120), while still bounded
// so this test fails fast and loud on an unbounded hang instead of the suite's own outer timeout.
const ESCAPE_HATCH_MS = 20000;

function makeFakeProxyManager(): LiteLLMProxyManager {
  const fakeSpawn = vi.fn(() => ({ exitCode: null, kill: vi.fn() }) as unknown as ChildProcess);
  const fakeHealthFetch = vi.fn(async () => ({ ok: true }) as unknown as Response);
  return new LiteLLMProxyManager(
    { default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' } },
    {
      spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
      fetchImpl: fakeHealthFetch as unknown as typeof fetch,
    },
  );
}

/** A session that never yields and never resolves — a genuinely hung real SDK session stand-in. */
function hungSession(): AsyncGenerator<unknown> {
  return (async function* () {
    await new Promise(() => {});
  })();
}

async function loadComposeConfig(): Promise<(fc: unknown, deps: unknown) => Promise<{ gateway?: GatewayClient }>> {
  const mod = (await import('../../src/main.js')) as Record<string, unknown>;
  return mod['composeConfig'] as (fc: unknown, deps: unknown) => Promise<{ gateway?: GatewayClient }>;
}

describe("src/main.ts composeConfig(): zero-config default gateway path has a hardcoded timeoutMs fallback (IT-029, D-G8-4)", () => {
  const originalFetch = globalThis.fetch;
  const originalExit = process.exit;
  const originalPort = process.env['RWE_PORT'];
  const originalConfigPath = process.env['RWE_CONFIG_PATH'];

  beforeAll(() => {
    // Same harness as IT-021: neutralizes main.ts's own background real main() invocation on import.
    process.env['RWE_PORT'] = '0';
    process.env['RWE_CONFIG_PATH'] = join(tmpdir(), 'rwe-it029-no-such-config.json');
    process.exit = ((_code?: number) => undefined) as unknown as typeof process.exit;
    globalThis.fetch = (async () => ({ ok: true }) as unknown as Response) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    process.exit = originalExit;
    if (originalPort === undefined) delete process.env['RWE_PORT'];
    else process.env['RWE_PORT'] = originalPort;
    if (originalConfigPath === undefined) delete process.env['RWE_CONFIG_PATH'];
    else process.env['RWE_CONFIG_PATH'] = originalConfigPath;
  });

  it('a hung provider resolves to a bounded failure (not an unbounded hang) even when the file config sets no timeoutMs at all', async () => {
    const composeConfig = await loadComposeConfig();
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-it029-'));

    // Deliberately NO `timeoutMs` key anywhere in the file config — the exact zero-config
    // ("just run it", no rwe.config.json present) shape main.ts exists to support.
    const config = await composeConfig(
      { bind: '127.0.0.1', port: 0, workRoot, gateway: 'sdk' },
      { queryImpl: () => hungSession(), proxyManager: makeFakeProxyManager() },
    );

    expect(config.gateway).toBeDefined();

    const start = Date.now();
    const result = await Promise.race([
      config.gateway!.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a1' }),
      new Promise((resolve) => setTimeout(() => resolve(TEST_LEVEL_ESCAPE), ESCAPE_HATCH_MS)),
    ]);
    const elapsed = Date.now() - start;

    // Forcing red: with no hardcoded fallback, invoke() never races anything and this resolves
    // the test-level escape hatch instead of a real bounded GatewayResult.
    expect(result).not.toBe(TEST_LEVEL_ESCAPE);
    expect((result as { ok: boolean }).ok).toBe(false);
    expect(elapsed).toBeLessThan(ESCAPE_HATCH_MS);
  }, ESCAPE_HATCH_MS + 5000);
});
