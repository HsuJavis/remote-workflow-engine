// IT-170 (DES-198, DES-199, ARCH-130/123, TASK-203, REQ-131/140): `GET /static/dashboard/<key>`
// registered BEFORE the `/dashboard` SPA catch-all — route ORDER is a correctness condition, not a
// style choice (an asset registered after the catch-all returns the HTML page with a 200 and the
// browser silently renders nothing).
//
// Mock policy (integration): real createServer() + real HTTP.
//
// Red reason (measured, original test-first pass): the `/static/dashboard/*` arm did not exist at
// all — every request under that prefix fell through to the `/dashboard` SPA catch-all
// (`req.url?.startsWith('/dashboard/')` never matches `/static/dashboard/*`), so every assertion
// below expected a real asset response and got a 404 or an HTML/JSON-RPC body instead. TASK-203/204
// landed the route (server.ts) and the allowlist (src/static-assets.ts) at Gate 6.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it170-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const TRAVERSAL_TABLE = ['../../etc/passwd', '%2e%2e%2f', 'ui/../lib/theme.js', 'ui/app.js%00.png', '//etc/passwd'];

// [v27 Gate 5 defect-queue item (6), fixed 2026-09-12] `fetch()` parses the target through the
// WHATWG URL parser, which collapses `../` dot-segments CLIENT-SIDE before the request line is ever
// built — `ui/../lib/theme.js` resolves to the already-legitimate `lib/theme.js` before it leaves
// the client, so a table run through `fetch()` can never prove the SERVER itself refuses a raw
// traversal string (measured: `fetch()` returned 200 for that one entry, not because the server
// normalizes anything, but because the client already had). `rawGet` bypasses that: `http.request`'s
// `path` option puts the exact string on the wire unnormalized (verified empirically against a
// throwaway echo server: `req.url` on the server side is byte-identical to `path`), so this actually
// exercises `lookupStaticAsset`'s bare `Map.get` over the fixed allowlist (src/static-assets.ts) —
// the property the case claims to test.
function rawGet(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, path, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('GET /static/dashboard/<key> (IT-170, DES-198)', () => {
  it('a known JS key answers text/javascript + no-store (NOT the SPA\'s text/html — proves route ORDER)', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/static/dashboard/ui/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  // [v27c AC-8 Gate 8 repair] the exact header value (ARCH-123's api), not just a substring
  // containing `immutable` — a bare `Cache-Control: immutable` would still pass `.toContain`.
  it('a woff2 key answers font/woff2 + a year-long public immutable cache', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/static/dashboard/fonts/archivo-400.woff2`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('font/woff2');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('every traversal string in the table answers 404 with NO echo of the key', async () => {
    for (const bad of TRAVERSAL_TABLE) {
      const { status, body } = await rawGet(`/static/dashboard/${bad}`);
      expect(status).toBe(404);
      expect(body).not.toContain(bad);
    }
  });

  it('a non-GET (POST) answers 405', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/static/dashboard/ui/app.js`, { method: 'POST' });
    expect(res.status).toBe(405);
  });

  it('an unknown key under the prefix answers 404', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/static/dashboard/no-such-file.js`);
    expect(res.status).toBe(404);
  });
});
