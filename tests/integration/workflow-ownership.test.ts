// IT-080 (DES-098, ARCH-061, TASK-089): workflow ownership — owner column, mutation-only gate,
// idempotent boot backfill.
//
// Cases (DES-098 + boundary conditions):
//   1. First registration by alice → owned by alice
//   2. Register-overwrite by alice (same owner) → succeeds
//   3. Register-overwrite by bob (non-owner) → NOT_WORKFLOW_OWNER; stored definition unchanged
//   4. Deregister by bob (non-owner) → NOT_WORKFLOW_OWNER; workflow still present
//   5. Deregister by alice (owner) → succeeds
//   6. null principal on a genuinely AUTH-DISABLED server → ungated mutation [D-AUTH-6]
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
//
// v22 H1 send-back amendment (07-review.md §4.2, see `catalog-write-auth-dbind.test.ts`/IT-091):
// `workflow_publish` now refuses an anonymous caller under `authEnabled` — and on THIS file's
// D-BIND-exempt server (bind `0.0.0.0`, loopback test client) a bearer can never be validated at
// all (server.ts's gated `/mcp` block is skipped whole for a D-BIND-exempt connection, so there is
// no code path that would even read an `Authorization` header here). Every case below that used to
// route a publish through `workflow_publish({..., principal: ALICE})` over this connection now
// HAND-SEEDS the `release_version` pointer directly in catalog.db instead (`publishPointer()`) —
// that was always pure fixture setup, never the assertion under test in this file. `workflow_get`'s
// masked view was already reading `owner`/`removed`/etc. off the STORE-visible projection, not off
// `workflow_publish`'s response, so this changes zero assertions, only how the fixture reaches its
// starting state.
// `workflow_register`/`workflow_deregister` KEEP the `args.principal` self-assertion fallback this
// round (H1's fix note: "ideally register/deregister's" — a recommendation, not required for this
// send-back's blocking scope) — cases 1–5/8 are otherwise UNCHANGED. This is accepted, RECORDED
// debt, not a feature: a D-BIND-exempt caller can still self-assert any principal string to
// register a new version or deregister an owned name (case 5 already exercises exactly this path
// for the legitimate owner; nothing here newly celebrates it as safe). See `06-impl-log.md`'s
// send-back entry / `journal.md` for the full disposition.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
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
// gate. callTool injects principal as a tool arg (the args.principal fallback in server.ts,
// RETAINED for register/deregister post-H1 — see header note). This tests the CATALOG ownership
// layer directly without auth ceremony.
async function callToolOn(srv: Server, name: string, args: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${srv.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}
async function callTool(name: string, args: Record<string, unknown>) {
  return callToolOn(server, name, args);
}

/** Post-H1 fixture helper: moves the `release` pointer directly in catalog.db. Setup only — see
 *  the header's H1 amendment note. Mirrors IT-089's NULL-owner direct-seed pattern. */
function publishPointer(dbPath: string, name: string, version: string): void {
  const db = new Database(dbPath);
  db.prepare('UPDATE workflows SET release_version = ? WHERE name = ?').run(version, name);
  db.close();
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
    // v22: registration is not publication. Hand-seeded onto `release` (H1 amendment, see header):
    // `workflow_publish` can no longer be reached anonymously on this D-BIND-exempt connection.
    publishPointer(join(tmpDir, 'catalog.db'), OWNER_WORKFLOW, `v${r.version}`);
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
    // Alice's own new version onto `release` (hand-seeded, H1 amendment — see header), so the
    // reads below see her latest — the pre-v22 "newest registration wins" semantics case 3's
    // "stored definition unchanged" oracle assumes.
    publishPointer(join(tmpDir, 'catalog.db'), OWNER_WORKFLOW, `v${r.version}`);
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

  it('case 5: deregister by alice (owner) → succeeds', async () => {
    // Re-register as alice first (a prior write above may not have changed owner)
    await callTool('workflow_register', { name: OWNER_WORKFLOW, script: SCRIPT, principal: ALICE });
    const r = await callTool('workflow_deregister', { name: OWNER_WORKFLOW, principal: ALICE });
    expect(r.code).not.toBe('NOT_WORKFLOW_OWNER');
    expect((r as { removed?: boolean }).removed).toBe(true);
  });
});

