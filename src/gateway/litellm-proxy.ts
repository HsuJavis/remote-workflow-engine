// LiteLLMProxyManager (D-V1 / ARCH-005): manages a `litellm` proxy subprocess so the SDK-based
// execution path can be pointed at ONE local endpoint (ANTHROPIC_BASE_URL) instead of each
// provider's native API directly. The proxy's model_list is generated straight from the same
// AliasMap GatewayConfig already carries — one source of truth for alias→provider/model, no
// duplicate bookkeeping in a second config format.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import type { AliasMap } from './client.js';

export interface LiteLLMProxyOptions {
  port?: number;
  /** Bounded startup budget (D-G discipline applies to subprocess boot too — never hang forever). */
  startupTimeoutMs?: number;
  /** Injectable process spawner — lets a caller point at a fake `litellm` for testing without the real binary. */
  spawnImpl?: typeof spawn;
  /** Injectable health-check transport — defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** LiteLLM's own provider-prefixed model naming, e.g. "ollama/llama3:8b", "anthropic/claude-3-5-sonnet". */
function toLiteLLMModelName(target: AliasMap[string]): string {
  return `${target.provider}/${target.model}`;
}

/**
 * The proxy-facing name for an alias. The Claude CLI rewrites certain bare model strings BEFORE the
 * request leaves for ANTHROPIC_BASE_URL: its built-in shorthands (`haiku`/`sonnet`/`opus`) expand to
 * dated Anthropic ids (e.g. `haiku` → `claude-haiku-4-5-20251001`), and `claude-*` ids are likewise
 * normalized. Since every alias here is served by THIS LiteLLM proxy (model_name == alias), that
 * rewrite makes the CLI put a name on the wire the proxy has no `model_name` entry for — LiteLLM
 * then falls through to its Anthropic passthrough and 400s ("Invalid model name … claude-haiku-…").
 * Prefixing the proxy model_name with a token the CLI never treats as a shorthand keeps the name
 * verbatim end-to-end. MUST be applied identically here and where the gateway sets `query()`'s
 * `model`, so the two always name the same entry.
 */
export function proxyModelName(alias: string): string {
  return `rwe-proxy-${alias}`;
}

/**
 * Renders a LiteLLM proxy `config.yaml`: one `model_list` entry per alias, mapping the proxy-facing
 * alias name (`proxyModelName`) straight to `litellm_params.model`. The shape is fixed and flat, so
 * this is hand-emitted rather than pulling in a YAML-writer dependency for a handful of lines.
 */
export function generateLiteLLMConfig(aliases: AliasMap): string {
  const lines = ['model_list:'];
  for (const [alias, target] of Object.entries(aliases)) {
    lines.push(`  - model_name: ${JSON.stringify(proxyModelName(alias))}`);
    lines.push('    litellm_params:');
    lines.push(`      model: ${JSON.stringify(toLiteLLMModelName(target))}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Owns the lifecycle of a single `litellm --config ... --port ...` subprocess: writes the
 * generated config to a temp file, spawns the process, polls its health endpoint up to a bounded
 * timeout (never hangs forever waiting for boot), and exposes the resulting baseUrl. `start()` is
 * idempotent — concurrent callers await the same in-flight startup instead of spawning twice.
 */
export class LiteLLMProxyManager {
  private _proc: ChildProcess | undefined;
  private _baseUrl: string | undefined;
  private _startPromise: Promise<{ baseUrl: string }> | undefined;
  private _port: number | undefined;
  private readonly _startupTimeoutMs: number;
  private readonly _spawnImpl: typeof spawn;
  private readonly _fetchImpl: typeof fetch;

  constructor(
    private readonly _aliases: AliasMap,
    opts: LiteLLMProxyOptions = {},
  ) {
    // D-V3M-4: undefined (no litellmPort configured) -> resolved to a free ephemeral port at
    // start() time; no more hard-coded 4000 squat. An explicit port still pins it.
    this._port = opts.port;
    this._startupTimeoutMs = opts.startupTimeoutMs ?? 20000;
    this._spawnImpl = opts.spawnImpl ?? spawn;
    this._fetchImpl = opts.fetchImpl ?? fetch;
  }

  get baseUrl(): string | undefined {
    return this._baseUrl;
  }

  async start(): Promise<{ baseUrl: string }> {
    if (this._baseUrl) return { baseUrl: this._baseUrl };
    if (!this._startPromise) this._startPromise = this._doStart();
    return this._startPromise;
  }

  private async _doStart(): Promise<{ baseUrl: string }> {
    // TASK-027 hardening: pre-bind port ownership check. Without this, a stale `litellm` process
    // left over from a previous run (the repeatedly-Gate-7.5-reproduced port hazard) can already be
    // listening on `this._port` — the post-spawn health poll below would then answer `ok` from
    // THAT foreign process on its very first iteration, before this instance's own spawn has even
    // had a chance to fail, so `start()` would falsely resolve as if it had booted its own proxy.
    // Actually trying to bind the port ourselves first turns that race into a fast, actionable
    // failure instead.
    // D-V3M-4: no configured port -> bind an ephemeral free port dynamically instead of squatting a
    // hard-coded 4000 (which collided with any other litellm on the host — a second server, or the
    // test suite spawning its own proxy while a real sdk-mode deployment was already on 4000). A
    // configured port still gets the stale-owner guard.
    if (this._port === undefined) {
      this._port = await this._findFreePort();
    } else {
      await this._assertPortFree();
    }
    const port = this._port;

    const dir = await mkdtemp(path.join(tmpdir(), 'rwe-litellm-'));
    const configPath = path.join(dir, 'config.yaml');
    await writeFile(configPath, generateLiteLLMConfig(this._aliases), 'utf8');

    // `detached: true` (TASK-027): makes this child its own process-group leader so `stop()` can
    // cascade-kill it AND any worker processes `litellm` itself forks, via a single process-group
    // signal — `child.kill()` alone only ever signalled this one direct handle, leaving `litellm`'s
    // own forked workers orphaned on shutdown (the other repeatedly-Gate-7.5-reproduced hazard).
    // D-V2G8-1(c): explicit `env` — the proxy subprocess is the ONE place the real provider API
    // keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, ...) actually need to live, so it needs its own real
    // host env to route calls. Previously omitted entirely, relying on Node's implicit
    // process.env-inheritance-when-env-is-undefined default — that's an accident, not a testable
    // custody statement; spelling it out here also gives this class a single, greppable place to
    // narrow later if a future round needs to (see buildSubprocessEnv in claude-agent-sdk-client.ts
    // for the CONTRASTING allowlist the agent-facing CLI subprocess gets — never these real keys).
    const proc = this._spawnImpl('litellm', ['--config', configPath, '--port', String(port)], {
      stdio: 'ignore',
      detached: true,
      env: { ...process.env },
    });
    this._proc = proc;
    const baseUrl = `http://127.0.0.1:${port}`;

    const deadline = Date.now() + this._startupTimeoutMs;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) {
        throw new Error(`litellm proxy exited during startup (code ${proc.exitCode})`);
      }
      try {
        const res = await this._fetchImpl(`${baseUrl}/health/liveliness`);
        if (res.ok) {
          this._baseUrl = baseUrl;
          return { baseUrl };
        }
      } catch (err) {
        lastErr = err;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    this._killProcessGroup(proc);
    this._startPromise = undefined;
    throw new Error(`litellm proxy did not become healthy within ${this._startupTimeoutMs}ms: ${String(lastErr)}`);
  }

  /**
   * TASK-027: verifies nobody already owns `this._port` before we spawn — real TCP bind attempt
   * (not a health-endpoint fetch, which can't tell "our own booting process" apart from "a stale
   * foreign process already answering on this port"). Closed immediately either way; the real
   * spawn below does the actual, lasting bind.
   */
  /** D-V3M-4: binds an OS-assigned ephemeral port (:0), reads it back, releases it, and returns it —
   *  the dynamic-port path when no litellmPort is configured. (Small bind→spawn TOCTOU window, same
   *  as the configured-port `_assertPortFree` guard already carries; an ephemeral port is far less
   *  likely to be re-grabbed than a fixed 4000.) */
  private _findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const addr = probe.address();
        const port = typeof addr === 'object' && addr !== null ? addr.port : undefined;
        probe.close(() => (port !== undefined ? resolve(port) : reject(new Error('could not obtain a free ephemeral port'))));
      });
    });
  }

  private async _assertPortFree(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(
            `litellm proxy port ${this._port} is already in use (possibly a stale litellm process ` +
            'left over from a previous run). Stop whatever is bound to it, or choose a different ' +
            'port via LiteLLMProxyOptions.port / the litellmPort config key, then try again.',
          ));
        } else {
          reject(err);
        }
      });
      probe.listen(this._port, '127.0.0.1', () => probe.close(() => resolve()));
    });
  }

  /**
   * Cascade-kills the whole process group `proc` leads (it was spawned with `detached: true`,
   * making its pid also its process-group id) via a single negative-pid signal — reaps any worker
   * processes `litellm` itself forked, not just this one direct handle. Falls back to a plain
   * `proc.kill()` when there's no usable pid (e.g. a test double).
   */
  private _killProcessGroup(proc: ChildProcess): void {
    if (proc.pid !== undefined) {
      try {
        process.kill(-proc.pid, 'SIGTERM');
        return;
      } catch {
        // Fall through to the direct-handle kill below (e.g. group already gone, or a
        // non-POSIX/test-double pid that process.kill() doesn't accept).
      }
    }
    proc.kill();
  }

  async stop(): Promise<void> {
    if (this._proc && this._proc.exitCode === null) this._killProcessGroup(this._proc);
    this._proc = undefined;
    this._baseUrl = undefined;
    this._startPromise = undefined;
  }
}
