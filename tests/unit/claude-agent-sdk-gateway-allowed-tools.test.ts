// UT-024: ClaudeAgentSdkGatewayClient sets a CURATED options.allowedTools per call (D-F11).
//
// D-F11 (binding, ORCH ruling on Gate 7.5 round 5's tool-use defect): FIX the fixable part — curate
// options.allowedTools per call/agentType (agent definitions frontmatter `tools` field is
// authoritative; default = a minimal core set e.g. Read/Write/Bash, configurable) so small local
// models are not overwhelmed by the SDK CLI's full, uncurated tool surface. `08-validation.md`
// round-5 VAL-003 root cause: `query()`'s `options` never restricts the tool surface at all today —
// every call sends the CLI's full tool list (dozens of tools, including this shared host's own
// unrelated MCP plugin tools), which a direct SDK query() probe + 2 independent real repros showed
// overwhelms a 7B local model (qwen2.5:7b) enough that it never attempts a real tool_use call and
// instead free-associates a fabricated-looking answer.
//
// Verifier-authored design extension (same precedent as D-V5/D-F2/D-F6/D-F7 before it — not yet in
// 04-design.md, flagged for Gate 6 to finalize): `ClaudeAgentSdkGatewayConfig` grows
// `defaultAllowedTools?: string[]` (the configurable minimal core set D-F11 calls for); the shared
// `req.opts` shape grows `allowedTools?: string[]` (the per-call/per-agentType curated set —
// UT-025 proves AgentExecutor threads a resolved agentType's frontmatter `tools:` field into this).
// `invoke()` must set `options.allowedTools` (the SDK's own documented restriction hook,
// `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1323`) to: the caller's `req.opts.allowedTools`
// when given (agentType-derived curation wins); otherwise `this._config.defaultAllowedTools` when
// configured; otherwise a built-in minimal core set — NEVER left unset (today's behavior), which is
// exactly what lets the SDK's own full uncurated tool surface through.
//
// Mock policy (DES-015, unit tier): vi.mock intercepts only the third-party
// @anthropic-ai/claude-agent-sdk module (same pattern as UT-018/019/020/021/022) — the assertion is
// entirely about what `options` object this client hands to `query()`.
//
// Red reason: confirmed by reading `src/gateway/claude-agent-sdk-client.ts` — the `options` object
// built in `_invokeOnce` never sets `allowedTools` at all (no such key anywhere in the file), so
// `call.options?.allowedTools` is `undefined` in every case below, not an import/syntax error.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClaudeAgentSdkGatewayConfig } from '../../src/gateway/claude-agent-sdk-client.js';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

/** A trivial session that immediately yields one successful result message — invoke() only needs
 *  to resolve so the test can inspect what was passed to query(); the actual response content is
 *  irrelevant to this test. */
