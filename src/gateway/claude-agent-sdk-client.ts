// ClaudeAgentSdkGatewayClient (D-F1 / DES-007 / DES-009): the production GatewayClient backed by a
// REAL @anthropic-ai/claude-agent-sdk headless session (the `query()` API) — not a raw /v1/messages
// fetch. A raw fetch cannot provide the tool-use agent loop (file tools rooted in the run workspace,
// skills/hooks/MCP later) that REQ-003 and the product core promise require; only a real SDK session
// has one (user decision D1, twice confirmed — the accept-direct-fetch alternative was REJECTED).
//
// Points the session at a local gateway proxy via ANTHROPIC_BASE_URL with a dummy (non-empty, never
// real) ANTHROPIC_API_KEY — D-R2 hermeticity: this class never reads or forwards a real host
// credential; `queryImpl` stays injectable (unit tier fakes the SDK module entirely — UT-018;
// integration tier points the real export at a local stub /v1/messages server — IT-015).
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { CanUseTool, HookCallback, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, readdirSync, statSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentOpts, TranscriptEvent } from '../types.js';
import type { McpServerConfig, McpProbe } from '../mcp-probe.js';
import type { AliasMap, GatewayClient, GatewayResult } from './client.js';
import { isPathContained } from '../path-containment.js';
import { McpRegistry } from '../mcp-registry.js';
import { resolveConfig, type SecretSource } from '../secret-resolver.js';

type QueryImpl = typeof sdkQuery;

export interface ClaudeAgentSdkGatewayConfig {
  /** The gateway proxy's own base URL (e.g. the managed LiteLLM proxy) — wired to
   *  ANTHROPIC_BASE_URL so the real SDK session dispatches through it instead of api.anthropic.com. */
  baseUrl: string;
  /** Working directory for the session — the run workspace, when known, so the SDK's own file
   *  tools (Read/Write/Edit/...) are rooted there. */
  cwd?: string;
  /** Injectable session factory (test seam) — defaults to the real SDK's own `query` export. */
  queryImpl?: QueryImpl;
  /** D-F6: the same alias table LiteLLMGatewayClient takes — resolves req.opts.model to a provider
   *  so the thinking policy below can tell an Anthropic-mapped alias from a non-Anthropic one.
   *  Optional: when omitted (or the alias isn't found), the alias is treated as non-Anthropic
   *  (the safe default — thinking disabled) since that's the failure mode this policy exists to
   *  prevent (a non-reasoning Ollama/OpenAI/Gemini model 400ing on think:true). */
  aliases?: AliasMap;
  /** D-F7: bounds invoke() with an AbortController race exactly like LiteLLMGatewayClient — a
   *  hung/stuck session resolves `{ok:false, reason:'timeout'}` instead of hanging unbounded.
   *  Optional: when omitted, invoke() has no bound of its own (unchanged legacy behavior). */
  timeoutMs?: number;
  /** Extra attempts after the first, only meaningful when timeoutMs is set. Defaults to 0. */
  retries?: number;
  /** D-F11: the configurable default core tool set applied to `options.allowedTools` when a call
   *  carries no `req.opts.allowedTools` of its own (an agentType-derived curation, see
   *  agent-executor.ts, always wins when present). Config key: `defaultAllowedTools` in
   *  rwe.config.json (forwarded by src/main.ts's composeConfig()). Falls back to a built-in
   *  minimal core set (BUILT_IN_CORE_TOOLS below) when this is also omitted — invoke() never
   *  leaves options.allowedTools unset, which is exactly what let the SDK CLI's full, uncurated
   *  tool surface (dozens of tools) through and overwhelmed a 7B local model's tool-selection
   *  ability (08-validation.md round-5 VAL-003). */
  defaultAllowedTools?: string[];
  /** D-V2V-1 (REQ-009 route-back): the asset store's own on-disk root (AssetSyncService's
   *  `assetRoot`, same value ServerConfig/composeConfig thread everywhere else) — read FRESH on
   *  every invoke() call so a push made after boot still reaches the very next run. Omitted ->
   *  no asset wiring at all (mcpServers stays unset, no skill/hook materialization) — unchanged
   *  legacy behavior for any caller that never configures asset storage. */
  assetRoot?: string;
  /** D-V3M-1 (REQ-017 route-back, closes the ①/IT-035 gap): the MCP Provisioning Registry's own
   *  on-disk SQLite path (server.ts's `join(workRoot,'mcp-registry.db')`, same value threaded here
   *  by composeConfig). When set, an agent()'s `opts.mcp` names are resolved fresh off this DB per
   *  invoke via McpRegistry.resolveInjected — so a provision made after boot reaches the very next
   *  run, and ONLY explicitly-referenced entries are injected (strictMcpConfig preserved). Omitted
   *  -> no registry-backed MCP injection (unchanged legacy behavior). */
  mcpRegistryDbPath?: string;
  /** D-V3M-1 (REQ-018): resolves `${secret:NAME}` handles inside a provisioned MCP config from the
   *  server-side secret store (loadSecretSourceFromEnv — `RWE_SECRET_*`). When set, an unresolvable
   *  handle fails the referencing agent() loudly (SECRET_MISSING) rather than passing the literal
   *  handle through. Omitted -> configs are injected verbatim (no handle substitution attempted). */
  secretSource?: SecretSource;
}

