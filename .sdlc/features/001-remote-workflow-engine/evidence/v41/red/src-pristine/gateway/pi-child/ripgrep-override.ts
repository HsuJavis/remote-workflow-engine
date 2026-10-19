// src/gateway/pi-child/ripgrep-override.ts (pi harness v1, design change 1). PURE-ish — only
// node:module/node:path/node:fs builtins, ZERO local imports — safe to load from anywhere
// (session-runner.ts via a `.js` specifier, entry.ts's probe mode via the same) regardless of which
// runtime resolves it, same dual-load safety as bash-env.ts/protocol.ts.
//
// pi-spike-report.md S1: srt's `initialize()` requires a REAL `rg` binary on PATH (bwrap+socat are
// not enough) and throws fail-closed if missing. On a host with the Claude CLI installed, `rg` is
// often only a shell FUNCTION that execs the CLI's own multicall binary with `argv0=rg` (confirmed
// on the spike's dev host) — a PATH-walk check correctly reports it missing, so the pi-path
// confinement probe would read `unconfined` on a host that is actually fine. The real-world fix
// (ship it, not add a new system package dependency): point srt's own `ripgrep: {command, argv0}`
// override at the SAME multicall binary the engine's bundled `@anthropic-ai/claude-agent-sdk`
// dependency already installs (`@anthropic-ai/claude-agent-sdk-<platform>` is its own package,
// shipping one `claude` binary that answers to `argv0=rg` as ripgrep).
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const CANDIDATE_PACKAGES = ['@anthropic-ai/claude-agent-sdk-linux-x64', '@anthropic-ai/claude-agent-sdk-linux-x64-musl', '@anthropic-ai/claude-agent-sdk-darwin-arm64', '@anthropic-ai/claude-agent-sdk-darwin-x64'] as const;

export interface RipgrepOverride {
  command: string;
  argv0: 'rg';
}

/** `null` when none of the bundled native-CLI packages resolve from this process (e.g. a platform
 *  the engine's own `@anthropic-ai/claude-agent-sdk` optionalDependency never installed a binary
 *  for) — callers must treat that as "no override available", never silently proceed without one. */
export function resolveRipgrepOverride(): RipgrepOverride | null {
  const require = createRequire(import.meta.url);
  for (const pkg of CANDIDATE_PACKAGES) {
    try {
      const pkgJsonPath = require.resolve(`${pkg}/package.json`);
      const binPath = join(dirname(pkgJsonPath), 'claude');
      if (existsSync(binPath)) return { command: binPath, argv0: 'rg' };
    } catch {
      // this candidate package isn't installed on this platform — try the next one
    }
  }
  return null;
}
