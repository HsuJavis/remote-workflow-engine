// IT-092 (H2 send-back, 07-review.md §4.2 — ARCH-073, ARCH-075, ADR-012, DES-114, DES-115,
// REQ-100): `GET /api/runs/:id/dag` masks the script-derived skeleton overlay while auth is
// enabled, same as its sibling `/api/workflows/:name/skeleton` route already does.
//
// Mock policy (integration, DES-119): real createServer + real HTTP + real RunManager/catalog +
// real auth (TokenStore); only the GatewayClient is faked (a never-resolving echo, so the run is
// provably still `running` with ZERO completed live agents at the moment this test reads the
// DAG — the skeleton-vs-live distinction only means something before any agent has finished).
//
// Red reason: `server.ts`'s `dagMatch` handler has NO `authEnabled` branch at all (confirmed by
// direct read, 07-review.md H2) — it always derives `cells` from the pinned script's static
// skeleton via `parseWorkflowSkeleton`/`layoutGraph`, so an unauthenticated GET on an auth-enabled
// deployment gets the full predicted agent graph. `masked.cells` below is asserted to contain ONLY
// the `__trigger__` cell; today it also carries 3 `__skel_*` placeholder cells (one per registered
// `agent()` call) — RED.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TokenStore } from '../../src/auth/token-store.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { registerPublishedVia, type ToolCaller } from '../helpers/workflow-fixtures.js';

// A gateway that never resolves within this test's lifetime — guarantees the run is still
// `running` with 0 completed agents when the DAG route is read immediately after `run_start`.
const NEVER_RESOLVES_GATEWAY: GatewayClient = {
  invoke: () => new Promise(() => { /* never settles */ }),
};

const SCRIPT = `
  const a1 = await agent('do-skel-1', {});
  const a2 = await agent('do-skel-2', {});
  const a3 = await agent('do-skel-3', {});
  return { a1, a2, a3 };
`;

let authServer: Server;
let openServer: Server;
let authTmpDir: string;
let openTmpDir: string;

beforeAll(async () => {
  authTmpDir = mkdtempSync(join(tmpdir(), 'rwe-it092-auth-'));
  authServer = await createServer({
    port: 0, bind: '127.0.0.1', workRoot: authTmpDir, gateway: NEVER_RESOLVES_GATEWAY,
    auth: {
      enabled: true, issuer: 'http://127.0.0.1:0',
      googleClientId: 'it092-client-id', googleClientSecret: 'it092-client-secret',
      googleBase: 'http://127.0.0.1:0', jwksFetch: async () => [],
    },
    // v24 (REQ-109 roles, ADR-028): the owner bearer minted below must resolve to `author` —
    // `workflow_register`/`workflow_publish` are `{minRole:'author'}`, and an authenticated id that
    // is not listed here resolves to `'user'` (fail-closed), so the fixture never gets registered
    // and the DAG assertion never runs. Mechanical; the masking oracles are untouched.
    principals: { 'it092-owner@example.com': { role: 'author' } },
  } as never);

  openTmpDir = mkdtempSync(join(tmpdir(), 'rwe-it092-open-'));
  openServer = await createServer({ port: 0, bind: '127.0.0.1', workRoot: openTmpDir, gateway: NEVER_RESOLVES_GATEWAY }); // auth disabled
});

afterAll(async () => {
  await authServer?.close();
  await openServer?.close();
  rmSync(authTmpDir, { recursive: true, force: true });
  rmSync(openTmpDir, { recursive: true, force: true });
});

// Same pattern as IT-089's mintBearer: writes a token row directly into the server's own
// auth-tokens.db — authServer is loopback-bound (127.0.0.1), so D-BIND does NOT exempt it and
// every /mcp call (register/publish/run alike) genuinely needs this bearer.
async function mintBearer(workRoot: string, email: string): Promise<string> {
  const db = new Database(join(workRoot, 'auth-tokens.db'));
  const now = Date.now();
  const store = new TokenStore(db, { clock: () => now, csprng: (n: number) => randomBytes(n) });
  const { token } = store.issue(email, 7 * 24 * 3600_000);
  db.close();
  return token;
}

