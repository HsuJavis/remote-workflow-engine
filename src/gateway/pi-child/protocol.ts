// src/gateway/pi-child/protocol.ts (pi harness v1). TYPE-ONLY — every export here is a type, never
// a value, and it imports nothing itself. This is deliberate, not incidental: `entry.ts` runs under
// raw `node --experimental-transform-types` (it is excluded from both tsconfigs, same convention as
// `src/sandbox/child-entry.ts`), which does NOT resolve a `.js` import specifier to a sibling `.ts`
// file the way tsx does. A `import type {...}` is erased entirely by type-stripping — no runtime
// `require`/`import` is ever emitted for it — so this file can be referenced from BOTH the normal
// tsx-resolved world (pi-gateway-client.ts, tests) via a `.js` specifier AND from `session-runner.ts`
// (itself loaded by the child via an explicit `.ts` specifier) without either loader ever trying to
// resolve this file as a VALUE import. The moment this file grows a runtime (value) export, that
// safety property breaks — keep it type-only.
import type { Tokens } from '../../types.js';

/** What the parent sends the child, as ONE JSON line on stdin (never written to disk, never logged
 *  — `apiKey` lives only in this process's memory for the lifetime of the dispatch). */
export interface PiChildConfig {
  runId: string;
  agentId: string;
  prompt: string;
  model: PiChildModelConfig;
  /** Resolved secret value (OpenRouter) — absent for ollama. Injected into the child's memory only
   *  via `setRuntimeApiKey`, per owner decision 3; never written to `agentDir/auth.json`. */
  apiKey?: string;
  /** The run's own workspace — `cwd` for the session (and, once slice (d)/(e) land, the file-jail
   *  root and bash confinement root). */
  cwd: string;
  /** An engine-owned, EMPTY directory — `ModelRuntime.create({authPath, modelsPath})` and
   *  `createAgentSession({agentDir})` both point here, so pi's own file-based config/auth never
   *  exists on disk to begin with (full-control ResourceLoader also disables discovery). */
  agentDir: string;
  /** review round 3, R3-1: an engine-owned, per-dispatch, per-process-VERIFIED scratch directory
   *  (the exact same shape as `agentDir` above) — set as `CLAUDE_CODE_TMPDIR` in the child BEFORE any
   *  confined bash call, so srt's `TMPDIR` for that call points HERE, never at its own cross-run,
   *  cross-principal shared fallback `/tmp/claude` (see `PI_HOST_SHARED_TMPDIR`'s own doc in
   *  pi-gateway-client.ts for the full "why"). Always present, even when confinement is off or bash
   *  is never used this dispatch — computing it costs one cheap mkdir and keeps this field
   *  unconditional, matching `agentDir`'s own shape. */
  tmpDir: string;
  /** Full-control ResourceLoader's system prompt — the engine supplies it; pi's own default/context-
   *  file discovery is never reached. */
  systemPrompt: string;
  /** spec "Effort": mapped directly onto pi's `thinkingLevel` (the AgentOpts effort union
   *  `'low'|'medium'|'high'|'xhigh'|'max'` is already a subset of pi's own ThinkingLevel values).
   *  Absent -> `'off'`. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Optional override of OpenRouter's base URL (slice (i): a recording fake server stands in for
   *  `https://openrouter.ai/api/v1` so the request shape can be verified with no real key). Absent
   *  -> the real OpenRouter endpoint. Ignored for ollama (which always uses `model.baseUrl`). */
  openrouterBaseUrl?: string;
  /** pi tool names to enable — already translated from engine names AND validated by the parent
   *  (TOOL_UNSUPPORTED_BY_HARNESS is refused before a child is ever spawned). `noTools:'builtin'`
   *  plus `customTools` overrides for exactly these names (spike S6) — never pi's own unsandboxed
   *  built-ins. `[]` is honored (no tools at all). */
  tools: string[];
  /** Absolute paths that must stay unreadable to the file tools regardless of workspace
   *  containment (credentials etc.) — the SAME list `sandbox.credentials.files` denies for bash. */
  protectedFiles: string[];
  /** Present only when this engine measured `confined` at boot (the pi-path probe, a SEPARATE
   *  measurement from the sdk gateway's own — see confinement-probe.ts in this directory). Absent ->
   *  bash runs unwrapped (spec "Confinement posture"). */
  sandbox?: PiChildSandboxConfig;
  /** Issue #78(c) parity: `'readonly'` makes the bash tool refuse any write. Only ever set when the
   *  parent's `readonlyBashRefusal()` check already passed (confined posture, no write tool beside
   *  it, a known workspace root) — the child never downgrades it. */
  bashMode?: 'readonly';
  /** slice (g): resolved MCP server configs (already `${secret:}`/`${run:dir}`/`${run:id}`-substituted
   *  by the PARENT via the shared `mcp-config-resolver.ts` — the SAME function the sdk gateway uses,
   *  never re-resolved here). Absent/empty -> no `pi.registerMcpServer()` calls at all, and the child
   *  uses the existing zero-discovery `emptyResourceLoader` unchanged (no behavior change for a
   *  dispatch with no declared MCP). A secret value may ride inside `env`/`headers` here — same
   *  stdin-only, never-logged contract as `apiKey` above. */
  mcp?: Record<string, { type?: string; url?: string; command?: string; args?: string[]; env?: Record<string, string> }>;
  /** slice (h); issue #144: absolute paths of already-materialized skill directories (the parent
   *  copies them via the SAME `materializeAssets` the sdk gateway uses, BEFORE the child is spawned)
   *  — passed as pi's `additionalSkillPaths`. Absent/empty -> no skills, same zero-discovery
   *  `emptyResourceLoader` path as before. **Issue #144**: these now live under this dispatch's own
   *  private `tmpDir` (above), never under `cwd` — pi's full-control `DefaultResourceLoader` loads
   *  `additionalSkillPaths` directly off disk regardless of `cwd` (`noSkills:true` only suppresses
   *  DISK-discovered paths, never this explicit list — session-runner.ts's own doc comment), so the
   *  move needs no change there. It DOES need `skillReadRoots` below: pi tells the model to `read` a
   *  skill's own `SKILL.md` by absolute path (`formatSkillsForPrompt`'s `<location>`), and the
   *  model's `read`/`grep`/`find`/`ls` tools are jailed to `cwd` by default (`assertJailed`,
   *  session-runner.ts) — without `skillReadRoots` naming this same directory, that `read` call would
   *  fail `PATH_ESCAPES_WORKSPACE` the moment a skill moved outside the workspace. */
  skillPaths?: string[];
  /** Issue #144: read-only root(s) `assertJailed` (session-runner.ts) also accepts, alongside `cwd`,
   *  for `read`/`grep`/`find`/`ls`/edit's own read half (never `write`/edit's write half — a skill's
   *  materialized copy stays read-only to the model). Set to this dispatch's own skill-materialization
   *  directory whenever `skillPaths` is non-empty; omitted otherwise (unchanged jail — `cwd` only). */
  skillReadRoots?: string[];
}

