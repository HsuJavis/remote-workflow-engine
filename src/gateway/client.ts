// GatewayClient interface + LiteLLMGatewayClient (DES-009 / ARCH-005 / TASK-011/012).
// Narrow invoke(prompt,opts) over the configured provider; bounded timeout -> retry -> null semantics
// (D-G): a dead/hung/misconfigured provider resolves { ok:false } rather than hanging or throwing.
// Sole custody of provider API keys lives here (parent-only, never exposed to the sandboxed script).
import type { AgentOpts, HarnessDescriptor, TranscriptEvent } from '../types.js';
import { LiteLLMProxyManager } from './litellm-proxy.js';

export interface AliasMap {
  [alias: string]: { provider: 'anthropic' | 'openai' | 'openrouter' | 'gemini' | 'ollama'; model: string };
}

export type GatewayResult =
  | {
      ok: true; provider: string; model: string; tokens: { input: number; output: number }; content: unknown;
      /** D-G8-2: the real message/tool_call/tool_result turns this call's session produced, in
       *  order — only ClaudeAgentSdkGatewayClient populates this today (a real SDK session
       *  actually has a turn-by-turn stream to capture); absent/undefined for gateways with no
       *  such stream (unchanged legacy behavior — a call still yields only the terminal usage
       *  event via AgentTranscriptSink.capture()). */
      events?: TranscriptEvent[];
    }
  | {
      ok: false; provider: string; reason: 'timeout' | 'unreachable' | 'terminal';
      /** Observability: when a real SDK session ends in a non-success `result` message, the CLI's
       *  error subtype (e.g. `error_during_execution`, `error_max_turns`) and any error text — so a
       *  0-token `terminal` failure is diagnosable instead of opaque. Also carries the partial
       *  transcript captured before the failure. */
      detail?: string;
      events?: TranscriptEvent[];
    };

export interface GatewayClient {
  /** `signal` (D-F9a): an optional external AbortSignal — RunManager's own per-run
   *  abortController, threaded through AgentExecutor — that a real implementation should honor to
   *  actually cancel an in-flight provider call on workflow_suspend, not merely stop waiting for it.
   *  `workspace` (D-V2V-1): the run's own on-disk workspace (AgentReq.workspace, always set by
   *  AgentExecutor) — only ClaudeAgentSdkGatewayClient consumes it (to re-scope `cwd`/materialize
   *  assets per call); other gateways ignore it, unchanged. */
  /** `onHarness` (DES-066 / TASK-069): optional hook called eagerly at session-build time (post-curation,
   *  before any query) with the redacted `HarnessDescriptor`. The executor wires this to append a
   *  `{kind:'harness'}` transcript event so deriveAgentRecords can surface the dispatched agent's model. */
  invoke(req: { prompt: string; opts: AgentOpts; runId: string; agentId: string; signal?: AbortSignal; workspace?: string; onHarness?: (h: HarnessDescriptor) => Promise<void> }): Promise<GatewayResult>;
  /** D-V2I-6: optional lifecycle hook — a gateway that owns a subprocess (e.g.
   *  `LiteLLMGatewayClient`'s managed `LiteLLMProxyManager`) cascades the stop here so
   *  `Server.close()` can reap it regardless of which gateway-selection branch built it. Gateways
   *  with nothing to release (e.g. the plain direct-fetch path with no proxy) simply omit it. */
  stop?(): Promise<void>;
}

export interface GatewayConfig {
  aliases: AliasMap;
  timeoutMs: number;
  retries: number;
  /** Injectable HTTP transport — defaults to the global fetch. Unit tests inject a fake
   *  transport here instead of hitting a live provider (D-I6: unit tier never requires live creds). */
  fetchImpl?: typeof fetch;
  /**
   * D-V1: route agent() calls through a managed LiteLLM proxy subprocess — the same
   * ANTHROPIC_BASE_URL wiring a real @anthropic-ai/claude-agent-sdk headless session would use
   * (confirmed: LiteLLM's proxy serves an Anthropic-Messages-shaped /v1/messages endpoint that
   * resolves the alias to whichever provider it's configured for) — instead of calling each
   * provider's native API directly. Explicit opt-in (defaults to false/unset): the direct-fetch
   * path above remains the default so existing callers/tests are unaffected; a caller that wants
   * the proxy path sets this to true.
   */
  useLiteLLMProxy?: boolean;
  /** Injectable proxy manager (tests) — defaults to a real LiteLLMProxyManager over `aliases`. */
  proxyManager?: LiteLLMProxyManager;
  /** TASK-027: overrides the managed LiteLLM proxy's port (default 4000) when this client builds
   *  its own default LiteLLMProxyManager (i.e. `proxyManager` above is not injected). Only takes
   *  effect the same way `useLiteLLMProxy` does — no `proxyManager` injected. */
  litellmPort?: number;
}

