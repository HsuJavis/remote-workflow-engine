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
import { readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AgentOpts, Caps, HarnessDescriptor, Tokens, TranscriptEvent } from '../types.js';
import type { GatewayClient, GatewayResult, EffortApplied } from './client.js';
import { resolveTimeout, attemptsFor } from './client.js';
import { redactHarness } from '../agent-executor.js';
import { parseModelRef } from '../providers.js';
import { RealCliLifecycle } from '../cli-lifecycle.js';
import { buildBashConfinement, readonlyBashRefusal } from './bash-confinement.js';
import { resolveRipgrepOverride } from './pi-child/ripgrep-override.js';
import type { PiChildConfig, PiChildEvent, PiChildSandboxConfig } from './pi-child/protocol.js';
import type { EventSink } from '../event-log.js';
import { PI_HARNESS_VERSION } from '../harness-info.js';
import { materializeAssets, summarizeMcpInit } from './claude-agent-sdk-client.js';
import { resolveMcpConfigs, type ResolveMcpFn } from './mcp-config-resolver.js';
import type { McpServerConfig } from '../mcp-probe.js';
import type { SecretSource } from '../secret-resolver.js';

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

/** residual fix (srt-mux socket leak): `@anthropic-ai/sandbox-runtime`'s mux proxy names its unix
 *  socket `srt-mux-<process.pid>-<seq>.sock` under `os.tmpdir()` — that pid is the pi CHILD's own
 *  (SandboxManager runs inside session-runner.ts, in-process with the child, never a grandchild),
 *  so it is byte-identical to `child.pid` here. srt's own teardown (`SandboxManager.reset()`) is
 *  async but is registered only on `process.once('exit', ...)`, a listener Node runs synchronously
 *  right before the event loop stops — the awaited `muxProxyServer.close()` inside it never finishes
 *  before the process actually ends, so the socket leaks even on a clean successful dispatch, and a
 *  SIGKILLed child (abort/timeout) never runs any exit handler at all. The child ALSO calls
 *  `SandboxManager.reset()` itself before exiting (session-runner.ts) as the fast, clean path for a
 *  normal exit — this sweep is the belt-and-suspenders backstop that is unconditionally correct even
 *  when that race is lost or the child was killed outright. Swept only by exact `<pid>-` prefix, so a
 *  socket some OTHER process on the host created is never touched. Best-effort: a missing/already-
 *  removed file is not an error. */
function sweepSrtMuxSockets(pid: number): void {
  const prefix = `srt-mux-${pid}-`;
  let entries: string[];
  try { entries = readdirSync(tmpdir()); } catch { return; }
  for (const name of entries) {
    if (!name.startsWith(prefix) || !name.endsWith('.sock')) continue;
    try { unlinkSync(join(tmpdir(), name)); } catch { /* already gone — fine */ }
  }
}

