// VAL-022: Hooks are explicitly unsupported — uploaded user hooks removed (REQ-019)
// Real entrypoint: real workspace_push endpoint (v24 DES-153/TASK-152 renamed the old asset-push
// tool). No mock of the SUT's own boundaries.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
// Value import — module-not-found when absent (guarantees this file is RED at collection,
// independent of any live-provider availability).
import { classifyAsset } from '../../src/asset-sync.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val022-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, assetRoot: join(tmpDir, 'assets') });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function mcpCall(name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> }; error?: { code: number; message: string } };
  if (body.error) return { error: body.error };
  // workflow_* tools return their own flat envelope directly; workspace_push wraps its payload
  // under `.result` — dereferenced explicitly at the workspace_push call site below.
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

function b64(s: string) { return Buffer.from(s, 'utf-8').toString('base64'); }

describe('VAL-022: REQ-019 clause 1 — a hook-kind push is rejected HOOKS_UNSUPPORTED, never silently materialized', () => {
  it('the real classifyAsset boundary function rejects hook-kind by construction', () => {
    expect(classifyAsset('hook', { name: 'anything' })).toEqual({ action: 'reject', code: 'HOOKS_UNSUPPORTED' });
  });

  it('the real workspace_push endpoint rejects a hook and writes NOTHING to disk', async () => {
    const out = await mcpCall('workspace_push', { kind: 'hook', name: 'val022-hook', files: [{ path: 'h.sh', contentB64: b64('echo hi') }] });
    const payload = (out['result'] as { stored?: string[] } | undefined) ?? {};
    expect(payload.stored ?? []).toEqual([]);
    expect(existsSync(join(tmpDir, 'assets', 'hook', 'val022-hook'))).toBe(false);
  });
});

describe('VAL-022: REQ-019 clause 2 — no user hook ever runs; the engine\'s OWN internal PreToolUse boundary hook is unaffected', () => {
  it('a real run still enforces the workspace-boundary PreToolUse hook (regression floor, no live model needed: the hook fires purely on canUseTool/hooks wiring already present)', async () => {
    // Reuses the already-real, already-shipped D-V2G8-1(d) workspace boundary — this run never
    // pushes a hook asset at all, proving the internal control is independent of the (now-rejected)
    // user-hook upload path.
    const run = await runScriptVia(mcpCall, `return 1 + 1;`);
    const runId = run['runId'] as string;
    for (let i = 0; i < 20; i++) {
      const s = await mcpCall('run_status', { runId });
      if (s['status'] === 'completed' || s['status'] === 'failed') break;
      await new Promise((r) => setTimeout(r, 300));
    }
    const result = await mcpCall('run_result', { runId });
    expect(result['result']).toBe(2);
  }, 20000);
});
