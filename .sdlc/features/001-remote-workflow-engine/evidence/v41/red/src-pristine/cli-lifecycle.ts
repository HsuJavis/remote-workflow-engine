// D-PROC: per-agent CLI subprocess lifecycle (TASK-037, DES-029/ARCH-005).
// The reusable spawn/kill primitive the outer timeout race (TASK-033) consumes: the SDK CLI is
// spawned DETACHED in its own process group so killGroup(-pgid) reaps its N stdio-MCP grandchildren
// too (a bare child.kill() orphans them — the same orphan-litellm pathology at higher volume).
// Injected spawnImpl/killImpl/rmImpl seam so a unit test asserts kill-called-once without ever
// spawning a real `claude` CLI; defaults to the real node:child_process/node:fs primitives so
// integration/production callers get real process-group behavior for free.
import { spawn } from 'node:child_process';
import { rm } from 'node:fs';

export interface SpawnOpts {
  cwd: string;
  tempDir?: string;
  [key: string]: unknown;
}

export interface ChildHandle {
  pid: number;
  tempDir?: string;
}

export type SpawnImpl = (cmd: string, args: string[], opts: Record<string, unknown>) => { pid?: number };
export type KillImpl = (pid: number, signal: string) => void;
export type RmImpl = (path: string, opts: { recursive: boolean; force: boolean }) => void;

export interface CliLifecycleDeps {
  spawnImpl?: SpawnImpl;
  killImpl?: KillImpl;
  rmImpl?: RmImpl;
}

// SIGTERM first, escalate to SIGKILL if the group is still alive after this grace period.
const KILL_ESCALATION_MS = 2000;

export class RealCliLifecycle {
  private readonly spawnImpl: SpawnImpl;
  private readonly killImpl: KillImpl;
  private readonly rmImpl: RmImpl;

  constructor(deps: CliLifecycleDeps) {
    this.spawnImpl = deps.spawnImpl ?? ((cmd, args, opts) => spawn(cmd, args, opts));
    this.killImpl = deps.killImpl ?? ((pid, signal) => process.kill(pid, signal as NodeJS.Signals));
    this.rmImpl = deps.rmImpl ?? ((path, opts) => rm(path, opts, () => { /* best-effort cleanup */ }));
  }

  spawnDetached(cmd: string, args: string[], opts: SpawnOpts): ChildHandle {
    const child = this.spawnImpl(cmd, args, { ...opts, detached: true });
    return { pid: child.pid!, tempDir: opts.tempDir };
  }

  killGroup(handle: ChildHandle): void {
    this.killImpl(-handle.pid, 'SIGTERM');
    const escalate = setTimeout(() => {
      try {
        this.killImpl(-handle.pid, 'SIGKILL');
      } catch {
        // Group already gone — SIGTERM was enough.
      }
    }, KILL_ESCALATION_MS);
    escalate.unref?.();
  }

  cleanupTemp(handle: ChildHandle): void {
    if (handle.tempDir) {
      this.rmImpl(handle.tempDir, { recursive: true, force: true });
    }
  }
}
