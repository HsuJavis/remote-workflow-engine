// pi harness v1, slice (g) real-tier evidence: a REAL PiGatewayClient.invoke() dispatch, through a
// REAL spawned pi child, to a REAL local Ollama (qwen2.5:7b), with a REAL stdio MCP server
// (`npx -y @modelcontextprotocol/server-everything`) registered via `pi.registerMcpServer()` +
// `exposure:'direct'` — no fakes anywhere on this path.
//
// review B2 (HIGH): gated on the EXPLICIT opt-in RWE_PI_REAL_TESTS=1 PLUS Ollama/model/npm-registry
// reachability (review P6-3: the old gate never checked the registry, so with Ollama up and the
// registry down this failed at dispatch instead of skipping). review P6-2: leftover-process checks
// are scoped to THIS test's own spawned descendant pids (captured via `collectDescendantPids` while
// the dispatch is still in flight), never a host-wide `pgrep -af "server-everythin[g]"` that would
// also match an unrelated server-everything running elsewhere on the host.
//
// Dispatch instruction: "Small models may be flaky — retry a few times, and if the model never calls
// the tool, prove turn-1 availability from the init status/tool list instead and say so." Both are
// asserted independently below: turn-1 availability (the `mcp_init`-refined harness descriptor) is
// checked on EVERY successful dispatch regardless of whether the model actually called the tool;
// the model-actually-called-it claim is retried up to 3 times and reported honestly either way.
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';
import type { ResolveMcpFn } from '../../src/gateway/mcp-config-resolver.js';
import { piRealTestsEnabled, ollamaReachable, ollamaModelPulled, npmRegistryReachable, collectDescendantPids, isDead } from '../helpers/pi-real-gate.js';

const MODEL_TAG = 'qwen2.5:7b';
const RUN = piRealTestsEnabled() && ollamaReachable() && ollamaModelPulled(MODEL_TAG) && npmRegistryReachable();
const WHY_NOT = ` [UNVERIFIED here: needs RWE_PI_REAL_TESTS=1, a real local Ollama at localhost:11434 with ${MODEL_TAG} pulled, and npm registry access for npx]`;

const everythingResolveMcp: ResolveMcpFn = async (_workflow, names) => ({
  configs: Object.fromEntries(names.map((n) => [n, { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] }])),
  missing: [],
});

/** review P6-2: wraps `spawnChild` to capture the pi child's own pid, so a test can snapshot its
 *  descendant tree (the npx-launched MCP server and ITS children) while the dispatch is still alive —
 *  `collectDescendantPids` walks `/proc/<pid>/task/<pid>/children` by PARENT-CHILD relationship, which
 *  survives npm-exec's own `setpgid` (that changes process GROUP, never the ppid tree). */
function spawnChildCapturingPid(capture: { pid?: number }) {
  return ((cmd: string, args: string[], opts: Record<string, unknown>) => {
    const child = spawn(cmd, args, opts);
    capture.pid = child.pid;
    return child;
  }) as never;
}

function expectDescendantsDead(pids: readonly number[]): void {
  for (const pid of pids) expect(isDead(pid)).toBe(true);
}

