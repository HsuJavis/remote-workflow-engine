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
import { attemptsFor } from '../../src/gateway/client.js';

// Neutralize main.ts's boot side-effects (same pattern as IT-021/IT-022).
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ on: vi.fn(), kill: vi.fn(), pid: 99 })) }));
process.exit = vi.fn() as unknown as typeof process.exit;
import { composeConfig, KNOWN_FILE_CONFIG_KEYS, RETIRED_CONFIG_KEYS } from '../../src/main.js';

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

  // v24 (UT-142, DES-141, ARCH-090, REQ-111): the analyzer subsystem is REMOVED — `graphAnalyzer`
  // stops being a forwarded config block and becomes an unrecognized TOP-LEVEL key that triggers
  // ONE console.warn naming it (carrying the ADR-025 sentence), same treatment as any other unknown
  // key. This REPLACES the three v23 tests above that asserted forwarding — [T3] per DES-159's own
  // enumeration ("−1 (graphAnalyzer)"). Red reason: `composeConfig()` still forwards `graphAnalyzer`
  // silently today (no unrecognized-key warn exists at all) — this assertion is false until TASK-146.
  it('v24: graphAnalyzer is an unrecognized top-level key — warns, and is NOT forwarded onto ServerConfig', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = await composeConfig({ graphAnalyzer: { enabled: true }, gateway: 'direct-fetch' } as any, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['graphAnalyzer']).toBeUndefined();
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('graphAnalyzer'))).toBe(true);
    warnSpy.mockRestore();
  });

  // v24 (UT-142, DES-141, ARCH-090, TASK-146): `principals` and `mcpEgressAllowlist` forwarded IN
  // THE SAME CHANGE (per DES-141's own instruction, avoiding the v11/v15 wiring-gap bug class this
  // file exists to catch). Red reason: neither key is forwarded by composeConfig() today.
  it('v24: principals map is forwarded from FileConfig into ServerConfig', async () => {
    const principals = { 'alice@x.com': { role: 'admin' }, '*': { role: 'user' } };
    const cfg = await composeConfig({ principals, gateway: 'direct-fetch' } as any, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['principals']).toEqual(principals);
  });

  it('v24: mcpEgressAllowlist is forwarded from FileConfig into ServerConfig', async () => {
    const mcpEgressAllowlist = ['https://api.example.com'];
    const cfg = await composeConfig({ mcpEgressAllowlist, gateway: 'direct-fetch' } as any, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['mcpEgressAllowlist']).toEqual(mcpEgressAllowlist);
  });

  // Gate 6.5+7 round 2 (verifier): ADR-028's boot REFUSAL was reached by no test — the whole point
  // of `normalizePrincipals` returning a failure rather than defaulting is that a typo'd role stops
  // the process, and only the accepting side was covered.
  it('v24: a malformed principals role REFUSES the boot, naming the key and the role (ADR-028 fail-closed)', async () => {
    await expect(composeConfig({ principals: { 'a@x.com': { role: 'admn' } }, gateway: 'direct-fetch' } as any, FAKE_DEPS))
      .rejects.toThrow(/principals\["a@x.com"\].role is "admn".*Refusing to start/s);
  });

  it('v24: every VALID role is accepted and forwarded verbatim', async () => {
    const principals = { 'a@x.com': { role: 'admin' }, 'b@x.com': { role: 'author' }, 'c@x.com': { role: 'user' } };
    const cfg = await composeConfig({ principals, gateway: 'direct-fetch' } as any, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['principals']).toEqual(principals);
  });

  // v25 (DES-168, REQ-120, issue #61): `runConcurrency` — the per-run in-flight agent() cap that
  // replaced `min(16, cores-2)`. It is exactly the shape of this file's standing bug class: a new
  // config key that composeConfig() forgets to forward silently no-ops, and only a real run notices
  // (v11 updateFlagPath and v15 auth each cost an iteration this way). An operator who raises this
  // to widen a fan-out would see no change at all.
  it('v25: runConcurrency is forwarded from FileConfig into the returned ServerConfig', async () => {
    const cfg = await composeConfig({ runConcurrency: 40, gateway: 'direct-fetch' } as any, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['runConcurrency']).toBe(40);
  });
});

