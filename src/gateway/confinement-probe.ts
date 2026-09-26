// src/gateway/confinement-probe.ts (ARCH-181, DES-261, TASK-257, REQ-218, ADR-083 owner_decision
// posture C): whether Bash confinement is available is a fact about THIS HOST, never a config knob
// and never hardcoded — TASK-250's spike found a working host and a broken one measure identically
// on paper (bwrap present, unshare permissive) and differ only in whether the CLI's own
// apply-seccomp step can open a SECOND nested user namespace. So the only honest answer is to try it,
// once, at boot — the same nested-bwrap probe the owner_decision's own independent re-verification
// used (02-architecture.md ADR-083): a bare, single `bwrap --unshare-user ...` succeeding proves
// nothing (S1) — it is the NESTED invocation that fails on a host like this one.
//
// Impure (spawns a real subprocess) — deliberately kept OUT of bash-confinement.ts, which stays
// fs/process/env/clock-free so its own contract never depends on what this measures.
import { spawnSync } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { delimiter, join } from 'node:path';

export type ConfinementPosture = 'confined' | 'unconfined';
export interface ConfinementProbeResult {
  readonly posture: ConfinementPosture;
  /** Present only when posture is 'unconfined' — the probe's own stderr/error, so an operator
   *  reading the boot line (or the confinement-posture ARCH-178 event) sees WHY, not just THAT. */
  readonly reason?: string;
}

// issue #93 item 1: BOTH layers now add `--proc /proc --dev /dev`, mirroring the Claude CLI's own
// sandbox invocation (confirmed by inspecting the strings in the CLI binary). Verified on this host
// (Ubuntu 26.04, `kernel.apparmor_restrict_unprivileged_userns=0` + `bwrap-userns-restrict`
// AppArmor profile disabled — see CONFINEMENT_REMEDIATION below) that the OUTER layer must mount a
// fresh `/proc` for the INNER `bwrap` to be able to set up its own uid map at all: without `--proc`
// here, the inner invocation fails with "bwrap: setting up uid map: Read-only file system" even
// though a real nested bwrap (CLI-shaped, both layers carrying `--proc --dev`) succeeds — the
// pre-fix probe args gave a FALSE `unconfined` reading on a host that can actually run confined.
const NESTED_BWRAP_ARGS = [
  '--unshare-user', '--unshare-pid', '--ro-bind', '/', '/', '--tmpfs', '/tmp', '--proc', '/proc', '--dev', '/dev', '--',
  'bwrap', '--unshare-user', '--unshare-pid', '--ro-bind', '/', '/', '--tmpfs', '/tmp', '--proc', '/proc', '--dev', '/dev', '--', '/bin/true',
];

/** issue #93 item 1: the operator remediation for a host whose nested-bwrap probe fails ONLY
 *  because of the AppArmor `bwrap-userns-restrict` hardening most current Ubuntu releases ship
 *  with (which blocks a SECOND, nested unprivileged user namespace) — the exact fix the owner
 *  applied and re-verified on this host (see this module's own header comment / DES-261 ADR-083
 *  posture C's independent re-verification). Exported so every surface that tells an operator WHY
 *  this host measured `unconfined` (the boot log line, the `CONFINEMENT_UNAVAILABLE` error hint,
 *  DEPLOY.md) states the SAME remediation, once, never re-typed. Security trade-off stated in one
 *  sentence (also carried into DEPLOY.md, ARCH-181 owner_decision): this permits any unprivileged
 *  process on the host to create nested user namespaces, which is the exact primitive the AppArmor
 *  profile existed to restrict, so apply it only on a host where every user of this engine is
 *  already trusted at the OS level — not on a shared/multi-tenant box. */
export const CONFINEMENT_REMEDIATION =
  // send-back item 1 (verify-b, 2026-09-26): a nested-bwrap PROBE PASS is necessary but not
  // sufficient — the real Claude CLI sandbox has a SECOND hard binary dependency, `socat`, that
  // this probe never used to measure at all (confirmed via strings in the installed
  // @anthropic-ai/claude-agent-sdk-linux-x64 binary's own native checkDependencies() error
  // catalogue: "bubblewrap (bwrap) not installed", "socat not installed"; real repro on this host:
  // "sandbox required but unavailable: sandbox is enabled but dependencies are missing: socat not
  // installed"). Stated FIRST because it is the cheaper, more common fix (one apt install, vs the
  // AppArmor/sysctl change below) and because `probeConfinement()` now checks it before ever
  // spawning bwrap, so a `reason` naming a missing binary is fixed by this sentence alone.
  'the Claude CLI sandbox requires BOTH bubblewrap (bwrap) AND socat installed and on PATH — if ' +
  'the boot-time probe reason names a missing binary, install it (Ubuntu/Debian: sudo apt install ' +
  'bubblewrap socat) and restart this engine; separately, ' +
  'on an Ubuntu/AppArmor host, a nested-bwrap probe failure is usually the bwrap-userns-restrict ' +
  'AppArmor profile blocking a second, nested unprivileged user namespace — set ' +
  'kernel.apparmor_restrict_unprivileged_userns=0 (e.g. via /etc/sysctl.d/60-rwe-userns.conf, then ' +
  'sysctl --system) AND disable the profile (ln -s /etc/apparmor.d/bwrap-userns-restrict ' +
  '/etc/apparmor.d/disable/ && apparmor_parser -R /etc/apparmor.d/bwrap-userns-restrict), then ' +
  'restart this engine; this is a host-wide relaxation (any unprivileged process on the host can now ' +
  'nest user namespaces) — revert both steps (remove the sysctl override and re-enable the profile: ' +
  'rm the symlink under disable/ and apparmor_parser again) on a shared/multi-tenant host';

