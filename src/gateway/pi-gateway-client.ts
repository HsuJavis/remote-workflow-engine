// src/gateway/pi-gateway-client.ts (pi harness v1, owner decisions 1-3; pi-harness-research.md
// §5.2, pi-spike-report.md). `PiGatewayClient implements GatewayClient` — the SAME port
// `ClaudeAgentSdkGatewayClient` implements, selected by `gateway:"pi"` in rwe.config.json
// (composeConfig(), src/main.ts) instead of the default `gateway:"sdk"`.
//
// Status (tracked honestly, not silently): spawns one detached child per dispatch
// (src/gateway/pi-child/entry.ts) speaking JSONL over stdio, routes openrouter/ollama models, maps
// the tool surface with TOOL_UNSUPPORTED_BY_HARNESS refusal, jails file tools, wraps bash through
// real srt confinement with an honest `harness.bash.enforced`, loops `attemptsFor` retries with
// classified 401/403/404-vs-429/5xx errors, bridges MCP (`pi.registerMcpServer`/`exposure:'direct'`)
// and skills (materialized + `SKILL_REQUIRES_READ_TOOL` when no read tool is present), maps
// `tool_call`/`tool_result`/`mcp_init` transcript events, and verifies OpenRouter's `reasoning.effort`
// request shape — all proven against a real local ollama (+ a real stdio MCP server, + real bwrap)
// in this iteration's evidence. Not supported at all (refused, never silently dropped): WebFetch/
// WebSearch/Task/NotebookEdit tools, anthropic/* models, a Claude subscription token.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, chmodSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AgentOpts, Caps, HarnessDescriptor, Tokens, TranscriptEvent } from '../types.js';
import type { GatewayClient, GatewayResult, EffortApplied } from './client.js';
import { resolveTimeout, attemptsFor } from './client.js';
import { redactHarness } from '../agent-executor.js';
import { parseModelRef } from '../providers.js';
import { RealCliLifecycle } from '../cli-lifecycle.js';
import { buildBashConfinement, readonlyBashRefusal } from './bash-confinement.js';
import { sweepSrtMuxSockets } from './srt-mux-sweep.js';
import { resolveRipgrepOverride } from './pi-child/ripgrep-override.js';
import type { PiChildConfig, PiChildEvent, PiChildSandboxConfig } from './pi-child/protocol.js';
import type { EventSink } from '../event-log.js';
import { PI_HARNESS_VERSION } from '../harness-info.js';
import { materializeAssets, summarizeMcpInit } from './claude-agent-sdk-client.js';
import { sweepPlantedConfig } from './project-config-guard.js';
import { resolveMcpConfigs, type ResolveMcpFn } from './mcp-config-resolver.js';
import type { McpServerConfig } from '../mcp-probe.js';
import type { SecretSource } from '../secret-resolver.js';

/** Engine tool name -> pi tool name (spec "Tool mapping"). Semantic differences, documented: `Glob`
 *  (gitignore-aware, Claude-shaped globbing) maps to pi's `find` (pi's own docs: "respects
 *  .gitignore", semantically the SAME as Claude's Glob despite the Unix-`find`-shaped name — spike
 *  S6); this engine's jailed `find` operations (session-runner.ts) are a simplified glob matcher
 *  that does NOT replicate gitignore-awareness, a documented simplification. */
const TOOL_NAME_MAP: Record<string, string> = { Read: 'read', Write: 'write', Edit: 'edit', Bash: 'bash', Grep: 'grep', Glob: 'find', LS: 'ls' };

/** spec "Tool mapping": WebFetch, WebSearch, Task, NotebookEdit and any other unmapped tool are
 *  refused at registration and dispatch with TOOL_UNSUPPORTED_BY_HARNESS — never silently dropped.
 *  Returns the pi tool names on success. */
/** review M2: `docs/AUTHORING.md:50` documents `mcp__<server>__<tool>` entries in `allowedTools` as a
 *  valid pre-approval pattern (the sdk gateway's own `Options.allowedTools` convention) — an existing
 *  workflow written that way broke outright on switching to pi before this fix, refused
 *  TOOL_UNSUPPORTED_BY_HARNESS for a name that was never meant to go through the base tool-name map at
 *  all. pi's own MCP tool exposure is controlled entirely by `pi.registerMcpServer(...,
 *  {exposure:'direct'})` (session-runner.ts's `buildResourceLoader`), independent of the base tool
 *  set — passing an `mcp__*` name through harmlessly (never translated, never checked against
 *  `TOOL_NAME_MAP`) is both correct and sufficient: nothing downstream does anything special with it
 *  (`buildCustomTools`'s `want.has(...)` checks simply never match it), and the MCP tool was already
 *  going to be available to the model whenever its server is declared. */
function isMcpToolName(name: string): boolean {
  return name.startsWith('mcp__');
}

function mapTools(engineNames: readonly string[]): { ok: true; piNames: string[] } | { ok: false; unmapped: string[] } {
  const piNames: string[] = [];
  const unmapped: string[] = [];
  for (const name of engineNames) {
    if (isMcpToolName(name)) {
      piNames.push(name);
      continue;
    }
    const mapped = TOOL_NAME_MAP[name];
    if (mapped === undefined) unmapped.push(name);
    else piNames.push(mapped);
  }
  return unmapped.length > 0 ? { ok: false, unmapped } : { ok: true, piNames };
}

const DEFAULT_ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'];

const ENTRY_PATH = fileURLToPath(new URL('./pi-child/entry.ts', import.meta.url));

/** Same benign-env allowlist the sdk gateway's CLI subprocess gets (ENV_ALLOWLIST,
 *  claude-agent-sdk-client.ts) — the pi CHILD process itself (not its bash tool, which is a
 *  separate, stricter layer landing in slice e) never inherits the engine's whole `process.env`,
 *  so `RWE_SECRET_*` is never even reachable by a pi/node_modules extension running inside it. */
const CHILD_ENV_ALLOWLIST = ['PATH', 'HOME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM'];

function buildChildEnv(agentDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  // pi-spike-report.md S7: these three flags gate CLI-only code paths in the SDK embedding (no
  // observed effect in-process — `ModelRuntime.create()`'s own `allowModelNetwork` already defaults
  // to false there), set anyway as defense-in-depth per the spike's own recommendation.
  env['PI_OFFLINE'] = '1';
  env['PI_SKIP_VERSION_CHECK'] = '1';
  env['PI_TELEMETRY'] = '0';
  // review B4: MUST be set at process SPAWN, not from inside session-runner.ts after
  // `@earendil-works/pi-coding-agent` is already imported — `tools-manager.js` computes
  // `const TOOLS_DIR = getBinDir()` as a MODULE-LEVEL constant, frozen the instant the package's
  // module graph first loads (a static top-level `import` in session-runner.ts, which runs before
  // ANY function body in that file). Setting this env var later has no effect; setting it here, on
  // the env the child process is BORN with, does.
  env['PI_CODING_AGENT_DIR'] = agentDir;
  return env;
}

const ZERO_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

// residual fix (srt-mux socket leak): `sweepSrtMuxSockets` moved to its own module
// (srt-mux-sweep.ts) so `pi-confinement-probe.ts` can apply the SAME belt-and-suspenders sweep to
// the boot/--check-config probe child (review L1) without duplicating it — see that module's own
// header for the full "why" (async reset() racing process exit / a SIGKILLed child never running
// any exit handler at all). Here it is applied to the pi CHILD's own pid (SandboxManager runs
// in-process with session-runner.ts, never a grandchild — byte-identical to `child.pid`), as the
// backstop for the child's own `SandboxManager.reset()` call (session-runner.ts) losing the
// process-exit race, or the child being killed outright (abort/timeout).

