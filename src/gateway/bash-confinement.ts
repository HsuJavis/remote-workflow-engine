// src/gateway/bash-confinement.ts (DES-252/254, ARCH-175, TASK-251, REQ-218): the whole confinement
// POSTURE as one pure function, plus the boot-time grant validator it is built on. PURE — no fs, no
// process, no env, no clock. Imports SandboxSettings TYPE-ONLY from the SDK (the compiler is the
// only guard against a renamed field). See src/gateway/confinement-probe.ts (impure) for the
// SEPARATE, host-measured question of whether the kernel can actually enforce this object at all —
// that answer decides WHETHER this builder's output is even handed to `query()` (ARCH-181/DES-262),
// never what it contains.
import type { SandboxSettings } from '@anthropic-ai/claude-agent-sdk';
import { basename, dirname, join, resolve } from 'node:path';
import { isPathContained } from '../path-containment.js';

// Issue #101 (supersedes ARCH-175's 'enumerated' bridge): Bash READS are deny-by-default. The
// CLI's sandbox builder turns each `denyRead` directory into a `--tmpfs` over it and then re-binds
// every `allowRead`/`allowWrite` path that lives inside it — measured on a confined host (bwrap +
// socat, CLI 2.1.283, docs/evidence/issue-101-read-confinement.md): with `denyRead: [$HOME,
// workRoot]` and `allowRead: [workspace, toolchain]`, the agent reads its own workspace and runs
// node/npm/python3/git, while another run's workspace, `~/.claude/.credentials.json`,
// `~/.claude.json`, `~/.gitconfig` and workRoot's engine state are all unreadable. That positive
// result is the one spike S7 could not get, so the old 'enumerated' arm (a list of engine-state
// names under workRoot) and its ENGINE_STATE_DENY bridge are deleted, as ARCH-175 prescribed.

// Fixed by spike S8 (blocked by the same S1 finding — could not measure whether masking survives
// the CLI's own authentication). A parameter, never a config key.
export const MASK_PROVIDER_ENV = false;

/** Workspace-relative paths the Claude CLI reads as PROJECT configuration from its cwd (= the run
 *  workspace, `settingSources:['project']`) and that can run code or widen what a later agent may do.
 *  The list is the CLI's own: 2.1.199's sandbox builder puts exactly these (minus `.mcp.json`) on its
 *  own denyWrite for every project root. Why each is dangerous, not merely prompt text:
 *  - `settings.json`: `hooks` (commands run by the CLI, outside any sandbox), `permissions.allow`,
 *    `sandbox.filesystem.allowWrite`, `env`, `apiKeyHelper`, `enabledPlugins`.
 *  - `settings.local.json`: the same schema; inert today (`'local'` is not in `settingSources`), kept
 *    so widening `settingSources` later does not silently open it.
 *  - `hooks/`: the scripts settings hooks point at.
 *  - `agents/`, `commands/`: sub-agent / command definitions — tool grants, permission mode, hooks,
 *    inline `!cmd` shell.
 *  - `workflows/`, `routines/`, `scheduled_tasks.json`, `launch.json`: things the CLI runs or
 *    schedules on its own (`launch.json` is a dev-server command the CLI's Write auto-approves).
 *  - `.mcp.json`: **issue #128** — not a CLI-execution risk (`strictMcpConfig:true` means the CLI
 *    never LOADS a project `.mcp.json` even when one exists), but a CONFIDENTIALITY one: the engine
 *    itself never writes this file any more (`materializeAssets`, claude-agent-sdk-client.ts), so
 *    one appearing here can only be an earlier agent (or Bash, on an unconfined host) planting a
 *    global server's resolved config — including a `${secret:NAME}` handle's real value — somewhere
 *    `workspace_pull` can read it back out. Swept like every other entry here, not left for an
 *    engine rewrite that no longer happens.
 *  - `.claude/skills`: **issue #144** — the SAME shape as `.mcp.json` above, moved here for the SAME
 *    reason: the engine no longer materializes a declared skill into the workspace at all (it goes to
 *    a private per-dispatch directory outside it, loaded via the SDK's `plugins` option —
 *    `claude-agent-sdk-client.ts`'s own doc comment on `materializeAssets` has the full story), so a
 *    `.claude/skills/<name>/` appearing HERE can only be an earlier (pre-#144) engine's leftover or
 *    something an agent/Bash planted — never the engine's own current output. Swept unconditionally,
 *    like `.mcp.json` — no longer left alone for a per-dispatch rewrite that no longer happens.
 *  NOT here, and why: `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, `.claude/rules/`,
 *  `.claude/output-styles/` are prompt text — they change what the next agent reads, never what it
 *  may do (their `@import` of a file OUTSIDE the project needs a per-project approval the headless
 *  CLI never gives). The engine sweeps these paths before every dispatch (project-config-guard.ts). */