export type SpawnImpl = (cmd: string, args: string[], opts: { timeout: number }) => { status: number | null; error?: Error; stderr: Buffer | string };

const REAL_SPAWN: SpawnImpl = (cmd, args, opts) => spawnSync(cmd, args, opts);

export type WhichImpl = (cmd: string) => boolean;

/** Resolves `cmd` against the SAME PATH the spawned Claude CLI subprocess itself gets —
 *  claude-agent-sdk-client.ts's `buildSubprocessEnv` forwards `process.env.PATH` to the child
 *  verbatim (its own `ENV_ALLOWLIST`), so this reads `process.env.PATH` too, never a
 *  re-derivation. A pure PATH walk (`accessSync(..., X_OK)`), not a `which`/`command -v`
 *  subprocess — the probe should not gain a THIRD external-binary dependency of its own just to
 *  check the first two. */
const REAL_WHICH: WhichImpl = (cmd) => {
  const pathEnv = process.env['PATH'] ?? '';
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, cmd), fsConstants.X_OK);
      return true;
    } catch {
      // not here — keep scanning the rest of PATH
    }
  }
  return false;
};

// send-back item 1 (verify-b, 2026-09-26): the Claude CLI's real sandbox startup requires BOTH of
// these on PATH (native checkDependencies(), confirmed via strings in the installed
// @anthropic-ai/claude-agent-sdk-linux-x64 binary: "bubblewrap (bwrap) not installed", "socat not
// installed"). The nested-bwrap probe below only ever measured `bwrap` (implicitly, via its own
// spawn's ENOENT) — a host with bwrap but no socat used to measure a FALSE 'confined' here while
// the real CLI refused to start at all. Checked explicitly, in order, BEFORE the nested-bwrap
// spawn (cheap PATH walks vs. a subprocess) so `reason` names exactly which binary is missing.
const CLI_SANDBOX_HARD_DEPENDENCIES = ['bwrap', 'socat'] as const;

/** Runs the REAL nested-bwrap probe (manually verified against this host, recorded on ADR-083's
 *  owner_decision): a plain unwrapped `bwrap --unshare-user ...` exits 0 on every host that merely
 *  HAS bubblewrap (that is S1's finding, not this question) — only the NESTED invocation reaches the
 *  same apply-seccomp-class failure the real CLI hits. Exit 0 ⇒ 'confined'; any nonzero exit, a
 *  spawn error (ENOENT — no bwrap on PATH at all), or a timeout ⇒ 'unconfined', carrying the probe's
 *  own stderr/error message as `reason` so the failure is diagnosable, never a bare boolean.
 *
 *  send-back item 1: a nested-bwrap probe PASS is necessary but not sufficient — see
 *  `CLI_SANDBOX_HARD_DEPENDENCIES` above. Both hard dependencies are checked FIRST; either missing
 *  short-circuits straight to 'unconfined' naming the missing binary, and the nested-bwrap spawn
 *  never runs at all. */
export function probeConfinement(spawn: SpawnImpl = REAL_SPAWN, which: WhichImpl = REAL_WHICH): ConfinementProbeResult {
  for (const dep of CLI_SANDBOX_HARD_DEPENDENCIES) {
    if (!which(dep)) {
      return { posture: 'unconfined', reason: `${dep} not found on PATH — the Claude CLI sandbox requires it` };
    }
  }
  const r = spawn('bwrap', NESTED_BWRAP_ARGS, { timeout: 5000 });
  if (r.error) return { posture: 'unconfined', reason: `bwrap probe failed to start: ${r.error.message}` };
  if (r.status === 0) return { posture: 'confined' };
  const stderr = (typeof r.stderr === 'string' ? r.stderr : r.stderr?.toString('utf8'))?.trim();
  return { posture: 'unconfined', reason: stderr && stderr.length > 0 ? stderr : `nested bwrap probe exited ${String(r.status)}` };
}
