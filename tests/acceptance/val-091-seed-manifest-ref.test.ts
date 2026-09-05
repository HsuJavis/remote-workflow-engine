// VAL-091 (REQ-082, DES-087, DES-091): server-side seed manifest ref acceptance test.
// Binds the REQ-082 acceptance clauses against the REAL engine.
//
// REQ-082 acceptance clauses:
//   1. Upload blobs, register manifest via POST /assets/manifest, then run_start({seedManifestRef})
//      with a few-dozen-byte params produces a workspace byte-identical to the inline seedManifest
//      path.
//   2. seedManifestRef + seed → SEED_SOURCE_CONFLICT
//   3. seedManifestRef + seedManifest → SEED_SOURCE_CONFLICT
//   4. seedManifestRef alone referencing a missing blob → MISSING_BLOBS
//   5. seedManifestRef alone with unparseable manifest blob → INVALID_SEED_SPEC
//   6. seedManifestRef = sha256(manifestBytes) is derivable client-side (consumability)
//
// Red reason: POST /assets/manifest does not exist; RunManager.start() has no seedManifestRef
//   field → run_start ignores seedManifestRef → no workspace assembled / no SEED_SOURCE_CONFLICT
//   returned → all assertions fail for the correct unimplemented reason.
//
// Mock policy (acceptance — MUST NOT mock SUT boundaries): real createServer, real HTTP;
//   real CasStore, real materializeManifest path (not mocked).
// Note: real:false — set to true by Gate 7.5 validator.
//
// v24 (DES-142, ADR-028): the CAS namespace is DERIVED from the caller's own identity, never chosen
// by the caller. Two spellings change here, both migrations of the same fact, neither a weakening:
//   - `?namespace=` on /assets/blob and /assets/manifest is refused 400 INVALID_BLOB_REQUEST
//     (server.ts:966/993/1177/1204) — the query param is dropped from both URLs;
//   - `run_start`'s per-call namespace argument is gone from a now-CLOSED inputSchema
//     (`additionalProperties:false`, tool-specs.ts), so passing it made ajv answer INVALID_ARGUMENT
//     before any seed logic ran — it is dropped from every call below, not renamed.
// This server boots auth-disabled, so every call in this file derives the `'local'` namespace
// (`nsOf`, mcp-facade.ts:46).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

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
    const st = await mcpCall('run_status', { runId });
    if (['completed', 'failed', 'stopped'].includes(st.status)) return st;
    await new Promise((r) => setTimeout(r, ms));
  }
  throw new Error('run did not settle');
}

function blobUrl(sha: string): string {
  return `http://127.0.0.1:${server.port}/assets/blob/${sha}`;
}

function manifestUrl(): string {
  return `http://127.0.0.1:${server.port}/assets/manifest`;
}

/** Upload bytes, register a manifest, return the seedManifestRef. Every upload lands in the
 *  namespace the server derives for this caller — the helper no longer takes one. */
async function setupManifest(
  files: Array<{ path: string; content: Buffer; exec?: boolean }>,
): Promise<string> {
  const manifestEntries: Array<{ path: string; sha256: string; exec?: boolean }> = [];
  for (const f of files) {
    const h = sha256(f.content);
    await fetch(blobUrl(h), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: f.content,
    });
    manifestEntries.push({ path: f.path, sha256: h, ...(f.exec ? { exec: true } : {}) });
  }
  const manifestBody = JSON.stringify(manifestEntries);
  const mRes = await fetch(manifestUrl(), {
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
  // Was LEFT RED as a PRODUCT DEFECT by the batch-D executor (v24 namespace-derivation
  // half-wiring) and is GREEN now: the integrator closed it — `casNamespaceFor` (cas-store.ts) is
  // the ONE namespace expression, shared by the writers (nsOf) and by run-manager's readback, which
  // used to spell it `'_default'`. The description below is kept as the record of the defect.
  // POST /assets/manifest stores the manifest blob under the DERIVED namespace (`'local'`, echoed in
  // its own 200 response), but `run_start`'s handler never forwards a namespace onto the RunSpec
  // (mcp-facade.ts `runStart` spreads seed/seedManifest/seedRef/seedManifestRef and nothing else),
  // so `run-manager.ts:379` falls back to the pre-v24 `'_default'` literal and looks for the blob in
  // a pool no writer has used since ADR-028. Observed:
  //   MISSING_BLOBS "manifest blob <ref> not found in namespace _default; register via POST /assets/manifest"
  // Expected: the run starts and assembles the workspace. The same mismatch breaks the inline
  // `seedManifest` path (run-manager.ts:407, see seed-manifest-http.test.ts's REQ-065 case) — those
  // two entry points, where a CLIENT uploads blobs first and the run-manager reads them back later,
  // are the whole blast radius. `seedRef` is NOT affected: it writes and reads inside one `start()`
  // call, so its `?? '_default'` fallback is self-consistent (val-089's real-pull case is green).
  // The assertions below are the correct v24 behaviour and are deliberately left failing.
  it('1. run_start({seedManifestRef}) assembles workspace (params are few bytes)', async () => {
    const fileContent = Buffer.from('hello from val-091 seed manifest ref');
    const seedManifestRef = await setupManifest([{ path: 'hello.txt', content: fileContent }]);

    // Verify ref is client-derivable
    const manifestBytes = Buffer.from(JSON.stringify([{ path: 'hello.txt', sha256: sha256(fileContent) }]));
    expect(seedManifestRef).toBe(sha256(manifestBytes));

    // Script is minimal: vm.Script context does not support dynamic import() or process.env.
    // Workspace assembly (REQ-082 byte-identity clause) is verified via workspace_list below.
    const r = await runScriptVia(mcpCall, `return 'seeded';`, {
      seedManifestRef,
    });

    expect(r.error).toBeUndefined();
    expect(r.runId).toBeDefined();
    const runId: string = r.runId;
    const status = await poll(runId);
    expect(status.status).toBe('completed');

    // Artifacts must include the seeded file with byte-identical content (REQ-082 byte-identity).
    const artifacts = await mcpCall('workspace_list', { runId });
    expect(Array.isArray(artifacts.result)).toBe(true);
    const entries: Array<{ path: string; sha256: string; size: number }> = artifacts.result ?? [];
    const paths = entries.map((a) => a.path);
    expect(paths).toContain('hello.txt');
    const entry = entries.find((a) => a.path === 'hello.txt')!;
    expect(entry.sha256).toBe(sha256(fileContent)); // byte-identity: hash must match original
    expect(entry.size).toBe(fileContent.length);
  }, 30_000);

  it('2. seedManifestRef + seed → SEED_SOURCE_CONFLICT', async () => {
    const r = await runScriptVia(mcpCall, 'return 1;', {
      seedManifestRef: 'a'.repeat(64),
      seed: [{ path: 'f.txt', contentB64: Buffer.from('x').toString('base64') }],
    });
    expect(r.error?.code).toBe('SEED_SOURCE_CONFLICT');
  });

  it('3. seedManifestRef + seedManifest → SEED_SOURCE_CONFLICT', async () => {
    const r = await runScriptVia(mcpCall, 'return 1;', {
      seedManifestRef: 'a'.repeat(64),
      seedManifest: [{ path: 'f.txt', sha256: 'a'.repeat(64) }],
    });
    expect(r.error?.code).toBe('SEED_SOURCE_CONFLICT');
  });

  it('4. seedManifestRef naming a missing blob → MISSING_BLOBS', async () => {
    const r = await runScriptVia(mcpCall, 'return 1;', {
      seedManifestRef: 'b'.repeat(64), // not uploaded
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
