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

  // Service accounts spec (owner decision 2026-10-03): the composeConfig wiring bug class this repo
  // has already hit twice (v11 updateFlagPath, v15 auth itself) — a NEW field added to an already-
  // forwarded block can still get lost if that block were ever reconstructed field-by-field.
  // `auth` is forwarded wholesale (`resolveAuthSecrets` spreads `{...auth}`), so this passes without
  // a composeConfig.ts change — this case exists to make that guarantee explicit and regression-
  // tested, not merely implied by the block-forwarding test above.
  it('auth.serviceAccountTokenTtlMs is forwarded from FileConfig into the returned ServerConfig', async () => {
    const auth = { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'test-id', googleClientSecret: 'test-secret', serviceAccountTokenTtlMs: 1800_000 };
    const cfg = await composeConfig({ auth, gateway: 'direct-fetch' }, FAKE_DEPS);
    expect(((cfg as Record<string, unknown>)['auth'] as Record<string, unknown>)['serviceAccountTokenTtlMs']).toBe(1800_000);
  });

  // Issue audit A1 (owner decision 2026-10-06): `auth.legacyOwner` replaces the old hard-coded
  // BOOT_BACKFILL_EMAIL — same "a NEW field on an already-forwarded block can still get lost" class
  // as serviceAccountTokenTtlMs above (`auth` is forwarded wholesale by `resolveAuthSecrets`'s
  // `{...auth}` spread), so this passes without a composeConfig.ts change — explicit regression lock.
  it('auth.legacyOwner is forwarded from FileConfig into the returned ServerConfig (A1)', async () => {
    const auth = { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'test-id', googleClientSecret: 'test-secret', legacyOwner: 'ops@example.com' };
    const cfg = await composeConfig({ auth, gateway: 'direct-fetch' }, FAKE_DEPS);
    expect(((cfg as Record<string, unknown>)['auth'] as Record<string, unknown>)['legacyOwner']).toBe('ops@example.com');
  });

  // 2026-09-28 (owner: no plaintext secrets in config): auth.googleClientSecret / googleClientId may
  // be a `${secret:NAME}` handle, resolved at config load from the SAME RWE_SECRET_<NAME> env store
  // the engine already uses. A missing name refuses boot — the literal handle must never reach Google.
  describe('auth ${secret:NAME} handles (googleClientSecret / googleClientId)', () => {
    const SECRET_ENV = 'RWE_SECRET_UT_GOOGLE_CLIENT_SECRET';
    const ID_ENV = 'RWE_SECRET_UT_GOOGLE_CLIENT_ID';
    const withEnv = async <T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> => {
      Object.assign(process.env, vars);
      try { return await fn(); } finally { for (const k of Object.keys(vars)) delete process.env[k]; }
    };

    it('resolves both handles from RWE_SECRET_* env; the other auth fields pass through untouched', async () => {
      const auth = { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: '${secret:UT_GOOGLE_CLIENT_ID}', googleClientSecret: '${secret:UT_GOOGLE_CLIENT_SECRET}' };
      const cfg = await withEnv({ [SECRET_ENV]: 'resolved-cs-value', [ID_ENV]: 'resolved-cid-value' }, () =>
        composeConfig({ auth, gateway: 'direct-fetch' }, FAKE_DEPS));
      expect((cfg as Record<string, unknown>)['auth']).toEqual({
        enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'resolved-cid-value', googleClientSecret: 'resolved-cs-value',
      });
      expect(auth.googleClientSecret).toBe('${secret:UT_GOOGLE_CLIENT_SECRET}'); // input not mutated
    });

    it('refuses boot naming the handle and its env var when the secret is missing — never the literal handle to Google', async () => {
      delete process.env[SECRET_ENV];
      const auth = { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'cid', googleClientSecret: '${secret:UT_GOOGLE_CLIENT_SECRET}' };
      await expect(composeConfig({ auth, gateway: 'direct-fetch' }, FAKE_DEPS)).rejects.toThrow(
        /auth\.googleClientSecret.*UT_GOOGLE_CLIENT_SECRET.*RWE_SECRET_UT_GOOGLE_CLIENT_SECRET/s,
      );
    });

    it('refuses a malformed handle instead of passing it through', async () => {
      const auth = { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'cid', googleClientSecret: '${secret:bad name}' };
      await expect(composeConfig({ auth, gateway: 'direct-fetch' }, FAKE_DEPS)).rejects.toThrow(/auth\.googleClientSecret/);
    });

    it('never writes the resolved value to the console', async () => {
      const spies = (['log', 'warn', 'error', 'info'] as const).map((m) => vi.spyOn(console, m));
      try {
        await withEnv({ [SECRET_ENV]: 'must-not-be-logged-7f3a' }, () => composeConfig({
          auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'cid', googleClientSecret: '${secret:UT_GOOGLE_CLIENT_SECRET}' },
          gateway: 'direct-fetch', bogusKeyToForceAWarning: 1,
        } as never, FAKE_DEPS));
        const printed = spies.flatMap((s) => s.mock.calls).map((c) => c.map(String).join(' ')).join('\n');
        expect(printed).not.toContain('must-not-be-logged-7f3a');
      } finally { for (const s of spies) s.mockRestore(); }
    });
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

  // 2026-09-26 (alias mechanism removed, owner decision 7): the SAME RETIRED_CONFIG_KEYS treatment
  // — a production config that still carries `aliases` across a self-update restart must still
  // BOOT, with a one-line warning, never a fail-fast. Complements check-config-cli.test.ts's
  // process-level coverage of the identical spec rule with a faster, more precise unit-tier check
  // directly on composeConfig() itself.
  it('aliases (retired 2026-09-26): warns naming it and the removal reason, is NOT forwarded onto ServerConfig, engine boots', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = await composeConfig(
      { aliases: { sonnet: { provider: 'anthropic', model: 'claude-sonnet-5' } }, gateway: 'direct-fetch' } as any,
      FAKE_DEPS,
    );
    expect(cfg).toBeDefined();
    expect((cfg as Record<string, unknown>)['aliases']).toBeUndefined();
    expect(warnSpy.mock.calls.length).toBe(1);
    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).toContain('aliases');
    expect(message.toLowerCase()).toContain('alias mechanism is removed');
    warnSpy.mockRestore();
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
  // v37 (DES-253, ARCH-177, TASK-252, REQ-218): consumed by composeConfig() itself — it lands on
  // the constructed gateway's own confinement config, never on ServerConfig (same shape as the
  // `gateway` exclusion above). This EXCLUDED row flips UT-219's totality assertion RED until
  // `sandbox` joins `KNOWN_FILE_CONFIG_KEYS` (main.ts) — that is the correct red: the wiring gap is
  // exactly what this drift-lock exists to catch.
  sandbox: "consumed by composeConfig() itself: it lands on the constructed gateway's own config, never on ServerConfig",
};