// v22 H1 send-back (07-review.md §4.2): case 6's original claim — "null principal → ungated
// mutation even on an owned row" — was TRUE on the auth-ENABLED D-BIND server this file otherwise
// uses, and that was exactly H1's vulnerability (an anonymous D-BIND-exempt caller mutating an
// owned catalog row). Post-fix, `authEnabled && effectivePrincipal === null` is refused BEFORE the
// ownership comparison even runs, so that connection now returns `PRINCIPAL_REQUIRED` for this
// exact call (see `catalog-write-auth-dbind.test.ts`, IT-091). The GENUINE D-AUTH-6 floor — auth
// truly OFF ⇒ every mutation is ungated, `null` included — still holds and is re-sited here onto
// its own auth-DISABLED server, which is the only place `authEnabled` is actually false.
describe('case 6: null principal on a genuinely AUTH-DISABLED server → ungated mutation [D-AUTH-6, re-sited post-H1]', () => {
  let openServer: Server;
  let openTmpDir: string;

  beforeAll(async () => {
    openTmpDir = mkdtempSync(join(tmpdir(), 'rwe-it080-open-'));
    openServer = await createServer({ port: 0, bind: '0.0.0.0', workRoot: openTmpDir }); // auth disabled
  });
  afterAll(async () => {
    await openServer?.close();
    rmSync(openTmpDir, { recursive: true, force: true });
  });

  it('case 6: null principal → ungated mutation even on an owned row [D-AUTH-6]', async () => {
    const name = 'it080-case6-open';
    const owned = await callToolOn(openServer, 'workflow_register', { name, script: SCRIPT, principal: ALICE });
    expect(owned.error).toBeUndefined();

    const r = await callToolOn(openServer, 'workflow_register', {
      name,
      script: SCRIPT + ' // null-principal-ok',
      principal: null,  // no principal → ungated (auth genuinely off)
    });
    // Should NOT return NOT_WORKFLOW_OWNER, and should NOT be refused PRINCIPAL_REQUIRED either
    // (that code only ever fires when authEnabled is true — it is false on this server).
    expect(r.code).not.toBe('NOT_WORKFLOW_OWNER');
    expect(r.code).not.toBe('PRINCIPAL_REQUIRED');
    expect(r.error).toBeUndefined();
  });
});

// ── Boot backfill tests ────────────────────────────────────────────────────────

describe('Boot backfill: NULL owner → hsuhungjung@gmail.com (DES-098, IT-080)', () => {
  it('case 9: a pre-v15 row (NULL owner) is backfilled to the configured email on boot', async () => {
    const wf = 'pre-v15-workflow-it080';
    // v22 H1 amendment (see header): a NULL-owner PUBLISHED row can no longer be produced by an
    // anonymous workflow_register+workflow_publish pair over this connection (IT-091 proves
    // exactly that pair is now refused) — hand-seed the v22 schema directly instead, the SAME
    // pattern `workflow-masking-http.test.ts`'s NULL-owner case (IT-089) already established.
    const dbPath = join(tmpDir, 'catalog.db');
    const seedDb = new Database(dbPath);
    const now = new Date().toISOString();
    seedDb.prepare('INSERT INTO workflows (name, createdAt, owner, release_version) VALUES (?, ?, NULL, ?)').run(wf, now, 'v1');
    seedDb.prepare('INSERT INTO workflow_versions (name, version, script, createdAt) VALUES (?, ?, ?, ?)').run(wf, 'v1', SCRIPT, now);
    seedDb.close();

    // Simulate a new boot (create a new server instance with the same workRoot)
    // The boot backfill runs once at startup: UPDATE workflows SET owner='hsuhungjung@gmail.com' WHERE owner IS NULL
    const server2 = await createServer({
      port: 0,
      bind: '0.0.0.0',
      workRoot: tmpDir,
      auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it080-cid2', googleClientSecret: 'cs' },
    } as never);

    try {
      const wfGet = await callToolOn(server2, 'workflow_get', { name: wf });
      // v22 (DES-115, M-5): masked read — `owner` moved under `result`.
      expect((wfGet.result as { owner?: string })?.owner).toBe('hsuhungjung@gmail.com');
    } finally {
      await server2.close();
    }
  });

  it('case 10: boot backfill is idempotent (already-owned rows not re-owned)', async () => {
    // Register with alice as owner (register keeps its args.principal fallback post-H1 — see
    // header), then hand-seed the release pointer (publish can no longer be reached anonymously
    // on this connection — same H1 amendment as cases 1/2).
    const wf = 'alice-owned-it080';
    const r = await callTool('workflow_register', { name: wf, script: SCRIPT, principal: ALICE });
    expect(r.error).toBeUndefined();
    publishPointer(join(tmpDir, 'catalog.db'), wf, `v${r.version}`);

    // Second boot
    const server3 = await createServer({
      port: 0,
      bind: '0.0.0.0',
      workRoot: tmpDir,
      auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it080-cid3', googleClientSecret: 'cs' },
    } as never);

    try {
      const wfGet = await callToolOn(server3, 'workflow_get', { name: wf });
      // Already-owned row must NOT be re-owned to hsuhungjung@gmail.com
      // v22 (DES-115, M-5): masked read — `owner` moved under `result`.
      expect((wfGet.result as { owner?: string })?.owner).toBe(ALICE);
    } finally {
      await server3.close();
    }
  });
});