/** residual fix, found by the real-tier MCP abort test (tests/acceptance/pi-harness-mcp-real.test.ts):
 *  `npm exec`/`npx` — what every stdio MCP server config in this engine launches through — calls
 *  `setpgid`/`setsid` on itself immediately at startup, becoming its OWN process group leader.
 *  Confirmed empirically (`ps -eo pid,pgid,sid` during a live abort): the npm-exec process's pgid
 *  equals its own pid, not the pi child's. The existing group-kill (#129 semantics, `killGroup(-
 *  childPid)`) can therefore NEVER reach it or its own children on abort/timeout — a real,
 *  reproducible leak (an `npx`-launched MCP server + its own node grandchild left running after an
 *  early abort), not a hypothetical. `/proc/<pid>/task/<pid>/children` (Linux-only, matching every
 *  other Linux-specific assumption already in this file) lists a process's DIRECT children with no
 *  dependency on process-group membership at all — walked recursively here to capture the FULL
 *  descendant tree, then every captured pid is killed directly, reaching an escaped grandchild the
 *  group-kill cannot. Captured and killed in ADDITION to (never instead of) the existing group-kill:
 *  the group-kill is still correct and sufficient for everything that does NOT escape its group. */
function linuxDirectChildren(pid: number): number[] {
  try {
    const raw = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim();
    return raw.length === 0 ? [] : raw.split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

function collectDescendantPids(rootPid: number): number[] {
  const all: number[] = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    for (const kid of linuxDirectChildren(pid)) {
      all.push(kid);
      queue.push(kid);
    }
  }
  return all;
}

function killDescendantsBestEffort(childPid: number | undefined): void {
  if (childPid === undefined) return;
  for (const pid of collectDescendantPids(childPid)) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone — fine */ }
  }
}

/** residual hardening (coordinator review, 2026-10-03): `agentDir` used to live at
 *  `<workspace>/.pi-agent-dir` — INSIDE the file-tool jail root (`assertJailed` in session-runner.ts
 *  checks containment against `config.cwd`, i.e. the workspace) and, when confined, inside bash's
 *  default-allowed area — so a Read/Write/Edit tool call, or Bash on an unconfined host, could plant
 *  pi config/extensions/an MCP config there for a LATER dispatch to load, and `workspace_pull` could
 *  read `mcp.log` back out (issue #128's exact concern class). Fixed by moving it OUTSIDE the
 *  workspace entirely: a per-dispatch directory under `os.tmpdir()` (never under `workRoot` or the
 *  workspace, so it needs no containment logic of its own — `isPathContained` against `config.cwd`
 *  already excludes it), mode 0700, created before the child is spawned and removed when the dispatch
 *  ends (success, error, abort or timeout alike). Explicitly added to the sandbox's `denyRead` too
 *  (not just "never in allowRead/allowWrite") as the belt to this suspenders. */
// review M4: ALL per-dispatch agentDirs live under ONE engine-owned parent, so a single `denyRead`
// entry on the PARENT (added to the sandbox once, below) hides every sibling dispatch's agentDir —
// including its mcp.log, which can carry another run's MCP-server-controlled log lines — from THIS
// dispatch's confined Bash. Denying only "this dispatch's own dir" (the earlier shape) left every
// OTHER dispatch's dir fully readable, since confined Bash's deny-by-default reads are scoped to
// explicitly denied directories, not "everything under os.tmpdir() this engine did not allow".
//
// review R2-1 (coordinator round 2, HIGH): the parent used to be ONE FIXED, well-known name
// (`join(tmpdir(), 'rwe-pi-agentdirs')`) shared by every uid on the host. `mkdirSync(recursive)`
// silently accepts a directory ANOTHER uid created first; the swallowed `chmodSync` EPERM then left
// that directory's real mode whatever that other uid left it at. Two concrete failures followed:
// (a) on a host where more than one uid runs this engine (a dev user AND the `rwe` service user
// sharing one /tmp — exactly this host), whichever uid wins the race owns it — every OTHER uid's
// `mkdtempSync` inside it then throws EACCES, and that throw happened OUTSIDE any try/catch in
// `invoke()`, escaping as a rejected promise instead of a typed `GatewayResult` (about 60 ungated
// unit tests hit this in the self-update's `npm test`); (b) a local user can pre-create the SAME
// well-known path world-writable or as a symlink, race the engine's own per-dispatch `bin/rg` shim
// (executed ON THE HOST, unsandboxed, by pi's Grep tool) into place before the agent's first Grep
// call — code execution as the engine uid.
//
// Fixed two ways: (1) no more fixed name — the parent is `<workRoot>/pi-agentdirs` when this
// gateway was given a `confinement.workRoot` (composeConfig forwards the SAME workRoot the sdk
// gateway/RunManager use, already engine-owned and already wholesale denyRead for confined Bash),
// or a PRIVATE `mkdtemp`-generated parent created once per PROCESS when no workRoot was wired at
// all (many unit tests) — never a literal string another process could predict or pre-create either
// way. (2) every candidate parent is `lstat`-verified before use: a real directory (not a symlink),
// owned by `process.getuid()`, mode exactly 0700 — refused via a typed `AgentDirUnavailableError`
// otherwise, which `invoke()` (below) converts to a `GatewayResult`, never an escaping exception. A
// failed `chmodSync` is no longer swallowed as "best-effort, the denyRead entry is the real
// control" — the denyRead entry does not help against a directory the engine does not even own,
// which is exactly (b)'s scenario.
class AgentDirUnavailableError extends Error {}

/** `checkMode: false` (review round 3, LOW-1) is used for the PRE-chmod check: a pre-existing entry
 *  must be confirmed "not a symlink, a real directory, owned by us" BEFORE `chmodSync` ever touches
 *  it — `chmodSync` FOLLOWS a symlink, so calling it first (the pre-fix order) silently reconfigured
 *  whatever a planted symlink pointed at before this function ever got a chance to refuse it. The
 *  mode itself is irrelevant at that stage (it may legitimately need repairing, which IS the
 *  "repairs the mode" case below) — only re-checked, with `checkMode` at its default `true`, AFTER
 *  chmod has actually run. */
