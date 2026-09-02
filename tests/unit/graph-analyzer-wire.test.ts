// UT-112 (TASK-117, DES-122/131, ARCH-079): the analyzer's isolation, at the WIRE level — a gateway
// (or hand-rolled stub) test cannot see a `cfg.tools -> opts.tools` mis-map; only asserting the
// ACTUAL built `options` object passed to the SDK's `query()` can. With a non-Anthropic alias, the
// built options must literally equal: `tools: []`, `allowedTools: []`, `settingSources: []`,
// `strictMcpConfig: true`, empty `mcpServers`, thinking disabled, and `cwd` = the analyzer's own
// scratch directory (`<workRoot>/.graph-analyzer-scratch` — DES-122's construction-time repoint,
// simulated here by constructing the REAL `ClaudeAgentSdkGatewayClient` with that `cwd` directly,
// since the repoint itself lives in `main.ts`, out of this module's scope).
//
// Mock policy (unit, DES-119): `vi.mock` intercepts only the third-party
// `@anthropic-ai/claude-agent-sdk` module (same pattern as UT-024/UT-116) — the assertion is
// entirely about what `options` object the REAL gateway hands to `query()` when driven by the REAL
// `GraphAnalyzer`.
//
// Red reason: `src/graph-analyzer.ts` does not exist yet -> MODULE NOT FOUND at collect time.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import type { TriggerPorts } from '../../src/trigger-bindings.js';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

function okSession(): AsyncGenerator<unknown> {
  return (async function* () {
    yield {
      type: 'result', subtype: 'success', is_error: false,
      result: '╭─Draft─╮', usage: { input_tokens: 10, output_tokens: 5 },
    };
  })();
}

const CLOCK = new FixedClock(new Date('2026-09-02T10:00:00.000Z'));
const ALIASES = { 'ollama-qwen': { provider: 'ollama' as const, model: 'qwen2.5:7b' } };
const NO_TRIGGERS: TriggerPorts = {
  schedules: { listByWorkflow: () => [] },
  webhooks: { listByWorkflow: () => [] },
  continuations: { listPendingByWorkflow: () => [] },
  runs: { getWorkflowName: () => null },
};
const runInline = (job: () => Promise<void>): void => { void job(); };

let workRoot: string;
beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-analyzer-wire-'));
  queryMock.mockReset();
  queryMock.mockReturnValue(okSession());
});
afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

describe('GraphAnalyzer -> real ClaudeAgentSdkGatewayClient wire (UT-112, DES-122, non-Anthropic alias)', () => {
  it('the built options literally isolate the analyzer session (tools/allowedTools/settingSources/strictMcpConfig/mcpServers/thinking/cwd)', async () => {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const { GraphAnalyzer } = await import('../../src/graph-analyzer.js');
    const scratchCwd = join(workRoot, '.graph-analyzer-scratch');
    const gateway = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000', aliases: ALIASES, cwd: scratchCwd });
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await catalog.register('ga-wire', `return 1;`);
    const analyzer = new GraphAnalyzer({
      gateway, catalog, ports: NO_TRIGGERS, clock: CLOCK,
      config: { enabled: true, model: 'ollama-qwen', systemPrompt: 'draw', tools: [], timeoutMs: 5000, retries: 0, maxBytes: 8192, maxLines: 120, maxQueueDepth: 8 },
      aliasNames: new Set(['ollama-qwen']), schedule: runInline,
    });

    analyzer.enqueue('ga-wire', 'v1', `return 1;`, null);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [[call]] = queryMock.mock.calls as [[{ options?: Record<string, unknown> }]];
    expect(call.options?.['tools']).toEqual([]);
    expect(call.options?.['allowedTools']).toEqual([]);
    expect(call.options?.['settingSources']).toEqual([]);
    expect(call.options?.['strictMcpConfig']).toBe(true);
    expect(Object.keys((call.options?.['mcpServers'] as Record<string, unknown> | undefined) ?? {}).length).toBe(0);
    expect(call.options?.['thinking']).toEqual({ type: 'disabled' });
    expect(call.options?.['cwd']).toBe(scratchCwd);
  });
});