// v26 Gate 7.5 round 1 (defect D7): `agentSlots` — the THIRD time this file's bug class has bitten
// (v11 `updateFlagPath`, v15 `auth`, now this). It is declared in `KNOWN_FILE_CONFIG_KEYS`, is
// documented, is read by `createServer` (`config?.agentSlots ?? 32`) — and `composeConfig()` never
// forwarded it, so booting with `"agentSlots": 7` still reported `agentSemaphore.total 32` on
// `/api/status`. A one-off fix invites a fourth, so the sweep below is mechanical over the key list
// itself rather than one more hand-written case.
// UT-274 (DES-227, ARCH-139, TASK-229, REQ-203): `RETIRED_CONFIG_KEYS` replaces the hardcoded
// `graphAnalyzerNote` `if` — a stale `agentDefinitionsDir` in `rwe.config.json` gets the SAME
// retirement-note treatment `graphAnalyzer` already gets, and the engine still BOOTS (no fail-fast,
// owner ruling). Red reason: `agentDefinitionsDir` is still IN `KNOWN_FILE_CONFIG_KEYS` today (a
// forwarded, live key) — composeConfig neither warns about it nor treats it as retired, and
// `RETIRED_CONFIG_KEYS` does not exist yet (`undefined` above).
describe('composeConfig — RETIRED_CONFIG_KEYS (DES-227, UT-274)', () => {
  it('graphAnalyzer + agentDefinitionsDir + a typo: exactly ONE console.warn naming all three, retirement note on the two retired keys only, engine boots', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = await composeConfig(
      { graphAnalyzer: { enabled: true }, agentDefinitionsDir: '/var/rwe/agents', typo: 1, gateway: 'direct-fetch' } as any,
      FAKE_DEPS,
    );
    expect(cfg).toBeDefined();
    expect(warnSpy.mock.calls.length).toBe(1);
    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).toContain('graphAnalyzer');
    expect(message).toContain('agentDefinitionsDir');
    expect(message).toContain('typo');
    expect(message).toMatch(/retired/i);
    // Exactly ONE retirement note per retired key (graphAnalyzer, agentDefinitionsDir) — the typo
    // key gets NONE (it never existed, unlike a key that USED to work). Counted rather than
    // position-sliced: the note may be appended per-key inline (not necessarily trailing the whole
    // key list), so a fixed-offset slice after "typo" would false-red a faithful DES-227
    // implementation that orders the note differently.
    expect((message.match(/retired/gi) ?? []).length).toBe(2);
    expect(message).not.toMatch(/typo[^.;]*retired/i);
    warnSpy.mockRestore();
  });

  it('RETIRED_CONFIG_KEYS and KNOWN_FILE_CONFIG_KEYS share no key (a retired key cannot also be a currently-forwarded one)', () => {
    const retired = Object.keys((RETIRED_CONFIG_KEYS as unknown as Record<string, string> | undefined) ?? {});
    const known = Object.keys(KNOWN_FILE_CONFIG_KEYS);
    const overlap = retired.filter((k) => known.includes(k));
    expect(overlap).toEqual([]);
    expect(retired.length).toBeGreaterThan(0);
  });
});

describe('agentSlots is wired (UT-218, defect D7)', () => {
  it('agentSlots is forwarded from FileConfig into the returned ServerConfig', async () => {
    const cfg = await composeConfig({ agentSlots: 7, gateway: 'direct-fetch' } as any, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['agentSlots']).toBe(7);
  });
});

// UT-219 (v26 Gate 7.5 round 1, defect D7): the mechanical sweep. Every key in
// `KNOWN_FILE_CONFIG_KEYS` is either PROBED here (a value goes in, the same value must come out of
// composeConfig) or EXCLUDED with a stated reason. The totality assertion is what makes it a
// drift-lock: a new FileConfig key with neither a probe nor an exclusion fails this test, which is
// the signal the previous three misses never had.
const EXCLUDED: Record<string, string> = {
  // Consumed by composeConfig itself (it selects the gateway branch); `config.gateway` holds the
  // constructed GatewayClient, not this string.
  gateway: 'consumed as the branch selector, never forwarded as a value',
  // JSON-inexpressible injected seams. They are typed into FileConfig only because it is declared
  // `Partial<Omit<ServerConfig, ...>>`; a config FILE can never carry a function or a class
  // instance, so "forwarding" them is meaningless. Reported to the owner as an Omit candidate.
  issueReporter: 'injected seam (an object with methods) — cannot come from JSON',
  mcpProbe: 'injected seam — cannot come from JSON',
  modelCatalogFetchers: 'injected seam (fetch functions) — cannot come from JSON',
  modelCatalog: 'injected seam (a function) — cannot come from JSON',
  systemInfo: 'injected seam (a sampler object) — cannot come from JSON',
  proxyManager: 'injected seam (a LiteLLMProxyManager instance) — cannot come from JSON',
  // Documented as sdk-branch-only: these three reach ClaudeAgentSdkGatewayConfig at construction,
  // never ServerConfig, and have no effect on the direct-fetch path by design (FileConfig's own
  // doc comments say so).
  defaultAllowedTools: 'sdk branch only — passed to ClaudeAgentSdkGatewayClient, not onto ServerConfig',
  anthropicBaseUrl: 'sdk branch only — passed to ClaudeAgentSdkGatewayClient, not onto ServerConfig',
  anthropicAuth: 'sdk branch only — passed to ClaudeAgentSdkGatewayClient, not onto ServerConfig',
  // Covered by its own cases above (the raw role map is TRANSFORMED, not copied).
  principals: 'validated + transformed by normalizePrincipals — covered by its own two cases above',
};

