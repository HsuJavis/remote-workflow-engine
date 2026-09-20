// IT-021: D-F10(a) route-back — composition-root wiring-completeness for src/main.ts, the product's
// real entrypoint (retro L-003).
//
// Gate 7.5 round 4 (08-validation.md, state.yaml pending[]) found 3 real composition-root defects, ALL
// in src/main.ts, none caught by any of the prior 5 route-backs' tests because NOTHING ever
// constructed the server the way main.ts itself does — every existing test drives `createServer()`
// directly with a hand-built `ServerConfig`, bypassing main.ts's own `FileConfig` -> `ServerConfig`
// translation entirely. STRUCTURAL RULE (ORCH D-F10, binding): a composition-root test must boot via
// main.ts itself, or an exported composition helper main.ts trivially delegates to, so this class of
// gap is catchable at unit/integration tier from now on, not only by a 45-minute real-run validation
// round.
//
// Intended contract (verifier-authored, not yet in 04-design.md — flagged for Gate 6 to finalize,
// same precedent as D-F6/D-F7/UT-020/UT-021): src/main.ts should export
//   async function composeConfig(
//     fileConfig: FileConfig,
//     deps?: { queryImpl?: <the ClaudeAgentSdkGatewayConfig queryImpl type>; proxyManager?: LiteLLMProxyManager },
//   ): Promise<ServerConfig>
// — the exact translation `main()` performs today inline (bind/port/workRoot/aliases/timeoutMs/
// retries/agentDefinitionsDir -> ServerConfig, plus gateway selection: 'sdk' constructs a real
// ClaudeAgentSdkGatewayClient wired with aliases/timeoutMs/retries, 'direct-fetch' leaves
// `config.gateway` unset so createServer()'s own aliases-driven LiteLLMGatewayClient construction
// applies) — with `main()` itself reduced to `const config = await composeConfig(loadFileConfig(),
// {}); const server = await createServer(config);`. The optional `deps` parameter is a NEW test seam
// (no existing FileConfig field can carry a function value, since FileConfig is JSON-parsed) mirroring
// this codebase's existing injectable-seam convention (ServerConfig.proxyManager,
// ClaudeAgentSdkGatewayConfig.queryImpl) — `main()`'s own real call site simply omits it.
//
// Mock policy (DES-015, integration tier): real ServerConfig-building logic + a real
// ClaudeAgentSdkGatewayClient constructed by it; only the third-party SDK `query()` call (via the
// injected `queryImpl` deps seam) and the LiteLLMProxyManager subprocess (via its own pre-existing
// spawnImpl/fetchImpl seams, same fake as claude-agent-sdk-gateway-timeout.test.ts /
// gateway-provider-down.test.ts) are faked — no real litellm/Python/network involved.
//
// Red reason: `src/main.ts` does not export `composeConfig` today (confirmed by reading the file —
// `main()` is the sole, unexported, side-effecting entry). `typeof composeConfig === 'function'` is
// therefore the forcing red for every case below; a genuine wiring gap would instead surface as one of
// the later assertions failing (e.g. `elapsed` not bounded by the configured `timeoutMs`, or
// `agentDefinitionsDir` absent from the returned config) once the export exists but the fields still
// aren't threaded through — this file is written so it stays meaningful (not vacuous) at BOTH stages.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'node:events'; // a real ChildProcess IS an EventEmitter — the fake must be too (v23 adjudication #6 V-2)
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';
import type { AliasMap, GatewayClient } from '../../src/gateway/client.js';

// Defensive import-safety harness (NOT part of the wiring assertions themselves): today,
// `src/main.ts` has no import-guard at all — its bottom-of-file `main().catch(...)` runs for real
// the instant the module is evaluated, regardless of why it was imported. Merely `import()`ing the
// module to check for a `composeConfig` export would otherwise spawn a real `litellm` subprocess
// attempt and bind a real HTTP port in the background. Until main.ts gates that auto-invocation
// (e.g. `if (isEntryPoint) main().catch(...)` — itself a necessary companion of exporting
// `composeConfig`, since a composition helper is pointless if importing the module always re-runs
// the whole program), this harness neutralizes that side effect so THIS TEST FILE stays hermetic:
// fakes `node:child_process.spawn` (same shape as the rest of this suite's fake proxy managers) and
// makes the health-check `fetch` resolve immediately, so the background real `main()` invocation
// settles fast into a harmless ephemeral-port server instead of hanging ~20s or crashing on ENOENT.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(() => (Object.assign(new EventEmitter(), { exitCode: null, kill: vi.fn() })) as unknown as ChildProcess) };
});

