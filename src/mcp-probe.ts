// Asset MCP-config live-probe validator (DES-020 / ARCH-012 / TASK-026): the one network
// dependency in asset sync, isolated behind an injected `McpProbe` port so unit/integration tests
// use a fake accept/reject and only the real-tier (Gate 7.5) exercises a genuine handshake/spawn.
// `classifyTransport` is the pure, synchronous first gate — anything not server-runnable
// (remote-http or npx-stdio) is rejected before a probe is ever attempted.
import { spawn } from 'node:child_process';

export interface McpServerConfig {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
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

const PROBE_TIMEOUT_MS = 5000;

/** Real probe (exercised only at real-tier, DES-023 mock policy): a lightweight reachability
 *  check — `remote-http` gets a short-timeout HTTP request to the configured URL; `npx-stdio` gets
 *  a short-lived spawn of the configured command to confirm it's actually launchable on this host
 *  (an offline `npx` or unresolvable package fails fast rather than hanging the push). */
export class RealMcpProbe implements McpProbe {
  async probe(cfg: McpServerConfig): Promise<McpProbeResult> {
    const kind = classifyTransport(cfg);
    if (kind === 'unsupported') {
      return { ok: false, code: 'UNSUPPORTED_TRANSPORT', message: 'Not a server-runnable MCP transport (remote-http or npx-stdio only).' };
    }
    if (kind === 'remote-http') return this._probeHttp(cfg.url!);
    return this._probeStdio(cfg.command!, cfg.args ?? []);
  }

  private async _probeHttp(url: string): Promise<McpProbeResult> {
    try {
      await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      return { ok: true };
    } catch (err) {
      return { ok: false, code: 'UNREACHABLE', message: `MCP HTTP endpoint unreachable: ${(err as Error).message}` };
    }
  }

  private _probeStdio(command: string, args: string[]): Promise<McpProbeResult> {
    return new Promise((resolve) => {
      let settled = false;
      const child = spawn(command, args, { stdio: 'ignore' });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        resolve({ ok: true }); // still running after the window — treat as launchable (long-lived server)
      }, PROBE_TIMEOUT_MS);
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, code: 'UNREACHABLE', message: `MCP stdio command failed to launch: ${err.message}` });
      });
      child.on('exit', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // A fast non-zero exit means the command ran but failed (e.g. unresolvable npx package).
        resolve(code === 0 || code === null
          ? { ok: true }
          : { ok: false, code: 'PROBE_FAILED', message: `MCP stdio command exited with code ${code}` });
      });
    });
  }
}
