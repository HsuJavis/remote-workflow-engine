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
//   - v22 send-back ROUND 2 (07-review.md §4.2/§8, B1): the prior round's accepted debt below is
//     now CLOSED. `workflow_register`/`workflow_deregister` no longer accept a self-asserted
//     `args.principal` as identity WHILE `authEnabled` — the exact residual the H1 finding was
//     re-raised for (a caller reads `owner` off `workflow_source`, replays it as `args.principal`,
//     and the ownership comparison passes because the strings match). `IT-095` below (this file)
//     encodes the closure; the ORIGINAL (superseded) scope note is kept one paragraph down for
//     history since it explains why the D-BIND setup at case 1 changed shape.
//   - Two wrinkles the fix must NOT silently resolve either way (07-review.md §4.2's own list):
//     (1) **no-auth attribution**: on an auth-DISABLED server, `args.principal` remains legitimate
//     identity for ALL THREE writes (including `workflow_publish`, whose own fallback was dropped
//     too aggressively in round 1 — see `val-107-release-channels.test.ts`'s restored oracle) —
//     the gate is `authEnabled`, never "does a principal exist"; (2) once closed, a loopback-origin
//     catalog write on a `0.0.0.0`+auth deployment becomes categorically impossible on ALL THREE
//     writes (matching `workflow_publish`'s already-shipped shape) — the intended consequence, not
//     a regression.
//   - All three: `authEnabled && effectivePrincipal === null` is checked BEFORE the ownership
//     comparison and refuses with a NEW typed code, `PRINCIPAL_REQUIRED` (04-design.md DES-117,
//     amended this batch — `NOT_WORKFLOW_OWNER` is the wrong code here: no ownership comparison
//     ever runs, the refusal is "no identity under auth").
//
// [ROUND 1 scope note, superseded by the above — kept for history / to explain case-1's setup]:
//   `workflow_publish` dropped `args.principal` entirely; `workflow_register`/`workflow_deregister`
//   KEPT the self-assertion fallback (accepted debt). Round 2 (above) closes that debt.
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

/** Round 2 (IT-095): adds a second UNPUBLISHED version row directly, bypassing `workflow_register`.
 *  Needed because case 1's setup used to register v2 through the D-BIND connection with a
 *  self-asserted `principal` — round 2's fix now refuses that call `PRINCIPAL_REQUIRED` (the exact
 *  closure this file proves), so a hand-seed is the only way left to reach a two-version starting
 *  state on this D-BIND-exempt server. */
function seedExtraVersion(dbPath: string, name: string, version: string, script: string): void {
  const db = new Database(dbPath);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO workflow_versions (name, version, script, createdAt) VALUES (?, ?, ?, ?)').run(name, version, script, now);
  db.close();
}