/** D-V3M-1: resolveInjected only ever reads (get/SELECT) — never register() — so the McpRegistry the
 *  gateway opens for by-name resolution needs no live prober. This no-op satisfies the constructor
 *  port without a second real probe wiring. */
const NOOP_PROBE: McpProbe = { probe: async () => ({ ok: true }) };

/** D-V2V-1: reads every stored mcp-config asset fresh off disk (`assetRoot/mcp-config/<name>/...`)
 *  keyed by its asset name — the shape `Options.mcpServers` expects. Only the first file per asset
 *  that parses as JSON with a `url`/`command` field is used (same one-config-per-asset convention
 *  as asset-sync.ts's own `isSelfReferential` parsing). Never throws: an unreadable/malformed asset
 *  dir is simply skipped, never surfaced as an invoke() failure. */
function readMcpConfigAssets(assetRoot: string): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  const dir = join(assetRoot, 'mcp-config');
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const nameDir = join(dir, name);
    if (!statSync(nameDir).isDirectory()) continue;
    for (const file of readdirSync(nameDir)) {
      try {
        const cfg = JSON.parse(readFileSync(join(nameDir, file), 'utf-8')) as McpServerConfig;
        if (cfg?.url || cfg?.command) {
          out[name] = cfg;
          break;
        }
      } catch {
        continue; // not parseable JSON — try the next file in this asset dir
      }
    }
  }
  return out;
}

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dest, entry);
    if (statSync(s).isDirectory()) copyDirRecursive(s, d);
    else copyFileSync(s, d);
  }
}

/** D-V2V-1: materializes every stored skill/hook asset into THIS call's run workspace, under
 *  `<workspace>/.claude/skills/<name>/` and `<workspace>/.claude/hooks/<name>/` respectively — the
 *  filesystem layout `settingSources:['project']` reads from. Idempotent (safe to call before
 *  every agent() call); a stored asset this system's own D4 recursion guard already rejected at
 *  push time never exists under `assetRoot` in the first place, so it's never materialized either. */
function materializeAssets(assetRoot: string, workspace: string): void {
  for (const [kind, claudeDir] of [['skill', 'skills'], ['hook', 'hooks']] as const) {
    const dir = join(assetRoot, kind);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const src = join(dir, name);
      if (!statSync(src).isDirectory()) continue;
      copyDirRecursive(src, join(workspace, '.claude', claudeDir, name));
    }
  }
}

