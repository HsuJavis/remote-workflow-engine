// IT-076 (DES-086, DES-087, ARCH-054, ARCH-055, TASK-080, TASK-081):
// Real server HTTP tests for POST /assets/blob/:sha and POST /assets/manifest.
//
// Cases:
//   1. Foreign Host header on /assets/blob → 403 (net-guard placement — both new routes behind guard)
//   2. Foreign Host header on /assets/manifest → 403
//   3. Happy blob upload: POST /assets/blob/:sha → 200 {sha256, bytes, namespace}
//   4. Tampered sha → 409 BLOB_SHA_MISMATCH (correct sha in path, wrong bytes in body)
//   5. Bad hex sha in URL path → 400 INVALID_BLOB_REQUEST (validators fire before fd)
//   6. Manifest register: upload blobs + POST /assets/manifest → 200 {seedManifestRef, namespace}
//   7. Manifest register referencing an absent blob → MISSING_BLOBS (listing the absent shas)
//   8. Manifest with invalid JSON body → INVALID_SEED_SPEC
//
// v24 (DES-142, ADR-028): `?namespace=` on BOTH routes is RETIRED — a caller-supplied one is now
// refused `400 INVALID_BLOB_REQUEST` (server.ts:930/957/1141/1168) rather than honoured, because the
// namespace is derived from the caller's OWN identity. This server boots auth-disabled, so the
// derived namespace is the `'local'` sentinel (`nsOf`, mcp-facade.ts:46; server.ts:1145/1172 spell
// the same value on the unauthenticated route). Every URL below therefore drops the query param and
// `NAMESPACE` becomes the DERIVED value the response must echo — same oracles (the response names
// the namespace the bytes landed in; a manifest is scoped to one namespace), new spelling. The old
// per-call caller-chosen namespace (`'ns-missing'`) has no v24 equivalent: case 7's oracle is "a sha
// nobody uploaded is reported missing", which the never-uploaded `'d'*64` still supplies.
//
// Mock policy (integration — DES-091): real `createServer` + real HTTP + real CasStore + real
//   net-guard (isAllowedHost / isAllowedOrigin). No LLM/gateway mock needed.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

/** Node's fetch (undici) forbids overriding the `Host` header (forbidden per Fetch spec), so
 *  foreign-Host tests need a raw node:http request. Same pattern as host-origin-allowlist-http.test.ts.
 *  Returns just the status code (sufficient for 403 assertions). */
function rawPost(
  port: number,
  path: string,
  headers: Record<string, string>,
  body: Buffer,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(body.length) },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

let server: Server;
let workRoot: string;

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-it076-'));
  server = await createServer({ workRoot });
});
afterAll(async () => {
  await server?.close?.();
  rmSync(workRoot, { recursive: true, force: true });
});

/** The namespace this auth-disabled server DERIVES for every caller (ADR-028) — not a value the
 *  test chooses any more. Asserted, not configured. */
const NAMESPACE = 'local';

function blobUrl(sha: string): string {
  return `http://127.0.0.1:${server.port}/assets/blob/${sha}`;
}

function manifestUrl(): string {
  return `http://127.0.0.1:${server.port}/assets/manifest`;
}

describe('/assets/blob net-guard (DES-086 BE placement)', () => {
  it('foreign Host header on /assets/blob → 403 (net-guard placement)', async () => {
    const data = Buffer.from('test data');
    const h = sha256(data);
    // fetch/undici silently drops the Host header — use raw node:http to deliver it to the server.
    const status = await rawPost(
      server.port,
      `/assets/blob/${h}`,
      { Host: 'evil.attacker.com:9999', 'Content-Type': 'application/octet-stream' },
      data,
    );
    expect(status).toBe(403);
  });

  it('foreign Host header on /assets/manifest → 403 (net-guard placement)', async () => {
    const body = Buffer.from(JSON.stringify([{ path: 'f.txt', sha256: 'a'.repeat(64) }]));
    // fetch/undici silently drops the Host header — use raw node:http to deliver it to the server.
    const status = await rawPost(
      server.port,
      `/assets/manifest`,
      { Host: 'evil.attacker.com:9999', 'Content-Type': 'application/json' },
      body,
    );
    expect(status).toBe(403);
  });
});