export const PROJECT_CONFIG_PATHS = [
  '.claude/settings.json', '.claude/settings.local.json', '.claude/hooks', '.claude/agents', '.claude/commands',
  '.claude/workflows', '.claude/routines', '.claude/scheduled_tasks.json', '.claude/launch.json', '.mcp.json',
  '.claude/skills',
] as const;

// Issue #148: the SAME `PROJECT_CONFIG_PATHS` entries, each tagged with its on-disk TYPE, so
// `project-config-guard.ts`'s `prepareDispatchMountTargets` can pre-create whichever of them is
// still missing as the correct empty node — mirrors `READONLY_MOUNT_TARGETS` just below, for a
// DIFFERENT denyWrite set (this one is `settingsFiles`, bound on every non-readonly confined Bash
// call per-entry — see `buildBashConfinement`'s own `denyWrite` comment for why readonly needs no
// equivalent: there, `root` alone is already denyWrite'd, so bwrap can never reach a still-missing
// child path to lazily create it in the first place). Kept as a literal map rather than derived
// from the extension (`.json` vs not) — `.claude/skills` has no extension and `.claude/hooks` etc.
// are directories by convention only, not by any syntactic signal this list should re-derive.
export const PROJECT_CONFIG_MOUNT_TARGETS: readonly { readonly rel: (typeof PROJECT_CONFIG_PATHS)[number]; readonly kind: 'dir' | 'file' }[] = [
  { rel: '.claude/settings.json', kind: 'file' },
  { rel: '.claude/settings.local.json', kind: 'file' },
  { rel: '.claude/hooks', kind: 'dir' },
  { rel: '.claude/agents', kind: 'dir' },
  { rel: '.claude/commands', kind: 'dir' },
  { rel: '.claude/workflows', kind: 'dir' },
  { rel: '.claude/routines', kind: 'dir' },
  { rel: '.claude/scheduled_tasks.json', kind: 'file' },
  { rel: '.claude/launch.json', kind: 'file' },
  { rel: '.mcp.json', kind: 'file' },
  { rel: '.claude/skills', kind: 'dir' },
] as const;

// Issue #131: the Claude CLI's bundled sandbox is the SAME code as @anthropic-ai/sandbox-runtime
// (srt), which hardcodes the literal `/tmp/claude` into its OWN always-writable path list
// (`SANDBOX_OWN_WRITE_PATHS` in srt's sandbox-utils.js — "what the sandbox itself needs" by srt's
// own doc comment, never excludable through any public `SandboxConfig` field). This is a DIFFERENT
// path from `/tmp/claude-<uid>` (the CLI's own per-uid scratch, issue #101, handled separately by
// `sharedCliScratch`/`CLI_SCRATCH_DIR` below) — `/tmp/claude` has no uid suffix and is whatever any
// local user (or another CLI invocation) created. Left unguarded, any confined Bash call writes
// through it freely: a cross-run, cross-principal shared channel, exactly the class the pi gateway
// (`pi-gateway-client.ts`'s own `PI_HOST_SHARED_TMPDIR` doc has the full live-verified story)
// already closed with `denyWrite:['/tmp/claude']` — srt's write-allow for it is a static literal,
// but `denyWrite` wins inside that allow set (same mechanism documented just below for
// `settingsFiles`), confirmed live under TOCTOU on the pi path. Folded into THIS shared builder
// (rather than left for each gateway to bolt on) so the sdk gateway gets it for free and pi's own
// call site no longer needs to append it a second time. Read-only exposure is unaffected (the same
// as every other host `/tmp` path already was) and nothing on the host is ever created, deleted or
// masked — `host-shared-tmpdir.ts`'s `hostSharedTmpdirPresent()` is a separate, purely VISIBILITY
// check (an `agent.host_shared_tmpdir_present` warning event) each gateway calls on its own, never
// a refusal and never anything this pure module does itself.
export const HOST_SHARED_TMPDIR = '/tmp/claude';