const PROBES: Record<string, unknown> = {
  bind: '127.0.0.2',
  port: 8123,
  allowedHosts: ['probe.example'],
  workRoot: '/var/rwe/probe-root',
  aliases: { default: { provider: 'ollama', model: 'probe-model' } },
  timeoutMs: 4321,
  retries: 3,
  useLiteLLMProxy: false,
  litellmPort: 4099,
  schedulerDbPath: '/var/rwe/sched.db',
  assetRoot: '/var/rwe/assets',
  agentSlots: 7,
  runConcurrency: 40,
  workspaceTtlMs: 7200000,
  maxWorkflowDepth: 5,
  maxWorkflowDescendants: 300,
  maxConcurrentRuns: 65,
  seedRefAllowlist: ['https://seeds.example/'],
  continuationDbPath: '/var/rwe/cont.db',
  casDir: '/var/rwe/cas',
  maxBlobBytes: 33_554_432,
  webhookDbPath: '/var/rwe/hooks.db',
  updateFlagPath: '/var/rwe/update.flag',
  updateResultPath: '/var/rwe/update.json',
  selfUpdateDbPath: '/var/rwe/selfupdate.db',
  auth: { enabled: false },
  maxTimeoutMs: 900000,
  maxAppendPromptBytes: 2048,
  maxEffort: 'medium',
  maxWorkflowVersions: 12,
  mcpEgressAllowlist: ['https://mcp.example/'],
};

describe('every KNOWN_FILE_CONFIG_KEYS entry is probed or excluded (UT-219, defect D7)', () => {
  it('the key list is exactly PROBES + EXCLUDED — a new key with neither fails here', () => {
    const known = Object.keys(KNOWN_FILE_CONFIG_KEYS).sort();
    const accounted = [...Object.keys(PROBES), ...Object.keys(EXCLUDED)].sort();
    expect(accounted).toEqual(known);
  });

  for (const [key, value] of Object.entries(PROBES)) {
    it(`${key} survives composeConfig()`, async () => {
      const cfg = await composeConfig({ [key]: value, gateway: 'direct-fetch' } as any, FAKE_DEPS);
      expect((cfg as Record<string, unknown>)[key]).toEqual(value);
    });
  }

  // VAL-251/REQ-216/K8 (Gate-8 send-back ruling, ARCH-171): the PROBES sweep above only ever
  // constructs `gateway:'direct-fetch'` configs, so it locks hop 1 (FileConfig -> ServerConfig)
  // for `retries`/`timeoutMs` but never exercises hop 2 (ServerConfig -> the CONSTRUCTED gateway)
  // on the `sdk` branch main.ts defaults to — the branch D-F10(a) fixed and this repo had already
  // silently regressed once. `attempts` is a DERIVED value, not a FileConfig key: it is
  // deliberately NOT a PROBES row (a row for it would break the totality assertion above, since
  // `attempts` is absent from KNOWN_FILE_CONFIG_KEYS) — this is a separate `it()` outside the
  // PROBES loop, exactly as the ruling specifies. A wiring lock, green on arrival: it fails the
  // day `retries`/`timeoutMs` stop reaching `ClaudeAgentSdkGatewayClient`'s own config, not before.
  it('sdk branch: composeConfig() forwards retries/timeoutMs into the constructed ClaudeAgentSdkGatewayClient, matching the shared attemptsFor() (REQ-216/K8)', async () => {
    const cfg = await composeConfig({ gateway: 'sdk', retries: 3, timeoutMs: 5000 }, FAKE_DEPS);
    const gwConfig = (cfg.gateway as unknown as { _config: { retries?: number; timeoutMs?: number } })._config;
    expect(gwConfig.retries).toBe(3);
    expect(gwConfig.timeoutMs).toBe(5000);
    expect(attemptsFor(gwConfig.retries, gwConfig.timeoutMs)).toBe(attemptsFor(3, 5000));
  });
});
