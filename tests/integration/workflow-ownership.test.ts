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
//   7. workflow_source output includes owner field
//   8. run_start (by bob, non-owner) → NOT gated (runs succeed regardless of ownership)
//   9. Boot backfill: rows with NULL owner → backfilled to 'hsuhungjung@gmail.com' on next boot
//  10. Boot backfill is idempotent: second boot does not re-own already-owned rows
//
// Red reason: `workflow_register` + `workflow_deregister` do not yet accept a `principal`
//   parameter, and the `owner` column does not exist → NOT_WORKFLOW_OWNER never returned →
//   non-owner mutation succeeds when it should fail → assertions fail. Correct RED.
//
// Mock policy (integration): real server + real SQLite catalog (on-disk tmpDir) + real TokenStore
//   bearers. Nothing at the SUT boundary is mocked. No LLM/gateway needed (run_start is
//   script-only). NOTE: principal is NO LONGER passed as a tool argument — see the ROUND 2
//   migration note below; that path is exactly what H1/B1 closed.

// v22 adjudication #3 (M-5) — the read half. SUPERSEDED IN PART by the ROUND 2 migration below:
// M-5 reasoned from a server where `ctx.principal` was null on every read (the D-BIND exemption), so
// every `workflow_source` returned the MASKED public view. That premise is gone — alice now reads with
// her own bearer and takes the OWNER branch. What survives unchanged:
//   - cases 7/9/10 read `owner` off `r.result.owner`. Still correct: the owner branch returns `owner`
//     both flat and under `result`, and REQ-100 keeps it on the non-owner allowlist too, so the path
//     holds under either view. Same oracle either way.
//   - case 3's oracle ("the stored definition is unchanged") stays asserted at the STORE (catalog.db
//     directly) rather than through a read response. That was M-5's call for a masked-view reason,
//     but it is the better assertion regardless: the store is where "unchanged" actually means
//     something, and it does not silently weaken if the view changes again.
//
// v22 H1 send-back ROUND 2 — REAL-BEARER MIGRATION (07-review.md §4.2 B1, orchestrator-applied):
//
// What this file used to be, stated plainly: it bound the server to `0.0.0.0` so the loopback test
// client would take the D-BIND exemption, which skips server.ts's gated `/mcp` block entirely — and
// then self-asserted identity with `{principal: ALICE}` as a tool argument. **That is exactly the
// shape H1 was raised to close.** The test topology existed because the vulnerability existed; when
// B1 extended the `!authEnabled` gate from `workflow_publish` to `workflow_register`/
// `workflow_deregister` as well, all seven of those cases went red. They were not broken by the fix
// — they were relying on what the fix removes.
//
// So identity now comes from a REAL minted bearer, IT-089's (`workflow-masking-http.test.ts`)
// exact pattern:
//   - the main `server` binds `127.0.0.1`, so the connection is NOT D-BIND-exempt and
//     `resolvePrincipal` actually runs. (Minting a bearer while still bound to `0.0.0.0` would be a
//     silent no-op: no code path there ever reads an `Authorization` header.)
//   - `mintBearer()` issues a real token through the real `TokenStore` against the server's own
//     `auth-tokens.db`; alice and bob get DISTINCT bearers, because case 3/4's `NOT_WORKFLOW_OWNER`
//     oracle is meaningless unless two genuinely different authenticated identities exist.
//   - every call on this server now carries a bearer — reads included; without the D-BIND exemption
//     the gate applies to all of them.
//
// **No oracle changed.** `NOT_WORKFLOW_OWNER` for a non-owner, success for the owner, byte for byte
// as before. Only the way each case proves who it is changed. (The round-1 counter-example is on
// record: `val-107`'s non-owner oracle was rewritten to assert success so it would match the new
// code — an expected value derived from the code under test cannot fail when the code is wrong.)
//
// `publishPointer()` is DELETED, not merely unused. It existed solely because `workflow_publish`
// was unreachable on the D-BIND-exempt connection; with an owner bearer the real call works, so
// every case that needs "alice's latest is on release" now makes it. Cases 1/2/10 assert the
// publish succeeded — the hand-seeded pointer could never have caught a broken publish.
//
// v24 MIGRATION (REQ-109 roles, ADR-028; TASK-147/DES-139) — two mechanical consequences, no oracle
// touched:
//   - `principals` is now CONFIGURED for alice and bob, both as `author`. An authenticated id that
//     is not listed resolves to role `'user'` (fail-closed), and register/deregister/publish all
//     require `'author'` — so without this every case below answered `FORBIDDEN_ROLE` before the
//     ownership comparison could run. Both are authors on purpose: the whole point of cases 3/4 is
//     that two principals who MAY both register still cannot touch each other's workflows, which is
//     invisible if bob is refused for lacking the role.
//   - Cases 9/10's second/third boots no longer keep `bind: '0.0.0.0'`. That was justified by "they
//     only READ, through a masked view that is identical either way" — v24 retires that premise:
//     `workflow_source` is `{minRole:'author'}` (tool-specs.ts), and a D-BIND-exempt caller is the
//     `loopback-exempt` Principal, which authorize() admits ONLY for `{minRole:'user',
//     ownership:'none'}` — everything else is `PRINCIPAL_REQUIRED`. So those boots bind loopback and
//     read with alice's bearer (the same `auth-tokens.db` under the shared workRoot). Same oracle:
//     the backfilled `owner` string as observed on a freshly booted server.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';

