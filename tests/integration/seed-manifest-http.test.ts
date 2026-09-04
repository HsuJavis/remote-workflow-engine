// v10 Slice 2 — efficient seeding end-to-end over the real server (REQ-064/065): workspace_push
// (CAS mode) → workspace_diff → run_start with a seedManifest → the workspace is assembled from
// the CAS (a script reads a seeded file back). Plus MISSING_BLOBS fail-fast + BLOB_HASH_MISMATCH.
//
// v24 (TASK-152, DES-142): the pre-v24 seed-plan/blob-put tools fold into `workspace_diff`/
// `workspace_push`; both DROP the caller-typed `namespace` argument — the CAS pool is derived from
// the caller's own principal (`nsOf`), never a query/tool arg — so the old cross-tenant-namespace
// isolation case (two DIFFERENT caller-chosen namespaces not seeing each other's blobs) has no v24
// equivalent to assert: every call in this file now runs as the SAME derived namespace
// (auth-disabled → `'local'`). `run_start`'s `seedNamespace` argument is dropped from the schema
// for the same reason (`INVALID_ARGUMENT` if supplied) — omitted below, not renamed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

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
    const s = await call('run_status', { runId });
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
  const fileText = 'export const answer = 42;\n';
  const h = sha(Buffer.from(fileText));

  it('REQ-064 workspace_diff reports the blob as missing before upload, present after', async () => {
    const manifest = [{ path: 'src/answer.ts', sha256: h }];
    const before = await call('workspace_diff', { manifest });
    expect(before.result.missing).toEqual([h]);
    const put = await call('workspace_push', { sha256: h, contentB64: b64(fileText) });
    expect(put.result.sha256).toBe(h);
    const after = await call('workspace_diff', { manifest });
    expect(after.result.missing).toEqual([]);
  });

  it('REQ-064 workspace_push rejects a hash mismatch (BLOB_HASH_MISMATCH)', async () => {
    const r = await call('workspace_push', { sha256: sha('lie'), contentB64: b64('actual different bytes') });
    expect(r.error.code).toBe('BLOB_HASH_MISMATCH');
  });

  // Was LEFT RED as a PRODUCT DEFECT by the batch-D executor (v24 namespace-derivation
  // half-wiring) and is GREEN now: the integrator closed it — `casNamespaceFor` (cas-store.ts) is
  // the ONE namespace expression, shared by the writers (nsOf) and by run-manager's readback, which
  // used to spell it `'_default'`. The description below is kept as the record of the defect.
  // `workspace_push` (CAS mode) stores the blob under the DERIVED namespace (`nsOf(principal)` =
  // `'local'` here) and the case above proves `workspace_diff` — which derives the SAME namespace —
  // then sees it. But `run_start`'s handler never forwards a namespace onto the RunSpec
  // (mcp-facade.ts `runStart` spreads seed/seedManifest/seedRef/seedManifestRef and nothing else),
  // so `run-manager.ts:407` falls back to the pre-v24 `'_default'` literal. Observed:
  //   status 'failed', MISSING_BLOBS "upload 1 blob(s) first: <the sha workspace_push just accepted>"
  // Expected: the run starts, completes, and the workspace holds the byte-identical seeded file.
  // Same root cause as val-091's clause 1 (seedManifestRef, run-manager.ts:379). Blast radius is
  // exactly the two entry points where a CLIENT uploads blobs first and the run-manager reads them
  // back later; `seedRef` is NOT affected — it writes and reads inside one `start()` call, so its
  // `?? '_default'` fallback is self-consistent (val-089's real-pull case is green).
  // Assertions below are the correct v24 behaviour, deliberately left failing.
  it('REQ-065 run_start with a seedManifest assembles the workspace from the CAS (script reads the file)', async () => {
    // the blob was uploaded above; a script reads the seeded file back via the sandbox has no fs — so
    // instead assert the run completes and the workspace really has the file by listing artifacts.
    const run = await runScriptVia(call, `return 'seeded';`, {
      seedManifest: [{ path: 'src/answer.ts', sha256: h, exec: false }],
    });
    expect(run.runId).toBeTruthy();
    const done = await poll(run.runId);
    expect(done.status).toBe('completed');
    const arts = await call('workspace_list', { runId: run.runId });
    const paths = (arts.result as Array<{ path: string; sha256: string }>).map((a) => a.path);
    expect(paths).toContain('src/answer.ts');
    const seeded = (arts.result as Array<{ path: string; sha256: string }>).find((a) => a.path === 'src/answer.ts')!;
    expect(seeded.sha256).toBe(h); // assembled from the CAS, byte-identical
  });

  it('issue #21: a stringified seedManifest fails with a typed INVALID_ARGUMENT, not a raw TypeError', async () => {
    // Reproduces the reported break: a schema-blind MCP client serialized the array to a string, so the
    // engine received `"[…]"` and `spec.seedManifest.map(...)` threw `TypeError: … .map is not a
    // function`. Same oracle as ever — a TYPED, actionable refusal naming the offending field, never a
    // raw TypeError and never a started run.
    //
    // v24 spelling change: `run_start`'s inputSchema now declares `seedManifest: {type:'array'}`
    // (tool-specs.ts), so ajv refuses a string at the tool boundary and answers INVALID_ARGUMENT
    // with `/seedManifest must be array` BEFORE any handler runs. The run-manager's own defence
    // (run-manager.ts:337, INVALID_SEED_SPEC) is now unreachable OVER THE WIRE for this input — it
    // survives as the defence for IN-PROCESS callers of `RunManager.start`, which no test currently
    // exercises by name (reported as a coverage gap; not fixable from this file's tier).
    // Asserting INVALID_SEED_SPEC here would assert an unreachable path, not a stronger one.
    const run = await runScriptVia(call, `return 1;`, {
      seedManifest: JSON.stringify([{ path: 'x.ts', sha256: h }]),
    });
    expect(run.status).toBe('failed');
    expect(run.error.code).toBe('INVALID_ARGUMENT');
    expect(run.error.code).not.toBe('TypeError');
    expect(run.error.message).toContain('seedManifest');
    expect(run.runId).toBeFalsy(); // refused at the boundary — no run created
  });

  it('REQ-065 a seedManifest referencing an un-uploaded blob fails fast with MISSING_BLOBS (no run created)', async () => {
    const ghost = sha('never uploaded');
    const run = await runScriptVia(call, `return 1;`, {
      seedManifest: [{ path: 'ghost.ts', sha256: ghost }],
    });
    expect(run.status).toBe('failed');
    expect(run.error.code).toBe('MISSING_BLOBS');
  });
});