// Issue #133: siblings of #131's HOST_SHARED_TMPDIR. srt's own `getDefaultWritePaths`
// (sandbox-utils.js) ALSO unconditionally lists `~/.npm/_logs` and `~/.claude/debug` — resolved
// from `os.homedir()`, i.e. the sandboxed CLI subprocess's own HOME, which `ENV_ALLOWLIST` (both
// gateways) passes straight through from this engine's `homeDir` — on its always-writable list,
// the same `SANDBOX_OWN_WRITE_PATHS`/`HOME_CONVENIENCE_WRITE_DIRS` doc comment says "what the
// sandbox itself needs", never excludable through any public `SandboxConfig` field. Measured on the
// production host (docs/evidence/issue-101-read-confinement.md, "home" variant): the captured bwrap
// argv binds `~/.claude/debug` with a plain `--bind` (read-write), not `--ro-bind`, even with
// `~/.claude/debug` itself ADDED to `denyRead` — this engine's bundled CLI (2.1.199 via SDK 0.3.199)
// embeds its OWN compiled copy of srt, not the `@anthropic-ai/sandbox-runtime` package on disk (a runtime dependency, but loaded only by the pi gateway)
// (0.0.78's own `homeDirsNotReadDenied` WOULD exclude a denyRead-covered convenience dir — that
// newer logic is simply not what ships inside the CLI binary this engine spawns). The measured host
// CLI is the ground truth here, not the npm package version string. Two concurrent runs sharing this
// engine's HOME can otherwise read/write each other's content through either directory — a
// cross-run, cross-principal channel, same class as #131. `denyWrite` wins inside srt's own
// write-allow set (the same mechanism #131 relies on for `/tmp/claude`), so appending these closes
// it without touching the CLI PROCESS's own (unsandboxed) debug-log writes, which never go through
// Bash. Live-reverified after this fix (throwaway engine, confined, `anthropic/claude-haiku-4-5-
// 20251001`, both directories pre-seeded with a planted file): a write from confined Bash into
// either now fails `Read-only file system`, a second run sees no trace of the first's attempt, and
// the run itself still completes. Also checked the OTHER direction — the production shape left by
// `deploy/migrate-to-service-user.sh`'s own deletion of both directories (ARCH-176: an absent
// denyWrite target must not crash the mount, same bug class as #95's readonly mount-target prep):
// with `~/.claude/debug` genuinely absent for the whole dispatch, the run still completed normally
// (no bwrap failure) — `~/.npm/_logs` could not be isolated the same way in that same run (the
// engine's own `npm run start` recreates it, unsandboxed, before any dispatch reaches the sandbox
// builder at all) but is resolved through the exact same `HOME_CONVENIENCE_WRITE_DIRS` array and the
// same srt code path, never special-cased between the two entries.
export const HOME_CONVENIENCE_WRITE_DIRS = ['.npm/_logs', '.claude/debug'] as const;

/** Issue #133: `HOME_CONVENIENCE_WRITE_DIRS` resolved against this call's `homeDir` — `[]` when
 *  `homeDir` is absent (nothing to resolve against, same as every other optional path in this
 *  module). */
function homeConvenienceWritePaths(homeDir: string | undefined): string[] {
  return isNonEmptyString(homeDir) ? HOME_CONVENIENCE_WRITE_DIRS.map((rel) => join(homeDir, rel)) : [];
}

