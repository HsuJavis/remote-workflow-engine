// VAL-089 (REQ-080, DES-079..085): engine-pull seedRef acceptance test.
// Binds the REQ-080 acceptance clauses against the REAL engine entrypoint (run_start MCP tool
// + real createServer + real CasStore + real git subprocess when online).
//
// REQ-080 acceptance clauses tested here:
//   1. No allowlist → SEEDREF_DISABLED (always runs, no network needed)
//   2. SSRF URL (169.254.169.254) → EGRESS_DENIED, zero outbound connection (no network)
//   3. seed + seedRef → SEED_SOURCE_CONFLICT (no network)
//   4. Real pull of pinned sha → workspace assembled, artifacts list the seeded files (online)
//   5. Bad sha (non-hex branch ref) → INVALID_SEED_SPEC (no network)
//
// Pinned repo/sha: https://github.com/octocat/Hello-World @ master
//   sha: 7fd1a60b01f91b314f59955a4e4d4e80d8edf11d (public; the design-named plugin repo is PRIVATE)
// Skip gate: env RWE_SKIP_ONLINE_TESTS=1 skips the real-pull case.
//
// Red reason: seedRef is not handled by RunManager or server.ts yet:
//   - `run_start` with seedRef silently ignores the field → no run error, assertions fail
//   - SEEDREF_DISABLED / EGRESS_DENIED / SEED_SOURCE_CONFLICT not returned →
//     `expect(r.error?.code).toBe('SEEDREF_DISABLED')` fails
//
// Mock policy (acceptance — MUST NOT mock SUT boundaries): real createServer, real HTTP; the
//   SeedRefFetcher, CasStore, and isEgressAllowed gate are real (not mocked). The real-pull
//   case is skip-gated to avoid CI-online dependency, same as HAS_PROVIDER in existing tests.
//
// Note: real:false — set to true by Gate 7.5 validator after a real verified run.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { runScriptVia } from '../helpers/workflow-fixtures.js';

const PINNED_REPO = 'https://github.com/octocat/Hello-World'; // public repo (test_defect fix: HsuJavis/remote-workflow-plugin is PRIVATE, not anonymously fetchable for a real-pull test)
const PINNED_SHA = '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d';
const SKIP_ONLINE = !!process.env['RWE_SKIP_ONLINE_TESTS'];

let server: Server;
let serverWithAllowlist: Server;
let tmpDir: string;
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

async function call(s: Server, name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${s.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

// v22: binds this file's own 3-arg `call(server, tool, args)` into the 2-arg shape the shared
// fixture helper drives (`register` → `publish` → `run` against ONE server).
const callerFor = (s: Server) => (tool: string, args: Record<string, unknown>) => call(s, tool, args);

async function poll(s: Server, runId: string): Promise<any> {
  for (let i = 0; i < 60; i++) {
    const st = await call(s, 'run_status', { runId });
    if (['completed', 'failed', 'stopped'].includes(st.status)) return st;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('run did not settle');
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val089-'));
  // Server WITHOUT an allowlist (tests SEEDREF_DISABLED)
  server = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: tmpDir,
  });
  // Server WITH an allowlist + CAS (tests real pull + SSRF rejection)
  serverWithAllowlist = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: join(tmpDir, 'allow'),
    seedRefAllowlist: ['https://github.com/octocat/'],
  } as any);
});