/** D-F11 built-in fallback — never leaves `options.allowedTools` unset even with no
 *  ClaudeAgentSdkGatewayConfig.defaultAllowedTools and no per-call req.opts.allowedTools.
 *  D-V2G8-1(b): 'Bash' is EXCLUDED from this default (Gate 8 v2 review, adversarial.md finding V3
 *  HIGH) — a fully-privileged shell must be an explicit agentType opt-in (via its own curated
 *  req.opts.allowedTools, still fully supported), never a silent default for every agent() call. */
const BUILT_IN_CORE_TOOLS = ['Read', 'Write'];

/** D-V2G8-1(d): true only when `candidate` resolves to a path genuinely inside `root` (or IS
 *  `root` itself) — a plain string prefix check would wrongly allow a sibling directory that just
 *  happens to share a prefix (e.g. `/tmp/run-a` vs `/tmp/run-ab`), so this compares against
 *  `root + path.sep`. DES-025/ARCH-016 hardening (REQ-018): delegates to the realpath-resolved
 *  `isPathContained` so a planted symlink whose own path sits inside the workspace but whose real
 *  target escapes it is ALSO denied — a plain `resolve()` string check (the old body here) is fooled
 *  by that case; the plain-resolve `../` escape denial is preserved as a subset (falls back to the
 *  resolved path when `realpathSync` fails, e.g. the target doesn't exist yet). */
function isInsideWorkspace(candidate: string, root: string): boolean {
  return isPathContained(candidate, root);
}

/** D-V2G8-1(d) (Gate 8 v2 review, adversarial.md finding V3 HIGH): the SDK's own documented
 *  `Options.canUseTool` hook (sdk.d.ts:1328) — the seam that inspects a tool call's OWN path
 *  argument (a Read/Write `file_path`, or a Bash command's `blockedPath`) against the run's
 *  workspace root. `cwd` alone is not a jail: nothing stopped an agent() prompt from asking the CLI
 *  to read an absolute path anywhere else on the host (the LiteLLM proxy's own config, a sibling
 *  run's workspace/journal, ...). No workspace root known at all (e.g. a direct unit-tier call with
 *  neither `req.workspace` nor a configured `cwd`) -> nothing to enforce against, allow (unchanged
 *  legacy behavior). Every other tool call with no path-bearing argument at all -> allow; the tool
 *  SURFACE itself is already curated separately via `allowedTools`/`tools` (D-F11/D-V2G8-1(a)(b)).
 *
 *  Real-execution corollary (confirmed via the SDK's own CLAUDE_SDK_CAN_USE_TOOL_SHADOWED runtime
 *  warning): a BARE `allowedTools` entry ("Read", not "Read(...)") auto-approves that tool call
 *  before THIS callback is ever consulted — D-F11/UT-024 requires the built-in default tool set to
 *  stay bare (non-empty, uncurated), so `toolUsePreCheck` below also wires the SAME deny/allow
 *  decision as a `hooks.PreToolUse` matcher (the SDK's own documented suggestion for gating a call that
 *  bare `allowedTools` would otherwise auto-approve) — belt-and-suspenders: whichever of the two
 *  the SDK actually consults for a given call, the workspace boundary still holds. */
function toolUsePreCheck(root: string | undefined, candidate: string | undefined): { behavior: 'allow' } | { behavior: 'deny'; message: string } {
  if (root !== undefined && candidate !== undefined && !isInsideWorkspace(candidate, root)) {
    return { behavior: 'deny', message: `path outside run workspace: ${candidate}` };
  }
  return { behavior: 'allow' };
}

function makeCanUseTool(root: string | undefined): CanUseTool {
  return async (_toolName, input, options) => {
    const candidate = options.blockedPath ?? (input as { file_path?: string }).file_path;
    return toolUsePreCheck(root, candidate);
  };
}

