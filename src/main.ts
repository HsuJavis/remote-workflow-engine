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
import { readFileSync, existsSync, realpathSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from './server.js';
import type { ServerConfig } from './server.js';
import { ClaudeAgentSdkGatewayClient } from './gateway/claude-agent-sdk-client.js';
import type { ClaudeAgentSdkGatewayConfig } from './gateway/claude-agent-sdk-client.js';
import { validateHostPathGrants, formatGrantRefusals } from './gateway/bash-confinement.js';
import { probeConfinement } from './gateway/confinement-probe.js';
import type { ConfinementProbeResult } from './gateway/confinement-probe.js';
import { LiteLLMProxyManager } from './gateway/litellm-proxy.js';
import { loadSecretSourceFromEnv } from './secret-source.js';
import { assertWorkRootIsolated } from './workroot-guard.js';
import { DEFAULT_ALIASES } from './default-aliases.js';
import type { Role } from './tool-specs.js';
import { validateAliases } from './providers.js';

type GatewayChoice = 'sdk' | 'direct-fetch';

function isNonEmptyString(s: string | undefined): s is string {
  return typeof s === 'string' && s.length > 0;
}

// DEFAULT_ALIASES (src/default-aliases.ts) is the single-source fallback table, used here only to
// give the SDK gateway's managed LiteLLM proxy an alias table to route through when the config file
// omits `aliases` entirely — the same anthropic-only default the rest of the system falls back to.

// Omit ServerConfig's own `gateway` field (typed GatewayClient — an object seam, D-F1): the config
// FILE's `gateway` key is a plain string choice this entrypoint resolves into that object itself.
// v25 (REQ-119, DES-166): `diagramRender` is omitted for the same reason as `gateway` — its one
// meaningful field is a FUNCTION (the injected renderer), which a JSON config file cannot express.
// Its two numeric knobs are engine constants on purpose (`diagram-render.ts`), so there is nothing
// here for composeConfig to forward and therefore nothing it can forget to forward.
interface FileConfig extends Partial<Omit<ServerConfig, 'gateway' | 'principals' | 'diagramRender' | 'confinementPosture'>> {
  /** D-F4: which GatewayClient main.ts wires up. Default "sdk" (ClaudeAgentSdkGatewayClient, the
   *  real tool-loop-capable path). "direct-fetch" opts out to the legacy LiteLLMGatewayClient path
   *  (server.ts's own pre-existing default, driven by `aliases`/`useLiteLLMProxy`). */
  gateway?: GatewayChoice;
  /** v24 (ARCH-090, DES-141): raw role map, as it appears in rwe.config.json — `normalizePrincipals`
   *  validates each `role` string into `ServerConfig.principals`'s `Role` union (boot REFUSES on a
   *  typo, per ADR-028 — never a silent 'user' default for a value that was clearly meant to be
   *  something else). `"*"` is a legal key (the catch-all principal). */
  principals?: Record<string, { role: string }>;
  /** D-F11: the configurable default core tool set (e.g. `["Read","Write","Bash"]`) forwarded to
   *  ClaudeAgentSdkGatewayConfig.defaultAllowedTools — applied to every call that doesn't carry its
   *  own per-call opts.allowedTools. Only meaningful when `gateway` is "sdk" (the default); has no
   *  effect on the "direct-fetch" path. Omitted -> ClaudeAgentSdkGatewayClient's own built-in
   *  minimal core set applies (never an uncurated full tool surface). */
  defaultAllowedTools?: string[];
  /** REQ-037: the REAL Anthropic API base the provider-native (LiteLLM-bypassed) path dispatches an
   *  `anthropic`-provider alias to. Omitted -> `https://api.anthropic.com`. */
  anthropicBaseUrl?: string;
  /** REQ-037: Anthropic-direct auth mode — `api-key` (real ANTHROPIC_API_KEY secret) or
   *  `subscription` (CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`). Omitted -> auto by secret
   *  presence. The auth material itself is NEVER read from this JSON file — only from the server-side
   *  secret store (RWE_SECRET_ANTHROPIC_API_KEY / RWE_SECRET_CLAUDE_CODE_OAUTH_TOKEN) or plain env. */
  anthropicAuth?: 'api-key' | 'subscription';
  /** v37 (ARCH-177, DES-254, ADR-084): operator-granted host paths a run's Bash may ALSO write/read,
   *  beyond its own run workspace — validated (`validateHostPathGrants`) and refused at boot (naming
   *  every offending entry) rather than silently admitted or silently dropped. Absent -> `[]`, the
   *  strictest posture. The OPERATOR grants; there is no author-side request surface this iteration
   *  (ADR-084's deferred (C) — the operator and the author are the same person today). */
  sandbox?: { allowHostPaths?: string[] };
}

// v24 (ARCH-090, DES-141, standing rule 1 — same "twice-bitten composeConfig bug class" convention
// as compose-config-v2-wiring.test.ts itself): every FileConfig key must appear here. The
// `Record<keyof FileConfig, true>` form makes the compiler refuse a missing key, so this list
// cannot silently rot as FileConfig grows — a config key composeConfig() forgets to forward is
// caught by the wiring test, and a key an operator TYPOS (or a retired key like `graphAnalyzer`
// they never removed) is caught here, at boot, instead of silently doing nothing either way.
// v26 Gate 7.5 round 1 (defect D7): EXPORTED so the wiring test can sweep this list mechanically —
// every entry must be probed (a value in, the same value out of composeConfig) or excluded with a
// stated reason. Three misses (v11 `updateFlagPath`, v15 `auth`, v26 `agentSlots`) were each found
// by a real run instead of by a test; a hand-written case per key is what let the fourth hide.
export const KNOWN_FILE_CONFIG_KEYS: Record<keyof FileConfig, true> = {
  bind: true, port: true, allowedHosts: true, workRoot: true, aliases: true, timeoutMs: true,
  retries: true, useLiteLLMProxy: true, proxyManager: true, litellmPort: true,
  gateway: true, issueReporter: true, mcpProbe: true,
  schedulerDbPath: true, assetRoot: true, agentSlots: true, runConcurrency: true, workspaceTtlMs: true,
  modelCatalogFetchers: true, modelCatalog: true, maxWorkflowDepth: true,
  maxWorkflowDescendants: true, maxConcurrentRuns: true, seedRefAllowlist: true,
  continuationDbPath: true, casDir: true, maxBlobBytes: true, webhookDbPath: true,
  updateFlagPath: true, updateResultPath: true, selfUpdateDbPath: true, systemInfo: true,
  auth: true, maxTimeoutMs: true, maxAppendPromptBytes: true, maxEffort: true,
  maxWorkflowVersions: true, principals: true, mcpEgressAllowlist: true,
  defaultAllowedTools: true, anthropicBaseUrl: true, anthropicAuth: true,
  sandbox: true,
};

// v34 (DES-227, ARCH-139, TASK-229, REQ-203): keys that USED to be forwarded by composeConfig and
// no longer are — an operator's stale `rwe.config.json` entry gets a retirement note instead of
// the plain "unrecognized" treatment a typo gets. Cannot be compile-pinned the way
// `KNOWN_FILE_CONFIG_KEYS` is (a retired key is by definition not `keyof FileConfig` any more); the
// one contradiction worth guarding is that no key appears in both maps (see the wiring UT).
export const RETIRED_CONFIG_KEYS: Record<string, string> = {
  graphAnalyzer: 'at v24 (ADR-025) — diagrams are author-drawn `mermaid` supplied to `workflow_register`; no replacement, remove the key',
  agentDefinitionsDir: 'at v34 — the server-side agentType mechanism is gone; see workflow_authoring_guide → prompt layering',
};

/** v24 (ARCH-090, DES-141): validates a raw `FileConfig.principals` role map into
 *  `ServerConfig.principals`'s typed shape. NEVER throws — an invalid role is reported back
 *  (`{ok:false, key, role}`) so the caller (composeConfig) can refuse to boot (ADR-028: a typo like
 *  "admn" must not silently become "user"). Keys (including `"*"`) are stored verbatim — no
 *  normalization/lowercasing. */
/** v37 P1 (ADR-086's third owner ruling, 2026-09-25) — the boot banner, EXTRACTED so it can be
 *  pinned by a test. It was inline `console.log` text before, and that is precisely why it went on
 *  promising "local (loopback) runs still proceed" for a full round after admission gained its
 *  second source: a string no test reads cannot go red. Gate 8 round 4 (finding F1) caught it in
 *  this iteration's OWN evidence log. The rule this line must mirror: on an unconfined host a run is
 *  refused when it is a remote submission, OR its trigger was created remotely, OR the version it
 *  resolves to was registered remotely. Change the rule ⇒ change this line.
 *  **[更正 2026-09-25, Gate 8 round-5 finding R5-F6]** ~~`confinement-banner-truth.test.ts` fails if
 *  the two drift apart~~ overstated what one test can do. That file locks the WORDING (it fails if
 *  this text drops a source or re-adds the false promise) and, separately, COUNTS
 *  `admissionRefusal()`'s call sites in `run-manager.ts` so that deleting a refusal also fails it.
 *  Neither half alone would have caught round 4's drift; the count is deliberately coarse, and its
 *  job is to force whoever changes the admission surface back to this line. */
export function confinementBannerLine(probe: { posture: 'confined' | 'unconfined'; reason?: string }): string {
  if (probe.posture === 'confined') {
    return '[remote-workflow-engine] Bash confinement: CONFINED (nested-userns probe passed at boot)';
  }
  return (
    `[remote-workflow-engine] Bash confinement: UNCONFINED (${probe.reason ?? 'nested-userns probe failed'})` +
    ' — a run is refused (CONFINEMENT_UNAVAILABLE) when it is a remote submission, OR its trigger was created remotely,' +
    ' OR the version it resolves to was registered remotely; only a local submission of a locally-registered version' +
    ' proceeds, unconfined'
  );
}

export function normalizePrincipals(
  raw: Record<string, { role: string }> | undefined,
): { ok: true; value: Record<string, { role: Role }> } | { ok: false; key: string; role: string } {
  const VALID_ROLES: readonly string[] = ['admin', 'author', 'user'];
  const value: Record<string, { role: Role }> = {};
  for (const [key, entry] of Object.entries(raw ?? {})) {
    if (!VALID_ROLES.includes(entry.role)) return { ok: false, key, role: entry.role };
    value[key] = { role: entry.role as Role };
  }
  return { ok: true, value };
}

// v37 (DES-255, ARCH-177, TASK-252): returns the path this function actually read too — the value
// `composeConfig()`'s `protectedFiles[0]` must use (never a SECOND `resolve()` inside composeConfig,
// which would resolve against whatever cwd systemd happened to hand the process and could name a
// file that does not exist while the real config stays readable). `undefined` when no file exists on
// disk — never a literal `'undefined'` reaching a deny list (bash-confinement.ts's own filter).
export function loadFileConfig(): { config: FileConfig; path?: string } {
  const raw = process.env['RWE_CONFIG_PATH'] ?? 'rwe.config.json';
  const path = resolve(raw);
  if (!existsSync(path)) return { config: {} };
  try {
    return { config: JSON.parse(readFileSync(path, 'utf8')) as FileConfig, path };
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
  /** v26 (DES-172, ARCH-112, TASK-172, REQ-123/070): `--check-config` passes `false` to validate
   *  config values (aliases, principals, workRoot isolation, ...) WITHOUT spawning the managed
   *  litellm proxy subprocess — composeConfig() skips calling `proxy.start()` entirely rather than
   *  relying on the caller's proxyManager alone to be a well-behaved no-op. Omitted/`true` ->
   *  unchanged real-boot behavior. */
  listen?: boolean;
  /** v37 (DES-255, ARCH-177): the absolute path `loadFileConfig()` actually read (`undefined` when
   *  no config file exists) — rides deps rather than `FileConfig` (same seam convention) so it needs
   *  no `KNOWN_FILE_CONFIG_KEYS` row. Omitted (every existing test call site) -> `protectedFiles` is
   *  just the auth DB, same as "no config file on disk". */
  configPath?: string;
  /** v37 (ARCH-181, DES-261/262, TASK-257, REQ-218, ADR-083 owner_decision posture C): the ALREADY-
   *  RESOLVED result of `probeConfinement()` — a pre-computed VALUE, never a callable composeConfig
   *  invokes itself (the real probe spawns a subprocess; several test files in this suite globally
   *  `vi.mock('node:child_process', ...)`, which would silently null out an internal `spawnSync`
   *  import — importing the pure VALUE here instead means this file never needs to know how the
   *  probe was obtained). Omitted (every existing test call site + this file's own default) ->
   *  `confinementPosture` is left UNSET on both `ServerConfig` and the constructed gateway's own
   *  config, and each falls back to ITS OWN default independently (ServerConfig: unset — no door
   *  gating; `ClaudeAgentSdkGatewayConfig`: **'unconfined'**, found empirically — an earlier
   *  'confined' default broke the real-CLI-spawning suite, per that field's own doc comment) — a
   *  caller that never asked the boot-time nested-userns question gets the fail-open answer, not a
   *  claimed confinement it never measured. `main()`'s real call site is the ONLY caller that sets
   *  this, from a real `probeConfinement()` call before `composeConfig()`. */
  confinementProbe?: ConfinementProbeResult;
  /** v37 Gate-8 send-back (finding A2, ARCH-177 amendment): a PRE-COMPUTED workRoot value — never a
   *  callable `composeConfig()` invokes itself (several test files in this suite globally
   *  `vi.mock('node:fs')`, which would silently null out an internal `mkdtempSync` call — the same
   *  value-not-callable seam `configPath`/`confinementProbe` already use). `main()`'s real boot path
   *  computes this with ONE `mkdtempSync(join(tmpdir(), 'rwe-'))` before calling `composeConfig()`;
   *  `--check-config` passes a clearly-labelled NON-created placeholder (that command's own "no side
   *  effects" contract — an operator with grants but no `workRoot` is already refused above, before
   *  this placeholder can reach grant validation). Used ONLY when `fileConfig.workRoot` (and
   *  `RWE_WORK_ROOT`) are both unset, so `protectedFiles`/`denyRead` never depend on `workRoot`
   *  having been EXPLICITLY set in config (INV-V37-4). Omitted (every existing test call site) ->
   *  unchanged pre-v37 behaviour: `workRoot` stays `undefined` when the config doesn't set one. */
  workRootDefault?: string;
}

// D-F10(a/b): the FileConfig -> ServerConfig translation main() performs, extracted into an
// exported, independently testable composition helper (IT-021/IT-022's own documented contract) —
// this is what makes a wiring gap here catchable by a unit/integration-tier test that boots the
// way main.ts itself does, not only by a real-run validation round (ORCH D-F10 structural rule).
export async function composeConfig(fileConfig: FileConfig, deps: ComposeConfigDeps = {}): Promise<ServerConfig> {
  // v24 (ARCH-090, DES-141) / v34 (DES-227, ARCH-139, TASK-229, REQ-203): an unrecognized top-level
  // key — a typo, or a key that USED to be forwarded and was retired (`graphAnalyzer`,
  // `agentDefinitionsDir`) — gets ONE visible warning naming all of them, with a retirement note
  // inline next to each RETIRED key only (a typo never had a mechanism to retire, so it gets none).
  // No fail-fast either way: the engine still boots.
  const unknownKeys = Object.keys(fileConfig).filter((k) => !(k in KNOWN_FILE_CONFIG_KEYS));
  if (unknownKeys.length > 0) {
    const named = unknownKeys.map((k) => {
      const note = RETIRED_CONFIG_KEYS[k];
      return note !== undefined ? `${k} (retired ${note})` : k;
    });
    // eslint-disable-next-line no-console
    console.warn(`[remote-workflow-engine] unrecognized config key(s) in rwe.config.json, ignored: ${named.join(', ')}.`);
  }

  // v24 (ARCH-090, DES-141, ADR-028): boot REFUSES on a malformed role — never a silent 'user'.
  const principalsResult = fileConfig.principals !== undefined ? normalizePrincipals(fileConfig.principals) : undefined;
  if (principalsResult && !principalsResult.ok) {
    throw new Error(
      `rwe.config.json's principals["${principalsResult.key}"].role is "${principalsResult.role}", which is not a valid role ` +
        '(must be one of admin/author/user). Refusing to start (ADR-028 fail-closed: a typo must never silently resolve to a role).',
    );
  }

  const gatewayChoice: GatewayChoice = fileConfig.gateway ?? 'sdk';
  const aliases = fileConfig.aliases;
  // v26 (DES-172, ARCH-112, TASK-171/172, REQ-123): REFUSE boot when any alias names a retired/
  // unsupported provider (e.g. `openai`, `gemini`) — enumerates EVERY offending row, the deliberate
  // opposite of a first-offender rule (DES-170's validateSeedSpec): the consumer here is a human
  // editing several bad rows at once during a release. Also what `--check-config` (below) exists to
  // catch before a restart, without booting anything else.
  if (aliases !== undefined) {
    const aliasCheck = validateAliases(aliases);
    if (!aliasCheck.ok) {
      const byProvider = new Map<string, string[]>();
      for (const offender of aliasCheck.offenders) {
        const names = byProvider.get(offender.provider) ?? [];
        names.push(offender.alias);
        byProvider.set(offender.provider, names);
      }
      const parts = [...byProvider.entries()].map(
        ([provider, names]) => `unsupported provider '${provider}' on aliases ${names.join(', ')}`,
      );
      throw new Error(
        `rwe.config.json: ${parts.join('; ')} — remove these rows. Allowed providers: ${aliasCheck.allowed.join(', ')}.`,
      );
    }
  }
  const explicitWorkRoot = process.env['RWE_WORK_ROOT'] ?? fileConfig.workRoot;
  // D-V3M-5 (REQ-021): fail-closed if the configured workRoot is inside a Claude Code project — a
  // nested run workspace makes the SDK-gateway agent CLI load that project's CLAUDE.md/auto-memory
  // into the agent context (a session-init confinement leak the tool-jail can't catch). Only the
  // explicit workRoot is checked; an omitted one falls through to `deps.workRootDefault`/server.ts's
  // own tmpdir default (clean — a freshly `mkdtemp`'d directory is never inside a project).
  if (explicitWorkRoot !== undefined) assertWorkRootIsolated(explicitWorkRoot);
  // v37 Gate-8 send-back (finding A2, ARCH-177 amendment): the RESOLVED workRoot — falls back to
  // `deps.workRootDefault` (a pre-computed value; `main()`'s real boot path always supplies one)
  // when the operator set none, so `protectedFiles`/`denyRead` below can NEVER depend on `workRoot`
  // having been explicitly set (INV-V37-4). `ServerConfig.workRoot` (below) carries this SAME
  // resolved value — one resolution, one value, both consumers (server.ts:655's own `??` fallback
  // stays, for every direct `createServer()` test caller that never goes through `composeConfig()`).
  const workRoot = explicitWorkRoot ?? deps.workRootDefault;

  // v37 (ARCH-177, DES-254/255, TASK-252, REQ-218) / v37 Gate-8 send-back (finding A3, ARCH-175
  // amendment): protectedFiles are every REQ-218 risk-surface path — the config file the loader
  // actually read (never a second resolve() against whatever cwd systemd handed the process —
  // DES-255), this workRoot's auth-tokens.db, and every OPERATOR-OVERRIDABLE engine path
  // (casDir/assetRoot/webhookDbPath/schedulerDbPath/selfUpdateDbPath/continuationDbPath), resolved
  // here exactly as server.ts's own per-field default resolves them — never re-derived from a key
  // name inside bash-confinement.ts, which stays pure (INV-V37-4). `continuationDbPath` rides along
  // "for as long as the key exists" (ARCH-175's own phrasing — the module it would point at is a
  // phantom, filed for v38, not fixed here). Grant validation runs only when the operator actually
  // asked for a shared path — an absent/empty `sandbox.allowHostPaths` needs no `workRoot` anchor
  // and stays the strictest posture (`[]`).
  const resolvedAssetRoot = fileConfig.assetRoot ?? (workRoot ? join(workRoot, 'assets') : undefined);
  const resolvedCasDir = fileConfig.casDir ?? (workRoot ? join(workRoot, 'cas') : undefined);
  const resolvedWebhookDbPath = fileConfig.webhookDbPath ?? (workRoot ? join(workRoot, 'webhooks.db') : undefined);
  const resolvedSchedulerDbPath = fileConfig.schedulerDbPath ?? (workRoot ? join(workRoot, 'schedules.db') : undefined);
  const resolvedSelfUpdateDbPath = fileConfig.selfUpdateDbPath ?? (workRoot ? join(workRoot, 'self-update.db') : undefined);
  const resolvedContinuationDbPath = fileConfig.continuationDbPath ?? (workRoot ? join(workRoot, 'continuations.db') : undefined);
  const protectedFiles = [
    deps.configPath,
    workRoot ? join(workRoot, 'auth-tokens.db') : undefined,
    resolvedCasDir, resolvedAssetRoot, resolvedWebhookDbPath, resolvedSchedulerDbPath,
    resolvedSelfUpdateDbPath, resolvedContinuationDbPath,
  ].filter(isNonEmptyString);
  const rawGrants = fileConfig.sandbox?.allowHostPaths ?? [];
  let resolvedGrants: string[] = [];
  if (rawGrants.length > 0) {
    if (explicitWorkRoot === undefined) {
      throw new Error('rwe.config.json: sandbox.allowHostPaths requires workRoot to be set (a grant is validated against workRoot containment) — set workRoot, or remove the grant.');
    }
    const grantResult = validateHostPathGrants(rawGrants, { workRoot: explicitWorkRoot, protectedFiles }, realpathSync);
    if (!grantResult.ok) {
      throw new Error(`rwe.config.json: invalid sandbox.allowHostPaths entries — refusing to start (ADR-028 fail-closed):\n${formatGrantRefusals(grantResult.refusals)}`);
    }
    resolvedGrants = grantResult.resolved;
  }

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
    // TASK-027: forwarded regardless of gateway choice — the "sdk" branch below consumes it
    // directly when constructing its own
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
    assetRoot: resolvedAssetRoot,
    // v8 Slice 1 (REQ-041/043): forwarded regardless of gateway choice — RunManager applies its
    // defaults (4 / 256) when omitted and rejects an invalid value at construction (config load).
    maxWorkflowDepth: fileConfig.maxWorkflowDepth,
    maxWorkflowDescendants: fileConfig.maxWorkflowDescendants,
    // v8 Slice 4 (REQ-054): forwarded like the other RunManager caps; RunManager defaults 64 + validates.
    maxConcurrentRuns: fileConfig.maxConcurrentRuns,
    // v25 (DES-168, REQ-120): per-run in-flight agent() cap (default 24 in RunManager). Forwarded
    // here or it silently no-ops — the twice-bitten composeConfig bug class (ARCH-090, standing
    // rule 1); the wiring UT carries a row for it.
    runConcurrency: fileConfig.runConcurrency,
    // v26 Gate 7.5 round 1 (defect D7): the HOST-wide agent-slot ceiling (`createServer` reads
    // `config?.agentSlots ?? 32`). Declared, documented and never forwarded — the THIRD instance of
    // the bug class the two lines above name, found by a real boot reporting `agentSemaphore.total
    // 32` under `"agentSlots": 7`. UT-219 now sweeps the whole key list instead of trusting that
    // each new key remembered to add its own case.
    agentSlots: fileConfig.agentSlots,
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
    // v24 (ARCH-090, DES-141, TASK-146): forwarded IN THE SAME CHANGE (DES-141's own instruction —
    // the v11/v15 wiring-gap bug class this file exists to catch). `principalsResult` is already
    // validated above (boot refuses before reaching here on a malformed role).
    principals: principalsResult?.value,
    // v24 (ARCH-102, DES-153, TASK-146): the https-only allowlist gating asset_push({kind:'mcp'})'s
    // `http` transport — same forwarding convention, no validation needed here (an empty/absent
    // allowlist just means no `http` MCP config is ever admitted).
    mcpEgressAllowlist: fileConfig.mcpEgressAllowlist,
    // v37 (ARCH-181, DES-262, TASK-257, REQ-218): MEASURED, never declared — set only when the
    // caller actually supplied a probe result (deps.confinementProbe, `main()`'s real boot path).
    // Every existing test call site omits it, so `confinementPosture` stays unset here exactly as
    // it did before this field existed — no test anywhere newly gates on a posture it never asked
    // about.
    ...(deps.confinementProbe ? { confinementPosture: deps.confinementProbe.posture } : {}),
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
    // v26 (DES-172, TASK-172): `deps.listen === false` (only `--check-config` sets this) skips
    // `proxy.start()` entirely — no subprocess spawn, no port bind — belt-and-suspenders alongside
    // the caller's own NOOP proxyManager, since `--check-config` never uses `baseUrl` for anything
    // (it never reaches createServer()).
    const baseUrl = deps.listen === false ? '' : (await proxy.start()).baseUrl;
    // v24 (TASK-139, DES-159): the analyzer scratch `cwd` fallback is gone with the GraphAnalyzer
    // that was its sole production caller (`req.workspace` is non-optional on every real workflow
    // run) — no replacement wiring here, `cwd` is simply omitted (falls back to the gateway's own
    // `req.workspace ?? undefined`).
    // D-F10(a): forward aliases/timeoutMs/retries — previously omitted, which silently degraded
    // D-F7's timeout/retry bound to dead code and D-F6's alias-aware thinking policy to "always
    // disabled" in production (Gate 7.5 round 4's real repro).
    config.gateway = new ClaudeAgentSdkGatewayClient({
      baseUrl,
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
      // v24 (TASK-139, DES-154): the MCP Provisioning Registry is deleted — `resolveMcp` is the
      // injected port that replaces it, bound to the catalog by TASK-145. Left UNBOUND here (no
      // replacement wiring in this task): omitted -> no registry-backed MCP injection.
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
      // v37 (ARCH-177, DES-253, TASK-252) / v37 Gate-8 send-back (finding A2): the grant/protected/
      // workRoot block `buildBashConfinement()` consumes, forwarded UNCONDITIONALLY — the old
      // `workRoot ? {...} : {}` guard is deleted, because `workRoot` above is now resolved to a real
      // value (via `deps.workRootDefault`) before any consumer reads it on `main()`'s real boot
      // path; a test caller that omits `deps.workRootDefault` still compiles and behaves unchanged
      // (`confinement.workRoot` is simply `undefined`, exactly as every reader of it already treats
      // via `?.`/`??` — see `claude-agent-sdk-client.ts`'s own note on that field). `resolvedGrants`/
      // `protectedFiles` are already validated above.
      confinement: { allowHostPaths: resolvedGrants, protectedFiles, workRoot },
      // v37 (ARCH-181, DES-262): MEASURED posture, independent of the grant block above — set only
      // when the caller supplied a probe result (`main()`'s real boot path); every existing test call
      // site omits it, so the gateway falls back to its OWN 'unconfined' default unchanged
      // (found empirically — an earlier 'confined' default broke the real-CLI-spawning suite;
      // see `claude-agent-sdk-client.ts`'s own note on that field).
      ...(deps.confinementProbe ? { confinementPosture: deps.confinementProbe.posture } : {}),
    });
  }

  return config;
}

// v26 (DES-172, ARCH-112, TASK-172, REQ-123/070, issue #66): `--check-config` — validate
// rwe.config.json (closed-provider aliases, principals roles, workRoot isolation, ...) via the
// SAME composeConfig() translation a real boot uses, but with NO side effects: no litellm
// subprocess spawn, no port bind (a post-call port probe in IT-143 asserts it). Exit 0/1 with
// composeConfig's own refusal message, so deploy/rwe-update.sh can gate a restart on it BEFORE the
// live service is ever touched.
async function runCheckConfig(): Promise<void> {
  try {
    const { config: fileConfig, path: configPath } = loadFileConfig();
    // A NOOP proxy manager stand-in, paired with deps.listen:false (composeConfig skips calling
    // `.start()` on it entirely) — belt-and-suspenders against ever spawning a real litellm
    // subprocess from a config-validation invocation.
    const noopProxyManager = new LiteLLMProxyManager(fileConfig.aliases ?? DEFAULT_ALIASES, {
      spawnImpl: (() => {
        throw new Error('--check-config must never spawn a proxy subprocess');
      }) as unknown as typeof import('node:child_process').spawn,
    });
    // v37 (ARCH-181): --check-config is read-only apparatus (its own header comment: "NO side
    // effects") — the nested-bwrap probe is a READ, not a mutation, and reporting the posture here
    // is exactly the "at startup, before any run" visibility REQ-218 asks for.
    const confinementProbe = probeConfinement();
    // v37 Gate-8 send-back (finding A2): a clearly-labelled NON-created placeholder — this command's
    // own "no side effects" contract forbids a real `mkdtempSync` here. It can never reach grant
    // validation (that still requires an EXPLICIT `fileConfig.workRoot`/`RWE_WORK_ROOT`, checked
    // above the default) — it exists only so `protectedFiles`/`denyRead` are computed the same way
    // a real boot would compute them, for this command's own reporting.
    const workRootDefault = '<workRoot not set — a temp dir is created at real boot>';
    await composeConfig(fileConfig, { proxyManager: noopProxyManager, listen: false, configPath, confinementProbe, workRootDefault });
    // eslint-disable-next-line no-console
    console.log(`[remote-workflow-engine] --check-config: OK (confinement posture: ${confinementProbe.posture}${confinementProbe.reason ? ` — ${confinementProbe.reason}` : ''})`);
    process.exit(0);
  } catch (err) {
    console.error(`[remote-workflow-engine] --check-config: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--check-config')) {
    await runCheckConfig();
    return;
  }
  const { config: fileConfig, path: configPath } = loadFileConfig();
  // v37 (ARCH-181, DES-261/262, TASK-257, REQ-218, ADR-083 owner_decision posture C): measured
  // ONCE, here, before `composeConfig()` — "at startup" means the operator learns this before any
  // run is ever submitted, not at the first agent() call. `main()` is the ONLY real caller; every
  // test constructs `composeConfig()` directly and omits this (safe default: no door gating, no
  // `confinementPosture` on the gateway — see ComposeConfigDeps.confinementProbe's own doc comment).
  const confinementProbe = probeConfinement();
  // v37 Gate-8 send-back (finding A2, ARCH-177 amendment): ONE `mkdtempSync` — the SAME resolved
  // value `ServerConfig.workRoot` and the confinement block both carry, computed once so a second
  // resolution (server.ts:655's own `??` fallback, kept for direct `createServer()` test callers)
  // can never name a different directory than the one this process actually writes into.
  const workRootDefault = fileConfig.workRoot === undefined && process.env['RWE_WORK_ROOT'] === undefined
    ? mkdtempSync(join(tmpdir(), 'rwe-'))
    : undefined;
  const config = await composeConfig(fileConfig, { configPath, confinementProbe, workRootDefault });
  const server = await createServer(config);
  // eslint-disable-next-line no-console
  console.log(
    `[remote-workflow-engine] listening on http://${config.bind}:${server.port}/mcp (workRoot=${server.workRoot})`,
  );
  // v37 (ARCH-181, DES-262): ONE boot line naming the posture, unconditionally — the whole reason
  // this iteration exists is that a false claim of confinement (BUILT_IN_CORE_TOOLS's old "Bash here
  // is confined to that workspace") survived 70 warnings and two days without anything failing.
  // Never say "isolated"/"sandboxed" without the measured fact attached — the line itself is
  // `confinementBannerLine()` above, which a test pins against the admission rule it describes.
  console.log(confinementBannerLine(confinementProbe));
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
