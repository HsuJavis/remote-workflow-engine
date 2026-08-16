// VAL-094 (REQ-085, DES-090, DES-091): optional scriptSha256 integrity guard acceptance test.
// Binds the REQ-085 acceptance clauses against the REAL engine entrypoint.
//
// REQ-085 acceptance clauses:
//   1. workflow_run with a matching scriptSha256 → run proceeds normally (no error)
//   2. workflow_run with a mismatched scriptSha256 → SCRIPT_SHA_MISMATCH, no run created
//   3. workflow_run without scriptSha256 → runs exactly as before (backward compat / additive)
//   4. Named run (no inline script) + scriptSha256 → SCRIPT_SHA_WITHOUT_SCRIPT (clear reject)
//
// Red reason: RunManager.start() has no scriptSha256/assertScriptIntegrity handling →
//   cases 2 and 4 return a runId (no error thrown) instead of SCRIPT_SHA_MISMATCH /
//   SCRIPT_SHA_WITHOUT_SCRIPT → assertions fail for the correct unimplemented reason.
//   Cases 1 and 3 would trivially pass, but the failing cases make the test file net-RED.
//
// Mock policy (acceptance — MUST NOT mock SUT boundaries): real createServer, real HTTP;
//   real RunManager ladder (scriptSha256 check fires before any sandbox/gateway code).
// Note: real:false — set to true by Gate 7.5 validator.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

let server: Server;
let workRoot: string;

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

async function poll(runId: string, ms = 200, maxIter = 60): Promise<any> {
  for (let i = 0; i < maxIter; i++) {
    const st = await mcpCall('workflow_status', { runId });
    if (['completed', 'failed', 'stopped'].includes(st.status)) return st;
    await new Promise((r) => setTimeout(r, ms));
  }
  throw new Error('run did not settle');
}

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-val094-'));
  server = await createServer({ workRoot });
});
afterAll(async () => {
  await server?.close?.();
  rmSync(workRoot, { recursive: true, force: true });
});

const SCRIPT = 'return { ok: true };';

describe('REQ-085: scriptSha256 integrity guard (VAL-094)', () => {
  it('1. matching scriptSha256 → run proceeds normally (no SCRIPT_SHA_MISMATCH)', async () => {
    const r = await mcpCall('workflow_run', {
      script: SCRIPT,
      scriptSha256: sha256(SCRIPT),
    });
    // Should return a runId, not an error
    expect(r.error).toBeUndefined();
    expect(r.runId).toBeDefined();
    const status = await poll(r.runId);
    expect(status.status).toBe('completed');
  });

  it('2. mismatched scriptSha256 → SCRIPT_SHA_MISMATCH, no run created', async () => {
    const alteredScript = SCRIPT + ' /* altered */';
    const r = await mcpCall('workflow_run', {
      script: SCRIPT, // original script
      scriptSha256: sha256(alteredScript), // sha of DIFFERENT script
    });
    // Must return the typed error, not a runId
    expect(r.error?.code).toBe('SCRIPT_SHA_MISMATCH');
    // No runId should be present (no run created before the check fires)
    expect(r.runId).toBeFalsy();
  });

  it('3. no scriptSha256 → runs exactly as before (backward compat, additive)', async () => {
    const r = await mcpCall('workflow_run', {
      script: SCRIPT,
      // No scriptSha256 — existing behavior unchanged
    });
    expect(r.error).toBeUndefined();
    expect(r.runId).toBeDefined();
    const status = await poll(r.runId);
    expect(status.status).toBe('completed');
  });

  it('4. named run (no inline script) + scriptSha256 → SCRIPT_SHA_WITHOUT_SCRIPT', async () => {
    // Register a workflow first (so the name exists)
    await mcpCall('workflow_register', {
      name: 'val094-test-workflow',
      script: SCRIPT,
    });

    const r = await mcpCall('workflow_run', {
      name: 'val094-test-workflow',
      // no inline `script` — but scriptSha256 is supplied anyway
      scriptSha256: sha256(SCRIPT),
    });
    // Named run + scriptSha256 → SCRIPT_SHA_WITHOUT_SCRIPT (clear reject)
    expect(r.error?.code).toBe('SCRIPT_SHA_WITHOUT_SCRIPT');
    expect(r.runId).toBeFalsy();
  });

  it('2b. SCRIPT_SHA_MISMATCH fires before admission: status is failed or error returned sync', async () => {
    // A SCRIPT_SHA_MISMATCH error must return synchronously (status: failed on the result,
    // not a started run that later transitions to failed) — it fires before createRun.
    const r = await mcpCall('workflow_run', {
      script: 'return 1;',
      scriptSha256: sha256('return 2;'), // mismatch
    });
    // The error is synchronous (no runId, or runId is empty string per DES-001)
    expect(r.error?.code).toBe('SCRIPT_SHA_MISMATCH');
    const runId: string = r.runId ?? '';
    // No workflow_status needed — the check fires before any run row exists
    if (runId) {
      // If a runId was somehow returned (it shouldn't be), the status would be 'failed'
      const st = await mcpCall('workflow_status', { runId });
      expect(st.error?.code).toBe('RUN_NOT_FOUND');
    }
  });
});