const ALIASES: AliasMap = {
  default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  local: { provider: 'ollama', model: 'qwen2.5:7b' },
};

const TEST_LEVEL_BOUND = Symbol('it-021-test-level-bound');

/** Same fake-proxy pattern as claude-agent-sdk-gateway-timeout.test.ts / gateway-provider-down.test.ts
 *  — proxy.start() resolves instantly, no real `litellm` subprocess. */
function makeFakeProxyManager(): LiteLLMProxyManager {
  const fakeSpawn = vi.fn(() => (Object.assign(new EventEmitter(), { exitCode: null, kill: vi.fn() })) as unknown as ChildProcess);
  const fakeHealthFetch = vi.fn(async () => ({ ok: true }) as unknown as Response);
  return new LiteLLMProxyManager(ALIASES, {
    spawnImpl: fakeSpawn as unknown as typeof import('node:child_process').spawn,
    fetchImpl: fakeHealthFetch as unknown as typeof fetch,
  });
}

/** A session that never yields and never returns — a genuinely hung real SDK session stand-in
 *  (same convention as UT-021/UT-022). */
function hungSession(): AsyncGenerator<unknown> {
  return (async function* () {
    await new Promise(() => {});
  })();
}

function fakeSuccessSession(): AsyncGenerator<unknown> {
  return (async function* () {
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
  })();
}

async function loadComposeConfig(): Promise<unknown> {
  const mod = (await import('../../src/main.js')) as Record<string, unknown>;
  return mod['composeConfig'];
}

