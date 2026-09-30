// verify-i MEDIUM-2 (2026-09-30): once the dashboard's /api/ is internet-reachable, /api/status must
// not hand the self-update log excerpt (`lastUpdate.detail`) or the interrupted-run count to an
// anonymous remote caller. Liveness (200 + version + agentSemaphore) stays public — deploy.sh
// only checks the 200 and migrate-to-service-user.sh reads /api/version, both from localhost.
// Full detail: a raw loopback peer, or an authenticated admin. The dashboard island's lastUpdate
// likewise carries `detail` only for an admin / loopback viewer.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer, type Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';

const SECRET = 'SELF-UPDATE-LOG-EXCERPT-7f3a';
let server: Server; let dir: string; let upd: string; let base: string;
const tok: Record<string, string> = {};
const REMOTE = { 'X-Forwarded-For': '203.0.113.7' }; // a tunnelled request: never a loopback peer

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rwe-status-'));
  upd = mkdtempSync(join(tmpdir(), 'rwe-status-upd-'));
  writeFileSync(join(upd, 'result.json'), JSON.stringify({ tag: 'v9.9.9', status: 'failed', ts: new Date().toISOString(), detail: SECRET, configCheck: 'failed' }));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: dir, updateResultPath: join(upd, 'result.json'),
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'c', googleClientSecret: 's' },
    principals: { 'root@x.test': { role: 'admin' }, 'u@x.test': { role: 'user' } } } as never);
  base = `http://127.0.0.1:${server.port}`;
  const db = new Database(join(dir, 'auth-tokens.db'));
  const ts = new TokenStore(db, { clock: () => Date.now(), csprng: (n) => randomBytes(n) });
  tok.root = ts.issue('root@x.test', 60_000).token; tok.user = ts.issue('u@x.test', 60_000).token;
  tok.rootSession = ts.createSession('root@x.test').token; tok.userSession = ts.createSession('u@x.test').token;
  db.close();
});
afterAll(async () => { await server?.close(); rmSync(dir, { recursive: true, force: true }); rmSync(upd, { recursive: true, force: true }); });

describe('/api/status disclosure', () => {
  it('a raw loopback peer (the deploy healthcheck) gets the full body', async () => {
    const r = await fetch(`${base}/api/status`);
    expect(r.status).toBe(200);
    const b = await r.json() as Record<string, any>;
    expect(b.lastUpdate?.detail).toBe(SECRET);
  });

  it('an anonymous remote caller gets liveness only (200, version, agentSemaphore) — no lastUpdate, no interruptedRuns', async () => {
    const r = await fetch(`${base}/api/status`, { headers: REMOTE });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain(SECRET);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['agentSemaphore', 'version']);
  });

  it('a remote non-admin gets liveness only; a remote admin gets the full body', async () => {
    const u = await (await fetch(`${base}/api/status`, { headers: { ...REMOTE, Authorization: `Bearer ${tok.user}` } })).text();
    expect(u).not.toContain(SECRET);
    const a = await (await fetch(`${base}/api/status`, { headers: { ...REMOTE, Authorization: `Bearer ${tok.root}` } })).json() as Record<string, any>;
    expect(a.lastUpdate?.detail).toBe(SECRET);
  });

  it('the dashboard page: a remote non-admin\'s island carries lastUpdate WITHOUT detail; an admin\'s carries it', async () => {
    const u = await (await fetch(`${base}/dashboard`, { headers: { ...REMOTE, Cookie: `rwe_session=${tok.userSession}` } })).text();
    expect(u).toContain('v9.9.9');
    expect(u).not.toContain(SECRET);
    const a = await (await fetch(`${base}/dashboard`, { headers: { ...REMOTE, Cookie: `rwe_session=${tok.rootSession}` } })).text();
    expect(a).toContain(SECRET);
  });
});
