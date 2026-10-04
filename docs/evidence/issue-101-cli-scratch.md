# Issue #101 residual — spike: can the CLI's scratch be made per dispatch?

**Answer: yes for `/tmp/claude-<uid>/`, no for `~/.claude/debug/` and `~/.npm/_logs/`.** Measured
2026-09-28 on the production host (Ubuntu, bwrap + socat, boot probe `CONFINED`), Claude CLI
`2.1.199 (Claude Code)` (`claude --version` of the SDK's bundled binary) via
`@anthropic-ai/claude-agent-sdk` 0.3.199. Follows `issue-101-read-confinement.md`, whose
"Residual cross-run channels" section this closes in part.

## Method (no model, no credential)

Same as `issue-101-read-confinement.md`: a Node script called the SDK's `query()` the way the engine
does (`cwd` = run workspace A, `settingSources: []`, `tools/allowedTools: ['Bash']`,
`sandbox: { enabled, failIfUnavailable, autoAllowBashIfSandboxed, allowUnsandboxedCommands:false,
filesystem: { allowWrite:[A], allowRead:[A, ~/.local/node], denyRead:[~, WR, …] } }`), with
`ANTHROPIC_BASE_URL` pointed at a local stub that speaks the Messages SSE protocol and answers the
first turn with one fixed `Bash` `tool_use`. A `bwrap` PATH shim logged the real bwrap argv. The CLI
subprocess got `HOME=/home/user` and a dummy `ANTHROPIC_API_KEY` (the stub needs none).

Layout: `WR=~/.cache/rwe-spike-scr-XXXX` (a workRoot under HOME), workspace `A=WR/workflows/wf/runs/A/ws`,
the dispatch's scratch `S_A=WR/s/A1`, a second dispatch's scratch `WR/s/B1/claude-1000/bsecret.txt`.

The Bash command (exit status 0 = succeeded):

```sh
echo TMPDIR=$TMPDIR; echo CCT=$CLAUDE_CODE_TMPDIR
ls /tmp/claude-1000; echo ls_shared=$?            # the host-shared CLI scratch (100+ other sessions' dirs)
ls ~/.claude/debug; echo ls_debug=$?
echo x > /tmp/claude-1000/spike-probe.txt; echo write_shared=$?
echo c > "$CLAUDE_CODE_TMPDIR/c.txt"; echo write_cct=$?
cat WR/s/B1/claude-1000/bsecret.txt; echo other_scratch=$?
ls WR/s; echo ls_scr=$?
node --version; echo w > wrote.txt; echo write=$?
```

## Results

| variant (CLI subprocess env / extra denyRead) | `/tmp/claude-1000` in bwrap argv | ls_shared | shared listing | write_shared (host) | ls_debug | other_scratch | own scratch write | node / write own |
|---|---|---|---|---|---|---|---|---|
| baseline (engine today) | `--bind` (rw) | 0 | **visible** | **0 (lands on host)** | 0 | 1 | 0 | 0 / 0 |
| `CLAUDE_CODE_TMPDIR=S_A` only | `--bind` (rw) **still** | 0 | visible | 0 (lands on host) | 0 | 1 | 0 | 0 / 0 |
| `CLAUDE_CODE_TMPDIR=TMPDIR=S_A` | not bound; ro via `--ro-bind / /` | 0 | visible | 1 (read-only fs) | 0 | 1 | 0 | 0 / 0 |
| same + `denyRead: /tmp/claude-1000` | `--tmpfs` | 0 | **empty** | 0 into the tmpfs — **nothing on host** | 0 | 1 | 0 | 0 / 0 |
| same, `bash:'readonly'` (`denyWrite:[A]`, #95 targets pre-created) | `--tmpfs` | 0 | empty | nothing on host | 0 | 1 | **0** | 0 / **1** |
| same + `CLAUDE_CONFIG_DIR=S_A/cfg` | `--tmpfs` | 0 | empty | nothing on host | **0 (still bound)** | 1 | 0 | 0 / 0 |
| same + `HOME=WR/h` (fresh, no `.claude/debug`) | `--tmpfs` | 0 | empty | nothing on host | **2 (not bound)** | 1 | 0 | 0 / 0 |

`ls_scr` listed only `A1` in every per-dispatch variant: the scratch sits inside the denied workRoot
tmpfs and only `S_A/claude-1000/` (plus the socket files the CLI puts directly in `S_A`) is bound
back — another dispatch's scratch is invisible.

## Why both variables, from the binary

- The per-uid scratch is `EE() = join(CLAUDE_CODE_TMPDIR || os.tmpdir(), 'claude-<uid>')`.
- `act()` returns `EE()` only if it is at most 44 bytes (AF_UNIX headroom); otherwise it falls back to
  `join(os.tmpdir(), 'claude-<uid>')` — i.e. `/tmp/claude-<uid>` unless `TMPDIR` is set.
- The sandbox write list is `[".", EE()]` plus `act()` if different. So `CLAUDE_CODE_TMPDIR` alone
  (a workRoot path is always > 44 bytes) still binds `/tmp/claude-<uid>` writable — what the first
  #101 spike saw. With `TMPDIR` equal to `CLAUDE_CODE_TMPDIR` the fallback is the same path and
  only one per-dispatch dir is bound.
- Inside the sandbox the CLI exports `TMPDIR=<dir>` and `CLAUDE_CODE_TMPDIR=<dir>/claude-<uid>`.
- The sandbox's network-bridge sockets go straight into `os.tmpdir()`
  (`claude-http-<16 hex>.sock`, `claude-socks-<16 hex>.sock`, `srt-mux-<pid>-<n>.sock`), so
  `TMPDIR` + 35 bytes must fit a 107-byte unix socket path.
- `~/.claude/debug` and `~/.npm/_logs` are sandbox-runtime's fixed write list built from
  `os.homedir()` — `CLAUDE_CONFIG_DIR` does not move them. They are bound only if they exist (the
  fresh-HOME variant). The CLI writes `~/.claude/debug/` only with `DEBUG_CLAUDE_AGENT_SDK` / `--debug`
  (neither is ever passed: the subprocess env is an allowlist).

## What the engine does now

For every confined dispatch with a known `workRoot` (`claude-agent-sdk-client.ts`):

1. `mkdtemp(<workRoot>/cli-tmp/d)` (parent 0700) — one fresh dir per attempt; the CLI subprocess gets
   `TMPDIR` = `CLAUDE_CODE_TMPDIR` = that dir (overriding the host `TMPDIR` the env allowlist forwards).
2. `denyRead` gains `<engine tmpdir>/claude-<uid>` (the host-shared scratch).
3. The dir is removed when the call returns; `main()` removes all of `<workRoot>/cli-tmp/` at boot,
   before `createServer()`, for leftovers of a killed process.
4. Fail closed: a workRoot too long for the sockets (`CLI_SCRATCH_PATH_TOO_LONG`, limit 56 bytes) or
   a scratch that cannot be created (`CLI_SCRATCH_UNAVAILABLE`) refuses the dispatch before any
   session. It never falls back to the shared scratch. `composeConfig()` already refuses the too-long case at boot
   (sdk gateway + measured `confined` probe + an absolute workRoot).

`CLAUDE_CONFIG_DIR` and `HOME` are **not** relocated. `CLAUDE_CONFIG_DIR` buys nothing for
isolation (debug stays bound). A per-dispatch `HOME` would unbind `~/.claude/debug`, but the CLI then
writes `.claude.json`, `projects/`, `sessions/`, `shell-snapshots/`, `backups/` there, which changes
much more than this fix needs. The engine reads none of `~/.claude/projects` or the session files
(transcripts come from the SDK message stream), so nothing it relies on moves.

Automated: `tests/acceptance/val-101-cli-scratch.test.ts` (two concurrent runs plus a readonly
dispatch, real CLI + kernel sandbox; RED on the pre-fix engine: `shared_entries` > 0) and
`tests/unit/cli-scratch-gateway.test.ts`.

## Remaining cross-run channels (measured)

- **`~/.claude/debug/`** and **`~/.npm/_logs/`** of the engine's HOME: bound writable into every
  sandbox after the `denyRead` whenever they exist, so they can be used to pass data between runs, and
  any agent reads what is already in them. No credentials live there. On a host shared with the
  operator's interactive Claude Code, `~/.claude/debug/` holds that operator's debug logs. With
  the engine on a dedicated OS user, remove both directories. The engine's own CLI never creates
  `~/.claude/debug/`. An `npm` run inside the sandbox cannot create `~/.npm/_logs` on the host
  either, because HOME is a tmpfs there. Only something running as that user outside the
  sandbox can bring either directory back.
  (Superseded for the WRITE side: issue #133 added both, resolved from `homeDir`, to
  `buildBashConfinement()`'s `denyWrite` — live-reverified on a confined host, a write to either
  from confined Bash now fails `Read-only file system` and leaves nothing for a later run to see.
  The read side is unchanged and intentionally so — see DEPLOY.md §1c(f).)
- The denied shared path is `<engine process tmpdir>/claude-<uid>`. If the engine runs with a
  `TMPDIR` that the operator's interactive Claude Code does not share, the operator's
  `/tmp/claude-<uid>` is not on `denyRead`, and `--ro-bind / /` leaves it readable (but not
  writable). Running the engine as a dedicated OS user closes this too.
