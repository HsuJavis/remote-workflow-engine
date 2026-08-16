// VAL-091 (REQ-082, DES-087, DES-091): server-side seed manifest ref acceptance test.
// Binds the REQ-082 acceptance clauses against the REAL engine.
//
// REQ-082 acceptance clauses:
//   1. Upload blobs, register manifest via POST /assets/manifest, then workflow_run({seedManifestRef,
//      seedNamespace}) with a few-dozen-byte params produces a workspace byte-identical to the
//      inline seedManifest path.
//   2. seedManifestRef + seed → SEED_SOURCE_CONFLICT
//   3. seedManifestRef + seedManifest → SEED_SOURCE_CONFLICT
//   4. seedManifestRef alone referencing a missing blob → MISSING_BLOBS
//   5. seedManifestRef alone with unparseable manifest blob → INVALID_SEED_SPEC
//   6. seedManifestRef = sha256(manifestBytes) is derivable client-side (consumability)
//
// Red reason: POST /assets/manifest does not exist; RunManager.start() has no seedManifestRef
//   field → workflow_run ignores seedManifestRef → no workspace assembled / no SEED_SOURCE_CONFLICT
//   returned → all assertions fail for the correct unimplemented reason.
//
// Mock policy (acceptance — MUST NOT mock SUT boundaries): real createServer, real HTTP;
//   real CasStore, real materializeManifest path (not mocked).
// Note: real:false — set to true by Gate 7.5 validator.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const NAMESPACE = 'val091ns';

let server: Server;
let workRoot: string;

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

async function poll(runId: string, ms = 200, maxIter = 60): Promise<any> {
  for (let i = 0; i < maxIter; i++) {
    const st = await mcpCall('workflow_status', { runId });
    if (['completed', 'failed', 'stopped'].includes(st.status)) return st;
    await new Promise((r) => setTimeout(r, ms));
  }
  throw new Error('run did not settle');
}

function blobUrl(sha: string, ns = NAMESPACE): string {
  return `http://127.0.0.1:${server.port}/assets/blob/${sha}?namespace=${ns}`;
}

function manifestUrl(ns = NAMESPACE): string {
  return `http://127.0.0.1:${server.port}/assets/manifest?namespace=${ns}`;
}

/** Upload bytes, register a manifest, return the seedManifestRef. */
async function setupManifest(
  files: Array<{ path: string; content: Buffer; exec?: boolean }>,
  ns = NAMESPACE,
): Promise<string> {
  const manifestEntries: Array<{ path: string; sha256: string; exec?: boolean }> = [];
  for (const f of files) {
    const h = sha256(f.content);
    await fetch(blobUrl(h, ns), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: f.content,
    });
    manifestEntries.push({ path: f.path, sha256: h, ...(f.exec ? { exec: true } : {}) });
  }
  const manifestBody = JSON.stringify(manifestEntries);
  const mRes = await fetch(manifestUrl(ns), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: manifestBody,
  });
  const mBody = await mRes.json() as { seedManifestRef?: string };
  if (!mBody.seedManifestRef) throw new Error('manifest registration failed: ' + JSON.stringify(mBody));
  return mBody.seedManifestRef;
}

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-val091-'));
  server = await createServer({ workRoot });
});
afterAll(async () => {
  await server?.close?.();
  rmSync(workRoot, { recursive: true, force: true });
});

describe('REQ-082: seedManifestRef round-trip (VAL-091)', () => {
  it('1. workflow_run({seedManifestRef}) assembles workspace (params are few bytes)', async () => {
    const fileContent = Buffer.from('hello from val-091 seed manifest ref');
    const seedManifestRef = await setupManifest([{ path: 'hello.txt', content: fileContent }]);

    // Verify ref is client-derivable
    const manifestBytes = Buffer.from(JSON.stringify([{ path: 'hello.txt', sha256: sha256(fileContent) }]));
    expect(seedManifestRef).toBe(sha256(manifestBytes));

    // Script is minimal: vm.Script context does not support dynamic import() or process.env.
    // Workspace assembly (REQ-082 byte-identity clause) is verified via workflow_artifacts below.
    const r = await mcpCall('workflow_run', {
      script: `return 'seeded';`,
      seedManifestRef,
      seedNamespace: NAMESPACE,
    });

    expect(r.error).toBeUndefined();
    expect(r.runId).toBeDefined();
    const runId: string = r.runId;
    const status = await poll(runId);
    expect(status.status).toBe('completed');

    // Artifacts must include the seeded file with byte-identical content (REQ-082 byte-identity).
    const artifacts = await mcpCall('workflow_artifacts', { runId });
    expect(Array.isArray(artifacts.result)).toBe(true);
    const entries: Array<{ path: string; sha256: string; size: number }> = artifacts.result ?? [];
    const paths = entries.map((a) => a.path);
    expect(paths).toContain('hello.txt');
    const entry = entries.find((a) => a.path === 'hello.txt')!;
    expect(entry.sha256).toBe(sha256(fileContent)); // byte-identity: hash must match original
    expect(entry.size).toBe(fileContent.length);
  }, 30_000);

  it('2. seedManifestRef + seed → SEED_SOURCE_CONFLICT', async () => {
    const r = await mcpCall('workflow_run', {
      script: 'return 1;',
      seedManifestRef: 'a'.repeat(64),
      seedNamespace: NAMESPACE,
      seed: [{ path: 'f.txt', contentB64: Buffer.from('x').toString('base64') }],
    });
    expect(r.error?.code).toBe('SEED_SOURCE_CONFLICT');
  });

  it('3. seedManifestRef + seedManifest → SEED_SOURCE_CONFLICT', async () => {
    const r = await mcpCall('workflow_run', {
      script: 'return 1;',
      seedManifestRef: 'a'.repeat(64),
      seedNamespace: NAMESPACE,
      seedManifest: [{ path: 'f.txt', sha256: 'a'.repeat(64) }],
    });
    expect(r.error?.code).toBe('SEED_SOURCE_CONFLICT');
  });

  it('4. seedManifestRef naming a missing blob → MISSING_BLOBS', async () => {
    const r = await mcpCall('workflow_run', {
      script: 'return 1;',
      seedManifestRef: 'b'.repeat(64), // not uploaded
      seedNamespace: NAMESPACE,
    });
    expect(r.error?.code).toBe('MISSING_BLOBS');
  });

  it('5. seedManifestRef = sha256(manifestBytes) is client-derivable (consumability)', async () => {
    const files = [{ path: 'a.txt', content: Buffer.from('file-a-val091') }];
    const ref = await setupManifest(files);
    // Client can derive the ref independently
    const manifestBytes = Buffer.from(
      JSON.stringify(files.map((f) => ({ path: f.path, sha256: sha256(f.content) }))),
    );
    expect(ref).toBe(sha256(manifestBytes));
  });
});