const PROBES: Record<string, unknown> = {
  bind: '127.0.0.2',
  port: 8123,
  allowedHosts: ['probe.example'],
  workRoot: '/var/rwe/probe-root',
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
  // Issue #73: the model-probe block — a fully-specified value, so the validated+normalized object
  // composeConfig() forwards is `toEqual` to what went in.
  modelProbe: { enabled: false, intervalMs: 3_600_000, timeoutMs: 45_000 },
  // issue #97: the externally-reachable base URL webhook_create's returned url is built from
  // (server.ts's resolvePublicBaseUrl) — same wiring-gap class as every case above; an operator's
  // rwe.config.json publicBaseUrl must reach ServerConfig or the production entrypoint keeps
  // answering a localhost URL no remote client can reach.
  publicBaseUrl: 'https://rwe.example.com',
  // Owner decision 2026-10-02: per-role CAS quota and the disk floor. Fully-specified, already
  // normalized (bytes; null = unlimited), so the validated value composeConfig() forwards is
  // `toEqual` to what went in.
  casQuota: { user: 1000, author: 2000, admin: null },
  diskFloor: { percent: 10, bytes: 4096 },
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

  // v37 (UT-313, DES-253, ARCH-177, TASK-252, REQ-218): the SAME hop-2 class as the retries/
  // timeoutMs probe above — `sandbox` is EXCLUDED from the PROBES sweep (it never lands on
  // ServerConfig at all), so its own forwarding into the constructed gateway needs its own case,
  // exactly as ARCH-177 prescribes ("this hop is the documented composeConfig bug class ... and the
  // probe is not optional"). The grant must be a REAL directory outside workRoot, or
  // validateHostPathGrants()'s UNRESOLVABLE/INSIDE_WORKROOT refusal fires before the forwarding this
  // test asserts is ever reached.
  it("sdk branch: composeConfig() forwards sandbox.allowHostPaths into the constructed gateway's confinement (REQ-218/ARCH-177)", async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-ccwiring-workroot-'));
    const grant = mkdtempSync(join(tmpdir(), 'rwe-ccwiring-grant-'));
    const cfg = await composeConfig({ gateway: 'sdk', workRoot, sandbox: { allowHostPaths: [grant] } } as any, FAKE_DEPS);
    const gwConfig = (cfg.gateway as unknown as { _config: { confinement?: { allowHostPaths?: readonly string[] } } })._config;
    expect(gwConfig.confinement?.allowHostPaths).toEqual([grant]);
    rmSync(workRoot, { recursive: true, force: true });
    rmSync(grant, { recursive: true, force: true });
  });

  // Issue #101: the deny-by-default read posture's two new inputs — the engine's home (denied whole)
  // and the read-only re-opens (`sandbox.allowReadPaths` + the home-resident toolchain derived from
  // the engine's own PATH/execPath) — cross the SAME composeConfig hop as allowHostPaths above; a
  // forgotten forward would silently re-open the whole home (the #101 exfil), so it gets its lock.
  it("sdk branch: composeConfig() forwards homeDir + sandbox.allowReadPaths (+ derived toolchain) into the gateway's confinement (issue #101)", async () => {
    const { mkdtempSync, mkdirSync, rmSync, realpathSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-ccwiring-workroot-'));
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'rwe-ccwiring-home-')));
    mkdirSync(join(home, '.local', 'node', 'bin'), { recursive: true });
    const extra = realpathSync(mkdtempSync(join(tmpdir(), 'rwe-ccwiring-extra-')));
    const cfg = await composeConfig({ gateway: 'sdk', workRoot, sandbox: { allowReadPaths: [extra] } } as any, {
      ...FAKE_DEPS, homeDir: home, pathEnv: `${join(home, '.local', 'node', 'bin')}:/usr/bin`, execPath: join(home, '.local', 'node', 'bin', 'node'),
    } as any);
    const gwConfig = (cfg.gateway as unknown as { _config: { confinement?: { homeDir?: string; allowReadPaths?: readonly string[] } } })._config;
    expect(gwConfig.confinement?.homeDir).toBe(home);
    expect(gwConfig.confinement?.allowReadPaths).toEqual([join(home, '.local', 'node', 'bin'), join(home, '.local', 'node'), extra]);
    for (const d of [workRoot, home, extra]) rmSync(d, { recursive: true, force: true });
  });

  // v37 Gate-8 send-back (finding A5, INV-V37-5): `confinementPosture` crosses TWO hops from
  // `deps.confinementProbe` — main.ts:368 onto `ServerConfig.confinementPosture` (the door's own
  // read in call-tool.ts and RunManager's predicate) and main.ts's sdk-branch gateway construction
  // onto the constructed `ClaudeAgentSdkGatewayClient`'s own config — and unlike `allowHostPaths`
  // above, NEITHER hop had a wiring lock: dropping either forward is silently INSECURE (every
  // remote submission admitted / every run ships unconfined), not silently inert, so a regression
  // here would never be caught by a "field renders as undefined" style assertion. Mirrors the
  // `allowHostPaths` lock's shape exactly, one probe result in, both hops checked.
  it('sdk branch: composeConfig() forwards deps.confinementProbe.posture onto BOTH ServerConfig AND the constructed gateway (REQ-218, INV-V37-5)', async () => {
    const cfg = await composeConfig({ gateway: 'sdk' }, { ...FAKE_DEPS, confinementProbe: { posture: 'confined' } } as any);
    expect((cfg as Record<string, unknown>)['confinementPosture']).toBe('confined');
    const gwConfig = (cfg.gateway as unknown as { _config: { confinementPosture?: string } })._config;
    expect(gwConfig.confinementPosture).toBe('confined');
  });
});