/** D-V2G8-1(d) real-execution corollary (see makeCanUseTool above): a `PreToolUse` hook fires for
 *  EVERY tool call regardless of whether a bare `allowedTools` entry already auto-approved it —
 *  the SDK's own suggested mechanism for gating a call `canUseTool` alone cannot reach. */
function makePreToolUseHook(root: string | undefined): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const candidate = (input.tool_input as { file_path?: string } | undefined)?.file_path;
    const decision = toolUsePreCheck(root, candidate);
    if (decision.behavior === 'deny') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: decision.message,
        },
      };
    }
    return {};
  };
}

/** D-F6: DISABLED for any alias not confirmed to map to the 'anthropic' provider (Ollama/OpenAI/
 *  Gemini via the LiteLLM proxy reject `think:true` on non-reasoning models) — SDK default (left
 *  unset) only for a confirmed Anthropic-mapped alias. */
function thinkingFor(aliases: AliasMap | undefined, model: string | undefined): Options['thinking'] {
  const target = model !== undefined ? aliases?.[model] : undefined;
  return target?.provider === 'anthropic' ? undefined : { type: 'disabled' };
}

// Never a real credential (D-R2): the SDK still requires ANTHROPIC_API_KEY to be non-empty even
// when ANTHROPIC_BASE_URL points somewhere else entirely (a local proxy, or a local stub server).
const DUMMY_API_KEY = 'sk-local-dev-dummy-not-a-real-key';

// D-G8-5: an explicit ALLOWLIST of host env vars the spawned `claude` CLI subprocess actually
// needs to run (find its own binaries, resolve $HOME-relative config/cache paths, respect the
// host's locale/shell) — never the full `process.env`, which would leak every unrelated host
// secret (OPENAI_API_KEY, cloud credentials, ...) straight into a subprocess this class's own
// header comment already promises never happens (D-R2 hermeticity).
const ENV_ALLOWLIST = ['PATH', 'HOME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM'];

/** Builds the spawned CLI subprocess's env from the ALLOWLIST above plus the overridden
 *  ANTHROPIC_* pair — the only two keys this class ever sets to something other than a verbatim
 *  host value. */
function buildSubprocessEnv(baseUrl: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env['ANTHROPIC_BASE_URL'] = baseUrl;
  env['ANTHROPIC_API_KEY'] = DUMMY_API_KEY;
  return env;
}

/** D-G8-2: extracts message/tool_call/tool_result TranscriptEvents from one SDK message's own
 *  content turns (assistant text, tool_use, and the user-role tool_result that follows it) — the
 *  real reasoning/tool-call trace `_drain` previously discarded entirely except the final `result`
 *  summary. Non-assistant/user messages (or messages with no content array) yield nothing. */
function extractEvents(msg: SDKMessage, ts: string): TranscriptEvent[] {
  const content = (msg as unknown as { message?: { content?: unknown } }).message?.content;
  if (!Array.isArray(content)) return [];
  const events: TranscriptEvent[] = [];
  for (const item of content as Array<{ type?: string }>) {
    if (item.type === 'text') events.push({ ts, kind: 'message', data: item });
    else if (item.type === 'tool_use') events.push({ ts, kind: 'tool_call', data: item });
    else if (item.type === 'tool_result') events.push({ ts, kind: 'tool_result', data: item });
  }
  return events;
}

/** One @anthropic-ai/claude-agent-sdk headless session per agent() call: reads only the final
 *  `result` message off the session's own async-generator agent loop. */
export class ClaudeAgentSdkGatewayClient implements GatewayClient {
  private readonly _query: QueryImpl;
  /** D-V3M-1: one read connection to the registry DB, opened lazily and reused. A separate
   *  connection from server.ts's own McpRegistry, but SQLite WAL makes every committed provision
   *  visible to this reader — resolveInjected still returns fresh rows per call. */
  private _mcpRegistry?: McpRegistry;

  constructor(private readonly _config: ClaudeAgentSdkGatewayConfig) {
    this._query = _config.queryImpl ?? sdkQuery;
  }

