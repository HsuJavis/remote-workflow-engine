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

export type ConfinementPosture = 'confined' | 'unconfined';
export interface ConfinementProbeResult {
  readonly posture: ConfinementPosture;
  /** Present only when posture is 'unconfined' — the probe's own stderr/error, so an operator
   *  reading the boot line (or the confinement-posture ARCH-178 event) sees WHY, not just THAT. */
  readonly reason?: string;
}

const NESTED_BWRAP_ARGS = [
  '--unshare-user', '--unshare-pid', '--ro-bind', '/', '/', '--tmpfs', '/tmp', '--',
  'bwrap', '--unshare-user', '--unshare-pid', '--ro-bind', '/', '/', '--tmpfs', '/tmp', '--', '/bin/true',
];

export type SpawnImpl = (cmd: string, args: string[], opts: { timeout: number }) => { status: number | null; error?: Error; stderr: Buffer | string };

const REAL_SPAWN: SpawnImpl = (cmd, args, opts) => spawnSync(cmd, args, opts);

/** Runs the REAL nested-bwrap probe (manually verified against this host, recorded on ADR-083's
 *  owner_decision): a plain unwrapped `bwrap --unshare-user ...` exits 0 on every host that merely
 *  HAS bubblewrap (that is S1's finding, not this question) — only the NESTED invocation reaches the
 *  same apply-seccomp-class failure the real CLI hits. Exit 0 ⇒ 'confined'; any nonzero exit, a
 *  spawn error (ENOENT — no bwrap on PATH at all), or a timeout ⇒ 'unconfined', carrying the probe's
 *  own stderr/error message as `reason` so the failure is diagnosable, never a bare boolean. */
export function probeConfinement(spawn: SpawnImpl = REAL_SPAWN): ConfinementProbeResult {
  const r = spawn('bwrap', NESTED_BWRAP_ARGS, { timeout: 5000 });
  if (r.error) return { posture: 'unconfined', reason: `bwrap probe failed to start: ${r.error.message}` };
  if (r.status === 0) return { posture: 'confined' };
  const stderr = (typeof r.stderr === 'string' ? r.stderr : r.stderr?.toString('utf8'))?.trim();
  return { posture: 'unconfined', reason: stderr && stderr.length > 0 ? stderr : `nested bwrap probe exited ${String(r.status)}` };
}
