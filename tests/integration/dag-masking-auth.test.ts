// IT-092 — re-traced to REQ-100 (Round v27b owner ruling, ADR-051): the v22 H2 masking predicate
// this test used to assert is REVERSED by ADR-051 decision (b) — the predicted overlay on
// `GET /api/runs/:id/dag` (and its sibling `describe.phases[].agents`, ADR-055) is now served
// UNCONDITIONALLY, auth on or off (see IT-168 below, same file). The `['__trigger__']`-only
// assertion and its auth-OFF contrast pin are DELETED outright — they pinned the very mask this
// ruling retires. Historically traced to ARCH-073/ARCH-075/ADR-012/DES-114/DES-115 (all
// `superseded_in_part` v27b) — kept here as LINEAGE prose, not as an active `traces:` link: this
// test now proves a narrower, still-true invariant the reversal does NOT touch (ADR-051's own "what
// the reversal is NOT" clause) — `traces: REQ-100` only.
//
// What survives: `GET /api/runs/:id/dag` must never leak the pinned script's own SOURCE BYTES,
// masked or not — only a structurally DERIVED skeleton (lane/cell/edge shapes), never the text. The
// guard is a comment sentinel planted in the fixture SCRIPT that the derivation cannot legitimately
// surface (it names no agent, no lane, no cell — `parseWorkflowSkeleton`/`scanAgentCalls` never
// reads a comment), asserted absent from the RAW response TEXT (`res.text()`, not `res.json()` — a
// JSON round-trip can hide a byte a naive re-serialization would not). A label-based sentinel would
// go red the day the predicted `label` lands (DES-196/UT-238); a comment cannot legitimately reach
// any projection. This is Mode C (characterization, not this delta's red test): GREEN now — the
// route has never emitted script source text, masked or not — and GREEN after Gate 6, because the
// reversal does not touch REQ-100's script-text masking (ADR-051's own boundary).
//
// Mock policy (integration, DES-119): real createServer + real HTTP + real RunManager/catalog +
// real auth (TokenStore); only the GatewayClient is faked (a never-resolving echo, so the run is
// provably still `running` with ZERO completed live agents at the moment this test reads the DAG).
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
import { ALLOWED_DAG_KEYS, REQUIRED_DAG_KEYS } from '../fixtures/dashboard-wire.js';

// A gateway that never resolves within this test's lifetime — guarantees the run is still
// `running` with 0 completed agents when the DAG route is read immediately after `run_start` (the
// never-resolving gateway's steady state, agent-executor.ts:248-262).
const NEVER_RESOLVES_GATEWAY: GatewayClient = {
  invoke: () => new Promise(() => { /* never settles */ }),
};

// v27b test-first finding (measured, not an owner_decision — a fixture-authoring fact): `describe`'s
// `phases` array is the AUTHOR-DECLARED `meta.phases` (`workflow-meta.ts:parseMeta`, evaluated from
// the script's OWN `export const meta = {…}` literal) — a SEPARATE field from both the script's
// `phase()` CALL STRUCTURE (which only feeds the STATIC predicted-graph derivation,
// `deriveExpectedGraph`) and from `RunStatusView.phases` (the RUNTIME-tracked list the DAG route's
// `deriveLanes` reads). `registerPublishedVia`'s `synthesizeMeta` only ever emits `params.agents`,
// NEVER `phases` (`workflow-fixtures.ts:157-167` — measured directly), so every script here that
// feeds `describe.phases[].agents` (IT-168 cases 2/3/4 below) must declare its OWN `meta.phases`
// explicitly — DES-197's join is BY ORDINAL onto `full.phases`, and "derived lanes beyond
// `phases.length` are DROPPED, not appended" (the projection may not invent a row); an empty
// `meta.phases` would leave every case red FOREVER, for a fixture reason, not the intended one. This
// helper writes the exact `params.agents.<label>` shape `synthesizeMeta` itself would have
// generated (`workflow-fixtures.ts:161-167`) since declaring `meta` at all makes `synthesizeMeta`
// return the script UNCHANGED (`META_DECL_RE` already matches).
function metaBlock(phaseTitles: string[], agentLabels: string[]): string {
  const agents = agentLabels
    .map((label) => `${JSON.stringify(label)}: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }`)
    .join(', ');
  const phases = phaseTitles.map((title) => `{ title: ${JSON.stringify(title)} }`).join(', ');
  return `export const meta = { phases: [${phases}], params: { agents: { ${agents} } } };`;
}

