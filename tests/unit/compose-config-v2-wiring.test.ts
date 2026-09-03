// UT-033: composeConfig() wiring-completeness for v2 config keys (DES-022, TASK-023/027)
// Standing rule 1: every new config key must be covered by the composition-root wiring UT.
// RED: v2 keys (schedulerDbPath, assetRoot) are not yet forwarded through composeConfig() —
// assertions fail on undefined. litellmPort is already forwarded (green regression guard).
//
// D-V2I-4 (ORCH binding, gap-test verifier correction): the `dashboardPort` forwarding case is
// REMOVED — there is no separate dashboard port. The dashboard's read-only HTTP API (DES-018/
// TASK-025) is served on the SAME http server/listener as `/mcp` (see `src/server.ts`'s single
// `createHttpServer` handler routing on `req.url` prefix, and DES-021/DES-009's own annotated
// note) — a distinct `dashboardPort` config key would be dead/misleading wiring, never consulted
// by anything. `schedulerDbPath`/`assetRoot` remain red forcing cases.
//
// Uses the existing exported composeConfig() helper (IMPL-045) which DOES exist.
// No side-effectful boot; fakes neutralize the spawned proxy manager and queryImpl.
import { describe, it, expect, vi } from 'vitest';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { FixedClock } from '../../src/clock.js';
import type { ClaudeAgentSdkGatewayConfig } from '../../src/gateway/claude-agent-sdk-client.js';

// Neutralize main.ts's boot side-effects (same pattern as IT-021/IT-022).
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ on: vi.fn(), kill: vi.fn(), pid: 99 })) }));
process.exit = vi.fn() as unknown as typeof process.exit;
import { composeConfig } from '../../src/main.js';

// Fake deps that neutralize all real subprocess/network boundaries.
// queryImpl is typed against the REAL seam (ClaudeAgentSdkGatewayConfig['queryImpl'] = typeof
// sdkQuery, i.e. `(_params) => Query` where `Query extends AsyncGenerator<SDKMessage, void>` plus
// control methods) via an explicit variable annotation below, so a signature drift is caught by
// this annotation rather than papered over by the blanket `as unknown as
// Parameters<typeof composeConfig>[1]` cast on the whole FAKE_DEPS object — same convention as
// hungSession()/fakeSuccessSession() in tests/integration/main-composition-root.test.ts. Only the
// generator's own return value is cast `as Query` (the control methods — interrupt/close/etc. —
// aren't exercised by this wiring test). ComposeConfigDeps isn't exported from main.ts, so
// `Parameters<typeof composeConfig>[1]` is still used to type-check the fake's overall shape
// against the real deps without a src/ change (proxyManager is a test-double, not a real
// LiteLLMProxyManager instance, hence the trailing cast).
const fakeQueryImpl: ClaudeAgentSdkGatewayConfig['queryImpl'] = () =>
  (async function* (): AsyncGenerator<SDKMessage, void> {
    yield { type: 'result', subtype: 'success', is_error: false, result: 'stub' } as SDKMessage;
  })() as Query;

const FAKE_DEPS = {
  queryImpl: fakeQueryImpl,
  proxyManager: {
    start: vi.fn().mockResolvedValue({ port: 4001 }),
    stop: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(false),
    spawnImpl: vi.fn(),
    fetchImpl: vi.fn(),
  },
} as unknown as Parameters<typeof composeConfig>[1];