// pi harness v1 (owner decisions 1/2/3): `gateway:"pi"` is a THIRD composeConfig() branch, like
// `confinementPosture` NOT a plain FileConfig forward — `harnessProviders` is DERIVED from the
// gateway choice (never an independent rwe.config.json key: joins the Omit in main.ts's own
// `FileConfig` declaration), and the constructed gateway is a `PiGatewayClient`, never the
// `ClaudeAgentSdkGatewayClient` the "sdk" branch builds.
describe('composeConfig() — gateway:"pi" (pi harness v1, owner decisions 1/2/3)', () => {
  it('sets ServerConfig.harnessProviders to exactly [openrouter, ollama] — never anthropic', async () => {
    const cfg = await composeConfig({ gateway: 'pi' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['harnessProviders']).toEqual(['openrouter', 'ollama']);
  });

  it('constructs a PiGatewayClient as ServerConfig.gateway (never falls through to LiteLLMGatewayClient)', async () => {
    const { PiGatewayClient } = await import('../../src/gateway/pi-gateway-client.js');
    const cfg = await composeConfig({ gateway: 'pi' }, FAKE_DEPS);
    expect(cfg.gateway).toBeInstanceOf(PiGatewayClient);
  });

  it('never starts the managed LiteLLM proxy (no proxy needed — pi talks to openrouter/ollama natively)', async () => {
    // A fresh proxyManager double, scoped to this test only — FAKE_DEPS.proxyManager is a
    // module-level shared mock whose call count accumulates across every other test in this file.
    const freshProxyManager = { start: vi.fn().mockResolvedValue({ port: 4001 }), stop: vi.fn(), isRunning: vi.fn().mockReturnValue(false) };
    const cfg = await composeConfig({ gateway: 'pi' }, { ...FAKE_DEPS, proxyManager: freshProxyManager } as unknown as Parameters<typeof composeConfig>[1]);
    expect(freshProxyManager.start).not.toHaveBeenCalled();
    expect(cfg.proxyManager).toBeUndefined();
  });

  it('the default gateway stays "sdk" and the "sdk" branch is byte-unchanged (no harnessProviders set)', async () => {
    const cfg = await composeConfig({}, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['harnessProviders']).toBeUndefined();
  });

  it('harnessProviders is never a FileConfig key an operator can set directly (compose-config bug class guard)', () => {
    expect('harnessProviders' in KNOWN_FILE_CONFIG_KEYS).toBe(false);
  });

  // slice (e) / v37 Gate-8 send-back (finding A5) parity: a SEPARATE probe from the sdk gateway's
  // own (spec "Confinement posture") — `deps.confinementProbe` here must be main()'s pi-path probe
  // result, forwarded onto BOTH ServerConfig.confinementPosture AND the constructed PiGatewayClient's
  // own config, exactly like the sdk branch's own lock above. Dropping either forward is silently
  // INSECURE (every run ships unconfined with no observable signal), not silently inert.
  it('forwards deps.confinementProbe.posture onto BOTH ServerConfig AND the constructed PiGatewayClient (REQ-218 parity)', async () => {
    const cfg = await composeConfig({ gateway: 'pi' }, { ...FAKE_DEPS, confinementProbe: { posture: 'confined' } } as unknown as Parameters<typeof composeConfig>[1]);
    expect((cfg as Record<string, unknown>)['confinementPosture']).toBe('confined');
    const gwConfig = (cfg.gateway as unknown as { _config: { confinementPosture?: string } })._config;
    expect(gwConfig.confinementPosture).toBe('confined');
  });

  it('forwards the SAME grant/protected/workRoot block onto the constructed PiGatewayClient as the sdk branch forwards', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-ccwiring-pi-workroot-'));
    try {
      const cfg = await composeConfig({ gateway: 'pi', workRoot }, FAKE_DEPS);
      const gwConfig = (cfg.gateway as unknown as { _config: { confinement?: { workRoot?: string } } })._config;
      expect(gwConfig.confinement?.workRoot).toBe(workRoot);
    } finally {
      rmSync(workRoot, { recursive: true, force: true });
    }
  });
});

