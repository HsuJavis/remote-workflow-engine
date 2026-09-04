// E2E-009 (DES-151, v24, Gate 7.5 scenario S-4): an admin reads another principal's run
// workspace over real MCP HTTP; the read is AUDITED (the run's OWNER sees adminReads[]; a caller
// who is not the owner never sees the key at all). Written test-first (Gate 5, RED) against a REAL
// booted engine with `principals` configured.
// Mock policy: real HTTP MCP server, real `principals` config, real TokenStore-minted bearers, no
// mock of the SUT boundary.
//
// v24 MIGRATION (integrator hand-off, test-only — no oracle weakened). Four defects in the
// test-first fixture, each of which made the journey unreachable rather than red-for-its-reason:
//   1. `principals` alone does NOT turn authorization on. `createServer` only builds a `TokenStore`
//      (and only mounts the auth-gated `/mcp` block) when `auth.enabled` is set — with auth off,
//      EVERY caller is the `auth-disabled` Principal, `authorize()` short-circuits, and the
//      `Authorization` header is never even looked at. So `Bearer bob@x.com` was decoration: admin
//      and bob were the same anonymous super-principal and no audit row can be written at all
//      (`audited-read.ts`: `actor === null` ⇒ no row, by design). Auth is now genuinely enabled and
//      each identity carries a REAL token minted through the real `TokenStore`.
//   2. `run_start({name})` needs a REGISTERED, PUBLISHED workflow; `'v24-cross-read-fixture'` was
//      never created, so the call answered WORKFLOW_NOT_FOUND. It is registered+published in
//      `beforeAll` — by a THIRD principal with role `author`, because `workflow_register` is
//      `{minRole:'author'}` and bob must stay `'user'` (S-4's whole point is a plain user's run
//      being read by an admin; promoting bob would dissolve the scenario).
//   3. The tool payload is `body.result.content[0].text` (a JSON string), not the JSON-RPC
//      envelope — `started.result.runId` was reading the MCP `content` wrapper.
//   4. `adminReads` sits on the run_status ENVELOPE, beside `result`, not inside it. That is
//      DES-151's explicit boundary ("never a field of `RunStatusView` itself, so DES-162's ungated
//      /api/* routes cannot serve it by construction", mcp-facade.ts:439-451) — the design decides,
//      so the assertion path moved onto it.
// The second case additionally names what it actually proves: `run_status` is
// `{minRole:'user', ownership:'run'}` with NO `adminCrossRead` (tool-specs.ts), so a non-owner
// non-admin is refused `NOT_RUN_OWNER` outright — they never see `adminReads` because they never
// see a projection. Asserting that code is the non-vacuous form of "the key is absent, not []";
// the previous body used bob (the run's own OWNER, who is precisely the principal DES-151 gives
// the key to) against a response that never had a `result` to begin with, so it passed for two
// wrong reasons at once. 05-tests.md's own E2E-009 entry anticipated exactly this: "the 'non-owner
// never sees adminReads' case is a legitimate vacuous-but-correct pin today (no result at all ⇒
// trivially no such key) that stays MEANINGFUL once the tools are real" — the tools are real now,
// so the case names the code that makes it meaningful. TWO ORACLE ADDITIONS, flagged for review:
// `adminReads[0].actor === ADMIN` here and `code === 'NOT_RUN_OWNER'` below. Neither weakens
// anything; both are strictly new assertions and the integrator may veto either.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

const AUTHOR = 'author@x.com';
const BOB = 'bob@x.com';
const ADMIN = 'admin@x.com';
const STRANGER = 'stranger@x.com';
const FIXTURE = 'v24-cross-read-fixture';

describe('admin cross-read is audited (E2E-009, DES-151, S-4)', () => {
  let server: Server;
  let workRoot: string;
  const bearer: Record<string, string> = {};

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-e2e009-'));
    server = await createServer({
      port: 0, bind: '127.0.0.1', workRoot,
      auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'e2e009-cid', googleClientSecret: 'e2e009-cs' },
      principals: {
        [AUTHOR]: { role: 'author' },
        [BOB]: { role: 'user' },
        [ADMIN]: { role: 'admin' },
        [STRANGER]: { role: 'user' },
      },
    } as never);
    for (const id of [AUTHOR, BOB, ADMIN, STRANGER]) bearer[id] = mint(workRoot, id);
    await registerPublishedVia((n, a) => call(n, a, AUTHOR), FIXTURE, 'return "cross-read";');
  });

  afterAll(async () => {
    await server?.close();
    rmSync(workRoot, { recursive: true, force: true });
  });

  /** A real token row in the server's own auth-tokens.db — the same technique IT-089/IT-080 use. */
  function mint(root: string, email: string): string {
    const db = new Database(join(root, 'auth-tokens.db'));
    try {
      const store = new TokenStore(db, { clock: () => Date.now(), csprng: (n: number) => randomBytes(n) });
      return store.issue(email, 7 * 24 * 3600_000).token;
    } finally {
      db.close();
    }
  }

  /** The UNWRAPPED tool payload: `{runId, status, principal?, adminReads?, result?, code?, error?}`. */
  async function call(name: string, args: Record<string, unknown>, principal: string): Promise<Record<string, any>> {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer[principal]}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
    return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, any>;
  }

  it('admin workspace_pull on bob\'s run succeeds, and bob\'s own run_status shows adminReads[]', async () => {
    const started = await call('run_start', { name: FIXTURE }, BOB);
    const runId = started.result?.runId;
    expect(runId).toBeDefined();

    await call('workspace_pull', { runId, path: 'a.txt' }, ADMIN);
    const status = await call('run_status', { runId }, BOB);
    expect(status.adminReads?.length).toBeGreaterThan(0);
    expect(status.adminReads[0].actor).toBe(ADMIN);
  });

  it('a NON-owner, non-admin principal never sees adminReads at all (key absent, not [])', async () => {
    const started = await call('run_start', { name: FIXTURE }, BOB);
    const runId = started.result?.runId;
    expect(runId).toBeDefined();

    const status = await call('run_status', { runId }, STRANGER);
    expect(status.code).toBe('NOT_RUN_OWNER');
    expect(status).not.toHaveProperty('adminReads');
  });
});
