// GatewayClient interface + LiteLLMGatewayClient (DES-009 / ARCH-005 / TASK-011/012).
// Narrow invoke(prompt,opts) over the configured provider; bounded timeout -> retry -> null semantics
// (D-G): a dead/hung/misconfigured provider resolves { ok:false } rather than hanging or throwing.
// Sole custody of provider API keys lives here (parent-only, never exposed to the sandboxed script).
import type { AgentOpts, Caps, HarnessDescriptor, TranscriptEvent } from '../types.js';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { LiteLLMProxyManager, proxyModelName } from './litellm-proxy.js';
import { redactHarness } from '../agent-executor.js';
import type { Provider } from '../providers.js';

export interface AliasMap {
  [alias: string]: { provider: Provider; model: string };
}

/** issue #24/#22: validate a caller-supplied per-call timeout (AgentOpts.timeoutMs). Only a positive,
 *  finite number is honored; anything else (0, negative, NaN, a string from an untrusted script) →
 *  undefined so the caller falls back to the gateway's configured default — a bad value can never
 *  DISABLE the bound. Shared by both gateway clients so the predicate can't drift. */
export function resolveTimeout(t: unknown): number | undefined {
  return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : undefined;
}

/** DES-106/ARCH-069 (TASK-102): the tri-state record of whether/how a requested `effort` directive
 *  reached the wire — `applied:true` names the outbound placement + value; `applied:false`
 *  degrades the run without failing it and records why (e.g. no reasoning dial for this provider).
 *  `param` is the flat Agent SDK Options field; `restPath` is the (possibly nested) REST-body path —
 *  the two wire shapes place the same reasoning-effort concept differently (E-1/P-A1: the Anthropic
 *  Messages API nests it at `output_config.effort`, never top-level, while the Agent SDK's own
 *  `Options` object takes it as a flat field), so one flat name cannot describe both placements. */
export type EffortApplied =
  | { applied: true; param: string; restPath: string[]; value: unknown }
  | { applied: false; reason: string };

/** v26 (DES-173, ARCH-112, TASK-174, REQ-123): the single shared pure mapper, called ONCE per
 *  invoke inside each gateway — replaces the retired `EFFORT_PROFILES`/`profileFor`/`mapEffort`
 *  trio now that `anthropic` is the only provider with a reasoning-effort dial (`openrouter`'s own
 *  `thinking`/`budget_tokens` dial is DES-179/`wireEffort`'s job, gated on a pinned capability this
 *  gateway does not have yet — out of scope here). Absent (`undefined`) when no effort was ever
 *  requested — effort-absent request composition must stay byte-identical to pre-v21 on both
 *  clients (pinned by UT-101). */
export function resolveEffortApplied(provider: string | undefined, effort: AgentOpts['effort']): EffortApplied | undefined {
  if (effort === undefined) return undefined;
  if (provider !== 'anthropic') return { applied: false, reason: 'no reasoning dial for this provider' };
  return { applied: true, param: 'effort', restPath: ['output_config', 'effort'], value: effort };
}

/** v26 (DES-179, ARCH-117, TASK-179, REQ-126, issue #71): the reasoning-effort budget levels the
 *  deployed LiteLLM proxy translates into upstream `reasoning_effort` low/medium/high for the
 *  openrouter `thinking.budgetTokens` dial. A claim about a THIRD PARTY: `result.usage` carries no
 *  `reasoning_tokens` through the SDK, so unit tests can only assert the wire SHAPE — the real-tier
 *  confirmation (a Gate 7.5 `--detailed_debug` proxy capture grepping `reasoning_effort`, plus an
 *  observable low-vs-high difference on a declared-reasoning model) is still pending at Gate 6; this
 *  comment records that honestly rather than pinning a LiteLLM version never actually observed. */
export const REASONING_BUDGET: Record<NonNullable<AgentOpts['effort']>, number> = {
  low: 1024, medium: 2048, high: 4096, xhigh: 4096, max: 4096,
};

/** v26 (DES-179, ARCH-117, TASK-179, REQ-126, issue #71): the SINGLE writer of both `options.thinking`
 *  AND `options.effort` on the SDK transport — resolved as provider profile × the PINNED model
 *  capability (`caps` — the run's admission-time pin, ARCH-116; never a fresh lookup at dispatch).
 *  Total over provider x caps.reasoning; `applied` is ALWAYS present (an optional field is one a
 *  lower tier omits on exactly the path anyone will debug). No `effort` requested at all reproduces
 *  the pre-v26 byte-identical shape: `anthropic` leaves `thinking` at the SDK default (`undefined`),
 *  every other (or absent) provider disables it explicitly — independent of `caps`, matching
 *  `resolveThinkingMode`'s retired alias-aware behavior (claude-agent-sdk-client.ts) byte for byte.
 *  `effortBodyFields` below (the direct-fetch transport) reads the same `PROVIDER_CAPS` table for its
 *  own body — two transport-local writers, one table, no third (ADR-045). */
