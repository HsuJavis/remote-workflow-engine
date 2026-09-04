// VAL-110 (REQ-100): `workflow_source` masks the script for non-owners. Real entrypoint: `createServer`,
// real MCP HTTP, real auth (TokenStore-minted bearer), real `/api/*` routes.
//
// Mock policy (acceptance, DES-119): no mocking of the SUT's own boundaries. No LLM dispatch needed.
//
// Original Gate-5 red reason (v22): `/api/workflows/:name/skeleton` returned the script-derived
// skeleton/phases unconditionally, and `server.ts:823` threaded no principal into `workflow_source` at
// all. The skeleton/phases clause below was retired in v23 (see the note further down) once REQ-105
// deleted the `/skeleton` route outright; the remaining cases are the `workflow_source` script-masking
// and `/api/workflows` no-`script`-field assertions.
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

let authServer: Server;
let openServer: Server;
let authTmpDir: string;
let openTmpDir: string;

beforeAll(async () => {
  authTmpDir = mkdtempSync(join(tmpdir(), 'rwe-val110-auth-'));
  authServer = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: authTmpDir,
    auth: {
      enabled: true, issuer: 'http://127.0.0.1:0',
      googleClientId: 'val110-client-id', googleClientSecret: 'val110-client-secret',
      googleBase: 'http://127.0.0.1:0', jwksFetch: async () => [],
    },
    // v24 (REQ-109 roles, ADR-028): both ids are AUTHORS. The owner needs it to register/publish;
    // the STRANGER needs it because `workflow_source` is itself `{minRole:'author', ownership:'none'}`
    // — an unlisted id is `'user'` and gets FORBIDDEN_ROLE before the owner/non-owner masking branch
    // is ever reached, which would make the mask assertion vacuous rather than red.
    principals: {
      'val110-owner@example.com': { role: 'author' },
      'val110-stranger@example.com': { role: 'author' },
    },
  } as never);
  openTmpDir = mkdtempSync(join(tmpdir(), 'rwe-val110-open-'));
  openServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: openTmpDir });
});
afterAll(async () => {
  await authServer?.close(); await openServer?.close();
  rmSync(authTmpDir, { recursive: true, force: true }); rmSync(openTmpDir, { recursive: true, force: true });
});

async function mintBearer(workRoot: string, email: string): Promise<string> {
  const db = new Database(join(workRoot, 'auth-tokens.db'));
  const now = Date.now();
  const store = new TokenStore(db, { clock: () => now, csprng: (n: number) => randomBytes(n) });
  const { token } = store.issue(email, 7 * 24 * 3600_000);
  db.close();
  return token;
}
// v22: binds this file's own 4-arg toolCall into the 2-arg shape the shared fixture helper drives.
// The bearer is threaded so register AND publish run as the SAME principal — the publish ownership
// gate stays live (adjudication #2 L-4) instead of being skipped by a null principal.
const callerFor = (server: Server, bearer?: string) =>
  (name: string, args: Record<string, unknown>) => toolCall(server, name, args, bearer);

async function toolCall(server: Server, name: string, args: Record<string, unknown>, bearer?: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('REQ-100: two real principals over /mcp (VAL-110)', () => {
  it('owner reads the script; a non-owner bearer gets exactly the masked non-owner key set', async () => {
    const ownerToken = await mintBearer(authTmpDir, 'val110-owner@example.com');
    // v22 (DES-110): `workflow_source({name})` resolves the RELEASE channel, so an unpublished draft
    // reads back CHANNEL_UNPUBLISHED rather than the owner/non-owner projections under test.
    await registerPublishedVia(callerFor(authServer, ownerToken), 'val110-flow', `return 'val110-secret';`);

    const owned = await toolCall(authServer, 'workflow_source', { name: 'val110-flow' }, ownerToken);
    expect((owned['result'] as { script?: string } | undefined)?.script).toBe(`return 'val110-secret';`);

    const otherToken = await mintBearer(authTmpDir, 'val110-stranger@example.com');
    const masked = await toolCall(authServer, 'workflow_source', { name: 'val110-flow' }, otherToken);
    const maskedResult = masked['result'] as Record<string, unknown> | undefined;
    expect(maskedResult?.['scriptWithheld']).toBe(true);
    expect(JSON.stringify(masked)).not.toContain('val110-secret');
  });
});

describe('REQ-100: /api/workflows is masked while auth is enabled, no exceptions (VAL-110)', () => {
  // [RETIRED v23 — orchestrator adjudication #4 T-2] The case that stood here probed
  // `/api/workflows/:name/skeleton` and asserted the response omitted `skeleton`/`phases`.
  // REQ-105 DELETED that route, so it began returning 404 `{error:"Not found"}` — against which
  // all three assertions pass trivially. It was VACUOUS, not passing: a masking assertion that
  // succeeds against a deleted endpoint protects nothing, and leaving it green is worse than
  // deleting it because a future reader counts it as coverage. (Its `phases` assertion was
  // independently obsolete too — adjudication #1 made phase titles PUBLIC on every surface.)
  // The surviving masking guarantees are asserted by the cases below and by UT-115's
  // no-skeleton-surface guard.

  it('/api/workflows never carries a `script` field while auth is on', async () => {
    const res = await fetch(`http://127.0.0.1:${authServer.port}/api/workflows`);
    const body = await res.json() as Array<Record<string, unknown>>;
    for (const entry of body) expect('script' in entry).toBe(false);
  });
});

// [RETIRED v23, adjudication #2 R-3(a)] This describe block asserted the auth-disabled skeleton
// route (`GET /api/workflows/:name/skeleton`) still serves `phases` byte-for-byte — a surface
// REQ-105 deletes unconditionally (auth state no longer matters; there is no route left). See
// 01-requirements.md REQ-100's own "[PARTIALLY SUPERSEDED v23, adjudication #2 R-3(a)]" note: every
// OTHER field REQ-100 names (script masking, owner/report metadata) is unaffected and still applies
// with auth off — only this skeleton/phases clause had nothing left to test.