// Issue audit A8 (owner decision 2026-10-06): an unrecognized `gateway` value used to silently fall
// through to direct-fetch (main.ts never validated it) — refused at boot now, naming the valid set,
// never a silent fallback. Shared by `--check-config` (same composeConfig() path).
describe('gateway: an unrecognized value refuses the boot (A8, ADR-028 fail-closed)', () => {
  it('refuses a typo\'d gateway value, naming it and the three valid values', async () => {
    await expect(composeConfig({ gateway: 'Pi' } as any, FAKE_DEPS)).rejects.toThrow(
      /gateway.*"Pi".*"sdk".*"direct-fetch".*"pi"/s,
    );
  });

  it('still accepts every real value (no behaviour change for valid configs)', async () => {
    await expect(composeConfig({ gateway: 'sdk' }, FAKE_DEPS)).resolves.toBeDefined();
    await expect(composeConfig({ gateway: 'pi' }, FAKE_DEPS)).resolves.toBeDefined();
    await expect(composeConfig({ gateway: 'direct-fetch' }, FAKE_DEPS)).resolves.toBeDefined();
  });

  it('an absent gateway key still defaults to "sdk" (no behaviour change)', async () => {
    const cfg = await composeConfig({}, FAKE_DEPS);
    expect(cfg.gateway).toBeDefined();
  });
});

