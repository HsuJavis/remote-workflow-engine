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
import { existsSync, readdirSync, statSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { join, isAbsolute, dirname } from 'node:path';
import { createRequire } from 'node:module';
import type { AgentOpts, Caps, HarnessDescriptor, TranscriptEvent, Tokens } from '../types.js';
import { ZERO_TOKENS } from '../run-guard.js';
import { redactHarness } from '../agent-executor.js';
import type { McpServerConfig } from '../mcp-probe.js';
import type { AliasMap, EffortApplied, GatewayClient, GatewayResult } from './client.js';
import { resolveTimeout, wireEffort, UNKNOWN_CAPS, attemptsFor } from './client.js';
import { resolveAlias, type Provider } from '../providers.js';
import { isPathContained } from '../path-containment.js';
import { resolveConfig, type SecretSource } from '../secret-resolver.js';
import { proxyModelName } from './litellm-proxy.js';
import { buildBashConfinement, DENY_READ_MODE } from './bash-confinement.js';
import { findProjectMarkerAboveWorkspace, WORKROOT_INSIDE_PROJECT } from '../workroot-guard.js';
import type { EventSink } from '../event-log.js';

// v37 (DES-256, ARCH-178, TASK-253, REQ-218): the installed SDK's OWN package.json version, read
// ONCE at module load — `require('@anthropic-ai/claude-agent-sdk/package.json')` throws
// ERR_PACKAGE_PATH_NOT_EXPORTED (the package's `exports` map publishes only '.'/'./extract'/
// './browser'/'./bridge'/'./sdk-tools'), so the resolved MAIN entry's directory is used instead
// (measured this iteration: TASK-250's S6/UT-318). Never a hand-copied constant; unreadable for any
// reason -> 'unknown' — a log line must never be the thing that fails a run.
function resolveSdkVersion(): string {
  try {
    const nodeRequire = createRequire(import.meta.url);
    const entry = nodeRequire.resolve('@anthropic-ai/claude-agent-sdk');
    const pkgPath = join(dirname(entry), 'package.json');
    return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
const SDK_VERSION = resolveSdkVersion();

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
   *  prevent (a non-reasoning Ollama/OpenRouter model 400ing on think:true). */
  aliases?: AliasMap;
  /** D-F7: bounds invoke() with an AbortController race exactly like LiteLLMGatewayClient — a
   *  hung/stuck session resolves `{ok:false, reason:'timeout'}` instead of hanging unbounded.
   *  Optional: when omitted, invoke() has no bound of its own (unchanged legacy behavior). */
  timeoutMs?: number;
  /** Extra attempts after the first, only meaningful when timeoutMs is set. Defaults to 0. */
  retries?: number;
  /** D-F11: the configurable default core tool set applied to `options.allowedTools` when a call
   *  carries no `req.opts.allowedTools` of its own (the caller's own per-call value, see
   *  agent-executor.ts, always wins when present). Config key: `defaultAllowedTools` in
   *  rwe.config.json (forwarded by src/main.ts's composeConfig()). Falls back to a built-in
   *  minimal core set (BUILT_IN_CORE_TOOLS below) when this is also omitted — invoke() never
   *  leaves options.allowedTools unset, which is exactly what let the SDK CLI's full, uncurated
   *  tool surface (dozens of tools) through and overwhelmed a 7B local model's tool-selection
   *  ability (08-validation.md round-5 VAL-003). */
  defaultAllowedTools?: string[];
  /** D-V2V-1 (REQ-009 route-back): pre-v24 flat per-run asset root — UNUSED since v24 (TASK-145):
   *  `AssetSyncService` (DES-153) now keeps two SCOPED roots (`workRoot`/`globalRoot`) reached only
   *  through `resolveMcp`/`materializeAssets`'s injected `roots` param (per `req.assets`), never
   *  read directly here. Left on the config type because `server.ts`'s composition root still sets
   *  it (out of this task's file scope) — kept for source compatibility, read by nothing below. */
  assetRoot?: string;
  /** D-V3M-1 (REQ-017 route-back, closes the ①/IT-035 gap); v24 (TASK-139/TASK-145, DES-153/154):
   *  the MCP Provisioning Registry (`mcp-registry.ts`) is DELETED — this is now the injected
   *  catalog port `AssetSyncService`'s `resolveMcp(catalog, workflow, names)` is bound to at the
   *  composition root (`main.ts`/`server.ts`, out of scope), called here per dispatch with THIS
   *  call's workflow name + its label's declared `mcp` names (`req.assets`, DES-154). Omitted ->
   *  no MCP injection at all (same "no injection" behavior the old unconfigured-dbPath case had). */
  resolveMcp?: (workflow: string, names: string[]) => Promise<{ configs: Record<string, McpServerConfig>; missing: string[] }>;
  /** D-V3M-1 (REQ-018): resolves `${secret:NAME}` handles inside a provisioned MCP config from the
   *  server-side secret store (loadSecretSourceFromEnv — `RWE_SECRET_*`). When set, an unresolvable
   *  handle fails the referencing agent() loudly (SECRET_MISSING) rather than passing the literal
   *  handle through. Omitted -> configs are injected verbatim (no handle substitution attempted).
   *  REQ-037: also the store the Anthropic-direct auth material (real ANTHROPIC_API_KEY /
   *  CLAUDE_CODE_OAUTH_TOKEN) is resolved from — by the secret NAMEs `ANTHROPIC_API_KEY` and
   *  `CLAUDE_CODE_OAUTH_TOKEN` (i.e. `RWE_SECRET_ANTHROPIC_API_KEY` /
   *  `RWE_SECRET_CLAUDE_CODE_OAUTH_TOKEN`), never a run-workspace-reachable path. */
  secretSource?: SecretSource;
  /** REQ-037: the REAL Anthropic API base for the provider-native (LiteLLM-bypassed) path — an
   *  alias whose provider is `anthropic` dispatches straight here so no tool-schema translation ever
   *  touches a Claude model. Defaults to `https://api.anthropic.com`. Non-anthropic providers still
   *  route via the managed LiteLLM proxy at `baseUrl`. */
  anthropicBaseUrl?: string;
  /** REQ-037: which Anthropic auth mode the direct path uses. `api-key` injects a real
   *  ANTHROPIC_API_KEY; `subscription` injects a CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`)
   *  and sets NO ANTHROPIC_API_KEY. Omitted -> auto: subscription when an oauth-token secret is
   *  present, else api-key. The chosen mode's secret being absent is a typed terminal failure
   *  (ANTHROPIC_AUTH_MISSING), never a silent dummy-key attempt. */
  anthropicAuth?: 'api-key' | 'subscription';
  /** v37 (ARCH-176/177, DES-253, TASK-253, REQ-218): the grant/protected/workRoot block
   *  `buildBashConfinement()` (src/gateway/bash-confinement.ts) consumes, USED ONLY when
   *  `confinementPosture === 'confined'` (see that field's own doc comment — absent this block,
   *  `buildBashConfinement()` is never even called). Set by ONE caller (`main.ts`'s
   *  `composeConfig()`, ARCH-177 — not threaded through `RunManager`, not added to the
   *  `GatewayClient` port; `LiteLLMGatewayClient` has no subprocess and is unconfined BY CATEGORY,
   *  not by gap). */
  confinement?: { allowHostPaths: readonly string[]; protectedFiles: readonly string[]; workRoot: string };
  /** v37 (ARCH-181, DES-262, TASK-257, REQ-218, ADR-083 owner_decision posture C): this engine's
   *  MEASURED confinement posture (src/gateway/confinement-probe.ts, run once at boot — never a
   *  config key). **Defaults to `'unconfined'` when omitted** — found empirically, not assumed: an
   *  earlier draft of this field defaulted to `'confined'`, which broke every real-CLI-spawning
   *  integration/acceptance test that constructs this class directly (`val-023-sdk-gateway-timeout`
   *  and its siblings) — on a host without a working sandbox, `sandbox.enabled:true` fails at CLI
   *  startup (`num_turns:0`, before any tool call) regardless of what the test actually exercises.
   *  `'unconfined'` is also the philosophically correct default for this iteration's own thesis —
   *  "never claim confinement without evidence" applies to the CALLER too: a construction that never
   *  asked the boot-time nested-userns question has none. Only `main.ts`'s real boot probe
   *  (ARCH-181) ever sets `'confined'` explicitly, from a real measurement; a real-tier test that
   *  wants to exercise the confined arm sets it explicitly too (`bash-confinement-wiring.test.ts`,
   *  `val-253-bash-confinement.test.ts`). `'unconfined'` ⇒ `options.sandbox = { enabled:false }` —
   *  `buildBashConfinement()` is not even
   *  called; a host that cannot measure a working nested user namespace does not get asked to try. */
  confinementPosture?: 'confined' | 'unconfined';
}

/** REQ-037: resolves the Anthropic-direct auth material for the chosen mode, reading the injected
 *  secret store first (name `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`, i.e. the `RWE_SECRET_*`
 *  store) then the plain host env as a fallback. Auto-selects subscription when an oauth token is
 *  present and no explicit mode is set. Never returns the dummy key — a missing secret is signalled
 *  as `{ ok:false }` so the caller can raise a typed terminal failure instead of attempting a call
 *  with no real credential. */
function resolveAnthropicAuth(
  config: ClaudeAgentSdkGatewayConfig,
): { ok: true; mode: 'api-key'; apiKey: string } | { ok: true; mode: 'subscription'; oauthToken: string } | { ok: false } {
  const fromSecret = (name: string): string | undefined => config.secretSource?.resolve(name);
  const apiKey = fromSecret('ANTHROPIC_API_KEY') ?? process.env['RWE_SECRET_ANTHROPIC_API_KEY'] ?? process.env['ANTHROPIC_API_KEY'];
  const oauthToken =
    fromSecret('CLAUDE_CODE_OAUTH_TOKEN') ?? process.env['RWE_SECRET_CLAUDE_CODE_OAUTH_TOKEN'] ?? process.env['CLAUDE_CODE_OAUTH_TOKEN'];
  const mode: 'api-key' | 'subscription' = config.anthropicAuth ?? (oauthToken ? 'subscription' : 'api-key');
  if (mode === 'subscription') {
    return oauthToken ? { ok: true, mode: 'subscription', oauthToken } : { ok: false };
  }
  return apiKey ? { ok: true, mode: 'api-key', apiKey } : { ok: false };
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

/** Injected fs facade `materializeAssets` runs over (UT-156) — defaults to real fs so production
 *  callers never need to build one. */
export interface AssetFsFacade {
  exists(path: string): boolean;
  copyDir(src: string, dest: string): void;
  writeFile(path: string, content: string): void;
}

const REAL_FS: AssetFsFacade = {
  exists: existsSync,
  copyDir: copyDirRecursive,
  writeFile: (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  },
};

/** v24 (ARCH-103/DES-154, TASK-145): SELECTIVE materialization — REPLACES the old copy-every-
 *  stored-asset loop (`materializeAssets(assetRoot, workspace)`, no `declared` set at all, every
 *  run got every author's skill). Copies ONLY `declared.skills` into
 *  `<workspace>/.claude/skills/<name>/` (workflow scope wins a name clash with global — checked
 *  first); a name absent from BOTH roots lands in `missing` and the run proceeds (owner 19.5.3 — no
 *  refusal). `.mcp.json` is REWRITTEN (never merged) from `resolveMcp(declared.mcp)`'s configs,
 *  an empty declared.mcp writing an empty server map. Pure over the injected `fs` facade (unit
 *  tier: a fake; production: `REAL_FS`, the default). */
export async function materializeAssets(
  roots: { workflow: string; global: string },
  workspace: string,
  declared: { skills: string[]; mcp: string[] },
  resolveMcp: (names: string[]) => Promise<{ configs: Record<string, McpServerConfig>; missing: string[] }>,
  fs: AssetFsFacade = REAL_FS,
): Promise<{ skills: string[]; mcp: string[]; missing: string[] }> {
  const skills: string[] = [];
  const missing: string[] = [];
  for (const name of declared.skills) {
    const workflowPath = join(roots.workflow, 'skill', name);
    const globalPath = join(roots.global, 'skill', name);
    if (fs.exists(workflowPath)) {
      fs.copyDir(workflowPath, join(workspace, '.claude', 'skills', name));
      skills.push(name);
    } else if (fs.exists(globalPath)) {
      fs.copyDir(globalPath, join(workspace, '.claude', 'skills', name));
      skills.push(name);
    } else {
      missing.push(name);
    }
  }
  const { configs, missing: mcpMissing } = await resolveMcp(declared.mcp);
  missing.push(...mcpMissing);
  fs.writeFile(join(workspace, '.mcp.json'), JSON.stringify({ mcpServers: configs }, null, 2));
  return { skills, mcp: Object.keys(configs), missing };
}

/** D-F11 built-in fallback — never leaves `options.allowedTools` unset even with no
 *  ClaudeAgentSdkGatewayConfig.defaultAllowedTools and no per-call req.opts.allowedTools.
 *  D-V3M-3 (user directive 2026-07-11, dynamic-workflow-compat §5 tool parity): the default now
 *  carries the confined file+search+shell set — Read, Write, Edit, Glob, Grep, Bash — so an
 *  unspecified agent() has the working surface the real dynamic-workflow agent has, not just
 *  Read/Write (which the user found "不太夠"). This DELIBERATELY supersedes D-V2G8-1(b)'s earlier
 *  Bash-from-default exclusion: that exclusion existed because at the time there was NO fs jail (a
 *  Bash default would have driven a shell anywhere in the parent trust zone). The jail now exists —
 *  D-V2G8-1(d)'s realpath workspace-boundary is enforced for EVERY call via BOTH canUseTool and the
 *  PreToolUse hook, and cwd is re-scoped to the run workspace. **v37 correction (REQ-218, ARCH-176):**
 *  this is true for every OTHER path-bearing tool (Read/Write/Edit/Glob/Grep/NotebookEdit — their
 *  path argument is right there in `tool_input`), but it was never true for Bash the way this
 *  paragraph used to claim: `extractCandidatePaths` gets no `blockedPath` for Bash (its `tool_input`
 *  carries only `command`, `claude-agent-sdk-client.ts`'s own `makePreToolUseHook` call), so the hook
 *  allows every Bash call unconditionally — see `src/gateway/bash-confinement.ts` for what actually
 *  confines Bash now: the OS-level sandbox (`Options.sandbox`, kernel-enforced, ADR-082), attempted
 *  on every call when this engine's boot-time posture probe found a working nested user namespace
 *  (`agent.confinement`'s `posture:'confined'`), and — on a host where it did not — NOT attempted at
 *  all: a locally-submitted run's Bash is genuinely unconfined (ADR-083 owner_decision posture C,
 *  the accepted cost), and only a REMOTE submission is refused outright, before this code ever runs
 *  (`call-tool.ts`'s door). Web egress (WebFetch/WebSearch) and sub-agent spawning (Task/Agent) stay
 *  OUT of the default (opt-in via an explicit per-call `allowedTools`) — they break workspace
 *  confinement / the engine's own orchestration+DOS model respectively, in EITHER posture. */
const BUILT_IN_CORE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'];

/** REQ-038 passthrough: a model already in `openrouter/<id>` form is NOT a configured alias — its
 *  provider is the prefix and it must NOT be proxy-cloaked (`rwe-proxy-*`). It matches LiteLLM's
 *  `openrouter/*` wildcard route verbatim; a slashed id is never a bare CLI shorthand, so there is
 *  no shorthand-expansion risk to cloak against. */
export function isPassthroughModel(model: string | undefined): model is string {
  return typeof model === 'string' && model.startsWith('openrouter/');
}

/** v26 (DES-173, ARCH-112, TASK-174, REQ-123): the effective provider for routing — the prefix for
 *  a passthrough model, else the alias's configured provider, now resolved via `resolveAlias`
 *  (`providers.ts`, DES-172) — `effectiveProvider`'s OWN former inline lookup (`providerOf`) MOVED
 *  there rather than being retired, per DES-173's own boundary. All three remaining providers get
 *  the caller's `allowedTools` verbatim (REQ-123 retires per-provider tool curation outright, along
 *  with `NON_ANTHROPIC_EXCLUDED_TOOLS`/`curateToolsForProvider`) — this is now used only for
 *  auth/wire routing (thinking policy, effort, anthropic-direct dispatch), never tool curation. */
export function effectiveProvider(aliases: AliasMap | undefined, model: string | undefined): string | undefined {
  if (isPassthroughModel(model)) return 'openrouter';
  return model !== undefined && aliases !== undefined ? resolveAlias(aliases, model)?.provider : undefined;
}

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
// V3-residual (Gate 8 v2 review, adversarial finding V3, MEDIUM after the D-V2G8-1(d) downgrade):
// the earlier boundary check only inspected `file_path` (Read/Write/Edit/NotebookEdit) + the Bash
// `blockedPath`. Glob/Grep carry their search root in `path`, and NotebookEdit uses `notebook_path`
// — an agent could Glob/Grep/read a notebook OUTSIDE the workspace through those un-inspected fields.
// Every known path-bearing tool argument is now extracted and checked; a call is denied if ANY of
// them escapes. **v37 correction (REQ-218, ARCH-176):** the parenthetical this comment used to carry
// ("Bash beyond its SDK-computed `blockedPath` remains best-effort") was the HONEST half of the pair
// this row's own doc comment above contradicted — it is still accurate as a description of THIS
// hook's own reach (a shell command's targets cannot be read off its text; `blockedPath` is never
// populated for Bash, see `extractCandidatePaths`' call site below) but it read as "so Bash is only
// weakly confined", which stopped being the whole story once REQ-218 shipped: Bash is confined by a
// SEPARATE mechanism, the OS sandbox (`bash-confinement.ts`), not by this hook at all — and that
// mechanism's own honesty is stated where it lives, not repeated here a third way.
const PATH_ARG_FIELDS = ['file_path', 'path', 'notebook_path'] as const;

function extractCandidatePaths(input: Record<string, unknown>, blockedPath?: string): string[] {
  const out: string[] = [];
  if (typeof blockedPath === 'string' && blockedPath.length > 0) out.push(blockedPath);
  for (const field of PATH_ARG_FIELDS) {
    const v = input[field];
    if (typeof v === 'string' && v.length > 0) out.push(v);
  }
  return out;
}

/** A relative tool-path argument is relative to the CLI subprocess's cwd — which the engine
 *  re-scopes to the run workspace (`root`) — NOT the engine process cwd `isPathContained`/`resolve`
 *  would otherwise use. Resolve it against `root` first so the containment check has the right base
 *  (a relative `../../etc/passwd` still resolves+realpaths out and is denied). */
function resolveAgainstWorkspace(candidate: string, root: string): string {
  return isAbsolute(candidate) ? candidate : join(root, candidate);
}

function toolUsePreCheck(root: string | undefined, candidates: string[]): { behavior: 'allow' } | { behavior: 'deny'; message: string } {
  if (root === undefined) return { behavior: 'allow' }; // no workspace known → nothing to enforce
  for (const candidate of candidates) {
    if (!isInsideWorkspace(resolveAgainstWorkspace(candidate, root), root)) {
      return { behavior: 'deny', message: `path outside run workspace: ${candidate}` };
    }
  }
  return { behavior: 'allow' };
}

function makeCanUseTool(root: string | undefined): CanUseTool {
  return async (_toolName, input, options) => {
    return toolUsePreCheck(root, extractCandidatePaths(input as Record<string, unknown>, options.blockedPath));
  };
}

/** D-V2G8-1(d) real-execution corollary (see makeCanUseTool above): a `PreToolUse` hook fires for
 *  EVERY tool call regardless of whether a bare `allowedTools` entry already auto-approved it —
 *  the SDK's own suggested mechanism for gating a call `canUseTool` alone cannot reach. */
function makePreToolUseHook(root: string | undefined): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const decision = toolUsePreCheck(root, extractCandidatePaths((input.tool_input ?? {}) as Record<string, unknown>));
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

// Never a real credential (D-R2): the SDK still requires ANTHROPIC_API_KEY to be non-empty even
// when ANTHROPIC_BASE_URL points somewhere else entirely (a local proxy, or a local stub server).
const DUMMY_API_KEY = 'sk-local-dev-dummy-not-a-real-key';

// D-G8-5: an explicit ALLOWLIST of host env vars the spawned `claude` CLI subprocess actually
// needs to run (find its own binaries, resolve $HOME-relative config/cache paths, respect the
// host's locale/shell) — never the full `process.env`, which would leak every unrelated host
// secret (OPENAI_API_KEY, cloud credentials, ...) straight into a subprocess this class's own
// header comment already promises never happens (D-R2 hermeticity).
const ENV_ALLOWLIST = ['PATH', 'HOME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM'];

/** REQ-037: the outcome of building the spawned CLI subprocess env — either the ready env, or a
 *  typed reason the Anthropic-direct auth couldn't be assembled (a missing secret for the chosen
 *  mode). The caller turns the failure into a `{ ok:false, reason:'terminal', detail }` GatewayResult
 *  rather than silently attempting a call with the dummy key. */
type SubprocessEnvResult = { ok: true; env: Record<string, string> } | { ok: false; detail: string };

/** Builds the spawned CLI subprocess's env from the ALLOWLIST above plus the routing/auth vars this
 *  class sets. PROVIDER-AWARE (REQ-037):
 *   - `anthropic`: ANTHROPIC_BASE_URL = the REAL Anthropic API (LiteLLM bypassed, no tool-schema
 *     translation) + real auth per `anthropicAuth` (api-key -> real ANTHROPIC_API_KEY, never the
 *     dummy; subscription -> CLAUDE_CODE_OAUTH_TOKEN and NO ANTHROPIC_API_KEY). A missing secret for
 *     the chosen mode -> `{ ok:false, detail:'ANTHROPIC_AUTH_MISSING' }`.
 *   - everything else (openai/openrouter/ollama/gemini/unknown): unchanged legacy behavior —
 *     ANTHROPIC_BASE_URL = the managed LiteLLM proxy `config.baseUrl` + the DUMMY key.
 *  The real key / oauth token is injected ONLY here, into the SDK subprocess env — never written to
 *  the run workspace, sandbox, or any transcript (D-R2). CLAUDE_CODE_OAUTH_TOKEN is an auth var
 *  treated like the ANTHROPIC_* pair (deliberately NOT added to ENV_ALLOWLIST, which is for benign
 *  host vars only). */
function buildSubprocessEnv(config: ClaudeAgentSdkGatewayConfig, provider: string | undefined): SubprocessEnvResult {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (provider === 'anthropic') {
    const auth = resolveAnthropicAuth(config);
    if (!auth.ok) return { ok: false, detail: 'ANTHROPIC_AUTH_MISSING' };
    env['ANTHROPIC_BASE_URL'] = config.anthropicBaseUrl ?? 'https://api.anthropic.com';
    if (auth.mode === 'api-key') env['ANTHROPIC_API_KEY'] = auth.apiKey;
    else env['CLAUDE_CODE_OAUTH_TOKEN'] = auth.oauthToken; // subscription: no ANTHROPIC_API_KEY at all
    return { ok: true, env };
  }
  env['ANTHROPIC_BASE_URL'] = config.baseUrl;
  env['ANTHROPIC_API_KEY'] = DUMMY_API_KEY;
  return { ok: true, env };
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

/** v26 (DES-180, ARCH-118, TASK-180): four-column extraction off a real 'result' message — SDK
 *  `result.usage` `{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}`
 *  when present; falling back to the SUM over `modelUsage[*]` (camelCase field names) when `usage`
 *  is absent; all-zero `Tokens` when neither is present. Runtime-checked rather than trusting the
 *  SDK's own `usage: NonNullableUsage` type — a queryImpl fake (or a future SDK build) may omit it.
 *  `cache_creation_input_tokens` flattens the 5-minute/1-hour TTL cache-write breakdown into one
 *  column, priced downstream at one flat rate (ADR-046's named, bounded approximation).
 *  v26 (M-1 send-back repair, ADR-046 D-V26-projection): when NEITHER shape is present, the
 *  all-zero `ZERO_TOKENS` used to be silent — `'result.usage'` is now pushed onto `gaps` (the
 *  SAME `unmapped` array REQ-125's unmapped-subtype counter already accumulates into; ADR-046
 *  groups both under one class), reaching `run_result.meta.unmappedMessages` via the existing
 *  wiring. Per-field absence WITHIN a present `usage`/`modelUsage` is not gap-counted — a `?? 0`
 *  over an optional field (e.g. no cache activity this call) is a healthy, expected shape and a
 *  counter that fires on every healthy call has no reader. */
function extractTokens(msg: unknown, gaps: string[]): Tokens {
  const m = msg as { usage?: Record<string, number>; modelUsage?: Record<string, Record<string, number>> };
  if (m.usage) {
    return {
      input: m.usage['input_tokens'] ?? 0,
      output: m.usage['output_tokens'] ?? 0,
      cacheRead: m.usage['cache_read_input_tokens'] ?? 0,
      cacheWrite: m.usage['cache_creation_input_tokens'] ?? 0,
    };
  }
  if (m.modelUsage && typeof m.modelUsage === 'object') {
    const t = { ...ZERO_TOKENS };
    for (const row of Object.values(m.modelUsage)) {
      t.input += row['inputTokens'] ?? 0;
      t.output += row['outputTokens'] ?? 0;
      t.cacheRead += row['cacheReadInputTokens'] ?? 0;
      t.cacheWrite += row['cacheCreationInputTokens'] ?? 0;
    }
    return t;
  }
  gaps.push('result.usage');
  return ZERO_TOKENS;
}

// v26 (DES-171, ARCH-111, ADR-040, TASK-176, issue #65): `classifyApiError` is total over the
// closed 10-member `SDKAssistantMessageError` union (pinned against the INSTALLED
// @anthropic-ai/claude-agent-sdk@0.3.199's sdk.d.ts, confirmed by direct read). `kind` is widened
// to `| string` on purpose — the value crosses an IPC boundary from a CLI whose version the
// updater moves independently of this codebase, so a future SDK's eleventh kind must never crash
// this classifier: it falls through to the SAME status-code heuristic as the SDK's own `'unknown'`.
const TERMINAL_ERROR_KINDS = new Set<string>([
  'authentication_failed', 'oauth_org_not_allowed', 'billing_error', 'invalid_request', 'model_not_found',
]);
const RETRYABLE_ERROR_KINDS = new Set<string>(['rate_limit', 'overloaded', 'server_error', 'max_output_tokens']);

export function classifyApiError(kind: string, status: number | null): 'terminal' | 'retry' {
  if (TERMINAL_ERROR_KINDS.has(kind)) return 'terminal';
  if (RETRYABLE_ERROR_KINDS.has(kind)) return 'retry';
  // 'unknown' and anything outside the closed union: retry unless the status is a definite 4xx a
  // provider that already answered will not fix by waiting — 408/429 stay retryable (a timeout/
  // rate-limit is transient by nature despite being technically 4xx).
  return status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429 ? 'terminal' : 'retry';
}

// v26 (DES-171, ARCH-111): the CLOSED set of `system` message subtypes this SDK version emits as
// routine control-plane chatter — read from the installed sdk.d.ts at Gate 5, recorded here so an
// SDK upgrade that adds a subtype counts it (the safe default) rather than silently widening the
// skip list. `api_retry` is handled separately, above; everything NOT in this set and NOT
// `api_retry` is COUNTED (never stored as a payload — see `_drain` below), including the four
// diagnostics (`model_refusal_fallback`/`model_refusal_no_fallback`/`permission_denied`/
// `mirror_error`) and any subtype a future SDK adds.
const BENIGN_SYSTEM_SUBTYPES = new Set<string>([
  'init', 'compact_boundary', 'status', 'commands_changed', 'elicitation_complete', 'files_persisted',
  'hook_progress', 'hook_response', 'hook_started', 'informational', 'local_command_output',
  'memory_recall', 'notification', 'plugin_install', 'session_state_changed', 'task_notification',
  'task_progress', 'task_started', 'task_updated', 'thinking_tokens', 'worker_shutting_down',
]);


/** v26 (DES-171): an unmapped subtype is COUNTED, never stored as a payload — capped at 64 bytes,
 *  restricted to `[a-z0-9_.-]` (anything else becomes `?`) so a subtype string can never smuggle
 *  arbitrary message content into `GatewayResult.unmapped`/a log line. */
function sanitizeSubtype(subtype: unknown): string {
  const raw = typeof subtype === 'string' && subtype.length > 0 ? subtype : '?';
  return raw.slice(0, 64).replace(/[^a-z0-9_.-]/g, '?');
}

/** One @anthropic-ai/claude-agent-sdk headless session per agent() call: reads only the final
 *  `result` message off the session's own async-generator agent loop. */
export class ClaudeAgentSdkGatewayClient implements GatewayClient {
  private readonly _query: QueryImpl;
  // v37 (DES-256, ARCH-178): late-bound, mirrors `bindResolveMcp` below — the gateway is constructed
  // in `composeConfig()` BEFORE the sink's owner (server.ts's `store`) exists. A NO-OP sink at
  // construction means "nothing bound yet" and "did it" are never the same line of code.
  private _eventSink: EventSink = () => {};

  constructor(private readonly _config: ClaudeAgentSdkGatewayConfig) {
    this._query = _config.queryImpl ?? sdkQuery;
  }

  /** v37 (DES-256, ARCH-178, TASK-253): binds the operational-event sink AFTER construction — same
   *  shape and reason as `bindResolveMcp` above. */
  bindEventSink(sink: EventSink): void {
    this._eventSink = sink;
  }

  /** v24 (integrator; REQ-113, adjudication #4 C-2's wiring sweep): binds the catalog-backed
   *  `resolveMcp` port AFTER construction. TASK-139 deleted `mcp-registry.ts` and replaced it with
   *  this injected port, and TASK-145's own note says it was "left UNBOUND at the composition
   *  root, out of scope" — so a declared `mcp` name resolved to nothing on every dispatch and half
   *  of REQ-113 was dead. The gateway is constructed in `composeConfig()`, BEFORE `createServer()`
   *  builds the catalog, so the seam has to be a late bind — the same shape as
   *  `McpFacade.bindAssetSync`, and for the same reason. */
  bindResolveMcp(resolve: NonNullable<ClaudeAgentSdkGatewayConfig['resolveMcp']>): void {
    (this._config as { resolveMcp?: ClaudeAgentSdkGatewayConfig['resolveMcp'] }).resolveMcp = resolve;
  }

  /** v24 (ARCH-103/DES-154, TASK-145): resolves THIS dispatch's declared `mcp` names against the
   *  injected catalog-backed `resolveMcp` port (bound at the composition root — `main.ts`/
   *  `server.ts`, out of scope), substituting `${secret:NAME}` handles from the server-side secret
   *  store. No `resolveMcp` / empty name list yields "no injection", nothing missing.
   *  A resolved config whose `${secret:...}` handle can't be resolved THROWS with the code in the
   *  message (SECRET_MISSING / SECRET_HANDLE_INVALID) — REQ-018's fail-loud contract: the run
   *  surfaces a clear error rather than silently running a tool with no credential or (worse)
   *  smuggling the literal handle through as a value. The throw propagates up as that agent()'s
   *  failure (same shape as an unknown MCP name). */
  private async _resolveMcpConfigs(workflow: string, names: string[]): Promise<{ configs: Record<string, McpServerConfig>; missing: string[] }> {
    if (this._config.resolveMcp === undefined || names.length === 0) return { configs: {}, missing: names };
    const resolved = await this._config.resolveMcp(workflow, names);
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
    return { configs: out, missing: resolved.missing };
  }

  async invoke(req: { prompt: string; opts: AgentOpts; runId: string; agentId: string; signal?: AbortSignal; workspace?: string; assets?: { roots: { workflow: string; global: string }; declared: { skills: string[]; mcp: string[] }; workflow: string }; onHarness?: (h: HarnessDescriptor, applied?: EffortApplied) => Promise<void>; onEvent?: (ev: TranscriptEvent) => void | Promise<void>;
    /** v26 (DES-179, ARCH-117, TASK-179): the run's admission-time pinned capability for THIS call's
     *  model (ARCH-116) — threaded by the executor when it wires the pin (out of this task's scope);
     *  absent -> UNKNOWN_CAPS, `wireEffort`'s documented fail-safe branch. */
    caps?: Caps }): Promise<GatewayResult> {
    // D-F7: bounded race only when a timeout is in effect — otherwise unchanged legacy behavior (a
    // single unbounded attempt). issue #24/#22: a per-call AgentOpts.timeoutMs counts as "in effect"
    // even when the gateway has no configured default, so a config-less gateway still bounds+retries
    // a call that asked for a timeout. Must resolve the SAME effective value as _invokeOnce below.
    const effTimeout = resolveTimeout(req.opts.timeoutMs) ?? this._config.timeoutMs;
    const attempts = attemptsFor(this._config.retries, effTimeout);
    let last: GatewayResult = { ok: false, provider: 'claude-agent-sdk', reason: 'terminal' };
    for (let i = 0; i < attempts; i++) {
      // v37 (DES-256): `agent.confinement`'s own `attempt` counter — DISTINCT from `sys.attempt`
      // (the CLI's internal backoff, read inside `_drain`) — one per pass through THIS loop, so the
      // event's contract is "once per attempt", the claim a single "once per call" line could never
      // hold (the options literal, and the posture it carries, is rebuilt inside `_invokeOnce` on
      // every pass).
      last = await this._invokeOnce(req, i + 1);
      if (last.ok) return last;
      // v26 (DES-171, ARCH-111, TASK-176, issue #65): a classifyApiError-terminal failure ends the
      // attempt immediately — retrying costs a full timeoutMs against a provider that already said
      // no. `retryable` is `false` on that classification; every other failure reason (absent
      // `retryable`) keeps retrying up to the configured bound, unchanged. v37 (DES-259, REQ-218)
      // adds a SECOND producer: `SANDBOX_UNAVAILABLE` (below) also sets `retryable:false` — a retry
      // cannot install a working nested user namespace.
      if (!last.ok && last.retryable === false) break;
    }
    return last;
  }

  private async _invokeOnce(req: { prompt: string; opts: AgentOpts; runId: string; agentId: string; signal?: AbortSignal; workspace?: string; assets?: { roots: { workflow: string; global: string }; declared: { skills: string[]; mcp: string[] }; workflow: string }; onHarness?: (h: HarnessDescriptor, applied?: EffortApplied) => Promise<void>; onEvent?: (ev: TranscriptEvent) => void | Promise<void>; caps?: Caps }, attempt = 1): Promise<GatewayResult> {
    // issue #24/#22: per-call AgentOpts.timeoutMs overrides the configured default (both directions);
    // MUST match invoke()'s attempts calc above so a bounded attempt count never pairs with an
    // unbounded timer (or vice-versa). resolveTimeout rejects a bad value → gateway default applies.
    const timeoutMs = resolveTimeout(req.opts.timeoutMs) ?? this._config.timeoutMs;
    // D-F10(c): the controller must exist BEFORE query() is called and be handed to the SDK's own
    // documented cancellation hook (Options.abortController, sdk.d.ts:1275) — otherwise aborting it
    // only resolves this class's own local await-race while the real spawned `claude` CLI
    // subprocess keeps running unbounded (Gate 7.5 round 4's real repro).
    // v26 (DES-171, ARCH-111): created UNCONDITIONALLY (not only when a timeout/signal is
    // configured) and always aborted once the call settles (see the `finally` below) — this is
    // v26's reactive tool-liveness answer: a slot/host semaphore frees in seconds instead of
    // waiting out `timeoutMs × (1+retries)` on every call, timed or not.
    const controller = new AbortController();
    const timer = timeoutMs !== undefined ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    const onExternalAbort = () => controller.abort();
    req.signal?.addEventListener('abort', onExternalAbort, { once: true });

    // D-F11: caller-supplied opts.allowedTools wins; else the configured default core set; else a
    // built-in minimal core set — never left unset (see BUILT_IN_CORE_TOOLS above).
    // v25 (#55): declared field, not a cast — the SECOND site the work order did not name and the
    // one that decides what the session actually gets. `[]` is honoured (`??`, not `||`): an empty
    // surface is a real answer, not an absent one.
    const baseTools =
      req.opts.allowedTools ??
      this._config.defaultAllowedTools ??
      BUILT_IN_CORE_TOOLS;
    // v26 (DES-173, ARCH-112, TASK-174, REQ-123): per-provider tool curation is RETIRED — every
    // remaining provider (anthropic/openrouter/ollama) gets `baseTools` verbatim (no Read dropped,
    // no Bash force-added). The `curateToolsForProvider` special-case existed only for `openai`
    // (gpt-4.1's PDF-schema `Read` bug via LiteLLM's translation), which is gone with the provider.
    const curatedTools = baseTools;

    // v24 (ARCH-103/DES-154, TASK-145): a known run workspace + a known `req.assets` (this call's
    // label declared skill/mcp names + the asset store's two scope roots, threaded by the executor
    // from that label's registered AgentParamSpec) gets ONLY its declared skills materialized into
    // `.claude/skills/<name>/`, loaded via `settingSources:['project']`, `cwd` re-scoped to THAT
    // workspace — host-level sources ('user'/'local') stay excluded either way (D-F11 isolation).
    // No workspace / no `req.assets` (e.g. a direct unit-tier invoke(), or the direct-fetch gateway,
    // which never sets `req.assets` at all — DES-154's boundary) -> nothing materialized, the
    // executor's decoration site reports the honest empty set (DES-160).
    // `.mcp.json` is REWRITTEN by `materializeAssets` itself; `strictMcpConfig: true` below still
    // needs the SAME resolved configs on `options.mcpServers` (a project `.mcp.json` is not read
    // once `strictMcpConfig` is set) — resolved ONCE here and threaded into both.
    let materialized: { skills: string[]; mcp: string[]; missing: string[] } | undefined;
    let mcpConfigs: Record<string, McpServerConfig> = {};
    let mcpMissing: string[] = [];
    if (req.workspace !== undefined && req.assets !== undefined) {
      const mcpResolved = await this._resolveMcpConfigs(req.assets.workflow, req.assets.declared.mcp);
      mcpConfigs = mcpResolved.configs;
      mcpMissing = mcpResolved.missing;
      materialized = await materializeAssets(req.assets.roots, req.workspace, req.assets.declared, async () => mcpResolved);
    }
    const mcpServers = Object.keys(mcpConfigs).length > 0 ? mcpConfigs : undefined;

    // REQ-037: provider-aware routing. An alias whose provider is `anthropic` dispatches DIRECT to
    // the real Anthropic API (LiteLLM bypassed) — so its env carries the real auth AND its model
    // name must be the REAL Anthropic id (`target.model`), not the proxy-cloaked `rwe-proxy-*` name
    // the LiteLLM path needs. Every other provider keeps the proxy path (dummy key + proxyModelName).
    const provider = effectiveProvider(this._config.aliases, req.opts.model);
    // v26 (DES-179, ARCH-117, TASK-179): computed ONCE per invoke, inside the gateway (the provider
    // is only resolvable here) — the SAME `wireEffort` result travels to onHarness AND (below) onto
    // BOTH `options.thinking` and `options.effort`; `wireEffort` is now the sole writer of each.
    // `req.caps` is the run's admission-time pin (ARCH-116) when the executor threads one; absent ->
    // UNKNOWN_CAPS, the documented fail-safe branch (byte-identical to the retired alias-aware
    // `resolveThinkingMode`, see UNKNOWN_CAPS's own doc comment).
    const wired = wireEffort(provider as Provider | undefined, req.caps ?? UNKNOWN_CAPS, req.opts.effort);
    const applied: EffortApplied = wired.applied;
    const anthropicTarget = provider === 'anthropic' && req.opts.model !== undefined ? this._config.aliases?.[req.opts.model] : undefined;
    // REQ-038: a passthrough `openrouter/<id>` goes on the wire RAW (matches LiteLLM's `openrouter/*`
    // wildcard); anthropic-direct uses the real id; every other case keeps the `rwe-proxy-*` cloak.
    const modelName = anthropicTarget
      ? anthropicTarget.model
      : isPassthroughModel(req.opts.model)
        ? req.opts.model
        : proxyModelName(req.opts.model ?? 'default');
    // v26 (DES-177, ARCH-115, TASK-177, REQ-125): the RESOLVED model id this call actually reached —
    // never the alias, never the `rwe-proxy-*` cloak `modelName` puts on the wire. An anthropic-direct
    // or passthrough dispatch already has the resolved id in `modelName`; every other alias resolves
    // through the SAME alias table `anthropicTarget` reads above, just unconditional on provider.
    const aliasTarget = req.opts.model !== undefined ? this._config.aliases?.[req.opts.model] : undefined;
    const resolvedModel = aliasTarget?.model ?? modelName;
    // v26 (DES-177): the proxy-facing cloak is reportable only when one was actually put on the wire
    // (the LiteLLM-proxy route) — absent on an anthropic-direct dispatch and on a raw passthrough
    // (sent verbatim, no cloak to report).
    const proxyModel = anthropicTarget === undefined && !isPassthroughModel(req.opts.model) ? modelName : undefined;
    // v26 (DES-177): one stamping seam for every GatewayResult this call can produce (`_drain`'s
    // internal returns included, via `enrich(outcome)` below) — `provider` becomes the RESOLVED
    // provider (never the transport name `_drain`/the early-exit literals below still hard-code) and
    // `transport` names the wire; `model`/`proxyModel` are corrected only on the ok:true arm, where a
    // resolved model exists.
    const stamp = (r: GatewayResult): GatewayResult =>
      r.ok
        ? { ...r, provider: provider ?? r.provider, transport: 'claude-agent-sdk', model: resolvedModel, ...(proxyModel !== undefined ? { proxyModel } : {}) }
        : { ...r, provider: provider ?? r.provider, transport: 'claude-agent-sdk' };
    const envResult = buildSubprocessEnv(this._config, provider);
    if (!envResult.ok) {
      // A missing real key/oauth token for the chosen Anthropic auth mode is a typed terminal
      // failure — never a silent attempt with the dummy key against the real Anthropic API.
      return stamp({ ok: false, provider: 'claude-agent-sdk', reason: 'terminal', detail: envResult.detail });
    }

    // v37 (DES-257, ARCH-180, TASK-253, REQ-219): REQ-021's intra-run re-walk, wired for the first
    // time — only runnable when BOTH a workspace and a known workRoot are on this call; an unknown
    // workRoot (no `confinement` block configured) SKIPS the re-walk rather than fail-open OR
    // fail-closed on a missing config (DES-257's sixth arm). Pinned order: auth/env resolution
    // (above) → this refusal → buildBashConfinement() → emit agent.confinement → query() (below).
    if (req.workspace !== undefined && this._config.confinement?.workRoot !== undefined) {
      const offender = findProjectMarkerAboveWorkspace(req.workspace, this._config.confinement.workRoot);
      if (offender !== null) {
        return stamp({
          ok: false,
          provider: 'claude-agent-sdk',
          reason: 'terminal',
          retryable: false,
          // `offender` is either an ancestor carrying a project marker (the walk found one between
          // the workspace and workRoot) OR the workspace's own real path (it resolved outside
          // workRoot entirely, e.g. a symlink) — the two cases share one refusal, so the wording
          // below stays neutral rather than misnaming a containment failure as a "marker".
          detail: `${WORKROOT_INSIDE_PROJECT}: ${offender} is outside workRoot or carries a project marker between the run workspace and workRoot`,
        });
      }
    }

    // v37 (ARCH-175/176/181, DES-252/253/262, TASK-251/253, REQ-218, ADR-083 owner_decision posture
    // C): the confinement posture decides WHETHER the sandbox is even attempted — never what it
    // contains (that is `buildBashConfinement()`'s own, unaffected, contract).
    // **`'unconfined'` is the DEFAULT when `confinementPosture` is omitted** — found the hard way,
    // by running the real suite: an earlier draft of this line defaulted to `'confined'`, which broke
    // every real-CLI-spawning integration/acceptance test that constructs this class directly without
    // going through `main.ts`'s probe (`val-023-sdk-gateway-timeout.test.ts` and its siblings) — on
    // THIS host `sandbox.enabled:true` fails at CLI startup (`num_turns:0`, before any tool call), so
    // those tests stopped testing what they were written to test and instead universally hit
    // `SANDBOX_UNAVAILABLE`. `'unconfined'` is also the philosophically correct default for this
    // iteration's own thesis — "never claim confinement without evidence" applies to the CALLER too:
    // a construction that never asked the boot-time nested-userns question has no evidence to attempt
    // one. Only `main.ts`'s real boot probe (ARCH-181) ever sets `'confined'` explicitly, from a real
    // measurement. `'confined'` (set explicitly, e.g. by a real-tier test that wants to exercise the
    // actually-confined arm — see `bash-confinement-wiring.test.ts`/`val-253`): the full posture is
    // built and handed to the kernel, `failIfUnavailable:true`. `'unconfined'`: `buildBashConfinement()`
    // is not even called — a host/caller with no evidence a sandbox works is not asked to try one, for
    // ANY run (the owner's accepted cost: a locally-submitted run is still unconfined; REQ-218's
    // remote-submission door, call-tool.ts, is the control that actually closes for this posture —
    // this class has no notion of "remote").
    const confinementRoot = req.workspace ?? this._config.cwd;
    const sandbox: Options['sandbox'] =
      this._config.confinementPosture === 'confined'
        ? buildBashConfinement({
            root: confinementRoot,
            grantedHostPaths: this._config.confinement?.allowHostPaths ?? [],
            protectedFiles: this._config.confinement?.protectedFiles ?? [],
            workRoot: this._config.confinement?.workRoot,
            denyReadMode: DENY_READ_MODE,
          })
        : { enabled: false };

    const options: Options = {
      cwd: req.workspace ?? this._config.cwd,
      sandbox,
      // REQ-037: an anthropic-direct call names the REAL Anthropic model id (LiteLLM bypassed);
      // every other provider is routed via the proxy-facing alias name (see proxyModelName) — the
      // CLI would otherwise expand a bare shorthand like `haiku` to a dated Anthropic id the LiteLLM
      // proxy has no entry for (0-token `terminal`). An absent model resolves to `default`.
      model: modelName,
      thinking: wired.thinking,
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
      // v37 (REQ-218, ARCH-176): the warning is correct and BY DESIGN, not a defect to silence — it
      // is harmless under this posture because the decision it skips (`canUseTool`) was never Bash's
      // last line of defence anyway: for Read/Write/Edit/Glob/Grep/NotebookEdit the `PreToolUse`
      // hook right below picks up exactly what the shadowed callback would have decided (same
      // `toolUsePreCheck`); for Bash the last line of defence is the kernel (`bash-confinement.ts`,
      // when the boot posture is confined) or, on a host where it is not, the remote-submission door
      // (`call-tool.ts`) that refused this call before any of this ever ran — never `canUseTool`,
      // shadowed or not.
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
      // D-G8-5/REQ-037: an explicit allowlist plus the provider-aware routing/auth vars — never the
      // full host process.env (see buildSubprocessEnv). Resolved above so an auth-missing anthropic
      // call fails typed BEFORE query() is ever spawned.
      env: envResult.env,
    };
    // v26 (DES-179, ARCH-117, TASK-179): `wireEffort` already resolved the flat `Options.effort`
    // field alongside `thinking` above — set only when it actually applies (the anthropic arm).
    if (wired.effort !== undefined) options.effort = wired.effort;
    // v37 (ARCH-178, DES-256, TASK-253, REQ-218): the policy applied is OUR data, so it is
    // unconditional — emitted from `sandbox`, the object the builder above JUST returned, never
    // re-derived. Once per ATTEMPT (the `attempt` param threaded from `invoke()`'s retry loop, NOT
    // `sys.attempt` — the CLI's own internal backoff, read inside `_drain`). A call that is refused
    // before reaching here (this class has no such refusal path today) would emit ZERO lines — "a
    // posture printed for a session that never ran is a nerve attached to nothing".
    this._eventSink({
      kind: 'agent.confinement',
      runId: req.runId,
      agentId: req.agentId,
      attempt,
      // v37 Gate 6.5+7 fix (verifier, ARCH-176's own "two different reasons must not read the
      // same" bug class): MIRRORS the `sandbox` ternary two statements above, not an independent
      // reading of the same field — an earlier draft read this backwards (`=== 'unconfined' ?
      // 'unconfined' : 'confined'`, so an OMITTED `confinementPosture` reported `posture:'confined'`
      // on an event whose OWN `sandbox` was simultaneously `{enabled:false}` — the exact mismatch
      // this iteration exists to make impossible, caught by the TZ-shift regression's own log
      // output, not by UT-316/317 (both pass an explicit posture).
      posture: this._config.confinementPosture === 'confined' ? 'confined' : 'unconfined',
      root: confinementRoot,
      allowWrite: sandbox?.filesystem?.allowWrite ?? [],
      denyRead: sandbox?.filesystem?.denyRead ?? [],
      enabled: sandbox?.enabled === true,
      failIfUnavailable: sandbox?.failIfUnavailable === true,
      sdkVersion: SDK_VERSION,
    });
    // DES-066 (TASK-069): emit harness descriptor eagerly at session-build time (post-curation, before query).
    if (req.onHarness) {
      const descriptor = redactHarness({
        surfaceType: 'curated',
        // v26 integration (DES-177, REQ-125, clarification 26): the RESOLVED model id, not
        // `modelName` (which is the `rwe-proxy-*` cloak on the LiteLLM route). The cloak travels
        // beside it as `proxyModel`, exactly as it already does on `GatewayResult` via `stamp()`
        // above — same two values, same two names, on both objects the record is built from.
        modelName: resolvedModel,
        ...(proxyModel !== undefined ? { proxyModel } : {}),
        provider,
        prompt: req.prompt,
        curatedTools,
        mergedMcp: Object.entries(mcpConfigs).map(([name, cfg]) => ({ name, ...(cfg as Record<string, unknown>) })),
        // v24 (ARCH-103, DES-160, TASK-145): the ACTUAL materialized skill set, not "every stored
        // skill" — a declared-but-absent name is in `materialized.missing`, never silently dropped.
        skills: materialized?.skills ?? [],
        // v22 (REQ-099, adjudication #4 N-1): a referenced-but-unprovisioned MCP is dropped from the
        // session (unchanged) — but the descriptor now admits to it, so `workflow_agent_log` shows
        // the author which capability their grandfathered workflow lost. Same honest-no-op record as
        // `effortApplied`'s `{reason}` branch; empty ⇒ the field is not emitted at all.
        unresolvedMcp: mcpMissing,
      });
      // v24 (ARCH-104/DES-160, TASK-145): the materialized set rides the descriptor itself (the ONE
      // decoration site downstream, `agent-executor.ts`, fills the honest empty set for a dispatch
      // that never sets `req.assets` at all — e.g. the direct-fetch gateway).
      if (materialized) descriptor.materialized = materialized;
      // `applied` travels to the caller as onHarness's own second argument (the single source of
      // truth downstream decoration reads) — no separate write onto `descriptor` needed here.
      // v26 (DES-179): `wireEffort.applied` is ALWAYS present (its own doc comment), but the
      // PERSISTED `effortApplied` field's presence still means "an effort was actually requested"
      // (agent-executor.ts:492's `applied !== undefined` gate) — unchanged from v25 and matching the
      // direct-fetch gateway's own `req.opts.effort !== undefined` gate in `LiteLLMGatewayClient.invoke`
      // (client.ts), which still passes `undefined` here for the same reason. Passing
      // `wired.applied` unconditionally would silently add `effortApplied:{reason:'no effort
      // requested'}` to EVERY SDK-gateway record, a persisted-shape change no DES asked for.
      await req.onHarness(descriptor, req.opts.effort !== undefined ? applied : undefined);
    }
    const session = this._query({ prompt: req.prompt, options });
    const drain = this._drain(session, req.opts.model, req.onEvent);

    // issue #22: name the culprit on any failure that lacks its own detail — so a timeout/unreachable
    // is diagnosable ("which alias→model?") instead of an opaque reason. modelName is the resolved
    // wire model; provider is the resolved backend. A success or an already-detailed failure is
    // returned unchanged.
    const namedDetail = (reason: string): string => `no response from model "${modelName}" (provider "${provider}") — ${reason}`;
    const enrich = (r: GatewayResult): GatewayResult => (!r.ok && r.detail === undefined ? { ...r, detail: namedDetail(r.reason) } : r);

    // D-F7/D-F9a: race the session against a timeoutMs-bounded timer and/or the caller's own
    // (RunManager-owned) AbortSignal — whichever fires first wins, exactly like
    // LiteLLMGatewayClient's per-attempt AbortController race. Raced unconditionally now that the
    // controller always exists (v26) — `bound` simply never resolves when neither a timer nor an
    // external signal is configured, so `drain` alone decides the outcome, unchanged.
    const bound = new Promise<'aborted'>((resolve) => {
      controller.signal.addEventListener('abort', () => resolve('aborted'), { once: true });
    });

    try {
      const outcome = await Promise.race([drain, bound]);
      if (outcome !== 'aborted') return stamp(enrich(outcome));
      const reason = timeoutMs !== undefined ? 'timeout' : 'terminal';
      return stamp({ ok: false, provider: 'claude-agent-sdk', reason, detail: namedDetail(reason) });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      req.signal?.removeEventListener('abort', onExternalAbort);
      // v26 (DES-171): abort AFTER the race has settled (never inside `_drain`, which would let
      // the timeout arm win and misreport `reason:'timeout'` for a call that actually completed) —
      // idempotent (a no-op if already aborted by the timer/external signal above).
      controller.abort();
    }
  }

  /** Reads a session's own async-generator agent loop to its 'result' message (or natural end).
   *  D-G8-2: every intermediate message/tool_call/tool_result turn along the way is captured (in
   *  order) into the returned GatewayResult.events, not just the final result — the real
   *  reasoning/tool-call trace `workflow_agent_log` is built to show. */
  private async _drain(session: ReturnType<QueryImpl>, model: string | undefined, onEvent?: (ev: TranscriptEvent) => void | Promise<void>): Promise<GatewayResult> {
    const events: TranscriptEvent[] = [];
    // v26 (DES-171, ARCH-111): unmapped `system` subtypes observed this call — counted, never
    // their payload (see BENIGN_SYSTEM_SUBTYPES/sanitizeSubtype above).
    const unmapped: string[] = [];
    // issue #20: when a live-event sink is provided, STREAM each transcript event as it arrives (so
    // agent_log grows + lastActivityAt advances mid-call) and DON'T also return them in the result —
    // capture() would otherwise re-emit the same events at terminal (duplicates). No sink → unchanged
    // legacy behavior: accumulate and return events for capture() to emit once at the end.
    const streaming = onEvent !== undefined;
    try {
      for await (const msg of session as AsyncIterable<SDKMessage>) {
        if (msg.type === 'system') {
          const sys = msg as unknown as {
            subtype?: string; error?: string; error_status?: number | null; attempt?: number;
            max_retries?: number; retry_delay_ms?: number;
          };
          if (sys.subtype === 'api_retry') {
            const kind = sys.error ?? 'unknown';
            const status = sys.error_status ?? null;
            const attempt = sys.attempt ?? 0;
            if (classifyApiError(kind, status) === 'retry') {
              // A scalar retry event (five fields plus the free delay; no provider prose) — the
              // CLI's own backoff continues, this attempt is NOT over.
              const ev: TranscriptEvent = {
                ts: new Date().toISOString(), kind: 'message', // det:allow — transcript timestamp
                data: { type: 'api_retry', status, kind, attempt, max_retries: sys.max_retries, retry_delay_ms: sys.retry_delay_ms },
              };
              if (streaming) { await onEvent!(ev); } else { events.push(ev); }
              continue;
            }
            // Terminal: end the attempt NOW, instead of waiting out the rest of `timeoutMs` for a
            // `result` that will never come — the ONE error event for this call (D-G8-2's
            // duplicate trap: never both streamed AND accumulated).
            // v26 (DES-171, clarification 11; H-3 send-back repair, INV-V26-5): UNCAPPED here on
            // purpose — the 1024-byte SIZE bound used to be applied at THIS build-time site, before
            // `capture()`/`_emit`'s `redact()` sweep ever saw the string, so a secret straddling the
            // seam was cut in half and `redact()`'s value-exact match failed on both fragments. The
            // cap now runs AFTER redaction, at each persist site (`agent-executor.ts`'s `capDetail`).
            const detail = `${kind}${status !== null ? ` (status ${status})` : ''} — provider ended the attempt (attempt ${attempt})`;
            const errEv: TranscriptEvent = { ts: new Date().toISOString(), kind: 'message', data: { type: 'error', detail, status, kind, attempt } }; // det:allow — transcript timestamp
            if (streaming) { await onEvent!(errEv); } else { events.push(errEv); }
            return { ok: false, provider: 'claude-agent-sdk', reason: 'terminal', retryable: false, detail, error: { kind, status, attempt }, events, unmapped };
          }
          // Every other `system` subtype is COUNTED (never its payload) unless it's routine
          // control-plane chatter — includes any subtype a future SDK adds, the safe default.
          if (!BENIGN_SYSTEM_SUBTYPES.has(sys.subtype ?? '')) unmapped.push(sanitizeSubtype(sys.subtype));
          continue;
        }
        if (msg.type !== 'result') {
          const evs = extractEvents(msg, new Date().toISOString()); // det:allow — transcript timestamp, not a decision
          if (streaming) { for (const ev of evs) await onEvent!(ev); }
          else { events.push(...evs); }
          continue;
        }
        if (msg.subtype !== 'success' || msg.is_error) {
          const m = msg as unknown as { subtype?: string; result?: string; error?: string };
          // v26 (H-3 send-back repair): same UNCAPPED-here reasoning as the `api_retry` branch above.
          const detail = [m.subtype, m.result ?? m.error].filter(Boolean).join(': ') || 'error';
          const errEv: TranscriptEvent = { ts: new Date().toISOString(), kind: 'message', data: { type: 'error', detail } }; // det:allow — transcript timestamp
          if (streaming) { await onEvent!(errEv); } else { events.push(errEv); }
          return { ok: false, provider: 'claude-agent-sdk', reason: 'terminal', detail, events, unmapped };
        }
        return {
          ok: true,
          provider: 'claude-agent-sdk',
          model: model ?? 'default',
          tokens: extractTokens(msg, unmapped),
          content: msg.result,
          events,
          unmapped,
        };
      }
      // Session ended without ever emitting a result message.
      return { ok: false, provider: 'claude-agent-sdk', reason: 'unreachable', unmapped };
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      // v37 (DES-259, ADR-083, TASK-253, REQ-218): a sandbox that cannot start THROWS on the async
      // iterator (TASK-250's S10 — real, on-host measurement) rather than yielding an ordinary
      // `result` message: `subtype:"error_during_execution"`, `errors:[...]`, `num_turns:0`, and the
      // thrown `.message` is `"Claude Code returned an error result: " + errors[0]`, whose own text
      // starts with the stable, literal prefix `"Sandbox required but unavailable: "` (S10's own
      // contrastive comparison against an ordinary terminal failure — different `subtype`, different
      // detail field, different thrown-message prefix). `retryable:false` — a retry cannot install a
      // working nested user namespace. This detection is unconditional (never gated on
      // `confinementPosture`): if it fires under the 'unconfined' posture at all (this class's own
      // `sandbox:{enabled:false}` object should never provoke it), labelling it accurately is still
      // correct, never a regression.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Sandbox required but unavailable')) {
        return { ok: false, provider: 'claude-agent-sdk', reason: 'terminal', retryable: false, detail: `${SANDBOX_UNAVAILABLE}: ${msg}`, unmapped };
      }
      return { ok: false, provider: 'claude-agent-sdk', reason: timedOut ? 'timeout' : 'unreachable', unmapped };
    }
  }
}

// v37 (DES-259, ADR-083, TASK-253, REQ-218): exported ONCE — the exact literal ADR-083's revisit
// trigger quotes ("an operator reports a run refused for `sandbox unavailable`"). A drift-lock UT
// pins this string; a rename on either side must break it, never silently diverge.
export const SANDBOX_UNAVAILABLE = 'sandbox unavailable';
