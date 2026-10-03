// src/gateway/pi-gateway-client.ts (pi harness v1, owner decisions 1-3; pi-harness-research.md
// §5.2, pi-spike-report.md). `PiGatewayClient implements GatewayClient` — the SAME port
// `ClaudeAgentSdkGatewayClient` implements, selected by `gateway:"pi"` in rwe.config.json
// (composeConfig(), src/main.ts) instead of the default `gateway:"sdk"`.
//
// Status as of slice (e) (tracked honestly, not silently): spawns one detached child per dispatch
// (src/gateway/pi-child/entry.ts) speaking JSONL over stdio, routes openrouter/ollama models, maps
// the tool surface with TOOL_UNSUPPORTED_BY_HARNESS refusal, jails file tools, and wraps bash
// through real srt confinement with an honest `harness.bash.enforced` — all proven against a real
// local ollama + real bwrap in this iteration's evidence. Still NOT in this file: a retry loop
// beyond one attempt (arguably spec-compliant as-is — "the engine's outer retry loop is the only
// retry"), 401/403/404-vs-429/5xx error classification, `tool_call`/`tool_result` transcript events
// (only one `message` event per assistant turn today), MCP (slice g), skills (slice h), effort
// mapping / OpenRouter request-shape verification (slice i).
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { AgentOpts, Caps, HarnessDescriptor, Tokens, TranscriptEvent } from '../types.js';
import type { GatewayClient, GatewayResult, EffortApplied } from './client.js';
import { resolveTimeout } from './client.js';
import { redactHarness } from '../agent-executor.js';
import { parseModelRef } from '../providers.js';
import { RealCliLifecycle } from '../cli-lifecycle.js';
import { buildBashConfinement, readonlyBashRefusal } from './bash-confinement.js';
import { resolveRipgrepOverride } from './pi-child/ripgrep-override.js';
import type { PiChildConfig, PiChildEvent, PiChildSandboxConfig } from './pi-child/protocol.js';

/** Engine tool name -> pi tool name (spec "Tool mapping"). Semantic differences, documented: `Glob`
 *  (gitignore-aware, Claude-shaped globbing) maps to pi's `find` (pi's own docs: "respects
 *  .gitignore", semantically the SAME as Claude's Glob despite the Unix-`find`-shaped name — spike
 *  S6); this engine's jailed `find` operations (session-runner.ts) are a simplified glob matcher
 *  that does NOT replicate gitignore-awareness, a documented simplification. */
const TOOL_NAME_MAP: Record<string, string> = { Read: 'read', Write: 'write', Edit: 'edit', Bash: 'bash', Grep: 'grep', Glob: 'find', LS: 'ls' };

/** spec "Tool mapping": WebFetch, WebSearch, Task, NotebookEdit and any other unmapped tool are
 *  refused at registration and dispatch with TOOL_UNSUPPORTED_BY_HARNESS — never silently dropped.
 *  Returns the pi tool names on success. */
function mapTools(engineNames: readonly string[]): { ok: true; piNames: string[] } | { ok: false; unmapped: string[] } {
  const piNames: string[] = [];
  const unmapped: string[] = [];
  for (const name of engineNames) {
    const mapped = TOOL_NAME_MAP[name];
    if (mapped === undefined) unmapped.push(name);
    else piNames.push(mapped);
  }
  return unmapped.length > 0 ? { ok: false, unmapped } : { ok: true, piNames };
}

const DEFAULT_ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'];

const ENTRY_PATH = fileURLToPath(new URL('./pi-child/entry.ts', import.meta.url));

/** Same benign-env allowlist the sdk gateway's CLI subprocess gets (ENV_ALLOWLIST,
 *  claude-agent-sdk-client.ts) — the pi CHILD process itself (not its bash tool, which is a
 *  separate, stricter layer landing in slice e) never inherits the engine's whole `process.env`,
 *  so `RWE_SECRET_*` is never even reachable by a pi/node_modules extension running inside it. */
