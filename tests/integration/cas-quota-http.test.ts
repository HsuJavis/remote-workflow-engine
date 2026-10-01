// Owner decision 2026-10-02, wire tier: per-principal CAS quota, CAS cleanup, admin quota surface,
// disk floor — over a real auth-enabled createServer() (real HTTP, real CasStore, real SQLite).
//   • POST /assets/blob and /assets/manifest refuse 507 QUOTA_EXCEEDED {usedBytes, limitBytes,
//     requestedBytes, hint} BEFORE storing — from Content-Length up front, and mid-stream for a
//     chunked body that never declared its size; concurrent uploads cannot jointly exceed the limit.
//   • workspace_push (cas mode) refuses QUOTA_EXCEEDED; workspace_diff shows the caller's quota.
//   • principal_set_quota (admin) raises/clears a limit; principals_list rows carry usage; the
//     dashboard admin route is CSRF-gated like role changes; GET /api/me shows the caller's quota.
//   • workspace_prune_blobs dry-runs/prunes the caller's unrooted, unused refs; a registered
//     version's seed manifest (and the blobs it lists) is never pruned.
//   • Disk floor: uploads -> 503 DISK_LOW; run_start / run_resume refused DISK_LOW; a webhook
//     delivery -> 503 {code: DISK_LOW} (transient, the delivery id is released).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer, type Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';
import { startFakeGoogle, fakeJwksFetch, dashboardLogin, type FakeGoogle } from '../helpers/fake-google.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const CID = 'quota-cid';
const ROOT = 'root@example.test';
const ALICE = 'alice@example.test'; // author
const BOB = 'bob@example.test'; // user
const CAROL = 'carol@example.test'; // user
const DAVE = 'dave@example.test'; // user
const EVE = 'eve@example.test'; // user — used only by the LOW-1 re-POST test, kept off every other principal's usage assertion
let google: FakeGoogle; let server: Server; let dir: string; let base: string;
const bearer: Record<string, string> = {};

async function tool(name: string, args: Record<string, unknown>, who: string): Promise<Record<string, any>> {
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer[who]}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const b = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(b.result?.content?.[0]?.text ?? '{}');
}
const codeOf = (r: Record<string, any>) => r['code'] ?? r['error']?.code;
const post = (path: string, body: BodyInit, who: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${bearer[who]}`, ...headers }, body, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) } as RequestInit);
const blob = (n: number, fill: string) => Buffer.alloc(n, fill);

beforeAll(async () => {
  google = await startFakeGoogle(CID);
  dir = mkdtempSync(join(tmpdir(), 'rwe-quota-http-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: dir,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: CID, googleClientSecret: 'cs', googleTokenUrl: google.tokenUrl, jwksFetch: fakeJwksFetch },
    principals: { [ROOT]: { role: 'admin' }, [ALICE]: { role: 'author' }, [BOB]: { role: 'user' }, [CAROL]: { role: 'user' }, [DAVE]: { role: 'user' }, [EVE]: { role: 'user' } },
    casQuota: { user: 1000, author: 100_000, admin: null },
    diskFloor: { percent: 0, bytes: 0 } } as never);
  base = `http://127.0.0.1:${server.port}`;
  const db = new Database(join(dir, 'auth-tokens.db'));
  const ts = new TokenStore(db, { clock: () => Date.now(), csprng: (n) => randomBytes(n) });
  for (const who of [ROOT, ALICE, BOB, CAROL, DAVE, EVE]) bearer[who] = ts.issue(who, 3600_000).token;
  db.close();
});
afterAll(async () => { await server?.close(); await google?.close(); rmSync(dir, { recursive: true, force: true }); });

