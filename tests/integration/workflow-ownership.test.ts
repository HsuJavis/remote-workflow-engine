// IT-080 (DES-098, ARCH-061, TASK-089): workflow ownership — owner column, mutation-only gate,
// idempotent boot backfill.
//
// Cases (DES-098 + boundary conditions):
//   1. First registration by alice → owned by alice
//   2. Register-overwrite by alice (same owner) → succeeds
//   3. Register-overwrite by bob (non-owner) → NOT_WORKFLOW_OWNER; stored definition unchanged
//   4. Deregister by bob (non-owner) → NOT_WORKFLOW_OWNER; workflow still present
//   5. Deregister by alice (owner) → succeeds
//   6. null principal (auth-disabled) → ungated mutation even on an owned row [D-AUTH-6]
//   7. workflow_get output includes owner field
//   8. workflow_run (by bob, non-owner) → NOT gated (runs succeed regardless of ownership)
//   9. Boot backfill: rows with NULL owner → backfilled to 'hsuhungjung@gmail.com' on next boot
//  10. Boot backfill is idempotent: second boot does not re-own already-owned rows
//
// Red reason: `workflow_register` + `workflow_deregister` do not yet accept a `principal`
//   parameter, and the `owner` column does not exist → NOT_WORKFLOW_OWNER never returned →
//   non-owner mutation succeeds when it should fail → assertions fail. Correct RED.
//
// Mock policy (integration): real server + real SQLite catalog (`:memory:` or on-disk tmpDir).
//   Principal passed as a JSON arg to the MCP tool (workflow_register gains `principal` field
//   per DES-098). No LLM/gateway needed (workflow_run uses script-only).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it080-'));
  server = await createServer({
    port: 0,
    bind: '0.0.0.0',
    workRoot: tmpDir,
    // Auth enabled so that boot backfill (DES-098) runs; bind=0.0.0.0 so that the loopback
    // test client gets D-BIND exemption (isLoopbackPeer && !isLoopback('0.0.0.0')) and bypasses
    // the bearer gate — letting us inject principal as a tool arg to test the catalog layer directly.
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it080-cid', googleClientSecret: 'it080-cs' },
  } as never);
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// D-BIND bypass: server binds to 0.0.0.0, test client connects from 127.0.0.1. The D-BIND
// formula (isLoopbackPeer && !isLoopback(bind)) evaluates to true, bypassing the auth bearer
// gate. callTool injects principal as a tool arg (the args.principal fallback in server.ts).
// This tests the CATALOG ownership layer directly without auth ceremony.
async function callTool(name: string, args: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const OWNER_WORKFLOW = 'owned-workflow-it080';
const SCRIPT = 'return "hello";';

describe('Workflow ownership gate (DES-098, IT-080)', () => {
  it('case 1: first registration by alice → owned by alice', async () => {
    const r = await callTool('workflow_register', {
      name: OWNER_WORKFLOW,
      script: SCRIPT,
      principal: ALICE,  // v15: new parameter
    });
    expect(r.error).toBeUndefined();
    expect(typeof r.version).toBe('number');
  });

  it('case 7: workflow_get includes owner field', async () => {
    const r = await callTool('workflow_get', { name: OWNER_WORKFLOW });
    expect(r.error).toBeUndefined();
    expect((r as { owner?: string }).owner).toBe(ALICE);
  });

  it('case 2: register-overwrite by alice (same owner) → succeeds', async () => {
    const r = await callTool('workflow_register', {
      name: OWNER_WORKFLOW,
      script: SCRIPT + ' // v2',
      principal: ALICE,
    });
    expect(r.error).toBeUndefined();
    expect(r.code).not.toBe('NOT_WORKFLOW_OWNER');
  });

  it('case 3: register-overwrite by bob (non-owner) → NOT_WORKFLOW_OWNER + stored unchanged', async () => {
    const r = await callTool('workflow_register', {
      name: OWNER_WORKFLOW,
      script: 'return "hijacked";',
      principal: BOB,
    });
    expect(r.code).toBe('NOT_WORKFLOW_OWNER');

    // Stored definition must be unchanged
    const current = await callTool('workflow_get', { name: OWNER_WORKFLOW });
    expect((current as { script?: string }).script).not.toContain('hijacked');
  });

  it('case 4: deregister by bob (non-owner) → NOT_WORKFLOW_OWNER; workflow still present', async () => {
    const r = await callTool('workflow_deregister', { name: OWNER_WORKFLOW, principal: BOB });
    expect(r.code).toBe('NOT_WORKFLOW_OWNER');

    const check = await callTool('workflow_get', { name: OWNER_WORKFLOW });
    expect(check.error).toBeUndefined();
    // workflow_get puts name inside result (flat top-level: owner/defaults/script only; DES-098)
    expect(typeof (check.result as { name?: string })?.name).toBe('string');
  });

  it('case 8: workflow_run by bob (non-owner) → NOT gated (read/run open to any)', async () => {
    const r = await callTool('workflow_run', { name: OWNER_WORKFLOW, principal: BOB });
    expect(r.code).not.toBe('NOT_WORKFLOW_OWNER');
    expect(typeof r.runId).toBe('string');
  });

  it('case 6: null principal → ungated mutation even on an owned row [D-AUTH-6]', async () => {
    // principal=null simulates auth-disabled path (no auth enforcement)
    const r = await callTool('workflow_register', {
      name: OWNER_WORKFLOW,
      script: SCRIPT + ' // null-principal-ok',
      principal: null,  // no principal → ungated
    });
    // Should NOT return NOT_WORKFLOW_OWNER (null bypasses the gate per D-AUTH-6)
    expect(r.code).not.toBe('NOT_WORKFLOW_OWNER');
    expect(r.error).toBeUndefined();
  });

  it('case 5: deregister by alice (owner) → succeeds', async () => {
    // Re-register as alice first (the null-principal write above may not have changed owner)
    await callTool('workflow_register', { name: OWNER_WORKFLOW, script: SCRIPT, principal: ALICE });
    const r = await callTool('workflow_deregister', { name: OWNER_WORKFLOW, principal: ALICE });
    expect(r.code).not.toBe('NOT_WORKFLOW_OWNER');
    expect((r as { removed?: boolean }).removed).toBe(true);
  });
});

// ── Boot backfill tests ────────────────────────────────────────────────────────

describe('Boot backfill: NULL owner → hsuhungjung@gmail.com (DES-098, IT-080)', () => {
  it('case 9: a pre-v15 row (NULL owner) is backfilled to the configured email on boot', async () => {
    // Register without principal (simulates a pre-v15 registration)
    const wf = 'pre-v15-workflow-it080';
    await callTool('workflow_register', { name: wf, script: SCRIPT /* no principal → NULL owner */ });

    // Simulate a new boot (create a new server instance with the same workRoot)
    // The boot backfill runs once at startup: UPDATE workflows SET owner='hsuhungjung@gmail.com' WHERE owner IS NULL
    const server2 = await createServer({
      port: 0,
      bind: '0.0.0.0',
      workRoot: tmpDir,
      auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it080-cid2', googleClientSecret: 'cs' },
    } as never);

    try {
      const callTool2 = async (name: string, args: Record<string, unknown>) => {
        const r = await fetch(`http://127.0.0.1:${server2.port}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
        });
        const body = await r.json() as { result?: { content?: Array<{ text?: string }> } };
        return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
      };

      const wfGet = await callTool2('workflow_get', { name: wf });
      expect((wfGet as { owner?: string }).owner).toBe('hsuhungjung@gmail.com');
    } finally {
      await server2.close();
    }
  });

  it('case 10: boot backfill is idempotent (already-owned rows not re-owned)', async () => {
    // Register with alice as owner
    const wf = 'alice-owned-it080';
    await callTool('workflow_register', { name: wf, script: SCRIPT, principal: ALICE });

    // Second boot
    const server3 = await createServer({
      port: 0,
      bind: '0.0.0.0',
      workRoot: tmpDir,
      auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it080-cid3', googleClientSecret: 'cs' },
    } as never);

    try {
      const callTool3 = async (name: string, args: Record<string, unknown>) => {
        const r = await fetch(`http://127.0.0.1:${server3.port}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
        });
        const body = await r.json() as { result?: { content?: Array<{ text?: string }> } };
        return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
      };

      const wfGet = await callTool3('workflow_get', { name: wf });
      // Already-owned row must NOT be re-owned to hsuhungjung@gmail.com
      expect((wfGet as { owner?: string }).owner).toBe(ALICE);
    } finally {
      await server3.close();
    }
  });
});
