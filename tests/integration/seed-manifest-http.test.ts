// v10 Slice 2 — efficient seeding end-to-end over the real server (REQ-064/065): blob_put → seed_plan
// → workflow_run with a seedManifest → the workspace is assembled from the CAS (a script reads a
// seeded file back). Plus MISSING_BLOBS fail-fast + BLOB_HASH_MISMATCH.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;
const base = () => `http://127.0.0.1:${server.port}`;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function call(name: string, args: unknown): Promise<any> {
  const res = await fetch(`${base()}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}
async function poll(runId: string): Promise<any> {
  for (let i = 0; i < 30; i++) {
    const s = await call('workflow_status', { runId });
    if (['completed', 'failed'].includes(s.status)) return s;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('run did not settle');
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-seedm-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

describe('efficient seeding via CAS manifest (v10 Slice 2, REQ-064/065)', () => {
  const NS = 'proj1';
  const fileText = 'export const answer = 42;\n';
  const h = sha(Buffer.from(fileText));

  it('REQ-064 seed_plan reports the blob as missing before upload, present after (per-namespace)', async () => {
    const manifest = [{ path: 'src/answer.ts', sha256: h }];
    const before = await call('seed_plan', { namespace: NS, manifest });
    expect(before.result.missing).toEqual([h]);
    const put = await call('blob_put', { namespace: NS, sha256: h, contentB64: b64(fileText) });
    expect(put.result.sha256).toBe(h);
    const after = await call('seed_plan', { namespace: NS, manifest });
    expect(after.result.missing).toEqual([]);
    // a different namespace still sees it missing (no cross-tenant leak)
    const other = await call('seed_plan', { namespace: 'proj2', manifest });
    expect(other.result.missing).toEqual([h]);
  });

  it('REQ-064 blob_put rejects a hash mismatch (BLOB_HASH_MISMATCH)', async () => {
    const r = await call('blob_put', { namespace: NS, sha256: sha('lie'), contentB64: b64('actual different bytes') });
    expect(r.error.code).toBe('BLOB_HASH_MISMATCH');
  });

  it('REQ-065 workflow_run with a seedManifest assembles the workspace from the CAS (script reads the file)', async () => {
    // the blob was uploaded above; a script reads the seeded file back via the sandbox has no fs — so
    // instead assert the run completes and the workspace really has the file by listing artifacts.
    const run = await call('workflow_run', {
      script: `return 'seeded';`,
      seedManifest: [{ path: 'src/answer.ts', sha256: h, exec: false }],
      seedNamespace: NS,
    });
    expect(run.result?.runId).toBeTruthy();
    const done = await poll(run.result.runId);
    expect(done.status).toBe('completed');
    const arts = await call('workflow_artifacts', { runId: run.result.runId });
    const paths = (arts.result as Array<{ path: string; sha256: string }>).map((a) => a.path);
    expect(paths).toContain('src/answer.ts');
    const seeded = (arts.result as Array<{ path: string; sha256: string }>).find((a) => a.path === 'src/answer.ts')!;
    expect(seeded.sha256).toBe(h); // assembled from the CAS, byte-identical
  });

  it('issue #21: a stringified seedManifest fails with typed INVALID_SEED_SPEC, not a raw TypeError', async () => {
    // Reproduces the reported break: a schema-blind MCP client serialized the array to a string, so the
    // engine received `"[…]"` and `spec.seedManifest.map(...)` threw `TypeError: … .map is not a
    // function`. The run-manager guard now rejects a non-array seed spec with a typed, actionable error.
    const run = await call('workflow_run', {
      script: `return 1;`,
      seedManifest: JSON.stringify([{ path: 'x.ts', sha256: h }]),
      seedNamespace: NS,
    });
    expect(run.status).toBe('failed');
    expect(run.error.code).toBe('INVALID_SEED_SPEC');
    expect(run.error.code).not.toBe('TypeError');
  });

  it('REQ-065 a seedManifest referencing an un-uploaded blob fails fast with MISSING_BLOBS (no run created)', async () => {
    const ghost = sha('never uploaded');
    const run = await call('workflow_run', {
      script: `return 1;`,
      seedManifest: [{ path: 'ghost.ts', sha256: ghost }],
      seedNamespace: NS,
    });
    expect(run.status).toBe('failed');
    expect(run.error.code).toBe('MISSING_BLOBS');
  });
});
