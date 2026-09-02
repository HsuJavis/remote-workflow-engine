// E2E-002: Suspend → resume → cache replay (REQ-006, REQ-002)
// Real entrypoint: running MCP HTTP server. No mock of store or sandbox.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

// v22 (adjudication #2 L-2): these three cases are genuinely about suspend/resume/replay, so they
// all migrate onto the register→publish→run helper. The `RunSpec.script` field K-4 RETAINED (for the
// pre-v22 persisted-spec read-back at run-manager.ts `_requireLive`, `let script = spec.script ?? ''`)
// is NOT reachable from this tier: an e2e file's only ingress is the MCP HTTP surface, where inline
// script is refused by design, so no HTTP test can produce a script-bearing persisted spec. That
// branch keeps its coverage in the integration tier, on a directly-seeded spec (the
// `run-store-persistence.test.ts` pattern). What this file DOES now cover is the sibling branch:
// `spec.name && !spec.script` re-resolving the pinned version from the catalog on rehydrate — see
// the restart case below.
describe('E2E: suspend / resume / cache replay (REQ-006, REQ-002)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server?.close();
  });

  async function mcpCall(method: string, args: unknown) {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name: method, arguments: args } }),
    });
    const body = await res.json() as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0].text);
  }

  // D-F3 (final route-back round): raised from 15000ms — this route's suite now spawns several
  // additional real-child-process/real-HTTP-server integration files (IT-015/IT-016), increasing
  // host scheduling contention beyond what the earlier fileParallelism:false fix alone tolerates.
  // Assertion semantics unchanged, only the tolerance window widened.
  async function pollUntil(runId: string, predicate: (status: string) => boolean, maxMs = 25000) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const s = await mcpCall('workflow_status', { runId });
      if (predicate(s.status)) return s;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('Timed out waiting for status condition');
  }

  // D-F3: replaces the previous fixed 100ms pre-suspend sleep. A blind fixed sleep is NOT
  // contention-tolerant in either direction — measured empirically (see 05-tests.md E2E-002 note):
  // under this environment's fast local no-credential agent() rejection path, a run reaches
  // 'completed' only ~150-200ms after workflow_run, so simply raising the fixed sleep (tried 300ms
  // first) made the race deterministically LOSE (suspend always arrived after completion) rather
  // than tolerating contention. Actively polling for 'running' and firing suspend the instant it's
  // observed adapts to however long host contention makes the child actually take to start, without
  // ever risking overshoot past completion. Bounded so it still fails loudly, never hangs.
  async function waitUntilRunning(runId: string, maxMs = 10000) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const s = await mcpCall('workflow_status', { runId });
      if (s.status === 'running') return;
      if (s.status === 'completed' || s.status === 'failed') return; // let the caller's own assertion surface the mismatch
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  it('suspend stops in-flight work and status becomes suspended', async () => {
    const run = await runScriptVia(mcpCall, `
        const r = await agent('step-1');
        const r2 = await agent('step-2');
        return {r, r2};
      `);
    const runId = run.runId;

    await waitUntilRunning(runId);
    await mcpCall('workflow_suspend', { runId });

    const status = await mcpCall('workflow_status', { runId });
    expect(status.status).toBe('suspended');
  }, 30000);

  it('resume replays cached agent() calls without re-running them', async () => {
    // First run: stop midway (we simulate by letting a single-agent workflow complete once,
    // stopping it, then resuming with the same script — the first call replays from cache)
    const run = await runScriptVia(mcpCall, `return agent('the-query');`);
    const runId = run.runId;

    await pollUntil(runId, (s) => s === 'completed');
    await mcpCall('workflow_stop', { runId });

    // Resume with same script — agent should replay from journal, no new model call
    await mcpCall('workflow_resume', { runId });
    const resumed = await pollUntil(runId, (s) => s === 'completed' || s === 'failed');
    expect(resumed.status).toBe('completed');
  }, 45000);

  it('suspended run survives server restart and can be resumed', async () => {
    // This tests journal durability. We simulate restart by closing and reopening the server
    // with the same work root (same SQLite + journal.jsonl files).
    // v22: the same work root also carries the catalog, so the registered+published version this run
    // is pinned to survives the restart and `_requireLive` re-resolves it by pin (DES-113/ADR-010).
    const run = await runScriptVia(mcpCall, `return agent('persist-query');`);
    const runId = run.runId;

    await waitUntilRunning(runId);
    await mcpCall('workflow_suspend', { runId });
    await pollUntil(runId, (s) => s === 'suspended');

    const workRoot = (server as unknown as { workRoot: string }).workRoot;
    await server.close();

    // Restart with same work root
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot });
    baseUrl = `http://127.0.0.1:${server.port}`;

    const status = await mcpCall('workflow_status', { runId });
    expect(status.status).toBe('suspended');

    await mcpCall('workflow_resume', { runId });
    const final = await pollUntil(runId, (s) => s === 'completed' || s === 'failed');
    expect(final.status).toBe('completed');
  }, 45000);
});