type ProviderTarget = AliasMap[string];
type AttemptFailure = { ok: false; provider: string; reason: 'timeout' | 'unreachable' | 'terminal' };

/** Real provider call — one impl per provider, all sharing the same bounded-timeout contract. */
async function callProvider(
  target: ProviderTarget,
  req: { prompt: string; runId: string; agentId: string },
  timeoutMs: number,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<GatewayResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // D-F10(c): a caller-supplied signal (RunManager's own abortController, threaded through
  // AgentExecutor) genuinely cancels the in-flight fetch on workflow_suspend, not just the
  // timeoutMs-bounded internal timer.
  const onExternalAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onExternalAbort, { once: true });
  const correlationHeaders = { 'x-run-id': req.runId, 'x-agent-id': req.agentId };
  try {
    switch (target.provider) {
      case 'anthropic': {
        const apiKey = process.env['ANTHROPIC_API_KEY'];
        if (!apiKey) return { ok: false, provider: 'anthropic', reason: 'terminal' };
        const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...correlationHeaders },
          body: JSON.stringify({ model: target.model, max_tokens: 1024, messages: [{ role: 'user', content: req.prompt }] }),
        });
        if (!res.ok) return { ok: false, provider: 'anthropic', reason: res.status >= 500 ? 'unreachable' : 'terminal' };
        const data = (await res.json()) as any;
        const content = Array.isArray(data.content) ? data.content.map((c: any) => c.text ?? '').join('') : data.content;
        return {
          ok: true, provider: 'anthropic', model: target.model,
          tokens: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 },
          content,
        };
      }
      case 'openai': {
        const apiKey = process.env['OPENAI_API_KEY'];
        if (!apiKey) return { ok: false, provider: 'openai', reason: 'terminal' };
        const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          signal: controller.signal,
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', ...correlationHeaders },
          body: JSON.stringify({ model: target.model, messages: [{ role: 'user', content: req.prompt }] }),
        });
        if (!res.ok) return { ok: false, provider: 'openai', reason: res.status >= 500 ? 'unreachable' : 'terminal' };
        const data = (await res.json()) as any;
        return {
          ok: true, provider: 'openai', model: target.model,
          tokens: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
          content: data.choices?.[0]?.message?.content,
        };
      }
      case 'openrouter': {
        // REQ-038: OpenRouter speaks the OpenAI chat-completions shape; its key is its OWN env var
        // (OPENROUTER_API_KEY), never the OpenAI one — the two providers coexist with separate keys
        // and no OPENAI_API_BASE global remap.
        const apiKey = process.env['OPENROUTER_API_KEY'];
        if (!apiKey) return { ok: false, provider: 'openrouter', reason: 'terminal' };
        const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          signal: controller.signal,
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', ...correlationHeaders },
          body: JSON.stringify({ model: target.model, messages: [{ role: 'user', content: req.prompt }] }),
        });
        if (!res.ok) return { ok: false, provider: 'openrouter', reason: res.status >= 500 ? 'unreachable' : 'terminal' };
        const data = (await res.json()) as any;
        return {
          ok: true, provider: 'openrouter', model: target.model,
          tokens: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
          content: data.choices?.[0]?.message?.content,
        };
      }
      case 'gemini': {
        const apiKey = process.env['GEMINI_API_KEY'];
        if (!apiKey) return { ok: false, provider: 'gemini', reason: 'terminal' };
        const res = await fetchImpl(
          `https://generativelanguage.googleapis.com/v1beta/models/${target.model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            signal: controller.signal,
            headers: { 'content-type': 'application/json', ...correlationHeaders },
            body: JSON.stringify({ contents: [{ parts: [{ text: req.prompt }] }] }),
          },
        );
        if (!res.ok) return { ok: false, provider: 'gemini', reason: res.status >= 500 ? 'unreachable' : 'terminal' };
        const data = (await res.json()) as any;
        const usage = data.usageMetadata ?? {};
        return {
          ok: true, provider: 'gemini', model: target.model,
          tokens: { input: usage.promptTokenCount ?? 0, output: usage.candidatesTokenCount ?? 0 },
          content: data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join(''),
        };
      }
      case 'ollama': {
        const base = process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434';
        const res = await fetchImpl(`${base}/api/generate`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', ...correlationHeaders },
          body: JSON.stringify({ model: target.model, prompt: req.prompt, stream: false }),
        });
        if (!res.ok) return { ok: false, provider: 'ollama', reason: res.status === 404 ? 'terminal' : 'unreachable' };
        const data = (await res.json()) as any;
        return {
          ok: true, provider: 'ollama', model: target.model,
          tokens: { input: data.prompt_eval_count ?? 0, output: data.eval_count ?? 0 },
          content: data.response,
        };
      }
      default:
        return { ok: false, provider: target.provider, reason: 'terminal' };
    }
  } catch (err) {
    const failure: AttemptFailure = {
      ok: false,
      provider: target.provider,
      reason: err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'unreachable',
    };
    return failure;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * D-V1: routes one agent() call through the managed LiteLLM proxy's Anthropic-Messages-shaped
 * `/v1/messages` endpoint — the same request shape a real @anthropic-ai/claude-agent-sdk headless
 * session sends when ANTHROPIC_BASE_URL points at this proxy — using the alias name as `model`
 * (LiteLLM resolves it against the generated model_list, independent of the alias's own provider).
 */
async function callViaLiteLLMProxy(
  proxy: LiteLLMProxyManager,
  aliasName: string,
  target: ProviderTarget,
  req: { prompt: string; runId: string; agentId: string },
  timeoutMs: number,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<GatewayResult> {
  let baseUrl: string;
  try {
    ({ baseUrl } = await proxy.start());
  } catch {
    return { ok: false, provider: target.provider, reason: 'unreachable' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // D-F10(c): same external-signal linkage as callProvider above.
  const onExternalAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onExternalAbort, { once: true });
  try {
    const res = await fetchImpl(`${baseUrl}/v1/messages`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': 'litellm-proxy', 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
        'x-run-id': req.runId, 'x-agent-id': req.agentId,
      },
      body: JSON.stringify({ model: aliasName, max_tokens: 1024, messages: [{ role: 'user', content: req.prompt }] }),
    });
    if (!res.ok) return { ok: false, provider: target.provider, reason: res.status >= 500 ? 'unreachable' : 'terminal' };
    const data = (await res.json()) as any;
    const content = Array.isArray(data.content) ? data.content.map((c: any) => c.text ?? '').join('') : data.content;
    return {
      ok: true, provider: target.provider, model: target.model,
      tokens: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 },
      content,
    };
  } catch (err) {
    return { ok: false, provider: target.provider, reason: err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

export class LiteLLMGatewayClient implements GatewayClient {
  private readonly _proxy: LiteLLMProxyManager | undefined;

  constructor(private readonly _config: GatewayConfig) {
    if (this._config.useLiteLLMProxy) {
      this._proxy =
        this._config.proxyManager ?? new LiteLLMProxyManager(this._config.aliases, { port: this._config.litellmPort });
    }
  }

  async invoke(req: { prompt: string; opts: AgentOpts; runId: string; agentId: string; signal?: AbortSignal; onHarness?: (h: HarnessDescriptor) => Promise<void> }): Promise<GatewayResult> {
    const aliasName = req.opts.model ?? 'default';
    const target = this._config.aliases[aliasName];
    if (!target) return { ok: false, provider: 'unknown', reason: 'terminal' };
    // DES-066 (TASK-069): emit harness descriptor eagerly at model-resolution time (surfaceType:'none'
    // — direct-fetch has no curated tool surface). 4KB head+tail cap on prompt.
    if (req.onHarness) {
      const p = req.prompt;
      const PROMPT_CAP = 4096, HALF = 2048;
      const cappedPrompt = p.length > PROMPT_CAP ? p.slice(0, HALF) + '…[truncated]…' + p.slice(p.length - HALF) : p;
      await req.onHarness({ model: aliasName, provider: target.provider, prompt: cappedPrompt, tools: [], skills: [], mcpServers: [], surfaceType: 'none' });
    }

    const fetchImpl = this._config.fetchImpl ?? fetch;
    const attempts = 1 + Math.max(0, this._config.retries);
    let last: GatewayResult = { ok: false, provider: target.provider, reason: 'terminal' };
    for (let i = 0; i < attempts; i++) {
      last = this._proxy
        ? await callViaLiteLLMProxy(this._proxy, aliasName, target, req, this._config.timeoutMs, fetchImpl, req.signal)
        : await callProvider(target, req, this._config.timeoutMs, fetchImpl, req.signal);
      if (last.ok) return last;
    }
    return last;
  }

  /** D-V2I-6: cascades to whichever `LiteLLMProxyManager` this client holds (injected OR
   *  internally-constructed by the constructor above, same private field either way) — a safe
   *  no-op when `useLiteLLMProxy` was never set (no proxy was ever built). */
  async stop(): Promise<void> {
    await this._proxy?.stop();
  }
}
