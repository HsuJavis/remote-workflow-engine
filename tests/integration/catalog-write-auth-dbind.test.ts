// IT-091 (H1 send-back, 07-review.md §4.2 — ARCH-071, ARCH-073, ADR-012, DES-114, DES-117,
// REQ-097, REQ-100): catalog WRITE mutations (`workflow_publish`/`workflow_register`/
// `workflow_deregister`) must refuse an anonymous caller (no identity at all — server-resolved
// principal null AND no self-asserted `args.principal`) while auth is enabled, the same way reads
// already key on `authEnabled` rather than `principal === null` (ADR-012). Today all three skip
// their `NOT_WORKFLOW_OWNER` check outright when `principal === null`
// (`workflow-catalog.ts:338,378,473`), so a D-BIND loopback-exempt caller — reachable on any
// auth-enabled, non-loopback-bound deployment without a bearer — can move a name's release/beta
// pointer, register a new version onto an owned name, or deregister it entirely.
//
// Scope of the fix this batch encodes (recorded so a later reviewer does not read partial closure
// as a dangling half, ARCH-071's own "no partial adoption" lesson):
//   - `workflow_publish`: `args.principal` is dropped ENTIRELY (ADR-012's `args.principal`-barred
//     idiom, already applied to reads, now applied to this write too) — effective principal is
//     the server-resolved one, full stop.
//   - `workflow_register`/`workflow_deregister`: the `args.principal` self-assertion fallback is
//     RETAINED this round (a caller that supplies a non-null string still attributes as before —
//     recorded accepted debt, not a green pin: see the note at the bottom of this file and
//     `journal.md`/`06-impl-log.md`'s send-back entry). What closes here is the narrower, more
//     severe hole: a caller supplying NO identity at all (omitted, or explicit `null`) is refused,
//     not silently treated as "unowned".
//   - All three: `authEnabled && effectivePrincipal === null` is checked BEFORE the ownership
//     comparison and refuses with a NEW typed code, `PRINCIPAL_REQUIRED` (04-design.md DES-117,
//     amended this batch — `NOT_WORKFLOW_OWNER` is the wrong code here: no ownership comparison
//     ever runs, the refusal is "no identity under auth").
//
// D-BIND mechanics (mirrors IT-080): server binds `0.0.0.0`, auth enabled; the test client
// connects from `127.0.0.1`, so `isLoopbackPeer && !isLoopback(bind)` is true and the caller is
// EXEMPT from the bearer gate — `resolvePrincipal` is never even invoked for this connection
// (server.ts's OWN gated `/mcp` block is skipped whole; the unconditional fallback handler further
// down always dispatches with `principal: null`). This means a bearer literally cannot be
// validated on a D-BIND-exempt connection — the "owner CAN still publish with a real bearer"
// green pin lives elsewhere (IT-089's loopback-BOUND server, where D-BIND never applies), not
// here; where this file's setup needs an already-published pointer, it hand-seeds it directly in
// catalog.db rather than routing through `workflow_publish` (which is exactly the write this file
// is proving must now be unreachable anonymously).
//
// Mock policy (integration, DES-119): real createServer + real HTTP + real on-disk catalog.db.
//
// Red reason (measured against today's engine): all three mutation calls below currently SUCCEED
// anonymously on the auth-enabled D-BIND server — no `PRINCIPAL_REQUIRED` code exists anywhere in
// `src/`, and the store-level oracles (pointer moved / row deleted / version-row inserted) confirm
// each write actually took effect.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let dbindServer: Server;
let openServer: Server;
let dbindTmpDir: string;
let openTmpDir: string;

beforeAll(async () => {
  dbindTmpDir = mkdtempSync(join(tmpdir(), 'rwe-it091-dbind-'));
  dbindServer = await createServer({
    port: 0, bind: '0.0.0.0', workRoot: dbindTmpDir,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it091-cid', googleClientSecret: 'it091-cs' },
  } as never);

  openTmpDir = mkdtempSync(join(tmpdir(), 'rwe-it091-open-'));
  openServer = await createServer({
    port: 0, bind: '0.0.0.0', workRoot: openTmpDir, // auth disabled — D-AUTH-6 floor
  } as never);
});

afterAll(async () => {
  await dbindServer?.close();
  await openServer?.close();
  rmSync(dbindTmpDir, { recursive: true, force: true });
  rmSync(openTmpDir, { recursive: true, force: true });
});

