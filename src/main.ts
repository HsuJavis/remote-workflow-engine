// Product entrypoint / composition root (Gate 7.5 finding, retro L-003): before this file existed,
// createServer() was only ever invoked in-process by vitest test files — there was no documented,
// standalone way to launch the MCP server as a real long-running process. This is the "delivery
// interface" the product's real users (an MCP client, or `curl`) actually connect to.
//
// Config precedence (low -> high): built-in defaults < RWE_CONFIG_PATH JSON file < env vars.
// Provider API keys are NEVER read from the config file (src/gateway/client.ts reads them
// straight from process.env: ANTHROPIC_API_KEY / OPENROUTER_API_KEY / OLLAMA_BASE_URL — client.ts
// reads no OPENAI_API_KEY/GEMINI_API_KEY today, C5 2026-10-06 correction)
// so the JSON config file never holds secrets and is safe to commit an .example of.
//
// D-F4: gateway selection. Production default ("sdk", the config opt-out key's default value) wires
// a real ClaudeAgentSdkGatewayClient (D-F1) as ServerConfig.gateway — the tool-loop-capable path
// REQ-003 and the product core promise require (user decision D1, twice confirmed; direct-fetch
// REJECTED as the default). The proxy this SDK session's ANTHROPIC_BASE_URL points at is the same
// managed LiteLLM proxy subprocess LiteLLMGatewayClient itself uses (src/gateway/litellm-proxy.ts),
// whose model_list is a static openrouter/*+ollama/* wildcard pair (2026-09-26: no alias table any
// more — every model is a full <provider>/<model-id> ref). Setting `gateway: "direct-fetch"` in the
// config file opts back out to the pre-D-F1 path
// (LiteLLMGatewayClient's own per-provider fetch / its own useLiteLLMProxy toggle), unchanged.
// This entrypoint is the ONLY place that decides between the two — server.ts's own default (an
// undefined `config.gateway` falling through to LiteLLMGatewayClient) stays exactly as it was for
// every test caller, none of which sets RWE_CONFIG_PATH/goes through main().
import { readFileSync, existsSync, realpathSync, mkdtempSync, rmSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from './server.js';
import type { ServerConfig } from './server.js';
import { ClaudeAgentSdkGatewayClient } from './gateway/claude-agent-sdk-client.js';
import type { ClaudeAgentSdkGatewayConfig } from './gateway/claude-agent-sdk-client.js';
import { validateHostPathGrants, formatGrantRefusals, toolchainReadCandidates, CLI_SCRATCH_DIR, cliScratchRefusal } from './gateway/bash-confinement.js';
import { probeConfinement, CONFINEMENT_REMEDIATION, PI_CONFINEMENT_REMEDIATION_ADDENDUM } from './gateway/confinement-probe.js';
import type { ConfinementProbeResult } from './gateway/confinement-probe.js';
import { LiteLLMProxyManager } from './gateway/litellm-proxy.js';
import { loadSecretSourceFromEnv } from './secret-source.js';
import { resolveConfig, type SecretSource } from './secret-resolver.js';
import { assertWorkRootIsolated } from './workroot-guard.js';
import type { PrincipalRole as Role } from './authz.js';
import { validateModelProbeConfig } from './models/model-probe.js';
import { validateCasQuotaConfig, validateDiskFloorConfig } from './cas-quota.js';
import { PiGatewayClient } from './gateway/pi-gateway-client.js';
import { probePiPath } from './gateway/pi-confinement-probe.js';
import { sweepOrphanSandboxChildren, sandboxChildRegistryDir } from './sandbox/host.js';
import type { Provider } from './providers.js';
import { assertUpdatePathsOutsideWorkRoot } from './self-update.js';
import { normalizeSeedRefAllowlist, assertHttpsAllowlist } from './seedref-egress.js';
import { assertPositiveInteger } from './config-numeric.js';
import { isEffort } from './params/contract.js';

// pi harness v1 owner decision 2: the closed provider set the pi harness supports — never
// 'anthropic' (no Anthropic subscription token/API key is used under pi). Exported so the wiring
// test and any other reader can assert against the SAME literal rather than a re-typed copy.
export const PI_HARNESS_PROVIDERS: readonly Provider[] = ['openrouter', 'ollama'];

// pi harness v1 (owner decision 1): a THIRD value, `"pi"`, alongside the existing two. Default
// stays "sdk"; production stays on "sdk". One harness per engine — no per-agent/per-run switch
// (pi-harness-research.md §5.1 option A, the chosen design; option B — a per-agent harness router —
// is deferred to v2).
type GatewayChoice = 'sdk' | 'direct-fetch' | 'pi';

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function isNonEmptyString(s: string | undefined): s is string {
  return typeof s === 'string' && s.length > 0;
}

// Omit ServerConfig's own `gateway` field (typed GatewayClient — an object seam, D-F1): the config
// FILE's `gateway` key is a plain string choice this entrypoint resolves into that object itself.
// v25 (REQ-119, DES-166): `diagramRender` is omitted for the same reason as `gateway` — its one
// meaningful field is a FUNCTION (the injected renderer), which a JSON config file cannot express.
// Its two numeric knobs are engine constants on purpose (`diagram-render.ts`), so there is nothing
// here for composeConfig to forward and therefore nothing it can forget to forward.
// pi harness v1 (owner decision 2): `harnessProviders` joins `confinementPosture` in this Omit —
// both are DERIVED (from the probe / from the `gateway` choice), never an independently-declared
// rwe.config.json key.
interface FileConfig extends Partial<Omit<ServerConfig, 'gateway' | 'principals' | 'diagramRender' | 'confinementPosture' | 'casQuota' | 'diskFloor' | 'harnessProviders'>> {
  /** Owner decision 2026-10-02: per-role CAS upload quota as written in rwe.config.json —
   *  `{user?, author?, admin?}`, each a byte count, a size string ("5GiB", "500MB") or
   *  "unlimited"/null. Validated + normalized (bytes, defaults filled) by `validateCasQuotaConfig`;
   *  boot refuses a malformed value. */
  casQuota?: Record<string, unknown>;
  /** Owner decision 2026-10-02: the disk floor — `{percent?, bytes?}` (bytes may be a size string).
   *  Validated + normalized by `validateDiskFloorConfig`; boot refuses a malformed value. */
  diskFloor?: Record<string, unknown>;
  /** D-F4: which GatewayClient main.ts wires up. Default "sdk" (ClaudeAgentSdkGatewayClient, the
   *  real tool-loop-capable path). "direct-fetch" opts out to the legacy LiteLLMGatewayClient path
   *  (server.ts's own pre-existing default, driven by `useLiteLLMProxy`). */
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
  /** Issue #101: `allowReadPaths` — extra READ-ONLY re-opens inside the Bash sandbox's denied home
   *  and workRoot (e.g. `~/.cargo/bin`, `~/.rustup` for a home-installed toolchain). Validated like
   *  `allowHostPaths` (absolute, existing, outside workRoot, covering no protected path and not the
   *  home directory itself) and refused at boot otherwise. The engine's own home-resident PATH
   *  entries and node prefix are re-opened automatically (`toolchainReadCandidates`); this key is
   *  only for what those miss. Absent -> `[]`. */
  sandbox?: { allowHostPaths?: string[]; allowReadPaths?: string[] };
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
  bind: true, port: true, allowedHosts: true, workRoot: true, timeoutMs: true,
  retries: true, useLiteLLMProxy: true, proxyManager: true, litellmPort: true,
  gateway: true, issueReporter: true, mcpProbe: true,
  schedulerDbPath: true, assetRoot: true, agentSlots: true, runConcurrency: true, workspaceTtlMs: true,
  modelCatalogFetchers: true, modelCatalog: true, maxWorkflowDepth: true,
  maxWorkflowDescendants: true, maxConcurrentRuns: true, seedRefAllowlist: true,
  continuationDbPath: true, casDir: true, maxBlobBytes: true, webhookDbPath: true,
  updateFlagPath: true, updateResultPath: true, selfUpdateDbPath: true, systemInfo: true,
  auth: true, maxTimeoutMs: true, maxAppendPromptBytes: true, maxEffort: true, maxRunDurationMs: true,
  maxWorkflowVersions: true, principals: true, mcpEgressAllowlist: true,
  defaultAllowedTools: true, anthropicBaseUrl: true, anthropicAuth: true,
  sandbox: true, modelProbe: true, publicBaseUrl: true,
  casQuota: true, diskFloor: true,
};

// v34 (DES-227, ARCH-139, TASK-229, REQ-203): keys that USED to be forwarded by composeConfig and
// no longer are — an operator's stale `rwe.config.json` entry gets a retirement note instead of
// the plain "unrecognized" treatment a typo gets. Cannot be compile-pinned the way
// `KNOWN_FILE_CONFIG_KEYS` is (a retired key is by definition not `keyof FileConfig` any more); the
// one contradiction worth guarding is that no key appears in both maps (see the wiring UT).
export const RETIRED_CONFIG_KEYS: Record<string, string> = {
  graphAnalyzer: 'at v24 (ADR-025) — diagrams are author-drawn `mermaid` supplied to `workflow_register`; no replacement, remove the key',
  agentDefinitionsDir: 'at v34 — the server-side agentType mechanism is gone; see workflow_authoring_guide → prompt layering',
  // 2026-09-26 (owner decisions 1/7): the alias mechanism is removed entirely — every model is now a
  // full <provider>/<model-id> ref (providers: anthropic, openrouter, ollama), declared REQUIRED at
  // workflow_register in meta.params.agents.<label>.model.default and overridable per run_start. A
  // config file that still carries `aliases` must still BOOT (self-update restarts the service with
  // the existing production config) — this key falls through to the generic unknown-key warning
  // below (named here so the warning carries a retirement reason, not a bare "unrecognized") and is
  // never forwarded to ServerConfig.
  aliases: 'at 2026-09-26 — the alias mechanism is removed; declare a full <provider>/<model-id> ref in meta.params.agents.<label>.model.default instead; remove the key',
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
// review round 2 (owner ruling): round 1's L7 fix made the CONFINED line's wording generic
// ("confinement probe passed") for BOTH gateways, reasoning that "nested-userns probe passed" named
// the sdk-specific mechanism — true, but the fix changed the sdk gateway's own boot text too, which
// the owner ruled is not acceptable: `ERROR_CATALOG.CONFINEMENT_UNAVAILABLE.hint` is a static
// constant baked at module load (it cannot vary by gateway either), so "sdk must stay byte-identical
// to master" extends to this banner. `gateway` (default `'sdk'`, matching every pre-existing call
// site/test) restores master's EXACT sdk-mode string; only `gateway:'pi'` gets the pi-specific one —
// the one place that actually knows which probe ran is main()'s own boot sequence (`fileConfig.gateway`),
// not this pure function guessing from the measured `probe` value alone.
export function confinementBannerLine(probe: { posture: 'confined' | 'unconfined'; reason?: string }, gateway: 'sdk' | 'pi' = 'sdk'): string {
  if (probe.posture === 'confined') {
    if (gateway === 'pi') {
      // pi-path confinement is a SEPARATE measurement from the sdk gateway's own nested-bwrap probe
      // (probePiPath(), real srt bwrap+ripgrep wrapping — see pi-path-probe.ts's own header) — named
      // accurately here, never borrowing the sdk probe's own "nested-userns" wording.
      return '[remote-workflow-engine] Bash confinement: CONFINED (pi-path confinement probe passed at boot)';
    }
    return '[remote-workflow-engine] Bash confinement: CONFINED (nested-userns probe passed at boot)';
  }
  // issue #93 item 1: appends the SAME `CONFINEMENT_REMEDIATION` the `CONFINEMENT_UNAVAILABLE`
  // error hint carries (errors.ts) — an operator reading this boot line and one reading the wire
  // error are told the identical fix, never two hand-typed copies that can drift.
  // review round 2 (owner ruling): the pi rg addendum is appended HERE, only in the one branch that
  // actually knows `gateway:"pi"` is running — `CONFINEMENT_REMEDIATION` itself (and the
  // CONFINEMENT_UNAVAILABLE error hint, which shares it) stays byte-identical to master's sdk-only
  // text for every other caller.
  return (
    `[remote-workflow-engine] Bash confinement: UNCONFINED (${probe.reason ?? 'nested-userns probe failed'})` +
    ' — a run is refused (CONFINEMENT_UNAVAILABLE) when it is a remote submission, OR its trigger was created remotely,' +
    ' OR the version it resolves to was registered remotely; only a local submission of a locally-registered version' +
    ' proceeds, unconfined. Remediation: ' + CONFINEMENT_REMEDIATION +
    (gateway === 'pi' ? ' ' + PI_CONFINEMENT_REMEDIATION_ADDENDUM : '')
  );
}

export function normalizePrincipals(
  raw: Record<string, { role: string }> | undefined,
): { ok: true; value: Record<string, { role: Role }> } | { ok: false; key: string; role: string } {
  const VALID_ROLES: readonly string[] = ['admin', 'author', 'user', 'none'];
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
  /** Issue #101: the engine's home directory (denied as a whole to agent Bash reads), its PATH and
   *  its node executable (the toolchain re-opened inside that deny). Pre-computed VALUES, same seam
   *  convention as `workRootDefault`; omitted -> `os.homedir()`, `process.env.PATH`,
   *  `process.execPath` (main()'s real boot path). */
  homeDir?: string;
  pathEnv?: string;
  execPath?: string;
  /** Secret store for `auth` `${secret:NAME}` handles; omitted -> `loadSecretSourceFromEnv()`. */
  secretSource?: SecretSource;
}

const AUTH_SECRET_KEYS = ['googleClientId', 'googleClientSecret'] as const;

/** Resolves `${secret:NAME}` handles in `auth.googleClientId` / `auth.googleClientSecret` (only those
 *  two keys). Returns a NEW object (the input is not mutated) or `undefined` when auth is absent. */
function resolveAuthSecrets(auth: FileConfig['auth'], source: SecretSource): FileConfig['auth'] {
  if (auth === undefined) return undefined;
  const out = { ...auth };
  for (const key of AUTH_SECRET_KEYS) {
    const value: unknown = out[key];
    if (typeof value !== 'string' || !value.includes('${secret:')) continue;
    try {
      out[key] = resolveConfig(value, source) as string;
    } catch (err) {
      const code = (err as { code?: string }).code;
      const name = /\$\{secret:([^}]*)\}/.exec(value)?.[1] ?? '';
      const why = code === 'SECRET_MISSING'
        ? `references \${secret:${name}}, but RWE_SECRET_${name} is not set in the engine's environment (add it to the env file the service loads, e.g. ~/.config/rwe.env)`
        : `holds a malformed secret handle (expected \${secret:NAME}, NAME = [A-Za-z0-9_.-]+)`;
      throw new Error(`rwe.config.json: auth.${key} ${why}. Refusing to start (a literal handle must never be sent to Google).`);
    }
  }
  return out;
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
        // C5 2026-10-06 correction: this list used to omit "none" (a legal role since 2026-09-30 —
        // see normalizePrincipals' own VALID_ROLES and authz.ts's roleWithSource default).
        '(must be one of admin/author/user/none). Refusing to start (ADR-028 fail-closed: a typo must never silently resolve to a role).',
    );
  }

  // 2026-09-28 (owner: no plaintext secrets in rwe.config.json): `auth.googleClientSecret` /
  // `auth.googleClientId` may be a `${secret:NAME}` handle, resolved HERE from the same RWE_SECRET_<NAME>
  // env store every other handle uses. Fail-closed: an unresolvable/malformed handle refuses boot (and
  // `--check-config`, which shares this function) — the literal handle must never be sent to Google.
  // The error names the handle and its env var, never a value. A plain literal passes through as-is.
  const auth = resolveAuthSecrets(fileConfig.auth, deps.secretSource ?? loadSecretSourceFromEnv());

  // Issue audit A8 (owner decision 2026-10-06): an unrecognized `gateway` value used to fall through
  // silently to the direct-fetch default (nothing here validated the raw string) — refused at boot
  // now, naming the offending value and the full valid set, never a silent fallback.
  // NULL-WAS-DEFAULT (repair round, 2026-10-06): `!= null` (not `!== undefined`) so an explicit
  // JSON `null` — which `?? 'sdk'` below already treats as "use the default" — is still absent, not
  // a refused bad value. Same reasoning applies to every other `!== undefined`/`=== undefined`
  // guard this repair round touches below.
  if (fileConfig.gateway != null && !(['sdk', 'direct-fetch', 'pi'] as const).includes(fileConfig.gateway)) {
    throw new Error(
      `rwe.config.json: gateway "${fileConfig.gateway}" is not a valid value (must be one of "sdk" | "direct-fetch" | "pi"). ` +
        'Refusing to start (ADR-028 fail-closed: a typo must never silently fall back to a different gateway).',
    );
  }
  // Repair round defect A1-LEGACYOWNER-TYPE (2026-10-06): `auth.legacyOwner` is a principal-id
  // STRING (src/auth/auth-service.ts), compared with `===` against `principal.id` (authz.ts) — a
  // number or boolean can never match that comparison, and an empty string is indistinguishable
  // from "no backfill wanted" everywhere else this repair round's A1 logging (workflow-catalog.ts)
  // treats it. Every other key this repair round touches refuses the wrong type at boot; this one
  // didn't. `== null` (not `!== undefined`) so an explicit `null` stays "absent, no backfill" —
  // same NULL-WAS-DEFAULT convention as every other guard in this function.
  if (auth?.legacyOwner != null && (typeof auth.legacyOwner !== 'string' || auth.legacyOwner === '')) {
    throw new Error(
      `rwe.config.json: auth.legacyOwner must be a non-empty string principal id, got ${JSON.stringify(auth.legacyOwner)}. ` +
        'Refusing to start (ADR-028 fail-closed: a non-string/empty value can never match a principal id and would silently disable backfill).',
    );
  }
  const gatewayChoice: GatewayChoice = fileConfig.gateway ?? 'sdk';
  // Issue #73: validated at load, fail-closed (a bad interval must not silently mis-schedule or
  // disable the probe); absent -> the defaults (enabled, weekly). Forwarded below — the
  // composeConfig bug class (compose-config-v2-wiring.test.ts's PROBES row guards it).
  const modelProbe = validateModelProbeConfig(fileConfig.modelProbe);
  if (!modelProbe.ok) {
    throw new Error(`rwe.config.json: invalid modelProbe — ${modelProbe.message}. Refusing to start (ADR-028 fail-closed).`);
  }
  // Owner decision 2026-10-02: same fail-closed validation as modelProbe above; forwarded below.
  const casQuota = validateCasQuotaConfig(fileConfig.casQuota);
  if (!casQuota.ok) throw new Error(`rwe.config.json: invalid casQuota — ${casQuota.message}. Refusing to start (ADR-028 fail-closed).`);
  const diskFloor = validateDiskFloorConfig(fileConfig.diskFloor);
  if (!diskFloor.ok) throw new Error(`rwe.config.json: invalid diskFloor — ${diskFloor.message}. Refusing to start (ADR-028 fail-closed).`);
  // F-1 (sandbox robustness sweep): fail-closed validation for the sandboxed script's own wall-clock
  // run deadline (host.ts SandboxHost.run()) — a positive integer, or absent (host.ts's own default
  // applies). Merge (int/2026-10-06-dc + int/2026-10-06-edge, 2026-10-07): routed through the shared
  // assertPositiveInteger (config-numeric.ts) — the same validator used below for maxTimeoutMs et al.
  // — instead of a second hand-written copy of "must be a positive integer".
  assertPositiveInteger(fileConfig.maxRunDurationMs, 'maxRunDurationMs', { prefix: 'rwe.config.json: ' });
  const maxRunDurationMs = fileConfig.maxRunDurationMs;
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

  // Issue audit A9 (owner decision 2026-10-06): this used to be checked ONLY inside createServer()
  // (server.ts), which `--check-config` never reaches — a config that failed this exact rule still
  // reported OK, then crash-looped the real restart. Calling the SAME `assertUpdatePathsOutsideWorkRoot`
  // function here (server.ts keeps its own call too, for every direct createServer() test caller that
  // bypasses composeConfig) means the rule itself is never duplicated, only the call site is.
  if ((fileConfig.updateFlagPath || fileConfig.updateResultPath) && workRoot !== undefined) {
    assertUpdatePathsOutsideWorkRoot([fileConfig.updateFlagPath, fileConfig.updateResultPath], [workRoot]);
  }
  // Issue audit A9/B21 (owner decision 2026-10-06): same gap as updateFlagPath above —
  // `normalizeSeedRefAllowlist` (seedref-egress.ts) was reached ONLY by RunManager's constructor
  // (createServer()), never by `--check-config`. Validated here for its fail-closed throw alone; the
  // RAW value is still what reaches ServerConfig.seedRefAllowlist below (RunManager normalizes it
  // again at construction — same convention as every other RunManager-owned cap/ceiling: composeConfig
  // validates, the runtime owner still does its own pass).
  if (fileConfig.seedRefAllowlist != null) {
    normalizeSeedRefAllowlist(fileConfig.seedRefAllowlist);
  }
  // Issue audit A9/B4/B21 (owner decision 2026-10-06): the caps/ceilings RunManager/createServer
  // already validate at CONSTRUCTION time (RunManager._positiveInt / `agentSemaphore.total`) — none
  // of them were reachable from `--check-config`, which never constructs either. One shared rule
  // (assertPositiveInteger, config-numeric.ts) — the SAME function RunManager._positiveInt now
  // delegates to — reached from a second call site, never reimplemented.
  // V3-M2 (repair-round defect, 2026-10-06): pass `{ prefix: 'rwe.config.json: ' }` so these
  // refusals are framed like every other composeConfig() refusal below (gateway, maxEffort,
  // mcpEgressAllowlist). RunManager._positiveInt's own call site keeps no prefix — its wording
  // stays exactly as it was.
  const CONFIG_PREFIX = { prefix: 'rwe.config.json: ' };
  assertPositiveInteger(fileConfig.agentSlots, 'agentSlots', CONFIG_PREFIX);
  assertPositiveInteger(fileConfig.runConcurrency, 'runConcurrency', CONFIG_PREFIX);
  assertPositiveInteger(fileConfig.maxWorkflowDepth, 'maxWorkflowDepth', CONFIG_PREFIX);
  assertPositiveInteger(fileConfig.maxWorkflowDescendants, 'maxWorkflowDescendants', CONFIG_PREFIX);
  assertPositiveInteger(fileConfig.maxConcurrentRuns, 'maxConcurrentRuns', CONFIG_PREFIX);
  assertPositiveInteger(fileConfig.maxTimeoutMs, 'maxTimeoutMs', CONFIG_PREFIX);
  assertPositiveInteger(fileConfig.maxAppendPromptBytes, 'maxAppendPromptBytes', CONFIG_PREFIX);
  assertPositiveInteger(fileConfig.maxWorkflowVersions, 'maxWorkflowVersions', CONFIG_PREFIX);
  // Issue audit B21 (owner decision 2026-10-06): an unknown `maxEffort` value used to silently
  // remove EVERY effort level from `resolveHarnessParams`'s ceiling filter (EFFORT_RANK[bad value]
  // is `undefined`, so `EFFORT_RANK[e] <= undefined` is false for every `e`) — the engine still
  // booted, with every effort override/declaration refused from then on. Reuses `isEffort`
  // (params/contract.ts) — the SAME membership check `resolveHarnessParams` itself would use.
  if (fileConfig.maxEffort != null && !isEffort(fileConfig.maxEffort)) {
    throw new Error(
      `rwe.config.json: maxEffort "${fileConfig.maxEffort}" is not a valid effort (must be one of low/medium/high/xhigh/max). ` +
        'Refusing to start (ADR-028 fail-closed).',
    );
  }
  // Issue audit B21 (owner decision 2026-10-06): an `http://` (or unparseable) mcpEgressAllowlist
  // entry used to be accepted at boot but could never match anything (seedref-egress.ts's own
  // `isEgressAllowed`/this file's `normalizeSeedRefAllowlist` both require https) — refused here
  // instead, naming the offending entry, so a typo'd scheme is caught at boot, not discovered the
  // first time an author's `asset_push({kind:'mcp'})` mysteriously gets EGRESS_DENIED. A non-array
  // value gets its own clear refusal (mirrors `normalizeSeedRefAllowlist`'s own shape check) rather
  // than iterating a string's characters or throwing a raw "is not iterable" on a number.
  // V3-M1 (repair-round defect, 2026-10-06): this used to be a second hand-written copy of
  // `normalizeSeedRefAllowlist`'s own parse+https rule. Both now call the one shared
  // `assertHttpsAllowlist` (seedref-egress.ts) — `{ frame: true }` keeps this call site's existing
  // "rwe.config.json: … Refusing to start (ADR-028 fail-closed)." wording.
  if (fileConfig.mcpEgressAllowlist != null) {
    assertHttpsAllowlist(fileConfig.mcpEgressAllowlist, 'mcpEgressAllowlist', { frame: true });
  }

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
  // Issue #101: the engine's home is denied to agent Bash reads as a whole (see below).
  const homeDir = safeRealpath(deps.homeDir ?? homedir());
  const rawGrants = fileConfig.sandbox?.allowHostPaths ?? [];
  let resolvedGrants: string[] = [];
  if (rawGrants.length > 0) {
    if (explicitWorkRoot === undefined) {
      throw new Error('rwe.config.json: sandbox.allowHostPaths requires workRoot to be set (a grant is validated against workRoot containment) — set workRoot, or remove the grant.');
    }
    // Issue #101: a grant covering the home directory would hand back the whole home deny.
    const grantResult = validateHostPathGrants(rawGrants, { workRoot: explicitWorkRoot, protectedFiles: [...protectedFiles, homeDir] }, realpathSync);
    if (!grantResult.ok) {
      throw new Error(`rwe.config.json: invalid sandbox.allowHostPaths entries — refusing to start (ADR-028 fail-closed):\n${formatGrantRefusals(grantResult.refusals)}`);
    }
    resolvedGrants = grantResult.resolved;
  }
  // Issue #101: agent Bash reads are deny-by-default — the whole home and the whole workRoot
  // (bash-confinement.ts). What is re-opened read-only: the home-resident toolchain derived from
  // this process's own PATH/node (a candidate that is missing or fails the grant rules is DROPPED —
  // the operator never asked for it) plus the operator's `sandbox.allowReadPaths` (a bad entry
  // REFUSES boot, like a bad grant).
  const readRule = (root: string) => ({ workRoot: root, protectedFiles: [...protectedFiles, homeDir] });
  const derivedReadPaths = workRoot?.startsWith('/')
    ? toolchainReadCandidates(deps.pathEnv ?? process.env['PATH'], homeDir, deps.execPath ?? process.execPath)
        .flatMap((p) => { const r = validateHostPathGrants([p], readRule(workRoot), realpathSync); return r.ok ? r.resolved : []; })
    : [];
  const rawReadPaths = fileConfig.sandbox?.allowReadPaths ?? [];
  let resolvedReadPaths: string[] = [];
  if (rawReadPaths.length > 0) {
    // Same gate as allowHostPaths: an EXPLICIT workRoot, so --check-config and a real boot agree.
    if (explicitWorkRoot === undefined) {
      throw new Error('rwe.config.json: sandbox.allowReadPaths requires workRoot to be set (an entry is validated against workRoot containment) — set workRoot, or remove the entry.');
    }
    const readResult = validateHostPathGrants(rawReadPaths, readRule(explicitWorkRoot), realpathSync);
    if (!readResult.ok) {
      throw new Error(`rwe.config.json: invalid sandbox.allowReadPaths entries — refusing to start (ADR-028 fail-closed):\n${formatGrantRefusals(readResult.refusals)}`);
    }
    resolvedReadPaths = readResult.resolved;
  }
  const allowReadPaths = [...new Set([...derivedReadPaths, ...resolvedReadPaths])];
  // Issue #101 (CLI scratch): where the kernel sandbox will be used (sdk gateway + a MEASURED
  // 'confined' probe), every dispatch gets its CLI scratch under `<workRoot>/cli-tmp/` and the CLI's
  // sandbox sockets live there — a workRoot too long for a unix socket path would refuse every
  // dispatch, so refuse the boot instead. `--check-config`'s non-absolute placeholder is skipped.
  if (gatewayChoice === 'sdk' && deps.confinementProbe?.posture === 'confined' && workRoot?.startsWith('/')) {
    const scratchRefusal = cliScratchRefusal(workRoot);
    if (scratchRefusal !== null) throw new Error(`workRoot: refusing to start (ADR-028 fail-closed) — ${scratchRefusal}`);
  }

  const config: ServerConfig = {
    bind: process.env['RWE_BIND'] ?? fileConfig.bind ?? '127.0.0.1',
    port: process.env['RWE_PORT'] ? Number(process.env['RWE_PORT']) : (fileConfig.port ?? 8787),
    workRoot,
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
    auth,
    // issue #97: forward the externally-reachable base URL so webhook_create's returned `url`
    // (and any other wire artifact resolvePublicBaseUrl serves — server.ts) is a real, publicly
    // routable host on the production entrypoint instead of silently dropping the operator's config
    // key — same wiring-gap class as v11 updateFlagPath / v15 auth / v16 workspaceTtlMs above.
    publicBaseUrl: fileConfig.publicBaseUrl,
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
    // F-1: validated above (ADR-028 fail-closed) — forwarded verbatim, same wiring convention as
    // the three ceilings above.
    maxRunDurationMs,
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
    modelProbe: modelProbe.value,
    // Owner decision 2026-10-02: validated + normalized above (the composeConfig bug class —
    // compose-config-v2-wiring.test.ts's PROBES rows guard both).
    casQuota: casQuota.value,
    diskFloor: diskFloor.value,
    // v37 (ARCH-181, DES-262, TASK-257, REQ-218): MEASURED, never declared — set only when the
    // caller actually supplied a probe result (deps.confinementProbe, `main()`'s real boot path).
    // Every existing test call site omits it, so `confinementPosture` stays unset here exactly as
    // it did before this field existed — no test anywhere newly gates on a posture it never asked
    // about.
    ...(deps.confinementProbe ? { confinementPosture: deps.confinementProbe.posture } : {}),
    // pi harness v1 owner decision 2: DERIVED from the gateway choice, never an independent
    // rwe.config.json key (joins the FileConfig Omit above) — set only under gateway:"pi" so
    // `checkModelRef`'s provider gate and the models_list/`/api/models` filters engage.
    ...(gatewayChoice === 'pi' ? { harnessProviders: PI_HARNESS_PROVIDERS } : {}),
  };

  if (gatewayChoice === 'pi') {
    // pi harness v1 owner decision 3: no LiteLLM proxy — pi talks to OpenRouter and Ollama
    // natively. `config.proxyManager` stays unset (nothing for main()'s shutdown handler to
    // cascade-kill) and `deps.proxyManager` (the "sdk" branch's own test seam) is never touched —
    // a caller that supplies one under gateway:"pi" gets it silently ignored, which is correct:
    // this branch has nothing to hand it to.
    config.gateway = new PiGatewayClient({
      secretSource: loadSecretSourceFromEnv(),
      ollamaBaseUrl: process.env['OLLAMA_BASE_URL'],
      timeoutMs: config.timeoutMs,
      retries: fileConfig.retries,
      defaultAllowedTools: fileConfig.defaultAllowedTools,
      // slice (e): the SAME grant/protected/workRoot block the sdk branch forwards below, from the
      // SAME resolution above (resolvedGrants/protectedFiles/workRoot/homeDir/allowReadPaths) — one
      // resolution, two gateways.
      confinement: { allowHostPaths: resolvedGrants, protectedFiles, workRoot, homeDir, allowReadPaths },
      // v37 (ARCH-181/262): `deps.confinementProbe` here is main()'s SEPARATE pi-path probe
      // (probePiPath(), gated on `fileConfig.gateway === 'pi'` at the one real call site) — never
      // the sdk path's nested-bwrap probe. Every existing test call site omits it, so this gateway
      // falls back to its own 'unconfined'-shaped default (no `confinementPosture` set at all).
      ...(deps.confinementProbe ? { confinementPosture: deps.confinementProbe.posture } : {}),
    });
  } else if (gatewayChoice === 'sdk') {
    // Same managed LiteLLM proxy subprocess the direct-fetch path can opt into (D-R1) — started
    // once here so its baseUrl is known before constructing the SDK session's ANTHROPIC_BASE_URL.
    // 2026-09-26 (alias mechanism removed): the proxy's model_list is now STATIC — no alias table
    // to construct it from.
    const proxy = deps.proxyManager ?? new LiteLLMProxyManager({
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
    // D-F10(a): forward timeoutMs/retries — previously omitted, which silently degraded D-F7's
    // timeout/retry bound to dead code.
    config.gateway = new ClaudeAgentSdkGatewayClient({
      baseUrl,
      queryImpl: deps.queryImpl,
      // D-G8-4: use the RESOLVED config.timeoutMs (which carries the hardcoded 15000 fallback
      // above), not the raw fileConfig.timeoutMs — the latter is undefined in the exact zero-config
      // shape this fallback exists for, which silently dropped the fallback on this specific
      // construction site even after it was added to `config` above.
      timeoutMs: config.timeoutMs,
      retries: fileConfig.retries,
      // D-F11: forwarded so a configured core tool set actually reaches the constructed client —
      // same composition-root-forwarding convention as timeoutMs/retries above.
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
      confinement: { allowHostPaths: resolvedGrants, protectedFiles, workRoot, homeDir, allowReadPaths },
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
// rwe.config.json (principals roles, workRoot isolation, ...) via the SAME composeConfig()
// translation a real boot uses, but with NO side effects: no litellm subprocess spawn, no port bind
// (a post-call port probe in IT-143 asserts it). Exit 0/1 with composeConfig's own refusal message,
// so deploy/rwe-update.sh can gate a restart on it BEFORE the live service is ever touched.
async function runCheckConfig(): Promise<void> {
  try {
    const { config: fileConfig, path: configPath } = loadFileConfig();
    // A NOOP proxy manager stand-in, paired with deps.listen:false (composeConfig skips calling
    // `.start()` on it entirely) — belt-and-suspenders against ever spawning a real litellm
    // subprocess from a config-validation invocation. 2026-09-26: no alias table argument any more.
    const noopProxyManager = new LiteLLMProxyManager({
      spawnImpl: (() => {
        throw new Error('--check-config must never spawn a proxy subprocess');
      }) as unknown as typeof import('node:child_process').spawn,
    });
    // v37 (ARCH-181): --check-config is read-only apparatus (its own header comment: "NO side
    // effects") — the nested-bwrap probe is a READ, not a mutation, and reporting the posture here
    // is exactly the "at startup, before any run" visibility REQ-218 asks for. pi harness v1: the
    // SAME gateway-keyed probe choice `main()`'s real boot path uses (see its own comment).
    const confinementProbe = fileConfig.gateway === 'pi' ? await probePiPath() : probeConfinement();
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

/** Issue #101 (CLI scratch): removes every per-dispatch CLI scratch under `<workRoot>/cli-tmp/`. Only
 *  safe while nothing is in flight — main() calls it once, before createServer(). */
export function sweepCliScratch(workRoot: string): void {
  rmSync(join(workRoot, CLI_SCRATCH_DIR), { recursive: true, force: true });
}

const UNCONFINED_SKILL_SCRATCH_PREFIX = 'rwe-skills-';
const UNCONFINED_SKILL_SCRATCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** v0374 integration review L-2: the SDK gateway's UNCONFINED-mode `skillsRoot`
 *  (claude-agent-sdk-client.ts: `mkdtempSync(join(tmpdir(), 'rwe-skills-'))`) has no boot sweep the
 *  way its confined sibling does — the confined arm nests INSIDE `<workRoot>/cli-tmp/`, already
 *  wiped wholesale by `sweepCliScratch` above, but the unconfined arm sits in the SHARED system
 *  `os.tmpdir()`, which nothing ever revisited before this fix; a crash between creating it and the
 *  dispatch's own cleanup leaked it there permanently.
 *
 *  Unlike `sweepCliScratch`'s unconditional wipe — safe ONLY because `<workRoot>/cli-tmp` is
 *  EXCLUSIVELY this process's own — `os.tmpdir()` is shared host-wide: a different uid, or even a
 *  different engine instance under the SAME uid (this host's own dev-checkout-plus-`rwe`-service-user
 *  split is exactly this shape), can have a LIVE `rwe-skills-*` dir of its own at this exact moment.
 *  "Nothing is in flight" does not hold here, so this sweep is bounded by TWO conditions instead:
 *  owned by THIS process's own uid, and older than `UNCONFINED_SKILL_SCRATCH_MAX_AGE_MS` (24h) — a
 *  real agent() dispatch's skillsRoot lives for minutes at most, so age alone is strong evidence of
 *  "abandoned," never a live one simply not finished yet. Best-effort throughout: a single entry's
 *  stat/rm failure is skipped, never escalated to fail the whole boot over stale scratch cleanup. */
export function sweepStaleUnconfinedSkillScratch(): void {
  const dir = tmpdir();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const ownUid = process.getuid?.();
  const now = Date.now();
  for (const name of entries) {
    if (!name.startsWith(UNCONFINED_SKILL_SCRATCH_PREFIX)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue; // excludes a symlink too — lstat never follows one
    if (ownUid !== undefined && st.uid !== ownUid) continue;
    if (now - st.mtimeMs < UNCONFINED_SKILL_SCRATCH_MAX_AGE_MS) continue;
    try { rmSync(full, { recursive: true, force: true }); } catch { /* best-effort */ }
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
  // pi harness v1 (spec "Confinement posture"): under gateway:"pi" this is a SEPARATE measurement
  // (probePiPath(), src/gateway/pi-confinement-probe.ts) — srt's bundled sandbox-runtime version and
  // its ripgrep-binary dependency are not the same question the sdk path's `probeConfinement()`
  // answers. Exactly one of the two ever runs; never both, never neither.
  const confinementProbe = fileConfig.gateway === 'pi' ? await probePiPath() : probeConfinement();
  // v37 Gate-8 send-back (finding A2, ARCH-177 amendment): ONE `mkdtempSync` — the SAME resolved
  // value `ServerConfig.workRoot` and the confinement block both carry, computed once so a second
  // resolution (server.ts:655's own `??` fallback, kept for direct `createServer()` test callers)
  // can never name a different directory than the one this process actually writes into.
  const workRootDefault = fileConfig.workRoot === undefined && process.env['RWE_WORK_ROOT'] === undefined
    ? mkdtempSync(join(tmpdir(), 'rwe-'))
    : undefined;
  const config = await composeConfig(fileConfig, { configPath, confinementProbe, workRootDefault });
  // Issue #101 (CLI scratch): per-dispatch CLI scratch dirs a previous process left behind (crash,
  // kill) — nothing is in flight before createServer(), so the whole parent goes.
  if (config.workRoot !== undefined) sweepCliScratch(config.workRoot);
  // Issue #162 (reverify-2 finding): BEFORE this call, a sandbox child could only ever be reaped on
  // a graceful SIGINT/SIGTERM (the shutdown() hook below) — never on a kill -9/OOM/crash, which is
  // what the real reported incident actually was (the orphan survived an engine RESTART). This is
  // the layer that covers that: sweep the previous process instance's own on-disk child-pid
  // record(s) and SIGKILL anything still alive from it, before this new instance ever accepts a
  // run that could spawn a same-pid collision. Same "nothing is in flight before createServer()"
  // placement as `sweepCliScratch`.
  if (config.workRoot !== undefined) sweepOrphanSandboxChildren(sandboxChildRegistryDir(config.workRoot));
  // v0374 integration review L-2: the SDK's unconfined-mode skillsRoot leftovers — see this
  // function's own doc for why it is age/ownership-bounded rather than an unconditional wipe.
  sweepStaleUnconfinedSkillScratch();
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
  console.log(confinementBannerLine(confinementProbe, fileConfig.gateway === 'pi' ? 'pi' : 'sdk'));
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