async function toolCall(server: Server, name: string, args: Record<string, unknown>, bearer?: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

function callerFor(server: Server, bearer?: string): ToolCaller {
  return (name, args) => toolCall(server, name, args as Record<string, unknown>, bearer);
}

async function startRunAndGetDag(server: Server, name: string, bearer?: string): Promise<{ kind?: string; cells?: Array<{ id: string }> }> {
  await registerPublishedVia(callerFor(server, bearer), name, SCRIPT);
  const started = await toolCall(server, 'run_start', { name }, bearer);
  const runId = started['runId'] as string;
  expect(typeof runId).toBe('string');
  // The DAG route itself carries no bearer and needs none to be reached (07-review.md H2: no
  // identity plumbing on this route at all) — this is exactly the finding's own reachability
  // claim, so the GET below is deliberately anonymous even on the auth-enabled server.
  const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/dag`);
  expect(res.status).toBe(200);
  return res.json() as Promise<{ kind?: string; cells?: Array<{ id: string }> }>;
}

describe('REQ-100/H2: GET /api/runs/:id/dag masks the script-derived skeleton while auth is enabled', () => {
  it('auth ON, no bearer on the DAG GET: the DAG carries ONLY the trigger cell — no __skel_* placeholder from the pinned script', async () => {
    const ownerToken = await mintBearer(authTmpDir, 'it092-owner@example.com');
    const dag = await startRunAndGetDag(authServer, 'it092-masked', ownerToken);
    const ids = (dag.cells ?? []).map((c) => c.id);
    expect(ids).toEqual(['__trigger__']); // no skeleton-derived agent slots leaked
    expect(ids.some((id) => id.startsWith('__skel_'))).toBe(false);
  });

  it('auth OFF (pre-v22 surface): the SAME shape of run serves the full predicted skeleton (3 agent slots + trigger)', async () => {
    const dag = await startRunAndGetDag(openServer, 'it092-open');
    const ids = (dag.cells ?? []).map((c) => c.id);
    expect(ids.length).toBe(4); // __trigger__ + 3 __skel_* placeholders
    expect(ids.filter((id) => id.startsWith('__skel_')).length).toBe(3);
  });
});

// v27 (IT-168, DES-197, ARCH-131, ADR-051, TASK-202, REQ-140/133): the SAME masking predicate
// (ADR-051/ADR-055, decision (a): served unconditionally from observed phases, the predicted
// OVERLAY stays masked under auth) now applies to TWO more surfaces this dispatch adds: `dag.lanes`
// (unconditional) and `describe.phases[].agents` (masked, same predicate as the run-DAG overlay).
// This extends the SAME harness — real createServer() x2 (auth on/off), real MCP HTTP.
//
// Red reason (measured): `dag.lanes` does not exist on the DAG payload at all today (`server.ts`'s
// dagMatch handler never calls `deriveLanes`); `describe.phases[].agents` does not exist either
// (`workflowDescribe`'s `phases` projection is title-only, `workflow-view.ts:106`).
describe('REQ-140/REQ-133 (v27): dag.lanes served unconditionally; describe.phases[].agents masked identically to the run-DAG overlay (IT-168, DES-197)', () => {
  it('auth ON: GET .../dag carries lanes (observed-only, never []) even though the predicted overlay stays masked', async () => {
    const ownerToken = await mintBearer(authTmpDir, 'it092-owner@example.com');
    await registerPublishedVia(callerFor(authServer, ownerToken), 'it168-auth-lanes', SCRIPT);
    const started = await toolCall(authServer, 'run_start', { name: 'it168-auth-lanes' }, ownerToken);
    const runId = started['runId'] as string;
    const res = await fetch(`http://127.0.0.1:${authServer.port}/api/runs/${runId}/dag`);
    const dag = await res.json() as { lanes?: Array<{ index: number; title: string | null }>; current?: number | null };
    expect(Array.isArray(dag.lanes)).toBe(true);
    expect((dag.lanes ?? []).length).toBeGreaterThan(0);
  });

  it('auth ON: describe.phases[].agents is ABSENT (masked), never [] — a lie that "this lane has no agents"', async () => {
    const ownerToken = await mintBearer(authTmpDir, 'it092-owner@example.com');
    await registerPublishedVia(callerFor(authServer, ownerToken), 'it168-auth-describe', SCRIPT);
    const body = await toolCall(authServer, 'workflow_describe', { name: 'it168-auth-describe' }, ownerToken);
    const result = body['result'] as { phases?: Array<{ agents?: string[] }> } | undefined;
    for (const phase of result?.phases ?? []) {
      expect(phase.agents).toBeUndefined();
    }
  });

  it('auth OFF: describe.phases[].agents IS present, with the predicted agent labels', async () => {
    await registerPublishedVia(callerFor(openServer), 'it168-open-describe', SCRIPT);
    const body = await toolCall(openServer, 'workflow_describe', { name: 'it168-open-describe' });
    const result = body['result'] as { phases?: Array<{ agents?: string[] }> } | undefined;
    expect((result?.phases ?? []).some((p) => Array.isArray(p.agents) && p.agents.length > 0)).toBe(true);
  });
});