// Issue audit A9 (owner decision 2026-10-06): several boot refusals used to live ONLY in
// createServer()/RunManager, so `--check-config` (which shares composeConfig(), never
// createServer()) reported OK on a config that then crash-loops the real restart. Each case below
// calls the SAME validator/function the real boot path already uses — no duplicated rule, just a
// second CALL SITE reached before any side effect (same convention as modelProbe/casQuota/diskFloor
// above, and as seedRefAllowlist/updateFlagPath's own pre-existing single implementations).
describe('composeConfig() shares every boot-refusal rule with a real boot (A9, one validator, no duplication)', () => {
  it('updateFlagPath inside workRoot refuses to start (same UPDATE_FLAG_INSIDE_WORKROOT rule createServer() already enforces)', async () => {
    await expect(
      composeConfig({ gateway: 'direct-fetch', workRoot: '/var/rwe/data', updateFlagPath: '/var/rwe/data/update.flag' } as any, FAKE_DEPS),
    ).rejects.toThrow(/UPDATE_FLAG_INSIDE_WORKROOT/);
  });

  it('updateFlagPath outside workRoot still boots (no behaviour change for a valid config)', async () => {
    await expect(
      composeConfig({ gateway: 'direct-fetch', workRoot: '/var/rwe/data', updateFlagPath: '/var/rwe/update.flag' } as any, FAKE_DEPS),
    ).resolves.toBeDefined();
  });

  it('a non-https seedRefAllowlist entry refuses to start (same normalizeSeedRefAllowlist rule RunManager already enforces)', async () => {
    await expect(
      composeConfig({ gateway: 'direct-fetch', seedRefAllowlist: ['http://seeds.example/'] } as any, FAKE_DEPS),
    ).rejects.toThrow(/seedRefAllowlist entry must use https/);
  });

  // B4/B21: non-positive/non-integer caps and ceilings — every one of these boots today with the
  // bad value simply breaking the feature at runtime (agentSlots<=0 wedges every agent() call
  // forever; the others refuse every override/registration) instead of refusing at boot.
  it.each([
    ['agentSlots', 0],
    ['agentSlots', -1],
    ['agentSlots', 1.5],
    ['runConcurrency', 0],
    ['maxWorkflowDepth', 0],
    ['maxWorkflowDescendants', -1],
    ['maxConcurrentRuns', 0],
    ['maxTimeoutMs', 0],
    ['maxAppendPromptBytes', -1],
    ['maxWorkflowVersions', 0],
  ])('%s: a non-positive/non-integer value (%s) refuses to start, naming the key', async (key, value) => {
    await expect(composeConfig({ gateway: 'direct-fetch', [key]: value } as any, FAKE_DEPS)).rejects.toThrow(
      new RegExp(key as string),
    );
  });

  it.each([
    ['agentSlots', 7],
    ['runConcurrency', 40],
    ['maxWorkflowDepth', 5],
    ['maxWorkflowDescendants', 300],
    ['maxConcurrentRuns', 65],
    ['maxTimeoutMs', 900000],
    ['maxAppendPromptBytes', 2048],
    ['maxWorkflowVersions', 12],
  ])('%s: a valid positive-integer value (%s) still boots (no behaviour change)', async (key, value) => {
    await expect(composeConfig({ gateway: 'direct-fetch', [key]: value } as any, FAKE_DEPS)).resolves.toBeDefined();
  });

  it('an unknown maxEffort value refuses to start, naming it and the valid set', async () => {
    await expect(composeConfig({ gateway: 'direct-fetch', maxEffort: 'ultra' } as any, FAKE_DEPS)).rejects.toThrow(
      /maxEffort.*"ultra"/s,
    );
  });

  it('every real maxEffort value still boots (no behaviour change)', async () => {
    for (const e of ['low', 'medium', 'high', 'xhigh', 'max']) {
      await expect(composeConfig({ gateway: 'direct-fetch', maxEffort: e } as any, FAKE_DEPS)).resolves.toBeDefined();
    }
  });

  it('a non-https mcpEgressAllowlist entry refuses to start, naming the entry', async () => {
    await expect(
      composeConfig({ gateway: 'direct-fetch', mcpEgressAllowlist: ['http://mcp.example/'] } as any, FAKE_DEPS),
    ).rejects.toThrow(/mcpEgressAllowlist.*http:\/\/mcp\.example/s);
  });

  it('an https mcpEgressAllowlist entry still boots (no behaviour change)', async () => {
    await expect(
      composeConfig({ gateway: 'direct-fetch', mcpEgressAllowlist: ['https://mcp.example/'] } as any, FAKE_DEPS),
    ).resolves.toBeDefined();
  });

  it('a non-array mcpEgressAllowlist refuses to start with a clear message (never iterates a string/throws "not iterable")', async () => {
    await expect(
      composeConfig({ gateway: 'direct-fetch', mcpEgressAllowlist: 'https://mcp.example/' } as any, FAKE_DEPS),
    ).rejects.toThrow(/mcpEgressAllowlist must be an array/);
    await expect(
      composeConfig({ gateway: 'direct-fetch', mcpEgressAllowlist: 5 } as any, FAKE_DEPS),
    ).rejects.toThrow(/mcpEgressAllowlist must be an array/);
  });

  // V3-M1/V3-M2 (repair-round defects, 2026-10-06): these lock the ACTUAL composeConfig() wiring,
  // not just the standalone validator functions — this codebase's documented wiring-bug class is
  // "a config block is forwarded/validated correctly in isolation but the composeConfig() call site
  // itself never passes the option through" (compose-config-v2-wiring bug class). A regression that
  // reverted `main.ts`'s CONFIG_PREFIX argument, or its `{ frame: true }` argument, would still pass
  // every other test above (they only check the key name appears) but must fail these.
  it('V3-M2: a positive-integer refusal through composeConfig() is framed like every other refusal (rwe.config.json: … Refusing to start (ADR-028 fail-closed).), and a STRING value is quoted', async () => {
    await expect(
      composeConfig({ gateway: 'direct-fetch', agentSlots: '8' } as any, FAKE_DEPS),
    ).rejects.toThrow(/^rwe\.config\.json: agentSlots must be a positive integer, got "8"\. Refusing to start \(ADR-028 fail-closed\)\.$/);
  });

  it('V3-M1: the mcpEgressAllowlist refusal through composeConfig() still carries the rwe.config.json/ADR-028 framing after the assertHttpsAllowlist refactor', async () => {
    await expect(
      composeConfig({ gateway: 'direct-fetch', mcpEgressAllowlist: ['http://mcp.example/'] } as any, FAKE_DEPS),
    ).rejects.toThrow(/^rwe\.config\.json: mcpEgressAllowlist entry must use https.*Refusing to start \(ADR-028 fail-closed\)\.$/s);
  });
});

