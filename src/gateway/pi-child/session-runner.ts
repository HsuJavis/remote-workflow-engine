// src/gateway/pi-child/session-runner.ts (pi harness v1, slices c/d/e). The REAL per-dispatch pi
// session logic — kept in its own typechecked module (unlike entry.ts, which is excluded from both
// tsconfigs the same way src/sandbox/child-entry.ts is) so this file gets full tsc coverage. Loaded
// by entry.ts via an explicit `.ts` specifier (raw `node --experimental-transform-types`); this file
// must therefore hold NO local VALUE import of its own (only `import type` from protocol.ts, erased
// by type-stripping — see that file's header comment). `isPathContained`/`buildBashEnv`/`isWrapped`
// are real engine logic this file needs but cannot import directly (they are reached through a
// local `.js`/`.ts` sibling, the exact hazard the "rwe sandbox child .ts imports" memory note
// describes) — entry.ts imports them (safely: each of those three files itself holds zero local
// imports) and passes them in as `SessionDeps`, the composition pattern src/sandbox/child-entry.ts
// already uses for guards.ts.
import {
  createAgentSession, createExtensionRuntime, ModelRuntime,
  SessionManager, SettingsManager, type ResourceLoader, type ToolDefinition,
  createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition,
  createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition, createBashToolDefinition,
  type BashOperations,
  DefaultResourceLoader, createMcpExtension, type ExtensionAPI, type McpServerConfig as PiMcpServerConfig,
} from '@earendil-works/pi-coding-agent';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { spawn } from 'node:child_process';
import { join, resolve, relative, sep, dirname } from 'node:path';
import { readFile, writeFile, mkdir, access, stat, readdir, lstat, chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';

/** srt's own `apply-seccomp` vendor binary (vendor/seccomp/<arch>/apply-seccomp) must be readable
 *  from INSIDE the bwrap sandbox it builds — bash itself execs it as the final step of applying the
 *  seccomp filter, from inside the new mount namespace. Discovered empirically in this iteration: on
 *  a dev checkout where the engine's own `node_modules` lives under the denied HOME directory (issue
 *  #101's whole-home deny), srt's bash failed `.../apply-seccomp: No such file or directory` even
 *  though the file exists and is executable on the HOST — it was simply invisible inside the jail.
 *  This is an internal MECHANISM requirement of srt itself (not a policy decision for
 *  `buildBashConfinement()`'s agent-facing semantics), so it is added here, always, never left to an
 *  operator's `sandbox.allowReadPaths` to remember. */
function srtInstallDir(): string | null {
  try {
    const require = createRequire(import.meta.url);
    return dirname(require.resolve('@anthropic-ai/sandbox-runtime/package.json'));
  } catch {
    return null;
  }
}
import type { PiChildConfig, PiChildEvent, PiChildSandboxConfig } from './protocol.js';

export interface SessionDeps {
  isPathContained: (path: string, root: string) => boolean;
  buildBashEnv: (callerEnv: Readonly<NodeJS.ProcessEnv>, sandboxEnv: Readonly<NodeJS.ProcessEnv>) => NodeJS.ProcessEnv;
  isWrapped: (argv: readonly string[]) => boolean;
  /** review B3 (dangling-symlink write escape): where a path REALLY lands once every symlink in it
   *  (including a dangling leaf) is followed — `isPathContained(path, root)` alone is not enough for
   *  a CREATE/WRITE, because `realpathSync` throws on a dangling target and `isPathContained` falls
   *  back to the symlink's own (contained) lexical path, while the actual write follows the link to
   *  its (uncontained) target. `assertJailed` below checks containment of BOTH the lexical path and
   *  `resolveLanding(path)` — reusing the exact function `project-config-guard.ts`'s own
   *  `protectedConfigTarget` already trusts for the SDK path's project-config write refusal. */
  resolveLanding: (path: string) => string;
  /** review B4 (HIGH, functional): pi's built-in `grep` tool ALWAYS shells out to a real `rg` binary
   *  (`ensureTool('rg')`, `core/tools/grep.js`) regardless of the custom `isDirectory`/`readFile`
   *  operations this file already supplies — those cover formatting/line-reading only, never the
   *  actual pattern search. `null` means no bundled native-CLI binary is available on this host (same
   *  meaning as `PiChildSandboxConfig.ripgrepOverride`, but resolved INDEPENDENTLY of bash confinement
   *  — grep must work in BOTH postures, confined or not, and never touches srt at all). */
  resolveRipgrepOverride: () => { command: string; argv0: 'rg' } | null;
}

/** review B4: pi's own `getToolPath('rg')` checks `<PI_CODING_AGENT_DIR>/bin/rg` BEFORE ever touching
 *  PATH or attempting a download — writing the shim straight there (rather than prepending a shim
 *  directory to PATH) needs no env/PATH plumbing at all beyond the ONE env var that redirects
 *  `getAgentDir()` itself (set in `runPiChildSession`, below). The shim is a tiny bash script, not a
 *  symlink: `argv0` must be the literal string `"rg"` for the bundled multicall `claude` binary to
 *  answer as ripgrep (the same `exec -a rg <bin>` trick `ripgrep-override.ts`'s own header comment
 *  documents, and the one this dev host's own `rg` shell FUNCTION already uses) — a symlink cannot
 *  change argv0, only `exec -a`/`ARGV0=` can. Mode 0755 (readable+executable by the dispatch's own
 *  uid; agentDir itself is already 0700, so no other uid can reach it regardless). */
async function installRipgrepShim(agentDir: string, override: { command: string; argv0: 'rg' }): Promise<void> {
  const binDir = join(agentDir, 'bin');
  await mkdir(binDir, { recursive: true });
  const shimPath = join(binDir, 'rg');
  const script = `#!/usr/bin/env bash\nexec -a rg ${JSON.stringify(override.command)} "$@"\n`;
  await writeFile(shimPath, script, { mode: 0o755 });
  await chmod(shimPath, 0o755);
}

const emptyResourceLoader = (systemPrompt: string): ResourceLoader => ({
  // Full-control (spec "Inside the child"): no discovery, no context files — the engine supplies
  // the whole system prompt. Unchanged for a dispatch with NO declared MCP and NO skills — see
  // `buildResourceLoader` below for the DefaultResourceLoader branch those two slices need (pi's
  // public SDK gives no way to hand a custom ResourceLoader an already-loaded Extension/Skill list;
  // `loadExtensionFromFactory`, the one function that could, is not exported).
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => systemPrompt,
  getSystemPromptSource: () => undefined,
  getAppendSystemPrompt: () => [],
  getAppendSystemPromptSources: () => [],
  extendResources: () => {},
  reload: async () => {},
});

/** slice (g), spike S5's proven mechanism + design change 4: the engine's generic
 *  `{type?,url?,command?,args?,env?}` config (mcp-config-resolver.ts's already-`${secret:}`/
 *  `${run:dir}`-substituted output) projected into pi's own public `McpServerConfig` union, always
 *  `exposure:'direct'` (owner/spec: declared to the model on turn 1, never codemode/deferred/hidden
 *  for v1). Throws (never silently drops) when neither a `url` nor a `command` is present — this
 *  mirrors `classifyTransport`'s own closed universe (`mcp-probe.ts`): every config that reaches a
 *  gateway at all has already passed that check upstream, so this is defense in depth, not the
 *  primary gate. */
function toPiMcpServerConfig(cfg: NonNullable<PiChildConfig['mcp']>[string]): PiMcpServerConfig {
  if (cfg.type === 'http' && typeof cfg.url === 'string') {
    return { type: 'http', url: cfg.url, exposure: 'direct' };
  }
  if (typeof cfg.command === 'string') {
    return { type: 'stdio', command: cfg.command, args: cfg.args, env: cfg.env, exposure: 'direct' };
  }
  throw new Error(`MCP_SERVER_CONFIG_INVALID: no runnable transport (need {type:'http',url:...} or {command:...})`);
}

/** slice (g)/(h): the full-control `DefaultResourceLoader` branch, used ONLY when this dispatch
 *  declares MCP servers or skills — a dispatch with neither keeps using `emptyResourceLoader` above,
 *  byte-identical to every pre-slice-(g)/(h) dispatch (zero behavior change, zero re-verification
 *  risk for the tool/bash/effort/usage slices already proven real). `noContextFiles`/`noExtensions`/
 *  `noSkills`/`noPromptTemplates`/`noThemes` all `true`: pi-harness-research.md's "full control, no
 *  discovery" still holds — `extensionFactories` and `additionalSkillPaths` are the two EXPLICIT
 *  exceptions the options type documents as loading regardless (confirmed by reading
 *  resource-loader.js: `noExtensions` only suppresses DISK-discovered extension paths,
 *  `this.extensionFactories` always loads; `noSkills` only suppresses discovered skill paths,
 *  `additionalSkillPaths` is always merged in). `loadConfig: () => ({servers:[], errors:[]})` on the
 *  built-in MCP extension is load-bearing, not cosmetic: pi-spike-report.md S5's landmine —
 *  `createMcpExtension()`'s DEFAULT config loader ignores a custom `agentDir` entirely and reads the
 *  REAL global `~/.pi/agent/mcp.json`, CREATING `~/.pi/agent` as a side effect (a write outside the
 *  run's workspace, and under the `rwe` service user a write to `/home/rwe/.pi`) — this override
 *  avoids it completely; the ONLY servers this session ever sees are the ones `engineMcpExtension`
 *  registers below. */
async function buildResourceLoader(config: PiChildConfig): Promise<ResourceLoader> {
  const mcpEntries = Object.entries(config.mcp ?? {});
  if (mcpEntries.length === 0 && (config.skillPaths?.length ?? 0) === 0) {
    return emptyResourceLoader(config.systemPrompt);
  }
  function engineMcpExtension(pi: ExtensionAPI): void {
    for (const [name, cfg] of mcpEntries) {
      pi.registerMcpServer(name, toPiMcpServerConfig(cfg));
    }
  }
  const loader = new DefaultResourceLoader({
    cwd: config.cwd,
    agentDir: config.agentDir,
    noContextFiles: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: config.systemPrompt,
    additionalSkillPaths: config.skillPaths ?? [],
    extensionFactories: mcpEntries.length > 0
      ? [createMcpExtension({ loadConfig: () => ({ servers: [], errors: [] }), logPath: join(config.agentDir, 'mcp.log') }), engineMcpExtension]
      : [],
  });
  await loader.reload();
  return loader;
}

/** pi-spike-report.md design change 5: `registerProvider()`'s typed API requires a COMPLETE
 *  `ProviderModelConfig` (id/name/input/cost/reasoning/contextWindow/maxTokens all mandatory) — the
 *  bare `{id}` shorthand pi's OWN file-based `models.json` docs show throws at REQUEST time, not
 *  registration time, through this path. Built once per dispatch (one child = one model = one
 *  registration), never the file-based shorthand. `cost` is all-zero: the engine prices usage itself
 *  (spec "Usage" — "the engine prices usage; ignore pi's own cost figure"), never pi's advisory
 *  figure. `contextWindow`/`maxTokens` are conservative, pi-internal-only defaults (truncation/
 *  context bookkeeping) — they do not reach the engine's own accounting. */
export function buildModelConfig(modelId: string, reasoning: boolean): {
  id: string; name: string; input: ('text' | 'image')[]; cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  reasoning: boolean; contextWindow: number; maxTokens: number;
} {
  return {
    id: modelId, name: modelId, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning, contextWindow: 128_000, maxTokens: 8192,
  };
}

async function resolveModel(config: PiChildConfig, runtime: ModelRuntime) {
  if (config.model.provider === 'ollama') {
    runtime.registerProvider('ollama-runtime', {
      baseUrl: `${config.model.baseUrl}/v1`,
      api: 'openai-completions',
      apiKey: 'ollama', // ollama ignores the key; openai-completions requires SOME value
      models: [buildModelConfig(config.model.model, false)],
    });
    const model = runtime.getModel('ollama-runtime', config.model.model);
    if (!model) throw new Error(`MODEL_REGISTRATION_FAILED: ollama/${config.model.model} did not register`);
    return model;
  }
  // openrouter (slice i extends this arm with openrouterBaseUrl / recording-fake-server support).
  runtime.registerProvider('openrouter', {
    baseUrl: config.openrouterBaseUrl ?? 'https://openrouter.ai/api/v1',
    apiKey: config.apiKey,
    models: [buildModelConfig(config.model.model, true)],
  });
  const model = runtime.getModel('openrouter', config.model.model);
  if (!model) throw new Error(`MODEL_REGISTRATION_FAILED: openrouter/${config.model.model} did not register`);
  return model;
}

/** review R2-2 (coordinator round 2, MEDIUM — supersedes the round-1 M6 fix below): the round-1
 *  approach polled `/proc/<bashPid>/task/<bashPid>/children` every 100ms for the exec() call's whole
 *  lifetime and SIGKILLed every pid it ever saw at close time. Two real defects: (1) a `nohup`/
 *  `setsid` child reparented away before the FIRST 100ms poll ever ran was never seen at all — the
 *  round-1 test only passed because its OWN command padded a trailing `sleep 0.3` to keep bash alive
 *  long enough for one poll tick, which a real dispatch never guarantees; (2) killing every pid EVER
 *  seen (not just pids still alive) widened the round-1-accepted PID-reuse TOCTOU window from
 *  microseconds (the gap between reading `/proc` and calling `kill`) to the WHOLE command's lifetime
 *  — a long-running build forking thousands of short-lived processes could have its early pids reused
 *  by an unrelated process on the host by the time this SIGKILLed them.
 *
 *  Fixed by not tracking individual pids at all: bash is already spawned `detached: true` (below),
 *  which makes bash's own pid ALSO its process GROUP id — `process.kill(-bashPid, signal)` reaches
 *  bash and every descendant that stayed in that group. Under a non-interactive `bash -c` script (no
 *  job control), a plain `cmd &` or `nohup cmd &` background job never gets its own process group —
 *  it inherits bash's — so the group kill reaches it even after bash itself has exited and
 *  reparenting has already happened, because a process group id cannot be reused while ANY member of
 *  it is still alive (unlike a bare pid, which can be reused the instant its own process exits). A
 *  `setsid cmd &` explicitly creates a NEW session and process group, unreachable by a group kill —
 *  this is the one documented limitation (DEPLOY.md, the authoring guide): the unconfined posture is
 *  local-only by policy, and confined Bash never has this gap at all (bwrap's own `--unshare-pid
 *  --die-with-parent` already reaps everything in its own pid namespace when bwrap itself exits — no
 *  group-kill of any kind is needed there, see `createJailedBashOps`, which this function is NOT
 *  part of).
 *
 *  Runs on EVERY exit path (normal completion, error, abort, timeout) — not only abort/timeout, the
 *  round-1 gap review R2-2 is titled after. SIGTERM, then (if the group is still alive) SIGKILL after
 *  a short grace — a group probe via signal 0 short-circuits the common case (nothing backgrounded)
 *  without ever paying the grace period. */
const GROUP_KILL_GRACE_MS = 2000; // same grace cli-lifecycle.ts's own killGroup() uses

function reapBashGroup(bashPid: number): void {
  // Fast path: ESRCH means the group is already empty (the common case — nothing was backgrounded),
  // so this returns immediately instead of always paying the grace period below.
  try {
    process.kill(-bashPid, 0);
  } catch {
    return;
  }
  try { process.kill(-bashPid, 'SIGTERM'); } catch { return; /* already gone between the probe and here — nothing to escalate */ }
  const escalate = setTimeout(() => {
    // review (advisor catch, pre-commit): a pgid is only SAFE to signal while a member of it is
    // still alive — the fast-path probe above establishes that at call time, but this callback runs
    // `GROUP_KILL_GRACE_MS` LATER, in a process (this pi child) that can easily still be running
    // then (unref() only means "don't keep the event loop alive for this timer", not "cancel it" —
    // if something else keeps the process up, it still fires). If the SIGTERM above was enough, the
    // group — and its pgid NUMBER — may already be gone, and on a busy host that number CAN be
    // reused by an unrelated process's group in the meantime. SIGKILLing `-bashPid` blind at that
    // point could hit a completely unrelated group. Re-probing immediately before the real signal
    // closes that window down to the same microsecond TOCTOU every other signal-then-act pair in
    // this codebase already accepts (round-1's own L3 finding) — not a new unbounded gap.
    try { process.kill(-bashPid, 0); } catch { return; }
    try { process.kill(-bashPid, 'SIGKILL'); } catch { /* gone between the re-probe and here — fine */ }
  }, GROUP_KILL_GRACE_MS);
  escalate.unref?.();
}

/** A minimal glob matcher for the jailed `find` tool's operations (spec: pi's own `find` tool is
 *  semantically Claude's `Glob`, per spike S6 — "respects .gitignore" in pi's own built-in
 *  implementation, which this jailed replacement does NOT reproduce; a known, documented
 *  simplification, not a safety gap — the containment check in `assertJailed` is what matters here).
 *  Supports `*` (any run of characters except `/`), `**` (any run of characters including `/`) and
 *  `?` (one character) — translated to a regex anchored over the POSIX-relative path from `cwd`. */
function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') { re += '.*'; i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c!.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export async function walkDir(dir: string, base: string, out: string[], ignore: readonly string[], limit: number): Promise<void> {
  if (out.length >= limit) return;
  let entries: string[];
  try { entries = await readdir(dir); } catch { return; }
  for (const name of entries) {
    if (out.length >= limit) return;
    if (ignore.some((ig) => name === ig)) continue;
    const abs = join(dir, name);
    const rel = relative(base, abs).split(sep).join('/');
    // review M5: `lstat` (never follows the final symlink component) instead of `stat` — a symlinked
    // directory is neither traversed into NOR listed as a result, matching `ls`'s own existing
    // refusal of a symlinked directory argument. `ls -d/-l` elsewhere in `find`'s own contract is a
    // leaf-name listing, not a containment boundary itself; `assertJailed`'s `cwd` check above covers
    // escaping the jail via `path`, this covers escaping it via a symlink discovered BELOW `cwd`.
    let lst;
    try { lst = await lstat(abs); } catch { continue; }
    if (lst.isSymbolicLink()) continue;
    if (lst.isDirectory()) await walkDir(abs, base, out, ignore, limit);
    else out.push(rel);
  }
}