const CHILD_ENV_ALLOWLIST = ['PATH', 'HOME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM'];

function buildChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  // pi-spike-report.md S7: these three flags gate CLI-only code paths in the SDK embedding (no
  // observed effect in-process — `ModelRuntime.create()`'s own `allowModelNetwork` already defaults
  // to false there), set anyway as defense-in-depth per the spike's own recommendation.
  env['PI_OFFLINE'] = '1';
  env['PI_SKIP_VERSION_CHECK'] = '1';
  env['PI_TELEMETRY'] = '0';
  return env;
}

const ZERO_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export interface PiGatewayConfig {
  /** The OpenRouter API key, from the same secret store `resolveAnthropicAuth` reads from
   *  (RWE_SECRET_OPENROUTER_API_KEY / OPENROUTER_API_KEY) — injected only into the pi child's
   *  memory via `setRuntimeApiKey`, never into bash env, never to disk. */
  secretSource?: { resolve(name: string): string | undefined };
  /** `OLLAMA_BASE_URL` — same meaning as the rest of the engine (default `http://localhost:11434`). */
  ollamaBaseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  /** v37 (ARCH-181/262): the pi-PATH confinement posture — a SEPARATE measurement from the sdk
   *  gateway's own boot probe (srt may not match the CLI-bundled sandbox-runtime version; the pi
   *  path also needs the ripgrep-binary override the sdk path never required). Set once at boot by
   *  main.ts's pi-path probe, forwarded through composeConfig() exactly like
   *  `ClaudeAgentSdkGatewayConfig.confinementPosture`. Not yet consumed (slice e wires bash
   *  confinement); carried now so composeConfig()'s wiring doesn't change shape later. */
  confinementPosture?: 'confined' | 'unconfined';
  /** v37-equivalent (ARCH-176/177 parity): the SAME grant/protected/workRoot block
   *  `buildBashConfinement()` consumes on the sdk gateway, forwarded by composeConfig() from the
   *  SAME resolved values (resolvedGrants/protectedFiles/workRoot/homeDir/allowReadPaths) — one
   *  resolution, two gateways. */
  confinement?: { allowHostPaths: readonly string[]; protectedFiles: readonly string[]; workRoot: string | undefined; homeDir?: string; allowReadPaths?: readonly string[] };
  /** D-F11 parity: the configurable default core tool set, forwarded from `defaultAllowedTools` in
   *  rwe.config.json. Omitted -> DEFAULT_ALLOWED_TOOLS. */
  defaultAllowedTools?: string[];
  /** Test/engine seam: overrides `node --experimental-transform-types <entryPath>` — a unit test
   *  injects a fake child process instead of spawning a real one. Omitted -> the real spawn below. */
  spawnChild?: typeof spawn;
  /** Test seam: overrides the resolved entry.ts path. */
  entryPath?: string;
  /** Test seam: overrides `resolveRipgrepOverride()` — a unit test injects a fake resolved override
   *  without depending on which `@anthropic-ai/claude-agent-sdk-*` platform package is installed. */
  resolveRipgrepOverride?: () => { command: string; argv0: 'rg' } | null;
}

function resolveOpenrouterKey(config: PiGatewayConfig): string | undefined {
  return config.secretSource?.resolve('OPENROUTER_API_KEY') ?? process.env['RWE_SECRET_OPENROUTER_API_KEY'] ?? process.env['OPENROUTER_API_KEY'];
}

export class PiGatewayClient implements GatewayClient {
  private readonly _cliLifecycle = new RealCliLifecycle({});

  constructor(private readonly _config: PiGatewayConfig) {}