describe('quota on the upload routes', () => {
  it('blob: under the limit 200; over it (declared Content-Length) 507 QUOTA_EXCEEDED before the body is stored', async () => {
    const a = blob(600, 'a'); const b = blob(500, 'b');
    expect((await post(`/assets/blob/${sha(a)}`, a, BOB)).status).toBe(200);
    const r = await post(`/assets/blob/${sha(b)}`, b, BOB);
    expect(r.status).toBe(507);
    const body = await r.json();
    expect(body).toMatchObject({ code: 'QUOTA_EXCEEDED', usedBytes: 600, limitBytes: 1000, requestedBytes: 500 });
    expect(body.hint).toContain('workspace_prune_blobs');
    // Not stored: a manifest naming it is MISSING_BLOBS.
    const m = await post('/assets/manifest', JSON.stringify([{ path: 'b', sha256: sha(b) }]), BOB);
    expect(m.status).toBe(409);
    expect((await m.json()).missing).toEqual([sha(b)]);
  });

  // LOW-1 (owner decision 2026-10-02, verify-k): a manifest re-POST this namespace ALREADY HOLDS
  // must be free, exactly like a blob re-upload already is (A 1f) — the up-front preflight used to
  // always pass `sha:null` (the real sha was unknown before the body was read), so it could never
  // apply the held-sha exemption and charged the identical body as new EVERY time.
  it('an identical manifest re-POST at the quota edge is free (held-sha exemption), not refused 507', async () => {
    // EVE (own principal, untouched by any other test's usage assertions) uploads a 600 B blob,
    // leaving 400 B of headroom to the 1000 B limit. This manifest body is exactly 350 B — fits once
    // (950 <= 1000) but NOT twice if charged again as new (1300 > 1000), which is exactly the bug: a
    // naive re-charge of an already-held sha.
    const a = blob(600, 'a');
    expect((await post(`/assets/blob/${sha(a)}`, a, EVE)).status).toBe(200);
    const path = 'p'.repeat(261);
    const manifest = JSON.stringify([{ path, sha256: sha(a) }]);
    expect(manifest.length).toBe(350);
    const first = await post('/assets/manifest', manifest, EVE);
    const firstBody = await first.json();
    expect(first.status, JSON.stringify(firstBody)).toBe(200);
    const second = await post('/assets/manifest', manifest, EVE);
    const secondBody = await second.json();
    expect(second.status, JSON.stringify(secondBody)).toBe(200);
    expect(secondBody.seedManifestRef).toBe(firstBody.seedManifestRef);
  });

  it('a chunked body that never declared its size is cut off mid-stream with 507 QUOTA_EXCEEDED', async () => {
    const big = blob(4000, 'c');
    const stream = new ReadableStream<Uint8Array>({
      start(ctl) { for (let i = 0; i < big.length; i += 500) ctl.enqueue(new Uint8Array(big.subarray(i, i + 500))); ctl.close(); },
    });
    const r = await post(`/assets/blob/${sha(big)}`, stream, BOB);
    expect(r.status).toBe(507);
    expect((await r.json()).code).toBe('QUOTA_EXCEEDED');
    const d = await tool('workspace_diff', { manifest: [{ sha256: sha(big) }] }, BOB);
    expect(d.result.missing).toEqual([sha(big)]);
  });

  it('two concurrent uploads that each fit alone cannot jointly exceed the limit', async () => {
    const x = blob(600, 'x'); const y = blob(600, 'y');
    const [rx, ry] = await Promise.all([post(`/assets/blob/${sha(x)}`, x, CAROL), post(`/assets/blob/${sha(y)}`, y, CAROL)]);
    expect([rx.status, ry.status].sort()).toEqual([200, 507]);
    const d = await tool('workspace_diff', { manifest: [] }, CAROL);
    expect(d.result.quota).toMatchObject({ usedBytes: 600, limitBytes: 1000, source: 'role-default' });
  });

  it('manifest bytes count too: a manifest that would exceed the quota is refused 507', async () => {
    const f = blob(990, 'f');
    expect((await post(`/assets/blob/${sha(f)}`, f, DAVE)).status).toBe(200);
    const manifest = JSON.stringify([{ path: 'some/fairly/long/path/to/push/us/over.txt', sha256: sha(f) }]);
    const r = await post('/assets/manifest', manifest, DAVE);
    expect(r.status).toBe(507);
    expect((await r.json()).code).toBe('QUOTA_EXCEEDED');
  });

  it('workspace_push (cas mode) refuses QUOTA_EXCEEDED with the same detail', async () => {
    const z = blob(600, 'z');
    const r = await tool('workspace_push', { sha256: sha(z), contentB64: z.toString('base64') }, BOB);
    expect(codeOf(r)).toBe('QUOTA_EXCEEDED');
    expect(r.error.detail).toMatchObject({ usedBytes: 600, limitBytes: 1000, requestedBytes: 600 });
  });

  // LOW-5 (owner decision 2026-10-02, verify-k): the auth-gated manifest route's own `putBlob`
  // failure handler must mirror the no-identity fallback route — only QUOTA_EXCEEDED/DISK_LOW get the
  // caller-facing (static, catalog-shaped) body; anything else (a raw fs error, which can carry a
  // blob path) stays a generic 500 and never echoes `err.message`. Forced here with a REAL fs error:
  // the manifest's own content-addressed 2-hex-prefix directory is pre-created as a FILE, so
  // CasStore's `mkdirSync(dirname(blobPath), {recursive:true})` throws ENOTDIR.
  it("a non-quota putBlob failure on the auth-gated manifest route answers a generic 500, never raw err.message", async () => {
    const prefix = 'ff'; // must be valid lowercase hex — sha256 hexdigest never contains non-hex chars
    const blobsDir = join(dir, 'cas', 'blobs');
    mkdirSync(blobsDir, { recursive: true });
    writeFileSync(join(blobsDir, prefix), ''); // a FILE where CasStore expects to mkdir a directory
    let body = '';
    for (let i = 0; i < 100_000; i += 1) {
      const candidate = `[]${' '.repeat(i)}`; // valid JSON (trailing whitespace); varies the hash
      if (sha(candidate).startsWith(prefix)) { body = candidate; break; }
    }
    expect(body).not.toBe('');
    const r = await post('/assets/manifest', body, ROOT); // admin: unlimited quota, no DISK_LOW
    const json = await r.json();
    expect(r.status, JSON.stringify(json)).toBe(500);
    expect(json).toEqual({ error: 'manifest register error' });
    expect(JSON.stringify(json)).not.toMatch(/ENOTDIR|ENOENT|EACCES|blobs/);
  });
});