/** File-tool jail (spec "File jail"): every path-taking tool resolves its `path` arg against
 *  `config.cwd` FIRST (pi's own tools already do this internally for relative paths, but the
 *  operations layer below receives whatever pi hands it — defensively `resolve()` it again here so
 *  containment is checked against an ABSOLUTE path regardless), then refuses with a thrown error
 *  (pi's tool-call pipeline turns a thrown Operations error into a tool-result error, matching
 *  `toolUsePreCheck`'s own refusal shape on the sdk gateway) unless BOTH: (a) contained within
 *  `config.cwd` OR (when `opts.readOnly`) one of `config.skillReadRoots`, and (b) not equal to /
 *  inside any of `config.protectedFiles`.
 *
 *  Issue #144: `opts.readOnly` is set by every READ operation below (`read`/`grep`/`find`/`ls`, and
 *  edit's own `readFile`/`access` half) and OMITTED by every WRITE operation (`write`'s `writeFile`/
 *  `mkdir`, edit's own `writeFile`) — a declared skill's materialized directory is readable to the
 *  model (pi tells it to `read` the skill's own `SKILL.md` by absolute path, outside `cwd` since
 *  issue #144 moved skill materialization out of the workspace; `formatSkillsForPrompt`'s own
 *  `<location>` field is that path) but never writable: `config.skillReadRoots` only widens the
 *  containment check below, never which root `config.protectedFiles` or a write op is checked
 *  against. `config.cwd` ITSELF stays checked unconditionally either way — `skillReadRoots` only ever
 *  ADDS an extra allowed root for a read, never removes `cwd`. */