export function wireEffort(
  provider: Provider | undefined,
  caps: Caps,
  effort?: AgentOpts['effort'],
): { thinking: Options['thinking']; effort?: AgentOpts['effort']; applied: EffortApplied } {
  if (effort === undefined) {
    return {
      thinking: provider === 'anthropic' ? undefined : { type: 'disabled' },
      applied: { applied: false, reason: 'no effort requested' },
    };
  }
  if (provider === 'anthropic') {
    return {
      thinking: undefined, // SDK default
      effort,
      applied: { applied: true, param: 'effort', restPath: ['output_config', 'effort'], value: effort },
    };
  }
  if (provider === 'openrouter') {
    if (caps.reasoning === true) {
      const budgetTokens = REASONING_BUDGET[effort];
      return {
        thinking: { type: 'enabled', budgetTokens },
        applied: { applied: true, param: 'thinking', restPath: ['thinking', 'budget_tokens'], value: budgetTokens },
      };
    }
    return {
      thinking: { type: 'disabled' },
      applied: {
        applied: false,
        reason: caps.reasoning === 'unknown' ? 'model reasoning support unknown' : 'model does not declare reasoning',
      },
    };
  }
  // ollama, or any provider outside the closed union (including undefined) — the fail-safe branch.
  return { thinking: { type: 'disabled' }, applied: { applied: false, reason: 'no reasoning dial for this provider' } };
}