// Repair round defect NULL-WAS-DEFAULT (2026-10-06): before this round, an explicit JSON `null`
// meant "use the default" for several of these same keys (`gateway` fell back to `?? "sdk"`,
// `agentSlots` to `?? 32`, etc. — see the call sites this guards). The new A8/A9/B4/B21 refusal
// guards above were written with `!== undefined`/`value === undefined` checks, which treat an
// explicit `null` as a PRESENT bad value and refuse a config that used to boot clean. "No
// behaviour change for valid configs" (the A8/A9/B21 owner decisions) means `null` must still be
// absent, same as before this round.
describe('an explicit JSON null is still treated as absent, not a bad value (NULL-WAS-DEFAULT)', () => {
  it('gateway: null still defaults to "sdk" (does not refuse)', async () => {
    const cfg = await composeConfig({ gateway: null } as any, FAKE_DEPS);
    expect(cfg.gateway).toBeDefined();
  });

  it('seedRefAllowlist: null still boots (does not refuse)', async () => {
    await expect(
      composeConfig({ gateway: 'direct-fetch', seedRefAllowlist: null } as any, FAKE_DEPS),
    ).resolves.toBeDefined();
  });

  it.each([
    'agentSlots', 'runConcurrency', 'maxWorkflowDepth', 'maxWorkflowDescendants',
    'maxConcurrentRuns', 'maxTimeoutMs', 'maxAppendPromptBytes', 'maxWorkflowVersions',
  ])('%s: null still boots (does not refuse)', async (key) => {
    await expect(
      composeConfig({ gateway: 'direct-fetch', [key]: null } as any, FAKE_DEPS),
    ).resolves.toBeDefined();
  });

  it('maxEffort: null still boots (does not refuse)', async () => {
    await expect(
      composeConfig({ gateway: 'direct-fetch', maxEffort: null } as any, FAKE_DEPS),
    ).resolves.toBeDefined();
  });

  it('mcpEgressAllowlist: null still boots (does not refuse)', async () => {
    await expect(
      composeConfig({ gateway: 'direct-fetch', mcpEgressAllowlist: null } as any, FAKE_DEPS),
    ).resolves.toBeDefined();
  });
});

