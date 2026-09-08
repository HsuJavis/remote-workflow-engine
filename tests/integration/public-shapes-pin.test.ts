// IT-154 (DES-189, ARCH-110/115/118/117, TASK-194/195, v26): the public-shapes pin — after a
// scripted run, `run_status.agents[]` carries every v26 key (`EXPECTED_AGENT_RECORD_KEYS`), and the
// `PRICE_UNKNOWN` grep returns nothing (ADR-038's decision was a deletion item, never an
// implementation one — the code was never written). Written test-first (Gate 5, RED): today's
// `AgentRecord` carries `tokens: {input, output}` (two columns) and no `costUSD`/`unpriced`/
// `transport`/`proxyModel`/`phaseIndex` at all — the key-set comparison fails immediately.
// Mock policy (integration, real adjacent components): real createServer(), real MCP HTTP; a fake
// gateway stands in for the provider network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';
import { EXPECTED_AGENT_RECORD_KEYS } from '../fixtures/v26-public-shapes.js';

let server: Server;

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

beforeAll(async () => { server = await createServer({ port: 0, bind: '127.0.0.1' }); });
afterAll(async () => { await server?.close(); });

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src');
const TESTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = [join(dirname(SRC_DIR), 'DEPLOY.md'), join(dirname(SRC_DIR), 'README.md')];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts') || name.endsWith('.md')) out.push(p);
  }
  return out;
}

describe('the v26 public-shapes pin (IT-154, DES-189)', () => {
  it('PRICE_UNKNOWN never reached code — the grep returns nothing (a deletion item, never implemented)', () => {
    const SELF = fileURLToPath(import.meta.url);
    const files = [...walk(SRC_DIR), ...walk(TESTS_DIR), ...DOCS.filter((f) => { try { readFileSync(f); return true; } catch { return false; } })]
      .filter((f) => f !== SELF);
    const NEEDLE = 'PRICE' + '_UNKNOWN'; // split so this guard's own source never self-matches
    const offenders = files.filter((f) => readFileSync(f, 'utf-8').includes(NEEDLE));
    expect(offenders).toEqual([]);
  });

  it('run_status.agents[] carries every v26 key after a scripted run', async () => {
    await registerPublishedVia(mcpCall, 'it154-wf', `phase('collect'); await agent('a', { prompt: 'p' }); return 'done';`);
    const run = await mcpCall('run_start', { name: 'it154-wf' });
    let status: any;
    for (let i = 0; i < 60; i++) {
      status = await mcpCall('run_status', { runId: run.runId });
      if (['completed', 'failed'].includes(status.status)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const record = status.result?.agents?.[0];
    expect(record).toBeDefined();
    for (const key of EXPECTED_AGENT_RECORD_KEYS) {
      if (['label', 'reasonCode', 'detail', 'proxyModel', 'lastActivityAt'].includes(key)) continue; // optional fields
      expect(Object.hasOwn(record, key)).toBe(true);
    }
  }, 20000);
});