describe('H1: anonymous (no-identity) catalog writes are refused while auth is enabled, even via D-BIND (07-review.md §4.2)', () => {
  it('anonymous workflow_publish does NOT move the release pointer', async () => {
    const name = uniqueName('publish');
    const dbPath = join(dbindTmpDir, 'catalog.db');
    seedPublishedWorkflow(dbPath, name, 'it091-owner@example.com', 'v1', `return 'v1';`);
    // A second version exists to publish — hand-seeded (round 2 closes the register/deregister
    // self-assertion fallback, so this can no longer be reached by registering through the D-BIND
    // connection; see seedExtraVersion's doc comment).
    seedExtraVersion(dbPath, name, 'v2', `return 'v2';`);

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

  it('GREEN PIN: anonymous run_start is UNAFFECTED — the ADR-012 rescue path stays open on the D-BIND server', async () => {
    const name = uniqueName('run');
    const dbPath = join(dbindTmpDir, 'catalog.db');
    seedPublishedWorkflow(dbPath, name, 'it091-owner4@example.com', 'v1', `return 'ran';`);
    const run = await callTool(dbindServer, 'run_start', { name });
    expect(run['code']).not.toBe('PRINCIPAL_REQUIRED');
    expect(typeof run['runId']).toBe('string');
  });
});

// IT-095 (v22 send-back ROUND 2, 07-review.md §4.2/§8, B1): closes the residual H1 hole IT-091
// above deliberately left open — `workflow_register`/`workflow_deregister` must ALSO refuse a
// SELF-ASSERTED `args.principal` while `authEnabled`, not only the fully-anonymous (no principal
// key at all) case IT-091 covers. This is the exact attack scenario from §4.2: an unauthenticated
// D-BIND-exempt caller reads `owner` off `workflow_source` (on the non-owner allowlist,
// `mcp-facade.ts:308,330,338`), then replays that exact string as `args.principal` on
// `workflow_register`/`workflow_deregister` — today the ownership comparison passes because the
// strings match, even though no real identity was ever authenticated.
//
// Red reason (measured against today's engine): both mutation calls below currently SUCCEED — the
// spoofed `args.principal` satisfies both the (absent) `PRINCIPAL_REQUIRED` gate and the
// `workflow-catalog.ts` ownership comparison (`existing.owner === principal`), so the write goes
// through and the store-level oracles below observe it took effect.
describe('IT-095: H1 residual — self-asserted args.principal is ALSO refused PRINCIPAL_REQUIRED under auth (07-review.md §4.2/§8)', () => {
  it('D-BIND caller replays the REAL owner string as args.principal on workflow_register → still PRINCIPAL_REQUIRED', async () => {
    const name = uniqueName('spoof-register');
    const dbPath = join(dbindTmpDir, 'catalog.db');
    const owner = 'it095-owner@example.com';
    seedPublishedWorkflow(dbPath, name, owner, 'v1', `return 'v1';`);

    // The exact attack: no real bearer (D-BIND-exempt connection), but `args.principal` is the
    // CORRECT owner string (as if just read off a prior `workflow_source`).
    const reg = await callTool(dbindServer, 'workflow_register', { name, script: `return 'hijack-attempt';`, principal: owner });
    expect(reg['code']).toBe('PRINCIPAL_REQUIRED');
    expect(reg['code']).not.toBe('NOT_WORKFLOW_OWNER'); // no ownership comparison ever runs (DES-117)

    const db = new Database(dbPath);
    try {
      const versions = db.prepare('SELECT COUNT(*) AS n FROM workflow_versions WHERE name = ?').get(name) as { n: number };
      expect(versions.n).toBe(1); // no v2 row from the spoofed register
      const rows = db.prepare('SELECT script FROM workflow_versions WHERE name = ?').all(name) as Array<{ script: string }>;
      for (const r of rows) expect(r.script).not.toContain('hijack-attempt');
    } finally {
      db.close();
    }
  });

  it('D-BIND caller replays the REAL owner string as args.principal on workflow_deregister → still PRINCIPAL_REQUIRED', async () => {
    const name = uniqueName('spoof-deregister');
    const dbPath = join(dbindTmpDir, 'catalog.db');
    const owner = 'it095-owner2@example.com';
    seedPublishedWorkflow(dbPath, name, owner, 'v1', `return 'v1';`);

    const dereg = await callTool(dbindServer, 'workflow_deregister', { name, principal: owner });
    expect(dereg['code']).toBe('PRINCIPAL_REQUIRED');
    expect(dereg['code']).not.toBe('NOT_WORKFLOW_OWNER');

    const db = new Database(dbPath);
    try {
      const wf = db.prepare('SELECT name FROM workflows WHERE name = ?').get(name);
      expect(wf).toBeDefined(); // still present — the spoofed deregister never took effect
    } finally {
      db.close();
    }
  });

  it('GREEN PIN (wrinkle 1, no-auth attribution preserved): with auth DISABLED, args.principal STILL attributes ownership on workflow_register', async () => {
    const name = uniqueName('open-attrib');
    const reg = await callTool(openServer, 'workflow_register', { name, script: `return 'v1';`, principal: 'it095-open-owner@example.com' });
    expect(reg['error']).toBeUndefined();
    expect(reg['code']).not.toBe('PRINCIPAL_REQUIRED');

    // A DIFFERENT self-asserted principal is refused NOT_WORKFLOW_OWNER — proving ownership is
    // genuinely enforced via args.principal on a no-auth deployment, not merely accepted-then-inert.
    const hijack = await callTool(openServer, 'workflow_register', { name, script: `return 'hijack';`, principal: 'someone-else@example.com' });
    expect(hijack['code']).toBe('NOT_WORKFLOW_OWNER');

    // The true owner can still register a new version.
    const ownerReg = await callTool(openServer, 'workflow_register', { name, script: `return 'v2';`, principal: 'it095-open-owner@example.com' });
    expect(ownerReg['error']).toBeUndefined();
  });
});