describe('admin quota surface', () => {
  it('principals_list shows usage; principal_set_quota raises the limit and the next upload succeeds; null clears it', async () => {
    const listed = await tool('principals_list', {}, ROOT);
    const bob = listed.result.principals.find((p: { id: string }) => p.id === BOB);
    expect(bob.quota).toEqual({ usedBytes: 600, limitBytes: 1000, source: 'role-default' });
    expect(codeOf(await tool('principal_set_quota', { id: BOB, limit: '1MiB' }, BOB))).toBe('FORBIDDEN_ROLE');
    const set = await tool('principal_set_quota', { id: BOB, limit: '1MiB' }, ROOT);
    expect(set.result.quota).toMatchObject({ limitBytes: 1024 * 1024, source: 'override', updatedBy: ROOT });
    const b = blob(500, 'b');
    expect((await post(`/assets/blob/${sha(b)}`, b, BOB)).status).toBe(200);
    expect((await tool('principal_set_quota', { id: BOB, limit: null }, ROOT)).result.quota).toEqual({ usedBytes: 1100, limitBytes: 1000, source: 'role-default' });
  });

  it('dashboard: POST /api/principals/quota needs a same-origin header; GET /api/me shows the caller its own quota', async () => {
    const { cookie } = await dashboardLogin(base, ROOT);
    const noCsrf = await fetch(`${base}/api/principals/quota`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: CAROL, limit: 2000 }) });
    expect(noCsrf.status).toBe(403);
    expect((await noCsrf.json()).code).toBe('CSRF_REFUSED');
    const ok = await fetch(`${base}/api/principals/quota`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Requested-With': 'rwe-dashboard' }, body: JSON.stringify({ id: CAROL, limit: 2000 }) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).quota).toMatchObject({ limitBytes: 2000, source: 'override' });
    const bad = await fetch(`${base}/api/principals/quota`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Requested-With': 'rwe-dashboard' }, body: JSON.stringify({ id: CAROL, limit: 'heaps' }) });
    expect(bad.status).toBe(400);
    const carol = await dashboardLogin(base, CAROL);
    const me = await (await fetch(`${base}/api/me`, { headers: { Cookie: carol.cookie } })).json();
    expect(me).toMatchObject({ authEnabled: true, id: CAROL, role: 'user', quota: { usedBytes: 600, limitBytes: 2000, source: 'override' } });
    const forbidden = await fetch(`${base}/api/principals/quota`, { method: 'POST', headers: { Cookie: carol.cookie, 'Content-Type': 'application/json', 'X-Requested-With': 'rwe-dashboard' }, body: JSON.stringify({ id: CAROL, limit: null }) });
    expect(forbidden.status).toBe(403);
  });
});