export type PiChildModelConfig =
  | { provider: 'ollama'; model: string; baseUrl: string }
  | {
      provider: 'openrouter'; model: string;
      /** issue #150: whether the PINNED catalog capability (`Caps.reasoning`, via the parent's
       *  `req.caps`) says this model's endpoint supports a reasoning dial at all — `false` only when
       *  the catalog EXPLICITLY declares no support (e.g. openrouter/openai/gpt-4.1's
       *  `supported_parameters` omits `'reasoning'`); absent/`undefined` (no pin, or the catalog said
       *  nothing) keeps the PRE-#150 behavior of assuming support, never guessing a false negative.
       *  Threads straight into `buildModelConfig()`'s `reasoning` flag (session-runner.ts) — `false`
       *  here means pi's own `compat.thinkingFormat === 'openrouter' && model.reasoning` gate (and
       *  every other `model.reasoning`-gated branch in pi-ai's openai-completions provider) never
       *  fires, so NO `reasoning` field reaches the wire at all for that model. */
      reasoningSupported?: boolean;
    };

/** Projected from `buildBashConfinement()`'s SandboxSettings output (shared with the sdk gateway —
 *  field names are identical in both the SDK's own `SandboxSettings` and srt's
 *  `SandboxRuntimeConfig`, confirmed in the spike) into plain JSON-safe data the PARENT (which can
 *  import bash-confinement.ts directly — it is never raw-node-loaded) computes ONCE per dispatch and
 *  ships over stdin. Absent on `PiChildConfig.sandbox` means this engine measured `unconfined` at
 *  boot — the child's bash tool then runs WITHOUT any srt wrap (never a claimed confinement with no
 *  evidence), matching the sdk gateway's own `{enabled:false}` posture. */
