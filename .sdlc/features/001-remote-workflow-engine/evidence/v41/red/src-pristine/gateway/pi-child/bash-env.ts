// src/gateway/pi-child/bash-env.ts (pi harness v1, spec item "Env rule", design change 3 —
// pi-harness-research.md / pi-spike-report.md). PURE — no fs/process-mutation/network. Exported so
// both the normal tsx-resolved world (tests, pi-gateway-client.ts, imported via the project's usual
// `.js`-specifier convention) and the pi CHILD process (loaded directly by raw `node
// --experimental-transform-types`, which does NOT resolve a `.js` specifier to this file's real
// `.ts` extension — see src/sandbox/guards.ts's own note on the same hazard) can both load this
// EXACT file: the one rule that makes that safe is that THIS file holds no local value import of its
// own (only Node built-ins/types), so whichever extension the importer uses to reach it, there is
// nothing further for either loader to resolve.
//
// This is the single most safety-critical file in the pi harness (pi-spike-report.md, "Extra — env-
// leak canary"): pi's own built-in bash tool builds its child env as `{...getShellEnv(), PI_*}` —
// i.e. the WHOLE calling process's `process.env` — and `SandboxManager.wrapWithSandboxArgv()`'s own
// returned `env` is equally wide: `{...the CALLING process's full process.env, +srt's own
// proxy/seccomp additions}`. A naive adapter that spreads either of those as a base and overrides a
// few keys on top leaks every `RWE_SECRET_*` / provider-key env var straight into the sandboxed
// shell — reproduced empirically in the spike (canary-no-llm.ts). The fix, encoded here as the ONLY
// way callers are allowed to build the final bash env: diff srt's returned env against the CALLER's
// own `process.env` to find ONLY what srt itself added or changed (its proxy/seccomp plumbing), then
// layer just that on top of a hand-built allowlist — never spread srt's env as a base.

/** Same benign-env allowlist `claude-agent-sdk-client.ts`'s `ENV_ALLOWLIST` uses for the CLI
 *  subprocess (PATH/HOME/SHELL/LANG/LC_ALL/TMPDIR/TERM) — kept as its own literal here (not an
 *  import) so this file stays import-free; `bash-confinement-wiring.test.ts`-style coverage can
 *  assert the two lists agree if they are ever meant to track each other. */
export const PI_BASH_ENV_ALLOWLIST: readonly string[] = ['PATH', 'HOME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM'];

/** Builds the exact env the sandboxed bash child process receives. `callerEnv` is the PARENT (pi
 *  child) process's own `process.env` at the moment of the call — the same object
 *  `wrapWithSandboxArgv()` was handed as ITS calling process's env, so it is the correct diff base.
 *  `sandboxEnv` is `wrapWithSandboxArgv()`'s own returned `env` (wide — see header). `allowlist`
 *  lets a caller override `PI_BASH_ENV_ALLOWLIST` (tests only; real callers omit it).
 *
 *  Algorithm (pi-spike-report.md design change 3, stated precisely): for every key present in
 *  `sandboxEnv`, keep it ONLY if it differs from (or is absent from) `callerEnv` — that is srt's own
 *  addition/override (proxy port, seccomp plumbing, `SANDBOX_RUNTIME`, a re-pointed `TMPDIR`, ...).
 *  Everything else comes from a hand-built allowlist copy of `callerEnv`, never from `sandboxEnv`
 *  itself. A key both lists would otherwise set (e.g. `TMPDIR`) resolves to srt's value — srt's own
 *  override is deliberate sandbox plumbing, not a leak, so it wins over the plain allowlist copy. */
export function buildBashEnv(
  callerEnv: Readonly<NodeJS.ProcessEnv>,
  sandboxEnv: Readonly<NodeJS.ProcessEnv>,
  allowlist: readonly string[] = PI_BASH_ENV_ALLOWLIST,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of allowlist) {
    const v = callerEnv[key];
    if (v !== undefined) out[key] = v;
  }
  const srtExtras: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(sandboxEnv)) {
    if (callerEnv[key] !== value) srtExtras[key] = value;
  }
  return { ...out, ...srtExtras };
}

// pi-spike-report.md design change 2: `wrapWithSandboxArgv()`'s returned `argv` is always
// `['bash', '-c', '<the whole bwrap invocation as one shell string>']` — never `['bwrap', ...]` — so
// "did this actually get wrapped" must regex the JOINED argv for a real bwrap invocation, never
// check `argv[0]`. `--unshare` is the flag bwrap always carries at least one of
// (`--unshare-user`/`--unshare-pid`/...) in every real sandboxed invocation this engine builds (see
// confinement-probe.ts's own `NESTED_BWRAP_ARGS`), so its presence after a `bwrap` token is the
// signal a stray mention of the word "bwrap" in, say, an echoed string cannot forge by accident
// (the regex requires `--unshare` to appear strictly after `bwrap` in the SAME joined string).
const BWRAP_INVOCATION_RE = /(?:^|[\s"'])bwrap\b[^|&;]*--unshare/;

/** `true` only when the joined argv contains a real `bwrap ... --unshare...` invocation — the
 *  honest "is this call actually sandboxed" check `harness.bash.enforced` / the `agent.confinement`
 *  event must use before claiming confinement (v37 thesis: never report a sandbox the host did not
 *  apply). */
export function isWrapped(argv: readonly string[]): boolean {
  return BWRAP_INVOCATION_RE.test(argv.join(' '));
}