let server: Server;
let tmpDir: string;
let aliceToken: string;
let bobToken: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it080-'));
  server = await createServer({
    port: 0,
    // 127.0.0.1, NOT 0.0.0.0: a loopback client against a loopback bind is NOT D-BIND-exempt, so
    // `resolvePrincipal` runs and a real bearer is actually validated. See the header — the old
    // `0.0.0.0` binding existed to bypass that gate, which is the vulnerability B1 closed.
    bind: '127.0.0.1',
    workRoot: tmpDir,
    // Auth enabled: the boot backfill (DES-098) needs it, and it is the condition under which the
    // ownership gate is worth testing at all.
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it080-cid', googleClientSecret: 'it080-cs' },
    // v24 (REQ-109): both alice and bob are AUTHORS. See the migration note in the header — an
    // unlisted authenticated id is `'user'`, which cannot register at all, and a role refusal would
    // silently replace every ownership oracle below with a role oracle.
    principals: { [ALICE]: { role: 'author' }, [BOB]: { role: 'author' } },
  } as never);
  aliceToken = mintBearer(tmpDir, ALICE);
  bobToken = mintBearer(tmpDir, BOB);
});

/** Issues a REAL bearer through the real TokenStore against the server's own auth-tokens.db —
 *  IT-089's (`workflow-masking-http.test.ts`) pattern. Identity is proven, never self-asserted. */
function mintBearer(workRoot: string, email: string): string {
  const db = new Database(join(workRoot, 'auth-tokens.db'));
  try {
    const store = new TokenStore(db, { clock: () => Date.now(), csprng: (n: number) => randomBytes(n) });
    return store.issue(email, 7 * 24 * 3600_000).token;
  } finally {
    db.close();
  }
}

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Identity travels in the `Authorization` header, never in `args` — server.ts's `args.principal`
 *  fallback is now gated on `!authEnabled` (B1), and this server has auth ON. A call with no bearer
 *  is refused PRINCIPAL_REQUIRED on every catalog write, which is the point of the fix. */
