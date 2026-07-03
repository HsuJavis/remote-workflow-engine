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
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentOpts, TranscriptEvent } from '../types.js';
import type { AliasMap, GatewayClient, GatewayResult } from './client.js';

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
}

/** D-F11 built-in fallback — never leaves `options.allowedTools` unset even with no
 *  ClaudeAgentSdkGatewayConfig.defaultAllowedTools and no per-call req.opts.allowedTools. */
const BUILT_IN_CORE_TOOLS = ['Read', 'Write', 'Bash'];

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

  constructor(private readonly _config: ClaudeAgentSdkGatewayConfig) {
    this._query = _config.queryImpl ?? sdkQuery;
  }

  async invoke(req: { prompt: string; opts: AgentOpts; runId: string; agentId: string; signal?: AbortSignal }): Promise<GatewayResult> {
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

  private async _invokeOnce(req: { prompt: string; opts: AgentOpts; runId: string; agentId: string; signal?: AbortSignal }): Promise<GatewayResult> {
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

    const options: Options = {
      cwd: this._config.cwd,
      model: req.opts.model,
      thinking: thinkingFor(this._config.aliases, req.opts.model),
      permissionMode: 'bypassPermissions', // headless: never block on interactive tool approval
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
      // (none here) — together these make every agent() session's tool surface deterministically
      // exactly `curatedTools`, regardless of whatever Claude Code configuration happens to be
      // present on the host machine running this product.
      settingSources: [],
      strictMcpConfig: true,
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
