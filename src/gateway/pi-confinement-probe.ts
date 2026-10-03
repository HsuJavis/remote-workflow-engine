// src/gateway/pi-confinement-probe.ts (pi harness v1, spec "Confinement posture"). The PARENT-side
// (tsx-resolved, normal `node`) half of the pi-path boot probe: spawns `entry.ts --probe` as its OWN
// short-lived child process (so srt's process-global `SandboxManager` singleton and its lingering
// internal handles never touch the long-lived engine process — pi-spike-report.md's own cleanup
// notes), reads its one-line JSON verdict, and returns the SAME `ConfinementProbeResult` shape
// src/gateway/confinement-probe.ts's `probeConfinement()` returns for the sdk path, so `main.ts` can
// feed either into the SAME `ConfinementProbeResult`-typed plumbing (composeConfig/RunManager).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ConfinementProbeResult } from './confinement-probe.js';
import { sweepSrtMuxSockets } from './srt-mux-sweep.js';

const ENTRY_PATH = fileURLToPath(new URL('./pi-child/entry.ts', import.meta.url));

export interface PiConfinementProbeDeps {
  spawnImpl?: typeof spawn;
  entryPath?: string;
  timeoutMs?: number;
}

/** Real nested-bwrap-equivalent measurement for the pi path — see pi-path-probe.ts's own header for
 *  why this is a SEPARATE question from the sdk gateway's own boot probe. Never throws: a spawn
 *  failure, a timeout, or malformed probe output all resolve to `{posture:'unconfined', reason}`,
 *  matching `probeConfinement()`'s own fail-closed convention. */
export async function probePiPath(deps: PiConfinementProbeDeps = {}): Promise<ConfinementProbeResult> {
  const spawnImpl = deps.spawnImpl ?? spawn;
  const entryPath = deps.entryPath ?? ENTRY_PATH;
  const timeoutMs = deps.timeoutMs ?? 15_000;
  return new Promise((resolvePromise) => {
    let settled = false;
    const settle = (result: ConfinementProbeResult): void => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnImpl('node', ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', entryPath, '--probe'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      settle({ posture: 'unconfined', reason: `failed to spawn the pi-path probe child: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    let out = '';
    let errOut = '';
    child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { errOut += d.toString(); });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      // review L1: a SIGKILLed probe child never runs its own `finally` (pi-path-probe.ts's
      // `SandboxManager.reset()`) — the same belt-and-suspenders backstop
      // pi-gateway-client.ts applies for a SIGKILLed DISPATCH child, applied here too.
      if (child.pid !== undefined) sweepSrtMuxSockets(child.pid);
      settle({ posture: 'unconfined', reason: `pi-path probe timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.once('error', (err) => {
      clearTimeout(timer);
      settle({ posture: 'unconfined', reason: `pi-path probe child error: ${err.message}` });
    });
    child.once('exit', () => {
      clearTimeout(timer);
      // review L1: unconditional, before any branch below returns — the same backstop as above, for
      // the normal-exit path (pi-path-probe.ts's own `finally` is the primary, fast-path cleanup;
      // this is belt-and-suspenders in case THAT raced the process end exactly as srt's own
      // `process.once('exit', ...)`-based teardown already does — see srt-mux-sweep.ts's header).
      if (child.pid !== undefined) sweepSrtMuxSockets(child.pid);
      const line = out.trim().split('\n').pop();
      if (line === undefined || line.length === 0) {
        settle({ posture: 'unconfined', reason: `pi-path probe produced no output${errOut.trim() ? ` (stderr: ${errOut.trim().slice(-500)})` : ''}` });
        return;
      }
      try {
        const parsed = JSON.parse(line) as ConfinementProbeResult;
        if (parsed.posture !== 'confined' && parsed.posture !== 'unconfined') throw new Error('malformed posture');
        settle(parsed);
      } catch (err) {
        settle({ posture: 'unconfined', reason: `pi-path probe produced unparseable output: ${err instanceof Error ? err.message : String(err)}` });
      }
    });
  });
}