function verifyPrivateDir(path: string, opts: { checkMode?: boolean } = {}): void {
  let st;
  try {
    st = lstatSync(path);
  } catch (err) {
    throw new AgentDirUnavailableError(`cannot stat ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  // `lstat` never follows a symlink, so a symlink's own isDirectory() is already false regardless
  // of what it points to — `isSymbolicLink()` is checked too, explicitly, so the refusal message
  // names the actual reason rather than a generic "not a directory".
  if (st.isSymbolicLink()) {
    throw new AgentDirUnavailableError(`${path} is a symlink, refusing to use it as the agentDir parent`);
  }
  if (!st.isDirectory()) {
    throw new AgentDirUnavailableError(`${path} is not a directory, refusing to use it as the agentDir parent`);
  }
  const ownUid = process.getuid?.();
  if (ownUid !== undefined && st.uid !== ownUid) {
    throw new AgentDirUnavailableError(`${path} is owned by uid ${st.uid}, not this process's own uid ${ownUid} — refusing to use a directory this engine does not own`);
  }
  if (opts.checkMode !== false && (st.mode & 0o777) !== 0o700) {
    throw new AgentDirUnavailableError(`${path} has mode ${(st.mode & 0o777).toString(8)}, expected 0700 — refusing to use it as the agentDir parent`);
  }
}

// The per-process fallback (no `confinement.workRoot` wired at all) — memoized PER DIRECTORY NAME so
// repeated dispatches in one process reuse the SAME private parent rather than minting a fresh
// randomly named directory every single call, and two different scratch kinds (agentDirs, pi-tmp —
// review round 3, R3-1) each get their OWN private directory, never sharing one. Removed at process
// exit (best-effort) so a workRoot-less engine (or a vitest worker constructing many gateways across
// many test files) never leaks one.
const processLocalScratchParents = new Map<string, string>();

/** Shared by `piAgentDirParent` (review R2-1) and `piTmpDirParent` (review round 3, R3-1) — both
 *  need the exact same "one engine-owned, verified, 0700 parent under workRoot, or a private
 *  per-process mkdtemp fallback" shape, differing only in the directory NAME. `dirName` is also the
 *  per-process fallback's name prefix, so two different kinds never collide (and the error `new
 *  Error` messages below name the engine's-own `dirName`, not a hardcoded "agentDir" literal, now
 *  that this function is used for more than that one purpose). */
function verifiedScratchParent(workRoot: string | undefined, dirName: string): string {
  if (workRoot !== undefined) {
    const parent = join(workRoot, dirName);
    // review round 3, LOW-1: verify a PRE-EXISTING entry BEFORE ever chmod'ing it — `chmodSync`
    // follows a symlink, so chmod-then-verify (the pre-fix order) silently reconfigured whatever a
    // planted symlink pointed at before the refusal below ever ran. `checkMode:false` here: the
    // mode may legitimately need repairing below (same uid, just too permissive) — only "is this
    // even a real directory this engine owns" is checked pre-chmod, never the mode itself.
    let alreadyExists = true;
    try { lstatSync(parent); } catch { alreadyExists = false; }
    if (alreadyExists) {
      verifyPrivateDir(parent, { checkMode: false });
    } else {
      try {
        mkdirSync(parent, { recursive: true });
      } catch (err) {
        throw new AgentDirUnavailableError(`cannot create ${parent}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      chmodSync(parent, 0o700);
    } catch (err) {
      throw new AgentDirUnavailableError(`cannot chmod ${parent} to 0700: ${err instanceof Error ? err.message : String(err)}`);
    }
    verifyPrivateDir(parent);
    return parent;
  }
  let dir = processLocalScratchParents.get(dirName);
  if (dir === undefined) {
    try {
      dir = mkdtempSync(join(tmpdir(), `rwe-${dirName}-`));
    } catch (err) {
      throw new AgentDirUnavailableError(`cannot create a private ${dirName} parent: ${err instanceof Error ? err.message : String(err)}`);
    }
    verifyPrivateDir(dir);
    processLocalScratchParents.set(dirName, dir);
    const dirToRemove = dir;
    process.once('exit', () => { try { rmSync(dirToRemove, { recursive: true, force: true }); } catch { /* best-effort */ } });
  }
  return dir;
}

function piAgentDirParent(workRoot: string | undefined): string {
  return verifiedScratchParent(workRoot, 'pi-agentdirs');
}

/** review round 3 (HIGH, R3-1): srt (`@anthropic-ai/sandbox-runtime`) sets the confined bash
 *  subprocess's `TMPDIR` to `process.env.CLAUDE_CODE_TMPDIR || process.env.CLAUDE_TMPDIR ||
 *  '/tmp/claude'` (sandbox-utils.js) — never set by this gateway before this fix, so every confined
 *  dispatch got the bare literal fallback. Two concrete failures, both reproduced live: (a) when
 *  `/tmp/claude` does not exist (the normal case on a fresh host), `mktemp` and anything else that
 *  honors `$TMPDIR` fails inside EVERY confined bash call; (b) when it exists, it is shared across
 *  EVERY run and EVERY principal on the host — one dispatch's `echo secret > $TMPDIR/f` was read
 *  back by a completely unrelated dispatch's `cat /tmp/claude/f`, and any local user can pre-create
 *  the directory to plant or read what pi writes there.
 *
 *  Fixed in two parts: (1) point `CLAUDE_CODE_TMPDIR` at a per-dispatch, per-process-VERIFIED scratch
 *  (`piTmpDirParent`, below — the exact same shape as `piAgentDirParent`; set in session-runner.ts,
 *  right before the sandbox is ever initialized), so well-behaved `$TMPDIR`-aware tools (mktemp, pip,
 *  npm, compilers, ...) never touch the shared path at all. (2) `denyWrite: ['/tmp/claude']` (below) —
 *  srt binds `/tmp/claude` READ-ONLY rather than hiding it: `/tmp/claude` is unconditionally one of
 *  srt's OWN write paths (`SANDBOX_OWN_WRITE_PATHS` in sandbox-utils.js — a static literal, never
 *  derived from `TMPDIR` and never excludable through any public `SandboxConfig` field: "What the
 *  sandbox itself needs (stdio, /tmp/claude) is never left out", by srt's own doc comment), and a
 *  `denyRead` entry for it is a no-op — srt's own tmpfs-mount step (`pushReadDenyDirMounts`,
 *  linux-sandbox-utils.js) unconditionally RE-BINDS every write-allowed path sitting under a tmpfs it
 *  just mounted, using the REAL host directory ("tmpfs wiped any earlier write binds under this path
 *  — restore them", by its own comment), and `/tmp/claude` is always write-allowed. Confirmed live,
 *  round 3: a planted `/tmp/claude/leak.txt` stayed fully readable with `denyRead` set (alone or
 *  together with `denyWrite`). `denyWrite` alone DOES work, though (also confirmed live): writes
 *  correctly fail ("Read-only file system") while the real content stays readable — the SAME read
 *  exposure as every other host `/tmp` path confined Bash can already read (round 1 parity, not a new
 *  hole), never a write channel between runs or principals.
 *
 *  review round 4 (R4-2, owner ruling): an earlier version of this fix REFUSED the dispatch outright
 *  (`HOST_SHARED_TMPDIR_UNSAFE`) whenever `/tmp/claude` existed, reasoning that masking its content
 *  was impossible and this engine must never delete a shared host path's files (true, and still true
 *  — see above). That refusal is DROPPED: round 4 proved live that confined Bash cannot itself create
 *  `/tmp/claude` (the host's real `/tmp` is bind-mounted READ-ONLY inside the sandbox — `mkdir
 *  /tmp/claude`, `mkdir -p .../x`, `ln -s` and a bare `touch` under `/tmp` all failed with "Read-only
 *  file system", and nothing appeared on the host afterwards), and that `denyWrite` alone already
 *  closes the one channel that matters even under TOCTOU (planted the host `/tmp/claude` mid-dispatch,
 *  between a dispatch's own existence check and its next Bash call — the write still failed read-only,
 *  live, both sequentially and under two concurrent dispatches racing each other). So an existing
 *  `/tmp/claude` buys an attacker nothing beyond ordinary host-`/tmp` read access it already has, and
 *  the refusal's own cost was real: ANY unprivileged local user (or an admin-provisioned stdio MCP
 *  server) could run `mkdir /tmp/claude` and deny confined pi Bash service to the WHOLE host, since
 *  this engine deliberately never deletes a path it does not own outright — nothing short of an
 *  operator intervening would ever clear it. Replaced with a non-blocking, operator-visible warning
 *  (`hostSharedTmpdirPresent()`, `agent.host_shared_tmpdir_present` on the event sink, below) — the
 *  dispatch proceeds exactly as it would if `/tmp/claude` were absent; nothing on the host is ever
 *  touched either way. */
const PI_HOST_SHARED_TMPDIR = '/tmp/claude';

/** See `PI_HOST_SHARED_TMPDIR`'s own doc for the full "why" this is now a non-blocking visibility
 *  check, not a refusal or a cleanup attempt — this function never writes, deletes or opens anything
 *  under `PI_HOST_SHARED_TMPDIR`, only `lstat`s it. */
function hostSharedTmpdirPresent(): boolean {
  try {
    lstatSync(PI_HOST_SHARED_TMPDIR);
    return true;
  } catch {
    return false; // absent — the normal case, and srt's own write loop skips a non-existent path.
  }
}

/** review round 3, R3-1: a per-dispatch TMPDIR scratch, the SAME verified-parent shape as
 *  `piAgentDirParent` — see `PI_HOST_SHARED_TMPDIR`'s own doc for the full "why". */
function piTmpDirParent(workRoot: string | undefined): string {
  return verifiedScratchParent(workRoot, 'pi-tmp');
}

/** Reused for BOTH the per-dispatch agentDir (under `piAgentDirParent()`) and the per-dispatch TMPDIR
 *  scratch (under `piTmpDirParent()`, review round 3 R3-1) — `mkdtempSync` is itself what makes this
 *  safe for either purpose (atomically unique, created 0700 by the OS already; the explicit
 *  `chmodSync` below is belt-and-suspenders against an unusual umask). */
function buildPiAgentDirIn(parent: string): string {
  const dir = mkdtempSync(join(parent, 'd-'));
  chmodSync(dir, 0o700);
  return dir;
}

/** Reused for both scratch kinds (see `buildPiAgentDirIn`'s own doc). */
function removePiAgentDir(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
}

function addTokens(a: Tokens, b: Tokens): Tokens {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

/** A failed `GatewayResult`'s `tokens` field types its cache fields optional (unlike the ok arm) —
 *  normalized to 0 before folding into `addTokens`, same convention `claude-agent-sdk-client.ts`'s
 *  own retry loop uses at its equivalent fold site. */
function normalizeTokens(t: Partial<Tokens> & { input: number; output: number }): Tokens {
  return { input: t.input, output: t.output, cacheRead: t.cacheRead ?? 0, cacheWrite: t.cacheWrite ?? 0 };
}

/** rest of slice (f) ("Error classification"): pi's `AssistantMessage.errorMessage` is a plain
 *  string built by pi-ai's own `formatProviderError` (`<status>: <body>` or `<prefix> (<status>):
 *  <body>` when a status/body were extracted from the provider SDK's error object, else the raw
 *  `error.message` verbatim) — there is NO structured status anywhere on the wire our adapter can
 *  read instead (confirmed by reading `pi-ai/dist/types.d.ts`'s `AssistantMessage` shape: only
 *  `errorMessage?: string` and an unrelated `rawStopReason?: string`), so unlike the sdk gateway's
 *  `classifyApiError` (which classifies a closed, typed SDK error-kind union), this one has to
 *  pattern-match the composed string. Three shapes covered: a bare leading status (openai-node's own
 *  `${status} ${message}`, e.g. "401 Incorrect API key provided..."), `formatProviderError`'s own
 *  no-prefix form (`"<status>: <body>"`), and its prefixed form (`"<prefix> (<status>): <body>"`).
 *  401/403/404 -> 'terminal' (retrying costs a full timeout against a provider that already said no,
 *  same rationale as `classifyApiError`); every other status (429/5xx/etc.), and a message with NO
 *  extractable status at all (keyword-only text like "overloaded" or a network error) -> 'retry' —
 *  the same "absent means retry" default `classifyApiError` uses for its own 'unknown' bucket. */
const TERMINAL_HTTP_STATUSES = new Set([401, 403, 404]);

export function classifyPiErrorMessage(message: string): 'terminal' | 'retry' {
  const match = message.match(/^(\d{3})\b/) ?? message.match(/\((\d{3})\)/) ?? message.match(/^(\d{3}):/);
  if (match === null) return 'retry';
  return TERMINAL_HTTP_STATUSES.has(Number(match[1])) ? 'terminal' : 'retry';
}

export interface PiGatewayConfig {
  /** The OpenRouter API key, from the same secret store `resolveAnthropicAuth` reads from
   *  (RWE_SECRET_OPENROUTER_API_KEY / OPENROUTER_API_KEY) — injected only into the pi child's
   *  memory via `setRuntimeApiKey`, never into bash env, never to disk. */
  secretSource?: { resolve(name: string): string | undefined };
  /** `OLLAMA_BASE_URL` — same meaning as the rest of the engine (default `http://localhost:11434`). */
  ollamaBaseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  /** slice (g): the asset-catalog-backed MCP resolver — late-bound via `bindResolveMcp` (see that
   *  method's own doc), never set here directly in production. Absent/no declared names -> no MCP
   *  servers registered, same as today. */
  resolveMcp?: ResolveMcpFn;
  /** v37 (ARCH-181/262): the pi-PATH confinement posture — a SEPARATE measurement from the sdk
   *  gateway's own boot probe (srt may not match the CLI-bundled sandbox-runtime version; the pi
   *  path also needs the ripgrep-binary override the sdk path never required). Set once at boot by
   *  main.ts's pi-path probe, forwarded through composeConfig() exactly like
   *  `ClaudeAgentSdkGatewayConfig.confinementPosture`. Not yet consumed (slice e wires bash
   *  confinement); carried now so composeConfig()'s wiring doesn't change shape later. */
  confinementPosture?: 'confined' | 'unconfined';
  /** v37-equivalent (ARCH-176/177 parity): the SAME grant/protected/workRoot block
   *  `buildBashConfinement()` consumes on the sdk gateway, forwarded by composeConfig() from the
   *  SAME resolved values (resolvedGrants/protectedFiles/workRoot/homeDir/allowReadPaths) — one
   *  resolution, two gateways. */
  confinement?: { allowHostPaths: readonly string[]; protectedFiles: readonly string[]; workRoot: string | undefined; homeDir?: string; allowReadPaths?: readonly string[] };
  /** D-F11 parity: the configurable default core tool set, forwarded from `defaultAllowedTools` in
   *  rwe.config.json. Omitted -> DEFAULT_ALLOWED_TOOLS. */
  defaultAllowedTools?: string[];
  /** Test/engine seam: overrides `node --experimental-transform-types <entryPath>` — a unit test
   *  injects a fake child process instead of spawning a real one. Omitted -> the real spawn below. */
  spawnChild?: typeof spawn;
  /** Test seam: overrides the resolved entry.ts path. */
  entryPath?: string;
  /** Test seam: overrides `resolveRipgrepOverride()` — a unit test injects a fake resolved override
   *  without depending on which `@anthropic-ai/claude-agent-sdk-*` platform package is installed. */
  resolveRipgrepOverride?: () => { command: string; argv0: 'rg' } | null;
  /** slice (i): overrides OpenRouter's base URL — a recording fake server stands in for
   *  `https://openrouter.ai/api/v1` so the request shape (model id, tools, `reasoning.effort`) can
   *  be verified with no real OpenRouter key. Omitted -> the real OpenRouter endpoint. */
  openrouterBaseUrl?: string;
}

/** `tool_call`/`tool_result` events carry their args/result JSON-stringified by the child (protocol.ts's
 *  own doc on why) — parsed back here defensively for the transcript consumer. */
function safeParse(json: string): unknown {
  try { return JSON.parse(json); } catch { return json; }
}

function resolveOpenrouterKey(config: PiGatewayConfig): string | undefined {
  return config.secretSource?.resolve('OPENROUTER_API_KEY') ?? process.env['RWE_SECRET_OPENROUTER_API_KEY'] ?? process.env['OPENROUTER_API_KEY'];
}

export class PiGatewayClient implements GatewayClient {
  private readonly _cliLifecycle = new RealCliLifecycle({});
  // research doc §3.1 "generalize the late binds": mirrors ClaudeAgentSdkGatewayClient's own
  // `_eventSink` exactly — a no-op default (nothing bound yet is NEVER confused with "did it"),
  // late-bound by server.ts's existing structural `BindableGateway` check (`bindable?.bindEventSink?.`),
  // which already calls this method on ANY gateway that implements it — no server.ts change needed.
  private _eventSink: EventSink = () => {};

  constructor(private readonly _config: PiGatewayConfig) {}

  /** Same shape/reason as `ClaudeAgentSdkGatewayClient.bindEventSink` — see that method's own doc. */
  bindEventSink(sink: EventSink): void {
    this._eventSink = sink;
  }

  /** slice (g): same shape/reason as `ClaudeAgentSdkGatewayClient.bindResolveMcp` — late-bound
   *  because the gateway is constructed in `composeConfig()`, before `createServer()` builds the
   *  asset catalog. Wired automatically by server.ts's existing structural `BindableGateway` check
   *  (`bindable?.bindResolveMcp?.(...)`) — no server.ts change needed, the same seam `bindEventSink`
   *  above already rides. */
  bindResolveMcp(resolve: ResolveMcpFn): void {
    (this._config as { resolveMcp?: ResolveMcpFn }).resolveMcp = resolve;
  }

  async invoke(req: {
    prompt: string; opts: AgentOpts; runId: string; agentId: string; signal?: AbortSignal; workspace?: string;
    assets?: { roots: { workflow: string; global: string }; declared: { skills: string[]; mcp: string[] }; workflow: string };
    onHarness?: (h: HarnessDescriptor, applied?: EffortApplied) => Promise<void>;
    onEvent?: (ev: TranscriptEvent) => void | Promise<void>;
    onUsage?: (cumulative: Tokens) => void;
    caps?: Caps;
  }): Promise<GatewayResult> {
    const ref = req.opts.model;
    const parsed = ref !== undefined ? parseModelRef(ref) : undefined;
    if (ref === undefined || !parsed) {
      return { ok: false, provider: 'unknown', reason: 'terminal', retryable: false, transport: 'pi', detail: `INTERNAL_ERROR: no valid model ref reached the pi gateway (got ${JSON.stringify(ref)}) — admission should have refused this dispatch` };
    }
    if (parsed.provider === 'anthropic') {
      // Defense in depth: admission (checkModelRef's harnessProviders gate) already refuses this
      // before a run ever reaches a gateway. A direct test construction or a future admission bug
      // must still fail closed here, never silently dispatch to a provider pi is not permitted to use.
      return { ok: false, provider: 'anthropic', reason: 'terminal', retryable: false, transport: 'pi', detail: 'PROVIDER_UNSUPPORTED_BY_HARNESS: the pi gateway never dispatches anthropic/* — this should have been refused at admission' };
    }
    if (req.signal?.aborted) {
      return { ok: false, provider: parsed.provider, reason: 'terminal', retryable: false, transport: 'pi', detail: 'aborted by caller before dispatch (run suspended or stopped)' };
    }
    const workspace = req.workspace ?? process.cwd();
    // review R2-1: the WHOLE agentDir-parent-plus-per-dispatch-dir build is wrapped here — a prior
    // iteration called `buildPiAgentDir()` with no try/catch at all, so any mkdir/chmod/lstat/mkdtemp
    // failure (e.g. AGENTDIR_UNAVAILABLE from `verifyPrivateDir`) escaped `invoke()` as a rejected
    // promise instead of the typed `GatewayResult` every OTHER refusal in this method returns.
    let agentDirParent: string;
    let agentDir: string;
    try {
      agentDirParent = piAgentDirParent(this._config.confinement?.workRoot);
      agentDir = buildPiAgentDirIn(agentDirParent);
    } catch (err) {
      return { ok: false, provider: parsed.provider, reason: 'terminal', retryable: false, transport: 'pi', detail: `AGENTDIR_UNAVAILABLE: ${err instanceof Error ? err.message : String(err)}` };
    }
    // review round 3, R3-1: the SAME shape, SAME reasoning, for a per-dispatch TMPDIR scratch — a
    // SEPARATE try/catch (not folded into the one above) so a failure here is reported with its own
    // distinct code (`TMPDIR_SCRATCH_UNAVAILABLE`) rather than being misread as an agentDir problem.
    let tmpDirParent: string;
    let tmpDir: string;
    try {
      tmpDirParent = piTmpDirParent(this._config.confinement?.workRoot);
      tmpDir = buildPiAgentDirIn(tmpDirParent);
    } catch (err) {
      removePiAgentDir(agentDir);
      return { ok: false, provider: parsed.provider, reason: 'terminal', retryable: false, transport: 'pi', detail: `TMPDIR_SCRATCH_UNAVAILABLE: ${err instanceof Error ? err.message : String(err)}` };
    }
    try {
      return await this._invokeWithWorkspace(req, parsed, workspace, agentDir, agentDirParent, tmpDir, tmpDirParent);
    } finally {
      removePiAgentDir(agentDir);
      removePiAgentDir(tmpDir);
    }
  }

  /** Split out of `invoke()` purely so `agentDir`'s cleanup (above) is a single `finally` around
   *  EVERY exit path of the rest of this method (every early refusal return, every attempt in the
   *  retry loop, success or failure) — never duplicated per return site. */
  private async _invokeWithWorkspace(
    req: {
      prompt: string; opts: AgentOpts; runId: string; agentId: string; signal?: AbortSignal; workspace?: string;
      assets?: { roots: { workflow: string; global: string }; declared: { skills: string[]; mcp: string[] }; workflow: string };
      onHarness?: (h: HarnessDescriptor, applied?: EffortApplied) => Promise<void>;
      onEvent?: (ev: TranscriptEvent) => void | Promise<void>;
      onUsage?: (cumulative: Tokens) => void;
      caps?: Caps;
    },
    parsed: NonNullable<ReturnType<typeof parseModelRef>>,
    workspace: string,
    agentDir: string,
    agentDirParent: string,
    tmpDir: string,
    tmpDirParent: string,
  ): Promise<GatewayResult> {
    // Project configuration another agent (or Bash on an unconfined host) left in the workspace is
    // removed before this child can ever be spawned — the SAME `sweepPlantedConfig`/
    // `PROJECT_CONFIG_PATHS` the sdk gateway uses (bash-confinement.ts), byte-identical to master.
    // review M1/B1 (reverted): this comment used to claim the swept set now ALSO covers `.pi`/
    // `.pi-agent-dir`/`.agents` — false since the revert (bash-confinement.ts's own
    // PROJECT_CONFIG_PATHS doc comment has the full story: pi's full-control ResourceLoader never
    // discovers those paths at all, so sweeping them bought no security and broke the sdk gateway's
    // own byte-identical contract). Unremovable (of the UNCHANGED set) -> refuse, never load it.
    let plantedConfigRemoved: string[] = [];
    try {
      plantedConfigRemoved = sweepPlantedConfig(workspace);
    } catch (err) {
      return { ok: false, provider: parsed.provider, reason: 'terminal', retryable: false, transport: 'pi', detail: `PLANTED_CONFIG_UNREMOVABLE: ${(err as Error).message} in the run workspace — refusing to start an agent that would load it` };
    }
    if (plantedConfigRemoved.length > 0) {
      this._eventSink({ kind: 'agent.planted_config_removed', runId: req.runId, agentId: req.agentId, attempt: 1, root: workspace, removed: plantedConfigRemoved });
    }

    const model: PiChildConfig['model'] =
      parsed.provider === 'ollama'
        ? { provider: 'ollama', model: parsed.model, baseUrl: this._config.ollamaBaseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434' }
        : { provider: 'openrouter', model: parsed.model };
    const apiKey = parsed.provider === 'openrouter' ? resolveOpenrouterKey(this._config) : undefined;
    if (parsed.provider === 'openrouter' && apiKey === undefined) {
      return { ok: false, provider: 'openrouter', reason: 'terminal', retryable: false, transport: 'pi', detail: 'OPENROUTER_AUTH_MISSING: no OpenRouter API key in the secret store (RWE_SECRET_OPENROUTER_API_KEY) or OPENROUTER_API_KEY env' };
    }

    // spec "Tool mapping": the engine tool surface for this call (opts.allowedTools, '[]' honored,
    // defaultAllowedTools otherwise) — mapped to pi names BEFORE a child is ever spawned.
    const requestedTools = req.opts.allowedTools ?? this._config.defaultAllowedTools ?? DEFAULT_ALLOWED_TOOLS;
    const mapped = mapTools(requestedTools);
    if (!mapped.ok) {
      return { ok: false, provider: parsed.provider, reason: 'terminal', retryable: false, transport: 'pi', detail: `TOOL_UNSUPPORTED_BY_HARNESS: ${mapped.unmapped.join(', ')} ${mapped.unmapped.length === 1 ? 'has' : 'have'} no mapping under the pi harness — only Read/Write/Edit/Bash/Grep/Glob/LS are supported` };
    }

    // spec "MCP": resolve declared MCP servers through the SAME shared resolver the sdk gateway uses
    // (`${secret:NAME}`/`${run:dir}`/`${run:id}` substitution — mcp-config-resolver.ts) — no second
    // implementation to drift. Owner 19.5.3 parity: a name that cannot be resolved lands in `missing`
    // and the run PROCEEDS (never a refusal) — `materializeAssets` folds skill-missing and mcp-missing
    // into the same list.
    let mcpConfigs: Record<string, McpServerConfig> = {};
    let materialized: { skills: string[]; mcp: string[]; missing: string[] } | undefined;
    if (req.assets !== undefined) {
      try {
        // `PiGatewayConfig.secretSource` only ever had `.resolve()` (the pre-existing OpenRouter-key
        // lookup) — `resolveMcpConfigs`'s shared `secretSource` param wants the full `SecretSource`
        // (it never calls `.names()` either, but the TYPE is shared verbatim with the sdk gateway, by
        // design, so it is not narrowed just for this one caller). A tiny adapter, not a cast: `.names()`
        // is never reachable from this path (`resolveConfig` never calls it), so a stub is honest.
        const secretSource: SecretSource | undefined = this._config.secretSource !== undefined
          ? { resolve: (name: string) => this._config.secretSource!.resolve(name), names: () => [] }
          : undefined;
        const mcpResolved = await resolveMcpConfigs({ resolveMcp: this._config.resolveMcp, secretSource }, req.assets.workflow, req.assets.declared.mcp, req.runId, workspace);
        mcpConfigs = mcpResolved.configs;
        materialized = await materializeAssets(req.assets.roots, workspace, req.assets.declared, async () => mcpResolved);
      } catch (err) {
        // Fail-loud contract (mcp-config-resolver.ts's own doc): an unresolved `${secret:...}` handle
        // on a provisioned MCP server is a clear, typed error — never a silent partial dispatch.
        return { ok: false, provider: parsed.provider, reason: 'terminal', retryable: false, transport: 'pi', detail: err instanceof Error ? err.message : String(err) };
      }
    }

    // spec "Skills" / research doc §4 "Requires read in the tool set": pi puts the skills listing
    // into the system prompt only when the dispatch's tool set includes a way to open SKILL.md — read
    // directly by `read.js:system-prompt.js`'s own `skillFileReadTool = ["read","bash"].find(tool =>
    // selectedTools.includes(tool))`, confirmed by reading the installed package (NOT identity/
    // instanceof against pi's built-ins — a name match against OUR custom tool names, which is why
    // our own `read`/`bash` names satisfy it exactly like pi's built-ins would). A dispatch with
    // NEITHER tool therefore materializes a skill the model is never even told exists (no separate
    // Skill tool exists on pi, unlike the sdk gateway) — refused clearly rather than silently shipping
    // dead weight (decided + documented, spec "Skills": "decide and document"; the alternative
    // considered was auto-adding a jailed read scoped to the skill dir, rejected for v1 as a second,
    // narrower read-tool definition with different containment semantics than the one real `read`
    // tool everywhere else in this file — not worth the surface for v1).
    if ((materialized?.skills.length ?? 0) > 0 && !mapped.piNames.includes('read') && !mapped.piNames.includes('bash')) {
      return { ok: false, provider: parsed.provider, reason: 'terminal', retryable: false, transport: 'pi', detail: `SKILL_REQUIRES_READ_TOOL: ${materialized!.skills.join(', ')} ${materialized!.skills.length === 1 ? 'was' : 'were'} materialized but this dispatch's tool set has neither 'read' nor 'bash' — pi only lists a skill in its system prompt when one of those two tools is present (no separate Skill tool exists on pi); add Read or Bash to allowedTools, or drop the skill` };
    }

    // spec "Bash" / issue #78(c) parity: bash:'readonly' is only ever dispatched with the kernel
    // enforcing it — refused BEFORE any child is spawned, the same shape as the sdk gateway.
    const bashRefusal = readonlyBashRefusal({ bash: req.opts.bash, tools: requestedTools, posture: this._config.confinementPosture, root: workspace });
    if (bashRefusal !== null) {
      return { ok: false, provider: parsed.provider, reason: 'terminal', retryable: false, transport: 'pi', detail: bashRefusal };
    }

    // spec "Confinement posture": sandbox is built ONLY when this engine measured `confined` at boot
    // (the pi-path probe — a SEPARATE measurement from the sdk gateway's own) — absent, the child's
    // bash tool runs unwrapped, never a claimed confinement with no evidence (session-runner.ts's
    // own `config.sandbox !== undefined` branch).
    let sandbox: PiChildSandboxConfig | undefined;
    if (this._config.confinementPosture === 'confined' && mapped.piNames.includes('bash')) {
      // review round 4 (R4-2, owner ruling): a WARNING, never a refusal — see `PI_HOST_SHARED_TMPDIR`'s
      // own doc for the full "why" dropping the round-3 refusal is safe (denyWrite below already
      // closes the one channel that mattered, even under TOCTOU). Checked BEFORE building the sandbox
      // config purely so the warning always fires regardless of what buildBashConfinement() returns.
      if (hostSharedTmpdirPresent()) {
        this._eventSink({ kind: 'agent.host_shared_tmpdir_present', runId: req.runId, agentId: req.agentId, attempt: 1, path: PI_HOST_SHARED_TMPDIR });
      }
      const settings = buildBashConfinement({
        root: workspace,
        grantedHostPaths: this._config.confinement?.allowHostPaths ?? [],
        protectedFiles: this._config.confinement?.protectedFiles ?? [],
        workRoot: this._config.confinement?.workRoot,
        homeDir: this._config.confinement?.homeDir ?? process.env['HOME'],
        allowReadPaths: this._config.confinement?.allowReadPaths ?? [],
        ...(req.opts.bash === 'readonly' ? { bashMode: 'readonly' as const } : {}),
      });
      const ripgrepOverride = (this._config.resolveRipgrepOverride ?? resolveRipgrepOverride)();
      const fs = settings.filesystem as PiChildSandboxConfig['filesystem'];
      sandbox = {
        // review M4: deny the WHOLE agentDir PARENT (every dispatch's agentDir lives under it), not
        // just this dispatch's own subdirectory — a confined Bash's deny-by-default reads are scoped
        // to explicitly denied directories, so denying only "mine" left every sibling dispatch's
        // agentDir (and its mcp.log, which can carry another run's MCP-server-controlled data)
        // readable by anyone sharing os.tmpdir(). agentDir itself is never in `allowRead`/
        // `allowWrite` to begin with; this is the actual control, not belt-and-suspenders.
        // review R2-1: the ALREADY-VERIFIED parent `invoke()` computed once for this dispatch —
        // never recomputed here (which would mean a second mkdir/chmod/lstat round trip per
        // dispatch for no benefit; the value is identical either way, since both reads resolve the
        // SAME `confinement.workRoot`).
        // review round 3, R3-1: `tmpDirParent` denied the same way as `agentDirParent` — one
        // dispatch's TMPDIR scratch must not be readable from another's confined Bash.
        //
        // Denying `tmpDirParent` for READ alone is not enough to make `tmpDir` itself usable (found
        // live, via cmd-drive.mts): srt's write policy is a pure ALLOWLIST (nothing is writable
        // unless named in `allowWrite`, unlike the read policy's deny-by-exception model), and
        // `tmpDir` sits under `workRoot`, which is never itself in `allowWrite`. Without the two
        // lines below, `mktemp` failed with ENOENT even though `TMPDIR` correctly pointed at it — the
        // directory existed on the HOST but bwrap never bound it in at all. `allowRead` RE-OPENS this
        // dispatch's own leaf within `tmpDirParent`'s denyRead above (srt's own documented "allowRead
        // within a denied region" rule — confirmed live), so a SIBLING dispatch's `d-*` directory
        // stays invisible while this one is fully usable.
        //
        // `/tmp/claude` is deliberately NOT in `denyRead` here — see `PI_HOST_SHARED_TMPDIR`'s own
        // doc for why that would be a no-op (srt's unconditional write-bind for it wins over a later
        // read-deny mask), and `hostSharedTmpdirPresent()`, called above, only warns rather than
        // trying to fix that (round 4 owner ruling). `denyWrite` DOES still work against that same
        // unconditional bind (confirmed live, including under TOCTOU — round 4) and is the actual
        // control: it makes an existing `/tmp/claude` read-only, never a write channel between runs.
        filesystem: {
          ...fs,
          allowRead: [...fs.allowRead, tmpDir],
          allowWrite: [...fs.allowWrite, tmpDir],
          denyRead: [...fs.denyRead, agentDirParent, tmpDirParent],
          denyWrite: [...fs.denyWrite, PI_HOST_SHARED_TMPDIR],
        },
        credentials: settings.credentials as PiChildSandboxConfig['credentials'],
        ripgrepOverride,
      };
    }

    // spec "Effort": effort maps directly onto pi's thinkingLevel (session-runner.ts). applied:true
    // is claimed ONLY where VERIFIED — openrouter's reasoning.effort field was confirmed on the real
    // outbound wire through the full session path in this iteration's own real-tier evidence
    // (tests/acceptance/pi-harness-openrouter-fake-server.test.ts), stronger than pi-spike-report.md
    // S8's raw completeSimple() check. ollama has no reasoning dial at all (PROVIDER_CAPS.ollama.effort
    // is null) — effort is accepted but never reaches the wire.
    const effortApplied: { applied: true; param: string; restPath: string[]; value: unknown } | { applied: false; reason: string } | undefined =
      req.opts.effort === undefined
        ? undefined
        : parsed.provider === 'openrouter'
          ? { applied: true, param: 'thinkingLevel', restPath: ['reasoning', 'effort'], value: req.opts.effort }
          : { applied: false, reason: 'ollama has no reasoning dial' };

    // Captured (not just dispatched) so the SECOND onHarness call below — once the child's `mcp_init`
    // event arrives with the real turn-1 tool list (issue #106 parity: `summarizeMcpInit`) — can
    // merge `mcpStatus`/`warnings` onto the SAME base descriptor, mirroring the sdk gateway's own
    // eager-then-init-refined onHarness shape.
    const baseDescriptor: HarnessDescriptor = {
      ...redactHarness({
        surfaceType: 'curated', modelName: parsed.model, provider: parsed.provider, prompt: req.prompt, curatedTools: requestedTools,
        mergedMcp: Object.keys(mcpConfigs).map((name) => ({ name })),
        skills: materialized?.skills ?? [],
      }),
      harnessVersion: PI_HARNESS_VERSION,
      ...(plantedConfigRemoved.length > 0 ? { plantedConfigRemoved } : {}),
      ...(materialized !== undefined ? { materialized } : {}),
      ...(mapped.piNames.includes('bash')
        ? { bash: { mode: (req.opts.bash === 'readonly' ? 'readonly' : 'full') as 'readonly' | 'full', enforced: this._config.confinementPosture === 'confined' } }
        : {}),
      ...(effortApplied !== undefined
        ? { effortApplied: effortApplied.applied ? { param: effortApplied.param, value: effortApplied.value } : { reason: effortApplied.reason } }
        : {}),
    };
    if (req.onHarness) {
      await req.onHarness(baseDescriptor, effortApplied);
    }

    const childConfig: PiChildConfig = {
      runId: req.runId,
      agentId: req.agentId,
      prompt: req.prompt,
      model,
      ...(apiKey !== undefined ? { apiKey } : {}),
      cwd: workspace,
      agentDir,
      tmpDir,
      systemPrompt: 'You are a helpful assistant.',
      tools: mapped.piNames,
      protectedFiles: [...(this._config.confinement?.protectedFiles ?? [])],
      ...(sandbox !== undefined ? { sandbox } : {}),
      ...(req.opts.bash === 'readonly' ? { bashMode: 'readonly' as const } : {}),
      ...(req.opts.effort !== undefined ? { effort: req.opts.effort } : {}),
      ...(this._config.openrouterBaseUrl !== undefined ? { openrouterBaseUrl: this._config.openrouterBaseUrl } : {}),
      ...(Object.keys(mcpConfigs).length > 0 ? { mcp: mcpConfigs } : {}),
      ...((materialized?.skills.length ?? 0) > 0 ? { skillPaths: materialized!.skills.map((name) => join(workspace, '.claude', 'skills', name)) } : {}),
    };

    const effTimeout = resolveTimeout(req.opts.timeoutMs) ?? this._config.timeoutMs;

    // DES-249 (attemptsFor — the ONE formula every GatewayClient conformer uses, client.ts): an
    // untimed call gets exactly one attempt; a timed call gets `1 + retries`. Childconfig/sandbox/
    // onHarness above are computed ONCE (they do not vary across attempts — the sandbox POLICY and
    // the curated tool surface are facts about this call, not about which attempt is in flight), but
    // each attempt gets its OWN `agent.confinement` line (mirrors the sdk gateway's own "once per
    // ATTEMPT, not once per call" discipline — v37/DES-256) and its own spawned child.
    const attempts = attemptsFor(this._config.retries, effTimeout);
    let last: GatewayResult = { ok: false, provider: parsed.provider, reason: 'terminal', transport: 'pi', retryable: false, detail: 'INTERNAL_ERROR: attemptsFor() returned 0 — no attempt was ever made' };
    let carried: Tokens = { ...ZERO_TOKENS };
    let carriedPartial = false;
    for (let i = 0; i < attempts; i++) {
      this._eventSink({
        kind: 'agent.confinement',
        runId: req.runId,
        agentId: req.agentId,
        attempt: i + 1,
        posture: this._config.confinementPosture === 'confined' ? 'confined' : 'unconfined',
        root: workspace,
        allowWrite: sandbox?.filesystem.allowWrite ?? [],
        denyRead: sandbox?.filesystem.denyRead ?? [],
        enabled: sandbox !== undefined,
        failIfUnavailable: false,
        harnessVersion: PI_HARNESS_VERSION,
      });
      const base = carried;
      let settledThisAttempt = false;
      // issue #127 / v035 L-1 parity: snapshot `carried` per attempt and stop forwarding this
      // attempt's own onUsage once IT has settled — the exact same race `claude-agent-sdk-client.ts`'s
      // own retry loop guards against (a superseded attempt's late frame re-adding already-folded
      // tokens a second time).
      const attemptReq = req.onUsage === undefined ? req : {
        ...req,
        onUsage: (cum: Tokens) => {
          if (settledThisAttempt) return;
          req.onUsage!(addTokens(base, cum));
        },
      };
      last = await this._dispatchOnce(childConfig, parsed.provider, attemptReq, effTimeout, { attempt: i + 1, baseDescriptor });
      settledThisAttempt = true;
      if (last.ok) {
        const total = addTokens(carried, normalizeTokens(last.tokens));
        return carriedPartial ? { ...last, tokens: total, partial: true } : { ...last, tokens: total };
      }
      if (last.tokens) {
        carried = addTokens(carried, normalizeTokens(last.tokens));
        if (last.partial === true) carriedPartial = true;
      }
      if (!last.ok && last.retryable === false) break;
      if (req.signal?.aborted) break;
    }
    if (!last.ok && carried.input + carried.output + carried.cacheRead + carried.cacheWrite > 0) {
      return carriedPartial ? { ...last, tokens: carried, partial: true } : { ...last, tokens: carried };
    }
    return last;
  }

  private async _dispatchOnce(
    childConfig: PiChildConfig,
    provider: string,
    req: { runId: string; agentId: string; signal?: AbortSignal; onEvent?: (ev: TranscriptEvent) => void | Promise<void>; onUsage?: (cumulative: Tokens) => void; onHarness?: (h: HarnessDescriptor, applied?: EffortApplied) => Promise<void> },
    timeoutMs: number | undefined,
    mcpCtx?: { attempt: number; baseDescriptor: HarnessDescriptor },
  ): Promise<GatewayResult> {
    const spawnImpl = this._config.spawnChild ?? spawn;
    const entryPath = this._config.entryPath ?? ENTRY_PATH;
    const child = spawnImpl('node', ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', entryPath], {
      cwd: childConfig.cwd,
      env: buildChildEnv(childConfig.agentDir),
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Captured now (not read off `child` again later): some fake-process test doubles clear `.pid`
    // after 'exit' fires, and the real node ChildProcess keeps it, but the sweep below must work
    // identically either way.
    const childPid = child.pid;
    let stderrTail = '';
    child.stderr?.on('data', (d: Buffer) => { stderrTail = (stderrTail + d.toString()).slice(-4096); });
    const reap = (): void => {
      if (child.pid === undefined) return;
      try { this._cliLifecycle.killGroup({ pid: child.pid }); } catch { /* group already gone */ }
    };
    child.once('exit', reap);
    // The child's whole config (including a secret API key, when present) rides on stdin, never a
    // CLI arg (argv is visible to every other process on the host via /proc) and never an env var
    // (bash-env.ts's allowlist has no provider-key entry at all — the two must never meet).
    child.stdin?.write(JSON.stringify(childConfig) + '\n');
    child.stdin?.end();

    let timedOut = false;
    const timer = timeoutMs !== undefined
      ? setTimeout(() => {
          timedOut = true;
          // Captured BEFORE any kill signal, while the tree is still fully alive — see
          // killDescendantsBestEffort's own doc.
          killDescendantsBestEffort(child.pid);
          try { child.kill('SIGTERM'); } catch { /* already gone */ }
          reap();
        }, timeoutMs)
      : undefined;
    child.once('exit', () => { if (timer) clearTimeout(timer); });
    const onAbort = (): void => {
      killDescendantsBestEffort(child.pid);
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      reap();
    };
    req.signal?.addEventListener('abort', onAbort, { once: true });

    let cumulative: Tokens = { ...ZERO_TOKENS };
    let settled: GatewayResult | undefined;

    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      let event: PiChildEvent;
      try { event = JSON.parse(line) as PiChildEvent; } catch { return; }
      if (event.t === 'message_end') {
        cumulative = {
          input: cumulative.input + event.usage.input,
          output: cumulative.output + event.usage.output,
          cacheRead: cumulative.cacheRead + event.usage.cacheRead,
          cacheWrite: cumulative.cacheWrite + event.usage.cacheWrite,
        };
        req.onUsage?.(cumulative);
        void req.onEvent?.({ ts: new Date().toISOString(), kind: 'message', data: { text: event.text, role: 'assistant' } });
      } else if (event.t === 'final') {
        settled = { ok: true, provider, model: childConfig.model.model, transport: 'pi', tokens: cumulative, content: event.text };
      } else if (event.t === 'error' || event.t === 'fatal') {
        // rest of slice (f) "Error classification": `fatal` is a child-side programming defect
        // (INTERNAL_ERROR: bad config, uncaught throw — session-runner.ts documents every ordinary
        // dispatch failure as `{t:'error'}` instead) — never worth retrying. An `error` event's
        // message is classified by `classifyPiErrorMessage` (401/403/404 -> terminal).
        const retryable = event.t === 'fatal' ? false : classifyPiErrorMessage(event.message) !== 'terminal';
        // residual fix (#127): an `error` event's OWN usage (present exactly when it came from a real
        // `stopReason:'error'` assistant message — spike S4 confirms usage is real even then) is
        // folded into `cumulative` BEFORE this attempt settles, same as every `message_end` above —
        // never silently dropped. A `fatal` event carries no usage field at all (nothing to fold).
        if (event.t === 'error' && event.usage !== undefined) {
          cumulative = {
            input: cumulative.input + event.usage.input,
            output: cumulative.output + event.usage.output,
            cacheRead: cumulative.cacheRead + event.usage.cacheRead,
            cacheWrite: cumulative.cacheWrite + event.usage.cacheWrite,
          };
          req.onUsage?.(cumulative);
        }
        settled = {
          ok: false, provider, reason: 'terminal', transport: 'pi', detail: event.message, tokens: cumulative,
          ...(retryable ? {} : { retryable: false as const }),
          ...(cumulative.input > 0 || cumulative.output > 0 ? { partial: true as const } : {}),
        };
      } else if (event.t === 'tool_call') {
        void req.onEvent?.({ ts: new Date().toISOString(), kind: 'tool_call', data: { toolCallId: event.toolCallId, toolName: event.toolName, args: safeParse(event.argsJson) } });
      } else if (event.t === 'tool_result') {
        void req.onEvent?.({ ts: new Date().toISOString(), kind: 'tool_result', data: { toolCallId: event.toolCallId, toolName: event.toolName, result: safeParse(event.resultJson), isError: event.isError } });
      } else if (event.t === 'mcp_init' && mcpCtx !== undefined) {
        // Issue #106 parity, pi shape: the child's ONLY observable turn-1 signal (spike S5 — no
        // connection-status API exists) is which `mcp__<server>__*` tools are active. A synthetic
        // `mcp_servers` status is built from that same prefix match (declared.mcpServers comes off
        // the EAGER descriptor already sent, so it is exactly the server names this dispatch
        // registered) and fed through the SAME `summarizeMcpInit` the sdk gateway uses — one
        // MCP_SERVER_NOT_CONNECTED warning shape for both gateways.
        const declared = mcpCtx.baseDescriptor.mcpServers;
        const hasToolsFor = (name: string): boolean => {
          const prefixes = [`mcp__${name}__`, `mcp__${name.replace(/[^A-Za-z0-9_-]/g, '_')}__`];
          return event.activeTools.some((t) => prefixes.some((p) => t.startsWith(p)));
        };
        const { mcpStatus, warnings } = summarizeMcpInit(declared, {
          tools: event.activeTools,
          mcp_servers: declared.map((name) => ({ name, status: hasToolsFor(name) ? 'connected' : 'unknown' })),
        });
        void req.onHarness?.({ ...mcpCtx.baseDescriptor, mcpStatus, ...(warnings.length > 0 ? { warnings } : {}) });
        for (const w of warnings) {
          const tools = mcpStatus.find((m) => m.server === w.server)?.tools.length ?? 0;
          this._eventSink({ kind: 'agent.mcp_not_connected', runId: req.runId, agentId: req.agentId, attempt: mcpCtx.attempt, server: w.server, status: w.status, tools });
        }
      }
    });

    const exitCode: { code: number | null; signal: NodeJS.Signals | null } = await new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
      child.once('error', () => resolve({ code: null, signal: null }));
    });
    rl.close();
    req.signal?.removeEventListener('abort', onAbort);
    // residual fix (srt-mux socket leak): unconditional, before any branch below returns — every
    // path through this dispatch (settled ok, settled error, aborted, timed out, or a bare exit with
    // no event at all) may have initialized srt's mux proxy inside the child.
    if (childPid !== undefined) sweepSrtMuxSockets(childPid);

    if (settled) return settled;
    if (req.signal?.aborted) {
      return { ok: false, provider, reason: 'aborted', transport: 'pi', tokens: cumulative, ...(cumulative.input > 0 || cumulative.output > 0 ? { partial: true as const } : {}) };
    }
    if (timedOut) {
      return { ok: false, provider, reason: 'timeout', transport: 'pi', tokens: cumulative, ...(cumulative.input > 0 || cumulative.output > 0 ? { partial: true as const } : {}) };
    }
    return {
      ok: false, provider, reason: 'terminal', transport: 'pi', retryable: false,
      detail: `pi child exited before reporting a result (code ${exitCode.code ?? 'null'}, signal ${exitCode.signal ?? 'null'})` + (stderrTail.trim() ? `\n--- child stderr (tail) ---\n${stderrTail.trim()}` : ''),
      tokens: cumulative,
    };
  }

  async stop(): Promise<void> {
    // No managed subprocess owned at the gateway level — each dispatch's child is reaped per-call
    // above (group-killed on exit/timeout/abort), never held past its own invoke() call.
  }
}
