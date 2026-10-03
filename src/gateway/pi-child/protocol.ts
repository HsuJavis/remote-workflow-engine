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
  /** Optional override of OpenRouter's base URL (slice (i): a recording fake server stands in for
   *  `https://openrouter.ai/api/v1` so the request shape can be verified with no real key). Absent
   *  -> the real OpenRouter endpoint. Ignored for ollama (which always uses `model.baseUrl`). */
  openrouterBaseUrl?: string;
}

export type PiChildModelConfig =
  | { provider: 'ollama'; model: string; baseUrl: string }
  | { provider: 'openrouter'; model: string };

/** Streamed child -> parent, one JSON object per stdout line (JSONL). `message_end`/`final`/`error`
 *  map directly onto `message.role === 'assistant'` events from pi's own `session.subscribe()` —
 *  filtered to assistant-only here (pi-spike-report.md design change 8: `message_end` fires for
 *  EVERY message role, not just assistant). */
export type PiChildEvent =
  | { t: 'ready' }
  | { t: 'message_end'; seq: number; text: string; usage: Tokens; stopReason: string }
  | { t: 'final'; seq: number; text: string; usage: Tokens; stopReason: string }
  | { t: 'error'; message: string; stopReason?: string }
  | { t: 'fatal'; message: string };
