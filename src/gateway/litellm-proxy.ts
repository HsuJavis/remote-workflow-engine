// LiteLLMProxyManager (D-V1 / ARCH-005): manages a `litellm` proxy subprocess so the SDK-based
// execution path can be pointed at ONE local endpoint (ANTHROPIC_BASE_URL) instead of each
// provider's native API directly. The proxy's model_list is generated straight from the same
// AliasMap GatewayConfig already carries — one source of truth for alias→provider/model, no
// duplicate bookkeeping in a second config format.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
 * Renders a LiteLLM proxy `config.yaml`: one `model_list` entry per alias, mapping the alias name
 * straight to `litellm_params.model`. The shape is fixed and flat, so this is hand-emitted rather
 * than pulling in a YAML-writer dependency for a handful of lines.
 */
export function generateLiteLLMConfig(aliases: AliasMap): string {
  const lines = ['model_list:'];
  for (const [alias, target] of Object.entries(aliases)) {
    lines.push(`  - model_name: ${JSON.stringify(alias)}`);
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
  private readonly _port: number;
  private readonly _startupTimeoutMs: number;
  private readonly _spawnImpl: typeof spawn;
  private readonly _fetchImpl: typeof fetch;

  constructor(
    private readonly _aliases: AliasMap,
    opts: LiteLLMProxyOptions = {},
  ) {
    this._port = opts.port ?? 4000;
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
    const dir = await mkdtemp(path.join(tmpdir(), 'rwe-litellm-'));
    const configPath = path.join(dir, 'config.yaml');
    await writeFile(configPath, generateLiteLLMConfig(this._aliases), 'utf8');

    const proc = this._spawnImpl('litellm', ['--config', configPath, '--port', String(this._port)], {
      stdio: 'ignore',
    });
    this._proc = proc;
    const baseUrl = `http://127.0.0.1:${this._port}`;

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
    proc.kill();
    this._startPromise = undefined;
    throw new Error(`litellm proxy did not become healthy within ${this._startupTimeoutMs}ms: ${String(lastErr)}`);
  }

  async stop(): Promise<void> {
    if (this._proc && this._proc.exitCode === null) this._proc.kill();
    this._proc = undefined;
    this._baseUrl = undefined;
    this._startPromise = undefined;
  }
}