export function assertJailed(absolutePath: string, config: PiChildConfig, deps: SessionDeps, opts?: { readOnly?: boolean }): void {
  const root = resolve(config.cwd);
  const target = resolve(absolutePath);
  // review B3: `landing` is where this path ACTUALLY resolves once every symlink (including a
  // dangling leaf) is followed — checked IN ADDITION to the lexical `target` (never instead of:
  // `target` alone still catches a plain `../` escape and an existing-target symlink; `landing`
  // alone would miss nothing dangling ever existing in the first place, but checking both is cheap
  // and matches `protectedConfigTarget`'s own "lexical AND landing" discipline exactly).
  const landing = resolve(deps.resolveLanding(target));
  const containedIn = (r: string): boolean => deps.isPathContained(target, r) && deps.isPathContained(landing, r);
  const skillReadRoots = opts?.readOnly ? (config.skillReadRoots ?? []) : [];
  if (!containedIn(root) && !skillReadRoots.some(containedIn)) {
    throw new Error(`PATH_ESCAPES_WORKSPACE: "${absolutePath}" is outside this run's workspace`);
  }
  for (const protectedPath of config.protectedFiles) {
    const resolvedProtected = resolve(protectedPath);
    if (deps.isPathContained(target, protectedPath) || deps.isPathContained(landing, protectedPath) || target === resolvedProtected || landing === resolvedProtected) {
      throw new Error(`PROJECT_CONFIG_PROTECTED: "${absolutePath}" is a protected path`);
    }
  }
}

