// UT-311/UT-312 (DES-254/DES-255, ARCH-177, TASK-252, REQ-218) — composeConfig() wires the
// operator's `sandbox.allowHostPaths` grant: boot REFUSES an offending entry (validateHostPathGrants
// + formatGrantRefusals), and `protectedFiles` come from the config file `loadFileConfig()` actually
// read, never a re-`resolve()` against whatever cwd systemd happened to give the process.
// Written test-first (Gate 5, RED): main.ts never calls validateHostPathGrants(), and
// loadFileConfig() is not exported / does not return `{config, path}` yet.
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeAgentSdkGatewayConfig } from '../../src/gateway/claude-agent-sdk-client.js';

// Neutralize main.ts's boot side-effects (same pattern as compose-config-v2-wiring.test.ts).
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ on: vi.fn(), kill: vi.fn(), pid: 99 })) }));
process.exit = vi.fn() as unknown as typeof process.exit;
import { composeConfig, loadFileConfig } from '../../src/main.js';

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

function makeWorkRoot(): string {
  return mkdtempSync(join(tmpdir(), 'rwe-sandboxcfg-'));
}

function gatewayConfinement(cfg: Awaited<ReturnType<typeof composeConfig>>): { allowHostPaths?: readonly string[]; protectedFiles?: readonly string[] } | undefined {
  return (cfg.gateway as unknown as { _config: { confinement?: { allowHostPaths?: readonly string[]; protectedFiles?: readonly string[] } } })._config.confinement;
}

describe('UT-311 composeConfig() refuses boot on an invalid sandbox.allowHostPaths grant (DES-254)', () => {
  it('a relative grant refuses boot, naming the offending entry', async () => {
    const workRoot = makeWorkRoot();
    await expect(
      composeConfig({ gateway: 'direct-fetch', workRoot, sandbox: { allowHostPaths: ['relative/cache'] } } as any, FAKE_DEPS),
    ).rejects.toThrow(/relative\/cache/);
    rmSync(workRoot, { recursive: true, force: true });
  });

  it('a grant inside workRoot (e.g. <workRoot>/cas) refuses boot', async () => {
    const workRoot = makeWorkRoot();
    await expect(
      composeConfig({ gateway: 'direct-fetch', workRoot, sandbox: { allowHostPaths: [join(workRoot, 'cas')] } } as any, FAKE_DEPS),
    ).rejects.toThrow(/cas/);
    rmSync(workRoot, { recursive: true, force: true });
  });

  it('absent sandbox key ⇒ allowHostPaths:[] (the strictest posture), boot proceeds', async () => {
    const workRoot = makeWorkRoot();
    const cfg = await composeConfig({ gateway: 'sdk', workRoot } as any, FAKE_DEPS);
    expect(gatewayConfinement(cfg)?.allowHostPaths).toEqual([]);
    rmSync(workRoot, { recursive: true, force: true });
  });

  it('UT-325: a grant with NO workRoot at all refuses boot (a grant needs a workRoot anchor to validate containment against)', async () => {
    await expect(
      composeConfig({ gateway: 'direct-fetch', sandbox: { allowHostPaths: ['/some/host/path'] } } as any, FAKE_DEPS),
    ).rejects.toThrow(/sandbox\.allowHostPaths requires workRoot to be set/);
  });

  it('a valid real grant survives boot and reaches the constructed gateway', async () => {
    const workRoot = makeWorkRoot();
    const grant = mkdtempSync(join(tmpdir(), 'rwe-sandboxcfg-grant-'));
    const cfg = await composeConfig({ gateway: 'sdk', workRoot, sandbox: { allowHostPaths: [grant] } } as any, FAKE_DEPS);
    expect(gatewayConfinement(cfg)?.allowHostPaths).toEqual([grant]);
    rmSync(workRoot, { recursive: true, force: true });
    rmSync(grant, { recursive: true, force: true });
  });
});

