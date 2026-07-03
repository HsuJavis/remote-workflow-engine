// Product entrypoint / composition root (Gate 7.5 finding, retro L-003): before this file existed,
// createServer() was only ever invoked in-process by vitest test files — there was no documented,
// standalone way to launch the MCP server as a real long-running process. This is the "delivery
// interface" the product's real users (an MCP client, or `curl`) actually connect to.
//
// Config precedence (low -> high): built-in defaults < RWE_CONFIG_PATH JSON file < env vars.
// Provider API keys are NEVER read from the config file (src/gateway/client.ts reads them
// straight from process.env: ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / OLLAMA_BASE_URL)
// so the JSON config file never holds secrets and is safe to commit an .example of.
//
// D-F4: gateway selection. Production default ("sdk", the config opt-out key's default value) wires
// a real ClaudeAgentSdkGatewayClient (D-F1) as ServerConfig.gateway — the tool-loop-capable path
// REQ-003 and the product core promise require (user decision D1, twice confirmed; direct-fetch
// REJECTED as the default). The proxy this SDK session's ANTHROPIC_BASE_URL points at is the same
// managed LiteLLM proxy subprocess LiteLLMGatewayClient itself uses (src/gateway/litellm-proxy.ts),
// keyed off the same `aliases` table so there is one alias->provider/model source of truth either
// way. Setting `gateway: "direct-fetch"` in the config file opts back out to the pre-D-F1 path
// (LiteLLMGatewayClient's own per-provider fetch / its own useLiteLLMProxy toggle), unchanged.
// This entrypoint is the ONLY place that decides between the two — server.ts's own default (an
// undefined `config.gateway` falling through to LiteLLMGatewayClient) stays exactly as it was for
// every test caller, none of which sets RWE_CONFIG_PATH/goes through main().
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from './server.js';
import type { ServerConfig } from './server.js';
import { ClaudeAgentSdkGatewayClient } from './gateway/claude-agent-sdk-client.js';
import type { ClaudeAgentSdkGatewayConfig } from './gateway/claude-agent-sdk-client.js';
import { LiteLLMProxyManager } from './gateway/litellm-proxy.js';
import type { AliasMap } from './gateway/client.js';

type GatewayChoice = 'sdk' | 'direct-fetch';

// Same shape as run-manager.ts's/submission-validator.ts's own DEFAULT_ALIASES fallback (this
// entrypoint doesn't import those private consts — matches the codebase's existing per-module
// duplication pattern rather than introducing a new shared-export abstraction for one caller).
// Used only to give the SDK gateway's managed LiteLLM proxy an alias table to route through when
// the config file omits `aliases` entirely — the same anthropic-only default the rest of the
// system already falls back to in that case.
const DEFAULT_ALIASES: AliasMap = {
  sonnet: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  haiku: { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
  opus: { provider: 'anthropic', model: 'claude-opus-4-5' },
  default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
};

// Omit ServerConfig's own `gateway` field (typed GatewayClient — an object seam, D-F1): the config
// FILE's `gateway` key is a plain string choice this entrypoint resolves into that object itself.
interface FileConfig extends Partial<Omit<ServerConfig, 'gateway'>> {
  /** D-F4: which GatewayClient main.ts wires up. Default "sdk" (ClaudeAgentSdkGatewayClient, the
   *  real tool-loop-capable path). "direct-fetch" opts out to the legacy LiteLLMGatewayClient path
   *  (server.ts's own pre-existing default, driven by `aliases`/`useLiteLLMProxy`). */
  gateway?: GatewayChoice;
  /** D-F11: the configurable default core tool set (e.g. `["Read","Write","Bash"]`) forwarded to
   *  ClaudeAgentSdkGatewayConfig.defaultAllowedTools — applied to every call that doesn't carry its
   *  own agentType-derived opts.allowedTools. Only meaningful when `gateway` is "sdk" (the
   *  default); has no effect on the "direct-fetch" path. Omitted -> ClaudeAgentSdkGatewayClient's
   *  own built-in minimal core set applies (never an uncurated full tool surface). */
  defaultAllowedTools?: string[];
}

function loadFileConfig(): FileConfig {
  const path = process.env['RWE_CONFIG_PATH'] ?? 'rwe.config.json';
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as FileConfig;
  } catch (err) {
    throw new Error(`RWE_CONFIG_PATH "${path}" is not valid JSON: ${(err as Error).message}`);
  }
}

// D-F10(a): test seam for composeConfig — mirrors this codebase's existing injectable-seam
// convention (ServerConfig.proxyManager, ClaudeAgentSdkGatewayConfig.queryImpl). No FileConfig
// field can carry a function value (FileConfig is JSON-parsed), so this is a separate parameter.
// main()'s own real call site simply omits it.
interface ComposeConfigDeps {
  queryImpl?: ClaudeAgentSdkGatewayConfig['queryImpl'];
  proxyManager?: LiteLLMProxyManager;
}

