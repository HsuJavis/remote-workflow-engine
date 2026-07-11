// Pure SDK Session-Options Builder (DES-026 / ARCH-017 / TASK-032): the master v3 test seam.
// Imports no fs/net/process/clock/env — capability lives in a flat boot-validated ProviderProfile
// row per alias (single source of truth shared with the ARCH-008 alias validator). Sets
// thinking:{disabled} for non-Anthropic aliases (D-F6 400 regression guard; Anthropic stays at SDK
// default), the curated tool allowlist only, and the strict injected-MCP set. Emits one
// SessionInitRecord (handle NAMES only, never resolved secret values) as the transcript head.

export interface ProviderProfile {
  providerClass: 'anthropic' | 'non-anthropic';
  supportsExtendedThinking: boolean;
  timeoutMs: number;
  retries: number;
  effortMapping?: Record<string, unknown>;
}

export type ThinkingMode = 'disabled' | 'sdk-default';

export interface SessionInitRecord {
  alias: string;
  provider: string;
  modelId: string;
  thinkingMode: ThinkingMode;
  allowlist: string[];
  injectedMcpNames: string[];
  secretHandleNames: string[];
  cwd: string;
}

export interface SessionOptionsConfig {
  modelId: string;
  cwd: string;
}

export type BuildSessionOptionsResult =
  | { ok: true; sessionInit: SessionInitRecord }
  | { ok: false; error: 'ALIAS_PROFILE_MISSING' };

/** PURE — no fs/net/process/clock/env read. An alias with no ProviderProfile row fails safe
 *  (thinking would default to disabled if it were ever built) and is rejected outright via
 *  ALIAS_PROFILE_MISSING (defense in depth with the ARCH-008 submission-time check). */
export function buildSessionOptions(
  alias: string,
  profile: ProviderProfile | undefined,
  config: SessionOptionsConfig,
  provisionedRefs: Record<string, unknown>,
  secretHandleNames: string[],
  allowlist: string[],
): BuildSessionOptionsResult {
  if (!profile) return { ok: false, error: 'ALIAS_PROFILE_MISSING' };
  const thinkingMode: ThinkingMode = profile.providerClass === 'anthropic' ? 'sdk-default' : 'disabled';
  return {
    ok: true,
    sessionInit: {
      alias,
      provider: profile.providerClass,
      modelId: config.modelId,
      thinkingMode,
      allowlist: [...allowlist],
      injectedMcpNames: Object.keys(provisionedRefs),
      secretHandleNames: [...secretHandleNames],
      cwd: config.cwd,
    },
  };
}