async function callToolOn(srv: Server, name: string, args: Record<string, unknown>, bearer?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  const res = await fetch(`http://127.0.0.1:${srv.port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}
async function callTool(name: string, args: Record<string, unknown>, bearer?: string) {
  return callToolOn(server, name, args, bearer);
}


const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const OWNER_WORKFLOW = 'owned-workflow-it080';
const SCRIPT = 'return "hello";';

describe('Workflow ownership gate (DES-098, IT-080)', () => {
  it('case 1: first registration by alice → owned by alice', async () => {
    const r = await callTool('workflow_register', { name: OWNER_WORKFLOW, script: SCRIPT, mermaid: 'graph TD;' }, aliceToken);
    expect(r.error).toBeUndefined();
    expect(typeof r.version).toBe('number');
    // v22: registration is not publication. With a real owner bearer the real call is reachable.
    const pub = await callTool('workflow_publish', { name: OWNER_WORKFLOW, version: `v${r.version}`, channel: 'release' }, aliceToken);
    expect(pub.error).toBeUndefined();
  });

  it('case 7: workflow_source includes owner field', async () => {
    const r = await callTool('workflow_source', { name: OWNER_WORKFLOW }, aliceToken);
    expect(r.error).toBeUndefined();
    // v22 (DES-115): the projection under `result` IS the response; `owner` stays on the public
    // allowlist (REQ-100 names it), only its path changed.
    expect((r.result as { owner?: string })?.owner).toBe(ALICE);
  });

  it('case 2: register-overwrite by alice (same owner) → succeeds', async () => {
    const r = await callTool('workflow_register', { name: OWNER_WORKFLOW, script: SCRIPT + ' // v2', mermaid: 'graph TD;' }, aliceToken);
    expect(r.error).toBeUndefined();
    expect(r.code).not.toBe('NOT_WORKFLOW_OWNER');
    // Alice's own new version onto `release`, so the reads below see her latest — the state case 3's
    // "stored definition unchanged" oracle compares against.
    const pub = await callTool('workflow_publish', { name: OWNER_WORKFLOW, version: `v${r.version}`, channel: 'release' }, aliceToken);
    expect(pub.error).toBeUndefined();
  });

  it('case 3: register-overwrite by bob (non-owner) → NOT_WORKFLOW_OWNER + stored unchanged', async () => {
    // Bob is a genuinely authenticated, genuinely different identity — not a self-asserted string.
    const r = await callTool('workflow_register', { name: OWNER_WORKFLOW, script: 'return "hijacked";', mermaid: 'graph TD;' }, bobToken);
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
    const r = await callTool('workflow_deregister', { name: OWNER_WORKFLOW }, bobToken);
    expect(r.code).toBe('NOT_WORKFLOW_OWNER');

    const check = await callTool('workflow_source', { name: OWNER_WORKFLOW }, aliceToken);
    expect(check.error).toBeUndefined();
    // workflow_source puts name inside result (flat top-level: owner/defaults/script only; DES-098)
    expect(typeof (check.result as { name?: string })?.name).toBe('string');
  });

  it('case 8: run_start by bob (non-owner) → NOT gated (read/run open to any)', async () => {
    const r = await callTool('run_start', { name: OWNER_WORKFLOW }, bobToken);
    expect(r.code).not.toBe('NOT_WORKFLOW_OWNER');
    expect(typeof r.runId).toBe('string');
  });

  it('case 5: deregister by alice (owner) → succeeds', async () => {
    // Re-register as alice first (a prior write above may not have changed owner)
    await callTool('workflow_register', { name: OWNER_WORKFLOW, script: SCRIPT, mermaid: 'graph TD;' }, aliceToken);
    const r = await callTool('workflow_deregister', { name: OWNER_WORKFLOW }, aliceToken);
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
    const owned = await callToolOn(openServer, 'workflow_register', { name, script: SCRIPT, principal: ALICE, mermaid: 'graph TD;' });
    expect(owned.error).toBeUndefined();

    const r = await callToolOn(openServer, 'workflow_register', {
      name,
      script: SCRIPT + ' // null-principal-ok',
      principal: null,  // no principal → ungated (auth genuinely off)
      mermaid: 'graph TD;',
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
      // v24: loopback bind + alice's bearer — a D-BIND-exempt read of `workflow_source` is now
      // `PRINCIPAL_REQUIRED` (see the header's migration note). Same workRoot ⇒ same auth-tokens.db.
      bind: '127.0.0.1',
      workRoot: tmpDir,
      auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it080-cid2', googleClientSecret: 'cs' },
      principals: { [ALICE]: { role: 'author' }, [BOB]: { role: 'author' } },
    } as never);

    try {
      const wfGet = await callToolOn(server2, 'workflow_source', { name: wf }, aliceToken);
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
    const r = await callTool('workflow_register', { name: wf, script: SCRIPT, mermaid: 'graph TD;' }, aliceToken);
    expect(r.error).toBeUndefined();
    const pub = await callTool('workflow_publish', { name: wf, version: `v${r.version}`, channel: 'release' }, aliceToken);
    expect(pub.error).toBeUndefined();

    // Second boot
    const server3 = await createServer({
      port: 0,
      bind: '127.0.0.1', // v24: same reason as server2 above.
      workRoot: tmpDir,
      auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it080-cid3', googleClientSecret: 'cs' },
      principals: { [ALICE]: { role: 'author' }, [BOB]: { role: 'author' } },
    } as never);

    try {
      const wfGet = await callToolOn(server3, 'workflow_source', { name: wf }, aliceToken);
      // Already-owned row must NOT be re-owned to hsuhungjung@gmail.com
      // v22 (DES-115, M-5): masked read — `owner` moved under `result`.
      expect((wfGet.result as { owner?: string })?.owner).toBe(ALICE);
    } finally {
      await server3.close();
    }
  });
});
