// IT-108 (DES-142, v24): namespace removal — run_start.seedNamespace dropped (closed schema =>
// INVALID_ARGUMENT), ?namespace= dropped on POST /assets/blob/:sha and POST /assets/manifest
// (=> 400 INVALID_BLOB_REQUEST naming the change); nsOf(principal) is the only namespace
// expression, derived from the principal, never a caller-supplied arg. Written test-first
// (Gate 5, RED) against the REAL booted engine.
// Mock policy: real HTTP MCP server + real CAS HTTP routes — no mock of the SUT boundary.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

describe('namespace derivation from principal, caller-supplied namespace refused (IT-108, DES-142)', () => {
  let server: Server;

  beforeEach(async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1' });
  });

  afterEach(async () => {
    await server?.close();
  });

  it('run_start with a seedNamespace arg is refused INVALID_ARGUMENT (closed schema)', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'run_start', arguments: { name: 'wf', seedNamespace: 'attacker' } },
      }),
    });
    const body = (await res.json()) as { code?: string; result?: { error?: { code?: string } }; error?: { code?: string } };
    expect(body.result?.error?.code ?? body.error?.code).toBe('INVALID_ARGUMENT');
  });

  it('POST /assets/blob/:sha with ?namespace= is refused 400 INVALID_BLOB_REQUEST', async () => {
    // A VALID-format sha256 of the body ('x') so the only possible refusal reason is the
    // dropped ?namespace= param, never the pre-existing "invalid sha256 hex" branch (a fixture
    // using a malformed hash like 'deadbeef' would false-green on that unrelated check).
    const validSha = '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881'.slice(0, 64);
    const res = await fetch(`http://127.0.0.1:${server.port}/assets/blob/${validSha}?namespace=attacker`, {
      method: 'POST',
      body: Buffer.from('x'),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string; result?: { error?: { code?: string } }; error?: { code?: string } };
    expect(body.code).toBe('INVALID_BLOB_REQUEST');
  });

  it('POST /assets/manifest with ?namespace= is refused 400 INVALID_BLOB_REQUEST', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/assets/manifest?namespace=attacker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shas: [] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string; result?: { error?: { code?: string } }; error?: { code?: string } };
    expect(body.code).toBe('INVALID_BLOB_REQUEST');
  });
});
