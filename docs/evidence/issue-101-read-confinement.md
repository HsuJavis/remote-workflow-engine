# Issue #101 — spike: does the CLI sandbox honour `allowRead` inside a `denyRead` directory?

**Answer: yes.** Measured 2026-09-28 on the production host (Ubuntu, bwrap + socat, AppArmor fix
applied, boot probe `CONFINED`), the SDK-bundled Claude CLI 2.1.199 via `@anthropic-ai/claude-agent-sdk` 0.3.199 (corrected 2026-10-01: an earlier revision said 2.1.283 — that was the operator's PATH `claude`; the SDK always spawns its bundled binary).
This is the question spike S7 (v37) could not answer; it decides `bash-confinement.ts`'s posture.

## Method (no model, no credential)

A Node script called the SDK's `query()` exactly the way the engine does (`cwd` = run workspace A,
`settingSources: []`, `tools/allowedTools: ['Bash']`, `sandbox: { enabled, failIfUnavailable,
autoAllowBashIfSandboxed, allowUnsandboxedCommands:false, filesystem: {...} }`), with
`ANTHROPIC_BASE_URL` pointed at a local stub that speaks the Messages SSE protocol: it answers the
first turn with one fixed `Bash` `tool_use` and records the `tool_result`. A `bwrap` PATH shim
logged the real bwrap argv before `exec`ing `/usr/bin/bwrap`. The CLI subprocess got the systemd
unit's PATH (`~/.rwe-litellm-venv/bin:~/.local/node/bin:/usr/local/bin:/usr/bin:/bin`) and the real
`HOME=/home/user`.

Layout: `WR=~/.cache/rwe-spike101-XXXX` (a workRoot under HOME, like production's
`~/.local/share/rwe-data`), workspace `A=WR/workflows/wf/runs/A/ws` (with `own.txt`), another run
`B=WR/workflows/wf/runs/B/ws/secret.txt`, `WR/auth-tokens.db`, `WR/cas/blob`, a grant dir
`G=~/.cache/rwe-spike101-grant`.

The Bash command (credential paths are only ever tested for readability, never printed):

```sh
cat own.txt; echo own=$?
cat $B/secret.txt >/dev/null 2>&1; echo other_run=$?
cat $WR/auth-tokens.db >/dev/null 2>&1; echo authdb=$?
cat ~/.claude/.credentials.json >/dev/null 2>&1; echo cred=$?
cat ~/.claude.json >/dev/null 2>&1; echo claudejson=$?
ls ~ >/dev/null 2>&1; echo ls_home=$?;  ls $WR >/dev/null 2>&1; echo ls_workroot=$?
node --version; npm --version; python3 --version; git --version; grep -c OK own.txt
echo hi > new.txt && cat new.txt; echo write=$?
ls $WR/workflows/wf/runs; cat $WR/cas/blob >/dev/null 2>&1; echo cas=$?
cat $G/g.txt; echo w > $G/w.txt; cat ~/.gitconfig >/dev/null 2>&1; echo gitconfig=$?
echo x > $B/pwn.txt; echo write_other=$?
```

## Results (exit status 0 = readable/succeeded)

| variant | denyRead | allowRead (besides A) | own | other_run | authdb | cred | claude.json | node/npm/py/git | write own | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline (≈ pre-fix) | — | — | 0 | **0** | **0** | **0** | **0** | 0 | 0 | the #101 bug reproduced |
| home | `~`, authdb | `~/.local/node`, `~/.local/bin` | 0 | 1 | 1 | 1 | 1 | 0 | 0 | subpath allow inside denied `~` works |
| workroot | `WR`, authdb | — | 0 | 1 | 1 | 0 | 0 | 0 | 0 | subpath allow inside denied workRoot works |
| prod-shaped | `~`, `WR`, `WR/cas`, authdb | `G`, `~/.local/node`, `~/.rwe-litellm-venv` (+ `G` writable) | 0 | 1 | 1 | 1 | 1 | 0 | 0 | `ls runs` → only `A`; cas=1; grant read+write=0; gitconfig=1 |
| prod + `bash:'readonly'` (#95 targets pre-created) | same | same (`denyWrite: [A, G]`) | 0 | 1 | 1 | 1 | 1 | 0 | **1** (RO fs) | readonly shell still starts; grant write=1 |

`ls ~` / `ls $WR` exit 0 in the deny variants because the denied directory becomes an empty
`tmpfs` holding only the skeleton path down to the re-bound paths — not content (`ls $WR/workflows/wf/runs`
lists only `A`).

Mechanism, from the captured bwrap argv (home variant, proxy/credential `--setenv` lines omitted):

```
--ro-bind / / --bind ~/.npm/_logs … --bind ~/.claude/debug … --bind <A> <A> --bind /tmp/claude-1000/ …
--tmpfs /home/user
--bind ~/.npm/_logs … --bind ~/.claude/debug … --bind <A> <A>
--ro-bind /home/user/.local/node /home/user/.local/node --ro-bind /home/user/.local/bin /home/user/.local/bin
--ro-bind /dev/null <WR>/auth-tokens.db  --ro-bind /dev/null <A>/.claude/settings.json … (denyWrite/mount targets)
```

i.e. each `denyRead` directory is a `--tmpfs`, then every `allowWrite`/`allowRead` path inside it is
bound back on top.

## Residual cross-run channels (measured, NOT closable by settings)

- The CLI / sandbox-runtime always re-binds **`/tmp/claude-<uid>/`** (its scratch root; one
  `<cwd-slug>/<session>/tasks/` dir per run, plus any interactive Claude Code session's scratch of the
  same uid) and **`~/.claude/debug/`** *writable*, after the `denyRead` tmpfs. A variant with both in
  `denyRead` still had `ls /tmp/claude-1000` = 0, `$TMPDIR` read/write = 0, `~/.claude/debug/latest` = 0.
  `CLAUDE_CODE_TMPDIR=<dir>` only adds one more bind; `/tmp/claude-<uid>/` stays. (Superseded for
  `/tmp/claude-<uid>/`: setting `TMPDIR` to the same dir too moves the whole scratch, and the engine now
  does that per dispatch. See `issue-101-cli-scratch.md`.) No credentials live
  there, but any run can read/write what another run left. Full isolation needs the engine under a
  dedicated OS user (not shared with the operator's interactive Claude Code).
- The CLI's pre-command `source ~/.claude/shell-snapshots/snapshot-*.sh 2>/dev/null || true` now
  fails silently (commands still run; PATH comes from the subprocess env).