export type GatewayResult =
  | {
      ok: true; provider: string; model: string;
      /** v26 (DES-180, ARCH-118, TASK-180): widened to four columns (cache read/write priced
       *  separately from a fresh input/output token) — `cacheRead`/`cacheWrite` stay OPTIONAL
       *  (never required) for the same backward-compat reason `AgentRecord.tokens` does: dozens of
       *  existing test-fake `GatewayResult` literals across this codebase carry only
       *  `{input, output}`, and none of them are this task's to touch. Every REAL gateway
       *  implementation (below, and claude-agent-sdk-client.ts) populates all four. */
      tokens: { input: number; output: number; cacheRead?: number; cacheWrite?: number }; content: unknown;
      /** D-G8-2: the real message/tool_call/tool_result turns this call's session produced, in
       *  order — only ClaudeAgentSdkGatewayClient populates this today (a real SDK session
       *  actually has a turn-by-turn stream to capture); absent/undefined for gateways with no
       *  such stream (unchanged legacy behavior — a call still yields only the terminal usage
       *  event via AgentTranscriptSink.capture()). */
      events?: TranscriptEvent[];
      /** v26 (DES-171, ARCH-111): unmapped `system` message subtypes observed this call (counted,
       *  never their payload — see classifyApiError's neighbour, ClaudeAgentSdkGatewayClient._drain). */
      unmapped?: string[];
      /** v26 (DES-177, ARCH-115, TASK-177, REQ-125): which wire carried this call — `provider`/
       *  `model` above are now the RESOLVED provider/model (never the transport name). Optional
       *  (not `?:` in the DES's own signature line) because ~30 existing GatewayResult literals
       *  across this codebase — `NULL_GATEWAY`, per-call error literals, every test fake — would
       *  otherwise need a mechanical edit unrelated to what they test; `capture()` (agent-executor.ts)
       *  already treats an absent `transport` as the pre-v26 case. */
      transport?: 'claude-agent-sdk' | 'direct-fetch';
      /** v26 (DES-177, TASK-177): the proxy-facing model id actually put on the wire (LiteLLM's
       *  resolution target) — present only on a call that went through a LiteLLM proxy, absent on a
       *  direct-to-provider dispatch (there is no cloak to report). */
      proxyModel?: string;
    }
  | {
      ok: false; provider: string; reason: 'timeout' | 'unreachable' | 'terminal';
      /** Observability: when a real SDK session ends in a non-success `result` message, the CLI's
       *  error subtype (e.g. `error_during_execution`, `error_max_turns`) and any error text — so a
       *  0-token `terminal` failure is diagnosable instead of opaque. Also carries the partial
       *  transcript captured before the failure. */
      detail?: string;
      events?: TranscriptEvent[];
      /** v26 (DES-171, ARCH-111, TASK-176, issue #65): `false` on a `classifyApiError`-terminal
       *  failure — `invoke()`'s retry loop stops immediately instead of burning the full
       *  `timeoutMs × (1+retries)` bound against a provider that already said no. Absent (not
       *  `true`) on every other failure reason, which keeps retrying (unchanged legacy behavior). */
      retryable?: false;
      /** v26 (DES-171): the classified provider error this terminal failure came from. */
      error?: { kind: string; status: number | null; attempt: number };
      /** v26 (DES-171): unmapped `system` message subtypes observed before this failure. */
      unmapped?: string[];
      /** v26 (DES-177): which wire this failed attempt went out on — see the ok:true arm's doc. */
      transport?: 'claude-agent-sdk' | 'direct-fetch';
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
   *  `{kind:'harness'}` transcript event so deriveAgentRecords can surface the dispatched agent's model.
   *  `applied` (DES-106 / TASK-102): the same `EffortApplied` object `resolveEffortApplied` computed,
   *  when any effort directive was requested — recorded ≡ applied by object identity, never a re-lookup. */
  invoke(req: { prompt: string; opts: AgentOpts; runId: string; agentId: string; signal?: AbortSignal; workspace?: string;
    /** v24 (ARCH-103/DES-154, TASK-145): this label's declared skill/mcp asset names + the asset
     *  store's two scope roots — only `ClaudeAgentSdkGatewayClient` consumes it (selective
     *  materialization); other gateways ignore it, unchanged. Absent -> nothing materialized. */
    assets?: { roots: { workflow: string; global: string }; declared: { skills: string[]; mcp: string[] }; workflow: string };
    onHarness?: (h: HarnessDescriptor, applied?: EffortApplied) => Promise<void>;
    /** issue #20: called per live transcript event as the session streams it (before the terminal
     *  result), so agent_log grows and lastActivityAt advances DURING the call. Gateways with no
     *  turn-by-turn stream (LiteLLMGatewayClient) never call it — unchanged terminal-only behavior. */
    onEvent?: (ev: TranscriptEvent) => void | Promise<void>;
    /** v26 (DES-179, ARCH-117, TASK-179): the run's admission-time pinned capability for THIS call's
     *  model (ARCH-116) — only `ClaudeAgentSdkGatewayClient`'s `wireEffort` call reads it today;
     *  other gateways ignore it, unchanged. Absent -> the fail-safe branch (see `wireEffort`). */
    caps?: Caps }): Promise<GatewayResult>;
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

/** DES-106/P-A1: the wire-level fields an applied effort directive contributes to an outbound
 *  Anthropic-Messages-shaped request body — nested per `applied.restPath` (the documented contract
 *  is `output_config:{effort:…}`, never a top-level `effort` field) — a no-op `{}` when no dial
 *  applies (untargeted provider) or no effort was requested. */
function effortBodyFields(applied: EffortApplied | undefined): Record<string, unknown> {
  return applied?.applied ? applied.restPath.reduceRight<unknown>((acc, key) => ({ [key]: acc }), applied.value) as Record<string, unknown> : {};
}

/** Real provider call — one impl per provider, all sharing the same bounded-timeout contract. */
async function callProvider(
  target: ProviderTarget,
  req: { prompt: string; runId: string; agentId: string },
  timeoutMs: number,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  applied?: EffortApplied,
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
          body: JSON.stringify({ model: target.model, max_tokens: 1024, messages: [{ role: 'user', content: req.prompt }], ...effortBodyFields(applied) }),
        });
        if (!res.ok) return { ok: false, provider: 'anthropic', reason: res.status >= 500 ? 'unreachable' : 'terminal' };
        const data = (await res.json()) as any;
        const content = Array.isArray(data.content) ? data.content.map((c: any) => c.text ?? '').join('') : data.content;
        return {
          ok: true, provider: 'anthropic', model: target.model,
          // v26 (DES-180): the real Anthropic Messages API shape — same four fields the SDK path
          // reads (claude-agent-sdk-client.ts's _drain).
          tokens: {
            input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0,
            cacheRead: data.usage?.cache_read_input_tokens ?? 0, cacheWrite: data.usage?.cache_creation_input_tokens ?? 0,
          },
          content,
        };
      }
      case 'openrouter': {
        // REQ-038: OpenRouter speaks an OpenAI-shaped chat-completions API; its key is its OWN env
        // var (OPENROUTER_API_KEY), independent of any other provider's credentials.
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
          // v26 (DES-180): OpenRouter's OpenAI-shaped usage carries cache read under
          // `prompt_tokens_details.cached_tokens` and cache write as a top-level `cache_write_tokens`
          // (present for providers OpenRouter fronts that report it, e.g. an Anthropic passthrough).
          tokens: {
            input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0,
            cacheRead: data.usage?.prompt_tokens_details?.cached_tokens ?? 0, cacheWrite: data.usage?.cache_write_tokens ?? 0,
          },
          content: data.choices?.[0]?.message?.content,
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
          // v26 (DES-180): ollama has no prompt-cache concept — cache columns are a KNOWN 0, never
          // an absence.
          tokens: { input: data.prompt_eval_count ?? 0, output: data.eval_count ?? 0, cacheRead: 0, cacheWrite: 0 },
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
  applied?: EffortApplied,
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
      // v26 Gate 7.5 round 1 (defect D2): the CLOAKED name, never the bare alias.
      // `generateLiteLLMConfig` registers `rwe-proxy-<alias>` and nothing else, so a bare alias is
      // answered `400 … no healthy deployments for this model` and every agent() call on
      // `gateway:"direct-fetch"` (proxy left on) died. `proxyModelName`'s own doc comment says the
      // prefix must be applied identically on both sides; this side was the one that was missed.
      body: JSON.stringify({ model: proxyModelName(aliasName), max_tokens: 1024, messages: [{ role: 'user', content: req.prompt }], ...effortBodyFields(applied) }),
    });
    if (!res.ok) return { ok: false, provider: target.provider, reason: res.status >= 500 ? 'unreachable' : 'terminal' };
    const data = (await res.json()) as any;
    const content = Array.isArray(data.content) ? data.content.map((c: any) => c.text ?? '').join('') : data.content;
    return {
      ok: true, provider: target.provider, model: target.model,
      // v26 (DES-180): the Anthropic-Messages-shaped proxy response — same four fields as the
      // anthropic-direct branch above.
      tokens: {
        input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0,
        cacheRead: data.usage?.cache_read_input_tokens ?? 0, cacheWrite: data.usage?.cache_creation_input_tokens ?? 0,
      },
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

  async invoke(req: { prompt: string; opts: AgentOpts; runId: string; agentId: string; signal?: AbortSignal; onHarness?: (h: HarnessDescriptor, applied?: EffortApplied) => Promise<void> }): Promise<GatewayResult> {
    const aliasName = req.opts.model ?? 'default';
    const target = this._config.aliases[aliasName];
    if (!target) return { ok: false, provider: 'unknown', reason: 'terminal' };
    // DES-106 (TASK-102): computed ONCE per invoke, inside the gateway — the provider is only
    // resolvable here. The SAME object travels to onHarness AND (below) onto the outbound request.
    const applied = resolveEffortApplied(target.provider, req.opts.effort);
    // DES-066 (TASK-069): emit harness descriptor eagerly at model-resolution time (surfaceType:'none'
    // — direct-fetch has no curated tool surface). The prompt rides UNCUT: the 4KB head+tail cap is
    // applied at the persist site after `redact()` (review §R2 R-G9 — capping first can split a
    // secret across the seam and defeat the value-exact match).
    if (req.onHarness) {
      const descriptor: HarnessDescriptor = {
        ...redactHarness({
          // v26 integration (DES-177, REQ-125, clarification 26): the RESOLVED model id, not the
          // alias name. `stamp()` below already reports `aliasName` as `proxyModel` on the proxied
          // arm — it is the id LiteLLM resolves, i.e. this route's cloak — so the descriptor names
          // the two the same way the result does, and `markHarness` can no longer stamp a cloak
          // (or a bare alias) where the backend model belongs.
          surfaceType: 'none', modelName: target.model, provider: target.provider, prompt: req.prompt,
          // v26 Gate 7.5 round 1 (defect D2): the cloak that is actually on the wire (DES-177:
          // "the proxy-facing model id actually put on the wire"), same value `stamp()` reports.
          ...(this._proxy ? { proxyModel: proxyModelName(aliasName) } : {}),
          curatedTools: [], mergedMcp: [], skills: [],
        }),
        ...(applied !== undefined ? { effortApplied: applied } : {}),
      };
      await req.onHarness(descriptor, applied);
    }

    const fetchImpl = this._config.fetchImpl ?? fetch;
    // issue #24/#22: a per-call AgentOpts.timeoutMs overrides the configured default (both directions).
    const effTimeout = resolveTimeout(req.opts.timeoutMs) ?? this._config.timeoutMs;
    const attempts = 1 + Math.max(0, this._config.retries);
    // v26 (DES-177, TASK-177): this whole class is a `direct-fetch` transport regardless of which
    // branch below fires — a LiteLLM-proxied call is still a raw HTTP fetch, never the SDK. The
    // proxy branch also puts a cloak (`aliasName`, LiteLLM's own resolution target) on the wire,
    // reportable on the ok:true arm only (the type's own convention — see GatewayResult).
    const stamp = (r: GatewayResult): GatewayResult =>
      r.ok && this._proxy ? { ...r, transport: 'direct-fetch', proxyModel: proxyModelName(aliasName) } : { ...r, transport: 'direct-fetch' };
    let last: GatewayResult = { ok: false, provider: target.provider, reason: 'terminal' };
    for (let i = 0; i < attempts; i++) {
      last = stamp(
        this._proxy
          ? await callViaLiteLLMProxy(this._proxy, aliasName, target, req, effTimeout, fetchImpl, req.signal, applied)
          : await callProvider(target, req, effTimeout, fetchImpl, req.signal, applied),
      );
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
