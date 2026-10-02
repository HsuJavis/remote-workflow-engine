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
import type { CanUseTool, HookCallback, Options, SDKMessage, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, readdirSync, statSync, mkdirSync, mkdtempSync, rmSync, copyFileSync, readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, isAbsolute, dirname } from 'node:path';
import { createRequire } from 'node:module';
import type { AgentOpts, Caps, HarnessDescriptor, HarnessWarning, McpServerStatus, TranscriptEvent, Tokens } from '../types.js';
import { ZERO_TOKENS } from '../run-guard.js';
import { redactHarness } from '../agent-executor.js';
import type { McpServerConfig } from '../mcp-probe.js';
import type { EffortApplied, GatewayClient, GatewayResult } from './client.js';
import { resolveTimeout, wireEffort, UNKNOWN_CAPS, attemptsFor } from './client.js';
import { parseModelRef, type Provider } from '../providers.js';
import { isPathContained } from '../path-containment.js';
import { resolveConfig, type SecretSource } from '../secret-resolver.js';
import { resolveRunPlaceholders, mcpStateDir, workflowFolderOfWorkspace } from '../mcp-run-state.js';
import { buildBashConfinement, readonlyBashRefusal, CLI_SCRATCH_DIR, cliScratchRefusal, sharedCliScratch } from './bash-confinement.js';
import { prepareReadonlyMountTargets, protectedConfigTarget, sweepPlantedConfig } from './project-config-guard.js';
import { findProjectMarkerAboveWorkspace, WORKROOT_INSIDE_PROJECT } from '../workroot-guard.js';
import { RealCliLifecycle } from '../cli-lifecycle.js';
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
   *  not by gap). v37 Gate-8 send-back (finding A2): `workRoot` is `string | undefined` — since
   *  `composeConfig()` now forwards this block UNCONDITIONALLY (never gated on `workRoot` having
   *  been explicitly set), the field itself can no longer promise a non-empty string. Every reader
   *  already narrows via `?.`/`??` (see `:705`, `:747-749`), so this loosening changes no downstream
   *  behavior — it only lets the composition root stop omitting the whole block. */
  /** Issue #101: `homeDir` (denied for reads as a whole) and `allowReadPaths` (read-only re-opens:
   *  the derived home-resident toolchain + `sandbox.allowReadPaths`) are resolved by composeConfig();
   *  `homeDir` omitted -> `process.env.HOME` (the CLI subprocess's own HOME); `allowReadPaths`
   *  omitted -> `[]` (a direct construction gets no toolchain re-open, never a weaker home deny). */
  confinement?: { allowHostPaths: readonly string[]; protectedFiles: readonly string[]; workRoot: string | undefined; homeDir?: string; allowReadPaths?: readonly string[] };
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
}

const REAL_FS: AssetFsFacade = {
  exists: existsSync,
  copyDir: copyDirRecursive,
};