/** srt's returned env is the CALLING process's whole `process.env` plus its own additions (the
 *  single most safety-critical finding in the whole spike) — `deps.buildBashEnv` is the ONLY
 *  sanctioned way to turn that into the child's actual env; pi's own `env` argument (built from
 *  `getShellEnv()` = `{...process.env, PI_*}`) is discarded entirely, never merged. */
function createJailedBashOps(config: PiChildConfig, sandbox: PiChildSandboxConfig, deps: SessionDeps): BashOperations {
  // review round 3, R3-1: srt reads `CLAUDE_CODE_TMPDIR` FRESH on every confined exec call (not
  // frozen at module load — confirmed by reading sandbox-utils.js's generateProxyEnvVars directly),
  // so setting it once per dispatch, here, before the first real exec, is correct and sufficient —
  // every confined bash call in this dispatch sees `config.tmpDir`, never srt's own shared fallback.
  process.env['CLAUDE_CODE_TMPDIR'] = config.tmpDir;
  let initialized = false;
  const ensureInit = async (): Promise<void> => {
    if (initialized) return;
    if (sandbox.ripgrepOverride === null) {
      throw Object.assign(new Error('SANDBOX_UNAVAILABLE: no bundled ripgrep-capable CLI binary was found on this host — the pi bash tool refuses rather than call SandboxManager.initialize() with no override'), { code: 'SANDBOX_UNAVAILABLE' });
    }
    await SandboxManager.initialize(
      {
        // Base config: deliberately the strictest empty posture — every REAL call below supplies
        // its own complete `customConfig` (filesystem/credentials/network), never relying on this
        // base (pi-spike-report.md S1: "the override mechanism is not racy", confirmed per-call
        // customConfig fully replaces policy).
        network: { allowedDomains: [], deniedDomains: [] },
        filesystem: { allowWrite: [], allowRead: [], denyRead: [], denyWrite: [] },
        ripgrep: sandbox.ripgrepOverride,
      } as Parameters<typeof SandboxManager.initialize>[0],
      // design change 6: "allow all" network parity with today's unrestricted-bash-network posture
      // under confinement — srt's `network` field is MANDATORY (unlike the SDK's optional one), and
      // an empty `allowedDomains` alone means deny-all; an ask callback that always answers "allow"
      // is the one mechanism that is BOTH expressible in srt's typed config AND verified working on
      // this host (external HTTPS egress confirmed via a real fake-server round trip during this
      // iteration — see the PR report's real-run evidence). KNOWN GAP, documented: srt routes ALL
      // egress through its MITM proxy once `network` is configured at all, and `localhost`/127.0.0.1
      // destinations from INSIDE the sandboxed bash are consequently unreachable (measured during
      // this iteration) — a real behavior change from today's SDK-gateway bash, which leaves
      // `network` unset entirely and keeps full host network including loopback. Flagged as a
      // residual risk in the report; not re-litigated per call.
      async () => true,
    );
    initialized = true;
  };

  return {
    async exec(command, cwd, { onData, signal, timeout, env: _piEnv }) {
      await ensureInit();
      const srtDir = srtInstallDir();
      const customConfig = {
        filesystem: {
          ...sandbox.filesystem,
          allowRead: srtDir !== null ? [...sandbox.filesystem.allowRead, srtDir] : sandbox.filesystem.allowRead,
        },
        network: { allowedDomains: [], deniedDomains: [] },
        credentials: sandbox.credentials,
        enableWeakerNestedSandbox: false,
      } as Parameters<typeof SandboxManager.wrapWithSandboxArgv>[2];
      const { argv, env: sandboxEnv } = await SandboxManager.wrapWithSandboxArgv(command, 'bash', customConfig, signal, cwd);
      // design change 2 / the enforced check: a real `bwrap ... --unshare` invocation must actually
      // be present in the joined argv — `argv[0]` is always `'bash'`, never a usable signal.
      if (!deps.isWrapped(argv)) {
        throw Object.assign(new Error('SANDBOX_UNAVAILABLE: wrapWithSandboxArgv did not produce a real bwrap invocation for this command'), { code: 'SANDBOX_UNAVAILABLE' });
      }
      const finalEnv = deps.buildBashEnv(process.env, sandboxEnv);
      return new Promise((resolvePromise, reject) => {
        const child = spawn(argv[0]!, argv.slice(1), { cwd, env: finalEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let timedOut = false;
        let timer: NodeJS.Timeout | undefined;
        const killGroup = (): void => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
        if (timeout) timer = setTimeout(() => { timedOut = true; killGroup(); }, timeout * 1000);
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        const onAbort = (): void => killGroup();
        signal?.addEventListener('abort', onAbort, { once: true });
        child.on('error', (e) => { if (timer) clearTimeout(timer); reject(e); });
        child.on('close', (code) => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          if (signal?.aborted) reject(new Error('aborted'));
          else if (timedOut) reject(new Error(`timeout:${timeout}`));
          else resolvePromise({ exitCode: code });
        });
      });
    },
  };
}

/** Translates `config.tools` (already-mapped pi names, pre-validated by the parent —
 *  TOOL_UNSUPPORTED_BY_HARNESS never reaches this far) into `customTools` + jailed/sandboxed
 *  operations, per spec "Tool mapping" / "File jail" / "Bash". `noTools:'builtin'` is the OTHER
 *  half (set by the caller) — confirmed by spike S6 as the correct, complete override mechanism
 *  (the built-in LOCAL executor is never reached once both are set). */
function buildCustomTools(config: PiChildConfig, deps: SessionDeps): ToolDefinition<any, any, any>[] {
  const want = new Set(config.tools);
  // `ToolDefinition<any, any, any>`: each `create*ToolDefinition()` call below returns a distinctly
  // (and correctly) typed ToolDefinition over its OWN typebox schema — a bare `ToolDefinition[]`
  // array (TParams defaulting to the abstract TSchema) rejects every one of them on `renderCall`'s
  // contravariant `args` parameter. `customTools` itself accepts a loosely-typed array at the
  // `createAgentSession()` call site below.
  const tools: ToolDefinition<any, any, any>[] = [];
  if (want.has('read')) {
    tools.push(createReadToolDefinition(config.cwd, {
      operations: {
        readFile: async (p) => { assertJailed(p, config, deps, { readOnly: true }); return readFile(p); },
        access: async (p) => { assertJailed(p, config, deps, { readOnly: true }); await access(p); },
      },
    }));
  }
  if (want.has('write') && config.bashMode !== 'readonly') {
    tools.push(createWriteToolDefinition(config.cwd, {
      operations: {
        writeFile: async (p, content) => { assertJailed(p, config, deps); await writeFile(p, content); },
        mkdir: async (d) => { assertJailed(d, config, deps); await mkdir(d, { recursive: true }); },
      },
    }));
  }
  if (want.has('edit') && config.bashMode !== 'readonly') {
    tools.push(createEditToolDefinition(config.cwd, {
      operations: {
        readFile: async (p) => { assertJailed(p, config, deps, { readOnly: true }); return readFile(p); },
        writeFile: async (p, content) => { assertJailed(p, config, deps); await writeFile(p, content); },
        access: async (p) => { assertJailed(p, config, deps, { readOnly: true }); await access(p); },
      },
    }));
  }
  if (want.has('grep')) {
    tools.push(createGrepToolDefinition(config.cwd, {
      operations: {
        isDirectory: async (p) => { assertJailed(p, config, deps, { readOnly: true }); return (await stat(p)).isDirectory(); },
        readFile: async (p) => { assertJailed(p, config, deps, { readOnly: true }); return readFile(p, 'utf8'); },
      },
    }));
  }
  if (want.has('find')) {
    tools.push(createFindToolDefinition(config.cwd, {
      operations: {
        exists: async (p) => {
          assertJailed(p, config, deps, { readOnly: true });
          try { await access(p); return true; } catch { return false; }
        },
        glob: async (pattern, cwd, options) => {
          assertJailed(cwd, config, deps, { readOnly: true });
          const all: string[] = [];
          await walkDir(cwd, cwd, all, options.ignore, options.limit * 20); // overcollect, then filter
          const re = globToRegExp(pattern);
          return all.filter((f) => re.test(f)).slice(0, options.limit);
        },
      },
    }));
  }
  if (want.has('ls')) {
    tools.push(createLsToolDefinition(config.cwd, {
      operations: {
        exists: async (p) => {
          assertJailed(p, config, deps, { readOnly: true });
          try { await access(p); return true; } catch { return false; }
        },
        stat: async (p) => { assertJailed(p, config, deps, { readOnly: true }); return stat(p); },
        readdir: async (p) => { assertJailed(p, config, deps, { readOnly: true }); return readdir(p); },
      },
    }));
  }
  if (want.has('bash')) {
    const operations = config.sandbox !== undefined
      ? createJailedBashOps(config, config.sandbox, deps)
      // Unconfined posture: plain exec, no srt wrap — matches the sdk gateway's own
      // `{enabled:false}` behavior (never a silent claim of confinement with no evidence either way).
      : ({
          async exec(command, cwd, { onData, signal, timeout }) {
            return new Promise((resolvePromise, reject) => {
              const child = spawn('bash', ['-c', command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
              let timedOut = false;
              let timer: NodeJS.Timeout | undefined;
              // Immediate (no grace) group kill — the URGENT paths below (abort/timeout) want it
              // stopped NOW, not after `reapBashGroup`'s own grace period.
              const killGroupNow = (): void => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
              if (timeout) timer = setTimeout(() => { timedOut = true; killGroupNow(); }, timeout * 1000);
              child.stdout?.on('data', onData);
              child.stderr?.on('data', onData);
              const onAbort = (): void => killGroupNow();
              signal?.addEventListener('abort', onAbort, { once: true });
              child.on('error', (e) => {
                if (timer) clearTimeout(timer);
                if (child.pid !== undefined) reapBashGroup(child.pid);
                reject(e);
              });
              child.on('close', (code) => {
                if (timer) clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                // review R2-2: group-kill on EVERY exit path, not only abort/timeout (which already
                // SIGKILLed the group above, immediately, via killGroupNow()) — this call is what
                // actually closes the NORMAL-completion gap review R2-2 is about. A cheap no-op when
                // nothing was backgrounded (reapBashGroup's own signal-0 probe short-circuits it).
                if (child.pid !== undefined) reapBashGroup(child.pid);
                if (signal?.aborted) reject(new Error('aborted'));
                else if (timedOut) reject(new Error(`timeout:${timeout}`));
                else resolvePromise({ exitCode: code });
              });
            });
          },
        } satisfies BashOperations);
    tools.push(createBashToolDefinition(config.cwd, { operations }));
  }
  return tools;
}

/** Runs ONE agent() dispatch end to end inside the child process, streaming `PiChildEvent`s to
 *  `emit` as pi's own session reports them, and resolving when the prompt settles (success, error or
 *  abort). Never throws for a provider/session failure — those become `{t:'error'}`/`{t:'fatal'}`
 *  events so entry.ts's wire protocol stays uniform; a thrown error here means a programming defect,
 *  not a dispatch failure. */
export async function runPiChildSession(config: PiChildConfig, emit: (event: PiChildEvent) => void, deps: SessionDeps): Promise<void> {
  // review B4: `PI_CODING_AGENT_DIR` (which redirects pi's OWN `getAgentDir()`/`getBinDir()`, used by
  // `ensureTool` — independently of the `agentDir` SDK option passed to `createAgentSession` further
  // down; the two are not the same seam) is set on the CHILD'S ENV AT SPAWN TIME
  // (pi-gateway-client.ts's `buildChildEnv`), never here: `tools-manager.js` computes
  // `const TOOLS_DIR = getBinDir()` as a module-level constant, frozen the instant
  // `@earendil-works/pi-coding-agent`'s module graph first loads (this file's own top-level
  // `import`, evaluated before this function body ever runs) — setting `process.env` from inside
  // this function would be too late. All that is left to do here is write the shim INTO the
  // directory the child was already born pointing at.
  await mkdir(config.agentDir, { recursive: true });
  const ripgrepOverride = deps.resolveRipgrepOverride();
  if (ripgrepOverride !== null) {
    await installRipgrepShim(config.agentDir, ripgrepOverride);
  }
  const runtime = await ModelRuntime.create({
    authPath: join(config.agentDir, 'auth.json'),
    modelsPath: join(config.agentDir, 'models.json'),
  });
  if (config.apiKey !== undefined) {
    // Owner decision 3: the key lives ONLY in this child's memory, injected via setRuntimeApiKey —
    // never written to agentDir/auth.json (which stays `{}` — ModelRuntime.create above never wrote
    // one), never passed to bash (bash-env.ts's allowlist has no provider-key key at all).
    await runtime.setRuntimeApiKey(config.model.provider, config.apiKey);
  }
  const model = await resolveModel(config, runtime);
  const customTools = buildCustomTools(config, deps);
  const mcpDeclared = Object.keys(config.mcp ?? {}).length > 0;
  const resourceLoader = await buildResourceLoader(config);

  const { session } = await createAgentSession({
    cwd: config.cwd,
    agentDir: config.agentDir,
    model,
    thinkingLevel: config.effort ?? 'off',
    modelRuntime: runtime,
    resourceLoader,
    noTools: 'builtin',
    customTools,
    sessionManager: SessionManager.inMemory(config.cwd),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0 } }),
  });

  const hasSkills = (config.skillPaths?.length ?? 0) > 0;
  if (mcpDeclared) {
    // spike S5's proven sequence (`mcp-register-debug.ts`/`real-call-4-mcp-child.ts`): extensions are
    // not live until bound, and `direct`-exposure servers get up to the built-in 10s `startupWaitMs`
    // to connect before the first prompt. No first-class connection-status API exists on this surface
    // (S5, confirmed again by reading `extensions/mcp/runtime.js`) — the only observable signal is
    // `getActiveToolNames()`, polled here until every declared server has at least one `mcp__<name>__`
    // tool active, or the window elapses, whichever comes first (never waits longer than it has to).
    await session.bindExtensions({});
    const declaredNames = Object.keys(config.mcp ?? {});
    const hasToolsFor = (name: string, active: readonly string[]): boolean => {
      const prefixes = [`mcp__${name}__`, `mcp__${name.replace(/[^A-Za-z0-9_-]/g, '_')}__`];
      return active.some((t) => prefixes.some((p) => t.startsWith(p)));
    };
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !declaredNames.every((n) => hasToolsFor(n, session.getActiveToolNames()))) {
      await new Promise((r) => setTimeout(r, 200));
    }
    emit({ t: 'mcp_init', servers: declaredNames, activeTools: session.getActiveToolNames() });
  } else if (hasSkills) {
    // Skills-only (no MCP): still need extensions bound once (the loader was built via
    // DefaultResourceLoader above) — cheap, and keeps one code path for "used the full-control
    // loader" rather than threading a second condition through this function.
    await session.bindExtensions({});
  }

  // pi-spike-report.md design changes 7/8: no stable message id exists; key on an adapter-owned
  // sequence counter, incremented on every ASSISTANT message_end (message_end fires for every role).
  let seq = 0;
  // rest of slice (f), a real defect found by the real fake-server error-classification evidence
  // (tests/acceptance/pi-harness-error-classification-fake-server.test.ts, run against a REAL 401/
  // 429/500 HTTP response — not fabricated child events): `session.prompt()` does NOT reject when a
  // provider call fails mid-turn — pi ends that turn with `stopReason:'error'` on the assistant
  // message (handled below, emits `{t:'error'}`) and then RESOLVES normally. Before this fix,
  // execution fell through past the `try` block unconditionally and ALSO emitted `{t:'final', ...}`
  // right after the error — the PARENT (`pi-gateway-client.ts`) lets whichever event arrives LAST win
  // `settled`, so every real provider error was silently overwritten into a fake `ok:true` success.
  // This flag is the fix: once the turn has ended in error, the post-prompt() code path below is
  // skipped entirely.
  let erroredOut = false;
  const safeJson = (v: unknown): string => {
    try { return JSON.stringify(v) ?? 'null'; } catch (err) { return JSON.stringify({ unserializable: err instanceof Error ? err.message : String(err) }); }
  };
  session.subscribe((event) => {
    if (event.type === 'tool_execution_start') {
      emit({ t: 'tool_call', toolCallId: event.toolCallId, toolName: event.toolName, argsJson: safeJson(event.args) });
      return;
    }
    if (event.type === 'tool_execution_end') {
      emit({ t: 'tool_result', toolCallId: event.toolCallId, toolName: event.toolName, resultJson: safeJson(event.result), isError: event.isError });
      return;
    }
    if (event.type !== 'message_end' || event.message.role !== 'assistant') return;
    const msg = event.message;
    const text = msg.content.filter((c): c is { type: 'text'; text: string } => c.type === 'text').map((c) => c.text).join('');
    const usage = { input: msg.usage.input, output: msg.usage.output, cacheRead: msg.usage.cacheRead, cacheWrite: msg.usage.cacheWrite };
    seq += 1;
    if (msg.stopReason === 'error') {
      erroredOut = true;
      // residual fix (#127): `usage` was computed above (same as the message_end branch below) and
      // is real even on an errored message (spike S4) — forwarded here so the parent folds it into
      // cumulative instead of silently dropping a mid-stream 429/5xx attempt's own tokens.
      emit({ t: 'error', message: msg.errorMessage ?? 'pi reported stopReason:"error" with no errorMessage', stopReason: msg.stopReason, usage });
      return;
    }
    emit({ t: 'message_end', seq, text, usage, stopReason: msg.stopReason });
  });

  try {
    await session.prompt(config.prompt);
  } catch (err) {
    emit({ t: 'error', message: err instanceof Error ? err.message : String(err) });
    session.dispose();
    await resetSandboxManager();
    return;
  }

  if (erroredOut) {
    session.dispose();
    await resetSandboxManager();
    return;
  }

  const last = session.getLastAssistantText?.();
  emit({
    t: 'final',
    seq,
    text: last ?? '',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, // the parent sums message_end usage; this is a text-only convenience field
    stopReason: 'stop',
  });
  session.dispose();
  await resetSandboxManager();
}

