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
}

export type PiChildModelConfig =
  | { provider: 'ollama'; model: string; baseUrl: string }
  | { provider: 'openrouter'; model: string };

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
  | { t: 'error'; message: string; stopReason?: string }
  | { t: 'fatal'; message: string }
  /** spec "Transcript and harness record": pi's own `tool_execution_start`/`tool_execution_end`
   *  events (slice f), mapped 1:1 — `args`/`result` are JSON-serialized defensively (an
   *  args/result value pi hands back is not guaranteed JSON-safe; a circular/BigInt value would
   *  otherwise throw inside JSON.stringify(event) at the call site in entry.ts). */
  | { t: 'tool_call'; toolCallId: string; toolName: string; argsJson: string }
  | { t: 'tool_result'; toolCallId: string; toolName: string; resultJson: string; isError: boolean };