  /** D-V3M-1 (REQ-017/REQ-018, closes ①): resolves an agent()'s referenced `opts.mcp` names against
   *  the MCP Provisioning Registry, substituting `${secret:NAME}` handles from the server-side
   *  secret store. Returns ONLY the explicitly-referenced entries (strict-by-name isolation). An
   *  unconfigured DB path / empty name list / an unprovisioned name (already rejected at submission)
   *  all yield "no injection". A referenced config whose `${secret:...}` handle can't be resolved
   *  THROWS with the code in the message (SECRET_MISSING / SECRET_HANDLE_INVALID) — REQ-018's
   *  fail-loud contract: the run surfaces a clear error rather than silently running a tool with no
   *  credential or (worse) smuggling the literal handle through as a value. The throw propagates up
   *  as that agent()'s failure (same shape as an unknown agentType/MCP name). */
  private resolveProvisionedMcp(names: string[] | undefined): Record<string, McpServerConfig> {
    if (this._config.mcpRegistryDbPath === undefined || names === undefined || names.length === 0) return {};
    if (this._mcpRegistry === undefined) {
      this._mcpRegistry = new McpRegistry({ dbPath: this._config.mcpRegistryDbPath, probe: NOOP_PROBE });
    }
    const resolved = this._mcpRegistry.resolveInjected(names);
    if ('error' in resolved) return {}; // MCP_NOT_PROVISIONED — submission already fails fast on this
    const out: Record<string, McpServerConfig> = {};
    for (const [name, config] of Object.entries(resolved.configs)) {
      try {
        out[name] = (this._config.secretSource !== undefined ? resolveConfig(config, this._config.secretSource) : config) as McpServerConfig;
      } catch (err) {
        const code = (err as { code?: unknown }).code;
        if (code === 'SECRET_MISSING' || code === 'SECRET_HANDLE_INVALID') {
          throw new Error(`${code}: provisioned MCP '${name}' has an unresolved secret handle — ${(err as Error).message}`);
        }
        throw err;
      }
    }
    return out;
  }

  async invoke(req: { prompt: string; opts: AgentOpts; runId: string; agentId: string; signal?: AbortSignal; workspace?: string }): Promise<GatewayResult> {
    // D-F7: bounded race only when timeoutMs is configured — otherwise unchanged legacy behavior
    // (a single unbounded attempt), same opt-in shape as ClaudeAgentSdkGatewayConfig.timeoutMs itself.
    const attempts = this._config.timeoutMs !== undefined ? 1 + Math.max(0, this._config.retries ?? 0) : 1;
    let last: GatewayResult = { ok: false, provider: 'claude-agent-sdk', reason: 'terminal' };
    for (let i = 0; i < attempts; i++) {
      last = await this._invokeOnce(req);
      if (last.ok) return last;
    }
    return last;
  }