describe('src/main.ts composition-root wiring-completeness (IT-021, D-F10a/b)', () => {
  const originalFetch = globalThis.fetch;
  const originalExit = process.exit;
  const originalPort = process.env['RWE_PORT'];
  const originalConfigPath = process.env['RWE_CONFIG_PATH'];

  beforeAll(() => {
    // Part of the same import-safety harness (see top-of-file note): an ephemeral port so the
    // background real main() never fights over the real default 8787; a no-op process.exit so a
    // background startup failure can never tear down this test worker; a config path that's
    // guaranteed not to exist so loadFileConfig() falls back to {} deterministically; and an
    // instantly-ok health-check fetch so the background proxy.start() settles in milliseconds
    // instead of a real ~20s startupTimeoutMs poll loop.
    process.env['RWE_PORT'] = '0';
    process.env['RWE_CONFIG_PATH'] = join(tmpdir(), 'rwe-it021-no-such-config.json');
    process.exit = ((code?: number) => undefined) as unknown as typeof process.exit;
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

  it("gateway:'sdk' — aliases + timeoutMs + retries reach the constructed ClaudeAgentSdkGatewayClient", async () => {
    const composeConfig = await loadComposeConfig();
    // Forcing red today: main.ts exports no such helper at all.
    expect(typeof composeConfig).toBe('function');

    let queryCalls = 0;
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-it021-'));
    const config = await (composeConfig as (fc: unknown, deps: unknown) => Promise<{ gateway?: GatewayClient; agentDefinitionsDir?: string }>)(
      {
        bind: '127.0.0.1',
        port: 0,
        workRoot,
        aliases: ALIASES,
        timeoutMs: 150,
        retries: 1,
        gateway: 'sdk',
      },
      {
        queryImpl: () => {
          queryCalls += 1;
          return hungSession();
        },
        proxyManager: makeFakeProxyManager(),
      },
    );

    expect(config.gateway).toBeInstanceOf(ClaudeAgentSdkGatewayClient);

    const start = Date.now();
    const result = await Promise.race([
      config.gateway!.invoke({ prompt: 'hi', opts: { model: 'local' }, runId: 'r1', agentId: 'a1' }),
      new Promise((resolve) => setTimeout(() => resolve(TEST_LEVEL_BOUND), 3000)),
    ]);
    const elapsed = Date.now() - start;

    // Forcing red (once the export exists but wiring is still missing, per state.yaml's round-4
    // finding): main.ts's real `new ClaudeAgentSdkGatewayClient({ baseUrl, cwd })` call omits
    // aliases/timeoutMs/retries entirely, so a hung session never settles at all — this resolves the
    // 3s test-level escape hatch instead of a real bounded GatewayResult.
    expect(result).not.toBe(TEST_LEVEL_BOUND);
    expect((result as { ok: boolean }).ok).toBe(false);
    // Bounded by the CONFIGURED 150ms timeout * (1 attempt + 1 retry) + slack — not the 3s escape
    // hatch and not an unbounded hang.
    expect(elapsed).toBeLessThan(1500);
    expect(queryCalls).toBe(2);
  }, 10000);

  it("gateway:'sdk' — aliases reach the constructed client's alias-aware thinking policy (D-F6)", async () => {
    const composeConfig = await loadComposeConfig();
    expect(typeof composeConfig).toBe('function');

    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-it021b-'));
    const queryImpl = vi.fn(() => fakeSuccessSession());
    // REQ-037: the 'default' alias maps to 'anthropic', which now dispatches DIRECT to the real
    // Anthropic API with real auth (LiteLLM bypassed) — composeConfig wires the SDK gateway's
    // secretSource from RWE_SECRET_* env. Provide a fake api-key secret so the auth-present path
    // reaches query() and the D-F6 thinking policy (thinking unset for anthropic) can be asserted.
    const priorSecret = process.env['RWE_SECRET_ANTHROPIC_API_KEY'];
    process.env['RWE_SECRET_ANTHROPIC_API_KEY'] = 'fake-it021b-key';
    let config: { gateway?: GatewayClient };
    try {
      config = await (composeConfig as (fc: unknown, deps: unknown) => Promise<{ gateway?: GatewayClient }>)(
        {
          bind: '127.0.0.1',
          port: 0,
          workRoot,
          aliases: ALIASES,
          gateway: 'sdk',
        },
        {
          queryImpl,
          proxyManager: makeFakeProxyManager(),
        },
      );
      await config.gateway!.invoke({ prompt: 'hi', opts: { model: 'default' }, runId: 'r1', agentId: 'a1' });
    } finally {
      if (priorSecret === undefined) delete process.env['RWE_SECRET_ANTHROPIC_API_KEY'];
      else process.env['RWE_SECRET_ANTHROPIC_API_KEY'] = priorSecret;
    }

    expect(queryImpl).toHaveBeenCalledTimes(1);
    const [[call]] = queryImpl.mock.calls as unknown as [[{ options?: { thinking?: unknown } }]];
    // Forcing red (once the export exists but `aliases` is never forwarded into
    // ClaudeAgentSdkGatewayConfig): the 'default' alias (mapped to 'anthropic') can never be
    // resolved, so thinkingFor() falls back to its safe-default DISABLED branch for every alias,
    // including this Anthropic one — the SAME symptom round 4 documented ("aliases undefined means
    // thinkingFor() unconditionally disables thinking ... not the alias-aware design D-F6 specified").
    expect(call.options?.thinking).toBeUndefined();
  }, 10000);

  it("gateway:'direct-fetch' — config.gateway is left unset so createServer()'s own aliases-driven LiteLLMGatewayClient applies", async () => {
    const composeConfig = await loadComposeConfig();
    expect(typeof composeConfig).toBe('function');

    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-it021c-'));
    // v34 (DES-227, ARCH-139, TASK-229, REQ-203): `agentDefinitionsDir` — this case's original
    // "forwarded regardless of gateway choice" probe — retired WITH the agentType composition root
    // (`main.ts` no longer forwards it at all; a stale value now warns-and-boots via
    // `RETIRED_CONFIG_KEYS`, covered by `compose-config-v2-wiring.test.ts`'s UT-274). `schedulerDbPath`
    // is the same "forwarded regardless of gateway" convention (DES-022, TASK-023) and stands in.
    const config = await (composeConfig as (fc: unknown, deps: unknown) => Promise<{ gateway?: GatewayClient; schedulerDbPath?: string }>)(
      { bind: '127.0.0.1', port: 0, workRoot, aliases: ALIASES, gateway: 'direct-fetch', schedulerDbPath: '/nonexistent-on-purpose' },
      {},
    );

    // gateway selection: 'direct-fetch' must NOT construct a ClaudeAgentSdkGatewayClient.
    expect(config.gateway).toBeUndefined();
    // D-F10(b): schedulerDbPath must reach the returned ServerConfig regardless of gateway choice.
    expect(config.schedulerDbPath).toBe('/nonexistent-on-purpose');
  }, 10000);
});