describe('composeConfig() v2 key wiring (DES-022, standing rule 1)', () => {
  it('schedulerDbPath is forwarded from FileConfig into the returned ServerConfig', async () => {
    const cfg = await composeConfig({ schedulerDbPath: '/tmp/test-sched.db', gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['schedulerDbPath']).toBe('/tmp/test-sched.db');
  });

  it('assetRoot is forwarded from FileConfig into the returned ServerConfig', async () => {
    const cfg = await composeConfig({ assetRoot: '/var/rwe/assets', gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['assetRoot']).toBe('/var/rwe/assets');
  });

  it('litellmPort is forwarded from FileConfig into the returned ServerConfig (TASK-027)', async () => {
    const cfg = await composeConfig({ litellmPort: 4099, gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['litellmPort']).toBe(4099);
  });

  // Real-use gap: `useLiteLLMProxy` was NOT forwarded by composeConfig(), so `useLiteLLMProxy:false`
  // in the config file had no effect and server.ts's `config?.useLiteLLMProxy ?? true` re-enabled it
  // -> a dependency-free (Ollama-only) deploy still spawned `litellm` and crashed on every agent().
  it('useLiteLLMProxy:false is forwarded from FileConfig into the returned ServerConfig', async () => {
    const cfg = await composeConfig({ useLiteLLMProxy: false, gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['useLiteLLMProxy']).toBe(false);
  });

  // D-V2V-1 (REQ-009 route-back, gap-tests-v2b): rwe.config.example.json's own committed template
  // sets `workRoot` but never `assetRoot` — without this default, that exact real deployment shape
  // would silently never thread AssetSyncService's on-disk location into the SDK gateway
  // (src/server.ts's own AssetSyncService construction already defaults to
  // `join(workRoot,'assets')`; composeConfig() must match it so `assetRoot` isn't just correct for
  // ServerConfig but also for the ClaudeAgentSdkGatewayClient this same function constructs).
  it('assetRoot defaults to join(workRoot,"assets") when the file config sets workRoot but omits assetRoot', async () => {
    const cfg = await composeConfig({ workRoot: '/var/rwe/data', gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['assetRoot']).toBe('/var/rwe/data/assets');
  });

  it('assetRoot stays undefined when both assetRoot and workRoot are omitted (no default to guess from)', async () => {
    const cfg = await composeConfig({ gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['assetRoot']).toBeUndefined();
  });

  // v11 Sprint 2 (REQ-068..070): composeConfig() must forward the self-update paths, or POST
  // /github/webhook + result ingestion are unreachable from `npm start`/systemd even with the config
  // file set — the feature only worked via in-process createServer in tests (built-but-unwired, the
  // same class as the D-V3M gauge/inject bugs). Found by the Gate-7.5 live run.
  it('updateFlagPath is forwarded from FileConfig into the returned ServerConfig', async () => {
    const cfg = await composeConfig({ updateFlagPath: '/var/rwe/update.flag', gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['updateFlagPath']).toBe('/var/rwe/update.flag');
  });

  it('updateResultPath is forwarded from FileConfig into the returned ServerConfig', async () => {
    const cfg = await composeConfig({ updateResultPath: '/var/rwe/update.result.json', gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['updateResultPath']).toBe('/var/rwe/update.result.json');
  });

  it('selfUpdateDbPath is forwarded from FileConfig into the returned ServerConfig', async () => {
    const cfg = await composeConfig({ selfUpdateDbPath: '/var/rwe/self-update.db', gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['selfUpdateDbPath']).toBe('/var/rwe/self-update.db');
  });

  // v15 (REQ-012/086..089): auth block forwarding — without `auth: fileConfig.auth` in
  // composeConfig(), `auth.enabled:true` in rwe.config.json is parsed by loadFileConfig() but
  // silently dropped at the composition root, leaving the auth subsystem built-but-unwired.
  // Found and fixed during Gate 7.5 v15: pre-fix curl 404/200; post-fix 200/401 w/ WWW-Authenticate.
  it('auth block is forwarded from FileConfig into the returned ServerConfig (REQ-012 composition root)', async () => {
    const auth = { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'test-id', googleClientSecret: 'test-secret' };
    const cfg = await composeConfig({ auth, gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['auth']).toEqual(auth);
  });

  it('auth:undefined is forwarded when FileConfig omits the auth block (backward-compat)', async () => {
    const cfg = await composeConfig({ gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['auth']).toBeUndefined();
  });

  // v21 (ARCH-066 inv-6, DES-104, TASK-100): the three engine ceilings on the USER-override rung
  // (ADR-005). Red reason: composeConfig() does not forward these keys today — same wiring-gap
  // class as v11 updateFlagPath / v15 auth / v16 workspaceTtlMs (now `resolveHarnessParams`'s ceilings).
  it('maxTimeoutMs is forwarded from FileConfig into the returned ServerConfig', async () => {
    const cfg = await composeConfig({ maxTimeoutMs: 900_000, gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['maxTimeoutMs']).toBe(900_000);
  });

  it('maxAppendPromptBytes is forwarded from FileConfig into the returned ServerConfig', async () => {
    const cfg = await composeConfig({ maxAppendPromptBytes: 2048, gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['maxAppendPromptBytes']).toBe(2048);
  });

  it('maxEffort is forwarded from FileConfig into the returned ServerConfig', async () => {
    const cfg = await composeConfig({ maxEffort: 'xhigh', gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['maxEffort']).toBe('xhigh');
  });

  // Gate 7.5 v21 config-sync check (§4b): same wiring-gap class as the cases above — these four
  // keys were documented (rwe.config.json/DEPLOY.md §1b) but never named in composeConfig()'s
  // returned object literal, so `npm start`/systemd silently ignored a deployer's configured
  // maxBlobBytes/webhookDbPath/casDir/continuationDbPath; only in-process createServer() (tests)
  // ever saw them. Found by the Gate-7.5 v21 live-run config round-trip check.
  it('maxBlobBytes is forwarded from FileConfig into the returned ServerConfig', async () => {
    const cfg = await composeConfig({ maxBlobBytes: 1_048_576, gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['maxBlobBytes']).toBe(1_048_576);
  });

  it('webhookDbPath is forwarded from FileConfig into the returned ServerConfig', async () => {
    const cfg = await composeConfig({ webhookDbPath: '/var/rwe/webhooks.db', gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['webhookDbPath']).toBe('/var/rwe/webhooks.db');
  });

  it('casDir is forwarded from FileConfig into the returned ServerConfig', async () => {
    const cfg = await composeConfig({ casDir: '/var/rwe/cas', gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['casDir']).toBe('/var/rwe/cas');
  });

  it('continuationDbPath is forwarded from FileConfig into the returned ServerConfig', async () => {
    const cfg = await composeConfig({ continuationDbPath: '/var/rwe/continuations.db', gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['continuationDbPath']).toBe('/var/rwe/continuations.db');
  });

  // v22 (ARCH-071, ADR-014, TASK-107): the per-name version ceiling — same `composeConfig` wiring
  // class as every case above (v11 updateFlagPath / v15 auth / v16 workspaceTtlMs / v21
  // resolveHarnessParams' ceilings). `maxWorkflowVersions` goes into the EXISTING
  // `WorkflowCatalogOpts.ceilings` object (workflow-catalog.ts:57) — no new plumbing — so this case
  // also stands as this task's compose-config-v2-wiring.test.ts row (TASK-107 dod).
  it('maxWorkflowVersions is forwarded from FileConfig into the returned ServerConfig (v22)', async () => {
    const cfg = await composeConfig({ maxWorkflowVersions: 25, gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['maxWorkflowVersions']).toBe(25);
  });

  // v23 (TASK-122, DES-134, ARCH-085): the `graphAnalyzer` config block — same wiring-gap class as
  // every case above (v11 updateFlagPath / v15 auth / v16 workspaceTtlMs / v22 maxWorkflowVersions).
  // REQ-104's own acceptance text is explicit that THIS row alone does not close the requirement — a
  // unit assertion reads its value off the same path that would be broken; only TASK-124's Gate 7.5
  // real run (an operator edits the config, re-registers, the diagram visibly changes with no
  // redeploy) is proof. This row is necessary, not sufficient.
  //
  // Red reason: `ServerConfig`/`composeConfig()` have no `graphAnalyzer` key at all today (confirmed
  // by reading `src/server.ts`'s `ServerConfig` interface and `src/main.ts`'s `composeConfig()` body)
  // -> the forwarded value is `undefined` in every case below. The `as any` cast on the FileConfig
  // literal is this codebase's own established convention for exercising a not-yet-declared key
  // (see `tests/unit/put-blob-stream.test.ts`'s `(cas as any)` pattern) — FileConfig would otherwise
  // reject `graphAnalyzer` at the TS excess-property check before the test ever runs.
  it('graphAnalyzer block is forwarded from FileConfig into the returned ServerConfig, as a WHOLE object (v23)', async () => {
    const graphAnalyzer = {
      enabled: true, model: 'sonnet-5', systemPrompt: 'draw a diagram', tools: [],
      timeoutMs: 60000, retries: 0, maxBytes: 8192, maxLines: 120, maxQueueDepth: 8,
    };
    const cfg = await composeConfig({ graphAnalyzer, gateway: 'direct-fetch' } as any, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['graphAnalyzer']).toEqual(graphAnalyzer);
  });

  it('graphAnalyzer.enabled:false is forwarded (a first-class tested state, never dropped/defaulted-away at this layer)', async () => {
    const cfg = await composeConfig({ graphAnalyzer: { enabled: false }, gateway: 'direct-fetch' } as any, FAKE_DEPS);
    expect(((cfg as Record<string, unknown>)['graphAnalyzer'] as Record<string, unknown> | undefined)?.['enabled']).toBe(false);
  });

  it('graphAnalyzer is undefined when FileConfig omits the block entirely (backward-compat, same convention as `auth`)', async () => {
    const cfg = await composeConfig({ gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['graphAnalyzer']).toBeUndefined();
  });
});