  private async _invokeOnce(req: { prompt: string; opts: AgentOpts; runId: string; agentId: string; signal?: AbortSignal; workspace?: string }): Promise<GatewayResult> {
    const { timeoutMs } = this._config;
    // D-F10(c): the controller must exist BEFORE query() is called and be handed to the SDK's own
    // documented cancellation hook (Options.abortController, sdk.d.ts:1275) — otherwise aborting it
    // only resolves this class's own local await-race while the real spawned `claude` CLI
    // subprocess keeps running unbounded (Gate 7.5 round 4's real repro).
    const controller = timeoutMs !== undefined || req.signal !== undefined ? new AbortController() : undefined;
    const timer = timeoutMs !== undefined ? setTimeout(() => controller!.abort(), timeoutMs) : undefined;
    const onExternalAbort = () => controller?.abort();
    req.signal?.addEventListener('abort', onExternalAbort, { once: true });

    // D-F11: caller-supplied (agentType-derived) curation wins; else the configured default core
    // set; else a built-in minimal core set — never left unset (see BUILT_IN_CORE_TOOLS above).
    const curatedTools =
      (req.opts as AgentOpts & { allowedTools?: string[] }).allowedTools ??
      this._config.defaultAllowedTools ??
      BUILT_IN_CORE_TOOLS;

    // D-V2V-1 (REQ-009 route-back, binding ORCH ruling): a known run workspace gets its own
    // materialized `.claude/skills|hooks` dir and is loaded via `settingSources:['project']`,
    // `cwd` re-scoped to THAT workspace (never the whole server workRoot) — host-level sources
    // ('user'/'local') stay excluded either way, preserving the D-F11 isolation this class was
    // built to close. No workspace known (e.g. a direct unit-tier invoke() call) -> unchanged
    // legacy behavior (this._config.cwd, settingSources: []).
    if (req.workspace !== undefined && this._config.assetRoot !== undefined) {
      materializeAssets(this._config.assetRoot, req.workspace);
    }
    // D-V3M-1 (REQ-017, closes ①): the run's MCP surface = the legacy server-wide mcp-config assets
    // (now effectively empty — mcp-config pushes redirect to provisioning, DES-028) MERGED with the
    // registry-provisioned servers THIS agent explicitly references by name in `opts.mcp`, resolved
    // fresh off the registry DB per call (so a provision after boot reaches the next run) with
    // `${secret:NAME}` handles substituted server-side. `strictMcpConfig: true` stays true, so the
    // model still sees ONLY this set — the VAL-003 host-ambient-MCP isolation invariant holds.
    const assetMcp = this._config.assetRoot !== undefined ? readMcpConfigAssets(this._config.assetRoot) : {};
    const provisionedMcp = this.resolveProvisionedMcp(req.opts.mcp);
    const mergedMcp = { ...assetMcp, ...provisionedMcp };
    const mcpServers = Object.keys(mergedMcp).length > 0 ? mergedMcp : undefined;

    const options: Options = {
      cwd: req.workspace ?? this._config.cwd,
      model: req.opts.model,
      thinking: thinkingFor(this._config.aliases, req.opts.model),
      // D-V2G8-1(a): 'bypassPermissions' skipped EVERY tool-call decision outright — paired with a
      // curated-but-still-Bash-capable-by-opt-in tool set and no path check, this let any agent()
      // call drive a fully-privileged shell in the parent trust zone. 'default' + the canUseTool
      // boundary callback below (D-V2G8-1(d)) makes THIS class's own logic the arbiter of every
      // tool call instead of bypassing arbitration entirely; canUseTool always resolves promptly
      // (never returns null), so this stays headless — no interactive prompt ever blocks a run.
      permissionMode: 'default',
      canUseTool: makeCanUseTool(req.workspace ?? this._config.cwd),
      // D-V2G8-1(d) real-execution corollary: a BARE `allowedTools` entry auto-approves that tool
      // before `canUseTool` above is ever consulted (confirmed via the SDK's own
      // CLAUDE_SDK_CAN_USE_TOOL_SHADOWED runtime warning) — D-F11/UT-024 still requires this list
      // to stay bare and non-empty (never left unset, including the built-in fallback), so the
      // `hooks.PreToolUse` matcher below (the SDK's own suggested mechanism for this exact case)
      // enforces the SAME workspace-boundary decision for every call this auto-approves.
      allowedTools: curatedTools,
      // `allowedTools` alone only auto-approves those tools without prompting — it does NOT remove
      // the rest from what the CLI puts on the wire (sdk.d.ts:1323's own doc: "To restrict which
      // tools are available, use the `tools` option instead"). Confirmed via a direct real-CLI
      // repro (IT-023): with only `allowedTools` set, the outbound request's own `tools` array
      // still carried the CLI's full built-in surface. `tools` (sdk.d.ts:1370) is the option that
      // actually narrows the built-in tool set sent to the model — set to the SAME curated list.
      tools: curatedTools,
      // The CLI's full uncurated surface (round-5 VAL-003's root cause) also included this HOST
      // environment's own inherited project/user MCP plugin tools (Playwright, Cloudflare, ...) —
      // `tools` alone doesn't touch those. `settingSources: []` (SDK isolation mode) skips loading
      // any filesystem settings (user/project/local, including plugin/MCP config) and
      // `strictMcpConfig: true` restricts MCP servers to only what `mcpServers` explicitly passes
      // — together these make every agent() session's tool surface deterministically exactly
      // `curatedTools` (+ whatever this run's own workspace-scoped `.claude/` materializes, D-V2V-1),
      // regardless of whatever Claude Code configuration happens to be present on the host machine
      // running this product.
      settingSources: req.workspace !== undefined ? ['project'] : [],
      strictMcpConfig: true,
      // Our own McpServerConfig (mcp-probe.ts) is a loose superset the SDK's own discriminated
      // McpServerConfig union narrows further — already validated at push time (server.ts's
      // checkMcpConfigTransport only ever accepts remote-http/npx-stdio configs into storage).
      mcpServers: mcpServers as Options['mcpServers'],
      // D-V2G8-1(d): belt-and-suspenders alongside canUseTool above — fires for every tool call
      // regardless of whether a bare allowedTools entry already auto-approved it.
      hooks: { PreToolUse: [{ hooks: [makePreToolUseHook(req.workspace ?? this._config.cwd)] }] },
      abortController: controller,
      // D-G8-5: an explicit allowlist (never the full host process.env — see buildSubprocessEnv).
      env: buildSubprocessEnv(this._config.baseUrl),
    };
    const session = this._query({ prompt: req.prompt, options });
    const drain = this._drain(session, req.opts.model);

    if (controller === undefined) return drain;

    // D-F7/D-F9a: race the session against a timeoutMs-bounded timer and/or the caller's own
    // (RunManager-owned) AbortSignal — whichever fires first wins, exactly like
    // LiteLLMGatewayClient's per-attempt AbortController race.
    const bound = new Promise<'aborted'>((resolve) => {
      controller.signal.addEventListener('abort', () => resolve('aborted'), { once: true });
    });

    try {
      const outcome = await Promise.race([drain, bound]);
      if (outcome !== 'aborted') return outcome;
      return { ok: false, provider: 'claude-agent-sdk', reason: timeoutMs !== undefined ? 'timeout' : 'terminal' };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      req.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  /** Reads a session's own async-generator agent loop to its 'result' message (or natural end).
   *  D-G8-2: every intermediate message/tool_call/tool_result turn along the way is captured (in
   *  order) into the returned GatewayResult.events, not just the final result — the real
   *  reasoning/tool-call trace `workflow_agent_log` is built to show. */
  private async _drain(session: ReturnType<QueryImpl>, model: string | undefined): Promise<GatewayResult> {
    const events: TranscriptEvent[] = [];
    try {
      for await (const msg of session as AsyncIterable<SDKMessage>) {
        if (msg.type !== 'result') {
          events.push(...extractEvents(msg, new Date().toISOString())); // det:allow — transcript timestamp, not a decision
          continue;
        }
        if (msg.subtype !== 'success' || msg.is_error) {
          return { ok: false, provider: 'claude-agent-sdk', reason: 'terminal' };
        }
        return {
          ok: true,
          provider: 'claude-agent-sdk',
          model: model ?? 'default',
          tokens: { input: msg.usage.input_tokens ?? 0, output: msg.usage.output_tokens ?? 0 },
          content: msg.result,
          events,
        };
      }
      // Session ended without ever emitting a result message.
      return { ok: false, provider: 'claude-agent-sdk', reason: 'unreachable' };
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      return { ok: false, provider: 'claude-agent-sdk', reason: timedOut ? 'timeout' : 'unreachable' };
    }
  }
}
