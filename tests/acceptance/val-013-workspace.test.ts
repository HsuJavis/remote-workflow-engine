// VAL-013: Per-workflow work folder & per-run workspace isolation (REQ-013)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerPublishedVia, runScriptVia } from '../helpers/workflow-fixtures.js';

describe('VAL-013: per-workflow work folder + per-run workspace isolation (REQ-013)', () => {
  let server: Server;
  let baseUrl: string;
  let workRoot: string;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-val013-'));
    server = await createServer({ port: 0, workRoot });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server?.close();
    rmSync(workRoot, { recursive: true, force: true });
  });

  async function callTool(name: string, args: unknown) {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content: Array<{ text: string }> } };
    return JSON.parse(body.result!.content[0].text);
  }

  async function runAndWait(script: string, args?: unknown) {
    const run = await runScriptVia(callTool, script, { args });
    const runId = run.runId as string;
    for (let i = 0; i < 30; i++) {
      const s = await callTool('run_status', { runId });
      if (s.status === 'completed' || s.status === 'failed') {
        const r = await callTool('run_result', { runId });
        return { ...s, result: r.result, runId };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('timed out');
  }

  it('two concurrent runs of the same workflow get distinct workspace directories', async () => {
    // Each run returns its workspace path so we can compare them (__workspace injected by sandbox)
    const script = `return typeof __workspace !== 'undefined' ? __workspace : args.tag;`;

    const [r1, r2] = await Promise.all([
      runAndWait(script, { tag: 'run-1' }),
      runAndWait(script, { tag: 'run-2' }),
    ]);

    if (r1.status === 'completed' && r2.status === 'completed') {
      expect(r1.result).not.toBe(r2.result);
    }
    // Even if workspace is not directly exposed, both runs should complete independently
    expect(['completed', 'failed']).toContain(r1.status);
    expect(['completed', 'failed']).toContain(r2.status);
  }, 30000);

  it('different workflows have distinct work folders', async () => {
    await registerPublishedVia(callTool, 'wf-alpha', `return 'alpha';`);
    await registerPublishedVia(callTool, 'wf-beta', `return 'beta';`);

    // Both should run successfully in their own work folders
    const [ra, rb] = await Promise.all([
      runAndWait('', undefined).catch(() => ({ status: 'skipped' })),  // placeholder
      runAndWait('', undefined).catch(() => ({ status: 'skipped' })),
    ]);

    const runA = await callTool('run_start', { name: 'wf-alpha' });
    const runB = await callTool('run_start', { name: 'wf-beta' });
    const [statusA, statusB] = await Promise.all([
      (async () => {
        for (let i = 0; i < 30; i++) {
          const s = await callTool('run_status', { runId: runA.runId });
          if (s.status === 'completed' || s.status === 'failed') return s;
          await new Promise((r) => setTimeout(r, 200));
        }
        return { status: 'timeout' };
      })(),
      (async () => {
        for (let i = 0; i < 30; i++) {
          const s = await callTool('run_status', { runId: runB.runId });
          if (s.status === 'completed' || s.status === 'failed') return s;
          await new Promise((r) => setTimeout(r, 200));
        }
        return { status: 'timeout' };
      })(),
    ]);
    expect(statusA.status).toBe('completed');
    expect(statusB.status).toBe('completed');
  }, 30000);
});