/** residual fix (srt-mux socket leak): srt's OWN exit-time cleanup (`registerCleanup()` in
 *  sandbox-manager.js) is async but wired only to `process.once('exit', ...)`, a listener Node runs
 *  SYNCHRONOUSLY right before the event loop stops — the `await muxProxyServer.close()` inside
 *  `SandboxManager.reset()` never gets to finish there, so the socket under `os.tmpdir()` leaks on
 *  every confined dispatch even when nothing went wrong. Calling it explicitly here, BEFORE
 *  entry.ts's own `process.exit(0)` runs, lets that same close() actually complete — this is the
 *  fast, clean path for every exit this function controls (normal completion, a provider error).
 *  It does NOT cover a SIGKILLed child (abort/timeout, reaped by the parent's group-kill before this
 *  line could ever run) — the parent's own `sweepSrtMuxSockets()` (pi-gateway-client.ts) is the
 *  unconditional backstop for that case. `reset()` is safe to call even when the sandbox was never
 *  initialized (every internal reference is already `undefined`/falsy, confirmed by reading
 *  sandbox-manager.js) — called unconditionally rather than threading an "was bash ever used" flag
 *  through, which would be one more place this call could be forgotten. Best-effort: a reset
 *  failure must never block the child's own exit. */
async function resetSandboxManager(): Promise<void> {
  try { await SandboxManager.reset(); } catch { /* best-effort teardown, never block exit on this */ }
}