async function callTool(server: Server, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

function uniqueName(prefix: string): string {
  return `it091-${prefix}-${randomUUID().slice(0, 8)}`;
}

/** Hand-seeds an owned, single-version, PUBLISHED workflow directly into catalog.db — the v22
 *  schema shape (mirrors IT-089's NULL-owner seeding pattern, `workflow-masking-http.test.ts:126-131`).
 *  Deliberately bypasses `workflow_publish` over HTTP: on this D-BIND-exempt server a bearer can
 *  never be validated (see file header), so this is the only way to reach a legitimately-published
 *  starting state for the refusal oracles below. */
function seedPublishedWorkflow(dbPath: string, name: string, owner: string, version: string, script: string): void {
  const db = new Database(dbPath);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO workflows (name, createdAt, owner, release_version) VALUES (?, ?, ?, ?)').run(name, now, owner, version);
  db.prepare('INSERT INTO workflow_versions (name, version, script, createdAt) VALUES (?, ?, ?, ?)').run(name, version, script, now);
  db.close();
}

describe('H1: anonymous (no-identity) catalog writes are refused while auth is enabled, even via D-BIND (07-review.md §4.2)', () => {
  it('anonymous workflow_publish does NOT move the release pointer', async () => {
    const name = uniqueName('publish');
    const dbPath = join(dbindTmpDir, 'catalog.db');
    seedPublishedWorkflow(dbPath, name, 'it091-owner@example.com', 'v1', `return 'v1';`);
    // A second version exists to publish (registration keeps its fallback this round, so an
    // owner-asserted register still works via D-BIND — this is setup, not the assertion).
    const reg = await callTool(dbindServer, 'workflow_register', { name, script: `return 'v2';`, principal: 'it091-owner@example.com' });
    expect(reg['error']).toBeUndefined();

    const pub = await callTool(dbindServer, 'workflow_publish', { name, version: 'v2', channel: 'release' /* NO principal at all */ });
    expect(pub['code']).toBe('PRINCIPAL_REQUIRED');

    const db = new Database(dbPath);
    try {
      const row = db.prepare('SELECT release_version FROM workflows WHERE name = ?').get(name) as { release_version: string };
      expect(row.release_version).toBe('v1'); // unmoved — the anonymous publish never took effect
    } finally {
      db.close();
    }
  });

  it('anonymous workflow_deregister does NOT remove the workflow', async () => {
    const name = uniqueName('deregister');
    const dbPath = join(dbindTmpDir, 'catalog.db');
    seedPublishedWorkflow(dbPath, name, 'it091-owner2@example.com', 'v1', `return 'v1';`);

    const dereg = await callTool(dbindServer, 'workflow_deregister', { name /* NO principal at all */ });
    expect(dereg['code']).toBe('PRINCIPAL_REQUIRED');

    const db = new Database(dbPath);
    try {
      const wf = db.prepare('SELECT name FROM workflows WHERE name = ?').get(name);
      expect(wf).toBeDefined(); // still present — the anonymous deregister never took effect
      const versions = db.prepare('SELECT COUNT(*) AS n FROM workflow_versions WHERE name = ?').get(name) as { n: number };
      expect(versions.n).toBe(1);
    } finally {
      db.close();
    }
  });

  it('anonymous workflow_register (a new version onto an OWNED name) does NOT insert a new version row', async () => {
    const name = uniqueName('register');
    const dbPath = join(dbindTmpDir, 'catalog.db');
    seedPublishedWorkflow(dbPath, name, 'it091-owner3@example.com', 'v1', `return 'v1';`);

    const reg = await callTool(dbindServer, 'workflow_register', { name, script: `return 'hijack-attempt';` /* NO principal at all */ });
    expect(reg['code']).toBe('PRINCIPAL_REQUIRED');

    const db = new Database(dbPath);
    try {
      const versions = db.prepare('SELECT COUNT(*) AS n FROM workflow_versions WHERE name = ?').get(name) as { n: number };
      expect(versions.n).toBe(1); // no v2 row from the anonymous attempt
      const rows = db.prepare('SELECT script FROM workflow_versions WHERE name = ?').all(name) as Array<{ script: string }>;
      for (const r of rows) expect(r.script).not.toContain('hijack-attempt');
    } finally {
      db.close();
    }
  });

  it('GREEN PIN: with auth disabled, the SAME three anonymous calls all succeed (D-AUTH-6 preserved, ADR-012)', async () => {
    const name = uniqueName('open');
    const reg = await callTool(openServer, 'workflow_register', { name, script: `return 'v1';` });
    expect(reg['code']).not.toBe('PRINCIPAL_REQUIRED');
    expect(reg['error']).toBeUndefined();
    const pub = await callTool(openServer, 'workflow_publish', { name, version: 'v1', channel: 'release' });
    expect(pub['code']).not.toBe('PRINCIPAL_REQUIRED');
    const dereg = await callTool(openServer, 'workflow_deregister', { name });
    expect(dereg['code']).not.toBe('PRINCIPAL_REQUIRED');
    expect((dereg as { removed?: boolean }).removed).toBe(true);
  });

  it('GREEN PIN: anonymous workflow_run is UNAFFECTED — the ADR-012 rescue path stays open on the D-BIND server', async () => {
    const name = uniqueName('run');
    const dbPath = join(dbindTmpDir, 'catalog.db');
    seedPublishedWorkflow(dbPath, name, 'it091-owner4@example.com', 'v1', `return 'ran';`);
    const run = await callTool(dbindServer, 'workflow_run', { name });
    expect(run['code']).not.toBe('PRINCIPAL_REQUIRED');
    expect(typeof run['runId']).toBe('string');
  });
});
