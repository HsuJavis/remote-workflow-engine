// UT-044: Pure SDK Session-Options Builder + ProviderProfile + SessionInitRecord (DES-026, TASK-032)
// RED: src/session-options-builder.js does not exist yet — all tests fail on module-not-found.
import { describe, it, expect, vi } from 'vitest';
// Value import — causes module-not-found at load time when the module is absent.
import { buildSessionOptions, type ProviderProfile } from '../../src/session-options-builder.js';

const ANTHROPIC_PROFILE: ProviderProfile = {
  providerClass: 'anthropic', supportsExtendedThinking: true, timeoutMs: 30000, retries: 1,
};
const NON_ANTHROPIC_PROFILE: ProviderProfile = {
  providerClass: 'non-anthropic', supportsExtendedThinking: false, timeoutMs: 30000, retries: 1,
};

const CONFIG = { modelId: 'qwen2.5:7b', cwd: '/work/run-1' };
const ALLOWLIST = ['Read', 'Write'];

describe('buildSessionOptions — thinking policy (D-F6 regression guard, DES-026)', () => {
  it('a non-Anthropic alias gets thinking DISABLED (never 400s a non-reasoning model)', () => {
    const out = buildSessionOptions('local-qwen', NON_ANTHROPIC_PROFILE, CONFIG, {}, [], ALLOWLIST);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.sessionInit.thinkingMode).toBe('disabled');
    }
  });

  it('an Anthropic-mapped alias is left at SDK default (thinking not forced disabled)', () => {
    const out = buildSessionOptions('claude-main', ANTHROPIC_PROFILE, CONFIG, {}, [], ALLOWLIST);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.sessionInit.thinkingMode).toBe('sdk-default');
    }
  });
});

describe('buildSessionOptions — curated allowlist + strict-injected MCP + secret handle names (DES-026)', () => {
  it('the tool surface exposed is the curated allowlist ONLY, never a wider default', () => {
    const out = buildSessionOptions('local-qwen', NON_ANTHROPIC_PROFILE, CONFIG, {}, [], ['Read']);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.sessionInit.allowlist).toEqual(['Read']);
  });

  it('only the explicitly-provisioned/referenced MCP names appear in the session init record', () => {
    const out = buildSessionOptions(
      'local-qwen', NON_ANTHROPIC_PROFILE, CONFIG,
      { search: { command: 'npx' } }, [], ALLOWLIST,
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.sessionInit.injectedMcpNames).toEqual(['search']);
  });

  it('secret handle NAMES appear in the session init record, never resolved VALUES', () => {
    const out = buildSessionOptions(
      'local-qwen', NON_ANTHROPIC_PROFILE, CONFIG, {}, ['api-token'], ALLOWLIST,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.sessionInit.secretHandleNames).toEqual(['api-token']);
      expect(JSON.stringify(out.sessionInit)).not.toContain('resolved-secret-value');
    }
  });
});

describe('buildSessionOptions — unprofiled alias fail-safe default (D-V3i, DES-026)', () => {
  it('an alias with no ProviderProfile row returns ALIAS_PROFILE_MISSING (fail-safe, not fail-open)', () => {
    const out = buildSessionOptions('never-configured-alias', undefined, CONFIG, {}, [], ALLOWLIST);
    expect(out).toEqual({ ok: false, error: 'ALIAS_PROFILE_MISSING' });
  });
});

describe('buildSessionOptions — purity (DES-026 testability: frozen input -> deterministic, no env/clock read)', () => {
  it('the SAME frozen input produces a deep-equal result on every call', () => {
    const out1 = buildSessionOptions('local-qwen', NON_ANTHROPIC_PROFILE, CONFIG, {}, [], ALLOWLIST);
    const out2 = buildSessionOptions('local-qwen', NON_ANTHROPIC_PROFILE, CONFIG, {}, [], ALLOWLIST);
    expect(out1).toEqual(out2);
  });

  it('never reads the wall clock (Date.now/Date constructor untouched by a pure builder call)', () => {
    const dateNowSpy = vi.spyOn(Date, 'now');
    buildSessionOptions('local-qwen', NON_ANTHROPIC_PROFILE, CONFIG, {}, [], ALLOWLIST);
    expect(dateNowSpy).not.toHaveBeenCalled();
    dateNowSpy.mockRestore();
  });
});