afterAll(async () => {
  await server?.close();
  await serverWithAllowlist?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('VAL-089: REQ-080 engine-pull seedRef — no allowlist → SEEDREF_DISABLED', () => {
  it('run_start with seedRef and no allowlist returns SEEDREF_DISABLED (fail-closed)', async () => {
    const r = await runScriptVia(callerFor(server), `return 'seeded';`, {
      seedRef: { repoUrl: PINNED_REPO, sha: PINNED_SHA },
    });
    // Expect either a pre-run error (status:'failed', error.code:'SEEDREF_DISABLED')
    // or a synchronous error envelope
    const code = r.error?.code ?? (r.status === 'failed' ? r.result?.error?.code : undefined);
    expect(code).toBe('SEEDREF_DISABLED');
  });
});

describe('VAL-089: REQ-080 — SSRF URL → EGRESS_DENIED (zero outbound, no network)', () => {
  it('http://169.254.169.254/ → EGRESS_DENIED before any network call', async () => {
    const r = await runScriptVia(callerFor(serverWithAllowlist), `return 'seeded';`, {
      seedRef: { repoUrl: 'http://169.254.169.254/latest/meta-data/', sha: PINNED_SHA },
    });
    const code = r.error?.code ?? (r.status === 'failed' ? r.result?.error?.code : undefined);
    expect(code).toBe('EGRESS_DENIED');
  });

  it('file:// scheme → EGRESS_DENIED', async () => {
    const r = await runScriptVia(callerFor(serverWithAllowlist), `return 'seeded';`, {
      seedRef: { repoUrl: 'file:///etc/passwd', sha: PINNED_SHA },
    });
    const code = r.error?.code ?? (r.status === 'failed' ? r.result?.error?.code : undefined);
    expect(code).toBe('EGRESS_DENIED');
  });
});

describe('VAL-089: REQ-080 — seed + seedRef → SEED_SOURCE_CONFLICT', () => {
  it('supplying both seed (inline) and seedRef yields SEED_SOURCE_CONFLICT, no run created', async () => {
    const r = await runScriptVia(callerFor(serverWithAllowlist), `return 'seeded';`, {
      seed: [{ path: 'a.txt', contentB64: Buffer.from('hello').toString('base64') }],
      seedRef: { repoUrl: PINNED_REPO, sha: PINNED_SHA },
    });
    const code = r.error?.code ?? (r.status === 'failed' ? r.result?.error?.code : undefined);
    expect(code).toBe('SEED_SOURCE_CONFLICT');
  });

  it('supplying both seedManifest and seedRef yields SEED_SOURCE_CONFLICT', async () => {
    const fakeHash = sha256(Buffer.from('x'));
    // v24 (DES-142/ADR-028, tool-specs.ts `run_start`): `seedNamespace` is gone from the schema and
    // `run_start` is `additionalProperties:false`, so passing it made ajv answer INVALID_ARGUMENT
    // before the run-manager's mutual-exclusion check could fire — the conflict oracle below was
    // unreachable, not failing. The namespace is derived from the caller's identity; dropped, not
    // renamed.
    const r = await runScriptVia(callerFor(serverWithAllowlist), `return 'seeded';`, {
      seedManifest: [{ path: 'x.txt', sha256: fakeHash }],
      seedRef: { repoUrl: PINNED_REPO, sha: PINNED_SHA },
    });
    const code = r.error?.code ?? (r.status === 'failed' ? r.result?.error?.code : undefined);
    expect(code).toBe('SEED_SOURCE_CONFLICT');
  });
});

describe('VAL-089: REQ-080 — INVALID_SEED_SPEC: branch name rejected (only full 40-or-64 hex sha)', () => {
  it('sha:"main" (branch ref, not a hex sha) → INVALID_SEED_SPEC', async () => {
    const r = await runScriptVia(callerFor(serverWithAllowlist), `return 'seeded';`, {
      seedRef: { repoUrl: PINNED_REPO, sha: 'main' },
    });
    const code = r.error?.code ?? (r.status === 'failed' ? r.result?.error?.code : undefined);
    expect(code).toBe('INVALID_SEED_SPEC');
  });
});

describe('VAL-089: REQ-080 — real pull materializes files (skip when offline)', () => {
  it('allowlisted seedRef pull: run completes, artifacts list seeded files, no .git entries', async () => {
    if (SKIP_ONLINE) {
      console.log('VAL-089 real-pull skipped (RWE_SKIP_ONLINE_TESTS)');
      return;
    }

    // v24: `seedNamespace` dropped — see the SEED_SOURCE_CONFLICT case above for why.
    const run = await runScriptVia(callerFor(serverWithAllowlist), `return 'seeded from git';`, {
      seedRef: { repoUrl: PINNED_REPO, sha: PINNED_SHA },
    });

    // run_start should return a runId immediately (REQ-005)
    expect(run.result?.runId ?? run.runId).toBeTruthy();
    const runId = run.result?.runId ?? run.runId;

    const done = await poll(serverWithAllowlist, runId);
    expect(done.status).toBe('completed');

    // seedRef observability: RunStatusView.seedRef
    expect(done.result?.seedRef?.resolvedSha).toBe(PINNED_SHA);
    expect(done.result?.seedRef?.bytes).toBeGreaterThan(0);
    expect(done.result?.seedRef?.latencyMs).toBeGreaterThanOrEqual(0);

    // Workspace artifacts: seeded files appear
    const arts = await call(serverWithAllowlist, 'workspace_list', { runId });
    const paths: string[] = (arts.result as Array<{ path: string }>).map((a) => a.path);
    expect(paths.length).toBeGreaterThan(0);

    // No .git internals in artifacts (guardrails applied)
    expect(paths.every((p) => !p.startsWith('.git/'))).toBe(true);
  });
});
