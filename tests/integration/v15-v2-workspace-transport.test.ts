// IT (REQ-022..026, v1.5+v2): the new workspace-transport tools over the real MCP HTTP surface —
// seed a tree, recursively list it (+sha256, .claude stripped), byte-fetch a windowed chunk
// (escape denied), purge, and the readBody body-size cap (413). No LLM: the workflow script returns
// without calling agent().
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import { FixedClock } from '../../src/clock.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

let server: Server;
let base: string;
let workRoot: string;
beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-it-v15-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tool(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
  return JSON.parse(body.result!.content[0]!.text);
}
async function pollDone(runId: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const s = await tool('run_status', { runId });
    if (s.status === 'completed' || s.status === 'failed') return;
    await new Promise((r) => setTimeout(r, 100));
  }
}
const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('v1.5+v2 workspace transport (REQ-022..026)', () => {
  it('seed → recursive artifacts (+sha256, .claude stripped) → windowed artifact_get (escape denied) → purge', async () => {
    const content = 'hello from seed\n';
    const run = await runScriptVia(tool, "return 'ok';", {
      seed: [
        { path: 'seeded.txt', contentB64: b64(content) },
        { path: 'src/app.py', contentB64: b64('print(1)\n') },
        { path: '.claude/settings.json', contentB64: b64('{"hooks":{}}') }, // must be stripped
        { path: '.claude/hooks/pre.sh', contentB64: b64('evil') }, // must be stripped
      ],
    });
    const runId = run.runId as string;
    await pollDone(runId);

    // REQ-023: recursive + sha256, .claude/settings|hooks stripped
    const arts = (await tool('workspace_list', { runId })).result as Array<{ path: string; size: number; sha256: string }>;
    const paths = arts.map((a) => a.path);
    expect(paths).toEqual(['seeded.txt', 'src/app.py']); // sorted, recursive, NO .claude/*
    const seeded = arts.find((a) => a.path === 'seeded.txt')!;
    expect(seeded.size).toBe(content.length);
    expect(seeded.sha256).toBe(createHash('sha256').update(content).digest('hex'));

    // REQ-022: windowed byte fetch
    const chunk = await tool('workspace_pull', { runId, path: 'seeded.txt', offset: 6, length: 4 });
    expect(Buffer.from(chunk.result.base64, 'base64').toString()).toBe('from');
    expect(chunk.result.eof).toBe(false);
    // REQ-022: realpath escape denied. v24 (errors.ts ERROR_CATALOG): the code for this exact
    // verdict is spelled `WORKSPACE_ESCAPE` — `workspace_pull`'s own advertised `errors[]` lists it
    // and `PULL_REASON_TO_CODE` (mcp-facade.ts:120) maps the internal `PATH_OUTSIDE_WORKSPACE`
    // reason onto it. Rename only; same oracle (an escaping path is refused, not read).
    const esc = await tool('workspace_pull', { runId, path: '../../../../etc/hostname' });
    expect(esc.error.code).toBe('WORKSPACE_ESCAPE');

    // REQ-026: purge
    const purge = await tool('workspace_purge', { runId });
    expect(purge.result.purged).toBe(true);
    expect((await tool('workspace_list', { runId })).result).toEqual([]);

    // v21 Gate 5 addendum (B-4, DES-104, REQ-091): effectiveParams rides the run row, so
    // workspace_purge (filesystem-only, mcp-facade.ts's workspace_purge) preserves it exactly as
    // it preserves the transcript/journal — no new retention policy, one assertion.
    const readStore = new SqliteRunStore(join(workRoot, 'store'), new FixedClock(new Date('2026-01-01T00:00:00.000Z')));
    const paramsAfterPurge = await readStore.getEffectiveParams(runId);
    expect(paramsAfterPurge).not.toBeNull();
  });

  it('REQ-024: an over-cap request body is rejected with 413, not buffered/OOMed', async () => {
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workflow_list', arguments: { x: 'A'.repeat(9 * 1024 * 1024) } } });
    const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big });
    expect(res.status).toBe(413);
  });
});