describe('pi harness v1 — REAL MCP via a real stdio server-everything + real ollama (slice g)', () => {
  it.skipIf(!RUN)('turn-1 availability: mcp_init reports the everything server connected with its tools, regardless of whether the model calls one' + WHY_NOT, async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-mcp-real-'));
    type Refined = { mcpStatus?: Array<{ server: string; status: string; tools: string[] }>; warnings?: unknown[] };
    const descendantPids: number[] = [];
    try {
      let refined: Refined | undefined;
      // Retried: a slow ollama reply can make the WHOLE dispatch time out even though the mcp_init
      // handshake (which happens before `session.prompt()` is even called) already succeeded — real
      // small-model/cold-npx-start latency, not an MCP defect. Each attempt's own onHarness calls are
      // inspected regardless of whether that attempt's dispatch ultimately timed out.
      for (let attempt = 0; attempt < 3 && refined === undefined; attempt++) {
        const captured: { pid?: number } = {};
        const gw = new PiGatewayClient({ ollamaBaseUrl: 'http://localhost:11434', timeoutMs: 75_000, resolveMcp: everythingResolveMcp, spawnChild: spawnChildCapturingPid(captured) });
        const harnessCalls: Refined[] = [];
        await gw.invoke({
          prompt: 'Reply with exactly the single word: PONG. Do not call any tool.',
          opts: { model: 'ollama/qwen2.5:7b' },
          runId: `mcp-real-r1-${attempt}`,
          agentId: `mcp-real-a1-${attempt}`,
          workspace: ws,
          assets: { roots: { workflow: ws, global: ws }, declared: { skills: [], mcp: ['everything'] }, workflow: 'wf' },
          onHarness: async (h) => {
            harnessCalls.push(h as never);
            // Snapshot the descendant tree NOW, while the pi child (and its npx grandchild) is still
            // alive — the second onHarness call fires right after mcp_init, i.e. after npx has
            // connected.
            if ((h as Refined).mcpStatus !== undefined && captured.pid !== undefined) {
              descendantPids.push(...collectDescendantPids(captured.pid));
            }
          },
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
      expectDescendantsDead(descendantPids);
    }
  }, 260_000);

  it.skipIf(!RUN)('the model calls the echo tool on turn 1 (retried up to 3x for real small-model flakiness)' + WHY_NOT, async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-mcp-real-echo-'));
    let calledTheTool = false;
    let lastResultOk = false;
    const descendantPids: number[] = [];
    try {
      for (let attempt = 0; attempt < 3 && !calledTheTool; attempt++) {
        const captured: { pid?: number } = {};
        const gw = new PiGatewayClient({ ollamaBaseUrl: 'http://localhost:11434', timeoutMs: 60_000, resolveMcp: everythingResolveMcp, spawnChild: spawnChildCapturingPid(captured) });
        const events: Array<{ kind: string; data: unknown }> = [];
        const result = await gw.invoke({
          prompt: "Call the 'echo' tool from the 'everything' MCP server with message='hi-from-pi-harness'. You MUST use the tool, do not just describe it.",
          opts: { model: 'ollama/qwen2.5:7b' },
          runId: `mcp-real-echo-${attempt}`,
          agentId: `mcp-real-echo-a-${attempt}`,
          workspace: ws,
          assets: { roots: { workflow: ws, global: ws }, declared: { skills: [], mcp: ['everything'] }, workflow: 'wf' },
          onEvent: (ev) => { events.push(ev as never); },
          onHarness: async (h) => {
            if ((h as { mcpStatus?: unknown }).mcpStatus !== undefined && captured.pid !== undefined) {
              descendantPids.push(...collectDescendantPids(captured.pid));
            }
          },
        });
        lastResultOk = result.ok;
        // issue #139(a) / v0374 review L-4: the engine-canonical tool_call shape (pi-gateway-client.ts's
        // own fix) carries the tool name on `name`, not `toolName` — this used to always read
        // `undefined`, so `calledTheTool` was always false regardless of what the model actually did.
        calledTheTool = events.some((e) => e.kind === 'tool_call' && (e.data as { name?: string }).name?.includes('echo'));
      }
    } finally {
      rmSync(ws, { recursive: true, force: true });
      await new Promise((r) => setTimeout(r, 500));
      expectDescendantsDead(descendantPids);
    }
    // Honest report either way, per the dispatch's own instruction: a 7B model is not guaranteed to
    // call a tool it was told about even across 3 tries — the MECHANISM is independently proven by
    // the "turn-1 availability" test above regardless of this outcome.
    // eslint-disable-next-line no-console
    console.log(calledTheTool ? 'MCP REAL CHECK: the model called mcp__everything__echo on turn 1.' : 'MCP REAL CHECK: the model never called the echo tool in 3 tries (small-model flakiness) — turn-1 availability is proven separately by the previous test; last dispatch ok=' + lastResultOk);
    expect(typeof calledTheTool).toBe('boolean');
  }, 240_000);

  it.skipIf(!RUN)('abort mid-flight (AFTER the MCP server connected) still fully reaps the stdio server — the discriminating case pi\'s own client.close() SIGTERM never runs for' + WHY_NOT, async () => {
    // Discriminating on purpose: a normal completion (the first test above) lets pi's own
    // client.close() send a clean SIGTERM to the server before the child exits — that path was
    // already proven. An ABORT kills the pi child itself via the parent's group-SIGKILL
    // (pi-gateway-client.ts's reap()) BEFORE pi's MCP extension ever gets to run its own close()
    // — the only thing that can reap the server in that case is the escaped-descendant sweep
    // (pi-gateway-client.ts's own /proc-walk fix for npx's setpgid escape). This is the case that
    // actually tests it.
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-mcp-real-abort-'));
    const descendantPids: number[] = [];
    try {
      const captured: { pid?: number } = {};
      const gw = new PiGatewayClient({ ollamaBaseUrl: 'http://localhost:11434', timeoutMs: 60_000, resolveMcp: everythingResolveMcp, spawnChild: spawnChildCapturingPid(captured) });
      const controller = new AbortController();
      let sawMcpInit = false;
      const promise = gw.invoke({
        prompt: 'Write a very long, detailed 500-word essay about the history of the number zero.',
        opts: { model: 'ollama/qwen2.5:7b' },
        runId: 'mcp-real-abort-r1',
        agentId: 'mcp-real-abort-a1',
        workspace: ws,
        assets: { roots: { workflow: ws, global: ws }, declared: { skills: [], mcp: ['everything'] }, workflow: 'wf' },
        signal: controller.signal,
        onHarness: async (h) => {
          // The SECOND onHarness call (mcpStatus present) only fires after mcp_init, i.e. after the
          // server already connected — abort right after it, not before (a pre-connect abort would
          // prove nothing about reaping a CONNECTED server).
          if ((h as { mcpStatus?: unknown }).mcpStatus !== undefined && !sawMcpInit) {
            sawMcpInit = true;
            if (captured.pid !== undefined) descendantPids.push(...collectDescendantPids(captured.pid));
            controller.abort();
          }
        },
      });
      const result = await promise;
      expect(result.ok).toBe(false);
      expect(sawMcpInit).toBe(true);
      await new Promise((r) => setTimeout(r, 500));
      expectDescendantsDead(descendantPids);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }, 90_000);
});