export interface PiChildSandboxConfig {
  filesystem: { allowWrite: string[]; allowRead: string[]; denyRead: string[]; denyWrite: string[] };
  credentials?: { files: Array<{ path: string; mode: 'deny' | 'mask' }> };
  /** design change 1: resolved ONCE by the parent (`resolveRipgrepOverride()`); `null` means no
   *  bundled native-CLI binary was found on this host — the child's bash tool refuses
   *  SANDBOX_UNAVAILABLE rather than silently calling `SandboxManager.initialize()` with no
   *  override (which would itself throw once it PATH-walks a possibly-fake `rg` shell function). */
  ripgrepOverride: { command: string; argv0: 'rg' } | null;
}

/** Streamed child -> parent, one JSON object per stdout line (JSONL). `message_end`/`final`/`error`
 *  map directly onto `message.role === 'assistant'` events from pi's own `session.subscribe()` —
 *  filtered to assistant-only here (pi-spike-report.md design change 8: `message_end` fires for
 *  EVERY message role, not just assistant). */
export type PiChildEvent =
  | { t: 'ready' }
  | { t: 'message_end'; seq: number; text: string; usage: Tokens; stopReason: string }
  | { t: 'final'; seq: number; text: string; usage: Tokens; stopReason: string }
  /** residual fix (#127): an assistant message with `stopReason:'error'` carries REAL partial usage
   *  (pi-spike-report.md S4: confirmed on a real abort; the same is true of a mid-stream provider
   *  error) — `usage` is present exactly when the error came from that shape (session-runner.ts's own
   *  `msg.stopReason === 'error'` branch); absent for a thrown/fatal failure with no message usage to
   *  report at all (never a fabricated zero standing in for "unknown"). */
  | { t: 'error'; message: string; stopReason?: string; usage?: Tokens }
  | { t: 'fatal'; message: string }
  /** spec "Transcript and harness record": pi's own `tool_execution_start`/`tool_execution_end`
   *  events (slice f), mapped 1:1 — `args`/`result` are JSON-serialized defensively (an
   *  args/result value pi hands back is not guaranteed JSON-safe; a circular/BigInt value would
   *  otherwise throw inside JSON.stringify(event) at the call site in entry.ts). */
  | { t: 'tool_call'; toolCallId: string; toolName: string; argsJson: string }
  | { t: 'tool_result'; toolCallId: string; toolName: string; resultJson: string; isError: boolean }
  /** slice (g): emitted ONCE, right before `session.prompt()`, when `config.mcp` is non-empty — pi
   *  has no connection-status API on the plain session surface (pi-spike-report.md S5: only
   *  `getActiveToolNames()` is observable), so this is "every MCP tool name active at the moment the
   *  child stopped waiting" (either every declared server's `direct` tools showed up, or the ~10s
   *  `startupWaitMs` window elapsed first) — the parent derives per-server status from it via the
   *  SAME `mcp__<server>__` prefix matching `summarizeMcpInit` already does for the sdk gateway. */
  | { t: 'mcp_init'; servers: string[]; activeTools: string[] };
