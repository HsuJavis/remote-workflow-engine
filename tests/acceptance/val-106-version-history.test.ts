// VAL-106 (REQ-096): the catalog keeps version history; a run pins the exact version it executed.
// Real entrypoint: `createServer` (the same composition root `npm start`/`node src/main.js` calls),
// real MCP HTTP, real on-disk catalog.db/runs.db under the configured workRoot.
//
// Mock policy (acceptance, DES-119): must not mock the SUT's own boundaries — real HTTP, real DB
// files. No LLM dispatch needed (registration/version-pin checks only, marker scripts with no
// agent() call).
//
// Red reason: the catalog has no version-history concept today (register overwrites in place) —
// every assertion below fails against the current engine.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

/** DES-109's binding fixture rule: hand-written legacy SQL, never produced by the new catalog. */
function buildLegacyCatalog(dbPath: string, name: string, script: string, version: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE workflows (name TEXT PRIMARY KEY, script TEXT NOT NULL, version TEXT NOT NULL, createdAt TEXT NOT NULL);
    ALTER TABLE workflows ADD COLUMN owner TEXT;
    ALTER TABLE workflows ADD COLUMN defaults TEXT;
    ALTER TABLE workflows ADD COLUMN params TEXT;
  `);
  db.prepare('INSERT INTO workflows (name, script, version, createdAt) VALUES (?, ?, ?, ?)').run(name, script, version, '2025-01-01T00:00:00.000Z');
  db.close();
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val106-'));
  buildLegacyCatalog(join(tmpDir, 'catalog.db'), 'val106-legacy', `return 'legacy-still-runs';`, 'v1');
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

async function toolCall(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}
async function pollUntilSettled(runId: string) {
  let s = await toolCall('workflow_status', { runId });
  for (let i = 0; i < 100 && (s['status'] === 'running' || s['status'] === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 30));
    s = await toolCall('workflow_status', { runId });
  }
  return s;
}

describe('REQ-096: a pre-v22 catalog boots non-breaking, old registrations still run (VAL-106)', () => {
  it('the migrated legacy workflow still runs by name via the (now-published) release channel', async () => {
    const run = await toolCall('workflow_run', { name: 'val106-legacy' });
    expect(run['error']).toBeUndefined();
    const runId = (run['result'] as { runId?: string } | undefined)?.runId as string;
    const settled = await pollUntilSettled(runId);
    expect(settled['status']).toBe('completed');
  });
});

describe('REQ-096: registering twice keeps BOTH versions retrievable (VAL-106)', () => {
  it('workflow_get({name, version:"v1"}) returns the first script after a second registration', async () => {
    const first = await toolCall('workflow_register', { name: 'val106-two', script: `return 'first';` });
    const v1 = (first['result'] as { version?: string } | undefined)?.version;
    await toolCall('workflow_register', { name: 'val106-two', script: `return 'second';` });

    const got = await toolCall('workflow_get', { name: 'val106-two', version: v1 });
    expect((got['result'] as { script?: string } | undefined)?.script).toBe(`return 'first';`);
  });

  it('a run pins its version; workflow_status still reports it after a THIRD version is registered', async () => {
    const first = await toolCall('workflow_register', { name: 'val106-pin', script: `return 'pinned';` });
    const v1 = (first['result'] as { version?: string } | undefined)?.version as string;
    await toolCall('workflow_publish', { name: 'val106-pin', version: v1, channel: 'release' });

    const run = await toolCall('workflow_run', { name: 'val106-pin' });
    const runId = (run['result'] as { runId?: string } | undefined)?.runId as string;
    await pollUntilSettled(runId);

    await toolCall('workflow_register', { name: 'val106-pin', script: `return 'newer';` });
    const status = await toolCall('workflow_status', { runId });
    expect((status['result'] as { scriptVersion?: string } | undefined)?.scriptVersion).toBe(v1);
  });

  it('workflow_list reports versions[] and channels{} per workflow', async () => {
    await toolCall('workflow_register', { name: 'val106-listed', script: `return 1;` });
    const list = await toolCall('workflow_list', {});
    const entry = (list['result'] as Array<Record<string, unknown>> | undefined)?.find((e) => e['name'] === 'val106-listed');
    expect(Array.isArray(entry?.['versions'])).toBe(true);
    expect(entry?.['channels']).toBeDefined();
  });
});