/** v24 (ARCH-103/DES-154, TASK-145): SELECTIVE materialization — REPLACES the old copy-every-
 *  stored-asset loop (`materializeAssets(assetRoot, workspace)`, no `declared` set at all, every
 *  run got every author's skill). Copies ONLY `declared.skills` into
 *  `<workspace>/.claude/skills/<name>/` (workflow scope wins a name clash with global — checked
 *  first); a name absent from BOTH roots lands in `missing` and the run proceeds (owner 19.5.3 — no
 *  refusal). `resolveMcp(declared.mcp)`'s resolved configs (secrets already substituted) are
 *  returned to the caller for `options.mcpServers` ONLY — **issue #128**: nothing is ever written
 *  to `<workspace>/.mcp.json` any more. That file used to be REWRITTEN here (never merged) on every
 *  dispatch; it was pure belt-and-suspenders (the CLI never loads a project `.mcp.json` once
 *  `strictMcpConfig:true` is set — see `_invokeOnce` below) and the belt was itself a leak: any
 *  runner of the SAME run could `workspace_pull({path:'.mcp.json'})` an admin-pushed global
 *  server's resolved `command`/`args`/`env` — including a `${secret:NAME}` handle's real value —
 *  straight out of the workspace. Pure over the injected `fs` facade (unit tier: a fake;
 *  production: `REAL_FS`, the default) — now used for skill materialization only. */
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
 *  all: such a run's Bash is genuinely unconfined (ADR-083 owner_decision posture C, the accepted
 *  cost — narrowed by v37 P1, see below). **[更正 2026-09-25, Gate 8 round-5 finding R5-F3]**
 *  ~~and only a REMOTE submission is refused outright~~ — that has not been true since ADR-086's
 *  third owner ruling: on an unconfined host a run is refused when it is a remote submission
 *  (`call-tool.ts`'s door), OR its trigger was created remotely, OR the version it resolves to was
 *  registered remotely — the last of which refuses a LOCAL `run_start` too. So the accepted cost
 *  now covers only a local submission OF A LOCALLY-REGISTERED version, and `call-tool.ts`'s door is
 *  one of three controls, not the only one (`admissionRefusal()` in `run-manager.ts` is the others).
 *  The stale version of this very docblock is what `src/main.ts` names as the reason this iteration
 *  exists, so leaving it stale would be the same defect twice. Web egress (WebFetch/WebSearch) and sub-agent spawning (Task/Agent) stay
 *  OUT of the default (opt-in via an explicit per-call `allowedTools`) — they break workspace
 *  confinement / the engine's own orchestration+DOS model respectively, in EITHER posture. */
const BUILT_IN_CORE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'];

/** issue #53: the result of an attempt refused because the caller's signal was already aborted —
 *  nothing was dispatched. `retryable:false` so no retry loop ever re-attempts it. */
function abortedBeforeDispatch(): GatewayResult {
  return { ok: false, provider: 'claude-agent-sdk', transport: 'claude-agent-sdk', reason: 'terminal', retryable: false, detail: 'aborted by caller before dispatch (run suspended or stopped)' };
}

/** v26 (DES-173, ARCH-112, TASK-174, REQ-123) — 2026-09-26 (alias mechanism removed): the effective
 *  provider for routing is now just the parsed prefix of the full `<provider>/<model-id>` ref
 *  (`providers.ts`'s `parseModelRef`) — no alias table to resolve through any more. All three
 *  providers get the caller's `allowedTools` verbatim (REQ-123 retires per-provider tool curation
 *  outright) — this is used only for auth/wire routing (thinking policy, effort, anthropic-direct
 *  dispatch), never tool curation. `undefined` for a malformed ref (admission already refuses one
 *  before dispatch; this is the defensive fail-safe, same as before). */
export function effectiveProvider(model: string | undefined): string | undefined {
  return model !== undefined ? parseModelRef(model)?.provider : undefined;
}

/** issue #129(b): wraps a freshly-spawned, DETACHED CLI child so BOTH an explicit `.kill()` call
 *  and the child's own natural exit reap the WHOLE process group — a bare `child.kill()` (the
 *  SDK's own default spawn behavior, `spawnLocalProcess`) only signals the direct child, orphaning
 *  every stdio-MCP grandchild that CLI session spawned (the real-repro shape: "10 stray processes
 *  on a throwaway engine" after a run finished). Reuses `cli-lifecycle.ts`'s
 *  `RealCliLifecycle.killGroup` (DES-029, TASK-037 — SIGTERM now, SIGKILL after its own grace
 *  period if still alive) rather than a second hand-rolled escalation.
 *
 *  Two trigger points, both needed:
 *   - `kill(signal)`: the SDK's OWN `close()` (stdin EOF -> ~2s grace -> `process.kill()`) calls
 *     `.kill()` on exactly the object this function returns (it IS `this.process`), so wiring
 *     THIS method is enough to make that existing escalation reap the group — no SDK-internal
 *     change needed.
 *   - the child's `'exit'` event: covers the case `close()`'s own kill branch skips entirely — the
 *     CLI process exits ON ITS OWN (success or error) while a grandchild it spawned is still
 *     alive. Node's `kill(-pgid, …)` still reaches every surviving member of that process group
 *     even after the group's leader (this `child`) itself has already exited.
 *
 *  Exported so the escalation is unit-testable (a real detached process tree, no real `claude`
 *  CLI) without going through the full `_invokeOnce` dispatch plumbing. `child.pid` is always
 *  defined here in practice (the caller only wraps a child it just spawned successfully, before
 *  ever reading `.pid`); the `undefined` guard is defensive, never hit on a real spawn. */
export function wrapCliChildForGroupKill(child: ChildProcess, lifecycle: Pick<RealCliLifecycle, 'killGroup'>): SpawnedProcess {
  const reap = (): void => {
    if (child.pid === undefined) return;
    try {
      lifecycle.killGroup({ pid: child.pid });
    } catch {
      // group already gone — nothing to reap
    }
  };
  child.once('exit', reap);
  return {
    stdin: child.stdin!,
    stdout: child.stdout!,
    get killed() {
      return child.killed;
    },
    get exitCode() {
      return child.exitCode;
    },
    kill: (signal?: NodeJS.Signals) => {
      reap();
      return child.kill(signal);
    },
    on: child.on.bind(child) as SpawnedProcess['on'],
    once: child.once.bind(child) as SpawnedProcess['once'],
    off: child.off.bind(child) as SpawnedProcess['off'],
  };
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

/** Tools that only read. Every OTHER tool (Write/Edit/MultiEdit/NotebookEdit, and any tool a future
 *  CLI adds) is held to the project-configuration rule below — an allowlist, so a new writer is
 *  covered before anyone remembers to list it. */
const READ_ONLY_FILE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);

function toolUsePreCheck(root: string | undefined, candidates: string[], toolName: string): { behavior: 'allow' } | { behavior: 'deny'; message: string } {
  if (root === undefined) return { behavior: 'allow' }; // no workspace known → nothing to enforce
  for (const candidate of candidates) {
    if (!isInsideWorkspace(resolveAgainstWorkspace(candidate, root), root)) {
      // Issue #77: the SDK's own Write description says "must be absolute", so a model that only
      // hears "outside" keeps guessing absolute paths. Say where the workspace is and that a
      // relative path resolves inside it. The root is not new to the agent (it is its cwd, and a
      // successful file tool echoes absolute paths into the transcript). Scoped to the file tools'
      // path arguments on purpose: this hook is not Bash's confinement (see PATH_ARG_FIELDS).
      return {
        behavior: 'deny',
        message:
          `path outside run workspace: ${candidate}. File-tool paths (Read/Write/Edit/Glob/Grep/NotebookEdit) must resolve inside this run's workspace, ${root}. ` +
          'Use a relative path such as "out/result.txt": it resolves inside the workspace, even where a tool description asks for an absolute path.',
      };
    }
  }
  // The workspace is the CLI's project directory: configuration written here is loaded by the next
  // agent's CLI (hooks run commands, permissions/sandbox widen). See PROJECT_CONFIG_PATHS.
  if (!READ_ONLY_FILE_TOOLS.has(toolName)) {
    for (const candidate of candidates) {
      const hit = protectedConfigTarget(candidate, root);
      if (hit !== null) {
        return {
          behavior: 'deny',
          message:
            `PROJECT_CONFIG_PROTECTED: ${candidate} is ${hit} in this run's workspace — configuration the Claude CLI loads for every agent in this run ` +
            '(it can run commands or widen permissions), so no agent tool may create or change it. Write to a different path; reading it is allowed.',
        };
      }
    }
  }
  return { behavior: 'allow' };
}

// Issue #105 part B (HIGH): the SDK's own `PermissionResult` type (sdk.d.ts) marks `updatedInput`
// OPTIONAL on the allow branch, but the bundled CLI's own permission-response validator does not
// accept it missing — every allow response with no `updatedInput` fails there with
// `ZodError: … expected record, received undefined … path: ["updatedInput"]`, wrapped back as a
// failed tool_result. Built-in tools (Read/Write/Edit/Glob/Grep/Bash) are bare `allowedTools`
// entries (D-F11) and are auto-approved before `canUseTool` is ever consulted (the SDK's own
// `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning) — so this path was exercised by NOTHING before a
// dynamically-provisioned MCP tool (`workspace_push({kind:'mcp'})`) became reachable, and every
// such call failed the moment it reached this callback, unconditionally, allow or deny alike.
// `updatedInput: input` echoes the ORIGINAL args back unmodified — this hook only allows/denies,
// it never rewrites a tool call's arguments.
//
// This incidentally MASKED a separate gap: with every allow response rejected wholesale, an MCP
// tool call that would have targeted `.claude/settings.json`/`.claude/hooks/**` under an
// UNCONFINED Bash posture never got far enough to reach the `PROJECT_CONFIG_PROTECTED` guard
// below and prove it either way. Fixing the response shape does not close that gap by itself —
// `toolUsePreCheck`'s `protectedConfigTarget` scan only recognizes the generic `PATH_ARG_FIELDS`
// (`file_path`/`path`/`notebook_path`); an MCP tool whose own schema names its write target
// differently is not inspected by this hook at all (same known limitation `PATH_ARG_FIELDS`'s own
// docblock states for Bash). The deny branch is untouched — this only ever adds `updatedInput` to
// an ALREADY-DECIDED allow.
function makeCanUseTool(root: string | undefined): CanUseTool {
  return async (toolName, input, options) => {
    const decision = toolUsePreCheck(root, extractCandidatePaths(input as Record<string, unknown>, options.blockedPath), toolName);
    if (decision.behavior === 'deny') return decision;
    return { behavior: 'allow', updatedInput: input };
  };
}

/** D-V2G8-1(d) real-execution corollary (see makeCanUseTool above): a `PreToolUse` hook fires for
 *  EVERY tool call regardless of whether a bare `allowedTools` entry already auto-approved it —
 *  the SDK's own suggested mechanism for gating a call `canUseTool` alone cannot reach. */
function makePreToolUseHook(root: string | undefined): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const decision = toolUsePreCheck(root, extractCandidatePaths((input.tool_input ?? {}) as Record<string, unknown>), input.tool_name);
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

// send-back item 2 (verify-b, 2026-09-26): bound on the captured `Options.stderr` ring buffer — a
// startup crash loop or a chatty debug build must never grow this unbounded; "last 4KB" per the
// dispatch, enough to hold the CLI's own multi-line sandbox-dependency diagnostic in full.
const MAX_STDERR_TAIL = 4096;
// The SHORT tail folded into the agent's own recorded `detail` (agent-executor.ts's `capDetail`
// caps the WHOLE detail string to 1024B downstream anyway) — the full MAX_STDERR_TAIL buffer
// always travels separately via the `agent.stderr` EngineEvent for an operator reading the log.
const MAX_INLINE_STDERR = 300;

// D-G8-5: an explicit ALLOWLIST of host env vars the spawned `claude` CLI subprocess actually
// needs to run (find its own binaries, resolve $HOME-relative config/cache paths, respect the
// host's locale/shell) — never the full `process.env`, which would leak every unrelated host
// secret (OPENAI_API_KEY, cloud credentials, ...) straight into a subprocess this class's own
// header comment already promises never happens (D-R2 hermeticity).
const ENV_ALLOWLIST = ['PATH', 'HOME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM'];

/** Issue #106: a constant engine setting, never forwarded from the host. With it unset, the bundled
 *  CLI (2.1.199) enables "optimistic tool search" whenever ANTHROPIC_BASE_URL is the first-party
 *  api.anthropic.com — and in that mode it sends turn 1 WITHOUT waiting for stdio MCP servers to
 *  connect, expecting to announce their tools later through ToolSearch. This class always passes an
 *  explicit `tools` list that never contains ToolSearch, so tool search is then disabled anyway and
 *  the MCP tools simply arrive late (turn 2+): a single-turn agent never saw them at all. `false` is
 *  the CLI's own "standard" mode: it waits for MCP before turn 1 and never defers a tool. (Every
 *  provider gets it: the explicit `tools` list is the same on every route.) */
const ENABLE_TOOL_SEARCH = 'false';

/** Issue #106: MCP-status bounds for the harness record — the init tool list is CLI-authored but its
 *  MCP tool names come from the server, so both the count and each name are capped. */
const MAX_MCP_TOOLS_RECORDED = 64;
const MAX_MCP_NAME_CHARS = 128;

/** Issue #106: turns the session's `system/init` message into the per-server record the harness
 *  carries, plus a `MCP_SERVER_NOT_CONNECTED` warning for each declared server the model could not
 *  use on its first turn — not `connected`, or none of its `mcp__<server>__*` tools in the init tool
 *  list (a server that only offers resources/prompts trips the second arm too; the message says
 *  so). `declared` is the servers actually handed to the CLI (`options.mcpServers`). */
export function summarizeMcpInit(declared: string[], init: { tools?: unknown; mcp_servers?: unknown }): { mcpStatus: McpServerStatus[]; warnings: HarnessWarning[] } {
  const initTools = Array.isArray(init.tools) ? init.tools.filter((t): t is string => typeof t === 'string') : [];
  const servers = Array.isArray(init.mcp_servers) ? (init.mcp_servers as Array<{ name?: unknown; status?: unknown }>) : [];
  const mcpStatus: McpServerStatus[] = [];
  const warnings: HarnessWarning[] = [];
  for (const server of declared) {
    const entry = servers.find((s) => s?.name === server);
    const status = typeof entry?.status === 'string' ? entry.status.slice(0, 32) : 'absent';
    // The CLI builds tool names as mcp__<server>__<tool>, with characters outside [A-Za-z0-9_-]
    // in the server name replaced by `_`.
    const prefixes = [`mcp__${server}__`, `mcp__${server.replace(/[^A-Za-z0-9_-]/g, '_')}__`];
    const matched = initTools.filter((t) => prefixes.some((p) => t.startsWith(p)));
    const tools = matched.slice(0, MAX_MCP_TOOLS_RECORDED).map((t) => t.slice(0, MAX_MCP_NAME_CHARS));
    mcpStatus.push({ server, status, tools });
    if (status !== 'connected' || matched.length === 0) {
      warnings.push({
        code: 'MCP_SERVER_NOT_CONNECTED',
        server,
        status,
        message: status !== 'connected'
          ? `MCP server '${server}' was '${status}' when the session started — its tools were not available on the model's first turn`
          : `MCP server '${server}' connected but exposed no tools at session start (expected only for a server that offers resources/prompts and no tools)`,
      });
    }
  }
  return { mcpStatus, warnings };
}

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
  env['ENABLE_TOOL_SEARCH'] = ENABLE_TOOL_SEARCH;
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

/** Issue #101 (CLI scratch): points the CLI's whole scratch at `dir`. BOTH vars, same value — the
 *  CLI derives `<CLAUDE_CODE_TMPDIR>/claude-<uid>` and, when that is over 44 bytes, ALSO binds
 *  `<TMPDIR or /tmp>/claude-<uid>` writable (measured, docs/evidence/issue-101-cli-scratch.md);
 *  with TMPDIR equal the two collapse onto one per-dispatch path. Overrides the host TMPDIR the
 *  allowlist forwarded. */
export function withCliScratchEnv(env: Record<string, string>, dir: string): Record<string, string> {
  return { ...env, TMPDIR: dir, CLAUDE_CODE_TMPDIR: dir };
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

/** issue #127: `t1 + t2`, elementwise over the four columns — the one addition every accumulator
 *  below goes through, so "what counts as summing two token figures" cannot drift between call sites. */
function addTokens(t1: Tokens, t2: Tokens): Tokens {
  return { input: t1.input + t2.input, output: t1.output + t2.output, cacheRead: t1.cacheRead + t2.cacheRead, cacheWrite: t1.cacheWrite + t2.cacheWrite };
}

/** issue #127: the per-field MAX of two token figures for the SAME `message.id` — defensive dedup for
 *  a CLI build that ever re-emits a frame for an id already seen (never expected with
 *  `includePartialMessages` left unset/false, the one hard requirement this accumulator relies on —
 *  see `_drain`'s own doc). Never `addTokens`: two frames sharing an id describe the SAME turn, not
 *  two turns, so summing them would double-count it. */
function maxTokens(t1: Tokens, t2: Tokens): Tokens {
  return { input: Math.max(t1.input, t2.input), output: Math.max(t1.output, t2.output), cacheRead: Math.max(t1.cacheRead, t2.cacheRead), cacheWrite: Math.max(t1.cacheWrite, t2.cacheWrite) };
}

/** issue #127: reads the four usage columns off an arbitrary `{usage?: {...}}`-shaped object — the
 *  SAME snake_case field names `extractTokens` reads off a `result` message's own `usage` (a per-turn
 *  `SDKAssistantMessage.message.usage` is the identical `BetaUsage` shape upstream). `undefined` when
 *  there is no usage to read at all (never a fabricated zero — a message that never reports usage
 *  contributes nothing to the running sum, which is different from "reported zero usage"). */
function usageOf(u: Record<string, unknown> | undefined): Tokens | undefined {
  if (!u) return undefined;
  const input = u['input_tokens'];
  const output = u['output_tokens'];
  if (typeof input !== 'number' && typeof output !== 'number') return undefined;
  return {
    input: typeof input === 'number' ? input : 0,
    output: typeof output === 'number' ? output : 0,
    cacheRead: typeof u['cache_read_input_tokens'] === 'number' ? (u['cache_read_input_tokens'] as number) : 0,
    cacheWrite: typeof u['cache_creation_input_tokens'] === 'number' ? (u['cache_creation_input_tokens'] as number) : 0,
  };
}

/** issue #127: the live, per-attempt usage accumulator `_drain` folds every streamed
 *  `SDKAssistantMessage` through — keyed by `message.id` (per-field MAX on a repeat id, `maxTokens`'s
 *  own doc), summed across ids (`addTokens`) to answer "how much has this attempt spent SO FAR",
 *  called out to `onUsage` after every update so a caller has the latest figure even if it never
 *  learns how the attempt itself ends (an abandoned gateway Promise on `run_suspend`/`run_stop`). A
 *  thin stateful class rather than a closure so `_drain` can read `.total()` one more time at any of
 *  its own exit points without re-deriving it. */
class UsageAccumulator {
  private readonly _seen = new Map<string, Tokens>();
  constructor(private readonly _onUsage?: (cumulative: Tokens) => void) {}
  observe(id: string | undefined, u: Record<string, unknown> | undefined): void {
    const t = usageOf(u);
    if (id === undefined || t === undefined) return;
    const prev = this._seen.get(id);
    this._seen.set(id, prev ? maxTokens(prev, t) : t);
    // `_seen` just gained an entry (above), so `total()` is never undefined here.
    this._onUsage?.(this.total()!);
  }
  /** `undefined` when nothing was ever observed — distinct from "observed an all-zero usage", which
   *  `_drain`'s failure returns treat as a real (if unusual) measurement, not an absence. */
  total(): Tokens | undefined {
    if (this._seen.size === 0) return undefined;
    let t = ZERO_TOKENS;
    for (const v of this._seen.values()) t = addTokens(t, v);
    return t;
  }
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
  // issue #129(b): the CLI subprocess's own group-kill escalation (wrapCliChildForGroupKill below
  // consumes only its `killGroup` method) — one instance per gateway, stateless beyond the default
  // node:child_process/process.kill primitives it wraps.
  private readonly _cliLifecycle = new RealCliLifecycle({});

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
  /** issue #126 B: after `${secret:NAME}` substitution, also resolves `${run:dir}`/`${run:id}`
   *  (mcp-run-state.ts) against THIS run's own private state dir — `<workflowFolder>/mcp-state/
   *  <runId>/<server>/`, a SIBLING of the run workspace (never inside it, so it is invisible to
   *  `workspace_pull`/`workspace_list` and to the run's own confined Bash), derived structurally
   *  from `workspace` (never threaded as a new field — `workspace` is the one value every caller
   *  of this method already has). Created 0700 on first use, ONLY when the config actually
   *  references `${run:dir}` (`usedDir`) — a server that never asks for one never gets a directory.
   *  `mkdirSync({recursive:true})` is idempotent, so a second agent in the SAME run resolving the
   *  SAME server reuses the SAME directory without error — "persists across agents within a run,
   *  never across runs" falls out of the path alone (keyed by runId), no separate bookkeeping. */
  private async _resolveMcpConfigs(workflow: string, names: string[], runId: string, workspace: string): Promise<{ configs: Record<string, McpServerConfig>; missing: string[] }> {
    if (this._config.resolveMcp === undefined || names.length === 0) return { configs: {}, missing: names };
    const resolved = await this._config.resolveMcp(workflow, names);
    const workflowFolder = workflowFolderOfWorkspace(workspace);
    const out: Record<string, McpServerConfig> = {};
    for (const [name, config] of Object.entries(resolved.configs)) {
      try {
        const secretResolved = (this._config.secretSource !== undefined ? resolveConfig(config, this._config.secretSource) : config) as McpServerConfig;
        const stateDir = mcpStateDir(workflowFolder, runId, name);
        const { config: runResolved, usedDir } = resolveRunPlaceholders(secretResolved, { id: runId, dir: stateDir });
        if (usedDir) mkdirSync(stateDir, { recursive: true, mode: 0o700 });
        out[name] = runResolved as McpServerConfig;
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
    /** issue #127: live cumulative-usage callback — see `GatewayClient.invoke`'s own doc. Wrapped
     *  below (never forwarded raw) so the caller always sees the sum across every attempt, not just
     *  the attempt currently in flight. */
    onUsage?: (cumulative: Tokens) => void;
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
    // issue #127: usage carried forward from every FAILED attempt so far this call — folded into
    // whichever attempt finally settles it (success or exhausted retries alike). `carriedPartial`
    // propagates once any contributing attempt's own figure was itself an estimate (never cleared).
    let carried: Tokens = ZERO_TOKENS;
    let carriedPartial = false;
    for (let i = 0; i < attempts; i++) {
      // v37 (DES-256): `agent.confinement`'s own `attempt` counter — DISTINCT from `sys.attempt`
      // (the CLI's internal backoff, read inside `_drain`) — one per pass through THIS loop, so the
      // event's contract is "once per attempt", the claim a single "once per call" line could never
      // hold (the options literal, and the posture it carries, is rebuilt inside `_invokeOnce` on
      // every pass).
      // Review v035 L-1: snapshot `carried` per attempt (never read the mutable `carried` by
      // reference inside the closure) AND stop forwarding this attempt's `onUsage` once it has
      // settled. `_invokeOnce`'s race (`Promise.race([drain, bound])`) abandons rather than cancels
      // `drain` on a timeout/abort — the underlying session can keep streaming for a moment after
      // that race already decided the attempt's fate, and `controller.abort()` only runs in its
      // `finally`, AFTER the race settles. Without both guards, a superseded attempt's late frame
      // re-adds its own already-folded tokens a second time into whatever `req.onUsage` next reports
      // — exactly the figure `_finalizeAborted` (agent-executor.ts) could charge to the budget if
      // run_stop/run_suspend landed in that window.
      const base = carried;
      let settled = false;
      const attemptReq = req.onUsage === undefined ? req : {
        ...req,
        onUsage: (cum: Tokens) => {
          if (settled) return; // a late frame from an attempt this loop has already moved past
          req.onUsage!(addTokens(base, cum));
        },
      };
      last = await this._invokeOnce(attemptReq, i + 1);
      settled = true;
      if (last.ok) {
        const normalized: Tokens = { input: last.tokens.input, output: last.tokens.output, cacheRead: last.tokens.cacheRead ?? 0, cacheWrite: last.tokens.cacheWrite ?? 0 };
        const total = addTokens(carried, normalized);
        return carriedPartial ? { ...last, tokens: total, partial: true } : { ...last, tokens: total };
      }
      if (last.tokens) {
        carried = addTokens(carried, { input: last.tokens.input, output: last.tokens.output, cacheRead: last.tokens.cacheRead ?? 0, cacheWrite: last.tokens.cacheWrite ?? 0 });
        if (last.partial === true) carriedPartial = true;
      }
      // v26 (DES-171, ARCH-111, TASK-176, issue #65): a classifyApiError-terminal failure ends the
      // attempt immediately — retrying costs a full timeoutMs against a provider that already said
      // no. `retryable` is `false` on that classification; every other failure reason (absent
      // `retryable`) keeps retrying up to the configured bound, unchanged. v37 (DES-259, REQ-218)
      // adds a SECOND producer: `SANDBOX_UNAVAILABLE` (below) also sets `retryable:false` — a retry
      // cannot install a working nested user namespace.
      if (!last.ok && last.retryable === false) break;
      // issue #53: the caller aborted (run_suspend/run_stop) — no further attempt may start. The
      // discriminator is the caller's signal, never `reason`: an abort and a genuine timeout both
      // surface as `reason:'timeout'`, and only the latter may retry.
      if (req.signal?.aborted) break;
    }
    // issue #127: `carried` already includes `last`'s own tokens (folded into it right after this
    // attempt settled, above) — overlay it onto the final returned failure rather than re-adding it.
    // `partial` reflects `carriedPartial` (whether ANY folded-in attempt's figure was itself an
    // estimate), never forced true just because the call spanned more than one attempt — a run whose
    // every attempt ended on an authoritative `result.usage` stays non-partial here too.
    if (!last.ok && carried.input + carried.output + carried.cacheRead + carried.cacheWrite > 0) {
      return carriedPartial ? { ...last, tokens: carried, partial: true } : { ...last, tokens: carried };
    }
    return last;
  }

  private async _invokeOnce(req: { prompt: string; opts: AgentOpts; runId: string; agentId: string; signal?: AbortSignal; workspace?: string; assets?: { roots: { workflow: string; global: string }; declared: { skills: string[]; mcp: string[] }; workflow: string }; onHarness?: (h: HarnessDescriptor, applied?: EffortApplied) => Promise<void>; onEvent?: (ev: TranscriptEvent) => void | Promise<void>; onUsage?: (cumulative: Tokens) => void; caps?: Caps }, attempt = 1): Promise<GatewayResult> {
    // issue #24/#22: per-call AgentOpts.timeoutMs overrides the configured default (both directions);
    // MUST match invoke()'s attempts calc above so a bounded attempt count never pairs with an
    // unbounded timer (or vice-versa). resolveTimeout rejects a bad value → gateway default applies.
    const timeoutMs = resolveTimeout(req.opts.timeoutMs) ?? this._config.timeoutMs;
    // issue #53: an attempt that begins with the caller's signal already aborted dispatches NOTHING
    // (no session, no harness, no confinement line) — an `abort` listener added to an already-aborted
    // signal never fires, so such an attempt would otherwise run unbounded outside the run's
    // accounting. `retryable:false` is belt-and-braces for `invoke()`'s own post-attempt check.
    if (req.signal?.aborted) return abortedBeforeDispatch();
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
    // issue #128: `materializeAssets` no longer writes anything to `<workspace>/.mcp.json` — its
    // resolved configs go ONLY to `options.mcpServers` below, under `strictMcpConfig: true` (which
    // also means a project `.mcp.json` would never have been READ even when one existed). Resolved
    // ONCE here, threaded straight into the dispatch.
    // Project configuration another agent (or anything else) left in the workspace is removed before
    // this CLI can load it — and before skills are materialized, so a `.claude` symlink cannot carry
    // them out of the workspace. The file tools cannot write these paths (toolUsePreCheck); this
    // catches every other route (Bash on an unconfined host). Unremovable ⇒ refuse, never load it.
    let plantedConfigRemoved: string[] = [];
    if (req.workspace !== undefined) {
      try {
        plantedConfigRemoved = sweepPlantedConfig(req.workspace);
      } catch (err) {
        if (timer !== undefined) clearTimeout(timer);
        req.signal?.removeEventListener('abort', onExternalAbort);
        return { ok: false, provider: 'claude-agent-sdk', transport: 'claude-agent-sdk', reason: 'terminal', retryable: false, detail: `PLANTED_CONFIG_UNREMOVABLE: ${(err as Error).message} in the run workspace — refusing to start an agent that would load it` };
      }
      if (plantedConfigRemoved.length > 0) {
        this._eventSink({ kind: 'agent.planted_config_removed', runId: req.runId, agentId: req.agentId, attempt, root: req.workspace, removed: plantedConfigRemoved });
      }
    }
    let materialized: { skills: string[]; mcp: string[]; missing: string[] } | undefined;
    let mcpConfigs: Record<string, McpServerConfig> = {};
    let mcpMissing: string[] = [];
    if (req.workspace !== undefined && req.assets !== undefined) {
      const mcpResolved = await this._resolveMcpConfigs(req.assets.workflow, req.assets.declared.mcp, req.runId, req.workspace);
      mcpConfigs = mcpResolved.configs;
      mcpMissing = mcpResolved.missing;
      materialized = await materializeAssets(req.assets.roots, req.workspace, req.assets.declared, async () => mcpResolved);
    }
    // Issue #106: every server is dispatched with `alwaysLoad: true` (sdk.d.ts: "blocks startup until
    // the server is connected (capped at the standard 5s connect timeout) … since the tools must be
    // present when the turn-1 prompt is built", and never deferred behind tool search) — the
    // per-server half of the fix beside ENABLE_TOOL_SEARCH (buildSubprocessEnv). An operator's own
    // explicit `alwaysLoad` in the pushed config wins (spread last).
    const dispatchedMcp: Record<string, McpServerConfig & { alwaysLoad?: boolean }> = Object.fromEntries(
      Object.entries(mcpConfigs).map(([name, cfg]) => [name, { alwaysLoad: true, ...cfg }]),
    );
    const mcpServers = Object.keys(dispatchedMcp).length > 0 ? dispatchedMcp : undefined;
    // issues #81/#83: materializing a skill's files is not delivering it — the model reaches a
    // skill only through the SDK's Skill tool. Measured against the real CLI: `Options.skills` alone
    // auto-approves `Skill(<name>)` but does NOT put the tool on the wire when `tools` is explicit
    // (it always is here), so `Skill` is added to `tools` — never to `allowedTools` (deprecated
    // there; the SDK derives the per-skill approval from `Options.skills` itself), and never any
    // file tool, so a skill-only agent (`allowedTools: []`) is a real shape. `Options.skills` is
    // ALWAYS an explicit list: unset means "every discovered skill" (incl. the CLI's bundled ones),
    // which an author hand-adding `Skill` would otherwise get. Only what actually landed on disk is
    // exposed — a declared-but-missing name is not activatable.
    const exposedSkills = materialized?.skills ?? [];
    const wireTools = exposedSkills.length > 0 && !curatedTools.includes('Skill') ? [...curatedTools, 'Skill'] : curatedTools;

    // REQ-037 — 2026-09-26 (alias mechanism removed): provider-aware routing off the full ref's own
    // prefix. `anthropic` dispatches DIRECT to the real Anthropic API (LiteLLM bypassed) — so its env
    // carries the real auth AND its model name is the bare id (`parsed.model`), never the full ref.
    // Every other provider (openrouter, ollama) keeps the proxy path and puts the RAW full ref on the
    // wire verbatim (matches the static `openrouter/*`/`ollama/*` LiteLLM wildcards) — no cloak is
    // needed for ANY provider any more: a ref with a `/` in it is never a bare CLI shorthand the
    // Claude CLI rewrites (the same fact `isPassthroughModel` used to carve out just for openrouter
    // now holds for every full ref, since none of them are bare any more).
    const parsedRef = req.opts.model !== undefined ? parseModelRef(req.opts.model) : undefined;
    const provider = parsedRef?.provider;
    // v26 (DES-179, ARCH-117, TASK-179): computed ONCE per invoke, inside the gateway (the provider
    // is only resolvable here) — the SAME `wireEffort` result travels to onHarness AND (below) onto
    // BOTH `options.thinking` and `options.effort`; `wireEffort` is now the sole writer of each.
    // `req.caps` is the run's admission-time pin (ARCH-116) when the executor threads one; absent ->
    // UNKNOWN_CAPS, the documented fail-safe branch (byte-identical to the retired alias-aware
    // `resolveThinkingMode`, see UNKNOWN_CAPS's own doc comment).
    const wired = wireEffort(provider as Provider | undefined, req.caps ?? UNKNOWN_CAPS, req.opts.effort);
    const applied: EffortApplied = wired.applied;
    // v26 (DES-177, ARCH-115, TASK-177, REQ-125): `modelName` is what actually goes on the wire;
    // `resolvedModel` is the bare id the capture keys its price lookup by (`${provider}/${model}`).
    // anthropic-direct: the bare id, on the wire AND as the resolved model (they're the same string).
    // openrouter/ollama: the RAW full ref on the wire (LiteLLM's wildcard route), the bare id as
    // resolved — an admitted ref always parses (admission already refused a malformed one), so
    // `parsedRef` is defined whenever `req.opts.model` is; a genuinely absent model is a programming
    // error this class does not paper over with a magic default.
    const modelName = provider === 'anthropic' ? parsedRef!.model : (req.opts.model as string);
    const resolvedModel = parsedRef?.model ?? modelName;
    // v26 (DES-177): reportable proxy-facing wire value — absent on an anthropic-direct dispatch
    // (there is no proxy hop to report), present (equal to the raw ref actually sent) for every
    // other provider, which still travels through the LiteLLM proxy.
    const proxyModel = provider !== 'anthropic' ? modelName : undefined;
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
    // ANY run (the owner's accepted cost: such a run is still unconfined; this class has no notion
    // of "remote" and deliberately never gains one).
    // v37 P1 (R5-F3, 2026-09-25): call-tool.ts's remote-submission door is NOT "the control that
    // actually closes for this posture" — it is ONE of three. The other two are admissionRefusal()'s
    // call sites in run-manager.ts, keyed on the trigger's createdRemote and on the resolved
    // version's registeredRemote; the latter refuses a LOCAL run_start of a remotely-registered
    // version, which the door cannot see. Admission is the boundary; this class stays posture-blind.
    const confinementRoot = req.workspace ?? this._config.cwd;
    // Issue #78(c): `bash:'readonly'` is only ever dispatched with the kernel enforcing it — a bad
    // value, a write tool beside it, or a host with no working sandbox refuses here, before any
    // session (the one exception to "this class stays posture-blind": it never downgrades a
    // readonly shell to a writable one).
    const bashRefusal = readonlyBashRefusal({ bash: req.opts.bash, tools: curatedTools, posture: this._config.confinementPosture, root: confinementRoot });
    if (bashRefusal !== null) {
      return stamp({ ok: false, provider: 'claude-agent-sdk', reason: 'terminal', retryable: false, detail: bashRefusal });
    }
    // Issue #95: `bashRefusal === null` here already means `req.opts.bash === 'readonly'` implies a
    // CONFINED posture and a known, non-empty `confinementRoot` (readonlyBashRefusal's own two
    // 'readonly'-only branches refuse otherwise) — so the only new condition to test is the mode
    // itself. Pre-creates the paths the CLI's own sandbox builder needs to already exist under a
    // workspace it is about to put on `denyWrite` in full (see READONLY_MOUNT_TARGETS' doc comment
    // for the real bwrap-argv measurement behind this) — a failure here means the sandbox this
    // dispatch is about to CLAIM as `enforced:true` cannot actually be set up, so it refuses before
    // any session, the same "never a lying enforced:true" shape as the posture/root checks above.
    if (req.opts.bash === 'readonly') {
      try {
        prepareReadonlyMountTargets(confinementRoot as string);
      } catch (err) {
        if (timer !== undefined) clearTimeout(timer);
        req.signal?.removeEventListener('abort', onExternalAbort);
        return stamp({
          ok: false,
          provider: 'claude-agent-sdk',
          reason: 'terminal',
          retryable: false,
          detail: `BASH_READONLY_SANDBOX_PREP_FAILED: ${(err as Error).message} — refusing to start a readonly-Bash agent whose kernel sandbox mount points could not be prepared in the run workspace, rather than dispatch a session that would either fail at CLI startup or falsely report harness.bash.enforced:true`,
        });
      }
    }
    // Issue #101 (CLI scratch): a confined dispatch with a known workRoot gets its OWN CLI scratch
    // under `<workRoot>/cli-tmp/` (inside the workRoot deny, so invisible to every other dispatch),
    // and the host-shared `<tmpdir>/claude-<uid>` goes on denyRead. Fail closed: a scratch that
    // cannot be made refuses the call — never a silent fallback to the shared one.
    const workRoot = this._config.confinement?.workRoot;
    let cliScratch: string | undefined;
    if (this._config.confinementPosture === 'confined' && workRoot !== undefined) {
      const refusal = cliScratchRefusal(workRoot);
      let detail = refusal;
      if (detail === null) {
        try {
          mkdirSync(join(workRoot, CLI_SCRATCH_DIR), { recursive: true, mode: 0o700 });
          cliScratch = mkdtempSync(join(workRoot, CLI_SCRATCH_DIR, 'd'));
        } catch (err) {
          detail = `CLI_SCRATCH_UNAVAILABLE: ${(err as Error).message} — refusing to start an agent whose CLI would otherwise share the host's scratch with every other run`;
        }
      }
      if (detail !== null) {
        if (timer !== undefined) clearTimeout(timer);
        req.signal?.removeEventListener('abort', onExternalAbort);
        return stamp({ ok: false, provider: 'claude-agent-sdk', reason: 'terminal', retryable: false, detail });
      }
    }
    const dropCliScratch = (): void => {
      if (cliScratch === undefined) return;
      try {
        rmSync(cliScratch, { recursive: true, force: true });
      } catch {
        // the CLI may still be exiting; anything left is swept at the next boot (main.ts)
      }
    };
    // #101 follow-up: the try below now spans creation (cliScratch/dropCliScratch, just above) all
    // the way to the query() call and the race that drains it — previously only the aborted-before-
    // dispatch branch and the post-query race called dropCliScratch(), so a throw from an in-between
    // step (sandbox build, `await req.onHarness`, or a synchronous throw from `this._query` itself)
    // propagated out of `_invokeOnce` WITHOUT ever running dropCliScratch(), leaking the per-dispatch
    // scratch dir under workRoot until the next engine boot's sweep. One `finally` now covers every
    // exit from this point on (the two early `return`s inside keep their own manual cleanup too —
    // redundant but harmless, both `dropCliScratch()` and the timer/listener teardown are idempotent).
    try {
      const sandbox: Options['sandbox'] =
        this._config.confinementPosture === 'confined'
          ? buildBashConfinement({
              root: confinementRoot,
              grantedHostPaths: this._config.confinement?.allowHostPaths ?? [],
              protectedFiles: this._config.confinement?.protectedFiles ?? [],
              workRoot: this._config.confinement?.workRoot,
              // Issue #101: default to the HOME this class hands the CLI subprocess (buildSubprocessEnv),
              // so a construction without the composed block is never less confined than one with it.
              homeDir: this._config.confinement?.homeDir ?? process.env['HOME'],
              allowReadPaths: this._config.confinement?.allowReadPaths ?? [],
              ...(req.opts.bash === 'readonly' ? { bashMode: 'readonly' as const } : {}),
              ...(cliScratch !== undefined ? { sharedCliScratch: sharedCliScratch(tmpdir(), process.getuid?.()) } : {}),
            })
          : { enabled: false };

      // send-back item 2 (verify-b, 2026-09-26): the SDK's own `Options.stderr` callback (sdk.d.ts
      // ~L1896) is the CLI subprocess's raw stderr — captured here (bounded to the last 4KB, a plain
      // mutable ref so both `options.stderr` below and the post-drain check after `query()` share the
      // SAME buffer) as defense-in-depth for a startup crash that never reaches an ordinary `result`
      // message at all (the thrown-exception path in `_drain`'s catch). Only ever READ after a
      // failed attempt — see the `agent.stderr` emission below.
      const stderrRef = { tail: '' };
      const captureStderr = (data: string): void => {
        stderrRef.tail = (stderrRef.tail + data).slice(-MAX_STDERR_TAIL);
      };

      const options: Options = {
        cwd: req.workspace ?? this._config.cwd,
        sandbox,
        stderr: captureStderr,
        // issue #129(b): a custom spawner so the CLI child is spawned DETACHED (its own process
        // group) and wrapped for group-kill (wrapCliChildForGroupKill above) — the SDK's default
        // `spawnLocalProcess` spawns a plain (non-detached) child, so its own graceful-close
        // `.kill()` (and a CLI that exits on its own) only ever reaps that ONE process, orphaning
        // every stdio-MCP grandchild the session spawned. Replicates `spawnLocalProcess`'s own
        // stdio shape (`['pipe','pipe','pipe']`, `windowsHide:true`) exactly — including piping
        // stderr into `captureStderr` by hand, since that wiring normally lives ONLY inside
        // `spawnLocalProcess` and is silently skipped for any caller-supplied spawner (measured
        // against the installed SDK's own source — sdk.mjs's `spawnLocalProcess`/`initialize`).
        // Deliberately does NOT pass `spawnOpts.signal` into the raw `spawn()` call: Node's own
        // `{signal}` abort handling would call the RAW child's `.kill()` directly, bypassing this
        // wrapper's group-kill — the SDK's existing `abortController`-driven `close()` (which DOES
        // go through `this.process.kill()`, i.e. the wrapped object below) is the only abort path
        // this needs.
        spawnClaudeCodeProcess: (spawnOpts) => {
          const child = spawn(spawnOpts.command, spawnOpts.args, {
            cwd: spawnOpts.cwd,
            env: spawnOpts.env,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            detached: true,
          });
          child.stderr?.on('data', (data: Buffer) => captureStderr(data.toString()));
          return wrapCliChildForGroupKill(child, this._cliLifecycle);
        },
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
        // actually narrows the built-in tool set sent to the model — set to the SAME curated list,
        // plus the Skill tool when this agent has a declared skill to activate (#81/#83, above).
        tools: wireTools,
        skills: exposedSkills,
        // #81/#83: a skill's inline `!`cmd`` would run through the CLI's own shell path at activation.
        // Skill text is instructions; anything it wants executed goes through the agent's tools.
        // (Serialized to --settings by the SDK, with `sandbox` below merged into the same object.)
        settings: { disableSkillShellExecution: true },
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
        env: cliScratch !== undefined ? withCliScratchEnv(envResult.env, cliScratch) : envResult.env,
      };
      // v26 (DES-179, ARCH-117, TASK-179): `wireEffort` already resolved the flat `Options.effort`
      // field alongside `thinking` above — set only when it actually applies (the anthropic arm).
      if (wired.effort !== undefined) options.effort = wired.effort;
      // v37 (ARCH-178, DES-256, TASK-253, REQ-218): the policy applied is OUR data, so it is
      // unconditional — emitted from `sandbox`, the object the builder above JUST returned, never
      // re-derived. Once per ATTEMPT (the `attempt` param threaded from `invoke()`'s retry loop, NOT
      // `sys.attempt` — the CLI's own internal backoff, read inside `_drain`). A call refused before
      // reaching here (IMPL-377's `WORKROOT_INSIDE_PROJECT` refusal at :709-728, added this same
      // iteration) emits ZERO lines — "a posture printed for a session that never ran is a nerve
      // attached to nothing".
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
      // Issue #106: kept in scope so the session's `system/init` can re-emit it with `mcpStatus`.
      let harnessSent: { descriptor: HarnessDescriptor; applied: EffortApplied | undefined } | undefined;
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
          curatedTools: wireTools,
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
        // #81/#83: what the model could actually activate — distinct from what is on disk above.
        descriptor.skillsExposed = exposedSkills;
        if (plantedConfigRemoved.length > 0) descriptor.plantedConfigRemoved = plantedConfigRemoved;
        // Issue #78(c): the effective Bash mode and whether the kernel sandbox actually carried it.
        if (wireTools.includes('Bash')) descriptor.bash = { mode: req.opts.bash === 'readonly' ? 'readonly' : 'full', enforced: sandbox?.enabled === true };
        // `applied` travels to the caller as onHarness's own second argument (the single source of
        // truth downstream decoration reads) — no separate write onto `descriptor` needed here.
        // v26 (DES-179): `wireEffort.applied` is ALWAYS present (its own doc comment), but the
        // PERSISTED `effortApplied` field's presence still means "an effort was actually requested"
        // (agent-executor.ts:492's `applied !== undefined` gate) — unchanged from v25 and matching the
        // direct-fetch gateway's own `req.opts.effort !== undefined` gate in `LiteLLMGatewayClient.invoke`
        // (client.ts), which still passes `undefined` here for the same reason. Passing
        // `wired.applied` unconditionally would silently add `effortApplied:{reason:'no effort
        // requested'}` to EVERY SDK-gateway record, a persisted-shape change no DES asked for.
        harnessSent = { descriptor, applied: req.opts.effort !== undefined ? applied : undefined };
        await req.onHarness(descriptor, harnessSent.applied);
      }
      // Issue #106: what the CLI reports at init is what the model's FIRST turn was built with. A
      // declared server that is not `connected` there (or exposed no tool) is recorded as a warning
      // on the harness (latest harness event wins: run_agent_log, AgentRecord.warnings, run_status)
      // and on the journal. Only when MCP servers were handed to the CLI at all.
      const onInit = mcpServers === undefined
        ? undefined
        : async (init: { tools?: unknown; mcp_servers?: unknown }): Promise<void> => {
          const { mcpStatus, warnings } = summarizeMcpInit(Object.keys(mcpServers), init);
          for (const w of warnings) {
            const tools = mcpStatus.find((m) => m.server === w.server)?.tools.length ?? 0;
            this._eventSink({ kind: 'agent.mcp_not_connected', runId: req.runId, agentId: req.agentId, attempt, server: w.server, status: w.status, tools });
          }
          if (req.onHarness && harnessSent) {
            await req.onHarness({ ...harnessSent.descriptor, mcpStatus, ...(warnings.length > 0 ? { warnings } : {}) }, harnessSent.applied);
          }
        };
      // issue #53: the awaits above (MCP resolution, asset materialization, onHarness) are a window in
      // which the caller can abort; `onExternalAbort` already fired into `controller`, but `bound`
      // below would attach its listener to an already-aborted signal and never resolve. Refuse here,
      // synchronously before the spawn, rather than start a session nobody can stop.
      if (req.signal?.aborted) {
        if (timer !== undefined) clearTimeout(timer);
        req.signal.removeEventListener('abort', onExternalAbort);
        dropCliScratch();
        return abortedBeforeDispatch();
      }
      const session = this._query({ prompt: req.prompt, options });
      // issue #127: this attempt's own latest-known cumulative usage, mirrored from EVERY `onUsage`
      // call `_drain` makes — read below when the `bound` abort/timeout race (not `drain` itself)
      // decides the outcome, so a call whose returned Promise is abandoned mid-stream still reports
      // what it spent instead of silently reaching `_drain`'s own (now unreachable) return value.
      let attemptUsage: Tokens | undefined;
      const onUsage = (cumulative: Tokens): void => {
        attemptUsage = cumulative;
        req.onUsage?.(cumulative);
      };
      const drain = this._drain(session, req.opts.model, req.onEvent, onInit, onUsage);

      // issue #22: name the culprit on any failure that lacks its own detail — so a timeout/unreachable
      // is diagnosable ("which alias→model?") instead of an opaque reason. modelName is the resolved
      // wire model; provider is the resolved backend. A success or an already-detailed failure is
      // returned unchanged.
      const namedDetail = (reason: string): string => `no response from model "${modelName}" (provider "${provider}") — ${reason}`;
      const enrich = (r: GatewayResult): GatewayResult => (!r.ok && r.detail === undefined ? { ...r, detail: namedDetail(r.reason) } : r);

      // send-back item 2 (verify-b, 2026-09-26): ONE seam every failure path this call can produce
      // (the ordinary `_drain` returns, the aborted/timeout branch below) passes through — mirrors
      // `enrich`'s own "only touch a failure" shape. The FULL captured buffer always goes to the
      // engine log (`agent.stderr`, redacted like every other EngineEvent); only a SHORT tail is
      // folded into the caller-visible `detail` (agent-executor.ts's `capDetail` bounds the whole
      // detail string to 1024B downstream regardless). A call that never wrote any stderr (the
      // common case) is a no-op — never an event for nothing to report.
      const withStderrDiagnostics = (r: GatewayResult): GatewayResult => {
        if (r.ok) return r;
        const trimmedTail = stderrRef.tail.trim();
        if (trimmedTail.length === 0) return r;
        this._eventSink({ kind: 'agent.stderr', runId: req.runId, agentId: req.agentId, attempt, tail: stderrRef.tail });
        const short = trimmedTail.length > MAX_INLINE_STDERR ? `…${trimmedTail.slice(-MAX_INLINE_STDERR)}` : trimmedTail;
        return { ...r, detail: `${r.detail ?? ''}${r.detail ? ' — ' : ''}CLI stderr tail: ${short}` };
      };

      // D-F7/D-F9a: race the session against a timeoutMs-bounded timer and/or the caller's own
      // (RunManager-owned) AbortSignal — whichever fires first wins, exactly like
      // LiteLLMGatewayClient's per-attempt AbortController race. Raced unconditionally now that the
      // controller always exists (v26) — `bound` simply never resolves when neither a timer nor an
      // external signal is configured, so `drain` alone decides the outcome, unchanged.
      const bound = new Promise<'aborted'>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve('aborted'), { once: true });
      });

      const outcome = await Promise.race([drain, bound]);
      if (outcome !== 'aborted') return stamp(withStderrDiagnostics(enrich(outcome)));
      const reason = timeoutMs !== undefined ? 'timeout' : 'terminal';
      return stamp(withStderrDiagnostics({
        ok: false, provider: 'claude-agent-sdk', reason, detail: namedDetail(reason),
        // issue #127: `attemptUsage` is whatever this attempt streamed before the race was decided —
        // `drain`'s own eventual return (with the same figure) is abandoned the instant `bound` wins.
        ...(attemptUsage !== undefined ? { tokens: attemptUsage, partial: true as const } : {}),
      }));
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      req.signal?.removeEventListener('abort', onExternalAbort);
      // v26 (DES-171): abort AFTER the race has settled (never inside `_drain`, which would let
      // the timeout arm win and misreport `reason:'timeout'` for a call that actually completed) —
      // idempotent (a no-op if already aborted by the timer/external signal above).
      controller.abort();
      dropCliScratch();
    }
  }

  /** Reads a session's own async-generator agent loop to its 'result' message (or natural end).
   *  D-G8-2: every intermediate message/tool_call/tool_result turn along the way is captured (in
   *  order) into the returned GatewayResult.events, not just the final result — the real
   *  reasoning/tool-call trace `workflow_agent_log` is built to show.
   *  issue #127: ALSO folds every streamed `SDKAssistantMessage`'s own `message.usage` through a
   *  `UsageAccumulator` (`usage` param) as it arrives — the ONLY source of truth for what a call that
   *  never reaches a `result` message (aborted/timed out/session ended early) actually spent. This
   *  relies on `includePartialMessages` staying UNSET (never passed to `query()` anywhere in this
   *  class) — with it on, the SDK also streams `SDKPartialAssistantMessage` deltas that repeat the
   *  SAME `message.id` with a growing `usage`, which `UsageAccumulator`'s per-id MAX already tolerates
   *  defensively, but turning partials on was never evaluated against the dedup assumption below it
   *  (every `message.id` seen here is a COMPLETE turn) and is out of this fix's scope. */
  private async _drain(session: ReturnType<QueryImpl>, model: string | undefined, onEvent?: (ev: TranscriptEvent) => void | Promise<void>, onInit?: (init: { tools?: unknown; mcp_servers?: unknown }) => Promise<void>, onUsage?: (cumulative: Tokens) => void): Promise<GatewayResult> {
    const events: TranscriptEvent[] = [];
    // v26 (DES-171, ARCH-111): unmapped `system` subtypes observed this call — counted, never
    // their payload (see BENIGN_SYSTEM_SUBTYPES/sanitizeSubtype above).
    const unmapped: string[] = [];
    // issue #20: when a live-event sink is provided, STREAM each transcript event as it arrives (so
    // agent_log grows + lastActivityAt advances mid-call) and DON'T also return them in the result —
    // capture() would otherwise re-emit the same events at terminal (duplicates). No sink → unchanged
    // legacy behavior: accumulate and return events for capture() to emit once at the end.
    const streaming = onEvent !== undefined;
    // issue #127: this attempt's own live usage accumulator — read via `.total()` at every failure
    // exit below, so a figure accumulates regardless of which branch this attempt ends on.
    const usage = new UsageAccumulator(onUsage);
    /** issue #127: spreads `{tokens, partial:true}` onto a failure literal ONLY when something was
     *  actually observed — a call that failed before any assistant turn streamed keeps the pre-#127
     *  shape (no `tokens` field at all), not a fabricated zero. */
    const partialUsage = (): { tokens: Tokens; partial: true } | Record<string, never> => {
      const t = usage.total();
      return t === undefined ? {} : { tokens: t, partial: true };
    };
    try {
      for await (const msg of session as AsyncIterable<SDKMessage>) {
        if (msg.type === 'system') {
          const sys = msg as unknown as {
            subtype?: string; error?: string; error_status?: number | null; attempt?: number;
            max_retries?: number; retry_delay_ms?: number;
          };
          // Issue #106: read the init snapshot (MCP status + tool list) — still counted as benign below.
          // Observability must never fail the call it observes: a throw here is swallowed.
          if (sys.subtype === 'init' && onInit !== undefined) await onInit(msg as unknown as { tools?: unknown; mcp_servers?: unknown }).catch(() => undefined);
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
            return { ok: false, provider: 'claude-agent-sdk', reason: 'terminal', retryable: false, detail, error: { kind, status, attempt }, events, unmapped, ...partialUsage() };
          }
          // Every other `system` subtype is COUNTED (never its payload) unless it's routine
          // control-plane chatter — includes any subtype a future SDK adds, the safe default.
          if (!BENIGN_SYSTEM_SUBTYPES.has(sys.subtype ?? '')) unmapped.push(sanitizeSubtype(sys.subtype));
          continue;
        }
        if (msg.type !== 'result') {
          // issue #127: every streamed `assistant` turn's own `message.usage` folds into this
          // attempt's running total BEFORE the event extraction below — a failure return later in
          // this same attempt (or in `_invokeOnce`'s abort race, which never reaches this point at
          // all) still has it, via `onUsage`'s live callback as much as via `partialUsage()` here.
          if (msg.type === 'assistant') {
            const am = msg as unknown as { message?: { id?: string; usage?: Record<string, unknown> } };
            usage.observe(am.message?.id, am.message?.usage);
          }
          const evs = extractEvents(msg, new Date().toISOString()); // det:allow — transcript timestamp, not a decision
          if (streaming) { for (const ev of evs) await onEvent!(ev); }
          else { events.push(...evs); }
          continue;
        }
        if (msg.subtype !== 'success' || msg.is_error) {
          // send-back item 2 (verify-b, 2026-09-26): the real SDK result shape for a failure
          // (`SDKResultError`, sdk.d.ts) carries its diagnostic text on `errors: string[]`
          // (PLURAL) — `m.error` (singular) does not exist on this shape and was always
          // undefined, so an `error_during_execution` result with an empty `result` field used to
          // surface as the bare, undiagnosable string "error_during_execution" (the exact shape a
          // real repro on this host's own CLI produced: sandbox startup failed before any tool
          // call, `num_turns:0`, `result` absent, the actual "socat not installed" text sitting
          // unread on `errors[0]`).
          const m = msg as unknown as { subtype?: string; result?: string; errors?: string[] };
          const errorsText = Array.isArray(m.errors) && m.errors.length > 0 ? m.errors.join('; ') : undefined;
          const detail = [m.subtype, m.result ?? errorsText].filter(Boolean).join(': ') || 'error';
          const errEv: TranscriptEvent = { ts: new Date().toISOString(), kind: 'message', data: { type: 'error', detail } }; // det:allow — transcript timestamp
          if (streaming) { await onEvent!(errEv); } else { events.push(errEv); }
          // issue #127: this IS a real `result` message (`SDKResultError`, sdk.d.ts) — it carries its
          // own finalized `usage`/`modelUsage`, the SAME fields the success branch below reads via
          // `extractTokens`. That is the provider's OWN total for everything this attempt spent, not
          // an estimate — precedence over the per-turn accumulator above, and never `partial`.
          const failTokens = extractTokens(msg, unmapped);
          // Same labelling the THROWN sandbox-unavailable path already gets (below) — a doomed
          // sandbox reaching here as an ordinary result message (rather than a thrown exception)
          // must not burn through every retry attempt the same way a genuinely transient failure
          // would.
          if (isSandboxUnavailableText(detail)) {
            return { ok: false, provider: 'claude-agent-sdk', reason: 'terminal', retryable: false, detail: `${SANDBOX_UNAVAILABLE}: ${detail}`, events, unmapped, tokens: failTokens };
          }
          return { ok: false, provider: 'claude-agent-sdk', reason: 'terminal', detail, events, unmapped, tokens: failTokens };
        }
        return {
          ok: true,
          provider: 'claude-agent-sdk',
          // 2026-09-26 (alias mechanism removed, rule 3): no 'default' fallback — `invoke()`'s own
          // `stamp()` unconditionally overwrites `model` with the resolved id on every ok:true
          // result (see above), so this internal value is never actually read on the production
          // path; `model!` documents that invariant rather than inventing a fallback string for a
          // case (an undefined model reaching dispatch) admission is responsible for preventing.
          model: model!,
          tokens: extractTokens(msg, unmapped),
          content: msg.result,
          events,
          unmapped,
        };
      }
      // Session ended without ever emitting a result message.
      return { ok: false, provider: 'claude-agent-sdk', reason: 'unreachable', unmapped, ...partialUsage() };
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
      if (isSandboxUnavailableText(msg)) {
        return { ok: false, provider: 'claude-agent-sdk', reason: 'terminal', retryable: false, detail: `${SANDBOX_UNAVAILABLE}: ${msg}`, unmapped, ...partialUsage() };
      }
      return { ok: false, provider: 'claude-agent-sdk', reason: timedOut ? 'timeout' : 'unreachable', unmapped, ...partialUsage() };
    }
  }
}

// send-back item 2 (verify-b, 2026-09-26): ONE case-insensitive check shared by both the thrown-
// exception path above and the ordinary-result-message path in `_drain` — a real repro on this
// host produced the sandbox-unavailable failure as an ordinary `result` message
// (`subtype:'error_during_execution'`), not the thrown exception TASK-250's S10 spike observed;
// both shapes must get the SAME `retryable:false` labelling. Case-insensitive because the CLI's
// own raw stderr text ("sandbox required but unavailable: …") and the SDK's thrown `.message`
// prefix ("Sandbox required but unavailable: …") differ only in the leading letter's case.
function isSandboxUnavailableText(text: string): boolean {
  return /sandbox required but unavailable/i.test(text);
}

// v37 (DES-259, ADR-083, TASK-253, REQ-218): exported ONCE — the exact literal ADR-083's revisit
// trigger quotes ("an operator reports a run refused for `sandbox unavailable`"). A drift-lock UT
// pins this string; a rename on either side must break it, never silently diverge.
export const SANDBOX_UNAVAILABLE = 'sandbox unavailable';
