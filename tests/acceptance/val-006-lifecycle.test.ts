// VAL-006: Lifecycle — suspend/resume/stop with durable state (REQ-006)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

describe('VAL-006: suspend / resume / stop lifecycle (REQ-006)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = await createServer({ port: 0 });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => { await server?.close(); });

  async function callTool(name: string, args: unknown) {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0].text);
  }

  // D-F3 (final route-back round): raised from 20000ms — this route's suite now spawns several
  // additional real-child-process/real-HTTP-server integration files (IT-015/IT-016), increasing
  // host scheduling contention beyond what the earlier fileParallelism:false fix alone tolerates.
  // Assertion semantics unchanged (still polls for the same target status(es)), only the tolerance
  // window widened.
  async function pollStatus(runId: string, target: string | string[], maxMs = 30000) {
    const targets = Array.isArray(target) ? target : [target];
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const s = await callTool('workflow_status', { runId });
      if (targets.includes(s.status)) return s;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Timed out waiting for status ${target}`);
  }

  // D-F3: replaces the previous fixed 100ms pre-suspend/pre-stop sleep. A blind fixed sleep is
  // NOT contention-tolerant in either direction — measured empirically (see 05-tests.md VAL-006
  // note): under this environment's fast local no-credential agent() rejection path, a single-
  // agent-call run reaches 'completed' only ~150-200ms after workflow_run, so simply raising the
  // fixed sleep (tried 300ms first) made the race deterministically LOSE (suspend always arrived
  // after completion) rather than tolerating contention. Actively polling for 'running' and firing
  // suspend/stop the instant it's observed adapts to however long host contention makes the child
  // actually take to start, without ever risking overshoot past completion — genuinely more
  // contention-tolerant, not just a bigger constant. Bounded so it still fails loudly, never hangs.
  async function waitUntilRunning(runId: string, maxMs = 10000) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const s = await callTool('workflow_status', { runId });
      if (s.status === 'running') return;
      if (s.status === 'completed' || s.status === 'failed') return; // let the caller's own poll surface the mismatch
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  it('suspend transitions run to suspended; resume brings it back to running', async () => {
    const run = await runScriptVia(callTool, `return agent('slow-query');`);
    const runId = run.runId as string;
    await waitUntilRunning(runId);
    await callTool('workflow_suspend', { runId });
    const suspended = await pollStatus(runId, 'suspended');
    expect(suspended.status).toBe('suspended');

    await callTool('workflow_resume', { runId });
    const resumed = await pollStatus(runId, ['running', 'completed', 'failed']);
    expect(['running', 'completed', 'failed']).toContain(resumed.status);
  }, 45000);

  it('stop terminates run; workflow_result with edited script re-runs from first changed agent()', async () => {
    const run = await runScriptVia(callTool, `return agent('original');`);
    const runId = run.runId as string;

    await waitUntilRunning(runId);
    await callTool('workflow_stop', { runId });
    const stopped = await pollStatus(runId, 'stopped');
    expect(stopped.status).toBe('stopped');

    // Resume with an edited script — re-runs only from the first changed call.
    // NOT MIGRATED (reported to the orchestrator): v22 (REQ-098, mcp-facade.workflow_resume) refuses
    // `script` on resume with INLINE_SCRIPT_CLOSED, so this REQ-006 clause tests a capability the
    // engine no longer has. Left raw on purpose — the helper cannot express it, and rewriting it to
    // a plain resume would silently re-scope what this test asserts.
    await callTool('workflow_resume', { runId, script: `return agent('changed prompt');` });
    const final = await pollStatus(runId, ['completed', 'failed']);
    expect(['completed', 'failed']).toContain(final.status);
  }, 45000);

  it('workflow_status returns state after server restart (journal + store survive restart)', async () => {
    const run = await runScriptVia(callTool, `return 1;`);
    const runId = run.runId as string;
    await pollStatus(runId, 'completed');

    const workRoot = (server as unknown as { workRoot: string }).workRoot;
    await server.close();

    // Restart with the same work root
    server = await createServer({ port: 0, workRoot });
    baseUrl = `http://127.0.0.1:${server.port}`;

    const afterRestart = await callTool('workflow_status', { runId });
    expect(afterRestart.status).toBe('completed');
  }, 45000);
});