describe('/assets/blob happy path and errors (DES-086)', () => {
  it('happy upload: POST /assets/blob/:sha returns 200 {sha256, bytes, namespace}', async () => {
    const data = Buffer.from('hello blob stream it076');
    const h = sha256(data);
    const res = await fetch(blobUrl(h), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { sha256: string; bytes: number; namespace: string };
    expect(body.sha256).toBe(h);
    expect(body.bytes).toBe(data.length);
    expect(body.namespace).toBe(NAMESPACE);
  });

  it('tampered sha in path (wrong sha, correct bytes) → 409 BLOB_SHA_MISMATCH', async () => {
    const data = Buffer.from('real content for it076');
    const wrongSha = sha256(Buffer.from('different content for it076'));
    const res = await fetch(blobUrl(wrongSha), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    });
    // DES-086 pins 409 for BLOB_SHA_MISMATCH
    expect(res.status).toBe(409);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('BLOB_SHA_MISMATCH');
  });

  it('invalid sha in URL path (non-hex / short) → 400 INVALID_BLOB_REQUEST', async () => {
    const res = await fetch(blobUrl('not-a-hex-sha'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from('anything'),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('INVALID_BLOB_REQUEST');
  });

  // v24 (DES-142, ADR-028): the replacement for the retired caller-chosen-namespace cases — the
  // parameter is not ignored, it is REFUSED, so a pre-v24 client that still sends it learns why
  // instead of silently writing into somebody else's derived pool.
  it('a caller-supplied ?namespace= is refused 400 INVALID_BLOB_REQUEST (retired v24)', async () => {
    const data = Buffer.from('namespace-is-derived-now it076');
    const h = sha256(data);
    for (const url of [`${blobUrl(h)}?namespace=it076ns`, `${manifestUrl()}?namespace=it076ns`]) {
      const res = await fetch(url, { method: 'POST', body: data });
      expect(res.status).toBe(400);
      const body = await res.json() as { code?: string; message?: string };
      expect(body.code).toBe('INVALID_BLOB_REQUEST');
      expect(body.message).toContain('namespace');
    }
  });

  it('upload is idempotent: re-uploading same blob → 200 again', async () => {
    const data = Buffer.from('idempotent blob it076');
    const h = sha256(data);
    // First upload
    await fetch(blobUrl(h), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    });
    // Second upload (re-upload)
    const res = await fetch(blobUrl(h), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    });
    expect(res.status).toBe(200);
  });
});

describe('/assets/manifest register (DES-087)', () => {
  it('upload blob then register manifest → 200 {seedManifestRef, namespace}', async () => {
    // Upload the blob first
    const fileContent = Buffer.from('manifest target file it076');
    const fileSha = sha256(fileContent);
    const blobRes = await fetch(blobUrl(fileSha), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: fileContent,
    });
    expect(blobRes.status).toBe(200);

    // Register manifest
    const manifest = [{ path: 'file.txt', sha256: fileSha }];
    const mRes = await fetch(manifestUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    });
    expect(mRes.status).toBe(200);
    const mBody = await mRes.json() as { seedManifestRef?: string; namespace?: string };
    expect(typeof mBody.seedManifestRef).toBe('string');
    expect(mBody.seedManifestRef).toHaveLength(64); // sha256 hex
    expect(mBody.namespace).toBe(NAMESPACE);

    // Verify: seedManifestRef should equal sha256 of manifest bytes (client-derivable)
    const expectedRef = sha256(Buffer.from(JSON.stringify(manifest), 'utf8'));
    expect(mBody.seedManifestRef).toBe(expectedRef);
  });

  it('manifest referencing an absent blob → MISSING_BLOBS (listing absent shas)', async () => {
    const absentSha = 'd'.repeat(64);
    const manifest = [{ path: 'missing.txt', sha256: absentSha }];
    const res = await fetch(manifestUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    });
    // Should be 400/422/409 — design says MISSING_BLOBS
    expect([400, 409, 422]).toContain(res.status);
    const body = await res.json() as { code?: string; missing?: string[] };
    expect(body.code).toBe('MISSING_BLOBS');
    expect(Array.isArray(body.missing)).toBe(true);
    expect(body.missing).toContain(absentSha);
  });

  it('manifest with invalid JSON body → INVALID_SEED_SPEC', async () => {
    const res = await fetch(manifestUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json at all',
    });
    expect([400, 422]).toContain(res.status);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('INVALID_SEED_SPEC');
  });
});