// Repair round defect A1-LEGACYOWNER-TYPE (2026-10-06): `auth.legacyOwner` is a principal-id
// STRING (auth-service.ts), but nothing checked that at boot — a number or an empty string passed
// `--check-config` clean. Every other key this repair round touches refuses the wrong type; this
// one didn't. A number can never match a principal-id comparison (authz.ts: `owner === principal.id`
// is always string-vs-string), so it silently produces an owner column no caller can ever own.
describe('auth.legacyOwner: a non-string/empty value refuses to start (A1-LEGACYOWNER-TYPE)', () => {
  it('refuses a numeric legacyOwner', async () => {
    await expect(
      composeConfig({ gateway: 'direct-fetch', auth: { legacyOwner: 123 } } as any, FAKE_DEPS),
    ).rejects.toThrow(/auth\.legacyOwner/);
  });

  it('refuses an empty-string legacyOwner', async () => {
    await expect(
      composeConfig({ gateway: 'direct-fetch', auth: { legacyOwner: '' } } as any, FAKE_DEPS),
    ).rejects.toThrow(/auth\.legacyOwner/);
  });

  it('still accepts a non-empty string legacyOwner (no behaviour change for a valid config)', async () => {
    const cfg = await composeConfig(
      { gateway: 'direct-fetch', auth: { legacyOwner: 'ops@example.com' } } as any,
      FAKE_DEPS,
    );
    expect(((cfg as Record<string, unknown>)['auth'] as Record<string, unknown>)['legacyOwner']).toBe('ops@example.com');
  });

  it('still accepts an absent legacyOwner (null or omitted)', async () => {
    await expect(composeConfig({ gateway: 'direct-fetch', auth: {} } as any, FAKE_DEPS)).resolves.toBeDefined();
    await expect(
      composeConfig({ gateway: 'direct-fetch', auth: { legacyOwner: null } } as any, FAKE_DEPS),
    ).resolves.toBeDefined();
  });
});