describe('UT-312 protectedFiles come from the file loadFileConfig() actually read (DES-255)', () => {
  it('loadFileConfig() returns {config, path} — path is the absolute file it read (an ABSOLUTE RWE_CONFIG_PATH unrelated to process.cwd(), which vitest workers cannot change)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-loadcfg-'));
    const cfgPath = join(dir, 'rwe.config.json');
    writeFileSync(cfgPath, JSON.stringify({ port: 9999 }));
    const prevEnv = process.env['RWE_CONFIG_PATH'];
    process.env['RWE_CONFIG_PATH'] = cfgPath;
    try {
      const { config, path } = loadFileConfig();
      expect(config.port).toBe(9999);
      expect(path).toBe(cfgPath);
    } finally {
      if (prevEnv === undefined) delete process.env['RWE_CONFIG_PATH'];
      else process.env['RWE_CONFIG_PATH'] = prevEnv;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loadFileConfig() throws naming the path when the config file exists but is not valid JSON (coverage-gate item 1b, Gate 6.5+7)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-loadcfg-badjson-'));
    const cfgPath = join(dir, 'rwe.config.json');
    writeFileSync(cfgPath, '{ this is not json');
    const prevEnv = process.env['RWE_CONFIG_PATH'];
    process.env['RWE_CONFIG_PATH'] = cfgPath;
    try {
      expect(() => loadFileConfig()).toThrow(new RegExp(`${cfgPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*not valid JSON`));
    } finally {
      if (prevEnv === undefined) delete process.env['RWE_CONFIG_PATH'];
      else process.env['RWE_CONFIG_PATH'] = prevEnv;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loadFileConfig() returns path:undefined when no config file exists on disk', () => {
    const prevEnv = process.env['RWE_CONFIG_PATH'];
    process.env['RWE_CONFIG_PATH'] = join(tmpdir(), `rwe-does-not-exist-${Date.now()}`, 'rwe.config.json');
    try {
      const { path } = loadFileConfig();
      expect(path).toBeUndefined();
    } finally {
      if (prevEnv === undefined) delete process.env['RWE_CONFIG_PATH'];
      else process.env['RWE_CONFIG_PATH'] = prevEnv;
    }
  });

  it('composeConfig(fileConfig, {configPath}) puts that EXACT path at confinement.protectedFiles[0], never a re-resolve against cwd', async () => {
    const workRoot = makeWorkRoot();
    const dir = mkdtempSync(join(tmpdir(), 'rwe-loadcfg2-'));
    const cfgPath = join(dir, 'rwe.config.json');
    writeFileSync(cfgPath, JSON.stringify({}));
    const cfg = await composeConfig({ gateway: 'sdk', workRoot } as any, { ...FAKE_DEPS, configPath: cfgPath } as any);
    const protectedFiles = gatewayConfinement(cfg)?.protectedFiles ?? [];
    expect(protectedFiles[0]).toBe(cfgPath);
    expect(protectedFiles[1]).toBe(join(workRoot, 'auth-tokens.db'));
    rmSync(workRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  // v37 Gate-8 send-back (finding A3, ARCH-175 amendment): no config file on disk still means
  // `deps.configPath` contributes nothing, but `protectedFiles` is no longer JUST the auth DB —
  // every operator-overridable engine path (casDir/assetRoot/webhookDbPath/schedulerDbPath/
  // selfUpdateDbPath/continuationDbPath) reaches it too, resolved to its own server.ts-matching
  // default, because `denyRead` may never depend on an override having been EXPLICITLY set
  // (INV-V37-4).
  it('no config file on disk ⇒ protectedFiles is the auth DB plus every engine path\'s own default', async () => {
    const workRoot = makeWorkRoot();
    const cfg = await composeConfig({ gateway: 'sdk', workRoot } as any, FAKE_DEPS);
    expect(gatewayConfinement(cfg)?.protectedFiles).toEqual([
      join(workRoot, 'auth-tokens.db'),
      join(workRoot, 'cas'),
      join(workRoot, 'assets'),
      join(workRoot, 'webhooks.db'),
      join(workRoot, 'schedules.db'),
      join(workRoot, 'self-update.db'),
      join(workRoot, 'continuations.db'),
    ]);
    rmSync(workRoot, { recursive: true, force: true });
  });

  // v37 Gate-8 send-back (finding A3): the OVERRIDE case — an operator-set casDir/assetRoot/etc.
  // (pointing wherever they like) reaches protectedFiles as the RESOLVED value, never the key name,
  // so a grant covering it is refused for the first time.
  it('an operator-overridden casDir/selfUpdateDbPath reaches protectedFiles as the resolved value, not the default', async () => {
    const workRoot = makeWorkRoot();
    const customCas = join(workRoot, 'custom-cas');
    const customSelfUpdate = join(workRoot, 'custom-selfupdate.db');
    const cfg = await composeConfig({ gateway: 'sdk', workRoot, casDir: customCas, selfUpdateDbPath: customSelfUpdate } as any, FAKE_DEPS);
    const protectedFiles = gatewayConfinement(cfg)?.protectedFiles ?? [];
    expect(protectedFiles).toContain(customCas);
    expect(protectedFiles).toContain(customSelfUpdate);
    expect(protectedFiles).not.toContain(join(workRoot, 'cas'));
    expect(protectedFiles).not.toContain(join(workRoot, 'self-update.db'));
    rmSync(workRoot, { recursive: true, force: true });
  });
});
