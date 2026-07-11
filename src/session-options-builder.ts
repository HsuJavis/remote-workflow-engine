// Pure SDK Session-Options Builder (DES-026 / ARCH-017 / TASK-032): the master v3 test seam.
// Imports no fs/net/process/clock/env — capability lives in a flat boot-validated ProviderProfile
// row per alias (single source of truth shared with the ARCH-008 alias validator). Sets
// thinking:{disabled} for non-Anthropic aliases (D-F6 400 regression guard; Anthropic stays at SDK
// default), the curated tool allowlist only, and the strict injected-MCP set. Emits one
// SessionInitRecord (handle NAMES only, never resolved secret values) as the transcript head.
// DES-031 session-init re-walk: re-runs findProjectMarkerAncestor(cwd, workRoot) and refuses the
// build (typed error) if a marker is found — closes the intra-run REQ-021 leak an agent re-opens
// by writing a marker into its workspace after boot's one-time check.

import { findProjectMarkerAncestor } from './workroot-guard.js';

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
  /** DES-031 R9: the settings-source selection for the CLI call — never contains 'user' or 'local'
   *  (those would load ~/.claude/CLAUDE.md global memory into every agent call). */
  settingSources: string[];
  /** DES-031 audit trail: the realpath-resolved project root used for the session, for traceability. */
  resolvedProjectRoot: string | null;
}

export interface SessionOptionsConfig {
  modelId: string;
  cwd: string;
  /** DES-031: when provided, the session-init re-walk checks for project markers between cwd and
   *  workRoot (exclusive) and refuses the build if one is found. */
  workRoot?: string;
}

export type BuildSessionOptionsResult =
  | { ok: true; sessionInit: SessionInitRecord }
  | { ok: false; error: 'ALIAS_PROFILE_MISSING' | 'WORKROOT_INSIDE_PROJECT' };

/** PURE — no fs/net/process/clock/env read (unless existsImpl/realpathImpl use real fs).
 *  An alias with no ProviderProfile row fails safe (thinking would default to disabled if it were
 *  ever built) and is rejected outright via ALIAS_PROFILE_MISSING (defense in depth with the
 *  ARCH-008 submission-time check).
 *
 *  When config.workRoot is present and existsImpl/realpathImpl are supplied (or default to real fs),
 *  the session-init re-walk (DES-031) is performed: if a .git/CLAUDE.md marker is found between
 *  config.cwd and config.workRoot (exclusive), the build is refused with WORKROOT_INSIDE_PROJECT. */
export function buildSessionOptions(
  alias: string,
  profile: ProviderProfile | undefined,
  config: SessionOptionsConfig,
  provisionedRefs: Record<string, unknown>,
  secretHandleNames: string[],
  allowlist: string[],
  existsImpl?: (p: string) => boolean,
  realpathImpl?: (p: string) => string,
): BuildSessionOptionsResult {
  if (!profile) return { ok: false, error: 'ALIAS_PROFILE_MISSING' };

  // DES-031 session-init re-walk: if a workRoot is known, check that the run-workspace cwd
  // has not had a project marker written into it since boot (an agent could create .git/CLAUDE.md
  // inside its workspace, re-opening the REQ-021 leak after the one-time boot check).
  if (config.workRoot !== undefined && existsImpl !== undefined && realpathImpl !== undefined) {
    const hit = findProjectMarkerAncestor(config.cwd, config.workRoot, existsImpl, realpathImpl);
    if (hit !== null) {
      return { ok: false, error: 'WORKROOT_INSIDE_PROJECT' };
    }
  } else if (config.workRoot !== undefined) {
    // workRoot given but no injected impls — use real fs for the walk.
    // Import lazily to keep the default fast-path and preserve purity for pure-UT callers that
    // supply existsImpl/realpathImpl. The dynamic require is only hit when the caller omits impls.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { existsSync } = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { realpathSync } = require('node:fs') as typeof import('node:fs');
    const safeRealpath = (p: string): string => {
      try { return realpathSync(p); } catch { return p; }
    };
    const hit = findProjectMarkerAncestor(config.cwd, config.workRoot, existsSync, safeRealpath);
    if (hit !== null) {
      return { ok: false, error: 'WORKROOT_INSIDE_PROJECT' };
    }
  }

  const thinkingMode: ThinkingMode = profile.providerClass === 'anthropic' ? 'sdk-default' : 'disabled';

  // DES-031 R9: settingSources must NEVER contain 'user' or 'local' — loading those would
  // pull ~/.claude/CLAUDE.md global memory into every agent call (the global-memory leak class
  // the workRoot walk cannot catch, held only by this ternary).
  const settingSources: string[] = ['project'];

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
      settingSources,
      resolvedProjectRoot: config.cwd,
    },
  };
}
