// VAL-116 (REQ-105, DES-132/133, ARCH-083, ADR-022): the grep guard (UT-115) + the tool-schema
// assertion are the mechanical proof; the real-tier half is `GET /api/workflows/:name/skeleton`
// returning 404 on a booted engine, while `GET /api/runs/:id/dag` still serves its layout behind the
// auth gate (unchanged, v22 finding H2).
//
// Mock policy (acceptance, DES-119): real `createServer`, real HTTP. No LLM needed.
//
// Red reason: `GET /api/workflows/:name/skeleton` is a live route today (`server.ts:1074-1088`,
// confirmed by direct read) -> it returns 200 with a real skeleton body, not 404.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

let server: Server;
let workRoot: string;

async function call(name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-val116-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot });
  await registerPublishedVia(call, 'val116-flow', `return 1;`);
});
afterAll(async () => { await server?.close(); rmSync(workRoot, { recursive: true, force: true }); });

describe('REQ-105: the skeleton route is gone; the run DAG stays (VAL-116)', () => {
  it('GET /api/workflows/:name/skeleton returns 404 — the surface no longer exists', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/workflows/val116-flow/skeleton`);
    expect(res.status).toBe(404);
  });

  it('GET /api/workflows/:name/describe exists (its replacement)', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/workflows/val116-flow/describe`);
    expect(res.status).toBe(200);
  });
});
