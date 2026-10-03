// src/gateway/srt-mux-sweep.ts (pi harness v1, residual fix — srt-mux socket leak).
// `@anthropic-ai/sandbox-runtime`'s mux proxy names its unix socket `srt-mux-<pid>-<seq>.sock` under
// `os.tmpdir()`. srt's own teardown (`SandboxManager.reset()`) is async but is registered only on
// `process.once('exit', ...)`, a listener Node runs synchronously right before the event loop stops —
// the awaited `muxProxyServer.close()` inside it never finishes before the process actually ends, so
// the socket leaks even on a clean successful run, and a SIGKILLed process never runs any exit
// handler at all. Pulled out of pi-gateway-client.ts (its original, dispatch-only home) so
// pi-confinement-probe.ts can apply the SAME belt-and-suspenders sweep to the boot/--check-config
// probe child (review L1) without duplicating this logic — every caller sweeps by the CHILD process's
// own pid (never its own), since that pid is where `SandboxManager` actually runs (in-process with
// whichever process calls `SandboxManager.initialize()` — session-runner.ts for a dispatch,
// pi-path-probe.ts for a probe — never a grandchild).
import { readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Swept only by exact `<pid>-` prefix, so a socket some OTHER process on the host created is never
 *  touched. Best-effort: a missing/already-removed file is not an error. */
export function sweepSrtMuxSockets(pid: number): void {
  const prefix = `srt-mux-${pid}-`;
  let entries: string[];
  try { entries = readdirSync(tmpdir()); } catch { return; }
  for (const name of entries) {
    if (!name.startsWith(prefix) || !name.endsWith('.sock')) continue;
    try { unlinkSync(join(tmpdir(), name)); } catch { /* already gone — fine */ }
  }
}