describe('workspace_prune_blobs', () => {
  const backdate = (): void => {
    const db = new Database(join(dir, 'cas', 'refs.db'));
    db.prepare('UPDATE refs SET last_used_at = 0').run();
    db.close();
  };

  it("lists then frees the caller's unrooted refs, never a registered version's seed manifest or its blobs", async () => {
    const input = blob(300, 'i'); const junk = blob(400, 'j');
    for (const b of [input, junk]) expect((await post(`/assets/blob/${sha(b)}`, b, ALICE)).status).toBe(200);
    const m = await post('/assets/manifest', JSON.stringify([{ path: 'data/input.txt', sha256: sha(input) }]), ALICE);
    const ref = (await m.json()).seedManifestRef as string;
    await registerPublishedVia(async (t, a) => tool(t, t === 'workflow_register' ? { ...a, seedManifestRef: ref } : a, ALICE), 'quota-seeded', 'return 1');
    backdate();

    const dry = await tool('workspace_prune_blobs', {}, ALICE);
    expect(dry.status).toBe('completed');
    expect(dry.result).toMatchObject({ namespace: ALICE, dryRun: true, olderThanDays: 30, freedBytes: 400, blobFilesDeleted: 0 });
    expect(dry.result.refs.map((r: { sha256: string }) => r.sha256)).toEqual([sha(junk)]);
    expect((await tool('workspace_diff', { manifest: [{ sha256: sha(junk) }] }, ALICE)).result.missing).toEqual([]);

    backdate(); // the diff above counted as a use
    const real = await tool('workspace_prune_blobs', { dryRun: false }, ALICE);
    expect(real.result).toMatchObject({ dryRun: false, freedBytes: 400, blobFilesDeleted: 1 });
    expect((await tool('workspace_diff', { manifest: [{ sha256: sha(junk) }, { sha256: sha(input) }, { sha256: ref }] }, ALICE)).result.missing).toEqual([sha(junk)]);
    // The version still runs with its default seed.
    const run = await tool('run_start', { name: 'quota-seeded' }, ALICE);
    expect(run.status, JSON.stringify(run)).not.toBe('failed');
  }, 20_000);

  it('another namespace is admin-only', async () => {
    expect(codeOf(await tool('workspace_prune_blobs', { namespace: ALICE }, BOB))).toBe('FORBIDDEN_ROLE');
    const r = await tool('workspace_prune_blobs', { namespace: BOB }, ROOT);
    expect(r.result).toMatchObject({ namespace: BOB, dryRun: true });
  });
});

describe('disk floor', () => {
  let low: Server; let lowDir: string; let lowBase: string;
  const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, any>> => {
    const res = await fetch(`${lowBase}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    const b = await res.json() as { result?: { content?: Array<{ text?: string }> } };
    return JSON.parse(b.result?.content?.[0]?.text ?? '{}');
  };
  beforeAll(async () => {
    lowDir = mkdtempSync(join(tmpdir(), 'rwe-disklow-'));
    // A floor no real filesystem can satisfy (1 EiB).
    low = await createServer({ port: 0, bind: '127.0.0.1', workRoot: lowDir, diskFloor: { percent: 0, bytes: 2 ** 60 } } as never);
    lowBase = `http://127.0.0.1:${low.port}`;
  });
  afterAll(async () => { await low?.close(); rmSync(lowDir, { recursive: true, force: true }); });

  it('uploads answer 503 DISK_LOW {freeBytes, floorBytes}; workspace_push refuses DISK_LOW', async () => {
    const b = blob(10, 'd');
    const r = await fetch(`${lowBase}/assets/blob/${sha(b)}`, { method: 'POST', body: b });
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body).toMatchObject({ code: 'DISK_LOW', floorBytes: 2 ** 60 });
    expect(typeof body.freeBytes).toBe('number');
    const m = await fetch(`${lowBase}/assets/manifest`, { method: 'POST', body: '[]' });
    expect(m.status).toBe(503);
    expect(codeOf(await call('workspace_push', { sha256: sha(b), contentB64: b.toString('base64') }))).toBe('DISK_LOW');
  });

  it('run_start is refused DISK_LOW; a webhook delivery answers 503 {code: DISK_LOW} and its delivery id is released', async () => {
    const w = await call('webhook_create', {});
    const webhookId = (w['result']?.webhookId ?? w['webhookId']) as string;
    const secret = (w['result']?.secret ?? w['secret']) as string;
    await registerPublishedVia(call, 'disk-low', 'return 1', { triggers: [webhookId] });
    expect(codeOf(await call('run_start', { name: 'disk-low' }))).toBe('DISK_LOW');
    const deliver = () => {
      const body = '{}';
      return fetch(`${lowBase}/hooks/${webhookId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-rwe-signature': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'), 'x-rwe-timestamp': new Date().toISOString(), 'x-rwe-delivery': 'disk-low-1' }, body });
    };
    for (let i = 0; i < 2; i++) {
      const r = await deliver();
      expect(r.status).toBe(503);
      expect((await r.json()).code).toBe('DISK_LOW');
    }
  }, 20_000);
});