const IT092_SENTINEL = '// RWE-IT092-SCRIPT-BYTES-DO-NOT-LEAK';
// `phase('main')` is EXPLICIT, not left to `synthesizePhase`'s auto-injection: every other
// `registerPublishedVia` script in this repo is meta-FIRST, phase-call second — leaving it implicit
// here would have `synthesizePhase` prepend `phase('main');` ABOVE this script's own hand-written
// `meta` literal (`workflow-fixtures.ts:139-143` scans for a literal `phase(` anywhere in the text,
// finds none, and inserts at position 0), an untested phase-then-meta shape no other fixture in the
// suite exercises. Writing it explicitly matches the well-trodden shape and skips the auto-insert.
const SCRIPT = `
  ${metaBlock(['main'], ['do-skel-1', 'do-skel-2', 'do-skel-3'])}
  phase('main');
  ${IT092_SENTINEL}
  const a1 = await agent('do-skel-1', {});
  const a2 = await agent('do-skel-2', {});
  const a3 = await agent('do-skel-3', {});
  return { a1, a2, a3 };
`;

// v27b (IT-168, DES-198's own test spec — "a ≥2-phase script ... one extra SCRIPT_PHASED const in
// that test file, not a new fixture module"): `registerPublishedVia`'s `synthesizePhase` only
// auto-injects `phase('main')` for a script with NO `phase()` call at all — irrelevant here since
// this script already calls `phase()` three times; unusable for `SCRIPT` above, which needs its one
// synthesized `main` lane to be a lane the never-resolving gateway genuinely never LEAVES, not one
// it never ENTERS.
const SCRIPT_PHASED = `
  ${metaBlock(['one', 'two', 'three'], ['lane-one-agent', 'lane-two-agent', 'lane-three-agent'])}
  phase('one');
  const a1 = await agent('lane-one-agent', {});
  phase('two');
  const a2 = await agent('lane-two-agent', {});
  phase('three');
  const a3 = await agent('lane-three-agent', {});
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

async function startRun(server: Server, name: string, bearer?: string): Promise<string> {
  const started = await toolCall(server, 'run_start', { name }, bearer);
  const runId = started['runId'] as string;
  expect(typeof runId).toBe('string');
  return runId;
}

describe('REQ-100: GET /api/runs/:id/dag never leaks the pinned script\'s own source bytes (IT-092, re-traced Round v27b)', () => {
  it('guards the guard: the sentinel is actually IN the fixture script (a typo here would pass every case vacuously)', () => {
    expect(SCRIPT).toContain(IT092_SENTINEL);
  });

  it('auth ON, anonymous GET: the sentinel comment planted in the pinned script is absent from the RAW response text', async () => {
    const ownerToken = await mintBearer(authTmpDir, 'it092-owner@example.com');
    await registerPublishedVia(callerFor(authServer, ownerToken), 'it092-sentinel-auth', SCRIPT);
    const runId = await startRun(authServer, 'it092-sentinel-auth', ownerToken);
    // The DAG route itself carries no bearer and needs none to be reached (this is exactly the
    // ORIGINAL H2 finding's own reachability claim — still true, only the disclosure it enables is
    // now a deliberate one) — the GET below is deliberately anonymous even on the auth-enabled server.
    const res = await fetch(`http://127.0.0.1:${authServer.port}/api/runs/${runId}/dag`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(IT092_SENTINEL);
  });

  it('auth OFF: the same guard holds — the invariant is not auth-dependent', async () => {
    await registerPublishedVia(callerFor(openServer), 'it092-sentinel-open', SCRIPT);
    const runId = await startRun(openServer, 'it092-sentinel-open');
    const res = await fetch(`http://127.0.0.1:${openServer.port}/api/runs/${runId}/dag`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(IT092_SENTINEL);
  });
});