// pi harness v1 review (M1/B1): a `.pi`/`.pi-agent-dir`/`.agents` entry was ADDED here in an earlier
// iteration — reverted. This list is SHARED with the sdk gateway (sweepPlantedConfig, Bash denyWrite,
// toolUsePreCheck's protectedConfigTarget all key off it), and the sdk gateway must stay byte-
// identical: `tests/unit/bash-readonly-gateway.test.ts`'s own "no bashMode ⇒ byte-identical to
// before" pin went red the moment this list grew (11 -> 14 denyWrite entries) — a real regression the
// previous iteration's own `bash-confinement.test.ts` update masked by also changing its expectation,
// instead of noticing the list is shared. Verified live (review M1): `DefaultResourceLoader` given a
// planted `.pi/settings.json` (with `extensions` + local/npm `packages`) and a `.pi/extensions/
// evil.ts` loaded NEITHER — pi's full-control ResourceLoader (`noContextFiles`/`noExtensions`/
// `noSkills` in session-runner.ts) never discovers anything under the workspace, and agentDir now
// lives entirely outside it (a separate fix, M4) — so a planted `.pi`/`.pi-agent-dir`/`.agents` is
// INERT under pi: there is no file to sweep that pi would ever load. No pi-only sweep was added
// either, for the same reason the sdk-shared one was reverted: "keep minimal" means not adding a
// sweep with zero proven security benefit. If a FUTURE pi embedding ever adds real discovery
// (`DefaultResourceLoader` with `noContextFiles:false`, or any built-in extension that reads project
// files), this decision needs revisiting alongside that change, not before.

// Issue #144: this list used to hold `.claude/skills` — "project configuration the ENGINE writes
// (skills materialized per dispatch)", left alone by the sweep because it was the engine's own
// output, rewritten fresh on every dispatch. The engine no longer writes a workspace `.claude/skills`
// at all (skills materialize into a private per-dispatch directory outside the workspace — see
// `materializeAssets`'s own doc comment, claude-agent-sdk-client.ts), so there is no longer anything
// for this list to protect from the sweep — exactly the `.mcp.json`/issue #128 precedent repeated: a
// list that used to mean "the engine's own output, leave it" is now empty because the engine stopped
// writing there, and the entry moved into `PROJECT_CONFIG_PATHS` above (swept unconditionally) rather
// than this type ever having an empty array with nothing left to hold.

/** Issue #95: workspace-relative paths the Claude CLI's OWN sandbox builder (2.1.199 — `claude
 *  --version`) unconditionally shields from Bash writes, on top of anything THIS module passes via
 *  `filesystem.denyWrite` — never configurable, never derived from `PROJECT_CONFIG_PATHS` (none of
 *  these are this engine's own project-configuration set; they are dev-tooling/rc-file paths that
 *  would run code or change trust on the NEXT shell/editor to read them: `.bashrc`/`.bash_profile`/
 *  `.zshrc`/`.zprofile`/`.profile` run on shell startup, `.gitconfig`/`.gitmodules` can point git at
 *  attacker-controlled hooks/submodules, `.vscode`/`.idea` carry per-workspace editor trust/task
 *  config). Measured, not guessed from the binary's strings: a real bwrap-argv capture (a `bwrap`
 *  PATH shim logging `"$@"` before `exec`ing the real binary, one real readonly-Bash `agent()` call
 *  against a real seeded+confined run) showed the CLI mounts a `/dev/null` (file) or empty-tmpfs
 *  (dir) placeholder over every one of these that is still missing, in this exact order, and — this
 *  is the bug — AFTER the workspace root's own `--ro-bind`. In every OTHER dispatch that ordering is
 *  invisible: the CLI seeds the session cwd writable by default (buildBashConfinement's own doc
 *  comment above), so bwrap can freely create a missing target regardless of where in the sequence
 *  it falls. `bashMode:'readonly'` is the one posture that puts the root ITSELF on `denyWrite` — so
 *  by the time bwrap reaches the first still-missing entry here, the directory it needs to create
 *  that entry under is already read-only, and bwrap fails closed ("Can't create file at
 *  <workspace>/.claude/agents: Read-only file system") before the shell ever starts.
 *  `project-config-guard.ts`'s `prepareReadonlyMountTargets` pre-creates each one (as the correct
 *  empty TYPE below) so bwrap only ever binds an ALREADY-PRESENT node — never asked to create
 *  anything. A future CLI build changing this set needs this list re-derived the SAME way (a real
 *  capture), not re-guessed from strings — the exact bug this fix exists to close. */
