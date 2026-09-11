// IT-170 (DES-198, DES-199, ARCH-130/123, TASK-203, REQ-131/140): `GET /static/dashboard/<key>`
// registered BEFORE the `/dashboard` SPA catch-all — route ORDER is a correctness condition, not a
// style choice (an asset registered after the catch-all returns the HTML page with a 200 and the
// browser silently renders nothing).
//
// Mock policy (integration): real createServer() + real HTTP.
//
// Red reason (measured): the `/static/dashboard/*` arm does not exist at all — every request under
// that prefix falls through to the `/dashboard` SPA catch-all today (`server.ts:1251`,
// `req.url?.startsWith('/dashboard/')`... but `/static/dashboard/*` does not match that prefix, so
// it instead falls through further to the final 404/JSON-RPC dispatch) — every assertion below
// expects a real asset response and gets a 404 or an HTML/JSON-RPC body instead.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('GET /static/dashboard/<key> (IT-170, DES-198)', () => {
  it('a known JS key answers text/javascript + no-store (NOT the SPA\'s text/html — proves route ORDER)', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/static/dashboard/ui/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('a woff2 key answers font/woff2 + immutable', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/static/dashboard/fonts/archivo-400.woff2`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('font/woff2');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('every traversal string in the table answers 404 with NO echo of the key', async () => {
    for (const bad of TRAVERSAL_TABLE) {
      const res = await fetch(`http://127.0.0.1:${server.port}/static/dashboard/${bad}`);
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).not.toContain(bad);
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