function okSession(): AsyncGenerator<unknown> {
  return (async function* () {
    yield {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'ok',
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  })();
}

describe('ClaudeAgentSdkGatewayClient curates options.allowedTools per call (UT-024, D-F11)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockReturnValue(okSession());
  });

  it('req.opts.allowedTools (agentType-derived curation) is forwarded verbatim to options.allowedTools', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });

    await client.invoke({
      prompt: 'hi',
      // v25 (#55): the `@ts-expect-error` that stood here said allowedTools was "a verifier-authored
      // design extension to AgentOpts, not yet in src/types.ts (flagged for Gate 6)". It is now
      // declared, so the suppression is gone and the compiler checks this call — the flag was open
      // for three iterations and is exactly why no author could discover the option.
      opts: { allowedTools: ['Read', 'Write'] },
      runId: 'r1',
      agentId: 'a1',
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [[call]] = queryMock.mock.calls as [[{ options?: { allowedTools?: string[] } }]];
    // Forcing red: today's src never sets options.allowedTools at all.
    expect(call.options?.allowedTools).toEqual(['Read', 'Write']);
  });

  it('a configured default core set is used when the call carries no allowedTools of its own', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const config: ClaudeAgentSdkGatewayConfig & { defaultAllowedTools?: string[] } = {
      baseUrl: 'http://127.0.0.1:4000',
      defaultAllowedTools: ['Read', 'Write', 'Bash'],
    };
    const client = new ClaudeAgentSdkGatewayClient(config);

    await client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a2' });

    const [[call]] = queryMock.mock.calls as [[{ options?: { allowedTools?: string[] } }]];
    // Forcing red: same gap — never set today regardless of config.
    expect(call.options?.allowedTools).toEqual(['Read', 'Write', 'Bash']);
  });

  it('never leaves allowedTools unset (falls back to a built-in minimal core set) even with no config and no per-call override', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000' });

    await client.invoke({ prompt: 'hi', opts: {}, runId: 'r1', agentId: 'a3' });

    const [[call]] = queryMock.mock.calls as [[{ options?: { allowedTools?: string[] } }]];
    // Forcing red: today's src leaves allowedTools undefined in this case too, which is exactly
    // what lets the SDK CLI's full, uncurated tool surface (dozens of tools) through — the root
    // cause 08-validation.md round-5 VAL-003 identified. A curated default must be non-empty.
    expect(call.options?.allowedTools).toBeDefined();
    expect(Array.isArray(call.options?.allowedTools)).toBe(true);
    expect(call.options?.allowedTools?.length).toBeGreaterThan(0);
  });
});

// UT-110 (TASK-116, DES-120, ARCH-079/ADR-020): `curateToolsForProvider` must PRESERVE an
// explicitly-empty tool set — today it silently AUGMENTS `[]` to `['Bash']` for any non-Anthropic
// provider, which falsifies ADR-020's "the default blast radius is nil": `graphAnalyzer.tools: []`
// (the analyzer's default) would ship a Bash-enabled session whose prompt is attacker-authored
// script text, on this deployment's own default path (gateway:"sdk" + a local Ollama alias).
//
// Mock policy (unit): pure function under test, zero I/O — direct call, no gateway construction.
//
// Red reason: confirmed by reading `src/gateway/claude-agent-sdk-client.ts:223-227` —
// `curateToolsForProvider([], 'ollama')` returns `['Bash']` today (the `filtered.includes('Bash') ?
// filtered : [...filtered, 'Bash']` line adds Bash unconditionally for a non-Anthropic provider,
// with no early-return for an empty input). This is a REAL behavioral red, not an import/syntax gap.
describe('curateToolsForProvider preserves an intentionally-empty tool set (UT-110, D-F11 general fix, DES-120)', () => {
  it('an explicitly-empty tool set for a non-Anthropic provider (ollama) stays EMPTY — no Bash augmentation', async () => {
    // Dynamic import (same convention as every other case in this file): a static top-level VALUE
    // import of this module would load it — and its own @anthropic-ai/claude-agent-sdk import —
    // before `const queryMock = vi.fn()` below initializes, breaking the hoisted vi.mock factory.
    const { curateToolsForProvider } = await import('../../src/gateway/claude-agent-sdk-client.js');
    expect(curateToolsForProvider([], 'ollama')).toEqual([]);
  });

  it('an explicitly-empty tool set for undefined/anthropic provider is unaffected (already correct, green pin)', async () => {
    const { curateToolsForProvider } = await import('../../src/gateway/claude-agent-sdk-client.js');
    expect(curateToolsForProvider([], undefined)).toEqual([]);
    expect(curateToolsForProvider([], 'anthropic')).toEqual([]);
  });

  it('a NON-empty tool set for a non-Anthropic provider is UNCHANGED by this fix — still Bash-augmented (green pin; UT-024\'s fallback path)', async () => {
    const { curateToolsForProvider } = await import('../../src/gateway/claude-agent-sdk-client.js');
    expect(curateToolsForProvider(['Write'], 'ollama')).toEqual(['Write', 'Bash']);
  });
});
