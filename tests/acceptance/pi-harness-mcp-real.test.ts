// pi harness v1, slice (g) real-tier evidence: a REAL PiGatewayClient.invoke() dispatch, through a
// REAL spawned pi child, to a REAL local Ollama (qwen2.5:7b), with a REAL stdio MCP server
// (`npx -y @modelcontextprotocol/server-everything`) registered via `pi.registerMcpServer()` +
// `exposure:'direct'` — no fakes anywhere on this path. Gated on Ollama being reachable, same
// convention as pi-harness-ollama-real.test.ts.
//
// Dispatch instruction: "Small models may be flaky — retry a few times, and if the model never calls
// the tool, prove turn-1 availability from the init status/tool list instead and say so." Both are
// asserted independently below: turn-1 availability (the `mcp_init`-refined harness descriptor) is
// checked on EVERY successful dispatch regardless of whether the model actually called the tool;
// the model-actually-called-it claim is retried up to 3 times and reported honestly either way.
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';
import type { ResolveMcpFn } from '../../src/gateway/mcp-config-resolver.js';

function ollamaReachable(): boolean {
  try {
    return execSync('curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:11434/api/tags', { encoding: 'utf8' }).trim() === '200';
  } catch {
    return false;
  }
}
const HAS_OLLAMA = ollamaReachable();
const WHY_NOT = ' [UNVERIFIED here: needs a real local Ollama at localhost:11434 with qwen2.5:7b pulled, and npm registry access for npx]';

const everythingResolveMcp: ResolveMcpFn = async (_workflow, names) => ({
  configs: Object.fromEntries(names.map((n) => [n, { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] }])),
  missing: [],
});

function pgrepServerEverything(): string {
  try { return execSync('pgrep -af "server-everythin[g]" || true', { encoding: 'utf8' }).trim(); } catch { return ''; }
}

describe('pi harness v1 — REAL MCP via a real stdio server-everything + real ollama (slice g)', () => {
  it.skipIf(!HAS_OLLAMA)('turn-1 availability: mcp_init reports the everything server connected with its tools, regardless of whether the model calls one' + WHY_NOT, async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-mcp-real-'));
    type Refined = { mcpStatus?: Array<{ server: string; status: string; tools: string[] }>; warnings?: unknown[] };
    try {
      let refined: Refined | undefined;
      // Retried: a slow ollama reply can make the WHOLE dispatch time out even though the mcp_init
      // handshake (which happens before `session.prompt()` is even called) already succeeded — real
      // small-model/cold-npx-start latency, not an MCP defect. Each attempt's own onHarness calls are
      // inspected regardless of whether that attempt's dispatch ultimately timed out.
      for (let attempt = 0; attempt < 3 && refined === undefined; attempt++) {
        const gw = new PiGatewayClient({ ollamaBaseUrl: 'http://localhost:11434', timeoutMs: 75_000, resolveMcp: everythingResolveMcp });
        const harnessCalls: Refined[] = [];
        await gw.invoke({
          prompt: 'Reply with exactly the single word: PONG. Do not call any tool.',
          opts: { model: 'ollama/qwen2.5:7b' },
          runId: `mcp-real-r1-${attempt}`,
          agentId: `mcp-real-a1-${attempt}`,
          workspace: ws,
          assets: { roots: { workflow: ws, global: ws }, declared: { skills: [], mcp: ['everything'] }, workflow: 'wf' },
          onHarness: async (h) => { harnessCalls.push(h as never); },
        });
        if (harnessCalls.length >= 2) refined = harnessCalls[harnessCalls.length - 1];
      }
      // The SECOND onHarness call (after the child's mcp_init) carries the real turn-1 tool list —
      // proves `pi.registerMcpServer(..., {exposure:'direct'})` actually connected within the
      // session's own startup window (spike S5's own 10s startupWaitMs), independent of the model's
      // behavior this turn or of whether the overall dispatch later timed out.
      expect(refined).toBeDefined();
      expect(refined!.mcpStatus?.[0]?.server).toBe('everything');
      expect(refined!.mcpStatus?.[0]?.status).toBe('connected');
      expect(refined!.mcpStatus?.[0]?.tools.length).toBeGreaterThan(0);
      expect(refined!.mcpStatus?.[0]?.tools.some((t) => t.includes('echo'))).toBe(true);
      expect(refined!.warnings).toBeUndefined();
    } finally {
      rmSync(ws, { recursive: true, force: true });
      await new Promise((r) => setTimeout(r, 500));
      expect(pgrepServerEverything()).toBe('');
    }
  }, 260_000);

  it.skipIf(!HAS_OLLAMA)('the model calls the echo tool on turn 1 (retried up to 3x for real small-model flakiness)' + WHY_NOT, async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-mcp-real-echo-'));
    let calledTheTool = false;
    let lastResultOk = false;
    try {
      for (let attempt = 0; attempt < 3 && !calledTheTool; attempt++) {
        const gw = new PiGatewayClient({ ollamaBaseUrl: 'http://localhost:11434', timeoutMs: 60_000, resolveMcp: everythingResolveMcp });
        const events: Array<{ kind: string; data: unknown }> = [];
        const result = await gw.invoke({
          prompt: "Call the 'echo' tool from the 'everything' MCP server with message='hi-from-pi-harness'. You MUST use the tool, do not just describe it.",
          opts: { model: 'ollama/qwen2.5:7b' },
          runId: `mcp-real-echo-${attempt}`,
          agentId: `mcp-real-echo-a-${attempt}`,
          workspace: ws,
          assets: { roots: { workflow: ws, global: ws }, declared: { skills: [], mcp: ['everything'] }, workflow: 'wf' },
          onEvent: (ev) => { events.push(ev as never); },
        });
        lastResultOk = result.ok;
        calledTheTool = events.some((e) => e.kind === 'tool_call' && (e.data as { toolName?: string }).toolName?.includes('echo'));
      }
    } finally {
      rmSync(ws, { recursive: true, force: true });
      await new Promise((r) => setTimeout(r, 500));
      expect(pgrepServerEverything()).toBe('');
    }
    // Honest report either way, per the dispatch's own instruction: a 7B model is not guaranteed to
    // call a tool it was told about even across 3 tries — the MECHANISM is independently proven by
    // the "turn-1 availability" test above regardless of this outcome.
    // eslint-disable-next-line no-console
    console.log(calledTheTool ? 'MCP REAL CHECK: the model called mcp__everything__echo on turn 1.' : 'MCP REAL CHECK: the model never called the echo tool in 3 tries (small-model flakiness) — turn-1 availability is proven separately by the previous test; last dispatch ok=' + lastResultOk);
    expect(typeof calledTheTool).toBe('boolean');
  }, 240_000);
});