// D-F10(a/b): the FileConfig -> ServerConfig translation main() performs, extracted into an
// exported, independently testable composition helper (IT-021/IT-022's own documented contract) —
// this is what makes a wiring gap here catchable by a unit/integration-tier test that boots the
// way main.ts itself does, not only by a real-run validation round (ORCH D-F10 structural rule).
export async function composeConfig(fileConfig: FileConfig, deps: ComposeConfigDeps = {}): Promise<ServerConfig> {
  const gatewayChoice: GatewayChoice = fileConfig.gateway ?? 'sdk';
  const aliases = fileConfig.aliases;

  const config: ServerConfig = {
    bind: process.env['RWE_BIND'] ?? fileConfig.bind ?? '127.0.0.1',
    port: process.env['RWE_PORT'] ? Number(process.env['RWE_PORT']) : (fileConfig.port ?? 8787),
    workRoot: process.env['RWE_WORK_ROOT'] ?? fileConfig.workRoot,
    aliases,
    // D-G8-4: same hardcoded fallback the legacy LiteLLMGatewayClient path already gets
    // (server.ts's own `config?.timeoutMs ?? 15000`) — without it, the zero-config ("just run it",
    // no rwe.config.json present) default SDK gateway path had no bound of its own at all, so a
    // dead/hung local provider hung the whole run (RunGuard's concurrency slot stays held)
    // indefinitely, contradicting decision D-G (user-reconfirmed 2026-07-03).
    timeoutMs: fileConfig.timeoutMs ?? 15000,
    retries: fileConfig.retries,
    // D-F10(b): forwarded regardless of gateway choice — the agentType composition-root loader
    // (D-F2) is independent of which GatewayClient the run ends up dispatching through.
    agentDefinitionsDir: fileConfig.agentDefinitionsDir,
  };

  if (gatewayChoice === 'sdk') {
    // Same managed LiteLLM proxy subprocess the direct-fetch path can opt into (D-R1) — started
    // once here so its baseUrl is known before constructing the SDK session's ANTHROPIC_BASE_URL.
    const proxy = deps.proxyManager ?? new LiteLLMProxyManager(aliases ?? DEFAULT_ALIASES);
    const { baseUrl } = await proxy.start();
    // D-F10(a): forward aliases/timeoutMs/retries — previously omitted, which silently degraded
    // D-F7's timeout/retry bound to dead code and D-F6's alias-aware thinking policy to "always
    // disabled" in production (Gate 7.5 round 4's real repro).
    config.gateway = new ClaudeAgentSdkGatewayClient({
      baseUrl,
      cwd: config.workRoot,
      queryImpl: deps.queryImpl,
      aliases,
      // D-G8-4: use the RESOLVED config.timeoutMs (which carries the hardcoded 15000 fallback
      // above), not the raw fileConfig.timeoutMs — the latter is undefined in the exact zero-config
      // shape this fallback exists for, which silently dropped the fallback on this specific
      // construction site even after it was added to `config` above.
      timeoutMs: config.timeoutMs,
      retries: fileConfig.retries,
      // D-F11: forwarded so a configured core tool set actually reaches the constructed client —
      // same composition-root-forwarding convention as aliases/timeoutMs/retries above.
      defaultAllowedTools: fileConfig.defaultAllowedTools,
    });
  }

  return config;
}

async function main(): Promise<void> {
  const config = await composeConfig(loadFileConfig());
  const server = await createServer(config);
  // eslint-disable-next-line no-console
  console.log(
    `[remote-workflow-engine] listening on http://${config.bind}:${server.port}/mcp (workRoot=${server.workRoot})`,
  );
  // Healthcheck-friendly startup line other tooling can grep for.
  console.log('[remote-workflow-engine] ready');

  const shutdown = (signal: string): void => {
    console.log(`[remote-workflow-engine] received ${signal}, shutting down...`);
    server
      .close()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        console.error('[remote-workflow-engine] error during shutdown:', err);
        process.exit(1);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// D-F10(a) import-guard: only auto-run main() when this file is the real process entry point
// (`node src/main.js`), not merely imported (e.g. to reach the composeConfig export from a test —
// IT-021/IT-022's own documented rationale: "a composition helper is pointless if importing the
// module always re-runs the whole program"). process.argv[1] is undefined for some non-CLI hosts
// (e.g. certain test runners), in which case this intentionally stays inert rather than guessing.
const isEntryPoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error('[remote-workflow-engine] fatal startup error:', err);
    process.exit(1);
  });
}