export const READONLY_MOUNT_TARGETS: readonly { readonly rel: string; readonly kind: 'dir' | 'file' }[] = [
  { rel: '.claude/agents', kind: 'dir' },
  { rel: '.claude/commands', kind: 'dir' },
  { rel: '.gitconfig', kind: 'file' },
  { rel: '.gitmodules', kind: 'file' },
  { rel: '.bashrc', kind: 'file' },
  { rel: '.bash_profile', kind: 'file' },
  { rel: '.zshrc', kind: 'file' },
  { rel: '.zprofile', kind: 'file' },
  { rel: '.profile', kind: 'file' },
  { rel: '.ripgreprc', kind: 'file' },
  { rel: '.vscode', kind: 'dir' },
  { rel: '.idea', kind: 'dir' },
] as const;

export interface ConfinementInput {
  /** This call's workspace (req.workspace ?? cfg.cwd). undefined/'' both mean "nothing to write". */
  readonly root: string | undefined;
  /** Operator-granted host paths (validated + realpath'd at boot — DES-254). */
  readonly grantedHostPaths: readonly string[];
  /** Absolute paths that must stay unreadable regardless of any grant (DES-255). */
  readonly protectedFiles: readonly string[];
  /** Denied for reads as a whole (issue #101): every run's workspace and all engine state. */
  readonly workRoot: string | undefined;
  /** The engine's home directory (= the CLI subprocess's HOME) — denied for reads as a whole
   *  (issue #101: `~/.claude/.credentials.json`, `~/.claude.json`, `~/.config`, API-key files, ...). */
  readonly homeDir: string | undefined;
  /** Read-only re-opens inside the denied home/workRoot: the home-resident toolchain the agent's
   *  commands need (`toolchainReadCandidates`) plus the operator's `sandbox.allowReadPaths` —
   *  validated + realpath'd at boot (composeConfig), never writable. */
  readonly allowReadPaths: readonly string[];
  /** Issue #78(c): `'readonly'` ⇒ Bash may write nothing under the root or any grant. */
  readonly bashMode?: 'readonly';
  /** Issue #101 (CLI scratch): the host-shared CLI scratch `<tmpdir>/claude-<uid>` — denied for
   *  reads once this dispatch's CLI has its own scratch (`sharedCliScratch`, `CLI_SCRATCH_DIR`). */
  readonly sharedCliScratch?: string;
}

function isNonEmptyString(s: string | undefined | null): s is string {
  return typeof s === 'string' && s.length > 0;
}

/** DES-252: returns the whole posture — every field fixed here because the posture IS the design.
 *  `root === undefined` and `root === ''` take the SAME branch (`allowWrite: []`) — an absent
 *  workspace means "nothing may be written", never "no sandbox" (the ARCH-176 bug-class: a guard
 *  whose "nothing to check" arm must not return the same verdict as its "checked and clean" arm). */