function addTokens(a: Tokens, b: Tokens): Tokens {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

/** A failed `GatewayResult`'s `tokens` field types its cache fields optional (unlike the ok arm) —
 *  normalized to 0 before folding into `addTokens`, same convention `claude-agent-sdk-client.ts`'s
 *  own retry loop uses at its equivalent fold site. */
function normalizeTokens(t: Partial<Tokens> & { input: number; output: number }): Tokens {
  return { input: t.input, output: t.output, cacheRead: t.cacheRead ?? 0, cacheWrite: t.cacheWrite ?? 0 };
}

/** rest of slice (f) ("Error classification"): pi's `AssistantMessage.errorMessage` is a plain
 *  string built by pi-ai's own `formatProviderError` (`<status>: <body>` or `<prefix> (<status>):
 *  <body>` when a status/body were extracted from the provider SDK's error object, else the raw
 *  `error.message` verbatim) — there is NO structured status anywhere on the wire our adapter can
 *  read instead (confirmed by reading `pi-ai/dist/types.d.ts`'s `AssistantMessage` shape: only
 *  `errorMessage?: string` and an unrelated `rawStopReason?: string`), so unlike the sdk gateway's
 *  `classifyApiError` (which classifies a closed, typed SDK error-kind union), this one has to
 *  pattern-match the composed string. Three shapes covered: a bare leading status (openai-node's own
 *  `${status} ${message}`, e.g. "401 Incorrect API key provided..."), `formatProviderError`'s own
 *  no-prefix form (`"<status>: <body>"`), and its prefixed form (`"<prefix> (<status>): <body>"`).
 *  401/403/404 -> 'terminal' (retrying costs a full timeout against a provider that already said no,
 *  same rationale as `classifyApiError`); every other status (429/5xx/etc.), and a message with NO
 *  extractable status at all (keyword-only text like "overloaded" or a network error) -> 'retry' —
 *  the same "absent means retry" default `classifyApiError` uses for its own 'unknown' bucket. */
const TERMINAL_HTTP_STATUSES = new Set([401, 403, 404]);

export function classifyPiErrorMessage(message: string): 'terminal' | 'retry' {
  const match = message.match(/^(\d{3})\b/) ?? message.match(/\((\d{3})\)/) ?? message.match(/^(\d{3}):/);
  if (match === null) return 'retry';
  return TERMINAL_HTTP_STATUSES.has(Number(match[1])) ? 'terminal' : 'retry';
}

export interface PiGatewayConfig {
  /** The OpenRouter API key, from the same secret store `resolveAnthropicAuth` reads from
   *  (RWE_SECRET_OPENROUTER_API_KEY / OPENROUTER_API_KEY) — injected only into the pi child's
   *  memory via `setRuntimeApiKey`, never into bash env, never to disk. */
  secretSource?: { resolve(name: string): string | undefined };
  /** `OLLAMA_BASE_URL` — same meaning as the rest of the engine (default `http://localhost:11434`). */
  ollamaBaseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  /** slice (g): the asset-catalog-backed MCP resolver — late-bound via `bindResolveMcp` (see that
   *  method's own doc), never set here directly in production. Absent/no declared names -> no MCP
   *  servers registered, same as today. */
  resolveMcp?: ResolveMcpFn;
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
  /** slice (i): overrides OpenRouter's base URL — a recording fake server stands in for
   *  `https://openrouter.ai/api/v1` so the request shape (model id, tools, `reasoning.effort`) can
   *  be verified with no real OpenRouter key. Omitted -> the real OpenRouter endpoint. */
  openrouterBaseUrl?: string;
}

/** `tool_call`/`tool_result` events carry their args/result JSON-stringified by the child (protocol.ts's
 *  own doc on why) — parsed back here defensively for the transcript consumer. */
function safeParse(json: string): unknown {
  try { return JSON.parse(json); } catch { return json; }
}

function resolveOpenrouterKey(config: PiGatewayConfig): string | undefined {
  return config.secretSource?.resolve('OPENROUTER_API_KEY') ?? process.env['RWE_SECRET_OPENROUTER_API_KEY'] ?? process.env['OPENROUTER_API_KEY'];
}

export class PiGatewayClient implements GatewayClient {
  private readonly _cliLifecycle = new RealCliLifecycle({});
  // research doc §3.1 "generalize the late binds": mirrors ClaudeAgentSdkGatewayClient's own
  // `_eventSink` exactly — a no-op default (nothing bound yet is NEVER confused with "did it"),
  // late-bound by server.ts's existing structural `BindableGateway` check (`bindable?.bindEventSink?.`),
  // which already calls this method on ANY gateway that implements it — no server.ts change needed.
  private _eventSink: EventSink = () => {};

  constructor(private readonly _config: PiGatewayConfig) {}

  /** Same shape/reason as `ClaudeAgentSdkGatewayClient.bindEventSink` — see that method's own doc. */
  bindEventSink(sink: EventSink): void {
    this._eventSink = sink;
  }

  /** slice (g): same shape/reason as `ClaudeAgentSdkGatewayClient.bindResolveMcp` — late-bound
   *  because the gateway is constructed in `composeConfig()`, before `createServer()` builds the
   *  asset catalog. Wired automatically by server.ts's existing structural `BindableGateway` check
   *  (`bindable?.bindResolveMcp?.(...)`) — no server.ts change needed, the same seam `bindEventSink`
   *  above already rides. */
  bindResolveMcp(resolve: ResolveMcpFn): void {
    (this._config as { resolveMcp?: ResolveMcpFn }).resolveMcp = resolve;
  }

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

    // spec "MCP": resolve declared MCP servers through the SAME shared resolver the sdk gateway uses
    // (`${secret:NAME}`/`${run:dir}`/`${run:id}` substitution — mcp-config-resolver.ts) — no second
    // implementation to drift. Owner 19.5.3 parity: a name that cannot be resolved lands in `missing`
    // and the run PROCEEDS (never a refusal) — `materializeAssets` folds skill-missing and mcp-missing
    // into the same list.
    let mcpConfigs: Record<string, McpServerConfig> = {};
    let materialized: { skills: string[]; mcp: string[]; missing: string[] } | undefined;
    if (req.assets !== undefined) {
      try {
        // `PiGatewayConfig.secretSource` only ever had `.resolve()` (the pre-existing OpenRouter-key
        // lookup) — `resolveMcpConfigs`'s shared `secretSource` param wants the full `SecretSource`
        // (it never calls `.names()` either, but the TYPE is shared verbatim with the sdk gateway, by
        // design, so it is not narrowed just for this one caller). A tiny adapter, not a cast: `.names()`
        // is never reachable from this path (`resolveConfig` never calls it), so a stub is honest.
        const secretSource: SecretSource | undefined = this._config.secretSource !== undefined
          ? { resolve: (name: string) => this._config.secretSource!.resolve(name), names: () => [] }
          : undefined;
        const mcpResolved = await resolveMcpConfigs({ resolveMcp: this._config.resolveMcp, secretSource }, req.assets.workflow, req.assets.declared.mcp, req.runId, workspace);
        mcpConfigs = mcpResolved.configs;
        materialized = await materializeAssets(req.assets.roots, workspace, req.assets.declared, async () => mcpResolved);
      } catch (err) {
        // Fail-loud contract (mcp-config-resolver.ts's own doc): an unresolved `${secret:...}` handle
        // on a provisioned MCP server is a clear, typed error — never a silent partial dispatch.
        return { ok: false, provider: parsed.provider, reason: 'terminal', retryable: false, transport: 'pi', detail: err instanceof Error ? err.message : String(err) };
      }
    }

    // spec "Skills" / research doc §4 "Requires read in the tool set": pi's model reaches a skill
    // ONLY through the `read` tool (it reads SKILL.md itself — no separate Skill tool exists on pi,
    // unlike the sdk gateway). A skill-only agent with no `read` tool (`allowedTools` excludes it) can
    // therefore never actually use a materialized skill — refused clearly rather than silently
    // shipping a skill the model has no way to open (decided + documented, spec "Skills": "decide and
    // document"; the alternative considered was auto-adding a jailed read scoped to the skill dir,
    // rejected for v1 as a second, narrower read-tool definition with different containment semantics
    // than the one real `read` tool everywhere else in this file — not worth the surface for v1).
    if ((materialized?.skills.length ?? 0) > 0 && !mapped.piNames.includes('read')) {
      return { ok: false, provider: parsed.provider, reason: 'terminal', retryable: false, transport: 'pi', detail: `SKILL_REQUIRES_READ_TOOL: ${materialized!.skills.join(', ')} ${materialized!.skills.length === 1 ? 'was' : 'were'} materialized but this dispatch's tool set has no 'read' tool — pi's model can only open a skill's SKILL.md through the read tool (no separate Skill tool exists on pi); add Read to allowedTools or drop the skill` };
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

    // spec "Effort": effort maps directly onto pi's thinkingLevel (session-runner.ts). applied:true
    // is claimed ONLY where VERIFIED — openrouter's reasoning.effort field was confirmed on the real
    // outbound wire through the full session path in this iteration's own real-tier evidence
    // (tests/acceptance/pi-harness-openrouter-fake-server.test.ts), stronger than pi-spike-report.md
    // S8's raw completeSimple() check. ollama has no reasoning dial at all (PROVIDER_CAPS.ollama.effort
    // is null) — effort is accepted but never reaches the wire.
    const effortApplied: { applied: true; param: string; restPath: string[]; value: unknown } | { applied: false; reason: string } | undefined =
      req.opts.effort === undefined
        ? undefined
        : parsed.provider === 'openrouter'
          ? { applied: true, param: 'thinkingLevel', restPath: ['reasoning', 'effort'], value: req.opts.effort }
          : { applied: false, reason: 'ollama has no reasoning dial' };

    // Captured (not just dispatched) so the SECOND onHarness call below — once the child's `mcp_init`
    // event arrives with the real turn-1 tool list (issue #106 parity: `summarizeMcpInit`) — can
    // merge `mcpStatus`/`warnings` onto the SAME base descriptor, mirroring the sdk gateway's own
    // eager-then-init-refined onHarness shape.
    const baseDescriptor: HarnessDescriptor = {
      ...redactHarness({
        surfaceType: 'curated', modelName: parsed.model, provider: parsed.provider, prompt: req.prompt, curatedTools: requestedTools,
        mergedMcp: Object.keys(mcpConfigs).map((name) => ({ name })),
        skills: materialized?.skills ?? [],
      }),
      harnessVersion: PI_HARNESS_VERSION,
      ...(materialized !== undefined ? { materialized } : {}),
      ...(mapped.piNames.includes('bash')
        ? { bash: { mode: (req.opts.bash === 'readonly' ? 'readonly' : 'full') as 'readonly' | 'full', enforced: this._config.confinementPosture === 'confined' } }
        : {}),
      ...(effortApplied !== undefined
        ? { effortApplied: effortApplied.applied ? { param: effortApplied.param, value: effortApplied.value } : { reason: effortApplied.reason } }
        : {}),
    };
    if (req.onHarness) {
      await req.onHarness(baseDescriptor, effortApplied);
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
      ...(req.opts.effort !== undefined ? { effort: req.opts.effort } : {}),
      ...(this._config.openrouterBaseUrl !== undefined ? { openrouterBaseUrl: this._config.openrouterBaseUrl } : {}),
      ...(Object.keys(mcpConfigs).length > 0 ? { mcp: mcpConfigs } : {}),
      ...((materialized?.skills.length ?? 0) > 0 ? { skillPaths: materialized!.skills.map((name) => join(workspace, '.claude', 'skills', name)) } : {}),
    };

    const effTimeout = resolveTimeout(req.opts.timeoutMs) ?? this._config.timeoutMs;

    // DES-249 (attemptsFor — the ONE formula every GatewayClient conformer uses, client.ts): an
    // untimed call gets exactly one attempt; a timed call gets `1 + retries`. Childconfig/sandbox/
    // onHarness above are computed ONCE (they do not vary across attempts — the sandbox POLICY and
    // the curated tool surface are facts about this call, not about which attempt is in flight), but
    // each attempt gets its OWN `agent.confinement` line (mirrors the sdk gateway's own "once per
    // ATTEMPT, not once per call" discipline — v37/DES-256) and its own spawned child.
    const attempts = attemptsFor(this._config.retries, effTimeout);
    let last: GatewayResult = { ok: false, provider: parsed.provider, reason: 'terminal', transport: 'pi', retryable: false, detail: 'INTERNAL_ERROR: attemptsFor() returned 0 — no attempt was ever made' };
    let carried: Tokens = { ...ZERO_TOKENS };
    let carriedPartial = false;
    for (let i = 0; i < attempts; i++) {
      this._eventSink({
        kind: 'agent.confinement',
        runId: req.runId,
        agentId: req.agentId,
        attempt: i + 1,
        posture: this._config.confinementPosture === 'confined' ? 'confined' : 'unconfined',
        root: workspace,
        allowWrite: sandbox?.filesystem.allowWrite ?? [],
        denyRead: sandbox?.filesystem.denyRead ?? [],
        enabled: sandbox !== undefined,
        failIfUnavailable: false,
        harnessVersion: PI_HARNESS_VERSION,
      });
      const base = carried;
      let settledThisAttempt = false;
      // issue #127 / v035 L-1 parity: snapshot `carried` per attempt and stop forwarding this
      // attempt's own onUsage once IT has settled — the exact same race `claude-agent-sdk-client.ts`'s
      // own retry loop guards against (a superseded attempt's late frame re-adding already-folded
      // tokens a second time).
      const attemptReq = req.onUsage === undefined ? req : {
        ...req,
        onUsage: (cum: Tokens) => {
          if (settledThisAttempt) return;
          req.onUsage!(addTokens(base, cum));
        },
      };
      last = await this._dispatchOnce(childConfig, parsed.provider, attemptReq, effTimeout, { attempt: i + 1, baseDescriptor });
      settledThisAttempt = true;
      if (last.ok) {
        const total = addTokens(carried, normalizeTokens(last.tokens));
        return carriedPartial ? { ...last, tokens: total, partial: true } : { ...last, tokens: total };
      }
      if (last.tokens) {
        carried = addTokens(carried, normalizeTokens(last.tokens));
        if (last.partial === true) carriedPartial = true;
      }
      if (!last.ok && last.retryable === false) break;
      if (req.signal?.aborted) break;
    }
    if (!last.ok && carried.input + carried.output + carried.cacheRead + carried.cacheWrite > 0) {
      return carriedPartial ? { ...last, tokens: carried, partial: true } : { ...last, tokens: carried };
    }
    return last;
  }

  private async _dispatchOnce(
    childConfig: PiChildConfig,
    provider: string,
    req: { runId: string; agentId: string; signal?: AbortSignal; onEvent?: (ev: TranscriptEvent) => void | Promise<void>; onUsage?: (cumulative: Tokens) => void; onHarness?: (h: HarnessDescriptor, applied?: EffortApplied) => Promise<void> },
    timeoutMs: number | undefined,
    mcpCtx?: { attempt: number; baseDescriptor: HarnessDescriptor },
  ): Promise<GatewayResult> {
    const spawnImpl = this._config.spawnChild ?? spawn;
    const entryPath = this._config.entryPath ?? ENTRY_PATH;
    const child = spawnImpl('node', ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', entryPath], {
      cwd: childConfig.cwd,
      env: buildChildEnv(),
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Captured now (not read off `child` again later): some fake-process test doubles clear `.pid`
    // after 'exit' fires, and the real node ChildProcess keeps it, but the sweep below must work
    // identically either way.
    const childPid = child.pid;
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
        // rest of slice (f) "Error classification": `fatal` is a child-side programming defect
        // (INTERNAL_ERROR: bad config, uncaught throw — session-runner.ts documents every ordinary
        // dispatch failure as `{t:'error'}` instead) — never worth retrying. An `error` event's
        // message is classified by `classifyPiErrorMessage` (401/403/404 -> terminal).
        const retryable = event.t === 'fatal' ? false : classifyPiErrorMessage(event.message) !== 'terminal';
        settled = {
          ok: false, provider, reason: 'terminal', transport: 'pi', detail: event.message, tokens: cumulative,
          ...(retryable ? {} : { retryable: false as const }),
          ...(cumulative.input > 0 || cumulative.output > 0 ? { partial: true as const } : {}),
        };
      } else if (event.t === 'tool_call') {
        void req.onEvent?.({ ts: new Date().toISOString(), kind: 'tool_call', data: { toolCallId: event.toolCallId, toolName: event.toolName, args: safeParse(event.argsJson) } });
      } else if (event.t === 'tool_result') {
        void req.onEvent?.({ ts: new Date().toISOString(), kind: 'tool_result', data: { toolCallId: event.toolCallId, toolName: event.toolName, result: safeParse(event.resultJson), isError: event.isError } });
      } else if (event.t === 'mcp_init' && mcpCtx !== undefined) {
        // Issue #106 parity, pi shape: the child's ONLY observable turn-1 signal (spike S5 — no
        // connection-status API exists) is which `mcp__<server>__*` tools are active. A synthetic
        // `mcp_servers` status is built from that same prefix match (declared.mcpServers comes off
        // the EAGER descriptor already sent, so it is exactly the server names this dispatch
        // registered) and fed through the SAME `summarizeMcpInit` the sdk gateway uses — one
        // MCP_SERVER_NOT_CONNECTED warning shape for both gateways.
        const declared = mcpCtx.baseDescriptor.mcpServers;
        const hasToolsFor = (name: string): boolean => {
          const prefixes = [`mcp__${name}__`, `mcp__${name.replace(/[^A-Za-z0-9_-]/g, '_')}__`];
          return event.activeTools.some((t) => prefixes.some((p) => t.startsWith(p)));
        };
        const { mcpStatus, warnings } = summarizeMcpInit(declared, {
          tools: event.activeTools,
          mcp_servers: declared.map((name) => ({ name, status: hasToolsFor(name) ? 'connected' : 'unknown' })),
        });
        void req.onHarness?.({ ...mcpCtx.baseDescriptor, mcpStatus, ...(warnings.length > 0 ? { warnings } : {}) });
        for (const w of warnings) {
          const tools = mcpStatus.find((m) => m.server === w.server)?.tools.length ?? 0;
          this._eventSink({ kind: 'agent.mcp_not_connected', runId: req.runId, agentId: req.agentId, attempt: mcpCtx.attempt, server: w.server, status: w.status, tools });
        }
      }
    });

    const exitCode: { code: number | null; signal: NodeJS.Signals | null } = await new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
      child.once('error', () => resolve({ code: null, signal: null }));
    });
    rl.close();
    req.signal?.removeEventListener('abort', onAbort);
    // residual fix (srt-mux socket leak): unconditional, before any branch below returns — every
    // path through this dispatch (settled ok, settled error, aborted, timed out, or a bare exit with
    // no event at all) may have initialized srt's mux proxy inside the child.
    if (childPid !== undefined) sweepSrtMuxSockets(childPid);

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
