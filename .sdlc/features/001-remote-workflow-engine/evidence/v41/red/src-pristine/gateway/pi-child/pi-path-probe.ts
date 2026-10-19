// src/gateway/pi-child/pi-path-probe.ts (pi harness v1, spec "Confinement posture", design
// changes 1/2). A SEPARATE measurement from the sdk gateway's own boot probe
// (src/gateway/confinement-probe.ts) — srt's bundled sandbox-runtime version may not match the one
// vendored inside the Claude CLI binary the sdk path measures, and srt has its OWN hard dependency
// (a real `rg` binary, not the shell-function alias a Claude-CLI-equipped host commonly has — spike
// S1) the sdk probe never checks. Run via entry.ts's `--probe` mode (its own child process, never
// the main engine process) so srt's process-global `SandboxManager` state and its lingering internal
// handles never touch the long-lived engine — see pi-spike-report.md's own cleanup notes.
//
// Typechecked (unlike entry.ts): `isWrapped`/`resolveRipgrep` are injected as parameters (DI), never
// imported directly — this file is itself loaded by entry.ts via an explicit `.ts` specifier under
// raw node, same reasoning as session-runner.ts's own SessionDeps (a top-level local VALUE import
// here would break under that loading path).
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';

export interface PiPathProbeResult {
  readonly posture: 'confined' | 'unconfined';
  readonly reason?: string;
}

/** Mirrors confinement-probe.ts's own nested-bwrap shape as closely as srt's API allows: rather than
 *  hand-building a second raw `bwrap --unshare-user ...` invocation, this asks srt itself to wrap a
 *  real command (`true`) with a real filesystem+network policy, then (a) verifies the RETURNED argv
 *  actually contains a real bwrap invocation (`isWrapped`, design change 2 — never trust `argv[0]`)
 *  and (b) actually RUNS it and checks for exit 0 — the same "try it, don't guess" principle
 *  confinement-probe.ts's own header comment states for the sdk path. */
export async function runPiPathProbe(
  deps: { isWrapped: (argv: readonly string[]) => boolean },
  execWrapped: (argv: readonly string[], env: NodeJS.ProcessEnv) => Promise<number | null>,
  resolveRipgrep: () => { command: string; argv0: 'rg' } | null,
): Promise<PiPathProbeResult> {
  const ripgrepOverride = resolveRipgrep();
  if (ripgrepOverride === null) {
    return { posture: 'unconfined', reason: 'no bundled ripgrep-capable CLI binary found on this host (srt requires a real `rg` binary on PATH, which this engine supplies via the bundled @anthropic-ai/claude-agent-sdk-<platform> package)' };
  }
  try {
    await SandboxManager.initialize(
      {
        network: { allowedDomains: [], deniedDomains: [] },
        filesystem: { allowWrite: [], allowRead: [], denyRead: [], denyWrite: [] },
        ripgrep: ripgrepOverride,
      } as Parameters<typeof SandboxManager.initialize>[0],
      async () => true,
    );
  } catch (err) {
    return { posture: 'unconfined', reason: `srt SandboxManager.initialize() failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  // review L1: `SandboxManager.initialize()` above starts srt's mux proxy, which opens a unix socket
  // under `os.tmpdir()` (`srt-mux-<this process's pid>-<seq>.sock` — see srt-mux-sweep.ts's own
  // header for the full "why srt's own exit-time cleanup is not enough" reasoning, identical here).
  // This probe runs in its OWN short-lived `entry.ts --probe` child specifically so that process
  // (never the long-lived engine) owns any srt-left-behind state — but until this `finally`, NOTHING
  // ever called `SandboxManager.reset()` before that child's `process.exit(0)`, leaking one socket
  // per boot probe / `--check-config` invocation forever. `reset()` is async and best-effort (never
  // lets a teardown failure change the measured posture) — matches session-runner.ts's own
  // `resetSandboxManager()` for the dispatch path exactly.
  try {
    const { argv, env } = await SandboxManager.wrapWithSandboxArgv(
      'true',
      'bash',
      { filesystem: { allowWrite: [], allowRead: [], denyRead: [], denyWrite: [] }, network: { allowedDomains: [], deniedDomains: [] }, enableWeakerNestedSandbox: false } as Parameters<typeof SandboxManager.wrapWithSandboxArgv>[2],
    );
    if (!deps.isWrapped(argv)) {
      return { posture: 'unconfined', reason: 'wrapWithSandboxArgv did not produce a real bwrap invocation on this host' };
    }
    const exitCode = await execWrapped(argv, env);
    if (exitCode !== 0) {
      return { posture: 'unconfined', reason: `the wrapped probe command exited ${String(exitCode)} (expected 0)` };
    }
    return { posture: 'confined' };
  } catch (err) {
    return { posture: 'unconfined', reason: `srt wrapWithSandboxArgv probe failed: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    try { await SandboxManager.reset(); } catch { /* best-effort teardown, never block the probe result on this */ }
  }
}