// Issue #73: `modelProbe` is validated at config load (fail-closed) and defaulted when absent — a
// bad value must refuse the boot rather than silently disable or mis-schedule the probe.
describe('modelProbe is validated and defaulted by composeConfig (#73)', () => {
  it('absent -> enabled weekly defaults land on ServerConfig', async () => {
    const cfg = await composeConfig({ gateway: 'direct-fetch' }, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['modelProbe']).toEqual({ enabled: true, intervalMs: 604_800_000, timeoutMs: 60_000 });
  });
  it('a bad value refuses to start, naming the key', async () => {
    await expect(composeConfig({ gateway: 'direct-fetch', modelProbe: { intervalMs: 5 } } as any, FAKE_DEPS)).rejects.toThrow(/modelProbe/);
    await expect(composeConfig({ gateway: 'direct-fetch', modelProbe: { enabled: 'yes' } } as any, FAKE_DEPS)).rejects.toThrow(/modelProbe/);
  });
});

// Owner decision 2026-10-02: casQuota/diskFloor accept human units and partial objects in
// rwe.config.json — composeConfig() normalizes them (bytes, defaults filled) and refuses boot on a
// malformed value (ADR-028 fail-closed), never silently dropping it.
describe('casQuota / diskFloor normalization at composeConfig()', () => {
  it('human units and partial objects are normalized with defaults filled', async () => {
    const cfg = await composeConfig({ casQuota: { user: '2GiB' }, diskFloor: { bytes: '1GiB' }, gateway: 'direct-fetch' } as any, FAKE_DEPS);
    expect((cfg as Record<string, unknown>)['casQuota']).toEqual({ user: 2 * 1024 ** 3, author: 5 * 1024 ** 3, admin: null });
    expect((cfg as Record<string, unknown>)['diskFloor']).toEqual({ percent: 5, bytes: 1024 ** 3 });
  });
  it('a malformed value refuses to start', async () => {
    await expect(composeConfig({ casQuota: { user: 'lots' }, gateway: 'direct-fetch' } as any, FAKE_DEPS)).rejects.toThrow(/casQuota/);
    await expect(composeConfig({ diskFloor: { percent: 500 }, gateway: 'direct-fetch' } as any, FAKE_DEPS)).rejects.toThrow(/diskFloor/);
  });
});
