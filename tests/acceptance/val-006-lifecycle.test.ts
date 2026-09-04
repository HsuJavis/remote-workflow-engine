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
      const s = await callTool('run_status', { runId });
      if (targets.includes(s.status)) return s;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Timed out waiting for status ${target}`);
  }

  // D-F3: replaces the previous fixed 100ms pre-suspend/pre-stop sleep. A blind fixed sleep is
  // NOT contention-tolerant in either direction — measured empirically (see 05-tests.md VAL-006
  // note): under this environment's fast local no-credential agent() rejection path, a single-
  // agent-call run reaches 'completed' only ~150-200ms after run_start, so simply raising the
  // fixed sleep (tried 300ms first) made the race deterministically LOSE (suspend always arrived
  // after completion) rather than tolerating contention. Actively polling for 'running' and firing
  // suspend/stop the instant it's observed adapts to however long host contention makes the child
  // actually take to start, without ever risking overshoot past completion — genuinely more
  // contention-tolerant, not just a bigger constant. Bounded so it still fails loudly, never hangs.
  async function waitUntilRunning(runId: string, maxMs = 10000) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const s = await callTool('run_status', { runId });
      if (s.status === 'running') return;
      if (s.status === 'completed' || s.status === 'failed') return; // let the caller's own poll surface the mismatch
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  it('suspend transitions run to suspended; resume brings it back to running', async () => {
    const run = await runScriptVia(callTool, `return agent('slow-query', {});`);
    const runId = run.runId as string;
    await waitUntilRunning(runId);
    await callTool('run_suspend', { runId });
    const suspended = await pollStatus(runId, 'suspended');
    expect(suspended.status).toBe('suspended');

    await callTool('run_resume', { runId });
    const resumed = await pollStatus(runId, ['running', 'completed', 'failed']);
    expect(['running', 'completed', 'failed']).toContain(resumed.status);
  }, 45000);

  // v22 adjudication #3 (M-3): this case used to continue into a `run_resume({runId, script})`
  // that asserted "an edited script re-runs from the first changed agent() call". That clause of
  // REQ-006 is RETIRED, not migrated: 01-requirements.md's `[SUPERSEDED v22, owner-confirmed
  // 2026-09-01]` block on REQ-006 withdraws the edited-script entry point (REQ-098 closes inline
  // script on resume; REQ-096 pins the version a run executed; decided in ADR-010). The sanctioned
  // replacement — register a new version, then run by version — is already covered by the
  // version-pin tests, so it is deliberately NOT re-covered here. What survives is REQ-006's own
  // still-live `run_stop` clause, kept intact below.
  it('stop terminates the run and its status becomes stopped', async () => {
    const run = await runScriptVia(callTool, `return agent('original', {});`);
    const runId = run.runId as string;

    await waitUntilRunning(runId);
    await callTool('run_stop', { runId });
    const stopped = await pollStatus(runId, 'stopped');
    expect(stopped.status).toBe('stopped');
  }, 45000);

  it('run_status returns state after server restart (journal + store survive restart)', async () => {
    const run = await runScriptVia(callTool, `return 1;`);
    const runId = run.runId as string;
    await pollStatus(runId, 'completed');

    const workRoot = (server as unknown as { workRoot: string }).workRoot;
    await server.close();

    // Restart with the same work root
    server = await createServer({ port: 0, workRoot });
    baseUrl = `http://127.0.0.1:${server.port}`;

    const afterRestart = await callTool('run_status', { runId });
    expect(afterRestart.status).toBe('completed');
  }, 45000);
});