export function buildBashConfinement(input: ConfinementInput): SandboxSettings {
  const { root, grantedHostPaths, protectedFiles, workRoot, homeDir, allowReadPaths, bashMode, sharedCliScratch } = input;
  const grants = grantedHostPaths.filter(isNonEmptyString);
  const allowPaths = isNonEmptyString(root) ? [root, ...grants] : [];
  // Issue #144: `ENGINE_OWNED_CONFIG_PATHS` is gone (its one entry, `.claude/skills`, merged into
  // `PROJECT_CONFIG_PATHS` above) — this no longer unions two lists, just the one.
  const settingsFiles = isNonEmptyString(root) ? PROJECT_CONFIG_PATHS.map((rel) => join(root, rel)) : [];
  // Issue #78(c) readonly: `allowWrite: []` alone is NOT read-only. The CLI (2.1.199, read from its
  // settings→sandbox builder) always seeds the write list with "." (the session cwd = root) and its
  // own per-uid scratch dir before merging `allowWrite`, and sandbox-runtime adds a fixed list
  // (`/tmp/claude`, `/dev/std*`, `~/.claude/debug`, `~/.npm/_logs`). `denyWrite` wins inside that
  // allow set, so the root and every grant go there. The CLI's own scratch stays writable — the
  // CLI's shell wrapper needs it, and it holds no run data.
  const readonly = bashMode === 'readonly';
  const filteredProtected = protectedFiles.filter(isNonEmptyString);
  // Issue #101: deny the whole home and the whole workRoot; `allowRead` below re-opens exactly this
  // call's workspace, the grants and the toolchain inside them (the CLI mounts a tmpfs over each
  // denied directory, then binds the allowed paths back on top — measured, see the header note).
  const denyRead = [homeDir, workRoot, ...filteredProtected, sharedCliScratch].filter(isNonEmptyString);
  const settings: SandboxSettings = {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    filesystem: {
      allowWrite: readonly ? [] : allowPaths,
      allowRead: [...allowPaths, ...allowReadPaths.filter(isNonEmptyString)],
      denyRead,
      // Issue #95: readonly's denyWrite is `allowPaths` ONLY — `root` on its own already denies
      // every one of `settingsFiles` (they are all inside it), so re-listing them here bought no
      // extra safety, only extra bwrap mount attempts for paths that mostly do not exist yet. That
      // is not cosmetic: a real bwrap-argv capture (project-config-guard.ts's
      // `prepareReadonlyMountTargets`, whose own doc comment has the measurement) showed the CLI
      // processes `root`'s own `--ro-bind` BEFORE it reaches any non-existent child path, so once
      // `root` is denyWrite'd, bwrap can no longer `mkdir`/`touch` a still-missing entry under it —
      // every redundant `settingsFiles` member here was a LATENT extra "Read-only file system"
      // failure point, not defense in depth. Normal (non-readonly) Bash is UNCHANGED: `root` stays
      // writable there, so `settingsFiles` is the only thing taking those paths back.
      // Issue #131: `HOST_SHARED_TMPDIR` unconditionally, in BOTH postures — srt's own
      // always-writable bind for it applies regardless of root/bashMode, so the counter-measure
      // must too (an absent `root` must not mean "nothing to deny" here, same ARCH-176 reasoning as
      // the rest of this function).
      // Issue #133: the home-convenience write dirs, same unconditional treatment — keyed off
      // `homeDir` alone, independent of `root`/`bashMode`.
      denyWrite: [...(readonly ? allowPaths : settingsFiles), HOST_SHARED_TMPDIR, ...homeConvenienceWritePaths(homeDir)],
    },
    credentials: {
      files: filteredProtected.map((path) => ({ path, mode: 'deny' as const })),
      // S8 (ARCH-025, DES-252): positive result joins this posture; negative leaves the field absent
      // and the exposure is a filed v38 candidate — never a silent widening of the credentials block.
      ...(MASK_PROVIDER_ENV
        ? { envVars: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENROUTER_API_KEY'].map((name) => ({ name, mode: 'mask' as const })) }
        : {}),
    },
  };
  return settings;
}

/** Issue #101 (CLI scratch, docs/evidence/issue-101-cli-scratch.md): the Claude CLI always re-binds
 *  its per-uid scratch `<CLAUDE_CODE_TMPDIR or tmpdir>/claude-<uid>/` WRITABLE after every denyRead,
 *  so left at the default every run's agent shares `/tmp/claude-<uid>/`. The gateway therefore gives
 *  each confined dispatch its own scratch under `<workRoot>/CLI_SCRATCH_DIR/` — inside the workRoot
 *  deny, so no other dispatch can see it — and denies the host-shared one. */
export const CLI_SCRATCH_DIR = 'cli-tmp';

/** The CLI's own name for its host-shared per-uid scratch (`claude-<uid>` under the tmpdir). */
export function sharedCliScratch(tmpDir: string, uid: number | undefined): string | undefined {
  return uid === undefined ? undefined : join(tmpDir, `claude-${uid}`);
}

// The CLI's sandbox puts its network-bridge sockets straight into $TMPDIR
// (`claude-socks-<16 hex>.sock`, 34 bytes + '/'); a unix socket path is at most 107 bytes on Linux.
const UNIX_SOCKET_PATH_MAX = 107;
const CLI_SOCKET_NAME_BYTES = 35;
// `mkdtemp(<workRoot>/cli-tmp/d)` ⇒ '/cli-tmp/d' + 6 random chars.
const CLI_SCRATCH_SUFFIX_BYTES = `/${CLI_SCRATCH_DIR}/d`.length + 6;

/** `null` when this workRoot leaves room for the CLI's sockets under a per-dispatch scratch, else a
 *  typed refusal — never a silent fallback to the shared scratch. */
export function cliScratchRefusal(workRoot: string): string | null {
  const bytes = Buffer.byteLength(workRoot) + CLI_SCRATCH_SUFFIX_BYTES + CLI_SOCKET_NAME_BYTES;
  if (bytes <= UNIX_SOCKET_PATH_MAX) return null;
  return `CLI_SCRATCH_PATH_TOO_LONG: workRoot ${workRoot} is too long for the Claude CLI's per-dispatch scratch (its sandbox sockets would need ${bytes} bytes, the unix-socket limit is ${UNIX_SOCKET_PATH_MAX}) — use a shorter workRoot path (at most ${UNIX_SOCKET_PATH_MAX - CLI_SCRATCH_SUFFIX_BYTES - CLI_SOCKET_NAME_BYTES} bytes)`;
}

/** Issue #101: the home-resident toolchain a denied home must re-open for the agent's commands —
 *  every `PATH` entry that lives under `homeDir` (the CLI subprocess inherits this PATH), plus the
 *  install prefix of the engine's own node (`<prefix>/bin/node` ⇒ `<prefix>`, because npm/npx are
 *  symlinks into `<prefix>/lib/node_modules`). Never `homeDir` itself and never `~/.local` (a shared
 *  prefix that holds `share/` app data — e.g. the default workRoot and the updater's state). PURE:
 *  the caller (composeConfig) realpaths, drops missing paths and re-validates each candidate. */
export function toolchainReadCandidates(pathEnv: string | undefined, homeDir: string | undefined, execPath: string): string[] {
  if (!isNonEmptyString(homeDir)) return [];
  const shared = new Set([homeDir, join(homeDir, '.local')]);
  const underHome = (p: string): boolean => p.startsWith('/') && !shared.has(p) && isPathContained(p, homeDir, (x) => x);
  const out = (pathEnv ?? '').split(':').filter((p) => p.startsWith('/')).map((p) => resolve(p)).filter(underHome);
  if (basename(dirname(execPath)) === 'bin' && underHome(dirname(dirname(execPath)))) out.push(dirname(dirname(execPath)));
  return [...new Set(out)];
}

/** Issue #78(c): tools that write through their own path — a readonly shell beside any of them is not
 *  a read-only agent. One list for registration (workflow-meta scan) and dispatch (below). */
export const READONLY_BASH_FORBIDDEN_TOOLS = ['Write', 'Edit', 'NotebookEdit'] as const;

/** Issue #78(c): the dispatch-time verdict for an agent's `bash` option, as a typed terminal detail
 *  (`CODE: why`) or `null` to proceed. `bash` is `unknown` because it crossed the script sandbox as
 *  an opaque opts field — a runtime-computed value registration could not see. Order: a bad value, a
 *  contradictory surface, then the host — so the author is told the fixable thing first. */
export function readonlyBashRefusal(input: {
  readonly bash: unknown;
  readonly tools: readonly string[];
  readonly posture: 'confined' | 'unconfined' | undefined;
  readonly root: string | undefined;
}): string | null {
  const { bash, tools, posture, root } = input;
  if (bash === undefined) return null;
  if (bash !== 'readonly') {
    return `BASH_MODE_INVALID: bash: ${JSON.stringify(bash)} is not a Bash mode — the only accepted value is 'readonly' (omit the key for normal Bash)`;
  }
  const writers = tools.filter((t) => (READONLY_BASH_FORBIDDEN_TOOLS as readonly string[]).includes(t));
  if (writers.length > 0) {
    return `BASH_READONLY_CONFLICT: bash:'readonly' but the tool surface also grants ${writers.join(', ')} — name allowedTools explicitly without write tools (e.g. ['Bash', 'Read', 'Grep', 'Glob'])`;
  }
  if (posture !== 'confined') {
    return "BASH_READONLY_UNENFORCEABLE: bash:'readonly' needs the kernel Bash sandbox, and this engine has no working Bash sandbox (its boot probe measured the host unconfined) — the call was refused rather than run with a writable shell";
  }
  // The CLI makes its cwd writable by itself; with no root there is nothing to put on denyWrite.
  if (!isNonEmptyString(root)) {
    return "BASH_READONLY_UNENFORCEABLE: bash:'readonly' needs a known workspace to deny writes to, and this call has none";
  }
  return null;
}

export type GrantRule ='NOT_ABSOLUTE' | 'UNRESOLVABLE' | 'INSIDE_WORKROOT' | 'COVERS_PROTECTED' | 'GLOB';
export interface GrantRefusal {
  readonly entry: string;
  readonly rule: GrantRule;
}

const REMEDY: Record<GrantRule, string> = {
  NOT_ABSOLUTE: 'give an absolute path; `~` is never expanded against whatever cwd systemd gave us',
  UNRESOLVABLE: 'create the directory before boot — a not-yet-existing path can later be created as a symlink to anything',
  INSIDE_WORKROOT: "grant a path outside workRoot; `<workRoot>/cas` would hand over the content store",
  COVERS_PROTECTED: 'grant a narrower path; this one would hand back exactly what denyRead takes away',
  GLOB: 'a literal path only — a glob is a second grammar nobody asked for',
};

/** DES-254: boot refuses a grant that would undo the control. Realpath is injected (pure); all
 *  refusals are returned, never just the first (an operator editing several bad rows at once is told
 *  about all of them, once). Containment is tested in BOTH directions via the repo's single existing
 *  primitive (`isPathContained`) — no second containment idiom is minted. */
export function validateHostPathGrants(
  grants: readonly string[],
  ctx: { workRoot: string; protectedFiles: readonly string[] },
  realpathImpl: (p: string) => string,
): { ok: true; resolved: string[] } | { ok: false; refusals: GrantRefusal[] } {
  const refusals: GrantRefusal[] = [];
  const resolved: string[] = [];
  for (const entry of grants) {
    if (!entry.startsWith('/') || entry.startsWith('~')) {
      refusals.push({ entry, rule: 'NOT_ABSOLUTE' });
      continue;
    }
    if (/[*?[]/.test(entry)) {
      refusals.push({ entry, rule: 'GLOB' });
      continue;
    }
    let target: string;
    try {
      target = realpathImpl(entry);
    } catch {
      refusals.push({ entry, rule: 'UNRESOLVABLE' });
      continue;
    }
    if (isPathContained(target, ctx.workRoot, (p) => p) || isPathContained(ctx.workRoot, target, (p) => p)) {
      refusals.push({ entry, rule: 'INSIDE_WORKROOT' });
      continue;
    }
    const coversProtected = ctx.protectedFiles.some(
      (pf) => target === pf || isPathContained(pf, target, (p) => p),
    );
    if (coversProtected) {
      refusals.push({ entry, rule: 'COVERS_PROTECTED' });
      continue;
    }
    resolved.push(target);
  }
  return refusals.length > 0 ? { ok: false, refusals } : { ok: true, resolved };
}

/** ONE formatter, all refusals — a table rendered as one line per refusal, naming the offending
 *  entry verbatim plus its remedy (ADR-028's "one typed message" idiom, satisfied by one message
 *  that LISTS the entries rather than four ad-hoc strings that drift). */
export function formatGrantRefusals(refusals: readonly GrantRefusal[]): string {
  return refusals.map((r) => `${r.entry}: not a valid host-path grant (${r.rule}) — ${REMEDY[r.rule]}`).join('\n');
}
