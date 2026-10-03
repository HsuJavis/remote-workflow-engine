// src/gateway/pi-gateway-client.ts (pi harness v1, owner decisions 1-3; pi-harness-research.md
// §5.2, pi-spike-report.md). `PiGatewayClient implements GatewayClient` — the SAME port
// `ClaudeAgentSdkGatewayClient` implements, selected by `gateway:"pi"` in rwe.config.json
// (composeConfig(), src/main.ts) instead of the default `gateway:"sdk"`.
//
// v1-a (this file, incremental): the class shape + constructor are real; `invoke()` is filled in
// across the following commits in this same iteration (child process spawn, tool mapping, bash
// confinement, usage/transcript mapping, MCP, effort). Tracked honestly rather than silently
// stubbed: every unimplemented call fails CLOSED with a typed, non-retryable reason rather than
// pretending to succeed or falling back to another transport.
import type { AgentOpts, Caps, HarnessDescriptor, Tokens, TranscriptEvent } from '../types.js';
import type { GatewayClient, GatewayResult, EffortApplied } from './client.js';

export interface PiGatewayConfig {
  /** The OpenRouter API key, from the same secret store `resolveAnthropicAuth` reads from
   *  (RWE_SECRET_OPENROUTER_API_KEY / OPENROUTER_API_KEY) — injected only into the pi child's
   *  memory via `setRuntimeApiKey`, never into bash env, never to disk. */
  secretSource?: { resolve(name: string): string | undefined };
  /** `OLLAMA_BASE_URL` — same meaning as the rest of the engine (default `http://localhost:11434`). */
  ollamaBaseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  /** v37 (ARCH-181/262): the pi-PATH confinement posture — a SEPARATE measurement from the sdk
   *  gateway's own boot probe (srt may not match the CLI-bundled sandbox-runtime version; the pi
   *  path also needs the ripgrep-binary override the sdk path never required). Set once at boot by
   *  main.ts's pi-path probe, forwarded through composeConfig() exactly like
   *  `ClaudeAgentSdkGatewayConfig.confinementPosture`. */
  confinementPosture?: 'confined' | 'unconfined';
}

export class PiGatewayClient implements GatewayClient {
  constructor(private readonly _config: PiGatewayConfig) {}

  async invoke(req: {
    prompt: string; opts: AgentOpts; runId: string; agentId: string; signal?: AbortSignal; workspace?: string;
    assets?: { roots: { workflow: string; global: string }; declared: { skills: string[]; mcp: string[] }; workflow: string };
    onHarness?: (h: HarnessDescriptor, applied?: EffortApplied) => Promise<void>;
    onEvent?: (ev: TranscriptEvent) => void | Promise<void>;
    onUsage?: (cumulative: Tokens) => void;
    caps?: Caps;
  }): Promise<GatewayResult> {
    // Filled in by the next commit in this iteration (child process + tool/model routing). Fails
    // closed, never silently — a caller never mistakes "not wired yet" for a real provider failure
    // it should retry forever against.
    void req;
    return {
      ok: false,
      provider: 'unknown',
      reason: 'terminal',
      retryable: false,
      detail: 'INTERNAL_ERROR: PiGatewayClient.invoke() is not yet implemented (pi harness v1 is mid-iteration)',
    };
  }

  async stop(): Promise<void> {
    // No managed subprocess owned at the gateway level yet (v1-a) — the per-dispatch child (once
    // implemented) is reaped per-call, not held here.
  }
}
