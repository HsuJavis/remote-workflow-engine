// v8 Defer B (REQ-056): the Host/Origin allowlist is enforced on the real HTTP server.
// Real createServer; asserts a foreign Host / drive-by Origin → 403, and that a normal loopback
// request (no Origin, Host=127.0.0.1:port — exactly what fetch + every MCP client sends) still works.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

/** Node's fetch (undici) forbids overriding the `Host` header, so a foreign-Host test needs a raw
 *  node:http request (which lets us set an arbitrary Host). Returns the status code. */
function rawGet(port: number, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-allowlist-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});
afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('Host/Origin allowlist on the real server (v8 Defer B, REQ-056)', () => {
  it('a normal loopback request (fetch default Host, no Origin) still works', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/runs`);
    expect(res.status).toBe(200); // the legitimate path must NOT be broken
  });

  it('rejects a foreign Host header (DNS-rebinding) with 403', async () => {
    // raw node:http — fetch/undici forbids overriding Host, so it can't exercise this path.
    const status = await rawGet(server.port, '/api/runs', { Host: 'evil.example.com' });
    expect(status).toBe(403);
  });

  it('a normal raw request with the loopback Host still works (sanity for the raw harness)', async () => {
    const status = await rawGet(server.port, '/api/runs', { Host: `127.0.0.1:${server.port}` });
    expect(status).toBe(200);
  });

  it('ALLOWS an MCP client Origin on /mcp — the Origin/CSRF check is exempted there (issue #14)', async () => {
    // MCP Streamable-HTTP clients (Claude Code) send an Origin identifying the client app (e.g.
    // `app://claude`), never a loopback URL. A uniform Origin floor 403'd those legitimate clients and
    // degraded them into an auth-required state. Host stays the rebind guard; Origin is exempt on /mcp.
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'app://claude' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(200);
  });

  it('STILL rejects a drive-by browser Origin (CSRF) on a browser route (/api/runs)', async () => {
    // The Origin/CSRF floor is retained for browser-facing routes — only /mcp (JSON-RPC) is exempt.
    const status = await rawGet(server.port, '/api/runs', { Host: `127.0.0.1:${server.port}`, Origin: 'http://evil.example.com' });
    expect(status).toBe(403);
  });

  it('allows a loopback Origin at the server port', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${server.port}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(200);
  });
});
