// Asset MCP-config live-probe validator (DES-020 / ARCH-012 / TASK-026): the one network
// dependency in asset sync, isolated behind an injected `McpProbe` port so unit/integration tests
// use a fake accept/reject and only the real-tier (Gate 7.5) exercises a genuine handshake/spawn.
// `classifyTransport` is the pure, synchronous first gate — anything not server-runnable
// (remote-http or npx-stdio) is rejected before a probe is ever attempted.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RealCliLifecycle } from './cli-lifecycle.js';
import { resolveRunPlaceholders } from './mcp-run-state.js';

export interface McpServerConfig {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  // issue #126 B: a stdio server's env may reference ${run:dir}/${run:id} (mcp-run-state.ts),
  // resolved per-dispatch by the gateway and — against a disposable temp dir — by the push-time
  // probe below. Previously only reachable via an `as never`/`as unknown as McpServerConfig` cast.
  env?: Record<string, string>;
}

export type TransportKind = 'remote-http' | 'npx-stdio' | 'unsupported';

/** PURE: classifies a pushed mcp-config's transport. Only `remote-http` (a real Streamable-HTTP
 *  URL) and `npx-stdio` (an `npx`-launched stdio server) are server-runnable; anything else
 *  (arbitrary local binaries, interactively-authenticated-headless kinds per compat-spec §5,
 *  unknown/missing `type`) is `'unsupported'`. */
export function classifyTransport(cfg: McpServerConfig): TransportKind {
  if (cfg.type === 'http' && typeof cfg.url === 'string') return 'remote-http';
  if (cfg.type === 'stdio' && cfg.command === 'npx') return 'npx-stdio';
  return 'unsupported';
}

export type McpProbeResult = { ok: true } | { ok: false; code: string; message: string };

/** Injected port: `probe()` resolves ok/reject for a server-runnable transport. Never called for
 *  an already-`'unsupported'` config — the composition-root wiring gates on `classifyTransport`
 *  first (DES-020). */
export interface McpProbe {
  probe(cfg: McpServerConfig): Promise<McpProbeResult>;
}

/** Deterministic test double: always accepts or always rejects, no network/process I/O. */
export class FakeMcpProbe implements McpProbe {
  constructor(private readonly accept: boolean = true) {}
  async probe(): Promise<McpProbeResult> {
    return this.accept ? { ok: true } : { ok: false, code: 'UNREACHABLE', message: 'FakeMcpProbe: configured to reject' };
  }
}

// issue #103(b): exported so `asset-sync.ts`'s MCP_PROBE_FAILED detail can name the actual timeout
// window a caller hit, rather than a number hand-duplicated at the call site (and liable to drift).
export const PROBE_TIMEOUT_MS = 5000;

/** Real probe (exercised only at real-tier, DES-023 mock policy): a lightweight reachability
 *  check — `remote-http` gets a short-timeout HTTP request to the configured URL; `npx-stdio` gets
 *  a short-lived spawn of the configured command to confirm it's actually launchable on this host
 *  (an offline `npx` or unresolvable package fails fast rather than hanging the push). */
export class RealMcpProbe implements McpProbe {
  // issue #129(a): the probe spawn's own process group is reaped through the same primitive
  // (DES-029, previously unwired) the CLI dispatch spawner uses — one SIGTERM-then-SIGKILL
  // escalation, not a second hand-rolled copy of it here.
  private readonly _lifecycle = new RealCliLifecycle({});

  async probe(cfg: McpServerConfig): Promise<McpProbeResult> {
    const kind = classifyTransport(cfg);
    if (kind === 'unsupported') {
      return { ok: false, code: 'UNSUPPORTED_TRANSPORT', message: 'Not a server-runnable MCP transport (remote-http or npx-stdio only).' };
    }
    if (kind === 'remote-http') return this._probeHttp(cfg.url!);
    return this._probeStdioConfig(cfg);
  }

  private async _probeHttp(url: string): Promise<McpProbeResult> {
    try {
      await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      return { ok: true };
    } catch (err) {
      return { ok: false, code: 'UNREACHABLE', message: `MCP HTTP endpoint unreachable: ${(err as Error).message}` };
    }
  }

  /** issue #126 B: resolves `${run:dir}`/`${run:id}` against a disposable probe-time temp dir
   *  BEFORE spawning — so a config that references `${run:dir}` (e.g. server-memory's
   *  `MEMORY_FILE_PATH=${run:dir}/memory.jsonl`) is actually launchable, not handed the literal
   *  placeholder text. Only `validateRunPlaceholders` (asset-sync.ts's push(), run before this
   *  probe) refuses an UNKNOWN placeholder; this function assumes that already passed. The temp
   *  dir is probe-only scratch — never the real per-run state dir a dispatch later creates — and
   *  is removed again once the probe settles. */
  private async _probeStdioConfig(cfg: McpServerConfig): Promise<McpProbeResult> {
    const dryRun = resolveRunPlaceholders(cfg, { id: 'probe', dir: '' });
    let probeDir: string | undefined;
    let resolved = cfg;
    if (dryRun.usedDir) {
      probeDir = mkdtempSync(join(tmpdir(), 'rwe-mcp-probe-'));
      resolved = resolveRunPlaceholders(cfg, { id: 'probe', dir: probeDir }).config as McpServerConfig;
    } else if (cfg.env !== undefined) {
      resolved = resolveRunPlaceholders(cfg, { id: 'probe', dir: '' }).config as McpServerConfig;
    }
    try {
      return await this._probeStdio(resolved.command!, resolved.args ?? [], resolved.env);
    } finally {
      if (probeDir !== undefined) rmSync(probeDir, { recursive: true, force: true });
    }
  }

  private _probeStdio(command: string, args: string[], env?: Record<string, string>): Promise<McpProbeResult> {
    return new Promise((resolve) => {
      let settled = false;
      // issue #129(a): spawned in its own process group (detached) — a plain child.kill() only
      // signals this ONE direct child, orphaning whatever grandchild it forked (the real-repro
      // shape: a `node -e`/npx grandchild left running after a successful push).
      const child = spawn(command, args, {
        stdio: 'ignore',
        detached: true,
        ...(env !== undefined ? { env: { ...process.env, ...env } } : {}),
      });
      const reap = (): void => {
        if (child.pid === undefined) return;
        try {
          this._lifecycle.killGroup({ pid: child.pid });
        } catch {
          // group already gone — nothing to reap
        }
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reap();
        resolve({ ok: true }); // still running after the window — treat as launchable (long-lived server)
      }, PROBE_TIMEOUT_MS);
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reap();
        resolve({ ok: false, code: 'UNREACHABLE', message: `MCP stdio command failed to launch: ${err.message}` });
      });
      child.on('exit', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reap();
        // A fast non-zero exit means the command ran but failed (e.g. unresolvable npx package).
        resolve(code === 0 || code === null
          ? { ok: true }
          : { ok: false, code: 'PROBE_FAILED', message: `MCP stdio command exited with code ${code}` });
      });
    });
  }
}
