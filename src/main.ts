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
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './server.js';
import type { ServerConfig } from './server.js';
import { ClaudeAgentSdkGatewayClient } from './gateway/claude-agent-sdk-client.js';
import type { ClaudeAgentSdkGatewayConfig } from './gateway/claude-agent-sdk-client.js';
import { LiteLLMProxyManager } from './gateway/litellm-proxy.js';
import { loadSecretSourceFromEnv } from './secret-source.js';
import { assertWorkRootIsolated } from './workroot-guard.js';
import { DEFAULT_ALIASES } from './default-aliases.js';
import { ANALYZER_SCRATCH_SUBDIR } from './graph-analyzer.js';

type GatewayChoice = 'sdk' | 'direct-fetch';

// DEFAULT_ALIASES (src/default-aliases.ts) is the single-source fallback table, used here only to
// give the SDK gateway's managed LiteLLM proxy an alias table to route through when the config file
// omits `aliases` entirely — the same anthropic-only default the rest of the system falls back to.

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
  /** REQ-037: the REAL Anthropic API base the provider-native (LiteLLM-bypassed) path dispatches an
   *  `anthropic`-provider alias to. Omitted -> `https://api.anthropic.com`. */
  anthropicBaseUrl?: string;
  /** REQ-037: Anthropic-direct auth mode — `api-key` (real ANTHROPIC_API_KEY secret) or
   *  `subscription` (CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`). Omitted -> auto by secret
   *  presence. The auth material itself is NEVER read from this JSON file — only from the server-side
   *  secret store (RWE_SECRET_ANTHROPIC_API_KEY / RWE_SECRET_CLAUDE_CODE_OAUTH_TOKEN) or plain env. */
  anthropicAuth?: 'api-key' | 'subscription';
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
  const workRoot = process.env['RWE_WORK_ROOT'] ?? fileConfig.workRoot;
  // D-V3M-5 (REQ-021): fail-closed if the configured workRoot is inside a Claude Code project — a
  // nested run workspace makes the SDK-gateway agent CLI load that project's CLAUDE.md/auto-memory
  // into the agent context (a session-init confinement leak the tool-jail can't catch). Only the
  // explicit workRoot is checked; an omitted one falls through to server.ts's tmpdir default (clean).
  if (workRoot !== undefined) assertWorkRootIsolated(workRoot);

  const config: ServerConfig = {
    bind: process.env['RWE_BIND'] ?? fileConfig.bind ?? '127.0.0.1',
    port: process.env['RWE_PORT'] ? Number(process.env['RWE_PORT']) : (fileConfig.port ?? 8787),
    workRoot,
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
    // TASK-027: forwarded regardless of gateway choice, same convention as agentDefinitionsDir
    // above — the "sdk" branch below consumes it directly when constructing its own
    // LiteLLMProxyManager; a "direct-fetch" caller's own ServerConfig.litellmPort reaches
    // server.ts's LiteLLMGatewayClient construction unchanged.
    litellmPort: fileConfig.litellmPort,
    // Forwarded regardless of gateway choice — the "direct-fetch" path's LiteLLMGatewayClient reads
    // this to decide proxy-vs-direct per-provider fetch. Previously dropped, so `useLiteLLMProxy:false`
    // in the config file had no effect and a dependency-free (e.g. Ollama-only) deploy still spawned litellm.
    useLiteLLMProxy: fileConfig.useLiteLLMProxy,
    // DES-022 (standing rule 1, UT-033): forwarded regardless of gateway choice, same convention —
    // both reach `server.ts`'s own default-path fallbacks (`join(workRoot,'schedules.db')` /
    // `join(workRoot,'assets')`) unchanged when omitted.
    schedulerDbPath: fileConfig.schedulerDbPath,
    // D-V2V-1: default the same way server.ts's own AssetSyncService construction does
    // (`join(workRoot, 'assets')`) — otherwise a zero-config run (no explicit assetRoot key) never
    // forwards asset storage's real on-disk location to the SDK gateway below, silently breaking
    // the REQ-009 wiring for every deployment that doesn't set assetRoot explicitly.
    assetRoot: fileConfig.assetRoot ?? (workRoot ? join(workRoot, 'assets') : undefined),
    // v8 Slice 1 (REQ-041/043): forwarded regardless of gateway choice — RunManager applies its
    // defaults (4 / 256) when omitted and rejects an invalid value at construction (config load).
    maxWorkflowDepth: fileConfig.maxWorkflowDepth,
    maxWorkflowDescendants: fileConfig.maxWorkflowDescendants,
    // v8 Slice 4 (REQ-054): forwarded like the other RunManager caps; RunManager defaults 64 + validates.
    maxConcurrentRuns: fileConfig.maxConcurrentRuns,
    // v13 (REQ-080): forward the seedRef egress allowlist so rwe.config.json can enable engine-pull;
    // absent → RunManager keeps it fail-closed (SEEDREF_DISABLED). Same convention as maxConcurrentRuns.
    seedRefAllowlist: fileConfig.seedRefAllowlist,
    // v11 Sprint 2 (REQ-068..070): forwarded so the self-update webhook + result ingestion are reachable
    // from the PRODUCTION entrypoint (`npm start` / systemd), not only in-process createServer. Without
    // this the POST /github/webhook route stays 503-unconfigured on a real deploy even when the config
    // file sets these — the feature would be built-but-unwired (same class as the D-V3M gauge/inject bugs).
    // REQ-056 ext: extra Host/Origin authorities (LAN IP / proxy hostname) allowed while bound to 0.0.0.0.
    allowedHosts: fileConfig.allowedHosts,
    updateFlagPath: fileConfig.updateFlagPath,
    updateResultPath: fileConfig.updateResultPath,
    selfUpdateDbPath: fileConfig.selfUpdateDbPath,
    // v15 REQ-012/086/087/089: forward auth config so auth routes + enforcement engage on `npm start`
    // (same composition-root wiring pattern as allowedHosts / updateFlagPath above; without this,
    // `auth.enabled:true` in rwe.config.json is parsed by loadFileConfig() but silently dropped
    // here — server.ts keys every auth route registration and D-BIND enforcement off config?.auth?.enabled,
    // so the whole auth subsystem is built-but-unwired at the production entrypoint).
    auth: fileConfig.auth,
    // v16 IMPL-122 / MED-2 (REQ-012): forward workspaceTtlMs so the GC sweep uses the
    // configured interval when `npm start` is used. Without this, fileConfig.workspaceTtlMs
    // is silently dropped here — server.ts defaults _gcTtl to 0, so the sweep timer fires
    // hourly instead of at workspaceTtlMs (the auth-table GC clause still runs, but
    // workspace reclaim is also broken). Same class as the v15 auth-forwarding fix.
    workspaceTtlMs: fileConfig.workspaceTtlMs,
    // v21 (ARCH-066 inv-6, DES-104, TASK-100): forwarded regardless of gateway choice — RunManager/
    // McpFacade apply their own fail-closed defaults (600_000ms / 1024 bytes / 'high') when omitted.
    // Same wiring-gap class as v11 updateFlagPath / v15 auth / v16 workspaceTtlMs.
    maxTimeoutMs: fileConfig.maxTimeoutMs,
    maxAppendPromptBytes: fileConfig.maxAppendPromptBytes,
    maxEffort: fileConfig.maxEffort,
    // v22 (ARCH-071, ADR-014, TASK-107): same composeConfig wiring convention as the three
    // ceilings above — goes into the existing WorkflowCatalogOpts.ceilings object (no new plumbing).
    maxWorkflowVersions: fileConfig.maxWorkflowVersions,
    // Gate 7.5 v21 config-sync check (§4b): same composeConfig wiring-gap class as the four fields
    // above — these four were documented in rwe.config.json/DEPLOY.md but never named in this
    // object literal, so `npm start`/systemd (the real production entrypoint) silently ignored
    // them; server.ts's own defaults (join(workRoot,'cas'|'webhooks.db'|'continuations.db'),
    // 256 MiB) applied instead even when a deployer set them. Only in-process `createServer()`
    // callers (tests) ever saw the configured values.
    maxBlobBytes: fileConfig.maxBlobBytes,
    webhookDbPath: fileConfig.webhookDbPath,
    casDir: fileConfig.casDir,
    continuationDbPath: fileConfig.continuationDbPath,
    // v23 (DES-134, ARCH-085, TASK-122): forwarded as a WHOLE object, unmodified — same
    // composeConfig wiring-gap class as v11 updateFlagPath / v15 auth / v16 workspaceTtlMs / v22
    // maxWorkflowVersions. No defaults applied here: the one site that constructs the GraphAnalyzer
    // (server.ts) is the ONE place each of the nine keys defaults (DES-134) — a second defaulting
    // site here would make "the config's effective value" ambiguous between two call sites.
    graphAnalyzer: fileConfig.graphAnalyzer,
  };

  if (gatewayChoice === 'sdk') {
    // Same managed LiteLLM proxy subprocess the direct-fetch path can opt into (D-R1) — started
    // once here so its baseUrl is known before constructing the SDK session's ANTHROPIC_BASE_URL.
    const proxy = deps.proxyManager ?? new LiteLLMProxyManager(aliases ?? DEFAULT_ALIASES, {
      port: fileConfig.litellmPort,
      // S-2: make supervised restarts of the always-on gateway subprocess observable in the logs
      // (a silent crash+restart of the default gateway would otherwise be invisible).
      onSupervisionEvent: (ev) =>
        console.error(
          ev.kind === 'restart'
            ? `[litellm-proxy] subprocess exited (code ${ev.code}); auto-restarting (restart #${ev.restarts})`
            : `[litellm-proxy] subprocess exited (code ${ev.code}); restart budget exhausted after ${ev.restarts} — gateway is DOWN until restart`,
        ),
    });
    // TASK-027: keep the reference reachable off the returned config (the same field the
    // "direct-fetch" path already threads a caller-supplied proxyManager through) so main()'s own
    // shutdown handler can cascade-kill it — previously this local `proxy` was never retained
    // anywhere once composeConfig() returned, so SIGTERM/SIGINT never reaped it (the repeatedly-
    // Gate-7.5-reproduced orphan-litellm-on-shutdown hazard, for this — the mandated default (D-F4)
    // — gateway path specifically).
    config.proxyManager = proxy;
    const { baseUrl } = await proxy.start();
    // v23 (DES-122, TASK-117): this `cwd` is ONLY ever the fallback for a call that carries no
    // `req.workspace` (every real workflow run's `AgentExecReq.workspace` is non-optional and always
    // set — agent-executor.ts:133/:470) — so in production the sole caller that ever lands on it is
    // the graph analyzer's own `invoke()` (DES-122's request shape has no `workspace` field at all).
    // Repointed to a dedicated scratch subdirectory (created once, here) rather than the whole
    // server workRoot, so an analyzer session's `cwd` is never the same directory a real run's
    // workspace lives under.
    const analyzerScratchCwd = config.workRoot ? join(config.workRoot, ANALYZER_SCRATCH_SUBDIR) : undefined;
    if (analyzerScratchCwd) mkdirSync(analyzerScratchCwd, { recursive: true });
    // D-F10(a): forward aliases/timeoutMs/retries — previously omitted, which silently degraded
    // D-F7's timeout/retry bound to dead code and D-F6's alias-aware thinking policy to "always
    // disabled" in production (Gate 7.5 round 4's real repro).
    config.gateway = new ClaudeAgentSdkGatewayClient({
      baseUrl,
      cwd: analyzerScratchCwd,
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
      // D-V2V-1: the RESOLVED config.assetRoot (carries the same-as-server.ts default fallback
      // above) — read fresh on every invoke() call so a push made after boot still reaches the
      // very next run's mcpServers/skill materialization.
      assetRoot: config.assetRoot,
      // D-V3M-1 (REQ-017, closes ①): the MCP Provisioning Registry DB path — SAME value server.ts
      // builds the registry at (`join(workRoot,'mcp-registry.db')`) so a name provisioned via
      // `mcp_provision` is resolvable by the gateway at session-build time. Undefined workRoot ->
      // no registry-backed MCP injection (matches server.ts's own workRoot-required convention).
      mcpRegistryDbPath: config.workRoot ? join(config.workRoot, 'mcp-registry.db') : undefined,
      // D-V3M-1 (REQ-018): the server-side secret store (RWE_SECRET_* env) that resolves
      // `${secret:NAME}` handles inside a provisioned MCP config — never a real key on any
      // agent-reachable path (the value lives only in the parent process env). REQ-037: the SAME
      // store the Anthropic-direct auth material (RWE_SECRET_ANTHROPIC_API_KEY /
      // RWE_SECRET_CLAUDE_CODE_OAUTH_TOKEN) is resolved from — injected ONLY into the SDK subprocess.
      secretSource: loadSecretSourceFromEnv(),
      // REQ-037: an `anthropic`-provider alias bypasses this managed LiteLLM proxy and dispatches
      // straight to the real Anthropic API with real auth (no tool-schema translation for Claude).
      anthropicBaseUrl: fileConfig.anthropicBaseUrl,
      anthropicAuth: fileConfig.anthropicAuth,
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
      // TASK-027: cascade-kill the managed LiteLLM proxy subprocess (process-group signal, see
      // LiteLLMProxyManager.stop()) as part of the same graceful shutdown — previously nothing
      // ever called stop() on it here, so it outlived this process (the repeatedly-Gate-7.5-
      // reproduced orphan-litellm-on-shutdown hazard). No-op when `gateway:"direct-fetch"` (no
      // proxy was created by composeConfig() in that branch).
      .then(() => config.proxyManager?.stop())
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
