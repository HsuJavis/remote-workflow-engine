// IT-141 (DES-170, ARCH-110, TASK-175, v26, issue #64): `run_start({seed:[{path,sha256}]})` over
// the REAL facade (real MCP HTTP, real RunManager) is refused INVALID_SEED_SPEC naming the path and
// pointing at the guide — and, crucially, the run workspace directory is never created at all (a
// filesystem oracle, never a spy on mkdirSync — DES-170's own boundary note). Written test-first
// (Gate 5, RED): today `spec.seed !== undefined && !Array.isArray(spec.seed)` is the only seed-array
// check in RunManager.start() (run-manager.ts:359) — a well-formed array of `{path,sha256}` elements
// passes it and `materializeSeed` writes 0-byte files (`contentB64 ?? ''`).
// Mock policy (integration): real createServer(), real MCP HTTP, real RunManager/RunStore/catalog —
// no mock of the SUT boundary.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { runScriptVia, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';

let server: Server;
let workRoot: string;

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-it141-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot });
});

afterAll(async () => {
  await server?.close();
  rmSync(workRoot, { recursive: true, force: true });
});

describe('run_start refuses a sha256-only seed element (IT-141, DES-170, issue #64)', () => {
  it('refuses INVALID_SEED_SPEC naming the offending path, pointing at the guide, and NEVER writes a workspace', async () => {
    const name = uniqueWorkflowName('it141');
    const res = await runScriptVia(mcpCall, `agent('a', { prompt: 'p' });`, { name, seed: [{ path: 'a.txt', sha256: '0'.repeat(64) }] });
    const err = (res as any).error ?? res;
    expect(err.code).toBe('INVALID_SEED_SPEC');
    expect(JSON.stringify(err)).toContain('a.txt');
    expect(err.see).toBe('workflow_authoring_guide');

    // The workspace for this name must never have been created — validate-all-then-write means
    // nothing is materialized until every seed element passes.
    const workflowDir = join(workRoot, 'workflows', name, 'runs');
    expect(() => readdirSync(workflowDir)).toThrow(/ENOENT/);
  });

  it('a legitimate {path, contentB64} seed still behaves as in v25 (no refusal)', async () => {
    const name = uniqueWorkflowName('it141-ok');
    const res = await runScriptVia(mcpCall, `agent('a', { prompt: 'p' });`, { name, seed: [{ path: 'a.txt', contentB64: 'aGVsbG8=' }] });
    expect((res as any).error).toBeUndefined();
  });
});
