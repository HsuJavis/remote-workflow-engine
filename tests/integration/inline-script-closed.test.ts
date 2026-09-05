// IT-088 (ARCH-073, DES-114, DES-117, TASK-109): closure is schema-level AND runtime-level,
// asserted SEPARATELY (`/mcp` accepts arbitrary JSON, so schema removal alone is not a refusal) —
// a hand-rolled body carrying `script` is refused `INLINE_SCRIPT_CLOSED` with the two-call
// migration recipe (`workflow_register` then `run_start({name})`) in the message.
//
// Mock policy (integration): real server, real HTTP, real hand-rolled JSON-RPC body; no LLM (the
// refusal happens before any agent() dispatch).
//
// Red reason: `run_start`/`run_resume` accept `script` today (it is the primary inline-run
// path) — every assertion below fails against the current engine (a script actually runs instead
// of being refused).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it088-'));
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

describe('REQ-098: inline script is closed — runtime refusal even off the advertised schema (IT-088)', () => {
  it('a hand-rolled run_start({script}) body is refused INLINE_SCRIPT_CLOSED with the two-call migration recipe', async () => {
    const r = await toolCall('run_start', { script: `return 'sneaky-inline';` });
    const error = r['error'] as { code?: string; message?: string } | undefined;
    expect(error?.code).toBe('INLINE_SCRIPT_CLOSED');
    expect(error?.message).toMatch(/workflow_register/);
    expect(error?.message).toMatch(/run_start\(\{name\}\)/);
  });

  it('a hand-rolled run_resume({runId, script}) body is refused INLINE_SCRIPT_CLOSED', async () => {
    const r = await toolCall('run_resume', { runId: 'irrelevant-does-not-exist', script: `return 'replacement';` });
    const error = r['error'] as { code?: string } | undefined;
    expect(error?.code).toBe('INLINE_SCRIPT_CLOSED');
  });

  it('plain run_resume({runId}) with no script continues to work unchanged (not refused)', async () => {
    const r = await toolCall('run_resume', { runId: 'irrelevant-does-not-exist' });
    const error = r['error'] as { code?: string } | undefined;
    expect(error?.code).not.toBe('INLINE_SCRIPT_CLOSED'); // RUN_NOT_FOUND or similar is fine; not the inline ban
  });

  it('the sanctioned migration (register, publish to release, then run by name) is unaffected by the ban', async () => {
    // v24 (DES-148, REQ-111): registration REQUIRES a non-empty `mermaid` (MERMAID_REQUIRED). The
    // header alone is the whole diagram a zero-agent script needs. Written out here rather than
    // routed through tests/helpers/workflow-fixtures.ts on purpose: this case's whole point is that
    // the HAND-ROLLED sanctioned sequence still works, so it must stay hand-rolled.
    const reg = await toolCall('workflow_register', { name: 'it088-sanctioned', script: `return 'ok';`, mermaid: 'graph TD;' });
    expect(reg['error']).toBeUndefined();
    const version = (reg['result'] as { version?: string } | undefined)?.version ?? 'v1';
    const pub = await toolCall('workflow_publish', { name: 'it088-sanctioned', version, channel: 'release' });
    expect(pub['error']).toBeUndefined();
    const run = await toolCall('run_start', { name: 'it088-sanctioned' });
    expect(run['error']).toBeUndefined();
  });
});
