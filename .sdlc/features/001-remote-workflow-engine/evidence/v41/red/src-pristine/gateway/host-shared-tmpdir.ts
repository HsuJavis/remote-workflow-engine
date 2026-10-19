// src/gateway/host-shared-tmpdir.ts (issue #131): the ONE impure existence check both gateways call
// for their own `agent.host_shared_tmpdir_present` warning event. Split out of bash-confinement.ts
// (whose own header declares it PURE — no fs, no process, no env, no clock) rather than folded in
// there; kept separate from pi-gateway-client.ts (which already imports FROM claude-agent-sdk-
// client.ts, so the sdk gateway importing this check back from pi-gateway-client.ts would be a
// circular import) so both gateways can depend on it with no cycle.
//
// review round 4 (R4-2, pi-gateway-client.ts's own `HOST_SHARED_TMPDIR` doc has the full "why" this
// is a non-blocking VISIBILITY check, not a refusal or a cleanup attempt): this function never
// writes, deletes, creates or opens anything under `HOST_SHARED_TMPDIR` — it only `lstat`s it, so a
// symlink left there is reported present without ever being followed.
import { lstatSync } from 'node:fs';
import { HOST_SHARED_TMPDIR } from './bash-confinement.js';

export function hostSharedTmpdirPresent(): boolean {
  try {
    lstatSync(HOST_SHARED_TMPDIR);
    return true;
  } catch {
    return false; // absent — the normal case, and srt's own write loop skips a non-existent path.
  }
}
