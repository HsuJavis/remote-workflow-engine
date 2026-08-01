// v10 Slice 1 — compressed request bodies + a typed too-large error (REQ-063). TEST-FIRST (RED).
// A gzipped /mcp body is decoded before parse (so a big seed fits under the wire cap); an over-cap
// body (compressed or decompressed) returns a typed BODY_TOO_LARGE 413; a gzip bomb is rejected, not
// OOM'd. Real createServer; raw node:http so we control Content-Encoding + send exact bytes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

/** Raw POST returning {status, json}. `encoding` sets Content-Encoding + sends `body` bytes as-is. */
function rawPost(path: string, body: Buffer, headers: Record<string, string>): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.port, path, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => { const t = Buffer.concat(chunks).toString('utf8'); let j: any; try { j = JSON.parse(t); } catch { j = t; } resolve({ status: res.statusCode ?? 0, json: j }); });
    });
    req.on('error', reject);
    req.end(body);
  });
}

const TOOLS_LIST = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }), 'utf8');

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-gz-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

describe('compressed request body + typed too-large (v10 Slice 1, REQ-063)', () => {
  it('decodes a gzip Content-Encoding /mcp body and processes it', async () => {
    const gz = gzipSync(TOOLS_LIST);
    const { status, json } = await rawPost('/mcp', gz, { 'Content-Encoding': 'gzip' });
    expect(status).toBe(200);
    expect(Array.isArray(json.result?.tools)).toBe(true); // decoded → real tools/list result
  });

  it('an uncompressed over-cap body returns a TYPED BODY_TOO_LARGE 413 (with a hint), not a raw error', async () => {
    const huge = Buffer.alloc(9 * 1024 * 1024, 0x20); // 9 MiB of spaces > 8 MiB cap
    const { status, json } = await rawPost('/mcp', huge, {});
    expect(status).toBe(413);
    expect(json.error?.code).toBe('BODY_TOO_LARGE');
    expect(typeof json.error?.cap).toBe('number');
    expect(typeof json.error?.hint).toBe('string'); // actionable next step, not opaque
  });

  it('a gzip bomb (tiny compressed, huge decompressed) is rejected 413, server survives', async () => {
    const bomb = gzipSync(Buffer.alloc(200 * 1024 * 1024, 0x20)); // ~200 MiB → a few hundred KB gzipped
    expect(bomb.length).toBeLessThan(1024 * 1024); // genuinely tiny compressed
    const { status, json } = await rawPost('/mcp', bomb, { 'Content-Encoding': 'gzip' });
    expect(status).toBe(413);
    expect(json.error?.code).toBe('BODY_TOO_LARGE');
    // server still alive after the bomb:
    const after = await rawPost('/mcp', gzipSync(TOOLS_LIST), { 'Content-Encoding': 'gzip' });
    expect(after.status).toBe(200);
  });

  it('a normal uncompressed body still works unchanged', async () => {
    const { status, json } = await rawPost('/mcp', TOOLS_LIST, {});
    expect(status).toBe(200);
    expect(Array.isArray(json.result?.tools)).toBe(true);
  });
});
