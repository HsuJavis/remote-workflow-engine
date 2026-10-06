// issue #160 BUG-2 (owner-approved 2026-10-07): `run_list` must REFUSE invalid inputs with
// INVALID_ARGUMENT instead of silently degrading — `limit:-1` (used to return every row, bypassing
// the 500-row cap), a non-integer `limit` (used to leak better-sqlite3's raw, uncoded 'datatype
// mismatch' string with no envelope/code), and a `status` value outside the documented enum (used to
// silently answer `[]`, indistinguishable from "no runs in that real state"). `limit:0` stays `[]`
// (pre-existing, owner-acknowledged — issue #160's own DOC section) and must NOT be refused.
//
// Mock policy (integration, DES-119): a real `createServer()`, real MCP HTTP — the point of this
// file is the actual wire behaviour (ajv schema + call-tool's error envelope), not a unit double.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it160-runlist-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

describe('run_list refuses invalid limit/status instead of silently degrading (issue #160 BUG-2)', () => {
  it('limit:-1 is refused INVALID_ARGUMENT, never the full unbounded table', async () => {
    const result = await call('run_list', { limit: -1 });
    expect(result.code ?? result.error?.code).toBe('INVALID_ARGUMENT');
    expect(String(result.error?.message ?? '')).toMatch(/limit/);
  });

  it('a non-integer limit (1.5) is refused INVALID_ARGUMENT, never the raw SQLite "datatype mismatch"', async () => {
    const result = await call('run_list', { limit: 1.5 });
    expect(result.code ?? result.error?.code).toBe('INVALID_ARGUMENT');
    const message = String(result.error?.message ?? '');
    expect(message).toMatch(/limit/);
    expect(message).not.toMatch(/datatype mismatch/i);
  });

  it("limit:0 is NOT refused — it is the documented, owner-acknowledged 'no rows' value", async () => {
    const result = await call('run_list', { limit: 0 });
    expect(result.error).toBeUndefined();
    expect(result.result).toEqual([]);
  });

  it("status:'bogus' (outside the documented enum) is refused INVALID_ARGUMENT, never a silent []", async () => {
    const result = await call('run_list', { status: 'bogus' });
    expect(result.code ?? result.error?.code).toBe('INVALID_ARGUMENT');
    expect(String(result.error?.message ?? '')).toMatch(/status/);
  });

  it('every documented status value is accepted (schema enum matches RunStatus)', async () => {
    for (const status of ['queued', 'running', 'suspended', 'stopped', 'completed', 'failed', 'interrupted']) {
      const result = await call('run_list', { status });
      expect(result.error, `status:'${status}' was refused: ${JSON.stringify(result.error)}`).toBeUndefined();
      expect(Array.isArray(result.result)).toBe(true);
    }
  });
});