// v27b (IT-168, DES-197/198, ARCH-131/126/130, ADR-051/055, TASK-201/202/203, REQ-140/133/134):
// Round v27b's owner ruling REVERSES the v27 masking predicate this describe block used to assert
// (「開 —— 撤銷遮罩」) — the predicted overlay (`dag`'s `__skel_*` cells AND `describe.phases[].agents`)
// is now served UNCONDITIONALLY, auth on or off; `dag.lanes`/`current` were already unconditional
// since v27 and are untouched by this amendment. This extends the SAME harness — real createServer()
// x2 (auth on/off), real MCP HTTP.
//
// Red reason (measured): `dag.lanes`/`current` do not exist on the DAG payload at all today
// (`server.ts`'s `dagMatch` handler never calls `deriveLanes`); the predicted `__skel_*` cells are
// masked under auth (`server.ts:520`'s `if (!authEnabled)` wrapper — the exact branch ADR-051
// deletes); `describe.phases[].agents` does not exist on EITHER server yet
// (`workflowDescribe`'s `phases` projection is title-only, `workflow-view.ts:106`).
describe('REQ-140/REQ-133/REQ-134 (Round v27b, ADR-051): the predicted overlay is served UNCONDITIONALLY — dag.lanes, __skel_ cells, and describe.phases[].agents (IT-168, DES-197/198)', () => {
  it('auth ON: GET .../dag carries BOTH lanes and the predicted __skel_ cells — the overlay is no longer masked', async () => {
    const ownerToken = await mintBearer(authTmpDir, 'it092-owner@example.com');
    await registerPublishedVia(callerFor(authServer, ownerToken), 'it168-auth-unmasked', SCRIPT);
    const runId = await startRun(authServer, 'it168-auth-unmasked', ownerToken);
    const res = await fetch(`http://127.0.0.1:${authServer.port}/api/runs/${runId}/dag`);
    const dag = await res.json() as { lanes?: Array<{ index: number; title: string | null }>; current?: number | null; cells?: Array<{ id: string }> };
    expect(Array.isArray(dag.lanes)).toBe(true);
    expect((dag.lanes ?? []).length).toBeGreaterThan(0);
    // the positive anchor IT-092 used to invert: __skel_ cells now DO reach an anonymous auth-ON GET.
    expect((dag.cells ?? []).some((c) => /^__skel_\d+__$/.test(c.id))).toBe(true);
  });

  it('auth ON: describe.phases[].agents IS present, with the predicted agent labels (never absent — the mask never existed as code, ADR-051)', async () => {
    const ownerToken = await mintBearer(authTmpDir, 'it092-owner@example.com');
    await registerPublishedVia(callerFor(authServer, ownerToken), 'it168-auth-describe', SCRIPT);
    const body = await toolCall(authServer, 'workflow_describe', { name: 'it168-auth-describe' }, ownerToken);
    const result = body['result'] as { phases?: Array<{ agents?: string[] }> } | undefined;
    // Positive length anchor FIRST: `.some(...)` below returns `false` identically whether `phases`
    // is empty (a fixture defect) or non-empty-but-agentless (the genuine, intended gap) — this line
    // is what tells the two apart, so the red reason stays self-evidencing.
    expect((result?.phases ?? []).length).toBeGreaterThan(0);
    expect((result?.phases ?? []).some((p) => Array.isArray(p.agents) && p.agents.length > 0)).toBe(true);
  });

  it('auth OFF: describe.phases[].agents IS present, with the predicted agent labels (unchanged baseline)', async () => {
    await registerPublishedVia(callerFor(openServer), 'it168-open-describe', SCRIPT);
    const body = await toolCall(openServer, 'workflow_describe', { name: 'it168-open-describe' });
    const result = body['result'] as { phases?: Array<{ agents?: string[] }> } | undefined;
    expect((result?.phases ?? []).length).toBeGreaterThan(0);
    expect((result?.phases ?? []).some((p) => Array.isArray(p.agents) && p.agents.length > 0)).toBe(true);
  });

  it('describe.phases parity: anonymous GET /api/workflows/:name/describe on both servers, deep-equal SCOPED TO phases (never whole-payload — owner legitimately differs by deployment)', async () => {
    const ownerToken = await mintBearer(authTmpDir, 'it092-owner@example.com');
    await registerPublishedVia(callerFor(authServer, ownerToken), 'it168-describe-parity-auth', SCRIPT_PHASED);
    await registerPublishedVia(callerFor(openServer), 'it168-describe-parity-open', SCRIPT_PHASED);
    const authRes = await fetch(`http://127.0.0.1:${authServer.port}/api/workflows/it168-describe-parity-auth/describe`);
    const openRes = await fetch(`http://127.0.0.1:${openServer.port}/api/workflows/it168-describe-parity-open/describe`);
    expect(authRes.status).toBe(200);
    expect(openRes.status).toBe(200);
    const authBody = await authRes.json() as { phases?: Array<{ title?: string; agents?: string[] }> };
    const openBody = await openRes.json() as { phases?: Array<{ title?: string; agents?: string[] }> };
    // positive: not vacuously empty (a whole-payload compare would also pass on two empty arrays)
    expect((authBody.phases ?? []).length).toBeGreaterThan(0);
    expect(authBody.phases).toEqual(openBody.phases);
  });

  // INV-V27-9 (ARCH's parity invariant): the stabilization predicate (≥1 predicted cell AND exactly
  // ONE live agent cell in state 'running') is necessary because `cells[].state` transitions across
  // `await acquireSlot()` — without it the guard flakes and quarantines, and the reversal's only
  // empirical control (auth server vs. open server behaving IDENTICALLY) is gone. The deadline below
  // throws a NAMED error rather than letting vitest's own hook-timeout fire, so a red here reads as
  // "the servers never converged" and not as an unrelated hook timeout (a wrong-reason red).
  describe('INV-V27-9: stabilized DAG-payload parity, live key-set, and positive anchors on the AUTH server', () => {
    const STABILIZE_DEADLINE_MS = 15000;
    const STABILIZE_POLL_MS = 200;
    const PARITY_EXCLUDED = ['runId', 'terminalAt'] as const;

    interface DagCell { id: string; kind?: string; agentId?: string; state?: string }
    interface DagPayload {
      kind?: string; cells?: DagCell[]; edges?: unknown[]; warnings?: string[];
      startedBy?: unknown; lanes?: Array<{ index: number; title: string | null }>; current?: number | null;
      truncated?: boolean; terminalAt?: string;
    }

    function isStabilized(dag: DagPayload): boolean {
      const cells = dag.cells ?? [];
      // a predicted cell: kind === 'agent' && agentId === undefined (DES-206) — NOT agentId ===
      // undefined alone, which the trigger cell also satisfies.
      const predicted = cells.filter((c) => c.kind === 'agent' && c.agentId === undefined);
      const runningLive = cells.filter((c) => c.kind === 'agent' && c.agentId !== undefined && c.state === 'running');
      return predicted.length >= 1 && runningLive.length === 1;
    }

    async function pollUntilStabilized(server: Server, runId: string): Promise<DagPayload> {
      const deadline = Date.now() + STABILIZE_DEADLINE_MS;
      let last: DagPayload = {};
      while (Date.now() < deadline) {
        const res = await fetch(`http://127.0.0.1:${server.port}/api/runs/${runId}/dag`);
        last = await res.json() as DagPayload;
        if (isStabilized(last)) return last;
        await new Promise((r) => setTimeout(r, STABILIZE_POLL_MS));
      }
      throw new Error(
        `DAG payload for run ${runId} on port ${server.port} never reached the stabilization predicate ` +
        `(>=1 predicted cell AND exactly 1 live 'running' agent cell) within ${STABILIZE_DEADLINE_MS}ms. ` +
        `Last cells: ${JSON.stringify(last.cells)}`,
      );
    }

    it('BOTH payloads pass the live key-set check, the AUTH server carries both positive anchors, and the two payloads are parity-equal minus [runId, terminalAt] with `current` COMPARED', async () => {
      const ownerToken = await mintBearer(authTmpDir, 'it092-owner@example.com');
      await registerPublishedVia(callerFor(authServer, ownerToken), 'it168-parity-auth', SCRIPT_PHASED);
      await registerPublishedVia(callerFor(openServer), 'it168-parity-open', SCRIPT_PHASED);
      const authRunId = await startRun(authServer, 'it168-parity-auth', ownerToken);
      const openRunId = await startRun(openServer, 'it168-parity-open');

      // Concurrent, not sequential: two independent 15s deadlines run back-to-back would risk the
      // vitest test timeout firing FIRST in a slow-but-healthy environment, which would misattribute
      // a real convergence problem as a generic hook timeout — exactly what the named per-poll error
      // above exists to prevent.
      const [authDag, openDag] = await Promise.all([
        pollUntilStabilized(authServer, authRunId),
        pollUntilStabilized(openServer, openRunId),
      ]);

      // Live key-set (ADR-054's budget rule): both payloads, against the SAME fixture tuples
      // dashboard-disclosure.test.ts itself reads.
      for (const dag of [authDag, openDag]) {
        const keys = Object.keys(dag);
        expect(keys.every((k) => (ALLOWED_DAG_KEYS as readonly string[]).includes(k))).toBe(true);
        expect(REQUIRED_DAG_KEYS.every((k) => keys.includes(k))).toBe(true);
      }

      // Positive anchors on the AUTH server — parity alone passes VACUOUSLY when both engines
      // degrade identically (e.g. both never implementing the overlay at all).
      expect((authDag.cells ?? []).some((c) => c.kind === 'agent' && /^__skel_\d+__$/.test(c.id))).toBe(true);
      expect((authDag.lanes ?? []).map((l) => l.title)).toEqual(['one', 'two', 'three']);
      expect(authDag.current).toBe(0);

      // Full parity, exclusion form (INV-V27-9): a NEW sibling field (e.g. a future
      // `RunStatusView.principal` spread into this payload) is caught by DEFAULT; a pick-list would
      // never see it. `runId` is a FORWARD guard (not a key on this payload today); `terminalAt` is
      // legitimately absent on a still-running run either way, so both deletes are no-ops here —
      // the exclusion list is asserted by NAME, not by "did anything actually get removed".
      const strip = (dag: DagPayload): Record<string, unknown> => {
        const copy: Record<string, unknown> = { ...dag };
        for (const k of PARITY_EXCLUDED) delete copy[k];
        return copy;
      };
      expect(strip(authDag)).toEqual(strip(openDag));
    }, 30000);
  });
});
