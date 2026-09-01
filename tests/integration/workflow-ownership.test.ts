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

// v22 sweep note (adjudication #2, L-4): the register/deregister/publish half of this file was
// migrated WITH each case's own principal threaded (`workflow_publish` is ownership-gated, so a null
// principal there would turn the NOT_WORKFLOW_OWNER oracles into silent passes).
//
// v22 adjudication #3 (M-5) — the read half, settled: this server runs auth ENABLED with the D-BIND
// loopback exemption, so `ctx.principal` is null on every read and ADR-012 explicitly bars the
// `args.principal` unmask path. Every `workflow_get` here therefore returns the MASKED public view
// (DES-115: the allowlist projection IS the whole response, under `result`; REQ-100 withholds
// `script` entirely, replacing it with `scriptWithheld:true`).
//   - cases 7, 9, 10 only ever needed `owner`, which REQ-100 keeps in the public view: the read path
//     moves from the (now gone) flat `r.owner` to `r.result.owner`. Same oracle, correct path.
//   - case 3's oracle ("the stored definition is unchanged") is unreachable through ANY masked read
//     path — `script` is absent by design, so an assertion phrased over the response could only ever
//     degrade into "something came back". It is asserted at the STORE instead (catalog.db directly),
//     which is where "unchanged" actually means something.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

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
    // v22: registration is not publication. Published BY ALICE — `workflow_publish` is itself
    // ownership-gated, so the principal that registered has to be the one that publishes; a null
    // principal here would skip the gate and quietly hollow out the NOT_WORKFLOW_OWNER oracles below.
    const pub = await callTool('workflow_publish', { name: OWNER_WORKFLOW, version: `v${r.version}`, channel: 'release', principal: ALICE });
    expect(pub.code).not.toBe('NOT_WORKFLOW_OWNER');
  });

  it('case 7: workflow_get includes owner field', async () => {
    const r = await callTool('workflow_get', { name: OWNER_WORKFLOW });
    expect(r.error).toBeUndefined();
    // v22 (DES-115): the projection under `result` IS the response; `owner` stays on the public
    // allowlist (REQ-100 names it), only its path changed.
    expect((r.result as { owner?: string })?.owner).toBe(ALICE);
  });

  it('case 2: register-overwrite by alice (same owner) → succeeds', async () => {
    const r = await callTool('workflow_register', {
      name: OWNER_WORKFLOW,
      script: SCRIPT + ' // v2',
      principal: ALICE,
    });
    expect(r.error).toBeUndefined();
    expect(r.code).not.toBe('NOT_WORKFLOW_OWNER');
    // Alice's own new version onto `release`, so the reads below see her latest — the pre-v22
    // "newest registration wins" semantics case 3's "stored definition unchanged" oracle assumes.
    await callTool('workflow_publish', { name: OWNER_WORKFLOW, version: `v${r.version}`, channel: 'release', principal: ALICE });
  });

  it('case 3: register-overwrite by bob (non-owner) → NOT_WORKFLOW_OWNER + stored unchanged', async () => {
    const r = await callTool('workflow_register', {
      name: OWNER_WORKFLOW,
      script: 'return "hijacked";',
      principal: BOB,
    });
    expect(r.code).toBe('NOT_WORKFLOW_OWNER');

    // Stored definition must be unchanged — asserted at the STORE (see the M-5 note in the header):
    // the masked read withholds `script` by design, so the catalog's own rows are the only place
    // "unchanged" is observable. Bob's script must be in NO version row, and the version `release`
    // points at must still be exactly the one alice published in case 2.
    const db = new Database(join(tmpDir, 'catalog.db'));
    try {
      const rows = db.prepare('SELECT version, script FROM workflow_versions WHERE name = ?')
        .all(OWNER_WORKFLOW) as Array<{ version: string; script: string }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.script).not.toContain('hijacked');

      const head = db.prepare('SELECT release_version FROM workflows WHERE name = ?')
        .get(OWNER_WORKFLOW) as { release_version: string | null };
      const published = rows.find((row) => row.version === head.release_version);
      expect(published?.script).toBe(SCRIPT + ' // v2'); // alice's case-2 version, untouched
    } finally {
      db.close();
    }
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
    await registerPublishedVia(callTool, wf, SCRIPT /* no principal → NULL owner */);

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
      // v22 (DES-115, M-5): masked read — `owner` moved under `result`.
      expect((wfGet.result as { owner?: string })?.owner).toBe('hsuhungjung@gmail.com');
    } finally {
      await server2.close();
    }
  });

  it('case 10: boot backfill is idempotent (already-owned rows not re-owned)', async () => {
    // Register with alice as owner
    const wf = 'alice-owned-it080';
    await registerPublishedVia(callTool, wf, SCRIPT, { principal: ALICE });

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
      // v22 (DES-115, M-5): masked read — `owner` moved under `result`.
      expect((wfGet.result as { owner?: string })?.owner).toBe(ALICE);
    } finally {
      await server3.close();
    }
  });
});