  async invoke(req: {
    prompt: string; opts: AgentOpts; runId: string; agentId: string; signal?: AbortSignal; workspace?: string;
    assets?: { roots: { workflow: string; global: string }; declared: { skills: string[]; mcp: string[] }; workflow: string };
    onHarness?: (h: HarnessDescriptor, applied?: EffortApplied) => Promise<void>;
    onEvent?: (ev: TranscriptEvent) => void | Promise<void>;
    onUsage?: (cumulative: Tokens) => void;
    caps?: Caps;
  }): Promise<GatewayResult> {
    const ref = req.opts.model;
    const parsed = ref !== undefined ? parseModelRef(ref) : undefined;
    if (ref === undefined || !parsed) {
      return { ok: false, provider: 'unknown', reason: 'terminal', retryable: false, transport: 'pi', detail: `INTERNAL_ERROR: no valid model ref reached the pi gateway (got ${JSON.stringify(ref)}) — admission should have refused this dispatch` };
    }
    if (parsed.provider === 'anthropic') {
      // Defense in depth: admission (checkModelRef's harnessProviders gate) already refuses this
      // before a run ever reaches a gateway. A direct test construction or a future admission bug
      // must still fail closed here, never silently dispatch to a provider pi is not permitted to use.
      return { ok: false, provider: 'anthropic', reason: 'terminal', retryable: false, transport: 'pi', detail: 'PROVIDER_UNSUPPORTED_BY_HARNESS: the pi gateway never dispatches anthropic/* — this should have been refused at admission' };
    }
    if (req.signal?.aborted) {
      return { ok: false, provider: parsed.provider, reason: 'terminal', retryable: false, transport: 'pi', detail: 'aborted by caller before dispatch (run suspended or stopped)' };
    }
    // Slices (g)/(h) are not wired yet — a declared mcp/skill is refused, never silently dropped
    // (the same standard TOOL_UNSUPPORTED_BY_HARNESS holds the tool surface to).
    if ((req.assets?.declared.mcp.length ?? 0) > 0) {
      return { ok: false, provider: parsed.provider, reason: 'terminal', retryable: false, transport: 'pi', detail: `MCP_UNSUPPORTED_BY_HARNESS: this engine runs the pi harness, which does not yet bridge MCP servers (declared: ${req.assets!.declared.mcp.join(', ')})` };
    }
    if ((req.assets?.declared.skills.length ?? 0) > 0) {
      return { ok: false, provider: parsed.provider, reason: 'terminal', retryable: false, transport: 'pi', detail: `SKILL_UNSUPPORTED_BY_HARNESS: this engine runs the pi harness, which does not yet materialize skills (declared: ${req.assets!.declared.skills.join(', ')})` };
    }

    const workspace = req.workspace ?? process.cwd();
    const agentDir = join(workspace, '.pi-agent-dir');
    const model: PiChildConfig['model'] =
      parsed.provider === 'ollama'
        ? { provider: 'ollama', model: parsed.model, baseUrl: this._config.ollamaBaseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434' }
        : { provider: 'openrouter', model: parsed.model };
    const apiKey = parsed.provider === 'openrouter' ? resolveOpenrouterKey(this._config) : undefined;
    if (parsed.provider === 'openrouter' && apiKey === undefined) {
      return { ok: false, provider: 'openrouter', reason: 'terminal', retryable: false, transport: 'pi', detail: 'OPENROUTER_AUTH_MISSING: no OpenRouter API key in the secret store (RWE_SECRET_OPENROUTER_API_KEY) or OPENROUTER_API_KEY env' };
    }

    // spec "Tool mapping": the engine tool surface for this call (opts.allowedTools, '[]' honored,
    // defaultAllowedTools otherwise) — mapped to pi names BEFORE a child is ever spawned.
    const requestedTools = req.opts.allowedTools ?? this._config.defaultAllowedTools ?? DEFAULT_ALLOWED_TOOLS;
    const mapped = mapTools(requestedTools);
    if (!mapped.ok) {
      return { ok: false, provider: parsed.provider, reason: 'terminal', retryable: false, transport: 'pi', detail: `TOOL_UNSUPPORTED_BY_HARNESS: ${mapped.unmapped.join(', ')} ${mapped.unmapped.length === 1 ? 'has' : 'have'} no mapping under the pi harness — only Read/Write/Edit/Bash/Grep/Glob/LS are supported` };
    }

    // spec "Bash" / issue #78(c) parity: bash:'readonly' is only ever dispatched with the kernel
    // enforcing it — refused BEFORE any child is spawned, the same shape as the sdk gateway.
    const bashRefusal = readonlyBashRefusal({ bash: req.opts.bash, tools: requestedTools, posture: this._config.confinementPosture, root: workspace });
    if (bashRefusal !== null) {
      return { ok: false, provider: parsed.provider, reason: 'terminal', retryable: false, transport: 'pi', detail: bashRefusal };
    }

    // spec "Confinement posture": sandbox is built ONLY when this engine measured `confined` at boot
    // (the pi-path probe — a SEPARATE measurement from the sdk gateway's own) — absent, the child's
    // bash tool runs unwrapped, never a claimed confinement with no evidence (session-runner.ts's
    // own `config.sandbox !== undefined` branch).
    let sandbox: PiChildSandboxConfig | undefined;
    if (this._config.confinementPosture === 'confined' && mapped.piNames.includes('bash')) {
      const settings = buildBashConfinement({
        root: workspace,
        grantedHostPaths: this._config.confinement?.allowHostPaths ?? [],
        protectedFiles: this._config.confinement?.protectedFiles ?? [],
        workRoot: this._config.confinement?.workRoot,
        homeDir: this._config.confinement?.homeDir ?? process.env['HOME'],
        allowReadPaths: this._config.confinement?.allowReadPaths ?? [],
        ...(req.opts.bash === 'readonly' ? { bashMode: 'readonly' as const } : {}),
      });
      const ripgrepOverride = (this._config.resolveRipgrepOverride ?? resolveRipgrepOverride)();
      sandbox = {
        filesystem: settings.filesystem as PiChildSandboxConfig['filesystem'],
        credentials: settings.credentials as PiChildSandboxConfig['credentials'],
        ripgrepOverride,
      };
    }

    if (req.onHarness) {
      await req.onHarness(
        {
          ...redactHarness({ surfaceType: 'curated', modelName: parsed.model, provider: parsed.provider, prompt: req.prompt, curatedTools: requestedTools, mergedMcp: [], skills: [] }),
          ...(mapped.piNames.includes('bash')
            ? { bash: { mode: (req.opts.bash === 'readonly' ? 'readonly' : 'full') as 'readonly' | 'full', enforced: this._config.confinementPosture === 'confined' } }
            : {}),
        },
        undefined,
      );
    }

    const childConfig: PiChildConfig = {
      runId: req.runId,
      agentId: req.agentId,
      prompt: req.prompt,
      model,
      ...(apiKey !== undefined ? { apiKey } : {}),
      cwd: workspace,
      agentDir,
      systemPrompt: 'You are a helpful assistant.',
      tools: mapped.piNames,
      protectedFiles: [...(this._config.confinement?.protectedFiles ?? [])],
      ...(sandbox !== undefined ? { sandbox } : {}),
      ...(req.opts.bash === 'readonly' ? { bashMode: 'readonly' as const } : {}),
    };

    const effTimeout = resolveTimeout(req.opts.timeoutMs) ?? this._config.timeoutMs;
    return this._dispatchOnce(childConfig, parsed.provider, req, effTimeout);
  }

  private async _dispatchOnce(
    childConfig: PiChildConfig,
    provider: string,
    req: { signal?: AbortSignal; onEvent?: (ev: TranscriptEvent) => void | Promise<void>; onUsage?: (cumulative: Tokens) => void },
    timeoutMs: number | undefined,
  ): Promise<GatewayResult> {
    const spawnImpl = this._config.spawnChild ?? spawn;
    const entryPath = this._config.entryPath ?? ENTRY_PATH;
    const child = spawnImpl('node', ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', entryPath], {
      cwd: childConfig.cwd,
      env: buildChildEnv(),
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderrTail = '';
    child.stderr?.on('data', (d: Buffer) => { stderrTail = (stderrTail + d.toString()).slice(-4096); });
    const reap = (): void => {
      if (child.pid === undefined) return;
      try { this._cliLifecycle.killGroup({ pid: child.pid }); } catch { /* group already gone */ }
    };
    child.once('exit', reap);
    // The child's whole config (including a secret API key, when present) rides on stdin, never a
    // CLI arg (argv is visible to every other process on the host via /proc) and never an env var
    // (bash-env.ts's allowlist has no provider-key entry at all — the two must never meet).
    child.stdin?.write(JSON.stringify(childConfig) + '\n');
    child.stdin?.end();

    let timedOut = false;
    const timer = timeoutMs !== undefined
      ? setTimeout(() => { timedOut = true; try { child.kill('SIGTERM'); } catch { /* already gone */ } reap(); }, timeoutMs)
      : undefined;
    child.once('exit', () => { if (timer) clearTimeout(timer); });
    const onAbort = (): void => { try { child.kill('SIGTERM'); } catch { /* already gone */ } reap(); };
    req.signal?.addEventListener('abort', onAbort, { once: true });

    let cumulative: Tokens = { ...ZERO_TOKENS };
    let settled: GatewayResult | undefined;

    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      let event: PiChildEvent;
      try { event = JSON.parse(line) as PiChildEvent; } catch { return; }
      if (event.t === 'message_end') {
        cumulative = {
          input: cumulative.input + event.usage.input,
          output: cumulative.output + event.usage.output,
          cacheRead: cumulative.cacheRead + event.usage.cacheRead,
          cacheWrite: cumulative.cacheWrite + event.usage.cacheWrite,
        };
        req.onUsage?.(cumulative);
        void req.onEvent?.({ ts: new Date().toISOString(), kind: 'message', data: { text: event.text, role: 'assistant' } });
      } else if (event.t === 'final') {
        settled = { ok: true, provider, model: childConfig.model.model, transport: 'pi', tokens: cumulative, content: event.text };
      } else if (event.t === 'error' || event.t === 'fatal') {
        settled = { ok: false, provider, reason: 'terminal', transport: 'pi', detail: event.message, tokens: cumulative, ...(cumulative.input > 0 || cumulative.output > 0 ? { partial: true as const } : {}) };
      }
    });

    const exitCode: { code: number | null; signal: NodeJS.Signals | null } = await new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
      child.once('error', () => resolve({ code: null, signal: null }));
    });
    rl.close();
    req.signal?.removeEventListener('abort', onAbort);

    if (settled) return settled;
    if (req.signal?.aborted) {
      return { ok: false, provider, reason: 'aborted', transport: 'pi', tokens: cumulative, ...(cumulative.input > 0 || cumulative.output > 0 ? { partial: true as const } : {}) };
    }
    if (timedOut) {
      return { ok: false, provider, reason: 'timeout', transport: 'pi', tokens: cumulative, ...(cumulative.input > 0 || cumulative.output > 0 ? { partial: true as const } : {}) };
    }
    return {
      ok: false, provider, reason: 'terminal', transport: 'pi', retryable: false,
      detail: `pi child exited before reporting a result (code ${exitCode.code ?? 'null'}, signal ${exitCode.signal ?? 'null'})` + (stderrTail.trim() ? `\n--- child stderr (tail) ---\n${stderrTail.trim()}` : ''),
      tokens: cumulative,
    };
  }

  async stop(): Promise<void> {
    // No managed subprocess owned at the gateway level — each dispatch's child is reaped per-call
    // above (group-killed on exit/timeout/abort), never held past its own invoke() call.
  }
}
