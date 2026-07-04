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
});
