// Issue #123: system_info (MCP tool, minRole 'user') and GET /api/system returned process.topN
// (per-process OS `comm` names + CPU/mem detail) to every authenticated user, not just admin.
// DECISION: below-admin callers keep CPU/memory/disk and process COUNTS (system.total/byState)
// but never topN — a `processDetailNote` explains why. admin is unchanged. ONE shared function
// (redactSystemInfoForRole, system-info.ts) is applied identically on both surfaces.
//
// Real auth-enabled createServer() (same pattern as dashboard-auth.test.ts): a real Google login
// for the dashboard session (GET /api/system), a real minted bearer for the MCP tool call.
//
// Red reason: today `call-tool.ts`'s `system_info` case and `server.ts`'s `/api/system` route
// both return the sampler's raw view, unfiltered by role — `process.topN` is present and
// non-empty for the plain 'user' principal on both surfaces, and `processDetailNote` is absent.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer, type Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';
import { SystemInfoSampler } from '../../src/system-info.js';
import type { SystemProbe, RawHostSnapshot, RawProcSnapshot } from '../../src/system-info.js';
import { FixedClock } from '../../src/clock.js';
import { startFakeGoogle, fakeJwksFetch, dashboardLogin, type FakeGoogle } from '../helpers/fake-google.js';

const SAMPLE_HOST: RawHostSnapshot = {
  cpu: { perCore: [{ idleMs: 700, totalMs: 1000 }] },
  loadAvg: [1.0, 0.8, 0.5],
  cores: 4,
  mem: { totalBytes: 8_000_000_000, freeBytes: 3_200_000_000 },
  disk: { path: '/data', blockSize: 4096, blocks: 100_000, bfree: 30_000, bavail: 28_000 },
};
const SAMPLE_PROCS: RawProcSnapshot = {
  self: { threads: 4, fdCount: 20 },
  procs: [
    { pid: 100, comm: 'kworker', utimeJiffies: 200, stimeJiffies: 50, state: 'S', rssBytes: 1_000_000 },
    { pid: 200, comm: 'nginx', utimeJiffies: 500, stimeJiffies: 100, state: 'S', rssBytes: 50_000_000 },
  ],
  procsDegraded: undefined,
};
class StubProbe implements SystemProbe {
  async sampleHost(): Promise<RawHostSnapshot> { return SAMPLE_HOST; }
  async sampleProcesses(_deadlineMs: number): Promise<RawProcSnapshot> { return SAMPLE_PROCS; }
}

const CID = 'sysinfo-role-cid';
const ADMIN = 'admin@example.test';
const USER = 'user@example.test';

let google: FakeGoogle;
let server: Server;
let tmpDir: string;
let base: string;

function authDb(): Database.Database { return new Database(join(tmpDir, 'auth-tokens.db')); }
function mintBearer(email: string): string {
  const db = authDb();
  try { return new TokenStore(db, { clock: () => Date.now(), csprng: (n) => randomBytes(n) }).issue(email, 3600_000).token; } finally { db.close(); }
}

async function mcpSystemInfo(bearer: string): Promise<{ process: { topN?: unknown[]; processDetailNote?: string; system: unknown } }> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'system_info', arguments: {} } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  const parsed = JSON.parse(body.result?.content?.[0]?.text ?? '{}');
  return parsed.result ?? parsed;
}

async function httpSystemInfo(cookie: string): Promise<{ process: { topN?: unknown[]; processDetailNote?: string; system: unknown } }> {
  const res = await fetch(`${base}/api/system`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  return res.json() as Promise<{ process: { topN?: unknown[]; processDetailNote?: string; system: unknown } }>;
}

beforeAll(async () => {
  google = await startFakeGoogle(CID);
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it123-'));
  const systemInfo = new SystemInfoSampler(new StubProbe(), new FixedClock(new Date('2024-06-01T12:00:00.000Z')), 1500);
  server = await createServer({
    port: 0,
    bind: '127.0.0.1',
    workRoot: tmpDir,
    systemInfo,
    auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: CID, googleClientSecret: 'cs', googleAuthorizeUrl: 'http://127.0.0.1:9/auth', googleTokenUrl: google.tokenUrl, jwksFetch: fakeJwksFetch },
    principals: { [ADMIN]: { role: 'admin' }, [USER]: { role: 'user' } },
  } as never);
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server?.close();
  await google?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('issue #123: system_info/​GET /api/system redact process detail below admin', () => {
  it('MCP: a plain "user" gets process COUNTS but no topN, and a processDetailNote', async () => {
    const view = await mcpSystemInfo(mintBearer(USER));
    expect(view.process.topN).toBeUndefined();
    expect(view.process.processDetailNote).toMatch(/admin/i);
    expect(view.process.system).toEqual({ total: 2, byState: { S: 2 } });
  });

  it('HTTP: a plain "user" dashboard session gets process COUNTS but no topN, and a processDetailNote', async () => {
    const { cookie } = await dashboardLogin(base, USER);
    const view = await httpSystemInfo(cookie);
    expect(view.process.topN).toBeUndefined();
    expect(view.process.processDetailNote).toMatch(/admin/i);
    expect(view.process.system).toEqual({ total: 2, byState: { S: 2 } });
  });

  it('MCP: admin gets the full topN (process names), no processDetailNote', async () => {
    const view = await mcpSystemInfo(mintBearer(ADMIN));
    expect(view.process.topN).toBeDefined();
    expect((view.process.topN as Array<{ name: string }>).map((p) => p.name).sort()).toEqual(['kworker', 'nginx']);
    expect(view.process.processDetailNote).toBeUndefined();
  });

  it('HTTP: admin dashboard session gets the full topN (process names), no processDetailNote', async () => {
    const { cookie } = await dashboardLogin(base, ADMIN);
    const view = await httpSystemInfo(cookie);
    expect(view.process.topN).toBeDefined();
    expect((view.process.topN as Array<{ name: string }>).map((p) => p.name).sort()).toEqual(['kworker', 'nginx']);
    expect(view.process.processDetailNote).toBeUndefined();
  });
});
